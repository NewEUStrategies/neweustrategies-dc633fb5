// Public read-only podcast queries (anon-safe via RLS).
//
// Sieć programów: programy (podcast_shows) -> sezony -> odcinki (podcasts),
// uczestnicy odcinków (podcast_episode_people) + agregacje na profilu
// eksperta i stronie specjalizacji (kategorii).
//
// Lista najnowszych odcinków (`latestPodcastsQueryOptions`, kolumny karty)
// i pełna lista kolumn odcinka (`PODCAST_FIELDS`) mieszkają w `./podcastsLatest`
// - woła je rejestr prefetchu widgetów z chunku startowego. Sekcje „Podcasty"
// strony autora i strony kategorii/tagu mają własne liście
// (`./podcastsByProfile`, `./podcastsByCategory`), żeby trafiały do chunków tych
// stron, a nie do wspólnego chunku tego modułu (przegląd §9.10: dodatkowe
// żądanie w zestawie startowym /category, /tag, /author). Ten moduł ładują
// tylko trasy podcastów i panel.
import { queryOptions } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Podcast, PodcastPerson, PodcastSettings, PodcastShow } from "@/lib/podcast/types";
import { PODCAST_FIELDS } from "./podcastsLatest";

export const PODCAST_SHOW_FIELDS =
  "id,tenant_id,slug,title_pl,title_en,description_pl,description_en,cover_image_url,spotify_url,apple_url,youtube_url,sort_order,status,created_at,updated_at";

export const podcastBySlugQueryOptions = (slug: string) =>
  queryOptions({
    queryKey: ["podcasts", "slug", slug] as const,
    queryFn: async (): Promise<Podcast | null> => {
      const { data, error } = await supabase
        .from("podcasts")
        .select(PODCAST_FIELDS)
        .eq("slug", slug)
        .eq("status", "published")
        .is("deleted_at", null)
        .maybeSingle();
      if (error) throw error;
      return (data ?? null) as unknown as Podcast | null;
    },
    staleTime: 60_000,
    enabled: !!slug,
  });

export const podcastSettingsQueryOptions = queryOptions({
  queryKey: ["podcast-settings"] as const,
  queryFn: async (): Promise<PodcastSettings | null> => {
    const { data, error } = await supabase.from("podcast_settings").select("*").maybeSingle();
    if (error && error.code !== "PGRST116") throw error;
    return (data ?? null) as PodcastSettings | null;
  },
  staleTime: 5 * 60_000,
});

// ---------- programy (serie) ------------------------------------------------

export const publishedShowsQueryOptions = queryOptions({
  queryKey: ["podcast-shows", "published"] as const,
  queryFn: async (): Promise<PodcastShow[]> => {
    const { data, error } = await supabase
      .from("podcast_shows")
      .select(PODCAST_SHOW_FIELDS)
      .eq("status", "published")
      .is("deleted_at", null)
      .order("sort_order", { ascending: true })
      .order("title_pl", { ascending: true });
    if (error) throw error;
    return (data ?? []) as PodcastShow[];
  },
  staleTime: 5 * 60_000,
});

export const showBySlugQueryOptions = (slug: string) =>
  queryOptions({
    queryKey: ["podcast-shows", "slug", slug] as const,
    queryFn: async (): Promise<PodcastShow | null> => {
      const { data, error } = await supabase
        .from("podcast_shows")
        .select(PODCAST_SHOW_FIELDS)
        .eq("slug", slug)
        .eq("status", "published")
        .is("deleted_at", null)
        .maybeSingle();
      if (error) throw error;
      return (data ?? null) as PodcastShow | null;
    },
    staleTime: 60_000,
    enabled: !!slug,
  });

/** Wszystkie opublikowane odcinki programu (strona programu grupuje po sezonie). */
export const showEpisodesQueryOptions = (showId: string) =>
  queryOptions({
    queryKey: ["podcasts", "by-show", showId] as const,
    queryFn: async (): Promise<Podcast[]> => {
      const { data, error } = await supabase
        .from("podcasts")
        .select(PODCAST_FIELDS)
        .eq("show_id", showId)
        .eq("status", "published")
        .is("deleted_at", null)
        .order("season", { ascending: false, nullsFirst: false })
        .order("episode_number", { ascending: false, nullsFirst: false })
        .order("published_at", { ascending: false, nullsFirst: false })
        .limit(500);
      if (error) throw error;
      // `as unknown as`: kolumny explicit / episode_type pochodzą z migracji
      // 20260725090500 i nie ma ich jeszcze w wygenerowanych typach.
      return (data ?? []) as unknown as Podcast[];
    },
    staleTime: 60_000,
    enabled: !!showId,
  });

/**
 * Lekkie statystyki odcinków dla katalogu programów: liczba odcinków,
 * ostatnia publikacja i łączny czas per program (liczone po stronie klienta).
 */
export interface ShowEpisodeStat {
  show_id: string | null;
  published_at: string | null;
  duration_seconds: number;
}

export const showEpisodeStatsQueryOptions = queryOptions({
  queryKey: ["podcasts", "show-stats"] as const,
  queryFn: async (): Promise<ShowEpisodeStat[]> => {
    const { data, error } = await supabase
      .from("podcasts")
      .select("show_id,published_at,duration_seconds")
      .eq("status", "published")
      .is("deleted_at", null)
      .order("published_at", { ascending: false, nullsFirst: false })
      .limit(1000);
    if (error) throw error;
    return (data ?? []) as ShowEpisodeStat[];
  },
  staleTime: 5 * 60_000,
});

// ---------- uczestnicy (prowadzący / goście) --------------------------------

interface PersonRow {
  id: string;
  episode_id: string;
  profile_id: string | null;
  display_name: string;
  role: string;
  url: string | null;
  sort_order: number;
  profiles: { slug: string | null; display_name: string | null; avatar_url: string | null } | null;
}

function toPerson(row: PersonRow): PodcastPerson {
  return {
    id: row.id,
    episode_id: row.episode_id,
    profile_id: row.profile_id,
    // Nazwisko z profilu wygrywa, gdy wiersz nie ma własnego nadpisania.
    display_name: row.display_name || row.profiles?.display_name || "",
    role: row.role === "host" ? "host" : "guest",
    url: row.url,
    sort_order: row.sort_order,
    profile_slug: row.profiles?.slug ?? null,
    profile_avatar_url: row.profiles?.avatar_url ?? null,
  };
}

const PERSON_FIELDS =
  "id,episode_id,profile_id,display_name,role,url,sort_order,profiles(slug,display_name,avatar_url)";

export const episodePeopleQueryOptions = (episodeId: string) =>
  queryOptions({
    queryKey: ["podcast-people", "episode", episodeId] as const,
    queryFn: async (): Promise<PodcastPerson[]> => {
      const { data, error } = await supabase
        .from("podcast_episode_people")
        .select(PERSON_FIELDS)
        .eq("episode_id", episodeId)
        .order("sort_order", { ascending: true });
      if (error) throw error;
      return ((data ?? []) as unknown as PersonRow[]).map(toPerson);
    },
    staleTime: 60_000,
    enabled: !!episodeId,
  });

/** Uczestnicy wielu odcinków naraz (strona programu: prowadzący serii). */
export const episodesPeopleQueryOptions = (episodeIds: readonly string[]) =>
  queryOptions({
    queryKey: ["podcast-people", "episodes", [...episodeIds].sort().join(",")] as const,
    queryFn: async (): Promise<PodcastPerson[]> => {
      if (episodeIds.length === 0) return [];
      const { data, error } = await supabase
        .from("podcast_episode_people")
        .select(PERSON_FIELDS)
        .in("episode_id", episodeIds.slice(0, 500))
        .order("sort_order", { ascending: true });
      if (error) throw error;
      return ((data ?? []) as unknown as PersonRow[]).map(toPerson);
    },
    staleTime: 60_000,
    enabled: episodeIds.length > 0,
  });

// ---------- agregacje: profil eksperta + specjalizacja ----------------------
