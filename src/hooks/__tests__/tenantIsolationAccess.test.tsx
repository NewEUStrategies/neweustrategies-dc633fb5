// Izolacja tenantow na powierzchni aplikacji: `saved_searches` i `user_follows`.
//
// Runtime'owy dowod, ze polityki RLS trzymaja granice, stoi w harnessie SQL
// (`scripts/tenant-isolation-harness`, `bun run check:tenant-isolation`). Tu
// sprawdzamy warstwe WYZEJ: hooki nie dokladaja wlasnego filtra tenanta, wiec
// jedyne, co dzieli obszary robocze, to polityka bazy. Test wstawia miedzy hook
// a dane atrape PostgREST z wlasnym silnikiem RLS - odrzuca wiersze o innym
// `tenant_id` albo `user_id` dokladnie tak, jak zrobi to Postgres po migracji
// 20260829091010. Regresja w zapytaniu (np. odczyt cudzych zapisow przez
// jawne `.eq("user_id", ...)` innego konta albo kasowanie po samym `id`
// wiersza z obcego tenanta) konczy sie tu czerwonym, a nie wyciekiem.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { ReactNode } from "react";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ok, type RecordedChain, type SupabaseResult } from "@/test/supabaseChain";

const h = vi.hoisted(() => ({ user: { current: null as { id: string } | null } }));
const stubs = vi.hoisted(() => ({ from: null as ReturnType<typeof import("@/test/supabaseChain").supabaseFromStub> | null }));

vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: h.user.current }) }));

vi.mock("@/integrations/supabase/client", async () => {
  const { supabaseFromStub } = await import("@/test/supabaseChain");
  const from = supabaseFromStub();
  stubs.from = from;
  return { supabase: { from: from.from } };
});

import { useSavedSearches, useDeleteSavedSearch } from "@/hooks/useSavedSearches";
import { useFollows, useToggleFollow } from "@/hooks/useFollows";

const TENANT_A = "tenant-a";
const TENANT_B = "tenant-b";
/** Konto sesji: tenant A. Wszystko poza tym jest „obce”. */
const USER = { id: "u-a" };

interface Row {
  id: string;
  user_id: string;
  tenant_id: string;
  [key: string]: unknown;
}

/** Zapisy widoczne i niewidoczne - trzeci wiersz to DRYF: wlasny `user_id`,
 *  ale tenant B (dokladnie ta luka, ktora zamknela migracja). */
const savedSearchRows: Row[] = [
  {
    id: "s-a",
    user_id: USER.id,
    tenant_id: TENANT_A,
    name: "Energia w CEE",
    params: { q: "energia" },
    created_at: "2026-08-01T10:00:00Z",
    alert_enabled: false,
    url: "/search?q=energia",
    entity: "posts",
  },
  {
    id: "s-obcy-uzytkownik",
    user_id: "u-b",
    tenant_id: TENANT_B,
    name: "Cudze wyszukiwanie",
    params: { q: "obce" },
    created_at: "2026-08-02T10:00:00Z",
    alert_enabled: true,
    url: "/search?q=obce",
    entity: "posts",
  },
  {
    id: "s-dryf",
    user_id: USER.id,
    tenant_id: TENANT_B,
    name: "Wlasny zapis w obcym tenancie",
    params: { q: "dryf" },
    created_at: "2026-08-03T10:00:00Z",
    alert_enabled: false,
    url: "/search?q=dryf",
    entity: "posts",
  },
];

const followRows: Row[] = [
  {
    id: "f-a",
    user_id: USER.id,
    tenant_id: TENANT_A,
    target_type: "author",
    target_id: "a-1",
    created_at: "2026-08-01T10:00:00Z",
  },
  {
    id: "f-obcy-uzytkownik",
    user_id: "u-b",
    tenant_id: TENANT_B,
    target_type: "author",
    target_id: "a-2",
    created_at: "2026-08-02T10:00:00Z",
  },
  {
    id: "f-dryf",
    user_id: USER.id,
    tenant_id: TENANT_B,
    target_type: "tag",
    target_id: "t-9",
    created_at: "2026-08-03T10:00:00Z",
  },
];

/** Filtry `.eq(...)` zapisane w lancuchu - atrapa odtwarza je jak PostgREST. */
function eqFilters(chain: RecordedChain): Array<[string, unknown]> {
  return chain.calls
    .filter((c) => c.method === "eq")
    .map((c) => [c.args[0] as string, c.args[1]]);
}

/** Predykat polityki wlascicielskiej po migracji: wlasciciel ORAZ tenant. */
const visible = (row: Row) => row.user_id === USER.id && row.tenant_id === TENANT_A;

/** Silnik „RLS”: najpierw polityka, potem filtry zapytania. Kolejnosc ma
 *  znaczenie - RLS w Postgresie tez zawezaja WHERE zapytania, nie odwrotnie. */
function rlsResponder(rows: Row[]) {
  return (chain: RecordedChain): SupabaseResult => {
    const allowed = rows.filter(visible);
    const filtered = allowed.filter((row) =>
      eqFilters(chain).every(([column, value]) => row[column] === value),
    );
    if (chain.has("delete") || chain.has("update")) {
      // Zapis dotyka wylacznie wierszy przepuszczonych przez polityke.
      return ok(filtered);
    }
    if (chain.has("insert") || chain.has("upsert")) {
      const payload = (chain.argsOf(chain.has("insert") ? "insert" : "upsert")?.[0] ?? {}) as Row;
      const tenant = (payload.tenant_id as string | undefined) ?? TENANT_A;
      if (payload.user_id !== USER.id || tenant !== TENANT_A) {
        return {
          data: null,
          error: Object.assign(new Error("new row violates row-level security policy"), {
            name: "PostgrestError",
            code: "42501",
          }),
        };
      }
      return ok([{ ...payload, tenant_id: tenant }]);
    }
    return ok(filtered);
  };
}

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  h.user.current = USER;
  stubs.from?.reset();
  stubs.from?.setResponse("saved_searches", rlsResponder(savedSearchRows));
  stubs.from?.setResponse("user_follows", rlsResponder(followRows));
});

afterEach(() => {
  cleanup();
});

describe("saved_searches - dostep miedzy tenantami", () => {
  it("lista pokazuje wylacznie wlasny zapis z wlasnego tenanta", async () => {
    const { result } = renderHook(() => useSavedSearches(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.map((s) => s.id)).toEqual(["s-a"]);
  });

  it("nie ujawnia zapisu tego samego konta lezacego w obcym tenancie", async () => {
    const { result } = renderHook(() => useSavedSearches(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.some((s) => s.id === "s-dryf")).toBe(false);
  });

  it("nie ujawnia zapisu innego uzytkownika", async () => {
    const { result } = renderHook(() => useSavedSearches(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.some((s) => s.id === "s-obcy-uzytkownik")).toBe(false);
  });

  it("hook nie dokleja wlasnego filtra tenanta - granicy pilnuje polityka", async () => {
    const { result } = renderHook(() => useSavedSearches(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const chain = stubs.from?.lastChain("saved_searches");
    expect(eqFilters(chain as RecordedChain).map(([c]) => c)).not.toContain("tenant_id");
  });

  it("kasowanie po samym id nie rusza wiersza z obcego tenanta", async () => {
    const { result } = renderHook(() => useDeleteSavedSearch(), { wrapper });
    await result.current.mutateAsync("s-dryf");
    const chain = stubs.from?.lastChain("saved_searches");
    const affected = rlsResponder(savedSearchRows)(chain as RecordedChain).data as Row[];
    expect(affected).toHaveLength(0);
  });

  it("kasowanie wlasnego zapisu z wlasnego tenanta dziala", async () => {
    const { result } = renderHook(() => useDeleteSavedSearch(), { wrapper });
    await result.current.mutateAsync("s-a");
    const chain = stubs.from?.lastChain("saved_searches");
    const affected = rlsResponder(savedSearchRows)(chain as RecordedChain).data as Row[];
    expect(affected.map((r) => r.id)).toEqual(["s-a"]);
  });
});

describe("user_follows - dostep miedzy tenantami", () => {
  it("lista pokazuje wylacznie wlasna obserwacje z wlasnego tenanta", async () => {
    const { result } = renderHook(() => useFollows(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.map((f) => f.id)).toEqual(["f-a"]);
  });

  it("obserwacja z dryfem tenanta i cudza obserwacja pozostaja niewidoczne", async () => {
    const { result } = renderHook(() => useFollows(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const ids = result.current.data?.map((f) => f.id) ?? [];
    expect(ids).not.toContain("f-dryf");
    expect(ids).not.toContain("f-obcy-uzytkownik");
  });

  it("odpiecie obserwacji nie siega wiersza z obcego tenanta", async () => {
    const { result } = renderHook(() => useToggleFollow(), { wrapper });
    await result.current.mutateAsync({ targetType: "tag", targetId: "t-9", on: false });
    const chain = stubs.from?.lastChain("user_follows");
    const affected = rlsResponder(followRows)(chain as RecordedChain).data as Row[];
    expect(affected).toHaveLength(0);
  });

  it("zapis obserwacji idzie na konto sesji, wiec trafia we wlasny tenant", async () => {
    const { result } = renderHook(() => useToggleFollow(), { wrapper });
    await result.current.mutateAsync({ targetType: "author", targetId: "a-7", on: true });
    const chain = stubs.from?.lastChain("user_follows");
    const payload = chain?.argsOf("upsert")?.[0] as Row;
    expect(payload.user_id).toBe(USER.id);
    expect(payload.tenant_id).toBeUndefined();
  });

  it("proba zapisu na cudze konto zostaje odrzucona przez polityke", () => {
    const chain = {
      table: "user_follows",
      calls: [{ method: "upsert", args: [{ user_id: "u-b", target_type: "author", target_id: "a-8" }] }],
      has: (m: string) => m === "upsert",
      argsOf: (m: string) =>
        m === "upsert" ? [{ user_id: "u-b", target_type: "author", target_id: "a-8" }] : undefined,
    } as unknown as RecordedChain;
    const res = rlsResponder(followRows)(chain);
    expect(res.error?.message).toContain("row-level security");
  });
});
