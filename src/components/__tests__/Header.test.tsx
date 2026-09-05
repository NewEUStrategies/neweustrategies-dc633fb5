/**
 * <Header /> - powłoka publiczna renderowana na KAŻDEJ stronie serwisu.
 *
 * CO TEN PLIK PRZYPINA (i dlaczego akurat to).
 *  1. BRAMKA PUSTEGO DOKUMENTU. `HeaderInner` zwraca `null`, gdy w
 *     `site_settings.header` nie ma `builder_data` albo lista sekcji jest
 *     pusta - zewnętrzny `<header>` zostaje w układzie (nie znika), ale nie ma
 *     w nim ani chrome'u, ani paska "na czasie", ani banera. To jest stan
 *     świeżej instalacji i stan uszkodzonego wiersza ustawień naraz, więc
 *     mierzy go osobny przypadek.
 *  2. USTAWIENIA -> PROPSY DZIECI. Ticker jedzie przez
 *     `resolveActiveTickerConfig` (legacy płaski config ORAZ nowy kształt
 *     z wariantami), a `useTickerDraft` ma go PRZEBIJAĆ, gdy panel CMS
 *     opublikuje wersję roboczą. Asercje idą na propsy, które dostaje
 *     `TrendingTicker`, bo to jedyne wyjście tej logiki.
 *  3. LOGO ZALEŻNE OD MOTYWU. Łańcuch fallbacku
 *     (`mobile_dark -> main_dark -> mobile -> main` w ciemnym i lustrzany
 *     w jasnym) jest realną regułą produktu - test przełącza motyw KLIKNIĘCIEM
 *     i sprawdza, że `src` obrazka zmienia wariant, a przy braku logo pokazuje
 *     się `general.site_name` (albo "Menu", gdy i tego nie ma).
 *  4. DWUJĘZYCZNOŚĆ MIERZONA SŁOWNIKIEM, nie kopią napisu. `t` w atrapie
 *     `react-i18next` to PRAWDZIWY `getFixedT(lang)` z `@/test/i18nReal`, więc
 *     usunięcie klucza ze słownika gasi te asercje (patrz `dict()` niżej).
 *  5. INTERAKCJE (tu mieszka 89% martwych funkcji tego pliku - anonimowe
 *     handlery inline): otwarcie/zamknięcie wyszukiwarki (leniwy overlay),
 *     otwarcie drawera hamburgerem, zamknięcie go Escapem, tłem, krzyżykiem
 *     i nawigacją z wnętrza, most zdarzeń okna (`neus:open-mobile-menu`,
 *     `neus:open-mobile-search`) dla paska czytania wpisu, przełącznik motywu,
 *     przełącznik języka oraz zamknięcie drawera przy zmianie trasy. Osobny
 *     przypadek pilnuje pułapki fokusu: otwarta szuflada zabiera fokus na swój
 *     krzyżyk, a zamknięcie oddaje go hamburgerowi.
 *  5a. GRANICA SIECI. Pasek alertu wstrzykuje `<script>` (happy-dom WYKONUJE
 *     `<script src>`), a powłoka montuje baner i pasek "na czasie" - osobny
 *     przypadek dowodzi, że pełny render z interakcjami nie woła `fetch`,
 *     `navigator.sendBeacon` ani nie zostawia w drzewie skryptu z adresem.
 *  6. WARSTWA ZEWNĘTRZNA (`Header2`): tryb paska (`sticky-shrink` vs
 *     `reading`), wymuszony tryb zwinięty na landingu quizu, histereza scrolla
 *     z koalescencją w `requestAnimationFrame`, pomiar wymiarów spoczynkowych
 *     (`--hdr-nat` / `--hdr-tt` / `--hdr-extra` + `data-metrics`) i publikacja
 *     `--sticky-header-h` dla kotwic.
 *
 * CO JEST ZAATRAPOWANE I DLACZEGO.
 *  * `react-i18next` - atrapa Z PRAWDZIWYM `t`. Fabryka `vi.mock` jest
 *    SYNCHRONICZNA i nic nie importuje: udokumentowany skrót
 *    `async () => (await import("@/test/i18nReal")).reactI18nextMock(lang)`
 *    zakleszcza plik, bo `@/test/i18nReal` -> `@/lib/i18n` -> `react-i18next`,
 *    czyli moduł właśnie mockowany (ten sam wniosek stoi w nagłówkach
 *    `careersValues.test.tsx` i `ConsentsPanel.test.tsx`). `realT` wjeżdża
 *    zwykłym importem i jest wstrzykiwany do atrapy po rozwiązaniu modułów.
 *    Atrapa niesie też `i18n.on/off` (subskrypcja `useLang`) i
 *    `i18n.changeLanguage` (przełącznik języka) - bez nich hooki wywracają się
 *    na braku metody, a nie na logice.
 *  * `@tanstack/react-router` - rozwinięty moduł prawdziwy z podmienionym
 *    `useRouterState` (kontrolowana ścieżka) i `useRouter` (atrapa nawigacji
 *    i preloadu dla `AppLink` / `LangReelSwitcher`). Atrapa `useRouterState`
 *    SUBSKRYBUJE (rejestruje wymuszenie renderu w `h.subscribers`), bo sama
 *    podmiana `h.pathname` nie jest stanem Reacta - nic by się nie
 *    przerenderowało, a `memo` na `Header` odcina nawet ratunek w postaci
 *    `rerender()` z tymi samymi propsami. Sprawdzone eksperymentem: po zdjęciu
 *    subskrypcji z atrapy padają dokładnie te przypadki, które zmieniają trasę
 *    (zamknięcie szuflady i przestawienie trybu paska) - reszta pliku przechodzi
 *    dalej, więc subskrypcja jest tu nośna, a nie ozdobna.
 *  * `@/lib/i18n/localeRuntime` - `currentLang()` jest funkcją izomorficzną,
 *    która w środowisku testowym rozstrzyga się na gałąź SERWEROWĄ i bez
 *    kontekstu żądania ZAWSZE oddaje "pl" (to samo ustalenie stoi
 *    w `FriendlyErrorPage.test.tsx`). Bez podmiany wariant EN byłby pustą
 *    asercją na polskim renderze.
 *  * `BuilderRenderer`, `TrendingTicker`, `MobileDrawerBody`, `AdZone`,
 *    `SearchOverlay` - lekkie znaczniki. Ich wnętrze ma własne testy, a tutaj
 *    przedmiotem dowodu jest to, CO Header im podaje i KIEDY je montuje.
 *
 * CO ZOSTAJE PRAWDZIWE: React (stan, efekty, portal, `Suspense` + `lazy`),
 * `useSuspenseQuery` na PRAWDZIWYM `QueryClient` z zasianym cache (zamiast
 * atrapy modułu ustawień), `resolveSetting`, `resolveActiveTickerConfig`,
 * `useTickerDraft`, `ThemeProvider`, `useFocusTrap`, `resolveHeaderMode`,
 * `AlertBar`, `AppLink` i `LangReelSwitcher`.
 *
 * ZNALEZISKA (stan istniejący, przypięty niżej zwykłym `it` - naprawa ma być
 * widoczna jako zmiana testu, nie cicha zmiana zachowania).
 *  * `HeaderProps.isHome` jest PUŁAPKĄ TYPOWĄ publicznego komponentu:
 *    `<Header isHome />` przechodzi typy, ale nie robi NIC - warstwa zewnętrzna
 *    wylicza `isHome` ze ścieżki i propsa o tej nazwie nie czyta (czyta go
 *    wyłącznie wewnętrzny `HeaderInner`, dostając wartość od rodzica). Nie ma
 *    tu `it.fails`, bo naprawa może pójść w dwie strony (uszanować props ALBO
 *    zdjąć go z interfejsu), a test nie ma prawa rozstrzygać której.
 *  * Komentarz przy tym propsie obiecuje wpływ na „efekty scroll". Faktycznie
 *    `isHome` dokłada wyłącznie klasę `home-header-grow` do desktopowego
 *    kontenera; o zwijaniu decydują `resolveHeaderMode` i landing quizu.
 *
 * ŚWIADOMIE POZA ZAKRESEM: prawdziwe drzewo buildera i zawartość drawera
 * (mają własne pliki), realny efekt CSS zwijania (`styles.css` - happy-dom nie
 * liczy kaskady) oraz gałęzie `typeof document === "undefined"` /
 * `typeof window === "undefined"` (w happy-dom nie da się ich osiągnąć uczciwie,
 * a ich sens - SSR - mierzy render serwerowy trasy).
 *
 * RODO: żadnych prawdziwych identyfikatorów, adresów skryptów ani osób -
 * wszystkie dane są zmyślone (example.com, "Instytut Testowy").
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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
  }) => (
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
  ),
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
// Nakładka słownika szuflady mobilnej rejestruje się efektem ubocznym importu
// (Header robi to sam, ale plik testu asertuje jej klucz `mobileDrawer.language`,
// więc dociąga ją jawnie - inaczej `realT` zwracałby sam klucz).
import "@/lib/i18n-mobile-drawer";
import { siteSettingsQueryOptions } from "@/lib/useSiteSetting";
import { ThemeProvider } from "@/components/ThemeProvider";
import { clearTickerDraft, publishTickerDraft } from "@/lib/views/tickerDraftBridge";
import { Header } from "@/components/Header";

h.t = (lang: Lang) => realT(lang);

/**
 * Odczyt ze słownika, który NIE MOŻE przejść na brakującym kluczu.
 * i18next dla nieistniejącego klucza zwraca sam klucz, a komponent renderuje
 * dokładnie `t(key)` - bez tej bramki asercja porównywałaby echo z echem.
 */
function dict(lang: Lang, key: string): string {
  const value = String(realT(lang)(key));
  if (value === key) {
    throw new Error(
      `Klucz i18n "${key}" (${lang}) nie ma tłumaczenia - i18next zwrócił sam klucz. ` +
        "Asercja na tej wartości mierzyłaby echo klucza, nie słownik.",
    );
  }
  return value;
}

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

function setHeight(el: Element, value: number): void {
  Object.defineProperty(el, "offsetHeight", { configurable: true, value });
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

describe("Header - stan pusty i degradacja ustawień", () => {
  it("bez klucza header w ustawieniach renderuje samą skorupę <header>, bez chrome'u", async () => {
    renderHeader({});
    await settleLazyOverlay();

    expect(headerEl()).toBeInTheDocument();
    expect(document.querySelector(".site-header-chrome")).toBeNull();
    expect(screen.queryByTestId("builder")).toBeNull();
    expect(screen.queryByTestId("ticker")).toBeNull();
    expect(screen.queryByTestId("ad-zone")).toBeNull();
    expect(screen.queryByRole("button", { name: dict("pl", "common.openMenu") })).toBeNull();
  });

  it("pusta lista sekcji jest traktowana jak brak dokumentu", async () => {
    renderHeader({ header: { builder_data: doc(0) } });
    await settleLazyOverlay();

    expect(headerEl()).toBeInTheDocument();
    expect(screen.queryByTestId("builder")).toBeNull();
  });

  it("uszkodzony (nieobiektowy) wiersz ustawień nie wywraca headera", async () => {
    renderHeader({ header: "nie-obiekt", general: 7, theme_options: null });
    await settleLazyOverlay();

    expect(headerEl()).toBeInTheDocument();
    expect(screen.queryByTestId("builder")).toBeNull();
  });
});

// --- Stan z danymi -----------------------------------------------------------

describe("Header - ustawienia przekładane na propsy dzieci", () => {
  it("renderuje dokument buildera, pasek na czasie i baner z typem strony", async () => {
    renderHeader(
      {
        header: {
          builder_data: doc(2),
          trending: { source: "latest", mode: "rotate", limit: 5, days: 3, labelPl: "Na czasie" },
        },
      },
      { adPageType: "post" },
    );
    await settleLazyOverlay();

    const builder = screen.getByTestId("builder");
    expect(builder).toHaveAttribute("data-sections", "2");
    expect(builder).toHaveAttribute("data-lang", "pl");

    const ticker = screen.getByTestId("ticker");
    expect(ticker).toHaveAttribute("data-source", "latest");
    expect(ticker).toHaveAttribute("data-mode", "rotate");
    expect(ticker).toHaveAttribute("data-limit", "5");
    expect(ticker).toHaveAttribute("data-days", "3");
    expect(ticker).toHaveAttribute("data-label-pl", "Na czasie");
    expect(ticker).toHaveAttribute("data-full-width", "true");

    const ad = screen.getByTestId("ad-zone");
    expect(ad).toHaveAttribute("data-position", "header_banner");
    expect(ad).toHaveAttribute("data-page-type", "post");
  });

  it("bez propsa adPageType baner dostaje domyślny typ 'all'", async () => {
    renderHeader({ header: { builder_data: doc(1) } });
    await settleLazyOverlay();

    expect(screen.getByTestId("ad-zone")).toHaveAttribute("data-page-type", "all");
  });

  it("wyłączony ticker (enabled: false) nie montuje paska na czasie", async () => {
    renderHeader({ header: { builder_data: doc(1), trending: { enabled: false } } });
    await settleLazyOverlay();

    expect(screen.queryByTestId("ticker")).toBeNull();
    expect(screen.getByTestId("builder")).toBeInTheDocument();
  });

  it("czyta AKTYWNY wariant tickera z nowego kształtu ustawień, nie pierwszy z listy", async () => {
    renderHeader({
      header: {
        builder_data: doc(1),
        trending: {
          activeVariantId: "v2",
          variants: [
            { id: "v1", name: "Pierwszy", config: { source: "trending", limit: 8 } },
            { id: "v2", name: "Drugi", config: { source: "pinned", limit: 3 } },
          ],
        },
      },
    });
    await settleLazyOverlay();

    const ticker = screen.getByTestId("ticker");
    expect(ticker).toHaveAttribute("data-source", "pinned");
    expect(ticker).toHaveAttribute("data-limit", "3");
  });

  it("wersja robocza z panelu CMS przebija konfigurację zapisaną w ustawieniach", async () => {
    renderHeader({
      header: { builder_data: doc(1), trending: { source: "trending", limit: 8 } },
    });
    await settleLazyOverlay();
    expect(screen.getByTestId("ticker")).toHaveAttribute("data-source", "trending");

    act(() => {
      publishTickerDraft({
        enabled: true,
        source: "selected",
        mode: "fade",
        layoutStyle: "badge",
        days: 7,
        limit: 2,
        visibleCount: 1,
        intervalSec: 6,
        scrollSpeed: 60,
        selectedPostIds: ["a", "b"],
        fullWidth: false,
      });
    });

    const ticker = screen.getByTestId("ticker");
    expect(ticker).toHaveAttribute("data-source", "selected");
    expect(ticker).toHaveAttribute("data-limit", "2");
    expect(ticker).toHaveAttribute("data-full-width", "false");

    act(() => {
      clearTickerDraft();
    });
    expect(screen.getByTestId("ticker")).toHaveAttribute("data-source", "trending");
  });

  it("wersja robocza bez pól dostaje komplet wartości domyślnych paska", async () => {
    renderHeader({ header: { builder_data: doc(1), trending: { source: "pinned", limit: 2 } } });
    await settleLazyOverlay();

    // Draft jest surowy (panel publikuje stan formularza), więc to Header
    // domyka brakujące pola - normalizacja wariantów go nie dotyka.
    act(() => {
      publishTickerDraft({});
    });

    const ticker = screen.getByTestId("ticker");
    expect(ticker).toHaveAttribute("data-source", "trending");
    expect(ticker).toHaveAttribute("data-mode", "scroll");
    expect(ticker).toHaveAttribute("data-layout", "classic");
    expect(ticker).toHaveAttribute("data-days", "7");
    expect(ticker).toHaveAttribute("data-limit", "8");
    expect(ticker).toHaveAttribute("data-full-width", "true");
    expect(ticker).toHaveAttribute("data-label-pl", "");
  });
});

// --- Logo i motyw ------------------------------------------------------------

describe("Header - logo mobilne i przełącznik motywu", () => {
  const SEED_LOGOS = {
    header: { builder_data: doc(1) },
    general: { site_name: "Instytut Testowy" },
    theme_options: {
      logo: {
        main: "https://example.com/logo-main.svg",
        main_dark: "https://example.com/logo-main-dark.svg",
        mobile: "https://example.com/logo-mobile.svg",
        mobile_dark: "https://example.com/logo-mobile-dark.svg",
      },
    },
  };

  it("kliknięcie przełącznika motywu zmienia wariant logo na ciemny i zapisuje wybór", async () => {
    renderHeader(SEED_LOGOS);
    await settleLazyOverlay();

    expect(screen.getByRole("img", { name: "Instytut Testowy" })).toHaveAttribute(
      "src",
      "https://example.com/logo-mobile.svg",
    );

    fireEvent.click(screen.getByRole("button", { name: dict("pl", "common.toggleTheme") }));

    expect(screen.getByRole("img", { name: "Instytut Testowy" })).toHaveAttribute(
      "src",
      "https://example.com/logo-mobile-dark.svg",
    );
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(window.localStorage.getItem("theme")).toBe("dark");

    fireEvent.click(screen.getByRole("button", { name: dict("pl", "common.toggleTheme") }));
    expect(document.documentElement.classList.contains("dark")).toBe(false);
    expect(screen.getByRole("img", { name: "Instytut Testowy" })).toHaveAttribute(
      "src",
      "https://example.com/logo-mobile.svg",
    );
  });

  it("w ciemnym motywie bez wariantu mobile_dark spada na desktopowe main_dark", async () => {
    window.localStorage.setItem("theme", "dark");
    renderHeader({
      header: { builder_data: doc(1) },
      general: { site_name: "Instytut Testowy" },
      theme_options: { logo: { main_dark: "https://example.com/only-main-dark.svg" } },
    });
    await settleLazyOverlay();

    expect(screen.getByRole("img", { name: "Instytut Testowy" })).toHaveAttribute(
      "src",
      "https://example.com/only-main-dark.svg",
    );
  });

  it("w jasnym motywie bez wariantów jasnych spada na logo ciemne", async () => {
    renderHeader({
      header: { builder_data: doc(1) },
      general: { site_name: "Instytut Testowy" },
      theme_options: { logo: { mobile_dark: "https://example.com/fallback-dark.svg" } },
    });
    await settleLazyOverlay();

    expect(screen.getByRole("img", { name: "Instytut Testowy" })).toHaveAttribute(
      "src",
      "https://example.com/fallback-dark.svg",
    );
  });

  it("bez logo pokazuje nazwę serwisu, a bez nazwy - napis 'Menu'", async () => {
    const withName = renderHeader({
      header: { builder_data: doc(1) },
      general: { site_name: "  Instytut Testowy  " },
    });
    await settleLazyOverlay();
    expect(screen.queryByRole("img")).toBeNull();
    expect(screen.getByText("Instytut Testowy")).toBeInTheDocument();
    withName.unmount();

    renderHeader({ header: { builder_data: doc(1) }, general: { site_name: "   " } });
    await settleLazyOverlay();
    expect(screen.getAllByText("Menu").length).toBeGreaterThan(0);
  });
});

// --- Dwujęzyczność -----------------------------------------------------------

describe("Header - warianty językowe", () => {
  it("wariant PL: etykiety akcji i przełącznik języka pochodzą z polskiego słownika", async () => {
    h.lang = "pl";
    renderHeader({ header: { builder_data: doc(1) } });
    await settleLazyOverlay();

    expect(screen.getByRole("button", { name: dict("pl", "common.openMenu") })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: dict("pl", "common.openSearch") }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: dict("pl", "common.toggleTheme") }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: `${dict("pl", "mobileDrawer.language")}: EN` }),
    ).toBeInTheDocument();
    expect(screen.getByTestId("builder")).toHaveAttribute("data-lang", "pl");
    expect(screen.getByTestId("search-overlay")).toHaveAttribute("data-lang", "pl");
  });

  it("wariant EN: te same akcje niosą napisy z angielskiego słownika", async () => {
    h.lang = "en";
    h.pathname = "/en";
    renderHeader({ header: { builder_data: doc(1) } });
    await settleLazyOverlay();

    expect(screen.getByRole("button", { name: dict("en", "common.openMenu") })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: dict("en", "common.openSearch") }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: `${dict("en", "mobileDrawer.language")}: PL` }),
    ).toBeInTheDocument();
    expect(screen.getByTestId("builder")).toHaveAttribute("data-lang", "en");
    expect(screen.getByTestId("search-overlay")).toHaveAttribute("data-lang", "en");
    // Dowód, że to naprawdę dwa różne słowniki, a nie kopia jednego napisu.
    expect(dict("en", "common.openMenu")).not.toBe(dict("pl", "common.openMenu"));
  });

  it("przełącznik języka zmienia język i nawiguje na zlokalizowany adres", async () => {
    h.lang = "pl";
    h.pathname = "/";
    renderHeader({ header: { builder_data: doc(1) } });
    await settleLazyOverlay();

    fireEvent.click(
      screen.getByRole("button", { name: `${dict("pl", "mobileDrawer.language")}: EN` }),
    );

    expect(h.languageChanges).toEqual(["en"]);
    expect(h.clientLangWrites).toEqual(["en"]);
    expect(h.navigations).toEqual(["/en"]);
    expect(window.localStorage.getItem("i18nextLng")).toBe("en");
  });
});

// --- Wyszukiwarka ------------------------------------------------------------

describe("Header - leniwa wyszukiwarka", () => {
  it("montuje overlay zamknięty, otwiera go lupą i zamyka jego własną akcją", async () => {
    renderHeader({ header: { builder_data: doc(1) } });

    const overlay = await screen.findByTestId("search-overlay");
    expect(overlay).toHaveAttribute("data-open", "false");
    expect(overlay).toHaveAttribute("data-mode", "fullscreen");
    expect(overlay).toHaveAttribute("data-limit", "8");
    expect(overlay).toHaveTextContent(dict("pl", "common.search"));

    fireEvent.click(screen.getByRole("button", { name: dict("pl", "common.openSearch") }));
    expect(screen.getByTestId("search-overlay")).toHaveAttribute("data-open", "true");

    fireEvent.click(screen.getByRole("button", { name: "zamknij wyszukiwarkę" }));
    expect(screen.getByTestId("search-overlay")).toHaveAttribute("data-open", "false");
  });

  it("zdarzenie okna neus:open-mobile-search otwiera overlay (most z paska czytania)", async () => {
    renderHeader({ header: { builder_data: doc(1) } });
    await settleLazyOverlay();

    act(() => {
      window.dispatchEvent(new Event("neus:open-mobile-search"));
    });

    expect(screen.getByTestId("search-overlay")).toHaveAttribute("data-open", "true");
  });
});

// --- Drawer mobilny ----------------------------------------------------------

describe("Header - mobilna szuflada", () => {
  const SEED = { header: { builder_data: doc(3) }, general: { site_name: "Instytut Testowy" } };

  const openDrawer = () =>
    fireEvent.click(screen.getByRole("button", { name: dict("pl", "common.openMenu") }));

  it("hamburger otwiera szufladę w portalu, blokuje scroll strony i ustawia aria-expanded", async () => {
    renderHeader(SEED);
    await settleLazyOverlay();

    const trigger = screen.getByRole("button", { name: dict("pl", "common.openMenu") });
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(trigger).toHaveAttribute("aria-controls", "mobile-header-drawer");

    openDrawer();

    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAttribute("id", "mobile-header-drawer");
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toHaveAttribute("aria-label", "Instytut Testowy");
    // Portal: szuflada wisi bezpośrednio na <body>, poza <header>.
    expect(dialog.parentElement).toBe(document.body);
    expect(headerEl().contains(dialog)).toBe(false);
    expect(screen.getByTestId("drawer-body")).toHaveAttribute("data-sections", "3");
    expect(document.body.style.overflow).toBe("hidden");
    expect(screen.getByRole("button", { name: dict("pl", "common.openMenu") })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
  });

  it("otwarta szuflada przejmuje fokus, a po zamknięciu oddaje go hamburgerowi", async () => {
    renderHeader(SEED);
    await settleLazyOverlay();

    const trigger = screen.getByRole("button", { name: dict("pl", "common.openMenu") });
    trigger.focus();
    expect(document.activeElement).toBe(trigger);

    openDrawer();

    // `useFocusTrap` wciąga fokus do PIERWSZEGO elementu focusowalnego panelu -
    // czyli do krzyżyka zamykającego. Panel zostaje wtedy bez `tabindex`
    // (gałąź kontenera dotyczy tylko szuflady bez żadnej kontrolki).
    const closeButton = screen.getByRole("button", { name: dict("pl", "common.closeMenu") });
    const panel = screen.getByTestId("drawer-body").parentElement;
    expect(panel).not.toBeNull();
    expect(panel?.contains(closeButton)).toBe(true);
    expect(document.activeElement).toBe(closeButton);

    act(() => {
      fireEvent.keyDown(window, { key: "Escape" });
    });

    expect(document.activeElement).toBe(trigger);
  });

  it("Escape zamyka szufladę i przywraca przewijanie strony", async () => {
    renderHeader(SEED);
    await settleLazyOverlay();
    openDrawer();
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    act(() => {
      fireEvent.keyDown(window, { key: "Escape" });
    });

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.body.style.overflow).toBe("");
  });

  it("inny klawisz niż Escape szuflady nie zamyka", async () => {
    renderHeader(SEED);
    await settleLazyOverlay();
    openDrawer();

    act(() => {
      fireEvent.keyDown(window, { key: "a" });
    });

    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("kliknięcie w tło zamyka szufladę", async () => {
    const { container } = renderHeader(SEED);
    await settleLazyOverlay();
    openDrawer();

    const backdrop = document.querySelector<HTMLElement>('[aria-hidden="true"][tabindex="-1"]');
    expect(backdrop).not.toBeNull();
    if (backdrop) fireEvent.click(backdrop);

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(container).toBeInTheDocument();
  });

  it("krzyżyk w nagłówku szuflady zamyka ją", async () => {
    renderHeader(SEED);
    await settleLazyOverlay();
    openDrawer();

    fireEvent.click(screen.getByRole("button", { name: dict("pl", "common.closeMenu") }));

    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("nawigacja z wnętrza szuflady zamyka ją (onNavigate)", async () => {
    renderHeader(SEED);
    await settleLazyOverlay();
    openDrawer();

    fireEvent.click(screen.getByRole("button", { name: "pozycja menu" }));

    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("zdarzenie okna neus:open-mobile-menu otwiera szufladę", async () => {
    renderHeader(SEED);
    await settleLazyOverlay();

    act(() => {
      window.dispatchEvent(new Event("neus:open-mobile-menu"));
    });

    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("zmiana trasy zamyka otwartą szufladę", async () => {
    renderHeader(SEED);
    await settleLazyOverlay();
    openDrawer();
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    navigateTo("/analizy");

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.body.style.overflow).toBe("");
  });

  it("odmontowanie z otwartą szufladą przywraca przewijanie strony", async () => {
    const view = renderHeader(SEED);
    await settleLazyOverlay();
    openDrawer();
    expect(document.body.style.overflow).toBe("hidden");

    view.unmount();

    expect(document.body.style.overflow).toBe("");
  });
});

// --- Pasek alertu (renderowany przez Header) ---------------------------------

describe("Header - pasek alertu w chrome", () => {
  it("włączony pasek pokazuje komunikat, a krzyżyk zamyka go trwale", async () => {
    renderHeader({
      header: { builder_data: doc(1) },
      theme_options: {
        header: {
          alert_bar: {
            enabled: true,
            message_pl: "Rejestracja na Decision Lab trwa",
            message_en: "Decision Lab registration is open",
            link_url: "",
            style: "info",
            dismissible: true,
          },
        },
      },
    });
    await settleLazyOverlay();

    expect(screen.getByText("Rejestracja na Decision Lab trwa")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: dict("pl", "common.dismissAlertBar") }));

    expect(screen.queryByText("Rejestracja na Decision Lab trwa")).toBeNull();
  });

  it("wyłączony pasek alertu nie zajmuje miejsca w chrome", async () => {
    renderHeader({
      header: { builder_data: doc(1) },
      theme_options: { header: { alert_bar: { enabled: false, message_pl: "cokolwiek" } } },
    });
    await settleLazyOverlay();

    expect(screen.queryByRole("region")).toBeNull();
  });
});

// --- Granica sieci -----------------------------------------------------------

describe("Header - powłoka nie wychodzi do sieci", () => {
  it("pełny render z paskiem alertu i interakcjami nie woła fetcha, beacona ani skryptu z adresem", async () => {
    const fetchSpy = vi.fn(() => Promise.reject(new Error("test nie ma prawa iść do sieci")));
    vi.stubGlobal("fetch", fetchSpy);
    const beacon = vi.spyOn(navigator, "sendBeacon");

    renderHeader({
      header: { builder_data: doc(1), trending: { source: "trending" } },
      general: { site_name: "Instytut Testowy" },
      theme_options: {
        header: {
          alert_bar: {
            enabled: true,
            message_pl: "Rejestracja na Decision Lab trwa",
            message_en: "Decision Lab registration is open",
            link_url: "/wydarzenia",
            style: "info",
            dismissible: true,
          },
        },
      },
    });
    await settleLazyOverlay();

    fireEvent.click(screen.getByRole("button", { name: dict("pl", "common.openSearch") }));
    fireEvent.click(screen.getByRole("button", { name: dict("pl", "common.toggleTheme") }));
    fireEvent.click(screen.getByRole("button", { name: dict("pl", "common.openMenu") }));

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(beacon).not.toHaveBeenCalled();
    // happy-dom WYKONUJE `<script src>`; skrypt paska alertu jest wyłącznie
    // inline'owy, więc w całym drzewie nie ma ani jednego adresu do pobrania.
    expect(document.querySelectorAll("script[src]")).toHaveLength(0);
  });
});

// --- Warstwa zewnętrzna: tryb paska -----------------------------------------

describe("Header - tryb paska i strona główna", () => {
  it("na stronie głównej header jest sticky i dostaje klasę wzrostu", async () => {
    h.pathname = "/";
    renderHeader({ header: { builder_data: doc(1) } });
    await settleLazyOverlay();

    const header = headerEl();
    expect(header).toHaveAttribute("data-header-mode", "sticky-shrink");
    expect(header.className).toContain("sticky top-0");
    expect(document.querySelector(".home-header-grow")).not.toBeNull();
  });

  it("angielska strona główna (/en) też liczy się jako home", async () => {
    h.lang = "en";
    h.pathname = "/en";
    renderHeader({ header: { builder_data: doc(1) } });
    await settleLazyOverlay();

    expect(document.querySelector(".home-header-grow")).not.toBeNull();
  });

  it("poza stroną główną klasy wzrostu nie ma, a prop isHome jest ignorowany", async () => {
    h.pathname = "/analizy";
    renderHeader({ header: { builder_data: doc(1) } }, { isHome: true });
    await settleLazyOverlay();

    // `Header` (warstwa zewnętrzna) wylicza isHome ze ścieżki i NIE czyta
    // propsa o tej nazwie - ten przypadek przypina istniejące zachowanie.
    expect(document.querySelector(".home-header-grow")).toBeNull();
  });

  it("na wpisie (contentKind=post) górną krawędź oddaje paskowi czytania", async () => {
    h.pathname = "/analizy/przyklad";
    renderHeader({ header: { builder_data: doc(1) } }, { contentKind: "post" });
    await settleLazyOverlay();

    const header = headerEl();
    expect(header).toHaveAttribute("data-header-mode", "reading");
    expect(header.className).toContain("relative");
    expect(document.documentElement.style.getPropertyValue("--sticky-header-h")).toBe("0px");
  });

  it("legacy adres /post/<slug> również przechodzi w tryb czytania", async () => {
    h.pathname = "/post/przyklad";
    renderHeader({ header: { builder_data: doc(1) } });
    await settleLazyOverlay();

    expect(headerEl()).toHaveAttribute("data-header-mode", "reading");
  });

  it("landing quizu startuje od razu w wersji zwiniętej", async () => {
    h.pathname = "/quiz";
    renderHeader({ header: { builder_data: doc(1) } });
    await settleLazyOverlay();

    expect(headerEl()).toHaveAttribute("data-scrolled", "true");
  });
});

// --- Warstwa zewnętrzna: scroll i pomiary ------------------------------------

describe("Header - histereza scrolla i pomiar wymiarów", () => {
  it("zwija się dopiero powyżej progu i rozwija poniżej dolnego progu (histereza)", async () => {
    vi.useFakeTimers();
    stubScroll(0, 6000);
    renderHeader({ header: { builder_data: doc(1) } });
    await settleLazyOverlay();

    expect(headerEl()).toHaveAttribute("data-scrolled", "false");

    // 70 px: powyżej progu rozwinięcia (56), ale poniżej progu zwinięcia (96).
    stubScroll(70, 6000);
    act(() => {
      window.dispatchEvent(new Event("scroll"));
      vi.advanceTimersByTime(32);
    });
    expect(headerEl()).toHaveAttribute("data-scrolled", "false");

    stubScroll(200, 6000);
    act(() => {
      window.dispatchEvent(new Event("scroll"));
      vi.advanceTimersByTime(32);
    });
    expect(headerEl()).toHaveAttribute("data-scrolled", "true");

    // Powrót: 70 px nadal trzyma stan zwinięty (histereza w drugą stronę).
    stubScroll(70, 6000);
    act(() => {
      window.dispatchEvent(new Event("scroll"));
      vi.advanceTimersByTime(32);
    });
    expect(headerEl()).toHaveAttribute("data-scrolled", "true");

    stubScroll(10, 6000);
    act(() => {
      window.dispatchEvent(new Event("scroll"));
      vi.advanceTimersByTime(32);
    });
    expect(headerEl()).toHaveAttribute("data-scrolled", "false");
  });

  it("na krótkiej stronie (za mały zapas przewijania) nie zwija się wcale", async () => {
    vi.useFakeTimers();
    stubScroll(500, 800);
    renderHeader({ header: { builder_data: doc(1) } });
    await settleLazyOverlay();

    act(() => {
      window.dispatchEvent(new Event("scroll"));
      vi.advanceTimersByTime(32);
    });

    expect(headerEl()).toHaveAttribute("data-scrolled", "false");
  });

  it("po zmianie stanu zwinięcia header wraca do trybu ostrego dopiero po animacji", async () => {
    vi.useFakeTimers();
    stubScroll(0, 6000);
    renderHeader({ header: { builder_data: doc(1) } });
    await settleLazyOverlay();

    act(() => {
      vi.advanceTimersByTime(600);
    });
    expect(headerEl()).toHaveAttribute("data-settled", "true");

    stubScroll(200, 6000);
    act(() => {
      window.dispatchEvent(new Event("scroll"));
      vi.advanceTimersByTime(32);
    });
    expect(headerEl()).toHaveAttribute("data-settled", "false");

    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(headerEl()).toHaveAttribute("data-settled", "true");
  });

  it("publikuje wymiary spoczynkowe headera i tickera, a przy nieudanym pomiarze trzyma poprzednie", async () => {
    vi.useFakeTimers();
    renderHeader({ header: { builder_data: doc(1), trending: { source: "trending" } } });
    await settleLazyOverlay();

    const header = headerEl();
    const chrome = header.querySelector(".site-header-chrome");
    const ticker = header.querySelector(".cms-trending");
    expect(chrome).not.toBeNull();
    expect(ticker).not.toBeNull();
    if (!chrome || !ticker) return;

    setHeight(chrome, 200);
    setHeight(ticker, 40);
    setHeight(header, 210);

    act(() => {
      window.dispatchEvent(new Event("resize"));
      vi.advanceTimersByTime(400);
    });

    expect(header.dataset.metrics).toBe("ready");
    expect(header.style.getPropertyValue("--hdr-nat")).toBe("200px");
    expect(header.style.getPropertyValue("--hdr-tt")).toBe("40px");
    expect(header.style.getPropertyValue("--hdr-extra")).toBe("10px");

    // Nieudany pomiar (chrome bez wysokości) NIE kasuje poprzedniej wartości.
    setHeight(chrome, 0);
    act(() => {
      window.dispatchEvent(new Event("resize"));
      vi.advanceTimersByTime(400);
    });
    expect(header.dataset.metrics).toBe("ready");
  });

  it("bez chrome'u (pusty dokument) nie ma znacznika data-metrics", async () => {
    vi.useFakeTimers();
    renderHeader({});
    await settleLazyOverlay();

    act(() => {
      window.dispatchEvent(new Event("resize"));
      vi.advanceTimersByTime(400);
    });

    expect(headerEl().dataset.metrics).toBeUndefined();
  });

  it("publikuje wysokość sticky headera dla kotwic i sprząta ją po odmontowaniu", async () => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(rect(212));
    const view = renderHeader({ header: { builder_data: doc(1) } });
    await settleLazyOverlay();

    expect(document.documentElement.style.getPropertyValue("--sticky-header-h")).toBe("212px");

    view.unmount();
    expect(document.documentElement.style.getPropertyValue("--sticky-header-h")).toBe("");
  });

  it("gotowość fontów wyzwala ponowny pomiar, a jej błąd nie wywraca headera", async () => {
    vi.useFakeTimers();
    const ready = Promise.reject(new Error("fonty niedostępne"));
    // Odrzucenie jest obsługiwane w komponencie; tutaj zdejmujemy je także
    // z rejestru testu, żeby nie liczyło się jako nieobsłużone.
    ready.catch(() => undefined);
    Object.defineProperty(document, "fonts", { configurable: true, value: { ready } });

    renderHeader({ header: { builder_data: doc(1) } });
    await settleLazyOverlay();

    expect(headerEl()).toBeInTheDocument();

    Object.defineProperty(document, "fonts", {
      configurable: true,
      value: { ready: Promise.resolve() },
    });
    await settleLazyOverlay();
    await act(async () => {
      vi.advanceTimersByTime(400);
    });

    expect(headerEl()).toBeInTheDocument();
  });
});

// --- Koalescencja klatek i obserwator rozmiaru -------------------------------

describe("Header - koalescencja klatek animacji", () => {
  it("kilka zdarzeń scroll w jednej klatce planuje dokładnie jedno przeliczenie", async () => {
    stubFrames();
    stubScroll(200, 6000);
    renderHeader({ header: { builder_data: doc(1) } });
    await settleLazyOverlay();

    // Pierwszy pomiar leci wprost z efektu (bez klatki), więc stan jest już zwinięty.
    expect(headerEl()).toHaveAttribute("data-scrolled", "true");
    frames.length = 0;

    act(() => {
      window.dispatchEvent(new Event("scroll"));
      window.dispatchEvent(new Event("scroll"));
      window.dispatchEvent(new Event("resize"));
    });
    expect(frames.length).toBe(1);

    stubScroll(10, 6000);
    act(() => {
      flushFrames();
    });
    expect(headerEl()).toHaveAttribute("data-scrolled", "false");
  });

  it("odmontowanie wyjmuje zaplanowaną klatkę z kolejki", async () => {
    stubFrames();
    stubScroll(0, 6000);
    const view = renderHeader({ header: { builder_data: doc(1) } });
    await settleLazyOverlay();

    frames.length = 0;
    act(() => {
      window.dispatchEvent(new Event("scroll"));
    });
    expect(frames.length).toBe(1);

    view.unmount();
    expect(frames.length).toBe(0);
  });

  it("pomiar wymiarów nie planuje drugiej klatki, gdy poprzednia jeszcze nie wypadła", async () => {
    vi.useFakeTimers();
    stubFrames();
    renderHeader({ header: { builder_data: doc(1) } });
    await settleLazyOverlay();

    frames.length = 0;
    act(() => {
      window.dispatchEvent(new Event("resize"));
      vi.advanceTimersByTime(200);
    });
    // Dwie klatki, bo `resize` karmi OBA nasłuchy headera: przeliczenie zwinięcia
    // (natychmiast) i odroczony pomiar wymiarów (po 160 ms).
    expect(frames.length).toBe(2);

    // Druga prośba o pomiar przy WCIĄŻ oczekujących klatkach nie dokłada kolejnych.
    act(() => {
      window.dispatchEvent(new Event("resize"));
      vi.advanceTimersByTime(200);
    });
    expect(frames.length).toBe(2);

    // Dopiero po wypadnięciu klatek kolejne zdarzenie planuje pomiar od nowa.
    act(() => {
      flushFrames();
      window.dispatchEvent(new Event("resize"));
      vi.advanceTimersByTime(200);
    });
    expect(frames.length).toBe(2);
  });

  it("obserwator rozmiaru publikuje wysokość dopiero po ustabilizowaniu układu", async () => {
    vi.useFakeTimers();
    stubFrames();
    stubResizeObserver();
    const boundingRect = vi
      .spyOn(HTMLElement.prototype, "getBoundingClientRect")
      .mockReturnValue(rect(212));

    const view = renderHeader({ header: { builder_data: doc(1) } });
    await settleLazyOverlay();
    expect(document.documentElement.style.getPropertyValue("--sticky-header-h")).toBe("212px");

    boundingRect.mockReturnValue(rect(320));
    act(() => {
      fireResizeObservers();
    });
    // Nic nie poszło na :root w trakcie ruchu - publikacja jest odroczona.
    expect(document.documentElement.style.getPropertyValue("--sticky-header-h")).toBe("212px");

    act(() => {
      vi.advanceTimersByTime(200);
      flushFrames();
    });
    expect(document.documentElement.style.getPropertyValue("--sticky-header-h")).toBe("320px");

    // Zmiana mniejsza niż 2 px nie unieważnia stylów całego dokumentu.
    boundingRect.mockReturnValue(rect(321));
    act(() => {
      fireResizeObservers();
      vi.advanceTimersByTime(200);
      flushFrames();
    });
    expect(document.documentElement.style.getPropertyValue("--sticky-header-h")).toBe("320px");

    // Odmontowanie z klatką w kolejce ją anuluje i sprząta zmienną.
    boundingRect.mockReturnValue(rect(410));
    act(() => {
      fireResizeObservers();
      vi.advanceTimersByTime(200);
    });
    // Dwie klatki: pomiar wymiarów spoczynkowych i publikacja wysokości.
    expect(frames.length).toBe(2);
    view.unmount();
    expect(frames.length).toBe(0);
    expect(document.documentElement.style.getPropertyValue("--sticky-header-h")).toBe("");
  });
});

// --- Trwałość drzewa ---------------------------------------------------------

describe("Header - trwałość między nawigacjami", () => {
  it("zmiana ścieżki przestawia tryb paska, ale nie przemontowuje dokumentu buildera", async () => {
    h.pathname = "/";
    renderHeader({ header: { builder_data: doc(2) } });
    await settleLazyOverlay();

    const before = screen.getByTestId("builder");
    expect(headerEl()).toHaveAttribute("data-header-mode", "sticky-shrink");

    // Cel podwójny: dowód, że zmiana trasy NAPRAWDĘ dociera do komponentu
    // (tryb paska się przestawia - inaczej asercja tożsamości węzła przechodziłaby
    // także wtedy, gdyby nawigacja nie dotarła nigdzie) i że przy tej zmianie
    // dokument buildera zostaje TYM SAMYM węzłem DOM.
    navigateTo("/post/przyklad");
    await waitFor(() => {
      expect(headerEl()).toHaveAttribute("data-header-mode", "reading");
    });
    expect(screen.getByTestId("builder")).toBe(before);
  });

  it("nowy contentKind od powłoki przestawia tryb paska bez przemontowania headera", async () => {
    h.pathname = "/analizy/przyklad";
    const view = renderHeader({ header: { builder_data: doc(2) } }, { contentKind: null });
    await settleLazyOverlay();

    const before = screen.getByTestId("builder");
    expect(headerEl()).toHaveAttribute("data-header-mode", "sticky-shrink");

    // `Header` jest `memo`, więc dowodzimy, że ZMIANA propsa (a nie tylko
    // ponowny render rodzica) przebija się przez tę bramkę.
    view.rerenderHeader({ contentKind: "post" });

    expect(headerEl()).toHaveAttribute("data-header-mode", "reading");
    expect(screen.getByTestId("builder")).toBe(before);
  });
});
