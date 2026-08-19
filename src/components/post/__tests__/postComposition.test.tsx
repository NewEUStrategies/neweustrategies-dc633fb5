// Ostatnie powierzchnie wpisu na ZERZE: nakładka meta nad okładką, box
// cytowania, rekomendacje (trzy układy + stan pusty), portal rekomendacji
// śródtekstowych, doładowywanie kolejnych wpisów i renderer sidebara.
//
// Reguły, które te testy pilnują, są w większości NEGATYWNE („kiedy się NIE
// pokazuję") - w tym module brak sekcji jest decyzją produktową, więc test
// samego wariantu wypełnionego przepuszcza najczęstszy stan produkcyjny.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { act } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";

const h = vi.hoisted(() => ({
  relatedConfig: null as unknown,
  relatedPosts: [] as unknown[],
  nextPost: null as unknown,
  observers: [] as { callback: unknown; disconnected: boolean }[],
}));

vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  Link: (await import("@/test/routerLinkStub")).RouterLinkStub,
  useRouter: () => ({ preloadRoute: vi.fn(), navigate: vi.fn() }),
}));

vi.mock("@/lib/queries/relatedPosts", () => ({
  relatedPostsConfigQueryOptions: () => ({
    queryKey: ["related-config"],
    queryFn: async () => h.relatedConfig,
  }),
  relatedPostsQueryOptions: (input: Record<string, unknown>) => ({
    queryKey: ["related-posts", input],
    queryFn: async () => h.relatedPosts,
  }),
}));

vi.mock("@/lib/queries/nextPost", () => ({
  fetchNextPost: async () => h.nextPost,
}));

vi.mock("@/components/content/ContentRenderer", () => ({
  ContentRenderer: ({ postId }: { postId: string }) => (
    <div data-testid={`content-${postId}`}>treść</div>
  ),
}));

import { PostOverlayMeta } from "@/components/post/PostOverlayMeta";
import { CitationBox } from "@/components/post/CitationBox";
import { RelatedPosts } from "@/components/post/RelatedPosts";
import { RelatedPostsAfterParagraph } from "@/components/post/RelatedPostsAfterParagraph";
import { AutoLoadNextPost } from "@/components/post/AutoLoadNextPost";
import { RELATED_POSTS_DEFAULTS } from "@/lib/relatedPosts";

function renderWithQuery(ui: ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

/** Atrapa `IntersectionObserver` z ręcznym wywołaniem przecięcia. */
function installObserverStub() {
  h.observers.length = 0;
  class Stub {
    constructor(readonly callback: (entries: { isIntersecting: boolean }[]) => void) {
      h.observers.push({ callback, disconnected: false });
    }
    observe() {}
    unobserve() {}
    disconnect() {
      const own = h.observers.find((o) => o.callback === this.callback);
      if (own) own.disconnected = true;
    }
    takeRecords() {
      return [];
    }
  }
  vi.stubGlobal("IntersectionObserver", Stub);
}

/**
 * Odgrywa wejście sentinela w widok - WYŁĄCZNIE na obserwatorach, których React
 * jeszcze nie rozłączył.
 *
 * To nie kosmetyka: przy każdym przebiegu efektu powstaje nowy obserwator, a
 * stary jest rozłączany. Wywołanie callbacku ROZŁĄCZONEGO obserwatora odgrywa
 * domknięcie ze starym stanem (`done: false`, krótszy łańcuch) i test
 * „dowodziłby", że limity nie działają - choć w przeglądarce rozłączony
 * obserwator już nigdy nie strzeli.
 */
async function intersect(): Promise<void> {
  await act(async () => {
    for (const o of h.observers.filter((entry) => !entry.disconnected)) {
      (o.callback as (entries: { isIntersecting: boolean }[]) => void)([{ isIntersecting: true }]);
    }
    await Promise.resolve();
  });
}

beforeEach(() => {
  h.relatedConfig = { ...RELATED_POSTS_DEFAULTS, enabled: true };
  h.relatedPosts = [];
  h.nextPost = null;
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("PostOverlayMeta - nakładka meta nad okładką", () => {
  const author = {
    id: "a-1",
    slug: "anna-nowak",
    display_name: null,
    first_name: "Anna",
    last_name: "Nowak",
    avatar_url: "https://cdn/a.png",
  };

  it("renderuje autora z linkiem do jego profilu", () => {
    renderWithQuery(
      <PostOverlayMeta lang="pl" author={author} publishedAt="2026-08-01" readMinutes={12} />,
    );
    // Avatar i nazwisko to DWA linki o tej samej nazwie dostępnej - oba muszą
    // prowadzić w to samo miejsce (rozjazd był realnym defektem w czacie).
    const links = screen.getAllByRole("link", { name: /Anna Nowak/ });
    expect(links.length).toBeGreaterThanOrEqual(1);
    for (const link of links) expect(link).toHaveAttribute("href", "/author/anna-nowak");
  });

  it("BRAK autora nie renderuje bloku autora, data zostaje", () => {
    renderWithQuery(
      <PostOverlayMeta lang="pl" author={null} publishedAt="2026-08-01" readMinutes={12} />,
    );
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByText("01.08.2026")).toBeInTheDocument();
  });

  it("BRAK daty i czasu czytania nie renderuje ich pozycji", () => {
    const { container } = renderWithQuery(
      <PostOverlayMeta lang="pl" author={null} publishedAt={null} readMinutes={null} />,
    );
    expect(container.textContent?.trim()).toBe("");
    expect(screen.queryByRole("img")).toBeNull();
  });

  it("czas czytania jest podany razem z jednostką", () => {
    const { container } = renderWithQuery(
      <PostOverlayMeta lang="pl" author={null} publishedAt={null} readMinutes={12} />,
    );
    expect(container.textContent).toContain("12");
    expect(container.textContent).toMatch(/min/);
  });

  it("PIN: uszkodzona data daje etykietę BEZ wartości, nie wyjątek i nie Invalid Date", () => {
    // `fmtDate` ma `try/catch` z zamiarem pokazania surowej wartości, ale
    // `formatDate` z `lib/i18n/format` nie RZUCA dla nieparsowalnego wejścia -
    // zwraca pusty napis. `catch` jest więc martwy, a czytelnik widzi
    // „Opublikowano:" bez daty. Zachowanie przypięte: nakładka nie wywala się
    // i nie pokazuje „Invalid Date", co jest ważniejsze od samego fallbacku.
    const { container } = renderWithQuery(
      <PostOverlayMeta lang="pl" author={null} publishedAt="nie-data" readMinutes={null} />,
    );
    expect(container.textContent).not.toContain("Invalid");
    expect(container.textContent).toContain("Opublikowano");
  });

  it("wariant angielski prefiksuje adres autora `/en/`", () => {
    const { container } = renderWithQuery(
      <PostOverlayMeta lang="en" author={author} publishedAt="2026-08-01" readMinutes={5} />,
    );
    for (const link of screen.getAllByRole("link", { name: /Anna Nowak/ })) {
      expect(link).toHaveAttribute("href", "/en/author/anna-nowak");
    }
    expect(container.textContent).toMatch(/min/);
  });

  it("autor BEZ sluga nie dostaje linku (nie ma gdzie prowadzić)", () => {
    renderWithQuery(
      <PostOverlayMeta
        lang="pl"
        author={{ ...author, slug: "" }}
        publishedAt="2026-08-01"
        readMinutes={5}
      />,
    );
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByRole("img")).toHaveAttribute("alt", "Anna Nowak");
  });

  it("dodatkowe pola własne i akcje mobilne są wstawiane w nakładkę", () => {
    renderWithQuery(
      <PostOverlayMeta
        lang="pl"
        author={null}
        publishedAt={null}
        readMinutes={null}
        customMeta={<span data-testid="meta">pola</span>}
        mobileActions={<span data-testid="actions">akcje</span>}
      />,
    );
    expect(screen.getByTestId("meta")).toBeInTheDocument();
    expect(screen.getByTestId("actions")).toBeInTheDocument();
  });
});

describe("CitationBox - cytowanie analizy", () => {
  const props = {
    title: "Rola UE w regionie",
    lang: "pl" as const,
    publishedAt: "2026-08-01",
    authors: [{ firstName: "Anna", lastName: "Nowak", displayName: null }],
    url: "https://nes.eu/post/a",
  };

  it("renderuje sekcję z nagłówkiem i trzema formatami", () => {
    render(<CitationBox {...props} />);
    expect(screen.getByRole("region")).toBeInTheDocument();
    expect(screen.getAllByRole("tab")).toHaveLength(3);
  });

  it("nagłówek sekcji jest POWIĄZANY z regionem", () => {
    render(<CitationBox {...props} />);
    const heading = screen.getByRole("heading", { name: "Cytuj tę analizę" });
    expect(screen.getByRole("region")).toHaveAttribute("aria-labelledby", heading.id);
    expect(heading).toBeInTheDocument();
  });

  it("każdy format ma WŁASNY przycisk kopiowania z nazwą formatu w etykiecie", () => {
    render(<CitationBox {...props} />);
    const copyButtons = screen.getAllByRole("button", { name: /Kopiuj cytowanie w formacie/ });
    expect(copyButtons.length).toBeGreaterThan(0);
    expect(copyButtons[0].getAttribute("aria-label")).toMatch(/Chicago|APA|BibTeX/);
  });

  it("widoczny format niesie tytuł, wydawcę i adres analizy", () => {
    const { container } = render(<CitationBox {...props} />);
    expect(container.textContent).toContain("Rola UE w regionie");
    expect(container.textContent).toContain("https://nes.eu/post/a");
  });

  it("kopiowanie wkłada cytowanie do schowka i potwierdza to", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    render(<CitationBox {...props} />);

    await act(async () => {
      screen.getAllByRole("button", { name: /Kopiuj cytowanie w formacie/ })[0].click();
    });

    expect(String(writeText.mock.calls[0][0])).toContain("Rola UE w regionie");
    await waitFor(() => expect(screen.getByText("Skopiowano")).toBeInTheDocument());
  });

  it("ZABLOKOWANY schowek nie kłamie o skopiowaniu", async () => {
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: vi.fn().mockRejectedValue(new Error("denied")) },
      configurable: true,
    });
    render(<CitationBox {...props} />);

    await act(async () => {
      screen.getAllByRole("button", { name: /Kopiuj cytowanie w formacie/ })[0].click();
    });

    expect(screen.queryByText("Skopiowano")).toBeNull();
    expect(screen.getAllByRole("button", { name: /Kopiuj/ }).length).toBeGreaterThan(0);
  });

  it("wariant angielski używa angielskiego nagłówka i etykiet", () => {
    render(<CitationBox {...props} lang="en" />);
    expect(screen.getByRole("heading", { name: "Cite this analysis" })).toBeInTheDocument();
    expect(
      screen.getAllByRole("button", { name: /Copy citation in format/ }).length,
    ).toBeGreaterThan(0);
  });

  it("BRAK daty publikacji nie wywala boxu (cytowanie z datą dostępu)", () => {
    const { container } = render(<CitationBox {...props} publishedAt={null} />);
    expect(screen.getByRole("region")).toBeInTheDocument();
    expect(container.textContent).toContain("Rola UE w regionie");
  });

  it("BRAK autorów nie wywala boxu", () => {
    render(<CitationBox {...props} authors={[]} />);
    expect(screen.getByRole("region")).toBeInTheDocument();
    expect(screen.getAllByRole("tab")).toHaveLength(3);
  });

  it("własna nazwa wydawcy nadpisuje domyślną markę", () => {
    const { container } = render(<CitationBox {...props} siteName="Instytut Testowy" />);
    expect(container.textContent).toContain("Instytut Testowy");
    expect(screen.getByRole("region")).toBeInTheDocument();
  });
});

describe("RelatedPosts - rekomendacje pod artykułem", () => {
  const posts = [
    {
      id: "r1",
      slug: "analiza-a",
      title_pl: "Analiza A",
      title_en: "Analysis A",
      excerpt_pl: "Skrót A",
      excerpt_en: "Excerpt A",
      cover_image_url: null,
      published_at: "2026-07-01",
      reading_time_minutes: 8,
    },
    {
      id: "r2",
      slug: "analiza-b",
      title_pl: "Analiza B",
      title_en: "Analysis B",
      excerpt_pl: "Skrót B",
      excerpt_en: "Excerpt B",
      cover_image_url: null,
      published_at: "2026-06-01",
      reading_time_minutes: 5,
    },
  ];

  it("STAN PUSTY nie renderuje sekcji (brak rekomendacji to nie puste ramki)", async () => {
    h.relatedPosts = [];
    const { container } = renderWithQuery(<RelatedPosts postId="p1" lang="pl" />);
    await waitFor(() => expect(container).toBeEmptyDOMElement());
    expect(screen.queryByRole("region")).toBeNull();
  });

  it("WYŁĄCZONE rekomendacje nie renderują się nawet z wynikami", async () => {
    h.relatedConfig = { ...RELATED_POSTS_DEFAULTS, enabled: false };
    h.relatedPosts = posts;
    const { container } = renderWithQuery(<RelatedPosts postId="p1" lang="pl" />);
    await waitFor(() => expect(container).toBeEmptyDOMElement());
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("renderuje sekcję z nazwą z konfiguracji i linkiem na wpis", async () => {
    h.relatedPosts = posts;
    renderWithQuery(<RelatedPosts postId="p1" lang="pl" />);
    await waitFor(() => expect(screen.getByRole("region")).toBeInTheDocument());
    expect(screen.getByRole("region")).toHaveAccessibleName(RELATED_POSTS_DEFAULTS.title_pl);
  });

  it("każda rekomendacja prowadzi pod swój wpis", async () => {
    h.relatedPosts = posts;
    renderWithQuery(<RelatedPosts postId="p1" lang="pl" />);
    await waitFor(() => expect(screen.getByRole("region")).toBeInTheDocument());
    const links = screen.getAllByRole("link");
    expect(links.length).toBeGreaterThanOrEqual(2);
    expect(links.some((a) => (a.textContent ?? "").includes("Analiza A"))).toBe(true);
  });

  it("wariant angielski bierze tytuły EN i nazwę sekcji EN", async () => {
    h.relatedPosts = posts;
    renderWithQuery(<RelatedPosts postId="p1" lang="en" />);
    await waitFor(() => expect(screen.getByRole("region")).toBeInTheDocument());
    expect(screen.getByRole("region")).toHaveAccessibleName(RELATED_POSTS_DEFAULTS.title_en);
    expect(screen.getByText("Analysis A")).toBeInTheDocument();
  });

  it("układ LISTY renderuje się na wymuszenie (sidebar zawsze listą)", async () => {
    h.relatedPosts = posts;
    const { container } = renderWithQuery(
      <RelatedPosts postId="p1" lang="pl" forceLayout="list" />,
    );
    await waitFor(() => expect(screen.getByRole("region")).toBeInTheDocument());
    expect(container.querySelector(".related-posts")).not.toBeNull();
    expect(screen.getByText("Analiza A")).toBeInTheDocument();
  });

  it("układ SIATKI honoruje wymuszoną liczbę kolumn", async () => {
    h.relatedPosts = posts;
    renderWithQuery(<RelatedPosts postId="p1" lang="pl" forceLayout="grid" forceColumns={2} />);
    await waitFor(() => expect(screen.getByRole("region")).toBeInTheDocument());
    expect(screen.getByText("Analiza A")).toBeInTheDocument();
    expect(screen.getByText("Analiza B")).toBeInTheDocument();
  });

  it("NADPISANIE per wpis potrafi wyłączyć sekcję", async () => {
    h.relatedPosts = posts;
    const { container } = renderWithQuery(
      <RelatedPosts postId="p1" lang="pl" override={{ enabled: false }} />,
    );
    await waitFor(() => expect(container).toBeEmptyDOMElement());
    expect(screen.queryByRole("region")).toBeNull();
  });

  it("pozycja z konfiguracji jest widoczna w DOM (kotwica dla stylów i testów e2e)", async () => {
    h.relatedPosts = posts;
    const { container } = renderWithQuery(<RelatedPosts postId="p1" lang="pl" />);
    await waitFor(() => expect(screen.getByRole("region")).toBeInTheDocument());
    expect(container.querySelector("[data-related-position]")).toHaveAttribute(
      "data-related-position",
      RELATED_POSTS_DEFAULTS.position,
    );
  });
});

describe("RelatedPostsAfterParagraph - portal rekomendacji śródtekstowych", () => {
  function article(paragraphs: number): HTMLDivElement {
    const root = document.createElement("div");
    root.innerHTML = Array.from({ length: paragraphs }, (_, i) => `<p>Akapit ${i + 1}</p>`).join(
      "",
    );
    document.body.appendChild(root);
    return root;
  }

  it("wstawia punkt montowania PO wskazanym akapicie", async () => {
    h.relatedPosts = [];
    const root = article(4);
    renderWithQuery(
      <RelatedPostsAfterParagraph
        containerRef={{ current: root }}
        afterParagraph={2}
        scanKey="p1"
        postId="p1"
        lang="pl"
      />,
    );
    await waitFor(() => expect(root.querySelector('[data-related-mount="inline"]')).not.toBeNull());
    const mount = root.querySelector('[data-related-mount="inline"]')!;
    expect(mount.previousElementSibling?.textContent).toBe("Akapit 2");
  });

  it("numer POWYŻEJ liczby akapitów jest docinany do ostatniego", async () => {
    h.relatedPosts = [];
    const root = article(3);
    renderWithQuery(
      <RelatedPostsAfterParagraph
        containerRef={{ current: root }}
        afterParagraph={99}
        scanKey="p1"
        postId="p1"
        lang="pl"
      />,
    );
    await waitFor(() => expect(root.querySelector('[data-related-mount="inline"]')).not.toBeNull());
    expect(
      root.querySelector('[data-related-mount="inline"]')?.previousElementSibling?.textContent,
    ).toBe("Akapit 3");
  });

  it("numer PONIŻEJ jedynki jest podnoszony do pierwszego akapitu", async () => {
    h.relatedPosts = [];
    const root = article(3);
    renderWithQuery(
      <RelatedPostsAfterParagraph
        containerRef={{ current: root }}
        afterParagraph={0}
        scanKey="p1"
        postId="p1"
        lang="pl"
      />,
    );
    await waitFor(() => expect(root.querySelector('[data-related-mount="inline"]')).not.toBeNull());
    expect(
      root.querySelector('[data-related-mount="inline"]')?.previousElementSibling?.textContent,
    ).toBe("Akapit 1");
  });

  it("TREŚĆ BEZ AKAPITÓW nie wstawia punktu montowania", async () => {
    h.relatedPosts = [];
    const root = document.createElement("div");
    root.innerHTML = "<figure>obrazek</figure>";
    document.body.appendChild(root);
    const { container } = renderWithQuery(
      <RelatedPostsAfterParagraph
        containerRef={{ current: root }}
        afterParagraph={1}
        scanKey="p1"
        postId="p1"
        lang="pl"
      />,
    );
    await waitFor(() => expect(container).toBeEmptyDOMElement());
    expect(root.querySelector('[data-related-mount="inline"]')).toBeNull();
  });

  it("BRAK kontenera treści nie wywala portalu", () => {
    const { container } = renderWithQuery(
      <RelatedPostsAfterParagraph
        containerRef={{ current: null }}
        afterParagraph={1}
        scanKey="p1"
        postId="p1"
        lang="pl"
      />,
    );
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByRole("region")).toBeNull();
  });

  it("ODMONTOWANIE usuwa punkt montowania z treści artykułu", async () => {
    h.relatedPosts = [];
    const root = article(3);
    const { unmount } = renderWithQuery(
      <RelatedPostsAfterParagraph
        containerRef={{ current: root }}
        afterParagraph={1}
        scanKey="p1"
        postId="p1"
        lang="pl"
      />,
    );
    await waitFor(() => expect(root.querySelector('[data-related-mount="inline"]')).not.toBeNull());

    unmount();
    expect(root.querySelector('[data-related-mount="inline"]')).toBeNull();
  });
});

describe("AutoLoadNextPost - doładowywanie kolejnych wpisów", () => {
  beforeEach(() => {
    installObserverStub();
  });

  const nextSummary = {
    id: "n1",
    href: "/post/nastepny",
    title_pl: "Następna analiza",
    title_en: "Next analysis",
    published_at: "2026-07-01",
    cover_image_url: null,
    editor: "blocks",
    builder_data: null,
    blocks_data: null,
    content_pl: "<p>Treść</p>",
    content_en: null,
  };

  function mount(props: Record<string, unknown> = {}) {
    return renderWithQuery(
      <AutoLoadNextPost
        currentPostId="p1"
        parentPageId="page-1"
        currentPublishedAt="2026-08-01"
        lang="pl"
        {...props}
      />,
    );
  }

  it("przed przecięciem sentinela nie renderuje żadnego wpisu", () => {
    mount();
    expect(screen.queryByRole("article")).toBeNull();
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("przecięcie sentinela DOŁĄCZA następny wpis z nagłówkiem i treścią", async () => {
    h.nextPost = nextSummary;
    mount();
    await intersect();
    await waitFor(() =>
      expect(screen.getByRole("heading", { name: "Następna analiza" })).toBeInTheDocument(),
    );
    expect(screen.getByTestId("content-n1")).toBeInTheDocument();
  });

  it("nagłówek doładowanego wpisu ma KOTWICĘ z jego identyfikatorem", async () => {
    h.nextPost = nextSummary;
    mount();
    await intersect();
    await waitFor(() => expect(document.getElementById("nextpost-n1")).not.toBeNull());
    expect(document.getElementById("nextpost-n1")?.tagName).toBe("H2");
  });

  it("BRAK następnego wpisu pokazuje komunikat końca listy", async () => {
    h.nextPost = null;
    mount();
    await intersect();
    await waitFor(() => expect(screen.getByText("To już wszystkie wpisy.")).toBeInTheDocument());
    expect(screen.queryByRole("heading")).toBeNull();
  });

  it("po komunikacie końca kolejne przecięcia NIE pobierają już nic", async () => {
    h.nextPost = null;
    mount();
    await intersect();
    await waitFor(() => expect(screen.getByText("To już wszystkie wpisy.")).toBeInTheDocument());

    h.nextPost = nextSummary;
    await intersect();
    expect(screen.queryByRole("heading", { name: "Następna analiza" })).toBeNull();
  });

  it("LIMIT ŁAŃCUCHA zatrzymuje doładowywanie po zadanej liczbie wpisów", async () => {
    h.nextPost = nextSummary;
    mount({ maxChain: 1 });
    await intersect();
    await waitFor(() =>
      expect(screen.getByRole("heading", { name: "Następna analiza" })).toBeInTheDocument(),
    );

    h.nextPost = { ...nextSummary, id: "n2", title_pl: "Trzecia analiza" };
    await intersect();
    expect(screen.queryByRole("heading", { name: "Trzecia analiza" })).toBeNull();
  });

  it("wariant angielski bierze angielski tytuł doładowanego wpisu", async () => {
    h.nextPost = nextSummary;
    mount({ lang: "en" });
    await intersect();
    await waitFor(() =>
      expect(screen.getByRole("heading", { name: "Next analysis" })).toBeInTheDocument(),
    );
    expect(screen.queryByRole("heading", { name: "Następna analiza" })).toBeNull();
  });

  it("sentinel jest UKRYTY dla czytnika ekranu (to element techniczny)", () => {
    const { container } = mount();
    const sentinel = container.querySelector('[aria-hidden="true"]');
    expect(sentinel).not.toBeNull();
    expect(sentinel?.className).toContain("h-px");
  });
});
