// Lista najnowszych odcinków (`/podcasts`, widget CMS `podcast-latest`) - część
// `podcasts.ts` potrzebna w chunku startowym (roadmapa ładowania §9.10).
//
// Rejestr prefetchu widgetów (`lib/builder/prefetch.ts` -> `mediaListQuery`,
// statyczny import `routes/__root.tsx`) woła z zapytań podcastów wyłącznie
// `latestPodcastsQueryOptions`. Dopóki leżała w `podcasts.ts`, do `app-initial`
// (każda strona czytelnika) wchodziły też zapytania odcinka, programów,
// uczestników, profilu i kategorii - używane tylko przez trasy podcastów,
// stronę autora i taksonomii (chunki leniwe). Kod przeniesiony bez zmian.
//
// Bez reeksportu z `podcasts.ts` (i bez importu stamtąd): krawędź między
// tymi modułami wciągnęłaby zapytania stron z powrotem do bootu (strażnik
// `bootLazyLeaves.gate.test.ts`).
import { queryOptions } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Podcast } from "@/lib/podcast/types";

/** Pełne kolumny odcinka (strona odcinka, sekcje autora i kategorii). */
export const PODCAST_FIELDS =
  "id,tenant_id,slug,title_pl,title_en,excerpt_pl,excerpt_en,show_notes_pl,show_notes_en,transcript_pl,transcript_en,audio_url,duration_seconds,episode_number,season,cover_image_url,status,published_at,author_id,show_id,category_id,chapters,quotes,resources,explicit,episode_type,created_at,updated_at";

/**
 * Kolumny KARTY odcinka na listach (katalog /podcasts, widżet CMS
 * `podcast-latest`) - dokładnie to, co karta renderuje. Bez transkrypcji,
 * notatek i jsonb (do 30 pełnych odcinków w dehydrowanym ładunku SSR) i bez
 * metadanych Apple (`explicit`, `episode_type`), których lista nie czyta.
 * Incydent 2026-10-09: pełne PODCAST_FIELDS kończyło się na produkcji 42703
 * („column podcasts.explicit does not exist", migracja 20260725090500 nigdy
 * nie poszła), więc katalog renderował wyłącznie komunikat awarii.
 */
export const PODCAST_LIST_FIELDS =
  "id,slug,title_pl,title_en,excerpt_pl,excerpt_en,audio_url,duration_seconds,episode_number,season,cover_image_url,published_at,show_id";

export type PodcastListItem = Pick<
  Podcast,
  | "id"
  | "slug"
  | "title_pl"
  | "title_en"
  | "excerpt_pl"
  | "excerpt_en"
  | "audio_url"
  | "duration_seconds"
  | "episode_number"
  | "season"
  | "cover_image_url"
  | "published_at"
  | "show_id"
>;

export const latestPodcastsQueryOptions = (limit = 8) =>
  queryOptions({
    queryKey: ["podcasts", "latest", limit] as const,
    queryFn: async (): Promise<PodcastListItem[]> => {
      const { data, error } = await supabase
        .from("podcasts")
        .select(PODCAST_LIST_FIELDS)
        .eq("status", "published")
        .is("deleted_at", null)
        .order("published_at", { ascending: false, nullsFirst: false })
        .limit(Math.max(1, Math.min(limit, 50)));
      if (error) throw error;
      // Bez rzutowania: każda kolumna listy jest w wygenerowanych typach.
      return data ?? [];
    },
    staleTime: 60_000,
  });
