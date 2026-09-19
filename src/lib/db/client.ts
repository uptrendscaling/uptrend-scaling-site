import { drizzle } from "drizzle-orm/neon-http";
import { neon } from "@neondatabase/serverless";

import * as schema from "./schema";

// Vercel's Neon marketplace integration writes the connection string as
// POSTGRES_URL (not the raw DATABASE_URL Neon itself uses) -- this is the
// pooled, serverless-friendly connection string.
const CONNECTION_ENV_VAR = "POSTGRES_URL";

let cached: ReturnType<typeof drizzle<typeof schema>> | undefined;

export function isDbConfigured(): boolean {
  return Boolean(process.env[CONNECTION_ENV_VAR]);
}

// Lazily creates the DB client on first use, same dormant-until-configured
// pattern as the Stripe integration: the app builds and runs fine with no
// POSTGRES_URL set, and every call site is expected to check
// isDbConfigured() first and fail gracefully rather than crash.
export function getDb() {
  if (cached) return cached;

  const url = process.env[CONNECTION_ENV_VAR];
  if (!url) {
    throw new Error("POSTGRES_URL is not set. Call isDbConfigured() before getDb().");
  }

  const sql = neon(url);
  cached = drizzle({ client: sql, schema });
  return cached;
}
