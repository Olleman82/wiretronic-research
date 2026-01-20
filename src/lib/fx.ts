type RatesResponse = {
  base: string;
  rates: Record<string, number>;
  date?: string;
};

let cachedRates: RatesResponse | null = null;
let cachedAt = 0;
const CACHE_TTL_MS = 1000 * 60 * 60 * 12;

export async function getSekRateFor(currency: string): Promise<number | null> {
  if (currency.toUpperCase() === "SEK") {
    return 1;
  }

  const rates = await getRates();
  if (!rates?.rates) {
    return null;
  }

  const upper = currency.toUpperCase();
  if (rates.base === upper) {
    return rates.rates["SEK"] ?? null;
  }

  const rateToSek = rates.rates["SEK"];
  const rateFrom = rates.rates[upper];
  if (!rateToSek || !rateFrom) {
    return null;
  }

  return rateToSek / rateFrom;
}

async function getRates(): Promise<RatesResponse | null> {
  if (cachedRates && Date.now() - cachedAt < CACHE_TTL_MS) {
    return cachedRates;
  }

  try {
    const primary = await fetch("https://api.exchangerate.host/latest?base=EUR&symbols=SEK,USD,GBP,EUR,NOK,DKK", {
      cache: "no-store"
    });

    if (primary.ok) {
      const data = (await primary.json()) as RatesResponse;
      if (data?.rates?.SEK) {
        cachedRates = data;
        cachedAt = Date.now();
        return cachedRates;
      }
    }
  } catch {
    // ignore and try fallback
  }

  try {
    const fallback = await fetch("https://open.er-api.com/v6/latest/EUR", { cache: "no-store" });
    if (!fallback.ok) {
      return cachedRates;
    }
    const data = (await fallback.json()) as { base_code?: string; rates?: Record<string, number> };
    if (data?.rates?.SEK && data.base_code) {
      cachedRates = { base: data.base_code, rates: data.rates };
      cachedAt = Date.now();
    }
  } catch {
    return cachedRates;
  }

  return cachedRates;
}
