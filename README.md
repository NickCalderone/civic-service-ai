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

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
