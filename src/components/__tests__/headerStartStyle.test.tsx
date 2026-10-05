// Header: start bez przeliczenia stylu dokumentu (P1.2, F2/F2b). Montaż nie
// zapisuje `--sticky-header-h` na <html>, gdy zmierzona wysokość równa się
// domyślnej z CSS (różnica < 2 px), nie przełącza `data-settled` i nie
// przerenderowuje chrome'u przy zwijaniu - każdy taki zapis wymuszał przeliczenie
// stylu całego dokumentu w oknie TBT (zadanie K13 z diagnozy P0.5).
// Testy wydzielone przy scaleniu main (PR #475 usunął dawny Header.test.tsx
// razem z testami prezentacyjnymi); atrapy i sterowane klatki jak w tamtym pliku.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import type { ReactElement, ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { BuilderDocument, SectionNode } from "@/lib/builder/types";
import type { AdPageType } from "@/lib/ads/types";
import type { ContentKind } from "@/lib/layout/headerMode";

type Lang = "pl" | "en";

/** Stan atrap trzymany tak, jak w całym repo - hoistowany obiekt. */
const h = vi.hoisted(() => ({
  /** Prawdziwy `getFixedT(lang)`, wstrzykiwany poniżej (fabryka nic nie importuje). */
  t: null as null | ((lang: "pl" | "en") => unknown),
  lang: "pl" as "pl" | "en",
  pathname: "/",
  /** Wymuszenia renderu zarejestrowane przez atrapę `useRouterState`. */
  subscribers: new Set<() => void>(),
  navigations: [] as string[],
  preloads: [] as string[],
  languageChanges: [] as string[],
  clientLangWrites: [] as string[],
  /** Rendery atrapy paska "na czasie" - dowód bramki `memo` na `HeaderInner`. */
  tickerRenders: 0,
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: h.t?.(h.lang),
    i18n: {
      language: h.lang,
      changeLanguage: (next: string) => {
        h.languageChanges.push(next);
        return Promise.resolve();
      },
      on: () => {},
      off: () => {},
    },
    ready: true,
  }),
  initReactI18next: { type: "3rdParty" as const, init: () => {} },
}));

vi.mock("@/lib/i18n/localeRuntime", () => ({
  currentLang: () => h.lang,
  setClientLang: (next: string) => {
    h.clientLangWrites.push(next);
  },
}));

vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-router")>();
  const { useEffect, useReducer } = await import("react");
  type RouterStateLike = { location: { pathname: string }; matches: unknown[] };
  return {
    ...actual,
    useRouterState: <T,>({ select }: { select: (state: RouterStateLike) => T }): T => {
      const [, force] = useReducer((n: number) => n + 1, 0);
      useEffect(() => {
        h.subscribers.add(force);
        return () => {
          h.subscribers.delete(force);
        };
      }, [force]);
      return select({ location: { pathname: h.pathname }, matches: [] });
    },
    useRouter: () => ({
      state: { location: { pathname: h.pathname } },
      navigate: (opts: { href?: string }) => {
        h.navigations.push(String(opts.href));
        return Promise.resolve();
      },
      preloadRoute: (opts: { href?: string }) => {
        h.preloads.push(String(opts.href));
        return Promise.resolve();
      },
    }),
  };
});

vi.mock("@/components/builder/organisms/BuilderRenderer", () => ({
  BuilderRenderer: ({
    doc,
    lang,
    device,
  }: {
    doc: BuilderDocument;
    lang: string;
    device?: string;
  }) => (
    <div
      data-testid="builder"
      data-lang={lang}
      data-device={device ?? "auto"}
      data-sections={String(doc.sections.length)}
    />
  ),
}));

vi.mock("@/components/header/TrendingTicker", () => ({
  TrendingTicker: (props: {
    source: string;
    mode: string;
    layoutStyle: string;
    days: number;
    limit: number;
    fullWidth: boolean;
    labelPl?: string;
  }) => {
    h.tickerRenders += 1;
    return (
      <div
        className="cms-trending"
        data-testid="ticker"
        data-source={props.source}
        data-mode={props.mode}
        data-layout={props.layoutStyle}
        data-days={String(props.days)}
        data-limit={String(props.limit)}
        data-full-width={String(props.fullWidth)}
        data-label-pl={props.labelPl ?? ""}
      />
    );
  },
}));

vi.mock("@/components/header/mobile/MobileDrawerBody", () => ({
  MobileDrawerBody: ({
    builderDoc,
    onNavigate,
  }: {
    builderDoc: BuilderDocument;
    onNavigate: () => void;
  }) => (
    <div data-testid="drawer-body" data-sections={String(builderDoc.sections.length)}>
      <button type="button" onClick={onNavigate}>
        pozycja menu
      </button>
    </div>
  ),
}));

vi.mock("@/components/AdSlot", () => ({
  AdZone: ({
    position,
    pageType,
    className,
  }: {
    position: string;
    pageType?: string;
    className?: string;
  }) => (
    <div
      data-testid="ad-zone"
      data-position={position}
      data-page-type={String(pageType)}
      className={className}
    />
  ),
}));

vi.mock("@/components/SearchOverlay", () => ({
  SearchOverlay: ({
    open,
    onClose,
    heading,
    lang,
    limit,
    mode,
  }: {
    open: boolean;
    onClose: () => void;
    heading: string;
    lang: string;
    limit: number;
    mode: string;
  }) => (
    <div
      data-testid="search-overlay"
      data-open={String(open)}
      data-lang={lang}
      data-limit={String(limit)}
      data-mode={mode}
    >
      <span>{heading}</span>
      <button type="button" onClick={onClose}>
        zamknij wyszukiwarkę
      </button>
    </div>
  ),
}));

import { realT } from "@/test/i18nReal";
import { siteSettingsQueryOptions } from "@/lib/useSiteSetting";
import { ThemeProvider } from "@/components/ThemeProvider";
import { clearTickerDraft } from "@/lib/views/tickerDraftBridge";
import { Header } from "@/components/Header";

h.t = (lang: Lang) => realT(lang);

const section = (id: string): SectionNode => ({ id, kind: "section", children: [] });

const doc = (count: number): BuilderDocument => ({
  version: 1,
  sections: Array.from({ length: count }, (_, i) => section(`sec-${i}`)),
});

type SettingsSeed = Record<string, unknown>;

interface HeaderTestProps {
  adPageType?: AdPageType;
  contentKind?: ContentKind;
  isHome?: boolean;
}

function wrap(client: QueryClient, ui: ReactNode): ReactElement {
  return (
    <QueryClientProvider client={client}>
      <ThemeProvider>{ui}</ThemeProvider>
    </QueryClientProvider>
  );
}

function renderHeader(seed: SettingsSeed, props: HeaderTestProps = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(siteSettingsQueryOptions.queryKey, seed);
  const view = render(wrap(client, <Header {...props} />));
  return {
    ...view,
    client,
    /** Rerender przez ten sam provider - inaczej `Header` (memo) gubi kontekst. */
    rerenderHeader: (next: HeaderTestProps = props) =>
      view.rerender(wrap(client, <Header {...next} />)),
  };
}

/** Zmiana trasy tak, jak robi ją prawdziwy `useRouterState`: przez subskrybentów. */
function navigateTo(pathname: string): void {
  act(() => {
    h.pathname = pathname;
    for (const force of h.subscribers) force();
  });
}

/** Rozwiązanie leniwego `SearchOverlay` (mikrozadanie, także przy fake timers). */
async function settleLazyOverlay(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
  });
}

const headerEl = (): HTMLElement => {
  const el = document.querySelector<HTMLElement>("header[data-site-header]");
  if (!el) throw new Error("Brak elementu <header data-site-header> w drzewie.");
  return el;
};

const SCROLL_Y_DESCRIPTOR = Object.getOwnPropertyDescriptor(window, "scrollY");
const ORIGINAL_RAF = window.requestAnimationFrame;
const ORIGINAL_CAF = window.cancelAnimationFrame;
const ORIGINAL_RESIZE_OBSERVER = window.ResizeObserver;

/**
 * Sterowalna kolejka klatek. Header koalescencjonuje zdarzenia scroll i pomiary
 * w `requestAnimationFrame`, więc bez ręcznej kolejki nie da się DOWIEŚĆ ani
 * tego, że drugie zdarzenie w tej samej klatce nie planuje drugiego przeliczenia,
 * ani tego, że odmontowanie zaplanowaną klatkę NAPRAWDĘ wyjmuje (atrapa, która
 * tylko zapisuje id, byłaby łagodniejsza niż przeglądarka).
 */
const frames: { id: number; cb: FrameRequestCallback }[] = [];
let nextFrameId = 1;

function stubFrames(): void {
  frames.length = 0;
  window.requestAnimationFrame = (cb: FrameRequestCallback): number => {
    const id = nextFrameId++;
    frames.push({ id, cb });
    return id;
  };
  window.cancelAnimationFrame = (id: number): void => {
    const index = frames.findIndex((f) => f.id === id);
    if (index >= 0) frames.splice(index, 1);
  };
}

function flushFrames(): void {
  const pending = frames.splice(0, frames.length);
  for (const frame of pending) frame.cb(0);
}

/**
 * ResizeObserver happy-doma NIGDY nie woła callbacku (brak silnika układu), więc
 * odroczona publikacja `--sticky-header-h` byłaby bez tej atrapy niemierzalna.
 */
const resizeObservers: ControlledResizeObserver[] = [];

class ControlledResizeObserver implements ResizeObserver {
  private readonly callback: ResizeObserverCallback;
  private readonly targets = new Set<Element>();

  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
    resizeObservers.push(this);
  }

  observe(target: Element): void {
    this.targets.add(target);
  }

  unobserve(target: Element): void {
    this.targets.delete(target);
  }

  disconnect(): void {
    this.targets.clear();
  }

  fire(): void {
    if (this.targets.size > 0) this.callback([], this);
  }
}

function stubResizeObserver(): void {
  resizeObservers.length = 0;
  window.ResizeObserver = ControlledResizeObserver;
}

function fireResizeObservers(): void {
  for (const observer of [...resizeObservers]) observer.fire();
}

function stubScroll(scrollY: number, scrollHeight: number): void {
  Object.defineProperty(window, "scrollY", { configurable: true, writable: true, value: scrollY });
  Object.defineProperty(document.documentElement, "scrollHeight", {
    configurable: true,
    value: scrollHeight,
  });
}

function rect(height: number): DOMRect {
  return {
    x: 0,
    y: 0,
    width: 1024,
    height,
    top: 0,
    left: 0,
    right: 1024,
    bottom: height,
    toJSON: () => ({}),
  };
}

beforeEach(() => {
  h.lang = "pl";
  h.pathname = "/";
  h.navigations.length = 0;
  h.preloads.length = 0;
  h.languageChanges.length = 0;
  h.clientLangWrites.length = 0;
});

afterEach(() => {
  cleanup();
  clearTickerDraft();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  window.localStorage.clear();
  document.documentElement.classList.remove("dark");
  // `LangReelSwitcher` zapisuje wybór języka także na <html lang> - bez tego
  // sprzątania atrybut przeciekał z testu przełącznika na kolejne przypadki.
  document.documentElement.removeAttribute("lang");
  document.documentElement.style.removeProperty("color-scheme");
  document.documentElement.style.removeProperty("--sticky-header-h");
  document.body.style.removeProperty("overflow");
  Reflect.deleteProperty(document.documentElement, "scrollHeight");
  Reflect.deleteProperty(document, "fonts");
  if (SCROLL_Y_DESCRIPTOR) Object.defineProperty(window, "scrollY", SCROLL_Y_DESCRIPTOR);
  window.requestAnimationFrame = ORIGINAL_RAF;
  window.cancelAnimationFrame = ORIGINAL_CAF;
  window.ResizeObserver = ORIGINAL_RESIZE_OBSERVER;
  frames.length = 0;
  resizeObservers.length = 0;
});

// --- Stan pusty --------------------------------------------------------------

function injectStickyDefault(px: number): () => void {
  const style = document.createElement("style");
  style.textContent = `:root { --sticky-header-h: ${px}px; }`;
  document.head.appendChild(style);
  return () => style.remove();
}

/** Zapisy `--sticky-header-h` na <html> (inne właściwości <html> pomijamy). */
function spyStickyWrites() {
  const spy = vi.spyOn(document.documentElement.style, "setProperty");
  return () => spy.mock.calls.filter(([name]) => name === "--sticky-header-h");
}

describe("Header - start bez przeliczenia stylu dokumentu (P1.2, F2/F2b)", () => {
  it("wysokość równa domyślnej z CSS: montaż NIE zapisuje --sticky-header-h na <html>", async () => {
    const removeDefault = injectStickyDefault(212);
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(rect(212));
    const writes = spyStickyWrites();
    try {
      renderHeader({ header: { builder_data: doc(1) } });
      await settleLazyOverlay();

      // Środowisko naprawdę widzi domyślną z arkusza - inaczej brak zapisu
      // byłby przypadkiem, a nie decyzją komponentu.
      expect(getComputedStyle(document.documentElement).getPropertyValue("--sticky-header-h")).toBe(
        "212px",
      );
      expect(writes()).toEqual([]);
      expect(document.documentElement.style.getPropertyValue("--sticky-header-h")).toBe("");
    } finally {
      removeDefault();
    }
  });

  it("różnica mniejsza niż 2 px też nie zapisuje; 2 px i więcej publikuje pomiar", async () => {
    const removeDefault = injectStickyDefault(212);
    const boundingRect = vi
      .spyOn(HTMLElement.prototype, "getBoundingClientRect")
      .mockReturnValue(rect(211));
    const writes = spyStickyWrites();
    try {
      const view = renderHeader({ header: { builder_data: doc(1) } });
      await settleLazyOverlay();
      expect(writes()).toEqual([]);
      view.unmount();

      boundingRect.mockReturnValue(rect(214));
      renderHeader({ header: { builder_data: doc(1) } });
      await settleLazyOverlay();
      expect(writes()).toEqual([["--sticky-header-h", "214px"]]);
      expect(document.documentElement.style.getPropertyValue("--sticky-header-h")).toBe("214px");
    } finally {
      removeDefault();
    }
  });

  it("po montażu bez zapisu obserwator nadal publikuje realną zmianę wysokości", async () => {
    vi.useFakeTimers();
    stubFrames();
    stubResizeObserver();
    const removeDefault = injectStickyDefault(212);
    const boundingRect = vi
      .spyOn(HTMLElement.prototype, "getBoundingClientRect")
      .mockReturnValue(rect(212));
    try {
      renderHeader({ header: { builder_data: doc(1) } });
      await settleLazyOverlay();
      expect(document.documentElement.style.getPropertyValue("--sticky-header-h")).toBe("");

      // Zmiana o mniej niż 2 px wobec domyślnej - dalej bez zapisu.
      boundingRect.mockReturnValue(rect(213));
      act(() => {
        fireResizeObservers();
        vi.advanceTimersByTime(200);
        flushFrames();
      });
      expect(document.documentElement.style.getPropertyValue("--sticky-header-h")).toBe("");

      // Realna zmiana (np. baner reklamowy po hydratacji) - publikacja jak dotąd.
      boundingRect.mockReturnValue(rect(320));
      act(() => {
        fireResizeObservers();
        vi.advanceTimersByTime(200);
        flushFrames();
      });
      expect(document.documentElement.style.getPropertyValue("--sticky-header-h")).toBe("320px");

      // Od tej chwili porównanie idzie z ostatnim zapisem, nie z domyślną.
      boundingRect.mockReturnValue(rect(321));
      act(() => {
        fireResizeObservers();
        vi.advanceTimersByTime(200);
        flushFrames();
      });
      expect(document.documentElement.style.getPropertyValue("--sticky-header-h")).toBe("320px");
    } finally {
      removeDefault();
    }
  });

  it("montaż nie przełącza data-settled (true -> false -> true) - tylko zmiana scrolled to robi", async () => {
    vi.useFakeTimers();
    stubScroll(0, 6000);
    const settledChanges: MutationRecord[] = [];
    const observer = new MutationObserver((records) => settledChanges.push(...records));
    observer.observe(document.body, {
      subtree: true,
      attributes: true,
      attributeFilter: ["data-settled"],
    });
    renderHeader({ header: { builder_data: doc(1) } });
    await settleLazyOverlay();
    act(() => {
      vi.advanceTimersByTime(600);
    });
    settledChanges.push(...observer.takeRecords());

    expect(settledChanges).toEqual([]);
    expect(headerEl()).toHaveAttribute("data-settled", "true");

    // Kontrola: zmiana stanu zwinięcia NADAL przełącza tryb na czas animacji.
    stubScroll(200, 6000);
    act(() => {
      window.dispatchEvent(new Event("scroll"));
      vi.advanceTimersByTime(32);
    });
    settledChanges.push(...observer.takeRecords());
    expect(headerEl()).toHaveAttribute("data-settled", "false");
    expect(settledChanges.length).toBeGreaterThan(0);
    observer.disconnect();
  });

  it("zmiana trybu paska w trakcie animacji nie zostawia nagłówka w data-settled=false", async () => {
    vi.useFakeTimers();
    stubScroll(0, 6000);
    h.pathname = "/";
    renderHeader({ header: { builder_data: doc(1) } });
    await settleLazyOverlay();

    stubScroll(200, 6000);
    act(() => {
      window.dispatchEvent(new Event("scroll"));
      vi.advanceTimersByTime(32);
    });
    expect(headerEl()).toHaveAttribute("data-settled", "false");

    // Nawigacja na wpis (tryb czytania) PRZED końcem animacji: timer jest
    // sprzątany, więc bez przywrócenia stan zostałby na `false`.
    navigateTo("/post/przyklad");
    expect(headerEl()).toHaveAttribute("data-header-mode", "reading");
    expect(headerEl()).toHaveAttribute("data-settled", "true");
  });

  it("zwijanie (scrolled/settled) nie przerenderowuje chrome'u: pasek na czasie zostaje nietknięty", async () => {
    vi.useFakeTimers();
    stubScroll(0, 6000);
    renderHeader({ header: { builder_data: doc(1), trending: { source: "trending" } } });
    await settleLazyOverlay();
    const before = h.tickerRenders;
    expect(before).toBeGreaterThan(0);

    stubScroll(200, 6000);
    act(() => {
      window.dispatchEvent(new Event("scroll"));
      vi.advanceTimersByTime(32);
    });
    expect(headerEl()).toHaveAttribute("data-scrolled", "true");
    act(() => {
      vi.advanceTimersByTime(600);
    });
    expect(headerEl()).toHaveAttribute("data-settled", "true");

    // Dwa commity warstwy zewnętrznej (zwinięcie, koniec animacji), zero
    // renderów wnętrza - jego bloki `<style>` nie dostają nowych `{__html}`.
    expect(h.tickerRenders).toBe(before);
  });
});

// --- Trwałość drzewa ---------------------------------------------------------
