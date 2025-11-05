import { 
  type Product, type InsertProduct,
  type SubscriptionPlan, type InsertSubscriptionPlan,
  type CartItem, type InsertCartItem,
  type Subscription, type InsertSubscription,
  type WholesaleCustomer, type InsertWholesaleCustomer,
  type WholesaleOrder, type InsertWholesaleOrder,
  type WholesaleOrderItem, type InsertWholesaleOrderItem,
  type User, type UpsertUser,
  products,
  subscriptionPlans,
  cartItems,
  subscriptions,
  wholesaleCustomers,
  wholesaleOrders,
  wholesaleOrderItems,
  users
} from "@shared/schema";
import { drizzle } from "drizzle-orm/neon-serverless";
import { eq } from "drizzle-orm";
import { Pool, neonConfig } from "@neondatabase/serverless";
import ws from "ws";

neonConfig.webSocketConstructor = ws;

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const db = drizzle(pool);

export interface IStorage {
  getUser(id: string): Promise<User | undefined>;
  upsertUser(user: UpsertUser): Promise<User>;
  
  getProducts(): Promise<Product[]>;
  getProduct(id: string): Promise<Product | undefined>;
  createProduct(product: InsertProduct): Promise<Product>;
  updateProductStock(id: string, stockQuantity: number): Promise<Product | undefined>;
  getLowStockProducts(): Promise<Product[]>;
  
  getSubscriptionPlans(): Promise<SubscriptionPlan[]>;
  getSubscriptionPlan(id: string): Promise<SubscriptionPlan | undefined>;
  createSubscriptionPlan(plan: InsertSubscriptionPlan): Promise<SubscriptionPlan>;
  
  getCartItems(sessionId: string): Promise<CartItem[]>;
  addToCart(item: InsertCartItem): Promise<CartItem>;
  removeFromCart(id: string): Promise<void>;
  clearCart(sessionId: string): Promise<void>;
  
  getSubscriptions(): Promise<Subscription[]>;
  getUserSubscriptions(userId: string): Promise<Subscription[]>;
  getSubscriptionByStripeId(stripeSubscriptionId: string): Promise<Subscription | undefined>;
  createSubscription(subscription: InsertSubscription): Promise<Subscription>;
  updateSubscriptionByStripeId(stripeSubscriptionId: string, updates: Partial<Subscription>): Promise<Subscription | undefined>;
  
  getWholesaleCustomers(): Promise<WholesaleCustomer[]>;
  getWholesaleCustomer(id: string): Promise<WholesaleCustomer | undefined>;
  createWholesaleCustomer(customer: InsertWholesaleCustomer): Promise<WholesaleCustomer>;
  
  getWholesaleOrders(): Promise<WholesaleOrder[]>;
  getWholesaleOrder(id: string): Promise<WholesaleOrder | undefined>;
  createWholesaleOrder(order: InsertWholesaleOrder): Promise<WholesaleOrder>;
  
  getWholesaleOrderItems(orderId: string): Promise<WholesaleOrderItem[]>;
  createWholesaleOrderItem(item: InsertWholesaleOrderItem): Promise<WholesaleOrderItem>;
  
  seedData(): Promise<void>;
}

export class PostgresStorage implements IStorage {
  async getUser(id: string): Promise<User | undefined> {
    const result = await db.select().from(users).where(eq(users.id, id));
    return result[0];
  }

  async upsertUser(userData: UpsertUser): Promise<User> {
    const result = await db
      .insert(users)
      .values(userData)
      .onConflictDoUpdate({
        target: users.id,
        set: {
          ...userData,
          updatedAt: new Date(),
        },
      })
      .returning();
    return result[0];
  }

  async getProducts(): Promise<Product[]> {
    return await db.select().from(products);
  }

  async getProduct(id: string): Promise<Product | undefined> {
    const result = await db.select().from(products).where(eq(products.id, id));
    return result[0];
  }

  async createProduct(insertProduct: InsertProduct): Promise<Product> {
    const result = await db.insert(products).values(insertProduct).returning();
    return result[0];
  }

  async updateProductStock(id: string, stockQuantity: number): Promise<Product | undefined> {
    const result = await db
      .update(products)
      .set({ stockQuantity, inStock: stockQuantity > 0 })
      .where(eq(products.id, id))
      .returning();
    return result[0];
  }

  async getLowStockProducts(): Promise<Product[]> {
    const allProducts = await db.select().from(products);
    return allProducts.filter(p => p.stockQuantity <= p.lowStockThreshold);
  }

  async getSubscriptionPlans(): Promise<SubscriptionPlan[]> {
    return await db.select().from(subscriptionPlans);
  }

  async getSubscriptionPlan(id: string): Promise<SubscriptionPlan | undefined> {
    const result = await db.select().from(subscriptionPlans).where(eq(subscriptionPlans.id, id));
    return result[0];
  }

  async createSubscriptionPlan(plan: InsertSubscriptionPlan): Promise<SubscriptionPlan> {
    const result = await db.insert(subscriptionPlans).values(plan).returning();
    return result[0];
  }

  async getCartItems(sessionId: string): Promise<CartItem[]> {
    return await db.select().from(cartItems).where(eq(cartItems.sessionId, sessionId));
  }

  async addToCart(item: InsertCartItem): Promise<CartItem> {
    const result = await db.insert(cartItems).values(item).returning();
    return result[0];
  }

  async removeFromCart(id: string): Promise<void> {
    await db.delete(cartItems).where(eq(cartItems.id, id));
  }

  async clearCart(sessionId: string): Promise<void> {
    await db.delete(cartItems).where(eq(cartItems.sessionId, sessionId));
  }

  async getSubscriptions(): Promise<Subscription[]> {
    return await db.select().from(subscriptions);
  }

  async getUserSubscriptions(userId: string): Promise<Subscription[]> {
    return await db.select().from(subscriptions).where(eq(subscriptions.userId, userId));
  }

  async getSubscriptionByStripeId(stripeSubscriptionId: string): Promise<Subscription | undefined> {
    const result = await db.select().from(subscriptions).where(eq(subscriptions.stripeSubscriptionId, stripeSubscriptionId));
    return result[0];
  }

  async createSubscription(subscription: InsertSubscription): Promise<Subscription> {
    const result = await db.insert(subscriptions).values(subscription).returning();
    return result[0];
  }

  async updateSubscriptionByStripeId(stripeSubscriptionId: string, updates: Partial<Subscription>): Promise<Subscription | undefined> {
    const result = await db
      .update(subscriptions)
      .set(updates)
      .where(eq(subscriptions.stripeSubscriptionId, stripeSubscriptionId))
      .returning();
    return result[0];
  }

  async getWholesaleCustomers(): Promise<WholesaleCustomer[]> {
    return await db.select().from(wholesaleCustomers);
  }

  async getWholesaleCustomer(id: string): Promise<WholesaleCustomer | undefined> {
    const result = await db.select().from(wholesaleCustomers).where(eq(wholesaleCustomers.id, id));
    return result[0];
  }

  async createWholesaleCustomer(customer: InsertWholesaleCustomer): Promise<WholesaleCustomer> {
    const result = await db.insert(wholesaleCustomers).values(customer).returning();
    return result[0];
  }

  async getWholesaleOrders(): Promise<WholesaleOrder[]> {
    return await db.select().from(wholesaleOrders);
  }

  async getWholesaleOrder(id: string): Promise<WholesaleOrder | undefined> {
    const result = await db.select().from(wholesaleOrders).where(eq(wholesaleOrders.id, id));
    return result[0];
  }

  async createWholesaleOrder(order: InsertWholesaleOrder): Promise<WholesaleOrder> {
    const result = await db.insert(wholesaleOrders).values(order).returning();
    return result[0];
  }

  async getWholesaleOrderItems(orderId: string): Promise<WholesaleOrderItem[]> {
    return await db.select().from(wholesaleOrderItems).where(eq(wholesaleOrderItems.orderId, orderId));
  }

  async createWholesaleOrderItem(item: InsertWholesaleOrderItem): Promise<WholesaleOrderItem> {
    const result = await db.insert(wholesaleOrderItems).values(item).returning();
    return result[0];
  }

  async seedData(): Promise<void> {
    const existingProducts = await this.getProducts();
    if (existingProducts.length > 0) {
      return;
    }

    await db.insert(products).values([
      {
        name: "Ginger Citrus Kombucha",
        description: "A refreshing blend of organic ginger and fresh citrus. Bright, zesty, and perfectly balanced.",
        flavor: "citrus ginger",
        abv: "0.5% ABV",
        ingredients: ["Organic green tea", "Fresh ginger", "Lemon", "Orange", "Raw cane sugar", "Live cultures"],
        retailPrice: "5.99",
        wholesalePrice: "3.50",
        imageUrl: "/src/assets/generated_images/Ginger_citrus_kombucha_product_7a9581af.png",
        inStock: true,
        stockQuantity: 150,
        lowStockThreshold: 50,
      },
      {
        name: "Berry Hibiscus Kombucha",
        description: "Deep berry flavors with floral hibiscus notes. Rich in antioxidants and naturally sweet.",
        flavor: "berry",
        abv: "0.5% ABV",
        ingredients: ["Organic black tea", "Strawberry", "Blueberry", "Hibiscus", "Raw cane sugar", "Live cultures"],
        retailPrice: "5.99",
        wholesalePrice: "3.50",
        imageUrl: "/src/assets/generated_images/Berry_hibiscus_kombucha_product_27481eb8.png",
        inStock: true,
        stockQuantity: 200,
        lowStockThreshold: 50,
      },
      {
        name: "Green Tea Mint Kombucha",
        description: "Cool mint paired with delicate green tea. Light, refreshing, and energizing.",
        flavor: "green tea",
        abv: "0.5% ABV",
        ingredients: ["Organic green tea", "Fresh mint", "Spearmint", "Raw cane sugar", "Live cultures"],
        retailPrice: "5.99",
        wholesalePrice: "3.50",
        imageUrl: "/src/assets/generated_images/Green_tea_mint_kombucha_eb3e813e.png",
        inStock: true,
        stockQuantity: 30,
        lowStockThreshold: 50,
      },
      {
        name: "Turmeric Ginger Kombucha",
        description: "Golden turmeric and warming ginger. Anti-inflammatory and bold in flavor.",
        flavor: "ginger",
        abv: "0.5% ABV",
        ingredients: ["Organic black tea", "Fresh turmeric", "Ginger", "Black pepper", "Raw cane sugar", "Live cultures"],
        retailPrice: "6.49",
        wholesalePrice: "3.75",
        imageUrl: "/src/assets/generated_images/Turmeric_ginger_kombucha_product_f7b46429.png",
        inStock: true,
        stockQuantity: 175,
        lowStockThreshold: 50,
      },
    ]);

    await db.insert(subscriptionPlans).values([
      {
        name: "Weekly Fresh",
        frequency: "weekly",
        bottleCount: 6,
        price: "32.99",
        savings: "Save 8%",
        benefits: [
          "6 bottles delivered weekly",
          "Mix and match any flavors",
          "Free local pickup",
          "Pause or cancel anytime",
        ],
      },
      {
        name: "Monthly Bundle",
        frequency: "monthly",
        bottleCount: 24,
        price: "119.99",
        savings: "Save 17%",
        benefits: [
          "24 bottles delivered monthly",
          "Choose your flavor mix",
          "Priority pickup times",
          "Exclusive subscriber flavors",
          "Pause or cancel anytime",
        ],
      },
      {
        name: "Bi-Weekly Select",
        frequency: "monthly",
        bottleCount: 12,
        price: "64.99",
        savings: "Save 10%",
        benefits: [
          "12 bottles every 2 weeks",
          "Flexible flavor selection",
          "Free local pickup",
          "Easy subscription management",
          "Pause or cancel anytime",
        ],
      },
    ]);

    const customerResults = await db.insert(wholesaleCustomers).values([
      {
        businessName: "Green Valley Cafe",
        contactName: "Sarah Johnson",
        email: "sarah@greenvalleycafe.com",
        phone: "(555) 123-4567",
        address: "123 Main St, Portland, OR 97201",
      },
      {
        businessName: "Wellness Studio",
        contactName: "Michael Chen",
        email: "michael@wellnessstudio.com",
        phone: "(555) 234-5678",
        address: "456 Oak Ave, Portland, OR 97202",
      },
    ]).returning();

    await db.insert(wholesaleOrders).values([
      {
        customerId: customerResults[0].id,
        status: "delivered",
        totalAmount: "210.00",
        notes: "Regular weekly order",
      },
      {
        customerId: customerResults[1].id,
        status: "pending",
        totalAmount: "157.50",
        notes: null,
      },
    ]);
  }
}

export const storage = new PostgresStorage();
