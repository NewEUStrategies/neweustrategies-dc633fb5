// Odcinki eksperta na /author/$slug - liść `queries/podcasts.ts` (roadmapa ładowania §9.10).
// Importuje go wyłącznie trasa `/author/$slug`, więc bundler wkłada go do chunku tej strony
// zamiast do wspólnego chunku zapytań podcastów: strona nie dostaje dodatkowego
// żądania w zestawie startowym. Kod przeniesiony bez zmian.
import { queryOptions } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Podcast } from "@/lib/podcast/types";
import { PODCAST_FIELDS } from "./podcastsLatest";

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
      for (const row of [
        ...(byRole.data ?? []),
        ...(byAuthor.data ?? []),
      ] as unknown as Podcast[]) {
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
