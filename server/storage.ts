import { 
  type Product, type InsertProduct,
  type ProductType,
  type InventoryAdjustment, type InsertInventoryAdjustment,
  type SubscriptionPlan, type InsertSubscriptionPlan,
  type CartItem, type InsertCartItem,
  type Subscription, type InsertSubscription,
  type SubscriptionItem, type InsertSubscriptionItem,
  type RetailCheckoutSession, type InsertRetailCheckoutSession,
  type RetailOrder, type InsertRetailOrder,
  type RetailOrderItem, type InsertRetailOrderItem,
  type WholesaleCustomer, type InsertWholesaleCustomer,
  type WholesaleOrder, type InsertWholesaleOrder,
  type WholesaleOrderItem, type InsertWholesaleOrderItem,
  type WholesalePricing, type InsertWholesalePricing,
  type User, type InsertUser,
  type VerificationCode, type InsertVerificationCode,
  type EmailVerificationCode, type InsertEmailVerificationCode,
  type ImpersonationLog, type InsertImpersonationLog,
  type Lead, type InsertLead,
  type LeadTouchPoint, type InsertLeadTouchPoint,
  products,
  productTypes,
  inventoryAdjustments,
  subscriptionPlans,
  cartItems,
  subscriptions,
  subscriptionItems,
  retailCheckoutSessions,
  retailOrders,
  retailOrderItems,
  wholesaleCustomers,
  wholesaleOrders,
  wholesaleOrderItems,
  wholesalePricing,
  users,
  verificationCodes,
  emailVerificationCodes,
  impersonationLogs,
  passwordResetTokens,
  leads,
  leadTouchPoints
} from "@shared/schema";
import { eq, and, or, desc, sql } from "drizzle-orm";
import { Pool, neonConfig } from "@neondatabase/serverless";
import ws from "ws";
import session from "express-session";
import connectPg from "connect-pg-simple";
import { db } from "./db";

neonConfig.webSocketConstructor = ws;

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const PostgresSessionStore = connectPg(session);

export interface IStorage {
  sessionStore: ReturnType<typeof connectPg>;
  
  getUser(id: string): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  getUserByPhoneNumber(phoneNumber: string): Promise<User | undefined>;
  getUserByEmailOrUsername(emailOrUsername: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  getAllUsers(): Promise<User[]>;
  updateUserRole(id: string, role: string): Promise<User | undefined>;
  updateUserStripeId(id: string, stripeCustomerId: string): Promise<User | undefined>;
  getUsersWithoutStripeId(): Promise<User[]>;
  
  startImpersonation(adminUserId: string, impersonatedUserId: string, ipAddress?: string, userAgent?: string): Promise<ImpersonationLog>;
  endImpersonation(logId: string): Promise<void>;
  getActiveImpersonation(adminUserId: string): Promise<ImpersonationLog | undefined>;
  getImpersonationLogById(logId: string): Promise<ImpersonationLog | undefined>;
  listImpersonationLogs(adminUserId?: string): Promise<ImpersonationLog[]>;
  
  createVerificationCode(code: InsertVerificationCode): Promise<VerificationCode>;
  getLatestVerificationCode(phoneNumber: string): Promise<VerificationCode | undefined>;
  getLatestVerificationCodeByPurpose(phoneNumber: string, purpose: 'registration' | 'login'): Promise<VerificationCode | undefined>;
  markVerificationCodeAsVerified(id: string): Promise<void>;
  markVerificationCodeAsConsumed(id: string): Promise<void>;
  incrementVerificationAttempts(id: string): Promise<void>;
  
  createEmailVerificationCode(code: InsertEmailVerificationCode): Promise<EmailVerificationCode>;
  getLatestEmailVerificationCode(email: string): Promise<EmailVerificationCode | undefined>;
  getLatestEmailVerificationCodeByPurpose(email: string, purpose: 'registration' | 'login'): Promise<EmailVerificationCode | undefined>;
  markEmailVerificationCodeAsVerified(id: string): Promise<void>;
  markEmailVerificationCodeAsConsumed(id: string): Promise<void>;
  incrementEmailVerificationAttempts(id: string): Promise<void>;
  
  getProducts(includeInactive?: boolean): Promise<Product[]>;
  getProduct(id: string): Promise<Product | undefined>;
  createProduct(product: InsertProduct): Promise<Product>;
  updateProduct(id: string, updates: Partial<InsertProduct>): Promise<Product | undefined>;
  updateProductStock(id: string, stockQuantity: number): Promise<Product | undefined>;
  getLowStockProducts(): Promise<Product[]>;
  
  createInventoryAdjustment(adjustment: InsertInventoryAdjustment): Promise<InventoryAdjustment>;
  getInventoryAdjustments(filters?: { productId?: string; reason?: string; limit?: number }): Promise<Array<InventoryAdjustment & { productName: string }>>;
  checkStockAvailability(productId: string, requiredQuantity: number): Promise<{ available: boolean; currentStock: number; deficit?: number }>;
  
  getSubscriptionPlans(): Promise<SubscriptionPlan[]>;
  getSubscriptionPlan(id: string): Promise<SubscriptionPlan | undefined>;
  createSubscriptionPlan(plan: InsertSubscriptionPlan): Promise<SubscriptionPlan>;
  
  getCartItems(sessionId: string): Promise<CartItem[]>;
  addToCart(item: InsertCartItem): Promise<CartItem>;
  updateCartItemQuantity(id: string, quantity: number): Promise<CartItem | undefined>;
  removeFromCart(id: string): Promise<void>;
  clearCart(sessionId: string): Promise<void>;
  
  getSubscriptions(): Promise<Subscription[]>;
  getSubscription(id: string): Promise<Subscription | undefined>;
  getUserSubscriptions(userId: string): Promise<Subscription[]>;
  getSubscriptionByStripeId(stripeSubscriptionId: string): Promise<Subscription | undefined>;
  getSubscriptionBySessionId(sessionId: string): Promise<Subscription | undefined>;
  getSubscriptionsByPickupDate(pickupDate: Date): Promise<Subscription[]>;
  createSubscription(subscription: InsertSubscription): Promise<Subscription>;
  updateSubscription(id: string, updates: Partial<Subscription>): Promise<Subscription | undefined>;
  updateSubscriptionByStripeId(stripeSubscriptionId: string, updates: Partial<Subscription>): Promise<Subscription | undefined>;
  cancelSubscription(id: string): Promise<Subscription | undefined>;
  
  getSubscriptionItems(subscriptionId: string): Promise<SubscriptionItem[]>;
  addSubscriptionItem(item: InsertSubscriptionItem): Promise<SubscriptionItem>;
  removeSubscriptionItem(id: string, subscriptionId: string): Promise<void>;
  updateSubscriptionItemQuantity(id: string, quantity: number): Promise<SubscriptionItem | undefined>;
  
  getWholesaleCustomers(): Promise<WholesaleCustomer[]>;
  getWholesaleCustomer(id: string): Promise<WholesaleCustomer | undefined>;
  getWholesaleCustomerByEmail(email: string): Promise<WholesaleCustomer | undefined>;
  getWholesaleCustomerByUserId(userId: string): Promise<WholesaleCustomer | undefined>;
  createWholesaleCustomer(customer: InsertWholesaleCustomer): Promise<WholesaleCustomer>;
  updateWholesaleCustomer(id: string, updates: Partial<InsertWholesaleCustomer>): Promise<WholesaleCustomer | undefined>;
  
  getWholesaleOrders(): Promise<WholesaleOrder[]>;
  getWholesaleOrder(id: string): Promise<WholesaleOrder | undefined>;
  getWholesaleOrdersByDeliveryDate(deliveryDate: Date): Promise<WholesaleOrder[]>;
  getWholesaleOrdersByCustomerId(customerId: string): Promise<Array<WholesaleOrder & { items: Array<WholesaleOrderItem & { productName: string }> }>>;
  getWholesaleOrderWithDetails(id: string): Promise<{
    order: WholesaleOrder;
    customer: WholesaleCustomer;
    items: Array<WholesaleOrderItem & { product: Product }>;
  } | undefined>;
  createWholesaleOrder(order: InsertWholesaleOrder): Promise<WholesaleOrder>;
  updateWholesaleOrderStatus(id: string, status: string): Promise<WholesaleOrder | undefined>;
  updateWholesaleOrderDeliveryDate(id: string, deliveryDate: Date | null): Promise<WholesaleOrder | undefined>;
  generateNextInvoiceNumber(): Promise<string>;
  
  getWholesaleOrderItems(orderId: string): Promise<WholesaleOrderItem[]>;
  createWholesaleOrderItem(item: InsertWholesaleOrderItem): Promise<WholesaleOrderItem>;
  
  getAllWholesalePricing(): Promise<WholesalePricing[]>;
  getWholesalePricing(customerId: string): Promise<WholesalePricing[]>;
  getWholesalePrice(customerId: string, productTypeId: string): Promise<WholesalePricing | undefined>;
  setWholesalePrice(pricing: InsertWholesalePricing): Promise<WholesalePricing>;
  getProductTypes(): Promise<ProductType[]>;
  updateProductType(id: string, updates: Partial<ProductType>): Promise<ProductType | undefined>;
  
  getRetailCustomers(searchQuery?: string): Promise<Array<{
    id: string;
    firstName: string;
    lastName: string;
    email: string;
    phoneNumber: string;
    subscriptionCount: number;
    activeSubscriptionCount: number;
  }>>;
  
  createRetailCheckoutSession(session: InsertRetailCheckoutSession): Promise<RetailCheckoutSession>;
  getRetailCheckoutSessionByPaymentIntent(paymentIntentId: string): Promise<RetailCheckoutSession | undefined>;
  deleteRetailCheckoutSession(id: string): Promise<void>;
  
  getRetailOrders(): Promise<RetailOrder[]>;
  getRetailOrder(id: string): Promise<RetailOrder | undefined>;
  getRetailOrdersByUserId(userId: string): Promise<RetailOrder[]>;
  getRetailOrderWithDetails(id: string): Promise<{
    order: RetailOrder;
    items: Array<RetailOrderItem & { product: Product }>;
  } | undefined>;
  createRetailOrder(order: InsertRetailOrder): Promise<RetailOrder>;
  createRetailOrderItem(item: InsertRetailOrderItem): Promise<RetailOrderItem>;
  updateRetailOrderStatus(id: string, status: string, userId?: string): Promise<RetailOrder | undefined>;
  generateNextOrderNumber(): Promise<string>;
  updateWholesaleOrderFulfillment(id: string, userId: string): Promise<WholesaleOrder | undefined>;
  
  createPasswordResetToken(userId: string, token: string, expiresAt: Date): Promise<void>;
  getPasswordResetToken(token: string): Promise<{ id: string; userId: string; expiresAt: Date; used: boolean } | undefined>;
  markPasswordResetTokenAsUsed(token: string): Promise<void>;
  updateUserPassword(userId: string, hashedPassword: string): Promise<void>;
  getUserByEmail(email: string): Promise<User | undefined>;
  
  // CRM - Lead management
  getLeads(filters?: { status?: string; priorityLevel?: string; assignedToUserId?: string }): Promise<Lead[]>;
  getLead(id: string): Promise<Lead | undefined>;
  createLead(lead: InsertLead): Promise<Lead>;
  updateLead(id: string, updates: Partial<InsertLead>): Promise<Lead | undefined>;
  deleteLead(id: string): Promise<void>;
  searchLeads(query: string): Promise<Lead[]>;
  
  // CRM - Touch point management
  getLeadTouchPoints(leadId: string): Promise<LeadTouchPoint[]>;
  createLeadTouchPoint(touchPoint: InsertLeadTouchPoint): Promise<LeadTouchPoint>;
  getRecentTouchPoints(limit?: number): Promise<Array<LeadTouchPoint & { leadBusinessName: string; createdByName: string }>>;
  
  seedData(): Promise<void>;
}

export class PostgresStorage implements IStorage {
  sessionStore: any;

  constructor() {
    this.sessionStore = new PostgresSessionStore({ 
      pool, 
      createTableIfMissing: true
    });
  }

  async getUser(id: string): Promise<User | undefined> {
    const result = await db.select().from(users).where(eq(users.id, id));
    return result[0];
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    const result = await db.select().from(users).where(eq(users.username, username));
    return result[0];
  }

  async getUserByPhoneNumber(phoneNumber: string): Promise<User | undefined> {
    const result = await db.select().from(users).where(eq(users.phoneNumber, phoneNumber));
    return result[0];
  }

  async getUserByEmailOrUsername(emailOrUsername: string): Promise<User | undefined> {
    const result = await db.select().from(users).where(
      sql`LOWER(${users.email}) = LOWER(${emailOrUsername}) OR ${users.username} = ${emailOrUsername}`
    );
    return result[0];
  }

  async createUser(userData: InsertUser): Promise<User> {
    const result = await db.insert(users).values(userData).returning();
    return result[0];
  }

  async getAllUsers(): Promise<User[]> {
    return await db.select().from(users);
  }

  async updateUserRole(id: string, role: string): Promise<User | undefined> {
    const isAdmin = role === 'admin' || role === 'super_admin';
    const result = await db
      .update(users)
      .set({ 
        role, 
        isAdmin,
        updatedAt: new Date() 
      })
      .where(eq(users.id, id))
      .returning();
    return result[0];
  }

  async updateUserStripeId(id: string, stripeCustomerId: string): Promise<User | undefined> {
    const result = await db
      .update(users)
      .set({ 
        stripeCustomerId,
        updatedAt: new Date() 
      })
      .where(eq(users.id, id))
      .returning();
    return result[0];
  }

  async getUsersWithoutStripeId(): Promise<User[]> {
    const result = await db
      .select()
      .from(users)
      .where(
        and(
          sql`${users.stripeCustomerId} IS NULL`,
          eq(users.role, 'user')
        )
      );
    return result;
  }

  async startImpersonation(adminUserId: string, impersonatedUserId: string, ipAddress?: string, userAgent?: string): Promise<ImpersonationLog> {
    return await pool.connect().then(async (client) => {
      try {
        await client.query('BEGIN');
        
        // Find any active impersonation logs for this admin
        const activeLogResult = await client.query(`
          SELECT id FROM impersonation_logs
          WHERE admin_user_id = $1 AND ended_at IS NULL
          LIMIT 1
        `, [adminUserId]);
        
        // Close any active sessions
        if (activeLogResult.rows.length > 0) {
          await client.query(`
            UPDATE impersonation_logs
            SET ended_at = NOW()
            WHERE id = $1
          `, [activeLogResult.rows[0].id]);
        }
        
        // Create new impersonation log
        const result = await client.query(`
          INSERT INTO impersonation_logs (admin_user_id, impersonated_user_id, ip_address, user_agent)
          VALUES ($1, $2, $3, $4)
          RETURNING id, admin_user_id, impersonated_user_id, ip_address, user_agent, started_at, ended_at
        `, [adminUserId, impersonatedUserId, ipAddress, userAgent]);
        
        await client.query('COMMIT');
        
        const row = result.rows[0];
        return {
          id: row.id,
          adminUserId: row.admin_user_id,
          impersonatedUserId: row.impersonated_user_id,
          ipAddress: row.ip_address,
          userAgent: row.user_agent,
          startedAt: row.started_at,
          endedAt: row.ended_at,
        };
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    });
  }

  async endImpersonation(logId: string): Promise<void> {
    await db
      .update(impersonationLogs)
      .set({ endedAt: new Date() })
      .where(eq(impersonationLogs.id, logId));
  }

  async getActiveImpersonation(adminUserId: string): Promise<ImpersonationLog | undefined> {
    const result = await db
      .select()
      .from(impersonationLogs)
      .where(
        and(
          eq(impersonationLogs.adminUserId, adminUserId),
          sql`${impersonationLogs.endedAt} IS NULL`
        )
      )
      .limit(1);
    
    return result[0];
  }

  async getImpersonationLogById(logId: string): Promise<ImpersonationLog | undefined> {
    const result = await db
      .select()
      .from(impersonationLogs)
      .where(eq(impersonationLogs.id, logId))
      .limit(1);
    
    return result[0];
  }

  async listImpersonationLogs(adminUserId?: string): Promise<ImpersonationLog[]> {
    const query = db.select().from(impersonationLogs);
    
    if (adminUserId) {
      return await query.where(eq(impersonationLogs.adminUserId, adminUserId)).orderBy(desc(impersonationLogs.startedAt));
    }
    
    return await query.orderBy(desc(impersonationLogs.startedAt));
  }

  async createVerificationCode(codeData: InsertVerificationCode): Promise<VerificationCode> {
    const result = await db.insert(verificationCodes).values(codeData).returning();
    return result[0];
  }

  async getLatestVerificationCode(phoneNumber: string): Promise<VerificationCode | undefined> {
    const result = await db
      .select()
      .from(verificationCodes)
      .where(eq(verificationCodes.phoneNumber, phoneNumber))
      .orderBy(desc(verificationCodes.createdAt))
      .limit(1);
    return result[0];
  }

  async getLatestVerificationCodeByPurpose(phoneNumber: string, purpose: 'registration' | 'login'): Promise<VerificationCode | undefined> {
    const result = await db
      .select()
      .from(verificationCodes)
      .where(
        and(
          eq(verificationCodes.phoneNumber, phoneNumber),
          eq(verificationCodes.purpose, purpose)
        )
      )
      .orderBy(desc(verificationCodes.createdAt))
      .limit(1);
    return result[0];
  }

  async markVerificationCodeAsVerified(id: string): Promise<void> {
    await db
      .update(verificationCodes)
      .set({ verified: true })
      .where(eq(verificationCodes.id, id));
  }

  async markVerificationCodeAsConsumed(id: string): Promise<void> {
    await db
      .update(verificationCodes)
      .set({ consumedAt: new Date() })
      .where(eq(verificationCodes.id, id));
  }

  async incrementVerificationAttempts(id: string): Promise<void> {
    await db
      .update(verificationCodes)
      .set({ attempts: sql`${verificationCodes.attempts} + 1` })
      .where(eq(verificationCodes.id, id));
  }

  async createEmailVerificationCode(codeData: InsertEmailVerificationCode): Promise<EmailVerificationCode> {
    const result = await db.insert(emailVerificationCodes).values(codeData).returning();
    return result[0];
  }

  async getLatestEmailVerificationCode(email: string): Promise<EmailVerificationCode | undefined> {
    const result = await db
      .select()
      .from(emailVerificationCodes)
      .where(eq(emailVerificationCodes.email, email))
      .orderBy(desc(emailVerificationCodes.createdAt))
      .limit(1);
    return result[0];
  }

  async getLatestEmailVerificationCodeByPurpose(email: string, purpose: 'registration' | 'login'): Promise<EmailVerificationCode | undefined> {
    const result = await db
      .select()
      .from(emailVerificationCodes)
      .where(
        and(
          eq(emailVerificationCodes.email, email),
          eq(emailVerificationCodes.purpose, purpose)
        )
      )
      .orderBy(desc(emailVerificationCodes.createdAt))
      .limit(1);
    return result[0];
  }

  async markEmailVerificationCodeAsVerified(id: string): Promise<void> {
    await db
      .update(emailVerificationCodes)
      .set({ verified: true })
      .where(eq(emailVerificationCodes.id, id));
  }

  async markEmailVerificationCodeAsConsumed(id: string): Promise<void> {
    await db
      .update(emailVerificationCodes)
      .set({ consumedAt: new Date() })
      .where(eq(emailVerificationCodes.id, id));
  }

  async incrementEmailVerificationAttempts(id: string): Promise<void> {
    await db
      .update(emailVerificationCodes)
      .set({ attempts: sql`${emailVerificationCodes.attempts} + 1` })
      .where(eq(emailVerificationCodes.id, id));
  }

  async getProducts(includeInactive = false): Promise<Product[]> {
    if (includeInactive) {
      return await db.select().from(products);
    }
    return await db.select().from(products).where(eq(products.isActive, true));
  }

  async getProduct(id: string): Promise<Product | undefined> {
    const result = await db.select().from(products).where(eq(products.id, id));
    return result[0];
  }

  async createProduct(insertProduct: InsertProduct): Promise<Product> {
    const result = await db.insert(products).values(insertProduct).returning();
    return result[0];
  }

  async updateProduct(id: string, updates: Partial<InsertProduct>): Promise<Product | undefined> {
    const result = await db
      .update(products)
      .set(updates)
      .where(eq(products.id, id))
      .returning();
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

  async createInventoryAdjustment(adjustment: InsertInventoryAdjustment): Promise<InventoryAdjustment> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const productResult = await client.query(
        'SELECT stock_quantity FROM products WHERE id = $1 FOR UPDATE',
        [adjustment.productId]
      );

      if (productResult.rows.length === 0) {
        throw new Error('Product not found');
      }

      const currentStock = productResult.rows[0].stock_quantity;
      const newStock = currentStock + adjustment.quantity;

      await client.query(
        'UPDATE products SET stock_quantity = $1, in_stock = $2 WHERE id = $3',
        [newStock, newStock > 0, adjustment.productId]
      );

      const adjustmentResult = await client.query(
        `INSERT INTO inventory_adjustments 
        (product_id, quantity, reason, staff_user_id, order_id, order_type, batch_metadata, notes)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        RETURNING *`,
        [
          adjustment.productId,
          adjustment.quantity,
          adjustment.reason,
          adjustment.staffUserId || null,
          adjustment.orderId || null,
          adjustment.orderType || null,
          adjustment.batchMetadata || null,
          adjustment.notes || null
        ]
      );

      await client.query('COMMIT');

      const row = adjustmentResult.rows[0];
      return {
        id: row.id,
        productId: row.product_id,
        quantity: row.quantity,
        reason: row.reason,
        staffUserId: row.staff_user_id,
        orderId: row.order_id,
        orderType: row.order_type,
        batchMetadata: row.batch_metadata,
        notes: row.notes,
        createdAt: row.created_at
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async getInventoryAdjustments(filters?: { productId?: string; reason?: string; limit?: number }): Promise<Array<InventoryAdjustment & { productName: string }>> {
    let query = sql`
      SELECT 
        ia.*,
        p.name as product_name
      FROM inventory_adjustments ia
      JOIN products p ON ia.product_id = p.id
      WHERE 1=1
    `;

    if (filters?.productId) {
      query = sql`${query} AND ia.product_id = ${filters.productId}`;
    }

    if (filters?.reason) {
      query = sql`${query} AND ia.reason = ${filters.reason}`;
    }

    query = sql`${query} ORDER BY ia.created_at DESC`;

    if (filters?.limit) {
      query = sql`${query} LIMIT ${filters.limit}`;
    }

    const result = await db.execute(query);
    
    return result.rows.map((row: any) => ({
      id: row.id,
      productId: row.product_id,
      quantity: row.quantity,
      reason: row.reason,
      staffUserId: row.staff_user_id,
      orderId: row.order_id,
      orderType: row.order_type,
      batchMetadata: row.batch_metadata,
      notes: row.notes,
      createdAt: row.created_at,
      productName: row.product_name
    }));
  }

  async checkStockAvailability(productId: string, requiredQuantity: number): Promise<{ available: boolean; currentStock: number; deficit?: number }> {
    const product = await this.getProduct(productId);
    if (!product) {
      throw new Error('Product not found');
    }

    const available = product.stockQuantity >= requiredQuantity;
    const deficit = available ? undefined : requiredQuantity - product.stockQuantity;

    return {
      available,
      currentStock: product.stockQuantity,
      deficit
    };
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
    // Check for existing item matching product, session, subscription status, and frequency
    const conditions = [
      eq(cartItems.sessionId, item.sessionId),
      eq(cartItems.productId, item.productId),
      eq(cartItems.isSubscription, item.isSubscription || false),
    ];

    // Only check frequency if it's a subscription
    if (item.isSubscription && item.subscriptionFrequency) {
      conditions.push(eq(cartItems.subscriptionFrequency, item.subscriptionFrequency));
    }

    const existing = await db
      .select()
      .from(cartItems)
      .where(and(...conditions));

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

  async getSubscription(id: string): Promise<Subscription | undefined> {
    const result = await db.select().from(subscriptions).where(eq(subscriptions.id, id));
    return result[0];
  }

  async getUserSubscriptions(userId: string): Promise<Subscription[]> {
    return await db.select().from(subscriptions).where(eq(subscriptions.userId, userId));
  }

  async getSubscriptionByStripeId(stripeSubscriptionId: string): Promise<Subscription | undefined> {
    const result = await db.select().from(subscriptions).where(eq(subscriptions.stripeSubscriptionId, stripeSubscriptionId));
    return result[0];
  }

  async getSubscriptionBySessionId(sessionId: string): Promise<Subscription | undefined> {
    const result = await db.select().from(subscriptions).where(eq(subscriptions.stripeCheckoutSessionId, sessionId));
    return result[0];
  }

  async getSubscriptionsByPickupDate(pickupDate: Date): Promise<Subscription[]> {
    const startOfDay = new Date(pickupDate);
    startOfDay.setUTCHours(0, 0, 0, 0);
    const endOfDay = new Date(pickupDate);
    endOfDay.setUTCHours(23, 59, 59, 999);
    
    const result = await db
      .select()
      .from(subscriptions)
      .where(
        and(
          eq(subscriptions.status, 'active'),
          sql`${subscriptions.nextDeliveryDate} >= ${startOfDay}`,
          sql`${subscriptions.nextDeliveryDate} <= ${endOfDay}`
        )
      )
      .orderBy(subscriptions.nextDeliveryDate);
    return result;
  }

  async createSubscription(subscription: InsertSubscription): Promise<Subscription> {
    const result = await db.insert(subscriptions).values(subscription).returning();
    return result[0];
  }

  async updateSubscription(id: string, updates: Partial<Subscription>): Promise<Subscription | undefined> {
    // Whitelist only allowed fields for user updates (defense in depth)
    const allowedUpdates: Partial<Subscription> = {};
    if (updates.nextDeliveryDate !== undefined) {
      allowedUpdates.nextDeliveryDate = updates.nextDeliveryDate;
    }
    if (updates.productId !== undefined) {
      allowedUpdates.productId = updates.productId;
    }
    if (updates.subscriptionFrequency !== undefined) {
      allowedUpdates.subscriptionFrequency = updates.subscriptionFrequency;
    }
    if (updates.nextChargeAt !== undefined) {
      allowedUpdates.nextChargeAt = updates.nextChargeAt;
    }
    
    const result = await db
      .update(subscriptions)
      .set(allowedUpdates)
      .where(eq(subscriptions.id, id))
      .returning();
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

  async cancelSubscription(id: string): Promise<Subscription | undefined> {
    const result = await db
      .update(subscriptions)
      .set({ 
        status: 'cancelled',
        cancelledAt: new Date()
      })
      .where(eq(subscriptions.id, id))
      .returning();
    return result[0];
  }

  async getSubscriptionItems(subscriptionId: string): Promise<SubscriptionItem[]> {
    return await db
      .select()
      .from(subscriptionItems)
      .where(eq(subscriptionItems.subscriptionId, subscriptionId));
  }

  async addSubscriptionItem(item: InsertSubscriptionItem): Promise<SubscriptionItem> {
    const result = await db
      .insert(subscriptionItems)
      .values(item)
      .returning();
    return result[0];
  }

  async removeSubscriptionItem(id: string, subscriptionId: string): Promise<void> {
    return await pool.connect().then(async (client) => {
      try {
        await client.query('BEGIN');
        
        // Lock all items for this subscription to prevent concurrent modifications
        // Count items atomically with row-level locks
        const countResult = await client.query(`
          SELECT id, subscription_id
          FROM subscription_items
          WHERE subscription_id = $1
          FOR UPDATE
        `, [subscriptionId]);
        
        const items = countResult.rows;
        
        // Verify the item exists and belongs to this subscription
        const targetItem = items.find(item => item.id === id);
        if (!targetItem) {
          throw new Error('Subscription item not found or does not belong to this subscription');
        }
        
        // Check if this would leave zero items
        if (items.length <= 1) {
          throw new Error('Cannot remove the last product from a subscription. Cancel the subscription instead.');
        }
        
        // Safe to delete - atomically delete and verify rowCount
        const deleteResult = await client.query(`
          DELETE FROM subscription_items
          WHERE id = $1
        `, [id]);
        
        if (deleteResult.rowCount === 0) {
          throw new Error('Failed to remove subscription item - item may have been already removed');
        }
        
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    });
  }

  async updateSubscriptionItemQuantity(id: string, quantity: number): Promise<SubscriptionItem | undefined> {
    const result = await db
      .update(subscriptionItems)
      .set({ quantity })
      .where(eq(subscriptionItems.id, id))
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

  async getWholesaleCustomerByEmail(email: string): Promise<WholesaleCustomer | undefined> {
    const result = await db.select().from(wholesaleCustomers).where(eq(wholesaleCustomers.email, email));
    return result[0];
  }

  async getWholesaleCustomerByUserId(userId: string): Promise<WholesaleCustomer | undefined> {
    const result = await db.select().from(wholesaleCustomers).where(eq(wholesaleCustomers.userId, userId));
    return result[0];
  }

  async createWholesaleCustomer(customer: InsertWholesaleCustomer): Promise<WholesaleCustomer> {
    const result = await db.insert(wholesaleCustomers).values(customer).returning();
    return result[0];
  }

  async updateWholesaleCustomer(id: string, updates: Partial<InsertWholesaleCustomer>): Promise<WholesaleCustomer | undefined> {
    const result = await db.update(wholesaleCustomers)
      .set(updates)
      .where(eq(wholesaleCustomers.id, id))
      .returning();
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

  async updateWholesaleOrderDeliveryDate(id: string, deliveryDate: Date | null): Promise<WholesaleOrder | undefined> {
    const result = await db
      .update(wholesaleOrders)
      .set({ deliveryDate })
      .where(eq(wholesaleOrders.id, id))
      .returning();
    return result[0];
  }

  async getWholesaleOrdersByDeliveryDate(deliveryDate: Date): Promise<WholesaleOrder[]> {
    const startOfDay = new Date(deliveryDate);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(deliveryDate);
    endOfDay.setHours(23, 59, 59, 999);
    
    const result = await db
      .select()
      .from(wholesaleOrders)
      .where(
        and(
          sql`${wholesaleOrders.deliveryDate} >= ${startOfDay}`,
          sql`${wholesaleOrders.deliveryDate} <= ${endOfDay}`
        )
      )
      .orderBy(wholesaleOrders.deliveryDate);
    return result;
  }

  async getWholesaleOrdersByCustomerId(customerId: string): Promise<Array<WholesaleOrder & { items: Array<WholesaleOrderItem & { productName: string }> }>> {
    const result = await db
      .select()
      .from(wholesaleOrders)
      .where(eq(wholesaleOrders.customerId, customerId))
      .orderBy(desc(wholesaleOrders.orderDate));

    // Get items for each order
    const ordersWithItems = await Promise.all(
      result.map(async (order) => {
        const items = await db
          .select({
            id: wholesaleOrderItems.id,
            orderId: wholesaleOrderItems.orderId,
            productId: wholesaleOrderItems.productId,
            quantity: wholesaleOrderItems.quantity,
            unitPrice: wholesaleOrderItems.unitPrice,
            productName: products.name,
          })
          .from(wholesaleOrderItems)
          .leftJoin(products, eq(wholesaleOrderItems.productId, products.id))
          .where(eq(wholesaleOrderItems.orderId, order.id));

        return {
          ...order,
          items: items.map((item) => ({
            ...item,
            productName: item.productName || 'Unknown Product',
          })),
        };
      })
    );

    return ordersWithItems;
  }

  async getWholesaleOrderWithDetails(id: string): Promise<{
    order: WholesaleOrder;
    customer: WholesaleCustomer;
    items: Array<WholesaleOrderItem & { product: Product }>;
  } | undefined> {
    const order = await this.getWholesaleOrder(id);
    if (!order) return undefined;

    const customer = await this.getWholesaleCustomer(order.customerId);
    if (!customer) return undefined;

    const orderItems = await this.getWholesaleOrderItems(id);
    const itemsWithProducts = await Promise.all(
      orderItems.map(async (item) => {
        const product = await this.getProduct(item.productId);
        return { ...item, product: product! };
      })
    );

    return {
      order,
      customer,
      items: itemsWithProducts,
    };
  }

  async generateNextInvoiceNumber(): Promise<string> {
    const currentYear = new Date().getFullYear();
    const result = await db
      .select()
      .from(wholesaleOrders)
      .where(sql`EXTRACT(YEAR FROM ${wholesaleOrders.orderDate}) = ${currentYear}`)
      .orderBy(desc(wholesaleOrders.invoiceNumber));
    
    if (result.length === 0) {
      return `INV-${currentYear}-0001`;
    }
    
    const lastInvoice = result[0].invoiceNumber;
    const match = lastInvoice.match(/INV-\d{4}-(\d{4})/);
    const nextNumber = match ? parseInt(match[1]) + 1 : 1;
    return `INV-${currentYear}-${String(nextNumber).padStart(4, '0')}`;
  }

  async getWholesaleOrderItems(orderId: string): Promise<WholesaleOrderItem[]> {
    return await db.select().from(wholesaleOrderItems).where(eq(wholesaleOrderItems.orderId, orderId));
  }

  async createWholesaleOrderItem(item: InsertWholesaleOrderItem): Promise<WholesaleOrderItem> {
    const result = await db.insert(wholesaleOrderItems).values(item).returning();
    return result[0];
  }

  async getAllWholesalePricing(): Promise<WholesalePricing[]> {
    return await db.select().from(wholesalePricing);
  }

  async getWholesalePricing(customerId: string): Promise<WholesalePricing[]> {
    return await db.select().from(wholesalePricing).where(eq(wholesalePricing.customerId, customerId));
  }

  async getWholesalePrice(customerId: string, productTypeId: string): Promise<WholesalePricing | undefined> {
    const result = await db
      .select()
      .from(wholesalePricing)
      .where(
        and(
          eq(wholesalePricing.customerId, customerId),
          eq(wholesalePricing.productTypeId, productTypeId)
        )
      );
    return result[0];
  }

  async setWholesalePrice(pricing: InsertWholesalePricing): Promise<WholesalePricing> {
    const existing = await this.getWholesalePrice(pricing.customerId, pricing.productTypeId);
    if (existing) {
      const result = await db
        .update(wholesalePricing)
        .set({ customPrice: pricing.customPrice })
        .where(eq(wholesalePricing.id, existing.id))
        .returning();
      return result[0];
    } else {
      const result = await db.insert(wholesalePricing).values(pricing).returning();
      return result[0];
    }
  }

  async getProductTypes(): Promise<ProductType[]> {
    return await db.select().from(productTypes);
  }

  async updateProductType(id: string, updates: Partial<ProductType>): Promise<ProductType | undefined> {
    const result = await db
      .update(productTypes)
      .set(updates)
      .where(eq(productTypes.id, id))
      .returning();
    return result[0];
  }

  async seedData(): Promise<void> {
    const existingProducts = await this.getProducts();
    const existingCustomers = await this.getWholesaleCustomers();

    if (existingProducts.length === 0) {
      await db.insert(products).values([
      {
        name: "Island Hop",
        description: "It's hoppy, tropical, and fresh, and is a great option for someone craving a cold beer without the buzz. This blend is made with grapefruit and Cascade hops -- ingredients known to support the immune and cardiovascular systems. 0.5% ABV.",
        flavor: "hoppy tropical",
        ingredients: ["Organic green tea", "Grapefruit", "Cascade hops", "Raw cane sugar", "Live cultures"],
        retailPrice: "3.33",
        wholesalePrice: "2.50",
        imageUrl: "/products/IslandHop.jpg",
        inStock: true,
        stockQuantity: 150,
        lowStockThreshold: 50,
      },
      {
        name: "Hummingbrew",
        description: "This gorgeous bottle showcases the White Peony and English Breakfast teas that make our classic kombucha so tasty. This combo of black and white teas is known for their healing and immunity-boosting properties. 0.5% ABV.",
        flavor: "classic tea",
        ingredients: ["White Peony tea", "English Breakfast tea", "Raw cane sugar", "Live cultures"],
        retailPrice: "3.33",
        wholesalePrice: "2.50",
        imageUrl: "/products/Hummingbrew.jpg",
        inStock: true,
        stockQuantity: 200,
        lowStockThreshold: 50,
      },
      {
        name: "Mist",
        description: "Brewed with rose petals, giving it a pinkish color that shines through our new clear bottles. Natural energy booster Earl Grey is known for enhancing digestion and reducing stress. 0.5% ABV.",
        flavor: "floral earl grey",
        ingredients: ["Earl Grey tea", "Rose petals", "Raw cane sugar", "Live cultures"],
        retailPrice: "3.33",
        wholesalePrice: "2.50",
        imageUrl: "/products/Mist.jpg",
        inStock: true,
        stockQuantity: 175,
        lowStockThreshold: 50,
      },
      {
        name: "Northzest",
        description: "It's Lemon Zest with a slight kick! Our Northzest brew is citrusy, spicy, and tart. Metabolism-boosting cayenne pairs with energizing black tea, creating a blend good for both mind and body. 0.5% ABV.",
        flavor: "citrus spicy",
        ingredients: ["Black tea", "Lemon zest", "Cayenne pepper", "Raw cane sugar", "Live cultures"],
        retailPrice: "3.33",
        wholesalePrice: "2.50",
        imageUrl: "/products/Northzest.jpg",
        inStock: true,
        stockQuantity: 160,
        lowStockThreshold: 50,
      },
      {
        name: "Bonfire",
        description: "A warm, spiced, and earthy brew. We've added an ancient medicinal herb, ashwagandha, which is an adaptogen that is believed to have natural healing properties for both mind and body. 0.5% ABV.",
        flavor: "warm spiced",
        ingredients: ["Black tea", "Ashwagandha", "Warming spices", "Raw cane sugar", "Live cultures"],
        retailPrice: "3.33",
        wholesalePrice: "2.50",
        imageUrl: "/products/Bonfire.jpg",
        inStock: true,
        stockQuantity: 140,
        lowStockThreshold: 50,
      },
      {
        name: "Sunbreak",
        description: "Our best seller is bright, spicy, and juicy, and features powerful ashwaganda and medicinal herbs known to support digestive and brain health. 0.5% ABV.",
        flavor: "bright spicy",
        ingredients: ["Black tea", "Ashwagandha", "Medicinal herbs", "Raw cane sugar", "Live cultures"],
        retailPrice: "3.33",
        wholesalePrice: "2.50",
        imageUrl: "/products/Sunbreak.jpg",
        inStock: true,
        stockQuantity: 220,
        lowStockThreshold: 50,
      },
      {
        name: "Wildberry",
        description: "This blend includes goji berries in addition to the blueberries and hibiscus flavors that have made it a crowd favorite. It's tart and fruity, and hard to believe there is zero fruit juice. 0.5% ABV.",
        flavor: "berry",
        ingredients: ["Black tea", "Goji berries", "Blueberries", "Hibiscus", "Raw cane sugar", "Live cultures"],
        retailPrice: "3.33",
        wholesalePrice: "2.50",
        imageUrl: "/products/Wildberry.jpg",
        inStock: true,
        stockQuantity: 190,
        lowStockThreshold: 50,
      },
      {
        name: "Evergreen",
        description: "Steeped with Matcha, it's dry, light, and crisp, and unlike anything else available. Matcha lovers will go nuts for this brew! 0.5% ABV.",
        flavor: "matcha",
        ingredients: ["Green tea", "Matcha", "Raw cane sugar", "Live cultures"],
        retailPrice: "3.33",
        wholesalePrice: "2.50",
        imageUrl: "/products/Evergreen.jpg",
        inStock: true,
        stockQuantity: 165,
        lowStockThreshold: 50,
      },
      {
        name: "Mixed Case",
        description: "Can't decide on just one flavor? Get the best of all our brews with our Mixed Case! This variety pack includes 12 bottles featuring a selection of our most popular flavors. Perfect for trying new favorites or sharing with friends. Makes a great gift! 0.5% ABV.",
        flavor: "variety pack",
        ingredients: ["Assorted flavors", "Organic teas", "Raw cane sugar", "Live cultures"],
        retailPrice: "3.33",
        wholesalePrice: "2.50",
        imageUrl: "/products/MixedCase.jpg",
        imageUrls: ["/products/MixedCase.jpg"],
        inStock: true,
        stockQuantity: 100,
        lowStockThreshold: 30,
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
    }

    if (existingCustomers.length === 0) {
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

  async getRetailCustomers(searchQuery?: string): Promise<Array<{
    id: string;
    firstName: string;
    lastName: string;
    email: string;
    phoneNumber: string;
    subscriptionCount: number;
    activeSubscriptionCount: number;
  }>> {
    let query = db
      .select({
        id: users.id,
        firstName: users.firstName,
        lastName: users.lastName,
        email: users.email,
        phoneNumber: users.phoneNumber,
        subscriptionCount: sql<number>`COUNT(${subscriptions.id})::int`,
        activeSubscriptionCount: sql<number>`SUM(CASE WHEN ${subscriptions.status} = 'active' THEN 1 ELSE 0 END)::int`,
      })
      .from(users)
      .leftJoin(subscriptions, eq(subscriptions.userId, users.id))
      .where(eq(users.role, 'user'))
      .groupBy(users.id, users.firstName, users.lastName, users.email, users.phoneNumber)
      .orderBy(users.lastName, users.firstName);

    // Apply search filter if provided
    if (searchQuery && searchQuery.trim()) {
      const searchTerm = `%${searchQuery.trim().toLowerCase()}%`;
      query = db
        .select({
          id: users.id,
          firstName: users.firstName,
          lastName: users.lastName,
          email: users.email,
          phoneNumber: users.phoneNumber,
          subscriptionCount: sql<number>`COUNT(${subscriptions.id})::int`,
          activeSubscriptionCount: sql<number>`SUM(CASE WHEN ${subscriptions.status} = 'active' THEN 1 ELSE 0 END)::int`,
        })
        .from(users)
        .leftJoin(subscriptions, eq(subscriptions.userId, users.id))
        .where(
          and(
            eq(users.role, 'user'),
            sql`(
              LOWER(${users.firstName}) LIKE ${searchTerm} OR 
              LOWER(${users.lastName}) LIKE ${searchTerm} OR 
              LOWER(${users.email}) LIKE ${searchTerm} OR
              LOWER(${users.phoneNumber}) LIKE ${searchTerm}
            )`
          )
        )
        .groupBy(users.id, users.firstName, users.lastName, users.email, users.phoneNumber)
        .orderBy(users.lastName, users.firstName);
    }

    const results = await query;
    
    return results.map(r => ({
      id: r.id,
      firstName: r.firstName || '',
      lastName: r.lastName || '',
      email: r.email || '',
      phoneNumber: r.phoneNumber || '',
      subscriptionCount: r.subscriptionCount || 0,
      activeSubscriptionCount: r.activeSubscriptionCount || 0,
    }));
  }

  async createRetailCheckoutSession(session: InsertRetailCheckoutSession): Promise<RetailCheckoutSession> {
    const result = await db.insert(retailCheckoutSessions).values(session).returning();
    return result[0];
  }

  async getRetailCheckoutSessionByPaymentIntent(paymentIntentId: string): Promise<RetailCheckoutSession | undefined> {
    const result = await db.select().from(retailCheckoutSessions).where(eq(retailCheckoutSessions.paymentIntentId, paymentIntentId));
    return result[0];
  }

  async deleteRetailCheckoutSession(id: string): Promise<void> {
    await db.delete(retailCheckoutSessions).where(eq(retailCheckoutSessions.id, id));
  }

  async getRetailOrders(): Promise<RetailOrder[]> {
    return await db.select().from(retailOrders).orderBy(desc(retailOrders.orderDate));
  }

  async getRetailOrder(id: string): Promise<RetailOrder | undefined> {
    const result = await db.select().from(retailOrders).where(eq(retailOrders.id, id));
    return result[0];
  }

  async getRetailOrdersByUserId(userId: string): Promise<RetailOrder[]> {
    return await db.select().from(retailOrders).where(eq(retailOrders.userId, userId)).orderBy(desc(retailOrders.orderDate));
  }

  async getRetailOrderWithDetails(id: string): Promise<{
    order: RetailOrder;
    items: Array<RetailOrderItem & { product: Product }>;
  } | undefined> {
    const order = await this.getRetailOrder(id);
    if (!order) return undefined;

    const items = await db
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
      .where(eq(retailOrderItems.orderId, id));

    return {
      order,
      items: items.map(item => ({
        id: item.id,
        orderId: item.orderId,
        productId: item.productId,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        product: item.product,
      })),
    };
  }

  async createRetailOrder(order: InsertRetailOrder): Promise<RetailOrder> {
    const result = await db.insert(retailOrders).values(order).returning();
    return result[0];
  }

  async createRetailOrderItem(item: InsertRetailOrderItem): Promise<RetailOrderItem> {
    const result = await db.insert(retailOrderItems).values(item).returning();
    return result[0];
  }

  async updateRetailOrderStatus(id: string, status: string, userId?: string): Promise<RetailOrder | undefined> {
    if (status === 'fulfilled' && userId) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');

        const orderItems = await db
          .select()
          .from(retailOrderItems)
          .where(eq(retailOrderItems.orderId, id));

        for (const item of orderItems) {
          const productResult = await client.query(
            'SELECT stock_quantity FROM products WHERE id = $1 FOR UPDATE',
            [item.productId]
          );

          if (productResult.rows.length === 0) {
            throw new Error(`Product not found: ${item.productId}`);
          }

          const currentStock = productResult.rows[0].stock_quantity;
          const newStock = currentStock - item.quantity;

          if (newStock < 0) {
            throw new Error(`Insufficient stock for product ${item.productId}. Required: ${item.quantity}, Available: ${currentStock}`);
          }

          await client.query(
            'UPDATE products SET stock_quantity = $1, in_stock = $2 WHERE id = $3',
            [newStock, newStock > 0, item.productId]
          );

          await client.query(
            `INSERT INTO inventory_adjustments 
            (product_id, quantity, reason, staff_user_id, order_id, order_type)
            VALUES ($1, $2, $3, $4, $5, $6)`,
            [item.productId, -item.quantity, 'fulfillment', userId, id, 'retail']
          );
        }

        await client.query(
          'UPDATE retail_orders SET status = $1, fulfilled_at = $2, fulfilled_by_user_id = $3 WHERE id = $4',
          [status, new Date(), userId, id]
        );

        await client.query('COMMIT');

        const updatedOrder = await this.getRetailOrder(id);
        return updatedOrder;
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    } else {
      const updates: any = { status };
      const result = await db
        .update(retailOrders)
        .set(updates)
        .where(eq(retailOrders.id, id))
        .returning();
      return result[0];
    }
  }

  async generateNextOrderNumber(): Promise<string> {
    const currentYear = new Date().getFullYear();
    const result = await db
      .select()
      .from(retailOrders)
      .where(sql`EXTRACT(YEAR FROM ${retailOrders.orderDate}) = ${currentYear}`)
      .orderBy(desc(retailOrders.orderNumber));
    
    if (result.length === 0) {
      return `RO-${currentYear}-0001`;
    }
    
    const lastOrder = result[0].orderNumber;
    const match = lastOrder.match(/RO-\d{4}-(\d{4})/);
    const nextNumber = match ? parseInt(match[1]) + 1 : 1;
    return `RO-${currentYear}-${String(nextNumber).padStart(4, '0')}`;
  }

  async updateWholesaleOrderFulfillment(id: string, userId: string): Promise<WholesaleOrder | undefined> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const orderItems = await db
        .select()
        .from(wholesaleOrderItems)
        .where(eq(wholesaleOrderItems.orderId, id));

      for (const item of orderItems) {
        const productResult = await client.query(
          'SELECT stock_quantity FROM products WHERE id = $1 FOR UPDATE',
          [item.productId]
        );

        if (productResult.rows.length === 0) {
          throw new Error(`Product not found: ${item.productId}`);
        }

        const currentStock = productResult.rows[0].stock_quantity;
        const newStock = currentStock - item.quantity;

        if (newStock < 0) {
          throw new Error(`Insufficient stock for product ${item.productId}. Required: ${item.quantity}, Available: ${currentStock}`);
        }

        await client.query(
          'UPDATE products SET stock_quantity = $1, in_stock = $2 WHERE id = $3',
          [newStock, newStock > 0, item.productId]
        );

        await client.query(
          `INSERT INTO inventory_adjustments 
          (product_id, quantity, reason, staff_user_id, order_id, order_type)
          VALUES ($1, $2, $3, $4, $5, $6)`,
          [item.productId, -item.quantity, 'fulfillment', userId, id, 'wholesale']
        );
      }

      await client.query(
        'UPDATE wholesale_orders SET status = $1, fulfilled_at = $2, fulfilled_by_user_id = $3 WHERE id = $4',
        ['fulfilled', new Date(), userId, id]
      );

      await client.query('COMMIT');

      const updatedOrder = await this.getWholesaleOrder(id);
      return updatedOrder;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  // Migration: Backfill existing subscriptions into subscription_items table
  async migrateSubscriptionsToItems(dryRun: boolean = false): Promise<{ migrated: number; skipped: number }> {
    console.log(`[MIGRATION] Starting migration${dryRun ? ' (DRY RUN)' : ''}...`);
    
    return await pool.connect().then(async (client) => {
      let migrated = 0;
      let skipped = 0;

      try {
        // Start transaction
        await client.query('BEGIN');
        console.log('[MIGRATION] Transaction started');

        // Get all subscriptions with a product_id
        const result = await client.query(`
          SELECT id, product_id
          FROM subscriptions
          WHERE product_id IS NOT NULL
        `);
        
        const subsToMigrate = result.rows;
        console.log(`[MIGRATION] Found ${subsToMigrate.length} subscriptions with product_id`);

        for (const sub of subsToMigrate) {
          // Check if this subscription already has items
          const existingItems = await client.query(`
            SELECT id
            FROM subscription_items
            WHERE subscription_id = $1
          `, [sub.id]);

          if (existingItems.rows.length > 0) {
            console.log(`[MIGRATION] Skipping subscription ${sub.id} - already has ${existingItems.rows.length} items`);
            skipped++;
            continue;
          }

          // Create subscription item from legacy product_id
          if (!dryRun) {
            await client.query(`
              INSERT INTO subscription_items (subscription_id, product_id, quantity)
              VALUES ($1, $2, $3)
            `, [sub.id, sub.product_id, 1]);
            console.log(`[MIGRATION] Migrated subscription ${sub.id} - added product ${sub.product_id}`);
          } else {
            console.log(`[MIGRATION] [DRY RUN] Would migrate subscription ${sub.id} - product ${sub.product_id}`);
          }
          migrated++;
        }

        if (dryRun) {
          // Rollback dry run
          await client.query('ROLLBACK');
          console.log('[MIGRATION] [DRY RUN] Transaction rolled back');
        } else {
          // Commit real migration
          await client.query('COMMIT');
          console.log('[MIGRATION] Transaction committed');
        }

        console.log(`[MIGRATION] Complete: ${migrated} ${dryRun ? 'would be migrated' : 'migrated'}, ${skipped} skipped`);
        return { migrated, skipped };
      } catch (error) {
        // Rollback on error
        await client.query('ROLLBACK');
        console.error('[MIGRATION] Transaction rolled back due to error:', error);
        throw error;
      } finally {
        client.release();
      }
    });
  }

  async createPasswordResetToken(userId: string, token: string, expiresAt: Date): Promise<void> {
    await db.insert(passwordResetTokens).values({
      userId,
      token,
      expiresAt,
    });
  }

  async getPasswordResetToken(token: string): Promise<{ id: string; userId: string; expiresAt: Date; used: boolean } | undefined> {
    const result = await db.select({
      id: passwordResetTokens.id,
      userId: passwordResetTokens.userId,
      expiresAt: passwordResetTokens.expiresAt,
      used: passwordResetTokens.used,
    })
      .from(passwordResetTokens)
      .where(eq(passwordResetTokens.token, token));
    return result[0];
  }

  async markPasswordResetTokenAsUsed(token: string): Promise<void> {
    await db.update(passwordResetTokens)
      .set({ used: true, usedAt: new Date() })
      .where(eq(passwordResetTokens.token, token));
  }

  async updateUserPassword(userId: string, hashedPassword: string): Promise<void> {
    await db.update(users)
      .set({ password: hashedPassword })
      .where(eq(users.id, userId));
  }

  async getUserByEmail(email: string): Promise<User | undefined> {
    const result = await db.select().from(users).where(sql`LOWER(${users.email}) = LOWER(${email})`);
    return result[0];
  }

  // CRM - Lead management methods
  async getLeads(filters?: { status?: string; priorityLevel?: string; assignedToUserId?: string }): Promise<Lead[]> {
    let query = db.select().from(leads);
    
    const conditions = [];
    if (filters?.status) {
      conditions.push(eq(leads.status, filters.status));
    }
    if (filters?.priorityLevel) {
      conditions.push(eq(leads.priorityLevel, filters.priorityLevel));
    }
    if (filters?.assignedToUserId) {
      conditions.push(eq(leads.assignedToUserId, filters.assignedToUserId));
    }
    
    if (conditions.length > 0) {
      query = query.where(and(...conditions)) as any;
    }
    
    const result = await query.orderBy(desc(leads.createdAt));
    return result;
  }

  async getLead(id: string): Promise<Lead | undefined> {
    const result = await db.select().from(leads).where(eq(leads.id, id));
    return result[0];
  }

  async createLead(lead: InsertLead): Promise<Lead> {
    const result = await db.insert(leads).values(lead).returning();
    return result[0];
  }

  async updateLead(id: string, updates: Partial<InsertLead>): Promise<Lead | undefined> {
    const result = await db
      .update(leads)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(leads.id, id))
      .returning();
    return result[0];
  }

  async deleteLead(id: string): Promise<void> {
    await db.delete(leads).where(eq(leads.id, id));
  }

  async searchLeads(query: string): Promise<Lead[]> {
    const result = await db
      .select()
      .from(leads)
      .where(
        or(
          sql`LOWER(${leads.businessName}) LIKE LOWER(${'%' + query + '%'})`,
          sql`LOWER(${leads.contactName}) LIKE LOWER(${'%' + query + '%'})`,
          sql`LOWER(${leads.email}) LIKE LOWER(${'%' + query + '%'})`,
          sql`LOWER(${leads.phone}) LIKE LOWER(${'%' + query + '%'})`
        )
      )
      .orderBy(desc(leads.createdAt));
    return result;
  }

  // CRM - Touch point management methods
  async getLeadTouchPoints(leadId: string): Promise<LeadTouchPoint[]> {
    const result = await db
      .select()
      .from(leadTouchPoints)
      .where(eq(leadTouchPoints.leadId, leadId))
      .orderBy(desc(leadTouchPoints.createdAt));
    return result;
  }

  async createLeadTouchPoint(touchPoint: InsertLeadTouchPoint): Promise<LeadTouchPoint> {
    const result = await db.insert(leadTouchPoints).values(touchPoint).returning();
    
    // Update the lead's updatedAt timestamp
    await db
      .update(leads)
      .set({ updatedAt: new Date() })
      .where(eq(leads.id, touchPoint.leadId));
    
    return result[0];
  }

  async getRecentTouchPoints(limit: number = 10): Promise<Array<LeadTouchPoint & { leadBusinessName: string; createdByName: string }>> {
    const result = await db
      .select({
        id: leadTouchPoints.id,
        leadId: leadTouchPoints.leadId,
        type: leadTouchPoints.type,
        subject: leadTouchPoints.subject,
        notes: leadTouchPoints.notes,
        createdByUserId: leadTouchPoints.createdByUserId,
        createdAt: leadTouchPoints.createdAt,
        leadBusinessName: leads.businessName,
        createdByName: sql<string>`${users.firstName} || ' ' || ${users.lastName}`,
      })
      .from(leadTouchPoints)
      .innerJoin(leads, eq(leadTouchPoints.leadId, leads.id))
      .innerJoin(users, eq(leadTouchPoints.createdByUserId, users.id))
      .orderBy(desc(leadTouchPoints.createdAt))
      .limit(limit);
    
    return result;
  }
}

export const storage = new PostgresStorage();
