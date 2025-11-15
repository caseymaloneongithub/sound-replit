import passport from "passport";
import { Strategy as LocalStrategy } from "passport-local";
import { Express } from "express";
import session from "express-session";
import { scrypt, randomBytes, timingSafeEqual } from "crypto";
import { promisify } from "util";
import { storage } from "./storage";
import { User as SelectUser } from "@shared/schema";
import { createStripeCustomer } from "./stripeCustomer";
import { sendPasswordResetEmail } from "./email";

declare global {
  namespace Express {
    interface User extends SelectUser {}
    interface Request {
      originalUser?: SelectUser;
    }
  }
}

declare module 'express-session' {
  interface SessionData {
    impersonation?: {
      originalUserId: string;
      impersonatedUserId: string;
      logId: string;
    };
  }
}

const scryptAsync = promisify(scrypt);

export async function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  const buf = (await scryptAsync(password, salt, 64)) as Buffer;
  return `${buf.toString("hex")}.${salt}`;
}

async function comparePasswords(supplied: string, stored: string) {
  if (!stored || !stored.includes(".")) {
    return false;
  }
  
  const [hashed, salt] = stored.split(".");
  if (!hashed || !salt) {
    return false;
  }
  
  try {
    const hashedBuf = Buffer.from(hashed, "hex");
    const suppliedBuf = (await scryptAsync(supplied, salt, 64)) as Buffer;
    return timingSafeEqual(hashedBuf, suppliedBuf);
  } catch (error) {
    console.error("Password comparison error:", error);
    return false;
  }
}

export function setupAuth(app: Express) {
  const sessionSettings: session.SessionOptions = {
    secret: process.env.SESSION_SECRET!,
    resave: false,
    saveUninitialized: true,
    store: storage.sessionStore,
    cookie: {
      secure: process.env.NODE_ENV === 'production',
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    },
  };

  if (process.env.NODE_ENV === 'production') {
    app.set("trust proxy", 1);
  }

  app.use(session(sessionSettings));
  app.use(passport.initialize());
  app.use(passport.session());

  passport.use(
    new LocalStrategy(async (username, password, done) => {
      try {
        // Support login with either email or username
        const user = await storage.getUserByEmailOrUsername(username);
        if (!user || !user.password || !(await comparePasswords(password, user.password))) {
          return done(null, false, { message: "Invalid email/username or password" });
        }
        return done(null, user);
      } catch (error) {
        return done(error);
      }
    }),
  );

  passport.serializeUser((user, done) => done(null, user.id));
  passport.deserializeUser(async (id: string, done) => {
    try {
      const user = await storage.getUser(id);
      done(null, user || false);
    } catch (error) {
      done(error);
    }
  });

  app.use(async (req, res, next) => {
    if (req.session?.impersonation && req.user) {
      req.originalUser = req.user;
      
      const impersonatedUser = await storage.getUser(req.session.impersonation.impersonatedUserId);
      if (impersonatedUser) {
        req.user = impersonatedUser;
      } else {
        delete req.session.impersonation;
      }
    }
    next();
  });

  app.post("/api/register", async (req, res, next) => {
    try {
      const { phoneNumber, username, password } = req.body;

      if (!phoneNumber) {
        return res.status(400).send("Phone number is required");
      }

      if (!password) {
        return res.status(400).send("Password is required");
      }

      // Check if phone number has been verified
      const verificationCode = await storage.getLatestVerificationCode(phoneNumber);
      
      if (!verificationCode) {
        return res.status(400).send("Phone number not verified. Please request a verification code.");
      }

      if (!verificationCode.verified) {
        return res.status(400).send("Phone number not verified. Please verify your code.");
      }

      // Check if verification code has expired
      if (new Date() > verificationCode.expiresAt) {
        return res.status(400).send("Verification code has expired. Please request a new code.");
      }

      // Check if username already exists
      const existingUser = await storage.getUserByUsername(username);
      if (existingUser) {
        return res.status(400).send("Username already exists");
      }

      // Check if phone number already registered
      const existingPhoneUser = await storage.getUserByPhoneNumber(phoneNumber);
      if (existingPhoneUser) {
        return res.status(400).send("Phone number already registered");
      }

      // Create user
      const user = await storage.createUser({
        ...req.body,
        password: await hashPassword(password),
      });

      // Create Stripe customer for retail customers only (non-blocking - log errors but don't fail registration)
      if (user.role === 'user') {
        createStripeCustomer({
          userId: user.id,
          email: user.email,
          phoneNumber: user.phoneNumber,
          firstName: user.firstName,
          lastName: user.lastName,
          username: user.username,
        }).catch(error => {
          console.error("[Registration] Failed to create Stripe customer:", error);
        });
      }

      // Invalidate verification code after successful registration
      await storage.markVerificationCodeAsVerified(verificationCode.id);

      req.login(user, (err) => {
        if (err) return next(err);
        // Don't send password back
        const { password: _, ...userWithoutPassword } = user;
        res.status(201).json(userWithoutPassword);
      });
    } catch (error: any) {
      console.error("Registration error:", error);
      res.status(500).send("Registration failed");
    }
  });

  app.post("/api/login", (req, res, next) => {
    passport.authenticate("local", (err: any, user: SelectUser | false, info: any) => {
      if (err) return next(err);
      if (!user) {
        return res.status(401).send(info?.message || "Authentication failed");
      }
      req.login(user, (err) => {
        if (err) return next(err);
        // Don't send password back
        const { password, ...userWithoutPassword } = user;
        res.status(200).json(userWithoutPassword);
      });
    })(req, res, next);
  });

  app.post("/api/logout", async (req, res, next) => {
    if (req.session?.impersonation) {
      await storage.endImpersonation(req.session.impersonation.logId);
      delete req.session.impersonation;
    }
    
    req.logout((err) => {
      if (err) return next(err);
      res.sendStatus(200);
    });
  });

  app.get("/api/user", (req, res) => {
    if (!req.isAuthenticated() || !req.user) {
      return res.sendStatus(401);
    }
    
    const { password, ...userWithoutPassword } = req.user;
    
    if (req.session?.impersonation && req.originalUser) {
      return res.json({
        ...userWithoutPassword,
        impersonation: {
          isImpersonating: true,
          originalUser: {
            id: req.originalUser.id,
            username: req.originalUser.username,
          },
        },
      });
    }
    
    res.json(userWithoutPassword);
  });

  // Request password reset
  app.post("/api/forgot-password", async (req, res) => {
    try {
      const { email } = req.body;

      if (!email) {
        return res.status(400).json({ message: "Email is required" });
      }

      // Find user by email
      const user = await storage.getUserByEmail(email);
      
      // For security, always return success even if email doesn't exist
      // This prevents email enumeration attacks
      if (!user) {
        console.log(`[PASSWORD RESET] Email not found: ${email}`);
        return res.status(200).json({ message: "If that email exists, a password reset link has been sent" });
      }

      // Generate secure token
      const token = randomBytes(32).toString('hex');
      const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour from now

      // Save token to database
      await storage.createPasswordResetToken(user.id, token, expiresAt);

      // Send email with reset link
      const resetUrl = `${req.protocol}://${req.get('host')}/reset-password?token=${token}`;
      await sendPasswordResetEmail({
        email: user.email!,
        name: user.firstName || user.username,
        resetUrl,
      });

      console.log(`[PASSWORD RESET] Reset email sent to: ${email}`);
      res.status(200).json({ message: "If that email exists, a password reset link has been sent" });
    } catch (error: any) {
      console.error("[PASSWORD RESET] Error:", error);
      res.status(500).json({ message: "Failed to process password reset request" });
    }
  });

  // Reset password with token
  app.post("/api/reset-password", async (req, res) => {
    try {
      const { token, newPassword } = req.body;

      if (!token || !newPassword) {
        return res.status(400).json({ message: "Token and new password are required" });
      }

      // Validate password strength
      if (newPassword.length < 8) {
        return res.status(400).json({ message: "Password must be at least 8 characters" });
      }

      // Get token from database
      const resetToken = await storage.getPasswordResetToken(token);

      if (!resetToken) {
        return res.status(400).json({ message: "Invalid or expired reset token" });
      }

      // Check if token has been used
      if (resetToken.used) {
        return res.status(400).json({ message: "This reset link has already been used" });
      }

      // Check if token has expired
      if (new Date() > resetToken.expiresAt) {
        return res.status(400).json({ message: "This reset link has expired" });
      }

      // Hash new password
      const hashedPassword = await hashPassword(newPassword);

      // Update user password
      await storage.updateUserPassword(resetToken.userId, hashedPassword);

      // Mark token as used
      await storage.markPasswordResetTokenAsUsed(token);

      console.log(`[PASSWORD RESET] Password reset successful for user: ${resetToken.userId}`);
      res.status(200).json({ message: "Password reset successful" });
    } catch (error: any) {
      console.error("[PASSWORD RESET] Error:", error);
      res.status(500).json({ message: "Failed to reset password" });
    }
  });
}

// Middleware to check if user is authenticated
export function isAuthenticated(req: any, res: any, next: any) {
  if (req.isAuthenticated()) {
    return next();
  }
  res.sendStatus(401);
}
