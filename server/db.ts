import { neon, types } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "../shared/schema";

// Fix 1: Neon HTTP driver v0.10.4 bug — boolean values (OID 16) are incorrectly
// deserialized. The driver passes the raw value (true/false/"t"/"f") to the parser
// but the default handler converts it wrong. This override ensures correct behavior.
types.setTypeParser(16, (val: unknown) => {
  return val === true || val === 't' || val === 'true' || val === 1;
});

// Fix 2: Neon HTTP gateway returns `"rows": null` (instead of `"rows": []`) for
// SELECT queries that return 0 rows. The driver then calls `.map()` on null and
// crashes. We patch globalThis.fetch to rewrite null rows to an empty array before
// the driver sees the response.
const _originalFetch = globalThis.fetch;
globalThis.fetch = async function patchedFetch(
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<Response> {
  const response = await _originalFetch(input, init);
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : (input as Request).url;
  if (url && (url.includes(".neon.tech") || url.includes("neondb.io") || url.includes("/sql"))) {
    const text = await response.text();
    const patched = text.includes('"rows":null')
      ? text.replace('"rows":null', '"rows":[]')
      : text;
    return new Response(patched, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  }
  return response;
} as typeof fetch;

const sql = neon(process.env.DATABASE_URL!);
export const db = drizzle(sql, { schema });
