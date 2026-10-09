// STOS RODZINY TYTUŁÓW I ZAJAWEK KART (P3.2b, fala 3).
//
// PO CO. Produkcyjny wiersz `site_settings.theme_design` (i fixture pomiaru
// `e2e/fixtures/first-visit.json`) niesie dla `postTitle`/`postExcerpt` stos
// sprzed kroju zastępczego: `"Red Hat Display", system-ui, …`. Do czasu
// pobrania fontu tytuły (waga 600) renderowały się wtedy `system-ui` (DejaVu
// Sans Bold, ~27% szerszy niż RHD 600), zawijały się o linię więcej, a po
// podmianie fontu karty się kurczyły: CLS 0,0163 na desktopie (ślad produkcji
// 2026-10-08). Generator CSS wstawia metrycznie dopasowany krój zastępczy zaraz
// za Red Hat Display; dane w CMS zostają bez zmian (decyzja orkiestratora).
import { describe, expect, it } from "vitest";

import {
  THEME_DESIGN_DEFAULTS,
  themeDesignFromRaw,
  themeDesignToCss,
  themeDesignToStyleVars,
  withRedHatDisplayFallback,
} from "@/lib/theme/themeDesign";

/** Stos z produkcyjnego wiersza `theme_design` i z fixture pomiaru. */
const LEGACY = '"Red Hat Display", system-ui, -apple-system, Segoe UI, sans-serif';
const FALLBACK = '"Red Hat Display Fallback"';

describe("withRedHatDisplayFallback", () => {
  it("stary stos z CMS: krój zastępczy zaraz za Red Hat Display", () => {
    expect(withRedHatDisplayFallback(LEGACY)).toBe(
      `"Red Hat Display", ${FALLBACK}, system-ui, -apple-system, Segoe UI, sans-serif`,
    );
  });

  it("stos domyślny (już z krojem zastępczym) wraca bez zmian", () => {
    const stack = THEME_DESIGN_DEFAULTS.postTitle.fontFamily;
    expect(stack).toContain(FALLBACK);
    expect(withRedHatDisplayFallback(stack)).toBe(stack);
  });

  it("stos bez Red Hat Display wraca bez zmian", () => {
    expect(withRedHatDisplayFallback("Inter, system-ui, sans-serif")).toBe(
      "Inter, system-ui, sans-serif",
    );
    expect(withRedHatDisplayFallback("")).toBe("");
  });

  it("apostrofy i brak cudzysłowu też są rozpoznawane", () => {
    expect(withRedHatDisplayFallback("'Red Hat Display', serif")).toBe(
      `'Red Hat Display', ${FALLBACK}, serif`,
    );
    expect(withRedHatDisplayFallback("Red Hat Display")).toBe(`Red Hat Display, ${FALLBACK}`);
  });

  it("sam krój zastępczy i inna rodzina o podobnej nazwie wracają bez zmian", () => {
    expect(withRedHatDisplayFallback(FALLBACK)).toBe(FALLBACK);
    expect(withRedHatDisplayFallback('"Red Hat Display Pro", sans-serif')).toBe(
      '"Red Hat Display Pro", sans-serif',
    );
  });

  it("jest idempotentna", () => {
    for (const stack of [LEGACY, "'Red Hat Display', serif", "Inter, sans-serif", FALLBACK]) {
      const once = withRedHatDisplayFallback(stack);
      expect(withRedHatDisplayFallback(once)).toBe(once);
    }
  });
});

describe("themeDesignToCss: rodziny tytułów i zajawek", () => {
  const legacy = themeDesignFromRaw({
    postTitle: { fontFamily: LEGACY },
    postExcerpt: { fontFamily: LEGACY },
  });

  it("stary stos z CMS dostaje krój zastępczy w --td-pt-family i --td-pe-family", () => {
    const css = themeDesignToCss(legacy);
    expect(css).toContain(`--td-pt-family:"Red Hat Display", ${FALLBACK}, system-ui`);
    expect(css).toContain(`--td-pe-family:"Red Hat Display", ${FALLBACK}, system-ui`);
  });

  it("model z CMS (to, co pokazuje i zapisuje panel) zostaje bez zmian", () => {
    expect(legacy.postTitle.fontFamily).toBe(LEGACY);
    expect(legacy.postExcerpt.fontFamily).toBe(LEGACY);
  });

  it("podgląd na żywo dostaje ten sam stos co CSS strony", () => {
    const vars = themeDesignToStyleVars(legacy);
    expect(vars["--td-pt-family"]).toBe(
      `"Red Hat Display", ${FALLBACK}, system-ui, -apple-system, Segoe UI, sans-serif`,
    );
  });

  it("stos domyślny emituje się bez dublowania kroju zastępczego", () => {
    const css = themeDesignToCss(THEME_DESIGN_DEFAULTS);
    const decl = /--td-pt-family:([^;]*);/.exec(css)?.[1] ?? "";
    expect(decl.split("Red Hat Display Fallback")).toHaveLength(2);
  });
});
