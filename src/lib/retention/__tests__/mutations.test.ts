// RETENCJA - pisarze ustawień kontroferty i powodów (`mutations.ts`, def. 13).
//
// CO TEN PLIK DOWODZI.
//   1. Najemca z SESJI przy INSERT (dawniej z pierwszego wiersza listy).
//   2. Ustawienia: UPDATE z surowym tokenem zamiast `upsert` całego wiersza;
//      0 wierszy = `40001`; brak wiersza → INSERT (23505 = `40001`); wartości
//      przycięte do CHECK kolumn.
//   3. Powody: patch tylko etykiet i aktywności, token, P0002 przy pustym DELETE.
//   4. Unieważnianie = reguła szyny `retention_settings|reason.changed.v1`.
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
  supabase: {
    from: (table: string) => h.db!.from(table),
    auth: {
      getSession: () =>
        Promise.resolve({ data: { session: { user: { id: "admin-1" } } }, error: null }),
    },
  },
}));
vi.mock("@/lib/tenant", () => ({ useCurrentTenantId: () => h.tenantId }));

import { fail, ok, supabaseFromStub } from "@/test/supabaseChain";
import { isStaleWriteError } from "@/lib/billing/planQueries";
import type { DomainEventRow, DomainEventType } from "@/lib/realtime/domainEvents";
import {
  invalidationKeysFor,
  registerInvalidationExtension,
} from "@/lib/realtime/eventInvalidationMap";
import { ADMIN_HUB_INVALIDATION } from "@/lib/realtime/eventInvalidationMap.admin";
import {
  deleteRetentionReason,
  retentionInvalidationKeys,
  saveRetentionReason,
  saveRetentionSettings,
  useReorderRetentionReasons,
  useSaveRetentionSettings,
} from "../mutations";

const TENANT = "11111111-1111-4111-a111-111111111111";
const TOKEN = "2026-10-19T10:00:00.123456+00:00";
const SETTINGS = { enabled: true, discount_pct: 30, discount_periods: 3, coupon_valid_days: 14 };

beforeEach(() => {
  h.db = supabaseFromStub();
  h.tenantId = TENANT;
});

describe("saveRetentionSettings", () => {
  it("UPDATE z SUROWYM tokenem, bez upsert i bez najemcy w patchu", async () => {
    h.db!.setResponse("retention_settings", ok([{ ...SETTINGS, updated_at: "nowy" }]));
    await saveRetentionSettings(TENANT, { settings: SETTINGS, expectedUpdatedAt: TOKEN });
    const chain = h.db!.lastChain("retention_settings")!;
    expect(chain.argsOf("update")).toEqual([{ ...SETTINGS, updated_by: "admin-1" }]);
    expect(chain.argsOf("eq")).toEqual(["updated_at", TOKEN]);
    expect(chain.has("upsert")).toBe(false);
  });

  it("wartości przycięte do CHECK kolumn (1..90, 1..24, 1..90)", async () => {
    h.db!.setResponse("retention_settings", ok([{}]));
    await saveRetentionSettings(TENANT, {
      settings: { enabled: false, discount_pct: 150, discount_periods: 0, coupon_valid_days: 7.6 },
      expectedUpdatedAt: TOKEN,
    });
    expect(h.db!.lastChain("retention_settings")!.argsOf("update")![0]).toMatchObject({
      discount_pct: 90,
      discount_periods: 1,
      coupon_valid_days: 8,
    });
  });

  it("0 wierszy = 40001", async () => {
    h.db!.setResponse("retention_settings", ok([]));
    const err = await saveRetentionSettings(TENANT, {
      settings: SETTINGS,
      expectedUpdatedAt: TOKEN,
    }).catch((e: unknown) => e);
    expect(isStaleWriteError(err)).toBe(true);
  });

  it("brak wiersza: INSERT z najemcą z SESJI; 23505 = 40001; bez najemcy - brak zapisu", async () => {
    h.db!.setResponse("retention_settings", ok({ ...SETTINGS }));
    await saveRetentionSettings(TENANT, { settings: SETTINGS, expectedUpdatedAt: null });
    expect(h.db!.lastChain("retention_settings")!.argsOf("insert")![0]).toMatchObject({
      tenant_id: TENANT,
    });

    h.db!.setResponse("retention_settings", fail("duplicate", "23505"));
    const err = await saveRetentionSettings(TENANT, {
      settings: SETTINGS,
      expectedUpdatedAt: null,
    }).catch((e: unknown) => e);
    expect(isStaleWriteError(err)).toBe(true);

    h.db!.reset();
    await expect(
      saveRetentionSettings(null, { settings: SETTINGS, expectedUpdatedAt: null }),
    ).rejects.toThrow("tenant_unresolved");
    expect(h.db!.chains).toEqual([]);
  });
});

describe("saveRetentionReason / deleteRetentionReason", () => {
  it("nowy powód: najemca z sesji, przycięte etykiety, pozycja z listy", async () => {
    h.db!.setResponse("retention_reasons", ok({ id: "r1" }));
    await saveRetentionReason(TENANT, {
      id: null,
      fields: { label_pl: " Za drogo ", label_en: "Too expensive " },
      sortOrder: 40,
    });
    expect(h.db!.lastChain("retention_reasons")!.argsOf("insert")).toEqual([
      {
        tenant_id: TENANT,
        label_pl: "Za drogo",
        label_en: "Too expensive",
        active: true,
        sort_order: 40,
      },
    ]);
  });

  it("edycja: tylko etykiety i aktywność, z tokenem; kolejność i najemca odrzucone", async () => {
    h.db!.setResponse("retention_reasons", ok([{ id: "r1" }]));
    await saveRetentionReason(TENANT, {
      id: "r1",
      expectedUpdatedAt: TOKEN,
      fields: { active: false },
    });
    const chain = h.db!.lastChain("retention_reasons")!;
    expect(chain.argsOf("update")).toEqual([{ active: false }]);
    expect(chain.calls.filter((c) => c.method === "eq").map((c) => c.args)).toEqual([
      ["id", "r1"],
      ["updated_at", TOKEN],
    ]);

    h.db!.reset();
    await expect(
      saveRetentionReason(TENANT, {
        id: "r1",
        expectedUpdatedAt: TOKEN,
        fields: { sort_order: 1 } as never,
      }),
    ).rejects.toThrow("column_not_owned:sort_order");
    expect(h.db!.chains).toEqual([]);
  });

  it("edycja: 0 wierszy = 40001; usunięcie bez trafienia = P0002", async () => {
    h.db!.setResponse("retention_reasons", ok([]));
    const err = await saveRetentionReason(TENANT, {
      id: "r1",
      expectedUpdatedAt: TOKEN,
      fields: { label_pl: "x" },
    }).catch((e: unknown) => e);
    expect(isStaleWriteError(err)).toBe(true);
    await expect(deleteRetentionReason("r1")).rejects.toMatchObject({ code: "P0002" });
  });
});

function eventOf(type: DomainEventType): DomainEventRow {
  return {
    id: "55555555-5555-4555-a555-555555555555",
    tenant_id: TENANT,
    aggregate_type: type.split(".")[0],
    aggregate_id: TENANT,
    event_type: type,
    payload: {} as DomainEventRow["payload"],
    correlation_id: null,
    actor_id: null,
    created_at: "2026-10-19T10:00:00.000Z",
  };
}

const sorted = (keys: readonly QueryKey[]) => keys.map((k) => JSON.stringify(k)).sort();

describe("unieważnianie = reguła szyny", () => {
  let unregister: () => void = () => {};
  beforeAll(() => {
    unregister = registerInvalidationExtension(ADMIN_HUB_INVALIDATION);
  });
  afterAll(() => unregister());

  it.each(["retention_settings.changed.v1", "retention_reason.changed.v1"] as const)(
    "%s: rdzeń + panel dla najemcy z sesji",
    (type) => {
      expect(sorted(retentionInvalidationKeys(TENANT))).toEqual(
        sorted(invalidationKeysFor(eventOf(type), { userId: undefined })),
      );
    },
  );

  it("haki unieważniają po sukcesie (zapis ustawień i kolejność)", async () => {
    h.db!.setResponse("retention_settings", ok([{ ...SETTINGS }]));
    h.db!.setResponse("retention_reasons", ok(null));
    const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    const spy = vi.spyOn(qc, "invalidateQueries");
    const wrapper = ({ children }: { children: ReactNode }) =>
      createElement(QueryClientProvider, { client: qc }, children);
    const save = renderHook(() => useSaveRetentionSettings(), { wrapper });
    await save.result.current.mutateAsync({ settings: SETTINGS, expectedUpdatedAt: TOKEN });
    expect(sorted(spy.mock.calls.map(([f]) => (f as { queryKey: QueryKey }).queryKey))).toEqual(
      sorted(retentionInvalidationKeys(TENANT)),
    );

    spy.mockClear();
    const reorder = renderHook(() => useReorderRetentionReasons(), { wrapper });
    await reorder.result.current.mutateAsync({
      rows: [
        { id: "a", sort_order: 0 },
        { id: "b", sort_order: 10 },
      ],
      fromIndex: 1,
      toIndex: 0,
    });
    expect(h.db!.chainsFor("retention_reasons").map((c) => c.argsOf("update"))).toEqual([
      [{ sort_order: 0 }],
      [{ sort_order: 10 }],
    ]);
    expect(spy).toHaveBeenCalled();
  });
});
