export type PriceMode = "total" | "unit";
export type ReasoningEffort = "minimal" | "low" | "medium" | "high";

export type VendorOffer = {
  vendor: string;
  price: number;
  currency: string;
  leadTime: string;
  stock: string;
  link: string;
  moq: number | null;
  priceBreaks: Array<{
    qty: number;
    price: number;
    currency: string;
  }>;
};

export type ResearchPayload = {
  partNumber: string;
  quantity: number | null;
  promptTemplate: string;
  reasoningEffort: ReasoningEffort;
  priceMode: PriceMode;
};

export type ResearchResult = {
  partNumber: string;
  quantity: number | null;
  best: VendorOfferWithComputed | null;
  vendors: VendorOfferWithComputed[];
  notes: string[];
  sources: string[];
  errors: string[];
  usage?: UsageStats;
};

export type VendorOfferWithComputed = VendorOffer & {
  priceSek: number | null;
  totalSek: number | null;
  effectiveUnitSek: number | null;
  effectiveTotalSek: number | null;
  leadTimeDays: number | null;
};

export type UsageStats = {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  totalTokens: number;
  webSearchCalls: number;
};
