// Zamknięcie konta od strony rozliczeń (`closeBillingForUser`).
//
// PO CO TEN PLIK ISTNIEJE. Ta jedna funkcja stoi między „użytkownik klika usuń
// konto" a `auth.admin.deleteUser`. Jeśli przepuści choć jedną otwartą
// subskrypcję, po skasowaniu konta NIE MA JUŻ z czym powiązać obciążenia:
// operator dalej ściąga pieniądze z karty osoby, która formalnie nie jest naszym
// klientem, a my nie mamy jak tego cofnąć z aplikacji. Do 31.08.2026 moduł stał
// na okrągłym zerze (0% linii, 0 z 1 funkcji), więc żadna z jego reguł nie była
// dotknięta testem.
//
// CZTERY REGUŁY, KTÓRYCH TEN PLIK PILNUJE:
//   1. zakres - anulujemy WYŁĄCZNIE subskrypcje TEGO użytkownika i TEGO
//      środowiska bramki, i wyłącznie te w statusach otwartych;
//   2. kolejność - NAJPIERW operator, POTEM baza. Odwrotna kolejność zostawia
//      wiersz mówiący „anulowane" przy subskrypcji, która u operatora żyje;
//   3. odmowa operatora ZATRZYMUJE kasowanie konta (rzucamy), zamiast po cichu
//      przejść dalej;
//   4. anulowanie jest NATYCHMIASTOWE (`cancel`), nie „na koniec okresu".
//
// GRANICE, KTÓRE ATRAPUJEMY: klient Supabase, klient operatora płatności
// (`createStripeClient`) i dostawca poczty. PRAWDZIWE zostają
// `subscriptionProvider.server` (w tym `getStripeErrorMessage`), `grant.server`,
// `purchaseEffects.server` i `notifications.server` - to sąsiedzi z tego samego
// modułu, a nie granice systemu.
//
// RODO: adresy wyłącznie example.com / example.org.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fail, ok, supabaseFromStub, type RecordedChain } from "@/test/supabaseChain";

const db = vi.hoisted(() => ({
  current: null as ReturnType<typeof import("@/test/supabaseChain").supabaseFromStub> | null,
}));

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: { from: (table: string) => db.current!.from(table) },
}));

const provider = vi.hoisted(() => ({
  /** Środowiska, dla których zbudowano klienta bramki. */
  envs: [] as unknown[],
  /** Identyfikatory, które realnie poszły do `subscriptions.cancel`. */
  canceled: [] as unknown[],
  /** Identyfikatory, dla których operator ma ODMÓWIĆ. */
  refuse: new Set<string>(),
}));

// Podmieniamy WYŁĄCZNIE budowę klienta. `getStripeErrorMessage` zostaje
// prawdziwy, bo treść odmowy operatora ma dojechać do wywołującego bez zmian.
vi.mock("@/lib/stripe.server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/stripe.server")>();
  return {
    ...actual,
    // BEZ RZUTOWANIA na `Stripe`: atrapa wystawia dokładnie te metody, których
    // dotyka kod produkcyjny, a fabryka `vi.mock` nie wymaga pełnego kształtu
    // SDK. `as unknown as` jest w tym repo pod ratchetem i nie ma po co go tu
    // dokładać - brak metody w atrapie MA być błędem testu.
    createStripeClient: (env: string) => {
      provider.envs.push(env);
      return {
        subscriptions: {
          cancel: (id: string) => {
            if (provider.refuse.has(id)) {
              return Promise.reject(
                Object.assign(new Error(`No such subscription: ${id}`), {
                  type: "invalid_request_error",
                  code: "resource_missing",
                }),
              );
            }
            provider.canceled.push(id);
            return Promise.resolve({ id, status: "canceled" });
          },
        },
      };
    },
  };
});

const mail = vi.hoisted(() => ({
  sent: [] as { type: string; to: string; idempotencyKey: string | undefined }[],
  throws: false,
}));

vi.mock("@/lib/email/transactional.server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/email/transactional.server")>();
  return {
    ...actual,
    sendTxEmail: (input: { type: string; to: string; idempotencyKey?: string }) => {
      if (mail.throws) return Promise.reject(new Error("dostawca poczty nie odpowiada"));
      mail.sent.push({ type: input.type, to: input.to, idempotencyKey: input.idempotencyKey });
      return Promise.resolve({ ok: true });
    },
  };
});

import { closeBillingForUser } from "@/lib/billing/accountClosure.server";

const ME = "11111111-1111-4111-8111-111111111111";
const SOMEONE_ELSE = "22222222-2222-4222-8222-222222222222";
const MY_EMAIL = "zamykane-konto@example.com";
const NOW = new Date("2026-08-31T09:30:00.000Z");
const NOW_ISO = NOW.toISOString();

interface SubRow {
  user_id: string;
  environment: string;
  provider_subscription_id: string | null;
  status: string;
  price_id: string | null;
}

function subscription(overrides: Partial<SubRow> = {}): SubRow {
  return {
    user_id: ME,
    environment: "sandbox",
    provider_subscription_id: "sub_stripe_1",
    status: "active",
    price_id: "plus_monthly",
    ...overrides,
  };
}

interface SeedOptions {
  rows?: SubRow[];
  /** Odczyt bez błędu, ale z `data: null` - PostgREST tak potrafi odpowiedzieć. */
  rowsNull?: boolean;
  /** Odczyt subskrypcji ma paść. */
  lookupError?: boolean;
  /** Zapis statusu subskrypcji ma paść. */
  updateError?: boolean;
  /** Cofnięcie uprawnienia ma paść. */
  revokeError?: boolean;
  /** Odczyt planu do maila ma paść (ścieżka poboczna wewnątrz `try`). */
  planError?: boolean;
  /** Czy profil odbiorcy istnieje (adres do maila potwierdzającego). */
  profileEmail?: string | null;
}

function seed(options: SeedOptions = {}): void {
  const stub = supabaseFromStub();
  const rows = options.rows ?? [subscription()];

  stub.setResponse("subscriptions", (chain: RecordedChain) => {
    if (chain.has("update")) {
      return options.updateError ? fail("subscriptions update denied", "42501") : ok(null);
    }
    if (options.lookupError) return fail("subscriptions read timed out", "57014");
    if (options.rowsNull) return ok(null);
    // Filtrujemy PO TYCH SAMYCH kolumnach, po których filtruje kod - inaczej
    // test „cudzego konta" przechodziłby także wtedy, gdyby filtr zniknął.
    const user = chain.calls.find((c) => c.method === "eq" && c.args[0] === "user_id")?.args[1];
    const env = chain.calls.find((c) => c.method === "eq" && c.args[0] === "environment")?.args[1];
    const statuses = chain.calls.find((c) => c.method === "in" && c.args[0] === "status")?.args[1];
    const allowed = Array.isArray(statuses) ? statuses : [];
    return ok(
      rows.filter((r) => r.user_id === user && r.environment === env && allowed.includes(r.status)),
    );
  });

  stub.setResponse("user_subscriptions", () =>
    options.revokeError ? fail("entitlement revoke denied", "42501") : ok([{ id: "us-1" }]),
  );

  stub.setResponse("access_plans", (chain: RecordedChain) => {
    const tier = chain.calls.find((c) => c.method === "eq" && c.args[0] === "tier_key")?.args[1];
    if (typeof tier === "string") {
      if (options.planError) return fail("plan lookup exploded", "57014");
      return ok({
        id: `plan-${tier}`,
        tenant_id: "tenant-alfa",
        price_cents: 4900,
        currency: "PLN",
      });
    }
    return ok({
      name_pl: "Członek",
      name_en: "Member",
      price_cents: 4900,
      currency: "PLN",
      interval: "month",
    });
  });

  const profileEmail =
    options.profileEmail === undefined ? "profil-konta@example.org" : options.profileEmail;
  stub.setResponse(
    "profiles",
    ok(
      profileEmail === null
        ? null
        : { email: profileEmail, first_name: "Jan", display_name: null, prefs: {} },
    ),
  );
  stub.setResponse("newsletter_subscribers", ok({ language: "pl" }));

  db.current = stub;
}

/** Łańcuchy zapisu do `subscriptions` - czyli realne zmiany stanu w bazie. */
function updates(): Record<string, unknown>[] {
  return db
    .current!.chainsFor("subscriptions")
    .filter((c) => c.has("update"))
    .map((c) => c.argsOf("update")?.[0])
    .filter((v): v is Record<string, unknown> => !!v && typeof v === "object");
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  provider.envs.length = 0;
  provider.canceled.length = 0;
  provider.refuse.clear();
  mail.sent.length = 0;
  mail.throws = false;
  seed();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

// ===========================================================================
describe("konto Z AKTYWNĄ subskrypcją", () => {
  it("anuluje u operatora, dopiero potem zapisuje stan w bazie", async () => {
    const result = await closeBillingForUser(ME, MY_EMAIL);

    expect(result).toEqual({ canceled: 1, failed: [] });
    expect(provider.canceled).toEqual(["sub_stripe_1"]);
    expect(updates()).toEqual([
      {
        status: "canceled",
        cancel_at_period_end: false,
        trial_ends_at: null,
        updated_at: NOW_ISO,
      },
    ]);
  });

  it("anulowanie jest NATYCHMIASTOWE - nie „na koniec okresu”", async () => {
    // `cancel_at_period_end: false` w zapisie to nie kosmetyka: gdyby zostało
    // `true`, konto zniknęłoby, a subskrypcja żyłaby do końca okresu.
    await closeBillingForUser(ME, MY_EMAIL);

    expect(updates()[0]).toMatchObject({ cancel_at_period_end: false });
    // U operatora poszło `subscriptions.cancel`, a nie `update`.
    expect(provider.canceled).toEqual(["sub_stripe_1"]);
  });

  it("zapis celuje w KONKRETNĄ subskrypcję i KONKRETNE środowisko bramki", async () => {
    await closeBillingForUser(ME, MY_EMAIL);

    const update = db.current!.chainsFor("subscriptions").find((c) => c.has("update"))!;
    const eqs = update.calls.filter((c) => c.method === "eq").map((c) => [c.args[0], c.args[1]]);
    expect(eqs).toEqual([
      ["provider_subscription_id", "sub_stripe_1"],
      ["environment", "sandbox"],
    ]);
  });

  it("odbiera uprawnienie do treści tym samym znacznikiem czasu co zapis statusu", async () => {
    // Jeden moment zamknięcia dla wiersza subskrypcji i dla wiersza uprawnienia:
    // rozjazd tych dat to okno, w którym dostęp „jeszcze trwa" po anulowaniu.
    await closeBillingForUser(ME, MY_EMAIL);

    const revoke = db.current!.lastChain("user_subscriptions")!;
    expect(revoke.argsOf("update")?.[0]).toEqual({
      status: "refunded",
      current_period_end: NOW_ISO,
      canceled_at: NOW_ISO,
    });
    expect(updates()[0]).toMatchObject({ updated_at: NOW_ISO });
  });

  it("wysyła JEDEN mail potwierdzający, ze stabilnym kluczem idempotencji", async () => {
    await closeBillingForUser(ME, MY_EMAIL);

    expect(mail.sent).toEqual([
      {
        type: "subscription_canceled",
        to: "profil-konta@example.org",
        idempotencyKey: "subscription_canceled:account-closure:sub_stripe_1",
      },
    ]);
  });

  it("dwie otwarte subskrypcje są anulowane OBIE", async () => {
    seed({
      rows: [
        subscription({ provider_subscription_id: "sub_a" }),
        subscription({ provider_subscription_id: "sub_b", status: "trialing" }),
      ],
    });

    const result = await closeBillingForUser(ME, MY_EMAIL);

    expect(result).toEqual({ canceled: 2, failed: [] });
    expect(provider.canceled).toEqual(["sub_a", "sub_b"]);
    expect(updates()).toHaveLength(2);
  });

  it("w środowisku produkcyjnym pracujemy na bramce `live`", async () => {
    vi.stubEnv("NODE_ENV", "production");
    seed({ rows: [subscription({ environment: "live" })] });

    const result = await closeBillingForUser(ME, MY_EMAIL);

    expect(result.canceled).toBe(1);
    expect(provider.envs).toEqual(["live"]);
  });
});

// ===========================================================================
describe("konto BEZ otwartej subskrypcji", () => {
  it("brak wierszy - nic nie idzie do operatora i nic nie zmienia się w bazie", async () => {
    seed({ rows: [] });

    const result = await closeBillingForUser(ME, MY_EMAIL);

    expect(result).toEqual({ canceled: 0, failed: [] });
    expect(provider.canceled).toEqual([]);
    expect(updates()).toEqual([]);
    expect(mail.sent).toEqual([]);
  });

  it("odczyt bez błędu, ale z pustym ładunkiem (`null`) kończy się spokojnie", async () => {
    // PostgREST potrafi oddać `data: null` bez błędu. Bez domyślki `?? []`
    // pętla poleciałaby na `null` i zamykanie konta wywaliłoby się na tym,
    // że użytkownik NIE MA żadnej subskrypcji - czyli w najczęstszym przypadku.
    seed({ rowsNull: true });

    const result = await closeBillingForUser(ME, MY_EMAIL);

    expect(result).toEqual({ canceled: 0, failed: [] });
    expect(provider.canceled).toEqual([]);
  });

  it("pyta WYŁĄCZNIE o statusy otwarte - zamknięta subskrypcja nie jest ruszana", async () => {
    seed({ rows: [subscription({ status: "canceled" }), subscription({ status: "incomplete" })] });

    const result = await closeBillingForUser(ME, MY_EMAIL);

    expect(result).toEqual({ canceled: 0, failed: [] });
    const lookup = db.current!.chainsFor("subscriptions").find((c) => !c.has("update"))!;
    expect(lookup.argsOf("in")).toEqual(["status", ["active", "trialing", "past_due", "paused"]]);
  });

  it.each(["past_due", "paused", "trialing"])(
    "status %s liczy się jako OTWARTY i jest anulowany",
    async (status) => {
      seed({ rows: [subscription({ status })] });

      const result = await closeBillingForUser(ME, MY_EMAIL);

      expect(result.canceled).toBe(1);
    },
  );

  it.each([
    ["brak identyfikatora", null],
    ["pusty napis", ""],
    ["identyfikator klienta zamiast subskrypcji", "cus_stripe_1"],
    ["identyfikator ceny", "price_123"],
  ])(
    "wiersz z niepoprawną referencją operatora (%s) jest POMIJANY, nie wysyłany na oślep",
    async (_label, ref) => {
      // Wysłanie `cancel("cus_...")` do operatora to w najlepszym razie błąd,
      // w gorszym - operacja na CUDZYM obiekcie. Filtr `sub_` jest tu bramką.
      seed({ rows: [subscription({ provider_subscription_id: ref })] });

      const result = await closeBillingForUser(ME, MY_EMAIL);

      expect(result).toEqual({ canceled: 0, failed: [] });
      expect(provider.canceled).toEqual([]);
      expect(updates()).toEqual([]);
    },
  );
});

// ===========================================================================
describe("izolacja: CUDZE konto i cudze środowisko", () => {
  it("zapytanie zawęża się do TEGO użytkownika i TEGO środowiska", async () => {
    await closeBillingForUser(ME, MY_EMAIL);

    const lookup = db.current!.chainsFor("subscriptions").find((c) => !c.has("update"))!;
    const eqs = lookup.calls.filter((c) => c.method === "eq").map((c) => [c.args[0], c.args[1]]);
    expect(eqs).toEqual(
      expect.arrayContaining([
        ["user_id", ME],
        ["environment", "sandbox"],
      ]),
    );
  });

  it("subskrypcja INNEGO użytkownika nie jest anulowana przy zamykaniu mojego konta", async () => {
    seed({ rows: [subscription({ user_id: SOMEONE_ELSE, provider_subscription_id: "sub_obcy" })] });

    const result = await closeBillingForUser(ME, MY_EMAIL);

    expect(result).toEqual({ canceled: 0, failed: [] });
    expect(provider.canceled).toEqual([]);
  });

  it("subskrypcja z INNEGO środowiska bramki nie jest ruszana", async () => {
    // Wiersz `live` przy pracy w `sandbox` to nie „nasza" subskrypcja: klucze
    // są rozłączne, a `cancel` poleciałby do niewłaściwej instancji operatora.
    seed({ rows: [subscription({ environment: "live" })] });

    const result = await closeBillingForUser(ME, MY_EMAIL);

    expect(result).toEqual({ canceled: 0, failed: [] });
    expect(provider.canceled).toEqual([]);
  });
});

// ===========================================================================
describe("ODMOWA operatora płatności", () => {
  it("odmowa NIE zapisuje stanu w bazie i NIE odbiera uprawnienia", async () => {
    // Najważniejsza asercja modułu: baza nie może twierdzić „anulowane", gdy
    // u operatora subskrypcja żyje. To byłby cichy, trwały wyciek pieniędzy.
    provider.refuse.add("sub_stripe_1");

    await expect(closeBillingForUser(ME, MY_EMAIL)).rejects.toThrow(
      /Nie udało się anulować aktywnej subskrypcji/,
    );

    expect(updates()).toEqual([]);
    expect(db.current!.chainsFor("user_subscriptions")).toHaveLength(0);
    expect(mail.sent).toEqual([]);
  });

  it("komunikat odmowy jest po polsku i mówi, że KONTO NIE ZOSTAŁO USUNIĘTE", async () => {
    // Ten napis trafia wprost do użytkownika w ekranie usuwania konta, więc
    // jego treść jest częścią kontraktu, nie szczegółem implementacji.
    provider.refuse.add("sub_stripe_1");

    await expect(closeBillingForUser(ME, MY_EMAIL)).rejects.toThrow(/konto nie zostało usunięte/);
  });

  it("jedna odmowa nie blokuje przetworzenia pozostałych subskrypcji", async () => {
    seed({
      rows: [
        subscription({ provider_subscription_id: "sub_zly" }),
        subscription({ provider_subscription_id: "sub_dobry" }),
      ],
    });
    provider.refuse.add("sub_zly");

    // Mimo częściowego sukcesu CAŁA operacja kończy się odmową - kasowanie
    // konta ma się nie odbyć, dopóki choć jedna subskrypcja żyje.
    await expect(closeBillingForUser(ME, MY_EMAIL)).rejects.toThrow(/Nie udało się anulować/);

    expect(provider.canceled).toEqual(["sub_dobry"]);
    expect(updates()).toHaveLength(1);
  });

  it("odmowa wszystkich subskrypcji też kończy się wyjątkiem", async () => {
    seed({
      rows: [
        subscription({ provider_subscription_id: "sub_a" }),
        subscription({ provider_subscription_id: "sub_b" }),
      ],
    });
    provider.refuse.add("sub_a");
    provider.refuse.add("sub_b");

    await expect(closeBillingForUser(ME, MY_EMAIL)).rejects.toThrow(/Nie udało się anulować/);

    expect(provider.canceled).toEqual([]);
    expect(updates()).toEqual([]);
  });
});

// ===========================================================================
describe("awarie bazy", () => {
  it("padnięcie ODCZYTU subskrypcji zatrzymuje zamknięcie z czytelnym powodem", async () => {
    seed({ lookupError: true });

    await expect(closeBillingForUser(ME, MY_EMAIL)).rejects.toThrow(
      "account closure: subscription lookup failed: subscriptions read timed out",
    );
    expect(provider.canceled).toEqual([]);
  });

  it("padnięcie ZAPISU statusu zatrzymuje zamknięcie, mimo udanego anulowania", async () => {
    // Sprzeczność stanu (operator anulował, my nie zapisaliśmy) MUSI być
    // głośna: konto zostaje, a operator zna prawdę - do ręcznego domknięcia.
    seed({ updateError: true });

    await expect(closeBillingForUser(ME, MY_EMAIL)).rejects.toThrow(
      "account closure: subscription update failed: subscriptions update denied",
    );
    expect(provider.canceled).toEqual(["sub_stripe_1"]);
  });

  it("padnięcie ODEBRANIA uprawnienia zatrzymuje zamknięcie", async () => {
    seed({ revokeError: true });

    await expect(closeBillingForUser(ME, MY_EMAIL)).rejects.toThrow(/revoke: user_subscriptions/);
  });
});

// ===========================================================================
describe("mail potwierdzający - ścieżka poboczna, nie krytyczna", () => {
  it("brak adresu = brak maila, ale subskrypcja i tak jest anulowana", async () => {
    const result = await closeBillingForUser(ME, null);

    expect(result).toEqual({ canceled: 1, failed: [] });
    expect(provider.canceled).toEqual(["sub_stripe_1"]);
    expect(mail.sent).toEqual([]);
  });

  it("AWARIA dostawcy poczty NIE cofa anulowania - pieniądze ważniejsze niż mail", async () => {
    mail.throws = true;

    const result = await closeBillingForUser(ME, MY_EMAIL);

    expect(result).toEqual({ canceled: 1, failed: [] });
    expect(updates()).toHaveLength(1);
  });

  it("adres podany w argumencie tylko OTWIERA ścieżkę; odbiorcę bierzemy z profilu", async () => {
    // Kontrakt zaskakujący, więc przypięty testem: `email` działa jak wyłącznik,
    // a rzeczywisty odbiorca pochodzi z `profiles`. Gdyby ktoś kiedyś usunął
    // profil PRZED rozliczeniem, mail przestanie wychodzić mimo podanego adresu
    // (przypadek niżej) - i to jest zachowanie, o którym trzeba wiedzieć.
    await closeBillingForUser(ME, MY_EMAIL);

    expect(mail.sent[0]).toMatchObject({ to: "profil-konta@example.org" });
    expect(mail.sent[0]?.to).not.toBe(MY_EMAIL);
  });

  it("brak profilu = brak maila, mimo podanego adresu - a anulowanie się udaje", async () => {
    seed({ profileEmail: null });

    const result = await closeBillingForUser(ME, MY_EMAIL);

    expect(result).toEqual({ canceled: 1, failed: [] });
    expect(mail.sent).toEqual([]);
  });

  it("wiersz bez `price_id` nie blokuje maila - plan zostaje pusty", async () => {
    seed({ rows: [subscription({ price_id: null })] });

    const result = await closeBillingForUser(ME, MY_EMAIL);

    expect(result.canceled).toBe(1);
    expect(mail.sent[0]).toMatchObject({ type: "subscription_canceled" });
    // Bez ceny nie ma czego mapować na plan - zapytanie o plan nie idzie.
    expect(db.current!.chainsFor("access_plans")).toHaveLength(0);
  });

  it("padnięcie odczytu planu do maila NIE cofa anulowania - mail jest ścieżką poboczną", async () => {
    // Anulowanie u operatora i zapis w bazie już się zdarzyły. Wysypka przy
    // kompletowaniu treści maila nie może ich unieważnić ani wywrócić
    // zamykania konta - to jedyny fragment tej funkcji, który wolno połknąć.
    seed({ planError: true });

    const result = await closeBillingForUser(ME, MY_EMAIL);

    expect(result).toEqual({ canceled: 1, failed: [] });
    expect(updates()).toHaveLength(1);
    expect(mail.sent).toEqual([]);
  });

  it("wynik funkcji NIE niesie adresu ani danych osobowych - same liczniki i referencje", async () => {
    // Wynik wędruje do warstwy usuwania konta i do logów, więc nie ma tam
    // miejsca na adres darczyńcy ani na identyfikator użytkownika.
    const result = await closeBillingForUser(ME, MY_EMAIL);

    expect(Object.keys(result).sort()).toEqual(["canceled", "failed"]);
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("@");
    expect(serialized).not.toContain(ME);
  });
});
