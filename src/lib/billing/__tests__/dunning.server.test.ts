// MIĘKKA WINDYKACJA (`dunning.server`) - co klient dostaje, gdy obciążenie
// karty się nie powiodło, i co dostaje, gdy pieniądze w końcu wpłynęły.
//
// JAKIE RYZYKA PRZYBIJA TEN PLIK (deduplikację dwóch zdarzeń o tej samej
// transakcji pilnuje osobno `dunningDedupe.test.ts`):
//   * KWOTA W MAILU. Zdarzenie operatora nie zawsze niesie kwotę i walutę -
//     mail ma wtedy podać cenę planu WŁASNEGO najemcy, a gdy planu nie ma,
//     nie podawać żadnej kwoty zamiast zmyślonej.
//   * LICZNIK PRÓB. Każda nieudana próba podbija `payment_failure_count`
//     o jeden w wierszu TEGO środowiska (sandbox nie rusza produkcji),
//     a zaksięgowanie płatności go zeruje.
//   * KLUCZ MAILA. Kolejny cykl po odzyskaniu płatności dostaje nowy klucz
//     (log wysyłek nie ma okna czasowego), a bliźniacze zdarzenia jednej
//     transakcji - ten sam.
//   * FAIL-SOFT. Awaria zapisu dzwonka nie może wywrócić webhooka - licznik
//     i mail są już zapisane, więc wyjątek dałby tylko fałszywe `failed`
//     w dzienniku webhooków. Ma zostać w logu. Atrapa modeluje awarię
//     WYJĄTKIEM klienta (Proxy `client.server` bez konfiguracji).
//   * FAIL-LOUD. Odwrotnie z wierszem subskrypcji: błąd odczytu albo zapisu
//     zwrócony jako `{ error }` ma wywrócić webhook PRZED mailem i dzwonkiem,
//     żeby operator ponowił zdarzenie, zamiast udawać „nieznaną subskrypcję”.
//
// ATRAPUJEMY WYŁĄCZNIE GRANICE: klienta roli serwisowej i wysyłkę poczty.
// `resolvePlanForPrice` i `notifications.server` biegną prawdziwym kodem.
// Zegar zamrożony - `updated_at` stempluje „teraz". Adresy syntetyczne.
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { DunningContext } from "@/lib/billing/dunning.server";
import { formatDate, type TxSendInput } from "@/lib/email/transactional.server";
import {
  BILLING_IDS,
  moneyPattern,
  fail,
  ok,
  planLadder,
  supabaseFromStub,
  type RecordedChain,
  type SupabaseFromStub,
  type SupabaseResult,
} from "@/test/billing/fixtures";
import { DZIEN, FIXED_NOW_ISO, GODZINA, freezeClock, relativeIso } from "@/test/time";

const h = vi.hoisted(() => ({
  db: { current: null as { from: (table: string) => unknown } | null },
  emails: [] as unknown[],
}));

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    from: (table: string) => {
      if (!h.db.current) throw new Error("test: atrapa bazy nieustawiona (beforeEach)");
      return h.db.current.from(table);
    },
  },
}));

vi.mock("@/lib/email/transactional.server", async () => {
  const actual = await vi.importActual<typeof import("@/lib/email/transactional.server")>(
    "@/lib/email/transactional.server",
  );
  return {
    ...actual,
    sendTxEmail: (message: unknown) => {
      h.emails.push(message);
      return Promise.resolve({ ok: true });
    },
  };
});

const { applyPaymentFailedEffects, applyPaymentRecoveredEffects, PAYMENT_GRACE_DAYS } =
  await import("@/lib/billing/dunning.server");

freezeClock();

const SUB = "sub_1SyntetycznaWindykacja";

interface SubRow {
  user_id: string;
  tenant_id: string;
  price_id: string;
  current_period_end: string | null;
  payment_failure_count: number;
  last_dunning_transaction_id: string | null;
}

let db: SupabaseFromStub;
let sub: SubRow | null;
let notificationsBroken: boolean;

function eqFilters(chain: RecordedChain): [string, unknown][] {
  return chain.calls
    .filter((call) => call.method === "eq")
    .map((call) => [call.args[0] as string, call.args[1]]);
}

function plansResponder(chain: RecordedChain): SupabaseResult {
  const filters = eqFilters(chain);
  const match = planLadder().filter((plan) =>
    filters.every(
      ([column, value]) => (plan as unknown as Record<string, unknown>)[column] === value,
    ),
  );
  return ok(match[0] ?? null);
}

beforeEach(() => {
  h.emails.length = 0;
  notificationsBroken = false;
  sub = {
    user_id: BILLING_IDS.me,
    tenant_id: BILLING_IDS.tenant,
    price_id: "plus_monthly",
    current_period_end: relativeIso(20 * DZIEN),
    payment_failure_count: 0,
    last_dunning_transaction_id: null,
  };

  db = supabaseFromStub();
  h.db.current = db;
  db.setResponse("subscriptions", (chain) => ok(chain.has("update") || !sub ? null : { ...sub }));
  db.setResponse("access_plans", plansResponder);
  db.setResponse(
    "profiles",
    ok({
      email: "platnik@example.com",
      first_name: "Jan",
      display_name: null,
      prefs: { language: "pl" },
    }),
  );
  db.setResponse("notifications", () => {
    if (notificationsBroken) throw new Error("test: wyjątek klienta (notifications)");
    return ok(null);
  });
});

/** Wiersz subskrypcji sceny - zawsze istnieje, poza przypadkiem „nieznana subskrypcja”. */
function row(): SubRow {
  if (!sub) throw new Error("test: scena bez wiersza subskrypcji");
  return sub;
}

function context(overrides: Partial<DunningContext> = {}): DunningContext {
  return {
    subscriptionId: SUB,
    environment: "live",
    occurredAt: relativeIso(-1 * DZIEN),
    transactionId: "txn_1",
    ...overrides,
  };
}

function subscriptionUpdate() {
  const chain = db.chainsFor("subscriptions").find((c) => c.has("update"));
  return {
    patch: chain?.argsOf("update")?.[0] as Record<string, unknown> | undefined,
    filters: chain ? eqFilters(chain) : [],
  };
}

function mails(): TxSendInput[] {
  return h.emails as TxSendInput[];
}

function notification() {
  const chain = db.chainsFor("notifications").find((c) => c.has("insert"));
  return chain?.argsOf("insert")?.[0] as Record<string, unknown> | undefined;
}

// ---------------------------------------------------------------------------

describe.each([
  { nazwa: "applyPaymentFailedEffects", apply: applyPaymentFailedEffects },
  { nazwa: "applyPaymentRecoveredEffects", apply: applyPaymentRecoveredEffects },
])("$nazwa - subskrypcja nieznana w tym środowisku", ({ apply }) => {
  it("nie zapisuje licznika, nie wysyła maila i nie dzwoni", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    sub = null;

    await apply(context({ environment: "sandbox" }));

    const lookup = db.chainsFor("subscriptions")[0];
    expect(lookup ? eqFilters(lookup) : []).toEqual([
      ["provider_subscription_id", SUB],
      ["environment", "sandbox"],
    ]);
    expect(db.chainsFor("subscriptions").filter((c) => c.has("update"))).toHaveLength(0);
    expect(mails()).toHaveLength(0);
    expect(db.chainsFor("notifications")).toHaveLength(0);
    warn.mockRestore();
  });
});

describe.each([
  { nazwa: "applyPaymentFailedEffects", apply: applyPaymentFailedEffects },
  { nazwa: "applyPaymentRecoveredEffects", apply: applyPaymentRecoveredEffects },
])("$nazwa - awaria bazy przy wierszu subskrypcji", ({ apply }) => {
  it("awaria ODCZYTU wiersza to błąd webhooka, a nie „nieznana subskrypcja”", async () => {
    // PostgREST nie rzuca - zwraca `{ data: null, error }`. Potraktowanie tego
    // jak braku wiersza kończyło webhook jako `processed`, więc operator nie
    // ponawiał, a klient tracił mail i licznik bez śladu. Wyjątek oznacza
    // zdarzenie jako `failed` i wraca przy kolejnej dostawie.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    db.setResponse("subscriptions", fail("canceling statement due to statement timeout", "57014"));

    await expect(apply(context())).rejects.toThrow(/statement timeout/);

    expect(warn).not.toHaveBeenCalled();
    expect(db.chainsFor("subscriptions").filter((c) => c.has("update"))).toHaveLength(0);
    expect(mails()).toHaveLength(0);
    expect(db.chainsFor("notifications")).toHaveLength(0);
    warn.mockRestore();
  });

  it("awaria ZAPISU licznika przerywa obsługę przed mailem i dzwonkiem", async () => {
    // Niezapisany licznik i klucz deduplikacji psują KOLEJNE zdarzenie (drugi
    // dzwonek dla bliźniaczego `past_due`, kolizja klucza maila). Ponowienie
    // jest bezpieczne właśnie dlatego, że nic jeszcze nie wyszło do klienta.
    row().payment_failure_count = 1;
    db.setResponse("subscriptions", (chain) =>
      chain.has("update") ? fail("could not serialize access", "40001") : ok({ ...row() }),
    );

    await expect(apply(context())).rejects.toThrow(/could not serialize access/);

    expect(mails()).toHaveLength(0);
    expect(db.chainsFor("notifications")).toHaveLength(0);
  });
});

describe("applyPaymentFailedEffects - nieudane obciążenie", () => {
  it("zdarzenie bez kwoty i waluty: licznik +1 w wierszu tego środowiska, mail z ceną planu najemcy", async () => {
    row().payment_failure_count = 1;
    const ctx = context({ retryAt: relativeIso(3 * DZIEN) });

    await applyPaymentFailedEffects(ctx);

    const { patch, filters } = subscriptionUpdate();
    expect(patch).toEqual({
      payment_failure_count: 2,
      last_payment_failed_at: ctx.occurredAt,
      last_dunning_transaction_id: "txn_1",
      last_dunning_at: ctx.occurredAt,
      updated_at: FIXED_NOW_ISO,
    });
    expect(filters).toEqual([
      ["provider_subscription_id", SUB],
      ["environment", "live"],
    ]);

    expect(mails()).toHaveLength(1);
    const [mail] = mails();
    expect(mail).toMatchObject({ type: "payment_failed", to: "platnik@example.com" });
    // Klucz idempotencji to subskrypcja + nieudana transakcja, NIE numer próby
    // (licznik zeruje się po odzyskaniu płatności, więc numer wracałby
    // w kolejnym cyklu - patrz test „porażka w KOLEJNYM cyklu”).
    expect(mail?.idempotencyKey).toBe(`payment_failed:${SUB}:txn_1`);
    expect(mail?.bodyVars).toMatchObject({ planName: "Członek", graceDays: PAYMENT_GRACE_DAYS });
    expect(mail?.bodyVars?.amount).toMatch(moneyPattern(4900));
    // Termin kolejnej próby ze zdarzenia, a dostęp do końca OPŁACONEGO okresu
    // z wiersza subskrypcji - dwie różne daty, których nie wolno zamienić.
    expect(mail?.bodyVars?.retryAt).toBe(formatDate(relativeIso(3 * DZIEN), "pl"));
    expect(mail?.bodyVars?.accessUntil).toBe(formatDate(relativeIso(20 * DZIEN), "pl"));

    expect(notification()).toEqual({
      user_id: BILLING_IDS.me,
      tenant_id: BILLING_IDS.tenant,
      kind: "billing",
      title_pl: "Płatność nie powiodła się",
      title_en: "Payment failed",
      body_pl: "Zaktualizuj metodę płatności, żeby zachować dostęp bez przerwy.",
      body_en: "Update your payment method to keep uninterrupted access.",
      href: "/profile/plan",
      icon: "credit-card",
    });
  });

  it("porażka w KOLEJNYM cyklu po odzyskaniu płatności dostaje nowy klucz maila", async () => {
    // Wiersz żyje jak w bazie: zapis licznika zmienia to, co czyta następne
    // zdarzenie. Odzyskanie zeruje licznik, więc klucz oparty na numerze próby
    // wracał w każdym cyklu, a log wysyłek (bez okna czasowego) uznawał
    // pierwszą porażkę nowego cyklu za duplikat - klient nie dostawał maila.
    db.setResponse("subscriptions", (chain) => {
      if (chain.has("update")) {
        Object.assign(row(), chain.argsOf("update")?.[0]);
        return ok(null);
      }
      return ok({ ...row() });
    });

    await applyPaymentFailedEffects(
      context({ transactionId: "txn_lipiec", occurredAt: relativeIso(-60 * DZIEN) }),
    );
    await applyPaymentRecoveredEffects(
      context({ transactionId: "txn_lipiec", occurredAt: relativeIso(-58 * DZIEN) }),
    );
    await applyPaymentFailedEffects(
      context({ transactionId: "txn_wrzesien", occurredAt: relativeIso(-1 * DZIEN) }),
    );

    const keys = mails()
      .filter((mail) => mail.type === "payment_failed")
      .map((mail) => mail.idempotencyKey);
    expect(keys).toEqual([
      `payment_failed:${SUB}:txn_lipiec`,
      `payment_failed:${SUB}:txn_wrzesien`,
    ]);
  });

  it("bliźniacze zdarzenia tej samej transakcji przetwarzane równolegle dają JEDEN klucz maila", async () => {
    // `payment_failed` i `past_due` mogą przyjść naraz: oba czytają wiersz
    // przed zapisem drugiego, więc deduplikacja po wierszu ich nie złapie.
    // Wyścig modeluje atrapa, która NIE utrwala zapisu (drugie zdarzenie widzi
    // wiersz sprzed pierwszego), więc wywołania mogą iść po kolei. Ostatnią
    // zaporą jest wtedy wspólny klucz maila (ta sama transakcja). Zdarzenia
    // mają RÓŻNE chwile, bo tak je stempluje operator - klucz oparty na czasie
    // zdarzenia dałby tu dwa różne maile.
    await applyPaymentFailedEffects(
      context({ transactionId: "txn_1", occurredAt: relativeIso(-2 * GODZINA) }),
    );
    await applyPaymentFailedEffects(
      context({ transactionId: "txn_1", occurredAt: relativeIso(-1 * GODZINA) }),
    );

    expect(mails()).toHaveLength(2);
    expect(mails().map((mail) => mail.idempotencyKey)).toEqual([
      `payment_failed:${SUB}:txn_1`,
      `payment_failed:${SUB}:txn_1`,
    ]);
  });

  it("pusty identyfikator transakcji (zaślepka mapowania) nie skleja kluczy maila kolejnych porażek", async () => {
    // Mapowanie faktury Stripe daje "" przy braku identyfikatora. Deduplikacja
    // traktuje "" jak brak, więc klucz maila też musi - inaczej stały klucz
    // `<sub>:` uznałby każdą następną porażkę za duplikat już wysłanego maila.
    const pierwsza = context({ transactionId: "", occurredAt: relativeIso(-30 * DZIEN) });
    const druga = context({ transactionId: "", occurredAt: relativeIso(-1 * DZIEN) });

    await applyPaymentFailedEffects(pierwsza);
    await applyPaymentFailedEffects(druga);

    expect(mails().map((mail) => mail.idempotencyKey)).toEqual([
      `payment_failed:${SUB}:${pierwsza.occurredAt}`,
      `payment_failed:${SUB}:${druga.occurredAt}`,
    ]);
  });

  it("kwota i waluta ze zdarzenia wygrywają z ceną planu", async () => {
    await applyPaymentFailedEffects(context({ amountCents: 12345, currency: "EUR" }));

    expect(mails()[0]?.bodyVars?.amount).toMatch(moneyPattern(12345));
    expect(mails()[0]?.bodyVars?.amount).toMatch(/€|EUR/);
  });

  it("cena bez planu w najemcy: mail idzie bez planu i bez zmyślonej kwoty", async () => {
    row().price_id = "educator_monthly";

    await applyPaymentFailedEffects(context());

    expect(mails()).toHaveLength(1);
    expect(mails()[0]?.bodyVars).toMatchObject({ planName: null, amount: null });
    expect(mails()[0]?.subjectName).toBeNull();
  });

  it("zdarzenie bez identyfikatora transakcji nie jest deduplikowane, a klucz zapisuje się jako NULL", async () => {
    // Poprzednia próba zostawiła klucz - brak identyfikatora w nowym zdarzeniu
    // nie może jej „dopasować” i połknąć.
    row().last_dunning_transaction_id = "txn_poprzednia";

    const ctx = context({ transactionId: undefined });

    await applyPaymentFailedEffects(ctx);

    expect(subscriptionUpdate().patch).toMatchObject({
      payment_failure_count: 1,
      last_dunning_transaction_id: null,
    });
    expect(mails()).toHaveLength(1);
    // Bez identyfikatora obciążenie identyfikuje chwila zdarzenia.
    expect(mails()[0]?.idempotencyKey).toBe(`payment_failed:${SUB}:${ctx.occurredAt}`);
  });

  it("awaria zapisu dzwonka zostaje w logu i nie wywraca webhooka", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    notificationsBroken = true;

    await expect(applyPaymentFailedEffects(context())).resolves.toBeUndefined();

    expect(error).toHaveBeenCalledWith(
      "[payments] dunning notification failed",
      expect.objectContaining({ message: "test: wyjątek klienta (notifications)" }),
    );
    expect(subscriptionUpdate().patch).toMatchObject({ payment_failure_count: 1 });
    expect(mails()).toHaveLength(1);
    error.mockRestore();
  });
});

describe("applyPaymentRecoveredEffects - płatność zaksięgowana po porażce", () => {
  it("zeruje licznik i klucz deduplikacji, wysyła potwierdzenie z ceną planu i dzwoni", async () => {
    row().payment_failure_count = 2;
    row().last_dunning_transaction_id = "txn_1";
    const ctx = context({ occurredAt: relativeIso(-2 * GODZINA) });

    await applyPaymentRecoveredEffects(ctx);

    const { patch, filters } = subscriptionUpdate();
    expect(patch).toEqual({
      payment_failure_count: 0,
      last_payment_failed_at: null,
      last_payment_at: ctx.occurredAt,
      last_dunning_transaction_id: null,
      updated_at: FIXED_NOW_ISO,
    });
    expect(filters).toEqual([
      ["provider_subscription_id", SUB],
      ["environment", "live"],
    ]);

    expect(mails()[0]).toMatchObject({
      type: "payment_recovered",
      idempotencyKey: `payment_recovered:${SUB}:${ctx.occurredAt}`,
    });
    expect(mails()[0]?.bodyVars?.amount).toMatch(moneyPattern(4900));
    expect(mails()[0]?.bodyVars?.accessUntil).toBe(formatDate(relativeIso(20 * DZIEN), "pl"));
    expect(notification()).toMatchObject({
      title_pl: "Płatność zaksięgowana",
      title_en: "Payment received",
      icon: "badge-check",
    });
  });

  it("kwota ze zdarzenia wygrywa, a cena bez planu nie dokłada nazwy planu", async () => {
    row().payment_failure_count = 1;
    row().price_id = "educator_monthly";

    await applyPaymentRecoveredEffects(context({ amountCents: 1900, currency: "PLN" }));

    expect(mails()[0]?.bodyVars?.planName).toBeNull();
    expect(mails()[0]?.bodyVars?.amount).toMatch(moneyPattern(1900));
  });

  it("cena bez planu i zdarzenie bez kwoty: potwierdzenie bez zmyślonej kwoty", async () => {
    row().payment_failure_count = 1;
    row().price_id = "educator_monthly";

    await applyPaymentRecoveredEffects(context());

    expect(mails()[0]?.bodyVars).toMatchObject({ planName: null, amount: null });
  });

  it("płatność bez wcześniejszej porażki zeruje stan, ale nie wysyła „odzyskano”", async () => {
    await applyPaymentRecoveredEffects(context());

    expect(subscriptionUpdate().patch).toMatchObject({ payment_failure_count: 0 });
    expect(mails()).toHaveLength(0);
    expect(db.chainsFor("notifications")).toHaveLength(0);
  });

  it("awaria zapisu dzwonka po odzyskaniu płatności zostaje w logu", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    row().payment_failure_count = 1;
    notificationsBroken = true;

    await expect(applyPaymentRecoveredEffects(context())).resolves.toBeUndefined();

    expect(error).toHaveBeenCalledWith(
      "[payments] dunning notification failed",
      expect.objectContaining({ message: "test: wyjątek klienta (notifications)" }),
    );
    expect(mails()).toHaveLength(1);
    error.mockRestore();
  });
});
