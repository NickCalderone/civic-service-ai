import { getTextEmbedding } from "@/lib/embeddings";

import type { GroundingChunk } from "@/lib/answer-generation";

type SearchCandidate = {
  title: string;
  url: string;
};

type WebPage = {
  title: string;
  paragraphs: string[];
};

type WebChunkCandidate = {
  chunk: GroundingChunk;
  lexicalScore: number;
  phraseScore: number;
  sourcePriorityBoost: number;
};

type IccSearchResponse = {
  success?: boolean;
  data?: Array<{
    documentId?: number;
    contentId?: number;
    sectionTitle?: string;
    sectionTitleClean?: string;
    highlighted?: {
      sectionTitle?: string;
      sectionTitleClean?: string;
    };
  }>;
};

const DEFAULT_PRIMARY_SOURCES: string[] = [];
const DEFAULT_URL_PREFIX_ALLOWLIST = ["https://codes.iccsafe.org/content/IBC2015"];

const WEB_RESULT_LIMIT = 4;
const FETCH_TIMEOUT_MS = 7000;
const CHUNK_TARGET_CHARS = 1000;
const CHUNK_MAX_CHARS = 1250;
const CHUNK_OVERLAP_CHARS = 200;
const MIN_PARAGRAPH_CHARS = 45;
const MAX_EMBED_CHUNKS = 16;
const PRIMARY_SOURCE_BOOST = 0.2;
const ICC_SEARCH_LIMIT = 4;
const IBC_2015_CHAPTER_SLUGS: Record<number, string> = {
  1: "scope-and-administration",
  2: "definitions",
  3: "use-and-occupancy-classification",
  4: "special-detailed-requirements-based-on-use-and-occupancy",
  5: "general-building-heights-and-areas",
  6: "types-of-construction",
  7: "fire-and-smoke-protection-features",
  8: "interior-finishes",
  9: "fire-protection-systems",
  10: "means-of-egress",
  11: "accessibility",
  12: "interior-environment",
  13: "energy-efficiency",
  14: "exterior-walls",
  15: "roof-assemblies-and-rooftop-structures",
  16: "structural-design",
  17: "structural-tests-and-special-inspections",
  18: "soils-and-foundations",
  19: "concrete",
  20: "aluminum",
  21: "masonry",
  22: "steel",
  23: "wood",
  24: "glass-and-glazing",
  25: "gypsum-board-and-plaster",
  26: "plastic",
  27: "electrical",
  28: "mechanical-systems",
  29: "plumbing-systems",
  30: "elevators-and-conveying-systems",
  31: "special-construction",
  32: "encroachments-into-the-public-right-of-way",
  33: "safeguards-during-construction",
  34: "existing-structures",
  35: "referenced-standards",
};
const IBC_CHAPTER_INTENT_KEYWORDS: Record<number, string[]> = {
  1: ["scope", "administration"],
  2: ["definition", "definitions", "defined term", "glossary"],
  3: ["occupancy", "occupancy classification", "use classification"],
  4: ["special detailed", "special requirements", "hazardous materials", "covered mall", "high-rise", "atrium"],
  5: ["height", "area", "allowable area", "building height"],
  6: ["construction type", "types of construction", "type i", "type ii", "type iii", "type iv", "type v"],
  7: ["fire resistance", "fire barrier", "smoke barrier", "fire wall", "smoke partition"],
  8: ["interior finish", "finish classification", "flame spread"],
  9: ["fire protection", "sprinkler", "standpipe", "alarm"],
  10: ["egress", "means of egress", "exit", "exit access", "egress width"],
  11: ["accessibility", "accessible", "ada"],
  12: ["interior environment", "ventilation", "temperature", "lighting"],
  13: ["energy efficiency", "energy"],
  14: ["exterior wall", "facade", "veneer", "weather protection"],
  15: ["roof", "rooftop structure", "roof assembly"],
  16: ["structural design", "loads", "seismic", "wind load", "snow load"],
  17: ["special inspection", "structural test"],
  18: ["soil", "foundation", "footing", "geotechnical"],
  19: ["concrete", "reinforced concrete", "prestressed"],
  20: ["aluminum"],
  21: ["masonry", "cmu", "brick"],
  22: ["steel", "structural steel"],
  23: ["wood", "timber", "framing"],
  24: ["glass", "glazing"],
  25: ["gypsum", "plaster", "drywall"],
  26: ["plastic", "foam plastic"],
  27: ["electrical", "wiring", "circuit", "panel", "branch circuit"],
  28: ["mechanical", "hvac", "duct", "equipment"],
  29: ["plumbing", "fixture", "pipe", "drainage"],
  30: ["elevator", "conveying system", "escalator"],
  31: ["special construction", "membrane structure", "temporary structure"],
  32: ["encroachment", "right-of-way", "public way"],
  33: ["safeguards during construction", "construction safety", "site safety"],
  34: ["existing structure", "existing building", "alteration"],
  35: ["referenced standards", "standards"],
};
const ICC_QUERY_STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "by",
  "definition",
  "do",
  "for",
  "from",
  "how",
  "i",
  "if",
  "in",
  "information",
  "is",
  "it",
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
]);

const PHRASE_BOOSTS = [
  "international building code",
  "2015 international building code",
  "ibc",
  "adopted",
  "code standard",
  "building code",
];

const decodeHtmlEntities = (value: string): string =>
  value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCharCode(Number(code)));

const normalizeText = (value: string): string =>
  decodeHtmlEntities(value).replace(/\s+/g, " ").trim();

const stripNonContentTags = (html: string): string =>
  html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<svg[\s\S]*?<\/svg>/gi, " ")
    .replace(/<template[\s\S]*?<\/template>/gi, " ")
    .replace(/<(nav|header|footer|aside|form)[^>]*>[\s\S]*?<\/\1>/gi, " ");

const extractBodyHtml = (html: string): string => {
  const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  const bodyHtml = bodyMatch?.[1] ?? html;
  const cleanedBody = stripNonContentTags(bodyHtml);

  const primaryMatch = cleanedBody.match(/<(main|article)[^>]*>([\s\S]*?)<\/\1>/i);

  if (primaryMatch?.[2]) {
    return primaryMatch[2];
  }

  return cleanedBody;
};

const splitLongParagraph = (paragraph: string): string[] => {
  if (paragraph.length <= CHUNK_TARGET_CHARS) {
    return [paragraph];
  }

  const sentences = paragraph
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 0);

  if (sentences.length <= 1) {
    const chunks: string[] = [];

    for (let index = 0; index < paragraph.length; index += CHUNK_TARGET_CHARS) {
      const part = paragraph.slice(index, index + CHUNK_TARGET_CHARS).trim();

      if (part.length > 0) {
        chunks.push(part);
      }
    }

    return chunks;
  }

  const parts: string[] = [];
  let current = "";

  for (const sentence of sentences) {
    const next = current ? `${current} ${sentence}` : sentence;

    if (next.length <= CHUNK_TARGET_CHARS) {
      current = next;
      continue;
    }

    if (current) {
      parts.push(current);
    }

    current = sentence;
  }

  if (current) {
    parts.push(current);
  }

  return parts;
};

const extractParagraphsFromBodyHtml = (bodyHtml: string): string[] => {
  const withBreaks = bodyHtml
    .replace(/<(br|\/p|\/li|\/h[1-6]|\/section|\/article|\/div|\/tr|\/dd|\/dt)>/gi, "\n")
    .replace(/<(p|li|h[1-6]|section|article|div|tr|dd|dt)[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, " ");

  const paragraphs = withBreaks
    .split(/\n+/)
    .map(normalizeText)
    .filter((paragraph) => paragraph.length >= MIN_PARAGRAPH_CHARS)
    .flatMap(splitLongParagraph);

  const deduped: string[] = [];
  const seen = new Set<string>();

  for (const paragraph of paragraphs) {
    const key = paragraph.toLowerCase();

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    deduped.push(paragraph);
  }

  return deduped;
};

const overlapTail = (value: string, maxChars: number): string => {
  if (value.length <= maxChars) {
    return value;
  }

  const slice = value.slice(value.length - maxChars);
  const firstSpace = slice.indexOf(" ");

  if (firstSpace === -1) {
    return slice;
  }

  return slice.slice(firstSpace + 1).trim();
};

const buildChunksFromParagraphs = (paragraphs: string[]): string[] => {
  if (paragraphs.length === 0) {
    return [];
  }

  const chunks: string[] = [];
  let current = "";

  for (const paragraph of paragraphs) {
    const next = current ? `${current}\n\n${paragraph}` : paragraph;

    if (next.length <= CHUNK_MAX_CHARS) {
      current = next;
      continue;
    }

    if (current) {
      chunks.push(current.trim());
      const overlap = overlapTail(current, CHUNK_OVERLAP_CHARS);
      current = overlap ? `${overlap}\n\n${paragraph}` : paragraph;
    } else {
      chunks.push(paragraph.slice(0, CHUNK_MAX_CHARS));
      current = paragraph.slice(CHUNK_MAX_CHARS - CHUNK_OVERLAP_CHARS);
    }
  }

  if (current.trim()) {
    chunks.push(current.trim());
  }

  return chunks;
};

const extractTitle = (html: string, fallback: string): string => {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);

  if (!match?.[1]) {
    return fallback;
  }

  const cleaned = decodeHtmlEntities(match[1]).replace(/\s+/g, " ").trim();
  return cleaned || fallback;
};

const parseUrlPrefixAllowlist = (): string[] => {
  const raw = process.env.WEB_ALLOWLIST_URL_PREFIXES?.trim();

  if (!raw) {
    return DEFAULT_URL_PREFIX_ALLOWLIST;
  }

  return raw
    .split(",")
    .map((value) => value.trim())
    .filter((value) => value.length > 0)
    .map((value) => {
      try {
        return new URL(value).toString();
      } catch {
        return "";
      }
    })
    .filter((value) => value.length > 0);
};

const parsePrimarySources = (): string[] => {
  const raw = process.env.WEB_PRIMARY_SOURCES?.trim();

  if (!raw) {
    return DEFAULT_PRIMARY_SOURCES;
  }

  return raw
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter((value) => value.length > 0);
};

const hostMatches = (hostname: string, allowlistEntry: string): boolean => {
  const normalizedEntry = allowlistEntry.replace(/^https?:\/\//, "").replace(/^\./, "");

  if (!normalizedEntry) {
    return false;
  }

  return hostname === normalizedEntry || hostname.endsWith(`.${normalizedEntry}`);
};

const normalizeUrlForPrefixMatch = (url: string): string => {
  try {
    const parsed = new URL(url);

    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return "";
    }

    parsed.hash = "";
    return parsed.toString();
  } catch {
    return "";
  }
};

const isAllowedByUrlPrefix = (url: string, prefixes: string[]): boolean => {
  if (prefixes.length === 0) {
    return true;
  }

  const normalizedUrl = normalizeUrlForPrefixMatch(url);

  if (!normalizedUrl) {
    return false;
  }

  return prefixes.some((prefix) => {
    const normalizedPrefix = normalizeUrlForPrefixMatch(prefix);

    if (!normalizedPrefix) {
      return false;
    }

    return normalizedUrl === normalizedPrefix || normalizedUrl.startsWith(`${normalizedPrefix}/`);
  });
};

const isPrimarySourceUrl = (url: string, primarySources: string[]): boolean => {
  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname.toLowerCase();
    return primarySources.some((entry) => hostMatches(hostname, entry));
  } catch {
    return false;
  }
};

const unwrapDuckDuckGoRedirect = (rawUrl: string): string | null => {
  try {
    const resolvedUrl = rawUrl.startsWith("//") ? `https:${rawUrl}` : rawUrl;
    const parsed = new URL(resolvedUrl);

    if (parsed.hostname.includes("duckduckgo.com")) {
      const redirected = parsed.searchParams.get("uddg");

      if (redirected) {
        return decodeURIComponent(redirected);
      }
    }

    return resolvedUrl;
  } catch {
    return null;
  }
};

const stripHtmlTags = (value: string): string =>
  value.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

const tokenizeIccQuery = (value: string): string[] =>
  value
    .toLowerCase()
    .split(/\s+/)
    .map((token) => token.replace(/[^a-z0-9]/g, ""))
    .filter((token) => token.length > 2 && !ICC_QUERY_STOP_WORDS.has(token));

const normalizeSectionReference = (value: string): string =>
  value.toLowerCase().replace(/[^0-9.a-z]/g, "").replace(/\.+/g, ".").replace(/^\.|\.$/g, "");

const inferQuestionSectionHints = (question: string): string[] => {
  const matches = question.match(/(?:section\s*)?(\d{1,5}(?:\.\d+){1,4}[a-zA-Z]?)/gi) ?? [];
  const hints = matches
    .map((match) => {
      const capture = match.match(/\d{1,5}(?:\.\d+){1,4}[a-zA-Z]?/i)?.[0] ?? "";
      return normalizeSectionReference(capture);
    })
    .filter((value) => value.length > 0);

  return Array.from(new Set(hints));
};

const getEntrySectionReference = (sectionTitle: string): string | null => {
  const capture = sectionTitle.match(/\d{1,5}(?:\.\d+){1,4}[a-zA-Z]?/i)?.[0] ?? "";

  if (!capture) {
    return null;
  }

  const normalized = normalizeSectionReference(capture);
  return normalized.length > 0 ? normalized : null;
};

const sectionReferenceMatches = (entrySection: string | null, hints: string[]): boolean => {
  if (!entrySection || hints.length === 0) {
    return false;
  }

  return hints.some((hint) => {
    if (entrySection === hint) {
      return true;
    }

    return entrySection.startsWith(`${hint}.`) || hint.startsWith(`${entrySection}.`);
  });
};

const inferQuestionChapterHints = (question: string): number[] => {
  const normalized = question.toLowerCase();
  const hints = new Set<number>();

  const chapterMentions = normalized.match(/chapter\s*(\d{1,2})/g) ?? [];

  for (const mention of chapterMentions) {
    const numberMatch = mention.match(/\d{1,2}/)?.[0] ?? "";
    const chapter = Number(numberMatch);

    if (Number.isFinite(chapter) && chapter >= 1 && chapter <= 35) {
      hints.add(chapter);
    }
  }

  if (normalized.includes("egress") || normalized.includes("exit") || normalized.includes("means of egress")) {
    hints.add(10);
  }

  if (normalized.includes("accessibility") || normalized.includes("ada")) {
    hints.add(11);
  }

  if (normalized.includes("fire") || normalized.includes("sprinkler") || normalized.includes("alarm")) {
    hints.add(9);
  }

  if (normalized.includes("definitions") || normalized.includes("define") || normalized.includes("definition")) {
    hints.add(2);
  }

  if (
    normalized.includes("electrical") ||
    normalized.includes("wiring") ||
    normalized.includes("circuit") ||
    normalized.includes("panel")
  ) {
    hints.add(27);
  }

  for (const [chapterKey, keywordList] of Object.entries(IBC_CHAPTER_INTENT_KEYWORDS)) {
    const chapter = Number(chapterKey);

    if (!Number.isFinite(chapter)) {
      continue;
    }

    if (keywordList.some((keyword) => normalized.includes(keyword))) {
      hints.add(chapter);
    }
  }

  return Array.from(hints);
};

const getChapterHintQueries = (chapter: number): string[] => {
  const slug = IBC_2015_CHAPTER_SLUGS[chapter] ?? "";
  const chapterTitle = slug.replace(/-/g, " ").trim();
  const queries = [`chapter ${chapter}`];

  if (chapterTitle.length > 0) {
    queries.push(`chapter ${chapter} ${chapterTitle}`);
    queries.push(chapterTitle);
  }

  if (chapter === 10) {
    queries.push("means of egress");
  }

  if (chapter === 27) {
    queries.push("electrical systems");
  }

  return queries;
};

const getSectionHintQueries = (sectionHints: string[]): string[] =>
  sectionHints.flatMap((section) => [`section ${section}`, section]);

const getIccIbcPrefix = (prefixes: string[]): string | null => {
  for (const prefix of prefixes) {
    try {
      const parsed = new URL(prefix);
      if (
        parsed.hostname === "codes.iccsafe.org" &&
        parsed.pathname.toLowerCase().startsWith("/content/ibc2015")
      ) {
        return prefix;
      }
    } catch {
      continue;
    }
  }

  return null;
};

const inferIbcChapterNumber = (sectionTitle: string): number | null => {
  const firstNumber = sectionTitle.match(/\d+/)?.[0] ?? "";

  if (!firstNumber) {
    return null;
  }

  for (let chapter = 35; chapter >= 1; chapter -= 1) {
    const prefix = String(chapter);
    if (
      firstNumber.startsWith(prefix) &&
      firstNumber.length - prefix.length >= 2 &&
      IBC_2015_CHAPTER_SLUGS[chapter]
    ) {
      return chapter;
    }
  }

  const direct = Number(firstNumber);
  if (Number.isFinite(direct) && direct >= 1 && direct <= 35 && IBC_2015_CHAPTER_SLUGS[direct]) {
    return direct;
  }

  return null;
};

const buildIccSectionUrl = (
  ibcPrefix: string,
  sectionTitle: string,
  fallbackChapter: number | null,
): string => {
  try {
    const chapter = inferIbcChapterNumber(sectionTitle) ?? fallbackChapter;
    const base = new URL(ibcPrefix);

    if (!chapter) {
      return base.toString();
    }

    const slug = IBC_2015_CHAPTER_SLUGS[chapter];
    return `${base.origin}${base.pathname.replace(/\/$/, "")}/chapter-${chapter}-${slug}`;
  } catch {
    return ibcPrefix;
  }
};

const retrieveIccApiGrounding = async (
  question: string,
  urlPrefixAllowlist: string[],
): Promise<GroundingChunk[]> => {
  const ibcPrefix = getIccIbcPrefix(urlPrefixAllowlist);

  if (!ibcPrefix) {
    return [];
  }

  const significantTokens = tokenizeIccQuery(question);
  const sectionHints = inferQuestionSectionHints(question);
  const chapterHints = inferQuestionChapterHints(question);

  if (sectionHints.length > 0) {
    const sectionBasedChapters = sectionHints
      .map((section) => inferIbcChapterNumber(section))
      .filter((chapter): chapter is number => chapter !== null);

    if (sectionBasedChapters.length > 0) {
      for (const chapter of sectionBasedChapters) {
        if (!chapterHints.includes(chapter)) {
          chapterHints.push(chapter);
        }
      }
    }
  }

  const keywordQuery = significantTokens.join(" ").trim();
  const sectionHintQueries = getSectionHintQueries(sectionHints);
  const hintQueries = chapterHints.flatMap(getChapterHintQueries);
  const queryCandidates = Array.from(
    new Set([
      question.trim(),
      keywordQuery,
      ...sectionHintQueries,
      ...hintQueries,
    ].filter((value) => value.length > 0)),
  );

  try {
    const allEntries: NonNullable<IccSearchResponse["data"]> = [];

    for (const query of queryCandidates) {
      const endpoint = `https://codes.iccsafe.org/api/search/content?query=${encodeURIComponent(query)}`;
      const response = await fetch(endpoint, {
        headers: {
          "User-Agent": "Mozilla/5.0 CivicServiceAI/1.0",
        },
      });

      if (!response.ok) {
        continue;
      }

      const payload = (await response.json()) as IccSearchResponse;

      if (!payload.success || !Array.isArray(payload.data) || payload.data.length === 0) {
        continue;
      }

      allEntries.push(...payload.data);
    }

    if (allEntries.length === 0) {
      return [];
    }

    const dedupedEntries = allEntries.filter((entry, index, array) => {
      const key = `${entry.contentId ?? "none"}-${entry.sectionTitle ?? ""}`;
      return array.findIndex((candidate) => `${candidate.contentId ?? "none"}-${candidate.sectionTitle ?? ""}` === key) === index;
    });

    const tokenFilteredEntries = significantTokens.length === 0
      ? dedupedEntries
      : dedupedEntries.filter((entry) => {
          const haystack = [
            entry.sectionTitle ?? "",
            entry.sectionTitleClean ?? "",
            stripHtmlTags(entry.highlighted?.sectionTitle ?? ""),
            stripHtmlTags(entry.highlighted?.sectionTitleClean ?? ""),
          ]
            .join(" ")
            .toLowerCase();

          return significantTokens.some((token) => haystack.includes(token));
        });

    const hintCompatibleEntries = chapterHints.length === 0
      ? tokenFilteredEntries
      : tokenFilteredEntries.filter((entry) => {
          const chapter = inferIbcChapterNumber(entry.sectionTitle ?? "");
          if (chapter === null) {
            return true;
          }

          return chapterHints.includes(chapter);
        });

    const chapterFilteredEntries = chapterHints.length === 0
      ? hintCompatibleEntries
      : hintCompatibleEntries.filter((entry) => {
          const chapter = inferIbcChapterNumber(entry.sectionTitle ?? "");
          return chapter !== null && chapterHints.includes(chapter);
        });

    const sectionFilteredEntries = sectionHints.length === 0
      ? chapterFilteredEntries
      : chapterFilteredEntries.filter((entry) =>
          sectionReferenceMatches(getEntrySectionReference(entry.sectionTitle ?? ""), sectionHints),
        );

    if (sectionHints.length > 0 && sectionFilteredEntries.length === 0) {
      return [];
    }

    const filteredEntries = sectionFilteredEntries.length > 0
      ? sectionFilteredEntries
      : chapterFilteredEntries.length > 0
        ? chapterFilteredEntries
        : hintCompatibleEntries;

    if (filteredEntries.length === 0) {
      return [];
    }

    const fallbackChapter = sectionHints
      .map((section) => inferIbcChapterNumber(section))
      .find((chapter): chapter is number => chapter !== null) ?? chapterHints[0] ?? null;

    const results = filteredEntries
      .slice(0, ICC_SEARCH_LIMIT)
      .map((entry, index) => {
        const rawSection = (entry.sectionTitle ?? "").trim();
        const section = (entry.sectionTitleClean ?? rawSection).trim();
        const highlightedTitle = stripHtmlTags(entry.highlighted?.sectionTitle ?? "");
        const highlightedClean = stripHtmlTags(entry.highlighted?.sectionTitleClean ?? "");
        const content = [highlightedTitle, highlightedClean]
          .filter((value) => value.length > 0)
          .join(" — ");

        if (!section && !content) {
          return null;
        }

        return {
          id: normalizeChunkId(`web-icc-${entry.contentId ?? index + 1}-${section || "section"}`),
          sourceType: "web" as const,
          sourceTitle: "2015 International Building Code (ICC)",
          sourceUrl: buildIccSectionUrl(
            ibcPrefix,
            rawSection || section || content,
            fallbackChapter,
          ),
          section: section || `ICC result ${index + 1}`,
          content: content || section,
        };
      })
      .filter((chunk) => chunk !== null) as GroundingChunk[];

    return results;
  } catch {
    return [];
  }
};

const searchDuckDuckGo = async (
  question: string,
  primarySources: string[],
  urlPrefixAllowlist: string[],
): Promise<SearchCandidate[]> => {
  const urlPrefixSites = urlPrefixAllowlist
    .map((prefix) => {
      try {
        const parsed = new URL(prefix);
        return parsed.hostname;
      } catch {
        return "";
      }
    })
    .filter((host) => host.length > 0);

  const siteEntries = [...primarySources, ...urlPrefixSites];
  const siteQuery = Array.from(new Set(siteEntries)).map((entry) => {
    const host = entry.replace(/^\./, "");
    return `site:${host}`;
  });

  const query = `${question} ${siteQuery.join(" OR ")}`.trim();
  const searchUrl = `https://duckduckgo.com/html/?q=${encodeURIComponent(query)}`;

  const response = await fetch(searchUrl, {
    headers: {
      "User-Agent": "Mozilla/5.0 CivicServiceAI/1.0",
    },
  });

  if (!response.ok) {
    return [];
  }

  const html = await response.text();
  const linkRegex = /<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;

  const seen = new Set<string>();
  const candidates: SearchCandidate[] = [];

  let match = linkRegex.exec(html);

  while (match && candidates.length < WEB_RESULT_LIMIT * 3) {
    const href = match[1] ?? "";
    const titleRaw = match[2] ?? "";
    const unwrapped = unwrapDuckDuckGoRedirect(href);

    if (
      unwrapped &&
      isAllowedByUrlPrefix(unwrapped, urlPrefixAllowlist) &&
      !seen.has(unwrapped)
    ) {
      seen.add(unwrapped);
      candidates.push({
        title: decodeHtmlEntities(titleRaw.replace(/<[^>]+>/g, " ")).trim() || unwrapped,
        url: unwrapped,
      });
    }

    match = linkRegex.exec(html);
  }

  return candidates.slice(0, WEB_RESULT_LIMIT);
};

const fetchPageText = async (
  url: string,
): Promise<WebPage | null> => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 CivicServiceAI/1.0",
      },
      signal: controller.signal,
    });

    if (!response.ok) {
      return null;
    }

    const html = await response.text();
    const fallbackTitle = (() => {
      try {
        return new URL(url).hostname;
      } catch {
        return url;
      }
    })();

    const title = extractTitle(html, fallbackTitle);
    const bodyHtml = extractBodyHtml(html);
    const paragraphs = extractParagraphsFromBodyHtml(bodyHtml);

    if (paragraphs.length === 0) {
      return null;
    }

    return {
      title,
      paragraphs,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
};

const tokenize = (text: string): string[] =>
  text
    .toLowerCase()
    .split(/\s+/)
    .map((token) => token.replace(/[^a-z0-9]/g, ""))
    .filter((token) => token.length > 2);

const keywordScore = (questionTokens: string[], content: string): number => {
  if (questionTokens.length === 0) {
    return 0;
  }

  const haystack = content.toLowerCase();

  let matches = 0;

  for (const token of questionTokens) {
    if (haystack.includes(token)) {
      matches += 1;
    }
  }

  return matches / questionTokens.length;
};

const phraseBoostScore = (content: string): number => {
  const haystack = content.toLowerCase();

  let matches = 0;

  for (const phrase of PHRASE_BOOSTS) {
    if (haystack.includes(phrase)) {
      matches += 1;
    }
  }

  if (matches === 0) {
    return 0;
  }

  return Math.min(1, matches / 3);
};

const cosineSimilarity = (left: number[], right: number[]): number => {
  if (left.length !== right.length || left.length === 0) {
    return 0;
  }

  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;

  for (let index = 0; index < left.length; index += 1) {
    const leftValue = left[index] ?? 0;
    const rightValue = right[index] ?? 0;
    dot += leftValue * rightValue;
    leftNorm += leftValue * leftValue;
    rightNorm += rightValue * rightValue;
  }

  const denominator = Math.sqrt(leftNorm) * Math.sqrt(rightNorm);
  return denominator > 0 ? dot / denominator : 0;
};

const toGroundingChunkCandidates = (
  pages: Array<{ candidate: SearchCandidate; page: WebPage }>,
  questionTokens: string[],
  primarySources: string[],
): WebChunkCandidate[] => {
  const results: WebChunkCandidate[] = [];

  for (const { candidate, page } of pages) {
    const chunks = buildChunksFromParagraphs(page.paragraphs);

    chunks.forEach((content, index) => {
      const lexicalScore = keywordScore(questionTokens, content);
      const phraseScore = phraseBoostScore(content);
      const sourcePriorityBoost = isPrimarySourceUrl(candidate.url, primarySources)
        ? PRIMARY_SOURCE_BOOST
        : 0;

      results.push({
        chunk: {
          id: `web-${candidate.url}-${index + 1}`,
          sourceType: "web",
          sourceTitle: page.title || candidate.title,
          sourceUrl: candidate.url,
          section: `Web source chunk ${index + 1}`,
          content,
        },
        lexicalScore,
        phraseScore,
        sourcePriorityBoost,
      });
    });
  }

  return results;
};

const normalizeChunkId = (value: string): string =>
  value.replace(/[^a-z0-9-]/gi, "-").replace(/-+/g, "-").slice(0, 140);

export const retrieveWebGrounding = async (
  question: string,
): Promise<GroundingChunk[]> => {
  const urlPrefixAllowlist = parseUrlPrefixAllowlist();
  const primarySources = parsePrimarySources();

  const iccChunks = await retrieveIccApiGrounding(question, urlPrefixAllowlist);

  if (iccChunks.length > 0) {
    return iccChunks;
  }

  const candidates = await searchDuckDuckGo(
    question,
    primarySources,
    urlPrefixAllowlist,
  );

  if (candidates.length === 0) {
    return [];
  }

  const pages = await Promise.all(
    candidates.map(async (candidate) => {
      const page = await fetchPageText(candidate.url);

      if (!page) {
        return null;
      }

      return {
        candidate,
        page,
      };
    }),
  );

  const usablePages = pages.filter(
    (entry): entry is { candidate: SearchCandidate; page: WebPage } =>
      entry !== null,
  );

  if (usablePages.length === 0) {
    return [];
  }

  const questionTokens = Array.from(new Set(tokenize(question)));
  const chunkCandidates = toGroundingChunkCandidates(
    usablePages,
    questionTokens,
    primarySources,
  );

  if (chunkCandidates.length === 0) {
    return [];
  }

  const lexicalRanked = [...chunkCandidates].sort((left, right) => {
    const leftScore = left.lexicalScore + left.phraseScore * 0.3 + left.sourcePriorityBoost;
    const rightScore = right.lexicalScore + right.phraseScore * 0.3 + right.sourcePriorityBoost;
    return rightScore - leftScore;
  });

  const queryEmbedding = await getTextEmbedding(question);

  const scoreByChunkId = new Map<string, number>();

  for (const candidate of lexicalRanked) {
    const baseScore = queryEmbedding
      ? 0.3 * candidate.lexicalScore + 0.05 * candidate.phraseScore + candidate.sourcePriorityBoost
      : 0.85 * candidate.lexicalScore + 0.15 * candidate.phraseScore + candidate.sourcePriorityBoost;

    scoreByChunkId.set(candidate.chunk.id, baseScore);
  }

  if (queryEmbedding) {
    const embedCandidates = lexicalRanked.slice(0, MAX_EMBED_CHUNKS);

    await Promise.all(
      embedCandidates.map(async (candidate) => {
        const embedding = await getTextEmbedding(
          `${candidate.chunk.sourceTitle}\n${candidate.chunk.section}\n${candidate.chunk.content}`,
        );

        if (!embedding || embedding.length !== queryEmbedding.length) {
          return;
        }

        const semanticScore = cosineSimilarity(queryEmbedding, embedding);
        const hybridScore =
          0.65 * semanticScore +
          0.3 * candidate.lexicalScore +
          0.05 * candidate.phraseScore +
          candidate.sourcePriorityBoost;

        scoreByChunkId.set(candidate.chunk.id, hybridScore);
      }),
    );
  }

  return lexicalRanked
    .sort(
      (left, right) =>
        (scoreByChunkId.get(right.chunk.id) ?? 0) -
        (scoreByChunkId.get(left.chunk.id) ?? 0),
    )
    .slice(0, WEB_RESULT_LIMIT)
    .map(({ chunk }, index) => ({
      ...chunk,
      id: normalizeChunkId(`web-${index + 1}-${chunk.sourceUrl}-${chunk.section}`),
    }));
};
