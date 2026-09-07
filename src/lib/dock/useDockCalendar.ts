// Kalendarz doku: opublikowane wydarzenia w widocznym miesiącu (RLS decyduje,
// które są widoczne dla tego użytkownika i tenanta) plus osobiste zadania
// z terminem. Jedna lista wpisów zasila siatkę miesiąca i listę dnia.
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { dockKeys } from "./keys";
import { monthRange, type CalendarEntry } from "./calendarGrid";
import { useTodos } from "./useTodos";

interface EventRow {
  id: string;
  slug: string;
  title_pl: string;
  title_en: string;
  starts_at: string;
}

export function useDockCalendar(year: number, month: number, lang: "pl" | "en") {
  const { user } = useAuth();
  const todosQ = useTodos();

  const eventsQ = useQuery({
    queryKey: [...dockKeys.calendar(user?.id), year, month, lang],
    enabled: !!user,
    queryFn: async (): Promise<CalendarEntry[]> => {
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
        const title = (lang === "en" ? r.title_en : r.title_pl) || r.title_pl || r.slug;
        return {
          id: `event:${r.id}`,
          title,
          startsAt: r.starts_at,
          href: `/events/${r.slug}`,
          kind: "event" as const,
        };
      });
    },
  });

  const todoEntries: CalendarEntry[] = (todosQ.data ?? [])
    .filter((todo) => !todo.done && todo.due_at)
    .map((todo) => ({
      id: `todo:${todo.id}`,
      title: todo.title,
      startsAt: todo.due_at as string,
      href: null,
      kind: "todo" as const,
    }));

  return {
    entries: [...(eventsQ.data ?? []), ...todoEntries],
    isPending: eventsQ.isPending,
    isError: eventsQ.isError,
  };
}
