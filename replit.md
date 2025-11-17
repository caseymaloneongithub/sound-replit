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
-   **Authentication & Authorization**: Supports username/password, passwordless SMS code login (Twilio), and passwordless email code login (Gmail) via Passport.js. Registration requires SMS verification. A role-based authorization system defines 'user', 'wholesale_customer', 'staff', 'admin', and 'super_admin' levels with granular API route protection. Separate portals exist for retail, wholesale, and staff/admin.
    -   **Separate Login Pages**: Three dedicated login pages for different user types:
        -   **Retail Login** (`/auth`): For regular customers. Includes registration and three login methods (password, SMS code, email code). Redirects to shop after login.
        -   **Staff Login** (`/staff/login`): For staff/admin users. Password-only, validates role after login, redirects to staff portal.
        -   **Wholesale Login** (`/wholesale/login`): For wholesale customers. Password-only, validates role after login, redirects to wholesale dashboard.
        -   Protected routes automatically redirect to the appropriate login page based on required role.
    -   **Email Code Login**: Passwordless authentication via email verification codes. Users enter their email, receive a 6-digit code (5-minute expiration), and verify to login. System gracefully handles email delivery failures (like password reset), storing codes in database even if SMTP fails. Uses Gmail/nodemailer infrastructure (GMAIL_USER, GMAIL_APP_PASSWORD).
    -   **Password Reset**: Users can request password reset via email. System generates secure tokens (32-byte hex) with 1-hour expiration. Tokens are single-use and stored in database. Email integration uses Gmail/nodemailer (GMAIL_USER, GMAIL_APP_PASSWORD). API gracefully handles email delivery failures in development/testing environments while still creating tokens. "Forgot Password?" link available on all login pages.
    -   **Profile Management**: Customers can update their contact information (first name, last name, email, phone number) from the account page. Email uniqueness is validated to prevent conflicts. Changes are authenticated and require valid user session.
-   **Wholesale Contact & Inquiries**: Public contact form at `/contact` for wholesale inquiries and general questions. Featured prominently on homepage above product listings. Form includes fields for name, email, phone, company, and message with Zod validation. Persistent success state shows submitted details with "Send Another Message" control. Full keyboard accessibility with focus management and screen-reader support (`aria-live`, `role="status"`).
-   **Payment Processing**: Stripe is integrated for one-time purchases (embedded checkout) and recurring subscriptions (Stripe Checkout Sessions). Webhooks handle payment confirmations and subscription lifecycle events. Sales tax (10.35%) is applied to retail one-time purchases only. Retail customers are automatically created as Stripe customers upon registration.
-   **Retail Order Tracking**: Secure two-phase order creation workflow where customer info is stored then linked to `payment_intent.succeeded` webhook for atomic order creation. Orders have statuses (`pending` → `ready_for_pickup` → `fulfilled`/`cancelled`) managed by staff.
-   **Subscription Management**: Supports multi-product subscriptions with flexible quantities. Customers can add/remove products, delay pickups, change delivery frequency, cancel subscriptions, and update payment methods.
    -   **Self-Service Editing**: Customers can modify active subscriptions through the My Subscriptions page:
        -   **Frequency Changes**: Switch between weekly, bi-weekly, or every-4-weeks delivery. New cadence applies after next successful charge.
        -   **Product Management**: Add/remove products or change product selection. Changes take effect on next scheduled delivery.
        -   **Delay Pickup**: Postpone next delivery by 1-12 weeks using declarative server-controlled adjustments. Server synchronizes both `nextDeliveryDate` and `nextChargeAt` to prevent billing inconsistencies.
        -   **Advance Pickup**: Move pickup earlier to next week with Friday cutoff (Pacific timezone). Only allowed Monday-Thursday, requires 48-hour minimum lead time, ensures new date is strictly earlier than current pickup. Uses Pacific timezone for all calculations (handles DST correctly). Server computes "next week" as TODAY + 7 days. Mutually exclusive with delay action. **Status: Production-ready** (Nov 2025).
        -   **Payment Method Updates**: Customers can update their payment method via Stripe Customer Portal integration. One-click "Manage Payment Method" button redirects to secure Stripe-hosted portal for card updates. Changes apply immediately to all future subscription charges. **Requires Stripe Customer Portal configuration in dashboard**.
        -   **Pickup Date Model**: Pickup dates track the DATE only (no specific time component), so DST transitions do not affect scheduling. Simple date arithmetic is used (+7 days, etc.).
        -   **Security**: All edits require `status='active'`, `billingStatus='active'`, and `processingLock=false`. Server controls all date calculations; client sends declarative inputs (`weeksToDelay: 1-12`, `advanceToNextWeek: boolean`) not absolute dates.
    -   **Local Subscription Billing System**: Subscriptions are managed locally with Stripe used only as a payment processor (not Stripe Subscriptions). Daily cron job runs at 4 AM to charge customers using saved payment methods via PaymentIntents. System handles:
        -   **Async Payment Processing**: Supports 3D Secure authentication (`requires_action`), bank processing delays (`processing`), and synchronous payments (`succeeded`)
        -   **Atomic Operations**: Lock acquisition, inventory deduction, and order creation in single transaction
        -   **Idempotency**: Multiple safety checks prevent duplicate charges and orders
        -   **Compensating Rollback**: Auto-refunds if payment succeeds but order creation fails, schedules retry for next day
        -   **Retry Logic**: Failed payments retry up to 3 times with +1 day intervals, customer & staff notifications
        -   **Stale State Detection**: Hourly cron reconciles with Stripe for subscriptions stuck in awaiting states (missed webhooks)
        -   **Billing States**: `active` (ready for billing), `awaiting_auth` (3D Secure pending), `awaiting_confirmation` (bank processing), `retrying` (after failures)
    -   **Automated Order Creation**: When payments succeed (either synchronously or via webhook), system atomically: (1) creates retail order with `isSubscriptionOrder: true`, (2) deducts inventory with row-level locking, (3) records adjustments in ledger, (4) updates next charge date, (5) clears retry counters. Refund safety checks prevent order creation for refunded PaymentIntents.
-   **Inventory Management System**: Staff can record production batches, increasing stock with an audit trail in an `inventory_adjustments` ledger. All inventory updates use atomic PostgreSQL transactions with pessimistic locking. Fulfillment automatically deducts inventory and records adjustments.
-   **Staff Portal**: Unified management portal at `/staff-portal` for staff and admin users. Includes order management (retail and wholesale), inventory management (production recording, stock overview, adjustments ledger), CRM system, and admin features (product specs, user management). Super admins can impersonate users with an audit trail and visual indicator.
    -   **Wholesale Management**: Create/manage wholesale accounts, place orders, delivery scheduling, generate daily delivery reports, and professional invoice generation. Supports 'fulfilled' status for orders.
    -   **Retail Management**: Customer directory with search functionality and a daily pickup report for subscriptions.
    -   **CRM System**: Comprehensive lead tracking for potential wholesale customers accessible to staff/admin roles. Features include:
        -   **Lead Management**: Create, view, edit, and delete leads with business name, contact info, priority levels (high/medium/low), and status tracking (new/contacted/qualified/proposal/negotiation/won/lost).
        -   **Touch Point History**: Full timeline of customer interactions (email, phone, meeting, other) with timestamps, subject lines, notes, and staff member attribution. Chronologically sorted display shows most recent interactions first.
        -   **Search & Filter**: Real-time search across business name, contact name, email, and phone. Filter leads by status and priority level.
        -   **Data Architecture**: Uses shadcn Form components with react-hook-form + zodResolver for all forms. Zod schemas from @shared/schema.ts ensure type safety. TanStack Query handles caching with stable query keys and proper invalidation after mutations.
        -   **UI/UX**: Clean card-based layout with status badges, priority indicators, and expandable detail views. Touch point dialog remains nested within lead detail dialog for seamless interaction tracking. All interactive elements have data-testid attributes for automated testing.

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
-   `GMAIL_USER`
-   `GMAIL_APP_PASSWORD`

## Operational Notes

### Subscription Billing System

**Daily Billing Cron** (4:00 AM):
- Automatically charges all due subscriptions
- Only processes subscriptions with `billingStatus='active'` to prevent duplicate charges
- Handles synchronous and asynchronous payments

**Hourly Stale State Detection**:
- Checks for subscriptions stuck in `awaiting_auth` (>15 minutes) or `awaiting_confirmation` (>2 hours)
- Reconciles with Stripe to determine actual payment status
- Automatically recovers from missed webhooks
- Sends customer/staff notifications as needed

**Compensating Rollback**:
- If payment succeeds but order creation fails (e.g., database error), system automatically:
  1. Refunds the customer via Stripe
  2. Logs critical error for manual review
  3. Schedules automatic retry for next day
  4. Prevents duplicate charges if Stripe retries the same PaymentIntent

**Manual Intervention Scenarios**:
1. **Exhausted Retries** (3 failed attempts): Subscription paused, customer notified, staff alerted. Requires manual review of payment method and customer contact.
2. **Refund After Failed Fulfillment**: Check server logs for `[BILLING] ⚠️ Refund` messages. Review inventory levels and database state before retry.
3. **Stale Processing (>2 hours)**: Staff receives email notification. Check Stripe dashboard and contact customer's bank if needed.

**Monitoring**:
- Watch for `[BILLING]` and `[STALE_CHECK]` log entries
- Critical errors logged with 🚨 emoji require immediate attention
- All refunds logged with ⚠️ emoji for manual review