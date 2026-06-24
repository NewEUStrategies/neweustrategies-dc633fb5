// Public read-only podcast queries (anon-safe via RLS).
import { queryOptions } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Podcast, PodcastSettings } from "@/lib/podcast/types";

export const PODCAST_FIELDS =
  "id,tenant_id,slug,title_pl,title_en,excerpt_pl,excerpt_en,show_notes_pl,show_notes_en,transcript_pl,transcript_en,audio_url,duration_seconds,episode_number,season,cover_image_url,status,published_at,author_id,created_at,updated_at";

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
