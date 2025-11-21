import type { Express } from "express";
import { createServer, type Server } from "http";
import Stripe from "stripe";
import { storage } from "./storage";
import { insertSubscriptionSchema, insertWholesaleCustomerSchema, insertWholesaleOrderSchema, insertProductSchema, insertWholesalePricingSchema, insertProductTypeSchema, retailOrders, retailCheckoutSessions, products, retailOrderItems, retailOrderItemsV2, inventoryAdjustments, subscriptions, Subscription, updateProfileSchema, users, insertFlavorSchema, insertRetailProductSchema, insertWholesaleUnitTypeSchema, retailProducts, retailSubscriptions, retailSubscriptionItems, flavors } from "@shared/schema";
import { eq, sql, and } from "drizzle-orm";
import { db } from "./db";
import { Pool } from "@neondatabase/serverless";
import { toZonedTime, fromZonedTime, formatInTimeZone } from "date-fns-tz";
import { addDays, addHours, parseISO, format, differenceInCalendarDays } from "date-fns";
import { setupAuth, isAuthenticated } from "./auth";
import { z } from "zod";
import { sendEmailVerificationCode, sendContactFormNotification } from "./email";
import { getCasePriceCents, CASE_SIZE } from "@shared/pricing";
import { ObjectStorageService, ObjectNotFoundError } from "./objectStorage";
import { getObjectAclPolicy } from "./objectAcl";
import { createStripeCustomer } from "./stripeCustomer";
import { normalizeToAllowedPickupDay, isAllowedPickupDay, PICKUP_POLICY } from "@shared/pickup-policy";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const stripe = process.env.STRIPE_SECRET_KEY 
  ? new Stripe(process.env.STRIPE_SECRET_KEY, {
      apiVersion: "2025-10-29.clover",
    })
  : null;

async function getProductPricing(productId: string): Promise<{ retailPrice: string; wholesalePrice: string } | null> {
  const product = await storage.getProduct(productId);
  if (!product) return null;
  
  // Get the product type to access pricing
  const productTypes = await storage.getProductTypes();
  const productType = productTypes.find(pt => pt.id === product.productTypeId);
  if (!productType) return null;
  
  return {
    retailPrice: productType.retailPrice,
    wholesalePrice: productType.wholesalePrice,
  };
}

export async function registerRoutes(app: Express): Promise<Server> {
  // Auth middleware - sets up /api/register, /api/login, /api/logout, /api/user
  await setupAuth(app);

  // Admin middleware - checks if user is an admin
  const isAdmin = async (req: any, res: any, next: any) => {
    try {
      const effectiveUser = req.originalUser || req.user;
      
      if (!effectiveUser) {
        return res.status(401).json({ message: "Unauthorized - please log in" });
      }
      
      if (!['admin', 'super_admin'].includes(effectiveUser.role)) {
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
      const effectiveUser = req.originalUser || req.user;
      
      if (!effectiveUser) {
        return res.status(401).json({ message: "Unauthorized - please log in" });
      }
      
      if (effectiveUser.role !== 'super_admin') {
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
      const effectiveUser = req.originalUser || req.user;
      
      if (!effectiveUser) {
        return res.status(401).json({ message: "Unauthorized - please log in" });
      }
      
      if (!['staff', 'admin', 'super_admin'].includes(effectiveUser.role)) {
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

  // Contact form submission
  app.post("/api/contact", async (req, res) => {
    try {
      const contactFormSchema = z.object({
        name: z.string().min(2, "Name must be at least 2 characters"),
        email: z.string().email("Please enter a valid email"),
        phone: z.string().optional(),
        company: z.string().optional(),
        message: z.string().min(10, "Message must be at least 10 characters"),
      });

      const validatedData = contactFormSchema.parse(req.body);

      // Get all staff member emails (staff, admin, super_admin)
      const staffUsers = await db
        .select({ email: users.email })
        .from(users)
        .where(
          sql`${users.role} IN ('staff', 'admin', 'super_admin') AND ${users.email} IS NOT NULL`
        );

      const staffEmails = staffUsers
        .map(u => u.email)
        .filter((email): email is string => email !== null);

      // Send notification to staff
      if (staffEmails.length > 0) {
        await sendContactFormNotification({
          staffEmails,
          contactName: validatedData.name,
          contactEmail: validatedData.email,
          contactPhone: validatedData.phone,
          contactCompany: validatedData.company,
          message: validatedData.message,
        });
      }

      res.json({ 
        success: true, 
        message: "Your message has been sent successfully" 
      });
    } catch (error: any) {
      console.error("Error processing contact form:", error);
      
      if (error instanceof z.ZodError) {
        return res.status(400).json({ 
          message: "Invalid form data", 
          errors: error.errors 
        });
      }
      
      res.status(500).json({ 
        message: "Error processing contact form: " + error.message 
      });
    }
  });

  // Check if email already has an account
  app.post("/api/check-email", async (req, res) => {
    try {
      const { email } = req.body;
      
      if (!email) {
        return res.status(400).json({ message: "Email is required" });
      }

      // Validate email format
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email)) {
        return res.status(400).json({ message: "Invalid email address" });
      }

      // Check if user exists with this email
      const user = await storage.getUserByEmail(email);
      
      res.json({ exists: !!user });
    } catch (error: any) {
      console.error("Error checking email:", error);
      res.status(500).json({ message: "Error checking email: " + error.message });
    }
  });

  // Email verification routes
  app.post("/api/send-email-verification-code", async (req, res) => {
    try {
      const { email } = req.body;
      
      if (!email) {
        return res.status(400).json({ message: "Email is required" });
      }

      // Validate email format
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email)) {
        return res.status(400).json({ message: "Invalid email address" });
      }

      // Check if user exists with this email
      const user = await storage.getUserByEmailOrUsername(email);
      if (!user) {
        return res.status(400).json({ message: "No account found with this email" });
      }

      // Generate 6-digit code
      const code = Math.floor(100000 + Math.random() * 900000).toString();
      
      // Store code in database with 5-minute expiration
      const expiresAt = new Date(Date.now() + 5 * 60 * 1000);
      await storage.createEmailVerificationCode({
        email,
        code,
        expiresAt,
        verified: false,
        purpose: 'login'
      });

      // Try to send email, but don't fail if it doesn't work (e.g., in test environment)
      try {
        await sendEmailVerificationCode({ email, code });
        console.log(`[EMAIL] Verification code sent to ${email}`);
      } catch (emailError: any) {
        console.warn(`[EMAIL] Failed to send verification email to ${email}:`, emailError.message);
        console.log(`[EMAIL] Verification code for ${email} stored in database: ${code}`);
      }

      res.json({ message: "Verification code sent to your email" });
    } catch (error: any) {
      console.error("Error sending email verification code:", error);
      res.status(500).json({ message: "Error sending verification code: " + error.message });
    }
  });

  app.post("/api/verify-email-code", async (req, res) => {
    try {
      const { email, code } = req.body;
      
      if (!email || !code) {
        return res.status(400).json({ message: "Email and code are required" });
      }

      // Get latest verification code for this email
      const verificationCode = await storage.getLatestEmailVerificationCode(email);
      
      if (!verificationCode) {
        return res.status(400).json({ message: "No verification code found" });
      }

      // Check if code is expired
      if (new Date() > verificationCode.expiresAt) {
        return res.status(400).json({ message: "Verification code has expired" });
      }

      // Check if code matches
      if (verificationCode.code !== code) {
        // Increment attempts
        await storage.incrementEmailVerificationAttempts(verificationCode.id);
        return res.status(400).json({ message: "Invalid verification code" });
      }

      // Check if already verified
      if (verificationCode.verified) {
        return res.status(400).json({ message: "Verification code already used" });
      }

      // Mark as verified
      await storage.markEmailVerificationCodeAsVerified(verificationCode.id);

      // Get user to log them in
      const user = await storage.getUserByEmailOrUsername(email);
      if (!user) {
        return res.status(400).json({ message: "User not found" });
      }

      // Log the user in
      req.login(user, (err) => {
        if (err) {
          console.error("Login error:", err);
          return res.status(500).json({ message: "Error logging in" });
        }
        res.json({ message: "Email verified and logged in successfully", user });
      });
    } catch (error: any) {
      console.error("Error verifying email code:", error);
      res.status(500).json({ message: "Error verifying code: " + error.message });
    }
  });

  // Wholesale-specific email authentication
  app.post("/api/wholesale/send-email-code", async (req, res) => {
    try {
      const { email } = req.body;
      
      if (!email) {
        return res.status(400).json({ message: "Email is required" });
      }

      // Validate email format
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email)) {
        return res.status(400).json({ message: "Invalid email address" });
      }

      // SECURITY: Check if this email belongs to a wholesale customer
      const wholesaleCustomer = await storage.getWholesaleCustomerByAnyEmail(email);
      if (!wholesaleCustomer) {
        return res.status(400).json({ message: "No wholesale account found with this email" });
      }

      // Generate 6-digit code
      const code = Math.floor(100000 + Math.random() * 900000).toString();
      
      // SECURITY: Store code with wholesale customer ID binding to prevent code reuse across accounts
      const expiresAt = new Date(Date.now() + 5 * 60 * 1000);
      await storage.createEmailVerificationCode({
        email,
        code,
        expiresAt,
        verified: false,
        purpose: 'login',
        wholesaleCustomerId: wholesaleCustomer.id // Bind code to specific wholesale customer
      });

      // Try to send email
      try {
        await sendEmailVerificationCode({ email, code });
        console.log(`[WHOLESALE AUTH] Verification code sent to ${email} for customer ${wholesaleCustomer.id}`);
      } catch (emailError: any) {
        console.warn(`[WHOLESALE AUTH] Failed to send verification email to ${email}:`, emailError.message);
        console.log(`[WHOLESALE AUTH] Verification code for ${email} (customer ${wholesaleCustomer.id}) stored in database: ${code}`);
      }

      res.json({ message: "Verification code sent to your email" });
    } catch (error: any) {
      console.error("Error sending wholesale email verification code:", error);
      res.status(500).json({ message: "Error sending verification code: " + error.message });
    }
  });

  app.post("/api/wholesale/verify-email-code", async (req, res) => {
    try {
      const { email, code } = req.body;
      
      if (!email || !code) {
        return res.status(400).json({ message: "Email and code are required" });
      }

      // SECURITY: First verify the email belongs to a wholesale customer BEFORE checking code
      const wholesaleCustomer = await storage.getWholesaleCustomerByAnyEmail(email);
      if (!wholesaleCustomer) {
        return res.status(400).json({ message: "No wholesale account found with this email" });
      }

      // Get latest verification code for this email
      const verificationCode = await storage.getLatestEmailVerificationCode(email);
      
      if (!verificationCode) {
        return res.status(400).json({ message: "No verification code found" });
      }

      // SECURITY: Verify the code is bound to the correct wholesale customer
      // This prevents code reuse if emails are reassigned between customers
      if (verificationCode.wholesaleCustomerId !== wholesaleCustomer.id) {
        console.error(`[WHOLESALE AUTH] Code mismatch: code bound to ${verificationCode.wholesaleCustomerId}, but email ${email} belongs to ${wholesaleCustomer.id}`);
        return res.status(400).json({ message: "Invalid verification code" });
      }

      // Check if code is expired
      if (new Date() > verificationCode.expiresAt) {
        return res.status(400).json({ message: "Verification code has expired" });
      }

      // Check if code matches
      if (verificationCode.code !== code) {
        // Increment attempts
        await storage.incrementEmailVerificationAttempts(verificationCode.id);
        return res.status(400).json({ message: "Invalid verification code" });
      }

      // Check if already verified
      if (verificationCode.verified) {
        return res.status(400).json({ message: "Verification code already used" });
      }

      // Mark as verified
      await storage.markEmailVerificationCodeAsVerified(verificationCode.id);

      // Get or create user account for this wholesale customer
      let user = wholesaleCustomer.userId ? await storage.getUser(wholesaleCustomer.userId) : undefined;
      
      if (!user) {
        // SECURITY: Use the wholesale customer's PRIMARY email for the user account, not the login email
        // This ensures consistency and prevents email confusion
        const username = wholesaleCustomer.email.split('@')[0] + '-' + wholesaleCustomer.id.substring(0, 8);
        user = await storage.createUser({
          username,
          email: wholesaleCustomer.email, // Use primary email from customer record
          firstName: wholesaleCustomer.contactName.split(' ')[0],
          lastName: wholesaleCustomer.contactName.split(' ').slice(1).join(' ') || undefined,
        });

        // Set the role to wholesale_customer
        user = await storage.updateUserRole(user.id, 'wholesale_customer') || user;

        // Link the user to the wholesale customer
        await storage.updateWholesaleCustomer(wholesaleCustomer.id, {
          userId: user.id
        });
        
        console.log(`[WHOLESALE AUTH] Created user account ${user.id} for wholesale customer ${wholesaleCustomer.id}`);
      }

      // Log the user in
      req.login(user, (err) => {
        if (err) {
          console.error("Wholesale login error:", err);
          return res.status(500).json({ message: "Error logging in" });
        }
        console.log(`[WHOLESALE AUTH] User ${user.id} logged in via email ${email} for customer ${wholesaleCustomer.id}`);
        res.json({ message: "Email verified and logged in successfully", user });
      });
    } catch (error: any) {
      console.error("Error verifying wholesale email code:", error);
      res.status(500).json({ message: "Error verifying code: " + error.message });
    }
  });

  // Update user profile
  app.patch("/api/update-profile", isAuthenticated, async (req, res) => {
    try {
      const user = req.user;
      if (!user) {
        return res.status(401).json({ message: "Unauthorized" });
      }

      // Validate request body
      const validationResult = updateProfileSchema.safeParse(req.body);
      if (!validationResult.success) {
        return res.status(400).json({ 
          message: "Validation failed", 
          errors: validationResult.error.errors 
        });
      }

      const updates = validationResult.data;

      // Check if email is already taken by another user
      if (updates.email && updates.email !== user.email) {
        const existingUser = await db
          .select()
          .from(users)
          .where(eq(users.email, updates.email))
          .limit(1);
        
        if (existingUser.length > 0 && existingUser[0].id !== user.id) {
          return res.status(400).json({ message: "Email is already in use" });
        }
      }

      // Update user profile
      const [updatedUser] = await db
        .update(users)
        .set({
          ...updates,
          updatedAt: new Date(),
        })
        .where(eq(users.id, user.id))
        .returning();

      // Remove sensitive fields before returning
      const { password, ...userWithoutPassword } = updatedUser;

      res.json({ 
        message: "Profile updated successfully", 
        user: userWithoutPassword 
      });
    } catch (error: any) {
      console.error("Error updating profile:", error);
      res.status(500).json({ message: "Error updating profile: " + error.message });
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

  // Wholesale customer endpoints - for customers to view their own information and orders
  app.get("/api/wholesale-customer", isAuthenticated, isWholesaleCustomer, async (req, res) => {
    try {
      if (!req.user) {
        return res.status(401).json({ message: "Not authenticated" });
      }
      
      // Get wholesale customer record for authenticated user
      const customer = await storage.getWholesaleCustomerByUserId(req.user.id);
      if (!customer) {
        return res.status(404).json({ message: "Wholesale customer record not found" });
      }

      res.json(customer);
    } catch (error: any) {
      res.status(500).json({ message: "Error fetching customer info: " + error.message });
    }
  });

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

  app.get("/api/wholesale/customer/pricing", isAuthenticated, isWholesaleCustomer, async (req, res) => {
    try {
      if (!req.user) {
        return res.status(401).json({ message: "Not authenticated" });
      }
      
      // Get wholesale customer record for authenticated user
      const customer = await storage.getWholesaleCustomerByUserId(req.user.id);
      if (!customer) {
        return res.status(404).json({ message: "Wholesale customer record not found" });
      }

      // Get custom pricing for this customer
      const pricing = await storage.getWholesalePricing(customer.id);
      res.json(pricing);
    } catch (error: any) {
      res.status(500).json({ message: "Error fetching pricing: " + error.message });
    }
  });

  app.post("/api/wholesale/customer/orders", isAuthenticated, isWholesaleCustomer, async (req, res) => {
    try {
      if (!req.user) {
        return res.status(401).json({ message: "Not authenticated" });
      }
      
      // Get wholesale customer record for authenticated user
      const customer = await storage.getWholesaleCustomerByUserId(req.user.id);
      if (!customer) {
        return res.status(404).json({ message: "Wholesale customer record not found" });
      }

      const { items, notes } = req.body;
      
      if (!items || !Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ message: "Order must contain at least one item" });
      }

      // Calculate prices for items and total
      let totalAmount = 0;
      const validatedItems = [];

      for (const item of items) {
        if (!item.unitTypeId || !item.flavorId || !item.quantity || item.quantity <= 0) {
          return res.status(400).json({ message: "Invalid item data: unitTypeId, flavorId, and quantity are required" });
        }

        const unitType = await storage.getWholesaleUnitType(item.unitTypeId);
        if (!unitType) {
          return res.status(400).json({ message: `Unit type ${item.unitTypeId} not found` });
        }

        // Verify flavor exists
        const allFlavors = await storage.getFlavors();
        const flavor = allFlavors.find(f => f.id === item.flavorId);
        if (!flavor) {
          return res.status(400).json({ message: `Flavor ${item.flavorId} not found` });
        }

        // Get custom pricing or default unit type price
        const customPrice = await storage.getWholesaleCustomerPrice(customer.id, item.unitTypeId);
        const unitPrice = customPrice ? Number(customPrice.customPrice) : Number(unitType.defaultPrice);
        const lineTotal = unitPrice * item.quantity;
        totalAmount += lineTotal;

        validatedItems.push({
          unitTypeId: item.unitTypeId,
          flavorId: item.flavorId,
          quantity: item.quantity,
          unitPrice: unitPrice.toFixed(2),
        });
      }

      // Generate invoice number
      const invoiceNumber = `WO-${Date.now()}`;

      // Create order for the logged-in customer
      const orderData = {
        customerId: customer.id,
        invoiceNumber,
        totalAmount: totalAmount.toFixed(2),
        notes: notes || undefined,
      };

      const createdOrder = await storage.createWholesaleOrder(orderData);
      
      for (const item of validatedItems) {
        await storage.createWholesaleOrderItem({
          orderId: createdOrder.id,
          unitTypeId: item.unitTypeId,
          flavorId: item.flavorId,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
        });
      }

      res.json(createdOrder);
    } catch (error: any) {
      console.error("Wholesale customer order creation error:", error);
      res.status(500).json({ message: "Error creating order: " + error.message });
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
      
      // Include pricing information from product_types
      const pricing = await getProductPricing(req.params.id);
      if (!pricing) {
        return res.status(404).json({ message: "Product pricing not found" });
      }
      
      res.json({
        ...product,
        retailPrice: pricing.retailPrice,
        wholesalePrice: pricing.wholesalePrice,
      });
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

  // NEW SCHEMA - Flavor management routes
  app.get("/api/flavors", async (req: any, res) => {
    try {
      const includeInactive = req.query.includeInactive === 'true';
      
      if (includeInactive && (!req.user || req.user.role !== 'admin')) {
        return res.status(403).json({ message: "Only admins can view inactive flavors" });
      }
      
      const flavors = await storage.getFlavors(includeInactive);
      res.json(flavors);
    } catch (error: any) {
      res.status(500).json({ message: "Error fetching flavors: " + error.message });
    }
  });

  app.get("/api/flavors/:id", async (req, res) => {
    try {
      const flavor = await storage.getFlavor(req.params.id);
      if (!flavor) {
        return res.status(404).json({ message: "Flavor not found" });
      }
      res.json(flavor);
    } catch (error: any) {
      res.status(500).json({ message: "Error fetching flavor: " + error.message });
    }
  });

  app.post("/api/flavors", isAdmin, async (req, res) => {
    try {
      const validatedData = insertFlavorSchema.parse(req.body);
      const flavor = await storage.createFlavor(validatedData);
      res.json(flavor);
    } catch (error: any) {
      if (error.name === 'ZodError') {
        return res.status(400).json({ message: "Validation error", errors: error.errors });
      }
      res.status(500).json({ message: "Error creating flavor: " + error.message });
    }
  });

  app.patch("/api/flavors/:id", isAdmin, async (req, res) => {
    try {
      const partialFlavorSchema = insertFlavorSchema.partial();
      const validatedUpdates = partialFlavorSchema.parse(req.body);
      const flavor = await storage.updateFlavor(req.params.id, validatedUpdates);
      if (!flavor) {
        return res.status(404).json({ message: "Flavor not found" });
      }
      res.json(flavor);
    } catch (error: any) {
      if (error.name === 'ZodError') {
        return res.status(400).json({ message: "Validation error", errors: error.errors });
      }
      res.status(500).json({ message: "Error updating flavor: " + error.message });
    }
  });

  app.delete("/api/flavors/:id", isAdmin, async (req, res) => {
    try {
      await storage.deleteFlavor(req.params.id);
      res.json({ message: "Flavor deleted successfully" });
    } catch (error: any) {
      res.status(500).json({ message: "Error deleting flavor: " + error.message });
    }
  });

  // NEW SCHEMA - Retail Product management routes
  app.get("/api/retail-products", async (req: any, res) => {
    try {
      const includeInactive = req.query.includeInactive === 'true';
      
      if (includeInactive && (!req.user || req.user.role !== 'admin')) {
        return res.status(403).json({ message: "Only admins can view inactive products" });
      }
      
      const products = await storage.getRetailProducts(includeInactive);
      res.json(products);
    } catch (error: any) {
      res.status(500).json({ message: "Error fetching retail products: " + error.message });
    }
  });

  app.post("/api/retail-products", isAdmin, async (req, res) => {
    try {
      const validatedData = insertRetailProductSchema.parse(req.body);
      const product = await storage.createRetailProduct(validatedData);
      res.json(product);
    } catch (error: any) {
      if (error.name === 'ZodError') {
        return res.status(400).json({ message: "Validation error", errors: error.errors });
      }
      res.status(500).json({ message: "Error creating retail product: " + error.message });
    }
  });

  app.patch("/api/retail-products/:id", isAdmin, async (req, res) => {
    try {
      const partialProductSchema = insertRetailProductSchema.partial();
      const validatedUpdates = partialProductSchema.parse(req.body);
      const product = await storage.updateRetailProduct(req.params.id, validatedUpdates);
      if (!product) {
        return res.status(404).json({ message: "Retail product not found" });
      }
      res.json(product);
    } catch (error: any) {
      if (error.name === 'ZodError') {
        return res.status(400).json({ message: "Validation error", errors: error.errors });
      }
      res.status(500).json({ message: "Error updating retail product: " + error.message });
    }
  });

  app.delete("/api/retail-products/:id", isAdmin, async (req, res) => {
    try {
      await storage.deleteRetailProduct(req.params.id);
      res.json({ message: "Retail product deleted successfully" });
    } catch (error: any) {
      res.status(500).json({ message: "Error deleting retail product: " + error.message });
    }
  });

  app.post("/api/retail-products/:id/flavors", isAdmin, async (req, res) => {
    try {
      const { flavorIds } = req.body;
      if (!Array.isArray(flavorIds)) {
        return res.status(400).json({ message: "flavorIds must be an array" });
      }
      await storage.setRetailProductFlavors(req.params.id, flavorIds);
      res.json({ message: "Product flavors updated successfully" });
    } catch (error: any) {
      res.status(500).json({ message: "Error setting product flavors: " + error.message });
    }
  });

  // NEW SCHEMA - Wholesale Unit Type management routes
  app.get("/api/wholesale-unit-types", isAuthenticated, isStaffOrAdmin, async (req: any, res) => {
    try {
      const includeInactive = req.query.includeInactive === 'true';
      const includeFlavors = req.query.includeFlavors === 'true';
      
      if (includeFlavors) {
        const unitTypes = await storage.getAllWholesaleUnitTypesWithFlavors();
        res.json(unitTypes);
      } else {
        const unitTypes = await storage.getWholesaleUnitTypes(includeInactive);
        res.json(unitTypes);
      }
    } catch (error: any) {
      res.status(500).json({ message: "Error fetching wholesale unit types: " + error.message });
    }
  });

  app.post("/api/wholesale-unit-types", isAdmin, async (req, res) => {
    try {
      const { flavorIds, ...unitTypeData } = req.body;
      const validatedData = insertWholesaleUnitTypeSchema.parse(unitTypeData);
      const unitType = await storage.createWholesaleUnitType(validatedData);
      
      // Set flavor associations if provided
      if (flavorIds && Array.isArray(flavorIds)) {
        await storage.setWholesaleUnitTypeFlavors(unitType.id, flavorIds);
      }
      
      res.json(unitType);
    } catch (error: any) {
      if (error.name === 'ZodError') {
        return res.status(400).json({ message: "Validation error", errors: error.errors });
      }
      res.status(500).json({ message: "Error creating wholesale unit type: " + error.message });
    }
  });

  app.patch("/api/wholesale-unit-types/:id", isAdmin, async (req, res) => {
    try {
      const { flavorIds, ...unitTypeData } = req.body;
      const partialUnitTypeSchema = insertWholesaleUnitTypeSchema.partial();
      const validatedUpdates = partialUnitTypeSchema.parse(unitTypeData);
      const unitType = await storage.updateWholesaleUnitType(req.params.id, validatedUpdates);
      
      if (!unitType) {
        return res.status(404).json({ message: "Wholesale unit type not found" });
      }
      
      // Update flavor associations if provided
      if (flavorIds && Array.isArray(flavorIds)) {
        await storage.setWholesaleUnitTypeFlavors(req.params.id, flavorIds);
      }
      
      res.json(unitType);
    } catch (error: any) {
      if (error.name === 'ZodError') {
        return res.status(400).json({ message: "Validation error", errors: error.errors });
      }
      res.status(500).json({ message: "Error updating wholesale unit type: " + error.message });
    }
  });

  app.delete("/api/wholesale-unit-types/:id", isAdmin, async (req, res) => {
    try {
      await storage.deleteWholesaleUnitType(req.params.id);
      res.json({ message: "Wholesale unit type deleted successfully" });
    } catch (error: any) {
      res.status(500).json({ message: "Error deleting wholesale unit type: " + error.message });
    }
  });

  // Wholesale Customer Pricing routes
  app.get("/api/wholesale-customer-pricing/:customerId", isAuthenticated, isStaffOrAdmin, async (req, res) => {
    try {
      const pricing = await storage.getWholesaleCustomerPricing(req.params.customerId);
      res.json(pricing);
    } catch (error: any) {
      res.status(500).json({ message: "Error fetching customer pricing: " + error.message });
    }
  });

  app.post("/api/wholesale-customer-pricing", isAdmin, async (req, res) => {
    try {
      const { customerId, unitTypeId, customPrice } = req.body;
      const pricing = await storage.setWholesaleCustomerPrice({
        customerId,
        unitTypeId,
        customPrice: customPrice.toString()
      });
      res.json(pricing);
    } catch (error: any) {
      res.status(500).json({ message: "Error setting customer pricing: " + error.message });
    }
  });

  app.delete("/api/wholesale-customer-pricing/:id", isAdmin, async (req, res) => {
    try {
      await storage.deleteWholesaleCustomerPrice(req.params.id);
      res.json({ message: "Customer pricing deleted successfully" });
    } catch (error: any) {
      res.status(500).json({ message: "Error deleting customer pricing: " + error.message });
    }
  });

  // Product Types routes
  app.get("/api/product-types", isAuthenticated, isStaffOrAdmin, async (req, res) => {
    try {
      const productTypes = await storage.getProductTypes();
      res.json(productTypes);
    } catch (error: any) {
      res.status(500).json({ message: "Error fetching product types: " + error.message });
    }
  });

  app.post("/api/product-types", isAuthenticated, isAdmin, async (req, res) => {
    try {
      const validated = insertProductTypeSchema.parse(req.body);
      const productType = await storage.createProductType(validated);
      res.status(201).json(productType);
    } catch (error: any) {
      if (error.name === 'ZodError') {
        return res.status(400).json({ message: "Validation error", errors: error.errors });
      }
      res.status(500).json({ message: "Error creating product type: " + error.message });
    }
  });

  app.patch("/api/product-types/:id", isAuthenticated, isAdmin, async (req, res) => {
    try {
      const { wholesalePrice, retailPrice } = req.body;
      const updates: any = {};
      if (wholesalePrice !== undefined) updates.wholesalePrice = wholesalePrice.toString();
      if (retailPrice !== undefined) updates.retailPrice = retailPrice.toString();
      
      const productType = await storage.updateProductType(req.params.id, updates);
      if (!productType) {
        return res.status(404).json({ message: "Product type not found" });
      }
      res.json(productType);
    } catch (error: any) {
      res.status(500).json({ message: "Error updating product type: " + error.message });
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

  // Public file upload URL endpoint (for flavor images, etc.)
  app.post("/api/object-storage/upload-url", isAuthenticated, isStaffOrAdmin, async (req, res) => {
    try {
      const { filename, directory } = req.body;
      if (!filename) {
        return res.status(400).json({ message: "filename is required" });
      }
      
      const objectStorageService = new ObjectStorageService();
      // Don't pass directory since publicPath already points to the public directory
      const uploadUrl = await objectStorageService.getPublicUploadURL(filename, directory === 'public' ? '' : directory);
      res.json({ uploadUrl });
    } catch (error: any) {
      console.error("Error getting public upload URL:", error);
      res.status(500).json({ message: "Error getting upload URL: " + error.message });
    }
  });

  // Make uploaded file publicly readable
  app.post("/api/object-storage/make-public", isAuthenticated, isStaffOrAdmin, async (req, res) => {
    try {
      const { fileUrl } = req.body;
      if (!fileUrl) {
        return res.status(400).json({ message: "fileUrl is required" });
      }
      
      const objectStorageService = new ObjectStorageService();
      await objectStorageService.makeFilePublic(fileUrl);
      res.json({ success: true });
    } catch (error: any) {
      console.error("Error making file public:", error);
      res.status(500).json({ message: "Error making file public: " + error.message });
    }
  });

  // Serve public files (like flavor images)
  app.get("/public/:filename(*)", async (req, res) => {
    const objectStorageService = new ObjectStorageService();
    try {
      const filename = req.params.filename;
      const file = await objectStorageService.getPublicFile(filename);
      
      if (!file) {
        return res.sendStatus(404);
      }
      
      // Files in product-images directory don't need ACL checking (admin-uploaded)
      if (filename.startsWith('product-images/')) {
        await objectStorageService.downloadObject(file, res, 86400);
        return;
      }
      
      // Check if file is marked as public in ACL policy
      const aclPolicy = await getObjectAclPolicy(file);
      if (!aclPolicy || aclPolicy.visibility !== 'public') {
        return res.sendStatus(403);
      }
      
      await objectStorageService.downloadObject(file, res, 86400); // Cache for 24 hours
    } catch (error: any) {
      console.error("Error serving public file:", error);
      res.sendStatus(500);
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

  // Inventory routes (staff only)
  app.post("/api/inventory/production", isStaffOrAdmin, async (req: any, res) => {
    try {
      const { productId, quantity, batchNumber, productionDate, notes } = req.body;
      const effectiveUser = req.originalUser || req.user;
      
      if (!productId || !quantity) {
        return res.status(400).json({ message: "Product ID and quantity are required" });
      }
      
      if (quantity <= 0) {
        return res.status(400).json({ message: "Quantity must be positive for production" });
      }
      
      const batchMetadata = JSON.stringify({
        batchNumber: batchNumber || null,
        productionDate: productionDate || new Date().toISOString(),
      });
      
      const adjustment = await storage.createInventoryAdjustment({
        productId,
        quantity,
        reason: 'production',
        staffUserId: effectiveUser.id,
        batchMetadata,
        notes: notes || null,
      });
      
      res.json(adjustment);
    } catch (error: any) {
      console.error("Error recording production:", error);
      res.status(500).json({ message: "Error recording production: " + error.message });
    }
  });
  
  app.get("/api/inventory/adjustments", isStaffOrAdmin, async (req: any, res) => {
    try {
      const { productId, reason, limit } = req.query;
      
      const filters: any = {};
      if (productId) filters.productId = productId as string;
      if (reason) filters.reason = reason as string;
      if (limit) filters.limit = parseInt(limit as string);
      
      const adjustments = await storage.getInventoryAdjustments(filters);
      res.json(adjustments);
    } catch (error: any) {
      console.error("Error fetching inventory adjustments:", error);
      res.status(500).json({ message: "Error fetching inventory adjustments: " + error.message });
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

  // Create subscription for a single product (new multi-product subscription flow)
  app.post("/api/create-product-subscription", isAuthenticated, async (req: any, res) => {
    try {
      if (!stripe) {
        return res.status(503).json({ message: "Payment processing is not configured" });
      }

      const { productId, quantity, frequency } = req.body;

      if (!productId || !quantity || !frequency) {
        return res.status(400).json({ message: "Missing required fields" });
      }

      const product = await storage.getProduct(productId);
      if (!product) {
        return res.status(404).json({ message: "Product not found" });
      }

      const pricing = await getProductPricing(productId);
      if (!pricing) {
        return res.status(404).json({ message: "Product pricing not found" });
      }

      // Calculate subscription price (10% discount)
      const basePrice = parseFloat(pricing.retailPrice);
      const subscriptionPrice = basePrice * 0.9;
      const unitAmountCents = Math.round(subscriptionPrice * 100);

      // Map frequency to Stripe interval
      const intervalCount = 
        frequency === 'weekly' ? 1 :
        frequency === 'bi-weekly' ? 2 :
        4; // every-4-weeks

      const baseUrl = process.env.REPLIT_DOMAINS
        ? `https://${process.env.REPLIT_DOMAINS.split(',')[0]}`
        : 'http://localhost:5000';

      const imageUrl = product.imageUrl?.startsWith('http') 
        ? product.imageUrl 
        : product.imageUrl 
          ? `${baseUrl}${product.imageUrl}` 
          : undefined;

      // Create Stripe Checkout Session for subscription
      const session = await stripe.checkout.sessions.create({
        mode: 'subscription',
        payment_method_types: ['card'],
        customer: req.user.stripeCustomerId || undefined,
        customer_email: req.user.stripeCustomerId ? undefined : req.user.email,
        line_items: [{
          price_data: {
            currency: 'usd',
            product_data: {
              name: `${product.name} - Case of 12`,
              description: `${frequency} subscription`,
              images: imageUrl ? [imageUrl] : [],
            },
            unit_amount: unitAmountCents,
            recurring: {
              interval: 'week',
              interval_count: intervalCount,
            },
          },
          quantity: quantity,
        }],
        success_url: `${baseUrl}/subscription-success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${baseUrl}/product-subscribe/${productId}`,
        metadata: {
          userId: req.user.id,
          productId: productId,
          frequency: frequency,
          quantity: quantity.toString(),
          type: 'product_subscription',
        },
      });

      res.json({ url: session.url, sessionId: session.id });
    } catch (error: any) {
      console.error("Product subscription error:", error);
      res.status(500).json({ message: "Error creating subscription: " + error.message });
    }
  });

  // Create Stripe checkout session for cart purchases (one-time or subscription)
  app.post("/api/create-cart-checkout", async (req: any, res) => {
    try {
      if (!stripe) {
        return res.status(503).json({ message: "Payment processing is not configured" });
      }

      const sessionId = req.sessionID || "guest";
      const legacyItems = await storage.getCartItems(sessionId);
      const retailItems = await storage.getRetailCart(sessionId);
      
      if (legacyItems.length === 0 && retailItems.length === 0) {
        return res.status(400).json({ message: "Cart is empty" });
      }

      // Check if cart has both subscription and one-time items
      const hasLegacySubscription = legacyItems.some(item => item.isSubscription);
      const hasRetailSubscription = retailItems.some(item => item.isSubscription);
      const hasOneTime = legacyItems.some(item => !item.isSubscription) || retailItems.some(item => !item.isSubscription);

      // Don't allow mixing subscription types (legacy vs retail)
      if (hasLegacySubscription && hasRetailSubscription) {
        return res.status(400).json({
          message: "Cannot mix legacy and new subscription products. Please checkout separately."
        });
      }

      if ((hasLegacySubscription || hasRetailSubscription) && hasOneTime) {
        return res.status(400).json({ 
          message: "Please checkout one-time purchases and subscriptions separately. Remove either the one-time or subscription items from your cart to continue."
        });
      }

      const hasSubscription = hasLegacySubscription || hasRetailSubscription;

      const baseUrl = process.env.REPLIT_DOMAINS
        ? `https://${process.env.REPLIT_DOMAINS.split(',')[0]}`
        : 'http://localhost:5000';

      // Create line items for both legacy and retail cart items
      const legacyLineItems = await Promise.all(
        legacyItems.map(async (item) => {
          const product = await storage.getProduct(item.productId);
          if (!product) throw new Error(`Product ${item.productId} not found`);
          
          const imageUrl = product.imageUrl.startsWith('http') 
            ? product.imageUrl 
            : `${baseUrl}${product.imageUrl}`;
          
          const casePrice = getCasePriceCents(item.isSubscription);

          if (item.isSubscription) {
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

      const retailLineItems = await Promise.all(
        retailItems.map(async (item) => {
          const retailProduct = item.retailProduct;
          const flavor = retailProduct.flavor;
          
          const imageUrl = flavor.primaryImageUrl?.startsWith('http') 
            ? flavor.primaryImageUrl 
            : flavor.primaryImageUrl
              ? `${baseUrl}/public/${flavor.primaryImageUrl}`
              : undefined;
          
          // Calculate price with subscription discount if applicable
          const basePrice = parseFloat(retailProduct.price);
          const discountPercentage = item.isSubscription ? parseFloat(retailProduct.subscriptionDiscount) : 0;
          const finalPrice = item.isSubscription && discountPercentage > 0
            ? basePrice * (1 - discountPercentage / 100)
            : basePrice;
          const casePriceCents = Math.round(finalPrice * 100);

          if (item.isSubscription) {
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
                  name: `${flavor.name} ${retailProduct.unitDescription} (${item.subscriptionFrequency})`,
                  description: `${frequencyLabel} subscription`,
                  images: imageUrl ? [imageUrl] : [],
                },
                unit_amount: casePriceCents,
                recurring: {
                  interval: 'week' as const,
                  interval_count: intervalCount,
                },
              },
              quantity: item.quantity,
            };
          } else {
            return {
              price_data: {
                currency: 'usd',
                product_data: {
                  name: `${flavor.name} ${retailProduct.unitDescription}`,
                  images: imageUrl ? [imageUrl] : [],
                },
                unit_amount: casePriceCents,
              },
              quantity: item.quantity,
            };
          }
        })
      );

      // Create deposit line items for retail products with deposits (one-time purchases only)
      const depositLineItems = retailItems
        .filter(item => !item.isSubscription && item.retailProduct.deposit && parseFloat(item.retailProduct.deposit.toString()) > 0)
        .map(item => {
          const depositAmount = Math.round(parseFloat(item.retailProduct.deposit.toString()) * 100);
          const retailProduct = item.retailProduct;
          
          // For multi-flavor products, find selected flavor name from flavors array
          let productName = retailProduct.unitDescription;
          if (retailProduct.productType === 'multi-flavor' && item.selectedFlavorId) {
            const selectedFlavor = retailProduct.flavors.find(f => f.id === item.selectedFlavorId);
            if (selectedFlavor) {
              productName = `${selectedFlavor.name} ${retailProduct.unitDescription}`;
            }
          } else if (retailProduct.productType === 'single-flavor' && retailProduct.flavor) {
            productName = `${retailProduct.flavor.name} ${retailProduct.unitDescription}`;
          }
          
          return {
            price_data: {
              currency: 'usd',
              product_data: {
                name: `Deposit: ${productName}`,
                description: 'Refundable deposit',
              },
              unit_amount: depositAmount,
            },
            quantity: item.quantity,
          };
        });

      const lineItems = [...legacyLineItems, ...retailLineItems, ...depositLineItems];

      // For subscriptions, include product info in metadata
      const metadata: Record<string, string> = {
        sessionId,
        type: hasSubscription ? 'subscription_purchase' : 'cart_purchase',
      };
      
      if (hasSubscription) {
        const legacySubItem = legacyItems.find(item => item.isSubscription);
        const retailSubItem = retailItems.find(item => item.isSubscription);
        const subItem = legacySubItem || retailSubItem;
        if (subItem) {
          if (legacySubItem) {
            metadata.productId = legacySubItem.productId;
          } else if (retailSubItem) {
            metadata.retailProductId = retailSubItem.retailProductId;
          }
          metadata.subscriptionFrequency = subItem.subscriptionFrequency || 'weekly';
        }
      }
      
      // Include userId if user is authenticated
      if (req.user && req.user.id) {
        metadata.userId = req.user.id;
      }

      // Calculate sales tax for retail orders (WA State 6.5% + Seattle City 3.85% = 10.35%)
      // Tax applies to all purchases including subscriptions
      const TAX_RATE = 0.1035; // 10.35%
      
      // Calculate subtotal from all items (including subscriptions)
      const legacyTaxable = await Promise.all(
        legacyItems
          .map(async (item) => {
            const pricing = await getProductPricing(item.productId);
            if (!pricing) return 0;
            const priceInCents = Math.round(parseFloat(pricing.retailPrice) * 100);
            return priceInCents * item.quantity;
          })
      ).then(amounts => amounts.reduce((sum, amount) => sum + amount, 0));

      const retailTaxable = retailItems
        .reduce((sum, item) => {
          // For subscriptions, apply discount if applicable
          let price = parseFloat(item.retailProduct.price);
          if (item.isSubscription && item.retailProduct.subscriptionDiscount != null) {
            const discountPercent = parseFloat(item.retailProduct.subscriptionDiscount.toString());
            if (isFinite(discountPercent) && discountPercent > 0) {
              price = price * (1 - discountPercent / 100);
            }
          }
          const priceCents = Math.round(price * 100);
          return sum + (priceCents * item.quantity);
        }, 0);

      // Calculate total deposits (one-time purchases only, not subject to tax)
      const depositTotal = retailItems
        .filter(item => !item.isSubscription && item.retailProduct.deposit)
        .reduce((sum, item) => {
          const depositAmount = Math.round(parseFloat(item.retailProduct.deposit.toString()) * 100);
          return sum + (depositAmount * item.quantity);
        }, 0);

      const taxableSubtotal = legacyTaxable + retailTaxable;
      
      if (taxableSubtotal > 0) {
        // Calculate tax amount in cents
        const taxAmount = Math.round(taxableSubtotal * TAX_RATE);
        
        // For subscriptions, determine the recurring interval from the first subscription item
        let taxLineItem: any = {
          price_data: {
            currency: 'usd',
            product_data: {
              name: 'Sales Tax (WA State 6.5% + Seattle 3.85%)',
              images: [],
            },
            unit_amount: taxAmount,
          },
          quantity: 1,
        };
        
        // If this is a subscription, make the tax recurring
        if (hasSubscription) {
          const subItem = legacyItems.find(item => item.isSubscription) || retailItems.find(item => item.isSubscription);
          if (subItem) {
            const frequency = subItem.subscriptionFrequency || 'weekly';
            const intervalCount = 
              frequency === 'weekly' ? 1 :
              frequency === 'bi-weekly' ? 2 :
              4;
            
            taxLineItem.price_data.recurring = {
              interval: 'week' as const,
              interval_count: intervalCount,
            };
          }
        }
        
        lineItems.push(taxLineItem);
        
        // Store tax info in metadata for reference
        metadata.taxRate = TAX_RATE.toString();
        metadata.taxAmount = (taxAmount / 100).toFixed(2);
        metadata.taxableSubtotal = (taxableSubtotal / 100).toFixed(2);
        
        // Store deposit total if any (deposits are not taxed)
        if (depositTotal > 0) {
          metadata.depositTotal = (depositTotal / 100).toFixed(2);
        }
      }

      const session = await stripe.checkout.sessions.create({
        mode: hasSubscription ? 'subscription' : 'payment',
        payment_method_types: ['card'],
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

  // Store customer info for retail checkout (called before payment)
  // Requires active session to prevent abuse
  const customerInfoSchema = z.object({
    customerName: z.string().min(2),
    customerEmail: z.string().email(),
    customerPhone: z.string().min(10),
    paymentIntentId: z.string().optional(),
  });

  app.post("/api/checkout/customer-info", async (req: any, res) => {
    try {
      // Require session (logged in or guest) for CSRF protection
      if (!req.sessionID) {
        return res.status(401).json({ message: "Session required" });
      }
      
      const validated = customerInfoSchema.parse(req.body);
      const sessionId = req.sessionID;
      
      // Validate payment intent exists and belongs to this session if provided
      if (validated.paymentIntentId && !validated.paymentIntentId.startsWith('pi_')) {
        return res.status(400).json({ message: "Invalid payment intent ID" });
      }
      
      // Fetch tax metadata from payment intent if available
      let taxMode = 'exclusive';
      let taxRateBps = 1035; // Default 10.35%
      let taxAmountCents = 0;
      let isTaxExempt = false;
      
      if (validated.paymentIntentId && stripe) {
        try {
          const paymentIntent = await stripe.paymentIntents.retrieve(validated.paymentIntentId);
          
          // Extract tax information from metadata
          if (paymentIntent.metadata.taxRate) {
            const taxRate = parseFloat(paymentIntent.metadata.taxRate);
            taxRateBps = Math.round(taxRate * 10000); // Convert to basis points
          }
          
          if (paymentIntent.metadata.taxAmount) {
            taxAmountCents = Math.round(parseFloat(paymentIntent.metadata.taxAmount) * 100);
          }
        } catch (error) {
          console.error("Error fetching payment intent for tax metadata:", error);
          // Continue with defaults if unable to fetch
        }
      }
      
      await storage.createRetailCheckoutSession({
        sessionId,
        paymentIntentId: validated.paymentIntentId || null,
        customerName: validated.customerName,
        customerEmail: validated.customerEmail,
        customerPhone: validated.customerPhone,
        userId: req.user?.id || null,
        taxMode,
        taxRateBps,
        taxAmountCents,
        isTaxExempt,
      });
      
      res.json({ success: true });
    } catch (error: any) {
      console.error("Error storing customer info:", error);
      res.status(500).json({ message: "Error storing customer info: " + error.message });
    }
  });

  // Create account during checkout (after successful payment)
  const createAccountSchema = z.object({
    customerName: z.string().min(2),
    customerEmail: z.string().email(),
    customerPhone: z.string().min(10),
    password: z.string().min(6),
  });

  app.post("/api/checkout/create-account", async (req: any, res) => {
    try {
      const validated = createAccountSchema.parse(req.body);
      
      // Import hashPassword function
      const { hashPassword } = await import('./auth');
      
      // Check if user already exists with this email or phone
      const existingEmailUser = await storage.getUserByEmail(validated.customerEmail);
      if (existingEmailUser) {
        return res.status(400).json({ message: "An account with this email already exists" });
      }
      
      const existingPhoneUser = await storage.getUserByPhoneNumber(validated.customerPhone);
      if (existingPhoneUser) {
        return res.status(400).json({ message: "An account with this phone number already exists" });
      }
      
      // Split name into first and last name
      const nameParts = validated.customerName.trim().split(' ');
      const firstName = nameParts[0];
      const lastName = nameParts.slice(1).join(' ') || firstName;
      
      // Generate username from email
      const username = validated.customerEmail.split('@')[0];
      
      // Check if username exists, if so add a number
      let finalUsername = username;
      let counter = 1;
      while (await storage.getUserByUsername(finalUsername)) {
        finalUsername = `${username}${counter}`;
        counter++;
      }
      
      // Create user directly in database to set role and isAdmin
      const result = await db.insert(users).values({
        username: finalUsername,
        email: validated.customerEmail,
        phoneNumber: validated.customerPhone,
        firstName,
        lastName,
        password: await hashPassword(validated.password),
        role: 'user',
        isAdmin: false,
      }).returning();
      
      const user = result[0];
      
      // Create Stripe customer (non-blocking)
      createStripeCustomer({
        userId: user.id,
        email: user.email,
        phoneNumber: user.phoneNumber,
        firstName: user.firstName,
        lastName: user.lastName,
        username: user.username,
      }).catch(error => {
        console.error("[Checkout Account Creation] Failed to create Stripe customer:", error);
      });
      
      // Log the user in
      await new Promise((resolve, reject) => {
        req.login(user, (err: any) => {
          if (err) return reject(err);
          resolve(undefined);
        });
      });
      
      res.json({ success: true, user: { id: user.id, username: user.username, email: user.email } });
    } catch (error: any) {
      console.error("Error creating checkout account:", error);
      if (error.name === 'ZodError') {
        return res.status(400).json({ message: "Invalid input: " + error.message });
      }
      res.status(500).json({ message: "Error creating account: " + error.message });
    }
  });

  // Create subscription with embedded payment method collection
  const createSubscriptionSchema = z.object({
    customerName: z.string().min(2),
    customerEmail: z.string().email(),
    customerPhone: z.string().min(10),
    paymentMethodId: z.string(), // Stripe payment method ID from frontend
    password: z.string().min(6).optional(), // For new account creation
  });

  app.post("/api/checkout/create-subscription", async (req: any, res) => {
    try {
      if (!stripe) {
        return res.status(503).json({ message: "Payment processing is not configured" });
      }

      const validated = createSubscriptionSchema.parse(req.body);
      const sessionId = req.sessionID || "guest";
      const userId = req.user?.id;

      // Get cart items
      const legacyItems = await storage.getCartItems(sessionId);
      const retailItems = await storage.getRetailCart(sessionId);
      
      if (legacyItems.length === 0 && retailItems.length === 0) {
        return res.status(400).json({ message: "Cart is empty" });
      }

      // Verify cart contains only subscriptions
      const hasLegacySubscription = legacyItems.some(item => item.isSubscription);
      const hasRetailSubscription = retailItems.some(item => item.isSubscription);
      const hasOneTime = legacyItems.some(item => !item.isSubscription) || retailItems.some(item => !item.isSubscription);

      if (hasOneTime) {
        return res.status(400).json({ 
          message: "This checkout is for subscriptions only" 
        });
      }

      if (!hasLegacySubscription && !hasRetailSubscription) {
        return res.status(400).json({ 
          message: "Cart must contain subscription items" 
        });
      }

      // Get or create user
      let user = req.user;
      
      if (!user) {
        // Create account if password provided
        if (!validated.password) {
          return res.status(400).json({ message: "Please create an account or log in to subscribe" });
        }

        const { hashPassword } = await import('./auth');
        
        // Check if user exists
        const existingUser = await storage.getUserByEmail(validated.customerEmail);
        if (existingUser) {
          return res.status(400).json({ message: "An account with this email already exists. Please log in." });
        }

        // Create user
        const nameParts = validated.customerName.trim().split(' ');
        const firstName = nameParts[0];
        const lastName = nameParts.slice(1).join(' ') || firstName;
        const username = validated.customerEmail.split('@')[0];

        let finalUsername = username;
        let counter = 1;
        while (await storage.getUserByUsername(finalUsername)) {
          finalUsername = `${username}${counter}`;
          counter++;
        }

        const result = await db.insert(users).values({
          username: finalUsername,
          email: validated.customerEmail,
          phoneNumber: validated.customerPhone,
          firstName,
          lastName,
          password: await hashPassword(validated.password),
          role: 'user',
          isAdmin: false,
        }).returning();

        user = result[0];

        // Log the user in
        await new Promise((resolve, reject) => {
          req.login(user, (err: any) => {
            if (err) return reject(err);
            resolve(undefined);
          });
        });
      }

      // Create or get Stripe customer and create subscriptions atomically
      try {
        // Create or get Stripe customer
        let stripeCustomer;
        const existingUser = await storage.getUser(user.id);
        
        if (existingUser?.stripeCustomerId) {
          stripeCustomer = await stripe.customers.retrieve(existingUser.stripeCustomerId);
        } else {
          stripeCustomer = await stripe.customers.create({
            email: validated.customerEmail,
            name: validated.customerName,
            phone: validated.customerPhone,
            metadata: { userId: user.id },
          });

          // Update user with Stripe customer ID
          await storage.updateUserStripeId(user.id, stripeCustomer.id);
        }

        // Attach payment method to customer
        await stripe.paymentMethods.attach(validated.paymentMethodId, {
          customer: stripeCustomer.id,
        });

        // Set as default payment method
        await stripe.customers.update(stripeCustomer.id, {
          invoice_settings: {
            default_payment_method: validated.paymentMethodId,
          },
        });

        // Create subscription records in a transaction
        const subscriptionItems = retailItems.filter(i => i.isSubscription);
        const createdSubscriptions = await db.transaction(async (tx) => {
          const subs: any[] = [];
          
          for (const item of subscriptionItems) {
            const [subscription] = await tx
              .insert(retailSubscriptions)
              .values({
                userId: user.id,
                customerName: validated.customerName,
                customerEmail: validated.customerEmail,
                customerPhone: validated.customerPhone,
                subscriptionFrequency: item.subscriptionFrequency || 'weekly',
                nextDeliveryDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days from now
                status: 'active',
                billingType: 'local_managed',
                billingStatus: 'active',
                stripeCustomerId: stripeCustomer.id,
                stripePaymentMethodId: validated.paymentMethodId,
              })
              .returning();

            // Add subscription items
            await tx.insert(retailSubscriptionItems).values({
              subscriptionId: subscription.id,
              retailProductId: item.retailProductId,
              selectedFlavorId: item.selectedFlavorId,
              quantity: item.quantity,
            });

            // Clear this subscription item from cart
            await tx.delete(retailCartItems).where(eq(retailCartItems.id, item.id));

            subs.push(subscription);
          }

          return subs;
        });

        res.json({ 
          success: true,
          subscriptions: createdSubscriptions,
        });
      } catch (transactionError: any) {
        console.error("Subscription creation failed:", transactionError);
        
        // If transaction failed after payment method was attached, detach it
        try {
          await stripe.paymentMethods.detach(validated.paymentMethodId);
        } catch (detachError) {
          console.error("Failed to detach payment method after error:", detachError);
        }
        
        throw transactionError;
      }
    } catch (error: any) {
      console.error("Error creating subscription:", error);
      if (error.name === 'ZodError') {
        return res.status(400).json({ message: "Invalid input: " + error.message });
      }
      res.status(500).json({ message: "Error creating subscription: " + error.message });
    }
  });

  // Create Stripe Payment Intent for embedded cart checkout (supports both old and new cart)
  app.post("/api/create-cart-payment-intent", async (req: any, res) => {
    try {
      if (!stripe) {
        return res.status(503).json({ message: "Payment processing is not configured" });
      }

      const sessionId = req.sessionID || "guest";
      const legacyItems = await storage.getCartItems(sessionId);
      const retailItems = await storage.getRetailCart(sessionId);
      
      if (legacyItems.length === 0 && retailItems.length === 0) {
        return res.status(400).json({ message: "Cart is empty" });
      }

      // Check if cart has both subscription and one-time items
      const hasLegacySubscription = legacyItems.some(item => item.isSubscription);
      const hasRetailSubscription = retailItems.some(item => item.isSubscription);
      const hasOneTime = legacyItems.some(item => !item.isSubscription) || retailItems.some(item => !item.isSubscription);

      // Don't allow mixing subscription types (legacy vs retail v2)
      if (hasLegacySubscription && hasRetailSubscription) {
        return res.status(400).json({
          message: "Cannot mix legacy and new subscription products. Please checkout separately."
        });
      }

      if ((hasLegacySubscription || hasRetailSubscription) && hasOneTime) {
        return res.status(400).json({ 
          message: "Please checkout one-time purchases and subscriptions separately. Remove either the one-time or subscription items from your cart to continue."
        });
      }

      // Payment Intents only work for one-time payments, not subscriptions
      if (hasLegacySubscription || hasRetailSubscription) {
        return res.status(400).json({
          message: "Subscriptions require a different checkout flow. Please use the subscription checkout page."
        });
      }

      // Calculate total amount in cents using actual product prices
      let subtotalCents = 0;
      let depositAmountCents = 0; // Deposits are charged but NOT taxed
      
      // Add legacy cart items
      for (const item of legacyItems) {
        const pricing = await getProductPricing(item.productId);
        if (!pricing) throw new Error(`Product pricing ${item.productId} not found`);
        if (!pricing.retailPrice) throw new Error(`Product ${item.productId} has no retail price`);
        
        const priceInDollars = parseFloat(pricing.retailPrice);
        if (!isFinite(priceInDollars) || priceInDollars < 0) {
          throw new Error(`Invalid price for product ${item.productId}: ${pricing.retailPrice}`);
        }
        
        const priceInCents = Math.round(priceInDollars * 100);
        subtotalCents += priceInCents * item.quantity;
      }
      
      // Add retail v2 cart items (price is in dollars, convert to cents)
      // Apply subscription discount if item is a subscription
      for (const item of retailItems) {
        if (!item.retailProduct) throw new Error(`Cart item ${item.id} missing retail product data`);
        if (!item.retailProduct.price) throw new Error(`Retail product ${item.retailProductId} has no price`);
        
        let priceInDollars = parseFloat(item.retailProduct.price);
        if (!isFinite(priceInDollars) || priceInDollars < 0) {
          throw new Error(`Invalid price for retail product ${item.retailProductId}: ${item.retailProduct.price}`);
        }
        
        // Apply subscription discount if this is a subscription item
        if (item.isSubscription && item.retailProduct.subscriptionDiscount != null) {
          const discountPercent = parseFloat(item.retailProduct.subscriptionDiscount.toString());
          if (isFinite(discountPercent) && discountPercent > 0) {
            priceInDollars = priceInDollars * (1 - discountPercent / 100);
          }
        }
        
        const priceInCents = Math.round(priceInDollars * 100);
        subtotalCents += priceInCents * item.quantity;
        
        // Add deposits (only for ONE-TIME purchases, not subscriptions, and not taxed)
        if (!item.isSubscription && item.retailProduct.deposit) {
          const depositInDollars = parseFloat(item.retailProduct.deposit.toString());
          if (isFinite(depositInDollars) && depositInDollars > 0) {
            const depositInCents = Math.round(depositInDollars * 100);
            depositAmountCents += depositInCents * item.quantity;
          }
        }
      }

      // Calculate sales tax (WA State 6.5% + Seattle City 3.85% = 10.35%)
      // Tax is applied to subtotal ONLY, not to deposits
      const TAX_RATE = 0.1035;
      const taxAmountCents = Math.round(subtotalCents * TAX_RATE);
      const totalAmountCents = subtotalCents + taxAmountCents + depositAmountCents;

      // Create payment intent
      const paymentIntent = await stripe.paymentIntents.create({
        amount: totalAmountCents,
        currency: 'usd',
        payment_method_types: ['card'],
        payment_method_options: {
          card: {
            request_three_d_secure: 'automatic',
          },
        },
        metadata: {
          sessionId,
          type: 'cart_purchase',
          userId: req.user?.id || 'guest',
          subtotal: (subtotalCents / 100).toFixed(2),
          taxRate: TAX_RATE.toString(),
          taxAmount: (taxAmountCents / 100).toFixed(2),
          depositAmount: (depositAmountCents / 100).toFixed(2),
          hasLegacyItems: legacyItems.length > 0 ? 'true' : 'false',
          hasRetailV2Items: retailItems.length > 0 ? 'true' : 'false',
        },
      });

      res.json({ 
        clientSecret: paymentIntent.client_secret,
        subtotal: subtotalCents / 100,
        taxAmount: taxAmountCents / 100,
        depositAmount: depositAmountCents / 100,
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

      const baseUrl = process.env.REPLIT_DOMAINS
        ? `https://${process.env.REPLIT_DOMAINS.split(',')[0]}`
        : 'http://localhost:5000';

      const successUrl = `${baseUrl}/checkout/success?session_id={CHECKOUT_SESSION_ID}`;
      const cancelUrl = `${baseUrl}/shop`;

      const session = await stripe.checkout.sessions.create({
        mode: 'subscription',
        payment_method_types: ['card'],
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
          
          // Handle cart purchases
          if (session.metadata?.type === 'cart_purchase') {
            const sessionId = session.metadata.sessionId;
            if (sessionId) {
              await storage.clearCart(sessionId);
              console.log(`Cleared cart for session ${sessionId} after successful payment`);
            }
            break;
          }
          
          // Handle subscription setup (new local management flow)
          if (session.metadata?.type === 'subscription_setup') {
            // Check for existing subscription with this session ID (idempotency)
            const existing = await storage.getSubscriptionBySessionId(session.id);
            if (existing) {
              console.log(`[WEBHOOK] Subscription already exists for session ${session.id}, skipping`);
              break;
            }

            if (!session.setup_intent) {
              console.error("No setup intent in subscription setup session");
              break;
            }

            // Retrieve setup intent to get payment method
            const setupIntent = await stripe.setupIntents.retrieve(session.setup_intent as string);
            if (!setupIntent.payment_method) {
              console.error("No payment method in setup intent");
              break;
            }

            // Parse subscription items from metadata
            const subscriptionItems = JSON.parse(session.metadata.subscriptionItems || '[]');
            if (subscriptionItems.length === 0) {
              console.error("No subscription items in metadata");
              break;
            }

            const firstItem = subscriptionItems[0];
            const frequency = firstItem.subscriptionFrequency || 'weekly';
            const daysUntilNext = 
              frequency === 'weekly' ? 7 :
              frequency === 'bi-weekly' ? 14 :
              28;

            // Calculate next date and normalize to allowed pickup day (Mon-Thu)
            const tentativeNextDate = new Date();
            tentativeNextDate.setDate(tentativeNextDate.getDate() + daysUntilNext);
            const nextDate = normalizeToAllowedPickupDay(tentativeNextDate);

            // Get customer details
            const customer = session.customer_details;
            if (!customer?.email) {
              console.error("No customer email in session");
              break;
            }

            // Create or get Stripe customer
            let stripeCustomerId = session.customer as string;
            if (!stripeCustomerId && customer.email) {
              const stripeCustomer = await stripe.customers.create({
                email: customer.email,
                name: customer.name || undefined,
                payment_method: setupIntent.payment_method as string,
                invoice_settings: {
                  default_payment_method: setupIntent.payment_method as string,
                },
              });
              stripeCustomerId = stripeCustomer.id;
            } else if (stripeCustomerId) {
              // Attach payment method to existing customer
              await stripe.paymentMethods.attach(setupIntent.payment_method as string, {
                customer: stripeCustomerId,
              });
              await stripe.customers.update(stripeCustomerId, {
                invoice_settings: {
                  default_payment_method: setupIntent.payment_method as string,
                },
              });
            }

            // Create locally-managed subscription
            const subscriptionData: any = {
              customerName: customer.name || 'Unknown',
              customerEmail: customer.email,
              customerPhone: customer.phone || '',
              stripeCheckoutSessionId: session.id, // For idempotency
              stripeCustomerId,
              stripePaymentMethodId: setupIntent.payment_method as string,
              billingType: 'local_managed',
              subscriptionFrequency: frequency,
              status: 'active',
              nextChargeAt: nextDate,
              nextDeliveryDate: nextDate,
              retryCount: 0,
            };

            if (session.metadata?.userId) {
              subscriptionData.userId = session.metadata.userId;
            }

            const newSubscription = await storage.createSubscription(subscriptionData);
            
            // Create subscription items
            for (const item of subscriptionItems) {
              await storage.addSubscriptionItem({
                subscriptionId: newSubscription.id,
                productId: item.productId,
                quantity: item.quantity,
              });
            }

            // Clear cart
            if (session.metadata.sessionId) {
              await storage.clearCart(session.metadata.sessionId);
            }

            console.log(`[WEBHOOK] Created locally-managed subscription ${newSubscription.id} with payment method ${setupIntent.payment_method}`);
            break;
          }
          
          // Handle retail subscription purchases (Stripe-managed)
          if (session.metadata?.type === 'subscription_purchase' && session.metadata?.retailProductId && session.subscription) {
            // Check for existing retail subscription with this session ID (idempotency)
            const existing = await storage.getRetailSubscriptionBySessionId(session.id);
            if (existing) {
              console.log(`[WEBHOOK] Retail subscription already exists for session ${session.id}, skipping`);
              break;
            }
            
            const stripeSubscription = await stripe.subscriptions.retrieve(session.subscription as string);
            
            // Get customer details
            const customer = session.customer_details;
            if (!customer?.email) {
              console.error("[WEBHOOK] No customer email in session");
              break;
            }
            
            // Calculate next pickup date
            const frequency = session.metadata.subscriptionFrequency || 'weekly';
            const daysUntilNext = 
              frequency === 'weekly' ? 7 :
              frequency === 'bi-weekly' ? 14 :
              28;
            
            const tentativeNextDate = new Date();
            tentativeNextDate.setDate(tentativeNextDate.getDate() + daysUntilNext);
            const nextPickupDate = normalizeToAllowedPickupDay(tentativeNextDate);
            
            // Create retail subscription record
            const retailSubscriptionData: any = {
              customerName: customer.name || 'Unknown',
              customerEmail: customer.email,
              customerPhone: customer.phone || '',
              stripeCheckoutSessionId: session.id,
              stripeSubscriptionId: stripeSubscription.id,
              stripeCustomerId: stripeSubscription.customer as string,
              billingType: 'stripe_managed',
              billingStatus: 'active',
              subscriptionFrequency: frequency as 'weekly' | 'bi-weekly' | 'every-4-weeks',
              nextDeliveryDate: nextPickupDate,
            };
            
            if (session.metadata?.userId) {
              retailSubscriptionData.userId = session.metadata.userId;
            }
            
            const newRetailSubscription = await storage.createRetailSubscription(retailSubscriptionData);
            
            // Add subscription items from cart
            const retailCartItems = await storage.getRetailCart(session.metadata.sessionId);
            const subscriptionItems = retailCartItems.filter(item => item.isSubscription);
            
            for (const item of subscriptionItems) {
              await storage.addRetailSubscriptionItem({
                subscriptionId: newRetailSubscription.id,
                retailProductId: item.retailProductId,
                quantity: item.quantity,
              });
            }
            
            // Clear cart
            if (session.metadata.sessionId) {
              await storage.clearRetailCart(session.metadata.sessionId);
            }
            
            console.log(`[WEBHOOK] ✅ Created Stripe-managed retail subscription ${newRetailSubscription.id} for Stripe subscription ${stripeSubscription.id}`);
            break;
          }
          
          // Handle legacy Stripe-managed subscriptions
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
          // Calculate next delivery date and normalize to allowed pickup day (Mon-Thu)
          const tentativeDate = new Date(Date.now() + daysUntilNext * 24 * 60 * 60 * 1000);
          const nextDeliveryDate = normalizeToAllowedPickupDay(tentativeDate);
          
          const subscriptionData: any = {
            customerName: session.metadata?.customerName || session.customer_details?.name || 'Unknown',
            customerEmail: session.customer_details?.email || '',
            customerPhone: '',
            stripeSubscriptionId: subscription.id,
            stripeCustomerId: subscription.customer as string,
            status: 'active',
            nextDeliveryDate: nextDeliveryDate,
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
        case 'invoice.payment_succeeded': {
          const invoice = event.data.object as any;
          
          // Only process subscription invoices (not one-time payments)
          const subscriptionId = invoice.subscription as string | null;
          if (!subscriptionId) {
            break;
          }
          
          // Skip the initial invoice (already handled by checkout.session.completed)
          if (invoice.billing_reason === 'subscription_create') {
            console.log(`[WEBHOOK] Skipping initial subscription invoice ${invoice.id}`);
            break;
          }
          
          console.log(`[WEBHOOK] Processing subscription renewal invoice ${invoice.id} for subscription ${subscriptionId}`);
          
          // Check for legacy subscription first
          const subscription = await storage.getSubscriptionByStripeId(subscriptionId);
          
          // Check for retail subscription if legacy not found
          const retailSubscription = !subscription ? await storage.getRetailSubscriptionByStripeId(subscriptionId) : null;
          
          if (!subscription && !retailSubscription) {
            console.error(`[WEBHOOK] No subscription (legacy or retail) found for Stripe ID ${subscriptionId}`);
            break;
          }
          
          // Handle retail subscription
          if (retailSubscription) {
            if (retailSubscription.billingStatus !== 'active') {
              console.log(`[WEBHOOK] Retail subscription ${retailSubscription.id} is not active (status: ${retailSubscription.billingStatus}), skipping order creation`);
              break;
            }
            
            // Get retail subscription items
            const retailSubItems = await storage.getRetailSubscriptionItems(retailSubscription.id);
            
            if (retailSubItems.length === 0) {
              console.error(`[WEBHOOK] No items found for retail subscription ${retailSubscription.id}`);
              break;
            }
            
            // Create order for retail subscription
            try {
              await db.transaction(async (tx) => {
                // Check for existing order (idempotency)
                const existingOrders = await tx
                  .select({ id: retailOrders.id })
                  .from(retailOrders)
                  .where(eq(retailOrders.stripeInvoiceId, invoice.id))
                  .limit(1);
                
                if (existingOrders.length > 0) {
                  console.log(`[WEBHOOK] Order already exists for invoice ${invoice.id} - skipping creation (idempotent)`);
                  return;
                }
                
                // Generate order number
                const maxOrderResult = await tx
                  .select({ maxNumber: sql<string>`COALESCE(MAX(CAST(SUBSTRING(order_number FROM 4) AS INTEGER)), 0)` })
                  .from(retailOrders)
                  .where(sql`order_number ~ '^ORD[0-9]+$'`);
                
                const nextNumber = parseInt(maxOrderResult[0]?.maxNumber || '0') + 1;
                const orderNumber = `ORD${String(nextNumber).padStart(6, '0')}`;
                
                // Calculate total from retail subscription items
                let subtotal = 0;
                for (const item of retailSubItems) {
                  const basePrice = parseFloat(item.retailProduct.price);
                  const discountPercent = parseFloat(item.retailProduct.subscriptionDiscount || '10');
                  const discountedPrice = basePrice * (1 - discountPercent / 100);
                  subtotal += discountedPrice * item.quantity;
                }
                
                // Create retail order
                const [newOrder] = await tx.insert(retailOrders).values({
                  orderNumber,
                  userId: retailSubscription.userId,
                  customerName: retailSubscription.customerName,
                  customerEmail: retailSubscription.customerEmail,
                  customerPhone: retailSubscription.customerPhone || '',
                  status: 'pending',
                  subtotal: subtotal.toFixed(2),
                  taxAmount: '0.00',
                  totalAmount: subtotal.toFixed(2),
                  stripeInvoiceId: invoice.id,
                  isSubscriptionOrder: true,
                }).returning();
                
                // Create order items with retail products (no inventory deduction yet - retail products don't have stock tracking)
                for (const item of retailSubItems) {
                  const basePrice = parseFloat(item.retailProduct.price);
                  const discountPercent = parseFloat(item.retailProduct.subscriptionDiscount || '10');
                  const discountedPrice = basePrice * (1 - discountPercent / 100);
                  
                  // Map retail product to legacy product for order item storage
                  // This is a temporary solution until we fully migrate order items to use retail products
                  const { productId: legacyProductId } = await tx
                    .select({ productId: products.id })
                    .from(products)
                    .where(eq(products.name, `${item.retailProduct.flavor.name} ${item.retailProduct.unitType}`))
                    .limit(1)
                    .then(rows => rows[0] || { productId: item.retailProduct.id });
                  
                  await tx.insert(retailOrderItems).values({
                    orderId: newOrder.id,
                    productId: legacyProductId,
                    quantity: item.quantity,
                    unitPrice: discountedPrice.toFixed(2),
                  });
                }
                
                // Update subscription's next delivery date
                const daysUntilNext = 
                  retailSubscription.subscriptionFrequency === 'weekly' ? 7 :
                  retailSubscription.subscriptionFrequency === 'bi-weekly' ? 14 :
                  28;
                
                const nextDate = new Date();
                nextDate.setDate(nextDate.getDate() + daysUntilNext);
                
                await tx
                  .update(retailSubscriptions)
                  .set({ nextDeliveryDate: nextDate })
                  .where(eq(retailSubscriptions.id, retailSubscription.id));
                
                console.log(`[WEBHOOK] ✅ Created retail subscription order ${orderNumber} for invoice ${invoice.id}`);
              });
            } catch (error) {
              console.error(`[WEBHOOK] Error creating retail subscription order for invoice ${invoice.id}:`, error);
              throw error;
            }
            
            break;
          }
          
          // Handle legacy subscription (existing code)
          if (!subscription) {
            break;
          }
          
          if (subscription.status !== 'active') {
            console.log(`[WEBHOOK] Subscription ${subscription.id} is not active (status: ${subscription.status}), skipping order creation`);
            break;
          }
          
          // Get subscription items (products and quantities) - outside transaction
          const subscriptionItems = await storage.getSubscriptionItems(subscription.id);
          
          if (subscriptionItems.length === 0) {
            console.error(`[WEBHOOK] No items found for subscription ${subscription.id}`);
            break;
          }
          
          // Use db.transaction for atomic order creation with inventory deduction
          try {
            await db.transaction(async (tx) => {
              // Check for existing order for this invoice (idempotency)
              const existingOrders = await tx
                .select({ id: retailOrders.id })
                .from(retailOrders)
                .where(eq(retailOrders.stripeInvoiceId, invoice.id))
                .limit(1);
              
              if (existingOrders.length > 0) {
                console.log(`[WEBHOOK] Order already exists for invoice ${invoice.id} - skipping creation (idempotent)`);
                return;
              }
              
              // Generate order number
              const maxOrderResult = await tx
                .select({ maxNumber: sql<string>`COALESCE(MAX(CAST(SUBSTRING(order_number FROM 4) AS INTEGER)), 0)` })
                .from(retailOrders)
                .where(sql`order_number ~ '^ORD[0-9]+$'`);
              
              const nextNumber = parseInt(maxOrderResult[0]?.maxNumber || '0') + 1;
              const orderNumber = `ORD${String(nextNumber).padStart(6, '0')}`;
              
              // Get products and calculate total (need to fetch within transaction for consistency)
              const productIds = subscriptionItems.map(item => item.productId);
              const productsList = await tx
                .select()
                .from(products)
                .where(sql`${products.id} = ANY(${productIds})`);
              
              const productsMap = new Map(productsList.map(p => [p.id, p]));
              
              // Also fetch product types for pricing
              const { productTypes } = await import("@shared/schema");
              const productTypeIds = Array.from(new Set(productsList.map(p => p.productTypeId)));
              const productTypesList = await tx
                .select()
                .from(productTypes)
                .where(sql`${productTypes.id} = ANY(${productTypeIds})`);
              
              const productTypesMap = new Map(productTypesList.map(pt => [pt.id, pt]));
              
              let subtotal = 0;
              for (const item of subscriptionItems) {
                const product = productsMap.get(item.productId);
                if (product) {
                  const productType = productTypesMap.get(product.productTypeId);
                  if (productType) {
                    // Subscription price is retail price * 0.9
                    const itemPrice = parseFloat(productType.retailPrice) * 0.9 * item.quantity;
                    subtotal += itemPrice;
                  }
                }
              }
              
              // Calculate sales tax (WA State 6.5% + Seattle City 3.85% = 10.35%)
              const TAX_RATE = 0.1035;
              const taxAmount = subtotal * TAX_RATE;
              const totalAmount = subtotal + taxAmount;
              
              // Create retail order
              const [newOrder] = await tx.insert(retailOrders).values({
                orderNumber,
                userId: subscription.userId,
                customerName: subscription.customerName,
                customerEmail: subscription.customerEmail,
                customerPhone: subscription.customerPhone || '',
                status: 'pending',
                subtotal: subtotal.toFixed(2),
                taxAmount: taxAmount.toFixed(2),
                totalAmount: totalAmount.toFixed(2),
                stripeInvoiceId: invoice.id,
                isSubscriptionOrder: true,
              }).returning();
              
              // Create order items and deduct inventory
              for (const item of subscriptionItems) {
                const product = productsMap.get(item.productId);
                if (product) {
                  const productType = productTypesMap.get(product.productTypeId);
                  if (!productType) {
                    throw new Error(`Product type ${product.productTypeId} not found`);
                  }
                  const itemPrice = parseFloat(productType.retailPrice) * 0.9;
                  
                  // Create order item
                  await tx.insert(retailOrderItems).values({
                    orderId: newOrder.id,
                    productId: item.productId,
                    quantity: item.quantity,
                    unitPrice: itemPrice.toFixed(2),
                  });
                  
                  // Deduct inventory with pessimistic locking
                  const [productWithLock] = await tx
                    .select()
                    .from(products)
                    .where(eq(products.id, item.productId))
                    .for('update');
                  
                  if (!productWithLock) {
                    throw new Error(`Product ${item.productId} not found`);
                  }
                  
                  const currentStock = productWithLock.stockQuantity;
                  const newStock = currentStock - item.quantity;
                  
                  if (newStock < 0) {
                    console.warn(`[WEBHOOK] Insufficient inventory for product ${item.productId}. Current: ${currentStock}, Needed: ${item.quantity}`);
                    // Continue anyway - staff will handle this
                  }
                  
                  // Update product stock
                  await tx
                    .update(products)
                    .set({ stockQuantity: newStock })
                    .where(eq(products.id, item.productId));
                  
                  // Record inventory adjustment
                  await tx.insert(inventoryAdjustments).values({
                    productId: item.productId,
                    reason: 'fulfillment',
                    quantity: -item.quantity,
                    notes: `Auto-deducted for subscription order ${orderNumber}`,
                    orderId: newOrder.id,
                    orderType: 'retail',
                  });
                }
              }
              
              // Update subscription's next delivery date with pessimistic lock
              const daysUntilNext = 
                subscription.subscriptionFrequency === 'weekly' ? 7 :
                subscription.subscriptionFrequency === 'bi-weekly' ? 14 :
                28; // every-4-weeks
              
              const nextDate = new Date();
              nextDate.setDate(nextDate.getDate() + daysUntilNext);
              
              // Lock subscription row before updating
              await tx
                .select()
                .from(subscriptions)
                .where(eq(subscriptions.id, subscription.id))
                .for('update');
              
              await tx
                .update(subscriptions)
                .set({ nextDeliveryDate: nextDate })
                .where(eq(subscriptions.id, subscription.id));
              
              console.log(`[WEBHOOK] ✅ Created subscription order ${orderNumber} for invoice ${invoice.id} and deducted inventory`);
            });
          } catch (error) {
            console.error(`[WEBHOOK] Error creating subscription order for invoice ${invoice.id}:`, error);
            throw error;
          }
          
          break;
        }
        case 'payment_intent.succeeded': {
          const paymentIntent = event.data.object as Stripe.PaymentIntent;
          
          // Handle subscription renewal payments (locally-managed subscriptions)
          if (paymentIntent.metadata?.type === 'subscription_renewal') {
            console.log(`[WEBHOOK] Processing successful subscription renewal payment ${paymentIntent.id}`);
            
            const { finalizeSubscriptionCharge } = await import('./billing-cron');
            const success = await finalizeSubscriptionCharge(paymentIntent.id);
            
            if (success) {
              console.log(`[WEBHOOK] ✅ Successfully finalized subscription charge for PaymentIntent ${paymentIntent.id}`);
            } else {
              console.error(`[WEBHOOK] ❌ Failed to finalize subscription charge for PaymentIntent ${paymentIntent.id}`);
            }
            break;
          }
          
          // Handle cart purchase payments
          if (paymentIntent.metadata?.type === 'cart_purchase') {
            const sessionId = paymentIntent.metadata.sessionId;
            
            // Use transaction for atomic order creation
            const client = await pool.connect();
            try {
              await client.query('BEGIN');
              
              // Check for existing order (idempotency via unique constraint)
              const existingOrderResult = await client.query(
                'SELECT id FROM retail_orders WHERE stripe_payment_intent_id = $1 LIMIT 1',
                [paymentIntent.id]
              );
              
              if (existingOrderResult.rows.length === 0) {
                // 🔒 SECURITY: Lock checkout session to prevent race conditions
                const checkoutSessionResult = await client.query(
                  'SELECT * FROM retail_checkout_sessions WHERE payment_intent_id = $1 FOR UPDATE',
                  [paymentIntent.id]
                );
                
                if (checkoutSessionResult.rows.length === 0) {
                  console.error(`[WEBHOOK] No checkout session found for payment intent ${paymentIntent.id}`);
                  await client.query('COMMIT');
                  // Still clear the cart to prevent stuck state
                  if (sessionId) {
                    await storage.clearCart(sessionId);
                  }
                  break;
                }
                
                const checkoutSession = checkoutSessionResult.rows[0];
                
                // 🔒 SECURITY: Lock cart rows to prevent concurrent modifications
                const cartItems = await storage.getCartItems(sessionId, client);
                const retailItems = await storage.getRetailCart(sessionId, client);
                
                // Cart must not be empty - fail if it is (prevents race conditions and tampering)
                if (cartItems.length === 0 && retailItems.length === 0) {
                  console.error(`[WEBHOOK] Cart is empty for session ${sessionId} - payment received but no items to fulfill`);
                  console.error(`[WEBHOOK] This may indicate a race condition or tampering attempt`);
                  throw new Error('Cart is empty - cannot verify or fulfill payment');
                }
                
                // 🔒 SECURITY: Recompute subtotal and deposit from locked cart items (don't trust client metadata)
                let recomputedSubtotalCents = 0;
                let recomputedDepositCents = 0; // Deposits are charged but NOT taxed
                
                // Add legacy cart items
                for (const item of cartItems) {
                  const pricing = await getProductPricing(item.productId);
                  if (!pricing) {
                    console.error(`[WEBHOOK] Product pricing ${item.productId} not found`);
                    throw new Error(`Product pricing not found - cannot verify payment`);
                  }
                  if (!pricing.retailPrice) {
                    console.error(`[WEBHOOK] Product ${item.productId} has no retail price`);
                    throw new Error(`Product missing price - cannot verify payment`);
                  }
                  const priceInCents = Math.round(parseFloat(pricing.retailPrice) * 100);
                  recomputedSubtotalCents += priceInCents * item.quantity;
                }
                
                // Add retail v2 cart items (no discounts for one-time purchases)
                for (const item of retailItems) {
                  if (!item.retailProduct) {
                    console.error(`[WEBHOOK] Cart item ${item.id} missing retail product data`);
                    throw new Error(`Cart item missing product data - cannot verify payment`);
                  }
                  if (!item.retailProduct.price) {
                    console.error(`[WEBHOOK] Retail product ${item.retailProductId} has no price`);
                    throw new Error(`Product missing price - cannot verify payment`);
                  }
                  const priceInCents = Math.round(parseFloat(item.retailProduct.price) * 100);
                  recomputedSubtotalCents += priceInCents * item.quantity;
                  
                  // Add deposits (only for ONE-TIME purchases, not subscriptions, and not taxed)
                  if (!item.isSubscription && item.retailProduct.deposit) {
                    const depositInDollars = parseFloat(item.retailProduct.deposit.toString());
                    if (isFinite(depositInDollars) && depositInDollars > 0) {
                      const depositInCents = Math.round(depositInDollars * 100);
                      recomputedDepositCents += depositInCents * item.quantity;
                    }
                  }
                }
                
                // 🔒 SECURITY: Use stored tax metadata from checkout session (not hardcoded rate)
                // This ensures we verify against the exact tax calculated at checkout time
                const storedTaxAmountCents = checkoutSession.tax_amount_cents || 0;
                const storedTaxRateBps = checkoutSession.tax_rate_bps || 1035;
                const isTaxExempt = checkoutSession.is_tax_exempt || false;
                
                // Calculate expected tax from stored rate for verification (tax on subtotal ONLY, not deposits)
                let recomputedTaxCents = 0;
                if (!isTaxExempt && storedTaxRateBps > 0) {
                  const taxRate = storedTaxRateBps / 10000; // Convert basis points to decimal
                  recomputedTaxCents = Math.round(recomputedSubtotalCents * taxRate);
                }
                
                const recomputedTotalCents = recomputedSubtotalCents + recomputedTaxCents + recomputedDepositCents;
                
                // 🔒 SECURITY: Verify Stripe amount matches recomputed total (subtotal + tax + deposit)
                if (Math.abs(paymentIntent.amount - recomputedTotalCents) > 1) {
                  console.error(`[WEBHOOK] Payment amount verification FAILED!`);
                  console.error(`[WEBHOOK] Stripe charged: ${paymentIntent.amount} cents`);
                  console.error(`[WEBHOOK] Recomputed total: ${recomputedTotalCents} cents (subtotal: ${recomputedSubtotalCents}, tax: ${recomputedTaxCents}, deposit: ${recomputedDepositCents})`);
                  console.error(`[WEBHOOK] Stored tax from checkout: ${storedTaxAmountCents} cents at ${storedTaxRateBps} bps, exempt: ${isTaxExempt}`);
                  console.error(`[WEBHOOK] This may indicate a tampering attempt or pricing mismatch`);
                  throw new Error('Payment amount verification failed - amount mismatch');
                }
                
                // Generate order number with row-level locking to prevent race conditions
                const orderNumber = await storage.generateNextOrderNumber(client);
                
                // Determine if this is a subscription order
                const isSubscriptionOrder = cartItems.some(item => item.isSubscription) || 
                                            retailItems.some(item => item.isSubscription);
                
                // Create retail order using verified amounts
                const orderResult = await client.query(
                  `INSERT INTO retail_orders (
                    order_number, user_id, customer_name, customer_email, customer_phone,
                    status, subtotal, tax_amount, deposit_amount, total_amount, stripe_payment_intent_id, is_subscription_order
                  ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING id`,
                  [
                    orderNumber,
                    checkoutSession.user_id,
                    checkoutSession.customer_name,
                    checkoutSession.customer_email,
                    checkoutSession.customer_phone,
                    'pending',
                    (recomputedSubtotalCents / 100).toFixed(2),
                    (recomputedTaxCents / 100).toFixed(2),
                    (recomputedDepositCents / 100).toFixed(2),
                    (recomputedTotalCents / 100).toFixed(2),
                    paymentIntent.id,
                    isSubscriptionOrder
                  ]
                );
                
                const orderId = orderResult.rows[0].id;
                
                // Create legacy order items
                for (const item of cartItems) {
                  const pricing = await getProductPricing(item.productId);
                  if (pricing) {
                    await client.query(
                      'INSERT INTO retail_order_items (order_id, product_id, quantity, unit_price) VALUES ($1, $2, $3, $4)',
                      [orderId, item.productId, item.quantity, pricing.retailPrice]
                    );
                  }
                }
                
                // Create retail v2 order items
                for (const item of retailItems) {
                  if (!item.retailProduct) continue;
                  
                  // Calculate price with subscription discount if applicable
                  let unitPrice = parseFloat(item.retailProduct.price);
                  if (item.isSubscription && item.retailProduct.subscriptionDiscount != null) {
                    const discountPercent = parseFloat(item.retailProduct.subscriptionDiscount.toString());
                    if (isFinite(discountPercent) && discountPercent > 0) {
                      unitPrice = unitPrice * (1 - discountPercent / 100);
                    }
                  }
                  
                  await client.query(
                    'INSERT INTO retail_order_items_v2 (order_id, retail_product_id, quantity, unit_price) VALUES ($1, $2, $3, $4)',
                    [orderId, item.retailProductId, item.quantity, unitPrice.toFixed(2)]
                  );
                }
                
                // Delete checkout session (mark as consumed)
                await client.query('DELETE FROM retail_checkout_sessions WHERE id = $1', [checkoutSession.id]);
                
                console.log(`[WEBHOOK] Created retail order ${orderNumber} for payment intent ${paymentIntent.id}`);
                
                // Send order confirmation email (non-blocking)
                const { sendOrderReceiptEmail } = await import('./email');
                const orderItems = [];
                
                // Collect legacy cart items for email
                for (const item of cartItems) {
                  const product = await storage.getProduct(item.productId);
                  const pricing = await getProductPricing(item.productId);
                  if (product && pricing) {
                    orderItems.push({
                      productName: product.name,
                      quantity: item.quantity,
                      unitPrice: pricing.retailPrice || '0.00',
                    });
                  }
                }
                
                // Collect retail v2 cart items for email
                for (const item of retailItems) {
                  if (item.retailProduct && item.retailProduct.flavor) {
                    let unitPrice = parseFloat(item.retailProduct.price);
                    if (item.isSubscription && item.retailProduct.subscriptionDiscount != null) {
                      const discountPercent = parseFloat(item.retailProduct.subscriptionDiscount.toString());
                      if (isFinite(discountPercent) && discountPercent > 0) {
                        unitPrice = unitPrice * (1 - discountPercent / 100);
                      }
                    }
                    // Use flavor name + unit description for the product name
                    const productName = `${item.retailProduct.flavor.name} - ${item.retailProduct.unitDescription}`;
                    orderItems.push({
                      productName,
                      quantity: item.quantity,
                      unitPrice: unitPrice.toFixed(2),
                    });
                  }
                }
                
                sendOrderReceiptEmail({
                  customerEmail: checkoutSession.customer_email,
                  customerName: checkoutSession.customer_name,
                  orderNumber,
                  orderItems,
                  subtotal: recomputedSubtotalCents / 100,
                  taxAmount: recomputedTaxCents > 0 ? recomputedTaxCents / 100 : undefined,
                  total: recomputedTotalCents / 100,
                  orderType: isSubscriptionOrder ? 'subscription' : 'one-time',
                }).catch(emailError => {
                  console.error(`[WEBHOOK] Failed to send order receipt email for ${orderNumber}:`, emailError);
                  // Don't fail the webhook if email fails
                });
              } else {
                console.log(`[WEBHOOK] Order already exists for payment intent ${paymentIntent.id} - skipping creation (idempotent)`);
              }
              
              await client.query('COMMIT');
            } catch (error) {
              await client.query('ROLLBACK');
              console.error(`[WEBHOOK] Error creating retail order for payment intent ${paymentIntent.id}:`, error);
              throw error;
            } finally {
              client.release();
            }
            
            // Always clear both carts (outside transaction)
            if (sessionId) {
              await storage.clearCart(sessionId);
              await storage.clearRetailCart(sessionId);
              console.log(`[WEBHOOK] Cleared carts for session ${sessionId} after successful payment`);
            }
          }
          break;
        }
        case 'payment_intent.processing': {
          const paymentIntent = event.data.object as Stripe.PaymentIntent;
          
          // Only handle subscription renewals
          if (paymentIntent.metadata?.type === 'subscription_renewal' && paymentIntent.metadata?.subscriptionId) {
            console.log(`[WEBHOOK] PaymentIntent ${paymentIntent.id} is processing for subscription ${paymentIntent.metadata.subscriptionId}`);
            
            // Update subscription status to awaiting_confirmation
            await db
              .update(subscriptions)
              .set({
                billingStatus: 'awaiting_confirmation',
                lastPaymentIntentId: paymentIntent.id,
                processingLock: false,
              })
              .where(eq(subscriptions.id, paymentIntent.metadata.subscriptionId));
          }
          break;
        }
        case 'payment_intent.requires_action': {
          const paymentIntent = event.data.object as Stripe.PaymentIntent;
          
          // Only handle subscription renewals
          if (paymentIntent.metadata?.type === 'subscription_renewal' && paymentIntent.metadata?.subscriptionId) {
            console.log(`[WEBHOOK] PaymentIntent ${paymentIntent.id} requires customer action for subscription ${paymentIntent.metadata.subscriptionId}`);
            
            // Update subscription status to awaiting_auth
            await db
              .update(subscriptions)
              .set({
                billingStatus: 'awaiting_auth',
                lastPaymentIntentId: paymentIntent.id,
                processingLock: false,
              })
              .where(eq(subscriptions.id, paymentIntent.metadata.subscriptionId));
            
            // TODO: Send customer email with link to complete authentication
            console.warn(`[WEBHOOK] ⚠️ Customer authentication required for subscription ${paymentIntent.metadata.subscriptionId}`);
          }
          break;
        }
        case 'payment_intent.payment_failed': {
          const paymentIntent = event.data.object as Stripe.PaymentIntent;
          
          // Only handle subscription renewals
          if (paymentIntent.metadata?.type === 'subscription_renewal' && paymentIntent.metadata?.subscriptionId) {
            console.error(`[WEBHOOK] Payment failed for subscription ${paymentIntent.metadata.subscriptionId}`);
            
            const subscription = await storage.getSubscription(paymentIntent.metadata.subscriptionId);
            if (!subscription) {
              console.error(`[WEBHOOK] Subscription ${paymentIntent.metadata.subscriptionId} not found`);
              break;
            }
            
            // Increment retry count and schedule next attempt
            const newRetryCount = subscription.retryCount + 1;
            const MAX_RETRY_ATTEMPTS = 3;
            
            // Schedule next retry attempt (1 day from now if under max retries)
            let nextChargeAt: Date | undefined;
            if (newRetryCount < MAX_RETRY_ATTEMPTS) {
              nextChargeAt = new Date();
              nextChargeAt.setDate(nextChargeAt.getDate() + 1); // Retry tomorrow
            }
            
            await db
              .update(subscriptions)
              .set({
                retryCount: newRetryCount,
                billingStatus: newRetryCount >= MAX_RETRY_ATTEMPTS ? 'retrying' : 'active',
                nextChargeAt: nextChargeAt || subscription.nextChargeAt,
                lastPaymentIntentId: paymentIntent.id,
                processingLock: false,
                status: newRetryCount >= MAX_RETRY_ATTEMPTS ? 'paused' : subscription.status,
              })
              .where(eq(subscriptions.id, subscription.id));
            
            if (newRetryCount >= MAX_RETRY_ATTEMPTS) {
              console.error(`[WEBHOOK] Subscription ${subscription.id} paused after ${MAX_RETRY_ATTEMPTS} failed attempts`);
            }
            
            // Send failure notifications
            const { sendPaymentFailureEmail, sendStaffPaymentFailureNotification } = await import('./email');
            const items = await storage.getSubscriptionItems(subscription.id);
            const itemsList = await Promise.all(items.map(async (item) => {
              const product = await storage.getProduct(item.productId);
              return {
                productName: product?.name || 'Unknown Product',
                quantity: item.quantity,
              };
            }));
            
            try {
              await Promise.all([
                sendPaymentFailureEmail({
                  customerEmail: subscription.customerEmail,
                  customerName: subscription.customerName,
                  subscriptionItems: itemsList,
                  amount: paymentIntent.amount / 100,
                  errorMessage: paymentIntent.last_payment_error?.message || 'Payment failed',
                }),
                sendStaffPaymentFailureNotification({
                  customerEmail: subscription.customerEmail,
                  customerName: subscription.customerName,
                  subscriptionItems: itemsList,
                  amount: paymentIntent.amount / 100,
                  errorMessage: paymentIntent.last_payment_error?.message || 'Payment failed',
                }),
              ]);
            } catch (emailError) {
              console.error('[WEBHOOK] Failed to send payment failure emails:', emailError);
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

  app.get("/api/my-orders", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const ordersWithDetails = await storage.getRetailOrdersWithDetailsByUserId(userId);
      res.json(ordersWithDetails);
    } catch (error: any) {
      console.error('[ERROR] Failed to fetch user orders:', error);
      res.status(500).json({ message: "Error fetching orders: " + error.message });
    }
  });

  app.post("/api/orders/:id/reorder", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const orderId = req.params.id;
      const sessionId = req.sessionID || "guest";
      
      const orderDetails = await storage.getRetailOrderWithDetails(orderId);
      if (!orderDetails) {
        return res.status(404).json({ message: "Order not found" });
      }
      
      if (orderDetails.order.userId !== userId) {
        return res.status(403).json({ message: "Unauthorized" });
      }
      
      let itemsAdded = 0;
      const flavors = await storage.getFlavors(true);
      const allProductTypes = await storage.getProductTypes();
      
      for (const item of orderDetails.items) {
        const product = await storage.getProduct(item.productId);
        if (!product) {
          console.warn(`[WARN] Product ${item.productId} not found, skipping reorder item`);
          continue;
        }
        
        const flavor = flavors.find(f => f.name === product.name);
        if (!flavor) {
          console.warn(`[WARN] Flavor '${product.name}' not found in flavor library, skipping item`);
          continue;
        }
        
        const productType = allProductTypes.find(pt => pt.id === product.productTypeId);
        if (!productType) {
          console.warn(`[WARN] Product type ${product.productTypeId} not found, skipping item`);
          continue;
        }
        
        const retailProduct = await db.query.retailProducts.findFirst({
          where: and(
            eq(retailProducts.flavorId, flavor.id),
            eq(retailProducts.unitType, productType.unitType),
            eq(retailProducts.isActive, true)
          )
        });
        
        if (!retailProduct) {
          console.warn(`[WARN] Retail product not found for flavor ${flavor.name} (${flavor.id}) and unit type ${productType.unitType}, skipping item`);
          continue;
        }
        
        await storage.addRetailProductToCart({
          sessionId,
          retailProductId: retailProduct.id,
          quantity: item.quantity,
          isSubscription: false,
          subscriptionFrequency: null,
        });
        
        itemsAdded++;
      }
      
      if (itemsAdded === 0) {
        return res.status(400).json({ message: "Unable to add items to cart. Products may no longer be available." });
      }
      
      res.json({ success: true, message: `${itemsAdded} item(s) added to cart`, itemsAdded });
    } catch (error: any) {
      console.error('[ERROR] Failed to reorder:', error);
      res.status(500).json({ message: "Error reordering: " + error.message });
    }
  });

  // Update subscription (delay delivery, change product, change frequency, advance to next week)
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
        weeksToDelay: z.number().int().min(1).max(12).optional(), // Declarative: delay by N weeks
        advanceToNextWeek: z.boolean().optional(), // Declarative: move to next week
        subscriptionFrequency: z.enum(['weekly', 'bi-weekly', 'every-4-weeks']).optional(),
      });
      
      const validated = updateSchema.parse(req.body);
      
      // Ensure mutually exclusive schedule changes
      if (validated.weeksToDelay && validated.advanceToNextWeek) {
        return res.status(400).json({
          message: "Cannot delay and advance pickup in the same request."
        });
      }
      
      // Validate billing state for any updates
      if (subscription.status !== 'active') {
        return res.status(400).json({ 
          message: "Cannot modify a cancelled subscription." 
        });
      }
      
      if (subscription.billingStatus !== 'active') {
        return res.status(400).json({ 
          message: "Cannot modify subscription while payment is in progress. Please try again later." 
        });
      }
      
      if (subscription.processingLock) {
        return res.status(400).json({ 
          message: "Subscription is currently being processed. Please try again in a moment." 
        });
      }
      
      // Build updates object with server-computed dates
      const updates: Partial<Subscription> = {};
      
      // Handle frequency change
      if (validated.subscriptionFrequency) {
        updates.subscriptionFrequency = validated.subscriptionFrequency;
      }
      
      // Handle product change
      if (validated.productId) {
        updates.productId = validated.productId;
      }
      
      // Handle advance to next week (server-side calculation with Friday cutoff)
      if (validated.advanceToNextWeek) {
        // Use Pacific timezone (brewery's canonical timezone)
        const BREWERY_TIMEZONE = 'America/Los_Angeles';
        const now = new Date();
        
        // Convert current time to Pacific timezone for validation
        const nowPacific = toZonedTime(now, BREWERY_TIMEZONE);
        const dayOfWeek = nowPacific.getDay(); // 0 = Sunday, 5 = Friday
        
        // Check if it's Friday (5) or after
        if (dayOfWeek >= 5) {
          return res.status(400).json({
            message: "Cannot move pickup to next week after Thursday. Please try again next week."
          });
        }
        
        // Validate that next delivery date exists
        if (!subscription.nextDeliveryDate) {
          return res.status(422).json({
            message: "Cannot move pickup earlier - no scheduled delivery date found."
          });
        }
        
        // Get current scheduled delivery date
        const currentDate = new Date(subscription.nextDeliveryDate);
        
        // Validate date is valid
        if (isNaN(currentDate.getTime())) {
          return res.status(422).json({
            message: "Cannot move pickup earlier - invalid delivery date."
          });
        }
        
        // Pickup dates have no specific time component - DST is not a concern
        // "Next week" means 7 days from TODAY, not from current pickup
        
        // Normalize current pickup to Pacific date (ignore any time component for comparison)
        const currentPickupDateStr = formatInTimeZone(currentDate, BREWERY_TIMEZONE, "yyyy-MM-dd");
        
        // Calculate "next week" as 7 days from TODAY in Pacific timezone
        const todayPacific = toZonedTime(now, BREWERY_TIMEZONE);
        const nextWeekPacific = addDays(todayPacific, 7);
        const nextWeekPacificStr = formatInTimeZone(nextWeekPacific, BREWERY_TIMEZONE, "yyyy-MM-dd");
        
        // Verify that next week is EARLIER than current pickup (date-only comparison)
        if (nextWeekPacificStr >= currentPickupDateStr) {
          return res.status(400).json({
            message: `Cannot move pickup earlier - your pickup is already scheduled for ${format(currentDate, 'EEEE, MMMM d')}. This feature only works when your pickup is more than 7 days away.`
          });
        }
        
        // Convert Pacific midnight to UTC for storage
        const nextWeekUTC = fromZonedTime(`${nextWeekPacificStr}T00:00:00`, BREWERY_TIMEZONE);
        
        // Validate 48-hour minimum lead time
        // Add 48 hours in Pacific timezone, then compare UTC timestamps
        const nowPlus48Pacific = addHours(nowPacific, 48);
        const minLeadTimeUTC = fromZonedTime(nowPlus48Pacific, BREWERY_TIMEZONE);
        
        if (nextWeekUTC < minLeadTimeUTC) {
          return res.status(400).json({
            message: "Cannot move pickup to a date less than 48 hours away."
          });
        }
        
        // Note: No need for "already next week" check because:
        // 1. The "move earlier" check ensures next week < current pickup
        // 2. The "48-hour minimum" check ensures adequate lead time
        // Together, these prevent moving to dates that are too soon
        
        // Normalize to allowed pickup day (Mon-Thu) - usually already Monday
        const nextWeekDeliveryUTC = normalizeToAllowedPickupDay(nextWeekUTC);
        
        // Update both dates together to keep them in sync
        updates.nextDeliveryDate = nextWeekDeliveryUTC;
        updates.nextChargeAt = nextWeekDeliveryUTC;
      }
      
      // Handle delay (server-side calculation prevents client manipulation)
      if (validated.weeksToDelay) {
        const currentDate = subscription.nextDeliveryDate 
          ? new Date(subscription.nextDeliveryDate)
          : new Date();
        
        const tentativeNewDate = new Date(currentDate);
        tentativeNewDate.setDate(tentativeNewDate.getDate() + (validated.weeksToDelay * 7));
        
        // Normalize to allowed pickup day (Mon-Thu)
        const newDate = normalizeToAllowedPickupDay(tentativeNewDate);
        
        // Update both dates together to keep them in sync
        updates.nextDeliveryDate = newDate;
        updates.nextChargeAt = newDate;
      }
      
      // Update subscription with server-computed values
      const updated = await storage.updateSubscription(subscriptionId, updates);
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

  // Create Stripe billing portal session for payment method updates
  app.post("/api/create-billing-portal", isAuthenticated, async (req: any, res) => {
    try {
      if (!stripe) {
        return res.status(500).json({ message: "Stripe is not configured" });
      }

      const userId = req.user.id;
      const user = await storage.getUser(userId);
      
      if (!user || !user.stripeCustomerId) {
        return res.status(400).json({ message: "No Stripe customer found. Please contact support." });
      }

      // Create billing portal session
      const session = await stripe.billingPortal.sessions.create({
        customer: user.stripeCustomerId,
        return_url: `${req.headers.origin || 'http://localhost:5000'}/my-subscriptions`,
      });

      res.json({ url: session.url });
    } catch (error: any) {
      console.error("[BILLING PORTAL] Error creating session:", error);
      res.status(500).json({ message: "Failed to create billing portal session: " + error.message });
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

  // Send wholesale customer CSV template via email
  app.post("/api/wholesale/customers/send-template", isAuthenticated, isAdmin, async (req, res) => {
    try {
      const { email } = req.body;
      if (!email) {
        return res.status(400).json({ message: "Email address required" });
      }

      const { sendFileEmail } = await import('./email.js');
      await sendFileEmail({
        to: email,
        subject: 'Wholesale Customer Import Template - Puget Sound Kombucha Co.',
        message: `Hello,

Here's the CSV template for importing wholesale customers into your system.

The template includes the following columns:
• businessName - The name of the wholesale business
• contactName - Primary contact person's full name  
• email - Primary contact email (used for login)
• additionalEmails - Optional additional authorized emails separated by pipes (|)
• phone - Business phone number
• address - Full business address
• allowOnlinePayment - Set to "true" to enable online payment, "false" for invoice-only

Instructions:
1. Fill in your customer data following the example rows provided
2. Multiple email addresses can be listed in additionalEmails separated by | (pipe) characters
3. All listed email addresses can be used to log in via email verification code
4. Save the file and use the CSV import feature in your admin dashboard

If you have any questions, please don't hesitate to reach out!`,
        attachmentPath: 'wholesale_customers_import_template.csv',
        attachmentFilename: 'wholesale_customers_import_template.csv',
      });

      res.json({ message: "Template sent successfully" });
    } catch (error: any) {
      console.error('[API] Failed to send template email:', error);
      res.status(500).json({ message: "Failed to send template: " + error.message });
    }
  });

  // Import wholesale customers from CSV
  app.post("/api/wholesale/customers/import", isAuthenticated, isAdmin, async (req, res) => {
    try {
      const { csvData } = req.body;
      if (!csvData || !Array.isArray(csvData)) {
        return res.status(400).json({ message: "Invalid CSV data format" });
      }

      const results = await storage.importWholesaleCustomers(csvData);
      res.json(results);
    } catch (error: any) {
      console.error('[API] CSV import error:', error);
      res.status(500).json({ message: "Import failed: " + error.message });
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
      const { date, startDate, endDate } = req.query;
      
      // Handle weekly date range query
      if (startDate && endDate) {
        if (typeof startDate !== 'string' || typeof endDate !== 'string') {
          return res.status(400).json({ message: "Start and end dates must be strings" });
        }
        
        const start = new Date(startDate);
        const end = new Date(endDate);
        
        if (isNaN(start.getTime()) || isNaN(end.getTime())) {
          return res.status(400).json({ message: "Invalid date format" });
        }
        
        const orders = await storage.getWholesaleOrdersByDeliveryDateRange(start, end);
        return res.json(orders);
      }
      
      // Handle single date query (daily)
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
        if (!item.unitTypeId || !item.flavorId || !item.quantity || item.quantity <= 0) {
          return res.status(400).json({ message: "Invalid item data: unitTypeId, flavorId, and quantity are required" });
        }
        
        const unitType = await storage.getWholesaleUnitType(item.unitTypeId);
        if (!unitType) {
          return res.status(404).json({ message: `Unit type ${item.unitTypeId} not found` });
        }
        
        // Verify flavor exists
        const allFlavors = await storage.getFlavors();
        const flavor = allFlavors.find(f => f.id === item.flavorId);
        if (!flavor) {
          return res.status(400).json({ message: `Flavor ${item.flavorId} not found` });
        }
        
        // Check for customer-specific pricing
        const customPricing = await storage.getWholesaleCustomerPrice(order.customerId, item.unitTypeId);
        const unitPrice = customPricing ? Number(customPricing.customPrice) : Number(unitType.defaultPrice);
        const itemTotal = unitPrice * item.quantity;
        serverCalculatedTotal += itemTotal;
        
        validatedItems.push({
          unitTypeId: item.unitTypeId,
          flavorId: item.flavorId,
          quantity: item.quantity,
          unitPrice: unitPrice.toFixed(2),
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
          unitTypeId: item.unitTypeId,
          flavorId: item.flavorId,
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

  app.get("/api/wholesale/all-order-items", isAuthenticated, isStaffOrAdmin, async (req, res) => {
    try {
      const items = await storage.getAllWholesaleOrderItems();
      res.json(items);
    } catch (error: any) {
      res.status(500).json({ message: "Error fetching all order items: " + error.message });
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

  app.get("/api/wholesale/pricing/all", isAuthenticated, isStaffOrAdmin, async (req, res) => {
    try {
      const pricing = await storage.getAllWholesalePricing();
      res.json(pricing);
    } catch (error: any) {
      res.status(500).json({ message: "Error fetching pricing: " + error.message });
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
      const { customerId, productTypeId, customPrice } = req.body;
      
      if (!customerId || !productTypeId || !customPrice) {
        return res.status(400).json({ message: "customerId, productTypeId, and customPrice are required" });
      }

      const pricing = await storage.setWholesalePrice({
        customerId,
        productTypeId,
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

      const baseUrl = process.env.REPLIT_DOMAINS
        ? `https://${process.env.REPLIT_DOMAINS.split(',')[0]}`
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
        payment_method_types: ['card'],
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
          const pricing = await getProductPricing(item.productId);
          return {
            ...item,
            product: product && pricing ? {
              id: product.id,
              name: product.name,
              retailPrice: pricing.retailPrice,
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

  // Retail Cart V2 routes (new schema)
  app.get("/api/retail-cart", async (req, res) => {
    try {
      const sessionId = req.sessionID || "guest";
      const items = await storage.getRetailCart(sessionId);
      res.json(items);
    } catch (error: any) {
      res.status(500).json({ message: "Error fetching retail cart: " + error.message });
    }
  });

  app.post("/api/retail-cart", async (req, res) => {
    try {
      const sessionId = req.sessionID || "guest";
      const { retailProductId, selectedFlavorId, quantity, isSubscription, subscriptionFrequency } = req.body;
      
      // Validate that multi-flavor products have a selected flavor
      const product = await storage.getRetailProduct(retailProductId);
      if (!product) {
        return res.status(404).json({ message: "Product not found" });
      }
      
      if (product.productType === 'multi-flavor' && !selectedFlavorId) {
        return res.status(400).json({ message: "Please select a flavor for this variety pack" });
      }
      
      const cartItem = await storage.addRetailProductToCart({
        sessionId,
        retailProductId,
        selectedFlavorId: selectedFlavorId || null,
        quantity: quantity || 1,
        isSubscription: isSubscription || false,
        subscriptionFrequency: isSubscription ? subscriptionFrequency : null,
      });
      
      res.json(cartItem);
    } catch (error: any) {
      res.status(400).json({ message: "Error adding to retail cart: " + error.message });
    }
  });

  app.patch("/api/retail-cart/:id", async (req, res) => {
    try {
      const { quantity } = req.body;
      const parsedQuantity = Number(quantity);
      
      if (!Number.isFinite(parsedQuantity) || parsedQuantity < 1) {
        return res.status(400).json({ message: "Invalid quantity" });
      }
      
      const updated = await storage.updateRetailCartItemQuantity(req.params.id, parsedQuantity);
      res.json(updated);
    } catch (error: any) {
      res.status(500).json({ message: "Error updating retail cart item: " + error.message });
    }
  });

  app.delete("/api/retail-cart/:id", async (req, res) => {
    try {
      await storage.removeRetailCartItem(req.params.id);
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ message: "Error removing from retail cart: " + error.message });
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

  // Customer-facing order history endpoint
  app.get("/api/my-orders", isAuthenticated, async (req: any, res) => {
    try {
      if (!req.user) {
        return res.status(401).json({ message: "Not authenticated" });
      }
      
      const orders = await storage.getRetailOrdersByUserId(req.user.id);
      res.json(orders);
    } catch (error: any) {
      console.error("Error fetching user orders:", error);
      res.status(500).json({ message: "Failed to fetch orders" });
    }
  });

  // Resend order confirmation email
  app.post("/api/orders/:orderId/resend-email", isAuthenticated, async (req: any, res) => {
    try {
      const orderId = req.params.orderId;
      
      // Get the order
      const order = await storage.getRetailOrder(orderId);
      if (!order) {
        return res.status(404).json({ message: "Order not found" });
      }

      // Verify user owns this order or is staff
      if (order.userId !== req.user!.id && req.user!.role !== 'staff' && req.user!.role !== 'admin' && req.user!.role !== 'super_admin') {
        return res.status(403).json({ message: "Not authorized to resend email for this order" });
      }

      // Collect order items for email
      const { sendOrderReceiptEmail } = await import('./email');
      const orderItems = [];
      
      // Get legacy order items
      const legacyItems = await db
        .select({
          id: retailOrderItems.id,
          orderId: retailOrderItems.orderId,
          productId: retailOrderItems.productId,
          quantity: retailOrderItems.quantity,
          unitPrice: retailOrderItems.unitPrice,
          product: products,
        })
        .from(retailOrderItems)
        .innerJoin(products, eq(products.id, retailOrderItems.productId))
        .where(eq(retailOrderItems.orderId, orderId));
        
      for (const item of legacyItems) {
        if (item.product) {
          orderItems.push({
            productName: item.product.name,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
          });
        }
      }
      
      // Get retail v2 items
      const v2Items = await db
        .select({
          id: retailOrderItemsV2.id,
          orderId: retailOrderItemsV2.orderId,
          retailProductId: retailOrderItemsV2.retailProductId,
          quantity: retailOrderItemsV2.quantity,
          unitPrice: retailOrderItemsV2.unitPrice,
          retailProduct: retailProducts,
          flavor: flavors,
        })
        .from(retailOrderItemsV2)
        .innerJoin(retailProducts, eq(retailProducts.id, retailOrderItemsV2.retailProductId))
        .innerJoin(flavors, eq(flavors.id, retailProducts.flavorId))
        .where(eq(retailOrderItemsV2.orderId, orderId));
      
      for (const item of v2Items) {
        if (item.retailProduct && item.flavor) {
          const productName = `${item.flavor.name} - ${item.retailProduct.unitDescription}`;
          orderItems.push({
            productName,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
          });
        }
      }

      if (orderItems.length === 0) {
        return res.status(400).json({ message: "No order items found to send in email" });
      }

      // Send the email
      await sendOrderReceiptEmail({
        customerEmail: order.customerEmail,
        customerName: order.customerName,
        orderNumber: order.orderNumber,
        orderItems,
        subtotal: parseFloat(order.subtotal),
        taxAmount: order.taxAmount ? parseFloat(order.taxAmount) : undefined,
        total: parseFloat(order.totalAmount),
        orderType: order.isSubscriptionOrder ? 'subscription' : 'one-time',
      });

      console.log(`[EMAIL] Manually resent order confirmation for ${order.orderNumber} to ${order.customerEmail}`);
      
      res.json({ 
        success: true, 
        message: `Order confirmation email sent to ${order.customerEmail}` 
      });
    } catch (error: any) {
      console.error("Error resending order email:", error);
      res.status(500).json({ message: error.message || "Failed to resend order confirmation email" });
    }
  });

  // Retail orders routes (staff and admin access)
  app.get("/api/retail/orders", isAuthenticated, isStaffOrAdmin, async (req, res) => {
    try {
      const orders = await storage.getRetailOrders();
      res.json(orders);
    } catch (error: any) {
      console.error("Error fetching retail orders:", error);
      res.status(500).json({ message: "Failed to fetch retail orders" });
    }
  });

  app.patch("/api/retail/orders/:id/status", isAuthenticated, isStaffOrAdmin, async (req, res) => {
    try {
      const statusSchema = z.object({
        status: z.enum(['pending', 'ready_for_pickup', 'fulfilled', 'cancelled']),
      });
      
      const parsed = statusSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid status value" });
      }
      
      const userId = parsed.data.status === 'fulfilled' ? req.user?.id : undefined;
      const order = await storage.updateRetailOrderStatus(req.params.id, parsed.data.status, userId);
      if (!order) {
        return res.status(404).json({ message: "Order not found" });
      }
      
      // Send ready for pickup email
      if (parsed.data.status === 'ready_for_pickup') {
        try {
          const { sendReadyForPickupEmail } = await import('./email');
          const orderItems = [];
          
          // Get legacy order items
          const legacyItems = await db
            .select({
              id: retailOrderItems.id,
              orderId: retailOrderItems.orderId,
              productId: retailOrderItems.productId,
              quantity: retailOrderItems.quantity,
              unitPrice: retailOrderItems.unitPrice,
              product: products,
            })
            .from(retailOrderItems)
            .innerJoin(products, eq(products.id, retailOrderItems.productId))
            .where(eq(retailOrderItems.orderId, req.params.id));
            
          for (const item of legacyItems) {
            if (item.product) {
              orderItems.push({
                productName: item.product.name,
                quantity: item.quantity,
              });
            }
          }
          
          // Get retail v2 items
          const v2Items = await db
            .select({
              id: retailOrderItemsV2.id,
              orderId: retailOrderItemsV2.orderId,
              retailProductId: retailOrderItemsV2.retailProductId,
              quantity: retailOrderItemsV2.quantity,
              unitPrice: retailOrderItemsV2.unitPrice,
              retailProduct: retailProducts,
              flavor: flavors,
            })
            .from(retailOrderItemsV2)
            .innerJoin(retailProducts, eq(retailProducts.id, retailOrderItemsV2.retailProductId))
            .innerJoin(flavors, eq(flavors.id, retailProducts.flavorId))
            .where(eq(retailOrderItemsV2.orderId, req.params.id));
          
          for (const item of v2Items) {
            if (item.retailProduct && item.flavor) {
              const productName = `${item.flavor.name} - ${item.retailProduct.unitDescription}`;
              orderItems.push({
                productName,
                quantity: item.quantity,
              });
            }
          }

          if (orderItems.length > 0) {
            await sendReadyForPickupEmail({
              customerEmail: order.customerEmail,
              customerName: order.customerName,
              orderNumber: order.orderNumber,
              orderItems,
            });
            console.log(`[EMAIL] Sent ready for pickup notification for order ${order.orderNumber}`);
          }
        } catch (emailError: any) {
          console.error('[EMAIL] Failed to send ready for pickup notification:', emailError);
          // Don't fail the status update if email fails
        }
      }
      
      res.json(order);
    } catch (error: any) {
      console.error("Error updating retail order status:", error);
      res.status(500).json({ message: "Failed to update retail order status" });
    }
  });

  app.post("/api/retail/orders/:id/cancel-with-refund", isAuthenticated, isStaffOrAdmin, async (req, res) => {
    try {
      if (!stripe) {
        return res.status(500).json({ message: "Stripe is not configured" });
      }

      const order = await storage.getRetailOrder(req.params.id);
      if (!order) {
        return res.status(404).json({ message: "Order not found" });
      }

      if (order.status === 'cancelled') {
        return res.status(400).json({ message: "Order is already cancelled" });
      }

      if (order.status === 'fulfilled') {
        return res.status(400).json({ message: "Cannot cancel a fulfilled order" });
      }

      if (!order.stripePaymentIntentId) {
        return res.status(400).json({ message: "No payment found for this order" });
      }

      // Cancel order and restore inventory in a transaction FIRST
      // This ensures database consistency even if Stripe refund fails
      let orderCancelled = false;
      try {
        await storage.cancelRetailOrderWithInventoryRestore(
          req.params.id,
          req.user!.id,
          `Order ${order.orderNumber} cancelled - pending refund`
        );
        orderCancelled = true;
        console.log('[CANCEL ORDER] Order cancelled and inventory restored for order:', order.orderNumber);
      } catch (dbError: any) {
        // Database transaction failed - order is NOT cancelled
        console.error('[CANCEL ORDER] Database transaction failed:', dbError);
        return res.status(500).json({ 
          message: "Failed to cancel order in database",
          details: dbError.message 
        });
      }

      // Process refund via Stripe AFTER database transaction succeeds
      // If this fails, the order is cancelled but we can retry the refund manually
      try {
        const refund = await stripe.refunds.create({
          payment_intent: order.stripePaymentIntentId,
        });

        console.log('[CANCEL ORDER] Refund created:', refund.id, 'for order:', order.orderNumber);

        res.json({ 
          success: true, 
          refundId: refund.id,
          message: "Order cancelled and refund processed successfully" 
        });
      } catch (refundError: any) {
        // Order is already cancelled, but refund failed
        // Log the error and return appropriate message to staff
        console.error('[CANCEL ORDER] Stripe refund failed for cancelled order:', order.orderNumber, refundError);
        
        return res.status(500).json({ 
          message: "Order was cancelled and inventory restored, but Stripe refund failed. Please manually issue refund in Stripe Dashboard.",
          orderNumber: order.orderNumber,
          orderId: order.id,
          paymentIntentId: order.stripePaymentIntentId,
          stripeError: refundError.message,
          action: "Issue refund manually or retry this endpoint"
        });
      }
    } catch (error: any) {
      // Unexpected error
      console.error("Unexpected error in cancel-with-refund:", error);
      res.status(500).json({ message: error.message || "Unexpected error occurred" });
    }
  });

  // Refund deposit for retail order
  app.post("/api/retail/orders/:id/refund-deposit", isAuthenticated, isStaffOrAdmin, async (req, res) => {
    try {
      if (!stripe) {
        return res.status(500).json({ message: "Stripe is not configured" });
      }

      const order = await storage.getRetailOrder(req.params.id);
      if (!order) {
        return res.status(404).json({ message: "Order not found" });
      }

      if (!order.stripePaymentIntentId) {
        return res.status(400).json({ message: "No payment found for this order" });
      }

      const depositAmount = parseFloat(order.depositAmount?.toString() || '0');
      if (depositAmount <= 0) {
        return res.status(400).json({ message: "No deposit to refund for this order" });
      }

      if (order.depositRefundedAt) {
        return res.status(400).json({ message: "Deposit has already been refunded" });
      }

      // Process deposit refund via Stripe
      try {
        const depositAmountCents = Math.round(depositAmount * 100);
        const refund = await stripe.refunds.create({
          payment_intent: order.stripePaymentIntentId,
          amount: depositAmountCents, // Partial refund for deposit only
        });

        console.log('[REFUND DEPOSIT] Deposit refund created:', refund.id, 'for order:', order.orderNumber, 'amount:', depositAmount);

        // Update order to mark deposit as refunded
        await db
          .update(retailOrders)
          .set({
            depositRefundedAt: new Date(),
            depositRefundedByUserId: req.user!.id,
          })
          .where(eq(retailOrders.id, req.params.id));

        res.json({ 
          success: true, 
          refundId: refund.id,
          amount: depositAmount,
          message: `Deposit of $${depositAmount.toFixed(2)} refunded successfully` 
        });
      } catch (refundError: any) {
        console.error('[REFUND DEPOSIT] Stripe refund failed for order:', order.orderNumber, refundError);
        
        return res.status(500).json({ 
          message: "Stripe refund failed. Please manually issue refund in Stripe Dashboard.",
          orderNumber: order.orderNumber,
          orderId: order.id,
          depositAmount: depositAmount,
          paymentIntentId: order.stripePaymentIntentId,
          stripeError: refundError.message,
        });
      }
    } catch (error: any) {
      console.error("Unexpected error in refund-deposit:", error);
      res.status(500).json({ message: error.message || "Unexpected error occurred" });
    }
  });

  // Staff portal routes
  // Update wholesale order status
  app.patch("/api/staff/orders/:id/status", isAuthenticated, isStaffOrAdmin, async (req, res) => {
    try {
      const statusSchema = z.object({
        status: z.enum(['pending', 'processing', 'shipped', 'delivered', 'fulfilled']),
      });
      
      const parsed = statusSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid status value" });
      }
      
      // If setting to fulfilled, call special fulfillment method
      if (parsed.data.status === 'fulfilled' && req.user?.id) {
        const order = await storage.updateWholesaleOrderFulfillment(req.params.id, req.user.id);
        if (!order) {
          return res.status(404).json({ message: "Order not found" });
        }
        return res.json(order);
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

  app.post("/api/impersonate/start", isAuthenticated, isSuperAdmin, async (req: any, res) => {
    try {
      const { targetUserId } = req.body;
      const originalUser = req.originalUser || req.user;
      
      if (!originalUser) {
        return res.status(401).json({ message: "Unauthorized" });
      }
      
      if (!targetUserId) {
        return res.status(400).json({ message: "Target user ID is required" });
      }
      
      if (targetUserId === originalUser.id) {
        return res.status(400).json({ message: "Cannot impersonate yourself" });
      }
      
      const targetUser = await storage.getUser(targetUserId);
      if (!targetUser) {
        return res.status(404).json({ message: "User not found" });
      }
      
      const ipAddress = req.ip || req.headers['x-forwarded-for'] || req.connection.remoteAddress;
      const userAgent = req.headers['user-agent'];
      
      const log = await storage.startImpersonation(
        originalUser.id,
        targetUserId,
        typeof ipAddress === 'string' ? ipAddress : ipAddress?.[0],
        userAgent
      );
      
      req.session!.impersonation = {
        originalUserId: originalUser.id,
        impersonatedUserId: targetUserId,
        logId: log.id,
      };
      
      await new Promise<void>((resolve, reject) => {
        req.session!.save((err: any) => {
          if (err) reject(err);
          else resolve();
        });
      });
      
      res.json({ success: true, impersonatedUser: targetUser });
    } catch (error: any) {
      console.error("Error starting impersonation:", error);
      res.status(500).json({ message: "Failed to start impersonation" });
    }
  });

  app.post("/api/impersonate/stop", isAuthenticated, async (req: any, res) => {
    try {
      if (!req.session?.impersonation) {
        return res.status(400).json({ message: "Not currently impersonating" });
      }
      
      await storage.endImpersonation(req.session.impersonation.logId);
      delete req.session.impersonation;
      
      await new Promise<void>((resolve, reject) => {
        req.session!.save((err: any) => {
          if (err) reject(err);
          else resolve();
        });
      });
      
      res.json({ success: true });
    } catch (error: any) {
      console.error("Error stopping impersonation:", error);
      res.status(500).json({ message: "Failed to stop impersonation" });
    }
  });

  // ============================================
  // CRM - Lead Management Routes
  // ============================================

  // Get all leads with optional filters
  app.get("/api/crm/leads", isAuthenticated, isStaffOrAdmin, async (req, res) => {
    try {
      const { status, priorityLevel, assignedToUserId } = req.query;
      
      const filters: any = {};
      if (status) filters.status = status as string;
      if (priorityLevel) filters.priorityLevel = priorityLevel as string;
      if (assignedToUserId) filters.assignedToUserId = assignedToUserId as string;
      
      const leads = await storage.getLeads(filters);
      res.json(leads);
    } catch (error: any) {
      console.error("Error fetching leads:", error);
      res.status(500).json({ message: "Error fetching leads: " + error.message });
    }
  });

  // Search leads
  app.get("/api/crm/leads/search", isAuthenticated, isStaffOrAdmin, async (req, res) => {
    try {
      const { q } = req.query;
      
      if (!q || typeof q !== 'string') {
        return res.status(400).json({ message: "Search query is required" });
      }
      
      const leads = await storage.searchLeads(q);
      res.json(leads);
    } catch (error: any) {
      console.error("Error searching leads:", error);
      res.status(500).json({ message: "Error searching leads: " + error.message });
    }
  });

  // Get single lead by ID
  app.get("/api/crm/leads/:id", isAuthenticated, isStaffOrAdmin, async (req, res) => {
    try {
      const { id } = req.params;
      
      const lead = await storage.getLead(id);
      if (!lead) {
        return res.status(404).json({ message: "Lead not found" });
      }
      
      res.json(lead);
    } catch (error: any) {
      console.error("Error fetching lead:", error);
      res.status(500).json({ message: "Error fetching lead: " + error.message });
    }
  });

  // Create new lead
  app.post("/api/crm/leads", isAuthenticated, isStaffOrAdmin, async (req: any, res) => {
    try {
      const { businessName, contactName, email, phone, priorityLevel, status, notes, assignedToUserId } = req.body;
      
      if (!businessName || !contactName) {
        return res.status(400).json({ message: "Business name and contact name are required" });
      }
      
      const lead = await storage.createLead({
        businessName,
        contactName,
        email,
        phone,
        priorityLevel: priorityLevel || 'medium',
        status: status || 'new',
        notes,
        assignedToUserId,
      });
      
      res.status(201).json(lead);
    } catch (error: any) {
      console.error("Error creating lead:", error);
      res.status(500).json({ message: "Error creating lead: " + error.message });
    }
  });

  // Update lead
  app.patch("/api/crm/leads/:id", isAuthenticated, isStaffOrAdmin, async (req, res) => {
    try {
      const { id } = req.params;
      const updates = req.body;
      
      const lead = await storage.updateLead(id, updates);
      if (!lead) {
        return res.status(404).json({ message: "Lead not found" });
      }
      
      res.json(lead);
    } catch (error: any) {
      console.error("Error updating lead:", error);
      res.status(500).json({ message: "Error updating lead: " + error.message });
    }
  });

  // Delete lead
  app.delete("/api/crm/leads/:id", isAuthenticated, isStaffOrAdmin, async (req, res) => {
    try {
      const { id } = req.params;
      
      await storage.deleteLead(id);
      res.json({ message: "Lead deleted successfully" });
    } catch (error: any) {
      console.error("Error deleting lead:", error);
      res.status(500).json({ message: "Error deleting lead: " + error.message });
    }
  });

  // ============================================
  // CRM - Touch Point Management Routes
  // ============================================

  // Get touch points for a lead
  app.get("/api/crm/leads/:id/touchpoints", isAuthenticated, isStaffOrAdmin, async (req, res) => {
    try {
      const { id } = req.params;
      
      const touchPoints = await storage.getLeadTouchPoints(id);
      res.json(touchPoints);
    } catch (error: any) {
      console.error("Error fetching touch points:", error);
      res.status(500).json({ message: "Error fetching touch points: " + error.message });
    }
  });

  // Create new touch point
  app.post("/api/crm/leads/:id/touchpoints", isAuthenticated, isStaffOrAdmin, async (req: any, res) => {
    try {
      const { id } = req.params;
      const { type, subject, notes } = req.body;
      
      if (!type || !subject) {
        return res.status(400).json({ message: "Type and subject are required" });
      }
      
      const touchPoint = await storage.createLeadTouchPoint({
        leadId: id,
        type,
        subject,
        notes,
        createdByUserId: req.user.id,
      });
      
      res.status(201).json(touchPoint);
    } catch (error: any) {
      console.error("Error creating touch point:", error);
      res.status(500).json({ message: "Error creating touch point: " + error.message });
    }
  });

  // Get recent touch points across all leads
  app.get("/api/crm/touchpoints/recent", isAuthenticated, isStaffOrAdmin, async (req, res) => {
    try {
      const limit = req.query.limit ? parseInt(req.query.limit as string) : 10;
      
      const touchPoints = await storage.getRecentTouchPoints(limit);
      res.json(touchPoints);
    } catch (error: any) {
      console.error("Error fetching recent touch points:", error);
      res.status(500).json({ message: "Error fetching recent touch points: " + error.message });
    }
  });

  const httpServer = createServer(app);

  return httpServer;
}
