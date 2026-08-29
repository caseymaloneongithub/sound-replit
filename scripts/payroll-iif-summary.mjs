// Summarize a QuickBooks payroll IIF export into the numbers the quarterly/monthly
// filings ask for: gross wages per employee, and withholding/premium totals per
// agency (941, ESD SUI, PFML, WA Cares, L&I workers comp), by month and quarter.
//
//   node scripts/payroll-iif-summary.mjs <path-to.iif>
//
// Notes on the data: paycheck TRNS rows carry the employee in NAME; "Tax Payment"
// rows to Intuit QuickBooks Workforce are remittances, not accruals, and are
// reported separately. Hours are NOT in an IIF — L&I hours come from payroll.
import { readFileSync } from "fs";

const file = process.argv[2];
if (!file) { console.error("usage: node scripts/payroll-iif-summary.mjs <file.iif>"); process.exit(1); }

const AGENCY_BY_ACCOUNT = [
  ["Federal Taxes (941", "Federal 941 (FIT + FICA)"],
  ["Federal Unemployment", "FUTA (940)"],
  ["WA SUI", "ESD unemployment (SUI)"],
  ["WA Paid Family", "PFML"],
  ["WA Cares", "WA Cares"],
  ["WA Workers Compensation", "L&I workers comp"],
];
const agencyFor = (acct) => AGENCY_BY_ACCOUNT.find(([k]) => acct.includes(k))?.[1] ?? null;

const lines = readFileSync(file, "utf8").split(/\r?\n/);
const txns = [];
let cur = null;
for (const line of lines) {
  const cols = line.split("\t");
  const tag = cols[0];
  if (tag === "TRNS") {
    cur = { date: cols[4], account: cols[5], amount: Number(cols[6]), memo: cols[7], name: cols[9] ?? "", splits: [] };
  } else if (tag === "SPL" && cur) {
    cur.splits.push({ date: cols[4], account: cols[5], amount: Number(cols[6]), memo: cols[7] });
  } else if (tag === "ENDTRNS" && cur) {
    txns.push(cur); cur = null;
  }
}

const monthOf = (d) => { const [m, , y] = d.split("/"); return `${y}-${m}`; };
const quarterOf = (d) => { const [m, , y] = d.split("/"); return `${y} Q${Math.ceil(Number(m) / 3)}`; };
const money = (n) => n.toFixed(2);

const paychecks = txns.filter((t) => !/tax payment/i.test(t.memo ?? "") && t.splits.some((s) => s.account.includes("Payroll Expenses:Wages")));
const taxPayments = txns.filter((t) => /tax payment/i.test(t.memo ?? ""));

// ---- per employee per period ----
const buckets = new Map(); // key: period|employee -> {gross, employerTax, agencies:{}}
const add = (map, key, field, amt) => {
  const b = map.get(key) ?? { gross: 0, employerTax: 0, agencies: {} };
  if (field === "gross") b.gross += amt;
  else if (field === "employerTax") b.employerTax += amt;
  else b.agencies[field] = (b.agencies[field] ?? 0) + amt;
  map.set(key, b);
};

for (const t of paychecks) {
  for (const period of [monthOf(t.date), quarterOf(t.date)]) {
    const key = `${period}|${t.name}`;
    for (const s of t.splits) {
      if (s.account === "Payroll Expenses:Wages") add(buckets, key, "gross", s.amount);
      else if (s.account === "Payroll Expenses:Taxes") add(buckets, key, "employerTax", s.amount);
      else {
        const agency = agencyFor(s.account);
        // liabilities are negative on the check (amounts owed to the agency)
        if (agency) add(buckets, key, agency, -s.amount);
      }
    }
  }
}

const periods = [...new Set([...buckets.keys()].map((k) => k.split("|")[0]))].sort();
for (const period of periods) {
  const keys = [...buckets.keys()].filter((k) => k.startsWith(period + "|")).sort();
  console.log(`\n=== ${period} ===`);
  const totals = { gross: 0, employerTax: 0, agencies: {} };
  for (const key of keys) {
    const emp = key.split("|")[1];
    const b = buckets.get(key);
    totals.gross += b.gross; totals.employerTax += b.employerTax;
    for (const [a, v] of Object.entries(b.agencies)) totals.agencies[a] = (totals.agencies[a] ?? 0) + v;
    console.log(`  ${emp}: gross ${money(b.gross)}  (employer taxes ${money(b.employerTax)})`);
  }
  console.log(`  TOTAL gross wages: ${money(totals.gross)}   employer taxes: ${money(totals.employerTax)}`);
  for (const [a, v] of Object.entries(totals.agencies)) console.log(`    ${a}: ${money(v)}`);
}

if (taxPayments.length) {
  console.log(`\n=== Remittances already paid (to ${taxPayments[0].name}) ===`);
  const remit = {};
  for (const t of taxPayments) for (const s of t.splits) {
    const agency = agencyFor(s.account);
    if (agency) remit[agency] = (remit[agency] ?? 0) + s.amount;
  }
  for (const [a, v] of Object.entries(remit)) console.log(`  ${a}: ${money(v)}`);
}
console.log(`\n(${paychecks.length} paychecks, ${taxPayments.length} tax remittances parsed. Hours are not present in IIF exports — L&I hours must come from payroll/timekeeping.)`);
