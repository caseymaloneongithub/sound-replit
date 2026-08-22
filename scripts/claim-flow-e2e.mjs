// Claimant-side end-to-end test for the claim-your-store flow against the local dev server.
// Usage: node --env-file=.env scripts/claim-flow-e2e.mjs [phase]   phases: claim | verify | cleanup
import { neon } from "@neondatabase/serverless";
const sql = neon(process.env.DATABASE_URL);
const BASE = "http://127.0.0.1:5000";
const phase = process.argv[2] || "claim";

const AUTO_EMAIL = "qa-newbuyer@evergreens.com";   // domain already on Evergreens → auto-approve
const PEND_EMAIL = "qa-newbuyer-pending@gmail.com"; // free-mail → pending staff approval

async function session(email) {
  // 1) request a link (identical generic reply either way)
  let r = await fetch(`${BASE}/api/wholesale/send-email-code`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email }) });
  const sent = await r.json();
  // 2) pull the token the server would have emailed (dev: no SMTP, it only logs it)
  await new Promise((x) => setTimeout(x, 800));
  const rows = await sql`select login_token, wholesale_customer_id from email_verification_codes where lower(email)=lower(${email}) order by created_at desc limit 1`;
  if (!rows[0]?.login_token) throw new Error("no login token issued for " + email);
  // 3) redeem it
  r = await fetch(`${BASE}/api/wholesale/verify-magic-link`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token: rows[0].login_token }) });
  const body = await r.json();
  const cookie = (r.headers.get("set-cookie") || "").split(";")[0];
  if (!r.ok || !cookie) throw new Error("magic link redeem failed: " + JSON.stringify(body));
  const api = async (method, path, json) => {
    const res = await fetch(BASE + path, { method, headers: { "content-type": "application/json", cookie }, body: json ? JSON.stringify(json) : undefined });
    const b = await res.json().catch(() => ({}));
    return { status: res.status, body: b };
  };
  return { sentReply: sent.message, needsClaim: body.needsClaim, userId: body.user?.id, role: body.user?.role, customerOnCode: rows[0].wholesale_customer_id, api };
}

if (phase === "claim") {
  const out = {};
  // ---- A: auto-approve by domain ----
  const a = await session(AUTO_EMAIL);
  out.A_login = { needsClaim: a.needsClaim, role: a.role, codeHadCustomer: !!a.customerOnCode };
  out.A_status0 = (await a.api("GET", "/api/wholesale/claim/status")).body.state;
  out.A_shortSearch = (await a.api("GET", "/api/wholesale/claim/search?q=ev")).status;
  const sA = await a.api("GET", "/api/wholesale/claim/search?q=evergreens");
  out.A_search = sA.body.matches?.map((m) => `${m.businessName} — ${m.street}, ${m.city} (${m.locationCount} loc)`);
  const ev = sA.body.matches?.[0];
  const cA = await a.api("POST", "/api/wholesale/claim", { customerId: ev.id });
  out.A_claim = { status: cA.body.status, autoApproved: cA.body.autoApproved };
  out.A_status1 = (await a.api("GET", "/api/wholesale/claim/status")).body.state;
  out.A_profile = (await a.api("GET", "/api/wholesale-customer")).body.businessName;

  // ---- B: pending (free-mail) + held order ----
  const b = await session(PEND_EMAIL);
  out.B_login = { needsClaim: b.needsClaim, role: b.role };
  const sB = await b.api("GET", "/api/wholesale/claim/search?q=flora");
  out.B_search = sB.body.matches?.map((m) => `${m.businessName} — ${m.street}, ${m.city} (${m.locationCount} loc)`);
  const flora = sB.body.matches?.find((m) => m.businessName === "Flora");
  const cB = await b.api("POST", "/api/wholesale/claim", { customerId: flora.id });
  out.B_claim = { status: cB.body.status, autoApproved: cB.body.autoApproved };
  out.B_profile = (await b.api("GET", "/api/wholesale-customer")).body;
  out.B_ordersHistory = (await b.api("GET", "/api/wholesale-customer/orders")).body;
  const locs = (await b.api("GET", "/api/wholesale-customer/locations")).body;
  out.B_locations = locs.map((l) => ({ name: l.locationName, phone: l.contactPhone, instr: l.deliveryInstructions }));
  const ut = (await b.api("GET", "/api/wholesale/customer/unit-types")).body;
  const unit = ut.find((u) => (u.flavors || []).length > 0) || ut[0];
  const flavorId = unit.flavors?.[0]?.id || unit.flavors?.[0]?.flavorId;
  const heldRes = await b.api("POST", "/api/wholesale/customer/orders", { items: [{ unitTypeId: unit.id, flavorId, quantity: 3 }], fulfillmentMethod: "delivery", locationId: locs[0].id, notes: "e2e held order" });
  out.B_hold = { status: heldRes.status, held: heldRes.body.held, summary: heldRes.body.pendingOrder?.summary, message: heldRes.body.message };
  out.B_status = (await b.api("GET", "/api/wholesale/claim/status")).body;
  // guardrail: search cap (10/day) — run to the cap and confirm 429
  let last = 200;
  for (let i = 0; i < 12; i++) last = (await b.api("GET", `/api/wholesale/claim/search?q=flora${i}`)).status;
  out.B_searchCapHit429 = last === 429;
  console.log(JSON.stringify(out, null, 1));
}

if (phase === "verify") {
  const reqs = await sql`select email, status, auto_approved, placed_order_id, pending_order is not null as has_pending from wholesale_link_requests where email in (${AUTO_EMAIL}, ${PEND_EMAIL}) order by created_at`;
  const users = await sql`select email, role, wholesale_customer_id is not null as linked from users where email in (${AUTO_EMAIL}, ${PEND_EMAIL})`;
  const ev = await sql`select ${AUTO_EMAIL} = any(emails) as on_evergreens from wholesale_customers where business_name='Evergreens'`;
  const fl = await sql`select ${PEND_EMAIL} = any(emails) as on_flora from wholesale_customers where business_name='Flora'`;
  const orders = await sql`select o.invoice_number, o.total_amount, o.status, o.placed_by_user_id is not null as has_placer, (select count(*) from wholesale_order_items i where i.order_id=o.id) items from wholesale_orders o where o.notes='e2e held order'`;
  console.log(JSON.stringify({ reqs, users, onEvergreens: ev[0]?.on_evergreens, onFlora: fl[0]?.on_flora, orders }, null, 1));
}

if (phase === "cleanup") {
  const o = await sql`delete from wholesale_order_items where order_id in (select id from wholesale_orders where notes='e2e held order') returning id`;
  const o2 = await sql`delete from wholesale_orders where notes='e2e held order' returning id`;
  const r = await sql`delete from wholesale_link_requests where email in (${AUTO_EMAIL}, ${PEND_EMAIL}) returning id`;
  const s = await sql`delete from wholesale_store_searches where email in (${AUTO_EMAIL}, ${PEND_EMAIL}) returning id`;
  await sql`update wholesale_customers set emails = array_remove(emails, ${AUTO_EMAIL}) where business_name='Evergreens'`;
  await sql`update wholesale_customers set emails = array_remove(emails, ${PEND_EMAIL}) where business_name='Flora'`;
  const c = await sql`delete from email_verification_codes where email in (${AUTO_EMAIL}, ${PEND_EMAIL}) returning id`;
  const u = await sql`delete from users where email in (${AUTO_EMAIL}, ${PEND_EMAIL}) returning id`;
  console.log(JSON.stringify({ orderItems: o.length, orders: o2.length, requests: r.length, searches: s.length, codes: c.length, users: u.length }));
}
