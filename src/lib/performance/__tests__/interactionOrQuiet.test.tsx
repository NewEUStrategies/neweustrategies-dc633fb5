// Zatrzask „pierwsza interakcja ALBO punkt ciszy" (P3.5): zamknięty, dopóki nic
// się nie stało; otwiera go pierwsza interakcja (prawdziwa kolejka P0.3 - po
// końcu gestu i po klatce) albo punkt ciszy (detektor podmieniony atrapą, która
// zbiera zapisy); jeden na dokument; nigdy w prerenderze ani na serwerze; hook
// daje `false` na serwerze i w renderze hydratacji, a komponent zamontowany po
// otwarciu - `true` od razu.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { createRoot, hydrateRoot, type Root } from "react-dom/client";

import { __resetFirstInteractionForTests } from "../firstInteraction";
import { __resetPostInteractionQueueForTests } from "../postInteractionQueue";

const quiet = vi.hoisted(() => ({
  entries: [] as Array<{ task: () => unknown; priority: string }>,
}));

vi.mock("../whenQuiescent", () => ({
  onQuiescent: (task: () => unknown, options: { priority: string }) => {
    const entry = { task, priority: options.priority };
    quiet.entries.push(entry);
    return () => {
      quiet.entries = quiet.entries.filter((candidate) => candidate !== entry);
    };
  },
}));

const {
  __openInteractionOrQuietForTests,
  __resetInteractionOrQuietForTests,
  isInteractionOrQuietOpen,
  onInteractionOrQuiet,
  useInteractionOrQuiet,
} = await import("../interactionOrQuiet");

let frames: FrameRequestCallback[] = [];

/** Jedna klatka kolejki: callbacki rAF, potem makrozadanie kroku. */
function frame(): void {
  const pending = frames;
  frames = [];
  for (const callback of pending) callback(performance.now());
  vi.advanceTimersByTime(0);
}

/** Pełne dotknięcie: `pointerdown` -> `pointerup` -> `click` (koniec gestu). */
function tap(): void {
  for (const type of ["pointerdown", "pointerup", "click"]) {
    window.dispatchEvent(new Event(type, { bubbles: true }));
  }
}

/** Punkt ciszy: atrapa detektora oddaje zapisanych konsumentów. */
function reachQuiet(): void {
  for (const { task } of quiet.entries.splice(0)) task();
}

async function flushMicrotasks(): Promise<void> {
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date", "performance"] });
  frames = [];
  quiet.entries = [];
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
    frames.push(callback);
    return frames.length;
  });
  vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});
  __resetFirstInteractionForTests();
  __resetPostInteractionQueueForTests();
  __resetInteractionOrQuietForTests();
});

afterEach(() => {
  __resetInteractionOrQuietForTests();
  __resetPostInteractionQueueForTests();
  __resetFirstInteractionForTests();
  Reflect.deleteProperty(document, "prerendering");
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("otwarcie zatrzasku", () => {
  it("zamknięty, dopóki nic się nie stało: klatki i 30 s czasu niczego nie otwierają", () => {
    const callback = vi.fn();
    onInteractionOrQuiet(callback);
    for (let i = 0; i < 5; i += 1) frame();
    vi.advanceTimersByTime(30_000);
    expect(callback).not.toHaveBeenCalled();
    expect(isInteractionOrQuietOpen()).toBe(false);
  });

  it("pierwsza interakcja otwiera po końcu gestu i po klatce, nie w handlerze", () => {
    const callback = vi.fn();
    onInteractionOrQuiet(callback);
    tap();
    expect(callback).not.toHaveBeenCalled();
    frame();
    expect(callback).toHaveBeenCalledOnce();
    expect(isInteractionOrQuietOpen()).toBe(true);
  });

  it("bez interakcji otwiera punkt ciszy, w klasie `overlays`; późniejszy dotyk nic nie powtarza", () => {
    const callback = vi.fn();
    onInteractionOrQuiet(callback);
    expect(quiet.entries.map((entry) => entry.priority)).toEqual(["overlays"]);
    reachQuiet();
    expect(callback).toHaveBeenCalledOnce();
    expect(isInteractionOrQuietOpen()).toBe(true);
    tap();
    frame();
    frame();
    expect(callback).toHaveBeenCalledOnce();
  });

  it("interakcja przed ciszą zdejmuje zapis w punkcie ciszy", () => {
    onInteractionOrQuiet(vi.fn());
    expect(quiet.entries).toHaveLength(1);
    tap();
    frame();
    expect(quiet.entries).toHaveLength(0);
  });

  it("jeden zatrzask na dokument: wielu subskrybentów, jeden zapis, callbacki raz i po kolei", () => {
    const order: string[] = [];
    onInteractionOrQuiet(() => order.push("a"));
    onInteractionOrQuiet(() => order.push("b"));
    onInteractionOrQuiet(() => order.push("c"));
    expect(quiet.entries).toHaveLength(1);
    reachQuiet();
    expect(order).toEqual(["a", "b", "c"]);
  });

  it("wyjątek jednego callbacku nie zatrzymuje pozostałych", () => {
    const reported = vi.fn();
    vi.stubGlobal("reportError", reported);
    const after = vi.fn();
    onInteractionOrQuiet(() => {
      throw new Error("konsument padł");
    });
    onInteractionOrQuiet(after);
    reachQuiet();
    expect(after).toHaveBeenCalledOnce();
    expect(reported).toHaveBeenCalledOnce();
  });
});

describe("subskrypcje", () => {
  it("spóźniony subskrybent dostaje callback w mikrozadaniu, po zwróceniu odwołania", async () => {
    onInteractionOrQuiet(vi.fn());
    reachQuiet();
    const late = vi.fn();
    onInteractionOrQuiet(late);
    expect(late).not.toHaveBeenCalled();
    await flushMicrotasks();
    expect(late).toHaveBeenCalledOnce();

    const cancelled = vi.fn();
    onInteractionOrQuiet(cancelled)();
    await flushMicrotasks();
    expect(cancelled).not.toHaveBeenCalled();
  });

  it("odwołany przed otwarciem nie biegnie, a zatrzask zostaje uzbrojony (bez drugiego czekania)", () => {
    const cancelled = vi.fn();
    onInteractionOrQuiet(cancelled)();
    expect(quiet.entries).toHaveLength(1);
    const next = vi.fn();
    onInteractionOrQuiet(next);
    expect(quiet.entries).toHaveLength(1);
    reachQuiet();
    expect(cancelled).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledOnce();
  });
});

describe("prerender i serwer", () => {
  it("w prerenderze nic się nie uzbraja, a interakcja nie otwiera; po aktywacji normalnie", () => {
    let prerendering = true;
    Object.defineProperty(document, "prerendering", {
      configurable: true,
      get: () => prerendering,
    });
    const callback = vi.fn();
    onInteractionOrQuiet(callback);
    expect(quiet.entries).toHaveLength(0);
    tap();
    frame();
    vi.advanceTimersByTime(30_000);
    expect(callback).not.toHaveBeenCalled();
    __openInteractionOrQuietForTests();
    expect(isInteractionOrQuietOpen()).toBe(false);

    prerendering = false;
    document.dispatchEvent(new Event("prerenderingchange"));
    expect(quiet.entries).toHaveLength(1);
    tap();
    frame();
    expect(callback).toHaveBeenCalledOnce();
  });

  it("na serwerze (brak window) subskrypcja jest no-opem, a zatrzask zamknięty", () => {
    vi.stubGlobal("window", undefined);
    const callback = vi.fn();
    const cancel = onInteractionOrQuiet(callback);
    expect(() => cancel()).not.toThrow();
    expect(quiet.entries).toHaveLength(0);
    expect(isInteractionOrQuietOpen()).toBe(false);
  });
});

describe("useInteractionOrQuiet", () => {
  let container: HTMLDivElement;
  let root: Root | null = null;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.append(container);
  });

  afterEach(() => {
    act(() => root?.unmount());
    root = null;
    container.remove();
  });

  function Probe({ renders, enabled }: { renders?: boolean[]; enabled?: boolean }) {
    const value = useInteractionOrQuiet(enabled);
    renders?.push(value);
    return <span>{value ? "open" : "closed"}</span>;
  }

  it("serwer i render hydratacji dają false (bez rozjazdu), potem true", () => {
    const html = renderToString(<Probe />);
    expect(html).toContain("closed");
    // Zatrzask otwarty, ZANIM klient zdąży się uwodnić (np. późna wyspa).
    onInteractionOrQuiet(vi.fn());
    reachQuiet();
    container.innerHTML = html;
    const renders: boolean[] = [];
    const errors: unknown[] = [];
    act(() => {
      root = hydrateRoot(container, <Probe renders={renders} />, {
        onRecoverableError: (error) => errors.push(error),
      });
    });
    expect(errors).toEqual([]);
    expect(renders[0]).toBe(false);
    expect(container.textContent).toBe("open");
  });

  it("komponent zamontowany po otwarciu dostaje true od pierwszego renderu", () => {
    onInteractionOrQuiet(vi.fn());
    reachQuiet();
    const renders: boolean[] = [];
    act(() => {
      root = createRoot(container);
      root.render(<Probe renders={renders} />);
    });
    expect(renders[0]).toBe(true);
  });

  it("otwarcie przerenderowuje subskrybentów", () => {
    act(() => {
      root = createRoot(container);
      root.render(<Probe />);
    });
    expect(container.textContent).toBe("closed");
    expect(quiet.entries).toHaveLength(1);
    act(() => reachQuiet());
    expect(container.textContent).toBe("open");
  });

  it("`enabled = false` niczego nie uzbraja i daje false także przy otwartym zatrzasku", () => {
    act(() => {
      root = createRoot(container);
      root.render(<Probe enabled={false} />);
    });
    expect(quiet.entries).toHaveLength(0);
    act(() => __openInteractionOrQuietForTests());
    expect(container.textContent).toBe("closed");
  });
});
