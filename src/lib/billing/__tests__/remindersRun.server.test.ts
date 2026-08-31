// PRZYPOMNIENIA ROZLICZENIOWE - PRZEBIEG CRONA.
//
// PO CO TEN PLIK. `reminders.test.ts` dowodzi dwóch czystych funkcji (okno
// czasowe i klucz idempotencji). Sam PRZEBIEG - czyli to, kto dostanie mail,
// kto go nie dostanie i co przebieg o sobie raportuje - nie był dowodzony
// wcale. A to on decyduje o pieniądzach: przypomnienie o odnowieniu wysłane
// klientowi, który już zrezygnował, jest komunikatem nieprawdziwym, a
// przypomnienie NIEWYSŁANE przed automatycznym pobraniem środków to
// reklamacja i podstawa do obciążenia zwrotnego.
//
// GRANICE ATRAPOWANE: klient service_role i wysyłka poczty. Świadomie NIE
// atrapujemy `@/lib/billing/notifications.server` ani
// `@/lib/billing/purchaseEffects.server` - to sąsiedzi w tej samej warstwie,
// a przebieg przypomnień polega właśnie na ich prawdziwym zachowaniu
// (odwzorowanie ceny operatora na plan, ustalenie odbiorcy i języka).
// Atrapa sąsiada dowiodłaby wyłącznie tego, że atrapa działa.
//
// RODO: adresy w domenie `example.com`; klucz przypomnienia (trafia do logów
// i do `email_send_log`) ma osobną asercję, że nie niesie adresu ani
// identyfikatora użytkownika.
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";

import type { Database } from "@/integrations/supabase/types";
import type { TxSendInput, TxSendResult } from "@/lib/email/transactional.server";
import { ok, fail, supabaseFromStub, type SupabaseFromStub } from "@/test/billing/fixtures";

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
  let thrown: Error | null = null;
  const sendTxEmail = vi.fn(async (input: TxSendInput): Promise<TxSendResult> => {
    if (thrown) throw thrown;
    sent.push(input);
    return { ok: true };
  });
  return {
    sendTxEmail,
    sent,
    breakProvider(error: Error): void {
      thrown = error;
    },
    reset(): void {
      sent.length = 0;
      thrown = null;
      sendTxEmail.mockClear();
    },
  };
});

vi.mock("@/lib/email/transactional.server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/email/transactional.server")>();
  return { ...actual, sendTxEmail: mail.sendTxEmail };
});

import {
  REMINDER_LEAD_DAYS,
  reminderWindow,
  runBillingReminders,
} from "@/lib/billing/reminders.server";

// --- dane wejściowe ---------------------------------------------------------
type SubscriptionProjection = Pick<
  Database["public"]["Tables"]["subscriptions"]["Row"],
  | "user_id"
  | "price_id"
  | "status"
  | "current_period_end"
  | "cancel_at_period_end"
  | "provider_subscription_id"
>;

type ProfileProjection = {
  [P in "email" | "first_name" | "display_name" | "prefs"]:
    Database["public"]["Tables"]["profiles"]["Row"][P] | null;
};

const NOW = new Date("2026-08-18T10:00:00.000Z");
const RECIPIENT = "odbiorca@example.com";
/** Cena z prawdziwego katalogu (`BILLING_CATALOG`) - inaczej mapowanie planu nie zadziała. */
const KNOWN_PRICE = "plus_monthly";

function subscriptionRow(over: Partial<SubscriptionProjection> = {}): SubscriptionProjection {
  return {
    user_id: "user-me",
    price_id: KNOWN_PRICE,
    status: "active",
    // Dokładnie w oknie dla domyślnego wyprzedzenia liczonego od `NOW`.
    current_period_end: "2026-08-21T12:00:00.000Z",
    cancel_at_period_end: false,
    provider_subscription_id: "sub_syntetyczna_1",
    ...over,
  };
}

const profileRow: ProfileProjection = {
  email: RECIPIENT,
  first_name: "Imie",
  display_name: "Konto Testowe",
  prefs: { language: "pl" },
};

interface Scenario {
  rows?: SubscriptionProjection[] | null;
  /** Błąd zapytania o subskrypcje - jedyna twarda awaria przebiegu. */
  lookupError?: string;
  /** Błąd odwzorowania ceny operatora na plan (`access_plans`). */
  planError?: string;
}

function givenDb(scenario: Scenario = {}): SupabaseFromStub {
  const stub = supabaseFromStub();
  stub.setResponse(
    "subscriptions",
    // `null` jest tu ISTOTNIE różne od pominięcia pola: PostgREST potrafi
    // zwrócić `data: null` bez błędu, a moduł musi to zamienić na pustą listę.
    scenario.lookupError
      ? fail(scenario.lookupError)
      : ok(scenario.rows === undefined ? [] : scenario.rows),
  );
  stub.setResponse("profiles", ok(profileRow));
  stub.setResponse("newsletter_subscribers", ok(null));
  // Tabela planów jest czytana DWA razy i w dwóch różnych kształtach:
  // najpierw `resolvePlanForPrice` szuka planu po randze katalogowej
  // (tier_key + interval), potem `loadPlan` czyta nazwę i cenę po `id`.
  stub.setResponse("access_plans", (chain) => {
    if (scenario.planError) return fail(scenario.planError);
    const first = chain.argsOf("eq");
    if (first?.[0] === "id") {
      return ok({
        name_pl: "Członek",
        name_en: "Member",
        price_cents: 4900,
        currency: "PLN",
        interval: "month",
      });
    }
    return ok({
      id: "plan-member",
      tenant_id: "tenant-alfa",
      price_cents: 4900,
      currency: "PLN",
    });
  });
  db.use(stub);
  return stub;
}

let errorSpy: MockInstance<typeof console.error>;

beforeEach(() => {
  mail.reset();
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  errorSpy.mockRestore();
});

describe("zakres zapytania o subskrypcje do przypomnienia", () => {
  it("pyta dokładnie o dobę oddaloną o wyprzedzenie i o statusy z dostępem", async () => {
    const stub = givenDb({ rows: [] });
    await runBillingReminders(3, 200, NOW);

    const chain = stub.lastChain("subscriptions");
    const { from, to } = reminderWindow(NOW, 3);
    expect(chain?.argsOf("gte")).toEqual(["current_period_end", from]);
    expect(chain?.argsOf("lt")).toEqual(["current_period_end", to]);
    // Karencja (`past_due`) MUSI być w zestawie: to klient, który ma jeszcze
    // dostęp i którego da się uratować. `canceled` też - jemu należy się
    // przypomnienie o KOŃCU dostępu, nie o odnowieniu.
    expect(chain?.argsOf("in")).toEqual(["status", ["active", "trialing", "past_due", "canceled"]]);
    expect(chain?.argsOf("limit")).toEqual([200]);
  });

  it("okno nigdy nie sięga w PRZESZŁOŚĆ - subskrypcja po terminie nie dostanie przypomnienia", async () => {
    // Dolna granica okna to „teraz + wyprzedzenie", więc nawet przy zerowym
    // wyprzedzeniu przebieg nie sięga po okresy, które już się skończyły.
    // Klient po terminie ma dostać mail o WYGAŚNIĘCIU z innej ścieżki, a nie
    // przypomnienie o zdarzeniu, które już nastąpiło.
    const { from } = reminderWindow(NOW, 0);
    expect(Date.parse(from)).toBe(NOW.getTime());

    const stub = givenDb({ rows: [] });
    await runBillingReminders(0, 50, NOW);
    const args = stub.lastChain("subscriptions")?.argsOf("gte");
    expect(args?.[1]).toBe(NOW.toISOString());
  });

  it("domyślne wyprzedzenie i limit pochodzą ze stałych modułu", async () => {
    const stub = givenDb({ rows: [] });
    await runBillingReminders();

    const chain = stub.lastChain("subscriptions");
    expect(chain?.argsOf("limit")).toEqual([200]);
    const gte = chain?.argsOf("gte")?.[1];
    expect(typeof gte).toBe("string");
    if (typeof gte !== "string") throw new Error("test: brak dolnej granicy okna");
    const aheadDays = (Date.parse(gte) - Date.now()) / 86_400_000;
    expect(aheadDays).toBeGreaterThan(REMINDER_LEAD_DAYS - 0.01);
    expect(aheadDays).toBeLessThan(REMINDER_LEAD_DAYS + 0.01);
  });

  it("błąd odczytu subskrypcji przerywa przebieg głośno", async () => {
    // To jedyna awaria, która MA wywrócić crona: cichy wynik zerowy przy
    // niedostępnej bazie wyglądałby jak „nikt nie wymaga przypomnienia",
    // a cron nie ponowiłby przebiegu.
    givenDb({ lookupError: "connection reset by peer" });
    await expect(runBillingReminders(3, 200, NOW)).rejects.toThrow(/reminder lookup failed/);
  });

  it("pusta odpowiedź bazy daje zerowy wynik, a nie wyjątek", async () => {
    givenDb({ rows: null });
    await expect(runBillingReminders(3, 200, NOW)).resolves.toEqual({
      renewal: 0,
      expiring: 0,
      skipped: 0,
    });
    expect(mail.sendTxEmail).not.toHaveBeenCalled();
  });
});

describe("stan subskrypcji decyduje o TREŚCI przypomnienia", () => {
  it("aktywna subskrypcja dostaje przypomnienie o ODNOWIENIU", async () => {
    givenDb({ rows: [subscriptionRow()] });
    const result = await runBillingReminders(3, 200, NOW);

    expect(result).toEqual({ renewal: 1, expiring: 0, skipped: 0 });
    expect(mail.sent).toHaveLength(1);
    expect(mail.sent[0]?.type).toBe("subscription_renewal_reminder");
    expect(mail.sent[0]?.to).toBe(RECIPIENT);
    // Plan odwzorowany z ceny operatora - w mailu musi być nazwa, nie kod ceny.
    expect(mail.sent[0]?.subjectName).toBe("Członek");
  });

  it("subskrypcja w KARENCJI nadal dostaje przypomnienie o odnowieniu", async () => {
    // `past_due` to klient z nieudanym obciążeniem, który wciąż ma dostęp.
    // Ma jeszcze szansę zaktualizować kartę przed końcem okresu.
    givenDb({ rows: [subscriptionRow({ status: "past_due" })] });
    const result = await runBillingReminders(3, 200, NOW);

    expect(result).toEqual({ renewal: 1, expiring: 0, skipped: 0 });
    expect(mail.sent[0]?.type).toBe("subscription_renewal_reminder");
  });

  it("subskrypcja ANULOWANA dostaje przypomnienie o wygaśnięciu, nie o pobraniu", async () => {
    givenDb({ rows: [subscriptionRow({ status: "canceled" })] });
    const result = await runBillingReminders(3, 200, NOW);

    expect(result).toEqual({ renewal: 0, expiring: 1, skipped: 0 });
    expect(mail.sent[0]?.type).toBe("subscription_expiring");
  });

  it("złożone wypowiedzenie na koniec okresu też oznacza WYGAŚNIĘCIE", async () => {
    // Status u operatora jest jeszcze `active`, ale klient już zrezygnował.
    // Mail „odnowimy Ci subskrypcję" byłby wtedy zapowiedzią pobrania, którego
    // nie będzie - i najczęstszym powodem reklamacji.
    givenDb({ rows: [subscriptionRow({ status: "active", cancel_at_period_end: true })] });
    const result = await runBillingReminders(3, 200, NOW);

    expect(result).toEqual({ renewal: 0, expiring: 1, skipped: 0 });
    expect(mail.sent[0]?.type).toBe("subscription_expiring");
  });

  it("wiersz bez daty końca okresu jest pomijany, bez wysyłki", async () => {
    givenDb({ rows: [subscriptionRow({ current_period_end: null })] });
    const result = await runBillingReminders(3, 200, NOW);

    expect(result).toEqual({ renewal: 0, expiring: 0, skipped: 1 });
    expect(mail.sendTxEmail).not.toHaveBeenCalled();
  });

  it("nieznana cena operatora nie blokuje przypomnienia - data jest ważniejsza niż nazwa planu", async () => {
    const stub = givenDb({ rows: [subscriptionRow({ price_id: "cena_spoza_katalogu" })] });
    const result = await runBillingReminders(3, 200, NOW);

    expect(result).toEqual({ renewal: 1, expiring: 0, skipped: 0 });
    expect(mail.sent[0]?.subjectName).toBeNull();
    // Cena spoza katalogu nie ma czego szukać w `access_plans`.
    expect(stub.chainsFor("access_plans")).toHaveLength(0);
  });

  it("mieszany przebieg rozdziela liczniki po rodzaju przypomnienia", async () => {
    givenDb({
      rows: [
        subscriptionRow({ provider_subscription_id: "sub_1" }),
        subscriptionRow({ provider_subscription_id: "sub_2", status: "trialing" }),
        subscriptionRow({ provider_subscription_id: "sub_3", status: "canceled" }),
        subscriptionRow({ provider_subscription_id: "sub_4", cancel_at_period_end: true }),
        subscriptionRow({ provider_subscription_id: "sub_5", current_period_end: null }),
      ],
    });
    const result = await runBillingReminders(3, 200, NOW);

    expect(result).toEqual({ renewal: 2, expiring: 2, skipped: 1 });
    expect(mail.sent).toHaveLength(4);
  });
});

describe("odporność przebiegu na awarie pojedynczych rekordów", () => {
  it("błąd odwzorowania planu pomija JEDEN rekord i nie przerywa reszty", async () => {
    const stub = supabaseFromStub();
    stub.setResponse(
      "subscriptions",
      ok([
        subscriptionRow({ provider_subscription_id: "sub_zly" }),
        subscriptionRow({ provider_subscription_id: "sub_dobry" }),
      ]),
    );
    stub.setResponse("profiles", ok(profileRow));
    stub.setResponse("newsletter_subscribers", ok(null));
    let planLookups = 0;
    stub.setResponse("access_plans", (chain) => {
      if (chain.argsOf("eq")?.[0] === "id") {
        return ok({
          name_pl: "Członek",
          name_en: "Member",
          price_cents: 4900,
          currency: "PLN",
          interval: "month",
        });
      }
      planLookups += 1;
      // Pierwszy rekord trafia na błąd katalogu planów, drugi już nie.
      if (planLookups === 1) return fail("statement timeout");
      return ok({
        id: "plan-member",
        tenant_id: "tenant-alfa",
        price_cents: 4900,
        currency: "PLN",
      });
    });
    db.use(stub);

    const result = await runBillingReminders(3, 200, NOW);

    expect(result).toEqual({ renewal: 1, expiring: 0, skipped: 1 });
    expect(mail.sent).toHaveLength(1);
    // Ślad w logu MUSI wskazywać KTÓRĄ subskrypcję pominięto - bez tego nie da
    // się dosłać przypomnienia ręcznie.
    const logged = errorSpy.mock.calls.flat().map(String).join(" ");
    expect(logged).toContain("sub_zly");
    // RODO: identyfikator operatora tak, adres odbiorcy nie.
    expect(logged).not.toContain(RECIPIENT);
  });

  it("odbiorca bez adresu nie dostaje maila i nie wywraca przebiegu", async () => {
    const stub = givenDb({ rows: [subscriptionRow()] });
    stub.setResponse("profiles", ok({ ...profileRow, email: null }));

    await expect(runBillingReminders(3, 200, NOW)).resolves.toBeTruthy();
    expect(mail.sendTxEmail).not.toHaveBeenCalled();
  });
});

describe("idempotencja przypomnień", () => {
  it("klucz jest ten sam w obu przebiegach tej samej doby", async () => {
    // Cron chodzi częściej niż raz dziennie. Deduplikacja żyje w warstwie
    // poczty (`email_send_log`), ale działa TYLKO wtedy, gdy klucz jest
    // stabilny - a stabilność klucza jest własnością TEGO modułu.
    givenDb({ rows: [subscriptionRow({ current_period_end: "2026-08-21T06:00:00.000Z" })] });
    await runBillingReminders(3, 200, NOW);

    givenDb({ rows: [subscriptionRow({ current_period_end: "2026-08-21T23:30:00.000Z" })] });
    await runBillingReminders(3, 200, NOW);

    expect(mail.sent).toHaveLength(2);
    expect(mail.sent[0]?.idempotencyKey).toBe(mail.sent[1]?.idempotencyKey);
    expect(mail.sent[0]?.idempotencyKey).toBe(
      "subscription_renewal_reminder:sub_syntetyczna_1:2026-08-21",
    );
  });

  it("RODO: klucz przypomnienia nie niesie adresu ani identyfikatora użytkownika", async () => {
    givenDb({ rows: [subscriptionRow()] });
    await runBillingReminders(3, 200, NOW);

    const key = mail.sent[0]?.idempotencyKey ?? "";
    expect(key).not.toContain(RECIPIENT);
    expect(key).not.toContain("example.com");
    expect(key).not.toContain("user-me");
  });
});

describe("awaria dostawcy poczty w trakcie przebiegu", () => {
  it("nie przerywa przebiegu i nie zostawia zapisów w bazie", async () => {
    const stub = givenDb({
      rows: [
        subscriptionRow({ provider_subscription_id: "sub_1" }),
        subscriptionRow({ provider_subscription_id: "sub_2", status: "canceled" }),
      ],
    });
    mail.breakProvider(new Error("mail gateway 502"));

    await expect(runBillingReminders(3, 200, NOW)).resolves.toBeTruthy();

    const writes = stub.chains.filter(
      (c) => c.has("insert") || c.has("update") || c.has("upsert") || c.has("delete"),
    );
    expect(writes).toEqual([]);
  });

  it.fails(
    "DEFEKT: przy padniętej poczcie przebieg raportuje przypomnienia jako wysłane",
    async () => {
      // CO JEST ZŁE. `notifyReminderEmail` jest z założenia fail-soft - łapie
      // każdy wyjątek wysyłki i kończy się bez wartości zwracanej. Pętla
      // `runBillingReminders` inkrementuje `renewal`/`expiring` zaraz PO tym
      // wywołaniu, więc licznik mierzy „ile razy zawołaliśmy wysyłkę", a nie
      // „ile wiadomości poszło". Licznik `skipped`, który istnieje właśnie po
      // to, żeby zgłaszać nieudane rekordy, przy awarii poczty nie rośnie ani
      // razu.
      //
      // DLACZEGO TO RYZYKO. Ten wynik jest JEDYNYM sygnałem zwrotnym dla
      // człowieka: `AdminBillingPanel` pokazuje go zielonym toastem
      // („Przypomnienia: {{renewal}} odnowień, {{expiring}} wygaśnięć"), a
      // handler crona loguje go jako wynik przebiegu. Przy niedostępnej
      // kolejce poczty administrator zobaczy zielony komunikat z liczbą
      // kilkudziesięciu przypomnień, których nikt nie dostał - i nie ma
      // żadnego powodu, żeby cokolwiek sprawdzać. Przypomnienie przed
      // automatycznym pobraniem środków jest przy tym elementem obrony przed
      // obciążeniem zwrotnym, więc jego cicha utrata ma cenę.
      //
      // ZNAM KONTRARGUMENT: licznik można czytać jako „przetworzone rekordy".
      // Nie broni się, bo konsument nazywa go sukcesem wysyłki, a `skipped`
      // istnieje w tym samym wyniku właśnie dla rekordów nieudanych - gdyby
      // chodziło o przetworzenie, ten podział nie miałby sensu.
      //
      // DLACZEGO NIE NAPRAWIAM. Poprawka wymaga zmiany KONTRAKTU sąsiada:
      // `notifyReminderEmail` musiałby zwracać wynik wysyłki (dziś zwraca
      // `void`), a to zmiana produkcyjna dotykająca wszystkich pięciu funkcji
      // powiadomień i ich wywołań w webhookach. Test zostaje jako `it.fails`,
      // żeby naprawa od razu zapaliła się na czerwono i kazała zdjąć znacznik.
      givenDb({ rows: [subscriptionRow()] });
      mail.breakProvider(new Error("mail gateway 502"));

      const result = await runBillingReminders(3, 200, NOW);

      // To przechodzi: żadna wiadomość nie opuściła systemu.
      expect(mail.sent).toEqual([]);
      // ASERCJA DOCELOWA - i ta pada: wynik mówi „wysłano jedno".
      expect(result).toEqual({ renewal: 0, expiring: 0, skipped: 1 });
    },
  );
});
