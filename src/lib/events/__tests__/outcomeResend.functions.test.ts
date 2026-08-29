// Ponowna wysyłka powiadomień o wyniku zgłoszenia - deklaracja server function.
//
// Logika mieszka w `outcomeResend.server.ts` (ma własny plik testowy), więc tu
// zostaje sama obwódka - a ta niesie DWIE rzeczy, których nie sprawdzi żaden
// test warstwy logiki:
//
//   1. WALIDATOR WEJŚCIA. Jedyna bariera między publicznym `POST`
//      a `.eq("id", …)` na kolumnie `uuid`. Rozluźnienie go (albo usunięcie
//      przy refaktorze) przepuszcza dowolny tekst do zapytania.
//   2. BRAMKA ROLI PO STRONIE SERWERA. Samo zalogowanie NIE wystarcza:
//      `assertAdmin` musi wykonać się PRZED odczytem i przed wysyłką. Wysyłka
//      idzie kluczem serwisowym, z pominięciem RLS, więc odwrócenie tej
//      kolejności pozwoliłoby dowolnemu zalogowanemu użytkownikowi ponowić
//      mail o cudzym zgłoszeniu - i po fakcie dostać jego treść w wyniku.
//
// Klient podaje WYŁĄCZNIE identyfikator zgłoszenia; adresat i treść pochodzą
// z bazy - test pilnuje, że nic więcej z ciała żądania nie jedzie dalej.
//
// PUŁAPKA HARNESSU: atrapa `createServerFn` oddaje z `.handler(fn)` samą
// funkcję z doklejonym `validate`, więc test wywołuje PRAWDZIWY walidator
// i PRAWDZIWY handler.
import { beforeEach, describe, expect, it, vi } from "vitest";

const { assertAdmin, resendTicketOutcome, order } = vi.hoisted(() => ({
  assertAdmin: vi.fn(),
  resendTicketOutcome: vi.fn(),
  order: [] as string[],
}));

vi.mock("@tanstack/react-start", () => ({
  createServerFn: () => {
    let validate: ((data: unknown) => unknown) | undefined;
    const api = {
      middleware: () => api,
      inputValidator: (fn: (data: unknown) => unknown) => {
        validate = fn;
        return api;
      },
      handler: (fn: unknown) => Object.assign(fn as object, { validate }),
    };
    return api;
  },
}));

vi.mock("@/integrations/supabase/auth-middleware", () => ({ requireSupabaseAuth: {} }));

vi.mock("@/lib/billing/diagnostics.server", () => ({ assertAdmin }));

vi.mock("@/lib/events/outcomeResend.server", () => ({ resendTicketOutcome }));

const { resendRegistrationNotifications } = await import("@/lib/events/outcomeResend.functions");

type Callable = (input: {
  data: { registrationId: string };
  context: { supabase: unknown; userId: string };
}) => Promise<unknown>;
type WithValidator = { validate: (data: unknown) => unknown };

const resend = resendRegistrationNotifications as unknown as Callable;
const validator = resendRegistrationNotifications as unknown as WithValidator;

const REG = "11111111-1111-4111-8111-111111111111";
const USER = "22222222-2222-4222-8222-222222222222";
const RESULT = {
  registrationId: REG,
  outcome: "paid",
  emailed: true,
  smsSent: false,
  promotedNotified: 0,
};

const supabase = { rpc: vi.fn() };

beforeEach(() => {
  order.length = 0;
  assertAdmin.mockReset();
  assertAdmin.mockImplementation(async () => {
    order.push("assertAdmin");
  });
  resendTicketOutcome.mockReset();
  resendTicketOutcome.mockImplementation(async () => {
    order.push("resend");
    return RESULT;
  });
});

describe("walidator identyfikatora zgłoszenia", () => {
  it("przepuszcza poprawny UUID i nic poza nim nie zwraca", () => {
    expect(validator.validate({ registrationId: REG })).toEqual({ registrationId: REG });
  });

  it("odrzuca tekst, który nie jest UUID", () => {
    expect(() => validator.validate({ registrationId: "1 OR 1=1" })).toThrow();
    expect(() => validator.validate({ registrationId: "" })).toThrow();
    expect(() => validator.validate({ registrationId: REG.slice(0, 35) })).toThrow();
  });

  it("odrzuca wartość, która nie jest tekstem, oraz brak wejścia", () => {
    // `POST` przyjmuje JSON, więc pole bywa liczbą, tablicą albo obiektem.
    expect(() => validator.validate({ registrationId: 42 })).toThrow();
    expect(() => validator.validate({ registrationId: null })).toThrow();
    expect(() => validator.validate({ registrationId: [REG] })).toThrow();
    expect(() => validator.validate({})).toThrow();
    expect(() => validator.validate(null)).toThrow();
  });
});

describe("bramka roli - sam login nie wystarcza", () => {
  it("sprawdza rolę klientem WOŁAJĄCEGO i jego identyfikatorem", async () => {
    // `has_role` musi zapytać o tego, kto klika - nie o kogokolwiek innego.
    await resend({ data: { registrationId: REG }, context: { supabase, userId: USER } });
    expect(assertAdmin).toHaveBeenCalledWith(supabase, USER);
  });

  it("sprawdza rolę PRZED odczytem i wysyłką", async () => {
    await resend({ data: { registrationId: REG }, context: { supabase, userId: USER } });
    expect(order).toEqual(["assertAdmin", "resend"]);
  });

  it("odmowa roli przerywa całą operację - żaden mail nie wychodzi", async () => {
    assertAdmin.mockRejectedValue(new Error("forbidden"));
    await expect(
      resend({ data: { registrationId: REG }, context: { supabase, userId: USER } }),
    ).rejects.toThrow("forbidden");
    expect(resendTicketOutcome).not.toHaveBeenCalled();
  });
});

describe("przekazanie do warstwy logiki", () => {
  it("podaje dalej WYŁĄCZNIE identyfikator zgłoszenia", async () => {
    // Adresat, treść i kwota mają pochodzić z bazy - gdyby handler przekazywał
    // cały `data`, dopisanie pola w ciele żądania sterowałoby wysyłką.
    await resend({ data: { registrationId: REG }, context: { supabase, userId: USER } });
    expect(resendTicketOutcome.mock.calls).toEqual([[REG]]);
  });

  it("oddaje wynik warstwy logiki bez zmian", async () => {
    const result = await resend({
      data: { registrationId: REG },
      context: { supabase, userId: USER },
    });
    expect(result).toBe(RESULT);
  });

  it("nie tłumi błędu warstwy logiki na własny wynik", async () => {
    // Panel musi zobaczyć „Zgłoszenie nie istnieje.", a nie ciche `ok`.
    resendTicketOutcome.mockRejectedValue(new Error("Zgłoszenie nie istnieje."));
    await expect(
      resend({ data: { registrationId: REG }, context: { supabase, userId: USER } }),
    ).rejects.toThrow("Zgłoszenie nie istnieje.");
  });
});
