// Przeniesienie subskrypcji na cenę katalogu v6.2 u operatora
// (`repriceSubscriptionToCatalog`, `inspectSubscriptionRepricing`,
// `loadRepricingTargets` w `subscriptionProvider.server.ts`).
//
// Ryzyko pieniężne: zła mutacja to faktura proporcjonalna, której klient się
// nie spodziewa, odnowienie po STAREJ cenie mimo „przeniesiono" albo zgubiony
// rabat. Dlatego sprawdzamy:
//   - bez harmonogramu: pozycja dostaje nową cenę z `proration_behavior: none`,
//     ilość zostaje, klucz idempotencji jest deterministyczny,
//   - własny harmonogram (zaplanowany downgrade na starego Członka): OBIE fazy
//     dostają nowe ceny, daty i trial zostają, odcisk `nes_basis` opisuje
//     pozycje PO zapisie, licznik `nes_ops_rev` jest podbity,
//   - harmonogram obcy i decyzja `skip` nie dotykają operatora,
//   - cena schodkowa w fazie (Zespół) jest doczytywana z progami,
//   - decyzja liczy się na stanie odczytanym tuż przed mutacją.
import type Stripe from "stripe";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { PriceShape } from "@/lib/billing/subscriptionRepricing";

const h = vi.hoisted(() => ({
  subscriptions: { update: vi.fn(), retrieve: vi.fn() },
  subscriptionSchedules: { update: vi.fn() },
  prices: { list: vi.fn(), retrieve: vi.fn() },
}));

vi.mock("@/lib/stripe.server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/stripe.server")>()),
  getStripeClient: () =>
    ({
      subscriptions: h.subscriptions,
      subscriptionSchedules: h.subscriptionSchedules,
      prices: h.prices,
    }) as unknown as Stripe,
}));

import {
  inspectSubscriptionRepricing,
  loadRepricingTargets,
  renewalListCharge,
  repriceSubscriptionToCatalog,
} from "@/lib/billing/subscriptionProvider.server";

const PERIOD_START = 1_764_547_200;
const PERIOD_END = 1_767_225_600;

function price(id: string, lookupKey: string | null, unitAmount: number, extra = {}) {
  return {
    id,
    lookup_key: lookupKey,
    metadata: lookupKey ? {} : { lovable_external_id: "plus_monthly" },
    currency: "pln",
    billing_scheme: "per_unit",
    unit_amount: unitAmount,
    recurring: { interval: "month", interval_count: 1 },
    ...extra,
  };
}

function flat(id: string, unitAmount: number): PriceShape {
  return {
    id,
    currency: "pln",
    interval: "month",
    intervalCount: 1,
    unitAmount,
    tiersMode: null,
    tiers: null,
  };
}

const TARGETS: Partial<Record<string, PriceShape>> = {
  plus_monthly: flat("price_plusNew", 3900),
  pro_monthly: flat("price_proNew", 11900),
  team_monthly_seat: {
    id: "price_teamNew",
    currency: "pln",
    interval: "month",
    intervalCount: 1,
    unitAmount: null,
    tiersMode: "volume",
    tiers: [
      { upTo: 10, unitAmount: 8900, flatAmount: null },
      { upTo: null, unitAmount: 7900, flatAmount: null },
    ],
  },
};

function subscription(extra: Record<string, unknown> = {}) {
  return {
    id: "sub_1",
    status: "active",
    metadata: {},
    cancel_at_period_end: false,
    cancel_at: null,
    pause_collection: null,
    pending_update: null,
    trial_end: null,
    latest_invoice: "in_1",
    schedule: null,
    discounts: [],
    default_tax_rates: [],
    automatic_tax: { enabled: false },
    items: {
      data: [
        {
          id: "si_1",
          quantity: 1,
          current_period_start: PERIOD_START,
          current_period_end: PERIOD_END,
          price: price("price_plusOld", null, 5900),
          tax_rates: [],
          discounts: [],
        },
      ],
    },
    ...extra,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  h.subscriptions.update.mockResolvedValue({});
  h.subscriptionSchedules.update.mockResolvedValue({});
});

describe("loadRepricingTargets", () => {
  it("aktywna cena po lookup_key z progami; brak ceny = brak klucza", async () => {
    h.prices.list.mockImplementation(async ({ lookup_keys }: { lookup_keys: string[] }) =>
      lookup_keys[0] === "plus_monthly"
        ? { data: [price("price_plusNew", "plus_monthly", 3900)] }
        : { data: [] },
    );
    const targets = await loadRepricingTargets("sandbox", ["plus_monthly", "pro_annual"]);

    expect(targets).toEqual({ plus_monthly: flat("price_plusNew", 3900) });
    expect(h.prices.list).toHaveBeenCalledWith({
      lookup_keys: ["plus_monthly"],
      active: true,
      limit: 1,
      expand: ["data.tiers"],
    });
  });
});

describe("repriceSubscriptionToCatalog - bez harmonogramu", () => {
  it("pozycja dostaje nową cenę bez proraty; ilość i okres zostają", async () => {
    h.subscriptions.retrieve.mockResolvedValue(subscription());

    const result = await repriceSubscriptionToCatalog("sandbox", "sub_1", {
      targets: TARGETS,
      campaign: "pricing_v62",
    });

    expect(result).toMatchObject({
      ok: true,
      decision: { action: "apply", mode: "item", currentAmount: 5900, newAmount: 3900 },
    });
    expect(h.subscriptions.retrieve).toHaveBeenCalledWith("sub_1", {
      expand: ["schedule", "items.data.price.tiers", "schedule.phases.items.price"],
    });
    expect(h.subscriptions.update).toHaveBeenCalledTimes(1);
    const [id, params, options] = h.subscriptions.update.mock.calls[0];
    expect(id).toBe("sub_1");
    expect(params).toEqual({
      items: [{ id: "si_1", price: "price_plusNew", quantity: 1 }],
      proration_behavior: "none",
      metadata: { nes_ops_rev: "1", nes_repriced: "pricing_v62" },
    });
    expect(options.idempotencyKey).toMatch(/^nes-sub-reprice-[0-9a-f]{48}$/);
    expect(h.subscriptionSchedules.update).not.toHaveBeenCalled();
  });

  it("ten sam stan -> ten sam klucz idempotencji (dwuklik trafia w pamięć operatora)", async () => {
    h.subscriptions.retrieve.mockResolvedValue(subscription());
    await repriceSubscriptionToCatalog("sandbox", "sub_1", {
      targets: TARGETS,
      campaign: "pricing_v62",
    });
    await repriceSubscriptionToCatalog("sandbox", "sub_1", {
      targets: TARGETS,
      campaign: "pricing_v62",
    });
    const [first, second] = h.subscriptions.update.mock.calls.map((c) => c[2].idempotencyKey);
    expect(first).toBe(second);
  });

  it("decyzja `skip` (cena już aktualna) nie dotyka operatora", async () => {
    h.subscriptions.retrieve.mockResolvedValue(
      subscription({
        items: {
          data: [
            {
              id: "si_1",
              quantity: 1,
              current_period_start: PERIOD_START,
              current_period_end: PERIOD_END,
              price: price("price_plusNew", "plus_monthly", 3900),
            },
          ],
        },
      }),
    );
    const result = await repriceSubscriptionToCatalog("sandbox", "sub_1", {
      targets: TARGETS,
      campaign: "pricing_v62",
    });
    expect(result).toMatchObject({
      ok: true,
      decision: { action: "skip", reason: "already_current" },
    });
    expect(h.subscriptions.update).not.toHaveBeenCalled();
  });

  it("błąd operatora wraca jako wynik, nie wyjątek", async () => {
    h.subscriptions.retrieve.mockResolvedValue(subscription());
    h.subscriptions.update.mockRejectedValue(new Error("rate limited"));
    const result = await repriceSubscriptionToCatalog("sandbox", "sub_1", {
      targets: TARGETS,
      campaign: "pricing_v62",
    });
    expect(result).toEqual({ ok: false, error: "rate limited" });
  });
});

describe("repriceSubscriptionToCatalog - własny harmonogram", () => {
  function withSchedule(
    metadata: Record<string, string>,
    trialEnd: number | null = null,
    extra: { endBehavior?: string; cancelAt?: number | null } = {},
  ) {
    return subscription({
      status: trialEnd ? "trialing" : "active",
      trial_end: trialEnd,
      cancel_at: extra.cancelAt ?? null,
      discounts: ["di_sub"],
      items: {
        data: [
          {
            id: "si_1",
            quantity: 1,
            current_period_start: PERIOD_START,
            current_period_end: PERIOD_END,
            price: price("price_proOld", "pro_monthly", 12900),
            tax_rates: ["txr_1"],
            discounts: ["di_item"],
          },
        ],
      },
      schedule: {
        id: "sub_sched_1",
        metadata,
        end_behavior: extra.endBehavior ?? "release",
        current_phase: { start_date: PERIOD_START, end_date: PERIOD_END },
        phases: [
          {
            start_date: PERIOD_START,
            end_date: PERIOD_END,
            items: [{ price: price("price_proOld", "pro_monthly", 12900), quantity: 1 }],
          },
          {
            start_date: PERIOD_END,
            end_date: PERIOD_END + 2_592_000,
            // Zaplanowany downgrade na STAREGO Członka - cena zarchiwizowana,
            // bez lookup_key, rozpoznawana po metadanej.
            items: [{ price: price("price_plusOld", null, 5900), quantity: 1 }],
          },
        ],
      },
    });
  }

  it("obie fazy na nowych cenach, proracja wyłączona, odcisk i licznik w tym samym zapisie", async () => {
    h.subscriptions.retrieve.mockResolvedValue(
      withSchedule({ nes_basis: "stary", nes_ops_rev: "3" }),
    );

    const result = await repriceSubscriptionToCatalog("sandbox", "sub_1", {
      targets: TARGETS,
      campaign: "pricing_v62",
    });

    expect(result).toMatchObject({
      ok: true,
      decision: { action: "apply", mode: "schedule", lookupKey: "plus_monthly", newAmount: 3900 },
    });
    expect(h.subscriptions.update).not.toHaveBeenCalled();
    const [scheduleId, params, options] = h.subscriptionSchedules.update.mock.calls[0];
    expect(scheduleId).toBe("sub_sched_1");
    expect(params.proration_behavior).toBe("none");
    expect(params.end_behavior).toBe("release");
    expect(params.phases).toEqual([
      {
        // Bieżąca faza: Członek Pro po nowej cenie, rabat i podatek pozycji
        // przeniesione na nową cenę tego samego produktu.
        items: [
          {
            price: "price_proNew",
            quantity: 1,
            tax_rates: ["txr_1"],
            discounts: [{ discount: "di_item" }],
          },
        ],
        start_date: PERIOD_START,
        end_date: PERIOD_END,
        discounts: [{ discount: "di_sub" }],
      },
      {
        // Faza odnowienia: Członek po NOWEJ cenie (39 zł zamiast 59 zł).
        items: [{ price: "price_plusNew", quantity: 1, tax_rates: ["txr_1"] }],
        discounts: [{ discount: "di_sub" }],
      },
    ]);
    expect(params.metadata.nes_ops_rev).toBe("4");
    expect(params.metadata.nes_basis).toMatch(/^[0-9a-f]{40}$/);
    expect(params.metadata.nes_basis).not.toBe("stary");
    // Ślad kampanii na harmonogramie, jak na subskrypcji w trybie pozycji.
    expect(params.metadata.nes_repriced).toBe("pricing_v62");
    expect(options.idempotencyKey).toMatch(/^nes-sub-reprice-schedule-[0-9a-f]{48}$/);
  });

  // Zapis faz ustawia `end_behavior: release` i otwartą fazę - przy
  // zaplanowanym końcu odnowiłby subskrypcję klientowi, który zrezygnował
  // (ta sama reguła co odmowa zmniejszenia miejsc `subscription_canceling`).
  it.each([
    { przypadek: "harmonogram z end_behavior=cancel", extra: { endBehavior: "cancel" } },
    {
      przypadek: "data końca cancel_at z panelu operatora",
      extra: { cancelAt: PERIOD_END },
    },
  ])("zaplanowany koniec ($przypadek): pominięcie bez mutacji", async ({ extra }) => {
    h.subscriptions.retrieve.mockResolvedValue(withSchedule({ nes_basis: "stary" }, null, extra));

    const result = await repriceSubscriptionToCatalog("sandbox", "sub_1", {
      targets: TARGETS,
      campaign: "pricing_v62",
    });

    expect(result).toMatchObject({
      ok: true,
      decision: { action: "skip", reason: "cancel_scheduled", emailEligible: false },
    });
    expect(h.subscriptionSchedules.update).not.toHaveBeenCalled();
    expect(h.subscriptions.update).not.toHaveBeenCalled();
  });

  it("harmonogram z nieznanym end_behavior: obsługa ręczna, bez mutacji", async () => {
    h.subscriptions.retrieve.mockResolvedValue(
      withSchedule({ nes_basis: "stary" }, null, { endBehavior: "none" }),
    );
    const result = await repriceSubscriptionToCatalog("sandbox", "sub_1", {
      targets: TARGETS,
      campaign: "pricing_v62",
    });
    expect(result).toMatchObject({
      ok: true,
      decision: { action: "skip", reason: "schedule_foreign" },
    });
    expect(h.subscriptionSchedules.update).not.toHaveBeenCalled();
  });

  it("trial w toku zostaje w bieżącej fazie", async () => {
    h.subscriptions.retrieve.mockResolvedValue(
      withSchedule({ nes_basis: "stary" }, PERIOD_START + 7 * 86_400),
    );
    await repriceSubscriptionToCatalog("sandbox", "sub_1", {
      targets: TARGETS,
      campaign: "pricing_v62",
    });
    const params = h.subscriptionSchedules.update.mock.calls[0][1];
    expect(params.phases[0].trial_end).toBe(PERIOD_START + 7 * 86_400);
  });

  // Downgrade Pro -> Członek JUŻ WSZEDŁ (10.10): pozycja wskazuje starego
  // Członka (59 zł), a własny harmonogram wisi w ostatniej fazie do jej końca.
  // Operator odłączy go dopiero wtedy i odnowi subskrypcję po cenie POZYCJI -
  // bez przepisania byłoby to 59 zamiast 39 zł. Dawniej: `schedule_foreign`.
  function inFinalPhase(extra: { cancelAt?: number | null } = {}) {
    const plusOld = price("price_plusOld", null, 5900);
    return subscription({
      cancel_at: extra.cancelAt ?? null,
      discounts: ["di_sub"],
      items: {
        data: [
          {
            id: "si_1",
            quantity: 1,
            current_period_start: PERIOD_START,
            current_period_end: PERIOD_END,
            price: plusOld,
            tax_rates: [],
            discounts: ["di_item"],
          },
        ],
      },
      schedule: {
        id: "sub_sched_1",
        metadata: { nes_basis: "stary", nes_ops_rev: "2" },
        end_behavior: "release",
        current_phase: { start_date: PERIOD_START, end_date: PERIOD_END },
        phases: [
          // Minione fazy bywają na liście - ostatnią wskazuje `current_phase`.
          {
            start_date: PERIOD_START - 2_592_000,
            end_date: PERIOD_START,
            items: [{ price: price("price_proOld", "pro_monthly", 12900), quantity: 1 }],
          },
          {
            start_date: PERIOD_START,
            end_date: PERIOD_END,
            items: [{ price: plusOld, quantity: 1 }],
          },
        ],
      },
    });
  }

  it("ostatnia faza własnego harmonogramu: przepisana JEDNA bieżąca faza na nową cenę", async () => {
    h.subscriptions.retrieve.mockResolvedValue(inFinalPhase());

    const result = await repriceSubscriptionToCatalog("sandbox", "sub_1", {
      targets: TARGETS,
      campaign: "pricing_v62",
    });

    expect(result).toMatchObject({
      ok: true,
      decision: {
        action: "apply",
        mode: "schedule",
        lookupKey: "plus_monthly",
        currentAmount: 5900,
        newAmount: 3900,
      },
    });
    expect(h.subscriptions.update).not.toHaveBeenCalled();
    const [scheduleId, params] = h.subscriptionSchedules.update.mock.calls[0];
    expect(scheduleId).toBe("sub_sched_1");
    expect(params.proration_behavior).toBe("none");
    expect(params.end_behavior).toBe("release");
    // Ta sama data początku i końca fazy, bez fazy następnej: po jej końcu
    // harmonogram się zwalnia, a subskrypcja odnawia po NOWEJ cenie pozycji.
    expect(params.phases).toEqual([
      {
        items: [{ price: "price_plusNew", quantity: 1, discounts: [{ discount: "di_item" }] }],
        start_date: PERIOD_START,
        end_date: PERIOD_END,
        discounts: [{ discount: "di_sub" }],
      },
    ]);
    expect(params.metadata).toMatchObject({ nes_ops_rev: "3", nes_repriced: "pricing_v62" });
  });

  it("ostatnia faza przy zaplanowanym końcu: pominięcie bez mutacji", async () => {
    h.subscriptions.retrieve.mockResolvedValue(inFinalPhase({ cancelAt: PERIOD_END }));

    const result = await repriceSubscriptionToCatalog("sandbox", "sub_1", {
      targets: TARGETS,
      campaign: "pricing_v62",
    });

    expect(result).toMatchObject({
      ok: true,
      decision: { action: "skip", reason: "cancel_scheduled" },
    });
    expect(h.subscriptionSchedules.update).not.toHaveBeenCalled();
    expect(h.subscriptions.update).not.toHaveBeenCalled();
  });

  it("harmonogram OBCY (bez metadanych aplikacji): odmowa bez mutacji", async () => {
    h.subscriptions.retrieve.mockResolvedValue(withSchedule({}));
    const result = await repriceSubscriptionToCatalog("sandbox", "sub_1", {
      targets: TARGETS,
      campaign: "pricing_v62",
    });
    expect(result).toMatchObject({
      ok: true,
      decision: { action: "skip", reason: "schedule_foreign" },
    });
    expect(h.subscriptionSchedules.update).not.toHaveBeenCalled();
    expect(h.subscriptions.update).not.toHaveBeenCalled();
  });
});

describe("inspectSubscriptionRepricing - podgląd bez mutacji", () => {
  it("cena schodkowa w fazie jest doczytywana z progami (Zespół 15 -> 8 miejsc)", async () => {
    const teamOld = {
      id: "price_teamOld",
      lookup_key: null,
      metadata: { lovable_external_id: "team_monthly_seat" },
      currency: "pln",
      billing_scheme: "tiered",
      tiers_mode: "volume",
      tiers: null,
      recurring: { interval: "month", interval_count: 1 },
    };
    h.prices.retrieve.mockResolvedValue({
      ...teamOld,
      tiers: [
        { up_to: 10, unit_amount: 9900, flat_amount: null },
        { up_to: null, unit_amount: 7900, flat_amount: null },
      ],
    });
    h.subscriptions.retrieve.mockResolvedValue(
      subscription({
        items: {
          data: [
            {
              id: "si_1",
              quantity: 15,
              current_period_start: PERIOD_START,
              current_period_end: PERIOD_END,
              price: {
                ...teamOld,
                tiers: [
                  { up_to: 10, unit_amount: 9900, flat_amount: null },
                  { up_to: null, unit_amount: 7900, flat_amount: null },
                ],
              },
            },
          ],
        },
        schedule: {
          id: "sub_sched_2",
          metadata: { nes_basis: "x" },
          end_behavior: "release",
          current_phase: { start_date: PERIOD_START, end_date: PERIOD_END },
          phases: [
            {
              start_date: PERIOD_START,
              end_date: PERIOD_END,
              items: [{ price: teamOld, quantity: 15 }],
            },
            { start_date: PERIOD_END, end_date: null, items: [{ price: teamOld, quantity: 8 }] },
          ],
        },
      }),
    );

    const result = await inspectSubscriptionRepricing("sandbox", "sub_1", TARGETS);

    expect(h.prices.retrieve).toHaveBeenCalledWith("price_teamOld", { expand: ["tiers"] });
    expect(result).toMatchObject({
      ok: true,
      decision: {
        action: "apply",
        mode: "schedule",
        quantity: 8,
        currentAmount: 79200,
        newAmount: 71200,
      },
    });
    expect(h.subscriptions.update).not.toHaveBeenCalled();
    expect(h.subscriptionSchedules.update).not.toHaveBeenCalled();
  });

  it("błąd odczytu wraca jako wynik", async () => {
    h.subscriptions.retrieve.mockRejectedValue(new Error("No such subscription"));
    expect(await inspectSubscriptionRepricing("sandbox", "sub_x", TARGETS)).toEqual({
      ok: false,
      error: "No such subscription",
    });
  });
});

// Kwota odnowienia do maila przypomnienia i karty w profilu: cena, na której
// subskrypcja JEST u operatora (po v6.2 do akcji przeniesienia - stara), a gdy
// odnowienie może pójść inaczej (harmonogram) albo odczyt padnie - żadna.
describe("renewalListCharge - kwota, którą operator pobierze przy odnowieniu", () => {
  it("cena pozycji × ilość, waluta wielkimi literami", async () => {
    h.subscriptions.retrieve.mockResolvedValue(subscription());
    expect(await renewalListCharge("live", "sub_1")).toEqual({
      amountCents: 5900,
      currency: "PLN",
    });
  });

  it("cena schodkowa (Zespół 12 miejsc po 79 zł) liczy się progiem wolumenowym", async () => {
    h.subscriptions.retrieve.mockResolvedValue(
      subscription({
        items: {
          data: [
            {
              id: "si_1",
              quantity: 12,
              price: {
                id: "price_teamOld",
                currency: "pln",
                billing_scheme: "tiered",
                tiers_mode: "volume",
                recurring: { interval: "month", interval_count: 1 },
                tiers: [
                  { up_to: 10, unit_amount: 9900, flat_amount: null },
                  { up_to: null, unit_amount: 7900, flat_amount: null },
                ],
              },
            },
          ],
        },
      }),
    );
    expect(await renewalListCharge("live", "sub_1")).toEqual({
      amountCents: 94800,
      currency: "PLN",
    });
  });

  it("harmonogram zmiany: odnowienie może pójść inną pozycją - brak kwoty", async () => {
    h.subscriptions.retrieve.mockResolvedValue(
      subscription({ schedule: { id: "sub_sched_1", metadata: {}, phases: [] } }),
    );
    expect(await renewalListCharge("live", "sub_1")).toBeNull();
  });

  it("błąd odczytu i identyfikator spoza operatora: brak kwoty, bez wyjątku", async () => {
    h.subscriptions.retrieve.mockRejectedValue(new Error("rate limited"));
    expect(await renewalListCharge("live", "sub_1")).toBeNull();
    h.subscriptions.retrieve.mockClear();
    expect(await renewalListCharge("live", "mock_1")).toBeNull();
    expect(h.subscriptions.retrieve).not.toHaveBeenCalled();
  });
});
