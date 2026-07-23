// Live search widget (desktop header + builder header). Uses the shared
// `search_autosuggest` RPC (same engine as /search) and groups results into
// four premium categories: Titles, Content types, Topics, People & orgs.
// Exposes the WAI-ARIA combobox/listbox pattern with arrow-key navigation,
// recent searches, and a "view all results" link into /search.
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useRouter, useRouterState } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import * as LucideIcons from "@/lib/lucide-shim";
import { AppLink } from "@/components/atoms/AppLink";
import {
  addRecentSearch,
  clearRecentSearches,
  getRecentSearches,
} from "@/lib/search/recentSearches";
import { useVoiceSearch } from "@/lib/search/useVoiceSearch";
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

// Czysta projekcja lokalizacji routera -> fraza ?q= z /search (PL i /en).
// Wydzielona, bo czyta ja zarowno inicjalizacja stanu (synchronicznie, bez
// subskrypcji), jak i SearchUrlQSync (subskrypcja na nawigacje).
function urlQFromLocation(location: { pathname: string; search: unknown }): string {
  const path = location.pathname || "";
  if (!/(^|\/)search(\/?$|\?)/.test(path) && !path.endsWith("/search")) return "";
  const sp = location.search as Record<string, unknown> | undefined;
  return sp && typeof sp.q === "string" ? sp.q : "";
}

/**
 * Most subskrypcji routera renderowany TYLKO, gdy RouterProvider istnieje.
 * Dzieki temu hook useRouterState nigdy nie odpala bez kontekstu (render w
 * testach jednostkowych / poza aplikacja), a widget degraduje do zwyklego
 * pola wyszukiwania zamiast sie wywracac. Wzorzec "hook w dziecku" zamiast
 * warunkowego hooka - zgodny z rules-of-hooks.
 */
function SearchUrlQSync({ onUrlQ }: { onUrlQ: (value: string) => void }) {
  const location = useRouterState({ select: (s) => s.location });
  const urlQ = urlQFromLocation(location);
  useEffect(() => {
    onUrlQ(urlQ);
  }, [urlQ, onUrlQ]);
  return null;
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
  // warn:false - poza RouterProvider (testy jednostkowe, render izolowany)
  // router jest undefined, a widget dziala jako zwykle pole wyszukiwania;
  // synchronizacja ?q= i nawigacja SPA wlaczaja sie tylko z routerem.
  const router = useRouter({ warn: false });
  // Sync the header search bar with /search?q=... so header and page never
  // disagree. The subscription lives in <SearchUrlQSync> (rendered only with
  // a router); the initial value is read synchronously to avoid a first-frame
  // flash of an empty input on /search.
  const [urlQ, setUrlQ] = useState(() => {
    // Optional chaining az do location: poza aplikacja router bywa nie tylko
    // nieobecny, ale i CZESCIOWY (testy mockuja useRouter samym navigate).
    const location = router?.state?.location;
    return location ? urlQFromLocation(location) : "";
  });
  const [q, setQ] = useState(urlQ);
  const [items, setItems] = useState<AutosuggestItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [focused, setFocused] = useState(false);
  const [active, setActive] = useState(-1);
  const [tab, setTab] = useState<SuggestBucket | "all">("all");
  // Ostatnie wyszukiwania (localStorage) - pokazywane po fokusie przy pustym
  // polu, odświeżane przy każdym otwarciu popovera.
  const [recent, setRecent] = useState<string[]>([]);
  // Avatary autorów dociągane batch-em z profiles_public - pokazywane
  // w wierszach osób/organizacji jak w /messages i na kartach eksperta.
  const [authorAvatars, setAuthorAvatars] = useState<Record<string, string | null>>({});
  const wrapRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const reqIdRef = useRef(0);
  const listboxId = useId();
  const optionId = (i: number): string => `${listboxId}-opt-${i}`;
  const t = (k: string): string => i18n.t(`search.widget.${k}`, { lng: lang }) as string;

  // Nawigacja SPA, gdy router istnieje; twarde przejscie, gdy widget renderuje
  // sie poza RouterProvider (izolowany render) - identyczny URL, pelna strona.
  const navigateToHref = (href: string): void => {
    if (router) {
      void router.navigate({ href } as never);
    } else if (typeof window !== "undefined") {
      window.location.assign(href);
    }
  };

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

  // Mirror ?q= from /search into the header input on navigation - so header
  // and page always show the same phrase. We skip while the input is focused
  // to avoid clobbering what the user is typing, and we mirror ONLY when a
  // router location exists as the source of truth - without it (isolated
  // render) there is no URL to mirror and wiping the input would be a bug.
  const hasRouterSync = Boolean(router?.state);
  useEffect(() => {
    if (!hasRouterSync || focused) return;
    if (urlQ !== q) setQ(urlQ);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlQ, focused, hasRouterSync]);

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

  // Batch-fetch avatarów dla autorów w bieżącym zestawie podpowiedzi.
  // Cache w stanie unika ponownych zapytań przy dopisywaniu do frazy.
  useEffect(() => {
    const ids = Array.from(
      new Set(
        items
          .filter((it) => it.kind === "author" && it.id && !(it.id in authorAvatars))
          .map((it) => it.id as string),
      ),
    );
    if (ids.length === 0) return;
    let cancelled = false;
    void (async () => {
      const { data } = await supabase
        .from("profiles_public")
        .select("id, avatar_url")
        .in("id", ids);
      if (cancelled) return;
      const next: Record<string, string | null> = {};
      for (const id of ids) next[id] = null;
      for (const row of (data ?? []) as { id: string; avatar_url: string | null }[]) {
        next[row.id] = row.avatar_url ?? null;
      }
      setAuthorAvatars((prev) => ({ ...prev, ...next }));
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items]);

  // Dyktowanie frazy: transkrypcja płynie do pola (live results reagują same
  // przez debounce wyżej); przy wyłączonych live results finał odpala search.
  const voice = useVoiceSearch({
    lang: lang === "en" ? "en" : "pl",
    onText: (text) => {
      setQ(text);
      setFocused(true);
    },
    onFinal: (text) => {
      setQ(text);
      if (!liveResults) {
        setFocused(true);
        void runSearch(text);
      }
    },
  });

  const placeholder = label || heading || t("search");
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
  // Puste pole + historia = panel ostatnich wyszukiwań (kontrakt z
  // lib/search/recentSearches: "surfaced on focus when the query box is empty").
  const showRecent = focused && !hasQuery && recent.length > 0;
  const showPopover = focused && (hasQuery || showRecent);
  const searchAllHref = `/search?q=${encodeURIComponent(q.trim())}`;

  const openFocus = () => {
    setRecent(getRecentSearches());
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
        navigateToHref(suggestionHref(chosen.item));
      } else if (hasQuery) {
        addRecentSearch(q);
        setFocused(false);
        navigateToHref(searchAllHref);
      }
    }
  };

  // Compact by default (36px) — bell/kolumny nagłówka mają obcięcie parenta,
  // więc niższy widget + label pływający WEWNĄTRZ inputa (poniżej) chroni
  // przed przycinaniem chipu na górnej krawędzi headera.
  const h = Math.max(28, Math.min(120, height || 36));
  const pad = Math.max(8, Math.round(h * 0.28));

  // Trailing icon cluster width (X + Search + divider + Mic). Reserved as
  // right padding so text never slides under the icons. Without Web Speech
  // support the mic (and its divider) is hidden, so the cluster is narrower.
  const trailingPad = (q ? 108 : 84) - (voice.supported ? 0 : 27);

  return (
    <div
      ref={wrapRef}
      className="builder-search-widget relative w-full max-w-full min-w-0 self-center my-auto"
      style={{
        overflow: "visible",
        fontFamily:
          '"Red Hat Display", "Red Hat Display Fallback", system-ui, -apple-system, "Segoe UI", sans-serif',
      }}
    >
      {router?.state ? <SearchUrlQSync onUrlQ={setUrlQ} /> : null}
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
              aria-label={t("clear")}
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
            aria-label={t("search")}
            onMouseDown={(e) => {
              e.preventDefault();
              if (hasQuery) {
                addRecentSearch(q);
                setFocused(false);
                navigateToHref(searchAllHref);
              } else {
                inputRef.current?.focus();
              }
            }}
            className="flex shrink-0 items-center justify-center text-muted-foreground transition-colors hover:text-foreground focus:outline-none focus-visible:outline-none"
          >
            <LucideIcons.Search className="w-[18px] h-[18px]" aria-hidden />
          </button>
          {voice.supported && (
            <>
              <span aria-hidden className="h-6 w-px shrink-0 bg-border" />
              <button
                type="button"
                onClick={voice.toggle}
                aria-pressed={voice.listening}
                aria-label={voice.listening ? t("voice_stop") : t("voice")}
                title={voice.listening ? t("voice_stop") : t("voice")}
                className="flex shrink-0 items-center justify-center text-muted-foreground transition-colors hover:text-foreground focus:outline-none focus-visible:outline-none"
              >
                <LucideIcons.Mic
                  className={`w-[18px] h-[18px] ${voice.listening ? "animate-pulse" : ""}`}
                  // Inline style wygrywa z regułą .builder-search-widget button svg
                  // - mikrofon świeci na czerwono przez cały czas nagrywania.
                  style={voice.listening ? { color: "var(--destructive)" } : undefined}
                  aria-hidden
                />
              </button>
            </>
          )}
        </div>
      </div>

      {showPopover && (
        <div
          className="builder-search-megabox absolute left-0 right-0 top-[calc(100%+12px)] z-[70] overflow-hidden rounded-[10px] border border-border/70 bg-popover text-popover-foreground shadow-[0_24px_60px_-20px_rgba(0,0,0,0.35),0_8px_24px_-12px_rgba(0,0,0,0.25)] ring-1 ring-black/[0.04] backdrop-blur-xl animate-in fade-in-0 zoom-in-[0.99] slide-in-from-top-1 duration-150"
          style={{
            fontFamily:
              '"Red Hat Display", "Red Hat Display Fallback", system-ui, -apple-system, "Segoe UI", sans-serif',
            minWidth: "min(720px, 94vw)",
          }}
        >
          {/* ============= Tabs (mega-box category filter) ============= */}
          {focused && hasQuery && !loading && flat.length > 0 && (
            <div
              role="tablist"
              aria-label={t("categories")}
              className="flex items-center gap-1 border-b border-border/60 bg-muted/30 px-2.5 py-1.5"
            >
              {(["all", ...SUGGEST_BUCKET_ORDER] as const).map((k) => {
                const count =
                  k === "all" ? flat.length : (grouped.get(k as SuggestBucket)?.length ?? 0);
                if (k !== "all" && count === 0) return null;
                const isActive = tab === k;
                const tabLabel = k === "all" ? t("all") : bucketLabel(k as SuggestBucket);
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
                    className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[12px] font-medium leading-none transition-all ${
                      isActive
                        ? "bg-background text-foreground shadow-sm ring-1 ring-border/60"
                        : "text-muted-foreground hover:bg-background/60 hover:text-foreground"
                    }`}
                  >
                    {tabLabel}
                    <span
                      className={`inline-flex min-w-[16px] items-center justify-center rounded px-1 text-[9px] font-semibold tabular-nums ${
                        isActive
                          ? "bg-[color-mix(in_oklab,var(--brand)_16%,transparent)] text-[var(--brand-ink)]"
                          : "bg-muted/60 text-muted-foreground/80"
                      }`}
                    >
                      {count}
                    </span>
                  </button>
                );
              })}
            </div>
          )}

          <div className="max-h-[460px] overflow-y-auto">
            {/* ============= Ostatnie wyszukiwania (puste pole) ============= */}
            {showRecent && (
              <div className="px-3 pt-3 pb-2">
                <div className="mb-2 flex items-center justify-between">
                  <span className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                    <LucideIcons.Clock className="w-3 h-3" aria-hidden />
                    {t("recent")}
                  </span>
                  <button
                    type="button"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      clearRecentSearches();
                      setRecent([]);
                    }}
                    className="text-[10px] font-medium text-muted-foreground transition-colors hover:text-[var(--brand)]"
                  >
                    {t("recent_clear")}
                  </button>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {recent.map((term) => (
                    <button
                      key={term}
                      type="button"
                      onMouseDown={(e) => {
                        e.preventDefault();
                        setQ(term);
                        addRecentSearch(term);
                        setFocused(false);
                        navigateToHref(`/search?q=${encodeURIComponent(term)}`);
                      }}
                      className="group inline-flex items-center gap-1.5 rounded-md border border-border/70 bg-background/60 px-2.5 py-1.5 text-[12px] leading-none text-foreground transition-all hover:border-[var(--brand)] hover:bg-[color-mix(in_oklab,var(--brand)_6%,transparent)] hover:text-[var(--brand-ink)]"
                    >
                      <LucideIcons.Clock
                        className="w-3 h-3 shrink-0 text-muted-foreground/70 group-hover:text-[var(--brand)]"
                        aria-hidden
                      />
                      <span className="max-w-[180px] truncate">{term}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {focused && hasQuery && loading && (
              <div className="px-3 py-3">
                <div className="mb-2 flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
                  <LucideIcons.Loader2 className="w-3 h-3 animate-spin" aria-hidden />
                  {t("searching")}
                </div>
                <ul className="space-y-1.5" aria-hidden>
                  {[70, 55, 62].map((w, i) => (
                    <li
                      key={i}
                      className="flex items-center gap-2.5 rounded-md px-2 py-2"
                    >
                      <span className="h-6 w-6 shrink-0 animate-pulse rounded-md bg-muted" />
                      <span
                        className="h-3 animate-pulse rounded bg-muted"
                        style={{ width: `${w}%` }}
                      />
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {focused && hasQuery && !loading && showEmpty && (
              <div className="flex flex-col items-center gap-2 px-4 py-8 text-center">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-muted/60">
                  <LucideIcons.Search
                    className="h-4 w-4 text-muted-foreground"
                    aria-hidden
                  />
                </div>
                <div className="text-[13px] text-foreground">
                  {t("no_results")}
                  <span className="font-semibold">„{q.trim()}"</span>
                </div>
                <div className="text-[11px] text-muted-foreground">
                  {t("no_results_hint")}
                </div>
              </div>
            )}

            {focused && hasQuery && !loading && flat.length > 0 && (
              <div id={listboxId} role="listbox" aria-label={t("results")} className="py-1">
                {SUGGEST_BUCKET_ORDER.map((bucket) => {
                  if (tab !== "all" && tab !== bucket) return null;
                  const entries = grouped.get(bucket) ?? [];
                  if (entries.length === 0) return null;
                  const Icon = iconFor(bucket);
                  return (
                    <div key={bucket} className="pb-1">
                      <div className="flex items-center gap-2 px-3 pt-2.5 pb-1.5">
                        <span
                          className="flex h-4 w-4 items-center justify-center rounded-sm"
                          style={{
                            backgroundColor:
                              "color-mix(in oklab, var(--brand) 12%, transparent)",
                          }}
                        >
                          <Icon
                            className="h-2.5 w-2.5"
                            aria-hidden
                            style={{ color: "var(--brand)" }}
                          />
                        </span>
                        <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                          {bucketLabel(bucket)}
                        </span>
                        <span className="ml-auto rounded bg-muted/60 px-1.5 py-0.5 text-[9px] font-semibold tabular-nums text-muted-foreground">
                          {entries.length}
                        </span>
                      </div>
                      <ul role="presentation">
                        {entries.map((entry) => {
                          const it = entry.item;
                          const i = entry.index;
                          const isActive = i === active;
                          const kindLabel = i18n.t(
                            `search.widget.kind.${it.kind}`,
                            { lng: lang, defaultValue: "" },
                          ) as string;
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
                                className={`group relative mx-1.5 flex items-center gap-2.5 rounded-md px-2 py-2 text-[13px] leading-[1.4] transition-all ${
                                  isActive
                                    ? "bg-[color-mix(in_oklab,var(--brand)_8%,transparent)] text-foreground"
                                    : "text-foreground hover:bg-muted/60"
                                }`}
                                style={{ overflow: "visible" }}
                              >
                                <span
                                  aria-hidden
                                  className={`absolute left-0 top-1/2 h-4 w-[2px] -translate-y-1/2 rounded-r-full transition-opacity ${
                                    isActive ? "opacity-100" : "opacity-0"
                                  }`}
                                  style={{ backgroundColor: "var(--brand)" }}
                                />
                                <span
                                  className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md border transition-all ${
                                    isActive
                                      ? "border-transparent"
                                      : "border-border/60 bg-background/60 group-hover:border-border"
                                  }`}
                                  style={
                                    isActive
                                      ? {
                                          backgroundColor:
                                            "color-mix(in oklab, var(--brand) 14%, transparent)",
                                        }
                                      : undefined
                                  }
                                >
                                  <Icon
                                    className="h-3.5 w-3.5"
                                    aria-hidden
                                    style={{
                                      color: isActive
                                        ? "var(--brand)"
                                        : "var(--muted-foreground)",
                                    }}
                                  />
                                </span>
                                <span className="min-w-0 flex-1 truncate">
                                  {itemLabel(it)}
                                </span>
                                {kindLabel && (
                                  <span
                                    className={`hidden shrink-0 rounded px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide sm:inline-flex ${
                                      isActive
                                        ? "text-[var(--brand-ink)]"
                                        : "text-muted-foreground"
                                    }`}
                                    style={{
                                      backgroundColor: isActive
                                        ? "color-mix(in oklab, var(--brand) 14%, transparent)"
                                        : "color-mix(in oklab, var(--muted-foreground) 10%, transparent)",
                                    }}
                                  >
                                    {kindLabel}
                                  </span>
                                )}
                                <LucideIcons.ArrowRight
                                  className={`h-3.5 w-3.5 shrink-0 transition-all ${
                                    isActive
                                      ? "translate-x-0 opacity-100"
                                      : "-translate-x-0.5 opacity-0 group-hover:translate-x-0 group-hover:opacity-70"
                                  }`}
                                  aria-hidden
                                  style={{ color: "var(--brand)" }}
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
                className="group flex items-center justify-between gap-2 border-t border-border/60 px-4 py-2.5 text-[12px] font-semibold leading-none transition-colors hover:bg-[color-mix(in_oklab,var(--brand)_6%,transparent)]"
                style={{ color: "var(--brand)" }}
              >
                <span className="inline-flex items-center gap-1.5">
                  <LucideIcons.Search className="h-3.5 w-3.5" aria-hidden />
                  {t("view_all")}
                  <span className="font-bold">„{q.trim()}"</span>
                </span>
                <LucideIcons.ArrowRight
                  className="h-3.5 w-3.5 shrink-0 transition-transform group-hover:translate-x-0.5"
                  aria-hidden
                />
              </AppLink>
            )}
          </div>

          {/* Footer: operators + keyboard hints + advanced search */}
          {focused && hasQuery && !loading && (flat.length > 0 || showEmpty) && (
            <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5 border-t border-border/60 bg-muted/40 px-3 py-2">
              <div className="flex flex-wrap items-center gap-1">
                <span className="mr-1 text-[9px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                  {t("operators")}
                </span>
                {[
                  { op: '"fraza"', ins: '"" ', caret: 1 },
                  { op: "AND", ins: " AND " },
                  { op: "OR", ins: " OR " },
                  { op: "NOT", ins: " NOT " },
                  { op: t("operator_word"), ins: " -" },
                ].map(({ op, ins, caret }) => (
                  <button
                    key={op}
                    type="button"
                    title={t("operator_insert")}
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
                        const pos = start + (caret ?? ins.length);
                        el.setSelectionRange(pos, pos);
                      });
                    }}
                    className="inline-flex items-center rounded border border-border/60 bg-background px-1.5 py-0.5 font-mono text-[9px] font-semibold leading-[1.4] text-foreground shadow-[0_1px_0_rgba(0,0,0,0.04)] transition-all hover:-translate-y-px hover:border-[var(--brand)] hover:text-[var(--brand)]"
                  >
                    {op}
                  </button>
                ))}
              </div>
              <div className="hidden items-center gap-2 text-[9px] text-muted-foreground md:flex">
                <span className="inline-flex items-center gap-1">
                  <kbd className="rounded border border-border/60 bg-background px-1 py-0.5 font-mono text-[9px] leading-none text-foreground/80">
                    ↑
                  </kbd>
                  <kbd className="rounded border border-border/60 bg-background px-1 py-0.5 font-mono text-[9px] leading-none text-foreground/80">
                    ↓
                  </kbd>
                  {t("kbd_navigate")}
                </span>
                <span className="inline-flex items-center gap-1">
                  <kbd className="rounded border border-border/60 bg-background px-1 py-0.5 font-mono text-[9px] leading-none text-foreground/80">
                    ↵
                  </kbd>
                  {t("kbd_select")}
                </span>
                <span className="inline-flex items-center gap-1">
                  <kbd className="rounded border border-border/60 bg-background px-1 py-0.5 font-mono text-[9px] leading-none text-foreground/80">
                    esc
                  </kbd>
                  {t("kbd_close")}
                </span>
              </div>
              <AppLink
                href={hasQuery ? `${searchAllHref}&adv=1` : "/search?adv=1"}
                onClick={() => {
                  if (hasQuery) addRecentSearch(q);
                  setFocused(false);
                }}
                className="inline-flex items-center gap-1 text-[10px] font-semibold hover:underline"
                style={{ color: "var(--brand)" }}
              >
                <LucideIcons.SlidersHorizontal className="h-3 w-3 shrink-0" aria-hidden />
                {t("advanced")}
              </AppLink>
            </div>
          )}
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
