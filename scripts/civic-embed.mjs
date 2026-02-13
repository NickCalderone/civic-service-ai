import { Client } from "pg";
import nextEnv from "@next/env";

const { loadEnvConfig } = nextEnv;

loadEnvConfig(process.cwd());

const databaseUrl = process.env.DATABASE_URL;
const openAiApiKey = process.env.OPENAI_API_KEY;
const embeddingModel = process.env.EMBEDDING_MODEL ?? "text-embedding-3-small";

if (!databaseUrl) {
  console.error("Missing DATABASE_URL. Add it to .env.local.");
  process.exit(1);
}

if (!openAiApiKey) {
  console.error("Missing OPENAI_API_KEY. Add it to .env.local to backfill embeddings.");
  process.exit(1);
}

const force = process.argv.includes("--force");

const toVectorLiteral = (values) => `[${values.map((value) => Number(value).toFixed(8)).join(",")}]`;

const getTextEmbedding = async (input) => {
  const response = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${openAiApiKey}`,
    },
    body: JSON.stringify({
      model: embeddingModel,
      input,
    }),
  });

  if (!response.ok) {
    throw new Error(`Embedding request failed with status ${response.status}`);
  }

  const payload = await response.json();
  const embedding = payload?.data?.[0]?.embedding;

  if (!Array.isArray(embedding)) {
    throw new Error("Embedding response did not include a numeric vector.");
  }

  return embedding.filter((value) => typeof value === "number" && Number.isFinite(value));
};

const client = new Client({ connectionString: databaseUrl });

try {
  await client.connect();

  const query = force
    ? `
      SELECT id, section, tags, content
      FROM civic_documents
      ORDER BY id
    `
    : `
      SELECT id, section, tags, content
      FROM civic_documents
      WHERE embedding IS NULL
      ORDER BY id
    `;

  const { rows } = await client.query(query);

  for (const row of rows) {
    const embedding = await getTextEmbedding(
      `${row.section}\n${(row.tags ?? []).join(" ")}\n${row.content}`,
    );

    await client.query(
      `
        UPDATE civic_documents
        SET
          embedding = $2,
          embedding_model = $3,
          embedding_updated_at = NOW(),
          updated_at = NOW()
        WHERE id = $1
      `,
      [row.id, toVectorLiteral(embedding), embeddingModel],
    );
  }

  console.log(`Embedding backfill complete: ${rows.length} rows updated${force ? " (force mode)." : "."}`);
  process.exit(0);
} catch (error) {
  console.error("Civic embedding backfill failed.");
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
} finally {
  await client.end().catch(() => undefined);
}
