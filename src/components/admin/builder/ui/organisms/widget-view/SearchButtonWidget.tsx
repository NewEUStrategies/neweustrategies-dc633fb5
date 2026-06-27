// Live search widget, extracted from SimpleWidgets.
import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import * as LucideIcons from "@/lib/lucide-shim";
import { AppLink } from "@/components/atoms/AppLink";
import type { Lang } from "./frame";

type SearchResult = { id: string; slug: string; title: string; excerpt: string | null };

export function SearchButtonWidget({ label, heading, liveResults, limit, lang, height, radius, fontSize }: {
  label: string;
  mode: "standalone" | "dropdown" | "fullscreen";
  heading: string;
  liveResults: boolean;
  limit: number;
  lang: Lang;
  height: number;
  radius: number;
  fontSize: number;
}) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [focused, setFocused] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setFocused(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { setFocused(false); inputRef.current?.blur(); }
    };
    document.addEventListener("mousedown", onDocClick);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  const runSearch = async (term: string) => {
    const t = term.trim();
    if (t.length < 2) { setResults([]); setSearched(false); return; }
    setLoading(true);
    const titleCol = lang === "pl" ? "title_pl" : "title_en";
    const excerptCol = lang === "pl" ? "excerpt_pl" : "excerpt_en";
    const { data } = await supabase
      .from("posts")
      .select(`id, slug, ${titleCol}, ${excerptCol}`)
      .eq("status", "published")
      .is("deleted_at", null)
      .ilike(titleCol, `%${t}%`)
      .limit(Math.max(1, Math.min(limit, 20)));
    setResults((data ?? []).map((r: any) => ({
      id: r.id, slug: r.slug, title: r[titleCol] || "", excerpt: r[excerptCol] || null,
    })));
    setLoading(false);
    setSearched(true);
  };

  useEffect(() => {
    if (!liveResults) return;
    const h = setTimeout(() => runSearch(q), 220);
    return () => clearTimeout(h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, liveResults]);

  const placeholder = label || heading || (lang === "pl" ? "Szukaj" : "Search");
  const hasQuery = q.trim().length >= 2;
  const showEmpty = hasQuery && !loading && searched && results.length === 0;
  const showPopover = focused && hasQuery;

  const h = Math.max(24, Math.min(120, height || 40));
  const pad = Math.max(8, Math.round(h * 0.3));

  return (
    <div ref={wrapRef} className="builder-search-widget relative w-full max-w-full min-w-0">
      <div
        className="flex w-full items-center gap-2 border border-input bg-card text-foreground shadow-sm transition-colors"
        style={{ direction: "ltr", height: `${h}px`, minHeight: `${h}px`, borderRadius: `${radius}px`, paddingLeft: `${pad}px`, paddingRight: `${pad}px` }}
      >
        <LucideIcons.Search className="text-muted-foreground shrink-0" style={{ width: Math.round(h * 0.4), height: Math.round(h * 0.4) }} aria-hidden />
        <input
          ref={inputRef}
          type="text"
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="none"
          spellCheck={false}
          inputMode="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onFocus={() => setFocused(true)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); runSearch(q); setFocused(true); } }}
          placeholder={placeholder}
          aria-label={label || placeholder}
          dir="ltr"
          style={{
            textAlign: "left",
            direction: "ltr",
            unicodeBidi: "plaintext",
            boxShadow: "none",
            background: "transparent",
            border: 0,
            outline: "none",
            borderRadius: 0,
            padding: 0,
            margin: 0,
            appearance: "none",
            WebkitAppearance: "none",
            MozAppearance: "none",
            height: "100%",
            fontSize: `${fontSize}px`,
          }}
          className="flex-1 min-w-0 bg-transparent border-0 text-foreground outline-none ring-0 shadow-none [appearance:none] [-webkit-appearance:none] focus:outline-none focus:ring-0 focus-visible:outline-none focus-visible:ring-0 placeholder:text-muted-foreground/70"
        />
        {loading && <LucideIcons.Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground shrink-0" />}
        {q && (
          <button
            type="button"
            aria-label={lang === "pl" ? "Wyczyść" : "Clear"}
            onClick={() => { setQ(""); setResults([]); setSearched(false); inputRef.current?.focus(); }}
            className="shrink-0 rounded-sm p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus:outline-none focus-visible:outline-none focus:ring-0"
          >
            <LucideIcons.X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {showPopover && (
        <div
          className="absolute left-0 right-0 top-[calc(100%+8px)] z-[70] overflow-hidden rounded-md border border-input bg-card text-card-foreground shadow-lg"
          role="dialog"
          aria-label={lang === "pl" ? "Wyniki wyszukiwania" : "Search results"}
        >
          <div className="max-h-[380px] overflow-y-auto py-1">
            {loading && (
              <div className="flex items-center gap-2 px-4 py-5 text-xs text-muted-foreground">
                <LucideIcons.Loader2 className="w-3.5 h-3.5 animate-spin" />
                {lang === "pl" ? "Szukam…" : "Searching…"}
              </div>
            )}

            {!loading && showEmpty && (
              <div className="px-4 py-5 text-xs text-muted-foreground">
                {lang === "pl" ? "Brak wyników dla " : "No results for "}
                <span className="font-medium text-foreground">„{q.trim()}"</span>
              </div>
            )}

            {!loading && results.length > 0 && (
              <ul className="divide-y divide-border/70">
                {results.map((r) => (
                  <li key={r.id}>
                    <AppLink
                      href={`/post/${r.slug}`}
                      onClick={() => setFocused(false)}
                      className="block px-4 py-3 transition-colors hover:bg-muted/50"
                    >
                      <div className="text-sm font-medium text-foreground truncate">{r.title}</div>
                      {r.excerpt && (
                        <div className="text-xs text-muted-foreground mt-0.5 line-clamp-1">{r.excerpt}</div>
                      )}
                    </AppLink>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}

      <style
        dangerouslySetInnerHTML={{
          __html: `
            .builder-search-widget input::-webkit-search-decoration,
            .builder-search-widget input::-webkit-search-cancel-button,
            .builder-search-widget input::-webkit-search-results-button,
            .builder-search-widget input::-webkit-search-results-decoration {
              display: none;
              -webkit-appearance: none;
            }
            .builder-search-widget input::-ms-clear,
            .builder-search-widget input::-ms-reveal {
              display: none;
              width: 0;
              height: 0;
            }
          `,
        }}
      />
    </div>
  );
}
