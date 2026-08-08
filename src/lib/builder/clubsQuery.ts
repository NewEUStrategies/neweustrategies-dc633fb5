// Warstwa danych widgetów klubów dyskusyjnych (`club-card` / `club-threads`).
//
// PO CO OSOBNY MODUŁ, a nie import z `lib/clubs/api`: rejestr prefetchu SSR musi
// widzieć te same `queryOptions`, co klient - tak samo jak przy wydarzeniach
// (`eventsQuery.ts`). Osobny moduł trzyma też chunk widgetu wąskim: cała
// warstwa danych modułu klubów to ~40 funkcji, a widget potrzebuje dwóch.
//
// IZOLACJA TENANTA I WIDOCZNOŚĆ liczy się w bazie, nie tutaj. `club_list`
// zwraca anonimowi WYŁĄCZNIE kluby `public` o statusie `active`, a
// `club_activity_feed` jest nadane roli `authenticated` i liczy widoczność per
// wiersz. Widget nie ma więc jak pokazać klubu, którego wołający nie zobaczyłby
// wchodząc na `/club` - a to jest ta własność, której nie wolno przenosić do
// komponentu.
import { queryOptions } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { WIDGET_QUERY_ROOTS } from "@/lib/builder/queryKeys";

export interface ClubCardRow {
  id: string;
  slug: string;
  name_pl: string;
  name_en: string;
  tagline_pl: string | null;
  tagline_en: string | null;
  icon: string | null;
  accent_color: string | null;
  cover_image_url: string | null;
  policy_area: string | null;
  member_count: number;
  thread_count: number;
  visibility: string;
}

export interface ClubThreadTeaserRow {
  thread_id: string;
  thread_slug: string;
  title: string;
  kind: string;
  club_slug: string;
  club_name_pl: string;
  club_name_en: string;
  reply_count: number;
  last_reply_at: string | null;
}

/**
 * Karta jednego klubu po adresie. Pusty adres = brak zapytania (widget stoi
 * w panelu nieskonfigurowany i nie ma po co pukać do bazy).
 */
export function clubCardQueryOptions(slug: string) {
  const key = slug.trim();
  return queryOptions({
    queryKey: [WIDGET_QUERY_ROOTS.clubCard, key] as const,
    enabled: key.length > 0,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<ClubCardRow | null> => {
      const { data, error } = await supabase.rpc("club_view", { p_slug: key });
      if (error) throw error;
      const row = data?.[0];
      if (!row) return null;
      return {
        id: row.id,
        slug: row.slug,
        name_pl: row.name_pl,
        name_en: row.name_en,
        tagline_pl: row.tagline_pl,
        tagline_en: row.tagline_en,
        icon: row.icon,
        accent_color: row.accent_color,
        cover_image_url: row.cover_image_url,
        policy_area: row.policy_area,
        member_count: row.member_count,
        thread_count: row.thread_count,
        visibility: row.visibility,
      };
    },
  });
}

/**
 * Strumień aktywności PONAD klubami - to samo źródło, co panel na `/club`.
 * Widget na stronie głównej ma pokazywać, że kluby żyją, a nie odpytywać każdy
 * z osobna; `club_activity_feed` robi to jednym zapytaniem.
 */
export function clubThreadsQueryOptions(params: {
  sort: string;
  policyArea: string;
  limit: number;
}) {
  const sort = params.sort === "new" ? "new" : "hot";
  const area = params.policyArea.trim();
  const limit = Math.min(Math.max(params.limit, 1), 12);
  return queryOptions({
    queryKey: [WIDGET_QUERY_ROOTS.clubThreads, sort, area, limit] as const,
    staleTime: 60_000,
    queryFn: async (): Promise<ClubThreadTeaserRow[]> => {
      const { data, error } = await supabase.rpc("club_activity_feed", {
        p_sort: sort,
        p_policy_area: area.length > 0 ? area : undefined,
        p_limit: limit,
      });
      if (error) throw error;
      return (data ?? []).map((row) => ({
        thread_id: row.thread_id,
        thread_slug: row.thread_slug,
        title: row.title,
        kind: row.kind,
        club_slug: row.club_slug,
        club_name_pl: row.club_name_pl,
        club_name_en: row.club_name_en,
        reply_count: row.reply_count,
        last_reply_at: row.last_reply_at,
      }));
    },
  });
}
