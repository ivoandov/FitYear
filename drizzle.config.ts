import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });

import { defineConfig } from "drizzle-kit";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is required");
}

export default defineConfig({
  schema: "./src/lib/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL,
  },
  // Don't manage schemas Supabase owns
  schemaFilter: ["public"],
});
