import { readFile } from "node:fs/promises";
import path from "node:path";

import { Client } from "pg";
import nextEnv from "@next/env";

const { loadEnvConfig } = nextEnv;

loadEnvConfig(process.cwd());

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  console.error("Missing DATABASE_URL. Add it to .env.local.");
  process.exit(1);
}

const datasetPath = path.join(process.cwd(), "data", "civic-documents.json");
const embeddingModel = process.env.EMBEDDING_MODEL ?? "text-embedding-3-small";
const openAiApiKey = process.env.OPENAI_API_KEY;

/**
 * @typedef {Object} CivicDocument
 * @property {string} id
 * @property {string} sourceTitle
 * @property {string} sourceUrl
 * @property {string} section
 * @property {string[]} tags
 * @property {string} content
 */

/** @returns {Promise<CivicDocument[]>} */
const loadDataset = async () => {
  const raw = await readFile(datasetPath, "utf8");
  const parsed = JSON.parse(raw);

  if (!Array.isArray(parsed)) {
    throw new Error("Dataset must be an array");
  }

  return parsed;
};

const toVectorLiteral = (values) => `[${values.map((value) => Number(value).toFixed(8)).join(",")}]`;

const getTextEmbedding = async (input) => {
  if (!openAiApiKey) {
    return null;
  }

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
    return null;
  }

  const payload = await response.json();
  const embedding = payload?.data?.[0]?.embedding;

  if (!Array.isArray(embedding)) {
    return null;
  }

  return embedding.filter((value) => typeof value === "number" && Number.isFinite(value));
};

const client = new Client({
  connectionString: databaseUrl,
});

try {
  const records = await loadDataset();
  await client.connect();

  for (const record of records) {
    const embedding = await getTextEmbedding(
      `${record.section}\n${record.tags.join(" ")}\n${record.content}`,
    );

    await client.query(
      `
        INSERT INTO civic_documents (
          id,
          source_title,
          source_url,
          section,
          tags,
          content,
          embedding,
          embedding_model,
          embedding_updated_at,
          updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7::text, $8::text, CASE WHEN $7::text IS NULL THEN NULL ELSE NOW() END, NOW())
        ON CONFLICT (id)
        DO UPDATE SET
          source_title = EXCLUDED.source_title,
          source_url = EXCLUDED.source_url,
          section = EXCLUDED.section,
          tags = EXCLUDED.tags,
          content = EXCLUDED.content,
          embedding = COALESCE(EXCLUDED.embedding, civic_documents.embedding),
          embedding_model = COALESCE(EXCLUDED.embedding_model, civic_documents.embedding_model),
          embedding_updated_at = COALESCE(EXCLUDED.embedding_updated_at, civic_documents.embedding_updated_at),
          updated_at = NOW()
      `,
      [
        record.id,
        record.sourceTitle,
        record.sourceUrl,
        record.section,
        record.tags,
        record.content,
        embedding ? toVectorLiteral(embedding) : null,
        embedding ? embeddingModel : null,
      ],
    );
  }

  console.log(
    `Ingest complete: ${records.length} civic documents upserted.${openAiApiKey ? " Embeddings generated." : " OPENAI_API_KEY not set; embeddings skipped."}`,
  );
  process.exit(0);
} catch (error) {
  console.error("Civic document ingest failed.");
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
} finally {
  await client.end().catch(() => undefined);
}
