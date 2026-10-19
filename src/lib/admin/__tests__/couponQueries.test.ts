// KUPONY B2B - unieważnianie, odczyty, podsumowanie P10 i status kampanii
// (`couponQueries.ts`).
//
// Unieważnianie sprawdzamy na PRAWDZIWYM `QueryClient` z wpisami posianymi pod
// kluczami fabryk: asercja czyta `isInvalidated` każdego wpisu, czyli dokładnie
// to, co zdecyduje o odświeżeniu ekranu. Atrapa `invalidateQueries`
// sprawdzałaby tylko, z jakim argumentem ją zawołano - a nie, w które klucze
// ten argument faktycznie trafia.
import { createElement, type ReactNode } from "react";
import { QueryClient, QueryClientProvider, type QueryKey } from "@tanstack/react-query";
import { renderHook } from "@testing-library/react";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { RecordedChain, SupabaseFromStub } from "@/test/supabaseChain";

const h = vi.hoisted(() => ({
  db: null as SupabaseFromStub | null,
  rpc: vi.fn(),
  tenantId: null as string | null,
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => h.db!.from(table),
    rpc: (fn: string, args: unknown) => h.rpc(fn, args),
  },
}));
vi.mock("@/lib/tenant", () => ({ useCurrentTenantId: () => h.tenantId }));

import { ok, supabaseFromStub } from "@/test/supabaseChain";
import {
  analyticsBiStripKey,
  analyticsCouponsKey,
  analyticsStatusKey,
} from "@/lib/analytics/queryKeys";
import { couponKeys as leafCouponKeys } from "@/lib/admin/couponKeys";
import { isStaleWriteError } from "@/lib/billing/planQueries";
import { newsletterKeys } from "@/lib/newsletter/keys";
import type { DomainEventRow, DomainEventType } from "@/lib/realtime/domainEvents";
import {
  invalidationKeysFor,
  registerInvalidationExtension,
} from "@/lib/realtime/eventInvalidationMap";
import { ADMIN_HUB_INVALIDATION } from "@/lib/realtime/eventInvalidationMap.admin";
import { revenueKeys } from "@/lib/revenue/keys";
import * as couponQueries from "../couponQueries";
import {
  COUPON_READ_LIMIT,
  couponAnalyticsSummaryQueryOptions,
  couponCampaignsQueryOptions,
  couponInvalidationKeys,
  couponKeys,
  couponRedemptionsQueryOptions,
  couponTiersQueryOptions,
  fetchCouponAnalyticsSummary,
  invalidateCouponQueries,
  setCampaignStatus,
  useSetCampaignStatus,
} from "../couponQueries";

const TENANT_A = "11111111-1111-4111-8111-111111111111";
const TENANT_B = "22222222-2222-4222-8222-222222222222";

const OD = "2026-07-01T00:00:00.000Z";
const DO = "2026-10-01T00:00:00.000Z";

beforeEach(() => {
  h.db = supabaseFromStub();
  h.rpc.mockReset();
  h.tenantId = TENANT_A;
});

describe("couponKeys - jedna definicja", () => {
  it("re-eksport to ten sam obiekt co liść szyny; `ADMIN_COUPONS_KEY` zniknął", () => {
    expect(couponKeys).toBe(leafCouponKeys);
    expect("ADMIN_COUPONS_KEY" in couponQueries).toBe(false);
  });
});

/* ------------------------------------------------------------ unieważnianie */

/** Klient z wpisami pod każdym kluczem, którego dotyczy (albo nie) mutacja kuponu. */
function seeded(): QueryClient {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  for (const key of [
    couponKeys.admin(),
    couponKeys.plans(),
    couponKeys.tiers(),
    couponKeys.campaigns(),
    analyticsCouponsKey(TENANT_A, OD, DO),
    analyticsCouponsKey(TENANT_A, null, null),
    analyticsCouponsKey(TENANT_B, OD, DO),
    analyticsStatusKey(TENANT_A),
    analyticsBiStripKey(TENANT_A, "vitals", 14),
    revenueKeys.domainTenant("offer", TENANT_A),
    revenueKeys.domainTenant("offer", TENANT_B),
  ]) {
    qc.setQueryData(key, { posiane: true });
  }
  return qc;
}

function invalidated(qc: QueryClient, key: readonly unknown[]): boolean | undefined {
  return qc.getQueryState(key)?.isInvalidated;
}

describe("invalidateCouponQueries - najemca ustalony", () => {
  it("unieważnia listę kuponów razem z katalogami planów i poziomów", async () => {
    const qc = seeded();
    await invalidateCouponQueries(qc, TENANT_A);

    expect(invalidated(qc, couponKeys.admin())).toBe(true);
    expect(invalidated(qc, couponKeys.plans())).toBe(true);
    expect(invalidated(qc, couponKeys.tiers())).toBe(true);
  });

  it("unieważnia analitykę kuponów SWOJEGO najemcy w KAŻDYM zapamiętanym zakresie dat", async () => {
    const qc = seeded();
    await invalidateCouponQueries(qc, TENANT_A);

    expect(invalidated(qc, analyticsCouponsKey(TENANT_A, OD, DO))).toBe(true);
    expect(invalidated(qc, analyticsCouponsKey(TENANT_A, null, null))).toBe(true);
  });

  it("ŚWIADOMA ZMIANA (S1, SPEC §3.4): unieważnia też kampanie i dziedzinę „Oferta” huba najemcy", async () => {
    // Do S1 test przypinał, że kampanie NIE są unieważniane. Wygenerowane
    // kody zmieniają jednak licznik kampanii, a reguła szyny
    // `coupon.changed.v1` unieważnia kampanie w innych kartach - ta karta
    // nie może być jedyną z nieaktualnym licznikiem.
    const qc = seeded();
    await invalidateCouponQueries(qc, TENANT_A);

    expect(invalidated(qc, couponKeys.campaigns())).toBe(true);
    expect(invalidated(qc, revenueKeys.domainTenant("offer", TENANT_A))).toBe(true);
    expect(invalidated(qc, revenueKeys.domainTenant("offer", TENANT_B))).toBe(false);
  });

  it("NIE rusza analityki kuponów innego najemcy ani innych dziedzin analityki", async () => {
    const qc = seeded();
    await invalidateCouponQueries(qc, TENANT_A);

    expect(invalidated(qc, analyticsCouponsKey(TENANT_B, OD, DO))).toBe(false);
    expect(invalidated(qc, analyticsStatusKey(TENANT_A))).toBe(false);
    expect(invalidated(qc, analyticsBiStripKey(TENANT_A, "vitals", 14))).toBe(false);
  });
});

describe("invalidateCouponQueries - najemca nieustalony", () => {
  it("zapis się odbył, więc analityka i tak traci świeżość - po korzeniu, dla każdego najemcy", async () => {
    const qc = seeded();
    await invalidateCouponQueries(qc, null);

    expect(invalidated(qc, couponKeys.admin())).toBe(true);
    expect(invalidated(qc, analyticsCouponsKey(TENANT_A, OD, DO))).toBe(true);
    expect(invalidated(qc, analyticsCouponsKey(TENANT_B, OD, DO))).toBe(true);
    expect(invalidated(qc, revenueKeys.domainTenant("offer", TENANT_B))).toBe(true);
  });
});

function eventOf(type: DomainEventType): DomainEventRow {
  return {
    id: "55555555-5555-4555-a555-555555555555",
    tenant_id: TENANT_A,
    aggregate_type: type.split(".")[0],
    aggregate_id: "33333333-3333-4333-a333-333333333333",
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

  it.each(["coupon.changed.v1", "coupon_campaign.changed.v1"] as const)(
    "%s: rdzeń + panel dla najemcy z sesji, dokładnie",
    (type) => {
      expect(sorted(couponInvalidationKeys(TENANT_A))).toEqual(
        sorted(invalidationKeysFor(eventOf(type), { userId: undefined })),
      );
    },
  );
});

/* --------------------------------------------------------------- odczyty */

describe("queryOptions kuponów", () => {
  it("kampanie: klucz z fabryki, token `updated_at` w kolumnach, najnowsze pierwsze", async () => {
    const opts = couponCampaignsQueryOptions();
    expect(opts.queryKey).toEqual(couponKeys.campaigns());
    h.db!.setResponse("b2b_coupon_campaigns", ok([]));
    await (opts.queryFn as () => Promise<unknown>)();
    const chain = h.db!.lastChain("b2b_coupon_campaigns")!;
    expect(chain.argsOf("select")![0]).toMatch(/\bupdated_at\b/);
    expect(chain.argsOf("order")).toEqual(["created_at", { ascending: false }]);
  });

  it("warstwy: klucz z fabryki, tylko aktywne, wg rangi", async () => {
    const opts = couponTiersQueryOptions();
    expect(opts.queryKey).toEqual(couponKeys.tiers());
    h.db!.setResponse("membership_tiers", ok([]));
    await (opts.queryFn as () => Promise<unknown>)();
    const chain = h.db!.lastChain("membership_tiers")!;
    expect(chain.argsOf("eq")).toEqual(["active", true]);
    expect(chain.argsOf("order")).toEqual(["rank", { ascending: true }]);
  });

  it("realizacje: okno w zapytaniu, stronicowanie bez cichego limitu 500, `truncated` przy suficie", async () => {
    const opts = couponRedemptionsQueryOptions(OD, DO);
    expect(opts.queryKey).toEqual(couponKeys.redemptions(OD, DO));

    const all = Array.from({ length: COUPON_READ_LIMIT + 10 }, (_, i) => ({ id: `r${i}` }));
    h.db!.setResponse("b2b_coupon_redemptions", (chain: RecordedChain) => {
      const [from, to] = chain.argsOf("range") as [number, number];
      return ok(all.slice(from, to + 1));
    });
    const window = (await (opts.queryFn as () => Promise<unknown>)()) as {
      rows: unknown[];
      truncated: boolean;
    };
    const first = h.db!.chainsFor("b2b_coupon_redemptions")[0];
    expect(first.argsOf("gte")).toEqual(["created_at", OD]);
    expect(first.argsOf("lte")).toEqual(["created_at", DO]);
    expect(first.has("limit")).toBe(false);
    expect(window.rows).toHaveLength(COUPON_READ_LIMIT);
    expect(window.truncated).toBe(true);
  });
});

/* -------------------------------------------- podsumowanie analityki (P10) */

type AmountRow = { currency: string; original_cents: number; applied_cents: number };

const isHead = (chain: RecordedChain) =>
  (chain.argsOf("select")![1] as { head?: boolean } | undefined)?.head === true;

/**
 * Atrapa trzech rodzajów zapytań do realizacji: liczba opłaconych (head),
 * liczba rezerwacji (head, `is effects null`) i strony kwot opłaconych.
 */
function summaryResponders(paidRows: AmountRow[]) {
  h.db!.setResponse("b2b_coupons", (chain) =>
    chain.argsOf("select")![0] === "id"
      ? { data: null, error: null, count: 10 }
      : { data: null, error: null, count: 4 },
  );
  h.db!.setResponse("b2b_coupon_redemptions", (chain) => {
    if (isHead(chain)) {
      return { data: null, error: null, count: chain.has("is") ? 3 : paidRows.length };
    }
    const [from, to] = chain.argsOf("range") as [number, number];
    return ok(paidRows.slice(from, to + 1));
  });
}

describe("couponAnalyticsSummary (D-S1-08)", () => {
  it("konwersja = kohorta wydanych z ≥ 1 OPŁACONYM wykorzystaniem; rezerwacje osobno; kwoty per waluta", async () => {
    summaryResponders([
      { currency: "PLN", original_cents: 10_000, applied_cents: 2_000 },
      { currency: "pln", original_cents: 5_000, applied_cents: 500 },
      { currency: "EUR", original_cents: 4_000, applied_cents: 1_000 },
    ]);
    const s = await fetchCouponAnalyticsSummary(TENANT_A, OD, DO);
    expect(s).toEqual({
      issued: 10,
      issuedConverted: 4,
      conversion: 0.4,
      paidRedemptions: 3,
      reservedRedemptions: 3,
      // PLN i EUR NIGDY w jednej liczbie (SPEC I5).
      revenueNet: [
        { currency: "PLN", amountMinor: 12_500 },
        { currency: "EUR", amountMinor: 3_000 },
      ],
      discount: [
        { currency: "PLN", amountMinor: 2_500 },
        { currency: "EUR", amountMinor: 1_000 },
      ],
      truncated: false,
    });
  });

  it("opłacone = efekty zastosowane + zamówienie `live` i nie `mock` przez nazwany FK; zawężenie do najemcy i okna", async () => {
    summaryResponders([]);
    await fetchCouponAnalyticsSummary(TENANT_A, OD, DO);
    const paid = h.db!.chainsFor("b2b_coupon_redemptions").find((c) => isHead(c) && !c.has("is"))!;
    expect(paid.argsOf("select")![0]).toContain(
      "payment_orders!b2b_coupon_redemptions_order_id_fkey!inner(environment, provider)",
    );
    expect(paid.argsOf("not")).toEqual(["effects_applied_at", "is", null]);
    expect(paid.calls.filter((c) => c.method === "eq").map((c) => c.args)).toEqual([
      ["tenant_id", TENANT_A],
      ["payment_orders.environment", "live"],
    ]);
    expect(paid.argsOf("neq")).toEqual(["payment_orders.provider", "mock"]);
    expect(paid.argsOf("gte")).toEqual(["created_at", OD]);

    const converted = h.db!.chainsFor("b2b_coupons").find((c) => c.argsOf("select")![0] !== "id")!;
    expect(converted.argsOf("select")![0]).toContain("b2b_coupon_redemptions!inner(");
    expect(converted.argsOf("not")).toEqual([
      "b2b_coupon_redemptions.effects_applied_at",
      "is",
      null,
    ]);
  });

  it("zero wydanych = konwersja `null` (brak próby nie jest porażką)", async () => {
    summaryResponders([]);
    h.db!.setResponse("b2b_coupons", { data: null, error: null, count: 0 });
    const s = await fetchCouponAnalyticsSummary(TENANT_A, null, null);
    expect(s.conversion).toBeNull();
    expect(s.revenueNet).toEqual([]);
  });

  it("licznik `null` to brak odpowiedzi - błąd, nie zero", async () => {
    summaryResponders([]);
    h.db!.setResponse("b2b_coupons", { data: null, error: null, count: null });
    await expect(fetchCouponAnalyticsSummary(TENANT_A, OD, DO)).rejects.toThrow(
      "count_unavailable",
    );
  });

  it("kwoty ponad sufit odczytu: `truncated`, nie cicha próbka", async () => {
    const many = Array.from({ length: COUPON_READ_LIMIT + 1 }, () => ({
      currency: "PLN",
      original_cents: 100,
      applied_cents: 10,
    }));
    summaryResponders(many);
    const s = await fetchCouponAnalyticsSummary(TENANT_A, OD, DO);
    expect(s.truncated).toBe(true);
    expect(s.paidRedemptions).toBe(COUPON_READ_LIMIT + 1);
  });

  it("klucz pod prefiksem analityki kuponów najemcy (szyna trafia), wyłączony bez najemcy", () => {
    const opts = couponAnalyticsSummaryQueryOptions(TENANT_A, OD, DO);
    const prefix = analyticsCouponsKey(TENANT_A, null, null).slice(0, 3);
    expect(opts.queryKey.slice(0, prefix.length)).toEqual(prefix);
    expect(opts.queryKey).toContain("summary");
    expect(opts.enabled).toBe(true);
    expect(couponAnalyticsSummaryQueryOptions(null, OD, DO).enabled).toBe(false);
  });
});

/* ------------------------------------------------- status kampanii (P04) */

describe("setCampaignStatus / useSetCampaignStatus", () => {
  const TOKEN = "2026-10-19T10:00:00.123456+00:00";

  it("RPC literałem nazwy, surowy token; wynik w camelCase", async () => {
    h.rpc.mockResolvedValue({
      data: { id: "c1", status: "archived", updated_at: "nowy" },
      error: null,
    });
    await expect(
      setCampaignStatus({ campaignId: "c1", status: "archived", expectedUpdatedAt: TOKEN }),
    ).resolves.toEqual({ id: "c1", status: "archived", updatedAt: "nowy" });
    expect(h.rpc).toHaveBeenCalledWith("admin_coupon_campaign_set_status", {
      p_campaign_id: "c1",
      p_status: "archived",
      p_expected_updated_at: TOKEN,
    });
  });

  it("40001 z RPC = konflikt; zły kształt odpowiedzi = błąd", async () => {
    h.rpc.mockResolvedValueOnce({ data: null, error: { message: "stale_write", code: "40001" } });
    const err = await setCampaignStatus({
      campaignId: "c1",
      status: "draft",
      expectedUpdatedAt: TOKEN,
    }).catch((e: unknown) => e);
    expect(isStaleWriteError(err)).toBe(true);

    h.rpc.mockResolvedValueOnce({ data: { id: "c1" }, error: null });
    await expect(
      setCampaignStatus({ campaignId: "c1", status: "draft", expectedUpdatedAt: TOKEN }),
    ).rejects.toThrow("invalid_rpc_shape");
  });

  it("hak: unieważnia kupony najemcy z sesji i kampanie newslettera", async () => {
    h.rpc.mockResolvedValue({
      data: { id: "c1", status: "archived", updated_at: "x" },
      error: null,
    });
    const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    const spy = vi.spyOn(qc, "invalidateQueries");
    const wrapper = ({ children }: { children: ReactNode }) =>
      createElement(QueryClientProvider, { client: qc }, children);
    const { result } = renderHook(() => useSetCampaignStatus(), { wrapper });
    await result.current.mutateAsync({
      campaignId: "c1",
      status: "archived",
      expectedUpdatedAt: TOKEN,
    });
    const keys = spy.mock.calls.map(([f]) => (f as { queryKey: QueryKey }).queryKey);
    expect(sorted(keys)).toEqual(
      sorted([...couponInvalidationKeys(TENANT_A), newsletterKeys.campaignsAll()]),
    );
  });
});
