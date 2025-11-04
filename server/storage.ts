import { 
  type Product, type InsertProduct,
  type SubscriptionPlan, type InsertSubscriptionPlan,
  type CartItem, type InsertCartItem,
  type Subscription, type InsertSubscription,
  type WholesaleCustomer, type InsertWholesaleCustomer,
  type WholesaleOrder, type InsertWholesaleOrder,
  type WholesaleOrderItem, type InsertWholesaleOrderItem
} from "@shared/schema";
import { randomUUID } from "crypto";

export interface IStorage {
  getProducts(): Promise<Product[]>;
  getProduct(id: string): Promise<Product | undefined>;
  createProduct(product: InsertProduct): Promise<Product>;
  
  getSubscriptionPlans(): Promise<SubscriptionPlan[]>;
  getSubscriptionPlan(id: string): Promise<SubscriptionPlan | undefined>;
  createSubscriptionPlan(plan: InsertSubscriptionPlan): Promise<SubscriptionPlan>;
  
  getCartItems(sessionId: string): Promise<CartItem[]>;
  addToCart(item: InsertCartItem): Promise<CartItem>;
  removeFromCart(id: string): Promise<void>;
  clearCart(sessionId: string): Promise<void>;
  
  getSubscriptions(): Promise<Subscription[]>;
  createSubscription(subscription: InsertSubscription): Promise<Subscription>;
  
  getWholesaleCustomers(): Promise<WholesaleCustomer[]>;
  getWholesaleCustomer(id: string): Promise<WholesaleCustomer | undefined>;
  createWholesaleCustomer(customer: InsertWholesaleCustomer): Promise<WholesaleCustomer>;
  
  getWholesaleOrders(): Promise<WholesaleOrder[]>;
  getWholesaleOrder(id: string): Promise<WholesaleOrder | undefined>;
  createWholesaleOrder(order: InsertWholesaleOrder): Promise<WholesaleOrder>;
  
  getWholesaleOrderItems(orderId: string): Promise<WholesaleOrderItem[]>;
  createWholesaleOrderItem(item: InsertWholesaleOrderItem): Promise<WholesaleOrderItem>;
}

export class MemStorage implements IStorage {
  private products: Map<string, Product>;
  private subscriptionPlans: Map<string, SubscriptionPlan>;
  private cartItems: Map<string, CartItem>;
  private subscriptions: Map<string, Subscription>;
  private wholesaleCustomers: Map<string, WholesaleCustomer>;
  private wholesaleOrders: Map<string, WholesaleOrder>;
  private wholesaleOrderItems: Map<string, WholesaleOrderItem>;

  constructor() {
    this.products = new Map();
    this.subscriptionPlans = new Map();
    this.cartItems = new Map();
    this.subscriptions = new Map();
    this.wholesaleCustomers = new Map();
    this.wholesaleOrders = new Map();
    this.wholesaleOrderItems = new Map();
    this.seedData();
  }

  private seedData() {
    const product1: Product = {
      id: randomUUID(),
      name: "Ginger Citrus Kombucha",
      description: "A refreshing blend of organic ginger and fresh citrus. Bright, zesty, and perfectly balanced.",
      flavor: "citrus ginger",
      abv: "0.5% ABV",
      ingredients: ["Organic green tea", "Fresh ginger", "Lemon", "Orange", "Raw cane sugar", "Live cultures"],
      retailPrice: "5.99",
      wholesalePrice: "3.50",
      imageUrl: "/src/assets/generated_images/Ginger_citrus_kombucha_product_7a9581af.png",
      inStock: true,
    };

    const product2: Product = {
      id: randomUUID(),
      name: "Berry Hibiscus Kombucha",
      description: "Deep berry flavors with floral hibiscus notes. Rich in antioxidants and naturally sweet.",
      flavor: "berry",
      abv: "0.5% ABV",
      ingredients: ["Organic black tea", "Strawberry", "Blueberry", "Hibiscus", "Raw cane sugar", "Live cultures"],
      retailPrice: "5.99",
      wholesalePrice: "3.50",
      imageUrl: "/src/assets/generated_images/Berry_hibiscus_kombucha_product_27481eb8.png",
      inStock: true,
    };

    const product3: Product = {
      id: randomUUID(),
      name: "Green Tea Mint Kombucha",
      description: "Cool mint paired with delicate green tea. Light, refreshing, and energizing.",
      flavor: "green tea",
      abv: "0.5% ABV",
      ingredients: ["Organic green tea", "Fresh mint", "Spearmint", "Raw cane sugar", "Live cultures"],
      retailPrice: "5.99",
      wholesalePrice: "3.50",
      imageUrl: "/src/assets/generated_images/Green_tea_mint_kombucha_eb3e813e.png",
      inStock: true,
    };

    const product4: Product = {
      id: randomUUID(),
      name: "Turmeric Ginger Kombucha",
      description: "Golden turmeric and warming ginger. Anti-inflammatory and bold in flavor.",
      flavor: "ginger",
      abv: "0.5% ABV",
      ingredients: ["Organic black tea", "Fresh turmeric", "Ginger", "Black pepper", "Raw cane sugar", "Live cultures"],
      retailPrice: "6.49",
      wholesalePrice: "3.75",
      imageUrl: "/src/assets/generated_images/Turmeric_ginger_kombucha_product_f7b46429.png",
      inStock: true,
    };

    this.products.set(product1.id, product1);
    this.products.set(product2.id, product2);
    this.products.set(product3.id, product3);
    this.products.set(product4.id, product4);

    const weeklyPlan: SubscriptionPlan = {
      id: randomUUID(),
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
    };

    const monthlyPlan: SubscriptionPlan = {
      id: randomUUID(),
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
    };

    const biweeklyPlan: SubscriptionPlan = {
      id: randomUUID(),
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
    };

    this.subscriptionPlans.set(weeklyPlan.id, weeklyPlan);
    this.subscriptionPlans.set(monthlyPlan.id, monthlyPlan);
    this.subscriptionPlans.set(biweeklyPlan.id, biweeklyPlan);

    const customer1: WholesaleCustomer = {
      id: randomUUID(),
      businessName: "Green Valley Cafe",
      contactName: "Sarah Johnson",
      email: "sarah@greenvalleycafe.com",
      phone: "(555) 123-4567",
      address: "123 Main St, Portland, OR 97201",
    };

    const customer2: WholesaleCustomer = {
      id: randomUUID(),
      businessName: "Wellness Studio",
      contactName: "Michael Chen",
      email: "michael@wellnessstudio.com",
      phone: "(555) 234-5678",
      address: "456 Oak Ave, Portland, OR 97202",
    };

    this.wholesaleCustomers.set(customer1.id, customer1);
    this.wholesaleCustomers.set(customer2.id, customer2);

    const order1: WholesaleOrder = {
      id: randomUUID(),
      customerId: customer1.id,
      orderDate: new Date().toISOString(),
      status: "delivered",
      totalAmount: "210.00",
      notes: "Regular weekly order",
    };

    const order2: WholesaleOrder = {
      id: randomUUID(),
      customerId: customer2.id,
      orderDate: new Date(Date.now() - 86400000).toISOString(),
      status: "pending",
      totalAmount: "157.50",
      notes: null,
    };

    this.wholesaleOrders.set(order1.id, order1);
    this.wholesaleOrders.set(order2.id, order2);
  }

  async getProducts(): Promise<Product[]> {
    return Array.from(this.products.values());
  }

  async getProduct(id: string): Promise<Product | undefined> {
    return this.products.get(id);
  }

  async createProduct(insertProduct: InsertProduct): Promise<Product> {
    const id = randomUUID();
    const product: Product = { ...insertProduct, id };
    this.products.set(id, product);
    return product;
  }

  async getSubscriptionPlans(): Promise<SubscriptionPlan[]> {
    return Array.from(this.subscriptionPlans.values());
  }

  async getSubscriptionPlan(id: string): Promise<SubscriptionPlan | undefined> {
    return this.subscriptionPlans.get(id);
  }

  async createSubscriptionPlan(insertPlan: InsertSubscriptionPlan): Promise<SubscriptionPlan> {
    const id = randomUUID();
    const plan: SubscriptionPlan = { ...insertPlan, id };
    this.subscriptionPlans.set(id, plan);
    return plan;
  }

  async getCartItems(sessionId: string): Promise<CartItem[]> {
    return Array.from(this.cartItems.values()).filter(item => item.sessionId === sessionId);
  }

  async addToCart(insertItem: InsertCartItem): Promise<CartItem> {
    const id = randomUUID();
    const item: CartItem = { ...insertItem, id };
    this.cartItems.set(id, item);
    return item;
  }

  async removeFromCart(id: string): Promise<void> {
    this.cartItems.delete(id);
  }

  async clearCart(sessionId: string): Promise<void> {
    const items = await this.getCartItems(sessionId);
    items.forEach(item => this.cartItems.delete(item.id));
  }

  async getSubscriptions(): Promise<Subscription[]> {
    return Array.from(this.subscriptions.values());
  }

  async createSubscription(insertSubscription: InsertSubscription): Promise<Subscription> {
    const id = randomUUID();
    const subscription: Subscription = {
      ...insertSubscription,
      id,
      startDate: new Date().toISOString(),
      nextDeliveryDate: null,
    };
    this.subscriptions.set(id, subscription);
    return subscription;
  }

  async getWholesaleCustomers(): Promise<WholesaleCustomer[]> {
    return Array.from(this.wholesaleCustomers.values());
  }

  async getWholesaleCustomer(id: string): Promise<WholesaleCustomer | undefined> {
    return this.wholesaleCustomers.get(id);
  }

  async createWholesaleCustomer(insertCustomer: InsertWholesaleCustomer): Promise<WholesaleCustomer> {
    const id = randomUUID();
    const customer: WholesaleCustomer = { ...insertCustomer, id };
    this.wholesaleCustomers.set(id, customer);
    return customer;
  }

  async getWholesaleOrders(): Promise<WholesaleOrder[]> {
    return Array.from(this.wholesaleOrders.values());
  }

  async getWholesaleOrder(id: string): Promise<WholesaleOrder | undefined> {
    return this.wholesaleOrders.get(id);
  }

  async createWholesaleOrder(insertOrder: InsertWholesaleOrder): Promise<WholesaleOrder> {
    const id = randomUUID();
    const order: WholesaleOrder = {
      ...insertOrder,
      id,
      orderDate: new Date().toISOString(),
    };
    this.wholesaleOrders.set(id, order);
    return order;
  }

  async getWholesaleOrderItems(orderId: string): Promise<WholesaleOrderItem[]> {
    return Array.from(this.wholesaleOrderItems.values()).filter(item => item.orderId === orderId);
  }

  async createWholesaleOrderItem(insertItem: InsertWholesaleOrderItem): Promise<WholesaleOrderItem> {
    const id = randomUUID();
    const item: WholesaleOrderItem = { ...insertItem, id };
    this.wholesaleOrderItems.set(id, item);
    return item;
  }
}

export const storage = new MemStorage();
