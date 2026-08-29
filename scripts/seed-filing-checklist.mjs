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
    description: "Due the 25th for the prior month. File in MyDOR (dor.wa.gov). Retailing vs wholesaling classifications + sales tax collected." },

  // ---- quarterly (surface Jan/Apr/Jul/Oct; filings due end of those months) ----
  { title: "File L&I workers' comp quarterly report", recurrence: "quarterly", dayOfMonth: 20,
    description: "QuickBooks does NOT file this one. Report hours by risk class 3702 and pay premiums at lni.wa.gov (QuickBooks' Workers' Comp report has the hours). Due the last day of the month." },
  { title: "Verify QuickBooks filed payroll forms", recurrence: "quarterly", dayOfMonth: 20,
    description: "Two-minute check: QuickBooks → Taxes → Payroll tax → Filings. Confirm 941, ESD unemployment, and PFML/WA Cares show as filed by Intuit for last quarter." },
  { title: "File Seattle B&O return", recurrence: "quarterly", dayOfMonth: 20,
    description: "City of Seattle business license tax via FileLocal. Due the last day of the month (skip the quarterly ones if the city has you on annual filing — then it's due Apr 30)." },

  // ---- federal estimated taxes (sole prop; due the 15th of Apr/Jun/Sep/Jan) ----
  { title: "Pay federal estimated tax (1040-ES) — Q1", recurrence: "yearly", monthOfYear: 4, dayOfMonth: 8,
    description: "Due Apr 15. IRS Direct Pay or EFTPS." },
  { title: "Pay federal estimated tax (1040-ES) — Q2", recurrence: "yearly", monthOfYear: 6, dayOfMonth: 8,
    description: "Due Jun 15. IRS Direct Pay or EFTPS." },
  { title: "Pay federal estimated tax (1040-ES) — Q3", recurrence: "yearly", monthOfYear: 9, dayOfMonth: 8,
    description: "Due Sep 15. IRS Direct Pay or EFTPS." },
  { title: "Pay federal estimated tax (1040-ES) — Q4", recurrence: "yearly", monthOfYear: 1, dayOfMonth: 8,
    description: "Due Jan 15. IRS Direct Pay or EFTPS." },

  // ---- annual ----
  { title: "Year-end payroll: W-2s, 1099s, Form 940", recurrence: "yearly", monthOfYear: 1, dayOfMonth: 20,
    description: "Due Jan 31. Verify QuickBooks filed W-2s (SSA + employees) and 940; send 1099-NEC to any contractors yourself if not in QB." },
  { title: "File federal income tax return (Schedule C on 1040)", recurrence: "yearly", monthOfYear: 4, dayOfMonth: 1,
    description: "Due Apr 15 (sole proprietorship — business goes on Schedule C with the personal return)." },
  { title: "File King County personal property listing", recurrence: "yearly", monthOfYear: 4, dayOfMonth: 15,
    description: "Due Apr 30 via eListing (kingcounty.gov) — business equipment (tanks, canning line, coolers). No extensions; 5%/month late penalty." },
  { title: "Renew WSDA food processor license", recurrence: "yearly", monthOfYear: 6, dayOfMonth: 15,
    description: "All WSDA food processor licenses expire Jun 30 regardless of issue date. agr.wa.gov / foodsafety@agr.wa.gov." },
  { title: "Update L&I comp rates in QuickBooks", recurrence: "yearly", monthOfYear: 12, dayOfMonth: 15,
    description: "New rate notice arrives in December. Pull the 'Risk class rate and payroll deduction calculation' page in L&I Claim & Account Center and update the composite rate + payroll deduction in QB Payroll settings, effective Jan 1." },
  { title: "Renew Seattle business license", recurrence: "yearly", monthOfYear: 12, dayOfMonth: 10,
    description: "Business license tax certificate expires Dec 31; renew before then (seattle.gov / FileLocal)." },
  { title: "Renew WA business license endorsements", recurrence: "yearly", monthOfYear: 1, dayOfMonth: 10,
    description: "State endorsements renew on the account's anniversary (LLC formed Jan 2015) — DOR mails/emails a notice. Due end of January." },
  { title: "File WA Secretary of State annual report", recurrence: "yearly", monthOfYear: 1, dayOfMonth: 10,
    description: "LLC annual report, due Jan 31 (end of anniversary month — formed Jan 2015). File at ccfs.sos.wa.gov; missing it can get the LLC administratively dissolved." },

  // ---- one-time (biennial; recreate in 2028) ----
  { title: "Renew FDA food facility registration (2026 window)", recurrence: "one-time", monthOfYear: 10, dayOfMonth: 15,
    description: "Renewal window Oct 1 – Dec 31, 2026 (every even year; next in 2028). No fee, no grace period — an unrenewed facility's products are legally adulterated. fda.gov FURLS." },
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
