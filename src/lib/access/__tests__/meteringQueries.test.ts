// METERING W PANELU - stan serwera i jedyny pisarz (`meteringQueries.ts`, def. 14).
//
// CO TEN PLIK DOWODZI.
//   1. BRAK WIERSZA = `missing` (serwer nie liczy), nie „włączony 5".
//   2. Zapis: patch = kolumny ustawień + `updated_by` (bez `tenant_id` przy
//      UPDATE), limity przycięte do CHECK kolumn, token surowy, 0 wierszy →
//      `40001`; INSERT przy braku wiersza z najemcą z sesji, 23505 → `40001`.
//   3. Unieważnianie = reguła szyny `metering_settings.changed.v1` (rdzeń + panel).
//   4. Podgląd skutku limitu: klucz z fabryki, limit przycięty w kluczu i w RPC.
import { createElement, type ReactNode } from "react";
import { QueryClient, QueryClientProvider, type QueryKey } from "@tanstack/react-query";
import { renderHook } from "@testing-library/react";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { SupabaseFromStub } from "@/test/supabaseChain";

const h = vi.hoisted(() => ({
  db: null as SupabaseFromStub | null,
  tenantId: null as string | null,
  rpc: vi.fn(),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => h.db!.from(table),
    rpc: (fn: string, args?: unknown) => h.rpc(fn, args),
    auth: {
      getSession: () =>
        Promise.resolve({ data: { session: { user: { id: "admin-1" } } }, error: null }),
    },
  },
}));
vi.mock("@/lib/tenant", () => ({ useCurrentTenantId: () => h.tenantId }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ session: null }) }));
vi.mock("@/lib/access/meteringVisitor.functions", () => ({
  consumeMeteredVisitorView: vi.fn(),
  getMeteredVisitorQuota: vi.fn(),
}));

import { fail, ok, supabaseFromStub } from "@/test/supabaseChain";
import { meteringKeys } from "@/lib/access/keys";
import { meteringSettingsQueryOptions as fromMetering } from "@/lib/access/metering";
import { isStaleWriteError } from "@/lib/billing/planQueries";
import type { DomainEventRow } from "@/lib/realtime/domainEvents";
import {
  invalidationKeysFor,
  registerInvalidationExtension,
} from "@/lib/realtime/eventInvalidationMap";
import { ADMIN_HUB_INVALIDATION } from "@/lib/realtime/eventInvalidationMap.admin";
import {
  meteringImpactPreviewQueryOptions,
  meteringInvalidationKeys,
  meteringServerState,
  meteringSettingsQueryOptions,
  saveMeteringSettings,
  useSaveMeteringSettings,
} from "../meteringQueries";

const TENANT = "11111111-1111-4111-a111-111111111111";
const TOKEN = "2026-10-19T10:00:00.123456+00:00";
const SETTINGS = {
  enabled: true,
  member_monthly_limit: 5,
  anon_monthly_limit: 0,
  meter_paid: true,
  meter_members: true,
  show_counter: true,
};

beforeEach(() => {
  h.db = supabaseFromStub();
  h.tenantId = TENANT;
  h.rpc.mockReset();
});

describe("meteringServerState", () => {
  it("brak wiersza to `missing` - serwer bez wiersza meteringu NIE liczy (def. 14)", () => {
    expect(meteringServerState(null)).toEqual({ kind: "missing" });
    expect(meteringServerState(undefined)).toEqual({ kind: "missing" });
  });

  it("wiersz: ustawienia bez tokenu + token osobno", () => {
    expect(meteringServerState({ ...SETTINGS, enabled: false, updated_at: TOKEN })).toEqual({
      kind: "row",
      settings: { ...SETTINGS, enabled: false },
      updatedAt: TOKEN,
    });
  });

  it("odczyt panelu to TEN SAM odczyt co czytelnika (re-eksport, jeden klucz)", () => {
    expect(meteringSettingsQueryOptions).toBe(fromMetering);
    expect(meteringSettingsQueryOptions().queryKey).toEqual(meteringKeys.settings());
  });
});

describe("saveMeteringSettings - UPDATE z tokenem", () => {
  it("patch = kolumny ustawień + updated_by, limity przycięte, filtr WYŁĄCZNIE po surowym tokenie", async () => {
    h.db!.setResponse("metering_settings", ok([{ ...SETTINGS, updated_at: "nowy" }]));
    const row = await saveMeteringSettings(TENANT, {
      settings: { ...SETTINGS, member_monthly_limit: 5000, anon_monthly_limit: -3.7 },
      expectedUpdatedAt: TOKEN,
    });
    const chain = h.db!.lastChain("metering_settings")!;
    expect(chain.argsOf("update")).toEqual([
      {
        enabled: true,
        member_monthly_limit: 1000,
        anon_monthly_limit: 0,
        meter_paid: true,
        meter_members: true,
        show_counter: true,
        updated_by: "admin-1",
      },
    ]);
    expect(chain.calls.filter((c) => c.method === "eq").map((c) => c.args)).toEqual([
      ["updated_at", TOKEN],
    ]);
    expect(row.updated_at).toBe("nowy");
  });

  it("0 wierszy = konflikt 40001", async () => {
    h.db!.setResponse("metering_settings", ok([]));
    const err = await saveMeteringSettings(TENANT, {
      settings: SETTINGS,
      expectedUpdatedAt: TOKEN,
    }).catch((e: unknown) => e);
    expect(isStaleWriteError(err)).toBe(true);
  });
});

describe("saveMeteringSettings - INSERT przy braku wiersza", () => {
  it("najemca z sesji, pojedynczy wiersz", async () => {
    h.db!.setResponse("metering_settings", ok({ ...SETTINGS, updated_at: TOKEN }));
    await saveMeteringSettings(TENANT, { settings: SETTINGS, expectedUpdatedAt: null });
    const chain = h.db!.lastChain("metering_settings")!;
    expect(chain.argsOf("insert")![0]).toMatchObject({ tenant_id: TENANT, enabled: true });
    expect(chain.has("upsert")).toBe(false);
    expect(chain.has("single")).toBe(true);
  });

  it("najemca nieustalony: kolumna domyślna (bez `tenant_id` w zapisie)", async () => {
    h.db!.setResponse("metering_settings", ok({ ...SETTINGS, updated_at: TOKEN }));
    await saveMeteringSettings(null, { settings: SETTINGS, expectedUpdatedAt: null });
    expect(h.db!.lastChain("metering_settings")!.argsOf("insert")![0]).not.toHaveProperty(
      "tenant_id",
    );
  });

  it("23505 (inna karta utworzyła wiersz) = konflikt 40001; inne błędy lecą dalej", async () => {
    h.db!.setResponse("metering_settings", fail("duplicate key", "23505"));
    const dup = await saveMeteringSettings(TENANT, {
      settings: SETTINGS,
      expectedUpdatedAt: null,
    }).catch((e: unknown) => e);
    expect(isStaleWriteError(dup)).toBe(true);

    h.db!.setResponse("metering_settings", fail("denied", "42501"));
    const denied = await saveMeteringSettings(TENANT, {
      settings: SETTINGS,
      expectedUpdatedAt: null,
    }).catch((e: unknown) => e);
    expect(isStaleWriteError(denied)).toBe(false);
  });
});

function eventOf(): DomainEventRow {
  return {
    id: "55555555-5555-4555-a555-555555555555",
    tenant_id: TENANT,
    aggregate_type: "metering_settings",
    aggregate_id: TENANT,
    event_type: "metering_settings.changed.v1",
    payload: { op: "UPDATE", keys: ["enabled"] } as DomainEventRow["payload"],
    correlation_id: null,
    actor_id: null,
    created_at: "2026-10-19T10:00:00.000Z",
  };
}

const sorted = (keys: readonly QueryKey[]) => keys.map((k) => JSON.stringify(k)).sort();

describe("unieważnianie", () => {
  let unregister: () => void = () => {};
  beforeAll(() => {
    unregister = registerInvalidationExtension(ADMIN_HUB_INVALIDATION);
  });
  afterAll(() => unregister());

  it("= reguła `metering_settings.changed.v1` (rdzeń + panel) dla najemcy z sesji", () => {
    expect(sorted(meteringInvalidationKeys(TENANT))).toEqual(
      sorted(invalidationKeysFor(eventOf(), { userId: undefined })),
    );
  });

  it("hak: nowy token od razu w cache, potem unieważnienie wszystkich czytelników", async () => {
    h.db!.setResponse("metering_settings", ok([{ ...SETTINGS, updated_at: "po-zapisie" }]));
    const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    const spy = vi.spyOn(qc, "invalidateQueries");
    const wrapper = ({ children }: { children: ReactNode }) =>
      createElement(QueryClientProvider, { client: qc }, children);
    const { result } = renderHook(() => useSaveMeteringSettings(), { wrapper });
    await result.current.mutateAsync({ settings: SETTINGS, expectedUpdatedAt: TOKEN });
    expect(qc.getQueryData(meteringKeys.settings())).toMatchObject({ updated_at: "po-zapisie" });
    expect(sorted(spy.mock.calls.map(([f]) => (f as { queryKey: QueryKey }).queryKey))).toEqual(
      sorted(meteringInvalidationKeys(TENANT)),
    );
  });
});

describe("meteringImpactPreviewQueryOptions", () => {
  it("klucz z fabryki z limitem przyciętym, staleTime, enabled", async () => {
    const opts = meteringImpactPreviewQueryOptions(1500.4, true);
    expect(opts.queryKey).toEqual(meteringKeys.impactPreview(1000));
    expect(opts.staleTime).toBe(30_000);
    expect(meteringImpactPreviewQueryOptions(5, false).enabled).toBe(false);

    h.rpc.mockResolvedValue({ data: [{ total_members: 3 }], error: null });
    await expect((opts.queryFn as () => Promise<unknown>)()).resolves.toEqual({ total_members: 3 });
    expect(h.rpc).toHaveBeenCalledWith("metering_impact_preview", { _proposed_member_limit: 1000 });

    h.rpc.mockResolvedValue({ data: [], error: null });
    await expect((opts.queryFn as () => Promise<unknown>)()).resolves.toBeNull();
  });
});
