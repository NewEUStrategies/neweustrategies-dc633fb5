// Pasek „Na czasie" w nagłówku. Do 18.08.2026: 0 z 34 funkcji, mimo że
// `tickerVariants.test.ts` istniał od dawna - tamten plik sprawdza WYŁĄCZNIE
// czysty moduł wariantów, więc komponent nie miał ani jednej wykonanej funkcji.
//
// Pasek jest renderowany na ścieżce KAŻDEJ strony i konfigurowalny przez
// administratora w sześciu układach na dwa silniki animacji. Rzeczy, których
// nie pilnuje nic innego:
//   1. pasek MILCZY, gdy nie ma czego pokazać (ładowanie, zero wpisów) -
//      pusty pas z samą ikoną wygląda jak awaria,
//   2. `rotate` z zapisanych ustawień to historyczna nazwa `slide` - bez tego
//      mapowania stary tenant dostaje pasek bez animacji,
//   3. identyfikator wariantu ląduje w selektorze CSS wstrzykiwanym przez
//      `dangerouslySetInnerHTML`,
//   4. etykieta ma zejście PL <-> EN, a w ostateczności idzie ze słownika.
import { describe, expect, it, afterEach, beforeEach, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";
import "@/lib/i18n";
import { realT } from "@/test/i18nReal";
import { DEFAULT_TICKER_COLORS } from "@/lib/views/tickerVariants";

interface TickerPost {
  id: string;
  slug?: string;
  href?: string;
  title_pl: string | null;
  title_en: string | null;
  author_display_name?: string | null;
  author_avatar_url?: string | null;
}

const feed = vi.hoisted(() => ({ posts: [] as TickerPost[], loading: false }));

vi.mock("@/lib/views/headerTickerQuery", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/views/headerTickerQuery")>()),
  headerTickerQueryOptions: () => ({
    queryKey: ["header-ticker", feed.posts.length, feed.loading],
    queryFn: () =>
      feed.loading ? new Promise<TickerPost[]>(() => {}) : Promise.resolve(feed.posts),
  }),
}));

const {
  TrendingTicker,
  normalizeMode,
  safeAttr,
  itemTitle,
  itemHref,
  authorInitials,
  buildVerticalKeyframes,
} = await import("@/components/header/TrendingTicker");

const t = realT("pl");

function post(over: Partial<TickerPost> & { id: string }): TickerPost {
  return {
    slug: over.id,
    title_pl: `Wpis ${over.id}`,
    title_en: `Post ${over.id}`,
    ...over,
  };
}

const posts = (n: number) => Array.from({ length: n }, (_, i) => post({ id: `p${i + 1}` }));

function renderTicker(props: Record<string, unknown> = {}): ReactElement {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0, staleTime: 0 } },
  });
  return (
    <QueryClientProvider client={client}>
      <TrendingTicker {...props} />
    </QueryClientProvider>
  );
}

beforeEach(() => {
  feed.posts = posts(3);
  feed.loading = false;
});

afterEach(cleanup);

describe("czyste reguły paska", () => {
  it("historyczny tryb `rotate` to ten sam ruch, co `slide`", () => {
    // Ustawienia tenantów zapisane przed zmianą nazwy nadal niosą „rotate".
    expect(normalizeMode("rotate")).toBe("slide");
    expect(normalizeMode("slide")).toBe("slide");
    expect(normalizeMode("scroll")).toBe("scroll");
    expect(normalizeMode("typewriter")).toBe("typewriter");
  });

  it("identyfikator wariantu jest oczyszczany przed wejściem do selektora CSS", () => {
    // Trafia do `[data-tt-vid="..."]` w arkuszu wstrzykiwanym przez
    // `dangerouslySetInnerHTML` - stąd biała lista znaków.
    expect(safeAttr("wariant-1_A")).toBe("wariant-1_A");
    expect(safeAttr('a"] { color: red } [x')).toBe("a_____color__red____x");
    expect(safeAttr('a"] { color: red } [x')).not.toContain('"');
    expect(safeAttr("")).toBe("default");
    expect(safeAttr("###")).toBe("___");
  });

  it("tytuł wpisu schodzi na drugi język, a bez obu jest pusty", () => {
    expect(itemTitle(post({ id: "a" }), "en")).toBe("Post a");
    expect(itemTitle({ id: "a", title_pl: "Tylko PL", title_en: null }, "en")).toBe("Tylko PL");
    expect(itemTitle({ id: "a", title_pl: null, title_en: "Only EN" }, "pl")).toBe("Only EN");
    expect(itemTitle({ id: "a", title_pl: null, title_en: null }, "pl")).toBe("");
  });

  it("adres wpisu: gotowy href, potem ścieżka ze slug, w ostateczności kotwica", () => {
    expect(itemHref({ id: "a", title_pl: null, title_en: null, href: "/wpis/x" })).toBe("/wpis/x");
    expect(itemHref({ id: "a", title_pl: null, title_en: null, slug: "y" })).toBe("/post/y");
    expect(itemHref({ id: "a", title_pl: null, title_en: null })).toBe("#");
  });

  it("inicjały autora biorą najwyżej dwa człony nazwiska", () => {
    expect(authorInitials("Anna Nowak")).toBe("AN");
    expect(authorInitials("Jan Maria Rokita")).toBe("JM");
    expect(authorInitials("Cher")).toBe("C");
    expect(authorInitials("   ")).toBe("");
  });

  it("klatki pionowej rotacji: przytrzymanie i przejście dla każdej pozycji", () => {
    const css = buildVerticalKeyframes(3, "tt-x");
    expect(css.startsWith("@keyframes tt-x{0%{")).toBe(true);
    // Trzy sloty = dwa kroki: dwa przytrzymania plus klatka końcowa.
    expect(css.match(/translate3d/g)?.length).toBe(4);
    expect(css.endsWith("}")).toBe(true);
  });

  it("mniej niż dwa sloty nie mają czego animować", () => {
    expect(buildVerticalKeyframes(1, "tt-x")).toBe("");
    expect(buildVerticalKeyframes(0, "tt-x")).toBe("");
  });

  it("liczba kroków nie może przekroczyć liczby slotów", () => {
    const css = buildVerticalKeyframes(2, "tt-x", 99);
    expect(css.match(/translate3d/g)?.length).toBe(3);
  });
});

describe("pasek milczy, gdy nie ma czego pokazać", () => {
  it("w trakcie pobierania NIE renderuje nic", () => {
    // Pas z samą ikoną i pustym miejscem po wpisach wygląda jak awaria.
    feed.loading = true;
    const { container } = render(renderTicker());
    expect(container).toBeEmptyDOMElement();
  });

  it("zero wpisów też nie zostawia pustego pasa", async () => {
    feed.posts = [];
    const { container } = render(renderTicker());
    await vi.waitFor(() => expect(container).toBeEmptyDOMElement());
  });
});

describe("układ klasyczny i plakietkowy", () => {
  it("pokazuje wpisy z numeracją i linkiem", async () => {
    render(renderTicker());
    expect(await screen.findByTestId("trending-ticker")).toBeTruthy();
    expect(screen.getByRole("link", { name: /Wpis p1/ })).toHaveAttribute("href", "/post/p1");
    // Numeracja od 01 - to jest wygląd „paska na czasie", nie ozdoba.
    expect(screen.getByText("01")).toBeTruthy();
  });

  it("etykieta domyślna idzie ZE SŁOWNIKA", async () => {
    render(renderTicker());
    expect(await screen.findByText(t("trendingTicker.badge"))).toBeTruthy();
  });

  it("własna etykieta administratora wygrywa, z zejściem na drugi język", async () => {
    const { unmount } = render(renderTicker({ labelPl: "Gorące", labelEn: "Hot" }));
    expect(await screen.findByText("Gorące")).toBeTruthy();
    unmount();

    // Brak wersji polskiej - wchodzi angielska, a nie pusta plakietka.
    render(renderTicker({ labelPl: "   ", labelEn: "Hot" }));
    expect(await screen.findByText("Hot")).toBeTruthy();
  });

  it("wariant plakietkowy oznacza się w DOM osobnym układem", async () => {
    render(renderTicker({ layoutStyle: "badge" }));
    const bar = await screen.findByTestId("trending-ticker");
    expect(bar).toHaveAttribute("data-tt-layout", "badge");
    expect(bar.className).toContain("cms-trending--badge");
  });

  it("identyfikator wariantu ląduje w atrybucie i w arkuszu palety", async () => {
    const { container } = render(renderTicker({ variantId: "wariant-2" }));
    const bar = await screen.findByTestId("trending-ticker");
    expect(bar).toHaveAttribute("data-tt-vid", "wariant-2");
    expect(container.innerHTML).toContain('[data-tt-vid="wariant-2"]');
  });

  it("paleta administratora trafia do zmiennych CSS", async () => {
    const { container } = render(
      renderTicker({
        colors: {
          ...DEFAULT_TICKER_COLORS,
          light: { ...DEFAULT_TICKER_COLORS.light, label: "#123456" },
        },
      }),
    );
    await screen.findByTestId("trending-ticker");
    expect(container.innerHTML).toContain("#123456");
  });

  it("tryb inny niż przewijanie rotuje partie wpisów w czasie", async () => {
    vi.useFakeTimers();
    try {
      feed.posts = posts(4);
      render(renderTicker({ mode: "fade", visibleCount: 2, intervalSec: 2 }));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(50);
      });
      expect(screen.getByText("Wpis p1")).toBeTruthy();
      expect(screen.queryByText("Wpis p3")).toBeNull();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(2000);
      });
      expect(screen.getByText("Wpis p3")).toBeTruthy();
      expect(screen.queryByText("Wpis p1")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("tryb maszyny do pisania wypisuje tytuł znak po znaku", async () => {
    vi.useFakeTimers();
    try {
      feed.posts = [post({ id: "p1" })];
      render(renderTicker({ mode: "typewriter" }));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(50);
      });
      // Po kilku klatkach widać początek tytułu, a nie jego całość naraz.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(66);
      });
      const caret = document.querySelector(".tt-caret");
      expect(caret).not.toBeNull();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1000);
      });
      expect(screen.getByText(/Wpis p1/)).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });

  it("tytuły idą za językiem interfejsu", async () => {
    const i18n = (await import("@/lib/i18n")).default;
    await act(async () => {
      await i18n.changeLanguage("en");
    });
    try {
      render(renderTicker());
      expect(await screen.findByRole("link", { name: /Post p1/ })).toBeTruthy();
    } finally {
      await act(async () => {
        await i18n.changeLanguage("pl");
      });
    }
  });
});

describe("układy szklane (marquee i pionowa rotacja)", () => {
  it("poziomy marquee DUBLUJE listę, a kopia jest ukryta przed czytnikiem", async () => {
    // Duplikat to technika pętli bez szwu; gdyby był widoczny dla czytnika
    // ekranu, każdy tytuł byłby czytany dwa razy.
    render(renderTicker({ layoutStyle: "glassMarquee" }));
    await screen.findByTestId("trending-ticker");
    const links = screen.getAllByRole("link");
    expect(links).toHaveLength(3);
    expect(document.querySelectorAll("a.tt-glass-pill")).toHaveLength(6);
    expect(document.querySelectorAll('a.tt-glass-pill[aria-hidden="true"]')).toHaveLength(3);
  });

  it("skin `live` pokazuje autora przy tytule", async () => {
    feed.posts = [post({ id: "p1", author_display_name: "Anna Nowak" })];
    render(renderTicker({ layoutStyle: "glassLive", liveDirection: "horizontal" }));
    await screen.findByTestId("trending-ticker");
    expect(screen.getAllByText("Anna Nowak").length).toBeGreaterThan(0);
    // Bez awatara wchodzą inicjały - autor MA być widoczny zawsze.
    expect(screen.getAllByText("AN").length).toBeGreaterThan(0);
  });

  it("autor z awatarem pokazuje obrazek zamiast inicjałów", async () => {
    feed.posts = [
      post({
        id: "p1",
        author_display_name: "Anna Nowak",
        author_avatar_url: "https://example.com/a.png",
      }),
    ];
    const { container } = render(
      renderTicker({ layoutStyle: "glassLive", liveDirection: "horizontal" }),
    );
    await screen.findByTestId("trending-ticker");
    expect(container.querySelector('img[src="https://example.com/a.png"]')).not.toBeNull();
    expect(screen.queryByText("AN")).toBeNull();
  });

  it("wpis bez autora nie zostawia pustego miejsca po nim", async () => {
    feed.posts = [post({ id: "p1" })];
    const { container } = render(
      renderTicker({ layoutStyle: "glassLive", liveDirection: "horizontal" }),
    );
    await screen.findByTestId("trending-ticker");
    expect(container.querySelector(".tt-live-author")).toBeNull();
  });

  it("układ kartowy jedzie silnikiem PIONOWYM, nie marquee", async () => {
    const { container } = render(renderTicker({ layoutStyle: "glassCards" }));
    const bar = await screen.findByTestId("trending-ticker");
    expect(bar).toHaveAttribute("data-tt-layout", "glassCards");
    expect(container.querySelector(".tt-glass--marquee")).toBeNull();
  });

  it("`glassLive` w orientacji pionowej też idzie silnikiem pionowym", async () => {
    const { container } = render(
      renderTicker({ layoutStyle: "glassLive", liveDirection: "vertical" }),
    );
    await screen.findByTestId("trending-ticker");
    expect(container.querySelector(".tt-glass--marquee")).toBeNull();
  });

  it("pasek pełnej szerokości nie ogranicza kontenera", async () => {
    const { container: full } = render(renderTicker({ fullWidth: true }));
    await screen.findByTestId("trending-ticker");
    expect(full.innerHTML).toContain("max-w-none");
    cleanup();

    const { container: boxed } = render(renderTicker({ fullWidth: false }));
    await screen.findByTestId("trending-ticker");
    expect(boxed.innerHTML).toContain("max-w-[1400px]");
  });
});
