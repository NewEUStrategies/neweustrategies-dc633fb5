// HYDRATACJA Z `AuthProvider` - HTML SERWERA, GRANICE SUSPENSE I ROZRUCH GOŚCIA.
//
// CO TEN PLIK DOWODZI.
//   1. Treść serwera zostaje, gdy sesja gościa rozstrzyga się, zanim dojedzie
//      chunk widgetu (kontrakt sprzed P1.7).
//   2. ROZRUCH GOŚCIA DZIELI HYDRATACJĘ GRANIC NA COMMITY (P1.7, runda 9 -
//      test charakterystyki, nie dowód wymogu I2). Gość dostaje rozstrzygnięcie
//      zmianą wartości kontekstu w przejściu, a React propaguje ją do każdej
//      odwodnionej granicy i uwadnia je po jednej, każdą we własnym commicie.
//      Stała wartość kontekstu przy boocie (wymóg I2 z recenzji P1.6, wariant
//      zmierzony i wycofany z P1.7) skleja te same granice w JEDEN commit z
//      jednym przebiegiem efektów pasywnych - na `/` dawało to dłuższe zadania
//      po commicie hydratacji (+74 ms mobile, +241 ms desktop x4 blokowania
//      skryptów w medianach dowodu). KONTROLA NEGATYWNA: prowajder ze stałą
//      wartością oblewa tę samą asercję. Kto wprowadzi stałą wartość (P2.2,
//      razem z wyspami), zmienia ten test świadomie i z pomiarem.
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
  useLayoutEffect,
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

describe("rozruch gościa a podział hydratacji granic (P1.7, runda 9)", () => {
  it("AuthProvider: każda granica we własnym commicie, HTML serwera zostaje, zero dotknięć klienta", async () => {
    const report = await measureBoundaryCommits({ Provider: AuthProvider, useValue: useAuth });

    expectSplitHydration(report);
    expect(report.serverHtmlKept).toBe(true);
    expect(report.errors).toEqual([]);
    expect(report.readerText).toBe("gość");
    expect(h.touches).toBe(0);
  });

  it("kontrola negatywna: stała wartość kontekstu skleja granice w jeden commit", async () => {
    const report = await measureBoundaryCommits({
      Provider: FrozenProvider,
      useValue: () => useContext(FrozenCtx),
    });

    expect(report.boundaries).toBe(BOUNDARIES);
    expect(report.boundaryCommits).toBe(1);
    expect(() => expectSplitHydration(report)).toThrow();
    expect(report.serverHtmlKept).toBe(true);
    expect(report.errors).toEqual([]);
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
