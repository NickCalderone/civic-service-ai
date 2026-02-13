CREATE EXTENSION IF NOT EXISTS vector;--> statement-breakpoint
ALTER TABLE "civic_documents" ADD COLUMN "embedding" text;--> statement-breakpoint
ALTER TABLE "civic_documents" ADD COLUMN "embedding_model" text;--> statement-breakpoint
ALTER TABLE "civic_documents" ADD COLUMN "embedding_updated_at" timestamp with time zone;