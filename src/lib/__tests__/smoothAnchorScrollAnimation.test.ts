// Animowane przewijanie do kotwicy - `smoothScrollToAnchor`.
//
// CO TO DOWODZI. Funkcja miała 0% pokrycia przy 78 niepokrytych liniach i jest
// na ścieżce każdego spisu treści oraz każdego odnośnika w treści. Trzy rzeczy
// mają tu koszt większy niż „przewinęło się nieładnie":
//   1. `prefers-reduced-motion: reduce` MUSI przeskoczyć bez animacji - to
//      wymóg dostępności (WCAG 2.3.3), nie kosmetyka: animowane przewijanie
//      wywołuje objawy u osób z zaburzeniami przedsionkowymi;
//   2. INTENCJA UŻYTKOWNIKA przerywa animację - bez tego kółko myszy walczy
//      z animacją i strona „ucieka" pod palcami;
//   3. STYLE MUSZĄ WRÓCIĆ - funkcja podmienia `scroll-behavior` i
//      `overflow-anchor` na `documentElement` i `body`; niesprzątnięte
//      zostawiają całą stronę bez zakotwiczenia przewijania.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE. `getAnchorScrollOffset` i
// `replaceHashPreservingRouterState` mają testy w `src/lib/smoothAnchorScroll.test.ts`
// (offset z wysokości nagłówka, hash bez włączania przewijania routera) - tu
// tylko korzystamy z ich wyniku. Krzywa `easeInOutCubic` nie jest sprawdzana
// wartość po wartości; sprawdzana jest MONOTONICZNOŚĆ i punkt końcowy, bo tylko
// one są obietnicą wobec czytelnika.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { smoothScrollToAnchor } from "../smoothAnchorScroll";

/** Sterowany zegar klatek: test decyduje, kiedy pada następna klatka. */
interface FrameDriver {
  /** Wykonuje jedną klatkę w podanym czasie od startu. */
  tick(atMs: number): void;
  /** Ile klatek zostało zamówionych. */
  requested(): number;
  /** Czy animacja czeka na kolejną klatkę. */
  pending(): boolean;
}

let frames: Map<number, FrameRequestCallback>;
let nextFrameId: number;
let cancelled: number[];
let scrolled: number[];
let now: number;
let reduceMotion: boolean;

function driver(): FrameDriver {
  return {
    tick(atMs) {
      const entries = [...frames.entries()];
      frames.clear();
      now = atMs;
      for (const [, cb] of entries) cb(atMs);
    },
    requested: () => nextFrameId - 1,
    pending: () => frames.size > 0,
  };
}

/** Kotwica o zadanej pozycji względem okna. */
function anchor(id: string, topInViewport: number): HTMLElement {
  const el = document.createElement("div");
  el.id = id;
  document.body.appendChild(el);
  el.getBoundingClientRect = () => ({
    x: 0,
    y: topInViewport,
    width: 100,
    height: 20,
    top: topInViewport,
    right: 100,
    bottom: topInViewport + 20,
    left: 0,
    toJSON: () => ({}),
  });
  return el;
}

beforeEach(() => {
  frames = new Map();
  nextFrameId = 1;
  cancelled = [];
  scrolled = [];
  now = 0;
  reduceMotion = false;

  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: (query: string) => ({
      matches: query.includes("prefers-reduced-motion") ? reduceMotion : false,
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }),
  });
  Object.defineProperty(window, "scrollY", { configurable: true, value: 0, writable: true });
  Object.defineProperty(window, "scrollTo", {
    configurable: true,
    value: (opts: { top: number }) => scrolled.push(opts.top),
  });
  Object.defineProperty(window, "requestAnimationFrame", {
    configurable: true,
    value: (cb: FrameRequestCallback) => {
      const id = nextFrameId++;
      frames.set(id, cb);
      return id;
    },
  });
  Object.defineProperty(window, "cancelAnimationFrame", {
    configurable: true,
    value: (id: number) => {
      cancelled.push(id);
      frames.delete(id);
    },
  });
  Object.defineProperty(window.performance, "now", { configurable: true, value: () => now });
});

afterEach(() => {
  // Animacja pozostawiona w biegu przywróciłaby SWOJE zapamiętane style przy
  // pierwszym wywołaniu w następnym przypadku (`cancelSmoothAnchorScroll` na
  // wejściu `smoothScrollToAnchor`) - i zjadłaby styl ustawiony przez ten
  // przypadek. Przerywamy ją, ZANIM wyzerujemy style.
  window.dispatchEvent(new Event("wheel"));
  document.body.innerHTML = "";
  window.history.replaceState(null, "", "/");
  document.documentElement.style.scrollBehavior = "";
  document.documentElement.style.overflowAnchor = "";
  document.body.style.scrollBehavior = "";
  document.body.style.overflowAnchor = "";
  vi.unstubAllGlobals();
});

describe("dostępność: prefers-reduced-motion", () => {
  it("przeskakuje BEZ animacji, gdy użytkownik prosi o mniej ruchu", () => {
    // Sedno tego testu: ZERO zamówionych klatek. Animacja z jedną klatką
    // spełniłaby „przewinęło się", a nie spełniłaby wymogu dostępności.
    reduceMotion = true;
    anchor("sekcja", 1200);
    const onFinish = vi.fn();
    smoothScrollToAnchor("sekcja", { onFinish, offset: 80 });
    expect(scrolled).toEqual([1120]);
    expect(driver().requested()).toBe(0);
    expect(onFinish).toHaveBeenCalledTimes(1);
  });

  it("animuje, gdy użytkownik nie prosi o mniej ruchu", () => {
    reduceMotion = false;
    anchor("sekcja", 1200);
    smoothScrollToAnchor("sekcja", { offset: 80 });
    expect(driver().pending()).toBe(true);
  });
});

describe("wybór kotwicy", () => {
  it("nieistniejąca kotwica nie przewija i nie rusza adresu", () => {
    window.history.replaceState(null, "", "/artykul");
    smoothScrollToAnchor("nie-ma-takiej");
    expect(scrolled).toEqual([]);
    expect(window.location.hash).toBe("");
  });

  it("kotwica z polskim znakiem w identyfikatorze działa", () => {
    // Identyfikatory nagłówków są generowane ze slugów tytułów, więc `ś`, `ż`
    // i `ą` trafiają do `id` regularnie.
    anchor("wyzwania-gospodarcze-śląska", 500);
    smoothScrollToAnchor("wyzwania-gospodarcze-śląska", { offset: 80 });
    expect(driver().pending()).toBe(true);
    expect(decodeURIComponent(window.location.hash)).toBe("#wyzwania-gospodarcze-śląska");
  });

  it("kotwica bliżej niż 2 px przeskakuje bez animacji", () => {
    // Animacja na dystansie poniżej progu to migotanie bez wartości.
    anchor("sekcja", 81);
    smoothScrollToAnchor("sekcja", { offset: 80 });
    expect(scrolled).toEqual([1]);
    expect(driver().requested()).toBe(0);
  });

  it("kotwica nad początkiem dokumentu nie przewija na wartość ujemną", () => {
    anchor("sekcja", -500);
    smoothScrollToAnchor("sekcja", { offset: 80 });
    const driven = driver();
    driven.tick(10_000);
    expect(Math.min(...scrolled)).toBeGreaterThanOrEqual(0);
  });
});

describe("przebieg animacji", () => {
  it("dochodzi DOKŁADNIE do celu i woła onFinish raz", () => {
    anchor("sekcja", 1000);
    const onFinish = vi.fn();
    smoothScrollToAnchor("sekcja", { offset: 80, minDuration: 500, maxDuration: 500, onFinish });
    const driven = driver();
    driven.tick(250);
    expect(onFinish).not.toHaveBeenCalled();
    driven.tick(500);
    // Ostatnia pozycja musi być celem co do piksela - inaczej nagłówek zostaje
    // ścięty o kilka pikseli i czytelnik widzi urwany tytuł.
    expect(scrolled[scrolled.length - 1]).toBe(920);
    expect(onFinish).toHaveBeenCalledTimes(1);
    expect(driven.pending()).toBe(false);
  });

  it("przewija monotonicznie w stronę celu", () => {
    anchor("sekcja", 2000);
    smoothScrollToAnchor("sekcja", { offset: 80, minDuration: 800, maxDuration: 800 });
    const driven = driver();
    for (const t of [100, 200, 400, 600, 800]) driven.tick(t);
    const rosnie = scrolled.every((v, i) => i === 0 || v >= scrolled[i - 1]);
    expect(rosnie).toBe(true);
    expect(scrolled[scrolled.length - 1]).toBe(1920);
  });

  it("czas trwania jest ograniczony z obu stron", () => {
    // Krótki dystans nie może dawać animacji 20 ms (migotanie), a długi -
    // kilku sekund (czytelnik czeka).
    anchor("blisko", 300);
    smoothScrollToAnchor("blisko", { offset: 80, minDuration: 600, maxDuration: 1800 });
    const driven = driver();
    driven.tick(599);
    expect(driven.pending()).toBe(true);
    driven.tick(600);
    expect(driven.pending()).toBe(false);
  });

  it("nadąża za celem, gdy układ strony przesunie się w trakcie", () => {
    // Obrazy doczytują się w trakcie przewijania i przesuwają kotwicę w dół;
    // bez przeliczania celu animacja kończy się w złym miejscu.
    const el = anchor("sekcja", 1000);
    smoothScrollToAnchor("sekcja", { offset: 80, minDuration: 400, maxDuration: 400 });
    const driven = driver();
    driven.tick(100);
    el.getBoundingClientRect = () => ({
      x: 0,
      y: 1500,
      width: 100,
      height: 20,
      top: 1500,
      right: 100,
      bottom: 1520,
      left: 0,
      toJSON: () => ({}),
    });
    driven.tick(400);
    expect(scrolled[scrolled.length - 1]).toBe(1420);
  });
});

describe("intencja użytkownika przerywa animację", () => {
  it.each(["wheel", "touchstart", "keydown"])(
    "zdarzenie %s przerywa i NIE woła onFinish",
    (typ) => {
      anchor("sekcja", 2000);
      const onFinish = vi.fn();
      smoothScrollToAnchor("sekcja", { offset: 80, onFinish });
      const driven = driver();
      driven.tick(100);
      const przedPrzerwaniem = scrolled.length;
      window.dispatchEvent(new Event(typ));
      driven.tick(200);
      // Animacja nie może dopisać ani jednej klatki po przerwaniu, a `onFinish`
      // nie może się odpalić - wołający uznałby przewijanie za zakończone.
      expect(scrolled.length).toBe(przedPrzerwaniem);
      expect(onFinish).not.toHaveBeenCalled();
      expect(cancelled.length).toBeGreaterThan(0);
    },
  );

  it("przerwanie przywraca style dokumentu", () => {
    document.documentElement.style.scrollBehavior = "smooth";
    document.body.style.overflowAnchor = "auto";
    anchor("sekcja", 2000);
    smoothScrollToAnchor("sekcja", { offset: 80 });
    expect(document.documentElement.style.scrollBehavior).toBe("auto");
    window.dispatchEvent(new Event("wheel"));
    expect(document.documentElement.style.scrollBehavior).toBe("smooth");
    expect(document.body.style.overflowAnchor).toBe("auto");
  });

  it("zakończona animacja przywraca style dokumentu", () => {
    // Niesprzątnięty `overflow-anchor: none` zostaje na CAŁEJ stronie.
    document.documentElement.style.overflowAnchor = "auto";
    anchor("sekcja", 1000);
    smoothScrollToAnchor("sekcja", { offset: 80, minDuration: 100, maxDuration: 100 });
    driver().tick(100);
    expect(document.documentElement.style.overflowAnchor).toBe("auto");
    expect(document.documentElement.style.scrollBehavior).toBe("");
  });
});

describe("adres i opcje", () => {
  it("domyślnie dopisuje kotwicę do adresu", () => {
    anchor("sekcja", 1000);
    window.history.replaceState(null, "", "/artykul?lang=pl");
    smoothScrollToAnchor("sekcja", { offset: 80 });
    expect(window.location.hash).toBe("#sekcja");
    expect(window.location.search).toBe("?lang=pl");
  });

  it("`updateHash: false` nie rusza adresu", () => {
    // Przewijanie sterowane obserwatorem sekcji nie może zaśmiecać historii.
    anchor("sekcja", 1000);
    window.history.replaceState(null, "", "/artykul");
    smoothScrollToAnchor("sekcja", { offset: 80, updateHash: false });
    expect(window.location.hash).toBe("");
  });

  it("wyłącza przewijanie po hashu w routerze dla bieżącego wpisu historii", () => {
    // Bez tego router przewinąłby drugi raz, skokowo, w połowie animacji.
    anchor("sekcja", 1000);
    smoothScrollToAnchor("sekcja", { offset: 80 });
    expect(window.history.state).toMatchObject({ __hashScrollIntoViewOptions: false });
  });

  it("drugie wywołanie przerywa pierwsze", () => {
    // Dwie animacje naraz walczyłyby o `window.scrollTo` w tej samej klatce.
    anchor("a", 1000);
    anchor("b", 2000);
    const pierwszy = vi.fn();
    smoothScrollToAnchor("a", { offset: 80, onFinish: pierwszy });
    smoothScrollToAnchor("b", { offset: 80, minDuration: 100, maxDuration: 100 });
    driver().tick(100);
    expect(pierwszy).not.toHaveBeenCalled();
    expect(scrolled[scrolled.length - 1]).toBe(1920);
  });
});

describe("wartości domyślne i kształt stanu historii", () => {
  it("bez podanych opcji bierze offset z nagłówka i domyślny czas trwania", () => {
    // Wywołanie bez opcji to najczęstsza forma w kodzie (spis treści, odnośniki
    // w treści) - i jedyna, w której działają wartości domyślne.
    document.body.innerHTML = "";
    anchor("sekcja", 3000);
    smoothScrollToAnchor("sekcja");
    const driven = driver();
    // Brak nagłówka w drzewie -> offset domyślny 80; dystans 2920 -> czas
    // 2920*0,58 = 1693,6 ms, w granicach [520, 1800].
    driven.tick(1693);
    expect(driven.pending()).toBe(true);
    driven.tick(1694);
    expect(scrolled[scrolled.length - 1]).toBe(2920);
  });

  it("długi dystans jest ucinany do maksymalnego czasu trwania", () => {
    anchor("sekcja", 50_000);
    smoothScrollToAnchor("sekcja");
    const driven = driver();
    driven.tick(1800);
    expect(driven.pending()).toBe(false);
    expect(scrolled[scrolled.length - 1]).toBe(49_920);
  });

  it("stan historii będący TABLICĄ nie jest rozlewany do obiektu", () => {
    // `{...tablica}` dałoby `{0: ..., 1: ...}` i zgubiłoby dane routera; kod ma
    // na to jawny `!Array.isArray`, więc tablica jest zastępowana, nie scalana.
    window.history.replaceState(["a", "b"], "", "/artykul");
    anchor("sekcja", 1000);
    smoothScrollToAnchor("sekcja", { offset: 80 });
    expect(window.history.state).toEqual({ __hashScrollIntoViewOptions: false });
  });

  it("brak stanu historii daje sam znacznik", () => {
    window.history.replaceState(null, "", "/artykul");
    anchor("sekcja", 1000);
    smoothScrollToAnchor("sekcja", { offset: 80 });
    expect(window.history.state).toEqual({ __hashScrollIntoViewOptions: false });
  });

  it("istniejący stan routera jest zachowany, nie nadpisany", () => {
    window.history.replaceState({ key: "wpis-routera" }, "", "/artykul");
    anchor("sekcja", 1000);
    smoothScrollToAnchor("sekcja", { offset: 80 });
    expect(window.history.state).toEqual({
      key: "wpis-routera",
      __hashScrollIntoViewOptions: false,
    });
  });

  it("przerwanie po zakończeniu nie sprząta drugi raz", () => {
    // `cleanup` ma strażnik `cleaned`; bez niego drugie sprzątnięcie
    // przywróciłoby style zapamiętane PO pierwszym przywróceniu.
    document.documentElement.style.scrollBehavior = "smooth";
    anchor("sekcja", 1000);
    smoothScrollToAnchor("sekcja", { offset: 80, minDuration: 100, maxDuration: 100 });
    driver().tick(100);
    expect(document.documentElement.style.scrollBehavior).toBe("smooth");
    window.dispatchEvent(new Event("wheel"));
    expect(document.documentElement.style.scrollBehavior).toBe("smooth");
  });
});

describe("offset nagłówka - przypadki brzegowe", () => {
  it("nagłówek o ZEROWEJ wysokości nie zabiera offsetu", () => {
    // Nagłówek schowany (`height: 0`) albo wywinięty za górną krawędź nie może
    // przesuwać kotwicy - inaczej tytuł ląduje pod niewidzialnym paskiem.
    const header = document.createElement("header");
    header.setAttribute("data-site-header", "");
    document.body.appendChild(header);
    header.getBoundingClientRect = () => ({
      x: 0,
      y: 0,
      width: 100,
      height: 0,
      top: 0,
      right: 100,
      bottom: 0,
      left: 0,
      toJSON: () => ({}),
    });
    anchor("sekcja", 1000);
    smoothScrollToAnchor("sekcja", { minDuration: 100, maxDuration: 100 });
    driver().tick(100);
    // Offset domyślny 80, nie 12 z wysokości zerowej.
    expect(scrolled[scrolled.length - 1]).toBe(920);
  });
});
