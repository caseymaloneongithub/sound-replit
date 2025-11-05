import { sql } from "drizzle-orm";
import { pgTable, text, varchar, integer, decimal, timestamp, boolean, index, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// Session storage table for Replit Auth
export const sessions = pgTable(
  "sessions",
  {
    sid: varchar("sid").primaryKey(),
    sess: jsonb("sess").notNull(),
    expire: timestamp("expire").notNull(),
  },
  (table) => [index("IDX_session_expire").on(table.expire)],
);

// User storage table for Replit Auth
export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  email: varchar("email").unique(),
  firstName: varchar("first_name"),
  lastName: varchar("last_name"),
  profileImageUrl: varchar("profile_image_url"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const products = pgTable("products", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  description: text("description").notNull(),
  flavor: text("flavor").notNull(),
  abv: text("abv").notNull(),
  ingredients: text("ingredients").array().notNull(),
  retailPrice: decimal("retail_price", { precision: 10, scale: 2 }).notNull(),
  wholesalePrice: decimal("wholesale_price", { precision: 10, scale: 2 }).notNull(),
  imageUrl: text("image_url").notNull(),
  inStock: boolean("in_stock").notNull().default(true),
  stockQuantity: integer("stock_quantity").notNull().default(0),
  lowStockThreshold: integer("low_stock_threshold").notNull().default(50),
});

export const subscriptionPlans = pgTable("subscription_plans", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  frequency: text("frequency").notNull(), // 'weekly' or 'monthly'
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
});

export const subscriptions = pgTable("subscriptions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").references(() => users.id),
  customerName: text("customer_name").notNull(),
  customerEmail: text("customer_email").notNull(),
  customerPhone: text("customer_phone").notNull(),
  planId: varchar("plan_id").notNull().references(() => subscriptionPlans.id),
  stripeSubscriptionId: text("stripe_subscription_id"),
  stripeCustomerId: text("stripe_customer_id"),
  status: text("status").notNull().default('active'), // 'active', 'paused', 'cancelled'
  startDate: timestamp("start_date").notNull().defaultNow(),
  nextDeliveryDate: timestamp("next_delivery_date"),
});

export const wholesaleCustomers = pgTable("wholesale_customers", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  businessName: text("business_name").notNull(),
  contactName: text("contact_name").notNull(),
  email: text("email").notNull().unique(),
  phone: text("phone").notNull(),
  address: text("address").notNull(),
});

export const wholesaleOrders = pgTable("wholesale_orders", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  customerId: varchar("customer_id").notNull().references(() => wholesaleCustomers.id),
  orderDate: timestamp("order_date").notNull().defaultNow(),
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

// Insert schemas
export const insertProductSchema = createInsertSchema(products).omit({ id: true });
export const insertSubscriptionPlanSchema = createInsertSchema(subscriptionPlans).omit({ id: true });
export const insertCartItemSchema = createInsertSchema(cartItems).omit({ id: true });
export const insertSubscriptionSchema = createInsertSchema(subscriptions).omit({ id: true, startDate: true });
export const insertWholesaleCustomerSchema = createInsertSchema(wholesaleCustomers).omit({ id: true });
export const insertWholesaleOrderSchema = createInsertSchema(wholesaleOrders).omit({ id: true, orderDate: true });
export const insertWholesaleOrderItemSchema = createInsertSchema(wholesaleOrderItems).omit({ id: true });

// Insert types
export type InsertProduct = z.infer<typeof insertProductSchema>;
export type InsertSubscriptionPlan = z.infer<typeof insertSubscriptionPlanSchema>;
export type InsertCartItem = z.infer<typeof insertCartItemSchema>;
export type InsertSubscription = z.infer<typeof insertSubscriptionSchema>;
export type InsertWholesaleCustomer = z.infer<typeof insertWholesaleCustomerSchema>;
export type InsertWholesaleOrder = z.infer<typeof insertWholesaleOrderSchema>;
export type InsertWholesaleOrderItem = z.infer<typeof insertWholesaleOrderItemSchema>;

// Select types
export type Product = typeof products.$inferSelect;
export type SubscriptionPlan = typeof subscriptionPlans.$inferSelect;
export type CartItem = typeof cartItems.$inferSelect;
export type Subscription = typeof subscriptions.$inferSelect;
export type WholesaleCustomer = typeof wholesaleCustomers.$inferSelect;
export type WholesaleOrder = typeof wholesaleOrders.$inferSelect;
export type WholesaleOrderItem = typeof wholesaleOrderItems.$inferSelect;
export type User = typeof users.$inferSelect;
export type UpsertUser = typeof users.$inferInsert;
