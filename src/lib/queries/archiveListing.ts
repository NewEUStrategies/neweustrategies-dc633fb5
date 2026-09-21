// Lista opublikowanych dzieci strony sekcyjnej (`template_type === 'archive_listing'`).
//
// DLACZEGO WYDZIELONE Z KOMPONENTU. Zapytanie stało jako literał wewnątrz
// `ArchiveListing`, więc loader trasy `/$` nie miał czego zaimportować i klucza
// `["archive-listing", parentPageId]` nie dało się rozgrzać. `useQuery` nie
// startuje na serwerze fetcha, więc SSR strony sekcyjnej emitował gałąź
// przejściową (`...`) zamiast listy do 60 wpisów - a ten HTML wchodził do NES
// Edge Cache na do 24 h. Trasy sekcyjne są typowo najsilniejsze linkowo, więc
// koszt tej ciszy był największy dokładnie tam, gdzie boli najbardziej.
//
// KLUCZ JEST NIETYKALNY: musi zostać identyczny z tym, co czyta komponent -
// inaczej rozgrzany wpis cache mija się z odczytem i SSR znów milczy.
import { queryOptions } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { SPONSORED_LIST_COLS } from "@/lib/content/sponsored";

export interface ArchiveListingRow {
  id: string;
  slug: string;
  title_pl: string;
  title_en: string;
  excerpt_pl: string | null;
  excerpt_en: string | null;
  cover_image_url: string | null;
  published_at: string | null;
  // Wymagane przez `PostCardData` - oznaczenie pozycji listy jest obowiązkiem
  // (UPNPR art. 7 pkt 11a), więc typ nie pozwala go pominąć w selekcie.
  is_sponsored: boolean | null;
  sponsored_kind: string | null;
  sponsored_affiliate: boolean | null;
}

/** Górna granica listy sekcyjnej - jedno źródło, żeby nie rozjechać się z SSR. */
export const ARCHIVE_LISTING_LIMIT = 60;

export const archiveListingQueryOptions = (parentPageId: string) =>
  queryOptions({
    queryKey: ["archive-listing", parentPageId] as const,
    staleTime: 2 * 60_000,
    queryFn: async (): Promise<ArchiveListingRow[]> => {
      const { data, error } = await supabase
        .from("posts")
        .select(
          `id, slug, title_pl, title_en, excerpt_pl, excerpt_en, cover_image_url, published_at, ${SPONSORED_LIST_COLS}`,
        )
        .eq("status", "published")
        .is("deleted_at", null)
        .eq("parent_page_id", parentPageId)
        .order("published_at", { ascending: false })
        .limit(ARCHIVE_LISTING_LIMIT);
      if (error) throw error;
      return (data ?? []) as ArchiveListingRow[];
    },
  });
