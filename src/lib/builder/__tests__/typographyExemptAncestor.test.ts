// ZWOLNIENIE Z TYPOGRAFII WIDGETU OBEJMUJE POTOMKÓW (forma przodka).
//
// Reguły „Theme Design" widgetu (szablon HW-2 w `styles.css` i generator
// `typographyCss.ts`) stawiają rozmiar, grubość, krój i światło z
// `!important` na `p`, `span`, `dt`, `dd`, `button`, `figcaption`, `h3`...
// Zwolnienie `:not([data-typography-exempt])` chroniło dotąd wyłącznie SAM
// oznaczony element - a wykres ma w środku dziesiątki tekstów (podtytuł,
// legenda, tabela, okna, wiersze dymka). Wykres w widgecie wyglądał więc
// inaczej niż ten sam wykres w bloku CMS.
//
// Forma przodka `:not([data-typography-exempt] *)` na KAŻDEJ gałęzi
// elementów pozwala oznaczyć raz korzeń (`figure.neh-chart`, korzeń dymka)
// i zwolnić całe poddrzewo. Bramka pilnuje obu stron umowy: szablonu
// i generatora. Równość list selektorów obu stron pilnuje osobno
// `typographyMapping.test.tsx`.
//
// happy-dom NIE rozumie złożonego selektora w `:not()` (dopasowanie
// ignoruje część potomną), więc sprawdzamy selektory jako dane, a nie
// `element.matches()`.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildWidgetTypographyCss } from "@/lib/builder/typographyCss";
import { buildJoinUsSizeCss } from "@/lib/interests/joinUsSizeCss";
import { parseCssRules, specificity, specificityAbove } from "@/test/cssRules";

const ANCESTOR = ":not([data-typography-exempt] *)";

const squash = (s: string): string =>
  s.replace(/\s+/g, " ").replace(/\(\s*/g, "(").replace(/\s*\)/g, ")").trim();

/** Selektor trafiający w ELEMENTY tekstu (grupy tagów albo poddrzewo `.prose`). */
function trafiaWTekst(selector: string): boolean {
  return /:is\((p|h1)\b/.test(selector) || /\.prose (\*|p)/.test(selector);
}

describe("szablon HW-2 w styles.css", () => {
  const reguly = parseCssRules(readFileSync("src/styles.css", "utf8")).filter(
    (r) => r.context.length === 0 && r.selectors.some((s) => s.includes("[data-wt~=")),
  );
  const selektory = reguly.flatMap((r) => r.selectors.map(squash)).filter(trafiaWTekst);

  it("ma gałęzie elementów w regułach `fs`, `tfs` i `dfs`", () => {
    for (const token of ["fs", "tfs", "dfs"]) {
      expect(
        selektory.some((s) => s.includes(`[data-wt~="${token}"]`)),
        token,
      ).toBe(true);
    }
  });

  it("każda gałąź elementów omija potomków `[data-typography-exempt]`", () => {
    for (const s of selektory) expect(s, s).toContain(ANCESTOR);
  });
});

describe("generator reguł per widget", () => {
  const css = buildWidgetTypographyCss(
    "w-1",
    {
      fontSize: { desktop: "18px" },
      descriptionFontSize: { desktop: "14px" },
      fontFamily: "Georgia",
      fontWeight: "700",
      letterSpacing: "0.1em",
      textTransform: "uppercase",
    },
    "desktop",
    { specificity: 3 },
  );
  const selektory = parseCssRules(css)
    .flatMap((r) => r.selectors.map(squash))
    .filter(trafiaWTekst);

  it("emituje gałęzie elementów (rozmiary i wspólne własności)", () => {
    expect(selektory.length).toBeGreaterThan(4);
  });

  it("każda gałąź elementów omija potomków `[data-typography-exempt]`", () => {
    for (const s of selektory) expect(s, s).toContain(ANCESTOR);
  });

  it("tak samo bez osobnego rozmiaru opisu (rozmiar ogólny)", () => {
    const ogolny = parseCssRules(
      buildWidgetTypographyCss("w-2", { fontSize: { desktop: "16px" } }, "desktop", {
        specificity: 3,
      }),
    )
      .flatMap((r) => r.selectors.map(squash))
      .filter(trafiaWTekst);
    expect(ogolny.length).toBeGreaterThan(0);
    for (const s of ogolny) expect(s, s).toContain(ANCESTOR);
  });
});

// ZWOLNIENIE NIE WAŻY NIC W KASKADZIE. Samo `:not([data-typography-exempt] *)`
// ma specyficzność (0,1,0), czyli podbijało każdą gałąź elementów - reguły,
// które celowo biją typografię widgetu specyficznością, przegrywały nagle
// z regułą dotąd słabszą (rozmiary „Dołącz do nas": (0,9,0) przeciw gałęzi
// ogólnej (0,8,1), po podbiciu (0,9,1)). Forma przodka stoi więc w `:where()`.
describe("forma przodka nie zmienia specyficzności gałęzi", () => {
  const BEZ_WAGI = `:where(${ANCESTOR})`;
  const szablon = parseCssRules(readFileSync("src/styles.css", "utf8"))
    .filter((r) => r.context.length === 0 && r.selectors.some((s) => s.includes("[data-wt~=")))
    .flatMap((r) => r.selectors.map(squash));
  const generator = parseCssRules(
    buildWidgetTypographyCss(
      "w-3",
      {
        fontSize: { desktop: "18px" },
        descriptionFontSize: { desktop: "14px" },
        fontWeight: "700",
      },
      "desktop",
      { specificity: 3 },
    ),
  ).flatMap((r) => r.selectors.map(squash));
  const zeZwolnieniem = [...szablon, ...generator].filter((s) => s.includes(ANCESTOR));

  it("każde zwolnienie przodka stoi w `:where()`", () => {
    expect(zeZwolnieniem.length).toBeGreaterThan(6);
    for (const s of zeZwolnieniem) {
      expect(s.split(ANCESTOR).length, s).toBe(s.split(BEZ_WAGI).length);
    }
  });

  it("specyficzność ze zwolnieniem = specyficzność bez niego", () => {
    for (const s of zeZwolnieniem) {
      expect(specificity(s), s).toEqual(specificity(s.split(BEZ_WAGI).join("")));
    }
  });

  it("rozmiar opisu „Dołącz do nas” nadal bije gałąź ogólną widgetu", () => {
    const joinUs = parseCssRules(buildJoinUsSizeCss("j-1", { descriptionSize: 15 }))
      .flatMap((r) => r.selectors)
      .find((s) => s.endsWith('[data-edit-target="descriptionSize"]'));
    expect(joinUs).toBeDefined();
    const ogolna = parseCssRules(
      buildWidgetTypographyCss("w-4", { fontSize: { desktop: "16px" } }, "desktop", {
        specificity: 3,
      }),
    )
      .flatMap((r) => r.selectors.map(squash))
      .find((s) => s.includes(":is(p,span,"));
    expect(ogolna).toBeDefined();
    expect(specificityAbove(specificity(joinUs!), specificity(ogolna!))).toBe(true);
  });
});
