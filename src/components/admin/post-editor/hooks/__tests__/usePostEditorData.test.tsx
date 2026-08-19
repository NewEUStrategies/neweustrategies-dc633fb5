// Warstwa danych edytora wpisu. Stała na 0% pokrycia, a odpowiada za dwie
// rzeczy, których złamanie nie daje żadnego sygnału w interfejsie:
//
//   1. ŚCIEŻKA ODCZYTU WIERSZA. Kolumny z treścią są odebrane roli
//      `authenticated`, więc `select("*")` na `posts` dostanie odmowę.
//      Wiersz do edycji idzie WYŁĄCZNIE przez `get_post_for_edit`
//      (SECURITY DEFINER, kontrola `is_staff` + tenanta po stronie serwera).
//      Zejście z RPC na zwykły select oznacza edytor, który nie otwiera
//      żadnego wpisu.
//   2. ZAWĘŻENIE DO OBSZARU ROBOCZEGO. Wszystkie słowniki taksonomii są
//      filtrowane `tenant_id`, a klucze cache noszą tenant w kluczu. Brak
//      jednego z tych elementów pokazuje redaktorowi kategorie, tagi i
//      programy INNEJ firmy - w liście wyboru, którą zaraz zapisze do wpisu.
import type { ReactNode } from "react";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fail, ok, supabaseFromStub, type SupabaseResult } from "@/test/supabaseChain";

const stub = supabaseFromStub();

const h = vi.hoisted(() => ({
  tenantId: "tenant-1" as string | null,
  rpc: vi.fn(),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => stub.from(table),
    rpc: (fn: string, args?: Record<string, unknown>) => h.rpc(fn, args),
  },
}));

vi.mock("@/hooks/useAuth", () => ({
  useRequiredTenant: () => h.tenantId,
}));

import { usePostEditorData } from "../usePostEditorData";

const TENANT = "tenant-1";
const ROUTE_SLUG = "moj-wpis";
const POST_ROW = { id: "post-1", slug: ROUTE_SLUG, title_pl: "Tytuł z bazy" };

/** Atrapa `supabase.rpc(...).maybeSingle()`. */
function rpcReturning(result: SupabaseResult) {
  h.rpc.mockImplementation(() => ({ maybeSingle: () => Promise.resolve(result) }));
}

function wrapper(client: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

function mountData() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = renderHook(() => usePostEditorData(ROUTE_SLUG), { wrapper: wrapper(client) });
  return { ...view, client };
}

beforeEach(() => {
  stub.reset();
  h.rpc.mockReset();
  h.tenantId = TENANT;
  rpcReturning(ok(POST_ROW));
  stub.setResponse("categories", ok([{ id: "c-1", name_pl: "Analizy", name_en: "Analysis" }]));
  stub.setResponse("tags", ok([{ id: "t-1", name: "brexit" }]));
  stub.setResponse("programs", ok([{ id: "pr-1", name_pl: "Program", name_en: "Programme" }]));
  stub.setResponse("regions", ok([{ id: "r-1", name_pl: "Region", name_en: "Region" }]));
  stub.setResponse("post_categories", ok([{ category_id: "c-1" }]));
  stub.setResponse("post_tags", ok([{ tag_id: "t-1" }]));
  stub.setResponse("post_programs", ok([{ program_id: "pr-1" }]));
  stub.setResponse("post_regions", ok([{ region_id: "r-1" }]));
});

describe("wiersz wpisu do edycji", () => {
  it("czyta wiersz WYŁĄCZNIE przez RPC get_post_for_edit", async () => {
    const { result } = mountData();

    await waitFor(() => expect(result.current.post).toBeTruthy());
    expect(h.rpc).toHaveBeenCalledWith("get_post_for_edit", { _slug: ROUTE_SLUG });
    expect(result.current.post?.title_pl).toBe("Tytuł z bazy");
    expect(result.current.id).toBe("post-1");
    // Kolumny z treścią są odebrane roli `authenticated` - zejście na
    // `from("posts").select(...)` skończyłoby się odmową i edytorem, który
    // nie otwiera żadnego wpisu.
    expect(stub.chainsFor("posts")).toHaveLength(0);
  });

  it("brak wiersza (albo brak dostępu) NIE tworzy pustego formularza", async () => {
    rpcReturning(ok(null));
    const { result } = mountData();

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    // Pusty obiekt zamiast błędu dałby edytor „nowego" wpisu podpięty pod
    // cudzy slug - pierwszy autozapis nadpisałby czyjś artykuł.
    expect(result.current.post).toBeUndefined();
    expect(result.current.id).toBe("");
  });

  it("błąd RPC nie ląduje w formularzu", async () => {
    rpcReturning(fail("permission denied for function get_post_for_edit", "42501"));
    const { result } = mountData();

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.post).toBeUndefined();
  });

  it("REGRESJA: wiersz w edycji nie odświeża się sam po powrocie sieci", async () => {
    const { result, client } = mountData();
    await waitFor(() => expect(result.current.post).toBeTruthy());

    const query = client.getQueryCache().find({ queryKey: ["post-by-slug", TENANT, ROUTE_SLUG] });

    // Refetch w tle podmienia `post`, a hook formularza robi wtedy
    // `history.reset(post)` - niezapisane zmiany i historia cofania znikają
    // redaktorowi bez śladu. Jedyne dozwolone odświeżenia są jawne
    // (przywrócenie wersji, zmiana slugu).
    // `QueryOptions` (typ opcji w cache'u) nie wystawia flag obserwatora, choć
    // react-query je tam trzyma - stąd rzut na sam odczytywany kształt.
    const options = query?.options as { refetchOnReconnect?: boolean } | undefined;
    expect(options?.refetchOnReconnect).toBe(false);
  });

  it("klucz cache wiersza niesie tenant, więc obszary robocze się nie mieszają", async () => {
    const { result, client } = mountData();
    await waitFor(() => expect(result.current.post).toBeTruthy());

    const keys = client
      .getQueryCache()
      .getAll()
      .map((q) => q.queryKey);
    expect(keys).toContainEqual(["post-by-slug", TENANT, ROUTE_SLUG]);
    expect(keys).toContainEqual(["categories", TENANT]);
    expect(keys).toContainEqual(["tags", TENANT]);
  });
});

describe("słowniki taksonomii", () => {
  it("REGRESJA: każdy słownik jest zawężony do aktywnego obszaru roboczego", async () => {
    const { result } = mountData();
    await waitFor(() => expect(result.current.allRegions).toBeTruthy());

    for (const table of ["categories", "tags", "programs", "regions"]) {
      // Brak filtru tenanta podsuwa redaktorowi kategorie i tagi INNEJ firmy
      // w liście wyboru - a stamtąd trafiają one prosto do zapisu wpisu.
      expect(stub.lastChain(table)?.argsOf("eq"), `${table} bez filtru tenanta`).toEqual([
        "tenant_id",
        TENANT,
      ]);
    }
  });

  it("lista programów pomija programy wyłączone i zachowuje kolejność redakcyjną", async () => {
    const { result } = mountData();
    await waitFor(() => expect(result.current.allPrograms).toBeTruthy());

    const chain = stub.lastChain("programs");
    const filters = chain?.calls.filter((c) => c.method === "eq").map((c) => c.args);
    expect(filters).toContainEqual(["is_active", true]);
    // Kolejność: własne `sort_order` redakcji, dopiero potem alfabet. Zamiana
    // tych dwóch ogniw przestawia listę wyboru w karcie programów.
    expect(chain?.calls.filter((c) => c.method === "order").map((c) => c.args)).toEqual([
      ["sort_order", { ascending: true }],
      ["name_pl", { ascending: true }],
    ]);
  });

  it("pusty wynik daje pustą listę, nie null", async () => {
    for (const table of ["categories", "tags", "programs", "regions"]) {
      stub.setResponse(table, ok(null));
    }
    const { result } = mountData();

    await waitFor(() => expect(result.current.allRegions).toBeTruthy());
    // Karty taksonomii mapują po tablicy; `null` wywróciłby cały panel
    // edytora, a nie tylko jedną listę.
    expect(result.current.allCats).toEqual([]);
    expect(result.current.allTags).toEqual([]);
    expect(result.current.allPrograms).toEqual([]);
    expect(result.current.allRegions).toEqual([]);
  });
});

describe("relacje wpisu", () => {
  it("nie pyta o relacje, dopóki nie znamy id wpisu", async () => {
    rpcReturning(ok(null));
    const { result } = mountData();

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    // Zapytanie z pustym `post_id` zwróciłoby relacje CAŁEJ tabeli - edytor
    // zaznaczyłby wtedy kategorie z innych wpisów.
    expect(stub.chainsFor("post_categories")).toHaveLength(0);
    expect(stub.chainsFor("post_tags")).toHaveLength(0);
    expect(stub.chainsFor("post_programs")).toHaveLength(0);
    expect(stub.chainsFor("post_regions")).toHaveLength(0);
  });

  it("czyta relacje zawężone do wczytanego wpisu", async () => {
    const { result } = mountData();
    await waitFor(() => expect(result.current.postRegions).toBeTruthy());

    for (const table of ["post_categories", "post_tags", "post_programs", "post_regions"]) {
      expect(stub.lastChain(table)?.argsOf("eq"), `${table} bez zawężenia do wpisu`).toEqual([
        "post_id",
        "post-1",
      ]);
    }
    expect(result.current.postCats).toEqual([{ category_id: "c-1" }]);
    expect(result.current.postTags).toEqual([{ tag_id: "t-1" }]);
    expect(result.current.postPrograms).toEqual([{ program_id: "pr-1" }]);
    expect(result.current.postRegions).toEqual([{ region_id: "r-1" }]);
  });

  it("brak relacji daje puste listy zaznaczeń", async () => {
    for (const table of ["post_categories", "post_tags", "post_programs", "post_regions"]) {
      stub.setResponse(table, ok(null));
    }
    const { result } = mountData();

    await waitFor(() => expect(result.current.postRegions).toBeTruthy());
    // Hook formularza robi `postCats.map(...)` w efekcie - `null` zamiast
    // pustej tablicy wywala edytor przy wpisie bez żadnej kategorii.
    expect(result.current.postCats).toEqual([]);
    expect(result.current.postTags).toEqual([]);
    expect(result.current.postPrograms).toEqual([]);
    expect(result.current.postRegions).toEqual([]);
  });
});
