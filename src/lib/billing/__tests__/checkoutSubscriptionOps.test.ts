// PO SPRZEDAŻY: finalizacja zamówienia w trybie mock oraz samoobsługowe
// anulowanie, zmiana planu i wznowienie subskrypcji.
//
// TE CZTERY HANDLERY ŁĄCZY JEDNA REGUŁA KOLEJNOŚCI: najpierw operator, potem
// baza. Jeśli operator odmówi, wiersz w bazie NIE MOŻE twierdzić, że
// subskrypcja jest anulowana albo przełączona - interfejs pokazywałby wtedy
// „anulowano", a karta klienta byłaby dalej obciążana. Odwrócenie tej
// kolejności jest defektem prawnym, nie kosmetycznym, więc każdy przypadek
// odmowy operatora sprawdza tu również, że baza została NIETKNIĘTA.
//
// DRUGA REGUŁA: WŁASNOŚĆ. Wszystkie cztery handlery pracują rolą serwisową
// (RLS `user_subscriptions` nie daje użytkownikowi UPDATE, bo klient mógłby
// sam sobie przedłużyć dostęp), więc jedynym zamkiem jest JAWNY warunek
// `user_id = wołający` w zapytaniu. Testy poniżej czytają ten warunek
// z zapisanego łańcucha - nie z komentarza w kodzie.
//
// TRZECIA REGUŁA: FINALIZACJA MOCK NIE MOŻE ISTNIEĆ NA PRODUKCJI. Gdy dostawca
// jest skonfigurowany, `finalizeCheckout` jest świadomym no-opem (źródłem
// prawdy jest webhook); gdy nie jest, a build jest produkcyjny - odmawia.
// Inaczej dałoby się nadać sobie płatne uprawnienie jednym żądaniem.
//
// GRANICE ATRAPOWANE: rola serwisowa Supabase, klient operatora, żądanie
// frameworka. `grant.server`, `couponEffects.server`, `subscriptionProvider`
// i `catalog` jadą PRAWDZIWE.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Tables } from "@/integrations/supabase/types";
import { isoFuture, isoPast, stripeStub } from "@/test/billing/fixtures";
import {
  fail,
  ok,
  supabaseFromStub,
  type RecordedChain,
  type SupabaseFromStub,
  type SupabaseResult,
} from "@/test/supabaseChain";

const SUB_ID = "aaaaaaaa-1111-4000-8000-000000000001";
const PLAN_ID = "bbbbbbbb-1111-4000-8000-000000000002";
const NEW_PLAN_ID = "cccccccc-1111-4000-8000-000000000003";
const ORDER_ID = "dddddddd-1111-4000-8000-000000000004";
const USER_ID = "user-wlasciciel";

const h = vi.hoisted(() => {
  const calls: { method: string; args: unknown[] }[] = [];
  return { calls };
});

vi.mock("@tanstack/react-start", async () =>
  (await import("@/test/serverFnHarness")).serverFnStubModule(),
);

vi.mock("@tanstack/react-start/server", () => ({
  getRequest: () =>
    new Request("https://kasa.example.org/checkout", {
      headers: { "x-forwarded-proto": "https", "x-forwarded-host": "kasa.example.org" },
    }),
}));

vi.mock("@/integrations/supabase/auth-middleware", () => ({
  requireSupabaseAuth: { name: "requireSupabaseAuth" },
}));

// Rola serwisowa jest granicą: cztery handlery i ich sąsiedzi (`grant.server`,
// `couponEffects.server`) czytają i piszą przez nią, więc podmieniamy JĄ,
// a nie sąsiadów.
vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    from: (table: string) => adminChain.from(table),
    rpc: (fn: string, args: Record<string, unknown> = {}) => {
      adminRpcCalls.push({ fn, args });
      const planned = adminRpcResponses.get(fn);
      return Promise.resolve(planned ?? ok(null));
    },
  },
}));

vi.mock("@/lib/stripe.server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/stripe.server")>();
  return {
    ...actual,
    createStripeClient: (env: string) => {
      h.calls.push({ method: "createStripeClient", args: [env] });
      return stripe;
    },
  };
});

const { callServerFn } = await import("@/test/serverFn");
const { finalizeCheckout, cancelSubscription, changeSubscriptionPlan, resumeSubscription } =
  await import("@/lib/billing/checkout.functions");

// --- stan współdzielony z fabrykami atrap -----------------------------------

let adminChain: SupabaseFromStub;
let adminRpcCalls: { fn: string; args: Record<string, unknown> }[];
let adminRpcResponses: Map<string, SupabaseResult>;

/** Atrapa operatora: bazowy `stripeStub()` + katalog cen dla zmiany planu. */
type ProviderStub = ReturnType<typeof stripeStub> & {
  prices: { list: ReturnType<typeof vi.fn> };
};
let stripe: ProviderStub;

function providerStub(): ProviderStub {
  const base = stripeStub();
  return {
    ...base,
    prices: { list: vi.fn(() => Promise.resolve({ data: [{ id: "price_pro" }] })) },
  };
}

// --- kształty wierszy -------------------------------------------------------

/** Kolumny subskrypcji, które te handlery naprawdę czytają. */
type SubscriptionRow = Pick<
  Tables<"user_subscriptions">,
  "id" | "tenant_id" | "plan_id" | "status" | "external_ref" | "canceled_at" | "current_period_end"
>;

type PlanRow = Pick<
  Tables<"access_plans">,
  | "id"
  | "tenant_id"
  | "active"
  | "price_cents"
  | "currency"
  | "interval"
  | "tier_key"
  | "name_pl"
  | "name_en"
>;

type OrderRow = Pick<
  Tables<"payment_orders">,
  | "id"
  | "user_id"
  | "tenant_id"
  | "plan_id"
  | "kind"
  | "entity_type"
  | "entity_id"
  | "amount_cents"
  | "currency"
>;

function subscriptionRow(over: Partial<SubscriptionRow> = {}): SubscriptionRow {
  return {
    id: SUB_ID,
    tenant_id: "tenant-alfa",
    plan_id: PLAN_ID,
    status: "active",
    external_ref: "sub_operator_1",
    canceled_at: null,
    current_period_end: isoFuture(30),
    ...over,
  };
}

function planRow(over: Partial<PlanRow> = {}): PlanRow {
  return {
    id: NEW_PLAN_ID,
    tenant_id: "tenant-alfa",
    active: true,
    price_cents: 9900,
    currency: "PLN",
    interval: "month",
    tier_key: "pro",
    name_pl: "Pro",
    name_en: "Pro",
    ...over,
  };
}

function orderRow(over: Partial<OrderRow> = {}): OrderRow {
  return {
    id: ORDER_ID,
    user_id: USER_ID,
    tenant_id: "tenant-alfa",
    plan_id: PLAN_ID,
    kind: "subscription",
    entity_type: null,
    entity_id: null,
    amount_cents: 4900,
    currency: "PLN",
    ...over,
  };
}

/** Migawka subskrypcji u operatora w kształcie, jaki czyta snapshot. */
function providerSnapshot(lookupKey = "plus_monthly"): Record<string, unknown> {
  return {
    id: "sub_operator_1",
    customer: "cus_1",
    items: {
      data: [
        {
          id: "si_1",
          quantity: 1,
          price: { id: "price_plus", lookup_key: lookupKey },
          current_period_start: 1_780_000_000,
          current_period_end: 1_790_000_000,
        },
      ],
    },
  };
}

function context() {
  return { supabase: { from: () => undefined }, userId: USER_ID, claims: {} };
}

/** Łańcuch ZAPISUJĄCY do tabeli (odróżniamy go od odczytu tej samej tabeli). */
function writeChain(table: string): RecordedChain | undefined {
  return adminChain.chainsFor(table).find((c) => c.has("update"));
}

function readChain(table: string): RecordedChain | undefined {
  return adminChain.chainsFor(table).find((c) => !c.has("update") && !c.has("insert"));
}

beforeEach(() => {
  h.calls.length = 0;
  adminChain = supabaseFromStub();
  adminRpcCalls = [];
  adminRpcResponses = new Map<string, SupabaseResult>();
  stripe = providerStub();

  // Domyślnie: bramka SKONFIGUROWANA (to jest stan produkcyjny), wartości
  // syntetyczne - klient operatora jest atrapą, więc nic nie wychodzi do sieci.
  vi.stubEnv("LOVABLE_API_KEY", "klucz-testowy-bramki");
  vi.stubEnv("STRIPE_SANDBOX_API_KEY", "klucz-testowy-piaskownicy");
  vi.stubEnv("BILLING_ALLOW_MOCK", "");

  adminChain.setResponse("user_subscriptions", (query) =>
    query.has("update") ? ok([{ id: SUB_ID }]) : ok(subscriptionRow()),
  );
  adminChain.setResponse("access_plans", ok(planRow()));
  adminChain.setResponse("payment_orders", ok(orderRow()));
  adminChain.setResponse("user_purchases", ok(null));
  adminRpcResponses.set("apply_b2b_coupon_effects", ok({ applied: true }));
});

afterEach(() => {
  vi.unstubAllEnvs();
});

// ---------------------------------------------------------------------------

describe("finalizeCheckout - nie da się nią ominąć realnej płatności", () => {
  it("z działającym dostawcą jest ŚWIADOMYM no-opem: źródłem prawdy jest webhook", async () => {
    const result = await callServerFn<{ ok: boolean; reason?: string }>(
      finalizeCheckout,
      { order_id: ORDER_ID },
      context(),
    );

    expect(result).toEqual({ ok: false, reason: "provider_mode" });
    expect(adminChain.chains).toHaveLength(0);
  });

  it("PRODUKCJA bez dostawcy ODMAWIA finalizacji - inaczej dostęp rozdaje się sam", async () => {
    vi.stubEnv("LOVABLE_API_KEY", "");
    vi.stubEnv("STRIPE_SANDBOX_API_KEY", "");
    vi.stubEnv("NODE_ENV", "production");
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await callServerFn<{ ok: boolean; reason?: string }>(
      finalizeCheckout,
      { order_id: ORDER_ID },
      context(),
    );

    expect(result).toEqual({ ok: false, reason: "mock_disabled" });
    expect(adminChain.chains).toHaveLength(0);
    expect(logged).toHaveBeenCalled();
    logged.mockRestore();
  });

  it("finalizuje WYŁĄCZNIE własne, jeszcze nieopłacone zamówienie", async () => {
    // Trzy zamki w jednym zapytaniu: identyfikator, właściciel i status inny
    // niż `paid`. Bez warunku właściciela dowolny zalogowany użytkownik
    // finalizowałby cudze zamówienie i przejmował jego uprawnienie.
    vi.stubEnv("LOVABLE_API_KEY", "");
    vi.stubEnv("STRIPE_SANDBOX_API_KEY", "");

    await callServerFn(finalizeCheckout, { order_id: ORDER_ID }, context());

    const query = adminChain.chainsFor("payment_orders").at(0);
    expect(query?.calls.filter((c) => c.method === "eq").map((c) => c.args)).toEqual([
      ["id", ORDER_ID],
      ["user_id", USER_ID],
    ]);
    expect(query?.argsOf("neq")).toEqual(["status", "paid"]);
  });

  it("POWTÓRZONA finalizacja nie nadaje uprawnienia drugi raz", async () => {
    // Zapytanie aktualizuje zero wierszy, bo zamówienie jest już `paid` -
    // handler musi to odczytać jako „zrobione", a nie jako awarię.
    vi.stubEnv("LOVABLE_API_KEY", "");
    vi.stubEnv("STRIPE_SANDBOX_API_KEY", "");
    adminChain.setResponse("payment_orders", ok(null));

    const result = await callServerFn<{ ok: boolean; alreadyFinalized?: boolean }>(
      finalizeCheckout,
      { order_id: ORDER_ID },
      context(),
    );

    expect(result).toEqual({ ok: true, alreadyFinalized: true });
    expect(adminChain.chainsFor("user_subscriptions")).toHaveLength(0);
    expect(adminRpcCalls).toHaveLength(0);
  });

  it("BŁĄD zapisu jest zgłaszany - nadanie uprawnienia nie może pójść na ślepo", async () => {
    vi.stubEnv("LOVABLE_API_KEY", "");
    vi.stubEnv("STRIPE_SANDBOX_API_KEY", "");
    adminChain.setResponse("payment_orders", fail("deadlock detected"));

    await expect(callServerFn(finalizeCheckout, { order_id: ORDER_ID }, context())).rejects.toThrow(
      "deadlock detected",
    );
  });

  it("opłacone zamówienie nadaje uprawnienie i uruchamia efekty kuponu", async () => {
    // Ta sama ścieżka co w webhooku operatora - kupon z `grants_tier_key` ma
    // działać identycznie w obu trybach, inaczej tryb mock „gubi" warstwę.
    vi.stubEnv("LOVABLE_API_KEY", "");
    vi.stubEnv("STRIPE_SANDBOX_API_KEY", "");
    adminChain.setResponse("access_plans", ok({ interval: "month" }));
    // Brak wcześniejszego wiersza uprawnienia = ścieżka NADANIA (insert),
    // a nie odświeżenia istniejącego okresu.
    adminChain.setResponse("user_subscriptions", ok(null));

    const result = await callServerFn<{ ok: boolean }>(
      finalizeCheckout,
      { order_id: ORDER_ID },
      context(),
    );

    expect(result).toEqual({ ok: true });
    expect(adminChain.chainsFor("user_subscriptions").some((c) => c.has("insert"))).toBe(true);
    expect(adminRpcCalls).toEqual([
      { fn: "apply_b2b_coupon_effects", args: { _order_id: ORDER_ID } },
    ]);
  });

  it("identyfikator zamówienia o złym kształcie odrzuca WALIDATOR", async () => {
    await expect(
      callServerFn(finalizeCheckout, { order_id: "nie-uuid" }, context()),
    ).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------

describe("cancelSubscription - rezygnacja klienta", () => {
  const cancel = () =>
    callServerFn<{ ok: boolean; alreadyCanceled?: boolean }>(
      cancelSubscription,
      { subscriptionId: SUB_ID },
      context(),
    );

  it("BŁĄD odczytu subskrypcji jest zgłaszany", async () => {
    adminChain.setResponse("user_subscriptions", fail("connection reset"));

    await expect(cancel()).rejects.toThrow("connection reset");
  });

  it("CUDZA subskrypcja nie istnieje z punktu widzenia wołającego", async () => {
    // Zapytanie jest zawężone do `user_id` wołającego, więc cudzy wiersz wraca
    // jako brak. To jedyny zamek - rola serwisowa omija RLS.
    adminChain.setResponse("user_subscriptions", ok(null));

    await expect(cancel()).rejects.toThrow("subscription_not_found");
    expect(
      readChain("user_subscriptions")
        ?.calls.filter((c) => c.method === "eq")
        .map((c) => c.args),
    ).toEqual([
      ["id", SUB_ID],
      ["user_id", USER_ID],
    ]);
  });

  it("subskrypcja już anulowana nie jest anulowana po raz drugi u operatora", async () => {
    adminChain.setResponse("user_subscriptions", ok(subscriptionRow({ canceled_at: isoPast(1) })));

    const result = await cancel();

    expect(result).toEqual({ ok: true, alreadyCanceled: true });
    expect(stripe.subscriptions.update).not.toHaveBeenCalled();
  });

  it("anulowanie idzie NAJPIERW do operatora, z zachowaniem opłaconego okresu", async () => {
    const result = await cancel();

    expect(stripe.subscriptions.update).toHaveBeenCalledWith("sub_operator_1", {
      cancel_at_period_end: true,
    });
    expect(result).toEqual({ ok: true, alreadyCanceled: false });
  });

  it("ODMOWA OPERATORA NIE oznacza wiersza jako anulowanego", async () => {
    // To jest sedno reguły kolejności: interfejs mówiłby „anulowano", a karta
    // klienta byłaby dalej obciążana co miesiąc.
    stripe.subscriptions.update.mockRejectedValue(new Error("subscription locked"));
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(cancel()).rejects.toThrow("provider_cancel_failed");
    expect(writeChain("user_subscriptions")).toBeUndefined();
    logged.mockRestore();
  });

  it("subskrypcja BEZ identyfikatora u operatora (dożywotnia) omija operatora", async () => {
    adminChain.setResponse("user_subscriptions", (query) =>
      query.has("update") ? ok([{ id: SUB_ID }]) : ok(subscriptionRow({ external_ref: ORDER_ID })),
    );

    const result = await cancel();

    expect(stripe.subscriptions.update).not.toHaveBeenCalled();
    expect(result).toEqual({ ok: true, alreadyCanceled: false });
  });

  it("bez skonfigurowanej bramki operator nie jest wołany w ogóle", async () => {
    vi.stubEnv("LOVABLE_API_KEY", "");
    vi.stubEnv("STRIPE_SANDBOX_API_KEY", "");

    const result = await cancel();

    expect(h.calls).toHaveLength(0);
    expect(result).toEqual({ ok: true, alreadyCanceled: false });
  });

  it("zapis jest WARUNKOWY - anuluje tylko wiersz jeszcze nieanulowany", async () => {
    await cancel();

    expect(writeChain("user_subscriptions")?.argsOf("is")).toEqual(["canceled_at", null]);
  });

  it("BŁĄD zapisu jest zgłaszany", async () => {
    adminChain.setResponse("user_subscriptions", (query) =>
      query.has("update") ? fail("row locked") : ok(subscriptionRow()),
    );

    await expect(cancel()).rejects.toThrow("row locked");
  });

  it("wyścig dwóch rezygnacji: druga nie kłamie, że coś zmieniła", async () => {
    adminChain.setResponse("user_subscriptions", (query) =>
      query.has("update") ? ok([]) : ok(subscriptionRow()),
    );

    const result = await cancel();

    expect(result).toEqual({ ok: true, alreadyCanceled: true });
  });
});

// ---------------------------------------------------------------------------

describe("changeSubscriptionPlan - upgrade i downgrade z samoobsługi", () => {
  const change = (newPlanId = NEW_PLAN_ID) =>
    callServerFn<{ ok: boolean }>(
      changeSubscriptionPlan,
      { subscriptionId: SUB_ID, newPlanId },
      context(),
    );

  beforeEach(() => {
    stripe.subscriptions.retrieve.mockResolvedValue(providerSnapshot());
    stripe.subscriptions.update.mockResolvedValue({
      items: { data: [{ current_period_end: 1_795_000_000 }] },
    });
  });

  it("BŁĄD odczytu subskrypcji jest zgłaszany", async () => {
    adminChain.setResponse("user_subscriptions", fail("connection reset"));

    await expect(change()).rejects.toThrow("connection reset");
  });

  it("CUDZA subskrypcja: brak wiersza, brak zmiany planu", async () => {
    adminChain.setResponse("user_subscriptions", ok(null));

    await expect(change()).rejects.toThrow("subscription_not_found");
  });

  it("subskrypcja NIEAKTYWNA nie jest przedmiotem zmiany planu", async () => {
    adminChain.setResponse("user_subscriptions", ok(subscriptionRow({ status: "canceled" })));

    await expect(change()).rejects.toThrow("subscription_not_active");
  });

  it("po wygaśnięciu opłaconego okresu potrzebny jest NOWY checkout", async () => {
    adminChain.setResponse(
      "user_subscriptions",
      ok(subscriptionRow({ current_period_end: isoPast(1) })),
    );

    await expect(change()).rejects.toThrow("subscription_period_ended");
  });

  it("zmiana na TEN SAM plan jest odrzucana zanim ruszy operator", async () => {
    await expect(change(PLAN_ID)).rejects.toThrow("same_plan");
    expect(h.calls).toHaveLength(0);
  });

  it("BŁĄD odczytu planu docelowego jest zgłaszany", async () => {
    adminChain.setResponse("access_plans", fail("permission denied"));

    await expect(change()).rejects.toThrow("permission denied");
  });

  it("plan docelowy nieistniejący jest odmową", async () => {
    adminChain.setResponse("access_plans", ok(null));

    await expect(change()).rejects.toThrow("plan_not_found");
  });

  it("plan docelowy NIEAKTYWNY jest odmową", async () => {
    adminChain.setResponse("access_plans", ok(planRow({ active: false })));

    await expect(change()).rejects.toThrow("plan_not_found");
  });

  it("plan INNEGO NAJEMCY jest odmową - rola serwisowa omija RLS, więc zamek jest tutaj", async () => {
    // To jedyne miejsce, w którym izolacja najemcy jest sprawdzana w kodzie:
    // odczyt idzie `supabaseAdmin`, więc baza sama go nie zatrzyma.
    adminChain.setResponse("access_plans", ok(planRow({ tenant_id: "tenant-beta" })));

    await expect(change()).rejects.toThrow("plan_not_found");
    expect(h.calls).toHaveLength(0);
  });

  it("plan JEDNORAZOWY nie jest celem zmiany subskrypcji", async () => {
    adminChain.setResponse("access_plans", ok(planRow({ interval: "one_time" })));

    await expect(change()).rejects.toThrow("plan_not_recurring");
  });

  it("plan bez odpowiednika w katalogu operatora nie da się przełączyć", async () => {
    adminChain.setResponse("access_plans", ok(planRow({ tier_key: "decision_lab" })));

    await expect(change()).rejects.toThrow("plan_not_switchable");
  });

  it("gdy migawka od operatora nie przyjdzie, plan NIE jest zmieniany w bazie", async () => {
    stripe.subscriptions.retrieve.mockRejectedValue(new Error("provider timeout"));
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(change()).rejects.toThrow("provider_plan_change_failed");
    expect(writeChain("user_subscriptions")).toBeUndefined();
    logged.mockRestore();
  });

  it("gdy operator ma już cenę docelową, zmiana jest odmawiana jako ten sam plan", async () => {
    adminChain.setResponse("user_subscriptions", ok(subscriptionRow({ plan_id: "inny-plan" })));
    stripe.subscriptions.retrieve.mockResolvedValue(providerSnapshot("pro_monthly"));

    await expect(change()).rejects.toThrow("same_plan");
  });

  it("ODMOWA PRZEŁĄCZENIA u operatora zostawia bazę nietkniętą", async () => {
    // `on_payment_failure=prevent_change`: nieudana dopłata nie może zmienić
    // planu w bazie, bo klient dostałby wyższą warstwę bez zapłaty.
    stripe.prices.list.mockResolvedValue({ data: [] });
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(change()).rejects.toThrow("provider_plan_change_failed");
    expect(writeChain("user_subscriptions")).toBeUndefined();
    logged.mockRestore();
  });

  it("subskrypcja bez identyfikatora u operatora nie ma czego przełączać", async () => {
    adminChain.setResponse("user_subscriptions", ok(subscriptionRow({ external_ref: ORDER_ID })));

    await expect(change()).rejects.toThrow("subscription_not_switchable");
  });

  it("PRODUKCJA bez dostawcy odmawia zmiany planu", async () => {
    vi.stubEnv("LOVABLE_API_KEY", "");
    vi.stubEnv("STRIPE_SANDBOX_API_KEY", "");
    vi.stubEnv("NODE_ENV", "production");
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(change()).rejects.toThrow("billing_unconfigured");
    expect(writeChain("user_subscriptions")).toBeUndefined();
    logged.mockRestore();
  });

  it("upgrade zapisuje nowy plan, czyści anulowanie i bierze kotwicę okresu OD OPERATORA", async () => {
    const result = await change();

    expect(result).toEqual({ ok: true });
    const patch = writeChain("user_subscriptions")?.argsOf("update")?.[0];
    expect(patch).toMatchObject({
      plan_id: NEW_PLAN_ID,
      canceled_at: null,
      current_period_end: new Date(1_795_000_000 * 1000).toISOString(),
    });
  });

  it("gdy operator nie poda kotwicy, zostaje ta z bazy - nie liczymy jej sami", async () => {
    stripe.subscriptions.update.mockResolvedValue({ items: { data: [{}] } });
    stripe.subscriptions.retrieve.mockResolvedValue({
      id: "sub_operator_1",
      customer: "cus_1",
      items: { data: [{ id: "si_1", quantity: 1, price: { lookup_key: "plus_monthly" } }] },
    });
    const periodEnd = isoFuture(30);
    adminChain.setResponse("user_subscriptions", (query) =>
      query.has("update")
        ? ok({ id: SUB_ID })
        : ok(subscriptionRow({ current_period_end: periodEnd })),
    );

    await change();

    expect(writeChain("user_subscriptions")?.argsOf("update")?.[0]).toMatchObject({
      current_period_end: periodEnd,
    });
  });

  it("subskrypcja bez kotwicy okresu w bazie ani u operatora zostaje bez kotwicy", async () => {
    // Wiersz sprzed migracji kotwicy nie ma `current_period_end`, a operator
    // też jej nie oddał. Handler NIE MOŻE dopisać wtedy własnej daty: to on
    // rozstrzygałby, do kiedy sięga opłacony okres, zamiast operatora.
    stripe.subscriptions.update.mockResolvedValue({ items: { data: [{}] } });
    stripe.subscriptions.retrieve.mockResolvedValue({
      id: "sub_operator_1",
      customer: "cus_1",
      items: { data: [{ id: "si_1", quantity: 1, price: { lookup_key: "plus_monthly" } }] },
    });
    adminChain.setResponse("user_subscriptions", (query) =>
      query.has("update") ? ok({ id: SUB_ID }) : ok(subscriptionRow({ current_period_end: null })),
    );

    await change();

    const patch = writeChain("user_subscriptions")?.argsOf("update")?.[0];
    expect(patch).toMatchObject({ plan_id: NEW_PLAN_ID, canceled_at: null });
    expect((patch as { current_period_end?: string }).current_period_end).toBeUndefined();
  });

  it("w trybie bez dostawcy okres liczy się LOKALNIE od teraz", async () => {
    vi.stubEnv("LOVABLE_API_KEY", "");
    vi.stubEnv("STRIPE_SANDBOX_API_KEY", "");

    await change();

    const patch = writeChain("user_subscriptions")?.argsOf("update")?.[0];
    const periodEnd = (patch as { current_period_end?: string } | undefined)?.current_period_end;
    expect(typeof periodEnd).toBe("string");
    expect(new Date(String(periodEnd)).getTime()).toBeGreaterThan(Date.now());
    expect(h.calls).toHaveLength(0);
  });

  it("BŁĄD zapisu jest zgłaszany", async () => {
    adminChain.setResponse("user_subscriptions", (query) =>
      query.has("update") ? fail("row locked") : ok(subscriptionRow()),
    );

    await expect(change()).rejects.toThrow("row locked");
  });

  it("zniknięcie wiersza między odczytem a zapisem jest odmową, nie cichym sukcesem", async () => {
    adminChain.setResponse("user_subscriptions", (query) =>
      query.has("update") ? ok(null) : ok(subscriptionRow()),
    );

    await expect(change()).rejects.toThrow("subscription_not_found");
  });

  it("identyfikatory o złym kształcie odrzuca WALIDATOR", async () => {
    await expect(
      callServerFn(
        changeSubscriptionPlan,
        { subscriptionId: SUB_ID, newPlanId: "nie-uuid" },
        context(),
      ),
    ).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------

describe("resumeSubscription - cofnięcie rezygnacji", () => {
  const resume = () =>
    callServerFn<{ ok: boolean }>(resumeSubscription, { subscriptionId: SUB_ID }, context());

  beforeEach(() => {
    adminChain.setResponse("user_subscriptions", (query) =>
      query.has("update") ? ok([{ id: SUB_ID }]) : ok(subscriptionRow({ canceled_at: isoPast(1) })),
    );
  });

  it("BŁĄD odczytu jest zgłaszany", async () => {
    adminChain.setResponse("user_subscriptions", fail("connection reset"));

    await expect(resume()).rejects.toThrow("connection reset");
  });

  it("CUDZA subskrypcja nie jest wznawialna", async () => {
    adminChain.setResponse("user_subscriptions", ok(null));

    await expect(resume()).rejects.toThrow("subscription_not_resumable");
  });

  it("subskrypcja, która NIE była anulowana, nie ma czego wznawiać", async () => {
    adminChain.setResponse("user_subscriptions", ok(subscriptionRow({ canceled_at: null })));

    await expect(resume()).rejects.toThrow("subscription_not_resumable");
  });

  it("subskrypcja w stanie innym niż aktywny nie jest wznawialna", async () => {
    adminChain.setResponse(
      "user_subscriptions",
      ok(subscriptionRow({ canceled_at: isoPast(1), status: "refunded" })),
    );

    await expect(resume()).rejects.toThrow("subscription_not_resumable");
  });

  it("po wygaśnięciu okresu wznowienia nie ma - potrzebny nowy checkout", async () => {
    adminChain.setResponse(
      "user_subscriptions",
      ok(subscriptionRow({ canceled_at: isoPast(1), current_period_end: isoPast(1) })),
    );

    await expect(resume()).rejects.toThrow("subscription_period_ended");
  });

  it("wznowienie idzie NAJPIERW do operatora", async () => {
    const result = await resume();

    expect(stripe.subscriptions.update).toHaveBeenCalledWith("sub_operator_1", {
      cancel_at_period_end: false,
    });
    expect(result).toEqual({ ok: true });
  });

  it("ODMOWA OPERATORA NIE czyści anulowania w bazie", async () => {
    // Odwrotnie niż przy rezygnacji, ale ta sama reguła: interfejs nie może
    // pokazywać wznowienia, którego operator nie wykonał.
    stripe.subscriptions.update.mockRejectedValue(new Error("provider down"));
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(resume()).rejects.toThrow("provider_resume_failed");
    expect(writeChain("user_subscriptions")).toBeUndefined();
    logged.mockRestore();
  });

  it("subskrypcja bez identyfikatora u operatora wznawia się tylko w bazie", async () => {
    adminChain.setResponse("user_subscriptions", (query) =>
      query.has("update")
        ? ok([{ id: SUB_ID }])
        : ok(subscriptionRow({ canceled_at: isoPast(1), external_ref: ORDER_ID })),
    );

    const result = await resume();

    expect(stripe.subscriptions.update).not.toHaveBeenCalled();
    expect(result).toEqual({ ok: true });
  });

  it("zapis jest WARUNKOWY - wznawia tylko wiersz faktycznie anulowany", async () => {
    await resume();

    expect(writeChain("user_subscriptions")?.argsOf("not")).toEqual(["canceled_at", "is", null]);
  });

  it("BŁĄD zapisu jest zgłaszany", async () => {
    adminChain.setResponse("user_subscriptions", (query) =>
      query.has("update") ? fail("row locked") : ok(subscriptionRow({ canceled_at: isoPast(1) })),
    );

    await expect(resume()).rejects.toThrow("row locked");
  });

  it("wyścig: gdy ktoś wznowił wcześniej, drugie wywołanie odmawia zamiast kłamać", async () => {
    adminChain.setResponse("user_subscriptions", (query) =>
      query.has("update") ? ok([]) : ok(subscriptionRow({ canceled_at: isoPast(1) })),
    );

    await expect(resume()).rejects.toThrow("subscription_not_resumable");
  });
});
