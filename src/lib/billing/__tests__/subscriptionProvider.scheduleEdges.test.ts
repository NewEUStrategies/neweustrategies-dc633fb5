// Zmiana planu i liczby miejsc u operatora - KSZTAŁTY ODPOWIEDZI SDK, których
// podstawowy test (`subscriptionProvider.server.test.ts`) nie przechodzi.
//
// Ryzyko pieniężne: downgrade jest HARMONOGRAMEM na koniec opłaconego okresu.
// Jeżeli kod źle odczyta klienta, cenę albo granice okresu, to albo zmieni plan
// od razu (klient traci opłacony okres), albo zgłosi sukces bez harmonogramu
// (klient dalej płaci starą stawkę). Dlatego sprawdzamy:
//   - klienta ROZWINIĘTEGO do obiektu (`expand: ["customer"]`) i cenę jako
//     sam identyfikator - oba kształty zwraca SDK Stripe,
//   - brak harmonogramu tej subskrypcji na liście -> jawny błąd, bez zapisu,
//   - brak dat okresu -> `currentPeriodEnd: null` zamiast daty z 1970 r.,
//   - zmianę liczby miejsc na subskrypcji bez pozycji i odmowę operatora.
import type Stripe from "stripe";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  subscriptions: { update: vi.fn(), retrieve: vi.fn() },
  subscriptionSchedules: { create: vi.fn(), list: vi.fn(), update: vi.fn() },
  prices: { list: vi.fn() },
}));

// Podmieniamy WYŁĄCZNIE budowę klienta - `getStripeErrorMessage` zostaje
// prawdziwy, bo kontraktem jest treść błędu, jaka dociera do wywołującego.
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
  changeSubscriptionPrice,
  updateSubscriptionQuantity,
} from "@/lib/billing/subscriptionProvider.server";

/** 2026-01-01T00:00:00Z w sekundach - operator liczy czas w unixie. */
const PERIOD_END = 1_767_225_600;
/**
 * Ta sama chwila zapisana NIEZALEŻNIE (rok, miesiąc, dzień) - wyrocznia dla
 * konwersji sekund operatora na ISO, a nie kopia wzoru z produkcji.
 */
const PERIOD_END_ISO = new Date(Date.UTC(2026, 0, 1)).toISOString();
const PERIOD_START = 1_764_547_200;

const downgrade = {
  newPriceExternalId: "student_monthly",
  quantity: 1,
  direction: "downgrade" as const,
};

beforeEach(() => {
  vi.clearAllMocks();
  h.prices.list.mockResolvedValue({ data: [{ id: "price_new" }] });
  h.subscriptionSchedules.create.mockResolvedValue({ id: "sched_1" });
  h.subscriptionSchedules.list.mockResolvedValue({
    data: [{ id: "sched_1", subscription: "sub_1" }],
  });
  h.subscriptionSchedules.update.mockResolvedValue({ id: "sched_1" });
  h.subscriptions.update.mockResolvedValue({});
});

describe("changeSubscriptionPrice - downgrade na rozwiniętych obiektach SDK", () => {
  it("klient rozwinięty do obiektu: harmonogram szukany po jego `id`", async () => {
    h.subscriptions.retrieve.mockResolvedValue({
      customer: { id: "cus_expanded", object: "customer" },
      items: {
        data: [
          {
            id: "si_1",
            quantity: 2,
            current_period_start: PERIOD_START,
            current_period_end: PERIOD_END,
            price: "price_old_plain",
          },
        ],
      },
    });

    const result = await changeSubscriptionPrice("sandbox", "sub_1", { ...downgrade, quantity: 2 });

    expect(result).toEqual({ ok: true, currentPeriodEnd: PERIOD_END_ISO });
    expect(h.subscriptionSchedules.list).toHaveBeenCalledWith({
      customer: "cus_expanded",
      limit: 1,
    });
    // Cena podana jako SAM identyfikator przechodzi do fazy bieżącej bez zmian.
    expect(h.subscriptionSchedules.update).toHaveBeenCalledWith("sched_1", {
      end_behavior: "release",
      phases: [
        {
          items: [{ price: "price_old_plain", quantity: 2 }],
          start_date: PERIOD_START,
          end_date: PERIOD_END,
        },
        { items: [{ price: "price_new", quantity: 2 }] },
      ],
    });
    // Downgrade NIE podmienia pozycji od razu - opłacony okres należy się klientowi.
    expect(h.subscriptions.update).not.toHaveBeenCalled();
  });

  it("na liście jest harmonogram INNEJ subskrypcji: błąd `schedule_missing`, bez zapisu faz", async () => {
    h.subscriptions.retrieve.mockResolvedValue({
      customer: "cus_1",
      items: {
        data: [
          {
            id: "si_1",
            quantity: 1,
            current_period_start: PERIOD_START,
            current_period_end: PERIOD_END,
            price: { id: "price_old" },
          },
        ],
      },
    });
    h.subscriptionSchedules.list.mockResolvedValue({
      data: [{ id: "sched_other", subscription: "sub_other" }],
    });

    const result = await changeSubscriptionPrice("sandbox", "sub_1", downgrade);

    expect(result).toEqual({ ok: false, error: "schedule_missing" });
    // Cudzy harmonogram nie może dostać faz tej subskrypcji.
    expect(h.subscriptionSchedules.update).not.toHaveBeenCalled();
  });

  it("pozycja bez dat okresu: brak daty końca zamiast 1970-01-01", async () => {
    h.subscriptions.retrieve.mockResolvedValue({
      customer: "cus_1",
      items: { data: [{ id: "si_1", quantity: 1, price: { id: "price_old" } }] },
    });

    const result = await changeSubscriptionPrice("sandbox", "sub_1", downgrade);

    expect(result).toEqual({ ok: true, currentPeriodEnd: null });
  });

  it("upgrade bez daty końca w odpowiedzi operatora zwraca `null`, nie zmyśloną datę", async () => {
    h.subscriptions.retrieve.mockResolvedValue({
      customer: "cus_1",
      items: { data: [{ id: "si_1", quantity: 1, price: { id: "price_old" } }] },
    });
    h.subscriptions.update.mockResolvedValue({ items: { data: [] } });

    const result = await changeSubscriptionPrice("sandbox", "sub_1", {
      newPriceExternalId: "pro_monthly",
      quantity: 0,
      direction: "upgrade",
    });

    expect(result).toEqual({ ok: true, currentPeriodEnd: null });
    // Ilość 0 z wiersza nie może wyzerować subskrypcji - minimum to jedno miejsce.
    expect(h.subscriptions.update).toHaveBeenCalledWith("sub_1", {
      items: [{ id: "si_1", price: "price_new", quantity: 1 }],
      proration_behavior: "always_invoice",
      cancel_at_period_end: false,
    });
  });
});

describe("updateSubscriptionQuantity - odmowy i braki", () => {
  it("subskrypcja bez pozycji: `no_subscription_item` i zero zapisów u operatora", async () => {
    h.subscriptions.retrieve.mockResolvedValue({ customer: "cus_1", items: { data: [] } });

    const result = await updateSubscriptionQuantity("sandbox", "sub_1", {
      priceExternalId: "team_monthly_seat",
      quantity: 5,
      previousQuantity: 3,
    });

    expect(result).toEqual({ ok: false, error: "no_subscription_item" });
    expect(h.subscriptions.update).not.toHaveBeenCalled();
  });

  it("odmowa operatora przy dokładaniu miejsc wraca z treścią błędu, nie jako sukces", async () => {
    h.subscriptions.retrieve.mockResolvedValue({
      customer: "cus_1",
      items: { data: [{ id: "si_1", quantity: 3, price: { id: "price_team" } }] },
    });
    h.subscriptions.update.mockRejectedValue(
      Object.assign(new Error("Your card was declined"), {
        type: "card_error",
        code: "card_declined",
      }),
    );

    const result = await updateSubscriptionQuantity("sandbox", "sub_1", {
      priceExternalId: "team_monthly_seat",
      quantity: 5,
      previousQuantity: 3,
    });

    expect(result).toEqual({
      ok: false,
      error: "Your card was declined (card_error, card_declined)",
    });
  });

  it("awaria odczytu subskrypcji też kończy się błędem, nie `ok`", async () => {
    h.subscriptions.retrieve.mockRejectedValue(new Error("No such subscription: sub_ghost"));

    const result = await updateSubscriptionQuantity("sandbox", "sub_ghost", {
      priceExternalId: "team_monthly_seat",
      quantity: 2,
      previousQuantity: 3,
    });

    expect(result).toEqual({ ok: false, error: "No such subscription: sub_ghost" });
    expect(h.subscriptions.update).not.toHaveBeenCalled();
  });
});
