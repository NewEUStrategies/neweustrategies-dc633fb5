// Publiczny renderer: kalendarz miesięczny z linkami do dni publikacji.
// Dane przez react-query (calendarBlockQueryOptions) - z prefetchem SSR dni
// publikacji są w wyrenderowanym HTML (linki widoczne dla crawlerów).

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { calendarBlockQueryOptions, calendarTarget } from "@/lib/queries/blocks";
import { AppLink } from "@/components/atoms/AppLink";

interface Props {
  /** YYYY-MM, puste = bieżący miesiąc. */
  month: string;
  lang: "pl" | "en";
}

export function CalendarView({ month, lang }: Props) {
  const target = useMemo(() => calendarTarget(month), [month]);
  const { data: rows = [] } = useQuery(calendarBlockQueryOptions(target));

  const byDay = useMemo(() => {
    const m = new Map<number, string>();
    for (const r of rows) {
      const d = new Date(r.published_at).getDate();
      if (!m.has(d)) m.set(d, r.slug);
    }
    return m;
  }, [rows]);

  const firstDow = (new Date(target.year, target.month - 1, 1).getDay() + 6) % 7; // pn=0
  const days = new Date(target.year, target.month, 0).getDate();
  const locale = lang === "en" ? "en" : "pl";
  const monthLabel = new Intl.DateTimeFormat(locale, { month: "long", year: "numeric" }).format(
    new Date(target.year, target.month - 1, 1),
  );
  const dows =
    lang === "en"
      ? ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
      : ["Pn", "Wt", "Śr", "Cz", "Pt", "So", "Nd"];

  const cells: Array<{ day: number | null; slug: string | null }> = [];
  for (let i = 0; i < firstDow; i++) cells.push({ day: null, slug: null });
  for (let d = 1; d <= days; d++) cells.push({ day: d, slug: byDay.get(d) ?? null });

  return (
    <figure className="not-prose my-4 border border-border rounded-lg overflow-hidden">
      <figcaption className="px-3 py-2 bg-muted text-sm font-medium text-center capitalize">
        {monthLabel}
      </figcaption>
      <table className="w-full text-center text-sm">
        <thead>
          <tr>
            {dows.map((w) => (
              <th key={w} className="font-medium text-xs text-muted-foreground p-1">
                {w}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: Math.ceil(cells.length / 7) }, (_, w) => (
            <tr key={w}>
              {cells.slice(w * 7, w * 7 + 7).map((c, i) => (
                <td key={i} className="p-1 align-middle">
                  {c.day === null ? (
                    ""
                  ) : c.slug ? (
                    <AppLink
                      href={`/post/${c.slug}`}
                      className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-primary/15 text-primary hover:bg-primary hover:text-primary-foreground font-medium"
                    >
                      {c.day}
                    </AppLink>
                  ) : (
                    <span className="inline-flex items-center justify-center w-7 h-7 text-muted-foreground">
                      {c.day}
                    </span>
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}
