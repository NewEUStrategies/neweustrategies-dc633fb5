// Zapisane elementy w doku: zakładki wpisów/stron (user_bookmarks) i zapisane
// wydarzenia (event_bookmarks) sprowadzone do JEDNEJ listy z tytułem i linkiem.
// Nie duplikujemy logiki zapisu - ta warstwa tylko CZYTA to, co zapisały
// istniejące przyciski (SaveArticleButton, EventBookmarkButton).
//
// ── JĘZYK NIE JEST CZĘŚCIĄ KLUCZA ────────────────────────────────────────
// Klucz niósł wcześniej `lang`, a język wpływał WYŁĄCZNIE na to, którą
// z dwóch kolumn tytułu wybrać po pobraniu. Skutek: przełączenie PL/EN
// wyrzucało cały wynik i wykonywało od nowa DWIE serie zapytań do bazy dla
// danych, które są identyczne. Wpis wraca teraz językowo NEUTRALNY (oba
// tytuły plus slug), a wybór robi panel przy renderowaniu - to ta sama
// zasada, którą repozytorium egzekwuje bramką `localizedQueryKeys` dla
// widgetów buildera: zlokalizowany klucz tylko tam, gdzie ładunek naprawdę
// się różni.
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { dockKeys } from "./keys";
import { DOCK_GC_MS, DOCK_STALE_MS } from "./queryPolicy";

export type SavedKind = "post" | "page" | "event";

export interface SavedEntry {
  id: string;
  kind: SavedKind;
  entityId: string;
  /** Tytuł polski (może być pusty - wtedy zostaje angielski albo slug). */
  titlePl: string;
  /** Tytuł angielski (może być pusty). */
  titleEn: string;
  /** Zapas, gdy oba tytuły są puste. */
  slug: string;
  href: string;
  savedAt: string;
}

interface BookmarkRow {
  id: string;
  entity_type: string;
  entity_id: string;
  created_at: string;
}

interface EventBookmarkRow {
  id: string;
  event_id: string;
  created_at: string;
}

interface TitledRow {
  id: string;
  slug: string;
  title_pl: string | null;
  title_en: string | null;
}

/**
 * Tytuł wpisu w języku interfejsu. Wybór robi się PRZY RENDEROWANIU, nie
 * w zapytaniu - patrz nagłówek modułu.
 */
export function savedEntryTitle(entry: SavedEntry, lang: "pl" | "en"): string {
  const primary = lang === "en" ? entry.titleEn : entry.titlePl;
  return (primary || entry.titleEn || entry.titlePl || entry.slug).trim();
}

/**
 * Opcje zapytania zapisanych elementów. Wyciągnięte z haka, żeby ten sam
 * kształt mógł rozgrzać dane przed otwarciem panelu (`prefetchDockData`) -
 * ten panel ma najdłuższą drogę do pierwszego wiersza, bo czyta w DWÓCH
 * turach (najpierw zakładki, potem tytuły wskazanych materiałów), więc
 * wyprzedzenie na najechanie kursorem opłaca się tu najbardziej.
 */
export function savedQueryOptions(userId: string | undefined) {
  return {
    queryKey: dockKeys.saved(userId),
    staleTime: DOCK_STALE_MS,
    gcTime: DOCK_GC_MS,
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
      const eventRows = (eventBookmarks.data ?? []) as EventBookmarkRow[];
      const postIds = rows.filter((r) => r.entity_type === "post").map((r) => r.entity_id);
      const pageIds = rows.filter((r) => r.entity_type === "page").map((r) => r.entity_id);
      const eventIds = eventRows.map((r) => r.event_id);

      // DRUGA TURA ZOSTAJE, ale jest RÓWNOLEGŁA w obrębie tury: identyfikatory
      // materiałów znamy dopiero z pierwszej odpowiedzi, więc zejście do
      // jednego okrążenia wymagałoby funkcji po stronie bazy (RPC) - to jest
      // osobna zmiana kontraktu SQL, nie zmiana w tym pliku. Dopóki jej nie
      // ma, koszt tej tury zdejmuje rozgrzewanie na najechanie kursorem.
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

      const index = new Map<string, TitledRow>();
      for (const list of [posts.data ?? [], pages.data ?? [], events.data ?? []]) {
        for (const row of list as TitledRow[]) index.set(row.id, row);
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
          titlePl: meta.title_pl ?? "",
          titleEn: meta.title_en ?? "",
          slug: meta.slug,
          href: `/${meta.slug}`,
          savedAt: row.created_at,
        });
      }
      for (const row of eventRows) {
        const meta = index.get(row.event_id);
        if (!meta) continue;
        entries.push({
          id: row.id,
          kind: "event",
          entityId: row.event_id,
          titlePl: meta.title_pl ?? "",
          titleEn: meta.title_en ?? "",
          slug: meta.slug,
          href: `/events/${meta.slug}`,
          savedAt: row.created_at,
        });
      }
      return entries.sort((a, b) => Date.parse(b.savedAt) - Date.parse(a.savedAt));
    },
  };
}

export function useSavedEntries() {
  const { user } = useAuth();
  return useQuery({ ...savedQueryOptions(user?.id), enabled: !!user });
}
