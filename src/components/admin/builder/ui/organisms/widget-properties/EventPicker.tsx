// Select wydarzenia z modulu events - wspolny dla edytorow widgetow
// (speakers w trybie "event", event-countdown w trybie "event"). W kontekscie
// panelu admina RLS "events staff read" pokazuje takze szkice, wiec redaktor
// moze podpiac widget przed publikacja wydarzenia.
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { uiLocale } from "@/lib/i18n/format";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface EventOption {
  id: string;
  slug: string;
  title_pl: string;
  title_en: string;
  starts_at: string;
  status: string;
}

const NONE = "__none__";

interface Props {
  value: string;
  onChange: (eventId: string) => void;
  lang: "pl" | "en";
}

export function EventPicker({ value, onChange, lang }: Props) {
  const { data: events = [] } = useQuery({
    queryKey: ["builder-event-picker"] as const,
    staleTime: 60_000,
    queryFn: async (): Promise<EventOption[]> => {
      const { data, error } = await supabase
        .from("events")
        .select("id, slug, title_pl, title_en, starts_at, status")
        .order("starts_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return (data ?? []) as EventOption[];
    },
  });

  const l = (pl: string, en: string) => (lang === "pl" ? pl : en);
  const labelOf = (e: EventOption): string => {
    const title = lang === "pl" ? e.title_pl || e.title_en : e.title_en || e.title_pl;
    const date = new Date(e.starts_at);
    const dateLabel = Number.isNaN(date.getTime())
      ? ""
      : date.toLocaleDateString(uiLocale(lang), {
          day: "2-digit",
          month: "2-digit",
          year: "numeric",
        });
    const draft = e.status !== "published" ? ` [${e.status}]` : "";
    return `${title}${dateLabel ? ` (${dateLabel})` : ""}${draft}`;
  };

  return (
    <Select value={value || NONE} onValueChange={(v) => onChange(v === NONE ? "" : v)}>
      <SelectTrigger className="h-8 text-xs">
        <SelectValue placeholder={l("Wybierz wydarzenie", "Pick an event")} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={NONE}>{l("- brak -", "- none -")}</SelectItem>
        {events.map((e) => (
          <SelectItem key={e.id} value={e.id}>
            {labelOf(e)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
