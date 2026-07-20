// Nagłówek serii/dossier na wpisie (A8): "Dossier: <nazwa> - część X z Y"
// + nawigacja poprzednia/następna część + link do strony serii. Renderuje
// się wyłącznie, gdy wpis należy do serii (zero szumu poza cyklami).
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ChevronLeft, ChevronRight, Layers } from "lucide-react";
import { postSeriesQueryOptions } from "@/lib/queries/series";

const COPY = {
  pl: {
    series: "Dossier",
    part: "część",
    of: "z",
    prev: "Poprzednia część",
    next: "Następna część",
  },
  en: { series: "Dossier", part: "part", of: "of", prev: "Previous part", next: "Next part" },
} as const;

export function PostSeriesNav({ postId, lang }: { postId: string; lang: "pl" | "en" }) {
  const c = COPY[lang];
  const { data } = useQuery(postSeriesQueryOptions(postId));
  if (!data) return null;

  const name = lang === "en" ? data.series.name_en || data.series.name_pl : data.series.name_pl;
  const idx = data.parts.findIndex((p) => p.post_id === postId);
  const prev = idx > 0 ? data.parts[idx - 1] : null;
  const next = idx >= 0 && idx < data.parts.length - 1 ? data.parts[idx + 1] : null;
  const totalKnown = data.parts.length;

  return (
    <nav
      aria-label={`${c.series}: ${name}`}
      className="not-prose mb-6 rounded-lg border border-brand/30 bg-brand/5 px-4 py-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm"
    >
      <span className="inline-flex items-center gap-2 min-w-0">
        <Layers className="w-4 h-4 text-brand shrink-0" aria-hidden="true" />
        <span className="uppercase tracking-wide text-[11px] text-muted-foreground shrink-0">
          {c.series}
        </span>
        <Link
          to="/series/$slug"
          params={{ slug: data.series.slug }}
          className="font-medium truncate hover:text-brand transition"
        >
          {name}
        </Link>
        <span className="text-muted-foreground shrink-0 tabular-nums">
          · {c.part} {data.part} {c.of} {totalKnown}
        </span>
      </span>
      <span className="ml-auto flex items-center gap-1">
        {prev && (
          <Link
            to={prev.href as "/"}
            aria-label={c.prev}
            title={`${c.prev}: ${lang === "en" ? prev.title_en || prev.title_pl : prev.title_pl}`}
            className="inline-flex h-7 w-7 items-center justify-center rounded border border-border hover:bg-muted transition"
          >
            <ChevronLeft className="w-4 h-4" aria-hidden="true" />
          </Link>
        )}
        {next && (
          <Link
            to={next.href as "/"}
            aria-label={c.next}
            title={`${c.next}: ${lang === "en" ? next.title_en || next.title_pl : next.title_pl}`}
            className="inline-flex h-7 w-7 items-center justify-center rounded border border-border hover:bg-muted transition"
          >
            <ChevronRight className="w-4 h-4" aria-hidden="true" />
          </Link>
        )}
      </span>
    </nav>
  );
}
