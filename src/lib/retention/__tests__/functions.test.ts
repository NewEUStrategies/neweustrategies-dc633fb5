// Server fns PRZEPŁYWU ANULOWANIA (S2, P01, P02, Z-09).
//
// Ten plik rozdaje PIENIĄDZE: `acceptRetentionOffer` dopina rabat do
// subskrypcji odchodzącego klienta u operatora. Reguły, których pilnuje:
//   1. własność subskrypcji - lustro operatora albo wiersz lokalny WOŁAJĄCEGO,
//      nie dowolne id z klienta;
//   2. `startRetentionFlow` -> wiersz `started` (wznawiany w ciągu doby),
//      `submitRetentionFeedback` -> UPDATE TEGO SAMEGO wiersza;
//   3. brak powodu = `not_given` (Z-09), „inny" wymaga etykiety;
//   4. wyłącznik `enabled: false`, okno 180 dni, oferta tylko z operatorem;
//   5. rabat przez `applyRetentionOffer` z id przepływu (klucz idempotencji).
//
// Middleware NIE jest tu wykonywane (patrz src/test/serverFn.ts).
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import {
  ok,
  pgError,
  supabaseFromStub,
  type RecordedChain,
  type SupabaseFromStub,
} from "@/test/supabase/chain";
import { callServerFn } from "@/test/serverFn";
import { BASE_NOW } from "@/test/billing/fixtures";

const SUB_ID = "11111111-1111-4111-8111-111111111111";
const REASON_ID = "22222222-2222-4222-8222-222222222222";
const TENANT = "33333333-3333-4333-8333-333333333333";
const ME = "44444444-4444-4444-8444-444444444444";
const FLOW_ID = "55555555-5555-4555-8555-555555555555";

let chain: SupabaseFromStub;
const h = vi.hoisted(() => ({ apply: vi.fn(), getStripeClient: vi.fn() }));

vi.mock("@tanstack/react-start", async () => {
  const { serverFnStubModule } = await import("@/test/serverFnHarness");
  return serverFnStubModule();
});
vi.mock("@/integrations/supabase/auth-middleware", () => ({ requireSupabaseAuth: {} }));
vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: { from: (table: string) => chain.from(table) },
}));
vi.mock("@/lib/retention/applyOffer.server", () => ({
  applyRetentionOffer: (...args: unknown[]) => h.apply(...args),
}));
vi.mock("@/lib/stripe.server", () => ({
  getStripeClient: (env: string) => h.getStripeClient(env),
  resolveEnvironment: (env: string) => env,
}));

const {
  startRetentionFlow,
  submitRetentionFeedback,
  acceptRetentionOffer,
  RETENTION_REASON_NOT_GIVEN,
} = await import("@/lib/retention/functions");

const PROVIDER_SUB = {
  id: SUB_ID,
  tenant_id: TENANT,
  provider_subscription_id: "sub_stripe_1",
  environment: "live",
  status: "active",
};

function call<TResult = unknown>(fn: unknown, data: unknown): Promise<TResult> {
  return callServerFn<TResult>(fn, data, { supabase: null, userId: ME });
}

/** `retention_feedback`: historia ofert (limit), przepływ (maybeSingle), zapisy. */
function feedback(
  opts: {
    prior?: unknown[];
    open?: { id: string } | null;
    flow?: { id: string; outcome: string; offer_accepted: boolean } | null;
    updated?: unknown[];
  } = {},
) {
  return (c: RecordedChain) => {
    if (c.has("insert")) return ok({ id: FLOW_ID });
    if (c.has("update")) return ok(opts.updated ?? [{ id: FLOW_ID }]);
    if (c.has("maybeSingle")) {
      return c.has("gte")
        ? ok(opts.open ?? null)
        : ok(opts.flow ?? { id: FLOW_ID, outcome: "started", offer_accepted: false });
    }
    return ok(opts.prior ?? []);
  };
}

const insertOf = () =>
  chain
    .chainsFor("retention_feedback")
    .find((c) => c.has("insert"))
    ?.argsOf("insert")?.[0] as Record<string, unknown> | undefined;
const updateOf = () =>
  chain
    .chainsFor("retention_feedback")
    .find((c) => c.has("update"))
    ?.argsOf("update")?.[0] as Record<string, unknown> | undefined;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(BASE_NOW);
  chain = supabaseFromStub();
  chain.setResponse("subscriptions", ok(PROVIDER_SUB));
  chain.setResponse("user_subscriptions", ok(null));
  chain.setResponse("retention_feedback", feedback());
  chain.setResponse(
    "retention_settings",
    ok({ enabled: true, discount_pct: 30, discount_periods: 3 }),
  );
  h.apply
    .mockReset()
    .mockResolvedValue({ ok: true, couponId: "coupon_ret_1", durationInMonths: 3 });
  h.getStripeClient.mockReset().mockResolvedValue({ stripe: true });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("własność subskrypcji", () => {
  it("odczyt lustra operatora zawęża po user_id WOŁAJĄCEGO", async () => {
    await call(startRetentionFlow, { subscriptionId: SUB_ID });
    const eqs = chain.lastChain("subscriptions")!.calls.filter((c) => c.method === "eq");
    expect(eqs.map((c) => c.args)).toContainEqual(["user_id", ME]);
  });

  it("bez lustra operatora sprawdza wiersz lokalny; cudza subskrypcja = błąd", async () => {
    chain.setResponse("subscriptions", ok(null));
    await expect(call(startRetentionFlow, { subscriptionId: SUB_ID })).rejects.toThrow(
      "subscription_not_found",
    );
    const eqs = chain.lastChain("user_subscriptions")!.calls.filter((c) => c.method === "eq");
    expect(eqs.map((c) => c.args)).toContainEqual(["user_id", ME]);
    expect(insertOf()).toBeUndefined();
  });

  it("BŁĄD odczytu subskrypcji jest zgłaszany, nie mylony z brakiem własności", async () => {
    chain.setResponse("subscriptions", { data: null, error: pgError("timeout") });
    await expect(call(startRetentionFlow, { subscriptionId: SUB_ID })).rejects.toThrow("timeout");
  });

  it("walidator odrzuca id, które nie jest UUID - bez dotykania bazy", async () => {
    await expect(call(startRetentionFlow, { subscriptionId: "sub-1" })).rejects.toThrow();
    expect(chain.chainsFor("subscriptions")).toHaveLength(0);
  });
});

describe("startRetentionFlow", () => {
  it("wstawia wiersz `started` bez powodu na tenancie SUBSKRYPCJI i zwraca ofertę", async () => {
    const res = await call<Record<string, unknown>>(startRetentionFlow, { subscriptionId: SUB_ID });
    expect(insertOf()).toMatchObject({
      tenant_id: TENANT,
      user_id: ME,
      subscription_id: SUB_ID,
      outcome: "started",
      reason_label: null,
      offer_accepted: false,
    });
    expect(res).toEqual({
      feedbackId: FLOW_ID,
      surveyEnabled: true,
      offer: { available: true, discountPct: 30, discountPeriods: 3 },
    });
  });

  it("otwarty przepływ z ostatniej doby jest WZNAWIANY, nie dublowany", async () => {
    chain.setResponse("retention_feedback", feedback({ open: { id: "flow-open" } }));
    const res = await call<{ feedbackId: string }>(startRetentionFlow, { subscriptionId: SUB_ID });
    expect(res.feedbackId).toBe("flow-open");
    expect(insertOf()).toBeUndefined();
  });

  it("enabled=false: samo potwierdzenie (surveyEnabled false) i brak oferty", async () => {
    chain.setResponse(
      "retention_settings",
      ok({ enabled: false, discount_pct: 30, discount_periods: 3 }),
    );
    const res = await call<Record<string, unknown>>(startRetentionFlow, { subscriptionId: SUB_ID });
    expect(res).toMatchObject({
      surveyEnabled: false,
      offer: { available: false, reason: "disabled" },
    });
  });

  it("subskrypcja lokalna (bez operatora): ankieta tak, oferta nie", async () => {
    chain.setResponse("subscriptions", ok(null));
    chain.setResponse("user_subscriptions", ok({ id: SUB_ID, tenant_id: TENANT }));
    const res = await call<Record<string, unknown>>(startRetentionFlow, { subscriptionId: SUB_ID });
    expect(res).toMatchObject({
      surveyEnabled: true,
      offer: { available: false, reason: "no_provider" },
    });
  });

  it("oferta przyjęta w ostatnich 180 dniach: brak oferty (already_redeemed)", async () => {
    chain.setResponse("retention_feedback", feedback({ prior: [{ id: "old" }] }));
    const res = await call<Record<string, unknown>>(startRetentionFlow, { subscriptionId: SUB_ID });
    expect(res).toMatchObject({ offer: { available: false, reason: "already_redeemed" } });
    const history = chain
      .chainsFor("retention_feedback")
      .find(
        (c) =>
          c.has("limit") &&
          c.calls.some((x) => x.method === "eq" && x.args[0] === "offer_accepted"),
      )!;
    const since = history.calls.find((c) => c.method === "gte")!.args;
    expect(since[0]).toBe("created_at");
    expect(Date.parse(since[1] as string)).toBe(BASE_NOW - 180 * 86_400_000);
  });
});

describe("submitRetentionFeedback - ten sam wiersz", () => {
  const BASE = {
    subscriptionId: SUB_ID,
    feedbackId: FLOW_ID,
    outcome: "canceled",
    offerShown: true,
    reasonId: REASON_ID,
    reasonLabel: "Za drogo",
  };

  it("aktualizuje wiersz przepływu (bez nowego wiersza) wynikiem i powodem", async () => {
    await call(submitRetentionFeedback, { ...BASE, comment: "  za drogo jak na mnie  " });
    expect(updateOf()).toMatchObject({
      outcome: "canceled",
      reason_id: REASON_ID,
      reason_label: "Za drogo",
      comment: "za drogo jak na mnie",
      offer_shown: true,
    });
    const upd = chain.chainsFor("retention_feedback").find((c) => c.has("update"))!;
    expect(upd.calls.filter((c) => c.method === "eq").map((c) => c.args)).toEqual(
      expect.arrayContaining([
        ["id", FLOW_ID],
        ["tenant_id", TENANT],
        ["user_id", ME],
      ]),
    );
    expect(upd.argsOf("in")).toEqual(["outcome", ["started", "abandoned"]]);
    expect(insertOf()).toBeUndefined();
  });

  it("Z-09: brak powodu zapisuje `not_given` i BEZ id powodu", async () => {
    await call(submitRetentionFeedback, { ...BASE, reasonId: REASON_ID, reasonLabel: null });
    expect(updateOf()).toMatchObject({ reason_label: RETENTION_REASON_NOT_GIVEN, reason_id: null });
    expect(RETENTION_REASON_NOT_GIVEN).toBe("not_given");
  });

  it("PUSTY komentarz zapisuje się jako null", async () => {
    await call(submitRetentionFeedback, { ...BASE, comment: "   " });
    expect(updateOf()?.comment).toBeNull();
  });

  it("wiersz już domknięty: decyzja trafia do NOWEGO wiersza (nie ginie)", async () => {
    chain.setResponse("retention_feedback", feedback({ updated: [] }));
    await call(submitRetentionFeedback, { ...BASE, outcome: "saved" });
    expect(insertOf()).toMatchObject({ outcome: "saved", tenant_id: TENANT, user_id: ME });
  });

  it("klient sprzed S2 (bez feedbackId) wstawia zakończony wiersz", async () => {
    const { feedbackId: _f, ...legacy } = BASE;
    await call(submitRetentionFeedback, legacy);
    expect(updateOf()).toBeUndefined();
    expect(insertOf()).toMatchObject({ outcome: "canceled", reason_label: "Za drogo" });
  });

  it("BŁĄD zapisu jest zgłaszany", async () => {
    chain.setResponse("retention_feedback", (c: RecordedChain) =>
      c.has("update") ? { data: null, error: pgError("row level security") } : ok([]),
    );
    await expect(call(submitRetentionFeedback, BASE)).rejects.toThrow("row level security");
  });
});

describe("acceptRetentionOffer - rabat na subskrypcji operatora (P02)", () => {
  const ACCEPT = { subscriptionId: SUB_ID, feedbackId: FLOW_ID, reasonId: null, reasonLabel: null };

  it("dopina rabat przez applyRetentionOffer z id przepływu i warunkami z ustawień", async () => {
    const res = await call(acceptRetentionOffer, ACCEPT);
    expect(res).toEqual({ ok: true, discountPct: 30, discountPeriods: 3 });
    expect(h.getStripeClient).toHaveBeenCalledWith("live");
    expect(h.apply).toHaveBeenCalledWith(
      { stripe: true },
      {
        providerSubscriptionId: "sub_stripe_1",
        feedbackId: FLOW_ID,
        terms: { discountPct: 30, discountPeriods: 3 },
      },
    );
  });

  it("zapis: TEN SAM wiersz -> saved, oferta przyjęta, kupon operatora; bez kuponu B2B", async () => {
    await call(acceptRetentionOffer, ACCEPT);
    expect(updateOf()).toMatchObject({
      outcome: "saved",
      offer_shown: true,
      offer_accepted: true,
      coupon_code: "coupon_ret_1",
      reason_label: "not_given",
    });
    expect(chain.chainsFor("b2b_coupons")).toHaveLength(0);
  });

  it("WYŁĄCZONA oferta nie dotyka operatora", async () => {
    chain.setResponse(
      "retention_settings",
      ok({ enabled: false, discount_pct: 30, discount_periods: 3 }),
    );
    await expect(call(acceptRetentionOffer, ACCEPT)).resolves.toEqual({
      ok: false,
      reason: "offer_disabled",
    });
    expect(h.apply).not.toHaveBeenCalled();
  });

  it("BRAK wiersza ustawień = oferta wyłączona", async () => {
    chain.setResponse("retention_settings", ok(null));
    await expect(call(acceptRetentionOffer, ACCEPT)).resolves.toEqual({
      ok: false,
      reason: "offer_disabled",
    });
  });

  it("DRUGA oferta w oknie 180 dni jest odrzucana", async () => {
    chain.setResponse("retention_feedback", feedback({ prior: [{ id: "old" }] }));
    await expect(call(acceptRetentionOffer, ACCEPT)).resolves.toEqual({
      ok: false,
      reason: "already_redeemed",
    });
    expect(h.apply).not.toHaveBeenCalled();
  });

  it("ponowienie po przyjęciu (ten sam przepływ) nie jest blokowane oknem 180 dni", async () => {
    chain.setResponse(
      "retention_feedback",
      feedback({
        prior: [{ id: FLOW_ID }],
        flow: { id: FLOW_ID, outcome: "saved", offer_accepted: true },
      }),
    );
    await expect(call(acceptRetentionOffer, ACCEPT)).resolves.toMatchObject({ ok: true });
    expect(h.apply).toHaveBeenCalledTimes(1);
  });

  it("subskrypcja lokalna: brak oferty (no_provider) - nie ma płatności do obniżenia", async () => {
    chain.setResponse("subscriptions", ok(null));
    chain.setResponse("user_subscriptions", ok({ id: SUB_ID, tenant_id: TENANT }));
    await expect(call(acceptRetentionOffer, ACCEPT)).resolves.toEqual({
      ok: false,
      reason: "no_provider",
    });
  });

  it("odmowa operatora: wynik provider_error i BEZ zapisu „przyjęta”", async () => {
    h.apply.mockResolvedValue({ ok: false, error: "provider_error", message: "card" });
    await expect(call(acceptRetentionOffer, ACCEPT)).resolves.toEqual({
      ok: false,
      reason: "provider_error",
    });
    expect(updateOf()).toBeUndefined();
  });

  it("cudzy albo domknięty przepływ jest odrzucany", async () => {
    chain.setResponse(
      "retention_feedback",
      feedback({ flow: { id: FLOW_ID, outcome: "canceled", offer_accepted: false } }),
    );
    await expect(call(acceptRetentionOffer, ACCEPT)).rejects.toThrow("retention_flow_not_found");
    expect(h.apply).not.toHaveBeenCalled();
  });
});
