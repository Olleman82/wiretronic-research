"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import * as XLSX from "xlsx";
import { DEFAULT_PRICE_MODE, DEFAULT_PROMPT, DEFAULT_REASONING_EFFORT } from "@/lib/constants";
import { parseInputLines, type ParsedItem } from "@/lib/parser";
import type { PriceMode, ReasoningEffort, ResearchResult, VendorOfferWithComputed } from "@/lib/types";
import { COSTS } from "@/lib/costs";

const DEFAULT_ITEMS = "1-0987656-1 2st";
const MAX_PARALLEL = 10;

type ResultState = {
  item: ParsedItem;
  status: "idle" | "loading" | "done" | "error";
  data?: ResearchResult;
  error?: string;
  expanded?: boolean;
  sortBy?: "price" | "moq" | "leadtime";
  selectedVendorLink?: string | null;
};

export default function Home() {
  const [input, setInput] = useState(DEFAULT_ITEMS);
  const [promptTemplate, setPromptTemplate] = useState(DEFAULT_PROMPT);
  const [apiKey, setApiKey] = useState("");
  const [rememberKey, setRememberKey] = useState(true);
  const [reasoningEffort, setReasoningEffort] = useState<ReasoningEffort>(DEFAULT_REASONING_EFFORT);
  const [priceMode, setPriceMode] = useState<PriceMode>(DEFAULT_PRICE_MODE);
  const [results, setResults] = useState<ResultState[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const storedKey = window.localStorage.getItem("wiretronic_api_key");
    const storedPrompt = window.localStorage.getItem("wiretronic_prompt");
    const storedEffort = window.localStorage.getItem("wiretronic_reasoning");
    const storedPriceMode = window.localStorage.getItem("wiretronic_price_mode");

    if (storedKey) {
      setApiKey(storedKey);
    }
    if (storedPrompt) {
      setPromptTemplate(storedPrompt);
    }
    if (storedEffort === "minimal" || storedEffort === "low" || storedEffort === "medium" || storedEffort === "high") {
      setReasoningEffort(storedEffort);
    }
    if (storedPriceMode === "unit" || storedPriceMode === "total") {
      setPriceMode(storedPriceMode);
    }
  }, []);

  useEffect(() => {
    if (rememberKey && apiKey) {
      window.localStorage.setItem("wiretronic_api_key", apiKey);
    }
    if (!rememberKey) {
      window.localStorage.removeItem("wiretronic_api_key");
    }
  }, [apiKey, rememberKey]);

  useEffect(() => {
    window.localStorage.setItem("wiretronic_prompt", promptTemplate);
  }, [promptTemplate]);

  useEffect(() => {
    window.localStorage.setItem("wiretronic_reasoning", reasoningEffort);
  }, [reasoningEffort]);

  useEffect(() => {
    window.localStorage.setItem("wiretronic_price_mode", priceMode);
  }, [priceMode]);

  const parsedItems = useMemo(() => parseInputLines(input), [input]);

  const progress = useMemo(() => {
    const done = results.filter((item) => item.status === "done" || item.status === "error").length;
    return { done, total: results.length };
  }, [results]);

  const runResearch = useCallback(async () => {
    setError(null);
    const items = parseInputLines(input);
    if (!items.length) {
      setError("Inga artikelrader att analysera.");
      return;
    }

    if (!apiKey) {
      setError("Lägg in en OpenAI API-nyckel för sessionen.");
      return;
    }

    const initial = items.map((item) => ({
      item,
      status: "idle" as const,
      expanded: false,
      sortBy: "price" as const,
      selectedVendorLink: null
    }));
    setResults(initial);
    setIsRunning(true);

    try {
      for (let i = 0; i < items.length; i += MAX_PARALLEL) {
        const batch = items.slice(i, i + MAX_PARALLEL);
        setResults((current) =>
          current.map((entry, index) => {
            if (index >= i && index < i + batch.length) {
              return { ...entry, status: "loading" };
            }
            return entry;
          })
        );

        const response = await fetch("/api/research", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            apiKey,
            items: batch.map((item) => ({
              partNumber: item.partNumber,
              quantity: item.quantity,
              promptTemplate,
              reasoningEffort,
              priceMode
            }))
          })
        });

        if (!response.ok) {
          const message = await response.text();
          throw new Error(message);
        }

        const payload = (await response.json()) as { results: ResearchResult[] };
        setResults((current) =>
          current.map((entry, index) => {
            if (index >= i && index < i + batch.length) {
              const data = payload.results[index - i];
              if (!data || data.errors?.length) {
                return {
                  ...entry,
                  status: "error",
                  error: data?.errors?.join("; ") ?? "Okänt fel"
                };
              }
              const selectedVendorLink = data.best?.link ?? data.vendors?.[0]?.link ?? null;
              return { ...entry, status: "done", data, selectedVendorLink };
            }
            return entry;
          })
        );
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Okänt fel");
    } finally {
      setIsRunning(false);
    }
  }, [apiKey, input, priceMode, promptTemplate, reasoningEffort]);

  const exportExcel = useCallback(() => {
    const ready = results.filter((result) => result.data);
    if (!ready.length) {
      setError("Inga resultat att exportera.");
      return;
    }

    const selectedRows = ready.map((result) => {
      const selected = getSelectedVendor(result);
      return {
        Artikelnummer: result.item.partNumber,
        Antal: result.item.quantity ?? "",
        Leverantor: selected?.vendor ?? "",
        Pris_SEK: selected?.effectiveUnitSek ?? selected?.priceSek ?? "",
        Total_SEK: selected?.effectiveTotalSek ?? selected?.totalSek ?? "",
        MOQ: selected?.moq ?? "",
        Ledtid: selected?.leadTime ?? "",
        Lagerstatus: selected?.stock ?? "",
        Lank: selected?.link ?? "",
        Noteringar: (result.data?.notes ?? []).join(" | ")
      };
    });

    const bestRows = ready.map((result) => {
      const best = result.data?.best;
      return {
        Artikelnummer: result.item.partNumber,
        Antal: result.item.quantity ?? "",
        Leverantor: best?.vendor ?? "",
        Pris_SEK: best?.effectiveUnitSek ?? best?.priceSek ?? "",
        Total_SEK: best?.effectiveTotalSek ?? best?.totalSek ?? "",
        Ledtid: best?.leadTime ?? "",
        Lagerstatus: best?.stock ?? "",
        Lank: best?.link ?? "",
        Noteringar: (result.data?.notes ?? []).join(" | ")
      };
    });

    const allRows = ready.flatMap((result) =>
      (result.data?.vendors ?? []).map((vendor) => ({
        Artikelnummer: result.item.partNumber,
        Antal: result.item.quantity ?? "",
        Leverantor: vendor.vendor,
        Pris_SEK: vendor.effectiveUnitSek ?? vendor.priceSek ?? "",
        Total_SEK: vendor.effectiveTotalSek ?? vendor.totalSek ?? "",
        MOQ: vendor.moq ?? "",
        Ledtid: vendor.leadTime,
        Lagerstatus: vendor.stock,
        Lank: vendor.link
      }))
    );

    const workbook = XLSX.utils.book_new();
    const selectedSheet = XLSX.utils.json_to_sheet(selectedRows);
    const bestSheet = XLSX.utils.json_to_sheet(bestRows);
    const allSheet = XLSX.utils.json_to_sheet(allRows);

    XLSX.utils.book_append_sheet(workbook, selectedSheet, "Selected order");
    XLSX.utils.book_append_sheet(workbook, bestSheet, "Best price");
    XLSX.utils.book_append_sheet(workbook, allSheet, "All vendors");

    const fileName = `wiretronic-research-${new Date().toISOString().slice(0, 10)}.xlsx`;
    const wbout = XLSX.write(workbook, { bookType: "xlsx", type: "array" });
    const blob = new Blob([wbout], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = fileName;
    link.click();
    URL.revokeObjectURL(url);
  }, [results]);

  const toggleExpand = (index: number) => {
    setResults((current) =>
      current.map((entry, idx) => (idx === index ? { ...entry, expanded: !entry.expanded } : entry))
    );
  };

  const updateSort = (index: number, sortBy: ResultState["sortBy"]) => {
    setResults((current) => current.map((entry, idx) => (idx === index ? { ...entry, sortBy } : entry)));
  };

  const selectVendor = (index: number, link: string) => {
    setResults((current) =>
      current.map((entry, idx) => (idx === index ? { ...entry, selectedVendorLink: link } : entry))
    );
  };

  const selectedSummary = useMemo(() => {
    const rows = results
      .filter((entry) => entry.data)
      .map((entry) => {
        const selected = getSelectedVendor(entry);
        return {
          partNumber: entry.item.partNumber,
          quantity: entry.item.quantity ?? 1,
          vendor: selected?.vendor ?? "-",
          unitSek: selected?.effectiveUnitSek ?? selected?.priceSek ?? null,
          totalSek: selected?.effectiveTotalSek ?? selected?.totalSek ?? null,
          leadTime: selected?.leadTime ?? "-",
          stock: selected?.stock ?? "-"
        };
      });

    const total = rows.reduce((sum, row) => sum + (row.totalSek ?? 0), 0);
    return { rows, total };
  }, [results]);

  const costEstimate = useMemo(() => {
    const usageRows = results.map((entry) => entry.data?.usage).filter(Boolean) as Array<NonNullable<ResearchResult["usage"]>>;
    if (!usageRows.length) {
      return null;
    }

    const totals = usageRows.reduce(
      (acc, usage) => ({
        input: acc.input + usage.inputTokens,
        output: acc.output + usage.outputTokens,
        cached: acc.cached + usage.cachedInputTokens,
        webSearch: acc.webSearch + usage.webSearchCalls
      }),
      { input: 0, output: 0, cached: 0, webSearch: 0 }
    );

    const inputCost = (totals.input / 1_000_000) * COSTS.inputPerMillion;
    const cachedCost = (totals.cached / 1_000_000) * COSTS.cachedInputPerMillion;
    const outputCost = (totals.output / 1_000_000) * COSTS.outputPerMillion;
    const webSearchCost = totals.webSearch * COSTS.webSearchPerCall;
    const total = inputCost + cachedCost + outputCost + webSearchCost;

    return {
      totals,
      inputCost,
      cachedCost,
      outputCost,
      webSearchCost,
      total
    };
  }, [results]);

  return (
    <div className="min-h-screen px-6 py-10">
      <div className="mx-auto flex max-w-6xl flex-col gap-10">
        <header className="flex flex-col gap-4">
          <p className="text-sm uppercase tracking-[0.3em] text-[var(--muted)]">Wiretronic Research</p>
          <h1 className="font-[var(--font-display)] text-4xl font-semibold text-[var(--accent-strong)] md:text-5xl">
            Researcha artiklar snabbare och jämför leverantörer i realtid.
          </h1>
          <p className="max-w-3xl text-base text-[var(--muted)]">
            Klistra in dina artikelnummer, välj resonemangsnivå och få bästa pris per artikel. Leverantörer som saknar
            lagersaldo eller leveranstid ignoreras.
          </p>
        </header>

        <section className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
          <div className="rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-6 shadow-[0_18px_40px_rgba(30,27,22,0.08)]">
            <div className="flex flex-col gap-4">
              <div className="flex items-center justify-between">
                <h2 className="text-xl font-semibold text-[var(--accent-strong)]">Artikelinmatning</h2>
                <button
                  type="button"
                  onClick={exportExcel}
                  className="rounded-full border border-[var(--border)] px-4 py-2 text-sm font-medium text-[var(--accent-strong)] transition hover:border-[var(--accent)] hover:text-[var(--accent)]"
                >
                  Exportera Excel
                </button>
              </div>
              <textarea
                value={input}
                onChange={(event) => setInput(event.target.value)}
                rows={8}
                className="w-full rounded-2xl border border-[var(--border)] bg-[var(--surface-muted)] p-4 text-sm shadow-inner outline-none transition focus:border-[var(--accent)]"
                placeholder="1-0987656-1 2st"
              />
              <div className="flex flex-wrap items-center gap-3 text-sm text-[var(--muted)]">
                <span>{parsedItems.length} rader redo</span>
                <span>•</span>
                <span>{progress.total ? `${progress.done}/${progress.total} klart` : "Ingen körning"}</span>
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-muted)] p-4">
                  <label className="text-xs uppercase tracking-[0.2em] text-[var(--muted)]">OpenAI API-nyckel</label>
                  <input
                    type="password"
                    value={apiKey}
                    onChange={(event) => setApiKey(event.target.value)}
                    placeholder="sk-..."
                    className="mt-2 w-full rounded-xl border border-transparent bg-white px-3 py-2 text-sm outline-none focus:border-[var(--accent)]"
                  />
                  <label className="mt-3 flex items-center gap-2 text-xs text-[var(--muted)]">
                    <input
                      type="checkbox"
                      checked={rememberKey}
                      onChange={(event) => setRememberKey(event.target.checked)}
                      className="h-4 w-4 rounded border-[var(--border)] accent-[var(--accent)]"
                    />
                    Kom ihåg på den här datorn
                  </label>
                  <p className="mt-2 text-[11px] text-[var(--muted)]">
                    Nyckeln sparas lokalt i webbläsaren och skickas endast i denna session.
                  </p>
                </div>
                <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-muted)] p-4">
                  <label className="text-xs uppercase tracking-[0.2em] text-[var(--muted)]">Resonemangsnivå</label>
                  <select
                    value={reasoningEffort}
                    onChange={(event) => setReasoningEffort(event.target.value as ReasoningEffort)}
                    className="mt-2 w-full rounded-xl border border-transparent bg-white px-3 py-2 text-sm outline-none focus:border-[var(--accent)]"
                  >
                    <option value="minimal">Minimal</option>
                    <option value="low">Low</option>
                    <option value="medium">Medium</option>
                    <option value="high">High</option>
                  </select>
                  <label className="mt-3 flex items-center gap-2 text-xs text-[var(--muted)]">
                    <input
                      type="checkbox"
                      checked={priceMode === "total"}
                      onChange={(event) => setPriceMode(event.target.checked ? "total" : "unit")}
                      className="h-4 w-4 rounded border-[var(--border)] accent-[var(--accent)]"
                    />
                    Basera bästa pris på totalpris (annars styckpris)
                  </label>
                </div>
              </div>
              <button
                type="button"
                onClick={runResearch}
                disabled={isRunning}
                className="rounded-full bg-[var(--accent)] px-6 py-3 text-sm font-semibold text-white shadow-[0_12px_30px_rgba(27,77,62,0.35)] transition hover:bg-[var(--accent-strong)] disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isRunning ? "Bearbetar..." : "Starta research"}
              </button>
              {error ? <p className="text-sm text-[var(--warning)]">{error}</p> : null}
            </div>
          </div>

          <div className="rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-6 shadow-[0_18px_40px_rgba(30,27,22,0.08)]">
            <h2 className="text-xl font-semibold text-[var(--accent-strong)]">Promptmall</h2>
            <p className="mt-2 text-sm text-[var(--muted)]">
              Justera instruktionerna som skickas till modellen. Sparas lokalt i webbläsaren.
            </p>
            <textarea
              value={promptTemplate}
              onChange={(event) => setPromptTemplate(event.target.value)}
              rows={15}
              className="mt-4 w-full rounded-2xl border border-[var(--border)] bg-[var(--surface-muted)] p-4 text-xs leading-relaxed outline-none focus:border-[var(--accent)]"
            />
          </div>
        </section>

        <section className="rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-6 shadow-[0_18px_40px_rgba(30,27,22,0.08)]">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-semibold text-[var(--accent-strong)]">Resultat</h2>
            <p className="text-sm text-[var(--muted)]">
              {progress.total ? `${progress.done} av ${progress.total} färdiga` : "Ingen körning"}
            </p>
          </div>
          {progress.total > 0 && progress.done === progress.total && costEstimate ? (
            <div className="mt-4 rounded-2xl border border-[var(--border)] bg-[var(--surface-muted)] p-4 text-sm text-[var(--muted)]">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs uppercase tracking-[0.2em]">Estimerad kostnad</span>
                <span className="text-base font-semibold text-[var(--accent-strong)]">
                  {formatUsd(costEstimate.total)}
                </span>
              </div>
              <div className="mt-2 grid gap-1 text-xs">
                <span>Input: {formatUsd(costEstimate.inputCost)} • Cached input: {formatUsd(costEstimate.cachedCost)}</span>
                <span>Output: {formatUsd(costEstimate.outputCost)} • Web search: {formatUsd(costEstimate.webSearchCost)}</span>
                <span>Modell: {COSTS.model} • Web search debiteras per call.</span>
              </div>
            </div>
          ) : null}
          {selectedSummary.rows.length > 0 ? (
            <div className="mt-6 rounded-2xl border border-[var(--border)] bg-[var(--surface-muted)] p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h3 className="text-sm font-semibold text-[var(--accent-strong)]">Vald order (sammanfattning)</h3>
                <p className="text-sm text-[var(--accent-strong)]">
                  Total: {formatSek(selectedSummary.total)}
                </p>
              </div>
              <div className="mt-3 grid gap-2 text-xs text-[var(--muted)]">
                {selectedSummary.rows.map((row) => (
                  <div
                    key={`${row.partNumber}-${row.vendor}`}
                    className="grid gap-2 rounded-xl border border-[var(--border)] bg-white/70 p-3 md:grid-cols-[1.2fr_0.6fr_1fr_0.6fr_0.8fr]"
                  >
                    <div>
                      <p className="font-semibold text-[var(--accent-strong)]">{row.partNumber}</p>
                      <p>{row.vendor}</p>
                    </div>
                    <div>Antal: {row.quantity}</div>
                    <div>Styck: {formatSek(row.unitSek)}</div>
                    <div>Total: {formatSek(row.totalSek)}</div>
                    <div>{row.leadTime}</div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
          <div className="mt-6 space-y-4">
            {results.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-[var(--border)] p-6 text-sm text-[var(--muted)]">
                Inga resultat ännu. Kör en research för att se leverantörer.
              </div>
            ) : (
              results.map((result, index) => (
                <div key={`${result.item.partNumber}-${index}`} className="rounded-2xl border border-[var(--border)] p-4">
                  <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                    <div>
                      <p className="text-xs uppercase tracking-[0.2em] text-[var(--muted)]">Artikel</p>
                      <p className="text-lg font-semibold text-[var(--accent-strong)]">{result.item.partNumber}</p>
                      <p className="text-sm text-[var(--muted)]">Antal: {result.item.quantity ?? "-"}</p>
                    </div>
                    <div className="flex flex-wrap items-center gap-3">
                      <span className="rounded-full border border-[var(--border)] px-3 py-1 text-xs text-[var(--muted)]">
                        {result.status === "loading" && "Arbetar"}
                        {result.status === "done" && "Klar"}
                        {result.status === "error" && "Fel"}
                        {result.status === "idle" && "Väntar"}
                      </span>
                      <button
                        type="button"
                        onClick={() => toggleExpand(index)}
                        className="rounded-full border border-[var(--border)] px-3 py-1 text-xs text-[var(--accent-strong)]"
                      >
                        {result.expanded ? "Dölj" : "Visa"}
                      </button>
                    </div>
                  </div>
                  {result.status === "error" ? (
                    <p className="mt-3 text-sm text-[var(--warning)]">{result.error}</p>
                  ) : null}
                  {result.data?.best ? (
                    <div className="mt-4 rounded-2xl bg-[var(--surface-muted)] p-4">
                      <p className="text-xs uppercase tracking-[0.2em] text-[var(--muted)]">Bästa pris (auto)</p>
                      <div className="mt-2 flex flex-wrap items-center justify-between gap-4">
                        <div>
                          <p className="text-lg font-semibold text-[var(--accent-strong)]">{result.data.best.vendor}</p>
                          <p className="text-sm text-[var(--muted)]">{result.data.best.leadTime}</p>
                          <p className="text-sm text-[var(--muted)]">{result.data.best.stock}</p>
                        </div>
                        <div className="text-right">
                          <p className="text-lg font-semibold text-[var(--accent-strong)]">
                            {formatSek(result.data.best.effectiveUnitSek ?? result.data.best.priceSek)}
                          </p>
                          <p className="text-xs text-[var(--muted)]">
                            Total: {formatSek(result.data.best.effectiveTotalSek ?? result.data.best.totalSek)}
                          </p>
                        </div>
                      </div>
                      <a
                        href={result.data.best.link}
                        target="_blank"
                        rel="noreferrer"
                        className="mt-3 inline-flex text-xs font-semibold uppercase tracking-[0.2em] text-[var(--accent)]"
                      >
                        Öppna leverantör
                      </a>
                      {result.selectedVendorLink && result.selectedVendorLink !== result.data.best.link ? (
                        <p className="mt-3 text-xs text-[var(--muted)]">
                          Vald leverantör skiljer sig från bästa pris (auto).
                        </p>
                      ) : null}
                    </div>
                  ) : null}

                  {result.expanded && result.data ? (
                    <div className="mt-4">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <p className="text-sm font-semibold text-[var(--accent-strong)]">Alla leverantörer</p>
                        <div className="flex items-center gap-2 text-xs text-[var(--muted)]">
                          Sortera:
                          <select
                            value={result.sortBy}
                            onChange={(event) => updateSort(index, event.target.value as ResultState["sortBy"])}
                            className="rounded-full border border-[var(--border)] bg-white px-3 py-1 text-xs"
                          >
                            <option value="price">Pris</option>
                            <option value="moq">MOQ</option>
                            <option value="leadtime">Ledtid</option>
                          </select>
                        </div>
                      </div>
                      <div className="mt-3 grid gap-3">
                        {sortVendors(result.data.vendors, result.sortBy).map((vendor) => (
                          <div key={`${vendor.vendor}-${vendor.link}`} className="rounded-2xl border border-[var(--border)] p-3">
                            <div className="flex flex-wrap items-center justify-between gap-3">
                              <div>
                                <p className="font-semibold text-[var(--accent-strong)]">{vendor.vendor}</p>
                                <p className="text-xs text-[var(--muted)]">{vendor.leadTime}</p>
                                <p className="text-xs text-[var(--muted)]">{vendor.stock}</p>
                              </div>
                              <div className="text-right text-sm">
                                <p className="font-semibold text-[var(--accent-strong)]">
                                  {formatSek(vendor.effectiveUnitSek ?? vendor.priceSek)}
                                </p>
                                <p className="text-xs text-[var(--muted)]">
                                  Total: {formatSek(vendor.effectiveTotalSek ?? vendor.totalSek)}
                                </p>
                                <p className="text-xs text-[var(--muted)]">MOQ: {vendor.moq ?? "-"}</p>
                              </div>
                            </div>
                            <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs">
                              <button
                                type="button"
                                onClick={() => selectVendor(index, vendor.link)}
                                className="rounded-full border border-[var(--border)] px-3 py-1 text-[11px] font-semibold text-[var(--accent-strong)]"
                              >
                                {result.selectedVendorLink === vendor.link ? "Vald" : "Välj"}
                              </button>
                              <a
                                href={vendor.link}
                                target="_blank"
                                rel="noreferrer"
                                className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[var(--accent)]"
                              >
                                Leverantörssida
                              </a>
                            </div>
                            <a
                              href={vendor.link}
                              target="_blank"
                              rel="noreferrer"
                              className="mt-2 inline-flex text-xs font-semibold uppercase tracking-[0.2em] text-[var(--accent)] sr-only"
                            >
                              Leverantörssida
                            </a>
                          </div>
                        ))}
                      </div>
                      {result.data.notes?.length ? (
                        <div className="mt-4 rounded-2xl border border-[var(--border)] bg-[var(--surface-muted)] p-3 text-xs text-[var(--muted)]">
                          {result.data.notes.join(" • ")}
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              ))
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

function formatSek(value: number | null | undefined): string {
  if (!value || Number.isNaN(value)) {
    return "-";
  }
  return new Intl.NumberFormat("sv-SE", {
    style: "currency",
    currency: "SEK",
    maximumFractionDigits: 2
  }).format(value);
}

function sortVendors(vendors: VendorOfferWithComputed[], sortBy?: ResultState["sortBy"]) {
  const sorted = [...vendors];

  switch (sortBy) {
    case "moq":
      return sorted.sort((a, b) => (a.moq ?? Number.POSITIVE_INFINITY) - (b.moq ?? Number.POSITIVE_INFINITY));
    case "leadtime":
      return sorted.sort((a, b) => (a.leadTimeDays ?? Number.POSITIVE_INFINITY) - (b.leadTimeDays ?? Number.POSITIVE_INFINITY));
    case "price":
    default:
      return sorted.sort((a, b) => (a.effectiveUnitSek ?? a.priceSek ?? Number.POSITIVE_INFINITY) - (b.effectiveUnitSek ?? b.priceSek ?? Number.POSITIVE_INFINITY));
  }
}

function getSelectedVendor(result: ResultState): VendorOfferWithComputed | undefined {
  const vendors = result.data?.vendors ?? [];
  if (!vendors.length) {
    return undefined;
  }
  if (result.selectedVendorLink) {
    const selected = vendors.find((vendor) => vendor.link === result.selectedVendorLink);
    if (selected) {
      return selected;
    }
  }
  return result.data?.best ?? vendors[0];
}

function formatUsd(value: number | null | undefined): string {
  if (!value || Number.isNaN(value)) {
    return "-";
  }
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 4
  }).format(value);
}
