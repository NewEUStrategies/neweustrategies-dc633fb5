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
//
// PAGINACJA LINKOWA (`?page=N`). Dotąd „Pokaż więcej" podwajało limit jednego
// zapytania: strony nie miały adresów (nie dało się ich udostępnić ani dać
// crawlerowi), każde doładowanie przeliczało całe rosnące okno od pierwszego
// wiersza, a wszystko za sufitem okna było nieosiągalne. Teraz każda strona to
// osobne okno `search_posts` (`_offset`, migracja 20261003100100) pod własnym
// adresem, a pasek stron to prawdziwe `<a href>` (ArchivePagination) - ta sama
// konwencja co archiwa kategorii, tagów i /blog.
import { createFileRoute, Link, useNavigate, useRouter } from "@tanstack/react-router";
import { useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { z } from "zod";
import { Search as SearchIcon } from "@/lib/lucide-shim";
import { getRequestUrl } from "@/lib/seo/request";
import { activeLang } from "@/lib/seo/head";
import { buildContentHead, splitUrl, SITE_NAME } from "@/lib/seo/meta";
import { safeJsonLd } from "@/lib/seo/jsonld";
import { parsePageSearch } from "@/lib/routing/pageSearch";
import {
  SEARCH_PAGE_SIZE,
  searchQueryOptions,
  searchTotalPages,
  type SearchFilters,
  type SearchSort,
} from "@/lib/queries/archives";
import { urlToFilters, collectLabels, type SearchUrl } from "@/lib/search/facetModel";
import { SearchFacetPanel } from "@/components/search/SearchFacetPanel";
import { ActiveFilterChips } from "@/components/search/ActiveFilterChips";
import { PostListCard } from "@/components/molecules/PostListCard";
import { ArchiveSkeleton } from "@/components/archive/ArchiveSkeleton";
import { ArchivePagination } from "@/components/archive/layouts/ArchivePagination";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export const COPY = {
  pl: {
    title: "Publikacje",
    titlePaged: "Publikacje (strona {{page}})",
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
    outOfRange: "Strona {{page}} nie istnieje - wyniki kończą się na stronie {{last}}.",
    outOfRangeCapped:
      "Przeglądać można najwyżej {{last}} stron wyników. Zawęź filtry albo frazę, aby dotrzeć do dalszych publikacji.",
    lastPage: "Przejdź do strony {{last}}",
    loadError: "Nie udało się wczytać publikacji. Spróbuj ponownie.",
    filtersHeading: "Filtry",
  },
  en: {
    title: "Publications",
    titlePaged: "Publications (page {{page}})",
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
    outOfRange: "Page {{page}} does not exist - the results end on page {{last}}.",
    outOfRangeCapped:
      "Only the first {{last}} pages of results can be browsed. Narrow the filters or the phrase to reach further publications.",
    lastPage: "Go to page {{last}}",
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
//
// WARTOŚCI DOMYŚLNE ZOSTAJĄ NIEJAWNE - także pusta fraza. Do paginacji `q` miał
// `.default("")`, a router SCALA wynik walidatora z adresem przy KAŻDEJ
// nawigacji i przy renderze SSR porównuje oba adresy: goły `/publications`
// odpowiadał więc 307 na `/publications?q=` (kanoniczny adres z head()
// przekierowywał), a każdy link paska stron niósłby `q=`. Pusta fraza jest
// brakiem frazy - komponent czyta ją jako `search.q ?? ""`.
import { PublicationsParams, type PublicationsInput } from "@/lib/publications/params";

/**
 * Kanoniczny search biblioteki: puste wartości znikają, reszta przechodzi
 * przez walidator trasy. Walidator normalizuje numer strony (1 znika z adresu)
 * i ZDEJMUJE parametry spoza schematu - `utm_*` z wejścia nie rozmnaża się po
 * linkach paska i nie udaje filtra do wyczyszczenia.
 */
function canonicalSearch(raw: Record<string, unknown>): PublicationsInput {
  const next: Record<string, unknown> = { ...raw };
  for (const key of Object.keys(next)) {
    const v = next[key];
    if (v === undefined || v === "" || v === null) delete next[key];
  }
  return PublicationsParams.parse(next);
}

/**
 * Search strony `nextPage` przy ZACHOWANYCH filtrach - jedyne źródło adresu
 * strony dla linków paska, nawigacji i odesłania spoza zakresu. Router
 * serializuje przy nawigacji ten sam obiekt, a SSR nie ma czego w nim
 * kanonizować, więc `href` linku jest dokładnie adresem, pod który prowadzi
 * kliknięcie - bez przekierowania po drodze.
 */
function withPage(search: Record<string, unknown>, nextPage: number): PublicationsInput {
  return canonicalSearch({ ...search, page: nextPage });
}

export const Route = createFileRoute("/publications")({
  validateSearch: (s: Record<string, unknown>): PublicationsInput => PublicationsParams.parse(s),
  head: ({ match }) => {
    const url = getRequestUrl() || "/publications";
    const lang = activeLang(url);
    const c = COPY[lang];
    // Ta sama konwencja co archiwa kategorii/tagów i /blog: kanoniczny adres
    // BEZ parametrów (splitUrl bierze samą ścieżkę), a strony od drugiej są
    // `noindex, follow` - crawler idzie po linkach do publikacji, ale indeks
    // konsoliduje się na stronie pierwszej. `match` bywa pusty, gdy head()
    // woła się poza routerem (kontrakt w testach) - wtedy to strona pierwsza.
    const page = match?.search?.page ?? 1;
    const title = page > 1 ? c.titlePaged.replace("{{page}}", String(page)) : c.title;
    const head = buildContentHead({
      url,
      lang,
      type: "website",
      title,
      description: c.subtitle,
      robots: page > 1 ? "noindex, follow" : null,
    });
    const { origin } = splitUrl(url);
    const collection = {
      "@context": "https://schema.org",
      "@type": "CollectionPage",
      name: `${title} - ${SITE_NAME}`,
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
  const router = useRouter();
  const { t, i18n } = useTranslation();
  const lang: "pl" | "en" = i18n.language === "en" ? "en" : "pl";
  const c = COPY[lang];
  const [draft, setDraft] = useState(search.q ?? "");

  // Strona żyje w adresie obok filtrów, ale filtrem NIE JEST: panel faset,
  // chipy i bramka „są aktywne filtry" dostają stan bez niej - inaczej
  // `?page=2` liczyłoby się jako filtr do wyczyszczenia. Stan idzie przez
  // `canonicalSearch`, bo `useSearch()` oddaje search LUŹNY (surowe parametry
  // adresu scalone z wynikiem walidatora) - `utm_source` też byłby „filtrem".
  const page = search.page ?? 1;
  const url: SearchUrl = useMemo(() => {
    const { page: _page, q, ...filtersOnly } = canonicalSearch(search);
    return { ...filtersOnly, q: q ?? "" };
  }, [search]);
  const sort: SearchSort = search.sort ?? "newest";
  const filters: SearchFilters = useMemo(() => ({ ...urlToFilters(url), sort }), [url, sort]);

  const { data, isFetching, isError, isPlaceholderData } = useQuery({
    ...searchQueryOptions(filters, undefined, { browse: true, page }),
    // Poprzednia strona zostaje na ekranie, dopóki nie przyjedzie następna -
    // bez mignięcia pustej siatki przy każdym kliknięciu w pasek stron.
    placeholderData: (prev) => prev,
  });
  const posts = data?.posts ?? [];
  const facets = data?.facets ?? [];
  const total = data?.total ?? 0;
  const totalPages = searchTotalPages(total);
  // STRONA ZA KOŃCEM ZBIORU (stary link, skasowane wpisy, ręcznie wpisane
  // `?page=`). Komunikat „brak publikacji" byłby tu nieprawdą - wyniki SĄ,
  // tylko na wcześniejszych stronach - więc czytelnik dostaje odesłanie do
  // ostatniej istniejącej strony. Dopóki na ekranie wiszą dane poprzedniego
  // klucza (placeholderData), werdyktu nie ma: liczność należy do innej strony.
  const outOfRange = !isPlaceholderData && total > 0 && page > totalPages;
  // Zbiór większy niż sufit przesunięcia (`SEARCH_MAX_PAGE`): wyniki ZA
  // ostatnią stroną istnieją, tylko nie da się do nich przewinąć. Zdanie
  // „wyniki kończą się na stronie N" przeczyłoby licznikowi obok.
  const rangeCapped = total > totalPages * SEARCH_PAGE_SIZE;

  // Powrót na górę po zmianie STRONY należy do routera (`scrollRestoration`
  // w `src/router.tsx`): nowy wpis historii zaczyna od góry, krok „wstecz"
  // wraca na zapamiętaną pozycję, a reset jest skokiem bez animacji, więc
  // „ogranicz ruch" nie ma czego wyciszać. Własny `scrollTo` trasy był po nim
  // przewinięciem z 0 na 0, a przy „wstecz" nadpisywał przywróconą pozycję.

  // Cache etykiet id->nazwa dla chipów (odporne na zerową liczność fasety).
  const labelCacheRef = useRef<Record<string, string>>({});
  labelCacheRef.current = collectLabels(facets, lang, labelCacheRef.current);

  // Każda zmiana filtra, frazy albo sortowania wraca na STRONĘ PIERWSZĄ: nowy
  // zbiór ma inną liczbę stron, a strona 7 starego zbioru nie znaczy w nim nic.
  // Puste wartości znikają z URL (czyste, udostępnialne linki).
  const patchUrl = (patch: Partial<SearchUrl>) => {
    void navigate({
      search: (prev: PublicationsInput): PublicationsInput =>
        canonicalSearch({ ...prev, ...patch, page: undefined }),
      replace: false,
    });
  };

  // SEO: realne adresy stron wyników. `buildLocation().publicHref` przechodzi
  // przez rewrite routera (prefiks języka /en/...) i jego serializację search -
  // dokładnie jak <Link> i jak nawigacja po kliknięciu.
  const hrefFor = (nextPage: number) =>
    router.buildLocation({ to: "/publications", search: withPage(search, nextPage) }).publicHref;
  const onPageChange = (nextPage: number) => {
    void navigate({ search: (prev: PublicationsInput) => withPage(prev, nextPage) });
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
            ) : outOfRange ? (
              <div className="rounded-lg border border-border bg-muted/20 p-8 text-center">
                <p className="text-sm text-muted-foreground">
                  {(rangeCapped ? c.outOfRangeCapped : c.outOfRange)
                    .replace("{{page}}", String(page))
                    .replace("{{last}}", String(totalPages))}
                </p>
                <Button asChild variant="outline" size="sm" className="mt-4">
                  <Link to="/publications" search={withPage(search, totalPages)}>
                    {c.lastPage.replace("{{last}}", String(totalPages))}
                  </Link>
                </Button>
              </div>
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
                {totalPages > 1 && (
                  <div className="mt-8">
                    <ArchivePagination
                      page={page}
                      totalPages={totalPages}
                      onPageChange={onPageChange}
                      hrefFor={hrefFor}
                      isPending={isPlaceholderData}
                      lang={lang}
                      t={t}
                    />
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
