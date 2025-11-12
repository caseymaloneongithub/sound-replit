# Puget Sound Kombucha Co. - Craft Kombucha E-commerce Platform

## Overview

Puget Sound Kombucha Co. is a full-stack e-commerce web application for a Pacific Northwest kombucha brewery. The platform facilitates retail product and subscription purchases, and wholesale orders for business clients. Key capabilities include product browsing, subscription management, Stripe payment integration, comprehensive inventory tracking, retail and wholesale order tracking with fulfillment management, wholesale customer management, delivery scheduling, daily delivery reporting, and an admin dashboard. The business aims to provide a seamless online experience for purchasing artisanal kombucha, expanding market reach, and streamlining B2B operations.

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend

Built with React 18 and TypeScript, using Vite for development. Wouter handles routing, and Tailwind CSS with shadcn/ui provides styling. TanStack Query manages server state, and React Hook Form with Zod handles form validation. The design emphasizes a dual UX for retail and wholesale, responsive layouts, and accessibility. Retail-facing pages use "pickup" terminology, while wholesale operations use "delivery."

### Backend

Node.js with Express.js and TypeScript, following an ESM-first approach. It implements a RESTful API with session-based authentication using Passport.js and PostgreSQL-backed session storage. Drizzle ORM is used for type-safe PostgreSQL (Neon serverless) queries, following a schema-first approach with migrations.

### Core Features

-   **Case-Based Ordering**: All orders are for cases of 12 bottles. Pricing is stored per-case, with frontend logic displaying quantities in cases and bottles. Wholesale pricing supports custom overrides per customer.
-   **Authentication & Authorization**: Supports username/password and passwordless SMS code login (Twilio) via Passport.js. Registration requires SMS verification. A role-based authorization system defines 'user', 'wholesale_customer', 'staff', 'admin', and 'super_admin' levels with granular API route protection. Separate portals exist for retail, wholesale, and staff/admin.
-   **Payment Processing**: Stripe is integrated for one-time purchases (embedded checkout) and recurring subscriptions (Stripe Checkout Sessions). Webhooks handle payment confirmations and subscription lifecycle events. Sales tax (10.35%) is applied to retail one-time purchases only. Retail customers are automatically created as Stripe customers upon registration.
-   **Retail Order Tracking**: Secure two-phase order creation workflow where customer info is stored then linked to `payment_intent.succeeded` webhook for atomic order creation. Orders have statuses (`pending` → `ready_for_pickup` → `fulfilled`/`cancelled`) managed by staff.
-   **Subscription Management**: Supports multi-product subscriptions with flexible quantities. Customers can add/remove products, delay pickups, and cancel subscriptions.
-   **Inventory Management System**: Staff can record production batches, increasing stock with an audit trail in an `inventory_adjustments` ledger. All inventory updates use atomic PostgreSQL transactions with pessimistic locking. Fulfillment automatically deducts inventory and records adjustments.
-   **Staff Portal**: Unified management portal at `/staff-portal` for staff and admin users. Includes order management (retail and wholesale), inventory management (production recording, stock overview, adjustments ledger), and admin features (product specs, user management). Super admins can impersonate users with an audit trail and visual indicator.
    -   **Wholesale Management**: Create/manage wholesale accounts, place orders, delivery scheduling, generate daily delivery reports, and professional invoice generation. Supports 'fulfilled' status for orders.
    -   **Retail Management**: Customer directory with search functionality and a daily pickup report for subscriptions.

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