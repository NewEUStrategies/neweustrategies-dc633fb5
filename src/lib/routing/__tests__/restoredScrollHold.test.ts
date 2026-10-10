// Trzymanie przywróconej pozycji okna (`restoredScrollHold.ts`).
//
// CO TO DOWODZI. Kiedy moduł w ogóle trzyma (tylko po `onRendered`, w którym
// router przywrócił okno - także przycięte do końca krótszego dokumentu), co
// wyzwala korektę (`scroll` zawsze, zmiana rozmiaru tylko przy przycięciu) i co
// trzymanie kończy (gest, nawigacja na inny adres, cisza, limit). Geometrię -
// zwijanie nagłówka i odsłanianie sekcji po `onRendered` na prawdziwym
// Chromium - mierzy e2e `content-visibility.boot-home.spec.ts`
// („przeładowanie w połowie strony").
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AnyRouter, ScrollRestorationEntry } from "@tanstack/router-core";

const entry = vi.hoisted(() => ({ current: undefined as ScrollRestorationEntry | undefined }));
vi.mock("@tanstack/router-core", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/router-core")>()),
  getElementScrollRestorationEntry: () => entry.current,
}));

import { HOLD_MAX_MS, HOLD_QUIET_MS, holdRestoredScroll } from "../restoredScrollHold";

type Listener = (event: { hrefChanged?: boolean }) => void;

/** Router z samym `subscribe` - moduł nie dotyka niczego więcej. */
function fakeRouter() {
  const listeners = new Map<string, Set<Listener>>();
  const router = {
    options: {},
    subscribe(type: string, fn: Listener) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)!.add(fn);
      return () => listeners.get(type)!.delete(fn);
    },
  };
  const emit = (type: string, event: { hrefChanged?: boolean } = {}) => {
    for (const fn of listeners.get(type) ?? []) fn(event);
  };
  return { router: router as unknown as AnyRouter, emit };
}

/** Okno o zadanej wysokości dokumentu; `scrollTo` przycina jak przeglądarka. */
let scrollY = 0;
let documentHeight = 4000;
const VIEWPORT = 900;
const setScrollY = (value: number) => {
  scrollY = Math.max(0, Math.min(value, documentHeight - VIEWPORT));
};
const scrollTo = vi.fn((options: ScrollToOptions) => setScrollY(options.top ?? 0));
/** Zmiana pozycji z zewnątrz (zakotwiczenie, czytelnik) + zdarzenie `scroll` okna. */
const moveBy = (delta: number) => {
  setScrollY(scrollY + delta);
  window.dispatchEvent(new Event("scroll"));
};

let resizeCallbacks: Array<() => void> = [];
class FakeResizeObserver {
  constructor(private readonly callback: () => void) {}
  observe() {
    resizeCallbacks.push(this.callback);
  }
  disconnect() {
    resizeCallbacks = resizeCallbacks.filter((cb) => cb !== this.callback);
  }
}
const resize = (height: number) => {
  documentHeight = height;
  for (const cb of [...resizeCallbacks]) cb();
};

beforeEach(() => {
  vi.useFakeTimers();
  scrollY = 0;
  documentHeight = 4000;
  entry.current = undefined;
  resizeCallbacks = [];
  scrollTo.mockClear();
  vi.stubGlobal("ResizeObserver", FakeResizeObserver);
  Object.defineProperty(window, "scrollY", { configurable: true, get: () => scrollY });
  Object.defineProperty(window, "scrollX", { configurable: true, get: () => 0 });
  Object.defineProperty(window, "innerHeight", { configurable: true, get: () => VIEWPORT });
  Object.defineProperty(document.documentElement, "scrollHeight", {
    configurable: true,
    get: () => documentHeight,
  });
  vi.spyOn(window, "scrollTo").mockImplementation(scrollTo as unknown as typeof window.scrollTo);
});

/** Odpięcia modułu z każdego testu - aktywne trzymanie zostawiałoby nasłuchy na oknie. */
const disposers: Array<() => void> = [];

afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** Router przywrócił okno na `y` (jego nasłuch `onRendered` biegnie przed modułem). */
function restored(y: number) {
  const { router, emit } = fakeRouter();
  const dispose = holdRestoredScroll(router);
  disposers.push(dispose);
  entry.current = { scrollX: 0, scrollY: y };
  setScrollY(y);
  emit("onRendered");
  return { emit, dispose };
}

describe("holdRestoredScroll", () => {
  it("po przywróceniu oddaje pozycję, z której zakotwiczenie zeszło przy zwijaniu nagłówka", () => {
    restored(2202);
    // Klatka zwijania: zakotwiczenie obniża `scrollY`, zdarzenie `scroll` przychodzi po niej.
    moveBy(-5);
    expect(scrollTo).toHaveBeenLastCalledWith({ left: 0, top: 2202, behavior: "instant" });
    expect(window.scrollY).toBe(2202);
    moveBy(-22);
    expect(window.scrollY).toBe(2202);
  });

  it("bez wpisu przywrócenia, z wpisem na samej górze albo gdy router nie przywrócił okna: nic nie trzyma", () => {
    const { router, emit } = fakeRouter();
    disposers.push(holdRestoredScroll(router));
    emit("onRendered");
    moveBy(300);
    entry.current = { scrollX: 0, scrollY: 0 };
    emit("onRendered");
    moveBy(300);
    // `resetScroll: false`: wpis istnieje, ale okno stoi gdzie indziej.
    entry.current = { scrollX: 0, scrollY: 2202 };
    emit("onRendered");
    moveBy(-100);
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it("gest czytelnika kończy trzymanie, zanim jego przewinięcie dojdzie do okna", () => {
    restored(2202);
    window.dispatchEvent(new Event("wheel"));
    moveBy(-400);
    expect(scrollTo).not.toHaveBeenCalled();
    expect(window.scrollY).toBe(1802);
  });

  it.each(["touchstart", "pointerdown", "keydown"])("gest `%s` też kończy trzymanie", (type) => {
    restored(2202);
    window.dispatchEvent(new Event(type));
    moveBy(-400);
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it("cisza bez korekty kończy trzymanie; każda korekta odsuwa ją od nowa", () => {
    restored(2202);
    vi.advanceTimersByTime(HOLD_QUIET_MS - 1);
    moveBy(-10);
    expect(scrollTo).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(HOLD_QUIET_MS - 1);
    moveBy(-10);
    expect(scrollTo).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(HOLD_QUIET_MS);
    moveBy(-10);
    expect(scrollTo).toHaveBeenCalledTimes(2);
    expect(window.scrollY).toBe(2192);
  });

  it("limit kończy trzymanie także przy korektach bez przerwy", () => {
    restored(2202);
    const step = HOLD_QUIET_MS / 2;
    for (let t = 0; t + step < HOLD_MAX_MS; t += step) {
      vi.advanceTimersByTime(step);
      moveBy(-1);
    }
    vi.advanceTimersByTime(step);
    scrollTo.mockClear();
    moveBy(-1);
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it("nawigacja na inny adres kończy trzymanie; `invalidate()` pod tym samym adresem - nie", () => {
    const { emit } = restored(2202);
    emit("onBeforeNavigate", { hrefChanged: false });
    moveBy(-10);
    expect(window.scrollY).toBe(2202);
    emit("onBeforeNavigate", { hrefChanged: true });
    moveBy(-10);
    expect(window.scrollY).toBe(2192);
  });

  it("przycięte przywrócenie (dokument krótszy niż przy zapisie): wzrost dokumentu oddaje pozycję", () => {
    documentHeight = 2852;
    restored(2202);
    expect(window.scrollY).toBe(1952);
    resize(3000);
    expect(window.scrollY).toBe(2100);
    resize(3142);
    expect(window.scrollY).toBe(2202);
  });

  it("bez przycięcia zmiana rozmiaru nie koryguje (korekta zakotwiczenia przychodzi zdarzeniem `scroll`)", () => {
    restored(2202);
    setScrollY(2190);
    resize(3990);
    expect(scrollTo).not.toHaveBeenCalled();
    window.dispatchEvent(new Event("scroll"));
    expect(window.scrollY).toBe(2202);
  });

  it("następne `onRendered` i odpięcie zdejmują nasłuchy", () => {
    const { emit, dispose } = restored(2202);
    entry.current = undefined;
    emit("onRendered");
    moveBy(-10);
    expect(scrollTo).not.toHaveBeenCalled();
    dispose();
    entry.current = { scrollX: 0, scrollY: 2000 };
    setScrollY(2000);
    emit("onRendered");
    moveBy(-10);
    expect(scrollTo).not.toHaveBeenCalled();
    expect(resizeCallbacks).toEqual([]);
  });
});
