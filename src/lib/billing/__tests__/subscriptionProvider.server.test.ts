// Jedyny punkt styku aplikacji z API operatora dla ISTNIEJĄCEJ subskrypcji.
// Każda z tych operacji dotyka pieniędzy klienta, więc testujemy KONTRAKT
// wywołania: która metoda operatora, z jakimi argumentami i co się dzieje,
// gdy operator odmówi. Reguła repo brzmi "NAJPIERW dostawca, potem baza",
// więc połknięty błąd = wiersz w bazie kłamiący o stanie subskrypcji.
import type Stripe from "stripe";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  /** Środowiska, dla których zbudowano klienta bramki (kolejność wywołań). */
  envs: [] as string[],
  subscriptions: { update: vi.fn(), cancel: vi.fn(), retrieve: vi.fn() },
  subscriptionSchedules: { create: vi.fn(), list: vi.fn(), update: vi.fn() },
  prices: { list: vi.fn() },
}));

// Podmieniamy WYŁĄCZNIE budowę klienta - `getStripeErrorMessage` zostaje
// prawdziwy, bo test ma dowieść, że komunikat operatora dociera do wywołującego
// w niezmienionej treści (z detalami: type/code/param).
vi.mock("@/lib/stripe.server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/stripe.server")>()),
  createStripeClient: (env: string) => {
    h.envs.push(env);
    return {
      subscriptions: h.subscriptions,
      subscriptionSchedules: h.subscriptionSchedules,
      prices: h.prices,
    } as unknown as Stripe;
  },
}));

import {
  cancelSubscriptionAtPeriodEnd,
  cancelSubscriptionImmediately,
  catalogPriceFor,
  changeSubscriptionPrice,
  fetchSubscriptionSnapshot,
  isProviderSubscriptionRef,
  pauseSubscriptionCollection,
  resolveProviderPriceId,
  resumePausedSubscription,
  resumeScheduledCancellation,
  subscriptionEnvironment,
  updateSubscriptionQuantity,
} from "@/lib/billing/subscriptionProvider.server";

/** Błąd w kształcie, jaki podnosi SDK operatora. */
const providerError = (message: string, extra: Record<string, string> = {}) =>
  Object.assign(new Error(message), { type: "invalid_request_error", ...extra });

const NO_SUCH_SUB = providerError("No such subscription: sub_ghost", {
  code: "resource_missing",
});
/** Treść, jakiej oczekujemy po przejściu przez `getStripeErrorMessage`. */
const NO_SUCH_SUB_TEXT =
  "No such subscription: sub_ghost (invalid_request_error, resource_missing)";

/** 2026-01-01T00:00:00Z w sekundach - operator liczy czas w unixie. */
const PERIOD_END = 1_767_225_600;
const PERIOD_END_ISO = "2026-01-01T00:00:00.000Z";

const subscriptionItem = (over: Record<string, unknown> = {}) => ({
  id: "si_1",
  quantity: 1,
  current_period_start: 1_764_547_200,
  current_period_end: PERIOD_END,
  price: { id: "price_old", lookup_key: "plus_monthly" },
  ...over,
});

beforeEach(() => {
  h.envs.length = 0;
  vi.clearAllMocks();
  h.subscriptions.update.mockResolvedValue({ items: { data: [subscriptionItem()] } });
  h.subscriptions.cancel.mockResolvedValue({ status: "canceled" });
  h.subscriptions.retrieve.mockResolvedValue({
    customer: "cus_1",
    items: { data: [subscriptionItem()] },
  });
  h.subscriptionSchedules.create.mockResolvedValue({ id: "sched_1" });
  h.subscriptionSchedules.list.mockResolvedValue({
    data: [{ id: "sched_1", subscription: "sub_1" }],
  });
  h.subscriptionSchedules.update.mockResolvedValue({ id: "sched_1" });
  h.prices.list.mockResolvedValue({ data: [{ id: "price_new" }] });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("cancelSubscriptionAtPeriodEnd", () => {
  it("ustawia u operatora anulowanie na koniec opłaconego okresu", async () => {
    const result = await cancelSubscriptionAtPeriodEnd("sandbox", "sub_1");

    expect(result).toEqual({ ok: true });
    expect(h.subscriptions.update).toHaveBeenCalledWith("sub_1", { cancel_at_period_end: true });
    // Anulowanie "na koniec okresu" NIE MOŻE ucinać dostępu natychmiast.
    expect(h.subscriptions.cancel).not.toHaveBeenCalled();
  });

  it("buduje klienta dla wskazanego środowiska bramki", async () => {
    await cancelSubscriptionAtPeriodEnd("live", "sub_1");
    expect(h.envs).toEqual(["live"]);
  });

  it("przekazuje odmowę operatora zamiast ją połknąć", async () => {
    h.subscriptions.update.mockRejectedValue(NO_SUCH_SUB);

    expect(await cancelSubscriptionAtPeriodEnd("sandbox", "sub_ghost")).toEqual({
      ok: false,
      error: NO_SUCH_SUB_TEXT,
    });
  });
});

describe("cancelSubscriptionImmediately", () => {
  it("kasuje subskrypcję od razu (usunięcie konta = koniec obciążeń)", async () => {
    const result = await cancelSubscriptionImmediately("sandbox", "sub_1");

    expect(result).toEqual({ ok: true });
    expect(h.subscriptions.cancel).toHaveBeenCalledWith("sub_1");
    // Nie wolno tu zejść do `cancel_at_period_end` - konto już nie istnieje,
    // więc nikt nie obsłuży końca okresu, a klient płaciłby dalej.
    expect(h.subscriptions.update).not.toHaveBeenCalled();
  });

  it("przekazuje odmowę operatora zamiast ją połknąć", async () => {
    h.subscriptions.cancel.mockRejectedValue(NO_SUCH_SUB);

    expect(await cancelSubscriptionImmediately("sandbox", "sub_ghost")).toEqual({
      ok: false,
      error: NO_SUCH_SUB_TEXT,
    });
  });
});

describe("resumeScheduledCancellation", () => {
  it("cofa zaplanowane anulowanie", async () => {
    const result = await resumeScheduledCancellation("sandbox", "sub_1");

    expect(result).toEqual({ ok: true });
    expect(h.subscriptions.update).toHaveBeenCalledWith("sub_1", { cancel_at_period_end: false });
  });

  it("przekazuje odmowę operatora zamiast ją połknąć", async () => {
    h.subscriptions.update.mockRejectedValue(NO_SUCH_SUB);

    expect(await resumeScheduledCancellation("sandbox", "sub_ghost")).toEqual({
      ok: false,
      error: NO_SUCH_SUB_TEXT,
    });
  });
});

describe("pauseSubscriptionCollection", () => {
  it("wstrzymuje pobór płatności bez kasowania subskrypcji", async () => {
    const result = await pauseSubscriptionCollection("sandbox", "sub_1");

    expect(result).toEqual({ ok: true });
    expect(h.subscriptions.update).toHaveBeenCalledWith("sub_1", {
      pause_collection: { behavior: "void" },
    });
    expect(h.subscriptions.cancel).not.toHaveBeenCalled();
  });

  it("przekazuje odmowę operatora zamiast ją połknąć", async () => {
    h.subscriptions.update.mockRejectedValue(
      providerError("Cannot pause a canceled subscription", { code: "subscription_canceled" }),
    );

    expect(await pauseSubscriptionCollection("sandbox", "sub_1")).toEqual({
      ok: false,
      error: "Cannot pause a canceled subscription (invalid_request_error, subscription_canceled)",
    });
  });
});

describe("resumePausedSubscription", () => {
  it("czyści wstrzymanie jawnym `null` (undefined zostałoby pominięte)", async () => {
    const result = await resumePausedSubscription("sandbox", "sub_1");

    expect(result).toEqual({ ok: true });
    const [, payload] = h.subscriptions.update.mock.calls[0] as [string, Record<string, unknown>];
    // Rozróżnienie null vs undefined jest istotne: operator ignoruje pola
    // `undefined`, więc pauza zostałaby aktywna mimo "ok" po naszej stronie.
    expect(Object.prototype.hasOwnProperty.call(payload, "pause_collection")).toBe(true);
    expect(payload["pause_collection"]).toBeNull();
  });

  it("przekazuje odmowę operatora zamiast ją połknąć", async () => {
    h.subscriptions.update.mockRejectedValue(NO_SUCH_SUB);

    expect(await resumePausedSubscription("sandbox", "sub_ghost")).toEqual({
      ok: false,
      error: NO_SUCH_SUB_TEXT,
    });
  });
});

describe("fetchSubscriptionSnapshot", () => {
  it("mapuje stan operatora na czytelny snapshot (lookup_key, ISO, ilość)", async () => {
    h.subscriptions.retrieve.mockResolvedValue({
      customer: "cus_1",
      items: {
        data: [
          subscriptionItem({
            quantity: 3,
            price: { id: "price_team", lookup_key: "team_monthly_seat" },
          }),
        ],
      },
    });

    const result = await fetchSubscriptionSnapshot("sandbox", "sub_1");

    expect(h.subscriptions.retrieve).toHaveBeenCalledWith("sub_1", {
      expand: ["items.data.price"],
    });
    expect(result).toEqual({
      ok: true,
      snapshot: {
        priceId: "team_monthly_seat",
        currentPeriodEnd: PERIOD_END_ISO,
        quantity: 3,
      },
    });
  });

  it("nieistniejąca subskrypcja zwraca błąd operatora, nie pusty snapshot", async () => {
    h.subscriptions.retrieve.mockRejectedValue(NO_SUCH_SUB);

    const result = await fetchSubscriptionSnapshot("sandbox", "sub_ghost");

    expect(result).toEqual({ ok: false, error: NO_SUCH_SUB_TEXT });
    expect(result).not.toHaveProperty("snapshot");
  });

  it("subskrypcja bez pozycji daje snapshot bez ceny i z ilością 1", async () => {
    h.subscriptions.retrieve.mockResolvedValue({ customer: "cus_1", items: { data: [] } });

    expect(await fetchSubscriptionSnapshot("sandbox", "sub_1")).toEqual({
      ok: true,
      snapshot: { priceId: null, currentPeriodEnd: null, quantity: 1 },
    });
  });

  it("cena spoza katalogu (bez lookup_key) nie udaje planu", async () => {
    h.subscriptions.retrieve.mockResolvedValue({
      customer: "cus_1",
      items: {
        data: [
          subscriptionItem({ price: { id: "price_adhoc" }, current_period_end: null, quantity: 0 }),
        ],
      },
    });

    expect(await fetchSubscriptionSnapshot("sandbox", "sub_1")).toEqual({
      ok: true,
      // Domyślne `?? 1` łapie wyłącznie brak pola - zero zgłoszone przez
      // operatora przechodzi bez podmiany (świadomie utrwalone zachowanie).
      snapshot: { priceId: null, currentPeriodEnd: null, quantity: 0 },
    });
  });
});

describe("resolveProviderPriceId", () => {
  it("tłumaczy czytelny lookup_key na identyfikator ceny operatora", async () => {
    h.prices.list.mockResolvedValue({ data: [{ id: "price_123" }] });

    expect(await resolveProviderPriceId("sandbox", "pro_monthly")).toBe("price_123");
    expect(h.prices.list).toHaveBeenCalledWith({
      lookup_keys: ["pro_monthly"],
      active: true,
      limit: 1,
    });
  });

  it("nieznany plan daje null zamiast wyjątku", async () => {
    h.prices.list.mockResolvedValue({ data: [] });

    expect(await resolveProviderPriceId("sandbox", "ghost_plan")).toBeNull();
  });

  it("awaria operatora jest logowana i degraduje do null", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    h.prices.list.mockRejectedValue(providerError("Service unavailable", { code: "api_error" }));

    // UWAGA (świadomie utrwalone zachowanie): awaria API i brak ceny są dla
    // wywołującego nierozróżnialne - oba kończą się `price_missing`.
    expect(await resolveProviderPriceId("sandbox", "pro_monthly")).toBeNull();
    expect(logged).toHaveBeenCalledWith(
      "[payments] price lookup failed",
      "pro_monthly",
      "Service unavailable (invalid_request_error, api_error)",
    );
  });
});

describe("changeSubscriptionPrice", () => {
  it("upgrade podmienia pozycję od razu i rozlicza proporcjonalnie", async () => {
    h.subscriptions.update.mockResolvedValue({
      items: { data: [subscriptionItem({ current_period_end: PERIOD_END })] },
    });

    const result = await changeSubscriptionPrice("sandbox", "sub_1", {
      newPriceExternalId: "pro_monthly",
      quantity: 1,
      direction: "upgrade",
    });

    expect(result).toEqual({ ok: true, currentPeriodEnd: PERIOD_END_ISO });
    expect(h.subscriptions.update).toHaveBeenCalledWith("sub_1", {
      items: [{ id: "si_1", price: "price_new", quantity: 1 }],
      proration_behavior: "always_invoice",
      cancel_at_period_end: false,
    });
    expect(h.subscriptionSchedules.create).not.toHaveBeenCalled();
  });

  it("downgrade nie rusza bieżącej pozycji - wchodzi dopiero od nowego okresu", async () => {
    const result = await changeSubscriptionPrice("sandbox", "sub_1", {
      newPriceExternalId: "student_monthly",
      quantity: 1,
      direction: "downgrade",
    });

    expect(result).toEqual({ ok: true, currentPeriodEnd: PERIOD_END_ISO });
    // Żadnej natychmiastowej podmiany: opłacony okres należy się klientowi.
    expect(h.subscriptions.update).not.toHaveBeenCalled();
    expect(h.subscriptionSchedules.create).toHaveBeenCalledWith({ from_subscription: "sub_1" });
    expect(h.subscriptionSchedules.update).toHaveBeenCalledWith("sched_1", {
      end_behavior: "release",
      phases: [
        {
          items: [{ price: "price_old", quantity: 1 }],
          start_date: 1_764_547_200,
          end_date: PERIOD_END,
        },
        { items: [{ price: "price_new", quantity: 1 }] },
      ],
    });
  });

  it("brak ceny u operatora przerywa zmianę planu przed dotknięciem subskrypcji", async () => {
    h.prices.list.mockResolvedValue({ data: [] });

    expect(
      await changeSubscriptionPrice("sandbox", "sub_1", {
        newPriceExternalId: "ghost_plan",
        quantity: 1,
        direction: "upgrade",
      }),
    ).toEqual({ ok: false, error: "price_missing" });
    expect(h.subscriptions.retrieve).not.toHaveBeenCalled();
    expect(h.subscriptions.update).not.toHaveBeenCalled();
  });

  it("subskrypcja bez pozycji nie jest modyfikowana", async () => {
    h.subscriptions.retrieve.mockResolvedValue({ customer: "cus_1", items: { data: [] } });

    expect(
      await changeSubscriptionPrice("sandbox", "sub_1", {
        newPriceExternalId: "pro_monthly",
        quantity: 1,
        direction: "upgrade",
      }),
    ).toEqual({ ok: false, error: "no_subscription_item" });
    expect(h.subscriptions.update).not.toHaveBeenCalled();
  });

  it("przekazuje odmowę operatora zamiast ją połknąć", async () => {
    h.subscriptions.update.mockRejectedValue(
      providerError("Your card was declined", { code: "card_declined" }),
    );

    expect(
      await changeSubscriptionPrice("sandbox", "sub_1", {
        newPriceExternalId: "pro_monthly",
        quantity: 1,
        direction: "upgrade",
      }),
    ).toEqual({
      ok: false,
      error: "Your card was declined (invalid_request_error, card_declined)",
    });
  });
});

describe("updateSubscriptionQuantity", () => {
  it("brak zmiany liczby miejsc nie generuje ruchu do operatora", async () => {
    const result = await updateSubscriptionQuantity("sandbox", "sub_1", {
      priceExternalId: "team_monthly_seat",
      quantity: 4,
      previousQuantity: 4,
    });

    expect(result).toEqual({ ok: true, quantity: 4 });
    expect(h.prices.list).not.toHaveBeenCalled();
    expect(h.subscriptions.update).not.toHaveBeenCalled();
  });

  it("dołożenie miejsc rozlicza się natychmiast", async () => {
    const result = await updateSubscriptionQuantity("sandbox", "sub_1", {
      priceExternalId: "team_monthly_seat",
      quantity: 6,
      previousQuantity: 4,
    });

    expect(result).toEqual({ ok: true, quantity: 6 });
    expect(h.subscriptions.update).toHaveBeenCalledWith("sub_1", {
      items: [{ id: "si_1", price: "price_new", quantity: 6 }],
      proration_behavior: "always_invoice",
    });
  });

  it("zdjęcie miejsc idzie bez proraty (opłacony okres należy się klientowi)", async () => {
    const result = await updateSubscriptionQuantity("sandbox", "sub_1", {
      priceExternalId: "team_monthly_seat",
      quantity: 2,
      previousQuantity: 4,
    });

    expect(result).toEqual({ ok: true, quantity: 2 });
    expect(h.subscriptions.update).toHaveBeenCalledWith("sub_1", {
      items: [{ id: "si_1", price: "price_new", quantity: 2 }],
      proration_behavior: "none",
    });
  });

  it("liczba miejsc jest przycinana do zakresu 1-500", async () => {
    expect(
      await updateSubscriptionQuantity("sandbox", "sub_1", {
        priceExternalId: "team_monthly_seat",
        quantity: 9_000,
        previousQuantity: 4,
      }),
    ).toEqual({ ok: true, quantity: 500 });

    expect(
      await updateSubscriptionQuantity("sandbox", "sub_1", {
        priceExternalId: "team_monthly_seat",
        quantity: -3,
        previousQuantity: 4,
      }),
    ).toEqual({ ok: true, quantity: 1 });
  });

  it("brak ceny u operatora przerywa zmianę liczby miejsc", async () => {
    h.prices.list.mockResolvedValue({ data: [] });

    expect(
      await updateSubscriptionQuantity("sandbox", "sub_1", {
        priceExternalId: "ghost_plan",
        quantity: 6,
        previousQuantity: 4,
      }),
    ).toEqual({ ok: false, error: "price_missing" });
    expect(h.subscriptions.update).not.toHaveBeenCalled();
  });
});

describe("pomocnicze reguły modułu", () => {
  it("do operatora trafiają wyłącznie referencje `sub_...`", () => {
    expect(isProviderSubscriptionRef("sub_123")).toBe(true);
    expect(isProviderSubscriptionRef("mock_123")).toBe(false);
    expect(isProviderSubscriptionRef("sub")).toBe(false);
    expect(isProviderSubscriptionRef(null)).toBe(false);
    expect(isProviderSubscriptionRef(undefined)).toBe(false);
  });

  it("produkcja pracuje wyłącznie na środowisku live", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(subscriptionEnvironment()).toBe("live");
    vi.stubEnv("NODE_ENV", "development");
    expect(subscriptionEnvironment()).toBe("sandbox");
  });

  it("cena katalogowa dla pary (tier, interwał)", () => {
    expect(catalogPriceFor("pro", "month")).toBe("pro_monthly");
    expect(catalogPriceFor("pro", "year")).toBe("pro_annual");
    expect(catalogPriceFor("pro", "two_weeks")).toBeNull();
    expect(catalogPriceFor("ghost", "month")).toBeNull();
    expect(catalogPriceFor(null, "month")).toBeNull();
  });
});
