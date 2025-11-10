# Puget Sound Kombucha Co. - Craft Kombucha E-commerce Platform

## Overview

Puget Sound Kombucha Co. is a full-stack e-commerce web application for a Pacific Northwest kombucha brewery. The platform facilitates retail product and subscription purchases, and wholesale orders for business clients. Key capabilities include product browsing, subscription management, Stripe payment integration, comprehensive inventory tracking, wholesale customer management, delivery scheduling, daily delivery reporting, and an admin dashboard. The business aims to provide a seamless online experience for purchasing artisanal kombucha, expanding market reach, and streamlining B2B operations.

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

**Embedded Cart Checkout Flow**:
- Users navigate from cart drawer to `/cart-checkout` page
- Frontend calls `/api/create-cart-payment-intent` to create Payment Intent
- Two-step process: customer information → payment details
- Stripe PaymentElement renders card input fields in iframe
- Payment confirmed client-side via `stripe.confirmPayment()`
- Webhook clears cart on `payment_intent.succeeded` event
- Users stay on-site throughout entire checkout process

**Sales Tax**: 10.35% (6.5% WA State + 3.85% Seattle) is automatically calculated and applied to retail one-time purchases only (subscription items are tax-exempt). Tax is included in the Payment Intent amount for embedded checkout and added as a separate line item for Stripe Checkout Sessions. Both frontend cart display and backend checkout use actual product prices from the database (`product.retailPrice`) to ensure pricing consistency.

### Subscription Management

Provides retail customers comprehensive tools to view and manage active subscriptions, including delaying pickups by 1-4 weeks (dropdown selection instead of calendar) and changing subscribed products. All updates persist to the database with robust security validations ensuring users only modify their own subscriptions. All retail-facing pages use "pickup" terminology instead of "delivery" (wholesale operations retain "delivery" terminology).

### Staff Portal

A unified management portal at `/staff-portal` for staff and admin users, consolidating inventory, order, and wholesale management functions. The portal includes:

**Core Features** (all staff):
- **Orders Tab**: View and manage wholesale orders with status updates
- **Inventory Tab**: Real-time stock management with low-stock alerts

**Admin Features**:
- **Product Specs Tab**: Edit product details, pricing, and thresholds
- **User Management Tab** (super_admin only): Manage user roles

**Wholesale Management** (dedicated pages accessible via sidebar):
- Create and manage wholesale customer accounts with client-specific pricing overrides
- Place orders on behalf of wholesale customers
- Manage wholesale orders with delivery scheduling
- Generate daily delivery reports for logistics
- Professional invoice generation with optional online payment (Stripe)

**Retail Management**:
- **Pickup Report**: Daily pickup schedule for retail subscriptions with date selection, summary statistics (total pickups, unique customers), and detailed customer/product information for logistics planning. Uses timezone-safe UTC-based date handling to ensure consistent reporting regardless of server or client timezone.

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