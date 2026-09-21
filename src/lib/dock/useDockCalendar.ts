// Kalendarz doku: opublikowane wydarzenia w widocznym miesiącu (RLS decyduje,
// które są widoczne dla tego użytkownika i tenanta) plus osobiste zadania
// z terminem. Jedna lista wpisów zasila siatkę miesiąca i listę dnia.
//
// ── TRZY NAPRAWY WZGLĘDEM POPRZEDNIEJ WERSJI ─────────────────────────────
//  1. PRZEWIJANIE MIESIĄCA NIE GASI KALENDARZA. Klucz zawiera rok i miesiąc,
//     więc strzałka „następny miesiąc" zmieniała klucz, a `data` wracało jako
//     `undefined` - siatka gubiła wszystkie kropki, a lista dnia mówiła „brak
//     wydarzeń tego dnia", czyli podawała nieprawdę zamiast przyznać, że
//     jeszcze nie wie. `placeholderData: (previous) => previous` trzyma
//     poprzedni miesiąc na ekranie do przyjścia nowego, a `isFetching`
//     pozwala panelowi to pokazać. Ta sama konwencja, co w liście rozmów
//     i pseudonimach czatu.
//  2. JĘZYK WYPADA Z KLUCZA. Wpływał wyłącznie na wybór jednej z dwóch
//     kolumn tytułu, więc przełączenie PL/EN pobierało od nowa te same
//     wiersze. Wpis wraca językowo neutralny, wybór robi panel.
//  3. TOŻSAMOŚĆ TABLIC JEST STABILNA. `todoEntries` i wynikowe `entries`
//     powstawały nową tablicą przy KAŻDYM renderze, więc `useMemo` po stronie
//     panelu (`monthGrid`) nigdy nie trafiał i siatka 42 komórek liczyła się
//     od nowa przy każdym naciśnięciu klawisza gdziekolwiek w drzewie.
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { dockKeys } from "./keys";
import { DOCK_CALENDAR_STALE_MS, DOCK_GC_MS } from "./queryPolicy";
import { monthRange, type CalendarEntry } from "./calendarGrid";
import { useTodos } from "./useTodos";

interface EventRow {
  id: string;
  slug: string;
  title_pl: string | null;
  title_en: string | null;
  starts_at: string;
}

/** Wpis kalendarza przed wyborem języka tytułu. */
export interface CalendarEventEntry extends Omit<CalendarEntry, "title"> {
  titlePl: string;
  titleEn: string;
  slug: string;
}

/** Tytuł wpisu w języku interfejsu - wybór przy renderowaniu, nie w kluczu. */
export function calendarEntryTitle(entry: CalendarEventEntry, lang: "pl" | "en"): string {
  const primary = lang === "en" ? entry.titleEn : entry.titlePl;
  return (primary || entry.titlePl || entry.titleEn || entry.slug).trim();
}

/**
 * Opcje zapytania miesiąca wydarzeń. Wyciągnięte z haka, żeby dały się
 * rozgrzać z wyprzedzeniem (`prefetchDockData`, a także sąsiednie miesiące
 * przy najechaniu na strzałki).
 */
export function calendarEventsQueryOptions(
  userId: string | undefined,
  year: number,
  month: number,
) {
  return {
    queryKey: [...dockKeys.calendar(userId), year, month] as const,
    staleTime: DOCK_CALENDAR_STALE_MS,
    gcTime: DOCK_GC_MS,
    queryFn: async (): Promise<CalendarEventEntry[]> => {
      const { from, to } = monthRange(year, month);
      const { data, error } = await supabase
        .from("events")
        .select("id, slug, title_pl, title_en, starts_at")
        .eq("status", "published")
        .gte("starts_at", from.toISOString())
        .lt("starts_at", to.toISOString())
        .order("starts_at", { ascending: true })
        .limit(200);
      if (error) throw error;
      return (data ?? []).map((row) => {
        const r = row as EventRow;
        return {
          id: `event:${r.id}`,
          titlePl: r.title_pl ?? "",
          titleEn: r.title_en ?? "",
          slug: r.slug,
          startsAt: r.starts_at,
          href: `/events/${r.slug}`,
          kind: "event" as const,
        };
      });
    },
  };
}

export interface DockCalendar {
  entries: CalendarEventEntry[];
  /** Pierwsze pobranie tego miesiąca - nie ma jeszcze CZEGO pokazać. */
  isPending: boolean;
  /** Trwa pobieranie, ale poprzedni miesiąc jest nadal na ekranie. */
  isFetching: boolean;
  isError: boolean;
}

export function useDockCalendar(year: number, month: number): DockCalendar {
  const { user } = useAuth();
  const todosQ = useTodos();

  const eventsQ = useQuery({
    ...calendarEventsQueryOptions(user?.id, year, month),
    enabled: !!user,
    // Poprzedni miesiąc zostaje na ekranie do przyjścia nowego.
    placeholderData: (previous: CalendarEventEntry[] | undefined) => previous,
  });

  // Zadania z terminem: stabilna tożsamość tablicy, zależna TYLKO od danych.
  const todoEntries = useMemo<CalendarEventEntry[]>(
    () =>
      (todosQ.data ?? [])
        .filter((todo) => !todo.done && todo.due_at !== null)
        .map((todo) => ({
          id: `todo:${todo.id}`,
          titlePl: todo.title,
          titleEn: todo.title,
          slug: todo.id,
          startsAt: todo.due_at as string,
          href: null,
          kind: "todo" as const,
        })),
    [todosQ.data],
  );

  const events = eventsQ.data;
  const entries = useMemo(() => [...(events ?? []), ...todoEntries], [events, todoEntries]);

  return {
    entries,
    isPending: eventsQ.isPending,
    isFetching: eventsQ.isFetching,
    isError: eventsQ.isError,
  };
}
