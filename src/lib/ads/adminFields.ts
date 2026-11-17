// Pola panelu reklam (`/admin/ads`): kolumny list wyboru slotu, klucze
// etykiet pozycji, typów stron i rodzajów slotu oraz zapis targetingu do jsonb.
// Typy i odczyt targetingu opisuje `types.ts`.
//
// OSOBNY MODUŁ, CELOWO (chunk startowy, roadmapa ładowania §9.1 J3).
// `types.ts` czyta front reklam, więc siedzi w `app-initial`; to tutaj czyta
// wyłącznie panel. `types.ts` NIE importuje stąd niczego - także reeksportem.
import type { AdPageType, AdPosition, AdSlot, AdSlotKind, AdTargeting } from "./types";

/**
 * Kolumny slotu dla list wyboru w panelu (zakładki pozycji i statystyk). Te
 * widoki potrzebują nazwy i rodzaju, nie treści kreacji ani `notes` - pełny
 * wiersz z notatkami ma tylko formularz slotu (`fetchAdminAdSlots`).
 */
export const AD_SLOT_PICKER_COLUMNS = "id, name, kind, status";

/** Wiersz `AD_SLOT_PICKER_COLUMNS`. */
export type AdSlotPickerRow = Pick<AdSlot, "id" | "name" | "kind" | "status">;

// KLUCZE i18n, nie gotowe napisy.
//
// Do 12.08 te trzy mapy trzymały polskie etykiety wprost, więc panel reklam był
// jednojęzyczny bez względu na wybrany język interfejsu - a `Record<Enum, string>`
// pilnował tylko tego, że każdy wariant enuma MA etykietę, nie że da się ją
// przetłumaczyć. Teraz mapy wskazują klucze słownika `i18n-ads-admin`, a typ
// nadal wymusza kompletność: nowy wariant `AdPosition` bez klucza nie skompiluje
// się, a brak wpisu w słowniku zapali test pokrycia kluczy.
export const AD_POSITION_LABEL_KEYS: Record<AdPosition, string> = {
  header_banner: "adsAdmin.positions.headerBanner",
  top_of_post: "adsAdmin.positions.topOfPost",
  mid_post: "adsAdmin.positions.midPost",
  bottom_of_post: "adsAdmin.positions.bottomOfPost",
  sidebar: "adsAdmin.positions.sidebar",
  in_feed: "adsAdmin.positions.inFeed",
  footer_slideup: "adsAdmin.positions.footerSlideup",
};

export const AD_PAGE_TYPE_LABEL_KEYS: Record<AdPageType, string> = {
  all: "adsAdmin.pageTypes.all",
  home: "adsAdmin.pageTypes.home",
  post: "adsAdmin.pageTypes.post",
  page: "adsAdmin.pageTypes.page",
  category: "adsAdmin.pageTypes.category",
  tag: "adsAdmin.pageTypes.tag",
  archive: "adsAdmin.pageTypes.archive",
  search: "adsAdmin.pageTypes.search",
  event: "adsAdmin.pageTypes.event",
};

export const AD_SLOT_KIND_LABEL_KEYS: Record<AdSlotKind, string> = {
  html: "adsAdmin.kinds.html",
  script: "adsAdmin.kinds.script",
  image: "adsAdmin.kinds.image",
};

/** Serializacja do jsonb - tylko niepuste pola, czysty obiekt literalny. */
export function adTargetingToJson(targeting: AdTargeting): Record<string, unknown> {
  return {
    ...(targeting.categorySlugs?.length ? { categorySlugs: targeting.categorySlugs } : {}),
    ...(targeting.tagSlugs?.length ? { tagSlugs: targeting.tagSlugs } : {}),
    ...(targeting.languages?.length ? { languages: targeting.languages } : {}),
  };
}
