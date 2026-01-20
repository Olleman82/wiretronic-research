import { NextResponse } from "next/server";
import { runResearchBatch, normalizePriceMode, normalizeReasoningEffort } from "@/lib/research";
import type { ResearchPayload } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const items = Array.isArray(body?.items) ? body.items : [];
    const apiKey = (body?.apiKey as string | undefined) ?? process.env.OPENAI_API_KEY;

    if (!apiKey) {
      return NextResponse.json({ error: "Saknar OpenAI API-nyckel." }, { status: 400 });
    }

    if (!items.length) {
      return NextResponse.json({ error: "Ingen data att bearbeta." }, { status: 400 });
    }

    const payload: ResearchPayload[] = items.map((item: ResearchPayload) => ({
      partNumber: String(item.partNumber ?? "").trim(),
      quantity: typeof item.quantity === "number" ? item.quantity : null,
      promptTemplate: String(item.promptTemplate ?? ""),
      reasoningEffort: normalizeReasoningEffort(item.reasoningEffort),
      priceMode: normalizePriceMode(item.priceMode)
    }));

    const results = await runResearchBatch(payload, apiKey);

    return NextResponse.json({ results });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Okänt fel";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
