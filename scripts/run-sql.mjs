// Run a .sql file statement-by-statement against DATABASE_URL (or DATABASE_URL_PROD with --prod).
//   node --env-file=.env scripts/run-sql.mjs scripts/migrate-claim-flow.sql
//   node --env-file=.env scripts/run-sql.mjs scripts/migrate-claim-flow.sql --prod
// The local Postgres (scripts/local-db.mjs) is reached by loading .env.local after .env:
//   node --env-file=.env --env-file=.env.local scripts/run-sql.mjs scripts/migrate-claim-flow.sql
import { readFileSync } from "fs";
import { neon } from "@neondatabase/serverless";
import pg from "pg";

const file = process.argv[2];
const prod = process.argv.includes("--prod");
if (!file) { console.error("usage: run-sql.mjs <file.sql> [--prod]"); process.exit(1); }
const url = prod ? process.env.DATABASE_URL_PROD : process.env.DATABASE_URL;
if (!url) { console.error(prod ? "DATABASE_URL_PROD not set" : "DATABASE_URL not set"); process.exit(1); }

// A localhost DATABASE_URL is plain Postgres, which Neon's driver can't reach; node-postgres speaks to it.
const isLocal = (() => { try { const h = new URL(url).hostname; return h === "localhost" || h === "127.0.0.1"; } catch { return false; } })();
let run;
let end = async () => {};
if (isLocal) {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  run = (st) => client.query(st);
  end = () => client.end();
} else {
  const sql = neon(url);
  run = (st) => sql(st);
}
/** Statements end at a semicolon outside quotes, dollar-quoted blocks ($$ … $$, as in a DO block) and -- comments. */
function splitStatements(text) {
  const out = [];
  let cur = "";
  for (let i = 0; i < text.length; ) {
    const ch = text[i];
    if (ch === "-" && text[i + 1] === "-") {
      const nl = text.indexOf("\n", i);
      i = nl === -1 ? text.length : nl;
      continue;
    }
    if (ch === "'") {
      let j = i + 1;
      while (j < text.length && !(text[j] === "'" && text[j + 1] !== "'")) j += text[j] === "'" ? 2 : 1;
      cur += text.slice(i, j + 1);
      i = j + 1;
      continue;
    }
    const tag = /^\$[A-Za-z_]*\$/.exec(text.slice(i, i + 64));
    if (tag) {
      const close = text.indexOf(tag[0], i + tag[0].length);
      const j = close === -1 ? text.length : close + tag[0].length;
      cur += text.slice(i, j);
      i = j;
      continue;
    }
    if (ch === ";") {
      if (cur.trim()) out.push(cur.trim());
      cur = "";
      i++;
      continue;
    }
    cur += ch;
    i++;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}
const statements = splitStatements(readFileSync(file, "utf8"));

console.log(`${prod ? "PROD" : isLocal ? "local" : "dev"}: ${statements.length} statements from ${file}`);
for (const st of statements) {
  await run(st);
  console.log("  ok:", st.split("\n")[0].slice(0, 90));
}
await end();
console.log("done");
