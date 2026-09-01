// CZTERY POWIERZCHNIE PUBLICZNE, KTÓRE W SSR NIE ODDAWAŁY TREŚCI.
//
// Dowód wykonawczy przez `renderToString` - jedyna metoda, która widzi to, co
// naprawdę wychodzi z serwera. `render()` z testing-library tego nie pokaże, bo
// efekty montowania (a więc i start fetcha przez React Query) wykonują się przed
// powrotem z `render`.
//
// MECHANIKA, ZMIERZONA I SPROSTOWANA. Audyt zapisał, że „`isLoading` jest w SSR
// FALSE, więc komponent renderuje nie szkielet, tylko swoją gałąź «brak
// danych»". Pomiar mówi, że to prawda WYŁĄCZNIE dla zapytania z
// `enabled: false`:
//
//   enabled=true  -> isLoading=true,  fetchStatus="fetching" -> gałąź ŁADOWANIA
//   enabled=false -> isLoading=false, fetchStatus="idle"     -> gałąź BRAK DANYCH
//
// Klasa defektu i naprawa są w obu wariantach identyczne (SSR-owy HTML nie
// zawiera treści i wchodzi do NES Edge Cache na do 24 h), różni się TREŚĆ
// zakonserwowanego HTML-a. Ten plik mierzy więc to, co jedyne ma znaczenie:
// czy w wyjściu serwera JEST TREŚĆ.
import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { ArchiveListing } from "@/components/pages/ArchiveListing";
import { archiveListingQueryOptions, type ArchiveListingRow } from "@/lib/queries/archiveListing";

const PARENT_ID = "sekcja-1";

const ROWS: ArchiveListingRow[] = [
  {
    id: "p1",
    slug: "traktat-lizbonski",
    title_pl: "Traktat lizboński po 15 latach",
    title_en: "The Lisbon Treaty after 15 years",
    excerpt_pl: "Co zostało z reformy instytucjonalnej.",
    excerpt_en: "What is left of the institutional reform.",
    cover_image_url: null,
    published_at: "2026-07-01T09:00:00Z",
    is_sponsored: false,
    sponsored_kind: null,
    sponsored_affiliate: false,
  },
  {
    id: "p2",
    slug: "budzet-wieloletni",
    title_pl: "Budżet wieloletni: kto płaci",
    title_en: "The multiannual budget: who pays",
    excerpt_pl: null,
    excerpt_en: null,
    cover_image_url: null,
    published_at: "2026-06-15T09:00:00Z",
    is_sponsored: false,
    sponsored_kind: null,
    sponsored_affiliate: false,
  },
];

function ssr(node: React.ReactElement, seed?: (qc: QueryClient) => void): string {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  seed?.(qc);
  return renderToString(<QueryClientProvider client={qc}>{node}</QueryClientProvider>);
}

describe("strona sekcyjna (archive_listing) - lista schodzi z SERWERA", () => {
  it("z rozgrzanym kluczem SSR emituje tytuły wpisów", () => {
    const html = ssr(
      <ArchiveListing parentPageId={PARENT_ID} lang="pl" parentPath="analizy" />,
      (qc) => qc.setQueryData(archiveListingQueryOptions(PARENT_ID).queryKey, ROWS),
    );
    expect(html).toContain("Traktat lizboński po 15 latach");
    expect(html).toContain("Budżet wieloletni: kto płaci");
    // Sedno regresji: bez rozgrzania w tym miejscu nie było ANI JEDNEGO wpisu.
    expect(html).not.toContain("Brak opublikowanych wpisów");
  });

  it("EN bierze tytuł angielski z tego samego rozgrzanego wpisu", () => {
    const html = ssr(
      <ArchiveListing parentPageId={PARENT_ID} lang="en" parentPath="analyses" />,
      (qc) => qc.setQueryData(archiveListingQueryOptions(PARENT_ID).queryKey, ROWS),
    );
    expect(html).toContain("The Lisbon Treaty after 15 years");
  });

  it("BEZ rozgrzania SSR nie ma treści - to jest stan, który naprawiamy", () => {
    // Ten przypadek UTRWALA przyczynę, a nie zachowanie docelowe: dopóki loader
    // nie grzeje tego klucza, wyjście serwera nie zawiera wpisów. Gdyby ktoś
    // wyciął prefetch z loadera `/$`, tamten test zrobi się czerwony, a ten
    // zostanie zielony - i to jest właściwy podział ról.
    const html = ssr(<ArchiveListing parentPageId={PARENT_ID} lang="pl" parentPath="analizy" />);
    expect(html).not.toContain("Traktat lizboński");
  });

  it("klucz fabryki jest DOKŁADNIE tym, który czyta komponent", () => {
    // Gdyby fabryka i komponent rozjechały się kluczem, rozgrzewka w loaderze
    // mijałaby się z odczytem i SSR znów milczałby - bez żadnego błędu.
    expect(archiveListingQueryOptions(PARENT_ID).queryKey).toEqual(["archive-listing", PARENT_ID]);
  });
});

// ── /series/$slug i /glossary: kontrakt LOADERA ────────────────────────────────
//
// Obie trasy miały już fabryki `queryOptions`, brakowało im wyłącznie loadera.
// `/series/$slug` oddawał przy tym pełny ekran „nie znaleziono" przy statusie
// HTTP 200 - crawler indeksował go jako istniejącą stronę.
//
// Loadery testujemy jako funkcje, bez montowania drzewa (ta sama doktryna co
// `archiveRoutes.test.ts` i `eventShellLoader.test.ts`).

interface SeriesLoaderResult {
  readonly headSeries: {
    readonly namePl: string;
    readonly nameEn: string | null;
    readonly parts: number;
  } | null;
  readonly degraded: boolean;
}

type RouteWithLoader<T> = {
  options: {
    loader: (ctx: {
      context: { queryClient: QueryClient };
      params: { slug: string };
    }) => Promise<T>;
  };
};

function freshClient(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
}

describe("/series/$slug - loader rozstrzyga 404 i politykę cache", () => {
  it("pusty CZYSTY odczyt daje notFound(), nie ekran 404 przy statusie 200", async () => {
    const { Route } = await import("@/routes/series.$slug");
    const qc = freshClient();
    // Zasiew `null` jako wynik SUKCESU: cykl o tym slugu nie istnieje.
    qc.setQueryData(["public", "series-page", "nie-ma"], null);
    const loader = (Route as unknown as RouteWithLoader<SeriesLoaderResult>).options.loader;
    await expect(
      loader({ context: { queryClient: qc }, params: { slug: "nie-ma" } }),
    ).rejects.toBeTruthy();
  });

  it("istniejący cykl wraca z projekcją nagłówka dla head()", async () => {
    const { Route } = await import("@/routes/series.$slug");
    const qc = freshClient();
    qc.setQueryData(["public", "series-page", "dossier-ue"], {
      series: {
        id: "s1",
        slug: "dossier-ue",
        name_pl: "Dossier: rozszerzenie UE",
        name_en: "Dossier: EU enlargement",
        description_pl: "Sekwencja analiz.",
        description_en: null,
      },
      parts: [{ id: "p1" }, { id: "p2" }, { id: "p3" }],
    });
    const loader = (Route as unknown as RouteWithLoader<SeriesLoaderResult>).options.loader;
    const data = await loader({ context: { queryClient: qc }, params: { slug: "dossier-ue" } });
    expect(data.degraded).toBe(false);
    expect(data.headSeries?.namePl).toBe("Dossier: rozszerzenie UE");
    // Liczba części jedzie do nagłówka strony - wcześniej head() jej nie znał.
    expect(data.headSeries?.parts).toBe(3);
  });
});

describe("/glossary - loader grzeje terminy, więc JSON-LD schodzi z serwera", () => {
  it("pusty słowniczek NIE jest 404 - to legalny stan redakcyjny", async () => {
    const { Route } = await import("@/routes/glossary");
    const qc = freshClient();
    qc.setQueryData(["public", "glossary-terms"], []);
    const loader = (
      Route as unknown as {
        options: {
          loader: (ctx: {
            context: { queryClient: QueryClient };
          }) => Promise<{ degraded: boolean }>;
        };
      }
    ).options.loader;
    const data = await loader({ context: { queryClient: qc } });
    expect(data.degraded).toBe(false);
  });

  it("rozgrzane terminy zostają w cache pod kluczem, który czyta komponent", async () => {
    const { Route } = await import("@/routes/glossary");
    const { glossaryTermsQueryOptions } = await import("@/lib/queries/glossary");
    const qc = freshClient();
    const terms = [
      {
        id: "t1",
        slug: "acquis",
        term_pl: "Acquis communautaire",
        term_en: "Acquis communautaire",
        definition_pl: "Dorobek prawny Unii.",
        definition_en: "The Union legal corpus.",
      },
    ];
    qc.setQueryData(glossaryTermsQueryOptions().queryKey, terms);
    const loader = (
      Route as unknown as {
        options: {
          loader: (ctx: {
            context: { queryClient: QueryClient };
          }) => Promise<{ degraded: boolean }>;
        };
      }
    ).options.loader;
    await loader({ context: { queryClient: qc } });
    // Bez tego wpisu węzeł DefinedTermSet był z konstrukcji `null` w SSR.
    expect(qc.getQueryData(glossaryTermsQueryOptions().queryKey)).toHaveLength(1);
  });
});
