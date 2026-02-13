"use client";

import { FormEvent, useState } from "react";

type Citation = {
  sourceTitle: string;
  sourceUrl: string;
  section: string;
  excerpt: string;
};

type AskResponse = {
  answer: string;
  confidence: "low" | "medium" | "high";
  retrievalMode: "semantic" | "keyword-fallback";
  citations: Citation[];
  disclaimer: string;
  error?: string;
};

export default function Home() {
  const [question, setQuestion] = useState("");
  const [result, setResult] = useState<AskResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!question.trim()) {
      setError("Please enter a question first.");
      return;
    }

    setError(null);
    setIsLoading(true);

    try {
      const response = await fetch("/api/ask", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ question }),
      });

      const payload = (await response.json()) as AskResponse;

      if (!response.ok) {
        setError(payload.error ?? "Something went wrong while getting an answer.");
        setResult(null);
        return;
      }

      setResult(payload);
    } catch {
      setError("Could not reach the AI service. Please try again.");
      setResult(null);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      <main className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-6 py-10">
        <header className="space-y-2">
          <p className="text-sm font-medium">Civic Service AI</p>
          <h1 className="text-3xl font-semibold tracking-tight">
            Learn local code with grounded answers
          </h1>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            Ask about permits, zoning, tenant protections, or business rules and get an
            answer with citations.
          </p>
        </header>

        <form onSubmit={onSubmit} className="space-y-3 rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
          <label htmlFor="question" className="text-sm font-medium">
            Your question
          </label>
          <textarea
            id="question"
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            rows={4}
            className="w-full rounded-lg border border-zinc-300 bg-transparent px-3 py-2 text-sm outline-none focus:border-zinc-500 dark:border-zinc-700"
            placeholder="Do I need a permit to convert my garage into an ADU?"
          />
          <button
            type="submit"
            disabled={isLoading}
            className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium disabled:opacity-60 dark:border-zinc-700"
          >
            {isLoading ? "Thinking..." : "Ask Civic AI"}
          </button>
          {error ? <p className="text-sm text-red-600 dark:text-red-400">{error}</p> : null}
        </form>

        {result ? (
          <section className="space-y-4 rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
            <div className="flex items-center justify-between gap-4">
              <h2 className="text-lg font-semibold">Answer</h2>
              <div className="text-right text-xs uppercase tracking-wide text-zinc-600 dark:text-zinc-400">
                <p>Confidence: {result.confidence}</p>
                <div className="mt-1 flex justify-end">
                  <button
                    type="button"
                    title={
                      result.retrievalMode === "semantic"
                        ? "Semantic mode uses embeddings and vector similarity over civic documents."
                        : "Fallback mode uses keyword scoring when semantic retrieval is unavailable."
                    }
                    className="cursor-help rounded-full border border-zinc-300 px-2 py-0.5 text-[10px] font-semibold tracking-wide dark:border-zinc-700"
                  >
                    {result.retrievalMode === "semantic" ? "Semantic" : "Fallback"}
                  </button>
                </div>
              </div>
            </div>
            <p className="text-sm leading-6">{result.answer}</p>
            <p className="text-xs text-zinc-600 dark:text-zinc-400">{result.disclaimer}</p>

            <div className="space-y-2">
              <h3 className="text-sm font-semibold">Sources</h3>
              {result.citations.length === 0 ? (
                <p className="text-sm text-zinc-600 dark:text-zinc-400">
                  No matching citations found in the local dataset.
                </p>
              ) : (
                <ul className="space-y-2">
                  {result.citations.map((citation) => (
                    <li key={`${citation.sourceTitle}-${citation.section}`} className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
                      <p className="text-sm font-medium">{citation.section}</p>
                      <a
                        href={citation.sourceUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="text-sm underline"
                      >
                        {citation.sourceTitle}
                      </a>
                      <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
                        {citation.excerpt}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>
        ) : null}
      </main>
    </div>
  );
}
