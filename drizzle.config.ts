import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/lib/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    // Vercel's Neon integration names this POSTGRES_URL, not DATABASE_URL.
    url: process.env["POSTGRES_URL"] ?? "",
  },
});
