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
import { eq, and } from "drizzle-orm";
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
  updateCartItemQuantity(id: string, quantity: number): Promise<CartItem | undefined>;
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
    const existing = await db
      .select()
      .from(cartItems)
      .where(
        and(
          eq(cartItems.sessionId, item.sessionId),
          eq(cartItems.productId, item.productId)
        )
      );

    if (existing.length > 0) {
      const updated = await db
        .update(cartItems)
        .set({ quantity: existing[0].quantity + item.quantity })
        .where(eq(cartItems.id, existing[0].id))
        .returning();
      return updated[0];
    }

    const result = await db.insert(cartItems).values(item).returning();
    return result[0];
  }

  async updateCartItemQuantity(id: string, quantity: number): Promise<CartItem | undefined> {
    const result = await db
      .update(cartItems)
      .set({ quantity })
      .where(eq(cartItems.id, id))
      .returning();
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

  async updateWholesaleOrderStatus(id: string, status: string): Promise<WholesaleOrder> {
    const result = await db
      .update(wholesaleOrders)
      .set({ status })
      .where(eq(wholesaleOrders.id, id))
      .returning();
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
        name: "Island Hop",
        description: "It's hoppy, tropical, and fresh, and is a great option for someone craving a cold beer without the buzz. This blend is made with grapefruit and Cascade hops -- ingredients known to support the immune and cardiovascular systems.",
        flavor: "hoppy tropical",
        abv: "0.5% ABV",
        ingredients: ["Organic green tea", "Grapefruit", "Cascade hops", "Raw cane sugar", "Live cultures"],
        retailPrice: "6.49",
        wholesalePrice: "3.75",
        imageUrl: "/src/assets/generated_images/Ginger_citrus_kombucha_product_7a9581af.png",
        inStock: true,
        stockQuantity: 150,
        lowStockThreshold: 50,
      },
      {
        name: "Hummingbrew",
        description: "This gorgeous bottle showcases the White Peony and English Breakfast teas that make our classic kombucha so tasty. This combo of black and white teas is known for their healing and immunity-boosting properties.",
        flavor: "classic tea",
        abv: "0.5% ABV",
        ingredients: ["White Peony tea", "English Breakfast tea", "Raw cane sugar", "Live cultures"],
        retailPrice: "5.99",
        wholesalePrice: "3.50",
        imageUrl: "/src/assets/generated_images/Berry_hibiscus_kombucha_product_27481eb8.png",
        inStock: true,
        stockQuantity: 200,
        lowStockThreshold: 50,
      },
      {
        name: "Mist",
        description: "Brewed with rose petals, giving it a pinkish color that shines through our new clear bottles. Natural energy booster Earl Grey is known for enhancing digestion and reducing stress.",
        flavor: "floral earl grey",
        abv: "0.5% ABV",
        ingredients: ["Earl Grey tea", "Rose petals", "Raw cane sugar", "Live cultures"],
        retailPrice: "5.99",
        wholesalePrice: "3.50",
        imageUrl: "/src/assets/generated_images/Berry_hibiscus_kombucha_product_27481eb8.png",
        inStock: true,
        stockQuantity: 175,
        lowStockThreshold: 50,
      },
      {
        name: "Northzest",
        description: "It's Lemon Zest with a slight kick! Our Northzest brew is citrusy, spicy, and tart. Metabolism-boosting cayenne pairs with energizing black tea, creating a blend good for both mind and body.",
        flavor: "citrus spicy",
        abv: "0.5% ABV",
        ingredients: ["Black tea", "Lemon zest", "Cayenne pepper", "Raw cane sugar", "Live cultures"],
        retailPrice: "6.49",
        wholesalePrice: "3.75",
        imageUrl: "/src/assets/generated_images/Ginger_citrus_kombucha_product_7a9581af.png",
        inStock: true,
        stockQuantity: 160,
        lowStockThreshold: 50,
      },
      {
        name: "Bonfire",
        description: "A warm, spiced, and earthy brew. We've added an ancient medicinal herb, ashwagandha, which is an adaptogen that is believed to have natural healing properties for both mind and body.",
        flavor: "warm spiced",
        abv: "0.5% ABV",
        ingredients: ["Black tea", "Ashwagandha", "Warming spices", "Raw cane sugar", "Live cultures"],
        retailPrice: "6.49",
        wholesalePrice: "3.75",
        imageUrl: "/src/assets/generated_images/Turmeric_ginger_kombucha_product_f7b46429.png",
        inStock: true,
        stockQuantity: 140,
        lowStockThreshold: 50,
      },
      {
        name: "Sunbreak",
        description: "Our best seller is bright, spicy, and juicy, and features powerful ashwaganda and medicinal herbs known to support digestive and brain health.",
        flavor: "bright spicy",
        abv: "0.5% ABV",
        ingredients: ["Black tea", "Ashwagandha", "Medicinal herbs", "Raw cane sugar", "Live cultures"],
        retailPrice: "6.49",
        wholesalePrice: "3.75",
        imageUrl: "/src/assets/generated_images/Ginger_citrus_kombucha_product_7a9581af.png",
        inStock: true,
        stockQuantity: 220,
        lowStockThreshold: 50,
      },
      {
        name: "Wildberry",
        description: "This blend includes goji berries in addition to the blueberries and hibiscus flavors that have made it a crowd favorite. It's tart and fruity, and hard to believe there is zero fruit juice.",
        flavor: "berry",
        abv: "0.5% ABV",
        ingredients: ["Black tea", "Goji berries", "Blueberries", "Hibiscus", "Raw cane sugar", "Live cultures"],
        retailPrice: "5.99",
        wholesalePrice: "3.50",
        imageUrl: "/src/assets/generated_images/Berry_hibiscus_kombucha_product_27481eb8.png",
        inStock: true,
        stockQuantity: 190,
        lowStockThreshold: 50,
      },
      {
        name: "Evergreen",
        description: "Steeped with Matcha, it's dry, light, and crisp, and unlike anything else available. Matcha lovers will go nuts for this brew!",
        flavor: "matcha",
        abv: "0.5% ABV",
        ingredients: ["Green tea", "Matcha", "Raw cane sugar", "Live cultures"],
        retailPrice: "6.49",
        wholesalePrice: "3.75",
        imageUrl: "/src/assets/generated_images/Green_tea_mint_kombucha_eb3e813e.png",
        inStock: true,
        stockQuantity: 165,
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
