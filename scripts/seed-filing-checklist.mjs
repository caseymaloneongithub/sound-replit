// Seed the compliance filing calendar into admin_tasks (Weekly Checklist).
// Idempotent: skips any task whose title already exists. Run:
//   node --env-file=.env scripts/seed-filing-checklist.mjs [--prod]
//
// Calendar assumptions (owner-confirmed 2026-08): sole proprietorship, WA DOR
// excise is MONTHLY, QuickBooks Payroll auto-files 941/ESD/PFML/WA Cares but
// NOT L&I, WSDA processor license (no King County retail permit), no SoS
// annual report (sole prop). Task dates are set ~1-2 weeks BEFORE the legal
// deadline so they surface on the weekly checklist with lead time.
import { readFileSync } from "fs";

const { Pool } = await import("@neondatabase/serverless");
const prod = process.argv.includes("--prod");
const url = prod
  ? process.env.PROD_DATABASE_URL || process.env.DATABASE_URL_PROD
  : process.env.DATABASE_URL;
if (!url) { console.error("no database url"); process.exit(1); }
const pool = new Pool({ connectionString: url });

const TASKS = [
  // ---- monthly ----
  { title: "File WA DOR excise return (B&O + sales tax)", recurrence: "monthly", dayOfMonth: 20,
    description: "Due the 25th for the prior month. Grab the month's numbers from Filing Numbers (staff portal, Money). Sign in at https://secure.dor.wa.gov (MyDOR), File Return: retailing + wholesaling gross under B&O, retail gross under Retail Sales Tax, remit the sales tax collected." },

  // ---- quarterly (surface Jan/Apr/Jul/Oct; filings due end of those months) ----
  { title: "File L&I workers' comp quarterly report", recurrence: "quarterly", dayOfMonth: 25,
    description: "QuickBooks does NOT file this one. Run QB's Workers' Compensation report for last quarter (hours by employee), then file at https://secure.lni.wa.gov (My L&I, Quarterly Reports) — account 624,191-00, risk class 3702-03: report hours worked and pay the premium. Due the last day of the month." },
  { title: "Verify QuickBooks filed payroll forms", recurrence: "quarterly", dayOfMonth: 25,
    description: "Two-minute check: QuickBooks, Taxes, Payroll tax, Filings. Confirm last quarter's 941 (IRS), ESD unemployment, and PFML/WA Cares all show as filed by QuickBooks. Chase anything marked as needing action." },
  { title: "File Seattle B&O return", recurrence: "quarterly", dayOfMonth: 25,
    description: "Numbers: Filing Numbers page (staff portal, Money), quarter table. File at https://portal.filelocal-wa.gov — City of Seattle B&O, retailing + wholesaling classifications. Due the last day of the month. Skip the quarterly ones if the city has you on annual filing (then due Apr 30)." },

  // ---- federal estimated taxes (sole prop; due the 15th of Apr/Jun/Sep/Jan) ----
  { title: "Pay federal estimated tax (1040-ES) — Q1", recurrence: "yearly", monthOfYear: 4, dayOfMonth: 10,
    description: "Due Apr 15. Pay at https://www.irs.gov/payments (Direct Pay, reason: Estimated Tax 1040-ES) or EFTPS. Amount per the accountant's vouchers or safe-harbor plan." },
  { title: "Pay federal estimated tax (1040-ES) — Q2", recurrence: "yearly", monthOfYear: 6, dayOfMonth: 10,
    description: "Due Jun 15. Pay at https://www.irs.gov/payments (Direct Pay, reason: Estimated Tax 1040-ES) or EFTPS. Amount per the accountant's vouchers or safe-harbor plan." },
  { title: "Pay federal estimated tax (1040-ES) — Q3", recurrence: "yearly", monthOfYear: 9, dayOfMonth: 10,
    description: "Due Sep 15. Pay at https://www.irs.gov/payments (Direct Pay, reason: Estimated Tax 1040-ES) or EFTPS. Amount per the accountant's vouchers or safe-harbor plan." },
  { title: "Pay federal estimated tax (1040-ES) — Q4", recurrence: "yearly", monthOfYear: 1, dayOfMonth: 10,
    description: "Due Jan 15. Pay at https://www.irs.gov/payments (Direct Pay, reason: Estimated Tax 1040-ES) or EFTPS. Amount per the accountant's vouchers or safe-harbor plan." },

  // ---- annual ----
  { title: "Year-end payroll: W-2s, 1099s, Form 940", recurrence: "yearly", monthOfYear: 1, dayOfMonth: 26,
    description: "Due Jan 31. Verify in QuickBooks (Taxes, Payroll tax, Filings) that W-2s and Form 940 show as filed — QB files them automatically — and employees have their W-2 copies. Send 1099-NEC to any contractors: QB, Payroll, Contractors, Prepare 1099s." },
  { title: "File federal income tax return (Schedule C on 1040)", recurrence: "yearly", monthOfYear: 4, dayOfMonth: 10,
    description: "Due Apr 15 — business income goes on Schedule C with the personal 1040 (the LLC is a disregarded entity). Usually via the accountant; source data is the Filing Numbers page + QuickBooks P&L." },
  { title: "File King County personal property listing", recurrence: "yearly", monthOfYear: 4, dayOfMonth: 25,
    description: "Due Apr 30 — no extensions, 5%/month late penalty. File the business asset listing (tanks, canning line, kegs, coolers, computers) via eListing at https://kingcounty.gov/en/dept/assessor — update last year's listing with additions and disposals." },
  { title: "Renew WSDA food processor license", recurrence: "yearly", monthOfYear: 6, dayOfMonth: 25,
    description: "License expires Jun 30 regardless of issue date. Renew with WSDA — forms at https://agr.wa.gov/services/licenses-permits-and-certificates, or email foodsafety@agr.wa.gov if no renewal notice arrived." },
  { title: "Update L&I comp rates in QuickBooks", recurrence: "yearly", monthOfYear: 12, dayOfMonth: 15,
    description: "When the December rate notice arrives: https://secure.lni.wa.gov, Claim & Account Center, Rates and Risk Classes, 'Risk class rate and payroll deduction calculation'. Copy the composite rate and payroll deduction into QuickBooks (gear, Payroll settings, Washington tax, WA Workers Compensation Tax), effective Jan 1. 2026 values were 0.8415 / 0.21605." },
  { title: "Renew Seattle business license", recurrence: "yearly", monthOfYear: 12, dayOfMonth: 26,
    description: "Business license tax certificate expires Dec 31; renewal payment must arrive before then. Renew at https://portal.filelocal-wa.gov (City of Seattle)." },
  { title: "Renew WA business license endorsements", recurrence: "yearly", monthOfYear: 1, dayOfMonth: 26,
    description: "State endorsements renew on the January anniversary (LLC formed Jan 2015) — DOR sends a notice. Renew in MyDOR at https://secure.dor.wa.gov (Renew business license). Due end of January." },
  { title: "File WA Secretary of State annual report", recurrence: "yearly", monthOfYear: 1, dayOfMonth: 26,
    description: "LLC annual report due Jan 31 (anniversary month). File at https://ccfs.sos.wa.gov — search Sound Kombucha, Annual Report, small filing fee (~$60). Missing it risks administrative dissolution." },

  // ---- one-time (biennial; recreate in 2028) ----
  { title: "Renew FDA food facility registration (2026 window)", recurrence: "one-time", monthOfYear: 10, dayOfMonth: 15,
    description: "Window Oct 1 – Dec 31, 2026 (every even year — recreate this task in 2028). Renew at https://access.fda.gov (FURLS, Food Facility Registration Module) with the FDA account. No fee, no grace period — unrenewed facilities' products are legally adulterated." },
];

const who = await pool.query(
  "select id from users where email = 'casey@soundkombucha.com' and deleted_at is null limit 1"
);
const createdBy = who.rows[0]?.id ?? null;

const existing = await pool.query("select title from admin_tasks");
const have = new Set(existing.rows.map((r) => r.title));
const maxOrder = (await pool.query("select coalesce(max(display_order),0) as m from admin_tasks")).rows[0].m;

let order = Number(maxOrder);
let added = 0;
for (const t of TASKS) {
  if (have.has(t.title)) { console.log("skip (exists):", t.title); continue; }
  order += 1;
  await pool.query(
    `insert into admin_tasks (title, description, category, recurrence, day_of_week, day_of_month, month_of_year, start_date, created_by_user_id, is_active, display_order)
     values ($1, $2, 'compliance', $3, null, $4, $5, now(), $6, true, $7)`,
    [t.title, t.description, t.recurrence, t.dayOfMonth ?? null, t.monthOfYear ?? null, createdBy, order]
  );
  console.log("added:", t.title, `(${t.recurrence})`);
  added++;
}
console.log(`\n${added} added, ${TASKS.length - added} already present. Target: ${prod ? "PROD" : "dev"}`);
await pool.end();
