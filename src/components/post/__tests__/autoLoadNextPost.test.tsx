// AutoLoadNextPost: pasek adresu i tytuł karty za wpisem, który czytelnik
// AKTUALNIE czyta, oraz treść i strażniki łańcucha doładowań.
//
// DEFEKT Z REJESTRU AUDYTU. Doładowanie kolejnego wpisu TRWALE podmieniało
// adres i `document.title` na ostatni doładowany wpis: po przewinięciu z
// powrotem do artykułu otwartego pasek dalej wskazywał doładowany (zły link
// przy udostępnianiu, zła kanoniczność, zła odsłona), a obserwowany był
// wyłącznie OSTATNI nagłówek łańcucha. Do tego podmiana szła przez
// `window.history.replaceState`, który TanStack Router podmienia na instancji
// i ogłasza jako nawigację - router ładował trasę doładowanego wpisu i
// podmieniał nim cały artykuł.
//
// Atrapa IntersectionObserver jest tu sterowana RĘCZNIE i rozróżnia dwa
// obserwatory po `rootMargin`: sentinel końca łańcucha i pas czytania. Callback
// rozłączonego obserwatora nigdy nie jest odgrywany - w przeglądarce już by
// nie strzelił (patrz `intersect()` w `postComposition.test.tsx`).
//
// Pas czytania odgrywa przeglądarkę wiernie: wpis ma położenie w oknie
// (`getBoundingClientRect`), a obserwator dostaje zgłoszenie TYLKO od wpisu,
// którego przecięcie z pasem się zmieniło. Skok znad pasa pod pas nie zmienia
// przecięcia - i nie daje zgłoszenia; łapie go dopiero zdarzenie `scroll`.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { act, type ReactElement } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createBrowserHistory } from "@tanstack/react-router";
import type { NextPostSummary } from "@/lib/queries/nextPost";
import { freezeClock } from "@/test/time";

const h = vi.hoisted(() => ({
  fetchNextPost: vi.fn(),
  trackPageView: vi.fn(),
}));

vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  Link: (await import("@/test/routerLinkStub")).RouterLinkStub,
  useRouter: () => ({ preloadRoute: vi.fn(), navigate: vi.fn() }),
}));

vi.mock("@/lib/queries/nextPost", () => ({ fetchNextPost: h.fetchNextPost }));
vi.mock("@/lib/analytics/track", () => ({ trackPageView: h.trackPageView }));
// Atrapa-sonda: pokazuje, CO doładowany wpis oddał silnikowi treści.
vi.mock("@/components/content/ContentRenderer", () => ({
  ContentRenderer: (props: {
    postId: string;
    html: string;
    blocksDoc: { meta?: Record<string, unknown> } | null;
    lcpOwner?: boolean;
  }) => (
    <div
      data-testid={`content-${props.postId}`}
      data-html={props.html}
      data-blocks-doc={String(props.blocksDoc?.meta?.tag ?? "")}
      data-lcp-owner={String(props.lcpOwner ?? true)}
    />
  ),
}));

import { AutoLoadNextPost } from "@/components/post/AutoLoadNextPost";

freezeClock();

const SENTINEL_MARGIN = "400px 0px";
const READING_BAND = "0px 0px -80% 0px";
const ORIGINAL_HREF = "/blog/otwarty-artykul";
const ORIGINAL_TITLE = "Otwarty artykuł | NES";
/** Stan wpisu historii, który zakłada TanStack Router. */
const ROUTER_STATE = { __TSR_index: 3, key: "k-otwarty", __TSR_key: "k-otwarty" };

function summary(id: string, slug: string, titlePl: string, titleEn: string): NextPostSummary {
  return {
    id,
    slug,
    editor: "blocks",
    title_pl: titlePl,
    title_en: titleEn,
    excerpt_pl: null,
    excerpt_en: null,
    cover_image_url: null,
    content_pl: "<p>Treść</p>",
    content_en: null,
    builder_data: null,
    blocks_data: null,
    published_at: "2026-07-01T10:00:00Z",
    parent_page_id: "page-1",
    href: `/blog/${slug}`,
  };
}

const N1 = summary("n1", "nastepny", "Następna analiza", "Next analysis");
const N2 = summary("n2", "trzeci", "Trzecia analiza", "Third analysis");

// ---------------------------------------------------------------------------
// Atrapa IntersectionObserver
// ---------------------------------------------------------------------------
const observers: FakeIntersectionObserver[] = [];

const ARTICLE_HEIGHT = 600;

function rect(top: number): DOMRect {
  return new DOMRect(0, top, 800, ARTICLE_HEIGHT);
}

/** Dół pasa czytania: górne 20% okna. */
function bandBottom(): number {
  return window.innerHeight * 0.2;
}

function entry(target: Element, isIntersecting: boolean, top: number): IntersectionObserverEntry {
  return {
    boundingClientRect: rect(top),
    intersectionRatio: isIntersecting ? 0.3 : 0,
    intersectionRect: rect(top),
    isIntersecting,
    rootBounds: new DOMRect(0, 0, 800, bandBottom()),
    target,
    time: 0,
  };
}

class FakeIntersectionObserver implements IntersectionObserver {
  readonly root: Element | null = null;
  readonly rootMargin: string;
  readonly scrollMargin: string = "";
  readonly thresholds: ReadonlyArray<number> = [0];
  readonly observed: Element[] = [];
  disconnected = false;
  private readonly callback: IntersectionObserverCallback;

  constructor(callback: IntersectionObserverCallback, options?: IntersectionObserverInit) {
    this.callback = callback;
    this.rootMargin = options?.rootMargin ?? "";
    observers.push(this);
  }

  observe(target: Element): void {
    this.observed.push(target);
  }

  unobserve(target: Element): void {
    const at = this.observed.indexOf(target);
    if (at >= 0) this.observed.splice(at, 1);
  }

  disconnect(): void {
    this.disconnected = true;
    this.observed.length = 0;
  }

  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }

  emit(entries: IntersectionObserverEntry[]): void {
    this.callback(entries, this);
  }
}

function live(margin: string): FakeIntersectionObserver[] {
  return observers.filter((o) => !o.disconnected && o.rootMargin === margin);
}

/** Jedyny żywy obserwator pasa czytania - dwa naraz to wyciek. */
function bandObserver(): FakeIntersectionObserver {
  const band = live(READING_BAND);
  if (band.length !== 1) throw new Error(`oczekiwany 1 obserwator pasa, jest ${band.length}`);
  return band[0];
}

function articleOf(postId: string): HTMLElement {
  const el = document.querySelector<HTMLElement>(`[data-next-post-id="${postId}"]`);
  if (!el) throw new Error(`brak doładowanego wpisu ${postId}`);
  return el;
}

/** Sentinel końca łańcucha wchodzi w widok - doładowanie następnego wpisu. */
async function reachEndOfChain(): Promise<void> {
  await act(async () => {
    for (const o of live(SENTINEL_MARGIN)) {
      o.emit(o.observed.map((target) => entry(target, true, 900)));
    }
    await Promise.resolve();
  });
}

type Position = "in-band" | "above-band" | "below-band";

/** Górna krawędź wpisu w oknie dla każdego położenia względem pasa. */
const TOP: Record<Position, number> = { "in-band": 120, "above-band": -1400, "below-band": 900 };

/** Bieżące położenie (górna krawędź) każdego doładowanego wpisu. */
const tops = new Map<Element, number>();

/** Przestawia wpis w oknie - BEZ zgłoszenia obserwatorowi i bez `scroll`. */
function moveTo(el: HTMLElement, top: number) {
  tops.set(el, top);
  return vi.spyOn(el, "getBoundingClientRect").mockReturnValue(rect(top));
}

function crossesBand(top: number): boolean {
  return top < bandBottom() && top + ARTICLE_HEIGHT > 0;
}

async function loadNext(post: NextPostSummary): Promise<void> {
  h.fetchNextPost.mockResolvedValueOnce(post);
  await reachEndOfChain();
  await waitFor(() => expect(document.getElementById(`nextpost-${post.id}`)).not.toBeNull());
  // Doładowany wpis wjeżdża pod sentinelem końca łańcucha - pod pasem czytania.
  moveTo(articleOf(post.id), TOP["below-band"]);
}

/**
 * Przesuwa wpisy (położenie albo górna krawędź w px) i odgrywa to, co
 * zgłosiłaby przeglądarka: tylko wpisy, których przecięcie z pasem się
 * zmieniło. Zwraca wpisy zgłoszone obserwatorowi pasa.
 */
function placeArticles(positions: Record<string, Position | number>): Element[] {
  const reported: IntersectionObserverEntry[] = [];
  for (const [postId, at] of Object.entries(positions)) {
    const el = articleOf(postId);
    const top = typeof at === "number" ? at : TOP[at];
    const before = crossesBand(tops.get(el) ?? TOP["below-band"]);
    moveTo(el, top);
    if (crossesBand(top) !== before) reported.push(entry(el, !before, top));
  }
  if (reported.length > 0) act(() => bandObserver().emit(reported));
  return reported.map((e) => e.target);
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

/** `count` zdarzeń `scroll` w jednej klatce, potem ta klatka. */
async function scrollWindow(count = 1): Promise<void> {
  await act(async () => {
    for (let i = 0; i < count; i++) window.dispatchEvent(new Event("scroll"));
    await nextFrame();
  });
}

function ui(props: { currentPostId?: string; lang?: "pl" | "en" } = {}): ReactElement {
  return (
    <AutoLoadNextPost
      currentPostId={props.currentPostId ?? "p1"}
      parentPageId="page-1"
      currentPublishedAt="2026-08-01T10:00:00Z"
      lang={props.lang ?? "pl"}
    />
  );
}

function mount(props: { currentPostId?: string; lang?: "pl" | "en" } = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(<QueryClientProvider client={queryClient}>{ui(props)}</QueryClientProvider>);
  return {
    ...view,
    rerenderWith: (next: { currentPostId?: string; lang?: "pl" | "en" }) =>
      view.rerender(<QueryClientProvider client={queryClient}>{ui(next)}</QueryClientProvider>),
  };
}

beforeEach(() => {
  observers.length = 0;
  tops.clear();
  vi.stubGlobal("IntersectionObserver", FakeIntersectionObserver);
  h.fetchNextPost.mockReset();
  h.trackPageView.mockReset();
  window.history.replaceState(ROUTER_STATE, "", ORIGINAL_HREF);
  document.title = ORIGINAL_TITLE;
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("AutoLoadNextPost - adres i tytuł karty za czytanym wpisem", () => {
  it("wejście doładowanego wpisu w pas czytania przepisuje adres i tytuł na ten wpis", async () => {
    mount();
    await loadNext(N1);
    // Samo doładowanie (wpis pod pasem) jeszcze NICZEGO nie przepisuje.
    expect(window.location.pathname).toBe(ORIGINAL_HREF);

    placeArticles({ n1: "in-band" });
    expect(window.location.pathname).toBe("/blog/nastepny");
    expect(document.title).toBe("Następna analiza");
  });

  it("powrót nad łańcuch PRZYWRACA adres i tytuł artykułu otwartego", async () => {
    mount();
    await loadNext(N1);
    placeArticles({ n1: "in-band" });
    expect(window.location.pathname).toBe("/blog/nastepny");

    placeArticles({ n1: "below-band" });
    expect(window.location.pathname).toBe(ORIGINAL_HREF);
    expect(document.title).toBe(ORIGINAL_TITLE);
  });

  it("obserwowany jest KAŻDY wpis łańcucha: powrót z trzeciego na drugi oddaje adres drugiego", async () => {
    mount();
    await loadNext(N1);
    await loadNext(N2);
    expect(bandObserver().observed).toEqual([articleOf("n1"), articleOf("n2")]);

    placeArticles({ n1: "above-band", n2: "in-band" });
    expect(window.location.pathname).toBe("/blog/trzeci");

    placeArticles({ n1: "in-band", n2: "below-band" });
    expect(window.location.pathname).toBe("/blog/nastepny");
    expect(document.title).toBe("Następna analiza");
  });

  it("przeczytany wpis (nad pasem) trzyma adres, dopóki pod nim nie zacznie się kolejny", async () => {
    mount();
    await loadNext(N1);
    placeArticles({ n1: "in-band" });

    // Czytelnik zjechał pod koniec wpisu - nad pasem, a niżej jest już tylko
    // sentinel i komunikat końca. To nadal TEN wpis, nie artykuł otwarty.
    placeArticles({ n1: "above-band" });
    expect(window.location.pathname).toBe("/blog/nastepny");
    expect(document.title).toBe("Następna analiza");
  });

  it("podmiana adresu NIE jest nawigacją routera: indeks historii zostaje, klucz przewinięcia jest własny", async () => {
    // Prawdziwa historia TanStack: łata `window.history.replaceState` na
    // instancji i ogłasza każde zewnętrzne wywołanie subskrybentom - router
    // zrobiłby z tego `router.load()` trasy doładowanego wpisu.
    const history = createBrowserHistory();
    const navigations = vi.fn();
    const unsubscribe = history.subscribe(navigations);
    try {
      mount();
      await loadNext(N1);
      placeArticles({ n1: "in-band" });

      expect(window.location.pathname).toBe("/blog/nastepny");
      expect(navigations).not.toHaveBeenCalled();
      // Z indeksu router liczy kierunek wstecz/naprzód - ten zostaje. Klucz
      // artykułu otwartego przywracałby po przeładowaniu samotnego wpisu
      // przewinięcie całej strony z łańcuchem, więc doładowany dostaje własny.
      const loaded: Record<string, unknown> = window.history.state;
      expect(loaded.__TSR_index).toBe(ROUTER_STATE.__TSR_index);
      expect(loaded.__TSR_key).not.toBe(ROUTER_STATE.__TSR_key);
      expect(loaded.key).toBe(loaded.__TSR_key);

      // Powrót nad łańcuch oddaje artykułowi otwartemu JEGO wpis z kluczem.
      placeArticles({ n1: "below-band" });
      expect(window.history.state).toEqual(ROUTER_STATE);
      expect(navigations).not.toHaveBeenCalled();
    } finally {
      unsubscribe();
      history.destroy();
    }
  });

  it("odmontowanie przywraca pierwotny adres i tytuł", async () => {
    const { unmount } = mount();
    await loadNext(N1);
    placeArticles({ n1: "in-band" });
    expect(document.title).toBe("Następna analiza");

    unmount();
    expect(window.location.pathname).toBe(ORIGINAL_HREF);
    expect(document.title).toBe(ORIGINAL_TITLE);
    expect(window.history.state).toEqual(ROUTER_STATE);
  });

  it("odmontowanie PO nawigacji na inną stronę nie cofa jej adresu ani tytułu", async () => {
    const { unmount } = mount();
    await loadNext(N1);
    placeArticles({ n1: "in-band" });

    window.history.pushState({ __TSR_index: 4, key: "k-inny", __TSR_key: "k-inny" }, "", "/o-nas");
    document.title = "O nas | NES";
    unmount();

    expect(window.location.pathname).toBe("/o-nas");
    expect(document.title).toBe("O nas | NES");
  });

  it("nowy wpis historii z TYM SAMYM adresem (klik w tytuł doładowanego) należy do nowej strony", async () => {
    const { unmount } = mount();
    await loadNext(N1);
    placeArticles({ n1: "in-band" });

    window.history.pushState(
      { __TSR_index: 4, key: "k-nastepny", __TSR_key: "k-nastepny" },
      "",
      "/blog/nastepny",
    );
    unmount();

    expect(window.location.pathname).toBe("/blog/nastepny");
    expect(document.title).toBe("Następna analiza");
  });

  it("odsłona w analityce: jedna na wpis, liczona POD adresem tego wpisu", async () => {
    const pathsAtTrack: string[] = [];
    h.trackPageView.mockImplementation(() => pathsAtTrack.push(window.location.pathname));
    mount();
    await loadNext(N1);

    placeArticles({ n1: "in-band" });
    placeArticles({ n1: "below-band" });
    placeArticles({ n1: "in-band" });

    expect(pathsAtTrack).toEqual(["/blog/nastepny"]);
    expect(h.trackPageView).toHaveBeenCalledWith(undefined, { source: "auto_load_next_post" });
  });

  it("wariant angielski pisze w karcie angielski tytuł doładowanego wpisu", async () => {
    mount({ lang: "en" });
    await loadNext(N1);
    placeArticles({ n1: "in-band" });
    expect(document.title).toBe("Next analysis");
    expect(window.location.pathname).toBe("/blog/nastepny");
  });

  it("bez wycieku obserwatorów: jeden pas na łańcuch, zero żywych po odmontowaniu", async () => {
    const { unmount } = mount();
    await loadNext(N1);
    await loadNext(N2);
    // Każde doładowanie zastępuje obserwatora pasa - poprzedni jest rozłączony.
    expect(live(READING_BAND)).toHaveLength(1);
    expect(observers.filter((o) => o.rootMargin === READING_BAND).length).toBeGreaterThan(1);

    unmount();
    expect(observers.filter((o) => !o.disconnected)).toEqual([]);
  });
});

describe("AutoLoadNextPost - skok bez przewijania (Home, „do góry” bez animacji, przypis)", () => {
  it("skok z trzeciego wpisu na górę: zgłoszony jest tylko wpis opuszczający pas, a adres wraca do artykułu otwartego", async () => {
    mount();
    await loadNext(N1);
    await loadNext(N2);
    // Czytelnik przewinął przez n1 do n2 - n1 wszedł w pas i wyszedł nad niego.
    placeArticles({ n1: "in-band" });
    expect(placeArticles({ n1: "above-band", n2: "in-band" })).toHaveLength(2);
    expect(window.location.pathname).toBe("/blog/trzeci");

    // n1 przeskakuje znad pasa pod pas, nie przecinając go - przeglądarka o nim milczy.
    expect(placeArticles({ n1: "below-band", n2: "below-band" })).toEqual([articleOf("n2")]);
    expect(window.location.pathname).toBe(ORIGINAL_HREF);
    expect(document.title).toBe(ORIGINAL_TITLE);
  });

  it("skok spod łańcucha (stopka) na górę: obserwator milczy, adres przywraca zdarzenie `scroll`", async () => {
    mount();
    await loadNext(N1);
    placeArticles({ n1: "in-band" });
    placeArticles({ n1: "above-band" });
    expect(window.location.pathname).toBe("/blog/nastepny");

    expect(placeArticles({ n1: "below-band" })).toEqual([]);
    await scrollWindow();
    expect(window.location.pathname).toBe(ORIGINAL_HREF);
    expect(document.title).toBe(ORIGINAL_TITLE);
  });

  it("seria zdarzeń `scroll` w jednej klatce: jeden odczyt geometrii na wpis", async () => {
    mount();
    await loadNext(N1);
    const geometry = moveTo(articleOf("n1"), TOP["in-band"]);
    geometry.mockClear();

    await scrollWindow(5);
    expect(geometry).toHaveBeenCalledTimes(1);
    expect(window.location.pathname).toBe("/blog/nastepny");
  });

  it("klatki bez zmiany czytanego wpisu nie piszą w historii (Safari: limit 100 zapisów na 10 s)", async () => {
    mount();
    await loadNext(N1);
    const writes = vi.spyOn(History.prototype, "replaceState");
    try {
      // Czytelnik w artykule otwartym, łańcuch pod pasem.
      await scrollWindow();
      expect(writes).not.toHaveBeenCalled();

      moveTo(articleOf("n1"), TOP["in-band"]);
      await scrollWindow();
      await scrollWindow();
      expect(writes).toHaveBeenCalledTimes(1);
      expect(window.location.pathname).toBe("/blog/nastepny");
    } finally {
      writes.mockRestore();
    }
  });

  it("wpis historii bez stanu (`null` z `TocWidget`): doładowany dostaje sam klucz, powrót oddaje `null`", async () => {
    window.history.replaceState(null, "", ORIGINAL_HREF);
    mount();
    await loadNext(N1);
    placeArticles({ n1: "in-band" });
    const loaded: Record<string, unknown> = window.history.state;
    expect(Object.keys(loaded).sort()).toEqual(["__TSR_key", "key"]);
    expect(loaded.key).toBe(loaded.__TSR_key);

    placeArticles({ n1: "below-band" });
    expect(window.history.state).toBeNull();
    expect(window.location.pathname).toBe(ORIGINAL_HREF);
  });

  it("odmontowanie zdejmuje nasłuch `scroll` i odwołuje zaplanowaną klatkę", async () => {
    const { unmount } = mount();
    await loadNext(N1);
    moveTo(articleOf("n1"), TOP["in-band"]);
    // Klatka zaplanowana przed odmontowaniem i zdarzenie już po nim.
    window.dispatchEvent(new Event("scroll"));
    unmount();
    await scrollWindow();

    expect(window.location.pathname).toBe(ORIGINAL_HREF);
    expect(document.title).toBe(ORIGINAL_TITLE);
    expect(h.trackPageView).not.toHaveBeenCalled();
  });
});

describe("AutoLoadNextPost - łańcuch należy do jednego artykułu otwartego", () => {
  it("nawigacja SPA na inny wpis zaczyna łańcuch od nowa, od NOWEGO kursora", async () => {
    const view = mount({ currentPostId: "p1" });
    await loadNext(N1);
    expect(screen.getByRole("heading", { name: "Następna analiza" })).toBeInTheDocument();

    // Czytelnik kliknął tytuł doładowanego wpisu - trasa `$` renderuje teraz n1.
    view.rerenderWith({ currentPostId: "n1" });
    expect(screen.queryByRole("heading", { name: "Następna analiza" })).toBeNull();

    await loadNext(N2);
    expect(h.fetchNextPost).toHaveBeenLastCalledWith(
      expect.objectContaining({ currentPostId: "n1" }),
    );
  });

  it("wpis spóźniony z poprzedniego artykułu nie dokleja się pod nowy", async () => {
    let resolveLate: (post: NextPostSummary) => void = () => undefined;
    h.fetchNextPost.mockReturnValueOnce(
      new Promise<NextPostSummary>((resolve) => {
        resolveLate = resolve;
      }),
    );
    const view = mount({ currentPostId: "p1" });
    await reachEndOfChain();
    expect(screen.getByRole("status")).toBeInTheDocument();

    view.rerenderWith({ currentPostId: "inny-wpis" });
    await act(async () => {
      resolveLate(N1);
      await Promise.resolve();
    });

    expect(document.getElementById("nextpost-n1")).toBeNull();
    expect(screen.queryByRole("heading", { name: "Następna analiza" })).toBeNull();
  });
});

describe("AutoLoadNextPost - strażnik podwójnego żądania i granica pasa czytania", () => {
  it("dwa przecięcia sentinela przed odpowiedzią dają JEDNO żądanie", async () => {
    h.fetchNextPost.mockReturnValue(new Promise<never>(() => undefined));
    mount();
    await reachEndOfChain();
    await reachEndOfChain();

    expect(h.fetchNextPost).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("status")).toHaveTextContent("Ładuję następny wpis...");
  });

  it("pas czytania to górne 20% okna: wpis jest czytany, gdy jego góra minie tę linię", async () => {
    mount();
    await loadNext(N1);
    placeArticles({ n1: bandBottom() - 1 });
    expect(window.location.pathname).toBe("/blog/nastepny");

    placeArticles({ n1: bandBottom() + 1 });
    expect(window.location.pathname).toBe(ORIGINAL_HREF);
  });
});

describe("AutoLoadNextPost - treść doładowanego wpisu", () => {
  it("brak tytułu w języku strony: nagłówek i karta biorą tytuł z drugiego języka", async () => {
    mount({ lang: "en" });
    await loadNext({ ...N1, title_en: "" });
    expect(screen.getByRole("heading", { name: "Następna analiza" })).toBeInTheDocument();

    cleanup();
    mount({ lang: "pl" });
    await loadNext({ ...N2, title_pl: "" });
    expect(screen.getByRole("heading", { name: "Third analysis" })).toBeInTheDocument();
  });

  it("dokument blokowy w języku strony, a bez niego - polski, potem angielski", async () => {
    const pl = { version: 1, blocks: [], meta: { tag: "pl" } };
    const en = { version: 1, blocks: [], meta: { tag: "en" } };
    mount({ lang: "en" });
    await loadNext({ ...N1, blocks_data: { pl, en } });
    await loadNext({ ...N2, blocks_data: { pl } });
    expect(screen.getByTestId("content-n1")).toHaveAttribute("data-blocks-doc", "en");
    expect(screen.getByTestId("content-n2")).toHaveAttribute("data-blocks-doc", "pl");

    cleanup();
    mount({ lang: "pl" });
    await loadNext({ ...N1, blocks_data: { en } });
    expect(screen.getByTestId("content-n1")).toHaveAttribute("data-blocks-doc", "en");
  });

  it("HTML w języku strony, z drugim językiem jako zapasem, a bez obu - pusty", async () => {
    mount({ lang: "pl" });
    await loadNext({ ...N1, content_pl: null, content_en: "<p>Body</p>" });
    await loadNext({ ...N2, content_pl: null, content_en: null });
    expect(screen.getByTestId("content-n1")).toHaveAttribute("data-html", "<p>Body</p>");
    expect(screen.getByTestId("content-n2")).toHaveAttribute("data-html", "");
  });

  it("doładowany wpis NIE jest właścicielem kandydata LCP (P1.4: jeden znacznik na stronę)", async () => {
    mount();
    await loadNext(N1);
    expect(screen.getByTestId("content-n1")).toHaveAttribute("data-lcp-owner", "false");
  });

  it("okładka doładowanego wpisu ma tytuł jako tekst alternatywny", async () => {
    mount();
    await loadNext({ ...N1, cover_image_url: "https://cdn.nes/okladka.jpg" });
    const cover = articleOf("n1").querySelector("img");
    expect(cover).toHaveAttribute("alt", "Następna analiza");
    expect(cover?.getAttribute("src")).toContain("okladka.jpg");
  });
});
