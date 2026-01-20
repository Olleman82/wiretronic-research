# Wiretronic Research

Wiretronic Research är en webapp för att göra pris‑ och lagerresearch på en lista med artikelnummer. Varje rad behandlas som en egen artikel och skickas som en separat OpenAI‑request där modellen söker hos de angivna leverantörerna och returnerar strukturerad data som kan jämföras och exporteras.

## Syfte

- Hitta bästa pris per artikel (default: lägsta totalpris för angivet antal).
- Jämföra alternativa leverantörer med sortering på pris, MOQ och ledtid.
- Få en enhetlig, strukturerad JSON‑output som kan exporteras till Excel.

## Funktioner

- **Fri inmatning av artikelrader**
  - Format som stöds: `ARTNR`, `ARTNR 2`, `ARTNR 2st`, `ARTNR x2`.
  - Om antal saknas: **default till 1 st**.
- **10 parallella calls per batch**
  - Snabbare genomströmning, men fortfarande stabilt.
- **Reasoning‑nivå**
  - Användaren väljer `minimal/low/medium/high`, default `medium`.
- **Prislogik**
  - Default: bästa **totalpris** (för angivet antal).
  - Kan växlas till **styckpris** per session.
- **Resultat per artikel**
  - Bästa leverantör visas i topp.
  - Expandera för alla leverantörer i lager.
  - Sortering per artikel: pris, MOQ, ledtid.
- **Valutakonvertering**
  - Priser konverteras till SEK via dagskurs.
- **Export**
  - Excel (XLSX) med två blad: “Best price” och “All vendors”.
- **Prompt‑mall i UI**
  - Justerbar och sparas lokalt i browsern.
- **API‑nyckel**
  - Kan anges per session och sparas lokalt i webbläsaren.

## Hur det fungerar

1. **Frontend** tar in artikelrader och inställningar.
2. **Backend** kör OpenAI‑requests (en per artikel) med web‑search mot givna leverantörer.
3. Svar tvingas till **JSON‑schema**.
4. Priser normaliseras till SEK och bästa leverantör väljs.
5. Resultat visas i UI och kan exporteras.

## Teknikstack

- **Next.js** (App Router)
- **React** (frontend)
- **Node.js** (backend via API routes)
- **OpenAI Responses API** med web‑search
- **Tailwind CSS**
- **Vitest** (integrationstest)

## Projektstruktur (relevant)

- `src/app/page.tsx` – UI, state, export, rendering av resultat
- `src/app/api/research/route.ts` – backend endpoint
- `src/lib/research.ts` – OpenAI‑anrop, schema, logik för best‑price
- `src/lib/parser.ts` – parser för indata (default antal = 1)
- `src/lib/fx.ts` – valutakonvertering (SEK)
- `src/lib/research.test.ts` – integrationstest mot OpenAI

## Kör lokalt

```bash
npm install
npm run dev -- --webpack --hostname 0.0.0.0 --port 3001
```

Öppna: `http://localhost:3001`

> Obs: På Windows kan Turbopack ge felet “failed to touch”. Därför kör vi med `--webpack`.

## Tester

Kör integrationstestet:

```bash
npm test
```

Testet gör en riktig request mot OpenAI och använder artikeln `0411-310-1605 2st`.

## Miljövariabler

Skapa en `.env`:

```
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-5
```

## Begränsningar / tips

- En request per artikel kan ta tid. Batch‑processing kör 10 åt gången.
- Långsamma leverantörssidor kan ge timeout; systemet gör 1 retry på 429/5xx.
- Om kurs‑API är nere visas priser utan SEK‑konvertering.

## Deployment

Appen är byggd för Vercel:

```bash
npm run build
npm run start
```

Säkerställ att `OPENAI_API_KEY` finns som env‑var i Vercel.
