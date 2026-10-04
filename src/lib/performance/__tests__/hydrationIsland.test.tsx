// Wyspa hydratacji (P1.6). Wzór: `src/hooks/__tests__/authHydration.test.tsx` -
// HTML serwera w kontenerze, `hydrateRoot`, węzły serwera śledzone przez
// tożsamość (`data-probe`), `onRecoverableError` i `console.error` zbierane.
// Render klienta poznajemy po DOM-ie: React 19.2 porzuca HTML serwera
// odwodnionej granicy po aktualizacji bez ostrzeżenia i bez
// `onRecoverableError`, więc kontrola negatywna patrzy na węzły (`lost()`).
//
// Punkt ciszy jest atrapą (zadanie uruchamiane ręcznie), kolejka P0.3 -
// prawdziwa (`enqueue` tylko podsłuchiwany), klatki sterowane ręcznie.
import {
  createContext,
  lazy,
  startTransition,
  StrictMode,
  Suspense,
  use,
  useContext,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ComponentType,
  type ReactElement,
  type ReactNode,
} from "react";
import { renderToString } from "react-dom/server";
import { flushSync } from "react-dom";
import { createRoot, hydrateRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import i18next, { type i18n as I18n } from "i18next";
import { I18nextProvider, useTranslation } from "react-i18next";
import { act } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";

import { BuilderModeProvider } from "@/lib/content-model/editorCanvas";
import { ISLAND_STATE_ATTR, ISLAND_STATES } from "@/lib/webVitals";
import { HydrationIsland, type IslandChunk, type IslandTrigger } from "../hydrationIsland";
import { __resetFirstInteractionForTests } from "../firstInteraction";
import { __resetPostInteractionQueueForTests, enqueue } from "../postInteractionQueue";
import { onQuiescent } from "../whenQuiescent";
import {
  __resetViewportDeviceForTests,
  getViewportDevice,
  publishViewportDevice,
  useViewportDevice,
} from "../viewportDevice";

const quiescence = vi.hoisted(() => ({
  consumers: [] as Array<{ task: () => unknown; priority: string; cancelled: boolean }>,
}));

vi.mock("../whenQuiescent", () => ({
  onQuiescent: vi.fn((task: () => unknown, options: { priority: string }) => {
    const consumer = { task, priority: options.priority, cancelled: false };
    quiescence.consumers.push(consumer);
    return () => {
      consumer.cancelled = true;
    };
  }),
}));

vi.mock("../postInteractionQueue", async (importOriginal) => {
  const real = await importOriginal<typeof import("../postInteractionQueue")>();
  return { ...real, enqueue: vi.fn(real.enqueue) };
});

// --- Atrapy przeglądarki -----------------------------------------------------

type FakeEntry = { isIntersecting: boolean; target: Element };

class FakeIntersectionObserver {
  static instances: FakeIntersectionObserver[] = [];
  readonly observed: Element[] = [];
  disconnected = false;
  constructor(
    private readonly callback: (entries: FakeEntry[]) => void,
    readonly options: { rootMargin?: string } = {},
  ) {
    FakeIntersectionObserver.instances.push(this);
  }
  observe(target: Element): void {
    this.observed.push(target);
  }
  unobserve(): void {}
  disconnect(): void {
    this.disconnected = true;
  }
  takeRecords(): FakeEntry[] {
    return [];
  }
  emit(isIntersecting: boolean): void {
    if (!this.disconnected) {
      this.callback(this.observed.map((target) => ({ isIntersecting, target })));
    }
  }
}

type MediaListener = (event: { matches: boolean; media: string }) => void;

class FakeMediaQueryList {
  readonly listeners = new Set<MediaListener>();
  constructor(
    readonly media: string,
    public matches: boolean,
  ) {}
  addEventListener(_type: string, listener: MediaListener): void {
    this.listeners.add(listener);
  }
  removeEventListener(_type: string, listener: MediaListener): void {
    this.listeners.delete(listener);
  }
  change(matches: boolean): void {
    this.matches = matches;
    for (const listener of [...this.listeners]) listener({ matches, media: this.media });
  }
}

const mediaLists = new Map<string, FakeMediaQueryList>();

function installMatchMedia(initial: (query: string) => boolean): void {
  mediaLists.clear();
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: (query: string) => {
      let list = mediaLists.get(query);
      if (!list) {
        list = new FakeMediaQueryList(query, initial(query));
        mediaLists.set(query, list);
      }
      return list;
    },
  });
}

function media(query: string): FakeMediaQueryList {
  const list = mediaLists.get(query);
  if (!list) throw new Error(`nikt nie pytał o ${query}`);
  return list;
}

// --- Uprząż hydratacji -------------------------------------------------------

let frames: FrameRequestCallback[] = [];
let consoleError: MockInstance;
let consoleWarn: MockInstance;
const cleanups: Array<() => Promise<void>> = [];
const clicks: string[] = [];
const commits: string[] = [];

function serverHtml(element: ReactElement): string {
  vi.stubEnv("SSR", true);
  try {
    return renderToString(element);
  } finally {
    vi.stubEnv("SSR", false);
  }
}

interface Hydrated {
  readonly container: HTMLDivElement;
  readonly root: Root;
  readonly errors: unknown[];
  island(id?: string): HTMLElement;
  state(id?: string): string | null;
  probe(name: string): Element;
  /** Węzły serwera (`data-probe`), które zniknęły albo zostały zastąpione. */
  lost(): string[];
  fallbackShown(): boolean;
}

async function hydrate(server: ReactElement, client: ReactElement = server): Promise<Hydrated> {
  const container = document.createElement("div");
  container.innerHTML = serverHtml(server);
  document.body.append(container);
  const probes = new Map(
    Array.from(container.querySelectorAll("[data-probe]"), (node) => [
      node.getAttribute("data-probe") ?? "",
      node,
    ]),
  );
  const errors: unknown[] = [];
  let root!: Root;
  await act(async () => {
    root = hydrateRoot(container, client, { onRecoverableError: (error) => errors.push(error) });
  });
  cleanups.push(async () => {
    await act(async () => root.unmount());
    container.remove();
  });
  const island = (id?: string): HTMLElement => {
    const selector = id === undefined ? "[data-island-id]" : `[data-island-id="${id}"]`;
    const found = container.querySelector<HTMLElement>(selector);
    if (!found) throw new Error(`brak wyspy ${id ?? ""}`);
    return found;
  };
  return {
    container,
    root,
    errors,
    island,
    state: (id) => island(id).getAttribute(ISLAND_STATE_ATTR),
    probe: (name) => {
      const node = probes.get(name);
      if (!node) throw new Error(`brak sondy ${name}`);
      return node;
    },
    lost: () =>
      [...probes]
        .filter(
          ([name, node]) =>
            !node.isConnected || container.querySelector(`[data-probe="${name}"]`) !== node,
        )
        .map(([name]) => name),
    fallbackShown: () => container.querySelector("[data-island-fallback]") !== null,
  };
}

async function flushMicrotasks(): Promise<void> {
  for (let i = 0; i < 10; i += 1) await Promise.resolve();
}

/** Jedna klatka kolejki P0.3: callbacki rAF, makrozadanie kroku, praca Reacta w `act`. */
async function frame(): Promise<void> {
  await flushMicrotasks();
  await act(async () => {
    const pending = frames.splice(0);
    for (const callback of pending) callback(performance.now());
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  await flushMicrotasks();
}

/** Punkt ciszy (atrapa): zadania zapisanych konsumentów, jak zrobiłaby kolejka. */
async function reachQuiescence(): Promise<unknown[]> {
  const results: unknown[] = [];
  await act(async () => {
    for (const consumer of quiescence.consumers) {
      if (consumer.cancelled) continue;
      consumer.cancelled = true;
      results.push(consumer.task());
    }
  });
  return results;
}

function activeQuiescenceConsumers(): number {
  return quiescence.consumers.filter((consumer) => !consumer.cancelled).length;
}

/**
 * Sonda „czy bramka jest otwarta TERAZ": dyskretny `click` w odwodnioną
 * treść. React próbuje wtedy hydratacji synchronicznej - udaje się tylko przy
 * bramce `status: "fulfilled"`, i wtedy handler dostaje klik w tym samym
 * wywołaniu.
 */
function clickNow(target: Element): void {
  act(() => {
    target.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

function pointer(type: string): PointerEvent {
  return new PointerEvent(type, { bubbles: true, cancelable: true });
}

async function tap(target: EventTarget): Promise<void> {
  await act(async () => {
    target.dispatchEvent(pointer("pointerdown"));
    target.dispatchEvent(pointer("pointerup"));
    target.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

function deferred<T = void>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve: (value: T) => void = () => {};
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function enqueueCalls(): Array<{ priority: string; release: string; target: Node | null }> {
  return vi.mocked(enqueue).mock.calls.map(([, options]) => ({
    priority: options.priority,
    release: options.release ?? "interaction",
    target: options.target ?? null,
  }));
}

function createI18n(): I18n {
  const instance = i18next.createInstance();
  void instance.init({
    lng: "pl",
    fallbackLng: "pl",
    initAsync: false,
    resources: { pl: { translation: { nav: "Menu" } }, en: { translation: { nav: "Menu EN" } } },
    interpolation: { escapeValue: false },
  });
  return instance;
}

// --- Treść testowa -----------------------------------------------------------

function Content({ name = "a", children }: { name?: string; children?: ReactNode }): ReactElement {
  useLayoutEffect(() => {
    commits.push(name);
  }, [name]);
  return (
    <article data-probe={`${name}-article`}>
      <h2 data-probe={`${name}-title`}>Server article {name}</h2>
      <button type="button" data-probe={`${name}-button`} onClick={() => clicks.push(name)}>
        Czytaj
      </button>
      {children}
    </article>
  );
}

function Island({
  id = "a",
  trigger = {},
  chunks,
  children,
}: {
  id?: string;
  trigger?: IslandTrigger;
  chunks?: readonly IslandChunk[];
  children?: ReactNode;
}): ReactElement {
  return (
    <HydrationIsland id={id} trigger={trigger} chunks={chunks}>
      {children ?? <Content name={id} />}
    </HydrationIsland>
  );
}

beforeEach(() => {
  frames = [];
  clicks.length = 0;
  commits.length = 0;
  quiescence.consumers.length = 0;
  FakeIntersectionObserver.instances = [];
  vi.mocked(enqueue).mockClear();
  vi.mocked(onQuiescent).mockClear();
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
    frames.push(callback);
    return frames.length;
  });
  vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});
  consoleError = vi.spyOn(console, "error");
  consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.stubGlobal("IntersectionObserver", FakeIntersectionObserver);
  __resetFirstInteractionForTests();
  __resetPostInteractionQueueForTests();
  __resetViewportDeviceForTests();
});

afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
  expect(consoleError).not.toHaveBeenCalled();
  __resetPostInteractionQueueForTests();
  __resetFirstInteractionForTests();
  __resetViewportDeviceForTests();
  Reflect.deleteProperty(window, "matchMedia");
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

// --- HTML serwera i kontrakt `data-island-state` -----------------------------

describe("HTML serwera i kontrakt data-island-state (P0.6)", () => {
  it("serwer: otoczka z `pending` obejmuje interaktywne potomki, granica bez fallbacku", () => {
    const html = serverHtml(<Island id="sec-1" />);
    const box = document.createElement("div");
    box.innerHTML = html;
    const wrapper = box.querySelector('[data-island-id="sec-1"]');

    expect(wrapper?.getAttribute(ISLAND_STATE_ATTR)).toBe("pending");
    expect(box.querySelector("button")?.closest(`[${ISLAND_STATE_ATTR}]`)).toBe(wrapper);
    expect(html).toContain("<!--$-->");
    expect(html).not.toContain("data-island-fallback");
    expect(onQuiescent).not.toHaveBeenCalled();
    expect(enqueue).not.toHaveBeenCalled();
  });

  it("`pending` do commitu granicy, `hydrated` po nim - i żadnej trzeciej wartości", async () => {
    const chunk = deferred();
    let stateAtContentCommit: string | null = null;
    function Probe(): ReactElement {
      const ref = useRef<HTMLSpanElement>(null);
      useLayoutEffect(() => {
        stateAtContentCommit =
          ref.current?.closest(`[${ISLAND_STATE_ATTR}]`)?.getAttribute(ISLAND_STATE_ATTR) ?? null;
      }, []);
      return (
        <span ref={ref} data-probe="probe">
          treść
        </span>
      );
    }
    const t = await hydrate(
      <Island chunks={[() => chunk.promise]}>
        <Probe />
      </Island>,
    );
    const seen: Array<string | null> = [];
    const observer = new MutationObserver(() => seen.push(t.state()));
    observer.observe(t.island(), { attributes: true, attributeFilter: [ISLAND_STATE_ATTR] });

    expect(t.state()).toBe("pending");
    await reachQuiescence();
    // Wyzwolona, ale chunk nie przyszedł: bramka zamknięta, stan bez zmian.
    expect(t.state()).toBe("pending");
    expect(stateAtContentCommit).toBeNull();

    await act(async () => {
      chunk.resolve();
      await chunk.promise;
    });
    await flushMicrotasks();
    observer.disconnect();

    // W chwili commitu treści otoczka jeszcze `pending`; zaraz potem `hydrated`.
    expect(stateAtContentCommit).toBe("pending");
    expect(t.state()).toBe("hydrated");
    expect(seen).toEqual(["hydrated"]);
    for (const value of seen) expect(ISLAND_STATES).toContain(value);
    expect(t.lost()).toEqual([]);
    expect(t.errors).toEqual([]);
  });

  it("po otwarciu: hydratacja bez rozjazdu, te same węzły, handler działa", async () => {
    const t = await hydrate(<Island />);
    expect(commits).toEqual([]);

    await reachQuiescence();

    expect(commits).toEqual(["a"]);
    expect(t.state()).toBe("hydrated");
    expect(t.lost()).toEqual([]);
    expect(t.errors).toEqual([]);
    clickNow(t.probe("a-button"));
    expect(clicks).toEqual(["a"]);
  });

  it("świeży montaż (nawigacja SPA): treść od razu, bez fallbacku i bez wyzwalaczy", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    cleanups.push(async () => {
      await act(async () => root.unmount());
      container.remove();
    });

    await act(async () => {
      root.render(<Island trigger={{ visible: {}, interaction: "any", globalKeys: ["/"] }} />);
    });

    expect(container.querySelector("article")).not.toBeNull();
    expect(container.querySelector("[data-island-fallback]")).toBeNull();
    expect(container.querySelector("[data-island-id]")?.getAttribute(ISLAND_STATE_ATTR)).toBe(
      "hydrated",
    );
    expect(commits).toEqual(["a"]);
    expect(enqueue).not.toHaveBeenCalled();
    expect(onQuiescent).not.toHaveBeenCalled();
    expect(FakeIntersectionObserver.instances).toHaveLength(0);
  });

  it("`disabled` i kanwa buildera: dzieci wprost, bez otoczki, granicy i wyzwalaczy", async () => {
    const disabled = serverHtml(
      <HydrationIsland id="x" disabled>
        <Content name="x" />
      </HydrationIsland>,
    );
    const inEditor = serverHtml(
      <BuilderModeProvider mode="light">
        <Island id="y" />
      </BuilderModeProvider>,
    );
    expect(disabled).not.toContain("data-island-id");
    expect(disabled).not.toContain("<!--$-->");
    expect(inEditor).not.toContain("data-island-id");

    const t = await hydrate(
      <HydrationIsland id="x" disabled>
        <Content name="x" />
      </HydrationIsland>,
    );
    expect(commits).toEqual(["x"]);
    expect(t.lost()).toEqual([]);
    expect(onQuiescent).not.toHaveBeenCalled();
  });
});

// --- Aktualizacje przed otwarciem bramki --------------------------------------

describe("HTML serwera zachowany przy aktualizacjach przed otwarciem bramki", () => {
  it("Sync i Default rodzica, zapytanie i i18n nad wyspą, urządzenie z magazynu: wyspa nietknięta i zamknięta; po otwarciu bez rozjazdu, potem urządzenie klienta", async () => {
    installMatchMedia(() => false); // telefon: żaden próg min-width nie pasuje
    const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity } } });
    queryClient.setQueryData(["counter"], 1);
    queryClient.setQueryData(["island-data"], "stałe dane");
    const i18n = createI18n();
    let bump: () => void = () => {};

    function Nav(): ReactElement {
      const { t } = useTranslation();
      const { data } = useQuery({ queryKey: ["counter"], queryFn: () => 0 });
      const device = useViewportDevice();
      return (
        <nav data-probe="nav">
          {t("nav")} {String(data)} {device}
        </nav>
      );
    }
    function IslandContent(): ReactElement {
      const { data } = useQuery({ queryKey: ["island-data"], queryFn: () => "?" });
      const device = useViewportDevice();
      return (
        <section data-probe="content">
          <p data-probe="data">{String(data)}</p>
          <p data-probe="device">{device}</p>
        </section>
      );
    }
    function App(): ReactElement {
      const [count, setCount] = useState(0);
      bump = () => setCount((value) => value + 1);
      return (
        <QueryClientProvider client={queryClient}>
          <I18nextProvider i18n={i18n}>
            <Nav />
            <output data-probe="count">{count}</output>
            <Island>
              <IslandContent />
            </Island>
          </I18nextProvider>
        </QueryClientProvider>
      );
    }

    const t = await hydrate(<App />);
    await act(async () => {
      flushSync(() => bump()); // Sync (SyncLane)
      bump(); // Default (setState bez zdarzenia i bez przejścia)
      queryClient.setQueryData(["counter"], 2); // uSES react-query
      await i18n.changeLanguage("en");
      publishViewportDevice("mobile");
      await new Promise((resolve) => setTimeout(resolve, 10));
    });

    // Nad wyspą wszystko się zaktualizowało...
    expect(t.container.querySelector("nav")?.textContent).toBe("Menu EN 2 mobile");
    expect(t.container.querySelector("output")?.textContent).toBe("2");
    // ...a wyspa czeka nietknięta: bez renderu klienta, bez próby hydratacji.
    expect(t.lost()).toEqual([]);
    expect(t.fallbackShown()).toBe(false);
    expect(t.state()).toBe("pending");
    expect(consoleWarn).not.toHaveBeenCalled();
    expect(t.container.querySelector('[data-probe="device"]')?.textContent).toBe("desktop");

    await reachQuiescence();
    expect(t.state()).toBe("hydrated");
    expect(t.lost()).toEqual([]);
    expect(t.errors).toEqual([]);
    // Lustro: najpierw `desktop` jak serwer, potem urządzenie klienta w przejściu.
    expect(t.container.querySelector('[data-probe="device"]')?.textContent).toBe("mobile");
    queryClient.clear();
  });

  it("przejście z kontekstem nad wyspą (auth, motyw): HTML zachowany, wyspa otwiera się przez kolejkę (górna granica), potem przejście dochodzi do skutku", async () => {
    const Theme = createContext("light");
    const Auth = createContext<string | null>(null);
    let setTheme: (theme: string) => void = () => {};
    let setUser: (user: string | null) => void = () => {};
    function Badge(): ReactElement {
      return (
        <span data-probe="badge">
          {useContext(Theme)} {useContext(Auth) ?? "anon"}
        </span>
      );
    }
    function IslandContent(): ReactElement {
      return (
        <p data-probe="island-theme">
          {useContext(Theme)} {useContext(Auth) ?? "anon"}
        </p>
      );
    }
    function App(): ReactElement {
      const [theme, applyTheme] = useState("light");
      const [user, applyUser] = useState<string | null>(null);
      setTheme = applyTheme;
      setUser = applyUser;
      return (
        <Theme value={theme}>
          <Auth value={user}>
            <Badge />
            <Island trigger={{ quiescent: false }}>
              <IslandContent />
            </Island>
          </Auth>
        </Theme>
      );
    }

    const t = await hydrate(<App />);
    await act(async () => {
      startTransition(() => {
        setTheme("dark");
        setUser("ala");
      });
      await new Promise((resolve) => setTimeout(resolve, 10));
    });

    // Przejście czeka na odwodnioną wyspę - NA CAŁEJ STRONIE (React nie wie,
    // czy treść wyspy czyta zmieniony kontekst). HTML wyspy nietknięty.
    expect(t.container.querySelector('[data-probe="badge"]')?.textContent).toBe("light anon");
    expect(t.lost()).toEqual([]);
    expect(t.state()).toBe("pending");
    // Górna granica: wyspa otwiera się przez kolejkę (nie synchronicznie).
    expect(enqueueCalls()).toContainEqual({
      priority: "island-target",
      release: "immediate",
      target: t.island(),
    });
    expect(consoleWarn).toHaveBeenCalledTimes(1);
    expect(String(consoleWarn.mock.calls[0]?.[0])).toContain('"a"');

    await frame();

    expect(t.state()).toBe("hydrated");
    expect(t.lost()).toEqual([]);
    expect(t.errors).toEqual([]);
    expect(t.container.querySelector('[data-probe="badge"]')?.textContent).toBe("dark ala");
    expect(t.container.querySelector('[data-probe="island-theme"]')?.textContent).toBe("dark ala");
  });

  it("kilkoro dzieci, fragment, zagnieżdżone elementy i obiekt `style`: re-render rodzica (Sync i Default) kończy się na wyspie; po otwarciu bez rozjazdu", async () => {
    let bump: () => void = () => {};
    function App(): ReactElement {
      const [count, setCount] = useState(0);
      bump = () => setCount((value) => value + 1);
      return (
        <>
          <output data-probe="count">{count}</output>
          <HydrationIsland id="multi" trigger={{ quiescent: false }}>
            <p data-probe="p1">jeden</p>
            <>
              <p data-probe="p2" style={{ marginTop: 4 }}>
                dwa
              </p>
              <Content name="c">
                <em data-probe="em">zagnieżdżone</em>
              </Content>
            </>
          </HydrationIsland>
        </>
      );
    }

    const t = await hydrate(<App />);
    await act(async () => {
      flushSync(() => bump()); // Sync
    });
    await act(async () => {
      bump(); // Default
    });

    expect(t.container.querySelector("output")?.textContent).toBe("2");
    expect(t.lost()).toEqual([]);
    expect(t.fallbackShown()).toBe(false);
    expect(t.state("multi")).toBe("pending");
    expect(consoleWarn).not.toHaveBeenCalled();

    const button = t.probe("c-button");
    await act(async () => {
      button.dispatchEvent(pointer("pointerdown"));
      await flushMicrotasks();
      button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(clicks).toEqual(["c"]);
    expect(t.state("multi")).toBe("hydrated");
    expect(t.lost()).toEqual([]);
    expect(t.errors).toEqual([]);
  });

  it("warunek dla konsumentów: inline callback w dziecku przepuszcza re-render rodzica (Default) do odwodnionej granicy - HTML porzucony, w DEV ostrzeżenie z `id`", async () => {
    let bump: () => void = () => {};
    function Picker({ onPick }: { onPick: () => void }): ReactElement {
      return (
        <button type="button" data-probe="pick" onClick={onPick}>
          Wybierz
        </button>
      );
    }
    function App(): ReactElement {
      const [count, setCount] = useState(0);
      bump = () => setCount((value) => value + 1);
      return (
        <HydrationIsland id="inline" trigger={{ quiescent: false }}>
          <Picker onPick={() => clicks.push(String(count))} />
        </HydrationIsland>
      );
    }

    const t = await hydrate(<App />);
    await act(async () => {
      bump();
    });

    expect(t.lost()).toContain("pick");
    const warnings = consoleWarn.mock.calls.map(([message]) => String(message));
    expect(warnings).toContainEqual(
      expect.stringContaining('"inline": props changed while the island is pending'),
    );
    // Szkody ograniczone jak przy kontekście: górna granica otwiera wyspę.
    await frame();
    expect(t.state("inline")).toBe("hydrated");
    expect(t.fallbackShown()).toBe(false);

    // Po commicie wyspy nierówne propsy to zwykła aktualizacja - bez ostrzeżeń.
    consoleWarn.mockClear();
    await act(async () => {
      bump();
    });
    expect(consoleWarn).not.toHaveBeenCalled();
  });
});

// --- Kontrole negatywne: MUSZĄ wykryć render klienta --------------------------

describe("kontrole negatywne (uprząż musi wykryć render klienta)", () => {
  /** (b) Urządzenie przez kontekst nad wyspą - tak NIE wolno go dostarczać. */
  function deviceContextCase() {
    const DeviceContext = createContext("desktop");
    const control = { setDevice: (_device: string): void => {} };
    function DeviceText(): ReactElement {
      return <p data-probe="ctx-device">{useContext(DeviceContext)}</p>;
    }
    function App(): ReactElement {
      const [device, apply] = useState("desktop");
      control.setDevice = apply;
      return (
        <DeviceContext value={device}>
          <Island trigger={{ quiescent: false }}>
            <Content>
              <DeviceText />
            </Content>
          </Island>
        </DeviceContext>
      );
    }
    return { App, control };
  }

  it("(b) urządzenie przez kontekst nad wyspą, zmienione synchronicznie (`flushSync`, SyncLane): HTML wyspy porzucony", async () => {
    const { App, control } = deviceContextCase();
    const t = await hydrate(<App />);
    expect(t.lost()).toEqual([]);

    await act(async () => {
      flushSync(() => control.setDevice("mobile"));
    });

    expect(t.lost()).toEqual(expect.arrayContaining(["a-article", "a-button", "ctx-device"]));
    expect(t.fallbackShown()).toBe(true);
    await frame();
    expect(t.fallbackShown()).toBe(false);
    expect(t.state()).toBe("hydrated");
    expect(t.container.querySelector('[data-probe="ctx-device"]')?.textContent).toBe("mobile");
  });

  it("(b) urządzenie przez kontekst nad wyspą, zmienione poza przejściem (Default, `setState` bez zdarzenia): HTML wyspy porzucony", async () => {
    const { App, control } = deviceContextCase();
    const t = await hydrate(<App />);
    expect(t.lost()).toEqual([]);

    await act(async () => {
      control.setDevice("mobile"); // Default - tak NIE wolno dostarczać urządzenia
    });

    expect(t.lost()).toEqual(expect.arrayContaining(["a-article", "a-button", "ctx-device"]));
    expect(t.fallbackShown()).toBe(true);
    // Szkody ograniczone: wyspa otwiera się przez kolejkę i fallback znika po klatce.
    await frame();
    expect(t.fallbackShown()).toBe(false);
    expect(t.state()).toBe("hydrated");
    expect(t.container.querySelector('[data-probe="ctx-device"]')?.textContent).toBe("mobile");
  });

  it("(b) kontrola dodatnia: to samo urządzenie z magazynu (`useViewportDevice` w wyspie) nie rusza HTML", async () => {
    installMatchMedia(() => true);
    function DeviceText(): ReactElement {
      return <p data-probe="store-device">{useViewportDevice()}</p>;
    }
    const t = await hydrate(
      <Island trigger={{ quiescent: false }}>
        <Content>
          <DeviceText />
        </Content>
      </Island>,
    );

    // Treść wyspy czeka, więc nikt w niej nie subskrybuje magazynu - zmiana
    // urządzenia (pomiar i ogłoszenie renderera) nie ma do niej drogi.
    expect(getViewportDevice()).toBe("desktop");
    await act(async () => {
      media("(min-width: 1024px)").change(false);
      publishViewportDevice("mobile");
    });

    expect(t.lost()).toEqual([]);
    expect(t.fallbackShown()).toBe(false);
    expect(t.state()).toBe("pending");
  });

  /**
   * (a) Wyspa uwodniona BEZ zarejestrowanego chunku zagnieżdżonego widgetu
   * (renderer go pominął): zagnieżdżona granica `lazy` zostaje odwodniona.
   * Urządzenie z `useSyncExternalStore` (serwer `desktop`, klient `mobile`)
   * wymusza po hydratacji re-render Sync, który ją niszczy; lustro zawiesza
   * przejście i czeka na chunk.
   */
  function nestedLazyCase(useDevice: () => string) {
    const chunk = deferred<{ default: ComponentType<{ device: string }> }>();
    function Widget({ device }: { device: string }): ReactElement {
      return <p data-probe="nested">Widget {device === "mobile" ? "mobilny" : "desktopowy"}</p>;
    }
    const LazyWidget = lazy(() => chunk.promise);
    function Section({ W }: { W: ComponentType<{ device: string }> }): ReactElement {
      const device = useDevice();
      return (
        <div>
          <span data-probe="section-device">{device}</span>
          <Suspense fallback={<i data-probe="nested-fallback" />}>
            <W device={device} />
          </Suspense>
        </div>
      );
    }
    const server = (
      <Island trigger={{ quiescent: true }}>
        <Section W={Widget} />
      </Island>
    );
    const client = (
      <Island trigger={{ quiescent: true }}>
        <Section W={LazyWidget} />
      </Island>
    );
    return { server, client, chunk, Widget };
  }

  it("(a) wariant `useSyncExternalStore` ze snapshotem serwer/klient i leniwym chunkiem: zagnieżdżony HTML porzucony", async () => {
    const subscribe = () => () => {};
    const { server, client } = nestedLazyCase(() =>
      useSyncExternalStore(
        subscribe,
        () => "mobile",
        () => "desktop",
      ),
    );
    const t = await hydrate(server, client);

    await reachQuiescence();

    expect(t.state()).toBe("hydrated");
    expect(t.lost()).toContain("nested");
    expect(t.container.querySelector('[data-probe="nested-fallback"]')).not.toBeNull();
  });

  it("(a) kontrola dodatnia: lustro `useViewportDevice` zachowuje zagnieżdżony HTML do chunku, potem urządzenie klienta", async () => {
    installMatchMedia(() => false);
    const { server, client, chunk, Widget } = nestedLazyCase(() => useViewportDevice());
    const t = await hydrate(server, client);

    await reachQuiescence();

    expect(t.state()).toBe("hydrated");
    expect(t.lost()).toEqual([]);
    expect(t.container.querySelector('[data-probe="section-device"]')?.textContent).toBe("desktop");

    await act(async () => {
      chunk.resolve({ default: Widget });
      await chunk.promise;
    });

    expect(t.lost()).toEqual([]);
    expect(t.errors).toEqual([]);
    expect(t.container.querySelector('[data-probe="section-device"]')?.textContent).toBe("mobile");
    expect(t.probe("nested").textContent).toBe("Widget mobilny");
  });
});

// --- Bramka po chunkach -------------------------------------------------------

describe("bramka otwiera się dopiero po chunkach", () => {
  it("wyzwolona przed chunkiem: brak hydratacji (klik przepada), po chunku - hydratacja, a zadanie kolejki rozstrzyga się po commicie", async () => {
    const chunk = deferred();
    const t = await hydrate(<Island chunks={[() => chunk.promise]} />);

    const [task] = await reachQuiescence();
    let settled = false;
    void Promise.resolve(task).then(() => {
      settled = true;
    });
    await flushMicrotasks();

    expect(t.state()).toBe("pending");
    expect(settled).toBe(false);
    clickNow(t.probe("a-button"));
    expect(clicks).toEqual([]);
    expect(commits).toEqual([]);

    await act(async () => {
      chunk.resolve();
      await chunk.promise;
    });
    await flushMicrotasks();

    expect(commits).toEqual(["a"]);
    expect(t.state()).toBe("hydrated");
    expect(settled).toBe(true);
    expect(t.lost()).toEqual([]);
    clickNow(t.probe("a-button"));
    expect(clicks).toEqual(["a"]);
  });

  it("odmontowanie w trakcie otwierania: zadanie kolejki kończy się od razu (nie czeka na limit)", async () => {
    const chunk = deferred();
    const t = await hydrate(<Island chunks={[() => chunk.promise]} />);
    const [task] = await reachQuiescence();
    let settled = false;
    void Promise.resolve(task).then(() => {
      settled = true;
    });
    await flushMicrotasks();
    expect(settled).toBe(false);

    await act(async () => t.root.unmount());
    cleanups.length = 0;
    t.container.remove();
    await flushMicrotasks();

    expect(settled).toBe(true);
  });

  it("chunk, który się nie załadował: błąd zgłoszony, bramka i tak się otwiera", async () => {
    const reported = vi.fn();
    vi.stubGlobal("reportError", reported);
    const failure = new Error("chunk 404");
    const t = await hydrate(<Island chunks={[() => Promise.reject(failure)]} />);

    await reachQuiescence();
    await act(async () => {
      await flushMicrotasks();
    });

    expect(reported).toHaveBeenCalledWith(failure);
    expect(t.state()).toBe("hydrated");
    expect(t.lost()).toEqual([]);
  });
});

// --- Leniwe widgety (`React.lazy`) a tor pilny --------------------------------

describe("leniwe widgety w wyspie: komponent `React.lazy` w `chunks` jest gruntowany", () => {
  function Widget(): ReactElement {
    return (
      <button type="button" data-probe="widget" onClick={() => clicks.push("widget")}>
        Zapisz
      </button>
    );
  }

  /** Moduł widgetu już w pamięci: fabryka `lazy` zwraca rozwiązany promise. */
  function lazyWidget() {
    const ready = Promise.resolve({ default: Widget });
    const factory = vi.fn(() => ready);
    return { Lazy: lazy(factory), factory, ready };
  }

  /** Widget we własnej granicy (`withSuspense`): na serwerze statycznie (jak `serverReadingWidgets`). */
  const serverWidget = (
    <Suspense fallback={null}>
      <Widget />
    </Suspense>
  );

  async function hydrateWidget(
    server: ReactNode,
    client: ReactNode,
    chunks: readonly IslandChunk[],
  ): Promise<Hydrated> {
    const trigger: IslandTrigger = { quiescent: false };
    return hydrate(
      <Island id="w" trigger={trigger}>
        {server}
      </Island>,
      <Island id="w" trigger={trigger} chunks={chunks}>
        {client}
      </Island>,
    );
  }

  /** Pierwsze dotknięcie: `pointerdown`, mikrozadania toru pilnego, `click`. */
  async function firstTap(target: Element, microtasks: "one" | "all"): Promise<void> {
    await act(async () => {
      target.dispatchEvent(pointer("pointerdown"));
      if (microtasks === "one") await Promise.resolve();
      else await flushMicrotasks();
      target.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
  }

  it("widget we własnej granicy (`withSuspense`), komponent `lazy` w `chunks`: pierwszy klik dochodzi, fabryka wołana raz", async () => {
    const { Lazy, factory } = lazyWidget();
    const t = await hydrateWidget(
      serverWidget,
      <Suspense fallback={<i data-probe="widget-fallback" />}>
        <Lazy />
      </Suspense>,
      [Lazy],
    );

    await firstTap(t.probe("widget"), "all");

    expect(clicks).toEqual(["widget"]);
    expect(factory).toHaveBeenCalledTimes(1);
    expect(t.state("w")).toBe("hydrated");
    expect(t.lost()).toEqual([]);
    expect(t.errors).toEqual([]);
  });

  it("`lazy` wprost w wyspie (bez własnej granicy), komponent w `chunks`: bramka czeka na rozstrzygnięcie `lazy`, wyspa hydratuje w jednym przebiegu, pierwszy klik dochodzi", async () => {
    const module = deferred<{ default: () => ReactElement }>();
    const factory = vi.fn(() => module.promise);
    const Lazy = lazy(factory);
    let renders = 0;
    function Counted(): null {
      renders += 1;
      return null;
    }
    const t = await hydrateWidget(
      <>
        <Counted />
        <Widget />
      </>,
      <>
        <Counted />
        <Lazy />
      </>,
      [Lazy],
    );
    renders = 0; // bez renderu serwera
    const button = t.probe("widget");

    await act(async () => {
      button.dispatchEvent(pointer("pointerdown"));
      await flushMicrotasks();
      // Tor pilny zagruntował `lazy` (fabryka wołana przez wyspę), moduł
      // jeszcze nie doszedł: bramka zamknięta, treść wyspy nietknięta.
      expect(factory).toHaveBeenCalledTimes(1);
      expect(renders).toBe(0);
      module.resolve({ default: Widget });
      await flushMicrotasks();
      button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(clicks).toEqual(["widget"]);
    // Jeden przebieg: render treści nie trafił na `lazy` bez statusu.
    expect(renders).toBe(1);
    expect(factory).toHaveBeenCalledTimes(1);
    expect(t.state("w")).toBe("hydrated");
    expect(t.lost()).toEqual([]);
    expect(t.errors).toEqual([]);
  });

  it("kontrola negatywna: loader zamiast komponentu `lazy` (moduł w pamięci, ale payload `lazy` nieustalony) gubi pierwszy klik", async () => {
    const { Lazy, factory } = lazyWidget();
    const t = await hydrateWidget(
      serverWidget,
      <Suspense fallback={<i data-probe="widget-fallback" />}>
        <Lazy />
      </Suspense>,
      [factory],
    );

    await firstTap(t.probe("widget"), "all");

    // Wyspa uwodniona, ale hydratacja synchroniczna granicy widgetu trafiła na
    // `lazy` bez statusu - React zwinął pracę i zatrzymał klik.
    expect(clicks).toEqual([]);
    expect(t.state("w")).toBe("hydrated");

    // Granica widgetu hydratuje później (ponowienie po rozwiązaniu `lazy`).
    await frame();
    clickNow(t.probe("widget"));
    expect(clicks).toEqual(["widget"]);
    expect(t.lost()).toEqual([]);
  });

  it("`lazy` rozwiązany wcześniej (np. przez inną wyspę): tor pilny otwiera bramkę w tym samym mikrozadaniu", async () => {
    const { Lazy, ready } = lazyWidget();
    const elsewhere = document.createElement("div");
    const other = createRoot(elsewhere);
    await act(async () => {
      other.render(
        <Suspense fallback={null}>
          <Lazy />
        </Suspense>,
      );
    });
    await act(async () => {
      await ready;
    });
    cleanups.push(async () => {
      await act(async () => other.unmount());
    });
    const t = await hydrateWidget(
      serverWidget,
      <Suspense fallback={null}>
        <Lazy />
      </Suspense>,
      [Lazy],
    );

    await firstTap(t.probe("widget"), "one");

    expect(clicks).toEqual(["widget"]);
    expect(t.lost()).toEqual([]);
    expect(t.errors).toEqual([]);
  });

  it("wpis `chunks`, który nie jest loaderem ani `React.lazy`: TypeError zgłoszony, bramka i tak się otwiera", async () => {
    const reported = vi.fn();
    vi.stubGlobal("reportError", reported);
    const notLazy = { $$typeof: Symbol.for("react.memo"), _result: null };
    const t = await hydrate(<Island chunks={[notLazy]} />);

    await reachQuiescence();
    await act(async () => {
      await flushMicrotasks();
    });

    expect(reported).toHaveBeenCalledWith(expect.any(TypeError));
    expect(t.state()).toBe("hydrated");
    expect(t.lost()).toEqual([]);
  });
});

// --- Wyzwalacze ---------------------------------------------------------------

describe("wyzwalacze i zwolnienie przez kolejkę P0.3", () => {
  it("visible: IO na `[data-sec-id]`, wpis `islands`/`immediate`, bez otwarcia w callbacku", async () => {
    const t = await hydrate(
      <Island trigger={{ visible: { rootMargin: "0px 0px 100% 0px" } }}>
        <section data-sec-id="s1">
          <Content />
        </section>
      </Island>,
    );
    const [observer] = FakeIntersectionObserver.instances;
    expect(observer?.options.rootMargin).toBe("0px 0px 100% 0px");
    expect(observer?.observed.map((node) => node.getAttribute("data-sec-id"))).toEqual(["s1"]);

    act(() => observer?.emit(false));
    expect(enqueue).not.toHaveBeenCalled();

    act(() => observer?.emit(true));
    expect(enqueueCalls()).toEqual([
      { priority: "islands", release: "immediate", target: t.island() },
    ]);
    expect(observer?.disconnected).toBe(true);
    clickNow(t.probe("a-button"));
    expect(clicks).toEqual([]);

    await frame();
    expect(t.state()).toBe("hydrated");
    expect(t.lost()).toEqual([]);
  });

  it("visible bez `[data-sec-id]`: IO obserwuje dzieci otoczki", async () => {
    await hydrate(<Island trigger={{ visible: {} }} />);
    const [observer] = FakeIntersectionObserver.instances;
    expect(observer?.options.rootMargin).toBe("0px");
    expect(observer?.observed.map((node) => node.tagName)).toEqual(["ARTICLE"]);
  });

  it("visible przy treści bez elementów: IO obserwuje samą otoczkę, w DEV ostrzeżenie z `id` (`display: contents` się nie przetnie)", async () => {
    const t = await hydrate(
      <HydrationIsland id="txt" trigger={{ visible: {} }}>
        sam tekst
      </HydrationIsland>,
    );
    const [observer] = FakeIntersectionObserver.instances;
    expect(observer?.observed).toEqual([t.island("txt")]);
    expect(consoleWarn).toHaveBeenCalledTimes(1);
    expect(String(consoleWarn.mock.calls[0]?.[0])).toContain('"txt"');
  });

  it('interaction "any": wpis `islands` z celem czeka na pierwszą interakcję gdziekolwiek', async () => {
    const t = await hydrate(<Island trigger={{ interaction: "any", ownEvents: [] }} />);
    expect(enqueueCalls()).toEqual([
      { priority: "islands", release: "interaction", target: t.island() },
    ]);

    await frame();
    await frame();
    expect(t.state()).toBe("pending");

    await tap(document.body);
    clickNow(t.probe("a-button")); // interakcja zwolniła wpis, ale bramka czeka na klatkę
    expect(clicks).toEqual([]);
    await frame();
    expect(t.state()).toBe("hydrated");
    expect(t.lost()).toEqual([]);
  });

  it("własne zdarzenie (domyślnie `pointerdown`): tor pilny, bramka z `status` przed `click` - klik trafia w uwodniony przycisk", async () => {
    const t = await hydrate(<Island />);
    const button = t.probe("a-button");

    await act(async () => {
      button.dispatchEvent(pointer("pointerdown"));
      // W handlerze nic się nie otwiera - tylko wpis toru pilnego.
      expect(enqueueCalls()).toEqual([
        { priority: "island-target", release: "urgent", target: t.island() },
      ]);
      expect(commits).toEqual([]);
      // Mikrozadanie toru pilnego, potem `click` - React uwadnia synchronicznie.
      await Promise.resolve();
      button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      expect(clicks).toEqual(["a"]);
    });

    expect(t.state()).toBe("hydrated");
    expect(t.lost()).toEqual([]);
    expect(t.errors).toEqual([]);
  });

  it("własne zdarzenie poza wyspą nic nie robi; `focusin` i `keydown` w środku - tor pilny", async () => {
    const t = await hydrate(<Island />);
    const outside = document.createElement("button");
    document.body.append(outside);

    await act(async () => {
      outside.dispatchEvent(pointer("pointerdown"));
      outside.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    });
    expect(enqueue).not.toHaveBeenCalled();

    await act(async () => {
      t.probe("a-button").dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    });
    expect(enqueueCalls()).toEqual([
      { priority: "island-target", release: "urgent", target: t.island() },
    ]);
    expect(t.state()).toBe("hydrated");
  });

  it("`ownEvents` pointerover/touchstart: tor pilny; zdarzenie spoza listy nie zakłada wpisu pilnego", async () => {
    const t = await hydrate(<Island trigger={{ ownEvents: ["pointerover", "touchstart"] }} />);
    await act(async () => {
      t.probe("a-title").dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "a" }));
    });
    expect(enqueueCalls().filter((call) => call.release === "urgent")).toEqual([]);

    await act(async () => {
      t.probe("a-title").dispatchEvent(pointer("pointerover"));
    });
    expect(enqueueCalls().filter((call) => call.release === "urgent")).toEqual([
      { priority: "island-target", release: "urgent", target: t.island() },
    ]);
    expect(t.state()).toBe("hydrated");
  });

  it("`ownEvents` touchstart otwiera wyspę torem pilnym", async () => {
    const t = await hydrate(<Island trigger={{ ownEvents: ["touchstart"] }} />);
    await act(async () => {
      t.probe("a-button").dispatchEvent(new Event("touchstart", { bubbles: true }));
    });
    expect(enqueueCalls()).toEqual([
      { priority: "island-target", release: "urgent", target: t.island() },
    ]);
    expect(t.state()).toBe("hydrated");
  });

  it('globalKeys ["/"]: klawisz poza polem edycji -> `island-target`/`immediate`; w polu, z Ctrl i inny klawisz - nic', async () => {
    const t = await hydrate(<Island trigger={{ globalKeys: ["/"], interaction: false }} />);
    const input = document.createElement("input");
    document.body.append(input);
    const press = (target: EventTarget, init: KeyboardEventInit) =>
      act(() => {
        target.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, ...init }));
      });

    press(input, { key: "/" });
    press(document.body, { key: "/", ctrlKey: true });
    press(document.body, { key: "k" });
    expect(enqueue).not.toHaveBeenCalled();

    press(document.body, { key: "/" });
    expect(enqueueCalls()).toEqual([
      { priority: "island-target", release: "immediate", target: t.island() },
    ]);
    await flushMicrotasks();
    clickNow(t.probe("a-button")); // bramka nadal zamknięta: React nie uwodni synchronicznie
    expect(clicks).toEqual([]);

    await frame();
    expect(t.state()).toBe("hydrated");
    expect(t.lost()).toEqual([]);
  });

  it("media pasujące przy montażu: otwarcie od razu (hydratacja jak bez wyspy), bez wyzwalaczy", async () => {
    installMatchMedia((query) => query === "(min-width: 1024px)");
    const t = await hydrate(
      <Island trigger={{ media: "(min-width: 1024px)", interaction: false, quiescent: false }} />,
    );
    expect(t.state()).toBe("hydrated");
    expect(commits).toEqual(["a"]);
    expect(enqueue).not.toHaveBeenCalled();
    expect(t.lost()).toEqual([]);
  });

  it("media, które zaczyna pasować: `islands`/`immediate`; przestaje pasować - nic", async () => {
    installMatchMedia(() => false);
    const t = await hydrate(
      <Island trigger={{ media: "(min-width: 1024px)", interaction: false, quiescent: false }} />,
    );
    act(() => media("(min-width: 1024px)").change(false));
    expect(enqueue).not.toHaveBeenCalled();

    act(() => media("(min-width: 1024px)").change(true));
    expect(enqueueCalls()).toEqual([
      { priority: "islands", release: "immediate", target: t.island() },
    ]);
    await flushMicrotasks();
    clickNow(t.probe("a-button"));
    expect(clicks).toEqual([]);
    await frame();
    expect(t.state()).toBe("hydrated");
  });

  it("immediateWhen: `true` = otwarcie od razu; z chunkami - po chunkach, bez kolejki", async () => {
    const t = await hydrate(<Island id="now" trigger={{ immediateWhen: () => true }} />);
    expect(t.state("now")).toBe("hydrated");
    expect(enqueue).not.toHaveBeenCalled();
    expect(onQuiescent).not.toHaveBeenCalled();

    const chunk = deferred();
    const u = await hydrate(
      <Island id="later" trigger={{ immediateWhen: () => true }} chunks={[() => chunk.promise]} />,
    );
    expect(u.state("later")).toBe("pending");
    await act(async () => {
      chunk.resolve();
      await chunk.promise;
    });
    expect(u.state("later")).toBe("hydrated");
    expect(enqueue).not.toHaveBeenCalled();
  });

  it("immediateWhen rzucające: błąd zgłoszony, wyspa czeka na zwykłe wyzwalacze", async () => {
    const reported = vi.fn();
    vi.stubGlobal("reportError", reported);
    const t = await hydrate(
      <Island
        trigger={{
          immediateWhen: () => {
            throw new Error("magazyn niedostępny");
          },
        }}
      />,
    );
    expect(reported).toHaveBeenCalledTimes(1);
    expect(t.state()).toBe("pending");
    expect(activeQuiescenceConsumers()).toBe(1);
  });

  it("quiescent: domyślnie zapas `onQuiescent(open, {priority: islands})`; `false` - bez zapasu", async () => {
    await hydrate(<Island id="q1" />);
    expect(vi.mocked(onQuiescent).mock.calls.map(([, options]) => options)).toEqual([
      { priority: "islands" },
    ]);
    vi.mocked(onQuiescent).mockClear();
    await hydrate(<Island id="q2" trigger={{ quiescent: false }} />);
    expect(onQuiescent).not.toHaveBeenCalled();
  });

  it("pierwszy wyzwalacz zdejmuje pozostałe (IO, interakcja, klawisze, media, cisza)", async () => {
    installMatchMedia(() => false);
    const t = await hydrate(
      <Island
        trigger={{
          visible: {},
          interaction: "any",
          globalKeys: ["/"],
          media: "(min-width: 1024px)",
        }}
      />,
    );
    const [observer] = FakeIntersectionObserver.instances;
    act(() => observer?.emit(true));
    await frame();
    expect(t.state()).toBe("hydrated");
    expect(commits).toEqual(["a"]);

    vi.mocked(enqueue).mockClear();
    expect(activeQuiescenceConsumers()).toBe(0);
    expect(media("(min-width: 1024px)").listeners.size).toBe(0);
    act(() => {
      document.body.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "/" }));
    });
    await tap(document.body);
    await frame();
    expect(enqueue).not.toHaveBeenCalled();
    expect(commits).toEqual(["a"]);
  });

  it("próby hydratacji wywołane przez Reacta (klik i `pointerover` na czekającej wyspie) nie otwierają jej - górna granica dotyczy tylko renderu klienta", async () => {
    const t = await hydrate(<Island trigger={{ interaction: false, quiescent: false }} />);

    clickNow(t.probe("a-button")); // React: hydratacja synchroniczna, bramka zamknięta
    await act(async () => {
      t.probe("a-title").dispatchEvent(pointer("pointerover")); // powtórka zdarzenia ciągłego
    });
    await frame();
    await frame();

    expect(clicks).toEqual([]);
    expect(enqueue).not.toHaveBeenCalled();
    expect(consoleWarn).not.toHaveBeenCalled();
    expect(t.state()).toBe("pending");
    expect(t.lost()).toEqual([]);
  });

  it("odmontowanie przed otwarciem zdejmuje wyzwalacze", async () => {
    installMatchMedia(() => false);
    const t = await hydrate(
      <Island trigger={{ visible: {}, globalKeys: ["/"], media: "(min-width: 1024px)" }} />,
    );
    const wrapper = t.island();
    const button = t.probe("a-button");
    await act(async () => t.root.unmount());
    cleanups.length = 0;
    t.container.append(wrapper);

    expect(FakeIntersectionObserver.instances[0]?.disconnected).toBe(true);
    expect(activeQuiescenceConsumers()).toBe(0);
    expect(media("(min-width: 1024px)").listeners.size).toBe(0);
    act(() => {
      button.dispatchEvent(pointer("pointerdown"));
      document.body.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "/" }));
    });
    expect(enqueue).not.toHaveBeenCalled();
    t.container.remove();
  });
});

// --- Kolejność przez prawdziwą kolejkę ---------------------------------------

describe("kolejność zwalniania przez kolejkę P0.3", () => {
  it("wyspa pod palcem pierwsza, potem pozostałe po jednej na klatkę - następna dopiero po commicie poprzedniej", async () => {
    const chunk = deferred();
    const any: IslandTrigger = { interaction: "any", ownEvents: [], quiescent: false };
    const t = await hydrate(
      <>
        <Island id="i1" trigger={any} />
        <Island id="i2" trigger={any} chunks={[() => chunk.promise]} />
        <Island id="i3" trigger={any} />
      </>,
    );

    await tap(t.probe("i2-title"));
    await frame();
    // i2 (pod palcem) wystartowała pierwsza, ale czeka na chunk i trzyma kolejkę.
    expect([t.state("i1"), t.state("i2"), t.state("i3")]).toEqual([
      "pending",
      "pending",
      "pending",
    ]);
    await frame();
    expect(commits).toEqual([]);

    await act(async () => {
      chunk.resolve();
      await chunk.promise;
    });
    await flushMicrotasks();
    expect(commits).toEqual(["i2"]);

    await frame();
    expect(commits).toEqual(["i2", "i1"]);
    await frame();
    expect(commits).toEqual(["i2", "i1", "i3"]);
    expect(t.lost()).toEqual([]);
    expect(t.errors).toEqual([]);
  });
});

// --- StrictMode, tor pilny, ograniczenia -------------------------------------

describe("StrictMode i kontrakty Reacta", () => {
  it("StrictMode: podwójny render i efekty nie otwierają wyspy przedwcześnie", async () => {
    const t = await hydrate(
      <StrictMode>
        <Island />
      </StrictMode>,
    );
    await flushMicrotasks();
    expect(t.state()).toBe("pending");
    expect(consoleWarn).not.toHaveBeenCalled();
    expect(activeQuiescenceConsumers()).toBe(1);

    await reachQuiescence();
    expect(t.state()).toBe("hydrated");
    expect(t.lost()).toEqual([]);
    expect(t.errors).toEqual([]);
  });

  it("dlaczego `status` synchronicznie: zwykły promise rozwiązany tuż przed `click` gubi klik", async () => {
    // Model React-a bez wyspy: `use(promise)` w granicy, promise rozwiązany w
    // mikrozadaniu po `pointerdown` (jak tor pilny), `click` zaraz potem.
    function Gate({ gate, children }: { gate: Promise<void>; children: ReactNode }): ReactNode {
      use(gate);
      return children;
    }
    function View({ gate }: { gate: Promise<void> }): ReactElement {
      return (
        <Suspense fallback={null}>
          <Gate gate={gate}>
            <button type="button" data-probe="plain" onClick={() => clicks.push("plain")}>
              x
            </button>
          </Gate>
        </Suspense>
      );
    }
    const open = deferred();
    const ready = Object.assign(Promise.resolve(), { status: "fulfilled", value: undefined });
    const t = await hydrate(<View gate={ready} />, <View gate={open.promise} />);
    await act(async () => {
      queueMicrotask(() => open.resolve());
      await Promise.resolve();
      t.probe("plain").dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(clicks).toEqual([]);
  });

  it("ograniczenie dla P2.2: dane zapytania czytane W wyspie, zmienione przed otwarciem, kończą się rozjazdem hydratacji", async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity } } });
    queryClient.setQueryData(["island-data"], "serwer");
    function IslandContent(): ReactElement {
      const { data } = useQuery({ queryKey: ["island-data"], queryFn: () => "?" });
      return <p data-probe="data">{String(data)}</p>;
    }
    const view = (
      <QueryClientProvider client={queryClient}>
        <Island>
          <IslandContent />
        </Island>
      </QueryClientProvider>
    );
    const t = await hydrate(view);
    await act(async () => {
      queryClient.setQueryData(["island-data"], "odświeżone");
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
    expect(t.lost()).toEqual([]);

    await reachQuiescence();

    expect(t.errors.length).toBeGreaterThan(0);
    expect(t.lost()).toContain("data");
    queryClient.clear();
  });

  it("ograniczenie dla P2.2/P2.3: język zmieniony przed otwarciem wyspy, której treść tłumaczy, też kończy się rozjazdem", async () => {
    const i18n = createI18n();
    function IslandContent(): ReactElement {
      const { t } = useTranslation();
      return <p data-probe="label">{t("nav")}</p>;
    }
    const t = await hydrate(
      <I18nextProvider i18n={i18n}>
        <Island>
          <IslandContent />
        </Island>
      </I18nextProvider>,
    );
    await act(async () => {
      await i18n.changeLanguage("en");
    });
    expect(t.lost()).toEqual([]);

    await reachQuiescence();

    expect(t.errors.length).toBeGreaterThan(0);
    expect(t.lost()).toContain("label");
    expect(t.container.querySelector('[data-probe="label"]')?.textContent).toBe("Menu EN");
  });
});
