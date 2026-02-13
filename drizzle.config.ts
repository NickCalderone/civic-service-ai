import { createRequire } from "node:module";
import { defineConfig } from "drizzle-kit";
import "dotenv/config";

const require = createRequire(import.meta.url);
const { loadEnvConfig } = require("@next/env");
loadEnvConfig(process.cwd());

if (!process.env.DATABASE_URL) {
  throw new Error("Missing DATABASE_URL in environment");
}

export default defineConfig({
  dialect: "postgresql",
  schema: "./db/schema.ts",
  out: "./drizzle",
  dbCredentials: {
    url: process.env.DATABASE_URL,
  },
});
