import { 
  type Flavor, type InsertFlavor,
  type RetailProduct, type InsertRetailProduct,
  type InsertRetailProductFlavor,
  type WholesaleUnitType, type InsertWholesaleUnitType,
  type WholesaleUnitTypeFlavor, type InsertWholesaleUnitTypeFlavor,
  type WholesaleCustomerPricing, type InsertWholesaleCustomerPricing,
  type RetailCartItem, type InsertRetailCartItem,
  type RetailOrderItemV2, type InsertRetailOrderItemV2,
  type RetailSubscription, type InsertRetailSubscription,
  type RetailSubscriptionItem, type InsertRetailSubscriptionItem,
  type SubscriptionPlan, type InsertSubscriptionPlan,
  type CartItem, type InsertCartItem,
  type RetailCheckoutSession, type InsertRetailCheckoutSession,
  type RetailOrder, type InsertRetailOrder,
  type RetailOrderItem, type InsertRetailOrderItem,
  type WholesaleCustomer, type InsertWholesaleCustomer,
  type WholesaleLocation, type InsertWholesaleLocation,
  type DeliveryStop, type InsertDeliveryStop,
  type DeliveryRoute, type InsertDeliveryRoute,
  type DeliveryRouteStop, type InsertDeliveryRouteStop,
  type WholesaleOrder, type InsertWholesaleOrder,
  type WholesaleOrderItem, type InsertWholesaleOrderItem,
  type User, type InsertUser,
  type VerificationCode, type InsertVerificationCode,
  type EmailVerificationCode, type InsertEmailVerificationCode,
  type ImpersonationLog, type InsertImpersonationLog,
  type Lead, type InsertLead,
  type LeadTouchPoint, type InsertLeadTouchPoint,
  type PlaidItem, type InsertPlaidItem,
  type PlaidAccount, type InsertPlaidAccount,
  type AccountingCategory, type InsertAccountingCategory,
  type AccountingTransaction, type InsertAccountingTransaction,
  type TransactionAllocation, type InsertTransactionAllocation,
  flavors,
  retailProducts,
  retailProductFlavors,
  wholesaleUnitTypes,
  wholesaleUnitTypeFlavors,
  wholesaleCustomerPricing,
  retailCartItems,
  retailOrderItemsV2,
  retailSubscriptions,
  retailSubscriptionItems,
  subscriptionPlans,
  cartItems,
  retailCheckoutSessions,
  retailOrders,
  retailOrderItems,
  wholesaleCustomers,
  wholesaleLocations,
  deliveryStops,
  deliveryRoutes,
  deliveryRouteStops,
  wholesaleOrders,
  wholesaleOrderItems,
  users,
  verificationCodes,
  emailVerificationCodes,
  impersonationLogs,
  passwordResetTokens,
  leads,
  leadTouchPoints,
  plaidItems,
  plaidAccounts,
  accountingCategories,
  accountingTransactions,
  transactionAllocations,
  // Compatibility imports (temporary - old names mapping to new tables)
  products,
  productTypes,
  wholesalePricing,
  inventoryAdjustments,
  type Product, type InsertProduct,
  type ProductType, type InsertProductType,
  type WholesalePricing, type InsertWholesalePricing,
  type InventoryAdjustment, type InsertInventoryAdjustment,
} from "@shared/schema";
import { eq, and, or, desc, sql, inArray } from "drizzle-orm";
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
  
  // OLD SCHEMA - Product management
  getProducts(includeInactive?: boolean): Promise<Product[]>;
  getProduct(id: string): Promise<Product | undefined>;
  createProduct(product: InsertProduct): Promise<Product>;
  updateProduct(id: string, updates: Partial<InsertProduct>): Promise<Product | undefined>;
  updateProductStock(id: string, stockQuantity: number): Promise<Product | undefined>;
  getLowStockProducts(): Promise<Product[]>;
  
  createInventoryAdjustment(adjustment: InsertInventoryAdjustment): Promise<InventoryAdjustment>;
  
  // NEW SCHEMA - Flavor management
  getFlavors(includeInactive?: boolean): Promise<Flavor[]>;
  getFlavor(id: string): Promise<Flavor | undefined>;
  createFlavor(flavor: InsertFlavor): Promise<Flavor>;
  updateFlavor(id: string, updates: Partial<InsertFlavor>): Promise<Flavor | undefined>;
  deleteFlavor(id: string): Promise<void>;
  
  // NEW SCHEMA - Retail Product management
  getRetailProducts(includeInactive?: boolean): Promise<(RetailProduct & { flavor: Flavor | null, flavors: Flavor[] })[]>;
  getRetailProduct(id: string): Promise<(RetailProduct & { flavor: Flavor | null, flavors: Flavor[] }) | undefined>;
  createRetailProduct(product: InsertRetailProduct): Promise<RetailProduct>;
  updateRetailProduct(id: string, updates: Partial<InsertRetailProduct>): Promise<RetailProduct | undefined>;
  deleteRetailProduct(id: string): Promise<void>;
  setRetailProductFlavors(productId: string, flavorIds: string[]): Promise<void>;
  
  // NEW SCHEMA - Wholesale Unit Type management
  getWholesaleUnitTypes(includeInactive?: boolean): Promise<WholesaleUnitType[]>;
  getWholesaleUnitType(id: string): Promise<WholesaleUnitType | undefined>;
  getWholesaleUnitTypeWithFlavors(id: string): Promise<(WholesaleUnitType & { flavors: Flavor[] }) | undefined>;
  getAllWholesaleUnitTypesWithFlavors(): Promise<(WholesaleUnitType & { flavors: Flavor[] })[]>;
  createWholesaleUnitType(unitType: InsertWholesaleUnitType): Promise<WholesaleUnitType>;
  updateWholesaleUnitType(id: string, updates: Partial<InsertWholesaleUnitType>): Promise<WholesaleUnitType | undefined>;
  deleteWholesaleUnitType(id: string): Promise<void>;
  setWholesaleUnitTypeFlavors(unitTypeId: string, flavorIds: string[]): Promise<void>;
  
  getWholesaleCustomerPricing(customerId: string): Promise<WholesaleCustomerPricing[]>;
  getWholesaleCustomerPrice(customerId: string, unitTypeId: string): Promise<WholesaleCustomerPricing | undefined>;
  setWholesaleCustomerPrice(pricing: InsertWholesaleCustomerPricing): Promise<WholesaleCustomerPricing>;
  deleteWholesaleCustomerPrice(id: string): Promise<void>;
  getInventoryAdjustments(filters?: { productId?: string; reason?: string; limit?: number }): Promise<Array<InventoryAdjustment & { productName: string }>>;
  checkStockAvailability(productId: string, requiredQuantity: number): Promise<{ available: boolean; currentStock: number; deficit?: number }>;
  
  getSubscriptionPlans(): Promise<SubscriptionPlan[]>;
  getSubscriptionPlan(id: string): Promise<SubscriptionPlan | undefined>;
  createSubscriptionPlan(plan: InsertSubscriptionPlan): Promise<SubscriptionPlan>;
  
  getCartItems(sessionId: string, client?: any): Promise<CartItem[]>;
  addToCart(item: InsertCartItem): Promise<CartItem>;
  updateCartItemQuantity(id: string, quantity: number): Promise<CartItem | undefined>;
  removeFromCart(id: string): Promise<void>;
  clearCart(sessionId: string): Promise<void>;
  
  getRetailCart(sessionId: string, client?: any): Promise<Array<RetailCartItem & { retailProduct: RetailProduct & { flavor: Flavor | null, flavors: Flavor[] } }>>;
  addRetailProductToCart(item: InsertRetailCartItem): Promise<RetailCartItem>;
  updateRetailCartItemQuantity(id: string, quantity: number): Promise<RetailCartItem | undefined>;
  removeRetailCartItem(id: string): Promise<void>;
  clearRetailCart(sessionId: string): Promise<void>;
  
  // NEW SCHEMA - Retail Subscriptions
  getRetailSubscriptionByStripeId(stripeSubscriptionId: string): Promise<RetailSubscription | undefined>;
  getRetailSubscriptionBySessionId(sessionId: string): Promise<RetailSubscription | undefined>;
  createRetailSubscription(subscription: InsertRetailSubscription): Promise<RetailSubscription>;
  updateRetailSubscriptionByStripeId(stripeSubscriptionId: string, updates: Partial<RetailSubscription>): Promise<RetailSubscription | undefined>;
  
  getRetailSubscriptionItems(subscriptionId: string): Promise<Array<RetailSubscriptionItem & { retailProduct: RetailProduct & { flavor: Flavor } }>>;
  addRetailSubscriptionItem(item: InsertRetailSubscriptionItem): Promise<RetailSubscriptionItem>;
  
  getWholesaleCustomers(): Promise<WholesaleCustomer[]>;
  getWholesaleCustomer(id: string): Promise<WholesaleCustomer | undefined>;
  getWholesaleCustomerByEmail(email: string): Promise<WholesaleCustomer | undefined>;
  getWholesaleCustomerByAnyEmail(email: string): Promise<WholesaleCustomer | undefined>;
  getWholesaleCustomerByUserId(userId: string): Promise<WholesaleCustomer | undefined>;
  createWholesaleCustomer(customer: InsertWholesaleCustomer): Promise<WholesaleCustomer>;
  updateWholesaleCustomer(id: string, updates: Partial<InsertWholesaleCustomer>): Promise<WholesaleCustomer | undefined>;
  importWholesaleCustomers(csvData: any[]): Promise<{ imported: number; failed: number; errors: string[] }>;
  
  getWholesaleLocations(customerId: string): Promise<WholesaleLocation[]>;
  getWholesaleLocation(id: string): Promise<WholesaleLocation | undefined>;
  createWholesaleLocation(location: InsertWholesaleLocation): Promise<WholesaleLocation>;
  updateWholesaleLocation(id: string, updates: Partial<InsertWholesaleLocation>): Promise<WholesaleLocation | undefined>;
  deleteWholesaleLocation(id: string): Promise<void>;
  
  getWholesaleOrders(): Promise<WholesaleOrder[]>;
  getWholesaleOrder(id: string): Promise<WholesaleOrder | undefined>;
  getWholesaleOrdersByDeliveryDate(deliveryDate: Date): Promise<WholesaleOrder[]>;
  getWholesaleOrdersByDeliveryDateRange(startDate: Date, endDate: Date): Promise<WholesaleOrder[]>;
  getWholesaleOrdersByCustomerId(customerId: string): Promise<Array<WholesaleOrder & { items: Array<WholesaleOrderItem & { productName: string }> }>>;
  getWholesaleOrderWithDetails(id: string): Promise<{
    order: WholesaleOrder;
    customer: WholesaleCustomer;
    items: Array<WholesaleOrderItem & { product: { name: string; flavor: string } }>;
  } | undefined>;
  createWholesaleOrder(order: InsertWholesaleOrder): Promise<WholesaleOrder>;
  updateWholesaleOrderStatus(id: string, status: string): Promise<WholesaleOrder | undefined>;
  updateWholesaleOrderDeliveryDate(id: string, deliveryDate: Date | null): Promise<WholesaleOrder | undefined>;
  generateNextInvoiceNumber(): Promise<string>;
  
  getWholesaleOrderItems(orderId: string): Promise<WholesaleOrderItem[]>;
  getAllWholesaleOrderItems(): Promise<WholesaleOrderItem[]>;
  createWholesaleOrderItem(item: InsertWholesaleOrderItem): Promise<WholesaleOrderItem>;
  deleteWholesaleOrderItems(orderId: string): Promise<void>;
  updateWholesaleOrder(id: string, updates: { 
    totalAmount?: string; 
    notes?: string | null;
    dueDate?: Date | null;
    paidAt?: Date | null;
    paidByUserId?: string | null;
    stripePaymentIntentId?: string | null;
    invoiceSentAt?: Date | null;
  }): Promise<WholesaleOrder | undefined>;
  
  getAllWholesalePricing(): Promise<WholesalePricing[]>;
  getWholesalePricing(customerId: string): Promise<WholesalePricing[]>;
  getWholesalePrice(customerId: string, productTypeId: string): Promise<WholesalePricing | undefined>;
  setWholesalePrice(pricing: InsertWholesalePricing): Promise<WholesalePricing>;
  getProductTypes(): Promise<ProductType[]>;
  createProductType(productType: InsertProductType): Promise<ProductType>;
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
  getRetailOrdersWithDetailsByUserId(userId: string): Promise<Array<{
    order: RetailOrder;
    items: Array<RetailOrderItem & { product: Product }>;
  }>>;
  createRetailOrder(order: InsertRetailOrder): Promise<RetailOrder>;
  createRetailOrderItem(item: InsertRetailOrderItem): Promise<RetailOrderItem>;
  updateRetailOrderStatus(id: string, status: string, userId?: string): Promise<RetailOrder | undefined>;
  cancelRetailOrderWithInventoryRestore(id: string, staffUserId: string, reason: string): Promise<void>;
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
  
  // ACCOUNTING MODULE - Plaid Items
  getPlaidItems(): Promise<PlaidItem[]>;
  getPlaidItem(id: string): Promise<PlaidItem | undefined>;
  getPlaidItemByItemId(itemId: string): Promise<PlaidItem | undefined>;
  createPlaidItem(item: InsertPlaidItem): Promise<PlaidItem>;
  updatePlaidItemCursor(id: string, cursor: string): Promise<void>;
  deletePlaidItem(id: string): Promise<void>;
  
  // ACCOUNTING MODULE - Plaid Accounts
  getPlaidAccounts(plaidItemId: string): Promise<PlaidAccount[]>;
  getAllPlaidAccounts(): Promise<PlaidAccount[]>;
  getPlaidAccount(id: string): Promise<PlaidAccount | undefined>;
  getPlaidAccountByAccountId(accountId: string): Promise<PlaidAccount | undefined>;
  createPlaidAccount(account: InsertPlaidAccount): Promise<PlaidAccount>;
  updatePlaidAccountStatus(id: string, isActive: boolean): Promise<void>;
  
  // ACCOUNTING MODULE - Categories
  getAccountingCategories(): Promise<AccountingCategory[]>;
  getAccountingCategory(id: string): Promise<AccountingCategory | undefined>;
  createAccountingCategory(category: InsertAccountingCategory): Promise<AccountingCategory>;
  updateAccountingCategory(id: string, updates: Partial<InsertAccountingCategory>): Promise<AccountingCategory | undefined>;
  deleteAccountingCategory(id: string): Promise<void>;
  seedDefaultCategories(): Promise<void>;
  
  // ACCOUNTING MODULE - Transactions
  getAccountingTransactions(filters?: {
    startDate?: Date;
    endDate?: Date;
    categoryId?: string;
    allocated?: boolean;
    search?: string;
    plaidAccountId?: string;
    limit?: number;
    offset?: number;
  }): Promise<Array<AccountingTransaction & { allocations: TransactionAllocation[] }>>;
  getAccountingTransaction(id: string): Promise<AccountingTransaction | undefined>;
  createAccountingTransaction(transaction: InsertAccountingTransaction): Promise<AccountingTransaction>;
  createAccountingTransactions(transactions: InsertAccountingTransaction[]): Promise<AccountingTransaction[]>;
  getAccountingTransactionByTransactionId(transactionId: string): Promise<AccountingTransaction | undefined>;
  
  // ACCOUNTING MODULE - Allocations
  getTransactionAllocations(transactionId: string): Promise<TransactionAllocation[]>;
  createTransactionAllocation(allocation: InsertTransactionAllocation): Promise<TransactionAllocation>;
  deleteTransactionAllocations(transactionId: string): Promise<void>;
  bulkAllocateTransactions(transactionIds: string[], categoryId: string): Promise<void>;
  
  // ACCOUNTING MODULE - Financial Summary
  getFinancialSummary(startDate?: Date, endDate?: Date): Promise<{
    totalIncome: number;
    totalExpenses: number;
    netIncome: number;
    incomeByCategory: Array<{ categoryId: string | null; categoryName: string; amount: number }>;
    expensesByCategory: Array<{ categoryId: string | null; categoryName: string; amount: number }>;
    transfersByCategory: Array<{ categoryId: string | null; categoryName: string; amount: number }>;
    unallocatedIncome: number;
    unallocatedExpenses: number;
  }>;
  
  // DELIVERY ROUTE OPTIMIZATION
  getDeliveryStops(): Promise<DeliveryStop[]>;
  getDeliveryStop(id: string): Promise<DeliveryStop | undefined>;
  createDeliveryStop(stop: InsertDeliveryStop): Promise<DeliveryStop>;
  updateDeliveryStop(id: string, updates: Partial<InsertDeliveryStop>): Promise<DeliveryStop | undefined>;
  deleteDeliveryStop(id: string): Promise<void>;
  
  getDeliveryRoutes(): Promise<DeliveryRoute[]>;
  getDeliveryRoute(id: string): Promise<DeliveryRoute | undefined>;
  createDeliveryRoute(route: InsertDeliveryRoute): Promise<DeliveryRoute>;
  deleteDeliveryRoute(id: string): Promise<void>;
  
  getDeliveryRouteStops(routeId: string): Promise<DeliveryRouteStop[]>;
  createDeliveryRouteStop(stop: InsertDeliveryRouteStop): Promise<DeliveryRouteStop>;
  
  updateWholesaleLocationGeocoding(locationId: string, latitude: number, longitude: number): Promise<void>;
  getUnGeocodedWholesaleLocations(): Promise<WholesaleLocation[]>;
  
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

  // NEW SCHEMA - Flavor management implementation
  async getFlavors(includeInactive = false): Promise<Flavor[]> {
    if (includeInactive) {
      return await db.select().from(flavors).orderBy(flavors.displayOrder, flavors.name);
    }
    return await db.select().from(flavors).where(eq(flavors.isActive, true)).orderBy(flavors.displayOrder, flavors.name);
  }

  async getFlavor(id: string): Promise<Flavor | undefined> {
    const result = await db.select().from(flavors).where(eq(flavors.id, id));
    return result[0];
  }

  async createFlavor(insertFlavor: InsertFlavor): Promise<Flavor> {
    const result = await db.insert(flavors).values(insertFlavor).returning();
    return result[0];
  }

  async updateFlavor(id: string, updates: Partial<InsertFlavor>): Promise<Flavor | undefined> {
    const result = await db
      .update(flavors)
      .set(updates)
      .where(eq(flavors.id, id))
      .returning();
    return result[0];
  }

  async deleteFlavor(id: string): Promise<void> {
    await db.delete(flavors).where(eq(flavors.id, id));
  }

  // Helper function to attach multi-flavor data to retail products
  private async attachRetailProductFlavors<T extends RetailProduct>(
    products: T[]
  ): Promise<(T & { flavor: Flavor | null; flavors: Flavor[] })[]> {
    if (products.length === 0) {
      return [];
    }

    // Get all multi-flavor product IDs
    const multiFlavorProductIds = products
      .filter(p => p.productType === 'multi-flavor')
      .map(p => p.id);

    // Fetch multi-flavor associations if any exist
    let multiFlavorMap = new Map<string, Flavor[]>();
    if (multiFlavorProductIds.length > 0) {
      const multiFlavorResults = await db
        .select({
          retailProductId: retailProductFlavors.retailProductId,
          flavor: flavors,
        })
        .from(retailProductFlavors)
        .innerJoin(flavors, eq(retailProductFlavors.flavorId, flavors.id))
        .where(inArray(retailProductFlavors.retailProductId, multiFlavorProductIds));

      // Build map of productId -> flavors[]
      for (const row of multiFlavorResults) {
        if (!multiFlavorMap.has(row.retailProductId)) {
          multiFlavorMap.set(row.retailProductId, []);
        }
        multiFlavorMap.get(row.retailProductId)!.push(row.flavor);
      }
    }

    // Merge results: single-flavor products get flavor + empty flavors[], multi-flavor get null + flavors[]
    return products.map(product => {
      const flavors = multiFlavorMap.get(product.id) || [];
      return {
        ...product,
        flavor: product.productType === 'multi-flavor' ? null : (product as any).flavor,
        flavors,
      };
    });
  }

  // NEW SCHEMA - Retail Product management implementation
  async getRetailProducts(includeInactive = false): Promise<(RetailProduct & { flavor: Flavor | null; flavors: Flavor[] })[]> {
    const query = db
      .select()
      .from(retailProducts)
      .leftJoin(flavors, eq(retailProducts.flavorId, flavors.id))
      .orderBy(retailProducts.displayOrder, retailProducts.unitType);

    const results = includeInactive 
      ? await query
      : await query.where(eq(retailProducts.isActive, true));

    // Map results to include both product and flavor data
    const productsWithFlavor = results.map(r => ({
      ...r.retail_products,
      flavor: r.flavors,
    }));

    return this.attachRetailProductFlavors(productsWithFlavor);
  }

  async getRetailProduct(id: string): Promise<(RetailProduct & { flavor: Flavor | null; flavors: Flavor[] }) | undefined> {
    const result = await db
      .select()
      .from(retailProducts)
      .leftJoin(flavors, eq(retailProducts.flavorId, flavors.id))
      .where(eq(retailProducts.id, id));

    if (!result[0]) return undefined;

    const productWithFlavor = {
      ...result[0].retail_products,
      flavor: result[0].flavors,
    };

    const enriched = await this.attachRetailProductFlavors([productWithFlavor]);
    return enriched[0];
  }

  async createRetailProduct(insertRetailProduct: InsertRetailProduct): Promise<RetailProduct> {
    const result = await db.insert(retailProducts).values(insertRetailProduct).returning();
    return result[0];
  }

  async updateRetailProduct(id: string, updates: Partial<InsertRetailProduct>): Promise<RetailProduct | undefined> {
    const result = await db
      .update(retailProducts)
      .set(updates)
      .where(eq(retailProducts.id, id))
      .returning();
    return result[0];
  }

  async deleteRetailProduct(id: string): Promise<void> {
    // Check if product is in any orders
    const orderItems = await db.select().from(retailOrderItemsV2).where(eq(retailOrderItemsV2.retailProductId, id)).limit(1);
    if (orderItems.length > 0) {
      throw new Error("Cannot delete product: it has been ordered by customers");
    }

    // Check if product is in any subscriptions
    const subscriptionItems = await db.select().from(retailSubscriptionItems).where(eq(retailSubscriptionItems.retailProductId, id)).limit(1);
    if (subscriptionItems.length > 0) {
      throw new Error("Cannot delete product: it is part of active subscriptions");
    }

    // Remove product from any carts (safe to do since carts are temporary)
    await db.delete(retailCartItems).where(eq(retailCartItems.retailProductId, id));

    // Delete the product
    await db.delete(retailProducts).where(eq(retailProducts.id, id));
  }

  async setRetailProductFlavors(productId: string, flavorIds: string[]): Promise<void> {
    // Delete existing flavor associations
    await db.delete(retailProductFlavors).where(eq(retailProductFlavors.retailProductId, productId));

    // Add new flavor associations
    if (flavorIds.length > 0) {
      await db.insert(retailProductFlavors).values(
        flavorIds.map(flavorId => ({
          retailProductId: productId,
          flavorId,
        }))
      );
    }
  }

  // NEW SCHEMA - Wholesale Unit Type management implementation
  async getWholesaleUnitTypes(includeInactive = false): Promise<WholesaleUnitType[]> {
    if (includeInactive) {
      return await db.select().from(wholesaleUnitTypes).orderBy(wholesaleUnitTypes.displayOrder);
    }
    return await db.select().from(wholesaleUnitTypes).where(eq(wholesaleUnitTypes.isActive, true)).orderBy(wholesaleUnitTypes.displayOrder);
  }

  async getWholesaleUnitType(id: string): Promise<WholesaleUnitType | undefined> {
    const result = await db.select().from(wholesaleUnitTypes).where(eq(wholesaleUnitTypes.id, id));
    return result[0];
  }

  async getWholesaleUnitTypeWithFlavors(id: string): Promise<(WholesaleUnitType & { flavors: Flavor[] }) | undefined> {
    const unitType = await this.getWholesaleUnitType(id);
    if (!unitType) return undefined;

    const flavorLinks = await db
      .select({ flavor: flavors })
      .from(wholesaleUnitTypeFlavors)
      .leftJoin(flavors, eq(wholesaleUnitTypeFlavors.flavorId, flavors.id))
      .where(eq(wholesaleUnitTypeFlavors.unitTypeId, id));

    return {
      ...unitType,
      flavors: flavorLinks.map(link => link.flavor!).filter(Boolean),
    };
  }

  async getAllWholesaleUnitTypesWithFlavors(): Promise<(WholesaleUnitType & { flavors: Flavor[] })[]> {
    const unitTypes = await this.getWholesaleUnitTypes(true);
    
    const unitTypesWithFlavors = await Promise.all(
      unitTypes.map(async (unitType) => {
        const links = await db
          .select({
            flavor: flavors
          })
          .from(wholesaleUnitTypeFlavors)
          .innerJoin(flavors, eq(wholesaleUnitTypeFlavors.flavorId, flavors.id))
          .where(eq(wholesaleUnitTypeFlavors.unitTypeId, unitType.id));

        return {
          ...unitType,
          flavors: links.map(link => link.flavor),
        };
      })
    );

    return unitTypesWithFlavors;
  }

  async createWholesaleUnitType(insertWholesaleUnitType: InsertWholesaleUnitType): Promise<WholesaleUnitType> {
    const result = await db.insert(wholesaleUnitTypes).values(insertWholesaleUnitType).returning();
    return result[0];
  }

  async updateWholesaleUnitType(id: string, updates: Partial<InsertWholesaleUnitType>): Promise<WholesaleUnitType | undefined> {
    const result = await db
      .update(wholesaleUnitTypes)
      .set(updates)
      .where(eq(wholesaleUnitTypes.id, id))
      .returning();
    return result[0];
  }

  async deleteWholesaleUnitType(id: string): Promise<void> {
    await db.delete(wholesaleUnitTypes).where(eq(wholesaleUnitTypes.id, id));
  }

  async setWholesaleUnitTypeFlavors(unitTypeId: string, flavorIds: string[]): Promise<void> {
    // Delete existing flavor associations
    await db.delete(wholesaleUnitTypeFlavors).where(eq(wholesaleUnitTypeFlavors.unitTypeId, unitTypeId));
    
    // Insert new associations
    if (flavorIds.length > 0) {
      await db.insert(wholesaleUnitTypeFlavors).values(
        flavorIds.map(flavorId => ({
          unitTypeId,
          flavorId,
        }))
      );
    }
  }

  async getWholesaleCustomerPricing(customerId: string): Promise<WholesaleCustomerPricing[]> {
    return await db.select().from(wholesaleCustomerPricing).where(eq(wholesaleCustomerPricing.customerId, customerId));
  }

  async getWholesaleCustomerPrice(customerId: string, unitTypeId: string): Promise<WholesaleCustomerPricing | undefined> {
    const result = await db
      .select()
      .from(wholesaleCustomerPricing)
      .where(
        and(
          eq(wholesaleCustomerPricing.customerId, customerId),
          eq(wholesaleCustomerPricing.unitTypeId, unitTypeId)
        )
      );
    return result[0];
  }

  async setWholesaleCustomerPrice(pricing: InsertWholesaleCustomerPricing): Promise<WholesaleCustomerPricing> {
    const existing = await this.getWholesaleCustomerPrice(pricing.customerId, pricing.unitTypeId);
    if (existing) {
      const result = await db
        .update(wholesaleCustomerPricing)
        .set({ customPrice: pricing.customPrice })
        .where(eq(wholesaleCustomerPricing.id, existing.id))
        .returning();
      return result[0];
    } else {
      const result = await db.insert(wholesaleCustomerPricing).values(pricing).returning();
      return result[0];
    }
  }

  async deleteWholesaleCustomerPrice(id: string): Promise<void> {
    await db.delete(wholesaleCustomerPricing).where(eq(wholesaleCustomerPricing.id, id));
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

  async getCartItems(sessionId: string, client?: any): Promise<CartItem[]> {
    if (client) {
      // Transaction-aware with row locking
      const result = await client.query(
        'SELECT * FROM cart_items WHERE session_id = $1 FOR UPDATE',
        [sessionId]
      );
      return result.rows.map((row: any) => ({
        id: row.id,
        sessionId: row.session_id,
        productId: row.product_id,
        quantity: row.quantity,
        isSubscription: row.is_subscription,
        subscriptionFrequency: row.subscription_frequency,
        createdAt: row.created_at,
      }));
    }
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
        .set({ quantity: existing[0].quantity + (item.quantity || 1) })
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

  async getRetailCart(sessionId: string, client?: any): Promise<Array<RetailCartItem & { retailProduct: RetailProduct & { flavor: Flavor | null; flavors: Flavor[] } }>> {
    if (client) {
      // Transaction-aware with row locking - use raw SQL for cart items and products, then hydrate multi-flavor
      const result = await client.query(
        `SELECT 
          rc.*,
          rp.id as rp_id, rp.product_type, rp.product_name, rp.flavor_id, rp.unit_type, rp.unit_description,
          rp.price, rp.subscription_discount, rp.deposit, rp.product_image_url, rp.is_active as rp_is_active, rp.display_order,
          f.id as f_id, f.name as f_name, f.description as f_description, f.flavor_profile, f.ingredients, 
          f.primary_image_url, f.secondary_image_url, f.is_active as f_is_active, f.display_order as f_display_order
        FROM retail_cart_items rc
        INNER JOIN retail_products rp ON rc.retail_product_id = rp.id
        LEFT JOIN flavors f ON rp.flavor_id = f.id
        WHERE rc.session_id = $1
        FOR UPDATE OF rc`,
        [sessionId]
      );
      
      const baseCartItems = result.rows.map((row: any) => ({
        id: row.id,
        sessionId: row.session_id,
        retailProductId: row.retail_product_id,
        quantity: row.quantity,
        isSubscription: row.is_subscription,
        subscriptionFrequency: row.subscription_frequency,
        retailProduct: {
          id: row.rp_id,
          productType: row.product_type || 'single-flavor',
          productName: row.product_name,
          flavorId: row.flavor_id,
          unitType: row.unit_type,
          unitDescription: row.unit_description,
          price: row.price,
          subscriptionDiscount: row.subscription_discount,
          deposit: row.deposit,
          productImageUrl: row.product_image_url,
          isActive: row.rp_is_active,
          displayOrder: row.display_order,
          flavor: row.f_id ? {
            id: row.f_id,
            name: row.f_name,
            description: row.f_description,
            flavorProfile: row.flavor_profile,
            ingredients: row.ingredients,
            primaryImageUrl: row.primary_image_url,
            secondaryImageUrl: row.secondary_image_url,
            isActive: row.f_is_active,
            displayOrder: row.f_display_order,
          } : null
        }
      }));

      // Hydrate multi-flavor products
      const products = baseCartItems.map((item: any) => item.retailProduct);
      const enrichedProducts = await this.attachRetailProductFlavors(products);
      
      return baseCartItems.map((item: any, index: number) => ({
        ...item,
        retailProduct: enrichedProducts[index]
      }));
    }
    
    const items = await db
      .select()
      .from(retailCartItems)
      .innerJoin(retailProducts, eq(retailCartItems.retailProductId, retailProducts.id))
      .leftJoin(flavors, eq(retailProducts.flavorId, flavors.id))
      .where(eq(retailCartItems.sessionId, sessionId));

    const cartItemsWithProducts = items.map(item => ({
      ...item.retail_cart_items,
      retailProduct: {
        ...item.retail_products,
        flavor: item.flavors
      }
    }));

    // Hydrate multi-flavor products
    const products = cartItemsWithProducts.map(item => item.retailProduct);
    const enrichedProducts = await this.attachRetailProductFlavors(products);

    return cartItemsWithProducts.map((item, index) => ({
      ...item,
      retailProduct: enrichedProducts[index]
    }));
  }

  async addRetailProductToCart(item: InsertRetailCartItem): Promise<RetailCartItem> {
    const conditions = [
      eq(retailCartItems.sessionId, item.sessionId),
      eq(retailCartItems.retailProductId, item.retailProductId),
      eq(retailCartItems.isSubscription, item.isSubscription || false),
    ];

    // For multi-flavor products, also match by selected flavor
    if (item.selectedFlavorId) {
      conditions.push(eq(retailCartItems.selectedFlavorId, item.selectedFlavorId));
    }

    if (item.isSubscription && item.subscriptionFrequency) {
      conditions.push(eq(retailCartItems.subscriptionFrequency, item.subscriptionFrequency));
    }

    const existing = await db
      .select()
      .from(retailCartItems)
      .where(and(...conditions));

    if (existing.length > 0) {
      const updated = await db
        .update(retailCartItems)
        .set({ quantity: existing[0].quantity + (item.quantity || 1) })
        .where(eq(retailCartItems.id, existing[0].id))
        .returning();
      return updated[0];
    }

    const result = await db.insert(retailCartItems).values(item).returning();
    return result[0];
  }

  async updateRetailCartItemQuantity(id: string, quantity: number): Promise<RetailCartItem | undefined> {
    const result = await db
      .update(retailCartItems)
      .set({ quantity })
      .where(eq(retailCartItems.id, id))
      .returning();
    return result[0];
  }

  async removeRetailCartItem(id: string): Promise<void> {
    await db.delete(retailCartItems).where(eq(retailCartItems.id, id));
  }

  async clearRetailCart(sessionId: string): Promise<void> {
    await db.delete(retailCartItems).where(eq(retailCartItems.sessionId, sessionId));
  }

  // NEW SCHEMA - Retail Subscriptions
  async getRetailSubscriptionByStripeId(stripeSubscriptionId: string): Promise<RetailSubscription | undefined> {
    const result = await db.select().from(retailSubscriptions).where(eq(retailSubscriptions.stripeSubscriptionId, stripeSubscriptionId));
    return result[0];
  }

  async getRetailSubscriptionBySessionId(sessionId: string): Promise<RetailSubscription | undefined> {
    const result = await db.select().from(retailSubscriptions).where(eq(retailSubscriptions.stripeCheckoutSessionId, sessionId));
    return result[0];
  }

  async createRetailSubscription(subscription: InsertRetailSubscription): Promise<RetailSubscription> {
    const result = await db.insert(retailSubscriptions).values(subscription).returning();
    return result[0];
  }

  async updateRetailSubscriptionByStripeId(stripeSubscriptionId: string, updates: Partial<RetailSubscription>): Promise<RetailSubscription | undefined> {
    const result = await db
      .update(retailSubscriptions)
      .set(updates)
      .where(eq(retailSubscriptions.stripeSubscriptionId, stripeSubscriptionId))
      .returning();
    return result[0];
  }

  async getRetailSubscriptionItems(subscriptionId: string): Promise<Array<RetailSubscriptionItem & { retailProduct: RetailProduct & { flavor: Flavor } }>> {
    const results = await db
      .select({
        id: retailSubscriptionItems.id,
        subscriptionId: retailSubscriptionItems.subscriptionId,
        retailProductId: retailSubscriptionItems.retailProductId,
        quantity: retailSubscriptionItems.quantity,
        retailProduct: retailProducts,
        flavor: flavors,
      })
      .from(retailSubscriptionItems)
      .leftJoin(retailProducts, eq(retailSubscriptionItems.retailProductId, retailProducts.id))
      .leftJoin(flavors, eq(retailProducts.flavorId, flavors.id))
      .where(eq(retailSubscriptionItems.subscriptionId, subscriptionId));

    return results.map(r => ({
      id: r.id,
      subscriptionId: r.subscriptionId,
      retailProductId: r.retailProductId,
      quantity: r.quantity,
      retailProduct: {
        ...r.retailProduct!,
        flavor: r.flavor!,
      },
    }));
  }

  async addRetailSubscriptionItem(item: InsertRetailSubscriptionItem): Promise<RetailSubscriptionItem> {
    const result = await db
      .insert(retailSubscriptionItems)
      .values(item)
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

  async getWholesaleCustomerByAnyEmail(email: string): Promise<WholesaleCustomer | undefined> {
    // Check both the primary email field and the emails array
    const result = await db.select().from(wholesaleCustomers).where(
      or(
        eq(wholesaleCustomers.email, email),
        sql`${email} = ANY(${wholesaleCustomers.emails})`
      )
    );
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

  async importWholesaleCustomers(csvData: any[]): Promise<{ imported: number; failed: number; errors: string[] }> {
    const results = {
      imported: 0,
      failed: 0,
      errors: [] as string[],
    };

    for (const row of csvData) {
      try {
        // Parse additional emails
        const emails = [row.email];
        if (row.additionalEmails && row.additionalEmails.trim()) {
          const additionalEmailsList = row.additionalEmails
            .split('|')
            .map((e: string) => e.trim())
            .filter((e: string) => e.length > 0);
          emails.push(...additionalEmailsList);
        }

        // Check if customer already exists by primary email
        const existing = await this.getWholesaleCustomerByEmail(row.email);
        if (existing) {
          results.errors.push(`Customer with email ${row.email} already exists (${row.businessName})`);
          results.failed++;
          continue;
        }

        // Create customer
        const customerData: InsertWholesaleCustomer = {
          businessName: row.businessName,
          contactName: row.contactName,
          email: row.email,
          emails: emails,
          phone: row.phone,
          address: row.address,
          allowOnlinePayment: row.allowOnlinePayment === 'true' || row.allowOnlinePayment === true,
        };

        const newCustomer = await this.createWholesaleCustomer(customerData);

        // Create location if location data is provided
        if (row.locationName && row.locationName.trim() && 
            row.locationAddress && row.locationAddress.trim() &&
            row.locationCity && row.locationCity.trim() &&
            row.locationState && row.locationState.trim() &&
            row.locationZipCode && row.locationZipCode.trim()) {
          
          const locationData: InsertWholesaleLocation = {
            customerId: newCustomer.id,
            locationName: row.locationName.trim(),
            address: row.locationAddress.trim(),
            city: row.locationCity.trim(),
            state: row.locationState.trim(),
            zipCode: row.locationZipCode.trim(),
            contactName: row.locationContactName?.trim() || null,
            contactPhone: row.locationContactPhone?.trim() || null,
          };

          await this.createWholesaleLocation(locationData);
        }

        results.imported++;
      } catch (error: any) {
        results.errors.push(`Row ${results.imported + results.failed + 1}: ${error.message}`);
        results.failed++;
      }
    }

    return results;
  }

  async getWholesaleLocations(customerId: string): Promise<WholesaleLocation[]> {
    return await db
      .select()
      .from(wholesaleLocations)
      .where(eq(wholesaleLocations.customerId, customerId))
      .orderBy(wholesaleLocations.locationName);
  }

  async getWholesaleLocation(id: string): Promise<WholesaleLocation | undefined> {
    const result = await db.select().from(wholesaleLocations).where(eq(wholesaleLocations.id, id));
    return result[0];
  }

  async createWholesaleLocation(location: InsertWholesaleLocation): Promise<WholesaleLocation> {
    const result = await db.insert(wholesaleLocations).values(location).returning();
    return result[0];
  }

  async updateWholesaleLocation(id: string, updates: Partial<InsertWholesaleLocation>): Promise<WholesaleLocation | undefined> {
    const result = await db
      .update(wholesaleLocations)
      .set(updates)
      .where(eq(wholesaleLocations.id, id))
      .returning();
    return result[0];
  }

  async deleteWholesaleLocation(id: string): Promise<void> {
    await db.delete(wholesaleLocations).where(eq(wholesaleLocations.id, id));
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

  async getWholesaleOrdersByDeliveryDateRange(startDate: Date, endDate: Date): Promise<WholesaleOrder[]> {
    // Client sends half-open range: [Monday 00:00, nextMonday 00:00)
    // This naturally includes all of Sunday without timezone-related shifts
    // Use exclusive upper bound (< instead of <=) to avoid spillover into next week
    const result = await db
      .select()
      .from(wholesaleOrders)
      .where(
        and(
          sql`${wholesaleOrders.deliveryDate} >= ${startDate}`,
          sql`${wholesaleOrders.deliveryDate} < ${endDate}`
        )
      )
      .orderBy(wholesaleOrders.deliveryDate);
    return result;
  }

  async getWholesaleOrdersByCustomerId(customerId: string): Promise<Array<WholesaleOrder & { items: Array<WholesaleOrderItem & { productName: string }> }>> {
    const result = await db
      .select({
        order: wholesaleOrders,
        location: wholesaleLocations,
      })
      .from(wholesaleOrders)
      .leftJoin(wholesaleLocations, eq(wholesaleOrders.locationId, wholesaleLocations.id))
      .where(eq(wholesaleOrders.customerId, customerId))
      .orderBy(desc(wholesaleOrders.orderDate));

    // Get items for each order
    const ordersWithItems = await Promise.all(
      result.map(async (row) => {
        const order = row.order;
        const location = row.location;
        
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
          location: location ? {
            locationName: location.locationName,
            address: location.address,
            city: location.city,
            state: location.state,
            zipCode: location.zipCode,
            contactName: location.contactName || undefined,
            contactPhone: location.contactPhone || undefined,
          } : undefined,
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
    order: WholesaleOrder & { location?: { locationName: string; address: string; city: string; state: string; zipCode: string; contactName?: string; contactPhone?: string; } };
    customer: WholesaleCustomer;
    items: Array<WholesaleOrderItem & { product: { name: string; flavor: string } }>;
  } | undefined> {
    const order = await this.getWholesaleOrder(id);
    if (!order) return undefined;

    const customer = await this.getWholesaleCustomer(order.customerId);
    if (!customer) return undefined;

    // Get location data if locationId exists
    let location;
    if (order.locationId) {
      location = await this.getWholesaleLocation(order.locationId);
    }

    const orderItems = await this.getWholesaleOrderItems(id);
    
    // Pre-fetch all unit types and flavors for efficiency
    const allUnitTypes = await this.getWholesaleUnitTypes();
    const allFlavors = await this.getFlavors();
    
    const itemsWithProducts = await Promise.all(
      orderItems.map(async (item) => {
        let productName = 'Unknown Product';
        let flavorName = '';
        
        // New system: use unitTypeId and flavorId
        if (item.unitTypeId && item.flavorId) {
          const unitType = allUnitTypes.find(ut => ut.id === item.unitTypeId);
          const flavor = allFlavors.find(f => f.id === item.flavorId);
          productName = unitType?.name || 'Unknown Unit Type';
          flavorName = flavor?.name || '';
        } 
        // Legacy fallback: use productId
        else if (item.productId) {
          const product = await this.getProduct(item.productId);
          if (product) {
            productName = product.name;
          }
        }
        
        return { 
          ...item, 
          product: { 
            name: productName, 
            flavor: flavorName 
          } 
        };
      })
    );

    return {
      order: {
        ...order,
        location: location ? {
          locationName: location.locationName,
          address: location.address,
          city: location.city,
          state: location.state,
          zipCode: location.zipCode,
          contactName: location.contactName || undefined,
          contactPhone: location.contactPhone || undefined,
        } : undefined,
      },
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

  async getAllWholesaleOrderItems(): Promise<WholesaleOrderItem[]> {
    return await db.select().from(wholesaleOrderItems);
  }

  async createWholesaleOrderItem(item: InsertWholesaleOrderItem): Promise<WholesaleOrderItem> {
    const result = await db.insert(wholesaleOrderItems).values(item).returning();
    return result[0];
  }

  async deleteWholesaleOrderItems(orderId: string): Promise<void> {
    await db.delete(wholesaleOrderItems).where(eq(wholesaleOrderItems.orderId, orderId));
  }

  async updateWholesaleOrder(id: string, updates: { 
    totalAmount?: string; 
    notes?: string | null;
    dueDate?: Date | null;
    paidAt?: Date | null;
    paidByUserId?: string | null;
    stripePaymentIntentId?: string | null;
    invoiceSentAt?: Date | null;
  }): Promise<WholesaleOrder | undefined> {
    const result = await db
      .update(wholesaleOrders)
      .set(updates)
      .where(eq(wholesaleOrders.id, id))
      .returning();
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

  async createProductType(insertProductType: InsertProductType): Promise<ProductType> {
    const result = await db.insert(productTypes).values(insertProductType).returning();
    return result[0];
  }

  async updateProductType(id: string, updates: Partial<ProductType>): Promise<ProductType | undefined> {
    const result = await db
      .update(productTypes)
      .set(updates)
      .where(eq(productTypes.id, id))
      .returning();
    return result[0];
  }

  // ==================== ACCOUNTING MODULE IMPLEMENTATIONS ====================

  // Plaid Items
  async getPlaidItems(): Promise<PlaidItem[]> {
    return await db.select().from(plaidItems).orderBy(desc(plaidItems.createdAt));
  }

  async getPlaidItem(id: string): Promise<PlaidItem | undefined> {
    const result = await db.select().from(plaidItems).where(eq(plaidItems.id, id));
    return result[0];
  }

  async getPlaidItemByItemId(itemId: string): Promise<PlaidItem | undefined> {
    const result = await db.select().from(plaidItems).where(eq(plaidItems.itemId, itemId));
    return result[0];
  }

  async createPlaidItem(item: InsertPlaidItem): Promise<PlaidItem> {
    const result = await db.insert(plaidItems).values(item).returning();
    return result[0];
  }

  async updatePlaidItemCursor(id: string, cursor: string): Promise<void> {
    await db.update(plaidItems)
      .set({ cursor, lastSyncedAt: new Date(), updatedAt: new Date() })
      .where(eq(plaidItems.id, id));
  }

  async deletePlaidItem(id: string): Promise<void> {
    await db.delete(plaidItems).where(eq(plaidItems.id, id));
  }

  // Plaid Accounts
  async getPlaidAccounts(plaidItemId: string): Promise<PlaidAccount[]> {
    return await db.select().from(plaidAccounts).where(eq(plaidAccounts.plaidItemId, plaidItemId));
  }

  async getAllPlaidAccounts(): Promise<PlaidAccount[]> {
    return await db.select().from(plaidAccounts);
  }

  async getPlaidAccount(id: string): Promise<PlaidAccount | undefined> {
    const result = await db.select().from(plaidAccounts).where(eq(plaidAccounts.id, id));
    return result[0];
  }

  async getPlaidAccountByAccountId(accountId: string): Promise<PlaidAccount | undefined> {
    const result = await db.select().from(plaidAccounts).where(eq(plaidAccounts.accountId, accountId));
    return result[0];
  }

  async createPlaidAccount(account: InsertPlaidAccount): Promise<PlaidAccount> {
    const result = await db.insert(plaidAccounts).values(account).returning();
    return result[0];
  }

  async updatePlaidAccountStatus(id: string, isActive: boolean): Promise<void> {
    await db.update(plaidAccounts).set({ isActive }).where(eq(plaidAccounts.id, id));
  }

  // Accounting Categories
  async getAccountingCategories(): Promise<AccountingCategory[]> {
    return await db.select().from(accountingCategories).orderBy(accountingCategories.displayOrder);
  }

  async getAccountingCategory(id: string): Promise<AccountingCategory | undefined> {
    const result = await db.select().from(accountingCategories).where(eq(accountingCategories.id, id));
    return result[0];
  }

  async createAccountingCategory(category: InsertAccountingCategory): Promise<AccountingCategory> {
    const result = await db.insert(accountingCategories).values(category).returning();
    return result[0];
  }

  async updateAccountingCategory(id: string, updates: Partial<InsertAccountingCategory>): Promise<AccountingCategory | undefined> {
    const result = await db.update(accountingCategories)
      .set(updates)
      .where(eq(accountingCategories.id, id))
      .returning();
    return result[0];
  }

  async deleteAccountingCategory(id: string): Promise<void> {
    await db.delete(accountingCategories).where(eq(accountingCategories.id, id));
  }

  async seedDefaultCategories(): Promise<void> {
    const existing = await this.getAccountingCategories();
    if (existing.length > 0) return;

    const defaultCategories: InsertAccountingCategory[] = [
      // Income categories
      { name: 'Membership Revenue', type: 'income', description: 'Revenue from membership fees', color: '#22c55e', displayOrder: 1, isDefault: true },
      { name: 'Seminar Revenue', type: 'income', description: 'Revenue from seminars and events', color: '#16a34a', displayOrder: 2, isDefault: true },
      { name: 'Equipment Sales', type: 'income', description: 'Revenue from equipment sales', color: '#15803d', displayOrder: 3, isDefault: true },
      // Expense categories
      { name: 'Rent', type: 'expense', description: 'Facility rent payments', color: '#ef4444', displayOrder: 10, isDefault: true },
      { name: 'Utilities', type: 'expense', description: 'Electricity, water, gas', color: '#dc2626', displayOrder: 11, isDefault: true },
      { name: 'Payroll', type: 'expense', description: 'Employee wages and salaries', color: '#b91c1c', displayOrder: 12, isDefault: true },
      { name: 'Equipment', type: 'expense', description: 'Equipment purchases and maintenance', color: '#991b1b', displayOrder: 13, isDefault: true },
      { name: 'Marketing', type: 'expense', description: 'Advertising and promotional expenses', color: '#7f1d1d', displayOrder: 14, isDefault: true },
      { name: 'Insurance', type: 'expense', description: 'Business insurance premiums', color: '#f97316', displayOrder: 15, isDefault: true },
      { name: 'Professional Services', type: 'expense', description: 'Legal, accounting, consulting', color: '#ea580c', displayOrder: 16, isDefault: true },
      // Transfer categories
      { name: 'Owner Distribution', type: 'transfer', description: 'Owner draws and distributions', color: '#6366f1', displayOrder: 20, isDefault: true },
      { name: 'Bank Transfer', type: 'transfer', description: 'Transfers between accounts', color: '#4f46e5', displayOrder: 21, isDefault: true },
    ];

    await db.insert(accountingCategories).values(defaultCategories);
  }

  // Accounting Transactions
  async getAccountingTransactions(filters?: {
    startDate?: Date;
    endDate?: Date;
    categoryId?: string;
    allocated?: boolean;
    search?: string;
    plaidAccountId?: string;
    limit?: number;
    offset?: number;
  }): Promise<Array<AccountingTransaction & { allocations: TransactionAllocation[] }>> {
    const conditions: any[] = [];

    if (filters?.startDate) {
      conditions.push(sql`${accountingTransactions.date} >= ${filters.startDate}`);
    }
    if (filters?.endDate) {
      conditions.push(sql`${accountingTransactions.date} <= ${filters.endDate}`);
    }
    if (filters?.plaidAccountId) {
      conditions.push(eq(accountingTransactions.plaidAccountId, filters.plaidAccountId));
    }
    if (filters?.search) {
      conditions.push(sql`LOWER(${accountingTransactions.name}) LIKE LOWER(${'%' + filters.search + '%'})`);
    }

    let query = db.select().from(accountingTransactions);
    if (conditions.length > 0) {
      query = query.where(and(...conditions)) as any;
    }
    query = query.orderBy(desc(accountingTransactions.date)) as any;

    if (filters?.limit) {
      query = query.limit(filters.limit) as any;
    }
    if (filters?.offset) {
      query = query.offset(filters.offset) as any;
    }

    const transactions = await query;

    // Get allocations for each transaction
    const transactionsWithAllocations = await Promise.all(
      transactions.map(async (tx: AccountingTransaction) => {
        const allocations = await this.getTransactionAllocations(tx.id);
        return { ...tx, allocations };
      })
    );

    // Filter by allocation status if specified
    if (filters?.allocated !== undefined) {
      return transactionsWithAllocations.filter(tx => 
        filters.allocated ? tx.allocations.length > 0 : tx.allocations.length === 0
      );
    }

    // Filter by category if specified
    if (filters?.categoryId) {
      return transactionsWithAllocations.filter(tx =>
        tx.allocations.some(a => a.categoryId === filters.categoryId)
      );
    }

    return transactionsWithAllocations;
  }

  async getAccountingTransaction(id: string): Promise<AccountingTransaction | undefined> {
    const result = await db.select().from(accountingTransactions).where(eq(accountingTransactions.id, id));
    return result[0];
  }

  async createAccountingTransaction(transaction: InsertAccountingTransaction): Promise<AccountingTransaction> {
    const result = await db.insert(accountingTransactions).values(transaction).returning();
    return result[0];
  }

  async createAccountingTransactions(transactions: InsertAccountingTransaction[]): Promise<AccountingTransaction[]> {
    if (transactions.length === 0) return [];
    const result = await db.insert(accountingTransactions).values(transactions).returning();
    return result;
  }

  async getAccountingTransactionByTransactionId(transactionId: string): Promise<AccountingTransaction | undefined> {
    const result = await db.select().from(accountingTransactions)
      .where(eq(accountingTransactions.transactionId, transactionId));
    return result[0];
  }

  // Transaction Allocations
  async getTransactionAllocations(transactionId: string): Promise<TransactionAllocation[]> {
    return await db.select().from(transactionAllocations)
      .where(eq(transactionAllocations.transactionId, transactionId));
  }

  async createTransactionAllocation(allocation: InsertTransactionAllocation): Promise<TransactionAllocation> {
    const result = await db.insert(transactionAllocations).values(allocation).returning();
    return result[0];
  }

  async deleteTransactionAllocations(transactionId: string): Promise<void> {
    await db.delete(transactionAllocations).where(eq(transactionAllocations.transactionId, transactionId));
  }

  async bulkAllocateTransactions(transactionIds: string[], categoryId: string): Promise<void> {
    // Get all transactions to allocate
    const transactions = await db.select().from(accountingTransactions)
      .where(inArray(accountingTransactions.id, transactionIds));

    // Delete existing allocations
    await db.delete(transactionAllocations)
      .where(inArray(transactionAllocations.transactionId, transactionIds));

    // Create new allocations
    const allocations = transactions.map(tx => ({
      transactionId: tx.id,
      categoryId,
      amount: tx.amount,
    }));

    if (allocations.length > 0) {
      await db.insert(transactionAllocations).values(allocations);
    }
  }

  // Financial Summary
  async getFinancialSummary(startDate?: Date, endDate?: Date): Promise<{
    totalIncome: number;
    totalExpenses: number;
    netIncome: number;
    incomeByCategory: Array<{ categoryId: string | null; categoryName: string; amount: number }>;
    expensesByCategory: Array<{ categoryId: string | null; categoryName: string; amount: number }>;
    transfersByCategory: Array<{ categoryId: string | null; categoryName: string; amount: number }>;
    unallocatedIncome: number;
    unallocatedExpenses: number;
  }> {
    const transactions = await this.getAccountingTransactions({ startDate, endDate });
    const categories = await this.getAccountingCategories();

    const categoryMap = new Map(categories.map(c => [c.id, c]));

    let totalIncome = 0;
    let totalExpenses = 0;
    let unallocatedIncome = 0;
    let unallocatedExpenses = 0;

    const incomeByCategoryMap = new Map<string | null, number>();
    const expensesByCategoryMap = new Map<string | null, number>();
    const transfersByCategoryMap = new Map<string | null, number>();

    for (const tx of transactions) {
      const amount = Number(tx.amount);
      const isExpense = amount > 0; // Plaid convention: positive = expense

      if (tx.allocations.length === 0) {
        // Unallocated transaction
        if (isExpense) {
          totalExpenses += amount;
          unallocatedExpenses += amount;
          expensesByCategoryMap.set(null, (expensesByCategoryMap.get(null) || 0) + amount);
        } else {
          totalIncome += Math.abs(amount);
          unallocatedIncome += Math.abs(amount);
          incomeByCategoryMap.set(null, (incomeByCategoryMap.get(null) || 0) + Math.abs(amount));
        }
      } else {
        // Allocated transaction
        for (const allocation of tx.allocations) {
          const category = categoryMap.get(allocation.categoryId);
          const allocAmount = Number(allocation.amount);

          if (category?.type === 'income') {
            totalIncome += Math.abs(allocAmount);
            incomeByCategoryMap.set(allocation.categoryId, (incomeByCategoryMap.get(allocation.categoryId) || 0) + Math.abs(allocAmount));
          } else if (category?.type === 'expense') {
            totalExpenses += Math.abs(allocAmount);
            expensesByCategoryMap.set(allocation.categoryId, (expensesByCategoryMap.get(allocation.categoryId) || 0) + Math.abs(allocAmount));
          } else if (category?.type === 'transfer') {
            transfersByCategoryMap.set(allocation.categoryId, (transfersByCategoryMap.get(allocation.categoryId) || 0) + Math.abs(allocAmount));
          }
        }
      }
    }

    const incomeByCategory = Array.from(incomeByCategoryMap.entries()).map(([categoryId, amount]) => ({
      categoryId,
      categoryName: categoryId ? categoryMap.get(categoryId)?.name || 'Unknown' : 'Unallocated',
      amount,
    }));

    const expensesByCategory = Array.from(expensesByCategoryMap.entries()).map(([categoryId, amount]) => ({
      categoryId,
      categoryName: categoryId ? categoryMap.get(categoryId)?.name || 'Unknown' : 'Unallocated',
      amount,
    }));

    const transfersByCategory = Array.from(transfersByCategoryMap.entries()).map(([categoryId, amount]) => ({
      categoryId,
      categoryName: categoryId ? categoryMap.get(categoryId)?.name || 'Unknown' : 'Unknown',
      amount,
    }));

    return {
      totalIncome,
      totalExpenses,
      netIncome: totalIncome - totalExpenses,
      incomeByCategory,
      expensesByCategory,
      transfersByCategory,
      unallocatedIncome,
      unallocatedExpenses,
    };
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
        subscriptionCount: sql<number>`COUNT(${retailSubscriptions.id})::int`,
        activeSubscriptionCount: sql<number>`SUM(CASE WHEN ${retailSubscriptions.status} = 'active' THEN 1 ELSE 0 END)::int`,
      })
      .from(users)
      .leftJoin(retailSubscriptions, eq(retailSubscriptions.userId, users.id))
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
          subscriptionCount: sql<number>`COUNT(${retailSubscriptions.id})::int`,
          activeSubscriptionCount: sql<number>`SUM(CASE WHEN ${retailSubscriptions.status} = 'active' THEN 1 ELSE 0 END)::int`,
        })
        .from(users)
        .leftJoin(retailSubscriptions, eq(retailSubscriptions.userId, users.id))
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

  async getRetailOrdersWithDetailsByUserId(userId: string): Promise<Array<{
    order: RetailOrder;
    items: Array<RetailOrderItem & { product: Product }>;
  }>> {
    const orders = await this.getRetailOrdersByUserId(userId);
    
    if (orders.length === 0) return [];

    const orderIds = orders.map(o => o.id);
    
    const allItems = await db
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
      .where(sql`${retailOrderItems.orderId} = ANY(ARRAY[${sql.join(orderIds.map(id => sql`${id}::text`), sql`, `)}])`);

    const itemsByOrderId = allItems.reduce((acc, item) => {
      if (!acc[item.orderId]) {
        acc[item.orderId] = [];
      }
      acc[item.orderId].push({
        id: item.id,
        orderId: item.orderId,
        productId: item.productId,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        product: item.product,
      });
      return acc;
    }, {} as Record<string, Array<RetailOrderItem & { product: Product }>>);

    return orders.map(order => ({
      order,
      items: itemsByOrderId[order.id] || [],
    }));
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

  async cancelRetailOrderWithInventoryRestore(id: string, staffUserId: string, reason: string): Promise<void> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Get order items using the same transaction client
      const orderItemsResult = await client.query(
        'SELECT id, order_id, product_id, quantity, unit_price FROM retail_order_items WHERE order_id = $1',
        [id]
      );
      
      const orderItems = orderItemsResult.rows;

      // Restore inventory for each item by creating positive adjustments
      for (const item of orderItems) {
        await client.query(
          `INSERT INTO inventory_adjustments 
          (product_id, quantity, reason, staff_user_id, order_id, order_type)
          VALUES ($1, $2, $3, $4, $5, $6)`,
          [item.product_id, item.quantity, reason, staffUserId, id, 'retail']
        );

        // Update product stock
        await client.query(
          `UPDATE products 
           SET stock_quantity = stock_quantity + $1,
               in_stock = CASE WHEN stock_quantity + $1 > 0 THEN true ELSE in_stock END
           WHERE id = $2`,
          [item.quantity, item.product_id]
        );
      }

      // Update order status to cancelled
      await client.query(
        'UPDATE retail_orders SET status = $1 WHERE id = $2',
        ['cancelled', id]
      );

      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async generateNextOrderNumber(client?: any): Promise<string> {
    const currentYear = new Date().getFullYear();
    
    if (client) {
      // 🔒 Use PostgreSQL advisory lock to prevent concurrent number generation
      // Lock ID: hash of "retail_order_number" string for uniqueness
      const lockId = 123456789; // Arbitrary but consistent number for order generation
      await client.query('SELECT pg_advisory_xact_lock($1)', [lockId]);
      
      const result = await client.query(
        `SELECT order_number FROM retail_orders 
         WHERE order_number LIKE $1
         ORDER BY order_number DESC 
         LIMIT 1`,
        [`RO-${currentYear}-%`]
      );
      
      if (result.rows.length === 0) {
        return `RO-${currentYear}-0001`;
      }
      
      const lastOrder = result.rows[0].order_number;
      const match = lastOrder.match(/RO-\d{4}-(\d{4})/);
      const nextNumber = match ? parseInt(match[1]) + 1 : 1;
      return `RO-${currentYear}-${String(nextNumber).padStart(4, '0')}`;
    } else {
      const result = await db
        .select()
        .from(retailOrders)
        .where(sql`${retailOrders.orderNumber} LIKE ${`RO-${currentYear}-%`}`)
        .orderBy(desc(retailOrders.orderNumber));
      
      if (result.length === 0) {
        return `RO-${currentYear}-0001`;
      }
      
      const lastOrder = result[0].orderNumber;
      const match = lastOrder.match(/RO-\d{4}-(\d{4})/);
      const nextNumber = match ? parseInt(match[1]) + 1 : 1;
      return `RO-${currentYear}-${String(nextNumber).padStart(4, '0')}`;
    }
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

  // DELIVERY ROUTE OPTIMIZATION - Delivery Stops (custom non-order stops)
  async getDeliveryStops(): Promise<DeliveryStop[]> {
    const result = await db.select().from(deliveryStops).orderBy(desc(deliveryStops.createdAt));
    return result;
  }

  async getDeliveryStop(id: string): Promise<DeliveryStop | undefined> {
    const result = await db.select().from(deliveryStops).where(eq(deliveryStops.id, id));
    return result[0];
  }

  async createDeliveryStop(stop: InsertDeliveryStop): Promise<DeliveryStop> {
    const result = await db.insert(deliveryStops).values(stop).returning();
    return result[0];
  }

  async updateDeliveryStop(id: string, updates: Partial<InsertDeliveryStop>): Promise<DeliveryStop | undefined> {
    const result = await db
      .update(deliveryStops)
      .set(updates)
      .where(eq(deliveryStops.id, id))
      .returning();
    return result[0];
  }

  async deleteDeliveryStop(id: string): Promise<void> {
    await db.delete(deliveryStops).where(eq(deliveryStops.id, id));
  }

  // DELIVERY ROUTE OPTIMIZATION - Delivery Routes
  async getDeliveryRoutes(): Promise<DeliveryRoute[]> {
    const result = await db.select().from(deliveryRoutes).orderBy(desc(deliveryRoutes.generatedAt));
    return result;
  }

  async getDeliveryRoute(id: string): Promise<DeliveryRoute | undefined> {
    const result = await db.select().from(deliveryRoutes).where(eq(deliveryRoutes.id, id));
    return result[0];
  }

  async createDeliveryRoute(route: InsertDeliveryRoute): Promise<DeliveryRoute> {
    const result = await db.insert(deliveryRoutes).values(route).returning();
    return result[0];
  }

  async deleteDeliveryRoute(id: string): Promise<void> {
    await db.delete(deliveryRoutes).where(eq(deliveryRoutes.id, id));
  }

  // DELIVERY ROUTE OPTIMIZATION - Route Stops
  async getDeliveryRouteStops(routeId: string): Promise<DeliveryRouteStop[]> {
    const result = await db
      .select()
      .from(deliveryRouteStops)
      .where(eq(deliveryRouteStops.routeId, routeId))
      .orderBy(deliveryRouteStops.stopOrder);
    return result;
  }

  async createDeliveryRouteStop(stop: InsertDeliveryRouteStop): Promise<DeliveryRouteStop> {
    const result = await db.insert(deliveryRouteStops).values(stop).returning();
    return result[0];
  }

  // DELIVERY ROUTE OPTIMIZATION - Geocoding
  async updateWholesaleLocationGeocoding(locationId: string, latitude: number, longitude: number): Promise<void> {
    await db
      .update(wholesaleLocations)
      .set({ 
        latitude: String(latitude), 
        longitude: String(longitude), 
        geocodedAt: new Date() 
      })
      .where(eq(wholesaleLocations.id, locationId));
  }

  async getUnGeocodedWholesaleLocations(): Promise<WholesaleLocation[]> {
    const result = await db
      .select()
      .from(wholesaleLocations)
      .where(sql`${wholesaleLocations.latitude} IS NULL OR ${wholesaleLocations.longitude} IS NULL`);
    return result;
  }
}

export const storage = new PostgresStorage();
