// POWIADOMIENIA ROZLICZENIOWE - BRAMKA WYSYŁKI.
//
// PO CO TEN PLIK. `notifications.server.ts` jest jedynym miejscem, w którym
// zdarzenie pieniężne (opłacona subskrypcja, nieudane obciążenie, zwrot,
// rezygnacja) zamienia się w wiadomość do klienta. Cały moduł jest fail-soft:
// KAŻDA funkcja łapie wyjątek i kończy się cicho, bo mail nie może wywrócić
// webhooka operatora płatności. Ta konstrukcja ma jednak drugą stronę - kiedy
// mail NIE wychodzi, nic tego nie zgłasza. Dlatego decyzja „wysyłamy / nie
// wysyłamy" musi być udowodniona testem, a nie obserwacją produkcji.
//
// CO TU STOI: gałęzie decydujące o samym FAKCIE wysyłki - istnienie adresu,
// wybór języka odbiorcy (profil -> newsletter -> PL), idempotencja (to samo
// zdarzenie dwa razy = jedna wiadomość) i zachowanie przy awarii dostawcy
// poczty. Kształt treści (szczegóły, kwoty, daty per rodzaj maila) jest
// dowodzony osobno w `notificationsPayload.server.test.ts`.
//
// GRANICE ATRAPOWANE: klient service_role (`@/integrations/supabase/client.server`)
// i wysyłka poczty (`sendTxEmail`). Formatowanie kwot i dat zostaje PRAWDZIWE
// (`importOriginal`), bo asercja na własnej atrapie formatera nie dowodzi
// niczego o produkcji. Modułów `@/lib/billing/*` nie atrapujemy.
//
// RODO: wszystkie adresy są syntetyczne (`example.com`), imiona nie są danymi
// realnej osoby, a klucz idempotencji - który trafia do logów i do tabeli
// `email_send_log` - ma osobną asercję, że NIE zawiera adresu odbiorcy.
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";

import type { Database } from "@/integrations/supabase/types";
import type { TxSendInput, TxSendResult } from "@/lib/email/transactional.server";
import { fail, ok, supabaseFromStub, type SupabaseFromStub } from "@/test/billing/fixtures";

/** Jedna próba wysyłki zapamiętana przez atrapę dostawcy poczty. */
interface MailAttempt {
  readonly input: TxSendInput;
  readonly result: TxSendResult;
}

// --- atrapa klienta service_role -------------------------------------------
// `supabaseAdmin` jest wciągany DYNAMICZNIE wewnątrz każdej funkcji powiadomień
// (`await import(...)`), więc atrapa musi istnieć już w chwili hoistingu, a
// konkretny plan odpowiedzi podmieniamy per test.
const db = vi.hoisted(() => {
  let active: { from: (table: string) => unknown } | null = null;
  return {
    use(next: { from: (table: string) => unknown }): void {
      active = next;
    },
    from(table: string): unknown {
      if (!active) throw new Error(`test: brak zaplanowanej atrapy Supabase dla "${table}"`);
      return active.from(table);
    },
  };
});

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: { from: (table: string) => db.from(table) },
}));

// --- atrapa dostawcy poczty -------------------------------------------------
// Atrapa ODWZOROWUJE KONTRAKT `sendTxEmail`, a nie tylko liczy wywołania:
// prawdziwa wysyłka deduplikuje po `idempotencyKey` (wiersz w `email_send_log`)
// i zwraca `skipped: "duplicate"` zamiast wysyłać drugi raz. Bez tego atrapa
// „dowiodłaby" idempotencji, której w produkcji by nie było.
const mail = vi.hoisted(() => {
  const attempts: MailAttempt[] = [];
  const handled = new Set<string>();
  let thrown: Error | null = null;
  let forced: TxSendResult | null = null;

  const sendTxEmail = vi.fn(async (input: TxSendInput): Promise<TxSendResult> => {
    if (thrown) throw thrown;
    if (forced) {
      attempts.push({ input, result: forced });
      return forced;
    }
    const duplicate = handled.has(input.idempotencyKey);
    const result: TxSendResult = duplicate ? { ok: true, skipped: "duplicate" } : { ok: true };
    if (!duplicate) handled.add(input.idempotencyKey);
    attempts.push({ input, result });
    return result;
  });

  return {
    sendTxEmail,
    /** Wszystkie próby - także te rozpoznane jako duplikat. */
    attempts,
    /** Wiadomości, które NAPRAWDĘ trafiły do kolejki dostawcy. */
    queued(): TxSendInput[] {
      return attempts.filter((a) => a.result.ok && !a.result.skipped).map((a) => a.input);
    },
    breakProvider(error: Error): void {
      thrown = error;
    },
    forceResult(result: TxSendResult): void {
      forced = result;
    },
    reset(): void {
      attempts.length = 0;
      handled.clear();
      thrown = null;
      forced = null;
      sendTxEmail.mockClear();
    },
  };
});

vi.mock("@/lib/email/transactional.server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/email/transactional.server")>();
  return { ...actual, sendTxEmail: mail.sendTxEmail };
});

import {
  notifyEventRegistration,
  notifyPaymentEmail,
  notifyRefundEmail,
  notifyReminderEmail,
  notifySubscriptionEmail,
} from "@/lib/billing/notifications.server";

// --- rzuty kolumn czytanych przez moduł -------------------------------------
// Kształt bierzemy z WYGENEROWANYCH definicji bazy, ale rozluźniamy o `null`:
// kod produkcyjny jawnie broni się przed pustymi kolumnami (`|| data.name_pl`,
// `event.slug ? ... : "/events"`), więc typ, który tych pustek zabrania,
// uniemożliwiłby przetestowanie właśnie tych gałęzi.
type Nullable<
  T extends keyof Database["public"]["Tables"],
  K extends keyof Database["public"]["Tables"][T]["Row"],
> = {
  [P in K]: Database["public"]["Tables"][T]["Row"][P] | null;
};

type ProfileProjection = Nullable<"profiles", "email" | "first_name" | "display_name" | "prefs">;
type PlanProjection = Nullable<
  "access_plans",
  "name_pl" | "name_en" | "price_cents" | "currency" | "interval"
>;
type NewsletterProjection = Nullable<"newsletter_subscribers", "language">;

const RECIPIENT = "odbiorca@example.com";

function profileRow(over: Partial<ProfileProjection> = {}): ProfileProjection {
  return {
    email: RECIPIENT,
    first_name: "Imie",
    display_name: "Konto Testowe",
    prefs: {},
    ...over,
  };
}

function planRow(over: Partial<PlanProjection> = {}): PlanProjection {
  return {
    name_pl: "Członek",
    name_en: "Member",
    price_cents: 4900,
    currency: "PLN",
    interval: "month",
    ...over,
  };
}

interface Scenario {
  /** `undefined` = domyślny profil; `null` = brak wiersza (konto usunięte). */
  profile?: ProfileProjection | null;
  /** Błąd odczytu profilu (awaria bazy w trakcie webhooka). */
  profileError?: string;
  newsletter?: NewsletterProjection | null;
  /** Plany po identyfikatorze - brak wpisu = plan nie istnieje w bazie. */
  plans?: Record<string, PlanProjection>;
}

function givenDb(scenario: Scenario = {}): SupabaseFromStub {
  const stub = supabaseFromStub();
  stub.setResponse(
    "profiles",
    scenario.profileError
      ? fail(scenario.profileError)
      : ok(scenario.profile === undefined ? profileRow() : scenario.profile),
  );
  stub.setResponse("newsletter_subscribers", ok(scenario.newsletter ?? null));
  stub.setResponse("access_plans", (chain) => {
    const planId = chain.argsOf("eq")?.[1];
    const table = scenario.plans ?? {};
    return ok(typeof planId === "string" ? (table[planId] ?? null) : null);
  });
  db.use(stub);
  return stub;
}

/** Ostatnia próba wysyłki - zawężenie typu zamiast rzutowania. */
function lastAttempt(): TxSendInput {
  const attempt = mail.attempts.at(-1);
  if (!attempt) throw new Error("test: nie było żadnej próby wysyłki");
  return attempt.input;
}

/** Jedyna zakolejkowana wiadomość - asercja „dokładnie jedna". */
function onlyQueued(): TxSendInput {
  const queued = mail.queued();
  expect(queued).toHaveLength(1);
  const first = queued[0];
  if (!first) throw new Error("test: kolejka pusta");
  return first;
}

const CONFIRMED = {
  kind: "subscription_confirmed",
  userId: "user-me",
  planId: "plan-member",
  idempotencySeed: "ord-1",
} as const;

let errorSpy: MockInstance<typeof console.error>;

beforeEach(() => {
  mail.reset();
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  errorSpy.mockRestore();
});

describe("czy powiadomienie w ogóle wychodzi", () => {
  it("brak wiersza profilu (konto usunięte) nie wysyła niczego", async () => {
    givenDb({ profile: null });
    await notifySubscriptionEmail({ ...CONFIRMED });
    expect(mail.sendTxEmail).not.toHaveBeenCalled();
  });

  it("profil bez adresu nie wysyła niczego - i nie próbuje zgadywać adresu", async () => {
    const stub = givenDb({ profile: profileRow({ email: null }) });
    await notifySubscriptionEmail({ ...CONFIRMED });
    expect(mail.sendTxEmail).not.toHaveBeenCalled();
    // Skoro nie ma do kogo pisać, nie ma też po co czytać planu ani newslettera:
    // przerwanie MUSI nastąpić przed tymi zapytaniami.
    expect(stub.chainsFor("access_plans")).toHaveLength(0);
    expect(stub.chainsFor("newsletter_subscribers")).toHaveLength(0);
  });

  it("adres złożony z samych spacji jest traktowany jak brak adresu", async () => {
    givenDb({ profile: profileRow({ email: "   " }) });
    await notifySubscriptionEmail({ ...CONFIRMED });
    expect(mail.sendTxEmail).not.toHaveBeenCalled();
  });

  it("BEZ ADRESU milczy KAŻDA ścieżka powiadomień, nie tylko subskrypcyjna", async () => {
    // Bramka odbiorcy jest powielona w pięciu funkcjach modułu. Gdyby
    // którakolwiek z nich ją zgubiła, poszedłby mail na pusty adres - a przy
    // windykacji i zwrotach to natychmiastowy problem z reputacją domeny.
    givenDb({ profile: profileRow({ email: null }) });

    await notifyPaymentEmail({
      kind: "payment_failed",
      userId: "user-me",
      planId: null,
      idempotencySeed: "inv-0",
    });
    await notifyRefundEmail({ userId: "user-me", planId: null, idempotencySeed: "ref-0" });
    await notifyReminderEmail({
      kind: "subscription_expiring",
      userId: "user-me",
      planId: null,
      periodEnd: "2026-09-01T10:00:00.000Z",
      idempotencySeed: "sub_0:2026-09-01",
    });
    await notifyEventRegistration({
      userId: "user-me",
      eventId: "evt-1",
      idempotencySeed: "reg-0",
    });

    expect(mail.sendTxEmail).not.toHaveBeenCalled();
  });

  it("brak wydarzenia w bazie zatrzymuje potwierdzenie zapisu", async () => {
    const stub = givenDb();
    stub.setResponse("events", ok(null));
    await notifyEventRegistration({ userId: "user-me", eventId: "evt-1", idempotencySeed: "r-1" });
    expect(mail.sendTxEmail).not.toHaveBeenCalled();
  });
});

describe("język odbiorcy - profil, potem newsletter, na końcu PL", () => {
  it("preferencja z profilu wygrywa i oszczędza zapytanie o newsletter", async () => {
    const stub = givenDb({ profile: profileRow({ prefs: { language: "en" } }) });
    await notifySubscriptionEmail({ ...CONFIRMED });
    expect(lastAttempt().lang).toBe("en");
    expect(stub.chainsFor("newsletter_subscribers")).toHaveLength(0);
  });

  it("starszy klucz `lang` jest nadal honorowany", async () => {
    givenDb({ profile: profileRow({ prefs: { lang: "en" } }) });
    await notifySubscriptionEmail({ ...CONFIRMED });
    expect(lastAttempt().lang).toBe("en");
  });

  it("bez preferencji w profilu język bierze się z zapisu na newsletter", async () => {
    const stub = givenDb({ profile: profileRow({ prefs: null }), newsletter: { language: "en" } });
    await notifySubscriptionEmail({ ...CONFIRMED });
    expect(lastAttempt().lang).toBe("en");
    // Dopasowanie adresu MUSI być bez rozróżniania wielkości liter - w bazie
    // adres bywa zapisany inaczej niż w profilu, a mail po angielsku wysłany
    // po polsku to widoczny błąd obsługi.
    const chain = stub.lastChain("newsletter_subscribers");
    expect(chain?.has("ilike")).toBe(true);
    expect(chain?.argsOf("ilike")).toEqual(["email", RECIPIENT]);
  });

  it("nieznany kod języka w profilu spada do PL, nie do pustki", async () => {
    givenDb({ profile: profileRow({ prefs: { language: "de" } }) });
    await notifySubscriptionEmail({ ...CONFIRMED });
    expect(lastAttempt().lang).toBe("pl");
  });

  it("wiersz newslettera bez języka spada do PL", async () => {
    givenDb({ profile: profileRow({ prefs: {} }), newsletter: { language: null } });
    await notifySubscriptionEmail({ ...CONFIRMED });
    expect(lastAttempt().lang).toBe("pl");
  });

  it("BRAK zapisu na newsletter (wypisany adres) NIE blokuje maila transakcyjnego", async () => {
    // Reguła prawna i biznesowa: wypis z newslettera dotyczy wysyłki za zgodą.
    // Potwierdzenie płatności musi dojść mimo wypisu - blokadę stosuje dopiero
    // brama listy wykluczeń w warstwie poczty, po kategorii wiadomości.
    givenDb({ profile: profileRow({ prefs: {} }), newsletter: null });
    await notifySubscriptionEmail({ ...CONFIRMED });
    expect(mail.queued()).toHaveLength(1);
    expect(lastAttempt().lang).toBe("pl");
  });
});

describe("personalizacja nagłówka", () => {
  it("imię z profilu trafia do maila", async () => {
    givenDb();
    await notifySubscriptionEmail({ ...CONFIRMED });
    expect(lastAttempt().metaName).toBe("Imie");
  });

  it("bez imienia używa nazwy wyświetlanej", async () => {
    givenDb({ profile: profileRow({ first_name: null }) });
    await notifySubscriptionEmail({ ...CONFIRMED });
    expect(lastAttempt().metaName).toBe("Konto Testowe");
  });

  it("bez imienia i nazwy zostaje pusto - mail idzie bez personalizacji", async () => {
    givenDb({ profile: profileRow({ first_name: null, display_name: null }) });
    await notifySubscriptionEmail({ ...CONFIRMED });
    expect(lastAttempt().metaName).toBeNull();
    expect(mail.queued()).toHaveLength(1);
  });
});

describe("idempotencja - jedno zdarzenie, jedna wiadomość", () => {
  it("powtórzone zdarzenie nie generuje drugiej wiadomości", async () => {
    givenDb();
    await notifySubscriptionEmail({ ...CONFIRMED });
    await notifySubscriptionEmail({ ...CONFIRMED });

    expect(mail.sendTxEmail).toHaveBeenCalledTimes(2);
    // Druga próba trafia w ten sam klucz i jest odrzucona jako duplikat.
    expect(mail.queued()).toHaveLength(1);
    expect(mail.attempts.map((a) => a.input.idempotencyKey)).toEqual([
      "subscription_confirmed:ord-1",
      "subscription_confirmed:ord-1",
    ]);
    expect(mail.attempts.at(-1)?.result.skipped).toBe("duplicate");
  });

  it("nowe zdarzenie tego samego rodzaju wysyła kolejną wiadomość", async () => {
    givenDb();
    await notifySubscriptionEmail({ ...CONFIRMED });
    await notifySubscriptionEmail({ ...CONFIRMED, idempotencySeed: "ord-2" });
    expect(mail.queued()).toHaveLength(2);
  });

  it("ten sam identyfikator w innym rodzaju zdarzenia to inna wiadomość", async () => {
    // Klucz zawiera rodzaj, więc odnowienie i potwierdzenie tej samej
    // subskrypcji nie kasują się nawzajem.
    givenDb();
    await notifySubscriptionEmail({ ...CONFIRMED });
    await notifySubscriptionEmail({ ...CONFIRMED, kind: "subscription_renewed" });
    expect(mail.queued()).toHaveLength(2);
    expect(mail.queued().map((m) => m.idempotencyKey)).toEqual([
      "subscription_confirmed:ord-1",
      "subscription_renewed:ord-1",
    ]);
  });

  it("dwukrotny przebieg przypomnień w tej samej dobie to jeden mail", async () => {
    givenDb({ plans: { "plan-member": planRow() } });
    const input = {
      kind: "subscription_renewal_reminder",
      userId: "user-me",
      planId: "plan-member",
      periodEnd: "2026-09-01T10:00:00.000Z",
      idempotencySeed: "sub_1:2026-09-01",
    } as const;
    await notifyReminderEmail({ ...input });
    await notifyReminderEmail({ ...input });
    expect(mail.queued()).toHaveLength(1);
  });

  it("RODO: klucz idempotencji nie zawiera adresu ani imienia odbiorcy", async () => {
    // Klucz jest logowany i zapisywany w `email_send_log`, a stamtąd trafia do
    // raportów dostarczalności - nie może być nośnikiem danych osobowych.
    givenDb();
    await notifySubscriptionEmail({ ...CONFIRMED });
    const key = onlyQueued().idempotencyKey;
    expect(key).not.toContain(RECIPIENT);
    expect(key).not.toContain("odbiorca");
    expect(key).not.toContain("example.com");
    expect(key).not.toContain("Imie");
  });
});

describe("awaria dostawcy poczty", () => {
  it("wyjątek dostawcy nie wywraca operacji nadrzędnej", async () => {
    givenDb();
    mail.breakProvider(new Error("mail gateway 502"));
    await expect(notifySubscriptionEmail({ ...CONFIRMED })).resolves.toBeUndefined();
  });

  it("awaria wysyłki nie zostawia ŻADNEGO zapisu w bazie", async () => {
    // Moduł powiadomień jest czysto odczytowy - gdyby awaria maila potrafiła
    // zostawić półstan (np. znacznik „powiadomiono"), ponowienie webhooka
    // pominęłoby wiadomość na zawsze.
    const stub = givenDb();
    mail.breakProvider(new Error("mail gateway 502"));
    await notifySubscriptionEmail({ ...CONFIRMED });

    const writes = stub.chains.filter(
      (c) => c.has("insert") || c.has("update") || c.has("upsert") || c.has("delete"),
    );
    expect(writes).toEqual([]);
  });

  it("awaria zostawia ślad w logu serwera, ale bez adresu odbiorcy", async () => {
    givenDb();
    mail.breakProvider(new Error("mail gateway 502"));
    await notifySubscriptionEmail({ ...CONFIRMED });

    expect(errorSpy).toHaveBeenCalled();
    const logged = errorSpy.mock.calls.flat().map(String).join(" ");
    expect(logged).toContain("subscription_confirmed");
    // RODO: diagnostyka awarii nie jest powodem do wyniesienia adresu do logów.
    expect(logged).not.toContain(RECIPIENT);
  });

  it("odmowa kolejki (ok:false) też nie rzuca", async () => {
    givenDb();
    mail.forceResult({ ok: false, error: "queue_unavailable" });
    await expect(
      notifyPaymentEmail({
        kind: "payment_failed",
        userId: "user-me",
        planId: null,
        idempotencySeed: "inv-1",
      }),
    ).resolves.toBeUndefined();
    expect(mail.sendTxEmail).toHaveBeenCalledTimes(1);
  });

  it("adres na liście wykluczeń: wysyłka pominięta, bez wyjątku i bez ponowienia", async () => {
    givenDb();
    mail.forceResult({ ok: false, skipped: "suppressed", reason: "suppressed:complaint" });
    await notifyRefundEmail({ userId: "user-me", planId: null, idempotencySeed: "ref-1" });
    expect(mail.sendTxEmail).toHaveBeenCalledTimes(1);
    expect(mail.queued()).toEqual([]);
  });

  it("awaria dostawcy przy KAŻDYM rodzaju powiadomienia kończy się cicho", async () => {
    mail.breakProvider(new Error("mail gateway 502"));
    // Ten przypadek buduje plan odpowiedzi ręcznie, bo obejmuje też tabelę
    // `events`, której pozostałe scenariusze tego pliku nie potrzebują.
    const stub = supabaseFromStub();
    stub.setResponse("profiles", ok(profileRow()));
    stub.setResponse("newsletter_subscribers", ok(null));
    stub.setResponse("access_plans", ok(planRow()));
    stub.setResponse(
      "events",
      ok({
        slug: "forum",
        title_pl: "Forum",
        title_en: "Forum",
        starts_at: "2026-09-01T10:00:00.000Z",
        location: "Bruksela",
        timezone: "Europe/Brussels",
      }),
    );
    db.use(stub);

    await expect(
      Promise.all([
        notifySubscriptionEmail({ ...CONFIRMED }),
        notifyPaymentEmail({
          kind: "payment_recovered",
          userId: "user-me",
          planId: "plan-member",
          idempotencySeed: "inv-2",
        }),
        notifyRefundEmail({ userId: "user-me", planId: null, idempotencySeed: "ref-2" }),
        notifyReminderEmail({
          kind: "subscription_expiring",
          userId: "user-me",
          planId: null,
          periodEnd: "2026-09-01T10:00:00.000Z",
          idempotencySeed: "sub_2:2026-09-01",
        }),
        notifyEventRegistration({ userId: "user-me", eventId: "evt-1", idempotencySeed: "reg-1" }),
      ]),
    ).resolves.toHaveLength(5);
  });
});

describe("odczyt bazy w trakcie ustalania odbiorcy", () => {
  it.fails(
    "DEFEKT: błąd odczytu profilu jest nieodróżnialny od braku konta i znika bez śladu",
    async () => {
      // CO JEST ZŁE. `resolveRecipient` destrukturyzuje wyłącznie `{ data }`
      // z odpowiedzi PostgREST i ignoruje `error`. Przy przejściowej awarii
      // bazy (timeout puli, restart, chwilowy 5xx) `data` jest `null`, więc
      // funkcja zwraca `null`, a wywołujący traktuje to jak „użytkownik nie ma
      // adresu" i kończy się CICHO - bez wyjątku, bez `console.error`,
      // bez wiersza w `email_send_log`.
      //
      // DLACZEGO TO RYZYKO. Ta ścieżka obsługuje maile o NIEUDANEJ PŁATNOŚCI
      // i o rezygnacji. Klient, którego karta odmówiła, nie dowiaduje się o
      // tym wcale, traci dostęp po karencji, a w systemie nie ma ani jednego
      // śladu, po którym obsługa mogłaby to odtworzyć. Zdarzenie webhooka
      // zostaje oznaczone jako przetworzone, więc ponowienie też nie pomoże.
      // To jest awaria niewidzialna - najdroższy rodzaj.
      //
      // DLACZEGO NIE NAPRAWIAM. Zadanie jest testowe; poprawka (rozróżnienie
      // „brak wiersza" od „błąd zapytania" i wyrzucenie/zalogowanie tego
      // drugiego) zmienia zachowanie modułu produkcyjnego i wymaga decyzji,
      // czy błąd odczytu ma przerwać webhooka, czy tylko zostawić ślad.
      // Test stoi jako `it.fails`, żeby regresja odwrotna (ktoś to naprawi)
      // od razu zapaliła się na czerwono i kazała zdjąć znacznik.
      givenDb({ profileError: "canceling statement due to statement timeout" });

      await notifySubscriptionEmail({ ...CONFIRMED });

      // To przechodzi: przy błędzie odczytu mail faktycznie nie wychodzi.
      expect(mail.sendTxEmail).not.toHaveBeenCalled();
      // ASERCJA DOCELOWA - i ta pada: cisza po awarii bazy jest kompletna.
      expect(errorSpy).toHaveBeenCalled();
    },
  );
});
