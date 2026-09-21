// Public HTML site map (/sitemap, /en/sitemap) - the human- and AI-readable
// counterpart of sitemap.xml: every published page (hierarchy preserved),
// category and the latest posts on one flat-crawlable page. Good for visitors
// (orientation), for crawl depth (every URL reachable within two clicks) and
// for answer engines mapping the site's structure (GEO).
import { createFileRoute, Link } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import {
  blogListQueryOptions,
  publicCategoriesQueryOptions,
  publicPagesTreeQueryOptions,
  type BlogListItem,
} from "@/lib/queries/public";
import { buildPageTree, type PageTreeNode, type PageTreeRow } from "@/lib/seo/pageTree";
import { buildContentHead } from "@/lib/seo/meta";
import { getRequestUrl } from "@/lib/seo/request";
import { activeLang } from "@/lib/seo/head";
import { setCacheControlHeader } from "@/lib/http/responseHeaders";
import { anyDegraded, loadResilient, resilientCacheControl } from "@/lib/ssr/resilientLoad";
import { DegradedDataNotice } from "@/components/molecules/DegradedDataNotice";

/** Wspólny termin trzech zapytań mapy - biegną równolegle, więc jeden budżet. */
const SITEMAP_SSR_BUDGET_MS = 2_000;

// FALLBACKI ZASIEWANE PRZY DEGRADACJI - puste struktury DOKŁADNIE w typach
// trzech zapytań mapy. `loadResilient` wpisuje je ze stemplem `updatedAt: 0`,
// więc `useSuspenseQuery` w komponencie widzi stan `success` i renderuje bez
// zawieszenia, a przeglądarka i tak refetchuje je zaraz po hydratacji.
const NO_PAGES: PageTreeRow[] = [];
const NO_CATEGORIES: Array<{ slug: string; name_pl: string; name_en: string }> = [];
const NO_POSTS: { posts: BlogListItem[] } = { posts: [] };

export const COPY = {
  pl: {
    title: "Mapa strony",
    description: "Pełna mapa serwisu: wszystkie strony, kategorie i najnowsze artykuły.",
    pages: "Strony",
    categories: "Kategorie",
    posts: "Najnowsze artykuły",
    home: "Strona główna",
    blog: "Blog",
    community: "Społeczność",
    degraded: "Nie udało się załadować pełnej mapy strony",
  },
  en: {
    title: "Site map",
    description: "The full site map: every page, category and the latest articles.",
    pages: "Pages",
    categories: "Categories",
    posts: "Latest articles",
    home: "Home",
    blog: "Blog",
    community: "Community",
    degraded: "Couldn't load the full site map",
  },
} as const;

// Publiczne powierzchnie modułu społeczności - statyczne trasy z własnym SEO.
const COMMUNITY_LINKS = [
  { href: "/events", pl: "Wydarzenia", en: "Events" },
  { href: "/qa", pl: "Sesje Q&A", en: "Q&A sessions" },
  { href: "/polls", pl: "Ankiety", en: "Polls" },
  { href: "/tracker", pl: "Tracker legislacyjny UE", en: "EU policy tracker" },
  { href: "/experts", pl: "Eksperci", en: "Experts" },
  { href: "/people", pl: "Katalog osób", en: "People directory" },
  { href: "/contribute", pl: "Zostań kontrybutorem", en: "Become a contributor" },
  { href: "/podcasts", pl: "Podcasty", en: "Podcasts" },
  { href: "/live", pl: "Relacje na żywo", en: "Live blogs" },
] as const;

export const Route = createFileRoute("/sitemap")({
  loader: async ({ context }) => {
    // KOLEJNOŚĆ JEST CAŁĄ NAPRAWĄ. Do 2026-09-12 `setCacheControlHeader(
    // contentCacheControl())` było PIERWSZĄ instrukcją tego loadera, a trzy
    // zapytania budujące CAŁĄ treść mapy leciały po nim w `Promise.allSettled`
    // bez sprawdzenia wyniku. Odrzucenie któregokolwiek dawało mapę bez stron,
    // bez kategorii albo bez wpisów - przy statusie 200 i z nagłówkiem
    // pozwalającym brzegowi trzymać ten kadłubek przez 15 minut świeżości plus
    // dobę okna stale. Mapa strony jest powierzchnią, z której crawler czerpie
    // strukturę serwisu, więc jej okrojona wersja w cache'u kosztuje indeks.
    //
    // CZEGO NIE ZAŁATWIŁ SAM BUDŻET (regresja 2026-09-20, naprawiona tutaj).
    // Wariant pośredni owijał `Promise.allSettled` w `settleWithinBudget`, więc
    // po terminie LOADER oddał sterowanie - ale NIE anulował spóźnionych fetchów
    // i NIE zasiewał żadnych danych. Komponent czyta te same trzy klucze przez
    // `useSuspenseQuery`, więc render i tak zawieszał się na tych samych, wciąż
    // biegnących zapytaniach: budżet skracał wyłącznie czas do NAGŁÓWKA, a nie
    // do pierwszego bajtu. Zmierzone na serwerze deweloperskim z poświadczeniami
    // zastępczymi (każde zapytanie pada): `curl /sitemap` powyżej 90 s i dokument
    // BEZ `<h1>`, bo render nie ruszył nawet z samą powłoką.
    //
    // CO JEST TERAZ: trzy równoległe `loadResilient` pod JEDNYM terminem. Prymityw
    // anuluje spóźniony fetch PRZED zasiewem fallbacku (inaczej rozstrzygnięcie
    // między renderem a dehydracją rozjechałoby hydratację), więc komponent
    // renderuje się natychmiast - mapą okrojoną, ale z pełną nawigacją statyczną
    // i nagłówkiem `<h1>` - a klient dociąga dane po hydratacji (`updatedAt: 0`).
    // Render zdegradowany wychodzi z `no-store`, więc nie utrwala się na brzegu.
    const queryClient = context.queryClient;
    // Termin liczony BEZWARUNKOWO: `loadResilient` honoruje go wyłącznie
    // w renderze serwerowym, a w przeglądarce czeka na zapytanie (patrz nagłówek
    // `lib/ssr/resilientLoad.ts`), więc bramkowanie pod `isServer` byłoby tu
    // martwym kodem. Trzy zapytania dzielą JEDEN termin, bo biegną równolegle -
    // sekwencyjne `await` sumowałoby budżety i samo stałoby się źródłem TTFB.
    const deadlineAt = Date.now() + SITEMAP_SSR_BUDGET_MS;
    const [pages, categories, posts] = await Promise.all([
      loadResilient(queryClient, publicPagesTreeQueryOptions(), NO_PAGES, {
        deadlineAt,
        label: "sitemap.pages",
      }),
      loadResilient(queryClient, publicCategoriesQueryOptions(), NO_CATEGORIES, {
        deadlineAt,
        label: "sitemap.categories",
      }),
      loadResilient(queryClient, blogListQueryOptions(), NO_POSTS, {
        deadlineAt,
        label: "sitemap.posts",
      }),
    ]);
    const degraded = anyDegraded(pages, categories, posts);
    setCacheControlHeader(resilientCacheControl(degraded));
    // FLAGI JADĄ DO KOMPONENTU tym samym kontraktem co `/experts` i `/glossary`:
    // pusta mapa z awarii ma dać się odróżnić od pustej mapy z redakcji. Bez
    // tego zasiany fallback wyglądał dokładnie jak prawda - sekcja wpisów pusta,
    // a kategorie z myślnikiem „brak" - czyli transport był naprawiony, a warstwa
    // treści kłamała (recenzja Codeksa, P2).
    //
    // PER SEKCJĄ, nie jedną flagą na całą trasę: zapytania są niezależne, więc
    // blip kategorii nie ma prawa ukryć stron ani wpisów, które backend oddał
    // w komplecie. `degraded` zostaje jako zbiorczy sygnał dla komunikatu.
    return {
      degraded,
      degradedSections: {
        pages: pages.degraded,
        categories: categories.degraded,
        posts: posts.degraded,
      },
    };
  },
  head: () => {
    const url = getRequestUrl() || "/sitemap";
    const lang = activeLang(url);
    const copy = COPY[lang];
    return buildContentHead({
      url,
      lang,
      type: "website",
      title: `${copy.title} - New European Strategies`,
      description: copy.description,
    });
  },
  component: SiteMapPage,
});

function PageTreeList({ nodes, lang }: { nodes: PageTreeNode[]; lang: "pl" | "en" }) {
  if (!nodes.length) return null;
  return (
    <ul className="space-y-1.5 pl-4 border-l border-border">
      {nodes.map((node) => (
        <li key={node.id}>
          {/* The universal splat route serves arbitrary page paths; the router
              output rewrite localizes the href ("/en/..." for EN) for free. */}
          <Link
            to="/$"
            params={{ _splat: node.path.replace(/^\//, "") }}
            className="text-sm hover:text-brand hover:underline"
          >
            {(lang === "en" ? node.title_en || node.title_pl : node.title_pl || node.title_en) ||
              node.slug}
          </Link>
          {node.children.length > 0 && (
            <div className="mt-1.5">
              <PageTreeList nodes={node.children} lang={lang} />
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}

function SiteMapPage() {
  const { i18n } = useTranslation();
  const lang: "pl" | "en" = i18n.language === "en" ? "en" : "pl";
  const copy = COPY[lang];
  const { degraded, degradedSections } = Route.useLoaderData();
  const { data: pageRows } = useSuspenseQuery(publicPagesTreeQueryOptions());
  const { data: categories } = useSuspenseQuery(publicCategoriesQueryOptions());
  const { data: blog } = useSuspenseQuery(blogListQueryOptions());

  // The "home" root page is served at "/" - the explicit home link above the
  // tree covers it, so drop the duplicate node.
  const tree = buildPageTree(pageRows.filter((r) => !(r.parent_id === null && r.slug === "home")));

  return (
    <div className="flex flex-col bg-background text-foreground" data-page-template="sitemap">
      <div className="flex-1 max-w-[1200px] w-full mx-auto px-4 lg:px-8 py-10">
        <h1 className="font-display text-4xl lg:text-5xl mb-2">{copy.title}</h1>
        <p className="text-sm text-muted-foreground mb-8">{copy.description}</p>

        {degraded && (
          // Wariant INLINE, nie `page`: `<h1>`, opis i nawigacja statyczna są
          // prawdziwe niezależnie od backendu, więc podmiana całej strony
          // zabrałaby czytelnikowi (i crawlerowi) treść, która dojechała.
          <div className="mb-8">
            <DegradedDataNotice title={copy.degraded} />
          </div>
        )}

        <div className="grid gap-10 md:grid-cols-2 lg:grid-cols-3">
          {/* Sekcja STRON zostaje zawsze, także przy degradacji: „Strona główna"
              i „Blog" to trasy statyczne, prawdziwe niezależnie od backendu,
              a `PageTreeList` przy pustym drzewie nie renderuje NIC - żadna pustka
              nie udaje tu więc danych. Ukrycie tej sekcji zabrałoby crawlerowi dwa
              linki, które właśnie po to tu stoją. */}
          <section aria-labelledby="sitemap-pages">
            <h2 id="sitemap-pages" className="font-display text-xl font-semibold mb-3">
              {copy.pages}
            </h2>
            <ul className="space-y-1.5 mb-1.5">
              <li>
                <Link to="/" className="text-sm hover:text-brand hover:underline">
                  {copy.home}
                </Link>
              </li>
              <li>
                <Link to="/blog" className="text-sm hover:text-brand hover:underline">
                  {copy.blog}
                </Link>
              </li>
            </ul>
            <PageTreeList nodes={tree} lang={lang} />
          </section>

          <section aria-labelledby="sitemap-community">
            <h2 id="sitemap-community" className="font-display text-xl font-semibold mb-3">
              {copy.community}
            </h2>
            <ul className="space-y-1.5">
              {COMMUNITY_LINKS.map((link) => (
                <li key={link.href}>
                  <Link to={link.href} className="text-sm hover:text-brand hover:underline">
                    {lang === "en" ? link.en : link.pl}
                  </Link>
                </li>
              ))}
            </ul>
          </section>

          {/* Zdegradowany odczyt zawsze niesie PUSTY fallback, więc sekcja
              pokazałaby „brak kategorii" jako fakt. Chowamy ją - komunikat wyżej
              mówi, czego zabrakło, a klient dociąga listę po hydratacji. */}
          {!degradedSections.categories && (
            <section aria-labelledby="sitemap-categories">
              <h2 id="sitemap-categories" className="font-display text-xl font-semibold mb-3">
                {copy.categories}
              </h2>
              <ul className="space-y-1.5">
                {categories.map((c) => (
                  <li key={c.slug}>
                    <Link
                      to="/category/$slug"
                      params={{ slug: c.slug }}
                      className="text-sm hover:text-brand hover:underline"
                    >
                      {(lang === "en" ? c.name_en || c.name_pl : c.name_pl || c.name_en) || c.slug}
                    </Link>
                  </li>
                ))}
                {!categories.length && <li className="text-sm text-muted-foreground">-</li>}
              </ul>
            </section>
          )}

          {/* Jak wyżej: pusta lista wpisów z awarii jest nie do odróżnienia od
              serwisu bez ani jednego artykułu. */}
          {!degradedSections.posts && (
            <section aria-labelledby="sitemap-posts" className="md:col-span-2 lg:col-span-1">
              <h2 id="sitemap-posts" className="font-display text-xl font-semibold mb-3">
                {copy.posts}
              </h2>
              <ul className="space-y-1.5">
                {blog.posts.map((post) => (
                  <li key={post.id} className="flex items-baseline gap-2">
                    <Link
                      to="/post/$slug"
                      params={{ slug: post.slug }}
                      className="text-sm hover:text-brand hover:underline min-w-0"
                    >
                      {(lang === "en"
                        ? post.title_en || post.title_pl
                        : post.title_pl || post.title_en) || post.slug}
                    </Link>
                    {post.published_at && (
                      <span className="text-[11px] text-muted-foreground shrink-0 tabular-nums">
                        {post.published_at.slice(0, 10)}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
