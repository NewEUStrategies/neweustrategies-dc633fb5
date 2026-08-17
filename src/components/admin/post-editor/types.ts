// Typy formularza edytora wpisu - wspólny kontrakt trasy admin.posts.$slug
// i całego drzewa atomic-design edytora (atomy / molekuły / organizmy / hooki /
// lib). Wyodrębnione z monolitu ~1550 linii; zachowanie bez zmian.
import type { BuilderDocument } from "@/lib/builder/types";
import type { LocalizedBlocks } from "@/lib/blocks/types";
import type { LayoutOverrides, PostFormat } from "@/lib/postLayouts";
import type { PostWorkflowStatus } from "@/lib/content/workflow";
import type { SponsoredKind } from "@/lib/content/sponsored";
import type { TocOverride } from "@/lib/toc/settings";

export type EditorType = "blocks" | "richtext" | "markdown" | "builder";

export interface PostForm {
  id: string;
  slug: string;
  // Baza optimistic-locka: updated_at wiersza w chwili załadowania/ostatniego
  // zapisu (kolumna z select("*")). Zapis przekazuje ją serwerowi, by odrzucić
  // ciche nadpisanie, gdy ktoś inny zapisał w międzyczasie.
  updated_at?: string | null;
  status: PostWorkflowStatus;
  /** Autor główny wpisu - pierwszy na liście autorów (karta "Autorzy"). */
  author_id: string | null;
  editor: EditorType;
  title_pl: string;
  title_en: string;
  excerpt_pl: string | null;
  excerpt_en: string | null;
  content_pl: string | null;
  content_en: string | null;
  cover_image_url: string | null;
  audio_url_pl: string | null;
  audio_url_en: string | null;
  // Kanoniczny głos lektora AI per język (null = głos najemcy z
  // site_settings.reading). Czytelnik nie ma tu żadnego wpływu - to jedyne
  // źródło wariantu poza ustawieniami witryny (audyt 2026-08-03).
  tts_voice_pl: string | null;
  tts_voice_en: string | null;
  read_minutes: number | null;
  published_at: string | null;
  publish_at: string | null;
  builder_data: BuilderDocument | null;
  blocks_data: LocalizedBlocks | null;
  parent_page_id: string;
  post_format: PostFormat;
  layout_overrides: LayoutOverrides | null;
  takeaways_pl: string[];
  takeaways_en: string[];
  takeaways_variant: "card" | "heading" | "ghost" | null;
  toc_override: TocOverride | null;
  custom_meta: Record<string, string> | null;
  related_override: Record<string, unknown> | null;
  seo_title_pl: string | null;
  seo_title_en: string | null;
  seo_description_pl: string | null;
  seo_description_en: string | null;
  seo_canonical_url: string | null;
  seo_noindex: boolean;
  seo_og_image_url: string | null;
  og_image_generated_url: string | null;
  // Atrybucja organizacji: referencja do firmy w CRM + SNAPSHOT jej danych
  // prezentacyjnych. Snapshot nie jest duplikacją z lenistwa - crm_companies
  // czyta wyłącznie staff CRM, więc publiczny render nie ma jak dołączyć tej
  // tabeli (migracja 20260817090000).
  organization_id: string | null;
  organization_name: string | null;
  organization_logo_url: string | null;
  organization_website: string | null;
  // Ujawnienie komercyjnego charakteru materiału. Reguły i podstawy prawne:
  // src/lib/content/sponsored.ts.
  is_sponsored: boolean;
  sponsored_kind: SponsoredKind | null;
  sponsored_advertiser_name: string | null;
  /** Adres elektroniczny zlecającego - element ustawowy (uśude art. 9 ust. 1 pkt 1). */
  sponsored_advertiser_url: string | null;
  /** Płatnik, gdy inny niż reklamodawca (DSA art. 26 ust. 1 lit. c). */
  sponsored_payer_name: string | null;
  sponsored_note_pl: string | null;
  sponsored_note_en: string | null;
  sponsored_affiliate: boolean;
  /** Reklama polityczna wg rozp. (UE) 2024/900 - wiąże wydawcę bezpośrednio. */
  sponsored_political: boolean;
  sponsored_political_process: string | null;
  sponsored_sponsor_controller: string | null;
  /** Numer zlecenia/umowy - ślad rozliczalności, nigdy nie renderowany publicznie. */
  sponsored_order_ref: string | null;
  /**
   * TYLKO DO ODCZYTU (jak `published_at`): serwer stempluje to w chwili pierwszej
   * deklaracji i klient nigdy nie odsyła tego pola w payloadzie zapisu. Gdyby
   * odsyłał, każdy autozapis przepisywałby datę deklaracji na „teraz" i ślad
   * rozliczalności przestałby cokolwiek dowodzić.
   */
  sponsored_marked_at: string | null;
}

export interface CategoryOpt {
  id: string;
  name_pl: string;
  name_en: string;
}

export interface TagOpt {
  id: string;
  name: string;
}

/** Bilingual auto reading-time hint shown next to the manual `read_minutes`
 *  field (same core + settings as the public site). */
export interface AutoReadMinutes {
  pl: { minutes: number };
  en: { minutes: number };
}

/** Two-step editor flow: metadata first ("details"), then the writing surface
 *  ("content"). */
export type EditorStep = "details" | "content";
