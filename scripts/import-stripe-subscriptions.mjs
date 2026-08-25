/**
 * Migrate Shopify subscriptions (billed through Stripe) into the LIVE billing system:
 * retail_subscriptions + retail_subscription_items, billingType 'local_managed' — the
 * tables the billing cron actually charges. (server/import-shopify-subscriptions.ts is
 * the older attempt; it writes the legacy `subscriptions` tables the cron no longer
 * reads. Use this one.)
 *
 * Subscribers carry over billing-intact: their card stays on their Stripe customer, the
 * price they were paying becomes unitPriceAtSignup, and nextChargeAt is the end of the
 * period they've already paid for — no gap, no double charge.
 *
 * Usage (dry run never writes anything, never emails anyone):
 *   STRIPE_SECRET_KEY=sk_live_... node --env-file=.env scripts/import-stripe-subscriptions.mjs
 *   STRIPE_SECRET_KEY=sk_live_... node --env-file=.env scripts/import-stripe-subscriptions.mjs --commit
 *   STRIPE_SECRET_KEY=sk_live_... node --env-file=.env scripts/import-stripe-subscriptions.mjs --commit --cancel-stripe
 *   node --env-file=.env scripts/import-stripe-subscriptions.mjs --self-test   (no Stripe; fabricated data, auto-cleaned)
 *
 * Flags:
 *   --prod           target DATABASE_URL_PROD instead of DATABASE_URL
 *   --commit         actually write users/subscriptions/items (default is dry run)
 *   --cancel-stripe  after a successful import, CANCEL the Stripe subscription so the
 *                    old Shopify app cannot keep billing it. Without this, run it later
 *                    or cancel in the Stripe dashboard — but until then the customer is
 *                    being billed by BOTH systems' schedules. Do this at cutover.
 *
 * Mapping: dry run writes scripts/stripe-subscription-map.suggested.json with its best
 * guesses (Stripe product name → flavor-matched retail product). Review it, save it as
 * scripts/stripe-subscription-map.json, and the importer uses it. Entries:
 *   { "stripePriceId": "price_x", "retailProductId": "...", "selectedFlavorId": null }
 * (stripeProductId works too; a price entry wins over a product entry.)
 */
import { readFileSync, writeFileSync, existsSync } from "fs";
import { neon } from "@neondatabase/serverless";

const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const COMMIT = has("--commit");
const CANCEL = has("--cancel-stripe");
const SELF_TEST = has("--self-test");
const url = has("--prod") ? process.env.DATABASE_URL_PROD : process.env.DATABASE_URL;
if (!url) { console.error("DATABASE_URL not set"); process.exit(1); }
if (CANCEL && !COMMIT) { console.error("--cancel-stripe requires --commit"); process.exit(1); }
const sql = neon(url);

const FREEMAP = (interval, count) => {
  if (interval === "week") return { 1: "weekly", 2: "bi-weekly", 4: "every-4-weeks", 6: "every-6-weeks", 8: "every-8-weeks" }[count] ?? "weekly";
  if (interval === "month") return count >= 2 ? "every-8-weeks" : "every-4-weeks";
  return "weekly";
};

async function loadCatalog() {
  const products = await sql`
    SELECT rp.id, rp.product_type, rp.product_name, rp.unit_type, f.name AS flavor_name, f.id AS flavor_id
    FROM retail_products rp LEFT JOIN flavors f ON f.id = rp.flavor_id
    WHERE rp.is_active`;
  const flavors = await sql`SELECT id, name FROM flavors WHERE is_active`;
  return { products, flavors };
}

function suggestMapping(stripeProductName, catalog) {
  const name = (stripeProductName || "").toLowerCase();
  // A Shopify subscription product is almost always "<Flavor> 12-pack"-shaped; match the
  // flavor name inside it and prefer the single-flavor 12-pack retail product.
  for (const p of catalog.products) {
    if (p.flavor_name && name.includes(p.flavor_name.toLowerCase()) && p.unit_type === "12-pack") {
      return { retailProductId: p.id, selectedFlavorId: null, label: `${p.flavor_name} 12-pack` };
    }
  }
  // Variety/mixed → the multi-flavor 12-pack if one exists (flavor left for staff to set).
  if (/(variety|mixed|assort)/.test(name)) {
    const multi = catalog.products.find((p) => p.product_type === "multi-flavor" && p.unit_type === "12-pack");
    if (multi) return { retailProductId: multi.id, selectedFlavorId: null, label: `${multi.product_name || "Variety"} (flavor: choose)` };
  }
  return null;
}

function loadMapFile() {
  const p = "scripts/stripe-subscription-map.json";
  if (!existsSync(p)) return [];
  return JSON.parse(readFileSync(p, "utf8"));
}

function resolveMapping(item, mapFile, catalog) {
  const priceId = item.price.id;
  const productId = typeof item.price.product === "string" ? item.price.product : item.price.product?.id;
  const productName = typeof item.price.product === "object" ? item.price.product?.name : undefined;
  const byPrice = mapFile.find((m) => m.stripePriceId === priceId);
  if (byPrice) return { ...byPrice, source: "map:price" };
  const byProduct = mapFile.find((m) => m.stripeProductId && m.stripeProductId === productId);
  if (byProduct) return { ...byProduct, source: "map:product" };
  const guess = suggestMapping(productName, catalog);
  if (guess) return { ...guess, source: `suggested (${guess.label})` };
  return null;
}

async function findOrCreateUser(email, name, phone, stripeCustomerId) {
  const [existing] = await sql`SELECT id, role FROM users WHERE LOWER(email) = LOWER(${email})`;
  if (existing) {
    if (stripeCustomerId) await sql`UPDATE users SET stripe_customer_id = COALESCE(stripe_customer_id, ${stripeCustomerId}) WHERE id = ${existing.id}`;
    return { id: existing.id, created: false };
  }
  const parts = (name || "").trim().split(/\s+/);
  const username = email.split("@")[0].replace(/[^a-zA-Z0-9]/g, "_") + "-" + Math.random().toString(36).slice(2, 8);
  const [u] = await sql`
    INSERT INTO users (username, email, first_name, last_name, phone_number, role, stripe_customer_id)
    VALUES (${username}, ${email}, ${parts[0] || null}, ${parts.slice(1).join(" ") || null}, ${phone || ""}, 'user', ${stripeCustomerId})
    RETURNING id`;
  return { id: u.id, created: true };
}

async function importOne(sub, mapFile, catalog, stats, stripe) {
  const customer = typeof sub.customer === "object" ? sub.customer : null;
  const email = customer?.email;
  const label = `${sub.id} (${email || "no email"})`;
  if (!email) { stats.issues.push(`${label}: customer has no email — skipped`); stats.skipped++; return; }

  const [already] = await sql`SELECT id FROM retail_subscriptions WHERE stripe_subscription_id = ${sub.id}`;
  if (already) { stats.skipped++; console.log(`  ⊘ ${label}: already imported`); return; }

  const pmRaw = sub.default_payment_method || customer.invoice_settings?.default_payment_method;
  const paymentMethodId = typeof pmRaw === "object" ? pmRaw?.id : pmRaw;
  if (!paymentMethodId) { stats.issues.push(`${label}: no default payment method on the Stripe customer — imported customers without one can't be billed; skipped`); stats.skipped++; return; }

  const lines = [];
  for (const item of sub.items.data) {
    const mapping = resolveMapping(item, mapFile, catalog);
    if (!mapping || !mapping.retailProductId) {
      const pname = typeof item.price.product === "object" ? item.price.product?.name : item.price.product;
      stats.issues.push(`${label}: no mapping for "${pname}" (${item.price.id}) — subscription skipped`);
      stats.skipped++;
      return;
    }
    lines.push({
      retailProductId: mapping.retailProductId,
      selectedFlavorId: mapping.selectedFlavorId ?? null,
      quantity: item.quantity || 1,
      unitPriceAtSignup: item.price.unit_amount != null ? (item.price.unit_amount / 100).toFixed(2) : null,
      source: mapping.source,
    });
  }

  const first = sub.items.data[0];
  const frequency = FREEMAP(first.price.recurring?.interval, first.price.recurring?.interval_count || 1);
  const periodEndSec = first.current_period_end || sub.current_period_end || Math.floor(Date.now() / 1000);
  const nextChargeAt = new Date(Math.max(periodEndSec * 1000, Date.now() + 60 * 60 * 1000));

  console.log(`  → ${label}: ${lines.map((l) => `${l.quantity}× [${l.source}] @$${l.unitPriceAtSignup ?? "live"}`).join(", ")} · ${frequency} · next charge ${nextChargeAt.toISOString().slice(0, 10)}`);

  if (!COMMIT) { stats.wouldImport++; return; }

  const user = await findOrCreateUser(email, customer.name, customer.phone, customer.id);
  if (user.created) stats.usersCreated++;

  const [created] = await sql`
    INSERT INTO retail_subscriptions
      (user_id, customer_name, customer_email, customer_phone, subscription_frequency,
       stripe_subscription_id, stripe_customer_id, stripe_payment_method_id,
       status, billing_type, billing_status, next_charge_at, next_delivery_date,
       processing_lock, retry_count)
    VALUES
      (${user.id}, ${customer.name || email}, ${email}, ${customer.phone || ""}, ${frequency},
       ${sub.id}, ${customer.id}, ${paymentMethodId},
       'active', 'local_managed', 'active', ${nextChargeAt.toISOString()}, ${nextChargeAt.toISOString()},
       false, 0)
    RETURNING id`;
  for (const l of lines) {
    await sql`
      INSERT INTO retail_subscription_items (subscription_id, retail_product_id, selected_flavor_id, quantity, unit_price_at_signup)
      VALUES (${created.id}, ${l.retailProductId}, ${l.selectedFlavorId}, ${l.quantity}, ${l.unitPriceAtSignup})`;
  }
  stats.imported++;

  if (CANCEL && stripe) {
    await stripe.subscriptions.cancel(sub.id);
    stats.cancelled++;
    console.log(`    ✂ Stripe subscription ${sub.id} cancelled — our cron owns billing now`);
  }
}

async function main() {
  const stats = { total: 0, imported: 0, wouldImport: 0, skipped: 0, usersCreated: 0, cancelled: 0, issues: [] };
  const catalog = await loadCatalog();
  const mapFile = loadMapFile();
  console.log(`${COMMIT ? "COMMIT" : "DRY RUN"}${CANCEL ? " + CANCEL-STRIPE" : ""} against ${has("--prod") ? "PROD" : "dev"} DB · ${mapFile.length} explicit mappings loaded`);

  let subs = [];
  let stripe = null;
  if (SELF_TEST) {
    console.log("SELF-TEST: two fabricated subscriptions, no Stripe calls");
    const mk = (id, email, name, productName, cents, interval, count) => ({
      id, status: "active",
      customer: { id: `cus_${id}`, email, name, phone: "206-555-0000", invoice_settings: { default_payment_method: `pm_${id}` } },
      default_payment_method: null,
      items: { data: [{ quantity: 2, price: { id: `price_${id}`, unit_amount: cents, product: { id: `prod_${id}`, name: productName }, recurring: { interval, interval_count: count } }, current_period_end: Math.floor(Date.now() / 1000) + 9 * 86400 }] },
    });
    subs = [
      mk("qa_st_1", "qa-stsub-1@example.com", "QA StripeSub One", "Wildberry Kombucha 12-pack Subscription", 3100, "week", 2),
      mk("qa_st_2", "qa-stsub-2@example.com", "QA StripeSub Two", "Some Unmappable Thing", 1500, "month", 1),
    ];
  } else {
    if (!process.env.STRIPE_SECRET_KEY) { console.error("STRIPE_SECRET_KEY not set (pass it inline for the migration run)"); process.exit(1); }
    const Stripe = (await import("stripe")).default;
    stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
    let startingAfter;
    for (;;) {
      const page = await stripe.subscriptions.list({
        limit: 100, starting_after: startingAfter,
        expand: ["data.customer", "data.default_payment_method"],
      });
      subs.push(...page.data.filter((s) => ["active", "trialing", "past_due"].includes(s.status)));
      if (!page.has_more) break;
      startingAfter = page.data[page.data.length - 1].id;
    }
  }

  stats.total = subs.length;
  console.log(`${subs.length} subscription(s) to consider\n`);

  // Dry run: also emit suggested mappings for every distinct Stripe product seen.
  if (!COMMIT && !SELF_TEST) {
    const seen = new Map();
    for (const sub of subs) for (const item of sub.items.data) {
      const pid = typeof item.price.product === "object" ? item.price.product?.id : item.price.product;
      const pname = typeof item.price.product === "object" ? item.price.product?.name : pid;
      if (!seen.has(item.price.id)) {
        const guess = suggestMapping(pname, catalog);
        seen.set(item.price.id, { stripePriceId: item.price.id, stripeProductId: pid, stripeProductName: pname, retailProductId: guess?.retailProductId ?? "FILL-ME-IN", selectedFlavorId: guess?.selectedFlavorId ?? null, suggested: guess?.label ?? null });
      }
    }
    writeFileSync("scripts/stripe-subscription-map.suggested.json", JSON.stringify([...seen.values()], null, 2));
    console.log(`Wrote scripts/stripe-subscription-map.suggested.json (${seen.size} distinct prices) — review, fix, save as stripe-subscription-map.json\n`);
  }

  for (const sub of subs) await importOne(sub, mapFile, catalog, stats, stripe);

  console.log(`\nSummary: total ${stats.total} · ${COMMIT ? `imported ${stats.imported}` : `would import ${stats.wouldImport}`} · skipped ${stats.skipped} · users created ${stats.usersCreated}${CANCEL ? ` · stripe cancelled ${stats.cancelled}` : ""}`);
  if (stats.issues.length) { console.log("\nIssues:"); for (const i of stats.issues) console.log("  ⚠ " + i); }
  if (COMMIT && !CANCEL && stats.imported > 0 && !SELF_TEST) {
    console.log("\n⚠ REMINDER: the old Stripe subscriptions are still ACTIVE and will keep billing.");
    console.log("  Re-run with --cancel-stripe at cutover (or cancel them in the Stripe dashboard).");
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error("Import failed:", e); process.exit(1); });
