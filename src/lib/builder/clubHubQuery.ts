// Zapytania sekcji widgetu „Klub: strona" (`club-hub`) - liść `./clubsQuery`
// (roadmapa ładowania §9.10).
//
// `clubsQuery.ts` jedzie w chunku startowym każdej strony, bo rejestr
// prefetchu widgetów (`prefetch.ts`, statyczny import `__root.tsx`) grzeje
// `clubCardQueryOptions` i `clubThreadsQueryOptions`. Trzech zapytań sekcji
// strony klubu (artykuły, komentarze, zapisy) prefetch nie zna - czyta je
// wyłącznie leniwy widok `ClubHubView`, więc ten liść jedzie w jego chunku.
// Kod przeniesiony bez zmian.
//
// Bez reeksportu z `clubsQuery.ts`: krawędź z modułu bootu do tego liścia
// wciągnęłaby go z powrotem (strażnik `bootLazyLeaves.gate.test.ts`).
import { queryOptions } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { WIDGET_QUERY_ROOTS } from "@/lib/builder/queryKeys";

// ---------------------------------------------------------------------------
// Widget „Klub: strona" (`club-hub`) - trzy sekcje strony klubu z panelu:
// artykuły (wątki), komentarze (wpisy ściany) i zapisy (członkowie).
//
// KAŻDA SEKCJA MA WŁASNE ZAPYTANIE, a nie jedno wspólne: sekcje da się wyłączyć
// pojedynczo w panelu, więc wspólne zapytanie ściągałoby dane, których widget
// nigdy nie pokaże. `enabled` liczy się z identyfikatora klubu - dopóki adres
// nie jest rozwiązany, nie ma po co pukać do bazy.
//
// AUTORYZACJA JEST W BAZIE. `club_threads_list`, `club_posts_list` i
// `club_members_list` to SECURITY DEFINER po `club_capabilities`: czytelnik bez
// dostępu dostaje błąd albo pustkę, a widget renderuje ciszę (patrz komponent).
// `retry: false` jest tu świadome - odmowa dostępu nie zmieni się po trzeciej
// próbie, a każda próba to kolejny odrzucony strzał do bazy.

export interface ClubHubArticleRow {
  id: string;
  slug: string;
  title: string;
  excerpt: string | null;
  author_name: string | null;
  created_at: string | null;
  last_reply_at: string | null;
  reply_count: number;
  reaction_count: number;
}

export interface ClubHubCommentRow {
  id: string;
  body: string;
  author_name: string | null;
  author_avatar: string | null;
  author_slug: string | null;
  thread_slug: string | null;
  thread_title: string | null;
  created_at: string | null;
  like_count: number;
}

export interface ClubHubMemberRow {
  user_id: string;
  display_name: string | null;
  avatar_url: string | null;
  slug: string | null;
  job_title: string | null;
  current_company: string | null;
  role: string;
  joined_at: string | null;
  verified: boolean;
  total_count: number;
}

export function clubHubArticlesQueryOptions(clubId: string, limit: number) {
  const key = clubId.trim();
  return queryOptions({
    queryKey: [WIDGET_QUERY_ROOTS.clubHubArticles, key, limit] as const,
    enabled: key.length > 0,
    staleTime: 60_000,
    retry: false,
    queryFn: async (): Promise<ClubHubArticleRow[]> => {
      const { data, error } = await supabase.rpc("club_threads_list", {
        p_club_id: key,
        p_sort: "new",
        p_limit: limit,
      });
      if (error) throw error;
      return (data ?? []).map((row) => ({
        id: row.id,
        slug: row.slug,
        title: row.title,
        excerpt: row.excerpt,
        author_name: row.author_name,
        created_at: row.created_at,
        last_reply_at: row.last_reply_at,
        reply_count: Number(row.reply_count ?? 0),
        reaction_count: Number(row.reaction_count ?? 0),
      }));
    },
  });
}

export function clubHubCommentsQueryOptions(clubId: string, limit: number) {
  const key = clubId.trim();
  return queryOptions({
    queryKey: [WIDGET_QUERY_ROOTS.clubHubComments, key, limit] as const,
    enabled: key.length > 0,
    staleTime: 30_000,
    retry: false,
    queryFn: async (): Promise<ClubHubCommentRow[]> => {
      const { data, error } = await supabase.rpc("club_posts_list", {
        p_club_id: key,
        p_limit: limit,
      });
      if (error) throw error;
      return (data ?? []).map((row) => ({
        id: row.id,
        body: row.body,
        author_name: row.author_name,
        author_avatar: row.author_avatar,
        author_slug: row.author_slug,
        thread_slug: row.thread_slug,
        thread_title: row.thread_title,
        created_at: row.created_at,
        like_count: Number(row.like_count ?? 0),
      }));
    },
  });
}

export function clubHubMembersQueryOptions(clubId: string, limit: number) {
  const key = clubId.trim();
  return queryOptions({
    queryKey: [WIDGET_QUERY_ROOTS.clubHubMembers, key, limit] as const,
    enabled: key.length > 0,
    staleTime: 5 * 60_000,
    retry: false,
    queryFn: async (): Promise<ClubHubMemberRow[]> => {
      const { data, error } = await supabase.rpc("club_members_list", {
        p_club_id: key,
        p_status: "active",
        p_limit: limit,
      });
      if (error) throw error;
      return (data ?? []).map((row) => ({
        user_id: row.user_id,
        display_name: row.display_name,
        avatar_url: row.avatar_url,
        slug: row.slug,
        job_title: row.job_title,
        current_company: row.current_company,
        role: row.role,
        joined_at: row.joined_at,
        verified: row.verified === true,
        total_count: Number(row.total_count ?? 0),
      }));
    },
  });
}
