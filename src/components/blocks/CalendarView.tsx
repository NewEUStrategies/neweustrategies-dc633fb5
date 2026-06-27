// Publiczny renderer: kalendarz miesięczny z linkami do dni publikacji.

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { AppLink } from "@/components/atoms/AppLink";

interface Props {
  /** YYYY-MM, puste = bieżący miesiąc. */
  month: string;
  lang: "pl" | "en";
}

export function CalendarView({ month, lang }: Props) {
  const target = useMemo(() => {
    const m = /^(\d{4})-(\d{2})$/.exec(month);
    if (m) return { y: Number(m[1]), m: Number(m[2]) };
    const now = new Date();
    return { y: now.getFullYear(), m: now.getMonth() + 1 };
  }, [month]);

  const [byDay, setByDay] = useState<Map<number, string>>(new Map());

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const start = new Date(target.y, target.m - 1, 1).toISOString();
      const end = new Date(target.y, target.m, 1).toISOString();
      const { data } = await supabase
        .from("posts")
        .select("slug, published_at, status")
        .eq("status", "published")
        .gte("published_at", start)
        .lt("published_at", end)
        .order("published_at", { ascending: true })
        .limit(500);
      if (cancelled) return;
      const m = new Map<number, string>();
      for (const r of (data ?? []) as Array<{ slug: string; published_at: string | null }>) {
        if (!r.published_at) continue;
        const d = new Date(r.published_at).getDate();
        if (!m.has(d)) m.set(d, r.slug);
      }
      setByDay(m);
    })();
    return () => { cancelled = true; };
  }, [target.y, target.m]);

  const firstDow = (new Date(target.y, target.m - 1, 1).getDay() + 6) % 7; // pn=0
  const days = new Date(target.y, target.m, 0).getDate();
  const locale = lang === "en" ? "en" : "pl";
  const monthLabel = new Intl.DateTimeFormat(locale, { month: "long", year: "numeric" })
    .format(new Date(target.y, target.m - 1, 1));
  const dows = lang === "en"
    ? ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"]
    : ["Pn","Wt","Śr","Cz","Pt","So","Nd"];

  const cells: Array<{ day: number | null; slug: string | null }> = [];
  for (let i = 0; i < firstDow; i++) cells.push({ day: null, slug: null });
  for (let d = 1; d <= days; d++) cells.push({ day: d, slug: byDay.get(d) ?? null });

  return (
    <figure className="not-prose my-4 border border-border rounded-lg overflow-hidden">
      <figcaption className="px-3 py-2 bg-muted text-sm font-medium text-center capitalize">{monthLabel}</figcaption>
      <table className="w-full text-center text-sm">
        <thead>
          <tr>{dows.map((w) => <th key={w} className="font-medium text-xs text-muted-foreground p-1">{w}</th>)}</tr>
        </thead>
        <tbody>
          {Array.from({ length: Math.ceil(cells.length / 7) }, (_, w) => (
            <tr key={w}>
              {cells.slice(w * 7, w * 7 + 7).map((c, i) => (
                <td key={i} className="p-1 align-middle">
                  {c.day === null ? "" : c.slug ? (
                    <AppLink href={`/post/${c.slug}`} className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-primary/15 text-primary hover:bg-primary hover:text-primary-foreground font-medium">{c.day}</AppLink>
                  ) : (
                    <span className="inline-flex items-center justify-center w-7 h-7 text-muted-foreground">{c.day}</span>
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
