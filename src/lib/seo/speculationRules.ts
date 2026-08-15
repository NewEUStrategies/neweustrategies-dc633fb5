// Generator <script type="speculationrules"> - natywny, przeglądarkowy
// prefetch i prerender nawigacji (Speculation Rules API) zamiast zewnętrznego
// CDN-owego "early hints". Czysty builder (testowalny), emitowany raz w head()
// __root.tsx; dokument jest identyczny dla wszystkich, więc pozostaje
// bezpieczny dla NES Edge Cache.
//
// ── DWA ZESTAWY, BO SĄ DWIE KLASY LINKÓW ───────────────────────────────────
// 1. `prefetch` (moderate, hover ~200 ms) - CAŁA witryna. Tani, dogrywa sam
//    dokument HTML. Działa niezależnie od tego, czy klik skończy się nawigacją
//    dokumentową, czy przechwyci go router.
//
// 2. `prerender` (moderate) - WYŁĄCZNIE linki wewnątrz treści artykułu
//    (`.single-post-content a`).
//
// Ten drugi zestaw był kiedyś usunięty w całości, z uzasadnieniem: „nawigacje
// wewnątrz witryny przechwytuje AppLink (`preventDefault()` +
// `router.navigate()`), więc przeglądarkowy prerender nigdy nie zostaje
// skonsumowany, a pełny render w tle idzie do kosza".
//
// To uzasadnienie jest PRAWDZIWE, ale NIEPEŁNE - i różnica ma znaczenie.
// Obowiązuje dla chromu, menu, widgetów i wszystkiego, co renderuje React,
// bo tam anchor powstaje jako `<AppLink>`. NIE obowiązuje dla treści
// artykułu: prose wchodzi przez `dangerouslySetInnerHTML`
// (`components/blocks/renderer/atoms.tsx`, `molecules.tsx`), więc linki w
// tekście to SUROWE `<a href="/…">`, których nie owija AppLink, a w repo nie
// ma delegowanego handlera klików, który by je przechwytywał. Klik w
// odsyłacz w akapicie JEST więc nawigacją dokumentową - dokładnie tym
// przypadkiem, w którym prerender zostaje skonsumowany.
//
// Na serwisie treściowym to nie jest przypadek brzegowy: linki w tekście
// (odsyłacze do wcześniejszych analiz, źródła, przypisy) są najczęściej
// klikaną klasą linków w całym produkcie.
//
// ── DLACZEGO TO JEST BEZPIECZNE ────────────────────────────────────────────
// Prerender renderuje stronę w tle Z JEJ JAVASCRIPTEM, więc każdy beacon
// odpalany na mount policzyłby wizytę, której nie było. W repo osłonięte są
// (przez `afterPrerendering`, `src/lib/prerender.ts`) wszystkie trzy takie
// miejsca: licznik odsłon (`useRecordPostView`), telemetria RUM/Web Vitals
// (`__root.tsx`) oraz ekspozycja testu A/B (`BuilderRenderer`). Ta ostatnia
// osłona powstała RAZEM z tym zestawem - bez niej najazd kursora podbijałby
// mianownik współczynnika konwersji.
//
// Budżet jest ograniczony przez samą przeglądarkę: przy `eagerness: moderate`
// Chrome trzyma najwyżej dwa prerendery naraz i sam je porzuca przy presji
// pamięci. Zawężenie do treści artykułu dodatkowo trzyma koszt przy linkach,
// które realnie prowadzą do następnego czytania.
//
// ── WYKLUCZENIA ────────────────────────────────────────────────────────────
// Oba zestawy dzielą listę z NES Edge Cache (te same powierzchnie
// zalogowane/transakcyjne), w obu wariantach językowych (PL goła ścieżka,
// EN pod /en) + opt-out per link przez atrybut `data-no-speculate`.
// Prerender dodatkowo pomija linki otwierane w nowej karcie (`[target]`) i
// pobierane pliki (`[download]`) - w obu przypadkach wyrenderowany dokument
// i tak nie zostałby użyty.
import { PUBLIC_DOCUMENT_DENY_PREFIXES } from "@/lib/http/documentCache";

interface SpeculationWhere {
  and: Array<
    | { href_matches: string | string[] }
    | { selector_matches: string }
    | { not: { href_matches: string | string[] } }
    | { not: { selector_matches: string } }
  >;
}

interface SpeculationRuleSet {
  prefetch: Array<{ where: SpeculationWhere; eagerness: "moderate" }>;
  prerender: Array<{ where: SpeculationWhere; eagerness: "moderate" }>;
}

/**
 * Kontener treści artykułu. Ta sama klasa, którą stylują `PostContentStyle`
 * i `ContentRenderer` - jedno źródło prawdy, więc zmiana nazwy kontenera
 * przewraca style widocznie, zanim zdąży cicho wyłączyć prerender.
 */
const PROSE_LINK_SELECTOR = ".single-post-content a";

function denyPatterns(): string[] {
  return PUBLIC_DOCUMENT_DENY_PREFIXES.flatMap((prefix) => [
    prefix,
    `${prefix}/*`,
    `/en${prefix}`,
    `/en${prefix}/*`,
  ]);
}

/** Warunki wspólne obu zestawom: ta sama witryna, te same wykluczenia. */
function baseConditions(): SpeculationWhere["and"] {
  return [
    { href_matches: "/*" },
    { not: { href_matches: denyPatterns() } },
    { not: { selector_matches: "[data-no-speculate]" } },
  ];
}

export function buildSpeculationRules(): SpeculationRuleSet {
  return {
    prefetch: [{ where: { and: baseConditions() }, eagerness: "moderate" }],
    prerender: [
      {
        where: {
          and: [
            ...baseConditions(),
            { selector_matches: PROSE_LINK_SELECTOR },
            { not: { selector_matches: "[target]" } },
            { not: { selector_matches: "[download]" } },
          ],
        },
        eagerness: "moderate",
      },
    ],
  };
}

/** Zserializowany dokument reguł do <script type="speculationrules">. */
export function speculationRulesJson(): string {
  return JSON.stringify(buildSpeculationRules());
}
