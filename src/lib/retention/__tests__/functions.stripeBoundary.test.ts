// Scenariusz Z-S2-01 (§16.5, kroki 4-8) na GRANICY SDK operatora (I9b, B4).
//
// Instrukcja ręcznej weryfikacji w trybie testowym Stripe zostaje dla
// właściciela tylko w części wizualnej (panel i logi Stripe, portal klienta).
// Reszta jedzie tutaj: server fns przepływu anulowania z PRAWDZIWYM
// `applyOffer.server.ts`, a atrapą jest wyłącznie klient Stripe zwracany przez
// `getStripeClient` - czyli dokładnie to, co w trybie testowym widać w logach
// operatora (parametry kuponu, klucze idempotencji, lista rabatów).
// `functions.test.ts` mockuje `applyRetentionOffer` (reguły serwera),
// `applyOffer.test.ts` - sam moduł rabatu; ten plik sprawdza, że oba spinają
// się w jeden przepływ:
//   krok 4  otwarcie dialogu = wiersz `started`, oferta dostępna;
//   krok 5  przyjęcie: kupon `repeating` 3 mies., 1 użycie, nazwa
//           „Retencja -30%", klucz `retention-coupon:<flow>`, dopięcie do
//           subskrypcji kluczem `retention:<flow>` z zachowaniem rabatu B2B,
//           wiersz `saved` z id kuponu; ponowienie = te same klucze;
//   krok 6  ponowne otwarcie po przyjęciu = NOWY przepływ (zapisany `saved`
//           nie jest wznawiany), „Anuluj mimo to" bez powodu = `canceled`
//           z `not_given`;
//   krok 8  oferta w 180 dniach: `already_redeemed`, drugiego kuponu brak.
// Kroki 7 i 10 oraz MRR po webhooku - patrz dziennik §21.11 B4 (mapa krok → test).
//
// Middleware NIE jest tu wykonywane (patrz src/test/serverFn.ts).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type Stripe from "stripe";

import {
  ok,
  supabaseFromStub,
  type RecordedChain,
  type SupabaseFromStub,
} from "@/test/supabase/chain";
import { callServerFn } from "@/test/serverFn";
import { BASE_NOW } from "@/test/billing/fixtures";

const SUB_ID = "11111111-1111-4111-8111-111111111111";
const TENANT = "33333333-3333-4333-8333-333333333333";
const ME = "44444444-4444-4444-8444-444444444444";
const FLOW_1 = "55555555-5555-4555-8555-555555555551";
const FLOW_2 = "55555555-5555-4555-8555-555555555552";

let chain: SupabaseFromStub;
const h = vi.hoisted(() => ({
  stripe: null as null | ReturnType<typeof fakeStripeSdk>,
  envs: [] as string[],
}));

vi.mock("@tanstack/react-start", async () => {
  const { serverFnStubModule } = await import("@/test/serverFnHarness");
  return serverFnStubModule();
});
vi.mock("@/integrations/supabase/auth-middleware", () => ({ requireSupabaseAuth: {} }));
vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: { from: (table: string) => chain.from(table) },
}));
// Atrapa NA GRANICY SDK: moduł rabatu jest prawdziwy, operator - nie.
vi.mock("@/lib/stripe.server", () => ({
  getStripeClient: async (env: string) => {
    h.envs.push(env);
    return h.stripe;
  },
  resolveEnvironment: (env: string) => env,
}));

const { startRetentionFlow, submitRetentionFeedback, acceptRetentionOffer } =
  await import("@/lib/retention/functions");

/** Klient Stripe w kształcie SDK: subskrypcja z rabatem B2B, miesięczny cykl. */
function fakeStripeSdk() {
  const subscription = {
    id: "sub_stripe_1",
    status: "active",
    discounts: ["di_b2b"],
    items: { data: [{ price: { recurring: { interval: "month", interval_count: 1 } } }] },
  } as unknown as Stripe.Subscription;
  return {
    subscriptions: {
      retrieve: vi.fn(async (..._args: unknown[]) => subscription),
      update: vi.fn(async (..._args: unknown[]) => subscription),
    },
    coupons: {
      create: vi.fn(async (..._args: unknown[]) => ({ id: "coupon_ret_1" }) as Stripe.Coupon),
    },
  };
}

/** Stan `retention_feedback` jednego klienta - przepływy i przyjęta oferta. */
interface FlowRow {
  id: string;
  outcome: string;
  offer_accepted: boolean;
}
let flows: FlowRow[];
let nextFlowId: string;

function feedbackTable(c: RecordedChain) {
  if (c.has("insert")) {
    const row = c.argsOf("insert")?.[0] as { outcome: string; offer_accepted: boolean };
    flows.push({ id: nextFlowId, outcome: row.outcome, offer_accepted: row.offer_accepted });
    return ok({ id: nextFlowId });
  }
  if (c.has("update")) {
    const id = c.calls.find((x) => x.method === "eq" && x.args[0] === "id")?.args[1];
    const patch = c.argsOf("update")?.[0] as Partial<FlowRow>;
    const row = flows.find((f) => f.id === id);
    if (row) Object.assign(row, patch);
    return ok(row ? [{ id: row.id }] : []);
  }
  if (c.has("maybeSingle")) {
    // Otwarty przepływ do wznowienia (`gte flow_started_at`) albo przepływ
    // wskazany przez klienta (accept).
    if (c.has("gte")) {
      const outcome = c.calls.find((x) => x.method === "eq" && x.args[0] === "outcome")?.args[1];
      return ok(flows.filter((f) => f.outcome === outcome).at(-1) ?? null);
    }
    const id = c.calls.find((x) => x.method === "eq" && x.args[0] === "id")?.args[1];
    return ok(flows.find((f) => f.id === id) ?? null);
  }
  // Historia ofert w oknie 180 dni.
  return ok(flows.filter((f) => f.offer_accepted).map((f) => ({ id: f.id })));
}

function call<TResult = unknown>(fn: unknown, data: unknown): Promise<TResult> {
  return callServerFn<TResult>(fn, data, { supabase: null, userId: ME });
}

const updatesOf = () =>
  chain
    .chainsFor("retention_feedback")
    .filter((c) => c.has("update"))
    .map((c) => c.argsOf("update")?.[0] as Record<string, unknown>);

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(BASE_NOW);
  chain = supabaseFromStub();
  flows = [];
  nextFlowId = FLOW_1;
  h.stripe = fakeStripeSdk();
  h.envs = [];
  chain.setResponse(
    "subscriptions",
    ok({
      id: SUB_ID,
      tenant_id: TENANT,
      provider_subscription_id: "sub_stripe_1",
      environment: "sandbox",
      status: "active",
    }),
  );
  chain.setResponse("user_subscriptions", ok(null));
  chain.setResponse("retention_feedback", feedbackTable);
  chain.setResponse(
    "retention_settings",
    ok({ enabled: true, discount_pct: 30, discount_periods: 3 }),
  );
});

afterEach(() => {
  vi.useRealTimers();
});

describe("Z-S2-01 - przepływ anulowania z ofertą, atrapa Stripe na granicy SDK", () => {
  it("krok 4-5: started -> przyjęcie: kupon, klucze idempotencji, rabaty zachowane, wiersz saved", async () => {
    const start = await call<{ feedbackId: string; offer: unknown }>(startRetentionFlow, {
      subscriptionId: SUB_ID,
    });
    expect(start).toMatchObject({
      feedbackId: FLOW_1,
      offer: { available: true, discountPct: 30, discountPeriods: 3 },
    });
    expect(flows).toEqual([{ id: FLOW_1, outcome: "started", offer_accepted: false }]);

    const accepted = await call(acceptRetentionOffer, {
      subscriptionId: SUB_ID,
      feedbackId: FLOW_1,
      reasonId: null,
      reasonLabel: null,
    });
    expect(accepted).toEqual({ ok: true, discountPct: 30, discountPeriods: 3 });

    // Środowisko z wiersza subskrypcji (tryb testowy = sandbox), nie z klienta.
    expect(h.envs).toEqual(["sandbox"]);
    const stripe = h.stripe!;
    expect(stripe.subscriptions.retrieve).toHaveBeenCalledWith("sub_stripe_1");
    expect(stripe.coupons.create).toHaveBeenCalledWith(
      {
        percent_off: 30,
        duration: "repeating",
        duration_in_months: 3,
        max_redemptions: 1,
        name: "Retencja -30%",
        metadata: {
          source: "retention",
          feedback_id: FLOW_1,
          provider_subscription_id: "sub_stripe_1",
        },
      },
      { idempotencyKey: `retention-coupon:${FLOW_1}` },
    );
    expect(stripe.subscriptions.update).toHaveBeenCalledWith(
      "sub_stripe_1",
      { discounts: [{ discount: "di_b2b" }, { coupon: "coupon_ret_1" }] },
      { idempotencyKey: `retention:${FLOW_1}` },
    );
    expect(updatesOf().at(-1)).toMatchObject({
      outcome: "saved",
      offer_shown: true,
      offer_accepted: true,
      coupon_code: "coupon_ret_1",
    });
  });

  it("krok 5: ponowienie przyjęcia (zerwane połączenie) idzie tymi samymi kluczami", async () => {
    await call(startRetentionFlow, { subscriptionId: SUB_ID });
    const accept = {
      subscriptionId: SUB_ID,
      feedbackId: FLOW_1,
      reasonId: null,
      reasonLabel: null,
    };
    await call(acceptRetentionOffer, accept);
    await expect(call(acceptRetentionOffer, accept)).resolves.toMatchObject({ ok: true });

    const stripe = h.stripe!;
    const keys = (calls: unknown[][]) => calls.map((args) => args.at(-1));
    expect(keys(stripe.coupons.create.mock.calls)).toEqual([
      { idempotencyKey: `retention-coupon:${FLOW_1}` },
      { idempotencyKey: `retention-coupon:${FLOW_1}` },
    ]);
    expect(keys(stripe.subscriptions.update.mock.calls)).toEqual([
      { idempotencyKey: `retention:${FLOW_1}` },
      { idempotencyKey: `retention:${FLOW_1}` },
    ]);
  });

  it("krok 6 i 8: ponowne otwarcie = nowy przepływ, oferta już wykorzystana, anulowanie z not_given", async () => {
    await call(startRetentionFlow, { subscriptionId: SUB_ID });
    await call(acceptRetentionOffer, {
      subscriptionId: SUB_ID,
      feedbackId: FLOW_1,
      reasonId: null,
      reasonLabel: null,
    });

    nextFlowId = FLOW_2;
    const reopened = await call<{ feedbackId: string; offer: unknown }>(startRetentionFlow, {
      subscriptionId: SUB_ID,
    });
    // Przepływ `saved` nie jest wznawiany - wznowienie szuka tylko `started`.
    expect(reopened).toEqual({
      feedbackId: FLOW_2,
      surveyEnabled: true,
      offer: { available: false, reason: "already_redeemed" },
    });

    // Klient i tak próbuje przyjąć (stara karta): odmowa BEZ drugiego kuponu.
    await expect(
      call(acceptRetentionOffer, {
        subscriptionId: SUB_ID,
        feedbackId: FLOW_2,
        reasonId: null,
        reasonLabel: null,
      }),
    ).resolves.toEqual({ ok: false, reason: "already_redeemed" });
    expect(h.stripe!.coupons.create).toHaveBeenCalledTimes(1);

    // „Anuluj mimo to" na kroku 1 - bez powodu.
    await call(submitRetentionFeedback, {
      subscriptionId: SUB_ID,
      feedbackId: FLOW_2,
      outcome: "canceled",
      offerShown: false,
      reasonId: null,
      reasonLabel: null,
    });
    expect(flows.find((f) => f.id === FLOW_2)).toMatchObject({ outcome: "canceled" });
    expect(updatesOf().at(-1)).toMatchObject({
      outcome: "canceled",
      reason_label: "not_given",
      reason_id: null,
    });
    // Pierwszy przepływ został uratowany - jego wynik się nie zmienia.
    expect(flows.find((f) => f.id === FLOW_1)).toMatchObject({ outcome: "saved" });
  });

  it("krok 10: retention_settings.enabled=false - samo potwierdzenie, operator nietknięty", async () => {
    chain.setResponse(
      "retention_settings",
      ok({ enabled: false, discount_pct: 30, discount_periods: 3 }),
    );
    await expect(call(startRetentionFlow, { subscriptionId: SUB_ID })).resolves.toMatchObject({
      surveyEnabled: false,
      offer: { available: false, reason: "disabled" },
    });
    await expect(
      call(acceptRetentionOffer, {
        subscriptionId: SUB_ID,
        feedbackId: FLOW_1,
        reasonId: null,
        reasonLabel: null,
      }),
    ).resolves.toEqual({ ok: false, reason: "offer_disabled" });
    expect(h.envs).toEqual([]);
    expect(h.stripe!.coupons.create).not.toHaveBeenCalled();
  });
});
