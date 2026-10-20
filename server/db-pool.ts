/**
 * The one place that decides how the app reaches Postgres.
 *
 * Production and the hosted dev database are Neon, reached with Neon's serverless
 * driver over WebSockets. A LOCAL Postgres (owner, 2026-10-16: "Can you create a dev
 * database locally?", after the hosted dev endpoint was disabled; scripts/local-db.mjs)
 * speaks plain Postgres, which that driver can't, so a localhost DATABASE_URL gets
 * node-postgres instead. Both pools expose the same pg API (query / connect /
 * release) and both drizzle drivers return pg-shaped results, so nothing above
 * this file knows the difference; the exported types stay Neon's so the rest of
 * the server compiles unchanged.
 *
 * Naive timestamps are read as UTC under BOTH drivers, as the Neon fixes in db.ts
 * always did. Left to itself node-postgres reads them as laptop-local time, and
 * every pickup date would shift by the Pacific offset on the local database.
 */
import { Pool as NeonPool, neonConfig, types as neonTypes } from "@neondatabase/serverless";
import { drizzle as drizzleNeon, type NeonDatabase } from "drizzle-orm/neon-serverless";
import { drizzle as drizzleNodePg } from "drizzle-orm/node-postgres";
import pg from "pg";
import ws from "ws";
import * as schema from "../shared/schema";

// Configure WebSocket for Neon serverless driver in Node.js environment
neonConfig.webSocketConstructor = ws;

/** True when DATABASE_URL points at this machine: plain Postgres, not Neon. */
export const DB_IS_LOCAL = (() => {
  try {
    const host = new URL(process.env.DATABASE_URL ?? "").hostname;
    return host === "localhost" || host === "127.0.0.1" || host === "[::1]";
  } catch {
    return false;
  }
})();

// Fix 1: Neon driver bug — boolean values (OID 16) are incorrectly deserialized.
// The driver passes raw values that need explicit coercion to boolean.
const parseBoolean = (val: unknown) => val === true || val === 't' || val === 'true' || val === 1;

// Fix 2: Neon HTTP driver bug — timestamp values (OID 1114) returned as ISO strings
// with a 'Z' suffix (e.g., "2026-01-04T23:59:35.761423Z") are not handled by the
// default parser which expects PostgreSQL format ("2026-01-04 23:59:35.761423").
// This fix normalizes both formats and truncates microseconds to milliseconds.
// Fix 3: the same for timestamptz (OID 1184).
const parseTimestampAsUtc = (val: string | null) => {
  if (val === null || val === undefined) return null;
  const d = new Date(val.includes("T") ? val : val.replace(" ", "T") + "Z");
  return isNaN(d.getTime()) ? null : d;
};

// Neon bundles its own copy of pg-types, so both registries get the parsers.
type TypeRegistry = { setTypeParser: (oid: number, parser: (value: any) => unknown) => void };
for (const registry of [neonTypes, pg.types] as TypeRegistry[]) {
  registry.setTypeParser(16, parseBoolean);
  registry.setTypeParser(1114, parseTimestampAsUtc);
  registry.setTypeParser(1184, parseTimestampAsUtc);
}

/** A connection pool for DATABASE_URL, typed as Neon's: the two share pg's API. */
export function createPool(): NeonPool {
  const connectionString = process.env.DATABASE_URL!;
  if (DB_IS_LOCAL) {
    return new pg.Pool({ connectionString }) as unknown as NeonPool;
  }
  return new NeonPool({ connectionString });
}

/** Drizzle over that pool, with the driver the pool was made for. */
export function createDb(pool: NeonPool): NeonDatabase<typeof schema> {
  if (DB_IS_LOCAL) {
    return drizzleNodePg(pool as unknown as pg.Pool, { schema }) as unknown as NeonDatabase<typeof schema>;
  }
  return drizzleNeon(pool, { schema });
}
