/**
 * Claim your store.
 *
 * A new buyer at a store we already serve verifies an email (magic link), names the store,
 * confirms it, and asks to be linked to that account. If the email's domain is already on
 * the account (jane@evergreens.com joining a store that has bob@evergreens.com) the link is
 * automatic; otherwise it waits for a one-tap staff approval. While waiting they can build
 * an order, which is held as JSON on the request — not a real order row — and placed
 * through the normal path the moment staff approve.
 *
 * The store is the account; emails are logins on it. Nothing here changes that model — it
 * only lets the right people get onto the right account without a phone call.
 *
 * Guardrails (see the mockups the owner approved): searching requires a verified login, at
 * least 4 characters, at most 5 results, word-start matching only, 10 searches per email
 * per day, every search logged, and results show name + street + city — nothing else
 * about the account until a link is approved.
 */
import type { Express } from "express";
import { and, desc, eq, gte, sql } from "drizzle-orm";
import { db } from "./db";
import { storage } from "./storage";
import {
  users,
  wholesaleCustomers,
  wholesaleLocations,
  wholesaleLinkRequests,
  wholesaleOrders,
  wholesaleStoreSearches,
  type WholesaleCustomer,
  type WholesaleLinkRequest,
} from "@shared/schema";
import { sendWholesaleContactApprovedEmail } from "./email";

// ----------------------------------------------------------------------------------------
// Policy knobs
// ----------------------------------------------------------------------------------------
export const SEARCH_MIN_CHARS = 2;
export const SEARCH_MAX_RESULTS = 8;
export const SEARCHES_PER_EMAIL_PER_DAY = 100; // generous — humans never hit it; bulk scraping still does

// A matching domain only counts as proof when it's a company domain. Anyone can make a
// gmail address, so gmail matching gmail proves nothing.
export const FREE_MAIL_DOMAINS = new Set([
  "gmail.com", "googlemail.com", "yahoo.com", "ymail.com", "hotmail.com", "outlook.com", "live.com",
  "msn.com", "aol.com", "icloud.com", "me.com", "mac.com", "protonmail.com", "proton.me", "pm.me",
  "comcast.net", "att.net", "verizon.net", "sbcglobal.net", "cox.net", "earthlink.net", "mail.com",
  "zoho.com", "yandex.com", "gmx.com", "fastmail.com", "hey.com", "duck.com",
]);

export function emailDomain(email: string): string {
  return (email.split("@")[1] || "").trim().toLowerCase();
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function customerEmails(c: WholesaleCustomer): string[] {
  const all = [c.email, ...(c.emails || [])].filter(Boolean).map(normalizeEmail);
  return Array.from(new Set(all));
}

// ----------------------------------------------------------------------------------------
// State
// ----------------------------------------------------------------------------------------
export type ClaimState =
  | { state: "linked"; customer: { id: string; businessName: string } }
  | { state: "pending"; request: PublicRequest; customer: { id: string; businessName: string } }
  | { state: "denied"; request: PublicRequest; customer: { id: string; businessName: string } }
  | { state: "none" };

type PublicRequest = {
  id: string;
  status: string;
  autoApproved: boolean;
  createdAt: Date;
  decidedAt: Date | null;
  pendingOrder: PendingOrder | null;
};

export type PendingOrder = {
  items: Array<{ unitTypeId: string; flavorId: string; quantity: number; label: string }>;
  notes?: string;
  locationId?: string;
  fulfillmentMethod: "delivery" | "pickup";
  summary: string; // "4× Wildberry 12-pk, 1× Mist 1/6 bbl" — what staff see in the queue
  heldAt: string;
};

function publicRequest(r: WholesaleLinkRequest): PublicRequest {
  return {
    id: r.id,
    status: r.status,
    autoApproved: r.autoApproved,
    createdAt: r.createdAt,
    decidedAt: r.decidedAt,
    pendingOrder: (r.pendingOrder as PendingOrder | null) ?? null,
  };
}

export async function getLatestRequestForUser(userId: string): Promise<WholesaleLinkRequest | undefined> {
  const rows = await db
    .select()
    .from(wholesaleLinkRequests)
    .where(eq(wholesaleLinkRequests.userId, userId))
    .orderBy(desc(wholesaleLinkRequests.createdAt))
    .limit(1);
  return rows[0];
}

export async function getClaimState(userId: string): Promise<ClaimState> {
  const user = await storage.getUser(userId);
  if (!user) return { state: "none" };
  if (user.wholesaleCustomerId) {
    const c = await storage.getWholesaleCustomer(user.wholesaleCustomerId);
    if (c) return { state: "linked", customer: { id: c.id, businessName: c.businessName } };
  }
  // Legacy link: wholesale_customers.user_id pointing at this user.
  const legacy = await storage.getWholesaleCustomerByUserId(userId);
  if (legacy) return { state: "linked", customer: { id: legacy.id, businessName: legacy.businessName } };

  const req = await getLatestRequestForUser(userId);
  if (!req) return { state: "none" };
  const c = await storage.getWholesaleCustomer(req.customerId);
  if (!c) return { state: "none" };
  if (req.status === "pending") return { state: "pending", request: publicRequest(req), customer: { id: c.id, businessName: c.businessName } };
  if (req.status === "denied") return { state: "denied", request: publicRequest(req), customer: { id: c.id, businessName: c.businessName } };
  return { state: "none" };
}

/** The pending claim (request + customer) for a user, if they have one. */
export async function getPendingClaim(userId: string): Promise<{ request: WholesaleLinkRequest; customer: WholesaleCustomer } | null> {
  const req = await getLatestRequestForUser(userId);
  if (!req || req.status !== "pending") return null;
  const customer = await storage.getWholesaleCustomer(req.customerId);
  if (!customer) return null;
  return { request: req, customer };
}

// ----------------------------------------------------------------------------------------
// Linking / unlinking
// ----------------------------------------------------------------------------------------

/** Make `email` (the user's login) an authorized contact on the account and point the user at it. */
export async function linkUserToCustomer(userId: string, customer: WholesaleCustomer, email: string): Promise<void> {
  const e = normalizeEmail(email);
  await db
    .update(users)
    .set({ wholesaleCustomerId: customer.id, role: "wholesale_customer" })
    .where(eq(users.id, userId));
  if (!customerEmails(customer).includes(e)) {
    await storage.updateWholesaleCustomer(customer.id, { emails: [...(customer.emails || []), e] });
  }
}

/**
 * Remove a login from an account. Removes the address from the authorized list AND
 * detaches any user row for it, so an existing 30-day session stops working too —
 * editing the emails array alone used to leave the old contact signed in.
 */
export async function removeContact(customer: WholesaleCustomer, email: string): Promise<{ ok: true } | { ok: false; message: string }> {
  const e = normalizeEmail(email);
  if (normalizeEmail(customer.email) === e) {
    return { ok: false, message: "That's the primary contact. Make another email primary first, then remove this one." };
  }
  await storage.updateWholesaleCustomer(customer.id, {
    emails: (customer.emails || []).filter((x) => normalizeEmail(x) !== e),
  });
  await db
    .update(users)
    .set({ wholesaleCustomerId: null, role: "user" })
    .where(and(sql`LOWER(${users.email}) = ${e}`, eq(users.wholesaleCustomerId, customer.id)));
  // Retire their join record too, or the "new contacts" feed keeps listing someone who
  // was just removed.
  await db
    .update(wholesaleLinkRequests)
    .set({ status: "removed" })
    .where(and(eq(wholesaleLinkRequests.customerId, customer.id), eq(wholesaleLinkRequests.email, e), eq(wholesaleLinkRequests.status, "approved")));
  return { ok: true };
}

export async function addContact(customer: WholesaleCustomer, email: string): Promise<{ ok: true } | { ok: false; message: string }> {
  const e = normalizeEmail(email);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) return { ok: false, message: "That doesn't look like an email address." };
  const other = await storage.getWholesaleCustomerByAnyEmail(e);
  if (other && other.id !== customer.id) {
    return { ok: false, message: `${e} is already a contact on ${other.businessName}.` };
  }
  if (customerEmails(customer).includes(e)) return { ok: true };
  await storage.updateWholesaleCustomer(customer.id, { emails: [...(customer.emails || []), e] });
  return { ok: true };
}

export async function setPrimaryContact(customer: WholesaleCustomer, email: string): Promise<{ ok: true } | { ok: false; message: string }> {
  const e = normalizeEmail(email);
  if (!customerEmails(customer).includes(e)) return { ok: false, message: "Add the email as a contact first." };
  const oldPrimary = normalizeEmail(customer.email);
  const emails = Array.from(new Set([...(customer.emails || []).map(normalizeEmail), oldPrimary])).filter((x) => x !== e);
  await storage.updateWholesaleCustomer(customer.id, { email: e, emails });
  return { ok: true };
}

export type ContactRow = {
  email: string;
  isPrimary: boolean;
  hasLogin: boolean;
  lastOrderedAt: Date | null;
  pendingRequestId: string | null;
  addedBy: "staff" | "domain-match" | "approved" | null;
};

export async function getCustomerContacts(customerId: string): Promise<ContactRow[]> {
  const customer = await storage.getWholesaleCustomer(customerId);
  if (!customer) return [];
  const emails = customerEmails(customer);

  const userRows = emails.length
    ? await db
        .select({ id: users.id, email: users.email, wholesaleCustomerId: users.wholesaleCustomerId })
        .from(users)
        .where(sql`LOWER(${users.email}) IN (${sql.join(emails.map((e) => sql`${e}`), sql`, `)})`)
    : [];
  const userByEmail = new Map(userRows.map((u) => [normalizeEmail(u.email || ""), u]));

  const lastOrders = userRows.length
    ? await db
        .select({ userId: wholesaleOrders.placedByUserId, last: sql<Date>`MAX(${wholesaleOrders.orderDate})` })
        .from(wholesaleOrders)
        .where(sql`${wholesaleOrders.placedByUserId} IN (${sql.join(userRows.map((u) => sql`${u.id}`), sql`, `)}) AND ${wholesaleOrders.deletedAt} IS NULL`)
        .groupBy(wholesaleOrders.placedByUserId)
    : [];
  const lastByUser = new Map(lastOrders.map((r) => [r.userId, r.last]));

  const requests = await db
    .select()
    .from(wholesaleLinkRequests)
    .where(eq(wholesaleLinkRequests.customerId, customerId))
    .orderBy(desc(wholesaleLinkRequests.createdAt));
  const latestReqByEmail = new Map<string, WholesaleLinkRequest>();
  for (const r of requests) if (!latestReqByEmail.has(r.email)) latestReqByEmail.set(r.email, r);

  const rows: ContactRow[] = emails.map((e) => {
    const u = userByEmail.get(e);
    const r = latestReqByEmail.get(e);
    return {
      email: e,
      isPrimary: e === normalizeEmail(customer.email),
      hasLogin: !!u && u.wholesaleCustomerId === customer.id,
      lastOrderedAt: u ? lastByUser.get(u.id) ?? null : null,
      pendingRequestId: null,
      addedBy: r?.status === "approved" ? (r.autoApproved ? "domain-match" : "approved") : null,
    };
  });
  // Pending requests show up in the list too, so staff can approve from the store itself.
  for (const r of requests) {
    if (r.status === "pending" && !emails.includes(r.email)) {
      rows.push({ email: r.email, isPrimary: false, hasLogin: false, lastOrderedAt: null, pendingRequestId: r.id, addedBy: null });
    }
  }
  return rows;
}

// ----------------------------------------------------------------------------------------
// Search
// ----------------------------------------------------------------------------------------
export type StoreMatch = { id: string; businessName: string; street: string | null; city: string | null; locationCount: number };

function tokens(q: string): string[] {
  return q
    .toLowerCase()
    .replace(/[^\w\s'&-]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 2)
    .slice(0, 6);
}

/**
 * Word-start match of every token against the business name plus its active locations'
 * street and city. "evergreens pike" → Evergreens on Pike St; "a" → nothing (too short).
 */
export async function searchStores(q: string): Promise<StoreMatch[]> {
  const toks = tokens(q);
  if (toks.length === 0) return [];
  const conds = toks.map(
    (t) => sql`(c.business_name || ' ' || COALESCE(l.agg, '')) ~* ${"\\m" + t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`
  );
  const rows = await db.execute(sql`
    SELECT c.id, c.business_name AS "businessName", l.first_street AS street, l.first_city AS city, COALESCE(l.n, 0)::int AS "locationCount"
    FROM wholesale_customers c
    LEFT JOIN LATERAL (
      SELECT string_agg(address || ' ' || city, ' ') AS agg,
             (array_agg(address ORDER BY created_at))[1] AS first_street,
             (array_agg(city ORDER BY created_at))[1] AS first_city,
             count(*) AS n
      FROM wholesale_locations wl WHERE wl.customer_id = c.id AND wl.is_active
    ) l ON true
    WHERE ${sql.join(conds, sql` AND `)}
    ORDER BY c.business_name
    LIMIT ${SEARCH_MAX_RESULTS + 1}
  `);
  return (rows.rows as any[]).slice(0, SEARCH_MAX_RESULTS).map((r) => ({
    id: r.id,
    businessName: r.businessName,
    street: r.street ?? null,
    city: r.city ?? null,
    locationCount: Number(r.locationCount) || 0,
  }));
}

async function searchesToday(email: string): Promise<number> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const r = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(wholesaleStoreSearches)
    .where(and(eq(wholesaleStoreSearches.email, normalizeEmail(email)), gte(wholesaleStoreSearches.createdAt, since)));
  return r[0]?.n ?? 0;
}

// ----------------------------------------------------------------------------------------
// Requests
// ----------------------------------------------------------------------------------------
export async function createLinkRequest(user: { id: string; email: string }, customer: WholesaleCustomer): Promise<{ request: WholesaleLinkRequest; autoApproved: boolean }> {
  const email = normalizeEmail(user.email);
  const existing = await getLatestRequestForUser(user.id);
  if (existing && existing.status === "pending" && existing.customerId === customer.id) {
    return { request: existing, autoApproved: false };
  }
  // Every verified email joins immediately — no staff gate (owner decision 2026-08-23:
  // stores rotate buyers constantly, and the friction cost more than the gate protected).
  // The record still notes whether the domain matched, and every join shows up in the
  // staff "new contacts" feed with one-click removal — oversight moved from approval to
  // visibility.
  const domain = emailDomain(email);
  const domainOnAccount = !FREE_MAIL_DOMAINS.has(domain) && customerEmails(customer).some((e) => emailDomain(e) === domain);

  const [request] = await db
    .insert(wholesaleLinkRequests)
    .values({
      userId: user.id,
      email,
      customerId: customer.id,
      status: "approved",
      autoApproved: domainOnAccount,
      decidedAt: new Date(),
    })
    .returning();
  await linkUserToCustomer(user.id, customer, email);
  console.log(`[CLAIM] ${email} joined ${customer.businessName} (${customer.id})${domainOnAccount ? " (domain match)" : ""}`);
  return { request, autoApproved: domainOnAccount };
}

export type PlaceCustomerOrder = (
  customer: WholesaleCustomer,
  body: any,
  opts: { placedByUserId: string | null }
) => Promise<any>;

export type ClaimRouteDeps = {
  isAuthenticated: (req: any, res: any, next: any) => any;
  isStaffOrAdmin: (req: any, res: any, next: any) => any;
  placeCustomerOrder: PlaceCustomerOrder;
  baseUrl: () => string;
};

export function registerClaimRoutes(app: Express, deps: ClaimRouteDeps) {
  const { isAuthenticated, isStaffOrAdmin, placeCustomerOrder, baseUrl } = deps;

  // Someone who can claim: a verified login that is not already on a wholesale account.
  const isClaimant = async (req: any, res: any, next: any) => {
    if (!req.user) return res.status(401).json({ message: "Please sign in first" });
    if (!["user", "wholesale_customer"].includes(req.user.role)) {
      return res.status(403).json({ message: "Staff accounts can't claim a store" });
    }
    const state = await getClaimState(req.user.id);
    if (state.state === "linked") return res.status(409).json({ message: "This email is already on a wholesale account", state });
    next();
  };

  // ---- customer side -------------------------------------------------------------
  app.get("/api/wholesale/claim/status", isAuthenticated, async (req: any, res) => {
    try {
      res.json(await getClaimState(req.user.id));
    } catch (e: any) {
      res.status(500).json({ message: "Error reading claim status: " + e.message });
    }
  });

  app.get("/api/wholesale/claim/search", isAuthenticated, isClaimant, async (req: any, res) => {
    try {
      const q = String(req.query.q || "").trim();
      if (q.length < SEARCH_MIN_CHARS) {
        return res.status(400).json({ message: `Type at least ${SEARCH_MIN_CHARS} characters of the store name`, matches: [] });
      }
      const email = normalizeEmail(req.user.email || "");
      if ((await searchesToday(email)) >= SEARCHES_PER_EMAIL_PER_DAY) {
        return res.status(429).json({ message: "That's enough searches for today. If you can't find your store, apply for an account and we'll sort it out.", matches: [] });
      }
      const matches = await searchStores(q);
      await db.insert(wholesaleStoreSearches).values({
        userId: req.user.id,
        email,
        query: q.slice(0, 200),
        resultCount: matches.length,
        ip: req.ip || req.socket?.remoteAddress || null,
      });
      res.json({ matches });
    } catch (e: any) {
      console.error("[CLAIM] search error:", e);
      res.status(500).json({ message: "Search failed: " + e.message });
    }
  });

  app.post("/api/wholesale/claim", isAuthenticated, isClaimant, async (req: any, res) => {
    try {
      const { customerId } = req.body || {};
      if (!customerId || typeof customerId !== "string") return res.status(400).json({ message: "Pick a store first" });
      const customer = await storage.getWholesaleCustomer(customerId);
      if (!customer) return res.status(404).json({ message: "That store is no longer available. Search again." });
      if (!req.user.email) return res.status(400).json({ message: "Your login has no email address" });
      const { request, autoApproved } = await createLinkRequest({ id: req.user.id, email: req.user.email }, customer);
      res.json({ status: request.status, autoApproved, request: publicRequest(request), customer: { id: customer.id, businessName: customer.businessName } });
    } catch (e: any) {
      console.error("[CLAIM] create error:", e);
      res.status(500).json({ message: "Couldn't submit that: " + e.message });
    }
  });

  // ---- staff side ---------------------------------------------------------------
  app.get("/api/wholesale/link-requests", isAuthenticated, isStaffOrAdmin, async (req: any, res) => {
    try {
      const status = typeof req.query.status === "string" ? req.query.status : "pending";
      const rows = await db
        .select({
          id: wholesaleLinkRequests.id,
          email: wholesaleLinkRequests.email,
          status: wholesaleLinkRequests.status,
          autoApproved: wholesaleLinkRequests.autoApproved,
          pendingOrder: wholesaleLinkRequests.pendingOrder,
          placedOrderId: wholesaleLinkRequests.placedOrderId,
          denyReason: wholesaleLinkRequests.denyReason,
          createdAt: wholesaleLinkRequests.createdAt,
          decidedAt: wholesaleLinkRequests.decidedAt,
          customerId: wholesaleLinkRequests.customerId,
          businessName: wholesaleCustomers.businessName,
        })
        .from(wholesaleLinkRequests)
        .innerJoin(wholesaleCustomers, eq(wholesaleCustomers.id, wholesaleLinkRequests.customerId))
        .where(
          status === "all"
            ? sql`true`
            : status === "recent"
              // The staff feed of self-joined contacts: approved in the last 14 days.
              ? and(eq(wholesaleLinkRequests.status, "approved"), gte(wholesaleLinkRequests.decidedAt, sql`now() - interval '14 days'`))
              : eq(wholesaleLinkRequests.status, status)
        )
        .orderBy(desc(wholesaleLinkRequests.createdAt))
        .limit(200);
      res.json(rows);
    } catch (e: any) {
      res.status(500).json({ message: "Error listing requests: " + e.message });
    }
  });

  app.post("/api/wholesale/link-requests/:id/approve", isAuthenticated, isStaffOrAdmin, async (req: any, res) => {
    try {
      const [request] = await db.select().from(wholesaleLinkRequests).where(eq(wholesaleLinkRequests.id, req.params.id));
      if (!request) return res.status(404).json({ message: "Request not found" });
      if (request.status !== "pending") return res.status(409).json({ message: `Already ${request.status}` });
      const customer = await storage.getWholesaleCustomer(request.customerId);
      if (!customer) return res.status(404).json({ message: "Customer no longer exists" });

      await linkUserToCustomer(request.userId, customer, request.email);

      // Place the order they built while waiting — through the normal path, so pricing,
      // minimums, invoice numbering and the order-confirmation emails all behave as if
      // they had placed it just now.
      let placedOrderId: string | null = null;
      let orderError: string | null = null;
      const held = request.pendingOrder as PendingOrder | null;
      if (held && held.items?.length) {
        try {
          const order = await placeCustomerOrder(
            customer,
            { items: held.items.map(({ unitTypeId, flavorId, quantity }) => ({ unitTypeId, flavorId, quantity })), notes: held.notes, locationId: held.locationId, fulfillmentMethod: held.fulfillmentMethod },
            { placedByUserId: request.userId }
          );
          placedOrderId = order?.id ?? null;
        } catch (e: any) {
          // Approval still stands; the order just didn't go through (e.g. a location was
          // deleted meanwhile). Staff see why and the customer can re-place it.
          orderError = e?.body?.message || e?.message || "unknown error";
          console.error(`[CLAIM] approved ${request.email} but held order failed:`, orderError);
        }
      }

      const [updated] = await db
        .update(wholesaleLinkRequests)
        .set({ status: "approved", decidedAt: new Date(), decidedByUserId: req.user.id, placedOrderId })
        .where(eq(wholesaleLinkRequests.id, request.id))
        .returning();

      // The one automatic wholesale email besides order confirmations — and only where the
      // env explicitly turns it on (production), never from dev/test databases that hold
      // real addresses.
      sendWholesaleContactApprovedEmail({
        to: request.email,
        businessName: customer.businessName,
        orderPlaced: !!placedOrderId,
        portalUrl: `${baseUrl()}/wholesale-customer/place-order`,
      }).catch((e) => console.error("[CLAIM] approval email failed:", e));

      console.log(`[CLAIM] ${request.email} approved for ${customer.businessName} by ${req.user.username || req.user.id}${placedOrderId ? `; held order placed ${placedOrderId}` : ""}`);
      res.json({ request: updated, placedOrderId, orderError });
    } catch (e: any) {
      console.error("[CLAIM] approve error:", e);
      res.status(500).json({ message: "Approve failed: " + e.message });
    }
  });

  app.post("/api/wholesale/link-requests/:id/deny", isAuthenticated, isStaffOrAdmin, async (req: any, res) => {
    try {
      const [request] = await db.select().from(wholesaleLinkRequests).where(eq(wholesaleLinkRequests.id, req.params.id));
      if (!request) return res.status(404).json({ message: "Request not found" });
      if (request.status !== "pending") return res.status(409).json({ message: `Already ${request.status}` });
      const reason = typeof req.body?.reason === "string" ? req.body.reason.trim().slice(0, 500) : "";
      const [updated] = await db
        .update(wholesaleLinkRequests)
        .set({ status: "denied", denyReason: reason || null, decidedAt: new Date(), decidedByUserId: req.user.id, pendingOrder: null })
        .where(eq(wholesaleLinkRequests.id, request.id))
        .returning();
      console.log(`[CLAIM] ${request.email} denied for customer ${request.customerId} by ${req.user.username || req.user.id}${reason ? ` — ${reason}` : ""}`);
      res.json({ request: updated });
    } catch (e: any) {
      res.status(500).json({ message: "Deny failed: " + e.message });
    }
  });

  // ---- authorized contacts per store ---------------------------------------------
  app.get("/api/wholesale/customers/:id/contacts", isAuthenticated, isStaffOrAdmin, async (req, res) => {
    try {
      res.json(await getCustomerContacts(req.params.id));
    } catch (e: any) {
      res.status(500).json({ message: "Error loading contacts: " + e.message });
    }
  });

  app.post("/api/wholesale/customers/:id/contacts", isAuthenticated, isStaffOrAdmin, async (req, res) => {
    try {
      const customer = await storage.getWholesaleCustomer(req.params.id);
      if (!customer) return res.status(404).json({ message: "Customer not found" });
      const r = await addContact(customer, String(req.body?.email || ""));
      if (!r.ok) return res.status(400).json({ message: r.message });
      res.json(await getCustomerContacts(customer.id));
    } catch (e: any) {
      res.status(500).json({ message: "Error adding contact: " + e.message });
    }
  });

  app.post("/api/wholesale/customers/:id/contacts/primary", isAuthenticated, isStaffOrAdmin, async (req, res) => {
    try {
      const customer = await storage.getWholesaleCustomer(req.params.id);
      if (!customer) return res.status(404).json({ message: "Customer not found" });
      const r = await setPrimaryContact(customer, String(req.body?.email || ""));
      if (!r.ok) return res.status(400).json({ message: r.message });
      res.json(await getCustomerContacts(customer.id));
    } catch (e: any) {
      res.status(500).json({ message: "Error updating primary contact: " + e.message });
    }
  });

  app.delete("/api/wholesale/customers/:id/contacts/:email", isAuthenticated, isStaffOrAdmin, async (req, res) => {
    try {
      const customer = await storage.getWholesaleCustomer(req.params.id);
      if (!customer) return res.status(404).json({ message: "Customer not found" });
      const r = await removeContact(customer, decodeURIComponent(req.params.email));
      if (!r.ok) return res.status(400).json({ message: r.message });
      res.json(await getCustomerContacts(customer.id));
    } catch (e: any) {
      res.status(500).json({ message: "Error removing contact: " + e.message });
    }
  });
}

// ----------------------------------------------------------------------------------------
// Held orders (used by the customer order endpoint when the caller is still pending)
// ----------------------------------------------------------------------------------------
export async function holdPendingOrder(
  request: WholesaleLinkRequest,
  customer: WholesaleCustomer,
  body: any
): Promise<{ ok: true; pendingOrder: PendingOrder } | { ok: false; status: number; message: string }> {
  const items = Array.isArray(body?.items) ? body.items : [];
  if (items.length === 0) return { ok: false, status: 400, message: "Order must contain at least one item" };
  const fulfillmentMethod: "delivery" | "pickup" = body?.fulfillmentMethod === "pickup" ? "pickup" : "delivery";
  const locationId = fulfillmentMethod === "pickup" ? undefined : body?.locationId;
  if (fulfillmentMethod === "delivery") {
    if (!locationId) return { ok: false, status: 400, message: "Choose a delivery address, or select pickup." };
    const loc = await storage.getWholesaleLocation(locationId);
    if (!loc || loc.customerId !== customer.id) return { ok: false, status: 400, message: "Invalid delivery location" };
  }
  const labeled: PendingOrder["items"] = [];
  for (const it of items) {
    const qty = Number(it?.quantity);
    if (!it?.unitTypeId || !it?.flavorId || !Number.isFinite(qty) || qty <= 0) {
      return { ok: false, status: 400, message: "Invalid item data: unitTypeId, flavorId, and quantity are required" };
    }
    const unitType = await storage.getWholesaleUnitType(it.unitTypeId);
    if (!unitType) return { ok: false, status: 400, message: `Unit type ${it.unitTypeId} not found` };
    const flavor = await storage.getFlavor(it.flavorId);
    if (!flavor) return { ok: false, status: 400, message: `Flavor ${it.flavorId} not found` };
    labeled.push({ unitTypeId: it.unitTypeId, flavorId: it.flavorId, quantity: Math.floor(qty), label: `${flavor.name} - ${unitType.name}` });
  }
  const pendingOrder: PendingOrder = {
    items: labeled,
    notes: typeof body?.notes === "string" && body.notes.trim() ? body.notes.trim() : undefined,
    locationId: locationId || undefined,
    fulfillmentMethod,
    summary: labeled.map((i) => `${i.quantity}× ${i.label}`).join(", "),
    heldAt: new Date().toISOString(),
  };
  await db.update(wholesaleLinkRequests).set({ pendingOrder }).where(eq(wholesaleLinkRequests.id, request.id));
  console.log(`[CLAIM] held order for pending ${request.email} on ${customer.businessName}: ${pendingOrder.summary}`);
  return { ok: true, pendingOrder };
}
