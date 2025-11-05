import type { Express } from "express";
import { createServer, type Server } from "http";
import Stripe from "stripe";
import { storage } from "./storage";
import { insertSubscriptionSchema } from "@shared/schema";
import { setupAuth, isAuthenticated } from "./replitAuth";
import { z } from "zod";

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

  // Create Stripe checkout session for one-time cart purchases
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
          
          return {
            price_data: {
              currency: 'usd',
              product_data: {
                name: product.name,
                images: imageUrl.startsWith('http') ? [imageUrl] : [],
              },
              unit_amount: Math.round(Number(product.retailPrice) * 100),
            },
            quantity: item.quantity,
          };
        })
      );

      const session = await stripe.checkout.sessions.create({
        mode: 'payment',
        line_items: lineItems,
        success_url: `${baseUrl}/checkout/success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${baseUrl}/shop`,
        metadata: {
          sessionId,
          type: 'cart_purchase',
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

  const httpServer = createServer(app);

  return httpServer;
}
