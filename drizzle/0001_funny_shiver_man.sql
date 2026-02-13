CREATE TABLE "civic_documents" (
	"id" text PRIMARY KEY NOT NULL,
	"source_title" text NOT NULL,
	"source_url" text NOT NULL,
	"section" text NOT NULL,
	"tags" text[] NOT NULL,
	"content" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "civic_documents_source_section_unique" UNIQUE("source_url","section")
);
