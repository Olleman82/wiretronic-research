import { VENDOR_DOMAINS } from "@/lib/constants";
import type {
  PriceMode,
  ReasoningEffort,
  ResearchPayload,
  ResearchResult,
  UsageStats,
  VendorOffer,
  VendorOfferWithComputed
} from "@/lib/types";
import { getSekRateFor } from "@/lib/fx";

const DEFAULT_TIMEOUT_MS = 1000 * 60 * 8;
const OPENAI_API_URL = "https://api.openai.com/v1/responses";
const DEFAULT_MODEL = process.env.OPENAI_MODEL ?? "gpt-5";

const schema = {
  name: "part_research",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      partNumber: { type: "string" },
      quantity: { type: ["number", "null"] },
      vendors: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            vendor: { type: "string" },
            price: { type: "number" },
            currency: { type: "string" },
            leadTime: { type: "string" },
            stock: { type: "string" },
            link: { type: "string" },
            moq: { type: ["number", "null"] },
            priceBreaks: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: false,
                properties: {
                  qty: { type: "number" },
                  price: { type: "number" },
                  currency: { type: "string" }
                },
                required: ["qty", "price", "currency"]
              }
            }
          },
          required: ["vendor", "price", "currency", "leadTime", "stock", "link", "moq", "priceBreaks"]
        }
      },
      notes: { type: "array", items: { type: "string" } }
    },
    required: ["partNumber", "quantity", "vendors", "notes"]
  }
} as const;

export async function runResearchBatch(
  items: ResearchPayload[],
  apiKey: string,
  timeoutMs = DEFAULT_TIMEOUT_MS
): Promise<ResearchResult[]> {
  const results = await Promise.allSettled(
    items.map((item) => runResearch(item, apiKey, timeoutMs))
  );

  return results.map((result, index) => {
    if (result.status === "fulfilled") {
      return result.value;
    }

    return {
      partNumber: items[index]?.partNumber ?? "",
      quantity: items[index]?.quantity ?? null,
      best: null,
      vendors: [],
      notes: [],
      sources: [],
      errors: [result.reason?.message ?? "Okänt fel"].filter(Boolean)
    } satisfies ResearchResult;
  });
}

export async function runResearch(
  payload: ResearchPayload,
  apiKey: string,
  timeoutMs = DEFAULT_TIMEOUT_MS
): Promise<ResearchResult> {
  const { partNumber, quantity, promptTemplate, reasoningEffort, priceMode } = payload;
  const prompt = buildPrompt({ partNumber, quantity, promptTemplate, priceMode });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchWithRetry(
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: DEFAULT_MODEL,
          reasoning: { effort: reasoningEffort },
          tools: [
            {
              type: "web_search",
              filters: {
                allowed_domains: VENDOR_DOMAINS
              }
            }
          ],
          tool_choice: "auto",
          include: ["web_search_call.action.sources"],
          text: {
            format: {
              type: "json_schema",
              name: schema.name,
              schema: schema.schema,
              strict: schema.strict
            }
          },
          instructions: "Du är en inköpsassistent som alltid returnerar JSON enligt schema.",
          input: prompt
        }),
        signal: controller.signal
      },
      1
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`OpenAI error ${response.status}: ${errorText}`);
    }

    const data = await response.json();
    const parsed = parseStructuredOutput(data);
    const sources = extractSources(data);
    const usage = extractUsage(data);

    const vendors = await enrichVendors(parsed.vendors, quantity);
    const autoNotes = derivePricingNotes(vendors, quantity);
    const notes = sanitizeNotes(parsed.notes ?? []);
    const best = pickBest(vendors, quantity, priceMode);

    return {
      partNumber: parsed.partNumber || partNumber,
      quantity: parsed.quantity ?? quantity ?? null,
      best,
      vendors,
      notes: [...notes, ...autoNotes],
      sources,
      errors: [],
      usage
    };
  } finally {
    clearTimeout(timer);
  }
}

async function fetchWithRetry(
  init: RequestInit,
  retries: number
): Promise<Response> {
  let attempt = 0;
  let lastError: unknown = null;

  while (attempt <= retries) {
    try {
      const response = await fetch(OPENAI_API_URL, init);
      if (!response.ok && (response.status >= 500 || response.status === 429) && attempt < retries) {
        await delay(1000);
        attempt += 1;
        continue;
      }
      return response;
    } catch (error) {
      lastError = error;
      if (attempt >= retries) {
        throw error;
      }
      await delay(1000);
      attempt += 1;
    }
  }

  throw lastError instanceof Error ? lastError : new Error("Okänt fetch-fel");
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildPrompt({
  partNumber,
  quantity,
  promptTemplate,
  priceMode
}: {
  partNumber: string;
  quantity: number | null;
  promptTemplate: string;
  priceMode: PriceMode;
}): string {
  const qtyLine = quantity ? `Antal att köpa: ${quantity}` : "Antal att köpa: okänt";
  const priceModeLine =
    priceMode === "total"
      ? "Välj bästa leverantör baserat på lägsta totalpris för angivet antal."
      : "Välj bästa leverantör baserat på lägsta styckpris.";

  return [
    promptTemplate.trim(),
    "",
    "Artikel:",
    `Artikelnummer: ${partNumber}`,
    qtyLine,
    priceModeLine,
    "Returnera endast JSON enligt schema. Lista bara leverantörer som har artikeln i lager eller kan leverera med angiven ledtid.",
    "Priser ska vara exklusive moms och ange valuta med ISO-kod (t.ex. SEK, EUR, USD)."
  ].join("\n");
}

function parseStructuredOutput(data: unknown): {
  partNumber: string;
  quantity: number | null;
  vendors: VendorOffer[];
  notes: string[];
} {
  if (!data || typeof data !== "object") {
    throw new Error("Saknar data från OpenAI.");
  }

  const output = (data as { output?: Array<{ type: string; content?: Array<{ type: string; text?: string }> }> }).output ?? [];
  const message = output.find((item) => item.type === "message");
  const text = message?.content?.find((item) => item.type === "output_text")?.text ?? "";

  if (!text) {
    throw new Error("Tomt svar från OpenAI.");
  }

  return JSON.parse(text) as {
    partNumber: string;
    quantity: number | null;
    vendors: VendorOffer[];
    notes: string[];
  };
}

function extractSources(data: unknown): string[] {
  const output = (data as { output?: Array<{ type: string; action?: { sources?: Array<{ url?: string }> } }> }).output ?? [];
  const sources: string[] = [];

  for (const item of output) {
    if (item.type === "web_search_call") {
      const urls = item.action?.sources?.map((source) => source.url).filter(Boolean) as string[] | undefined;
      if (urls?.length) {
        sources.push(...urls);
      }
    }
  }

  return Array.from(new Set(sources));
}

function extractUsage(data: unknown): UsageStats | undefined {
  const usage = (data as { usage?: Record<string, unknown> }).usage;
  if (!usage) {
    return undefined;
  }

  const inputTokens = Number(usage.input_tokens ?? 0);
  const outputTokens = Number(usage.output_tokens ?? 0);
  const cachedInputTokens = Number(usage.cached_input_tokens ?? 0);
  const totalTokens = Number(usage.total_tokens ?? inputTokens + outputTokens);
  const webSearchCalls = countWebSearchCalls(data);

  return {
    inputTokens,
    outputTokens,
    cachedInputTokens,
    totalTokens,
    webSearchCalls
  };
}

function countWebSearchCalls(data: unknown): number {
  const output = (data as { output?: Array<{ type: string }> }).output ?? [];
  return output.filter((item) => item.type === "web_search_call").length;
}

async function enrichVendors(vendors: VendorOffer[], quantity: number | null): Promise<VendorOfferWithComputed[]> {
  const enriched: VendorOfferWithComputed[] = [];

  for (const vendor of vendors) {
    const rate = await getSekRateFor(vendor.currency);
    const priceSek = rate ? vendor.price * rate : null;
    const totalSek = quantity && priceSek ? priceSek * quantity : priceSek;

    const effective = computeEffectivePrice(vendor, quantity, rate);

    enriched.push({
      ...vendor,
      priceSek,
      totalSek,
      effectiveUnitSek: effective?.unit ?? priceSek,
      effectiveTotalSek: effective?.total ?? totalSek,
      leadTimeDays: estimateLeadTimeDays(vendor.leadTime)
    });
  }

  return enriched.sort((a, b) => {
    const aPrice = a.effectiveUnitSek ?? a.priceSek ?? Number.POSITIVE_INFINITY;
    const bPrice = b.effectiveUnitSek ?? b.priceSek ?? Number.POSITIVE_INFINITY;
    return aPrice - bPrice;
  });
}

function computeEffectivePrice(
  vendor: VendorOffer,
  quantity: number | null,
  rate: number | null
): { unit: number; total: number } | null {
  if (!quantity || !vendor.priceBreaks?.length || !rate) {
    return null;
  }

  const sorted = [...vendor.priceBreaks].sort((a, b) => a.qty - b.qty);
  const applicable = sorted.filter((tier) => tier.qty <= quantity).pop();
  const chosen = applicable ?? sorted[0];

  if (!chosen) {
    return null;
  }

  const unit = chosen.price * rate;
  return {
    unit,
    total: unit * quantity
  };
}

function derivePricingNotes(vendors: VendorOfferWithComputed[], quantity: number | null): string[] {
  if (!quantity) {
    return [];
  }

  const notes: string[] = [];

  for (const vendor of vendors) {
    if (!vendor.priceBreaks?.length || !vendor.effectiveUnitSek) {
      continue;
    }

    const sorted = [...vendor.priceBreaks].sort((a, b) => a.qty - b.qty);
    const current = sorted.filter((tier) => tier.qty <= quantity).pop();
    const next = sorted.find((tier) => tier.qty > quantity);
    if (!current || !next) {
      continue;
    }

    const rate = vendor.priceSek && vendor.price ? vendor.priceSek / vendor.price : null;
    if (!rate) {
      continue;
    }

    const currentTotal = current.price * rate * quantity;
    const nextTotal = next.price * rate * next.qty;
    if (nextTotal < currentTotal) {
      notes.push(
        `${vendor.vendor}: Prissteg vid ${next.qty} st ger lägre total (${Math.round(
          nextTotal
        )} SEK) än ${quantity} st (${Math.round(currentTotal)} SEK).`
      );
    }
  }

  return notes;
}

function sanitizeNotes(notes: string[]): string[] {
  return notes
    .map((note) => note.trim())
    .filter((note) => note.length > 0)
    .filter((note) => !/^https?:\/\//i.test(note))
    .map((note) => (note.length > 400 ? `${note.slice(0, 397)}...` : note))
    .slice(0, 6);
}

function pickBest(vendors: VendorOfferWithComputed[], quantity: number | null, priceMode: PriceMode): VendorOfferWithComputed | null {
  if (!vendors.length) {
    return null;
  }

  const sorted = [...vendors].sort((a, b) => {
    const aValue = selectPriceMetric(a, quantity, priceMode);
    const bValue = selectPriceMetric(b, quantity, priceMode);
    return aValue - bValue;
  });

  return sorted[0] ?? null;
}

function selectPriceMetric(vendor: VendorOfferWithComputed, quantity: number | null, priceMode: PriceMode): number {
  if (priceMode === "total") {
    return vendor.effectiveTotalSek ?? vendor.totalSek ?? Number.POSITIVE_INFINITY;
  }

  return vendor.effectiveUnitSek ?? vendor.priceSek ?? Number.POSITIVE_INFINITY;
}

function estimateLeadTimeDays(leadTime: string): number | null {
  const match = leadTime.match(/(\d+)\s*(day|days|dag|dagar|week|weeks|vecka|veckor)/i);
  if (!match) {
    return null;
  }

  const value = Number.parseInt(match[1], 10);
  if (!Number.isFinite(value)) {
    return null;
  }

  if (/week|veck/i.test(match[2])) {
    return value * 7;
  }

  return value;
}

export function normalizeReasoningEffort(input: string | null | undefined): ReasoningEffort {
  if (input === "minimal" || input === "low" || input === "medium" || input === "high") {
    return input;
  }

  return "medium";
}

export function normalizePriceMode(input: string | null | undefined): PriceMode {
  if (input === "unit" || input === "total") {
    return input;
  }

  return "total";
}
