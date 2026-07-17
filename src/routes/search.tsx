// Publiczna wyszukiwarka premium: /search?q=...&tab=&match=&scope=&type=&org=...
// Sekcje wyników (Wszystko / Tytuły / Rodzaje treści / Tematyka / Osoby
// i organizacje), tryby zaawansowane (dopasowanie all/any/phrase, zakres
// wszędzie/tytuły, składnia "fraza" i -wykluczenie), fasety, chipy aktywnych
// filtrów, autosuggest w czterech premium kubełkach, tolerancja literówek
// (fuzzy w RPC), polska fleksja i zapisane wyszukiwania. Cały stan mieszka
// w URL (zapisywalny / do udostępnienia).
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { ArchiveSkeleton } from "@/components/archive/ArchiveSkeleton";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { useState, useEffect, useRef, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Search as SearchIcon, X, SlidersHorizontal, ChevronDown } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ArchivePostList } from "@/components/archive/ArchivePostList";
import { SearchSnippet } from "@/components/search/SearchSnippet";
import { SearchFacetPanel } from "@/components/search/SearchFacetPanel";
import { ActiveFilterChips } from "@/components/search/ActiveFilterChips";
import { SearchAutosuggest } from "@/components/search/SearchAutosuggest";
import { SavedSearchesPanel } from "@/components/search/SavedSearchesPanel";
import { AdvancedSearchPanel } from "@/components/search/AdvancedSearchPanel";
import { SearchSectionTabs } from "@/components/search/SearchSectionTabs";
import { PeopleOrgResults, PeopleOrgStrip } from "@/components/search/PeopleOrgResults";
import { TermExplorer } from "@/components/search/TermExplorer";
import { AppLink } from "@/components/atoms/AppLink";
import { supabase } from "@/integrations/supabase/client";
import {
  searchQueryOptions,
  searchAutosuggestQueryOptions,
  searchPeopleOrgsQueryOptions,
  searchEnabled,
  SEARCH_LIMIT_MAX,
  SEARCH_PAGE_SIZE,
  TAXONOMY_DIMS,
  type FacetDim,
  type SearchFilters,
  type SearchResultItem,
  type SearchSort,
  type AutosuggestItem,
} from "@/lib/queries/archives";
import {
  urlToFilters,
  collectLabels,
  hasAnyFilter,
  orderSuggestions,
  AUTOSUGGEST_LISTBOX_ID,
  autosuggestOptionId,
  DIM_PARAM,
  type SearchTab,
  type SearchUrl,
} from "@/lib/search/facetModel";
import { activeLang } from "@/lib/seo/head";
import { getRequestUrl } from "@/lib/seo/request";
import { buildContentHead } from "@/lib/seo/meta";
import "@/lib/i18n-search";

const SORTS = ["relevance", "newest", "popular"] as const;

// Wymiary eksplorowane w zakładkach "Rodzaje treści" i "Tematyka".
const TYPES_DIMS: readonly FacetDim[] = ["pub_type", "format", "access", "lang"] as const;
const TOPICS_DIMS: readonly FacetDim[] = [
  "topic",
  "region",
  "category",
  "project",
  "series",
] as const;

const SearchParams = z.object({
  q: z.string().optional().default(""),
  spec: z.string().optional(),
  type: z.string().optional(),
  region: z.string().optional(),
  topic: z.string().optional(),
  project: z.string().optional(),
  series: z.string().optional(),
  org: z.string().optional(),
  author: z.string().optional(),
  format: z.string().optional(),
  lang: z.enum(["pl", "en"]).optional(),
  access: z.string().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  year: z.string().optional(),
  sort: z.enum(SORTS).optional(),
  match: z.enum(["all", "any", "phrase"]).optional(),
  scope: z.enum(["all", "title"]).optional(),
  tab: z.enum(["all", "titles", "types", "topics", "people"]).optional(),
  /** adv=1 otwiera panel trybów zaawansowanych (deep-link z widgetu nagłówka). */
  adv: z.string().optional(),
});

type SearchInput = z.infer<typeof SearchParams>;

export const Route = createFileRoute("/search")({
  validateSearch: (s: Record<string, unknown>): SearchInput => SearchParams.parse(s),
  head: () => {
    // Route through buildContentHead so /search emits the canonical + hreflang
    // (x-default / pl / en) cluster like the other public routes.
    const url = getRequestUrl() || "/search";
    const lang = activeLang(url);
    return buildContentHead({
      url,
      lang,
      type: "website",
      title: lang === "en" ? "Search" : "Szukaj",
      description: lang === "en" ? "Article search" : "Wyszukiwarka wpisów",
    });
  },
  component: SearchPage,
  pendingComponent: () => <ArchiveSkeleton />,
});

function SearchPage() {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const { t, i18n } = useTranslation();
  const lang: "pl" | "en" = i18n.language === "en" ? "en" : "pl";
  const [draft, setDraft] = useState(search.q);

  useEffect(() => {
    setDraft(search.q);
  }, [search.q]);

  const url = search as SearchUrl;
  const tab: SearchTab = search.tab ?? "all";
  const filters: SearchFilters = useMemo(() => urlToFilters(url), [url]);

  // Panel trybów zaawansowanych: otwarty, gdy dowolny tryb jest aktywny
  // albo przyszliśmy deep-linkiem adv=1 (stopka widgetu w nagłówku).
  const [advOpen, setAdvOpen] = useState(!!(url.match || url.scope) || search.adv === "1");

  // "load more" rośnie przez _limit (search_posts nie ma offsetu). Okno jest
  // kluczowane pełnym zestawem filtrów: każda zmiana wraca na pierwszą stronę.
  const filterKey = JSON.stringify(filters);
  const [paging, setPaging] = useState({ key: filterKey, limit: SEARCH_PAGE_SIZE });
  const limit = paging.key === filterKey ? paging.limit : SEARCH_PAGE_SIZE;

  const enabled = searchEnabled(filters);
  const qTrimmed = filters.q.trim();

  const { data, isFetching, isError } = useQuery({
    ...searchQueryOptions(filters, limit),
    placeholderData: (prev) => prev,
  });

  // Osoby i organizacje: pełna sekcja w zakładce "people" (także tryb
  // przeglądania bez frazy) + kompaktowy pasek nad wynikami "Wszystko".
  const peopleLimit = tab === "people" ? 60 : 6;
  const peopleQuery = useQuery({
    ...searchPeopleOrgsQueryOptions(qTrimmed, peopleLimit),
    enabled: tab === "people" || (tab === "all" && qTrimmed.length >= 2),
    placeholderData: (prev) => prev,
  });
  const peopleItems = peopleQuery.data ?? [];

  const posts = data?.posts ?? [];
  const facets = data?.facets ?? [];
  const total = data?.total ?? 0;
  const fuzzy = data?.fuzzy ?? false;
  const canLoadMore = posts.length < total && limit < SEARCH_LIMIT_MAX;

  // Liczniki zakładek: tanie i uczciwe - wyniki na aktywnej zakładce wpisów,
  // liczności termów z faset, osoby/organizacje po załadowaniu sekcji.
  const tabCounts = useMemo(() => {
    const counts: Partial<Record<SearchTab, number>> = {};
    if (data) {
      if (tab === "all") counts.all = total;
      if (tab === "titles") counts.titles = total;
      counts.types = data.facets.filter((f) =>
        (TYPES_DIMS as readonly string[]).includes(f.dim),
      ).length;
      counts.topics = data.facets.filter((f) =>
        (TOPICS_DIMS as readonly string[]).includes(f.dim),
      ).length;
    }
    if (peopleQuery.data) counts.people = peopleQuery.data.length;
    return counts;
  }, [data, peopleQuery.data, tab, total]);

  // Cache etykiet id→nazwa (dla chipów odpornych na zerową liczność). Merge w
  // trakcie renderu jest idempotentny, więc ref jest tu bezpieczny.
  const labelCacheRef = useRef<Record<string, string>>({});
  labelCacheRef.current = collectLabels(facets, lang, labelCacheRef.current);

  // ---- Autosuggest -------------------------------------------------------
  const [sugOpen, setSugOpen] = useState(false);
  const [sugIndex, setSugIndex] = useState(-1);
  const suggestQ = draft.trim();
  const { data: sugRaw } = useQuery({
    ...searchAutosuggestQueryOptions(suggestQ, 8),
    enabled: sugOpen && suggestQ.length >= 2,
  });
  const suggestions = useMemo(() => orderSuggestions(sugRaw ?? []), [sugRaw]);
  const showSuggest = sugOpen && suggestions.length > 0 && suggestQ.length >= 2;

  useEffect(() => {
    setSugIndex(-1);
  }, [suggestQ]);

  const applyPatch = (patch: Partial<SearchUrl>) => {
    navigate({ search: (s: SearchInput) => ({ ...s, ...patch }) as SearchInput });
  };

  const setTab = (next: SearchTab) => {
    applyPatch({ tab: next === "all" ? undefined : next });
  };

  const submitPhrase = (phrase: string) => {
    setSugOpen(false);
    navigate({ search: (s: SearchInput) => ({ ...s, q: phrase }) });
  };

  const pickSuggestion = async (item: AutosuggestItem) => {
    setSugOpen(false);
    if (item.kind === "post") {
      // Deep-link do publikacji: ścieżkę rodzica rozwiązujemy jednym RPC na
      // klik (nie per-keystroke). Fallback: potraktuj tytuł jak frazę.
      try {
        if (item.parentPageId && item.slug) {
          const { data: path } = await supabase.rpc("page_full_path", {
            _page_id: item.parentPageId,
          });
          if (typeof path === "string") {
            // href-owa nawigacja (jak AppLink): dowolna ścieżka splat bez
            // typowanych params trasy.
            navigate({ href: `/${path}/${item.slug}` } as never);
            return;
          }
        }
      } catch {
        /* padnij na frazę poniżej */
      }
      submitPhrase(lang === "en" ? item.label_en || item.label_pl : item.label_pl || item.label_en);
      return;
    }
    if (item.kind === "author" && item.id) {
      setDraft("");
      applyPatch({ q: "", author: item.id });
      return;
    }
    // Term taksonomii: kind == FacetDim; mapujemy na parametr URL.
    const dim = item.kind as (typeof TAXONOMY_DIMS)[number];
    if (TAXONOMY_DIMS.includes(dim) && item.id) {
      setDraft("");
      applyPatch({ q: "", [DIM_PARAM[dim]]: item.id });
    }
  };

  const onInputKeyDown = (e: React.KeyboardEvent) => {
    if (!showSuggest) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSugIndex((i) => (i + 1) % suggestions.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSugIndex((i) => (i <= 0 ? suggestions.length - 1 : i - 1));
    } else if (e.key === "Enter" && sugIndex >= 0) {
      e.preventDefault();
      void pickSuggestion(suggestions[sugIndex]);
    } else if (e.key === "Escape") {
      setSugOpen(false);
    }
  };

  // ---- Did-you-mean (trgm nad tytułami) - tylko przy prawdziwym zerze ------
  const suggest = useQuery({
    queryKey: ["public", "search-suggest", filters.q] as const,
    enabled: enabled && !isFetching && posts.length === 0 && filters.q.trim().length >= 2,
    staleTime: 60_000,
    queryFn: async () => {
      try {
        const { data: rows } = await supabase.rpc("search_suggest", {
          _q: filters.q.trim(),
          _limit: 5,
        });
        return rows ?? [];
      } catch {
        return [];
      }
    },
  });

  // Popularne frazy - podpowiedź w stanie pustym (brak frazy i filtrów).
  const popular = useQuery({
    queryKey: ["public", "popular-searches"] as const,
    enabled: !enabled,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      try {
        const { data: rows } = await supabase.rpc("popular_searches", { _days: 30, _limit: 6 });
        return rows ?? [];
      } catch {
        return [];
      }
    },
  });

  const snippetFor = (p: SearchResultItem) => {
    const raw = lang === "en" ? p.headline_en || p.headline_pl : p.headline_pl || p.headline_en;
    if (!raw || !raw.includes("[[[")) return undefined;
    return <SearchSnippet text={raw} />;
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    submitPhrase(draft);
  };

  const clearAll = () =>
    navigate({ search: (s: SearchInput) => ({ q: s.q, tab: s.tab }) as SearchInput });

  const anyFilter = hasAnyFilter(url);
  const showPostTabs = tab === "all" || tab === "titles";

  // Sekcja wpisów (Wszystko / Tytuły): fasety + lista wyników.
  const postResults = (
    <div className="grid grid-cols-1 lg:grid-cols-[260px_1fr] gap-8">
      <aside className="space-y-5">
        <header className="flex items-center justify-between">
          <h2 className="text-sm font-semibold flex items-center gap-1.5">
            <SlidersHorizontal className="w-4 h-4" />
            {t("search.filters")}
          </h2>
          {anyFilter && (
            <button
              onClick={clearAll}
              className="text-xs text-brand-ink inline-flex items-center gap-1 hover:underline"
            >
              <X className="w-3 h-3" />
              {t("search.clear_all")}
            </button>
          )}
        </header>

        <div>
          <h3 className="text-xs uppercase tracking-wider text-muted-foreground mb-2">
            {t("search.date")}
          </h3>
          <div className="grid grid-cols-2 gap-2">
            <label className="block">
              <span className="mb-1 block text-[11px] font-medium text-muted-foreground">
                {t("search.date_from")}
              </span>
              <Input
                type="date"
                className="h-9 text-xs"
                value={search.from ?? ""}
                onChange={(e) => applyPatch({ from: e.target.value || undefined, year: undefined })}
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-[11px] font-medium text-muted-foreground">
                {t("search.date_to")}
              </span>
              <Input
                type="date"
                className="h-9 text-xs"
                value={search.to ?? ""}
                onChange={(e) => applyPatch({ to: e.target.value || undefined, year: undefined })}
              />
            </label>
          </div>

        </div>

        <SearchFacetPanel facets={facets} url={url} lang={lang} onChange={applyPatch} />

        <div className="pt-4 border-t border-border">
          <SavedSearchesPanel
            current={url}
            canSave={enabled}
            onApply={(params) =>
              navigate({ search: () => ({ ...params, q: params.q ?? "" }) as SearchInput })
            }
          />
        </div>
      </aside>

      <section>
        {isError ? (
          <p className="text-sm text-destructive mb-4">
            {t("search.error", {
              defaultValue:
                lang === "en"
                  ? "Search failed. Please try again."
                  : "Wyszukiwanie nie powiodło się. Spróbuj ponownie.",
            })}
          </p>
        ) : (
          <>
            <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
              <p className="text-sm text-muted-foreground" aria-live="polite">
                {isFetching ? t("search.searching") : t("search.results_count", { count: total })}
              </p>
              <div
                className="inline-flex rounded-lg border border-border p-0.5 text-xs"
                role="group"
                aria-label={t("search.sort.label")}
              >
                {SORTS.map((s) => {
                  const active = (search.sort ?? "relevance") === s;
                  return (
                    <button
                      key={s}
                      type="button"
                      aria-pressed={active}
                      onClick={() =>
                        applyPatch({
                          sort: s === "relevance" ? undefined : (s as SearchSort),
                        })
                      }
                      className={`px-2.5 py-1 rounded-md transition ${
                        active
                          ? "bg-brand text-brand-foreground"
                          : "text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      {t(`search.sort.${s}`)}
                    </button>
                  );
                })}
              </div>
            </div>

            {anyFilter && (
              <div className="mb-4">
                <ActiveFilterChips
                  url={url}
                  facets={facets}
                  labelCache={labelCacheRef.current}
                  lang={lang}
                  onChange={applyPatch}
                />
              </div>
            )}

            {fuzzy && (
              <p className="mb-4 text-xs text-muted-foreground rounded-md bg-muted/40 border border-border px-3 py-2">
                {t("search.fuzzy_note")}
              </p>
            )}

            {tab === "all" && peopleItems.length > 0 && (
              <div className="mb-6">
                <PeopleOrgStrip items={peopleItems} lang={lang} onSeeAll={() => setTab("people")} />
              </div>
            )}

            {data && (
              <ArchivePostList
                posts={posts}
                lang={lang}
                emptyText={t("search.empty")}
                getExcerptOverride={(p) => snippetFor(p as SearchResultItem)}
              />
            )}

            {!isFetching && posts.length === 0 && (suggest.data?.length ?? 0) > 0 && (
              <div className="mt-6">
                <p className="text-sm font-medium mb-2">
                  {t("search.didYouMean", {
                    defaultValue: lang === "en" ? "Did you mean:" : "Czy chodziło Ci o:",
                  })}
                </p>
                <ul className="space-y-1.5">
                  {(suggest.data ?? []).map((s) => (
                    <li key={s.id}>
                      <AppLink
                        href={`/search?q=${encodeURIComponent(
                          (lang === "en" ? s.title_en || s.title_pl : s.title_pl) ?? "",
                        )}`}
                        className="text-sm text-brand-ink hover:underline"
                      >
                        {lang === "en" ? s.title_en || s.title_pl : s.title_pl || s.title_en}
                      </AppLink>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {canLoadMore && (
              <div className="flex justify-center pt-6">
                <Button
                  variant="outline"
                  disabled={isFetching}
                  onClick={() =>
                    setPaging({
                      key: filterKey,
                      limit: Math.min(limit + SEARCH_PAGE_SIZE, SEARCH_LIMIT_MAX),
                    })
                  }
                >
                  {isFetching
                    ? t("common.loading", {
                        defaultValue: lang === "en" ? "Loading..." : "Ładowanie...",
                      })
                    : t("common.loadMore", {
                        defaultValue: lang === "en" ? "Load more" : "Załaduj więcej",
                      })}
                </Button>
              </div>
            )}
          </>
        )}
      </section>
    </div>
  );

  // Zakładki eksploracyjne: Rodzaje treści / Tematyka.
  const explorerResults = (dims: readonly FacetDim[]) => (
    <TermExplorer facets={facets} dims={dims} lang={lang} onChange={applyPatch} />
  );

  // Sekcja "Osoby i organizacje": działa też bez frazy (tryb przeglądania).
  const peopleResults = (
    <div className="space-y-4">
      {qTrimmed.length < 2 && (
        <p className="text-sm text-muted-foreground">{t("search.people.browse_hint")}</p>
      )}
      {peopleQuery.isFetching && peopleItems.length === 0 ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              className="h-24 rounded-xl border border-border/60 bg-muted/40 animate-pulse"
            />
          ))}
        </div>
      ) : peopleItems.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
          {t("search.people.empty")}
        </p>
      ) : (
        <PeopleOrgResults items={peopleItems} lang={lang} />
      )}
    </div>
  );

  return (
    <div className="min-h-screen flex flex-col bg-background text-foreground">
      <div className="flex-1 max-w-[1200px] w-full mx-auto px-4 lg:px-8 py-10">
        <Breadcrumbs items={[{ label: t("search.title") }]} />
        <header className="mb-6">
          <h1 className="font-display text-3xl lg:text-5xl tracking-tight mb-2">
            {t("search.title")}
          </h1>
          <p className="text-sm text-muted-foreground max-w-2xl">{t("search.hero_sub")}</p>
        </header>

        <form onSubmit={submit} className="flex gap-2 mb-2" role="search">
          <div className="relative flex-1">
            <SearchIcon className="absolute left-5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
            <Input
              value={draft}
              onChange={(e) => {
                setDraft(e.target.value);
                setSugOpen(true);
              }}
              onFocus={() => setSugOpen(true)}
              onBlur={() => setSugOpen(false)}
              onKeyDown={onInputKeyDown}
              placeholder={t("search.placeholder")}
              aria-label={t("search.placeholder")}
              className="h-12 rounded-xl pl-16 text-base shadow-sm"
              autoFocus
              role="combobox"
              aria-expanded={showSuggest}
              aria-controls={AUTOSUGGEST_LISTBOX_ID}
              aria-autocomplete="list"
              aria-activedescendant={
                showSuggest && sugIndex >= 0 ? autosuggestOptionId(sugIndex) : undefined
              }
            />
            {showSuggest && (
              <SearchAutosuggest
                items={suggestions}
                activeIndex={sugIndex}
                lang={lang}
                onPick={(it) => void pickSuggestion(it)}
              />
            )}
          </div>
          <Button type="submit" size="lg" className="h-12 rounded-xl px-6">
            {t("search.submit")}
          </Button>
        </form>

        <div className="mb-4">
          <button
            type="button"
            onClick={() => setAdvOpen((o) => !o)}
            aria-expanded={advOpen}
            className="inline-flex items-center gap-1.5 text-xs font-medium text-brand-ink hover:underline"
          >
            <SlidersHorizontal className="w-3.5 h-3.5" aria-hidden />
            {t("search.adv.toggle")}
            <ChevronDown
              className={`w-3.5 h-3.5 transition-transform ${advOpen ? "rotate-180" : ""}`}
              aria-hidden
            />
          </button>
          {advOpen && (
            <div className="mt-3">
              <AdvancedSearchPanel url={url} onChange={applyPatch} />
            </div>
          )}
        </div>

        <div className="mb-6">
          <SearchSectionTabs active={tab} counts={tabCounts} onPick={setTab} />
        </div>

        {tab === "people" ? (
          peopleResults
        ) : !enabled ? (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">{t("search.min_chars")}</p>
            {(popular.data?.length ?? 0) > 0 && (
              <div>
                <p className="text-xs uppercase tracking-wider text-muted-foreground mb-2">
                  {t("search.popular", {
                    defaultValue: lang === "en" ? "Popular searches" : "Popularne wyszukiwania",
                  })}
                </p>
                <div className="flex flex-wrap gap-2">
                  {(popular.data ?? []).map((p) => (
                    <button
                      key={p.q}
                      type="button"
                      onClick={() => {
                        setDraft(p.q);
                        submitPhrase(p.q);
                      }}
                      className="rounded-full border border-border bg-muted/40 px-3 py-1 text-xs text-foreground transition hover:bg-muted"
                    >
                      {p.q}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        ) : showPostTabs ? (
          postResults
        ) : tab === "types" ? (
          explorerResults(TYPES_DIMS)
        ) : (
          explorerResults(TOPICS_DIMS)
        )}
      </div>
    </div>
  );
}
