// ZLECANY PRZEZ NAS ZWROT PIENIĘDZY - 0% pokrycia do 31.08.2026 (0 z 3 funkcji).
//
// PO CO TEN PLIK ISTNIEJE. To jedyne miejsce w repo, które SAMO oddaje
// pieniądze kartą: `oneTimeFulfilment.server` woła `refundTransactionFully`,
// gdy ostatnie miejsce na wydarzeniu zajął ktoś inny w chwili księgowania
// płatności. Operacja jest NIEODWRACALNA - pomyłka w rozwiązywaniu
// identyfikatora transakcji albo w mapowaniu powodu kończy się albo zwrotem,
// który nie doszedł (klient bez biletu i bez pieniędzy), albo zwrotem
// wykonanym dwa razy.
//
// CO TEN PLIK MIERZY: WYŁĄCZNIE gałęzie odmowy i awarii - rozwiązanie sesji
// checkout do PaymentIntentu, brak PaymentIntentu, obcy kształt
// identyfikatora, kwota niedodatnia, wywrotka SDK. Ścieżka szczęśliwa jest tu
// tylko po to, żeby dowieść kontraktu wywołania (jakie pola idą do operatora).
//
// GRANICA ATRAP: podmieniony jest wyłącznie `createStripeClient` (klient
// operatora). `getStripeErrorMessage` biegnie PRAWDZIWY - to on decyduje, co
// zobaczy operator w logu po nieudanym zwrocie, więc atrapowanie go
// zamieniłoby test komunikatu błędu w test atrapy. ŻADNE żądanie nie wychodzi
// do sieci i żaden prawdziwy klucz nie jest czytany.
import { describe, expect, it, vi, beforeEach, type Mock } from "vitest";

import type { StripeEnv } from "@/lib/stripe.server";

const h = vi.hoisted(() => ({
  createStripeClient: vi.fn(),
  refundsCreate: vi.fn(),
  sessionsRetrieve: vi.fn(),
}));

// Atrapowana jest GRANICA (fabryka klienta operatora), a nie moduł - reszta
// `stripe.server`, w tym mapowanie komunikatu błędu, zostaje prawdziwa.
vi.mock("@/lib/stripe.server", async () => {
  const actual = await vi.importActual<typeof import("@/lib/stripe.server")>("@/lib/stripe.server");
  return { ...actual, createStripeClient: h.createStripeClient };
});

import {
  refundTransactionFully,
  refundTransactionPartially,
  type RefundReason,
} from "@/lib/billing/refundProvider.server";

/** Podzbiór klienta operatora, którego dotyka ten moduł. */
interface StripeDouble {
  refunds: { create: Mock };
  checkout: { sessions: { retrieve: Mock } };
}

function stripeDouble(): StripeDouble {
  return {
    refunds: { create: h.refundsCreate },
    checkout: { sessions: { retrieve: h.sessionsRetrieve } },
  };
}

const ENV: StripeEnv = "sandbox";
const PI = "pi_1SyntetycznyTestowy";
const CS = "cs_1SyntetycznaSesja";

/** Zawężenie bez rzutowania - argumenty atrapy są z natury nietypowane. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** Argumenty pierwszego (i jedynego) zlecenia zwrotu u operatora. */
function refundParams(): Record<string, unknown> {
  const call: unknown[] = h.refundsCreate.mock.calls[0] ?? [];
  const params = call[0];
  if (!isRecord(params)) throw new Error("test: operator nie dostał zlecenia zwrotu");
  return params;
}

/** Drugi argument `refunds.create` - miejsce na opcje SDK (klucz idempotencji). */
function refundOptions(): Record<string, unknown> | null {
  const call: unknown[] = h.refundsCreate.mock.calls[0] ?? [];
  const options = call[1];
  return isRecord(options) ? options : null;
}

beforeEach(() => {
  h.createStripeClient.mockReset();
  h.refundsCreate.mockReset();
  h.sessionsRetrieve.mockReset();
  h.createStripeClient.mockImplementation(() => stripeDouble());
  h.refundsCreate.mockResolvedValue({ id: "re_1SyntetycznyZwrot" });
  h.sessionsRetrieve.mockResolvedValue({ payment_intent: PI });
});

describe("refundTransactionFully - kontrakt zlecenia", () => {
  it("zleca pełny zwrot PaymentIntentu i oddaje identyfikator korekty", async () => {
    // Kontrakt wywołania jest tu regułą pieniężną: `payment_intent` bez
    // `amount` oznacza u operatora ZWROT CAŁOŚCI. Gdyby kod dołożył `amount`,
    // klient dostałby z powrotem mniej, niż zapłacił, a my uznalibyśmy sprawę
    // za zamkniętą.
    const result = await refundTransactionFully(ENV, PI, "oversold");

    expect(result).toEqual({ ok: true, adjustmentId: "re_1SyntetycznyZwrot" });
    expect(refundParams()).toEqual({
      payment_intent: PI,
      reason: "requested_by_customer",
      metadata: { reason_detail: "Event sold out before payment was fulfilled" },
    });
    expect(refundParams().amount).toBeUndefined();
  });

  it("identyfikator sesji checkout jest rozwiązywany do PaymentIntentu", async () => {
    // Operator NIE przyjmuje zwrotu po identyfikatorze sesji. Bez tego kroku
    // każdy zwrot zamówienia zapisanego sesją kończyłby się odmową.
    const result = await refundTransactionFully(ENV, CS, "duplicate");

    expect(h.sessionsRetrieve).toHaveBeenCalledWith(CS);
    expect(refundParams().payment_intent).toBe(PI);
    expect(result).toEqual({ ok: true, adjustmentId: "re_1SyntetycznyZwrot" });
  });

  it("rozwinięty obiekt PaymentIntentu w sesji też daje identyfikator", async () => {
    // SDK oddaje `payment_intent` raz jako napis, raz jako rozwinięty obiekt
    // (zależnie od `expand`). Obie postacie muszą prowadzić do tego samego
    // zwrotu - inaczej zwrot milcząco nie dochodzi do skutku.
    h.sessionsRetrieve.mockResolvedValue({ payment_intent: { id: "pi_rozwiniety" } });

    const result = await refundTransactionFully(ENV, CS, "error");

    expect(refundParams().payment_intent).toBe("pi_rozwiniety");
    expect(result).toEqual({ ok: true, adjustmentId: "re_1SyntetycznyZwrot" });
  });

  it.each<[RefundReason, string, string]>([
    ["oversold", "requested_by_customer", "Event sold out before payment was fulfilled"],
    ["duplicate", "duplicate", "Duplicate payment"],
    ["error", "requested_by_customer", "Fulfilment error"],
  ])(
    "powód `%s` schodzi na enum operatora i opis w metadanych",
    async (reason, enumValue, text) => {
      // Enum operatora jest WĘŻSZY niż nasze powody domenowe. Test pilnuje, żeby
      // zawężenie nie zgubiło informacji: opis własny musi zostać w `metadata`,
      // bo to jedyny ślad, DLACZEGO oddaliśmy pieniądze.
      await refundTransactionFully(ENV, PI, reason);

      expect(refundParams()).toMatchObject({
        reason: enumValue,
        metadata: { reason_detail: text },
      });
    },
  );
});

describe("refundTransactionFully - ODMOWY i awarie", () => {
  it("ODRZUCA identyfikator o obcym kształcie BEZ pytania operatora", async () => {
    // `txn_...` / numer faktury / cokolwiek innego niż `pi_`/`cs_` nie da się
    // rozwiązać do PaymentIntentu. Odmawiamy PRZED wyjściem na zewnątrz -
    // ślepe wywołanie kończyłoby się zwrotem nie tej transakcji albo błędem
    // operatora zapisanym jako „zwrot wykonany".
    const result = await refundTransactionFully(ENV, "txn_stary_paddle", "oversold");

    expect(result).toEqual({ ok: false, error: "payment_intent_not_found" });
    expect(h.refundsCreate).not.toHaveBeenCalled();
    expect(h.sessionsRetrieve).not.toHaveBeenCalled();
  });

  it("sesja BEZ PaymentIntentu (płatność nieopłacona) to odmowa, nie zwrot", async () => {
    // Sesja checkout istnieje także wtedy, gdy klient nigdy nie zapłacił.
    // Nie ma czego zwracać - i nie wolno tego pomylić z sukcesem.
    h.sessionsRetrieve.mockResolvedValue({ payment_intent: null });

    const result = await refundTransactionFully(ENV, CS, "oversold");

    expect(result).toEqual({ ok: false, error: "payment_intent_not_found" });
    expect(h.refundsCreate).not.toHaveBeenCalled();
  });

  it("awaria operatora W TRAKCIE zwrotu daje `ok:false` z pełnym komunikatem", async () => {
    // Kontrakt modułu: NIE rzucamy. Wywołujący (`oneTimeFulfilment`) sam
    // decyduje, czy zablokować realizację - i rzuca dopiero on, żeby webhook
    // został ponowiony. Komunikat musi nieść typ i kod operatora, bo to jedyne,
    // z czym operator zostaje przy reklamacji.
    h.refundsCreate.mockRejectedValue({
      message: "Charge has already been refunded",
      type: "invalid_request_error",
      code: "charge_already_refunded",
      requestId: "req_syntetyczny",
    });
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await refundTransactionFully(ENV, PI, "oversold");

    expect(result.ok).toBe(false);
    expect(result).toEqual({
      ok: false,
      error:
        "Charge has already been refunded (invalid_request_error, charge_already_refunded, req_syntetyczny)",
    });
    expect(errorLog).toHaveBeenCalled();
    errorLog.mockRestore();
  });

  it("wywrotka przy ODCZYCIE sesji też kończy się odmową, nie wyjątkiem", async () => {
    // Awaria na kroku rozwiązywania identyfikatora jest tak samo groźna jak na
    // samym zwrocie: wyjątek przeleciałby przez `oneTimeFulfilment` do webhooka
    // i zamienił „nie udało się oddać pieniędzy" w twardy błąd bez powodu.
    h.sessionsRetrieve.mockRejectedValue(new Error("gateway timeout"));
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await refundTransactionFully(ENV, CS, "oversold");

    expect(result).toEqual({ ok: false, error: "gateway timeout" });
    expect(h.refundsCreate).not.toHaveBeenCalled();
    errorLog.mockRestore();
  });

  it("brak konfiguracji klucza operatora nie wywraca ścieżki zwrotu", async () => {
    // `createStripeClient` czyta zmienne środowiskowe i RZUCA, gdy ich nie ma.
    // To zdarza się realnie na źle skonfigurowanym środowisku - i musi wrócić
    // jako `ok:false`, a nie jako nieobsłużony wyjątek w webhooku.
    h.createStripeClient.mockImplementation(() => {
      throw new Error("STRIPE_SANDBOX_API_KEY is not configured");
    });
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await refundTransactionFully(ENV, PI, "oversold");

    expect(result).toEqual({ ok: false, error: "STRIPE_SANDBOX_API_KEY is not configured" });
    errorLog.mockRestore();
  });

  it("wywrotka bez czytelnego komunikatu schodzi na komunikat zastępczy", async () => {
    // Gałąź `getStripeErrorMessage` dla obiektu bez `message` - bez niej
    // w logu zostałoby `undefined`, czyli nic.
    h.refundsCreate.mockRejectedValue({ nieznane: true });
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await refundTransactionFully(ENV, PI, "oversold");

    expect(result).toEqual({ ok: false, error: "Stripe request failed" });
    errorLog.mockRestore();
  });
});

describe("refundTransactionPartially - WALIDACJA KWOTY", () => {
  it.each([0, -1, -4900, Number.NaN, Number.POSITIVE_INFINITY])(
    "kwota `%s` jest ODRZUCANA zanim powstanie klient operatora",
    async (amount) => {
      // Kwota niedodatnia albo nieskończona to błąd wołającego, nie transakcji.
      // Odmowa musi paść PRZED utworzeniem klienta: inaczej zły wynik obliczeń
      // ceny wychodziłby na zewnątrz i to operator decydowałby, co z nim zrobić.
      const result = await refundTransactionPartially(ENV, PI, amount, "error");

      expect(result).toEqual({ ok: false, error: "invalid_amount" });
      expect(h.createStripeClient).not.toHaveBeenCalled();
      expect(h.refundsCreate).not.toHaveBeenCalled();
    },
  );

  it("kwota ułamkowa jest zaokrąglana do pełnego grosza", async () => {
    // Operator przyjmuje wyłącznie liczby całkowite jednostek waluty.
    // Przekazanie 1234.6 skończyłoby się odmową całego zwrotu.
    const result = await refundTransactionPartially(ENV, PI, 1234.6, "error");

    expect(refundParams().amount).toBe(1235);
    expect(result.ok).toBe(true);
  });
});

describe("refundTransactionPartially - kontrakt i awarie", () => {
  it("zleca zwrot części kwoty z powodem i opisem", async () => {
    const result = await refundTransactionPartially(ENV, PI, 3000, "duplicate");

    expect(result).toEqual({ ok: true, adjustmentId: "re_1SyntetycznyZwrot" });
    expect(refundParams()).toEqual({
      payment_intent: PI,
      amount: 3000,
      reason: "duplicate",
      metadata: { reason_detail: "Duplicate payment" },
    });
  });

  it("sesja checkout jest rozwiązywana także dla zwrotu częściowego", async () => {
    await refundTransactionPartially(ENV, CS, 1500, "error");

    expect(h.sessionsRetrieve).toHaveBeenCalledWith(CS);
    expect(refundParams()).toMatchObject({ payment_intent: PI, amount: 1500 });
  });

  it("brak PaymentIntentu blokuje zwrot częściowy tak samo jak pełny", async () => {
    h.sessionsRetrieve.mockResolvedValue({ payment_intent: null });

    const result = await refundTransactionPartially(ENV, CS, 1500, "error");

    expect(result).toEqual({ ok: false, error: "payment_intent_not_found" });
    expect(h.refundsCreate).not.toHaveBeenCalled();
  });

  it("odmowa operatora (kwota większa niż obciążenie) wraca jako `ok:false`", async () => {
    // Progu „nie więcej niż pobrano" pilnuje operator - ten test dowodzi, że
    // jego odmowa DOCIERA do wywołującego zamiast zostać połknięta.
    h.refundsCreate.mockRejectedValue({
      raw: {
        message: "Refund amount ($150.00) is greater than charge amount",
        type: "invalid_request_error",
        param: "amount",
      },
    });
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await refundTransactionPartially(ENV, PI, 15000, "error");

    expect(result).toEqual({
      ok: false,
      error:
        "Refund amount ($150.00) is greater than charge amount (invalid_request_error, amount)",
    });
    errorLog.mockRestore();
  });
});

describe("refundProvider - DEFEKTY (bramki regresji, świadomie czerwone)", () => {
  // ---------------------------------------------------------------------
  // DEFEKT: zlecenie zwrotu NIE NIESIE KLUCZA IDEMPOTENCJI.
  //
  // CO JEST ZŁE. `stripe.refunds.create` jest wołane z jednym argumentem -
  // samymi parametrami zwrotu. SDK operatora przyjmuje drugi argument
  // (`{ idempotencyKey }`), który gwarantuje, że powtórzone żądanie o tym
  // samym kluczu zwróci TĘ SAMĄ korektę zamiast utworzyć nową.
  //
  // DLACZEGO TO RYZYKO (droga jest konkretna, nie teoretyczna).
  // `oneTimeFulfilment.server.refundIfOversold` wykonuje kolejno:
  //   1. `refundTransactionFully(...)`      <- pieniądze wychodzą,
  //   2. `payment_orders.update(status: "refunded")`,
  //      a przy błędzie zapisu: `throw new Error("oversold status flip failed")`.
  // Wyjątek z kroku 2 zamienia się w HTTP 500, operator ponawia dostarczenie
  // zdarzenia, ścieżka rusza od nowa i krok 1 wykonuje się DRUGI RAZ - na tej
  // samej transakcji, bez żadnego klucza, który by to powstrzymał. Skutek:
  // podwójny zwrot tej samej płatności. Ta sama pułapka dotyczy każdego
  // ponowienia sieciowego wewnątrz SDK.
  //
  // DLACZEGO NIE NAPRAWIAM. Zadanie zabrania zmian w kodzie produkcyjnym,
  // a poprawka nie jest jednolinijkowa: klucz musi być WYPROWADZONY ZE
  // ZDARZENIA (np. `oversold:${orderId}` albo identyfikator korekty), a nie
  // losowy - losowy klucz nie chroni przed niczym. Wymaga więc zmiany
  // sygnatury obu funkcji i wszystkich wywołań, czyli decyzji właściciela
  // modułu. Test zostaje jako bramka: gdy klucz zostanie dodany, `it.fails`
  // zapali się na czerwono i każe zamienić go na zwykły `it`.
  // ---------------------------------------------------------------------
  it.fails("zwrot pełny powinien nieść klucz idempotencji operatora", async () => {
    await refundTransactionFully(ENV, PI, "oversold");

    expect(refundOptions()?.idempotencyKey).toEqual(expect.any(String));
  });

  it.fails("zwrot częściowy powinien nieść klucz idempotencji operatora", async () => {
    await refundTransactionPartially(ENV, PI, 3000, "error");

    expect(refundOptions()?.idempotencyKey).toEqual(expect.any(String));
  });
});
