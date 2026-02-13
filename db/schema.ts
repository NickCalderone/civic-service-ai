import { pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";

export const users = pgTable("users", {
  id: uuid("id").defaultRandom().primaryKey(),
  email: text("email").notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const civicDocuments = pgTable(
  "civic_documents",
  {
    id: text("id").primaryKey(),
    sourceTitle: text("source_title").notNull(),
    sourceUrl: text("source_url").notNull(),
    section: text("section").notNull(),
    tags: text("tags").array().notNull(),
    content: text("content").notNull(),
    embedding: text("embedding"),
    embeddingModel: text("embedding_model"),
    embeddingUpdatedAt: timestamp("embedding_updated_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    sourceSectionUnique: unique("civic_documents_source_section_unique").on(
      table.sourceUrl,
      table.section,
    ),
  }),
);
