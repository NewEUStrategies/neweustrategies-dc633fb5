// POWIADOMIENIA O WYNIKU PŁATNOŚCI ZA BILET - ŚCIEŻKA WEBHOOKA.
//
// PO CO TEN PLIK. `registrationOutcomeNotify.server` był dotąd mierzony na
// 8,5% linii i 1 funkcji z 12, mimo że jest JEDYNĄ drogą, którą uczestnik
// dowiaduje się, że jego bilet został opłacony albo zwrócony. Przyczyna zera
// jest konkretna: jedyny test, który ten moduł wymieniał
// (`outcomeResend.test.ts`), PODMIENIAŁ go na atrapę - czyli dowodził swojego
// wołającego, a nie jego. Tutaj moduł biegnie PRAWDZIWY, a atrapowane są
// wyłącznie granice systemu: klient service_role, dostawca poczty, brama SMS
// i odczyt preferencji językowych z profilu.
//
// CO TU JEST STAWKĄ, po kolei:
//
//   1. IDEMPOTENCJA. Operator płatności ponawia webhooka po każdym timeoucie.
//      Klucz maila musi być funkcją SAMEGO ZDARZENIA (zgłoszenie + wynik +
//      kwota zwrotu), więc nie może nieść znacznika czasu - inaczej każda
//      powtórka to nowy mail. Odwrotny wymóg ma przycisk „wyślij ponownie"
//      w panelu: on MUSI ominąć bramkę, bo inaczej nie robi nic.
//   2. WYNIK `unpaid` NIE MA SZABLONU, a kolejka rezerwowa rusza PRZED
//      sprawdzeniem szablonu. To nie jest szczegół implementacyjny: decyduje,
//      kto dostanie wiadomość, gdy karta nie przeszła.
//   3. PREFERENCJE KANAŁÓW są PER ZGŁOSZENIE i mają semantykę opt-out
//      (NULL znaczy „wysyłaj"), a błąd bazy nie może wyciszyć wiadomości
//      o pieniądzach.
//   4. SMS-Y SĄ BEZ OGONKÓW CELOWO. Jeden znak poza GSM-7 przełącza całą
//      wiadomość na UCS-2, połowi długość segmentu i podwaja koszt wysyłki.
//   5. FAIL-SOFT CAŁOŚCI. Pieniądze i miejsce są już zaksięgowane; wyjątek
//      z bramy poczty czy SMS skazywałby webhooka na wieczne ponowienia,
//      czyli na wysyłanie tego samego maila w kółko.
//
// RODO: uczestnicy syntetyczni, adresy wyłącznie w `example.com` /
// `example.org`, numery telefonów zmyślone i nigdy nie wybierane (brama SMS
// jest atrapą). Żaden test nie wychodzi do sieci.
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";

import type { TxSendInput, TxSendResult } from "@/lib/email/transactional.server";
import type { SmsInput, SmsResult } from "@/lib/notify/sms.server";
import { fail, ok, supabaseFromStub, type SupabaseFromStub } from "@/test/supabaseChain";

// --- granice atrapowane -----------------------------------------------------

/**
 * Klient service_role. `breakTable` symuluje AWARIĘ KLIENTA (rzut), a nie
 * odpowiedź z błędem PostgREST - to dwie różne gałęzie fail-soft w module
 * i tylko jedna z nich wchodzi do `catch`.
 */
const db = vi.hoisted(() => {
  const state: {
    stub: { from: (table: string) => unknown } | null;
    throwing: Set<string>;
  } = { stub: null, throwing: new Set<string>() };
  return {
    use(next: { from: (table: string) => unknown }): void {
      state.stub = next;
    },
    breakTable(table: string): void {
      state.throwing.add(table);
    },
    reset(): void {
      state.stub = null;
      state.throwing.clear();
    },
    from(table: string): unknown {
      if (state.throwing.has(table)) {
        throw new Error(`test: klient Supabase padł na tabeli "${table}"`);
      }
      if (!state.stub) throw new Error(`test: brak zaplanowanej atrapy Supabase dla "${table}"`);
      return state.stub.from(table);
    },
  };
});

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: { from: (table: string) => db.from(table) },
}));

/**
 * Dostawca poczty Z DZIAŁAJĄCĄ BRAMKĄ DUPLIKATÓW - i to jest sedno atrapy.
 * Produkcyjny `sendTxEmail` odrzuca powtórzony `idempotencyKey`, zwracając
 * `skipped: "duplicate"`. Atrapa bez tej pamięci przepuszczałaby każdą
 * powtórkę, więc test idempotencji „przechodziłby" niezależnie od tego, czy
 * moduł buduje klucz sensownie.
 *
 * `attempts` to WSZYSTKIE próby (także odrzucone przez bramkę), `delivered` to
 * wiadomości, które realnie poszłyby w świat.
 */
const mail = vi.hoisted(() => {
  const attempts: TxSendInput[] = [];
  const delivered: TxSendInput[] = [];
  const seen = new Set<string>();
  const brokenTypes = new Set<string>();
  let brokenAll: Error | null = null;
  const sendTxEmail = vi.fn(async (input: TxSendInput): Promise<TxSendResult> => {
    if (brokenAll) throw brokenAll;
    if (brokenTypes.has(input.type)) throw new Error(`test: brama poczty padła na ${input.type}`);
    attempts.push(input);
    if (seen.has(input.idempotencyKey)) return { ok: true, skipped: "duplicate" };
    seen.add(input.idempotencyKey);
    delivered.push(input);
    return { ok: true };
  });
  return {
    sendTxEmail,
    attempts,
    delivered,
    breakProvider(error: Error): void {
      brokenAll = error;
    },
    breakType(type: string): void {
      brokenTypes.add(type);
    },
    reset(): void {
      attempts.length = 0;
      delivered.length = 0;
      seen.clear();
      brokenTypes.clear();
      brokenAll = null;
      sendTxEmail.mockClear();
    },
  };
});

vi.mock("@/lib/email/transactional.server", () => ({ sendTxEmail: mail.sendTxEmail }));

/** Brama SMS. Produkcyjnie NIE rzuca - `breakGateway` sprawdza właśnie to założenie. */
const sms = vi.hoisted(() => {
  const sent: SmsInput[] = [];
  let broken: Error | null = null;
  const sendSms = vi.fn(async (input: SmsInput): Promise<SmsResult> => {
    if (broken) throw broken;
    sent.push(input);
    return { ok: true };
  });
  return {
    sendSms,
    sent,
    breakGateway(error: Error): void {
      broken = error;
    },
    reset(): void {
      sent.length = 0;
      broken = null;
      sendSms.mockClear();
    },
  };
});

vi.mock("@/lib/notify/sms.server", () => ({ sendSms: sms.sendSms }));

/** Preferencja językowa z profilu. Brak wpisu = konto bez preferencji. */
const people = vi.hoisted(() => {
  const langByUser = new Map<string, "pl" | "en">();
  let broken: Error | null = null;
  const resolveRecipient = vi.fn(
    async (
      _client: unknown,
      userId: string,
    ): Promise<{ email: string; lang: "pl" | "en"; name: string | null } | null> => {
      if (broken) throw broken;
      const lang = langByUser.get(userId);
      return lang ? { email: `${userId}@example.org`, lang, name: null } : null;
    },
  );
  return {
    resolveRecipient,
    langByUser,
    breakProfiles(error: Error): void {
      broken = error;
    },
    reset(): void {
      langByUser.clear();
      broken = null;
      resolveRecipient.mockClear();
    },
  };
});

vi.mock("@/lib/billing/notifications.server", () => ({
  resolveRecipient: people.resolveRecipient,
}));

import {
  notifyTicketOutcome,
  type TicketOutcomePayload,
} from "@/lib/events/registrationOutcomeNotify.server";

// --- dane wejściowe ---------------------------------------------------------

const TENANT = "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa";
const EVENT = "bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb";
const REG = "cccccccc-3333-4333-8333-cccccccccccc";
const REG_PROMOTED = "dddddddd-4444-4444-8444-dddddddddddd";
const USER = "eeeeeeee-5555-4555-8555-eeeeeeeeeeee";
const USER_PROMOTED = "ffffffff-6666-4666-8666-ffffffffffff";

const TITLE_PL = "Kongres Gospodarczy";
const TITLE_EN = "Economic Congress";

function payload(over: Partial<TicketOutcomePayload> = {}): TicketOutcomePayload {
  return {
    applied: true,
    registration_id: REG,
    outcome: "paid",
    amount_cents: 24_900,
    refunded_cents: 0,
    currency: "PLN",
    tenant_id: TENANT,
    event_id: EVENT,
    event_slug: "kongres-gospodarczy-2026",
    event_title_pl: TITLE_PL,
    event_title_en: TITLE_EN,
    contact: {
      user_id: USER,
      email: "uczestnik@example.com",
      phone: "+48500100200",
      first_name: "Halina",
    },
    waitlist: null,
    ...over,
  };
}

function promotedRow(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    registration_id: REG_PROMOTED,
    user_id: USER_PROMOTED,
    email: "rezerwa@example.com",
    phone: "+48500100201",
    first_name: "Bogumil",
    ...over,
  };
}

/** Wiersz `event_registrations` w kształcie, jaki czyta `readChannels`. */
interface ChannelRow {
  notify_email: boolean | null;
  notify_sms: boolean | null;
}

const channelRows = new Map<string, ChannelRow>();

let stub: SupabaseFromStub;
let errorSpy: MockInstance<typeof console.error>;

function givenDb(): SupabaseFromStub {
  const next = supabaseFromStub();
  // Preferencje są czytane PO IDENTYFIKATORZE ZGŁOSZENIA, więc atrapa też musi
  // rozróżniać wiersze - inaczej test asymetrii kanałów (płacący vs awansowany)
  // nie miałby czego pokazać.
  next.setResponse("event_registrations", (chain) => {
    const args = chain.argsOf("eq");
    const id = typeof args?.[1] === "string" ? args[1] : "";
    return ok(channelRows.get(id) ?? null);
  });
  next.setResponse("notifications", ok(null));
  db.use(next);
  return next;
}

function attemptsOfType(type: string): TxSendInput[] {
  return mail.attempts.filter((entry) => entry.type === type);
}

function deliveredOfType(type: string): TxSendInput[] {
  return mail.delivered.filter((entry) => entry.type === type);
}

function detailValue(input: TxSendInput, label: string): string | undefined {
  return (input.details ?? []).find((detail) => detail.label === label)?.value;
}

function bellRow(): Record<string, unknown> | undefined {
  const args = stub.lastChain("notifications")?.argsOf("insert");
  const row = args?.[0];
  return typeof row === "object" && row !== null ? (row as Record<string, unknown>) : undefined;
}

beforeEach(() => {
  db.reset();
  mail.reset();
  sms.reset();
  people.reset();
  channelRows.clear();
  stub = givenDb();
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  errorSpy.mockRestore();
});

// --- 1. idempotencja przy ponowieniu webhooka -------------------------------

describe("idempotencja wobec ponowionego webhooka", () => {
  it("ten sam ładunek dostarczony dwa razy wysyła uczestnikowi jeden mail", async () => {
    // Operator ponawia webhooka po każdym timeoucie. Drugi przebieg nie ma
    // prawa dołożyć drugiego maila „bilet opłacony" - stąd klucz zbudowany
    // z samego zdarzenia, a nie z chwili wysyłki.
    const first = await notifyTicketOutcome(payload());
    const second = await notifyTicketOutcome(payload());

    expect(first.emailed).toBe(true);
    expect(second.emailed).toBe(false);
    expect(deliveredOfType("event_ticket_paid")).toHaveLength(1);
    expect(attemptsOfType("event_ticket_paid")).toHaveLength(2);
    const [a, b] = attemptsOfType("event_ticket_paid");
    expect(a?.idempotencyKey).toBe(b?.idempotencyKey);
  });

  it("klucz niesie identyfikator zgłoszenia i wynik, ale ŻADNEGO znacznika czasu", async () => {
    await notifyTicketOutcome(payload({ outcome: "partial_refund", refunded_cents: 5_000 }));

    const key = attemptsOfType("event_ticket_partially_refunded")[0]?.idempotencyKey ?? "";
    expect(key).toContain(REG);
    expect(key).toContain("partial_refund");
    // Identyfikator zgłoszenia sam składa się z cyfr, więc szukamy znacznika
    // czasu w tym, co ZOSTAJE po jego usunięciu: sekundy/milisekundy epoki
    // (10+ cyfr) albo data ISO. Jedno i drugie zamieniłoby bramkę duplikatów
    // w generator nowych maili przy każdym ponowieniu.
    const withoutIds = key.replace(REG, "<zgloszenie>");
    expect(withoutIds).not.toMatch(/\d{10,}/);
    expect(withoutIds).not.toMatch(/\d{4}-\d{2}-\d{2}/);
  });

  it("dopisek z panelu omija bramkę duplikatów, bo inaczej przycisk nic nie robi", async () => {
    await notifyTicketOutcome(payload());
    const resend = await notifyTicketOutcome(payload(), {
      idempotencySuffix: "resend:1756900000000",
    });

    expect(resend.emailed).toBe(true);
    expect(deliveredOfType("event_ticket_paid")).toHaveLength(2);
    const keys = attemptsOfType("event_ticket_paid").map((entry) => entry.idempotencyKey);
    expect(keys[1]).toBe(`${keys[0]}:resend:1756900000000`);
  });

  it("kolejna korekta zwrotu to NOWA informacja, więc mail idzie ponownie", async () => {
    // Ta sama rejestracja, ten sam wynik, inna kwota zwrócona narastająco.
    // Gdyby kwota nie wchodziła do klucza, uczestnik nie dowiedziałby się
    // o drugiej transzy zwrotu.
    await notifyTicketOutcome(payload({ outcome: "partial_refund", refunded_cents: 5_000 }));
    const secondTranche = await notifyTicketOutcome(
      payload({ outcome: "partial_refund", refunded_cents: 12_000 }),
    );

    expect(secondTranche.emailed).toBe(true);
    expect(deliveredOfType("event_ticket_partially_refunded")).toHaveLength(2);
  });

  it("awans z rezerwy jest jednorazowy per zgłoszenie także przy ponowieniu", async () => {
    const waitlisted = payload({
      outcome: "refunded",
      refunded_cents: 24_900,
      waitlist: { promoted: 1, registrations: [promotedRow()] },
    });

    const first = await notifyTicketOutcome(waitlisted);
    const second = await notifyTicketOutcome(waitlisted);

    expect(first.promotedNotified).toBe(1);
    // Drugi przebieg widzi bramkę duplikatów i NIE liczy awansu ponownie -
    // liczba w wyniku ma odpowiadać realnie wysłanym wiadomościom.
    expect(second.promotedNotified).toBe(0);
    expect(deliveredOfType("event_waitlist_promoted")).toHaveLength(1);

    const key = attemptsOfType("event_waitlist_promoted")[0]?.idempotencyKey ?? "";
    expect(key).toBe(`event-ticket-promoted:${REG_PROMOTED}`);
    expect(key.replace(REG_PROMOTED, "<zgloszenie>")).not.toMatch(/\d{10,}/);
  });

  it.fails(
    "DEFEKT: ponowiony webhook wysyła DRUGI SMS - kanał SMS nie ma klucza idempotencji",
    async () => {
      // `NotifyOptions` opisuje kontrakt wprost: „webhook nadal nie może wysłać
      // tej samej wiadomości dwa razy". Dla poczty pilnuje tego
      // `idempotencyKey`, ale `sendSms` (`lib/notify/sms.server`) nie przyjmuje
      // żadnego klucza, a `notifyTicketOutcome` (:312-319) woła go bezwarunkowo.
      // Skutek: każde ponowienie webhooka przez operatora płatności to kolejny
      // SMS do tej samej osoby, bez żadnej bariery - i bez śladu w
      // `email_send_log`, bo SMS-y w nim nie siedzą.
      await notifyTicketOutcome(payload());
      await notifyTicketOutcome(payload());

      expect(sms.sent).toHaveLength(1);
    },
  );
});

// --- 2. wynik `unpaid` i warunek `applied` ----------------------------------

describe("wynik bez szablonu i zgłoszenie bez zapisu", () => {
  it("`applied: false` blokuje WSZYSTKO, także kolejkę rezerwową", async () => {
    // Baza nie przeniosła wyniku na zgłoszenie, więc nie ma o czym pisać:
    // mail o zwolnionym miejscu byłby informacją nieprawdziwą.
    const result = await notifyTicketOutcome(
      payload({
        applied: false,
        outcome: "refunded",
        waitlist: { promoted: 1, registrations: [promotedRow()] },
      }),
    );

    expect(result).toEqual({ emailed: false, smsSent: false, promotedNotified: 0 });
    expect(mail.attempts).toHaveLength(0);
    expect(sms.sent).toHaveLength(0);
    expect(stub.chainsFor("notifications")).toHaveLength(0);
  });

  it("brak pola `applied` traktujemy jak brak zapisu", async () => {
    const result = await notifyTicketOutcome({ registration_id: REG, outcome: "paid" });

    expect(result.emailed).toBe(false);
    expect(mail.attempts).toHaveLength(0);
  });

  it("`unpaid` nie ma szablonu: płacący milczy, ale awansowani dostają swoje", async () => {
    // `TYPE_BY_OUTCOME` (:27-31) nie ma wpisu dla `unpaid`, choć `unpaid` jest
    // zadeklarowanym `TicketOutcome` (:25). Kolejka rezerwowa rusza PRZED tym
    // sprawdzeniem (:279 vs :284), więc zwolnione miejsce trafia do ludzi
    // niezależnie od tego, że sam płacący nie dostanie ani maila, ani SMS-a,
    // ani dzwonka.
    const result = await notifyTicketOutcome(
      payload({
        outcome: "unpaid",
        waitlist: { promoted: 1, registrations: [promotedRow()] },
      }),
    );

    expect(result).toEqual({ emailed: false, smsSent: false, promotedNotified: 1 });
    expect(attemptsOfType("event_waitlist_promoted")).toHaveLength(1);
    expect(mail.attempts.map((entry) => entry.to)).not.toContain("uczestnik@example.com");
    expect(sms.sent.map((entry) => entry.to)).not.toContain("+48500100200");
    expect(stub.chainsFor("notifications")).toHaveLength(0);
  });

  it("zgłoszenie bez identyfikatora nie blokuje kolejki rezerwowej", async () => {
    // Pełny zwrot zwalnia miejsce nawet wtedy, gdy sam zwracający nie ma już
    // wiersza zgłoszenia - to jest sens kolejności z :277-278.
    const result = await notifyTicketOutcome(
      payload({
        registration_id: undefined,
        outcome: "refunded",
        refunded_cents: 24_900,
        waitlist: { promoted: 1, registrations: [promotedRow()] },
      }),
    );

    expect(result.promotedNotified).toBe(1);
    expect(result.emailed).toBe(false);
    expect(attemptsOfType("event_ticket_refunded")).toHaveLength(0);
  });

  it.fails(
    "DEFEKT: odrzucona płatność nie dociera do uczestnika żadnym kanałem",
    async () => {
      // `unpaid` powstaje w `markOneTimePaymentFailed`
      // (`lib/billing/oneTimeFulfilment.server.ts`:169), gdy karta nie
      // przeszła. Zgłoszenie zostaje w bazie jako nieopłacone, ale uczestnik
      // nie dowiaduje się o tym NICZYM - a katalog szablonów ma gotowy
      // `payment_failed`. Człowiek jedzie na wydarzenie w przekonaniu, że ma
      // opłacone miejsce, i dowiaduje się przy rejestracji na miejscu.
      // Osobno: ta sama luka zamienia panelowy przycisk „wyślij ponownie"
      // w cichy brak reakcji, bo `resendTicketOutcome` odtwarza `unpaid`
      // dla każdego zgłoszenia bez zapłaty (`outcomeResend.server.ts`:40).
      const result = await notifyTicketOutcome(payload({ outcome: "unpaid" }));

      expect(result.emailed).toBe(true);
    },
  );
});

// --- 3. preferencje kanałów: semantyka opt-out i asymetria -------------------

describe("preferencje kanałów zapisane na zgłoszeniu", () => {
  it("czyta preferencje po kluczu zgłoszenia, którym rozstrzygnęła baza", async () => {
    await notifyTicketOutcome(payload());

    // Zawężenie idzie po kluczu głównym, a ten identyfikator przychodzi
    // z wyniku RPC `payments_apply_event_ticket_outcome` - czyli jest już
    // rozstrzygnięty przez najemcę w SQL (pilnuje tego bramka
    // `check:sql-tenant-scope`). Ten odczyt biegnie na service_role, więc
    // brak filtra `id` oznaczałby czytanie cudzych preferencji.
    expect(stub.lastChain("event_registrations")?.argsOf("eq")).toEqual(["id", REG]);
    expect(stub.lastChain("event_registrations")?.argsOf("select")).toEqual([
      "notify_email, notify_sms",
    ]);
  });

  it("NULL znaczy „wysyłaj”: zgłoszenie bez decyzji dostaje oba kanały", async () => {
    // Semantyka jest opt-out (`notify_email !== false`), bo formularz zapisu
    // nie wymusza decyzji, a powiadomienie o pieniądzach musi dojść domyślnie.
    channelRows.set(REG, { notify_email: null, notify_sms: null });
    const result = await notifyTicketOutcome(payload());

    expect(result.emailed).toBe(true);
    expect(result.smsSent).toBe(true);
  });

  it("brak wiersza preferencji też znaczy „wysyłaj”", async () => {
    const result = await notifyTicketOutcome(payload());

    expect(result.emailed).toBe(true);
    expect(result.smsSent).toBe(true);
  });

  it("wypisanie się z poczty wycisza mail, ale NIE SMS-a", async () => {
    channelRows.set(REG, { notify_email: false, notify_sms: true });
    const result = await notifyTicketOutcome(payload());

    expect(result.emailed).toBe(false);
    expect(mail.attempts).toHaveLength(0);
    expect(result.smsSent).toBe(true);
    expect(sms.sent).toHaveLength(1);
  });

  it("wypisanie się z SMS-ów wycisza SMS, ale NIE mail", async () => {
    channelRows.set(REG, { notify_email: true, notify_sms: false });
    const result = await notifyTicketOutcome(payload());

    expect(result.emailed).toBe(true);
    expect(result.smsSent).toBe(false);
    expect(sms.sent).toHaveLength(0);
  });

  it("błąd odczytu preferencji otwiera OBA kanały, a nie zamyka", async () => {
    // Awaria bazy nie może wyciszyć wiadomości o pieniądzach - cisza jest tu
    // gorsza niż wiadomość wysłana wbrew wypisaniu.
    stub.setResponse("event_registrations", fail("bramka preferencji odmówiła"));
    const result = await notifyTicketOutcome(payload());

    expect(result.emailed).toBe(true);
    expect(result.smsSent).toBe(true);
  });

  it("rzut klienta Supabase przy odczycie preferencji też otwiera oba kanały", async () => {
    db.breakTable("event_registrations");
    const result = await notifyTicketOutcome(payload());

    expect(result.emailed).toBe(true);
    expect(result.smsSent).toBe(true);
    expect(errorSpy.mock.calls.map((call) => String(call[0]))).toContain(
      "[events] channel preferences read failed",
    );
  });

  it.fails(
    "DEFEKT: awansowani dostają mail i SMS wbrew preferencjom zapisanym na ICH zgłoszeniu",
    async () => {
      // `notifyPromoted` (:175-212) nie woła `readChannels` ani razu, choć
      // każdy awansowany wiersz niesie własny `registration_id` (:183) - czyli
      // dokładnie ten klucz, którym moduł czyta preferencje płacącego.
      //
      // ROZSTRZYGNIĘCIE: to jest defekt, nie świadomy wyjątek dla
      // „czasowo krytycznego" awansu. Argument z pilności nie broni się,
      // bo ŚCIEŻKA PIENIĘŻNA - zwrot płatności, sprawa co najmniej równie
      // pilna - preferencje respektuje (:290, :312). Skutek: uczestnik, który
      // na tym konkretnym zgłoszeniu wyłączył SMS-y, dostaje SMS-a, a moduł
      // ma pod ręką wszystko, czego trzeba, żeby tego nie robić. Dokumentacja
      // `readChannels` (:226-231) nazywa preferencje kontraktem PER
      // ZGŁOSZENIE bez żadnego wyjątku dla listy rezerwowej.
      channelRows.set(REG_PROMOTED, { notify_email: false, notify_sms: false });
      await notifyTicketOutcome(
        payload({
          outcome: "refunded",
          refunded_cents: 24_900,
          waitlist: { promoted: 1, registrations: [promotedRow()] },
        }),
      );

      expect(attemptsOfType("event_waitlist_promoted")).toHaveLength(0);
      expect(sms.sent.map((entry) => entry.to)).not.toContain("+48500100201");
    },
  );
});

// --- 4. treść SMS-a mieści się w GSM-7 --------------------------------------

describe("treść SMS-a nie wychodzi z GSM-7", () => {
  /** Polskie ogonki - pierwszy powód przełączenia wiadomości na UCS-2. */
  const OGONKI = /[ąćęłńóśźżĄĆĘŁŃÓŚŹŻ]/;
  /**
   * Szersza siatka: cokolwiek poza drukowalnym ASCII (myślnik typograficzny,
   * wielokropek, twarda spacja) też połowi segment. Wszystkie sześć tekstów
   * spełnia dziś ten mocniejszy warunek i ma go spełniać dalej.
   */
  const POZA_ASCII = /[^ -~]/;

  const outcomes = ["paid", "refunded", "partial_refund"] as const;

  for (const outcome of outcomes) {
    for (const lang of ["pl", "en"] as const) {
      it(`${outcome}/${lang}: bez ogonków i z tytułem wydarzenia w treści`, async () => {
        if (lang === "en") people.langByUser.set(USER, "en");
        await notifyTicketOutcome(payload({ outcome, refunded_cents: 12_000 }));

        const body = sms.sent[0]?.body ?? "";
        expect(body).not.toMatch(OGONKI);
        expect(body).not.toMatch(POZA_ASCII);
        // Bez tytułu SMS jest bezużyteczny: uczestnik zapisany na trzy
        // wydarzenia nie wie, o które chodzi.
        expect(body).toContain(lang === "en" ? TITLE_EN : TITLE_PL);
      });
    }
  }

  it("SMS o awansie z rezerwy też jest bez ogonków, w obu językach", async () => {
    people.langByUser.set(USER_PROMOTED, "en");
    const other = "11111111-7777-4777-8777-111111111111";
    await notifyTicketOutcome(
      payload({
        outcome: "refunded",
        refunded_cents: 24_900,
        contact: null,
        waitlist: {
          promoted: 2,
          registrations: [
            promotedRow(),
            promotedRow({
              registration_id: "22222222-8888-4888-8888-222222222222",
              user_id: other,
              email: "rezerwa2@example.com",
              phone: "+48500100202",
            }),
          ],
        },
      }),
    );

    expect(sms.sent).toHaveLength(2);
    for (const entry of sms.sent) {
      expect(entry.body).not.toMatch(OGONKI);
      expect(entry.body).not.toMatch(POZA_ASCII);
    }
    expect(sms.sent[0]?.body).toContain(TITLE_EN);
    expect(sms.sent[1]?.body).toContain(TITLE_PL);
  });

  it("trzy wyniki dają trzy RÓŻNE treści - status nie może się rozmyć", async () => {
    const bodies: string[] = [];
    for (const outcome of outcomes) {
      sms.reset();
      await notifyTicketOutcome(payload({ outcome, refunded_cents: 12_000 }));
      bodies.push(sms.sent[0]?.body ?? "");
    }

    expect(new Set(bodies).size).toBe(3);
    // Zwrot pełny musi być rozpoznawalny jako anulowanie, a częściowy - jako
    // utrzymanie miejsca. Pomylenie tych dwóch to reklamacja.
    expect(bodies[1]).toMatch(/anulowany/);
    expect(bodies[2]).toMatch(/Miejsce pozostaje/);
  });
});

// --- 5. kwota, tytuł, wiersze szczegółów, kaskada języka --------------------

describe("kwota w mailu", () => {
  it("grosze zamienia na jednostki i formatuje po polsku z waluty ładunku", async () => {
    await notifyTicketOutcome(payload({ amount_cents: 24_900, currency: "PLN" }));

    const value = detailValue(mail.attempts[0] as TxSendInput, "Kwota") ?? "";
    expect(value).toMatch(/249[.,]00/);
    // Gdyby zabrakło dzielenia przez 100, uczestnik zobaczyłby 24 900 zł.
    expect(value).not.toMatch(/24[\s., ]?900/);
    expect(value).toContain("zł");
  });

  it("brak waluty w ładunku spada na PLN, nie na pustą etykietę", async () => {
    await notifyTicketOutcome(payload({ currency: null }));

    expect(detailValue(mail.attempts[0] as TxSendInput, "Kwota")).toContain("zł");
  });

  it("waluta małymi literami z operatora nadal daje poprawny symbol", async () => {
    people.langByUser.set(USER, "en");
    await notifyTicketOutcome(payload({ currency: "eur", amount_cents: 5_000 }));

    const value = detailValue(mail.attempts[0] as TxSendInput, "Amount") ?? "";
    expect(value).toContain("€");
    expect(value).toMatch(/50[.,]00/);
  });

  it("kwota nieliczbowa nie tworzy wiersza z kwotą", async () => {
    // Operator potrafi przysłać pole bez wartości; wiersz „Kwota: NaN zł"
    // byłby dla uczestnika gorszy niż brak wiersza.
    await notifyTicketOutcome(payload({ amount_cents: Number.NaN }));

    const labels = (mail.attempts[0]?.details ?? []).map((detail) => detail.label);
    expect(labels).toEqual(["Wydarzenie"]);
  });

  it("język przełącza locale kwoty, a nie tylko napisy", async () => {
    people.langByUser.set(USER, "en");
    await notifyTicketOutcome(payload({ amount_cents: 123_456, currency: "PLN" }));

    // en-GB stawia kropkę dziesiętną; pl-PL przecinek. To ta sama liczba
    // zapisana inaczej i tylko locale o tym decyduje.
    expect(detailValue(mail.attempts[0] as TxSendInput, "Amount")).toMatch(/1[\s., ]?234\.56/);
  });
});

describe("tytuł wydarzenia i wiersze szczegółów", () => {
  it("angielski odbiorca bez tytułu angielskiego dostaje tytuł polski", async () => {
    // Kaskada istnieje po to, żeby mail nie wyszedł z pustym tematem, gdy
    // organizator wypełnił tylko jedną wersję językową.
    people.langByUser.set(USER, "en");
    await notifyTicketOutcome(payload({ event_title_en: null }));

    expect(mail.attempts[0]?.subjectName).toBe(TITLE_PL);
    expect(detailValue(mail.attempts[0] as TxSendInput, "Event")).toBe(TITLE_PL);
  });

  it("polski odbiorca bez tytułu polskiego dostaje tytuł angielski", async () => {
    await notifyTicketOutcome(payload({ event_title_pl: null }));

    expect(mail.attempts[0]?.subjectName).toBe(TITLE_EN);
  });

  it("brak obu tytułów daje pusty temat i pomija wiersz „Wydarzenie”", async () => {
    await notifyTicketOutcome(payload({ event_title_pl: null, event_title_en: null }));

    expect(mail.attempts[0]?.subjectName).toBe("");
    expect((mail.attempts[0]?.details ?? []).map((detail) => detail.label)).toEqual(["Kwota"]);
  });

  it("opłacony bilet NIE pokazuje kwoty zwrotu, choćby była w ładunku", async () => {
    // Wiersz „Kwota zwrotu" w mailu o opłaceniu sugerowałby anulowanie -
    // dlatego jest zawężony do wyników innych niż `paid`.
    await notifyTicketOutcome(payload({ outcome: "paid", refunded_cents: 5_000 }));

    const labels = (mail.attempts[0]?.details ?? []).map((detail) => detail.label);
    expect(labels).toEqual(["Wydarzenie", "Kwota"]);
  });

  it("zwrot częściowy pokazuje trzy wiersze: co, ile zapłacono, ile wróciło", async () => {
    await notifyTicketOutcome(
      payload({ outcome: "partial_refund", amount_cents: 24_900, refunded_cents: 5_000 }),
    );

    const details = mail.attempts[0]?.details ?? [];
    expect(details.map((detail) => detail.label)).toEqual([
      "Wydarzenie",
      "Kwota",
      "Kwota zwrotu",
    ]);
    expect(details[2]?.value).toMatch(/50[.,]00/);
  });

  it("zwrot bez kwoty zwrotu pomija ten wiersz, a nie pokazuje zera", async () => {
    await notifyTicketOutcome(payload({ outcome: "refunded", refunded_cents: null }));

    expect((mail.attempts[0]?.details ?? []).map((detail) => detail.label)).toEqual([
      "Wydarzenie",
      "Kwota",
    ]);
  });

  it("adres CTA prowadzi na stronę wydarzenia, a bez sluga na listę wydarzeń", async () => {
    await notifyTicketOutcome(payload());
    expect(mail.attempts[0]?.ctaPath).toBe("/events/kongres-gospodarczy-2026");

    mail.reset();
    await notifyTicketOutcome(payload({ event_slug: null }));
    expect(mail.attempts[0]?.ctaPath).toBe("/events");
  });
});

describe("język odbiorcy", () => {
  it("gość bez konta dostaje polski, bez pytania profilu o cokolwiek", async () => {
    await notifyTicketOutcome(
      payload({
        contact: { user_id: null, email: "gosc@example.com", phone: null, first_name: "Ola" },
      }),
    );

    expect(mail.attempts[0]?.lang).toBe("pl");
    expect(people.resolveRecipient).not.toHaveBeenCalled();
  });

  it("konto bez preferencji językowej też dostaje polski", async () => {
    await notifyTicketOutcome(payload());

    expect(people.resolveRecipient).toHaveBeenCalled();
    expect(mail.attempts[0]?.lang).toBe("pl");
  });

  it("awaria odczytu profilu nie wywraca wysyłki - mail idzie po polsku", async () => {
    // `resolveRecipient` rzuca przy błędzie bazy (świadomie). Tutaj to nie może
    // znaczyć „nie wysyłamy": język jest wygodą, mail o pieniądzach - nie.
    people.breakProfiles(new Error("profil niedostępny"));
    const result = await notifyTicketOutcome(payload());

    expect(result.emailed).toBe(true);
    expect(mail.attempts[0]?.lang).toBe("pl");
  });

  it("preferencja z profilu przełącza cały mail na angielski", async () => {
    people.langByUser.set(USER, "en");
    await notifyTicketOutcome(payload());

    expect(mail.attempts[0]?.lang).toBe("en");
    expect(mail.attempts[0]?.type).toBe("event_ticket_paid");
    expect((mail.attempts[0]?.details ?? []).map((detail) => detail.label)).toEqual([
      "Event",
      "Amount",
    ]);
  });

  it("imię z ładunku idzie do maila obcięte z białych znaków", async () => {
    await notifyTicketOutcome(
      payload({
        contact: {
          user_id: USER,
          email: "  uczestnik@example.com  ",
          phone: " +48500100200 ",
          first_name: "  Halina  ",
        },
      }),
    );

    expect(mail.attempts[0]?.metaName).toBe("Halina");
    expect(mail.attempts[0]?.to).toBe("uczestnik@example.com");
    expect(sms.sent[0]?.to).toBe("+48500100200");
  });

  it("puste napisy w kontakcie znaczą brak kontaktu, nie pusty adres", async () => {
    const result = await notifyTicketOutcome(
      payload({ contact: { user_id: "   ", email: "   ", phone: "", first_name: "" } }),
    );

    expect(result).toEqual({ emailed: false, smsSent: false, promotedNotified: 0 });
    expect(mail.attempts).toHaveLength(0);
    expect(sms.sent).toHaveLength(0);
    expect(stub.chainsFor("notifications")).toHaveLength(0);
  });

  it("brak sekcji kontaktu w ładunku nie wywraca funkcji", async () => {
    const result = await notifyTicketOutcome(payload({ contact: null }));

    expect(result.emailed).toBe(false);
    expect(result.smsSent).toBe(false);
  });
});

// --- 6. dzwonek w aplikacji -------------------------------------------------

describe("dzwonek w aplikacji", () => {
  it("wiersz powiadomienia niesie właściciela, najemcę, oba języki i adres", async () => {
    await notifyTicketOutcome(payload());

    const row = bellRow();
    // `tenant_id` jest tu WARUNKIEM, nie ozdobą: wpis bez najemcy albo
    // wyświetlałby się wszystkim, albo nikomu.
    expect(row).toMatchObject({
      user_id: USER,
      tenant_id: TENANT,
      kind: "billing",
      title_pl: "Bilet opłacony",
      title_en: "Ticket paid",
      body_pl: TITLE_PL,
      body_en: TITLE_EN,
      href: "/events/kongres-gospodarczy-2026",
      icon: "receipt",
    });
  });

  it("tytuł dzwonka mówi o anulowaniu przy zwrocie i o korekcie przy częściowym", async () => {
    await notifyTicketOutcome(payload({ outcome: "refunded", refunded_cents: 24_900 }));
    expect(bellRow()).toMatchObject({
      title_pl: "Bilet anulowany - zwrot płatności",
      title_en: "Ticket cancelled - payment refunded",
    });

    await notifyTicketOutcome(payload({ outcome: "partial_refund", refunded_cents: 5_000 }));
    expect(bellRow()).toMatchObject({
      title_pl: "Częściowy zwrot za bilet",
      title_en: "Partial ticket refund",
    });
  });

  it("bez sluga wydarzenia dzwonek prowadzi do biletów w profilu", async () => {
    await notifyTicketOutcome(payload({ event_slug: null }));

    expect(bellRow()?.["href"]).toBe("/profile/tickets");
  });

  it("dzwonek niesie oba tytuły niezależnie od języka maila", async () => {
    // Wpis w bazie jest jeden, a czyta go interfejs w języku sesji - dlatego
    // wiersz musi mieć obie wersje, choćby mail poszedł tylko po angielsku.
    people.langByUser.set(USER, "en");
    await notifyTicketOutcome(payload());

    expect(bellRow()).toMatchObject({ body_pl: TITLE_PL, body_en: TITLE_EN });
  });

  it("gość bez konta nie dostaje wpisu - nie ma gdzie go pokazać", async () => {
    await notifyTicketOutcome(
      payload({
        contact: { user_id: null, email: "gosc@example.com", phone: null, first_name: "Ola" },
      }),
    );

    expect(stub.chainsFor("notifications")).toHaveLength(0);
  });

  it("ładunek bez najemcy NIE tworzy wpisu bez najemcy", async () => {
    const result = await notifyTicketOutcome(payload({ tenant_id: null }));

    expect(stub.chainsFor("notifications")).toHaveLength(0);
    // Mail nadal idzie: brak dzwonka to nie powód, żeby wyciszyć pocztę.
    expect(result.emailed).toBe(true);
  });

  it("awaria wpisu dzwonka nie unieważnia wysłanego maila ani SMS-a", async () => {
    db.breakTable("notifications");
    const result = await notifyTicketOutcome(payload());

    expect(result).toEqual({ emailed: true, smsSent: true, promotedNotified: 0 });
    expect(errorSpy.mock.calls.map((call) => String(call[0]))).toContain(
      "[events] ticket outcome bell failed",
    );
  });
});

// --- 7. fail-soft całości i kolejka rezerwowa -------------------------------

describe("fail-soft: webhook nie może wpaść w wieczne ponowienia", () => {
  it("rzut bramy poczty nie przewraca funkcji - SMS i dzwonek nadal idą", async () => {
    mail.breakProvider(new Error("dostawca poczty odmówił"));
    const result = await notifyTicketOutcome(payload());

    expect(result.emailed).toBe(false);
    expect(result.smsSent).toBe(true);
    expect(bellRow()?.["user_id"]).toBe(USER);
    expect(errorSpy.mock.calls.map((call) => String(call[0]))).toContain(
      "[events] ticket outcome email failed",
    );
  });

  it("rzut bramy SMS nie przewraca funkcji - mail już poszedł i tak zostaje", async () => {
    sms.breakGateway(new Error("brama SMS odmówiła"));
    const result = await notifyTicketOutcome(payload());

    expect(result.emailed).toBe(true);
    expect(result.smsSent).toBe(false);
    expect(bellRow()?.["user_id"]).toBe(USER);
    expect(errorSpy.mock.calls.map((call) => String(call[0]))).toContain(
      "[events] ticket outcome sms failed",
    );
  });

  it("odmowa dostawcy (bez rzutu) daje `emailed: false`, a nie ciche `true`", async () => {
    // Wynik funkcji trafia do panelu jako informacja „wysłano". Musi
    // odpowiadać temu, co realnie wyszło.
    mail.sendTxEmail.mockImplementationOnce(async () => ({ ok: false, error: "bounce" }));
    const result = await notifyTicketOutcome(payload());

    expect(result.emailed).toBe(false);
  });

  it("awaria kolejki rezerwowej nie zabiera maila płacącemu", async () => {
    mail.breakType("event_waitlist_promoted");
    const result = await notifyTicketOutcome(
      payload({
        outcome: "refunded",
        refunded_cents: 24_900,
        waitlist: { promoted: 1, registrations: [promotedRow()] },
      }),
    );

    expect(result.promotedNotified).toBe(0);
    expect(result.emailed).toBe(true);
    expect(errorSpy.mock.calls.map((call) => String(call[0]))).toContain(
      "[events] waitlist promotion notify failed",
    );
  });

  it("rzut z bramy SMS w środku kolejki przerywa resztę awansów", async () => {
    // `notifyPromoted` NIE osłania `sendSms` (:202-209), bo produkcyjna brama
    // jest udokumentowana jako „nigdy nie rzuca". Ten test pilnuje tego
    // założenia: gdyby brama zaczęła rzucać, pierwszy wiersz zabiera całą
    // resztę kolejki i wynik pokazuje zero awansów, choć mail już poszedł.
    sms.breakGateway(new Error("brama SMS odmówiła"));
    const result = await notifyTicketOutcome(
      payload({
        outcome: "refunded",
        refunded_cents: 24_900,
        waitlist: {
          promoted: 2,
          registrations: [
            promotedRow(),
            promotedRow({
              registration_id: "33333333-9999-4999-8999-333333333333",
              email: "rezerwa3@example.com",
            }),
          ],
        },
      }),
    );

    expect(result.promotedNotified).toBe(0);
    expect(attemptsOfType("event_waitlist_promoted")).toHaveLength(1);
  });
});

describe("kolejka rezerwowa", () => {
  it("mail o awansie niesie tytuł, adres wydarzenia, imię i najemcę", async () => {
    await notifyTicketOutcome(
      payload({
        outcome: "refunded",
        refunded_cents: 24_900,
        waitlist: { promoted: 1, registrations: [promotedRow()] },
      }),
    );

    const promoted = attemptsOfType("event_waitlist_promoted")[0];
    expect(promoted).toMatchObject({
      to: "rezerwa@example.com",
      lang: "pl",
      subjectName: TITLE_PL,
      ctaPath: "/events/kongres-gospodarczy-2026",
      metaName: "Bogumil",
      tenantId: TENANT,
    });
    expect(promoted?.details).toEqual([{ label: "Wydarzenie", value: TITLE_PL }]);
  });

  it("awansowany z angielskim profilem dostaje angielski mail i angielski SMS", async () => {
    people.langByUser.set(USER_PROMOTED, "en");
    await notifyTicketOutcome(
      payload({
        outcome: "refunded",
        refunded_cents: 24_900,
        contact: null,
        waitlist: { promoted: 1, registrations: [promotedRow()] },
      }),
    );

    const promoted = attemptsOfType("event_waitlist_promoted")[0];
    expect(promoted?.lang).toBe("en");
    expect(promoted?.details).toEqual([{ label: "Event", value: TITLE_EN }]);
    expect(sms.sent[0]?.body).toContain(TITLE_EN);
  });

  it("wiersz bez adresu poczty jest pomijany W CAŁOŚCI - także bez SMS-a", async () => {
    // Osoba, do której nie ma jak napisać maila ze szczegółami, nie może
    // dostać samego SMS-a „sprawdź pocztę".
    const result = await notifyTicketOutcome(
      payload({
        outcome: "refunded",
        refunded_cents: 24_900,
        contact: null,
        waitlist: {
          promoted: 3,
          registrations: [
            promotedRow({ email: null, phone: "+48500100203" }),
            promotedRow({ registration_id: null, email: "bez-zgloszenia@example.com" }),
            promotedRow({ registration_id: "44444444-1010-4010-8010-444444444444" }),
          ],
        },
      }),
    );

    expect(result.promotedNotified).toBe(1);
    expect(attemptsOfType("event_waitlist_promoted")).toHaveLength(1);
    expect(sms.sent.map((entry) => entry.to)).toEqual(["+48500100201"]);
  });

  it("liczba awansów jest MIERZONA, a nie przepisana z ładunku", async () => {
    // `waitlist.promoted` mówi, ile miejsc zwolniła baza; wynik funkcji mówi,
    // ile osób realnie dostało wiadomość. Zrównanie tych dwóch liczb ukrywałoby
    // każdą awarię wysyłki.
    const result = await notifyTicketOutcome(
      payload({
        outcome: "refunded",
        refunded_cents: 24_900,
        waitlist: { promoted: 5, registrations: [] },
      }),
    );

    expect(result.promotedNotified).toBe(0);
    expect(mail.attempts.every((entry) => entry.type !== "event_waitlist_promoted")).toBe(true);
  });

  it("brak sekcji listy rezerwowej nie woła bramy poczty dodatkowy raz", async () => {
    const result = await notifyTicketOutcome(payload({ waitlist: null }));

    expect(result.promotedNotified).toBe(0);
    expect(mail.attempts).toHaveLength(1);
  });

  it("bez sluga wydarzenia awansowany trafia na listę wydarzeń", async () => {
    await notifyTicketOutcome(
      payload({
        outcome: "refunded",
        refunded_cents: 24_900,
        event_slug: null,
        contact: null,
        waitlist: { promoted: 1, registrations: [promotedRow()] },
      }),
    );

    expect(attemptsOfType("event_waitlist_promoted")[0]?.ctaPath).toBe("/events");
  });

  it("awansowany bez tytułu wydarzenia dostaje mail bez pustego wiersza szczegółu", async () => {
    await notifyTicketOutcome(
      payload({
        outcome: "refunded",
        refunded_cents: 24_900,
        event_title_pl: null,
        event_title_en: null,
        contact: null,
        waitlist: { promoted: 1, registrations: [promotedRow()] },
      }),
    );

    expect(attemptsOfType("event_waitlist_promoted")[0]?.details).toEqual([]);
  });
});
