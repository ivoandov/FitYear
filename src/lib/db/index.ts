import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is not set");
}

// Serverless-tuned pool. `prepare: false` is required for Supabase's poolers
// (no server-side prepared statements). `connect_timeout` makes a slow/blocked
// connection fail fast (~10s) instead of hanging the function to its
// maxDuration and surfacing as a generic 500. `idle_timeout` reaps idle
// connections so short-lived serverless invocations don't accumulate open
// connections against the pooler (a cause of intermittent connection-exhaustion
// errors under concurrency). `max` is capped low because each function instance
// serves one request at a time — a large per-instance pool just multiplies
// pressure on the shared pooler.
const client = postgres(process.env.DATABASE_URL, {
  prepare: false,
  max: 5,
  idle_timeout: 20,
  connect_timeout: 10,
});
export const db = drizzle(client, { schema });
export { schema };
