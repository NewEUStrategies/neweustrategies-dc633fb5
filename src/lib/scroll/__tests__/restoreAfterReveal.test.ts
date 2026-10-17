// Ponowne przywrócenie okna po odsłonięciu segmentów strumienia (`restoreAfterReveal.ts`).
//
// Router podrobiony (subskrypcje `onRendered`/`onBeforeNavigate`, `latestLocation`), segmenty
// jak w HTML-u serwera (`<div hidden id="S:…">` w `<body>`, odsłonięcie = usunięcie węzła,
// jak robi to `$RV`). Dowód w prawdziwej przeglądarce, z odsłonięciem React 19.2 wstrzymanym
// do gotowości aplikacji (także z nawigacją przed odsłonięciem):
// `e2e/content-visibility.boot-home.spec.ts`, „przeładowanie w połowie strony, odsłonięcie
// segmentów po hydratacji".
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Wpis przywracania router-core czyta z własnej pamięci (wczytanej raz z `sessionStorage`
// przy ewaluacji modułu) - test podaje magazyn wprost, a podróbka zachowuje kontrakt
// oryginału: klucz z `getKey(router.latestLocation)`, wpis okna dla `getElement() === window`.
const store = vi.hoisted(() => ({
  entries: {} as Record<string, { window?: { scrollX: number; scrollY: number } }>,
}));
const entryFor = vi.hoisted(() =>
  vi.fn(
    (
      router: { latestLocation: unknown },
      options: { getKey: (location: never) => string; getElement: () => unknown },
    ) =>
      options.getElement() === window
        ? store.entries[options.getKey(router.latestLocation as never)]?.window
        : undefined,
  ),
);
vi.mock("@tanstack/router-core", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/router-core")>()),
  getElementScrollRestorationEntry: entryFor,
}));

import { defaultGetScrollRestorationKey } from "@tanstack/router-core";

import { FRAGMENT_OWNED_FLAG } from "../fragmentLandingScript";
import {
  installRestoreAfterReveal,
  PENDING_STREAM_SEGMENT,
  RESTORE_AFTER_REVEAL_MAX_MS,
  RESTORE_AFTER_REVEAL_STOP_EVENTS,
} from "../restoreAfterReveal";

type Listener = (event: unknown) => void;

const at = (key: string, hash = "") => ({
  href: hash ? `/#${hash}` : "/",
  hash,
  state: { __TSR_key: key },
});

function fakeRouter(key = "k1") {
  const listeners = new Map<string, Set<Listener>>();
  const router = {
    options: {} as { getScrollRestorationKey?: (location: never) => string },
    latestLocation: at(key),
    subscribe(type: string, fn: Listener) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)!.add(fn);
      return () => void listeners.get(type)!.delete(fn);
    },
    emit(type: string, event: unknown = {}) {
      for (const fn of [...(listeners.get(type) ?? [])]) fn(event);
    },
    /** Hydratacja: pierwszy `onRendered` (słuchacz router-core już przewinął). */
    rendered() {
      router.emit("onRendered", { toLocation: router.latestLocation });
    },
    /** Zatwierdzenie nawigacji: `load` ustawia `latestLocation` i emituje `onBeforeNavigate`. */
    navigate(to: ReturnType<typeof at>) {
      router.latestLocation = to;
      router.emit("onBeforeNavigate", { toLocation: to, hrefChanged: true });
    },
    count: (type: string) => listeners.get(type)?.size ?? 0,
  };
  installRestoreAfterReveal(router as never);
  return router;
}

/** Segment strumienia jak w HTML-u serwera: `<div hidden id="S:0">` w `<body>`. */
function pendingSegment(id = "S:0"): HTMLElement {
  const seg = document.createElement("div");
  seg.hidden = true;
  seg.id = id;
  document.body.append(seg);
  return seg;
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const owned = window as unknown as Record<string, unknown>;

describe("installRestoreAfterReveal", () => {
  let scrollTo: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    scrollTo = vi.fn();
    vi.stubGlobal("scrollTo", scrollTo);
    document.body.innerHTML = "<main><p>treść</p></main>";
    store.entries = { k1: { window: { scrollX: 0, scrollY: 2202 } } };
    entryFor.mockClear();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
    vi.restoreAllMocks();
    delete owned[FRAGMENT_OWNED_FLAG];
  });

  it("powtarza przywrócenie routera z jego wpisu po odsłonięciu OSTATNIEGO segmentu", async () => {
    const router = fakeRouter();
    const a = pendingSegment("S:0");
    const b = pendingSegment("S:1");
    const removed = vi.spyOn(window, "removeEventListener");
    router.rendered();
    expect(router.count("onRendered")).toBe(0); // tylko pierwszy `onRendered`
    expect(router.count("onBeforeNavigate")).toBe(1);

    a.remove();
    await flush();
    expect(scrollTo).not.toHaveBeenCalled(); // S:1 nadal czeka

    // Inna mutacja `<body>` (portal, baner) przy czekającym segmencie też nic nie robi.
    document.body.append(document.createElement("div"));
    await flush();
    expect(scrollTo).not.toHaveBeenCalled();

    b.remove();
    await flush();
    expect(scrollTo).toHaveBeenCalledExactlyOnceWith(0, 2202);
    // Klucz i wpis jak w router-core: domyślny `getKey`, wpis okna.
    expect(entryFor).toHaveBeenCalledExactlyOnceWith(router, {
      getKey: defaultGetScrollRestorationKey,
      getElement: expect.any(Function),
    });
    // Sprzątnięte: nawigacja i zamiar użytkownika już nic nie trzymają.
    expect(router.count("onBeforeNavigate")).toBe(0);
    for (const type of RESTORE_AFTER_REVEAL_STOP_EVENTS) {
      expect(removed).toHaveBeenCalledWith(type, expect.any(Function), true);
    }

    // Kolejne odsłonięcia (np. późniejsza granica w innym miejscu) - już bez przewijania.
    pendingSegment("S:2").remove();
    await flush();
    expect(scrollTo).toHaveBeenCalledTimes(1);
  });

  it("wpis z WŁASNEGO klucza routera (`getScrollRestorationKey`), nie z `__TSR_key`", async () => {
    store.entries = { "/": { window: { scrollX: 0, scrollY: 900 } } };
    const listeners = new Set<Listener>();
    const router = {
      options: { getScrollRestorationKey: (location: { href: string }) => location.href },
      latestLocation: at("k1"),
      subscribe: (_type: string, fn: Listener) => (listeners.add(fn), () => listeners.delete(fn)),
    };
    installRestoreAfterReveal(router as never);
    const seg = pendingSegment();
    [...listeners][0]({});
    seg.remove();
    await flush();
    expect(scrollTo).toHaveBeenCalledExactlyOnceWith(0, 900);
  });

  it("bez wpisu okna dla tego wpisu historii (pierwsze wejście): nic nie robi", async () => {
    store.entries = { inny: { window: { scrollX: 0, scrollY: 2202 } } };
    const observe = vi.spyOn(MutationObserver.prototype, "observe");
    const router = fakeRouter();
    const seg = pendingSegment();
    router.rendered();
    seg.remove();
    await flush();
    expect(scrollTo).not.toHaveBeenCalled();
    expect(observe).not.toHaveBeenCalled();
    expect(router.count("onBeforeNavigate")).toBe(0);
  });

  it("segmenty odsłonięte przed hydratacją (zwykły przypadek): nic nie robi", async () => {
    const observe = vi.spyOn(MutationObserver.prototype, "observe");
    const router = fakeRouter();
    pendingSegment().remove();
    router.rendered();
    // Render kliencki po nawigacji SPA już nie uzbraja (słuchacz `onRendered` zdjęty).
    const late = pendingSegment("S:9");
    router.rendered();
    late.remove();
    await flush();
    expect(scrollTo).not.toHaveBeenCalled();
    expect(observe).not.toHaveBeenCalled();
  });

  it("segment POZA `<body>` (np. w `<main>`) nie jest segmentem strumienia", async () => {
    const router = fakeRouter();
    const notSegment = document.createElement("div");
    notSegment.hidden = true;
    notSegment.id = "S:x";
    document.querySelector("main")!.append(notSegment);
    expect(document.querySelector(PENDING_STREAM_SEGMENT)).toBeNull();
    router.rendered();
    notSegment.remove();
    await flush();
    expect(scrollTo).not.toHaveBeenCalled();
  });

  for (const type of RESTORE_AFTER_REVEAL_STOP_EVENTS) {
    it(`ustępuje użytkownikowi (\`${type}\` przed odsłonięciem)`, async () => {
      const router = fakeRouter();
      const seg = pendingSegment();
      router.rendered();
      document.body.dispatchEvent(new Event(type, { bubbles: true }));
      seg.remove();
      await flush();
      expect(scrollTo).not.toHaveBeenCalled();
      expect(router.count("onBeforeNavigate")).toBe(0);
    });
  }

  it("nawigacja przed odsłonięciem (link): nowa strona NIE dostaje pozycji starej", async () => {
    const router = fakeRouter();
    const seg = pendingSegment();
    router.rendered();
    router.navigate({ ...at("k2"), href: "/regulamin" });
    seg.remove();
    await flush();
    expect(scrollTo).not.toHaveBeenCalled();
    expect(router.count("onBeforeNavigate")).toBe(0);
  });

  it("tam i z powrotem przed odsłonięciem: klucz znów ten sam, a i tak nic (router przywrócił nowszą pozycję)", async () => {
    const router = fakeRouter();
    const seg = pendingSegment();
    router.rendered();
    router.navigate(at("k2"));
    router.navigate(at("k1"));
    seg.remove();
    await flush();
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it("nawigacja do `#` przed odsłonięciem (lądowanie na kotwicy, nowy wpis historii): nic", async () => {
    const router = fakeRouter();
    const seg = pendingSegment();
    router.rendered();
    router.navigate(at("k3", "kontakt"));
    seg.remove();
    await flush();
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it("przeładowanie tego samego wpisu (`router.invalidate`, ten sam klucz) nie przerywa czekania", async () => {
    const router = fakeRouter();
    const seg = pendingSegment();
    router.rendered();
    router.emit("onBeforeNavigate", { toLocation: at("k1"), hrefChanged: false });
    seg.remove();
    await flush();
    expect(scrollTo).toHaveBeenCalledExactlyOnceWith(0, 2202);
  });

  it("aplikacja przejęła fragment przed odsłonięciem (`__nesAnchorOwned`): nic", async () => {
    expect(FRAGMENT_OWNED_FLAG).toBe("__nesAnchorOwned");
    const router = fakeRouter();
    const seg = pendingSegment();
    router.rendered();
    owned[FRAGMENT_OWNED_FLAG] = true; // `smoothScrollToAnchor` w trakcie czekania
    seg.remove();
    await flush();
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it("fragment przejęty już przy hydratacji: nawet nie obserwuje", async () => {
    owned[FRAGMENT_OWNED_FLAG] = true;
    const observe = vi.spyOn(MutationObserver.prototype, "observe");
    const router = fakeRouter();
    const seg = pendingSegment();
    router.rendered();
    seg.remove();
    await flush();
    expect(scrollTo).not.toHaveBeenCalled();
    expect(observe).not.toHaveBeenCalled();
  });

  it("sufit czekania: tuż przed nim jeszcze przywraca, po nim już nie", async () => {
    vi.useFakeTimers();
    const before = fakeRouter();
    const first = pendingSegment("S:0");
    before.rendered();
    vi.advanceTimersByTime(RESTORE_AFTER_REVEAL_MAX_MS - 1);
    first.remove();
    await vi.runAllTimersAsync();
    expect(scrollTo).toHaveBeenCalledTimes(1);

    const after = fakeRouter();
    const second = pendingSegment("S:1");
    after.rendered();
    vi.advanceTimersByTime(RESTORE_AFTER_REVEAL_MAX_MS);
    expect(after.count("onBeforeNavigate")).toBe(0);
    second.remove();
    await vi.runAllTimersAsync();
    expect(scrollTo).toHaveBeenCalledTimes(1);
  });
});
