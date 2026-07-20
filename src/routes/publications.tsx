// Biblioteka publikacji (C1): publiczny hub /publications - przeglądanie
// całego dorobku z fasetami (typ, specjalizacja, region, temat, projekt,
// seria, rok, język) i pełnotekstowym wyszukiwaniem.
//
// Architektura: ZERO drugiej implementacji wyszukiwania. Strona reużywa
// silnik /search w trybie browse (searchQueryOptions {browse:true} listuje
// najnowsze bez frazy), panel SearchFacetPanel, chipy ActiveFilterChips
// i model URL->filtry z facetModel - stan biblioteki żyje w parametrach URL
// tak samo jak na /search, więc linki do przefiltrowanych widoków są
// udostępnialne i cache'owalne. Domyślne sortowanie: najnowsze (przegląd
// dorobku), a nie trafność (bez frazy nie ma trafności).
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { z } from "zod";
import { Search as SearchIcon } from "@/lib/lucide-shim";
import { getRequestUrl } from "@/lib/seo/request";
import { activeLang } from "@/lib/seo/head";
import { buildContentHead, splitUrl, SITE_NAME } from "@/lib/seo/meta";
import { safeJsonLd } from "@/lib/seo/jsonld";
import {
  searchQueryOptions,
  SEARCH_PAGE_SIZE,
  SEARCH_LIMIT_MAX,
  type SearchFilters,
  type SearchSort,
} from "@/lib/queries/archives";
import { urlToFilters, collectLabels, type SearchUrl } from "@/lib/search/facetModel";
import { SearchFacetPanel } from "@/components/search/SearchFacetPanel";
import { ActiveFilterChips } from "@/components/search/ActiveFilterChips";
import { PostListCard } from "@/components/molecules/PostListCard";
import { ArchiveSkeleton } from "@/components/archive/ArchiveSkeleton";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const COPY = {
  pl: {
    title: "Publikacje",
    subtitle: "Analizy, komentarze i raporty New European Strategies - pełne archiwum z filtrami.",
    searchPlaceholder: "Szukaj w publikacjach…",
    searchAria: "Szukaj w publikacjach",
    sortLabel: "Sortowanie",
    sortNewest: "Najnowsze",
    sortPopular: "Popularne",
    sortRelevance: "Trafność",
    results_one: "{{count}} publikacja",
    results_few: "{{count}} publikacje",
    results_many: "{{count}} publikacji",
    empty: "Brak publikacji spełniających kryteria. Wyczyść filtry, aby zobaczyć całość dorobku.",
    clearAll: "Wyczyść filtry",
    loadMore: "Pokaż więcej",
    loadError: "Nie udało się wczytać publikacji. Spróbuj ponownie.",
    filtersHeading: "Filtry",
  },
  en: {
    title: "Publications",
    subtitle: "Analyses, commentaries and reports by New European Strategies - the full archive.",
    searchPlaceholder: "Search publications…",
    searchAria: "Search publications",
    sortLabel: "Sort",
    sortNewest: "Newest",
    sortPopular: "Popular",
    sortRelevance: "Relevance",
    results_one: "{{count}} publication",
    results_few: "{{count}} publications",
    results_many: "{{count}} publications",
    empty: "No publications match the filters. Clear them to browse the full archive.",
    clearAll: "Clear filters",
    loadMore: "Load more",
    loadError: "Could not load publications. Please try again.",
    filtersHeading: "Filters",
  },
} as const;

function plural(lang: "pl" | "en", count: number): string {
  const c = COPY[lang];
  if (lang === "en")
    return (count === 1 ? c.results_one : c.results_many).replace("{{count}}", String(count));
  const mod10 = count % 10;
  const mod100 = count % 100;
  const key =
    count === 1
      ? c.results_one
      : mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)
        ? c.results_few
        : c.results_many;
  return key.replace("{{count}}", String(count));
}

// Te same nazwy parametrów co /search (facetModel.DIM_PARAM) - deep-linki
// między wyszukiwarką a biblioteką przenoszą filtry 1:1.
const PublicationsParams = z.object({
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
  sort: z.enum(["newest", "popular", "relevance"]).optional(),
});

type PublicationsInput = z.infer<typeof PublicationsParams>;

export const Route = createFileRoute("/publications")({
  validateSearch: (s: Record<string, unknown>): PublicationsInput => PublicationsParams.parse(s),
  head: () => {
    const url = getRequestUrl() || "/publications";
    const lang = activeLang(url);
    const c = COPY[lang];
    const head = buildContentHead({
      url,
      lang,
      type: "website",
      title: c.title,
      description: c.subtitle,
    });
    const { origin } = splitUrl(url);
    const collection = {
      "@context": "https://schema.org",
      "@type": "CollectionPage",
      name: `${c.title} - ${SITE_NAME}`,
      description: c.subtitle,
      inLanguage: lang,
      url: `${origin}${splitUrl(url).path}`,
      isPartOf: { "@id": `${origin}/#website` },
    };
    return {
      ...head,
      scripts: [{ type: "application/ld+json", children: safeJsonLd(collection) }],
    };
  },
  component: PublicationsPage,
  pendingComponent: () => <ArchiveSkeleton />,
});

function PublicationsPage() {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const { i18n } = useTranslation();
  const lang: "pl" | "en" = i18n.language === "en" ? "en" : "pl";
  const c = COPY[lang];
  const [draft, setDraft] = useState(search.q);

  const url = search as SearchUrl;
  const sort: SearchSort = search.sort ?? "newest";
  const filters: SearchFilters = useMemo(() => ({ ...urlToFilters(url), sort }), [url, sort]);

  const [limit, setLimit] = useState<number>(SEARCH_PAGE_SIZE);

  const { data, isFetching, isError } = useQuery({
    ...searchQueryOptions(filters, limit, { browse: true }),
    placeholderData: (prev) => prev,
  });
  const posts = data?.posts ?? [];
  const facets = data?.facets ?? [];
  const total = data?.total ?? 0;
  const canLoadMore = posts.length < total && limit < SEARCH_LIMIT_MAX;

  // Cache etykiet id->nazwa dla chipów (odporne na zerową liczność fasety).
  const labelCacheRef = useRef<Record<string, string>>({});
  labelCacheRef.current = collectLabels(facets, lang, labelCacheRef.current);

  const patchUrl = (patch: Partial<SearchUrl>) => {
    setLimit(SEARCH_PAGE_SIZE);
    void navigate({
      search: (prev: PublicationsInput): PublicationsInput => {
        const next: Record<string, unknown> = { ...prev, ...patch };
        // Puste wartości znikają z URL (czyste, udostępnialne linki).
        for (const key of Object.keys(next)) {
          const v = next[key];
          if (v === undefined || v === "" || v === null) delete next[key];
        }
        return PublicationsParams.parse(next);
      },
      replace: false,
    });
  };

  const hasAnyFilter = Object.entries(url).some(
    ([key, value]) => key !== "q" && key !== "sort" && value !== undefined && value !== "",
  );

  const submitSearch = (e: React.FormEvent) => {
    e.preventDefault();
    patchUrl({ q: draft.trim() });
  };

  return (
    <div className="flex-1 bg-background text-foreground">
      <div className="container mx-auto max-w-6xl px-4 py-10 lg:py-14">
        <header className="mb-8">
          <h1 className="font-display text-3xl lg:text-4xl">{c.title}</h1>
          <p className="mt-2 text-muted-foreground max-w-2xl">{c.subtitle}</p>
        </header>

        <form onSubmit={submitSearch} className="mb-4 flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[240px]">
            <SearchIcon
              className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground"
              aria-hidden="true"
            />
            <Input
              type="search"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder={c.searchPlaceholder}
              aria-label={c.searchAria}
              className="pl-9"
            />
          </div>
          <Select value={sort} onValueChange={(v) => patchUrl({ sort: v as SearchSort })}>
            <SelectTrigger className="w-40" aria-label={c.sortLabel}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="newest">{c.sortNewest}</SelectItem>
              <SelectItem value="popular">{c.sortPopular}</SelectItem>
              {filters.q.trim().length >= 2 && (
                <SelectItem value="relevance">{c.sortRelevance}</SelectItem>
              )}
            </SelectContent>
          </Select>
        </form>

        <ActiveFilterChips
          url={url}
          facets={facets}
          labelCache={labelCacheRef.current}
          lang={lang}
          onChange={patchUrl}
        />

        <div className="mt-4 grid gap-8 lg:grid-cols-[260px_1fr]">
          <aside aria-label={c.filtersHeading}>
            <SearchFacetPanel facets={facets} url={url} lang={lang} onChange={patchUrl} />
          </aside>

          <section aria-live="polite">
            <p className="mb-4 text-sm text-muted-foreground tabular-nums">{plural(lang, total)}</p>
            {isError ? (
              <p className="text-sm text-destructive">{c.loadError}</p>
            ) : posts.length === 0 && !isFetching ? (
              <div className="rounded-lg border border-border bg-muted/20 p-8 text-center">
                <p className="text-sm text-muted-foreground">{c.empty}</p>
                {hasAnyFilter && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="mt-4"
                    onClick={() => void navigate({ search: () => PublicationsParams.parse({}) })}
                  >
                    {c.clearAll}
                  </Button>
                )}
              </div>
            ) : (
              <>
                <div className="grid gap-6 sm:grid-cols-2">
                  {posts.map((p, idx) => (
                    <PostListCard
                      key={p.id}
                      post={p}
                      href={p.href}
                      lang={lang}
                      titleClassName="text-base"
                      priority={idx === 0}
                      viewTransitionId={p.id}
                    />
                  ))}
                </div>
                {canLoadMore && (
                  <div className="mt-8 flex justify-center">
                    <Button
                      variant="outline"
                      disabled={isFetching}
                      onClick={() => setLimit((l) => Math.min(l * 2, SEARCH_LIMIT_MAX))}
                    >
                      {c.loadMore}
                    </Button>
                  </div>
                )}
              </>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
