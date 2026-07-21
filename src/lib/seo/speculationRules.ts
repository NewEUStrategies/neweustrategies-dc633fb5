// Generator <script type="speculationrules"> - natywny, przeglądarkowy
// prefetch/prerender nawigacji (Speculation Rules API) zamiast zewnętrznego
// CDN-owego "early hints". Czysty builder (testowalny), emitowany raz w
// head() __root.tsx; dokument jest identyczny dla wszystkich, więc pozostaje
// bezpieczny dla NES Edge Cache.
//
// Strategia zachowawcza:
//   - prefetch `moderate` (hover ~200 ms) - tani, sam dokument;
//   - prerender `conservative` (pointerdown) - pełny render w tle dopiero przy
//     kliknięciu, co i tak ścina ~100-200 ms percepcji nawigacji, a nie pali
//     zasobów na każdy najazd kursora. Beacony są osłonięte `document.prerendering`
//     (src/lib/prerender.ts), więc spekulacja nie zawyża statystyk.
//
// Wykluczenia współdzielą listę z NES Edge Cache (te same powierzchnie
// zalogowane/transakcyjne), w obu wariantach językowych (PL goła ścieżka,
// EN pod /en) + opt-out per link przez atrybut data-no-speculate.
import { PUBLIC_DOCUMENT_DENY_PREFIXES } from "@/lib/http/documentCache";

interface SpeculationWhere {
  and: Array<
    | { href_matches: string | string[] }
    | { not: { href_matches: string | string[] } }
    | { not: { selector_matches: string } }
  >;
}

interface SpeculationRuleSet {
  prefetch: Array<{ where: SpeculationWhere; eagerness: "moderate" }>;
  prerender: Array<{ where: SpeculationWhere; eagerness: "conservative" }>;
}

function denyPatterns(): string[] {
  return PUBLIC_DOCUMENT_DENY_PREFIXES.flatMap((prefix) => [
    prefix,
    `${prefix}/*`,
    `/en${prefix}`,
    `/en${prefix}/*`,
  ]);
}

export function buildSpeculationRules(): SpeculationRuleSet {
  const where: SpeculationWhere = {
    and: [
      { href_matches: "/*" },
      { not: { href_matches: denyPatterns() } },
      { not: { selector_matches: "[data-no-speculate]" } },
    ],
  };
  return {
    prefetch: [{ where, eagerness: "moderate" }],
    prerender: [{ where, eagerness: "conservative" }],
  };
}

/** Zserializowany dokument reguł do <script type="speculationrules">. */
export function speculationRulesJson(): string {
  return JSON.stringify(buildSpeculationRules());
}
