// Wspólne wyposażenie testów PUBLICZNEGO renderera (`BuilderRenderer.tsx`).
//
// PO CO OSOBNY PLIK. Pliki testowe tego obszaru są podzielone po TEMACIE
// (urządzenie, dostęp, zakładki, strumieniowanie, eksperymenty), a każdy z nich
// montuje ten sam renderer. Bez wspólnych konstruktorów dokumentu każdy plik
// zbudowałby własny kształt sekcji - i wtedy zielony wynik jednego pliku nie
// mówiłby nic o drugim, bo mierzyłyby RÓŻNE dokumenty.
//
// CZEGO TU NIE MA I BYĆ NIE MOŻE: żadnej atrapy `@/lib/**` ani
// `@/components/**`. Renderer woła te warstwy naprawdę (WidgetView, styl
// sekcji, kontrola dostępu, eksperymenty) - podmiana którejkolwiek z nich
// zamieniłaby test renderera w test atrapy.
import { vi } from "vitest";
import type {
  AccessControlSettings,
  AdvancedSettings,
  BuilderDocument,
  ColumnNode,
  InnerSectionNode,
  ResponsiveValue,
  SectionChild,
  SectionNode,
  SectionTabsConfig,
  WidgetNode,
  WidgetType,
} from "@/lib/builder/types";

/**
 * Widget o kształcie zgodnym ze schematem. `text_pl` jest kluczem, z którego
 * `WidgetView` czyta treść nagłówka/akapitu (patrz `pickI18n`), więc napis
 * podany tutaj FAKTYCZNIE ląduje w DOM - asercja nie mierzy pustego węzła.
 */
export function widget(
  id: string,
  type: WidgetType | string = "heading",
  extra: Partial<WidgetNode> = {},
): WidgetNode {
  return {
    id,
    kind: "widget",
    type,
    content: { text_pl: `T-${id}` },
    style: {},
    advanced: {},
    ...extra,
  } as WidgetNode;
}

export function column(
  id: string,
  children: WidgetNode[] = [],
  extra: Partial<ColumnNode> = {},
): ColumnNode {
  return {
    id,
    kind: "column",
    span: { desktop: 12 },
    children,
    ...extra,
  } as ColumnNode;
}

export function innerSection(
  id: string,
  columns: ColumnNode[] = [],
  extra: Partial<InnerSectionNode> = {},
): InnerSectionNode {
  return {
    id,
    kind: "inner-section",
    columns,
    ...extra,
  } as InnerSectionNode;
}

export function section(
  id: string,
  children: SectionChild[] = [],
  extra: Partial<SectionNode> = {},
): SectionNode {
  return {
    id,
    kind: "section",
    children,
    ...extra,
  } as SectionNode;
}

/** Dokument w wersji 1 - jedyny kształt, który przechodzi `safeParseBuilderDoc`. */
export function doc(sections: SectionNode[]): BuilderDocument {
  return { version: 1, sections };
}

/** Skrót: sekcja z jedną kolumną i jednym nagłówkiem. */
export function simpleSection(id: string, extra: Partial<SectionNode> = {}): SectionNode {
  return section(id, [column(`${id}-c`, [widget(`${id}-w`)])], extra);
}

export function tabsConfig(
  items: Array<{ id: string; label_pl?: string }>,
  extra: Partial<SectionTabsConfig> = {},
): SectionTabsConfig {
  return {
    enabled: true,
    items: items.map((i) => ({ id: i.id, label_pl: i.label_pl ?? `Zakładka ${i.id}` })),
    ...extra,
  } as SectionTabsConfig;
}

export const gate = (rule: AccessControlSettings): AdvancedSettings => ({ access: rule });

export const hideOn = (
  bp: Partial<Record<"desktop" | "tablet" | "mobile", boolean>>,
): AdvancedSettings => ({ hideOn: bp });

export const responsive = (v: ResponsiveValue<number>): ResponsiveValue<number> => v;

// ---------------------------------------------------------------------------
// Globalne atrapy przeglądarki
// ---------------------------------------------------------------------------

interface ObserverStubs {
  /** Wywołuje wszystkie zarejestrowane `IntersectionObserver`. */
  triggerIntersection: (isIntersecting: boolean) => void;
  /** Wywołuje wszystkie zarejestrowane `ResizeObserver`. */
  triggerResize: () => void;
  restore: () => void;
}

type IoCallback = (entries: Array<{ isIntersecting: boolean }>) => void;

/**
 * happy-dom nie ma ANI `IntersectionObserver`, ANI `ResizeObserver`. Bez tych
 * atrap gałęzie `typeof X === "undefined"` w rendererze (wideo tła L445,
 * korekta urządzenia L237, `useSectionPreload`) po cichu wybierają ramię
 * „przeglądarka tego nie umie" i NIGDY nie wykonują właściwego kodu.
 */
export function stubObservers(): ObserverStubs {
  const ioCallbacks: IoCallback[] = [];
  const roCallbacks: Array<() => void> = [];
  const priorIo = (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver;
  const priorRo = (globalThis as { ResizeObserver?: unknown }).ResizeObserver;

  class IoStub {
    constructor(cb: IoCallback) {
      ioCallbacks.push(cb);
    }
    observe = vi.fn();
    unobserve = vi.fn();
    disconnect = vi.fn();
    takeRecords = vi.fn(() => []);
    root = null;
    rootMargin = "";
    thresholds: number[] = [];
  }
  class RoStub {
    constructor(cb: () => void) {
      roCallbacks.push(cb);
    }
    observe = vi.fn();
    unobserve = vi.fn();
    disconnect = vi.fn();
  }

  Object.defineProperty(globalThis, "IntersectionObserver", {
    configurable: true,
    writable: true,
    value: IoStub,
  });
  Object.defineProperty(globalThis, "ResizeObserver", {
    configurable: true,
    writable: true,
    value: RoStub,
  });

  return {
    triggerIntersection: (isIntersecting: boolean) => {
      for (const cb of ioCallbacks) cb([{ isIntersecting }]);
    },
    triggerResize: () => {
      for (const cb of roCallbacks) cb();
    },
    restore: () => {
      Object.defineProperty(globalThis, "IntersectionObserver", {
        configurable: true,
        writable: true,
        value: priorIo,
      });
      Object.defineProperty(globalThis, "ResizeObserver", {
        configurable: true,
        writable: true,
        value: priorRo,
      });
    },
  };
}

/**
 * Ustawia szerokość okna. Renderer woli `clientWidth` korzenia, a happy-dom
 * zawsze zwraca tam 0, więc W TESTACH decyduje właśnie `window.innerWidth` -
 * i to jest gałąź awaryjna z L232.
 */
export function setWindowWidth(width: number): void {
  Object.defineProperty(window, "innerWidth", { configurable: true, writable: true, value: width });
}

/** Podstawia `clientWidth` KAŻDEMU elementowi (happy-dom nie robi layoutu). */
export function stubClientWidth(width: number): () => void {
  const proto = window.HTMLElement.prototype as unknown as Record<string, unknown>;
  const prior = Object.getOwnPropertyDescriptor(proto, "clientWidth");
  Object.defineProperty(proto, "clientWidth", { configurable: true, get: () => width });
  return () => {
    if (prior) Object.defineProperty(proto, "clientWidth", prior);
    else delete proto.clientWidth;
  };
}

/** Ustawia odpowiedź `matchMedia` (renderer czyta `prefers-reduced-motion`). */
export function stubMatchMedia(matches: boolean): () => void {
  const prior = window.matchMedia;
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: (query: string) => ({
      matches,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }),
  });
  return () => {
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      writable: true,
      value: prior,
    });
  };
}
