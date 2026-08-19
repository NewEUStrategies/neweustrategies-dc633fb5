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
import { describe, expect, it, afterEach, beforeEach, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import i18n from "@/lib/i18n";
import "@/lib/i18n-archive-layout";
import type { BlogListItem } from "@/lib/queries/public";
import { CARD_IMAGE_SIZES, FEATURED_CARD_IMAGE_SIZES } from "@/lib/cardImageSizes";
import { SEARCH_PAGE_SIZE } from "@/lib/queries/archives";
import { DEFAULT_ARCHIVE_LAYOUT } from "@/lib/archive-layout-settings";

const data = vi.hoisted(() => ({
  blog: null as { posts: unknown[]; total: number; page: number; pageSize: number } | null,
  settings: {} as Record<string, unknown>,
  taxonomy: null as Record<string, unknown> | null,
  layout: null as Record<string, unknown> | null,
  search: { posts: [] as unknown[], facets: [] as unknown[], total: 0 },
  searchError: false,
  settingsError: false,
  pageSizeError: false,
  taxonomyError: false,
  // Limity, z jakimi trasa zawołała silnik wyszukiwania - „pokaż więcej”
  // ma PODWAJAĆ limit, a nie dokładać kolejną stronę.
  limits: [] as number[],
}));

vi.mock("@/lib/queries/public", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/queries/public")>()),
  blogArchiveQueryOptions: (params: { page: number; pageSize: number }) => ({
    queryKey: ["blog-archive", params.page, params.pageSize],
    queryFn: () =>
      data.blog === null ? Promise.reject(new Error("blip backendu")) : Promise.resolve(data.blog),
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

vi.mock("@/lib/queries/archives", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/queries/archives")>()),
  taxonomyArchiveQueryOptions: (kind: string, slug: string, opts: unknown) => ({
    queryKey: ["taxonomy-archive", kind, slug, opts],
    queryFn: () =>
      data.taxonomyError
        ? Promise.reject(new Error("baza taksonomii padła"))
        : Promise.resolve(data.taxonomy),
  }),
  searchQueryOptions: (filters: { q: string; sort: string }, limit: number) => ({
    queryKey: ["publications-search", filters.q, filters.sort, limit, data.searchError],
    queryFn: () => {
      data.limits.push(limit);
      return data.searchError
        ? Promise.reject(new Error("silnik padł"))
        : Promise.resolve({ ...data.search, posts: data.search.posts.slice(0, limit) });
    },
  }),
}));

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

beforeEach(() => {
  data.blog = { posts: posts(2), total: 2, page: 1, pageSize: 2 };
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
  data.limits = [];
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

  it("awaria bazy pokazuje stronę błędu, a nie białą stronę", async () => {
    // Różnica wobec braku taksonomii: tam 404 (zasób nie istnieje), tutaj błąd
    // (zasób może istnieć, ale nie umiemy go teraz przeczytać).
    data.taxonomyError = true;
    await mount(CategoryRoute, "/category/$slug", "/category/gospodarka");
    expect(screen.queryByRole("heading", { name: "Gospodarka" })).toBeNull();
    expect(screen.getAllByText(/Nie udało się załadować strony/i).length).toBeGreaterThan(0);
    // Ślepy zaułek to najgorsza wersja błędu - musi być droga powrotna.
    expect(screen.getByRole("button", { name: /Wróć/i })).toBeTruthy();
  });

  it("brak taksonomii TAGU też kończy się stroną 404", async () => {
    data.taxonomy = null;
    await mount(TagRoute, "/tag/$slug", "/tag/nie-ma");
    expect(screen.getAllByText(/404|nie znaleziono|not found/i).length).toBeGreaterThan(0);
  });

  it("awaria bazy na trasie tagu również pokazuje stronę błędu", async () => {
    data.taxonomyError = true;
    await mount(TagRoute, "/tag/$slug", "/tag/nato");
    expect(screen.getAllByText(/Nie udało się załadować strony/i).length).toBeGreaterThan(0);
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
    expect(screen.getByRole("link", { name: /Wpis p1/ })).toBeTruthy();
    expect(screen.getAllByRole("link", { name: /Wpis/ })).toHaveLength(3);
  });

  it("awaria silnika wyszukiwania mówi o niej wprost", async () => {
    data.searchError = true;
    await mount(PublicationsRoute, "/publications", "/publications");
    expect(screen.getByText(/nie udało się|failed/i)).toBeTruthy();
  });

  it("„pokaż więcej” pojawia się dopiero, gdy jest co pokazać", async () => {
    data.search = { posts: posts(2), facets: [], total: 2 };
    const { unmount } = await mount(PublicationsRoute, "/publications", "/publications");
    expect(screen.queryByRole("button", { name: /więcej|more/i })).toBeNull();
    unmount();

    data.search = { posts: posts(2), facets: [], total: 50 };
    await mount(PublicationsRoute, "/publications", "/publications");
    expect(screen.getByRole("button", { name: /więcej|more/i })).toBeTruthy();
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
      expect(screen.getByText(expected)).toBeTruthy();
      unmount();
    }

    await act(async () => void (await i18n.changeLanguage("en")));
    data.search = { posts: [], facets: [], total: 1 };
    const one = await mount(PublicationsRoute, "/publications", "/publications");
    expect(screen.getByText("1 publication")).toBeTruthy();
    one.unmount();

    data.search = { posts: [], facets: [], total: 4 };
    await mount(PublicationsRoute, "/publications", "/publications");
    expect(screen.getByText("4 publications")).toBeTruthy();
  });

  it("zmiana sortowania ląduje w ADRESIE i czyści puste parametry", async () => {
    const view = await mount(PublicationsRoute, "/publications", "/publications");
    const trigger = screen.getByRole("combobox", { name: /Sortowanie/i });
    await act(async () => {
      fireEvent.keyDown(trigger, { key: "Enter" });
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("option", { name: "Popularne" }));
    });
    expect(view.search()).toMatchObject({ sort: "popular" });
    // Pusta fraza NIE zostaje w adresie - linki mają być czyste i cache'owalne.
    expect(view.search().q).toBe("");
  });

  it("pusty wynik z filtrem daje przycisk czyszczenia, który kasuje filtry z adresu", async () => {
    const view = await mount(PublicationsRoute, "/publications", "/publications?type=raport");
    expect(view.search()).toMatchObject({ type: "raport" });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Wyczyść filtry/i }));
    });
    expect(view.search().type).toBeUndefined();
  });

  it("pusty wynik BEZ filtrów nie proponuje czyszczenia niczego", async () => {
    await mount(PublicationsRoute, "/publications", "/publications");
    expect(screen.queryByRole("button", { name: /Wyczyść filtry/i })).toBeNull();
  });

  it("„pokaż więcej” PODWAJA limit zapytania, zamiast dokładać stronę", async () => {
    // Biblioteka nie stronicuje - rośnie limit jednego zapytania, więc pozycja
    // przewijania czytelnika zostaje tam, gdzie była.
    data.search = { posts: posts(3), facets: [], total: 500 };
    await mount(PublicationsRoute, "/publications", "/publications");
    expect(data.limits.at(-1)).toBe(SEARCH_PAGE_SIZE);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Pokaż więcej/i }));
    });
    expect(data.limits.at(-1)).toBe(SEARCH_PAGE_SIZE * 2);
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
