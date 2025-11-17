import { sql } from "drizzle-orm";
import { pgTable, text, varchar, integer, decimal, timestamp, boolean, index, jsonb, unique } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// Session storage table (managed by connect-pg-simple)
// Note: connect-pg-simple creates and manages this table automatically
// We define it here for type safety but let connect-pg-simple handle the actual creation
export const sessions = pgTable("sessions", {
  sid: varchar("sid").primaryKey(),
  sess: jsonb("sess").notNull(),
  expire: timestamp("expire").notNull(),
});

// User storage table
export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  username: varchar("username").notNull().unique(),
  password: text("password"),
  email: varchar("email"),
  phoneNumber: varchar("phone_number"),
  firstName: varchar("first_name"),
  lastName: varchar("last_name"),
  role: text("role").notNull().default('user'), // 'user', 'wholesale_customer', 'staff', 'admin', 'super_admin'
  isAdmin: boolean("is_admin").notNull().default(false),
  stripeCustomerId: text("stripe_customer_id"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Verification codes for SMS authentication
export const verificationCodes = pgTable("verification_codes", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  phoneNumber: varchar("phone_number").notNull(),
  code: varchar("code", { length: 6 }).notNull(),
  purpose: text("purpose").notNull().default('registration'), // 'registration' | 'login'
  expiresAt: timestamp("expires_at").notNull(),
  verified: boolean("verified").notNull().default(false),
  consumedAt: timestamp("consumed_at"),
  attempts: integer("attempts").notNull().default(0),
  createdAt: timestamp("created_at").defaultNow(),
});

// Password reset tokens
export const passwordResetTokens = pgTable("password_reset_tokens", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id),
  token: varchar("token", { length: 64 }).notNull().unique(),
  expiresAt: timestamp("expires_at").notNull(),
  used: boolean("used").notNull().default(false),
  usedAt: timestamp("used_at"),
  createdAt: timestamp("created_at").defaultNow(),
});

// Email verification codes for passwordless email login
export const emailVerificationCodes = pgTable("email_verification_codes", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  email: varchar("email").notNull(),
  code: varchar("code", { length: 6 }).notNull(),
  purpose: text("purpose").notNull().default('login'), // 'login' | 'registration'
  expiresAt: timestamp("expires_at").notNull(),
  verified: boolean("verified").notNull().default(false),
  consumedAt: timestamp("consumed_at"),
  attempts: integer("attempts").notNull().default(0),
  createdAt: timestamp("created_at").defaultNow(),
});

export const products = pgTable("products", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  description: text("description").notNull(),
  flavor: text("flavor").notNull(),
  ingredients: text("ingredients").array().notNull(),
  retailPrice: decimal("retail_price", { precision: 10, scale: 2 }).notNull(),
  wholesalePrice: decimal("wholesale_price", { precision: 10, scale: 2 }).notNull(),
  imageUrl: text("image_url").notNull(),
  imageUrls: text("image_urls").array().notNull().default(sql`ARRAY[]::text[]`),
  unitType: text("unit_type").notNull().default('case'), // 'case', '1/6-barrel', '1/2-barrel'
  inStock: boolean("in_stock").notNull().default(true),
  isActive: boolean("is_active").notNull().default(true),
  stockQuantity: integer("stock_quantity").notNull().default(0),
  lowStockThreshold: integer("low_stock_threshold").notNull().default(50),
});

export const inventoryAdjustments = pgTable("inventory_adjustments", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  productId: varchar("product_id").notNull().references(() => products.id),
  quantity: integer("quantity").notNull(), // Can be positive (production) or negative (fulfillment)
  reason: text("reason").notNull(), // 'production', 'fulfillment', 'manual', 'correction'
  staffUserId: varchar("staff_user_id").references(() => users.id),
  orderId: varchar("order_id"), // For fulfillment tracking (retail or wholesale)
  orderType: text("order_type"), // 'retail' or 'wholesale'
  batchMetadata: text("batch_metadata"), // JSON string for production batch info
  notes: text("notes"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const subscriptionPlans = pgTable("subscription_plans", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  frequency: text("frequency").notNull(), // 'weekly', 'bi-weekly', or 'every-4-weeks'
  bottleCount: integer("bottle_count").notNull(),
  price: decimal("price", { precision: 10, scale: 2 }).notNull(),
  savings: text("savings"),
  benefits: text("benefits").array().notNull(),
  stripePriceId: text("stripe_price_id"),
});

export const cartItems = pgTable("cart_items", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  sessionId: text("session_id").notNull(),
  productId: varchar("product_id").notNull().references(() => products.id),
  quantity: integer("quantity").notNull().default(1),
  isSubscription: boolean("is_subscription").notNull().default(false),
  subscriptionFrequency: text("subscription_frequency"), // 'weekly', 'bi-weekly', or 'every-4-weeks'
});

export const subscriptions = pgTable("subscriptions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").references(() => users.id),
  customerName: text("customer_name").notNull(),
  customerEmail: text("customer_email").notNull(),
  customerPhone: text("customer_phone").notNull(),
  planId: varchar("plan_id").references(() => subscriptionPlans.id),
  productId: varchar("product_id").references(() => products.id),
  subscriptionFrequency: text("subscription_frequency"), // 'weekly', 'bi-weekly', or 'every-4-weeks'
  stripeSubscriptionId: text("stripe_subscription_id"),
  stripeCheckoutSessionId: text("stripe_checkout_session_id").unique(), // For idempotency
  stripeCustomerId: text("stripe_customer_id"),
  stripePaymentMethodId: text("stripe_payment_method_id"), // For local subscription management
  status: text("status").notNull().default('active'), // 'active', 'paused', 'cancelled'
  billingType: text("billing_type").notNull().default('stripe_managed'), // 'stripe_managed' or 'local_managed'
  billingStatus: text("billing_status").notNull().default('active'), // 'active', 'awaiting_auth', 'awaiting_confirmation', 'retrying'
  nextChargeAt: timestamp("next_charge_at"), // When to charge next (for local_managed)
  retryCount: integer("retry_count").notNull().default(0), // Payment retry attempts
  lastPaymentIntentId: text("last_payment_intent_id"), // Track last charge attempt
  lastRefundId: text("last_refund_id"), // Track last refund for failed fulfillment
  lastRefundedAt: timestamp("last_refunded_at"), // When we refunded lastPaymentIntentId
  processingLock: boolean("processing_lock").notNull().default(false), // Prevent concurrent processing
  startDate: timestamp("start_date").notNull().defaultNow(),
  nextDeliveryDate: timestamp("next_delivery_date"),
  cancelledAt: timestamp("cancelled_at"),
});

export const subscriptionItems = pgTable("subscription_items", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  subscriptionId: varchar("subscription_id").notNull().references(() => subscriptions.id, { onDelete: 'cascade' }),
  productId: varchar("product_id").notNull().references(() => products.id),
  quantity: integer("quantity").notNull().default(1),
});

export const wholesaleCustomers = pgTable("wholesale_customers", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").references(() => users.id),
  businessName: text("business_name").notNull(),
  contactName: text("contact_name").notNull(),
  email: text("email").notNull().unique(),
  phone: text("phone").notNull(),
  address: text("address").notNull(),
  allowOnlinePayment: boolean("allow_online_payment").notNull().default(false),
});

export const retailCheckoutSessions = pgTable("retail_checkout_sessions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  sessionId: text("session_id").notNull(),
  paymentIntentId: text("payment_intent_id"),
  customerName: text("customer_name").notNull(),
  customerEmail: text("customer_email").notNull(),
  customerPhone: text("customer_phone").notNull(),
  userId: varchar("user_id").references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const retailOrders = pgTable("retail_orders", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  orderNumber: text("order_number").notNull().unique(),
  userId: varchar("user_id").references(() => users.id),
  customerName: text("customer_name").notNull(),
  customerEmail: text("customer_email").notNull(),
  customerPhone: text("customer_phone").notNull(),
  orderDate: timestamp("order_date").notNull().defaultNow(),
  pickupDate: timestamp("pickup_date"),
  status: text("status").notNull().default('pending'), // 'pending', 'ready_for_pickup', 'fulfilled', 'cancelled'
  subtotal: decimal("subtotal", { precision: 10, scale: 2 }).notNull(),
  taxAmount: decimal("tax_amount", { precision: 10, scale: 2 }).notNull().default('0'),
  totalAmount: decimal("total_amount", { precision: 10, scale: 2 }).notNull(),
  stripePaymentIntentId: text("stripe_payment_intent_id").unique(),
  stripeCheckoutSessionId: text("stripe_checkout_session_id"),
  stripeInvoiceId: text("stripe_invoice_id").unique(),
  isSubscriptionOrder: boolean("is_subscription_order").notNull().default(false),
  fulfilledAt: timestamp("fulfilled_at"),
  fulfilledByUserId: varchar("fulfilled_by_user_id").references(() => users.id),
  notes: text("notes"),
});

export const retailOrderItems = pgTable("retail_order_items", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  orderId: varchar("order_id").notNull().references(() => retailOrders.id),
  productId: varchar("product_id").notNull().references(() => products.id),
  quantity: integer("quantity").notNull(),
  unitPrice: decimal("unit_price", { precision: 10, scale: 2 }).notNull(),
});

export const wholesaleOrders = pgTable("wholesale_orders", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  invoiceNumber: text("invoice_number").notNull().unique(),
  customerId: varchar("customer_id").notNull().references(() => wholesaleCustomers.id),
  orderDate: timestamp("order_date").notNull().defaultNow(),
  deliveryDate: timestamp("delivery_date"),
  status: text("status").notNull().default('pending'), // 'pending', 'processing', 'shipped', 'delivered', 'fulfilled'
  totalAmount: decimal("total_amount", { precision: 10, scale: 2 }).notNull(),
  fulfilledAt: timestamp("fulfilled_at"),
  fulfilledByUserId: varchar("fulfilled_by_user_id").references(() => users.id),
  notes: text("notes"),
});

export const wholesaleOrderItems = pgTable("wholesale_order_items", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  orderId: varchar("order_id").notNull().references(() => wholesaleOrders.id),
  productId: varchar("product_id").notNull().references(() => products.id),
  quantity: integer("quantity").notNull(),
  unitPrice: decimal("unit_price", { precision: 10, scale: 2 }).notNull(),
});

export const wholesalePricing = pgTable("wholesale_pricing", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  customerId: varchar("customer_id").notNull().references(() => wholesaleCustomers.id),
  productId: varchar("product_id").notNull().references(() => products.id),
  customPrice: decimal("custom_price", { precision: 10, scale: 2 }).notNull(),
}, (table) => ({
  uniqueCustomerProduct: unique().on(table.customerId, table.productId),
}));

export const impersonationLogs = pgTable("impersonation_logs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  adminUserId: varchar("admin_user_id").notNull().references(() => users.id),
  impersonatedUserId: varchar("impersonated_user_id").notNull().references(() => users.id),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  startedAt: timestamp("started_at").notNull().defaultNow(),
  endedAt: timestamp("ended_at"),
}, (table) => ({
  activeImpersonationIdx: index("active_impersonation_idx").on(table.adminUserId).where(sql`${table.endedAt} IS NULL`),
}));

// CRM - Leads table for tracking potential customers
export const leads = pgTable("leads", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  businessName: text("business_name").notNull(),
  contactName: text("contact_name").notNull(),
  email: varchar("email"),
  phone: varchar("phone"),
  priorityLevel: text("priority_level").notNull().default('medium'), // 'low', 'medium', 'high'
  status: text("status").notNull().default('new'), // 'new', 'contacted', 'qualified', 'proposal', 'negotiation', 'won', 'lost'
  notes: text("notes"),
  assignedToUserId: varchar("assigned_to_user_id").references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// CRM - Lead touch points (interaction history)
export const leadTouchPoints = pgTable("lead_touch_points", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  leadId: varchar("lead_id").notNull().references(() => leads.id, { onDelete: 'cascade' }),
  type: text("type").notNull(), // 'email', 'phone_call', 'meeting', 'note', 'other'
  subject: text("subject").notNull(),
  notes: text("notes"),
  createdByUserId: varchar("created_by_user_id").notNull().references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// Insert schemas
export const insertUserSchema = createInsertSchema(users).omit({ id: true, createdAt: true, updatedAt: true, isAdmin: true, role: true });
export const insertProductSchema = createInsertSchema(products).omit({ id: true });
export const insertSubscriptionPlanSchema = createInsertSchema(subscriptionPlans).omit({ id: true });
export const insertCartItemSchema = createInsertSchema(cartItems).omit({ id: true });
export const insertSubscriptionSchema = createInsertSchema(subscriptions).omit({ id: true, startDate: true, cancelledAt: true });
export const insertSubscriptionItemSchema = createInsertSchema(subscriptionItems).omit({ id: true });
export const insertInventoryAdjustmentSchema = createInsertSchema(inventoryAdjustments).omit({ id: true, createdAt: true });
export const insertRetailCheckoutSessionSchema = createInsertSchema(retailCheckoutSessions).omit({ id: true, createdAt: true });
export const insertRetailOrderSchema = createInsertSchema(retailOrders).omit({ id: true, orderDate: true, fulfilledAt: true });
export const insertRetailOrderItemSchema = createInsertSchema(retailOrderItems).omit({ id: true });
export const insertWholesaleCustomerSchema = createInsertSchema(wholesaleCustomers).omit({ id: true });
export const insertWholesaleOrderSchema = createInsertSchema(wholesaleOrders).omit({ id: true, orderDate: true, fulfilledAt: true });
export const insertWholesaleOrderItemSchema = createInsertSchema(wholesaleOrderItems).omit({ id: true });
export const insertWholesalePricingSchema = createInsertSchema(wholesalePricing).omit({ id: true });
export const insertVerificationCodeSchema = createInsertSchema(verificationCodes).omit({ id: true, createdAt: true });
export const insertEmailVerificationCodeSchema = createInsertSchema(emailVerificationCodes).omit({ id: true, createdAt: true });
export const insertImpersonationLogSchema = createInsertSchema(impersonationLogs).omit({ id: true, startedAt: true });
export const insertLeadSchema = createInsertSchema(leads).omit({ id: true, createdAt: true, updatedAt: true });
export const insertLeadTouchPointSchema = createInsertSchema(leadTouchPoints).omit({ id: true, createdAt: true });

// Update profile schema - allows customers to update their contact information
export const updateProfileSchema = z.object({
  firstName: z.string().min(1, "First name is required").optional(),
  lastName: z.string().min(1, "Last name is required").optional(),
  email: z.string().email("Invalid email address").optional(),
  phoneNumber: z.string().min(10, "Phone number must be at least 10 digits").optional(),
});

// Insert types
export type InsertUser = z.infer<typeof insertUserSchema>;
export type InsertProduct = z.infer<typeof insertProductSchema>;
export type InsertInventoryAdjustment = z.infer<typeof insertInventoryAdjustmentSchema>;
export type InsertSubscriptionPlan = z.infer<typeof insertSubscriptionPlanSchema>;
export type InsertCartItem = z.infer<typeof insertCartItemSchema>;
export type InsertSubscription = z.infer<typeof insertSubscriptionSchema>;
export type InsertSubscriptionItem = z.infer<typeof insertSubscriptionItemSchema>;
export type InsertRetailCheckoutSession = z.infer<typeof insertRetailCheckoutSessionSchema>;
export type InsertRetailOrder = z.infer<typeof insertRetailOrderSchema>;
export type InsertRetailOrderItem = z.infer<typeof insertRetailOrderItemSchema>;
export type InsertWholesaleCustomer = z.infer<typeof insertWholesaleCustomerSchema>;
export type InsertWholesaleOrder = z.infer<typeof insertWholesaleOrderSchema>;
export type InsertWholesaleOrderItem = z.infer<typeof insertWholesaleOrderItemSchema>;
export type InsertWholesalePricing = z.infer<typeof insertWholesalePricingSchema>;
export type InsertVerificationCode = z.infer<typeof insertVerificationCodeSchema>;
export type InsertEmailVerificationCode = z.infer<typeof insertEmailVerificationCodeSchema>;
export type InsertImpersonationLog = z.infer<typeof insertImpersonationLogSchema>;
export type InsertLead = z.infer<typeof insertLeadSchema>;
export type InsertLeadTouchPoint = z.infer<typeof insertLeadTouchPointSchema>;
export type UpdateProfile = z.infer<typeof updateProfileSchema>;

// Select types
export type User = typeof users.$inferSelect;
export type Product = typeof products.$inferSelect;
export type InventoryAdjustment = typeof inventoryAdjustments.$inferSelect;
export type SubscriptionPlan = typeof subscriptionPlans.$inferSelect;
export type CartItem = typeof cartItems.$inferSelect;
export type Subscription = typeof subscriptions.$inferSelect;
export type SubscriptionItem = typeof subscriptionItems.$inferSelect;
export type RetailCheckoutSession = typeof retailCheckoutSessions.$inferSelect;
export type RetailOrder = typeof retailOrders.$inferSelect;
export type RetailOrderItem = typeof retailOrderItems.$inferSelect;
export type WholesaleCustomer = typeof wholesaleCustomers.$inferSelect;
export type WholesaleOrder = typeof wholesaleOrders.$inferSelect;
export type WholesaleOrderItem = typeof wholesaleOrderItems.$inferSelect;
export type WholesalePricing = typeof wholesalePricing.$inferSelect;
export type VerificationCode = typeof verificationCodes.$inferSelect;
export type EmailVerificationCode = typeof emailVerificationCodes.$inferSelect;
export type ImpersonationLog = typeof impersonationLogs.$inferSelect;
export type Lead = typeof leads.$inferSelect;
export type LeadTouchPoint = typeof leadTouchPoints.$inferSelect;
