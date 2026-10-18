// Operacje na subskrypcji u operatora - ŚCIEŻKI AWARII i kształty odpowiedzi,
// których nie przechodzą `subscriptionProvider.server.test.ts` (kontrakt
// wywołań) ani stanowa atrapa (`subscriptionProvider.statefulStripe.test.ts`).
//
// Reguła modułu brzmi: błąd KROKU POMOCNICZEGO (doczytanie faktury, zwolnienie
// zastąpionego harmonogramu, kompensacja) nie zmienia wyniku operacji, tylko
// zostawia głośny ślad do ręcznej korekty - a błąd KROKU GŁÓWNEGO wraca jako
// odmowa, nigdy jako sukces. Każdy test niżej przypina jedną z tych granic
// na skutku: wyniku dla wołającego i parametrach wysłanych do operatora.
//
// Granica atrapowana: klient operatora (`getStripeClient`). Treść błędów
// przechodzi przez PRAWDZIWY `getStripeErrorMessage`, katalog jest prawdziwy.
import type Stripe from "stripe";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  subscriptions: { update: vi.fn(), retrieve: vi.fn(), resume: vi.fn() },
  subscriptionSchedules: { create: vi.fn(), update: vi.fn(), release: vi.fn(), retrieve: vi.fn() },
  paymentIntents: { retrieve: vi.fn() },
  prices: { list: vi.fn(), retrieve: vi.fn() },
  invoices: { update: vi.fn(), retrieve: vi.fn() },
}));

vi.mock("@/lib/stripe.server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/stripe.server")>()),
  getStripeClient: () =>
    ({
      subscriptions: h.subscriptions,
      subscriptionSchedules: h.subscriptionSchedules,
      paymentIntents: h.paymentIntents,
      prices: h.prices,
      invoices: h.invoices,
    }) as unknown as Stripe,
}));

import {
  cancelSubscriptionAtPeriodEnd,
  changeSubscriptionPrice,
  clearCancelDateAfterAppliedUpgrade,
  PAYMENT_FAILED,
  PAYMENT_REQUIRES_ACTION,
  reconcileScheduleWithAppliedUpdate,
  resumeProviderSubscription,
  updateSubscriptionQuantity,
} from "@/lib/billing/subscriptionProvider.server";

const PERIOD_START = 1_764_547_200;
/** 2026-01-01T00:00:00Z - koniec bieżącego okresu. */
const PERIOD_END = 1_767_225_600;
const PERIOD_END_ISO = new Date(Date.UTC(2026, 0, 1)).toISOString();
/** Data końca z portalu (`cancel_at`) - w środku okresu. */
const CANCEL_AT = 1_766_000_000;
/** Chwila ustawienia tej daty (`canceled_at`). */
const CANCELED_AT = 1_765_000_000;
const HOSTED = "https://invoice.stripe.test/i/acct_1/inv_proration";

/** Błąd w kształcie SDK operatora. */
function stripeError(message: string, type: string, code?: string): Error {
  return Object.assign(new Error(message), { type, code, raw: { type, code } });
}

const item = (over: Record<string, unknown> = {}) => ({
  id: "si_1",
  quantity: 1,
  current_period_start: PERIOD_START,
  current_period_end: PERIOD_END,
  price: { id: "price_old", lookup_key: "plus_monthly" },
  ...over,
});

const teamItem = (quantity: number) =>
  item({ quantity, price: { id: "price_team", lookup_key: "team_monthly_seat" } });

const liveSub = (over: Record<string, unknown> = {}) => ({
  id: "sub_1",
  status: "active",
  customer: "cus_1",
  cancel_at_period_end: false,
  cancel_at: null,
  canceled_at: null,
  pause_collection: null,
  schedule: null,
  latest_invoice: "in_prev",
  metadata: {},
  pending_update: null,
  items: { data: [item()] },
  ...over,
});

/** Harmonogram rozwinięty (`expand: ["schedule"]`): bieżąca faza i opcjonalnie następna. */
const schedule = (
  next: Array<Record<string, unknown>> | null,
  over: Record<string, unknown> = {},
) => ({
  id: "sched_1",
  status: "active",
  subscription: "sub_1",
  metadata: {},
  current_phase: { start_date: PERIOD_START, end_date: PERIOD_END },
  phases: [
    {
      start_date: PERIOD_START,
      end_date: PERIOD_END,
      items: [{ price: "price_team", quantity: 4 }],
    },
    ...(next ? [{ start_date: PERIOD_END, end_date: PERIOD_END + 2_678_400, items: next }] : []),
  ],
  ...over,
});

const upgrade = () =>
  changeSubscriptionPrice("sandbox", "sub_1", { newPriceExternalId: "pro_monthly" });
const downgrade = () =>
  changeSubscriptionPrice("sandbox", "sub_1", { newPriceExternalId: "student_monthly" });
const seats = (quantity: number) =>
  updateSubscriptionQuantity("sandbox", "sub_1", {
    priceExternalId: "team_monthly_seat",
    quantity,
  });

let consoleError: ReturnType<typeof vi.spyOn>;
let consoleWarn: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  // `reset`, nie `clear`: niezużyte `mockResolvedValueOnce` z jednego testu
  // nie mogą przeciec do następnego.
  vi.resetAllMocks();
  h.subscriptions.retrieve.mockResolvedValue(liveSub());
  h.subscriptions.update.mockResolvedValue(
    liveSub({ items: { data: [item({ price: { id: "price_new", lookup_key: "pro_monthly" } })] } }),
  );
  h.subscriptionSchedules.create.mockResolvedValue({ id: "sched_new", metadata: {} });
  h.subscriptionSchedules.update.mockResolvedValue({ id: "sched_new" });
  h.subscriptionSchedules.release.mockResolvedValue({ id: "sched_1", status: "released" });
  h.subscriptionSchedules.retrieve.mockImplementation(async (id: string) => ({
    id,
    status: "active",
    subscription: "sub_1",
  }));
  h.prices.list.mockResolvedValue({ data: [{ id: "price_new" }] });
  consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
  consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  consoleError.mockRestore();
  consoleWarn.mockRestore();
});

describe("odmowa dopłaty RZUCONA przez operatora", () => {
  it("kod 3DS (`authentication_required`) to „wymaga potwierdzenia”, nie zwykła odmowa - nawet bez typu karty", async () => {
    h.subscriptions.update.mockRejectedValue(
      stripeError("Authentication required", "invalid_request_error", "authentication_required"),
    );
    h.subscriptions.retrieve.mockResolvedValueOnce(liveSub()).mockResolvedValueOnce(
      liveSub({
        pending_update: { subscription_items: [{ price: "price_new" }] },
        latest_invoice: { id: "in_3ds", hosted_invoice_url: HOSTED },
      }),
    );

    expect(await upgrade()).toEqual({
      ok: false,
      error: PAYMENT_REQUIRES_ACTION,
      hostedInvoiceUrl: HOSTED,
    });
    // Fakturę doczytujemy osobnym odczytem z rozwiniętą fakturą.
    expect(h.subscriptions.retrieve).toHaveBeenLastCalledWith("sub_1", {
      expand: ["latest_invoice"],
    });
  });

  it("nieudane doczytanie faktury odbiera tylko link - wynik zostaje odmową dopłaty", async () => {
    h.subscriptions.update.mockRejectedValue(
      stripeError("Your card was declined.", "card_error", "card_declined"),
    );
    h.subscriptions.retrieve
      .mockResolvedValueOnce(liveSub())
      .mockRejectedValueOnce(stripeError("Too many requests", "rate_limit_error"));

    expect(await upgrade()).toEqual({
      ok: false,
      error: PAYMENT_FAILED,
      hostedInvoiceUrl: null,
    });
  });

  it("wyjątek bez kształtu błędu (sam napis) kończy się ogólną odmową, nie wywrotką", async () => {
    h.subscriptions.retrieve.mockRejectedValue("socket hang up");

    expect(await upgrade()).toEqual({ ok: false, error: "Stripe request failed" });
    expect(h.subscriptions.update).not.toHaveBeenCalled();
  });
});

describe("wznowienie pauzy - status intencji płatności nie do odczytania", () => {
  it("błąd odczytu intencji to zwykła odmowa dopłaty z fakturą do opłacenia i śladem w logu", async () => {
    h.subscriptions.retrieve.mockResolvedValue(liveSub({ status: "paused" }));
    h.subscriptions.resume.mockResolvedValue(
      liveSub({
        status: "paused",
        latest_invoice: {
          id: "in_resume",
          hosted_invoice_url: HOSTED,
          payments: { data: [{ payment: { payment_intent: "pi_1" } }] },
        },
      }),
    );
    h.paymentIntents.retrieve.mockRejectedValue(stripeError("No such payment_intent", "api_error"));

    const result = await resumeProviderSubscription("sandbox", "sub_1");

    expect(result).toEqual({ ok: false, error: PAYMENT_FAILED, hostedInvoiceUrl: HOSTED });
    expect(h.paymentIntents.retrieve).toHaveBeenCalledWith("pi_1");
    expect(consoleError).toHaveBeenCalledWith(
      "[payments] payment intent lookup failed",
      "pi_1",
      expect.stringContaining("No such payment_intent"),
    );
  });
});

describe("upgrade opłacony, a zastąpionego harmonogramu nie da się zwolnić", () => {
  it("wynik to ZASTOSOWANY upgrade (klient zapłacił), a błąd zwolnienia zostaje w logu do ręcznej korekty", async () => {
    h.subscriptions.retrieve.mockResolvedValue(
      liveSub({ schedule: schedule([{ price: "price_student", quantity: 1 }]) }),
    );
    h.subscriptionSchedules.release.mockRejectedValue(stripeError("lock_timeout", "api_error"));

    const result = await upgrade();

    expect(result).toEqual({
      ok: true,
      direction: "upgrade",
      effect: "applied",
      currentPeriodEnd: PERIOD_END_ISO,
      cancelAtPeriodEnd: false,
    });
    expect(h.subscriptionSchedules.release).toHaveBeenCalledWith("sched_1", {}, expect.anything());
    expect(consoleError).toHaveBeenCalledWith(
      "[payments] change applied, superseded schedule release failed - release it manually",
      "sub_1",
      "sched_1",
      expect.stringContaining("lock_timeout"),
    );
  });
});

describe("downgrade: harmonogram się nie udał", () => {
  it("bez zaplanowanego końca: odmowa i ŻADNEJ mutacji subskrypcji", async () => {
    h.subscriptionSchedules.create.mockRejectedValue(stripeError("schedule boom", "api_error"));

    const result = await downgrade();

    expect(result).toEqual({ ok: false, error: "schedule boom (api_error)" });
    expect(h.subscriptions.update).not.toHaveBeenCalled();
  });

  it("data końca z portalu wraca TYM SAMYM polem (`cancel_at`), nie flagą końca okresu", async () => {
    h.subscriptions.retrieve.mockResolvedValue(
      liveSub({ cancel_at: CANCEL_AT, canceled_at: CANCELED_AT }),
    );
    h.subscriptions.update.mockResolvedValueOnce(
      liveSub({ cancel_at: null, canceled_at: null, metadata: { nes_ops_rev: "1" } }),
    );
    h.subscriptionSchedules.create.mockRejectedValue(stripeError("schedule boom", "api_error"));

    const result = await downgrade();

    expect(result).toEqual({ ok: false, error: "schedule boom (api_error)" });
    expect(h.subscriptions.update.mock.calls.map((call) => call[1])).toEqual([
      { cancel_at: "", metadata: { nes_ops_rev: "1" } },
      // Inaczej klient, który odchodził z dniem X, zostałby do końca okresu
      // (flaga) albo na zawsze (nic).
      { cancel_at: CANCEL_AT, metadata: { nes_ops_rev: "2" } },
    ]);
  });

  it("nieudana kompensacja flagi zostaje odmową z głośnym śladem - wynik to błąd harmonogramu", async () => {
    h.subscriptions.retrieve.mockResolvedValue(liveSub({ cancel_at_period_end: true }));
    h.subscriptions.update
      .mockResolvedValueOnce(
        liveSub({ cancel_at_period_end: false, metadata: { nes_ops_rev: "1" } }),
      )
      .mockRejectedValueOnce(stripeError("api down", "api_error"));
    h.subscriptionSchedules.create.mockRejectedValue(stripeError("schedule boom", "api_error"));

    const result = await downgrade();

    expect(result).toEqual({ ok: false, error: "schedule boom (api_error)" });
    expect(h.subscriptions.update.mock.calls[1][1]).toEqual({
      cancel_at_period_end: true,
      metadata: { nes_ops_rev: "2" },
    });
    expect(consoleError).toHaveBeenCalledWith(
      "[payments] downgrade failed AND cancellation restore failed",
      "sub_1",
      expect.stringContaining("api down"),
    );
  });
});

describe("zmniejszenie miejsc: `create` oddaje w kółko nieżywy harmonogram", () => {
  it("po granicy prób jest JAWNY błąd, a nie „zaplanowano” bez harmonogramu", async () => {
    h.subscriptions.retrieve.mockResolvedValue(liveSub({ items: { data: [teamItem(5)] } }));
    let n = 0;
    h.subscriptionSchedules.create.mockImplementation(async () => ({
      id: `sched_stale_${(n += 1)}`,
      metadata: {},
    }));
    h.subscriptionSchedules.retrieve.mockImplementation(async (id: string) => ({
      id,
      status: "released",
      subscription: null,
    }));

    const result = await seats(3);

    expect(result).toEqual({ ok: false, error: "schedule_create_replayed" });
    expect(h.subscriptionSchedules.create).toHaveBeenCalledTimes(10);
    // Każda kolejna próba idzie nowym kluczem (z identyfikatorem nieżywego).
    const keys = h.subscriptionSchedules.create.mock.calls.map(
      (call) => (call[1] as { idempotencyKey: string }).idempotencyKey,
    );
    expect(new Set(keys).size).toBe(10);
    expect(h.subscriptionSchedules.update).not.toHaveBeenCalled();
  });
});

describe("rozpoznanie bieżącej ceny na żywej pozycji", () => {
  it("cena bez `lookup_key`, ale z identyfikatorem katalogu w metadanych, jest rozpoznana", async () => {
    h.subscriptions.retrieve.mockResolvedValue(
      liveSub({
        items: {
          data: [
            item({
              price: {
                id: "price_old",
                lookup_key: null,
                metadata: { lovable_external_id: "plus_monthly" },
              },
            }),
          ],
        },
      }),
    );

    expect(await upgrade()).toMatchObject({ ok: true, direction: "upgrade", effect: "applied" });
    expect(h.subscriptions.update.mock.calls[0][1]).toMatchObject({
      items: [{ id: "si_1", price: "price_new", quantity: 1 }],
    });
  });

  it("cena bez żadnego identyfikatora katalogu: odmowa bez mutacji", async () => {
    h.subscriptions.retrieve.mockResolvedValue(
      liveSub({
        items: { data: [item({ price: { id: "price_old", lookup_key: "", metadata: {} } })] },
      }),
    );

    expect(await upgrade()).toEqual({ ok: false, error: "subscription_not_switchable" });
    expect(h.subscriptions.update).not.toHaveBeenCalled();
  });

  it("cena nierozwinięta (sam identyfikator) nie zgaduje planu - odmowa", async () => {
    h.subscriptions.retrieve.mockResolvedValue(
      liveSub({ items: { data: [item({ price: "price_old" })] } }),
    );

    expect(await upgrade()).toEqual({ ok: false, error: "subscription_not_switchable" });
    expect(h.subscriptions.update).not.toHaveBeenCalled();
  });
});

describe("przepisanie faz przenosi podatek automatyczny z podmiotem odpowiedzialnym", () => {
  const phasesSent = () =>
    (h.subscriptionSchedules.update.mock.calls[0][1] as { phases: Array<Record<string, unknown>> })
      .phases;

  it("podatek po stronie połączonego konta jedzie do OBU faz z tym kontem", async () => {
    h.subscriptions.retrieve.mockResolvedValue(
      liveSub({
        items: { data: [teamItem(5)] },
        automatic_tax: {
          enabled: true,
          liability: { type: "account", account: { id: "acct_connected" } },
        },
      }),
    );

    expect(await seats(3)).toMatchObject({ ok: true, effect: "scheduled" });
    const expected = { enabled: true, liability: { type: "account", account: "acct_connected" } };
    expect(phasesSent()[0].automatic_tax).toEqual(expected);
    expect(phasesSent()[1].automatic_tax).toEqual(expected);
  });

  it("podatek bez wskazanego podmiotu jedzie jako samo „włączony”", async () => {
    h.subscriptions.retrieve.mockResolvedValue(
      liveSub({
        items: { data: [teamItem(5)] },
        automatic_tax: { enabled: true, liability: null },
      }),
    );

    await seats(3);

    expect(phasesSent()[0].automatic_tax).toEqual({ enabled: true });
    expect(phasesSent()[1].automatic_tax).toEqual({ enabled: true });
  });
});

describe("powrót do bieżącej liczby miejsc - faza następna w nietypowym kształcie", () => {
  const withSchedule = (sched: Record<string, unknown>) =>
    h.subscriptions.retrieve.mockResolvedValue(
      liveSub({ items: { data: [teamItem(4)] }, schedule: sched }),
    );

  it("pozycja fazy BEZ ilości to dla operatora jedno miejsce - powrót do 4 zwalnia to zmniejszenie", async () => {
    withSchedule(schedule([{ price: "price_team" }]));

    expect(await seats(4)).toEqual({ ok: true, quantity: 4, effect: "applied" });
    expect(h.subscriptionSchedules.release).toHaveBeenCalledWith("sched_1", {}, expect.anything());
  });

  it("bieżąca faza nieodnaleziona na liście: nie wiemy, co zaplanowano - harmonogram nietknięty", async () => {
    withSchedule(
      schedule([{ price: "price_team", quantity: 2 }], {
        current_phase: { start_date: PERIOD_START + 60, end_date: PERIOD_END },
      }),
    );

    expect(await seats(4)).toEqual({ ok: true, quantity: 4, effect: "applied" });
    expect(h.subscriptionSchedules.release).not.toHaveBeenCalled();
    expect(h.subscriptionSchedules.update).not.toHaveBeenCalled();
  });

  it("faza następna bez pozycji albo z pozycją bez ceny: harmonogram nietknięty", async () => {
    withSchedule(schedule([]));
    await seats(4);
    withSchedule(schedule([{ quantity: 2 }]));
    await seats(4);

    expect(h.subscriptionSchedules.release).not.toHaveBeenCalled();
    expect(h.subscriptionSchedules.update).not.toHaveBeenCalled();
  });
});

describe("odrzucona dopłata za upgrade przy dacie końca - znacznik bez faktury", () => {
  it("oczekująca zmiana bez faktury: bez zapisu znacznika, ślad w logu, wynik dalej odmową", async () => {
    h.subscriptions.retrieve.mockResolvedValue(
      liveSub({ cancel_at: CANCEL_AT, canceled_at: CANCELED_AT }),
    );
    h.subscriptions.update.mockResolvedValue(
      liveSub({
        cancel_at: CANCEL_AT,
        canceled_at: CANCELED_AT,
        pending_update: { subscription_items: [{ price: "price_new" }] },
        latest_invoice: null,
      }),
    );

    expect(await upgrade()).toEqual({ ok: false, error: PAYMENT_FAILED, hostedInvoiceUrl: null });
    expect(h.invoices.update).not.toHaveBeenCalled();
    expect(consoleError).toHaveBeenCalledWith(
      "[payments] upgrade payment pending, cancel date marker not written - a later payment keeps the date",
      "sub_1",
      null,
      "pending update without invoice",
    );
  });
});

describe("reconcileScheduleWithAppliedUpdate - brak subskrypcji i kształty bez decyzji", () => {
  const applied = { scheduleId: "sched_1", lines: [{ price: "price_old", quantity: 1 }] };

  it("kod `resource_missing` tylko w `raw` też znaczy „operator nie zna subskrypcji”", async () => {
    h.subscriptions.retrieve.mockRejectedValue(
      Object.assign(new Error("No such subscription"), { raw: { code: "resource_missing" } }),
    );

    expect(await reconcileScheduleWithAppliedUpdate("sandbox", "sub_1", applied)).toBe("missing");
  });

  it("inny błąd odczytu wraca do webhooka (500 i ponowienie), nie jest „brakiem”", async () => {
    h.subscriptions.retrieve.mockRejectedValue(stripeError("api down", "api_error"));

    await expect(reconcileScheduleWithAppliedUpdate("sandbox", "sub_1", applied)).rejects.toThrow(
      "api down",
    );
  });

  it("harmonogram bez fazy następnej: nic do rozstrzygnięcia - zostaje", async () => {
    h.subscriptions.retrieve.mockResolvedValue(liveSub({ schedule: schedule(null) }));

    expect(await reconcileScheduleWithAppliedUpdate("sandbox", "sub_1", applied)).toBe("kept");
    expect(h.subscriptionSchedules.release).not.toHaveBeenCalled();
  });

  it("cena opłacona spoza katalogu nie ma rangi: zaplanowanej innej ceny NIE zwalniamy na domysł", async () => {
    h.subscriptions.retrieve.mockResolvedValue(
      liveSub({
        items: {
          data: [item({ price: { id: "price_custom", lookup_key: "umowa_indywidualna" } })],
        },
        schedule: schedule([{ price: "price_student", quantity: 1 }]),
      }),
    );

    const outcome = await reconcileScheduleWithAppliedUpdate("sandbox", "sub_1", {
      scheduleId: "sched_1",
      lines: [{ price: "price_custom", quantity: 1 }],
    });

    expect(outcome).toBe("kept");
    // Bez rangi po stronie opłaconej nie ma czego porównywać - bez pytania o cenę fazy.
    expect(h.prices.retrieve).not.toHaveBeenCalled();
    expect(h.subscriptionSchedules.release).not.toHaveBeenCalled();
  });
});

describe("clearCancelDateAfterAppliedUpgrade - awarie i stan po zdjęciu", () => {
  const NOW = (CANCELED_AT + 3_600) * 1000;
  const markedInvoice = (over: Record<string, unknown> = {}) => ({
    id: "in_upgrade",
    status: "paid",
    billing_reason: "subscription_update",
    parent: { subscription_details: { subscription: "sub_1" } },
    metadata: {
      nes_upgrade_cancel_at: String(CANCEL_AT),
      nes_upgrade_canceled_at: String(CANCELED_AT),
      nes_upgrade_price: "price_new",
    },
    status_transitions: { paid_at: CANCELED_AT + 600 },
    ...over,
  });
  const upgradedLive = () =>
    liveSub({
      cancel_at: CANCEL_AT,
      canceled_at: CANCELED_AT,
      items: { data: [item({ price: { id: "price_new", lookup_key: "pro_monthly" } })] },
    });
  const clear = (invoiceId: string | null = "in_upgrade") =>
    clearCancelDateAfterAppliedUpgrade("sandbox", "sub_1", { invoiceId, cancelAt: CANCEL_AT });

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    h.subscriptions.retrieve.mockResolvedValue(upgradedLive());
    h.invoices.retrieve.mockResolvedValue(markedInvoice());
  });

  it("migawka bez faktury: data zostaje bez pytania operatora", async () => {
    expect(await clear(null)).toBe("not_marked");
    expect(h.subscriptions.retrieve).not.toHaveBeenCalled();
    expect(h.subscriptions.update).not.toHaveBeenCalled();
  });

  it("operator nie zna subskrypcji: `missing`, bez mutacji", async () => {
    h.subscriptions.retrieve.mockRejectedValue(
      stripeError("No such subscription", "invalid_request_error", "resource_missing"),
    );

    expect(await clear()).toBe("missing");
    expect(h.subscriptions.update).not.toHaveBeenCalled();
  });

  it("inny błąd odczytu subskrypcji wraca do webhooka", async () => {
    h.subscriptions.retrieve.mockRejectedValue(stripeError("api down", "api_error"));

    await expect(clear()).rejects.toThrow("api down");
  });

  it("faktury z migawki już nie ma: data zostaje (`not_marked`)", async () => {
    h.invoices.retrieve.mockRejectedValue(
      stripeError("No such invoice", "invalid_request_error", "resource_missing"),
    );

    expect(await clear()).toBe("not_marked");
    expect(h.subscriptions.update).not.toHaveBeenCalled();
  });

  it("inny błąd odczytu faktury wraca do webhooka, a data nie schodzi", async () => {
    h.invoices.retrieve.mockRejectedValue(stripeError("api down", "api_error"));

    await expect(clear()).rejects.toThrow("api down");
    expect(h.subscriptions.update).not.toHaveBeenCalled();
  });

  it("operator po zdjęciu wciąż ma zaplanowany koniec: wynik `kept_unverified`, nie „zdjęto”", async () => {
    h.subscriptions.update.mockResolvedValue(upgradedLive());

    expect(await clear()).toBe("kept_unverified");
    expect(h.subscriptions.update).toHaveBeenCalledWith(
      "sub_1",
      { cancel_at: "", metadata: { nes_ops_rev: "1" } },
      expect.objectContaining({ idempotencyKey: expect.any(String) }),
    );
    expect(consoleWarn).toHaveBeenCalledWith(
      "[payments] pending update paid later, cancel date kept",
      "kept_unverified",
      "sub_1",
      expect.stringContaining('"after":{"cancelAtPeriodEnd":false,"cancelAt":1766000000}'),
    );
  });

  it("zdjęcie, które operator potwierdził, kończy się `cleared`", async () => {
    h.subscriptions.update.mockResolvedValue({ ...upgradedLive(), cancel_at: null });

    expect(await clear()).toBe("cleared");
  });
});

describe("rezygnacja: wyjątek bez kształtu błędu", () => {
  it("anulowanie z wyjątkiem-napisem zwraca ogólną odmowę - wołający nie zapisze rezygnacji", async () => {
    h.subscriptions.update.mockRejectedValue("ECONNRESET");

    expect(await cancelSubscriptionAtPeriodEnd("sandbox", "sub_1")).toEqual({
      ok: false,
      error: "Stripe request failed",
    });
  });
});

describe("pozycja bez ilości (SDK pomija pole) to dla operatora JEDNA sztuka - w każdej operacji", () => {
  // Wspólna reguła `?? 1`: gdyby któraś operacja czytała brak ilości jako 0
  // albo `undefined`, upgrade wysłałby pozycję bez ilości, a porównanie
  // z migawką zdarzenia uznałoby niezmienioną subskrypcję za zmienioną.
  it("upgrade wysyła ilość 1", async () => {
    h.subscriptions.retrieve.mockResolvedValue(
      liveSub({ items: { data: [item({ quantity: undefined })] } }),
    );

    await upgrade();

    expect(h.subscriptions.update.mock.calls[0][1]).toMatchObject({
      items: [{ id: "si_1", price: "price_new", quantity: 1 }],
    });
  });

  it("zmiana miejsc liczy kierunek od jednego miejsca", async () => {
    h.subscriptions.retrieve.mockResolvedValue(
      liveSub({ items: { data: [item({ ...teamItem(1), quantity: undefined })] } }),
    );

    expect(await seats(1)).toEqual({ ok: true, quantity: 1, effect: "applied" });
    expect(h.subscriptions.update).not.toHaveBeenCalled();

    expect(await seats(3)).toEqual({ ok: true, quantity: 3, effect: "applied" });
    expect(h.subscriptions.update.mock.calls[0][1]).toMatchObject({
      items: [{ id: "si_1", quantity: 3 }],
      payment_behavior: "pending_if_incomplete",
    });
  });

  it("powrót do jednego miejsca przy fazie z dwoma zwalnia zmianę miejsc", async () => {
    h.subscriptions.retrieve.mockResolvedValue(
      liveSub({
        items: { data: [item({ ...teamItem(1), quantity: undefined })] },
        schedule: schedule([{ price: "price_team", quantity: 2 }]),
      }),
    );

    await seats(1);

    expect(h.subscriptionSchedules.release).toHaveBeenCalledWith("sched_1", {}, expect.anything());
  });

  it("migawka z ilością 1 pasuje do żywej pozycji bez ilości - opłacony upgrade zwalnia niższy plan", async () => {
    h.subscriptions.retrieve.mockResolvedValue(
      liveSub({
        items: {
          data: [
            item({ quantity: undefined, price: { id: "price_pro", lookup_key: "pro_monthly" } }),
          ],
        },
        schedule: schedule([{ price: "price_student", quantity: 1 }]),
      }),
    );
    h.prices.retrieve.mockResolvedValue({ id: "price_student", lookup_key: "student_monthly" });

    const outcome = await reconcileScheduleWithAppliedUpdate("sandbox", "sub_1", {
      scheduleId: "sched_1",
      lines: [{ price: "price_pro", quantity: 1 }],
    });

    expect(outcome).toBe("released");
    expect(h.prices.retrieve).toHaveBeenCalledWith("price_student");
  });
});
