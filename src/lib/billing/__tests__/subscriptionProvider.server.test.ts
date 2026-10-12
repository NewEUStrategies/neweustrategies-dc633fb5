// Jedyny punkt styku aplikacji z API operatora dla ISTNIEJĄCEJ subskrypcji.
// Każda z tych operacji dotyka pieniędzy klienta, więc testujemy KONTRAKT
// wywołania: która metoda operatora, z jakimi argumentami i co się dzieje,
// gdy operator odmówi. Reguła repo brzmi "NAJPIERW dostawca, potem baza",
// więc połknięty błąd = wiersz w bazie kłamiący o stanie subskrypcji.
//
// Od audytu SUB-04/SUB-14 kontrakt obejmuje też:
//   - dopłatę przed zmianą (`pending_if_incomplete`) i jej odmowę jako WYNIK
//     (`payment_failed` / `payment_requires_action` + faktura), nie sukces,
//   - klucz idempotencji na każdej mutacji: stały dla ponowienia tej samej
//     operacji z tego samego stanu, inny dla prawomocnej nowej operacji,
//   - wznowienie rozstrzygane ŻYWYM stanem (status `paused` -> `resume`,
//     pauza poboru -> zdjęcie pauzy, zaplanowany koniec -> cofnięcie).
import type Stripe from "stripe";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  /** Środowiska, dla których zbudowano klienta bramki (kolejność wywołań). */
  envs: [] as string[],
  subscriptions: { update: vi.fn(), cancel: vi.fn(), retrieve: vi.fn(), resume: vi.fn() },
  subscriptionSchedules: { create: vi.fn(), update: vi.fn(), release: vi.fn() },
  paymentIntents: { retrieve: vi.fn() },
  prices: { list: vi.fn() },
}));

// Podmieniamy WYŁĄCZNIE budowę klienta - `getStripeErrorMessage` zostaje
// prawdziwy, bo test ma dowieść, że komunikat operatora dociera do wywołującego
// w niezmienionej treści (z detalami: type/code/param).
vi.mock("@/lib/stripe.server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/stripe.server")>()),
  getStripeClient: (env: string) => {
    h.envs.push(env);
    return {
      subscriptions: h.subscriptions,
      subscriptionSchedules: h.subscriptionSchedules,
      paymentIntents: h.paymentIntents,
      prices: h.prices,
    } as unknown as Stripe;
  },
}));

import {
  cancelSubscriptionAtPeriodEnd,
  cancelSubscriptionImmediately,
  catalogPriceFor,
  changeSubscriptionPrice,
  isProviderSubscriptionRef,
  PAYMENT_FAILED,
  PAYMENT_REQUIRES_ACTION,
  resolveProviderPriceId,
  resumeProviderSubscription,
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
const PERIOD_START = 1_764_547_200;
const HOSTED = "https://invoice.stripe.test/i/acct_1/inv_proration";

const subscriptionItem = (over: Record<string, unknown> = {}) => ({
  id: "si_1",
  quantity: 1,
  current_period_start: PERIOD_START,
  current_period_end: PERIOD_END,
  price: { id: "price_old", lookup_key: "plus_monthly" },
  ...over,
});

/** Żywa subskrypcja operatora w kształcie, jaki zwraca `retrieve`. */
const liveSub = (over: Record<string, unknown> = {}) => ({
  id: "sub_1",
  status: "active",
  customer: "cus_1",
  cancel_at_period_end: false,
  pause_collection: null,
  schedule: null,
  latest_invoice: "in_prev",
  metadata: {},
  pending_update: null,
  items: { data: [subscriptionItem()] },
  ...over,
});

const teamItem = (quantity: number) =>
  subscriptionItem({ quantity, price: { id: "price_team", lookup_key: "team_monthly_seat" } });

/** Trzeci argument (opcje żądania) n-tego wywołania mocka. */
function optionsOf(mock: ReturnType<typeof vi.fn>, call = 0): { idempotencyKey?: string } {
  const args = mock.mock.calls[call] as unknown[];
  return (args[args.length - 1] ?? {}) as { idempotencyKey?: string };
}

beforeEach(() => {
  h.envs.length = 0;
  vi.clearAllMocks();
  h.subscriptions.update.mockResolvedValue(
    liveSub({ items: { data: [subscriptionItem({ price: { id: "price_new" } })] } }),
  );
  h.subscriptions.cancel.mockResolvedValue({ status: "canceled" });
  h.subscriptions.retrieve.mockResolvedValue(liveSub());
  h.subscriptions.resume.mockResolvedValue(liveSub({ status: "active" }));
  h.subscriptionSchedules.create.mockResolvedValue({ id: "sched_1", metadata: {} });
  h.subscriptionSchedules.update.mockResolvedValue({ id: "sched_1" });
  h.subscriptionSchedules.release.mockResolvedValue({ id: "sched_1", status: "released" });
  h.paymentIntents.retrieve.mockResolvedValue({ status: "requires_payment_method" });
  h.prices.list.mockResolvedValue({ data: [{ id: "price_new" }] });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("cancelSubscriptionAtPeriodEnd", () => {
  it("ustawia u operatora anulowanie na koniec opłaconego okresu, z kluczem i licznikiem", async () => {
    const result = await cancelSubscriptionAtPeriodEnd("sandbox", "sub_1");

    expect(result).toEqual({ ok: true });
    expect(h.subscriptions.update).toHaveBeenCalledWith(
      "sub_1",
      { cancel_at_period_end: true, metadata: { nes_ops_rev: "1" } },
      { idempotencyKey: expect.stringMatching(/^nes-sub-cancel-[0-9a-f]{48}$/) },
    );
    // Anulowanie "na koniec okresu" NIE MOŻE ucinać dostępu natychmiast.
    expect(h.subscriptions.cancel).not.toHaveBeenCalled();
  });

  it("buduje klienta dla wskazanego środowiska bramki", async () => {
    await cancelSubscriptionAtPeriodEnd("live", "sub_1");
    expect(h.envs).toEqual(["live"]);
  });

  it("subskrypcja już kończąca się albo anulowana nie dostaje drugiej mutacji", async () => {
    h.subscriptions.retrieve.mockResolvedValueOnce(liveSub({ cancel_at_period_end: true }));
    expect(await cancelSubscriptionAtPeriodEnd("sandbox", "sub_1")).toEqual({ ok: true });
    h.subscriptions.retrieve.mockResolvedValueOnce(liveSub({ status: "canceled" }));
    expect(await cancelSubscriptionAtPeriodEnd("sandbox", "sub_1")).toEqual({ ok: true });

    expect(h.subscriptions.update).not.toHaveBeenCalled();
  });

  it("zaplanowany downgrade jest zwalniany PRZED rezygnacją (operator nie łączy obu)", async () => {
    h.subscriptions.retrieve.mockResolvedValue(
      liveSub({ schedule: { id: "sched_down", metadata: {} } }),
    );

    expect(await cancelSubscriptionAtPeriodEnd("sandbox", "sub_1")).toEqual({ ok: true });
    expect(h.subscriptionSchedules.release).toHaveBeenCalledWith(
      "sched_down",
      {},
      { idempotencyKey: expect.stringMatching(/^nes-sub-schedule-release-/) },
    );
    expect(h.subscriptionSchedules.release.mock.invocationCallOrder[0]).toBeLessThan(
      h.subscriptions.update.mock.invocationCallOrder[0],
    );
  });

  it("ponowienie z tego samego stanu ma TEN SAM klucz; anuluj -> wznów -> anuluj - NOWY", async () => {
    await cancelSubscriptionAtPeriodEnd("sandbox", "sub_1");
    await cancelSubscriptionAtPeriodEnd("sandbox", "sub_1");
    // Po wznowieniu stan wraca do „aktywna, bez końca" - ale z podbitym licznikiem.
    h.subscriptions.retrieve.mockResolvedValue(liveSub({ metadata: { nes_ops_rev: "2" } }));
    await cancelSubscriptionAtPeriodEnd("sandbox", "sub_1");

    const [first, retry, afterResume] = [0, 1, 2].map(
      (i) => optionsOf(h.subscriptions.update, i).idempotencyKey,
    );
    expect(retry).toBe(first);
    // Bez licznika trzecia rezygnacja dostałaby z pamięci operatora odpowiedź
    // pierwszej, NIE wykonując się - a klient czytałby „anulowano".
    expect(afterResume).not.toBe(first);
    expect(h.subscriptions.update.mock.calls[2]?.[1]).toMatchObject({
      metadata: { nes_ops_rev: "3" },
    });
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
  it("kasuje subskrypcję od razu (usunięcie konta = koniec obciążeń), z kluczem", async () => {
    const result = await cancelSubscriptionImmediately("sandbox", "sub_1");

    expect(result).toEqual({ ok: true });
    expect(h.subscriptions.cancel).toHaveBeenCalledWith(
      "sub_1",
      {},
      { idempotencyKey: expect.stringMatching(/^nes-sub-cancel-now-/) },
    );
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

describe("resumeProviderSubscription - żywy stan rozstrzyga mechanizm", () => {
  it("status `paused` (koniec triala bez metody) wznawia `subscriptions.resume`, nie `pause_collection`", async () => {
    h.subscriptions.retrieve.mockResolvedValue(liveSub({ status: "paused" }));

    const result = await resumeProviderSubscription("sandbox", "sub_1");

    expect(result).toEqual({ ok: true, mode: "unpaused" });
    expect(h.subscriptions.resume).toHaveBeenCalledWith(
      "sub_1",
      { billing_cycle_anchor: "now", expand: ["latest_invoice.payments"] },
      { idempotencyKey: expect.stringMatching(/^nes-sub-resume-paused-/) },
    );
    // Dawna ścieżka: `update({ pause_collection: null })` - subskrypcji
    // w statusie `paused` to nie wznawia, a UI meldowało sukces.
    expect(h.subscriptions.update).not.toHaveBeenCalled();
  });

  it("wznowienie, którego faktura nie przeszła, zostawia pauzę i zwraca fakturę", async () => {
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

    expect(await resumeProviderSubscription("sandbox", "sub_1")).toEqual({
      ok: false,
      error: PAYMENT_FAILED,
      hostedInvoiceUrl: HOSTED,
    });
  });

  it("pauza poboru (`pause_collection`, status `active`) jest zdejmowana pustym napisem", async () => {
    h.subscriptions.retrieve.mockResolvedValue(
      liveSub({ pause_collection: { behavior: "void", resumes_at: null } }),
    );

    const result = await resumeProviderSubscription("sandbox", "sub_1");

    expect(result).toEqual({ ok: true, mode: "collection_resumed" });
    const [, payload, options] = h.subscriptions.update.mock.calls[0] as [
      string,
      Record<string, unknown>,
      { idempotencyKey: string },
    ];
    // Pusty napis (nie `undefined`) - pole pominięte zostawiłoby pauzę.
    expect(payload).toEqual({ pause_collection: "", metadata: { nes_ops_rev: "1" } });
    expect(options.idempotencyKey).toMatch(/^nes-sub-resume-/);
    expect(h.subscriptions.resume).not.toHaveBeenCalled();
  });

  it("zaplanowany koniec jest cofany", async () => {
    h.subscriptions.retrieve.mockResolvedValue(liveSub({ cancel_at_period_end: true }));

    expect(await resumeProviderSubscription("sandbox", "sub_1")).toEqual({
      ok: true,
      mode: "cancellation_reverted",
    });
    expect(h.subscriptions.update).toHaveBeenCalledWith(
      "sub_1",
      { cancel_at_period_end: false, metadata: { nes_ops_rev: "1" } },
      expect.objectContaining({ idempotencyKey: expect.any(String) }),
    );
  });

  it("pauza poboru I zaplanowany koniec schodzą jednym wywołaniem", async () => {
    h.subscriptions.retrieve.mockResolvedValue(
      liveSub({ cancel_at_period_end: true, pause_collection: { behavior: "keep_as_draft" } }),
    );

    await resumeProviderSubscription("sandbox", "sub_1");

    expect(h.subscriptions.update).toHaveBeenCalledTimes(1);
    expect(h.subscriptions.update.mock.calls[0]?.[1]).toMatchObject({
      pause_collection: "",
      cancel_at_period_end: false,
    });
  });

  it("bez niczego do wznowienia nie ma mutacji", async () => {
    expect(await resumeProviderSubscription("sandbox", "sub_1")).toEqual({
      ok: true,
      mode: "already_active",
    });
    expect(h.subscriptions.update).not.toHaveBeenCalled();
    expect(h.subscriptions.resume).not.toHaveBeenCalled();
  });

  it("przekazuje odmowę operatora zamiast ją połknąć", async () => {
    h.subscriptions.retrieve.mockRejectedValue(NO_SUCH_SUB);

    expect(await resumeProviderSubscription("sandbox", "sub_ghost")).toEqual({
      ok: false,
      error: NO_SUCH_SUB_TEXT,
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

describe("changeSubscriptionPrice - upgrade: dopłata PRZED zmianą", () => {
  const upgrade = () =>
    changeSubscriptionPrice("sandbox", "sub_1", { newPriceExternalId: "pro_monthly" });

  it("podmienia pozycję z `pending_if_incomplete` - bez parametrów, których oczekująca zmiana nie przyjmuje", async () => {
    const result = await upgrade();

    expect(result).toEqual({
      ok: true,
      direction: "upgrade",
      effect: "applied",
      currentPeriodEnd: PERIOD_END_ISO,
      cancelAtPeriodEnd: false,
    });
    expect(h.subscriptions.update).toHaveBeenCalledTimes(1);
    expect(h.subscriptions.update).toHaveBeenCalledWith(
      "sub_1",
      {
        items: [{ id: "si_1", price: "price_new", quantity: 1 }],
        proration_behavior: "always_invoice",
        payment_behavior: "pending_if_incomplete",
        expand: ["latest_invoice.payments"],
      },
      { idempotencyKey: expect.stringMatching(/^nes-sub-plan-upgrade-[0-9a-f]{48}$/) },
    );
    expect(h.subscriptionSchedules.create).not.toHaveBeenCalled();
  });

  it("ODRZUCONA DOPŁATA (`pending_update`): wynik `payment_failed` z fakturą, nie sukces", async () => {
    h.subscriptions.update.mockResolvedValue(
      liveSub({
        // Pozycje oczekującej zmiany niosą STARĄ cenę - operator nic nie podmienił.
        pending_update: { expires_at: PERIOD_END, subscription_items: [] },
        latest_invoice: {
          id: "in_proration",
          hosted_invoice_url: HOSTED,
          payments: { data: [{ payment: { payment_intent: "pi_declined" } }] },
        },
      }),
    );

    expect(await upgrade()).toEqual({
      ok: false,
      error: PAYMENT_FAILED,
      hostedInvoiceUrl: HOSTED,
    });
    expect(h.paymentIntents.retrieve).toHaveBeenCalledWith("pi_declined");
  });

  it("3DS (`requires_action`) to osobny wynik - zmiana czeka na potwierdzenie", async () => {
    h.subscriptions.update.mockResolvedValue(
      liveSub({
        pending_update: { expires_at: PERIOD_END },
        latest_invoice: {
          id: "in_proration",
          hosted_invoice_url: HOSTED,
          payments: { data: [{ payment: { payment_intent: { status: "requires_action" } } }] },
        },
      }),
    );

    expect(await upgrade()).toMatchObject({ ok: false, error: PAYMENT_REQUIRES_ACTION });
    expect(h.paymentIntents.retrieve).not.toHaveBeenCalled();
  });

  it("odmowa RZUCONA przez operatora (`card_declined`) daje ten sam wynik domenowy", async () => {
    h.subscriptions.update.mockRejectedValue(
      Object.assign(new Error("Your card was declined"), {
        type: "StripeCardError",
        code: "card_declined",
        raw: { type: "card_error", code: "card_declined" },
      }),
    );
    h.subscriptions.retrieve
      .mockResolvedValueOnce(liveSub())
      .mockResolvedValueOnce(
        liveSub({ pending_update: {}, latest_invoice: { hosted_invoice_url: HOSTED } }),
      );

    expect(await upgrade()).toEqual({
      ok: false,
      error: PAYMENT_FAILED,
      hostedInvoiceUrl: HOSTED,
    });
  });

  it("zaplanowane anulowanie cofamy DOPIERO po udanej dopłacie, osobnym wywołaniem", async () => {
    h.subscriptions.retrieve.mockResolvedValue(liveSub({ cancel_at_period_end: true }));

    const result = await upgrade();

    expect(result).toMatchObject({ ok: true, effect: "applied", cancelAtPeriodEnd: false });
    expect(h.subscriptions.update).toHaveBeenCalledTimes(2);
    expect(h.subscriptions.update.mock.calls[0]?.[1]).not.toHaveProperty("cancel_at_period_end");
    expect(h.subscriptions.update.mock.calls[1]?.[1]).toEqual({
      cancel_at_period_end: false,
      metadata: { nes_ops_rev: "1" },
    });
    expect(optionsOf(h.subscriptions.update, 1).idempotencyKey).toMatch(/^nes-sub-cancel-revert-/);
  });

  it("upgrade opłacony, ale zdjęcie końca nieudane: wynik mówi, że koniec WCIĄŻ zaplanowany", async () => {
    h.subscriptions.retrieve.mockResolvedValue(liveSub({ cancel_at_period_end: true }));
    h.subscriptions.update
      .mockResolvedValueOnce(
        liveSub({ items: { data: [subscriptionItem({ price: { id: "price_new" } })] } }),
      )
      .mockRejectedValueOnce(providerError("rate limited"));
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});

    expect(await upgrade()).toMatchObject({
      ok: true,
      effect: "applied",
      cancelAtPeriodEnd: true,
    });
    logged.mockRestore();
  });

  it("nieudana dopłata NIE odwołuje rezygnacji", async () => {
    h.subscriptions.retrieve.mockResolvedValue(liveSub({ cancel_at_period_end: true }));
    h.subscriptions.update.mockResolvedValue(liveSub({ pending_update: {} }));

    expect(await upgrade()).toMatchObject({ ok: false, error: PAYMENT_FAILED });
    expect(h.subscriptions.update).toHaveBeenCalledTimes(1);
  });

  it("upgrade zwalnia zaplanowany downgrade, zanim podmieni pozycję", async () => {
    h.subscriptions.retrieve.mockResolvedValue(
      liveSub({ schedule: { id: "sched_down", metadata: {} } }),
    );

    await upgrade();

    expect(h.subscriptionSchedules.release).toHaveBeenCalledWith(
      "sched_down",
      {},
      expect.objectContaining({ idempotencyKey: expect.any(String) }),
    );
    expect(h.subscriptionSchedules.release.mock.invocationCallOrder[0]).toBeLessThan(
      h.subscriptions.update.mock.invocationCallOrder[0],
    );
  });

  it("klucz: ponowienie z tego samego stanu - ten sam; po próbie z nową fakturą - nowy", async () => {
    await upgrade();
    await upgrade();
    // Nieudana pierwsza próba zostawia nową fakturę jako `latest_invoice` -
    // ponowienie po dodaniu karty MUSI być nową operacją, nie odpowiedzią z pamięci.
    h.subscriptions.retrieve.mockResolvedValue(liveSub({ latest_invoice: "in_proration" }));
    await upgrade();

    const keys = [0, 1, 2].map((i) => optionsOf(h.subscriptions.update, i).idempotencyKey);
    expect(keys[1]).toBe(keys[0]);
    expect(keys[2]).not.toBe(keys[0]);
  });

  it("A -> B -> A -> B w ciągu doby: kolejne B to inny okres, więc inny klucz", async () => {
    await upgrade();
    h.subscriptions.retrieve.mockResolvedValue(
      liveSub({
        items: { data: [subscriptionItem({ current_period_start: PERIOD_END })] },
      }),
    );
    await upgrade();

    expect(optionsOf(h.subscriptions.update, 1).idempotencyKey).not.toBe(
      optionsOf(h.subscriptions.update, 0).idempotencyKey,
    );
  });
});

describe("changeSubscriptionPrice - downgrade od nowego okresu", () => {
  it("nie rusza bieżącej pozycji - harmonogram z fazą do końca okresu", async () => {
    const result = await changeSubscriptionPrice("sandbox", "sub_1", {
      newPriceExternalId: "student_monthly",
    });

    expect(result).toEqual({
      ok: true,
      direction: "downgrade",
      effect: "scheduled",
      currentPeriodEnd: PERIOD_END_ISO,
      cancelAtPeriodEnd: false,
    });
    // Żadnej natychmiastowej podmiany: opłacony okres należy się klientowi.
    expect(h.subscriptions.update).not.toHaveBeenCalled();
    expect(h.subscriptionSchedules.create).toHaveBeenCalledWith(
      { from_subscription: "sub_1" },
      { idempotencyKey: expect.stringMatching(/^nes-sub-schedule-create-/) },
    );
    expect(h.subscriptionSchedules.update).toHaveBeenCalledWith(
      "sched_1",
      {
        end_behavior: "release",
        phases: [
          {
            items: [{ price: "price_old", quantity: 1 }],
            start_date: PERIOD_START,
            end_date: PERIOD_END,
          },
          { items: [{ price: "price_new", quantity: 1 }] },
        ],
        metadata: { nes_ops_rev: "1" },
      },
      { idempotencyKey: expect.stringMatching(/^nes-sub-schedule-update-/) },
    );
  });

  it("kierunek liczy ŻYWA cena: operator ma już pro, więc zejście na plus to downgrade", async () => {
    h.subscriptions.retrieve.mockResolvedValue(
      liveSub({
        items: {
          data: [subscriptionItem({ price: { id: "price_pro", lookup_key: "pro_monthly" } })],
        },
      }),
    );

    const result = await changeSubscriptionPrice("sandbox", "sub_1", {
      newPriceExternalId: "plus_monthly",
    });

    expect(result).toMatchObject({ ok: true, direction: "downgrade", effect: "scheduled" });
    expect(h.subscriptions.update).not.toHaveBeenCalled();
  });

  it("dołączony harmonogram jest AKTUALIZOWANY (drugi downgrade), nie zakładany drugi raz", async () => {
    h.subscriptions.retrieve.mockResolvedValue(
      liveSub({
        schedule: {
          id: "sched_existing",
          metadata: { nes_ops_rev: "4" },
          current_phase: { start_date: PERIOD_START - 60, end_date: PERIOD_END },
        },
      }),
    );

    await changeSubscriptionPrice("sandbox", "sub_1", { newPriceExternalId: "student_monthly" });

    expect(h.subscriptionSchedules.create).not.toHaveBeenCalled();
    expect(h.subscriptionSchedules.update).toHaveBeenCalledWith(
      "sched_existing",
      expect.objectContaining({
        // Początek bieżącej fazy należy do harmonogramu - operator odrzuca jego zmianę.
        phases: [expect.objectContaining({ start_date: PERIOD_START - 60 }), expect.anything()],
        metadata: { nes_ops_rev: "5" },
      }),
      expect.objectContaining({ idempotencyKey: expect.any(String) }),
    );
  });

  it("downgrade na subskrypcji kończącej się zdejmuje flagę jawnie, a porażka harmonogramu ją przywraca", async () => {
    h.subscriptions.retrieve.mockResolvedValue(liveSub({ cancel_at_period_end: true }));
    h.subscriptions.update.mockResolvedValue(
      liveSub({ cancel_at_period_end: false, metadata: { nes_ops_rev: "1" } }),
    );
    h.subscriptionSchedules.update.mockRejectedValue(providerError("schedule conflict"));
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await changeSubscriptionPrice("sandbox", "sub_1", {
      newPriceExternalId: "student_monthly",
    });

    expect(result).toMatchObject({ ok: false });
    expect(h.subscriptions.update.mock.calls.map((c) => c[1])).toEqual([
      { cancel_at_period_end: false, metadata: { nes_ops_rev: "1" } },
      // Klient, który odchodził, nie zostaje po cichu z odnawialną subskrypcją.
      { cancel_at_period_end: true, metadata: { nes_ops_rev: "2" } },
    ]);
    expect(optionsOf(h.subscriptions.update, 1).idempotencyKey).toMatch(/^nes-sub-cancel-restore-/);
    logged.mockRestore();
  });
});

describe("changeSubscriptionPrice - cele i stany, których nie przełączamy", () => {
  it("brak ceny u operatora przerywa zmianę planu przed dotknięciem subskrypcji", async () => {
    h.prices.list.mockResolvedValue({ data: [] });

    expect(
      await changeSubscriptionPrice("sandbox", "sub_1", { newPriceExternalId: "ghost_plan" }),
    ).toEqual({ ok: false, error: "price_missing" });
    expect(h.subscriptions.retrieve).not.toHaveBeenCalled();
    expect(h.subscriptions.update).not.toHaveBeenCalled();
  });

  it("subskrypcja bez pozycji nie jest modyfikowana", async () => {
    h.subscriptions.retrieve.mockResolvedValue(liveSub({ items: { data: [] } }));

    expect(
      await changeSubscriptionPrice("sandbox", "sub_1", { newPriceExternalId: "pro_monthly" }),
    ).toEqual({ ok: false, error: "no_subscription_item" });
    expect(h.subscriptions.update).not.toHaveBeenCalled();
  });

  it.each([
    ["decision_lab_seat", "plan_not_switchable"],
    ["team_monthly_seat", "plan_kind_mismatch"],
    ["plus_monthly", "same_plan"],
    ["ghost_plan", "plan_not_switchable"],
  ])("cel %s jest odmową %s, bez mutacji", async (target, error) => {
    expect(
      await changeSubscriptionPrice("sandbox", "sub_1", { newPriceExternalId: target }),
    ).toEqual({ ok: false, error });
    expect(h.subscriptions.update).not.toHaveBeenCalled();
    expect(h.subscriptionSchedules.create).not.toHaveBeenCalled();
  });

  it("cena spoza katalogu na subskrypcji (darowizna, cena ad-hoc) nie staje się planem", async () => {
    h.subscriptions.retrieve.mockResolvedValue(
      liveSub({ items: { data: [subscriptionItem({ price: { id: "price_adhoc" } })] } }),
    );

    expect(
      await changeSubscriptionPrice("sandbox", "sub_1", { newPriceExternalId: "pro_monthly" }),
    ).toEqual({ ok: false, error: "subscription_not_switchable" });
  });

  it.each([
    [{ status: "past_due" }, "subscription_not_active"],
    [{ status: "paused" }, "subscription_not_active"],
    [{ status: "incomplete" }, "subscription_not_active"],
    [{ pause_collection: { behavior: "void" } }, "subscription_paused"],
  ])("stan %o jest odmową %s - najpierw zapłata/wznowienie", async (over, error) => {
    h.subscriptions.retrieve.mockResolvedValue(liveSub(over));

    expect(
      await changeSubscriptionPrice("sandbox", "sub_1", { newPriceExternalId: "pro_monthly" }),
    ).toEqual({ ok: false, error });
    expect(h.subscriptions.update).not.toHaveBeenCalled();
  });

  it("odmowa operatora inna niż płatność wraca z treścią", async () => {
    h.subscriptions.update.mockRejectedValue(NO_SUCH_SUB);

    expect(
      await changeSubscriptionPrice("sandbox", "sub_1", { newPriceExternalId: "pro_monthly" }),
    ).toEqual({ ok: false, error: NO_SUCH_SUB_TEXT });
  });
});

describe("updateSubscriptionQuantity", () => {
  const seats = (quantity: number) =>
    updateSubscriptionQuantity("sandbox", "sub_1", {
      priceExternalId: "team_monthly_seat",
      quantity,
      previousQuantity: 4,
    });

  beforeEach(() => {
    h.subscriptions.retrieve.mockResolvedValue(liveSub({ items: { data: [teamItem(4)] } }));
    h.subscriptions.update.mockResolvedValue(liveSub({ items: { data: [teamItem(6)] } }));
  });

  it("brak zmiany liczby miejsc nie generuje mutacji", async () => {
    expect(await seats(4)).toEqual({ ok: true, quantity: 4, effect: "applied" });
    expect(h.subscriptions.update).not.toHaveBeenCalled();
    expect(h.subscriptionSchedules.create).not.toHaveBeenCalled();
  });

  it("dołożenie miejsc: tylko ilość, z dopłatą przed zmianą i kluczem", async () => {
    expect(await seats(6)).toEqual({ ok: true, quantity: 6, effect: "applied" });
    expect(h.subscriptions.update).toHaveBeenCalledWith(
      "sub_1",
      {
        // Bez `price`: zmiana ilości nie może przy okazji przełączyć ceny.
        items: [{ id: "si_1", quantity: 6 }],
        proration_behavior: "always_invoice",
        payment_behavior: "pending_if_incomplete",
        expand: ["latest_invoice.payments"],
      },
      { idempotencyKey: expect.stringMatching(/^nes-sub-seats-increase-/) },
    );
  });

  it("odrzucona dopłata za miejsca: `payment_failed`, miejsc nie przybywa", async () => {
    h.subscriptions.update.mockResolvedValue(
      liveSub({
        items: { data: [teamItem(4)] },
        pending_update: {},
        latest_invoice: { hosted_invoice_url: HOSTED },
      }),
    );

    expect(await seats(6)).toEqual({
      ok: false,
      error: PAYMENT_FAILED,
      hostedInvoiceUrl: HOSTED,
    });
  });

  it("zdjęcie miejsc idzie HARMONOGRAMEM od nowego okresu, nie od razu", async () => {
    expect(await seats(2)).toEqual({ ok: true, quantity: 2, effect: "scheduled" });
    // Dawniej: `update({ quantity: 2, proration_behavior: "none" })` - miejsca
    // znikały od razu, bez zwrotu, wbrew obietnicy „od kolejnego okresu".
    expect(h.subscriptions.update).not.toHaveBeenCalled();
    expect(h.subscriptionSchedules.update).toHaveBeenCalledWith(
      "sched_1",
      expect.objectContaining({
        phases: [
          {
            items: [{ price: "price_team", quantity: 4 }],
            start_date: PERIOD_START,
            end_date: PERIOD_END,
          },
          { items: [{ price: "price_team", quantity: 2 }] },
        ],
      }),
      expect.objectContaining({ idempotencyKey: expect.any(String) }),
    );
  });

  it("powrót do bieżącej liczby zwalnia zaplanowane zmniejszenie", async () => {
    h.subscriptions.retrieve.mockResolvedValue(
      liveSub({ items: { data: [teamItem(4)] }, schedule: { id: "sched_seats", metadata: {} } }),
    );

    expect(await seats(4)).toEqual({ ok: true, quantity: 4, effect: "applied" });
    expect(h.subscriptionSchedules.release).toHaveBeenCalledWith(
      "sched_seats",
      {},
      expect.objectContaining({ idempotencyKey: expect.any(String) }),
    );
  });

  it("kierunek liczy ŻYWA ilość, nie lustro (`previousQuantity`)", async () => {
    // Lustro mówi 4, operator ma już 8 (webhook w drodze): 6 to ZMNIEJSZENIE.
    h.subscriptions.retrieve.mockResolvedValue(liveSub({ items: { data: [teamItem(8)] } }));

    expect(await seats(6)).toEqual({ ok: true, quantity: 6, effect: "scheduled" });
    expect(h.subscriptions.update).not.toHaveBeenCalled();
  });

  it("liczba miejsc jest przycinana do zakresu 1-500", async () => {
    expect(await seats(9_000)).toMatchObject({ ok: true, quantity: 500 });
    expect(await seats(-3)).toMatchObject({ ok: true, quantity: 1 });
  });

  it("subskrypcja na innej cenie niż deklarowana nie dostaje zmiany ilości", async () => {
    h.subscriptions.retrieve.mockResolvedValue(liveSub());

    expect(await seats(6)).toEqual({ ok: false, error: "not_per_seat_plan" });
    expect(h.subscriptions.update).not.toHaveBeenCalled();
  });

  it("wstrzymana albo zaległa subskrypcja nie dostaje miejsc", async () => {
    h.subscriptions.retrieve.mockResolvedValue(
      liveSub({ status: "past_due", items: { data: [teamItem(4)] } }),
    );

    expect(await seats(6)).toEqual({ ok: false, error: "subscription_not_active" });
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
