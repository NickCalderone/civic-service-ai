import { NextResponse } from "next/server";

import { askCivicKnowledge } from "@/lib/civic-knowledge";

type AskRequest = {
  question?: string;
};

export async function POST(request: Request) {
  let body: AskRequest;

  try {
    body = (await request.json()) as AskRequest;
  } catch {
    return NextResponse.json(
      { error: "Request body must be valid JSON." },
      { status: 400 },
    );
  }

  const question = body.question?.trim();

  if (!question) {
    return NextResponse.json(
      { error: "A question is required." },
      { status: 400 },
    );
  }

  const result = await askCivicKnowledge(question);

  return NextResponse.json({
    disclaimer: "AI guidance only. This is not legal advice.",
    ...result,
  });
}
