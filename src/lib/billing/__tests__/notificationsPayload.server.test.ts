// POWIADOMIENIA ROZLICZENIOWE - CO DOKŁADNIE WIDZI KLIENT.
//
// PO CO TEN PLIK. `notificationsGating.server.test.ts` dowodzi, CZY mail
// wychodzi. Tutaj dowodzimy, CO w nim jest - a to w rozliczeniach jest równie
// wiążące: mail o rezygnacji, który pokazuje kwotę kolejnego pobrania, mail
// o zwrocie, który podstawia cenę planu zamiast zwróconej kwoty, albo mail
// o wygaśnięciu z etykietą „Kolejne odnowienie" - to wszystko są komunikaty
// nieprawdziwe wobec klienta, a nie usterki wizualne.
//
// Moduł buduje treść z GAŁĘZI zależnych od rodzaju zdarzenia (siedem rodzajów
// zmian subskrypcji, dwa rodzaje windykacji, zwrot, dwa przypomnienia, zapis
// na wydarzenie). Każda z nich decyduje o innym zestawie wierszy szczegółów
// i innych zmiennych treści, więc każda ma tu własny przypadek.
//
// GRANICE ATRAPOWANE: klient service_role i wysyłka poczty. Formatowanie kwot
// i dat (`formatMoney`/`formatDate`) zostaje PRAWDZIWE - inaczej test badałby
// własną atrapę. Etykiety wierszy bierzemy z prawdziwego słownika `txCopy`,
// żeby zmiana napisu w jednym miejscu nie wymagała przepisania testów.
//
// RODO: adresy wyłącznie w domenie `example.com`, dane osobowe syntetyczne.
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";

import type { Database } from "@/integrations/supabase/types";
import type { EmailLang } from "@/lib/email-templates/nes-layout";
import { txCopy, type TxEmailType } from "@/lib/email-templates/tx-copy";
import type { TxSendInput, TxSendResult } from "@/lib/email/transactional.server";
import { moneyPattern, ok, supabaseFromStub, type SupabaseFromStub } from "@/test/billing/fixtures";

// --- atrapy granic (ten sam kontrakt co w pliku bramki wysyłki) -------------
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

const mail = vi.hoisted(() => {
  const sent: TxSendInput[] = [];
  const sendTxEmail = vi.fn(async (input: TxSendInput): Promise<TxSendResult> => {
    sent.push(input);
    return { ok: true };
  });
  return {
    sendTxEmail,
    sent,
    reset(): void {
      sent.length = 0;
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

// --- rzuty kolumn (z wygenerowanych definicji, rozluźnione o `null`) --------
type Nullable<
  T extends keyof Database["public"]["Tables"],
  K extends keyof Database["public"]["Tables"][T]["Row"],
> = { [P in K]: Database["public"]["Tables"][T]["Row"][P] | null };

type ProfileProjection = Nullable<"profiles", "email" | "first_name" | "display_name" | "prefs">;
type PlanProjection = Nullable<
  "access_plans",
  "name_pl" | "name_en" | "price_cents" | "currency" | "interval"
>;
type EventProjection = Nullable<
  "events",
  "slug" | "title_pl" | "title_en" | "starts_at" | "location" | "timezone"
>;

const RECIPIENT = "odbiorca@example.com";
const PLAN_ID = "plan-member";
const OTHER_PLAN_ID = "plan-student";

function profileRow(lang: EmailLang = "pl"): ProfileProjection {
  return {
    email: RECIPIENT,
    first_name: "Imie",
    display_name: "Konto Testowe",
    prefs: { language: lang },
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

function eventRow(over: Partial<EventProjection> = {}): EventProjection {
  return {
    slug: "forum-2026",
    title_pl: "Forum Europejskie",
    title_en: "European Forum",
    starts_at: "2026-09-15T09:00:00.000Z",
    location: "Bruksela",
    timezone: "Europe/Brussels",
    ...over,
  };
}

interface Scenario {
  lang?: EmailLang;
  plans?: Record<string, PlanProjection>;
  event?: EventProjection | null;
}

function givenDb(scenario: Scenario = {}): SupabaseFromStub {
  const stub = supabaseFromStub();
  stub.setResponse("profiles", ok(profileRow(scenario.lang ?? "pl")));
  stub.setResponse("newsletter_subscribers", ok(null));
  stub.setResponse("access_plans", (chain) => {
    const planId = chain.argsOf("eq")?.[1];
    const table = scenario.plans ?? { [PLAN_ID]: planRow() };
    return ok(typeof planId === "string" ? (table[planId] ?? null) : null);
  });
  stub.setResponse("events", ok(scenario.event === undefined ? eventRow() : scenario.event));
  db.use(stub);
  return stub;
}

/** Jedyna wysłana wiadomość - zawężenie typu zamiast rzutowania. */
function onlyMail(): TxSendInput {
  expect(mail.sent).toHaveLength(1);
  const first = mail.sent[0];
  if (!first) throw new Error("test: nie wysłano żadnej wiadomości");
  return first;
}

/** Etykiety wierszy szczegółów w kolejności, w jakiej zobaczy je odbiorca. */
function detailLabels(input: TxSendInput): string[] {
  return (input.details ?? []).map((d) => d.label);
}

function detailValue(input: TxSendInput, label: string): string | undefined {
  return (input.details ?? []).find((d) => d.label === label)?.value;
}

/** Prawdziwy słownik etykiet - test nie powtarza napisów z produkcji. */
function labelsOf(kind: TxEmailType, lang: EmailLang = "pl") {
  return txCopy(kind, lang).labels;
}

let errorSpy: MockInstance<typeof console.error>;

beforeEach(() => {
  mail.reset();
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  // Żaden przypadek w tym pliku nie jest ścieżką awaryjną - cichy wyjątek
  // wewnątrz `try/catch` modułu zostałby inaczej niezauważony i test
  // „przechodziłby" na pustej wiadomości.
  expect(errorSpy).not.toHaveBeenCalled();
  errorSpy.mockRestore();
});

describe("zmiana stanu subskrypcji - potwierdzenie", () => {
  it("pokazuje plan, kwotę z cyklem i datę odnowienia", async () => {
    givenDb();
    await notifySubscriptionEmail({
      kind: "subscription_confirmed",
      userId: "user-me",
      planId: PLAN_ID,
      periodEnd: "2026-09-18T10:00:00.000Z",
      idempotencySeed: "ord-1",
    });

    const sent = onlyMail();
    const L = labelsOf("subscription_confirmed");
    expect(sent.type).toBe("subscription_confirmed");
    expect(sent.to).toBe(RECIPIENT);
    expect(sent.subjectName).toBe("Członek");
    expect(detailLabels(sent)).toEqual([L.plan, L.price, L.renewsAt]);
    expect(detailValue(sent, L.price)).toMatch(moneyPattern(4900));
    expect(detailValue(sent, L.price)).toContain("miesięcznie");
    expect(detailValue(sent, L.renewsAt)).toContain("2026");
    expect(sent.ctaPath).toBe("/profile/plan");
    expect(sent.bodyVars?.planName).toBe("Członek");
    expect(sent.bodyVars?.interval).toBe("miesięcznie");
    expect(sent.bodyVars?.accessUntil).toBeNull();
    expect(sent.bodyVars?.prorationAmount).toBeNull();
  });

  it("przy potwierdzeniu NIE pokazuje poprzedniego planu, nawet gdy jest znany", async () => {
    // Potwierdzenie pierwszego zakupu ma mówić o tym, co klient KUPIŁ.
    // Wiersz „poprzedni plan" należy do maili o zmianie planu.
    givenDb({ plans: { [PLAN_ID]: planRow(), [OTHER_PLAN_ID]: planRow({ name_pl: "Student" }) } });
    await notifySubscriptionEmail({
      kind: "subscription_confirmed",
      userId: "user-me",
      planId: PLAN_ID,
      previousPlanId: OTHER_PLAN_ID,
      idempotencySeed: "ord-2",
    });

    const L = labelsOf("subscription_confirmed");
    expect(detailLabels(onlyMail())).not.toContain(L.previousPlan);
    expect(detailLabels(onlyMail())).toContain(L.plan);
  });

  it("brak daty końca okresu nie dokłada pustego wiersza z datą", async () => {
    givenDb();
    await notifySubscriptionEmail({
      kind: "subscription_confirmed",
      userId: "user-me",
      planId: PLAN_ID,
      idempotencySeed: "ord-3",
    });
    const L = labelsOf("subscription_confirmed");
    expect(detailLabels(onlyMail())).toEqual([L.plan, L.price]);
    expect(onlyMail().bodyVars?.renewsAt).toBeNull();
  });
});

describe("zmiana stanu subskrypcji - zmiana planu", () => {
  it("podwyższenie planu pokazuje obie nazwy i dopłatę proporcjonalną", async () => {
    givenDb({
      plans: {
        [PLAN_ID]: planRow(),
        [OTHER_PLAN_ID]: planRow({ name_pl: "Student", price_cents: 1900 }),
      },
    });
    await notifySubscriptionEmail({
      kind: "subscription_upgraded",
      userId: "user-me",
      planId: PLAN_ID,
      previousPlanId: OTHER_PLAN_ID,
      periodEnd: "2026-09-18T10:00:00.000Z",
      prorationCents: 1500,
      idempotencySeed: "sub-1",
    });

    const sent = onlyMail();
    const L = labelsOf("subscription_upgraded");
    expect(detailLabels(sent)).toEqual([L.previousPlan, L.newPlan, L.price, L.renewsAt]);
    expect(detailValue(sent, L.previousPlan)).toBe("Student");
    expect(detailValue(sent, L.newPlan)).toBe("Członek");
    expect(sent.bodyVars?.previousPlanName).toBe("Student");
    expect(sent.bodyVars?.prorationAmount).toMatch(moneyPattern(1500));
  });

  it("podwyższenie bez dopłaty nie wymyśla kwoty proraty", async () => {
    givenDb({ plans: { [PLAN_ID]: planRow(), [OTHER_PLAN_ID]: planRow({ name_pl: "Student" }) } });
    await notifySubscriptionEmail({
      kind: "subscription_upgraded",
      userId: "user-me",
      planId: PLAN_ID,
      previousPlanId: OTHER_PLAN_ID,
      prorationCents: 0,
      idempotencySeed: "sub-2",
    });
    expect(onlyMail().bodyVars?.prorationAmount).toBeNull();
  });

  it("obniżenie planu deklaruje dostęp do końca opłaconego okresu I kolejne odnowienie", async () => {
    // Obniżenie jest jedynym rodzajem, w którym oba zdania są prawdziwe naraz:
    // stary zakres działa do końca okresu, a subskrypcja dalej się odnawia.
    givenDb({ plans: { [PLAN_ID]: planRow(), [OTHER_PLAN_ID]: planRow({ name_pl: "Student" }) } });
    await notifySubscriptionEmail({
      kind: "subscription_downgraded",
      userId: "user-me",
      planId: OTHER_PLAN_ID,
      previousPlanId: PLAN_ID,
      periodEnd: "2026-09-18T10:00:00.000Z",
      idempotencySeed: "sub-3",
    });

    const sent = onlyMail();
    expect(sent.bodyVars?.accessUntil).toContain("2026");
    expect(sent.bodyVars?.renewsAt).toContain("2026");
  });

  it("znany poprzedni plan i NIEZNANY nowy nie tworzy wiersza o pustej nazwie", async () => {
    givenDb({ plans: { [OTHER_PLAN_ID]: planRow({ name_pl: "Student" }) } });
    await notifySubscriptionEmail({
      kind: "subscription_upgraded",
      userId: "user-me",
      planId: "plan-nieistniejacy",
      previousPlanId: OTHER_PLAN_ID,
      amountCents: 9900,
      idempotencySeed: "sub-4",
    });

    const L = labelsOf("subscription_upgraded");
    expect(detailLabels(onlyMail())).toEqual([L.previousPlan, L.price]);
    expect(onlyMail().bodyVars?.planName).toBeNull();
  });
});

describe("zmiana stanu subskrypcji - wygaszenie dostępu", () => {
  it("rezygnacja NIE pokazuje kwoty i prowadzi do cennika, nie do panelu planu", async () => {
    // Kwota w mailu o rezygnacji czyta się jak zapowiedź kolejnego pobrania.
    givenDb();
    await notifySubscriptionEmail({
      kind: "subscription_canceled",
      userId: "user-me",
      planId: PLAN_ID,
      periodEnd: "2026-09-18T10:00:00.000Z",
      amountCents: 4900,
      idempotencySeed: "sub-5",
    });

    const sent = onlyMail();
    const L = labelsOf("subscription_canceled");
    expect(detailLabels(sent)).toEqual([L.plan, L.endsAt]);
    expect(detailValue(sent, L.price)).toBeUndefined();
    expect(sent.ctaPath).toBe("/cennik");
    expect(sent.bodyVars?.renewsAt).toBeNull();
    expect(sent.bodyVars?.accessUntil).toContain("2026");
  });

  it("wstrzymanie też ukrywa kwotę, ale nie obiecuje daty końca dostępu", async () => {
    givenDb();
    await notifySubscriptionEmail({
      kind: "subscription_paused",
      userId: "user-me",
      planId: PLAN_ID,
      periodEnd: "2026-09-18T10:00:00.000Z",
      idempotencySeed: "sub-6",
    });

    const sent = onlyMail();
    const L = labelsOf("subscription_paused");
    expect(detailLabels(sent)).toEqual([L.plan, L.endsAt]);
    expect(sent.ctaPath).toBe("/profile/plan");
    // `accessUntil` opisuje ODEBRANIE dostępu (rezygnacja / obniżenie planu).
    // Wstrzymanie jest odwracalne, więc pozostaje puste.
    expect(sent.bodyVars?.accessUntil).toBeNull();
  });

  it("wznowienie bez planu w bazie bierze kwotę i walutę z wejścia", async () => {
    givenDb({ plans: {} });
    await notifySubscriptionEmail({
      kind: "subscription_resumed",
      userId: "user-me",
      planId: null,
      amountCents: 2500,
      currency: "EUR",
      periodEnd: "2026-09-18T10:00:00.000Z",
      idempotencySeed: "sub-7",
    });

    const sent = onlyMail();
    const L = labelsOf("subscription_resumed");
    expect(detailLabels(sent)).toEqual([L.price, L.renewsAt]);
    expect(detailValue(sent, L.price)).toMatch(moneyPattern(2500));
    expect(detailValue(sent, L.price)).toMatch(/€|EUR/);
    // Bez planu nie ma cyklu - kwota nie może udawać ceny okresowej.
    expect(detailValue(sent, L.price)).not.toContain(" / ");
    expect(sent.bodyVars?.interval).toBeNull();
  });
});

describe("kwota, waluta i cykl w mailu o subskrypcji", () => {
  it("kwota z wejścia ma pierwszeństwo przed ceną katalogową planu", async () => {
    // Zdarzenie operatora niesie kwotę FAKTYCZNIE pobraną (rabat, prorata,
    // podatek). Cena z cennika jest tylko zapasem.
    givenDb();
    await notifySubscriptionEmail({
      kind: "subscription_renewed",
      userId: "user-me",
      planId: PLAN_ID,
      amountCents: 3900,
      idempotencySeed: "sub-8",
    });
    const L = labelsOf("subscription_renewed");
    expect(detailValue(onlyMail(), L.price)).toMatch(moneyPattern(3900));
  });

  it("bez kwoty w zdarzeniu wchodzi cena planu i jego waluta", async () => {
    givenDb({ plans: { [PLAN_ID]: planRow({ currency: "EUR" }) } });
    await notifySubscriptionEmail({
      kind: "subscription_renewed",
      userId: "user-me",
      planId: PLAN_ID,
      idempotencySeed: "sub-9",
    });
    const L = labelsOf("subscription_renewed");
    expect(detailValue(onlyMail(), L.price)).toMatch(moneyPattern(4900));
    expect(detailValue(onlyMail(), L.price)).toMatch(/€|EUR/);
  });

  it("plan bez ceny i zdarzenie bez kwoty nie tworzą wiersza z kwotą", async () => {
    givenDb({ plans: { [PLAN_ID]: planRow({ price_cents: null }) } });
    await notifySubscriptionEmail({
      kind: "subscription_renewed",
      userId: "user-me",
      planId: PLAN_ID,
      idempotencySeed: "sub-10",
    });
    const L = labelsOf("subscription_renewed");
    expect(detailLabels(onlyMail())).toEqual([L.plan]);
    expect(onlyMail().bodyVars?.amount).toBeNull();
  });

  it("plan bez cyklu pokazuje samą kwotę, bez sufiksu okresu", async () => {
    givenDb({ plans: { [PLAN_ID]: planRow({ interval: null }) } });
    await notifySubscriptionEmail({
      kind: "subscription_renewed",
      userId: "user-me",
      planId: PLAN_ID,
      idempotencySeed: "sub-11",
    });
    const L = labelsOf("subscription_renewed");
    expect(detailValue(onlyMail(), L.price)).not.toContain("/");
    expect(onlyMail().bodyVars?.interval).toBeNull();
  });

  it("cykl roczny po angielsku jest opisany po angielsku", async () => {
    givenDb({ lang: "en", plans: { [PLAN_ID]: planRow({ interval: "year" }) } });
    await notifySubscriptionEmail({
      kind: "subscription_renewed",
      userId: "user-me",
      planId: PLAN_ID,
      idempotencySeed: "sub-12",
    });
    const sent = onlyMail();
    expect(sent.lang).toBe("en");
    expect(sent.bodyVars?.interval).toBe("yearly");
    expect(detailValue(sent, labelsOf("subscription_renewed", "en").price)).toContain("yearly");
  });

  it("brak tłumaczenia nazwy planu spada na wersję polską", async () => {
    givenDb({ lang: "en", plans: { [PLAN_ID]: planRow({ name_en: null }) } });
    await notifySubscriptionEmail({
      kind: "subscription_renewed",
      userId: "user-me",
      planId: PLAN_ID,
      idempotencySeed: "sub-13",
    });
    expect(onlyMail().subjectName).toBe("Członek");
  });

  it("plan bez żadnej nazwy nie blokuje wysyłki", async () => {
    givenDb({ lang: "en", plans: { [PLAN_ID]: planRow({ name_en: null, name_pl: null }) } });
    await notifySubscriptionEmail({
      kind: "subscription_renewed",
      userId: "user-me",
      planId: PLAN_ID,
      idempotencySeed: "sub-14",
    });
    expect(onlyMail().subjectName).toBe("");
    expect(mail.sent).toHaveLength(1);
  });

  it("plan bez waluty w bazie jest liczony w walucie domyślnej", async () => {
    // Kolumna `currency` bywa pusta w planach zakładanych ręcznie. Kwota bez
    // waluty rozsypałaby `Intl.NumberFormat`, więc moduł podstawia PLN.
    givenDb({ plans: { [PLAN_ID]: planRow({ currency: null }) } });
    await notifySubscriptionEmail({
      kind: "subscription_renewed",
      userId: "user-me",
      planId: PLAN_ID,
      idempotencySeed: "sub-16",
    });
    const value = detailValue(onlyMail(), labelsOf("subscription_renewed").price);
    expect(value).toMatch(moneyPattern(4900));
    expect(value).toMatch(/zł|PLN/);
  });

  it("brak identyfikatora planu nie odpytuje katalogu planów", async () => {
    const stub = givenDb();
    await notifySubscriptionEmail({
      kind: "subscription_renewed",
      userId: "user-me",
      planId: null,
      amountCents: 1000,
      idempotencySeed: "sub-15",
    });
    expect(stub.chainsFor("access_plans")).toHaveLength(0);
    expect(detailValue(onlyMail(), labelsOf("subscription_renewed").price)).toMatch(
      moneyPattern(1000),
    );
  });
});

describe("windykacja miękka - nieudane i odzyskane obciążenie", () => {
  it("nieudana płatność podaje datę próby, ponowienia i koniec dostępu", async () => {
    givenDb();
    await notifyPaymentEmail({
      kind: "payment_failed",
      userId: "user-me",
      planId: PLAN_ID,
      amountCents: 4900,
      attemptedAt: "2026-08-20T10:00:00.000Z",
      retryAt: "2026-08-23T10:00:00.000Z",
      accessUntil: "2026-08-30T10:00:00.000Z",
      graceDays: 7,
      idempotencySeed: "inv-1",
    });

    const sent = onlyMail();
    const L = labelsOf("payment_failed");
    expect(detailLabels(sent)).toEqual([L.plan, L.price, L.attemptedAt, L.retryAt, L.accessUntil]);
    expect(sent.bodyVars?.graceDays).toBe(7);
    expect(sent.bodyVars?.retryAt).toContain("2026");
    expect(sent.bodyVars?.accessUntil).toContain("2026");
    expect(sent.ctaPath).toBe("/profile/plan");
  });

  it("nieudana płatność bez dat i bez planu pokazuje tylko to, co wiadomo", async () => {
    givenDb({ plans: {} });
    await notifyPaymentEmail({
      kind: "payment_failed",
      userId: "user-me",
      planId: null,
      idempotencySeed: "inv-2",
    });

    const sent = onlyMail();
    expect(sent.details).toEqual([]);
    expect(sent.subjectName).toBeNull();
    expect(sent.bodyVars?.amount).toBeNull();
    expect(sent.bodyVars?.graceDays).toBeNull();
    expect(sent.bodyVars?.retryAt).toBeNull();
  });

  it("odzyskana płatność opisuje datę jako KOLEJNE ODNOWIENIE, nie jako koniec dostępu", async () => {
    // Ta sama wartość wejściowa, inna etykieta - po zaksięgowaniu płatności
    // data przestaje być terminem odcięcia, a staje się terminem odnowienia.
    givenDb();
    await notifyPaymentEmail({
      kind: "payment_recovered",
      userId: "user-me",
      planId: PLAN_ID,
      attemptedAt: "2026-08-20T10:00:00.000Z",
      retryAt: "2026-08-23T10:00:00.000Z",
      accessUntil: "2026-09-30T10:00:00.000Z",
      idempotencySeed: "inv-3",
    });

    const sent = onlyMail();
    const L = labelsOf("payment_recovered");
    expect(detailLabels(sent)).toEqual([L.plan, L.price, L.renewsAt]);
    expect(detailLabels(sent)).not.toContain(L.attemptedAt);
    expect(detailLabels(sent)).not.toContain(L.retryAt);
  });

  it("odzyskana płatność bez daty nie dokłada wiersza z datą", async () => {
    givenDb();
    await notifyPaymentEmail({
      kind: "payment_recovered",
      userId: "user-me",
      planId: PLAN_ID,
      idempotencySeed: "inv-4",
    });
    const L = labelsOf("payment_recovered");
    expect(detailLabels(onlyMail())).toEqual([L.plan, L.price]);
  });

  it("waluta z wejścia wygrywa z walutą planu", async () => {
    givenDb({ plans: { [PLAN_ID]: planRow({ currency: "PLN" }) } });
    await notifyPaymentEmail({
      kind: "payment_failed",
      userId: "user-me",
      planId: PLAN_ID,
      amountCents: 2500,
      currency: "EUR",
      idempotencySeed: "inv-5",
    });
    expect(detailValue(onlyMail(), labelsOf("payment_failed").price)).toMatch(/€|EUR/);
  });

  it("bez planu i bez waluty kwota jest w walucie domyślnej", async () => {
    givenDb({ plans: {} });
    await notifyPaymentEmail({
      kind: "payment_failed",
      userId: "user-me",
      planId: null,
      amountCents: 2500,
      idempotencySeed: "inv-6",
    });
    const value = detailValue(onlyMail(), labelsOf("payment_failed").price);
    expect(value).toMatch(moneyPattern(2500));
    expect(value).toMatch(/zł|PLN/);
  });
});

describe("zwrot płatności", () => {
  it("pokazuje plan, kwotę zwrotu, numer transakcji i koniec dostępu", async () => {
    givenDb();
    await notifyRefundEmail({
      userId: "user-me",
      planId: PLAN_ID,
      amountCents: 4900,
      transactionId: "txn_syntetyczna_1",
      accessUntil: "2026-08-30T10:00:00.000Z",
      idempotencySeed: "ref-1",
    });

    const sent = onlyMail();
    const L = labelsOf("payment_refunded");
    expect(sent.type).toBe("payment_refunded");
    expect(detailLabels(sent)).toEqual([L.plan, L.price, L.transaction, L.accessUntil]);
    expect(detailValue(sent, L.transaction)).toBe("txn_syntetyczna_1");
  });

  it("BRAK kwoty zwrotu NIE jest zastępowany ceną planu", async () => {
    // Reguła pieniężna: kwota zwrotu jest ustalana przez operatora. Podstawienie
    // ceny cennikowej byłoby komunikatem nieprawdziwym wobec klienta i wobec
    // księgowości - w przeciwieństwie do maili o subskrypcji, tu fallbacku nie ma.
    givenDb();
    await notifyRefundEmail({
      userId: "user-me",
      planId: PLAN_ID,
      idempotencySeed: "ref-2",
    });

    const sent = onlyMail();
    const L = labelsOf("payment_refunded");
    expect(detailLabels(sent)).toEqual([L.plan]);
    expect(detailValue(sent, L.price)).toBeUndefined();
    expect(sent.bodyVars?.amount).toBeNull();
  });

  it("waluta zwrotu bierze się z planu, gdy zdarzenie jej nie niesie", async () => {
    givenDb({ plans: { [PLAN_ID]: planRow({ currency: "EUR" }) } });
    await notifyRefundEmail({
      userId: "user-me",
      planId: PLAN_ID,
      amountCents: 1900,
      idempotencySeed: "ref-3",
    });
    expect(detailValue(onlyMail(), labelsOf("payment_refunded").price)).toMatch(/€|EUR/);
  });

  it("zwrot bez planu i bez waluty używa waluty domyślnej", async () => {
    givenDb({ plans: {} });
    await notifyRefundEmail({
      userId: "user-me",
      planId: null,
      amountCents: 1900,
      idempotencySeed: "ref-4",
    });
    const sent = onlyMail();
    expect(detailValue(sent, labelsOf("payment_refunded").price)).toMatch(/zł|PLN/);
    expect(sent.bodyVars?.accessUntil).toBeNull();
  });
});

describe("przypomnienia o końcu okresu", () => {
  it("przypomnienie o odnowieniu podaje plan, kwotę i datę odnowienia", async () => {
    givenDb();
    await notifyReminderEmail({
      kind: "subscription_renewal_reminder",
      userId: "user-me",
      planId: PLAN_ID,
      periodEnd: "2026-09-18T10:00:00.000Z",
      idempotencySeed: "sub_1:2026-09-18",
    });

    const sent = onlyMail();
    const L = labelsOf("subscription_renewal_reminder");
    expect(detailLabels(sent)).toEqual([L.plan, L.price, L.renewsAt]);
    expect(detailValue(sent, L.price)).toMatch(moneyPattern(4900));
    expect(sent.bodyVars?.interval).toBe("miesięcznie");
  });

  it("przypomnienie o WYGAŚNIĘCIU nie pokazuje kwoty - nic nie zostanie pobrane", async () => {
    givenDb();
    await notifyReminderEmail({
      kind: "subscription_expiring",
      userId: "user-me",
      planId: PLAN_ID,
      periodEnd: "2026-09-18T10:00:00.000Z",
      idempotencySeed: "sub_1:2026-09-18",
    });

    const sent = onlyMail();
    const L = labelsOf("subscription_expiring");
    expect(detailLabels(sent)).toEqual([L.plan, L.endsAt]);
    expect(detailValue(sent, L.price)).toBeUndefined();
  });

  it("plan bez ceny nie dokłada wiersza kwoty do przypomnienia o odnowieniu", async () => {
    givenDb({ plans: { [PLAN_ID]: planRow({ price_cents: null }) } });
    await notifyReminderEmail({
      kind: "subscription_renewal_reminder",
      userId: "user-me",
      planId: PLAN_ID,
      periodEnd: "2026-09-18T10:00:00.000Z",
      idempotencySeed: "sub_2:2026-09-18",
    });
    const L = labelsOf("subscription_renewal_reminder");
    expect(detailLabels(onlyMail())).toEqual([L.plan, L.renewsAt]);
    expect(onlyMail().bodyVars?.amount).toBeNull();
  });

  it("nieznany plan zostawia samą datę - przypomnienie i tak musi dojść", async () => {
    givenDb({ plans: {} });
    await notifyReminderEmail({
      kind: "subscription_expiring",
      userId: "user-me",
      planId: "plan-nieistniejacy",
      periodEnd: "2026-09-18T10:00:00.000Z",
      idempotencySeed: "sub_3:2026-09-18",
    });

    const sent = onlyMail();
    expect(detailLabels(sent)).toEqual([labelsOf("subscription_expiring").endsAt]);
    expect(sent.subjectName).toBeNull();
    expect(sent.bodyVars?.planName).toBeNull();
  });
});

describe("potwierdzenie zapisu na wydarzenie", () => {
  it("płatny bilet niesie termin, miejsce, kwotę, numer biletu i transakcji", async () => {
    givenDb();
    await notifyEventRegistration({
      userId: "user-me",
      eventId: "evt-1",
      amountCents: 15000,
      currency: "EUR",
      transactionId: "txn_syntetyczna_2",
      ticketSeed: "0f1e2d3c4b5a69788796a5b4c3d2e1f0",
      idempotencySeed: "reg-1",
    });

    const sent = onlyMail();
    const L = labelsOf("event_registered");
    expect(sent.type).toBe("event_registered");
    expect(sent.subjectName).toBe("Forum Europejskie");
    expect(detailLabels(sent)).toEqual([
      L.event,
      L.date,
      L.place,
      L.price,
      L.ticketCode,
      L.transaction,
    ]);
    expect(detailValue(sent, L.price)).toMatch(/€|EUR/);
    expect(sent.ctaPath).toBe("/events/forum-2026?ticket=1");
  });

  it("numer biletu jest etykietą, a nie ziarnem - nie da się z niego odczytać zamówienia", async () => {
    // Kod jedzie mailem i w kodzie QR. Gdyby zawierał identyfikator zamówienia,
    // byłby wyciekiem klucza obcego do systemu płatności, a nie etykietą.
    const seed = "0f1e2d3c4b5a69788796a5b4c3d2e1f0";
    givenDb();
    await notifyEventRegistration({
      userId: "user-me",
      eventId: "evt-1",
      ticketSeed: seed,
      idempotencySeed: "reg-2",
    });

    const code = detailValue(onlyMail(), labelsOf("event_registered").ticketCode);
    expect(code).toMatch(/^NES-[0-9A-Z]{4}-[0-9A-Z]{4}$/);
    expect(code).not.toContain(seed);
  });

  it("zapis bezpłatny bez biletu i bez transakcji pokazuje samo wydarzenie", async () => {
    givenDb({
      event: eventRow({ starts_at: null, location: null }),
    });
    await notifyEventRegistration({
      userId: "user-me",
      eventId: "evt-1",
      amountCents: 0,
      idempotencySeed: "reg-3",
    });

    const L = labelsOf("event_registered");
    expect(detailLabels(onlyMail())).toEqual([L.event]);
  });

  it("wydarzenie bez tytułu w obu językach nie blokuje potwierdzenia", async () => {
    givenDb({ event: eventRow({ title_pl: null, title_en: null }) });
    await notifyEventRegistration({
      userId: "user-me",
      eventId: "evt-1",
      idempotencySeed: "reg-8",
    });

    const sent = onlyMail();
    expect(sent.subjectName).toBe("");
    expect(detailValue(sent, labelsOf("event_registered").event)).toBe("");
    expect(mail.sent).toHaveLength(1);
  });

  it("wydarzenie bez adresu strony kieruje na listę wydarzeń", async () => {
    givenDb({ event: eventRow({ slug: null }) });
    await notifyEventRegistration({
      userId: "user-me",
      eventId: "evt-1",
      idempotencySeed: "reg-4",
    });
    expect(onlyMail().ctaPath).toBe("/events");
  });

  it("angielski tytuł dla odbiorcy anglojęzycznego, z zapasem na polski", async () => {
    givenDb({ lang: "en" });
    await notifyEventRegistration({
      userId: "user-me",
      eventId: "evt-1",
      idempotencySeed: "reg-5",
    });
    expect(onlyMail().subjectName).toBe("European Forum");

    mail.reset();
    givenDb({ lang: "en", event: eventRow({ title_en: null }) });
    await notifyEventRegistration({
      userId: "user-me",
      eventId: "evt-1",
      idempotencySeed: "reg-6",
    });
    expect(onlyMail().subjectName).toBe("Forum Europejskie");
  });

  it("cena biletu bez podanej waluty jest w walucie domyślnej", async () => {
    givenDb();
    await notifyEventRegistration({
      userId: "user-me",
      eventId: "evt-1",
      amountCents: 12000,
      idempotencySeed: "reg-7",
    });
    const value = detailValue(onlyMail(), labelsOf("event_registered").price);
    expect(value).toMatch(moneyPattern(12000));
    expect(value).toMatch(/zł|PLN/);
  });
});
