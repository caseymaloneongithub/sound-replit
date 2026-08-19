import { Pool, neonConfig, types } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import ws from "ws";
import * as schema from "../shared/schema";

// Configure WebSocket for Neon serverless driver in Node.js environment
neonConfig.webSocketConstructor = ws;

// Fix 1: Neon driver bug — boolean values (OID 16) are incorrectly deserialized.
// The driver passes raw values that need explicit coercion to boolean.
types.setTypeParser(16, (val: unknown) => {
  return val === true || val === 't' || val === 'true' || val === 1;
});

// Fix 2: Neon HTTP driver bug — timestamp values (OID 1114) returned as ISO strings
// with a 'Z' suffix (e.g., "2026-01-04T23:59:35.761423Z") are not handled by the
// default parser which expects PostgreSQL format ("2026-01-04 23:59:35.761423").
// This fix normalizes both formats and truncates microseconds to milliseconds.
types.setTypeParser(1114, (val: string | null) => {
  if (val === null || val === undefined) return null;
  const d = new Date(val.includes("T") ? val : val.replace(" ", "T") + "Z");
  return isNaN(d.getTime()) ? null : d;
});

// Fix 3: Same issue for timestamptz (OID 1184).
types.setTypeParser(1184, (val: string | null) => {
  if (val === null || val === undefined) return null;
  const d = new Date(val.includes("T") ? val : val.replace(" ", "T") + "Z");
  return isNaN(d.getTime()) ? null : d;
});

const pool = new Pool({ connectionString: process.env.DATABASE_URL! });
export const db = drizzle(pool, { schema });
