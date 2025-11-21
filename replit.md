# Puget Sound Kombucha Co. - Craft Kombucha E-commerce Platform

## Overview

Puget Sound Kombucha Co. is a full-stack e-commerce web application for a Pacific Northwest kombucha brewery. The platform supports retail product and subscription purchases, and wholesale orders for business clients. Key capabilities include product browsing, subscription management, Stripe payment integration, comprehensive inventory tracking, retail and wholesale order tracking with fulfillment management, wholesale customer management, delivery scheduling, daily delivery reporting, and an admin dashboard. The business aims to provide a seamless online experience for purchasing artisanal kombucha, expanding market reach, and streamlining B2B operations.

## User Preferences

Preferred communication style: Simple, everyday language.

## Business Contact Information

-   **Email**: emily@soundkombucha.com
-   **Phone**: 206-789-5219
-   **Address**: 4501 Shilshole Ave NW, Seattle, WA 98107

## System Architecture

### Frontend

Built with React 18 and TypeScript, using Vite for development. Wouter handles routing, and Tailwind CSS with shadcn/ui provides styling. TanStack Query manages server state, and React Hook Form with Zod handles form validation. The design emphasizes a dual UX for retail and wholesale, responsive layouts, and accessibility. Retail-facing pages use "pickup" terminology, while wholesale operations use "delivery."

### Backend

Node.js with Express.js and TypeScript, following an ESM-first approach. It implements a RESTful API with session-based authentication using Passport.js and PostgreSQL-backed session storage. Drizzle ORM is used for type-safe PostgreSQL (Neon serverless) queries, following a schema-first approach with migrations.

### Core Features

-   **Case-Based Ordering**: All orders are for cases of 12 bottles. Pricing is stored per-case, with frontend logic displaying quantities in cases and bottles. Wholesale pricing supports custom overrides per customer.
-   **Authentication & Authorization**: Supports username/password login and passwordless email code login (Gmail) via Passport.js. Registration is simplified and does not require phone verification. A role-based authorization system defines 'user', 'wholesale_customer', 'staff', 'admin', and 'super_admin' levels with granular API route protection. Separate portals exist for retail, wholesale, and staff/admin, each with dedicated login pages. Password reset functionality is available via email. **Wholesale customers authenticate exclusively via email verification codes** (no passwords) and support multiple authorized email addresses per account. Staff can manage authorized emails through the wholesale customer management interface. Verification codes are cryptographically bound to specific wholesale customer IDs to prevent cross-account code reuse and ensure secure multi-email authentication.
-   **Wholesale Contact & Inquiries**: A public contact form is available for wholesale inquiries and general questions, featuring Zod validation and full keyboard accessibility.
-   **Payment Processing**: Stripe is integrated for one-time purchases (embedded checkout) and recurring subscriptions (Stripe Checkout Sessions). Webhooks handle payment confirmations and subscription lifecycle events. Sales tax (10.35%) is applied to all retail orders including both one-time purchases and subscriptions. Payment webhook recomputes order totals server-side from cart items to prevent tampering.
-   **Wholesale Pricing & Ordering**: Wholesale orders use a unit type + flavor combination system. Customers and staff select a unit type (e.g., "Case", "Keg") and then choose from available flavors for that unit type. Pricing supports both default prices per unit type and customer-specific pricing overrides. Admin can set custom prices for individual customers in the wholesale unit type edit modal. The backend validates unit types and flavors, applies customer-specific or default pricing, and stores order items with `unitTypeId`, `flavorId`, and `quantity` fields.
-   **Retail Order Tracking**: Secure two-phase order creation workflow linked to Stripe payment webhooks. Orders have statuses (`pending` → `ready_for_pickup` → `fulfilled`/`cancelled`) managed by staff. Customers receive email notifications at order confirmation and when orders are ready for pickup. Customers can view their complete order history at `/my-orders` with "Reorder" and "Resend Email" buttons. Staff can cancel orders with automatic Stripe refund processing and inventory restoration via atomic transactions.
-   **Subscription Management**: Supports multi-product subscriptions with flexible quantities. Customers can add/remove products, change delivery frequency, delay/advance pickups (with specific rules and cutoff times), cancel subscriptions, and update payment methods via Stripe Customer Portal integration. A local subscription billing system uses a daily cron job to charge customers via Stripe PaymentIntents, handling async payments, retries, and compensating rollbacks. Retail subscription pickups are restricted to Monday-Thursday (9am-3pm).
-   **Inventory Management System**: Staff can record production batches, increasing stock with an audit trail. All inventory updates use atomic PostgreSQL transactions with pessimistic locking. Fulfillment automatically deducts inventory.
-   **Flavor Library**: Central repository of kombucha flavors with images, descriptions, flavor profiles, and ingredients.
-   **Retail Product Offerings**: Admin interface for creating retail products by linking flavors to unit types (6-pack, 12-pack, case, kegs) with specific prices. Each product includes a configurable subscription discount percentage (default 10%) for subscribe & save functionality. Products can include optional refundable deposits (e.g., $75 for keg deposits) that are charged only on one-time purchases, not subscriptions. Deposits are not subject to sales tax.
-   **Staff Portal**: A unified management portal for staff and admin users for managing retail and wholesale orders, inventory (production recording, stock overview, adjustments), a CRM system for lead tracking, and admin features (flavor library, retail products, wholesale units, product specs, user management). Super admins can impersonate users.

## External Dependencies

### Third-Party Services

-   **Stripe**: Payment processing, subscription billing.
-   **Neon Database**: Primary PostgreSQL data storage.
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
-   `STRIPE_WEBHOOK_SECRET`
-   `NODE_ENV`
-   `GMAIL_USER`
-   `GMAIL_APP_PASSWORD`