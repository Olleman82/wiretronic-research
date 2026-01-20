import "dotenv/config";
import { describe, expect, it } from "vitest";
import { DEFAULT_PROMPT, DEFAULT_REASONING_EFFORT } from "./constants";
import { runResearch } from "./research";

const apiKey = process.env.OPENAI_API_KEY;

if (!apiKey) {
  throw new Error("OPENAI_API_KEY saknas i .env");
}

describe("backend research", () => {
  it(
    "searches 0411-310-1605 2st and returns best vendor",
    async () => {
      const result = await runResearch(
        {
          partNumber: "0411-310-1605",
          quantity: 2,
          promptTemplate: DEFAULT_PROMPT,
          reasoningEffort: DEFAULT_REASONING_EFFORT,
          priceMode: "total"
        },
        apiKey
      );

      expect(result.partNumber).toContain("0411-310-1605");
      expect(result.vendors.length).toBeGreaterThan(0);
      expect(result.best).not.toBeNull();
    },
    1000 * 60 * 6
  );
});
