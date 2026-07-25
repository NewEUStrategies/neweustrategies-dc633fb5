// Scalanie metadanych kanału podcastowego dla Apple Podcasts Connect.
//
// Są trzy warstwy, od najbardziej szczegółowej: PROGRAM (`podcast_shows`) ->
// KANAŁ SIECIOWY (`podcast_settings`) -> DOMYŚLNE MARKI (stała witryny). Apple
// wymaga, żeby WYNIK zawsze zawierał kategorię, `explicit` i okładkę, więc
// funkcja jest fail-safe: braki degradują do warstwy niżej, a nie do pustego
// tagu (kanał bez `<itunes:category>` nie zostanie przyjęty).
//
// Pure - żadnego dostępu do bazy; obie trasy RSS (sieciowa i per program)
// podają tu już wczytane wiersze, dzięki czemu reguła dziedziczenia ma jedną
// implementację i jeden zestaw testów.
import type { PodcastShowType } from "./podcastRss";
import { DEFAULT_APPLE_CATEGORY, DEFAULT_APPLE_SUBCATEGORY } from "./applePodcastCategories";

export interface PodcastChannelMetaSource {
  itunes_author: string | null;
  itunes_owner_name: string | null;
  itunes_owner_email: string | null;
  itunes_category: string | null;
  itunes_subcategory: string | null;
  itunes_explicit: boolean;
  itunes_type: string | null;
  itunes_image_url: string | null;
  itunes_copyright: string | null;
}

/** Nadpisania per program - NULL = dziedzicz z kanału sieciowego. */
export interface PodcastShowMetaOverride {
  itunes_author: string | null;
  itunes_owner_name: string | null;
  itunes_owner_email: string | null;
  itunes_category: string | null;
  itunes_subcategory: string | null;
  itunes_explicit: boolean | null;
  itunes_type: string | null;
  itunes_complete: boolean;
  cover_image_url: string | null;
}

export interface ResolvedPodcastChannelMeta {
  author: string | null;
  ownerName: string | null;
  ownerEmail: string | null;
  category: string;
  subcategory: string | null;
  explicit: boolean;
  showType: PodcastShowType;
  imageUrl: string | null;
  copyright: string | null;
  complete: boolean;
}

const trimmed = (v: string | null | undefined): string | null => {
  const s = (v ?? "").trim();
  return s === "" ? null : s;
};

function asShowType(v: string | null | undefined): PodcastShowType | null {
  return v === "episodic" || v === "serial" ? v : null;
}

export interface ResolveChannelMetaArgs {
  /** Wiersz `podcast_settings` tenanta (null = brak konfiguracji). */
  channel: PodcastChannelMetaSource | null;
  /** Wiersz programu przy feedzie per program (null przy feedzie sieciowym). */
  show?: PodcastShowMetaOverride | null;
  /** Domyślne marki: nazwa wydawcy i absolutny URL okładki zastępczej. */
  fallback: { author: string; imageUrl: string | null; copyright: string | null };
}

export function resolvePodcastChannelMeta(
  args: ResolveChannelMetaArgs,
): ResolvedPodcastChannelMeta {
  const { channel, show, fallback } = args;

  const author =
    trimmed(show?.itunes_author) ?? trimmed(channel?.itunes_author) ?? trimmed(fallback.author);
  const ownerName =
    trimmed(show?.itunes_owner_name) ?? trimmed(channel?.itunes_owner_name) ?? author;
  const ownerEmail = trimmed(show?.itunes_owner_email) ?? trimmed(channel?.itunes_owner_email);

  // Podkategoria idzie ZAWSZE z tej samej warstwy co kategoria - inaczej
  // program w "Government" mógłby odziedziczyć podkategorię "Politics"
  // z kanału "News", a Apple odrzuca obcą podkategorię.
  const showCategory = trimmed(show?.itunes_category);
  const channelCategory = trimmed(channel?.itunes_category);
  const { category, subcategory } = showCategory
    ? { category: showCategory, subcategory: trimmed(show?.itunes_subcategory) }
    : channelCategory
      ? { category: channelCategory, subcategory: trimmed(channel?.itunes_subcategory) }
      : { category: DEFAULT_APPLE_CATEGORY, subcategory: DEFAULT_APPLE_SUBCATEGORY };

  return {
    author,
    ownerName,
    ownerEmail,
    category,
    subcategory,
    explicit: show?.itunes_explicit ?? channel?.itunes_explicit ?? false,
    showType: asShowType(show?.itunes_type) ?? asShowType(channel?.itunes_type) ?? "episodic",
    imageUrl:
      trimmed(show?.cover_image_url) ?? trimmed(channel?.itunes_image_url) ?? fallback.imageUrl,
    copyright: trimmed(channel?.itunes_copyright) ?? trimmed(fallback.copyright),
    complete: show?.itunes_complete === true,
  };
}
