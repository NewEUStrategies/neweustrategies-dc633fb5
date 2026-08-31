// Publiczna warstwa server fn modułu darowizn (`donations.functions.ts`).
//
// PO CO TEN PLIK ISTNIEJE. `createDonationCheckout` jest PUBLICZNY - wpłacić
// można bez konta - więc kwota, waluta, limity i adres powrotu są sprawdzane
// WYŁĄCZNIE po stronie serwera. Do 31.08.2026 plik miał 12% linii i 0% gałęzi,
// czyli żadna z jego odmów nie była dotknięta testem, a każda z nich pilnuje
// czegoś realnego:
//   * kwota poniżej minimum  -> sesje na 1 grosz to darmowy generator obciążeń
//     u operatora (koszt transakcyjny wyższy niż wpłata),
//   * kwota powyżej maksimum -> sufit AML i ochrona przed pomyłką w kwocie,
//   * waluta                 -> zbiórka jest JEDNOWALUTOWA; wpłata w innej
//     walucie rozjeżdża pasek postępu i eksport księgowy,
//   * moduł wyłączony        -> redakcja mogła zbiórkę zamknąć; „wyłączone"
//     musi znaczyć „nie da się wpłacić", a nie tylko „nie widać przycisku".
//
// JAK ASERTUJEMY. Każda odmowa wygląda tak samo z zewnątrz (`{ok:false, error}`),
// więc obok kodu błędu sprawdzamy SKUTEK: czy w `donations` powstał wiersz i czy
// u operatora powstała sesja. Odmowa, która i tak zakłada wiersz „oczekujący",
// zatruwa statystyki publiczne - a te są na stronie głównej.
//
// GRANICE, KTÓRE ATRAPUJEMY: klient Supabase (także konstruktor
// `@supabase/supabase-js`, dzięki czemu ŻADNA ścieżka nie może wyjść do sieci)
// i klient operatora płatności. PRAWDZIWE zostają `donations.server`,
// `donationsConfig` (schemat zod), `checkoutLocale`, `resolveReturnUrl`,
// `rateSubject.server` i wspólny limiter.
//
// RODO: adresy wyłącznie example.com / example.org, a osobna asercja pilnuje,
// że podmiot limitu jest SKRÓTEM, nie surowym adresem IP.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fail, ok, supabaseFromStub, type RecordedChain } from "@/test/supabaseChain";

// --- granica: klient Supabase (jeden obiekt dla admina i dla klienta anon) ---

const db = vi.hoisted(() => {
  const state = {
    current: null as ReturnType<typeof import("@/test/supabaseChain").supabaseFromStub> | null,
    rpcCalls: [] as { fn: string; args: Record<string, unknown> }[],
    rateAllowed: true,
    /** Roszczenia z podpisanego tokenu - `null` = żądanie anonimowe. */
    claims: null as { sub?: string } | null,
  };
  const client = {
    from: (table: string) => state.current!.from(table),
    rpc: (fn: string, args: Record<string, unknown>) => {
      state.rpcCalls.push({ fn, args });
      if (fn === "rate_limit_hit") {
        return Promise.resolve({ data: [{ allowed: state.rateAllowed }], error: null });
      }
      return Promise.resolve({ data: null, error: { message: `unexpected rpc ${fn}` } });
    },
    auth: {
      getClaims: () =>
        Promise.resolve(
          state.claims
            ? { data: { claims: state.claims }, error: null }
            : { data: null, error: null },
        ),
    },
  };
  return { state, client };
});

vi.mock("@/integrations/supabase/client.server", () => ({ supabaseAdmin: db.client }));
// Konstruktor klienta też jest atrapą - to gwarancja „zero sieci" nawet wtedy,
// gdy jakaś ścieżka sięgnie po prawdziwy moduł klienta serwisowego.
vi.mock("@supabase/supabase-js", () => ({ createClient: () => db.client }));

// --- granica: operator płatności --------------------------------------------

const stripe = vi.hoisted(() => ({
  envs: [] as unknown[],
  params: [] as Record<string, unknown>[],
  /** `null` = sesja bez `client_secret` (operator oddał niepełny obiekt). */
  clientSecret: "cs_test_secret" as string | null,
  failWith: null as string | null,
}));

vi.mock("@/lib/stripe.server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/stripe.server")>();
  return {
    ...actual,
    // BEZ RZUTOWANIA na `Stripe` - atrapa niesie wyłącznie realnie używaną
    // metodę otwarcia sesji; `as unknown as` jest w repo pod ratchetem.
    createStripeClient: (env: string) => {
      stripe.envs.push(env);
      return {
        checkout: {
          sessions: {
            create: (params: Record<string, unknown>) => {
              stripe.params.push(params);
              if (stripe.failWith) {
                return Promise.reject(
                  Object.assign(new Error(stripe.failWith), { type: "card_error" }),
                );
              }
              return Promise.resolve({ id: "cs_test_1", client_secret: stripe.clientSecret });
            },
          },
        },
      };
    },
  };
});

// --- granica: kontekst HTTP i katalog najemców ------------------------------

const http = vi.hoisted(() => ({
  request: null as Request | null,
  tenantId: "tenant-alfa" as string | null,
}));

vi.mock("@tanstack/react-start/server", () => ({ getRequest: () => http.request }));
vi.mock("@/lib/server/tenant.server", () => ({
  resolveTenantIdForHost: () => Promise.resolve(http.tenantId),
}));
vi.mock("@/lib/http/requestHost", () => ({
  currentTenantHost: () => Promise.resolve("neweuropeanstrategies.com"),
}));
vi.mock("@tanstack/react-start", async () => {
  const { serverFnStubModule } = await import("@/test/serverFnHarness");
  return serverFnStubModule();
});

import { callServerFn } from "@/test/serverFn";
import {
  createDonationCheckout,
  getDonationsConfig,
  getDonationsPublicStats,
  type DonationCheckoutInput,
  type DonationsPublicStats,
} from "@/lib/billing/donations.functions";
import { DONATIONS_DEFAULTS, type DonationsConfig } from "@/lib/billing/donationsConfig";

const NOW = new Date("2026-08-18T10:00:00.000Z");
const MONTH_START = "2026-08-01T00:00:00.000Z";
const DONOR = "11111111-1111-4111-8111-111111111111";

type CheckoutResult =
  | { ok: true; clientSecret: string; donationId: string }
  | {
      ok: false;
      error: string;
    };

function checkout(overrides: Partial<DonationCheckoutInput> = {}): Promise<CheckoutResult> {
  const data: DonationCheckoutInput = {
    environment: "sandbox",
    amountCents: 5000,
    recurring: false,
    returnUrl: "https://neweuropeanstrategies.com/wsparcie/dziekujemy",
    ...overrides,
  };
  return callServerFn<CheckoutResult>(createDonationCheckout, data, { supabase: null });
}

function stats(): Promise<DonationsPublicStats> {
  return callServerFn<DonationsPublicStats>(getDonationsPublicStats, undefined, {
    supabase: null,
  });
}

function config(): Promise<DonationsConfig> {
  return callServerFn<DonationsConfig>(getDonationsConfig, undefined, { supabase: null });
}

interface DonationRow {
  amount_cents: number;
  currency: string;
  created_at: string;
}

interface SeedOptions {
  /** Wartość zapisana w `site_settings["donations"]`. */
  settings?: unknown;
  settingsError?: boolean;
  /** Wiersze wpłat dla statystyk; funkcja pozwala stronicować. */
  paid?: DonationRow[] | ((offset: number) => DonationRow[]);
  /** Odczyt bez błędu, ale z `data: null` - PostgREST tak potrafi odpowiedzieć. */
  paidNull?: boolean;
  paidError?: boolean;
  insertError?: boolean;
}

function seed(options: SeedOptions = {}): void {
  const stub = supabaseFromStub();

  stub.setResponse("site_settings", () =>
    options.settingsError
      ? fail("site_settings unavailable", "57014")
      : ok(options.settings === undefined ? null : { value: options.settings }),
  );

  stub.setResponse("donations", (chain: RecordedChain) => {
    if (chain.has("insert")) {
      return options.insertError
        ? fail("donations insert denied", "42501")
        : ok({ id: "22222222-2222-4222-8222-222222222222" });
    }
    if (chain.has("update") || chain.has("delete")) return ok(null);
    if (options.paidError) return fail("donations read timed out", "57014");
    if (options.paidNull) return ok(null);
    const range = chain.calls.find((c) => c.method === "range")?.args ?? [];
    const offset = typeof range[0] === "number" ? range[0] : 0;
    const rows = options.paid ?? [];
    return ok(typeof rows === "function" ? rows(offset) : offset === 0 ? rows : []);
  });

  db.state.current = stub;
  db.state.rpcCalls.length = 0;
}

/** Wiersze `donations` wstawione w tym teście - jedyny trwały skutek checkoutu. */
function inserted(): Record<string, unknown>[] {
  return db.state
    .current!.chainsFor("donations")
    .filter((c) => c.has("insert"))
    .map((c) => c.argsOf("insert")?.[0])
    .filter((v): v is Record<string, unknown> => !!v && typeof v === "object");
}

/** Czy osierocony wiersz został skasowany po nieudanej sesji. */
function deletes(): RecordedChain[] {
  return db.state.current!.chainsFor("donations").filter((c) => c.has("delete"));
}

/** Pozycja koszyka wysłana do operatora - tam mieszka kwota i waluta. */
function lineItem(): Record<string, unknown> {
  const items = stripe.params[0]?.line_items;
  const first = Array.isArray(items) ? items[0] : null;
  return first !== null && typeof first === "object" ? { ...first } : {};
}

function priceData(): Record<string, unknown> {
  const value = lineItem().price_data;
  return value !== null && typeof value === "object" ? { ...value } : {};
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  // Wartości syntetyczne - żaden prawdziwy sekret nie występuje w tym pliku.
  vi.stubEnv("SUPABASE_URL", "https://projekt.supabase.test");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service-role-testowy");
  vi.stubEnv("SUPABASE_PUBLISHABLE_KEY", "publishable-testowy");
  stripe.envs.length = 0;
  stripe.params.length = 0;
  stripe.clientSecret = "cs_test_secret";
  stripe.failWith = null;
  db.state.rateAllowed = true;
  db.state.claims = null;
  http.tenantId = "tenant-alfa";
  // `origin` jest w specyfikacji fetch nagłówkiem ZABRONIONYM i implementacja
  // `Request` w środowisku testowym go zdejmuje - dlatego pochodzenie żądania
  // podajemy tak, jak robi to nasz proxy brzegowy: `x-forwarded-*`.
  http.request = new Request("https://neweuropeanstrategies.com/wsparcie", {
    method: "POST",
    headers: {
      "x-forwarded-proto": "https",
      "x-forwarded-host": "neweuropeanstrategies.com",
      "cf-connecting-ip": "203.0.113.9",
    },
  });
  seed();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

// ===========================================================================
// WALIDATOR WEJŚCIA - pierwsza bramka, jeszcze przed bazą
// ===========================================================================
describe("walidator wejścia checkoutu", () => {
  it.each([["produkcja"], ["test"], [""], ["SANDBOX"]])(
    "środowisko %j jest odrzucane - nie ma bramki poza sandbox/live",
    async (environment) => {
      await expect(
        callServerFn(
          createDonationCheckout,
          {
            ...{ amountCents: 5000, recurring: false, returnUrl: "https://x.example.com/" },
            environment,
          },
          { supabase: null },
        ),
      ).rejects.toThrow("invalid_environment");

      expect(db.state.current!.chains).toHaveLength(0);
    },
  );

  it.each([
    ["NaN", Number.NaN],
    ["nieskończoność", Number.POSITIVE_INFINITY],
    ["minus nieskończoność", Number.NEGATIVE_INFINITY],
  ])("kwota %s jest odrzucana przez walidator", async (_label, amountCents) => {
    await expect(checkout({ amountCents })).rejects.toThrow("invalid_amount");

    expect(db.state.current!.chains).toHaveLength(0);
  });

  it.each([
    ["adres względny", "/wsparcie/dziekujemy"],
    ["pusty napis", ""],
    ["śmieci", "nie-jest-adresem"],
  ])("adres powrotu %s jest odrzucany", async (_label, returnUrl) => {
    await expect(checkout({ returnUrl })).rejects.toThrow("invalid_return_url");
  });

  it("adres powrotu innego typu niż napis jest odrzucany", async () => {
    await expect(
      callServerFn(
        createDonationCheckout,
        { environment: "sandbox", amountCents: 5000, recurring: false, returnUrl: 42 },
        { supabase: null },
      ),
    ).rejects.toThrow("invalid_return_url");
  });
});

// ===========================================================================
// ODMOWY: KWOTA
// ===========================================================================
describe("odmowa: kwota poza zakresem zbiórki", () => {
  it.each([
    ["1 grosz", 1],
    ["4,99 zł - tuż pod minimum operatora", 499],
    ["zero", 0],
    ["kwota ujemna", -5000],
  ])("kwota %s odmawia i NIE zakłada wiersza ani sesji", async (_label, amountCents) => {
    const result = await checkout({ amountCents });

    expect(result).toEqual({ ok: false, error: "amount_out_of_range" });
    expect(inserted()).toEqual([]);
    expect(stripe.params).toEqual([]);
  });

  it.each([
    ["ponad domyślny sufit 10 000 zł", 1_000_001],
    ["absurdalnie dużo", 999_999_999],
  ])("kwota %s odmawia i NIE zakłada wiersza ani sesji", async (_label, amountCents) => {
    const result = await checkout({ amountCents });

    expect(result).toEqual({ ok: false, error: "amount_out_of_range" });
    expect(inserted()).toEqual([]);
    expect(stripe.params).toEqual([]);
  });

  it.each([
    ["dokładnie minimum", 500],
    ["dokładnie maksimum", 1_000_000],
  ])("kwota %s PRZECHODZI - granice nie są zaniżone ani zawyżone", async (_l, amountCents) => {
    const result = await checkout({ amountCents });

    expect(result).toMatchObject({ ok: true });
    expect(priceData()).toMatchObject({ unit_amount: amountCents });
  });

  it("kwota ułamkowa jest zaokrąglana do pełnych groszy", async () => {
    // Operator przyjmuje wyłącznie liczby całkowite - `4999.6` bez
    // zaokrąglenia byłoby odrzucone dopiero u operatora, po założeniu wiersza.
    const result = await checkout({ amountCents: 4999.6 });

    expect(result).toMatchObject({ ok: true });
    expect(priceData()).toMatchObject({ unit_amount: 5000 });
    expect(inserted()[0]).toMatchObject({ amount_cents: 5000 });
  });

  it("zaostrzone minimum z ustawień redakcji jest respektowane", async () => {
    seed({ settings: { minCents: 10_000 } });

    const result = await checkout({ amountCents: 5000 });

    expect(result).toEqual({ ok: false, error: "amount_out_of_range" });
  });

  it("ustawienia NIE MOGĄ zejść poniżej twardego minimum operatora", async () => {
    // `minCents: 1` w bazie nie może otworzyć wpłat na grosz - twardy próg
    // 500 gr jest w kodzie, nie w konfiguracji.
    seed({ settings: { minCents: 1 } });

    const result = await checkout({ amountCents: 100 });

    expect(result).toEqual({ ok: false, error: "amount_out_of_range" });
  });

  it("ustawienia NIE MOGĄ podnieść sufitu ponad twarde 50 000 zł", async () => {
    seed({ settings: { maxCents: 900_000_000 } });

    const result = await checkout({ amountCents: 6_000_000 });

    expect(result).toEqual({ ok: false, error: "amount_out_of_range" });
  });
});

// ===========================================================================
// ODMOWY: WALUTA
// ===========================================================================
describe("odmowa: waluta spoza obsługiwanych", () => {
  it("waluta `USD` w ustawieniach jest ODRZUCANA przez schemat - wracamy do PLN", async () => {
    // Kluczowa gałąź: uszkodzony (albo złośliwie podmieniony) wpis ustawień nie
    // może przemycić waluty, której nie obsługujemy - sesja poszłaby wtedy w
    // walucie, której nie umiemy rozliczyć ani pokazać w pasku zbiórki.
    seed({ settings: { currency: "USD" } });

    const result = await checkout();

    expect(result).toMatchObject({ ok: true });
    expect(priceData()).toMatchObject({ currency: "pln" });
    expect(inserted()[0]).toMatchObject({ currency: "PLN" });
  });

  it("EUR jest walutą obsługiwaną i przechodzi do operatora małymi literami", async () => {
    seed({ settings: { currency: "EUR" } });

    const result = await checkout();

    expect(result).toMatchObject({ ok: true });
    expect(priceData()).toMatchObject({ currency: "eur" });
    expect(inserted()[0]).toMatchObject({ currency: "EUR" });
  });

  it("waluty NIE da się podać z klienta - wejście checkoutu nie ma takiego pola", async () => {
    // Dowód przez skutek: nawet gdy do ładunku doklejone jest `currency`,
    // sesja powstaje w walucie ZBIÓRKI, nie w walucie z żądania.
    seed({ settings: { currency: "PLN" } });

    await callServerFn(
      createDonationCheckout,
      {
        environment: "sandbox",
        amountCents: 5000,
        recurring: false,
        returnUrl: "https://neweuropeanstrategies.com/wsparcie/dziekujemy",
        currency: "EUR",
      },
      { supabase: null },
    );

    expect(priceData()).toMatchObject({ currency: "pln" });
  });

  it("uszkodzony wpis ustawień w całości spada do wartości domyślnych", async () => {
    seed({ settings: { currency: 17, presetsCents: "nie-tablica" } });

    const result = await checkout();

    expect(result).toMatchObject({ ok: true });
    expect(priceData()).toMatchObject({ currency: DONATIONS_DEFAULTS.currency.toLowerCase() });
  });
});

// ===========================================================================
// ODMOWY: MODUŁ WYŁĄCZONY
// ===========================================================================
describe("odmowa: moduł darowizn wyłączony albo w trybie zewnętrznym", () => {
  it("`enabled:false` blokuje checkout - nie tylko ukrywa przycisk", async () => {
    seed({ settings: { enabled: false } });

    const result = await checkout();

    expect(result).toEqual({ ok: false, error: "donations_disabled" });
    expect(inserted()).toEqual([]);
    expect(stripe.params).toEqual([]);
  });

  it("tryb zbiórki ZEWNĘTRZNEJ blokuje własny checkout", async () => {
    // W trybie `external` pieniądze idą do zewnętrznej zbiórki; własna sesja
    // powstałaby poza jakąkolwiek ewidencją.
    seed({ settings: { provider: "external" } });

    const result = await checkout();

    expect(result).toEqual({ ok: false, error: "donations_disabled" });
    expect(inserted()).toEqual([]);
  });

  it("wpłata CYKLICZNA przy wyłączonym wsparciu cyklicznym jest odrzucana", async () => {
    seed({ settings: { allowRecurring: false } });

    const result = await checkout({ recurring: true });

    expect(result).toEqual({ ok: false, error: "recurring_disabled" });
    expect(inserted()).toEqual([]);
  });

  it("wpłata JEDNORAZOWA przy wyłączonym cyklu nadal przechodzi", async () => {
    seed({ settings: { allowRecurring: false } });

    const result = await checkout({ recurring: false });

    expect(result).toMatchObject({ ok: true });
  });
});

// ===========================================================================
// ODMOWY: LIMIT, NAJEMCA, BAZA, OPERATOR
// ===========================================================================
describe("odmowa: limit prób, brak najemcy, awarie", () => {
  it("przekroczony limit prób odmawia PRZED założeniem wiersza", async () => {
    db.state.rateAllowed = false;

    const result = await checkout();

    expect(result).toEqual({ ok: false, error: "rate_limited" });
    expect(inserted()).toEqual([]);
    expect(stripe.params).toEqual([]);
  });

  it("limit to 10 prób na 10 minut w zakresie `donation_checkout`", async () => {
    await checkout();

    expect(db.state.rpcCalls[0]).toMatchObject({
      fn: "rate_limit_hit",
      args: { _scope: "donation_checkout", _max: 10, _window_minutes: 10 },
    });
  });

  it("NIEROZPOZNANY najemca odmawia - wpłata nie wpada do najemcy domyślnego", async () => {
    http.tenantId = null;

    const result = await checkout();

    expect(result).toEqual({ ok: false, error: "tenant_unresolved" });
    expect(inserted()).toEqual([]);
    expect(stripe.params).toEqual([]);
  });

  it("padnięcie zapisu wiersza odmawia i NIE otwiera sesji u operatora", async () => {
    seed({ insertError: true });

    const result = await checkout();

    expect(result).toEqual({ ok: false, error: "donation_record_failed" });
    expect(stripe.params).toEqual([]);
  });

  it("odmowa operatora KASUJE osierocony wiersz oczekujący", async () => {
    // Bez tego sprzątania każda nieudana próba zostawiałaby w rejestrze wpłatę
    // „oczekującą", której nikt nigdy nie opłaci - a rejestr zasila publiczne
    // statystyki na stronie głównej.
    stripe.failWith = "Twoja karta została odrzucona.";

    const result = await checkout();

    expect(result).toMatchObject({ ok: false });
    expect(result).toMatchObject({ error: expect.stringContaining("odrzucona") });
    expect(inserted()).toHaveLength(1);
    expect(deletes()).toHaveLength(1);
  });

  it("sesja BEZ `client_secret` też kasuje wiersz - niepełna odpowiedź to awaria", async () => {
    stripe.clientSecret = null;

    const result = await checkout();

    expect(result).toMatchObject({ ok: false });
    expect(deletes()).toHaveLength(1);
  });

  it("awaria odczytu ustawień spada do wartości domyślnych, nie blokuje wpłaty", async () => {
    seed({ settingsError: true });

    const result = await checkout();

    expect(result).toMatchObject({ ok: true });
    expect(priceData()).toMatchObject({ currency: "pln" });
  });
});

// ===========================================================================
// ŚCIEŻKA SZCZĘŚLIWA I BEZPIECZEŃSTWO ADRESU POWROTU
// ===========================================================================
describe("otwarcie kasy - ścieżka szczęśliwa", () => {
  it("zakłada wiersz OCZEKUJĄCY, otwiera sesję i dopina do niej identyfikator sesji", async () => {
    const result = await checkout({ amountCents: 12_300 });

    expect(result).toEqual({
      ok: true,
      clientSecret: "cs_test_secret",
      donationId: "22222222-2222-4222-8222-222222222222",
    });
    expect(inserted()[0]).toMatchObject({
      tenant_id: "tenant-alfa",
      amount_cents: 12_300,
      currency: "PLN",
      provider: "stripe",
      status: "pending",
      recurring: false,
      user_id: null,
    });
    const update = db.state.current!.chainsFor("donations").find((c) => c.has("update"))!;
    expect(update.argsOf("update")?.[0]).toEqual({ provider_session_id: "cs_test_1" });
  });

  it("wiersz oczekujący ma TYMCZASOWY identyfikator sesji, nie pusty", async () => {
    // Kolumna jest unikalna, więc pusty/duplikujący się identyfikator wywracałby
    // każdą drugą próbę wpłaty.
    await checkout();

    expect(String(inserted()[0]?.provider_session_id)).toMatch(/^pending:[0-9a-f-]{36}$/);
  });

  it("wpłata JEDNORAZOWA otwiera sesję w trybie płatności, z opisem dla operatora", async () => {
    await checkout({ recurring: false });

    expect(stripe.params[0]).toMatchObject({ mode: "payment", ui_mode: "embedded_page" });
    expect(stripe.params[0]).toHaveProperty("payment_intent_data");
    expect(priceData()).not.toHaveProperty("recurring");
  });

  it("wpłata CYKLICZNA otwiera subskrypcję miesięczną i przenosi metadane", async () => {
    const result = await checkout({ recurring: true });

    expect(result).toMatchObject({ ok: true });
    expect(stripe.params[0]).toMatchObject({ mode: "subscription" });
    expect(priceData()).toMatchObject({ recurring: { interval: "month" } });
    // Deklaracja trybu zapada już przy checkoucie - panel widzi wpłatę cykliczną
    // nawet wtedy, gdy pierwsza faktura nigdy nie dojdzie.
    expect(inserted()[0]).toMatchObject({ recurring: true });
  });

  it("metadane niosą przeznaczenie i identyfikator wpłaty - webhook nie musi zgadywać", async () => {
    await checkout();

    expect(stripe.params[0]).toMatchObject({
      metadata: { purpose: "donation", donationId: "22222222-2222-4222-8222-222222222222" },
    });
  });

  it("język formularza operatora jest normalizowany, a nieznany spada do polskiego", async () => {
    await checkout({ locale: "en" });
    expect(stripe.params[0]).toMatchObject({ locale: "en" });

    stripe.params.length = 0;
    await checkout();
    expect(stripe.params[0]).toMatchObject({ locale: "pl" });
  });

  it("środowisko bramki pochodzi z wejścia - `live` nie miesza się z `sandbox`", async () => {
    await checkout({ environment: "live" });

    expect(stripe.envs).toEqual(["live"]);
  });
});

describe("adres powrotu - bramka przeciw przekierowaniu na obcą domenę", () => {
  it("obcy host w adresie powrotu jest ODRZUCANY, zostaje sama ścieżka", async () => {
    // Gdyby host klienta przechodził, atakujący przekierowywałby darczyńcę po
    // ZAPŁACIE na swoją stronę - z pełnym kontekstem udanej transakcji.
    await checkout({ returnUrl: "https://zla-domena.example.org/dziekujemy?kwota=100#sekcja" });

    expect(stripe.params[0]).toMatchObject({
      return_url: "https://neweuropeanstrategies.com/dziekujemy?kwota=100#sekcja",
    });
  });

  it("domena powrotu pochodzi z ŻĄDANIA, nie ze stałej w kodzie", async () => {
    // Środowiska podglądowe mają własne domeny - powrót po płatności musi
    // wrócić tam, skąd przyszło żądanie, a nie na produkcję.
    http.request = new Request("https://podglad.example.com/wsparcie", {
      method: "POST",
      headers: { "x-forwarded-proto": "https", "x-forwarded-host": "podglad.example.com" },
    });

    await checkout({ returnUrl: "https://neweuropeanstrategies.com/wsparcie/dziekujemy" });

    expect(stripe.params[0]).toMatchObject({
      return_url: "https://podglad.example.com/wsparcie/dziekujemy",
    });
  });

  it("bez nagłówków pochodzenia wracamy na domenę produkcyjną, nie na adres klienta", async () => {
    http.request = new Request("https://neweuropeanstrategies.com/wsparcie", { method: "POST" });

    await checkout({ returnUrl: "https://zla-domena.example.org/dziekujemy" });

    expect(stripe.params[0]).toMatchObject({
      return_url: "https://neweuropeanstrategies.com/dziekujemy",
    });
  });
});

// ===========================================================================
// RODO: dane darczyńcy i podmiot limitu
// ===========================================================================
describe("RODO: dane darczyńcy w rejestrze wpłat", () => {
  it("adres darczyńcy jest obcinany i sprowadzany do małych liter", async () => {
    await checkout({ donorEmail: "  DarczyNca@Example.COM  " });

    expect(inserted()[0]).toMatchObject({ donor_email: "darczynca@example.com" });
    expect(stripe.params[0]).toMatchObject({ customer_email: "darczynca@example.com" });
  });

  it("pusty adres zapisuje NULL i nie trafia do operatora", async () => {
    await checkout({ donorEmail: "   " });

    expect(inserted()[0]).toMatchObject({ donor_email: null });
    expect(stripe.params[0]).not.toHaveProperty("customer_email");
  });

  it("brak adresu = wpłata w pełni anonimowa", async () => {
    await checkout();

    expect(inserted()[0]).toMatchObject({ donor_email: null, user_id: null });
    expect(stripe.params[0]).not.toHaveProperty("customer_email");
  });

  it("wiadomość od darczyńcy jest przycinana do 500 znaków", async () => {
    await checkout({ message: "  " + "a".repeat(900) + "  " });

    expect(String(inserted()[0]?.message)).toHaveLength(500);
  });

  it("gdy redakcja WYŁĄCZY pole wiadomości, treść od klienta jest odrzucana", async () => {
    seed({ settings: { allowMessage: false } });

    await checkout({ message: "wiadomość, która nie powinna zostać zapisana" });

    expect(inserted()[0]).toMatchObject({ message: null });
  });

  it("BEZ kontekstu HTTP wpłata nadal przechodzi - wspólny kubełek i domena domyślna", async () => {
    // Server fn wywołana poza żądaniem (praca w tle, ponowienie) nie ma
    // nagłówków. Ma wtedy wpaść do jednego wspólnego kubełka limitu, a nie
    // wywrócić się na braku adresu.
    http.request = null;

    const result = await checkout();

    expect(result).toMatchObject({ ok: true });
    expect(String(db.state.rpcCalls[0]?.args._subject)).toMatch(/^ip:[0-9a-f]{32}$/);
    expect(stripe.params[0]).toMatchObject({
      return_url: "https://neweuropeanstrategies.com/wsparcie/dziekujemy",
    });
  });

  it("PODMIOT LIMITU jest SKRÓTEM - surowy adres IP nie trafia do tabeli liczników", async () => {
    // Kontrapunkt do `fx-rate`, gdzie ta sama tabela dostaje adres wprost.
    // Tutaj publiczna ścieżka korzysta z `requestRateSubject`, więc `rate_limits`
    // nie staje się rejestrem odwiedzin.
    await checkout();

    const subject = String(db.state.rpcCalls[0]?.args._subject);
    expect(subject).not.toContain("203.0.113.9");
    expect(subject).toMatch(/^ip:[0-9a-f]{32}$/);
  });

  it("zalogowany darczyńca ma WŁASNY kubełek limitu, nie kubełek adresu", async () => {
    http.request = new Request("https://neweuropeanstrategies.com/wsparcie", {
      method: "POST",
      headers: {
        origin: "https://neweuropeanstrategies.com",
        authorization: "Bearer syntetyczny.token.testowy",
        "cf-connecting-ip": "203.0.113.9",
      },
    });
    db.state.claims = { sub: DONOR };

    await checkout();

    const subject = String(db.state.rpcCalls[0]?.args._subject);
    expect(subject).toMatch(/^user:[0-9a-f]{32}$/);
    expect(subject).not.toContain(DONOR);
  });

  it("zalogowany darczyńca wiąże wpłatę z kontem, anonimowy - nie", async () => {
    http.request = new Request("https://neweuropeanstrategies.com/wsparcie", {
      method: "POST",
      headers: {
        origin: "https://neweuropeanstrategies.com",
        authorization: "Bearer syntetyczny.token.testowy",
      },
    });
    db.state.claims = { sub: DONOR };

    await checkout();

    expect(inserted()[0]).toMatchObject({ user_id: DONOR });
    expect(stripe.params[0]).toMatchObject({ metadata: { userId: DONOR } });
  });

  it("PODROBIONY token (brak roszczeń z weryfikacji) daje wpłatę ANONIMOWĄ, nie cudzą", async () => {
    http.request = new Request("https://neweuropeanstrategies.com/wsparcie", {
      method: "POST",
      headers: {
        origin: "https://neweuropeanstrategies.com",
        authorization: "Bearer podrobiony.token",
      },
    });
    db.state.claims = null;

    await checkout();

    expect(inserted()[0]).toMatchObject({ user_id: null });
    expect(stripe.params[0]?.metadata).not.toHaveProperty("userId");
  });
});

// ===========================================================================
// KONFIGURACJA PUBLICZNA
// ===========================================================================
describe("getDonationsConfig", () => {
  it("oddaje konfigurację zapisaną przez redakcję", async () => {
    seed({ settings: { currency: "EUR", goalCents: 500_000, allowRecurring: false } });

    const result = await config();

    expect(result).toMatchObject({ currency: "EUR", goalCents: 500_000, allowRecurring: false });
  });

  it("brak wpisu w ustawieniach daje wartości domyślne", async () => {
    const result = await config();

    expect(result).toEqual(DONATIONS_DEFAULTS);
  });

  it("AWARIA odczytu daje wartości domyślne, a nie wyjątek na stronie głównej", async () => {
    seed({ settingsError: true });

    await expect(config()).resolves.toEqual(DONATIONS_DEFAULTS);
  });

  it("konfiguracja publiczna NIE niesie żadnych sekretów operatora", async () => {
    const result = await config();
    const keys = Object.keys(result).join(" ").toLowerCase();

    expect(keys).not.toContain("key");
    expect(keys).not.toContain("secret");
    expect(keys).not.toContain("token");
  });
});

// ===========================================================================
// STATYSTYKI PUBLICZNE
// ===========================================================================
describe("getDonationsPublicStats", () => {
  function donation(overrides: Partial<DonationRow> = {}): DonationRow {
    return {
      amount_cents: 5000,
      currency: "PLN",
      created_at: "2026-08-10T12:00:00.000Z",
      ...overrides,
    };
  }

  it("BRAK najemcy daje zera z walutą zbiórki, nie wyjątek", async () => {
    http.tenantId = null;
    seed({ settings: { currency: "EUR" } });

    const result = await stats();

    expect(result).toEqual({
      totalCents: 0,
      monthCents: 0,
      count: 0,
      monthCount: 0,
      currency: "EUR",
      recent: [],
      truncated: false,
    });
    expect(db.state.current!.chainsFor("donations")).toHaveLength(0);
  });

  it("sumuje wpłaty i osobno liczy bieżący miesiąc (granica UTC)", async () => {
    seed({
      paid: [
        donation({ amount_cents: 10_000, created_at: "2026-08-15T00:00:00.000Z" }),
        donation({ amount_cents: 2_500, created_at: MONTH_START }),
        donation({ amount_cents: 7_500, created_at: "2026-07-31T23:59:59.999Z" }),
      ],
    });

    const result = await stats();

    expect(result).toMatchObject({
      totalCents: 20_000,
      count: 3,
      monthCents: 12_500,
      monthCount: 2,
    });
  });

  it("czyta WYŁĄCZNIE wpłaty opłacone, tego najemcy i w walucie zbiórki", async () => {
    // Trzy filtry naraz: brak któregokolwiek pokazałby na stronie głównej cudze
    // pieniądze albo kwoty w innej walucie doliczone do paska postępu.
    seed({ settings: { currency: "EUR" }, paid: [donation({ currency: "EUR" })] });

    await stats();

    const chain = db.state.current!.lastChain("donations")!;
    const eqs = chain.calls.filter((c) => c.method === "eq").map((c) => [c.args[0], c.args[1]]);
    expect(eqs).toEqual([
      ["tenant_id", "tenant-alfa"],
      ["status", "paid"],
      ["currency", "EUR"],
    ]);
  });

  it("lista ostatnich wpłat ma NAJWYŻEJ 5 pozycji i ZERO danych osobowych", async () => {
    seed({ paid: Array.from({ length: 12 }, () => donation()) });

    const result = await stats();

    expect(result.recent).toHaveLength(5);
    for (const entry of result.recent) {
      expect(Object.keys(entry).sort()).toEqual(["amount_cents", "created_at", "currency"]);
    }
    // Zapytanie w ogóle nie prosi o kolumny z danymi osobowymi.
    const selected = String(db.state.current!.lastChain("donations")!.argsOf("select")?.[0]);
    expect(selected).not.toContain("donor_email");
    expect(selected).not.toContain("message");
  });

  it("AWARIA odczytu daje zera zamiast wywrócenia strony głównej", async () => {
    seed({ paidError: true });

    const result = await stats();

    expect(result).toMatchObject({ totalCents: 0, count: 0, recent: [], truncated: false });
  });

  it("pusty rejestr daje zera i pustą listę", async () => {
    const result = await stats();

    expect(result).toMatchObject({ totalCents: 0, count: 0, monthCount: 0, recent: [] });
    expect(result.truncated).toBe(false);
  });

  it("odczyt bez błędu, ale z pustym ładunkiem (`null`) nie wywraca pętli", async () => {
    // PostgREST potrafi oddać `data: null` bez błędu. Bez domyślki `?? []`
    // pętla sumująca poleciałaby na `null` i strona główna zwróciłaby 500.
    seed({ paidNull: true });

    const result = await stats();

    expect(result).toMatchObject({ totalCents: 0, count: 0, recent: [], truncated: false });
  });

  it("niepełna strona kończy skan - drugie zapytanie nie idzie", async () => {
    seed({ paid: [donation(), donation()] });

    await stats();

    expect(db.state.current!.chainsFor("donations")).toHaveLength(1);
  });

  it("pełna strona ciągnie kolejną - stronicowanie działa", async () => {
    seed({
      paid: (offset) =>
        offset === 0
          ? Array.from({ length: 1000 }, () => donation({ amount_cents: 100 }))
          : [donation({ amount_cents: 700 })],
    });

    const result = await stats();

    expect(db.state.current!.chainsFor("donations")).toHaveLength(2);
    expect(result).toMatchObject({ count: 1001, totalCents: 100_700, truncated: false });
  });

  it("po przekroczeniu SUFITU skanu sumy są oznaczone jako przycięte", async () => {
    // Sufit chroni pamięć izolatu; bez flagi `truncated` pasek postępu
    // pokazywałby zaniżoną kwotę jako prawdę.
    seed({ paid: () => Array.from({ length: 1000 }, () => donation({ amount_cents: 100 })) });

    const result = await stats();

    expect(result.truncated).toBe(true);
    expect(result.count).toBe(20_000);
    expect(db.state.current!.chainsFor("donations")).toHaveLength(20);
  });
});
