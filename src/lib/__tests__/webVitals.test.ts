// Reporter Core Web Vitals (`src/lib/webVitals.ts`) - pierwszy test tego pliku.
//
// DLACZEGO GO NIE BYŁO. Jedyny test, który w ogóle wspominał ten moduł,
// MOCKOWAŁ GO NA WYLOT: `src/lib/observability/index.test.ts:5` robi
// `vi.mock("@/lib/webVitals", () => ({ initWebVitals: vi.fn(() => () => {}) }))`
// i sprawdza wyłącznie liczbę wywołań - ani jedna linia tego modułu się nie
// wykonywała. Dotyczy to również kontraktu RODO: funkcja zwracana przez
// `initWebVitals` ma FAKTYCZNIE zatrzymać pomiar po cofnięciu zgody, a to
// zachowanie nie miało żadnego pokrycia.
//
// DLACZEGO PerformanceObserver JEST PODMIENIANY, A NIE UŻYWANY. Zmierzone
// w happy-dom 20.9.0: `PerformanceObserver` istnieje i `observe({type:
// "largest-contentful-paint"})` NIE RZUCA, ale `supportedEntryTypes` to
// ["dns","function","gc","http","http2","mark","measure","net","resource"] -
// wpisy LCP/layout-shift/event NIGDY nie przychodzą. Test oparty na prawdziwym
// obserwerze przechodziłby więc, nie sprawdzając niczego. Atrapa niżej pozwala
// wstrzyknąć wpisy ręcznie i jest jedynym sposobem na dotknięcie akumulatorów.
//
// KANAŁ OBSERWACJI. `report()` w DEV (a `import.meta.env.DEV` jest pod vitestem
// prawdziwe) kończy na `console.debug` i NIE bije beaconem - dlatego większość
// asercji czyta szpiega `console.debug`, a ścieżka beaconu ma własny blok
// z `vi.stubEnv("DEV", false)`.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { buildEntryServerTimingValue, buildServerTimingValue } from "@/lib/http/ssrTiming";
import type { VitalRating } from "@/lib/observability/vitalsThresholds";
import type { IslandState, IslandStateAttributes } from "@/lib/webVitals";

/** Wpis wydajnościowy na tyle bogaty, by pokryć LCP, layout-shift i event. */
interface FakeEntry {
  name: string;
  entryType: string;
  startTime: number;
  duration: number;
  hadRecentInput?: boolean;
  value?: number;
  interactionId?: number;
}

/** Atrapa PerformanceObservera: rejestruje żądane typy i oddaje sterowanie testowi. */
class FakeObserver {
  static instances: FakeObserver[] = [];
  /** Typy wpisów, dla których `observe()` ma rzucić (gałąź „unsupported"). */
  static failFor: string[] = [];

  /** Typy przekazane do `observe()` - także te, na których rzuciło. */
  readonly requested: string[] = [];
  /** Opcje przyjętych subskrypcji (bez tych, które rzuciły). */
  readonly accepted: PerformanceObserverInit[] = [];
  disconnectCount = 0;

  private readonly callback: (list: { getEntries: () => FakeEntry[] }) => void;

  constructor(callback: (list: { getEntries: () => FakeEntry[] }) => void) {
    this.callback = callback;
    FakeObserver.instances.push(this);
  }

  observe(init: PerformanceObserverInit): void {
    const type = String(init.type);
    this.requested.push(type);
    if (FakeObserver.failFor.includes(type)) {
      throw new Error(`unsupported entry type: ${type}`);
    }
    this.accepted.push(init);
  }

  disconnect(): void {
    this.disconnectCount += 1;
  }

  takeRecords(): FakeEntry[] {
    return [];
  }

  /** Wstrzyknij wpisy tak, jak zrobiłaby to przeglądarka. */
  emit(entries: FakeEntry[]): void {
    this.callback({ getEntries: () => entries });
  }

  static reset(): void {
    FakeObserver.instances = [];
    FakeObserver.failFor = [];
  }

  static forType(type: string): FakeObserver {
    const found = FakeObserver.instances.find((o) => o.requested.includes(type));
    if (!found) throw new Error(`brak obserwera dla typu ${type}`);
    return found;
  }
}

type WebVitalsModule = typeof import("../webVitals");
type VitalsWindow = Window & { __vitalsInit?: boolean };

interface ReportedMetric {
  name: string;
  value: number;
  rating: VitalRating;
  id: string;
}

/** Argumenty każdego wywołania `console.debug` w trakcie testu. */
const debugCalls: unknown[][] = [];

/** Świeża instancja modułu - stan akumulatorów żyje na poziomie modułu. */
async function loadWebVitals(): Promise<WebVitalsModule> {
  vi.resetModules();
  return import("../webVitals");
}

/** Wszystko, co `report()` wypuścił w DEV: [pathname, metric]. */
function reports(): Array<{ path: string; metric: ReportedMetric }> {
  return debugCalls
    .filter((call) => call[0] === "[web-vitals]")
    .map((call) => ({
      path: String(call[1]),
      metric: call[2] as ReportedMetric,
    }));
}

/** Odetnij dotychczasowe raporty, żeby asercja dotyczyła tylko dalszej części testu. */
function clearReports(): void {
  debugCalls.length = 0;
}

function reportsFor(name: string): Array<{ path: string; metric: ReportedMetric }> {
  return reports().filter((r) => r.metric.name === name);
}

function lcpEntry(startTime: number): FakeEntry {
  return { name: "", entryType: "largest-contentful-paint", startTime, duration: 0 };
}

function shift(value: number, startTime: number, hadRecentInput = false): FakeEntry {
  return { name: "", entryType: "layout-shift", startTime, duration: 0, hadRecentInput, value };
}

function interaction(duration: number, interactionId = 1): FakeEntry {
  return { name: "pointerdown", entryType: "event", startTime: 0, duration, interactionId };
}

/**
 * Wpis Paint Timing w kształcie, w jakim czyta go reporter. Budowany jako
 * zwykły obiekt, bez rzutowania: `PerformanceEntry` to cztery pola i `toJSON`.
 */
function paintEntry(startTime: number): PerformanceEntry {
  return {
    name: "first-contentful-paint",
    entryType: "paint",
    startTime,
    duration: 0,
    toJSON: () => ({ name: "first-contentful-paint", entryType: "paint", startTime }),
  };
}

/** Wpis Navigation Timing - reporter bierze z niego wyłącznie `responseStart`. */
function navigationEntry(responseStart: number): PerformanceEntry {
  const entry = {
    name: "",
    entryType: "navigation",
    startTime: 0,
    duration: 0,
    responseStart,
    toJSON: () => ({ entryType: "navigation", responseStart }),
  };
  return entry;
}

beforeEach(() => {
  FakeObserver.reset();
  vi.stubGlobal("PerformanceObserver", FakeObserver);
  (window as VitalsWindow).__vitalsInit = undefined;
  // Ścieżka startowa inna niż "/" - inaczej nie da się odróżnić „przypisano do
  // poprzedniej ścieżki" od „przypisano do domyślnej wartości modułu".
  history.replaceState({}, "", "/en");
  clearReports();
  vi.spyOn(console, "debug").mockImplementation((...args: unknown[]) => {
    debugCalls.push(args);
  });
  // Paint/Navigation Timing wyłączone domyślnie - FCP i TTFB mają własny blok.
  vi.spyOn(performance, "getEntriesByName").mockReturnValue([]);
  vi.spyOn(performance, "getEntriesByType").mockReturnValue([]);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  (window as VitalsWindow).__vitalsInit = undefined;
});

describe("initWebVitals - bramki wejścia", () => {
  it("zwraca no-opa i nic nie rejestruje, gdy PerformanceObserver nie istnieje", async () => {
    vi.stubGlobal("PerformanceObserver", undefined);
    const { initWebVitals } = await loadWebVitals();

    const teardown = initWebVitals();

    expect(FakeObserver.instances).toHaveLength(0);
    // Flaga NIE została postawiona, więc ponowna próba po polyfillu jest możliwa.
    expect((window as VitalsWindow).__vitalsInit).toBeUndefined();
    expect(() => teardown()).not.toThrow();
  });

  it("rejestruje trzy obserwery z właściwymi typami wpisów i buforowaniem", async () => {
    const { initWebVitals } = await loadWebVitals();
    initWebVitals();

    expect(FakeObserver.instances).toHaveLength(3);
    expect(FakeObserver.instances.map((o) => o.requested[0])).toEqual([
      "largest-contentful-paint",
      "layout-shift",
      "event",
    ]);
    for (const observer of FakeObserver.instances) {
      expect(observer.accepted[0]?.buffered).toBe(true);
    }
    // 40 ms to progowanie zdarzeń: bez niego przeglądarka zalewa obserwer
    // każdym kliknięciem, a INP mierzy tylko te odczuwalne.
    expect(FakeObserver.forType("event").accepted[0]).toMatchObject({ durationThreshold: 40 });
    // Ten sam obserwer subskrybuje `first-input` (buforowany, BEZ progu) -
    // wyłącznie dla `inpFirst`, bez czwartego obserwera do rozłączenia.
    expect(FakeObserver.forType("event").requested).toEqual(["event", "first-input"]);
    expect(FakeObserver.forType("event").accepted[1]).toEqual({
      type: "first-input",
      buffered: true,
    });
  });

  it("drugie wywołanie jest no-opem i NIE rozłącza obserwerów z pierwszego", async () => {
    const { initWebVitals } = await loadWebVitals();
    const firstTeardown = initWebVitals();
    expect((window as VitalsWindow).__vitalsInit).toBe(true);

    const secondTeardown = initWebVitals();
    expect(FakeObserver.instances).toHaveLength(3);

    // No-op z drugiego wywołania nie może zdemontować żywego pomiaru.
    secondTeardown();
    expect(FakeObserver.instances.every((o) => o.disconnectCount === 0)).toBe(true);
    expect((window as VitalsWindow).__vitalsInit).toBe(true);

    firstTeardown();
    expect(FakeObserver.instances.every((o) => o.disconnectCount === 1)).toBe(true);
  });

  it("typ wpisu nieobsługiwany przez przeglądarkę nie przewraca pozostałych obserwerów", async () => {
    FakeObserver.failFor = ["layout-shift"];
    const { initWebVitals } = await loadWebVitals();
    const teardown = initWebVitals();

    // Trzy konstrukcje, ale tylko dwie przyjęte subskrypcje.
    expect(FakeObserver.instances).toHaveLength(3);
    expect(FakeObserver.instances.filter((o) => o.accepted.length > 0)).toHaveLength(2);

    // Teardown rozłącza tylko te, które trafiły do rejestru.
    teardown();
    expect(FakeObserver.instances.filter((o) => o.disconnectCount === 1)).toHaveLength(2);
  });
});

describe("przypisanie próbek do ścieżki (nagłówkowa obietnica docbloku)", () => {
  it("miękka nawigacja raportuje LCP dla POPRZEDNIEJ ścieżki i zeruje akumulatory", async () => {
    const { initWebVitals, markWebVitalsPage } = await loadWebVitals();
    initWebVitals();

    FakeObserver.forType("largest-contentful-paint").emit([lcpEntry(1234)]);
    FakeObserver.forType("layout-shift").emit([shift(0.05, 100)]);

    markWebVitalsPage("/blog");

    const lcp = reportsFor("LCP");
    expect(lcp).toHaveLength(1);
    expect(lcp[0]?.path).toBe("/en");
    expect(lcp[0]?.metric.value).toBe(1234);
    expect(lcp[0]?.metric.rating).toBe("good");
    expect(reportsFor("CLS")[0]).toMatchObject({ path: "/en" });

    // Akumulatory wyzerowane: kolejna nawigacja bez nowych wpisów nic nie zgłasza.
    clearReports();
    markWebVitalsPage("/blog/wpis");
    expect(reports()).toHaveLength(0);
  });

  it("po miękkiej nawigacji nowe próbki lecą na NOWĄ ścieżkę", async () => {
    const { initWebVitals, markWebVitalsPage } = await loadWebVitals();
    initWebVitals();

    FakeObserver.forType("largest-contentful-paint").emit([lcpEntry(500)]);
    markWebVitalsPage("/blog");
    clearReports();

    FakeObserver.forType("largest-contentful-paint").emit([lcpEntry(900)]);
    markWebVitalsPage("/glossary");

    const lcp = reportsFor("LCP");
    expect(lcp).toHaveLength(1);
    expect(lcp[0]?.path).toBe("/blog");
    expect(lcp[0]?.metric.value).toBe(900);
  });

  it("markWebVitalsPage z tą samą ścieżką jest no-opem (nie gubi akumulatorów)", async () => {
    const { initWebVitals, markWebVitalsPage } = await loadWebVitals();
    initWebVitals();
    FakeObserver.forType("largest-contentful-paint").emit([lcpEntry(700)]);

    markWebVitalsPage("/en");
    expect(reports()).toHaveLength(0);

    // Akumulator nienaruszony - dopiero prawdziwa nawigacja go wypłukuje.
    markWebVitalsPage("/blog");
    expect(reportsFor("LCP")[0]?.metric.value).toBe(700);
  });

  it("bez `window` markWebVitalsPage nie flushuje i NIE przesuwa bieżącej ścieżki", async () => {
    // Moduł jest osiągalny w grafie serwera (`observability/index.ts`), więc oba
    // eksporty mają strażnik `typeof window === "undefined"`. Bez tej asercji
    // nie da się odróżnić „strażnik zadziałał" od „strażnika nie ma, a flush po
    // prostu nic nie znalazł".
    const realWindow = window;
    const { initWebVitals, markWebVitalsPage } = await loadWebVitals();
    initWebVitals();
    FakeObserver.forType("largest-contentful-paint").emit([lcpEntry(1111)]);

    vi.stubGlobal("window", undefined);
    expect(typeof window).toBe("undefined");
    expect(() => markWebVitalsPage("/blog")).not.toThrow();
    expect(reports()).toHaveLength(0);

    vi.stubGlobal("window", realWindow);
    // Skoro `currentPath` nie zostało przesunięte, TA nawigacja jest pierwszą
    // prawdziwą i próbka wciąż należy do "/en".
    markWebVitalsPage("/blog");
    expect(reportsFor("LCP")).toEqual([expect.objectContaining({ path: "/en" })]);
  });

  it("bez `window` initWebVitals nie rejestruje niczego", async () => {
    const realWindow = window;
    const { initWebVitals } = await loadWebVitals();
    vi.stubGlobal("window", undefined);
    const teardown = initWebVitals();
    vi.stubGlobal("window", realWindow);

    expect(FakeObserver.instances).toHaveLength(0);
    expect(() => teardown()).not.toThrow();
  });

  it('initWebVitals bierze ścieżkę startową z location.pathname, nie z domyślnego "/"', async () => {
    history.replaceState({}, "", "/kategoria/gospodarka");
    const { initWebVitals, markWebVitalsPage } = await loadWebVitals();
    initWebVitals();
    FakeObserver.forType("largest-contentful-paint").emit([lcpEntry(100)]);
    markWebVitalsPage("/inna");
    expect(reportsFor("LCP")[0]?.path).toBe("/kategoria/gospodarka");
  });
});

describe("akumulatory metryk", () => {
  it("LCP bierze OSTATNI wpis z partii, nie największy", async () => {
    const { initWebVitals, markWebVitalsPage } = await loadWebVitals();
    initWebVitals();
    FakeObserver.forType("largest-contentful-paint").emit([
      lcpEntry(3000),
      lcpEntry(2000),
      lcpEntry(2500),
    ]);
    markWebVitalsPage("/x");
    expect(reportsFor("LCP")[0]?.metric.value).toBe(2500);
  });

  it("pusta partia wpisów LCP nie zeruje już zebranej wartości", async () => {
    const { initWebVitals, markWebVitalsPage } = await loadWebVitals();
    initWebVitals();
    const observer = FakeObserver.forType("largest-contentful-paint");
    observer.emit([lcpEntry(1500)]);
    observer.emit([]);
    markWebVitalsPage("/x");
    expect(reportsFor("LCP")[0]?.metric.value).toBe(1500);
  });

  it("CLS sumuje przesunięcia i POMIJA te po świeżej interakcji użytkownika", async () => {
    const { initWebVitals, markWebVitalsPage } = await loadWebVitals();
    initWebVitals();
    FakeObserver.forType("layout-shift").emit([
      shift(0.03, 100),
      shift(0.9, 200, true), // po kliknięciu - nie liczy się do CLS
      shift(0.04, 300),
    ]);
    // LCP > 0 nie jest potrzebne: sam CLS > 0 wystarcza do raportu.
    markWebVitalsPage("/x");

    const cls = reportsFor("CLS");
    expect(cls).toHaveLength(1);
    expect(cls[0]?.metric.value).toBeCloseTo(0.07, 10);
    expect(cls[0]?.metric.rating).toBe("good");
  });

  it("INP ignoruje zdarzenia bez interactionId", async () => {
    const { initWebVitals, markWebVitalsPage } = await loadWebVitals();
    initWebVitals();
    FakeObserver.forType("event").emit([
      { name: "pointermove", entryType: "event", startTime: 0, duration: 5000 },
      interaction(120),
    ]);
    markWebVitalsPage("/x");

    const inp = reportsFor("INP");
    expect(inp).toHaveLength(1);
    expect(inp[0]?.metric.value).toBe(120);
    expect(inp[0]?.metric.rating).toBe("good");
  });

  it("ocena metryki idzie z kanonicznych progów VITAL_THRESHOLDS", async () => {
    const { initWebVitals, markWebVitalsPage } = await loadWebVitals();
    initWebVitals();
    // LCP 4500 > 4000 -> "poor"; CLS 0.2 w (0.1, 0.25] -> "needs-improvement".
    FakeObserver.forType("largest-contentful-paint").emit([lcpEntry(4500)]);
    FakeObserver.forType("layout-shift").emit([shift(0.2, 10)]);
    markWebVitalsPage("/x");

    expect(reportsFor("LCP")[0]?.metric.rating).toBe("poor");
    expect(reportsFor("CLS")[0]?.metric.rating).toBe("needs-improvement");
  });

  it("każda próbka ma własny identyfikator", async () => {
    const { initWebVitals, markWebVitalsPage } = await loadWebVitals();
    initWebVitals();
    FakeObserver.forType("largest-contentful-paint").emit([lcpEntry(1000)]);
    FakeObserver.forType("event").emit([interaction(300)]);
    markWebVitalsPage("/x");

    const ids = reports().map((r) => r.metric.id);
    expect(ids).toHaveLength(3); // LCP + CLS (bo LCP > 0) + INP
    expect(new Set(ids).size).toBe(3);
    for (const id of ids) expect(id).toMatch(/^v-[0-9a-z]+-[0-9a-z]{1,6}$/);
  });
});

describe("reguła flushu (unikanie zalewania zerami)", () => {
  it("CLS = 0 jest raportowane, gdy LCP wystrzelił", async () => {
    const { initWebVitals, markWebVitalsPage } = await loadWebVitals();
    initWebVitals();
    FakeObserver.forType("largest-contentful-paint").emit([lcpEntry(1200)]);
    markWebVitalsPage("/x");

    expect(reportsFor("LCP")).toHaveLength(1);
    const cls = reportsFor("CLS");
    expect(cls).toHaveLength(1);
    expect(cls[0]?.metric.value).toBe(0);
  });

  it("nic nie jest raportowane, gdy nie zebrano ani LCP, ani CLS, ani INP", async () => {
    const { initWebVitals, markWebVitalsPage } = await loadWebVitals();
    initWebVitals();
    markWebVitalsPage("/x");
    expect(reports()).toHaveLength(0);
  });

  it("`pagehide` wypłukuje bieżącą ścieżkę, a drugie zdarzenie już nic nie dubluje", async () => {
    const { initWebVitals } = await loadWebVitals();
    initWebVitals();
    FakeObserver.forType("largest-contentful-paint").emit([lcpEntry(2000)]);

    window.dispatchEvent(new Event("pagehide"));
    expect(reportsFor("LCP")).toHaveLength(1);
    expect(reportsFor("LCP")[0]?.path).toBe("/en");

    window.dispatchEvent(new Event("pagehide"));
    expect(reportsFor("LCP")).toHaveLength(1);
  });

  it("`visibilitychange` wypłukuje tylko przy stanie hidden", async () => {
    const { initWebVitals } = await loadWebVitals();
    initWebVitals();
    FakeObserver.forType("largest-contentful-paint").emit([lcpEntry(2000)]);

    const visibility = vi.spyOn(document, "visibilityState", "get");
    visibility.mockReturnValue("visible");
    window.dispatchEvent(new Event("visibilitychange"));
    expect(reports()).toHaveLength(0);

    visibility.mockReturnValue("hidden");
    window.dispatchEvent(new Event("visibilitychange"));
    expect(reportsFor("LCP")).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Defekt N1 (audyt wyd. 8, rozdz. 4): jedna wspólna zapadka `flushed` gubiła
// CLS i INP narosłe PO pierwszym zrzucie na TEJ SAMEJ ścieżce. Każdy przypadek
// w tym bloku jest CZERWONY na kodzie sprzed naprawy.
describe("kumulacja po pierwszym zrzucie (N1)", () => {
  it("po zrzucie na UKRYCIU karty kolejny `pagehide` raportuje NAROSŁE CLS i INP tej samej ścieżki", async () => {
    const { initWebVitals } = await loadWebVitals();
    initWebVitals();
    FakeObserver.forType("largest-contentful-paint").emit([lcpEntry(2000)]);
    FakeObserver.forType("layout-shift").emit([shift(0.05, 100)]);
    FakeObserver.forType("event").emit([interaction(120)]);

    const visibility = vi.spyOn(document, "visibilityState", "get");
    visibility.mockReturnValue("hidden");
    window.dispatchEvent(new Event("visibilitychange"));
    expect(reportsFor("CLS")[0]?.metric.value).toBeCloseTo(0.05, 10);
    expect(reportsFor("INP")[0]?.metric.value).toBe(120);

    // Czytelnik wraca na TĘ SAMĄ stronę: doładowany obrazek przesuwa układ,
    // kolejna interakcja jest wolniejsza.
    visibility.mockReturnValue("visible");
    window.dispatchEvent(new Event("visibilitychange"));
    clearReports();
    FakeObserver.forType("layout-shift").emit([shift(0.06, 900)]);
    FakeObserver.forType("event").emit([interaction(300, 2)]);

    window.dispatchEvent(new Event("pagehide"));

    const cls = reportsFor("CLS");
    expect(cls).toHaveLength(1);
    expect(cls[0]?.path).toBe("/en");
    // WARTOŚĆ SKUMULOWANA, nie przyrost: wiersz niesie własną ocenę, a
    // agregator liczy p75 po surowych wierszach.
    expect(cls[0]?.metric.value).toBeCloseTo(0.11, 10);
    const inp = reportsFor("INP");
    expect(inp).toHaveLength(1);
    expect(inp[0]?.metric.value).toBe(300);
    // LCP jest finalne - drugi zrzut nie ma prawa go zdublować.
    expect(reportsFor("LCP")).toHaveLength(0);
  });

  it("ocena ponownie zaraportowanego CLS idzie od SUMY, nie od przyrostu", async () => {
    // Cztery przyrosty po 0,1 to cztery wiersze „good"; suma 0,4 to jeden
    // wiersz „poor". Histogram ocen w panelu czyta ocenę z wiersza, więc
    // przyrost dosłownie zamalowałby problem na zielono.
    const { initWebVitals } = await loadWebVitals();
    initWebVitals();
    const visibility = vi.spyOn(document, "visibilityState", "get");

    for (const [i, value] of [0.1, 0.1, 0.1, 0.1].entries()) {
      FakeObserver.forType("layout-shift").emit([shift(value, 100 * (i + 1))]);
      visibility.mockReturnValue("hidden");
      window.dispatchEvent(new Event("visibilitychange"));
      visibility.mockReturnValue("visible");
      window.dispatchEvent(new Event("visibilitychange"));
    }

    const cls = reportsFor("CLS");
    expect(cls).toHaveLength(4);
    expect(cls.at(-1)?.metric.value).toBeCloseTo(0.4, 10);
    expect(cls.at(-1)?.metric.rating).toBe("poor");
  });

  it("kolejne ukrycia BEZ nowych pomiarów nie dublują wierszy", async () => {
    // „Tylko gdy urosło" jest tym, co powstrzymuje serię ukryć i powrotów
    // przed zalaniem ingestu identycznymi próbkami.
    const { initWebVitals } = await loadWebVitals();
    initWebVitals();
    FakeObserver.forType("layout-shift").emit([shift(0.07, 100)]);
    FakeObserver.forType("event").emit([interaction(90)]);

    const visibility = vi.spyOn(document, "visibilityState", "get");
    for (let i = 0; i < 4; i += 1) {
      visibility.mockReturnValue("hidden");
      window.dispatchEvent(new Event("visibilitychange"));
      visibility.mockReturnValue("visible");
      window.dispatchEvent(new Event("visibilitychange"));
    }

    expect(reportsFor("CLS")).toHaveLength(1);
    expect(reportsFor("INP")).toHaveLength(1);
  });

  it("miękka nawigacja PO zrzucie nadal zeruje akumulatory dla nowej ścieżki", async () => {
    // Zdjęcie wspólnej zapadki nie może przywrócić przeciekania próbek między
    // ścieżkami - to jest obietnica z nagłówka docbloku modułu.
    const { initWebVitals, markWebVitalsPage } = await loadWebVitals();
    initWebVitals();
    FakeObserver.forType("layout-shift").emit([shift(0.2, 100)]);
    const visibility = vi.spyOn(document, "visibilityState", "get");
    visibility.mockReturnValue("hidden");
    window.dispatchEvent(new Event("visibilitychange"));

    markWebVitalsPage("/blog");
    clearReports();
    FakeObserver.forType("layout-shift").emit([shift(0.01, 900)]);
    window.dispatchEvent(new Event("pagehide"));

    const cls = reportsFor("CLS");
    expect(cls).toHaveLength(1);
    expect(cls[0]?.path).toBe("/blog");
    // 0,01 - a NIE 0,21: akumulator poprzedniej ścieżki nie przechodzi dalej.
    expect(cls[0]?.metric.value).toBeCloseTo(0.01, 10);
  });
});

describe("teardown - kontrakt cofnięcia zgody RODO", () => {
  it("rozłącza KAŻDY obserwer, zdejmuje listenery flushu i zwalnia flagę", async () => {
    const { initWebVitals } = await loadWebVitals();
    const teardown = initWebVitals();
    FakeObserver.forType("largest-contentful-paint").emit([lcpEntry(2000)]);

    teardown();

    expect(FakeObserver.instances).toHaveLength(3);
    for (const observer of FakeObserver.instances) expect(observer.disconnectCount).toBe(1);
    expect((window as VitalsWindow).__vitalsInit).toBe(false);

    // Po cofnięciu zgody żadne zdarzenie nie może już nic wysłać.
    window.dispatchEvent(new Event("pagehide"));
    window.dispatchEvent(new Event("visibilitychange"));
    expect(reports()).toHaveLength(0);
  });

  it("po teardownie ponowna zgoda re-inicjalizuje pomiar", async () => {
    const { initWebVitals } = await loadWebVitals();
    initWebVitals()();
    expect((window as VitalsWindow).__vitalsInit).toBe(false);

    initWebVitals();
    expect(FakeObserver.instances).toHaveLength(6);
    expect((window as VitalsWindow).__vitalsInit).toBe(true);
  });

  it("rzucający `disconnect()` nie przewraca teardownu ani nie blokuje kolejnych", async () => {
    const { initWebVitals } = await loadWebVitals();
    const teardown = initWebVitals();
    const first = FakeObserver.instances[0];
    expect(first).toBeDefined();
    vi.spyOn(first as FakeObserver, "disconnect").mockImplementation(() => {
      throw new Error("already disconnected");
    });

    expect(() => teardown()).not.toThrow();
    // Pozostałe dwa zostały rozłączone mimo rzutu w pierwszym.
    expect(FakeObserver.instances.slice(1).every((o) => o.disconnectCount === 1)).toBe(true);
    expect((window as VitalsWindow).__vitalsInit).toBe(false);
  });
});

describe("FCP i TTFB z Paint / Navigation Timing", () => {
  it("raportuje FCP i TTFB przy inicjalizacji, na ścieżce startowej", async () => {
    vi.spyOn(performance, "getEntriesByName").mockReturnValue([
      { startTime: 1200 },
    ] as unknown as PerformanceEntryList);
    vi.spyOn(performance, "getEntriesByType").mockReturnValue([
      { responseStart: 640 },
    ] as unknown as PerformanceEntryList);

    const { initWebVitals } = await loadWebVitals();
    initWebVitals();

    const fcp = reportsFor("FCP");
    expect(fcp).toHaveLength(1);
    expect(fcp[0]).toMatchObject({ path: "/en" });
    expect(fcp[0]?.metric.value).toBe(1200);
    expect(fcp[0]?.metric.rating).toBe("good"); // 1200 <= 1800

    const ttfb = reportsFor("TTFB");
    expect(ttfb).toHaveLength(1);
    expect(ttfb[0]?.metric.value).toBe(640);
    expect(ttfb[0]?.metric.rating).toBe("good"); // 640 <= 800
  });

  it("brak wpisu paintu i nawigacji nie daje żadnego raportu", async () => {
    const { initWebVitals } = await loadWebVitals();
    initWebVitals();
    expect(reportsFor("FCP")).toHaveLength(0);
    expect(reportsFor("TTFB")).toHaveLength(0);
  });

  it("rzut z Performance Timing nie przewraca inicjalizacji ani teardownu", async () => {
    vi.spyOn(performance, "getEntriesByName").mockImplementation(() => {
      throw new Error("not supported");
    });

    const { initWebVitals } = await loadWebVitals();
    const teardowns: Array<() => void> = [];
    expect(() => {
      teardowns.push(initWebVitals());
    }).not.toThrow();
    expect(FakeObserver.instances).toHaveLength(3);
    expect(teardowns).toHaveLength(1);
    teardowns[0]?.();
    expect(FakeObserver.instances.every((o) => o.disconnectCount === 1)).toBe(true);
  });
});

describe("ścieżka produkcyjna: beacon", () => {
  // `vitest.setup.ts:31-36` podmienia `navigator.sendBeacon` na `() => true`,
  // żeby testy nie wychodziły do sieci. Tu podmieniamy per test i przywracamy.
  let originalSendBeacon: typeof navigator.sendBeacon;

  beforeEach(() => {
    originalSendBeacon = navigator.sendBeacon;
    // `import.meta.env.DEV` jest booleanem, nie stringiem - vitest typuje
    // `stubEnv` per klucz i "" byłoby błędem typów.
    vi.stubEnv("DEV", false);
  });

  afterEach(() => {
    Object.defineProperty(navigator, "sendBeacon", {
      configurable: true,
      writable: true,
      value: originalSendBeacon,
    });
  });

  function captureBeacons(): Array<{ url: string; body: BodyInit | null | undefined }> {
    const sent: Array<{ url: string; body: BodyInit | null | undefined }> = [];
    Object.defineProperty(navigator, "sendBeacon", {
      configurable: true,
      writable: true,
      value: (url: string | URL, body?: BodyInit | null) => {
        sent.push({ url: String(url), body });
        return true;
      },
    });
    return sent;
  }

  /**
   * The transport beacons a `Blob` (`sendBeaconPayload`), so the body CANNOT be
   * read with `String(body)` - that yields "[object Blob]" and `JSON.parse`
   * throws. Read it as text, tolerating a plain string for good measure.
   */
  async function beaconJson(body: BodyInit | null | undefined): Promise<unknown> {
    const text = body instanceof Blob ? await body.text() : String(body);
    return JSON.parse(text);
  }

  it("bije w wewnętrzną trasę ingest i nie loguje do konsoli", async () => {
    vi.stubEnv("VITE_OBSERVABILITY_ENDPOINT", "");
    const sent = captureBeacons();
    const { initWebVitals, markWebVitalsPage } = await loadWebVitals();
    initWebVitals();
    FakeObserver.forType("largest-contentful-paint").emit([lcpEntry(2100)]);
    markWebVitalsPage("/blog");

    expect(reports()).toHaveLength(0); // poza DEV nie ma console.debug
    expect(sent.length).toBeGreaterThanOrEqual(1);
    expect(sent[0]?.url).toBe("/api/public/vitals");

    // The client BATCHES: one beacon carries `{metrics:[...]}`, not a bare
    // sample. LCP and CLS leave together on the soft-navigation boundary.
    const payload = (await beaconJson(sent[0]?.body)) as {
      metrics: Array<{
        name: string;
        value: number;
        rating: string;
        id: string;
        url: string;
        ts: number;
      }>;
    };
    const lcp = payload.metrics.find((m) => m.name === "LCP")!;
    expect(lcp).toMatchObject({ name: "LCP", value: 2100, rating: "good", url: "/en" });
    expect(lcp.ts).toBeTypeOf("number");
    expect(lcp.id).toBeTypeOf("string");
  });

  it("beaconuje BLOB `application/json` - ten sam transport co raporty błędów", async () => {
    // Ujednolicony transport (`sendBeaconPayload`) pakuje ładunek w Blob;
    // trasa ingest czyta `req.text()`, więc oba kształty ciała są dla niej
    // równoważne - patrz `src/routes/api/public/-vitals.test.ts`.
    vi.stubEnv("VITE_OBSERVABILITY_ENDPOINT", "");
    const sent = captureBeacons();
    const { initWebVitals, markWebVitalsPage } = await loadWebVitals();
    initWebVitals();
    FakeObserver.forType("largest-contentful-paint").emit([lcpEntry(2100)]);
    markWebVitalsPage("/blog");

    const body = sent[0]?.body;
    expect(body).toBeInstanceOf(Blob);
    expect((body as Blob).type).toBe("application/json");
  });

  it("zewnętrzny VITE_OBSERVABILITY_ENDPOINT wygrywa z trasą wewnętrzną", async () => {
    vi.stubEnv("VITE_OBSERVABILITY_ENDPOINT", "https://rum.example.test/collect");
    const sent = captureBeacons();
    const { initWebVitals, markWebVitalsPage } = await loadWebVitals();
    initWebVitals();
    FakeObserver.forType("largest-contentful-paint").emit([lcpEntry(1000)]);
    markWebVitalsPage("/blog");

    expect(sent[0]?.url).toBe("https://rum.example.test/collect");
  });

  it("rzut z sendBeacon nigdy nie wychodzi na zewnątrz (raportowanie nie psuje strony)", async () => {
    Object.defineProperty(navigator, "sendBeacon", {
      configurable: true,
      writable: true,
      value: () => {
        throw new Error("beacon blocked by the browser");
      },
    });

    const { initWebVitals, markWebVitalsPage } = await loadWebVitals();
    initWebVitals();
    FakeObserver.forType("largest-contentful-paint").emit([lcpEntry(1000)]);
    expect(() => markWebVitalsPage("/blog")).not.toThrow();
  });

  it("brak sendBeacon w środowisku nie przewraca flushu", async () => {
    Object.defineProperty(navigator, "sendBeacon", {
      configurable: true,
      writable: true,
      value: undefined,
    });

    const { initWebVitals, markWebVitalsPage } = await loadWebVitals();
    initWebVitals();
    FakeObserver.forType("largest-contentful-paint").emit([lcpEntry(1000)]);
    expect(() => markWebVitalsPage("/blog")).not.toThrow();
  });

  it("bez `navigator` próbka NIE wchodzi do bufora - inaczej wyciekłaby do NASTĘPNEGO żądania", async () => {
    // Różnica między „brak sendBeacon" (przypadek wyżej) a „brak całego
    // `navigator`": tam transport oddaje `false` i próbka ginie po drodze, tu
    // nie wolno jej nawet PRZYJĄĆ. `queue` żyje w zakresie MODUŁU - jednego na
    // proces, nie na żądanie - a moduł jest osiągalny z grafu serwera
    // (`observability/index.ts`). Bez strażnika próbka zebrana tam, gdzie nie
    // ma czym jej wysłać, czekałaby w tablicy do pierwszej granicy zrzutu i
    // doklejała się do CUDZEGO beaconu. To nie jest wyciek pamięci, tylko
    // wyciek między żądaniami.
    //
    // FCP i TTFB są jedynymi metrykami raportowanymi POZA granicą zrzutu (przy
    // inicjalizacji, na zaplanowany drain), więc tylko na nich widać różnicę
    // między „odrzucone u źródła" a „odłożone na później".
    vi.stubEnv("VITE_OBSERVABILITY_ENDPOINT", "");
    vi.spyOn(performance, "getEntriesByName").mockReturnValue([paintEntry(700)]);
    vi.spyOn(performance, "getEntriesByType").mockReturnValue([navigationEntry(120)]);

    const realNavigator = navigator;
    const { initWebVitals } = await loadWebVitals();
    vi.stubGlobal("navigator", undefined);
    expect(typeof navigator).toBe("undefined");
    expect(() => initWebVitals()).not.toThrow();
    vi.stubGlobal("navigator", realNavigator);

    const sent = captureBeacons();
    FakeObserver.forType("largest-contentful-paint").emit([lcpEntry(1000)]);
    window.dispatchEvent(new Event("pagehide"));
    // Zaplanowany drain jest zadaniem makro - dajemy mu dojść do głosu.
    await new Promise((resolve) => setTimeout(resolve, 5));

    expect(sent).toHaveLength(1);
    const payload = (await beaconJson(sent[0]?.body)) as { metrics: Array<{ name: string }> };
    // Ani FCP, ani TTFB: odrzucone u źródła, a nie odłożone do tego beaconu.
    expect(payload.metrics.map((m) => m.name).sort()).toEqual(["CLS", "LCP"]);
  });

  // -------------------------------------------------------------------------
  // Defekt N2 (audyt wyd. 8, rozdz. 4): zdarzenia analityczne były batchowane
  // (`src/lib/analytics/track.ts`), a metryki wydajności - nie. Jedno pierwsze
  // wczytanie wysyłało do pięciu osobnych żądań HTTP i tyle samo osobnych
  // round-tripów INSERT.
  describe("batchowanie (N2)", () => {
    it("PIERWSZE WCZYTANIE z pięcioma metrykami wychodzi JEDNYM żądaniem", async () => {
      vi.stubEnv("VITE_OBSERVABILITY_ENDPOINT", "");
      const sent = captureBeacons();
      vi.spyOn(performance, "getEntriesByName").mockReturnValue([
        { name: "first-contentful-paint", entryType: "paint", startTime: 900, duration: 0 },
      ] as unknown as PerformanceEntryList);
      vi.spyOn(performance, "getEntriesByType").mockReturnValue([
        { entryType: "navigation", responseStart: 210 },
      ] as unknown as PerformanceEntryList);

      const { initWebVitals } = await loadWebVitals();
      initWebVitals();
      FakeObserver.forType("largest-contentful-paint").emit([lcpEntry(2100)]);
      FakeObserver.forType("layout-shift").emit([shift(0.03, 100)]);
      FakeObserver.forType("event").emit([interaction(150)]);
      // Granica zrzutu: zamknięcie karty. FCP i TTFB czekają w buforze od
      // inicjalizacji, bo zaplanowany drain jest zadaniem makro.
      window.dispatchEvent(new Event("pagehide"));

      expect(sent).toHaveLength(1);
      const payload = (await beaconJson(sent[0]?.body)) as { metrics: Array<{ name: string }> };
      expect(payload.metrics.map((m) => m.name).sort()).toEqual([
        "CLS",
        "FCP",
        "INP",
        "LCP",
        "TTFB",
      ]);
    });

    it("para FCP+TTFB wychodzi SAMA na następnym zadaniu makro, bez żadnej granicy zrzutu", async () => {
      // Timer NIE jest oknem batchowania - jest ZEROWY, i to jest cała jego
      // rola. FCP i TTFB są jedyną parą raportowaną poza granicą zrzutu (przy
      // inicjalizacji), więc bez tego zadania makro wisiałyby w buforze do
      // pierwszej miękkiej nawigacji albo ukrycia karty. Czytelnik, który
      // wchodzi i zamyka kartę awaryjnie, oddałby wtedy ZERO próbek startowych
      // - a to właśnie one opisują pierwsze wczytanie. Okno, w którym awaria
      // gubi tę parę, ma trwać jedno zadanie, nie sekundy.
      vi.stubEnv("VITE_OBSERVABILITY_ENDPOINT", "");
      vi.spyOn(performance, "getEntriesByName").mockReturnValue([paintEntry(900)]);
      vi.spyOn(performance, "getEntriesByType").mockReturnValue([navigationEntry(210)]);
      const sent = captureBeacons();

      const { initWebVitals } = await loadWebVitals();
      initWebVitals();
      // Synchronicznie po inicjalizacji nic jeszcze nie poszło - to nadal
      // JEDNO żądanie na parę, a nie dwa strzały z `report()`.
      expect(sent).toHaveLength(0);

      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(sent).toHaveLength(1);
      const payload = (await beaconJson(sent[0]?.body)) as {
        metrics: Array<{ name: string; value: number }>;
      };
      expect(payload.metrics.map((m) => m.name).sort()).toEqual(["FCP", "TTFB"]);
      expect(payload.metrics.find((m) => m.name === "TTFB")?.value).toBe(210);
    });

    it("pusta kolejka NIE bije beaconem - zrzut bez metryk to zero żądań", async () => {
      vi.stubEnv("VITE_OBSERVABILITY_ENDPOINT", "");
      const sent = captureBeacons();
      const { initWebVitals } = await loadWebVitals();
      initWebVitals();

      window.dispatchEvent(new Event("pagehide"));
      window.dispatchEvent(new Event("pagehide"));

      expect(sent).toHaveLength(0);
    });

    it("KAŻDA granica zrzutu wysyła własne żądanie, a bufor nie przecieka między nimi", async () => {
      vi.stubEnv("VITE_OBSERVABILITY_ENDPOINT", "");
      const sent = captureBeacons();
      const { initWebVitals, markWebVitalsPage } = await loadWebVitals();
      initWebVitals();
      FakeObserver.forType("largest-contentful-paint").emit([lcpEntry(1500)]);
      markWebVitalsPage("/blog");
      FakeObserver.forType("largest-contentful-paint").emit([lcpEntry(1700)]);
      markWebVitalsPage("/blog/wpis");

      expect(sent).toHaveLength(2);
      const first = (await beaconJson(sent[0]?.body)) as { metrics: Array<{ url: string }> };
      const second = (await beaconJson(sent[1]?.body)) as { metrics: Array<{ url: string }> };
      expect(first.metrics.every((m) => m.url === "/en")).toBe(true);
      expect(second.metrics.every((m) => m.url === "/blog")).toBe(true);
    });

    it("ścieżka dłuższa niż limit kolumny jest przycinana PO STRONIE KLIENTA", async () => {
      // Jedna zbyt długa próbka mogłaby przepchnąć całe ciało ponad MAX_BODY
      // serwera i zabrać ze sobą pozostałe metryki tego samego zrzutu.
      vi.stubEnv("VITE_OBSERVABILITY_ENDPOINT", "");
      const sent = captureBeacons();
      const { initWebVitals, markWebVitalsPage } = await loadWebVitals();
      initWebVitals();
      FakeObserver.forType("largest-contentful-paint").emit([lcpEntry(1000)]);
      markWebVitalsPage("/" + "p".repeat(900));

      const payload = (await beaconJson(sent[0]?.body)) as { metrics: Array<{ url: string }> };
      expect(payload.metrics[0]?.url.length).toBeLessThanOrEqual(512);
    });

    it("cofnięcie zgody PORZUCA to, co zostało w buforze - nic nie wychodzi po teardownie", async () => {
      // Kontrakt RODO: po cofnięciu zgody nie może wyjść ANI JEDNA próbka,
      // także ta, która czekała na zaplanowany zrzut.
      vi.stubEnv("VITE_OBSERVABILITY_ENDPOINT", "");
      const sent = captureBeacons();
      vi.spyOn(performance, "getEntriesByName").mockReturnValue([
        { name: "first-contentful-paint", entryType: "paint", startTime: 700, duration: 0 },
      ] as unknown as PerformanceEntryList);

      const { initWebVitals } = await loadWebVitals();
      const teardown = initWebVitals();
      teardown();
      window.dispatchEvent(new Event("pagehide"));
      await new Promise((resolve) => setTimeout(resolve, 5));

      expect(sent).toHaveLength(0);
    });
  });
});

describe("zgodność definicji z tym, co mierzy bramka Lighthouse", () => {
  // Oba przypadki w tym bloku pilnują JEDNEJ rzeczy: że RUM i bramka CI liczą
  // TE SAME WIELKOŚCI pod tymi samymi nazwami. Dopóki tak nie było, żadnej
  // regresji nie dało się potwierdzić jednym instrumentem przez drugi -
  // `cumulative-layout-shift <= 0.1` z `lighthouserc.json` i dashboard RUM
  // mogły się nie zgadzać bez ani jednej zmiany w produkcie. Wartości niżej są
  // WPROST wyliczone ze specyfikacji Web Vitals, więc każdy powrót do sumy
  // z całego życia strony albo do zwykłego maksimum oblewa ten blok.

  it("CLS to MAKSIMUM Z OKIEN SESYJNYCH, nie suma z całego życia strony", async () => {
    // Chrome, CrUX i Lighthouse raportują CLS jako maksimum z okien sesyjnych
    // (przerwa < 1 s, okno < 5 s). Progi VITAL_THRESHOLDS.CLS = [0.1, 0.25] są
    // progami OKNA, więc suma bez ograniczeń oceniałaby wielkość, której te
    // progi nie opisują, i długie sesje SPA systematycznie przeszacowywałyby
    // CLS - tym mocniej, im dłużej czytelnik zostaje na stronie.
    const { initWebVitals, markWebVitalsPage } = await loadWebVitals();
    initWebVitals();
    // Dwa skupiska rozdzielone minutą: każde ma sumę 0.06.
    FakeObserver.forType("layout-shift").emit([
      shift(0.03, 1_000),
      shift(0.03, 1_500),
      shift(0.03, 61_000),
      shift(0.03, 61_500),
    ]);
    markWebVitalsPage("/x");

    // Maksimum okna sesyjnego = 0.06 („good"), a nie suma 0.12.
    expect(reportsFor("CLS")[0]?.metric.value).toBeCloseTo(0.06, 10);
    expect(reportsFor("CLS")[0]?.metric.rating).toBe("good");
  });

  it("okno sesyjne CLS zamyka się też po 5 s, mimo przerw krótszych niż 1 s", async () => {
    // Druga granica ze specyfikacji, niezależna od przerwy: seria przesunięć
    // co 900 ms nigdy nie robi przerwy 1 s, więc bez limitu 5 s narastałaby
    // w jedno okno bez końca - to jest ten sam przeciek, tylko wolniejszy.
    const { initWebVitals, markWebVitalsPage } = await loadWebVitals();
    initWebVitals();
    const entries: FakeEntry[] = [];
    for (let i = 0; i < 7; i += 1) entries.push(shift(0.02, i * 900));
    FakeObserver.forType("layout-shift").emit(entries);
    markWebVitalsPage("/x");

    // Sześć przesunięć mieści się w oknie [0, 5000) - siódme (5400) otwiera
    // nowe. Maksimum to 6 * 0.02 = 0.12, a nie suma 7 * 0.02 = 0.14.
    expect(reportsFor("CLS")[0]?.metric.value).toBeCloseTo(0.12, 10);
  });

  it("INP to WYSOKI PERCENTYL interakcji - jedna odrzucona na każde 50", async () => {
    // Specyfikacja INP odrzuca najgorszą interakcję na każde 50 - przy 150
    // interakcjach odpadają trzy najgorsze. Zwykłe maksimum pozwalało JEDNEMU
    // wyjątkowemu przypadkowi (zimny cache, zablokowany wątek przy pierwszym
    // kliknięciu) zdefiniować metrykę całej odsłony, choć jej nazwa i progi
    // VITAL_THRESHOLDS.INP = [200, 500] mówią o percentylu.
    const { initWebVitals, markWebVitalsPage } = await loadWebVitals();
    initWebVitals();
    const entries: FakeEntry[] = [];
    for (let i = 0; i < 147; i += 1) entries.push(interaction(50, i + 1));
    for (let i = 0; i < 3; i += 1) entries.push(interaction(600, 200 + i));
    FakeObserver.forType("event").emit(entries);
    markWebVitalsPage("/x");

    // 50 ms (trzy najgorsze odrzucone), a nie 600 ms.
    expect(reportsFor("INP")[0]?.metric.value).toBe(50);
  });

  it("poniżej 50 interakcji percentyl NIE odrzuca niczego - INP to wtedy maksimum", async () => {
    // Druga strona tej samej reguły: `floor(49 / 50) = 0`, więc jedna wolna
    // interakcja na krótkiej odsłonie MUSI być widoczna. Odrzucanie „na
    // wszelki wypadek" zamiotłoby pod dywan dokładnie te przypadki, po które
    // sięga panel wydajności.
    const { initWebVitals, markWebVitalsPage } = await loadWebVitals();
    initWebVitals();
    const entries: FakeEntry[] = [interaction(400, 1)];
    for (let i = 1; i < 49; i += 1) entries.push(interaction(60, i + 1));
    FakeObserver.forType("event").emit(entries);
    markWebVitalsPage("/x");

    expect(reportsFor("INP")[0]?.metric.value).toBe(400);
    expect(reportsFor("INP")[0]?.metric.rating).toBe("needs-improvement");
  });

  it("kilka zdarzeń JEDNEJ interakcji to jedna interakcja o najdłuższym zdarzeniu", async () => {
    // `pointerdown`, `pointerup` i `click` jednego gestu mają WSPÓLNY
    // `interactionId`. Mianownikiem percentyla są INTERAKCJE, nie wpisy:
    // 25 gestów po dwa zdarzenia to 25 interakcji (`floor(25 / 50) = 0`, czyli
    // nic nie odrzucamy), a nie 50 „interakcji", przy których odpadłaby
    // najgorsza - i najwolniejszy gest odsłony zniknąłby z metryki.
    const { initWebVitals, markWebVitalsPage } = await loadWebVitals();
    initWebVitals();
    const entries: FakeEntry[] = [];
    for (let i = 0; i < 25; i += 1) {
      // Pierwsze zdarzenie gestu jest krótkie, drugie niesie jego opóźnienie.
      entries.push(interaction(10, i + 1));
      entries.push(interaction(i === 0 ? 500 : i === 1 ? 300 : 60, i + 1));
    }
    FakeObserver.forType("event").emit(entries);
    markWebVitalsPage("/x");

    expect(reportsFor("INP")).toHaveLength(1);
    expect(reportsFor("INP")[0]?.metric.value).toBe(500);
  });

  it("krótsze zdarzenie TEJ SAMEJ interakcji NIE obniża jej opóźnienia", async () => {
    // Druga połowa reguły „opóźnieniem interakcji jest NAJDŁUŻSZE z jej
    // zdarzeń". Kolejność wpisów `event` nie jest niczym gwarantowana:
    // przeglądarka potrafi oddać `pointerdown` (długi, bo to on czekał na
    // zajęty wątek) przed krótkimi `pointerup` i `click` tego samego gestu.
    // Gdyby zapis szedł „ostatni wygrywa", 480 ms odczute przez czytelnika
    // zamieniłoby się w 12 ms - a ponieważ INP jest wysokim percentylem, taka
    // podmiana usuwa dokładnie ten ogon rozkładu, po który sięga panel
    // wydajności. Przypadek wyżej dowodzi rosnącej kolejności, ten - malejącej.
    const { initWebVitals, markWebVitalsPage } = await loadWebVitals();
    initWebVitals();
    FakeObserver.forType("event").emit([
      interaction(480, 7),
      interaction(12, 7),
      interaction(120, 7),
    ]);
    markWebVitalsPage("/x");

    const inp = reportsFor("INP");
    expect(inp).toHaveLength(1);
    expect(inp[0]?.metric.value).toBe(480);
    // Ocena idzie od tej samej liczby: 480 mieści się w (200, 500].
    expect(inp[0]?.metric.rating).toBe("needs-improvement");
  });
});

// ---------------------------------------------------------------------------
// KONTEKST NAWIGACJI (audyt CWV 2026-09-20, F40 / wiersz 0.3 „Fali 0").
//
// PO CO TE TESTY ISTNIEJĄ. Pięć nowych pól jest OPISOWYCH, więc żaden z nich
// nie ma jak wywrócić strony - i właśnie dlatego ich defekty byłyby CICHE.
// Źle policzony `coldStart` nie rzuca wyjątku, tylko wpisuje zimne wejście
// tam, gdzie go nie było, a panel pokazuje wtedy liczbę, która wygląda na
// pomiar. Ładunek czytamy z BEACONU (`DEV=false`), bo w DEV `report()` kończy
// na `console.debug` i kontekstu do niego nie dokłada.
describe("kontekst nawigacji w ładunku", () => {
  let originalSendBeacon: typeof navigator.sendBeacon;

  /** Pola `navigator`, które test podmienia i musi po sobie posprzątać. */
  const patchedNavigatorKeys: string[] = [];

  function patchNavigator(key: string, value: unknown): void {
    patchedNavigatorKeys.push(key);
    Object.defineProperty(navigator, key, { configurable: true, writable: true, value });
  }

  beforeEach(() => {
    originalSendBeacon = navigator.sendBeacon;
    vi.stubEnv("DEV", false);
    vi.stubEnv("VITE_OBSERVABILITY_ENDPOINT", "");
    sessionStorage.clear();
  });

  afterEach(() => {
    Object.defineProperty(navigator, "sendBeacon", {
      configurable: true,
      writable: true,
      value: originalSendBeacon,
    });
    for (const key of patchedNavigatorKeys.splice(0)) {
      Reflect.deleteProperty(navigator, key);
    }
    sessionStorage.clear();
  });

  function captureBeacons(): Array<{ url: string; body: BodyInit | null | undefined }> {
    const sent: Array<{ url: string; body: BodyInit | null | undefined }> = [];
    Object.defineProperty(navigator, "sendBeacon", {
      configurable: true,
      writable: true,
      value: (url: string | URL, body?: BodyInit | null) => {
        sent.push({ url: String(url), body });
        return true;
      },
    });
    return sent;
  }

  async function beaconMetrics(
    body: BodyInit | null | undefined,
  ): Promise<Array<Record<string, unknown>>> {
    const text = body instanceof Blob ? await body.text() : String(body);
    return (JSON.parse(text) as { metrics: Array<Record<string, unknown>> }).metrics;
  }

  /**
   * Wpis Navigation Timing z typem nawigacji. `responseStart` jest tu
   * OBOWIĄZKOWY, choć testujemy `type`: ten sam wpis czyta blok TTFB przy
   * inicjalizacji, więc bez niego każdy test dostawałby w batchu dodatkową
   * próbkę TTFB o wartości `undefined`.
   */
  function navigationTypeEntry(type: string): PerformanceEntry {
    return {
      name: "",
      entryType: "navigation",
      startTime: 0,
      duration: 0,
      responseStart: 210,
      type,
      toJSON: () => ({ entryType: "navigation", type, responseStart: 210 }),
    } as unknown as PerformanceEntry;
  }

  /** Próbka o danej nazwie z batcha - batch bywa wielometryczny. */
  function metricNamed(
    metrics: Array<Record<string, unknown>>,
    name: string,
  ): Record<string, unknown> | undefined {
    return metrics.find((metric) => metric.name === name);
  }

  /**
   * Jedna odsłona: inicjalizacja, jedno LCP, miękka nawigacja (granica batcha)
   * - i próbki, które faktycznie wyszły beaconem.
   */
  async function reportOnce(): Promise<Array<Record<string, unknown>>> {
    const sent = captureBeacons();
    const { initWebVitals, markWebVitalsPage } = await loadWebVitals();
    initWebVitals();
    FakeObserver.forType("largest-contentful-paint").emit([lcpEntry(2100)]);
    markWebVitalsPage("/blog");
    expect(sent.length).toBeGreaterThanOrEqual(1);
    return beaconMetrics(sent[0]?.body);
  }

  it("niemierzalny zegar nawigacji NIE dokłada pola `sinceNav`", async () => {
    // `performance.now()` bywa w przeglądarce wyłączone albo zamrożone
    // (ochrona przed pomiarem czasu): wtedy zwraca wartość spoza skali.
    // Kontrakt jest wtedy taki sam jak dla reszty kontekstu - BRAK POLA, a nie
    // zero. Zero wygląda w panelu jak pomiar „metryka padła natychmiast po
    // starcie nawigacji" i zaniża każdą agregację, która je wpuści.
    vi.spyOn(performance, "now").mockReturnValue(Number.NaN);

    const metrics = await reportOnce();

    expect(metrics[0]).not.toHaveProperty("sinceNav");
    // Reszta kontekstu jedzie dalej - jedno niedostępne źródło nie kasuje
    // pozostałych opisów próbki.
    expect(metrics[0]).toHaveProperty("coldStart");
  });

  it("komplet pól jedzie razem z metryką", async () => {
    vi.spyOn(performance, "getEntriesByType").mockReturnValue([
      navigationTypeEntry("back_forward"),
    ] as unknown as PerformanceEntryList);
    vi.spyOn(performance, "now").mockReturnValue(2456.4);
    patchNavigator("deviceMemory", 4);
    patchNavigator("connection", { effectiveType: "3g" });

    const metrics = await reportOnce();

    expect(metricNamed(metrics, "LCP")).toMatchObject({
      name: "LCP",
      value: 2100,
      url: "/en",
      sinceNav: 2456,
      navigationType: "back_forward",
      deviceMemory: 4,
      effectiveType: "3g",
      coldStart: true,
    });
  });

  it("nic z tego nie jest identyfikatorem - ładunek nie zyskuje nowego klucza tożsamości", async () => {
    // Bramka intencji, nie implementacji: gdyby ktoś dołożył tu `sessionId`,
    // `visitorId` czy cokolwiek stabilnego, podstawa prawna tej telemetrii
    // przestałaby obowiązywać, a test przestałby przechodzić.
    patchNavigator("deviceMemory", 8);
    const metrics = await reportOnce();

    expect(Object.keys(metrics[0] ?? {}).sort()).toEqual([
      "coldStart",
      "deviceMemory",
      "effectiveType",
      "id",
      "name",
      "navigationType",
      "rating",
      "sinceNav",
      "ts",
      "url",
      "value",
    ]);
  });

  it("kontekst jest w KAŻDEJ próbce batcha, nie tylko w pierwszej", async () => {
    // Agregacja liczy p75 po SUROWYCH wierszach, więc próbka bez kontekstu
    // wypadłaby z podziału populacji, a nie „odziedziczyła" go po sąsiedniej.
    vi.spyOn(performance, "getEntriesByType").mockReturnValue([
      navigationTypeEntry("navigate"),
    ] as unknown as PerformanceEntryList);
    const sent = captureBeacons();
    const { initWebVitals, markWebVitalsPage } = await loadWebVitals();
    initWebVitals();
    FakeObserver.forType("largest-contentful-paint").emit([lcpEntry(2100)]);
    FakeObserver.forType("layout-shift").emit([shift(0.2, 100)]);
    FakeObserver.forType("event").emit([interaction(320, 7)]);
    markWebVitalsPage("/blog");

    const metrics = await beaconMetrics(sent[0]?.body);
    expect(metrics.map((m) => m.name).sort()).toEqual(["CLS", "INP", "LCP", "TTFB"]);
    for (const metric of metrics) {
      expect(metric).toMatchObject({ navigationType: "navigate", coldStart: true });
      expect(metric.sinceNav).toBeTypeOf("number");
    }
  });

  describe("coldStart", () => {
    it("pierwsze wejście w karcie: true, i zostaje znacznik dla kolejnych", async () => {
      const metrics = await reportOnce();

      expect(metrics[0]?.coldStart).toBe(true);
      expect(sessionStorage.getItem("nes:vitals:nav-seen")).toBe("1");
    });

    it("kolejne wczytanie w tej samej karcie: false", async () => {
      // Drugi dokument w tej samej karcie = świeża instancja modułu, ale TEN
      // SAM `sessionStorage`. To jedyne, co odróżnia zimne wejście od ciepłego.
      sessionStorage.setItem("nes:vitals:nav-seen", "1");

      const metrics = await reportOnce();

      expect(metrics[0]?.coldStart).toBe(false);
    });

    it("zablokowany magazyn (tryb prywatny) daje false, a nie wywrotkę", async () => {
      // `sessionStorage` w trybie prywatnym Safari RZUCA przy dostępie.
      // Fałszywe `true` przy każdej odsłonie takiego czytelnika ZAWYŻAŁOBY
      // populację zimnych wejść - czyli dokładnie tę, którą mierzymy.
      // PODMIENIAMY CAŁY GLOBALNY MAGAZYN, A NIE JEGO METODY - i to nie jest
      // kwestia gustu. `sessionStorage` w happy-dom jest PROXY (`storage.foo =
      // 1` zapisuje pozycję), więc `vi.spyOn(sessionStorage, "getItem")`
      // przechodzi, ale `vi.restoreAllMocks()` NIE zdejmuje takiej atrapy -
      // rzucający `getItem` przeciekał do kolejnego testu i wywracał go
      // komunikatem z TEGO testu. `vi.unstubAllGlobals()` (afterEach wyżej)
      // cofa podmianę globalną niezawodnie. `clear` musi działać, bo woła je
      // sprzątanie tego bloku.
      vi.stubGlobal("sessionStorage", {
        getItem: () => {
          throw new Error("magazyn zablokowany");
        },
        setItem: () => {
          throw new Error("magazyn zablokowany");
        },
        clear: () => {},
      });

      const metrics = await reportOnce();

      expect(metrics[0]?.coldStart).toBe(false);
    });

    it("środowisko BEZ `sessionStorage` (worker, SSR) daje false zamiast wywrotki", async () => {
      // `readColdStart` pyta o magazyn PRZEZ `typeof`, bo ten moduł jest
      // osiągalny z grafu serwerowego (`observability/index.ts`). Odwołanie do
      // nieistniejącej globalnej rzuciłoby `ReferenceError` z wnętrza budowy
      // kontekstu - czyli telemetria zabijałaby render, dla którego jest
      // wyłącznie opisem. Wariant „magazyn rzuca" (tryb prywatny) sprawdza
      // przypadek wyżej; ten sprawdza „magazynu NIE MA WCALE".
      vi.stubGlobal("sessionStorage", undefined);
      try {
        const metrics = await reportOnce();

        expect(metrics[0]?.coldStart).toBe(false);
      } finally {
        // Zdejmujemy od razu: sprzątanie tego bloku woła `sessionStorage.clear()`.
        vi.unstubAllGlobals();
      }
    });

    it("ponowna zgoda w TEJ SAMEJ odsłonie nie ogłasza drugiego zimnego startu", async () => {
      // Teardown (cofnięcie zgody) i ponowna inicjalizacja to nadal ta sama
      // nawigacja. Przeliczenie kontekstu dałoby `coldStart: false`, bo
      // znacznik już stoi - czyli jedna odsłona raportowałaby się raz jako
      // zimna, raz jako ciepła.
      const sent = captureBeacons();
      const { initWebVitals, markWebVitalsPage } = await loadWebVitals();
      const teardown = initWebVitals();
      teardown();

      initWebVitals();
      FakeObserver.forType("largest-contentful-paint").emit([lcpEntry(900)]);
      markWebVitalsPage("/blog");

      const metrics = await beaconMetrics(sent[sent.length - 1]?.body);
      expect(metricNamed(metrics, "LCP")?.coldStart).toBe(true);
    });

    it("zimna jest PIERWSZA trasa: zrzut przy miękkiej nawigacji niesie true i ścieżkę POPRZEDNIĄ", async () => {
      // Granica batcha wypada W ŚRODKU miękkiej nawigacji: `flushCurrent`
      // raportuje metryki trasy, z KTÓREJ schodzimy - i to one, a nie próbki
      // nowej trasy, są tymi jedynymi zimnymi w całym dokumencie. Gdyby flaga
      // gasła przed zrzutem, zimne pierwsze wejście nie zostawiłoby w bazie
      // ANI JEDNEGO wiersza z `cold_start`.
      const sent = captureBeacons();
      const { initWebVitals, markWebVitalsPage } = await loadWebVitals();
      initWebVitals();
      FakeObserver.forType("largest-contentful-paint").emit([lcpEntry(2100)]);
      FakeObserver.forType("layout-shift").emit([shift(0.2, 100)]);
      markWebVitalsPage("/blog");

      expect(sent).toHaveLength(1);
      const metrics = await beaconMetrics(sent[0]?.body);
      expect(metrics.map((metric) => metric.name).sort()).toEqual(["CLS", "LCP"]);
      for (const metric of metrics) {
        expect(metric).toMatchObject({ url: "/en", coldStart: true });
      }
    });

    it("po miękkiej nawigacji próbki są już ciepłe, a reszta kontekstu opisuje TEN SAM dokument", async () => {
      // Sedno uwagi: gdyby `coldStart` trzymał się całego dokumentu,
      // `WHERE cold_start` łapałoby drugą, trzecią i każdą kolejną trasę SPA
      // tej samej karty, więc kolumna nie izolowałaby niczego. Trzy pozostałe
      // pola opisują DOKUMENT i miękka nawigacja nie ma prawa ich ruszyć.
      vi.spyOn(performance, "getEntriesByType").mockReturnValue([
        navigationTypeEntry("navigate"),
      ] as unknown as PerformanceEntryList);
      patchNavigator("deviceMemory", 4);
      patchNavigator("connection", { effectiveType: "3g" });

      const sent = captureBeacons();
      const { initWebVitals, markWebVitalsPage } = await loadWebVitals();
      initWebVitals();
      FakeObserver.forType("largest-contentful-paint").emit([lcpEntry(2100)]);
      markWebVitalsPage("/blog"); // zrzut PIERWSZEJ trasy - tej zimnej
      FakeObserver.forType("largest-contentful-paint").emit([lcpEntry(900)]);
      markWebVitalsPage("/glossary"); // zrzut drugiej trasy - już ciepłej

      expect(sent.length).toBeGreaterThanOrEqual(2);
      const first = await beaconMetrics(sent[0]?.body);
      const second = await beaconMetrics(sent[sent.length - 1]?.body);
      expect(metricNamed(first, "LCP")).toMatchObject({ url: "/en", coldStart: true });
      expect(metricNamed(second, "LCP")).toMatchObject({
        url: "/blog",
        coldStart: false,
        navigationType: "navigate",
        deviceMemory: 4,
        effectiveType: "3g",
      });
    });

    it("po miękkiej nawigacji ponowna zgoda NIE wraca do zimnego startu", async () => {
      // Druga strona kontraktu `??=`: teardown zgody nie przelicza kontekstu,
      // więc raz zgaszona flaga zostaje zgaszona. Bez tego jedna odsłona
      // zgłaszałaby zimne wejście dwa razy - raz na pierwszej trasie, raz po
      // cofnięciu i ponownym wyrażeniu zgody na trasie czwartej.
      const sent = captureBeacons();
      const { initWebVitals, markWebVitalsPage } = await loadWebVitals();
      const teardown = initWebVitals();
      markWebVitalsPage("/blog"); // pierwsza miękka nawigacja gasi flagę
      teardown();

      initWebVitals();
      FakeObserver.forType("largest-contentful-paint").emit([lcpEntry(900)]);
      markWebVitalsPage("/glossary");

      expect(sent.length).toBeGreaterThanOrEqual(1);
      const metrics = await beaconMetrics(sent[sent.length - 1]?.body);
      expect(metricNamed(metrics, "LCP")?.coldStart).toBe(false);
    });
  });

  describe("pola środowiska przeglądarki", () => {
    it("brak Navigation Timing, brak deviceMemory i brak connection -> same null", async () => {
      // Safari i Firefox nie mają Network Information API; `deviceMemory` jest
      // wyłącznie w silnikach Blink. Null jest tu UCZCIWĄ odpowiedzią.
      const metrics = await reportOnce();

      expect(metrics[0]).toMatchObject({
        navigationType: null,
        deviceMemory: null,
        effectiveType: null,
      });
    });

    it("typ nawigacji spoza czterech ze specyfikacji schodzi na null", async () => {
      vi.spyOn(performance, "getEntriesByType").mockReturnValue([
        navigationTypeEntry("teleport"),
      ] as unknown as PerformanceEntryList);

      const metrics = await reportOnce();

      expect(metrics[0]?.navigationType).toBeNull();
    });

    it("klasa łącza spoza specyfikacji schodzi na null", async () => {
      patchNavigator("connection", { effectiveType: "5g" });

      const metrics = await reportOnce();

      expect(metrics[0]?.effectiveType).toBeNull();
    });

    describe("deviceMemory kubełkuje W DÓŁ", () => {
      const cases: Array<[number, number | null]> = [
        [8, 8],
        [16, 8],
        [6, 4],
        [4, 4],
        [3, 2],
        [2, 2],
        [1, 1],
        [0.5, 1],
        [0.25, 1],
        [0, null],
        [-1, null],
        [Number.NaN, null],
      ];

      for (const [raw, expected] of cases) {
        it(`${String(raw)} -> ${String(expected)}`, async () => {
          patchNavigator("deviceMemory", raw);

          const metrics = await reportOnce();

          expect(metrics[0]?.deviceMemory).toBe(expected);
        });
      }
    });
  });

  it("sinceNav to czas ZGŁOSZENIA, nie czas metryki - rośnie między granicami batcha", async () => {
    // To jest cała wartość tego pola: LCP 2 100 ms zgłoszone przy sinceNav
    // 2 300 pochodzi z pierwszego malowania, a to samo LCP przy sinceNav
    // 180 000 - z miękkiej nawigacji w trzeciej minucie czytania.
    const now = vi.spyOn(performance, "now");
    const sent = captureBeacons();
    const { initWebVitals, markWebVitalsPage } = await loadWebVitals();
    initWebVitals();

    now.mockReturnValue(2300);
    FakeObserver.forType("largest-contentful-paint").emit([lcpEntry(2100)]);
    markWebVitalsPage("/blog");

    now.mockReturnValue(180_000);
    FakeObserver.forType("largest-contentful-paint").emit([lcpEntry(2100)]);
    markWebVitalsPage("/glossary");

    const first = await beaconMetrics(sent[0]?.body);
    const second = await beaconMetrics(sent[sent.length - 1]?.body);
    expect(first[0]).toMatchObject({ value: 2100, sinceNav: 2300 });
    expect(second[0]).toMatchObject({ value: 2100, sinceNav: 180_000 });
  });
});

// ---------------------------------------------------------------------------
// P0.6 planu PSI 85/95: stan cache dokumentu, colo i zgrubna atrybucja INP.
//
// PO CO TE TESTY ISTNIEJĄ. Wszystkie nowe pola są OPISOWE i OPCJONALNE, więc
// ich defekty są ciche: źle sparsowany `Server-Timing` nie rzuca, tylko
// wpisuje MISS jako brak danych (albo dowolny napis jako kolonię), a stan
// wyspy przeczytany o jedno malowanie za późno przenosi najgorsze interakcje
// do „po hydratacji". Ładunek czytamy z BEACONU (`DEV=false`), bo w DEV
// `report()` kończy na `console.debug`.
describe("stan cache dokumentu, colo i atrybucja INP w ładunku (P0.6)", () => {
  let originalSendBeacon: typeof navigator.sendBeacon;
  const patchedNavigatorKeys: string[] = [];
  const mountedIslands: Element[] = [];

  function patchNavigator(key: string, value: unknown): void {
    patchedNavigatorKeys.push(key);
    Object.defineProperty(navigator, key, { configurable: true, writable: true, value });
  }

  beforeEach(() => {
    originalSendBeacon = navigator.sendBeacon;
    vi.stubEnv("DEV", false);
    vi.stubEnv("VITE_OBSERVABILITY_ENDPOINT", "");
    sessionStorage.clear();
  });

  afterEach(() => {
    Object.defineProperty(navigator, "sendBeacon", {
      configurable: true,
      writable: true,
      value: originalSendBeacon,
    });
    for (const key of patchedNavigatorKeys.splice(0)) Reflect.deleteProperty(navigator, key);
    for (const root of mountedIslands.splice(0)) root.remove();
    sessionStorage.clear();
  });

  function captureBeacons(): Array<{ url: string; body: BodyInit | null | undefined }> {
    const sent: Array<{ url: string; body: BodyInit | null | undefined }> = [];
    Object.defineProperty(navigator, "sendBeacon", {
      configurable: true,
      writable: true,
      value: (url: string | URL, body?: BodyInit | null) => {
        sent.push({ url: String(url), body });
        return true;
      },
    });
    return sent;
  }

  /** Wszystkie próbki ze wszystkich beaconów, w kolejności wysyłki. */
  async function allMetrics(
    sent: Array<{ body: BodyInit | null | undefined }>,
  ): Promise<Array<Record<string, unknown>>> {
    const out: Array<Record<string, unknown>> = [];
    for (const { body } of sent) {
      const text = body instanceof Blob ? await body.text() : String(body);
      out.push(...(JSON.parse(text) as { metrics: Array<Record<string, unknown>> }).metrics);
    }
    return out;
  }

  function named(
    metrics: Array<Record<string, unknown>>,
    name: string,
  ): Array<Record<string, unknown>> {
    return metrics.filter((metric) => metric.name === name);
  }

  /** Wpis `PerformanceServerTiming` w kształcie, w jakim czyta go reporter. */
  function timing(name: string, description = "", duration = 0): Record<string, unknown> {
    return { name, description, duration };
  }

  /** Nagłówek dokumentu po P0.4, w kolejności z produkcji (`nes-edge` pierwsze). */
  const PRODUCTION_TIMING = [
    timing("nes-edge", "HIT"),
    timing("nes-age", "", 129_280),
    timing("edge-routing", "", 0),
    timing("nes-layer", "L2"),
    timing("colo", "PRG"),
    timing("server-init", "", 0),
    timing("app", "", 0),
  ];

  /**
   * Wpis Navigation Timing. `responseStart` jest obowiązkowy, bo ten sam wpis
   * czyta blok TTFB przy inicjalizacji; `serverTiming` i `loadEventStart` są
   * opcjonalne jak w prawdziwych silnikach (brak klucza = brak API).
   */
  function navigationWith(options: {
    serverTiming?: unknown;
    loadEventStart?: number;
    type?: string;
    transferSize?: number;
    decodedBodySize?: number;
  }): PerformanceEntry {
    const entry: Record<string, unknown> = {
      name: "",
      entryType: "navigation",
      startTime: 0,
      duration: 0,
      responseStart: 210,
      type: options.type ?? "navigate",
      toJSON: () => ({ entryType: "navigation" }),
    };
    if ("serverTiming" in options) entry.serverTiming = options.serverTiming;
    if (options.loadEventStart !== undefined) entry.loadEventStart = options.loadEventStart;
    if (options.transferSize !== undefined) entry.transferSize = options.transferSize;
    if (options.decodedBodySize !== undefined) entry.decodedBodySize = options.decodedBodySize;
    return entry as unknown as PerformanceEntry;
  }

  function mockNavigation(entry: PerformanceEntry): void {
    vi.spyOn(performance, "getEntriesByType").mockReturnValue([
      entry,
    ] as unknown as PerformanceEntryList);
  }

  function eventEntry(
    name: string,
    startTime: number,
    duration: number,
    interactionId: number,
  ): FakeEntry {
    return { name, entryType: "event", startTime, duration, interactionId };
  }

  /** Wyspa hydratacji w DOM (atrybut jak w `HydrationIsland`, P1.6) i przycisk w niej. */
  function islandButton(state: string): { root: HTMLElement; button: HTMLButtonElement } {
    const root = document.createElement("section");
    root.setAttribute("data-island-state", state);
    const button = document.createElement("button");
    root.append(button);
    document.body.append(root);
    mountedIslands.push(root);
    return { root, button };
  }

  function plainButton(): HTMLButtonElement {
    const button = document.createElement("button");
    document.body.append(button);
    mountedIslands.push(button);
    return button;
  }

  /**
   * Naciśnięcie z KONKRETNYM `timeStamp` - tym samym, który przeglądarka wpisuje
   * jako `startTime` wpisu `event` tej interakcji. Własność instancji przykrywa
   * getter prototypu, więc test nie zależy od zegara środowiska. `isTrusted`
   * tak samo: happy-dom go nie wystawia, a `dispatchEvent` w przeglądarce daje
   * `false` - domyślnie udajemy naciśnięcie użytkownika.
   */
  function press(
    target: EventTarget,
    at: number,
    type: "pointerdown" | "keydown",
    trusted = true,
  ): void {
    const event = new Event(type, { bubbles: true, cancelable: true });
    Object.defineProperty(event, "timeStamp", { value: at });
    Object.defineProperty(event, "isTrusted", { value: trusted });
    target.dispatchEvent(event);
  }

  /** Wpis `first-input` (buforowany bez progu) - kopia pierwszego wpisu interakcji. */
  function firstInputEntry(name: string, startTime: number, interactionId = 0): FakeEntry {
    return { name, entryType: "first-input", startTime, duration: 8, interactionId };
  }

  describe("stan cache dokumentu i colo z Server-Timing", () => {
    it("nagłówek po P0.4: edgeCache, edgeLayer i colo w KAŻDEJ próbce PIERWSZEJ trasy, a po miękkiej nawigacji już w żadnej", async () => {
      // Stan cache opisuje dokument, ale wpływa wyłącznie na metryki jego
      // pierwszej trasy: LCP/CLS/INP trasy SPA nie pochodzą z dokumentu podanego
      // z NES Edge Cache, a po stronie zapytania nie da się ich odciąć
      // (`coldStart=false` mają też ciepłe twarde wejścia).
      mockNavigation(navigationWith({ serverTiming: PRODUCTION_TIMING }));
      const sent = captureBeacons();
      const { initWebVitals, markWebVitalsPage } = await loadWebVitals();
      initWebVitals();
      FakeObserver.forType("largest-contentful-paint").emit([lcpEntry(2100)]);
      markWebVitalsPage("/blog");
      FakeObserver.forType("largest-contentful-paint").emit([lcpEntry(900)]);
      markWebVitalsPage("/glossary");

      const metrics = await allMetrics(sent);
      // CLS = 0 jedzie razem z LCP (reguła „bez zalewania zerami" przepuszcza je, gdy LCP wystrzelił).
      expect(metrics.map((metric) => metric.name).sort()).toEqual([
        "CLS",
        "CLS",
        "LCP",
        "LCP",
        "TTFB",
      ]);
      const firstRoute = metrics.filter((metric) => metric.url === "/en");
      const softRoute = metrics.filter((metric) => metric.url === "/blog");
      expect(firstRoute).toHaveLength(3);
      expect(softRoute).toHaveLength(2);
      for (const metric of firstRoute) {
        expect(metric).toMatchObject({ edgeCache: "HIT", edgeLayer: "L2", colo: "PRG" });
      }
      for (const metric of softRoute) {
        expect(metric).not.toHaveProperty("edgeCache");
        expect(metric).not.toHaveProperty("edgeLayer");
        expect(metric).not.toHaveProperty("colo");
        // Kontrola: reszta kontekstu dokumentu zostaje - gaśnie wyłącznie stan cache.
        expect(metric).toMatchObject({ navigationType: "navigate", coldStart: false });
      }
    });

    it("trasa miękka po CIEPŁYM twardym wejściu (coldStart=false od początku) też gubi stan cache", async () => {
      // Zgaszenie nie może zależeć od `coldStart`: ciepłe wejście nie ma czego
      // gasić w fladze, ale stan cache dokumentu nadal opisuje tylko trasę pierwszą.
      sessionStorage.setItem("nes:vitals:nav-seen", "1");
      mockNavigation(navigationWith({ serverTiming: [timing("nes-edge", "MISS")] }));
      const sent = captureBeacons();
      const { initWebVitals, markWebVitalsPage } = await loadWebVitals();
      initWebVitals();
      markWebVitalsPage("/blog");
      FakeObserver.forType("largest-contentful-paint").emit([lcpEntry(900)]);
      window.dispatchEvent(new Event("pagehide"));

      const metrics = await allMetrics(sent);
      expect(named(metrics, "TTFB")[0]).toMatchObject({ edgeCache: "MISS", coldStart: false });
      const [lcp] = named(metrics, "LCP");
      expect(lcp).toMatchObject({ url: "/blog" });
      expect(lcp).not.toHaveProperty("edgeCache");
    });

    it("dokument z lokalnego cache HTTP (transferSize 0, niepuste ciało): Server-Timing jest odtworzony, więc bez pól", async () => {
      // Nawigacja historią bez bfcache: Chrome podaje dokument z dysku mimo
      // `no-cache`, TTFB ~0, a `nes-edge` mówi o PIERWOTNYM pobraniu.
      mockNavigation(
        navigationWith({
          serverTiming: PRODUCTION_TIMING,
          type: "back_forward",
          transferSize: 0,
          decodedBodySize: 48_213,
        }),
      );
      const sent = captureBeacons();
      const { initWebVitals } = await loadWebVitals();
      initWebVitals();
      window.dispatchEvent(new Event("pagehide"));

      const [ttfb] = named(await allMetrics(sent), "TTFB");
      expect(ttfb).toMatchObject({ navigationType: "back_forward" });
      expect(ttfb).not.toHaveProperty("edgeCache");
      expect(ttfb).not.toHaveProperty("edgeLayer");
      expect(ttfb).not.toHaveProperty("colo");
    });

    const networkSizes: Array<[string, { transferSize: number; decodedBodySize: number }]> = [
      ["transfer przez sieć", { transferSize: 48_513, decodedBodySize: 48_213 }],
      [
        "oba pola zerowe (silnik bez Resource Timing rozmiarów)",
        { transferSize: 0, decodedBodySize: 0 },
      ],
    ];
    for (const [label, sizes] of networkSizes) {
      it(`kontrola: ${label} -> pola stanu cache zostają`, async () => {
        mockNavigation(navigationWith({ serverTiming: PRODUCTION_TIMING, ...sizes }));
        const sent = captureBeacons();
        const { initWebVitals } = await loadWebVitals();
        initWebVitals();
        window.dispatchEvent(new Event("pagehide"));

        const [ttfb] = named(await allMetrics(sent), "TTFB");
        expect(ttfb).toMatchObject({ edgeCache: "HIT", edgeLayer: "L2", colo: "PRG" });
      });
    }

    describe("kontrakt z potokiem Server-Timing (P0.4, `src/lib/http/ssrTiming.ts`)", () => {
      /**
       * Minimalny parser nagłówka w kształcie `PerformanceServerTiming`: metryki
       * po `,`, parametry po `;`, `desc` bez cudzysłowów, `dur` jako liczba.
       * Opis może zawierać `=` (`db;desc="n=3"`), więc dzielimy na PIERWSZYM.
       */
      function parseServerTiming(header: string): Array<Record<string, unknown>> {
        return header.split(",").map((metric) => {
          const [name = "", ...params] = metric.trim().split(";");
          let description = "";
          let duration = 0;
          for (const param of params) {
            const eq = param.indexOf("=");
            const key = (eq < 0 ? param : param.slice(0, eq)).trim();
            const value =
              eq < 0
                ? ""
                : param
                    .slice(eq + 1)
                    .trim()
                    .replace(/^"|"$/g, "");
            if (key === "desc") description = value;
            if (key === "dur") duration = Number(value);
          }
          return timing(name.trim(), description, duration);
        });
      }

      it("każdy status i każda warstwa z budowniczych serwera dociera do próbki, a colo z dopisku wejścia Workera", async () => {
        // Przeglądarka łączy oba nagłówki (`src/server.ts` dopisuje drugi) w
        // jedną listę. Zmiana nazwy metryki albo formy (`desc` -> `dur`) po
        // stronie P0.4 wywraca ten test, a nie dopiero panel analityki.
        const { EDGE_CACHE_STATUSES, EDGE_LAYERS } = await loadWebVitals();
        for (const status of EDGE_CACHE_STATUSES) {
          for (const layer of EDGE_LAYERS) {
            const header = [
              buildServerTimingValue(
                status,
                662.4,
                { count: 23, totalMs: 2029 },
                129_280,
                [{ name: "edge-routing", durationMs: 0.4 }],
                layer,
              ),
              buildEntryServerTimingValue(0, 5, "PRG"),
            ].join(", ");
            mockNavigation(navigationWith({ serverTiming: parseServerTiming(header) }));
            const sent = captureBeacons();
            const { initWebVitals } = await loadWebVitals();
            const teardown = initWebVitals();
            window.dispatchEvent(new Event("pagehide"));
            teardown();

            const [ttfb] = named(await allMetrics(sent), "TTFB");
            expect(ttfb, `${status}/${layer}`).toMatchObject({
              edgeCache: status,
              edgeLayer: layer,
              colo: "PRG",
            });
          }
        }
      });

      it("warstwa spoza słownika serwera (`L3`) nie jest przepisywana - kolumna nie utrwali wartości, której nikt nie wysyła", async () => {
        mockNavigation(
          navigationWith({ serverTiming: [timing("nes-edge", "HIT"), timing("nes-layer", "L3")] }),
        );
        const sent = captureBeacons();
        const { initWebVitals, EDGE_LAYERS } = await loadWebVitals();
        initWebVitals();
        window.dispatchEvent(new Event("pagehide"));

        expect(EDGE_LAYERS).toEqual(["L1", "L2", "render"]);
        const [ttfb] = named(await allMetrics(sent), "TTFB");
        expect(ttfb).toMatchObject({ edgeCache: "HIT" });
        expect(ttfb).not.toHaveProperty("edgeLayer");
      });
    });

    it("nagłówek sprzed P0.4 (sam nes-edge): jest edgeCache, a edgeLayer i colo NIE MA", async () => {
      // Brak twardej zależności od P0.4: dzisiejsza produkcja wystawia samo
      // `nes-edge` i to ono ma już dzielić populację na HIT/MISS.
      mockNavigation(
        navigationWith({
          serverTiming: [
            timing("nes-edge", "MISS"),
            timing("ssr", "", 662),
            timing("db", "n=23", 2029),
            timing("edge-routing", "", 280),
          ],
        }),
      );
      const sent = captureBeacons();
      const { initWebVitals } = await loadWebVitals();
      initWebVitals();
      FakeObserver.forType("largest-contentful-paint").emit([lcpEntry(2100)]);
      window.dispatchEvent(new Event("pagehide"));

      const [lcp] = named(await allMetrics(sent), "LCP");
      expect(lcp).toMatchObject({ edgeCache: "MISS" });
      expect(lcp).not.toHaveProperty("edgeLayer");
      expect(lcp).not.toHaveProperty("colo");
    });

    const missingHeaders: Array<[string, PerformanceEntry]> = [
      ["wpis bez pola serverTiming", navigationWith({})],
      ["pusta lista", navigationWith({ serverTiming: [] })],
      ["napis zamiast listy", navigationWith({ serverTiming: 'nes-edge;desc="HIT"' })],
      [
        "śmieci w liście",
        navigationWith({
          serverTiming: [null, 42, "nes-edge", { name: 1, description: "HIT" }, { name: "colo" }],
        }),
      ],
    ];
    for (const [label, entry] of missingHeaders) {
      it(`brak czytelnego Server-Timing (${label}) -> żadnego z trzech pól i żadnego rzutu`, async () => {
        mockNavigation(entry);
        const sent = captureBeacons();
        const { initWebVitals } = await loadWebVitals();
        expect(() => initWebVitals()).not.toThrow();
        FakeObserver.forType("largest-contentful-paint").emit([lcpEntry(2100)]);
        window.dispatchEvent(new Event("pagehide"));

        const metrics = await allMetrics(sent);
        expect(metrics.length).toBeGreaterThan(0);
        for (const metric of metrics) {
          expect(metric).not.toHaveProperty("edgeCache");
          expect(metric).not.toHaveProperty("edgeLayer");
          expect(metric).not.toHaveProperty("colo");
        }
      });
    }

    it("wartości spoza listy dozwolonych odpadają, zamiast wjechać do ładunku", async () => {
      // Nagłówek może zmienić pośrednik po drodze; pole przepisywane „jak
      // leci" byłoby kanałem dowolnego napisu do bazy.
      mockNavigation(
        navigationWith({
          serverTiming: [
            timing("nes-edge", "EVIL"),
            timing("nes-layer", "L9"),
            timing("colo", "PRAGUE"),
          ],
        }),
      );
      const sent = captureBeacons();
      const { initWebVitals } = await loadWebVitals();
      initWebVitals();
      FakeObserver.forType("largest-contentful-paint").emit([lcpEntry(2100)]);
      window.dispatchEvent(new Event("pagehide"));

      const [lcp] = named(await allMetrics(sent), "LCP");
      expect(lcp).toBeDefined();
      expect(lcp).not.toHaveProperty("edgeCache");
      expect(lcp).not.toHaveProperty("edgeLayer");
      expect(lcp).not.toHaveProperty("colo");
    });

    for (const colo of ["P1G", "<b>", "PR", ""]) {
      it(`kolonia spoza wzorca trzech liter (${JSON.stringify(colo)}) nie jest przepisywana`, async () => {
        mockNavigation(navigationWith({ serverTiming: [timing("colo", colo)] }));
        const sent = captureBeacons();
        const { initWebVitals } = await loadWebVitals();
        initWebVitals();
        window.dispatchEvent(new Event("pagehide"));

        const [ttfb] = named(await allMetrics(sent), "TTFB");
        expect(ttfb).toBeDefined();
        expect(ttfb).not.toHaveProperty("colo");
      });
    }

    it("wielkość liter jest normalizowana, a przy zdublowanej metryce wygrywa PIERWSZA", async () => {
      // Potok serwera stawia `nes-edge` na początku nagłówka; dopisek tej samej
      // metryki przez pośrednika nie może nadpisać naszego statusu.
      mockNavigation(
        navigationWith({
          serverTiming: [
            timing("nes-edge", " stale "),
            timing("nes-edge", "HIT"),
            timing("nes-layer", "Render"),
            timing("colo", "waw"),
            timing("colo", "FRA"),
          ],
        }),
      );
      const sent = captureBeacons();
      const { initWebVitals } = await loadWebVitals();
      initWebVitals();
      window.dispatchEvent(new Event("pagehide"));

      const [ttfb] = named(await allMetrics(sent), "TTFB");
      expect(ttfb).toMatchObject({ edgeCache: "STALE", edgeLayer: "render", colo: "WAW" });
    });

    it("ponowna zgoda w tej samej odsłonie NIE przelicza stanu cache - to nadal ten sam dokument", async () => {
      mockNavigation(navigationWith({ serverTiming: [timing("nes-edge", "HIT")] }));
      const sent = captureBeacons();
      const { initWebVitals } = await loadWebVitals();
      const teardown = initWebVitals();
      teardown();

      mockNavigation(navigationWith({ serverTiming: [timing("nes-edge", "MISS")] }));
      initWebVitals();
      FakeObserver.forType("largest-contentful-paint").emit([lcpEntry(900)]);
      window.dispatchEvent(new Event("pagehide"));

      const [lcp] = named(await allMetrics(sent), "LCP");
      expect(lcp).toMatchObject({ edgeCache: "HIT" });
    });
  });

  describe("zgrubna atrybucja INP", () => {
    async function inpAfter(
      act: (vitals: { emit: (entries: FakeEntry[]) => void }) => void,
    ): Promise<{
      inp: Record<string, unknown> | undefined;
      metrics: Array<Record<string, unknown>>;
    }> {
      const sent = captureBeacons();
      const { initWebVitals } = await loadWebVitals();
      const teardown = initWebVitals();
      // NAJNOWSZY obserwer `event`: kilka wywołań w jednym teście to kilka
      // świeżych instancji modułu, a `forType` oddaje pierwszą.
      const observer = FakeObserver.instances.filter((o) => o.requested.includes("event")).at(-1);
      act({ emit: (entries) => observer?.emit(entries) });
      window.dispatchEvent(new Event("pagehide"));
      // Teardown zdejmuje nasłuch i flagę inicjalizacji przed kolejnym wywołaniem.
      teardown();
      const metrics = await allMetrics(sent);
      return { inp: named(metrics, "INP")[0], metrics };
    }

    it("inpEvent to typ NAJDŁUŻSZEGO wpisu interakcji, a atrybucję niesie WYŁĄCZNIE próbka INP", async () => {
      const sent = captureBeacons();
      const { initWebVitals } = await loadWebVitals();
      initWebVitals();
      FakeObserver.forType("largest-contentful-paint").emit([lcpEntry(2100)]);
      FakeObserver.forType("event").emit([
        eventEntry("pointerdown", 1000, 48, 5),
        eventEntry("pointerup", 1070, 56, 5),
        eventEntry("click", 1080, 200, 5),
      ]);
      window.dispatchEvent(new Event("pagehide"));

      const metrics = await allMetrics(sent);
      expect(named(metrics, "INP")[0]).toMatchObject({ value: 200, inpEvent: "click" });
      for (const name of ["LCP", "CLS"]) {
        for (const metric of named(metrics, name)) {
          expect(metric).not.toHaveProperty("inpEvent");
          expect(metric).not.toHaveProperty("inpPreHydration");
          expect(metric).not.toHaveProperty("inpSinceLoad");
        }
      }
    });

    it("remis czasów (wpisy jednej klatki, zaokrąglone do 8 ms): inpEvent to PIERWSZY z najdłuższych, nie click", async () => {
      // Realne czasy: `pointerup` i `click` z jednego zadania kończą się przy
      // tym samym malowaniu, więc wcześniejszy `pointerup` ma czas >= `click`.
      // Wartość kolumny to „pierwsze zdarzenie najwolniejszej klatki", nie handler.
      const { inp } = await inpAfter(({ emit }) => {
        emit([
          eventEntry("pointerdown", 1000, 48, 5),
          eventEntry("pointerup", 1064, 208, 5),
          eventEntry("click", 1072, 200, 5),
        ]);
        emit([eventEntry("pointerup", 2000, 200, 6), eventEntry("click", 2000, 200, 6)]);
      });
      expect(inp).toMatchObject({ value: 208, inpEvent: "pointerup" });

      const tie = await inpAfter(({ emit }) => {
        emit([eventEntry("pointerup", 2000, 200, 6), eventEntry("click", 2000, 200, 6)]);
      });
      expect(tie.inp).toMatchObject({ value: 200, inpEvent: "pointerup" });
    });

    it("typ zdarzenia spoza zamkniętej listy schodzi do other", async () => {
      const { inp } = await inpAfter(({ emit }) => {
        emit([eventEntry("contextmenu", 1000, 160, 2)]);
      });
      expect(inp).toMatchObject({ inpEvent: "other" });
    });

    it("interakcja na NIEUWODNIONEJ wyspie: true, nawet gdy wyspa uwodniła się, zanim wpis dotarł", async () => {
      // Sedno odczytu w chwili zdarzenia: to właśnie ta interakcja uwadnia
      // wyspę, więc w obserwerze atrybut mówi już `hydrated`. Odczyt tam
      // przeniósłby najgorszy przypadek do „po hydratacji".
      const { root, button } = islandButton("pending");
      const { inp } = await inpAfter(({ emit }) => {
        press(button, 1000, "pointerdown");
        root.setAttribute("data-island-state", "hydrated");
        emit([eventEntry("pointerdown", 1000, 320, 9)]);
      });
      expect(inp).toMatchObject({ value: 320, inpEvent: "pointerdown", inpPreHydration: true });
    });

    it("wyspa uwodniona już w chwili interakcji: false", async () => {
      const { button } = islandButton("hydrated");
      const { inp } = await inpAfter(({ emit }) => {
        press(button, 1000, "keydown");
        emit([eventEntry("keydown", 1000, 120, 4)]);
      });
      expect(inp).toMatchObject({ inpEvent: "keydown", inpPreHydration: false });
    });

    it("nieznana wartość atrybutu nie jest zgadywana w żadną stronę", async () => {
      const { button } = islandButton("hydrating");
      const { inp } = await inpAfter(({ emit }) => {
        press(button, 1000, "pointerdown");
        emit([eventEntry("pointerdown", 1000, 120, 4)]);
      });
      expect(inp).toBeDefined();
      expect(inp).not.toHaveProperty("inpPreHydration");
    });

    it("cel poza wyspą: BRAK pola - i nie dziedziczy stanu poprzedniej interakcji na wyspie", async () => {
      // Start zapisujemy przy każdym naciśnięciu, także poza wyspą; bez tego
      // druga interakcja „pożyczyłaby" `pending` od pierwszej.
      const { button: onIsland } = islandButton("pending");
      const outside = plainButton();
      const { inp } = await inpAfter(({ emit }) => {
        press(onIsland, 1000, "pointerdown");
        emit([eventEntry("pointerdown", 1000, 60, 1)]);
        press(outside, 3000, "pointerdown");
        emit([eventEntry("pointerdown", 3000, 400, 2)]);
      });
      expect(inp).toMatchObject({ value: 400 });
      expect(inp).not.toHaveProperty("inpPreHydration");
    });

    it("sam wpis click (pointerdown krótszy niż próg 40 ms) łączy się ze startem TEJ interakcji", async () => {
      const { button } = islandButton("pending");
      const { inp } = await inpAfter(({ emit }) => {
        press(button, 1000, "pointerdown");
        emit([eventEntry("click", 1090, 250, 3)]);
      });
      expect(inp).toMatchObject({ inpEvent: "click", inpPreHydration: true });
    });

    it("start nieznany (wpis z bufora sprzed inicjalizacji): brak pola", async () => {
      // Wyspa w DOM jest `pending`, ale naciśnięcia nikt nie zapisał - nie
      // zgadujemy stanu z DOM w chwili obserwatora.
      islandButton("pending");
      const { inp } = await inpAfter(({ emit }) => {
        emit([eventEntry("pointerdown", 500, 200, 1)]);
      });
      expect(inp).toMatchObject({ value: 200 });
      expect(inp).not.toHaveProperty("inpPreHydration");
    });

    it("zapisany start starszy niż 5 s: brak pola, choć rekord był na nieuwodnionej wyspie", async () => {
      const { button } = islandButton("pending");
      const { inp } = await inpAfter(({ emit }) => {
        press(button, 1000, "pointerdown");
        emit([eventEntry("click", 7000, 300, 2)]);
      });
      expect(inp).toMatchObject({ value: 300 });
      expect(inp).not.toHaveProperty("inpPreHydration");
    });

    it("tolerancja zegara: start zapisany do 1 ms PO startTime wpisu to nadal ta interakcja, 1,5 ms - już nie", async () => {
      // `timeStamp` zdarzenia i `startTime` wpisu mogą się różnić zgrubnieniem zegara.
      const { button } = islandButton("pending");
      const within = await inpAfter(({ emit }) => {
        press(button, 1000.8, "pointerdown");
        emit([eventEntry("pointerdown", 1000, 300, 1)]);
      });
      expect(within.inp).toMatchObject({ inpPreHydration: true });

      const beyond = await inpAfter(({ emit }) => {
        press(button, 1001.5, "pointerdown");
        emit([eventEntry("pointerdown", 1000, 300, 1)]);
      });
      expect(beyond.inp).toMatchObject({ value: 300 });
      expect(beyond.inp).not.toHaveProperty("inpPreHydration");
    });

    it("zdarzenie syntetyczne (isTrusted=false) nie trafia do pierścienia i nie przesuwa dopasowania", async () => {
      // `dispatchEvent` biblioteki między `pointerdown` a `click`: bez filtra
      // `click` dopasowałby się do syntetycznego rekordu spoza wyspy.
      const { button } = islandButton("pending");
      const outside = plainButton();
      const { inp } = await inpAfter(({ emit }) => {
        press(button, 1000, "pointerdown");
        press(outside, 1050, "pointerdown", false);
        emit([eventEntry("click", 1090, 250, 3)]);
      });
      expect(inp).toMatchObject({ inpEvent: "click", inpPreHydration: true });

      const onlySynthetic = await inpAfter(({ emit }) => {
        press(button, 1000, "pointerdown", false);
        emit([eventEntry("pointerdown", 1000, 250, 3)]);
      });
      expect(onlySynthetic.inp).not.toHaveProperty("inpPreHydration");
    });

    it("atrybucja opisuje interakcję WYZNACZAJĄCĄ INP, nie ostatnią", async () => {
      const { button } = islandButton("pending");
      const outside = plainButton();
      const { inp } = await inpAfter(({ emit }) => {
        press(button, 1000, "keydown");
        emit([eventEntry("keydown", 1000, 400, 1)]);
        press(outside, 2000, "pointerdown");
        emit([eventEntry("pointerdown", 2000, 80, 2)]);
      });
      expect(inp).toMatchObject({ value: 400, inpEvent: "keydown", inpPreHydration: true });
    });

    it("kliknięcie wywołujące miękką nawigację, którego wpis dociera PO markWebVitalsPage, zachowuje stan wyspy", async () => {
      // Dokładnie ten przypadek uzasadnia, że `resetAccumulators` nie czyści pierścienia.
      const { button } = islandButton("pending");
      const sent = captureBeacons();
      const { initWebVitals, markWebVitalsPage } = await loadWebVitals();
      initWebVitals();
      press(button, 1000, "pointerdown");
      markWebVitalsPage("/blog");
      FakeObserver.forType("event").emit([eventEntry("pointerdown", 1000, 300, 1)]);
      window.dispatchEvent(new Event("pagehide"));

      const [inp] = named(await allMetrics(sent), "INP");
      expect(inp).toMatchObject({
        url: "/blog",
        value: 300,
        inpPreHydration: true,
        inpFirst: true,
      });
    });

    describe("inpFirst - pierwsza interakcja DOKUMENTU", () => {
      it("INP wyznacza PIERWSZA interakcja: inpFirst = true", async () => {
        const { inp } = await inpAfter(({ emit }) => {
          emit([eventEntry("pointerdown", 1000, 400, 1)]);
          emit([eventEntry("keydown", 3000, 80, 2)]);
        });
        expect(inp).toMatchObject({ value: 400, inpFirst: true });
      });

      it("INP wyznacza DRUGA interakcja: pola nie ma", async () => {
        const { inp } = await inpAfter(({ emit }) => {
          emit([eventEntry("pointerdown", 1000, 80, 1)]);
          emit([eventEntry("keydown", 3000, 400, 2)]);
        });
        expect(inp).toMatchObject({ value: 400 });
        expect(inp).not.toHaveProperty("inpFirst");
      });

      it("pierwsza interakcja krótsza niż próg 40 ms (widzi ją tylko first-input): późniejsza NIE jest pierwsza", async () => {
        // Bez buforowanego `first-input` pierwszą widzianą interakcją byłaby ta
        // o 3000 i dostałaby fałszywe `true`.
        const { inp } = await inpAfter(({ emit }) => {
          emit([eventEntry("keydown", 3000, 400, 2)]);
          emit([firstInputEntry("pointerdown", 1000)]);
        });
        expect(inp).toMatchObject({ value: 400 });
        expect(inp).not.toHaveProperty("inpFirst");
      });

      it("first-input z interactionId: decyduje równość identyfikatorów, nie czas", async () => {
        const first = await inpAfter(({ emit }) => {
          emit([firstInputEntry("pointerdown", 1000, 11)]);
          emit([eventEntry("click", 1090, 300, 11)]);
        });
        expect(first.inp).toMatchObject({ value: 300, inpFirst: true });

        const other = await inpAfter(({ emit }) => {
          emit([firstInputEntry("pointerdown", 1000, 11)]);
          emit([eventEntry("pointerdown", 1000, 60, 11), eventEntry("keydown", 1000.5, 300, 12)]);
        });
        expect(other.inp).toMatchObject({ value: 300 });
        expect(other.inp).not.toHaveProperty("inpFirst");
      });

      it("pointerdown krótszy niż próg (najwcześniejszy wpis to click): dopasowanie przez zapisane naciśnięcie", async () => {
        const { button } = islandButton("hydrated");
        const { inp } = await inpAfter(({ emit }) => {
          press(button, 1000, "pointerdown");
          emit([firstInputEntry("pointerdown", 1000)]);
          emit([eventEntry("click", 1090, 250, 3)]);
        });
        expect(inp).toMatchObject({ inpEvent: "click", inpPreHydration: false, inpFirst: true });
      });

      it("miękka nawigacja NIE zeruje pierwszej interakcji: druga trasa nie ma własnej", async () => {
        const sent = captureBeacons();
        const { initWebVitals, markWebVitalsPage } = await loadWebVitals();
        initWebVitals();
        const events = FakeObserver.forType("event");
        events.emit([firstInputEntry("pointerdown", 1000)]);
        events.emit([eventEntry("pointerdown", 1000, 120, 1)]);
        markWebVitalsPage("/blog");
        events.emit([eventEntry("keydown", 5000, 300, 2)]);
        window.dispatchEvent(new Event("pagehide"));

        const inps = named(await allMetrics(sent), "INP");
        expect(inps).toHaveLength(2);
        expect(inps[0]).toMatchObject({ url: "/en", value: 120, inpFirst: true });
        expect(inps[1]).toMatchObject({ url: "/blog", value: 300 });
        expect(inps[1]).not.toHaveProperty("inpFirst");
      });

      it("brak typu first-input w przeglądarce: INP działa, a pierwsza jest najwcześniejsza widziana interakcja", async () => {
        FakeObserver.failFor = ["first-input"];
        const { inp } = await inpAfter(({ emit }) => {
          emit([eventEntry("pointerdown", 1000, 400, 1)]);
          emit([eventEntry("keydown", 3000, 80, 2)]);
        });
        expect(inp).toMatchObject({ value: 400, inpFirst: true });
      });

      it("teardown zgody zeruje stan pierwszej interakcji - po ponownej zgodzie decyduje tylko nowy obserwer", async () => {
        // Bez zerowania start sprzed cofnięcia zgody (1000) przeżyłby teardown.
        // Tu nowy obserwer nie dostaje `first-input`, więc pierwszą jest
        // najwcześniejsza interakcja widziana PO zgodzie.
        FakeObserver.failFor = ["first-input"];
        const sent = captureBeacons();
        const { initWebVitals } = await loadWebVitals();
        const teardown = initWebVitals();
        FakeObserver.forType("event").emit([eventEntry("pointerdown", 1000, 60, 1)]);
        teardown();

        initWebVitals();
        FakeObserver.instances[FakeObserver.instances.length - 1]?.emit([
          eventEntry("keydown", 4000, 300, 2),
        ]);
        window.dispatchEvent(new Event("pagehide"));

        const [inp] = named(await allMetrics(sent), "INP");
        expect(inp).toMatchObject({ value: 300, inpFirst: true });
      });
    });

    describe("kontrakt data-island-state z P1.6", () => {
      it("nazwa atrybutu i słownik stanów są przypięte - zmiana po jednej stronie wywraca ten test", async () => {
        const { ISLAND_STATE_ATTR, ISLAND_STATES } = await loadWebVitals();
        expect(ISLAND_STATE_ATTR).toBe("data-island-state");
        expect(ISLAND_STATES).toEqual(["pending", "hydrated"]);
      });

      it("typ IslandStateAttributes przyjmuje wyłącznie słownik reportera (sprawdza tsc)", () => {
        const pending: IslandStateAttributes = { "data-island-state": "pending" };
        const hydrated: IslandStateAttributes = { "data-island-state": "hydrated" };
        // @ts-expect-error - trzeci stan oznaczałby brak pola inpPreHydration
        const hydrating: IslandStateAttributes = { "data-island-state": "hydrating" };
        // @ts-expect-error - literówka w nazwie atrybutu: closest() niczego nie znajdzie
        const typo: IslandStateAttributes = { "data-island": "pending" };
        expect([pending, hydrated, hydrating, typo]).toHaveLength(4);
      });

      it("każdy stan ze słownika daje pole, a otoczka obejmuje cel w głębi drzewa", async () => {
        const { ISLAND_STATE_ATTR, ISLAND_STATES } = await loadWebVitals();
        const expected: Record<IslandState, boolean> = { pending: true, hydrated: false };
        for (const state of ISLAND_STATES) {
          const root = document.createElement("section");
          root.setAttribute(ISLAND_STATE_ATTR, state);
          const wrapper = document.createElement("div");
          const nested = document.createElement("span");
          wrapper.append(nested);
          root.append(wrapper);
          document.body.append(root);
          mountedIslands.push(root);
          const { inp } = await inpAfter(({ emit }) => {
            press(nested, 1000, "pointerdown");
            emit([eventEntry("pointerdown", 1000, 300, 1)]);
          });
          expect(inp, state).toMatchObject({ inpPreHydration: expected[state] });
        }
      });
    });

    describe("inpSinceLoad", () => {
      it("ms od startu load do początku interakcji - dodatnie po load", async () => {
        mockNavigation(navigationWith({ loadEventStart: 1500 }));
        const { inp } = await inpAfter(({ emit }) => {
          emit([eventEntry("click", 4000, 200, 1)]);
        });
        expect(inp).toMatchObject({ inpSinceLoad: 2500 });
      });

      it("interakcja przed load: wartość UJEMNA", async () => {
        mockNavigation(navigationWith({ loadEventStart: 1500 }));
        const { inp } = await inpAfter(({ emit }) => {
          emit([eventEntry("pointerdown", 1000.4, 200, 1)]);
        });
        expect(inp).toMatchObject({ inpSinceLoad: -500 });
      });

      it("load jeszcze nie nastąpił w chwili zrzutu: odniesieniem jest TERAZ, wynik ujemny", async () => {
        // Miękka nawigacja kliknięta w trakcie ładowania: pominięcie pola
        // wycięłoby z rozkładu właśnie interakcje z czasu bootu.
        mockNavigation(navigationWith({ loadEventStart: 0 }));
        vi.spyOn(performance, "now").mockReturnValue(2600);
        const { inp } = await inpAfter(({ emit }) => {
          emit([eventEntry("pointerdown", 1000, 200, 1)]);
        });
        expect(inp).toMatchObject({ inpSinceLoad: -1600 });
      });

      it("brak Navigation Timing: brak pola, nie zero", async () => {
        const { inp } = await inpAfter(({ emit }) => {
          emit([eventEntry("click", 4000, 200, 1)]);
        });
        expect(inp).toBeDefined();
        expect(inp).not.toHaveProperty("inpSinceLoad");
      });

      it("wartość spoza doby: brak pola", async () => {
        mockNavigation(navigationWith({ loadEventStart: 1000 }));
        const { inp } = await inpAfter(({ emit }) => {
          emit([eventEntry("click", 1000 + 24 * 60 * 60 * 1_000 + 1, 200, 1)]);
        });
        expect(inp).toBeDefined();
        expect(inp).not.toHaveProperty("inpSinceLoad");
      });
    });

    it("teardown zdejmuje nasłuch startów i czyści pierścień - start sprzed cofnięcia zgody nie opisuje niczego", async () => {
      const { button } = islandButton("pending");
      const sent = captureBeacons();
      const { initWebVitals } = await loadWebVitals();
      const teardown = initWebVitals();
      press(button, 900, "pointerdown"); // zapisany - nasłuch jeszcze żyje
      teardown();
      press(button, 1000, "pointerdown"); // po cofnięciu zgody: nikt nie słucha

      initWebVitals();
      FakeObserver.instances[FakeObserver.instances.length - 1]?.emit([
        eventEntry("pointerdown", 1000, 300, 1),
      ]);
      window.dispatchEvent(new Event("pagehide"));

      const [inp] = named(await allMetrics(sent), "INP");
      expect(inp).toMatchObject({ value: 300 });
      expect(inp).not.toHaveProperty("inpPreHydration");
    });
  });

  describe("prywatność i budżet bajtów", () => {
    /**
     * Najcięższa możliwa próbka: ścieżka ponad limit, najdłuższe wartości
     * każdego pola z listy i wszystkie pola opcjonalne naraz. Liczby też
     * najdłuższe: `value` 24 znaki (najdłuższy zapis liczby bez wykładnika),
     * `sinceNav` 10 cyfr (karta otwarta ~4 miesiące), `inpSinceLoad` 9 znaków
     * z minusem (granica doby).
     */
    async function heaviestInpSample(): Promise<Record<string, unknown>> {
      history.replaceState({}, "", "/" + "p".repeat(900));
      sessionStorage.setItem("nes:vitals:nav-seen", "1"); // coldStart: false (5 znaków)
      patchNavigator("deviceMemory", 8);
      patchNavigator("connection", { effectiveType: "slow-2g" });
      vi.spyOn(performance, "now").mockReturnValue(9_999_999_999);
      mockNavigation(
        navigationWith({
          type: "back_forward",
          loadEventStart: 1000 + 86_399_999,
          serverTiming: [
            timing("nes-edge", "BYPASS"),
            timing("nes-layer", "render"),
            timing("colo", "PRG"),
          ],
        }),
      );
      const { button } = islandButton("hydrated");
      const sent = captureBeacons();
      const { initWebVitals } = await loadWebVitals();
      initWebVitals();
      press(button, 1000, "pointerdown");
      FakeObserver.forType("event").emit([
        eventEntry("pointerdown", 1000, 0.0000012345678901234567, 77),
      ]);
      window.dispatchEvent(new Event("pagehide"));
      const [inp] = named(await allMetrics(sent), "INP");
      expect(inp).toBeDefined();
      return inp ?? {};
    }

    it("komplet kluczy próbki INP ze wszystkimi polami - nadal ani jednego identyfikatora", async () => {
      const sample = await heaviestInpSample();

      expect(Object.keys(sample).sort()).toEqual([
        "coldStart",
        "colo",
        "deviceMemory",
        "edgeCache",
        "edgeLayer",
        "effectiveType",
        "id",
        "inpEvent",
        "inpFirst",
        "inpPreHydration",
        "inpSinceLoad",
        "name",
        "navigationType",
        "rating",
        "sinceNav",
        "ts",
        "url",
        "value",
      ]);
      expect(sample).toMatchObject({
        edgeCache: "BYPASS",
        edgeLayer: "render",
        colo: "PRG",
        inpEvent: "pointerdown",
        inpPreHydration: false,
        inpSinceLoad: -86_399_999,
        inpFirst: true,
        sinceNav: 9_999_999_999,
      });
      expect(JSON.stringify(sample.value)).toHaveLength(24);
    });

    it("najgorszy batch (MAX_METRICS najcięższych próbek) mieści się w MAX_BODY ingestu", async () => {
      // `src/routes/api/public/vitals.ts`: MAX_BODY = 8 000 znaków (ciało
      // dłuższe odpada W CAŁOŚCI), MAX_METRICS = 8 - jak w `webVitals.ts`.
      // Zakładamy osiem próbek INP (z atrybucją), choć naturalny batch ma
      // jedną, i najdłuższą ocenę z trzech możliwych. Zmierzone przy tej
      // zmianie (z `inpFirst` i najdłuższymi zapisami liczb): 901 znaków na
      // próbkę, 7 229 na batch - zapas ~770 znaków.
      const sample = await heaviestInpSample();
      expect(String(sample.url)).toHaveLength(512);
      const worst = JSON.stringify({ ...sample, rating: "needs-improvement" });
      const maxMetrics = 8;
      const wrapper = JSON.stringify({ metrics: [] }).length + (maxMetrics - 1);

      expect(maxMetrics * worst.length + wrapper).toBeLessThanOrEqual(8_000);
    });
  });
});
