import type { Express } from "express";
import { createServer, type Server } from "http";
import Stripe from "stripe";
import { storage } from "./storage";
import { insertSubscriptionSchema } from "@shared/schema";
import { setupAuth, isAuthenticated } from "./replitAuth";

const stripe = process.env.STRIPE_SECRET_KEY 
  ? new Stripe(process.env.STRIPE_SECRET_KEY, {
      apiVersion: "2024-11-20.acacia",
    })
  : null;

export async function registerRoutes(app: Express): Promise<Server> {
  // Auth middleware
  await setupAuth(app);

  // Auth routes
  app.get('/api/auth/user', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const user = await storage.getUser(userId);
      res.json(user);
    } catch (error: any) {
      console.error("Error fetching user:", error);
      res.status(500).json({ message: "Failed to fetch user" });
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

  // Create Stripe subscription intent
  app.post("/api/create-subscription-intent", async (req, res) => {
    try {
      if (!stripe) {
        return res.status(503).json({ message: "Payment processing is not configured. Please contact support." });
      }

      const { planId } = req.body;
      const plan = await storage.getSubscriptionPlan(planId);
      
      if (!plan) {
        return res.status(404).json({ message: "Plan not found" });
      }

      const paymentIntent = await stripe.paymentIntents.create({
        amount: Math.round(Number(plan.price) * 100),
        currency: "usd",
        automatic_payment_methods: {
          enabled: true,
        },
      });

      res.json({ clientSecret: paymentIntent.client_secret });
    } catch (error: any) {
      res.status(500).json({ message: "Error creating payment intent: " + error.message });
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

  // Cart routes
  app.get("/api/cart", async (req, res) => {
    try {
      const sessionId = req.sessionID || "guest";
      const cartItems = await storage.getCartItems(sessionId);
      res.json(cartItems);
    } catch (error: any) {
      res.status(500).json({ message: "Error fetching cart: " + error.message });
    }
  });

  app.post("/api/cart", async (req, res) => {
    try {
      const sessionId = req.sessionID || "guest";
      const { productId, quantity } = req.body;
      
      const cartItem = await storage.addToCart({
        sessionId,
        productId,
        quantity: quantity || 1,
      });
      
      res.json(cartItem);
    } catch (error: any) {
      res.status(400).json({ message: "Error adding to cart: " + error.message });
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

  const httpServer = createServer(app);

  return httpServer;
}
