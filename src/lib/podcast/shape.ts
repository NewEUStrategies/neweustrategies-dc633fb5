// Czyste kształtowanie danych panelu podcastów - WYCIĄG z `routes/admin.podcasts.tsx`.
//
// Po co osobny plik: trasa liczyła 2072 linie i nosiła w środku slugifikację,
// budowę trzech payloadów zapisu, kaskadę domyślnych ustawień kanału i trzy
// selektory listy. Żadnej z tych reguł nie da się sprawdzić bez montowania
// panelu, więc żadna nie była sprawdzona. Tu stoją bez Reacta i bez Supabase,
// czyli tak, jak w `lib/programs/shape.ts`.
//
// EKSTRAKCJA, NIE PRZEPISANIE: te same pola, ta sama kolejność, te same
// wartości domyślne i te same wartości brzegowe (`|| null` kontra `?? ""`)
// co w trasie przed wyciągnięciem. Zmiana zachowania „przy okazji" nie miałaby
// tu żadnego testu, który by ją złapał - dlatego jej nie ma.
import type {
  Podcast,
  PodcastChapter,
  PodcastQuote,
  PodcastResource,
  PodcastSettings,
  PodcastShow,
  PodcastShowType,
  PodcastStatus,
} from "@/lib/podcast/types";
import { parseChapters, parseQuotes, parseResources } from "@/lib/podcast/types";
import {
  DEFAULT_APPLE_CATEGORY,
  DEFAULT_APPLE_SUBCATEGORY,
} from "@/lib/seo/applePodcastCategories";

/** Wiersz listy odcinków - dokładnie kolumny czytane przez listę panelu. */
export type AdminPodcastRow = Pick<
  Podcast,
  | "id"
  | "slug"
  | "title_pl"
  | "title_en"
  | "status"
  | "duration_seconds"
  | "episode_number"
  | "season"
  | "audio_url"
  | "cover_image_url"
  | "show_id"
> & { published_at: string | null };

/** Uczestnik w edytorze; profile_id albo display_name (jedno wymagane). */
export interface PersonDraft {
  id?: string;
  profile_id: string | null;
  display_name: string;
  role: "host" | "guest";
  url: string;
}

export interface CategoryOption {
  id: string;
  name_pl: string;
  name_en: string;
}

export interface ProfileOption {
  id: string;
  display_name: string | null;
  slug: string | null;
}

/** Wiersz `podcast_episode_people` czytany przez edytor (bez embedu profilu). */
export interface EpisodePersonRow {
  id: string;
  profile_id: string | null;
  display_name: string;
  role: string;
  url: string | null;
  sort_order: number;
}

/** Wszystko, co „Zapisz" w edytorze odcinka wysyła jednym strzałem. */
export interface EpisodeBundle {
  episode: Podcast;
  chapters: PodcastChapter[];
  quotes: PodcastQuote[];
  resources: PodcastResource[];
  people: PersonDraft[];
}

/** Filtr statusu nad listą odcinków (`all` = bez filtra). */
export type PodcastStatusFilter = "all" | PodcastStatus;

/** Kolejność przycisków filtra - taka, jak renderuje ją panel. */
export const PODCAST_STATUS_FILTERS = ["all", "published", "draft", "archived"] as const;

export interface PodcastAdminStats {
  total: number;
  published: number;
  drafts: number;
  totalSeconds: number;
}

/**
 * Slug z pola albo z tytułu PL. Puste wyjście jest sygnałem dla wołającego
 * (trasa rzuca wtedy `adminPodcasts.errors.slug`), a nie cichym zapisem
 * wiersza bez adresu.
 */
export function slugifyPodcast(slug: string, fallbackTitle: string): string {
  return (slug || fallbackTitle)
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Nowy szkic odcinka. `tenant_id: ""` jest placeholderem - prawdziwy tenant
 * wchodzi dopiero przy INSERT (patrz `saveAdminEpisode`), bo formularz nie ma
 * prawa go zmieniać.
 */
export function newEpisodeDraft(now: string = new Date().toISOString()): Podcast {
  return {
    id: "",
    tenant_id: "",
    slug: "",
    title_pl: "Nowy odcinek",
    title_en: "",
    excerpt_pl: "",
    excerpt_en: "",
    show_notes_pl: "",
    show_notes_en: "",
    transcript_pl: "",
    transcript_en: "",
    audio_url: "",
    duration_seconds: 0,
    episode_number: null,
    season: null,
    cover_image_url: null,
    status: "draft",
    published_at: null,
    author_id: null,
    show_id: null,
    category_id: null,
    chapters: [],
    quotes: [],
    resources: [],
    explicit: false,
    episode_type: "full",
    created_at: now,
    updated_at: now,
  };
}

/** Nowy szkic programu; `sort_order` idzie na koniec istniejącej listy. */
export function newShowDraft(
  showsCount: number,
  now: string = new Date().toISOString(),
): PodcastShow {
  return {
    id: "",
    tenant_id: "",
    slug: "",
    title_pl: "Nowy program",
    title_en: "",
    description_pl: "",
    description_en: "",
    cover_image_url: null,
    spotify_url: null,
    apple_url: null,
    youtube_url: null,
    sort_order: showsCount + 1,
    status: "draft",
    created_at: now,
    updated_at: now,
  };
}

/** Wiersz `podcasts` w postaci zapisywanej (21 pól - bez `tenant_id`). */
export interface EpisodePayload {
  slug: string;
  title_pl: string;
  title_en: string;
  excerpt_pl: string;
  excerpt_en: string;
  show_notes_pl: string;
  show_notes_en: string;
  transcript_pl: string;
  transcript_en: string;
  audio_url: string;
  duration_seconds: number;
  episode_number: number | null;
  season: number | null;
  cover_image_url: string | null;
  status: PodcastStatus;
  show_id: string | null;
  category_id: string | null;
  chapters: PodcastChapter[];
  quotes: PodcastQuote[];
  resources: PodcastResource[];
  explicit: boolean;
  episode_type: Podcast["episode_type"];
  published_at: string | null;
}

/**
 * Payload zapisu odcinka. Warstwy jsonb przechodzą przez parsery z `types.ts`
 * (śmieci i puste wpisy odpadają PRZED bazą), a `published_at` domyka się
 * bieżącą chwilą wyłącznie przy publikacji - szkic zachowuje swoją datę.
 */
export function buildEpisodePayload(
  bundle: EpisodeBundle,
  now: string = new Date().toISOString(),
): EpisodePayload {
  const { episode: p, chapters, quotes, resources } = bundle;
  return {
    slug: slugifyPodcast(p.slug, p.title_pl),
    title_pl: p.title_pl,
    title_en: p.title_en,
    excerpt_pl: p.excerpt_pl,
    excerpt_en: p.excerpt_en,
    show_notes_pl: p.show_notes_pl,
    show_notes_en: p.show_notes_en,
    transcript_pl: p.transcript_pl,
    transcript_en: p.transcript_en,
    audio_url: p.audio_url,
    duration_seconds: p.duration_seconds,
    episode_number: p.episode_number,
    season: p.season,
    cover_image_url: p.cover_image_url,
    status: p.status,
    show_id: p.show_id,
    category_id: p.category_id,
    // Zapisujemy tylko poprawne wpisy (parsery odsiewają śmieci/puste).
    chapters: parseChapters(chapters),
    quotes: parseQuotes(quotes),
    resources: parseResources(resources),
    explicit: p.explicit,
    episode_type: p.episode_type,
    published_at: p.status === "published" ? (p.published_at ?? now) : p.published_at,
  };
}

/** Wiersz `podcast_shows` w postaci zapisywanej (10 pól - bez `tenant_id`). */
export interface ShowPayload {
  slug: string;
  title_pl: string;
  title_en: string;
  description_pl: string;
  description_en: string;
  cover_image_url: string | null;
  spotify_url: string | null;
  apple_url: string | null;
  youtube_url: string | null;
  sort_order: number;
  status: PodcastStatus;
}

/** Payload zapisu programu. Puste adresy platform idą jako NULL, nie `""`. */
export function buildShowPayload(s: PodcastShow): ShowPayload {
  return {
    slug: slugifyPodcast(s.slug, s.title_pl),
    title_pl: s.title_pl,
    title_en: s.title_en,
    description_pl: s.description_pl,
    description_en: s.description_en,
    cover_image_url: s.cover_image_url,
    spotify_url: s.spotify_url || null,
    apple_url: s.apple_url || null,
    youtube_url: s.youtube_url || null,
    sort_order: s.sort_order,
    status: s.status,
  };
}

/** Wiersz `podcast_settings` (singleton per tenant, PK = `tenant_id`). */
export interface SettingsPayload {
  tenant_id: string;
  default_player_variant: PodcastSettings["default_player_variant"];
  autoplay_next: boolean;
  show_speed_control: boolean;
  spotify_url: string | null;
  apple_url: string | null;
  google_url: string | null;
  rss_url: string | null;
  itunes_author: string | null;
  itunes_owner_name: string | null;
  itunes_owner_email: string | null;
  itunes_category: string;
  itunes_subcategory: string | null;
  itunes_explicit: boolean;
  itunes_type: PodcastShowType;
  itunes_image_url: string | null;
  itunes_copyright: string | null;
}

/**
 * Payload ustawień kanału. `itunes_category` NIE może wyjść puste - Apple
 * odrzuca kanał bez kategorii, więc pusta wartość wraca do domyślnej zamiast
 * lecieć jako NULL (odwrotnie niż pozostałe pola opcjonalne).
 */
export function buildSettingsPayload(merged: PodcastSettings, tenantId: string): SettingsPayload {
  return {
    tenant_id: tenantId,
    default_player_variant: merged.default_player_variant,
    autoplay_next: merged.autoplay_next,
    show_speed_control: merged.show_speed_control,
    spotify_url: merged.spotify_url || null,
    apple_url: merged.apple_url || null,
    google_url: merged.google_url || null,
    rss_url: merged.rss_url || null,
    itunes_author: merged.itunes_author || null,
    itunes_owner_name: merged.itunes_owner_name || null,
    itunes_owner_email: merged.itunes_owner_email || null,
    itunes_category: merged.itunes_category || DEFAULT_APPLE_CATEGORY,
    itunes_subcategory: merged.itunes_subcategory || null,
    itunes_explicit: merged.itunes_explicit,
    itunes_type: merged.itunes_type,
    itunes_image_url: merged.itunes_image_url || null,
    itunes_copyright: merged.itunes_copyright || null,
  };
}

/** Wiersz `podcast_episode_people` w postaci zapisywanej. */
export interface EpisodePersonPayload {
  tenant_id: string;
  episode_id: string;
  profile_id: string | null;
  display_name: string;
  role: "host" | "guest";
  url: string | null;
  sort_order: number;
}

/**
 * Wiersze uczestników do wstawienia. `sort_order` bierze się z KOLEJNOŚCI
 * w edytorze, a wiersz bez profilu i bez nazwiska odpada tutaj - to
 * odpowiednik CHECK w bazie, tylko z czytelnym skutkiem w UI (wiersz-widmo
 * nie blokuje całego zapisu).
 */
export function buildEpisodePeopleRows(
  people: readonly PersonDraft[],
  tenantId: string,
  episodeId: string,
): EpisodePersonPayload[] {
  return people
    .map((person, idx) => ({
      tenant_id: tenantId,
      episode_id: episodeId,
      profile_id: person.profile_id,
      display_name: person.display_name.trim(),
      role: person.role,
      url: person.url.trim() || null,
      sort_order: idx,
    }))
    .filter((person) => person.profile_id || person.display_name);
}

/** Wiersz z bazy -> wersja robocza edytora (rola poza enumem staje się gościem). */
export function rowToPersonDraft(row: EpisodePersonRow): PersonDraft {
  return {
    id: row.id,
    profile_id: row.profile_id,
    display_name: row.display_name ?? "",
    role: row.role === "host" ? "host" : "guest",
    url: row.url ?? "",
  };
}

/**
 * Kaskada ustawień kanału: wersja robocza formularza -> zapisany wiersz ->
 * wartość domyślna. Liczona przy każdym renderze (jak w trasie przed
 * wyciągnięciem), bo od jej pól zależy karta gotowości feedu.
 *
 * `autoplay_next` świadomie nie ma przełącznika w UI - kolumna istnieje,
 * ale żaden odtwarzacz jej nie konsumuje, więc panel zapisuje wartość
 * zapisaną albo domyślną, zamiast wystawiać martwy przełącznik.
 */
export function mergePodcastSettings(
  form: Partial<PodcastSettings>,
  data: PodcastSettings | null | undefined,
  tenantId: string | null,
): PodcastSettings {
  return {
    tenant_id: tenantId ?? "",
    default_player_variant: form.default_player_variant ?? data?.default_player_variant ?? "full",
    autoplay_next: form.autoplay_next ?? data?.autoplay_next ?? false,
    show_speed_control: form.show_speed_control ?? data?.show_speed_control ?? true,
    spotify_url: form.spotify_url ?? data?.spotify_url ?? "",
    apple_url: form.apple_url ?? data?.apple_url ?? "",
    google_url: form.google_url ?? data?.google_url ?? "",
    rss_url: form.rss_url ?? data?.rss_url ?? "",
    // Metadane Apple Podcasts Connect - bez nich kanał nie jest przyjmowany.
    itunes_author: form.itunes_author ?? data?.itunes_author ?? "",
    itunes_owner_name: form.itunes_owner_name ?? data?.itunes_owner_name ?? "",
    itunes_owner_email: form.itunes_owner_email ?? data?.itunes_owner_email ?? "",
    itunes_category: form.itunes_category ?? data?.itunes_category ?? DEFAULT_APPLE_CATEGORY,
    itunes_subcategory:
      form.itunes_subcategory ?? data?.itunes_subcategory ?? DEFAULT_APPLE_SUBCATEGORY,
    itunes_explicit: form.itunes_explicit ?? data?.itunes_explicit ?? false,
    itunes_type: form.itunes_type ?? data?.itunes_type ?? "episodic",
    itunes_image_url: form.itunes_image_url ?? data?.itunes_image_url ?? "",
    itunes_copyright: form.itunes_copyright ?? data?.itunes_copyright ?? "",
  };
}

/**
 * Pola formularza Apple Podcasts w kształcie, w jakim wystawia je sekcja
 * metadanych panelu. Struktura celowo powtórzona tutaj, a nie zaimportowana
 * z komponentu - warstwa danych nie zależy od widoku.
 */
export interface ApplePodcastMetaDraft {
  author: string;
  ownerName: string;
  ownerEmail: string;
  category: string;
  subcategory: string;
  explicit: boolean;
  showType: PodcastShowType;
  imageUrl: string;
  copyright: string;
}

/**
 * Łatka z sekcji Apple -> łatka kolumn `itunes_*`. Przepisujemy WYŁĄCZNIE
 * pola obecne w łatce: `undefined` w wyniku nadpisałoby zapisaną wartość
 * pustką przy najbliższym zapisie.
 */
export function appleMetaToSettingsPatch(
  patch: Partial<ApplePodcastMetaDraft>,
): Partial<PodcastSettings> {
  return {
    ...(patch.author !== undefined ? { itunes_author: patch.author } : {}),
    ...(patch.ownerName !== undefined ? { itunes_owner_name: patch.ownerName } : {}),
    ...(patch.ownerEmail !== undefined ? { itunes_owner_email: patch.ownerEmail } : {}),
    ...(patch.category !== undefined ? { itunes_category: patch.category } : {}),
    ...(patch.subcategory !== undefined ? { itunes_subcategory: patch.subcategory } : {}),
    ...(patch.explicit !== undefined ? { itunes_explicit: patch.explicit } : {}),
    ...(patch.showType !== undefined ? { itunes_type: patch.showType } : {}),
    ...(patch.imageUrl !== undefined ? { itunes_image_url: patch.imageUrl } : {}),
    ...(patch.copyright !== undefined ? { itunes_copyright: patch.copyright } : {}),
  };
}

/** Etykieta programu na liście panelu: PL -> EN -> slug (nigdy pusta). */
export function showListTitle(s: Pick<PodcastShow, "title_pl" | "title_en" | "slug">): string {
  return s.title_pl || s.title_en || s.slug;
}

/** Etykieta odcinka na liście panelu: PL -> EN -> slug (nigdy pusta). */
export function episodeListTitle(
  r: Pick<AdminPodcastRow, "title_pl" | "title_en" | "slug">,
): string {
  return r.title_pl || r.title_en || r.slug;
}

/** Indeks tytułów programów po id - do kolumny „Program" na liście odcinków. */
export function showTitleIndex(shows: readonly PodcastShow[] | undefined): Map<string, string> {
  const index = new Map<string, string>();
  for (const s of shows ?? []) index.set(s.id, showListTitle(s));
  return index;
}

/** Cztery liczniki nad listą. `duration_seconds` null/0 liczy się jako zero. */
export function podcastAdminStats(rows: readonly AdminPodcastRow[] | undefined): PodcastAdminStats {
  const list = rows ?? [];
  return {
    total: list.length,
    published: list.filter((r) => r.status === "published").length,
    drafts: list.filter((r) => r.status === "draft").length,
    totalSeconds: list.reduce((acc, r) => acc + (r.duration_seconds || 0), 0),
  };
}

/**
 * Filtr listy: status ORAZ fraza (tytuł PL, tytuł EN, slug - bez wielkości
 * liter). Pusta fraza przepuszcza wszystko, co przeszło filtr statusu.
 */
export function filterPodcastRows(
  rows: readonly AdminPodcastRow[] | undefined,
  search: string,
  statusFilter: PodcastStatusFilter,
): AdminPodcastRow[] {
  const q = search.trim().toLowerCase();
  return (rows ?? []).filter((r) => {
    if (statusFilter !== "all" && r.status !== statusFilter) return false;
    if (!q) return true;
    return (
      r.title_pl?.toLowerCase().includes(q) ||
      r.title_en?.toLowerCase().includes(q) ||
      r.slug?.toLowerCase().includes(q)
    );
  });
}

/**
 * Znacznik sezonu/numeru w podglądzie edytora (`S2 · E7`). Pusty ciąg, gdy
 * odcinek nie ma ani sezonu, ani numeru - podgląd nie rysuje wtedy plakietki.
 */
export function episodeSeasonLabel(e: Pick<Podcast, "season" | "episode_number">): string {
  return [e.season ? `S${e.season}` : null, e.episode_number ? `E${e.episode_number}` : null]
    .filter(Boolean)
    .join(" · ");
}
