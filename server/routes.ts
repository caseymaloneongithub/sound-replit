import type { Express } from "express";
import { createServer, type Server } from "http";
import Stripe from "stripe";
import { storage } from "./storage";
import { insertSubscriptionSchema, insertWholesaleCustomerSchema, insertWholesaleOrderSchema, insertProductSchema, insertWholesalePricingSchema } from "@shared/schema";
import { setupAuth, isAuthenticated } from "./auth";
import { z } from "zod";
import { sendVerificationCode, generateVerificationCode } from "./twilio";
import { getCasePriceCents, CASE_SIZE } from "@shared/pricing";
import { ObjectStorageService, ObjectNotFoundError } from "./objectStorage";
import { createStripeCustomer } from "./stripeCustomer";

const stripe = process.env.STRIPE_SECRET_KEY 
  ? new Stripe(process.env.STRIPE_SECRET_KEY, {
      apiVersion: "2025-10-29.clover",
    })
  : null;

export async function registerRoutes(app: Express): Promise<Server> {
  // Auth middleware - sets up /api/register, /api/login, /api/logout, /api/user
  await setupAuth(app);

  // Admin middleware - checks if user is an admin
  const isAdmin = async (req: any, res: any, next: any) => {
    try {
      if (!req.user) {
        return res.status(401).json({ message: "Unauthorized - please log in" });
      }
      
      if (!req.user.isAdmin) {
        return res.status(403).json({ message: "Forbidden: Admin access required" });
      }
      
      next();
    } catch (error: any) {
      console.error("Error verifying admin status:", error);
      res.status(500).json({ message: "Error verifying admin status" });
    }
  };

  // Super admin middleware - checks if user is a super admin
  const isSuperAdmin = async (req: any, res: any, next: any) => {
    try {
      if (!req.user) {
        return res.status(401).json({ message: "Unauthorized - please log in" });
      }
      
      if (req.user.role !== 'super_admin') {
        return res.status(403).json({ message: "Forbidden: Super admin access required" });
      }
      
      next();
    } catch (error: any) {
      console.error("Error verifying super admin status:", error);
      res.status(500).json({ message: "Error verifying super admin status" });
    }
  };

  // Staff or admin middleware - checks if user is staff, admin, or super admin
  const isStaffOrAdmin = async (req: any, res: any, next: any) => {
    try {
      if (!req.user) {
        return res.status(401).json({ message: "Unauthorized - please log in" });
      }
      
      if (!['staff', 'admin', 'super_admin'].includes(req.user.role)) {
        return res.status(403).json({ message: "Forbidden: Staff or admin access required" });
      }
      
      next();
    } catch (error: any) {
      console.error("Error verifying staff/admin status:", error);
      res.status(500).json({ message: "Error verifying staff/admin status" });
    }
  };

  // Wholesale customer middleware - checks if user is a wholesale customer
  const isWholesaleCustomer = async (req: any, res: any, next: any) => {
    try {
      if (!req.user) {
        return res.status(401).json({ message: "Unauthorized - please log in" });
      }
      
      if (req.user.role !== 'wholesale_customer') {
        return res.status(403).json({ message: "Forbidden: Wholesale customer access required" });
      }
      
      next();
    } catch (error: any) {
      console.error("Error verifying wholesale customer status:", error);
      res.status(500).json({ message: "Error verifying wholesale customer status" });
    }
  };

  // SMS verification routes
  app.post("/api/send-verification-code", async (req, res) => {
    try {
      const { phoneNumber } = req.body;
      
      if (!phoneNumber) {
        return res.status(400).json({ message: "Phone number is required" });
      }

      // Generate 6-digit code
      const code = generateVerificationCode();
      
      // Store code in database with 5-minute expiration
      const expiresAt = new Date(Date.now() + 5 * 60 * 1000);
      await storage.createVerificationCode({
        phoneNumber,
        code,
        expiresAt,
        verified: false
      });

      // Send SMS
      await sendVerificationCode(phoneNumber, code);

      res.json({ message: "Verification code sent" });
    } catch (error: any) {
      console.error("Error sending verification code:", error);
      res.status(500).json({ message: "Error sending verification code: " + error.message });
    }
  });

  app.post("/api/verify-code", async (req, res) => {
    try {
      const { phoneNumber, code } = req.body;
      
      if (!phoneNumber || !code) {
        return res.status(400).json({ message: "Phone number and code are required" });
      }

      // Get latest verification code for this phone number
      const verificationCode = await storage.getLatestVerificationCode(phoneNumber);
      
      if (!verificationCode) {
        return res.status(400).json({ message: "No verification code found" });
      }

      // Check if code is expired
      if (new Date() > verificationCode.expiresAt) {
        return res.status(400).json({ message: "Verification code has expired" });
      }

      // Check if code matches
      if (verificationCode.code !== code) {
        return res.status(400).json({ message: "Invalid verification code" });
      }

      // Check if already verified
      if (verificationCode.verified) {
        return res.status(400).json({ message: "Verification code already used" });
      }

      // Mark as verified
      await storage.markVerificationCodeAsVerified(verificationCode.id);

      res.json({ message: "Phone number verified successfully", verified: true });
    } catch (error: any) {
      console.error("Error verifying code:", error);
      res.status(500).json({ message: "Error verifying code: " + error.message });
    }
  });

  // Wholesale customer registration
  app.post("/api/register-wholesale", async (req, res) => {
    try {
      const { phoneNumber, username, password, businessName, contactName, email, phone, address } = req.body;

      if (!phoneNumber || !username || !password || !businessName || !contactName || !email || !phone || !address) {
        return res.status(400).json({ message: "All fields are required" });
      }

      // Check if phone number has been verified
      const verificationCode = await storage.getLatestVerificationCode(phoneNumber);
      
      if (!verificationCode || !verificationCode.verified) {
        return res.status(400).json({ message: "Phone number not verified" });
      }

      // Check if username already exists
      const existingUser = await storage.getUserByUsername(username);
      if (existingUser) {
        return res.status(400).json({ message: "Username already taken" });
      }

      // Check if email already exists in wholesale customers
      const existingCustomer = await storage.getWholesaleCustomerByEmail(email);
      if (existingCustomer) {
        return res.status(400).json({ message: "Email already registered as wholesale customer" });
      }

      // Import hashPassword function from auth
      const { hashPassword } = await import('./auth');
      
      // Create user with wholesale_customer role
      const user = await storage.createUser({
        username,
        password: await hashPassword(password),
        phoneNumber,
        email,
      });

      // Update user role to wholesale_customer
      await storage.updateUserRole(user.id, 'wholesale_customer');

      // Create wholesale customer record linked to user
      await storage.createWholesaleCustomer({
        userId: user.id,
        businessName,
        contactName,
        email,
        phone,
        address,
      });

      // Create Stripe customer (non-blocking - log errors but don't fail registration)
      createStripeCustomer({
        userId: user.id,
        email: user.email,
        phoneNumber: user.phoneNumber,
        firstName: contactName.split(' ')[0],
        lastName: contactName.split(' ').slice(1).join(' ') || undefined,
        username: user.username,
      }).catch(error => {
        console.error("[Wholesale Registration] Failed to create Stripe customer:", error);
      });

      res.status(201).json({ message: "Wholesale account created successfully" });
    } catch (error: any) {
      console.error("Wholesale registration error:", error);
      res.status(500).json({ message: "Registration failed: " + error.message });
    }
  });

  // Wholesale customer endpoints - for customers to view their own orders
  app.get("/api/wholesale-customer/orders", isAuthenticated, isWholesaleCustomer, async (req, res) => {
    try {
      if (!req.user) {
        return res.status(401).json({ message: "Not authenticated" });
      }
      
      // Get wholesale customer record for authenticated user
      const customer = await storage.getWholesaleCustomerByUserId(req.user.id);
      if (!customer) {
        return res.status(404).json({ message: "Wholesale customer record not found" });
      }

      // Get orders for this customer only
      const orders = await storage.getWholesaleOrdersByCustomerId(customer.id);
      res.json(orders);
    } catch (error: any) {
      res.status(500).json({ message: "Error fetching orders: " + error.message });
    }
  });

  app.get("/api/wholesale-customer/orders/:id", isAuthenticated, isWholesaleCustomer, async (req, res) => {
    try {
      if (!req.user) {
        return res.status(401).json({ message: "Not authenticated" });
      }
      
      // Get wholesale customer record for authenticated user
      const customer = await storage.getWholesaleCustomerByUserId(req.user.id);
      if (!customer) {
        return res.status(404).json({ message: "Wholesale customer record not found" });
      }

      // Get order details
      const order = await storage.getWholesaleOrder(req.params.id);
      if (!order) {
        return res.status(404).json({ message: "Order not found" });
      }

      // Verify this order belongs to the authenticated customer
      if (order.customerId !== customer.id) {
        return res.status(403).json({ message: "Access denied to this order" });
      }

      // Get order with items
      const orderDetails = await storage.getWholesaleOrderWithDetails(req.params.id);
      res.json(orderDetails);
    } catch (error: any) {
      res.status(500).json({ message: "Error fetching order: " + error.message });
    }
  });

  // SMS login routes
  app.post("/api/login/sms/request", async (req, res) => {
    try {
      const { phoneNumber } = req.body;
      
      if (!phoneNumber) {
        return res.status(400).json({ message: "Phone number is required" });
      }

      // Check if user exists with this phone number
      const user = await storage.getUserByPhoneNumber(phoneNumber);
      
      // Always return success to prevent phone number enumeration
      // Only send SMS if user actually exists
      if (user) {
        // Generate 6-digit code
        const code = generateVerificationCode();
        
        console.log(`[SMS Login] Sending code ${code} to ${phoneNumber}`);
        
        // Store code in database with 5-minute expiration
        const expiresAt = new Date(Date.now() + 5 * 60 * 1000);
        await storage.createVerificationCode({
          phoneNumber,
          code,
          purpose: 'login',
          expiresAt,
          verified: false,
        });

        // Send SMS
        try {
          await sendVerificationCode(phoneNumber, code);
          console.log(`[SMS Login] Successfully sent code to ${phoneNumber}`);
        } catch (smsError: any) {
          console.error(`[SMS Login] Failed to send SMS to ${phoneNumber}:`, smsError);
          // Don't throw - we still want to return success for security
        }
      } else {
        // Log potential enumeration attempt
        console.warn(`SMS login code requested for non-existent phone: ${phoneNumber}`);
      }

      // Always return success to prevent enumeration
      res.json({ message: "If an account exists with this phone number, a login code has been sent" });
    } catch (error: any) {
      console.error("Error sending login code:", error);
      res.status(500).json({ message: "Error sending login code: " + error.message });
    }
  });

  app.post("/api/login/sms/verify", async (req, res) => {
    try {
      const { phoneNumber, code } = req.body;
      
      if (!phoneNumber || !code) {
        return res.status(400).json({ message: "Phone number and code are required" });
      }

      // Get latest login verification code for this phone number
      const verificationCode = await storage.getLatestVerificationCodeByPurpose(phoneNumber, 'login');
      
      if (!verificationCode) {
        return res.status(400).json({ message: "No login code found. Please request a new code." });
      }

      // Check if code is expired
      if (new Date() > verificationCode.expiresAt) {
        return res.status(400).json({ message: "Login code has expired. Please request a new code." });
      }

      // Check if code was already consumed
      if (verificationCode.consumedAt) {
        return res.status(400).json({ message: "Login code already used. Please request a new code." });
      }

      // Check attempt limit (3 attempts max)
      if (verificationCode.attempts >= 3) {
        return res.status(400).json({ message: "Too many attempts. Please request a new code." });
      }

      // Check if code matches
      if (verificationCode.code !== code) {
        // Increment attempts counter
        await storage.incrementVerificationAttempts(verificationCode.id);
        const attemptsLeft = 3 - (verificationCode.attempts + 1);
        return res.status(400).json({ 
          message: `Invalid code. ${attemptsLeft} attempt${attemptsLeft !== 1 ? 's' : ''} remaining.`
        });
      }

      // Get user by phone number
      const user = await storage.getUserByPhoneNumber(phoneNumber);
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }

      // Mark code as consumed
      await storage.markVerificationCodeAsConsumed(verificationCode.id);

      // Log user in using passport's req.login
      req.login(user, (err) => {
        if (err) {
          console.error("Error logging in user:", err);
          return res.status(500).json({ message: "Error logging in" });
        }
        // Don't send password back
        const { password, ...userWithoutPassword } = user;
        res.json(userWithoutPassword);
      });
    } catch (error: any) {
      console.error("Error verifying login code:", error);
      res.status(500).json({ message: "Error verifying login code: " + error.message });
    }
  });

  // Product routes
  app.get("/api/products", async (req: any, res) => {
    try {
      const includeInactive = req.query.includeInactive === 'true';
      
      if (includeInactive && (!req.user || req.user.role !== 'admin')) {
        return res.status(403).json({ message: "Only admins can view inactive products" });
      }
      
      const products = await storage.getProducts(includeInactive);
      res.json(products);
    } catch (error: any) {
      res.status(500).json({ message: "Error fetching products: " + error.message });
    }
  });

  app.get("/api/products/:id", async (req, res) => {
    try {
      const product = await storage.getProduct(req.params.id);
      if (!product) {
        return res.status(404).json({ message: "Product not found" });
      }
      res.json(product);
    } catch (error: any) {
      res.status(500).json({ message: "Error fetching product: " + error.message });
    }
  });

  app.post("/api/products", isAdmin, async (req, res) => {
    try {
      const validatedData = insertProductSchema.parse(req.body);
      const product = await storage.createProduct(validatedData);
      res.json(product);
    } catch (error: any) {
      if (error.name === 'ZodError') {
        return res.status(400).json({ message: "Validation error", errors: error.errors });
      }
      res.status(500).json({ message: "Error creating product: " + error.message });
    }
  });

  app.patch("/api/products/:id", isAdmin, async (req, res) => {
    try {
      const partialProductSchema = insertProductSchema.partial();
      const validatedUpdates = partialProductSchema.parse(req.body);
      const product = await storage.updateProduct(req.params.id, validatedUpdates);
      if (!product) {
        return res.status(404).json({ message: "Product not found" });
      }
      res.json(product);
    } catch (error: any) {
      if (error.name === 'ZodError') {
        return res.status(400).json({ message: "Validation error", errors: error.errors });
      }
      res.status(500).json({ message: "Error updating product: " + error.message });
    }
  });

  // Object storage routes
  app.post("/api/objects/upload", isAdmin, async (req, res) => {
    try {
      const objectStorageService = new ObjectStorageService();
      const uploadURL = await objectStorageService.getObjectEntityUploadURL();
      res.json({ uploadURL });
    } catch (error: any) {
      console.error("Error getting upload URL:", error);
      res.status(500).json({ message: "Error getting upload URL: " + error.message });
    }
  });

  app.get("/objects/:objectPath(*)", async (req, res) => {
    const objectStorageService = new ObjectStorageService();
    try {
      const objectFile = await objectStorageService.getObjectEntityFile(req.path);
      objectStorageService.downloadObject(objectFile, res);
    } catch (error: any) {
      console.error("Error accessing object:", error);
      if (error instanceof ObjectNotFoundError) {
        return res.sendStatus(404);
      }
      return res.sendStatus(500);
    }
  });

  app.put("/api/products/:id/photos", isAdmin, async (req: any, res) => {
    try {
      const { photoUrls } = req.body;
      
      if (!photoUrls || !Array.isArray(photoUrls)) {
        return res.status(400).json({ message: "photoUrls array is required" });
      }

      if (!req.user || !req.user.id) {
        return res.status(401).json({ message: "Unauthorized" });
      }

      const objectStorageService = new ObjectStorageService();
      const normalizedPaths: string[] = [];

      for (const url of photoUrls) {
        const normalizedPath = await objectStorageService.trySetObjectEntityAclPolicy(
          url,
          {
            owner: req.user.id,
            visibility: "public",
          }
        );
        normalizedPaths.push(normalizedPath);
      }

      if (req.params.id !== "new-product") {
        const product = await storage.updateProduct(req.params.id, {
          imageUrls: normalizedPaths
        });

        if (!product) {
          return res.status(404).json({ message: "Product not found" });
        }

        res.json(product);
      } else {
        res.json({ imageUrls: normalizedPaths });
      }
    } catch (error: any) {
      console.error("Error updating product photos:", error);
      res.status(500).json({ message: "Error updating product photos: " + error.message });
    }
  });

  // Subscription plan routes
  app.get("/api/subscription-plans", async (req, res) => {
    try {
      const plans = await storage.getSubscriptionPlans();
      res.json(plans);
    } catch (error: any) {
      res.status(500).json({ message: "Error fetching plans: " + error.message });
    }
  });

  app.get("/api/subscription-plans/:id", async (req, res) => {
    try {
      const plan = await storage.getSubscriptionPlan(req.params.id);
      if (!plan) {
        return res.status(404).json({ message: "Plan not found" });
      }
      res.json(plan);
    } catch (error: any) {
      res.status(500).json({ message: "Error fetching plan: " + error.message });
    }
  });

  // Create Stripe checkout session for cart purchases (one-time or subscription)
  app.post("/api/create-cart-checkout", async (req: any, res) => {
    try {
      if (!stripe) {
        return res.status(503).json({ message: "Payment processing is not configured" });
      }

      const sessionId = req.sessionID || "guest";
      const items = await storage.getCartItems(sessionId);
      
      if (items.length === 0) {
        return res.status(400).json({ message: "Cart is empty" });
      }

      // Check if cart has both subscription and one-time items
      const hasSubscription = items.some(item => item.isSubscription);
      const hasOneTime = items.some(item => !item.isSubscription);

      if (hasSubscription && hasOneTime) {
        return res.status(400).json({ 
          message: "Please checkout one-time purchases and subscriptions separately. Remove either the one-time or subscription items from your cart to continue."
        });
      }

      const baseUrl = process.env.REPL_SLUG 
        ? `https://${process.env.REPL_SLUG}.${process.env.REPL_OWNER}.repl.co`
        : 'http://localhost:5000';

      const lineItems = await Promise.all(
        items.map(async (item) => {
          const product = await storage.getProduct(item.productId);
          if (!product) throw new Error(`Product ${item.productId} not found`);
          
          const imageUrl = product.imageUrl.startsWith('http') 
            ? product.imageUrl 
            : `${baseUrl}${product.imageUrl}`;
          
          // Use centralized case pricing
          const casePrice = getCasePriceCents(item.isSubscription);

          if (item.isSubscription) {
            // For subscriptions, create recurring price
            const frequencyLabel = 
              item.subscriptionFrequency === 'weekly' ? 'Weekly' :
              item.subscriptionFrequency === 'bi-weekly' ? 'Bi-weekly' :
              'Every 4 Weeks';
            
            const intervalCount = 
              item.subscriptionFrequency === 'weekly' ? 1 :
              item.subscriptionFrequency === 'bi-weekly' ? 2 :
              4;
            
            return {
              price_data: {
                currency: 'usd',
                product_data: {
                  name: `${product.name} - Case of 12 (${item.subscriptionFrequency})`,
                  description: `${frequencyLabel} subscription`,
                  images: imageUrl.startsWith('http') ? [imageUrl] : [],
                },
                unit_amount: casePrice,
                recurring: {
                  interval: 'week' as const,
                  interval_count: intervalCount,
                },
              },
              quantity: item.quantity,
            };
          } else {
            // One-time purchase
            return {
              price_data: {
                currency: 'usd',
                product_data: {
                  name: `${product.name} - Case of 12`,
                  images: imageUrl.startsWith('http') ? [imageUrl] : [],
                },
                unit_amount: casePrice,
              },
              quantity: item.quantity,
            };
          }
        })
      );

      // For subscriptions, include product info in metadata
      const metadata: Record<string, string> = {
        sessionId,
        type: hasSubscription ? 'subscription_purchase' : 'cart_purchase',
      };
      
      if (hasSubscription && items.length > 0) {
        const subItem = items.find(item => item.isSubscription);
        if (subItem) {
          metadata.productId = subItem.productId;
          metadata.subscriptionFrequency = subItem.subscriptionFrequency || 'weekly';
        }
      }
      
      // Include userId if user is authenticated
      if (req.user && req.user.id) {
        metadata.userId = req.user.id;
      }

      // Calculate sales tax for retail orders (WA State 6.5% + Seattle City 3.85% = 10.35%)
      // Tax only applies to one-time purchases, not subscriptions
      const TAX_RATE = 0.1035; // 10.35%
      
      // Calculate subtotal from non-subscription items only, using actual product prices
      const taxableSubtotal = await Promise.all(
        items
          .filter(item => !item.isSubscription)
          .map(async (item) => {
            const product = await storage.getProduct(item.productId);
            if (!product) return 0;
            // Use actual product retail price in cents
            const priceInCents = Math.round(parseFloat(product.retailPrice) * 100);
            return priceInCents * item.quantity;
          })
      ).then(amounts => amounts.reduce((sum, amount) => sum + amount, 0));
      
      if (taxableSubtotal > 0) {
        // Calculate tax amount in cents
        const taxAmount = Math.round(taxableSubtotal * TAX_RATE);
        
        // Add tax as a separate line item
        lineItems.push({
          price_data: {
            currency: 'usd',
            product_data: {
              name: 'Sales Tax (WA State 6.5% + Seattle 3.85%)',
              images: [],
            },
            unit_amount: taxAmount,
          },
          quantity: 1,
        });
        
        // Store tax info in metadata for reference
        metadata.taxRate = TAX_RATE.toString();
        metadata.taxAmount = (taxAmount / 100).toFixed(2);
        metadata.taxableSubtotal = (taxableSubtotal / 100).toFixed(2);
      }

      const session = await stripe.checkout.sessions.create({
        mode: hasSubscription ? 'subscription' : 'payment',
        line_items: lineItems,
        success_url: `${baseUrl}/checkout/success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${baseUrl}/shop`,
        metadata,
      });

      res.json({ url: session.url, sessionId: session.id });
    } catch (error: any) {
      console.error("Cart checkout error:", error);
      res.status(500).json({ message: "Error creating checkout: " + error.message });
    }
  });

  // Create Stripe Payment Intent for embedded cart checkout
  app.post("/api/create-cart-payment-intent", async (req: any, res) => {
    try {
      if (!stripe) {
        return res.status(503).json({ message: "Payment processing is not configured" });
      }

      const sessionId = req.sessionID || "guest";
      const items = await storage.getCartItems(sessionId);
      
      if (items.length === 0) {
        return res.status(400).json({ message: "Cart is empty" });
      }

      // Check if cart has both subscription and one-time items
      const hasSubscription = items.some(item => item.isSubscription);
      const hasOneTime = items.some(item => !item.isSubscription);

      if (hasSubscription && hasOneTime) {
        return res.status(400).json({ 
          message: "Please checkout one-time purchases and subscriptions separately. Remove either the one-time or subscription items from your cart to continue."
        });
      }

      // Payment Intents only work for one-time payments, not subscriptions
      if (hasSubscription) {
        return res.status(400).json({
          message: "Subscriptions require a different checkout flow. Please use the subscription checkout page."
        });
      }

      // Calculate total amount in cents using actual product prices
      let subtotalCents = 0;
      for (const item of items) {
        const product = await storage.getProduct(item.productId);
        if (!product) throw new Error(`Product ${item.productId} not found`);
        const priceInCents = Math.round(parseFloat(product.retailPrice) * 100);
        subtotalCents += priceInCents * item.quantity;
      }

      // Calculate sales tax (WA State 6.5% + Seattle City 3.85% = 10.35%)
      const TAX_RATE = 0.1035;
      const taxAmountCents = Math.round(subtotalCents * TAX_RATE);
      const totalAmountCents = subtotalCents + taxAmountCents;

      // Create payment intent
      const paymentIntent = await stripe.paymentIntents.create({
        amount: totalAmountCents,
        currency: 'usd',
        automatic_payment_methods: {
          enabled: true,
        },
        metadata: {
          sessionId,
          type: 'cart_purchase',
          userId: req.user?.id || 'guest',
          subtotal: (subtotalCents / 100).toFixed(2),
          taxRate: TAX_RATE.toString(),
          taxAmount: (taxAmountCents / 100).toFixed(2),
        },
      });

      res.json({ 
        clientSecret: paymentIntent.client_secret,
        subtotal: subtotalCents / 100,
        taxAmount: taxAmountCents / 100,
        total: totalAmountCents / 100,
      });
    } catch (error: any) {
      console.error("Cart payment intent error:", error);
      res.status(500).json({ message: "Error creating payment intent: " + error.message });
    }
  });

  // Create Stripe checkout session for subscriptions
  const createCheckoutSchema = z.object({
    planId: z.string().uuid(),
    customerEmail: z.string().email(),
    customerName: z.string().min(1),
  });

  app.post("/api/create-checkout-session", async (req, res) => {
    try {
      if (!stripe) {
        return res.status(503).json({ message: "Payment processing is not configured. Please contact support." });
      }

      const validated = createCheckoutSchema.parse(req.body);
      const plan = await storage.getSubscriptionPlan(validated.planId);
      
      if (!plan) {
        return res.status(404).json({ message: "Plan not found" });
      }

      if (!plan.stripePriceId) {
        return res.status(400).json({ message: "This plan is not available for online purchase" });
      }

      const baseUrl = process.env.REPL_SLUG 
        ? `https://${process.env.REPL_SLUG}.${process.env.REPL_OWNER}.repl.co`
        : 'http://localhost:5000';

      const successUrl = `${baseUrl}/checkout/success?session_id={CHECKOUT_SESSION_ID}`;
      const cancelUrl = `${baseUrl}/shop`;

      const session = await stripe.checkout.sessions.create({
        mode: 'subscription',
        line_items: [
          {
            price: plan.stripePriceId,
            quantity: 1,
          },
        ],
        customer_email: validated.customerEmail,
        metadata: {
          planId: plan.id,
          customerName: validated.customerName,
        },
        success_url: successUrl,
        cancel_url: cancelUrl,
      });

      res.json({ url: session.url, sessionId: session.id });
    } catch (error: any) {
      console.error("Stripe checkout error:", error);
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid request data", errors: error.errors });
      }
      res.status(500).json({ message: "Error creating checkout session: " + error.message });
    }
  });

  // Stripe webhook handler with mandatory signature verification
  app.post("/api/webhooks/stripe", async (req: any, res) => {
    try {
      if (!stripe) {
        return res.status(503).send("Stripe not configured");
      }

      const sig = req.headers['stripe-signature'];
      const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

      if (!webhookSecret) {
        console.error("STRIPE_WEBHOOK_SECRET not configured");
        return res.status(400).send("Webhook secret not configured");
      }

      if (!sig) {
        console.error("Missing Stripe-Signature header");
        return res.status(400).send("Missing signature header");
      }

      let event: Stripe.Event;

      try {
        event = stripe.webhooks.constructEvent(
          req.rawBody as Buffer,
          sig,
          webhookSecret
        );
      } catch (err: any) {
        console.error(`Webhook signature verification failed: ${err.message}`);
        return res.status(400).send(`Webhook Error: ${err.message}`);
      }

      switch (event.type) {
        case 'checkout.session.completed': {
          const session = event.data.object as Stripe.Checkout.Session;
          
          if (session.metadata?.type === 'cart_purchase') {
            const sessionId = session.metadata.sessionId;
            if (sessionId) {
              await storage.clearCart(sessionId);
              console.log(`Cleared cart for session ${sessionId} after successful payment`);
            }
            break;
          }
          
          if (!session.subscription) {
            console.error("No subscription ID in checkout session");
            break;
          }

          const subscription = await stripe.subscriptions.retrieve(session.subscription as string);
          
          const existing = await storage.getSubscriptionByStripeId(subscription.id);
          if (existing) {
            console.log(`Subscription ${subscription.id} already exists, skipping creation`);
            break;
          }

          // Determine frequency for next delivery calculation
          const frequency = session.metadata?.subscriptionFrequency || 'weekly';
          const daysUntilNext = 
            frequency === 'weekly' ? 7 :
            frequency === 'bi-weekly' ? 14 :
            28; // every-4-weeks

          // Create subscription with product info from metadata (cart-based) or planId (plan-based)
          const subscriptionData: any = {
            customerName: session.metadata?.customerName || session.customer_details?.name || 'Unknown',
            customerEmail: session.customer_details?.email || '',
            customerPhone: '',
            stripeSubscriptionId: subscription.id,
            stripeCustomerId: subscription.customer as string,
            status: 'active',
            nextDeliveryDate: new Date(Date.now() + daysUntilNext * 24 * 60 * 60 * 1000),
          };

          // Add userId if available
          if (session.metadata?.userId) {
            subscriptionData.userId = session.metadata.userId;
          }

          // Cart-based subscription (has productId in metadata)
          if (session.metadata?.productId) {
            subscriptionData.productId = session.metadata.productId;
            subscriptionData.subscriptionFrequency = frequency;
            // Clear cart after subscription created
            if (session.metadata.sessionId) {
              await storage.clearCart(session.metadata.sessionId);
            }
          } 
          // Plan-based subscription (legacy)
          else if (session.metadata?.planId) {
            const plan = await storage.getSubscriptionPlan(session.metadata.planId);
            if (plan) {
              subscriptionData.planId = plan.id;
            }
          }

          await storage.createSubscription(subscriptionData);
          console.log(`Created subscription ${subscription.id}`);
          break;
        }
        case 'customer.subscription.updated':
        case 'customer.subscription.deleted': {
          const subscription = event.data.object as Stripe.Subscription;
          
          const statusMap: Record<string, string> = {
            'active': 'active',
            'canceled': 'cancelled',
            'past_due': 'active',
            'unpaid': 'active',
            'incomplete': 'active',
            'incomplete_expired': 'cancelled',
            'trialing': 'active',
            'paused': 'paused',
          };
          
          const status = statusMap[subscription.status] || 'active';
          
          await storage.updateSubscriptionByStripeId(subscription.id, { status });
          console.log(`Updated subscription ${subscription.id} to status ${status}`);
          break;
        }
        case 'payment_intent.succeeded': {
          const paymentIntent = event.data.object as Stripe.PaymentIntent;
          
          // Handle cart purchase payments
          if (paymentIntent.metadata?.type === 'cart_purchase') {
            const sessionId = paymentIntent.metadata.sessionId;
            if (sessionId) {
              await storage.clearCart(sessionId);
              console.log(`Cleared cart for session ${sessionId} after successful payment`);
            }
          }
          break;
        }
      }

      res.json({ received: true });
    } catch (error: any) {
      console.error("Webhook error:", error);
      res.status(400).send(`Webhook Error: ${error.message}`);
    }
  });

  // Create subscription
  app.post("/api/subscriptions", async (req, res) => {
    try {
      const validated = insertSubscriptionSchema.parse(req.body);
      const subscription = await storage.createSubscription(validated);
      res.json(subscription);
    } catch (error: any) {
      res.status(400).json({ message: "Error creating subscription: " + error.message });
    }
  });

  app.get("/api/subscriptions", async (req, res) => {
    try {
      const subscriptions = await storage.getSubscriptions();
      res.json(subscriptions);
    } catch (error: any) {
      res.status(500).json({ message: "Error fetching subscriptions: " + error.message });
    }
  });

  app.get("/api/my-subscriptions", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.id;
      console.log('[DEBUG] Fetching subscriptions for user:', userId);
      const subscriptions = await storage.getUserSubscriptions(userId);
      console.log('[DEBUG] Found subscriptions:', subscriptions.length);
      
      // Fetch items for each subscription
      const subscriptionsWithItems = await Promise.all(
        subscriptions.map(async (sub) => {
          const items = await storage.getSubscriptionItems(sub.id);
          
          // Enrich items with product data
          const itemsWithProducts = await Promise.all(
            items.map(async (item) => {
              const product = await storage.getProduct(item.productId);
              return { ...item, product };
            })
          );
          
          return { ...sub, items: itemsWithProducts };
        })
      );
      
      res.json(subscriptionsWithItems);
    } catch (error: any) {
      console.error('[ERROR] Failed to fetch user subscriptions:', error);
      res.status(500).json({ message: "Error fetching user subscriptions: " + error.message });
    }
  });

  // Update subscription (delay delivery, change product)
  app.patch("/api/my-subscriptions/:id", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const subscriptionId = req.params.id;
      
      // Verify subscription belongs to user
      const subscription = await storage.getSubscription(subscriptionId);
      if (!subscription || subscription.userId !== userId) {
        return res.status(404).json({ message: "Subscription not found" });
      }
      
      const updateSchema = z.object({
        productId: z.string().uuid().optional(),
        nextDeliveryDate: z.string().datetime().transform(str => new Date(str)).optional(),
      });
      
      const validated = updateSchema.parse(req.body);
      const updated = await storage.updateSubscription(subscriptionId, validated);
      
      res.json(updated);
    } catch (error: any) {
      console.error("Error updating subscription:", error);
      res.status(400).json({ message: "Error updating subscription: " + error.message });
    }
  });

  // Cancel subscription (DELETE method)
  app.delete("/api/my-subscriptions/:id", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const subscriptionId = req.params.id;
      
      // Verify subscription belongs to user
      const subscription = await storage.getSubscription(subscriptionId);
      if (!subscription || subscription.userId !== userId) {
        return res.status(404).json({ message: "Subscription not found" });
      }
      
      // Check if already cancelled
      if (subscription.status === 'cancelled') {
        return res.status(400).json({ message: "Subscription is already cancelled" });
      }
      
      const cancelled = await storage.cancelSubscription(subscriptionId);
      res.json(cancelled);
    } catch (error: any) {
      console.error("Error cancelling subscription:", error);
      res.status(500).json({ message: "Error cancelling subscription: " + error.message });
    }
  });

  // Cancel subscription (POST method for backwards compatibility)
  app.post("/api/my-subscriptions/:id/cancel", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const subscriptionId = req.params.id;
      
      // Verify subscription belongs to user
      const subscription = await storage.getSubscription(subscriptionId);
      if (!subscription || subscription.userId !== userId) {
        return res.status(404).json({ message: "Subscription not found" });
      }
      
      // Check if already cancelled
      if (subscription.status === 'cancelled') {
        return res.status(400).json({ message: "Subscription is already cancelled" });
      }
      
      const cancelled = await storage.cancelSubscription(subscriptionId);
      res.json(cancelled);
    } catch (error: any) {
      console.error("Error cancelling subscription:", error);
      res.status(500).json({ message: "Error cancelling subscription: " + error.message });
    }
  });

  // Get subscription items
  app.get("/api/my-subscriptions/:id/items", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const subscriptionId = req.params.id;
      
      // Verify subscription belongs to user
      const subscription = await storage.getSubscription(subscriptionId);
      if (!subscription || subscription.userId !== userId) {
        return res.status(404).json({ message: "Subscription not found" });
      }
      
      const items = await storage.getSubscriptionItems(subscriptionId);
      res.json(items);
    } catch (error: any) {
      console.error("Error fetching subscription items:", error);
      res.status(500).json({ message: "Error fetching subscription items: " + error.message });
    }
  });

  // Add product to subscription
  app.post("/api/my-subscriptions/:id/items", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const subscriptionId = req.params.id;
      
      // Verify subscription belongs to user
      const subscription = await storage.getSubscription(subscriptionId);
      if (!subscription || subscription.userId !== userId) {
        return res.status(404).json({ message: "Subscription not found" });
      }
      
      const itemSchema = z.object({
        productId: z.string().uuid(),
        quantity: z.number().int().positive().default(1),
      });
      
      const validated = itemSchema.parse(req.body);
      const item = await storage.addSubscriptionItem({
        subscriptionId,
        ...validated,
      });
      
      res.json(item);
    } catch (error: any) {
      console.error("Error adding subscription item:", error);
      res.status(400).json({ message: "Error adding subscription item: " + error.message });
    }
  });

  // Remove product from subscription
  app.delete("/api/my-subscriptions/:id/items/:itemId", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const subscriptionId = req.params.id;
      const itemId = req.params.itemId;
      
      // Verify subscription belongs to user
      const subscription = await storage.getSubscription(subscriptionId);
      if (!subscription || subscription.userId !== userId) {
        return res.status(404).json({ message: "Subscription not found" });
      }
      
      // Remove item (atomic validation happens in storage layer)
      await storage.removeSubscriptionItem(itemId, subscriptionId);
      res.json({ message: "Item removed successfully" });
    } catch (error: any) {
      console.error("Error removing subscription item:", error);
      res.status(400).json({ message: error.message || "Error removing subscription item" });
    }
  });

  // Update subscription item quantity
  app.patch("/api/my-subscriptions/:id/items/:itemId", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const subscriptionId = req.params.id;
      const itemId = req.params.itemId;
      
      // Verify subscription belongs to user
      const subscription = await storage.getSubscription(subscriptionId);
      if (!subscription || subscription.userId !== userId) {
        return res.status(404).json({ message: "Subscription not found" });
      }
      
      const quantitySchema = z.object({
        quantity: z.number().int().positive(),
      });
      
      const validated = quantitySchema.parse(req.body);
      const updated = await storage.updateSubscriptionItemQuantity(itemId, validated.quantity);
      
      res.json(updated);
    } catch (error: any) {
      console.error("Error updating subscription item:", error);
      res.status(400).json({ message: "Error updating subscription item: " + error.message });
    }
  });

  // Wholesale customer routes (admin-only access)
  app.get("/api/wholesale/customers", isAuthenticated, isStaffOrAdmin, async (req, res) => {
    try {
      const customers = await storage.getWholesaleCustomers();
      res.json(customers);
    } catch (error: any) {
      res.status(500).json({ message: "Error fetching customers: " + error.message });
    }
  });

  app.get("/api/wholesale/customers/:id", isAuthenticated, isAdmin, async (req, res) => {
    try {
      const customer = await storage.getWholesaleCustomer(req.params.id);
      if (!customer) {
        return res.status(404).json({ message: "Customer not found" });
      }
      res.json(customer);
    } catch (error: any) {
      res.status(500).json({ message: "Error fetching customer: " + error.message });
    }
  });

  app.post("/api/wholesale/customers", isAuthenticated, isAdmin, async (req, res) => {
    try {
      const customer = insertWholesaleCustomerSchema.parse(req.body);
      const created = await storage.createWholesaleCustomer(customer);
      res.json(created);
    } catch (error: any) {
      res.status(400).json({ message: "Error creating customer: " + error.message });
    }
  });

  app.patch("/api/wholesale/customers/:id", isAuthenticated, isAdmin, async (req, res) => {
    try {
      const updates = insertWholesaleCustomerSchema.partial().parse(req.body);
      const updated = await storage.updateWholesaleCustomer(req.params.id, updates);
      if (!updated) {
        return res.status(404).json({ message: "Customer not found" });
      }
      res.json(updated);
    } catch (error: any) {
      res.status(400).json({ message: "Error updating customer: " + error.message });
    }
  });

  // Retail customer routes (staff and admin access)
  app.get("/api/retail/customers", isAuthenticated, isStaffOrAdmin, async (req, res) => {
    try {
      const searchQuery = typeof req.query.search === 'string' ? req.query.search : undefined;
      const customers = await storage.getRetailCustomers(searchQuery);
      res.json(customers);
    } catch (error: any) {
      console.error("Error fetching retail customers:", error);
      res.status(500).json({ message: "Error fetching retail customers: " + error.message });
    }
  });

  // Backfill Stripe customer IDs for existing users (super admin only)
  app.post("/api/admin/backfill-stripe-customers", isAuthenticated, isSuperAdmin, async (req: any, res) => {
    try {
      const dryRun = req.body?.dryRun === true;
      const actor = req.user?.username || 'unknown';
      
      console.log(`[Stripe Backfill] Starting backfill process (actor: ${actor}, dryRun: ${dryRun}, timestamp: ${new Date().toISOString()})...`);
      
      // Get all users without Stripe customer IDs
      const usersWithoutStripe = await storage.getUsersWithoutStripeId();
      
      console.log(`[Stripe Backfill] Found ${usersWithoutStripe.length} users without Stripe customer IDs`);
      
      // Dry run mode - return projected user list without invoking Stripe
      if (dryRun) {
        const userList = usersWithoutStripe.map(u => ({
          userId: u.id,
          username: u.username,
          email: u.email,
          role: u.role,
        }));
        
        console.log(`[Stripe Backfill] Dry run complete - ${userList.length} users would be processed`);
        return res.json({
          dryRun: true,
          message: `Dry run: ${userList.length} users would be processed`,
          total: userList.length,
          users: userList,
        });
      }
      
      const results = {
        total: usersWithoutStripe.length,
        successful: 0,
        failed: 0,
        errors: [] as { userId: string; username: string; error: string }[],
      };
      
      // Process each user
      for (const user of usersWithoutStripe) {
        try {
          console.log(`[Stripe Backfill] Processing user ${user.username} (${user.id})...`);
          
          // Determine name based on role
          let firstName = user.username;
          let lastName: string | undefined = undefined;
          
          // For wholesale customers, try to get business name
          if (user.role === 'wholesale_customer') {
            const wholesaleCustomer = await storage.getWholesaleCustomerByUserId(user.id);
            if (wholesaleCustomer?.contactName) {
              const nameParts = wholesaleCustomer.contactName.split(' ');
              firstName = nameParts[0];
              lastName = nameParts.slice(1).join(' ') || undefined;
            }
          }
          
          // Create Stripe customer
          const stripeCustomerId = await createStripeCustomer({
            userId: user.id,
            email: user.email,
            phoneNumber: user.phoneNumber,
            firstName,
            lastName,
            username: user.username,
          });
          
          if (stripeCustomerId) {
            results.successful++;
            console.log(`[Stripe Backfill] ✓ Created Stripe customer for ${user.username}: ${stripeCustomerId}`);
          } else {
            results.failed++;
            results.errors.push({
              userId: user.id,
              username: user.username,
              error: "Stripe customer creation returned null",
            });
            console.log(`[Stripe Backfill] ✗ Failed to create Stripe customer for ${user.username}`);
          }
        } catch (error: any) {
          results.failed++;
          results.errors.push({
            userId: user.id,
            username: user.username,
            error: error.message || "Unknown error",
          });
          console.error(`[Stripe Backfill] ✗ Error creating Stripe customer for ${user.username}:`, error);
        }
      }
      
      console.log(`[Stripe Backfill] Complete: ${results.successful} successful, ${results.failed} failed`);
      
      res.json({
        message: `Backfill complete: ${results.successful} successful, ${results.failed} failed`,
        ...results,
      });
    } catch (error: any) {
      console.error("[Stripe Backfill] Error during backfill:", error);
      res.status(500).json({ message: "Error during backfill: " + error.message });
    }
  });

  // Wholesale order routes (staff and admin access)
  app.get("/api/wholesale/orders", isAuthenticated, isStaffOrAdmin, async (req, res) => {
    try {
      const orders = await storage.getWholesaleOrders();
      res.json(orders);
    } catch (error: any) {
      res.status(500).json({ message: "Error fetching orders: " + error.message });
    }
  });

  app.get("/api/wholesale/orders/:id", isAuthenticated, isStaffOrAdmin, async (req, res) => {
    try {
      const order = await storage.getWholesaleOrder(req.params.id);
      if (!order) {
        return res.status(404).json({ message: "Order not found" });
      }
      res.json(order);
    } catch (error: any) {
      res.status(500).json({ message: "Error fetching order: " + error.message });
    }
  });

  app.get("/api/wholesale/delivery-report", isAuthenticated, isStaffOrAdmin, async (req, res) => {
    try {
      const { date } = req.query;
      if (!date || typeof date !== 'string') {
        return res.status(400).json({ message: "Date parameter is required" });
      }

      const deliveryDate = new Date(date);
      if (isNaN(deliveryDate.getTime())) {
        return res.status(400).json({ message: "Invalid date format" });
      }

      const orders = await storage.getWholesaleOrdersByDeliveryDate(deliveryDate);
      res.json(orders);
    } catch (error: any) {
      res.status(500).json({ message: "Error fetching delivery report: " + error.message });
    }
  });

  app.get("/api/retail/pickup-report", isAuthenticated, isStaffOrAdmin, async (req, res) => {
    try {
      const { date } = req.query;
      if (!date || typeof date !== 'string') {
        return res.status(400).json({ message: "Date parameter is required" });
      }

      // Parse YYYY-MM-DD format consistently in UTC to avoid timezone issues
      const dateMatch = date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
      if (!dateMatch) {
        return res.status(400).json({ message: "Invalid date format. Expected YYYY-MM-DD" });
      }

      const [, year, month, day] = dateMatch;
      const pickupDate = new Date(Date.UTC(parseInt(year), parseInt(month) - 1, parseInt(day)));

      const subscriptions = await storage.getSubscriptionsByPickupDate(pickupDate);
      res.json(subscriptions);
    } catch (error: any) {
      res.status(500).json({ message: "Error fetching pickup report: " + error.message });
    }
  });

  app.post("/api/wholesale/orders", isAuthenticated, isStaffOrAdmin, async (req, res) => {
    try {
      const { order, items } = req.body;
      
      if (!items || !Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ message: "Order must contain at least one item" });
      }
      
      if (!order.customerId) {
        return res.status(400).json({ message: "Customer ID is required" });
      }
      
      let serverCalculatedTotal = 0;
      const validatedItems = [];
      
      for (const item of items) {
        if (!item.productId || !item.quantity || item.quantity <= 0) {
          return res.status(400).json({ message: "Invalid item data" });
        }
        
        const product = await storage.getProduct(item.productId);
        if (!product) {
          return res.status(404).json({ message: `Product ${item.productId} not found` });
        }
        
        const customPricing = await storage.getWholesalePrice(order.customerId, item.productId);
        const perBottlePrice = customPricing ? Number(customPricing.customPrice) : Number(product.wholesalePrice);
        const perCasePrice = perBottlePrice * CASE_SIZE;
        const itemTotal = perCasePrice * item.quantity;
        serverCalculatedTotal += itemTotal;
        
        validatedItems.push({
          productId: item.productId,
          quantity: item.quantity,
          unitPrice: perCasePrice.toFixed(2),
        });
      }
      
      const invoiceNumber = await storage.generateNextInvoiceNumber();
      
      const orderData = insertWholesaleOrderSchema.parse({
        ...order,
        invoiceNumber,
        totalAmount: serverCalculatedTotal.toFixed(2),
      });
      
      const createdOrder = await storage.createWholesaleOrder(orderData);
      
      for (const item of validatedItems) {
        await storage.createWholesaleOrderItem({
          orderId: createdOrder.id,
          productId: item.productId,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
        });
      }
      
      res.json(createdOrder);
    } catch (error: any) {
      console.error("Wholesale order creation error:", error);
      res.status(400).json({ message: "Error creating order: " + error.message });
    }
  });

  app.get("/api/wholesale/orders/:id/items", isAuthenticated, isStaffOrAdmin, async (req, res) => {
    try {
      const items = await storage.getWholesaleOrderItems(req.params.id);
      res.json(items);
    } catch (error: any) {
      res.status(500).json({ message: "Error fetching order items: " + error.message });
    }
  });

  app.get("/api/wholesale/orders/:id/invoice", isAuthenticated, isStaffOrAdmin, async (req, res) => {
    try {
      const orderDetails = await storage.getWholesaleOrderWithDetails(req.params.id);
      if (!orderDetails) {
        return res.status(404).json({ message: "Order not found" });
      }
      res.json(orderDetails);
    } catch (error: any) {
      res.status(500).json({ message: "Error fetching invoice: " + error.message });
    }
  });

  app.post("/api/wholesale/orders/:id/send-invoice", isAuthenticated, isStaffOrAdmin, async (req, res) => {
    try {
      const orderDetails = await storage.getWholesaleOrderWithDetails(req.params.id);
      if (!orderDetails) {
        return res.status(404).json({ message: "Order not found" });
      }

      res.status(501).json({ 
        message: "Email sending not configured. Please set up Gmail API credentials to enable invoice emails.",
        instructions: "Add GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, and GMAIL_REFRESH_TOKEN to environment secrets."
      });
    } catch (error: any) {
      res.status(500).json({ message: "Error sending invoice: " + error.message });
    }
  });

  app.patch("/api/wholesale/orders/:id", isAuthenticated, isStaffOrAdmin, async (req, res) => {
    try {
      const { status, deliveryDate } = req.body;
      
      const order = await storage.getWholesaleOrder(req.params.id);
      if (!order) {
        return res.status(404).json({ message: "Order not found" });
      }

      let updated = order;

      if (status) {
        if (!['pending', 'processing', 'shipped', 'delivered'].includes(status)) {
          return res.status(400).json({ message: "Invalid status" });
        }
        updated = await storage.updateWholesaleOrderStatus(req.params.id, status);
      }

      if (deliveryDate !== undefined) {
        const dateValue = deliveryDate ? new Date(deliveryDate) : null;
        updated = await storage.updateWholesaleOrderDeliveryDate(req.params.id, dateValue) || updated;
      }

      res.json(updated);
    } catch (error: any) {
      res.status(500).json({ message: "Error updating order: " + error.message });
    }
  });

  app.get("/api/wholesale/pricing/:customerId", isAuthenticated, isStaffOrAdmin, async (req, res) => {
    try {
      const pricing = await storage.getWholesalePricing(req.params.customerId);
      res.json(pricing);
    } catch (error: any) {
      res.status(500).json({ message: "Error fetching pricing: " + error.message });
    }
  });

  app.post("/api/wholesale/pricing", isAuthenticated, isAdmin, async (req, res) => {
    try {
      const { customerId, productId, customPrice } = req.body;
      
      if (!customerId || !productId || !customPrice) {
        return res.status(400).json({ message: "customerId, productId, and customPrice are required" });
      }

      const pricing = await storage.setWholesalePrice({
        customerId,
        productId,
        customPrice: customPrice.toString(),
      });
      res.json(pricing);
    } catch (error: any) {
      res.status(400).json({ message: "Error setting pricing: " + error.message });
    }
  });

  // Create Stripe checkout session for wholesale invoice payment
  app.post("/api/wholesale/orders/:id/create-payment", async (req, res) => {
    try {
      if (!stripe) {
        return res.status(503).json({ message: "Payment processing is not configured" });
      }

      const orderDetails = await storage.getWholesaleOrderWithDetails(req.params.id);
      if (!orderDetails) {
        return res.status(404).json({ message: "Order not found" });
      }

      const { order, customer } = orderDetails;

      // Check if customer has online payment enabled
      if (!customer.allowOnlinePayment) {
        return res.status(403).json({ message: "Online payment not enabled for this customer" });
      }

      const baseUrl = process.env.REPL_SLUG 
        ? `https://${process.env.REPL_SLUG}.${process.env.REPL_OWNER}.repl.co`
        : 'http://localhost:5000';

      // Create line items from order items
      const lineItems = orderDetails.items.map(item => ({
        price_data: {
          currency: 'usd',
          product_data: {
            name: item.product.name,
          },
          unit_amount: Math.round(parseFloat(item.unitPrice) * 100),
        },
        quantity: item.quantity,
      }));

      const session = await stripe.checkout.sessions.create({
        mode: 'payment',
        line_items: lineItems,
        customer_email: customer.email,
        metadata: {
          orderId: order.id,
          invoiceNumber: order.invoiceNumber,
          type: 'wholesale_invoice_payment',
        },
        success_url: `${baseUrl}/wholesale/invoice/${order.id}/payment-success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${baseUrl}/wholesale/invoice/${order.id}`,
      });

      res.json({ url: session.url, sessionId: session.id });
    } catch (error: any) {
      console.error("Wholesale payment checkout error:", error);
      res.status(500).json({ message: "Error creating checkout: " + error.message });
    }
  });

  // Cart routes
  app.get("/api/cart", async (req, res) => {
    try {
      const sessionId = req.sessionID || "guest";
      const items = await storage.getCartItems(sessionId);
      
      const itemsWithProducts = await Promise.all(
        items.map(async (item) => {
          const product = await storage.getProduct(item.productId);
          return {
            ...item,
            product: product ? {
              id: product.id,
              name: product.name,
              retailPrice: product.retailPrice,
              imageUrl: product.imageUrl,
            } : null,
          };
        })
      );
      
      res.json(itemsWithProducts.filter(item => item.product !== null));
    } catch (error: any) {
      res.status(500).json({ message: "Error fetching cart: " + error.message });
    }
  });

  app.post("/api/cart", async (req, res) => {
    try {
      const sessionId = req.sessionID || "guest";
      const { productId, quantity, isSubscription, subscriptionFrequency } = req.body;
      
      const cartItem = await storage.addToCart({
        sessionId,
        productId,
        quantity: quantity || 1,
        isSubscription: isSubscription || false,
        subscriptionFrequency: isSubscription ? subscriptionFrequency : null,
      });
      
      res.json(cartItem);
    } catch (error: any) {
      res.status(400).json({ message: "Error adding to cart: " + error.message });
    }
  });

  app.patch("/api/cart/:id", async (req, res) => {
    try {
      const { quantity } = req.body;
      const parsedQuantity = Number(quantity);
      
      if (!Number.isFinite(parsedQuantity) || parsedQuantity < 1) {
        return res.status(400).json({ message: "Invalid quantity" });
      }
      
      const updated = await storage.updateCartItemQuantity(req.params.id, parsedQuantity);
      res.json(updated);
    } catch (error: any) {
      res.status(500).json({ message: "Error updating cart item: " + error.message });
    }
  });

  app.delete("/api/cart/:id", async (req, res) => {
    try {
      await storage.removeFromCart(req.params.id);
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ message: "Error removing from cart: " + error.message });
    }
  });

  // Inventory management routes
  app.get("/api/inventory/low-stock", async (req, res) => {
    try {
      const lowStockProducts = await storage.getLowStockProducts();
      res.json(lowStockProducts);
    } catch (error: any) {
      res.status(500).json({ message: "Error fetching low stock products: " + error.message });
    }
  });

  app.patch("/api/inventory/:id", async (req, res) => {
    try {
      const { stockQuantity } = req.body;
      const parsedStock = Number(stockQuantity);
      
      if (!Number.isFinite(parsedStock) || parsedStock < 0) {
        return res.status(400).json({ message: "Invalid stock quantity" });
      }
      
      const product = await storage.updateProductStock(req.params.id, parsedStock);
      if (!product) {
        return res.status(404).json({ message: "Product not found" });
      }
      
      res.json(product);
    } catch (error: any) {
      res.status(500).json({ message: "Error updating stock: " + error.message });
    }
  });

  // Staff portal routes
  // Update wholesale order status
  app.patch("/api/staff/orders/:id/status", isAuthenticated, isStaffOrAdmin, async (req, res) => {
    try {
      const statusSchema = z.object({
        status: z.enum(['pending', 'processing', 'shipped', 'delivered']),
      });
      
      const parsed = statusSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid status value" });
      }
      
      const order = await storage.updateWholesaleOrderStatus(req.params.id, parsed.data.status);
      if (!order) {
        return res.status(404).json({ message: "Order not found" });
      }
      
      res.json(order);
    } catch (error: any) {
      console.error("Error updating order status:", error);
      res.status(500).json({ message: "Failed to update order status" });
    }
  });

  // Update product details (admin can update all fields, staff can only update stock)
  app.patch("/api/staff/products/:id", isAuthenticated, isStaffOrAdmin, async (req, res) => {
    try {
      if (!req.user) {
        return res.status(401).json({ message: "Unauthorized" });
      }

      const isStaff = req.user.role === 'staff';
      
      if (isStaff) {
        const staffUpdateSchema = z.object({
          stockQuantity: z.number().int().nonnegative().optional(),
          lowStockThreshold: z.number().int().nonnegative().optional(),
        });
        
        const parsed = staffUpdateSchema.safeParse(req.body);
        if (!parsed.success) {
          return res.status(400).json({ 
            message: "Invalid product data", 
            errors: parsed.error.errors 
          });
        }
        
        const updates: any = {};
        if (parsed.data.stockQuantity !== undefined) {
          updates.stockQuantity = parsed.data.stockQuantity;
          updates.inStock = parsed.data.stockQuantity > 0;
        }
        if (parsed.data.lowStockThreshold !== undefined) {
          updates.lowStockThreshold = parsed.data.lowStockThreshold;
        }
        
        const product = await storage.updateProduct(req.params.id, updates);
        if (!product) {
          return res.status(404).json({ message: "Product not found" });
        }
        
        res.json(product);
      } else {
        const adminUpdateSchema = z.object({
          name: z.string().optional(),
          description: z.string().optional(),
          flavor: z.string().optional(),
          abv: z.string().optional(),
          ingredients: z.array(z.string()).optional(),
          retailPrice: z.number().positive().optional(),
          wholesalePrice: z.number().positive().optional(),
          stockQuantity: z.number().int().nonnegative().optional(),
          lowStockThreshold: z.number().int().nonnegative().optional(),
        });
        
        const parsed = adminUpdateSchema.safeParse(req.body);
        if (!parsed.success) {
          return res.status(400).json({ 
            message: "Invalid product data", 
            errors: parsed.error.errors 
          });
        }
        
        const updates: any = {};
        if (parsed.data.name !== undefined) updates.name = parsed.data.name;
        if (parsed.data.description !== undefined) updates.description = parsed.data.description;
        if (parsed.data.flavor !== undefined) updates.flavor = parsed.data.flavor;
        if (parsed.data.abv !== undefined) updates.abv = parsed.data.abv;
        if (parsed.data.ingredients !== undefined) updates.ingredients = parsed.data.ingredients;
        if (parsed.data.retailPrice !== undefined) updates.retailPrice = String(parsed.data.retailPrice);
        if (parsed.data.wholesalePrice !== undefined) updates.wholesalePrice = String(parsed.data.wholesalePrice);
        if (parsed.data.stockQuantity !== undefined) {
          updates.stockQuantity = parsed.data.stockQuantity;
          updates.inStock = parsed.data.stockQuantity > 0;
        }
        if (parsed.data.lowStockThreshold !== undefined) {
          updates.lowStockThreshold = parsed.data.lowStockThreshold;
        }
        
        const product = await storage.updateProduct(req.params.id, updates);
        if (!product) {
          return res.status(404).json({ message: "Product not found" });
        }
        
        res.json(product);
      }
    } catch (error: any) {
      console.error("Error updating product:", error);
      res.status(500).json({ message: "Failed to update product" });
    }
  });

  // Get all users (super admin only)
  app.get("/api/staff/users", isAuthenticated, isSuperAdmin, async (req, res) => {
    try {
      const users = await storage.getAllUsers();
      res.json(users);
    } catch (error: any) {
      console.error("Error fetching users:", error);
      res.status(500).json({ message: "Failed to fetch users" });
    }
  });

  // Update user role (super admin only)
  app.patch("/api/staff/users/:id/role", isAuthenticated, isSuperAdmin, async (req, res) => {
    try {
      const roleSchema = z.object({
        role: z.enum(['user', 'staff', 'admin', 'super_admin']),
      });
      
      const parsed = roleSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid role value" });
      }
      
      // Prevent super admins from demoting themselves
      if (!req.user) {
        return res.status(401).json({ message: "Unauthorized" });
      }
      
      const currentUserId = req.user.id;
      if (req.params.id === currentUserId) {
        return res.status(403).json({ message: "You cannot change your own role" });
      }
      
      const user = await storage.updateUserRole(req.params.id, parsed.data.role);
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }
      
      res.json(user);
    } catch (error: any) {
      console.error("Error updating user role:", error);
      res.status(500).json({ message: "Failed to update user role" });
    }
  });

  const httpServer = createServer(app);

  return httpServer;
}
