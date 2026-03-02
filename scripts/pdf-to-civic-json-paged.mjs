import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const usage = `
Usage:
  node scripts/pdf-to-civic-json-paged.mjs <pdfPath> --title "Document Title" --url "https://source.url"

Options:
  --out <path>              Output JSON file path (default: data/civic-documents.json)
  --title <text>            Required source title
  --url <text>              Required source URL or canonical source reference
  --tags <csv>              Optional comma-separated tags (default: civic,policy)
  --id-prefix <text>        Optional ID prefix (default: slugified title)
  --chunk-words <number>    Words per chunk (default: 700)
  --overlap-words <number>  Overlap words between chunks (default: 120)
  --min-chars <number>      Skip chunks shorter than this many characters (default: 120)
  --replace                 Overwrite dataset file instead of appending

Examples:
  node scripts/pdf-to-civic-json-paged.mjs ./docs/permits.pdf --title "City Permit Guide" --url "https://city.gov/permits"
  node scripts/pdf-to-civic-json-paged.mjs ./docs/code.pdf --title "Municipal Code" --url "https://city.gov/code" --tags permits,zoning --chunk-words 600
`;

const parseArgs = (argv) => {
  const positionals = [];
  const flags = new Map();

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];

    if (!token.startsWith("--")) {
      positionals.push(token);
      continue;
    }

    const key = token.slice(2);

    if (key === "replace") {
      flags.set(key, "true");
      continue;
    }

    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      throw new Error(`Missing value for --${key}`);
    }

    flags.set(key, next);
    index += 1;
  }

  return {
    pdfPath: positionals[0],
    outPath: flags.get("out") ?? path.join("data", "civic-documents.json"),
    title: flags.get("title"),
    sourceUrl: flags.get("url"),
    tags: (flags.get("tags") ?? "civic,policy")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean),
    idPrefix: flags.get("id-prefix"),
    chunkWords: Number.parseInt(flags.get("chunk-words") ?? "700", 10),
    overlapWords: Number.parseInt(flags.get("overlap-words") ?? "120", 10),
    minChars: Number.parseInt(flags.get("min-chars") ?? "120", 10),
    replace: flags.has("replace"),
  };
};

const slugify = (value) =>
  value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);

const chunkByWords = (text, chunkWords, overlapWords) => {
  const words = text
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean);

  if (words.length === 0) {
    return [];
  }

  const chunks = [];
  const safeChunkWords = Number.isFinite(chunkWords) && chunkWords > 0 ? chunkWords : 700;
  const safeOverlap = Number.isFinite(overlapWords) && overlapWords >= 0 ? overlapWords : 120;
  const step = Math.max(1, safeChunkWords - Math.min(safeOverlap, safeChunkWords - 1));

  for (let start = 0; start < words.length; start += step) {
    const end = Math.min(start + safeChunkWords, words.length);
    const content = words.slice(start, end).join(" ").trim();

    if (!content) {
      continue;
    }

    chunks.push(content);

    if (end >= words.length) {
      break;
    }
  }

  return chunks;
};

const readExistingDataset = async (datasetPath) => {
  try {
    const raw = await readFile(datasetPath, "utf8");
    const parsed = JSON.parse(raw);

    if (!Array.isArray(parsed)) {
      throw new Error("Existing dataset is not an array.");
    }

    return parsed;
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return [];
    }

    throw error;
  }
};

const extractPages = async (pdfBuffer) => {
  const { default: pdfParse } = await import("pdf-parse");

  let pageCounter = 0;

  const pagerender = async (pageData) => {
    pageCounter += 1;

    const textContent = await pageData.getTextContent({
      normalizeWhitespace: true,
      disableCombineTextItems: false,
    });

    const pageText = textContent.items
      .map((item) => (typeof item.str === "string" ? item.str : ""))
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();

    return `[[[PAGE_${pageCounter}]]]\n${pageText}`;
  };

  const parsed = await pdfParse(pdfBuffer, { pagerender });

  const pageRegex = /\[\[\[PAGE_(\d+)\]\]\]\s*([\s\S]*?)(?=\[\[\[PAGE_\d+\]\]\]|$)/g;
  const pages = [];
  let match = pageRegex.exec(parsed.text ?? "");

  while (match) {
    const pageNumber = Number.parseInt(match[1], 10);
    const text = (match[2] ?? "").replace(/\s+/g, " ").trim();

    if (Number.isFinite(pageNumber) && text.length > 0) {
      pages.push({ pageNumber, text });
    }

    match = pageRegex.exec(parsed.text ?? "");
  }

  return pages;
};

const main = async () => {
  const args = parseArgs(process.argv.slice(2));

  if (!args.pdfPath || !args.title || !args.sourceUrl) {
    console.error(usage);
    process.exit(1);
  }

  if (args.chunkWords <= 0 || args.overlapWords < 0 || args.overlapWords >= args.chunkWords) {
    console.error("Invalid chunk configuration. Ensure chunk-words > overlap-words >= 0.");
    process.exit(1);
  }

  if (args.minChars < 0 || !Number.isFinite(args.minChars)) {
    console.error("Invalid min-chars configuration. Ensure min-chars >= 0.");
    process.exit(1);
  }

  const pdfAbsolutePath = path.resolve(process.cwd(), args.pdfPath);
  const outputAbsolutePath = path.resolve(process.cwd(), args.outPath);
  const pdfBuffer = await readFile(pdfAbsolutePath);

  const pages = await extractPages(pdfBuffer);

  if (pages.length === 0) {
    console.error("No page text extracted from PDF.");
    process.exit(1);
  }

  const idPrefix = slugify(args.idPrefix ?? args.title) || "document";

  const records = [];
  let skippedShortChunks = 0;

  for (const page of pages) {
    const chunks = chunkByWords(page.text, args.chunkWords, args.overlapWords);

    const eligibleChunks = chunks.filter((content) => content.length >= args.minChars);
    skippedShortChunks += chunks.length - eligibleChunks.length;

    eligibleChunks.forEach((content, index) => {
      records.push({
        id: `${idPrefix}-p${String(page.pageNumber).padStart(3, "0")}-c${String(index + 1).padStart(3, "0")}`,
        sourceTitle: args.title,
        sourceUrl: args.sourceUrl,
        section: `Page ${page.pageNumber} - Chunk ${index + 1}`,
        tags: args.tags,
        content,
      });
    });
  }

  if (records.length === 0) {
    console.error("No chunks produced from extracted page text.");
    process.exit(1);
  }

  const existing = args.replace ? [] : await readExistingDataset(outputAbsolutePath);
  const merged = [...existing, ...records];

  await writeFile(outputAbsolutePath, `${JSON.stringify(merged, null, 2)}\n`, "utf8");

  console.log(`PDF conversion complete: ${records.length} chunks written to ${args.outPath}${args.replace ? " (replace mode)." : "."} ${skippedShortChunks > 0 ? `${skippedShortChunks} short chunks skipped.` : ""}`.trim());
};

main().catch((error) => {
  console.error("PDF conversion failed.");
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
