// Run a .sql file statement-by-statement against DATABASE_URL (or DATABASE_URL_PROD with --prod).
//   node --env-file=.env scripts/run-sql.mjs scripts/migrate-claim-flow.sql
//   node --env-file=.env scripts/run-sql.mjs scripts/migrate-claim-flow.sql --prod
import { readFileSync } from "fs";
import { neon } from "@neondatabase/serverless";

const file = process.argv[2];
const prod = process.argv.includes("--prod");
if (!file) { console.error("usage: run-sql.mjs <file.sql> [--prod]"); process.exit(1); }
const url = prod ? process.env.DATABASE_URL_PROD : process.env.DATABASE_URL;
if (!url) { console.error(prod ? "DATABASE_URL_PROD not set" : "DATABASE_URL not set"); process.exit(1); }

const sql = neon(url);
const statements = readFileSync(file, "utf8")
  .split(/;\s*\n/)
  .map((s) => s.replace(/^\s*--.*$/gm, "").trim())
  .filter(Boolean);

console.log(`${prod ? "PROD" : "dev"}: ${statements.length} statements from ${file}`);
for (const st of statements) {
  await sql(st);
  console.log("  ok:", st.split("\n")[0].slice(0, 90));
}
console.log("done");
