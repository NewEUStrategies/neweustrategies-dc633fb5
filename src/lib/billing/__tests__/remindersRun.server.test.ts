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
// GRANICE ATRAPOWANE: klient service_role, wysyłka poczty, katalog najemców
// (`tenants.domain` - z niego PRAWDZIWY `tenantPublicUrl` składa host linku
// w przypomnieniu) i odczyt ŻYWEJ subskrypcji u operatora (kwota, którą
// operator pobierze przy odnowieniu - `renewalListCharge`). Świadomie NIE
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

const operator = vi.hoisted(() => ({ renewalListCharge: vi.fn() }));
vi.mock("@/lib/billing/subscriptionProvider.server", () => ({
  renewalListCharge: operator.renewalListCharge,
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

// Katalog najemców: dwie organizacje z własnymi domenami - przypomnienie ma
// prowadzić na host najemcy SUBSKRYPCJI, nie na domenę marki.
vi.mock("@/lib/server/tenant.server", () => {
  const entries = [
    { id: "tenant-alfa", slug: "alfa", domain: "alfa.example.com", isDefault: true },
    { id: "tenant-beta", slug: "beta", domain: "beta.example.com", isDefault: false },
  ];
  return {
    getTenantDirectory: () =>
      Promise.resolve({
        byDomain: new Map(entries.map((entry) => [entry.domain, entry])),
        defaultTenant: entries[0],
      }),
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
  | "tenant_id"
  | "price_id"
  | "status"
  | "current_period_end"
  | "cancel_at_period_end"
  | "provider_subscription_id"
  // Kotwica karencji i ostatnia zapłata - z nich wynika, czy anulowanie było
  // za brak płatności (dostęp skończyła karencja, nie koniec okresu).
  | "current_period_start"
  | "first_payment_failed_at"
  | "last_payment_at"
  // Potwierdzenie zakupu - bez niego i bez zapłaty subskrypcja nigdy nie
  // dawała dostępu (porzucone 3DS), więc nie ma czego „kończyć".
  | "purchase_confirmed_at"
>;

/** Wiersz z kluczem kursora - przebieg stronicuje `ORDER BY id`. */
type SubscriptionProjectionWithId = SubscriptionProjection & { id: string };

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
    // Najemca subskrypcji zawęża odwzorowanie ceny na plan (`resolvePlanForPrice`).
    tenant_id: "tenant-alfa",
    price_id: KNOWN_PRICE,
    status: "active",
    // Dokładnie w oknie dla domyślnego wyprzedzenia liczonego od `NOW`.
    current_period_end: "2026-08-21T12:00:00.000Z",
    cancel_at_period_end: false,
    provider_subscription_id: "sub_syntetyczna_1",
    current_period_start: "2026-07-21T12:00:00.000Z",
    first_payment_failed_at: null,
    last_payment_at: "2026-07-21T12:00:00.000Z",
    purchase_confirmed_at: "2026-06-21T12:01:00.000Z",
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
  operator.renewalListCharge.mockReset().mockResolvedValue(null);
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
    const inFilters = chain?.calls.filter((c) => c.method === "in").map((c) => c.args);
    expect(inFilters).toContainEqual(["status", ["active", "trialing", "past_due", "canceled"]]);
    expect(chain?.argsOf("limit")).toEqual([200]);
  });

  // PRZEGLĄD 1.5 / 7.8 (S9). Produkcja trzyma subskrypcje piaskownicy jako
  // ŚLAD KSIĘGOWY (`environment = 'sandbox'`) z prawdziwym `user_id`
  // z metadanych karty testowej. Bez filtra środowiska cron wysyłał realnemu
  // klientowi „Twoja subskrypcja się odnawia" za plan, którego nie kupił.
  //
  // Po scaleniu z SUB-08 przebieg obejmuje JEDNO środowisko (domyślnie
  // `resolveEnvironment` - na produkcji zawsze `live`, patrz blok „przebieg
  // platformowy" niżej), a bramka `environmentGrantsAccess` pilnuje, żeby
  // jawne `sandbox` na produkcji nie wysłało niczego. Dawne asercje na filtr
  // `in("environment", [...])` zastąpiło `eq` z bloku SUB-08 - tu zostaje
  // bramka, której tamten blok nie dowodzi.
  describe("środowisko wdrożenia (S9)", () => {
    afterEach(() => {
      vi.unstubAllEnvs();
    });

    it("produkcja + jawne `sandbox`: ani jednego zapytania, ani jednego maila", async () => {
      vi.stubEnv("NODE_ENV", "production");
      const stub = givenDb({ rows: [subscriptionRow()] });

      const result = await runBillingReminders(3, 200, NOW, "sandbox");

      expect(result).toEqual({ renewal: 0, expiring: 0, skipped: 0 });
      expect(stub.chainsFor("subscriptions")).toHaveLength(0);
      expect(mail.sendTxEmail).not.toHaveBeenCalled();
    });

    it("podgląd i dev: jawne `sandbox` przechodzi - karta testowa dostaje przypomnienie", async () => {
      vi.stubEnv("NODE_ENV", "development");
      const stub = givenDb({ rows: [] });

      await runBillingReminders(3, 200, NOW, "sandbox");

      expect(stub.lastChain("subscriptions")?.argsOf("eq")).toEqual(["environment", "sandbox"]);
    });
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

  it("kwota w przypomnieniu pochodzi z ŻYWEJ subskrypcji, nie z cennika w bazie", async () => {
    // Po zmianie cennika `access_plans` ma 49 zł (fikstura), a subskrypcja
    // odnawia się po swojej starej cenie 59 zł - mail podaje 59 zł.
    operator.renewalListCharge.mockResolvedValue({ amountCents: 5900, currency: "PLN" });
    givenDb({ rows: [subscriptionRow()] });
    await runBillingReminders(3, 200, NOW, "live");

    expect(operator.renewalListCharge).toHaveBeenCalledWith("live", "sub_syntetyczna_1");
    const sent = mail.sent[0];
    expect(sent?.bodyVars?.amount).toMatch(/59[.,]00/);
    expect(JSON.stringify(sent?.details)).not.toMatch(/49[.,]00/);
  });

  it("kwota nieustalona u operatora: przypomnienie wychodzi BEZ kwoty, nie z ceną katalogu", async () => {
    givenDb({ rows: [subscriptionRow()] });
    const result = await runBillingReminders(3, 200, NOW, "live");

    expect(result.renewal).toBe(1);
    expect(mail.sent[0]?.bodyVars?.amount).toBeNull();
    expect(JSON.stringify(mail.sent[0]?.details)).not.toMatch(/49[.,]00/);
  });

  it("przypomnienie o WYGAŚNIĘCIU nie pyta operatora o kwotę", async () => {
    givenDb({ rows: [subscriptionRow({ cancel_at_period_end: true })] });
    await runBillingReminders(3, 200, NOW, "live");

    expect(mail.sent[0]?.type).toBe("subscription_expiring");
    expect(operator.renewalListCharge).not.toHaveBeenCalled();
  });

  it("plan szukany jest W NAJEMCY subskrypcji i w jawnej kolejności", async () => {
    // Katalog cen jest jeden na konto operatora, plany są per najemca. Bez
    // filtra `tenant_id` i `ORDER BY` mail dostawał nazwę planu dowolnego
    // najemcy z tym samym progiem (audyt wyd. 11/12).
    const stub = givenDb({ rows: [subscriptionRow()] });
    await runBillingReminders(3, 200, NOW);

    const lookup = stub
      .chainsFor("access_plans")
      .find((chain) => chain.calls.some((c) => c.method === "eq" && c.args[0] === "tier_key"));
    expect(lookup?.calls.filter((c) => c.method === "eq").map((c) => c.args)).toContainEqual([
      "tenant_id",
      "tenant-alfa",
    ]);
    expect(lookup?.calls.filter((c) => c.method === "order").map((c) => c.args[0])).toEqual([
      "sort_order",
      "created_at",
      "id",
    ]);
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

  it("przy padniętej poczcie przebieg raportuje przypomnienia jako POMINIĘTE", async () => {
    // CO BYŁO ZŁE (defekt naprawiony 31.08.2026). `notifyReminderEmail` jest
    // z założenia fail-soft - łapie każdy wyjątek wysyłki i kończył się bez
    // wartości zwracanej. Pętla `runBillingReminders` inkrementowała
    // `renewal`/`expiring` zaraz PO tym wywołaniu, więc licznik mierzył „ile
    // razy zawołaliśmy wysyłkę", a nie „ile wiadomości poszło". Licznik
    // `skipped`, który istnieje właśnie po to, żeby zgłaszać nieudane rekordy,
    // przy awarii poczty nie rósł ani razu.
    //
    // JAKIE TO BYŁO RYZYKO. Ten wynik jest JEDYNYM sygnałem zwrotnym dla
    // człowieka: `AdminBillingPanel` pokazuje go zielonym toastem
    // („Przypomnienia: {{renewal}} odnowień, {{expiring}} wygaśnięć"), a
    // handler crona loguje go jako wynik przebiegu. Przy niedostępnej kolejce
    // poczty administrator widział zielony komunikat z liczbą kilkudziesięciu
    // przypomnień, których nikt nie dostał - i nie miał żadnego powodu, żeby
    // cokolwiek sprawdzać. Przypomnienie przed automatycznym pobraniem środków
    // jest przy tym elementem obrony przed obciążeniem zwrotnym, więc jego
    // cicha utrata ma cenę.
    //
    // KONTRARGUMENT (licznik można czytać jako „przetworzone rekordy") nie
    // bronił się, bo konsument nazywa go sukcesem wysyłki, a `skipped` istnieje
    // w tym samym wyniku właśnie dla rekordów nieudanych - gdyby chodziło
    // o przetworzenie, ten podział nie miałby sensu.
    //
    // JAK NAPRAWIONE. Pięć funkcji powiadomień oddaje teraz wynik wysyłki
    // (`true` = wiadomość trafiła do dostawcy), a przebieg przypomnień liczy
    // rekord bez wysyłki jako `skipped` i zostawia ślad w logu. Wywołania
    // w webhookach wyniku nie czytają - kontrakt jest wstecznie zgodny.
    givenDb({ rows: [subscriptionRow()] });
    mail.breakProvider(new Error("mail gateway 502"));

    const result = await runBillingReminders(3, 200, NOW);

    // Żadna wiadomość nie opuściła systemu...
    expect(mail.sent).toEqual([]);
    // ...i wynik przebiegu mówi dokładnie to samo.
    expect(result).toEqual({ renewal: 0, expiring: 0, skipped: 1 });
  });
});

describe("przebieg platformowy - środowisko, kolejność, kursor (SUB-08)", () => {
  /** Wiersze z identyfikatorami - kursor keyset przesuwa się po `id`. */
  function rowsWithIds(count: number): SubscriptionProjectionWithId[] {
    return Array.from({ length: count }, (_, index) => ({
      ...subscriptionRow({ provider_subscription_id: `sub_${index + 1}` }),
      id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
    }));
  }

  /**
   * Atrapa stronicowania: odpowiada partią `limit` wierszy o `id` większym od
   * kursora (`gt`) - tak, jak zrobiłby to PostgREST dla `ORDER BY id`.
   */
  function givenPagedDb(all: SubscriptionProjectionWithId[]): SupabaseFromStub {
    const stub = givenDb({ rows: [] });
    stub.setResponse("subscriptions", (chain) => {
      const after = chain.argsOf("gt")?.[1];
      const limit = Number(chain.argsOf("limit")?.[0] ?? 0);
      const page = all
        .filter((row) => typeof after !== "string" || row.id > after)
        .sort((a, b) => (a.id < b.id ? -1 : 1))
        .slice(0, limit);
      return ok(page);
    });
    return stub;
  }

  it("filtruje ŚRODOWISKO rozstrzygnięte po stronie serwera (poza produkcją: piaskownica)", async () => {
    const stub = givenDb({ rows: [] });
    await runBillingReminders(3, 200, NOW);

    expect(stub.lastChain("subscriptions")?.argsOf("eq")).toEqual(["environment", "sandbox"]);
  });

  it("w PRODUKCJI przebieg bierze wyłącznie `live` - klienci testowi nie dostają maili", async () => {
    vi.stubEnv("NODE_ENV", "production");
    try {
      const stub = givenDb({ rows: [] });
      await runBillingReminders(3, 200, NOW);

      expect(stub.lastChain("subscriptions")?.argsOf("eq")).toEqual(["environment", "live"]);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("jawne środowisko wywołującego wygrywa z domyślnym", async () => {
    const stub = givenDb({ rows: [] });
    await runBillingReminders(3, 200, NOW, "live");

    expect(stub.lastChain("subscriptions")?.argsOf("eq")).toEqual(["environment", "live"]);
  });

  it("partie mają deterministyczną kolejność `ORDER BY id`", async () => {
    // `limit 200` bez `ORDER BY` oddawało przy każdym przebiegu INNY wycinek
    // okna - część klientów nie dostawała przypomnienia wcale.
    const stub = givenDb({ rows: [] });
    await runBillingReminders(3, 200, NOW);

    expect(stub.lastChain("subscriptions")?.argsOf("order")).toEqual(["id", { ascending: true }]);
    expect(stub.lastChain("subscriptions")?.has("gt")).toBe(false);
  });

  it("przebieg czyta WSZYSTKIE rekordy z okna, partia po partii, kursorem po `id`", async () => {
    const all = rowsWithIds(5);
    const stub = givenPagedDb(all);

    const result = await runBillingReminders(3, 2, NOW);

    // 2 + 2 + 1 - ostatnia, niepełna partia kończy przebieg.
    expect(result).toEqual({ renewal: 5, expiring: 0, skipped: 0 });
    expect(mail.sent).toHaveLength(5);
    const chains = stub.chainsFor("subscriptions");
    expect(chains).toHaveLength(3);
    expect(chains[0]?.has("gt")).toBe(false);
    expect(chains[1]?.argsOf("gt")).toEqual(["id", all[1]?.id]);
    expect(chains[2]?.argsOf("gt")).toEqual(["id", all[3]?.id]);
    // Żaden rekord nie został obsłużony dwa razy.
    const keys = mail.sent.map((m) => m.idempotencyKey);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("pełna OSTATNIA partia kończy się jednym pustym odczytem, nie pętlą", async () => {
    const stub = givenPagedDb(rowsWithIds(4));

    const result = await runBillingReminders(3, 2, NOW);

    expect(result.renewal).toBe(4);
    expect(stub.chainsFor("subscriptions")).toHaveLength(3);
  });

  it("bezpiecznik partii: po 1000 pełnych partiach przebieg przerywa się głośno, bez 1001. odczytu", async () => {
    // Sufit chroni przed defektem, w którym kursor rośnie, ale okno nie ma
    // końca. Wiersze bez daty końca okresu są pomijane bez poczty, więc
    // tysiąc partii po jednym wierszu biegnie szybko.
    const all = rowsWithIds(1001).map((row) => ({ ...row, current_period_end: null }));
    const stub = givenPagedDb(all);

    await expect(runBillingReminders(3, 1, NOW)).rejects.toThrow(/more than 1000 batches/);

    expect(stub.chainsFor("subscriptions")).toHaveLength(1000);
    expect(mail.sendTxEmail).not.toHaveBeenCalled();
  });

  it("kursor, który się nie przesuwa, przerywa przebieg głośno", async () => {
    // Defekt bazy/atrapy oddający w kółko tę samą partię nie może zamienić
    // crona w nieskończoną wysyłkę tych samych maili.
    const same = rowsWithIds(2);
    givenDb({ rows: same });

    await expect(runBillingReminders(3, 2, NOW)).rejects.toThrow(/cursor did not advance/);
  });
});

describe("przypomnienie niesie najemcę SWOJEJ subskrypcji", () => {
  it("host linku i najemca wysyłki pochodzą z `subscriptions.tenant_id`", async () => {
    // Przebieg jest platformowy i biegnie bez nagłówka hosta. Bez najemcy
    // subskrypcji link prowadził na domenę marki, a redakcja i lista
    // wykluczeń były rozstrzygane z samego adresu.
    givenDb({
      rows: [
        subscriptionRow({ provider_subscription_id: "sub_alfa", tenant_id: "tenant-alfa" }),
        subscriptionRow({ provider_subscription_id: "sub_beta", tenant_id: "tenant-beta" }),
      ],
    });

    await runBillingReminders(3, 200, NOW);

    expect(mail.sent.map((m) => m.tenantId)).toEqual(["tenant-alfa", "tenant-beta"]);
    expect(mail.sent.map((m) => new URL(String(m.ctaUrl)).origin)).toEqual([
      "https://alfa.example.com",
      "https://beta.example.com",
    ]);
    expect(new URL(String(mail.sent[0]?.ctaUrl)).pathname).toBe("/profile/plan");
  });
});

describe("ręczny przebieg z innym wyprzedzeniem NIE zużywa klucza przypomnienia (SUB-08)", () => {
  it("leadDays=30 i standardowe 3 dni dają RÓŻNE klucze dla tej samej daty granicznej", async () => {
    // Scenariusz z audytu: przebieg ręczny z `leadDays = 30` zjadał klucz
    // idempotencji, więc właściwe przypomnienie 3 dni przed odnowieniem już
    // nie wychodziło (dostawca poczty odrzucał je jako duplikat).
    const periodEnd = "2026-09-17T12:00:00.000Z";
    givenDb({ rows: [subscriptionRow({ current_period_end: periodEnd })] });
    await runBillingReminders(30, 200, NOW);

    givenDb({ rows: [subscriptionRow({ current_period_end: periodEnd })] });
    await runBillingReminders(REMINDER_LEAD_DAYS, 200, new Date("2026-09-14T10:00:00.000Z"));

    expect(mail.sent).toHaveLength(2);
    expect(mail.sent[0]?.idempotencyKey).toBe(
      "subscription_renewal_reminder:sub_syntetyczna_1:2026-09-17:lead30",
    );
    expect(mail.sent[1]?.idempotencyKey).toBe(
      "subscription_renewal_reminder:sub_syntetyczna_1:2026-09-17",
    );
  });
});

// PRZYPOMNIENIE O WYGAŚNIĘCIU MÓWI PRAWDĘ O KOŃCU DOSTĘPU. Anulowanie za brak
// płatności zostawia w `subscriptions` koniec NIEOPŁACONEGO okresu operatora,
// a dostęp skończyła karencja (SUB-03, `accessPeriodFromEvent`). Przebieg
// wysyłał takiemu klientowi 3 dni przed tą datą „Twoja subskrypcja została
// anulowana, a dostęp zakończy się 21 sierpnia - wznów ją" - choć dostęp
// zgasł 4 sierpnia. To samo dla wypowiedzenia złożonego w trakcie windykacji.
describe("przypomnienie o wygaśnięciu tylko wtedy, gdy dostęp kończy się w oknie", () => {
  /** Odnowienie 21.07 nie przeszło - karencja 14 dni minęła 04.08, przed oknem. */
  const NIEOPLACONE_ODNOWIENIE = {
    current_period_start: "2026-07-21T12:00:00.000Z",
    first_payment_failed_at: "2026-07-21T12:05:00.000Z",
    last_payment_at: "2026-06-21T12:00:00.000Z",
  } as const;

  it("przebieg czyta kolumny, z których wynika koniec dostępu", async () => {
    const stub = givenDb({ rows: [] });
    await runBillingReminders(3, 200, NOW);

    const columns = String(stub.lastChain("subscriptions")?.argsOf("select")?.[0]);
    for (const column of ["current_period_start", "first_payment_failed_at", "last_payment_at"]) {
      expect(columns).toContain(column);
    }
  });

  it("anulowanie za brak płatności: dostęp zgasł z karencją - żadnego maila i żadnego licznika", async () => {
    givenDb({ rows: [subscriptionRow({ status: "canceled", ...NIEOPLACONE_ODNOWIENIE })] });

    const result = await runBillingReminders(3, 200, NOW);

    // Rekord nie jest „pominięty" (to sygnał awarii dla człowieka) - po prostu
    // nie jest należny: koniec dostępu nie wypada w oknie przypomnienia.
    expect(result).toEqual({ renewal: 0, expiring: 0, skipped: 0 });
    expect(mail.sendTxEmail).not.toHaveBeenCalled();
  });

  it("wypowiedzenie złożone w trakcie windykacji: koniec dostępu wyznacza karencja, nie okres", async () => {
    givenDb({
      rows: [
        subscriptionRow({
          status: "past_due",
          cancel_at_period_end: true,
          ...NIEOPLACONE_ODNOWIENIE,
        }),
      ],
    });

    const result = await runBillingReminders(3, 200, NOW);

    expect(result).toEqual({ renewal: 0, expiring: 0, skipped: 0 });
    expect(mail.sendTxEmail).not.toHaveBeenCalled();
  });

  it("zaległość zapłacona przed anulowaniem to rezygnacja - dostęp do końca okresu, przypomnienie wychodzi", async () => {
    // Kotwica karencji została, ale zapłata pokrywa bieżący okres
    // (`paymentCoversPeriod`) - to nie jest anulowanie za brak płatności.
    givenDb({
      rows: [
        subscriptionRow({
          status: "canceled",
          ...NIEOPLACONE_ODNOWIENIE,
          last_payment_at: "2026-07-25T09:00:00.000Z",
        }),
      ],
    });

    const result = await runBillingReminders(3, 200, NOW);

    expect(result).toEqual({ renewal: 0, expiring: 1, skipped: 0 });
    expect(mail.sent[0]?.type).toBe("subscription_expiring");
  });

  it("karencja sięgająca końca okresu: dostęp kończy się w oknie, przypomnienie wychodzi", async () => {
    // Pierwsza porażka 10.08 - karencja do 24.08 jest ucięta końcem okresu
    // 21.08, więc data w mailu jest prawdziwa.
    givenDb({
      rows: [
        subscriptionRow({
          status: "canceled",
          ...NIEOPLACONE_ODNOWIENIE,
          first_payment_failed_at: "2026-08-10T12:00:00.000Z",
        }),
      ],
    });

    const result = await runBillingReminders(3, 200, NOW);

    expect(result).toEqual({ renewal: 0, expiring: 1, skipped: 0 });
  });

  it("nieczytelna data końca okresu nie wyłącza przypomnienia - reguły nie da się policzyć", async () => {
    givenDb({
      rows: [subscriptionRow({ cancel_at_period_end: true, current_period_end: "nie-data" })],
    });

    const result = await runBillingReminders(3, 200, NOW);

    expect(result).toEqual({ renewal: 0, expiring: 1, skipped: 0 });
  });

  it("zaległość bez wypowiedzenia nadal dostaje przypomnienie o ODNOWIENIU (operator ponowi obciążenie)", async () => {
    givenDb({ rows: [subscriptionRow({ status: "past_due", ...NIEOPLACONE_ODNOWIENIE })] });

    const result = await runBillingReminders(3, 200, NOW);

    expect(result).toEqual({ renewal: 1, expiring: 0, skipped: 0 });
  });
});

// SUBSKRYPCJA NIGDY NIEOPŁACONA NIE MA DOSTĘPU, KTÓRY MOGŁABY STRACIĆ.
// Porzucone 3DS (albo nieudana pierwsza płatność) zostawia wiersz `incomplete`
// z okresem liczonym od checkoutu - przy planie rocznym rok naprzód. Jego
// anulowanie webhook rozpoznaje po braku potwierdzenia zakupu I braku zapłaty
// (`cancellationAccess`, „nigdy nieopłacona") i nie daje dostępu ani maila.
// Przebieg przypomnień tego nie wiedział: 3 dni przed końcem nieopłaconego
// okresu klient, który nigdy nie zapłacił, dostawał „Twoja subskrypcja została
// anulowana, a dostęp zakończy się ... - wznów subskrypcję".
describe("przypomnienie o wygaśnięciu nie trafia do subskrypcji nigdy nieopłaconej", () => {
  /** Checkout 21.07, płatność nie przeszła - ani potwierdzenia, ani zapłaty. */
  const NIGDY_NIEOPLACONA = {
    status: "canceled",
    current_period_start: "2026-07-21T12:00:00.000Z",
    first_payment_failed_at: null,
    last_payment_at: null,
    purchase_confirmed_at: null,
  } as const;

  it("przebieg czyta potwierdzenie zakupu - bez niego nie odróżni rezygnacji od porzuconego checkoutu", async () => {
    const stub = givenDb({ rows: [] });
    await runBillingReminders(3, 200, NOW);

    const columns = String(stub.lastChain("subscriptions")?.argsOf("select")?.[0]);
    expect(columns).toContain("purchase_confirmed_at");
  });

  it("anulowana bez potwierdzenia zakupu i bez zapłaty: żadnego maila i żadnego licznika", async () => {
    const stub = givenDb({ rows: [subscriptionRow(NIGDY_NIEOPLACONA)] });

    const result = await runBillingReminders(3, 200, NOW);

    // Nie „pominięta" (to sygnał awarii dla człowieka) - po prostu nienależna.
    expect(result).toEqual({ renewal: 0, expiring: 0, skipped: 0 });
    expect(mail.sendTxEmail).not.toHaveBeenCalled();
    // Rekord odpada przed odwzorowaniem planu i odczytem odbiorcy.
    expect(stub.chainsFor("access_plans")).toHaveLength(0);
    expect(stub.chainsFor("profiles")).toHaveLength(0);
  });

  it("potwierdzony zakup bez zaksięgowanej zapłaty (nagrobek opłaconego okresu) nadal dostaje przypomnienie", async () => {
    // Rezygnacja, która wyprzedziła założenie wiersza: operator potwierdził
    // opłacony okres (`purchase_confirmed_at`), a zapłaty nasza baza nie zna.
    givenDb({
      rows: [
        subscriptionRow({
          ...NIGDY_NIEOPLACONA,
          purchase_confirmed_at: "2026-07-21T12:01:00.000Z",
        }),
      ],
    });

    const result = await runBillingReminders(3, 200, NOW);

    expect(result).toEqual({ renewal: 0, expiring: 1, skipped: 0 });
    expect(mail.sent[0]?.type).toBe("subscription_expiring");
  });

  it("zaksięgowana zapłata bez potwierdzenia zakupu to opłacony okres - przypomnienie wychodzi", async () => {
    // Potwierdzenie mogło przepaść (awaria zajęcia), ale pieniądze wpłynęły -
    // ta sama reguła co w webhooku: nigdy nieopłacona to brak OBU sygnałów.
    givenDb({
      rows: [
        subscriptionRow({ ...NIGDY_NIEOPLACONA, last_payment_at: "2026-07-21T12:00:00.000Z" }),
      ],
    });

    const result = await runBillingReminders(3, 200, NOW);

    expect(result).toEqual({ renewal: 0, expiring: 1, skipped: 0 });
  });

  it("wypowiedzenie na koniec okresu bez potwierdzenia nadal dostaje przypomnienie - reguła dotyczy tylko anulowanych", async () => {
    // Subskrypcja aktywna (lub w okresie próbnym) MA dostęp; brak znacznika
    // potwierdzenia przy niej to ponowienie potwierdzenia w toku, nie brak zakupu.
    givenDb({
      rows: [
        subscriptionRow({
          cancel_at_period_end: true,
          last_payment_at: null,
          purchase_confirmed_at: null,
        }),
      ],
    });

    const result = await runBillingReminders(3, 200, NOW);

    expect(result).toEqual({ renewal: 0, expiring: 1, skipped: 0 });
  });
});
