// Public faceted archive search: /search?q=...&type=&region=&topic=&author=&...
// Fasety, sortowanie, chipy aktywnych filtrów, autosuggest, tolerancja
// literówek (fuzzy w RPC), polska fleksja i zapisane wyszukiwania. Cały stan
// mieszka w URL (zapisywalny / do udostępnienia).
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { ArchiveSkeleton } from "@/components/archive/ArchiveSkeleton";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { useState, useEffect, useRef, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Search as SearchIcon, X, SlidersHorizontal } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ArchivePostList } from "@/components/archive/ArchivePostList";
import { SearchSnippet } from "@/components/search/SearchSnippet";
import { SearchFacetPanel } from "@/components/search/SearchFacetPanel";
import { ActiveFilterChips } from "@/components/search/ActiveFilterChips";
import { SearchAutosuggest } from "@/components/search/SearchAutosuggest";
import { SavedSearchesPanel } from "@/components/search/SavedSearchesPanel";
import { AppLink } from "@/components/atoms/AppLink";
import { supabase } from "@/integrations/supabase/client";
import {
  searchQueryOptions,
  searchAutosuggestQueryOptions,
  searchEnabled,
  SEARCH_LIMIT_MAX,
  SEARCH_PAGE_SIZE,
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
  type SearchUrl,
} from "@/lib/search/facetModel";
import { TAXONOMY_DIMS } from "@/lib/queries/archives";
import { activeLang } from "@/lib/seo/head";
import { getRequestUrl } from "@/lib/seo/request";
import { buildContentHead } from "@/lib/seo/meta";
import "@/lib/i18n-search";

const SORTS = ["relevance", "newest", "popular"] as const;

const SearchParams = z.object({
  q: z.string().optional().default(""),
  spec: z.string().optional(),
  type: z.string().optional(),
  region: z.string().optional(),
  topic: z.string().optional(),
  project: z.string().optional(),
  series: z.string().optional(),
  author: z.string().optional(),
  format: z.string().optional(),
  lang: z.enum(["pl", "en"]).optional(),
  access: z.string().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  year: z.string().optional(),
  sort: z.enum(SORTS).optional(),
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
  const filters: SearchFilters = useMemo(() => urlToFilters(url), [url]);

  // "load more" rośnie przez _limit (search_posts nie ma offsetu). Okno jest
  // kluczowane pełnym zestawem filtrów: każda zmiana wraca na pierwszą stronę.
  const filterKey = JSON.stringify(filters);
  const [paging, setPaging] = useState({ key: filterKey, limit: SEARCH_PAGE_SIZE });
  const limit = paging.key === filterKey ? paging.limit : SEARCH_PAGE_SIZE;

  const enabled = searchEnabled(filters);

  const { data, isFetching, isError } = useQuery({
    ...searchQueryOptions(filters, limit),
    placeholderData: (prev) => prev,
  });

  const posts = data?.posts ?? [];
  const facets = data?.facets ?? [];
  const total = data?.total ?? 0;
  const fuzzy = data?.fuzzy ?? false;
  const canLoadMore = posts.length < total && limit < SEARCH_LIMIT_MAX;

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

  const clearAll = () => navigate({ search: (s: SearchInput) => ({ q: s.q }) as SearchInput });

  const anyFilter = hasAnyFilter(url);

  return (
    <div className="min-h-screen flex flex-col bg-background text-foreground">
      <div className="flex-1 max-w-[1200px] w-full mx-auto px-4 lg:px-8 py-10">
        <Breadcrumbs items={[{ label: t("search.title") }]} />
        <h1 className="font-display text-3xl lg:text-4xl mb-6">{t("search.title")}</h1>

        <form onSubmit={submit} className="flex gap-2 mb-4" role="search">
          <div className="relative flex-1">
            <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
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
              className="icon-input"
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
          <Button type="submit">{t("search.submit")}</Button>
        </form>

        {!enabled ? (
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
        ) : (
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
                <div className="space-y-2">
                  <label className="block text-xs">
                    {t("search.date_from")}
                    <Input
                      type="date"
                      value={search.from ?? ""}
                      onChange={(e) =>
                        applyPatch({ from: e.target.value || undefined, year: undefined })
                      }
                    />
                  </label>
                  <label className="block text-xs">
                    {t("search.date_to")}
                    <Input
                      type="date"
                      value={search.to ?? ""}
                      onChange={(e) =>
                        applyPatch({ to: e.target.value || undefined, year: undefined })
                      }
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
                      {isFetching
                        ? t("search.searching")
                        : t("search.results_count", { count: total })}
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
        )}
      </div>
    </div>
  );
}
