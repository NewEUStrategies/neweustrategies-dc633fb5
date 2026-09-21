// Testy bramki czystości grafu serwera. Konwencja repo: inwariant CI ma test,
// a nie tylko przebieg w CI - inaczej sam skaner nie ma jak umrzeć na czerwono,
// gdy przestanie cokolwiek widzieć.
import { describe, expect, it } from "vitest";
import {
  analyzeServerEntryPurity,
  renderServerEntryPurityReport,
  serverEntryPurityFailed,
  staticImportersOfChunk,
  valueImportersOfPackage,
  FROZEN_STATIC_IMPORTERS,
  LAZY_ONLY_PACKAGES,
  type ServerChunk,
  type SourceFile,
} from "@/lib/ci/serverEntryPurity";

const STRIPE_RULE = LAZY_ONLY_PACKAGES[0];

/** Artefakt, w którym SDK jedzie wyłącznie przez `import()`. */
const CZYSTE: ServerChunk[] = [
  { path: "_libs/stripe.mjs", source: 'const s=1;export{s};' },
  {
    path: "_ssr/stripe.server-AAA.mjs",
    source: 'async function c(){const{default:S}=await import("../_libs/stripe.mjs");return S}export{c};',
  },
  { path: "_ssr/router-BBB.mjs", source: 'import{c}from"./stripe.server-AAA.mjs";export{c};' },
];

/** Ten sam artefakt z krawędzią statyczną - regresja, której pilnuje bramka. */
const BRUDNE: ServerChunk[] = [
  CZYSTE[0],
  {
    path: "_ssr/stripe.server-AAA.mjs",
    source: 'import{s}from"../_libs/stripe.mjs";export{s};',
  },
  CZYSTE[2],
];

const ZRODLA: SourceFile[] = [
  { path: "src/lib/ssrSanitizeHtml.ts", source: 'import { parse } from "node-html-parser";' },
  {
    path: "src/lib/builder/normalizeRichHtml.ts",
    source: 'import { parse, type HTMLElement } from "node-html-parser";',
  },
  {
    path: "src/lib/stripe.server.ts",
    source: 'import type Stripe from "stripe";\nexport type X = Stripe;',
  },
];

function analiza(chunks: ServerChunk[], sources: SourceFile[] = ZRODLA) {
  return analyzeServerEntryPurity({
    chunks,
    sources,
    lazyOnlyPackages: LAZY_ONLY_PACKAGES,
    frozenRules: FROZEN_STATIC_IMPORTERS,
  });
}

describe("serverEntryPurity - ciężka paczka server-only tylko przez import()", () => {
  it("nie liczy `import(` jako krawędzi inicjalizacyjnej", () => {
    expect(staticImportersOfChunk(CZYSTE, "stripe.mjs")).toEqual([]);
    expect(staticImportersOfChunk(BRUDNE, "stripe.mjs")).toEqual(["_ssr/stripe.server-AAA.mjs"]);
  });

  it("przechodzi na artefakcie z wyłącznie dynamiczną krawędzią", () => {
    const report = analiza(CZYSTE);
    expect(serverEntryPurityFailed(report)).toBe(false);
    expect(renderServerEntryPurityReport(report)).toContain("Graf serwera czysty");
  });

  it("oblewa i wskazuje importera, gdy wraca krawędź statyczna", () => {
    const report = analiza(BRUDNE);
    expect(serverEntryPurityFailed(report)).toBe(true);
    expect(report.lazyOnly[0].pkg.chunk).toBe(STRIPE_RULE.chunk);
    expect(renderServerEntryPurityReport(report)).toContain("_ssr/stripe.server-AAA.mjs");
  });

  it("oblewa na pustym artefakcie - brak pomiaru to nie jest zielone światło", () => {
    const report = analiza([]);
    expect(serverEntryPurityFailed(report)).toBe(true);
    expect(renderServerEntryPurityReport(report)).toContain("artefakt serwera jest pusty");
  });

  it("oblewa, gdy chunku reguły nie ma w artefakcie - reguła bez chunku nic nie mierzy", () => {
    const report = analiza([{ path: "_ssr/router-BBB.mjs", source: "export{};" }]);
    expect(serverEntryPurityFailed(report)).toBe(true);
    expect(report.missingChunks.map((p) => p.chunk)).toEqual([STRIPE_RULE.chunk]);
  });
});

describe("serverEntryPurity - zamrożone statyczne importy parsera HTML", () => {
  it("`import type` nie jest krawędzią i nie liczy się do długu", () => {
    expect(valueImportersOfPackage(ZRODLA, "stripe")).toEqual([]);
    expect(valueImportersOfPackage(ZRODLA, "node-html-parser")).toEqual([
      "src/lib/builder/normalizeRichHtml.ts",
      "src/lib/ssrSanitizeHtml.ts",
    ]);
  });

  it("oblewa na NOWYM statycznym importerze spoza listy", () => {
    const report = analiza(CZYSTE, [
      ...ZRODLA,
      { path: "src/lib/wp-import/convert.ts", source: 'import { parse } from "node-html-parser";' },
    ]);
    expect(serverEntryPurityFailed(report)).toBe(true);
    expect(report.frozen[0].added).toEqual(["src/lib/wp-import/convert.ts"]);
  });

  it("oblewa na wpisie, który przestał importować paczkę - lista ma mierzyć stan faktyczny", () => {
    const report = analiza(CZYSTE, [ZRODLA[0], ZRODLA[2]]);
    expect(serverEntryPurityFailed(report)).toBe(true);
    expect(report.frozen[0].stale).toEqual(["src/lib/builder/normalizeRichHtml.ts"]);
  });

  it("lista długu jest dokładnie tak długa, jak ją opisano w komentarzu", () => {
    const rule = FROZEN_STATIC_IMPORTERS[0];
    expect(rule.pkg).toBe("node-html-parser");
    expect(rule.allowed).toEqual([
      "src/lib/builder/normalizeRichHtml.ts",
      "src/lib/ssrSanitizeHtml.ts",
    ]);
  });
});
