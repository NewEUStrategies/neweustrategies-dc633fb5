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
//   5. CYKL ŻYCIA TIMERÓW trybu `typewriter` - niezależnie od tego, czy
//      środowisko daje uchwyty-liczby (przeglądarka), czy uchwyty-obiekty
//      (Node). Do 2026-10-03 identyfikator interwału był doklejany do uchwytu
//      `setTimeout`; na liczbie w trybie ścisłym to `TypeError`, więc interwał
//      tykał po odmontowaniu. Testy szły w Node (obiekty) i niczego nie widziały
//      - stąd jawne atrapy timerów dla OBU kształtów uchwytu.
//   6. REZERWA = GEOMETRIA GOTOWEGO PASKA dla każdej skórki. Do 2026-10-03
//      rezerwa miała zawsze geometrię klasyczną (41 px), a skórki szklane są
//      wyższe - podmiana przesuwała stronę, a pomiar `--hdr-tt` z rezerwy
//      zamykał pasek w za niskim pudełku.
//   7. BRAMKA RUCHU (P3.5): porcje wpisów nie rotują przed pierwszą
//      interakcją albo punktem ciszy (punkt ciszy jest tu atrapą), a pierwsza
//      zmiana porcji przychodzi pełne `intervalSec` po otwarciu; każda
//      nieskończona animacja treści z HTML-a nosi znacznik pauzy bramki;
//      `typewriter` pisze wyłącznie tytuły montowane po otwarciu (pierwsza
//      porcja stoi w całości od HTML-a serwera).
import { describe, expect, it, afterEach, beforeEach, vi } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";
import "@/lib/i18n";
import { realT } from "@/test/i18nReal";
import {
  DEFAULT_TICKER_COLORS,
  LAYOUT_STYLES,
  LIVE_DIRECTIONS,
  isMarqueeLayout,
  type LayoutStyle,
  type LiveDirection,
} from "@/lib/views/tickerVariants";
import {
  HEADER_TICKER_BAND_CLASS,
  HEADER_TICKER_BORDER_CLASS,
  HEADER_TICKER_CARDS_BAND_CLASSES,
  HEADER_TICKER_MARQUEE_BAND_CLASS,
  HEADER_TICKER_TAPE_BAND_CLASS,
  TICKER_CARD_ROW_PX,
  TICKER_GLASS_PAD_PX,
  TICKER_GLASS_PILL_PX,
  TICKER_LAYOUT_FRAMES,
  tickerBandGeometry,
} from "@/components/header/headerGeometry";
import { signatureHeightPx, tickerHeightSignature } from "@/test/ticker/tickerGeometry";

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

// Punkt ciszy bramki ruchu tylko na żądanie testu (prawdziwy detektor otwiera
// bramkę po ~5 s fałszywego czasu).
vi.mock("@/lib/performance/whenQuiescent", () => ({ onQuiescent: () => () => {} }));

const { __openMotionGateForTests, __resetMotionGateForTests } =
  await import("@/lib/performance/motionGate");

const {
  TrendingTicker,
  TypewriterText,
  TYPEWRITER_STEP_MS,
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
  __resetMotionGateForTests();
});

afterEach(() => {
  cleanup();
  __resetMotionGateForTests();
});

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
  it("w trakcie pobierania TRZYMA swoje pudełko, ale bez treści", () => {
    // Pas z samą ikoną i pustym miejscem po wpisach wygląda jak awaria, więc
    // rezerwa jest PUSTA. Ale `null` też nie wchodzi w grę: pasek stoi nad
    // całą stroną, a montuje się dopiero z danymi - jego ~40 px doskakiwało po
    // hydratacji i spychało `<main>` w dół (0,03 CLS na artefakcie
    // produkcyjnym). Rezerwa ma DOKŁADNIE tę samą klasę wysokości i tę samą
    // krawędź, co gotowy pasek, więc podmiana nic nie przesuwa.
    feed.loading = true;
    const { container } = render(renderTicker());
    const rezerwa = screen.getByTestId("trending-ticker-reserve");
    expect(rezerwa).toHaveAttribute("aria-hidden", "true");
    expect(rezerwa.textContent).toBe("");
    expect(container.querySelector(`.${HEADER_TICKER_BAND_CLASS}`)).not.toBeNull();
    for (const cls of HEADER_TICKER_BORDER_CLASS.split(" "))
      expect(rezerwa.className).toContain(cls);
    // Gotowy pasek nosi to samo pudełko - stąd zerowe przesunięcie na podmianie.
    expect(rezerwa.className).toContain("cms-trending");
  });

  it("zero wpisów też nie zostawia pustego pasa", async () => {
    feed.posts = [];
    const { container } = render(renderTicker());
    await waitFor(() => expect(container).toBeEmptyDOMElement());
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

  it("tryb inny niż przewijanie rotuje partie wpisów dopiero po otwarciu bramki ruchu", async () => {
    vi.useFakeTimers();
    try {
      feed.posts = posts(4);
      render(renderTicker({ mode: "fade", visibleCount: 2, intervalSec: 2 }));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(50);
      });
      expect(screen.getByText("Wpis p1")).toBeTruthy();
      expect(screen.queryByText("Wpis p3")).toBeNull();

      // Bramka zamknięta: 30 s bez jednej zmiany porcji.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(30_000);
      });
      expect(screen.getByText("Wpis p1")).toBeTruthy();
      expect(screen.queryByText("Wpis p3")).toBeNull();

      // Pierwsza zmiana dokładnie pełny interwał po otwarciu.
      act(() => __openMotionGateForTests());
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1999);
      });
      expect(screen.queryByText("Wpis p3")).toBeNull();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1);
      });
      expect(screen.getByText("Wpis p3")).toBeTruthy();
      expect(screen.queryByText("Wpis p1")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("tryb maszyny do pisania: pierwsza porcja stoi w całości, pisze się porcja po otwarciu bramki", async () => {
    vi.useFakeTimers();
    try {
      feed.posts = posts(2);
      render(renderTicker({ mode: "typewriter", intervalSec: 2 }));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(50);
      });
      // Pełny tytuł od pierwszego renderu - pisanie po hydratacji byłoby
      // zmianą wizualną w oknie śladu (bramka ruchu, P3.5).
      const title = () =>
        (document.querySelector(".tt-caret")?.parentElement?.textContent ?? "").replace(/\|$/, "");
      expect(title()).toBe("Wpis p1");
      // Otwarcie bramki nie zaczyna pisać tytułu, który już stoi.
      act(() => __openMotionGateForTests());
      await act(async () => {
        await vi.advanceTimersByTimeAsync(500);
      });
      expect(title()).toBe("Wpis p1");

      // Kolejna porcja (pełny interwał po otwarciu) wypisuje się znak po znaku.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1500);
      });
      expect(title()).not.toBe("Wpis p2");
      expect("Wpis p2".startsWith(title())).toBe(true);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1000);
      });
      expect(title()).toBe("Wpis p2");
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
  it.each<[LayoutStyle, LiveDirection]>([
    ["glassMarquee", "vertical"],
    ["glassCards", "vertical"],
    ["glassLive", "vertical"],
    ["glassLive", "horizontal"],
  ])(
    "%s/%s: każda nieskończona animacja treści z HTML-a stoi do otwarcia bramki ruchu",
    async (layoutStyle, liveDirection) => {
      render(renderTicker({ layoutStyle, liveDirection, mode: "typewriter" }));
      await screen.findByTestId("trending-ticker");
      const looping = Array.from(document.querySelectorAll<HTMLElement>("[style]")).filter((el) =>
        /infinite/.test(el.style.animation),
      );
      expect(looping.length).toBeGreaterThan(0);
      for (const el of looping) expect(el.hasAttribute("data-motion-loop")).toBe(true);
    },
  );

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

  it("uses a small responsive avatar instead of the full storage original", async () => {
    const original = "https://project.supabase.co/storage/v1/object/public/media/avatar.png";
    feed.posts = [
      post({ id: "p1", author_display_name: "Anna Nowak", author_avatar_url: original }),
    ];
    const { container } = render(
      renderTicker({ layoutStyle: "glassLive", liveDirection: "horizontal" }),
    );
    await screen.findByTestId("trending-ticker");
    const image = container.querySelector(".tt-live-avatar");
    expect(image?.getAttribute("src")).toContain("/render/image/public/");
    expect(image?.getAttribute("src")).toContain("width=40");
    expect(image?.getAttribute("srcset")).toContain("3x");
    expect(container.querySelector(`img[src="${original}"]`)).toBeNull();
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

// ── TRYB `typewriter`: CYKL ŻYCIA TIMERÓW, NIEZALEŻNY OD ŚRODOWISKA ─────────

/**
 * Kształt uchwytu timera. `liczba` = przeglądarka i jsdom (`window.setTimeout`
 * zwraca number), `obiekt` = Node (`Timeout`) - ZWYKŁY, rozszerzalny obiekt,
 * dokładnie jak w Node. Właśnie ta różnica ukrywała błąd: na obiekcie
 * doklejenie `_iv` działa, na liczbie w trybie ścisłym rzuca `TypeError`.
 */
type HandleShape = "liczba" | "obiekt";

interface FakeClock {
  /** Przesuwa zegar, odpalając należne callbacki po kolei (w `act`). */
  advance(ms: number): void;
  /** Uchwyty utworzone przez `setTimeout` / `setInterval`, w kolejności. */
  readonly timeouts: unknown[];
  readonly intervals: unknown[];
  /** Uchwyty przekazane do `clearTimeout` / `clearInterval`, w kolejności. */
  readonly clearedTimeouts: unknown[];
  readonly clearedIntervals: unknown[];
  /**
   * Wyjątki rzucone z callbacków timerów. Przeglądarka nie przerywa na nich
   * pętli zdarzeń, tylko zgłasza je jako nieobsłużone - atrapa robi to samo,
   * a test sprawdza, że lista jest pusta.
   */
  readonly uncaught: unknown[];
  /** Ile callbacków timerów wykonało się do tej pory. */
  fired(): number;
  /** Ile timerów nadal czeka (nieodpalone timeouty + żywe interwały). */
  pending(): number;
}

/**
 * Atrapy `setTimeout`/`setInterval`/`clearTimeout`/`clearInterval` z jawnym
 * kształtem uchwytu. Własne, a nie `vi.useFakeTimers()`, bo fałszywe timery
 * vitesta w Node oddają obiekty - przypadku przeglądarkowego nie da się nimi
 * w ogóle odtworzyć.
 */
function installFakeClock(shape: HandleShape): FakeClock {
  interface Timer {
    readonly handle: unknown;
    readonly kind: "timeout" | "interval";
    readonly every: number;
    readonly fn: () => void;
    due: number;
  }
  const timers: Timer[] = [];
  let now = 0;
  let seq = 0;
  let fired = 0;
  const clock = {
    timeouts: [] as unknown[],
    intervals: [] as unknown[],
    clearedTimeouts: [] as unknown[],
    clearedIntervals: [] as unknown[],
    uncaught: [] as unknown[],
  };
  const schedule =
    (kind: Timer["kind"]) =>
    (fn: () => void, ms?: number): unknown => {
      seq += 1;
      const handle = shape === "liczba" ? seq : { fakeTimer: seq };
      const delay = typeof ms === "number" && ms > 0 ? ms : 0;
      timers.push({ handle, kind, every: Math.max(1, delay), fn, due: now + delay });
      (kind === "timeout" ? clock.timeouts : clock.intervals).push(handle);
      return handle;
    };
  const clear = (kind: Timer["kind"]) => (handle: unknown) => {
    (kind === "timeout" ? clock.clearedTimeouts : clock.clearedIntervals).push(handle);
    const index = timers.findIndex((timer) => timer.kind === kind && timer.handle === handle);
    if (index >= 0) timers.splice(index, 1);
  };
  // `window === globalThis` w tym środowisku, więc to są DOKŁADNIE te funkcje,
  // które woła komponent (`window.setTimeout`).
  vi.stubGlobal("setTimeout", schedule("timeout"));
  vi.stubGlobal("setInterval", schedule("interval"));
  vi.stubGlobal("clearTimeout", clear("timeout"));
  vi.stubGlobal("clearInterval", clear("interval"));

  return {
    ...clock,
    fired: () => fired,
    pending: () => timers.length,
    advance(ms: number) {
      const until = now + ms;
      for (;;) {
        const next = timers.filter((timer) => timer.due <= until).sort((a, b) => a.due - b.due)[0];
        if (!next) break;
        now = next.due;
        if (next.kind === "timeout") timers.splice(timers.indexOf(next), 1);
        else next.due += next.every;
        fired += 1;
        act(() => {
          try {
            next.fn();
          } catch (error) {
            clock.uncaught.push(error);
          }
        });
      }
      now = until;
    },
  };
}

/** Wypisany fragment tytułu (bez karetki `|`). */
function typed(container: HTMLElement): string {
  return (container.firstElementChild?.textContent ?? "").replace(/\|$/, "");
}

/** `prefers-reduced-motion` ustawione JAWNIE - wynik nie może zależeć od środowiska. */
function stubReducedMotion(reduce: boolean) {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: reduce && query === "(prefers-reduced-motion: reduce)",
    media: query,
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));
}

describe("TypewriterText - bramka ruchu", () => {
  it("serwer i montaż przed otwarciem: pełny tytuł i zero timerów, także po otwarciu", () => {
    expect(renderToString(<TypewriterText text="Abc" delayMs={90} />)).toContain("Abc");
    stubReducedMotion(false);
    const clock = installFakeClock("liczba");
    try {
      const { container } = render(<TypewriterText text="Abc" delayMs={90} />);
      expect(typed(container)).toBe("Abc");
      act(() => __openMotionGateForTests());
      clock.advance(1000);
      expect(typed(container)).toBe("Abc");
      expect(clock.timeouts).toHaveLength(0);
      expect(clock.intervals).toHaveLength(0);
    } finally {
      cleanup();
      vi.unstubAllGlobals();
    }
  });
});

describe.each<HandleShape>(["liczba", "obiekt"])(
  "TypewriterText - timery przy uchwycie typu %s",
  (shape) => {
    // Pisze się wyłącznie tytuł montowany po otwarciu bramki ruchu.
    beforeEach(() => {
      stubReducedMotion(false);
      __openMotionGateForTests();
    });
    afterEach(() => {
      // Najpierw odmontowanie (sprzątanie efektu trafia jeszcze w atrapy),
      // dopiero potem przywrócenie prawdziwych timerów.
      cleanup();
      vi.unstubAllGlobals();
    });

    it("wypisuje pełny tytuł po opóźnieniu, a interwał gaśnie na ostatnim znaku", () => {
      const clock = installFakeClock(shape);
      const { container } = render(<TypewriterText text="Abc" delayMs={90} />);
      expect(typed(container)).toBe("");
      expect(clock.timeouts).toHaveLength(1);
      expect(clock.intervals).toHaveLength(0);

      clock.advance(89);
      expect(clock.intervals).toHaveLength(0);
      clock.advance(1);
      expect(clock.intervals).toHaveLength(1);

      clock.advance(TYPEWRITER_STEP_MS);
      expect(typed(container)).toBe("A");
      clock.advance(2 * TYPEWRITER_STEP_MS);
      expect(typed(container)).toBe("Abc");
      // Pełny tytuł = koniec pracy: TEN interwał wyczyszczony, nic nie czeka.
      expect(clock.clearedIntervals).toEqual([clock.intervals[0]]);
      expect(clock.pending()).toBe(0);
      expect(clock.uncaught).toEqual([]);
      expect(container.querySelector(".tt-caret")).not.toBeNull();
    });

    it("odmontowanie w trakcie opóźnienia: interwał nigdy nie powstaje, nic nie tyka później", () => {
      const clock = installFakeClock(shape);
      const { unmount } = render(<TypewriterText text="Abc" delayMs={90} />);
      clock.advance(50);
      unmount();
      expect(clock.clearedTimeouts).toContain(clock.timeouts[0]);

      clock.advance(10_000);
      expect(clock.intervals).toHaveLength(0);
      expect(clock.fired()).toBe(0);
      expect(clock.pending()).toBe(0);
      expect(clock.uncaught).toEqual([]);
    });

    it("odmontowanie w trakcie pisania czyści DOKŁADNIE ten interwał i nic już nie tyka", () => {
      const clock = installFakeClock(shape);
      const { container, unmount } = render(<TypewriterText text="Abcdef" delayMs={90} />);
      clock.advance(90 + TYPEWRITER_STEP_MS);
      expect(typed(container)).toBe("A");
      expect(clock.uncaught).toEqual([]);

      const firedBefore = clock.fired();
      unmount();
      expect(clock.intervals).toHaveLength(1);
      expect(clock.clearedIntervals).toHaveLength(1);
      expect(clock.clearedIntervals[0]).toBe(clock.intervals[0]);

      clock.advance(1000);
      expect(clock.fired()).toBe(firedBefore);
      expect(clock.pending()).toBe(0);
      expect(clock.uncaught).toEqual([]);
    });

    it("zmiana tytułu w trakcie pisania: start od zera, stary interwał wyczyszczony", () => {
      const clock = installFakeClock(shape);
      const { container, rerender } = render(<TypewriterText text="Abcdef" delayMs={90} />);
      clock.advance(90 + 2 * TYPEWRITER_STEP_MS);
      expect(typed(container)).toBe("Ab");
      const stary = clock.intervals[0];

      rerender(<TypewriterText text="Xyz" delayMs={90} />);
      expect(clock.clearedIntervals).toEqual([stary]);
      expect(typed(container)).toBe("");

      // Do końca nowego opóźnienia nic nie pisze - stary interwał już nie żyje.
      clock.advance(89);
      expect(typed(container)).toBe("");
      expect(clock.intervals).toHaveLength(1);

      clock.advance(1 + 3 * TYPEWRITER_STEP_MS);
      expect(clock.intervals).toHaveLength(2);
      expect(typed(container)).toBe("Xyz");
      expect(clock.pending()).toBe(0);
      expect(clock.uncaught).toEqual([]);
    });

    it("pusty tytuł nie uruchamia żadnego timera", () => {
      const clock = installFakeClock(shape);
      const { container } = render(<TypewriterText text="" delayMs={90} />);
      expect(typed(container)).toBe("");
      expect(clock.timeouts).toHaveLength(0);
      expect(clock.intervals).toHaveLength(0);
    });

    it("prefers-reduced-motion: pełny tytuł od razu i zero timerów", () => {
      stubReducedMotion(true);
      const clock = installFakeClock(shape);
      const { container } = render(<TypewriterText text="Abc" delayMs={90} />);
      expect(typed(container)).toBe("Abc");
      expect(clock.timeouts).toHaveLength(0);
      expect(clock.intervals).toHaveLength(0);
      // Karetka zostaje - to element wyglądu trybu, nie animacja.
      expect(container.querySelector(".tt-caret")).not.toBeNull();
    });
  },
);

// ── REZERWA = GEOMETRIA GOTOWEGO PASKA, DLA KAŻDEJ SKÓRKI ──────────────────

/** Każda skórka, a `glassLive` w obu kierunkach (to dwa różne silniki). */
type Skin = { layoutStyle: LayoutStyle; liveDirection: LiveDirection };
const SKINS: Skin[] = LAYOUT_STYLES.flatMap((layoutStyle): Skin[] =>
  layoutStyle === "glassLive"
    ? LIVE_DIRECTIONS.map((liveDirection) => ({ layoutStyle, liveDirection }))
    : [{ layoutStyle, liveDirection: "vertical" }],
);

describe("rezerwa w trakcie ładowania = geometria gotowego paska", () => {
  it.each(LAYOUT_STYLES)("%s ma wpis w JEDNYM mapowaniu ramek", (layoutStyle) => {
    // Bez tego nowa skórka cicho dostałaby geometrię klasyczną - a ponieważ
    // rezerwa i pasek dostałyby ją OBIE, porównanie niżej by tego nie złapało.
    expect(Object.hasOwn(TICKER_LAYOUT_FRAMES, layoutStyle)).toBe(true);
    // Panel CMS ukrywa pokrętło `mode` dla skórek z własnym ruchem
    // (`isMarqueeLayout`) - silnik renderu ma się z tym zgadzać.
    const engine = tickerBandGeometry(layoutStyle).engine;
    expect(engine !== "band").toBe(isMarqueeLayout(layoutStyle));
  });

  it.each(SKINS.flatMap((skin) => [1, 3].map((visibleCount) => ({ ...skin, visibleCount }))))(
    "$layoutStyle ($liveDirection, visibleCount=$visibleCount): te same klasy wysokości",
    async ({ layoutStyle, liveDirection, visibleCount }) => {
      const props = { layoutStyle, liveDirection, visibleCount };
      feed.posts = posts(3);

      feed.loading = true;
      const loading = render(renderTicker(props));
      const rezerwa = tickerHeightSignature(screen.getByTestId("trending-ticker-reserve"));
      loading.unmount();

      feed.loading = false;
      render(renderTicker(props));
      const pasek = tickerHeightSignature(await screen.findByTestId("trending-ticker"));

      expect(rezerwa).toEqual(pasek);
      // Wysokość wynika WYŁĄCZNIE z krawędzi ramki i klasy pasa.
      expect(pasek.frame).toEqual([HEADER_TICKER_BORDER_CLASS]);
      expect(pasek.between).toEqual([]);
      expect(pasek.boxSiblings).toBe(0);
      const rows = Math.min(visibleCount, 3);
      const geometry = tickerBandGeometry(layoutStyle, { liveDirection, rows });
      expect(pasek.band).toEqual([geometry.bandClass]);
      expect(signatureHeightPx(pasek)).toBe(geometry.nominalPx);
    },
  );

  it("skórki szklane NIE dostają już rezerwy klasycznej (41 px)", () => {
    // Regresja wprost: przed poprawką rezerwa każdej skórki miała `h-10`.
    feed.loading = true;
    render(renderTicker({ layoutStyle: "glassMarquee" }));
    const rezerwa = tickerHeightSignature(screen.getByTestId("trending-ticker-reserve"));
    expect(rezerwa.band).toEqual([HEADER_TICKER_MARQUEE_BAND_CLASS]);
    expect(rezerwa.band).not.toContain(HEADER_TICKER_BAND_CLASS);
    expect(signatureHeightPx(rezerwa)).toBe(57);
  });

  it("bez danych pionowa rotacja rezerwuje pełne okno `visibleCount`", () => {
    // Liczba wpisów jest wtedy nieznana - to jedyna niewiadoma rezerwy.
    feed.loading = true;
    render(renderTicker({ layoutStyle: "glassCards", visibleCount: 3 }));
    const rezerwa = tickerHeightSignature(screen.getByTestId("trending-ticker-reserve"));
    expect(rezerwa.band).toEqual([HEADER_TICKER_CARDS_BAND_CLASSES[2]]);
  });

  it.each(LAYOUT_STYLES)("%s: zero wpisów = zero pasa (bez rezerwy)", async (layoutStyle) => {
    feed.posts = [];
    const { container } = render(renderTicker({ layoutStyle }));
    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });
});

describe("klasy wysokości skórek szklanych wynikają z arkusza paska", () => {
  it("oddech, pigułka, taśma i wiersz kart w arkuszu = liczby w mapowaniu", async () => {
    // Jawna wysokość na `.tt-glass` jest równa naturalnej tylko dopóty, dopóki
    // arkusz paska się nie zmieni. Ten test łączy oba końce: zmiana paddingu,
    // pigułki, krawędzi taśmy albo wiersza kart bez zmiany klasy oblewa tutaj,
    // zamiast przyciąć pasek albo zostawić pod nim pustą szczelinę.
    render(renderTicker({ layoutStyle: "glassTape" }));
    await screen.findByTestId("trending-ticker");
    const css = Array.from(document.querySelectorAll("style"))
      .map((style) => style.textContent ?? "")
      .join("\n");
    const liczba = (re: RegExp): number => {
      const match = re.exec(css);
      if (!match) throw new Error(`brak reguły ${re}`);
      return Number(match[1]);
    };
    const pad = liczba(/\.tt-glass \{[^}]*padding: (\d+)px 0/);
    const pill = liczba(/\.tt-glass-pill \{\s*height: (\d+)px/);
    const chip = liczba(/\.tt-glass-chip \{\s*height: (\d+)px/);
    const liveChip = liczba(/\.tt-skin--live \.tt-glass-chip \{[^}]*[^-]height: (\d+)px/);
    const row = liczba(/\.tt-glass--cards \.tt-glass-viewport \{\s*height: calc\((\d+)px \*/);
    const tapeTop = liczba(/\.tt-skin--tape \.tt-glass-track \{\s*border-top: (\d+)px/);
    const tapeBottom = liczba(/\.tt-skin--tape \.tt-glass-track \{[^}]*border-bottom: (\d+)px/);

    expect([pad, pill, row]).toEqual([
      TICKER_GLASS_PAD_PX,
      TICKER_GLASS_PILL_PX,
      TICKER_CARD_ROW_PX,
    ]);
    // Etykieta nie może być wyższa od pigułki - inaczej to ONA wyznaczałaby wysokość.
    expect(chip).toBeLessThanOrEqual(pill);
    expect(liveChip).toBeLessThanOrEqual(pill);
    // Żadna skórka nie nadpisuje wysokości pigułki.
    expect(css).not.toMatch(/\.tt-skin--\w+ \.tt-glass-pill[^{]*\{[^}]*[^-]height:/);
    // Taśma pigułek ma `py-2` = 2 x 0,5 rem, czyli część `+1rem` w klasie.
    const track = document.querySelector(".tt-glass-track > div");
    expect(track?.classList.contains("py-2")).toBe(true);

    expect(HEADER_TICKER_MARQUEE_BAND_CLASS).toBe(`h-[calc(${2 * pad + pill}px+1rem)]`);
    expect(HEADER_TICKER_TAPE_BAND_CLASS).toBe(
      `h-[calc(${2 * pad + pill + tapeTop + tapeBottom}px+1rem)]`,
    );
    HEADER_TICKER_CARDS_BAND_CLASSES.forEach((cls, index) =>
      expect(cls).toBe(`h-[${2 * pad + row * (index + 1)}px]`),
    );
  });
});
