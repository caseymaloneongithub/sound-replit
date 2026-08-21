CREATE TABLE "accounting_categories" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"code" text,
	"description" text,
	"color" text,
	"parent_id" varchar,
	"display_order" integer DEFAULT 0 NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"exclude_from_reports" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "accounting_transactions" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"plaid_account_id" varchar,
	"transaction_id" text,
	"date" timestamp NOT NULL,
	"name" text NOT NULL,
	"merchant_name" text,
	"amount" numeric(12, 2) NOT NULL,
	"category" text,
	"category_detailed" text,
	"pending" boolean DEFAULT false NOT NULL,
	"payment_channel" text,
	"status" text DEFAULT 'active' NOT NULL,
	"is_manual_import" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "accounting_transactions_transaction_id_unique" UNIQUE("transaction_id")
);
--> statement-breakpoint
CREATE TABLE "admin_task_completions" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" varchar NOT NULL,
	"completed_by_user_id" varchar,
	"completed_at" timestamp DEFAULT now() NOT NULL,
	"instance_date" timestamp NOT NULL,
	"notes" text
);
--> statement-breakpoint
CREATE TABLE "admin_tasks" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"category" text,
	"recurrence" text DEFAULT 'weekly' NOT NULL,
	"day_of_week" integer,
	"day_of_month" integer,
	"month_of_year" integer,
	"start_date" timestamp,
	"end_date" timestamp,
	"assigned_to_user_id" varchar,
	"created_by_user_id" varchar,
	"is_active" boolean DEFAULT true NOT NULL,
	"display_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cart_items" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" text NOT NULL,
	"product_id" varchar NOT NULL,
	"quantity" integer DEFAULT 1 NOT NULL,
	"is_subscription" boolean DEFAULT false NOT NULL,
	"subscription_frequency" text
);
--> statement-breakpoint
CREATE TABLE "delivery_route_stops" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"route_id" varchar NOT NULL,
	"stop_order" integer NOT NULL,
	"stop_type" text NOT NULL,
	"wholesale_order_id" varchar,
	"delivery_stop_id" varchar,
	"arrival_estimate" timestamp,
	"distance_from_previous" integer,
	"duration_from_previous" integer
);
--> statement-breakpoint
CREATE TABLE "delivery_routes" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"route_date" timestamp NOT NULL,
	"total_distance_meters" integer,
	"total_duration_seconds" integer,
	"optimized_stops" text NOT NULL,
	"generated_at" timestamp DEFAULT now() NOT NULL,
	"generated_by_user_id" varchar
);
--> statement-breakpoint
CREATE TABLE "delivery_stops" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"address" text NOT NULL,
	"city" text NOT NULL,
	"state" text DEFAULT 'WA' NOT NULL,
	"zip_code" text NOT NULL,
	"notes" text,
	"latitude" numeric(10, 7),
	"longitude" numeric(10, 7),
	"geocoded_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"created_by_user_id" varchar
);
--> statement-breakpoint
CREATE TABLE "email_verification_codes" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" varchar NOT NULL,
	"code" varchar(6) NOT NULL,
	"purpose" text DEFAULT 'login' NOT NULL,
	"wholesale_customer_id" varchar,
	"login_token" varchar,
	"expires_at" timestamp NOT NULL,
	"verified" boolean DEFAULT false NOT NULL,
	"consumed_at" timestamp,
	"attempts" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "flavors" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"description" text NOT NULL,
	"flavor_profile" text NOT NULL,
	"ingredients" text[] NOT NULL,
	"primary_image_url" text,
	"secondary_image_url" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"display_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "impersonation_logs" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"admin_user_id" varchar NOT NULL,
	"impersonated_user_id" varchar NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"started_at" timestamp DEFAULT now() NOT NULL,
	"ended_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "inventory_adjustments" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" varchar NOT NULL,
	"quantity" integer NOT NULL,
	"reason" text NOT NULL,
	"staff_user_id" varchar,
	"order_id" varchar,
	"order_type" text,
	"batch_metadata" text,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lead_touch_points" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lead_id" varchar NOT NULL,
	"type" text NOT NULL,
	"subject" text NOT NULL,
	"notes" text,
	"created_by_user_id" varchar NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "leads" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_name" text NOT NULL,
	"contact_name" text NOT NULL,
	"email" varchar,
	"phone" varchar,
	"priority_level" text DEFAULT 'medium' NOT NULL,
	"status" text DEFAULT 'new' NOT NULL,
	"notes" text,
	"assigned_to_user_id" varchar,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "material_orders" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"supplier_id" varchar NOT NULL,
	"date_ordered" timestamp DEFAULT now() NOT NULL,
	"date_delivered" timestamp,
	"cost" numeric(12, 2) DEFAULT '0' NOT NULL,
	"notes" text,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "materials" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"unit" text NOT NULL,
	"cost" numeric(12, 4) DEFAULT '0' NOT NULL,
	"supplier_id" varchar,
	"order_size" numeric(14, 4) DEFAULT '0' NOT NULL,
	"stock" numeric(14, 4) DEFAULT '0' NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"deleted_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "order_materials" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" varchar NOT NULL,
	"material_id" varchar NOT NULL,
	"units" numeric(16, 6) NOT NULL,
	"delivered" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "password_reset_tokens" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL,
	"token" varchar(64) NOT NULL,
	"expires_at" timestamp NOT NULL,
	"used" boolean DEFAULT false NOT NULL,
	"used_at" timestamp,
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "password_reset_tokens_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "plaid_accounts" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"plaid_item_id" varchar NOT NULL,
	"account_id" text NOT NULL,
	"name" text NOT NULL,
	"official_name" text,
	"mask" text,
	"account_type" text,
	"subtype" text,
	"is_active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "plaid_accounts_account_id_unique" UNIQUE("account_id")
);
--> statement-breakpoint
CREATE TABLE "plaid_items" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"access_token" text NOT NULL,
	"item_id" text NOT NULL,
	"institution_id" text,
	"institution_name" text,
	"status" text DEFAULT 'good',
	"cursor" text,
	"last_synced_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "plaid_items_item_id_unique" UNIQUE("item_id")
);
--> statement-breakpoint
CREATE TABLE "process_materials" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"process_id" varchar NOT NULL,
	"material_id" varchar NOT NULL,
	"units" numeric(16, 6) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "processes" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"unit" text NOT NULL,
	"standard_batch" numeric(14, 4) DEFAULT '0' NOT NULL,
	"flavor_id" varchar,
	"finished_product_id" varchar,
	"created_at" timestamp DEFAULT now(),
	"deleted_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "product_types" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"description" text NOT NULL,
	"retail_price" numeric(10, 2) NOT NULL,
	"wholesale_price" numeric(10, 2) NOT NULL,
	"unit_type" text DEFAULT 'case' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "productions" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"process_id" varchar NOT NULL,
	"units" numeric(14, 4) NOT NULL,
	"date" timestamp DEFAULT now() NOT NULL,
	"notes" text,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "products" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_type_id" varchar NOT NULL,
	"name" text NOT NULL,
	"description" text NOT NULL,
	"flavor" text NOT NULL,
	"ingredients" text[] NOT NULL,
	"image_url" text NOT NULL,
	"image_urls" text[] DEFAULT ARRAY[]::text[] NOT NULL,
	"in_stock" boolean DEFAULT true NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"stock_quantity" integer DEFAULT 0 NOT NULL,
	"low_stock_threshold" integer DEFAULT 50 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "retail_cart_items" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" text NOT NULL,
	"retail_product_id" varchar NOT NULL,
	"selected_flavor_id" varchar,
	"quantity" integer DEFAULT 1 NOT NULL,
	"is_subscription" boolean DEFAULT false NOT NULL,
	"subscription_frequency" text
);
--> statement-breakpoint
CREATE TABLE "retail_checkout_sessions" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" text NOT NULL,
	"payment_intent_id" text,
	"customer_name" text NOT NULL,
	"customer_email" text NOT NULL,
	"customer_phone" text NOT NULL,
	"user_id" varchar,
	"tax_mode" text DEFAULT 'exclusive' NOT NULL,
	"tax_rate_bps" integer DEFAULT 1035 NOT NULL,
	"tax_amount_cents" integer DEFAULT 0 NOT NULL,
	"is_tax_exempt" boolean DEFAULT false NOT NULL,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "retail_order_items" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" varchar NOT NULL,
	"product_id" varchar NOT NULL,
	"quantity" integer NOT NULL,
	"unit_price" numeric(10, 2) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "retail_order_items_v2" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" varchar NOT NULL,
	"retail_product_id" varchar NOT NULL,
	"selected_flavor_id" varchar,
	"quantity" integer NOT NULL,
	"unit_price" numeric(10, 2) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "retail_orders" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_number" text NOT NULL,
	"user_id" varchar,
	"customer_name" text NOT NULL,
	"customer_email" text NOT NULL,
	"customer_phone" text NOT NULL,
	"order_date" timestamp DEFAULT now() NOT NULL,
	"pickup_date" timestamp,
	"status" text DEFAULT 'pending' NOT NULL,
	"subtotal" numeric(10, 2) NOT NULL,
	"tax_amount" numeric(10, 2) DEFAULT '0' NOT NULL,
	"deposit_amount" numeric(10, 2) DEFAULT '0' NOT NULL,
	"total_amount" numeric(10, 2) NOT NULL,
	"stripe_payment_intent_id" text,
	"stripe_checkout_session_id" text,
	"stripe_invoice_id" text,
	"is_subscription_order" boolean DEFAULT false NOT NULL,
	"deposit_refunded_at" timestamp,
	"deposit_refunded_by_user_id" varchar,
	"fulfilled_at" timestamp,
	"fulfilled_by_user_id" varchar,
	"notes" text,
	"updated_at" timestamp DEFAULT now(),
	"deleted_at" timestamp,
	CONSTRAINT "retail_orders_order_number_unique" UNIQUE("order_number"),
	CONSTRAINT "retail_orders_stripe_payment_intent_id_unique" UNIQUE("stripe_payment_intent_id"),
	CONSTRAINT "retail_orders_stripe_invoice_id_unique" UNIQUE("stripe_invoice_id")
);
--> statement-breakpoint
CREATE TABLE "retail_product_flavors" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"retail_product_id" varchar NOT NULL,
	"flavor_id" varchar NOT NULL,
	CONSTRAINT "retail_product_flavors_retail_product_id_flavor_id_unique" UNIQUE("retail_product_id","flavor_id")
);
--> statement-breakpoint
CREATE TABLE "retail_products" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_type" text DEFAULT 'single-flavor' NOT NULL,
	"product_name" text,
	"flavor_id" varchar,
	"unit_type" text NOT NULL,
	"unit_description" text NOT NULL,
	"price" numeric(10, 2) NOT NULL,
	"deposit" numeric(10, 2) DEFAULT '0.00' NOT NULL,
	"subscription_discount" numeric(5, 2) DEFAULT '10.00' NOT NULL,
	"product_image_url" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"display_order" integer DEFAULT 0 NOT NULL,
	"finished_product_id" varchar
);
--> statement-breakpoint
CREATE TABLE "retail_subscription_items" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"subscription_id" varchar NOT NULL,
	"retail_product_id" varchar NOT NULL,
	"selected_flavor_id" varchar,
	"quantity" integer DEFAULT 1 NOT NULL,
	"unit_price_at_signup" numeric(10, 2)
);
--> statement-breakpoint
CREATE TABLE "retail_subscriptions" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar,
	"customer_name" text NOT NULL,
	"customer_email" text NOT NULL,
	"customer_phone" text NOT NULL,
	"subscription_frequency" text NOT NULL,
	"stripe_subscription_id" text,
	"stripe_checkout_session_id" text,
	"stripe_customer_id" text,
	"stripe_payment_method_id" text,
	"status" text DEFAULT 'active' NOT NULL,
	"billing_type" text DEFAULT 'stripe_managed' NOT NULL,
	"billing_status" text DEFAULT 'active' NOT NULL,
	"next_charge_at" timestamp,
	"retry_count" integer DEFAULT 0 NOT NULL,
	"last_payment_intent_id" text,
	"last_refund_id" text,
	"last_refunded_at" timestamp,
	"processing_lock" boolean DEFAULT false NOT NULL,
	"processing_locked_at" timestamp,
	"start_date" timestamp DEFAULT now() NOT NULL,
	"next_delivery_date" timestamp,
	"cancelled_at" timestamp,
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "retail_subscriptions_stripe_checkout_session_id_unique" UNIQUE("stripe_checkout_session_id")
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"sid" varchar PRIMARY KEY NOT NULL,
	"sess" jsonb NOT NULL,
	"expire" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "site_settings" (
	"key" varchar PRIMARY KEY NOT NULL,
	"value" text NOT NULL,
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "subscription_items" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"subscription_id" varchar NOT NULL,
	"product_id" varchar NOT NULL,
	"quantity" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "subscription_plans" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"frequency" text NOT NULL,
	"bottle_count" integer NOT NULL,
	"price" numeric(10, 2) NOT NULL,
	"savings" text,
	"benefits" text[] NOT NULL,
	"stripe_price_id" text
);
--> statement-breakpoint
CREATE TABLE "subscriptions" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar,
	"customer_name" text NOT NULL,
	"customer_email" text NOT NULL,
	"customer_phone" text NOT NULL,
	"plan_id" varchar,
	"product_id" varchar,
	"subscription_frequency" text,
	"stripe_subscription_id" text,
	"stripe_checkout_session_id" text,
	"stripe_customer_id" text,
	"stripe_payment_method_id" text,
	"status" text DEFAULT 'active' NOT NULL,
	"billing_type" text DEFAULT 'stripe_managed' NOT NULL,
	"billing_status" text DEFAULT 'active' NOT NULL,
	"next_charge_at" timestamp,
	"retry_count" integer DEFAULT 0 NOT NULL,
	"last_payment_intent_id" text,
	"last_refund_id" text,
	"last_refunded_at" timestamp,
	"processing_lock" boolean DEFAULT false NOT NULL,
	"start_date" timestamp DEFAULT now() NOT NULL,
	"next_delivery_date" timestamp,
	"cancelled_at" timestamp,
	CONSTRAINT "subscriptions_stripe_checkout_session_id_unique" UNIQUE("stripe_checkout_session_id")
);
--> statement-breakpoint
CREATE TABLE "suppliers" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"website" text,
	"email" varchar,
	"lead_time_days" integer DEFAULT 14 NOT NULL,
	"notes" text,
	"created_at" timestamp DEFAULT now(),
	"deleted_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "transaction_allocations" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"transaction_id" varchar NOT NULL,
	"category_id" varchar NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"username" varchar NOT NULL,
	"password" text,
	"email" varchar,
	"phone_number" varchar,
	"first_name" varchar,
	"last_name" varchar,
	"address" text,
	"city" text,
	"state" text,
	"zip_code" text,
	"role" text DEFAULT 'user' NOT NULL,
	"is_admin" boolean DEFAULT false NOT NULL,
	"stripe_customer_id" text,
	"wholesale_customer_id" varchar,
	"profile_image_url" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	"deleted_at" timestamp,
	CONSTRAINT "users_username_unique" UNIQUE("username")
);
--> statement-breakpoint
CREATE TABLE "verification_codes" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"phone_number" varchar NOT NULL,
	"code" varchar(6) NOT NULL,
	"purpose" text DEFAULT 'registration' NOT NULL,
	"expires_at" timestamp NOT NULL,
	"verified" boolean DEFAULT false NOT NULL,
	"consumed_at" timestamp,
	"attempts" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "wholesale_customer_pricing" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"customer_id" varchar NOT NULL,
	"unit_type_id" varchar NOT NULL,
	"custom_price" numeric(10, 2) NOT NULL,
	CONSTRAINT "wholesale_customer_pricing_customer_id_unit_type_id_unique" UNIQUE("customer_id","unit_type_id")
);
--> statement-breakpoint
CREATE TABLE "wholesale_customers" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar,
	"business_name" text NOT NULL,
	"contact_name" text NOT NULL,
	"email" text NOT NULL,
	"emails" text[] DEFAULT ARRAY[]::text[] NOT NULL,
	"phone" text NOT NULL,
	"allow_online_payment" boolean DEFAULT true NOT NULL,
	CONSTRAINT "wholesale_customers_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "wholesale_locations" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"customer_id" varchar NOT NULL,
	"location_name" text NOT NULL,
	"address" text NOT NULL,
	"city" text NOT NULL,
	"state" text DEFAULT 'WA' NOT NULL,
	"zip_code" text NOT NULL,
	"contact_name" text,
	"contact_phone" text,
	"delivery_instructions" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"latitude" numeric(10, 7),
	"longitude" numeric(10, 7),
	"geocoded_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "wholesale_order_items" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" varchar NOT NULL,
	"product_id" varchar,
	"unit_type_id" varchar,
	"flavor_id" varchar,
	"quantity" integer NOT NULL,
	"unit_price" numeric(10, 2) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wholesale_orders" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"invoice_number" text NOT NULL,
	"customer_id" varchar NOT NULL,
	"location_id" varchar,
	"fulfillment_method" text DEFAULT 'delivery' NOT NULL,
	"order_date" timestamp DEFAULT now() NOT NULL,
	"delivery_date" timestamp,
	"status" text DEFAULT 'pending' NOT NULL,
	"total_amount" numeric(10, 2) NOT NULL,
	"fulfilled_at" timestamp,
	"fulfilled_by_user_id" varchar,
	"notes" text,
	"due_date" timestamp,
	"paid_at" timestamp,
	"paid_by_user_id" varchar,
	"payment_initiated_at" timestamp,
	"payment_failed_at" timestamp,
	"stripe_payment_intent_id" text,
	"invoice_sent_at" timestamp,
	"updated_at" timestamp DEFAULT now(),
	"deleted_at" timestamp,
	CONSTRAINT "wholesale_orders_invoice_number_unique" UNIQUE("invoice_number")
);
--> statement-breakpoint
CREATE TABLE "wholesale_pricing" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"customer_id" varchar NOT NULL,
	"product_type_id" varchar NOT NULL,
	"custom_price" numeric(10, 2) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wholesale_unit_type_flavors" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"unit_type_id" varchar NOT NULL,
	"flavor_id" varchar NOT NULL,
	CONSTRAINT "wholesale_unit_type_flavors_unit_type_id_flavor_id_unique" UNIQUE("unit_type_id","flavor_id")
);
--> statement-breakpoint
CREATE TABLE "wholesale_unit_types" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"unit_type" text NOT NULL,
	"description" text NOT NULL,
	"default_price" numeric(10, 2) NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"display_order" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "wholesale_unit_types_unit_type_unique" UNIQUE("unit_type")
);
--> statement-breakpoint
ALTER TABLE "accounting_transactions" ADD CONSTRAINT "accounting_transactions_plaid_account_id_plaid_accounts_id_fk" FOREIGN KEY ("plaid_account_id") REFERENCES "public"."plaid_accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admin_task_completions" ADD CONSTRAINT "admin_task_completions_task_id_admin_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."admin_tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admin_task_completions" ADD CONSTRAINT "admin_task_completions_completed_by_user_id_users_id_fk" FOREIGN KEY ("completed_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admin_tasks" ADD CONSTRAINT "admin_tasks_assigned_to_user_id_users_id_fk" FOREIGN KEY ("assigned_to_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admin_tasks" ADD CONSTRAINT "admin_tasks_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cart_items" ADD CONSTRAINT "cart_items_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_route_stops" ADD CONSTRAINT "delivery_route_stops_route_id_delivery_routes_id_fk" FOREIGN KEY ("route_id") REFERENCES "public"."delivery_routes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_route_stops" ADD CONSTRAINT "delivery_route_stops_wholesale_order_id_wholesale_orders_id_fk" FOREIGN KEY ("wholesale_order_id") REFERENCES "public"."wholesale_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_route_stops" ADD CONSTRAINT "delivery_route_stops_delivery_stop_id_delivery_stops_id_fk" FOREIGN KEY ("delivery_stop_id") REFERENCES "public"."delivery_stops"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_routes" ADD CONSTRAINT "delivery_routes_generated_by_user_id_users_id_fk" FOREIGN KEY ("generated_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_stops" ADD CONSTRAINT "delivery_stops_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "impersonation_logs" ADD CONSTRAINT "impersonation_logs_admin_user_id_users_id_fk" FOREIGN KEY ("admin_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "impersonation_logs" ADD CONSTRAINT "impersonation_logs_impersonated_user_id_users_id_fk" FOREIGN KEY ("impersonated_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_adjustments" ADD CONSTRAINT "inventory_adjustments_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_adjustments" ADD CONSTRAINT "inventory_adjustments_staff_user_id_users_id_fk" FOREIGN KEY ("staff_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_touch_points" ADD CONSTRAINT "lead_touch_points_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_touch_points" ADD CONSTRAINT "lead_touch_points_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_assigned_to_user_id_users_id_fk" FOREIGN KEY ("assigned_to_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_orders" ADD CONSTRAINT "material_orders_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "materials" ADD CONSTRAINT "materials_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_materials" ADD CONSTRAINT "order_materials_order_id_material_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."material_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_materials" ADD CONSTRAINT "order_materials_material_id_materials_id_fk" FOREIGN KEY ("material_id") REFERENCES "public"."materials"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "password_reset_tokens" ADD CONSTRAINT "password_reset_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plaid_accounts" ADD CONSTRAINT "plaid_accounts_plaid_item_id_plaid_items_id_fk" FOREIGN KEY ("plaid_item_id") REFERENCES "public"."plaid_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "process_materials" ADD CONSTRAINT "process_materials_process_id_processes_id_fk" FOREIGN KEY ("process_id") REFERENCES "public"."processes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "process_materials" ADD CONSTRAINT "process_materials_material_id_materials_id_fk" FOREIGN KEY ("material_id") REFERENCES "public"."materials"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "processes" ADD CONSTRAINT "processes_flavor_id_flavors_id_fk" FOREIGN KEY ("flavor_id") REFERENCES "public"."flavors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "processes" ADD CONSTRAINT "processes_finished_product_id_products_id_fk" FOREIGN KEY ("finished_product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "productions" ADD CONSTRAINT "productions_process_id_processes_id_fk" FOREIGN KEY ("process_id") REFERENCES "public"."processes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_product_type_id_product_types_id_fk" FOREIGN KEY ("product_type_id") REFERENCES "public"."product_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retail_cart_items" ADD CONSTRAINT "retail_cart_items_retail_product_id_retail_products_id_fk" FOREIGN KEY ("retail_product_id") REFERENCES "public"."retail_products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retail_cart_items" ADD CONSTRAINT "retail_cart_items_selected_flavor_id_flavors_id_fk" FOREIGN KEY ("selected_flavor_id") REFERENCES "public"."flavors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retail_checkout_sessions" ADD CONSTRAINT "retail_checkout_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retail_order_items" ADD CONSTRAINT "retail_order_items_order_id_retail_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."retail_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retail_order_items" ADD CONSTRAINT "retail_order_items_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retail_order_items_v2" ADD CONSTRAINT "retail_order_items_v2_order_id_retail_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."retail_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retail_order_items_v2" ADD CONSTRAINT "retail_order_items_v2_retail_product_id_retail_products_id_fk" FOREIGN KEY ("retail_product_id") REFERENCES "public"."retail_products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retail_order_items_v2" ADD CONSTRAINT "retail_order_items_v2_selected_flavor_id_flavors_id_fk" FOREIGN KEY ("selected_flavor_id") REFERENCES "public"."flavors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retail_orders" ADD CONSTRAINT "retail_orders_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retail_orders" ADD CONSTRAINT "retail_orders_deposit_refunded_by_user_id_users_id_fk" FOREIGN KEY ("deposit_refunded_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retail_orders" ADD CONSTRAINT "retail_orders_fulfilled_by_user_id_users_id_fk" FOREIGN KEY ("fulfilled_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retail_product_flavors" ADD CONSTRAINT "retail_product_flavors_retail_product_id_retail_products_id_fk" FOREIGN KEY ("retail_product_id") REFERENCES "public"."retail_products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retail_product_flavors" ADD CONSTRAINT "retail_product_flavors_flavor_id_flavors_id_fk" FOREIGN KEY ("flavor_id") REFERENCES "public"."flavors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retail_products" ADD CONSTRAINT "retail_products_flavor_id_flavors_id_fk" FOREIGN KEY ("flavor_id") REFERENCES "public"."flavors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retail_products" ADD CONSTRAINT "retail_products_finished_product_id_products_id_fk" FOREIGN KEY ("finished_product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retail_subscription_items" ADD CONSTRAINT "retail_subscription_items_subscription_id_retail_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."retail_subscriptions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retail_subscription_items" ADD CONSTRAINT "retail_subscription_items_retail_product_id_retail_products_id_fk" FOREIGN KEY ("retail_product_id") REFERENCES "public"."retail_products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retail_subscription_items" ADD CONSTRAINT "retail_subscription_items_selected_flavor_id_flavors_id_fk" FOREIGN KEY ("selected_flavor_id") REFERENCES "public"."flavors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retail_subscriptions" ADD CONSTRAINT "retail_subscriptions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription_items" ADD CONSTRAINT "subscription_items_subscription_id_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."subscriptions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription_items" ADD CONSTRAINT "subscription_items_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_plan_id_subscription_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."subscription_plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction_allocations" ADD CONSTRAINT "transaction_allocations_transaction_id_accounting_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."accounting_transactions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction_allocations" ADD CONSTRAINT "transaction_allocations_category_id_accounting_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."accounting_categories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wholesale_customer_pricing" ADD CONSTRAINT "wholesale_customer_pricing_customer_id_wholesale_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."wholesale_customers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wholesale_customer_pricing" ADD CONSTRAINT "wholesale_customer_pricing_unit_type_id_wholesale_unit_types_id_fk" FOREIGN KEY ("unit_type_id") REFERENCES "public"."wholesale_unit_types"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wholesale_customers" ADD CONSTRAINT "wholesale_customers_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wholesale_locations" ADD CONSTRAINT "wholesale_locations_customer_id_wholesale_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."wholesale_customers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wholesale_order_items" ADD CONSTRAINT "wholesale_order_items_order_id_wholesale_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."wholesale_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wholesale_order_items" ADD CONSTRAINT "wholesale_order_items_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wholesale_order_items" ADD CONSTRAINT "wholesale_order_items_unit_type_id_wholesale_unit_types_id_fk" FOREIGN KEY ("unit_type_id") REFERENCES "public"."wholesale_unit_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wholesale_order_items" ADD CONSTRAINT "wholesale_order_items_flavor_id_flavors_id_fk" FOREIGN KEY ("flavor_id") REFERENCES "public"."flavors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wholesale_orders" ADD CONSTRAINT "wholesale_orders_customer_id_wholesale_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."wholesale_customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wholesale_orders" ADD CONSTRAINT "wholesale_orders_location_id_wholesale_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."wholesale_locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wholesale_orders" ADD CONSTRAINT "wholesale_orders_fulfilled_by_user_id_users_id_fk" FOREIGN KEY ("fulfilled_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wholesale_orders" ADD CONSTRAINT "wholesale_orders_paid_by_user_id_users_id_fk" FOREIGN KEY ("paid_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wholesale_pricing" ADD CONSTRAINT "wholesale_pricing_customer_id_wholesale_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."wholesale_customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wholesale_pricing" ADD CONSTRAINT "wholesale_pricing_product_type_id_product_types_id_fk" FOREIGN KEY ("product_type_id") REFERENCES "public"."product_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wholesale_unit_type_flavors" ADD CONSTRAINT "wholesale_unit_type_flavors_unit_type_id_wholesale_unit_types_id_fk" FOREIGN KEY ("unit_type_id") REFERENCES "public"."wholesale_unit_types"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wholesale_unit_type_flavors" ADD CONSTRAINT "wholesale_unit_type_flavors_flavor_id_flavors_id_fk" FOREIGN KEY ("flavor_id") REFERENCES "public"."flavors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "accounting_transactions_date_idx" ON "accounting_transactions" USING btree ("date");--> statement-breakpoint
CREATE INDEX "accounting_transactions_account_idx" ON "accounting_transactions" USING btree ("plaid_account_id");--> statement-breakpoint
CREATE INDEX "accounting_transactions_status_idx" ON "accounting_transactions" USING btree ("status");--> statement-breakpoint
CREATE INDEX "active_impersonation_idx" ON "impersonation_logs" USING btree ("admin_user_id") WHERE "impersonation_logs"."ended_at" IS NULL;