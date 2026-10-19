// WARSTWY - dwaj pisarze o rozłącznych kolumnach (`tierMutations.ts`, def. 11).
//
// CO TEN PLIK DOWODZI.
//   1. Listy kolumn = właściciele z `syncManifest.ts` (jeden zbiór, nie trzy).
//   2. Rdzeń nie zapisze benefitów, marketing nie zapisze rangi - błąd PRZED
//      zapytaniem; patch nigdy nie niesie `id/tenant_id/created_at/updated_at`.
//   3. Token surowy, 0 wierszy = `40001`.
//   4. Nowa warstwa: najemca z SESJI (dawniej z pierwszego wiersza katalogu).
//   5. Unieważnianie = reguła szyny `membership_tier.changed.v1` (rdzeń + panel).
import { createElement, type ReactNode } from "react";
import { QueryClient, QueryClientProvider, type QueryKey } from "@tanstack/react-query";
import { renderHook } from "@testing-library/react";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { SupabaseFromStub } from "@/test/supabaseChain";

const h = vi.hoisted(() => ({
  db: null as SupabaseFromStub | null,
  tenantId: null as string | null,
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: (table: string) => h.db!.from(table) },
}));
vi.mock("@/lib/tenant", () => ({ useCurrentTenantId: () => h.tenantId }));

import { ok, supabaseFromStub } from "@/test/supabaseChain";
import { isStaleWriteError } from "@/lib/billing/planQueries";
import type { DomainEventRow } from "@/lib/realtime/domainEvents";
import {
  invalidationKeysFor,
  registerInvalidationExtension,
} from "@/lib/realtime/eventInvalidationMap";
import { ADMIN_HUB_INVALIDATION } from "@/lib/realtime/eventInvalidationMap.admin";
import { HUB_SYNC_MANIFEST } from "@/lib/revenue/syncManifest";
import {
  TIER_CORE_COLUMNS,
  TIER_MARKETING_COLUMNS,
  createTier,
  deleteTier,
  invalidateTierQueries,
  saveTierCore,
  saveTierMarketing,
  useCreateTier,
  useSaveTierMarketing,
} from "../tierMutations";

const TENANT = "11111111-1111-4111-a111-111111111111";
const TIER_ID = "33333333-3333-4333-a333-333333333333";
const TOKEN = "2026-10-19T10:00:00.123456+00:00";

beforeEach(() => {
  h.db = supabaseFromStub();
  h.tenantId = TENANT;
});

describe("kolumny właścicieli", () => {
  it("= właściciele bytu `membership_tier` w syncManifest, rozłączne", () => {
    const entity = HUB_SYNC_MANIFEST.find((e) => e.id === "membership_tier")!;
    const owner = (to: string) => entity.owners.find((o) => o.to === to)!.columns;
    expect([...TIER_CORE_COLUMNS]).toEqual(owner("/admin/membership"));
    expect([...TIER_MARKETING_COLUMNS]).toEqual(owner("/admin/pricing"));
    const core = new Set<string>(TIER_CORE_COLUMNS);
    expect(TIER_MARKETING_COLUMNS.filter((c) => core.has(c))).toEqual([]);
  });
});

describe("saveTierCore / saveTierMarketing", () => {
  it("rdzeń: patch, id + surowy token, zwraca wiersz", async () => {
    h.db!.setResponse("membership_tiers", ok([{ id: TIER_ID, rank: 20, updated_at: "nowy" }]));
    const row = await saveTierCore({ id: TIER_ID, expectedUpdatedAt: TOKEN, patch: { rank: 20 } });
    const chain = h.db!.lastChain("membership_tiers")!;
    expect(chain.argsOf("update")).toEqual([{ rank: 20 }]);
    expect(chain.calls.filter((c) => c.method === "eq").map((c) => c.args)).toEqual([
      ["id", TIER_ID],
      ["updated_at", TOKEN],
    ]);
    expect(row.rank).toBe(20);
  });

  it("marketing zapisuje benefity i nazwy, rdzeń nie", async () => {
    h.db!.setResponse("membership_tiers", ok([{ id: TIER_ID }]));
    await saveTierMarketing({
      id: TIER_ID,
      expectedUpdatedAt: TOKEN,
      patch: { benefits: [{ pl: "A", en: "A" }], name_pl: "Premium" },
    });
    expect(h.db!.lastChain("membership_tiers")!.argsOf("update")).toEqual([
      { benefits: [{ pl: "A", en: "A" }], name_pl: "Premium" },
    ]);

    h.db!.reset();
    await expect(
      saveTierCore({ id: TIER_ID, expectedUpdatedAt: TOKEN, patch: { benefits: [] } as never }),
    ).rejects.toThrow("column_not_owned:benefits");
    await expect(
      saveTierMarketing({ id: TIER_ID, expectedUpdatedAt: TOKEN, patch: { rank: 1 } as never }),
    ).rejects.toThrow("column_not_owned:rank");
    expect(h.db!.chains).toEqual([]);
  });

  it.each(["id", "tenant_id", "created_at", "updated_at"])(
    "`%s` nigdy nie wchodzi do patcha",
    async (column) => {
      await expect(
        saveTierCore({
          id: TIER_ID,
          expectedUpdatedAt: TOKEN,
          patch: { rank: 1, [column]: "x" } as never,
        }),
      ).rejects.toThrow(`column_not_owned:${column}`);
      expect(h.db!.chains).toEqual([]);
    },
  );

  it("0 wierszy = konflikt 40001", async () => {
    h.db!.setResponse("membership_tiers", ok([]));
    const err = await saveTierMarketing({
      id: TIER_ID,
      expectedUpdatedAt: TOKEN,
      patch: { highlight: true },
    }).catch((e: unknown) => e);
    expect(isStaleWriteError(err)).toBe(true);
  });
});

describe("createTier / deleteTier", () => {
  it("najemca z sesji, przycięte nazwy, puste benefity i flagi", async () => {
    h.db!.setResponse("membership_tiers", ok({ id: TIER_ID }));
    await createTier(TENANT, { key: " vip ", rank: 40, name_pl: " VIP ", name_en: "VIP " });
    expect(h.db!.lastChain("membership_tiers")!.argsOf("insert")).toEqual([
      {
        tenant_id: TENANT,
        key: "vip",
        rank: 40,
        name_pl: "VIP",
        name_en: "VIP",
        benefits: [],
        features: {},
      },
    ]);
  });

  it("bez ustalonego najemcy nie ma zapisu (kolumna nie ma wartości domyślnej)", async () => {
    await expect(
      createTier(null, { key: "x", rank: 1, name_pl: "x", name_en: "x" }),
    ).rejects.toThrow("tenant_unresolved");
    expect(h.db!.chains).toEqual([]);
  });

  it("hak tworzenia bierze najemcę z sesji", async () => {
    h.db!.setResponse("membership_tiers", ok({ id: TIER_ID }));
    const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    const wrapper = ({ children }: { children: ReactNode }) =>
      createElement(QueryClientProvider, { client: qc }, children);
    const { result } = renderHook(() => useCreateTier(), { wrapper });
    await result.current.mutateAsync({ key: "vip", rank: 40, name_pl: "VIP", name_en: "VIP" });
    expect(h.db!.lastChain("membership_tiers")!.argsOf("insert")![0]).toMatchObject({
      tenant_id: TENANT,
    });
  });

  it("usunięcie bez trafionego wiersza to P0002", async () => {
    h.db!.setResponse("membership_tiers", ok([]));
    await expect(deleteTier(TIER_ID)).rejects.toMatchObject({ code: "P0002" });
  });
});

function eventOf(): DomainEventRow {
  return {
    id: "55555555-5555-4555-a555-555555555555",
    tenant_id: TENANT,
    aggregate_type: "membership_tier",
    aggregate_id: TIER_ID,
    event_type: "membership_tier.changed.v1",
    payload: {} as DomainEventRow["payload"],
    correlation_id: null,
    actor_id: null,
    created_at: "2026-10-19T10:00:00.000Z",
  };
}

const sorted = (keys: readonly QueryKey[]) => keys.map((k) => JSON.stringify(k)).sort();

describe("invalidateTierQueries = reguła `membership_tier.changed.v1`", () => {
  let unregister: () => void = () => {};
  beforeAll(() => {
    unregister = registerInvalidationExtension(ADMIN_HUB_INVALIDATION);
  });
  afterAll(() => unregister());

  it("najemca z sesji: rdzeń + rozszerzenie panelu, dokładnie", async () => {
    const qc = new QueryClient();
    const spy = vi.spyOn(qc, "invalidateQueries");
    await invalidateTierQueries(qc, TENANT);
    const keys = spy.mock.calls.map(([f]) => (f as { queryKey: QueryKey }).queryKey);
    expect(sorted(keys)).toEqual(sorted(invalidationKeysFor(eventOf(), { userId: undefined })));
  });

  it("hak zapisu marketingu unieważnia po sukcesie", async () => {
    h.db!.setResponse("membership_tiers", ok([{ id: TIER_ID }]));
    const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    const spy = vi.spyOn(qc, "invalidateQueries");
    const wrapper = ({ children }: { children: ReactNode }) =>
      createElement(QueryClientProvider, { client: qc }, children);
    const { result } = renderHook(() => useSaveTierMarketing(), { wrapper });
    await result.current.mutateAsync({
      id: TIER_ID,
      expectedUpdatedAt: TOKEN,
      patch: { pricing_visible: false },
    });
    expect(spy).toHaveBeenCalled();
  });
});
