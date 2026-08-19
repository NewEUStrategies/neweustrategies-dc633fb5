// Guards PL/EN parity for the post-editor i18n namespaces this refactor added.
// A missing translation on either side would silently fall back to the other
// language in the UI, so we assert both locales expose an identical key tree.
import { describe, it, expect } from "vitest";
import i18n from "@/lib/i18n";
import "@/lib/i18n-admin-post-panes";
import "@/lib/i18n-admin-zero-click";

type Tree = Record<string, unknown>;

/** Flatten a nested resource object into sorted dotted leaf paths. */
function leafPaths(obj: unknown, prefix = ""): string[] {
  if (obj === null || typeof obj !== "object") return [prefix];
  return Object.entries(obj as Tree)
    .flatMap(([k, v]) => leafPaths(v, prefix ? `${prefix}.${k}` : k))
    .sort();
}

function namespace(lang: "pl" | "en", key: string): unknown {
  const bundle = i18n.getResourceBundle(lang, "translation") as
    | { adminPostPanes?: Record<string, unknown> }
    | undefined;
  return bundle?.adminPostPanes?.[key];
}

// The sub-namespaces introduced when the editor route was moved to atomic design.
const ADDED_NAMESPACES = [
  "editor",
  "nav",
  "taxonomy",
  "layout",
  "sections",
  "authors",
  // Ujawnienie komercyjne jest oświadczeniem prawnym, więc rozjazd PL/EN nie jest
  // tu kosmetyką: brak polskiego brzmienia oznacza polski panel z angielską
  // etykietą, a Rekomendacje UOKiK wymagają oznaczenia w języku odbiorcy.
  "organization",
  "sponsored",
] as const;

describe("post-editor i18n PL/EN parity", () => {
  it.each(ADDED_NAMESPACES)("has matching PL and EN keys under adminPostPanes.%s", (ns) => {
    const pl = namespace("pl", ns);
    const en = namespace("en", ns);
    expect(pl, `PL namespace adminPostPanes.${ns} should exist`).toBeTruthy();
    expect(en, `EN namespace adminPostPanes.${ns} should exist`).toBeTruthy();
    expect(leafPaths(en)).toEqual(leafPaths(pl));
  });

  it("resolves a sample key in both languages to distinct, non-empty strings", () => {
    expect(i18n.getFixedT("pl")("adminPostPanes.editor.goToContent")).toBe(
      "Przejdź do edycji treści",
    );
    expect(i18n.getFixedT("en")("adminPostPanes.editor.goToContent")).toBe("Go to content editing");
  });
});

/**
 * Ściągawka zero-click to nie etykiety przycisków, tylko INSTRUKCJA redakcyjna:
 * budżet leadu, reguła długości odpowiedzi w FAQ, podział na treść „pod
 * cytowanie" i „pod klik". Brak jednego liścia po stronie EN oznacza redaktora
 * pracującego po angielsku, który dostaje polską regułę - albo, przy fallbacku
 * i18next, nie dostaje jej wcale. Dlatego parytet jest tu sprawdzany na całym
 * drzewie, a nie na wybranych podprzestrzeniach.
 */
describe("zero-click cheat sheet i18n PL/EN parity", () => {
  const bundle = (lang: "pl" | "en"): unknown =>
    (i18n.getResourceBundle(lang, "translation") as { adminZeroClick?: unknown } | undefined)
      ?.adminZeroClick;

  it("całe drzewo adminZeroClick ma identyczne klucze w PL i EN", () => {
    const pl = bundle("pl");
    const en = bundle("en");
    expect(pl, "PL namespace adminZeroClick should exist").toBeTruthy();
    expect(en, "EN namespace adminZeroClick should exist").toBeTruthy();
    expect(leafPaths(en)).toEqual(leafPaths(pl));
  });

  it("każda reguła niesie komplet: tytuł, opis, „rób” i „nie rób”", () => {
    // Ściągawka bez kontrprzykładu uczy połowy reguły - a to właśnie „nie rób”
    // (rozbiegówka, FAQ prozą) jest tym, co redakcje robią odruchowo.
    const RULES = ["lead", "questionHeadings", "faq", "faqAnswerLength", "takeaways", "scannable"];
    for (const lang of ["pl", "en"] as const) {
      const t = i18n.getFixedT(lang);
      for (const rule of RULES) {
        for (const leaf of ["title", "body", "do", "dont"]) {
          const key = `adminZeroClick.rules.${rule}.${leaf}`;
          expect(t(key), `${lang}: ${key}`).not.toBe(key);
        }
      }
    }
  });

  it("podpowiedzi przy polach edytora istnieją w obu językach", () => {
    for (const lang of ["pl", "en"] as const) {
      const t = i18n.getFixedT(lang);
      for (const hint of ["takeaways", "excerpt", "seo"]) {
        const key = `adminZeroClick.hints.${hint}`;
        expect(t(key), `${lang}: ${key}`).not.toBe(key);
      }
    }
  });

  it("PL i EN to różne brzmienia, nie skopiowany angielski", () => {
    expect(i18n.getFixedT("pl")("adminZeroClick.nav.hint")).toContain("Ściągawka");
    expect(i18n.getFixedT("en")("adminZeroClick.nav.hint")).toContain("cheat sheet");
  });
});
