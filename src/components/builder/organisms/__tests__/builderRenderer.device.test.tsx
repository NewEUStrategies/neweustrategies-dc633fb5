// PUBLICZNY RENDERER: ROZPOZNANIE URZĄDZENIA I UKŁAD RESPONSYWNY.
//
// ── CO TU MA DOWÓD ─────────────────────────────────────────────────────────
// * `deviceForWidth` na obu progach (768 i 1024) - od WEWNĘTRZNEJ strony każdej
//   granicy, bo pomylenie `<` z `<=` to klasyczny defekt o jeden piksel,
// * szerokość kontenera pochodzi z ResizeObserver bez synchronicznego
//   odczytu geometrii; przy braku obserwatora używamy window.innerWidth,
// * `ResizeObserver` - obecny (obserwacja kontenera) i NIEOBECNY (gałąź
//   `typeof ResizeObserver === "undefined"`, którą happy-dom wybiera domyślnie),
// * nasłuch `resize` na oknie,
// * `device` podane właściwością wygrywa z pomiarem (przełącznik podglądu
//   w panelu),
// * `resolveSpan` i `resolveOrder` - WSZYSTKIE ramiona rezerwy responsywnej,
//   w tym inna wartość domyślna kolumn sekcji (12) i kolumn sekcji
//   zagnieżdżonej (6),
// * `hiddenOnDevice` dla widgetów,
// * kolumny na telefonie (F13 z diagnozy P0.5, P2.2): inline `grid-template-
//   columns`/`grid-column` zostają DESKTOPOWE - układ jednej kolumny (i trzy
//   kolumny kart osób) narzucają reguły `!important` z `styles.css` dla
//   `[data-device="mobile"]` i `@media (max-width: 767px)`, więc przełączenie
//   desktop -> telefon po hydratacji nie przepisuje inline stylu ani jednej
//   kolumny (K16: 25 mutacji stylu i przeliczenie ~700 elementów na fixture),
// * wstrzyknięty `@media (max-width: 767px)` z kolejnością kolumn,
// * wyspy sekcji (P2.2): przełączenie urządzenia kończy się przed czekającą
//   wyspą (HTML serwera, bez renderu klienta), a po otwarciu treść wyspy idzie
//   za urządzeniem SWOJEGO renderera (lustro ze źródła renderera).
//
// ── CZEGO TU ŚWIADOMIE NIE MA ──────────────────────────────────────────────
// Korekta urządzenia siedzi w `useEffect`, więc synchroniczny `render()`
// z testing-library pokazuje już stan PO korekcie. Zamierzonego PIERWSZEGO
// renderu „desktop-first" (który chroni hydratację przed rozjazdem) tą drogą
// zobaczyć nie można - dowodzi go osobno `renderToString` w tym samym pliku.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, cleanup, fireEvent } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderWithQueryClient } from "@/test/renderWithQueryClient";
import { hydrateRoot, type Root } from "react-dom/client";
import "@/test/i18nReal";
import { __resetBuilderDebugForTests } from "@/lib/builder/builderDebug";
import { __resetFirstInteractionForTests } from "@/lib/performance/firstInteraction";
import { __resetPostInteractionQueueForTests } from "@/lib/performance/postInteractionQueue";
import { BuilderRenderer } from "../BuilderRenderer";
import {
  column,
  doc,
  hideOn,
  innerSection,
  section,
  setWindowWidth,
  simpleSection,
  stubClientWidth,
  stubObservers,
  widget,
} from "./builderRendererFixtures";

vi.mock(
  "@/components/builder/organisms/widget-view/lazyWidgets",
  () => import("@/test/eagerWidgetChunks"),
);

let observers: ReturnType<typeof stubObservers>;
let szerokoscPierwotna: number;

beforeEach(() => {
  observers = stubObservers();
  __resetBuilderDebugForTests();
  szerokoscPierwotna = window.innerWidth;
});

afterEach(() => {
  cleanup();
  observers.restore();
  setWindowWidth(szerokoscPierwotna);
  __resetBuilderDebugForTests();
});

const urzadzenie = (container: HTMLElement) =>
  container.querySelector("[data-builder-renderer]")?.getAttribute("data-device");

const slot = (container: HTMLElement, colId: string) =>
  container.querySelector<HTMLElement>(`[data-column-slot][data-col-id="${colId}"]`);

describe("progi szerokości (deviceForWidth)", () => {
  it.each([
    [320, "mobile"],
    [767, "mobile"],
    [768, "tablet"],
    [1023, "tablet"],
    [1024, "desktop"],
    [1920, "desktop"],
  ])("szerokość %i px daje urządzenie %s", (width, oczekiwane) => {
    setWindowWidth(width);
    const { container } = renderWithQueryClient(
      <BuilderRenderer doc={doc([simpleSection("a")])} lang="pl" />,
    );
    expect(urzadzenie(container)).toBe(oczekiwane);
  });
});

describe("źródło szerokości", () => {
  it("uses the observer result without synchronously reading clientWidth", () => {
    let report: ResizeObserverCallback | undefined;
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(callback: ResizeObserverCallback) {
          report = callback;
        }
        observe() {}
        disconnect() {}
      },
    );
    const geometry = vi.spyOn(HTMLElement.prototype, "clientWidth", "get");
    const viewportRead = vi.fn(() => 1600);
    Object.defineProperty(window, "innerWidth", { configurable: true, get: viewportRead });
    const { container, unmount } = renderWithQueryClient(
      <BuilderRenderer doc={doc([simpleSection("a")])} lang="pl" />,
    );
    expect(geometry).not.toHaveBeenCalled();
    expect(viewportRead).not.toHaveBeenCalled();
    const target = container.querySelector("[data-builder-renderer]")!;
    act(() => {
      report?.(
        [
          {
            target,
            contentRect: new DOMRect(0, 0, 390, 100),
            borderBoxSize: [{ inlineSize: 390, blockSize: 100 }],
            contentBoxSize: [{ inlineSize: 390, blockSize: 100 }],
            devicePixelContentBoxSize: [],
          },
        ],
        new ResizeObserver(() => {}),
      );
    });
    expect(urzadzenie(container)).toBe("mobile");
    expect(geometry).not.toHaveBeenCalled();
    expect(viewportRead).not.toHaveBeenCalled();
    unmount();
    geometry.mockRestore();
    vi.unstubAllGlobals();
  });

  it("szerokość KONTENERA wygrywa z oknem (ramka podglądu 390 px w panelu)", () => {
    setWindowWidth(1600);
    const restore = stubClientWidth(390);
    try {
      const { container } = renderWithQueryClient(
        <BuilderRenderer doc={doc([simpleSection("a")])} lang="pl" />,
      );
      expect(urzadzenie(container)).toBe("mobile");
    } finally {
      restore();
    }
  });

  it("zerowa szerokość kontenera zachowuje urządzenie SSR do obserwacji widocznego elementu", () => {
    setWindowWidth(1600);
    const restore = stubClientWidth(0);
    try {
      const { container } = renderWithQueryClient(
        <BuilderRenderer doc={doc([simpleSection("a")])} lang="pl" />,
      );
      expect(urzadzenie(container)).toBe("desktop");
    } finally {
      restore();
    }
  });

  it("właściwość `device` wygrywa z KAŻDYM pomiarem", () => {
    setWindowWidth(1600);
    const { container } = renderWithQueryClient(
      <BuilderRenderer doc={doc([simpleSection("a")])} lang="pl" device="mobile" />,
    );
    expect(urzadzenie(container)).toBe("mobile");
  });
});

describe("reakcja na zmianę rozmiaru", () => {
  it("ResizeObserver na kontenerze przelicza urządzenie", () => {
    setWindowWidth(1600);
    const { container } = renderWithQueryClient(
      <BuilderRenderer doc={doc([simpleSection("a")])} lang="pl" />,
    );
    expect(urzadzenie(container)).toBe("desktop");
    setWindowWidth(500);
    act(() => {
      observers.triggerResize();
    });
    expect(urzadzenie(container)).toBe("mobile");
  });

  it("bez obserwatora nasłuch resize na oknie przelicza urządzenie", () => {
    observers.restore();
    Reflect.deleteProperty(globalThis, "ResizeObserver");
    setWindowWidth(1600);
    const { container } = renderWithQueryClient(
      <BuilderRenderer doc={doc([simpleSection("a")])} lang="pl" />,
    );
    setWindowWidth(800);
    act(() => {
      fireEvent(window, new Event("resize"));
    });
    expect(urzadzenie(container)).toBe("tablet");
  });

  it("brak ResizeObserver w przeglądarce nie blokuje pierwszego pomiaru", () => {
    // To NIE jest hipoteza: happy-dom nie ma `ResizeObserver`, więc bez atrapy
    // z `stubObservers` ta gałąź jest tą, którą wykonuje cała reszta suity.
    observers.restore();
    Reflect.deleteProperty(globalThis, "ResizeObserver");
    setWindowWidth(500);
    const { container } = renderWithQueryClient(
      <BuilderRenderer doc={doc([simpleSection("a")])} lang="pl" />,
    );
    expect(urzadzenie(container)).toBe("mobile");
    // ...ale nasłuch okna działa dalej, więc obrót telefonu nadal łapiemy.
    setWindowWidth(1600);
    act(() => {
      fireEvent(window, new Event("resize"));
    });
    expect(urzadzenie(container)).toBe("desktop");
  });

  it("odmontowanie zdejmuje zapasowy nasłuch okna", () => {
    observers.restore();
    Reflect.deleteProperty(globalThis, "ResizeObserver");
    setWindowWidth(1600);
    const spyAdd = vi.spyOn(window, "addEventListener");
    const spyRemove = vi.spyOn(window, "removeEventListener");
    const { unmount } = renderWithQueryClient(
      <BuilderRenderer doc={doc([simpleSection("a")])} lang="pl" />,
    );
    expect(spyAdd.mock.calls.some(([type]) => type === "resize")).toBe(true);
    unmount();
    expect(spyRemove.mock.calls.some(([type]) => type === "resize")).toBe(true);
    spyAdd.mockRestore();
    spyRemove.mockRestore();
  });
});

describe("PIERWSZY render jest desktop-first (dowód przez renderToString)", () => {
  it("serwerowy render telefonu i tak emituje data-device=desktop", () => {
    // Determinizm pierwszego renderu to warunek hydratacji: gdyby klient policzył
    // „mobile" już w pierwszym przejściu, HTML z serwera i z przeglądarki byłyby
    // różne. `render()` z testing-library tego nie pokaże, bo korekta siedzi
    // w `useEffect` i wykonuje się przed powrotem z `render`.
    setWindowWidth(390);
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const html = renderToString(
      <QueryClientProvider client={qc}>
        <BuilderRenderer doc={doc([simpleSection("a")])} lang="pl" />
      </QueryClientProvider>,
    );
    expect(html).toContain('data-device="desktop"');
  });
});

describe("resolveSpan - rezerwa responsywna szerokości kolumn", () => {
  const kolumny = [
    column("k-pelna", [widget("w1")], { span: { desktop: 8, tablet: 6, mobile: 4 } }),
    column("k-bez-mobile", [widget("w2")], { span: { desktop: 3, tablet: 5 } }),
    column("k-tylko-desktop", [widget("w3")], { span: { desktop: 2 } }),
    column("k-bez-span", [widget("w4")], { span: undefined }),
  ];

  it("desktop bierze `desktop`, a brak wartości = 12", () => {
    const { container } = renderWithQueryClient(
      <BuilderRenderer doc={doc([section("s", kolumny)])} lang="pl" device="desktop" />,
    );
    expect(slot(container, "k-pelna")?.style.gridColumn).toBe("span 8");
    expect(slot(container, "k-bez-mobile")?.style.gridColumn).toBe("span 3");
    expect(slot(container, "k-tylko-desktop")?.style.gridColumn).toBe("span 2");
    expect(slot(container, "k-bez-span")?.style.gridColumn).toBe("span 12");
  });

  it("tablet bierze `tablet`, a bez niego spada na `desktop`", () => {
    const { container } = renderWithQueryClient(
      <BuilderRenderer doc={doc([section("s", kolumny)])} lang="pl" device="tablet" />,
    );
    expect(slot(container, "k-pelna")?.style.gridColumn).toBe("span 6");
    expect(slot(container, "k-bez-mobile")?.style.gridColumn).toBe("span 5");
    expect(slot(container, "k-tylko-desktop")?.style.gridColumn).toBe("span 2");
    expect(slot(container, "k-bez-span")?.style.gridColumn).toBe("span 12");
  });

  it("telefon: inline `grid-column` zostaje desktopowe (F13) - układ jednej kolumny narzuca CSS", () => {
    // `span.mobile` nigdy nie wygrywał na telefonie: `[data-device="mobile"]
    // [data-column-slot]{grid-column:1/-1!important}` (i `auto` dla kart osób).
    // Inline zostaje więc takie jak w HTML serwera (desktop) i przełączenie
    // urządzenia go nie przepisuje.
    const { container } = renderWithQueryClient(
      <BuilderRenderer doc={doc([section("s", kolumny)])} lang="pl" device="mobile" />,
    );
    expect(slot(container, "k-pelna")?.style.gridColumn).toBe("span 8");
    expect(slot(container, "k-bez-mobile")?.style.gridColumn).toBe("span 3");
    expect(slot(container, "k-tylko-desktop")?.style.gridColumn).toBe("span 2");
    expect(slot(container, "k-bez-span")?.style.gridColumn).toBe("span 12");
  });

  it("kolumny sekcji ZAGNIEŻDŻONEJ mają domyślny span 6, nie 12", () => {
    const { container } = renderWithQueryClient(
      <BuilderRenderer
        doc={doc([
          section("s", [
            innerSection("inner", [
              column("i-bez-span", [widget("iw1")], { span: undefined }),
              column("i-desktop", [widget("iw2")], { span: { desktop: 4 } }),
            ]),
          ]),
        ])}
        lang="pl"
        device="desktop"
      />,
    );
    const slots = [...container.querySelectorAll<HTMLElement>("[data-column-slot]")];
    const wewnetrzne = slots.filter((el) => !el.hasAttribute("data-col-id"));
    expect(wewnetrzne.map((el) => el.style.gridColumn)).toEqual(["span 6", "span 4"]);
  });
});

describe("resolveOrder - kolejność kolumn", () => {
  const kolumny = [
    column("o-pelna", [widget("w1")], {
      span: { desktop: 6 },
      order: { desktop: 2, tablet: 3, mobile: 1 },
    }),
    column("o-bez-tabletu", [widget("w2")], { span: { desktop: 6 }, order: { desktop: 5 } }),
    column("o-brak", [widget("w3")], { span: { desktop: 6 } }),
  ];

  it("desktop czyta `order.desktop`, brak `order` nie ustawia niczego", () => {
    const { container } = renderWithQueryClient(
      <BuilderRenderer doc={doc([section("s", kolumny)])} lang="pl" device="desktop" />,
    );
    expect(slot(container, "o-pelna")?.style.order).toBe("2");
    expect(slot(container, "o-bez-tabletu")?.style.order).toBe("5");
    expect(slot(container, "o-brak")?.style.order).toBe("");
  });

  it("tablet czyta `order.tablet`, a bez niego spada na `order.desktop`", () => {
    const { container } = renderWithQueryClient(
      <BuilderRenderer doc={doc([section("s", kolumny)])} lang="pl" device="tablet" />,
    );
    expect(slot(container, "o-pelna")?.style.order).toBe("3");
    expect(slot(container, "o-bez-tabletu")?.style.order).toBe("5");
  });

  it("telefon czyta WYŁĄCZNIE `order.mobile` - bez rezerwy z desktopu", () => {
    const { container } = renderWithQueryClient(
      <BuilderRenderer doc={doc([section("s", kolumny)])} lang="pl" device="mobile" />,
    );
    expect(slot(container, "o-pelna")?.style.order).toBe("1");
    // To jest reguła, nie przeoczenie: kolejność z desktopu na telefonie
    // przestawiałaby treść wbrew autorowi.
    expect(slot(container, "o-bez-tabletu")?.style.order).toBe("");
  });

  it("kolejność WYŁĄCZNIE mobilna nie ustawia `order` na tablecie ani na desktopie", () => {
    // Rezerwa działa tylko „w dół" hierarchii breakpointów: `mobile` NIE jest
    // źródłem dla tabletu ani desktopu, więc oba mają zostać bez `order`.
    const tylkoMobile = [
      column("o-mobile", [widget("w1")], { span: { desktop: 12 }, order: { mobile: 3 } }),
    ];
    const tablet = renderWithQueryClient(
      <BuilderRenderer doc={doc([section("s", tylkoMobile)])} lang="pl" device="tablet" />,
    );
    expect(slot(tablet.container, "o-mobile")?.style.order).toBe("");
    cleanup();
    const desktop = renderWithQueryClient(
      <BuilderRenderer doc={doc([section("s", tylkoMobile)])} lang="pl" device="desktop" />,
    );
    expect(slot(desktop.container, "o-mobile")?.style.order).toBe("");
  });

  it("kolejność mobilna jedzie DODATKOWO jako @media (max-width: 767px)", () => {
    const { container } = renderWithQueryClient(
      <BuilderRenderer doc={doc([section("s", kolumny)])} lang="pl" device="desktop" />,
    );
    const css = [...container.querySelectorAll("style")].map((s) => s.textContent).join("\n");
    expect(css).toContain("@media (max-width: 767px)");
    expect(css).toContain('[data-sec-id="s"] [data-col-id="o-pelna"]{order:1 !important;}');
    // Desktopowy porządek jest zerowany na telefonie już przed hydratacją.
    expect(css).toContain('[data-col-id="o-bez-tabletu"]{order:0 !important;}');
    // Kolumny bez żadnej kolejności nie wymagają reguły.
    expect(css).not.toContain('data-col-id="o-brak"');
  });

  it("bez ani jednej kolejności mobilnej sekcja nie wstrzykuje `<style>`", () => {
    const { container } = renderWithQueryClient(
      <BuilderRenderer
        doc={doc([section("s", [column("k", [widget("w")], { span: { desktop: 12 } })])])}
        lang="pl"
        device="desktop"
      />,
    );
    expect(container.querySelectorAll("style").length).toBe(0);
  });
});

describe("siatka kolumn na telefonie (F13: inline desktopowe, układ z CSS)", () => {
  it.each([
    [1, "repeat(2, minmax(0, 1fr))"],
    [3, "repeat(6, minmax(0, 1fr))"],
    [6, "repeat(12, minmax(0, 1fr))"],
  ])("%i kolumn po 2: na telefonie inline jak na desktopie - %s", (ile, oczekiwane) => {
    const kolumny = Array.from({ length: ile }, (_, i) =>
      column(`k${i}`, [widget(`w${i}`)], { span: { desktop: 2 } }),
    );
    const mobile = renderWithQueryClient(
      <BuilderRenderer doc={doc([section("s", kolumny)])} lang="pl" device="mobile" />,
    );
    const row = mobile.container.querySelector<HTMLElement>("[data-columns-row]");
    expect(row?.style.gridTemplateColumns).toBe(oczekiwane);
    cleanup();
    const desktop = renderWithQueryClient(
      <BuilderRenderer doc={doc([section("s", kolumny)])} lang="pl" device="desktop" />,
    );
    expect(
      desktop.container.querySelector<HTMLElement>("[data-columns-row]")?.style.gridTemplateColumns,
    ).toBe(oczekiwane);
  });

  it("sekcja bez kolumn nadal deklaruje siatkę (brak dzielenia przez zero)", () => {
    const { container } = renderWithQueryClient(
      <BuilderRenderer doc={doc([section("pusta", [])])} lang="pl" device="mobile" />,
    );
    const row = container.querySelector<HTMLElement>("[data-columns-row]");
    expect(row?.style.gridTemplateColumns).toBe("repeat(12, minmax(0, 1fr))");
  });

  it("na desktopie siatka trzyma sumę spanów, nie liczbę kolumn", () => {
    const { container } = renderWithQueryClient(
      <BuilderRenderer
        doc={doc([
          section("s", [
            column("a", [widget("w1")], { span: { desktop: 4 } }),
            column("b", [widget("w2")], { span: { desktop: 8 } }),
          ]),
        ])}
        lang="pl"
        device="desktop"
      />,
    );
    const row = container.querySelector<HTMLElement>("[data-columns-row]");
    expect(row?.style.gridTemplateColumns).toBe("repeat(12, minmax(0, 1fr))");
  });

  it("sekcja ZAGNIEŻDŻONA na telefonie: inline jak na desktopie (domyślny span 6)", () => {
    const { container } = renderWithQueryClient(
      <BuilderRenderer
        doc={doc([
          section("s", [
            innerSection("inner", [column("i1", [widget("iw1")]), column("i2", [widget("iw2")])]),
          ]),
        ])}
        lang="pl"
        device="mobile"
      />,
    );
    const wiersze = [...container.querySelectorAll<HTMLElement>("[data-columns-row]")];
    expect(wiersze).toHaveLength(2);
    expect(wiersze[1].style.gridTemplateColumns).toBe("repeat(24, minmax(0, 1fr))");
  });

  it("przełączenie desktop -> telefon (pomiar kontenera) nie przepisuje inline stylu wierszy ani kolumn (K16)", async () => {
    setWindowWidth(1280);
    const { container } = renderWithQueryClient(
      <BuilderRenderer
        doc={doc([
          section("s", [
            column("a", [widget("w1")], { span: { desktop: 4, mobile: 12 } }),
            column("b", [widget("w2")], { span: { desktop: 8 } }),
          ]),
          section("t", [innerSection("i", [column("i1"), column("i2")])]),
        ])}
        lang="pl"
      />,
    );
    expect(urzadzenie(container)).toBe("desktop");
    const grid = () =>
      [...container.querySelectorAll<HTMLElement>("[data-columns-row], [data-column-slot]")].map(
        (el) => el.getAttribute("style"),
      );
    const before = grid();
    const observer = new MutationObserver(() => {});
    observer.observe(container, { attributes: true, attributeFilter: ["style"], subtree: true });

    setWindowWidth(390);
    await act(async () => observers.triggerResize());
    const mutated = observer
      .takeRecords()
      .map((record) => record.target)
      .filter(
        (node): node is Element =>
          node instanceof Element && node.matches("[data-columns-row], [data-column-slot]"),
      );
    observer.disconnect();

    expect(urzadzenie(container)).toBe("mobile");
    expect(grid()).toEqual(before);
    expect(mutated).toEqual([]);
  });
});

describe("wyspy sekcji a urządzenie (P2.2)", () => {
  beforeEach(() => {
    __resetFirstInteractionForTests();
    __resetPostInteractionQueueForTests();
  });

  afterEach(() => {
    __resetPostInteractionQueueForTests();
    __resetFirstInteractionForTests();
    vi.unstubAllEnvs();
  });

  it("przełączenie desktop -> telefon kończy się przed czekającą wyspą (HTML serwera); po otwarciu treść wyspy idzie za urządzeniem renderera", async () => {
    setWindowWidth(1280);
    const dokument = doc([
      simpleSection("s0"),
      section("s1", [
        column("k1", [
          widget("tylko-desktop", "heading", { advanced: hideOn({ mobile: true }) }),
          widget("zawsze", "heading"),
        ]),
      ]),
    ]);
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const view = (
      <QueryClientProvider client={qc}>
        <BuilderRenderer doc={dokument} lang="pl" stream />
      </QueryClientProvider>
    );
    const container = document.createElement("div");
    vi.stubEnv("SSR", true);
    container.innerHTML = renderToString(view);
    vi.stubEnv("SSR", false);
    document.body.append(container);
    const serverOnlyDesktop = container.querySelector('[data-widget-id="tylko-desktop"]');
    expect(serverOnlyDesktop).not.toBeNull();
    const errors: unknown[] = [];
    let root!: Root;
    await act(async () => {
      root = hydrateRoot(container, view, { onRecoverableError: (error) => errors.push(error) });
    });
    const island = () => container.querySelector('[data-island-id="sec-s1"]');
    try {
      expect(island()?.getAttribute("data-island-state")).toBe("pending");

      setWindowWidth(390);
      await act(async () => observers.triggerResize());

      // Sekcja 0 (poza wyspą) jest już mobilna; wyspa nietknięta.
      expect(urzadzenie(container)).toBe("mobile");
      expect(island()?.getAttribute("data-island-state")).toBe("pending");
      expect(container.querySelector('[data-widget-id="tylko-desktop"]')).toBe(serverOnlyDesktop);

      // Dotknięcie we wnętrzu (tor pilny): hydratacja z urządzeniem serwera,
      // potem lustro przechodzi na urządzenie renderera.
      await act(async () => {
        container
          .querySelector('[data-widget-id="zawsze"]')
          ?.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
        await new Promise((resolve) => setTimeout(resolve, 30));
      });
      expect(island()?.getAttribute("data-island-state")).toBe("hydrated");
      expect(container.querySelector('[data-widget-id="tylko-desktop"]')).toBeNull();
      expect(container.querySelector('[data-widget-id="zawsze"]')).not.toBeNull();
      expect(errors).toEqual([]);
    } finally {
      await act(async () => root.unmount());
      qc.clear();
      container.remove();
    }
  });
});

describe("hiddenOnDevice - ukrywanie WIDGETU na urządzeniu", () => {
  const dokument = doc([
    section("s", [
      column("k", [
        widget("tylko-desktop", "heading", { advanced: hideOn({ mobile: true, tablet: true }) }),
        widget("nie-na-telefonie", "heading", { advanced: hideOn({ mobile: true }) }),
        widget("zawsze", "heading"),
      ]),
    ]),
  ]);

  it.each([
    ["desktop", ["tylko-desktop", "nie-na-telefonie", "zawsze"]],
    ["tablet", ["nie-na-telefonie", "zawsze"]],
    ["mobile", ["zawsze"]],
  ] as const)("na %s widoczne są dokładnie %j", (device, oczekiwane) => {
    const { container } = renderWithQueryClient(
      <BuilderRenderer doc={dokument} lang="pl" device={device} />,
    );
    const ids = [...container.querySelectorAll("[data-widget-id]")].map((el) =>
      el.getAttribute("data-widget-id"),
    );
    expect(ids).toEqual(oczekiwane);
  });

  it("`hideOn` z wartością false NIE ukrywa (pusty obiekt tym bardziej)", () => {
    const { container } = renderWithQueryClient(
      <BuilderRenderer
        doc={doc([
          section("s", [
            column("k", [
              widget("jawne-false", "heading", { advanced: hideOn({ mobile: false }) }),
              widget("pusty-hideon", "heading", { advanced: hideOn({}) }),
            ]),
          ]),
        ])}
        lang="pl"
        device="mobile"
      />,
    );
    expect(container.querySelectorAll("[data-widget-id]").length).toBe(2);
  });
});
