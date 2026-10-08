// LOADER BOOTU (P2.1, P3.4) - kontrakt skryptu, który jest STRINGIEM, a nie modułem.
//
// Skrypt stoi w `<head>` jako klasyczny inline i decyduje, KIEDY aplikacja w ogóle wystartuje:
// za wcześnie = JS w grafie LCP Lanterna (cały zysk P2.1 znika), nigdy = statyczny SSR bez
// hydratacji (klasa incydentu 2026-07-20). Nic go nie typuje, więc jedyny dowód to WYKONAĆ go
// w dokumencie i zmierzyć skutki. Każdy przypadek dostaje WŁASNE okno happy-dom: skrypt
// zakłada nasłuchy na `window`/`document`, a wspólne okno pliku testowego mieszałoby stany
// kolejnych przypadków.
//
// Przedmiot dowodu (bootLoaderScript.ts, nagłówek): wyzwalacze `now`/`lcp` i zapasy, reguły
// (i)/(ii) przyjęcia wpisu LCP, leniwy odczyt `#nes-boot-set` (po skrypcie - przy DCL, bez
// obserwatora mutacji), usunięcie węzła przed wstawieniem wejścia, wejście NIGDY przed końcem
// parsowania dokumentu (poprawka po Prove: moduł wstawiony skryptem jest `async`, a `hydrate()` bez
// ogona dokumentu rzuca), idempotencja, watchdog sondy i doktryna skryptu inline. P3.4: pole
// kandydata bez geometrii w handlerze DCL (K4i - pomiar w zadaniu po pierwszej klatce), seria
// jednym zadaniem z wejściem za każdym `modulepreload` (grupy zmierzone i wycofane).
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
/** rAF atrapy (16 ms) + `setTimeout(0)` zaplanowany w nim - zadanie po pierwszej klatce. */
const FRAME_MS = 17;

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
  /** Konstruktor `MutationObserver` widziany przez skrypt (P3.4: nie może go użyć). */
  mutationObserver: ReturnType<typeof vi.fn>;
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
  // Atrapa z licznikiem: odczyt geometrii w przeglądarce wymusza Style+Layout (K4i).
  Object.defineProperty(img, "getBoundingClientRect", {
    value: vi.fn(() => ({
      ...rect,
      width: rect.right - rect.left,
      height: rect.bottom - rect.top,
    })),
  });
  doc.body.appendChild(img);
  return img;
}

/** Licznik odczytów geometrii elementu z atrapą `getBoundingClientRect`. */
function rectReads(element: Element): number {
  return vi.mocked(element.getBoundingClientRect).mock.calls.length;
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
  const mutationObserver = vi.fn();
  new Function(
    "window",
    "document",
    "requestAnimationFrame",
    "MutationObserver",
    BOOT_LOADER_SCRIPT,
  )(win, doc, raf, mutationObserver);
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
    mutationObserver,
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
  it("zestaw `now` bootuje od razu: seria modulepreload, węzeł zestawu usunięty, wejście po DCL", () => {
    const h = runLoader({
      before: (doc) => doc.head.appendChild(bootSetNode(doc, { ...LCP_SET, m: "now" })),
    });
    expect(h.preloads()).toEqual(LCP_SET.u);
    expect(h.doc.getElementById(BOOT_SET_ELEMENT_ID)).toBeNull();
    expect(h.why()).toBe("now");
    // Loader stoi w `<head>`, dokument dopiero się parsuje: wejście i watchdog czekają na DCL.
    expect(h.modules()).toEqual([]);
    expect(h.arm).not.toHaveBeenCalled();
    h.dcl();
    expect(h.modules()).toEqual([ENTRY]);
    // Watchdog sondy uzbrojony w chwili wstawienia wejścia (krok 4).
    expect(h.arm).toHaveBeenCalledTimes(1);
  });

  it("dokument już sparsowany (`interactive`): `now` wstawia wejście od razu", () => {
    const h = runLoader({
      readyState: "interactive",
      before: (doc) => doc.head.appendChild(bootSetNode(doc, { ...LCP_SET, m: "now" })),
    });
    expect(h.preloads()).toEqual(LCP_SET.u);
    expect(h.modules()).toEqual([ENTRY]);
    expect(h.arm).toHaveBeenCalledTimes(1);
  });

  it("zapisana sesja (zalogowany) bootuje od razu także na stronie `lcp`", () => {
    const h = runLoader({
      before: (doc, win) => {
        win.localStorage.setItem("sb-abc-auth-token", '{"access_token":"x"}');
        doc.head.appendChild(bootSetNode(doc));
      },
    });
    expect(h.why()).toBe("now");
    expect(h.preloads()).toEqual(LCP_SET.u);
    h.dcl();
    expect(h.modules()).toEqual([ENTRY]);
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

  it("zestaw PO skrypcie (bufor routera za loaderem) - odczyt przy DCL, bez obserwatora mutacji", () => {
    const h = runLoader();
    expect(h.preloads()).toEqual([]);
    h.doc.head.appendChild(bootSetNode(h.doc, { ...LCP_SET, m: "now" }));
    vi.advanceTimersByTime(1_000);
    // P3.4: bez `MutationObserver(subtree)` na całym dokumencie w trakcie parsowania - węzeł
    // zestawu, który przyszedł po skrypcie, czyta handler DOMContentLoaded.
    expect(h.preloads()).toEqual([]);
    expect(h.mutationObserver).not.toHaveBeenCalled();
    h.dcl();
    expect(h.preloads()).toEqual(LCP_SET.u);
    expect(h.doc.getElementById(BOOT_SET_ELEMENT_ID)).toBeNull();
    expect(h.modules()).toEqual([ENTRY]);
    expect(h.why()).toBe("now");
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
    // Dokument HIT: DCL przed wpisem LCP (obsDCL 140-190 ms wobec obsLCP 185-263 ms w Prove).
    h.dcl();
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

  it("(ii) wpis NIE mniejszy od widocznego pola kandydata (zmierzonego po klatce) jest przyjęty", () => {
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

  it("(ii) duży wpis sprzed DCL zostaje oceniony po pierwszej klatce, gdy znane jest pole kandydata", () => {
    const h = lcpPage();
    const block = h.doc.createElement("section");
    h.doc.body.appendChild(block);
    FakeObserver.last?.emit({ element: block, size: 120_000 });
    vi.advanceTimersByTime(1_000);
    expect(h.modules()).toEqual([]);
    h.dcl();
    vi.advanceTimersByTime(FRAME_MS + BOOT_AFTER_LCP_DELAY_MS - 1);
    expect(h.modules()).toEqual([]);
    vi.advanceTimersByTime(1);
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
    vi.advanceTimersByTime(FRAME_MS + BOOT_AFTER_LCP_DELAY_MS);
    expect(h.why()).toBe("lcp");
  });

  it("kandydat poza oknem - `nocand` rozstrzygany po pierwszej klatce (rAF + setTimeout(0))", () => {
    let img: Element | null = null;
    const h = runLoader({
      before: (doc) => {
        doc.head.appendChild(bootSetNode(doc));
        img = candidate(doc, { left: 0, top: 2000, right: 400, bottom: 2200 });
      },
    });
    h.dcl();
    expect(h.modules()).toEqual([]);
    expect(rectReads(img as unknown as Element)).toBe(0);
    // rAF (16 ms w atrapie), potem `setTimeout(0)` zaplanowany w jego wywołaniu.
    vi.advanceTimersByTime(FRAME_MS);
    expect(h.modules()).toEqual([ENTRY]);
    expect(h.why()).toBe("nocand");
  });

  it("błąd obrazu kandydata - rAF + setTimeout(0), nie czekanie do limitu", () => {
    const h = lcpPage();
    h.img.dispatchEvent(new h.win.Event("error") as unknown as Event);
    vi.advanceTimersByTime(FRAME_MS);
    expect(h.why()).toBe("nocand");
  });

  it("pierwsza interakcja (capture) bootuje natychmiast", () => {
    const h = lcpPage();
    h.dcl();
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

// DOKUMENT W PORCJACH (poprawka po Prove P2.1). Wejście wstawione przed końcem parsowania
// wykonuje się od razu po pobraniu (moduł wstawiony skryptem jest `async`), a `hydrate()` TanStack
// bez ogona dokumentu (`window.$_TSR`) rzuca `Invariant failed` - odtworzone w e2e
// `consent-shell-geometry` („przerwa parsera w środku karty”) i sondą dokumentu w dwóch porcjach.
// Dla KAŻDEGO wyzwalacza, który może paść przed DOMContentLoaded: seria `modulepreload` rusza od
// razu (pobieranie bez wykonania), wejście i watchdog dopiero przy DCL, dokładnie raz.
describe("BOOT_LOADER_SCRIPT - wejście nigdy przed końcem parsowania", () => {
  const NOW_SET = { ...LCP_SET, m: "now" };
  const cases: ReadonlyArray<{
    name: string;
    why: string;
    set?: unknown;
    session?: boolean;
    fire?: (h: Harness, img: Element) => void;
  }> = [
    { name: "tryb serwera `now`", why: "now", set: NOW_SET },
    { name: "zapisana sesja (zalogowany, podgląd edytora)", why: "now", session: true },
    {
      name: "wpis LCP kandydata po elemencie (reguła (i))",
      why: "lcp",
      fire: (_h, img) => FakeObserver.last?.emit({ element: img, size: 90_000 }),
    },
    {
      name: "wpis LCP kandydata po URL-u (reguła (i))",
      why: "lcp",
      fire: () => FakeObserver.last?.emit({ url: "https://media.test/hero.avif", size: 1 }),
    },
    {
      name: "interakcja w trakcie ładowania",
      why: "input",
      fire: (h) => h.win.dispatchEvent(new h.win.Event("touchstart")),
    },
    {
      name: "błąd obrazu kandydata",
      why: "nocand",
      fire: (h, img) => img.dispatchEvent(new h.win.Event("error") as unknown as Event),
    },
  ];

  for (const c of cases) {
    it(`${c.name}: seria od razu, wejście dopiero przy DOMContentLoaded`, () => {
      let img: Element | null = null;
      const h = runLoader({
        before: (doc, win) => {
          if (c.session) win.localStorage.setItem("sb-abc-auth-token", '{"access_token":"x"}');
          doc.head.appendChild(bootSetNode(doc, c.set ?? LCP_SET));
          img = candidate(doc);
        },
      });
      c.fire?.(h, img as unknown as Element);
      // Najdłuższe opóźnienie wyzwalacza sprzed DCL to 50 ms (`lcp`) albo rAF + 0 (`nocand`);
      // dziesięć sekund bez DCL nie może wstawić wejścia - ogon dokumentu wciąż w drodze.
      vi.advanceTimersByTime(10_000);
      expect(h.why()).toBe(c.why);
      expect(h.preloads()).toEqual(LCP_SET.u);
      expect(h.modules()).toEqual([]);
      expect(h.arm).not.toHaveBeenCalled();
      h.dcl();
      expect(h.modules()).toEqual([ENTRY]);
      expect(h.arm).toHaveBeenCalledTimes(1);
      // Późniejsze zdarzenia nie dublują wejścia ani serii.
      h.win.dispatchEvent(new h.win.Event("load"));
      h.win.dispatchEvent(new h.win.Event("keydown"));
      vi.advanceTimersByTime(BOOT_HARD_CAP_MS + BOOT_AFTER_LOAD_DELAY_MS);
      expect(h.modules()).toEqual([ENTRY]);
      expect(h.preloads()).toEqual(LCP_SET.u);
      expect(h.arm).toHaveBeenCalledTimes(1);
    });
  }

  it("parsowanie skończone, DCL jeszcze nie wysłany (`interactive`): wejście od razu", () => {
    let img: Element | null = null;
    const h = runLoader({
      before: (doc) => {
        doc.head.appendChild(bootSetNode(doc));
        img = candidate(doc);
      },
    });
    // Między `readyState = "interactive"` a zdarzeniem DCL pętla zdarzeń może wykonać timer
    // wyzwalacza; dokument jest już sparsowany, więc czekanie na DCL nie jest potrzebne.
    h.setReadyState("interactive");
    FakeObserver.last?.emit({ element: img, size: 90_000 });
    vi.advanceTimersByTime(BOOT_AFTER_LCP_DELAY_MS);
    expect(h.modules()).toEqual([ENTRY]);
    expect(h.why()).toBe("lcp");
  });
});

// POLE KANDYDATA BEZ WYMUSZONEGO UKŁADU (P3.4, K4i). `getBoundingClientRect` w handlerze
// DOMContentLoaded wymuszał pełny Style+Layout dokumentu w zadaniu DCL (księga bazy W3 desktop4x:
// `Script:(dokument)` 98 ms obs., Style+Layout 71 ms). Pole (ii) i `nocand` dla kandydata poza
// oknem rozstrzyga zadanie po pierwszej klatce (rAF + `setTimeout(0)`), kiedy układ jest czysty.
describe("BOOT_LOADER_SCRIPT - pole kandydata bez wymuszonego układu (K4i)", () => {
  it("handler DOMContentLoaded nie czyta geometrii; pole liczy zadanie PO pierwszej klatce", () => {
    let img: Element | null = null;
    const h = runLoader({
      before: (doc) => {
        doc.head.appendChild(bootSetNode(doc));
        img = candidate(doc);
      },
    });
    const hero = img as unknown as Element;
    h.dcl();
    expect(rectReads(hero)).toBe(0);
    // Wywołanie rAF to jeszcze PRZED stylem i układem klatki - tu też bez odczytu.
    vi.advanceTimersByTime(FRAME_MS - 1);
    expect(rectReads(hero)).toBe(0);
    vi.advanceTimersByTime(1);
    expect(rectReads(hero)).toBe(1);
    // Pomiar jednorazowy: kolejne wpisy LCP i zapasy nie mierzą ponownie.
    FakeObserver.last?.emit({ element: h.doc.body, size: 10 });
    vi.advanceTimersByTime(BOOT_HARD_CAP_MS);
    expect(rectReads(hero)).toBe(1);
    expect(h.why()).toBe("cap");
  });

  it("dokument bez kandydata: `nocand` po klatce bez żadnego odczytu geometrii", () => {
    let other: Element | null = null;
    const h = runLoader({
      before: (doc) => {
        doc.head.appendChild(bootSetNode(doc));
        // Zwykły obraz (bez `data-lcp-candidate`) z licznikiem - loader nie może go mierzyć.
        other = candidate(doc);
        other.removeAttribute("data-lcp-candidate");
      },
    });
    h.dcl();
    expect(h.modules()).toEqual([]);
    vi.advanceTimersByTime(FRAME_MS);
    expect(h.why()).toBe("nocand");
    expect(h.modules()).toEqual([ENTRY]);
    expect(rectReads(other as unknown as Element)).toBe(0);
  });

  it("boot przed pomiarem (interakcja po DCL): zadanie po klatce nie dotyka geometrii", () => {
    let img: Element | null = null;
    const h = runLoader({
      before: (doc) => {
        doc.head.appendChild(bootSetNode(doc));
        img = candidate(doc);
      },
    });
    h.dcl();
    h.win.dispatchEvent(new h.win.Event("pointerdown"));
    expect(h.why()).toBe("input");
    vi.advanceTimersByTime(BOOT_HARD_CAP_MS);
    expect(rectReads(img as unknown as Element)).toBe(0);
    expect(h.modules()).toEqual([ENTRY]);
  });

  it("wpis kandydata (reguła (i)) nie czeka na pomiar pola", () => {
    let img: Element | null = null;
    const h = runLoader({
      before: (doc) => {
        doc.head.appendChild(bootSetNode(doc));
        img = candidate(doc);
      },
    });
    h.dcl();
    FakeObserver.last?.emit({ element: img, size: 1 });
    vi.advanceTimersByTime(BOOT_AFTER_LCP_DELAY_MS);
    expect(h.why()).toBe("lcp");
    expect(h.modules()).toEqual([ENTRY]);
  });
});

// SERIA JEDNYM ZADANIEM (P3.4). Wariant z grupami `modulepreload` w osobnych zadaniach nie
// podzielił `ScriptCatchup` (księga Prove) i został wycofany. Reguła CLS z werdyktu boot-js C3:
// cała seria jest zażądana w zadaniu wyzwalacza, a wejście stoi w `<head>` za KAŻDYM jej
// `modulepreload` - żaden moduł nie ewaluuje się przed zażądaniem wszystkich.
describe("BOOT_LOADER_SCRIPT - seria jednym zadaniem, wejście za całą serią", () => {
  /** Wejście stoi w `<head>` za każdym `modulepreload` serii. */
  function entryAfterAllPreloads(doc: Document): boolean {
    const entry = doc.head.querySelector('script[type="module"]');
    if (!entry) return false;
    return [...doc.head.querySelectorAll('link[rel="modulepreload"]')].every(
      (link) => (link.compareDocumentPosition(entry) & 4) !== 0,
    );
  }

  function page(): Harness & { img: Element } {
    let img: Element | null = null;
    const h = runLoader({
      before: (doc) => {
        doc.head.appendChild(bootSetNode(doc));
        img = candidate(doc);
      },
    });
    return { ...h, img: img as unknown as Element };
  }

  it("wyzwalacz po DCL: cała seria i wejście w tym samym zadaniu wyzwalacza", () => {
    const h = page();
    h.dcl();
    vi.advanceTimersByTime(FRAME_MS);
    FakeObserver.last?.emit({ element: h.img, size: 90_000 });
    vi.advanceTimersByTime(BOOT_AFTER_LCP_DELAY_MS - 1);
    expect(h.preloads()).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(h.why()).toBe("lcp");
    expect(h.preloads()).toEqual(LCP_SET.u);
    expect(h.modules()).toEqual([ENTRY]);
    expect(entryAfterAllPreloads(h.doc)).toBe(true);
    expect(h.arm).toHaveBeenCalledTimes(1);
  });

  it("wyzwalacz przed DCL: cała seria od razu, wejście przy DCL za każdym `modulepreload`", () => {
    const h = page();
    h.win.dispatchEvent(new h.win.Event("keydown"));
    expect(h.why()).toBe("input");
    expect(h.preloads()).toEqual(LCP_SET.u);
    expect(h.modules()).toEqual([]);
    h.dcl();
    expect(h.modules()).toEqual([ENTRY]);
    expect(entryAfterAllPreloads(h.doc)).toBe(true);
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
