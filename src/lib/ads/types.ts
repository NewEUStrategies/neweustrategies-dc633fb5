// Współdzielone typy dla systemu reklamowego (ad_slots + ad_placements).

export type AdSlotKind = "html" | "script" | "image";
type AdSlotStatus = "active" | "paused";

export type AdPosition =
  | "header_banner"
  | "top_of_post"
  | "mid_post"
  | "bottom_of_post"
  | "sidebar"
  | "in_feed"
  | "footer_slideup";

export type AdPageType =
  | "all"
  | "home"
  | "post"
  | "page"
  | "category"
  | "tag"
  | "archive"
  | "search";

export interface AdSlot {
  id: string;
  tenant_id: string;
  name: string;
  kind: AdSlotKind;
  status: AdSlotStatus;
  html: string | null;
  script: string | null;
  image_url: string | null;
  image_link: string | null;
  image_alt: string | null;
  width: number | null;
  height: number | null;
  requires_consent: boolean;
  targeting: Record<string, unknown>;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface AdPlacement {
  id: string;
  tenant_id: string;
  slot_id: string;
  position: AdPosition;
  page_type: AdPageType;
  page_id: string | null;
  /**
   * Konfiguracja per pozycja:
   * - mid_post:        { paragraph: number }   – po którym paragrafie (od 1)
   * - in_feed:         { every: number }       – co N kart w siatce wpisów
   * - footer_slideup:  { delay_ms?: number, dismissible?: boolean }
   */
  config: Record<string, unknown>;
  sort_order: number;
  active: boolean;
  starts_at: string | null;
  ends_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface AdPlacementWithSlot extends AdPlacement {
  slot: AdSlot;
}

export const AD_POSITION_LABELS: Record<AdPosition, string> = {
  header_banner: "Baner w nagłówku",
  top_of_post: "Nad treścią wpisu",
  mid_post: "W środku wpisu (po N paragrafie)",
  bottom_of_post: "Pod treścią wpisu",
  sidebar: "Sidebar",
  in_feed: "W feedzie (co N kart)",
  footer_slideup: "Slide-up w stopce",
};

export const AD_PAGE_TYPE_LABELS: Record<AdPageType, string> = {
  all: "Wszystkie strony",
  home: "Strona główna",
  post: "Wpisy",
  page: "Strony statyczne",
  category: "Kategorie",
  tag: "Tagi",
  archive: "Archiwa",
  search: "Wyniki wyszukiwania",
};

export const AD_SLOT_KIND_LABELS: Record<AdSlotKind, string> = {
  html: "HTML (banner kodowy)",
  script: "Skrypt (np. AdSense)",
  image: "Grafika z linkiem",
};

// ---------------------------------------------------------------------------
// Targeting slotów (kolumna ad_slots.targeting, jsonb).
//
// Slugi zamiast id: kontekst strony (kategorie/tagi posta) ma slugi pod ręką
// bez dodatkowych zapytań, a slugi są stabilne między środowiskami. Puste pole
// = brak ograniczenia. languages zawęża emisję do wersji językowej; kategorie
// i tagi działają w semantyce OR (wystarczy trafienie w KTÓRYKOLWIEK
// z zadeklarowanych slugów), bo slot ma się wyświetlić przy każdej pasującej
// treści, a nie wyłącznie na przecięciu warunków.
// ---------------------------------------------------------------------------

export type AdLanguage = "pl" | "en";

export interface AdTargeting {
  categorySlugs?: string[];
  tagSlugs?: string[];
  languages?: AdLanguage[];
}

export interface AdTargetingContext {
  categorySlugs: string[];
  tagSlugs: string[];
  language: AdLanguage;
}

function stringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out = value.filter((v): v is string => typeof v === "string" && v.trim().length > 0);
  return out.length > 0 ? out : undefined;
}

/** Bezpieczny odczyt jsonb - nieznane/uszkodzone struktury dają pusty targeting. */
export function parseAdTargeting(json: unknown): AdTargeting {
  if (typeof json !== "object" || json === null || Array.isArray(json)) return {};
  const record = json as Record<string, unknown>;
  const languages = stringArray(record.languages)?.filter(
    (l): l is AdLanguage => l === "pl" || l === "en",
  );
  return {
    categorySlugs: stringArray(record.categorySlugs),
    tagSlugs: stringArray(record.tagSlugs),
    languages: languages && languages.length > 0 ? languages : undefined,
  };
}

export function hasContentTargeting(targeting: AdTargeting): boolean {
  return Boolean(targeting.categorySlugs?.length || targeting.tagSlugs?.length);
}

/** Serializacja do jsonb - tylko niepuste pola, czysty obiekt literalny. */
export function adTargetingToJson(targeting: AdTargeting): Record<string, unknown> {
  return {
    ...(targeting.categorySlugs?.length ? { categorySlugs: targeting.categorySlugs } : {}),
    ...(targeting.tagSlugs?.length ? { tagSlugs: targeting.tagSlugs } : {}),
    ...(targeting.languages?.length ? { languages: targeting.languages } : {}),
  };
}

export function matchesAdTargeting(targeting: AdTargeting, ctx: AdTargetingContext): boolean {
  if (targeting.languages?.length && !targeting.languages.includes(ctx.language)) {
    return false;
  }
  if (!hasContentTargeting(targeting)) return true;
  const catHit = (targeting.categorySlugs ?? []).some((slug) => ctx.categorySlugs.includes(slug));
  const tagHit = (targeting.tagSlugs ?? []).some((slug) => ctx.tagSlugs.includes(slug));
  return catHit || tagHit;
}
