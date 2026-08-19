// Archiwa kategorii i tagów - warstwa renderu. Reguły układu mają własne
// asercje w `lib/archive/__tests__/bodyPlan.test.ts`; tutaj sprawdzamy to,
// czego czysta funkcja nie dowiedzie: że wariant TRAFIA NA EKRAN, że czytelnik
// dostaje treść (a nie pusty kontener) i że stan pusty mówi coś sensownego.
//
// Do 18.08.2026 13 z 16 plików tej powierzchni stało na zerze - przy tym, że
// jest to DRUGA najczęściej odwiedzana powierzchnia serwisu po wpisach.
//
// Jeden test na wariant, asercja na TREŚĆ. Zależności spoza archiwum
// (reklamy, newsletter, przycisk obserwowania, okruszki) są podmienione:
// mają własne testy, a tutaj tylko zaciemniałyby, co jest sprawdzane.
import { describe, expect, it, afterEach, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement, ReactNode } from "react";
import "@/lib/i18n";
import "@/lib/i18n-archive-layout";
import { realT } from "@/test/i18nReal";
import { RouterLinkStub } from "@/test/routerLinkStub";
import type { BlogListItem } from "@/lib/queries/public";
import { DEFAULT_ARCHIVE_LAYOUT, type ArchiveLayoutSettings } from "@/lib/archive-layout-settings";

const ads = vi.hoisted(() => ({ renderAfterCard: null as ((i: number) => ReactNode) | null }));
const related = vi.hoisted(() => ({
  categories: [] as { id: string; slug: string; name_pl: string; name_en: string }[],
  tags: [] as { id: string; slug: string; name: string }[],
}));

vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  Link: RouterLinkStub,
}));

vi.mock("@/components/ads/useInFeedAds", () => ({
  useInFeedAds: () => ads.renderAfterCard ?? (() => null),
}));
vi.mock("@/components/ads/FooterSlideup", () => ({
  FooterSlideup: () => <div data-testid="slideup" />,
}));
vi.mock("@/components/AdSlot", () => ({
  AdZone: () => <div data-testid="ad-zone" />,
  AdSlotView: () => <div data-testid="ad-slot" />,
}));
vi.mock("@/components/NewsletterForm", () => ({
  NewsletterForm: () => <div data-testid="newsletter" />,
}));
vi.mock("@/components/FollowButton", () => ({
  FollowButton: ({ targetType }: { targetType: string }) => (
    <button type="button" data-testid="follow">
      obserwuj: {targetType}
    </button>
  ),
}));
vi.mock("@/components/Breadcrumbs", () => ({
  Breadcrumbs: ({ items }: { items: { label: string }[] }) => (
    <nav aria-label="okruszki">{items.map((i) => i.label).join(" / ")}</nav>
  ),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => {
      const rows = table === "categories" ? related.categories : related.tags;
      const builder = {
        select: () => builder,
        neq: () => builder,
        limit: () => Promise.resolve({ data: rows, error: null }),
      };
      return builder;
    },
  },
}));

const { ArchivePosts } = await import("@/components/archive/layouts/ArchivePosts");
const { ArchiveToolbar } = await import("@/components/archive/layouts/ArchiveToolbar");
const { ArchiveHeader } = await import("@/components/archive/layouts/ArchiveHeader");
const { ArchiveBody } = await import("@/components/archive/layouts/ArchiveBody");
const { ArchiveSidebar } = await import("@/components/archive/layouts/ArchiveSidebar");
const { ArchivePostList } = await import("@/components/archive/ArchivePostList");
const { PaginatedPostGrid } = await import("@/components/archive/PaginatedPostGrid");
const { ArchiveSkeleton } = await import("@/components/archive/ArchiveSkeleton");
const { HeroBackground } = await import("@/components/archive/layouts/heroBackgrounds");
const { LAYOUT_REGISTRY, getLayoutComponent } =
  await import("@/components/archive/layouts/registry");
const { ArchivePagination, buildRange } =
  await import("@/components/archive/layouts/ArchivePagination");
const variants = await import("@/components/archive/layouts/variants");

const t = realT("pl");

function post(over: Partial<BlogListItem> & { id: string }): BlogListItem {
  return {
    slug: over.id,
    title_pl: `Wpis ${over.id}`,
    title_en: `Post ${over.id}`,
    excerpt_pl: null,
    excerpt_en: null,
    cover_image_url: null,
    published_at: "2026-08-01T10:00:00Z",
    parent_page_id: "page-1",
    href: `/wpis/${over.id}`,
    is_sponsored: false,
    sponsored_kind: null,
    sponsored_affiliate: null,
    ...over,
  };
}

const posts = (n: number) => Array.from({ length: n }, (_, i) => post({ id: `p${i + 1}` }));

function settings(over: Partial<ArchiveLayoutSettings> = {}): ArchiveLayoutSettings {
  return { id: "s1", archive_type: "category", ...DEFAULT_ARCHIVE_LAYOUT, ...over };
}

const taxonomy = {
  id: "tax-1",
  slug: "gospodarka",
  name_pl: "Gospodarka",
  name_en: "Economy",
  description_pl: "Opis kategorii",
  description_en: "Category description",
  featured_section: null,
};

function bodyProps(over: Record<string, unknown> = {}) {
  return {
    kind: "category" as const,
    taxonomy,
    posts: posts(3),
    lang: "pl" as const,
    settings: settings(),
    page: 1,
    pageSize: 60,
    total: 3,
    sort: "newest" as const,
    onPageChange: () => {},
    onSortChange: () => {},
    isPending: false,
    emptyText: "Brak wpisów w tej kategorii.",
    ...over,
  };
}

function renderWithQuery(ui: ReactElement) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0, staleTime: 0 } },
  });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

afterEach(() => {
  cleanup();
  ads.renderAfterCard = null;
  related.categories = [];
  related.tags = [];
});

describe("ArchivePosts - warianty siatki", () => {
  it("siatka: liczba kolumn idzie z ustawień", () => {
    const { container } = render(
      <ArchivePosts posts={posts(4)} lang="pl" settings={settings({ columns: 4 })} emptyText="" />,
    );
    expect(container.firstElementChild?.className).toContain("lg:grid-cols-4");
    expect(screen.getAllByRole("link")).toHaveLength(4);
  });

  it("lista: wpisy w elemencie listy, nie w kafelkach", () => {
    render(
      <ArchivePosts
        posts={posts(2)}
        lang="pl"
        settings={settings({ list_style: "list" })}
        emptyText=""
      />,
    );
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
  });

  it("masonry: układ kolumnowy zamiast siatki", () => {
    const { container } = render(
      <ArchivePosts
        posts={posts(2)}
        lang="pl"
        settings={settings({ list_style: "masonry" })}
        emptyText=""
      />,
    );
    expect(container.firstElementChild?.className).toContain("columns-");
  });

  it("PUSTA strona tłumaczy, że to nie awaria - pokazuje komunikat", () => {
    render(
      <ArchivePosts
        posts={[]}
        lang="pl"
        settings={settings()}
        emptyText="Brak wpisów w tej kategorii."
      />,
    );
    expect(screen.getByText("Brak wpisów w tej kategorii.")).toBeTruthy();
    expect(screen.queryAllByRole("link")).toHaveLength(0);
  });

  it("wstawki in-feed lądują PO wskazanej karcie - w każdym z trzech układów", () => {
    ads.renderAfterCard = (i) => (i === 1 ? <span>reklama</span> : null);
    for (const list_style of ["grid", "list", "masonry"] as const) {
      const view = render(
        <ArchivePosts
          posts={posts(3)}
          lang="pl"
          settings={settings({ list_style })}
          emptyText=""
          renderAfterCard={ads.renderAfterCard!}
        />,
      );
      expect(screen.getAllByText("reklama")).toHaveLength(1);
      view.unmount();
    }
  });

  it("tytuły idą za językiem strony", () => {
    render(<ArchivePosts posts={posts(1)} lang="en" settings={settings()} emptyText="" />);
    expect(screen.getByText("Post p1")).toBeTruthy();
  });
});

describe("ArchiveToolbar - licznik i sortowanie", () => {
  it("pokazuje zakres wyników bieżącej strony", () => {
    render(
      <ArchiveToolbar
        lang="pl"
        total={57}
        page={2}
        pageSize={20}
        sort="newest"
        onSortChange={() => {}}
        isPending={false}
      />,
    );
    expect(screen.getByText("Pokazuję 21–40 z 57")).toBeTruthy();
  });

  it("ostatnia strona nie obiecuje wyników, których nie ma", () => {
    render(
      <ArchiveToolbar
        lang="en"
        total={57}
        page={3}
        pageSize={20}
        sort="newest"
        onSortChange={() => {}}
        isPending={false}
      />,
    );
    expect(screen.getByText("Showing 41–57 of 57")).toBeTruthy();
  });

  it("brak wyników mówi wprost, że ich nie ma", () => {
    render(
      <ArchiveToolbar
        lang="pl"
        total={0}
        page={1}
        pageSize={20}
        sort="newest"
        onSortChange={() => {}}
        isPending={false}
      />,
    );
    expect(screen.getByText("Brak wyników")).toBeTruthy();
  });

  it("w trakcie przeładowania licznik nie kłamie starą liczbą", () => {
    render(
      <ArchiveToolbar
        lang="pl"
        total={57}
        page={1}
        pageSize={20}
        sort="newest"
        onSortChange={() => {}}
        isPending
      />,
    );
    expect(screen.getByText("Ładowanie...")).toBeTruthy();
    expect(screen.queryByText(/Pokazuję/)).toBeNull();
  });

  it("licznik jest ogłaszany czytnikowi ekranu", () => {
    const { container } = render(
      <ArchiveToolbar
        lang="pl"
        total={3}
        page={1}
        pageSize={20}
        sort="newest"
        onSortChange={() => {}}
        isPending={false}
      />,
    );
    expect(container.querySelector('[aria-live="polite"]')).not.toBeNull();
  });

  it("wybór sortowania jest nazwany dla czytnika ekranu", () => {
    render(
      <ArchiveToolbar
        lang="pl"
        total={3}
        page={1}
        pageSize={20}
        sort="popular"
        onSortChange={() => {}}
        isPending={false}
      />,
    );
    // Sam wybór jest ikoną z wartością - bez powiązanej etykiety czytnik
    // przeczytałby „lista rozwijana" i nic więcej.
    expect(screen.getByRole("combobox", { name: /Sortuj/ })).toBeTruthy();
  });

  it("w PODGLĄDZIE ADMINA kontrolki są zablokowane", () => {
    // Podgląd renderuje żywe archiwum; klikalne sortowanie zmieniałoby dane
    // pod panelem ustawień, w którym administrator właśnie pracuje.
    render(
      <ArchiveToolbar
        lang="pl"
        total={3}
        page={1}
        pageSize={20}
        sort="newest"
        onSortChange={() => {}}
        isPending={false}
        disabled
      />,
    );
    expect(screen.getByRole("combobox", { name: /Sortuj/ })).toBeDisabled();
  });

  it("wybór innego porządku zgłasza go trasie", () => {
    // To jedyna droga zmiany porządku wyników - jej zerwanie zamraża archiwum
    // na „najnowszych" niezależnie od tego, co wybierze czytelnik.
    const onSortChange = vi.fn();
    render(
      <ArchiveToolbar
        lang="pl"
        total={3}
        page={1}
        pageSize={20}
        sort="newest"
        onSortChange={onSortChange}
        isPending={false}
      />,
    );
    fireEvent.keyDown(screen.getByRole("combobox", { name: /Sortuj/ }), { key: "Enter" });
    fireEvent.click(screen.getByRole("option", { name: "Najpopularniejsze" }));
    expect(onSortChange).toHaveBeenCalledWith("popular");
  });

  it("etykieta sortowania idzie za językiem strony", () => {
    render(
      <ArchiveToolbar
        lang="en"
        total={3}
        page={1}
        pageSize={20}
        sort="newest"
        onSortChange={() => {}}
        isPending={false}
      />,
    );
    expect(screen.getByRole("combobox", { name: /Sort/ })).toBeTruthy();
  });
});

describe("ArchiveHeader", () => {
  it("tag dostaje krzyżyk przed nazwą, kategoria nie", () => {
    const { unmount } = render(
      <ArchiveHeader
        kind="tag"
        taxonomyId="t1"
        name="ue"
        description={null}
        lang="pl"
        settings={settings()}
      />,
    );
    expect(screen.getByRole("heading", { name: "#ue" })).toBeTruthy();
    unmount();

    render(
      <ArchiveHeader
        kind="category"
        taxonomyId="t1"
        name="Gospodarka"
        description={null}
        lang="pl"
        settings={settings()}
      />,
    );
    expect(screen.getByRole("heading", { name: "Gospodarka" })).toBeTruthy();
  });

  it("okruszki nazywają rodzaj archiwum ZE SŁOWNIKA", () => {
    render(
      <ArchiveHeader
        kind="category"
        taxonomyId="t1"
        name="Gospodarka"
        description={null}
        lang="pl"
        settings={settings()}
      />,
    );
    expect(screen.getByRole("navigation", { name: "okruszki" }).textContent).toContain(
      t("archiveLayout.breadcrumbs.categories"),
    );
  });

  it("wyłączone hero chowa nagłówek, opis i przycisk obserwowania", () => {
    // `show_hero: false` to ustawienie „archiwum bez czapki" - nagłówek H1
    // przestaje istnieć, więc nie może zostać sam przycisk obserwowania.
    render(
      <ArchiveHeader
        kind="category"
        taxonomyId="t1"
        name="Gospodarka"
        description="Opis"
        lang="pl"
        settings={settings({ show_hero: false })}
      />,
    );
    expect(screen.queryByRole("heading")).toBeNull();
    expect(screen.queryByTestId("follow")).toBeNull();
  });

  it("opis pokazuje się tylko wtedy, gdy jest i jest włączony", () => {
    const { unmount } = render(
      <ArchiveHeader
        kind="category"
        taxonomyId="t1"
        name="Gospodarka"
        description="Opis kategorii"
        lang="pl"
        settings={settings()}
      />,
    );
    expect(screen.getByText("Opis kategorii")).toBeTruthy();
    unmount();

    render(
      <ArchiveHeader
        kind="category"
        taxonomyId="t1"
        name="Gospodarka"
        description="Opis kategorii"
        lang="pl"
        settings={settings({ show_description: false })}
      />,
    );
    expect(screen.queryByText("Opis kategorii")).toBeNull();
  });

  it("przycisk obserwowania da się wyłączyć osobno", () => {
    render(
      <ArchiveHeader
        kind="tag"
        taxonomyId="t1"
        name="ue"
        description={null}
        lang="pl"
        settings={settings({ show_follow: false })}
      />,
    );
    expect(screen.queryByTestId("follow")).toBeNull();
  });

  it("okruszki da się wyłączyć bez chowania nagłówka", () => {
    render(
      <ArchiveHeader
        kind="category"
        taxonomyId="t1"
        name="Gospodarka"
        description={null}
        lang="pl"
        settings={settings({ show_breadcrumbs: false })}
      />,
    );
    expect(screen.queryByRole("navigation", { name: "okruszki" })).toBeNull();
    expect(screen.getByRole("heading", { name: "Gospodarka" })).toBeTruthy();
  });
});

describe("heroBackgrounds", () => {
  it("każdy styl tła renderuje własną warstwę", () => {
    for (const style of ["gradient", "solid", "mesh", "pattern", "minimal"] as const) {
      const { container, unmount } = render(<HeroBackground style={style} />);
      expect(container.firstElementChild).not.toBeNull();
      unmount();
    }
  });

  it("styl obrazkowy BEZ obrazu schodzi na jednolite tło, a nie na pustkę", () => {
    const { container } = render(<HeroBackground style="image" imageUrl={null} />);
    expect(container.firstElementChild?.className).toContain("bg-muted");
  });

  it("styl obrazkowy z obrazem dokłada przyciemnienie pod tekst", () => {
    const { container } = render(
      <HeroBackground style="image" imageUrl="https://example.com/hero.jpg" />,
    );
    expect(container.innerHTML).toContain("hero.jpg");
    expect(container.innerHTML).toContain("backdrop-blur");
  });
});

describe("rejestr layoutów", () => {
  it("każdy z sześciu wariantów ma komponent i podgląd", () => {
    for (const id of [1, 2, 3, 4, 5, 6] as const) {
      expect(typeof LAYOUT_REGISTRY[id].Component).toBe("function");
      expect(typeof LAYOUT_REGISTRY[id].preview).toBe("function");
    }
  });

  it("wariant spoza zakresu schodzi na klasyczny, a nie wywala strony", () => {
    // `layout_variant` przychodzi z bazy jako liczba - migracja albo ręczny
    // UPDATE mogą wpisać cokolwiek.
    expect(getLayoutComponent(0)).toBe(LAYOUT_REGISTRY[2].Component);
    expect(getLayoutComponent(7)).toBe(LAYOUT_REGISTRY[2].Component);
    expect(getLayoutComponent(Number.NaN)).toBe(LAYOUT_REGISTRY[2].Component);
    expect(getLayoutComponent(3)).toBe(LAYOUT_REGISTRY[3].Component);
  });

  it("podglądy wariantów renderują się jako grafika dekoracyjna", () => {
    for (const id of [1, 2, 3, 4, 5, 6] as const) {
      const Preview = LAYOUT_REGISTRY[id].preview;
      const { container, unmount } = render(<Preview className="w-10" />);
      const svg = container.querySelector("svg");
      expect(svg).not.toBeNull();
      expect(svg).toHaveAttribute("aria-hidden");
      unmount();
    }
  });
});

describe("buildRange - numery stron dla crawlera", () => {
  it("jedna strona to sam numer 1", () => {
    expect(buildRange(1, 1)).toEqual([1]);
  });

  it("dwie strony bez wielokropka", () => {
    expect(buildRange(1, 2)).toEqual([1, 2]);
  });

  it("okno wokół bieżącej strony, wielokropki po obu stronach", () => {
    expect(buildRange(50, 100)).toEqual([1, "ellipsis", 49, 50, 51, "ellipsis", 100]);
  });

  it("na początku zakresu nie ma wielokropka z lewej", () => {
    expect(buildRange(2, 100)).toEqual([1, 2, 3, "ellipsis", 100]);
  });

  it("na końcu zakresu nie ma wielokropka z prawej", () => {
    expect(buildRange(99, 100)).toEqual([1, "ellipsis", 98, 99, 100]);
  });

  it("pierwsza i ostatnia strona są ZAWSZE - crawler musi mieć skrajne linki", () => {
    for (const page of [1, 5, 10]) {
      const range = buildRange(page, 10);
      expect(range[0]).toBe(1);
      expect(range.at(-1)).toBe(10);
    }
  });
});

describe("ArchiveBody - kompozycja", () => {
  it("karta wyróżniona nad siatką nie duplikuje wpisu w siatce", () => {
    renderWithQuery(<ArchiveBody {...bodyProps({ posts: posts(3) })} />);
    // Trzy wpisy: jeden jako karta wyróżniona, dwa w siatce - żaden dwa razy.
    expect(screen.getAllByRole("link", { name: /Wpis p1/ })).toHaveLength(1);
    expect(screen.getAllByRole("link")).toHaveLength(3);
  });

  it("sidebar wchodzi z lewej albo z prawej strony siatki", () => {
    const left = renderWithQuery(
      <ArchiveBody
        {...bodyProps({
          settings: settings({ show_sidebar: true, sidebar_position: "left" }),
        })}
      />,
    );
    const rowLeft = left.container.querySelector(".flex.flex-col")!;
    expect(rowLeft.firstElementChild?.querySelector("aside")).not.toBeNull();
    left.unmount();

    const right = renderWithQuery(
      <ArchiveBody
        {...bodyProps({
          settings: settings({ show_sidebar: true, sidebar_position: "right" }),
        })}
      />,
    );
    const rowRight = right.container.querySelector(".flex.flex-col")!;
    expect(rowRight.lastElementChild?.querySelector("aside")).not.toBeNull();
  });

  it("bez sidebara nie ma pustej kolumny obok siatki", () => {
    const { container } = renderWithQuery(<ArchiveBody {...bodyProps()} />);
    expect(container.querySelector("aside")).toBeNull();
  });

  it("pasek stron pojawia się dopiero przy drugiej stronie wyników", () => {
    const { unmount } = renderWithQuery(<ArchiveBody {...bodyProps({ total: 3, pageSize: 60 })} />);
    expect(screen.queryByRole("navigation", { name: "Paginacja" })).toBeNull();
    unmount();

    renderWithQuery(<ArchiveBody {...bodyProps({ total: 61, pageSize: 60 })} />);
    expect(screen.getByRole("navigation", { name: "Paginacja" })).toBeTruthy();
  });

  it("PODGLĄD ADMINA nie emituje reklam ani slide-upu stopki", () => {
    ads.renderAfterCard = () => <span>reklama</span>;
    const { unmount } = renderWithQuery(<ArchiveBody {...bodyProps({ previewMode: true })} />);
    expect(screen.queryByText("reklama")).toBeNull();
    expect(screen.queryByTestId("slideup")).toBeNull();
    unmount();

    renderWithQuery(<ArchiveBody {...bodyProps()} />);
    expect(screen.getAllByText("reklama").length).toBeGreaterThan(0);
    expect(screen.getByTestId("slideup")).toBeTruthy();
  });

  it("treść dołożona przez trasę (np. podcasty) ląduje pod listą", () => {
    renderWithQuery(<ArchiveBody {...bodyProps({ extraBelow: <div>pasek podcastów</div> })} />);
    expect(screen.getByText("pasek podcastów")).toBeTruthy();
  });

  it("pusta strona pokazuje komunikat przekazany przez trasę", () => {
    renderWithQuery(<ArchiveBody {...bodyProps({ posts: [], total: 0 })} />);
    expect(screen.getByText("Brak wpisów w tej kategorii.")).toBeTruthy();
  });
});

describe("RelatedTaxonomiesBlock (sekcja pod listą)", () => {
  it("w podglądzie admina pokazuje przykładowe chipy, nie linki", async () => {
    // Podgląd nie ma dostępu do prawdziwych taksonomii, a administrator musi
    // ZOBACZYĆ, że sekcja istnieje - inaczej wygląda jak wyłączona.
    renderWithQuery(
      <ArchiveBody
        {...bodyProps({
          previewMode: true,
          settings: settings({ show_related_taxonomies: true }),
        })}
      />,
    );
    expect(await screen.findByText("Powiązane kategorie")).toBeTruthy();
    expect(screen.getByText("Przykład 1")).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Przykład 1" })).toBeNull();
  });

  it("na żywo pokazuje LINKI do sąsiednich kategorii", async () => {
    related.categories = [{ id: "c2", slug: "energia", name_pl: "Energia", name_en: "Energy" }];
    renderWithQuery(
      <ArchiveBody {...bodyProps({ settings: settings({ show_related_taxonomies: true }) })} />,
    );
    expect(await screen.findByRole("link", { name: "Energia" })).toHaveAttribute(
      "href",
      "/category/energia",
    );
  });

  it("taksonomia BEZ rodzeństwa nie zostawia pustej sekcji z nagłówkiem", () => {
    // To jest cały sens tego testu: nagłówek „Powiązane kategorie" nad pustką
    // wygląda jak awaria zapytania.
    related.categories = [];
    renderWithQuery(
      <ArchiveBody {...bodyProps({ settings: settings({ show_related_taxonomies: true }) })} />,
    );
    expect(screen.queryByText("Powiązane kategorie")).toBeNull();
  });

  it("dla tagów nagłówek i adresy są tagowe, nie kategoriowe", async () => {
    related.tags = [{ id: "t2", slug: "nato", name: "NATO" }];
    renderWithQuery(
      <ArchiveBody
        {...bodyProps({
          kind: "tag",
          settings: settings({ show_related_taxonomies: true }),
        })}
      />,
    );
    expect(await screen.findByText("Powiązane tagi")).toBeTruthy();
    expect(screen.getByRole("link", { name: "NATO" })).toHaveAttribute("href", "/tag/nato");
  });
});

describe("ArchiveSidebar - widgety", () => {
  function renderSidebar(widgets: ArchiveLayoutSettings["sidebar_widgets"], postsList = posts(6)) {
    return renderWithQuery(
      <ArchiveSidebar
        widgets={widgets}
        lang="pl"
        taxonomyId="tax-1"
        kind="category"
        posts={postsList}
      />,
    );
  }

  it("popularne pokazuje najwyżej pięć wpisów", () => {
    renderSidebar(["popular"]);
    expect(screen.getAllByRole("link")).toHaveLength(5);
  });

  it("popularne bez wpisów mówi wprost, że lista jest pusta", () => {
    renderSidebar(["popular"], []);
    expect(screen.getByText("Brak wpisów.")).toBeTruthy();
  });

  it("powiązane taksonomie: linki, a przy braku - komunikat", async () => {
    related.categories = [{ id: "c2", slug: "energia", name_pl: "Energia", name_en: "Energy" }];
    const withData = renderSidebar(["related"]);
    expect(await screen.findByRole("link", { name: "Energia" })).toBeTruthy();
    withData.unmount();

    related.categories = [];
    renderSidebar(["related"]);
    expect(await screen.findByText("Brak.")).toBeTruthy();
  });

  it("dla archiwum TAGU sekcja powiązanych prowadzi do tagów", async () => {
    related.tags = [{ id: "t2", slug: "nato", name: "NATO" }];
    renderWithQuery(
      <ArchiveSidebar
        widgets={["related"]}
        lang="pl"
        taxonomyId="tax-1"
        kind="tag"
        posts={posts(2)}
      />,
    );
    expect(await screen.findByRole("link", { name: "NATO" })).toHaveAttribute("href", "/tag/nato");
  });

  it("popularne biorą tytuł z wersji językowej", () => {
    renderSidebar(["popular"], posts(1));
    expect(screen.getByRole("link", { name: "Wpis p1" })).toBeTruthy();
  });

  it("newsletter i reklamy osadzają swoje komponenty", () => {
    renderSidebar(["newsletter", "ads"]);
    expect(screen.getByTestId("newsletter")).toBeTruthy();
    expect(screen.getByTestId("ad-zone")).toBeTruthy();
  });

  it("KOLEJNOŚĆ widgetów pochodzi z ustawień", () => {
    const { container } = renderSidebar(["ads", "newsletter"]);
    const titles = Array.from(container.querySelectorAll("h2")).map((h) => h.textContent);
    expect(titles).toEqual([
      t("archiveLayout.sidebarTitles.ads"),
      t("archiveLayout.sidebarTitles.newsletter"),
    ]);
  });
});

describe("ArchivePostList i PaginatedPostGrid", () => {
  it("pusta lista pokazuje komunikat i akcję ratunkową", () => {
    render(
      <ArchivePostList
        posts={[]}
        lang="pl"
        emptyText="Nic nie znaleziono."
        emptyAction={<a href="/blog">Wróć do bloga</a>}
      />,
    );
    expect(screen.getByText("Nic nie znaleziono.")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Wróć do bloga" })).toBeTruthy();
  });

  it("zajawka może zostać nadpisana (np. fragmentem z wyszukiwarki)", () => {
    render(
      <ArchivePostList
        posts={posts(1)}
        lang="pl"
        emptyText=""
        getExcerptOverride={() => <mark>trafienie</mark>}
      />,
    );
    expect(screen.getByText("trafienie")).toBeTruthy();
  });

  it("siatka stronicowana chowa pasek stron przy jednej stronie", () => {
    const { unmount } = render(
      <PaginatedPostGrid
        posts={posts(2)}
        page={1}
        totalPages={1}
        lang="pl"
        emptyText=""
        isPending={false}
        onPageChange={() => {}}
        hrefFor={(p) => `/blog?page=${p}`}
      />,
    );
    expect(screen.queryByRole("navigation", { name: "Paginacja" })).toBeNull();
    unmount();

    render(
      <PaginatedPostGrid
        posts={posts(2)}
        page={2}
        totalPages={3}
        lang="pl"
        emptyText=""
        isPending={false}
        onPageChange={() => {}}
        hrefFor={(p) => (p > 1 ? `/blog?page=${p}` : "/blog")}
      />,
    );
    expect(screen.getByRole("link", { name: "Strona 3" })).toHaveAttribute("href", "/blog?page=3");
  });

  it("wariant PRZYCISKOWY (podgląd admina) też zmienia stronę", () => {
    // Bez `hrefFor` elementy są przyciskami - to jedyna ścieżka, którą ma
    // podgląd w panelu, więc jej zerwanie zamraża paginację w adminie.
    const onPageChange = vi.fn();
    render(
      <ArchivePagination
        page={1}
        totalPages={3}
        onPageChange={onPageChange}
        isPending={false}
        lang="pl"
        t={t}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Strona 2" }));
    expect(onPageChange).toHaveBeenCalledWith(2);
  });

  it("zmiana strony wraca na górę listy", () => {
    // Pozostanie w połowie ekranu po podmianie treści dezorientuje - czytelnik
    // ląduje w środku innego wpisu.
    const scrollSpy = vi.fn();
    const original = window.scrollTo;
    window.scrollTo = scrollSpy as unknown as typeof window.scrollTo;
    try {
      render(
        <PaginatedPostGrid
          posts={posts(2)}
          page={3}
          totalPages={5}
          lang="pl"
          emptyText=""
          isPending={false}
          onPageChange={() => {}}
          hrefFor={(p) => `/blog?page=${p}`}
        />,
      );
      expect(scrollSpy).toHaveBeenCalledWith(expect.objectContaining({ top: 0 }));
    } finally {
      window.scrollTo = original;
    }
  });

  it("pierwsza strona NIE przewija - czytelnik dopiero wszedł", () => {
    const scrollSpy = vi.fn();
    const original = window.scrollTo;
    window.scrollTo = scrollSpy as unknown as typeof window.scrollTo;
    try {
      render(
        <PaginatedPostGrid
          posts={posts(2)}
          page={1}
          totalPages={5}
          lang="pl"
          emptyText=""
          isPending={false}
          onPageChange={() => {}}
          hrefFor={(p) => `/blog?page=${p}`}
        />,
      );
      expect(scrollSpy).not.toHaveBeenCalled();
    } finally {
      window.scrollTo = original;
    }
  });

  it("klik w numer strony idzie przez nawigację SPA", () => {
    const onPageChange = vi.fn();
    render(
      <PaginatedPostGrid
        posts={posts(2)}
        page={1}
        totalPages={3}
        lang="pl"
        emptyText=""
        isPending={false}
        onPageChange={onPageChange}
        hrefFor={(p) => `/blog?page=${p}`}
      />,
    );
    fireEvent.click(screen.getByRole("link", { name: "Strona 2" }), { button: 0 });
    expect(onPageChange).toHaveBeenCalledWith(2);
  });
});

describe("ArchiveSkeleton", () => {
  it("rysuje zadaną liczbę kart-zastępników", () => {
    const { container } = render(<ArchiveSkeleton count={3} />);
    expect(container.querySelectorAll(".skeleton-shimmer").length).toBeGreaterThanOrEqual(3);
  });

  it("jest dekoracją: ukryty przed czytnikiem, bez elementów interaktywnych", () => {
    const { container } = render(<ArchiveSkeleton />);
    expect(container.firstElementChild).toHaveAttribute("aria-hidden", "true");
    expect(within(container).queryAllByRole("link")).toHaveLength(0);
  });
});

describe("sześć wariantów archiwum", () => {
  const ALL = [
    ["LayoutMinimal", variants.LayoutMinimal],
    ["LayoutClassic", variants.LayoutClassic],
    ["LayoutMagazine", variants.LayoutMagazine],
    ["LayoutHero", variants.LayoutHero],
    ["LayoutDark", variants.LayoutDark],
    ["LayoutBento", variants.LayoutBento],
  ] as const;

  it.each(ALL)("%s pokazuje nazwę taksonomii i wpisy", (_name, Layout) => {
    renderWithQuery(<Layout {...bodyProps({ posts: posts(6), total: 6 })} />);
    expect(screen.getByRole("heading", { name: "Gospodarka" })).toBeTruthy();
    // Każdy wariant ma pokazać KOMPLET wpisów - żaden nie ma prawa ich gubić.
    for (const p of posts(6)) {
      expect(screen.getAllByRole("link", { name: new RegExp(p.title_pl) }).length).toBeGreaterThan(
        0,
      );
    }
  });

  it.each(ALL)("%s bierze nazwę i opis z wersji językowej", (_name, Layout) => {
    renderWithQuery(<Layout {...bodyProps({ lang: "en", posts: posts(1), total: 1 })} />);
    expect(screen.getByRole("heading", { name: "Economy" })).toBeTruthy();
    expect(screen.getByText("Category description")).toBeTruthy();
  });

  it.each(ALL)("%s pokazuje komunikat pustej strony", (_name, Layout) => {
    renderWithQuery(<Layout {...bodyProps({ posts: [], total: 0 })} />);
    expect(screen.getByText("Brak wpisów w tej kategorii.")).toBeTruthy();
  });

  it("wariant Hero pokazuje licznik wpisów na stronie", () => {
    renderWithQuery(<variants.LayoutHero {...bodyProps({ posts: posts(4), total: 40 })} />);
    // Licznik dotyczy TEJ strony wyników, nie całego archiwum.
    expect(screen.getByText("Wpisy:").parentElement?.textContent).toContain("4");
  });

  it("wariant magazynowy dzieli wpisy na lead, kolumnę i siatkę - bez powtórek", () => {
    // Podział jest tu najbardziej podatny na błąd: lead + cztery karty obok +
    // reszta. Wpis policzony dwa razy albo pominięty to dokładnie ta klasa
    // pomyłki, po której „brakuje wpisów w archiwum".
    renderWithQuery(<variants.LayoutMagazine {...bodyProps({ posts: posts(7), total: 7 })} />);
    const names = screen.getAllByRole("link").map((a) => a.textContent ?? "");
    for (const p of posts(7)) {
      expect(names.filter((n) => n.includes(p.title_pl))).toHaveLength(1);
    }
    expect(names).toHaveLength(7);
  });

  it("wariant magazynowy z wyłączoną kartą wyróżnioną zsypuje wszystko do siatki", () => {
    renderWithQuery(
      <variants.LayoutMagazine
        {...bodyProps({
          posts: posts(6),
          total: 6,
          settings: settings({ show_featured_top: false }),
        })}
      />,
    );
    expect(screen.getAllByRole("link")).toHaveLength(6);
  });

  it("wariant ciemny osadza nagłówek w odwróconym motywie", () => {
    const { container } = renderWithQuery(
      <variants.LayoutDark {...bodyProps({ posts: posts(1), total: 1 })} />,
    );
    expect(container.querySelector(".dark")).not.toBeNull();
  });

  it("wariant bento przykleja nagłówek z boku listy", () => {
    const { container } = renderWithQuery(
      <variants.LayoutBento {...bodyProps({ posts: posts(1), total: 1 })} />,
    );
    expect(container.querySelector(".lg\\:sticky")).not.toBeNull();
  });

  it("taksonomia bez tłumaczenia nazwy schodzi na drugi język", () => {
    renderWithQuery(
      <variants.LayoutClassic
        {...bodyProps({
          lang: "en",
          posts: posts(1),
          total: 1,
          taxonomy: { ...taxonomy, name_en: "", description_en: null },
        })}
      />,
    );
    expect(screen.getByRole("heading", { name: "Gospodarka" })).toBeTruthy();
    expect(screen.getByText("Opis kategorii")).toBeTruthy();
  });
});
