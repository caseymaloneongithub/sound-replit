import { createPool, createDb } from "./db-pool";

// Which driver carries DATABASE_URL (Neon's serverless driver, or node-postgres for
// a local database) and the type parsers both share live in db-pool.ts.
const pool = createPool();
// Without this handler, Neon terminating an idle pooled connection (routine on
// serverless Postgres — "terminating connection due to administrator command")
// surfaces as an unhandled 'error' event and CRASHES the whole server. The pool
// discards the dead connection and opens a fresh one on the next query; all this
// handler needs to do is stop the process from dying.
pool.on('error', (err) => {
  console.warn(`[DB] Pooled connection error (recovered): ${err.message}`);
});
export const db = createDb(pool);
