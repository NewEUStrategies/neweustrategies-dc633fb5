// Urządzenie widoku dla wysp (P1.6): magazyn na `matchMedia` z progami
// `BuilderRenderer.tsx`, ogłoszenie renderera, hak-lustro `useState` +
// `startTransition` (NIE `useSyncExternalStore`) i jego kontrola negatywna:
// wariant `useSyncExternalStore` ze snapshotem serwer `desktop` / klient
// `mobile` przy zagnieżdżonym `React.lazy` bez chunku MUSI zostać wykryty jako
// render klienta, a lustro MUSI zachować HTML serwera do przyjścia chunku.
//
// P2.2: lustro startuje od urządzenia serwera WYŁĄCZNIE przy hydratacji
// (świeży montaż bierze bieżące urządzenie od razu, bez mignięcia układu) i
// czyta urządzenie ze źródła RENDERERA (`createViewportDeviceSource`), żeby
// wąski renderer (popup, szuflada) nie przestawiał wysp treści strony.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  createElement as h,
  lazy,
  startTransition,
  Suspense,
  useSyncExternalStore,
  type ComponentType,
  type ReactElement,
} from "react";
import { renderToString } from "react-dom/server";
import { createRoot, hydrateRoot, type Root } from "react-dom/client";
import { act } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";

import type { Device } from "@/lib/builder/types";
import {
  SERVER_VIEWPORT_DEVICE,
  VIEWPORT_DESKTOP_MIN_WIDTH,
  VIEWPORT_TABLET_MIN_WIDTH,
  __resetViewportDeviceForTests,
  createViewportDeviceSource,
  getViewportDevice,
  publishViewportDevice,
  subscribeViewportDevice,
  useViewportDevice,
  type ViewportDeviceSource,
} from "../viewportDevice";

vi.mock("react", async (importOriginal) => {
  const real = await importOriginal<typeof import("react")>();
  return { ...real, startTransition: vi.fn(real.startTransition) };
});

// --- Atrapa `matchMedia` sterowana szerokością widoku --------------------------

type MediaListener = (event: { matches: boolean; media: string }) => void;

/** `matches` liczone na żywo, jak w przeglądarce (słuchacz jednej listy widzi już nowy wynik drugiej). */
class FakeMediaQueryList {
  readonly listeners = new Set<MediaListener>();
  reported: boolean;
  constructor(readonly media: string) {
    this.reported = this.matches;
  }
  get matches(): boolean {
    return matchesWidth(this.media);
  }
  addEventListener(_type: string, listener: MediaListener): void {
    this.listeners.add(listener);
  }
  removeEventListener(_type: string, listener: MediaListener): void {
    this.listeners.delete(listener);
  }
}

let width = 1280;
const lists = new Map<string, FakeMediaQueryList>();

function matchesWidth(query: string): boolean {
  const min = /\(min-width: (\d+)px\)/.exec(query);
  return min ? width >= Number(min[1]) : false;
}

function installMatchMedia(initialWidth: number): void {
  width = initialWidth;
  lists.clear();
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: (query: string) => {
      let list = lists.get(query);
      if (!list) {
        list = new FakeMediaQueryList(query);
        lists.set(query, list);
      }
      return list;
    },
  });
}

/** Zmiana szerokości: listy, których wynik się zmienił, dostają `change` (jak przeglądarka). */
function resize(nextWidth: number): void {
  width = nextWidth;
  for (const list of lists.values()) {
    const matches = list.matches;
    if (matches === list.reported) continue;
    list.reported = matches;
    for (const listener of [...list.listeners]) listener({ matches, media: list.media });
  }
}

let consoleError: MockInstance;
const cleanups: Array<() => Promise<void>> = [];

beforeEach(() => {
  __resetViewportDeviceForTests();
  vi.mocked(startTransition).mockClear();
  consoleError = vi.spyOn(console, "error");
});

afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
  expect(consoleError).not.toHaveBeenCalled();
  __resetViewportDeviceForTests();
  Reflect.deleteProperty(window, "matchMedia");
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

// --- Magazyn -------------------------------------------------------------------

describe("magazyn urządzenia widoku", () => {
  it("progi są te same co w `BuilderRenderer.tsx` (768 / 1024)", () => {
    const source = readFileSync(
      resolve(process.cwd(), "src/components/builder/organisms/BuilderRenderer.tsx"),
      "utf8",
    );
    expect(source).toContain(`const MOBILE_BREAKPOINT = ${VIEWPORT_TABLET_MIN_WIDTH};`);
    expect(source).toContain(`const TABLET_BREAKPOINT = ${VIEWPORT_DESKTOP_MIN_WIDTH};`);
    expect(SERVER_VIEWPORT_DEVICE).toBe("desktop");
  });

  it.each<[number, Device]>([
    [375, "mobile"],
    [767, "mobile"],
    [768, "tablet"],
    [1023, "tablet"],
    [1024, "desktop"],
    [1440, "desktop"],
  ])("szerokość %i px -> %s", (viewport, device) => {
    installMatchMedia(viewport);
    expect(getViewportDevice()).toBe(device);
  });

  it("pomiar rusza leniwie: świeży import nie pyta o media, dopiero odczyt albo subskrypcja", async () => {
    installMatchMedia(375);
    vi.resetModules();
    const fresh = await import("../viewportDevice");
    await Promise.resolve();
    expect(lists.size).toBe(0);

    const stop = fresh.subscribeViewportDevice(() => {});
    expect([...lists.keys()].sort()).toEqual(["(min-width: 1024px)", "(min-width: 768px)"]);
    stop();
    fresh.__resetViewportDeviceForTests();
  });

  it("słuchacz dostaje tylko RÓŻNĄ klasę; przejście przez próg w obie strony; odpięcie", () => {
    installMatchMedia(1280);
    const seen: Device[] = [];
    const stop = subscribeViewportDevice((device) => seen.push(device));

    resize(1100); // nadal desktop
    resize(900);
    resize(400);
    resize(1200);
    stop();
    resize(500);

    expect(seen).toEqual(["tablet", "mobile", "desktop"]);
    expect(getViewportDevice()).toBe("mobile");
  });

  it("ogłoszenie renderera wygrywa do następnej zmiany; ostatni zapis wygrywa", () => {
    installMatchMedia(1030); // widok desktop, kontener bez paska przewijania węższy
    const seen: Device[] = [];
    subscribeViewportDevice((device) => seen.push(device));

    publishViewportDevice("tablet");
    publishViewportDevice("tablet");
    expect(getViewportDevice()).toBe("tablet");
    resize(500);
    publishViewportDevice("mobile");

    expect(seen).toEqual(["tablet", "mobile"]);
  });

  it("bez `matchMedia`: brak pomiaru (`null`) do pierwszego ogłoszenia", () => {
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      writable: true,
      value: undefined,
    });
    expect(getViewportDevice()).toBeNull();
    publishViewportDevice("mobile");
    expect(getViewportDevice()).toBe("mobile");
  });
});

// --- Hak-lustro ----------------------------------------------------------------

describe("useViewportDevice - lustro useState + startTransition", () => {
  function Probe({
    serverDevice,
    log,
    source,
  }: {
    serverDevice?: Device;
    log: Device[];
    source?: ViewportDeviceSource;
  }): ReactElement {
    const device = useViewportDevice(serverDevice, source);
    log.push(device);
    return h("p", { "data-probe": "device" }, device);
  }

  /** HTML serwera i `hydrateRoot` (pierwszy render klienta = hydratacja). */
  async function hydrateProbe(
    props: { serverDevice?: Device; source?: ViewportDeviceSource },
    log: Device[],
  ): Promise<{ container: HTMLDivElement; errors: unknown[] }> {
    const container = document.createElement("div");
    vi.stubEnv("SSR", true);
    container.innerHTML = renderToString(h(Probe, { ...props, log: [] }));
    vi.stubEnv("SSR", false);
    document.body.append(container);
    const errors: unknown[] = [];
    let root!: Root;
    await act(async () => {
      root = hydrateRoot(container, h(Probe, { ...props, log }), {
        onRecoverableError: (error) => errors.push(error),
      });
    });
    cleanups.push(async () => {
      await act(async () => root.unmount());
      container.remove();
    });
    return { container, errors };
  }

  async function mount(element: ReactElement): Promise<HTMLDivElement> {
    const container = document.createElement("div");
    document.body.append(container);
    let root!: Root;
    await act(async () => {
      root = createRoot(container);
      root.render(element);
    });
    cleanups.push(async () => {
      await act(async () => root.unmount());
      container.remove();
    });
    return container;
  }

  it("serwer: zwraca `serverDevice` (domyślnie desktop), bez pytania o media", () => {
    installMatchMedia(375);
    vi.stubEnv("SSR", true);
    expect(renderToString(h(Probe, { log: [] }))).toContain("desktop");
    expect(renderToString(h(Probe, { serverDevice: "mobile", log: [] }))).toContain("mobile");
    expect(lists.size).toBe(0);
  });

  it("hydratacja: pierwszy render = urządzenie serwera (bez rozjazdu), potem urządzenie klienta WYŁĄCZNIE w przejściu", async () => {
    installMatchMedia(375);
    const log: Device[] = [];

    const { container, errors } = await hydrateProbe({}, log);

    expect(log[0]).toBe("desktop");
    expect(container.textContent).toBe("mobile");
    expect(startTransition).toHaveBeenCalledTimes(1);
    expect(errors).toEqual([]);
  });

  it("świeży montaż (bez HTML serwera): od razu bieżące urządzenie, bez renderu „desktop” i bez przejścia", async () => {
    installMatchMedia(375);
    const log: Device[] = [];

    const container = await mount(h(Probe, { log }));

    expect(log[0]).toBe("mobile");
    expect(container.textContent).toBe("mobile");
    expect(startTransition).not.toHaveBeenCalled();
  });

  it("hydratacja na desktopie: zero przejść i zero dodatkowych renderów", async () => {
    installMatchMedia(1280);
    const log: Device[] = [];

    const { container } = await hydrateProbe({}, log);

    expect(container.textContent).toBe("desktop");
    expect(log).toEqual(["desktop"]);
    expect(startTransition).not.toHaveBeenCalled();
  });

  it("zmiany magazynu (pomiar i ogłoszenie) też idą w przejściu; ta sama klasa nie renderuje", async () => {
    installMatchMedia(1280);
    const log: Device[] = [];
    const container = await mount(h(Probe, { log }));
    expect(container.textContent).toBe("desktop");
    const renders = log.length;

    await act(async () => resize(1100));
    expect(log.length).toBe(renders);

    vi.mocked(startTransition).mockClear();
    await act(async () => resize(800));
    expect(container.textContent).toBe("tablet");
    await act(async () => publishViewportDevice("mobile"));
    expect(container.textContent).toBe("mobile");
    expect(startTransition).toHaveBeenCalledTimes(2);
  });

  it("odmontowanie odpina subskrypcję (zmiana później nie aktualizuje odpiętego komponentu)", async () => {
    installMatchMedia(1280);
    const seen: Device[] = [];
    subscribeViewportDevice((device) => seen.push(device));
    const container = await mount(h(Probe, { log: [] }));
    await cleanups.pop()?.();
    vi.mocked(startTransition).mockClear();

    resize(400);

    expect(seen).toEqual(["mobile"]);
    expect(startTransition).not.toHaveBeenCalled();
    expect(container.isConnected).toBe(false);
  });

  // Źródło renderera (P2.2).
  describe("createViewportDeviceSource - urządzenie jednego renderera", () => {
    it("do pierwszego ogłoszenia `null`; słuchacz dostaje tylko RÓŻNĄ klasę; odpięcie", () => {
      const source = createViewportDeviceSource("desktop");
      const seen: Device[] = [];
      const stop = source.subscribe((device) => seen.push(device));

      expect(source.serverDevice).toBe("desktop");
      expect(source.get()).toBeNull();
      source.publish("desktop");
      source.publish("desktop");
      source.publish("mobile");
      stop();
      source.publish("tablet");

      expect(seen).toEqual(["desktop", "mobile"]);
      expect(source.get()).toBe("tablet");
    });

    it("niezależne od magazynu strony: wąski renderer (popup) nie przestawia innego źródła ani magazynu", () => {
      installMatchMedia(1280);
      const content = createViewportDeviceSource();
      const popup = createViewportDeviceSource();
      content.publish("desktop");
      popup.publish("mobile");

      expect(content.get()).toBe("desktop");
      expect(getViewportDevice()).toBe("desktop");
    });

    it("hak ze źródłem: hydratacja od `serverDevice` źródła, potem ogłoszenie renderera w przejściu; magazyn strony bez znaczenia", async () => {
      installMatchMedia(375); // widok telefonu, ale renderer ogłosi desktop
      const source = createViewportDeviceSource("desktop");
      const log: Device[] = [];

      const { container, errors } = await hydrateProbe({ source }, log);
      expect(container.textContent).toBe("desktop");
      expect(log).toEqual(["desktop"]);

      await act(async () => source.publish("tablet"));
      expect(container.textContent).toBe("tablet");
      expect(startTransition).toHaveBeenCalledTimes(1);
      expect(errors).toEqual([]);
    });

    it("hak ze źródłem: `serverDevice` źródła (renderer z `device`), świeży montaż po ogłoszeniu - od razu bieżąca klasa", async () => {
      const source = createViewportDeviceSource("mobile");
      vi.stubEnv("SSR", true);
      expect(renderToString(h(Probe, { source, log: [] }))).toContain("mobile");
      vi.stubEnv("SSR", false);

      source.publish("tablet");
      const log: Device[] = [];
      const container = await mount(h(Probe, { source, log }));
      expect(log[0]).toBe("tablet");
      expect(container.textContent).toBe("tablet");
    });
  });
});

// --- Kontrola negatywna (a) na poziomie haka -----------------------------------

describe("kontrola negatywna: zagnieżdżony React.lazy bez chunku i telefon", () => {
  function Widget({ device }: { device: string }): ReactElement {
    return h("p", { "data-probe": "nested" }, `Widget ${device}`);
  }

  function Section({
    device,
    W,
  }: {
    device: string;
    W: ComponentType<{ device: string }>;
  }): ReactElement {
    return h(
      "div",
      null,
      h("span", { "data-probe": "section-device" }, device),
      h(Suspense, { fallback: h("i", { "data-probe": "nested-fallback" }) }, h(W, { device })),
    );
  }

  /** HTML serwera z eager widgetem, hydratacja z leniwym, którego chunk czeka. */
  async function hydrateNested(
    DeviceSection: ComponentType<{ W: ComponentType<{ device: string }> }>,
  ) {
    let release!: (module: { default: ComponentType<{ device: string }> }) => void;
    const chunk = new Promise<{ default: ComponentType<{ device: string }> }>((done) => {
      release = done;
    });
    const LazyWidget = lazy(() => chunk);
    const container = document.createElement("div");
    vi.stubEnv("SSR", true);
    container.innerHTML = renderToString(h(DeviceSection, { W: Widget }));
    vi.stubEnv("SSR", false);
    document.body.append(container);
    const nested = container.querySelector('[data-probe="nested"]');
    const errors: unknown[] = [];
    let root!: Root;
    await act(async () => {
      root = hydrateRoot(container, h(DeviceSection, { W: LazyWidget }), {
        onRecoverableError: (error) => errors.push(error),
      });
    });
    await act(async () => {
      await new Promise((done) => setTimeout(done, 20));
    });
    cleanups.push(async () => {
      await act(async () => root.unmount());
      container.remove();
    });
    return {
      container,
      errors,
      nestedLost: () =>
        nested === null ||
        !nested.isConnected ||
        container.querySelector('[data-probe="nested"]') !== nested,
      text: (probe: string) => container.querySelector(`[data-probe="${probe}"]`)?.textContent,
      release: async () => {
        await act(async () => {
          release({ default: Widget });
          await chunk;
        });
      },
    };
  }

  it("wariant `useSyncExternalStore` (serwer desktop, klient mobile): HTML zagnieżdżonego widgetu porzucony", async () => {
    const subscribe = () => () => {};
    function StoreSection({ W }: { W: ComponentType<{ device: string }> }): ReactElement {
      const device = useSyncExternalStore(
        subscribe,
        () => "mobile",
        () => "desktop",
      );
      return h(Section, { device, W });
    }

    const t = await hydrateNested(StoreSection);

    expect(t.nestedLost()).toBe(true);
    expect(t.container.querySelector('[data-probe="nested-fallback"]')).not.toBeNull();
    // Bez śladu w `onRecoverableError` - dlatego uprząż patrzy na węzły DOM.
    expect(t.errors).toEqual([]);
  });

  it("lustro `useViewportDevice`: HTML zachowany, przejście czeka na chunk, potem urządzenie klienta", async () => {
    installMatchMedia(375);
    function MirrorSection({ W }: { W: ComponentType<{ device: string }> }): ReactElement {
      return h(Section, { device: useViewportDevice(), W });
    }

    const t = await hydrateNested(MirrorSection);

    expect(t.nestedLost()).toBe(false);
    expect(t.text("section-device")).toBe("desktop");
    expect(t.container.querySelector('[data-probe="nested-fallback"]')).toBeNull();

    await t.release();

    expect(t.nestedLost()).toBe(false);
    expect(t.errors).toEqual([]);
    expect(t.text("section-device")).toBe("mobile");
    expect(t.text("nested")).toBe("Widget mobile");
  });
});
