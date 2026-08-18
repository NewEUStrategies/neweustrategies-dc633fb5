// WARSTWA DANYCH edytora wpisu (`usePostEditorData`: 0 z 10 funkcji przed tą
// zmianą). Dziewięć zapytań, od których zależą dwie rzeczy nie do naprawienia
// po fakcie:
//
//   1. IZOLACJA NAJEMCÓW. Każdy słownik i każda relacja musi być ograniczona do
//      aktywnego obszaru roboczego. Zapytanie bez filtra `tenant_id` wpuszcza
//      kategorie i tagi obcej firmy do listy wyboru redaktora - i w chwili
//      zapisu przypina wpis do cudzego słownika. RLS jest drugą zaporą, ale
//      pierwszą jest ten filtr, bo słowniki taksonomii są czytelne szeroko.
//   2. NIEUTRACENIE TEKSTU. `refetchOnReconnect: false` na zapytaniu o wiersz
//      wpisu nie jest optymalizacją: refetch podmienia `post`, hook formularza
//      robi na tym `history.reset()`, a to KASUJE niezapisane zmiany i historię
//      undo. Wystarczy chwilowy brak sieci w trakcie pisania.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ok, type RecordedChain, type SupabaseFromStub } from "@/test/supabaseChain";

/**
 * `refetchOnReconnect` nie jest czescia PUBLICZNEGO typu `QueryOptions`
 * (react-query trzyma go w typie obserwatora), a to wlasnie ta opcja jest tu
 * przedmiotem testu. Rzut jest waski i zlokalizowany w jednym helperze -
 * czytamy dokladnie to jedno pole, nie rozluzniamy typowania calego zapytania.
 */
function refetchOnReconnectOf(options: unknown): unknown {
  return (options as { refetchOnReconnect?: unknown }).refetchOnReconnect;
}

const h = vi.hoisted(() => ({ tenantId: "tenant-alfa" as string }));
const stubs = vi.hoisted(() => ({ from: null as unknown, rpc: null as unknown }));

vi.mock("@/integrations/supabase/client", async () => {
  const { supabaseFromStub } = await import("@/test/supabaseChain");
  const { vi: v } = await import("vitest");
  const from = supabaseFromStub();
  const rpc = v.fn(() => ({
    maybeSingle: async () => ({ data: { id: "post-1", slug: "moj-wpis" }, error: null }),
  }));
  stubs.from = from;
  stubs.rpc = rpc;
  return { supabase: { from: from.from, rpc } };
});

vi.mock("@/hooks/useAuth", () => ({
  useRequiredTenant: () => h.tenantId,
}));

import { usePostEditorData } from "../usePostEditorData";

const db = stubs.from as SupabaseFromStub;
const rpc = stubs.rpc as ReturnType<typeof vi.fn>;

/** Wszystkie tabele słowników i relacji, po które sięga ten hook. */
const DICTIONARY_TABLES = ["categories", "tags", "programs", "regions"] as const;
const RELATION_TABLES = ["post_categories", "post_tags", "post_programs", "post_regions"] as const;

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

/** Domyślna odpowiedź RPC `get_post_for_edit` - wiersz wpisu do edycji. */
function defaultRpc() {
  return {
    maybeSingle: async () => ({ data: { id: "post-1", slug: "moj-wpis" }, error: null }),
  };
}

beforeEach(() => {
  db.reset();
  // `mockReset`, nie `mockClear`: testy niżej podmieniają IMPLEMENTACJĘ rpc
  // (wiszące zapytanie, brak wiersza, błąd), a `mockClear` czyści tylko listę
  // wywołań i taka podmiana przeciekłaby na następne testy.
  rpc.mockReset();
  rpc.mockImplementation(defaultRpc);
  h.tenantId = "tenant-alfa";
  for (const table of [...DICTIONARY_TABLES, ...RELATION_TABLES]) {
    db.setResponse(table, ok([]));
  }
});

describe("usePostEditorData - izolacja najemców", () => {
  it("KAŻDY słownik taksonomii jest filtrowany po tenant_id", async () => {
    const { result } = renderHook(() => usePostEditorData("moj-wpis"), { wrapper });
    await waitFor(() => expect(result.current.id).toBe("post-1"));
    await waitFor(() => {
      for (const table of DICTIONARY_TABLES) {
        expect(db.chainsFor(table).length, table).toBeGreaterThan(0);
      }
    });

    for (const table of DICTIONARY_TABLES) {
      const chain = db.lastChain(table) as RecordedChain;
      const eqs = chain.calls.filter((c) => c.method === "eq").map((c) => c.args);
      // Kategorie i tagi bez tego filtra wpuściłyby słownik obcej firmy do
      // listy wyboru - a zapis przypiąłby wpis do cudzej taksonomii.
      expect(eqs, `${table}: brak filtra tenanta`).toContainEqual(["tenant_id", "tenant-alfa"]);
    }
  });

  it("relacje wpisu są filtrowane po post_id (wiersz jest już tenant-scoped)", async () => {
    const { result } = renderHook(() => usePostEditorData("moj-wpis"), { wrapper });
    await waitFor(() => expect(result.current.id).toBe("post-1"));
    await waitFor(() => {
      for (const table of RELATION_TABLES) {
        expect(db.chainsFor(table).length, table).toBeGreaterThan(0);
      }
    });

    for (const table of RELATION_TABLES) {
      const chain = db.lastChain(table) as RecordedChain;
      expect(chain.argsOf("eq"), table).toEqual(["post_id", "post-1"]);
    }
  });

  it("aktywne programy: tylko is_active, posortowane deterministycznie", async () => {
    const { result } = renderHook(() => usePostEditorData("moj-wpis"), { wrapper });
    await waitFor(() => expect(result.current.id).toBe("post-1"));
    await waitFor(() => expect(db.chainsFor("programs").length).toBeGreaterThan(0));

    const chain = db.lastChain("programs") as RecordedChain;
    const eqs = chain.calls.filter((c) => c.method === "eq").map((c) => c.args);
    expect(eqs).toContainEqual(["is_active", true]);
    // Dwa `order` (sort_order, potem name_pl) - bez drugiego lista programów
    // o równym sort_order zmieniałaby kolejność między odsłonami.
    const orders = chain.calls.filter((c) => c.method === "order").map((c) => c.args[0]);
    expect(orders).toEqual(["sort_order", "name_pl"]);
  });

  it("wiersz wpisu jedzie przez RPC get_post_for_edit, nie przez select('*')", async () => {
    // Kolumny ciała są odebrane roli `authenticated`, więc `select("*")`
    // dostałby odmowę. RPC jest SECURITY DEFINER i sam wymusza staff + tenanta.
    const { result } = renderHook(() => usePostEditorData("moj-wpis"), { wrapper });
    await waitFor(() => expect(result.current.id).toBe("post-1"));

    expect(rpc).toHaveBeenCalledWith("get_post_for_edit", { _slug: "moj-wpis" });
    expect(db.chainsFor("posts")).toHaveLength(0);
  });
});

describe("usePostEditorData - relacje czekają na id wpisu", () => {
  it("relacje NIE są odpytywane, dopóki nie ma id (brak eq('post_id', ''))", async () => {
    // `enabled: !!id` chroni przed zapytaniem `post_id = ""`, które zwróciłoby
    // pustą listę i wyglądało jak „wpis nie ma kategorii" - a potem zapis
    // skasowałby prawdziwe przypisania.
    rpc.mockImplementation(() => ({
      maybeSingle: async () => new Promise(() => {}) as Promise<never>,
    }));
    renderHook(() => usePostEditorData("moj-wpis"), { wrapper });

    await waitFor(() => expect(db.chainsFor("categories").length).toBeGreaterThan(0));
    for (const table of RELATION_TABLES) {
      expect(db.chainsFor(table), table).toHaveLength(0);
    }
  });
});

describe("usePostEditorData - błąd wczytania wpisu", () => {
  it("brak wiersza to błąd, nie pusty formularz", async () => {
    rpc.mockImplementation(() => ({
      maybeSingle: async () => ({ data: null, error: null }),
    }));
    const { result } = renderHook(() => usePostEditorData("nie-ma"), { wrapper });
    // Pusty formularz przy braku dostępu byłby gorszy niż błąd: redaktor
    // zacząłby pisać w edytorze, który nie ma czego zapisać.
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.post).toBeUndefined();
    expect(result.current.id).toBe("");
  });

  it("błąd RPC propaguje - hook nie udaje udanego wczytania", async () => {
    rpc.mockImplementation(() => ({
      maybeSingle: async () => ({ data: null, error: new Error("access denied") }),
    }));
    const { result } = renderHook(() => usePostEditorData("moj-wpis"), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.post).toBeUndefined();
  });
});

describe("usePostEditorData - klucze cache", () => {
  it("klucz wiersza wpisu zawiera tenanta ORAZ slug", async () => {
    // Bez tenanta w kluczu przełączenie obszaru roboczego pokazałoby wpis
    // poprzedniej firmy z cache'u.
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    const localWrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(() => usePostEditorData("moj-wpis"), {
      wrapper: localWrapper,
    });
    await waitFor(() => expect(result.current.id).toBe("post-1"));

    expect(client.getQueryData(["post-by-slug", "tenant-alfa", "moj-wpis"])).toMatchObject({
      id: "post-1",
    });
  });

  it("słowniki mają tenanta w kluczu (izolacja cache między firmami)", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    const localWrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(() => usePostEditorData("moj-wpis"), {
      wrapper: localWrapper,
    });
    await waitFor(() => expect(result.current.id).toBe("post-1"));

    await waitFor(() => {
      for (const key of ["categories", "tags", "programs", "regions"]) {
        expect(client.getQueryData([key, "tenant-alfa"]), key).toBeDefined();
      }
    });
  });
});

describe("usePostEditorData - zapora przed utratą tekstu", () => {
  it("wiersz edytowanego wpisu NIE odświeża się po powrocie sieci", async () => {
    // To nie jest optymalizacja ruchu. Refetch podmienia `post`, hook formularza
    // robi na tym `history.reset()` - a to KASUJE niezapisane zmiany i całą
    // historię undo. Wystarczy chwilowy brak sieci w trakcie pisania.
    // Jawne inwalidacje (przywrócenie rewizji, zmiana sluga) nadal odświeżają
    // celowo, bo idą przez `invalidateQueries`, nie przez ten przełącznik.
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    const localWrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(() => usePostEditorData("moj-wpis"), { wrapper: localWrapper });
    await waitFor(() => expect(result.current.id).toBe("post-1"));

    const query = client
      .getQueryCache()
      .find({ queryKey: ["post-by-slug", "tenant-alfa", "moj-wpis"] });
    expect(query).toBeDefined();
    expect(refetchOnReconnectOf(query?.options)).toBe(false);
  });

  it("słowniki taksonomii NIE mają tego wyłącznika (mogą się odświeżać)", async () => {
    // Kontrast celowy: odświeżenie listy kategorii nic nie kasuje, więc nie ma
    // powodu jej zamrażać. Ten test pilnuje, żeby wyłącznik nie rozlał się na
    // całą warstwę danych „na wszelki wypadek".
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    const localWrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(() => usePostEditorData("moj-wpis"), { wrapper: localWrapper });
    await waitFor(() => expect(result.current.id).toBe("post-1"));

    const query = client.getQueryCache().find({ queryKey: ["categories", "tenant-alfa"] });
    expect(query).toBeDefined();
    // Domyślna wartość react-query, czyli słownik ODŚWIEŻA się po powrocie sieci.
    expect(refetchOnReconnectOf(query?.options)).toBe(true);
  });
});
