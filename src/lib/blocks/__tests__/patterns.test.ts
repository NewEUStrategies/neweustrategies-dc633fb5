import { describe, it, expect } from "vitest";
import { BLOCK_PATTERNS, instantiatePattern, filterPatterns } from "@/lib/blocks/patterns";
import { BLOCK_SPECS } from "@/lib/blocks/registry";
import { pl } from "@/lib/locale/pl";
import { en } from "@/lib/locale/en";

type Dict = Record<string, unknown>;
const patternDict = (locale: Dict): Dict =>
  ((locale.blocks as Dict).patterns as Dict).items as Dict;

describe("BLOCK_PATTERNS", () => {
  it("every pattern produces valid, registry-known blocks in both languages", () => {
    for (const pattern of BLOCK_PATTERNS) {
      for (const lang of ["pl", "en"] as const) {
        const blocks = pattern.create(lang);
        expect(blocks.length, pattern.key).toBeGreaterThan(0);
        for (const b of blocks) {
          expect(BLOCK_SPECS[b.type], `${pattern.key}: ${b.type}`).toBeDefined();
          expect(typeof b.id).toBe("string");
          expect(b.data && typeof b.data).toBe("object");
        }
      }
      expect(BLOCK_SPECS[pattern.iconType], `icon: ${pattern.key}`).toBeDefined();
    }
  });

  it("instantiatePattern mints fresh ids on every insertion (also nested)", () => {
    const columns = BLOCK_PATTERNS.find((p) => p.key === "two-column-analysis");
    expect(columns).toBeDefined();
    const a = instantiatePattern(columns!, "pl");
    const b = instantiatePattern(columns!, "pl");
    expect(a[0].id).not.toBe(b[0].id);
    const leftA = a[0].data.left as Array<{ id: string }>;
    const leftB = b[0].data.left as Array<{ id: string }>;
    expect(leftA[0].id).not.toBe(leftB[0].id);
  });

  it("creates language-specific content per document language", () => {
    const takeaways = BLOCK_PATTERNS.find((p) => p.key === "key-takeaways")!;
    const plBlocks = takeaways.create("pl");
    const enBlocks = takeaways.create("en");
    expect(plBlocks[0].data.text).toBe("Kluczowe wnioski");
    expect(enBlocks[0].data.text).toBe("Key takeaways");
  });

  it("has i18n name+desc for every pattern in PL and EN", () => {
    const plItems = patternDict(pl as unknown as Dict);
    const enItems = patternDict(en as unknown as Dict);
    for (const pattern of BLOCK_PATTERNS) {
      const plEntry = plItems[pattern.key] as Dict | undefined;
      const enEntry = enItems[pattern.key] as Dict | undefined;
      expect(plEntry?.name, `pl name: ${pattern.key}`).toBeTruthy();
      expect(plEntry?.desc, `pl desc: ${pattern.key}`).toBeTruthy();
      expect(enEntry?.name, `en name: ${pattern.key}`).toBeTruthy();
      expect(enEntry?.desc, `en desc: ${pattern.key}`).toBeTruthy();
    }
  });
});

describe("filterPatterns", () => {
  const label = (p: { key: string }) => (p.key === "data-table" ? "Tabela z danymi" : p.key);
  const desc = () => "";

  it("returns all patterns for an empty query", () => {
    expect(filterPatterns(BLOCK_PATTERNS, "", label, desc)).toHaveLength(BLOCK_PATTERNS.length);
  });

  it("filters by label and key, case-insensitively", () => {
    expect(filterPatterns(BLOCK_PATTERNS, "tabela", label, desc).map((p) => p.key)).toEqual([
      "data-table",
    ]);
    expect(filterPatterns(BLOCK_PATTERNS, "EXPERT", label, desc).map((p) => p.key)).toContain(
      "expert-quote",
    );
  });
});
