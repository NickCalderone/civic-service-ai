import { Client } from "pg";
import nextEnv from "@next/env";

const { loadEnvConfig } = nextEnv;

loadEnvConfig(process.cwd());

const databaseUrl = process.env.DATABASE_URL;
const seedEmail = process.env.SEED_EMAIL ?? "demo@example.com";

if (!databaseUrl) {
  console.error("Missing DATABASE_URL. Add it to .env.local.");
  process.exit(1);
}

const client = new Client({
  connectionString: databaseUrl,
});

try {
  await client.connect();

  const result = await client.query(
    `
      INSERT INTO users (email)
      VALUES ($1)
      ON CONFLICT (email) DO NOTHING
      RETURNING id, email, created_at
    `,
    [seedEmail],
  );

  if (result.rowCount === 0) {
    console.log(`Seed skipped: user already exists (${seedEmail})`);
  } else {
    console.log("Seed inserted user:", result.rows[0]);
  }

  process.exit(0);
} catch (error) {
  console.error("Database seed failed.");
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
} finally {
  await client.end().catch(() => undefined);
}
