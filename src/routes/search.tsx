// Public search page: /search?q=...&category=&author=&from=&to=
// Facets are derived from the match set so users can drill down.
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { ArchiveSkeleton } from "@/components/archive/ArchiveSkeleton";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Search as SearchIcon, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ArchivePostList } from "@/components/archive/ArchivePostList";
import {
  searchQueryOptions,
  SEARCH_LIMIT_MAX,
  SEARCH_PAGE_SIZE,
  type SearchFilters,
} from "@/lib/queries/archives";
import { activeLang } from "@/lib/seo/head";
import { getRequestUrl } from "@/lib/seo/request";
import { buildContentHead } from "@/lib/seo/meta";
import "@/lib/i18n-search";

const SearchParams = z.object({
  q: z.string().optional().default(""),
  category: z.string().optional(),
  author: z.string().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
});

type SearchInput = z.infer<typeof SearchParams>;

export const Route = createFileRoute("/search")({
  validateSearch: (s: Record<string, unknown>): SearchInput => SearchParams.parse(s),
  head: () => {
    // Route through buildContentHead so /search emits the canonical + hreflang
    // (x-default / pl / en) cluster like the other public routes, instead of a
    // hand-rolled meta list that skipped it.
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
  const { t } = useTranslation();
  const { i18n } = useTranslation();
  const lang: "pl" | "en" = i18n.language === "en" ? "en" : "pl";
  const [draft, setDraft] = useState(search.q);

  useEffect(() => {
    setDraft(search.q);
  }, [search.q]);

  const filters: SearchFilters = {
    q: search.q,
    categoryId: search.category,
    authorId: search.author,
    dateFrom: search.from,
    dateTo: search.to,
  };

  // search_posts has no offset, so "load more" paginates by growing _limit
  // (60 -> 120 -> ... -> 300 max). The window is keyed by the serialized
  // filters: changing the query/filters starts back at the first page.
  const filterKey = JSON.stringify([
    search.q,
    search.category,
    search.author,
    search.from,
    search.to,
  ]);
  const [paging, setPaging] = useState({ key: filterKey, limit: SEARCH_PAGE_SIZE });
  const limit = paging.key === filterKey ? paging.limit : SEARCH_PAGE_SIZE;

  const { data, isFetching, isError } = useQuery({
    ...searchQueryOptions(filters, limit),
    // Keep the previous result grid on screen while a bigger page (or a new
    // filter set) loads instead of blanking to zero results.
    placeholderData: (prev) => prev,
  });

  const posts = data?.posts ?? [];
  // The RPC filled the whole window -> more matches may exist server-side, so
  // the exact count would lie; render "N+" and offer "load more" (until the cap).
  const resultsCapped = posts.length >= limit;
  const canLoadMore = resultsCapped && limit < SEARCH_LIMIT_MAX;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    navigate({ search: (s: SearchInput) => ({ ...s, q: draft }) });
  };

  const updateFilter = (key: keyof SearchInput, value: string | undefined) => {
    navigate({ search: (s: SearchInput) => ({ ...s, [key]: value || undefined }) });
  };

  const clearAll = () => navigate({ search: { q: search.q } });

  const active = !!search.category || !!search.author || !!search.from || !!search.to;

  return (
    <div className="min-h-screen flex flex-col bg-background text-foreground">
      <div className="flex-1 max-w-[1200px] w-full mx-auto px-4 lg:px-8 py-10">
        <Breadcrumbs items={[{ label: t("search.title") }]} />
        <h1 className="font-display text-3xl lg:text-4xl mb-6">{t("search.title")}</h1>
        <form onSubmit={submit} className="flex gap-2 mb-8">
          <div className="relative flex-1">
            <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder={t("search.placeholder")}
              aria-label={t("search.placeholder")}
              className="icon-input"
              autoFocus
            />
          </div>
          <Button type="submit">{t("search.submit")}</Button>
        </form>

        {search.q.trim().length < 2 ? (
          <p className="text-sm text-muted-foreground">{t("search.min_chars")}</p>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-[260px_1fr] gap-8">
            <aside className="space-y-5">
              <header className="flex items-center justify-between">
                <h2 className="text-sm font-semibold">{t("search.filters")}</h2>
                {active && (
                  <button
                    onClick={clearAll}
                    className="text-xs text-brand inline-flex items-center gap-1 hover:underline"
                  >
                    <X className="w-3 h-3" />
                    {t("search.clear")}
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
                      onChange={(e) => updateFilter("from", e.target.value)}
                    />
                  </label>
                  <label className="block text-xs">
                    {t("search.date_to")}
                    <Input
                      type="date"
                      value={search.to ?? ""}
                      onChange={(e) => updateFilter("to", e.target.value)}
                    />
                  </label>
                </div>
              </div>

              {data && data.facets.categories.length > 0 && (
                <div>
                  <h3 className="text-xs uppercase tracking-wider text-muted-foreground mb-2">
                    {t("search.categories")}
                  </h3>
                  <ul className="space-y-1 text-sm">
                    {data.facets.categories.map((c) => {
                      const isActive = search.category === c.id;
                      return (
                        <li key={c.id}>
                          <button
                            type="button"
                            onClick={() => updateFilter("category", isActive ? undefined : c.id)}
                            className={`w-full text-left flex justify-between items-center px-2 py-1 rounded ${isActive ? "bg-brand/10 text-brand" : "hover:bg-muted"}`}
                          >
                            <span className="truncate">{c.name}</span>
                            <span className="text-xs text-muted-foreground">{c.count}</span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}

              {data && data.facets.authors.length > 0 && (
                <div>
                  <h3 className="text-xs uppercase tracking-wider text-muted-foreground mb-2">
                    {t("search.authors")}
                  </h3>
                  <ul className="space-y-1 text-sm">
                    {data.facets.authors.map((a) => {
                      const isActive = search.author === a.id;
                      return (
                        <li key={a.id}>
                          <button
                            type="button"
                            onClick={() => updateFilter("author", isActive ? undefined : a.id)}
                            className={`w-full text-left flex justify-between items-center px-2 py-1 rounded ${isActive ? "bg-brand/10 text-brand" : "hover:bg-muted"}`}
                          >
                            <span className="truncate">{a.name}</span>
                            <span className="text-xs text-muted-foreground">{a.count}</span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}
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
                  <p className="text-sm text-muted-foreground mb-4">
                    {isFetching
                      ? t("search.searching")
                      : resultsCapped
                        ? t("search.results_count_plus", {
                            defaultValue: lang === "en" ? "Results: {{n}}+" : "Wyników: {{n}}+",
                            n: posts.length,
                          })
                        : t("search.results_count", { count: posts.length })}
                  </p>
                  {data && (
                    <ArchivePostList posts={posts} lang={lang} emptyText={t("search.empty")} />
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
