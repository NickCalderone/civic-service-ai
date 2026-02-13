const DEFAULT_EMBEDDING_MODEL = "text-embedding-3-small";

const toFiniteNumbers = (value: unknown): number[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter(
    (entry): entry is number => typeof entry === "number" && Number.isFinite(entry),
  );
};

export const getEmbeddingModel = (): string =>
  process.env.EMBEDDING_MODEL ?? DEFAULT_EMBEDDING_MODEL;

export const getTextEmbedding = async (input: string): Promise<number[] | null> => {
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    return null;
  }

  const response = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: getEmbeddingModel(),
      input,
    }),
  });

  if (!response.ok) {
    return null;
  }

  const payload = (await response.json()) as {
    data?: Array<{ embedding?: unknown }>;
  };

  const embedding = toFiniteNumbers(payload.data?.[0]?.embedding);
  return embedding.length > 0 ? embedding : null;
};

export const toVectorLiteral = (values: number[]): string =>
  `[${values.map((value) => value.toFixed(8)).join(",")}]`;
