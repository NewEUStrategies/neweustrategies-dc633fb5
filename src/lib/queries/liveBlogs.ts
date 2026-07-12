// Publiczny indeks relacji na żywo (/live). Live blog dotąd nie miał ŻADNEGO
// publicznego URL-a ani powierzchni odkrywania - wpisy renderowały się tylko
// wewnątrz posta osadzającego blok liveblog. Ten moduł wyprowadza listę
// "postów z relacją" z live_blog_entries (RLS: wpisy czytelne wyłącznie dla
// opublikowanych postów; posty przechodzą przez własny RLS tenanta, więc
// relacje spoza widocznego tenanta odpadają na złączeniu).
import { queryOptions } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { BlogListItem } from "@/lib/queries/public";

/** Relacja "żyje", jeśli ostatni wpis pojawił się w tym oknie. */
export const LIVE_WINDOW_MS = 3 * 60 * 60 * 1000;

export interface LiveBlogListItem {
  post: BlogListItem;
  lastEntryAt: string;
  entryCount: number;
}

export function isLiveNow(lastEntryAt: string, now: number = Date.now()): boolean {
  const t = new Date(lastEntryAt).getTime();
  return Number.isFinite(t) && now - t < LIVE_WINDOW_MS;
}

const POST_COLS =
  "id, slug, title_pl, title_en, excerpt_pl, excerpt_en, cover_image_url, published_at, parent_page_id";

export const liveBlogsQueryOptions = (limit = 30) =>
  queryOptions({
    queryKey: ["public", "live-blogs", { limit }] as const,
    staleTime: 30_000,
    queryFn: async (): Promise<LiveBlogListItem[]> => {
      // Najświeższe wpisy (deduplikacja po poście niżej). 600 wpisów pokrywa
      // z zapasem realne użycie; starsze relacje i tak są zakończone.
      const { data: entries, error } = await supabase
        .from("live_blog_entries")
        .select("post_id, occurred_at")
        .order("occurred_at", { ascending: false })
        .limit(600);
      if (error) throw error;

      const byPost = new Map<string, { lastEntryAt: string; entryCount: number }>();
      for (const e of entries ?? []) {
        const cur = byPost.get(e.post_id);
        if (cur) cur.entryCount += 1;
        else byPost.set(e.post_id, { lastEntryAt: e.occurred_at, entryCount: 1 });
      }
      const postIds = Array.from(byPost.keys()).slice(0, limit * 2);
      if (postIds.length === 0) return [];

      const { data: posts, error: postsError } = await supabase
        .from("posts")
        .select(POST_COLS)
        .in("id", postIds)
        .eq("status", "published")
        .is("deleted_at", null);
      if (postsError) throw postsError;

      const rows = (posts ?? []) as Array<Omit<BlogListItem, "href">>;
      // Href = ścieżka strony-rodzica + slug (ta sama reguła co archiwa).
      const parentIds = Array.from(new Set(rows.map((r) => r.parent_page_id)));
      const paths = new Map<string, string>();
      await Promise.all(
        parentIds.map(async (pid) => {
          const { data } = await supabase.rpc("page_full_path", { _page_id: pid });
          if (typeof data === "string") paths.set(pid, data);
        }),
      );

      return rows
        .map((r) => ({
          post: { ...r, href: `/${paths.get(r.parent_page_id) ?? "blog"}/${r.slug}` },
          lastEntryAt: byPost.get(r.id)!.lastEntryAt,
          entryCount: byPost.get(r.id)!.entryCount,
        }))
        .sort((a, b) => (a.lastEntryAt < b.lastEntryAt ? 1 : -1))
        .slice(0, limit);
    },
  });
