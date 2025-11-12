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
  stripeCustomerId: text("stripe_customer_id"),
  status: text("status").notNull().default('active'), // 'active', 'paused', 'cancelled'
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

export const wholesaleOrders = pgTable("wholesale_orders", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  invoiceNumber: text("invoice_number").notNull().unique(),
  customerId: varchar("customer_id").notNull().references(() => wholesaleCustomers.id),
  orderDate: timestamp("order_date").notNull().defaultNow(),
  deliveryDate: timestamp("delivery_date"),
  status: text("status").notNull().default('pending'), // 'pending', 'processing', 'shipped', 'delivered'
  totalAmount: decimal("total_amount", { precision: 10, scale: 2 }).notNull(),
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

// Insert schemas
export const insertUserSchema = createInsertSchema(users).omit({ id: true, createdAt: true, updatedAt: true, isAdmin: true, role: true });
export const insertProductSchema = createInsertSchema(products).omit({ id: true });
export const insertSubscriptionPlanSchema = createInsertSchema(subscriptionPlans).omit({ id: true });
export const insertCartItemSchema = createInsertSchema(cartItems).omit({ id: true });
export const insertSubscriptionSchema = createInsertSchema(subscriptions).omit({ id: true, startDate: true, cancelledAt: true });
export const insertSubscriptionItemSchema = createInsertSchema(subscriptionItems).omit({ id: true });
export const insertWholesaleCustomerSchema = createInsertSchema(wholesaleCustomers).omit({ id: true });
export const insertWholesaleOrderSchema = createInsertSchema(wholesaleOrders).omit({ id: true, orderDate: true });
export const insertWholesaleOrderItemSchema = createInsertSchema(wholesaleOrderItems).omit({ id: true });
export const insertWholesalePricingSchema = createInsertSchema(wholesalePricing).omit({ id: true });
export const insertVerificationCodeSchema = createInsertSchema(verificationCodes).omit({ id: true, createdAt: true });
export const insertImpersonationLogSchema = createInsertSchema(impersonationLogs).omit({ id: true, startedAt: true });

// Insert types
export type InsertUser = z.infer<typeof insertUserSchema>;
export type InsertProduct = z.infer<typeof insertProductSchema>;
export type InsertSubscriptionPlan = z.infer<typeof insertSubscriptionPlanSchema>;
export type InsertCartItem = z.infer<typeof insertCartItemSchema>;
export type InsertSubscription = z.infer<typeof insertSubscriptionSchema>;
export type InsertSubscriptionItem = z.infer<typeof insertSubscriptionItemSchema>;
export type InsertWholesaleCustomer = z.infer<typeof insertWholesaleCustomerSchema>;
export type InsertWholesaleOrder = z.infer<typeof insertWholesaleOrderSchema>;
export type InsertWholesaleOrderItem = z.infer<typeof insertWholesaleOrderItemSchema>;
export type InsertWholesalePricing = z.infer<typeof insertWholesalePricingSchema>;
export type InsertVerificationCode = z.infer<typeof insertVerificationCodeSchema>;
export type InsertImpersonationLog = z.infer<typeof insertImpersonationLogSchema>;

// Select types
export type User = typeof users.$inferSelect;
export type Product = typeof products.$inferSelect;
export type SubscriptionPlan = typeof subscriptionPlans.$inferSelect;
export type CartItem = typeof cartItems.$inferSelect;
export type Subscription = typeof subscriptions.$inferSelect;
export type SubscriptionItem = typeof subscriptionItems.$inferSelect;
export type WholesaleCustomer = typeof wholesaleCustomers.$inferSelect;
export type WholesaleOrder = typeof wholesaleOrders.$inferSelect;
export type WholesaleOrderItem = typeof wholesaleOrderItems.$inferSelect;
export type WholesalePricing = typeof wholesalePricing.$inferSelect;
export type VerificationCode = typeof verificationCodes.$inferSelect;
export type ImpersonationLog = typeof impersonationLogs.$inferSelect;
