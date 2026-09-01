import { formatPhoneNumber } from "../shared/phone";
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
  type AdminTask, type InsertAdminTask,
  type AdminTaskCompletion, type InsertAdminTaskCompletion,
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
  wholesaleOrderAdjustments,
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
  adminTasks,
  adminTaskCompletions,
  // Compatibility imports (temporary - old names mapping to new tables)
  products,
  productTypes,
  wholesalePricing,
  inventoryAdjustments,

  productionMaterialUsage,

  materialStockAdjustments,
  type Product, type InsertProduct,
  type ProductType, type InsertProductType,
  type WholesalePricing, type InsertWholesalePricing,
  type InventoryAdjustment, type InsertInventoryAdjustment,
  // Materials inventory module
  suppliers, materials, processes, processMaterials, productions, materialOrders, orderMaterials,
  type Supplier, type InsertSupplier,
  type Material, type InsertMaterial,
  type Process, type InsertProcess,
  type ProcessMaterial, type InsertProcessMaterial,
  type Production, type InsertProduction,
  type MaterialOrder, type InsertMaterialOrder,
  type OrderMaterial,
} from "@shared/schema";
import { eq, and, or, desc, asc, sql, inArray, isNull, gte, lt } from "drizzle-orm";
import { Pool, neonConfig } from "@neondatabase/serverless";
import ws from "ws";
import session from "express-session";
import connectPg from "connect-pg-simple";
import { db } from "./db";

neonConfig.webSocketConstructor = ws;

// Exported so other modules (e.g. billing-cron) can run true interactive
// transactions with advisory locks — the neon-http `db` client cannot.
export const pool = new Pool({ connectionString: process.env.DATABASE_URL });

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
  getUsersByRole(role: string): Promise<User[]>;
  
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
  getEmailVerificationCodeByToken(token: string): Promise<EmailVerificationCode | undefined>;
  getLatestEmailVerificationCodeByPurpose(email: string, purpose: 'registration' | 'login' | 'retail_2fa'): Promise<EmailVerificationCode | undefined>;
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
  deleteWholesaleCustomer(id: string): Promise<void>;
  importWholesaleCustomers(csvData: any[]): Promise<{ imported: number; failed: number; errors: string[]; locationsAdded: number; usersCreated: number }>;
  
  getWholesaleLocations(customerId: string): Promise<WholesaleLocation[]>;
  getWholesaleLocation(id: string): Promise<WholesaleLocation | undefined>;
  createWholesaleLocation(location: InsertWholesaleLocation): Promise<WholesaleLocation>;
  updateWholesaleLocation(id: string, updates: Partial<InsertWholesaleLocation>): Promise<WholesaleLocation | undefined>;
  deleteWholesaleLocation(id: string): Promise<void>;
  
  getWholesaleOrders(options?: { limit?: number; offset?: number }): Promise<{ orders: Array<WholesaleOrder & { locationName: string | null }>; total: number }>;
  getWholesaleOrder(id: string): Promise<WholesaleOrder | undefined>;
  getWholesaleOrdersByDeliveryDate(deliveryDate: Date): Promise<WholesaleOrder[]>;
  getWholesaleOrdersByDeliveryDateRange(startDate: Date, endDate: Date): Promise<WholesaleOrder[]>;
  getWeeklyBoardOrders(start: Date, end: Date, opts?: { retailBacklog?: boolean }): Promise<{
    retail: Array<{ id: string; orderNumber: string; customerName: string; pickupDate: Date | null; orderDate: Date; status: string; isSubscriptionOrder: boolean; totalAmount: string; notes: string | null; items: Array<{ flavorName: string; unitDescription: string; quantity: number; notes: string | null }> }>;
    wholesale: Array<{ id: string; invoiceNumber: string; businessName: string; city: string | null; locationName: string | null; fulfillmentMethod: string; deliveryDate: Date | null; orderDate: Date; status: string; totalAmount: string; notes: string | null; items: Array<{ unitTypeName: string; flavorName: string; quantity: number }> }>;
  }>;
  getWholesaleOrdersByCustomerId(customerId: string): Promise<Array<WholesaleOrder & { items: Array<WholesaleOrderItem & { productName: string | null; unitTypeName: string | null; flavorName: string | null }> }>>;
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
  deleteWholesaleOrder(id: string): Promise<void>;
  updateWholesaleOrder(id: string, updates: { 
    totalAmount?: string; 
    poNumber?: string | null;
    notes?: string | null;
    dueDate?: Date | null;
    paidAt?: Date | null;
    paidByUserId?: string | null;
    // ACH is asynchronous: initiated = debit authorised, paidAt = funds actually received.
    paymentInitiatedAt?: Date | null;
    paymentFailedAt?: Date | null;
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
  
  getRetailOrders(options?: { limit?: number; offset?: number; status?: string }): Promise<{ orders: RetailOrder[]; total: number }>;
  getRetailOrderCounts(): Promise<Record<string, number>>;
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
  applyWholesaleOrderStock(orderId: string, action: 'apply' | 'restore', userId?: string): Promise<{ changed: boolean; warnings: string[] }>;
  
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
      tableName: "sessions",
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
    // One phone format everywhere — normalize at the door, not at every caller.
    const result = await db.insert(users).values({
      ...userData,
      ...(userData.phoneNumber ? { phoneNumber: formatPhoneNumber(userData.phoneNumber) } : {}),
    }).returning();
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

  async getUsersByRole(role: string): Promise<User[]> {
    const result = await db
      .select()
      .from(users)
      .where(eq(users.role, role));
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
      .where(sql`LOWER(${emailVerificationCodes.email}) = LOWER(${email})`)
      .orderBy(desc(emailVerificationCodes.createdAt))
      .limit(1);
    return result[0];
  }

  /**
   * Look up an unconsumed magic-link token. Matches on the token alone — it carries its
   * own entropy, so the caller does not supply an email that could be probed.
   */
  async getEmailVerificationCodeByToken(token: string): Promise<EmailVerificationCode | undefined> {
    if (!token) return undefined;
    const result = await db
      .select()
      .from(emailVerificationCodes)
      .where(and(
        eq(emailVerificationCodes.loginToken, token),
        eq(emailVerificationCodes.verified, false),
      ))
      .limit(1);
    return result[0];
  }

  async getLatestEmailVerificationCodeByPurpose(email: string, purpose: 'registration' | 'login' | 'retail_2fa'): Promise<EmailVerificationCode | undefined> {
    const result = await db
      .select()
      .from(emailVerificationCodes)
      .where(
        and(
          sql`LOWER(${emailVerificationCodes.email}) = LOWER(${email})`,
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

  // Retail orders scheduled for pickup on a given day (UTC day window).
  // Backs GET /api/retail/pickup-report.
  async getRetailOrdersByPickupDate(date: Date): Promise<RetailOrder[]> {
    const start = new Date(date);
    start.setUTCHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setUTCDate(end.getUTCDate() + 1);

    return await db
      .select()
      .from(retailOrders)
      .where(
        and(
          isNull(retailOrders.deletedAt),
          gte(retailOrders.pickupDate, start),
          lt(retailOrders.pickupDate, end)
        )
      )
      .orderBy(asc(retailOrders.pickupDate));
  }

  // ===== Materials inventory module =====

  // Suppliers (excludes soft-deleted)
  async getSuppliers(): Promise<Supplier[]> {
    return await db
      .select()
      .from(suppliers)
      .where(isNull(suppliers.deletedAt))
      .orderBy(asc(suppliers.name));
  }

  async createSupplier(data: InsertSupplier): Promise<Supplier> {
    const result = await db.insert(suppliers).values(data).returning();
    return result[0];
  }

  async updateSupplier(id: string, updates: Partial<InsertSupplier>): Promise<Supplier | undefined> {
    const result = await db.update(suppliers).set(updates).where(eq(suppliers.id, id)).returning();
    return result[0];
  }

  async deleteSupplier(id: string): Promise<void> {
    await db.update(suppliers).set({ deletedAt: new Date() }).where(eq(suppliers.id, id));
  }

  // Materials, enriched with supplier name + lead time for display
  async getMaterials(): Promise<(Material & { supplierName: string | null; supplierLeadTimeDays: number | null })[]> {
    const rows = await db
      .select({
        material: materials,
        supplierName: suppliers.name,
        supplierLeadTimeDays: suppliers.leadTimeDays,
      })
      .from(materials)
      .leftJoin(suppliers, eq(materials.supplierId, suppliers.id))
      .where(isNull(materials.deletedAt))
      .orderBy(asc(materials.title));
    return rows.map((r) => ({
      ...r.material,
      supplierName: r.supplierName ?? null,
      supplierLeadTimeDays: r.supplierLeadTimeDays ?? null,
    }));
  }

  async getMaterial(id: string): Promise<Material | undefined> {
    const result = await db.select().from(materials).where(eq(materials.id, id));
    return result[0];
  }

  async createMaterial(data: InsertMaterial): Promise<Material> {
    const result = await db.insert(materials).values(data).returning();
    return result[0];
  }

  async updateMaterial(id: string, updates: Partial<InsertMaterial>): Promise<Material | undefined> {
    const result = await db.update(materials).set(updates).where(eq(materials.id, id)).returning();
    return result[0];
  }

  async deleteMaterial(id: string): Promise<void> {
    await db.update(materials).set({ deletedAt: new Date() }).where(eq(materials.id, id));
  }

  // Recipes (processes) enriched with flavor name and their bill-of-materials
  async getProcesses(): Promise<(Process & {
    flavorName: string | null;
    finishedProductName: string | null;
    materials: { id: string; materialId: string; units: string; materialTitle: string; materialUnit: string; materialCost: string }[];
  })[]> {
    const procRows = await db
      .select({ process: processes, flavorName: flavors.name, finishedProductName: products.name })
      .from(processes)
      .leftJoin(flavors, eq(processes.flavorId, flavors.id))
      .leftJoin(products, eq(processes.finishedProductId, products.id))
      .where(isNull(processes.deletedAt))
      .orderBy(asc(processes.title));

    const bomRows = await db
      .select({
        id: processMaterials.id,
        processId: processMaterials.processId,
        materialId: processMaterials.materialId,
        units: processMaterials.units,
        materialTitle: materials.title,
        materialUnit: materials.unit,
        materialCost: materials.cost,
      })
      .from(processMaterials)
      .innerJoin(materials, eq(processMaterials.materialId, materials.id));

    return procRows.map((p) => ({
      ...p.process,
      flavorName: p.flavorName ?? null,
      finishedProductName: p.finishedProductName ?? null,
      materials: bomRows
        .filter((b) => b.processId === p.process.id)
        .map((b) => ({
          id: b.id,
          materialId: b.materialId,
          units: b.units,
          materialTitle: b.materialTitle,
          materialUnit: b.materialUnit,
          materialCost: b.materialCost,
        })),
    }));
  }

  async createProcess(data: InsertProcess): Promise<Process> {
    const result = await db.insert(processes).values(data).returning();
    return result[0];
  }

  async updateProcess(id: string, updates: Partial<InsertProcess>): Promise<Process | undefined> {
    const result = await db.update(processes).set(updates).where(eq(processes.id, id)).returning();
    return result[0];
  }

  async deleteProcess(id: string): Promise<void> {
    await db.update(processes).set({ deletedAt: new Date() }).where(eq(processes.id, id));
  }

  // Bill-of-materials lines for a recipe. Changing these only affects FUTURE
  // productions — stock already drawn by past batches is deliberately untouched.
  async addProcessMaterial(data: InsertProcessMaterial): Promise<ProcessMaterial> {
    const result = await db.insert(processMaterials).values(data).returning();
    return result[0];
  }

  async updateProcessMaterial(id: string, units: string): Promise<ProcessMaterial | undefined> {
    const result = await db
      .update(processMaterials)
      .set({ units })
      .where(eq(processMaterials.id, id))
      .returning();
    return result[0];
  }

  async deleteProcessMaterial(id: string): Promise<void> {
    await db.delete(processMaterials).where(eq(processMaterials.id, id));
  }

  // Productions, enriched with recipe title + flavor, most recent first
  async getProductions(limit = 200): Promise<(Production & { processTitle: string; flavorName: string | null })[]> {
    const rows = await db
      .select({ production: productions, processTitle: processes.title, flavorName: flavors.name })
      .from(productions)
      .innerJoin(processes, eq(productions.processId, processes.id))
      .leftJoin(flavors, eq(processes.flavorId, flavors.id))
      .orderBy(desc(productions.date))
      .limit(limit);
    return rows.map((r) => ({
      ...r.production,
      processTitle: r.processTitle,
      flavorName: r.flavorName ?? null,
    }));
  }

  // Apply (sign = -1 to consume, +1 to restore) a production's material draw to stock, per the recipe BOM
  /**
   * Log a batch. Everything happens in ONE transaction with exact numeric SQL:
   *   1. insert the production row
   *   2. snapshot what it consumes (units × each recipe line) into production_material_usage
   *   3. deduct those exact amounts from material stock in a single statement
   *   4. add finished-goods stock if the recipe is linked to a sellable product
   *
   * The previous version did step 3 as one UPDATE per recipe line with JS float math and
   * no transaction — a failure after the insert left a batch on record with materials only
   * partly deducted, and the deduction itself was rounded in JS before it hit the DB.
   */
  async createProduction(data: InsertProduction): Promise<Production> {
    return await db.transaction(async (tx) => {
      const [created] = await tx.insert(productions).values(data).returning();

      // Snapshot consumption from the recipe AS IT IS NOW — this is the record of truth
      // for reversal, so later recipe edits can't change what this batch "used".
      await tx.execute(sql`
        INSERT INTO production_material_usage (production_id, material_id, units_consumed)
        SELECT ${created.id}, pm.material_id, (${String(created.units)}::numeric * pm.units)
        FROM process_materials pm
        WHERE pm.process_id = ${created.processId} AND pm.units > 0
      `);

      // One statement, exact numeric arithmetic, no per-line round trips.
      await tx.execute(sql`
        UPDATE materials m
        SET stock = m.stock - u.units_consumed
        FROM production_material_usage u
        WHERE u.production_id = ${created.id} AND u.material_id = m.id
      `);

      const [proc] = await tx.select().from(processes).where(eq(processes.id, created.processId));
      if (proc?.finishedProductId) {
        const qty = Math.round(Number(created.units));
        if (qty !== 0) {
          await tx.insert(inventoryAdjustments).values({
            productId: proc.finishedProductId,
            quantity: qty,
            reason: 'production',
            batchMetadata: JSON.stringify({ productionId: created.id, processTitle: proc.title }),
            notes: `Production logged: ${proc.title}`,
          });
          await tx.update(products)
            .set({ stockQuantity: sql`${products.stockQuantity} + ${qty}`, inStock: sql`(${products.stockQuantity} + ${qty}) > 0` })
            .where(eq(products.id, proc.finishedProductId));
        }
      }
      return created;
    });
  }

  /**
   * Delete a batch, restoring EXACTLY what it consumed from its usage snapshot — not from
   * the recipe as it stands today. Batches logged before the snapshot table existed have
   * no usage rows; for those we fall back to the current recipe (the old behaviour) and
   * say so in the log, because it is the best information available.
   */
  async deleteProduction(id: string): Promise<void> {
    await db.transaction(async (tx) => {
      const [prod] = await tx.select().from(productions).where(eq(productions.id, id));
      if (!prod) return;

      const usage = await tx.select().from(productionMaterialUsage).where(eq(productionMaterialUsage.productionId, id));
      if (usage.length > 0) {
        await tx.execute(sql`
          UPDATE materials m
          SET stock = m.stock + u.units_consumed
          FROM production_material_usage u
          WHERE u.production_id = ${id} AND u.material_id = m.id
        `);
      } else {
        console.warn(`[INVENTORY] Production ${id} predates usage snapshots — restoring from the CURRENT recipe (may differ from what was consumed if the recipe changed).`);
        await tx.execute(sql`
          UPDATE materials m
          SET stock = m.stock + (${String(prod.units)}::numeric * pm.units)
          FROM process_materials pm
          WHERE pm.process_id = ${prod.processId} AND pm.material_id = m.id AND pm.units > 0
        `);
      }

      const [proc] = await tx.select().from(processes).where(eq(processes.id, prod.processId));
      if (proc?.finishedProductId) {
        const qty = Math.round(Number(prod.units));
        if (qty !== 0) {
          await tx.insert(inventoryAdjustments).values({
            productId: proc.finishedProductId,
            quantity: -qty,
            reason: 'correction',
            batchMetadata: JSON.stringify({ reversedProductionId: prod.id }),
            notes: `Reversal of deleted production: ${proc.title}`,
          });
          await tx.update(products)
            .set({ stockQuantity: sql`${products.stockQuantity} - ${qty}`, inStock: sql`(${products.stockQuantity} - ${qty}) > 0` })
            .where(eq(products.id, proc.finishedProductId));
        }
      }
      // usage rows cascade-delete with the production
      await tx.delete(productions).where(eq(productions.id, id));
    });
  }

  // Purchase orders (replenishment). Marking a line delivered adds its units to material stock.
  async getMaterialOrders(): Promise<(MaterialOrder & {
    supplierName: string | null;
    lines: (OrderMaterial & { materialTitle: string; materialUnit: string })[];
  })[]> {
    const orderRows = await db
      .select({ order: materialOrders, supplierName: suppliers.name })
      .from(materialOrders)
      .leftJoin(suppliers, eq(materialOrders.supplierId, suppliers.id))
      .orderBy(desc(materialOrders.dateOrdered));

    const lineRows = await db
      .select({ line: orderMaterials, materialTitle: materials.title, materialUnit: materials.unit })
      .from(orderMaterials)
      .innerJoin(materials, eq(orderMaterials.materialId, materials.id));

    return orderRows.map((o) => ({
      ...o.order,
      supplierName: o.supplierName ?? null,
      lines: lineRows
        .filter((l) => l.line.orderId === o.order.id)
        .map((l) => ({ ...l.line, materialTitle: l.materialTitle, materialUnit: l.materialUnit })),
    }));
  }

  async createMaterialOrder(
    order: InsertMaterialOrder,
    lines: { materialId: string; units: string }[]
  ): Promise<MaterialOrder> {
    const result = await db.insert(materialOrders).values(order).returning();
    const created = result[0];
    if (lines.length > 0) {
      await db.insert(orderMaterials).values(
        lines.map((l) => ({
          orderId: created.id,
          materialId: l.materialId,
          units: l.units,
          delivered: false,
        }))
      );
    }
    return created;
  }

  /**
   * Toggle a PO line's delivered flag and move stock accordingly (+units in, -units if
   * reversed). The flag flip is a compare-and-set: it only succeeds if the line is still
   * in the state the caller saw, and stock moves only when that flip actually happened.
   * The old read-then-update let two people tapping "received" at once add the units
   * twice. All inside one transaction so the flag and the stock can never disagree.
   */
  async setOrderMaterialDelivered(lineId: string, delivered: boolean): Promise<void> {
    await db.transaction(async (tx) => {
      const [line] = await tx.select().from(orderMaterials).where(eq(orderMaterials.id, lineId));
      if (!line) return;

      // Atomic flip: affects 0 rows if someone else already changed it.
      const flipped = await tx
        .update(orderMaterials)
        .set({ delivered })
        .where(and(eq(orderMaterials.id, lineId), eq(orderMaterials.delivered, !delivered)))
        .returning({ id: orderMaterials.id, units: orderMaterials.units, materialId: orderMaterials.materialId });

      if (flipped.length === 1) {
        const signedSql = delivered
          ? sql`${materials.stock} + ${String(flipped[0].units)}::numeric`
          : sql`${materials.stock} - ${String(flipped[0].units)}::numeric`;
        await tx.update(materials).set({ stock: signedSql }).where(eq(materials.id, flipped[0].materialId));
      }

      // Reflect overall delivery on the order: fully delivered => stamp dateDelivered, else clear it
      const siblings = await tx.select().from(orderMaterials).where(eq(orderMaterials.orderId, line.orderId));
      const allDelivered = siblings.length > 0 && siblings.every((s) => s.delivered);
      await tx
        .update(materialOrders)
        .set({ dateDelivered: allDelivered ? new Date() : null })
        .where(eq(materialOrders.id, line.orderId));
    });
  }

  async deleteMaterialOrder(id: string): Promise<void> {
    // Reversing received stock and deleting the order must land together: a failure
    // between them used to leave either phantom stock or a vanished order with stock
    // still counted.
    await db.transaction(async (tx) => {
      await tx.execute(sql`
        UPDATE materials m
        SET stock = m.stock - om.units
        FROM order_materials om
        WHERE om.order_id = ${id} AND om.delivered = true AND om.material_id = m.id
      `);
      await tx.delete(orderMaterials).where(eq(orderMaterials.orderId, id));
      await tx.delete(materialOrders).where(eq(materialOrders.id, id));
    });
  }

  /**
   * Record a physical count (or a correction) for a material. The shelf number is SET to
   * `counted`, and the ledger records the delta against what the system believed — which
   * is the number that matters for finding drift. Computed inside the transaction from the
   * live value, so a batch logged while the count was being typed is not lost.
   *
   * This is the ONLY sanctioned way to change stock by hand; the generic material PATCH
   * refuses the stock field. Overwriting stock silently was how drift became invisible.
   */
  async recordMaterialCount(materialId: string, counted: number, reason: 'count' | 'correction', note: string | null, userId: string | null) {
    return await db.transaction(async (tx) => {
      const [before] = await tx.select({ stock: materials.stock }).from(materials).where(eq(materials.id, materialId)).for('update');
      if (!before) return null;
      const stockBefore = Number(before.stock);
      const delta = counted - stockBefore;
      await tx.update(materials).set({ stock: counted.toFixed(4) }).where(eq(materials.id, materialId));
      const [adj] = await tx.insert(materialStockAdjustments).values({
        materialId,
        delta: delta.toFixed(4),
        stockBefore: stockBefore.toFixed(4),
        stockAfter: counted.toFixed(4),
        reason,
        note,
        userId,
      }).returning();
      return adj;
    });
  }

  async getMaterialAdjustments(materialId: string, limit = 50) {
    return await db
      .select({
        id: materialStockAdjustments.id,
        delta: materialStockAdjustments.delta,
        stockBefore: materialStockAdjustments.stockBefore,
        stockAfter: materialStockAdjustments.stockAfter,
        reason: materialStockAdjustments.reason,
        note: materialStockAdjustments.note,
        createdAt: materialStockAdjustments.createdAt,
        userName: users.username,
      })
      .from(materialStockAdjustments)
      .leftJoin(users, eq(users.id, materialStockAdjustments.userId))
      .where(eq(materialStockAdjustments.materialId, materialId))
      .orderBy(desc(materialStockAdjustments.createdAt))
      .limit(limit);
  }

  // ===== Analytics: smart reorder + dashboard =====

  // Estimate each material's consumption rate from production history, then flag
  // what will run out before a replenishment order could arrive (usage × lead time).
  async getReorderReport(windowDays = 90): Promise<{
    id: string; title: string; unit: string; stock: number; supplierName: string | null;
    dailyUsage: number; daysOfCover: number | null; leadTimeDays: number;
    reorderPoint: number; suggestedQty: number; status: 'order-now' | 'watch' | 'ok';
  }[]> {
    const mats = await this.getMaterials();
    const bom = await db.select().from(processMaterials);

    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - windowDays);
    const prods = await db.select().from(productions).where(gte(productions.date, cutoff));

    // Total output units per process in the window
    const producedByProcess = new Map<string, number>();
    for (const p of prods) {
      producedByProcess.set(p.processId, (producedByProcess.get(p.processId) ?? 0) + Number(p.units));
    }
    // Material consumption = Σ (process output × per-unit BOM amount)
    const consumption = new Map<string, number>();
    for (const b of bom) {
      const produced = producedByProcess.get(b.processId) ?? 0;
      if (produced > 0) {
        consumption.set(b.materialId, (consumption.get(b.materialId) ?? 0) + produced * Number(b.units));
      }
    }

    return mats.map((m) => {
      const stock = Number(m.stock);
      const dailyUsage = (consumption.get(m.id) ?? 0) / windowDays;
      const leadTimeDays = m.supplierLeadTimeDays ?? 14;
      const daysOfCover = dailyUsage > 0 ? stock / dailyUsage : null;
      const reorderPoint = dailyUsage * leadTimeDays * 1.2; // 20% safety buffer
      const orderSize = Number(m.orderSize);
      const suggestedQty = orderSize > 0 ? orderSize : Math.ceil(dailyUsage * 30);
      let status: 'order-now' | 'watch' | 'ok';
      if (dailyUsage <= 0) status = 'ok';
      else if (stock <= reorderPoint) status = 'order-now';
      else if (stock <= reorderPoint * 1.5) status = 'watch';
      else status = 'ok';
      return {
        id: m.id, title: m.title, unit: m.unit, stock, supplierName: m.supplierName,
        dailyUsage, daysOfCover, leadTimeDays, reorderPoint, suggestedQty, status,
      };
    });
  }

  // Cost of goods PRODUCED over a window: material cost actually consumed by batches,
  // derived from each recipe's BOM × units produced × material unit cost.
  //
  // NOTE: this is reporting only — it deliberately does NOT post transactions into the
  // accounting ledger. Supplier payments already land there (via Plaid/manual import),
  // so booking production cost as a second expense would double-count. Use this to see
  // true production cost and margin alongside revenue.
  async getCogsReport(windowDays = 90): Promise<{
    windowDays: number;
    totalMaterialCost: number;
    byRecipe: { processId: string; title: string; flavorName: string | null; units: number; materialCost: number }[];
  }> {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - windowDays);

    const prods = await db
      .select({
        processId: productions.processId,
        units: productions.units,
        title: processes.title,
        flavorName: flavors.name,
      })
      .from(productions)
      .innerJoin(processes, eq(productions.processId, processes.id))
      .leftJoin(flavors, eq(processes.flavorId, flavors.id))
      .where(gte(productions.date, cutoff));

    // Per-unit material cost for each recipe
    const bom = await db
      .select({
        processId: processMaterials.processId,
        units: processMaterials.units,
        cost: materials.cost,
      })
      .from(processMaterials)
      .innerJoin(materials, eq(processMaterials.materialId, materials.id));

    const costPerUnit = new Map<string, number>();
    for (const b of bom) {
      costPerUnit.set(
        b.processId,
        (costPerUnit.get(b.processId) ?? 0) + Number(b.units) * Number(b.cost)
      );
    }

    const agg = new Map<string, { title: string; flavorName: string | null; units: number; materialCost: number }>();
    for (const p of prods) {
      const cpu = costPerUnit.get(p.processId) ?? 0;
      const entry = agg.get(p.processId) ?? {
        title: p.title, flavorName: p.flavorName ?? null, units: 0, materialCost: 0,
      };
      entry.units += Number(p.units);
      entry.materialCost += Number(p.units) * cpu;
      agg.set(p.processId, entry);
    }

    const byRecipe = Array.from(agg.entries())
      .map(([processId, v]) => ({
        processId,
        title: v.title,
        flavorName: v.flavorName,
        units: Math.round(v.units * 100) / 100,
        materialCost: Math.round(v.materialCost * 100) / 100,
      }))
      .sort((a, b) => b.materialCost - a.materialCost);

    return {
      windowDays,
      totalMaterialCost: Math.round(byRecipe.reduce((s, r) => s + r.materialCost, 0) * 100) / 100,
      byRecipe,
    };
  }

  /**
   * Production-limit report: for every recipe, the maximum output producible from raw
   * material stock on hand, and which ingredient runs out first.
   *
   * Mirrors applyProductionStock's math exactly — that method deducts
   * `produced units x bomLine.units` per material, so the ceiling for one line is
   * stock / perUnit and the recipe's ceiling is the minimum across its lines. Floored to
   * whole output units (you can't sell 0.7 of a case, and a conservative number is the
   * useful one on the brewery floor).
   */
  async getInventoryLimitReport(): Promise<Array<{
    processId: string; title: string; unit: string;
    maxUnits: number | null;
    limiting: { materialId: string; title: string; unit: string; stock: number; perUnit: number } | null;
    lines: Array<{ materialId: string; title: string; unit: string; stock: number; perUnit: number; maxFromThis: number }>;
  }>> {
    const rows = await db
      .select({
        processId: processes.id,
        processTitle: processes.title,
        processUnit: processes.unit,
        materialId: materials.id,
        materialTitle: materials.title,
        materialUnit: materials.unit,
        stock: materials.stock,
        perUnit: processMaterials.units,
      })
      .from(processes)
      .leftJoin(processMaterials, eq(processMaterials.processId, processes.id))
      .leftJoin(materials, eq(materials.id, processMaterials.materialId))
      .where(isNull(processes.deletedAt));

    const byProcess = new Map<string, typeof rows>();
    for (const r of rows) {
      const arr = byProcess.get(r.processId) ?? [];
      arr.push(r);
      byProcess.set(r.processId, arr);
    }

    const report = [];
    for (const [processId, group] of Array.from(byProcess.entries())) {
      const lines = group
        .filter(g => g.materialId && Number(g.perUnit) > 0)
        .map(g => {
          const stock = Math.max(0, Number(g.stock)); // negative drift can't produce anything
          const perUnit = Number(g.perUnit);
          return {
            materialId: g.materialId!,
            title: g.materialTitle!,
            unit: g.materialUnit!,
            stock,
            perUnit,
            maxFromThis: Math.floor(stock / perUnit),
          };
        })
        .sort((a, b) => a.maxFromThis - b.maxFromThis);

      report.push({
        processId,
        title: group[0].processTitle,
        unit: group[0].processUnit,
        // null = recipe has no usable BOM lines, so there is nothing to compute — that is
        // "recipe not set up", which is different from a hard 0 caused by an empty shelf.
        maxUnits: lines.length ? lines[0].maxFromThis : null,
        limiting: lines.length
          ? { materialId: lines[0].materialId, title: lines[0].title, unit: lines[0].unit, stock: lines[0].stock, perUnit: lines[0].perUnit }
          : null,
        lines,
      });
    }

    // Scarcest first — the recipes about to hit a wall are the ones staff need to see.
    return report.sort((a, b) => (a.maxUnits ?? Infinity) - (b.maxUnits ?? Infinity));
  }

  async getInventoryDashboard(): Promise<{
    inventoryValue: number; totalMaterials: number; batchesLast30: number; casesLast30: number;
    flavorMix: { flavor: string; cases: number }[];
    monthly: { month: string; cases: number }[];
    negativeStock: { id: string; title: string; unit: string; stock: number }[];
  }> {
    const mats = await this.getMaterials();
    const inventoryValue = mats.reduce((s, m) => s + Number(m.stock) * Number(m.cost), 0);
    // Negative stock is almost always a delivery that was never marked received, or a
    // batch logged against the wrong recipe — either way it means the number is wrong and
    // someone should look. Silently clamping it hid the signal.
    const negativeStock = mats
      .filter(m => Number(m.stock) < 0)
      .map(m => ({ id: m.id, title: m.title, unit: m.unit, stock: Number(m.stock) }))
      .sort((a, b) => a.stock - b.stock);

    const rows = await db
      .select({
        flavorName: flavors.name, title: processes.title, processUnit: processes.unit,
        units: productions.units, date: productions.date,
      })
      .from(productions)
      .innerJoin(processes, eq(productions.processId, processes.id))
      .leftJoin(flavors, eq(processes.flavorId, flavors.id));

    const now = new Date();
    const cutoff30 = new Date();
    cutoff30.setDate(cutoff30.getDate() - 30);

    // 12-month buckets (cases = "Bottle:" processes)
    const monthly: { key: string; month: string; cases: number }[] = [];
    const monthIdx = new Map<string, number>();
    for (let i = 11; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const key = `${d.getFullYear()}-${d.getMonth()}`;
      monthIdx.set(key, monthly.length);
      monthly.push({ key, month: d.toLocaleString('en-US', { month: 'short' }), cases: 0 });
    }

    const flavorMixMap = new Map<string, number>();
    let batchesLast30 = 0;
    let casesLast30 = 0;

    for (const r of rows) {
      // "Cases" = any recipe whose OUTPUT unit is a case — bottling today, canning next
      // month. Keying on the "Bottle:" title prefix made can batches invisible here.
      const isBottle = String(r.processUnit).toLowerCase().startsWith('case') || r.title.startsWith('Bottle:') || r.title.startsWith('Can:');
      const d = new Date(r.date);
      const units = Number(r.units);
      if (d >= cutoff30) {
        batchesLast30 += 1;
        if (isBottle) casesLast30 += units;
      }
      if (!isBottle) continue;
      flavorMixMap.set(r.flavorName ?? 'Unknown', (flavorMixMap.get(r.flavorName ?? 'Unknown') ?? 0) + units);
      const key = `${d.getFullYear()}-${d.getMonth()}`;
      const mi = monthIdx.get(key);
      if (mi !== undefined) monthly[mi].cases += units;
    }

    const flavorMix = Array.from(flavorMixMap.entries())
      .map(([flavor, cases]) => ({ flavor, cases: Math.round(cases) }))
      .sort((a, b) => b.cases - a.cases);

    return {
      inventoryValue,
      totalMaterials: mats.length,
      batchesLast30,
      casesLast30: Math.round(casesLast30),
      negativeStock,
      flavorMix,
      monthly: monthly.map((m) => ({ month: m.month, cases: Math.round(m.cases) })),
    };
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
    return await db.select().from(wholesaleCustomers).orderBy(wholesaleCustomers.businessName);
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
    // Check both the primary email field and the emails array (case-insensitive)
    const result = await db.select().from(wholesaleCustomers).where(
      or(
        sql`LOWER(${wholesaleCustomers.email}) = LOWER(${email})`,
        sql`LOWER(${email}) = ANY(SELECT LOWER(e) FROM unnest(${wholesaleCustomers.emails}) e)`
      )
    );
    return result[0];
  }

  async getWholesaleCustomerByUserId(userId: string): Promise<WholesaleCustomer | undefined> {
    // First check if user has wholesaleCustomerId set (new approach)
    const user = await db.select().from(users).where(eq(users.id, userId));
    if (user[0]?.wholesaleCustomerId) {
      const result = await db.select().from(wholesaleCustomers).where(eq(wholesaleCustomers.id, user[0].wholesaleCustomerId));
      return result[0];
    }
    // Fall back to old approach for backward compatibility
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

  async deleteWholesaleCustomer(id: string): Promise<void> {
    // Check if customer has any orders - if so, don't allow deletion
    const orders = await db.select({ id: wholesaleOrders.id })
      .from(wholesaleOrders)
      .where(eq(wholesaleOrders.customerId, id))
      .limit(1);
    
    if (orders.length > 0) {
      throw new Error("Cannot delete customer with existing orders. Please archive or reassign their orders first.");
    }
    
    // Delete associated pricing records
    await db.delete(wholesalePricing).where(eq(wholesalePricing.customerId, id));
    // Delete all associated locations
    await db.delete(wholesaleLocations).where(eq(wholesaleLocations.customerId, id));
    // Then delete the customer
    await db.delete(wholesaleCustomers).where(eq(wholesaleCustomers.id, id));
  }

  // Normalize phone numbers to format: (XXX) XXX-XXXX or just digits if not 10 digits
  private normalizePhone(phone: string | undefined | null): string {
    if (!phone) return '';
    // Remove all non-digit characters
    const digits = phone.replace(/\D/g, '');
    // Handle 11-digit numbers starting with 1 (US country code)
    const normalized = digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits;
    // Format as (XXX) XXX-XXXX if exactly 10 digits
    if (normalized.length === 10) {
      return `(${normalized.slice(0, 3)}) ${normalized.slice(3, 6)}-${normalized.slice(6)}`;
    }
    // Return cleaned digits for non-standard lengths
    return normalized;
  }

  async importWholesaleCustomers(csvData: any[]): Promise<{ imported: number; failed: number; errors: string[]; locationsAdded: number; usersCreated: number }> {
    const results = {
      imported: 0,
      failed: 0,
      errors: [] as string[],
      locationsAdded: 0,
      usersCreated: 0,
    };

    // Group rows by businessName to support multiple locations/emails per customer
    const customerGroups = new Map<string, any[]>();
    for (const row of csvData) {
      const businessName = row.businessName?.trim();
      if (!businessName) {
        results.errors.push(`Row skipped: Missing business name`);
        results.failed++;
        continue;
      }
      
      if (!customerGroups.has(businessName)) {
        customerGroups.set(businessName, []);
      }
      customerGroups.get(businessName)!.push(row);
    }

    // Process each customer group
    for (const [businessName, rows] of customerGroups) {
      try {
        // First row contains the primary customer data
        const primaryRow = rows[0];
        
        // Collect all unique emails from all rows (preserve original casing, dedupe case-insensitively)
        const emailMap = new Map<string, string>(); // lowercase -> original
        for (const row of rows) {
          if (row.email?.trim()) {
            const email = row.email.trim();
            emailMap.set(email.toLowerCase(), email);
          }
          if (row.additionalEmails?.trim()) {
            const additionalEmailsList = row.additionalEmails
              .split('|')
              .map((e: string) => e.trim())
              .filter((e: string) => e.length > 0);
            additionalEmailsList.forEach((e: string) => emailMap.set(e.toLowerCase(), e));
          }
        }

        const emails = Array.from(emailMap.values());
        const primaryEmail = primaryRow.email?.trim() || emails[0];
        
        if (!primaryEmail) {
          results.errors.push(`${businessName}: No email address provided`);
          results.failed++;
          continue;
        }

        // Check if customer already exists by any email (case-insensitive)
        const existing = await this.getWholesaleCustomerByAnyEmail(primaryEmail);
        if (existing) {
          results.errors.push(`Customer with email ${primaryEmail} already exists (${businessName})`);
          results.failed++;
          continue;
        }

        // Create customer using primary row data
        const customerData: InsertWholesaleCustomer = {
          businessName: businessName,
          contactName: primaryRow.contactName?.trim() || '',
          email: primaryEmail,
          emails: emails,
          phone: this.normalizePhone(primaryRow.phone),
          // Opt-OUT, not opt-in: ACH is how wholesale pays, so an imported customer can pay
          // unless the CSV explicitly says "false". Previously a blank column silently
          // produced an account that could not pay its invoices online.
          allowOnlinePayment: !(
            primaryRow.allowOnlinePayment === 'false' || primaryRow.allowOnlinePayment === false
          ),
        };

        const newCustomer = await this.createWholesaleCustomer(customerData);

        // Create a user account for each unique email
        for (const email of emails) {
          try {
            // Check if user with this email already exists
            const existingUser = await db.select().from(users).where(eq(users.email, email));
            if (existingUser.length > 0) {
              // User exists - only link if not already linked to any customer
              if (!existingUser[0].wholesaleCustomerId) {
                await db.update(users)
                  .set({ 
                    wholesaleCustomerId: newCustomer.id,
                    role: 'wholesale_customer'
                  })
                  .where(eq(users.id, existingUser[0].id));
                results.usersCreated++;
              } else if (existingUser[0].wholesaleCustomerId !== newCustomer.id) {
                // User belongs to a different customer - skip with warning
                results.errors.push(`${businessName}: Email ${email} already belongs to another wholesale account`);
              }
              // If already linked to this customer, do nothing
            } else {
              // Create new user with UUID-based username to avoid collisions
              const uuid = crypto.randomUUID().slice(0, 8);
              const username = email.split('@')[0].replace(/[^a-zA-Z0-9]/g, '_') + '_' + uuid;
              await db.insert(users).values({
                username: username,
                email: email,
                role: 'wholesale_customer',
                wholesaleCustomerId: newCustomer.id,
              });
              results.usersCreated++;
            }
          } catch (userError: any) {
            results.errors.push(`${businessName}: Failed to create user for ${email}: ${userError.message}`);
          }
        }

        // Create locations from all rows that have location data
        // Also create a location from the primary row's address if provided
        for (const row of rows) {
          const locationFields = {
            locationName: row.locationName?.trim(),
            locationAddress: row.locationAddress?.trim(),
            locationCity: row.locationCity?.trim(),
            locationState: row.locationState?.trim(),
            locationZipCode: row.locationZipCode?.trim(),
          };
          
          const filledFields = Object.entries(locationFields).filter(([_, v]) => v);
          const hasLocationData = filledFields.length === 5;
          const hasPartialLocationData = filledFields.length > 0 && filledFields.length < 5;
          
          // Also support legacy 'address' field - create a "Main Location" from it
          const hasLegacyAddress = !hasLocationData && row === primaryRow && row.address?.trim();
          
          // Warn about partial location data
          if (hasPartialLocationData && !hasLegacyAddress) {
            const missingFields = Object.entries(locationFields)
              .filter(([_, v]) => !v)
              .map(([k]) => k);
            const locationIdentifier = locationFields.locationName || locationFields.locationAddress || 'row';
            results.errors.push(`${businessName} (${locationIdentifier}): Missing location fields: ${missingFields.join(', ')}`);
          }
          
          if (hasLocationData) {
            // Fall back to contactName/phone if locationContactName/Phone not provided
            const locContactName = row.locationContactName?.trim() || row.contactName?.trim() || null;
            const locContactPhone = row.locationContactPhone?.trim() || row.phone?.trim() || null;
            
            const locationData: InsertWholesaleLocation = {
              customerId: newCustomer.id,
              locationName: row.locationName.trim(),
              address: row.locationAddress.trim(),
              city: row.locationCity.trim(),
              state: row.locationState.trim().toUpperCase(),
              zipCode: row.locationZipCode.trim(),
              contactName: locContactName,
              contactPhone: this.normalizePhone(locContactPhone) || null,
            };

            await this.createWholesaleLocation(locationData);
            results.locationsAdded++;
          } else if (hasLegacyAddress) {
            // Create a "Main Location" from legacy address field
            // Store the full address as-is - staff can manually update structured fields later
            const fullAddress = row.address.trim();
            
            const locationData: InsertWholesaleLocation = {
              customerId: newCustomer.id,
              locationName: 'Main Location',
              address: fullAddress,
              city: '',
              state: '',
              zipCode: '',
              contactName: primaryRow.contactName?.trim() || null,
              contactPhone: this.normalizePhone(primaryRow.phone) || null,
            };

            await this.createWholesaleLocation(locationData);
            results.locationsAdded++;
          }
        }

        results.imported++;
      } catch (error: any) {
        results.errors.push(`${businessName}: ${error.message}`);
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

  async getWholesaleOrders(options?: { limit?: number; offset?: number }): Promise<{ orders: Array<WholesaleOrder & { locationName: string | null }>; total: number }> {
    const whereClause = isNull(wholesaleOrders.deletedAt);

    const [countResult] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(wholesaleOrders)
      .where(whereClause);

    // Location rides along so lists can tell "Evergreens — 2nd & Pike" from
    // "Evergreens — Capitol Hill" without a per-order lookup.
    let query = db
      .select({ order: wholesaleOrders, locationName: wholesaleLocations.locationName })
      .from(wholesaleOrders)
      .leftJoin(wholesaleLocations, eq(wholesaleOrders.locationId, wholesaleLocations.id))
      .where(whereClause)
      .orderBy(desc(wholesaleOrders.orderDate))
      .$dynamic();

    if (options?.limit !== undefined) {
      query = query.limit(options.limit);
    }
    if (options?.offset !== undefined) {
      query = query.offset(options.offset);
    }

    const rows = await query;
    return { orders: rows.map(r => ({ ...r.order, locationName: r.locationName })), total: countResult.count };
  }

  async getWholesaleOrder(id: string): Promise<WholesaleOrder | undefined> {
    const result = await db.select().from(wholesaleOrders).where(and(eq(wholesaleOrders.id, id), isNull(wholesaleOrders.deletedAt)));
    return result[0];
  }

  async createWholesaleOrder(order: InsertWholesaleOrder): Promise<WholesaleOrder> {
    const result = await db.insert(wholesaleOrders).values(order).returning();
    return result[0];
  }

  async updateWholesaleOrderStatus(id: string, status: string): Promise<WholesaleOrder> {
    const result = await db
      .update(wholesaleOrders)
      .set({ status, updatedAt: new Date() })
      .where(eq(wholesaleOrders.id, id))
      .returning();
    return result[0];
  }

  async updateWholesaleOrderDeliveryDate(id: string, deliveryDate: Date | null): Promise<WholesaleOrder | undefined> {
    const result = await db
      .update(wholesaleOrders)
      .set({ deliveryDate, updatedAt: new Date() })
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
          sql`${wholesaleOrders.deliveryDate} <= ${endOfDay}`,
          // Pickups are collected at the brewery — they are not deliveries and must never
          // appear on the delivery report or a driver's route.
          sql`${wholesaleOrders.fulfillmentMethod} <> 'pickup'`,
          isNull(wholesaleOrders.deletedAt)
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
          sql`${wholesaleOrders.deliveryDate} < ${endDate}`,
          // Pickups are collected at the brewery — not deliveries, so they stay off the
          // delivery report and out of route planning.
          sql`${wholesaleOrders.fulfillmentMethod} <> 'pickup'`,
          isNull(wholesaleOrders.deletedAt)
        )
      )
      .orderBy(wholesaleOrders.deliveryDate);
    return result;
  }

  async getWholesaleOrdersByCustomerId(customerId: string): Promise<Array<WholesaleOrder & { items: Array<WholesaleOrderItem & { productName: string | null; unitTypeName: string | null; flavorName: string | null }> }>> {
    const result = await db
      .select({
        order: wholesaleOrders,
        location: wholesaleLocations,
      })
      .from(wholesaleOrders)
      .leftJoin(wholesaleLocations, eq(wholesaleOrders.locationId, wholesaleLocations.id))
      .where(and(eq(wholesaleOrders.customerId, customerId), isNull(wholesaleOrders.deletedAt)))
      .orderBy(desc(wholesaleOrders.orderDate));

    const orderIds = result.map(row => row.order.id);

    // Batch-fetch all items for all orders in a single query (avoids N+1)
    const allItems = orderIds.length > 0
      ? await db
          .select({
            id: wholesaleOrderItems.id,
            orderId: wholesaleOrderItems.orderId,
            productId: wholesaleOrderItems.productId,
            // Orders are placed as unit type + flavor; productId is the legacy nullable
            // column. Without these two the customer can't be shown what they actually
            // bought, and "Reorder" has nothing to rebuild a cart from.
            unitTypeId: wholesaleOrderItems.unitTypeId,
            flavorId: wholesaleOrderItems.flavorId,
            unitTypeName: wholesaleUnitTypes.name,
            flavorName: flavors.name,
            quantity: wholesaleOrderItems.quantity,
            unitPrice: wholesaleOrderItems.unitPrice,
            productName: products.name,
          })
          .from(wholesaleOrderItems)
          .leftJoin(products, eq(wholesaleOrderItems.productId, products.id))
          .leftJoin(wholesaleUnitTypes, eq(wholesaleOrderItems.unitTypeId, wholesaleUnitTypes.id))
          .leftJoin(flavors, eq(wholesaleOrderItems.flavorId, flavors.id))
          .where(inArray(wholesaleOrderItems.orderId, orderIds))
      : [];

    // Group items by orderId
    const itemsByOrderId = new Map<string, typeof allItems>();
    for (const item of allItems) {
      const existing = itemsByOrderId.get(item.orderId) || [];
      existing.push(item);
      itemsByOrderId.set(item.orderId, existing);
    }

    const ordersWithItems = result.map((row) => {
      const order = row.order;
      const location = row.location;
      const items = itemsByOrderId.get(order.id) || [];

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
    });

    return ordersWithItems;
  }

  /**
   * Orders scheduled within [start, end) for the weekly brewery board, both channels.
   * Retail buckets by pickupDate, wholesale by deliveryDate — the field each is actually
   * scheduled on. Items carry human names so the board can show and total them. Cancelled
   * retail orders are excluded (nothing to prepare); soft-deleted rows are always excluded.
   */
  async getWeeklyBoardOrders(start: Date, end: Date, opts?: { retailBacklog?: boolean }): Promise<{
    retail: Array<{ id: string; orderNumber: string; customerName: string; pickupDate: Date | null; orderDate: Date; status: string; isSubscriptionOrder: boolean; totalAmount: string; notes: string | null; items: Array<{ flavorName: string; unitDescription: string; quantity: number; notes: string | null }> }>;
    wholesale: Array<{ id: string; invoiceNumber: string; businessName: string; city: string | null; locationName: string | null; fulfillmentMethod: string; deliveryDate: Date | null; orderDate: Date; status: string; totalAmount: string; notes: string | null; items: Array<{ unitTypeName: string; flavorName: string; quantity: number }> }>;
  }> {
    // --- Retail (by pickupDate) ---
    // On the ACTIVE week (retailBacklog), open orders never fall off the board: anything
    // not yet fulfilled rides along even if its pickup date slipped past a prior week or
    // was never set (owner decision 2026-08-30). Historical weeks stay date-bucketed.
    const inWindow = and(gte(retailOrders.pickupDate, start), lt(retailOrders.pickupDate, end));
    const retailRows = await db
      .select()
      .from(retailOrders)
      .where(and(
        isNull(retailOrders.deletedAt),
        sql`${retailOrders.status} <> 'cancelled'`,
        opts?.retailBacklog
          ? or(
              inWindow,
              and(
                sql`${retailOrders.status} <> 'fulfilled'`,
                or(isNull(retailOrders.pickupDate), lt(retailOrders.pickupDate, end)),
              ),
              // A date-less order that was picked up stays on the week it was
              // fulfilled in — otherwise it vanished from the board entirely the
              // moment someone tapped it done (owner, 2026-09-01).
              and(
                eq(retailOrders.status, 'fulfilled'),
                isNull(retailOrders.pickupDate),
                gte(retailOrders.fulfilledAt, start),
                lt(retailOrders.fulfilledAt, end),
              ),
            )
          : inWindow,
      ))
      .orderBy(asc(retailOrders.pickupDate));

    const retailIds = retailRows.map(o => o.id);
    const retailItems = retailIds.length > 0
      ? await db
          .select({
            orderId: retailOrderItemsV2.orderId,
            quantity: retailOrderItemsV2.quantity,
            flavorName: flavors.name,
            unitDescription: retailProducts.unitDescription,
            notes: retailOrderItemsV2.notes,
          })
          .from(retailOrderItemsV2)
          .innerJoin(retailProducts, eq(retailProducts.id, retailOrderItemsV2.retailProductId))
          .leftJoin(flavors, eq(flavors.id, sql`COALESCE(${retailOrderItemsV2.selectedFlavorId}, ${retailProducts.flavorId})`))
          .where(inArray(retailOrderItemsV2.orderId, retailIds))
      : [];

    const retailItemsByOrder = new Map<string, Array<{ flavorName: string; unitDescription: string; quantity: number; notes: string | null }>>();
    for (const it of retailItems) {
      const arr = retailItemsByOrder.get(it.orderId) || [];
      arr.push({ flavorName: it.flavorName || 'Unknown', unitDescription: it.unitDescription || '', quantity: it.quantity, notes: it.notes ?? null });
      retailItemsByOrder.set(it.orderId, arr);
    }

    const retail = retailRows.map(o => ({
      id: o.id,
      orderNumber: o.orderNumber,
      customerName: o.customerName,
      pickupDate: o.pickupDate,
      orderDate: o.orderDate,
      status: o.status,
      isSubscriptionOrder: o.isSubscriptionOrder,
      totalAmount: o.totalAmount,
      notes: o.notes,
      items: retailItemsByOrder.get(o.id) || [],
    }));

    // --- Wholesale (by deliveryDate) ---
    const wholesaleRows = await db
      .select({ order: wholesaleOrders, businessName: wholesaleCustomers.businessName, city: wholesaleLocations.city, locationName: wholesaleLocations.locationName })
      .from(wholesaleOrders)
      .leftJoin(wholesaleCustomers, eq(wholesaleOrders.customerId, wholesaleCustomers.id))
      .leftJoin(wholesaleLocations, eq(wholesaleOrders.locationId, wholesaleLocations.id))
      .where(and(
        isNull(wholesaleOrders.deletedAt),
        // On the ACTIVE week, open wholesale orders with NO delivery date set ride
        // along too (owner, 2026-09-01) — an unscheduled order still needs packing.
        opts?.retailBacklog
          ? or(
              and(gte(wholesaleOrders.deliveryDate, start), lt(wholesaleOrders.deliveryDate, end)),
              and(
                isNull(wholesaleOrders.deliveryDate),
                sql`${wholesaleOrders.status} NOT IN ('delivered', 'fulfilled', 'cancelled')`,
              ),
              // Date-less orders that were delivered stay on the week they were
              // completed in (updatedAt approximates the delivery tap).
              and(
                isNull(wholesaleOrders.deliveryDate),
                sql`${wholesaleOrders.status} IN ('delivered', 'fulfilled')`,
                gte(wholesaleOrders.updatedAt, start),
                lt(wholesaleOrders.updatedAt, end),
              ),
            )
          : and(gte(wholesaleOrders.deliveryDate, start), lt(wholesaleOrders.deliveryDate, end)),
      ))
      .orderBy(asc(wholesaleOrders.deliveryDate));

    const wsIds = wholesaleRows.map(r => r.order.id);
    const wsItems = wsIds.length > 0
      ? await db
          .select({
            orderId: wholesaleOrderItems.orderId,
            quantity: wholesaleOrderItems.quantity,
            unitTypeName: wholesaleUnitTypes.name,
            flavorName: flavors.name,
          })
          .from(wholesaleOrderItems)
          .leftJoin(wholesaleUnitTypes, eq(wholesaleOrderItems.unitTypeId, wholesaleUnitTypes.id))
          .leftJoin(flavors, eq(wholesaleOrderItems.flavorId, flavors.id))
          .where(inArray(wholesaleOrderItems.orderId, wsIds))
      : [];

    const wsItemsByOrder = new Map<string, Array<{ unitTypeName: string; flavorName: string; quantity: number }>>();
    for (const it of wsItems) {
      const arr = wsItemsByOrder.get(it.orderId) || [];
      arr.push({ unitTypeName: it.unitTypeName || 'Item', flavorName: it.flavorName || 'Unknown', quantity: it.quantity });
      wsItemsByOrder.set(it.orderId, arr);
    }

    const wholesale = wholesaleRows.map(r => ({
      id: r.order.id,
      invoiceNumber: r.order.invoiceNumber,
      businessName: r.businessName || 'Unknown',
      city: r.city,
      locationName: r.locationName,
      fulfillmentMethod: r.order.fulfillmentMethod,
      deliveryDate: r.order.deliveryDate,
      orderDate: r.order.orderDate,
      status: r.order.status,
      totalAmount: r.order.totalAmount,
      notes: r.order.notes,
      items: wsItemsByOrder.get(r.order.id) || [],
    }));

    return { retail, wholesale };
  }

  async getWholesaleOrderAdjustments(orderId: string) {
    return await db
      .select()
      .from(wholesaleOrderAdjustments)
      .where(eq(wholesaleOrderAdjustments.orderId, orderId))
      .orderBy(asc(wholesaleOrderAdjustments.createdAt));
  }

  /**
   * Recompute an order's total as items subtotal + signed adjustments, and persist it.
   * The single writer for totalAmount whenever adjustments change — callers never send a
   * client-computed total. Returns the new total.
   */
  async recomputeWholesaleOrderTotal(orderId: string): Promise<number> {
    const [row] = (await db.execute(sql`
      SELECT
        COALESCE((SELECT SUM(quantity * unit_price) FROM wholesale_order_items WHERE order_id = ${orderId}), 0)
        + COALESCE((SELECT SUM(amount) FROM wholesale_order_adjustments WHERE order_id = ${orderId}), 0)
        AS total
    `)).rows as Array<{ total: string }>;
    const total = Number(row.total);
    await db.update(wholesaleOrders).set({ totalAmount: total.toFixed(2), updatedAt: new Date() }).where(eq(wholesaleOrders.id, orderId));
    return total;
  }

  async createWholesaleOrderAdjustment(data: { orderId: string; label: string; amount: string; createdByUserId?: string | null }) {
    const [created] = await db.insert(wholesaleOrderAdjustments).values(data).returning();
    const total = await this.recomputeWholesaleOrderTotal(data.orderId);
    return { adjustment: created, total };
  }

  async deleteWholesaleOrderAdjustment(id: string, orderId: string): Promise<number | null> {
    // Scoped to the order so a stray id can't delete another invoice's adjustment.
    const deleted = await db
      .delete(wholesaleOrderAdjustments)
      .where(and(eq(wholesaleOrderAdjustments.id, id), eq(wholesaleOrderAdjustments.orderId, orderId)))
      .returning();
    if (deleted.length === 0) return null;
    return await this.recomputeWholesaleOrderTotal(orderId);
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
    const prefix = `INV-${currentYear}-`;

    // Uses the WebSocket `pool`, not `db`: the neon-http driver has no transaction
    // support, so this threw "No transactions support in neon-http driver" on EVERY
    // call — which meant no wholesale order, customer- or staff-created, could be
    // saved at all.
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      // Advisory lock keyed on current year to serialize invoice number generation.
      await client.query('SELECT pg_advisory_xact_lock($1)', [currentYear]);

      const { rows } = await client.query(
        `SELECT invoice_number FROM wholesale_orders
          WHERE invoice_number LIKE $1
          ORDER BY invoice_number DESC
          LIMIT 1`,
        [prefix + '%'],
      );

      await client.query('COMMIT');

      if (rows.length === 0) {
        return `${prefix}0001`;
      }

      const match = String(rows[0].invoice_number).match(/INV-\d{4}-(\d{4})/);
      const nextNumber = match ? parseInt(match[1]) + 1 : 1;
      return `${prefix}${String(nextNumber).padStart(4, '0')}`;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
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

  async deleteWholesaleOrder(id: string): Promise<void> {
    // Deleting an order puts back any finished-goods stock it consumed at packaging.
    await this.applyWholesaleOrderStock(id, 'restore');
    // Soft delete - set deletedAt timestamp instead of removing the row
    await db.update(wholesaleOrders).set({ deletedAt: new Date(), updatedAt: new Date() }).where(eq(wholesaleOrders.id, id));
  }

  async updateWholesaleOrder(id: string, updates: {
    totalAmount?: string;
    poNumber?: string | null;
    notes?: string | null;
    dueDate?: Date | null;
    paidAt?: Date | null;
    paidByUserId?: string | null;
    paymentInitiatedAt?: Date | null;
    paymentFailedAt?: Date | null;
    stripePaymentIntentId?: string | null;
    invoiceSentAt?: Date | null;
  }): Promise<WholesaleOrder | undefined> {
    const result = await db
      .update(wholesaleOrders)
      .set({ ...updates, updatedAt: new Date() })
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
      .set({ cursor, lastSynced: new Date(), updatedAt: new Date() })
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
    }

    // Subscription plans seeding disabled - plans already exist in database
    if (false) {
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

    // Sample wholesale customers removed - use CSV import or manual creation for real data
    if (false && existingCustomers.length === 0) {
      const customerResults = await db.insert(wholesaleCustomers).values([
      {
        businessName: "Green Valley Cafe",
        contactName: "Sarah Johnson",
        email: "sarah@greenvalleycafe.com",
        phone: "(555) 123-4567",
      },
      {
        businessName: "Wellness Studio",
        contactName: "Michael Chen",
        email: "michael@wellnessstudio.com",
        phone: "(555) 234-5678",
      },
    ]).returning();

      // Create locations for each customer
      await db.insert(wholesaleLocations).values([
        {
          customerId: customerResults[0].id,
          locationName: "Main Location",
          address: "123 Main St",
          city: "Portland",
          state: "OR",
          zipCode: "97201",
        },
        {
          customerId: customerResults[1].id,
          locationName: "Main Location",
          address: "456 Oak Ave",
          city: "Portland",
          state: "OR",
          zipCode: "97202",
        },
      ]);

      await db.insert(wholesaleOrders).values([
        {
          customerId: customerResults[0].id,
          invoiceNumber: "INV-2026-0001",
          status: "delivered",
          totalAmount: "210.00",
          notes: "Regular weekly order",
        },
        {
          customerId: customerResults[1].id,
          invoiceNumber: "INV-2026-0002",
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

  async getRetailOrders(options?: { limit?: number; offset?: number; status?: string }): Promise<{ orders: RetailOrder[]; total: number }> {
    const conditions = [isNull(retailOrders.deletedAt)];
    if (options?.status) {
      conditions.push(eq(retailOrders.status, options.status));
    }
    const whereClause = and(...conditions);

    const [countResult] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(retailOrders)
      .where(whereClause);

    let query = db.select().from(retailOrders).where(whereClause).orderBy(desc(retailOrders.orderDate)).$dynamic();

    if (options?.limit !== undefined) {
      query = query.limit(options.limit);
    }
    if (options?.offset !== undefined) {
      query = query.offset(options.offset);
    }

    const orders = await query;
    return { orders, total: countResult.count };
  }

  async getRetailOrderCounts(): Promise<Record<string, number>> {
    const result = await db
      .select({
        status: retailOrders.status,
        count: sql<number>`count(*)::int`,
      })
      .from(retailOrders)
      .where(isNull(retailOrders.deletedAt))
      .groupBy(retailOrders.status);

    const counts: Record<string, number> = {};
    for (const row of result) {
      counts[row.status] = row.count;
    }
    return counts;
  }

  async getRetailOrder(id: string): Promise<RetailOrder | undefined> {
    const result = await db.select().from(retailOrders).where(and(eq(retailOrders.id, id), isNull(retailOrders.deletedAt)));
    return result[0];
  }

  async getRetailOrdersByUserId(userId: string): Promise<RetailOrder[]> {
    return await db.select().from(retailOrders).where(and(eq(retailOrders.userId, userId), isNull(retailOrders.deletedAt))).orderBy(desc(retailOrders.orderDate));
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
      const stockWarnings: string[] = [];
      const client = await pool.connect();
      try {
        await client.query('BEGIN');

        const orderItems = await db
          .select()
          .from(retailOrderItems)
          .where(eq(retailOrderItems.orderId, id));

        if (orderItems.length > 0) {
          // Batch-lock all product rows at once (avoids N individual SELECT FOR UPDATE queries)
          const productIds = orderItems.map(i => i.productId);
          const stockResult = await client.query(
            'SELECT id, stock_quantity FROM products WHERE id = ANY($1::text[]) FOR UPDATE',
            [productIds]
          );

          const stockMap = new Map(stockResult.rows.map((r: any) => [r.id, r.stock_quantity]));

          // Validate stock and apply updates
          for (const item of orderItems) {
            const currentStock = stockMap.get(item.productId);
            if (currentStock === undefined) {
              stockWarnings.push(`Product ${item.productId} not found — stock not adjusted`);
              continue;
            }

            // Negative stock is allowed by design (owner: warn, don't block — the pickup
            // already happened). The dashboard's below-zero flag holds it until the count.
            const newStock = currentStock - item.quantity;
            if (newStock < 0) {
              stockWarnings.push(`Stock below zero: product ${item.productId} at ${newStock}`);
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
        }

        // v2 order items (everything the current shop and all subscriptions create).
        // These reference retail_products, which link to a finished-goods product via
        // finished_product_id. Items with no link (e.g. kegs) intentionally decrement
        // nothing. Without this block, NO modern order ever moved stock on fulfilment.
        const v2Result = await client.query(
          `SELECT oi.retail_product_id, oi.quantity, rp.finished_product_id
           FROM retail_order_items_v2 oi
           JOIN retail_products rp ON rp.id = oi.retail_product_id
           WHERE oi.order_id = $1 AND rp.finished_product_id IS NOT NULL`,
          [id]
        );

        if (v2Result.rows.length > 0) {
          const v2ProductIds = Array.from(new Set(v2Result.rows.map((r: any) => r.finished_product_id)));
          const v2Stock = await client.query(
            'SELECT id, stock_quantity FROM products WHERE id = ANY($1::text[]) FOR UPDATE',
            [v2ProductIds]
          );
          const v2StockMap = new Map(v2Stock.rows.map((r: any) => [r.id, r.stock_quantity]));

          // Aggregate first: an order can contain several lines backed by the same
          // finished-goods product, and validating each in isolation would let the
          // combined quantity overdraw stock.
          const needed = new Map<string, number>();
          for (const row of v2Result.rows) {
            needed.set(row.finished_product_id, (needed.get(row.finished_product_id) ?? 0) + row.quantity);
          }

          for (const [productId, quantity] of Array.from(needed.entries())) {
            const currentStock = v2StockMap.get(productId);
            if (currentStock === undefined) {
              stockWarnings.push(`Finished-goods product ${productId} not found — stock not adjusted`);
              continue;
            }
            const newStock = currentStock - quantity;
            if (newStock < 0) {
              stockWarnings.push(`Stock below zero: product ${productId} at ${newStock}`);
            }

            await client.query(
              'UPDATE products SET stock_quantity = $1, in_stock = $2 WHERE id = $3',
              [newStock, newStock > 0, productId]
            );

            await client.query(
              `INSERT INTO inventory_adjustments
              (product_id, quantity, reason, staff_user_id, order_id, order_type)
              VALUES ($1, $2, $3, $4, $5, $6)`,
              [productId, -quantity, 'fulfillment', userId, id, 'retail']
            );
          }
        }

        await client.query(
          'UPDATE retail_orders SET status = $1, fulfilled_at = $2, fulfilled_by_user_id = $3, updated_at = $4 WHERE id = $5 AND deleted_at IS NULL',
          [status, new Date(), userId, new Date(), id]
        );

        await client.query('COMMIT');

        const updatedOrder: any = await this.getRetailOrder(id);
        if (updatedOrder && stockWarnings.length) updatedOrder.stockWarnings = stockWarnings;
        return updatedOrder;
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    } else {
      const updates: any = { status, updatedAt: new Date() };
      const result = await db
        .update(retailOrders)
        .set(updates)
        .where(and(eq(retailOrders.id, id), isNull(retailOrders.deletedAt)))
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

      // Mirror of the v2 fulfilment decrement — restore stock for v2 lines too, so a
      // cancelled order gives back exactly what fulfilment took. Only orders that were
      // actually fulfilled consumed stock, so only those are restored.
      const wasFulfilled = await client.query(
        `SELECT 1 FROM inventory_adjustments WHERE order_id = $1 AND reason = 'fulfillment' LIMIT 1`,
        [id]
      );

      if (wasFulfilled.rows.length > 0) {
        const v2Items = await client.query(
          `SELECT rp.finished_product_id, SUM(oi.quantity)::int AS quantity
           FROM retail_order_items_v2 oi
           JOIN retail_products rp ON rp.id = oi.retail_product_id
           WHERE oi.order_id = $1 AND rp.finished_product_id IS NOT NULL
           GROUP BY rp.finished_product_id`,
          [id]
        );

        for (const item of v2Items.rows) {
          await client.query(
            `INSERT INTO inventory_adjustments
            (product_id, quantity, reason, staff_user_id, order_id, order_type)
            VALUES ($1, $2, $3, $4, $5, $6)`,
            [item.finished_product_id, item.quantity, reason, staffUserId, id, 'retail']
          );

          await client.query(
            `UPDATE products
             SET stock_quantity = stock_quantity + $1,
                 in_stock = CASE WHEN stock_quantity + $1 > 0 THEN true ELSE in_stock END
             WHERE id = $2`,
            [item.quantity, item.finished_product_id]
          );
        }
      }

      // Update order status to cancelled
      await client.query(
        'UPDATE retail_orders SET status = $1, updated_at = $2 WHERE id = $3 AND deleted_at IS NULL',
        ['cancelled', new Date(), id]
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
         WHERE order_number LIKE $1 AND deleted_at IS NULL
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
        .where(and(sql`${retailOrders.orderNumber} LIKE ${`RO-${currentYear}-%`}`, isNull(retailOrders.deletedAt)))
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

  /**
   * Move finished-goods stock for a wholesale order. 'apply' when it crosses into
   * packaged — the owner's definition: it's in bottles/cans/kegs and on the shelf, so the
   * order's share leaves that shelf. 'restore' when it's walked back or deleted.
   *
   * Idempotent via the ledger: the net of this order's fulfillment rows says whether its
   * stock is currently taken, so repeated board taps can't double-count.
   *
   * Lines resolve to a product by (flavor, container) through the unit type; anything
   * unresolvable becomes a warning, never a silent skip. Stock MAY GO NEGATIVE by design
   * (owner decision: warn, don't block — the physical world already happened); warnings
   * surface on the board and the dashboard flags negatives until the monthly count
   * reconciles them.
   */
  async applyWholesaleOrderStock(orderId: string, action: 'apply' | 'restore', userId?: string): Promise<{ changed: boolean; warnings: string[] }> {
    const warnings: string[] = [];
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const netRes = await client.query(
        `SELECT COALESCE(SUM(quantity), 0)::int AS net FROM inventory_adjustments
         WHERE order_id = $1 AND order_type = 'wholesale' AND reason IN ('fulfillment', 'fulfillment-restore')`,
        [orderId]
      );
      const applied = netRes.rows[0].net < 0;
      if ((action === 'apply') === applied) {
        await client.query('COMMIT');
        return { changed: false, warnings };
      }

      if (action === 'apply') {
        const lines = await client.query(
          `SELECT COALESCE(oi.product_id, p.id) AS product_id, oi.quantity,
                  COALESCE(f.name, '?') AS flavor_name, COALESCE(ut.name, '?') AS unit_name,
                  p2.name AS product_name
           FROM wholesale_order_items oi
           LEFT JOIN wholesale_unit_types ut ON ut.id = oi.unit_type_id
           LEFT JOIN flavors f ON f.id = oi.flavor_id
           LEFT JOIN products p ON p.flavor_id = oi.flavor_id AND p.container = ut.container
           LEFT JOIN products p2 ON p2.id = COALESCE(oi.product_id, p.id)
           WHERE oi.order_id = $1`,
          [orderId]
        );
        const needed = new Map<string, number>();
        const label = new Map<string, string>();
        for (const row of lines.rows) {
          if (!row.product_id) {
            warnings.push(`${row.quantity}× ${row.flavor_name} ${row.unit_name}: no finished-goods product — stock not adjusted`);
            continue;
          }
          needed.set(row.product_id, (needed.get(row.product_id) ?? 0) + row.quantity);
          label.set(row.product_id, row.product_name || `${row.flavor_name} ${row.unit_name}`);
        }
        if (needed.size === 0) {
          await client.query('COMMIT');
          return { changed: false, warnings };
        }
        const ids = Array.from(needed.keys());
        const stock = await client.query('SELECT id, stock_quantity FROM products WHERE id = ANY($1::text[]) FOR UPDATE', [ids]);
        const stockMap = new Map<string, number>(stock.rows.map((r: any) => [r.id, r.stock_quantity]));
        for (const [productId, qty] of Array.from(needed.entries())) {
          const cur = stockMap.get(productId);
          if (cur === undefined) {
            warnings.push(`${label.get(productId)}: product row missing — stock not adjusted`);
            continue;
          }
          const next = cur - qty;
          if (next < 0) warnings.push(`${label.get(productId)}: now ${next} on hand (had ${cur}, order took ${qty})`);
          await client.query('UPDATE products SET stock_quantity = $1, in_stock = $2 WHERE id = $3', [next, next > 0, productId]);
          await client.query(
            `INSERT INTO inventory_adjustments (product_id, quantity, reason, staff_user_id, order_id, order_type)
             VALUES ($1, $2, 'fulfillment', $3, $4, 'wholesale')`,
            [productId, -qty, userId ?? null, orderId]
          );
        }
      } else {
        const rows = await client.query(
          `SELECT product_id, -SUM(quantity)::int AS qty FROM inventory_adjustments
           WHERE order_id = $1 AND order_type = 'wholesale' AND reason IN ('fulfillment', 'fulfillment-restore')
           GROUP BY product_id HAVING SUM(quantity) <> 0`,
          [orderId]
        );
        for (const row of rows.rows) {
          await client.query(
            `UPDATE products SET stock_quantity = stock_quantity + $1,
               in_stock = (stock_quantity + $1) > 0 WHERE id = $2`,
            [row.qty, row.product_id]
          );
          await client.query(
            `INSERT INTO inventory_adjustments (product_id, quantity, reason, staff_user_id, order_id, order_type)
             VALUES ($1, $2, 'fulfillment-restore', $3, $4, 'wholesale')`,
            [row.product_id, row.qty, userId ?? null, orderId]
          );
        }
      }
      await client.query('COMMIT');
      return { changed: true, warnings };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async updateWholesaleOrderFulfillment(id: string, userId: string): Promise<WholesaleOrder | undefined> {
    const { warnings } = await this.applyWholesaleOrderStock(id, 'apply', userId);
    const result = await db
      .update(wholesaleOrders)
      .set({ status: 'fulfilled', fulfilledAt: new Date(), fulfilledByUserId: userId, updatedAt: new Date() })
      .where(eq(wholesaleOrders.id, id))
      .returning();
    const order: any = result[0];
    if (order && warnings.length) order.stockWarnings = warnings;
    return order;
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

  // ADMIN TASKS - Recurring task management
  async getAdminTasks(includeInactive: boolean = false): Promise<AdminTask[]> {
    if (includeInactive) {
      return await db.select().from(adminTasks).orderBy(adminTasks.displayOrder, adminTasks.createdAt);
    }
    return await db
      .select()
      .from(adminTasks)
      .where(eq(adminTasks.isActive, true))
      .orderBy(adminTasks.displayOrder, adminTasks.createdAt);
  }

  async getAdminTask(id: string): Promise<AdminTask | undefined> {
    const result = await db.select().from(adminTasks).where(eq(adminTasks.id, id));
    return result[0];
  }

  async createAdminTask(task: InsertAdminTask): Promise<AdminTask> {
    const result = await db.insert(adminTasks).values(task).returning();
    return result[0];
  }

  async updateAdminTask(id: string, updates: Partial<InsertAdminTask>): Promise<AdminTask | undefined> {
    const result = await db
      .update(adminTasks)
      .set(updates)
      .where(eq(adminTasks.id, id))
      .returning();
    return result[0];
  }

  async deleteAdminTask(id: string): Promise<void> {
    await db.delete(adminTasks).where(eq(adminTasks.id, id));
  }

  // ADMIN TASK COMPLETIONS - Track completed tasks
  async getAdminTaskCompletions(taskId: string, startDate?: Date, endDate?: Date): Promise<AdminTaskCompletion[]> {
    const conditions = [eq(adminTaskCompletions.taskId, taskId)];
    if (startDate) {
      conditions.push(sql`${adminTaskCompletions.instanceDate} >= ${startDate}`);
    }
    if (endDate) {
      conditions.push(sql`${adminTaskCompletions.instanceDate} <= ${endDate}`);
    }
    return await db
      .select()
      .from(adminTaskCompletions)
      .where(and(...conditions))
      .orderBy(desc(adminTaskCompletions.completedAt));
  }

  async getAdminTaskCompletionsByDate(instanceDate: Date): Promise<AdminTaskCompletion[]> {
    const startOfDay = new Date(instanceDate);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(instanceDate);
    endOfDay.setHours(23, 59, 59, 999);
    
    return await db
      .select()
      .from(adminTaskCompletions)
      .where(and(
        sql`${adminTaskCompletions.instanceDate} >= ${startOfDay}`,
        sql`${adminTaskCompletions.instanceDate} <= ${endOfDay}`
      ));
  }

  async getAdminTaskCompletionsByDateRange(startDate: Date, endDate: Date): Promise<AdminTaskCompletion[]> {
    const rangeStart = new Date(startDate);
    rangeStart.setHours(0, 0, 0, 0);
    const rangeEnd = new Date(endDate);
    rangeEnd.setHours(23, 59, 59, 999);
    
    return await db
      .select()
      .from(adminTaskCompletions)
      .where(and(
        sql`${adminTaskCompletions.instanceDate} >= ${rangeStart}`,
        sql`${adminTaskCompletions.instanceDate} <= ${rangeEnd}`
      ));
  }

  async createAdminTaskCompletion(completion: InsertAdminTaskCompletion): Promise<AdminTaskCompletion> {
    const result = await db.insert(adminTaskCompletions).values(completion).returning();
    return result[0];
  }

  async deleteAdminTaskCompletion(id: string): Promise<void> {
    await db.delete(adminTaskCompletions).where(eq(adminTaskCompletions.id, id));
  }
}

export const storage = new PostgresStorage();
