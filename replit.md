# Puget Sound Kombucha Co. - Craft Kombucha E-commerce Platform

## Overview

Puget Sound Kombucha Co. is a full-stack e-commerce web application for a Pacific Northwest kombucha brewery. The platform supports retail product and subscription purchases, and wholesale orders for business clients. Key capabilities include product browsing, subscription management, Stripe payment integration, comprehensive inventory tracking, retail and wholesale order tracking with fulfillment management, wholesale customer management, delivery scheduling, daily delivery reporting, and an admin dashboard. The business aims to provide a seamless online experience for purchasing artisanal kombucha, expanding market reach, and streamlining B2B operations.

## 🚧 Active Development (Nov 2024)

**Status:** Phase 5 Complete - Retail Subscription Billing System Implemented

### ✅ SECURITY FIX COMPLETED (Nov 18, 2024)

**Payment Verification Race Condition - RESOLVED:**
A critical race condition in webhook payment verification has been fixed. The webhook now uses database transaction locking and stored tax metadata to prevent tampering and race conditions.

**Implemented Security Measures:**
1. ✅ **Transaction-Aware Cart Fetching**: Cart queries moved inside DB transaction with `FOR UPDATE` row locks
2. ✅ **Dynamic Tax Verification**: Uses stored tax metadata from checkout session instead of hard-coded rates
3. ✅ **Comprehensive Amount Verification**: Stripe amounts verified against recomputed totals using locked, consistent data
4. ✅ **Atomic Transaction Flow**: Complete BEGIN → lock → verify → persist → COMMIT flow prevents interleaving

**Technical Implementation:**
- Added tax metadata fields to `retail_checkout_sessions` table (tax_mode, tax_rate_bps, tax_amount_cents, is_tax_exempt)
- Extended `IStorage.getCartItems()` and `IStorage.getRetailCart()` with optional `client` parameter for transaction-aware locking
- Updated `/api/checkout/customer-info` to fetch and store tax metadata from payment intent
- Rewrote webhook payment verification to use `SELECT ... FOR UPDATE` locks on all cart and session data
- Tax rate stored in basis points (1035 = 10.35%) for precision, converted to decimal for calculations

**Security Guarantees:**
- ✅ No race conditions: All data fetched with FOR UPDATE locks inside transaction
- ✅ No tampering: Cart prices recomputed server-side from locked data
- ✅ Dynamic tax verification: Uses stored rate from checkout session, not hardcoded constant
- ✅ Atomic operations: Complete transaction flow from lock to commit
- ✅ Idempotency: Unique constraint prevents duplicate orders

**Production Readiness:** Payment processing is now secure for production use. Webhook verification requires proper Stripe webhook endpoint configuration (automatic in production, requires Stripe CLI for local development).

The application has completed the retail product offering functionality as part of the migration to completely separate retail and wholesale product management with centrally-managed flavors. Both old and new schemas coexist to allow incremental development without downtime.

**Completed:**
- Phase 1: Parallel schema with flavors, retail products, and wholesale unit types
- Phase 2: Admin UI for Flavor Library and Wholesale Unit management
- Phase 3: Admin UI for Retail Product Offerings and Shop v2 integration
- Phase 4: Customer Order History with Reorder Functionality + Cart Drawer Dual-System Support
- Phase 5: Retail Subscription Billing System with Stripe Webhook Integration

**NEW SYSTEM OVERVIEW:**
- **Flavors**: Central library of kombucha flavors with images, descriptions, and ingredients
- **Retail Products**: Flavor + unit type combinations (e.g., "Mist 6-pack", "Cascade 12-pack") with individual prices
- **Wholesale Units**: Unit types with default pricing and flavor availability for B2B customers

**Key Endpoints:**
- `/api/flavors` - Flavor library management (GET, POST, PATCH, DELETE)
- `/api/retail-products` - Retail product offerings with subscription discount (GET, POST, PATCH, DELETE)
- `/api/wholesale-unit-types` - Wholesale unit management (GET, POST, PATCH, DELETE)
- `/api/cart` - Legacy cart system (GET, POST, PATCH, DELETE)
- `/api/retail-cart` - V2 cart system for retail products with subscription support (GET, POST, PATCH, DELETE)
- `/api/my-orders` - Customer order history with efficient 2-query data fetching (GET)
- `/api/orders/:id/reorder` - Reorder past orders with legacy product mapping (POST)
- Shop page: `/shop-v2` (uses new retail products with subscribe & save)
- Order history: `/my-orders` (displays order details with reorder capability)
- Admin pages: `/admin/flavors`, `/admin/retail-products`, `/admin/wholesale-units`

**Dual Cart System:**
- **Unified Cart Drawer**: During migration, the cart drawer queries both `/api/cart` (legacy) and `/api/retail-cart` (new system) simultaneously using the `useUnifiedCart` hook
- **Discriminated Union Types**: Cart items are tagged with `type: 'legacy'` or `type: 'retail_v2'` for safe type narrowing
- **Synchronized Mutations**: All cart mutations (add, update, remove) invalidate both cart query keys to keep the unified view fresh
- **Component Structure**: `UnifiedCartItemComponent` handles rendering for both cart item types with proper product data access patterns

**Subscribe & Save:**
- Configurable discount percentage per product (default 10%)
- Three subscription frequencies: weekly, bi-weekly, every-4-weeks
- Discounted price displayed in shop interface
- Automatic price calculation: basePrice * (1 - discountPercentage / 100)

**Retail Subscription Billing (NEW - Nov 19, 2024):**
- **Stripe-Managed Subscriptions**: Retail subscriptions use Stripe's native subscription billing (vs legacy locally-managed subscriptions)
- **Automatic Order Creation**: Webhook handler creates orders automatically when Stripe charges customers (invoice.payment_succeeded event)
- **Idempotency**: Unique constraints on stripeCheckoutSessionId and invoice-based order checks prevent duplicate subscriptions/orders
- **Storage Methods**: 6 new methods added to IStorage for retail subscription CRUD operations (getRetailSubscriptionByStripeId, createRetailSubscription, etc.)
- **Webhook Handlers**:
  - `checkout.session.completed`: Creates retail subscription record with items when customer completes checkout
  - `invoice.payment_succeeded`: Creates subscription renewal orders with discounted pricing, updates nextDeliveryDate
- **Database Tables**: retailSubscriptions (with stripeSubscriptionId, billingType, billingStatus, subscriptionFrequency, nextDeliveryDate) and retailSubscriptionItems
- **Dual System Support**: Webhooks handle both legacy and retail subscriptions seamlessly

**See MIGRATION_PLAN.md for detailed migration roadmap.**

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend

Built with React 18 and TypeScript, using Vite for development. Wouter handles routing, and Tailwind CSS with shadcn/ui provides styling. TanStack Query manages server state, and React Hook Form with Zod handles form validation. The design emphasizes a dual UX for retail and wholesale, responsive layouts, and accessibility. Retail-facing pages use "pickup" terminology, while wholesale operations use "delivery."

### Backend

Node.js with Express.js and TypeScript, following an ESM-first approach. It implements a RESTful API with session-based authentication using Passport.js and PostgreSQL-backed session storage. Drizzle ORM is used for type-safe PostgreSQL (Neon serverless) queries, following a schema-first approach with migrations.

### Core Features

-   **Case-Based Ordering**: All orders are for cases of 12 bottles. Pricing is stored per-case, with frontend logic displaying quantities in cases and bottles. Wholesale pricing supports custom overrides per customer.
-   **Authentication & Authorization**: Supports username/password, passwordless SMS code login (Twilio), and passwordless email code login (Gmail) via Passport.js. Registration requires SMS verification. A role-based authorization system defines 'user', 'wholesale_customer', 'staff', 'admin', and 'super_admin' levels with granular API route protection. Separate portals exist for retail, wholesale, and staff/admin, each with dedicated login pages. Password reset functionality is available via email.
-   **Wholesale Contact & Inquiries**: A public contact form is available for wholesale inquiries and general questions, featuring Zod validation and full keyboard accessibility.
-   **Payment Processing**: Stripe is integrated for one-time purchases (embedded checkout) and recurring subscriptions (Stripe Checkout Sessions). Webhooks handle payment confirmations and subscription lifecycle events. Sales tax (10.35%) is applied to retail one-time purchases only. **Security**: Payment webhook recomputes order totals server-side from cart items to prevent tampering - never trusts client-provided metadata.
-   **Retail Order Tracking**: Secure two-phase order creation workflow linked to Stripe payment webhooks. Orders have statuses (`pending` → `ready_for_pickup` → `fulfilled`/`cancelled`) managed by staff. Customers can view their complete order history at `/my-orders` with details including order items, totals, pickup dates, and status. A "Reorder" button enables one-click reordering of past orders, intelligently mapping legacy products to current retail offerings via flavor name and unit type matching.
-   **Subscription Management**: Supports multi-product subscriptions with flexible quantities. Customers can add/remove products, change delivery frequency, delay/advance pickups (with specific rules and cutoff times), cancel subscriptions, and update payment methods via Stripe Customer Portal integration. A local subscription billing system uses a daily cron job to charge customers via Stripe PaymentIntents, handling async payments, retries, and compensating rollbacks. Retail subscription pickups are restricted to Monday-Thursday (9am-3pm).
-   **Inventory Management System**: Staff can record production batches, increasing stock with an audit trail. All inventory updates use atomic PostgreSQL transactions with pessimistic locking. Fulfillment automatically deducts inventory.
-   **Flavor Library (NEW)**: Central repository of kombucha flavors with primary/secondary images, descriptions, flavor profiles, and ingredients. Images are served via `/public/:filename` endpoint to work around Replit Object Storage public access restrictions. Full-width image carousels display both images with navigation dots.
-   **Retail Product Offerings (NEW)**: Admin interface for creating retail products by linking flavors to unit types (6-pack, 12-pack, case, kegs) with specific prices. Each product includes a configurable subscription discount percentage (default 10%) for subscribe & save functionality. Products display on Shop v2 page grouped by unit type, filtered by active status, with flavor images and descriptions. Subscription options include weekly, bi-weekly (every 2 weeks), and monthly (every 4 weeks) frequencies. Prices are serialized as strings for decimal schema compatibility.
-   **Staff Portal**: A unified management portal for staff and admin users for managing retail and wholesale orders, inventory (production recording, stock overview, adjustments), a CRM system for lead tracking (with touch point history, search, and filter), and admin features (flavor library, retail products, wholesale units, product specs, user management). Super admins can impersonate users. Staff can also create new wholesale product types directly from the Wholesale Pricing Management page.

### Development & Build Process

Uses `npm run dev` for development (tsx server with Vite middleware) and `npm run build` for production (client bundle with Vite, server bundle with esbuild). Type checking with `npm run check`.

## External Dependencies

### Third-Party Services

-   **Stripe**: Payment processing, subscription billing.
-   **Neon Database**: Primary PostgreSQL data storage.
-   **Twilio**: SMS-based phone number verification and passwordless login.
-   **Gmail/Nodemailer**: For passwordless email login and password reset emails.

### Key NPM Packages

-   **UI & Styling**: `@radix-ui/*`, `tailwindcss`, `class-variance-authority`, `clsx`, `tailwind-merge`.
-   **Data & Forms**: `@tanstack/react-query`, `react-hook-form`, `zod`, `drizzle-orm`.
-   **Payment & Auth**: `stripe`, `@stripe/react-stripe-js`, `@stripe/stripe-js`, `passport`, `passport-local`, `express-session`, `connect-pg-simple`.
-   **Server Dependencies**: `express`, `ws`, `date-fns`.

### Environment Variables Required

-   `DATABASE_URL`
-   `SESSION_SECRET`
-   `STRIPE_SECRET_KEY`
-   `VITE_STRIPE_PUBLIC_KEY`
-   `NODE_ENV`
-   `TWILIO_ACCOUNT_SID`
-   `TWILIO_AUTH_TOKEN`
-   `TWILIO_PHONE_NUMBER`
-   `GMAIL_USER`
-   `GMAIL_APP_PASSWORD`