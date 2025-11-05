# Puget Sound Kombucha Co. - Craft Kombucha E-commerce Platform

## Overview

Puget Sound Kombucha Co. is a full-stack e-commerce web application for a Pacific Northwest kombucha brewery. The platform caters to retail customers for product and subscription purchases, and business clients for wholesale orders. Key capabilities include product browsing, subscription management, Stripe payment integration, comprehensive inventory tracking, and a reporting dashboard. The business vision is to provide a seamless online experience for purchasing artisanal kombucha, expanding market reach, and streamlining B2B operations.

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend Architecture

The frontend is built with React 18 and TypeScript, utilizing Vite for development and bundling. Wouter handles client-side routing, and Tailwind CSS, extended with shadcn/ui components, provides the styling framework. TanStack Query manages server state and caching, while React Hook Form with Zod resolvers handles form management and validation. The design emphasizes a dual UX for retail and wholesale, product-hero visuals, responsive layouts, and accessibility.

### Backend Architecture

The backend uses Node.js with Express.js and TypeScript, following an ESM-first approach. It implements a RESTful API with session-based authentication using Passport.js and PostgreSQL-backed session storage. Drizzle ORM is used for type-safe PostgreSQL (Neon serverless) queries, following a schema-first approach with migrations. Key entities include Users, Products, Subscription Plans, Subscriptions, Wholesale data, and Sessions.

### Authentication & Authorization

The system uses local username/password authentication with Passport.js LocalStrategy and scrypt hashing, enhanced with SMS verification via Twilio during registration. Sessions are managed with `express-session` and stored in PostgreSQL. A role-based authorization system defines 'user', 'admin', and 'super_admin' levels, with granular API route protection and user management capabilities for super admins.

### Payment Processing

Stripe is integrated for both one-time purchases and recurring subscriptions using Stripe Checkout Sessions. The system handles Stripe webhooks for payment confirmation and subscription lifecycle events. It supports a "subscribe and save" model with flexible delivery frequencies (weekly/bi-weekly), allowing for distinct pricing and checkout flows for one-time vs. subscription items. Server-side validation prevents mixed carts (one-time and subscription items) in a single checkout.

### Development & Build Process

The development workflow uses `npm run dev` for a tsx server with Vite middleware. Production builds (`npm run build`) create a client bundle with Vite and a server bundle with esbuild. Type checking is performed with `npm run check`.

## External Dependencies

### Third-Party Services

-   **Stripe**: Payment processing, subscription billing, and revenue management. Integrated via server-side API calls and client-side Elements.
-   **Neon Database**: Primary PostgreSQL data storage for all application data, connected via `@neondatabase/serverless`.
-   **Twilio**: Used for SMS-based phone number verification during user registration.

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