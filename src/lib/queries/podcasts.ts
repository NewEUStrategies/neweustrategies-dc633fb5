// Public read-only podcast queries (anon-safe via RLS).
//
// Sieć programów: programy (podcast_shows) -> sezony -> odcinki (podcasts),
// uczestnicy odcinków (podcast_episode_people) + agregacje na profilu
// eksperta i stronie specjalizacji (kategorii).
import { queryOptions } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Podcast, PodcastPerson, PodcastSettings, PodcastShow } from "@/lib/podcast/types";

export const PODCAST_FIELDS =
  "id,tenant_id,slug,title_pl,title_en,excerpt_pl,excerpt_en,show_notes_pl,show_notes_en,transcript_pl,transcript_en,audio_url,duration_seconds,episode_number,season,cover_image_url,status,published_at,author_id,show_id,category_id,chapters,quotes,resources,created_at,updated_at";

export const PODCAST_SHOW_FIELDS =
  "id,tenant_id,slug,title_pl,title_en,description_pl,description_en,cover_image_url,spotify_url,apple_url,youtube_url,sort_order,status,created_at,updated_at";

export const latestPodcastsQueryOptions = (limit = 8) =>
  queryOptions({
    queryKey: ["podcasts", "latest", limit] as const,
    queryFn: async (): Promise<Podcast[]> => {
      const { data, error } = await supabase
        .from("podcasts")
        .select(PODCAST_FIELDS)
        .eq("status", "published")
        .is("deleted_at", null)
        .order("published_at", { ascending: false, nullsFirst: false })
        .limit(Math.max(1, Math.min(limit, 50)));
      if (error) throw error;
      return (data ?? []) as Podcast[];
    },
    staleTime: 60_000,
  });

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
      return (data ?? null) as Podcast | null;
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
      return (data ?? []) as Podcast[];
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

/**
 * Odcinki, w których ekspert występuje (prowadzący/gość przez profil) lub
 * których jest autorem. Zasila sekcję "Podcasty" na /author/$slug.
 */
export const podcastsByProfileQueryOptions = (profileId: string, limit = 12) =>
  queryOptions({
    queryKey: ["podcasts", "by-profile", profileId, limit] as const,
    queryFn: async (): Promise<Podcast[]> => {
      const { data: people, error: peopleError } = await supabase
        .from("podcast_episode_people")
        .select("episode_id")
        .eq("profile_id", profileId)
        .limit(200);
      if (peopleError) throw peopleError;
      const ids = Array.from(new Set((people ?? []).map((r) => r.episode_id as string)));

      // Dwie gałęzie (występy + autorstwo) zamiast .or() z podzapytaniem,
      // którego PostgREST nie wspiera dla listy id.
      const [byRole, byAuthor] = await Promise.all([
        ids.length
          ? supabase
              .from("podcasts")
              .select(PODCAST_FIELDS)
              .in("id", ids)
              .eq("status", "published")
              .is("deleted_at", null)
          : Promise.resolve({ data: [], error: null }),
        supabase
          .from("podcasts")
          .select(PODCAST_FIELDS)
          .eq("author_id", profileId)
          .eq("status", "published")
          .is("deleted_at", null)
          .order("published_at", { ascending: false, nullsFirst: false })
          .limit(limit),
      ]);
      if (byRole.error) throw byRole.error;
      if (byAuthor.error) throw byAuthor.error;

      const seen = new Set<string>();
      const merged: Podcast[] = [];
      for (const row of [...(byRole.data ?? []), ...(byAuthor.data ?? [])] as Podcast[]) {
        if (seen.has(row.id)) continue;
        seen.add(row.id);
        merged.push(row);
      }
      merged.sort((a, b) => (b.published_at ?? "").localeCompare(a.published_at ?? ""));
      return merged.slice(0, limit);
    },
    staleTime: 2 * 60_000,
    enabled: !!profileId,
  });

/** Odcinki przypięte do specjalizacji (kategorii) - sekcja na /category/$slug. */
export const podcastsByCategoryQueryOptions = (categoryId: string, limit = 8) =>
  queryOptions({
    queryKey: ["podcasts", "by-category", categoryId, limit] as const,
    queryFn: async (): Promise<Podcast[]> => {
      const { data, error } = await supabase
        .from("podcasts")
        .select(PODCAST_FIELDS)
        .eq("category_id", categoryId)
        .eq("status", "published")
        .is("deleted_at", null)
        .order("published_at", { ascending: false, nullsFirst: false })
        .limit(Math.max(1, Math.min(limit, 50)));
      if (error) throw error;
      return (data ?? []) as Podcast[];
    },
    staleTime: 2 * 60_000,
    enabled: !!categoryId,
  });
