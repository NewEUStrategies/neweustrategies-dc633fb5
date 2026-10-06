// HYDRATACJA Z `AuthProvider` - HTML SERWERA, GRANICE SUSPENSE I ROZRUCH GOŚCIA.
//
// CO TEN PLIK DOWODZI.
//   1. Treść serwera zostaje, gdy sesja gościa rozstrzyga się, zanim dojedzie
//      chunk widgetu (kontrakt sprzed P1.7).
//   2. STAŁA WARTOŚĆ KONTEKSTU PRZY BOOCIE GOŚCIA (wymóg I2, P2.2 - zmienione
//      świadomie). Do P2.2 gość dostawał rozstrzygnięcie zmianą wartości
//      kontekstu w przejściu, a React propagował ją do każdej odwodnionej
//      granicy: uwadniał je po jednej (osobne commity) i budził każdą wyspę
//      hydratacji zaraz po boocie (górna granica w `hydrationIsland.tsx`).
//      Teraz wartość stoi, a gościa rozstrzyga każdy konsument osobno:
//       - test akceptacyjny I2 (szkic `faza2/raporty/P1.7-i2-island-experiment`):
//         wyspa P1.6 pod `AuthProvider` zostaje `pending` > 1 s po boocie,
//         HTML serwera i zero błędów; KONTROLA NEGATYWNA: dostawca ze zmianą
//         wartości przy boocie (jak przed P2.2) budzi tę samą wyspę;
//       - test charakterystyki: granice POZA wyspami uwadniają się jednym
//         commitem, tak jak przy gołej stałej wartości (P1.7 zmierzyła to bez
//         wysp: +74 ms mobile, +241 ms desktop x4 blokowania po commicie
//         hydratacji). Z wyspami w tym commicie zostają tylko granice nad
//         zgięciem - ile to kosztuje, rozstrzyga księga dowodu P2.2;
//       - semantyka konsumenta: czytający `loading` w hydratacji widzi
//         „czekam" (parytet), potem „gość" we własnym przejściu; nieczytający
//         renderuje się raz; świeży montaż po boocie - od razu „gość";
//         pierwsza sesja (logowanie w innej karcie) kończy zamrożenie.
//   3. Gość od startu nie dotyka klienta Supabase (szybka ścieżka F7).
//   4. Konsument czytający `loading` (bramka typu `AuthGate`) hydratuje
//      spinner serwera bez rozjazdu, a po boocie pokazuje gościa - nigdy
//      widoku zalogowanego.
//   5. Zalogowany (sesja w magazynie): SDK od razu, hydratacja bez rozjazdu,
//      sesja dochodzi po odpowiedzi SDK.
import {
  createContext,
  lazy,
  Profiler,
  startTransition,
  Suspense,
  useContext,
  useEffect,
  useLayoutEffect,
  useState,
  type ComponentType,
  type ReactNode,
} from "react";
import { renderToString } from "react-dom/server";
import { hydrateRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  touches: 0,
  getSession: null as null | (() => Promise<{ data: { session: unknown } }>),
}));

vi.mock("@/integrations/supabase/client", async () => {
  const { markSupabaseClientCreated } = await import("@/integrations/supabase/sessionHint");
  const client = {
    rpc: async () => ({ data: null, error: null }),
    auth: {
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
      getSession: () =>
        h.getSession === null ? Promise.resolve({ data: { session: null } }) : h.getSession(),
    },
    from: (table: string) =>
      table === "user_roles"
        ? { select: () => ({ eq: () => Promise.resolve({ data: [] }) }) }
        : {
            select: () => ({
              eq: () => ({ maybeSingle: () => Promise.resolve({ data: null }) }),
            }),
          },
  };
  return {
    supabase: new Proxy(client, {
      get(target, prop, receiver) {
        h.touches += 1;
        markSupabaseClientCreated();
        return Reflect.get(target, prop, receiver);
      },
    }),
  };
});
vi.mock("@/lib/personalization/anonMerge", () => ({
  hasAnonPersonalization: () => false,
  mergeAnonPersonalization: async () => {},
}));

import { AuthProvider, useAuth } from "../useAuth";
import { __resetSupabaseClientRegistryForTests } from "@/integrations/supabase/sessionHint";
import { HydrationIsland } from "@/lib/performance/hydrationIsland";
import { __resetFirstInteractionForTests } from "@/lib/performance/firstInteraction";
import { __resetPostInteractionQueueForTests } from "@/lib/performance/postInteractionQueue";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

beforeEach(() => {
  h.touches = 0;
  h.getSession = null;
  window.localStorage.clear();
  __resetSupabaseClientRegistryForTests();
});

afterEach(() => {
  window.localStorage.clear();
  vi.restoreAllMocks();
});

it("retains server content when the initial anonymous session settles before a widget chunk", async () => {
  function Content() {
    useAuth();
    return <article>Server article</article>;
  }
  function Frame({ Widget }: { Widget: ComponentType }) {
    useAuth();
    return (
      <Suspense fallback={null}>
        <Widget />
      </Suspense>
    );
  }
  const queryClient = new QueryClient();
  const view = (Widget: ComponentType) => (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <Frame Widget={Widget} />
      </AuthProvider>
    </QueryClientProvider>
  );
  const container = document.createElement("div");
  container.innerHTML = renderToString(view(Content));
  document.body.append(container);
  const original = container.querySelector("article");
  let release!: (module: { default: ComponentType }) => void;
  const pending = new Promise<{ default: ComponentType }>((resolve) => {
    release = resolve;
  });
  const Widget = lazy(() => pending);
  const errors: unknown[] = [];
  const root = hydrateRoot(container, view(Widget), { onRecoverableError: (e) => errors.push(e) });
  try {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 350));
    });
    expect(original?.isConnected).toBe(true);
    await act(async () => {
      release({ default: Content });
      await pending;
    });
    expect(container.querySelector("article")).toBe(original);
    expect(errors).toEqual([]);
    // Gość od startu: klient Supabase nietknięty (szybka ścieżka F7).
    expect(h.touches).toBe(0);
  } finally {
    await act(async () => root.unmount());
    queryClient.clear();
    container.remove();
  }
});

// ── ROZRUCH GOŚCIA A PODZIAŁ HYDRATACJI GRANIC NA COMMITY ──────────────────────
//
// Strona w miniaturze: konsumenci w nagłówku (jeden czyta `loading`) i kilka
// granic Suspense z leniwymi widgetami, których chunki są już pobrane, zanim
// ruszy hydratacja (model `modulepreload`). Widget odnotowuje numer commitu,
// w którym się uwodnił (`useLayoutEffect`), a `Profiler` na korzeniu numeruje
// commity. Bez `act`: `act` opróżnia kolejkę Reacta synchronicznie i zaciera
// dokładnie ten podział, więc pomiar idzie na prawdziwym harmonogramie
// (start w `startTransition`, jak domyślne entry TanStack Start).

interface AuthLike {
  loading: boolean;
}

interface BootHarness {
  Provider: ComponentType<{ children: ReactNode }>;
  useValue: () => AuthLike;
}

interface SplitReport {
  boundaries: number;
  /** Ile różnych commitów uwodniło granice. */
  boundaryCommits: number;
  readerText: string | null;
  serverHtmlKept: boolean;
  errors: unknown[];
}

const BOUNDARIES = 6;

async function measureBoundaryCommits({ Provider, useValue }: BootHarness): Promise<SplitReport> {
  const env = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };
  const actEnvironment = env.IS_REACT_ACT_ENVIRONMENT;
  env.IS_REACT_ACT_ENVIRONMENT = false;
  let commit = 0;
  const hydratedAt: number[] = [];
  function Widget({ i }: { i: number }) {
    useValue();
    useLayoutEffect(() => {
      hydratedAt[i] = commit;
    }, [i]);
    return <section data-widget={i}>widget {i}</section>;
  }
  function Reader() {
    return <span id="czytelnik">{useValue().loading ? "czekam" : "gość"}</span>;
  }
  function Quiet() {
    useValue();
    return <span>cichy</span>;
  }
  const chunks = Array.from({ length: BOUNDARIES }, () => {
    const loaded = Promise.resolve({ default: Widget });
    return lazy(() => loaded);
  });
  const queryClient = new QueryClient();
  const view = (server: boolean) => (
    <Profiler id="korzeń" onRender={() => (commit += 1)}>
      <QueryClientProvider client={queryClient}>
        <Provider>
          <Reader />
          <Quiet />
          {chunks.map((Chunk, i) => (
            <Suspense key={i} fallback={null}>
              {server ? <Widget i={i} /> : <Chunk i={i} />}
            </Suspense>
          ))}
        </Provider>
      </QueryClientProvider>
    </Profiler>
  );
  const container = document.createElement("div");
  container.innerHTML = renderToString(view(true));
  commit = 0;
  document.body.append(container);
  const serverNodes = [...container.querySelectorAll("section")];
  const errors: unknown[] = [];
  let root: Root | undefined;
  try {
    startTransition(() => {
      root = hydrateRoot(container, view(false), {
        onRecoverableError: (error) => errors.push(error),
      });
    });
    await sleep(150);
    return {
      boundaries: hydratedAt.filter((at) => at !== undefined).length,
      boundaryCommits: new Set(hydratedAt).size,
      readerText: container.querySelector("#czytelnik")?.textContent ?? null,
      serverHtmlKept: [...container.querySelectorAll("section")].every(
        (node, i) => node === serverNodes[i],
      ),
      errors,
    };
  } finally {
    root?.unmount();
    queryClient.clear();
    container.remove();
    env.IS_REACT_ACT_ENVIRONMENT = actEnvironment;
  }
}

/** Asercja główna: każda granica uwadnia się we własnym commicie. */
function expectSplitHydration(report: SplitReport) {
  expect(report.boundaries).toBe(BOUNDARIES);
  expect(report.boundaryCommits).toBe(BOUNDARIES);
}

/** Wymóg I2 w najczystszej postaci: wartość kontekstu nie zmienia się wcale. */
const FrozenCtx = createContext<AuthLike>({ loading: true });
const FROZEN: AuthLike = { loading: true };
function FrozenProvider({ children }: { children: ReactNode }) {
  return <FrozenCtx.Provider value={FROZEN}>{children}</FrozenCtx.Provider>;
}

/** Dostawca jak przed P2.2: gość rozstrzygany ZMIANĄ wartości kontekstu w przejściu. */
const LegacyCtx = createContext<AuthLike>({ loading: true });
function LegacyProvider({ children }: { children: ReactNode }) {
  const [value, setValue] = useState<AuthLike>({ loading: true });
  useEffect(() => {
    startTransition(() => setValue({ loading: false }));
  }, []);
  return <LegacyCtx.Provider value={value}>{children}</LegacyCtx.Provider>;
}

describe("rozruch gościa a hydratacja granic poza wyspami (I2, P2.2)", () => {
  it("AuthProvider: wartość stała przy boocie - granice uwadniają się jednym commitem (jak goła stała wartość), HTML serwera zostaje, czytelnik „gość”, zero dotknięć klienta", async () => {
    const report = await measureBoundaryCommits({ Provider: AuthProvider, useValue: useAuth });
    const frozen = await measureBoundaryCommits({
      Provider: FrozenProvider,
      useValue: () => useContext(FrozenCtx),
    });

    expect(report.boundaries).toBe(BOUNDARIES);
    expect(report.boundaryCommits).toBe(frozen.boundaryCommits);
    expect(report.boundaryCommits).toBe(1);
    expect(report.serverHtmlKept).toBe(true);
    expect(report.errors).toEqual([]);
    expect(report.readerText).toBe("gość");
    expect(h.touches).toBe(0);
  });

  it("kontrola negatywna: dostawca ze zmianą wartości przy boocie (jak przed P2.2) dzieli granice na osobne commity", async () => {
    const report = await measureBoundaryCommits({
      Provider: LegacyProvider,
      useValue: () => useContext(LegacyCtx),
    });

    expectSplitHydration(report);
    expect(report.serverHtmlKept).toBe(true);
    expect(report.errors).toEqual([]);
  });
});

// ── I2 Z PRAWDZIWĄ WYSPĄ P1.6 (test akceptacyjny P2.2) ─────────────────────────
//
// Szkic: `faza2/raporty/P1.7-i2-island-experiment.test.tsx.txt` (baza: wyspa
// `hydrated` przez górną granicę, ostrzeżenie „an update reached the pending
// island"; I2: `pending` po 1,1 s, HTML zachowany, 0 błędów hydratacji).
describe("I2: wyspa hydratacji pod AuthProvider przy boocie gościa", () => {
  beforeEach(() => {
    __resetFirstInteractionForTests();
    __resetPostInteractionQueueForTests();
  });

  afterEach(() => {
    __resetPostInteractionQueueForTests();
    __resetFirstInteractionForTests();
    vi.unstubAllEnvs();
  });

  async function hydrateWithIsland(Provider: ComponentType<{ children: ReactNode }>) {
    function Header() {
      const { session } = useAuth();
      return <span>{session ? "konto" : "zaloguj"}</span>;
    }
    function LiveSync() {
      const { user, loading } = useAuth();
      return loading || !user ? null : <i />;
    }
    const qc = new QueryClient();
    const app = (
      <QueryClientProvider client={qc}>
        <Provider>
          <Header />
          <LiveSync />
          <HydrationIsland id="s1" trigger={{ quiescent: false }}>
            <p data-probe="sekcja">sekcja</p>
          </HydrationIsland>
        </Provider>
      </QueryClientProvider>
    );
    const c = document.createElement("div");
    vi.stubEnv("SSR", true);
    c.innerHTML = renderToString(app);
    vi.stubEnv("SSR", false);
    document.body.append(c);
    const node = c.querySelector('[data-probe="sekcja"]');
    const errors: unknown[] = [];
    let root!: Root;
    await act(async () => {
      root = hydrateRoot(c, app, { onRecoverableError: (e) => errors.push(e) });
    });
    await act(async () => {
      await sleep(1100);
    });
    const result = {
      state: c.querySelector("[data-island-id]")?.getAttribute("data-island-state"),
      nodeKept: c.querySelector('[data-probe="sekcja"]') === node,
      errors,
    };
    await act(async () => root.unmount());
    qc.clear();
    c.remove();
    return result;
  }

  it("gość: wyspa zostaje `pending` > 1 s po boocie, HTML serwera zachowany, zero błędów i dotknięć klienta", async () => {
    const result = await hydrateWithIsland(AuthProvider);

    expect(result.state).toBe("pending");
    expect(result.nodeKept).toBe(true);
    expect(result.errors).toEqual([]);
    expect(h.touches).toBe(0);
  }, 15_000);

  it("kontrola negatywna: dostawca ze zmianą wartości przy boocie budzi wyspę przez górną granicę", async () => {
    function LegacyAuth({ children }: { children: ReactNode }) {
      return (
        <LegacyProvider>
          <AuthProvider>{children}</AuthProvider>
        </LegacyProvider>
      );
    }
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const result = await hydrateWithIsland(LegacyAuth);

    expect(result.state).toBe("hydrated");
    expect(warn.mock.calls.map(([message]) => String(message))).toContainEqual(
      expect.stringContaining('"s1": an update reached the pending island'),
    );
  }, 15_000);
});

describe("I2: rozstrzygnięcie gościa per konsument", () => {
  it("hydratacja: czytający `loading` widzi „czekam”, potem „gość”; nieczytający renderuje się raz; świeży montaż po boocie - od razu „gość”", async () => {
    const reader: boolean[] = [];
    let quietRenders = 0;
    const late: boolean[] = [];
    let showLate: () => void = () => {};
    function Reader() {
      const { loading } = useAuth();
      reader.push(loading);
      return <span id="czytelnik">{loading ? "czekam" : "gość"}</span>;
    }
    function Quiet() {
      useAuth();
      quietRenders += 1;
      return <span>cichy</span>;
    }
    function Late() {
      const { loading } = useAuth();
      late.push(loading);
      return null;
    }
    function Shell({ withLate }: { withLate: boolean }) {
      const [show, setShow] = useState(false);
      showLate = () => setShow(true);
      return (
        <>
          <Reader />
          <Quiet />
          {withLate && show ? <Late /> : null}
        </>
      );
    }
    const queryClient = new QueryClient();
    const view = (
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <Shell withLate />
        </AuthProvider>
      </QueryClientProvider>
    );
    const container = document.createElement("div");
    container.innerHTML = renderToString(view);
    document.body.append(container);
    reader.length = 0;
    quietRenders = 0;
    const errors: unknown[] = [];
    let root!: Root;
    try {
      await act(async () => {
        root = hydrateRoot(container, view, { onRecoverableError: (e) => errors.push(e) });
      });
      await act(async () => {
        await sleep(20);
      });
      expect(reader[0]).toBe(true);
      expect(reader.at(-1)).toBe(false);
      expect(container.querySelector("#czytelnik")?.textContent).toBe("gość");
      expect(quietRenders).toBe(1);

      await act(async () => showLate());
      expect(late).toEqual([false]);
      expect(errors).toEqual([]);
      expect(h.touches).toBe(0);
    } finally {
      await act(async () => root.unmount());
      queryClient.clear();
      container.remove();
    }
  });

  it("pierwsza sesja (logowanie w innej karcie) kończy zamrożenie: kontekst zmienia się normalnie, konsument widzi użytkownika", async () => {
    h.getSession = () =>
      Promise.resolve({ data: { session: { user: { id: "u-9" }, access_token: "t" } } });
    function Who() {
      const { user, loading } = useAuth();
      return <span id="kto">{loading ? "czekam" : (user?.id ?? "gość")}</span>;
    }
    const queryClient = new QueryClient();
    const view = (
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <Who />
        </AuthProvider>
      </QueryClientProvider>
    );
    const container = document.createElement("div");
    container.innerHTML = renderToString(view);
    document.body.append(container);
    const errors: unknown[] = [];
    let root!: Root;
    try {
      await act(async () => {
        root = hydrateRoot(container, view, { onRecoverableError: (e) => errors.push(e) });
      });
      await act(async () => {
        await sleep(20);
      });
      expect(container.querySelector("#kto")?.textContent).toBe("gość");
      await act(async () => {
        window.localStorage.setItem("sb-placeholder-auth-token", '{"access_token":"t"}');
        window.dispatchEvent(
          new StorageEvent("storage", {
            key: "sb-placeholder-auth-token",
            newValue: '{"access_token":"t"}',
          }),
        );
        await sleep(50);
      });
      expect(container.querySelector("#kto")?.textContent).toBe("u-9");
      expect(errors).toEqual([]);
    } finally {
      await act(async () => root.unmount());
      queryClient.clear();
      container.remove();
    }
  });
});

describe("hydratacja konsumentów `loading`", () => {
  function Gate() {
    const { session, loading } = useAuth();
    if (loading) return <div aria-label="loading" />;
    if (!session) return <a href="/login">Zaloguj się</a>;
    return <p>treść dla zalogowanych</p>;
  }

  async function hydrateGate() {
    const queryClient = new QueryClient();
    const view = (
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <Gate />
        </AuthProvider>
      </QueryClientProvider>
    );
    const container = document.createElement("div");
    container.innerHTML = renderToString(view);
    document.body.append(container);
    const errors: unknown[] = [];
    const seen: string[] = [];
    const observer = new MutationObserver(() => seen.push(container.innerHTML));
    observer.observe(container, { childList: true, subtree: true, characterData: true });
    const root = hydrateRoot(container, view, { onRecoverableError: (e) => errors.push(e) });
    return {
      container,
      errors,
      seen,
      cleanup: async () => {
        observer.disconnect();
        await act(async () => root.unmount());
        queryClient.clear();
        container.remove();
      },
    };
  }

  it("gość: spinner serwera hydratuje bez rozjazdu, po boocie CTA - nigdy widok zalogowanego", async () => {
    const run = await hydrateGate();
    try {
      expect(run.container.querySelector('[aria-label="loading"]')).not.toBeNull();
      await act(async () => {
        await sleep(50);
      });
      expect(run.errors).toEqual([]);
      expect(run.container.querySelector('a[href="/login"]')).not.toBeNull();
      expect(run.seen.join("|")).not.toContain("treść dla zalogowanych");
      expect(h.touches).toBe(0);
    } finally {
      await run.cleanup();
    }
  });

  it("zalogowany (sesja w magazynie): SDK od razu, hydratacja bez rozjazdu, sesja po odpowiedzi SDK", async () => {
    window.localStorage.setItem("sb-placeholder-auth-token", '{"access_token":"t"}');
    let answer!: (value: { data: { session: unknown } }) => void;
    h.getSession = () =>
      new Promise((resolve) => {
        answer = resolve;
      });
    const run = await hydrateGate();
    try {
      await act(async () => {
        await sleep(20);
      });
      expect(h.touches).toBeGreaterThan(0);
      expect(run.container.querySelector('[aria-label="loading"]')).not.toBeNull();
      await act(async () => {
        answer({ data: { session: { user: { id: "u-1" }, access_token: "t" } } });
        await sleep(20);
      });
      expect(run.container.textContent).toContain("treść dla zalogowanych");
      expect(run.errors).toEqual([]);
      // Zalogowany nie widzi CTA logowania po drodze.
      expect(run.seen.join("|")).not.toContain("Zaloguj się");
    } finally {
      await run.cleanup();
    }
  });
});
