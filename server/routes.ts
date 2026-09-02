import express, { type Express } from "express";
import { formatPhoneNumber } from "../shared/phone";
import { createServer, type Server } from "http";
import crypto from "crypto";
import Stripe from "stripe";
import { Configuration, PlaidApi, PlaidEnvironments, Products, CountryCode } from "plaid";
import { storage } from "./storage";
import { insertWholesaleCustomerSchema, insertWholesaleLocationSchema, insertWholesaleOrderSchema, insertProductSchema, insertWholesalePricingSchema, insertProductTypeSchema, retailOrders, retailCheckoutSessions, products, retailOrderItems, retailOrderItemsV2, inventoryAdjustments, updateProfileSchema, users, insertFlavorSchema, insertRetailProductSchema, insertWholesaleUnitTypeSchema, insertMaterialSchema, insertSupplierSchema, insertProcessSchema, insertProductionSchema, insertMaterialOrderSchema, retailProducts, retailSubscriptions, retailSubscriptionItems, retailCartItems, flavors, insertAccountingCategorySchema, insertAccountingTransactionSchema, siteSettings, wholesaleOrderItems, wholesaleUnitTypes, deliveryRoutes, deliveryRouteStops } from "@shared/schema";
import { eq, sql, and, desc, isNull, inArray } from "drizzle-orm";
import { db } from "./db";
import { Pool } from "@neondatabase/serverless";
import { toZonedTime, fromZonedTime, formatInTimeZone } from "date-fns-tz";
import { addDays, addHours, parseISO, format, differenceInCalendarDays } from "date-fns";
import { setupAuth, isAuthenticated } from "./auth";
import { z } from "zod";
import { sendEmailVerificationCode, sendContactFormNotification, sendWholesaleInvoiceEmail, sendWholesaleInvoicePaidNotification, sendWholesaleOrderConfirmation, sendWholesaleOrderAdminNotification, sendRetailOrderAdminNotification, sendRetailWelcomeEmail, retailWelcomeEmailsEnabled, sendStaffInviteEmail, sendSubscriberMigrationEmail, sendWholesaleWelcomeEmail, sendWholesalePaymentReceipt, sendWholesalePaymentFailedNotification, generateDeliveryPacketPDF } from "./email";
import { getCasePriceCents, CASE_SIZE } from "@shared/pricing";
import { ObjectStorageService, ObjectNotFoundError } from "./objectStorage";
import { isS3Configured, buildObjectKey, getPublicUrl, putObject } from "./s3-storage";
import { registerClaimRoutes, getPendingClaim, holdPendingOrder, createLinkRequest } from "./claim-flow";
import {
  frequencyToDays,
  frequencyToStripeInterval,
  frequencyLabel,
  subscriptionFrequencySchema,
} from "@shared/subscription-frequency";
import { getObjectAclPolicy } from "./objectAcl";
import { createStripeCustomer } from "./stripeCustomer";
// frequencyToDays deliberately NOT imported from pickup-policy: the single source of
// truth for frequency conversion is @shared/subscription-frequency (imported above).
import { normalizeToAllowedPickupDay, isAllowedPickupDay, PICKUP_POLICY, getBillingDateForPickup, getPacificWeekRange, nextPickupDateFromScheduled } from "@shared/pickup-policy";
import { geocodeAddress, optimizeDeliveryRoute, getFacilityLocation, getRouteDirections } from "./mapbox-service";
import { insertDeliveryStopSchema } from "@shared/schema";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

/**
 * Public base URL, used for Stripe success/cancel redirects and emailed links.
 *
 * This was derived from REPLIT_DOMAINS, which is unset now the app runs off Replit —
 * so every production redirect would have pointed at http://localhost:5000. Set APP_URL
 * in production; REPLIT_DOMAINS is kept only so a Replit deploy keeps working.
 */
/**
 * A customer order that failed validation (bad item, missing address, under minimum…).
 * Carries the HTTP status + body the route used to send directly, so the same order code
 * can run from the route AND from claim approval (placing an order that was held).
 */
class OrderValidationError extends Error {
  constructor(public status: number, public body: any) {
    super(body?.message || "Invalid order");
  }
}

function getBaseUrl(): string {
  if (process.env.APP_URL) return process.env.APP_URL.replace(/\/+$/, "");
  if (process.env.REPLIT_DOMAINS) return `https://${process.env.REPLIT_DOMAINS.split(',')[0]}`;
  if (process.env.NODE_ENV !== "development") {
    console.warn("[CONFIG] APP_URL is not set — payment redirects will point at localhost.");
  }
  return "http://localhost:5000";
}

const stripe = process.env.STRIPE_SECRET_KEY 
  ? new Stripe(process.env.STRIPE_SECRET_KEY, {
      apiVersion: "2025-10-29.clover",
    })
  : null;

// Plaid client configuration for accounting integration
const plaidConfiguration = (process.env.PLAID_CLIENT_ID && process.env.PLAID_SECRET)
  ? new Configuration({
      basePath: PlaidEnvironments[process.env.PLAID_ENV || 'sandbox'],
      baseOptions: {
        headers: {
          'PLAID-CLIENT-ID': process.env.PLAID_CLIENT_ID,
          'PLAID-SECRET': process.env.PLAID_SECRET,
        },
      },
    })
  : null;

const plaidClient = plaidConfiguration ? new PlaidApi(plaidConfiguration) : null;

async function getProductPricing(productId: string): Promise<{ retailPrice: string; wholesalePrice: string } | null> {
  const product = await storage.getProduct(productId);
  if (!product) return null;
  
  // Get the product type to access pricing
  const productTypes = await storage.getProductTypes();
  const productType = productTypes.find(pt => pt.id === product.productTypeId);
  if (!productType) return null;
  
  return {
    retailPrice: productType.retailPrice,
    wholesalePrice: productType.wholesalePrice,
  };
}

// Email-code rate limiting lives in ./rate-limit so auth.ts shares the same buckets.
import { checkEmailCodeRateLimit, MAX_CODE_ATTEMPTS, checkSubmissionRateLimit, isHoneypotTripped } from "./rate-limit";

// Changes when the server (re)starts — i.e. on every deploy. Long-lived pages
// like the orders-board tablet compare it across refetches and reload themselves
// when it moves, so nobody has to hard-refresh after a deploy.
const SERVER_BOOT_ID = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

export async function registerRoutes(app: Express): Promise<Server> {
  // Auth middleware - sets up /api/register, /api/login, /api/logout, /api/user
  await setupAuth(app);

  // Admin middleware - checks if user is an admin
  const isAdmin = async (req: any, res: any, next: any) => {
    try {
      const effectiveUser = req.originalUser || req.user;
      
      if (!effectiveUser) {
        return res.status(401).json({ message: "Unauthorized - please log in" });
      }
      
      if (!['admin', 'super_admin'].includes(effectiveUser.role)) {
        return res.status(403).json({ message: "Forbidden: Admin access required" });
      }
      
      next();
    } catch (error: any) {
      console.error("Error verifying admin status:", error);
      res.status(500).json({ message: "Error verifying admin status" });
    }
  };

  // Super admin middleware - checks if user is a super admin
  const isSuperAdmin = async (req: any, res: any, next: any) => {
    try {
      const effectiveUser = req.originalUser || req.user;
      
      if (!effectiveUser) {
        return res.status(401).json({ message: "Unauthorized - please log in" });
      }
      
      if (effectiveUser.role !== 'super_admin') {
        return res.status(403).json({ message: "Forbidden: Super admin access required" });
      }
      
      next();
    } catch (error: any) {
      console.error("Error verifying super admin status:", error);
      res.status(500).json({ message: "Error verifying super admin status" });
    }
  };

  // Staff or admin middleware - checks if user is staff, admin, or super admin
  const isStaffOrAdmin = async (req: any, res: any, next: any) => {
    try {
      const effectiveUser = req.originalUser || req.user;
      
      if (!effectiveUser) {
        return res.status(401).json({ message: "Unauthorized - please log in" });
      }
      
      if (!['staff', 'admin', 'super_admin'].includes(effectiveUser.role)) {
        return res.status(403).json({ message: "Forbidden: Staff or admin access required" });
      }
      
      next();
    } catch (error: any) {
      console.error("Error verifying staff/admin status:", error);
      res.status(500).json({ message: "Error verifying staff/admin status" });
    }
  };

  // Wholesale customer middleware - checks if user is a wholesale customer or super admin
  const isWholesaleCustomer = async (req: any, res: any, next: any) => {
    try {
      if (!req.user) {
        return res.status(401).json({ message: "Unauthorized - please log in" });
      }
      
      // Allow wholesale customers and super admins (for testing/viewing purposes)
      if (req.user.role !== 'wholesale_customer' && req.user.role !== 'super_admin') {
        return res.status(403).json({ message: "Forbidden: Wholesale customer access required" });
      }
      
      next();
    } catch (error: any) {
      console.error("Error verifying wholesale customer status:", error);
      res.status(500).json({ message: "Error verifying wholesale customer status" });
    }
  };

  /**
   * Allows staff/admin, or the wholesale customer who actually owns the order named by
   * `:id`. Invoice viewing and paying were staff-only, so a customer clicking "Pay Now"
   * on their own invoice got Access Denied — they could see an amount owed but had no
   * way to look at or settle it.
   */
  const isStaffOrOwningWholesaleCustomer = async (req: any, res: any, next: any) => {
    try {
      if (!req.user) {
        return res.status(401).json({ message: "Unauthorized - please log in" });
      }
      if (['staff', 'admin', 'super_admin'].includes(req.user.role)) {
        return next();
      }
      if (req.user.role !== 'wholesale_customer') {
        return res.status(403).json({ message: "Forbidden" });
      }

      const customer = await storage.getWholesaleCustomerByUserId(req.user.id);
      const order = customer ? await storage.getWholesaleOrder(req.params.id) : undefined;
      // Same 404-for-not-yours response either way, so this can't be used to probe
      // which order ids exist.
      if (!customer || !order || order.customerId !== customer.id) {
        return res.status(404).json({ message: "Order not found" });
      }

      next();
    } catch (error: any) {
      console.error("Error verifying wholesale order ownership:", error);
      res.status(500).json({ message: "Error verifying access" });
    }
  };

  /**
   * Wholesale application — the public front door for a retailer who wants to carry us.
   *
   * Deliberately creates a LEAD, never an account: accounts stay staff-created, so this
   * page adds no account-spam surface. Previously an interested retailer had no path at
   * all (the login page only rejected them), and contact-form inquiries were emailed but
   * never recorded, so they had to be retyped into the CRM by hand or were simply lost.
   */
  app.post("/api/wholesale/apply", async (req, res) => {
    try {
      const ip = req.ip || req.socket.remoteAddress || "unknown";
      if (!checkSubmissionRateLimit(`wholesale-apply:${ip}`, 5, 60 * 60 * 1000)) {
        return res.status(429).json({ message: "Too many applications from this connection. Please try again later." });
      }
      // Silently accept-and-drop, so a bot can't tell it was filtered.
      if (isHoneypotTripped(req.body)) {
        return res.json({ success: true, message: "Application received" });
      }

      const applicationSchema = z.object({
        businessName: z.string().min(2, "Business name is required"),
        contactName: z.string().min(2, "Contact name is required"),
        email: z.string().email("Please enter a valid email"),
        phone: z.string().min(7, "Phone number is required"),
        // Required — enforced here too, not just in the browser, since the endpoint is
        // public and a form can be bypassed. Without an address a lead can't be quoted,
        // routed, or geocoded.
        address: z.string().min(1, "Street address is required"),
        city: z.string().min(1, "City is required"),
        state: z.string().min(1, "State is required"),
        zipCode: z.string().min(1, "ZIP code is required"),
        deliveryInstructions: z.string().optional(),
      });

      const data = applicationSchema.parse(req.body);

      // The leads table has no columns for the application specifics, so they're kept as
      // readable notes rather than being dropped on the floor.
      const notes = [
        "— Wholesale application from the website —",
        `Address: ${data.address}, ${data.city}, ${data.state} ${data.zipCode}`,
        // Copy these onto the location record when converting this lead to an account.
        data.deliveryInstructions && `\nDelivery instructions:\n${data.deliveryInstructions}`,
      ].filter(Boolean).join("\n");

      const lead = await storage.createLead({
        businessName: data.businessName,
        contactName: data.contactName,
        email: data.email,
        phone: data.phone,
        // Every web application starts at the same priority — there's no longer a signal
        // on the form to rank them by, and staff triage from the CRM anyway.
        priorityLevel: "medium",
        status: "new",
        notes,
      });

      // Notify staff, but never fail the applicant's submission because email is down —
      // the lead is already safely recorded.
      try {
        // Applications go to admins and super-admins only (owner, 2026-09-02) —
        // account setup is their call, not general staff's.
        const staffUsers = await db
          .select({ email: users.email })
          .from(users)
          .where(sql`${users.role} IN ('admin', 'super_admin') AND ${users.email} IS NOT NULL`);
        const staffEmails = staffUsers.map(u => u.email).filter((e): e is string => e !== null);
        if (staffEmails.length > 0) {
          await sendContactFormNotification({
            staffEmails,
            contactName: data.contactName,
            contactEmail: data.email,
            contactPhone: data.phone,
            contactCompany: data.businessName,
            message: `NEW WHOLESALE APPLICATION\n\n${notes}`,
          });
        }
      } catch (emailError: any) {
        console.error("[WHOLESALE APPLY] Lead saved but staff email failed:", emailError.message);
      }

      console.log(`[WHOLESALE APPLY] New lead ${lead.id} from ${data.businessName}`);
      res.json({ success: true, message: "Application received" });
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid form data", errors: error.errors });
      }
      console.error("Error processing wholesale application:", error);
      res.status(500).json({ message: "Error submitting application" });
    }
  });

  /**
   * Identical reply whether or not the address belongs to a wholesale customer. Anything
   * more specific tells a stranger which businesses we supply.
   */
  const GENERIC_CODE_SENT_MESSAGE =
    "If that email is on a wholesale account, we've sent a sign-in link and code to it.";

  /**
   * Hold the response until `startedAt + FLOOR`, so the found and not-found paths take the
   * same observable time. Identical wording alone isn't enough: the found path writes a
   * verification row and the miss path does no I/O at all, which measured ~250ms apart —
   * enough to distinguish them and re-open the enumeration the wording closes.
   */
  const LOGIN_RESPONSE_FLOOR_MS = 300;
  async function padLoginResponse(startedAt: number) {
    const remaining = LOGIN_RESPONSE_FLOOR_MS - (Date.now() - startedAt);
    if (remaining > 0) await new Promise((r) => setTimeout(r, remaining));
  }

  /**
   * Resolve (or create) the user row backing a wholesale customer, and make sure
   * `wholesale_customers.user_id` points at it. Shared by the code and magic-link paths so
   * the two can't drift.
   */
  /**
   * The user row for an email that verified a login link but is not on any wholesale
   * account yet — the start of the claim flow. Reuses an existing customer-side user row;
   * a brand-new email gets a passwordless wholesale_customer user with no account attached.
   */
  async function resolveClaimantUser(email: string) {
    const existing = await storage.getUserByEmail(email);
    if (existing) {
      if (!['user', 'wholesale_customer'].includes(existing.role)) {
        throw new Error("Staff accounts can't sign in through the wholesale form");
      }
      return existing;
    }
    const username = email.split('@')[0].replace(/[^a-zA-Z0-9]/g, '_') + '-' + crypto.randomUUID().slice(0, 8);
    const created = await storage.createUser({ username, email });
    return (await storage.updateUserRole(created.id, 'wholesale_customer')) || created;
  }

  async function resolveWholesaleUser(wholesaleCustomer: any, loginEmail?: string) {
    // One user PER EMAIL, not per customer. Each authorized contact is their own login,
    // so orders record who placed them and confirmations go to that person (owner
    // decision 2026-08-23). Legacy accounts had one shared user carrying the primary
    // email — the primary still matches it by email below, and every other contact gets
    // their own row the first time they sign in after this change.
    const email = String(loginEmail || wholesaleCustomer.email).trim();
    const isPrimary = email.toLowerCase() === String(wholesaleCustomer.email).trim().toLowerCase();

    // A user row may already exist for this email (legacy shared user, bulk import, a
    // retail account). Adopt it instead of creating a second one — createUser would
    // violate users_email_unique and 500, which is exactly what locked every imported
    // customer out of the site.
    let user = await storage.getUserByEmail(email);
    if (user) {
      if (!['user', 'wholesale_customer'].includes(user.role)) {
        // Never convert a staff login. send-email-code refuses these up front; a stale
        // link could still get here.
        throw new Error("Staff accounts can't sign in through the wholesale form");
      }
      if (user.role !== 'wholesale_customer' || user.wholesaleCustomerId !== wholesaleCustomer.id) {
        // The verification row bound this email to this customer, so a stale link to some
        // other customer (email reassigned) is corrected here.
        await db.execute(sql`UPDATE users SET role = 'wholesale_customer', wholesale_customer_id = ${wholesaleCustomer.id} WHERE id = ${user.id}`);
        user = (await storage.getUser(user.id)) || user;
        console.log(`[WHOLESALE AUTH] Linked existing user ${user.id} (${email}) to wholesale customer ${wholesaleCustomer.id}`);
      }
    } else {
      const username = email.split('@')[0].replace(/[^a-zA-Z0-9]/g, '_') + '-' + wholesaleCustomer.id.substring(0, 8);
      user = await storage.createUser({
        username,
        email,
        firstName: isPrimary ? wholesaleCustomer.contactName.split(' ')[0] : undefined,
        lastName: isPrimary ? (wholesaleCustomer.contactName.split(' ').slice(1).join(' ') || undefined) : undefined,
      });
      await db.execute(sql`UPDATE users SET role = 'wholesale_customer', wholesale_customer_id = ${wholesaleCustomer.id} WHERE id = ${user.id}`);
      user = (await storage.getUser(user.id)) || user;
      console.log(`[WHOLESALE AUTH] Created user account ${user.id} (${email}) for wholesale customer ${wholesaleCustomer.id}`);
    }

    // Keep the legacy pointer for the primary email so old lookups still resolve.
    if (isPrimary && !wholesaleCustomer.userId) {
      await storage.updateWholesaleCustomer(wholesaleCustomer.id, { userId: user.id });
    }

    return user;
  }

  /**
   * Build the Stripe Checkout session a wholesale customer uses to pay an invoice.
   *
   * ONE builder for every wholesale payment link — the "Pay by bank transfer" button and
   * the link in the emailed invoice. They used to be two separate `sessions.create` calls,
   * and when the button was switched to ACH the emailed link stayed on cards, quietly
   * leaving a way to pay by card. Anything about how wholesale pays belongs here.
   */
  /** Stripe customer per wholesale business, created on first use, so Checkout can
   *  remember their bank/card between invoices. Self-heals stale ids. */
  async function ensureWholesaleStripeCustomer(customer: any, forceNew = false): Promise<string> {
    if (customer.stripeCustomerId && !forceNew) return customer.stripeCustomerId;
    const created = await stripe!.customers.create({
      name: customer.businessName,
      email: customer.email,
      metadata: { wholesaleCustomerId: customer.id, type: 'wholesale' },
    });
    await storage.updateWholesaleCustomer(customer.id, { stripeCustomerId: created.id } as any);
    customer.stripeCustomerId = created.id;
    return created.id;
  }

  async function createWholesaleCheckoutSession(order: any, customer: any, items: any[]) {
    if (!stripe) throw new Error("Stripe is not configured");
    const baseUrl = getBaseUrl();

    // ONE line for the full invoice total, not per-item lines. Invoices can carry signed
    // adjustments (pallet fees, damage credits) and Stripe line items cannot be negative,
    // so itemizing would either drop credits or drift from totalAmount. The itemized view
    // lives on the invoice page; the charge must simply equal the invoice.
    const lineItems = [{
      price_data: {
        currency: 'usd',
        product_data: { name: `Invoice ${order.invoiceNumber} — Puget Sound Kombucha Co.` },
        unit_amount: Math.round(parseFloat(order.totalAmount) * 100),
      },
      quantity: 1,
    }];
    void items; // itemization intentionally not sent to Stripe

    const paymentMetadata = {
      orderId: order.id,
      invoiceNumber: order.invoiceNumber,
      type: 'wholesale_invoice_payment',
    };

    const buildParams = (stripeCustomerId: string): Stripe.Checkout.SessionCreateParams => ({
      mode: 'payment',
      // Each method is an independent per-customer switch. ACH is ASYNCHRONOUS —
      // authorised here, funds settle days later via payment_intent.succeeded (see
      // settleWholesaleInvoice); card settles instantly and checkout.session.completed
      // marks it paid on the spot. Callers must not create a session when both are off.
      payment_method_types: [
        ...(customer.allowOnlinePayment !== false ? ['us_bank_account' as const] : []),
        ...(customer.allowCardPayment !== false ? ['card' as const] : []),
      ],
      ...(customer.allowOnlinePayment !== false ? {
        payment_method_options: {
          us_bank_account: { verification_method: 'automatic' },
        },
      } : {}),
      line_items: lineItems,
      // Attach the business's Stripe customer and let Checkout SAVE the payment
      // method: next invoice, Stripe re-offers "Bank ····1234" one-click instead of
      // a fresh bank login every time.
      customer: stripeCustomerId,
      saved_payment_method_options: { payment_method_save: 'enabled' },
      metadata: paymentMetadata,
      // Repeated on the PaymentIntent: settlement events fire against the intent, not the
      // session, and would otherwise have no way to identify the order.
      payment_intent_data: {
        metadata: paymentMetadata,
        description: `Invoice ${order.invoiceNumber} — ${customer.businessName}`,
      },
      success_url: `${baseUrl}/wholesale-customer/invoice/${order.id}/payment-success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${baseUrl}/wholesale-customer/invoice/${order.id}`,
    });

    try {
      return await stripe.checkout.sessions.create(buildParams(await ensureWholesaleStripeCustomer(customer)));
    } catch (e: any) {
      // Stale reference (deleted in Stripe, or from another mode) — mint fresh, retry.
      if (e?.code !== 'resource_missing') throw e;
      console.warn(`[WHOLESALE PAY] Stale Stripe customer for ${customer.businessName} — recreating`);
      return await stripe.checkout.sessions.create(buildParams(await ensureWholesaleStripeCustomer(customer, true)));
    }
  }

  /**
   * Mark a wholesale invoice as SETTLED and send the receipts.
   *
   * Only call this when the money has actually arrived. With ACH that means
   * `payment_intent.succeeded`, NOT `checkout.session.completed` — the customer authorises
   * the debit at checkout and the funds land ~4-5 business days later, and the debit can
   * still be returned in between. Marking paid at authorisation would show invoices
   * settled that may never fund.
   *
   * Idempotent: a no-op if the order is already paid, so a replayed webhook can't send a
   * second receipt.
   */
  /** Payment receipt to the location's invoice inbox(es), account email otherwise —
   *  the same routing invoices use. Called on online settlement AND staff mark-paid. */
  async function sendWholesaleReceiptForOrder(orderId: string, paidAt: Date) {
    const details = await storage.getWholesaleOrderWithDetails(orderId);
    if (!details) return;
    const { order, customer, items } = details;
    const recipients = String((order.location as any)?.contactEmail || customer.email)
      .split(/[,;]/)
      .map((e) => e.trim())
      .filter(Boolean);
    if (!recipients.length) return;
    const locName = order.location?.locationName;
    await sendWholesalePaymentReceipt({
      poNumber: (order as any).poNumber ?? null,
      customerEmail: recipients,
      businessName: locName && locName !== 'Main Location' ? `${customer.businessName} — ${locName}` : customer.businessName,
      contactName: customer.contactName || customer.businessName,
      invoiceNumber: order.invoiceNumber,
      amount: Number(order.totalAmount),
      paidAt,
      items: items.map((item: any) => ({
        productName: item.product.flavor ? `${item.product.name} - ${item.product.flavor}` : item.product.name,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
      })),
    });
  }

  async function settleWholesaleInvoice(orderId: string, paymentIntentId?: string) {
    const order = await storage.getWholesaleOrder(orderId);
    if (!order) {
      console.error(`[WEBHOOK] Settlement for unknown wholesale order ${orderId}`);
      return;
    }
    if (order.paidAt) {
      console.log(`[WEBHOOK] Wholesale invoice ${order.invoiceNumber} already settled — ignoring duplicate`);
      return;
    }

    const paidAt = new Date();
    await storage.updateWholesaleOrder(orderId, {
      paidAt,
      paymentFailedAt: null,
      ...(paymentIntentId ? { stripePaymentIntentId: paymentIntentId } : {}),
    });
    console.log(`[WEBHOOK] ✅ Wholesale invoice ${order.invoiceNumber} settled (funds received)`);

    // Receipt to the customer (owner reversal 2026-08-31 of the 2026-08-19 no-receipt
    // policy): now that locations bill their own AP inboxes, settlement sends a receipt
    // to the same address(es) the invoice went to.
    sendWholesaleReceiptForOrder(orderId, paidAt).catch((e) =>
      console.error('[WEBHOOK] Failed to send payment receipt:', e.message));

    const customer = await storage.getWholesaleCustomer(order.customerId);

    try {
      const admins = await storage.getUsersByRole('admin');
      const superAdmins = await storage.getUsersByRole('super_admin');
      const adminEmails = [...admins, ...superAdmins]
        .map(u => u.email)
        .filter((email): email is string => !!email);

      if (adminEmails.length > 0 && customer) {
        const paidLoc = order.locationId ? await storage.getWholesaleLocation(order.locationId) : null;
        await sendWholesaleInvoicePaidNotification({
          adminEmails,
          businessName: paidLoc?.locationName && paidLoc.locationName !== 'Main Location'
            ? `${customer.businessName} — ${paidLoc.locationName}`
            : customer.businessName,
          invoiceNumber: order.invoiceNumber,
          amount: Number(order.totalAmount),
          paidAt,
        });
      }
    } catch (emailError) {
      console.error('[WEBHOOK] Failed to send admin notification for invoice payment:', emailError);
    }
  }

  // Contact form submission
  app.post("/api/contact", async (req, res) => {
    try {
      const ip = req.ip || req.socket.remoteAddress || "unknown";
      if (!checkSubmissionRateLimit(`contact:${ip}`, 5, 60 * 60 * 1000)) {
        return res.status(429).json({ message: "Too many messages from this connection. Please try again later." });
      }
      if (isHoneypotTripped(req.body)) {
        return res.json({ success: true, message: "Your message has been sent successfully" });
      }

      const contactFormSchema = z.object({
        name: z.string().min(2, "Name must be at least 2 characters"),
        email: z.string().email("Please enter a valid email"),
        phone: z.string().optional(),
        company: z.string().optional(),
        message: z.string().min(10, "Message must be at least 10 characters"),
      });

      const validatedData = contactFormSchema.parse(req.body);

      // Get all staff member emails (staff, admin, super_admin)
      const staffUsers = await db
        .select({ email: users.email })
        .from(users)
        .where(
          sql`${users.role} IN ('staff', 'admin', 'super_admin') AND ${users.email} IS NOT NULL`
        );

      const staffEmails = staffUsers
        .map(u => u.email)
        .filter((email): email is string => email !== null);

      // Send notification to staff
      if (staffEmails.length > 0) {
        await sendContactFormNotification({
          staffEmails,
          contactName: validatedData.name,
          contactEmail: validatedData.email,
          contactPhone: validatedData.phone,
          contactCompany: validatedData.company,
          message: validatedData.message,
        });
      }

      // A business enquiry is a sales lead, so record it instead of leaving it to live
      // only in an inbox. Never block the sender on this.
      if (validatedData.company) {
        try {
          await storage.createLead({
            businessName: validatedData.company,
            contactName: validatedData.name,
            email: validatedData.email,
            phone: validatedData.phone,
            priorityLevel: "medium",
            status: "new",
            notes: `— Contact form enquiry —\n\n${validatedData.message}`,
          });
        } catch (leadError: any) {
          console.error("[CONTACT] Message sent but lead was not recorded:", leadError.message);
        }
      }

      res.json({
        success: true,
        message: "Your message has been sent successfully"
      });
    } catch (error: any) {
      console.error("Error processing contact form:", error);
      
      if (error instanceof z.ZodError) {
        return res.status(400).json({ 
          message: "Invalid form data", 
          errors: error.errors 
        });
      }
      
      res.status(500).json({ 
        message: "Error processing contact form: " + error.message 
      });
    }
  });

  // Check if email already has an account.
  // Retail checkout uses this to offer sign-in instead of duplicate signup, so it stays —
  // but it answers for ANY address, which makes it a customer-list harvester if left
  // unmetered. The per-IP cap keeps the legitimate one-at-a-time use working while making
  // bulk enumeration impractical.
  app.post("/api/check-email", async (req, res) => {
    try {
      const { email } = req.body;

      if (!email) {
        return res.status(400).json({ message: "Email is required" });
      }

      const ip = req.ip || req.socket.remoteAddress || "unknown";
      if (!checkSubmissionRateLimit(`check-email:${ip}`, 20, 60 * 60 * 1000)) {
        return res.status(429).json({ message: "Too many requests. Please try again later." });
      }

      // Validate email format
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email)) {
        return res.status(400).json({ message: "Invalid email address" });
      }

      // Check if user exists with this email
      const user = await storage.getUserByEmail(email);
      
      res.json({ exists: !!user });
    } catch (error: any) {
      console.error("Error checking email:", error);
      res.status(500).json({ message: "Error checking email: " + error.message });
    }
  });

  // Email verification routes
  app.post("/api/send-email-verification-code", async (req, res) => {
    try {
      const { email } = req.body;
      
      if (!email) {
        return res.status(400).json({ message: "Email is required" });
      }

      // Validate email format
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email)) {
        return res.status(400).json({ message: "Invalid email address" });
      }

      // Check if user exists with this email
      const user = await storage.getUserByEmailOrUsername(email);
      if (!user) {
        return res.status(400).json({ message: "No account found with this email" });
      }

      // Generate 6-digit code
      const code = Math.floor(100000 + Math.random() * 900000).toString();
      
      // Store code in database with 5-minute expiration
      const expiresAt = new Date(Date.now() + 5 * 60 * 1000);
      await storage.createEmailVerificationCode({
        email,
        code,
        expiresAt,
        verified: false,
        purpose: 'login'
      });

      // Try to send email, but don't fail if it doesn't work (e.g., in test environment)
      try {
        await sendEmailVerificationCode({ email, code });
        console.log(`[EMAIL] Verification code sent to ${email}`);
      } catch (emailError: any) {
        console.warn(`[EMAIL] Failed to send verification email to ${email}:`, emailError.message);
        console.log(`[EMAIL] Verification code for ${email} stored in database: ${code}`);
      }

      res.json({ message: "Verification code sent to your email" });
    } catch (error: any) {
      console.error("Error sending email verification code:", error);
      res.status(500).json({ message: "Error sending verification code: " + error.message });
    }
  });

  app.post("/api/verify-email-code", async (req, res) => {
    try {
      const { email, code } = req.body;
      
      if (!email || !code) {
        return res.status(400).json({ message: "Email and code are required" });
      }

      // Get latest verification code for this email
      const verificationCode = await storage.getLatestEmailVerificationCode(email);
      
      if (!verificationCode) {
        return res.status(400).json({ message: "No verification code found" });
      }

      // Check if code is expired
      if (new Date() > verificationCode.expiresAt) {
        return res.status(400).json({ message: "Verification code has expired" });
      }

      // Cap wrong guesses. The send rate limit caps how many codes get emailed, not how
      // many times each is guessed — without this a live 6-digit code can be brute-forced
      // inside its 5-minute window. Mirrors the retail 2FA check in auth.ts.
      if ((verificationCode.attempts ?? 0) >= MAX_CODE_ATTEMPTS) {
        return res.status(429).json({ message: "Too many incorrect attempts. Please request a new code." });
      }

      // Check if code matches
      if (verificationCode.code !== code) {
        // Increment attempts
        await storage.incrementEmailVerificationAttempts(verificationCode.id);
        return res.status(400).json({ message: "Invalid verification code" });
      }

      // Check if already verified
      if (verificationCode.verified) {
        return res.status(400).json({ message: "Verification code already used" });
      }

      // Mark as verified
      await storage.markEmailVerificationCodeAsVerified(verificationCode.id);

      // Get user to log them in
      const user = await storage.getUserByEmailOrUsername(email);
      if (!user) {
        return res.status(400).json({ message: "User not found" });
      }

      // Log the user in
      req.login(user, (err) => {
        if (err) {
          console.error("Login error:", err);
          return res.status(500).json({ message: "Error logging in" });
        }
        res.json({ message: "Email verified and logged in successfully", user });
      });
    } catch (error: any) {
      console.error("Error verifying email code:", error);
      res.status(500).json({ message: "Error verifying code: " + error.message });
    }
  });

  // Wholesale-specific email authentication
  app.post("/api/wholesale/send-email-code", async (req, res) => {
    const startedAt = Date.now();
    try {
      const { email, claimCustomerId, claimLocationId } = req.body;

      if (!email) {
        return res.status(400).json({ message: "Email is required" });
      }

      // Validate email format
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email)) {
        return res.status(400).json({ message: "Invalid email address" });
      }

      // Rate limit: max 5 requests per email per 15 minutes...
      if (!checkEmailCodeRateLimit(email)) {
        return res.status(429).json({ message: GENERIC_CODE_SENT_MESSAGE });
      }
      // ...and per IP, because the per-email limit does nothing against someone probing a
      // thousand DIFFERENT addresses to work out who our customers are.
      const ip = req.ip || req.socket.remoteAddress || "unknown";
      if (!checkSubmissionRateLimit(`wholesale-code:${ip}`, 20, 60 * 60 * 1000)) {
        return res.status(429).json({ message: GENERIC_CODE_SENT_MESSAGE });
      }

      // ENUMERATION: the response is identical whether or not the account exists — it used
      // to say "No wholesale account found with this email", which let anyone confirm which
      // businesses we supply, one address at a time.
      //
      // Deliberately NOT awaited. Wording alone isn't enough: looking the customer up and
      // writing a verification row takes real time that the not-found path doesn't spend,
      // and that difference was measurable (~250ms) — enough to answer the question the
      // wording refuses to. Doing all of it after the response means the reply's timing
      // carries no information. The customer is going to their inbox either way, so a
      // couple of hundred milliseconds of background work costs them nothing.
      void (async () => {
        try {
          const wholesaleCustomer = await storage.getWholesaleCustomerByAnyEmail(email);
          // Sign-in exists only to expose account data (order history, invoices), and
          // ordering itself needs no sign-in at all — so links go to KNOWN billing
          // contacts only (owner decision 2026-08-27). Unknown emails get the same
          // generic reply and no link; staff add new contacts on the customer.
          if (!wholesaleCustomer) {
            console.log(`[WHOLESALE AUTH] Sign-in requested for unknown email (generic reply sent, no link)`);
            return;
          }

          const code = Math.floor(100000 + Math.random() * 900000).toString();
          // Magic-link token: 32 random bytes, so it is not guessable the way 6 digits are.
          const loginToken = crypto.randomBytes(32).toString("hex");

          // SECURITY: bind the code to the customer id, so a code can't be replayed against
          // a different account if an email address is ever reassigned.
          await storage.createEmailVerificationCode({
            email,
            code,
            loginToken,
            expiresAt: new Date(Date.now() + 15 * 60 * 1000),
            verified: false,
            purpose: 'login',
            wholesaleCustomerId: wholesaleCustomer.id,
            // The picked delivery location rides along and is preselected on the order
            // page after redemption — validated against the bound customer here.
            claimLocationId: null,
          });

          const magicLink = `${getBaseUrl()}/wholesale/login?token=${loginToken}`;

          try {
            await sendEmailVerificationCode({ email, code, magicLink, expiresMinutes: 15 });
            console.log(`[WHOLESALE AUTH] Login email sent to ${email} for ${wholesaleCustomer ? `customer ${wholesaleCustomer.id}` : 'a new contact (claim flow)'}`);
          } catch (emailError: any) {
            console.warn(`[WHOLESALE AUTH] Failed to send login email to ${email}:`, emailError.message);
            console.log(`[WHOLESALE AUTH] Code for ${email} (${wholesaleCustomer ? `customer ${wholesaleCustomer.id}` : 'new contact'}): ${code}`);
            console.log(`[WHOLESALE AUTH] Magic link: ${magicLink}`);
          }
        } catch (bgError: any) {
          console.error("[WHOLESALE AUTH] Background login-email work failed:", bgError.message);
        }
      })();

      // Small constant floor so the reply doesn't vary with how fast the request was parsed.
      await padLoginResponse(startedAt);
      res.json({ message: GENERIC_CODE_SENT_MESSAGE });
    } catch (error: any) {
      // Even a server-side failure must not distinguish the two cases, so this returns the
      // same padded generic reply and logs the detail instead.
      console.error("Error sending wholesale email verification code:", error);
      await padLoginResponse(startedAt);
      res.json({ message: GENERIC_CODE_SENT_MESSAGE });
    }
  });

  /**
   * Redeem a magic link. The token carries its own entropy, so unlike the code path this
   * takes no email — there is nothing here to probe for account existence.
   */
  app.post("/api/wholesale/verify-magic-link", async (req, res) => {
    try {
      const { token } = req.body;
      if (!token || typeof token !== "string") {
        return res.status(400).json({ message: "Invalid sign-in link" });
      }

      // Guessing a 32-byte token is infeasible, but cap attempts anyway so this can't be
      // used as an unmetered lookup endpoint.
      const ip = req.ip || req.socket.remoteAddress || "unknown";
      if (!checkSubmissionRateLimit(`wholesale-magic:${ip}`, 30, 60 * 60 * 1000)) {
        return res.status(429).json({ message: "Too many attempts. Please try again later." });
      }

      const verificationCode = await storage.getEmailVerificationCodeByToken(token);
      // One deliberately vague message for missing/used/expired, so a stale link in an
      // inbox reveals nothing about whether the account exists.
      const invalid = { message: "This sign-in link is no longer valid. Please request a new one." };

      if (!verificationCode || verificationCode.verified) {
        return res.status(400).json(invalid);
      }
      if (new Date() > verificationCode.expiresAt) {
        return res.status(400).json(invalid);
      }

      // A row with no customer is a new contact starting the claim flow ("which store are
      // you ordering for?"); a row with one is an ordinary sign-in.
      let wholesaleCustomer: any = null;
      if (verificationCode.wholesaleCustomerId) {
        wholesaleCustomer = await storage.getWholesaleCustomer(verificationCode.wholesaleCustomerId);
        if (!wholesaleCustomer) {
          return res.status(400).json(invalid);
        }
      }

      // Single use: consuming the link also retires the 6-digit code on the same row.
      await storage.markEmailVerificationCodeAsVerified(verificationCode.id);

      let user;
      if (verificationCode.purpose === 'claim-login' && wholesaleCustomer) {
        // Store-first flow: the visitor picked their store before verifying the email.
        // Joining goes through the same self-join path as the claim page — join record,
        // email added to the store's contacts, staff feed entry.
        const claimant = await resolveClaimantUser(verificationCode.email);
        await createLinkRequest({ id: claimant.id, email: verificationCode.email }, wholesaleCustomer);
        user = (await storage.getUser(claimant.id)) || claimant;
      } else {
        user = wholesaleCustomer
          ? await resolveWholesaleUser(wholesaleCustomer, verificationCode.email)
          : await resolveClaimantUser(verificationCode.email);
      }

      req.login(user, (err) => {
        if (err) {
          console.error("Wholesale magic-link login error:", err);
          return res.status(500).json({ message: "Error logging in" });
        }
        console.log(`[WHOLESALE AUTH] User ${user.id} logged in via magic link ${wholesaleCustomer ? `for customer ${wholesaleCustomer.id}` : '(claim flow)'}`);
        res.json({
          message: "Signed in successfully",
          user,
          needsClaim: !wholesaleCustomer && verificationCode.purpose !== 'claim-login',
          preferredLocationId: (verificationCode as any).claimLocationId ?? null,
        });
      });
    } catch (error: any) {
      console.error("Error verifying wholesale magic link:", error);
      res.status(500).json({ message: "Error signing in" });
    }
  });

  app.post("/api/wholesale/verify-email-code", async (req, res) => {
    try {
      const { email, code } = req.body;
      
      if (!email || !code) {
        return res.status(400).json({ message: "Email and code are required" });
      }

      // ENUMERATION: every failure below returns this one string. Distinct messages —
      // "no account found", "code expired", "already used" — each confirm that an account
      // exists for the address, which is exactly what the generic send response prevents.
      // The specifics go to the server log, not to the caller.
      const invalidCode = { message: "Invalid or expired verification code" };

      // May be null: a new contact verifying an email before claiming a store.
      const wholesaleCustomer = await storage.getWholesaleCustomerByAnyEmail(email);

      // Get latest verification code for this email
      const verificationCode = await storage.getLatestEmailVerificationCode(email);

      if (!verificationCode) {
        return res.status(400).json(invalidCode);
      }

      // SECURITY: Verify the code is bound to the correct wholesale customer
      // This prevents code reuse if emails are reassigned between customers
      const isClaimLogin = verificationCode.purpose === 'claim-login';
      if (!isClaimLogin && (verificationCode.wholesaleCustomerId ?? null) !== (wholesaleCustomer?.id ?? null)) {
        console.error(`[WHOLESALE AUTH] Code mismatch: code bound to ${verificationCode.wholesaleCustomerId}, but email ${email} belongs to ${wholesaleCustomer?.id ?? 'no account'}`);
        return res.status(400).json(invalidCode);
      }

      if (new Date() > verificationCode.expiresAt) {
        return res.status(400).json(invalidCode);
      }

      // Cap wrong guesses. The send rate limit caps how many codes get emailed, not how
      // many times each is guessed — without this a live 6-digit code can be brute-forced
      // inside its window. Mirrors the retail 2FA check in auth.ts.
      if ((verificationCode.attempts ?? 0) >= MAX_CODE_ATTEMPTS) {
        return res.status(429).json({ message: "Too many incorrect attempts. Please request a new code." });
      }

      // Check if code matches
      if (verificationCode.code !== code) {
        await storage.incrementEmailVerificationAttempts(verificationCode.id);
        return res.status(400).json(invalidCode);
      }

      if (verificationCode.verified) {
        return res.status(400).json(invalidCode);
      }

      // Mark as verified
      await storage.markEmailVerificationCodeAsVerified(verificationCode.id);

      let user;
      if (isClaimLogin && verificationCode.wholesaleCustomerId) {
        const claimCustomer = await storage.getWholesaleCustomer(verificationCode.wholesaleCustomerId);
        if (!claimCustomer) return res.status(400).json(invalidCode);
        const claimant = await resolveClaimantUser(email);
        await createLinkRequest({ id: claimant.id, email }, claimCustomer);
        user = (await storage.getUser(claimant.id)) || claimant;
      } else {
        user = wholesaleCustomer
          ? await resolveWholesaleUser(wholesaleCustomer, email)
          : await resolveClaimantUser(email);
      }

      // Log the user in
      req.login(user, (err) => {
        if (err) {
          console.error("Wholesale login error:", err);
          return res.status(500).json({ message: "Error logging in" });
        }
        console.log(`[WHOLESALE AUTH] User ${user.id} logged in via email ${email} ${wholesaleCustomer ? `for customer ${wholesaleCustomer.id}` : '(claim flow)'}`);
        res.json({
          message: "Email verified and logged in successfully",
          user,
          needsClaim: !wholesaleCustomer && !isClaimLogin,
          preferredLocationId: (verificationCode as any).claimLocationId ?? null,
        });
      });
    } catch (error: any) {
      console.error("Error verifying wholesale email code:", error);
      res.status(500).json({ message: "Error verifying code: " + error.message });
    }
  });

  // Update user profile
  app.patch("/api/update-profile", isAuthenticated, async (req, res) => {
    try {
      const user = req.user;
      if (!user) {
        return res.status(401).json({ message: "Unauthorized" });
      }

      // Validate request body
      const validationResult = updateProfileSchema.safeParse(req.body);
      if (!validationResult.success) {
        return res.status(400).json({ 
          message: "Validation failed", 
          errors: validationResult.error.errors 
        });
      }

      const updates = validationResult.data;
      if (updates.phoneNumber) updates.phoneNumber = formatPhoneNumber(updates.phoneNumber);

      // Check if email is already taken by another user
      if (updates.email && updates.email !== user.email) {
        const existingUser = await db
          .select()
          .from(users)
          .where(eq(users.email, updates.email))
          .limit(1);
        
        if (existingUser.length > 0 && existingUser[0].id !== user.id) {
          return res.status(400).json({ message: "Email is already in use" });
        }
      }

      // Update user profile
      const [updatedUser] = await db
        .update(users)
        .set({
          ...updates,
          updatedAt: new Date(),
        })
        .where(eq(users.id, user.id))
        .returning();

      // Remove sensitive fields before returning
      const { password, ...userWithoutPassword } = updatedUser;

      res.json({ 
        message: "Profile updated successfully", 
        user: userWithoutPassword 
      });
    } catch (error: any) {
      console.error("Error updating profile:", error);
      res.status(500).json({ message: "Error updating profile: " + error.message });
    }
  });

  // Data Export - GDPR/Privacy compliance
  app.get("/api/my-data/export", isAuthenticated, async (req, res) => {
    try {
      const user = req.user;
      if (!user) {
        return res.status(401).json({ message: "Unauthorized" });
      }

      // Collect all user data
      const exportData: any = {
        exportedAt: new Date().toISOString(),
        userData: {
          id: user.id,
          username: user.username,
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
          phoneNumber: user.phoneNumber,
          role: user.role,
          createdAt: user.createdAt,
        },
        orders: [],
        subscriptions: [],
      };

      // Get retail orders (exclude soft-deleted)
      const orders = await db
        .select()
        .from(retailOrders)
        .where(and(eq(retailOrders.userId, user.id), isNull(retailOrders.deletedAt)));
      
      exportData.orders = orders.map(order => ({
        id: order.id,
        orderNumber: order.orderNumber,
        status: order.status,
        subtotal: order.subtotal,
        taxAmount: order.taxAmount,
        totalAmount: order.totalAmount,
        pickupDate: order.pickupDate,
        orderDate: order.orderDate,
      }));

      // Get retail subscriptions
      const subs = await db
        .select()
        .from(retailSubscriptions)
        .where(eq(retailSubscriptions.userId, user.id));
      
      exportData.subscriptions = subs.map(sub => ({
        id: sub.id,
        status: sub.status,
        subscriptionFrequency: sub.subscriptionFrequency,
        scheduledPickupDate: sub.scheduledPickupDate,
        scheduledPickupTime: sub.scheduledPickupTime,
      }));

      res.json({
        message: "Data export generated successfully",
        data: exportData
      });
    } catch (error: any) {
      console.error("Error exporting user data:", error);
      res.status(500).json({ message: "Error exporting data: " + error.message });
    }
  });

  // Account Deletion Request - GDPR/Privacy compliance
  app.delete("/api/my-account", isAuthenticated, async (req, res) => {
    try {
      const user = req.user;
      if (!user) {
        return res.status(401).json({ message: "Unauthorized" });
      }

      const { confirmDeletion } = req.body;
      
      if (confirmDeletion !== true) {
        return res.status(400).json({ 
          message: "Please confirm account deletion by setting confirmDeletion to true" 
        });
      }

      const stripeFailures: string[] = [];
      
      // Cancel active subscriptions (both local and Stripe)
      const activeSubs = await db
        .select()
        .from(retailSubscriptions)
        .where(and(
          eq(retailSubscriptions.userId, user.id),
          eq(retailSubscriptions.status, 'active')
        ));

      for (const sub of activeSubs) {
        // Cancel Stripe subscription if exists
        let stripeCancelled = false;
        if (stripe && sub.stripeSubscriptionId) {
          try {
            await stripe.subscriptions.cancel(sub.stripeSubscriptionId);
            console.log(`[ACCOUNT DELETION] Cancelled Stripe subscription ${sub.stripeSubscriptionId}`);
            stripeCancelled = true;
          } catch (stripeError: any) {
            console.error(`[ACCOUNT DELETION] Error cancelling Stripe subscription:`, stripeError.message);
            stripeFailures.push(sub.stripeSubscriptionId);
          }
        }
        
        // Update subscription status and clear Stripe IDs if successfully cancelled
        await db
          .update(retailSubscriptions)
          .set({ 
            status: 'cancelled',
            cancelledAt: new Date(),
            ...(stripeCancelled ? { 
              stripeSubscriptionId: null,
              stripeCheckoutSessionId: null
            } : {})
          })
          .where(eq(retailSubscriptions.id, sub.id));
      }

      // Anonymize PII in subscription records (regardless of Stripe status - GDPR right to be forgotten)
      await db
        .update(retailSubscriptions)
        .set({
          customerName: 'DELETED',
          customerEmail: 'deleted@deleted.local',
          customerPhone: null,
        })
        .where(eq(retailSubscriptions.userId, user.id));

      // Anonymize PII in order records
      await db
        .update(retailOrders)
        .set({
          customerName: 'DELETED',
          customerEmail: 'deleted@deleted.local',
          customerPhone: null,
          deliveryAddress: null,
          deliveryCity: null,
          deliveryState: null,
          deliveryZipCode: null,
        })
        .where(eq(retailOrders.userId, user.id));

      // Anonymize ALL user PII (for order history integrity, we keep the record but remove identifying info)
      await db
        .update(users)
        .set({
          username: `deleted_${user.id.slice(0, 8)}`,
          email: null,
          firstName: null,
          lastName: null,
          phoneNumber: null,
          address: null,
          city: null,
          state: null,
          zipCode: null,
          stripeCustomerId: null,
          password: 'DELETED',
          deletedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(users.id, user.id));

      // Log the user out
      req.logout((err) => {
        if (err) {
          console.error("Error logging out during account deletion:", err);
        }
      });

      // Report any Stripe failures (but don't block deletion - GDPR right to be forgotten takes precedence)
      if (stripeFailures.length > 0) {
        console.warn(`[ACCOUNT DELETION] Some Stripe subscriptions could not be cancelled: ${stripeFailures.join(', ')}`);
      }

      res.json({ 
        message: "Account deleted successfully. Your personal data has been removed.",
        ...(stripeFailures.length > 0 ? { 
          warning: "Some payment subscriptions may need manual cancellation. Please contact support if you see any unexpected charges." 
        } : {})
      });
    } catch (error: any) {
      console.error("Error deleting account:", error);
      res.status(500).json({ message: "Error deleting account: " + error.message });
    }
  });

  // Wholesale customer registration
  app.post("/api/register-wholesale", async (req, res) => {
    try {
      const { phoneNumber, username, password, businessName, contactName, email, phone, address } = req.body;

      if (!phoneNumber || !username || !password || !businessName || !contactName || !email || !phone || !address) {
        return res.status(400).json({ message: "All fields are required" });
      }

      // Check if phone number has been verified
      const verificationCode = await storage.getLatestVerificationCode(phoneNumber);
      
      if (!verificationCode || !verificationCode.verified) {
        return res.status(400).json({ message: "Phone number not verified" });
      }

      // Check if username already exists
      const existingUser = await storage.getUserByUsername(username);
      if (existingUser) {
        return res.status(400).json({ message: "Username already taken" });
      }

      // Check if email already exists in wholesale customers
      const existingCustomer = await storage.getWholesaleCustomerByEmail(email);
      if (existingCustomer) {
        return res.status(400).json({ message: "Email already registered as wholesale customer" });
      }

      // Import hashPassword function from auth
      const { hashPassword } = await import('./auth');
      
      // Create user with wholesale_customer role
      const user = await storage.createUser({
        username,
        password: await hashPassword(password),
        phoneNumber,
        email,
      });

      // Update user role to wholesale_customer
      await storage.updateUserRole(user.id, 'wholesale_customer');

      // Create wholesale customer record linked to user
      await storage.createWholesaleCustomer({
        userId: user.id,
        businessName,
        contactName,
        email,
        phone,
      });

      // Create Stripe customer (non-blocking - log errors but don't fail registration)
      createStripeCustomer({
        userId: user.id,
        email: user.email,
        phoneNumber: user.phoneNumber,
        firstName: contactName.split(' ')[0],
        lastName: contactName.split(' ').slice(1).join(' ') || undefined,
        username: user.username,
      }).catch(error => {
        console.error("[Wholesale Registration] Failed to create Stripe customer:", error);
      });

      res.status(201).json({ message: "Wholesale account created successfully" });
    } catch (error: any) {
      console.error("Wholesale registration error:", error);
      res.status(500).json({ message: "Registration failed: " + error.message });
    }
  });

  // Wholesale customer endpoints - for customers to view their own information and orders
  app.get("/api/wholesale-customer", isAuthenticated, isWholesaleCustomer, async (req, res) => {
    try {
      if (!req.user) {
        return res.status(401).json({ message: "Not authenticated" });
      }
      
      // Get wholesale customer record for authenticated user
      const customer = await storage.getWholesaleCustomerByUserId(req.user.id);
      if (!customer) {
        // Still waiting for staff to confirm them on a store: enough of the store to build
        // an order against (name + id), nothing else about the account.
        const pending = await getPendingClaim(req.user.id);
        if (pending) {
          return res.json({
            id: pending.customer.id,
            businessName: pending.customer.businessName,
            contactName: '',
            email: req.user.email,
            emails: [],
            phone: '',
            allowOnlinePayment: false,
            linkStatus: 'pending',
          });
        }
        return res.status(404).json({ message: "Wholesale customer record not found" });
      }

      res.json(customer);
    } catch (error: any) {
      res.status(500).json({ message: "Error fetching customer info: " + error.message });
    }
  });

  app.get("/api/wholesale-customer/orders", isAuthenticated, isWholesaleCustomer, async (req, res) => {
    try {
      if (!req.user) {
        return res.status(401).json({ message: "Not authenticated" });
      }
      
      // Get wholesale customer record for authenticated user
      const customer = await storage.getWholesaleCustomerByUserId(req.user.id);
      if (!customer) {
        // Pending contacts see no history until they're approved.
        if (await getPendingClaim(req.user.id)) return res.json([]);
        return res.status(404).json({ message: "Wholesale customer record not found" });
      }

      // Get orders for this customer only
      const orders = await storage.getWholesaleOrdersByCustomerId(customer.id);
      res.json(orders);
    } catch (error: any) {
      res.status(500).json({ message: "Error fetching orders: " + error.message });
    }
  });

  app.get("/api/wholesale-customer/orders/:id", isAuthenticated, isWholesaleCustomer, async (req, res) => {
    try {
      if (!req.user) {
        return res.status(401).json({ message: "Not authenticated" });
      }
      
      // Get wholesale customer record for authenticated user
      const customer = await storage.getWholesaleCustomerByUserId(req.user.id);
      if (!customer) {
        return res.status(404).json({ message: "Wholesale customer record not found" });
      }

      // Get order details
      const order = await storage.getWholesaleOrder(req.params.id);
      if (!order) {
        return res.status(404).json({ message: "Order not found" });
      }

      // Verify this order belongs to the authenticated customer
      if (order.customerId !== customer.id) {
        return res.status(403).json({ message: "Access denied to this order" });
      }

      // Get order with items
      const orderDetails = await storage.getWholesaleOrderWithDetails(req.params.id);
      res.json(orderDetails);
    } catch (error: any) {
      res.status(500).json({ message: "Error fetching order: " + error.message });
    }
  });

  app.get("/api/wholesale/customer/pricing", isAuthenticated, isWholesaleCustomer, async (req, res) => {
    try {
      if (!req.user) {
        return res.status(401).json({ message: "Not authenticated" });
      }
      
      // Get wholesale customer record for authenticated user
      const customer = await storage.getWholesaleCustomerByUserId(req.user.id);
      if (!customer) {
        // Pending contacts build against list prices; the held order is re-priced with the
        // store's own pricing when it is actually placed on approval.
        if (await getPendingClaim(req.user.id)) return res.json([]);
        return res.status(404).json({ message: "Wholesale customer record not found" });
      }

      // Get custom pricing for this customer
      const pricing = await storage.getWholesalePricing(customer.id);
      res.json(pricing);
    } catch (error: any) {
      res.status(500).json({ message: "Error fetching pricing: " + error.message });
    }
  });

  /**
   * Place an order for a wholesale customer: validate items, price them (custom pricing
   * falls back to list), enforce the minimum, mint an invoice number, write the rows, and
   * fire the confirmation emails. Throws OrderValidationError for anything the caller did
   * wrong. Shared by the customer-portal route and by claim approval, which places the
   * order a new contact built while they were waiting.
   */
  async function placeCustomerOrder(
    customer: { id: string; email: string; businessName: string; contactName: string },
    body: any,
    opts: { placedByUserId: string | null }
  ) {
      const { items, notes, locationId } = body;
      const poNumber = typeof body.poNumber === 'string' && body.poNumber.trim()
        ? body.poNumber.trim().slice(0, 50)
        : undefined;
      // Email the orderer gave at submission — the confirmation goes here. May differ
      // from the billing/primary contact (floor staff order; the office pays).
      const contactEmail =
        typeof body.contactEmail === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.contactEmail.trim())
          ? body.contactEmail.trim()
          : null;

      // Pickup orders are collected at the brewery, so they carry no delivery location.
      // Anything else is a delivery and MUST name one — otherwise the order is scheduled
      // with nowhere to take it, which is how orders used to slip through addressless.
      const fulfillmentMethod = body.fulfillmentMethod === 'pickup' ? 'pickup' : 'delivery';
      const effectiveLocationId = fulfillmentMethod === 'pickup' ? null : locationId;

      if (fulfillmentMethod === 'delivery') {
        if (!effectiveLocationId) {
          throw new OrderValidationError(400, { message: "Choose a delivery address, or select pickup." });
        }
        const location = await storage.getWholesaleLocation(effectiveLocationId);
        if (!location) {
          throw new OrderValidationError(400, { message: "Invalid location ID" });
        }
        if (location.customerId !== customer.id) {
          throw new OrderValidationError(403, { message: "Location does not belong to this customer" });
        }
      }


      if (!items || !Array.isArray(items) || items.length === 0) {
        throw new OrderValidationError(400, { message: "Order must contain at least one item" });
      }

      // Calculate prices for items and total
      let totalAmount = 0;
      const validatedItems = [];

      for (const item of items) {
        if (!item.unitTypeId || !item.flavorId || !item.quantity || item.quantity <= 0) {
          throw new OrderValidationError(400, { message: "Invalid item data: unitTypeId, flavorId, and quantity are required" });
        }

        const unitType = await storage.getWholesaleUnitType(item.unitTypeId);
        if (!unitType) {
          throw new OrderValidationError(400, { message: `Unit type ${item.unitTypeId} not found` });
        }

        // Verify flavor exists
        const allFlavors = await storage.getFlavors();
        const flavor = allFlavors.find(f => f.id === item.flavorId);
        if (!flavor) {
          throw new OrderValidationError(400, { message: `Flavor ${item.flavorId} not found` });
        }

        // Get custom pricing or default unit type price
        const customPrice = await storage.getWholesaleCustomerPrice(customer.id, item.unitTypeId);
        const unitPrice = customPrice ? Number(customPrice.customPrice) : Number(unitType.defaultPrice);
        const lineTotal = unitPrice * item.quantity;
        totalAmount += lineTotal;

        validatedItems.push({
          unitTypeId: item.unitTypeId,
          flavorId: item.flavorId,
          quantity: item.quantity,
          unitPrice: unitPrice.toFixed(2),
        });
      }

      // Check minimum order amount
      const minOrderResult = await db.select().from(siteSettings).where(eq(siteSettings.key, 'wholesale_minimum_order'));
      const minOrderAmount = minOrderResult[0] ? parseFloat(minOrderResult[0].value) : 0;
      
      if (minOrderAmount > 0 && totalAmount < minOrderAmount) {
        throw new OrderValidationError(400, { 
          message: `Order total of $${totalAmount.toFixed(2)} does not meet the minimum order amount of $${minOrderAmount.toFixed(2)}. Please add more items to your order.`,
          minimumOrderAmount: minOrderAmount,
          currentTotal: totalAmount
        });
      }

      // Generate invoice number (same INV-YYYY-#### format as admin-created orders)
      const invoiceNumber = await storage.generateNextInvoiceNumber();

      // Create order for the logged-in customer with default 30-day due date
      const orderDate = new Date();
      const dueDate = new Date(orderDate.getTime() + 30 * 24 * 60 * 60 * 1000);
      
      const orderData = {
        customerId: customer.id,
        placedByUserId: opts.placedByUserId ?? undefined,
        invoiceNumber,
        totalAmount: totalAmount.toFixed(2),
        notes: notes || undefined,
        locationId: effectiveLocationId || undefined,
        fulfillmentMethod,
        dueDate,
        contactEmail: contactEmail || undefined,
        poNumber,
      };

      const createdOrder = await storage.createWholesaleOrder(orderData);
      
      for (const item of validatedItems) {
        await storage.createWholesaleOrderItem({
          orderId: createdOrder.id,
          unitTypeId: item.unitTypeId,
          flavorId: item.flavorId,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
        });
      }

      // Build items list with product names for emails
      const emailItems = await Promise.all(validatedItems.map(async (item) => {
        const unitType = await storage.getWholesaleUnitType(item.unitTypeId);
        const flavor = item.flavorId ? await storage.getFlavor(item.flavorId) : null;
        const productName = flavor 
          ? `${unitType?.name || 'Item'} - ${flavor.name}`
          : unitType?.name || 'Item';
        return {
          productName,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
        };
      }));

      // Confirmation goes to whoever placed the order (owner decision 2026-08-23) —
      // stores with several buyers kept confusing the primary contact with someone
      // else's order. Falls back to the store's primary email when the placer is
      // unknown (claim-approval edge cases, legacy rows).
      const placer = opts.placedByUserId ? await storage.getUser(opts.placedByUserId) : undefined;
      const confirmationEmail = contactEmail || placer?.email || customer.email;

      // Multi-location stores: emails name the store, not just the chain
      // ("Evergreens — Thomas & Boren"), so everyone knows which site ordered.
      const emailLocation = createdOrder.locationId ? await storage.getWholesaleLocation(createdOrder.locationId) : null;
      const emailBusinessName = emailLocation?.locationName && emailLocation.locationName !== 'Main Location'
        ? `${customer.businessName} — ${emailLocation.locationName}`
        : customer.businessName;

      // Send emails in the background (don't block the response)
      sendWholesaleOrderConfirmation({
        customerEmail: confirmationEmail,
        businessName: emailBusinessName,
        contactName: customer.contactName,
        invoiceNumber,
        orderDate,
        deliveryDate: createdOrder.deliveryDate ? new Date(createdOrder.deliveryDate) : null,
        dueDate,
        totalAmount,
        items: emailItems,
        notes: notes || null,
      }).catch(emailError => {
        console.error('[ORDER] Failed to send customer confirmation:', emailError);
      });

      storage.getUsersByRole('admin').then(async (admins) => {
        const superAdmins = await storage.getUsersByRole('super_admin');
        const adminEmails = [...admins, ...superAdmins]
          .map(u => u.email)
          .filter((email): email is string => !!email);

        if (adminEmails.length > 0) {
          await sendWholesaleOrderAdminNotification({
            adminEmails,
            businessName: emailBusinessName,
            contactName: customer.contactName,
            invoiceNumber,
            orderDate,
            deliveryDate: createdOrder.deliveryDate ? new Date(createdOrder.deliveryDate) : null,
            totalAmount,
            items: emailItems,
          });
        }
      }).catch(emailError => {
        console.error('[ORDER] Failed to send admin notification:', emailError);
      });

      return createdOrder;
  }

  // Anonymous menu for guest ordering — the same catalogue the shop shows, list prices.
  app.get("/api/wholesale/guest/unit-types", async (_req, res) => {
    try {
      const unitTypes = await storage.getAllWholesaleUnitTypesWithFlavors();
      res.json(unitTypes.filter((ut: any) => ut.isActive !== false));
    } catch (error: any) {
      res.status(500).json({ message: "Error fetching unit types: " + error.message });
    }
  });

  // Guest wholesale order (owner decision 2026-08-27): no sign-in, no email verification.
  // The email is an FYI contact for the confirmation only; invoices go to the billing
  // contacts on file, and staff filter incoming orders as they arrive. Bot guards: the
  // honeypot field and per-IP rate limits; store-specific pricing is applied server-side
  // by placeCustomerOrder like any other order.
  app.post("/api/wholesale/guest-order", async (req: any, res) => {
    try {
      // Honeypot: bots fill every field. Pretend success so they don't adapt.
      if (typeof req.body?.website === "string" && req.body.website.trim() !== "") {
        console.warn("[GUEST ORDER] honeypot tripped");
        return res.json({ invoiceNumber: "INV-" + new Date().getFullYear() + "-0000" });
      }
      const ip = req.ip || req.socket?.remoteAddress || "unknown";
      if (!checkSubmissionRateLimit(`guest-order-hr:${ip}`, 5, 60 * 60 * 1000) ||
          !checkSubmissionRateLimit(`guest-order-day:${ip}`, 20, 24 * 60 * 60 * 1000)) {
        return res.status(429).json({ message: "Too many orders from this connection — give us a call and we'll take it by phone." });
      }
      const contactEmail = typeof req.body?.contactEmail === "string" ? req.body.contactEmail.trim() : "";
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail)) {
        return res.status(400).json({ message: "Enter an email address for the order confirmation." });
      }
      const customer = await storage.getWholesaleCustomer(String(req.body?.customerId || ""));
      if (!customer) {
        return res.status(400).json({ message: "Pick your store first." });
      }
      const order = await placeCustomerOrder(customer, req.body, { placedByUserId: null });
      console.log(`[GUEST ORDER] ${order.invoiceNumber} for ${customer.businessName} (${contactEmail}) from ${ip}`);
      res.status(201).json({ id: order.id, invoiceNumber: order.invoiceNumber });
    } catch (e: any) {
      if (e instanceof OrderValidationError) return res.status(e.status).json(e.body);
      console.error("[GUEST ORDER] error:", e);
      res.status(500).json({ message: "Error placing order: " + e.message });
    }
  });

  app.post("/api/wholesale/customer/orders", isAuthenticated, isWholesaleCustomer, async (req, res) => {
    try {
      if (!req.user) {
        return res.status(401).json({ message: "Not authenticated" });
      }
      
      // Get wholesale customer record for authenticated user
      const customer = await storage.getWholesaleCustomerByUserId(req.user.id);
      if (!customer) {
        // A new contact waiting for staff approval on a store: hold the order on their
        // request (no order row, no invoice number, no emails). It is placed for real the
        // moment staff approve.
        const pending = await getPendingClaim(req.user.id);
        if (pending) {
          const held = await holdPendingOrder(pending.request, pending.customer, req.body);
          if (!held.ok) return res.status(held.status).json({ message: held.message });
          return res.json({ held: true, pendingOrder: held.pendingOrder });
        }
        return res.status(404).json({ message: "Wholesale customer record not found" });
      }

      try {
        const order = await placeCustomerOrder(customer, req.body, { placedByUserId: req.user.id });
        res.json(order);
      } catch (e: any) {
        if (e instanceof OrderValidationError) return res.status(e.status).json(e.body);
        throw e;
      }
    } catch (error: any) {
      console.error("Wholesale customer order creation error:", error);
      res.status(500).json({ message: "Error creating order: " + error.message });
    }
  });

  // Product routes
  app.get("/api/products", async (req: any, res) => {
    try {
      const includeInactive = req.query.includeInactive === 'true';
      
      if (includeInactive && (!req.user || req.user.role !== 'admin')) {
        return res.status(403).json({ message: "Only admins can view inactive products" });
      }
      
      const products = await storage.getProducts(includeInactive);
      res.json(products);
    } catch (error: any) {
      res.status(500).json({ message: "Error fetching products: " + error.message });
    }
  });

  app.get("/api/products/:id", async (req, res) => {
    try {
      const product = await storage.getProduct(req.params.id);
      if (!product) {
        return res.status(404).json({ message: "Product not found" });
      }
      
      // Include pricing information from product_types
      const pricing = await getProductPricing(req.params.id);
      if (!pricing) {
        return res.status(404).json({ message: "Product pricing not found" });
      }
      
      res.json({
        ...product,
        retailPrice: pricing.retailPrice,
        wholesalePrice: pricing.wholesalePrice,
      });
    } catch (error: any) {
      res.status(500).json({ message: "Error fetching product: " + error.message });
    }
  });

  // Revenue numbers for tax filings, straight from our own orders (owner decision
  // 2026-08-29: filings use our data, not QuickBooks). Returns the three months of
  // the quarter containing ?month=YYYY-MM, bucketed by Pacific calendar month.
  // Retail gross = subtotal (tax and refundable deposits excluded); wholesale gross =
  // invoice totals (resale — no sales tax). Cancelled and soft-deleted orders excluded.
  app.get("/api/admin/filing-numbers", isAdmin, async (req, res) => {
    try {
      const m = String(req.query.month ?? "");
      if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(m)) {
        return res.status(400).json({ message: "month must be YYYY-MM" });
      }
      const [year, month] = m.split("-").map(Number);
      const qStartMonth = Math.floor((month - 1) / 3) * 3 + 1;
      const start = `${year}-${String(qStartMonth).padStart(2, "0")}-01 00:00:00`;
      const endYear = qStartMonth === 10 ? year + 1 : year;
      const endMonth = qStartMonth === 10 ? 1 : qStartMonth + 3;
      const end = `${endYear}-${String(endMonth).padStart(2, "0")}-01 00:00:00`;

      const pacific = (col: string) => `(${col} at time zone 'UTC' at time zone 'America/Los_Angeles')`;
      const retail = await pool.query(
        `select to_char(${pacific("order_date")}, 'YYYY-MM') as month,
                count(*)::int as orders,
                coalesce(sum(subtotal), 0)::text as gross,
                coalesce(sum(tax_amount), 0)::text as tax,
                coalesce(sum(deposit_amount), 0)::text as deposits
           from retail_orders
          where status <> 'cancelled' and deleted_at is null
            and ${pacific("order_date")} >= $1::timestamp and ${pacific("order_date")} < $2::timestamp
          group by 1`,
        [start, end]
      );
      // CASH BASIS (owner confirmation 2026-09-01, matching the federal filing method):
      // wholesale revenue counts in the month the money ARRIVED (paid_at), not the month
      // ordered — unpaid net-30 invoices don't count yet. Retail stays by order date:
      // customers pay at checkout, so order date ≈ cash date.
      const wholesale = await pool.query(
        `select to_char(${pacific("paid_at")}, 'YYYY-MM') as month,
                count(*)::int as orders,
                coalesce(sum(total_amount), 0)::text as gross
           from wholesale_orders
          where deleted_at is null and paid_at is not null
            and ${pacific("paid_at")} >= $1::timestamp and ${pacific("paid_at")} < $2::timestamp
          group by 1`,
        [start, end]
      );

      const months = [];
      for (let i = 0; i < 3; i++) {
        const mm = qStartMonth + i;
        const key = `${year}-${String(mm).padStart(2, "0")}`;
        const r = retail.rows.find((x) => x.month === key);
        const w = wholesale.rows.find((x) => x.month === key);
        months.push({
          month: key,
          retail: { orders: r?.orders ?? 0, gross: r?.gross ?? "0", tax: r?.tax ?? "0", deposits: r?.deposits ?? "0" },
          wholesale: { orders: w?.orders ?? 0, gross: w?.gross ?? "0" },
        });
      }
      res.json({ quarter: `${year} Q${Math.ceil(qStartMonth / 3)}`, months });
    } catch (error: any) {
      res.status(500).json({ message: "Error computing filing numbers: " + error.message });
    }
  });

  app.post("/api/products", isAdmin, async (req, res) => {
    try {
      const validatedData = insertProductSchema.parse(req.body);
      const product = await storage.createProduct(validatedData);
      res.json(product);
    } catch (error: any) {
      if (error.name === 'ZodError') {
        return res.status(400).json({ message: "Validation error", errors: error.errors });
      }
      res.status(500).json({ message: "Error creating product: " + error.message });
    }
  });

  app.patch("/api/products/:id", isAdmin, async (req, res) => {
    try {
      const partialProductSchema = insertProductSchema.partial();
      const validatedUpdates = partialProductSchema.parse(req.body);
      const product = await storage.updateProduct(req.params.id, validatedUpdates);
      if (!product) {
        return res.status(404).json({ message: "Product not found" });
      }
      res.json(product);
    } catch (error: any) {
      if (error.name === 'ZodError') {
        return res.status(400).json({ message: "Validation error", errors: error.errors });
      }
      res.status(500).json({ message: "Error updating product: " + error.message });
    }
  });

  // NEW SCHEMA - Flavor management routes
  app.get("/api/flavors", async (req: any, res) => {
    try {
      const includeInactive = req.query.includeInactive === 'true';
      
      if (includeInactive && (!req.user || req.user.role !== 'admin')) {
        return res.status(403).json({ message: "Only admins can view inactive flavors" });
      }
      
      const flavors = await storage.getFlavors(includeInactive);
      res.json(flavors);
    } catch (error: any) {
      res.status(500).json({ message: "Error fetching flavors: " + error.message });
    }
  });

  app.get("/api/flavors/:id", async (req, res) => {
    try {
      const flavor = await storage.getFlavor(req.params.id);
      if (!flavor) {
        return res.status(404).json({ message: "Flavor not found" });
      }
      res.json(flavor);
    } catch (error: any) {
      res.status(500).json({ message: "Error fetching flavor: " + error.message });
    }
  });

  app.post("/api/flavors", isAdmin, async (req, res) => {
    try {
      const validatedData = insertFlavorSchema.parse(req.body);
      const flavor = await storage.createFlavor(validatedData);
      res.json(flavor);
    } catch (error: any) {
      if (error.name === 'ZodError') {
        return res.status(400).json({ message: "Validation error", errors: error.errors });
      }
      res.status(500).json({ message: "Error creating flavor: " + error.message });
    }
  });

  app.patch("/api/flavors/:id", isAdmin, async (req, res) => {
    try {
      const partialFlavorSchema = insertFlavorSchema.partial();
      const validatedUpdates = partialFlavorSchema.parse(req.body);
      const flavor = await storage.updateFlavor(req.params.id, validatedUpdates);
      if (!flavor) {
        return res.status(404).json({ message: "Flavor not found" });
      }
      res.json(flavor);
    } catch (error: any) {
      if (error.name === 'ZodError') {
        return res.status(400).json({ message: "Validation error", errors: error.errors });
      }
      res.status(500).json({ message: "Error updating flavor: " + error.message });
    }
  });

  app.delete("/api/flavors/:id", isAdmin, async (req, res) => {
    try {
      await storage.deleteFlavor(req.params.id);
      res.json({ message: "Flavor deleted successfully" });
    } catch (error: any) {
      res.status(500).json({ message: "Error deleting flavor: " + error.message });
    }
  });

  // ===== Materials inventory module =====

  // Suppliers
  app.get("/api/suppliers", isAuthenticated, isStaffOrAdmin, async (_req, res) => {
    try {
      res.json(await storage.getSuppliers());
    } catch (error: any) {
      res.status(500).json({ message: "Error fetching suppliers: " + error.message });
    }
  });

  app.post("/api/suppliers", isAuthenticated, isStaffOrAdmin, async (req, res) => {
    try {
      const data = insertSupplierSchema.parse(req.body);
      res.json(await storage.createSupplier(data));
    } catch (error: any) {
      if (error.name === 'ZodError') {
        return res.status(400).json({ message: "Validation error", errors: error.errors });
      }
      res.status(500).json({ message: "Error creating supplier: " + error.message });
    }
  });

  app.patch("/api/suppliers/:id", isAuthenticated, isStaffOrAdmin, async (req, res) => {
    try {
      const updates = insertSupplierSchema.partial().parse(req.body);
      const supplier = await storage.updateSupplier(req.params.id, updates);
      if (!supplier) return res.status(404).json({ message: "Supplier not found" });
      res.json(supplier);
    } catch (error: any) {
      if (error.name === 'ZodError') {
        return res.status(400).json({ message: "Validation error", errors: error.errors });
      }
      res.status(500).json({ message: "Error updating supplier: " + error.message });
    }
  });

  app.delete("/api/suppliers/:id", isAuthenticated, isStaffOrAdmin, async (req, res) => {
    try {
      await storage.deleteSupplier(req.params.id);
      res.json({ message: "Supplier deleted successfully" });
    } catch (error: any) {
      res.status(500).json({ message: "Error deleting supplier: " + error.message });
    }
  });

  // Materials
  app.get("/api/materials", isAuthenticated, isStaffOrAdmin, async (_req, res) => {
    try {
      res.json(await storage.getMaterials());
    } catch (error: any) {
      res.status(500).json({ message: "Error fetching materials: " + error.message });
    }
  });

  app.post("/api/materials", isAuthenticated, isStaffOrAdmin, async (req, res) => {
    try {
      const data = insertMaterialSchema.parse(req.body);
      res.json(await storage.createMaterial(data));
    } catch (error: any) {
      if (error.name === 'ZodError') {
        return res.status(400).json({ message: "Validation error", errors: error.errors });
      }
      res.status(500).json({ message: "Error creating material: " + error.message });
    }
  });

  /**
   * Record a physical count or correction. THE way to change stock by hand: sets the shelf
   * number and writes a ledger row with the delta vs what the system believed, who, when,
   * why. A monthly count is a series of these; the ledger is where drift gets diagnosed.
   */
  app.post("/api/materials/:id/count", isAuthenticated, isStaffOrAdmin, async (req: any, res) => {
    try {
      const schema = z.object({
        counted: z.coerce.number().min(0, "Counted quantity cannot be negative").max(1e9),
        reason: z.enum(['count', 'correction']).default('count'),
        note: z.string().trim().max(500).optional().nullable(),
      });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ message: parsed.error.errors[0].message });
      const adj = await storage.recordMaterialCount(req.params.id, parsed.data.counted, parsed.data.reason, parsed.data.note ?? null, req.user?.id ?? null);
      if (!adj) return res.status(404).json({ message: "Material not found" });
      res.json(adj);
    } catch (error: any) {
      res.status(500).json({ message: "Error recording count: " + error.message });
    }
  });

  app.get("/api/materials/:id/adjustments", isAuthenticated, isStaffOrAdmin, async (req, res) => {
    try {
      res.json(await storage.getMaterialAdjustments(req.params.id));
    } catch (error: any) {
      res.status(500).json({ message: "Error fetching adjustments: " + error.message });
    }
  });

  app.patch("/api/materials/:id", isAuthenticated, isStaffOrAdmin, async (req, res) => {
    try {
      const updates = insertMaterialSchema.partial().parse(req.body);
      // Stock is NOT editable here. Overwriting it silently is how a count drifts without
      // a trace, and a save from a form loaded minutes ago would undo any batch logged in
      // between. Stock changes go through POST /api/materials/:id/count, which records
      // the delta and computes against the live value.
      if ('stock' in updates) {
        return res.status(400).json({ message: "Stock can't be edited directly — use Record count, which keeps a ledger of the change." });
      }
      const material = await storage.updateMaterial(req.params.id, updates);
      if (!material) return res.status(404).json({ message: "Material not found" });
      res.json(material);
    } catch (error: any) {
      if (error.name === 'ZodError') {
        return res.status(400).json({ message: "Validation error", errors: error.errors });
      }
      res.status(500).json({ message: "Error updating material: " + error.message });
    }
  });

  app.delete("/api/materials/:id", isAuthenticated, isStaffOrAdmin, async (req, res) => {
    try {
      await storage.deleteMaterial(req.params.id);
      res.json({ message: "Material deleted successfully" });
    } catch (error: any) {
      res.status(500).json({ message: "Error deleting material: " + error.message });
    }
  });

  // Recipes (processes)
  app.get("/api/processes", isAuthenticated, isStaffOrAdmin, async (_req, res) => {
    try {
      res.json(await storage.getProcesses());
    } catch (error: any) {
      res.status(500).json({ message: "Error fetching recipes: " + error.message });
    }
  });

  app.post("/api/processes", isAuthenticated, isStaffOrAdmin, async (req, res) => {
    try {
      const data = insertProcessSchema.parse(req.body);
      res.json(await storage.createProcess(data));
    } catch (error: any) {
      if (error.name === 'ZodError') {
        return res.status(400).json({ message: "Validation error", errors: error.errors });
      }
      res.status(500).json({ message: "Error creating recipe: " + error.message });
    }
  });

  app.patch("/api/processes/:id", isAuthenticated, isStaffOrAdmin, async (req, res) => {
    try {
      const updates = insertProcessSchema.partial().parse(req.body);
      const process = await storage.updateProcess(req.params.id, updates);
      if (!process) return res.status(404).json({ message: "Recipe not found" });
      res.json(process);
    } catch (error: any) {
      if (error.name === 'ZodError') {
        return res.status(400).json({ message: "Validation error", errors: error.errors });
      }
      res.status(500).json({ message: "Error updating recipe: " + error.message });
    }
  });

  app.delete("/api/processes/:id", isAuthenticated, isStaffOrAdmin, async (req, res) => {
    try {
      await storage.deleteProcess(req.params.id);
      res.json({ message: "Recipe deleted successfully" });
    } catch (error: any) {
      res.status(500).json({ message: "Error deleting recipe: " + error.message });
    }
  });

  // Recipe bill-of-materials lines
  app.post("/api/processes/:id/materials", isAuthenticated, isStaffOrAdmin, async (req, res) => {
    try {
      const schema = z.object({
        materialId: z.string().min(1),
        units: z.union([z.string(), z.number()]).transform((v) => String(v)),
      });
      const { materialId, units } = schema.parse(req.body);
      res.json(await storage.addProcessMaterial({ processId: req.params.id, materialId, units }));
    } catch (error: any) {
      if (error.name === 'ZodError') {
        return res.status(400).json({ message: "Validation error", errors: error.errors });
      }
      res.status(500).json({ message: "Error adding recipe ingredient: " + error.message });
    }
  });

  app.patch("/api/process-materials/:lineId", isAuthenticated, isStaffOrAdmin, async (req, res) => {
    try {
      const { units } = z.object({
        units: z.union([z.string(), z.number()]).transform((v) => String(v)),
      }).parse(req.body);
      const line = await storage.updateProcessMaterial(req.params.lineId, units);
      if (!line) return res.status(404).json({ message: "Ingredient not found" });
      res.json(line);
    } catch (error: any) {
      if (error.name === 'ZodError') {
        return res.status(400).json({ message: "Validation error", errors: error.errors });
      }
      res.status(500).json({ message: "Error updating recipe ingredient: " + error.message });
    }
  });

  app.delete("/api/process-materials/:lineId", isAuthenticated, isStaffOrAdmin, async (req, res) => {
    try {
      await storage.deleteProcessMaterial(req.params.lineId);
      res.json({ message: "Ingredient removed" });
    } catch (error: any) {
      res.status(500).json({ message: "Error removing recipe ingredient: " + error.message });
    }
  });

  // Productions (logging a batch draws down materials via the recipe)
  app.get("/api/productions", isAuthenticated, isStaffOrAdmin, async (req, res) => {
    try {
      const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 200;
      res.json(await storage.getProductions(limit));
    } catch (error: any) {
      res.status(500).json({ message: "Error fetching productions: " + error.message });
    }
  });

  app.post("/api/productions", isAuthenticated, isStaffOrAdmin, async (req, res) => {
    try {
      const body = { ...req.body };
      if (typeof body.date === 'string') body.date = new Date(body.date);
      const data = insertProductionSchema.parse(body);
      res.json(await storage.createProduction(data));
    } catch (error: any) {
      if (error.name === 'ZodError') {
        return res.status(400).json({ message: "Validation error", errors: error.errors });
      }
      res.status(500).json({ message: "Error logging production: " + error.message });
    }
  });

  app.delete("/api/productions/:id", isAuthenticated, isStaffOrAdmin, async (req, res) => {
    try {
      await storage.deleteProduction(req.params.id);
      res.json({ message: "Production deleted successfully" });
    } catch (error: any) {
      res.status(500).json({ message: "Error deleting production: " + error.message });
    }
  });

  // Purchase orders (delivering a line replenishes material stock)
  app.get("/api/material-orders", isAuthenticated, isStaffOrAdmin, async (_req, res) => {
    try {
      res.json(await storage.getMaterialOrders());
    } catch (error: any) {
      res.status(500).json({ message: "Error fetching purchase orders: " + error.message });
    }
  });

  app.post("/api/material-orders", isAuthenticated, isStaffOrAdmin, async (req, res) => {
    try {
      const { lines, ...orderBody } = req.body ?? {};
      if (typeof orderBody.dateOrdered === 'string') orderBody.dateOrdered = new Date(orderBody.dateOrdered);
      if (typeof orderBody.dateDelivered === 'string') orderBody.dateDelivered = new Date(orderBody.dateDelivered);
      const order = insertMaterialOrderSchema.parse(orderBody);

      const lineSchema = z.array(z.object({
        materialId: z.string().min(1),
        units: z.union([z.string(), z.number()]).transform((v) => String(v)),
      }));
      const validatedLines = lineSchema.parse(lines ?? []);

      res.json(await storage.createMaterialOrder(order, validatedLines));
    } catch (error: any) {
      if (error.name === 'ZodError') {
        return res.status(400).json({ message: "Validation error", errors: error.errors });
      }
      res.status(500).json({ message: "Error creating purchase order: " + error.message });
    }
  });

  app.patch("/api/material-orders/lines/:lineId", isAuthenticated, isStaffOrAdmin, async (req, res) => {
    try {
      const delivered = !!req.body?.delivered;
      await storage.setOrderMaterialDelivered(req.params.lineId, delivered);
      res.json({ message: "Updated" });
    } catch (error: any) {
      res.status(500).json({ message: "Error updating delivery: " + error.message });
    }
  });

  app.delete("/api/material-orders/:id", isAuthenticated, isStaffOrAdmin, async (req, res) => {
    try {
      await storage.deleteMaterialOrder(req.params.id);
      res.json({ message: "Purchase order deleted successfully" });
    } catch (error: any) {
      res.status(500).json({ message: "Error deleting purchase order: " + error.message });
    }
  });

  // Clear a stuck/failed billing state so a subscription can charge again.
  // Without this, a subscription paused after MAX_RETRY_ATTEMPTS (or left in
  // payment_failed / awaiting_auth / disputed) had NO recovery route at all —
  // it simply stopped billing forever.
  app.post("/api/retail-subscriptions/:id/reset-billing", isAdmin, async (req, res) => {
    try {
      const { chargeNow } = req.body ?? {};

      const [subscription] = await db
        .select()
        .from(retailSubscriptions)
        .where(eq(retailSubscriptions.id, req.params.id));

      if (!subscription) {
        return res.status(404).json({ message: "Subscription not found" });
      }

      const [updated] = await db
        .update(retailSubscriptions)
        .set({
          status: subscription.status === 'cancelled' ? 'cancelled' : 'active',
          billingStatus: 'active',
          retryCount: 0,
          processingLock: false,
          processingLockedAt: null,
          // Optionally make it due immediately so the next run retries it.
          ...(chargeNow ? { nextChargeAt: new Date() } : {}),
        })
        .where(eq(retailSubscriptions.id, req.params.id))
        .returning();

      console.log(`[SUBSCRIPTION] Billing state reset for ${req.params.id}${chargeNow ? ' (will charge on next run)' : ''}`);
      res.json(updated);
    } catch (error: any) {
      console.error("Error resetting subscription billing:", error);
      res.status(500).json({ message: "Error resetting billing state" });
    }
  });

  // Inventory analytics
  app.get("/api/inventory/reorder-report", isAuthenticated, isStaffOrAdmin, async (req, res) => {
    try {
      const windowDays = req.query.windowDays ? parseInt(req.query.windowDays as string, 10) : 90;
      res.json(await storage.getReorderReport(windowDays));
    } catch (error: any) {
      res.status(500).json({ message: "Error building reorder report: " + error.message });
    }
  });

  app.get("/api/inventory/cogs-report", isAuthenticated, isStaffOrAdmin, async (req, res) => {
    try {
      const days = req.query.days ? parseInt(req.query.days as string, 10) : 90;
      res.json(await storage.getCogsReport(days));
    } catch (error: any) {
      res.status(500).json({ message: "Error building COGS report: " + error.message });
    }
  });

  app.get("/api/inventory/dashboard", isAuthenticated, isStaffOrAdmin, async (req, res) => {
    try {
      res.json(await storage.getInventoryDashboard(typeof req.query.mixPeriod === 'string' ? req.query.mixPeriod : undefined));
    } catch (error: any) {
      res.status(500).json({ message: "Error building dashboard: " + error.message });
    }
  });

  // Production limits: max producible per recipe from stock on hand + the limiting
  // ingredient. Staff-visible (not admin-only) — this answers the brewery-floor question
  // "what can we actually make today", same audience as the orders board.
  app.get("/api/inventory/finished-goods", isAuthenticated, isStaffOrAdmin, async (_req, res) => {
    try {
      // Mixed cases are assembled from single-flavor stock, so their own count is
      // meaningless and untracked for now (owner, 2026-08-31) — hidden here; the
      // number can be reset if tracking ever starts.
      const rows = await db.execute(sql`
        SELECT p.id, p.name, p.container, p.stock_quantity AS "stockQuantity", f.name AS flavor
        FROM products p
        LEFT JOIN flavors f ON f.id = p.flavor_id
        WHERE p.is_active AND p.container IS NOT NULL AND (f.name IS NULL OR f.name <> 'Mixed')
        ORDER BY p.container, f.name NULLS LAST`);
      res.json(rows.rows);
    } catch (error: any) {
      res.status(500).json({ message: "Error fetching finished goods: " + error.message });
    }
  });

  app.get("/api/inventory/limit-report", isAuthenticated, isStaffOrAdmin, async (_req, res) => {
    try {
      res.json(await storage.getInventoryLimitReport());
    } catch (error: any) {
      res.status(500).json({ message: "Error building limit report: " + error.message });
    }
  });

  // NEW SCHEMA - Retail Product management routes
  app.get("/api/retail-products", async (req: any, res) => {
    try {
      const includeInactive = req.query.includeInactive === 'true';
      
      if (includeInactive && (!req.user || req.user.role !== 'admin')) {
        return res.status(403).json({ message: "Only admins can view inactive products" });
      }
      
      const products = await storage.getRetailProducts(includeInactive);
      res.json(products);
    } catch (error: any) {
      res.status(500).json({ message: "Error fetching retail products: " + error.message });
    }
  });

  app.post("/api/retail-products", isAdmin, async (req, res) => {
    try {
      const validatedData = insertRetailProductSchema.parse(req.body);
      const product = await storage.createRetailProduct(validatedData);
      res.json(product);
    } catch (error: any) {
      if (error.name === 'ZodError') {
        return res.status(400).json({ message: "Validation error", errors: error.errors });
      }
      res.status(500).json({ message: "Error creating retail product: " + error.message });
    }
  });

  app.patch("/api/retail-products/:id", isAdmin, async (req, res) => {
    try {
      const partialProductSchema = insertRetailProductSchema.partial();
      const validatedUpdates = partialProductSchema.parse(req.body);
      const product = await storage.updateRetailProduct(req.params.id, validatedUpdates);
      if (!product) {
        return res.status(404).json({ message: "Retail product not found" });
      }
      res.json(product);
    } catch (error: any) {
      if (error.name === 'ZodError') {
        return res.status(400).json({ message: "Validation error", errors: error.errors });
      }
      res.status(500).json({ message: "Error updating retail product: " + error.message });
    }
  });

  app.delete("/api/retail-products/:id", isAdmin, async (req, res) => {
    try {
      await storage.deleteRetailProduct(req.params.id);
      res.json({ message: "Retail product deleted successfully" });
    } catch (error: any) {
      res.status(500).json({ message: "Error deleting retail product: " + error.message });
    }
  });

  app.post("/api/retail-products/:id/flavors", isAdmin, async (req, res) => {
    try {
      const { flavorIds } = req.body;
      if (!Array.isArray(flavorIds)) {
        return res.status(400).json({ message: "flavorIds must be an array" });
      }
      await storage.setRetailProductFlavors(req.params.id, flavorIds);
      res.json({ message: "Product flavors updated successfully" });
    } catch (error: any) {
      res.status(500).json({ message: "Error setting product flavors: " + error.message });
    }
  });

  // Customer-facing catalogue. The management route below is isStaffOrAdmin, so a real
  // wholesale customer got a 403 and the order form rendered "No unit types available" —
  // ordering was impossible for everyone except a super_admin testing it. Active only.
  app.get("/api/wholesale/customer/unit-types", isAuthenticated, isWholesaleCustomer, async (req: any, res) => {
    try {
      const unitTypes = await storage.getAllWholesaleUnitTypesWithFlavors();
      res.json(unitTypes.filter((ut: any) => ut.isActive !== false));
    } catch (error: any) {
      res.status(500).json({ message: "Error fetching wholesale unit types: " + error.message });
    }
  });

  // NEW SCHEMA - Wholesale Unit Type management routes
  app.get("/api/wholesale-unit-types", isAuthenticated, isStaffOrAdmin, async (req: any, res) => {
    try {
      const includeInactive = req.query.includeInactive === 'true';
      const includeFlavors = req.query.includeFlavors === 'true';
      
      if (includeFlavors) {
        const unitTypes = await storage.getAllWholesaleUnitTypesWithFlavors();
        res.json(unitTypes);
      } else {
        const unitTypes = await storage.getWholesaleUnitTypes(includeInactive);
        res.json(unitTypes);
      }
    } catch (error: any) {
      res.status(500).json({ message: "Error fetching wholesale unit types: " + error.message });
    }
  });

  app.post("/api/wholesale-unit-types", isAdmin, async (req, res) => {
    try {
      const { flavorIds, ...unitTypeData } = req.body;
      const validatedData = insertWholesaleUnitTypeSchema.parse(unitTypeData);
      const unitType = await storage.createWholesaleUnitType(validatedData);
      
      // Set flavor associations if provided
      if (flavorIds && Array.isArray(flavorIds)) {
        await storage.setWholesaleUnitTypeFlavors(unitType.id, flavorIds);
      }
      
      res.json(unitType);
    } catch (error: any) {
      if (error.name === 'ZodError') {
        return res.status(400).json({ message: "Validation error", errors: error.errors });
      }
      res.status(500).json({ message: "Error creating wholesale unit type: " + error.message });
    }
  });

  app.patch("/api/wholesale-unit-types/:id", isAdmin, async (req, res) => {
    try {
      const { flavorIds, ...unitTypeData } = req.body;
      const partialUnitTypeSchema = insertWholesaleUnitTypeSchema.partial();
      const validatedUpdates = partialUnitTypeSchema.parse(unitTypeData);
      const unitType = await storage.updateWholesaleUnitType(req.params.id, validatedUpdates);
      
      if (!unitType) {
        return res.status(404).json({ message: "Wholesale unit type not found" });
      }
      
      // Update flavor associations if provided
      if (flavorIds && Array.isArray(flavorIds)) {
        await storage.setWholesaleUnitTypeFlavors(req.params.id, flavorIds);
      }
      
      res.json(unitType);
    } catch (error: any) {
      if (error.name === 'ZodError') {
        return res.status(400).json({ message: "Validation error", errors: error.errors });
      }
      res.status(500).json({ message: "Error updating wholesale unit type: " + error.message });
    }
  });

  app.delete("/api/wholesale-unit-types/:id", isAdmin, async (req, res) => {
    try {
      await storage.deleteWholesaleUnitType(req.params.id);
      res.json({ message: "Wholesale unit type deleted successfully" });
    } catch (error: any) {
      res.status(500).json({ message: "Error deleting wholesale unit type: " + error.message });
    }
  });

  // Wholesale Customer Pricing routes
  app.get("/api/wholesale-customer-pricing/:customerId", isAuthenticated, isStaffOrAdmin, async (req, res) => {
    try {
      const pricing = await storage.getWholesaleCustomerPricing(req.params.customerId);
      res.json(pricing);
    } catch (error: any) {
      res.status(500).json({ message: "Error fetching customer pricing: " + error.message });
    }
  });

  app.post("/api/wholesale-customer-pricing", isAdmin, async (req, res) => {
    try {
      const { customerId, unitTypeId, customPrice } = req.body;
      const pricing = await storage.setWholesaleCustomerPrice({
        customerId,
        unitTypeId,
        customPrice: customPrice.toString()
      });
      res.json(pricing);
    } catch (error: any) {
      res.status(500).json({ message: "Error setting customer pricing: " + error.message });
    }
  });

  app.delete("/api/wholesale-customer-pricing/:id", isAdmin, async (req, res) => {
    try {
      await storage.deleteWholesaleCustomerPrice(req.params.id);
      res.json({ message: "Customer pricing deleted successfully" });
    } catch (error: any) {
      res.status(500).json({ message: "Error deleting customer pricing: " + error.message });
    }
  });

  // Product Types routes
  app.get("/api/product-types", isAuthenticated, isStaffOrAdmin, async (req, res) => {
    try {
      const productTypes = await storage.getProductTypes();
      res.json(productTypes);
    } catch (error: any) {
      res.status(500).json({ message: "Error fetching product types: " + error.message });
    }
  });

  app.post("/api/product-types", isAuthenticated, isAdmin, async (req, res) => {
    try {
      const validated = insertProductTypeSchema.parse(req.body);
      const productType = await storage.createProductType(validated);
      res.status(201).json(productType);
    } catch (error: any) {
      if (error.name === 'ZodError') {
        return res.status(400).json({ message: "Validation error", errors: error.errors });
      }
      res.status(500).json({ message: "Error creating product type: " + error.message });
    }
  });

  app.patch("/api/product-types/:id", isAuthenticated, isAdmin, async (req, res) => {
    try {
      const { wholesalePrice, retailPrice } = req.body;
      const updates: any = {};
      if (wholesalePrice !== undefined) updates.wholesalePrice = wholesalePrice.toString();
      if (retailPrice !== undefined) updates.retailPrice = retailPrice.toString();
      
      const productType = await storage.updateProductType(req.params.id, updates);
      if (!productType) {
        return res.status(404).json({ message: "Product type not found" });
      }
      res.json(productType);
    } catch (error: any) {
      res.status(500).json({ message: "Error updating product type: " + error.message });
    }
  });

  // Object storage routes
  app.post("/api/objects/upload", isAdmin, async (req, res) => {
    try {
      const objectStorageService = new ObjectStorageService();
      const uploadURL = await objectStorageService.getObjectEntityUploadURL();
      res.json({ uploadURL });
    } catch (error: any) {
      console.error("Error getting upload URL:", error);
      res.status(500).json({ message: "Error getting upload URL: " + error.message });
    }
  });

  // Public file upload URL endpoint (for flavor images, etc.)
  app.post("/api/object-storage/upload-url", isAuthenticated, isStaffOrAdmin, async (req, res) => {
    try {
      const { filename, directory, contentType } = req.body;
      if (!filename) {
        return res.status(400).json({ message: "filename is required" });
      }

      // Preferred path: S3-compatible bucket (Cloudflare R2 / S3). The upload URL is a
      // SAME-ORIGIN endpoint on this server which forwards the bytes to the bucket —
      // not a presigned bucket URL. Presigned browser→bucket PUTs need a CORS policy on
      // the bucket for every origin the site runs on; without it the browser's PUT fails
      // with "Failed to fetch" and nothing lands. Same-origin needs nothing.
      if (isS3Configured()) {
        const key = buildObjectKey(filename, directory === 'public' ? 'images' : directory);
        return res.json({
          uploadUrl: `/api/object-storage/upload/${key.split('/').map(encodeURIComponent).join('/')}`,
          key,
          publicUrl: getPublicUrl(key),
          storage: 's3',
        });
      }

      // Legacy fallback (Replit/GCS object storage)
      const objectStorageService = new ObjectStorageService();
      // Don't pass directory since publicPath already points to the public directory
      const uploadUrl = await objectStorageService.getPublicUploadURL(filename, directory === 'public' ? '' : directory);
      res.json({ uploadUrl, storage: 'legacy' });
    } catch (error: any) {
      console.error("Error getting public upload URL:", error);
      res.status(500).json({ message: "Error getting upload URL: " + error.message });
    }
  });

  // Receive the file bytes from the browser and write them to the bucket (see upload-url
  // above for why this is proxied). Raw body, capped at 20 MB — product photos are far
  // smaller; the cap stops this being used as an arbitrary-file dumping ground.
  app.put(
    "/api/object-storage/upload/:key(*)",
    isAuthenticated,
    isStaffOrAdmin,
    express.raw({ type: () => true, limit: '20mb' }),
    async (req, res) => {
      try {
        if (!isS3Configured()) {
          return res.status(503).json({ message: "Image storage is not configured" });
        }
        const key = req.params.key;
        // Only accept keys this server would itself have minted (dir/unique-name); stops
        // overwriting arbitrary objects in the bucket.
        if (!/^[\w\-]+\/[\w.\-]+$/.test(key)) {
          return res.status(400).json({ message: "Invalid object key" });
        }
        const body = req.body as Buffer;
        if (!body || !Buffer.isBuffer(body) || body.length === 0) {
          return res.status(400).json({ message: "Empty upload" });
        }
        const contentType = req.headers['content-type'] || 'application/octet-stream';
        if (!/^image\//.test(contentType)) {
          return res.status(415).json({ message: "Only image uploads are accepted" });
        }
        const { publicUrl } = await putObject(key, body, contentType);
        // Uppy's S3 plugin takes the response's Location header as the file's final URL,
        // so the client gets the public CDN URL back through Uppy itself rather than
        // having to remember it across the upload.
        res.setHeader("Location", publicUrl);
        res.json({ publicUrl, key, size: body.length });
      } catch (error: any) {
        console.error("Error storing upload:", error);
        res.status(500).json({ message: "Error storing upload: " + error.message });
      }
    }
  );

  // Make uploaded file publicly readable
  app.post("/api/object-storage/make-public", isAuthenticated, isStaffOrAdmin, async (req, res) => {
    try {
      const { fileUrl } = req.body;
      if (!fileUrl) {
        return res.status(400).json({ message: "fileUrl is required" });
      }

      // S3/R2 buckets are configured public at the bucket level, so there's no
      // per-object ACL step — this is a no-op for that backend.
      if (isS3Configured()) {
        return res.json({ success: true, skipped: 's3-bucket-public' });
      }

      const objectStorageService = new ObjectStorageService();
      await objectStorageService.makeFilePublic(fileUrl);
      res.json({ success: true });
    } catch (error: any) {
      console.error("Error making file public:", error);
      res.status(500).json({ message: "Error making file public: " + error.message });
    }
  });

  // Serve public files (like flavor images)
  app.get("/public/:filename(*)", async (req, res) => {
    const objectStorageService = new ObjectStorageService();
    try {
      const filename = req.params.filename;
      const file = await objectStorageService.getPublicFile(filename);
      
      if (!file) {
        return res.sendStatus(404);
      }
      
      // Files in product-images directory don't need ACL checking (admin-uploaded)
      if (filename.startsWith('product-images/')) {
        await objectStorageService.downloadObject(file, res, 86400);
        return;
      }
      
      // Check if file is marked as public in ACL policy
      const aclPolicy = await getObjectAclPolicy(file);
      if (!aclPolicy || aclPolicy.visibility !== 'public') {
        return res.sendStatus(403);
      }
      
      await objectStorageService.downloadObject(file, res, 86400); // Cache for 24 hours
    } catch (error: any) {
      console.error("Error serving public file:", error);
      res.sendStatus(500);
    }
  });

  app.get("/objects/:objectPath(*)", async (req, res) => {
    const objectStorageService = new ObjectStorageService();
    try {
      const objectFile = await objectStorageService.getObjectEntityFile(req.path);
      objectStorageService.downloadObject(objectFile, res);
    } catch (error: any) {
      console.error("Error accessing object:", error);
      if (error instanceof ObjectNotFoundError) {
        return res.sendStatus(404);
      }
      return res.sendStatus(500);
    }
  });

  app.put("/api/products/:id/photos", isAdmin, async (req: any, res) => {
    try {
      const { photoUrls } = req.body;
      
      if (!photoUrls || !Array.isArray(photoUrls)) {
        return res.status(400).json({ message: "photoUrls array is required" });
      }

      if (!req.user || !req.user.id) {
        return res.status(401).json({ message: "Unauthorized" });
      }

      const objectStorageService = new ObjectStorageService();
      const normalizedPaths: string[] = [];

      for (const url of photoUrls) {
        const normalizedPath = await objectStorageService.trySetObjectEntityAclPolicy(
          url,
          {
            owner: req.user.id,
            visibility: "public",
          }
        );
        normalizedPaths.push(normalizedPath);
      }

      if (req.params.id !== "new-product") {
        const product = await storage.updateProduct(req.params.id, {
          imageUrls: normalizedPaths
        });

        if (!product) {
          return res.status(404).json({ message: "Product not found" });
        }

        res.json(product);
      } else {
        res.json({ imageUrls: normalizedPaths });
      }
    } catch (error: any) {
      console.error("Error updating product photos:", error);
      res.status(500).json({ message: "Error updating product photos: " + error.message });
    }
  });

  // Inventory routes (staff only)
  app.post("/api/inventory/production", isStaffOrAdmin, async (req: any, res) => {
    try {
      const { productId, quantity, batchNumber, productionDate, notes } = req.body;
      const effectiveUser = req.originalUser || req.user;
      
      if (!productId || !quantity) {
        return res.status(400).json({ message: "Product ID and quantity are required" });
      }
      
      if (quantity <= 0) {
        return res.status(400).json({ message: "Quantity must be positive for production" });
      }
      
      const batchMetadata = JSON.stringify({
        batchNumber: batchNumber || null,
        productionDate: productionDate || new Date().toISOString(),
      });
      
      const adjustment = await storage.createInventoryAdjustment({
        productId,
        quantity,
        reason: 'production',
        staffUserId: effectiveUser.id,
        batchMetadata,
        notes: notes || null,
      });
      
      res.json(adjustment);
    } catch (error: any) {
      console.error("Error recording production:", error);
      res.status(500).json({ message: "Error recording production: " + error.message });
    }
  });
  
  app.get("/api/inventory/adjustments", isStaffOrAdmin, async (req: any, res) => {
    try {
      const { productId, reason, limit } = req.query;
      
      const filters: any = {};
      if (productId) filters.productId = productId as string;
      if (reason) filters.reason = reason as string;
      if (limit) filters.limit = parseInt(limit as string);
      
      const adjustments = await storage.getInventoryAdjustments(filters);
      res.json(adjustments);
    } catch (error: any) {
      console.error("Error fetching inventory adjustments:", error);
      res.status(500).json({ message: "Error fetching inventory adjustments: " + error.message });
    }
  });

  // Subscription plan routes
  app.get("/api/subscription-plans", async (req, res) => {
    try {
      const plans = await storage.getSubscriptionPlans();
      res.json(plans);
    } catch (error: any) {
      res.status(500).json({ message: "Error fetching plans: " + error.message });
    }
  });

  app.get("/api/subscription-plans/:id", async (req, res) => {
    try {
      const plan = await storage.getSubscriptionPlan(req.params.id);
      if (!plan) {
        return res.status(404).json({ message: "Plan not found" });
      }
      res.json(plan);
    } catch (error: any) {
      res.status(500).json({ message: "Error fetching plan: " + error.message });
    }
  });

  // Create subscription for a single product (new multi-product subscription flow)
  app.post("/api/create-product-subscription", isAuthenticated, async (req: any, res) => {
    try {
      if (!stripe) {
        return res.status(503).json({ message: "Payment processing is not configured" });
      }

      const { productId, quantity, frequency } = req.body;

      if (!productId || !quantity || !frequency) {
        return res.status(400).json({ message: "Missing required fields" });
      }

      const product = await storage.getProduct(productId);
      if (!product) {
        return res.status(404).json({ message: "Product not found" });
      }

      const pricing = await getProductPricing(productId);
      if (!pricing) {
        return res.status(404).json({ message: "Product pricing not found" });
      }

      // Calculate subscription price (10% discount)
      const basePrice = parseFloat(pricing.retailPrice);
      const subscriptionPrice = basePrice * 0.9;
      const unitAmountCents = Math.round(subscriptionPrice * 100);

      // Map frequency to Stripe interval
      const intervalCount = frequencyToStripeInterval(frequency).interval_count;

      const baseUrl = getBaseUrl();

      const imageUrl = product.imageUrl?.startsWith('http') 
        ? product.imageUrl 
        : product.imageUrl 
          ? `${baseUrl}${product.imageUrl}` 
          : undefined;

      // Create Stripe Checkout Session for subscription
      const session = await stripe.checkout.sessions.create({
        mode: 'subscription',
        payment_method_types: ['card'],
        customer: req.user.stripeCustomerId || undefined,
        customer_email: req.user.stripeCustomerId ? undefined : req.user.email,
        line_items: [{
          price_data: {
            currency: 'usd',
            product_data: {
              name: `${product.name} - Case of 12`,
              description: `${frequency} subscription`,
              images: imageUrl ? [imageUrl] : [],
            },
            unit_amount: unitAmountCents,
            recurring: {
              interval: 'week',
              interval_count: intervalCount,
            },
          },
          quantity: quantity,
        }],
        success_url: `${baseUrl}/subscription-success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${baseUrl}/product-subscribe/${productId}`,
        metadata: {
          userId: req.user.id,
          productId: productId,
          frequency: frequency,
          quantity: quantity.toString(),
          type: 'product_subscription',
        },
      });

      res.json({ url: session.url, sessionId: session.id });
    } catch (error: any) {
      console.error("Product subscription error:", error);
      res.status(500).json({ message: "Error creating subscription: " + error.message });
    }
  });

  // Create Stripe checkout session for cart purchases (one-time or subscription)
  app.post("/api/create-cart-checkout", async (req: any, res) => {
    try {
      if (!stripe) {
        return res.status(503).json({ message: "Payment processing is not configured" });
      }

      const sessionId = req.sessionID || "guest";
      const legacyItems = await storage.getCartItems(sessionId);
      const retailItems = await storage.getRetailCart(sessionId);
      
      if (legacyItems.length === 0 && retailItems.length === 0) {
        return res.status(400).json({ message: "Cart is empty" });
      }

      // Check if cart has both subscription and one-time items
      const hasLegacySubscription = legacyItems.some(item => item.isSubscription);
      const hasRetailSubscription = retailItems.some(item => item.isSubscription);
      const hasOneTime = legacyItems.some(item => !item.isSubscription) || retailItems.some(item => !item.isSubscription);

      // Don't allow mixing subscription types (legacy vs retail)
      if (hasLegacySubscription && hasRetailSubscription) {
        return res.status(400).json({
          message: "Cannot mix legacy and new subscription products. Please checkout separately."
        });
      }

      if ((hasLegacySubscription || hasRetailSubscription) && hasOneTime) {
        return res.status(400).json({ 
          message: "Please checkout one-time purchases and subscriptions separately. Remove either the one-time or subscription items from your cart to continue."
        });
      }

      const hasSubscription = hasLegacySubscription || hasRetailSubscription;

      const baseUrl = getBaseUrl();

      // Create line items for both legacy and retail cart items
      const legacyLineItems = await Promise.all(
        legacyItems.map(async (item) => {
          const product = await storage.getProduct(item.productId);
          if (!product) throw new Error(`Product ${item.productId} not found`);
          
          const imageUrl = product.imageUrl.startsWith('http') 
            ? product.imageUrl 
            : `${baseUrl}${product.imageUrl}`;
          
          const casePrice = getCasePriceCents(item.isSubscription);

          if (item.isSubscription) {
            // Shared label, not a local ternary: the old copy said 'Every 4 Weeks' for
            // 6- and 8-week cadences, so the Stripe receipt described a cadence the
            // customer isn't actually on.
            const cadenceLabel = frequencyLabel(item.subscriptionFrequency);
            
            const intervalCount = frequencyToStripeInterval(item.subscriptionFrequency).interval_count;

            return {
              price_data: {
                currency: 'usd',
                product_data: {
                  name: `${product.name} - Case of 12 (${item.subscriptionFrequency})`,
                  description: `${cadenceLabel} subscription`,
                  images: imageUrl.startsWith('http') ? [imageUrl] : [],
                },
                unit_amount: casePrice,
                recurring: {
                  interval: 'week' as const,
                  interval_count: intervalCount,
                },
              },
              quantity: item.quantity,
            };
          } else {
            return {
              price_data: {
                currency: 'usd',
                product_data: {
                  name: `${product.name} - Case of 12`,
                  images: imageUrl.startsWith('http') ? [imageUrl] : [],
                },
                unit_amount: casePrice,
              },
              quantity: item.quantity,
            };
          }
        })
      );

      const retailLineItems = await Promise.all(
        retailItems.map(async (item) => {
          const retailProduct = item.retailProduct;
          // Multi-flavor products (variety packs) have a null `flavor` — resolve the
          // selected one instead, and fall back to the product's own name/image.
          const selectedFlavor =
            retailProduct.productType === 'multi-flavor' && item.selectedFlavorId
              ? retailProduct.flavors?.find((f: any) => f.id === item.selectedFlavorId) ?? null
              : retailProduct.flavor ?? null;

          const displayName = selectedFlavor?.name ?? retailProduct.productName ?? null;
          const lineName = displayName
            ? `${displayName} ${retailProduct.unitDescription}`
            : retailProduct.unitDescription;

          const rawImage = selectedFlavor?.primaryImageUrl ?? retailProduct.productImageUrl ?? null;
          const imageUrl = rawImage
            ? (rawImage.startsWith('http') ? rawImage : `${baseUrl}/public/${rawImage}`)
            : undefined;
          
          // Calculate price with subscription discount if applicable
          const basePrice = parseFloat(retailProduct.price);
          const discountPercentage = item.isSubscription ? parseFloat(retailProduct.subscriptionDiscount) : 0;
          const finalPrice = item.isSubscription && discountPercentage > 0
            ? basePrice * (1 - discountPercentage / 100)
            : basePrice;
          const casePriceCents = Math.round(finalPrice * 100);

          if (item.isSubscription) {
            // Shared label, not a local ternary: the old copy said 'Every 4 Weeks' for
            // 6- and 8-week cadences, so the Stripe receipt described a cadence the
            // customer isn't actually on.
            const cadenceLabel = frequencyLabel(item.subscriptionFrequency);
            
            const intervalCount = frequencyToStripeInterval(item.subscriptionFrequency).interval_count;

            return {
              price_data: {
                currency: 'usd',
                product_data: {
                  name: `${lineName} (${item.subscriptionFrequency})`,
                  description: `${cadenceLabel} subscription`,
                  images: imageUrl ? [imageUrl] : [],
                },
                unit_amount: casePriceCents,
                recurring: {
                  interval: 'week' as const,
                  interval_count: intervalCount,
                },
              },
              quantity: item.quantity,
            };
          } else {
            return {
              price_data: {
                currency: 'usd',
                product_data: {
                  name: lineName,
                  images: imageUrl ? [imageUrl] : [],
                },
                unit_amount: casePriceCents,
              },
              quantity: item.quantity,
            };
          }
        })
      );

      // Create deposit line items for retail products with deposits (one-time purchases only)
      const depositLineItems = retailItems
        .filter(item => !item.isSubscription && item.retailProduct.deposit && parseFloat(item.retailProduct.deposit.toString()) > 0)
        .map(item => {
          const depositAmount = Math.round(parseFloat(item.retailProduct.deposit.toString()) * 100);
          const retailProduct = item.retailProduct;
          
          // For multi-flavor products, find selected flavor name from flavors array
          let productName = retailProduct.unitDescription;
          if (retailProduct.productType === 'multi-flavor' && item.selectedFlavorId) {
            const selectedFlavor = retailProduct.flavors.find(f => f.id === item.selectedFlavorId);
            if (selectedFlavor) {
              productName = `${selectedFlavor.name} ${retailProduct.unitDescription}`;
            }
          } else if (retailProduct.productType === 'single-flavor' && retailProduct.flavor) {
            productName = `${retailProduct.flavor.name} ${retailProduct.unitDescription}`;
          }
          
          return {
            price_data: {
              currency: 'usd',
              product_data: {
                name: `Deposit: ${productName}`,
                description: 'Refundable deposit',
              },
              unit_amount: depositAmount,
            },
            quantity: item.quantity,
          };
        });

      const lineItems = [...legacyLineItems, ...retailLineItems, ...depositLineItems];

      // For subscriptions, include product info in metadata
      const metadata: Record<string, string> = {
        sessionId,
        type: hasSubscription ? 'subscription_purchase' : 'cart_purchase',
      };
      
      if (hasSubscription) {
        const legacySubItem = legacyItems.find(item => item.isSubscription);
        const retailSubItem = retailItems.find(item => item.isSubscription);
        const subItem = legacySubItem || retailSubItem;
        if (subItem) {
          if (legacySubItem) {
            metadata.productId = legacySubItem.productId;
          } else if (retailSubItem) {
            metadata.retailProductId = retailSubItem.retailProductId;
          }
          metadata.subscriptionFrequency = subItem.subscriptionFrequency || 'weekly';
        }
      }
      
      // Include userId if user is authenticated
      if (req.user && req.user.id) {
        metadata.userId = req.user.id;
      }

      // Calculate sales tax for retail orders (WA State 6.5% + Seattle City 3.85% = 10.35%)
      // Tax applies to all purchases including subscriptions
      const TAX_RATE = 0.1035; // 10.35%
      
      // Calculate subtotal from all items (including subscriptions)
      const legacyTaxable = await Promise.all(
        legacyItems
          .map(async (item) => {
            const pricing = await getProductPricing(item.productId);
            if (!pricing) return 0;
            const priceInCents = Math.round(parseFloat(pricing.retailPrice) * 100);
            return priceInCents * item.quantity;
          })
      ).then(amounts => amounts.reduce((sum, amount) => sum + amount, 0));

      const retailTaxable = retailItems
        .reduce((sum, item) => {
          // For subscriptions, apply discount if applicable
          let price = parseFloat(item.retailProduct.price);
          if (item.isSubscription && item.retailProduct.subscriptionDiscount != null) {
            const discountPercent = parseFloat(item.retailProduct.subscriptionDiscount.toString());
            if (isFinite(discountPercent) && discountPercent > 0) {
              price = price * (1 - discountPercent / 100);
            }
          }
          const priceCents = Math.round(price * 100);
          return sum + (priceCents * item.quantity);
        }, 0);

      // Calculate total deposits (one-time purchases only, not subject to tax)
      const depositTotal = retailItems
        .filter(item => !item.isSubscription && item.retailProduct.deposit)
        .reduce((sum, item) => {
          const depositAmount = Math.round(parseFloat(item.retailProduct.deposit.toString()) * 100);
          return sum + (depositAmount * item.quantity);
        }, 0);

      const taxableSubtotal = legacyTaxable + retailTaxable;
      
      if (taxableSubtotal > 0) {
        // Calculate tax amount in cents
        const taxAmount = Math.round(taxableSubtotal * TAX_RATE);
        
        // For subscriptions, determine the recurring interval from the first subscription item
        let taxLineItem: any = {
          price_data: {
            currency: 'usd',
            product_data: {
              name: 'Sales Tax (WA State 6.5% + Seattle 3.85%)',
              images: [],
            },
            unit_amount: taxAmount,
          },
          quantity: 1,
        };
        
        // If this is a subscription, make the tax recurring
        if (hasSubscription) {
          const subItem = legacyItems.find(item => item.isSubscription) || retailItems.find(item => item.isSubscription);
          if (subItem) {
            const frequency = subItem.subscriptionFrequency || 'weekly';
            const intervalCount = frequencyToStripeInterval(frequency).interval_count;

            taxLineItem.price_data.recurring = {
              interval: 'week' as const,
              interval_count: intervalCount,
            };
          }
        }
        
        lineItems.push(taxLineItem);
        
        // Store tax info in metadata for reference
        metadata.taxRate = TAX_RATE.toString();
        metadata.taxAmount = (taxAmount / 100).toFixed(2);
        metadata.taxableSubtotal = (taxableSubtotal / 100).toFixed(2);
        
        // Store deposit total if any (deposits are not taxed)
        if (depositTotal > 0) {
          metadata.depositTotal = (depositTotal / 100).toFixed(2);
        }
      }

      const session = await stripe.checkout.sessions.create({
        mode: hasSubscription ? 'subscription' : 'payment',
        payment_method_types: ['card'],
        line_items: lineItems,
        success_url: `${baseUrl}/checkout/success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${baseUrl}/shop`,
        metadata,
      });

      res.json({ url: session.url, sessionId: session.id });
    } catch (error: any) {
      console.error("Cart checkout error:", error);
      res.status(500).json({ message: "Error creating checkout: " + error.message });
    }
  });

  // Store customer info for retail checkout (called before payment)
  // Requires active session to prevent abuse
  const customerInfoSchema = z.object({
    customerName: z.string().min(2),
    customerEmail: z.string().email(),
    customerPhone: z.string().min(10),
    paymentIntentId: z.string().optional(),
    flavorNotes: z.string().optional(),
  });

  app.post("/api/checkout/customer-info", async (req: any, res) => {
    try {
      // Require session (logged in or guest) for CSRF protection
      if (!req.sessionID) {
        return res.status(401).json({ message: "Session required" });
      }
      
      const validated = customerInfoSchema.parse(req.body);
      const sessionId = req.sessionID;
      
      // Validate payment intent exists and belongs to this session if provided
      if (validated.paymentIntentId && !validated.paymentIntentId.startsWith('pi_')) {
        return res.status(400).json({ message: "Invalid payment intent ID" });
      }
      
      // Fetch tax metadata from payment intent if available
      let taxMode = 'exclusive';
      let taxRateBps = 1035; // Default 10.35%
      let taxAmountCents = 0;
      let isTaxExempt = false;
      
      if (validated.paymentIntentId && stripe) {
        try {
          const paymentIntent = await stripe.paymentIntents.retrieve(validated.paymentIntentId);
          
          // Extract tax information from metadata
          if (paymentIntent.metadata.taxRate) {
            const taxRate = parseFloat(paymentIntent.metadata.taxRate);
            taxRateBps = Math.round(taxRate * 10000); // Convert to basis points
          }
          
          if (paymentIntent.metadata.taxAmount) {
            taxAmountCents = Math.round(parseFloat(paymentIntent.metadata.taxAmount) * 100);
          }
        } catch (error) {
          console.error("Error fetching payment intent for tax metadata:", error);
          // Continue with defaults if unable to fetch
        }
      }
      
      await storage.createRetailCheckoutSession({
        sessionId,
        paymentIntentId: validated.paymentIntentId || null,
        customerName: validated.customerName,
        customerEmail: validated.customerEmail,
        customerPhone: formatPhoneNumber(validated.customerPhone),
        userId: req.user?.id || null,
        taxMode,
        taxRateBps,
        taxAmountCents,
        isTaxExempt,
        notes: validated.flavorNotes || null,
      });
      
      res.json({ success: true });
    } catch (error: any) {
      console.error("Error storing customer info:", error);
      res.status(500).json({ message: "Error storing customer info: " + error.message });
    }
  });

  // Create account during checkout (after successful payment)
  const createAccountSchema = z.object({
    customerName: z.string().min(2),
    customerEmail: z.string().email(),
    customerPhone: z.string().min(10),
    address: z.string().optional(),
    city: z.string().optional(),
    state: z.string().optional(),
    zipCode: z.string().optional(),
    password: z.string().min(6),
  });

  app.post("/api/checkout/create-account", async (req: any, res) => {
    try {
      const validated = createAccountSchema.parse(req.body);
      
      // Import hashPassword function
      const { hashPassword } = await import('./auth');
      
      // Check if user already exists with this email or phone
      const existingEmailUser = await storage.getUserByEmail(validated.customerEmail);
      if (existingEmailUser) {
        return res.status(400).json({ message: "An account with this email already exists" });
      }
      
      const existingPhoneUser = await storage.getUserByPhoneNumber(validated.customerPhone);
      if (existingPhoneUser) {
        return res.status(400).json({ message: "An account with this phone number already exists" });
      }
      
      // Split name into first and last name
      const nameParts = validated.customerName.trim().split(' ');
      const firstName = nameParts[0];
      const lastName = nameParts.slice(1).join(' ') || firstName;
      
      // Generate username from email
      const username = validated.customerEmail.split('@')[0];
      
      // Check if username exists, if so add a number
      let finalUsername = username;
      let counter = 1;
      while (await storage.getUserByUsername(finalUsername)) {
        finalUsername = `${username}${counter}`;
        counter++;
      }
      
      // Create user directly in database to set role and isAdmin
      const result = await db.insert(users).values({
        username: finalUsername,
        email: validated.customerEmail,
        phoneNumber: validated.customerPhone,
        firstName,
        lastName,
        address: validated.address || null,
        city: validated.city || null,
        state: validated.state || null,
        zipCode: validated.zipCode || null,
        password: await hashPassword(validated.password),
        role: 'user',
        isAdmin: false,
      }).returning();
      
      const user = result[0];
      
      // Create Stripe customer (non-blocking)
      createStripeCustomer({
        userId: user.id,
        email: user.email,
        phoneNumber: user.phoneNumber,
        firstName: user.firstName,
        lastName: user.lastName,
        username: user.username,
      }).catch(error => {
        console.error("[Checkout Account Creation] Failed to create Stripe customer:", error);
      });
      
      // Log the user in
      await new Promise((resolve, reject) => {
        req.login(user, (err: any) => {
          if (err) return reject(err);
          resolve(undefined);
        });
      });
      
      res.json({ success: true, user: { id: user.id, username: user.username, email: user.email } });
    } catch (error: any) {
      console.error("Error creating checkout account:", error);
      if (error.name === 'ZodError') {
        return res.status(400).json({ message: "Invalid input: " + error.message });
      }
      res.status(500).json({ message: "Error creating account: " + error.message });
    }
  });

  // Update user address during checkout (for logged-in users)
  const updateAddressSchema = z.object({
    address: z.string().min(1),
    city: z.string().min(1),
    state: z.string().min(1),
    zipCode: z.string().min(1),
  });

  app.patch("/api/checkout/update-address", isAuthenticated, async (req: any, res) => {
    try {
      const validated = updateAddressSchema.parse(req.body);
      const userId = req.user.id;

      // Update user address
      await db.update(users)
        .set({
          address: validated.address,
          city: validated.city,
          state: validated.state,
          zipCode: validated.zipCode,
          updatedAt: new Date(),
        })
        .where(eq(users.id, userId));

      // Refresh the user session with updated data
      const updatedUser = await storage.getUser(userId);
      if (updatedUser) {
        req.user = updatedUser;
      }

      res.json({ success: true });
    } catch (error: any) {
      console.error("Error updating address:", error);
      if (error.name === 'ZodError') {
        return res.status(400).json({ message: "Please provide complete address information" });
      }
      res.status(500).json({ message: "Error updating address: " + error.message });
    }
  });

  // Create subscription with embedded payment method collection
  const createSubscriptionSchema = z.object({
    customerName: z.string().min(2),
    customerEmail: z.string().email(),
    customerPhone: z.string().min(10),
    address: z.string().optional(),
    city: z.string().optional(),
    state: z.string().optional(),
    zipCode: z.string().optional(),
    paymentMethodId: z.string(), // Stripe payment method ID from frontend
    password: z.string().min(6).optional(), // For new account creation
  });

  app.post("/api/checkout/create-subscription", async (req: any, res) => {
    try {
      if (!stripe) {
        return res.status(503).json({ message: "Payment processing is not configured" });
      }

      const validated = createSubscriptionSchema.parse(req.body);
      const sessionId = req.sessionID || "guest";
      const userId = req.user?.id;

      // Get cart items
      const legacyItems = await storage.getCartItems(sessionId);
      const retailItems = await storage.getRetailCart(sessionId);
      
      if (legacyItems.length === 0 && retailItems.length === 0) {
        return res.status(400).json({ message: "Cart is empty" });
      }

      // Verify cart contains only subscriptions
      const hasLegacySubscription = legacyItems.some(item => item.isSubscription);
      const hasRetailSubscription = retailItems.some(item => item.isSubscription);
      const hasOneTime = legacyItems.some(item => !item.isSubscription) || retailItems.some(item => !item.isSubscription);

      if (hasOneTime) {
        return res.status(400).json({ 
          message: "This checkout is for subscriptions only" 
        });
      }

      if (!hasLegacySubscription && !hasRetailSubscription) {
        return res.status(400).json({ 
          message: "Cart must contain subscription items" 
        });
      }

      // Get or create user
      let user = req.user;
      
      if (!user) {
        // Create account if password provided
        if (!validated.password) {
          return res.status(400).json({ message: "Please create an account or log in to subscribe" });
        }

        const { hashPassword } = await import('./auth');
        
        // Check if user exists
        const existingUser = await storage.getUserByEmail(validated.customerEmail);
        if (existingUser) {
          return res.status(400).json({ message: "An account with this email already exists. Please log in." });
        }

        // Create user
        const nameParts = validated.customerName.trim().split(' ');
        const firstName = nameParts[0];
        const lastName = nameParts.slice(1).join(' ') || firstName;
        const username = validated.customerEmail.split('@')[0];

        let finalUsername = username;
        let counter = 1;
        while (await storage.getUserByUsername(finalUsername)) {
          finalUsername = `${username}${counter}`;
          counter++;
        }

        const result = await db.insert(users).values({
          username: finalUsername,
          email: validated.customerEmail,
          phoneNumber: validated.customerPhone,
          firstName,
          lastName,
          address: validated.address || null,
          city: validated.city || null,
          state: validated.state || null,
          zipCode: validated.zipCode || null,
          password: await hashPassword(validated.password),
          role: 'user',
          isAdmin: false,
        }).returning();

        user = result[0];

        // Log the user in
        await new Promise((resolve, reject) => {
          req.login(user, (err: any) => {
            if (err) return reject(err);
            resolve(undefined);
          });
        });
      } else {
        // For logged-in users, update their address if provided
        if (validated.address || validated.city || validated.state || validated.zipCode) {
          await db.update(users)
            .set({
              address: validated.address || user.address,
              city: validated.city || user.city,
              state: validated.state || user.state,
              zipCode: validated.zipCode || user.zipCode,
              updatedAt: new Date(),
            })
            .where(eq(users.id, user.id));
        }
      }

      // Create or get Stripe customer and create subscriptions atomically
      try {
        // Create or get Stripe customer
        let stripeCustomer;
        const existingUser = await storage.getUser(user.id);
        
        if (existingUser?.stripeCustomerId) {
          try {
            stripeCustomer = await stripe.customers.retrieve(existingUser.stripeCustomerId);
            // retrieve() returns rather than throws for deleted customers
            if ((stripeCustomer as any)?.deleted) stripeCustomer = undefined;
          } catch (e: any) {
            // Stale id from the test-mode era — fall through and mint a fresh one
            if (e?.code !== 'resource_missing') throw e;
            console.warn(`[CHECKOUT] Stale Stripe customer ${existingUser.stripeCustomerId} for user ${user.id} — recreating`);
          }
        }
        if (!stripeCustomer) {
          stripeCustomer = await stripe.customers.create({
            email: validated.customerEmail,
            name: validated.customerName,
            phone: validated.customerPhone,
            metadata: { userId: user.id },
          });

          // Update user with Stripe customer ID
          await storage.updateUserStripeId(user.id, stripeCustomer.id);
        }

        // Attach payment method to customer
        await stripe.paymentMethods.attach(validated.paymentMethodId, {
          customer: stripeCustomer.id,
        });

        // Set as default payment method
        await stripe.customers.update(stripeCustomer.id, {
          invoice_settings: {
            default_payment_method: validated.paymentMethodId,
          },
        });

        // Create subscription records and bill immediately for first order.
        // ONE subscription per FREQUENCY (owner, 2026-09-02): a four-case weekly cart
        // used to mint four subscriptions and four charges — now it's one subscription
        // holding all four items and one charge. A cart mixing frequencies still splits,
        // because a subscription has exactly one billing clock.
        const subscriptionItems = retailItems.filter(i => i.isSubscription);
        const createdSubscriptions: any[] = [];

        const byFrequency = new Map<string, typeof subscriptionItems>();
        for (const item of subscriptionItems) {
          const freq = item.subscriptionFrequency || 'weekly';
          byFrequency.set(freq, [...(byFrequency.get(freq) ?? []), item]);
        }

        for (const [frequency, groupItems] of Array.from(byFrequency.entries())) {
          // Price every line in the group
          const TAX_RATE = 0.1035;
          const pricedLines: Array<{ item: (typeof groupItems)[number]; unitPrice: number }> = [];
          let subtotal = 0;
          for (const item of groupItems) {
            const [retailProduct] = await db
              .select()
              .from(retailProducts)
              .where(eq(retailProducts.id, item.retailProductId));
            if (!retailProduct) {
              throw new Error(`Retail product ${item.retailProductId} not found`);
            }
            const basePrice = parseFloat(retailProduct.price);
            const discount = retailProduct.subscriptionDiscount ? Number(retailProduct.subscriptionDiscount) : 0;
            const unitPrice = basePrice * (1 - discount / 100);
            pricedLines.push({ item, unitPrice });
            subtotal += unitPrice * item.quantity;
          }
          const taxAmount = subtotal * TAX_RATE;
          const totalAmount = subtotal + taxAmount;
          const amountInCents = Math.round(totalAmount * 100);

          // Calculate next charge date (for 2nd order) — advance from now for initial setup
          const normalizedNextPickupDate = normalizeToAllowedPickupDay(
            addDays(new Date(), frequencyToDays(frequency))
          );
          // Billing happens on Monday of the pickup week
          const nextBillingDate = getBillingDateForPickup(normalizedNextPickupDate);

          // Create the subscription with future next charge date
          const [subscription] = await db
            .insert(retailSubscriptions)
            .values({
              userId: user.id,
              customerName: validated.customerName,
              customerEmail: validated.customerEmail,
              customerPhone: formatPhoneNumber(validated.customerPhone),
              subscriptionFrequency: frequency,
              nextChargeAt: nextBillingDate, // Billing on Monday of pickup week
              nextDeliveryDate: normalizedNextPickupDate,
              status: 'active',
              billingType: 'local_managed',
              billingStatus: 'active',
              stripeCustomerId: stripeCustomer.id,
              stripePaymentMethodId: validated.paymentMethodId,
              processingLock: false,
              retryCount: 0,
            })
            .returning();

          // Add every line as an item on the ONE subscription
          for (const { item, unitPrice } of pricedLines) {
            await db.insert(retailSubscriptionItems).values({
              subscriptionId: subscription.id,
              retailProductId: item.retailProductId,
              selectedFlavorId: item.selectedFlavorId,
              quantity: item.quantity,
              // Lock in the agreed price so later catalogue edits don't silently
              // re-price this customer's renewals.
              unitPriceAtSignup: unitPrice.toFixed(2),
            });
          }

          // Charge immediately for first order.
          // Keyed on the subscription id so a double-submitted checkout (or a retry
          // after a lost response) cannot charge the customer twice.
          const paymentIntent = await stripe.paymentIntents.create({
            amount: amountInCents,
            currency: 'usd',
            customer: stripeCustomer.id,
            payment_method: validated.paymentMethodId,
            off_session: true,
            confirm: true,
            metadata: {
              retailSubscriptionId: subscription.id,
              type: 'retail_subscription_first_order',
              subtotal: subtotal.toFixed(2),
              taxAmount: taxAmount.toFixed(2),
              totalAmount: totalAmount.toFixed(2),
            },
          }, { idempotencyKey: `retailsub_first_${subscription.id}` });

          // Create the first order through the SAME finalizer the webhook uses — it is
          // idempotent on the payment intent, so whichever of this call and the
          // payment_intent.succeeded webhook runs second is a no-op. The old inline
          // insert here raced the webhook for the next order number and could lose,
          // failing checkout AFTER the charge — the customer saw an error, retried,
          // and got charged twice (Kirk, 2026-08-31).
          if (paymentIntent.status === 'succeeded') {
            const { finalizeRetailSubscriptionCharge } = await import('./billing-cron');
            const finalized = await finalizeRetailSubscriptionCharge(paymentIntent.id);
            if (finalized) {
              console.log(`[SUBSCRIPTION] ✅ First order finalized for subscription ${subscription.id}`);
            } else {
              console.error(`[SUBSCRIPTION] ⚠️ First-order finalize incomplete for ${paymentIntent.id} — the payment_intent.succeeded webhook will finish it`);
            }
          } else {
            console.error(`[SUBSCRIPTION] ⚠️ Payment status ${paymentIntent.status} for first order`);
          }

          // Clear the group's lines from the cart
          for (const { item } of pricedLines) {
            await db.delete(retailCartItems).where(eq(retailCartItems.id, item.id));
          }

          createdSubscriptions.push(subscription);
        }

        res.json({ 
          success: true,
          subscriptions: createdSubscriptions,
        });
      } catch (transactionError: any) {
        console.error("Subscription creation failed:", transactionError);
        
        // If transaction failed after payment method was attached, detach it
        try {
          await stripe.paymentMethods.detach(validated.paymentMethodId);
        } catch (detachError) {
          console.error("Failed to detach payment method after error:", detachError);
        }
        
        throw transactionError;
      }
    } catch (error: any) {
      console.error("Error creating subscription:", error);
      if (error.name === 'ZodError') {
        return res.status(400).json({ message: "Invalid input: " + error.message });
      }
      res.status(500).json({ message: "Error creating subscription: " + error.message });
    }
  });

  // Create Stripe Payment Intent for embedded cart checkout (supports both old and new cart)
  app.post("/api/create-cart-payment-intent", async (req: any, res) => {
    try {
      if (!stripe) {
        return res.status(503).json({ message: "Payment processing is not configured" });
      }

      const sessionId = req.sessionID || "guest";
      const legacyItems = await storage.getCartItems(sessionId);
      const retailItems = await storage.getRetailCart(sessionId);
      
      if (legacyItems.length === 0 && retailItems.length === 0) {
        return res.status(400).json({ message: "Cart is empty" });
      }

      // Check if cart has both subscription and one-time items
      const hasLegacySubscription = legacyItems.some(item => item.isSubscription);
      const hasRetailSubscription = retailItems.some(item => item.isSubscription);
      const hasOneTime = legacyItems.some(item => !item.isSubscription) || retailItems.some(item => !item.isSubscription);

      // Don't allow mixing subscription types (legacy vs retail v2)
      if (hasLegacySubscription && hasRetailSubscription) {
        return res.status(400).json({
          message: "Cannot mix legacy and new subscription products. Please checkout separately."
        });
      }

      if ((hasLegacySubscription || hasRetailSubscription) && hasOneTime) {
        return res.status(400).json({ 
          message: "Please checkout one-time purchases and subscriptions separately. Remove either the one-time or subscription items from your cart to continue."
        });
      }

      // Payment Intents only work for one-time payments, not subscriptions
      if (hasLegacySubscription || hasRetailSubscription) {
        return res.status(400).json({
          message: "Subscriptions require a different checkout flow. Please use the subscription checkout page."
        });
      }

      // Calculate total amount in cents using actual product prices
      let subtotalCents = 0;
      let depositAmountCents = 0; // Deposits are charged but NOT taxed
      
      // Add legacy cart items
      for (const item of legacyItems) {
        const pricing = await getProductPricing(item.productId);
        if (!pricing) throw new Error(`Product pricing ${item.productId} not found`);
        if (!pricing.retailPrice) throw new Error(`Product ${item.productId} has no retail price`);
        
        const priceInDollars = parseFloat(pricing.retailPrice);
        if (!isFinite(priceInDollars) || priceInDollars < 0) {
          throw new Error(`Invalid price for product ${item.productId}: ${pricing.retailPrice}`);
        }
        
        const priceInCents = Math.round(priceInDollars * 100);
        subtotalCents += priceInCents * item.quantity;
      }
      
      // Add retail v2 cart items (price is in dollars, convert to cents)
      // Apply subscription discount if item is a subscription
      for (const item of retailItems) {
        if (!item.retailProduct) throw new Error(`Cart item ${item.id} missing retail product data`);
        if (!item.retailProduct.price) throw new Error(`Retail product ${item.retailProductId} has no price`);
        
        let priceInDollars = parseFloat(item.retailProduct.price);
        if (!isFinite(priceInDollars) || priceInDollars < 0) {
          throw new Error(`Invalid price for retail product ${item.retailProductId}: ${item.retailProduct.price}`);
        }
        
        // Apply subscription discount if this is a subscription item
        if (item.isSubscription && item.retailProduct.subscriptionDiscount != null) {
          const discountPercent = parseFloat(item.retailProduct.subscriptionDiscount.toString());
          if (isFinite(discountPercent) && discountPercent > 0) {
            priceInDollars = priceInDollars * (1 - discountPercent / 100);
          }
        }
        
        const priceInCents = Math.round(priceInDollars * 100);
        subtotalCents += priceInCents * item.quantity;
        
        // Add deposits (only for ONE-TIME purchases, not subscriptions, and not taxed)
        if (!item.isSubscription && item.retailProduct.deposit) {
          const depositInDollars = parseFloat(item.retailProduct.deposit.toString());
          if (isFinite(depositInDollars) && depositInDollars > 0) {
            const depositInCents = Math.round(depositInDollars * 100);
            depositAmountCents += depositInCents * item.quantity;
          }
        }
      }

      // Calculate sales tax (WA State 6.5% + Seattle City 3.85% = 10.35%)
      // Tax is applied to subtotal ONLY, not to deposits
      const TAX_RATE = 0.1035;
      const taxAmountCents = Math.round(subtotalCents * TAX_RATE);
      const totalAmountCents = subtotalCents + taxAmountCents + depositAmountCents;

      // Create payment intent
      const paymentIntent = await stripe.paymentIntents.create({
        amount: totalAmountCents,
        currency: 'usd',
        payment_method_types: ['card'],
        payment_method_options: {
          card: {
            request_three_d_secure: 'automatic',
          },
        },
        metadata: {
          sessionId,
          type: 'cart_purchase',
          userId: req.user?.id || 'guest',
          subtotal: (subtotalCents / 100).toFixed(2),
          taxRate: TAX_RATE.toString(),
          taxAmount: (taxAmountCents / 100).toFixed(2),
          depositAmount: (depositAmountCents / 100).toFixed(2),
          hasLegacyItems: legacyItems.length > 0 ? 'true' : 'false',
          hasRetailV2Items: retailItems.length > 0 ? 'true' : 'false',
        },
      });

      res.json({ 
        clientSecret: paymentIntent.client_secret,
        subtotal: subtotalCents / 100,
        taxAmount: taxAmountCents / 100,
        depositAmount: depositAmountCents / 100,
        total: totalAmountCents / 100,
      });
    } catch (error: any) {
      console.error("Cart payment intent error:", error);
      res.status(500).json({ message: "Error creating payment intent: " + error.message });
    }
  });

  // Create Stripe checkout session for subscriptions
  const createCheckoutSchema = z.object({
    planId: z.string().uuid(),
    customerEmail: z.string().email(),
    customerName: z.string().min(1),
  });

  app.post("/api/create-checkout-session", async (req, res) => {
    try {
      if (!stripe) {
        return res.status(503).json({ message: "Payment processing is not configured. Please contact support." });
      }

      const validated = createCheckoutSchema.parse(req.body);
      const plan = await storage.getSubscriptionPlan(validated.planId);
      
      if (!plan) {
        return res.status(404).json({ message: "Plan not found" });
      }

      if (!plan.stripePriceId) {
        return res.status(400).json({ message: "This plan is not available for online purchase" });
      }

      const baseUrl = getBaseUrl();

      const successUrl = `${baseUrl}/checkout/success?session_id={CHECKOUT_SESSION_ID}`;
      const cancelUrl = `${baseUrl}/shop`;

      const session = await stripe.checkout.sessions.create({
        mode: 'subscription',
        payment_method_types: ['card'],
        line_items: [
          {
            price: plan.stripePriceId,
            quantity: 1,
          },
        ],
        customer_email: validated.customerEmail,
        metadata: {
          planId: plan.id,
          customerName: validated.customerName,
        },
        success_url: successUrl,
        cancel_url: cancelUrl,
      });

      res.json({ url: session.url, sessionId: session.id });
    } catch (error: any) {
      console.error("Stripe checkout error:", error);
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid request data", errors: error.errors });
      }
      res.status(500).json({ message: "Error creating checkout session: " + error.message });
    }
  });

  // Stripe webhook handler with mandatory signature verification
  app.post("/api/webhooks/stripe", async (req: any, res) => {
    try {
      if (!stripe) {
        return res.status(503).send("Stripe not configured");
      }

      const sig = req.headers['stripe-signature'];
      const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

      if (!webhookSecret) {
        console.error("STRIPE_WEBHOOK_SECRET not configured");
        return res.status(400).send("Webhook secret not configured");
      }

      if (!sig) {
        console.error("Missing Stripe-Signature header");
        return res.status(400).send("Missing signature header");
      }

      let event: Stripe.Event;

      try {
        event = stripe.webhooks.constructEvent(
          req.rawBody as Buffer,
          sig,
          webhookSecret
        );
      } catch (err: any) {
        console.error(`Webhook signature verification failed: ${err.message}`);
        return res.status(400).send(`Webhook Error: ${err.message}`);
      }

      switch (event.type) {
        case 'checkout.session.completed': {
          const session = event.data.object as Stripe.Checkout.Session;
          
          // Handle cart purchases
          if (session.metadata?.type === 'cart_purchase') {
            const sessionId = session.metadata.sessionId;
            if (sessionId) {
              await storage.clearCart(sessionId);
              console.log(`Cleared cart for session ${sessionId} after successful payment`);
            }
            break;
          }
          
          // Handle retail subscription purchases
          if (session.metadata?.type === 'subscription_purchase' && session.metadata?.retailProductId && session.subscription) {
            // Check for existing retail subscription with this session ID (idempotency)
            const existing = await storage.getRetailSubscriptionBySessionId(session.id);
            if (existing) {
              console.log(`[WEBHOOK] Retail subscription already exists for session ${session.id}, skipping`);
              break;
            }
            
            const stripeSubscription = await stripe.subscriptions.retrieve(session.subscription as string);
            
            // Get customer details
            const customer = session.customer_details;
            if (!customer?.email) {
              console.error("[WEBHOOK] No customer email in session");
              break;
            }
            
            // Calculate next pickup date
            const frequency = session.metadata.subscriptionFrequency || 'weekly';
            const nextPickupDate = normalizeToAllowedPickupDay(
              addDays(new Date(), frequencyToDays(frequency))
            );
            
            // Create retail subscription record
            const retailSubscriptionData: any = {
              customerName: customer.name || 'Unknown',
              customerEmail: customer.email,
              customerPhone: customer.phone || '',
              stripeCheckoutSessionId: session.id,
              stripeSubscriptionId: stripeSubscription.id,
              stripeCustomerId: stripeSubscription.customer as string,
              billingType: 'stripe_managed',
              billingStatus: 'active',
              subscriptionFrequency: frequency as 'weekly' | 'bi-weekly' | 'every-4-weeks',
              nextDeliveryDate: nextPickupDate,
            };
            
            if (session.metadata?.userId) {
              retailSubscriptionData.userId = session.metadata.userId;
            }
            
            const newRetailSubscription = await storage.createRetailSubscription(retailSubscriptionData);
            
            // Add subscription items from cart
            const retailCartItems = await storage.getRetailCart(session.metadata.sessionId);
            const subscriptionItems = retailCartItems.filter(item => item.isSubscription);
            
            for (const item of subscriptionItems) {
              await storage.addRetailSubscriptionItem({
                subscriptionId: newRetailSubscription.id,
                retailProductId: item.retailProductId,
                quantity: item.quantity,
              });
            }
            
            // Clear cart
            if (session.metadata.sessionId) {
              await storage.clearRetailCart(session.metadata.sessionId);
            }
            
            console.log(`[WEBHOOK] ✅ Created Stripe-managed retail subscription ${newRetailSubscription.id} for Stripe subscription ${stripeSubscription.id}`);
            break;
          }
          
          // Handle wholesale invoice payments
          if (session.metadata?.type === 'wholesale_invoice_payment' && session.metadata?.orderId) {
            const orderId = session.metadata.orderId;
            const paymentIntentId = session.payment_intent as string | undefined;

            // ACH: this event means "debit authorised", not "money received". Stripe
            // reports payment_status 'unpaid' while the transfer is in flight, and
            // settlement arrives later as payment_intent.succeeded. Record the attempt and
            // wait. Anything that IS instant reports 'paid' and settles right here.
            if (session.payment_status === 'paid') {
              await settleWholesaleInvoice(orderId, paymentIntentId);
            } else {
              await storage.updateWholesaleOrder(orderId, {
                paymentInitiatedAt: new Date(),
                paymentFailedAt: null,
                ...(paymentIntentId ? { stripePaymentIntentId: paymentIntentId } : {}),
              });
              console.log(`[WEBHOOK] ⏳ Wholesale invoice ${session.metadata.invoiceNumber}: bank payment authorised, awaiting settlement (status: ${session.payment_status})`);
            }
            break;
          }
          // Unconditional break: the `break` above is nested inside an `if`, so any
          // checkout.session that didn't match it used to FALL THROUGH into
          // invoice.payment_succeeded below and create a spurious duplicate order.
          break;
        }
        case 'invoice.payment_succeeded': {
          const invoice = event.data.object as any;
          
          // Only process subscription invoices (not one-time payments)
          const subscriptionId = invoice.subscription as string | null;
          if (!subscriptionId) {
            break;
          }
          
          // Skip the initial invoice (already handled by checkout.session.completed)
          if (invoice.billing_reason === 'subscription_create') {
            console.log(`[WEBHOOK] Skipping initial subscription invoice ${invoice.id}`);
            break;
          }
          
          console.log(`[WEBHOOK] Processing subscription renewal invoice ${invoice.id} for subscription ${subscriptionId}`);
          
          // Check for retail subscription
          const retailSubscription = await storage.getRetailSubscriptionByStripeId(subscriptionId);
          
          if (!retailSubscription) {
            console.error(`[WEBHOOK] No retail subscription found for Stripe ID ${subscriptionId}`);
            break;
          }
          
          // Handle retail subscription
          if (retailSubscription) {
            // Check BOTH lifecycle status and billing status. Checking only
            // billingStatus meant a cancelled or paused subscription still had
            // renewal orders auto-created from late/duplicate Stripe invoices.
            if (retailSubscription.status !== 'active' || retailSubscription.billingStatus !== 'active') {
              console.log(`[WEBHOOK] Retail subscription ${retailSubscription.id} is not active (status: ${retailSubscription.status}, billingStatus: ${retailSubscription.billingStatus}), skipping order creation`);
              break;
            }
            
            // Get retail subscription items
            const retailSubItems = await storage.getRetailSubscriptionItems(retailSubscription.id);
            
            if (retailSubItems.length === 0) {
              console.error(`[WEBHOOK] No items found for retail subscription ${retailSubscription.id}`);
              break;
            }
            
            // Create order for retail subscription
            try {
              await db.transaction(async (tx) => {
                // Check for existing order (idempotency)
                const existingOrders = await tx
                  .select({ id: retailOrders.id })
                  .from(retailOrders)
                  .where(eq(retailOrders.stripeInvoiceId, invoice.id))
                  .limit(1);
                
                if (existingOrders.length > 0) {
                  console.log(`[WEBHOOK] Order already exists for invoice ${invoice.id} - skipping creation (idempotent)`);
                  return;
                }
                
                // Generate order number
                const maxOrderResult = await tx
                  .select({ maxNumber: sql<string>`COALESCE(MAX(CAST(SUBSTRING(order_number FROM 4) AS INTEGER)), 0)` })
                  .from(retailOrders)
                  .where(sql`order_number ~ '^ORD[0-9]+$'`);
                
                const nextNumber = parseInt(maxOrderResult[0]?.maxNumber || '0') + 1;
                const orderNumber = `ORD${String(nextNumber).padStart(6, '0')}`;
                
                // Calculate total from retail subscription items
                let subtotal = 0;
                for (const item of retailSubItems) {
                  const basePrice = parseFloat(item.retailProduct.price);
                  const discountPercent = parseFloat(item.retailProduct.subscriptionDiscount || '10');
                  const discountedPrice = basePrice * (1 - discountPercent / 100);
                  subtotal += discountedPrice * item.quantity;
                }
                
                // Create retail order
                const [newOrder] = await tx.insert(retailOrders).values({
                  orderNumber,
                  userId: retailSubscription.userId,
                  customerName: retailSubscription.customerName,
                  customerEmail: retailSubscription.customerEmail,
                  customerPhone: retailSubscription.customerPhone || '',
                  status: 'pending',
                  subtotal: subtotal.toFixed(2),
                  taxAmount: '0.00',
                  totalAmount: subtotal.toFixed(2),
                  stripeInvoiceId: invoice.id,
                  isSubscriptionOrder: true,
                }).returning();
                
                // Create order items with retail products (no inventory deduction yet - retail products don't have stock tracking)
                for (const item of retailSubItems) {
                  const basePrice = parseFloat(item.retailProduct.price);
                  const discountPercent = parseFloat(item.retailProduct.subscriptionDiscount || '10');
                  const discountedPrice = basePrice * (1 - discountPercent / 100);
                  
                  // Map retail product to legacy product for order item storage
                  // This is a temporary solution until we fully migrate order items to use retail products
                  const { productId: legacyProductId } = await tx
                    .select({ productId: products.id })
                    .from(products)
                    .where(eq(products.name, `${item.retailProduct.flavor.name} ${item.retailProduct.unitType}`))
                    .limit(1)
                    .then(rows => rows[0] || { productId: item.retailProduct.id });
                  
                  await tx.insert(retailOrderItems).values({
                    orderId: newOrder.id,
                    productId: legacyProductId,
                    quantity: item.quantity,
                    unitPrice: discountedPrice.toFixed(2),
                  });
                }
                
                // Update subscription's next delivery date — advance from scheduled date to avoid drift
                const nextDate = nextPickupDateFromScheduled(
                  retailSubscription.nextDeliveryDate || new Date(),
                  retailSubscription.subscriptionFrequency
                );
                
                await tx
                  .update(retailSubscriptions)
                  .set({ nextDeliveryDate: nextDate })
                  .where(eq(retailSubscriptions.id, retailSubscription.id));
                
                console.log(`[WEBHOOK] ✅ Created retail subscription order ${orderNumber} for invoice ${invoice.id}`);
              });
            } catch (error) {
              console.error(`[WEBHOOK] Error creating retail subscription order for invoice ${invoice.id}:`, error);
              throw error;
            }
            
            break;
          }
          
          break;
        }
        case 'payment_method.attached': {
          // Staff emails for saved payment methods were retired (owner, 2026-08-31) —
          // the event stays acknowledged so Stripe doesn't record delivery failures.
          const pm = event.data.object as Stripe.PaymentMethod;
          console.log(`[WEBHOOK] Payment method attached (${pm.type}) — no notification by design`);
          break;
        }

        case 'payment_intent.succeeded': {
          const paymentIntent = event.data.object as Stripe.PaymentIntent;

          // Wholesale ACH settlement — this is the event that means the money actually
          // arrived, days after the customer authorised it at checkout.
          if (
            paymentIntent.metadata?.type === 'wholesale_invoice_payment' &&
            paymentIntent.metadata?.orderId
          ) {
            await settleWholesaleInvoice(paymentIntent.metadata.orderId, paymentIntent.id);
            break;
          }

          // Handle retail subscription payments — BOTH renewals and first orders.
          // Previously only renewals matched, so a signup charge that came back
          // `requires_action`/`processing` and later succeeded was never finalized:
          // the customer was charged and no order was ever created.
          if (
            paymentIntent.metadata?.type === 'retail_subscription_renewal' ||
            paymentIntent.metadata?.type === 'retail_subscription_first_order'
          ) {
            console.log(`[WEBHOOK] Processing successful retail subscription payment ${paymentIntent.id} (${paymentIntent.metadata.type})`);
            
            const { finalizeRetailSubscriptionCharge } = await import('./billing-cron');
            const success = await finalizeRetailSubscriptionCharge(paymentIntent.id);
            
            if (success) {
              console.log(`[WEBHOOK] ✅ Successfully finalized retail subscription charge for PaymentIntent ${paymentIntent.id}`);
            } else {
              console.error(`[WEBHOOK] ❌ Failed to finalize retail subscription charge for PaymentIntent ${paymentIntent.id}`);
            }
            break;
          }
          
          // Handle cart purchase payments
          if (paymentIntent.metadata?.type === 'cart_purchase') {
            const sessionId = paymentIntent.metadata.sessionId;
            
            // Use transaction for atomic order creation
            const client = await pool.connect();
            try {
              await client.query('BEGIN');
              
              // Check for existing order (idempotency via unique constraint)
              const existingOrderResult = await client.query(
                'SELECT id FROM retail_orders WHERE stripe_payment_intent_id = $1 LIMIT 1',
                [paymentIntent.id]
              );
              
              if (existingOrderResult.rows.length === 0) {
                // 🔒 SECURITY: Lock checkout session to prevent race conditions
                const checkoutSessionResult = await client.query(
                  'SELECT * FROM retail_checkout_sessions WHERE payment_intent_id = $1 FOR UPDATE',
                  [paymentIntent.id]
                );
                
                if (checkoutSessionResult.rows.length === 0) {
                  console.error(`[WEBHOOK] No checkout session found for payment intent ${paymentIntent.id}`);
                  await client.query('COMMIT');
                  // Still clear the cart to prevent stuck state
                  if (sessionId) {
                    await storage.clearCart(sessionId);
                  }
                  break;
                }
                
                const checkoutSession = checkoutSessionResult.rows[0];
                
                // 🔒 SECURITY: Lock cart rows to prevent concurrent modifications
                const cartItems = await storage.getCartItems(sessionId, client);
                const retailItems = await storage.getRetailCart(sessionId, client);
                
                // Cart must not be empty - fail if it is (prevents race conditions and tampering)
                if (cartItems.length === 0 && retailItems.length === 0) {
                  console.error(`[WEBHOOK] Cart is empty for session ${sessionId} - payment received but no items to fulfill`);
                  console.error(`[WEBHOOK] This may indicate a race condition or tampering attempt`);
                  throw new Error('Cart is empty - cannot verify or fulfill payment');
                }
                
                // 🔒 SECURITY: Recompute subtotal and deposit from locked cart items (don't trust client metadata)
                let recomputedSubtotalCents = 0;
                let recomputedDepositCents = 0; // Deposits are charged but NOT taxed
                
                // Add legacy cart items
                for (const item of cartItems) {
                  const pricing = await getProductPricing(item.productId);
                  if (!pricing) {
                    console.error(`[WEBHOOK] Product pricing ${item.productId} not found`);
                    throw new Error(`Product pricing not found - cannot verify payment`);
                  }
                  if (!pricing.retailPrice) {
                    console.error(`[WEBHOOK] Product ${item.productId} has no retail price`);
                    throw new Error(`Product missing price - cannot verify payment`);
                  }
                  const priceInCents = Math.round(parseFloat(pricing.retailPrice) * 100);
                  recomputedSubtotalCents += priceInCents * item.quantity;
                }
                
                // Add retail v2 cart items (no discounts for one-time purchases)
                for (const item of retailItems) {
                  if (!item.retailProduct) {
                    console.error(`[WEBHOOK] Cart item ${item.id} missing retail product data`);
                    throw new Error(`Cart item missing product data - cannot verify payment`);
                  }
                  if (!item.retailProduct.price) {
                    console.error(`[WEBHOOK] Retail product ${item.retailProductId} has no price`);
                    throw new Error(`Product missing price - cannot verify payment`);
                  }
                  const priceInCents = Math.round(parseFloat(item.retailProduct.price) * 100);
                  recomputedSubtotalCents += priceInCents * item.quantity;
                  
                  // Add deposits (only for ONE-TIME purchases, not subscriptions, and not taxed)
                  if (!item.isSubscription && item.retailProduct.deposit) {
                    const depositInDollars = parseFloat(item.retailProduct.deposit.toString());
                    if (isFinite(depositInDollars) && depositInDollars > 0) {
                      const depositInCents = Math.round(depositInDollars * 100);
                      recomputedDepositCents += depositInCents * item.quantity;
                    }
                  }
                }
                
                // 🔒 SECURITY: Use stored tax metadata from checkout session (not hardcoded rate)
                // This ensures we verify against the exact tax calculated at checkout time
                const storedTaxAmountCents = checkoutSession.tax_amount_cents || 0;
                const storedTaxRateBps = checkoutSession.tax_rate_bps || 1035;
                const isTaxExempt = checkoutSession.is_tax_exempt || false;
                
                // Calculate expected tax from stored rate for verification (tax on subtotal ONLY, not deposits)
                let recomputedTaxCents = 0;
                if (!isTaxExempt && storedTaxRateBps > 0) {
                  const taxRate = storedTaxRateBps / 10000; // Convert basis points to decimal
                  recomputedTaxCents = Math.round(recomputedSubtotalCents * taxRate);
                }
                
                const recomputedTotalCents = recomputedSubtotalCents + recomputedTaxCents + recomputedDepositCents;
                
                // 🔒 SECURITY: Verify Stripe amount matches recomputed total (subtotal + tax + deposit)
                if (Math.abs(paymentIntent.amount - recomputedTotalCents) > 1) {
                  console.error(`[WEBHOOK] Payment amount verification FAILED!`);
                  console.error(`[WEBHOOK] Stripe charged: ${paymentIntent.amount} cents`);
                  console.error(`[WEBHOOK] Recomputed total: ${recomputedTotalCents} cents (subtotal: ${recomputedSubtotalCents}, tax: ${recomputedTaxCents}, deposit: ${recomputedDepositCents})`);
                  console.error(`[WEBHOOK] Stored tax from checkout: ${storedTaxAmountCents} cents at ${storedTaxRateBps} bps, exempt: ${isTaxExempt}`);
                  console.error(`[WEBHOOK] This may indicate a tampering attempt or pricing mismatch`);
                  throw new Error('Payment amount verification failed - amount mismatch');
                }
                
                // Generate order number with row-level locking to prevent race conditions
                const orderNumber = await storage.generateNextOrderNumber(client);
                
                // Determine if this is a subscription order
                const isSubscriptionOrder = cartItems.some(item => item.isSubscription) || 
                                            retailItems.some(item => item.isSubscription);
                
                // Create retail order using verified amounts
                const orderResult = await client.query(
                  `INSERT INTO retail_orders (
                    order_number, user_id, customer_name, customer_email, customer_phone,
                    status, subtotal, tax_amount, deposit_amount, total_amount, stripe_payment_intent_id, is_subscription_order, notes
                  ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) RETURNING id`,
                  [
                    orderNumber,
                    checkoutSession.user_id,
                    checkoutSession.customer_name,
                    checkoutSession.customer_email,
                    checkoutSession.customer_phone,
                    'pending',
                    (recomputedSubtotalCents / 100).toFixed(2),
                    (recomputedTaxCents / 100).toFixed(2),
                    (recomputedDepositCents / 100).toFixed(2),
                    (recomputedTotalCents / 100).toFixed(2),
                    paymentIntent.id,
                    isSubscriptionOrder,
                    checkoutSession.notes || null
                  ]
                );
                
                const orderId = orderResult.rows[0].id;
                
                // Create legacy order items
                for (const item of cartItems) {
                  const pricing = await getProductPricing(item.productId);
                  if (pricing) {
                    await client.query(
                      'INSERT INTO retail_order_items (order_id, product_id, quantity, unit_price) VALUES ($1, $2, $3, $4)',
                      [orderId, item.productId, item.quantity, pricing.retailPrice]
                    );
                  }
                }
                
                // Create retail v2 order items
                for (const item of retailItems) {
                  if (!item.retailProduct) continue;
                  
                  // Calculate price with subscription discount if applicable
                  let unitPrice = parseFloat(item.retailProduct.price);
                  if (item.isSubscription && item.retailProduct.subscriptionDiscount != null) {
                    const discountPercent = parseFloat(item.retailProduct.subscriptionDiscount.toString());
                    if (isFinite(discountPercent) && discountPercent > 0) {
                      unitPrice = unitPrice * (1 - discountPercent / 100);
                    }
                  }
                  
                  await client.query(
                    'INSERT INTO retail_order_items_v2 (order_id, retail_product_id, quantity, unit_price) VALUES ($1, $2, $3, $4)',
                    [orderId, item.retailProductId, item.quantity, unitPrice.toFixed(2)]
                  );
                }
                
                // Delete checkout session (mark as consumed)
                await client.query('DELETE FROM retail_checkout_sessions WHERE id = $1', [checkoutSession.id]);
                
                console.log(`[WEBHOOK] Created retail order ${orderNumber} for payment intent ${paymentIntent.id}`);
                
                // Send order confirmation email (non-blocking)
                const { sendOrderReceiptEmail } = await import('./email');
                const orderItems = [];
                
                // Collect legacy cart items for email
                for (const item of cartItems) {
                  const product = await storage.getProduct(item.productId);
                  const pricing = await getProductPricing(item.productId);
                  if (product && pricing) {
                    orderItems.push({
                      productName: product.name,
                      quantity: item.quantity,
                      unitPrice: pricing.retailPrice || '0.00',
                    });
                  }
                }
                
                // Collect retail v2 cart items for email
                for (const item of retailItems) {
                  if (item.retailProduct && item.retailProduct.flavor) {
                    let unitPrice = parseFloat(item.retailProduct.price);
                    if (item.isSubscription && item.retailProduct.subscriptionDiscount != null) {
                      const discountPercent = parseFloat(item.retailProduct.subscriptionDiscount.toString());
                      if (isFinite(discountPercent) && discountPercent > 0) {
                        unitPrice = unitPrice * (1 - discountPercent / 100);
                      }
                    }
                    // Use flavor name + unit description for the product name
                    const productName = `${item.retailProduct.flavor.name} - ${item.retailProduct.unitDescription}`;
                    orderItems.push({
                      productName,
                      quantity: item.quantity,
                      unitPrice: unitPrice.toFixed(2),
                    });
                  }
                }
                
                sendOrderReceiptEmail({
                  customerEmail: checkoutSession.customer_email,
                  customerName: checkoutSession.customer_name,
                  orderNumber,
                  orderItems,
                  subtotal: recomputedSubtotalCents / 100,
                  taxAmount: recomputedTaxCents > 0 ? recomputedTaxCents / 100 : undefined,
                  total: recomputedTotalCents / 100,
                  orderType: isSubscriptionOrder ? 'subscription' : 'one-time',
                }).catch(emailError => {
                  console.error(`[WEBHOOK] Failed to send order receipt email for ${orderNumber}:`, emailError);
                  // Don't fail the webhook if email fails
                });
                
                // Send admin notification for retail order (non-blocking)
                storage.getUsersByRole('admin').then(async (admins) => {
                  const superAdmins = await storage.getUsersByRole('super_admin');
                  const adminEmails = [...admins, ...superAdmins]
                    .map(u => u.email)
                    .filter((email): email is string => !!email);

                  if (adminEmails.length > 0) {
                    await sendRetailOrderAdminNotification({
                      adminEmails,
                      customerName: checkoutSession.customer_name,
                      customerEmail: checkoutSession.customer_email,
                      orderNumber,
                      orderDate: new Date(),
                      orderItems,
                      subtotal: recomputedSubtotalCents / 100,
                      taxAmount: recomputedTaxCents > 0 ? recomputedTaxCents / 100 : undefined,
                      total: recomputedTotalCents / 100,
                      orderType: isSubscriptionOrder ? 'subscription' : 'one-time',
                    });
                  }
                }).catch(emailError => {
                  console.error(`[WEBHOOK] Failed to send admin notification for ${orderNumber}:`, emailError);
                });
              } else {
                console.log(`[WEBHOOK] Order already exists for payment intent ${paymentIntent.id} - skipping creation (idempotent)`);
              }
              
              await client.query('COMMIT');
            } catch (error) {
              await client.query('ROLLBACK');
              console.error(`[WEBHOOK] Error creating retail order for payment intent ${paymentIntent.id}:`, error);
              throw error;
            } finally {
              client.release();
            }
            
            // Always clear both carts (outside transaction)
            if (sessionId) {
              await storage.clearCart(sessionId);
              await storage.clearRetailCart(sessionId);
              console.log(`[WEBHOOK] Cleared carts for session ${sessionId} after successful payment`);
            }
          }
          break;
        }

        // ---- Failure / lifecycle events ----
        // Without these, declines discovered asynchronously, chargebacks, and
        // Stripe-side cancellations never reached local state: a subscription could
        // look perfectly healthy while its payments were failing.

        case 'payment_intent.payment_failed': {
          const paymentIntent = event.data.object as Stripe.PaymentIntent;

          // A wholesale ACH debit can be returned DAYS after the customer authorised it —
          // insufficient funds, closed account, revoked mandate. Clear the "processing"
          // state so the invoice shows as unpaid again and can be retried, and tell
          // someone, because nobody is watching the checkout page by then.
          if (
            paymentIntent.metadata?.type === 'wholesale_invoice_payment' &&
            paymentIntent.metadata?.orderId
          ) {
            const failure = paymentIntent.last_payment_error?.message || 'Bank payment failed';
            const wsOrder = await storage.getWholesaleOrder(paymentIntent.metadata.orderId);
            await storage.updateWholesaleOrder(paymentIntent.metadata.orderId, {
              paymentInitiatedAt: null,
              paymentFailedAt: new Date(),
            });
            console.error(`[WEBHOOK] 🚨 Wholesale ACH payment FAILED for invoice ${wsOrder?.invoiceNumber ?? paymentIntent.metadata.orderId}: ${failure}`);

            try {
              const admins = await storage.getUsersByRole('admin');
              const superAdmins = await storage.getUsersByRole('super_admin');
              const adminEmails = [...admins, ...superAdmins]
                .map(u => u.email)
                .filter((e): e is string => !!e);
              const wsCustomer = wsOrder ? await storage.getWholesaleCustomer(wsOrder.customerId) : null;
              if (adminEmails.length > 0 && wsOrder) {
                const failLoc = wsOrder.locationId ? await storage.getWholesaleLocation(wsOrder.locationId) : null;
                await sendWholesalePaymentFailedNotification({
                  adminEmails,
                  businessName: failLoc?.locationName && failLoc.locationName !== 'Main Location'
                    ? `${wsCustomer?.businessName ?? 'Wholesale customer'} — ${failLoc.locationName}`
                    : (wsCustomer?.businessName ?? 'Wholesale customer'),
                  invoiceNumber: wsOrder.invoiceNumber,
                  amount: Number(wsOrder.totalAmount),
                  reason: failure,
                });
              }
            } catch (emailError: any) {
              console.error('[WEBHOOK] Failed to notify staff of ACH failure:', emailError.message);
            }
            break;
          }

          const subId = paymentIntent.metadata?.retailSubscriptionId;
          if (!subId) break;

          const failureMessage =
            paymentIntent.last_payment_error?.message || 'Payment failed';
          console.warn(`[WEBHOOK] ⚠️ Payment failed for retail subscription ${subId}: ${failureMessage}`);

          await db
            .update(retailSubscriptions)
            .set({
              billingStatus: 'payment_failed',
              lastPaymentIntentId: paymentIntent.id,
              // Release any lock so the retry path can pick it up again.
              processingLock: false,
              processingLockedAt: null,
            })
            .where(eq(retailSubscriptions.id, subId));
          break;
        }

        case 'invoice.payment_failed': {
          const invoice = event.data.object as any;
          const stripeSubId = invoice.subscription as string | null;
          if (!stripeSubId) break;

          console.warn(`[WEBHOOK] ⚠️ Invoice payment failed for Stripe subscription ${stripeSubId}`);
          await db
            .update(retailSubscriptions)
            .set({ billingStatus: 'payment_failed' })
            .where(eq(retailSubscriptions.stripeSubscriptionId, stripeSubId));
          break;
        }

        case 'charge.dispute.created': {
          const dispute = event.data.object as any;
          const disputedPaymentIntentId = dispute.payment_intent as string | null;
          console.error(`[WEBHOOK] 🚨 CHARGEBACK opened on PaymentIntent ${disputedPaymentIntentId} (amount ${dispute.amount}, reason: ${dispute.reason})`);

          if (disputedPaymentIntentId) {
            // Flag the order so staff can see it, and pause the subscription so we
            // don't keep charging a customer who is actively disputing.
            const [disputedOrder] = await db
              .select()
              .from(retailOrders)
              .where(eq(retailOrders.stripePaymentIntentId, disputedPaymentIntentId))
              .limit(1);

            if (disputedOrder) {
              await db
                .update(retailOrders)
                .set({ notes: `${disputedOrder.notes ? disputedOrder.notes + ' | ' : ''}DISPUTED: ${dispute.reason}` })
                .where(eq(retailOrders.id, disputedOrder.id));

              if (disputedOrder.userId) {
                await db
                  .update(retailSubscriptions)
                  .set({ status: 'paused', billingStatus: 'disputed' })
                  .where(
                    and(
                      eq(retailSubscriptions.userId, disputedOrder.userId),
                      eq(retailSubscriptions.status, 'active')
                    )
                  );
                console.warn(`[WEBHOOK] Paused active subscriptions for user ${disputedOrder.userId} pending dispute resolution`);
              }
            }
          }
          break;
        }

        case 'customer.subscription.deleted': {
          const stripeSub = event.data.object as any;
          console.log(`[WEBHOOK] Stripe subscription ${stripeSub.id} was cancelled at the source — syncing local state`);
          await db
            .update(retailSubscriptions)
            .set({ status: 'cancelled', cancelledAt: new Date() })
            .where(eq(retailSubscriptions.stripeSubscriptionId, stripeSub.id));
          break;
        }
      }

      res.json({ received: true });
    } catch (error: any) {
      console.error("Webhook error:", error);
      res.status(400).send(`Webhook Error: ${error.message}`);
    }
  });

  app.get("/api/my-subscriptions", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.id;
      
      // Fetch retail subscriptions
      const retailSubs = await db
        .select()
        .from(retailSubscriptions)
        .where(eq(retailSubscriptions.userId, userId));

      if (retailSubs.length === 0) {
        return res.json([]);
      }

      const subIds = retailSubs.map(s => s.id);

      // Batch-fetch all items for all subscriptions (avoids N+1)
      const allItems = subIds.length > 0
        ? await db
            .select()
            .from(retailSubscriptionItems)
            .where(inArray(retailSubscriptionItems.subscriptionId, subIds))
        : [];

      // Batch-fetch all referenced retail products and flavors
      const productIds = Array.from(new Set(allItems.map(i => i.retailProductId)));
      const flavorIds = Array.from(new Set(allItems.map(i => i.selectedFlavorId).filter((id): id is string => !!id)));

      const allProducts = productIds.length > 0
        ? await db.select().from(retailProducts).where(inArray(retailProducts.id, productIds))
        : [];
      const allFlavors = flavorIds.length > 0
        ? await db.select().from(flavors).where(inArray(flavors.id, flavorIds))
        : [];

      const productMap = new Map(allProducts.map(p => [p.id, p]));
      const flavorMap = new Map(allFlavors.map(f => [f.id, f]));

      // Group items by subscription and enrich
      // Keep in step with billing-cron's resolveUnitPrice(): prefer the price locked
      // in at signup, fall back to the current discounted price for legacy rows.
      const SUBSCRIPTION_TAX_RATE = 0.1035;
      const unitPriceFor = (item: any, product: any): number => {
        if (item.unitPriceAtSignup != null) {
          const locked = parseFloat(String(item.unitPriceAtSignup));
          if (Number.isFinite(locked)) return locked;
        }
        if (!product) return 0;
        const base = parseFloat(product.price);
        const discount = product.subscriptionDiscount ? Number(product.subscriptionDiscount) : 0;
        return base * (1 - discount / 100);
      };

      const subscriptionsWithItems = retailSubs.map(sub => {
        const items = allItems
          .filter(item => item.subscriptionId === sub.id)
          .map(item => {
            const product = productMap.get(item.retailProductId) || null;
            const unitPrice = unitPriceFor(item, product);
            return {
              ...item,
              retailProduct: product,
              flavor: item.selectedFlavorId ? flavorMap.get(item.selectedFlavorId) || null : null,
              // Per-line price so the UI can show a breakdown instead of bare names
              unitPrice: unitPrice.toFixed(2),
              lineTotal: (unitPrice * item.quantity).toFixed(2),
            };
          });

        // What this customer will actually be charged next, computed the same way
        // billing does — so the number on screen matches the card statement.
        const subtotal = items.reduce((sum, i) => sum + parseFloat(i.lineTotal), 0);
        const taxAmount = subtotal * SUBSCRIPTION_TAX_RATE;

        return {
          ...sub,
          items,
          estimatedNextCharge: {
            subtotal: subtotal.toFixed(2),
            taxAmount: taxAmount.toFixed(2),
            total: (subtotal + taxAmount).toFixed(2),
          },
        };
      });

      res.json(subscriptionsWithItems);
    } catch (error: any) {
      console.error('[ERROR] Failed to fetch user subscriptions:', error);
      res.status(500).json({ message: "Error fetching user subscriptions: " + error.message });
    }
  });

  app.get("/api/my-orders", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const ordersWithDetails = await storage.getRetailOrdersWithDetailsByUserId(userId);
      res.json(ordersWithDetails);
    } catch (error: any) {
      console.error('[ERROR] Failed to fetch user orders:', error);
      res.status(500).json({ message: "Error fetching orders: " + error.message });
    }
  });

  app.post("/api/orders/:id/reorder", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const orderId = req.params.id;
      const sessionId = req.sessionID || "guest";
      
      const orderDetails = await storage.getRetailOrderWithDetails(orderId);
      if (!orderDetails) {
        return res.status(404).json({ message: "Order not found" });
      }
      
      if (orderDetails.order.userId !== userId) {
        return res.status(403).json({ message: "Unauthorized" });
      }
      
      let itemsAdded = 0;
      const flavors = await storage.getFlavors(true);
      const allProductTypes = await storage.getProductTypes();
      
      for (const item of orderDetails.items) {
        const product = await storage.getProduct(item.productId);
        if (!product) {
          console.warn(`[WARN] Product ${item.productId} not found, skipping reorder item`);
          continue;
        }
        
        const flavor = flavors.find(f => f.name === product.name);
        if (!flavor) {
          console.warn(`[WARN] Flavor '${product.name}' not found in flavor library, skipping item`);
          continue;
        }
        
        const productType = allProductTypes.find(pt => pt.id === product.productTypeId);
        if (!productType) {
          console.warn(`[WARN] Product type ${product.productTypeId} not found, skipping item`);
          continue;
        }
        
        const retailProduct = await db.query.retailProducts.findFirst({
          where: and(
            eq(retailProducts.flavorId, flavor.id),
            eq(retailProducts.unitType, productType.unitType),
            eq(retailProducts.isActive, true)
          )
        });
        
        if (!retailProduct) {
          console.warn(`[WARN] Retail product not found for flavor ${flavor.name} (${flavor.id}) and unit type ${productType.unitType}, skipping item`);
          continue;
        }
        
        await storage.addRetailProductToCart({
          sessionId,
          retailProductId: retailProduct.id,
          quantity: item.quantity,
          isSubscription: false,
          subscriptionFrequency: null,
        });
        
        itemsAdded++;
      }
      
      if (itemsAdded === 0) {
        return res.status(400).json({ message: "Unable to add items to cart. Products may no longer be available." });
      }
      
      res.json({ success: true, message: `${itemsAdded} item(s) added to cart`, itemsAdded });
    } catch (error: any) {
      console.error('[ERROR] Failed to reorder:', error);
      res.status(500).json({ message: "Error reordering: " + error.message });
    }
  });

  // Update subscription (delay delivery, change product, change frequency, advance to next week)
  app.patch("/api/my-subscriptions/:id", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const subscriptionId = req.params.id;
      
      // Try to find retail subscription first
      const [retailSubscription] = await db
        .select()
        .from(retailSubscriptions)
        .where(eq(retailSubscriptions.id, subscriptionId));
      
      if (retailSubscription) {
        // Handle retail subscription update
        if (retailSubscription.userId !== userId) {
          return res.status(404).json({ message: "Subscription not found" });
        }
        
        const updateSchema = z.object({
          weeksToDelay: z.number().int().min(1).max(12).optional(),
          advanceToNextWeek: z.boolean().optional(),
          subscriptionFrequency: z.enum(['weekly', 'bi-weekly', 'every-4-weeks', 'every-6-weeks', 'every-8-weeks']).optional(),
        });
        
        const validated = updateSchema.parse(req.body);
        
        // Ensure mutually exclusive schedule changes
        if (validated.weeksToDelay && validated.advanceToNextWeek) {
          return res.status(400).json({
            message: "Cannot delay and advance pickup in the same request."
          });
        }
        
        // Validate billing state
        if (retailSubscription.status !== 'active') {
          return res.status(400).json({ 
            message: "Cannot modify a cancelled subscription." 
          });
        }
        
        if (retailSubscription.billingStatus !== 'active') {
          return res.status(400).json({ 
            message: "Cannot modify subscription while payment is in progress. Please try again later." 
          });
        }
        
        if (retailSubscription.processingLock) {
          return res.status(400).json({ 
            message: "Subscription is currently being processed. Please try again in a moment." 
          });
        }
        
        const updates: any = {};
        
        // Handle frequency change
        if (validated.subscriptionFrequency) {
          updates.subscriptionFrequency = validated.subscriptionFrequency;
        }
        
        // Handle advance to next week
        if (validated.advanceToNextWeek) {
          const BREWERY_TIMEZONE = 'America/Los_Angeles';
          const now = new Date();
          const nowPacific = toZonedTime(now, BREWERY_TIMEZONE);
          const dayOfWeek = nowPacific.getDay();
          
          if (dayOfWeek >= 5) {
            return res.status(400).json({
              message: "Cannot move pickup to next week after Thursday. Please try again next week."
            });
          }
          
          if (!retailSubscription.nextDeliveryDate) {
            return res.status(422).json({
              message: "Cannot move pickup earlier - no scheduled delivery date found."
            });
          }
          
          const currentDate = new Date(retailSubscription.nextDeliveryDate);
          
          if (isNaN(currentDate.getTime())) {
            return res.status(422).json({
              message: "Cannot move pickup earlier - invalid delivery date."
            });
          }
          
          const currentPickupDateStr = formatInTimeZone(currentDate, BREWERY_TIMEZONE, "yyyy-MM-dd");
          const todayPacific = toZonedTime(now, BREWERY_TIMEZONE);
          const nextWeekPacific = addDays(todayPacific, 7);
          const nextWeekPacificStr = formatInTimeZone(nextWeekPacific, BREWERY_TIMEZONE, "yyyy-MM-dd");
          
          if (nextWeekPacificStr >= currentPickupDateStr) {
            return res.status(400).json({
              message: `Cannot move pickup earlier - your pickup is already scheduled for ${format(currentDate, 'EEEE, MMMM d')}. This feature only works when your pickup is more than 7 days away.`
            });
          }
          
          const nextWeekUTC = fromZonedTime(`${nextWeekPacificStr}T00:00:00`, BREWERY_TIMEZONE);
          const nowPlus48Pacific = addHours(nowPacific, 48);
          const minLeadTimeUTC = fromZonedTime(nowPlus48Pacific, BREWERY_TIMEZONE);
          
          if (nextWeekUTC < minLeadTimeUTC) {
            return res.status(400).json({
              message: "Cannot move pickup to a date less than 48 hours away."
            });
          }
          
          const nextWeekDeliveryUTC = normalizeToAllowedPickupDay(nextWeekUTC);
          updates.nextDeliveryDate = nextWeekDeliveryUTC;
          // Billing happens on Monday of the pickup week
          updates.nextChargeAt = getBillingDateForPickup(nextWeekDeliveryUTC);
        }
        
        // Handle delay
        if (validated.weeksToDelay) {
          const currentDate = retailSubscription.nextDeliveryDate 
            ? new Date(retailSubscription.nextDeliveryDate)
            : new Date();
          
          const tentativeNewDate = new Date(currentDate);
          tentativeNewDate.setDate(tentativeNewDate.getDate() + (validated.weeksToDelay * 7));
          
          const newDate = normalizeToAllowedPickupDay(tentativeNewDate);
          updates.nextDeliveryDate = newDate;
          // Billing happens on Monday of the pickup week
          updates.nextChargeAt = getBillingDateForPickup(newDate);
        }
        
        // Update retail subscription
        const [updated] = await db
          .update(retailSubscriptions)
          .set(updates)
          .where(eq(retailSubscriptions.id, subscriptionId))
          .returning();
        
        return res.json(updated);
      }
    } catch (error: any) {
      console.error("Error updating subscription:", error);
      res.status(400).json({ message: "Error updating subscription: " + error.message });
    }
  });

  // ---- Customer self-service: pause / resume / skip / reactivate ----
  // These were previously staff-only or nonexistent, even though the checkout copy
  // promised "Pause, modify, or cancel anytime". Each is a separate endpoint because
  // each has different valid-state rules.

  /** Load a subscription and assert the caller owns it. */
  async function loadOwnedSubscription(subscriptionId: string, userId: string) {
    const [sub] = await db
      .select()
      .from(retailSubscriptions)
      .where(eq(retailSubscriptions.id, subscriptionId));
    if (!sub || sub.userId !== userId) return null;
    return sub;
  }

  /** Reject edits while a charge is mid-flight so we can't change what's being billed. */
  function billingInFlight(sub: any): string | null {
    if (sub.processingLock) return "Your subscription is being processed right now. Please try again in a moment.";
    if (sub.billingStatus !== 'active' && sub.billingStatus !== 'payment_failed') {
      return "Your subscription is mid-payment. Please try again shortly.";
    }
    return null;
  }

  /** Next pickup a sensible distance out, plus the billing date for that week. */
  function scheduleFrom(daysOut: number) {
    const target = new Date();
    target.setDate(target.getDate() + daysOut);
    const nextDeliveryDate = normalizeToAllowedPickupDay(target);
    return { nextDeliveryDate, nextChargeAt: getBillingDateForPickup(nextDeliveryDate) };
  }

  // "I fixed my card — charge it now." Only valid on a failed/retrying payment;
  // double-charge-safe (idempotency key is the billing period, unchanged here).
  app.post("/api/my-subscriptions/:id/retry-charge", isAuthenticated, async (req: any, res) => {
    try {
      const sub = await loadOwnedSubscription(req.params.id, req.user.id);
      if (!sub) return res.status(404).json({ message: "Subscription not found" });
      const { chargeSubscriptionNow } = await import('./billing-cron');
      const result = await chargeSubscriptionNow(sub.id);
      res.status(result.ok ? 200 : 400).json({ message: result.message });
    } catch (error: any) {
      res.status(500).json({ message: "Retry failed: " + error.message });
    }
  });

  app.post("/api/my-subscriptions/:id/pause", isAuthenticated, async (req: any, res) => {
    try {
      const sub = await loadOwnedSubscription(req.params.id, req.user.id);
      if (!sub) return res.status(404).json({ message: "Subscription not found" });
      if (sub.status !== 'active') {
        return res.status(400).json({ message: `This subscription is ${sub.status} and can't be paused.` });
      }
      const busy = billingInFlight(sub);
      if (busy) return res.status(409).json({ message: busy });

      const [updated] = await db
        .update(retailSubscriptions)
        .set({ status: 'paused' })
        .where(eq(retailSubscriptions.id, sub.id))
        .returning();

      console.log(`[SUBSCRIPTION] Customer paused ${sub.id}`);
      res.json(updated);
    } catch (error: any) {
      console.error("Error pausing subscription:", error);
      res.status(500).json({ message: "Error pausing subscription" });
    }
  });

  app.post("/api/my-subscriptions/:id/resume", isAuthenticated, async (req: any, res) => {
    try {
      const sub = await loadOwnedSubscription(req.params.id, req.user.id);
      if (!sub) return res.status(404).json({ message: "Subscription not found" });
      if (sub.status !== 'paused') {
        return res.status(400).json({ message: `Only a paused subscription can be resumed (this one is ${sub.status}).` });
      }

      // Schedule a week out so resuming never triggers a surprise same-week charge.
      const schedule = scheduleFrom(7);
      const [updated] = await db
        .update(retailSubscriptions)
        .set({ status: 'active', billingStatus: 'active', retryCount: 0, ...schedule })
        .where(eq(retailSubscriptions.id, sub.id))
        .returning();

      console.log(`[SUBSCRIPTION] Customer resumed ${sub.id}; next pickup ${schedule.nextDeliveryDate.toISOString()}`);
      res.json(updated);
    } catch (error: any) {
      console.error("Error resuming subscription:", error);
      res.status(500).json({ message: "Error resuming subscription" });
    }
  });

  /** Skip exactly one delivery — push the schedule out by a single cadence interval. */
  app.post("/api/my-subscriptions/:id/skip", isAuthenticated, async (req: any, res) => {
    try {
      const sub = await loadOwnedSubscription(req.params.id, req.user.id);
      if (!sub) return res.status(404).json({ message: "Subscription not found" });
      if (sub.status !== 'active') {
        return res.status(400).json({ message: `This subscription is ${sub.status} — only active subscriptions can skip a delivery.` });
      }
      const busy = billingInFlight(sub);
      if (busy) return res.status(409).json({ message: busy });

      const intervalDays = frequencyToDays(sub.subscriptionFrequency);
      const base = sub.nextDeliveryDate ? new Date(sub.nextDeliveryDate) : new Date();
      base.setDate(base.getDate() + intervalDays);
      const nextDeliveryDate = normalizeToAllowedPickupDay(base);
      const nextChargeAt = getBillingDateForPickup(nextDeliveryDate);

      const [updated] = await db
        .update(retailSubscriptions)
        .set({ nextDeliveryDate, nextChargeAt })
        .where(eq(retailSubscriptions.id, sub.id))
        .returning();

      console.log(`[SUBSCRIPTION] Customer skipped one delivery on ${sub.id}; next pickup ${nextDeliveryDate.toISOString()}`);
      res.json(updated);
    } catch (error: any) {
      console.error("Error skipping delivery:", error);
      res.status(500).json({ message: "Error skipping delivery" });
    }
  });

  app.post("/api/my-subscriptions/:id/reactivate", isAuthenticated, async (req: any, res) => {
    try {
      const sub = await loadOwnedSubscription(req.params.id, req.user.id);
      if (!sub) return res.status(404).json({ message: "Subscription not found" });
      if (sub.status !== 'cancelled') {
        return res.status(400).json({ message: `This subscription is ${sub.status}, not cancelled.` });
      }
      // Reactivating charges a card, so one must still be on file.
      if (!sub.stripeCustomerId || !sub.stripePaymentMethodId) {
        return res.status(400).json({
          message: "We no longer have a saved payment method for this subscription. Please start a new subscription from the shop.",
        });
      }

      const schedule = scheduleFrom(7);
      const [updated] = await db
        .update(retailSubscriptions)
        .set({
          status: 'active',
          billingStatus: 'active',
          retryCount: 0,
          cancelledAt: null,
          processingLock: false,
          processingLockedAt: null,
          ...schedule,
        })
        .where(eq(retailSubscriptions.id, sub.id))
        .returning();

      console.log(`[SUBSCRIPTION] Customer reactivated ${sub.id}; next pickup ${schedule.nextDeliveryDate.toISOString()}`);
      res.json(updated);
    } catch (error: any) {
      console.error("Error reactivating subscription:", error);
      res.status(500).json({ message: "Error reactivating subscription" });
    }
  });

  // Cancel subscription (DELETE method)
  app.delete("/api/my-subscriptions/:id", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const subscriptionId = req.params.id;
      
      const [subscription] = await db
        .select()
        .from(retailSubscriptions)
        .where(eq(retailSubscriptions.id, subscriptionId));
      
      if (!subscription || subscription.userId !== userId) {
        return res.status(404).json({ message: "Subscription not found" });
      }
      
      if (subscription.status === 'cancelled') {
        return res.status(400).json({ message: "Subscription is already cancelled" });
      }

      // Stop billing at the source FIRST. Previously this only flipped the local
      // status, so a `stripe_managed` subscription kept charging the customer forever
      // after the UI told them it was cancelled.
      if (stripe && subscription.stripeSubscriptionId) {
        try {
          await stripe.subscriptions.cancel(subscription.stripeSubscriptionId);
          console.log(`[SUBSCRIPTION] Cancelled Stripe subscription ${subscription.stripeSubscriptionId}`);
        } catch (stripeError: any) {
          // Do NOT mark it cancelled locally while Stripe still thinks it's active —
          // that is exactly the state that silently keeps charging people.
          console.error(`[SUBSCRIPTION] Failed to cancel Stripe subscription ${subscription.stripeSubscriptionId}:`, stripeError.message);
          return res.status(502).json({
            message: "We couldn't stop billing with our payment provider. Your subscription was NOT cancelled — please try again or contact support.",
          });
        }
      }

      const [cancelled] = await db
        .update(retailSubscriptions)
        .set({ status: 'cancelled', cancelledAt: new Date() })
        .where(eq(retailSubscriptions.id, subscriptionId))
        .returning();

      res.json(cancelled);
    } catch (error: any) {
      console.error("Error cancelling subscription:", error);
      res.status(500).json({ message: "Error cancelling subscription: " + error.message });
    }
  });

  // Cancel subscription (POST method for backwards compatibility)
  app.post("/api/my-subscriptions/:id/cancel", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const subscriptionId = req.params.id;
      
      const [subscription] = await db
        .select()
        .from(retailSubscriptions)
        .where(eq(retailSubscriptions.id, subscriptionId));
      
      if (!subscription || subscription.userId !== userId) {
        return res.status(404).json({ message: "Subscription not found" });
      }
      
      if (subscription.status === 'cancelled') {
        return res.status(400).json({ message: "Subscription is already cancelled" });
      }

      // Stop billing at the source FIRST. Previously this only flipped the local
      // status, so a `stripe_managed` subscription kept charging the customer forever
      // after the UI told them it was cancelled.
      if (stripe && subscription.stripeSubscriptionId) {
        try {
          await stripe.subscriptions.cancel(subscription.stripeSubscriptionId);
          console.log(`[SUBSCRIPTION] Cancelled Stripe subscription ${subscription.stripeSubscriptionId}`);
        } catch (stripeError: any) {
          // Do NOT mark it cancelled locally while Stripe still thinks it's active —
          // that is exactly the state that silently keeps charging people.
          console.error(`[SUBSCRIPTION] Failed to cancel Stripe subscription ${subscription.stripeSubscriptionId}:`, stripeError.message);
          return res.status(502).json({
            message: "We couldn't stop billing with our payment provider. Your subscription was NOT cancelled — please try again or contact support.",
          });
        }
      }

      const [cancelled] = await db
        .update(retailSubscriptions)
        .set({ status: 'cancelled', cancelledAt: new Date() })
        .where(eq(retailSubscriptions.id, subscriptionId))
        .returning();

      res.json(cancelled);
    } catch (error: any) {
      console.error("Error cancelling subscription:", error);
      res.status(500).json({ message: "Error cancelling subscription: " + error.message });
    }
  });

  // Retail subscription item management (PATCH /api/my-subscriptions/:id/items/:itemId)
  app.patch("/api/my-subscriptions/:id/items/:itemId", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const subscriptionId = req.params.id;
      const itemId = req.params.itemId;
      
      // Verify subscription belongs to user
      const [subscription] = await db
        .select()
        .from(retailSubscriptions)
        .where(eq(retailSubscriptions.id, subscriptionId));
      
      if (!subscription || subscription.userId !== userId) {
        return res.status(404).json({ message: "Subscription not found" });
      }
      
      const quantitySchema = z.object({
        quantity: z.number().int().positive(),
      });
      
      const validated = quantitySchema.parse(req.body);
      
      // Update retail subscription item
      const [updated] = await db
        .update(retailSubscriptionItems)
        .set({ quantity: validated.quantity })
        .where(eq(retailSubscriptionItems.id, itemId))
        .returning();
      
      res.json(updated);
    } catch (error: any) {
      console.error("Error updating subscription item:", error);
      res.status(400).json({ message: "Error updating subscription item: " + error.message });
    }
  });

  // Delete subscription item (customer)
  app.delete("/api/my-subscriptions/:id/items/:itemId", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const subscriptionId = req.params.id;
      const itemId = req.params.itemId;
      
      // Verify subscription belongs to user
      const [subscription] = await db
        .select()
        .from(retailSubscriptions)
        .where(eq(retailSubscriptions.id, subscriptionId));
      
      if (!subscription || subscription.userId !== userId) {
        return res.status(404).json({ message: "Subscription not found" });
      }
      
      // Check if this is the last item
      const items = await db
        .select()
        .from(retailSubscriptionItems)
        .where(eq(retailSubscriptionItems.subscriptionId, subscriptionId));
      
      if (items.length <= 1) {
        return res.status(400).json({ message: "Cannot delete the last item. Cancel the subscription instead." });
      }
      
      // Verify item exists and belongs to this subscription
      const [item] = await db
        .select()
        .from(retailSubscriptionItems)
        .where(eq(retailSubscriptionItems.id, itemId));
      
      if (!item || item.subscriptionId !== subscriptionId) {
        return res.status(404).json({ message: "Item not found" });
      }
      
      // Delete the item
      await db
        .delete(retailSubscriptionItems)
        .where(eq(retailSubscriptionItems.id, itemId));
      
      res.json({ success: true, message: "Item deleted successfully" });
    } catch (error: any) {
      console.error("Error deleting subscription item:", error);
      res.status(500).json({ message: "Error deleting subscription item: " + error.message });
    }
  });

  // Update retail subscription item flavor
  app.patch("/api/retail-subscriptions/:id/items/:itemId/flavor", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const subscriptionId = req.params.id;
      const itemId = req.params.itemId;
      
      const flavorSchema = z.object({
        selectedFlavorId: z.string().uuid(),
      });
      
      const validated = flavorSchema.parse(req.body);
      
      // Verify subscription belongs to user
      const [subscription] = await db
        .select()
        .from(retailSubscriptions)
        .where(eq(retailSubscriptions.id, subscriptionId));
      
      if (!subscription || subscription.userId !== userId) {
        return res.status(404).json({ message: "Subscription not found" });
      }

      // Verify the item belongs to this subscription (prevents editing another user's item)
      const [item] = await db
        .select()
        .from(retailSubscriptionItems)
        .where(eq(retailSubscriptionItems.id, itemId));

      if (!item || item.subscriptionId !== subscriptionId) {
        return res.status(404).json({ message: "Item not found" });
      }

      // Update the flavor
      const [updated] = await db
        .update(retailSubscriptionItems)
        .set({ selectedFlavorId: validated.selectedFlavorId })
        .where(eq(retailSubscriptionItems.id, itemId))
        .returning();
      
      res.json(updated);
    } catch (error: any) {
      console.error("Error updating subscription item flavor:", error);
      res.status(400).json({ message: "Error updating flavor: " + error.message });
    }
  });

  // Update retail subscription item quantity
  app.patch("/api/retail-subscriptions/:id/items/:itemId/quantity", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const subscriptionId = req.params.id;
      const itemId = req.params.itemId;
      
      const quantitySchema = z.object({
        quantity: z.number().int().min(1).max(5),
      });
      
      const validated = quantitySchema.parse(req.body);
      
      // Verify subscription belongs to user
      const [subscription] = await db
        .select()
        .from(retailSubscriptions)
        .where(eq(retailSubscriptions.id, subscriptionId));
      
      if (!subscription || subscription.userId !== userId) {
        return res.status(404).json({ message: "Subscription not found" });
      }
      
      // Verify item belongs to this subscription
      const [item] = await db
        .select()
        .from(retailSubscriptionItems)
        .where(eq(retailSubscriptionItems.id, itemId));
      
      if (!item || item.subscriptionId !== subscriptionId) {
        return res.status(404).json({ message: "Subscription item not found" });
      }
      
      // Update the quantity
      const [updated] = await db
        .update(retailSubscriptionItems)
        .set({ quantity: validated.quantity })
        .where(eq(retailSubscriptionItems.id, itemId))
        .returning();
      
      res.json(updated);
    } catch (error: any) {
      console.error("Error updating subscription item quantity:", error);
      res.status(400).json({ message: "Error updating quantity: " + error.message });
    }
  });

  // Add product to retail subscription
  app.post("/api/retail-subscriptions/:id/items", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const subscriptionId = req.params.id;
      
      const itemSchema = z.object({
        retailProductId: z.string().uuid(),
        selectedFlavorId: z.string().uuid().optional().nullable(),
        quantity: z.number().int().min(1).max(5).default(1),
      });
      
      const validated = itemSchema.parse(req.body);
      
      // Verify subscription belongs to user
      const [subscription] = await db
        .select()
        .from(retailSubscriptions)
        .where(eq(retailSubscriptions.id, subscriptionId));
      
      if (!subscription || subscription.userId !== userId) {
        return res.status(404).json({ message: "Subscription not found" });
      }
      
      // Verify retail product exists
      const [retailProduct] = await db
        .select()
        .from(retailProducts)
        .where(eq(retailProducts.id, validated.retailProductId));
      
      if (!retailProduct) {
        return res.status(404).json({ message: "Product not found" });
      }
      
      // For multi-flavor products, require selectedFlavorId
      if (retailProduct.productType === 'multi-flavor' && !validated.selectedFlavorId) {
        return res.status(400).json({ message: "Flavor selection required for multi-flavor products" });
      }
      
      // Create the subscription item
      const [newItem] = await db
        .insert(retailSubscriptionItems)
        .values({
          subscriptionId,
          retailProductId: validated.retailProductId,
          selectedFlavorId: validated.selectedFlavorId,
          quantity: validated.quantity,
        })
        .returning();
      
      res.json(newItem);
    } catch (error: any) {
      console.error("Error adding product to retail subscription:", error);
      res.status(400).json({ message: "Error adding product: " + error.message });
    }
  });

  // Create Stripe billing portal session for payment method updates
  // What's on file, so the account page can show "Visa ···· 4242" instead of
  // leaving people wondering whether the portal actually saved anything.
  app.get("/api/my-payment-methods", isAuthenticated, async (req: any, res) => {
    try {
      if (!stripe) return res.json({ methods: [] });
      const user = await storage.getUser(req.user.id);
      if (!user?.stripeCustomerId) return res.json({ methods: [] });
      let defaultPm: string | null = null;
      try {
        const cust: any = await stripe.customers.retrieve(user.stripeCustomerId);
        defaultPm = typeof cust?.invoice_settings?.default_payment_method === 'string'
          ? cust.invoice_settings.default_payment_method
          : cust?.invoice_settings?.default_payment_method?.id ?? null;
      } catch (e: any) {
        if (e?.code === 'resource_missing') return res.json({ methods: [] });
        throw e;
      }
      const pms = await stripe.paymentMethods.list({ customer: user.stripeCustomerId, limit: 10 });
      // Cards saved through the portal often arrive as type 'link' (Stripe's wallet
      // wrapping the card) — count those as saved methods too, or people who just
      // added a card get told they have none.
      const methods = pms.data
        .filter((pm) => pm.card || pm.us_bank_account || pm.link)
        .map((pm) => ({
          id: pm.id,
          kind: pm.card ? 'card' : pm.us_bank_account ? 'bank' : 'link',
          label: pm.card
            ? `${pm.card.brand.charAt(0).toUpperCase() + pm.card.brand.slice(1)} ···· ${pm.card.last4}`
            : pm.us_bank_account
              ? `${pm.us_bank_account.bank_name ?? 'Bank'} ···· ${pm.us_bank_account.last4}`
              : `Link${pm.link?.email ? ` (${pm.link.email})` : ''}`,
          expires: pm.card ? `${pm.card.exp_month}/${pm.card.exp_year}` : null,
          isDefault: pm.id === defaultPm,
        }));
      res.json({ methods });
    } catch (e: any) {
      res.status(500).json({ message: "Couldn't load payment methods: " + e.message });
    }
  });

  app.post("/api/create-billing-portal", isAuthenticated, async (req: any, res) => {
    try {
      if (!stripe) {
        return res.status(500).json({ message: "Stripe is not configured" });
      }

      const userId = req.user.id;
      const user = await storage.getUser(userId);

      if (!user) {
        return res.status(400).json({ message: "User not found" });
      }

      // Migrated accounts start with NO Stripe record (clean-slate migration off
      // Shopify's duplicate-ridden account) — create one on first visit so the
      // portal can take their card instead of telling them to contact support.
      let portalCustomerId = user.stripeCustomerId;
      if (!portalCustomerId) {
        portalCustomerId = await createStripeCustomer({
          userId: user.id,
          email: user.email,
          phoneNumber: user.phoneNumber,
          firstName: user.firstName ?? undefined,
          lastName: user.lastName ?? undefined,
        });
        if (!portalCustomerId) {
          return res.status(500).json({ message: "Couldn't set up billing for this account — try again or contact us." });
        }
      }

      // Create billing portal session. A stored customer id can be stale — minted
      // under the old test keys or the pre-migration Stripe account — in which case
      // live Stripe answers "No such customer": mint a fresh one and retry, exactly
      // like the id had never existed. createStripeCustomer persists the new id.
      const makePortalSession = (customerId: string) => stripe!.billingPortal.sessions.create({
        customer: customerId,
        // /my-subscriptions only redirects to /my-account — send them straight there
        return_url: `${getBaseUrl()}/my-account` // Origin is client-supplied and proxies may strip it,
      });
      let session;
      try {
        session = await makePortalSession(portalCustomerId);
      } catch (portalError: any) {
        if (portalError?.code !== 'resource_missing') throw portalError;
        console.warn(`[BILLING PORTAL] Stale Stripe customer ${portalCustomerId} for ${user.email} — recreating`);
        const freshId = await createStripeCustomer({
          userId: user.id,
          email: user.email,
          phoneNumber: user.phoneNumber,
          firstName: user.firstName ?? undefined,
          lastName: user.lastName ?? undefined,
        });
        if (!freshId) {
          return res.status(500).json({ message: "Couldn't set up billing for this account — try again or contact us." });
        }
        session = await makePortalSession(freshId);
      }

      res.json({ url: session.url });
    } catch (error: any) {
      console.error("[BILLING PORTAL] Error creating session:", error);
      res.status(500).json({ message: "Failed to create billing portal session: " + error.message });
    }
  });

  // Site settings routes (admin-only)
  app.get("/api/settings/wholesale-minimum-order", async (req, res) => {
    try {
      const result = await db.select().from(siteSettings).where(eq(siteSettings.key, 'wholesale_minimum_order'));
      const setting = result[0];
      res.json({ value: setting ? parseFloat(setting.value) : 0 });
    } catch (error: any) {
      console.error("Error fetching wholesale minimum order setting:", error);
      res.status(500).json({ message: "Error fetching setting: " + error.message });
    }
  });

  app.patch("/api/settings/wholesale-minimum-order", isAuthenticated, isAdmin, async (req, res) => {
    try {
      const { value } = req.body;
      if (typeof value !== 'number' || value < 0) {
        return res.status(400).json({ message: "Value must be a non-negative number" });
      }

      await db.insert(siteSettings)
        .values({ key: 'wholesale_minimum_order', value: value.toString(), updatedAt: new Date() })
        .onConflictDoUpdate({
          target: siteSettings.key,
          set: { value: value.toString(), updatedAt: new Date() }
        });

      res.json({ success: true, value });
    } catch (error: any) {
      console.error("Error updating wholesale minimum order setting:", error);
      res.status(500).json({ message: "Error updating setting: " + error.message });
    }
  });

  // Wholesale customer routes (admin-only access)
  app.get("/api/wholesale/customers", isAuthenticated, isStaffOrAdmin, async (req, res) => {
    try {
      const customers = await storage.getWholesaleCustomers();
      res.json(customers);
    } catch (error: any) {
      res.status(500).json({ message: "Error fetching customers: " + error.message });
    }
  });

  app.get("/api/wholesale/customers/:id", isAuthenticated, isAdmin, async (req, res) => {
    try {
      const customer = await storage.getWholesaleCustomer(req.params.id);
      if (!customer) {
        return res.status(404).json({ message: "Customer not found" });
      }
      res.json(customer);
    } catch (error: any) {
      res.status(500).json({ message: "Error fetching customer: " + error.message });
    }
  });

  app.post("/api/wholesale/customers", isAuthenticated, isAdmin, async (req, res) => {
    try {
      const customer = insertWholesaleCustomerSchema.parse(req.body);
      if (customer.phone) customer.phone = formatPhoneNumber(customer.phone);
      const created = await storage.createWholesaleCustomer(customer);

      // Welcome email with the order-online link (owner decision 2026-08-31, replacing
      // the 2026-08-19 no-auto-email policy). Prod-only via WHOLESALE_APPROVAL_EMAILS;
      // best-effort — a mail hiccup must not fail account creation.
      try {
        await sendWholesaleWelcomeEmail({
          email: created.email,
          contactName: created.contactName,
          businessName: created.businessName,
          loginUrl: `${getBaseUrl()}/wholesale/login`,
          alreadyExisted: false,
        });
      } catch (e: any) {
        console.error(`[WHOLESALE] Welcome email failed for ${created.email}: ${e.message}`);
      }

      res.json(created);
    } catch (error: any) {
      res.status(400).json({ message: "Error creating customer: " + error.message });
    }
  });

  app.patch("/api/wholesale/customers/:id", isAuthenticated, isAdmin, async (req, res) => {
    try {
      const updates = insertWholesaleCustomerSchema.partial().parse(req.body);
      if (updates.phone) updates.phone = formatPhoneNumber(updates.phone);
      const updated = await storage.updateWholesaleCustomer(req.params.id, updates);
      if (!updated) {
        return res.status(404).json({ message: "Customer not found" });
      }
      res.json(updated);
    } catch (error: any) {
      res.status(400).json({ message: "Error updating customer: " + error.message });
    }
  });

  app.delete("/api/wholesale/customers/:id", isAuthenticated, isAdmin, async (req, res) => {
    try {
      const customer = await storage.getWholesaleCustomer(req.params.id);
      if (!customer) {
        return res.status(404).json({ message: "Customer not found" });
      }
      await storage.deleteWholesaleCustomer(req.params.id);
      res.json({ message: "Customer deleted successfully" });
    } catch (error: any) {
      // Return 400 for business logic errors (e.g., customer has orders)
      if (error.message?.includes("existing orders")) {
        return res.status(400).json({ message: error.message });
      }
      res.status(500).json({ message: "Error deleting customer: " + error.message });
    }
  });

  // Send wholesale customer CSV template via email
  app.post("/api/wholesale/customers/send-template", isAuthenticated, isAdmin, async (req, res) => {
    try {
      const { email } = req.body;
      if (!email) {
        return res.status(400).json({ message: "Email address required" });
      }

      const { sendFileEmail } = await import('./email.js');
      await sendFileEmail({
        to: email,
        subject: 'Wholesale Customer Import Template - Puget Sound Kombucha Co.',
        message: `Hello,

Here's the CSV template for importing wholesale customers into your system.

The template includes the following columns:

Customer Information:
• businessName - The name of the wholesale business
• contactName - Primary contact person's full name  
• email - Primary contact email (used for login)
• additionalEmails - Optional additional authorized emails separated by pipes (|)
• phone - Business phone number
• address - Full business address
• allowOnlinePayment - Optional. ACH bank payment is enabled by default; set to "false" for invoice-only

Delivery Location (Optional):
• locationName - Name of the delivery location
• locationAddress - Street address for delivery
• locationCity - City
• locationState - State (2-letter code)
• locationZipCode - ZIP code
• locationContactName - Contact person at this location (optional)
• locationContactPhone - Contact phone for this location (optional)

Instructions:
1. Fill in your customer data following the example rows provided
2. Multiple email addresses can be listed in additionalEmails separated by | (pipe) characters
3. All listed email addresses can be used to log in via email verification code
4. Location fields are optional - leave blank if the delivery location is the same as business address
5. Save the file and use the CSV import feature in your admin dashboard

If you have any questions, please don't hesitate to reach out!`,
        attachmentPath: 'wholesale_customers_import_template.csv',
        attachmentFilename: 'wholesale_customers_import_template.csv',
      });

      res.json({ message: "Template sent successfully" });
    } catch (error: any) {
      console.error('[API] Failed to send template email:', error);
      res.status(500).json({ message: "Failed to send template: " + error.message });
    }
  });

  // Import wholesale customers from CSV
  app.post("/api/wholesale/customers/import", isAuthenticated, isAdmin, async (req, res) => {
    try {
      const { csvData } = req.body;
      if (!csvData || !Array.isArray(csvData)) {
        return res.status(400).json({ message: "Invalid CSV data format" });
      }

      const results = await storage.importWholesaleCustomers(csvData);
      res.json(results);
    } catch (error: any) {
      console.error('[API] CSV import error:', error);
      res.status(500).json({ message: "Import failed: " + error.message });
    }
  });

  // Staff routes for managing wholesale customer locations
  app.get("/api/wholesale/customers/:customerId/locations", isAuthenticated, isStaffOrAdmin, async (req, res) => {
    try {
      const locations = await storage.getWholesaleLocations(req.params.customerId);
      res.json(locations);
    } catch (error: any) {
      console.error('[API] Error fetching locations:', error);
      res.status(500).json({ message: "Error fetching locations: " + error.message });
    }
  });

  app.post("/api/wholesale/customers/:customerId/locations", isAuthenticated, isStaffOrAdmin, async (req, res) => {
    try {
      const location = insertWholesaleLocationSchema.parse({
        ...req.body,
        customerId: req.params.customerId,
      });
      const created = await storage.createWholesaleLocation(location);
      res.json(created);
    } catch (error: any) {
      res.status(400).json({ message: "Error creating location: " + error.message });
    }
  });

  app.patch("/api/wholesale/customers/:customerId/locations/:id", isAuthenticated, isStaffOrAdmin, async (req, res) => {
    try {
      // Verify the location belongs to the specified customer
      const location = await storage.getWholesaleLocation(req.params.id);
      if (!location) {
        return res.status(404).json({ message: "Location not found" });
      }
      if (location.customerId !== req.params.customerId) {
        return res.status(403).json({ message: "Location does not belong to this customer" });
      }

      const updates = insertWholesaleLocationSchema.partial().omit({ customerId: true }).parse(req.body);
      const updated = await storage.updateWholesaleLocation(req.params.id, updates);
      if (!updated) {
        return res.status(404).json({ message: "Location not found" });
      }
      res.json(updated);
    } catch (error: any) {
      res.status(400).json({ message: "Error updating location: " + error.message });
    }
  });

  app.delete("/api/wholesale/customers/:customerId/locations/:id", isAuthenticated, isStaffOrAdmin, async (req, res) => {
    try {
      // Verify the location belongs to the specified customer
      const location = await storage.getWholesaleLocation(req.params.id);
      if (!location) {
        return res.status(404).json({ message: "Location not found" });
      }
      if (location.customerId !== req.params.customerId) {
        return res.status(403).json({ message: "Location does not belong to this customer" });
      }

      await storage.deleteWholesaleLocation(req.params.id);
      res.json({ message: "Location deleted successfully" });
    } catch (error: any) {
      res.status(500).json({ message: "Error deleting location: " + error.message });
    }
  });

  // Retail customer routes (staff and admin access)
  /** Create a 7-day set-password token and send (or log-suppress) the retail welcome. */
  async function sendRetailWelcome(user: { id: string; email: string | null; firstName: string | null; username: string }): Promise<'sent' | 'suppressed' | 'no-email'> {
    if (!user.email) return 'no-email';
    const token = crypto.randomBytes(32).toString('hex');
    await storage.createPasswordResetToken(user.id, token, new Date(Date.now() + 7 * 24 * 60 * 60 * 1000));
    await sendRetailWelcomeEmail({
      to: user.email,
      name: user.firstName || user.username,
      setPasswordUrl: `${getBaseUrl()}/reset-password?token=${token}`,
    });
    if (retailWelcomeEmailsEnabled()) {
      await pool.query('update users set welcome_sent_at = now() where id = $1', [user.id]);
      return 'sent';
    }
    return 'suppressed';
  }

  // Staff adds a retail customer; the welcome email (with its set-password link) is
  // opt-in per add and only actually sends where RETAIL_WELCOME_EMAILS=true (production).
  app.post("/api/retail/customers", isAuthenticated, isStaffOrAdmin, async (req, res) => {
    try {
      const schema = z.object({
        firstName: z.string().trim().min(1),
        lastName: z.string().trim().optional().default(''),
        email: z.string().trim().email(),
        phone: z.string().trim().optional().default(''),
        sendWelcome: z.boolean().optional().default(true),
      });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ message: "Invalid customer data", errors: parsed.error.errors });
      const { firstName, lastName, email, phone, sendWelcome } = parsed.data;
      const existing = await storage.getUserByEmail(email);
      if (existing) return res.status(409).json({ message: `${email} already has an account` });
      const username = email.split('@')[0].replace(/[^a-zA-Z0-9]/g, '_') + '-' + crypto.randomUUID().slice(0, 6);
      const user = await storage.createUser({ username, email, firstName, lastName: lastName || undefined, phoneNumber: phone });
      const welcome = sendWelcome ? await sendRetailWelcome(user) : 'skipped';
      console.log(`[RETAIL] Customer added by staff: ${email} (welcome: ${welcome})`);
      res.status(201).json({ user, welcome });
    } catch (e: any) {
      res.status(500).json({ message: "Error adding customer: " + e.message });
    }
  });

  app.post("/api/retail/customers/:id/send-welcome", isAuthenticated, isStaffOrAdmin, async (req, res) => {
    try {
      const user = await storage.getUser(req.params.id);
      if (!user) return res.status(404).json({ message: "Customer not found" });
      if (user.role !== 'user') return res.status(400).json({ message: "Welcome emails are for retail customers only" });
      const welcome = await sendRetailWelcome(user);
      res.json({ welcome });
    } catch (e: any) {
      res.status(500).json({ message: "Error sending welcome: " + e.message });
    }
  });

  // The migration send: one button emails every retail customer who hasn't gotten a
  // welcome yet. Subscribers get the variant asking for their card (with their real
  // cadence, items, and first-charge deadline); everyone else gets the standard
  // welcome. Targets welcome_sent_at IS NULL, so re-running never double-emails.
  app.post("/api/retail/customers/send-welcome-all", isAuthenticated, isAdmin, async (req, res) => {
    try {
      const dryRun = req.body?.dryRun === true;
      const pending = await pool.query(
        `select u.id, u.email, u.first_name, u.username, rs.id as sub_id, rs.subscription_frequency, rs.next_charge_at
           from users u
           left join retail_subscriptions rs on rs.user_id = u.id and rs.status = 'active'
          where u.role = 'user' and u.deleted_at is null and u.email is not null and u.welcome_sent_at is null
          order by u.email`
      );
      const rows = pending.rows;
      const subscribers = rows.filter((r: any) => r.sub_id);
      if (dryRun) {
        return res.json({
          dryRun: true,
          total: rows.length,
          subscribers: subscribers.map((r: any) => r.email),
          regulars: rows.length - subscribers.length,
          emailsEnabled: retailWelcomeEmailsEnabled(),
        });
      }
      if (!retailWelcomeEmailsEnabled()) {
        return res.status(400).json({ message: "RETAIL_WELCOME_EMAILS is not enabled in this environment — nothing sent." });
      }
      const results = { sent: 0, subscriberVariant: 0, failed: [] as string[] };
      for (const r of rows) {
        try {
          const token = crypto.randomBytes(32).toString('hex');
          await storage.createPasswordResetToken(r.id, token, new Date(Date.now() + 7 * 24 * 60 * 60 * 1000));
          const setPasswordUrl = `${getBaseUrl()}/reset-password?token=${token}`;
          const name = r.first_name || r.username;
          if (r.sub_id) {
            const items = await pool.query(
              `select rsi.quantity, coalesce(f.name, 'Mixed') as flavor
                 from retail_subscription_items rsi
                 join retail_products rp on rp.id = rsi.retail_product_id
                 left join flavors f on f.id = rp.flavor_id
                where rsi.subscription_id = $1`, [r.sub_id]);
            const itemsLabel = items.rows
              .map((i: any) => `${i.quantity > 1 ? i.quantity + 'x ' : ''}${i.flavor} case`)
              .join(' + ');
            const deadline = r.next_charge_at
              ? new Date(r.next_charge_at).toLocaleDateString('en-US', { month: 'long', day: 'numeric', timeZone: 'America/Los_Angeles' })
              : 'your next charge date';
            await sendSubscriberMigrationEmail({
              to: r.email, name, setPasswordUrl,
              cadence: frequencyLabel(r.subscription_frequency),
              items: itemsLabel, deadline,
            });
            results.subscriberVariant++;
          } else {
            await sendRetailWelcomeEmail({ to: r.email, name, setPasswordUrl });
          }
          await pool.query('update users set welcome_sent_at = now() where id = $1', [r.id]);
          results.sent++;
        } catch (e: any) {
          console.error(`[MIGRATION EMAIL] failed for ${r.email}: ${e.message}`);
          results.failed.push(r.email);
        }
      }
      console.log(`[MIGRATION EMAIL] sent ${results.sent} (${results.subscriberVariant} subscriber variant), ${results.failed.length} failed`);
      res.json(results);
    } catch (e: any) {
      res.status(500).json({ message: "Error sending welcomes: " + e.message });
    }
  });

  // Shopify customer export import. Deliberately NO welcome emails here — an import must
  // never mass-email real people by surprise; staff send welcomes per customer afterward.
  app.post("/api/retail/customers/import", isAuthenticated, isAdmin, async (req, res) => {
    try {
      const rows = req.body?.rows;
      if (!Array.isArray(rows)) return res.status(400).json({ message: "rows array required" });
      const results = { imported: 0, skipped: 0, errors: [] as string[] };
      for (const row of rows.slice(0, 5000)) {
        const email = String(row.email || '').trim();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
          if (email) results.errors.push(`Skipped invalid email "${email}"`);
          continue;
        }
        const existing = await storage.getUserByEmail(email);
        if (existing) { results.skipped++; continue; }
        const username = email.split('@')[0].replace(/[^a-zA-Z0-9]/g, '_') + '-' + crypto.randomUUID().slice(0, 6);
        await storage.createUser({
          username,
          email,
          firstName: String(row.firstName || '').trim() || undefined,
          lastName: String(row.lastName || '').trim() || undefined,
          phoneNumber: String(row.phone || '').trim(),
        });
        results.imported++;
      }
      console.log(`[RETAIL] Customer import: ${results.imported} created, ${results.skipped} already existed, ${results.errors.length} rejected`);
      res.json(results);
    } catch (e: any) {
      res.status(500).json({ message: "Import failed: " + e.message });
    }
  });

  // Staff-entered retail order (phone/walk-in): no Stripe payment — pay at pickup. Uses
  // the same v2 item rows as checkout, so the orders board and stock fulfilment treat it
  // like any other order.
  app.post("/api/retail/orders", isAuthenticated, isStaffOrAdmin, async (req, res) => {
    try {
      const schema = z.object({
        userId: z.string().min(1),
        items: z.array(z.object({
          retailProductId: z.string().min(1),
          selectedFlavorId: z.string().optional().nullable(),
          quantity: z.number().int().min(1).max(50),
        })).min(1),
        pickupDate: z.string().optional().nullable(),
        notes: z.string().optional(),
        // Comped cases, or orders migrated from the old system that were already
        // paid there: goods move, no money is owed (and none hits Filing Numbers).
        noCharge: z.boolean().optional().default(false),
      });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ message: "Invalid order", errors: parsed.error.errors });
      const user = await storage.getUser(parsed.data.userId);
      if (!user || !user.email) return res.status(400).json({ message: "Customer not found" });

      let subtotal = 0;
      let deposit = 0;
      const lines: Array<{ retailProductId: string; selectedFlavorId: string | null; quantity: number; unitPrice: string }> = [];
      for (const item of parsed.data.items) {
        const [rp] = await db.select().from(retailProducts).where(eq(retailProducts.id, item.retailProductId));
        if (!rp) return res.status(400).json({ message: `Unknown product ${item.retailProductId}` });
        subtotal += Number(rp.price) * item.quantity;
        deposit += Number(rp.deposit || 0) * item.quantity;
        lines.push({ retailProductId: rp.id, selectedFlavorId: item.selectedFlavorId || null, quantity: item.quantity, unitPrice: parsed.data.noCharge ? '0.00' : String(rp.price) });
      }
      if (parsed.data.noCharge) { subtotal = 0; deposit = 0; }
      const total = subtotal + deposit;

      // Same ORDxxxxxx series checkout mints; retry past the rare collision.
      let order: any = null;
      for (let attempt = 0; !order; attempt++) {
        const cntRes: any = await db.execute(sql`SELECT COUNT(*)::int AS n FROM retail_orders`);
        const orderNumber = `ORD${String(Number(cntRes.rows[0].n) + 1 + attempt).padStart(6, '0')}`;
        try {
          order = await storage.createRetailOrder({
            orderNumber,
            userId: user.id,
            customerName: `${user.firstName || ''} ${user.lastName || ''}`.trim() || user.username,
            customerEmail: user.email,
            customerPhone: user.phoneNumber || '',
            pickupDate: parsed.data.pickupDate ? new Date(parsed.data.pickupDate) : null,
            subtotal: subtotal.toFixed(2),
            taxAmount: '0.00',
            depositAmount: deposit.toFixed(2),
            totalAmount: total.toFixed(2),
            notes: (() => {
              const tail = parsed.data.noCharge ? 'staff-entered, NO CHARGE' : 'staff-entered, pay at pickup';
              return parsed.data.notes?.trim() ? `${parsed.data.notes.trim()} — ${tail}` : `${tail.charAt(0).toUpperCase()}${tail.slice(1)}`;
            })(),
          } as any);
        } catch (err: any) {
          if (attempt >= 5 || !String(err?.message || '').includes('unique')) throw err;
        }
      }
      for (const line of lines) {
        await db.insert(retailOrderItemsV2).values({ orderId: order.id, ...line });
      }
      console.log(`[RETAIL] Staff order ${order.orderNumber} for ${user.email}: ${total.toFixed(2)} (pay at pickup)`);
      res.status(201).json(order);
    } catch (e: any) {
      res.status(500).json({ message: "Error creating order: " + e.message });
    }
  });

  app.get("/api/retail/customers", isAuthenticated, isStaffOrAdmin, async (req, res) => {
    try {
      const searchQuery = typeof req.query.search === 'string' ? req.query.search : undefined;
      const customers = await storage.getRetailCustomers(searchQuery);
      res.json(customers);
    } catch (error: any) {
      console.error("Error fetching retail customers:", error);
      res.status(500).json({ message: "Error fetching retail customers: " + error.message });
    }
  });

  // Backfill Stripe customer IDs for existing users (super admin only)
  app.post("/api/admin/backfill-stripe-customers", isAuthenticated, isSuperAdmin, async (req: any, res) => {
    try {
      const dryRun = req.body?.dryRun === true;
      const actor = req.user?.username || 'unknown';
      
      console.log(`[Stripe Backfill] Starting backfill process (actor: ${actor}, dryRun: ${dryRun}, timestamp: ${new Date().toISOString()})...`);
      
      // Get all users without Stripe customer IDs
      const usersWithoutStripe = await storage.getUsersWithoutStripeId();
      
      console.log(`[Stripe Backfill] Found ${usersWithoutStripe.length} users without Stripe customer IDs`);
      
      // Dry run mode - return projected user list without invoking Stripe
      if (dryRun) {
        const userList = usersWithoutStripe.map(u => ({
          userId: u.id,
          username: u.username,
          email: u.email,
          role: u.role,
        }));
        
        console.log(`[Stripe Backfill] Dry run complete - ${userList.length} users would be processed`);
        return res.json({
          dryRun: true,
          message: `Dry run: ${userList.length} users would be processed`,
          total: userList.length,
          users: userList,
        });
      }
      
      const results = {
        total: usersWithoutStripe.length,
        successful: 0,
        failed: 0,
        errors: [] as { userId: string; username: string; error: string }[],
      };
      
      // Process each user
      for (const user of usersWithoutStripe) {
        try {
          console.log(`[Stripe Backfill] Processing user ${user.username} (${user.id})...`);
          
          // Determine name based on role
          let firstName = user.username;
          let lastName: string | undefined = undefined;
          
          // For wholesale customers, try to get business name
          if (user.role === 'wholesale_customer') {
            const wholesaleCustomer = await storage.getWholesaleCustomerByUserId(user.id);
            if (wholesaleCustomer?.contactName) {
              const nameParts = wholesaleCustomer.contactName.split(' ');
              firstName = nameParts[0];
              lastName = nameParts.slice(1).join(' ') || undefined;
            }
          }
          
          // Create Stripe customer
          const stripeCustomerId = await createStripeCustomer({
            userId: user.id,
            email: user.email,
            phoneNumber: user.phoneNumber,
            firstName,
            lastName,
            username: user.username,
          });
          
          if (stripeCustomerId) {
            results.successful++;
            console.log(`[Stripe Backfill] ✓ Created Stripe customer for ${user.username}: ${stripeCustomerId}`);
          } else {
            results.failed++;
            results.errors.push({
              userId: user.id,
              username: user.username,
              error: "Stripe customer creation returned null",
            });
            console.log(`[Stripe Backfill] ✗ Failed to create Stripe customer for ${user.username}`);
          }
        } catch (error: any) {
          results.failed++;
          results.errors.push({
            userId: user.id,
            username: user.username,
            error: error.message || "Unknown error",
          });
          console.error(`[Stripe Backfill] ✗ Error creating Stripe customer for ${user.username}:`, error);
        }
      }
      
      console.log(`[Stripe Backfill] Complete: ${results.successful} successful, ${results.failed} failed`);
      
      res.json({
        message: `Backfill complete: ${results.successful} successful, ${results.failed} failed`,
        ...results,
      });
    } catch (error: any) {
      console.error("[Stripe Backfill] Error during backfill:", error);
      res.status(500).json({ message: "Error during backfill: " + error.message });
    }
  });

  // Wholesale location routes (staff and admin access)
  app.get("/api/wholesale/locations/:customerId", isAuthenticated, isStaffOrAdmin, async (req, res) => {
    try {
      const locations = await storage.getWholesaleLocations(req.params.customerId);
      res.json(locations);
    } catch (error: any) {
      res.status(500).json({ message: "Error fetching locations: " + error.message });
    }
  });

  app.post("/api/wholesale/locations", isAuthenticated, isStaffOrAdmin, async (req, res) => {
    try {
      const location = insertWholesaleLocationSchema.parse(req.body);
      const created = await storage.createWholesaleLocation(location);
      res.json(created);
    } catch (error: any) {
      res.status(400).json({ message: "Error creating location: " + error.message });
    }
  });

  app.patch("/api/wholesale/locations/:id", isAuthenticated, isStaffOrAdmin, async (req, res) => {
    try {
      const updates = insertWholesaleLocationSchema.partial().parse(req.body);
      const updated = await storage.updateWholesaleLocation(req.params.id, updates);
      if (!updated) {
        return res.status(404).json({ message: "Location not found" });
      }
      res.json(updated);
    } catch (error: any) {
      res.status(400).json({ message: "Error updating location: " + error.message });
    }
  });

  app.delete("/api/wholesale/locations/:id", isAuthenticated, isStaffOrAdmin, async (req, res) => {
    try {
      await storage.deleteWholesaleLocation(req.params.id);
      res.json({ message: "Location deleted successfully" });
    } catch (error: any) {
      res.status(500).json({ message: "Error deleting location: " + error.message });
    }
  });

  // Wholesale location routes (wholesale customer access)
  app.get("/api/wholesale-customer/locations", isAuthenticated, isWholesaleCustomer, async (req: any, res) => {
    try {
      const wholesaleCustomer = await storage.getWholesaleCustomerByUserId(req.user.id);
      if (!wholesaleCustomer) {
        // Pending contacts can pick a delivery address for the order they're building —
        // names and streets only, no phone numbers or delivery notes.
        const pending = await getPendingClaim(req.user.id);
        if (pending) {
          const locs = await storage.getWholesaleLocations(pending.customer.id);
          return res.json(locs.filter((l) => l.isActive).map((l) => ({
            id: l.id, customerId: l.customerId, locationName: l.locationName, address: l.address,
            city: l.city, state: l.state, zipCode: l.zipCode, isActive: l.isActive,
            contactName: null, contactPhone: null, deliveryInstructions: null,
          })));
        }
        return res.status(404).json({ message: "Wholesale customer not found" });
      }
      const locations = await storage.getWholesaleLocations(wholesaleCustomer.id);
      res.json(locations);
    } catch (error: any) {
      res.status(500).json({ message: "Error fetching locations: " + error.message });
    }
  });

  app.post("/api/wholesale-customer/locations", isAuthenticated, isWholesaleCustomer, async (req: any, res) => {
    try {
      const wholesaleCustomer = await storage.getWholesaleCustomerByUserId(req.user.id);
      if (!wholesaleCustomer) {
        return res.status(404).json({ message: "Wholesale customer not found" });
      }
      // customerId comes from the session, never the body. lat/long are a server-side
      // geocoding cache that feeds delivery routing — a client must not be able to set
      // them, or an address could be routed to arbitrary coordinates.
      const location = insertWholesaleLocationSchema
        .omit({ latitude: true, longitude: true })
        .parse({ ...req.body, customerId: wholesaleCustomer.id });
      const created = await storage.createWholesaleLocation(location);
      res.json(created);
    } catch (error: any) {
      res.status(400).json({ message: "Error creating location: " + error.message });
    }
  });

  app.patch("/api/wholesale-customer/locations/:id", isAuthenticated, isWholesaleCustomer, async (req: any, res) => {
    try {
      const wholesaleCustomer = await storage.getWholesaleCustomerByUserId(req.user.id);
      if (!wholesaleCustomer) {
        return res.status(404).json({ message: "Wholesale customer not found" });
      }
      
      // Verify the location belongs to this customer
      const location = await storage.getWholesaleLocation(req.params.id);
      if (!location) {
        return res.status(404).json({ message: "Location not found" });
      }
      if (location.customerId !== wholesaleCustomer.id) {
        return res.status(403).json({ message: "Forbidden: Location belongs to another customer" });
      }

      // customerId MUST be omitted: `.partial()` made it an optional writable field, so a
      // customer could have reassigned their location onto another company's account.
      // lat/long are server-managed geocoding output that feeds delivery routing.
      const updates = insertWholesaleLocationSchema
        .omit({ customerId: true, latitude: true, longitude: true })
        .partial()
        .parse(req.body);
      const updated = await storage.updateWholesaleLocation(req.params.id, updates);
      res.json(updated);
    } catch (error: any) {
      res.status(400).json({ message: "Error updating location: " + error.message });
    }
  });

  app.delete("/api/wholesale-customer/locations/:id", isAuthenticated, isWholesaleCustomer, async (req: any, res) => {
    try {
      const wholesaleCustomer = await storage.getWholesaleCustomerByUserId(req.user.id);
      if (!wholesaleCustomer) {
        return res.status(404).json({ message: "Wholesale customer not found" });
      }
      
      // Verify the location belongs to this customer
      const location = await storage.getWholesaleLocation(req.params.id);
      if (!location) {
        return res.status(404).json({ message: "Location not found" });
      }
      if (location.customerId !== wholesaleCustomer.id) {
        return res.status(403).json({ message: "Forbidden: Location belongs to another customer" });
      }
      
      await storage.deleteWholesaleLocation(req.params.id);
      res.json({ message: "Location deleted successfully" });
    } catch (error: any) {
      res.status(500).json({ message: "Error deleting location: " + error.message });
    }
  });

  // Wholesale order routes (staff and admin access)
  app.get("/api/wholesale/orders", isAuthenticated, isStaffOrAdmin, async (req, res) => {
    try {
      const limit = req.query.limit ? parseInt(req.query.limit as string) : undefined;
      const offset = req.query.offset ? parseInt(req.query.offset as string) : undefined;
      const result = await storage.getWholesaleOrders({ limit, offset });
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ message: "Error fetching orders: " + error.message });
    }
  });

  app.get("/api/wholesale/orders/:id", isAuthenticated, isStaffOrAdmin, async (req, res) => {
    try {
      const order = await storage.getWholesaleOrder(req.params.id);
      if (!order) {
        return res.status(404).json({ message: "Order not found" });
      }
      res.json(order);
    } catch (error: any) {
      res.status(500).json({ message: "Error fetching order: " + error.message });
    }
  });

  app.get("/api/wholesale/delivery-report", isAuthenticated, isStaffOrAdmin, async (req, res) => {
    try {
      const { date, startDate, endDate } = req.query;
      
      // Handle weekly date range query
      if (startDate && endDate) {
        if (typeof startDate !== 'string' || typeof endDate !== 'string') {
          return res.status(400).json({ message: "Start and end dates must be strings" });
        }
        
        const start = new Date(startDate);
        const end = new Date(endDate);
        
        if (isNaN(start.getTime()) || isNaN(end.getTime())) {
          return res.status(400).json({ message: "Invalid date format" });
        }
        
        const orders = await storage.getWholesaleOrdersByDeliveryDateRange(start, end);
        return res.json(await enrichOrdersWithLocation(orders));
      }
      
      // Handle single date query (daily)
      if (!date || typeof date !== 'string') {
        return res.status(400).json({ message: "Date parameter is required" });
      }

      const deliveryDate = new Date(date);
      if (isNaN(deliveryDate.getTime())) {
        return res.status(400).json({ message: "Invalid date format" });
      }

      const orders = await storage.getWholesaleOrdersByDeliveryDate(deliveryDate);
      res.json(await enrichOrdersWithLocation(orders));
    } catch (error: any) {
      res.status(500).json({ message: "Error fetching delivery report: " + error.message });
    }
  });

  /** Attach each order's delivery location so reports can show the store, not just
   *  the chain — and the store's own address/contact instead of blank account fields. */
  async function enrichOrdersWithLocation(orders: Array<{ locationId: string | null; customerId: string }>) {
    const locationCache = new Map<string, any>();
    return Promise.all(orders.map(async (order) => {
      let location = null;
      if (order.locationId) {
        if (!locationCache.has(order.locationId)) {
          locationCache.set(order.locationId, await storage.getWholesaleLocation(order.locationId));
        }
        location = locationCache.get(order.locationId) ?? null;
      }
      return { ...order, location };
    }));
  }

  app.get("/api/retail/pickup-report", isAuthenticated, isStaffOrAdmin, async (req, res) => {
    try {
      const { date } = req.query;
      if (!date || typeof date !== 'string') {
        return res.status(400).json({ message: "Date parameter is required" });
      }

      // Parse YYYY-MM-DD format consistently in UTC to avoid timezone issues
      const dateMatch = date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
      if (!dateMatch) {
        return res.status(400).json({ message: "Invalid date format. Expected YYYY-MM-DD" });
      }

      const [, year, month, day] = dateMatch;
      const pickupDate = new Date(Date.UTC(parseInt(year), parseInt(month) - 1, parseInt(day)));

      const orders = await storage.getRetailOrdersByPickupDate(pickupDate);
      res.json(orders);
    } catch (error: any) {
      res.status(500).json({ message: "Error fetching pickup report: " + error.message });
    }
  });

  /**
   * Weekly orders board — drives the tablet mounted at the brewery. One Monday-anchored
   * Pacific week of retail pickups + wholesale deliveries, with per-item production totals
   * so staff can see both "who gets what" and "what to make" at a glance. weekOffset shifts
   * whole weeks (0 = this week); clamped so a bad query can't scan the whole table.
   */
  app.get("/api/staff/orders-board", isAuthenticated, isStaffOrAdmin, async (req, res) => {
    try {
      const rawOffset = parseInt(req.query.weekOffset as string, 10);
      const weekOffset = Number.isFinite(rawOffset) ? Math.max(-26, Math.min(26, rawOffset)) : 0;
      const { start, end, mondayISO } = getPacificWeekRange(weekOffset);

      // The open retail backlog rides along on any week staff could reasonably call
      // "now": the calendar week containing today AND the board's default view (which
      // jumps to next week once Sunday hits). Past weeks stay date-bucketed history;
      // weeks further out stay clean forecasts.
      const pacificDay = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', weekday: 'short' }).format(new Date());
      const defaultOffset = pacificDay === 'Sun' ? 1 : 0;
      const retailBacklog = weekOffset === 0 || weekOffset === defaultOffset;

      const { retail, wholesale } = await storage.getWeeklyBoardOrders(start, end, { retailBacklog });

      // Retail and wholesale sell the SAME physical units (owner, 2026-08-30), but the
      // names differ ("Twelve 16 oz bottles" vs "Case of 12 Bottles"), which split the
      // prep grid into duplicate tables. Canonicalize retail unit names to the wholesale
      // unit type sharing the same finished-goods container, so one unit = one table.
      const unitRows = (await pool.query('select name, container from wholesale_unit_types')).rows;
      const retailUnitLinks = (await pool.query(
        `select distinct rp.unit_description, p.container
         from retail_products rp join products p on p.id = rp.finished_product_id`
      )).rows;
      const retailUnitAlias = new Map<string, string>();
      for (const r of retailUnitLinks as any[]) {
        const u = (unitRows as any[]).find((u) => u.container && u.container === r.container);
        if (u) retailUnitAlias.set(r.unit_description, u.name);
      }
      const canonUnit = (unitDescription: string) => retailUnitAlias.get(unitDescription) ?? unitDescription;

      // Normalise both channels to one card shape. The client maps status→stage per kind.
      const now = new Date();
      const orders = [
        ...retail.map(o => ({
          id: o.id,
          kind: 'retail' as const,
          title: o.customerName,
          reference: o.orderNumber,
          tag: o.isSubscriptionOrder ? 'Subscription' : null,
          // An open order with no pickup date — or one whose date already slipped —
          // lands on TODAY, every day, until someone fulfils it (owner, 2026-08-30).
          // A future pickup date still files under its planned day.
          scheduledDate: !['fulfilled', 'cancelled'].includes(o.status) && (!o.pickupDate || o.pickupDate < now)
            ? now
            : (o.pickupDate ?? o.orderDate),
          status: o.status,
          total: o.totalAmount,
          notes: o.notes,
          items: o.items.map(i => ({
            label: i.unitDescription ? `${i.flavorName} — ${canonUnit(i.unitDescription)}` : i.flavorName,
            quantity: i.quantity,
            note: i.notes,
          })),
        })),
        ...wholesale.map(o => ({
          id: o.id,
          kind: 'wholesale' as const,
          title: o.locationName && o.locationName !== 'Main Location' ? `${o.businessName} — ${o.locationName}` : o.businessName,
          reference: o.invoiceNumber,
          // Pickup is called out explicitly — staff must not stage it onto a delivery run.
          tag: o.fulfillmentMethod === 'pickup' ? 'Pickup at brewery' : (o.city ?? null),
          scheduledDate: o.deliveryDate ?? o.orderDate,
          status: o.status,
          total: o.totalAmount,
          notes: o.notes,
          items: o.items.map(i => ({
            label: `${i.flavorName} — ${i.unitTypeName}`,
            quantity: i.quantity,
            note: null as string | null,
          })),
        })),
      ].sort((a, b) => new Date(a.scheduledDate).getTime() - new Date(b.scheduledDate).getTime());

      // Production totals stay split by channel — the prep grid renders them as separate
      // rows — but labels are canonical, so both channels share one table per unit.
      const tally = (rows: typeof orders) => {
        const map = new Map<string, number>();
        for (const o of rows) {
          for (const it of o.items) {
            map.set(it.label, (map.get(it.label) ?? 0) + it.quantity);
          }
        }
        return Array.from(map.entries())
          .map(([label, quantity]) => ({ label, quantity }))
          .sort((a, b) => b.quantity - a.quantity);
      };

      // "To prepare this week" is remaining work, so completed orders (retail picked up /
      // wholesale delivered) don't count toward it — matching the board hiding them.
      const remaining = orders.filter(o =>
        !(o.kind === 'retail' && o.status === 'fulfilled') &&
        !(o.kind === 'wholesale' && o.status === 'delivered')
      );

      const totals = {
        retail: tally(remaining.filter(o => o.kind === 'retail')),
        wholesale: tally(remaining.filter(o => o.kind === 'wholesale')),
      };

      // Shelf stock per column, so the grid can show "In Stock" under Total. Wholesale
      // labels resolve via unit type -> container -> finished product; retail labels via
      // retail_products.finished_product_id. Unlinked labels stay null (shown as a dash).
      // Mixed-case stock is untracked (owner, 2026-08-31): its column still shows
      // demand when orders exist, but In Stock renders as a dash.
      const stockRows = (await pool.query(
        "select p.id, f.name as flavor, p.container, p.stock_quantity from products p join flavors f on f.id = p.flavor_id where f.name <> 'Mixed'"
      )).rows;
      const retailStockRows = (await pool.query(
        "select p.id, rp.unit_description, f.name as flavor, p.stock_quantity from retail_products rp left join flavors f on f.id = rp.flavor_id left join products p on p.id = rp.finished_product_id where f.name is null or f.name <> 'Mixed'"
      )).rows;
      const containerByUnit = new Map(unitRows.map((u: any) => [u.name, u.container]));
      const shelfByFlavorContainer = new Map(stockRows.map((r: any) => [`${r.flavor}|${r.container}`, { quantity: r.stock_quantity, productId: r.id }]));
      // Keyed by CANONICAL label so aliased retail units land in the shared table.
      const shelfByRetailLabel = new Map(retailStockRows.filter((r: any) => r.flavor && r.unit_description && r.id)
        .map((r: any) => [`${r.flavor} — ${canonUnit(r.unit_description)}`, { quantity: r.stock_quantity, productId: r.id }]));
      const splitLabel = (label: string) => {
        const idx = label.lastIndexOf(' — ');
        return idx === -1 ? null : { flavor: label.slice(0, idx), unit: label.slice(idx + 3) };
      };
      const stock: Record<string, { quantity: number; productId: string } | null> = {};
      for (const it of totals.wholesale) {
        const parts = splitLabel(it.label);
        const container = parts ? containerByUnit.get(parts.unit) : null;
        stock[it.label] = container != null ? (shelfByFlavorContainer.get(`${parts!.flavor}|${container}`) ?? null) : null;
      }
      for (const it of totals.retail) {
        stock[it.label] = shelfByRetailLabel.get(it.label) ?? null;
      }

      // Full flavor catalog per unit so the prep grid shows every flavor, zeros
      // included: wholesale unit types expand to every product of their container;
      // retail unit descriptions expand to their linked finished products.
      const catalog: Record<string, Array<{ flavor: string; quantity: number; productId: string }>> = {};
      for (const u of unitRows as any[]) {
        if (!u.container) continue;
        catalog[u.name] = (stockRows as any[])
          .filter((r) => r.container === u.container)
          .map((r) => ({ flavor: r.flavor, quantity: r.stock_quantity, productId: r.id }))
          .sort((a, b) => a.flavor.localeCompare(b.flavor));
      }
      for (const r of retailStockRows as any[]) {
        if (!r.flavor || !r.unit_description || !r.id) continue;
        const uname = canonUnit(r.unit_description);
        // A unit aliased onto a wholesale type already has its full container catalog.
        if (retailUnitAlias.has(r.unit_description) && catalog[uname]) continue;
        (catalog[uname] ??= []).push({ flavor: r.flavor, quantity: r.stock_quantity, productId: r.id });
      }

      // Column order on the board follows the catalog's display order (owner, 2026-09-01),
      // the same order the flavors admin page manages.
      const flavorOrder = (await pool.query('select name from flavors order by display_order, name')).rows.map((r: any) => r.name);

      res.json({
        week: { mondayISO, startISO: start.toISOString(), endISO: end.toISOString(), offset: weekOffset },
        orders,
        totals,
        stock,
        catalog,
        flavorOrder,
        bootId: SERVER_BOOT_ID,
        counts: { retail: retail.length, wholesale: wholesale.length },
      });
    } catch (error: any) {
      console.error("Error building orders board:", error);
      res.status(500).json({ message: "Error building orders board: " + error.message });
    }
  });

  app.post("/api/wholesale/orders", isAuthenticated, isStaffOrAdmin, async (req, res) => {
    try {
      const { order, items } = req.body;

      if (!items || !Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ message: "Order must contain at least one item" });
      }
      
      if (!order.customerId) {
        return res.status(400).json({ message: "Customer ID is required" });
      }

      // Same rule as the customer-facing route: pickup carries no location, delivery must
      // name one, so an order can never be scheduled with nowhere to take it.
      order.fulfillmentMethod = order.fulfillmentMethod === 'pickup' ? 'pickup' : 'delivery';
      if (order.fulfillmentMethod === 'pickup') {
        order.locationId = null;
      } else if (!order.locationId) {
        return res.status(400).json({ message: "Choose a delivery location, or set the order to pickup." });
      }

      let serverCalculatedTotal = 0;
      const validatedItems = [];
      
      for (const item of items) {
        if (!item.unitTypeId || !item.flavorId || !item.quantity || item.quantity <= 0) {
          return res.status(400).json({ message: "Invalid item data: unitTypeId, flavorId, and quantity are required" });
        }
        
        const unitType = await storage.getWholesaleUnitType(item.unitTypeId);
        if (!unitType) {
          return res.status(404).json({ message: `Unit type ${item.unitTypeId} not found` });
        }
        
        // Verify flavor exists
        const allFlavors = await storage.getFlavors();
        const flavor = allFlavors.find(f => f.id === item.flavorId);
        if (!flavor) {
          return res.status(400).json({ message: `Flavor ${item.flavorId} not found` });
        }
        
        // Check for customer-specific pricing
        const customPricing = await storage.getWholesaleCustomerPrice(order.customerId, item.unitTypeId);
        const unitPrice = customPricing ? Number(customPricing.customPrice) : Number(unitType.defaultPrice);
        const itemTotal = unitPrice * item.quantity;
        serverCalculatedTotal += itemTotal;
        
        validatedItems.push({
          unitTypeId: item.unitTypeId,
          flavorId: item.flavorId,
          quantity: item.quantity,
          unitPrice: unitPrice.toFixed(2),
        });
      }
      
      const invoiceNumber = await storage.generateNextInvoiceNumber();
      
      // Set default 30-day due date from order date
      const orderDate = order.orderDate ? new Date(order.orderDate) : new Date();
      const dueDate = new Date(orderDate.getTime() + 30 * 24 * 60 * 60 * 1000);
      
      const orderData = insertWholesaleOrderSchema.parse({
        ...order,
        invoiceNumber,
        totalAmount: serverCalculatedTotal.toFixed(2),
        dueDate,
      });
      
      const createdOrder = await storage.createWholesaleOrder(orderData);
      
      for (const item of validatedItems) {
        await storage.createWholesaleOrderItem({
          orderId: createdOrder.id,
          unitTypeId: item.unitTypeId,
          flavorId: item.flavorId,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
        });
      }
      
      // Get customer for email notifications
      const customer = await storage.getWholesaleCustomer(order.customerId);
      
      if (customer) {
        // Build items list with product names for emails
        const emailItems = await Promise.all(validatedItems.map(async (item) => {
          const unitType = await storage.getWholesaleUnitType(item.unitTypeId);
          const flavor = item.flavorId ? await storage.getFlavor(item.flavorId) : null;
          const productName = flavor 
            ? `${unitType?.name || 'Item'} - ${flavor.name}`
            : unitType?.name || 'Item';
          return {
            productName,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
          };
        }));

        // Multi-location stores: emails name the store, not just the chain.
        const emailLocation = createdOrder.locationId ? await storage.getWholesaleLocation(createdOrder.locationId) : null;
        const emailBusinessName = emailLocation?.locationName && emailLocation.locationName !== 'Main Location'
          ? `${customer.businessName} — ${emailLocation.locationName}`
          : customer.businessName;

        // Customer confirmation is a CHOICE on staff-entered orders (owner, 2026-08-31):
        // historical entries and corrections shouldn't surprise the customer. Defaults
        // on; customer-placed orders always send (their path is placeCustomerOrder).
        const sendConfirmation = req.body?.sendConfirmation !== false;
        if (!sendConfirmation) {
          console.log(`[ORDER] Confirmation email skipped by staff for ${invoiceNumber}`);
        }
        // Staff-entered confirmations go to the STORE's inbox(es) when the location
        // has one (owner, 2026-09-02: a Fremont order emailed 2nd & Pike) — account
        // email otherwise. Same routing as invoices.
        const confirmationRecipients = String((emailLocation as any)?.contactEmail || customer.email)
          .split(/[,;]/).map((e: string) => e.trim()).filter(Boolean);

        // Send emails in the background (don't block the response)
        if (sendConfirmation) sendWholesaleOrderConfirmation({
          customerEmail: confirmationRecipients,
          businessName: emailBusinessName,
          contactName: customer.contactName,
          invoiceNumber,
          orderDate,
          deliveryDate: createdOrder.deliveryDate ? new Date(createdOrder.deliveryDate) : null,
          dueDate,
          totalAmount: serverCalculatedTotal,
          items: emailItems,
          notes: order.notes || null,
        }).catch(emailError => {
          console.error('[ORDER] Failed to send customer confirmation:', emailError);
        });

        storage.getUsersByRole('admin').then(async (admins) => {
          const superAdmins = await storage.getUsersByRole('super_admin');
          const adminEmails = [...admins, ...superAdmins]
            .map(u => u.email)
            .filter((email): email is string => !!email);

          if (adminEmails.length > 0) {
            await sendWholesaleOrderAdminNotification({
              adminEmails,
              businessName: emailBusinessName,
              contactName: customer.contactName,
              invoiceNumber,
              orderDate,
              deliveryDate: createdOrder.deliveryDate ? new Date(createdOrder.deliveryDate) : null,
              totalAmount: serverCalculatedTotal,
              items: emailItems,
            });
          }
        }).catch(emailError => {
          console.error('[ORDER] Failed to send admin notification:', emailError);
        });
      }
      
      res.json(createdOrder);
    } catch (error: any) {
      console.error("Wholesale order creation error:", error);
      res.status(400).json({ message: "Error creating order: " + error.message });
    }
  });

  app.get("/api/wholesale/orders/:id/items", isAuthenticated, isStaffOrAdmin, async (req, res) => {
    try {
      const items = await storage.getWholesaleOrderItems(req.params.id);
      res.json(items);
    } catch (error: any) {
      res.status(500).json({ message: "Error fetching order items: " + error.message });
    }
  });

  app.get("/api/wholesale/all-order-items", isAuthenticated, isStaffOrAdmin, async (req, res) => {
    try {
      const items = await storage.getAllWholesaleOrderItems();
      res.json(items);
    } catch (error: any) {
      res.status(500).json({ message: "Error fetching all order items: " + error.message });
    }
  });

  app.get("/api/wholesale/orders/:id/invoice", isAuthenticated, isStaffOrOwningWholesaleCustomer, async (req, res) => {
    try {
      const orderDetails = await storage.getWholesaleOrderWithDetails(req.params.id);
      if (!orderDetails) {
        return res.status(404).json({ message: "Order not found" });
      }
      const adjustments = await storage.getWholesaleOrderAdjustments(req.params.id);
      res.json({ ...orderDetails, adjustments });
    } catch (error: any) {
      res.status(500).json({ message: "Error fetching invoice: " + error.message });
    }
  });

  /**
   * Invoice adjustments: signed amounts (pallet fee +, damage credit -) staff can attach
   * to an order. Locked once payment is settled or an ACH debit is in flight — changing
   * an invoice mid-debit would desync the amount charged from the amount invoiced.
   */
  app.post("/api/wholesale/orders/:id/adjustments", isAuthenticated, isStaffOrAdmin, async (req: any, res) => {
    try {
      const order = await storage.getWholesaleOrder(req.params.id);
      if (!order) return res.status(404).json({ message: "Order not found" });
      if (order.paidAt) return res.status(400).json({ message: "This invoice is already paid — adjustments are locked." });
      if (order.paymentInitiatedAt && !order.paymentFailedAt) {
        return res.status(400).json({ message: "A bank payment is processing — adjustments are locked until it settles or fails." });
      }

      const schema = z.object({
        label: z.string().trim().min(1, "Label is required").max(100),
        amount: z.coerce.number().refine(n => Number.isFinite(n) && n !== 0, "Amount must be a non-zero number")
          .refine(n => Math.abs(n) <= 10000, "Amount out of range"),
      });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ message: parsed.error.errors[0].message });

      // A credit larger than the invoice would produce a negative total; refuse rather
      // than invent a "we owe them money" state the payment flow can't represent.
      const wouldBe = Number(order.totalAmount) + parsed.data.amount;
      if (wouldBe < 0) {
        return res.status(400).json({ message: `That credit exceeds the invoice — total would be $${wouldBe.toFixed(2)}.` });
      }

      const { adjustment, total } = await storage.createWholesaleOrderAdjustment({
        orderId: req.params.id,
        label: parsed.data.label,
        amount: parsed.data.amount.toFixed(2),
        createdByUserId: req.user?.id ?? null,
      });
      res.json({ adjustment, totalAmount: total.toFixed(2) });
    } catch (error: any) {
      res.status(500).json({ message: "Error adding adjustment: " + error.message });
    }
  });

  app.delete("/api/wholesale/orders/:id/adjustments/:adjustmentId", isAuthenticated, isStaffOrAdmin, async (req, res) => {
    try {
      const order = await storage.getWholesaleOrder(req.params.id);
      if (!order) return res.status(404).json({ message: "Order not found" });
      if (order.paidAt) return res.status(400).json({ message: "This invoice is already paid — adjustments are locked." });
      if (order.paymentInitiatedAt && !order.paymentFailedAt) {
        return res.status(400).json({ message: "A bank payment is processing — adjustments are locked until it settles or fails." });
      }
      const total = await storage.deleteWholesaleOrderAdjustment(req.params.adjustmentId, req.params.id);
      if (total === null) return res.status(404).json({ message: "Adjustment not found" });
      res.json({ totalAmount: total.toFixed(2) });
    } catch (error: any) {
      res.status(500).json({ message: "Error removing adjustment: " + error.message });
    }
  });

  app.post("/api/wholesale/orders/:id/send-invoice", isAuthenticated, isAdmin, async (req, res) => {
    try {
      const { dueDate } = req.body;
      
      const orderDetails = await storage.getWholesaleOrderWithDetails(req.params.id);
      if (!orderDetails) {
        return res.status(404).json({ message: "Order not found" });
      }

      const { order, customer, items } = orderDetails;
      
      // Calculate subtotal
      // The email template renders this as the amount due, so it must be the true invoice
      // total (items + adjustments) — summing items alone would understate an invoice
      // carrying a pallet fee or overstate one carrying a credit.
      const subtotal = parseFloat(order.totalAmount);
      
      // Set due date (default 30 days from now if not provided)
      const dueDateValue = dueDate ? new Date(dueDate) : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
      
      // Update order with due date and sent timestamp
      await storage.updateWholesaleOrder(req.params.id, {
        dueDate: dueDateValue,
        invoiceSentAt: new Date(),
      });

      // Generate payment URL for online payment customers
      let paymentUrl: string | null = null;
      // Don't email a payment link for an invoice that's already paid or has a debit in
      // flight — following it would start a second ACH debit for the same invoice.
      if ((customer.allowOnlinePayment || customer.allowCardPayment) && stripe && !order.paidAt && !order.paymentInitiatedAt) {
        const session = await createWholesaleCheckoutSession(order, customer, items);
        paymentUrl = session.url;
      }

      // Prepare invoice items for email — adjustments render as qty-1 lines so the
      // emailed invoice's lines sum to the same total the customer is asked to pay.
      const orderAdjustments = await storage.getWholesaleOrderAdjustments(order.id);
      const invoiceItems = [
        ...items.map((item: any) => ({
          productName: item.product.flavor ? `${item.product.name} - ${item.product.flavor}` : item.product.name,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
        })),
        ...orderAdjustments.map((a) => ({
          productName: a.label,
          quantity: 1,
          unitPrice: a.amount,
        })),
      ];

      // Prepare location if available
      const location = order.location ? {
        locationName: order.location.locationName,
        address: order.location.address,
        city: order.location.city,
        state: order.location.state,
        zipCode: order.location.zipCode,
        contactName: order.location.contactName,
        contactPhone: order.location.contactPhone,
      } : null;

      // Get customer address from location (if available)
      let customerAddress = '';
      if (location) {
        customerAddress = `${location.address}, ${location.city}, ${location.state} ${location.zipCode}`;
      } else {
        // Fall back to first location if no specific location on order
        const locations = await storage.getWholesaleLocations(customer.id);
        if (locations.length > 0) {
          const loc = locations[0];
          customerAddress = `${loc.address}, ${loc.city}, ${loc.state} ${loc.zipCode}`;
        }
      }

      // Invoices go to the delivery location's own inbox(es) when set — each
      // Evergreens store bills separately, and a location may list several addresses
      // separated by commas (owner, 2026-08-31). Account email otherwise.
      const invoiceRecipient = String((order.location as any)?.contactEmail || customer.email)
        .split(/[,;]/)
        .map((e: string) => e.trim())
        .filter(Boolean);

      // Send the invoice email
      await sendWholesaleInvoiceEmail({
        poNumber: (order as any).poNumber ?? null,
        customerEmail: invoiceRecipient,
        businessName: customer.businessName,
        contactName: customer.contactName,
        customerAddress,
        customerPhone: customer.phone,
        invoiceNumber: order.invoiceNumber,
        orderDate: new Date(order.orderDate),
        deliveryDate: order.deliveryDate ? new Date(order.deliveryDate) : null,
        dueDate: dueDateValue,
        items: invoiceItems,
        subtotal,
        notes: order.notes,
        location,
        allowOnlinePayment: customer.allowOnlinePayment || customer.allowCardPayment,
        paymentUrl,
        paidAt: order.paidAt ? new Date(order.paidAt) : null,
      });

      res.json({
        success: true,
        message: `Invoice sent to ${invoiceRecipient.join(", ")}`,
        hasPaymentLink: !!paymentUrl,
      });
    } catch (error: any) {
      console.error("Error sending invoice email:", error);
      res.status(500).json({ message: "Error sending invoice: " + error.message });
    }
  });

  // Mark invoice as paid (admin only)
  app.post("/api/wholesale/orders/:id/mark-paid", isAuthenticated, isAdmin, async (req, res) => {
    try {
      const order = await storage.getWholesaleOrder(req.params.id);
      if (!order) {
        return res.status(404).json({ message: "Order not found" });
      }

      if (order.paidAt) {
        return res.status(400).json({ message: "Invoice is already marked as paid" });
      }

      const user = req.user as any;
      const paidAt = new Date();
      await storage.updateWholesaleOrder(req.params.id, {
        paidAt,
        paidByUserId: user.id,
      });

      // Check arrived and staff recorded it — the customer's AP inbox gets the same
      // receipt an online payment would have produced (owner, 2026-08-31).
      sendWholesaleReceiptForOrder(req.params.id, paidAt).catch((e) =>
        console.error('[MARK-PAID] Failed to send payment receipt:', e.message));

      res.json({
        success: true,
        message: "Invoice marked as paid — receipt emailed to the customer",
      });
    } catch (error: any) {
      console.error("Error marking invoice as paid:", error);
      res.status(500).json({ message: "Error marking invoice as paid: " + error.message });
    }
  });

  // Set due date without sending invoice (admin only)
  app.post("/api/wholesale/orders/:id/set-due-date", isAuthenticated, isAdmin, async (req, res) => {
    try {
      const { dueDate } = req.body;
      
      if (!dueDate) {
        return res.status(400).json({ message: "Due date is required" });
      }

      const order = await storage.getWholesaleOrder(req.params.id);
      if (!order) {
        return res.status(404).json({ message: "Order not found" });
      }

      const dueDateValue = new Date(dueDate);
      await storage.updateWholesaleOrder(req.params.id, {
        dueDate: dueDateValue,
      });

      res.json({ 
        success: true, 
        message: `Due date set to ${dueDateValue.toLocaleDateString()}`,
      });
    } catch (error: any) {
      console.error("Error setting due date:", error);
      res.status(500).json({ message: "Error setting due date: " + error.message });
    }
  });

  app.patch("/api/wholesale/orders/:id", isAuthenticated, isStaffOrAdmin, async (req, res) => {
    try {
      const { status, deliveryDate, notes, items, poNumber } = req.body;
      
      const order = await storage.getWholesaleOrder(req.params.id);
      if (!order) {
        return res.status(404).json({ message: "Order not found" });
      }

      let updated = order;

      let stockWarnings: string[] = [];
      if (status) {
        if (!['pending', 'processing', 'packaged', 'shipped', 'delivered'].includes(status)) {
          return res.status(400).json({ message: "Invalid status" });
        }
        updated = await storage.updateWholesaleOrderStatus(req.params.id, status);
        // DELIVERED is when the cases physically leave the shelf (owner, 2026-08-31):
        // packaging materials were already consumed when the production was logged, so
        // the order's Packaged status is just staging. Walking back restores. Idempotent.
        const stock = await storage.applyWholesaleOrderStock(
          req.params.id,
          ['delivered', 'fulfilled'].includes(status) ? 'apply' : 'restore',
          (req as any).user?.id
        );
        stockWarnings = stock.warnings;
        // Delivered with no delivery date on file (orders-board tap): today IS the
        // delivery date, and net-30 runs from it.
        if (status === 'delivered' && !updated.deliveryDate) {
          const now = new Date();
          updated = await storage.updateWholesaleOrderDeliveryDate(req.params.id, now) || updated;
          updated = await storage.updateWholesaleOrder(req.params.id, { dueDate: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000) }) || updated;
        }
      }

      if (deliveryDate !== undefined) {
        const dateValue = deliveryDate ? new Date(deliveryDate) : null;
        updated = await storage.updateWholesaleOrderDeliveryDate(req.params.id, dateValue) || updated;
        // Net-30 runs from DELIVERY (owner, 2026-08-31): setting or moving the delivery
        // date re-anchors the due date. Staff can still override via Set Due Date after.
        if (dateValue) {
          updated = await storage.updateWholesaleOrder(req.params.id, { dueDate: new Date(dateValue.getTime() + 30 * 24 * 60 * 60 * 1000) }) || updated;
        }
      }

      // PO number is editable after the fact — accounts often supply it late.
      if (poNumber !== undefined) {
        const value = typeof poNumber === 'string' && poNumber.trim() ? poNumber.trim().slice(0, 50) : null;
        updated = await storage.updateWholesaleOrder(req.params.id, { poNumber: value }) || updated;
      }

      // Handle notes update
      if (notes !== undefined) {
        updated = await storage.updateWholesaleOrder(req.params.id, { notes: notes || null }) || updated;
      }

      // Handle order items update (replace all items)
      if (items && Array.isArray(items)) {
        // Get the customer to determine pricing
        const customer = await storage.getWholesaleCustomer(order.customerId);
        if (!customer) {
          return res.status(400).json({ message: "Customer not found" });
        }

        // Get customer-specific pricing and unit types
        const customerPricing = await storage.getWholesaleCustomerPricing(order.customerId);
        const unitTypes = await storage.getWholesaleUnitTypes();

        // Calculate new total and validate items
        let newTotal = 0;
        const validatedItems: Array<{ unitTypeId: string; flavorId: string; quantity: number; unitPrice: string }> = [];

        for (const item of items) {
          if (!item.unitTypeId || !item.flavorId || !item.quantity || item.quantity <= 0) {
            return res.status(400).json({ message: "Invalid item: each item must have unitTypeId, flavorId, and positive quantity" });
          }

          // Get price - check for customer-specific pricing first
          const customPrice = customerPricing.find(p => p.unitTypeId === item.unitTypeId);
          let unitPrice: number;
          
          if (customPrice) {
            unitPrice = Number(customPrice.customPrice);
          } else {
            const unitType = unitTypes.find(ut => ut.id === item.unitTypeId);
            if (!unitType) {
              return res.status(400).json({ message: `Invalid unit type: ${item.unitTypeId}` });
            }
            unitPrice = Number(unitType.defaultPrice);
          }

          validatedItems.push({
            unitTypeId: item.unitTypeId,
            flavorId: item.flavorId,
            quantity: item.quantity,
            unitPrice: unitPrice.toString(),
          });

          newTotal += unitPrice * item.quantity;
        }

        // Delete existing items
        await storage.deleteWholesaleOrderItems(req.params.id);

        // Create new items
        for (const item of validatedItems) {
          await storage.createWholesaleOrderItem({
            orderId: req.params.id,
            unitTypeId: item.unitTypeId,
            flavorId: item.flavorId,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
          });
        }

        // Update order total
        updated = await storage.updateWholesaleOrder(req.params.id, { totalAmount: newTotal.toString() }) || updated;
      }

      res.json({ ...updated, stockWarnings });
    } catch (error: any) {
      res.status(500).json({ message: "Error updating order: " + error.message });
    }
  });

  app.delete("/api/wholesale/orders/:id", isAuthenticated, isAdmin, async (req, res) => {
    try {
      const order = await storage.getWholesaleOrder(req.params.id);
      if (!order) {
        return res.status(404).json({ message: "Order not found" });
      }
      await storage.deleteWholesaleOrder(req.params.id);
      res.json({ message: "Order deleted successfully" });
    } catch (error: any) {
      res.status(500).json({ message: "Error deleting order: " + error.message });
    }
  });

  app.get("/api/wholesale/pricing/all", isAuthenticated, isStaffOrAdmin, async (req, res) => {
    try {
      const pricing = await storage.getAllWholesalePricing();
      res.json(pricing);
    } catch (error: any) {
      res.status(500).json({ message: "Error fetching pricing: " + error.message });
    }
  });

  app.get("/api/wholesale/pricing/:customerId", isAuthenticated, isStaffOrAdmin, async (req, res) => {
    try {
      const pricing = await storage.getWholesalePricing(req.params.customerId);
      res.json(pricing);
    } catch (error: any) {
      res.status(500).json({ message: "Error fetching pricing: " + error.message });
    }
  });

  app.post("/api/wholesale/pricing", isAuthenticated, isAdmin, async (req, res) => {
    try {
      const { customerId, productTypeId, customPrice } = req.body;
      
      if (!customerId || !productTypeId || !customPrice) {
        return res.status(400).json({ message: "customerId, productTypeId, and customPrice are required" });
      }

      const pricing = await storage.setWholesalePrice({
        customerId,
        productTypeId,
        customPrice: customPrice.toString(),
      });
      res.json(pricing);
    } catch (error: any) {
      res.status(400).json({ message: "Error setting pricing: " + error.message });
    }
  });

  // Create Stripe checkout session for wholesale invoice payment
  // Was completely unauthenticated: anyone who guessed an order id could mint Stripe
  // checkout sessions against it.
  app.post("/api/wholesale/orders/:id/create-payment", isAuthenticated, isStaffOrOwningWholesaleCustomer, async (req, res) => {
    try {
      if (!stripe) {
        return res.status(503).json({ message: "Payment processing is not configured" });
      }

      const orderDetails = await storage.getWholesaleOrderWithDetails(req.params.id);
      if (!orderDetails) {
        return res.status(404).json({ message: "Order not found" });
      }

      const { order, customer } = orderDetails;

      // Check if customer has any online payment method enabled
      if (!customer.allowOnlinePayment && !customer.allowCardPayment) {
        return res.status(403).json({ message: "Online payment not enabled for this customer" });
      }

      if (order.paidAt) {
        return res.status(400).json({ message: "This invoice has already been paid" });
      }
      // An ACH debit already in flight takes days to settle. Starting a second one would
      // debit the customer twice for the same invoice.
      if (order.paymentInitiatedAt && !order.paymentFailedAt) {
        return res.status(400).json({
          message: "A bank payment for this invoice is already processing. It can take up to 5 business days to clear.",
        });
      }

      const session = await createWholesaleCheckoutSession(order, customer, orderDetails.items);
      res.json({ url: session.url, sessionId: session.id });
    } catch (error: any) {
      console.error("Wholesale payment checkout error:", error);
      res.status(500).json({ message: "Error creating checkout: " + error.message });
    }
  });

  // Cart routes
  app.get("/api/cart", async (req, res) => {
    try {
      const sessionId = req.sessionID || "guest";
      const items = await storage.getCartItems(sessionId);
      
      const itemsWithProducts = await Promise.all(
        items.map(async (item) => {
          const product = await storage.getProduct(item.productId);
          const pricing = await getProductPricing(item.productId);
          return {
            ...item,
            product: product && pricing ? {
              id: product.id,
              name: product.name,
              retailPrice: pricing.retailPrice,
              imageUrl: product.imageUrl,
            } : null,
          };
        })
      );
      
      res.json(itemsWithProducts.filter(item => item.product !== null));
    } catch (error: any) {
      res.status(500).json({ message: "Error fetching cart: " + error.message });
    }
  });

  app.post("/api/cart", async (req, res) => {
    try {
      const sessionId = req.sessionID || "guest";
      const { productId, quantity, isSubscription, subscriptionFrequency } = req.body;
      
      const cartItem = await storage.addToCart({
        sessionId,
        productId,
        quantity: quantity || 1,
        isSubscription: isSubscription || false,
        subscriptionFrequency: isSubscription ? subscriptionFrequency : null,
      });
      
      res.json(cartItem);
    } catch (error: any) {
      res.status(400).json({ message: "Error adding to cart: " + error.message });
    }
  });

  app.patch("/api/cart/:id", async (req, res) => {
    try {
      const { quantity } = req.body;
      const parsedQuantity = Number(quantity);
      
      if (!Number.isFinite(parsedQuantity) || parsedQuantity < 1) {
        return res.status(400).json({ message: "Invalid quantity" });
      }
      
      const updated = await storage.updateCartItemQuantity(req.params.id, parsedQuantity);
      res.json(updated);
    } catch (error: any) {
      res.status(500).json({ message: "Error updating cart item: " + error.message });
    }
  });

  app.delete("/api/cart/:id", async (req, res) => {
    try {
      await storage.removeFromCart(req.params.id);
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ message: "Error removing from cart: " + error.message });
    }
  });

  // Retail Cart V2 routes (new schema)
  app.get("/api/retail-cart", async (req, res) => {
    try {
      const sessionId = req.sessionID || "guest";
      const items = await storage.getRetailCart(sessionId);
      res.json(items);
    } catch (error: any) {
      res.status(500).json({ message: "Error fetching retail cart: " + error.message });
    }
  });

  app.post("/api/retail-cart", async (req, res) => {
    try {
      const sessionId = req.sessionID || "guest";
      const { retailProductId, selectedFlavorId, quantity, isSubscription, subscriptionFrequency } = req.body;
      
      // Validate that multi-flavor products have a selected flavor
      const product = await storage.getRetailProduct(retailProductId);
      if (!product) {
        return res.status(404).json({ message: "Product not found" });
      }
      
      if (product.productType === 'multi-flavor' && !selectedFlavorId) {
        return res.status(400).json({ message: "Please select a flavor for this variety pack" });
      }

      // Wholesale accounts don't do subscriptions. Their login is a business identity with
      // negotiated pricing and invoiced terms; a recurring card charge against it is a
      // different commercial arrangement entirely. Blocked here rather than only in the UI,
      // since /api/retail-cart is reachable by any logged-in user.
      if (isSubscription && (req.user as any)?.role === 'wholesale_customer') {
        return res.status(403).json({
          message: "Wholesale accounts can't place subscription orders. Use the wholesale portal to order, or contact us to set up a standing order.",
        });
      }

      // Reject unknown cadences at the door — an unrecognised value used to flow all
      // the way through to billing and silently charge every 4 weeks.
      let validatedFrequency: string | null = null;
      if (isSubscription) {
        const parsed = subscriptionFrequencySchema.safeParse(subscriptionFrequency);
        if (!parsed.success) {
          return res.status(400).json({ message: `Invalid subscription frequency: ${subscriptionFrequency}` });
        }
        validatedFrequency = parsed.data;
      }

      const cartItem = await storage.addRetailProductToCart({
        sessionId,
        retailProductId,
        selectedFlavorId: selectedFlavorId || null,
        quantity: quantity || 1,
        isSubscription: isSubscription || false,
        subscriptionFrequency: validatedFrequency,
      });
      
      res.json(cartItem);
    } catch (error: any) {
      res.status(400).json({ message: "Error adding to retail cart: " + error.message });
    }
  });

  app.patch("/api/retail-cart/:id", async (req, res) => {
    try {
      const { quantity } = req.body;
      const parsedQuantity = Number(quantity);
      
      if (!Number.isFinite(parsedQuantity) || parsedQuantity < 1) {
        return res.status(400).json({ message: "Invalid quantity" });
      }
      
      const updated = await storage.updateRetailCartItemQuantity(req.params.id, parsedQuantity);
      res.json(updated);
    } catch (error: any) {
      res.status(500).json({ message: "Error updating retail cart item: " + error.message });
    }
  });

  app.delete("/api/retail-cart/:id", async (req, res) => {
    try {
      await storage.removeRetailCartItem(req.params.id);
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ message: "Error removing from retail cart: " + error.message });
    }
  });

  // Inventory management routes
  app.get("/api/inventory/low-stock", isAuthenticated, isStaffOrAdmin, async (req, res) => {
    try {
      const lowStockProducts = await storage.getLowStockProducts();
      res.json(lowStockProducts);
    } catch (error: any) {
      res.status(500).json({ message: "Error fetching low stock products: " + error.message });
    }
  });

  app.patch("/api/inventory/:id", isAuthenticated, isStaffOrAdmin, async (req, res) => {
    try {
      const { stockQuantity } = req.body;
      const parsedStock = Number(stockQuantity);
      
      if (!Number.isFinite(parsedStock) || parsedStock < 0) {
        return res.status(400).json({ message: "Invalid stock quantity" });
      }
      
      const product = await storage.updateProductStock(req.params.id, parsedStock);
      if (!product) {
        return res.status(404).json({ message: "Product not found" });
      }
      
      res.json(product);
    } catch (error: any) {
      res.status(500).json({ message: "Error updating stock: " + error.message });
    }
  });

  // Customer-facing order history endpoint
  app.get("/api/my-orders", isAuthenticated, async (req: any, res) => {
    try {
      if (!req.user) {
        return res.status(401).json({ message: "Not authenticated" });
      }
      
      const orders = await storage.getRetailOrdersByUserId(req.user.id);
      res.json(orders);
    } catch (error: any) {
      console.error("Error fetching user orders:", error);
      res.status(500).json({ message: "Failed to fetch orders" });
    }
  });

  // Resend order confirmation email
  app.post("/api/orders/:orderId/resend-email", isAuthenticated, async (req: any, res) => {
    try {
      const orderId = req.params.orderId;
      
      // Get the order
      const order = await storage.getRetailOrder(orderId);
      if (!order) {
        return res.status(404).json({ message: "Order not found" });
      }

      // Verify user owns this order or is staff
      if (order.userId !== req.user!.id && req.user!.role !== 'staff' && req.user!.role !== 'admin' && req.user!.role !== 'super_admin') {
        return res.status(403).json({ message: "Not authorized to resend email for this order" });
      }

      // Collect order items for email
      const { sendOrderReceiptEmail } = await import('./email');
      const orderItems = [];
      
      // Get legacy order items
      const legacyItems = await db
        .select({
          id: retailOrderItems.id,
          orderId: retailOrderItems.orderId,
          productId: retailOrderItems.productId,
          quantity: retailOrderItems.quantity,
          unitPrice: retailOrderItems.unitPrice,
          product: products,
        })
        .from(retailOrderItems)
        .innerJoin(products, eq(products.id, retailOrderItems.productId))
        .where(eq(retailOrderItems.orderId, orderId));
        
      for (const item of legacyItems) {
        if (item.product) {
          orderItems.push({
            productName: item.product.name,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
          });
        }
      }
      
      // Get retail v2 items
      const v2Items = await db
        .select({
          id: retailOrderItemsV2.id,
          orderId: retailOrderItemsV2.orderId,
          retailProductId: retailOrderItemsV2.retailProductId,
          quantity: retailOrderItemsV2.quantity,
          unitPrice: retailOrderItemsV2.unitPrice,
          retailProduct: retailProducts,
          flavor: flavors,
        })
        .from(retailOrderItemsV2)
        .innerJoin(retailProducts, eq(retailProducts.id, retailOrderItemsV2.retailProductId))
        .innerJoin(flavors, eq(flavors.id, retailProducts.flavorId))
        .where(eq(retailOrderItemsV2.orderId, orderId));
      
      for (const item of v2Items) {
        if (item.retailProduct && item.flavor) {
          const productName = `${item.flavor.name} - ${item.retailProduct.unitDescription}`;
          orderItems.push({
            productName,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
          });
        }
      }

      if (orderItems.length === 0) {
        return res.status(400).json({ message: "No order items found to send in email" });
      }

      // Send the email
      await sendOrderReceiptEmail({
        customerEmail: order.customerEmail,
        customerName: order.customerName,
        orderNumber: order.orderNumber,
        orderItems,
        subtotal: parseFloat(order.subtotal),
        taxAmount: order.taxAmount ? parseFloat(order.taxAmount) : undefined,
        total: parseFloat(order.totalAmount),
        orderType: order.isSubscriptionOrder ? 'subscription' : 'one-time',
      });

      console.log(`[EMAIL] Manually resent order confirmation for ${order.orderNumber} to ${order.customerEmail}`);
      
      res.json({ 
        success: true, 
        message: `Order confirmation email sent to ${order.customerEmail}` 
      });
    } catch (error: any) {
      console.error("Error resending order email:", error);
      res.status(500).json({ message: error.message || "Failed to resend order confirmation email" });
    }
  });

  // Retail order counts by status
  app.get("/api/retail/orders/counts", isAuthenticated, isStaffOrAdmin, async (_req, res) => {
    try {
      const counts = await storage.getRetailOrderCounts();
      res.json(counts);
    } catch (error: any) {
      console.error("Error fetching retail order counts:", error);
      res.status(500).json({ message: "Failed to fetch retail order counts" });
    }
  });

  // Retail orders routes (staff and admin access)
  app.get("/api/retail/orders", isAuthenticated, isStaffOrAdmin, async (req, res) => {
    try {
      const limit = req.query.limit ? parseInt(req.query.limit as string) : undefined;
      const offset = req.query.offset ? parseInt(req.query.offset as string) : undefined;
      const status = req.query.status as string | undefined;
      const { orders, total } = await storage.getRetailOrders({ limit, offset, status });
      
      // Get all order items with product details
      const orderIds = orders.map(o => o.id);
      
      // Get v2 items (current cart system)
      const v2Items = orderIds.length > 0 ? await db
        .select({
          id: retailOrderItemsV2.id,
          orderId: retailOrderItemsV2.orderId,
          retailProductId: retailOrderItemsV2.retailProductId,
          selectedFlavorId: retailOrderItemsV2.selectedFlavorId,
          quantity: retailOrderItemsV2.quantity,
          unitPrice: retailOrderItemsV2.unitPrice,
          retailProduct: retailProducts,
          flavor: flavors,
        })
        .from(retailOrderItemsV2)
        .innerJoin(retailProducts, eq(retailProducts.id, retailOrderItemsV2.retailProductId))
        .leftJoin(flavors, eq(flavors.id, sql`COALESCE(${retailOrderItemsV2.selectedFlavorId}, ${retailProducts.flavorId})`))
        .where(sql`${retailOrderItemsV2.orderId} = ANY(ARRAY[${sql.join(orderIds.map(id => sql`${id}::text`), sql`, `)}])`) : [];
      
      // Group items by orderId
      const itemsByOrderId: Record<string, Array<{
        id: string;
        quantity: number;
        unitPrice: string;
        productName: string;
        flavorName: string | null;
        unitDescription: string;
      }>> = {};
      
      for (const item of v2Items) {
        if (!itemsByOrderId[item.orderId]) {
          itemsByOrderId[item.orderId] = [];
        }
        itemsByOrderId[item.orderId].push({
          id: item.id,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          productName: item.flavor?.name || 'Unknown Product',
          flavorName: item.flavor?.name || null,
          unitDescription: item.retailProduct?.unitDescription || '',
        });
      }
      
      // Attach items to orders
      const ordersWithItems = orders.map(order => ({
        ...order,
        items: itemsByOrderId[order.id] || [],
      }));

      res.json({ orders: ordersWithItems, total });
    } catch (error: any) {
      console.error("Error fetching retail orders:", error);
      res.status(500).json({ message: "Failed to fetch retail orders" });
    }
  });

  app.patch("/api/retail/orders/:id/status", isAuthenticated, isStaffOrAdmin, async (req, res) => {
    try {
      const statusSchema = z.object({
        status: z.enum(['pending', 'ready_for_pickup', 'fulfilled', 'cancelled']),
      });
      
      const parsed = statusSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid status value" });
      }
      
      const userId = parsed.data.status === 'fulfilled' ? req.user?.id : undefined;
      const order = await storage.updateRetailOrderStatus(req.params.id, parsed.data.status, userId);
      if (!order) {
        return res.status(404).json({ message: "Order not found" });
      }
      
      // Send ready for pickup email
      if (parsed.data.status === 'ready_for_pickup') {
        try {
          const { sendReadyForPickupEmail } = await import('./email');
          const orderItems = [];
          
          // Get legacy order items
          const legacyItems = await db
            .select({
              id: retailOrderItems.id,
              orderId: retailOrderItems.orderId,
              productId: retailOrderItems.productId,
              quantity: retailOrderItems.quantity,
              unitPrice: retailOrderItems.unitPrice,
              product: products,
            })
            .from(retailOrderItems)
            .innerJoin(products, eq(products.id, retailOrderItems.productId))
            .where(eq(retailOrderItems.orderId, req.params.id));
            
          for (const item of legacyItems) {
            if (item.product) {
              orderItems.push({
                productName: item.product.name,
                quantity: item.quantity,
              });
            }
          }
          
          // Get retail v2 items
          const v2Items = await db
            .select({
              id: retailOrderItemsV2.id,
              orderId: retailOrderItemsV2.orderId,
              retailProductId: retailOrderItemsV2.retailProductId,
              quantity: retailOrderItemsV2.quantity,
              unitPrice: retailOrderItemsV2.unitPrice,
              retailProduct: retailProducts,
              flavor: flavors,
            })
            .from(retailOrderItemsV2)
            .innerJoin(retailProducts, eq(retailProducts.id, retailOrderItemsV2.retailProductId))
            // Left join on the CHOSEN flavor (falling back to the product's fixed one):
            // an inner join on the fixed flavor silently dropped multi-flavor products,
            // so a mixed-case order could send an empty ready email — or none at all.
            .leftJoin(flavors, eq(flavors.id, sql`COALESCE(${retailOrderItemsV2.selectedFlavorId}, ${retailProducts.flavorId})`))
            .where(eq(retailOrderItemsV2.orderId, req.params.id));

          for (const item of v2Items) {
            if (item.retailProduct) {
              const productName = item.flavor
                ? `${item.flavor.name} - ${item.retailProduct.unitDescription}`
                : item.retailProduct.unitDescription;
              orderItems.push({
                productName,
                quantity: item.quantity,
              });
            }
          }

          if (orderItems.length > 0) {
            await sendReadyForPickupEmail({
              customerEmail: order.customerEmail,
              customerName: order.customerName,
              orderNumber: order.orderNumber,
              orderItems,
            });
            console.log(`[EMAIL] Sent ready for pickup notification for order ${order.orderNumber}`);
          }
        } catch (emailError: any) {
          console.error('[EMAIL] Failed to send ready for pickup notification:', emailError);
          // Don't fail the status update if email fails
        }
      }
      
      res.json(order);
    } catch (error: any) {
      console.error("Error updating retail order status:", error);
      res.status(500).json({ message: "Failed to update retail order status" });
    }
  });

  app.post("/api/retail/orders/:id/cancel-with-refund", isAuthenticated, isStaffOrAdmin, async (req, res) => {
    try {
      if (!stripe) {
        return res.status(500).json({ message: "Stripe is not configured" });
      }

      const order = await storage.getRetailOrder(req.params.id);
      if (!order) {
        return res.status(404).json({ message: "Order not found" });
      }

      if (order.status === 'cancelled') {
        return res.status(400).json({ message: "Order is already cancelled" });
      }

      if (order.status === 'fulfilled') {
        return res.status(400).json({ message: "Cannot cancel a fulfilled order" });
      }

      if (!order.stripePaymentIntentId) {
        return res.status(400).json({ message: "No payment found for this order" });
      }

      // Cancel order and restore inventory in a transaction FIRST
      // This ensures database consistency even if Stripe refund fails
      let orderCancelled = false;
      try {
        await storage.cancelRetailOrderWithInventoryRestore(
          req.params.id,
          req.user!.id,
          `Order ${order.orderNumber} cancelled - pending refund`
        );
        orderCancelled = true;
        console.log('[CANCEL ORDER] Order cancelled and inventory restored for order:', order.orderNumber);
      } catch (dbError: any) {
        // Database transaction failed - order is NOT cancelled
        console.error('[CANCEL ORDER] Database transaction failed:', dbError);
        return res.status(500).json({ 
          message: "Failed to cancel order in database",
          details: dbError.message 
        });
      }

      // Process refund via Stripe AFTER database transaction succeeds
      // If this fails, the order is cancelled but we can retry the refund manually
      try {
        const refund = await stripe.refunds.create({
          payment_intent: order.stripePaymentIntentId,
        });

        console.log('[CANCEL ORDER] Refund created:', refund.id, 'for order:', order.orderNumber);

        res.json({ 
          success: true, 
          refundId: refund.id,
          message: "Order cancelled and refund processed successfully" 
        });
      } catch (refundError: any) {
        // Order is already cancelled, but refund failed
        // Log the error and return appropriate message to staff
        console.error('[CANCEL ORDER] Stripe refund failed for cancelled order:', order.orderNumber, refundError);
        
        return res.status(500).json({ 
          message: "Order was cancelled and inventory restored, but Stripe refund failed. Please manually issue refund in Stripe Dashboard.",
          orderNumber: order.orderNumber,
          orderId: order.id,
          paymentIntentId: order.stripePaymentIntentId,
          stripeError: refundError.message,
          action: "Issue refund manually or retry this endpoint"
        });
      }
    } catch (error: any) {
      // Unexpected error
      console.error("Unexpected error in cancel-with-refund:", error);
      res.status(500).json({ message: error.message || "Unexpected error occurred" });
    }
  });

  // Refund deposit for retail order
  app.post("/api/retail/orders/:id/refund-deposit", isAuthenticated, isStaffOrAdmin, async (req, res) => {
    try {
      if (!stripe) {
        return res.status(500).json({ message: "Stripe is not configured" });
      }

      const order = await storage.getRetailOrder(req.params.id);
      if (!order) {
        return res.status(404).json({ message: "Order not found" });
      }

      if (!order.stripePaymentIntentId) {
        return res.status(400).json({ message: "No payment found for this order" });
      }

      const depositAmount = parseFloat(order.depositAmount?.toString() || '0');
      if (depositAmount <= 0) {
        return res.status(400).json({ message: "No deposit to refund for this order" });
      }

      if (order.depositRefundedAt) {
        return res.status(400).json({ message: "Deposit has already been refunded" });
      }

      // Process deposit refund via Stripe
      try {
        const depositAmountCents = Math.round(depositAmount * 100);
        const refund = await stripe.refunds.create({
          payment_intent: order.stripePaymentIntentId,
          amount: depositAmountCents, // Partial refund for deposit only
        });

        console.log('[REFUND DEPOSIT] Deposit refund created:', refund.id, 'for order:', order.orderNumber, 'amount:', depositAmount);

        // Update order to mark deposit as refunded
        await db
          .update(retailOrders)
          .set({
            depositRefundedAt: new Date(),
            depositRefundedByUserId: req.user!.id,
            updatedAt: new Date(),
          })
          .where(and(eq(retailOrders.id, req.params.id), isNull(retailOrders.deletedAt)));

        res.json({ 
          success: true, 
          refundId: refund.id,
          amount: depositAmount,
          message: `Deposit of $${depositAmount.toFixed(2)} refunded successfully` 
        });
      } catch (refundError: any) {
        console.error('[REFUND DEPOSIT] Stripe refund failed for order:', order.orderNumber, refundError);
        
        return res.status(500).json({ 
          message: "Stripe refund failed. Please manually issue refund in Stripe Dashboard.",
          orderNumber: order.orderNumber,
          orderId: order.id,
          depositAmount: depositAmount,
          paymentIntentId: order.stripePaymentIntentId,
          stripeError: refundError.message,
        });
      }
    } catch (error: any) {
      console.error("Unexpected error in refund-deposit:", error);
      res.status(500).json({ message: error.message || "Unexpected error occurred" });
    }
  });

  // ====== Staff Retail Subscription Management Routes ======
  
  // List all retail subscriptions (staff/admin)
  app.get("/api/retail/subscriptions", isAuthenticated, isStaffOrAdmin, async (req, res) => {
    try {
      const statusFilter = req.query.status as string | undefined;
      const searchQuery = req.query.search as string | undefined;
      
      let query = db
        .select()
        .from(retailSubscriptions)
        .orderBy(desc(retailSubscriptions.startDate));
      
      let subscriptionsList = await query;
      
      // Apply status filter if provided
      if (statusFilter && statusFilter !== 'all') {
        subscriptionsList = subscriptionsList.filter(s => s.status === statusFilter);
      }
      
      // Apply search filter
      if (searchQuery) {
        const search = searchQuery.toLowerCase();
        subscriptionsList = subscriptionsList.filter(s => 
          s.customerName.toLowerCase().includes(search) ||
          s.customerEmail.toLowerCase().includes(search) ||
          s.customerPhone.includes(search)
        );
      }
      
      // Fetch items for each subscription
      const subscriptionsWithItems = await Promise.all(
        subscriptionsList.map(async (sub) => {
          const items = await db
            .select()
            .from(retailSubscriptionItems)
            .where(eq(retailSubscriptionItems.subscriptionId, sub.id));
          
          // Enrich items with product and flavor data
          const enrichedItems = await Promise.all(
            items.map(async (item) => {
              const [product] = await db
                .select()
                .from(retailProducts)
                .where(eq(retailProducts.id, item.retailProductId));
              
              let flavor = null;
              if (item.selectedFlavorId) {
                const [f] = await db.select().from(flavors).where(eq(flavors.id, item.selectedFlavorId));
                flavor = f;
              } else if (product?.flavorId) {
                const [f] = await db.select().from(flavors).where(eq(flavors.id, product.flavorId));
                flavor = f;
              }
              
              return { ...item, retailProduct: product, flavor };
            })
          );
          
          return { ...sub, items: enrichedItems };
        })
      );
      
      res.json(subscriptionsWithItems);
    } catch (error: any) {
      console.error("Error fetching retail subscriptions:", error);
      res.status(500).json({ message: "Failed to fetch retail subscriptions" });
    }
  });

  // Get single retail subscription with items (staff/admin)
  app.get("/api/retail/subscriptions/:id", isAuthenticated, isStaffOrAdmin, async (req, res) => {
    try {
      const [subscription] = await db
        .select()
        .from(retailSubscriptions)
        .where(eq(retailSubscriptions.id, req.params.id));
      
      if (!subscription) {
        return res.status(404).json({ message: "Subscription not found" });
      }
      
      const items = await db
        .select()
        .from(retailSubscriptionItems)
        .where(eq(retailSubscriptionItems.subscriptionId, subscription.id));
      
      const enrichedItems = await Promise.all(
        items.map(async (item) => {
          const [product] = await db
            .select()
            .from(retailProducts)
            .where(eq(retailProducts.id, item.retailProductId));
          
          let flavor = null;
          if (item.selectedFlavorId) {
            const [f] = await db.select().from(flavors).where(eq(flavors.id, item.selectedFlavorId));
            flavor = f;
          } else if (product?.flavorId) {
            const [f] = await db.select().from(flavors).where(eq(flavors.id, product.flavorId));
            flavor = f;
          }
          
          return { ...item, retailProduct: product, flavor };
        })
      );
      
      res.json({ ...subscription, items: enrichedItems });
    } catch (error: any) {
      console.error("Error fetching subscription:", error);
      res.status(500).json({ message: "Failed to fetch subscription" });
    }
  });

  // Create new retail subscription (staff/admin)
  app.post("/api/retail/subscriptions", isAuthenticated, isStaffOrAdmin, async (req, res) => {
    try {
      const createSchema = z.object({
        customerName: z.string().min(1),
        customerEmail: z.string().email(),
        customerPhone: z.string().min(1),
        subscriptionFrequency: z.enum(['weekly', 'bi-weekly', 'every-4-weeks', 'every-6-weeks', 'every-8-weeks']),
        status: z.enum(['active', 'paused', 'cancelled']).default('active'),
        nextDeliveryDate: z.string().optional(),
        items: z.array(z.object({
          retailProductId: z.string(),
          selectedFlavorId: z.string().optional().nullable(),
          quantity: z.number().int().min(1).max(10),
        })).min(1),
      });
      
      const validated = createSchema.parse(req.body);
      
      // Create subscription
      const [newSubscription] = await db
        .insert(retailSubscriptions)
        .values({
          customerName: validated.customerName,
          customerEmail: validated.customerEmail,
          customerPhone: formatPhoneNumber(validated.customerPhone),
          subscriptionFrequency: validated.subscriptionFrequency,
          status: validated.status,
          billingType: 'local_managed',
          billingStatus: 'active',
          nextDeliveryDate: validated.nextDeliveryDate ? new Date(validated.nextDeliveryDate) : null,
        })
        .returning();
      
      // Create subscription items
      for (const item of validated.items) {
        await db.insert(retailSubscriptionItems).values({
          subscriptionId: newSubscription.id,
          retailProductId: item.retailProductId,
          selectedFlavorId: item.selectedFlavorId || null,
          quantity: item.quantity,
        });
      }
      
      // Fetch the full subscription with items
      const items = await db
        .select()
        .from(retailSubscriptionItems)
        .where(eq(retailSubscriptionItems.subscriptionId, newSubscription.id));
      
      res.status(201).json({ ...newSubscription, items });
    } catch (error: any) {
      console.error("Error creating subscription:", error);
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Validation error", errors: error.errors });
      }
      res.status(500).json({ message: "Failed to create subscription" });
    }
  });

  // Update retail subscription (staff/admin)
  app.patch("/api/retail/subscriptions/:id", isAuthenticated, isStaffOrAdmin, async (req, res) => {
    try {
      const updateSchema = z.object({
        customerName: z.string().min(1).optional(),
        customerEmail: z.string().email().optional(),
        customerPhone: z.string().min(1).optional(),
        subscriptionFrequency: z.enum(['weekly', 'bi-weekly', 'every-4-weeks', 'every-6-weeks', 'every-8-weeks']).optional(),
        status: z.enum(['active', 'paused', 'cancelled']).optional(),
        billingStatus: z.enum(['active', 'awaiting_auth', 'awaiting_confirmation', 'retrying']).optional(),
        nextDeliveryDate: z.string().nullable().optional(),
        nextChargeAt: z.string().nullable().optional(),
        retryCount: z.number().int().min(0).optional(),
      });
      
      const validated = updateSchema.parse(req.body);
      
      // Check subscription exists
      const [existing] = await db
        .select()
        .from(retailSubscriptions)
        .where(eq(retailSubscriptions.id, req.params.id));
      
      if (!existing) {
        return res.status(404).json({ message: "Subscription not found" });
      }
      
      // Build update object
      const updates: any = {};
      if (validated.customerName !== undefined) updates.customerName = validated.customerName;
      if (validated.customerEmail !== undefined) updates.customerEmail = validated.customerEmail;
      if (validated.customerPhone !== undefined) updates.customerPhone = validated.customerPhone;
      if (validated.subscriptionFrequency !== undefined) updates.subscriptionFrequency = validated.subscriptionFrequency;
      if (validated.status !== undefined) {
        updates.status = validated.status;
        if (validated.status === 'cancelled') {
          updates.cancelledAt = new Date();
        }
      }
      if (validated.billingStatus !== undefined) updates.billingStatus = validated.billingStatus;
      if (validated.nextDeliveryDate !== undefined) {
        updates.nextDeliveryDate = validated.nextDeliveryDate ? new Date(validated.nextDeliveryDate) : null;
      }
      if (validated.nextChargeAt !== undefined) {
        updates.nextChargeAt = validated.nextChargeAt ? new Date(validated.nextChargeAt) : null;
      }
      if (validated.retryCount !== undefined) updates.retryCount = validated.retryCount;
      
      const [updated] = await db
        .update(retailSubscriptions)
        .set(updates)
        .where(eq(retailSubscriptions.id, req.params.id))
        .returning();
      
      res.json(updated);
    } catch (error: any) {
      console.error("Error updating subscription:", error);
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Validation error", errors: error.errors });
      }
      res.status(500).json({ message: "Failed to update subscription" });
    }
  });

  // Delete/Cancel retail subscription (staff/admin)
  app.delete("/api/retail/subscriptions/:id", isAuthenticated, isStaffOrAdmin, async (req, res) => {
    try {
      const [subscription] = await db
        .select()
        .from(retailSubscriptions)
        .where(eq(retailSubscriptions.id, req.params.id));
      
      if (!subscription) {
        return res.status(404).json({ message: "Subscription not found" });
      }
      
      // If subscription has Stripe subscription, cancel it
      if (subscription.stripeSubscriptionId && stripe) {
        try {
          await stripe.subscriptions.cancel(subscription.stripeSubscriptionId);
          console.log(`[STAFF] Cancelled Stripe subscription ${subscription.stripeSubscriptionId}`);
        } catch (stripeError: any) {
          console.error('[STAFF] Failed to cancel Stripe subscription:', stripeError);
          // Continue with local deletion even if Stripe fails
        }
      }
      
      // Delete subscription items first (cascade should handle this, but be explicit)
      await db
        .delete(retailSubscriptionItems)
        .where(eq(retailSubscriptionItems.subscriptionId, req.params.id));
      
      // Delete subscription
      await db
        .delete(retailSubscriptions)
        .where(eq(retailSubscriptions.id, req.params.id));
      
      res.json({ success: true, message: "Subscription deleted successfully" });
    } catch (error: any) {
      console.error("Error deleting subscription:", error);
      res.status(500).json({ message: "Failed to delete subscription" });
    }
  });

  // Add item to subscription (staff/admin)
  app.post("/api/retail/subscriptions/:id/items", isAuthenticated, isStaffOrAdmin, async (req, res) => {
    try {
      const itemSchema = z.object({
        retailProductId: z.string(),
        selectedFlavorId: z.string().optional().nullable(),
        quantity: z.number().int().min(1).max(10),
      });
      
      const validated = itemSchema.parse(req.body);
      
      // Verify subscription exists
      const [subscription] = await db
        .select()
        .from(retailSubscriptions)
        .where(eq(retailSubscriptions.id, req.params.id));
      
      if (!subscription) {
        return res.status(404).json({ message: "Subscription not found" });
      }
      
      const [newItem] = await db
        .insert(retailSubscriptionItems)
        .values({
          subscriptionId: req.params.id,
          retailProductId: validated.retailProductId,
          selectedFlavorId: validated.selectedFlavorId || null,
          quantity: validated.quantity,
        })
        .returning();
      
      res.status(201).json(newItem);
    } catch (error: any) {
      console.error("Error adding subscription item:", error);
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Validation error", errors: error.errors });
      }
      res.status(500).json({ message: "Failed to add subscription item" });
    }
  });

  // Update subscription item (staff/admin)
  app.patch("/api/retail/subscriptions/:subscriptionId/items/:itemId", isAuthenticated, isStaffOrAdmin, async (req, res) => {
    try {
      const updateSchema = z.object({
        retailProductId: z.string().optional(),
        selectedFlavorId: z.string().nullable().optional(),
        quantity: z.number().int().min(1).max(10).optional(),
        notes: z.string().max(500).nullable().optional(),
      });
      
      const validated = updateSchema.parse(req.body);
      
      // Check item exists
      const [existing] = await db
        .select()
        .from(retailSubscriptionItems)
        .where(and(
          eq(retailSubscriptionItems.id, req.params.itemId),
          eq(retailSubscriptionItems.subscriptionId, req.params.subscriptionId)
        ));
      
      if (!existing) {
        return res.status(404).json({ message: "Subscription item not found" });
      }
      
      const updates: any = {};
      if (validated.retailProductId !== undefined) updates.retailProductId = validated.retailProductId;
      if (validated.selectedFlavorId !== undefined) updates.selectedFlavorId = validated.selectedFlavorId;
      if (validated.quantity !== undefined) updates.quantity = validated.quantity;
      if (validated.notes !== undefined) updates.notes = validated.notes?.trim() || null;

      const [updated] = await db
        .update(retailSubscriptionItems)
        .set(updates)
        .where(eq(retailSubscriptionItems.id, req.params.itemId))
        .returning();
      
      res.json(updated);
    } catch (error: any) {
      console.error("Error updating subscription item:", error);
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Validation error", errors: error.errors });
      }
      res.status(500).json({ message: "Failed to update subscription item" });
    }
  });

  // Delete subscription item (staff/admin)
  app.delete("/api/retail/subscriptions/:subscriptionId/items/:itemId", isAuthenticated, isStaffOrAdmin, async (req, res) => {
    try {
      // Check item exists
      const [existing] = await db
        .select()
        .from(retailSubscriptionItems)
        .where(and(
          eq(retailSubscriptionItems.id, req.params.itemId),
          eq(retailSubscriptionItems.subscriptionId, req.params.subscriptionId)
        ));
      
      if (!existing) {
        return res.status(404).json({ message: "Subscription item not found" });
      }
      
      // Check if this is the last item
      const items = await db
        .select()
        .from(retailSubscriptionItems)
        .where(eq(retailSubscriptionItems.subscriptionId, req.params.subscriptionId));
      
      if (items.length <= 1) {
        return res.status(400).json({ message: "Cannot delete the last item. Delete the subscription instead." });
      }
      
      await db
        .delete(retailSubscriptionItems)
        .where(eq(retailSubscriptionItems.id, req.params.itemId));
      
      res.json({ success: true, message: "Item deleted successfully" });
    } catch (error: any) {
      console.error("Error deleting subscription item:", error);
      res.status(500).json({ message: "Failed to delete subscription item" });
    }
  });

  // Staff portal routes
  // Update wholesale order status
  app.patch("/api/staff/orders/:id/status", isAuthenticated, isStaffOrAdmin, async (req, res) => {
    try {
      const statusSchema = z.object({
        status: z.enum(['pending', 'processing', 'packaged', 'shipped', 'delivered', 'fulfilled']),
      });
      
      const parsed = statusSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid status value" });
      }
      
      // If setting to fulfilled, call special fulfillment method
      if (parsed.data.status === 'fulfilled' && req.user?.id) {
        const order = await storage.updateWholesaleOrderFulfillment(req.params.id, req.user.id);
        if (!order) {
          return res.status(404).json({ message: "Order not found" });
        }
        return res.json(order);
      }
      
      const order = await storage.updateWholesaleOrderStatus(req.params.id, parsed.data.status);
      if (!order) {
        return res.status(404).json({ message: "Order not found" });
      }
      const stock = await storage.applyWholesaleOrderStock(
        req.params.id,
        ['delivered'].includes(parsed.data.status) ? 'apply' : 'restore',
        req.user?.id
      );

      res.json({ ...order, stockWarnings: stock.warnings });
    } catch (error: any) {
      console.error("Error updating order status:", error);
      res.status(500).json({ message: "Failed to update order status" });
    }
  });

  // Update product details (admin can update all fields, staff can only update stock)
  app.patch("/api/staff/products/:id", isAuthenticated, isStaffOrAdmin, async (req, res) => {
    try {
      if (!req.user) {
        return res.status(401).json({ message: "Unauthorized" });
      }

      const isStaff = req.user.role === 'staff';
      
      if (isStaff) {
        const staffUpdateSchema = z.object({
          stockQuantity: z.number().int().nonnegative().optional(),
          lowStockThreshold: z.number().int().nonnegative().optional(),
        });
        
        const parsed = staffUpdateSchema.safeParse(req.body);
        if (!parsed.success) {
          return res.status(400).json({ 
            message: "Invalid product data", 
            errors: parsed.error.errors 
          });
        }
        
        const updates: any = {};
        if (parsed.data.stockQuantity !== undefined) {
          updates.stockQuantity = parsed.data.stockQuantity;
          updates.inStock = parsed.data.stockQuantity > 0;
        }
        if (parsed.data.lowStockThreshold !== undefined) {
          updates.lowStockThreshold = parsed.data.lowStockThreshold;
        }
        
        const product = await storage.updateProduct(req.params.id, updates);
        if (!product) {
          return res.status(404).json({ message: "Product not found" });
        }
        
        res.json(product);
      } else {
        const adminUpdateSchema = z.object({
          name: z.string().optional(),
          description: z.string().optional(),
          flavor: z.string().optional(),
          abv: z.string().optional(),
          ingredients: z.array(z.string()).optional(),
          retailPrice: z.number().positive().optional(),
          wholesalePrice: z.number().positive().optional(),
          stockQuantity: z.number().int().nonnegative().optional(),
          lowStockThreshold: z.number().int().nonnegative().optional(),
        });
        
        const parsed = adminUpdateSchema.safeParse(req.body);
        if (!parsed.success) {
          return res.status(400).json({ 
            message: "Invalid product data", 
            errors: parsed.error.errors 
          });
        }
        
        const updates: any = {};
        if (parsed.data.name !== undefined) updates.name = parsed.data.name;
        if (parsed.data.description !== undefined) updates.description = parsed.data.description;
        if (parsed.data.flavor !== undefined) updates.flavor = parsed.data.flavor;
        if (parsed.data.abv !== undefined) updates.abv = parsed.data.abv;
        if (parsed.data.ingredients !== undefined) updates.ingredients = parsed.data.ingredients;
        if (parsed.data.retailPrice !== undefined) updates.retailPrice = String(parsed.data.retailPrice);
        if (parsed.data.wholesalePrice !== undefined) updates.wholesalePrice = String(parsed.data.wholesalePrice);
        if (parsed.data.stockQuantity !== undefined) {
          updates.stockQuantity = parsed.data.stockQuantity;
          updates.inStock = parsed.data.stockQuantity > 0;
        }
        if (parsed.data.lowStockThreshold !== undefined) {
          updates.lowStockThreshold = parsed.data.lowStockThreshold;
        }
        
        const product = await storage.updateProduct(req.params.id, updates);
        if (!product) {
          return res.status(404).json({ message: "Product not found" });
        }
        
        res.json(product);
      }
    } catch (error: any) {
      console.error("Error updating product:", error);
      res.status(500).json({ message: "Failed to update product" });
    }
  });

  // Get all users (super admin only)
  app.get("/api/staff/users", isAuthenticated, isSuperAdmin, async (req, res) => {
    try {
      const users = await storage.getAllUsers();
      res.json(users);
    } catch (error: any) {
      console.error("Error fetching users:", error);
      res.status(500).json({ message: "Failed to fetch users" });
    }
  });

  // Create a staff/admin account directly — no retail-customer detour. The invite
  // email carries a 7-day set-password link and is gated by the same prod-only flag
  // as the retail welcome, so dev and test never email real addresses.
  app.post("/api/staff/users", isAuthenticated, isSuperAdmin, async (req, res) => {
    try {
      const schema = z.object({
        firstName: z.string().trim().min(1),
        lastName: z.string().trim().optional().default(''),
        email: z.string().trim().email(),
        role: z.enum(['staff', 'admin']),
      });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ message: "Invalid staff data", errors: parsed.error.errors });
      const { firstName, lastName, email, role } = parsed.data;
      const existing = await storage.getUserByEmail(email);
      if (existing) return res.status(409).json({ message: `${email} already has an account — change their role in the list instead` });
      const username = email.split('@')[0].replace(/[^a-zA-Z0-9]/g, '_') + '-' + crypto.randomUUID().slice(0, 6);
      // InsertUser deliberately has no role field (self-registration can't escalate),
      // so create first and promote through the same path the role dropdown uses.
      const created = await storage.createUser({ username, email, firstName, lastName: lastName || undefined });
      const user = (await storage.updateUserRole(created.id, role)) ?? created;
      const token = crypto.randomBytes(32).toString('hex');
      await storage.createPasswordResetToken(user.id, token, new Date(Date.now() + 7 * 24 * 60 * 60 * 1000));
      await sendStaffInviteEmail({ to: email, name: firstName, setPasswordUrl: `${getBaseUrl()}/reset-password?token=${token}`, role });
      const invite = retailWelcomeEmailsEnabled() ? 'sent' : 'suppressed';
      console.log(`[STAFF] ${role} account created for ${email} (invite: ${invite})`);
      res.status(201).json({ user, invite });
    } catch (e: any) {
      res.status(500).json({ message: "Error adding staff member: " + e.message });
    }
  });

  // Update user role (super admin only)
  app.patch("/api/staff/users/:id/role", isAuthenticated, isSuperAdmin, async (req, res) => {
    try {
      const roleSchema = z.object({
        // wholesale_customer included so a mis-click promoting a wholesale account is
        // REVERSIBLE — without it, the demote back was rejected and the fix needed SQL.
        role: z.enum(['user', 'wholesale_customer', 'staff', 'admin', 'super_admin']),
      });
      
      const parsed = roleSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid role value" });
      }
      
      // Prevent super admins from demoting themselves
      if (!req.user) {
        return res.status(401).json({ message: "Unauthorized" });
      }
      
      const currentUserId = req.user.id;
      if (req.params.id === currentUserId) {
        return res.status(403).json({ message: "You cannot change your own role" });
      }
      
      const user = await storage.updateUserRole(req.params.id, parsed.data.role);
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }
      
      res.json(user);
    } catch (error: any) {
      console.error("Error updating user role:", error);
      res.status(500).json({ message: "Failed to update user role" });
    }
  });

  app.post("/api/impersonate/start", isAuthenticated, isSuperAdmin, async (req: any, res) => {
    try {
      const { targetUserId } = req.body;
      const originalUser = req.originalUser || req.user;
      
      if (!originalUser) {
        return res.status(401).json({ message: "Unauthorized" });
      }
      
      if (!targetUserId) {
        return res.status(400).json({ message: "Target user ID is required" });
      }
      
      if (targetUserId === originalUser.id) {
        return res.status(400).json({ message: "Cannot impersonate yourself" });
      }
      
      const targetUser = await storage.getUser(targetUserId);
      if (!targetUser) {
        return res.status(404).json({ message: "User not found" });
      }
      
      const ipAddress = req.ip || req.headers['x-forwarded-for'] || req.connection.remoteAddress;
      const userAgent = req.headers['user-agent'];
      
      const log = await storage.startImpersonation(
        originalUser.id,
        targetUserId,
        typeof ipAddress === 'string' ? ipAddress : ipAddress?.[0],
        userAgent
      );
      
      req.session!.impersonation = {
        originalUserId: originalUser.id,
        impersonatedUserId: targetUserId,
        logId: log.id,
      };
      
      await new Promise<void>((resolve, reject) => {
        req.session!.save((err: any) => {
          if (err) reject(err);
          else resolve();
        });
      });
      
      res.json({ success: true, impersonatedUser: targetUser });
    } catch (error: any) {
      console.error("Error starting impersonation:", error);
      res.status(500).json({ message: "Failed to start impersonation" });
    }
  });

  app.post("/api/impersonate/stop", isAuthenticated, async (req: any, res) => {
    try {
      if (!req.session?.impersonation) {
        return res.status(400).json({ message: "Not currently impersonating" });
      }
      
      await storage.endImpersonation(req.session.impersonation.logId);
      delete req.session.impersonation;
      
      await new Promise<void>((resolve, reject) => {
        req.session!.save((err: any) => {
          if (err) reject(err);
          else resolve();
        });
      });
      
      res.json({ success: true });
    } catch (error: any) {
      console.error("Error stopping impersonation:", error);
      res.status(500).json({ message: "Failed to stop impersonation" });
    }
  });

  // ============================================
  // ADMIN TASKS - Recurring Checklist Management
  // ============================================

  // Get all admin tasks
  app.get("/api/admin-tasks", isAuthenticated, isStaffOrAdmin, async (req, res) => {
    try {
      const includeInactive = req.query.includeInactive === 'true';
      const tasks = await storage.getAdminTasks(includeInactive);
      res.json(tasks);
    } catch (error: any) {
      console.error("Error fetching admin tasks:", error);
      res.status(500).json({ message: "Error fetching tasks: " + error.message });
    }
  });

  // Get single admin task
  app.get("/api/admin-tasks/:id", isAuthenticated, isStaffOrAdmin, async (req, res) => {
    try {
      const task = await storage.getAdminTask(req.params.id);
      if (!task) {
        return res.status(404).json({ message: "Task not found" });
      }
      res.json(task);
    } catch (error: any) {
      console.error("Error fetching admin task:", error);
      res.status(500).json({ message: "Error fetching task: " + error.message });
    }
  });

  // Create admin task
  app.post("/api/admin-tasks", isAuthenticated, isAdmin, async (req, res) => {
    try {
      const taskSchema = z.object({
        title: z.string().min(1, "Title is required"),
        description: z.string().optional(),
        category: z.string().optional(),
        recurrence: z.enum(['daily', 'weekly', 'monthly', 'quarterly', 'yearly', 'one-time']),
        dayOfWeek: z.number().min(0).max(6).optional().nullable(),
        dayOfMonth: z.number().min(1).max(31).optional().nullable(),
        monthOfYear: z.number().min(1).max(12).optional().nullable(),
        assignedToUserId: z.string().optional(),
        isActive: z.boolean().optional(),
        displayOrder: z.number().optional(),
      });

      const parsed = taskSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid task data", errors: parsed.error.errors });
      }

      const task = await storage.createAdminTask({
        ...parsed.data,
        createdByUserId: req.user?.id,
      });
      res.status(201).json(task);
    } catch (error: any) {
      console.error("Error creating admin task:", error);
      res.status(500).json({ message: "Error creating task: " + error.message });
    }
  });

  // Update admin task
  app.patch("/api/admin-tasks/:id", isAuthenticated, isAdmin, async (req, res) => {
    try {
      const taskSchema = z.object({
        title: z.string().min(1).optional(),
        description: z.string().optional(),
        category: z.string().optional(),
        recurrence: z.enum(['daily', 'weekly', 'monthly', 'quarterly', 'yearly', 'one-time']).optional(),
        dayOfWeek: z.number().min(0).max(6).optional().nullable(),
        dayOfMonth: z.number().min(1).max(31).optional().nullable(),
        monthOfYear: z.number().min(1).max(12).optional().nullable(),
        assignedToUserId: z.string().optional().nullable(),
        isActive: z.boolean().optional(),
        displayOrder: z.number().optional(),
      });

      const parsed = taskSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid task data", errors: parsed.error.errors });
      }

      const task = await storage.updateAdminTask(req.params.id, parsed.data);
      if (!task) {
        return res.status(404).json({ message: "Task not found" });
      }
      res.json(task);
    } catch (error: any) {
      console.error("Error updating admin task:", error);
      res.status(500).json({ message: "Error updating task: " + error.message });
    }
  });

  // Delete admin task
  app.delete("/api/admin-tasks/:id", isAuthenticated, isAdmin, async (req, res) => {
    try {
      await storage.deleteAdminTask(req.params.id);
      res.json({ success: true });
    } catch (error: any) {
      console.error("Error deleting admin task:", error);
      res.status(500).json({ message: "Error deleting task: " + error.message });
    }
  });

  // Get task completions for a date
  app.get("/api/admin-tasks/completions/by-date", isAuthenticated, isStaffOrAdmin, async (req, res) => {
    try {
      const dateStr = req.query.date as string;
      if (!dateStr) {
        return res.status(400).json({ message: "Date is required" });
      }
      const date = new Date(dateStr);
      const completions = await storage.getAdminTaskCompletionsByDate(date);
      res.json(completions);
    } catch (error: any) {
      console.error("Error fetching task completions:", error);
      res.status(500).json({ message: "Error fetching completions: " + error.message });
    }
  });

  // Get task completions for a week range
  app.get("/api/admin-tasks/completions/by-week", isAuthenticated, isStaffOrAdmin, async (req, res) => {
    try {
      const startStr = req.query.start as string;
      const endStr = req.query.end as string;
      if (!startStr || !endStr) {
        return res.status(400).json({ message: "Start and end dates are required" });
      }
      const startDate = new Date(startStr);
      const endDate = new Date(endStr);
      const completions = await storage.getAdminTaskCompletionsByDateRange(startDate, endDate);
      res.json(completions);
    } catch (error: any) {
      console.error("Error fetching task completions:", error);
      res.status(500).json({ message: "Error fetching completions: " + error.message });
    }
  });

  // Complete a task
  app.post("/api/admin-tasks/:taskId/complete", isAuthenticated, isStaffOrAdmin, async (req, res) => {
    try {
      const completionSchema = z.object({
        instanceDate: z.string().transform(s => new Date(s)),
        notes: z.string().optional(),
      });

      const parsed = completionSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid completion data", errors: parsed.error.errors });
      }

      const completion = await storage.createAdminTaskCompletion({
        taskId: req.params.taskId,
        completedByUserId: req.user?.id,
        instanceDate: parsed.data.instanceDate,
        notes: parsed.data.notes,
      });
      res.status(201).json(completion);
    } catch (error: any) {
      console.error("Error completing task:", error);
      res.status(500).json({ message: "Error completing task: " + error.message });
    }
  });

  // Undo task completion
  app.delete("/api/admin-tasks/completions/:id", isAuthenticated, isStaffOrAdmin, async (req, res) => {
    try {
      await storage.deleteAdminTaskCompletion(req.params.id);
      res.json({ success: true });
    } catch (error: any) {
      console.error("Error undoing task completion:", error);
      res.status(500).json({ message: "Error undoing completion: " + error.message });
    }
  });

  // ============================================
  // CRM - Lead Management Routes
  // ============================================

  // Get all leads with optional filters
  app.get("/api/crm/leads", isAuthenticated, isStaffOrAdmin, async (req, res) => {
    try {
      const { status, priorityLevel, assignedToUserId } = req.query;
      
      const filters: any = {};
      if (status) filters.status = status as string;
      if (priorityLevel) filters.priorityLevel = priorityLevel as string;
      if (assignedToUserId) filters.assignedToUserId = assignedToUserId as string;
      
      const leads = await storage.getLeads(filters);
      res.json(leads);
    } catch (error: any) {
      console.error("Error fetching leads:", error);
      res.status(500).json({ message: "Error fetching leads: " + error.message });
    }
  });

  // Search leads
  app.get("/api/crm/leads/search", isAuthenticated, isStaffOrAdmin, async (req, res) => {
    try {
      const { q } = req.query;
      
      if (!q || typeof q !== 'string') {
        return res.status(400).json({ message: "Search query is required" });
      }
      
      const leads = await storage.searchLeads(q);
      res.json(leads);
    } catch (error: any) {
      console.error("Error searching leads:", error);
      res.status(500).json({ message: "Error searching leads: " + error.message });
    }
  });

  // Get single lead by ID
  app.get("/api/crm/leads/:id", isAuthenticated, isStaffOrAdmin, async (req, res) => {
    try {
      const { id } = req.params;
      
      const lead = await storage.getLead(id);
      if (!lead) {
        return res.status(404).json({ message: "Lead not found" });
      }
      
      res.json(lead);
    } catch (error: any) {
      console.error("Error fetching lead:", error);
      res.status(500).json({ message: "Error fetching lead: " + error.message });
    }
  });

  // Create new lead
  app.post("/api/crm/leads", isAuthenticated, isStaffOrAdmin, async (req: any, res) => {
    try {
      const { businessName, contactName, email, phone, priorityLevel, status, notes, assignedToUserId } = req.body;
      
      if (!businessName || !contactName) {
        return res.status(400).json({ message: "Business name and contact name are required" });
      }
      
      const lead = await storage.createLead({
        businessName,
        contactName,
        email,
        phone,
        priorityLevel: priorityLevel || 'medium',
        status: status || 'new',
        notes,
        assignedToUserId,
      });
      
      res.status(201).json(lead);
    } catch (error: any) {
      console.error("Error creating lead:", error);
      res.status(500).json({ message: "Error creating lead: " + error.message });
    }
  });

  // Update lead
  app.patch("/api/crm/leads/:id", isAuthenticated, isStaffOrAdmin, async (req, res) => {
    try {
      const { id } = req.params;
      const updates = req.body;
      
      const lead = await storage.updateLead(id, updates);
      if (!lead) {
        return res.status(404).json({ message: "Lead not found" });
      }
      
      res.json(lead);
    } catch (error: any) {
      console.error("Error updating lead:", error);
      res.status(500).json({ message: "Error updating lead: " + error.message });
    }
  });

  // Delete lead
  app.delete("/api/crm/leads/:id", isAuthenticated, isStaffOrAdmin, async (req, res) => {
    try {
      const { id } = req.params;
      
      await storage.deleteLead(id);
      res.json({ message: "Lead deleted successfully" });
    } catch (error: any) {
      console.error("Error deleting lead:", error);
      res.status(500).json({ message: "Error deleting lead: " + error.message });
    }
  });

  // ============================================
  // CRM - Touch Point Management Routes
  // ============================================

  // Get touch points for a lead
  app.get("/api/crm/leads/:id/touchpoints", isAuthenticated, isStaffOrAdmin, async (req, res) => {
    try {
      const { id } = req.params;
      
      const touchPoints = await storage.getLeadTouchPoints(id);
      res.json(touchPoints);
    } catch (error: any) {
      console.error("Error fetching touch points:", error);
      res.status(500).json({ message: "Error fetching touch points: " + error.message });
    }
  });

  // Create new touch point
  app.post("/api/crm/leads/:id/touchpoints", isAuthenticated, isStaffOrAdmin, async (req: any, res) => {
    try {
      const { id } = req.params;
      const { type, subject, notes } = req.body;
      
      if (!type || !subject) {
        return res.status(400).json({ message: "Type and subject are required" });
      }
      
      const touchPoint = await storage.createLeadTouchPoint({
        leadId: id,
        type,
        subject,
        notes,
        createdByUserId: req.user.id,
      });
      
      res.status(201).json(touchPoint);
    } catch (error: any) {
      console.error("Error creating touch point:", error);
      res.status(500).json({ message: "Error creating touch point: " + error.message });
    }
  });

  // Get recent touch points across all leads
  app.get("/api/crm/touchpoints/recent", isAuthenticated, isStaffOrAdmin, async (req, res) => {
    try {
      const limit = req.query.limit ? parseInt(req.query.limit as string) : 10;
      
      const touchPoints = await storage.getRecentTouchPoints(limit);
      res.json(touchPoints);
    } catch (error: any) {
      console.error("Error fetching recent touch points:", error);
      res.status(500).json({ message: "Error fetching recent touch points: " + error.message });
    }
  });

  // Admin endpoint to manually trigger billing (for testing)
  app.post("/api/admin/trigger-billing", isAdmin, async (req, res) => {
    try {
      console.log('[ADMIN] Manually triggering billing process...');
      const { runDailyBilling } = await import('./billing-cron');
      await runDailyBilling();
      res.json({ success: true, message: 'Billing process triggered successfully' });
    } catch (error: any) {
      console.error('[ADMIN] Error triggering billing:', error);
      res.status(500).json({ message: 'Error triggering billing: ' + error.message });
    }
  });

  // ==================== ACCOUNTING MODULE ROUTES ====================

  // Check if Plaid is configured
  app.get("/api/accounting/plaid/status", isAuthenticated, isAdmin, async (req, res) => {
    res.json({
      configured: !!plaidClient,
      environment: process.env.PLAID_ENV || 'sandbox',
    });
  });

  // Create Plaid Link token
  app.post("/api/accounting/plaid/link-token", isAuthenticated, isAdmin, async (req, res) => {
    try {
      if (!plaidClient) {
        return res.status(503).json({ message: "Plaid is not configured. Please add PLAID_CLIENT_ID and PLAID_SECRET environment variables." });
      }

      const response = await plaidClient.linkTokenCreate({
        user: { client_user_id: req.user.id },
        client_name: 'Puget Sound Kombucha Accounting',
        products: [Products.Transactions],
        country_codes: [CountryCode.Us],
        language: 'en',
      });

      res.json({ link_token: response.data.link_token });
    } catch (error: any) {
      console.error("Error creating Plaid link token:", error);
      res.status(500).json({ message: "Error creating link token: " + error.message });
    }
  });

  // Exchange public token for access token
  app.post("/api/accounting/plaid/exchange-token", isAuthenticated, isAdmin, async (req, res) => {
    try {
      if (!plaidClient) {
        return res.status(503).json({ message: "Plaid is not configured" });
      }

      const { public_token, institution } = req.body;

      if (!public_token) {
        return res.status(400).json({ message: "Public token is required" });
      }

      const exchangeResponse = await plaidClient.itemPublicTokenExchange({
        public_token,
      });

      const accessToken = exchangeResponse.data.access_token;
      const itemId = exchangeResponse.data.item_id;

      // Get account information
      const accountsResponse = await plaidClient.accountsGet({
        access_token: accessToken,
      });

      // Store the Plaid item
      const plaidItem = await storage.createPlaidItem({
        itemId,
        accessToken,
        institutionId: institution?.institution_id || null,
        institutionName: institution?.name || 'Unknown',
      });

      // Store the accounts
      for (const account of accountsResponse.data.accounts) {
        await storage.createPlaidAccount({
          plaidItemId: plaidItem.id,
          accountId: account.account_id,
          name: account.name,
          officialName: account.official_name || null,
          type: account.type,
          subtype: account.subtype || null,
          mask: account.mask || null,
        });
      }

      res.json({
        success: true,
        plaidItemId: plaidItem.id,
        accounts: accountsResponse.data.accounts.map(a => ({
          id: a.account_id,
          name: a.name,
          type: a.type,
          mask: a.mask,
        })),
      });
    } catch (error: any) {
      console.error("Error exchanging Plaid token:", error);
      res.status(500).json({ message: "Error connecting bank account: " + error.message });
    }
  });

  // Sync transactions from Plaid
  app.post("/api/accounting/plaid/sync/:itemId", isAuthenticated, isAdmin, async (req, res) => {
    try {
      if (!plaidClient) {
        return res.status(503).json({ message: "Plaid is not configured" });
      }

      const { itemId } = req.params;
      const plaidItem = await storage.getPlaidItem(itemId);

      if (!plaidItem) {
        return res.status(404).json({ message: "Plaid item not found" });
      }

      // Use transactions sync for incremental updates
      let cursor = plaidItem.cursor || undefined;
      let added: any[] = [];
      let modified: any[] = [];
      let removed: any[] = [];
      let hasMore = true;

      while (hasMore) {
        const syncResponse = await plaidClient.transactionsSync({
          access_token: plaidItem.accessToken,
          cursor,
        });

        added = added.concat(syncResponse.data.added);
        modified = modified.concat(syncResponse.data.modified);
        removed = removed.concat(syncResponse.data.removed);
        hasMore = syncResponse.data.has_more;
        cursor = syncResponse.data.next_cursor;
      }

      // Get accounts for this item
      const accounts = await storage.getPlaidAccounts(plaidItem.id);
      const accountMap = new Map(accounts.map(a => [a.accountId, a.id]));

      // Process added transactions
      const newTransactions = [];
      for (const tx of added) {
        // Check if transaction already exists
        const existing = await storage.getAccountingTransactionByTransactionId(tx.transaction_id);
        if (!existing) {
          const plaidAccountId = accountMap.get(tx.account_id);
          newTransactions.push({
            plaidAccountId: plaidAccountId || null,
            transactionId: tx.transaction_id,
            date: new Date(tx.date),
            name: tx.name,
            merchantName: tx.merchant_name || null,
            amount: tx.amount.toString(),
            category: tx.category?.[0] || null,
            pending: tx.pending,
          });
        }
      }

      if (newTransactions.length > 0) {
        await storage.createAccountingTransactions(newTransactions);
      }

      // Update the cursor for next sync
      if (cursor) {
        await storage.updatePlaidItemCursor(plaidItem.id, cursor);
      }

      res.json({
        success: true,
        added: newTransactions.length,
        modified: modified.length,
        removed: removed.length,
      });
    } catch (error: any) {
      console.error("Error syncing Plaid transactions:", error);
      res.status(500).json({ message: "Error syncing transactions: " + error.message });
    }
  });

  // Get all connected bank accounts
  app.get("/api/accounting/plaid/items", isAuthenticated, isAdmin, async (req, res) => {
    try {
      const items = await storage.getPlaidItems();
      const itemsWithAccounts = await Promise.all(
        items.map(async (item) => {
          const accounts = await storage.getPlaidAccounts(item.id);
          return {
            ...item,
            accessToken: undefined, // Don't expose access token
            accounts,
          };
        })
      );
      res.json(itemsWithAccounts);
    } catch (error: any) {
      console.error("Error fetching Plaid items:", error);
      res.status(500).json({ message: "Error fetching connected accounts: " + error.message });
    }
  });

  // Delete a connected bank account
  app.delete("/api/accounting/plaid/items/:id", isAuthenticated, isAdmin, async (req, res) => {
    try {
      const { id } = req.params;
      await storage.deletePlaidItem(id);
      res.json({ success: true });
    } catch (error: any) {
      console.error("Error deleting Plaid item:", error);
      res.status(500).json({ message: "Error disconnecting bank account: " + error.message });
    }
  });

  // ==================== ACCOUNTING CATEGORIES ROUTES ====================

  // Get all categories
  app.get("/api/accounting/categories", isAuthenticated, isAdmin, async (req, res) => {
    try {
      const categories = await storage.getAccountingCategories();
      res.json(categories);
    } catch (error: any) {
      console.error("Error fetching categories:", error);
      res.status(500).json({ message: "Error fetching categories: " + error.message });
    }
  });

  // Create category
  app.post("/api/accounting/categories", isAuthenticated, isAdmin, async (req, res) => {
    try {
      const validatedData = insertAccountingCategorySchema.parse(req.body);
      const category = await storage.createAccountingCategory(validatedData);
      res.status(201).json(category);
    } catch (error: any) {
      console.error("Error creating category:", error);
      res.status(500).json({ message: "Error creating category: " + error.message });
    }
  });

  // Update category
  app.patch("/api/accounting/categories/:id", isAuthenticated, isAdmin, async (req, res) => {
    try {
      const { id } = req.params;
      const category = await storage.updateAccountingCategory(id, req.body);
      if (!category) {
        return res.status(404).json({ message: "Category not found" });
      }
      res.json(category);
    } catch (error: any) {
      console.error("Error updating category:", error);
      res.status(500).json({ message: "Error updating category: " + error.message });
    }
  });

  // Delete category
  app.delete("/api/accounting/categories/:id", isAuthenticated, isAdmin, async (req, res) => {
    try {
      const { id } = req.params;
      await storage.deleteAccountingCategory(id);
      res.json({ success: true });
    } catch (error: any) {
      console.error("Error deleting category:", error);
      res.status(500).json({ message: "Error deleting category: " + error.message });
    }
  });

  // Seed default categories
  app.post("/api/accounting/categories/seed", isAuthenticated, isAdmin, async (req, res) => {
    try {
      await storage.seedDefaultCategories();
      const categories = await storage.getAccountingCategories();
      res.json(categories);
    } catch (error: any) {
      console.error("Error seeding categories:", error);
      res.status(500).json({ message: "Error seeding categories: " + error.message });
    }
  });

  // ==================== ACCOUNTING TRANSACTIONS ROUTES ====================

  // Get transactions with filters
  app.get("/api/accounting/transactions", isAuthenticated, isAdmin, async (req, res) => {
    try {
      const filters: any = {};
      
      if (req.query.startDate) {
        filters.startDate = new Date(req.query.startDate as string);
      }
      if (req.query.endDate) {
        filters.endDate = new Date(req.query.endDate as string);
      }
      if (req.query.categoryId) {
        filters.categoryId = req.query.categoryId as string;
      }
      if (req.query.allocated !== undefined) {
        filters.allocated = req.query.allocated === 'true';
      }
      if (req.query.search) {
        filters.search = req.query.search as string;
      }
      if (req.query.plaidAccountId) {
        filters.plaidAccountId = req.query.plaidAccountId as string;
      }
      if (req.query.limit) {
        filters.limit = parseInt(req.query.limit as string);
      }
      if (req.query.offset) {
        filters.offset = parseInt(req.query.offset as string);
      }

      const transactions = await storage.getAccountingTransactions(filters);
      res.json(transactions);
    } catch (error: any) {
      console.error("Error fetching transactions:", error);
      res.status(500).json({ message: "Error fetching transactions: " + error.message });
    }
  });

  // Create manual transaction
  app.post("/api/accounting/transactions", isAuthenticated, isAdmin, async (req, res) => {
    try {
      const validatedData = insertAccountingTransactionSchema.parse(req.body);
      const transaction = await storage.createAccountingTransaction(validatedData);
      res.status(201).json(transaction);
    } catch (error: any) {
      console.error("Error creating transaction:", error);
      res.status(500).json({ message: "Error creating transaction: " + error.message });
    }
  });

  // Import transactions from CSV
  app.post("/api/accounting/transactions/import", isAuthenticated, isAdmin, async (req, res) => {
    try {
      const { transactions } = req.body;
      
      if (!Array.isArray(transactions)) {
        return res.status(400).json({ message: "Transactions must be an array" });
      }

      const validatedTransactions = transactions.map((tx: any) => ({
        date: new Date(tx.date),
        name: tx.name || tx.description,
        merchantName: tx.merchantName || null,
        amount: tx.amount.toString(),
        category: tx.category || null,
        pending: false,
        source: 'csv',
      }));

      const created = await storage.createAccountingTransactions(validatedTransactions);
      res.status(201).json({ imported: created.length, transactions: created });
    } catch (error: any) {
      console.error("Error importing transactions:", error);
      res.status(500).json({ message: "Error importing transactions: " + error.message });
    }
  });

  // ==================== TRANSACTION ALLOCATION ROUTES ====================

  // Allocate a transaction to a category
  app.post("/api/accounting/transactions/:id/allocate", isAuthenticated, isAdmin, async (req, res) => {
    try {
      const { id } = req.params;
      const { categoryId, amount, note } = req.body;

      if (!categoryId) {
        return res.status(400).json({ message: "Category ID is required" });
      }

      const transaction = await storage.getAccountingTransaction(id);
      if (!transaction) {
        return res.status(404).json({ message: "Transaction not found" });
      }

      // Delete existing allocations for this transaction
      await storage.deleteTransactionAllocations(id);

      // Create new allocation
      const allocation = await storage.createTransactionAllocation({
        transactionId: id,
        categoryId,
        amount: amount || transaction.amount,
        notes: note || null,
      });

      res.json(allocation);
    } catch (error: any) {
      console.error("Error allocating transaction:", error);
      res.status(500).json({ message: "Error allocating transaction: " + error.message });
    }
  });

  // Split a transaction across multiple categories
  app.post("/api/accounting/transactions/:id/split", isAuthenticated, isAdmin, async (req, res) => {
    try {
      const { id } = req.params;
      const { allocations } = req.body;

      if (!Array.isArray(allocations) || allocations.length === 0) {
        return res.status(400).json({ message: "Allocations array is required" });
      }

      const transaction = await storage.getAccountingTransaction(id);
      if (!transaction) {
        return res.status(404).json({ message: "Transaction not found" });
      }

      // Validate that the sum of allocations equals the transaction amount
      const transactionAmount = Math.abs(parseFloat(transaction.amount));
      const allocationsSum = allocations.reduce((sum: number, alloc: any) => {
        return sum + Math.abs(parseFloat(alloc.amount));
      }, 0);

      // Allow small floating point differences (up to 1 cent)
      if (Math.abs(transactionAmount - allocationsSum) > 0.01) {
        return res.status(400).json({ 
          message: `Allocation amounts must sum to transaction amount. Transaction: $${transactionAmount.toFixed(2)}, Allocations: $${allocationsSum.toFixed(2)}` 
        });
      }

      // Delete existing allocations
      await storage.deleteTransactionAllocations(id);

      // Create new allocations
      const created = [];
      for (const alloc of allocations) {
        const allocation = await storage.createTransactionAllocation({
          transactionId: id,
          categoryId: alloc.categoryId,
          amount: alloc.amount,
          notes: alloc.note || null,
        });
        created.push(allocation);
      }

      res.json(created);
    } catch (error: any) {
      console.error("Error splitting transaction:", error);
      res.status(500).json({ message: "Error splitting transaction: " + error.message });
    }
  });

  // Bulk allocate transactions
  app.post("/api/accounting/transactions/bulk-allocate", isAuthenticated, isAdmin, async (req, res) => {
    try {
      const { transactionIds, categoryId } = req.body;

      if (!Array.isArray(transactionIds) || transactionIds.length === 0) {
        return res.status(400).json({ message: "Transaction IDs array is required" });
      }

      if (!categoryId) {
        return res.status(400).json({ message: "Category ID is required" });
      }

      await storage.bulkAllocateTransactions(transactionIds, categoryId);
      res.json({ success: true, allocated: transactionIds.length });
    } catch (error: any) {
      console.error("Error bulk allocating transactions:", error);
      res.status(500).json({ message: "Error bulk allocating transactions: " + error.message });
    }
  });

  // Clear transaction allocations
  app.delete("/api/accounting/transactions/:id/allocations", isAuthenticated, isAdmin, async (req, res) => {
    try {
      const { id } = req.params;
      await storage.deleteTransactionAllocations(id);
      res.json({ success: true });
    } catch (error: any) {
      console.error("Error clearing allocations:", error);
      res.status(500).json({ message: "Error clearing allocations: " + error.message });
    }
  });

  // ==================== FINANCIAL SUMMARY ROUTES ====================

  // Get financial summary
  app.get("/api/accounting/summary", isAuthenticated, isAdmin, async (req, res) => {
    try {
      const startDate = req.query.startDate ? new Date(req.query.startDate as string) : undefined;
      const endDate = req.query.endDate ? new Date(req.query.endDate as string) : undefined;

      const summary = await storage.getFinancialSummary(startDate, endDate);
      res.json(summary);
    } catch (error: any) {
      console.error("Error fetching financial summary:", error);
      res.status(500).json({ message: "Error fetching financial summary: " + error.message });
    }
  });

  // Get income statement data
  app.get("/api/accounting/income-statement", isAuthenticated, isAdmin, async (req, res) => {
    try {
      const startDate = req.query.startDate ? new Date(req.query.startDate as string) : undefined;
      const endDate = req.query.endDate ? new Date(req.query.endDate as string) : undefined;

      const summary = await storage.getFinancialSummary(startDate, endDate);
      
      // Format for income statement display
      const incomeStatement = {
        period: {
          start: startDate || 'All Time',
          end: endDate || 'Present',
        },
        revenue: {
          items: summary.incomeByCategory,
          total: summary.totalIncome,
        },
        expenses: {
          items: summary.expensesByCategory,
          total: summary.totalExpenses,
        },
        transfers: {
          items: summary.transfersByCategory,
        },
        netIncome: summary.netIncome,
        unallocated: {
          income: summary.unallocatedIncome,
          expenses: summary.unallocatedExpenses,
        },
      };

      res.json(incomeStatement);
    } catch (error: any) {
      console.error("Error generating income statement:", error);
      res.status(500).json({ message: "Error generating income statement: " + error.message });
    }
  });

  // ==================== DELIVERY ROUTE OPTIMIZATION ROUTES ====================

  // Get facility location
  app.get("/api/delivery/facility", isAuthenticated, isStaffOrAdmin, async (req, res) => {
    try {
      const facility = getFacilityLocation();
      res.json(facility);
    } catch (error: any) {
      console.error("Error fetching facility location:", error);
      res.status(500).json({ message: "Error fetching facility location: " + error.message });
    }
  });

  // Get all custom delivery stops
  app.get("/api/delivery/stops", isAuthenticated, isStaffOrAdmin, async (req, res) => {
    try {
      const stops = await storage.getDeliveryStops();
      res.json(stops);
    } catch (error: any) {
      console.error("Error fetching delivery stops:", error);
      res.status(500).json({ message: "Error fetching delivery stops: " + error.message });
    }
  });

  // Create a custom delivery stop
  app.post("/api/delivery/stops", isAuthenticated, isStaffOrAdmin, async (req, res) => {
    try {
      const parseResult = insertDeliveryStopSchema.safeParse(req.body);
      if (!parseResult.success) {
        return res.status(400).json({ 
          message: "Validation error", 
          errors: parseResult.error.errors 
        });
      }
      const validatedData = parseResult.data;
      
      // Geocode the address
      const geocodeResult = await geocodeAddress(
        validatedData.address,
        validatedData.city,
        validatedData.state || 'WA',
        validatedData.zipCode
      );

      const stopData = {
        ...validatedData,
        latitude: geocodeResult?.latitude?.toString() || null,
        longitude: geocodeResult?.longitude?.toString() || null,
        geocodedAt: geocodeResult ? new Date() : null,
        createdByUserId: req.user!.id,
      };

      const stop = await storage.createDeliveryStop(stopData);
      res.status(201).json(stop);
    } catch (error: any) {
      console.error("Error creating delivery stop:", error);
      res.status(500).json({ message: "Error creating delivery stop: " + error.message });
    }
  });

  // Update a custom delivery stop
  app.patch("/api/delivery/stops/:id", isAuthenticated, isStaffOrAdmin, async (req, res) => {
    try {
      const { id } = req.params;
      const existingStop = await storage.getDeliveryStop(id);
      
      if (!existingStop) {
        return res.status(404).json({ message: "Delivery stop not found" });
      }

      // If address changed, re-geocode
      let updates = { ...req.body };
      if (req.body.address || req.body.city || req.body.state || req.body.zipCode) {
        const geocodeResult = await geocodeAddress(
          req.body.address || existingStop.address,
          req.body.city || existingStop.city,
          req.body.state || existingStop.state,
          req.body.zipCode || existingStop.zipCode
        );
        
        if (geocodeResult) {
          updates.latitude = geocodeResult.latitude.toString();
          updates.longitude = geocodeResult.longitude.toString();
          updates.geocodedAt = new Date();
        }
      }

      const stop = await storage.updateDeliveryStop(id, updates);
      res.json(stop);
    } catch (error: any) {
      console.error("Error updating delivery stop:", error);
      res.status(500).json({ message: "Error updating delivery stop: " + error.message });
    }
  });

  // Delete a custom delivery stop
  app.delete("/api/delivery/stops/:id", isAuthenticated, isStaffOrAdmin, async (req, res) => {
    try {
      const { id } = req.params;
      await storage.deleteDeliveryStop(id);
      res.json({ success: true });
    } catch (error: any) {
      console.error("Error deleting delivery stop:", error);
      res.status(500).json({ message: "Error deleting delivery stop: " + error.message });
    }
  });

  // Geocode a wholesale location
  app.post("/api/delivery/geocode-location/:locationId", isAuthenticated, isStaffOrAdmin, async (req, res) => {
    try {
      const { locationId } = req.params;
      
      // Get all wholesale locations to find this one
      const wholesaleCustomers = await storage.getWholesaleCustomers();
      let foundLocation = null;
      
      for (const customer of wholesaleCustomers) {
        const locations = await storage.getWholesaleLocations(customer.id);
        const location = locations.find((l: any) => l.id === locationId);
        if (location) {
          foundLocation = location;
          break;
        }
      }
      
      if (!foundLocation) {
        return res.status(404).json({ message: "Location not found" });
      }

      const geocodeResult = await geocodeAddress(
        foundLocation.address,
        foundLocation.city,
        foundLocation.state,
        foundLocation.zipCode
      );

      if (!geocodeResult) {
        return res.status(400).json({ message: "Failed to geocode address" });
      }

      await storage.updateWholesaleLocationGeocoding(
        locationId,
        geocodeResult.latitude,
        geocodeResult.longitude
      );

      // Backfill address parts a person left blank with what Mapbox resolved — so the
      // screen shows the full address and a wrong geocode is visible, not silent.
      // Never overwrites anything already entered.
      const backfill: Record<string, string> = {};
      if (!foundLocation.city?.trim() && geocodeResult.city) backfill.city = geocodeResult.city;
      if (!foundLocation.state?.trim() && geocodeResult.state) backfill.state = geocodeResult.state;
      if (!foundLocation.zipCode?.trim() && geocodeResult.zipCode) backfill.zipCode = geocodeResult.zipCode;
      if (Object.keys(backfill).length) await storage.updateWholesaleLocation(locationId, backfill);

      res.json({
        success: true,
        latitude: geocodeResult.latitude,
        longitude: geocodeResult.longitude,
        placeName: geocodeResult.placeName,
        ...backfill,
      });
    } catch (error: any) {
      console.error("Error geocoding location:", error);
      res.status(500).json({ message: "Error geocoding location: " + error.message });
    }
  });

  // Geocode all un-geocoded wholesale locations
  app.post("/api/delivery/geocode-all", isAuthenticated, isStaffOrAdmin, async (req, res) => {
    try {
      const unGeocodedLocations = await storage.getUnGeocodedWholesaleLocations();
      
      let successCount = 0;
      let failCount = 0;
      
      for (const location of unGeocodedLocations) {
        const geocodeResult = await geocodeAddress(
          location.address,
          location.city,
          location.state,
          location.zipCode
        );

        if (geocodeResult) {
          await storage.updateWholesaleLocationGeocoding(
            location.id,
            geocodeResult.latitude,
            geocodeResult.longitude
          );
          // Same backfill as single-location geocode: fill blanks, never overwrite.
          const backfill: Record<string, string> = {};
          if (!location.city?.trim() && geocodeResult.city) backfill.city = geocodeResult.city;
          if (!location.state?.trim() && geocodeResult.state) backfill.state = geocodeResult.state;
          if (!location.zipCode?.trim() && geocodeResult.zipCode) backfill.zipCode = geocodeResult.zipCode;
          if (Object.keys(backfill).length) await storage.updateWholesaleLocation(location.id, backfill);
          successCount++;
        } else {
          failCount++;
        }

        // Add a small delay between requests to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 100));
      }

      res.json({
        success: true,
        geocoded: successCount,
        failed: failCount,
        total: unGeocodedLocations.length,
      });
    } catch (error: any) {
      console.error("Error geocoding all locations:", error);
      res.status(500).json({ message: "Error geocoding locations: " + error.message });
    }
  });

  // Get deliveries for a specific date (for route optimization)
  app.get("/api/delivery/orders/:date", isAuthenticated, isStaffOrAdmin, async (req, res) => {
    try {
      const { date } = req.params;
      const targetDate = new Date(date);
      
      // Get all scheduled wholesale orders for this date
      const { orders } = await storage.getWholesaleOrders();
      const scheduledOrders = orders.filter(order => {
        if (!order.deliveryDate) return false;
        const orderDate = new Date(order.deliveryDate);
        return orderDate.toDateString() === targetDate.toDateString() &&
               order.status !== 'cancelled' &&
               // Pickups are collected at the brewery — never route a driver to them.
               order.fulfillmentMethod !== 'pickup';
      });

      // Enrich orders with customer and location data
      const enrichedOrders = await Promise.all(
        scheduledOrders.map(async (order) => {
          const customer = await storage.getWholesaleCustomer(order.customerId);
          let location = null;
          
          if (order.locationId) {
            const locations = await storage.getWholesaleLocations(order.customerId);
            location = locations.find((l: any) => l.id === order.locationId);
          }

          return {
            ...order,
            customer,
            location,
          };
        })
      );

      res.json(enrichedOrders);
    } catch (error: any) {
      console.error("Error fetching delivery orders:", error);
      res.status(500).json({ message: "Error fetching delivery orders: " + error.message });
    }
  });

  // Stock check for a delivery day: the day's total demand per flavor/unit against
  // finished-goods on the shelf, so shortages surface BEFORE the route is built.
  app.get("/api/delivery/stock-check/:date", isAuthenticated, isStaffOrAdmin, async (req, res) => {
    try {
      const targetDate = new Date(req.params.date);
      if (isNaN(targetDate.getTime())) return res.status(400).json({ message: "Invalid date" });
      const dayOrders = (await storage.getWholesaleOrdersByDeliveryDate(targetDate))
        .filter(o => o.status !== 'cancelled' && o.fulfillmentMethod !== 'pickup');
      if (!dayOrders.length) return res.json({ rows: [], shortages: 0 });

      const orderIds = dayOrders.map(o => o.id);
      const itemRows = await db
        .select({
          unitName: wholesaleUnitTypes.name,
          container: wholesaleUnitTypes.container,
          flavorName: flavors.name,
          quantity: wholesaleOrderItems.quantity,
        })
        .from(wholesaleOrderItems)
        .leftJoin(wholesaleUnitTypes, eq(wholesaleOrderItems.unitTypeId, wholesaleUnitTypes.id))
        .leftJoin(flavors, eq(wholesaleOrderItems.flavorId, flavors.id))
        .where(inArray(wholesaleOrderItems.orderId, orderIds));

      const demand = new Map<string, { label: string; flavor: string; container: string | null; needed: number }>();
      for (const r of itemRows) {
        const flavor = r.flavorName || 'Unknown';
        const unit = r.unitName || 'Item';
        const key = `${flavor}|${unit}`;
        const entry = demand.get(key) ?? { label: `${flavor} — ${unit}`, flavor, container: r.container ?? null, needed: 0 };
        entry.needed += r.quantity;
        demand.set(key, entry);
      }

      const shelf = (await pool.query(
        'select f.name as flavor, p.container, p.stock_quantity from products p join flavors f on f.id = p.flavor_id'
      )).rows as Array<{ flavor: string; container: string; stock_quantity: number }>;
      const shelfBy = new Map(shelf.map(s => [`${s.flavor}|${s.container}`, s.stock_quantity]));

      const rows = Array.from(demand.values()).map(d => {
        // Mixed cases are assembled from single-flavor stock and untracked.
        const tracked = d.flavor !== 'Mixed' && d.container != null;
        const inStock = tracked ? (shelfBy.get(`${d.flavor}|${d.container}`) ?? null) : null;
        return {
          label: d.label,
          needed: d.needed,
          inStock,
          short: inStock != null && inStock < d.needed,
        };
      }).sort((a, b) => Number(b.short) - Number(a.short) || a.label.localeCompare(b.label));

      res.json({ rows, shortages: rows.filter(r => r.short).length });
    } catch (error: any) {
      res.status(500).json({ message: "Error checking stock: " + error.message });
    }
  });

  // Generate optimized route for a date
  app.post("/api/delivery/optimize/:date", isAuthenticated, isStaffOrAdmin, async (req, res) => {
    try {
      const { date } = req.params;
      const { customStopIds = [] } = req.body;
      const targetDate = new Date(date);
      
      // Get all scheduled wholesale orders for this date
      const { orders } = await storage.getWholesaleOrders();
      const scheduledOrders = orders.filter(order => {
        if (!order.deliveryDate) return false;
        const orderDate = new Date(order.deliveryDate);
        return orderDate.toDateString() === targetDate.toDateString() &&
               order.status !== 'cancelled' &&
               // Pickups are collected at the brewery — never route a driver to them.
               order.fulfillmentMethod !== 'pickup';
      });

      // Build list of stops from orders
      const orderStops: Array<{
        id: string;
        latitude: number;
        longitude: number;
        name: string;
        address: string;
        type: "order" | "custom";
        orderId?: string;
        customerId?: string;
      }> = [];

      for (const order of scheduledOrders) {
        const customer = await storage.getWholesaleCustomer(order.customerId);
        let location = null;
        
        if (order.locationId) {
          const locations = await storage.getWholesaleLocations(order.customerId);
          location = locations.find((l: any) => l.id === order.locationId);
        }

        // Use location coordinates if available, otherwise try to get customer's default
        const lat = location?.latitude;
        const lng = location?.longitude;

        if (lat && lng) {
          orderStops.push({
            id: order.id,
            latitude: parseFloat(lat),
            longitude: parseFloat(lng),
            // Multi-location stores need the store on the stop: "Evergreens — Thomas & Boren"
            name: location?.locationName && location.locationName !== 'Main Location'
              ? `${customer?.businessName || 'Unknown'} — ${location.locationName}`
              : (customer?.businessName || 'Unknown'),
            address: location ? `${location.address}, ${location.city}` : 'Unknown',
            type: 'order',
            orderId: order.id,
            customerId: order.customerId,
          });
        }
      }

      // Add custom stops
      const customStops = await storage.getDeliveryStops();
      const selectedCustomStops = customStops.filter(stop => 
        customStopIds.includes(stop.id) && stop.latitude && stop.longitude
      );

      for (const stop of selectedCustomStops) {
        orderStops.push({
          id: stop.id,
          latitude: parseFloat(stop.latitude!),
          longitude: parseFloat(stop.longitude!),
          name: stop.name,
          address: `${stop.address}, ${stop.city}`,
          type: 'custom',
        });
      }

      if (orderStops.length === 0) {
        return res.json({
          success: true,
          message: "No geocoded stops found for this date",
          route: null,
          stops: [],
        });
      }

      // Call Mapbox optimization API
      const optimizedRoute = await optimizeDeliveryRoute(orderStops);

      if (!optimizedRoute) {
        return res.status(500).json({ message: "Failed to optimize route" });
      }

      // Reorder stops into the optimized drive sequence. stopIndex says which INPUT
      // stop each entry is; waypointIndex says where it lands in the drive. The old
      // mapping used them the other way around, scrambling names against distances.
      const reorderedStops = [...optimizedRoute.stops]
        .sort((a, b) => a.waypointIndex - b.waypointIndex)
        .map(optStop => ({
          ...orderStops[optStop.stopIndex],
          stopOrder: optStop.waypointIndex,
          distanceFromPrevious: optStop.distanceFromPrevious,
          durationFromPrevious: optStop.durationFromPrevious,
        }));

      // Save the route
      const savedRoute = await storage.createDeliveryRoute({
        routeDate: targetDate,
        // Mapbox returns fractional meters/seconds; the columns are integers.
        totalDistanceMeters: Math.round(optimizedRoute.totalDistance),
        totalDurationSeconds: Math.round(optimizedRoute.totalDuration),
        optimizedStops: JSON.stringify(reorderedStops),
        generatedByUserId: req.user!.id,
      });

      // Save individual route stops
      for (const stop of reorderedStops) {
        await storage.createDeliveryRouteStop({
          routeId: savedRoute.id,
          stopOrder: stop.stopOrder,
          stopType: stop.type,
          wholesaleOrderId: stop.type === 'order' ? stop.id : null,
          deliveryStopId: stop.type === 'custom' ? stop.id : null,
          distanceFromPrevious: stop.distanceFromPrevious != null ? Math.round(stop.distanceFromPrevious) : null,
          durationFromPrevious: stop.durationFromPrevious != null ? Math.round(stop.durationFromPrevious) : null,
        });
      }

      res.json({
        success: true,
        route: savedRoute,
        stops: reorderedStops,
        totalDuration: optimizedRoute.totalDuration,
        totalDistance: optimizedRoute.totalDistance,
        geometry: optimizedRoute.geometry,
      });
    } catch (error: any) {
      console.error("Error optimizing route:", error);
      res.status(500).json({ message: "Error optimizing route: " + error.message });
    }
  });

  /** Re-leg a stop sequence over real roads and persist it as the route's new order. */
  async function saveRouteSequence(route: any, sequence: any[], res: any) {
      const reversed = sequence.map((s, i) => ({ ...s, stopOrder: i }));
      const facility = getFacilityLocation();
      const directions = await getRouteDirections([
        { latitude: facility.latitude, longitude: facility.longitude },
        ...reversed.map((s) => ({ latitude: Number(s.latitude), longitude: Number(s.longitude) })),
        { latitude: facility.latitude, longitude: facility.longitude },
      ]);
      if (!directions) return res.status(500).json({ message: "Could not recompute the drive for this order" });

      // legs[i] is the drive INTO stop i (leg 0 leaves the facility).
      const restopped = reversed.map((s, i) => ({
        ...s,
        distanceFromPrevious: directions.legs[i]?.distance ?? 0,
        durationFromPrevious: directions.legs[i]?.duration ?? 0,
      }));

      await db.update(deliveryRoutes).set({
        totalDistanceMeters: Math.round(directions.distance),
        totalDurationSeconds: Math.round(directions.duration),
        optimizedStops: JSON.stringify(restopped),
      }).where(eq(deliveryRoutes.id, route.id));

      await db.delete(deliveryRouteStops).where(eq(deliveryRouteStops.routeId, route.id));
      for (const stop of restopped) {
        await storage.createDeliveryRouteStop({
          routeId: route.id,
          stopOrder: stop.stopOrder,
          stopType: stop.type,
          wholesaleOrderId: stop.type === 'order' ? stop.id : null,
          deliveryStopId: stop.type === 'custom' ? stop.id : null,
          distanceFromPrevious: Math.round(stop.distanceFromPrevious),
          durationFromPrevious: Math.round(stop.durationFromPrevious),
        });
      }

      res.json({
        success: true,
        route: await storage.getDeliveryRoute(route.id),
        stops: restopped,
        totalDuration: directions.duration,
        totalDistance: directions.distance,
        geometry: directions.geometry,
      });
  }

  // Reverse a saved route (owner, 2026-09-01): same stops, opposite direction, with
  // legs and totals recomputed over real roads via the Directions API.
  app.post("/api/delivery/routes/:id/reverse", isAuthenticated, isStaffOrAdmin, async (req, res) => {
    try {
      const route = await storage.getDeliveryRoute(req.params.id);
      if (!route) return res.status(404).json({ message: "Route not found" });
      const saved: any[] = JSON.parse((route as any).optimizedStops ?? "[]");
      if (saved.length < 2) return res.status(400).json({ message: "Not enough stops to reverse" });
      await saveRouteSequence(route, [...saved].reverse(), res);
    } catch (error: any) {
      console.error("Error reversing route:", error);
      res.status(500).json({ message: "Error reversing route: " + error.message });
    }
  });

  // Hand-reorder a saved route (owner, 2026-09-02): the body carries the stop ids in
  // the new order; legs and totals recompute over real roads.
  app.post("/api/delivery/routes/:id/reorder", isAuthenticated, isStaffOrAdmin, async (req, res) => {
    try {
      const route = await storage.getDeliveryRoute(req.params.id);
      if (!route) return res.status(404).json({ message: "Route not found" });
      const saved: any[] = JSON.parse((route as any).optimizedStops ?? "[]");
      const order: string[] = Array.isArray(req.body?.order) ? req.body.order.map(String) : [];
      const byId = new Map(saved.map((s) => [String(s.id), s]));
      if (order.length !== saved.length || !order.every((id) => byId.has(id))) {
        return res.status(400).json({ message: "Order must list every stop on the route exactly once" });
      }
      await saveRouteSequence(route, order.map((id) => byId.get(id)), res);
    } catch (error: any) {
      console.error("Error reordering route:", error);
      res.status(500).json({ message: "Error reordering route: " + error.message });
    }
  });

  // Get saved routes
  app.get("/api/delivery/routes", isAuthenticated, isStaffOrAdmin, async (req, res) => {
    try {
      const routes = await storage.getDeliveryRoutes();
      res.json(routes);
    } catch (error: any) {
      console.error("Error fetching routes:", error);
      res.status(500).json({ message: "Error fetching routes: " + error.message });
    }
  });

  // Printable delivery packet: page 1 is the route in drive order, then each
  // order-stop's invoice — one print job hands the driver everything.
  app.get("/api/delivery/routes/:id/packet", isAuthenticated, isStaffOrAdmin, async (req, res) => {
    try {
      const route = await storage.getDeliveryRoute(req.params.id);
      if (!route) return res.status(404).json({ message: "Route not found" });
      const stops = await storage.getDeliveryRouteStops(req.params.id);
      const customStops = await storage.getDeliveryStops();
      const customById = new Map(customStops.map((c: any) => [c.id, c]));

      const stopLines: any[] = [];
      const invoices: any[] = [];
      for (const stop of [...stops].sort((a, b) => a.stopOrder - b.stopOrder)) {
        if (stop.stopType === 'order' && stop.wholesaleOrderId) {
          const details = await storage.getWholesaleOrderWithDetails(stop.wholesaleOrderId);
          if (!details) continue;
          const { order, customer, items } = details;
          const adjustments = await storage.getWholesaleOrderAdjustments(order.id);
          const invoiceItems = [
            ...items.map((item: any) => ({ productName: item.product.flavor ? `${item.product.name} - ${item.product.flavor}` : item.product.name, quantity: item.quantity, unitPrice: item.unitPrice })),
            ...adjustments.map((a) => ({ productName: a.label, quantity: 1, unitPrice: a.amount })),
          ];
          const location = order.location ?? null;
          const customerAddress = location ? `${location.address}, ${location.city}, ${location.state} ${location.zipCode}` : '';
          stopLines.push({
            order: stop.stopOrder + 1,
            label: `${customer.businessName}${location && location.locationName !== 'Main Location' ? ` — ${location.locationName}` : ''}`,
            address: customerAddress,
            arrival: stop.arrivalEstimate ? new Date(stop.arrivalEstimate) : null,
            invoiceNumber: order.invoiceNumber,
            totalAmount: order.totalAmount,
            notes: order.notes,
            paid: !!order.paidAt,
          });
          invoices.push({
            poNumber: (order as any).poNumber ?? null,
            customerEmail: customer.email,
            businessName: customer.businessName,
            contactName: customer.contactName,
            customerAddress,
            customerPhone: customer.phone,
            invoiceNumber: order.invoiceNumber,
            orderDate: new Date(order.orderDate),
            deliveryDate: order.deliveryDate ? new Date(order.deliveryDate) : new Date(route.routeDate),
            dueDate: order.dueDate ? new Date(order.dueDate) : null,
            items: invoiceItems,
            subtotal: Number(order.totalAmount),
            notes: order.notes,
            location,
            // Print copies never carry a payment link — the footer falls back to
            // "Net 30, mail a check".
            allowOnlinePayment: false,
            paymentUrl: null,
            paidAt: order.paidAt ? new Date(order.paidAt) : null,
          });
        } else if (stop.deliveryStopId) {
          const c: any = customById.get(stop.deliveryStopId);
          stopLines.push({
            order: stop.stopOrder + 1,
            label: c?.name ?? 'Custom stop',
            address: c ? [c.address, c.city, c.state, c.zipCode].filter(Boolean).join(', ') : '',
            arrival: stop.arrivalEstimate ? new Date(stop.arrivalEstimate) : null,
            notes: c?.notes ?? null,
          });
        }
      }

      // Packing list: real products aggregated across every delivery on the route,
      // as unit × flavor cells for the matrix page. Adjustments (pallet fees,
      // credits) are invoice lines, not things on a truck.
      const packing = new Map<string, { unit: string; flavor: string; quantity: number }>();
      for (const stop of [...stops].sort((a, b) => a.stopOrder - b.stopOrder)) {
        if (stop.stopType !== 'order' || !stop.wholesaleOrderId) continue;
        const details = await storage.getWholesaleOrderWithDetails(stop.wholesaleOrderId);
        for (const item of details?.items ?? []) {
          const p = (item as any).product;
          const key = `${p.name}|${p.flavor || ''}`;
          const entry = packing.get(key) ?? { unit: p.name, flavor: p.flavor || 'Other', quantity: 0 };
          entry.quantity += item.quantity;
          packing.set(key, entry);
        }
      }
      const packingList = Array.from(packing.values());

      const pdf = await generateDeliveryPacketPDF({
        routeDate: new Date(route.routeDate),
        totalDistanceMeters: route.totalDistanceMeters,
        totalDurationSeconds: route.totalDurationSeconds,
        stops: stopLines,
        packingList,
        invoices,
      });
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `inline; filename="delivery-packet-${format(new Date(route.routeDate), 'yyyy-MM-dd')}.pdf"`);
      res.send(pdf);
    } catch (error: any) {
      console.error("Error building delivery packet:", error);
      res.status(500).json({ message: "Error building delivery packet: " + error.message });
    }
  });

  // Get a specific route with stops
  app.get("/api/delivery/routes/:id", isAuthenticated, isStaffOrAdmin, async (req, res) => {
    try {
      const { id } = req.params;
      const route = await storage.getDeliveryRoute(id);
      
      if (!route) {
        return res.status(404).json({ message: "Route not found" });
      }

      const stops = await storage.getDeliveryRouteStops(id);
      
      // Get the geometry for the route
      const optimizedStops = JSON.parse(route.optimizedStops);
      const facility = getFacilityLocation();
      
      const allCoords = [
        { latitude: facility.latitude, longitude: facility.longitude },
        ...optimizedStops.map((s: any) => ({ latitude: s.latitude, longitude: s.longitude })),
        { latitude: facility.latitude, longitude: facility.longitude },
      ];
      
      const directions = await getRouteDirections(allCoords);

      res.json({
        route,
        stops,
        geometry: directions?.geometry,
      });
    } catch (error: any) {
      console.error("Error fetching route:", error);
      res.status(500).json({ message: "Error fetching route: " + error.message });
    }
  });

  // Delete a route
  app.delete("/api/delivery/routes/:id", isAuthenticated, isStaffOrAdmin, async (req, res) => {
    try {
      const { id } = req.params;
      await storage.deleteDeliveryRoute(id);
      res.json({ success: true });
    } catch (error: any) {
      console.error("Error deleting route:", error);
      res.status(500).json({ message: "Error deleting route: " + error.message });
    }
  });

  registerClaimRoutes(app, { isAuthenticated, isStaffOrAdmin, placeCustomerOrder, baseUrl: getBaseUrl });

  const httpServer = createServer(app);

  return httpServer;
}
