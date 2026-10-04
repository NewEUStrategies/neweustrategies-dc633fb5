// Jeden punkt ciszy strony: minimum po load, okno 5 s przesuwane przez długie
// zadania i LICZONE zasoby, lista ignorowanych (slajdy, poll wersji, flock,
// Google, własne żądania konsumentów), brak kaskady między konsumentami,
// limit 20 s także w ukrytej karcie, wstrzymanie okna w tle, Safari, prerender,
// punkt przy wciśniętym przycisku, promise konsumenta, `takeRecords`.
// Fałszywe zegary (z `performance.now` i rAF co 16 ms) i atrapa
// `PerformanceObserver` z rozdziałem typu wpisu i trybem spóźnionego
// dostarczania (przeglądarka oddaje wpisy asynchronicznie).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { __resetFirstInteractionForTests } from "../firstInteraction";
import { GESTURE_FALLBACK_MS, __resetPostInteractionQueueForTests } from "../postInteractionQueue";
import {
  QUIESCENCE_CAP_MS,
  QUIESCENCE_LOAD_DEADLINE_MS,
  QUIESCENCE_MIN_AFTER_LOAD_MS,
  QUIESCENCE_WINDOW_MS,
  __resetQuiescenceForTests,
  getQuiescence,
  onQuiescent,
  registerOwnedRequest,
} from "../whenQuiescent";

interface FakeEntry {
  readonly entryType: string;
  readonly name: string;
  readonly startTime: number;
  readonly duration: number;
  readonly initiatorType?: string;
}

/**
 * Atrapa `PerformanceObserver`: wpis trafia WYŁĄCZNIE do obserwatorów swojego
 * typu. `emit` dostarcza od razu, `emitLate` - jak przeglądarka: wpis czeka w
 * buforze obserwatora (widoczny dla `takeRecords()`) na późniejsze `deliver()`.
 */
class FakePerformanceObserver {
  static supportedEntryTypes: string[] | undefined = ["longtask", "resource"];
  static readonly active = new Set<FakePerformanceObserver>();
  static readonly observed: Array<{ type: string; buffered?: boolean }> = [];
  type: string | null = null;
  pending: FakeEntry[] = [];

  constructor(readonly callback: (list: { getEntries: () => FakeEntry[] }) => void) {}

  observe(init: { type: string; buffered?: boolean }): void {
    this.type = init.type;
    FakePerformanceObserver.observed.push(init);
    FakePerformanceObserver.active.add(this);
  }

  takeRecords(): FakeEntry[] {
    const records = this.pending;
    this.pending = [];
    return records;
  }

  deliver(): void {
    const records = this.takeRecords();
    if (records.length) this.callback({ getEntries: () => records });
  }

  disconnect(): void {
    FakePerformanceObserver.active.delete(this);
  }
}

function emit(entry: FakeEntry): void {
  for (const observer of [...FakePerformanceObserver.active]) {
    if (observer.type === entry.entryType) observer.callback({ getEntries: () => [entry] });
  }
}

function emitLate(entry: FakeEntry): void {
  for (const observer of FakePerformanceObserver.active) {
    if (observer.type === entry.entryType) observer.pending.push(entry);
  }
}

/** Długie zadanie kończące się TERAZ. */
function longTask(duration = 80): void {
  const end = performance.now();
  emit({ entryType: "longtask", name: "self", startTime: end - duration, duration });
}

/** Zasób zakończony TERAZ (wpis `resource` przychodzi po `responseEnd`). */
function resource(url: string, initiatorType = "script", duration = 40): void {
  const end = performance.now();
  emit({ entryType: "resource", name: url, initiatorType, startTime: end - duration, duration });
}

const ORIGIN = window.location.origin;
/** Zapas na zejście jednego zadania z kolejki: klatka (16 ms) + `setTimeout(0)`. */
const DRAIN_MS = 40;

let readyState: ReturnType<typeof vi.spyOn>;
let visibility: ReturnType<typeof vi.spyOn>;

function pageLoaded(): void {
  readyState.mockReturnValue("complete");
  window.dispatchEvent(new Event("load"));
}

function setVisibility(state: DocumentVisibilityState): void {
  visibility.mockReturnValue(state);
  document.dispatchEvent(new Event("visibilitychange"));
}

/** Przesuwa zegar DO chwili `at` na osi `performance.now()`. */
function advanceTo(at: number): void {
  vi.advanceTimersByTime(Math.max(0, at - performance.now()));
}

/** Navigation Timing z podanym `loadEventStart` (koniec `load` 40 ms później). */
function stubNavigation(loadEventStart: number): void {
  const navigation = {
    entryType: "navigation",
    name: ORIGIN,
    startTime: 0,
    duration: loadEventStart + 40,
    loadEventStart,
    loadEventEnd: loadEventStart + 40,
    toJSON: () => ({}),
  };
  vi.spyOn(performance, "getEntriesByType").mockReturnValue([navigation]);
}

function resetAll(): void {
  __resetQuiescenceForTests();
  __resetPostInteractionQueueForTests();
  __resetFirstInteractionForTests();
}

beforeEach(() => {
  vi.useFakeTimers({
    toFake: [
      "setTimeout",
      "clearTimeout",
      "Date",
      "performance",
      "requestAnimationFrame",
      "cancelAnimationFrame",
    ],
  });
  FakePerformanceObserver.supportedEntryTypes = ["longtask", "resource"];
  FakePerformanceObserver.active.clear();
  FakePerformanceObserver.observed.length = 0;
  vi.stubGlobal("PerformanceObserver", FakePerformanceObserver);
  readyState = vi.spyOn(document, "readyState", "get").mockReturnValue("loading");
  visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  resetAll();
});

afterEach(() => {
  resetAll();
  Reflect.deleteProperty(document, "prerendering");
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("minimum po load i okno ciszy", () => {
  it("nic przed load ani przed 5 s po load, nawet gdy wszystko milczy", () => {
    const task = vi.fn();
    onQuiescent(task, { priority: "analytics" });

    advanceTo(3_000);
    expect(task).not.toHaveBeenCalled();
    pageLoaded();
    advanceTo(3_000 + QUIESCENCE_MIN_AFTER_LOAD_MS - 1);
    expect(task).not.toHaveBeenCalled();
    expect(getQuiescence()).toBeNull();

    advanceTo(3_000 + QUIESCENCE_MIN_AFTER_LOAD_MS + DRAIN_MS);
    expect(task).toHaveBeenCalledOnce();
    expect(getQuiescence()).toEqual({ at: 3_000 + QUIESCENCE_MIN_AFTER_LOAD_MS, reason: "quiet" });
  });

  it("obserwatory startują z buffered: true (długie zadania i zasoby sprzed zapisu też się liczą)", () => {
    onQuiescent(vi.fn(), { priority: "analytics" });
    expect(FakePerformanceObserver.observed).toEqual([
      { type: "longtask", buffered: true },
      { type: "resource", buffered: true },
    ]);
  });

  it("zakończony zasób w oknie przesuwa punkt o pełne okno od swojego końca", () => {
    const task = vi.fn();
    onQuiescent(task, { priority: "analytics" });
    pageLoaded();

    advanceTo(3_000);
    resource(`${ORIGIN}/assets/chunk-abc.js`);
    advanceTo(3_000 + QUIESCENCE_WINDOW_MS - 1);
    expect(task).not.toHaveBeenCalled();
    advanceTo(3_000 + QUIESCENCE_WINDOW_MS + DRAIN_MS);
    expect(task).toHaveBeenCalledOnce();
  });

  it("długie zadanie w oknie przesuwa punkt o pełne okno od swojego końca", () => {
    const task = vi.fn();
    onQuiescent(task, { priority: "analytics" });
    pageLoaded();

    advanceTo(3_500);
    longTask(120);
    advanceTo(3_500 + QUIESCENCE_WINDOW_MS - 1);
    expect(task).not.toHaveBeenCalled();
    advanceTo(3_500 + QUIESCENCE_WINDOW_MS + DRAIN_MS);
    expect(task).toHaveBeenCalledOnce();
    expect(getQuiescence()?.reason).toBe("quiet");
  });

  it("load, który nie przychodzi, zastępuje po 10 s zapas od początku nawigacji", () => {
    const task = vi.fn();
    onQuiescent(task, { priority: "analytics" });

    advanceTo(QUIESCENCE_LOAD_DEADLINE_MS + QUIESCENCE_MIN_AFTER_LOAD_MS - 1);
    expect(task).not.toHaveBeenCalled();
    advanceTo(QUIESCENCE_LOAD_DEADLINE_MS + QUIESCENCE_MIN_AFTER_LOAD_MS + DRAIN_MS);
    expect(task).toHaveBeenCalledOnce();
  });

  it("dokument załadowany przed zapisem (późny import): minimum liczone od loadEventStart z Navigation Timing", () => {
    advanceTo(3_000);
    readyState.mockReturnValue("complete");
    stubNavigation(1_150);
    const task = vi.fn();
    onQuiescent(task, { priority: "analytics" });

    advanceTo(1_150 + QUIESCENCE_MIN_AFTER_LOAD_MS - 1);
    expect(task).not.toHaveBeenCalled();
    advanceTo(1_150 + QUIESCENCE_MIN_AFTER_LOAD_MS + DRAIN_MS);
    expect(task).toHaveBeenCalledOnce();
  });

  it("granica load = loadEventStart: obraz z wcześniejszego handlera load nie przesuwa okna", () => {
    const task = vi.fn();
    onQuiescent(task, { priority: "analytics" });
    advanceTo(1_000);
    stubNavigation(1_000);
    // Wcześniejszy handler `load` strony (np. start autoodtwarzania) trwa 40 ms
    // i uruchamia obraz, zanim nasz handler w ogóle się wykona.
    advanceTo(1_040);
    pageLoaded();
    advanceTo(4_000);
    emit({
      entryType: "resource",
      name: `${ORIGIN}/media/slide-2.webp`,
      initiatorType: "img",
      startTime: 1_010,
      duration: 2_990,
    });

    advanceTo(1_000 + QUIESCENCE_MIN_AFTER_LOAD_MS + DRAIN_MS);
    expect(task).toHaveBeenCalledOnce();
    expect(getQuiescence()).toEqual({ at: 1_000 + QUIESCENCE_MIN_AFTER_LOAD_MS, reason: "quiet" });
  });

  it("wpis jeszcze niedostarczony (takeRecords) też przesuwa okno, zanim punkt zapadnie", () => {
    const task = vi.fn();
    onQuiescent(task, { priority: "analytics" });
    pageLoaded();

    advanceTo(QUIESCENCE_MIN_AFTER_LOAD_MS - 1);
    const end = performance.now();
    emitLate({
      entryType: "resource",
      name: `${ORIGIN}/assets/late-chunk.js`,
      initiatorType: "script",
      startTime: end - 30,
      duration: 30,
    });
    advanceTo(QUIESCENCE_MIN_AFTER_LOAD_MS + DRAIN_MS);
    expect(task).not.toHaveBeenCalled();
    expect(getQuiescence()).toBeNull();
    for (const observer of FakePerformanceObserver.active) observer.deliver();
    advanceTo(end + QUIESCENCE_WINDOW_MS + DRAIN_MS);
    expect(task).toHaveBeenCalledOnce();
  });
});

describe("lista ignorowanych zasobów", () => {
  it("slajd autoodtwarzania co ~5 s po load i poll /api/public/version NIE przesuwają okna", () => {
    const task = vi.fn();
    onQuiescent(task, { priority: "analytics" });
    pageLoaded();

    advanceTo(500);
    resource(`${ORIGIN}/media/slide-2-640w.webp`, "img", 300);
    advanceTo(4_900);
    resource(`${ORIGIN}/media/slide-3-640w.webp`, "img", 300);
    resource(`${ORIGIN}/api/public/version`, "fetch", 30);

    advanceTo(QUIESCENCE_MIN_AFTER_LOAD_MS + DRAIN_MS);
    expect(task).toHaveBeenCalledOnce();
    expect(getQuiescence()).toEqual({ at: QUIESCENCE_MIN_AFTER_LOAD_MS, reason: "quiet" });
  });

  it("autoodtwarzanie przez cały czas (slajd co 4,5-5,5 s) nie spycha punktu na limit", () => {
    const task = vi.fn();
    onQuiescent(task, { priority: "analytics" });
    pageLoaded();
    for (const at of [1_000, 5_500, 10_500, 15_000]) {
      advanceTo(at);
      resource(`${ORIGIN}/media/slide-${at}.webp`, "img", 250);
    }
    expect(task).toHaveBeenCalledOnce();
    expect(getQuiescence()?.reason).toBe("quiet");
  });

  it("flock hostingu, domeny Google i zgłoszone żądania konsumentów NIE przesuwają okna", () => {
    const task = vi.fn();
    onQuiescent(task, { priority: "analytics" });
    registerOwnedRequest("https://consumer.example/owned.js");
    registerOwnedRequest(/\/beacon\/v\d+/g);
    pageLoaded();

    advanceTo(4_500);
    resource(`${ORIGIN}/~flock.js`);
    resource(`${ORIGIN}/~api/analytics`, "beacon");
    resource("https://www.googletagmanager.com/gtag/js?id=G-TEST");
    resource("https://region1.google-analytics.com/g/collect?v=2", "fetch");
    resource("https://stats.g.doubleclick.net/g/collect", "fetch");
    resource("https://www.google.pl/ads/ga-audiences", "img");
    resource("https://www.google.com/ccm/collect", "fetch");
    resource("https://consumer.example/owned.js");
    resource(`${ORIGIN}/beacon/v1`, "fetch");
    resource(`${ORIGIN}/beacon/v2`, "fetch");

    advanceTo(QUIESCENCE_MIN_AFTER_LOAD_MS + DRAIN_MS);
    expect(task).toHaveBeenCalledOnce();
  });

  it("kontrole: obraz zaczęty PRZED load, skrypt po load, obcy host podobny do Google i wycofany wzorzec - przesuwają", () => {
    const cases: Array<() => void> = [
      () => {
        // Obraz hero zaczęty przed load, kończy się 4 s po load.
        const end = performance.now();
        emit({
          entryType: "resource",
          name: `${ORIGIN}/media/hero.jpg`,
          initiatorType: "img",
          startTime: -100,
          duration: end + 100,
        });
      },
      () => resource(`${ORIGIN}/assets/route-chunk.js`),
      () => resource("https://notgoogle.com/sdk.js"),
      () => resource("https://fonts.googleapis.com/css2?family=Inter", "link"),
      () => resource(`${ORIGIN}/api/public/version-history`, "fetch"),
      () => {
        const unregister = registerOwnedRequest("/widget-feed");
        unregister();
        resource(`${ORIGIN}/widget-feed`, "fetch");
      },
    ];
    for (const emitAtFourSeconds of cases) {
      resetAll();
      readyState.mockReturnValue("loading");
      const task = vi.fn();
      onQuiescent(task, { priority: "analytics" });
      const loadedAt = performance.now();
      pageLoaded();
      advanceTo(loadedAt + 4_000);
      emitAtFourSeconds();
      advanceTo(loadedAt + QUIESCENCE_MIN_AFTER_LOAD_MS + DRAIN_MS);
      expect(task).not.toHaveBeenCalled();
      advanceTo(loadedAt + 4_000 + QUIESCENCE_WINDOW_MS + DRAIN_MS);
      expect(task).toHaveBeenCalledOnce();
    }
  });
});

describe("jeden punkt dla wszystkich konsumentów (brak kaskady)", () => {
  it("konsument, który po starcie pobiera skrypt, nie przesuwa punktu drugiemu", () => {
    const ranAt: Record<string, number> = {};
    onQuiescent(
      () => {
        ranAt.overlays = performance.now();
        // Import nakładki: zakończone żądanie chunku i długie zadanie ewaluacji.
        resource(`${ORIGIN}/assets/PopupHost-abc.js`);
        longTask(90);
      },
      { priority: "overlays" },
    );
    onQuiescent(() => (ranAt.analytics = performance.now()), { priority: "analytics" });
    pageLoaded();

    advanceTo(QUIESCENCE_MIN_AFTER_LOAD_MS + 3 * DRAIN_MS);
    expect(ranAt.overlays).toBeGreaterThanOrEqual(QUIESCENCE_MIN_AFTER_LOAD_MS);
    expect(ranAt.analytics).toBeGreaterThan(ranAt.overlays);
    expect(ranAt.analytics - QUIESCENCE_MIN_AFTER_LOAD_MS).toBeLessThan(3 * DRAIN_MS);
  });

  it("w punkcie konsumenci schodzą przez kolejkę: porządek klas, jeden na klatkę, gtag ostatni", () => {
    const runs: Array<{ name: string; at: number }> = [];
    const record = (name: string) => () => runs.push({ name, at: performance.now() });
    onQuiescent(record("analytics"), { priority: "analytics" });
    onQuiescent(record("islands"), { priority: "islands" });
    onQuiescent(record("overlays"), { priority: "overlays" });
    onQuiescent(record("shell"), { priority: "shell" });
    pageLoaded();

    advanceTo(QUIESCENCE_MIN_AFTER_LOAD_MS + 6 * DRAIN_MS);
    expect(runs.map(({ name }) => name)).toEqual(["shell", "islands", "overlays", "analytics"]);
    for (let i = 1; i < runs.length; i += 1) {
      // Kolejna klatka (rAF co 16 ms), nie to samo zadanie.
      expect(runs[i].at - runs[i - 1].at).toBeGreaterThanOrEqual(15);
    }
  });

  it("konsument zapisany po punkcie startuje od razu (zatrzask), bez nowego okna", () => {
    onQuiescent(vi.fn(), { priority: "analytics" });
    pageLoaded();
    advanceTo(QUIESCENCE_MIN_AFTER_LOAD_MS + DRAIN_MS);
    expect(getQuiescence()).not.toBeNull();

    resource(`${ORIGIN}/assets/late.js`);
    const late = vi.fn();
    onQuiescent(late, { priority: "overlays" });
    vi.advanceTimersByTime(DRAIN_MS);
    expect(late).toHaveBeenCalledOnce();
  });

  it("po punkcie obserwatory są odpięte, a nasłuch widoczności zdjęty", () => {
    const remove = vi.spyOn(document, "removeEventListener");
    onQuiescent(vi.fn(), { priority: "analytics" });
    pageLoaded();
    expect(FakePerformanceObserver.active.size).toBe(2);
    advanceTo(QUIESCENCE_MIN_AFTER_LOAD_MS + DRAIN_MS);
    expect(FakePerformanceObserver.active.size).toBe(0);
    expect(remove.mock.calls.map(([type]) => type)).toContain("visibilitychange");
  });

  it("konsument zwracający promise (import i montaż banera) trzyma następnego do rozstrzygnięcia", async () => {
    const ranAt: Record<string, number> = {};
    onQuiescent(
      () => {
        ranAt.shell = performance.now();
        return new Promise<void>((resolve) => window.setTimeout(resolve, 400));
      },
      { priority: "shell" },
    );
    onQuiescent(() => (ranAt.analytics = performance.now()), { priority: "analytics" });
    pageLoaded();

    await vi.advanceTimersByTimeAsync(QUIESCENCE_MIN_AFTER_LOAD_MS + 3 * DRAIN_MS);
    expect(ranAt.shell).toBeGreaterThanOrEqual(QUIESCENCE_MIN_AFTER_LOAD_MS);
    expect(ranAt.analytics).toBeUndefined();
    await vi.advanceTimersByTimeAsync(400);
    expect(ranAt.analytics - ranAt.shell).toBeGreaterThanOrEqual(400);
    expect(ranAt.analytics - ranAt.shell).toBeLessThan(400 + DRAIN_MS);
  });

  it("zapis wielu konsumentów to wciąż jeden detektor (jeden komplet obserwatorów)", () => {
    onQuiescent(vi.fn(), { priority: "analytics" });
    onQuiescent(vi.fn(), { priority: "overlays" });
    onQuiescent(vi.fn(), { priority: "islands" });
    expect(FakePerformanceObserver.observed).toHaveLength(2);
  });
});

describe("punkt ciszy przy wciśniętym przycisku", () => {
  function heldButton(): HTMLButtonElement {
    const button = document.createElement("button");
    document.body.append(button);
    return button;
  }

  it("punkt zapada, ale konsument czeka na koniec gestu (pointerup + click)", () => {
    const button = heldButton();
    const task = vi.fn();
    onQuiescent(task, { priority: "shell" });
    pageLoaded();

    advanceTo(QUIESCENCE_MIN_AFTER_LOAD_MS - 100);
    button.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    advanceTo(QUIESCENCE_MIN_AFTER_LOAD_MS + 150);
    expect(getQuiescence()).not.toBeNull();
    expect(task).not.toHaveBeenCalled();

    button.dispatchEvent(new Event("pointerup", { bubbles: true }));
    advanceTo(QUIESCENCE_MIN_AFTER_LOAD_MS + 180);
    expect(task).not.toHaveBeenCalled();
    button.dispatchEvent(new Event("click", { bubbles: true }));
    advanceTo(QUIESCENCE_MIN_AFTER_LOAD_MS + 180 + DRAIN_MS);
    expect(task).toHaveBeenCalledOnce();
  });

  it("przytrzymanie bez końca: konsument rusza po GESTURE_FALLBACK_MS od wciśnięcia", () => {
    const button = heldButton();
    const task = vi.fn();
    onQuiescent(task, { priority: "shell" });
    pageLoaded();

    const pressedAt = QUIESCENCE_MIN_AFTER_LOAD_MS - 100;
    advanceTo(pressedAt);
    button.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    advanceTo(pressedAt + GESTURE_FALLBACK_MS - 1);
    expect(task).not.toHaveBeenCalled();
    advanceTo(pressedAt + GESTURE_FALLBACK_MS + DRAIN_MS);
    expect(task).toHaveBeenCalledOnce();
  });

  it("po punkcie i opróżnieniu kolejki nasłuch gestów jest zdjęty", () => {
    const remove = vi.spyOn(window, "removeEventListener");
    onQuiescent(vi.fn(), { priority: "analytics" });
    pageLoaded();
    advanceTo(QUIESCENCE_MIN_AFTER_LOAD_MS + DRAIN_MS);
    expect(remove.mock.calls.map(([type]) => type)).toEqual(
      expect.arrayContaining(["pointerdown", "pointerup", "click", "keyup"]),
    );
  });
});

describe("limit i widoczność karty", () => {
  it("strona produkująca długie zadania bez końca: punkt zapada na limicie 20 s po load", () => {
    const task = vi.fn();
    onQuiescent(task, { priority: "analytics" });
    pageLoaded();
    for (let at = 1_000; at < QUIESCENCE_CAP_MS; at += 1_000) {
      advanceTo(at);
      longTask(60);
    }
    advanceTo(QUIESCENCE_CAP_MS - 1);
    expect(task).not.toHaveBeenCalled();
    advanceTo(QUIESCENCE_CAP_MS + DRAIN_MS);
    expect(task).toHaveBeenCalledOnce();
    expect(getQuiescence()).toEqual({ at: QUIESCENCE_CAP_MS, reason: "cap" });
  });

  it("limit działa także w ukrytej karcie (karta w tle też wysyła page_view), bez czekania na rAF", () => {
    visibility.mockReturnValue("hidden");
    const task = vi.fn();
    onQuiescent(task, { priority: "analytics" });
    pageLoaded();

    advanceTo(QUIESCENCE_MIN_AFTER_LOAD_MS + QUIESCENCE_WINDOW_MS);
    expect(task).not.toHaveBeenCalled();
    advanceTo(QUIESCENCE_CAP_MS - 1);
    expect(task).not.toHaveBeenCalled();
    advanceTo(QUIESCENCE_CAP_MS + 5);
    expect(task).toHaveBeenCalledOnce();
    expect(getQuiescence()?.reason).toBe("cap");
  });

  it("ukrycie karty wstrzymuje okno, a powrót do widoczności liczy je od nowa", () => {
    const task = vi.fn();
    onQuiescent(task, { priority: "analytics" });
    pageLoaded();

    advanceTo(1_000);
    setVisibility("hidden");
    advanceTo(7_000);
    expect(task).not.toHaveBeenCalled();
    setVisibility("visible");
    advanceTo(7_000 + QUIESCENCE_WINDOW_MS - 1);
    expect(task).not.toHaveBeenCalled();
    advanceTo(7_000 + QUIESCENCE_WINDOW_MS + DRAIN_MS);
    expect(task).toHaveBeenCalledOnce();
    expect(getQuiescence()?.reason).toBe("quiet");
  });
});

describe("przeglądarki bez obserwatorów", () => {
  it("Safari bez longtask: obserwujemy tylko zasoby; cisza zasobów + minimum decydują", () => {
    FakePerformanceObserver.supportedEntryTypes = ["resource", "navigation", "paint"];
    const task = vi.fn();
    onQuiescent(task, { priority: "analytics" });
    expect(FakePerformanceObserver.observed.map(({ type }) => type)).toEqual(["resource"]);
    pageLoaded();

    advanceTo(4_000);
    longTask(500); // nikt tego nie słucha
    resource(`${ORIGIN}/assets/chunk.js`);
    advanceTo(4_000 + QUIESCENCE_WINDOW_MS - 1);
    expect(task).not.toHaveBeenCalled();
    advanceTo(4_000 + QUIESCENCE_WINDOW_MS + DRAIN_MS);
    expect(task).toHaveBeenCalledOnce();
  });

  it("bez PerformanceObserver w ogóle: samo minimum po load", () => {
    vi.stubGlobal("PerformanceObserver", undefined);
    const task = vi.fn();
    onQuiescent(task, { priority: "analytics" });
    pageLoaded();
    advanceTo(QUIESCENCE_MIN_AFTER_LOAD_MS - 1);
    expect(task).not.toHaveBeenCalled();
    advanceTo(QUIESCENCE_MIN_AFTER_LOAD_MS + DRAIN_MS);
    expect(task).toHaveBeenCalledOnce();
  });

  it("obserwator rzucający przy observe (stary silnik) nie psuje detektora", () => {
    class ThrowingObserver extends FakePerformanceObserver {
      observe(): void {
        throw new TypeError("unsupported entry type");
      }
    }
    vi.stubGlobal("PerformanceObserver", ThrowingObserver);
    const task = vi.fn();
    onQuiescent(task, { priority: "analytics" });
    pageLoaded();
    advanceTo(QUIESCENCE_MIN_AFTER_LOAD_MS + DRAIN_MS);
    expect(task).toHaveBeenCalledOnce();
  });
});

describe("odwołanie, prerender, SSR", () => {
  it("odwołany przed punktem nie biegnie; odwołany po punkcie, przed swoją klatką - też nie", () => {
    const before = vi.fn();
    const after = vi.fn();
    const cancelBefore = onQuiescent(before, { priority: "overlays" });
    const cancelAfter = onQuiescent(after, { priority: "analytics" });
    pageLoaded();
    cancelBefore();

    advanceTo(QUIESCENCE_MIN_AFTER_LOAD_MS);
    expect(getQuiescence()).not.toBeNull();
    cancelAfter();
    advanceTo(QUIESCENCE_MIN_AFTER_LOAD_MS + 4 * DRAIN_MS);
    expect(before).not.toHaveBeenCalled();
    expect(after).not.toHaveBeenCalled();
  });

  it("strona prerenderowana nie liczy niczego przed aktywacją, także limitu", () => {
    let prerendering = true;
    Object.defineProperty(document, "prerendering", {
      configurable: true,
      get: () => prerendering,
    });
    const task = vi.fn();
    onQuiescent(task, { priority: "analytics" });
    pageLoaded();

    advanceTo(QUIESCENCE_CAP_MS + 10_000);
    expect(task).not.toHaveBeenCalled();
    expect(FakePerformanceObserver.observed).toHaveLength(0);

    prerendering = false;
    document.dispatchEvent(new Event("prerenderingchange"));
    const activatedAt = performance.now();
    advanceTo(activatedAt + QUIESCENCE_MIN_AFTER_LOAD_MS - 1);
    expect(task).not.toHaveBeenCalled();
    advanceTo(activatedAt + QUIESCENCE_MIN_AFTER_LOAD_MS + DRAIN_MS);
    expect(task).toHaveBeenCalledOnce();
  });

  it("na serwerze (brak window) onQuiescent i registerOwnedRequest są no-opem", () => {
    vi.stubGlobal("window", undefined);
    const task = vi.fn();
    const cancel = onQuiescent(task, { priority: "analytics" });
    const unregister = registerOwnedRequest("/x");
    expect(() => cancel()).not.toThrow();
    expect(() => unregister()).not.toThrow();
    expect(getQuiescence()).toBeNull();
    expect(FakePerformanceObserver.observed).toHaveLength(0);
  });
});
