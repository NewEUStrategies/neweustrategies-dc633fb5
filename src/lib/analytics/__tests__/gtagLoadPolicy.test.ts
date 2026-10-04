// Polityka dociągania gtag.js v2 (P1.1) na PRAWDZIWYCH prymitywach P0.3:
// (a) pierwsza interakcja przez kolejkę po interakcji (gtag ostatni, po końcu
// gestu i po klatce), (b) jawna decyzja o zgodzie (`release: "immediate"`),
// (c) globalny punkt ciszy strony (min. 5 s po load, okno 5 s, limit 20 s,
// 10 s bez load). Kontrole negatywne: programowy `scroll` ELEMENTU
// (autoodtwarzana karuzela) i zdarzenia niezaufane NIE są interakcją.
// Fałszywe zegary (z `performance.now` i rAF co 16 ms) i atrapa
// `PerformanceObserver` z rozdziałem typu wpisu (werdykt TP-1, pkt 4).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { __resetFirstInteractionForTests } from "@/lib/performance/firstInteraction";
import {
  GESTURE_FALLBACK_MS,
  QUEUE_PRIORITIES,
  __resetPostInteractionQueueForTests,
  enqueue,
  type QueuePriority,
} from "@/lib/performance/postInteractionQueue";
import {
  QUIESCENCE_CAP_MS,
  QUIESCENCE_LOAD_DEADLINE_MS,
  QUIESCENCE_MIN_AFTER_LOAD_MS,
  QUIESCENCE_WINDOW_MS,
  __resetQuiescenceForTests,
  getQuiescence,
  onQuiescent,
  registerOwnedRequest,
} from "@/lib/performance/whenQuiescent";

import { GTAG_OWNED_REQUESTS, GTAG_QUEUE_PRIORITY, scheduleGtagLoad } from "../gtagLoadPolicy";

// `registerOwnedRequest` opakowany szpiegiem (reszta modułu - prawdziwa, ten
// sam stan): detektor ignoruje hosty Google sam z siebie, więc zgłoszenie
// własnych URL-i gtag (kontrakt P0.3) widać tylko na wywołaniu.
vi.mock("@/lib/performance/whenQuiescent", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/performance/whenQuiescent")>();
  return { ...actual, registerOwnedRequest: vi.fn(actual.registerOwnedRequest) };
});

interface FakeEntry {
  readonly entryType: string;
  readonly name: string;
  readonly startTime: number;
  readonly duration: number;
  readonly initiatorType?: string;
}

/** Atrapa `PerformanceObserver`: wpis trafia WYŁĄCZNIE do obserwatorów swojego typu. */
class FakePerformanceObserver {
  static supportedEntryTypes = ["longtask", "resource"];
  static readonly active = new Set<FakePerformanceObserver>();
  static readonly observed: Array<{ type: string; buffered?: boolean }> = [];
  type: string | null = null;

  constructor(readonly callback: (list: { getEntries: () => FakeEntry[] }) => void) {}

  observe(init: { type: string; buffered?: boolean }): void {
    this.type = init.type;
    FakePerformanceObserver.observed.push(init);
    FakePerformanceObserver.active.add(this);
  }

  takeRecords(): FakeEntry[] {
    return [];
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

/** Długie zadanie kończące się TERAZ. */
function longTask(duration = 80): void {
  const end = performance.now();
  emit({ entryType: "longtask", name: "self", startTime: end - duration, duration });
}

/** Zasób zakończony TERAZ. */
function resource(url: string, initiatorType = "script", duration = 40): void {
  const end = performance.now();
  emit({ entryType: "resource", name: url, initiatorType, startTime: end - duration, duration });
}

const ORIGIN = window.location.origin;
/** Zapas na zejście jednego zadania z kolejki: klatka (16 ms) + `setTimeout(0)`. */
const DRAIN_MS = 40;
/** Chwila `load` w testach sygnału (c). */
const LOAD_AT = 3_000;

let readyState: ReturnType<typeof vi.spyOn>;
let visibility: ReturnType<typeof vi.spyOn>;

function pageLoaded(): void {
  readyState.mockReturnValue("complete");
  window.dispatchEvent(new Event("load"));
}

/** Przesuwa zegar DO chwili `at` na osi `performance.now()`. */
function advanceTo(at: number): void {
  vi.advanceTimersByTime(Math.max(0, at - performance.now()));
}

function dispatch(target: EventTarget, type: string, trusted = true): void {
  const event = new Event(type, { bubbles: true });
  // happy-dom nie ma `isTrusted` (filtr P0.3 odrzuca tylko jawne `false`).
  if (!trusted) Object.defineProperty(event, "isTrusted", { value: false });
  target.dispatchEvent(event);
}

/** Pełne dotknięcie: `pointerdown` -> `pointerup` -> `click`. */
function tap(target: EventTarget = window): void {
  dispatch(target, "pointerdown");
  dispatch(target, "pointerup");
  dispatch(target, "click");
}

async function flushMicrotasks(): Promise<void> {
  for (let i = 0; i < 10; i += 1) await Promise.resolve();
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve: () => void = () => {};
  const promise = new Promise<void>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

/** Subskrypcja decyzji sterowana z testu (jak `onConsentDecision` w `ConsentScriptInjector`). */
function decisionSource(): {
  onDecision: (fire: () => void) => () => void;
  decide: () => void;
  unsubscribe: ReturnType<typeof vi.fn>;
} {
  const listeners = new Set<() => void>();
  const unsubscribe = vi.fn();
  return {
    onDecision: (fire) => {
      listeners.add(fire);
      return () => {
        unsubscribe();
        listeners.delete(fire);
      };
    },
    decide: () => {
      for (const listener of [...listeners]) listener();
    },
    unsubscribe,
  };
}

function resetPrimitives(): void {
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
  FakePerformanceObserver.active.clear();
  FakePerformanceObserver.observed.length = 0;
  vi.stubGlobal("PerformanceObserver", FakePerformanceObserver);
  // Bez Scheduler API krok kolejki schodzi przez `setTimeout(0)`.
  vi.stubGlobal("scheduler", undefined);
  readyState = vi.spyOn(document, "readyState", "get").mockReturnValue("loading");
  visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  vi.mocked(registerOwnedRequest).mockClear();
  resetPrimitives();
});

afterEach(() => {
  resetPrimitives();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
  document.body.innerHTML = "";
});

describe("sygnał (a): pierwsza interakcja przez kolejkę P0.3", () => {
  it("pointerdown -> pointerup -> click: gtag po klatce za `click`, nigdy w handlerze zdarzenia", () => {
    const load = vi.fn();
    scheduleGtagLoad(load);

    dispatch(window, "pointerdown");
    dispatch(window, "pointerup");
    // W trakcie gestu (przed `click`) - nic, nawet po klatkach.
    vi.advanceTimersByTime(100);
    expect(load).not.toHaveBeenCalled();

    dispatch(window, "click");
    // W tym samym zadaniu co interakcja - NIC (INP tej interakcji nie rośnie).
    expect(load).not.toHaveBeenCalled();
    vi.advanceTimersByTime(DRAIN_MS);
    expect(load).toHaveBeenCalledOnce();
  });

  it.each(["pointerdown", "keydown", "touchstart"])(
    "samo %s (bez puszczenia) ładuje gtag po zapasie strażnika gestu i klatce, w ≤ 1 s",
    (type) => {
      const load = vi.fn();
      scheduleGtagLoad(load);

      dispatch(window, type);
      vi.advanceTimersByTime(GESTURE_FALLBACK_MS - 1);
      expect(load).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1 + DRAIN_MS);
      expect(load).toHaveBeenCalledOnce();
      expect(performance.now()).toBeLessThanOrEqual(1_000);
    },
  );

  it("kółko myszy i przewinięcie DOKUMENTU zwalniają kolejkę bez wstrzymania gestem", () => {
    for (const [target, type] of [
      [window, "wheel"],
      [document, "scroll"],
    ] as const) {
      resetPrimitives();
      const load = vi.fn();
      scheduleGtagLoad(load);
      dispatch(target, type);
      expect(load).not.toHaveBeenCalled();
      vi.advanceTimersByTime(DRAIN_MS);
      expect(load).toHaveBeenCalledOnce();
    }
  });

  it("KONTROLA NEGATYWNA: programowy `scroll` ELEMENTU (autoodtwarzana karuzela) NIE jest interakcją", () => {
    // Dawny nasłuch tego modułu (`scroll` na `window` w fazie capture) łapał
    // `scroll` toru slajdów `PostListView` (`el.scrollTo` co ~5 s) i ładował gtag
    // bez udziału odwiedzającego - także w śladzie Lighthouse'a.
    const track = document.createElement("div");
    document.body.append(track);
    const load = vi.fn();
    scheduleGtagLoad(load);

    // Dokument wciąż się ładuje: punkt ciszy nie zapadnie przed 10 s + 5 s.
    for (let t = 0; t < 9_000; t += 4_500) {
      vi.advanceTimersByTime(4_500);
      dispatch(track, "scroll");
    }
    vi.advanceTimersByTime(500);
    expect(load).not.toHaveBeenCalled();

    // Kontrola pozytywna tego samego układu: przewinięcie dokumentu - tak.
    dispatch(document, "scroll");
    vi.advanceTimersByTime(DRAIN_MS);
    expect(load).toHaveBeenCalledOnce();
  });

  it("KONTROLA NEGATYWNA: zdarzenia niezaufane (`dispatchEvent` obcego skryptu) NIE są interakcją", () => {
    const load = vi.fn();
    scheduleGtagLoad(load);

    for (const type of ["pointerdown", "keydown", "touchstart", "wheel"]) {
      dispatch(window, type, false);
    }
    dispatch(document, "scroll", false);
    vi.advanceTimersByTime(9_000);
    expect(load).not.toHaveBeenCalled();

    dispatch(window, "wheel");
    vi.advanceTimersByTime(DRAIN_MS);
    expect(load).toHaveBeenCalledOnce();
  });

  it("gtag schodzi OSTATNI: po powłoce, wyspie pod palcem, nagłówku, wyspach i nakładkach, jedno zadanie na klatkę", () => {
    const order: string[] = [];
    // gtag zapisany PIERWSZY - kolejność wyznacza klasa, nie chwila zapisu.
    scheduleGtagLoad(() => {
      order.push("gtag");
    });
    // Wszystkie pozostałe klasy (także druga `analytics` byłaby za gtag).
    const others = QUEUE_PRIORITIES.filter((priority) => priority !== "analytics");
    for (const priority of [...others].reverse()) {
      enqueue(() => order.push(priority), { priority });
    }

    tap();
    expect(order).toEqual([]);
    vi.advanceTimersByTime(DRAIN_MS - 16);
    expect(order).toEqual(["shell"]);
    vi.advanceTimersByTime(QUEUE_PRIORITIES.length * DRAIN_MS);
    expect(order).toEqual([...others, "gtag"]);
  });

  it("promise gtag.js trzyma kolejkę do `load`/`error` skryptu (KONTRAKT ZADANIA P0.3)", async () => {
    const script = deferred();
    const load = vi.fn(() => script.promise);
    const after = vi.fn();
    scheduleGtagLoad(load);
    // Ta sama klasa, zapisana później: rusza dopiero po rozstrzygnięciu gtag.
    enqueue(after, { priority: "analytics" });

    tap();
    vi.advanceTimersByTime(DRAIN_MS);
    expect(load).toHaveBeenCalledOnce();
    vi.advanceTimersByTime(1_000);
    expect(after).not.toHaveBeenCalled();

    script.resolve();
    await flushMicrotasks();
    vi.advanceTimersByTime(DRAIN_MS);
    expect(after).toHaveBeenCalledOnce();
  });
});

describe("sygnał (b): jawna decyzja o zgodzie", () => {
  it("decyzja ładuje gtag bez interakcji, po klatce, i odpina subskrypcję", () => {
    const load = vi.fn();
    const source = decisionSource();
    scheduleGtagLoad(load, { onDecision: source.onDecision });

    source.decide();
    expect(load).not.toHaveBeenCalled();
    vi.advanceTimersByTime(DRAIN_MS);
    expect(load).toHaveBeenCalledOnce();
    expect(source.unsubscribe).toHaveBeenCalledOnce();
  });

  it("seria decyzji i decyzja po wcześniejszym załadowaniu nie ładują drugi raz", () => {
    const load = vi.fn();
    const source = decisionSource();
    scheduleGtagLoad(load, { onDecision: source.onDecision });

    source.decide();
    source.decide();
    tap();
    vi.advanceTimersByTime(10 * DRAIN_MS);
    source.decide();
    vi.advanceTimersByTime(10 * DRAIN_MS);
    expect(load).toHaveBeenCalledOnce();
  });
});

describe("sygnał (c): globalny punkt ciszy P0.3", () => {
  it("bez interakcji i decyzji: nic przed load ani przed 5 s po load; gtag w punkcie ciszy", () => {
    const load = vi.fn();
    scheduleGtagLoad(load);

    advanceTo(LOAD_AT);
    expect(load).not.toHaveBeenCalled();
    pageLoaded();
    advanceTo(LOAD_AT + QUIESCENCE_MIN_AFTER_LOAD_MS - 1);
    expect(load).not.toHaveBeenCalled();

    advanceTo(LOAD_AT + QUIESCENCE_MIN_AFTER_LOAD_MS + DRAIN_MS);
    expect(load).toHaveBeenCalledOnce();
    expect(getQuiescence()).toEqual({
      at: LOAD_AT + QUIESCENCE_MIN_AFTER_LOAD_MS,
      reason: "quiet",
    });
  });

  it("liczony zasób przesuwa punkt o pełne okno; żądania tagu Google - nie", () => {
    const load = vi.fn();
    scheduleGtagLoad(load);
    advanceTo(LOAD_AT);
    pageLoaded();

    advanceTo(LOAD_AT + 3_000);
    resource(`${ORIGIN}/assets/chunk-abc.js`);
    advanceTo(LOAD_AT + 6_000);
    resource("https://www.googletagmanager.com/gtag/js?id=G-TEST123");
    resource("https://region1.google-analytics.com/g/collect?v=2&en=page_view", "fetch");

    advanceTo(LOAD_AT + 3_000 + QUIESCENCE_WINDOW_MS - 1);
    expect(load).not.toHaveBeenCalled();
    advanceTo(LOAD_AT + 3_000 + QUIESCENCE_WINDOW_MS + DRAIN_MS);
    expect(load).toHaveBeenCalledOnce();
  });

  it("ciągłe długie zadania nie odraczają w nieskończoność: limit 20 s po load", () => {
    const load = vi.fn();
    scheduleGtagLoad(load);
    advanceTo(LOAD_AT);
    pageLoaded();

    for (let t = LOAD_AT + 1_000; t < LOAD_AT + QUIESCENCE_CAP_MS; t += 1_000) {
      advanceTo(t);
      longTask();
      expect(load).not.toHaveBeenCalled();
    }
    advanceTo(LOAD_AT + QUIESCENCE_CAP_MS + DRAIN_MS);
    expect(load).toHaveBeenCalledOnce();
    expect(getQuiescence()?.reason).toBe("cap");
  });

  it("karta w tle: limit działa także w ukrytej karcie (karta zamknięta bez oglądania też wysyła `page_view`)", () => {
    visibility.mockReturnValue("hidden");
    const load = vi.fn();
    scheduleGtagLoad(load);
    advanceTo(LOAD_AT);
    pageLoaded();

    advanceTo(LOAD_AT + QUIESCENCE_CAP_MS - 1);
    expect(load).not.toHaveBeenCalled();
    advanceTo(LOAD_AT + QUIESCENCE_CAP_MS + DRAIN_MS);
    expect(load).toHaveBeenCalledOnce();
  });

  it("wiszący zasób (brak `load`): punkt najwcześniej 10 s od nawigacji + 5 s", () => {
    const load = vi.fn();
    scheduleGtagLoad(load);

    advanceTo(QUIESCENCE_LOAD_DEADLINE_MS + QUIESCENCE_MIN_AFTER_LOAD_MS - 1);
    expect(load).not.toHaveBeenCalled();
    advanceTo(QUIESCENCE_LOAD_DEADLINE_MS + QUIESCENCE_MIN_AFTER_LOAD_MS + DRAIN_MS);
    expect(load).toHaveBeenCalledOnce();
  });

  it("obserwatory z rozdziałem typów (`longtask`, `resource`, buffered); po punkcie oba odpięte", () => {
    scheduleGtagLoad(vi.fn());
    expect(FakePerformanceObserver.observed).toEqual([
      { type: "longtask", buffered: true },
      { type: "resource", buffered: true },
    ]);
    expect(FakePerformanceObserver.active.size).toBe(2);

    advanceTo(LOAD_AT);
    pageLoaded();
    advanceTo(LOAD_AT + QUIESCENCE_MIN_AFTER_LOAD_MS + DRAIN_MS);
    expect(FakePerformanceObserver.active.size).toBe(0);
  });

  it("w punkcie ciszy gtag schodzi po innych konsumentach punktu, choć zapisał się pierwszy", () => {
    const order: string[] = [];
    scheduleGtagLoad(() => {
      order.push("gtag");
    });
    onQuiescent(() => order.push("overlays"), { priority: "overlays" });
    onQuiescent(() => order.push("islands"), { priority: "islands" });
    advanceTo(LOAD_AT);
    pageLoaded();

    advanceTo(LOAD_AT + QUIESCENCE_MIN_AFTER_LOAD_MS + 4 * DRAIN_MS);
    expect(order).toEqual(["islands", "overlays", "gtag"]);
  });
});

describe("idempotencja, własne żądania i odwołanie", () => {
  it("zbieg wszystkich sygnałów (interakcja, decyzja, punkt ciszy) ładuje gtag dokładnie raz", () => {
    const load = vi.fn();
    const source = decisionSource();
    scheduleGtagLoad(load, { onDecision: source.onDecision });
    advanceTo(LOAD_AT);
    pageLoaded();

    tap();
    source.decide();
    advanceTo(LOAD_AT + QUIESCENCE_CAP_MS + 10 * DRAIN_MS);
    expect(load).toHaveBeenCalledOnce();
  });

  it("własne URL-e gtag zgłoszone detektorowi przy planowaniu i zostają po załadowaniu", () => {
    const load = vi.fn();
    const cancel = scheduleGtagLoad(load);
    expect(registerOwnedRequest).toHaveBeenCalledOnce();
    expect(registerOwnedRequest).toHaveBeenCalledWith(GTAG_OWNED_REQUESTS);
    const withdraw = vi.mocked(registerOwnedRequest).mock.results[0];
    expect(withdraw?.type).toBe("return");

    tap();
    vi.advanceTimersByTime(DRAIN_MS);
    expect(load).toHaveBeenCalledOnce();
    // Pingi gtag biegną dalej po załadowaniu - zgłoszenie zostaje.
    const before = vi.mocked(registerOwnedRequest).mock.calls.length;
    cancel();
    expect(vi.mocked(registerOwnedRequest).mock.calls.length).toBe(before);
  });

  it.each([
    ["https://www.googletagmanager.com/gtag/js?id=G-TEST123", true],
    ["https://www.googletagmanager.com/gtag/js?id=AW-123456789&cx=c", true],
    ["https://region1.google-analytics.com/g/collect?v=2", true],
    ["https://region1.analytics.google.com/g/collect?v=2", true],
    ["https://stats.g.doubleclick.net/g/collect?v=2", true],
    ["https://pagead2.googlesyndication.com/ccm/collect?tid=AW-1", true],
    ["https://www.googleadservices.com/pagead/conversion/1/", true],
    ["https://www.google.com/pagead/1p-user-list/1/", true],
    ["https://www.google.pl/ads/ga-audiences?v=1", true],
    ["https://www.google.com/search?q=gtag", false],
    ["https://fonts.googleapis.com/css2?family=Inter", false],
    ["https://www.googletagmanager.com.evil.io/gtag/js", false],
    ["https://evil-googletagmanager.com/gtag/js", false],
    ["https://example.com/?next=https://www.googletagmanager.com/", false],
  ])("wzorzec własnych żądań: %s -> %s", (url, owned) => {
    expect(GTAG_OWNED_REQUESTS.test(url)).toBe(owned);
  });

  it("cleanup odwołuje wszystko: ani interakcja, ani decyzja, ani punkt ciszy nie ładują; zgłoszenie wycofane", () => {
    const load = vi.fn();
    const source = decisionSource();
    const withdrawn = vi.fn();
    vi.mocked(registerOwnedRequest).mockImplementationOnce(() => withdrawn);
    const cancel = scheduleGtagLoad(load, { onDecision: source.onDecision });

    cancel();
    expect(source.unsubscribe).toHaveBeenCalledOnce();
    expect(withdrawn).toHaveBeenCalledOnce();

    tap();
    source.decide();
    advanceTo(LOAD_AT);
    pageLoaded();
    advanceTo(LOAD_AT + QUIESCENCE_CAP_MS + 10 * DRAIN_MS);
    expect(load).not.toHaveBeenCalled();
  });

  it("cleanup po interakcji, a przed zejściem z kolejki, też odwołuje wpis", () => {
    const load = vi.fn();
    const cancel = scheduleGtagLoad(load);
    dispatch(window, "wheel");
    cancel();
    vi.advanceTimersByTime(10 * DRAIN_MS);
    expect(load).not.toHaveBeenCalled();
  });

  it("klasa gtag w kolejce to `analytics` - ostatnia z `QUEUE_PRIORITIES`", () => {
    const priority: QueuePriority = GTAG_QUEUE_PRIORITY;
    expect(QUEUE_PRIORITIES.at(-1)).toBe(priority);
  });

  it("na serwerze jest no-opem", () => {
    const original = globalThis.window;
    vi.stubGlobal("window", undefined);
    try {
      expect(scheduleGtagLoad(vi.fn())).toBeTypeOf("function");
      expect(registerOwnedRequest).not.toHaveBeenCalled();
    } finally {
      vi.stubGlobal("window", original);
    }
  });
});
