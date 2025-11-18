# Puget Sound Kombucha Co. - Craft Kombucha E-commerce Platform

## Overview

Puget Sound Kombucha Co. is a full-stack e-commerce web application for a Pacific Northwest kombucha brewery. The platform supports retail product and subscription purchases, and wholesale orders for business clients. Key capabilities include product browsing, subscription management, Stripe payment integration, comprehensive inventory tracking, retail and wholesale order tracking with fulfillment management, wholesale customer management, delivery scheduling, daily delivery reporting, and an admin dashboard. The business aims to provide a seamless online experience for purchasing artisanal kombucha, expanding market reach, and streamlining B2B operations.

## 🚧 Active Schema Migration (Nov 2024)

**Status:** Phase 3 Complete - Retail Product Offering Functional

The application has completed the retail product offering functionality as part of the migration to completely separate retail and wholesale product management with centrally-managed flavors. Both old and new schemas coexist to allow incremental development without downtime.

**Completed:**
- Phase 1: Parallel schema with flavors, retail products, and wholesale unit types
- Phase 2: Admin UI for Flavor Library and Wholesale Unit management
- Phase 3: Admin UI for Retail Product Offerings and Shop v2 integration

**NEW SYSTEM OVERVIEW:**
- **Flavors**: Central library of kombucha flavors with images, descriptions, and ingredients
- **Retail Products**: Flavor + unit type combinations (e.g., "Mist 6-pack", "Cascade 12-pack") with individual prices
- **Wholesale Units**: Unit types with default pricing and flavor availability for B2B customers

**Key Endpoints:**
- `/api/flavors` - Flavor library management (GET, POST, PATCH, DELETE)
- `/api/retail-products` - Retail product offerings (GET, POST, PATCH, DELETE)
- `/api/wholesale-unit-types` - Wholesale unit management (GET, POST, PATCH, DELETE)
- `/api/retail-cart` - V2 cart system for retail products
- Shop page: `/shop-v2` (uses new retail products)
- Admin pages: `/admin/flavors`, `/admin/retail-products`, `/admin/wholesale-units`

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
-   **Payment Processing**: Stripe is integrated for one-time purchases (embedded checkout) and recurring subscriptions (Stripe Checkout Sessions). Webhooks handle payment confirmations and subscription lifecycle events. Sales tax (10.35%) is applied to retail one-time purchases only.
-   **Retail Order Tracking**: Secure two-phase order creation workflow linked to Stripe payment webhooks. Orders have statuses (`pending` → `ready_for_pickup` → `fulfilled`/`cancelled`) managed by staff.
-   **Subscription Management**: Supports multi-product subscriptions with flexible quantities. Customers can add/remove products, change delivery frequency, delay/advance pickups (with specific rules and cutoff times), cancel subscriptions, and update payment methods via Stripe Customer Portal integration. A local subscription billing system uses a daily cron job to charge customers via Stripe PaymentIntents, handling async payments, retries, and compensating rollbacks. Retail subscription pickups are restricted to Monday-Thursday (9am-3pm).
-   **Inventory Management System**: Staff can record production batches, increasing stock with an audit trail. All inventory updates use atomic PostgreSQL transactions with pessimistic locking. Fulfillment automatically deducts inventory.
-   **Flavor Library (NEW)**: Central repository of kombucha flavors with primary/secondary images, descriptions, flavor profiles, and ingredients. Images are served via `/public/:filename` endpoint to work around Replit Object Storage public access restrictions. Full-width image carousels display both images with navigation dots.
-   **Retail Product Offerings (NEW)**: Admin interface for creating retail products by linking flavors to unit types (6-pack, 12-pack, case, kegs) with specific prices. Products display on Shop v2 page grouped by unit type, filtered by active status, with flavor images and descriptions. Prices are serialized as strings for decimal schema compatibility.
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