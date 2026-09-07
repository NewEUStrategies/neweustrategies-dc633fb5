// Zapisane elementy w doku: zakładki wpisów/stron (user_bookmarks) i zapisane
// wydarzenia (event_bookmarks) sprowadzone do JEDNEJ listy z tytułem i linkiem.
// Nie duplikujemy logiki zapisu - ta warstwa tylko CZYTA to, co zapisały
// istniejące przyciski (SaveArticleButton, EventBookmarkButton).
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { dockKeys } from "./keys";

export type SavedKind = "post" | "page" | "event";

export interface SavedEntry {
  id: string;
  kind: SavedKind;
  entityId: string;
  title: string;
  href: string;
  savedAt: string;
}

interface BookmarkRow {
  id: string;
  entity_type: string;
  entity_id: string;
  created_at: string;
}

function pick(pl: string | null | undefined, en: string | null | undefined, lang: string): string {
  const primary = lang === "en" ? en : pl;
  return (primary ?? en ?? pl ?? "").trim();
}

export function useSavedEntries(lang: "pl" | "en") {
  const { user } = useAuth();
  return useQuery({
    queryKey: [...dockKeys.saved(user?.id), lang],
    enabled: !!user,
    queryFn: async (): Promise<SavedEntry[]> => {
      const [bookmarks, eventBookmarks] = await Promise.all([
        supabase
          .from("user_bookmarks")
          .select("id, entity_type, entity_id, created_at")
          .order("created_at", { ascending: false })
          .limit(100),
        supabase
          .from("event_bookmarks")
          .select("id, event_id, created_at")
          .order("created_at", { ascending: false })
          .limit(100),
      ]);
      if (bookmarks.error) throw bookmarks.error;
      if (eventBookmarks.error) throw eventBookmarks.error;

      const rows = (bookmarks.data ?? []) as BookmarkRow[];
      const postIds = rows.filter((r) => r.entity_type === "post").map((r) => r.entity_id);
      const pageIds = rows.filter((r) => r.entity_type === "page").map((r) => r.entity_id);
      const eventIds = (eventBookmarks.data ?? []).map((r) => r.event_id as string);

      const [posts, pages, events] = await Promise.all([
        postIds.length
          ? supabase.from("posts").select("id, slug, title_pl, title_en").in("id", postIds)
          : Promise.resolve({ data: [], error: null }),
        pageIds.length
          ? supabase.from("pages").select("id, slug, title_pl, title_en").in("id", pageIds)
          : Promise.resolve({ data: [], error: null }),
        eventIds.length
          ? supabase.from("events").select("id, slug, title_pl, title_en").in("id", eventIds)
          : Promise.resolve({ data: [], error: null }),
      ]);

      type Titled = { id: string; slug: string; title_pl: string | null; title_en: string | null };
      const index = new Map<string, Titled>();
      for (const list of [posts.data ?? [], pages.data ?? [], events.data ?? []]) {
        for (const row of list as Titled[]) index.set(row.id, row);
      }

      const entries: SavedEntry[] = [];
      for (const row of rows) {
        if (row.entity_type !== "post" && row.entity_type !== "page") continue;
        const meta = index.get(row.entity_id);
        if (!meta) continue;
        entries.push({
          id: row.id,
          kind: row.entity_type,
          entityId: row.entity_id,
          title: pick(meta.title_pl, meta.title_en, lang) || meta.slug,
          href: row.entity_type === "post" ? `/${meta.slug}` : `/${meta.slug}`,
          savedAt: row.created_at,
        });
      }
      for (const row of (eventBookmarks.data ?? []) as {
        id: string;
        event_id: string;
        created_at: string;
      }[]) {
        const meta = index.get(row.event_id);
        if (!meta) continue;
        entries.push({
          id: row.id,
          kind: "event",
          entityId: row.event_id,
          title: pick(meta.title_pl, meta.title_en, lang) || meta.slug,
          href: `/events/${meta.slug}`,
          savedAt: row.created_at,
        });
      }
      return entries.sort((a, b) => Date.parse(b.savedAt) - Date.parse(a.savedAt));
    },
  });
}
