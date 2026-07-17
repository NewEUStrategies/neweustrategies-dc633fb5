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
import {
  suggestBucketOf,
  suggestionHref,
  SUGGEST_BUCKET_ORDER,
  SUGGEST_BUCKET_LABELS,
  type SuggestBucket,
} from "@/lib/search/facetModel";
import type { AutosuggestItem } from "@/lib/queries/archives";
import type { Lang } from "./frame";

interface BucketedItem {
  item: AutosuggestItem;
  bucket: SuggestBucket;
  index: number;
}

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
  const [items, setItems] = useState<AutosuggestItem[]>([]);
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
      setItems([]);
      setSearched(false);
      return;
    }
    const reqId = ++reqIdRef.current;
    setLoading(true);
    // Shared autosuggest RPC - splits posts, authors and taxonomy terms in
    // one round-trip; rendering groups them into 4 premium buckets below.
    const capped = Math.max(4, Math.min(limit * 2, 24));
    const { data } = await supabase.rpc("search_autosuggest", { _q: t, _limit: capped });
    if (reqId !== reqIdRef.current) return;
    setItems(
      (data ?? []).map((r) => ({
        kind: r.kind as AutosuggestItem["kind"],
        id: (r.id as string | null) ?? null,
        slug: (r.slug as string | null) ?? null,
        label_pl: (r.label_pl as string | null) ?? "",
        label_en: (r.label_en as string | null) ?? "",
        parentPageId: (r.parent_page_id as string | null) ?? null,
        score: Number(r.score ?? 0),
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

  // Group + flatten while keeping a stable index used by keyboard navigation
  // and aria-activedescendant. Empty buckets are skipped for a clean list.
  const { grouped, flat } = useMemo(() => {
    const g = new Map<SuggestBucket, BucketedItem[]>();
    for (const bucket of SUGGEST_BUCKET_ORDER) g.set(bucket, []);
    for (const it of items) {
      g.get(suggestBucketOf(it.kind))!.push({
        item: it,
        bucket: suggestBucketOf(it.kind),
        index: 0,
      });
    }
    const flatList: BucketedItem[] = [];
    for (const bucket of SUGGEST_BUCKET_ORDER) {
      for (const entry of g.get(bucket)!) {
        entry.index = flatList.length;
        flatList.push(entry);
      }
    }
    return { grouped: g, flat: flatList };
  }, [items]);

  const showEmpty = hasQuery && !loading && searched && flat.length === 0;
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

  const bucketLabel = (b: SuggestBucket) => SUGGEST_BUCKET_LABELS[lang][b];

  const iconFor = (b: SuggestBucket) => {
    if (b === "titles") return LucideIcons.FileText;
    if (b === "contentTypes") return LucideIcons.LayoutGrid;
    if (b === "topics") return LucideIcons.Tags;
    return LucideIcons.Users;
  };

  const itemLabel = (it: AutosuggestItem) =>
    (lang === "pl" ? it.label_pl || it.label_en : it.label_en || it.label_pl) || "";

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => Math.min(i + 1, flat.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, -1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (!liveResults) {
        void runSearch(q);
        setFocused(true);
        return;
      }
      const chosen = active >= 0 ? flat[active] : undefined;
      if (chosen) {
        addRecentSearch(q);
        setFocused(false);
        void router.navigate({ href: suggestionHref(chosen.item) } as never);
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
              setItems([]);
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

            {focused && hasQuery && !loading && flat.length > 0 && (
              <div
                id={listboxId}
                role="listbox"
                aria-label={lang === "pl" ? "Wyniki wyszukiwania" : "Search results"}
              >
                {SUGGEST_BUCKET_ORDER.map((bucket) => {
                  const entries = grouped.get(bucket) ?? [];
                  if (entries.length === 0) return null;
                  const Icon = iconFor(bucket);
                  return (
                    <div key={bucket} className="border-t border-border/60 first:border-t-0">
                      <div className="flex items-center gap-2 px-4 pt-2.5 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                        <Icon className="w-3 h-3" aria-hidden />
                        {bucketLabel(bucket)}
                        <span className="ml-auto tabular-nums text-muted-foreground/70">
                          {entries.length}
                        </span>
                      </div>
                      <ul role="presentation" className="pb-1">
                        {entries.map((entry) => {
                          const it = entry.item;
                          const i = entry.index;
                          return (
                            <li key={`${it.kind}:${it.id ?? it.slug ?? i}`} role="presentation">
                              <AppLink
                                href={suggestionHref(it)}
                                id={optionId(i)}
                                role="option"
                                aria-selected={i === active}
                                tabIndex={-1}
                                onClick={goToResult}
                                onMouseEnter={() => setActive(i)}
                                className={`flex items-center gap-2 px-4 py-2 text-sm transition-colors ${
                                  i === active ? "bg-muted/70" : "hover:bg-muted/50"
                                }`}
                              >
                                <Icon
                                  className="w-3.5 h-3.5 shrink-0 text-muted-foreground"
                                  aria-hidden
                                />
                                <span className="truncate text-foreground">{itemLabel(it)}</span>
                              </AppLink>
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  );
                })}
              </div>
            )}

            {/* "View all results" link into the full /search page */}
            {focused && hasQuery && !loading && (flat.length > 0 || showEmpty) && (
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

            {/* Premium footer: query-syntax hints + advanced search modes */}
            {focused &&
              (showRecent || (hasQuery && !loading && (flat.length > 0 || showEmpty))) && (
                <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border bg-muted/30 px-4 py-2 text-[10px] text-muted-foreground">
                  <span className="flex flex-wrap items-center gap-2" aria-hidden>
                    <code className="rounded bg-muted px-1 py-0.5 font-mono">
                      {lang === "pl" ? '"fraza"' : '"phrase"'}
                    </code>
                    <code className="rounded bg-muted px-1 py-0.5 font-mono">
                      {lang === "pl" ? "-wyklucz" : "-exclude"}
                    </code>
                  </span>
                  <AppLink
                    href={hasQuery ? `${searchAllHref}&adv=1` : "/search?adv=1"}
                    onClick={() => {
                      if (hasQuery) addRecentSearch(q);
                      setFocused(false);
                    }}
                    className="inline-flex items-center gap-1 font-medium text-brand-ink hover:underline"
                  >
                    <LucideIcons.SlidersHorizontal className="w-3 h-3 shrink-0" aria-hidden />
                    {lang === "pl" ? "Wyszukiwanie zaawansowane" : "Advanced search"}
                  </AppLink>
                </div>
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
