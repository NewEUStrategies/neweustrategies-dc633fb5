// Server functions wydarzeń: bilet, dostępność miejsc i mail po bezpłatnym RSVP.
//
// Trzy pliki-deklaracje (`ticket.functions.ts`, `rsvp-email.functions.ts`) stały
// na zerze, bo repo trzyma w nich WYŁĄCZNIE deklarację server function - logika
// mieszka obok. Tyle że deklaracja niesie dwie rzeczy, których nie ma nigdzie
// indziej i których żaden test warstwy logiki nie dotknie:
//
//   1. WALIDATOR WEJŚCIA. To jedyna bariera między publicznym `POST` a
//      zapytaniem do bazy. Rozluźnienie go (albo usunięcie przy refaktorze)
//      przepuszcza dowolny tekst tam, gdzie kolumna jest `uuid`.
//   2. GRANICA UPRAWNIEŃ. `getMyEventTicket` idzie przez `requireSupabaseAuth`
//      i czyta klientem WOŁAJĄCEGO (RLS widzi jego `auth.uid()`), a
//      `getEventSeatState` jest świadomie publiczny - licznik miejsc musi
//      działać dla gościa przed zalogowaniem. Przepięcie jednego w drugie
//      albo wystawia cudzy bilet, albo psuje stronę wydarzenia dla gości.
//
// PUŁAPKA HARNESSU: `createServerFn` buduje łańcuch `.middleware().inputValidator().handler()`.
// Atrapa oddaje z `.handler(fn)` samą funkcję z doklejonym `validate`, więc test
// wywołuje PRAWDZIWY walidator i PRAWDZIWY handler, a nie własną imitację.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ok, fail, supabaseFromStub } from "@/test/supabaseChain";

const spies = vi.hoisted(() => ({
  loadMyEventTicket: vi.fn(async () => ({ ticket: "bilet" })),
  loadEventSeatState: vi.fn(async () => ({ seatsLeft: 3 })),
  notifyEventRegistration: vi.fn(async () => undefined),
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

vi.mock("@/lib/events/ticket.server", () => ({
  loadMyEventTicket: spies.loadMyEventTicket,
  loadEventSeatState: spies.loadEventSeatState,
}));

vi.mock("@/lib/billing/notifications.server", () => ({
  notifyEventRegistration: spies.notifyEventRegistration,
}));

const { getEventSeatState, getMyEventTicket } = await import("@/lib/events/ticket.functions");
const { confirmFreeRsvpEmail } = await import("@/lib/events/rsvp-email.functions");

type WithValidator = { validate: (data: unknown) => { eventId: string } };
type Callable = (input: { data: { eventId: string }; context?: unknown }) => Promise<unknown>;

const EVENT = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const USER = "11111111-1111-4111-8111-111111111111";

let db: ReturnType<typeof supabaseFromStub>;
const client = () => ({ from: db.from });

beforeEach(() => {
  db = supabaseFromStub();
  spies.loadMyEventTicket.mockClear();
  spies.loadEventSeatState.mockClear();
  spies.notifyEventRegistration.mockClear();
});

describe("walidator identyfikatora wydarzenia", () => {
  const validators: [string, WithValidator][] = [
    ["getMyEventTicket", getMyEventTicket as unknown as WithValidator],
    ["getEventSeatState", getEventSeatState as unknown as WithValidator],
    ["confirmFreeRsvpEmail", confirmFreeRsvpEmail as unknown as WithValidator],
  ];

  it.each(validators)("%s przepuszcza poprawny UUID", (_name, fn) => {
    expect(fn.validate({ eventId: EVENT })).toEqual({ eventId: EVENT });
  });

  it.each(validators)("%s przycina białe znaki wokół identyfikatora", (_name, fn) => {
    // Identyfikator bywa wklejany z panelu razem ze spacją albo nową linią.
    expect(fn.validate({ eventId: `  ${EVENT}\n` })).toEqual({ eventId: EVENT });
  });

  it.each(validators)("%s odrzuca wartość, która nie jest UUID", (_name, fn) => {
    expect(() => fn.validate({ eventId: "1 OR 1=1" })).toThrow("invalid_event_id");
    expect(() => fn.validate({ eventId: "" })).toThrow("invalid_event_id");
  });

  it.each(validators)("%s odrzuca wartość, która nie jest tekstem", (_name, fn) => {
    // `POST` przyjmuje JSON, więc `eventId` bywa liczbą, tablicą albo obiektem
    // - `typeof` jest tu jedyną barierą przed `.trim()` na czymś innym.
    expect(() => fn.validate({ eventId: 42 })).toThrow("invalid_event_id");
    expect(() => fn.validate({ eventId: null })).toThrow("invalid_event_id");
    expect(() => fn.validate({})).toThrow("invalid_event_id");
    expect(() => fn.validate(null)).toThrow("invalid_event_id");
  });

  it.each(validators)("%s przyjmuje UUID zapisany WIELKIMI literami", (_name, fn) => {
    // Kolumna `uuid` w Postgresie jest niewrażliwa na wielkość liter, więc
    // odrzucenie takiego wejścia byłoby błędem po naszej stronie.
    const upper = EVENT.toUpperCase();
    expect(fn.validate({ eventId: upper })).toEqual({ eventId: upper });
  });
});

describe("getMyEventTicket - bilet WŁAŚCICIELA", () => {
  it("czyta klientem wołającego, a nie kluczem serwisowym", async () => {
    // Klient z kontekstu niesie `auth.uid()` wołającego, więc RLS pilnuje
    // właścicielstwa. Zamiana na klienta serwisowego wystawiłaby cudzy bilet
    // każdemu, kto zgadnie identyfikator wydarzenia.
    const supabase = client();
    await (getMyEventTicket as unknown as Callable)({
      data: { eventId: EVENT },
      context: { supabase, userId: USER },
    });
    expect(spies.loadMyEventTicket).toHaveBeenCalledWith(supabase, USER, EVENT);
  });

  it("oddaje wynik warstwy logiki bez przetwarzania", async () => {
    const result = await (getMyEventTicket as unknown as Callable)({
      data: { eventId: EVENT },
      context: { supabase: client(), userId: USER },
    });
    expect(result).toEqual({ ticket: "bilet" });
  });
});

describe("getEventSeatState - licznik miejsc jest PUBLICZNY", () => {
  it("nie potrzebuje kontekstu użytkownika", async () => {
    // Strona wydarzenia pokazuje „zostało N miejsc" przed zalogowaniem;
    // wymóg sesji zamieniłby to w pustą ramkę dla gościa.
    const result = await (getEventSeatState as unknown as Callable)({ data: { eventId: EVENT } });
    expect(spies.loadEventSeatState).toHaveBeenCalledWith(EVENT);
    expect(result).toEqual({ seatsLeft: 3 });
  });
});

describe("confirmFreeRsvpEmail - potwierdzenie bezpłatnego zapisu", () => {
  const run = (context = { supabase: client(), userId: USER }) =>
    (confirmFreeRsvpEmail as unknown as Callable)({ data: { eventId: EVENT }, context });

  it("szuka WYŁĄCZNIE własnego wiersza zapisu", async () => {
    db.setResponse("event_rsvps", ok({ id: "r1", status: "going" }));
    await run();
    const chain = db.lastChain("event_rsvps")!;
    expect(chain.calls.filter((c) => c.method === "eq").map((c) => c.args)).toEqual([
      ["event_id", EVENT],
      ["user_id", USER],
    ]);
  });

  it("wysyła mail, gdy zapis naprawdę ma status „idę”", async () => {
    db.setResponse("event_rsvps", ok({ id: "r1", status: "going" }));
    await expect(run()).resolves.toEqual({ sent: true });
    expect(spies.notifyEventRegistration).toHaveBeenCalledWith({
      userId: USER,
      eventId: EVENT,
      ticketSeed: "r1",
      idempotencySeed: "rsvp:r1",
    });
  });

  it("klucz idempotencji jest po WIERSZU zapisu, nie po użytkowniku", async () => {
    // Dzięki temu „idę" -> „nie idę" -> „idę" nie zasypuje skrzynki kopiami
    // tego samego potwierdzenia, a nowy zapis (nowy wiersz) mail dostaje.
    db.setResponse("event_rsvps", ok({ id: "r2", status: "going" }));
    await run();
    const [payload] = spies.notifyEventRegistration.mock.calls.at(-1) as unknown as [
      { idempotencySeed: string; ticketSeed: string },
    ];
    expect(payload.idempotencySeed).toBe("rsvp:r2");
    expect(payload.ticketSeed).toBe("r2");
  });

  it("status INNY niż „idę” NIE wysyła nic", async () => {
    // „Zainteresowany" to nie zapis; mail z biletem byłby obietnicą miejsca,
    // którego ta osoba nie ma.
    db.setResponse("event_rsvps", ok({ id: "r1", status: "interested" }));
    await expect(run()).resolves.toEqual({ sent: false });
    expect(spies.notifyEventRegistration).not.toHaveBeenCalled();
  });

  it("brak wiersza NIE wysyła nic - klient nie wymusi maila dla cudzego zapisu", async () => {
    db.setResponse("event_rsvps", ok(null));
    await expect(run()).resolves.toEqual({ sent: false });
    expect(spies.notifyEventRegistration).not.toHaveBeenCalled();
  });

  it("błąd odczytu leci wyżej, zamiast udawać brak zapisu", async () => {
    // Cichy `sent: false` przy awarii bazy znaczyłby dla użytkownika „nie
    // masz zapisu", choć zapis jest.
    db.setResponse("event_rsvps", fail("permission denied", "42501"));
    await expect(run()).rejects.toThrow("permission denied");
    expect(spies.notifyEventRegistration).not.toHaveBeenCalled();
  });
});
