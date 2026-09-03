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

import type { VitalRating } from "@/lib/observability/vitalsThresholds";

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
});
