// Wspólny widok archiwum taksonomii - jeden komponent obsługuje trasy
// /category/$slug i /tag/$slug. Do 18.08.2026 na 0%.
//
// Tutaj mieszka to, czego nie widać ani w regułach układu, ani w komponentach
// prezentacyjnych: SKŁADANIE ADRESÓW stron wyników. Wartości domyślne muszą
// zostać NIEJAWNE (`?page=1` i `?sort=newest` w adresie to duplikat treści
// kanonicznej), a wariant layoutu ma pochodzić z ustawień, nie z kodu trasy.
import { describe, expect, it, afterEach, beforeEach, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";
import "@/lib/i18n";
import "@/lib/i18n-archive-layout";
import type { BlogListItem } from "@/lib/queries/public";
import { DEFAULT_ARCHIVE_LAYOUT } from "@/lib/archive-layout-settings";

const nav = vi.hoisted(() => ({
  navigate: vi.fn(),
  built: [] as { to: string; params: unknown; search: unknown }[],
}));
const data = vi.hoisted(() => ({
  settings: null as Record<string, unknown> | null,
  archive: null as Record<string, unknown> | null,
  podcasts: [] as { id: string; title: string }[],
}));

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => nav.navigate,
  useRouter: () => ({
    buildLocation: ({ to, params, search }: { to: string; params: unknown; search: unknown }) => {
      nav.built.push({ to, params, search });
      const query = Object.entries((search ?? {}) as Record<string, unknown>)
        .filter(([, v]) => v !== undefined)
        .map(([k, v]) => `${k}=${String(v)}`)
        .join("&");
      const slug = (params as { slug: string }).slug;
      const base = to.replace("$slug", slug);
      return { publicHref: query ? `${base}?${query}` : base };
    },
  }),
}));

vi.mock("@/lib/queries/archives", () => ({
  taxonomyArchiveQueryOptions: (kind: string, slug: string, opts: unknown) => ({
    queryKey: ["taxonomy-archive", kind, slug, opts],
    queryFn: () => Promise.resolve(data.archive),
  }),
}));

vi.mock("@/lib/archive-layout-settings", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/archive-layout-settings")>()),
  archiveLayoutQueryOptions: (kind: string) => ({
    queryKey: ["archive-layout-settings", kind],
    queryFn: () => Promise.resolve(data.settings),
  }),
}));

vi.mock("@/lib/queries/podcasts", () => ({
  podcastsByCategoryQueryOptions: (id: string) => ({
    queryKey: ["podcasts", id],
    queryFn: () => Promise.resolve(data.podcasts),
  }),
}));

vi.mock("@/components/podcast/PodcastEpisodeStrip", () => ({
  PodcastEpisodeStrip: ({ title }: { title: string }) => <div data-testid="podcasts">{title}</div>,
}));

vi.mock("@/components/builder/organisms/BuilderRenderer", () => ({
  BuilderRenderer: () => <div data-testid="featured-section" />,
}));

vi.mock("@/components/molecules/PublicNotFound", () => ({
  PublicNotFound: () => <div data-testid="not-found">Nie znaleziono</div>,
}));

// Layouty mają własne testy - tutaj interesuje nas WYBÓR wariantu i to, jakie
// wywołania zwrotne dostaje od trasy.
vi.mock("@/components/archive/layouts/registry", () => ({
  getLayoutComponent: (variant: number) => {
    const Layout = (props: {
      hrefFor?: (page: number) => string;
      onPageChange: (page: number) => void;
      onSortChange: (sort: string) => void;
      extraBelow?: React.ReactNode;
      total: number;
    }) => (
      <div>
        <span data-testid="variant">{variant}</span>
        <span data-testid="total">{props.total}</span>
        <span data-testid="href-2">{props.hrefFor?.(2)}</span>
        <span data-testid="href-1">{props.hrefFor?.(1)}</span>
        <button type="button" onClick={() => props.onPageChange(3)}>
          idź na stronę 3
        </button>
        <button type="button" onClick={() => props.onSortChange("popular")}>
          sortuj popularne
        </button>
        <button type="button" onClick={() => props.onSortChange("newest")}>
          sortuj najnowsze
        </button>
        {props.extraBelow}
      </div>
    );
    return Layout;
  },
}));

const { TaxonomyPage } = await import("@/components/archive/TaxonomyPage");

function archive(over: Record<string, unknown> = {}) {
  return {
    taxonomy: {
      id: "tax-1",
      slug: "gospodarka",
      name_pl: "Gospodarka",
      name_en: "Economy",
      description_pl: null,
      description_en: null,
      featured_section: null,
    },
    posts: [] as BlogListItem[],
    total: 42,
    page: 1,
    pageSize: 60,
    sort: "newest",
    ...over,
  };
}

function renderPage(props: Partial<Parameters<typeof TaxonomyPage>[0]> = {}): ReactElement {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0, staleTime: 0 } },
  });
  return (
    <QueryClientProvider client={client}>
      <TaxonomyPage kind="category" slug="gospodarka" page={1} sort="newest" {...props} />
    </QueryClientProvider>
  );
}

beforeEach(() => {
  nav.navigate.mockClear();
  nav.built = [];
  data.settings = { ...DEFAULT_ARCHIVE_LAYOUT, id: "s1", archive_type: "category" };
  data.archive = archive();
  data.podcasts = [];
  window.scrollTo = vi.fn() as unknown as typeof window.scrollTo;
});

afterEach(cleanup);

describe("TaxonomyPage - wybór wariantu i dane", () => {
  it("wariant layoutu pochodzi z USTAWIEŃ, nie z kodu trasy", async () => {
    data.settings = {
      ...DEFAULT_ARCHIVE_LAYOUT,
      id: "s1",
      archive_type: "category",
      layout_variant: 5,
    };
    render(renderPage());
    expect((await screen.findByTestId("variant")).textContent).toBe("5");
  });

  it("przekazuje liczbę wyników z zapytania archiwum", async () => {
    render(renderPage());
    expect((await screen.findByTestId("total")).textContent).toBe("42");
  });

  it("brak taksonomii daje stronę 404, nie pusty layout", async () => {
    data.archive = null;
    render(renderPage());
    expect(await screen.findByTestId("not-found")).toBeTruthy();
    expect(screen.queryByTestId("variant")).toBeNull();
  });

  it("sekcja wyróżniona z buildera renderuje się NAD archiwum", async () => {
    data.archive = archive({
      taxonomy: { ...archive().taxonomy, featured_section: { type: "section", id: "s" } },
    });
    render(renderPage());
    expect(await screen.findByTestId("featured-section")).toBeTruthy();
  });

  it("bez sekcji wyróżnionej nie ma pustego kontenera nad listą", async () => {
    render(renderPage());
    await screen.findByTestId("variant");
    expect(screen.queryByTestId("featured-section")).toBeNull();
  });
});

describe("TaxonomyPage - adresy stron wyników (SEO)", () => {
  it("strona 1 to CZYSTY adres archiwum, bez ?page=1", async () => {
    // Duplikat treści: `/category/x` i `/category/x?page=1` to ta sama strona.
    render(renderPage());
    expect((await screen.findByTestId("href-1")).textContent).toBe("/category/gospodarka");
  });

  it("kolejne strony mają własny, indeksowalny adres", async () => {
    render(renderPage());
    expect((await screen.findByTestId("href-2")).textContent).toBe("/category/gospodarka?page=2");
  });

  it("adres niesie NIEDOMYŚLNE sortowanie razem z numerem strony", async () => {
    data.archive = archive({ sort: "popular" });
    render(renderPage({ sort: "popular" }));
    expect((await screen.findByTestId("href-2")).textContent).toBe(
      "/category/gospodarka?page=2&sort=popular",
    );
  });

  it("tag używa własnego wzorca trasy", async () => {
    render(renderPage({ kind: "tag", slug: "nato" }));
    expect((await screen.findByTestId("href-2")).textContent).toBe("/tag/nato?page=2");
  });
});

describe("TaxonomyPage - nawigacja", () => {
  it("zmiana strony zachowuje bieżące sortowanie", async () => {
    data.archive = archive({ sort: "popular" });
    render(renderPage({ sort: "popular" }));
    fireEvent.click(await screen.findByRole("button", { name: "idź na stronę 3" }));
    expect(nav.navigate).toHaveBeenCalledWith(
      expect.objectContaining({ search: { page: 3, sort: "popular" } }),
    );
  });

  it("zmiana sortowania WRACA na pierwszą stronę", async () => {
    // Inaczej czytelnik ląduje na stronie 7 nowego porządku, w którym nic
    // z poprzedniego kontekstu już nie ma.
    render(renderPage({ page: 5 }));
    fireEvent.click(await screen.findByRole("button", { name: "sortuj popularne" }));
    expect(nav.navigate).toHaveBeenCalledWith(
      expect.objectContaining({ search: { page: undefined, sort: "popular" } }),
    );
  });

  it("powrót do sortowania domyślnego CZYŚCI parametr z adresu", async () => {
    render(renderPage({ sort: "popular" }));
    fireEvent.click(await screen.findByRole("button", { name: "sortuj najnowsze" }));
    expect(nav.navigate).toHaveBeenCalledWith(
      expect.objectContaining({ search: { page: undefined, sort: undefined } }),
    );
  });

  it("wejście na dalszą stronę przewija na górę listy", async () => {
    render(renderPage({ page: 3 }));
    await screen.findByTestId("variant");
    expect(window.scrollTo).toHaveBeenCalledWith(expect.objectContaining({ top: 0 }));
  });

  it("pierwsza strona nie przewija - czytelnik dopiero wszedł", async () => {
    render(renderPage({ page: 1 }));
    await screen.findByTestId("variant");
    expect(window.scrollTo).not.toHaveBeenCalled();
  });
});

describe("TaxonomyPage - podcasty pod archiwum", () => {
  it("kategoria z podcastami dostaje pasek odcinków", async () => {
    data.podcasts = [{ id: "e1", title: "Odcinek" }];
    render(renderPage());
    expect(await screen.findByTestId("podcasts")).toBeTruthy();
  });

  it("bez odcinków paska nie ma", async () => {
    data.podcasts = [];
    render(renderPage());
    await screen.findByTestId("variant");
    expect(screen.queryByTestId("podcasts")).toBeNull();
  });

  it("wyłączone w ustawieniach - paska nie ma nawet przy odcinkach", async () => {
    data.podcasts = [{ id: "e1", title: "Odcinek" }];
    data.settings = {
      ...DEFAULT_ARCHIVE_LAYOUT,
      id: "s1",
      archive_type: "category",
      show_podcasts: false,
    };
    render(renderPage());
    await screen.findByTestId("variant");
    expect(screen.queryByTestId("podcasts")).toBeNull();
  });

  it("archiwum TAGU nie pyta o podcasty - to sekcja kategorii", async () => {
    data.podcasts = [{ id: "e1", title: "Odcinek" }];
    render(renderPage({ kind: "tag", slug: "nato" }));
    await screen.findByTestId("variant");
    expect(screen.queryByTestId("podcasts")).toBeNull();
  });
});
