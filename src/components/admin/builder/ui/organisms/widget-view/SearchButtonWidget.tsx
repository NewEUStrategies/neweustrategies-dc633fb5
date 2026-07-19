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
import { addRecentSearch } from "@/lib/search/recentSearches";
import {
  suggestBucketOf,
  suggestionHref,
  SUGGEST_BUCKET_ORDER,
  SUGGEST_BUCKET_LABELS,
  type SuggestBucket,
} from "@/lib/search/facetModel";
import type { AutosuggestItem } from "@/lib/queries/archives";
import type { Lang } from "./frame";
import i18n from "@/lib/i18n";
import "@/lib/i18n-search";


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
  const [tab, setTab] = useState<SuggestBucket | "all">("all");
  const wrapRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const reqIdRef = useRef(0);
  const listboxId = useId();
  const optionId = (i: number): string => `${listboxId}-opt-${i}`;
  const t = (k: string): string => i18n.t(`search.widget.${k}`, { lng: lang }) as string;


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
  const showPopover = focused && hasQuery;
  const searchAllHref = `/search?q=${encodeURIComponent(q.trim())}`;

  const openFocus = () => {
    setFocused(true);
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

  // Compact by default (36px) — bell/kolumny nagłówka mają obcięcie parenta,
  // więc niższy widget + label pływający WEWNĄTRZ inputa (poniżej) chroni
  // przed przycinaniem chipu na górnej krawędzi headera.
  const h = Math.max(28, Math.min(120, height || 36));
  const pad = Math.max(8, Math.round(h * 0.28));

  // Trailing icon cluster width (X + Search + divider + Mic). Reserved as
  // right padding so text never slides under the icons.
  const trailingPad = q ? 108 : 84;

  return (
    <div ref={wrapRef} className="builder-search-widget relative w-full max-w-full min-w-0 self-center my-auto" style={{ overflow: "visible", fontFamily: '"Red Hat Display", system-ui, -apple-system, "Segoe UI", sans-serif' }}>
      <div className="input-group" style={{ height: `${h}px`, overflow: "visible" }}>
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
          onChange={(e) => {
            setQ(e.target.value);
            // Typing must always reopen the popover — some parents (header
            // scroll shadows, click-outside handlers on rerender) can clear
            // `focused` between keystrokes, which would otherwise hide the
            // real-time suggestions until the user re-clicks the input.
            if (!focused) setFocused(true);
          }}
          onFocus={openFocus}
          onPointerDown={openFocus}
          onKeyDown={onKeyDown}
          placeholder=" "
          aria-label={label || placeholder}
          dir="ltr"
          className="input"
          style={{
            height: `${h}px`,
            minHeight: `${h}px`,
            borderRadius: `${radius}px`,
            fontSize: `${fontSize}px`,
            paddingLeft: "0.9rem",
            paddingRight: `${trailingPad}px`,
            textAlign: "left",
            direction: "ltr",
            unicodeBidi: "plaintext",
          }}
        />
        <label className="user-label">{placeholder}</label>
        <div
          className="absolute top-0 flex h-full items-center gap-2"
          style={{ right: `${pad}px` }}
        >
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
          <button
            type="button"
            aria-label={lang === "pl" ? "Szukaj" : "Search"}
            onMouseDown={(e) => {
              e.preventDefault();
              if (hasQuery) {
                addRecentSearch(q);
                setFocused(false);
                void router.navigate({ href: searchAllHref } as never);
              } else {
                inputRef.current?.focus();
              }
            }}
            className="flex shrink-0 items-center justify-center text-muted-foreground transition-colors hover:text-foreground focus:outline-none focus-visible:outline-none"
          >
            <LucideIcons.Search className="w-[18px] h-[18px]" aria-hidden />
          </button>
          <span aria-hidden className="h-6 w-px shrink-0 bg-border" />
          <button
            type="button"
            aria-label={lang === "pl" ? "Wyszukiwanie głosowe" : "Voice search"}
            title={lang === "pl" ? "Wyszukiwanie głosowe" : "Voice search"}
            className="flex shrink-0 items-center justify-center text-muted-foreground transition-colors hover:text-foreground focus:outline-none focus-visible:outline-none"
          >
            <LucideIcons.Mic className="w-[18px] h-[18px]" aria-hidden />
          </button>
        </div>
      </div>

      {showPopover && (
        <div
          className="builder-search-megabox absolute left-0 right-0 top-[calc(100%+10px)] z-[70] rounded-xl border border-border bg-card text-card-foreground shadow-2xl"
          style={{
            fontFamily: '"Red Hat Display", system-ui, -apple-system, "Segoe UI", sans-serif',
            minWidth: "min(680px, 92vw)",
          }}
        >
          {/* ============= Tabs (mega-box category filter) ============= */}
          {focused && hasQuery && !loading && flat.length > 0 && (
            <div
              role="tablist"
              aria-label={lang === "pl" ? "Kategorie sugestii" : "Suggestion categories"}
              className="flex items-center gap-1 border-b border-border/60 px-2 pt-2"
            >
              {(["all", ...SUGGEST_BUCKET_ORDER] as const).map((k) => {
                const count =
                  k === "all" ? flat.length : (grouped.get(k as SuggestBucket)?.length ?? 0);
                if (k !== "all" && count === 0) return null;
                const isActive = tab === k;
                const label =
                  k === "all"
                    ? lang === "pl"
                      ? "Wszystko"
                      : "All"
                    : bucketLabel(k as SuggestBucket);
                return (
                  <button
                    key={k}
                    role="tab"
                    aria-selected={isActive}
                    type="button"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      setTab(k);
                      setActive(-1);
                    }}
                    className={`relative inline-flex items-center gap-1.5 rounded-md px-3 py-2 text-[13px] font-medium leading-none transition-colors ${
                      isActive
                        ? "text-foreground"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {label}
                    <span
                      className={`inline-flex min-w-[18px] items-center justify-center rounded-full px-1.5 py-0.5 text-[10px] font-semibold tabular-nums ${
                        isActive
                          ? "bg-[color-mix(in_oklab,var(--brand)_18%,transparent)] text-[var(--brand-ink)]"
                          : "bg-muted text-muted-foreground"
                      }`}
                    >
                      {count}
                    </span>
                    {isActive && (
                      <span
                        aria-hidden
                        className="absolute inset-x-2 -bottom-px h-[2px] rounded-full"
                        style={{ backgroundColor: "var(--brand)" }}
                      />
                    )}
                  </button>
                );
              })}
            </div>
          )}

          <div className="max-h-[440px] overflow-y-auto py-1.5">
            {focused && hasQuery && loading && (
              <div className="flex items-center gap-2 px-4 py-5 text-xs text-muted-foreground">
                <LucideIcons.Loader2 className="w-3.5 h-3.5 animate-spin" />
                {lang === "pl" ? "Szukam…" : "Searching…"}
              </div>
            )}

            {focused && hasQuery && !loading && showEmpty && (
              <div className="px-4 py-6 text-[13px] text-muted-foreground">
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
                  if (tab !== "all" && tab !== bucket) return null;
                  const entries = grouped.get(bucket) ?? [];
                  if (entries.length === 0) return null;
                  const Icon = iconFor(bucket);
                  return (
                    <div key={bucket} className="border-t border-border/50 first:border-t-0">
                      <div className="flex items-center gap-2 px-4 pt-2.5 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                        <Icon
                          className="w-3 h-3"
                          aria-hidden
                          style={{ color: "var(--brand)" }}
                        />
                        <span>{bucketLabel(bucket)}</span>
                        <span className="ml-auto tabular-nums text-muted-foreground/70">
                          {entries.length}
                        </span>
                      </div>
                      <ul role="presentation" className="pb-1">
                        {entries.map((entry) => {
                          const it = entry.item;
                          const i = entry.index;
                          const isActive = i === active;
                          return (
                            <li key={`${it.kind}:${it.id ?? it.slug ?? i}`} role="presentation">
                              <AppLink
                                href={suggestionHref(it)}
                                id={optionId(i)}
                                role="option"
                                aria-selected={isActive}
                                tabIndex={-1}
                                onClick={goToResult}
                                onMouseEnter={() => setActive(i)}
                                className={`group flex items-center gap-2.5 px-4 py-2 text-[13px] leading-[1.5] transition-colors ${
                                  isActive ? "bg-muted/70" : "hover:bg-muted/50"
                                }`}
                                style={{ overflow: "visible" }}
                              >
                                <Icon
                                  className="w-3.5 h-3.5 shrink-0 text-muted-foreground group-hover:text-[var(--brand)]"
                                  aria-hidden
                                  style={
                                    isActive ? { color: "var(--brand)" } : undefined
                                  }
                                />
                                <span
                                  className="truncate text-foreground"
                                  style={{ lineHeight: 1.5, paddingBottom: "2px" }}
                                >
                                  {itemLabel(it)}
                                </span>
                                <LucideIcons.ArrowRight
                                  className="ml-auto w-3.5 h-3.5 shrink-0 opacity-0 transition-opacity group-hover:opacity-70"
                                  aria-hidden
                                  style={{ color: "var(--brand-ink)" }}
                                />
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
                className="flex items-center justify-between gap-2 border-t border-border px-4 py-2.5 text-[13px] font-medium leading-[1.5] transition-colors hover:bg-muted/50"
                style={{ color: "var(--brand)" }}
              >
                <span style={{ lineHeight: 1.5, paddingBottom: "2px" }}>
                  {lang === "pl" ? "Zobacz wszystkie wyniki dla " : "View all results for "}
                  <span className="font-semibold">„{q.trim()}"</span>
                </span>
                <LucideIcons.ArrowRight className="w-3.5 h-3.5 shrink-0" />
              </AppLink>
            )}

            {/* Boolean operators + advanced search */}
            {focused && hasQuery && !loading && (flat.length > 0 || showEmpty) && (
                <div
                  className="flex flex-wrap items-center justify-between gap-2 border-t border-border bg-muted/30 px-3 py-1.5 text-[10px] text-muted-foreground"
                  style={{ lineHeight: 1.4 }}
                >
                  <div className="flex flex-wrap items-center gap-1">
                    <span className="mr-1 text-[9px] font-semibold uppercase tracking-wider">
                      {lang === "pl" ? "Operatory" : "Operators"}
                    </span>
                    {[
                      { op: '"fraza"', ins: '"" ' },
                      { op: "AND", ins: " AND " },
                      { op: "OR", ins: " OR " },
                      { op: "NOT", ins: " NOT " },
                      { op: "-słowo", ins: " -" },
                    ].map(({ op, ins }) => (
                      <button
                        key={op}
                        type="button"
                        title={
                          lang === "pl"
                            ? "Wstaw operator do zapytania"
                            : "Insert operator into query"
                        }
                        onMouseDown={(e) => {
                          e.preventDefault();
                          const el = inputRef.current;
                          if (!el) return;
                          const start = el.selectionStart ?? q.length;
                          const end = el.selectionEnd ?? q.length;
                          const next = q.slice(0, start) + ins + q.slice(end);
                          setQ(next);
                          requestAnimationFrame(() => {
                            el.focus();
                            const pos = start + ins.length;
                            el.setSelectionRange(pos, pos);
                          });
                        }}
                        className="rounded border border-border/60 bg-background px-1 py-0 text-[9px] font-medium leading-[1.4] text-foreground transition-colors hover:border-[var(--brand)] hover:text-[var(--brand)]"
                        style={{ paddingBottom: "2px" }}
                      >
                        {op}
                      </button>
                    ))}
                  </div>
                  <AppLink
                    href={hasQuery ? `${searchAllHref}&adv=1` : "/search?adv=1"}
                    onClick={() => {
                      if (hasQuery) addRecentSearch(q);
                      setFocused(false);
                    }}
                    className="inline-flex items-center gap-1 text-[10px] font-medium hover:underline"
                    style={{ color: "var(--brand)", lineHeight: 1.4 }}
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
            /* Wymuszamy overflow: visible i wysoki z-index na całym łańcuchu
               przodków widgetu, żeby chip floating-labela nie był przycinany
               przez kolumny/sekcje headera z overflow: hidden. */
            :where(*):has(> .builder-search-widget),
            :where(*):has(.builder-search-widget) {
              overflow: visible !important;
            }
            .builder-search-widget {
              position: relative;
              z-index: 40;
            }
            .builder-search-widget .input-group {
              overflow: visible !important;
            }
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
            /* Placeholder text w kolorze jasnoszarym, spójnym z ikonami.
               Transition dodany na transform, żeby unoszenie było animowane. */
            .builder-search-widget .input-group > .user-label {
              color: color-mix(in oklab, var(--muted-foreground) 65%, transparent);
              font-size: 0.8125rem;
              font-weight: 400;
              z-index: 50;
              transition: transform 180ms cubic-bezier(0.4, 0, 0.2, 1),
                          color 180ms cubic-bezier(0.4, 0, 0.2, 1),
                          background-color 180ms cubic-bezier(0.4, 0, 0.2, 1),
                          padding 180ms cubic-bezier(0.4, 0, 0.2, 1);
            }
            /* Ikony jasnoszare, hover -> foreground. */
            .builder-search-widget button svg,
            .builder-search-widget .absolute svg {
              color: color-mix(in oklab, var(--muted-foreground) 60%, transparent);
            }
            .builder-search-widget button:hover svg {
              color: var(--foreground);
            }
            /* Klasyczny floating label: unosi się na górną krawędź inputa. */
            .builder-search-widget .input-group > .input:focus ~ .user-label,
            .builder-search-widget .input-group > .input:not(:placeholder-shown) ~ .user-label {
              top: 0;
              transform: translateY(-50%) scale(0.78);
              background-color: var(--background);
              padding: 0 0.35em;
              color: var(--ring);
              opacity: 1;
            }
            /* Cieńsze obramowanie w spoczynku, brak drop shadowa na focus. */
            .builder-search-widget .input-group > .input {
              border-width: 1px;
              border-color: color-mix(in oklab, var(--border) 80%, transparent);
            }
            .builder-search-widget .input-group > .input:focus {
              box-shadow: none;
              border-color: var(--ring);
            }
          `,
        }}
      />

    </div>
  );
}
