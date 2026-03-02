import { db, pool } from "@/db";
import { civicDocuments } from "@/db/schema";
import {
  generateGroundedAnswer,
  type GroundingChunk,
} from "@/lib/answer-generation";
import { getTextEmbedding, toVectorLiteral } from "@/lib/embeddings";
import { retrieveWebGrounding } from "@/lib/web-retrieval";

export type CivicCitation = {
  sourceTitle: string;
  sourceUrl: string;
  section: string;
  excerpt: string;
  sourceType: "local" | "web";
};

export type AskResult = {
  answer: string;
  confidence: "low" | "medium" | "high";
  retrievalMode: "semantic" | "keyword-fallback";
  webSourcesUsed: boolean;
  citations: CivicCitation[];
};

type CivicSection = {
  id: string;
  sourceTitle: string;
  sourceUrl: string;
  section: string;
  tags: string[];
  content: string;
};

type RankedSection = {
  section: CivicSection;
  score: number;
};

type LocalRetrieval = {
  chunks: GroundingChunk[];
  confidence: AskResult["confidence"];
  retrievalMode: AskResult["retrievalMode"];
};

const STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "by",
  "for",
  "from",
  "how",
  "i",
  "if",
  "in",
  "is",
  "it",
  "me",
  "my",
  "of",
  "on",
  "or",
  "the",
  "to",
  "what",
  "when",
  "where",
  "who",
  "why",
  "with",
  "you",
]);

const cleanToken = (value: string): string =>
  value.toLowerCase().replace(/[^a-z0-9]/g, "");

const tokenize = (text: string): string[] =>
  text
    .split(/\s+/)
    .map(cleanToken)
    .filter((token) => token.length > 2 && !STOP_WORDS.has(token));

const countMatches = (tokens: string[], text: string): number => {
  const haystack = text.toLowerCase();
  return tokens.reduce((score, token) => {
    if (!haystack.includes(token)) {
      return score;
    }
    return score + 1;
  }, 0);
};

const scoreSection = (questionTokens: string[], section: CivicSection): number => {
  const tagText = section.tags.join(" ").toLowerCase();
  const baseText = `${section.section} ${section.content}`.toLowerCase();

  const tagMatches = countMatches(questionTokens, tagText) * 2;
  const textMatches = countMatches(questionTokens, baseText);

  return tagMatches + textMatches;
};

const confidenceFromScore = (score: number): AskResult["confidence"] => {
  if (score >= 8) {
    return "high";
  }
  if (score >= 4) {
    return "medium";
  }
  return "low";
};

const confidenceFromDistance = (distance: number): AskResult["confidence"] => {
  if (distance <= 0.22) {
    return "high";
  }
  if (distance <= 0.35) {
    return "medium";
  }
  return "low";
};

const loadCivicSections = async (): Promise<CivicSection[]> => {
  const rows = await db.select().from(civicDocuments);

  return rows.map((row) => ({
    id: row.id,
    sourceTitle: row.sourceTitle,
    sourceUrl: row.sourceUrl,
    section: row.section,
    tags: row.tags,
    content: row.content,
  }));
};

const rankWithKeywords = (
  sections: CivicSection[],
  question: string,
): RankedSection[] => {
  const questionTokens = tokenize(question);

  return sections
    .map((section) => ({
      section,
      score: scoreSection(questionTokens, section),
    }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score)
    .slice(0, 3);
};

const rankWithVectors = async (
  question: string,
): Promise<Array<{ section: CivicSection; distance: number }> | null> => {
  const embedding = await getTextEmbedding(question);

  if (!embedding) {
    return null;
  }

  const vector = toVectorLiteral(embedding);

  try {
    const result = await pool.query<{
      id: string;
      source_title: string;
      source_url: string;
      section: string;
      tags: string[];
      content: string;
      distance: number;
    }>(
      `
        SELECT
          id,
          source_title,
          source_url,
          section,
          tags,
          content,
          (embedding::vector <=> $1::vector) AS distance
        FROM civic_documents
        WHERE embedding IS NOT NULL
        ORDER BY embedding::vector <=> $1::vector ASC
        LIMIT 3
      `,
      [vector],
    );

    if (result.rowCount === 0) {
      return null;
    }

    return result.rows.map((row) => ({
      section: {
        id: row.id,
        sourceTitle: row.source_title,
        sourceUrl: row.source_url,
        section: row.section,
        tags: row.tags,
        content: row.content,
      },
      distance: Number(row.distance),
    }));
  } catch {
    return null;
  }
};

const toCitation = (chunk: GroundingChunk): CivicCitation => ({
  sourceTitle: chunk.sourceTitle,
  sourceUrl: chunk.sourceUrl,
  section: chunk.section,
  excerpt: chunk.content,
  sourceType: chunk.sourceType,
});

const toLocalChunk = (
  section: CivicSection,
  id: string,
): GroundingChunk => ({
  id,
  sourceType: "local",
  sourceTitle: section.sourceTitle,
  sourceUrl: section.sourceUrl,
  section: section.section,
  content: section.content,
});

const retrieveLocalGrounding = async (
  question: string,
): Promise<LocalRetrieval> => {
  const vectorRanked = await rankWithVectors(question);

  if (vectorRanked && vectorRanked.length > 0) {
    const bestDistance = vectorRanked[0]?.distance ?? 1;

    return {
      chunks: vectorRanked.map(({ section }, index) =>
        toLocalChunk(section, `local-semantic-${index + 1}`),
      ),
      confidence: confidenceFromDistance(bestDistance),
      retrievalMode: "semantic",
    };
  }

  const sections = await loadCivicSections();
  const ranked = rankWithKeywords(sections, question);

  if (ranked.length === 0) {
    return {
      chunks: [],
      confidence: "low",
      retrievalMode: "keyword-fallback",
    };
  }

  const combinedScore = ranked.reduce((total, entry) => total + entry.score, 0);

  return {
    chunks: ranked.map(({ section }, index) =>
      toLocalChunk(section, `local-keyword-${index + 1}`),
    ),
    confidence: confidenceFromScore(combinedScore),
    retrievalMode: "keyword-fallback",
  };
};

export const askCivicKnowledge = async (question: string): Promise<AskResult> => {
  const [local, webChunks] = await Promise.all([
    retrieveLocalGrounding(question),
    retrieveWebGrounding(question),
  ]);

  const webSourcesUsed = webChunks.length > 0;

  const allChunks = [...local.chunks, ...webChunks].slice(0, 6);

  if (allChunks.length === 0) {
    return {
      answer:
        "I could not find a strong local-code or approved web-source match. Try adding details like permit type, project scope, tenant issue, or business type.",
      confidence: "low",
      retrievalMode: "keyword-fallback",
      webSourcesUsed,
      citations: [],
    };
  }

  const generated = await generateGroundedAnswer(question, allChunks);

  if (!generated) {
    return {
      answer: allChunks
        .map((chunk) => `${chunk.section}: ${chunk.content}`)
        .join(" "),
      confidence: local.confidence,
      retrievalMode: local.retrievalMode,
      webSourcesUsed,
      citations: allChunks.map(toCitation),
    };
  }

  const chunkById = new Map(allChunks.map((chunk) => [chunk.id, chunk]));

  const generatedCitations = generated.citationIds
    .map((id) => chunkById.get(id))
    .filter((chunk): chunk is GroundingChunk => chunk !== undefined)
    .map(toCitation);

  const hasWebCitation = generatedCitations.some((citation) => citation.sourceType === "web");

  const citations = (() => {
    if (generatedCitations.length === 0) {
      return allChunks.map(toCitation);
    }

    if (!webSourcesUsed || hasWebCitation) {
      return generatedCitations;
    }

    const firstWebChunk = webChunks[0];

    if (!firstWebChunk) {
      return generatedCitations;
    }

    return [...generatedCitations, toCitation(firstWebChunk)];
  })();

  return {
    answer: generated.answer,
    confidence: generated.confidence,
    retrievalMode: local.retrievalMode,
    webSourcesUsed,
    citations,
  };
};
