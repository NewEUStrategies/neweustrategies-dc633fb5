// Trasy archiwum ZAMONTOWANE: loader + komponent + spięcie z routerem.
//
// Kontrakty adresu i nagłówka mają osobny plik (`archiveRoutes.test.tsx`).
// Tutaj sprawdzamy warstwę, której czysta funkcja nie dosięga: czy trasa
// faktycznie DOWOZI TREŚĆ - że loader dogrzewa cache pod tym samym kluczem,
// z którego czyta komponent (rozjazd = drugi fetch przy hydracji), że
// zdegradowany loader daje pustą powłokę zamiast wyjątku, i że brak taksonomii
// kończy się stroną 404, a nie pustym archiwum z zerem wyników.
//
// Harness montuje PRAWDZIWĄ trasę pliku w routerze pamięciowym - ten sam krok,
// który w produkcji robi generator drzewa (patrz src/test/routeHarness.tsx).
import { freezeClock } from "@/test/time";
import { describe, expect, it, afterEach, beforeEach, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import i18n from "@/lib/i18n";
import "@/lib/i18n-archive-layout";
import type { BlogListItem } from "@/lib/queries/public";
import { CARD_IMAGE_SIZES, FEATURED_CARD_IMAGE_SIZES } from "@/lib/cardImageSizes";
import { SEARCH_PAGE_SIZE } from "@/lib/queries/archives";
import { DEFAULT_ARCHIVE_LAYOUT } from "@/lib/archive-layout-settings";

freezeClock();

const data = vi.hoisted(() => ({
  blog: null as { posts: unknown[]; total: number; page: number; pageSize: number } | null,
  /**
   * Blip, który MIJA: pierwszy odczyt archiwum pada, kolejny już nie. Modeluje
   * układ z produkcji - loader zasiewa pustkę ze stemplem `updatedAt: 0`,
   * a refetch po hydratacji dostaje prawdziwe wpisy.
   */
  blogFailOnce: false,
  settings: {} as Record<string, unknown>,
  taxonomy: null as Record<string, unknown> | null,
  layout: null as Record<string, unknown> | null,
  search: { posts: [] as unknown[], facets: [] as unknown[], total: 0 },
  searchError: false,
  settingsError: false,
  pageSizeError: false,
  taxonomyError: false,
  taxonomyFailOnce: false,
  // Zapytania biblioteki publikacji: filtry i STRONA, o które trasa zawołała
  // silnik wyszukiwania. Paginacja linkowa ma pytać o jedną stronę naraz
  // (tryb `page`), a nie o rosnące okno.
  searches: [] as Array<{ filters: Record<string, unknown>; page: number | undefined }>,
}));

vi.mock("@/lib/queries/public", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/queries/public")>()),
  blogArchiveQueryOptions: (params: { page: number; pageSize: number }) => ({
    queryKey: ["blog-archive", params.page, params.pageSize],
    queryFn: () => {
      if (data.blogFailOnce) {
        data.blogFailOnce = false;
        return Promise.reject(new Error("blip backendu, ktory mija"));
      }
      return data.blog === null
        ? Promise.reject(new Error("blip backendu"))
        : Promise.resolve(data.blog);
    },
  }),
  resolvePostsPerPage: () => {
    if (data.pageSizeError) throw new Error("ustawienia czytania w rozsypce");
    return 2;
  },
}));

vi.mock("@/lib/useSiteSetting", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/useSiteSetting")>()),
  siteSettingsQueryOptions: {
    queryKey: ["site-settings"],
    queryFn: () =>
      data.settingsError
        ? Promise.reject(new Error("ustawienia serwisu padły"))
        : Promise.resolve(data.settings),
  },
}));

vi.mock("@/lib/queries/archives", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/queries/archives")>();
  return {
    ...real,
    taxonomyArchiveQueryOptions: (kind: string, slug: string, opts: unknown) => ({
      queryKey: ["taxonomy-archive", kind, slug, opts],
      queryFn: () => {
        if (data.taxonomyFailOnce) {
          data.taxonomyFailOnce = false;
          return Promise.reject(new Error("temporary archive outage"));
        }
        return data.taxonomyError
          ? Promise.reject(new Error("baza taksonomii padła"))
          : Promise.resolve(data.taxonomy);
      },
    }),
    // Atrapa silnika stronicuje JAK baza: strona N to wycinek o rozmiarze
    // SEARCH_PAGE_SIZE od (N-1)*SEARCH_PAGE_SIZE, a `total` to liczność całego
    // zbioru - także dla strony za końcem (w prawdziwym module dowozi ją sonda).
    searchQueryOptions: (
      filters: Record<string, unknown>,
      _limit: number | undefined,
      opts?: { page?: number },
    ) => ({
      queryKey: ["publications-search", filters, opts?.page, data.searchError],
      queryFn: () => {
        data.searches.push({ filters, page: opts?.page });
        if (data.searchError) return Promise.reject(new Error("silnik padł"));
        const start = ((opts?.page ?? 1) - 1) * real.SEARCH_PAGE_SIZE;
        return Promise.resolve({
          ...data.search,
          posts: data.search.posts.slice(start, start + real.SEARCH_PAGE_SIZE),
        });
      },
    }),
  };
});

vi.mock("@/lib/archive-layout-settings", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/archive-layout-settings")>()),
  archiveLayoutQueryOptions: (kind: string) => ({
    queryKey: ["archive-layout-settings", kind],
    queryFn: () => Promise.resolve(data.layout),
  }),
}));

vi.mock("@/lib/queries/podcasts", () => ({
  podcastsByCategoryQueryOptions: (id: string) => ({
    queryKey: ["podcasts", id],
    queryFn: () => Promise.resolve([]),
  }),
}));

vi.mock("@/components/ads/useInFeedAds", () => ({ useInFeedAds: () => () => null }));
vi.mock("@/components/ads/FooterSlideup", () => ({ FooterSlideup: () => null }));
vi.mock("@/components/AdSlot", () => ({ AdZone: () => null, AdSlotView: () => null }));
vi.mock("@/components/NewsletterForm", () => ({ NewsletterForm: () => null }));
vi.mock("@/components/FollowButton", () => ({ FollowButton: () => null }));
vi.mock("@/components/builder/organisms/BuilderRenderer", () => ({
  BuilderRenderer: () => <div data-testid="featured-section" />,
}));
vi.mock("@/components/search/SearchFacetPanel", () => ({
  SearchFacetPanel: () => <div data-testid="facets" />,
}));
vi.mock("@/components/search/ActiveFilterChips", () => ({
  ActiveFilterChips: () => <div data-testid="chips" />,
}));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => {
      const builder = {
        select: () => builder,
        neq: () => builder,
        limit: () => Promise.resolve({ data: [], error: null }),
      };
      return builder;
    },
  },
}));

const { renderRoute } = await import("@/test/routeHarness");
const { Route: BlogRoute } = await import("@/routes/blog.index");
const { Route: CategoryRoute } = await import("@/routes/category.$slug");
const { Route: TagRoute } = await import("@/routes/tag.$slug");
const { Route: PublicationsRoute } = await import("@/routes/publications");

function post(id: string): BlogListItem {
  return {
    id,
    slug: id,
    title_pl: `Wpis ${id}`,
    title_en: `Post ${id}`,
    excerpt_pl: null,
    excerpt_en: null,
    cover_image_url: null,
    published_at: "2026-08-01T10:00:00Z",
    parent_page_id: "page-1",
    href: `/wpis/${id}`,
    is_sponsored: false,
    sponsored_kind: null,
    sponsored_affiliate: null,
  };
}

const posts = (n: number) => Array.from({ length: n }, (_, i) => post(`p${i + 1}`));

// Adres w kształcie storage Supabase - tylko dla takiego `buildImageSrcSet`
// generuje warianty, a bez wariantów `sizes` w preloadzie nie ma znaczenia.
const COVER = "https://przyklad.supabase.co/storage/v1/object/public/media/okladka.jpg";
const coverPost = (id: string): BlogListItem => ({ ...post(id), cover_image_url: COVER });

/** Deskryptor preloadu obrazu z `head()` trasy (albo undefined, gdy go nie ma). */
const imagePreload = (links: Record<string, unknown>[]) =>
  links.find((l) => l.rel === "preload" && l.as === "image");

async function mount(route: unknown, path: string, entry: string) {
  let view!: Awaited<ReturnType<typeof renderRoute>>;
  await act(async () => {
    view = await renderRoute({
      route: route as Parameters<typeof renderRoute>[0]["route"],
      path,
      initialEntry: entry,
    });
  });
  return view;
}

// Dane trasy przychodzą z loadera (czekał na nie `router.load()`), ale dane
// BIBLIOTEKI PUBLIKACJI z `useQuery` w ciele komponentu startują dopiero po
// montażu. `isFetching() === 0` tuż po renderze nie znaczy „już jest" - znaczy
// „jeszcze się nie zaczęło". Dlatego asercje zależne od tego zapytania czekają
// przez `findBy*`, a nie przez zgadywanie momentu.

beforeEach(() => {
  data.blog = { posts: posts(2), total: 2, page: 1, pageSize: 2 };
  data.blogFailOnce = false;
  data.taxonomyFailOnce = false;
  data.settings = {};
  data.layout = { ...DEFAULT_ARCHIVE_LAYOUT, id: "s1", archive_type: "category" };
  data.taxonomy = {
    taxonomy: {
      id: "tax-1",
      slug: "gospodarka",
      name_pl: "Gospodarka",
      name_en: "Economy",
      description_pl: null,
      description_en: null,
      featured_section: null,
    },
    posts: posts(2),
    total: 2,
    page: 1,
    pageSize: 60,
    sort: "newest",
  };
  data.search = { posts: [], facets: [], total: 0 };
  data.searchError = false;
  data.settingsError = false;
  data.pageSizeError = false;
  data.taxonomyError = false;
  data.searches = [];
});

afterEach(async () => {
  cleanup();
  // Język jest globalny dla całego procesu testowego - test, który go zmienia,
  // musi go oddać, inaczej psuje sąsiadów w tym samym pliku.
  if (i18n.language !== "pl") await act(async () => void (await i18n.changeLanguage("pl")));
});

describe("/blog", () => {
  it("dowozi wpisy z loadera do siatki - jeden klucz zapytania, zero drugiego fetcha", async () => {
    await mount(BlogRoute, "/blog", "/blog");
    expect(screen.getByRole("heading", { level: 1, name: "Blog" })).toBeTruthy();
    expect(screen.getByRole("link", { name: /Wpis p1/ })).toBeTruthy();
    expect(screen.getByRole("link", { name: /Wpis p2/ })).toBeTruthy();
  });

  it("druga strona wyników ma indeksowalne linki stron", async () => {
    data.blog = { posts: posts(2), total: 6, page: 2, pageSize: 2 };
    await mount(BlogRoute, "/blog", "/blog?page=2");
    const pagination = screen.getByRole("navigation", { name: "Paginacja" });
    // Linkowa paginacja: crawler podąża za <a href>, przyciski onClick są dla
    // niego niewidzialne.
    expect(within(pagination).getByRole("link", { name: "Strona 1" })).toHaveAttribute(
      "href",
      "/blog",
    );
    expect(within(pagination).getByRole("link", { name: "Strona 3" })).toHaveAttribute(
      "href",
      "/blog?page=3",
    );
  });

  it("kliknięcie strony ZMIENIA ADRES, a nie tylko widok", async () => {
    data.blog = { posts: posts(2), total: 6, page: 1, pageSize: 2 };
    const view = await mount(BlogRoute, "/blog", "/blog");
    await act(async () => {
      fireEvent.click(screen.getByRole("link", { name: "Strona 2" }), { button: 0 });
    });
    expect(view.search()).toMatchObject({ page: 2 });
  });

  it("ZDEGRADOWANY loader daje pustą powłokę zamiast wyjątku", async () => {
    // Blip backendu albo przekroczony budżet: strona ma się wyrenderować
    // i samoleczyć na kliencie, a nie pokazać błąd trasy.
    data.blog = null;
    await mount(BlogRoute, "/blog", "/blog");
    expect(screen.getByRole("heading", { level: 1, name: "Blog" })).toBeTruthy();
    expect(screen.queryByRole("link", { name: /Wpis/ })).toBeNull();
  });

  // DEGRADACJA MÓWI PRAWDĘ, ALE LECZY SIĘ SAMA (`lib/ssr/useDegradedUntilHealed`).
  // Zasiana pustka wyglądała dokładnie jak archiwum bez wpisów („Brak wpisów"),
  // a ładunek loadera jest niezmienny przez życie dopasowania trasy - komunikat
  // wisiałby więc nad siatką, którą `useSuspenseQuery` dociągnął sekundę
  // później. Pełny dowód mechanizmu (parytet hydratacji, kontrola negatywna)
  // stoi w `src/lib/ssr/__tests__/useDegradedUntilHealed.test.tsx`.
  it("zdegradowane archiwum mówi PRAWDĘ, a nie „brak wpisów” - z ponowieniem", async () => {
    data.blog = null;
    await mount(BlogRoute, "/blog", "/blog");

    expect(screen.getByText("Ta sekcja chwilowo nie ma danych")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Spróbuj ponownie" })).toBeTruthy();
    expect(screen.queryByText(/Brak wpisów/i)).toBeNull();
  });

  it("SSR zdegradowany + UDANY refetch: komunikat znika, wpisy się renderują", async () => {
    data.blogFailOnce = true;
    await mount(BlogRoute, "/blog", "/blog");

    expect(await screen.findByRole("link", { name: /Wpis p1/ })).toBeTruthy();
    expect(screen.queryByText("Ta sekcja chwilowo nie ma danych")).toBeNull();
  });

  it("ponowienie pyta backend JESZCZE RAZ i leczy siatkę bez nawigacji", async () => {
    data.blog = null;
    await mount(BlogRoute, "/blog", "/blog");
    const button = screen.getByRole("button", { name: "Spróbuj ponownie" });

    data.blog = { posts: posts(2), total: 2, page: 1, pageSize: 2 };
    await act(async () => {
      fireEvent.click(button);
    });

    expect(await screen.findByRole("link", { name: /Wpis p1/ })).toBeTruthy();
    expect(screen.queryByText("Ta sekcja chwilowo nie ma danych")).toBeNull();
  });

  it("pusta lista pokazuje komunikat, nie pusty ekran", async () => {
    data.blog = { posts: [], total: 0, page: 1, pageSize: 2 };
    await mount(BlogRoute, "/blog", "/blog");
    expect(screen.getByText(/Brak|No posts/i)).toBeTruthy();
  });

  it("okładka pierwszej karty ląduje w preloadzie LCP nagłówka", async () => {
    // Preload i render MUSZĄ brać ten sam wariant obrazu - inaczej przeglądarka
    // pobiera plik dwa razy i LCP jest gorsze niż bez preloadu.
    data.blog = { posts: [coverPost("p1"), post("p2")], total: 2, page: 1, pageSize: 2 };
    const view = await mount(BlogRoute, "/blog", "/blog");
    expect(imagePreload(view.links())).toMatchObject({
      href: COVER,
      fetchPriority: "high",
      // Siatka bloga nie rysuje karty wyróżnionej, więc obowiązują `sizes` karty zwykłej.
      imageSizes: CARD_IMAGE_SIZES,
    });
  });

  it("wpis bez okładki nie dokłada pustego preloadu", async () => {
    const view = await mount(BlogRoute, "/blog", "/blog");
    expect(imagePreload(view.links())).toBeUndefined();
  });

  it("awaria ustawień czytania nie zabiera czytelnikowi listy wpisów", async () => {
    // Ustawienia są miękką zależnością: przy ich braku trasa zasiewa pusty
    // obiekt (od razu przeterminowany) i leci dalej z domyślnym rozmiarem strony.
    data.settingsError = true;
    const view = await mount(BlogRoute, "/blog", "/blog");
    expect(screen.getByRole("link", { name: /Wpis p1/ })).toBeTruthy();
    expect(view.queryClient.getQueryData(["site-settings"])).toEqual({});
  });

  it("wyjątek w loaderze kończy się stroną błędu z drogą powrotną", async () => {
    // Loader bloga tłumi awarie DANYCH (pusta powłoka), ale nie tłumi awarii
    // WŁASNEGO kodu - a te też nie mogą kończyć się białym ekranem.
    data.pageSizeError = true;
    await mount(BlogRoute, "/blog", "/blog");
    expect(screen.queryByRole("link", { name: /Wpis p1/ })).toBeNull();
    expect(screen.getAllByText(/Nie udało się załadować listy/i).length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: /Wróć/i })).toBeTruthy();
  });
});

describe("/category/$slug i /tag/$slug", () => {
  it("archiwum kategorii dowozi nazwę taksonomii i wpisy", async () => {
    await mount(CategoryRoute, "/category/$slug", "/category/gospodarka");
    expect(screen.getByRole("heading", { name: "Gospodarka" })).toBeTruthy();
    expect(screen.getByRole("link", { name: /Wpis p1/ })).toBeTruthy();
  });

  it("wariant layoutu pochodzi z ustawień archiwum", async () => {
    data.layout = {
      ...DEFAULT_ARCHIVE_LAYOUT,
      id: "s1",
      archive_type: "category",
      show_sidebar: true,
    };
    const view = await mount(CategoryRoute, "/category/$slug", "/category/gospodarka");
    expect(view.container.querySelector("aside")).not.toBeNull();
  });

  it("brak taksonomii kończy się stroną 404, a nie pustym archiwum", async () => {
    // Pusty layout z zerem wyników mówiłby czytelnikowi „kategoria istnieje,
    // ale nic w niej nie ma” - a ona nie istnieje.
    data.taxonomy = null;
    await mount(CategoryRoute, "/category/$slug", "/category/nie-ma");
    expect(screen.queryByRole("heading", { name: "Gospodarka" })).toBeNull();
    expect(screen.getAllByText(/404|nie znaleziono|not found/i).length).toBeGreaterThan(0);
  });

  it("sekcja wyróżniona taksonomii renderuje się nad archiwum", async () => {
    data.taxonomy = {
      ...(data.taxonomy as Record<string, unknown>),
      taxonomy: {
        ...((data.taxonomy as { taxonomy: Record<string, unknown> }).taxonomy ?? {}),
        featured_section: { type: "section", id: "s1" },
      },
    };
    await mount(CategoryRoute, "/category/$slug", "/category/gospodarka");
    expect(screen.getByTestId("featured-section")).toBeTruthy();
  });

  it("archiwum tagu montuje się tą samą drogą i pokazuje krzyżyk przed nazwą", async () => {
    data.layout = { ...DEFAULT_ARCHIVE_LAYOUT, id: "s1", archive_type: "tag" };
    data.taxonomy = {
      ...(data.taxonomy as Record<string, unknown>),
      taxonomy: {
        id: "tax-2",
        slug: "nato",
        name_pl: "nato",
        name_en: "nato",
        description_pl: null,
        description_en: null,
        featured_section: null,
      },
    };
    await mount(TagRoute, "/tag/$slug", "/tag/nato");
    expect(screen.getByRole("heading", { name: "#nato" })).toBeTruthy();
  });

  it("adres z numerem strony przechodzi przez walidację do loadera", async () => {
    const view = await mount(CategoryRoute, "/category/$slug", "/category/gospodarka?page=2");
    expect(view.search()).toMatchObject({ page: 2 });
  });

  it.each([
    ["category", CategoryRoute, "/category/$slug", "/category/gospodarka"],
    ["tag", TagRoute, "/tag/$slug", "/tag/gospodarka"],
  ] as const)(
    "recovers %s after a loader failure without a reload",
    async (_name, route, path, url) => {
      data.taxonomyFailOnce = true;
      await mount(route, path, url);
      expect(await screen.findByRole("link", { name: /Wpis p1/ })).toBeTruthy();
      expect(screen.queryByText("Ta sekcja chwilowo nie ma danych")).toBeNull();
    },
  );

  it("preload okładki bierze `sizes` karty WYRÓŻNIONEJ, gdy archiwum ją rysuje", async () => {
    // `show_featured_top` zmienia szerokość pierwszej karty, więc zmienia też
    // wariant obrazu, który przeglądarka wybierze z srcSet. Preload musi
    // wskazać ten sam - inaczej pobranie z preloadu idzie do kosza.
    data.layout = {
      ...DEFAULT_ARCHIVE_LAYOUT,
      id: "s1",
      archive_type: "category",
      show_featured_top: true,
    };
    data.taxonomy = { ...(data.taxonomy as Record<string, unknown>), posts: [coverPost("p1")] };
    const view = await mount(CategoryRoute, "/category/$slug", "/category/gospodarka");
    expect(imagePreload(view.links())).toMatchObject({
      href: COVER,
      imageSizes: FEATURED_CARD_IMAGE_SIZES,
    });
  });

  it("bez karty wyróżnionej preload wraca do `sizes` karty siatki", async () => {
    data.layout = {
      ...DEFAULT_ARCHIVE_LAYOUT,
      id: "s1",
      archive_type: "tag",
      show_featured_top: false,
    };
    data.taxonomy = { ...(data.taxonomy as Record<string, unknown>), posts: [coverPost("p1")] };
    const view = await mount(TagRoute, "/tag/$slug", "/tag/nato");
    expect(imagePreload(view.links())).toMatchObject({ imageSizes: CARD_IMAGE_SIZES });
  });

  it("awaria bazy daje render ZDEGRADOWANY (200), a nie wyjątek ani 404", async () => {
    // Trzy różne prawdy, trzy różne odpowiedzi: brak taksonomii -> 404,
    // awaria kodu trasy -> strona błędu, blip ODCZYTU -> render zdegradowany.
    // Do 2026-09-20 ostatni przypadek wychodził stąd jako HTTP 500 (gołe
    // `ensureQueryData` bez budżetu), więc blip bazy wyglądał dla crawlera
    // i dla monitora na awarię serwisu.
    data.taxonomyError = true;
    await mount(CategoryRoute, "/category/$slug", "/category/gospodarka");
    expect(screen.queryByRole("heading", { name: "Gospodarka" })).toBeNull();
    // Komunikat degradacji, a NIE „404 / nie znaleziono" - kategoria istnieje.
    expect(screen.getAllByText(/chwilowo nie ma danych/i).length).toBeGreaterThan(0);
    expect(screen.queryByText(/404|nie znaleziono/i)).toBeNull();
    // Ślepy zaułek to najgorsza wersja błędu - musi być droga powrotna.
    expect(screen.getByRole("button", { name: /Spróbuj ponownie/i })).toBeTruthy();
  });

  it("brak taksonomii TAGU też kończy się stroną 404", async () => {
    data.taxonomy = null;
    await mount(TagRoute, "/tag/$slug", "/tag/nie-ma");
    expect(screen.getAllByText(/404|nie znaleziono|not found/i).length).toBeGreaterThan(0);
  });

  it("awaria bazy na trasie tagu również degraduje do 200, nie do 404", async () => {
    data.taxonomyError = true;
    await mount(TagRoute, "/tag/$slug", "/tag/nato");
    expect(screen.getAllByText(/chwilowo nie ma danych/i).length).toBeGreaterThan(0);
    expect(screen.queryByText(/404|nie znaleziono/i)).toBeNull();
  });
});

describe("/publications", () => {
  it("pusty wynik pokazuje komunikat i panel filtrów", async () => {
    await mount(PublicationsRoute, "/publications", "/publications");
    expect(screen.getByRole("heading", { level: 1 })).toBeTruthy();
    expect(screen.getByTestId("facets")).toBeTruthy();
    expect(screen.getByTestId("chips")).toBeTruthy();
  });

  it("wyniki renderują się jako karty publikacji", async () => {
    data.search = { posts: posts(3), facets: [], total: 3 };
    await mount(PublicationsRoute, "/publications", "/publications");
    expect(await screen.findByRole("link", { name: /Wpis p1/ })).toBeTruthy();
    expect(screen.getAllByRole("link", { name: /Wpis/ })).toHaveLength(3);
  });

  it("awaria silnika wyszukiwania mówi o niej wprost", async () => {
    data.searchError = true;
    await mount(PublicationsRoute, "/publications", "/publications");
    expect(await screen.findByText(/nie udało się|failed/i)).toBeTruthy();
  });

  it("pasek stron pojawia się dopiero, gdy jest więcej niż jedna strona", async () => {
    data.search = { posts: posts(2), facets: [], total: 2 };
    const { unmount } = await mount(PublicationsRoute, "/publications", "/publications");
    // Najpierw dowód, że wynik JEST na ekranie - inaczej brak paska
    // dowodziłby tylko tego, że zapytanie jeszcze nie wróciło.
    await screen.findByText("2 publikacje");
    expect(screen.queryByRole("navigation", { name: "Paginacja" })).toBeNull();
    unmount();

    data.search = { posts: posts(SEARCH_PAGE_SIZE + 1), facets: [], total: SEARCH_PAGE_SIZE + 1 };
    await mount(PublicationsRoute, "/publications", "/publications");
    expect(await screen.findByRole("navigation", { name: "Paginacja" })).toBeTruthy();
    // Dawnego „Pokaż więcej" nie ma - strona to adres, nie rosnące okno.
    expect(screen.queryByRole("button", { name: /więcej|more/i })).toBeNull();
  });

  it("fraza z formularza ląduje w ADRESIE, nie w stanie komponentu", async () => {
    // Stan biblioteki żyje w parametrach URL - inaczej przefiltrowanego widoku
    // nie dałoby się udostępnić ani zacache'ować.
    const view = await mount(PublicationsRoute, "/publications", "/publications");
    const input = screen.getByRole("searchbox");
    fireEvent.change(input, { target: { value: "energia" } });
    await act(async () => {
      fireEvent.submit(input.closest("form")!);
    });
    expect(view.search()).toMatchObject({ q: "energia" });
  });

  it("filtr z adresu wchodzi do stanu strony", async () => {
    const view = await mount(
      PublicationsRoute,
      "/publications",
      "/publications?q=energia&sort=popular",
    );
    expect(view.search()).toMatchObject({ q: "energia", sort: "popular" });
    expect((screen.getByRole("searchbox") as HTMLInputElement).value).toBe("energia");
  });

  it("licznik wyników odmienia się po polsku i po angielsku", async () => {
    // Liczebnik w interfejsie to nie kosmetyka: „5 publikacje” czyta się jak błąd
    // tłumaczenia i podważa wiarygodność treści pod spodem.
    for (const [total, expected] of [
      [1, "1 publikacja"],
      [3, "3 publikacje"],
      [5, "5 publikacji"],
      [12, "12 publikacji"],
      [22, "22 publikacje"],
    ] as const) {
      data.search = { posts: [], facets: [], total };
      const { unmount } = await mount(PublicationsRoute, "/publications", "/publications");
      expect(await screen.findByText(expected)).toBeTruthy();
      unmount();
    }

    await act(async () => void (await i18n.changeLanguage("en")));
    data.search = { posts: [], facets: [], total: 1 };
    const one = await mount(PublicationsRoute, "/publications", "/publications");
    expect(await screen.findByText("1 publication")).toBeTruthy();
    one.unmount();

    data.search = { posts: [], facets: [], total: 4 };
    await mount(PublicationsRoute, "/publications", "/publications");
    expect(await screen.findByText("4 publications")).toBeTruthy();
  });

  it("zmiana sortowania ląduje w ADRESIE i czyści puste parametry", async () => {
    const view = await mount(PublicationsRoute, "/publications", "/publications");
    const trigger = await screen.findByRole("combobox", { name: /Sortowanie/i });
    await act(async () => {
      fireEvent.keyDown(trigger, { key: "Enter" });
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("option", { name: "Popularne" }));
    });
    expect(view.search()).toMatchObject({ sort: "popular" });
    // Pusta fraza NIE zostaje w adresie - linki mają być czyste i cache'owalne.
    expect(view.search().q).toBeUndefined();
  });

  it("pusty wynik z filtrem daje przycisk czyszczenia, który kasuje filtry z adresu", async () => {
    const view = await mount(PublicationsRoute, "/publications", "/publications?type=raport");
    expect(view.search()).toMatchObject({ type: "raport" });
    const clear = await screen.findByRole("button", { name: /Wyczyść filtry/i });
    await act(async () => {
      fireEvent.click(clear);
    });
    expect(view.search().type).toBeUndefined();
  });

  it("pusty wynik BEZ filtrów nie proponuje czyszczenia niczego", async () => {
    await mount(PublicationsRoute, "/publications", "/publications");
    await screen.findByText(/Brak publikacji spełniających kryteria/i);
    expect(screen.queryByRole("button", { name: /Wyczyść filtry/i })).toBeNull();
  });

  // PAGINACJA LINKOWA. Dawne „Pokaż więcej" podwajało limit jednego zapytania:
  // strony nie miały adresów, crawler nie miał czego śledzić, a każde
  // doładowanie przeliczało całe okno od początku. Teraz strona to adres
  // (`?page=N`), a pasek - prawdziwe `<a href>` niosące WSZYSTKIE filtry.
  describe("paginacja linkowa", () => {
    /** Cztery pełne strony (SEARCH_PAGE_SIZE * 3 + 20 wyników). */
    const CZTERY_STRONY = SEARCH_PAGE_SIZE * 3 + 20;
    let scrollTo: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      data.search = { posts: posts(CZTERY_STRONY), facets: [], total: CZTERY_STRONY };
      scrollTo = vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);
    });

    afterEach(() => {
      scrollTo.mockRestore();
      vi.unstubAllGlobals();
    });

    function pasek() {
      return screen.findByRole("navigation", { name: "Paginacja" });
    }

    /**
     * Przewinięcia zlecone przez STRONĘ, nie przez router. Router sam woła
     * `scrollTo({ top: 0, left: 0, behavior: undefined })` przy resecie
     * pozycji po nawigacji - to jego kontrakt, nie nasz. Trasa jako jedyna
     * podaje `behavior` jawnie (z `preferredScrollBehavior`).
     */
    function przewinieciaStrony(): unknown[] {
      return scrollTo.mock.calls
        .map((call: readonly unknown[]) => call[0])
        .filter(
          (arg: unknown) =>
            typeof arg === "object" &&
            arg !== null &&
            "behavior" in arg &&
            typeof arg.behavior === "string",
        );
    }

    it("pyta silnik o JEDNĄ stronę z adresu, nie o rosnące okno", async () => {
      await mount(PublicationsRoute, "/publications", "/publications?page=3");
      expect(await screen.findByRole("link", { name: /Wpis p121\b/ })).toBeTruthy();
      expect(data.searches.at(-1)?.page).toBe(3);
      // Na ekranie dokładnie strona trzecia, bez stron 1-2 nad nią.
      expect(screen.queryByRole("link", { name: /Wpis p1\b/ })).toBeNull();
      expect(screen.getAllByRole("link", { name: /Wpis/ })).toHaveLength(SEARCH_PAGE_SIZE);
    });

    it("linki stron to prawdziwe <a href> z filtrami z adresu, bez `q=` i bez `?page=1`", async () => {
      await mount(PublicationsRoute, "/publications", "/publications?type=raport&sort=popular");
      const nav = await pasek();
      expect(within(nav).getByRole("link", { name: "Strona 2" })).toHaveAttribute(
        "href",
        "/publications?type=raport&sort=popular&page=2",
      );
      expect(within(nav).getByRole("link", { name: "Strona 4" })).toHaveAttribute(
        "href",
        "/publications?type=raport&sort=popular&page=4",
      );
      expect(within(nav).getByRole("link", { name: "Następna strona" })).toHaveAttribute(
        "href",
        "/publications?type=raport&sort=popular&page=2",
      );
      // Strona bieżąca nie jest linkiem (nie ma dokąd prowadzić).
      expect(within(nav).queryByRole("link", { name: "Strona 1" })).toBeNull();
    });

    it("powrót na stronę pierwszą prowadzi pod CZYSTY adres - bez `?page=1`", async () => {
      await mount(PublicationsRoute, "/publications", "/publications?type=raport&page=2");
      const nav = await pasek();
      expect(within(nav).getByRole("link", { name: "Strona 1" })).toHaveAttribute(
        "href",
        "/publications?type=raport",
      );
      expect(within(nav).getByRole("link", { name: "Poprzednia strona" })).toHaveAttribute(
        "href",
        "/publications?type=raport",
      );
    });

    it("parametr spoza schematu (utm) nie rozmnaża się po linkach paska", async () => {
      await mount(PublicationsRoute, "/publications", "/publications?utm_source=newsletter");
      const nav = await pasek();
      expect(within(nav).getByRole("link", { name: "Strona 2" })).toHaveAttribute(
        "href",
        "/publications?page=2",
      );
    });

    it("href linku to adres, który otwiera DOKŁADNIE tę stronę z tymi filtrami", async () => {
      const first = await mount(
        PublicationsRoute,
        "/publications",
        "/publications?type=raport&sort=popular",
      );
      // Ze strony 1 pasek pokazuje 1, 2, …, 4 - bierzemy link OSTATNIEJ strony.
      const href = within(await pasek())
        .getByRole("link", { name: "Strona 4" })
        .getAttribute("href");
      first.unmount();

      const view = await mount(PublicationsRoute, "/publications", href ?? "");
      expect(view.search()).toMatchObject({ type: "raport", sort: "popular", page: 4 });
      expect(await screen.findByRole("link", { name: /Wpis p181\b/ })).toBeTruthy();
      expect(data.searches.at(-1)?.page).toBe(4);
    });

    it("kliknięcie strony ZMIENIA ADRES (z filtrami) i ładuje tę stronę", async () => {
      const view = await mount(PublicationsRoute, "/publications", "/publications?type=raport");
      const nav = await pasek();
      await act(async () => {
        fireEvent.click(within(nav).getByRole("link", { name: "Strona 2" }), { button: 0 });
      });
      expect(view.search()).toMatchObject({ type: "raport", page: 2 });
      expect(await screen.findByRole("link", { name: /Wpis p61\b/ })).toBeTruthy();
      expect(data.searches.at(-1)?.page).toBe(2);
    });

    it("zmiana STRONY przewija na górę płynnie; pierwsze wejście na `?page=3` nie przewija", async () => {
      await mount(PublicationsRoute, "/publications", "/publications?page=3");
      await screen.findByRole("link", { name: /Wpis p121\b/ });
      expect(przewinieciaStrony()).toEqual([]);

      await act(async () => {
        fireEvent.click(within(await pasek()).getByRole("link", { name: "Strona 4" }), {
          button: 0,
        });
      });
      await screen.findByRole("link", { name: /Wpis p181\b/ });
      expect(przewinieciaStrony()).toEqual([{ top: 0, behavior: "smooth" }]);
    });

    it("„ogranicz ruch” w systemie: zmiana strony skacze na górę bez animacji", async () => {
      vi.stubGlobal("matchMedia", (query: string) => ({
        matches: query === "(prefers-reduced-motion: reduce)",
      }));
      await mount(PublicationsRoute, "/publications", "/publications");
      await act(async () => {
        fireEvent.click(within(await pasek()).getByRole("link", { name: "Strona 2" }), {
          button: 0,
        });
      });
      await screen.findByRole("link", { name: /Wpis p61\b/ });
      expect(przewinieciaStrony()).toEqual([{ top: 0, behavior: "auto" }]);
    });

    it("zmiana sortowania na stronie 3 wraca na STRONĘ PIERWSZĄ, zachowując filtry", async () => {
      const view = await mount(
        PublicationsRoute,
        "/publications",
        "/publications?type=raport&page=3",
      );
      await screen.findByRole("link", { name: /Wpis p121\b/ });
      const trigger = await screen.findByRole("combobox", { name: /Sortowanie/i });
      await act(async () => {
        fireEvent.keyDown(trigger, { key: "Enter" });
      });
      await act(async () => {
        fireEvent.click(screen.getByRole("option", { name: "Popularne" }));
      });
      expect(view.search()).toMatchObject({ type: "raport", sort: "popular" });
      expect(view.search().page).toBeUndefined();
      await vi.waitFor(() => expect(data.searches.at(-1)?.page).toBe(1));
    });

    it("nowa fraza na stronie 2 też wraca na stronę pierwszą", async () => {
      const view = await mount(PublicationsRoute, "/publications", "/publications?page=2");
      const input = screen.getByRole("searchbox");
      fireEvent.change(input, { target: { value: "energia" } });
      await act(async () => {
        fireEvent.submit(input.closest("form")!);
      });
      expect(view.search()).toMatchObject({ q: "energia" });
      expect(view.search().page).toBeUndefined();
    });

    it("STRONA ZA KOŃCEM: odesłanie do ostatniej strony zamiast fałszywej pustki", async () => {
      // 130 wyników = 3 strony; stary link na stronę 9 nie może twierdzić, że
      // „brak publikacji spełniających kryteria" - wyniki są, tylko wcześniej.
      data.search = { posts: posts(130), facets: [], total: 130 };
      await mount(PublicationsRoute, "/publications", "/publications?type=raport&page=9");
      expect(
        await screen.findByText("Strona 9 nie istnieje - wyniki kończą się na stronie 3."),
      ).toBeTruthy();
      expect(screen.getByRole("link", { name: "Przejdź do strony 3" })).toHaveAttribute(
        "href",
        "/publications?type=raport&page=3",
      );
      expect(screen.queryByText(/Brak publikacji spełniających kryteria/i)).toBeNull();
      // Licznik nadal mówi prawdę o całym zbiorze.
      expect(screen.getByText("130 publikacji")).toBeTruthy();
    });

    it("odesłanie spoza zakresu prowadzi na ostatnią stronę po kliknięciu", async () => {
      data.search = { posts: posts(130), facets: [], total: 130 };
      const view = await mount(PublicationsRoute, "/publications", "/publications?page=9");
      const back = await screen.findByRole("link", { name: "Przejdź do strony 3" });
      await act(async () => {
        fireEvent.click(back, { button: 0 });
      });
      expect(view.search()).toMatchObject({ page: 3 });
      expect(await screen.findByRole("link", { name: /Wpis p121\b/ })).toBeTruthy();
    });

    it("filtry BEZ wyników na stronie 2 to zwykła pustka, nie „strona za końcem”", async () => {
      data.search = { posts: [], facets: [], total: 0 };
      await mount(PublicationsRoute, "/publications", "/publications?type=raport&page=2");
      expect(await screen.findByText(/Brak publikacji spełniających kryteria/i)).toBeTruthy();
      expect(screen.queryByText(/nie istnieje/)).toBeNull();
    });

    it("licznik wyników zostaje w regionie aria-live (czytnik słyszy zmianę strony)", async () => {
      await mount(PublicationsRoute, "/publications", "/publications?page=2");
      const licznik = await screen.findByText(`${CZTERY_STRONY} publikacji`);
      expect(licznik.closest("[aria-live='polite']")).not.toBeNull();
    });
  });
});
describe("stany przejściowe tras archiwum", () => {
  // Trasa, która w czasie ładowania pokazuje pustkę, przesuwa całą stronę
  // w momencie dojścia danych (CLS). Szkielet siatki rezerwuje to miejsce.
  it.each([
    ["/blog", BlogRoute],
    ["/category/$slug", CategoryRoute],
    ["/tag/$slug", TagRoute],
    ["/publications", PublicationsRoute],
  ])("%s czeka szkieletem siatki, a nie pustką", (_name, route) => {
    const Pending = (route as { options: { pendingComponent?: () => ReactNode } }).options
      .pendingComponent;
    expect(Pending).toBeTypeOf("function");
    const { container } = render(<>{Pending!()}</>);
    expect(container.querySelectorAll(".skeleton-shimmer").length).toBeGreaterThan(0);
  });
});
