# Puget Sound Kombucha Co. - Craft Kombucha E-commerce Platform

## Overview

Puget Sound Kombucha Co. is a full-stack e-commerce web application for a Pacific Northwest kombucha brewery. The platform caters to retail customers for product and subscription purchases, and business clients for wholesale orders. Key capabilities include product browsing, subscription management, Stripe payment integration, comprehensive inventory tracking, wholesale customer management, delivery date scheduling, daily delivery reporting, and an admin dashboard. The business vision is to provide a seamless online experience for purchasing artisanal kombucha, expanding market reach, and streamlining B2B operations.

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend Architecture

The frontend is built with React 18 and TypeScript, utilizing Vite for development and bundling. Wouter handles client-side routing, and Tailwind CSS, extended with shadcn/ui components, provides the styling framework. TanStack Query manages server state and caching, while React Hook Form with Zod resolvers handles form management and validation. The design emphasizes a dual UX for retail and wholesale, product-hero visuals, responsive layouts, and accessibility.

### Backend Architecture

The backend uses Node.js with Express.js and TypeScript, following an ESM-first approach. It implements a RESTful API with session-based authentication using Passport.js and PostgreSQL-backed session storage. Drizzle ORM is used for type-safe PostgreSQL (Neon serverless) queries, following a schema-first approach with migrations. Key entities include Users, Products, Subscription Plans, Subscriptions, Wholesale data, and Sessions.

### Case-Based Ordering System

All orders in the system are for cases of 12 bottles, not individual bottles. This applies to both retail and wholesale orders.

**Key Constants:**
- `CASE_SIZE = 12` (defined in `shared/pricing.ts`)
- Helper functions: `formatCaseQuantity(cases)`, `casesToBottles(cases)`, `bottlesToCases(bottles)`

**Pricing Model:**
- **Retail Pricing**: Stored per-case in the products table
  - One-time purchase: $40/case
  - Subscription: $36/case
- **Wholesale Pricing**: Stored per-bottle in the products table, multiplied by CASE_SIZE for display and storage
  - Default: $2.50/bottle = $30/case
  - Custom pricing: Per-customer pricing overrides, also stored per-bottle

**Data Flow:**
1. **Product Catalog**: 
   - Retail prices stored as per-case amounts
   - Wholesale prices stored as per-bottle amounts ($2.50)
2. **Display Layer**: 
   - Frontend multiplies wholesale prices by CASE_SIZE (12) for user-facing displays
   - All quantity inputs/displays show cases with bottle counts: "2 cases (24 bottles)"
3. **Order Creation**: 
   - Backend multiplies wholesale per-bottle price by CASE_SIZE before storing in `wholesale_order_items.unitPrice`
   - Stored unitPrice is per-case ($30), quantity is number of cases
4. **Invoices & Reports**: 
   - Read stored per-case unitPrice from database
   - Display quantities using formatCaseQuantity helper
   - Calculate totals: unitPrice × quantity (both already case-based)

**Implementation Files:**
- `shared/pricing.ts`: Constants and helper functions
- `server/routes.ts`: Backend order creation with CASE_SIZE multiplication
- `client/src/components/cart/cart-drawer.tsx`: Retail cart display
- `client/src/pages/wholesale-place-order.tsx`: Wholesale ordering interface
- `client/src/pages/wholesale-invoice.tsx`: Invoice display with case quantities

### Authentication & Authorization

The system supports dual authentication methods: traditional username/password login OR passwordless SMS code login. Both methods use Passport.js for session management with scrypt hashing for passwords and Twilio for SMS delivery. 

**Authentication Methods:**
- **Password Login**: Users can login with either email or username, paired with their password
  - LocalStrategy implementation with case-insensitive email comparison
  - Supports both username and email as login identifiers
- **SMS Code Login**: Passwordless login via 6-digit verification codes sent to registered phone numbers
  - 5-minute code expiration
  - Maximum 3 verification attempts per code
  - Single-use codes (marked as consumed after successful login)
  - Purpose-scoped verification codes (registration vs. login)
  - Phone number enumeration prevention (generic success responses)

**Registration Requirements:**
- SMS-based phone number verification is required during registration before account creation
- Users must verify their phone number via a 6-digit code sent via Twilio

Sessions are managed with `express-session` and stored in PostgreSQL. A role-based authorization system defines 'user', 'staff', 'admin', and 'super_admin' levels, with granular API route protection and user management capabilities for super admins.

**Role Hierarchy & Permissions:**
- **User**: Standard retail customers - access to shop, cart, subscriptions
- **Wholesale Customer**: Business customers - access to wholesale portal for placing bulk orders, viewing their own orders and pricing
- **Staff**: Internal wholesale operations only - can view all orders, manage inventory, place orders on behalf of customers (no revenue access)
- **Admin**: Full wholesale access including revenue numbers, customer management, pricing overrides
- **Super Admin**: All admin capabilities plus user role management

**Registration Flows:**
- **Retail Registration** (`/auth` register tab): 
  - Username, password, phone number (with SMS verification), email (optional), first/last name (optional)
  - Creates user with 'user' role
  - Access to retail shop, cart, and subscription features
- **Wholesale Registration** (`/wholesale-register`):
  - Business name, contact person, email, business phone, business address
  - Account credentials: username, password, phone number (with SMS verification)
  - Creates user with 'wholesale_customer' role
  - Linked wholesale_customers record with business information
  - Self-service registration - immediate access to wholesale portal after verification

**Access Control Implementation:**
- **Backend**: Middleware functions `isAuthenticated`, `isStaffOrAdmin`, `isAdmin`, `isSuperAdmin` protect API routes
  - `isStaffOrAdmin` now includes wholesale_customer, staff, admin, and super_admin roles
- **Frontend**: `StaffProtectedRoute` component restricts wholesale portal to wholesale customers, staff, and admins
- **Revenue Visibility**: Financial data (total revenue, revenue charts) conditionally rendered only for admin/super_admin roles
  - Wholesale dashboard: Revenue card hidden from staff and wholesale customers
  - Delivery reports: Total value card hidden from staff and wholesale customers
  - Reports page: Wholesale revenue card and revenue chart hidden from staff and wholesale customers
- **Data Access**: Wholesale customers can only view/manage their own orders; staff/admin can view all orders

### Payment Processing

Stripe is integrated for both one-time purchases and recurring subscriptions using Stripe Checkout Sessions. The system handles Stripe webhooks for payment confirmation and subscription lifecycle events. It supports a "subscribe and save" model with flexible delivery frequencies (weekly/bi-weekly), allowing for distinct pricing and checkout flows for one-time vs. subscription items. Server-side validation prevents mixed carts (one-time and subscription items) in a single checkout.

### Subscription Management

The platform provides comprehensive subscription management capabilities for retail customers:

**My Subscriptions Page:**
- Path: `/my-subscriptions` (requires authentication)
- View all active subscriptions with product details, delivery frequency, and next delivery date
- Only visible to authenticated users via navbar link

**Subscription Features:**
- **Delay/Skip Deliveries**: Users can postpone their next delivery using an interactive calendar picker
  - Updates persist to database (`nextDeliveryDate` field)
  - Validation ensures future dates only
- **Change Products**: Users can switch their subscription to a different product via dropdown selector
  - Updates persist to database (`productId` field)
  - Shows all available products with current stock
- **Visual Feedback**: Toast notifications confirm successful updates or display errors

**Database Schema:**
- Subscriptions table includes `productId` and `subscriptionFrequency` fields for product-based subscriptions
- Supports both plan-based (legacy) and product-based subscription models
- Status tracking: 'active', 'paused', 'cancelled'

**API Endpoints:**
- `GET /api/my-subscriptions`: Returns user's active subscriptions (filtered by userId)
- `PATCH /api/my-subscriptions/:id`: Updates subscription with security validations
  - Zod schema validation allows only `nextDeliveryDate` and `productId` updates
  - Storage layer whitelisting prevents unauthorized field modifications
  - Ownership verification ensures users can only modify their own subscriptions

**Security:**
- Defense-in-depth approach with dual validation layers (API + Storage)
- Protected fields (userId, status, stripeSubscriptionId) cannot be modified by users
- Session-based authentication required for all subscription endpoints

### Wholesale Portal

The wholesale portal provides comprehensive B2B order and customer management capabilities accessible to admin users:

**Customer Management:**
- Create and manage wholesale customer accounts with business details (business name, contact person, email, phone, address)
- View all wholesale customers in a card-based layout
- Each customer account supports client-specific pricing overrides
- Toggle online payment capability per customer (allowOnlinePayment field)
  - Admins can enable/disable online payments for select wholesale customers
  - When enabled, customers can pay invoices directly via Stripe

**Order Management:**
- Place wholesale orders by selecting customers and adding products to cart
- View all wholesale orders with status tracking (pending, processing, shipped, delivered)
- Set and manage delivery dates for orders via calendar picker
- Add order notes for special instructions
- Update order status through admin interface

**Delivery Date Management:**
- Assign delivery dates to wholesale orders
- Daily delivery report page with date filtering
- Summary statistics: total orders, total value, unique customers per delivery date
- Detailed delivery manifest showing all orders scheduled for a specific date
- Print-friendly layout for physical delivery manifests

**Client-Specific Pricing:**
- Default wholesale pricing ($2.50/bottle = $30/case) with support for custom per-customer pricing
- Pricing overrides stored in wholesale_pricing table as per-bottle amounts with unique constraint per customer-product combination
- Order placement automatically uses client-specific pricing when available, multiplying by CASE_SIZE before storing
- All order items store per-case unitPrice for consistent invoice calculations

**Invoice Generation & Payment:**
- Automatic invoice number generation (format: INV-YYYY-NNNN, auto-increments per year)
- Professional invoice layout with company and customer details, line items, totals
- Print-ready invoice page accessible via direct URL or from orders list
- Invoice button on each order opens invoice in new tab
- **Online Payment:** Pay Now button appears on invoices when customer has online payment enabled
  - Integrated Stripe Checkout for secure wholesale invoice payments
  - Payment session endpoint: POST /api/wholesale/orders/:id/create-payment
  - Redirects to dedicated payment success page after completion
  - Only available for customers with allowOnlinePayment flag enabled
- Email sending infrastructure placeholder (awaiting Gmail API credentials)
  - Placeholder endpoint: POST /api/wholesale/orders/:id/send-invoice
  - Future integration requires: GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, GMAIL_REFRESH_TOKEN secrets

### Development & Build Process

The development workflow uses `npm run dev` for a tsx server with Vite middleware. Production builds (`npm run build`) create a client bundle with Vite and a server bundle with esbuild. Type checking is performed with `npm run check`.

## External Dependencies

### Third-Party Services

-   **Stripe**: Payment processing, subscription billing, and revenue management. Integrated via server-side API calls and client-side Elements.
-   **Neon Database**: Primary PostgreSQL data storage for all application data, connected via `@neondatabase/serverless`.
-   **Twilio**: Used for SMS-based phone number verification during registration and passwordless SMS code login.

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

Static assets are stored in the `attached_assets/` directory and referenced via the `@assets` alias. Google Fonts (Outfit and Inter) are loaded via CDN.