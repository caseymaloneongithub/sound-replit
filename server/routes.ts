import type { Express } from "express";
import { createServer, type Server } from "http";
import Stripe from "stripe";
import { storage } from "./storage";
import { insertSubscriptionSchema, insertWholesaleCustomerSchema, insertWholesaleOrderSchema } from "@shared/schema";
import { setupAuth, isAuthenticated } from "./auth";
import { z } from "zod";
import { sendVerificationCode, generateVerificationCode } from "./twilio";
import { getCasePriceCents } from "@shared/pricing";

const stripe = process.env.STRIPE_SECRET_KEY 
  ? new Stripe(process.env.STRIPE_SECRET_KEY, {
      apiVersion: "2024-11-20.acacia",
    })
  : null;

export async function registerRoutes(app: Express): Promise<Server> {
  // Auth middleware - sets up /api/register, /api/login, /api/logout, /api/user
  await setupAuth(app);

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

  // Product routes
  app.get("/api/products", async (req, res) => {
    try {
      const products = await storage.getProducts();
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
            return {
              price_data: {
                currency: 'usd',
                product_data: {
                  name: `${product.name} - Case of 12 (${item.subscriptionFrequency})`,
                  description: `${item.subscriptionFrequency === 'weekly' ? 'Weekly' : 'Bi-weekly'} subscription`,
                  images: imageUrl.startsWith('http') ? [imageUrl] : [],
                },
                unit_amount: casePrice,
                recurring: {
                  interval: item.subscriptionFrequency === 'weekly' ? 'week' as const : 'week' as const,
                  interval_count: item.subscriptionFrequency === 'weekly' ? 1 : 2,
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

      const session = await stripe.checkout.sessions.create({
        mode: hasSubscription ? 'subscription' : 'payment',
        line_items: lineItems,
        success_url: `${baseUrl}/checkout/success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${baseUrl}/shop`,
        metadata: {
          sessionId,
          type: hasSubscription ? 'subscription_purchase' : 'cart_purchase',
        },
      });

      res.json({ url: session.url, sessionId: session.id });
    } catch (error: any) {
      console.error("Cart checkout error:", error);
      res.status(500).json({ message: "Error creating checkout: " + error.message });
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

          const planId = session.metadata?.planId;
          if (!planId) {
            console.error("No planId in session metadata");
            break;
          }

          const plan = await storage.getSubscriptionPlan(planId);
          if (!plan) {
            console.error(`Plan ${planId} not found`);
            break;
          }

          const subscription = await stripe.subscriptions.retrieve(session.subscription as string);
          
          const existing = await storage.getSubscriptionByStripeId(subscription.id);
          if (existing) {
            console.log(`Subscription ${subscription.id} already exists, skipping creation`);
            break;
          }

          await storage.createSubscription({
            customerName: session.metadata?.customerName || session.customer_details?.name || 'Unknown',
            customerEmail: session.customer_details?.email || '',
            customerPhone: '',
            planId: plan.id,
            stripeSubscriptionId: subscription.id,
            stripeCustomerId: subscription.customer as string,
            status: 'active',
            nextDeliveryDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
          });
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
      const userId = req.user.claims.sub;
      const subscriptions = await storage.getUserSubscriptions(userId);
      res.json(subscriptions);
    } catch (error: any) {
      res.status(500).json({ message: "Error fetching user subscriptions: " + error.message });
    }
  });

  // Wholesale customer routes
  app.get("/api/wholesale/customers", async (req, res) => {
    try {
      const customers = await storage.getWholesaleCustomers();
      res.json(customers);
    } catch (error: any) {
      res.status(500).json({ message: "Error fetching customers: " + error.message });
    }
  });

  app.get("/api/wholesale/customers/:id", async (req, res) => {
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

  app.post("/api/wholesale/customers", async (req, res) => {
    try {
      const customer = insertWholesaleCustomerSchema.parse(req.body);
      const created = await storage.createWholesaleCustomer(customer);
      res.json(created);
    } catch (error: any) {
      res.status(400).json({ message: "Error creating customer: " + error.message });
    }
  });

  // Wholesale order routes
  app.get("/api/wholesale/orders", async (req, res) => {
    try {
      const orders = await storage.getWholesaleOrders();
      res.json(orders);
    } catch (error: any) {
      res.status(500).json({ message: "Error fetching orders: " + error.message });
    }
  });

  app.get("/api/wholesale/orders/:id", async (req, res) => {
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

  app.post("/api/wholesale/orders", async (req, res) => {
    try {
      const { order, items } = req.body;
      
      if (!items || !Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ message: "Order must contain at least one item" });
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
        
        const unitPrice = Number(product.wholesalePrice);
        const itemTotal = unitPrice * item.quantity;
        serverCalculatedTotal += itemTotal;
        
        validatedItems.push({
          productId: item.productId,
          quantity: item.quantity,
          unitPrice: product.wholesalePrice,
        });
      }
      
      const orderData = insertWholesaleOrderSchema.parse({
        ...order,
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

  app.get("/api/wholesale/orders/:id/items", async (req, res) => {
    try {
      const items = await storage.getWholesaleOrderItems(req.params.id);
      res.json(items);
    } catch (error: any) {
      res.status(500).json({ message: "Error fetching order items: " + error.message });
    }
  });

  app.patch("/api/wholesale/orders/:id", async (req, res) => {
    try {
      const { status } = req.body;
      
      if (!status || !['pending', 'processing', 'shipped', 'delivered'].includes(status)) {
        return res.status(400).json({ message: "Invalid status" });
      }

      const order = await storage.getWholesaleOrder(req.params.id);
      if (!order) {
        return res.status(404).json({ message: "Order not found" });
      }

      const updated = await storage.updateWholesaleOrderStatus(req.params.id, status);
      res.json(updated);
    } catch (error: any) {
      res.status(500).json({ message: "Error updating order: " + error.message });
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
  const isAdmin = async (req: any, res: any, next: any) => {
    try {
      if (!req.user?.claims?.sub) {
        return res.status(401).json({ message: "Unauthorized - please log in" });
      }
      
      const userId = req.user.claims.sub;
      const user = await storage.getUser(userId);
      
      if (!user?.isAdmin) {
        return res.status(403).json({ message: "Forbidden: Admin access required" });
      }
      
      next();
    } catch (error: any) {
      console.error("Error verifying admin status:", error);
      res.status(500).json({ message: "Error verifying admin status" });
    }
  };

  // Update wholesale order status
  app.patch("/api/staff/orders/:id/status", isAuthenticated, isAdmin, async (req, res) => {
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

  // Update product details
  app.patch("/api/staff/products/:id", isAuthenticated, isAdmin, async (req, res) => {
    try {
      const updateSchema = z.object({
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
      
      const parsed = updateSchema.safeParse(req.body);
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
    } catch (error: any) {
      console.error("Error updating product:", error);
      res.status(500).json({ message: "Failed to update product" });
    }
  });

  // Super admin middleware
  const isSuperAdmin = async (req: any, res: any, next: any) => {
    try {
      if (!req.user?.claims?.sub) {
        return res.status(401).json({ message: "Unauthorized - please log in" });
      }
      
      const userId = req.user.claims.sub;
      const user = await storage.getUser(userId);
      
      if (user?.role !== 'super_admin') {
        return res.status(403).json({ message: "Forbidden: Super admin access required" });
      }
      
      next();
    } catch (error: any) {
      console.error("Error verifying super admin status:", error);
      res.status(500).json({ message: "Error verifying super admin status" });
    }
  };

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
        role: z.enum(['user', 'admin', 'super_admin']),
      });
      
      const parsed = roleSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid role value" });
      }
      
      // Prevent super admins from demoting themselves
      const currentUserId = req.user.claims.sub;
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
