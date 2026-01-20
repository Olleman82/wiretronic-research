# AGENTS.md

Detta dokument beskriver hur vi arbetar med Wiretronic Research‑projektet: kodstil, arbetsflöde, drift och viktiga beslut.

## Projektöversikt

Wiretronic Research är en webapp som gör pris‑ och lagerresearch för artikelnummer via OpenAI, jämför leverantörer och exporterar en ren order till Excel. Varje rad = en artikel och varje rad ger en modell‑call.

## Arbetsflöde

- Ändringar görs direkt i `src/` och synkas till GitHub.
- Vercel deployar från `master`.
- Nya funktioner verifieras med `npm test` (integrationstest mot OpenAI).

## Lokalt dev‑läge

- På Windows kör vi dev‑servern med **webpack** (inte Turbopack) för att undvika “failed to touch”.
- Rekommenderad start:

```bash
npm run dev -- --webpack --hostname 0.0.0.0 --port 3001
```

## Batch‑strategi

- Frontend skickar batchar om **5 artiklar** åt gången (Vercel Hobby‑timeout 300s).
- Varje batch = ett serverless request till `/api/research`.

## Timeouts

- Serverless `maxDuration` är **300s**.
- Backend gör en retry vid 429/5xx.

## Kostnadsestimat

- UI visar en liten kostnads‑badge när körningen är klar.
- Modell: `gpt-5-mini` (medium reasoning).
- Kostnad baseras på OpenAI‑priser (input/cached/output + web search per call).

## Excel‑export

- Exporterar tre blad:
  - `Selected order` (användarens valda leverantör per rad)
  - `Best price` (automatisk bästa leverantör)
  - `All vendors`
- Exporten använder riktig `.xlsx` via Blob för att undvika fel filtyp.

## UI‑principer

- Källor visas inte i frontend (för att minska brus).
- Tydlig separation mellan artikelresultat och order‑sammanfattning.
- Zebra‑striping på artiklar för bättre läsbarhet.

## Miljövariabler

- `OPENAI_API_KEY` finns lokalt i `.env` (ignoreras i git).
- `OPENAI_MODEL=gpt-5-mini`.

## Git

- Repo: https://github.com/Olleman82/wiretronic-research
- `.env` är ignorerad via `.gitignore`.
