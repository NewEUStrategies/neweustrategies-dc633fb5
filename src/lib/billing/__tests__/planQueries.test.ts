// PLANY DOSTĘPU - wspólny odczyt i jedyny pisarz (`planQueries.ts`, S1 def. 3/4).
//
// CO TEN PLIK DOWODZI.
//   1. PATCH = WYŁĄCZNIE kolumny właściciela. Paywall nie dotyka `tier_key`,
//      członkostwo pisze tylko `tier_key`, a `id`/`tenant_id`/`created_at`/
//      `updated_at` nie wchodzą do zapisu nigdy - błąd PRZED zapytaniem.
//   2. TOKEN SUROWY: `updated_at` z PostgREST trafia do `.eq` bajt w bajt
//      (mikrosekundy i strefa) - przejście przez `Date` robiłoby z każdego
//      zapisu konflikt.
//   3. 0 wierszy z `.eq("updated_at")` = błąd `40001` (D-S1-02).
//   4. USUWANIE tylko planu bez subskrypcji, z ponownym liczeniem w mutacji.
//   5. UNIEWAŻNIANIE = dokładnie reguła szyny `access_plan.changed.v1`
//      (rdzeń + rozszerzenie panelu dla najemcy z sesji).
// Scenariusz lost update „dwie karty" - `planQueries.lostUpdate.test.ts`.
import { createElement, type ReactNode } from "react";
import { QueryClient, QueryClientProvider, type QueryKey } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { SupabaseFromStub } from "@/test/supabaseChain";

const h = vi.hoisted(() => ({
  db: null as SupabaseFromStub | null,
  tenantId: null as string | null,
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => {
      if (!h.db) throw new Error("test: atrapa bazy nieustawiona");
      return h.db.from(table);
    },
  },
}));
vi.mock("@/lib/tenant", () => ({ useCurrentTenantId: () => h.tenantId }));

import { fail, ok, okCount, supabaseFromStub } from "@/test/supabaseChain";
import { billingKeys } from "@/lib/billing/keys";
import type { DomainEventRow } from "@/lib/realtime/domainEvents";
import {
  invalidationKeysFor,
  registerInvalidationExtension,
} from "@/lib/realtime/eventInvalidationMap";
import { ADMIN_HUB_INVALIDATION } from "@/lib/realtime/eventInvalidationMap.admin";
import { revenueKeys } from "@/lib/revenue/keys";
import {
  ACCESS_PLAN_MEMBERSHIP_COLUMNS,
  ACCESS_PLAN_PAYWALL_COLUMNS,
  STALE_WRITE_CODE,
  SYNC_MESSAGE_KEYS,
  adminPlansAllQueryOptions,
  deleteAccessPlan,
  invalidatePlanQueries,
  isPlanHasSubscriptionsError,
  isStaleWriteError,
  planSubscriptionCountQueryOptions,
  saveAccessPlanPatch,
  staleWriteError,
  useDeleteAccessPlan,
  useSaveAccessPlanPatch,
  type AccessPlanRow,
} from "../planQueries";
import { HUB_SYNC_MANIFEST } from "@/lib/revenue/syncManifest";
import i18n from "@/lib/i18n";
import "@/lib/i18n-admin-paywall-sync";

const TENANT = "11111111-1111-4111-a111-111111111111";
const PLAN_ID = "22222222-2222-4222-a222-222222222222";
/** Prawdziwy kształt z PostgREST: mikrosekundy i strefa `+00:00`. */
const TOKEN = "2026-10-19T10:00:00.123456+00:00";
const TOKEN_NEXT = "2026-10-19T10:05:00.654321+00:00";

function planRow(overrides: Partial<AccessPlanRow> = {}): AccessPlanRow {
  return {
    id: PLAN_ID,
    tenant_id: TENANT,
    name_pl: "Plan",
    name_en: "Plan",
    description_pl: null,
    description_en: null,
    features_pl: [],
    features_en: [],
    badge_pl: null,
    badge_en: null,
    highlighted: false,
    sort_order: 0,
    price_cents: 1900,
    currency: "PLN",
    interval: "month",
    trial_days: 0,
    active: true,
    for_sale: true,
    tier_key: "member",
    volume_price_cents: null,
    volume_threshold_seats: null,
    created_at: "2026-01-01T00:00:00+00:00",
    updated_at: TOKEN,
    ...overrides,
  };
}

const NEVER_IN_PATCH = ["id", "tenant_id", "created_at", "updated_at"] as const;

beforeEach(() => {
  h.db = supabaseFromStub();
  h.tenantId = TENANT;
});

describe("listy kolumn właścicieli", () => {
  it("paywall i członkostwo są rozłączne, a `tier_key` należy wyłącznie do członkostwa", () => {
    const paywall = new Set<string>(ACCESS_PLAN_PAYWALL_COLUMNS);
    expect(ACCESS_PLAN_MEMBERSHIP_COLUMNS).toEqual(["tier_key"]);
    expect(paywall.has("tier_key")).toBe(false);
    for (const column of NEVER_IN_PATCH) expect(paywall.has(column)).toBe(false);
    // `for_sale` (cennik v6.2) jest edytowalny z paywalla - dziś admin go nie widzi.
    expect(paywall.has("for_sale")).toBe(true);
  });

  it("kolumny `syncManifest` są podzbiorem list modułu (manifest zna tylko część paywalla - zgłoszenie)", () => {
    const entity = HUB_SYNC_MANIFEST.find((e) => e.id === "access_plan")!;
    const paywall = entity.owners.find((o) => o.to === "/admin/paywall")!.columns ?? [];
    const membership = entity.owners.find((o) => o.to === "/admin/membership")!.columns ?? [];
    expect(
      paywall.filter((c) => !(ACCESS_PLAN_PAYWALL_COLUMNS as readonly string[]).includes(c)),
    ).toEqual([]);
    expect(membership).toEqual([...ACCESS_PLAN_MEMBERSHIP_COLUMNS]);
  });
});

describe("saveAccessPlanPatch - UPDATE", () => {
  it("paywall wysyła wyłącznie patch, filtruje po id i SUROWYM tokenie, zwraca wiersz z nowym tokenem", async () => {
    h.db!.setResponse("access_plans", ok([planRow({ price_cents: 2900, updated_at: TOKEN_NEXT })]));
    const row = await saveAccessPlanPatch("paywall", {
      id: PLAN_ID,
      expectedUpdatedAt: TOKEN,
      patch: { price_cents: 2900, for_sale: false },
    });

    const chain = h.db!.lastChain("access_plans")!;
    expect(chain.argsOf("update")).toEqual([{ price_cents: 2900, for_sale: false }]);
    expect(chain.calls.filter((c) => c.method === "eq").map((c) => c.args)).toEqual([
      ["id", PLAN_ID],
      ["updated_at", TOKEN],
    ]);
    expect(chain.argsOf("select")).toEqual(["*"]);
    expect(row.updated_at).toBe(TOKEN_NEXT);
  });

  it("token nie przechodzi przez Date: mikrosekundy zostają (inaczej każdy zapis byłby konfliktem)", async () => {
    h.db!.setResponse("access_plans", ok([planRow()]));
    await saveAccessPlanPatch("paywall", {
      id: PLAN_ID,
      expectedUpdatedAt: TOKEN,
      patch: { active: true },
    });
    const eqToken = h
      .db!.lastChain("access_plans")!
      .calls.find((c) => c.method === "eq" && c.args[0] === "updated_at")!.args[1];
    expect(eqToken).toBe(TOKEN);
    expect(new Date(TOKEN).toISOString()).not.toBe(TOKEN);
  });

  it("0 wierszy = konflikt 40001 (ktoś zapisał wcześniej albo plan zniknął)", async () => {
    h.db!.setResponse("access_plans", ok([]));
    const err = await saveAccessPlanPatch("paywall", {
      id: PLAN_ID,
      expectedUpdatedAt: TOKEN,
      patch: { price_cents: 100 },
    }).catch((e: unknown) => e);
    expect(isStaleWriteError(err)).toBe(true);
    expect((err as { code: string }).code).toBe(STALE_WRITE_CODE);
    expect((err as Error).message).toBe("stale_write");
  });

  it("błąd PostgREST leci dalej bez przebrania za konflikt", async () => {
    h.db!.setResponse("access_plans", fail("permission denied", "42501"));
    const err = await saveAccessPlanPatch("paywall", {
      id: PLAN_ID,
      expectedUpdatedAt: TOKEN,
      patch: { price_cents: 100 },
    }).catch((e: unknown) => e);
    expect(isStaleWriteError(err)).toBe(false);
    expect((err as { code: string }).code).toBe("42501");
  });

  it.each([...NEVER_IN_PATCH, "tier_key", "unknown_column"])(
    "paywall: kolumna `%s` w patchu = błąd PRZED zapytaniem",
    async (column) => {
      await expect(
        saveAccessPlanPatch("paywall", {
          id: PLAN_ID,
          expectedUpdatedAt: TOKEN,
          patch: { price_cents: 1, [column]: "x" } as never,
        }),
      ).rejects.toThrow(`column_not_owned:${column}`);
      expect(h.db!.chains).toEqual([]);
    },
  );

  it("członkostwo pisze wyłącznie `tier_key` - cena z jego formularza jest odrzucona", async () => {
    await expect(
      saveAccessPlanPatch("membership", {
        id: PLAN_ID,
        expectedUpdatedAt: TOKEN,
        patch: { tier_key: "premium", price_cents: 1 } as never,
      }),
    ).rejects.toThrow("column_not_owned:price_cents");

    h.db!.setResponse("access_plans", ok([planRow({ tier_key: "premium" })]));
    await saveAccessPlanPatch("membership", {
      id: PLAN_ID,
      expectedUpdatedAt: TOKEN,
      patch: { tier_key: "premium" },
    });
    expect(h.db!.lastChain("access_plans")!.argsOf("update")).toEqual([{ tier_key: "premium" }]);
  });

  it("pusty patch i brak tokenu przy UPDATE to błędy programisty, nie zapytania", async () => {
    await expect(
      saveAccessPlanPatch("paywall", { id: PLAN_ID, expectedUpdatedAt: TOKEN, patch: {} }),
    ).rejects.toThrow("empty_patch");
    await expect(
      saveAccessPlanPatch("paywall", {
        id: PLAN_ID,
        expectedUpdatedAt: null,
        patch: { active: false },
      }),
    ).rejects.toThrow("expected_updated_at_required");
    expect(h.db!.chains).toEqual([]);
  });
});

describe("saveAccessPlanPatch - INSERT", () => {
  it("nowy plan z paywalla: sam patch, najemca z domyślnej kolumny (nigdy z formularza)", async () => {
    h.db!.setResponse("access_plans", ok(planRow()));
    await saveAccessPlanPatch("paywall", {
      id: null,
      expectedUpdatedAt: null,
      patch: { name_pl: "Nowy", name_en: "New", price_cents: 4900, for_sale: true },
    });
    const chain = h.db!.lastChain("access_plans")!;
    expect(chain.argsOf("insert")).toEqual([
      { name_pl: "Nowy", name_en: "New", price_cents: 4900, for_sale: true },
    ]);
    expect(chain.has("single")).toBe(true);
  });

  it("członkostwo nie tworzy planów", async () => {
    await expect(
      saveAccessPlanPatch("membership", {
        id: null,
        expectedUpdatedAt: null,
        patch: { tier_key: "x" },
      }),
    ).rejects.toThrow("insert_not_owned");
    expect(h.db!.chains).toEqual([]);
  });
});

describe("predykat konfliktu", () => {
  it("rozpoznaje błąd mutatora i błąd PostgREST z RPC (ten sam SQLSTATE)", () => {
    expect(isStaleWriteError(staleWriteError())).toBe(true);
    expect(isStaleWriteError({ code: "40001", message: "stale_write" })).toBe(true);
    for (const other of [new Error("x"), { code: "23505" }, null, undefined, "40001"]) {
      expect(isStaleWriteError(other)).toBe(false);
    }
  });
});

describe("SYNC_MESSAGE_KEYS - para kod → zdanie", () => {
  it("każdy klucz ma zdanie w PL i EN, a oba języki się różnią", () => {
    for (const key of Object.values(SYNC_MESSAGE_KEYS)) {
      const pl: unknown = i18n.getResource("pl", "translation", key);
      const en: unknown = i18n.getResource("en", "translation", key);
      expect(typeof pl, key).toBe("string");
      expect(typeof en, key).toBe("string");
      expect(pl).not.toBe(en);
    }
  });
});

describe("usuwanie planu (def. 4, D-S1-05)", () => {
  it("plan z subskrypcjami (dowolny status): blokada BEZ zapytania DELETE", async () => {
    h.db!.setResponse("user_subscriptions", okCount(3));
    const err = await deleteAccessPlan(PLAN_ID).catch((e: unknown) => e);
    expect(isPlanHasSubscriptionsError(err)).toBe(true);
    expect((err as { subscriptionCount: number }).subscriptionCount).toBe(3);
    expect(h.db!.chainsFor("access_plans")).toEqual([]);
    const count = h.db!.lastChain("user_subscriptions")!;
    expect(count.argsOf("select")).toEqual(["id", { count: "exact", head: true }]);
    expect(count.argsOf("eq")).toEqual(["plan_id", PLAN_ID]);
    // Brak filtra statusu - kaskada kasuje także historię anulowanych.
    expect(count.calls.filter((c) => c.method === "eq")).toHaveLength(1);
  });

  it("plan bez subskrypcji: DELETE po id, z odczytem usuniętego wiersza", async () => {
    h.db!.setResponse("user_subscriptions", okCount(0));
    h.db!.setResponse("access_plans", ok([{ id: PLAN_ID }]));
    await deleteAccessPlan(PLAN_ID);
    const chain = h.db!.lastChain("access_plans")!;
    expect(chain.has("delete")).toBe(true);
    expect(chain.argsOf("eq")).toEqual(["id", PLAN_ID]);
  });

  it("0 usuniętych wierszy (RLS albo inna karta) to błąd P0002, nie udany sukces", async () => {
    h.db!.setResponse("user_subscriptions", okCount(0));
    h.db!.setResponse("access_plans", ok([]));
    await expect(deleteAccessPlan(PLAN_ID)).rejects.toMatchObject({ code: "P0002" });
  });

  it("licznik `null` to brak odpowiedzi, nie zero - usunięcie wstrzymane", async () => {
    h.db!.setResponse("user_subscriptions", { data: null, error: null, count: null });
    await expect(deleteAccessPlan(PLAN_ID)).rejects.toThrow("count_unavailable");
    expect(h.db!.chainsFor("access_plans")).toEqual([]);
  });
});

describe("queryOptions", () => {
  it("adminPlansAllQueryOptions: klucz z fabryki, staleTime, sortowanie po sort_order", async () => {
    const opts = adminPlansAllQueryOptions();
    expect(opts.queryKey).toEqual(billingKeys.admin.plansAll());
    expect(opts.staleTime).toBe(30_000);
    h.db!.setResponse("access_plans", ok([planRow()]));
    const rows = await (opts.queryFn as () => Promise<AccessPlanRow[]>)();
    expect(rows[0].updated_at).toBe(TOKEN);
    const chain = h.db!.lastChain("access_plans")!;
    expect(chain.argsOf("select")).toEqual(["*"]);
    expect(chain.argsOf("order")).toEqual(["sort_order", { ascending: true }]);
  });

  it("planSubscriptionCountQueryOptions: pod prefiksem subskrypcji (szyna je odświeża), wyłączony bez planu", () => {
    const opts = planSubscriptionCountQueryOptions(PLAN_ID);
    const prefix = billingKeys.admin.allUserSubscriptions();
    expect(opts.queryKey.slice(0, prefix.length)).toEqual([...prefix]);
    expect(opts.queryKey).toContain(PLAN_ID);
    expect(opts.enabled).toBe(true);
    expect(planSubscriptionCountQueryOptions(null).enabled).toBe(false);
  });
});

/* -------------------------------------------- unieważnianie = reguła szyny */

function eventOf(): DomainEventRow {
  return {
    id: "55555555-5555-4555-a555-555555555555",
    tenant_id: TENANT,
    aggregate_type: "access_plan",
    aggregate_id: PLAN_ID,
    event_type: "access_plan.changed.v1",
    payload: {} as DomainEventRow["payload"],
    correlation_id: null,
    actor_id: null,
    created_at: "2026-10-19T10:00:00.000Z",
  };
}

const sorted = (keys: readonly QueryKey[]) => keys.map((k) => JSON.stringify(k)).sort();

async function invalidatedBy(run: (qc: QueryClient) => Promise<unknown>): Promise<QueryKey[]> {
  const qc = new QueryClient();
  const spy = vi.spyOn(qc, "invalidateQueries");
  await run(qc);
  return spy.mock.calls.map(([filters]) => (filters as { queryKey: QueryKey }).queryKey);
}

describe("invalidatePlanQueries", () => {
  let unregister: () => void = () => {};
  beforeAll(() => {
    unregister = registerInvalidationExtension(ADMIN_HUB_INVALIDATION);
  });
  afterAll(() => unregister());

  it("najemca z sesji: dokładnie klucze reguły `access_plan.changed.v1` (rdzeń + panel)", async () => {
    const keys = await invalidatedBy((qc) => invalidatePlanQueries(qc, TENANT));
    expect(sorted(keys)).toEqual(sorted(invalidationKeysFor(eventOf(), { userId: undefined })));
  });

  it("najemca nieustalony: te same moduły, dziedziny huba u wszystkich najemców", async () => {
    const keys = await invalidatedBy((qc) => invalidatePlanQueries(qc, null));
    expect(keys).toContainEqual(revenueKeys.domain("offer"));
    expect(keys).toContainEqual(billingKeys.admin.plansAll());
    expect(keys.some((k) => k[0] === "admin-revenue" && k.length > 2)).toBe(false);
  });
});

/* -------------------------------------------------------------- haki */

function harness() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const spy = vi.spyOn(qc, "invalidateQueries");
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client: qc }, children);
  return { qc, spy, wrapper };
}

describe("useSaveAccessPlanPatch / useDeleteAccessPlan", () => {
  it("sukces unieważnia klucze huba NAJEMCY Z SESJI (nie z wiersza)", async () => {
    h.db!.setResponse("access_plans", ok([planRow({ tenant_id: "obcy-najemca" })]));
    const { spy, wrapper } = harness();
    const { result } = renderHook(() => useSaveAccessPlanPatch("paywall"), { wrapper });
    await result.current.mutateAsync({
      id: PLAN_ID,
      expectedUpdatedAt: TOKEN,
      patch: { active: false },
    });
    const keys = spy.mock.calls.map(([f]) => (f as { queryKey: QueryKey }).queryKey);
    expect(keys).toContainEqual(revenueKeys.domainTenant("offer", TENANT));
    expect(keys.some((k) => k.includes("obcy-najemca"))).toBe(false);
  });

  it("konflikt nie unieważnia niczego i oddaje błąd 40001 ekranowi", async () => {
    h.db!.setResponse("access_plans", ok([]));
    const { spy, wrapper } = harness();
    const { result } = renderHook(() => useSaveAccessPlanPatch("membership"), { wrapper });
    await expect(
      result.current.mutateAsync({
        id: PLAN_ID,
        expectedUpdatedAt: TOKEN,
        patch: { tier_key: null },
      }),
    ).rejects.toMatchObject({ code: STALE_WRITE_CODE });
    expect(spy).not.toHaveBeenCalled();
  });

  it("usunięcie unieważnia listę planów po sukcesie", async () => {
    h.db!.setResponse("user_subscriptions", okCount(0));
    h.db!.setResponse("access_plans", ok([{ id: PLAN_ID }]));
    const { spy, wrapper } = harness();
    const { result } = renderHook(() => useDeleteAccessPlan(), { wrapper });
    result.current.mutate({ id: PLAN_ID });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(spy.mock.calls.map(([f]) => (f as { queryKey: QueryKey }).queryKey)).toContainEqual(
      billingKeys.admin.plansAll(),
    );
  });
});
