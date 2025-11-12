# Puget Sound Kombucha Co. - Craft Kombucha E-commerce Platform

## Overview

Puget Sound Kombucha Co. is a full-stack e-commerce web application for a Pacific Northwest kombucha brewery. The platform facilitates retail product and subscription purchases, and wholesale orders for business clients. Key capabilities include product browsing, subscription management, Stripe payment integration, comprehensive inventory tracking, retail order tracking with fulfillment management, wholesale customer management, delivery scheduling, daily delivery reporting, and an admin dashboard. The business aims to provide a seamless online experience for purchasing artisanal kombucha, expanding market reach, and streamlining B2B operations.

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend

Built with React 18 and TypeScript, using Vite for development. Wouter handles routing, and Tailwind CSS with shadcn/ui provides styling. TanStack Query manages server state, and React Hook Form with Zod handles form validation. The design emphasizes a dual UX for retail and wholesale, responsive layouts, and accessibility.

### Backend

Node.js with Express.js and TypeScript, following an ESM-first approach. It implements a RESTful API with session-based authentication using Passport.js and PostgreSQL-backed session storage. Drizzle ORM is used for type-safe PostgreSQL (Neon serverless) queries, following a schema-first approach with migrations.

### Case-Based Ordering

All orders are for cases of 12 bottles. Pricing is stored per-case for both retail and wholesale, with frontend display logic to show quantities in cases and bottles. Wholesale pricing supports custom overrides per customer.

### Authentication & Authorization

Supports username/password login and passwordless SMS code login (via Twilio), both using Passport.js for session management. Registration requires SMS-based phone number verification. A role-based authorization system defines 'user', 'wholesale_customer', 'staff', 'admin', and 'super_admin' levels, with granular API route protection. Separate portals exist for retail, wholesale customers, and staff/admin, with varying levels of access to data and features, including revenue visibility.

### Payment Processing

Stripe is integrated for one-time purchases and recurring subscriptions. One-time cart purchases use **embedded checkout** with Stripe Payment Elements (on-site payment form), while subscription purchases use Stripe Checkout Sessions (redirect to Stripe). The system handles webhooks for payment confirmations and subscription lifecycle events. A "subscribe and save" model with flexible delivery frequencies is supported, with server-side validation preventing mixed carts.

**Stripe Customer Sync** (Added November 2025):
When retail customers register accounts, they are automatically created as Stripe customers. The `stripeCustomerId` is stored in the users table for seamless future transactions. This integration:
- Creates Stripe customers automatically on registration for retail customers (role='user')
- Stores userId in Stripe customer metadata for reference
- Uses non-blocking approach - registration succeeds even if Stripe creation fails
- Logs errors with context for monitoring and alerting
- **Wholesale customers** can have Stripe customer IDs when they pay by credit card, but these are created on-demand during checkout rather than automatically at registration
- Staff and admin accounts never need Stripe customer IDs as they don't make purchases
- **Backfill Tool**: Super admins can sync existing retail customers to Stripe via the User Management tab in Staff Portal with dry-run preview and live execution options

**Embedded Cart Checkout Flow**:
- Users navigate from cart drawer to `/cart-checkout` page
- Frontend calls `/api/create-cart-payment-intent` to create Payment Intent
- Two-step process: customer information → payment details
- Stripe PaymentElement renders card input fields in iframe
- Payment confirmed client-side via `stripe.confirmPayment()`
- Webhook clears cart on `payment_intent.succeeded` event
- Users stay on-site throughout entire checkout process

**Sales Tax**: 10.35% (6.5% WA State + 3.85% Seattle) is automatically calculated and applied to retail one-time purchases only (subscription items are tax-exempt). Tax is included in the Payment Intent amount for embedded checkout and added as a separate line item for Stripe Checkout Sessions. Both frontend cart display and backend checkout use actual product prices from the database (`product.retailPrice`) to ensure pricing consistency.

### Retail Order Tracking

**Order Creation Flow** (Added November 2025):
When customers complete one-time cart purchases via embedded checkout, the system creates comprehensive order records for staff tracking and fulfillment:

**Secure Two-Phase Order Creation**:
1. Customer submits their contact information (name, email, phone) on the checkout page
2. Frontend calls `/api/checkout/customer-info` to securely store this data server-side, linked to the Stripe Payment Intent ID
3. Customer completes payment using Stripe Payment Element (embedded)
4. Stripe webhook (`payment_intent.succeeded`) retrieves the stored customer info and creates the retail order atomically
5. Webhook clears the cart and deletes the temporary checkout session record

**Order Data Model**:
- `retail_orders` table: Stores order header with unique order number (e.g., RO-2025-001), customer details, pricing breakdown (subtotal, tax, total), order date, pickup date, status, fulfillment metadata
- `retail_order_items` table: Line items with product ID, quantity, and unit price snapshot
- `retail_checkout_sessions` table: Temporary storage for customer info during checkout, keyed by payment intent ID

**Order Status Workflow**:
Orders progress through four states: `pending` → `ready_for_pickup` → `fulfilled` (terminal) or `cancelled` (terminal). Staff can update order status via the Retail Orders page at `/retail/orders`. When an order is marked as `fulfilled`, the system automatically records the fulfillment timestamp and the staff user ID for audit purposes.

**Idempotency & Error Handling**:
- Webhook checks for existing orders by Stripe payment intent ID before creating duplicates
- Unique constraint on `stripePaymentIntentId` prevents race conditions
- Cart always clears after successful payment, even if order creation fails (prevents stuck carts)
- Checkout session cleanup happens after order creation to maintain data integrity

**Staff Portal Integration**:
The Retail Orders page (`/retail/orders`) displays all retail orders with customer details, order contents, pricing breakdown, and status management. Staff can update order status through a dropdown selector. Terminal states (`fulfilled`, `cancelled`) lock the status to prevent accidental changes.

### Subscription Management

**Multi-Product Subscriptions** (Updated November 2025):
Retail customers can now manage subscriptions containing multiple products with flexible quantities. The system uses a `subscription_items` table as the authoritative source for subscription contents, supporting:

- **Add Products**: Add multiple products to existing subscriptions with custom quantities per product
- **Remove Products**: Remove individual products from subscriptions (atomic row-level locking prevents removing the last item)
- **View All Products**: Each subscription displays all subscribed products with quantities in cases
- **Delay Pickups**: Delay next pickup by 1-4 weeks using dropdown selection
- **Cancel Subscriptions**: Cancel active subscriptions with confirmation dialog

**Technical Implementation**:
- `subscription_items` table stores product associations with `subscription_id`, `product_id`, and `quantity`
- Legacy `productId` field preserved in `subscriptions` table for backward compatibility
- Atomic validation using PostgreSQL row-level locking (`SELECT ... FOR UPDATE`) prevents race conditions
- Transactional migration successfully migrated 2 existing subscriptions to multi-product model
- Frontend uses dialogs for adding/removing products with optimistic updates and cache invalidation
- All operations validate user ownership to ensure security

All retail-facing pages use "pickup" terminology instead of "delivery" (wholesale operations retain "delivery" terminology).

### Staff Portal

A unified management portal at `/staff-portal` for staff and admin users, consolidating inventory, order, and wholesale management functions. The portal includes:

**Core Features** (all staff):
- **Orders Tab**: View and manage wholesale orders with status updates
- **Inventory Tab**: Real-time stock management with low-stock alerts

**Admin Features**:
- **Product Specs Tab**: Edit product details, pricing, and thresholds
- **User Management Tab** (super_admin only): Manage user roles and impersonate users

**User Impersonation** (Added November 2025):
Super admins can securely impersonate any user account to troubleshoot issues or provide customer support. This session-based feature includes:
- **Access**: Only super admins can initiate impersonation
- **Privilege Preservation**: Admins maintain their elevated privileges while viewing as another user
- **Visual Indicator**: Bright yellow banner at top of page shows "Viewing as [username]" with easy exit button
- **Audit Trail**: Full logging of all impersonation sessions with IP address, user agent, start time, and end time
- **Security**: Blocks self-impersonation, validates target user exists, uses original admin identity for all permission checks
- **Session Management**: Automatic cleanup on logout, transaction-wrapped operations prevent lingering sessions
- **Technical**: Stored in `impersonation_logs` table with partial index on active sessions for performance

**Wholesale Management** (dedicated pages accessible via sidebar):
- Create and manage wholesale customer accounts with client-specific pricing overrides
- Place orders on behalf of wholesale customers
- Manage wholesale orders with delivery scheduling and fulfillment tracking
- Generate daily delivery reports for logistics
- Professional invoice generation with optional online payment (Stripe)
- **Order Fulfillment**: Wholesale orders now support 'fulfilled' status in addition to standard workflow states (pending → processing → shipped → delivered → fulfilled). When marked as fulfilled, the system records the fulfillment timestamp and staff user ID for audit purposes, matching the retail order fulfillment pattern.

**Retail Management**:
- **Customer Directory**: View and search all retail customers at `/retail/customers`. Displays customer contact information (name, email, phone) and subscription statistics (total subscriptions, active subscriptions). Features real-time search filtering by name, email, or phone number. Read-only access for staff to support customer service operations.
- **Pickup Report**: Daily pickup schedule for retail subscriptions with date selection, summary statistics (total pickups, unique customers), and detailed customer/product information for logistics planning. Uses timezone-safe UTC-based date handling to ensure consistent reporting regardless of server or client timezone.

**Technical Implementation**:
- Retail customer data is aggregated via LEFT JOIN query combining users table (role='user') with subscriptions table
- Search functionality uses PostgreSQL ILIKE for case-insensitive pattern matching across multiple fields
- API endpoint `/api/retail/customers` protected by `isStaffOrAdmin` middleware
- UI built with responsive card grid layout and loading/empty states

The Staff Portal uses a sidebar navigation system that organizes features into sections: Overview, Wholesale, Inventory & Reports, and Administration. Wholesale customers have a separate self-service dashboard at `/wholesale-customer` for viewing orders and placing new orders independently.

### Development & Build Process

Uses `npm run dev` for development (tsx server with Vite middleware) and `npm run build` for production (client bundle with Vite, server bundle with esbuild). Type checking with `npm run check`.

## External Dependencies

### Third-Party Services

-   **Stripe**: Payment processing, subscription billing.
-   **Neon Database**: Primary PostgreSQL data storage.
-   **Twilio**: SMS-based phone number verification and passwordless login.

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

### Asset Management

Static assets are stored in `attached_assets/`. Google Fonts (Outfit and Inter) are loaded via CDN.