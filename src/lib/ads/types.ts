// Współdzielone typy dla systemu reklamowego (ad_slots + ad_placements).

export type AdSlotKind = "html" | "script" | "image";
export type AdSlotStatus = "active" | "paused";

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
