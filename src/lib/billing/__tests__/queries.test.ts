// Warstwa ODCZYTU rozliczeń klienta - 2% linii pokrytych do 18.08.2026.
//
// To ona decyduje, CO klient widzi na swoim ekranie rozliczeń: jakie plany są
// w sprzedaży, jaka subskrypcja jest jego, jakie zamówienia i faktury.
// Wszystkie odczyty per-użytkownik zawężają po `user_id` z SESJI, nie
// z argumentu - bo argument mógłby przyjść z adresu.
//
// Najdroższa reguła w tym pliku: aktywna subskrypcja czytana jest jako
// NAJNOWSZY wiersz z limitem 1, a nie przez `maybeSingle()`. Klient może mieć
// legalnie DWA aktywne wiersze (anulowanie zostawia `active` do końca okresu,
// a nowy zakup wstawia drugi), a `maybeSingle()` rzuca przy więcej niż jednym -
// co wygaszało całą stronę subskrypcji i UKRYWAŁO przycisk rezygnacji
// płacącemu klientowi.
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ok, supabaseFromStub, type SupabaseFromStub } from "@/test/supabaseChain";
import { BILLING_IDS } from "@/test/billing/fixtures";

let chain: SupabaseFromStub;
let session: { user: { id: string } } | null;

const changePlan = vi.fn();
const cancelFn = vi.fn();
const resumeFn = vi.fn();

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => chain.from(table),
    auth: { getSession: () => Promise.resolve({ data: { session } }) },
  },
}));
vi.mock("@/lib/billing/checkout.functions", () => ({
  changeSubscriptionPlan: (arg: unknown) => changePlan(arg),
  cancelSubscription: (arg: unknown) => cancelFn(arg),
  resumeSubscription: (arg: unknown) => resumeFn(arg),
}));

const q = await import("@/lib/billing/queries");

/** Wiersz `access_plans` w kształcie, jaki czyta ten moduł. */
function planRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "plan-1",
    name_pl: "Miesięczny",
    name_en: "Monthly",
    description_pl: null,
    description_en: null,
    price_cents: 4900,
    currency: "PLN",
    interval: "month",
    active: true,
    sort_order: 10,
    badge_pl: null,
    badge_en: null,
    highlighted: false,
    trial_days: 0,
    tier_key: "member",
    ...overrides,
  };
}

function subscriptionRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "sub-1",
    user_id: BILLING_IDS.me,
    plan_id: "plan-1",
    status: "active",
    started_at: "2026-01-01T00:00:00.000Z",
    current_period_end: "2026-09-01T00:00:00.000Z",
    canceled_at: null,
    plan: planRow(),
    ...overrides,
  };
}

beforeEach(() => {
  chain = supabaseFromStub();
  session = { user: { id: BILLING_IDS.me } };
  changePlan.mockReset().mockResolvedValue(undefined);
  cancelFn.mockReset().mockResolvedValue(undefined);
  resumeFn.mockReset().mockResolvedValue(undefined);
});

describe("fetchActivePlans - co jest W SPRZEDAŻY", () => {
  it("czyta WYŁĄCZNIE plany aktywne, w kolejności prezentacyjnej", async () => {
    chain.setResponse("access_plans", ok([planRow()]));

    await q.fetchActivePlans();

    const call = chain.lastChain("access_plans")!;
    expect(call.argsOf("eq")).toEqual(["active", true]);
    expect(call.argsOf("order")).toEqual(["sort_order", { ascending: true }]);
  });

  it("przepisuje wiersz na plan z liczbami, nie napisami", async () => {
    chain.setResponse("access_plans", ok([planRow({ price_cents: "4900", trial_days: "14" })]));

    const plans = await q.fetchActivePlans();

    expect(plans[0].price_cents).toBe(4900);
    expect(plans[0].trial_days).toBe(14);
  });

  it("brak okresu próbnego schodzi na ZERO, nie na `undefined`", async () => {
    chain.setResponse("access_plans", ok([planRow({ trial_days: null })]));

    expect((await q.fetchActivePlans())[0].trial_days).toBe(0);
  });

  it("BŁĄD odczytu jest zgłaszany, nie zamieniany na pusty cennik", async () => {
    chain.setResponse("access_plans", {
      data: null,
      error: Object.assign(new Error("permission denied"), { name: "PostgrestError" }),
    });

    await expect(q.fetchActivePlans()).rejects.toThrow("permission denied");
  });

  it("brak planów daje pustą listę", async () => {
    chain.setResponse("access_plans", { data: null, error: null });

    expect(await q.fetchActivePlans()).toEqual([]);
  });
});

describe("fetchPlanById - strona szczegółów planu", () => {
  it("czyta plan po identyfikatorze", async () => {
    chain.setResponse("access_plans", ok(planRow({ id: "plan-7" })));

    const plan = await q.fetchPlanById("plan-7");

    expect(chain.lastChain("access_plans")!.argsOf("eq")).toEqual(["id", "plan-7"]);
    expect(plan?.id).toBe("plan-7");
  });

  it("NIEISTNIEJĄCY plan daje `null`, nie wyjątek", async () => {
    chain.setResponse("access_plans", ok(null));

    expect(await q.fetchPlanById("nie-ma")).toBeNull();
  });

  it("plan NIEAKTYWNY też się czyta - link do niego mógł zostać wysłany", async () => {
    // Zapytanie NIE filtruje po `active`: klient z zapisanym adresem ma zobaczyć
    // stronę planu, a nie 404, i dopiero na niej dowiedzieć się o wycofaniu.
    chain.setResponse("access_plans", ok(planRow({ active: false })));

    const plan = await q.fetchPlanById("plan-1");

    expect(plan?.active).toBe(false);
    expect(chain.lastChain("access_plans")!.argsOf("eq")).toEqual(["id", "plan-1"]);
  });
});

describe("odczyty PER UŻYTKOWNIK - zawężenie po sesji, nie po argumencie", () => {
  it("zamówienia są zawężane po `user_id` z SESJI", async () => {
    chain.setResponse("payment_orders", ok([]));

    await q.fetchMyOrders();

    expect(chain.lastChain("payment_orders")!.argsOf("eq")).toEqual(["user_id", BILLING_IDS.me]);
  });

  it("BEZ SESJI zamówienia to pusta lista, a nie zapytanie o cudze", async () => {
    session = null;

    expect(await q.fetchMyOrders()).toEqual([]);
    expect(chain.chainsFor("payment_orders")).toHaveLength(0);
  });

  it("zamówienia są najnowsze pierwsze i ograniczone do stu", async () => {
    chain.setResponse("payment_orders", ok([]));

    await q.fetchMyOrders();

    const call = chain.lastChain("payment_orders")!;
    expect(call.argsOf("order")).toEqual(["created_at", { ascending: false }]);
    expect(call.argsOf("limit")).toEqual([100]);
  });

  it("dokumenty rozliczeniowe też są zawężane po sesji i sortowane datą wystawienia", async () => {
    chain.setResponse("billing_documents", ok([]));

    await q.fetchMyBillingDocuments();

    const call = chain.lastChain("billing_documents")!;
    expect(call.argsOf("eq")).toEqual(["user_id", BILLING_IDS.me]);
    expect(call.argsOf("order")).toEqual(["issued_at", { ascending: false }]);
  });

  it("BEZ SESJI dokumenty to pusta lista", async () => {
    session = null;

    expect(await q.fetchMyBillingDocuments()).toEqual([]);
    expect(chain.chainsFor("billing_documents")).toHaveLength(0);
  });

  it("BŁĄD odczytu dokumentów jest zgłaszany", async () => {
    chain.setResponse("billing_documents", {
      data: null,
      error: Object.assign(new Error("row level security"), { name: "PostgrestError" }),
    });

    await expect(q.fetchMyBillingDocuments()).rejects.toThrow("row level security");
  });
});

describe("fetchMySubscription - bramka po defekcie ukrytego przycisku rezygnacji", () => {
  it("czyta AKTYWNĄ subskrypcję zalogowanego, najnowszą, z limitem 1", async () => {
    // Limit 1 zamiast `maybeSingle()`: klient może mieć legalnie DWA aktywne
    // wiersze, a `maybeSingle()` rzuciłby - wygaszając stronę i ukrywając
    // przycisk rezygnacji płacącemu klientowi.
    chain.setResponse("user_subscriptions", ok([subscriptionRow()]));

    await q.fetchMySubscription();

    const call = chain.lastChain("user_subscriptions")!;
    expect(call.argsOf("limit")).toEqual([1]);
    expect(call.argsOf("order")).toEqual(["started_at", { ascending: false }]);
  });

  it("DWA aktywne wiersze nie wywracają odczytu - bierzemy najnowszy", async () => {
    chain.setResponse(
      "user_subscriptions",
      ok([subscriptionRow({ id: "nowsza" }), subscriptionRow({ id: "starsza" })]),
    );

    const sub = await q.fetchMySubscription();

    expect(sub?.id).toBe("nowsza");
  });

  it("zawęża po użytkowniku ORAZ po stanie aktywnym", async () => {
    chain.setResponse("user_subscriptions", ok([subscriptionRow()]));

    await q.fetchMySubscription();

    const eqCalls = chain
      .lastChain("user_subscriptions")!
      .calls.filter((c) => c.method === "eq")
      .map((c) => c.args);
    expect(eqCalls).toEqual([
      ["user_id", BILLING_IDS.me],
      ["status", "active"],
    ]);
  });

  it("dociąga plan JEDNYM zapytaniem (bez drugiego odczytu)", async () => {
    chain.setResponse("user_subscriptions", ok([subscriptionRow()]));

    const sub = await q.fetchMySubscription();

    expect(sub?.plan?.price_cents).toBe(4900);
    expect(chain.chainsFor("access_plans")).toHaveLength(0);
  });

  it("subskrypcja BEZ planu (skasowany plan) nie wywraca odczytu", async () => {
    chain.setResponse("user_subscriptions", ok([subscriptionRow({ plan: null })]));

    const sub = await q.fetchMySubscription();

    expect(sub?.plan).toBeNull();
    expect(sub?.id).toBe("sub-1");
  });

  it("BRAK aktywnej subskrypcji daje `null`", async () => {
    chain.setResponse("user_subscriptions", ok([]));

    expect(await q.fetchMySubscription()).toBeNull();
  });

  it("BEZ SESJI nie pytamy o subskrypcję wcale", async () => {
    session = null;

    expect(await q.fetchMySubscription()).toBeNull();
    expect(chain.chainsFor("user_subscriptions")).toHaveLength(0);
  });

  it("BŁĄD odczytu jest zgłaszany, nie udaje braku subskrypcji", async () => {
    // „Brak subskrypcji" przy błędzie odczytu pokazałby płacącemu klientowi
    // ekran zachęty do zakupu tego, co już ma.
    chain.setResponse("user_subscriptions", {
      data: null,
      error: Object.assign(new Error("timeout"), { name: "PostgrestError" }),
    });

    await expect(q.fetchMySubscription()).rejects.toThrow("timeout");
  });
});

describe("dane do faktury - odczyt i zapis", () => {
  it("profil rozliczeniowy jest zawężany po sesji", async () => {
    chain.setResponse("billing_profiles", ok({ user_id: BILLING_IDS.me }));

    await q.fetchMyBillingProfile();

    expect(chain.lastChain("billing_profiles")!.argsOf("eq")).toEqual(["user_id", BILLING_IDS.me]);
  });

  it("BEZ SESJI profil to `null`", async () => {
    session = null;

    expect(await q.fetchMyBillingProfile()).toBeNull();
    expect(chain.chainsFor("billing_profiles")).toHaveLength(0);
  });

  it("zapis BEZ SESJI odmawia z jednoznacznym powodem", async () => {
    session = null;

    await expect(q.upsertMyBillingProfile({ kind: "person" } as never)).rejects.toThrow(
      "not_authenticated",
    );
  });

  it("zapis BEZ TENANTA odmawia - wiersz bez właściciela nie może powstać", async () => {
    chain.setResponse("profiles", ok(null));

    await expect(q.upsertMyBillingProfile({ kind: "person" } as never)).rejects.toThrow(
      "no_tenant",
    );
    expect(chain.chainsFor("billing_profiles")).toHaveLength(0);
  });

  it("zapis dokłada użytkownika I tenanta, i idzie po parze kolumn", async () => {
    chain.setResponse("profiles", ok({ tenant_id: BILLING_IDS.tenant }));
    chain.setResponse("billing_profiles", ok({ user_id: BILLING_IDS.me }));

    await q.upsertMyBillingProfile({ kind: "company", tax_id: "1234567890" } as never);

    const call = chain.lastChain("billing_profiles")!;
    const [payload, options] = call.argsOf("upsert")!;
    expect(payload).toMatchObject({
      kind: "company",
      user_id: BILLING_IDS.me,
      tenant_id: BILLING_IDS.tenant,
    });
    expect(options).toEqual({ onConflict: "user_id,tenant_id" });
  });

  it("BŁĄD zapisu profilu jest zgłaszany", async () => {
    chain.setResponse("profiles", ok({ tenant_id: BILLING_IDS.tenant }));
    chain.setResponse("billing_profiles", {
      data: null,
      error: Object.assign(new Error("check constraint"), { name: "PostgrestError" }),
    });

    await expect(q.upsertMyBillingProfile({ kind: "person" } as never)).rejects.toThrow(
      "check constraint",
    );
  });
});

describe("zmiana, rezygnacja i wznowienie - WYŁĄCZNIE przez funkcje serwerowe", () => {
  it("zmiana planu idzie funkcją serwerową, nie zapytaniem klienta", async () => {
    // `user_subscriptions` nie daje klientowi UPDATE-u: zapis wprost i tak by
    // odmówił, a gdyby dawał - klient sam przyznałby sobie dostęp.
    await q.changeMySubscriptionPlan("sub-1", "plan-2");

    expect(changePlan).toHaveBeenCalledWith({
      data: { subscriptionId: "sub-1", newPlanId: "plan-2" },
    });
    expect(chain.chainsFor("user_subscriptions")).toHaveLength(0);
  });

  it("rezygnacja idzie funkcją serwerową z kontrolą własności", async () => {
    await q.cancelMySubscription("sub-1");

    expect(cancelFn).toHaveBeenCalledWith({ data: { subscriptionId: "sub-1" } });
    expect(chain.chainsFor("user_subscriptions")).toHaveLength(0);
  });

  it("wznowienie idzie funkcją serwerową", async () => {
    await q.resumeMySubscription("sub-1");

    expect(resumeFn).toHaveBeenCalledWith({ data: { subscriptionId: "sub-1" } });
  });

  it("ODMOWA operatora przy rezygnacji PROPAGUJE się do wołającego", async () => {
    // Gdyby wyjątek był tu zjadany, ekran ogłosiłby „subskrypcja anulowana",
    // a klient dalej byłby obciążany - dokładnie defekt naprawiony 19.08.2026.
    cancelFn.mockRejectedValue(new Error("provider_cancel_failed"));

    await expect(q.cancelMySubscription("sub-1")).rejects.toThrow("provider_cancel_failed");
  });
});
