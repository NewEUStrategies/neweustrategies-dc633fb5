// STAN „W PRZYGOTOWANIU" ZAKŁADEK HUBA „PRZYCHÓD I LEJEK" (I9a, 2026-10-20).
//
// DLACZEGO TO ISTNIEJE. Właściciel przesunął widoczność huba w nawigacji
// panelu z I9 na teraz („wszystko, co robimy, ma być w panelu admina"). Treść
// zakładek dowożą dopiero S7 (kokpit, przychód, lejek, retencja, społeczność,
// diagnostyka, oferta, dostęp, dane wejściowe) i S5+S8 (ścieżki), a zaślepki
// I0 mówiły jedno zdanie „w przygotowaniu". Admin, który z menu trafi na taką
// zakładkę, ma się dowiedzieć: CO tu będzie, KIEDY (etap) i GDZIE te dane są
// w panelu JUŻ DZIŚ - a nie zobaczyć pusty ekran.
//
// DANE, NIE GAŁĘZIE. Etap, opis i odnośniki każdej zakładki stoją w jednej
// mapie po typie zakładek (klucz spoza `RevenueTabId` się nie skompiluje).
// Odnośniki to `RelatedModule` (ten sam kształt co pasek „Powiązane
// moduły"); cele i parametry wzięte z `AREA_OWNER_LINK`, gdzie obszar ma
// właściciela, więc kontrakt deep linków SPEC §2.6 jest jeden. Test
// `tabPreparing.test.ts` sprawdza, że każdy cel istnieje w `routeTree.gen.ts`
// i ma parametry z kontraktu, a każdy klucz - napis PL i EN.
//
// PRZEJŚCIOWE. Wycinek, który podmienia zaślepkę zakładki na treść, usuwa jej
// wpis tutaj (albo zostawia odnośniki jako „Powiązane moduły" zakładki).
// Integrator S7 (2026-10-22): dziesięć zakładek S7 ma już treść, więc ich
// wpisy, etapy `s7`/`s6s7` i odnośniki zniknęły - zostały same Ścieżki (S8).
// Mapa jest `Partial`: zakładka bez wpisu nie renderuje tego stanu. Ostatni
// wycinek (S8) usuwa cały plik razem z molekułą i słownikiem.
// Plik leży w `src/lib/admin/**` - poza skanem arkusza CSS czytelnika.
import { AREA_OWNER_LINK, type RelatedModule } from "@/lib/admin/revenue/hubTabs";
import type { RevenueTabId } from "@/lib/revenue/search";

/**
 * Etap, który dowiezie treść zakładki: `s5s8` - silnik ścieżek (S5) i ich
 * ekrany (S8). Etapy `s7` i `s6s7` zniknęły razem z zaślepkami S7.
 */
export type RevenueTabStage = "s5s8";

export interface TabPreparingSpec {
  stage: RevenueTabStage;
  /** Klucz `adminRevenue.preparing.what.*` - co pokaże zakładka. */
  whatKey: string;
  /** Moduły panelu, w których te dane są już dziś (kolejność = ważność). */
  links: readonly RelatedModule[];
}

export const TAB_STAGE_KEY: Readonly<Record<RevenueTabStage, string>> = {
  s5s8: "adminRevenue.preparing.stage.s5s8",
};

/** Nazwy zakładek huba - te same klucze, co pasek zakładek (`RevenueHubLayout`). */
export const TAB_TITLE_KEY: Readonly<Record<RevenueTabId, string>> = {
  overview: "adminRevenue.tab.overview",
  mrr: "adminRevenue.tab.mrr",
  funnel: "adminRevenue.tab.funnel",
  retention: "adminRevenue.tab.retention",
  community: "adminRevenue.tab.community",
  diagnostics: "adminRevenue.tab.diagnostics",
  offer: "adminRevenue.tab.offer",
  access: "adminRevenue.tab.access",
  journeys: "adminRevenue.tab.journeys",
  metrics: "adminRevenue.tab.metrics",
  inputs: "adminRevenue.tab.inputs",
};

// ---------------------------------------------------------------------------
// Odnośniki do modułów (cele i parametry z kontraktu SPEC §2.6)
// ---------------------------------------------------------------------------

const CRM: RelatedModule = { ...AREA_OWNER_LINK.crm, labelKey: "adminRevenue.related.crm" };
const NEWSLETTER: RelatedModule = {
  ...AREA_OWNER_LINK.newsletter,
  labelKey: "adminRevenue.related.newsletter",
};
const OUTBOX: RelatedModule = {
  to: "/admin/newsletter/outbox",
  labelKey: "adminRevenue.preparing.link.outbox",
};
const WORKFLOWS: RelatedModule = {
  ...AREA_OWNER_LINK.workflows,
  labelKey: "adminRevenue.related.workflows",
};

/**
 * Stan zakładek huba bez treści. Odnośniki niczego nie odsłaniają: te same
 * moduły pasek boczny pokazuje dziś każdemu członkowi personelu, a dane w nich
 * filtruje baza (RLS, `has_role`).
 */
export const TAB_PREPARING: Readonly<Partial<Record<RevenueTabId, TabPreparingSpec>>> = {
  journeys: {
    stage: "s5s8",
    whatKey: "adminRevenue.preparing.what.journeys",
    links: [WORKFLOWS, NEWSLETTER, OUTBOX, CRM],
  },
};
