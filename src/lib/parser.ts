export type ParsedItem = {
  partNumber: string;
  quantity: number | null;
  raw: string;
};

const quantityPatterns = [
  /\s+(\d+)\s*st\s*$/i,
  /\s+(\d+)\s*x\s*$/i,
  /\s+x(\d+)\s*$/i,
  /\s+(\d+)\s*$/
];

export function parseInputLines(input: string): ParsedItem[] {
  return input
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => {
      const quantity = extractQuantity(line) ?? 1;
      const partNumber = stripTrailingQuantity(line);
      return {
        partNumber: partNumber.length > 0 ? partNumber : line,
        quantity,
        raw: line
      };
    });
}

function extractQuantity(line: string): number | null {
  for (const pattern of quantityPatterns) {
    const match = line.match(pattern);
    if (match?.[1]) {
      const qty = Number.parseInt(match[1], 10);
      if (Number.isFinite(qty) && qty > 0) {
        return qty;
      }
    }
  }
  return null;
}

function stripTrailingQuantity(line: string): string {
  for (const pattern of quantityPatterns) {
    if (pattern.test(line)) {
      return line.replace(pattern, "").trim();
    }
  }
  return line.trim();
}
