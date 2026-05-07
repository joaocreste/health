/**
 * Drizzle client factory for Cloudflare Workers.
 *
 * Uses @neondatabase/serverless's WebSocket driver — supports transactions
 * and prepared statements, unlike the HTTP variant. The driver runs in
 * Workers' standard runtime; no node_compat flag needed.
 *
 * Usage in _worker.js:
 *   import { getDb } from "../db/client";
 *   const db = getDb(env.DATABASE_URL);
 *   await db.select().from(users).where(...);
 */

import { neon, neonConfig, Pool } from "@neondatabase/serverless";
import { drizzle as drizzleHttp } from "drizzle-orm/neon-http";
import { drizzle as drizzlePool } from "drizzle-orm/neon-serverless";
import * as schema from "./schema";

// Disable fetchConnectionCache for short-lived Worker invocations.
neonConfig.fetchConnectionCache = true;

/* HTTP client — single statements, no transactions, lowest latency.
   Use for read-mostly handlers where one query per request is enough. */
export function getDb(dsn: string) {
  const sql = neon(dsn);
  return drizzleHttp(sql, { schema, casing: "snake_case" });
}

/* WebSocket-pooled client — supports transactions. Use when a single
   request needs multiple statements that must be atomic. */
export function getPooledDb(dsn: string) {
  const pool = new Pool({ connectionString: dsn });
  return drizzlePool(pool, { schema, casing: "snake_case" });
}

export { schema };
