This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

## Local Verification

Create your local env file first:

```bash
cp .env.example .env.local
```

Use these commands to confirm local services are healthy:

```bash
# Start local Postgres (first time or after reboot)
docker compose up -d db

# Check Postgres connectivity from app env (.env.local)
npm run db:check

# Start Next.js dev server
npm run dev
```

Expected results:

- `npm run db:check` exits with code `0` and prints `Database connection OK...`
- `npm run dev` starts without lock/workspace-root warnings and serves on `http://localhost:3000`

## Drizzle ORM

This project is configured with Drizzle for PostgreSQL.

```bash
# Generate SQL migrations from schema changes
npm run db:generate

# Apply migrations to the local database
npm run db:migrate

# Seed sample data (idempotent)
npm run db:seed

# Ingest civic code/policy documents into civic_documents
npm run db:ingest:civic

# Convert a PDF into data/civic-documents.json entries
npm run data:pdf -- ./docs/your-document.pdf --title "Your Document Title" --url "https://example.gov/your-document"
# Add --min-chars 180 to skip short header/footer fragments

# Convert a PDF with page-aware sections (e.g., "Page 12 - Chunk 2")
npm run data:pdf:paged -- ./docs/your-document.pdf --title "Your Document Title" --url "https://example.gov/your-document"
# Add --min-chars 180 to keep only substantive chunks

# Backfill embeddings for existing rows (requires OPENAI_API_KEY)
npm run db:embed:civic

# Open Drizzle Studio
npm run db:studio
```

Key files:

- `db/schema.ts` for table definitions
- `db/index.ts` for the typed DB client
- `drizzle.config.ts` for Drizzle Kit configuration
- `drizzle/` for generated SQL migrations

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Civic Service AI MVP

The app now includes a first-pass civic assistant flow:

- Ask a local policy/code question from the home page.
- Receive a grounded answer with confidence level and source citations.
- See a legal disclaimer for safe use.

### API

`POST /api/ask`

Request body:

```json
{
	"question": "Do I need a permit to remodel my kitchen?"
}
```

Response shape:

```json
{
	"answer": "...",
	"confidence": "low | medium | high",
	"citations": [
		{
			"sourceTitle": "...",
			"sourceUrl": "...",
			"section": "...",
			"excerpt": "..."
		}
	],
	"disclaimer": "AI guidance only. This is not legal advice."
}
```

Current retrieval is Postgres-backed through `civic_documents` and ranked in `lib/civic-knowledge.ts`.
The ingest source dataset is `data/civic-documents.json` and is loaded into Postgres via `scripts/civic-ingest.mjs`.
You can generate dataset entries from a PDF with `scripts/pdf-to-civic-json.mjs` (or `npm run data:pdf -- ...`) and then ingest them.
For citation traceability, use `scripts/pdf-to-civic-json-paged.mjs` (or `npm run data:pdf:paged -- ...`) to include page numbers in each record section.
When `OPENAI_API_KEY` is configured, embeddings are generated and semantic top-k retrieval is used via pgvector distance.
If embeddings are not available, the service gracefully falls back to keyword scoring.

The assistant now uses a first-pass hybrid pipeline:

- Local retrieval from `civic_documents` (semantic or keyword fallback)
- Optional web retrieval from strict URL-prefix allowlist (`WEB_ALLOWLIST_URL_PREFIXES`, default `https://codes.iccsafe.org/content/IBC2015`)
- Primary-source ranking boost via `WEB_PRIMARY_SOURCES` (default `codes.iccsafe.org`)
- Grounded answer synthesis with `CHAT_MODEL` (default `gpt-4.1-mini`) and citation IDs

If generation is unavailable, the service falls back to concatenated retrieved passages.

Mode indicator shown in the UI:

- `Semantic`: embeddings + pgvector similarity were used.
- `Fallback`: keyword scoring was used because semantic retrieval was unavailable.

### Resume Highlights

- Built a civic policy assistant with a Next.js frontend and typed API route for grounded Q&A.
- Implemented RAG retrieval over Postgres with pgvector, including semantic top-k search and fallback keyword ranking.
- Designed ingestion and embedding pipelines (`db:ingest:civic`, `db:embed:civic`) with idempotent upserts.
- Added source citations, confidence, and retrieval-mode transparency (`Semantic` vs `Fallback`) for safer AI UX.
- Created reproducible local setup with Dockerized Postgres, Drizzle migrations, and lint-verified code quality.

## Secrets Hygiene

- Keep real secrets only in `.env.local` and never commit that file.
- Use `.env.example` as the template for required variables with blank placeholders.
- Do not paste API keys in terminal commands that may be shared in screenshots, logs, or chat.
- If a key is exposed, rotate it immediately in the provider dashboard and update `.env.local`.
- Prefer redacted values (`sk-***`) when discussing keys or troubleshooting with others.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
