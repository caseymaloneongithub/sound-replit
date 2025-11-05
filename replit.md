# Puget Sound Kombucha Co. - Craft Kombucha E-commerce Platform

## Overview

Puget Sound Kombucha Co. is a full-stack e-commerce web application for a Pacific Northwest kombucha brewery. The platform serves dual audiences: retail customers purchasing kombucha products and subscriptions through a consumer-facing shop, and business clients managing wholesale orders through a dedicated portal. The application features product browsing, subscription management, Stripe payment integration, and comprehensive inventory tracking.

## Recent Changes (November 2025)

### Authentication System Migration (November 5, 2025) - COMPLETED
**Migration**: Fully migrated from Replit Auth (OIDC) to local username/password authentication with required SMS verification
**Backend Changes**:
- Implemented Passport.js LocalStrategy with scrypt password hashing
- Created authentication endpoints: /api/register, /api/login, /api/logout, /api/user
- Session-based authentication with PostgreSQL-backed session storage
- isAuthenticated middleware for protected routes
- Integrated Twilio for SMS-based phone number verification during registration
- Created verification endpoints: /api/send-verification-code, /api/verify-code
- Server-side enforcement prevents account creation without verified phone number

**Frontend Changes**:
- Created AuthProvider context with useAuth hook for client-side state management
- Built dedicated /auth page with login and registration forms
- Updated Navbar to use local authentication (removed Replit Auth redirect)
- Updated Account page with proper logout functionality
- Protected routes automatically redirect to /auth for unauthenticated users
- Registration form requires phone number verification via SMS before account creation
- Submit button disabled until phone is verified

**Phone Verification Security**:
- Server validates phone verification before creating accounts (cannot be bypassed)
- Verification codes expire after 5 minutes
- Phone numbers must be unique (one account per phone)
- Codes are single-use and invalidated after registration

**Super Admin Setup**:
- Casey Malone (casey@soundkombucha.com) configured as initial super admin
- Username: casey
- Default password: kombucha2025 (should be changed after first login)
- Seed script available at scripts/seed-super-admin.ts

**Database Schema Updates**:
- Added username (unique, required) and password (hashed) fields to users table
- Added phoneNumber (required, unique) field to users table
- Created verification_codes table with expiration tracking
- Maintained role and isAdmin fields for authorization
- Session table automatically managed by connect-pg-simple

**Testing Notes**:
- SMS verification requires real phone numbers (test numbers like +15555551234 are rejected by Twilio)
- Twilio charges ~$0.0079 per SMS sent
- Use your own phone number for testing the registration flow

### Shopping Cart Session Fix (CRITICAL)
**Problem**: Cart items were not persisting - users saw success toasts but cart remained empty.
**Root Cause**: Session cookies had `secure: true` (required HTTPS) but development runs on HTTP.
**Solution**: Updated `server/replitAuth.ts`:
- Changed `secure: true` → `secure: process.env.NODE_ENV === 'production'`
- Changed `saveUninitialized: false` → `true` to create sessions for guest users
- Ensures cart works in development while maintaining production security

### Reporting Dashboard with Charts
**Added**: Three Recharts visualizations to `/reports` page:
1. Revenue & Orders Trend (6-month dual-axis bar chart)
2. Order Status Distribution (pie chart with percentage labels)
3. Inventory Status (horizontal bar chart)
**Components**: Uses ResponsiveContainer for mobile compatibility
**Data**: Real-time calculations from orders, products, and subscriptions queries

### Wholesale Portal Security
**Enhancement**: Server-side price validation for wholesale orders
- Server recalculates pricing from authoritative product database
- Client-supplied prices are ignored (prevents tampering)
- Validates product existence and quantities before order creation
**Impact**: Prevents financial integrity issues in B2B transactions

### Stripe Payment Integration
**Features**:
- One-time purchase checkout with Stripe Checkout Sessions
- Subscription creation for recurring plans
- Webhook handling with signature verification
- Automatic cart clearing after successful payment
- Image URL normalization for Stripe compatibility (converts relative to absolute URLs)

### User Role Management System
**Super Admin**: Casey Malone (casey@soundkombucha.com) seeded as the initial super admin
**Role Hierarchy**: Three levels - 'user', 'admin', 'super_admin'
- **User**: Basic access to shop and subscriptions
- **Admin**: Access to staff portal (orders, inventory, product specs)
- **Super Admin**: Full admin access + user management capabilities

**Key Features**:
- User Management tab in staff portal (super admin only)
- Role assignment dropdown with real-time updates
- Server-side protection against self-demotion (prevents locking out last super admin)
- Automatic isAdmin field sync (admin and super_admin roles set isAdmin = true)
- Granular API route protection with role-specific middleware

**API Endpoints**:
- GET /api/staff/users - List all users (super admin only)
- PATCH /api/staff/users/:id/role - Update user role (super admin only, cannot self-demote)

**Security Measures**:
- Double middleware protection: isAuthenticated + isSuperAdmin
- Server-side validation prevents privilege escalation
- UI-level and API-level guards against self-role modification

### Known Limitations
**Email Notifications**: Not implemented - requires SendGrid or Resend integration setup
**Route Protection**: Shop and wholesale pages are publicly accessible - no authentication required
**Inventory Management**: Manual stock adjustments only - no automatic deduction on order placement

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend Architecture

**Framework & Build System**
- React 18 with TypeScript for type-safe component development
- Vite as the build tool and development server with HMR (Hot Module Replacement)
- Wouter for lightweight client-side routing instead of React Router
- CSS framework: Tailwind CSS with custom design system extending shadcn/ui components

**State Management & Data Fetching**
- TanStack Query (React Query) v5 for server state management and caching
- Custom query client configuration with aggressive caching (staleTime: Infinity) to reduce unnecessary refetches
- React Hook Form with Zod resolvers for form state and validation

**UI Component System**
- shadcn/ui component library (New York style variant) with Radix UI primitives
- Custom design tokens following artisanal/craft aesthetic with Outfit and Inter font families
- Component aliases configured via TypeScript path mapping (@/components, @/lib, @/hooks)

**Design Principles**
- Dual audience UX: Distinct visual separation between retail shop and wholesale portal
- Product-hero approach with high-quality imagery emphasis
- Responsive grid layouts (mobile-first with md/lg breakpoints)
- Accessibility-first with Radix UI accessible primitives

### Backend Architecture

**Runtime & Framework**
- Node.js with Express.js for HTTP server
- ESM (ES Modules) throughout the codebase
- TypeScript for type safety across server and shared code

**API Design**
- RESTful API structure under /api routes
- Session-based authentication with express-session
- Stripe webhook handling with raw body verification for payment events
- Storage abstraction layer (IStorage interface) for database operations

**Database Layer**
- Drizzle ORM for type-safe database queries
- PostgreSQL (Neon serverless) as the primary database
- Schema-first approach with Drizzle migrations in ./migrations directory
- Zod integration via drizzle-zod for runtime schema validation

**Key Database Entities**
- Users: User accounts with username/password authentication and role-based authorization
- Products: Kombucha products with retail/wholesale pricing, inventory tracking
- Subscription Plans: Recurring delivery plans (weekly/monthly with bottle counts)
- Subscriptions: User subscription instances with Stripe subscription IDs
- Wholesale: Customers, orders, and order items for B2B sales
- Sessions: PostgreSQL-backed session storage using connect-pg-simple

### Authentication & Authorization

**Local Password Authentication**
- Username/password based authentication using Passport.js LocalStrategy
- Passwords hashed with scrypt for security (salt + derived key)
- Session management with PostgreSQL-backed session store (connect-pg-simple)
- User registration and login endpoints (/api/register, /api/login, /api/logout, /api/user)
- Client-side AuthProvider context with useAuth hook
- Middleware: `isAuthenticated` guard for protected routes

**Session Security**
- HTTP-only cookies with secure flag in production
- Session secret from environment variable
- Session data stored in PostgreSQL for persistence across restarts

### Payment Processing

**Stripe Integration**
- Stripe Checkout for one-time payments and subscription creation
- @stripe/stripe-js and @stripe/react-stripe-js for frontend payment elements
- Stripe API v2024-11-20.acacia
- Payment intents for retail purchases, subscription objects for recurring billing
- Webhook handling for payment confirmation and subscription lifecycle events

**Payment Flow**
1. Client creates checkout session via /api/checkout-session
2. Stripe-hosted checkout page for payment collection
3. Webhook notifications update database on successful payment
4. Success/cancel redirect handling

### Development & Build Process

**Development Workflow**
- `npm run dev`: Runs tsx server with NODE_ENV=development and Vite middleware
- Vite dev server proxied through Express for unified development experience
- Source maps enabled via @jridgewell/trace-mapping
- Runtime error overlay in development (@replit/vite-plugin-runtime-error-modal)

**Production Build**
- `npm run build`: Vite builds client to dist/public, esbuild bundles server to dist/
- Server bundled as ESM with external packages
- `npm start`: Runs production server from dist/index.js

**Type Checking**
- `npm run check`: TypeScript compilation check without emit
- Incremental compilation with tsBuildInfoFile for faster checks

## External Dependencies

### Third-Party Services

**Stripe (Payment Processing)**
- Purpose: Payment collection, subscription billing, and revenue management
- Integration: Server-side API calls with stripe npm package, client-side Elements for PCI compliance
- Webhooks: Configured to receive payment and subscription events

**Neon Database (PostgreSQL)**
- Purpose: Primary data storage for all application data
- Integration: @neondatabase/serverless with WebSocket support
- Connection: DATABASE_URL environment variable, connection pooling via Pool

### Key NPM Packages

**UI & Styling**
- @radix-ui/* (v1.x): Accessible component primitives (40+ components)
- tailwindcss (v3): Utility-first CSS framework
- class-variance-authority: Type-safe variant styling
- clsx + tailwind-merge: Conditional className composition

**Data & Forms**
- @tanstack/react-query (v5.60.5): Server state management
- react-hook-form (v7): Performant form state management
- zod: Runtime type validation and schema definitions
- drizzle-orm: Type-safe SQL query builder

**Payment & Auth**
- stripe (v17): Server-side Stripe API
- @stripe/react-stripe-js + @stripe/stripe-js: Client-side payment UI
- passport + passport-local: Local username/password authentication
- express-session + connect-pg-simple: Session management

**Server Dependencies**
- express: Web server framework
- ws: WebSocket library for Neon serverless connections
- date-fns: Date formatting and manipulation

### Environment Variables Required

- `DATABASE_URL`: PostgreSQL connection string (Neon serverless)
- `SESSION_SECRET`: Secret for signing session cookies
- `STRIPE_SECRET_KEY`: Stripe API secret key
- `VITE_STRIPE_PUBLIC_KEY`: Stripe publishable key (client-side)
- `NODE_ENV`: Environment mode (development/production)

### Asset Management

**Static Assets**
- Stored in attached_assets/ directory
- Vite alias: @assets for convenient imports
- Logo and generated images (brewery hero background) included
- Google Fonts: Outfit (headings) and Inter (body text) loaded via CDN