export type AnswerConfidence = "low" | "medium" | "high";

export type GroundingChunk = {
  id: string;
  sourceTitle: string;
  sourceUrl: string;
  section: string;
  content: string;
  sourceType: "local" | "web";
};

export type GeneratedGroundedAnswer = {
  answer: string;
  confidence: AnswerConfidence;
  citationIds: string[];
};

const DEFAULT_CHAT_MODEL = "gpt-4.1-mini";

const toTrimmedString = (value: unknown): string =>
  typeof value === "string" ? value.trim() : "";

const toConfidence = (value: unknown): AnswerConfidence => {
  if (value === "high" || value === "medium" || value === "low") {
    return value;
  }

  return "low";
};

const toCitationIds = (value: unknown, validIds: Set<string>): string[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  const unique = new Set<string>();

  for (const item of value) {
    if (typeof item !== "string") {
      continue;
    }

    const id = item.trim();

    if (!id || !validIds.has(id)) {
      continue;
    }

    unique.add(id);
  }

  return Array.from(unique);
};

const safeJsonParse = (value: string): unknown => {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
};

const buildContextBlock = (chunks: GroundingChunk[]): string =>
  chunks
    .map((chunk) => {
      const excerpt = chunk.content.length > 900
        ? `${chunk.content.slice(0, 900)}...`
        : chunk.content;

      return [
        `ID: ${chunk.id}`,
        `TYPE: ${chunk.sourceType}`,
        `TITLE: ${chunk.sourceTitle}`,
        `URL: ${chunk.sourceUrl}`,
        `SECTION: ${chunk.section}`,
        `EXCERPT: ${excerpt}`,
      ].join("\n");
    })
    .join("\n\n---\n\n");

export const generateGroundedAnswer = async (
  question: string,
  chunks: GroundingChunk[],
): Promise<GeneratedGroundedAnswer | null> => {
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey || chunks.length === 0) {
    return null;
  }

  const model = process.env.CHAT_MODEL ?? DEFAULT_CHAT_MODEL;
  const validIds = new Set(chunks.map((chunk) => chunk.id));

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "grounded_civic_answer",
          strict: true,
          schema: {
            type: "object",
            properties: {
              answer: { type: "string" },
              confidence: {
                type: "string",
                enum: ["low", "medium", "high"],
              },
              citationIds: {
                type: "array",
                items: { type: "string" },
              },
            },
            required: ["answer", "confidence", "citationIds"],
            additionalProperties: false,
          },
        },
      },
      messages: [
        {
          role: "system",
          content:
            "You are a civic policy assistant. Use only the provided context. Never claim facts not present in context. Return JSON only.",
        },
        {
          role: "user",
          content: [
            `Question:\n${question}`,
            "Context chunks:\n",
            buildContextBlock(chunks),
            "\nInstructions:\n- Provide a direct answer grounded only in context.\n- Keep answer under 180 words.\n- Include only citation IDs that directly support your answer.\n- If context is insufficient, state that clearly and set confidence to low.",
          ].join("\n\n"),
        },
      ],
    }),
  });

  if (!response.ok) {
    return null;
  }

  const payload = (await response.json()) as {
    choices?: Array<{ message?: { content?: string | null } }>;
  };

  const rawContent = payload.choices?.[0]?.message?.content;

  if (typeof rawContent !== "string" || !rawContent.trim()) {
    return null;
  }

  const parsed = safeJsonParse(rawContent) as {
    answer?: unknown;
    confidence?: unknown;
    citationIds?: unknown;
  } | null;

  if (!parsed) {
    return null;
  }

  const answer = toTrimmedString(parsed.answer);

  if (!answer) {
    return null;
  }

  return {
    answer,
    confidence: toConfidence(parsed.confidence),
    citationIds: toCitationIds(parsed.citationIds, validIds),
  };
};
