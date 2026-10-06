// LOADER BOOTU (P2.1) - kontrakt skryptu, który jest STRINGIEM, a nie modułem.
//
// Skrypt stoi w `<head>` jako klasyczny inline i decyduje, KIEDY aplikacja w ogóle wystartuje:
// za wcześnie = JS w grafie LCP Lanterna (cały zysk P2.1 znika), nigdy = statyczny SSR bez
// hydratacji (klasa incydentu 2026-07-20). Nic go nie typuje, więc jedyny dowód to WYKONAĆ go
// w dokumencie i zmierzyć skutki. Każdy przypadek dostaje WŁASNE okno happy-dom: skrypt
// zakłada nasłuchy na `window`/`document`, a wspólne okno pliku testowego mieszałoby stany
// kolejnych przypadków.
//
// Przedmiot dowodu (bootLoaderScript.ts, nagłówek): wyzwalacze `now`/`lcp` i zapasy, reguły
// (i)/(ii) przyjęcia wpisu LCP, leniwy odczyt `#nes-boot-set` (także po skrypcie), usunięcie węzła
// przed wstawieniem wejścia, idempotencja, watchdog sondy i doktryna skryptu inline.
import { Window } from "happy-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  BOOT_AFTER_LCP_DELAY_MS,
  BOOT_AFTER_LOAD_DELAY_MS,
  BOOT_HARD_CAP_MS,
  BOOT_LOADER_ATTR,
  BOOT_LOADER_SCRIPT,
  BOOT_SET_ELEMENT_ID,
} from "../bootLoaderScript";

const ENTRY = "/assets/index-AbCdEf12.js";
const LCP_SET = { m: "lcp", e: ENTRY, u: [ENTRY, "/assets/vendor-react-x.js", "/assets/pl-y.js"] };

interface FakeEntry {
  element?: Element | null;
  url?: string;
  size: number;
}

/** `PerformanceObserver` z ręcznym podawaniem wpisów (happy-dom nie ma LCP). */
class FakeObserver {
  static supportedEntryTypes: readonly string[] = ["largest-contentful-paint"];
  static last: FakeObserver | null = null;
  options: unknown = null;
  disconnected = false;
  constructor(private readonly callback: (list: { getEntries(): FakeEntry[] }) => void) {
    FakeObserver.last = this;
  }
  observe(options: unknown): void {
    this.options = options;
  }
  disconnect(): void {
    this.disconnected = true;
  }
  emit(...entries: FakeEntry[]): void {
    this.callback({ getEntries: () => entries });
  }
}

interface Harness {
  win: Window;
  doc: Document;
  /** Stan parsowania dokumentu widziany przez skrypt. */
  setReadyState(state: "loading" | "interactive" | "complete"): void;
  dcl(): void;
  /** Wstawione przez boot `<link rel=modulepreload>` (href w kolejności). */
  preloads(): string[];
  /** Wstawione przez boot `<script type=module>` (src). */
  modules(): string[];
  why(): string | undefined;
  arm: ReturnType<typeof vi.fn>;
}

function bootSetNode(doc: Document, set: unknown = LCP_SET): Element {
  const node = doc.createElement("script");
  node.setAttribute("type", "application/json");
  node.id = BOOT_SET_ELEMENT_ID;
  node.textContent = JSON.stringify(set);
  return node;
}

function candidate(doc: Document, rect = { left: 0, top: 0, right: 400, bottom: 225 }): Element {
  const img = doc.createElement("img");
  img.setAttribute("data-lcp-candidate", "");
  img.setAttribute("src", "https://media.test/hero.avif");
  Object.defineProperty(img, "currentSrc", { value: "https://media.test/hero.avif" });
  Object.defineProperty(img, "getBoundingClientRect", {
    value: () => ({ ...rect, width: rect.right - rect.left, height: rect.bottom - rect.top }),
  });
  doc.body.appendChild(img);
  return img;
}

/**
 * Nowe okno + wykonanie skryptu. `before` przygotowuje dokument (zestaw, kandydaci, sesja)
 * przed startem skryptu - tak, jak zastałby go parser w `<head>`.
 */
function runLoader(
  options: {
    readyState?: "loading" | "interactive" | "complete";
    observer?: typeof FakeObserver | null;
    prerendering?: boolean;
    before?: (doc: Document, win: Window) => void;
  } = {},
): Harness {
  const win = new Window({
    url: "https://nes.test/",
    width: 412,
    height: 823,
    settings: { disableJavaScriptFileLoading: true, disableJavaScriptEvaluation: true },
  });
  const doc = win.document as unknown as Document;
  let readyState = options.readyState ?? "loading";
  Object.defineProperty(doc, "readyState", { configurable: true, get: () => readyState });
  if (options.prerendering) Object.defineProperty(doc, "prerendering", { value: true });
  Object.defineProperty(win, "PerformanceObserver", {
    configurable: true,
    value: options.observer === undefined ? FakeObserver : (options.observer ?? undefined),
  });
  const arm = vi.fn();
  Reflect.set(win, "__nesBootArm", arm);
  options.before?.(doc, win);
  const raf = (callback: () => void) => setTimeout(callback, 16);
  new Function(
    "window",
    "document",
    "requestAnimationFrame",
    "MutationObserver",
    BOOT_LOADER_SCRIPT,
  )(win, doc, raf, win.MutationObserver);
  return {
    win,
    doc,
    setReadyState: (state) => {
      readyState = state;
    },
    dcl: () => {
      readyState = "interactive";
      doc.dispatchEvent(new win.Event("DOMContentLoaded") as unknown as Event);
    },
    preloads: () =>
      [...doc.head.querySelectorAll('link[rel="modulepreload"]')].map(
        (l) => l.getAttribute("href") ?? "",
      ),
    modules: () =>
      [...doc.head.querySelectorAll('script[type="module"]')].map(
        (s) => s.getAttribute("src") ?? "",
      ),
    why: () => Reflect.get(win, "__nesBootWhy") as string | undefined,
    arm,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  FakeObserver.last = null;
});

afterEach(() => {
  vi.useRealTimers();
});

describe("BOOT_LOADER_SCRIPT - tryb `now`", () => {
  it("zestaw `now` bootuje od razu: seria modulepreload, wejście, węzeł zestawu usunięty", () => {
    const h = runLoader({
      before: (doc) => doc.head.appendChild(bootSetNode(doc, { ...LCP_SET, m: "now" })),
    });
    expect(h.preloads()).toEqual(LCP_SET.u);
    expect(h.modules()).toEqual([ENTRY]);
    expect(h.doc.getElementById(BOOT_SET_ELEMENT_ID)).toBeNull();
    expect(h.why()).toBe("now");
    // Watchdog sondy uzbrojony w chwili bootu (krok 4).
    expect(h.arm).toHaveBeenCalledTimes(1);
  });

  it("zapisana sesja (zalogowany) bootuje od razu także na stronie `lcp`", () => {
    const h = runLoader({
      before: (doc, win) => {
        win.localStorage.setItem("sb-abc-auth-token", '{"access_token":"x"}');
        doc.head.appendChild(bootSetNode(doc));
      },
    });
    expect(h.modules()).toEqual([ENTRY]);
    expect(h.why()).toBe("now");
  });

  it("`document.prerendering` bootuje od razu", () => {
    const h = runLoader({
      prerendering: true,
      before: (doc) => doc.head.appendChild(bootSetNode(doc)),
    });
    expect(h.why()).toBe("now");
  });

  it("przeglądarka bez wpisów `largest-contentful-paint` (Safari) bootuje od razu", () => {
    class NoLcp extends FakeObserver {
      static override supportedEntryTypes = ["paint", "resource"];
    }
    const h = runLoader({ observer: NoLcp, before: (d) => d.head.appendChild(bootSetNode(d)) });
    expect(h.why()).toBe("now");
    const none = runLoader({ observer: null, before: (d) => d.head.appendChild(bootSetNode(d)) });
    expect(none.why()).toBe("now");
  });

  it("zestaw PO skrypcie (bufor routera za loaderem) - boot w chwili pojawienia się węzła", async () => {
    vi.useRealTimers();
    const h = runLoader();
    expect(h.modules()).toEqual([]);
    h.doc.head.appendChild(bootSetNode(h.doc, { ...LCP_SET, m: "now" }));
    await vi.waitFor(() => expect(h.modules()).toEqual([ENTRY]));
    expect(h.doc.getElementById(BOOT_SET_ELEMENT_ID)).toBeNull();
  });

  it("brak zestawu przy DOMContentLoaded (dev: `<Scripts>` startuje sam) - nic nie wstawia", () => {
    const h = runLoader();
    h.dcl();
    vi.advanceTimersByTime(BOOT_HARD_CAP_MS + BOOT_AFTER_LOAD_DELAY_MS + 100);
    expect(h.preloads()).toEqual([]);
    expect(h.modules()).toEqual([]);
    expect(h.why()).toBeUndefined();
  });

  it("zepsuty JSON zestawu to brak zestawu, nie wyjątek w `<head>`", () => {
    const h = runLoader({
      before: (doc) => {
        const node = bootSetNode(doc);
        node.textContent = "{nie-json";
        doc.head.appendChild(node);
      },
    });
    h.dcl();
    vi.advanceTimersByTime(BOOT_HARD_CAP_MS + 100);
    expect(h.modules()).toEqual([]);
  });
});

describe("BOOT_LOADER_SCRIPT - tryb `lcp`", () => {
  function lcpPage(): Harness & { img: Element } {
    let img: Element | null = null;
    const h = runLoader({
      before: (doc) => {
        doc.head.appendChild(bootSetNode(doc));
        img = candidate(doc);
      },
    });
    return { ...h, img: img as unknown as Element };
  }

  it("nie bootuje przed wpisem LCP; obserwator z `buffered: true`", () => {
    const h = lcpPage();
    expect(FakeObserver.last?.options).toEqual({
      type: "largest-contentful-paint",
      buffered: true,
    });
    vi.advanceTimersByTime(1_000);
    expect(h.modules()).toEqual([]);
  });

  it("(i) wpis kandydata po elemencie: boot po 50 ms, obserwator odłączony", () => {
    const h = lcpPage();
    FakeObserver.last?.emit({ element: h.img, url: "https://media.test/hero.avif", size: 40_000 });
    vi.advanceTimersByTime(BOOT_AFTER_LCP_DELAY_MS - 1);
    expect(h.modules()).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(h.modules()).toEqual([ENTRY]);
    expect(h.why()).toBe("lcp");
    expect(FakeObserver.last?.disconnected).toBe(true);
  });

  it("(i) wpis kandydata po URL-u (element zdjęty z DOM-u, np. slajd przesunięty)", () => {
    const h = lcpPage();
    FakeObserver.last?.emit({ element: null, url: "https://media.test/hero.avif", size: 1 });
    vi.advanceTimersByTime(BOOT_AFTER_LCP_DELAY_MS);
    expect(h.why()).toBe("lcp");
  });

  it("mniejszy wpis tekstu (font-display: swap) przed DCL jest ignorowany", () => {
    const h = lcpPage();
    const text = h.doc.createElement("p");
    h.doc.body.appendChild(text);
    FakeObserver.last?.emit({ element: text, size: 12_000 });
    h.dcl();
    vi.advanceTimersByTime(BOOT_HARD_CAP_MS - 1);
    // Pole kandydata 400 x 225 = 90 000 > 12 000: wpis tekstu nie jest ostatecznym LCP.
    expect(h.modules()).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(h.why()).toBe("cap");
  });

  it("(ii) wpis NIE mniejszy od widocznego pola kandydata (zmierzonego przy DCL) jest przyjęty", () => {
    const h = lcpPage();
    const shell = h.doc.createElement("div");
    h.doc.body.appendChild(shell);
    h.dcl();
    FakeObserver.last?.emit({ element: shell, size: 89_999 });
    vi.advanceTimersByTime(BOOT_AFTER_LCP_DELAY_MS);
    expect(h.modules()).toEqual([]);
    FakeObserver.last?.emit({ element: shell, size: 90_000 });
    vi.advanceTimersByTime(BOOT_AFTER_LCP_DELAY_MS);
    expect(h.why()).toBe("lcp");
  });

  it("(ii) duży wpis sprzed DCL zostaje oceniony w DCL, gdy znane jest pole kandydata", () => {
    const h = lcpPage();
    const block = h.doc.createElement("section");
    h.doc.body.appendChild(block);
    FakeObserver.last?.emit({ element: block, size: 120_000 });
    vi.advanceTimersByTime(1_000);
    expect(h.modules()).toEqual([]);
    h.dcl();
    vi.advanceTimersByTime(BOOT_AFTER_LCP_DELAY_MS);
    expect(h.why()).toBe("lcp");
  });

  it("pole kandydata to część WIDOCZNA w oknie (kandydat częściowo pod zgięciem)", () => {
    let img: Element | null = null;
    const h = runLoader({
      before: (doc) => {
        doc.head.appendChild(bootSetNode(doc));
        // Okno 412 x 823; obraz 0..412 x 700..1000 - widoczne 412 x 123 = 50 676.
        img = candidate(doc, { left: 0, top: 700, right: 412, bottom: 1000 });
      },
    });
    expect(img).not.toBeNull();
    const text = h.doc.createElement("p");
    h.doc.body.appendChild(text);
    h.dcl();
    FakeObserver.last?.emit({ element: text, size: 50_676 });
    vi.advanceTimersByTime(BOOT_AFTER_LCP_DELAY_MS);
    expect(h.why()).toBe("lcp");
  });

  it("brak WIDOCZNEGO kandydata przy DCL - rAF + setTimeout(0)", () => {
    const h = runLoader({
      before: (doc) => {
        doc.head.appendChild(bootSetNode(doc));
        candidate(doc, { left: 0, top: 2000, right: 400, bottom: 2200 });
      },
    });
    h.dcl();
    expect(h.modules()).toEqual([]);
    // rAF (16 ms w atrapie), potem `setTimeout(0)` zaplanowany w jego wywołaniu.
    vi.advanceTimersByTime(17);
    expect(h.modules()).toEqual([ENTRY]);
    expect(h.why()).toBe("nocand");
  });

  it("błąd obrazu kandydata - rAF + setTimeout(0), nie czekanie do limitu", () => {
    const h = lcpPage();
    h.img.dispatchEvent(new h.win.Event("error") as unknown as Event);
    vi.advanceTimersByTime(17);
    expect(h.why()).toBe("nocand");
  });

  it("pierwsza interakcja (capture) bootuje natychmiast", () => {
    const h = lcpPage();
    h.win.dispatchEvent(new h.win.Event("pointerdown"));
    expect(h.modules()).toEqual([ENTRY]);
    expect(h.why()).toBe("input");
  });

  it("`load` czeka jeszcze 500 ms na przyjęty wpis", () => {
    const h = lcpPage();
    h.dcl();
    h.win.dispatchEvent(new h.win.Event("load"));
    vi.advanceTimersByTime(BOOT_AFTER_LOAD_DELAY_MS - 1);
    expect(h.modules()).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(h.why()).toBe("load");
  });

  it("twardy limit DCL + 3 s", () => {
    const h = lcpPage();
    h.dcl();
    vi.advanceTimersByTime(BOOT_HARD_CAP_MS);
    expect(h.why()).toBe("cap");
  });

  it("boot jest jednorazowy: kolejne wyzwalacze nie dublują serii ani wejścia", () => {
    const h = lcpPage();
    FakeObserver.last?.emit({ element: h.img, size: 90_000 });
    vi.advanceTimersByTime(BOOT_AFTER_LCP_DELAY_MS);
    h.win.dispatchEvent(new h.win.Event("keydown"));
    h.dcl();
    h.win.dispatchEvent(new h.win.Event("load"));
    vi.advanceTimersByTime(BOOT_HARD_CAP_MS + BOOT_AFTER_LOAD_DELAY_MS);
    expect(h.modules()).toEqual([ENTRY]);
    expect(h.preloads()).toEqual(LCP_SET.u);
    expect(h.arm).toHaveBeenCalledTimes(1);
  });

  it("interakcja przed odczytem zestawu bootuje w chwili, gdy zestaw jest znany", () => {
    const h = runLoader();
    h.win.dispatchEvent(new h.win.Event("touchstart"));
    expect(h.modules()).toEqual([]);
    h.doc.head.appendChild(bootSetNode(h.doc));
    h.dcl();
    expect(h.modules()).toEqual([ENTRY]);
    expect(h.why()).toBe("input");
  });
});

describe("BOOT_LOADER_SCRIPT - doktryna skryptu inline", () => {
  it("jedno IIFE, klasyczny skrypt (bez składni modułowej), parsuje się jako ES5-owy kod", () => {
    expect(BOOT_LOADER_SCRIPT.startsWith("(function(){")).toBe(true);
    expect(BOOT_LOADER_SCRIPT.endsWith("})();")).toBe(true);
    expect(BOOT_LOADER_SCRIPT).not.toMatch(/\bimport\b|\bexport\b|=>|\bconst\b|\blet\b|`/);
    expect(() => new Function(BOOT_LOADER_SCRIPT)).not.toThrow();
  });

  it("tekst nie domyka znacznika `<script>` ani komentarza HTML", () => {
    expect(BOOT_LOADER_SCRIPT).not.toMatch(/<\/script|<!--/i);
  });

  it("nie dotyka sieci ani zapisu storage - tylko wstawia moduły i CZYTA sesję", () => {
    for (const forbidden of ["fetch(", "sendBeacon", "XMLHttpRequest", "setItem", "cookie"]) {
      expect(BOOT_LOADER_SCRIPT, `loader dotyka ${forbidden}`).not.toContain(forbidden);
    }
  });

  it("atrybut węzła loadera jest tym, którego szuka klient przy hydratacji (`__root.tsx`)", () => {
    expect(BOOT_LOADER_ATTR).toBe("data-nes-boot");
  });
});
