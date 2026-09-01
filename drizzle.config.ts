import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  out: "./drizzle",
  schema: "./src/db/schema.ts",
  dbCredentials: {
    url: process.env["DATABASE_URL"] ?? "postgresql://flipwire:flipwire@localhost:5432/flipwire",
  },
  strict: true,
  verbose: true,
});

