import { Client } from "pg";
import nextEnv from "@next/env";

const { loadEnvConfig } = nextEnv;

loadEnvConfig(process.cwd());

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  console.error("Missing DATABASE_URL. Add it to .env.local.");
  process.exit(1);
}

const client = new Client({
  connectionString: databaseUrl,
});

try {
  await client.connect();
  const result = await client.query("SELECT NOW() AS now");
  console.log(`Database connection OK. Server time: ${result.rows[0].now.toISOString()}`);
  process.exit(0);
} catch (error) {
  console.error("Database connection failed.");
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
} finally {
  await client.end().catch(() => undefined);
}
