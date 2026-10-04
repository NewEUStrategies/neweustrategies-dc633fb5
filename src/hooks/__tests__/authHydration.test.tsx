// HYDRATACJA Z `AuthProvider` - HTML SERWERA, WYSPY I ROZRUCH GOŚCIA.
//
// CO TEN PLIK DOWODZI.
//   1. Treść serwera zostaje, gdy sesja gościa rozstrzyga się, zanim dojedzie
//      chunk widgetu (kontrakt sprzed P1.7).
//   2. ROZRUCH GOŚCIA NIE ZMIENIA WARTOŚCI KONTEKSTU (P1.7, wymóg I2 z recenzji
//      P1.6). React 19 propaguje KAŻDĄ zmianę kontekstu do odwodnionych granic
//      Suspense (nie wie, kto w nich czyta kontekst) i budzi je - tak wyspy
//      hydratacji (P2.2/P2.3) otwierałyby się zaraz po boocie u każdego
//      anonima. Kryterium: przez >= 1 s po boocie odwodniona granica nie jest
//      ponawiana, jej HTML zostaje, wartości widziane przez konsumentów mają tę
//      samą tożsamość, a liczba ich renderów stoi; konsument, który nie czyta
//      `loading`, renderuje się raz (hydratacja), a odczyt po boocie (handler)
//      widzi już gościa. KONTROLA NEGATYWNA: ten sam pomiar na prowajderze,
//      który rozstrzyga gościa zmianą wartości kontekstu w `startTransition`
//      (zachowanie sprzed P1.7), wykrywa przebudowę konsumentów i podmianę
//      ich wartości (szczegóły przy pomiarze niżej).
//   3. Gość od startu nie dotyka klienta Supabase (szybka ścieżka F7).
//   4. Konsument czytający `loading` (bramka typu `AuthGate`) hydratuje
//      spinner serwera bez rozjazdu, a po boocie pokazuje gościa - nigdy
//      widoku zalogowanego.
//   5. Zalogowany (sesja w magazynie): SDK od razu, hydratacja bez rozjazdu,
//      sesja dochodzi po odpowiedzi SDK.
import {
  createContext,
  lazy,
  startTransition,
  Suspense,
  useContext,
  useEffect,
  useLayoutEffect,
  useState,
  useSyncExternalStore,
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

// ── POMIAR ROZRUCHU (wspólny dla prowajdera produkcyjnego i kontroli negatywnej) ──
//
// Wyspę udaje granica Suspense, której treść na kliencie zawiesza się na
// bramce, która się nie otwiera. Treść liczy próby renderu osobno w trybie
// HYDRATACJI i w trybie KLIENTA - tą samą sondą `useSyncExternalStore`
// z identyczną migawką, którą `IslandGate` (P1.6) rozpoznaje „górną granicę":
// render klienta czekającej treści = zmiana nad wyspą ją obudziła (a poza
// przejściem porzuciłaby jej HTML). Rendery konsumentów liczymy jako COMMITY
// (`useLayoutEffect` bez zależności), bo przerwany i ponowiony przebieg nie
// jest renderem widocznym dla użytkownika.
//
// CO WIDAĆ W KONTROLI NEGATYWNEJ (react-dom 19.2, zmierzone): zmiana wartości
// kontekstu w przejściu przy boocie NIE renderuje tu treści wyspy w trybie
// klienta - React planuje jej hydratację na podbitym torze i zatwierdza
// przejście - ale przebudowuje KAŻDEGO konsumenta i podmienia wartość, którą
// widział w hydratacji. To jest kryterium I2 („tożsamość wartości i liczba
// renderów konsumentów"). Otwarcie wysp przez górną granicę `IslandGate`
// sprawdzi P2.2 tym samym pomiarem na `HydrationIsland` (P1.6 nie jest
// w drzewie tej pozycji).

interface AuthLike {
  loading: boolean;
}

interface BootHarness {
  Provider: ComponentType<{ children: ReactNode }>;
  useValue: () => AuthLike;
}

interface BootReport {
  /** Próby renderu treści wyspy w trybie klienta (wyspa obudzona). */
  islandClientAttempts: number;
  islandHydrationAttempts: number;
  /** Commity konsumenta, który NIE czyta `loading` (po boocie / po >= 1 s). */
  quietCommitsAtBoot: number;
  quietCommitsAfter: number;
  /** Commity konsumenta, który czyta `loading` w renderze. */
  readerCommitsAtBoot: number;
  readerCommitsAfter: number;
  quietValueStable: boolean;
  /** Cichy konsument ma po >= 1 s TĘ SAMĄ wartość, którą dostał w hydratacji. */
  quietValueSinceHydration: boolean;
  readerValueStable: boolean;
  islandHtmlKept: boolean;
  readerText: string | null;
  /** `loading` przeczytane po boocie poza renderem (handler) przez cichego konsumenta. */
  quietLoadingLater: boolean;
  errors: unknown[];
}

const subscribeNever = () => () => {};
const snapshotZero = () => 0;

async function measureGuestBoot({ Provider, useValue }: BootHarness): Promise<BootReport> {
  let islandClientAttempts = 0;
  let islandHydrationAttempts = 0;
  let quietCommits = 0;
  let readerCommits = 0;
  let quietValue: AuthLike | undefined;
  let quietHydrationValue: AuthLike | undefined;
  let readerValue: AuthLike | undefined;
  const gate = new Promise<never>(() => {});

  function IslandContent({ server }: { server: boolean }) {
    let hydrating = false;
    useSyncExternalStore(subscribeNever, snapshotZero, () => {
      hydrating = true;
      return 0;
    });
    if (!server) {
      if (hydrating) islandHydrationAttempts += 1;
      else islandClientAttempts += 1;
      throw gate;
    }
    return <p id="wyspa">Treść wyspy z serwera</p>;
  }
  function Quiet() {
    const value = useValue();
    useLayoutEffect(() => {
      quietCommits += 1;
      quietValue = value;
      quietHydrationValue ??= value;
    });
    return <span>cichy</span>;
  }
  function Reader() {
    const value = useValue();
    const text = value.loading ? "czekam" : "gość";
    useLayoutEffect(() => {
      readerCommits += 1;
      readerValue = value;
    });
    return <span id="czytelnik">{text}</span>;
  }
  const queryClient = new QueryClient();
  const view = (server: boolean) => (
    <QueryClientProvider client={queryClient}>
      <Provider>
        <Quiet />
        <Reader />
        <Suspense fallback={<p>zasłona</p>}>
          <IslandContent server={server} />
        </Suspense>
      </Provider>
    </QueryClientProvider>
  );
  const container = document.createElement("div");
  container.innerHTML = renderToString(view(true));
  document.body.append(container);
  const islandNode = container.querySelector("#wyspa");
  const errors: unknown[] = [];
  let root: Root | undefined;
  try {
    // Boot: hydratacja, efekty, przejścia, próba hydratacji wyspy (Offscreen).
    await act(async () => {
      root = hydrateRoot(container, view(false), {
        onRecoverableError: (error) => errors.push(error),
      });
      await sleep(50);
    });
    const atBoot = { quietCommits, readerCommits, quietValue, readerValue };
    await act(async () => {
      await sleep(1_050);
    });
    return {
      islandClientAttempts,
      islandHydrationAttempts,
      quietCommitsAtBoot: atBoot.quietCommits,
      quietCommitsAfter: quietCommits,
      readerCommitsAtBoot: atBoot.readerCommits,
      readerCommitsAfter: readerCommits,
      quietValueStable: quietValue === atBoot.quietValue,
      quietValueSinceHydration: quietValue === quietHydrationValue,
      readerValueStable: readerValue === atBoot.readerValue,
      islandHtmlKept: container.querySelector("#wyspa") === islandNode && !!islandNode?.isConnected,
      readerText: container.querySelector("#czytelnik")?.textContent ?? null,
      quietLoadingLater: quietValue!.loading,
      errors,
    };
  } finally {
    await act(async () => root?.unmount());
    queryClient.clear();
    container.remove();
  }
}

/**
 * Prowajder sprzed P1.7 w miniaturze: gość rozstrzygany w pierwszym przebiegu
 * efektów ZMIANĄ WARTOŚCI KONTEKSTU w `startTransition`.
 */
const NaiveCtx = createContext<AuthLike>({ loading: true });
function NaiveProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    startTransition(() => setLoading(false));
  }, []);
  return <NaiveCtx.Provider value={{ loading }}>{children}</NaiveCtx.Provider>;
}

describe("rozruch gościa nie zmienia wartości kontekstu (I2)", () => {
  it("AuthProvider: wyspa nieobudzona i HTML zostaje, wartości i commity konsumentów stoją >= 1 s", async () => {
    const report = await measureGuestBoot({ Provider: AuthProvider, useValue: useAuth });

    expect(report.errors).toEqual([]);
    expect(report.islandHtmlKept).toBe(true);
    // Hydratacja próbowała wyspy, ale nic nie wymusiło renderu klienta.
    expect(report.islandHydrationAttempts).toBeGreaterThanOrEqual(1);
    expect(report.islandClientAttempts).toBe(0);
    // Cichy konsument: jeden commit (hydratacja), ta sama wartość do końca.
    expect(report.quietCommitsAtBoot).toBe(1);
    expect(report.quietCommitsAfter).toBe(1);
    expect(report.quietValueStable).toBe(true);
    expect(report.quietValueSinceHydration).toBe(true);
    // ...a odczyt po boocie (np. w handlerze) widzi już gościa.
    expect(report.quietLoadingLater).toBe(false);
    // Konsument czytający `loading`: hydratacja z „czekam" (parytet serwera)
    // i jedno przejście na gościa w trakcie bootu - po boocie nic.
    expect(report.readerCommitsAtBoot).toBe(2);
    expect(report.readerCommitsAfter).toBe(2);
    expect(report.readerValueStable).toBe(true);
    expect(report.readerText).toBe("gość");
    // Szybka ścieżka gościa: zero dotknięć klienta Supabase.
    expect(h.touches).toBe(0);
  }, 10_000);

  it("kontrola negatywna: zmiana wartości kontekstu przy boocie przebudowuje konsumentów i podmienia ich wartość", async () => {
    const report = await measureGuestBoot({
      Provider: NaiveProvider,
      useValue: () => useContext(NaiveCtx),
    });

    // Ten sam pomiar wykrywa zmianę wartości kontekstu przy boocie: konsument,
    // który nawet nie czyta `loading`, jest przebudowany i dostaje nową wartość.
    expect(report.quietCommitsAtBoot).toBeGreaterThan(1);
    expect(report.quietValueSinceHydration).toBe(false);
  }, 10_000);
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
