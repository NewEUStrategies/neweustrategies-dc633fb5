// Polityka dociągania gtag.js: pierwsza interakcja / decyzja o zgodzie /
// bezczynność po load bez długich zadań, z twardym limitem. Fałszywe zegary
// (razem z `performance.now`), symulowane interakcje i długie zadania.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  LOAD_CAP_MS,
  LOAD_DEADLINE_MS,
  LONG_TASK_QUIET_MS,
  QUIET_AFTER_LOAD_MS,
  scheduleGtagLoad,
} from "../gtagLoadPolicy";

/** Atrapa `PerformanceObserver` sterowana z testu: `longTask(start, duration)`. */
const observers = vi.hoisted(() => ({
  callbacks: [] as Array<(list: { getEntries: () => unknown[] }) => void>,
  observe: vi.fn(),
  disconnect: vi.fn(),
}));

class FakePerformanceObserver {
  constructor(cb: (list: { getEntries: () => unknown[] }) => void) {
    observers.callbacks.push(cb);
  }
  observe = observers.observe;
  disconnect = observers.disconnect;
}

function longTask(duration: number, startTime = performance.now() - duration): void {
  for (const cb of observers.callbacks) cb({ getEntries: () => [{ startTime, duration }] });
}

function interaction(type = "pointerdown"): void {
  window.dispatchEvent(new Event(type));
}

let readyState: ReturnType<typeof vi.spyOn>;

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
  observers.callbacks.length = 0;
  observers.observe.mockReset();
  observers.disconnect.mockReset();
  vi.stubGlobal("PerformanceObserver", FakePerformanceObserver);
  readyState = vi.spyOn(document, "readyState", "get").mockReturnValue("loading");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

function pageLoaded(): void {
  readyState.mockReturnValue("complete");
  window.dispatchEvent(new Event("load"));
}

describe("sygnał (a): pierwsza interakcja", () => {
  it.each(["pointerdown", "keydown", "touchstart", "scroll"])(
    "%s dociąga skrypt po obsłudze zdarzenia i po następnej klatce, nie w jego handlerze",
    (type) => {
      const load = vi.fn();
      scheduleGtagLoad(load);

      interaction(type);
      // W tym samym zadaniu co interakcja - NIC (INP tej interakcji nie rośnie).
      expect(load).not.toHaveBeenCalled();
      // Klatka + makrozadanie wystarczą.
      vi.advanceTimersByTime(50);
      expect(load).toHaveBeenCalledOnce();
    },
  );

  it("nasłuch jest pasywny i w fazie capture (handler zatrzymujący propagację nie ukryje interakcji)", () => {
    const spy = vi.spyOn(window, "addEventListener");
    scheduleGtagLoad(vi.fn());
    const interactionCalls = spy.mock.calls.filter(([type]) =>
      ["pointerdown", "keydown", "touchstart", "scroll"].includes(type),
    );
    expect(interactionCalls).toHaveLength(4);
    for (const [, , options] of interactionCalls) {
      expect(options).toMatchObject({ passive: true, capture: true });
    }
  });

  it("ładuje najwyżej raz, nawet przy serii interakcji, i zdejmuje nasłuchy", () => {
    const load = vi.fn();
    const remove = vi.spyOn(window, "removeEventListener");
    scheduleGtagLoad(load);

    interaction("pointerdown");
    interaction("scroll");
    interaction("keydown");
    vi.advanceTimersByTime(50);
    interaction("pointerdown");
    vi.advanceTimersByTime(50);

    expect(load).toHaveBeenCalledOnce();
    expect(remove.mock.calls.map(([type]) => type)).toEqual(
      expect.arrayContaining(["pointerdown", "keydown", "touchstart", "scroll"]),
    );
    expect(observers.disconnect).toHaveBeenCalled();
  });

  it("w karcie w tle (brak klatek) interakcja i tak dociąga skrypt najpóźniej po sekundzie", () => {
    vi.spyOn(window, "requestAnimationFrame").mockImplementation(() => 1);
    const load = vi.fn();
    scheduleGtagLoad(load);
    interaction();
    vi.advanceTimersByTime(999);
    expect(load).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(load).toHaveBeenCalledOnce();
  });
});

describe("sygnał (b): jawna decyzja o zgodzie", () => {
  it("decyzja dociąga skrypt po klatce i odpina subskrypcję", () => {
    const load = vi.fn();
    const unsubscribe = vi.fn();
    let fire: (() => void) | null = null;
    scheduleGtagLoad(load, {
      onDecision: (f) => {
        fire = f;
        return unsubscribe;
      },
    });

    expect(fire).toBeTypeOf("function");
    (fire as unknown as () => void)();
    expect(load).not.toHaveBeenCalled();
    vi.advanceTimersByTime(50);
    expect(load).toHaveBeenCalledOnce();
    expect(unsubscribe).toHaveBeenCalledOnce();
  });

  it("decyzja po wcześniejszym dociągnięciu (interakcja) jest no-opem", () => {
    const load = vi.fn();
    let fire: (() => void) | null = null;
    scheduleGtagLoad(load, {
      onDecision: (f) => {
        fire = f;
        return () => {};
      },
    });
    interaction();
    vi.advanceTimersByTime(50);
    (fire as unknown as () => void)();
    vi.advanceTimersByTime(50);
    expect(load).toHaveBeenCalledOnce();
  });
});

describe("sygnał (c): bezczynność po load", () => {
  it("bez interakcji i bez długich zadań ładuje po QUIET_AFTER_LOAD_MS od load - nie wcześniej", () => {
    const load = vi.fn();
    scheduleGtagLoad(load);

    // Przed `load` czas nie biegnie dla polityki (dokument wciąż się ładuje).
    vi.advanceTimersByTime(5_000);
    expect(load).not.toHaveBeenCalled();

    pageLoaded();
    vi.advanceTimersByTime(QUIET_AFTER_LOAD_MS - 1);
    expect(load).not.toHaveBeenCalled();
    // Bez `requestIdleCallback` (happy-dom) pętla degraduje do `setTimeout(cisza)`.
    vi.advanceTimersByTime(1 + LONG_TASK_QUIET_MS);
    expect(load).toHaveBeenCalledOnce();
  });

  it("zaczyna od razu, gdy dokument był już załadowany przy planowaniu", () => {
    readyState.mockReturnValue("complete");
    const load = vi.fn();
    scheduleGtagLoad(load);
    vi.advanceTimersByTime(QUIET_AFTER_LOAD_MS + LONG_TASK_QUIET_MS);
    expect(load).toHaveBeenCalledOnce();
  });

  it("z `requestIdleCallback` ładuje w pierwszej bezczynności po progu, jeśli główny wątek był cicho", () => {
    const idle: Array<() => void> = [];
    vi.stubGlobal("requestIdleCallback", (cb: () => void) => {
      idle.push(cb);
      return idle.length;
    });
    vi.stubGlobal("cancelIdleCallback", vi.fn());
    const load = vi.fn();
    scheduleGtagLoad(load);
    pageLoaded();

    vi.advanceTimersByTime(QUIET_AFTER_LOAD_MS);
    expect(idle).toHaveLength(1);
    expect(load).not.toHaveBeenCalled();
    idle[0]();
    expect(load).toHaveBeenCalledOnce();
  });

  it("długie zadanie w ostatnich LONG_TASK_QUIET_MS odracza załadowanie do końca ciszy", () => {
    const load = vi.fn();
    scheduleGtagLoad(load);
    pageLoaded();
    expect(observers.observe).toHaveBeenCalledWith(
      expect.objectContaining({ type: "longtask", buffered: true }),
    );

    // Długie zadanie kończy się 2 900 ms po load - 600 ms przed pierwszym sprawdzeniem (3 500 ms).
    vi.advanceTimersByTime(2_900);
    longTask(300);
    vi.advanceTimersByTime(600);
    // 3 500 ms: cisza trwa dopiero 600 ms - za mało.
    expect(load).not.toHaveBeenCalled();
    vi.advanceTimersByTime(LONG_TASK_QUIET_MS - 600 - 1);
    expect(load).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(load).toHaveBeenCalledOnce();
  });

  it("ciągłe długie zadania nie mogą odraczać w nieskończoność: twardy limit LOAD_CAP_MS po load", () => {
    const load = vi.fn();
    scheduleGtagLoad(load);
    pageLoaded();

    // Co 500 ms jedno długie zadanie - cisza nigdy nie sięga 1 500 ms.
    for (let t = 500; t < LOAD_CAP_MS; t += 500) {
      vi.advanceTimersByTime(500);
      longTask(200);
      expect(load).not.toHaveBeenCalled();
    }
    vi.advanceTimersByTime(600);
    expect(load).toHaveBeenCalledOnce();
  });

  it("wiszący zasób (brak `load`) nie blokuje polityki dłużej niż LOAD_DEADLINE_MS", () => {
    const load = vi.fn();
    scheduleGtagLoad(load);
    vi.advanceTimersByTime(LOAD_DEADLINE_MS + QUIET_AFTER_LOAD_MS + LONG_TASK_QUIET_MS - 1);
    expect(load).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(load).toHaveBeenCalledOnce();
  });

  it("bez `PerformanceObserver` (Safari) decyduje sama bezczynność i próg po load", () => {
    vi.stubGlobal("PerformanceObserver", undefined);
    const load = vi.fn();
    scheduleGtagLoad(load);
    pageLoaded();
    vi.advanceTimersByTime(QUIET_AFTER_LOAD_MS + LONG_TASK_QUIET_MS);
    expect(load).toHaveBeenCalledOnce();
  });

  it("`observe` rzucające na nieznanym typie wpisu nie wywraca polityki", () => {
    observers.observe.mockImplementation(() => {
      throw new TypeError("longtask not supported");
    });
    const load = vi.fn();
    scheduleGtagLoad(load);
    pageLoaded();
    vi.advanceTimersByTime(QUIET_AFTER_LOAD_MS + LONG_TASK_QUIET_MS);
    expect(load).toHaveBeenCalledOnce();
  });
});

describe("odwołanie", () => {
  it("cleanup odpina wszystko: ani interakcja, ani load, ani decyzja nie dociągną skryptu", () => {
    const load = vi.fn();
    const unsubscribe = vi.fn();
    let fire: (() => void) | null = null;
    const cancel = scheduleGtagLoad(load, {
      onDecision: (f) => {
        fire = f;
        return unsubscribe;
      },
    });
    interaction();
    cancel();
    (fire as unknown as () => void)();
    pageLoaded();
    vi.advanceTimersByTime(LOAD_DEADLINE_MS + LOAD_CAP_MS);
    expect(load).not.toHaveBeenCalled();
    expect(unsubscribe).toHaveBeenCalledOnce();
    expect(observers.disconnect).toHaveBeenCalledOnce();
  });

  it("na serwerze jest no-opem", () => {
    const original = globalThis.window;
    vi.stubGlobal("window", undefined);
    try {
      expect(scheduleGtagLoad(vi.fn())).toBeTypeOf("function");
    } finally {
      vi.stubGlobal("window", original);
    }
  });
});
