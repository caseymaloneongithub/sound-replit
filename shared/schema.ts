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
  address: text("address"),
  city: text("city"),
  state: text("state"),
  zipCode: text("zip_code"),
  role: text("role").notNull().default('user'), // 'user', 'wholesale_customer', 'staff', 'admin', 'super_admin'
  isAdmin: boolean("is_admin").notNull().default(false),
  stripeCustomerId: text("stripe_customer_id"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
  deletedAt: timestamp("deleted_at"),
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
  wholesaleCustomerId: varchar("wholesale_customer_id"), // Link to wholesale customer for wholesale auth
  expiresAt: timestamp("expires_at").notNull(),
  verified: boolean("verified").notNull().default(false),
  consumedAt: timestamp("consumed_at"),
  attempts: integer("attempts").notNull().default(0),
  createdAt: timestamp("created_at").defaultNow(),
});

// Site settings for global configuration
export const siteSettings = pgTable("site_settings", {
  key: varchar("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// OLD SCHEMA - Keep for backwards compatibility during migration
// Product Types - represents product categories with pricing (e.g., "Mixed Case - 12 bottles")
export const productTypes = pgTable("product_types", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  description: text("description").notNull(),
  retailPrice: decimal("retail_price", { precision: 10, scale: 2 }).notNull(),
  wholesalePrice: decimal("wholesale_price", { precision: 10, scale: 2 }).notNull(),
  unitType: text("unit_type").notNull().default('case'), // 'case', '1/6-barrel', '1/2-barrel'
  isActive: boolean("is_active").notNull().default(true),
});

// Products - represents individual flavors (linked to a product type for pricing)
export const products = pgTable("products", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  productTypeId: varchar("product_type_id").notNull().references(() => productTypes.id),
  name: text("name").notNull(), // Flavor name (e.g., "Bonfire", "Evergreen")
  description: text("description").notNull(),
  flavor: text("flavor").notNull(), // Flavor description (e.g., "warm spiced", "matcha")
  ingredients: text("ingredients").array().notNull(),
  imageUrl: text("image_url").notNull(),
  imageUrls: text("image_urls").array().notNull().default(sql`ARRAY[]::text[]`),
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

// NEW SCHEMA - Parallel tables for new flavor-centric approach
// Flavors - Master table for all kombucha flavors (shared between retail and wholesale)
export const flavors = pgTable("flavors", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(), // e.g., "Bonfire", "Evergreen", "Ginger Lemon"
  description: text("description").notNull(),
  flavorProfile: text("flavor_profile").notNull(), // e.g., "warm spiced", "matcha green tea"
  ingredients: text("ingredients").array().notNull(),
  primaryImageUrl: text("primary_image_url"), // Main product photo (uploaded via object storage)
  secondaryImageUrl: text("secondary_image_url"), // Optional additional photo
  isActive: boolean("is_active").notNull().default(true),
  displayOrder: integer("display_order").notNull().default(0),
});

// Retail Products - Each flavor+unit combination sold to retail customers
// Now supports both single-flavor and multi-flavor products (e.g., variety packs)
export const retailProducts = pgTable("retail_products", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  productType: text("product_type").notNull().default('single-flavor'), // 'single-flavor' | 'multi-flavor'
  productName: text("product_name"), // For multi-flavor products, e.g., "Variety Pack"
  flavorId: varchar("flavor_id").references(() => flavors.id), // Nullable for multi-flavor products
  unitType: text("unit_type").notNull(), // 'case', '1/6-barrel', '1/2-barrel'
  unitDescription: text("unit_description").notNull(), // e.g., "12 bottles", "5.16 gallons"
  price: decimal("price", { precision: 10, scale: 2 }).notNull(),
  deposit: decimal("deposit", { precision: 10, scale: 2 }).notNull().default('0.00'), // Refundable deposit (e.g., $75 for keg)
  subscriptionDiscount: decimal("subscription_discount", { precision: 5, scale: 2 }).notNull().default('10.00'), // Percentage discount for subscriptions (e.g., 10.00 = 10%)
  productImageUrl: text("product_image_url"), // For multi-flavor products (uploaded via object storage)
  isActive: boolean("is_active").notNull().default(true),
  displayOrder: integer("display_order").notNull().default(0),
});

// Retail Product Flavors - Junction table for multi-flavor products
export const retailProductFlavors = pgTable("retail_product_flavors", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  retailProductId: varchar("retail_product_id").notNull().references(() => retailProducts.id, { onDelete: 'cascade' }),
  flavorId: varchar("flavor_id").notNull().references(() => flavors.id, { onDelete: 'cascade' }),
}, (table) => ({
  uniqueProductFlavor: unique().on(table.retailProductId, table.flavorId),
}));

// Wholesale Unit Types - Defines wholesale unit types with default pricing
export const wholesaleUnitTypes = pgTable("wholesale_unit_types", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(), // e.g., "Case", "1/6 Barrel Keg", "1/2 Barrel Keg"
  unitType: text("unit_type").notNull().unique(), // 'case', '1/6-barrel', '1/2-barrel'
  description: text("description").notNull(), // e.g., "12 bottles per case"
  defaultPrice: decimal("default_price", { precision: 10, scale: 2 }).notNull(),
  isActive: boolean("is_active").notNull().default(true),
  displayOrder: integer("display_order").notNull().default(0),
});

// Wholesale Unit Type Flavors - Junction table: which flavors are available for each unit type
export const wholesaleUnitTypeFlavors = pgTable("wholesale_unit_type_flavors", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  unitTypeId: varchar("unit_type_id").notNull().references(() => wholesaleUnitTypes.id, { onDelete: 'cascade' }),
  flavorId: varchar("flavor_id").notNull().references(() => flavors.id, { onDelete: 'cascade' }),
}, (table) => ({
  uniqueUnitTypeFlavor: unique().on(table.unitTypeId, table.flavorId),
}));

// Wholesale Customer Pricing - Custom pricing per customer and unit type
export const wholesaleCustomerPricing = pgTable("wholesale_customer_pricing", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  customerId: varchar("customer_id").notNull().references(() => wholesaleCustomers.id, { onDelete: 'cascade' }),
  unitTypeId: varchar("unit_type_id").notNull().references(() => wholesaleUnitTypes.id, { onDelete: 'cascade' }),
  customPrice: decimal("custom_price", { precision: 10, scale: 2 }).notNull(),
}, (table) => ({
  uniqueCustomerUnitType: unique().on(table.customerId, table.unitTypeId),
}));

// NEW SCHEMA - Retail Cart Items (references retailProducts)
export const retailCartItems = pgTable("retail_cart_items", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  sessionId: text("session_id").notNull(),
  retailProductId: varchar("retail_product_id").notNull().references(() => retailProducts.id),
  selectedFlavorId: varchar("selected_flavor_id").references(() => flavors.id), // For multi-flavor products, tracks which flavor customer selected
  quantity: integer("quantity").notNull().default(1),
  isSubscription: boolean("is_subscription").notNull().default(false),
  subscriptionFrequency: text("subscription_frequency"), // 'weekly', 'bi-weekly', 'every-4-weeks', 'every-6-weeks', or 'every-8-weeks'
});

// NEW SCHEMA - Retail Order Items V2 (references retailProducts)
export const retailOrderItemsV2 = pgTable("retail_order_items_v2", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  orderId: varchar("order_id").notNull().references(() => retailOrders.id),
  retailProductId: varchar("retail_product_id").notNull().references(() => retailProducts.id),
  selectedFlavorId: varchar("selected_flavor_id").references(() => flavors.id), // For multi-flavor products, tracks which flavor customer selected
  quantity: integer("quantity").notNull(),
  unitPrice: decimal("unit_price", { precision: 10, scale: 2 }).notNull(),
});

// NEW SCHEMA - Retail Subscriptions V2 (references retailProducts)
export const retailSubscriptions = pgTable("retail_subscriptions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").references(() => users.id),
  customerName: text("customer_name").notNull(),
  customerEmail: text("customer_email").notNull(),
  customerPhone: text("customer_phone").notNull(),
  subscriptionFrequency: text("subscription_frequency").notNull(), // 'weekly', 'bi-weekly', 'every-4-weeks', 'every-6-weeks', or 'every-8-weeks'
  stripeSubscriptionId: text("stripe_subscription_id"),
  stripeCheckoutSessionId: text("stripe_checkout_session_id").unique(),
  stripeCustomerId: text("stripe_customer_id"),
  stripePaymentMethodId: text("stripe_payment_method_id"),
  status: text("status").notNull().default('active'), // 'active', 'paused', 'cancelled'
  billingType: text("billing_type").notNull().default('stripe_managed'), // 'stripe_managed' or 'local_managed'
  billingStatus: text("billing_status").notNull().default('active'), // 'active', 'awaiting_auth', 'awaiting_confirmation', 'retrying'
  nextChargeAt: timestamp("next_charge_at"),
  retryCount: integer("retry_count").notNull().default(0),
  lastPaymentIntentId: text("last_payment_intent_id"),
  lastRefundId: text("last_refund_id"),
  lastRefundedAt: timestamp("last_refunded_at"),
  processingLock: boolean("processing_lock").notNull().default(false),
  startDate: timestamp("start_date").notNull().defaultNow(),
  nextDeliveryDate: timestamp("next_delivery_date"),
  cancelledAt: timestamp("cancelled_at"),
});

// NEW SCHEMA - Retail Subscription Items V2 (junction table)
export const retailSubscriptionItems = pgTable("retail_subscription_items", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  subscriptionId: varchar("subscription_id").notNull().references(() => retailSubscriptions.id, { onDelete: 'cascade' }),
  retailProductId: varchar("retail_product_id").notNull().references(() => retailProducts.id),
  selectedFlavorId: varchar("selected_flavor_id").references(() => flavors.id), // For multi-flavor products, tracks which flavor customer selected
  quantity: integer("quantity").notNull().default(1),
});

export const subscriptionPlans = pgTable("subscription_plans", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  frequency: text("frequency").notNull(), // 'weekly', 'bi-weekly', 'every-4-weeks', 'every-6-weeks', or 'every-8-weeks'
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
  subscriptionFrequency: text("subscription_frequency"), // 'weekly', 'bi-weekly', 'every-4-weeks', 'every-6-weeks', or 'every-8-weeks'
});

export const subscriptions = pgTable("subscriptions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").references(() => users.id),
  customerName: text("customer_name").notNull(),
  customerEmail: text("customer_email").notNull(),
  customerPhone: text("customer_phone").notNull(),
  planId: varchar("plan_id").references(() => subscriptionPlans.id),
  productId: varchar("product_id").references(() => products.id),
  subscriptionFrequency: text("subscription_frequency"), // 'weekly', 'bi-weekly', 'every-4-weeks', 'every-6-weeks', or 'every-8-weeks'
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
  email: text("email").notNull().unique(), // Primary contact email (kept for backwards compatibility)
  emails: text("emails").array().notNull().default(sql`ARRAY[]::text[]`), // All authorized email addresses
  phone: text("phone").notNull(),
  allowOnlinePayment: boolean("allow_online_payment").notNull().default(false),
});

export const wholesaleLocations = pgTable("wholesale_locations", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  customerId: varchar("customer_id").notNull().references(() => wholesaleCustomers.id, { onDelete: 'cascade' }),
  locationName: text("location_name").notNull(), // e.g., "Main Store", "Downtown Location", "Warehouse"
  address: text("address").notNull(),
  city: text("city").notNull(),
  state: text("state").notNull().default('WA'),
  zipCode: text("zip_code").notNull(),
  contactName: text("contact_name"),
  contactPhone: text("contact_phone"),
  deliveryInstructions: text("delivery_instructions"),
  isPrimary: boolean("is_primary").notNull().default(false), // Primary/default location for this customer
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  // Geocoding cache
  latitude: decimal("latitude", { precision: 10, scale: 7 }),
  longitude: decimal("longitude", { precision: 10, scale: 7 }),
  geocodedAt: timestamp("geocoded_at"),
});

// Custom delivery stops (non-order stops like supply pickups, etc.)
export const deliveryStops = pgTable("delivery_stops", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(), // e.g., "Supplier Pickup", "Bank Deposit"
  address: text("address").notNull(),
  city: text("city").notNull(),
  state: text("state").notNull().default('WA'),
  zipCode: text("zip_code").notNull(),
  notes: text("notes"),
  latitude: decimal("latitude", { precision: 10, scale: 7 }),
  longitude: decimal("longitude", { precision: 10, scale: 7 }),
  geocodedAt: timestamp("geocoded_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  createdByUserId: varchar("created_by_user_id").references(() => users.id),
});

// Delivery routes - stores optimized routes for a given date
export const deliveryRoutes = pgTable("delivery_routes", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  routeDate: timestamp("route_date").notNull(), // The delivery date this route is for
  totalDistanceMeters: integer("total_distance_meters"),
  totalDurationSeconds: integer("total_duration_seconds"),
  optimizedStops: text("optimized_stops").notNull(), // JSON array of ordered stops with details
  generatedAt: timestamp("generated_at").notNull().defaultNow(),
  generatedByUserId: varchar("generated_by_user_id").references(() => users.id),
});

// Route stops for a specific route (links orders and custom stops to a route)
export const deliveryRouteStops = pgTable("delivery_route_stops", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  routeId: varchar("route_id").notNull().references(() => deliveryRoutes.id, { onDelete: 'cascade' }),
  stopOrder: integer("stop_order").notNull(), // Order in the route (1-indexed)
  stopType: text("stop_type").notNull(), // 'order' or 'custom'
  wholesaleOrderId: varchar("wholesale_order_id").references(() => wholesaleOrders.id),
  deliveryStopId: varchar("delivery_stop_id").references(() => deliveryStops.id),
  arrivalEstimate: timestamp("arrival_estimate"),
  distanceFromPrevious: integer("distance_from_previous"), // meters
  durationFromPrevious: integer("duration_from_previous"), // seconds
});

export const retailCheckoutSessions = pgTable("retail_checkout_sessions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  sessionId: text("session_id").notNull(),
  paymentIntentId: text("payment_intent_id"),
  customerName: text("customer_name").notNull(),
  customerEmail: text("customer_email").notNull(),
  customerPhone: text("customer_phone").notNull(),
  userId: varchar("user_id").references(() => users.id),
  taxMode: text("tax_mode").notNull().default('exclusive'), // 'exclusive', 'inclusive', 'none'
  taxRateBps: integer("tax_rate_bps").notNull().default(1035), // 10.35% = 1035 basis points
  taxAmountCents: integer("tax_amount_cents").notNull().default(0),
  isTaxExempt: boolean("is_tax_exempt").notNull().default(false),
  notes: text("notes"), // Customer flavor notes for mixed cases
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
  depositAmount: decimal("deposit_amount", { precision: 10, scale: 2 }).notNull().default('0'), // Refundable deposit (not subject to tax)
  totalAmount: decimal("total_amount", { precision: 10, scale: 2 }).notNull(),
  stripePaymentIntentId: text("stripe_payment_intent_id").unique(),
  stripeCheckoutSessionId: text("stripe_checkout_session_id"),
  stripeInvoiceId: text("stripe_invoice_id").unique(),
  isSubscriptionOrder: boolean("is_subscription_order").notNull().default(false),
  depositRefundedAt: timestamp("deposit_refunded_at"), // When deposit was refunded
  depositRefundedByUserId: varchar("deposit_refunded_by_user_id").references(() => users.id), // Staff who processed refund
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
  locationId: varchar("location_id").references(() => wholesaleLocations.id), // Delivery location for this order
  orderDate: timestamp("order_date").notNull().defaultNow(),
  deliveryDate: timestamp("delivery_date"),
  status: text("status").notNull().default('pending'), // 'pending', 'packaged', 'delivered'
  totalAmount: decimal("total_amount", { precision: 10, scale: 2 }).notNull(),
  fulfilledAt: timestamp("fulfilled_at"),
  fulfilledByUserId: varchar("fulfilled_by_user_id").references(() => users.id),
  notes: text("notes"),
  // Invoice payment tracking
  dueDate: timestamp("due_date"), // Payment due date (default 30 days from order)
  paidAt: timestamp("paid_at"), // When payment was received
  paidByUserId: varchar("paid_by_user_id").references(() => users.id), // Who marked it as paid (for manual marking)
  stripePaymentIntentId: text("stripe_payment_intent_id"), // Links to Stripe payment
  invoiceSentAt: timestamp("invoice_sent_at"), // When invoice was emailed
});

export const wholesaleOrderItems = pgTable("wholesale_order_items", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  orderId: varchar("order_id").notNull().references(() => wholesaleOrders.id),
  productId: varchar("product_id").references(() => products.id), // Made nullable for backward compatibility
  unitTypeId: varchar("unit_type_id").references(() => wholesaleUnitTypes.id),
  flavorId: varchar("flavor_id").references(() => flavors.id),
  quantity: integer("quantity").notNull(),
  unitPrice: decimal("unit_price", { precision: 10, scale: 2 }).notNull(),
});

export const wholesalePricing = pgTable("wholesale_pricing", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  customerId: varchar("customer_id").notNull().references(() => wholesaleCustomers.id),
  productTypeId: varchar("product_type_id").notNull().references(() => productTypes.id),
  customPrice: decimal("custom_price", { precision: 10, scale: 2 }).notNull(),
});

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

// ==================== ACCOUNTING MODULE ====================

// Plaid Items - Connected bank accounts via Plaid
export const plaidItems = pgTable("plaid_items", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  accessToken: text("access_token").notNull(), // Encrypted Plaid access token
  itemId: text("item_id").notNull().unique(), // Plaid item ID
  institutionId: text("institution_id"),
  institutionName: text("institution_name"),
  status: text("status").default('good'), // 'good', 'error', 'pending'
  cursor: text("cursor"), // For cursor-based transaction sync
  lastSynced: timestamp("last_synced"), // Last successful sync
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// Plaid Accounts - Individual bank accounts within a Plaid item
export const plaidAccounts = pgTable("plaid_accounts", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  plaidItemId: varchar("plaid_item_id").notNull().references(() => plaidItems.id, { onDelete: 'cascade' }),
  accountId: text("account_id").notNull().unique(), // Plaid account ID
  name: text("name").notNull(),
  officialName: text("official_name"), // Bank's official name for the account
  mask: text("mask"), // Last 4 digits
  accountType: text("account_type"), // 'depository', 'credit', etc.
  subtype: text("subtype"), // 'checking', 'savings', etc.
  isActive: boolean("is_active").notNull().default(true),
});

// Accounting Categories - For classifying transactions
export const accountingCategories = pgTable("accounting_categories", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  type: text("type").notNull(), // 'income', 'expense', 'transfer'
  code: text("code"), // Optional accounting code (e.g., "5000", "5015")
  description: text("description"),
  color: text("color"), // Hex color for UI
  parentId: varchar("parent_id"), // For hierarchical categories (self-reference)
  displayOrder: integer("display_order").notNull().default(0),
  isDefault: boolean("is_default").notNull().default(false), // System default categories
  isActive: boolean("is_active").notNull().default(true), // Active/inactive toggle
  excludeFromReports: boolean("exclude_from_reports").notNull().default(false), // Exclude from income statement totals
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// Accounting Transactions - Synced from Plaid or imported via CSV
export const accountingTransactions = pgTable("accounting_transactions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  plaidAccountId: varchar("plaid_account_id").references(() => plaidAccounts.id, { onDelete: 'set null' }),
  transactionId: text("transaction_id").unique(), // Plaid transaction ID (null for CSV imports)
  date: timestamp("date").notNull(),
  name: text("name").notNull(), // Transaction description
  merchantName: text("merchant_name"), // Merchant name from Plaid
  amount: decimal("amount", { precision: 12, scale: 2 }).notNull(), // Positive = expense (Plaid convention)
  category: text("category"), // Plaid's category (for reference)
  categoryDetailed: text("category_detailed"), // Detailed Plaid category
  pending: boolean("pending").notNull().default(false),
  paymentChannel: text("payment_channel"), // Plaid payment channel (online, in store, etc.)
  status: text("status").notNull().default('active'), // 'active', 'removed' (soft delete)
  isManualImport: boolean("is_manual_import").notNull().default(false), // True for CSV imports
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  dateIdx: index("accounting_transactions_date_idx").on(table.date),
  accountIdx: index("accounting_transactions_account_idx").on(table.plaidAccountId),
  statusIdx: index("accounting_transactions_status_idx").on(table.status),
}));

// Transaction Allocations - Assigns transactions to accounting categories
export const transactionAllocations = pgTable("transaction_allocations", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  transactionId: varchar("transaction_id").notNull().references(() => accountingTransactions.id, { onDelete: 'cascade' }),
  categoryId: varchar("category_id").notNull().references(() => accountingCategories.id, { onDelete: 'cascade' }),
  amount: decimal("amount", { precision: 12, scale: 2 }).notNull(), // Allocated amount (for split transactions)
  notes: text("notes"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// Admin Tasks - Recurring task checklists for staff/admin
export const adminTasks = pgTable("admin_tasks", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  title: text("title").notNull(),
  description: text("description"),
  category: text("category"), // e.g., 'operations', 'finance', 'maintenance', 'compliance'
  recurrence: text("recurrence").notNull().default('weekly'), // 'daily', 'weekly', 'monthly', 'quarterly', 'yearly', 'one-time'
  dayOfWeek: integer("day_of_week"), // 0-6 (Sun-Sat) for weekly tasks
  dayOfMonth: integer("day_of_month"), // 1-31 for monthly tasks
  monthOfYear: integer("month_of_year"), // 1-12 for yearly tasks
  startDate: timestamp("start_date"), // When the task starts recurring (required for recurring tasks)
  endDate: timestamp("end_date"), // Optional end date for the recurring task
  assignedToUserId: varchar("assigned_to_user_id").references(() => users.id),
  createdByUserId: varchar("created_by_user_id").references(() => users.id),
  isActive: boolean("is_active").notNull().default(true),
  displayOrder: integer("display_order").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// Admin Task Completions - Records of task completions with instance tracking
export const adminTaskCompletions = pgTable("admin_task_completions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  taskId: varchar("task_id").notNull().references(() => adminTasks.id, { onDelete: 'cascade' }),
  completedByUserId: varchar("completed_by_user_id").references(() => users.id),
  completedAt: timestamp("completed_at").notNull().defaultNow(),
  instanceDate: timestamp("instance_date").notNull(), // The specific date this completion is for
  notes: text("notes"),
});

// Insert schemas - OLD SCHEMA (for backwards compatibility)
export const insertProductTypeSchema = createInsertSchema(productTypes).omit({ id: true });
export const insertProductSchema = createInsertSchema(products).omit({ id: true });
export const insertInventoryAdjustmentSchema = createInsertSchema(inventoryAdjustments).omit({ id: true, createdAt: true });
export const insertWholesalePricingSchema = createInsertSchema(wholesalePricing).omit({ id: true });

// Insert schemas - NEW SCHEMA (for migration)
export const insertFlavorSchema = createInsertSchema(flavors).omit({ id: true });
export const insertRetailProductSchema = createInsertSchema(retailProducts).omit({ id: true });
export const insertRetailProductFlavorSchema = createInsertSchema(retailProductFlavors).omit({ id: true });
export const insertWholesaleUnitTypeSchema = createInsertSchema(wholesaleUnitTypes).omit({ id: true });
export const insertWholesaleUnitTypeFlavorSchema = createInsertSchema(wholesaleUnitTypeFlavors).omit({ id: true });
export const insertWholesaleCustomerPricingSchema = createInsertSchema(wholesaleCustomerPricing).omit({ id: true });
export const insertRetailCartItemSchema = createInsertSchema(retailCartItems).omit({ id: true });
export const insertRetailOrderItemV2Schema = createInsertSchema(retailOrderItemsV2).omit({ id: true });
export const insertRetailSubscriptionSchema = createInsertSchema(retailSubscriptions).omit({ id: true, startDate: true, cancelledAt: true });
export const insertRetailSubscriptionItemSchema = createInsertSchema(retailSubscriptionItems).omit({ id: true });

// Insert schemas - COMMON (used by both old and new)
export const insertUserSchema = createInsertSchema(users).omit({ id: true, createdAt: true, updatedAt: true, isAdmin: true, role: true });
export const insertSubscriptionPlanSchema = createInsertSchema(subscriptionPlans).omit({ id: true });
export const insertCartItemSchema = createInsertSchema(cartItems).omit({ id: true });
export const insertSubscriptionSchema = createInsertSchema(subscriptions).omit({ id: true, startDate: true, cancelledAt: true });
export const insertSubscriptionItemSchema = createInsertSchema(subscriptionItems).omit({ id: true });
export const insertRetailCheckoutSessionSchema = createInsertSchema(retailCheckoutSessions).omit({ id: true, createdAt: true });
export const insertRetailOrderSchema = createInsertSchema(retailOrders).omit({ id: true, orderDate: true, fulfilledAt: true });
export const insertRetailOrderItemSchema = createInsertSchema(retailOrderItems).omit({ id: true });
export const insertWholesaleCustomerSchema = createInsertSchema(wholesaleCustomers).omit({ id: true });
export const insertWholesaleLocationSchema = createInsertSchema(wholesaleLocations).omit({ id: true, createdAt: true, geocodedAt: true });
export const insertDeliveryStopSchema = createInsertSchema(deliveryStops).omit({ id: true, createdAt: true, geocodedAt: true, latitude: true, longitude: true, createdByUserId: true });
export const insertDeliveryRouteSchema = createInsertSchema(deliveryRoutes).omit({ id: true, generatedAt: true });
export const insertDeliveryRouteStopSchema = createInsertSchema(deliveryRouteStops).omit({ id: true });
export const insertWholesaleOrderSchema = createInsertSchema(wholesaleOrders).omit({ id: true, orderDate: true, fulfilledAt: true });
export const insertWholesaleOrderItemSchema = createInsertSchema(wholesaleOrderItems).omit({ id: true });
export const insertVerificationCodeSchema = createInsertSchema(verificationCodes).omit({ id: true, createdAt: true });
export const insertEmailVerificationCodeSchema = createInsertSchema(emailVerificationCodes).omit({ id: true, createdAt: true, consumedAt: true });
export const insertImpersonationLogSchema = createInsertSchema(impersonationLogs).omit({ id: true, startedAt: true });
export const insertLeadSchema = createInsertSchema(leads).omit({ id: true, createdAt: true, updatedAt: true });
export const insertLeadTouchPointSchema = createInsertSchema(leadTouchPoints).omit({ id: true, createdAt: true });

// Insert schemas - ACCOUNTING MODULE
export const insertPlaidItemSchema = createInsertSchema(plaidItems).omit({ id: true, createdAt: true, updatedAt: true });
export const insertPlaidAccountSchema = createInsertSchema(plaidAccounts).omit({ id: true });
export const insertAccountingCategorySchema = createInsertSchema(accountingCategories).omit({ id: true, createdAt: true });
export const insertAccountingTransactionSchema = createInsertSchema(accountingTransactions).omit({ id: true, createdAt: true });
export const insertTransactionAllocationSchema = createInsertSchema(transactionAllocations).omit({ id: true, createdAt: true });

// Insert schemas - ADMIN TASKS
export const insertAdminTaskSchema = createInsertSchema(adminTasks).omit({ id: true, createdAt: true });
export const insertAdminTaskCompletionSchema = createInsertSchema(adminTaskCompletions).omit({ id: true, completedAt: true });

// Update profile schema - allows customers to update their contact information
export const updateProfileSchema = z.object({
  firstName: z.string().min(1, "First name is required").optional(),
  lastName: z.string().min(1, "Last name is required").optional(),
  email: z.string().email("Invalid email address").optional(),
  phoneNumber: z.string().min(10, "Phone number must be at least 10 digits").optional(),
});

// Insert types - OLD SCHEMA
export type InsertProductType = z.infer<typeof insertProductTypeSchema>;
export type InsertProduct = z.infer<typeof insertProductSchema>;
export type InsertInventoryAdjustment = z.infer<typeof insertInventoryAdjustmentSchema>;
export type InsertWholesalePricing = z.infer<typeof insertWholesalePricingSchema>;

// Insert types - NEW SCHEMA
export type InsertFlavor = z.infer<typeof insertFlavorSchema>;
export type InsertRetailProduct = z.infer<typeof insertRetailProductSchema>;
export type InsertRetailProductFlavor = z.infer<typeof insertRetailProductFlavorSchema>;
export type InsertWholesaleUnitType = z.infer<typeof insertWholesaleUnitTypeSchema>;
export type InsertWholesaleUnitTypeFlavor = z.infer<typeof insertWholesaleUnitTypeFlavorSchema>;
export type InsertWholesaleCustomerPricing = z.infer<typeof insertWholesaleCustomerPricingSchema>;
export type InsertRetailCartItem = z.infer<typeof insertRetailCartItemSchema>;
export type InsertRetailOrderItemV2 = z.infer<typeof insertRetailOrderItemV2Schema>;
export type InsertRetailSubscription = z.infer<typeof insertRetailSubscriptionSchema>;
export type InsertRetailSubscriptionItem = z.infer<typeof insertRetailSubscriptionItemSchema>;

// Insert types - COMMON
export type InsertUser = z.infer<typeof insertUserSchema>;
export type InsertSubscriptionPlan = z.infer<typeof insertSubscriptionPlanSchema>;
export type InsertCartItem = z.infer<typeof insertCartItemSchema>;
export type InsertSubscription = z.infer<typeof insertSubscriptionSchema>;
export type InsertSubscriptionItem = z.infer<typeof insertSubscriptionItemSchema>;
export type InsertRetailCheckoutSession = z.infer<typeof insertRetailCheckoutSessionSchema>;
export type InsertRetailOrder = z.infer<typeof insertRetailOrderSchema>;
export type InsertRetailOrderItem = z.infer<typeof insertRetailOrderItemSchema>;
export type InsertWholesaleCustomer = z.infer<typeof insertWholesaleCustomerSchema>;
export type InsertWholesaleLocation = z.infer<typeof insertWholesaleLocationSchema>;
export type InsertDeliveryStop = z.infer<typeof insertDeliveryStopSchema>;
export type InsertDeliveryRoute = z.infer<typeof insertDeliveryRouteSchema>;
export type InsertDeliveryRouteStop = z.infer<typeof insertDeliveryRouteStopSchema>;
export type InsertWholesaleOrder = z.infer<typeof insertWholesaleOrderSchema>;
export type InsertWholesaleOrderItem = z.infer<typeof insertWholesaleOrderItemSchema>;
export type InsertVerificationCode = z.infer<typeof insertVerificationCodeSchema>;
export type InsertEmailVerificationCode = z.infer<typeof insertEmailVerificationCodeSchema>;
export type InsertImpersonationLog = z.infer<typeof insertImpersonationLogSchema>;
export type InsertLead = z.infer<typeof insertLeadSchema>;
export type InsertLeadTouchPoint = z.infer<typeof insertLeadTouchPointSchema>;
export type UpdateProfile = z.infer<typeof updateProfileSchema>;

// Insert types - ACCOUNTING MODULE
export type InsertPlaidItem = z.infer<typeof insertPlaidItemSchema>;
export type InsertPlaidAccount = z.infer<typeof insertPlaidAccountSchema>;
export type InsertAccountingCategory = z.infer<typeof insertAccountingCategorySchema>;
export type InsertAccountingTransaction = z.infer<typeof insertAccountingTransactionSchema>;
export type InsertTransactionAllocation = z.infer<typeof insertTransactionAllocationSchema>;

// Insert types - ADMIN TASKS
export type InsertAdminTask = z.infer<typeof insertAdminTaskSchema>;
export type InsertAdminTaskCompletion = z.infer<typeof insertAdminTaskCompletionSchema>;

// Select types - OLD SCHEMA
export type ProductType = typeof productTypes.$inferSelect;
export type Product = typeof products.$inferSelect;
export type InventoryAdjustment = typeof inventoryAdjustments.$inferSelect;
export type WholesalePricing = typeof wholesalePricing.$inferSelect;

// Select types - NEW SCHEMA
export type Flavor = typeof flavors.$inferSelect;
export type RetailProduct = typeof retailProducts.$inferSelect;
export type WholesaleUnitType = typeof wholesaleUnitTypes.$inferSelect;
export type WholesaleUnitTypeFlavor = typeof wholesaleUnitTypeFlavors.$inferSelect;
export type WholesaleCustomerPricing = typeof wholesaleCustomerPricing.$inferSelect;
export type RetailCartItem = typeof retailCartItems.$inferSelect;
export type RetailOrderItemV2 = typeof retailOrderItemsV2.$inferSelect;
export type RetailSubscription = typeof retailSubscriptions.$inferSelect;
export type RetailSubscriptionItem = typeof retailSubscriptionItems.$inferSelect;

// Select types - COMMON
export type User = typeof users.$inferSelect;
export type SubscriptionPlan = typeof subscriptionPlans.$inferSelect;
export type CartItem = typeof cartItems.$inferSelect;
export type Subscription = typeof subscriptions.$inferSelect;
export type SubscriptionItem = typeof subscriptionItems.$inferSelect;
export type RetailCheckoutSession = typeof retailCheckoutSessions.$inferSelect;
export type RetailOrder = typeof retailOrders.$inferSelect;
export type RetailOrderItem = typeof retailOrderItems.$inferSelect;
export type WholesaleCustomer = typeof wholesaleCustomers.$inferSelect;
export type WholesaleLocation = typeof wholesaleLocations.$inferSelect;
export type DeliveryStop = typeof deliveryStops.$inferSelect;
export type DeliveryRoute = typeof deliveryRoutes.$inferSelect;
export type DeliveryRouteStop = typeof deliveryRouteStops.$inferSelect;
export type WholesaleOrder = typeof wholesaleOrders.$inferSelect;
export type WholesaleOrderItem = typeof wholesaleOrderItems.$inferSelect;
export type VerificationCode = typeof verificationCodes.$inferSelect;
export type EmailVerificationCode = typeof emailVerificationCodes.$inferSelect;
export type ImpersonationLog = typeof impersonationLogs.$inferSelect;
export type Lead = typeof leads.$inferSelect;
export type LeadTouchPoint = typeof leadTouchPoints.$inferSelect;

// Select types - ACCOUNTING MODULE
export type PlaidItem = typeof plaidItems.$inferSelect;
export type PlaidAccount = typeof plaidAccounts.$inferSelect;
export type AccountingCategory = typeof accountingCategories.$inferSelect;
export type AccountingTransaction = typeof accountingTransactions.$inferSelect;
export type TransactionAllocation = typeof transactionAllocations.$inferSelect;

// Select types - ADMIN TASKS
export type AdminTask = typeof adminTasks.$inferSelect;
export type AdminTaskCompletion = typeof adminTaskCompletions.$inferSelect;

// Select types - SITE SETTINGS
export type SiteSetting = typeof siteSettings.$inferSelect;
