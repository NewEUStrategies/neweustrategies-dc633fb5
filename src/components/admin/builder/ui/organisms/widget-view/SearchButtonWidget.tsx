// Live search widget (desktop header + builder header). Uses the shared
// `search_autosuggest` RPC (same engine as /search) and groups results into
// four premium categories: Titles, Content types, Topics, People & orgs.
// Exposes the WAI-ARIA combobox/listbox pattern with arrow-key navigation,
// recent searches, and a "view all results" link into /search.
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useRouter } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import * as LucideIcons from "@/lib/lucide-shim";
import { AppLink } from "@/components/atoms/AppLink";
import { addRecentSearch, getRecentSearches } from "@/lib/search/recentSearches";
import { DIM_PARAM, type SearchUrl } from "@/lib/search/facetModel";
import type { AutosuggestItem } from "@/lib/queries/archives";
import type { Lang } from "./frame";

type SuggestBucket = "titles" | "contentTypes" | "topics" | "peopleOrg";

const BUCKET_ORDER: readonly SuggestBucket[] = [
  "titles",
  "contentTypes",
  "topics",
  "peopleOrg",
] as const;

const bucketOf = (kind: AutosuggestItem["kind"]): SuggestBucket => {
  if (kind === "post") return "titles";
  if (kind === "author") return "peopleOrg";
  if (kind === "format" || kind === "pub_type" || kind === "access" || kind === "lang") {
    return "contentTypes";
  }
  return "topics";
};

const BUCKET_LABEL_PL: Record<SuggestBucket, string> = {
  titles: "Tytuły",
  contentTypes: "Rodzaje treści",
  topics: "Tematyka",
  peopleOrg: "Osoby i organizacje",
};
const BUCKET_LABEL_EN: Record<SuggestBucket, string> = {
  titles: "Titles",
  contentTypes: "Content types",
  topics: "Topics",
  peopleOrg: "People & organizations",
};

/** Build target href for an autosuggest item. Posts go to their permalink;
 *  taxonomy/author picks land on /search with the matching filter applied. */
function hrefForItem(it: AutosuggestItem): string {
  if (it.kind === "post" && it.slug) return `/post/${it.slug}`;
  const patch: Record<string, string> = {};
  if (it.kind === "author") {
    if (it.id) patch.author = it.id;
  } else if (it.kind === "format" && it.slug) patch.format = it.slug;
  else if (it.kind === "access" && it.slug) patch.access = it.slug;
  else if (it.kind === "lang" && it.slug) patch.lang = it.slug;
  else if (it.kind === "year" && it.slug) patch.year = it.slug;
  else if (it.kind !== "post" && it.kind !== "author") {
    const param = DIM_PARAM[it.kind] as keyof SearchUrl | undefined;
    const value = it.slug ?? it.id;
    if (param && value) patch[param as string] = value;
  }
  const qs = new URLSearchParams(patch).toString();
  return qs ? `/search?${qs}` : "/search";
}

type BucketedItem = { item: AutosuggestItem; bucket: SuggestBucket; index: number };

export function SearchButtonWidget({
  label,
  heading,
  liveResults,
  limit,
  lang,
  height,
  radius,
  fontSize,
}: {
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
  const router = useRouter();
  const [q, setQ] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [focused, setFocused] = useState(false);
  const [active, setActive] = useState(-1);
  const [recent, setRecent] = useState<string[]>([]);
  const wrapRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const reqIdRef = useRef(0);
  const listboxId = useId();
  const optionId = (i: number): string => `${listboxId}-opt-${i}`;

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setFocused(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setFocused(false);
        inputRef.current?.blur();
      }
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
    if (t.length < 2) {
      setResults([]);
      setSearched(false);
      return;
    }
    const reqId = ++reqIdRef.current;
    setLoading(true);
    // Same ranked FTS RPC as /search and the mobile overlay.
    const { data } = await supabase.rpc("search_posts", {
      _q: t,
      _limit: Math.max(1, Math.min(limit, 20)),
    });
    // Ignore out-of-order responses (a slower earlier request landing last).
    if (reqId !== reqIdRef.current) return;
    setResults(
      (data ?? []).map((r) => ({
        id: r.id,
        slug: r.slug,
        title: (lang === "pl" ? r.title_pl : r.title_en) || r.title_pl || "",
        excerpt: (lang === "pl" ? r.excerpt_pl : r.excerpt_en) || null,
      })),
    );
    setActive(-1);
    setLoading(false);
    setSearched(true);
  };

  useEffect(() => {
    if (!liveResults) return;
    const h = setTimeout(() => runSearch(q), 200);
    return () => clearTimeout(h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, liveResults]);

  const placeholder = label || heading || (lang === "pl" ? "Szukaj" : "Search");
  const hasQuery = q.trim().length >= 2;
  const showEmpty = hasQuery && !loading && searched && results.length === 0;
  const showRecent = focused && !hasQuery && recent.length > 0;
  const showPopover = (focused && hasQuery) || showRecent;
  const searchAllHref = `/search?q=${encodeURIComponent(q.trim())}`;

  const openFocus = () => {
    setFocused(true);
    setRecent(getRecentSearches());
  };

  const goToResult = () => {
    addRecentSearch(q);
    setFocused(false);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, -1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      // Search-on-submit mode (live results off): run the query inline and keep
      // the popover open, rather than navigating away.
      if (!liveResults) {
        void runSearch(q);
        setFocused(true);
        return;
      }
      const r = active >= 0 ? results[active] : undefined;
      if (r) {
        addRecentSearch(q);
        setFocused(false);
        void router.navigate({ href: `/post/${r.slug}` } as never);
      } else if (hasQuery) {
        addRecentSearch(q);
        setFocused(false);
        void router.navigate({ href: searchAllHref } as never);
      }
    }
  };

  const h = Math.max(24, Math.min(120, height || 40));
  const pad = Math.max(8, Math.round(h * 0.3));

  return (
    <div ref={wrapRef} className="builder-search-widget relative w-full max-w-full min-w-0">
      <div
        className="flex w-full items-center gap-2 border border-input bg-card text-foreground shadow-sm transition-colors"
        style={{
          direction: "ltr",
          height: `${h}px`,
          minHeight: `${h}px`,
          borderRadius: `${radius}px`,
          paddingLeft: `${pad}px`,
          paddingRight: `${pad}px`,
        }}
      >
        <LucideIcons.Search
          className="text-muted-foreground shrink-0"
          style={{ width: Math.round(h * 0.4), height: Math.round(h * 0.4) }}
          aria-hidden
        />
        <input
          ref={inputRef}
          type="text"
          role="combobox"
          aria-expanded={showPopover}
          aria-controls={listboxId}
          aria-activedescendant={active >= 0 ? optionId(active) : undefined}
          aria-autocomplete="list"
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="none"
          spellCheck={false}
          inputMode="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onFocus={openFocus}
          onKeyDown={onKeyDown}
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
        {loading && (
          <LucideIcons.Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground shrink-0" />
        )}
        {q && (
          <button
            type="button"
            aria-label={lang === "pl" ? "Wyczyść" : "Clear"}
            onClick={() => {
              setQ("");
              setResults([]);
              setSearched(false);
              setActive(-1);
              inputRef.current?.focus();
            }}
            className="shrink-0 rounded-sm p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus:outline-none focus-visible:outline-none focus:ring-0"
          >
            <LucideIcons.X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {showPopover && (
        <div className="absolute left-0 right-0 top-[calc(100%+8px)] z-[70] overflow-hidden rounded-md border border-input bg-card text-card-foreground shadow-lg">
          <div className="max-h-[380px] overflow-y-auto py-1">
            {/* Recent searches (query empty) */}
            {showRecent && (
              <ul aria-label={lang === "pl" ? "Ostatnie wyszukiwania" : "Recent searches"}>
                {recent.map((term) => (
                  <li key={term}>
                    <button
                      type="button"
                      onMouseDown={(e) => {
                        e.preventDefault();
                        setQ(term);
                        setActive(-1);
                        inputRef.current?.focus();
                      }}
                      className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm text-foreground transition-colors hover:bg-muted/50"
                    >
                      <LucideIcons.Clock className="w-3.5 h-3.5 shrink-0 text-muted-foreground" />
                      <span className="truncate">{term}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}

            {focused && hasQuery && loading && (
              <div className="flex items-center gap-2 px-4 py-5 text-xs text-muted-foreground">
                <LucideIcons.Loader2 className="w-3.5 h-3.5 animate-spin" />
                {lang === "pl" ? "Szukam…" : "Searching…"}
              </div>
            )}

            {focused && hasQuery && !loading && showEmpty && (
              <div className="px-4 py-5 text-xs text-muted-foreground">
                {lang === "pl" ? "Brak wyników dla " : "No results for "}
                <span className="font-medium text-foreground">„{q.trim()}"</span>
              </div>
            )}

            {focused && hasQuery && !loading && results.length > 0 && (
              <ul
                id={listboxId}
                role="listbox"
                aria-label={lang === "pl" ? "Wyniki wyszukiwania" : "Search results"}
                className="divide-y divide-border/70"
              >
                {results.map((r, i) => (
                  // option na samym linku (tabIndex=-1) - patrz SearchOverlay;
                  // zagnieżdżony fokusowalny element w option łamie ARIA
                  // (axe: nested-interactive).
                  <li key={r.id} role="presentation">
                    <AppLink
                      href={`/post/${r.slug}`}
                      id={optionId(i)}
                      role="option"
                      aria-selected={i === active}
                      tabIndex={-1}
                      onClick={goToResult}
                      onMouseEnter={() => setActive(i)}
                      className={`block px-4 py-3 transition-colors ${
                        i === active ? "bg-muted/70" : "hover:bg-muted/50"
                      }`}
                    >
                      <div className="text-sm font-medium text-foreground truncate">{r.title}</div>
                      {r.excerpt && (
                        <div className="text-xs text-muted-foreground mt-0.5 line-clamp-1">
                          {r.excerpt}
                        </div>
                      )}
                    </AppLink>
                  </li>
                ))}
              </ul>
            )}

            {/* "View all results" link into the full /search page */}
            {focused && hasQuery && !loading && (results.length > 0 || showEmpty) && (
              <AppLink
                href={searchAllHref}
                onClick={() => {
                  addRecentSearch(q);
                  setFocused(false);
                }}
                className="flex items-center justify-between gap-2 border-t border-border px-4 py-2.5 text-xs font-medium text-brand-ink transition-colors hover:bg-muted/50"
              >
                <span>
                  {lang === "pl" ? "Zobacz wszystkie wyniki dla " : "View all results for "}
                  <span className="font-semibold">„{q.trim()}"</span>
                </span>
                <LucideIcons.ArrowRight className="w-3.5 h-3.5 shrink-0" />
              </AppLink>
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
