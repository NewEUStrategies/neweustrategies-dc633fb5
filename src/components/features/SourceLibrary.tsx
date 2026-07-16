// Biblioteka źródeł - przeszukiwalna, filtrowana lista odwołań (raporty, dane,
// traktaty). Filtr po typie (chipy) + opcjonalne pole wyszukiwania (tytuł /
// wydawca). Bez wyszukiwania działa jako czysta lista (SSR-friendly). Linki
// zewnętrzne dostają rel="noopener".
import { useMemo, useState } from "react";
import { Search, ArrowRight } from "@/lib/lucide-shim";
import type { SourceLibraryConfig, FeatureLang } from "@/lib/features/types";
import { pickBi } from "@/lib/features/types";
import { safeUrl } from "@/lib/sanitize";
import { FeatureFrame } from "./FeatureFrame";

const L = {
  pl: {
    empty: "Brak źródeł.",
    all: "Wszystkie",
    search: "Szukaj w źródłach...",
    noMatch: "Brak pasujących źródeł.",
  },
  en: {
    empty: "No sources.",
    all: "All",
    search: "Search sources...",
    noMatch: "No matching sources.",
  },
} as const;

interface Props {
  config: SourceLibraryConfig;
  lang: FeatureLang;
  className?: string;
}

export function SourceLibrary({ config, lang, className }: Props) {
  const t = L[lang];
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<string>("");

  const entries = useMemo(() => {
    const list =
      config.sort === "year-desc"
        ? [...config.entries].sort((a, b) => (Number(b.year) || 0) - (Number(a.year) || 0))
        : config.entries;
    return list;
  }, [config.entries, config.sort]);

  // Unikalne typy (klucz po PL) do chipów filtra.
  const kinds = useMemo(() => {
    const seen = new Map<string, string>();
    for (const e of entries) {
      if (e.kind.pl && !seen.has(e.kind.pl)) seen.set(e.kind.pl, pickBi(e.kind, lang));
    }
    return [...seen.entries()].map(([key, label]) => ({ key, label }));
  }, [entries, lang]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return entries.filter((e) => {
      if (kind && e.kind.pl !== kind) return false;
      if (!q) return true;
      return (
        pickBi(e.title, lang).toLowerCase().includes(q) ||
        pickBi(e.publisher, lang).toLowerCase().includes(q)
      );
    });
  }, [entries, kind, query, lang]);

  if (entries.length === 0) {
    return (
      <div
        className={`not-prose my-6 rounded-2xl border border-dashed border-border bg-muted/20 p-6 text-center text-sm text-muted-foreground ${className ?? ""}`}
      >
        {t.empty}
      </div>
    );
  }

  const toolbar =
    config.showSearch || kinds.length > 1 ? (
      <div className="flex flex-wrap items-center gap-2">
        {kinds.length > 1 && (
          <div className="flex flex-wrap gap-1">
            <button
              type="button"
              onClick={() => setKind("")}
              aria-pressed={kind === ""}
              className={`rounded-full px-2.5 py-1 text-xs font-medium transition-colors ${
                kind === ""
                  ? "bg-brand text-brand-foreground"
                  : "bg-muted text-muted-foreground hover:text-foreground"
              }`}
            >
              {t.all}
            </button>
            {kinds.map((k) => (
              <button
                key={k.key}
                type="button"
                onClick={() => setKind(k.key)}
                aria-pressed={kind === k.key}
                className={`rounded-full px-2.5 py-1 text-xs font-medium transition-colors ${
                  kind === k.key
                    ? "bg-brand text-brand-foreground"
                    : "bg-muted text-muted-foreground hover:text-foreground"
                }`}
              >
                {k.label}
              </button>
            ))}
          </div>
        )}
        {config.showSearch && (
          <div className="relative">
            <Search
              className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t.search}
              aria-label={t.search}
              className="h-8 w-44 rounded-md border border-border bg-background pl-8 pr-2 text-xs"
            />
          </div>
        )}
      </div>
    ) : undefined;

  return (
    <FeatureFrame
      title={config.title}
      description={config.description}
      source={config.source}
      className={className}
      toolbar={toolbar}
    >
      {filtered.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">{t.noMatch}</p>
      ) : (
        <ul className="divide-y divide-border/60">
          {filtered.map((e, i) => {
            const url = e.url ? safeUrl(e.url, "") : "";
            const kindLabel = pickBi(e.kind, lang);
            const title = pickBi(e.title, lang);
            const publisher = pickBi(e.publisher, lang);
            const titleNode = url ? (
              <a
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 font-medium text-foreground hover:text-brand"
              >
                {title}
                <ArrowRight className="h-3 w-3 shrink-0 -rotate-45 opacity-60" aria-hidden />
              </a>
            ) : (
              <span className="font-medium text-foreground">{title}</span>
            );
            return (
              <li key={i} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 py-2.5">
                {kindLabel && (
                  <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                    {kindLabel}
                  </span>
                )}
                {e.year && (
                  <span className="text-xs tabular-nums text-muted-foreground">{e.year}</span>
                )}
                {titleNode}
                {publisher && <span className="text-sm text-muted-foreground">— {publisher}</span>}
              </li>
            );
          })}
        </ul>
      )}
    </FeatureFrame>
  );
}
