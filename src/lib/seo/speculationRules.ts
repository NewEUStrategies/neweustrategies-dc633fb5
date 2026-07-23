// Generator <script type="speculationrules"> - natywny, przeglądarkowy
// prefetch nawigacji (Speculation Rules API) zamiast zewnętrznego CDN-owego
// "early hints". Czysty builder (testowalny), emitowany raz w head()
// __root.tsx; dokument jest identyczny dla wszystkich, więc pozostaje
// bezpieczny dla NES Edge Cache.
//
// TYLKO prefetch `moderate` (hover ~200 ms) - tani, dogrywa sam dokument HTML.
// Zestaw `prerender` został ŚWIADOMIE usunięty: nawigacje wewnątrz witryny
// przechwytuje AppLink (`preventDefault()` + `router.navigate()`), więc klik w
// link tego samego pochodzenia nigdy nie wywołuje nawigacji dokumentowej -
// przeglądarkowy prerender (aktywowany dopiero przy nawigacji dokumentu) nie
// zostawał więc nigdy skonsumowany, a pełny render w tle szedł do kosza.
// Dane trasy (loader + chunki) dogrywa kliencki router.preloadRoute() na
// intent (hover/focus) w AppLink - to warstwa, która realnie skraca nawigację
// SPA. Guard `document.prerendering` (src/lib/prerender.ts) zostaje mimo to,
// bo prerender może zainicjować sama przeglądarka (pasek adresu itd.).
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
  };
}

/** Zserializowany dokument reguł do <script type="speculationrules">. */
export function speculationRulesJson(): string {
  return JSON.stringify(buildSpeculationRules());
}
