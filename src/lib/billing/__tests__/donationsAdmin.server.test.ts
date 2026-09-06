// Panel darowizn i uzgodnienie rejestru ze Stripe - 0 z 8 funkcji pokrytych
// do 31.08.2026.
//
// PO CO TEN PLIK ISTNIEJE. Webhook jest ścieżką podstawową, ale bywa zawodny,
// więc ten moduł jest RĘCZNYM DOMKNIĘCIEM KSIĘGI: domyka wpłaty oczekujące,
// importuje sesje, których u nas nie ma, i oznacza zwroty. Działa rolą
// SERWISOWĄ, czyli z pominięciem RLS - a jego wynikiem jest liczbowy raport,
// na podstawie którego człowiek uznaje rejestr za uzgodniony. Dlatego testy
// pilnują DWÓCH rzeczy naraz: co stanie się z wierszem w bazie i co o tym
// powie raport. Rozjazd między nimi jest tu groźniejszy niż awaria.
//
// Miniaturowa tabela zamiast licznika wywołań - jak w `donationsLedger.server`:
// interesuje nas STAN rejestru po uzgodnieniu, bo to on trafia do eksportów
// księgowych i do triggera nadającego status wspierającego. Atrapujemy wyłącznie
// GRANICE (klient Supabase, Stripe, rozwiązanie tenanta, cache SSR); księgowanie
// wpłaty (`@/lib/billing/donations.server`) wykonuje się NAPRAWDĘ.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Tables } from "@/integrations/supabase/types";
import { DZIEN, GODZINA, freezeClock, relativeIso } from "@/test/time";

import {
  ok,
  fail,
  supabaseFromStub,
  type RecordedChain,
  type SupabaseFromStub,
  type SupabaseResult,
} from "@/test/billing/fixtures";

// ZAMROŻENIE NA POZIOMIE PLIKU, a nie pojedynczego testu.
//
// Do 2026-09-05 zamrożone były w tym pliku DWA testy - te, w których okno 24 h
// wymuszało to natychmiast. Pozostałe stały na literałach kalendarzowych i na
// oknie 168 h, które dawało siedem dni zwłoki: 2026-09-05 o 10:00 UTC wypadł z
// niego literał wiersza `don-2` (jeden czerwony test), a 2026-09-06 o 10:00 UTC
// wypadała DOMYŚLNA data fabryki `donationRow()` - zmierzone symulacją: 12
// czerwonych z 45. Przyczyną nie była żadna z tych dat z osobna, tylko to, że
// zamrożenie było per test zamiast per plik.
//
// Odtąd „teraz" jest w tym pliku stałą, a wszystkie daty fixture'ów liczą się
// WZGLĘDEM niej - więc odległość „fixture - teraz" nie zmienia się z upływem
// czasu i przebieg za pięć lat jest tym samym przebiegiem, co dzisiaj.
freezeClock();

const TENANT = "tenant-alfa";
const FOREIGN_TENANT = "tenant-beta";

const h = vi.hoisted(() => {
  const fns = {
    sessionsRetrieve: vi.fn(),
    sessionsList: vi.fn(),
    intentsRetrieve: vi.fn(),
    chargesRetrieve: vi.fn(),
    invalidateCache: vi.fn(),
  };
  const stripe = {
    checkout: { sessions: { retrieve: fns.sessionsRetrieve, list: fns.sessionsList } },
    paymentIntents: { retrieve: fns.intentsRetrieve },
    charges: { retrieve: fns.chargesRetrieve },
  };
  return {
    fns,
    stripe,
    envs: [] as string[],
    tenantId: "tenant-alfa" as string | null,
    from: null as ((table: string) => unknown) | null,
  };
});

// GRANICE - klient serwisowy, operator, rozwiązanie tenanta, cache brzegowy.
vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: { from: (table: string) => h.from?.(table) },
}));
vi.mock("@/lib/stripe.server", () => ({
  createStripeClient: (env: string) => {
    h.envs.push(env);
    return h.stripe;
  },
  getStripeErrorMessage: (e: unknown) => `stripe_error:${(e as Error).message}`,
}));
vi.mock("@/lib/server/tenant.server", () => ({
  resolveTenantIdForHost: async () => h.tenantId,
}));
vi.mock("@/lib/http/requestHost", () => ({
  currentTenantHost: async () => "nes.example.com",
}));
vi.mock("@/lib/ssrCache", () => ({
  invalidateEdgeTtlCache: (key: string) => h.fns.invalidateCache(key),
}));

const { listAdminDonations, syncDonationsFromStripe } =
  await import("@/lib/billing/donationsAdmin.server");

// ---------------------------------------------------------------------------
// Miniaturowa tabela `donations`
// ---------------------------------------------------------------------------

type DonationRow = Tables<"donations">;

let chain: SupabaseFromStub;
let rows: DonationRow[];
/** Wymuszona odmowa ZAPISU (update/insert) - do testów gałęzi awaryjnych. */
let writeFailure: string | null;
/** Wymuszona odmowa ODCZYTU wierszy osieroconych (`like 'pending:%'`). */
let staleReadFailure: string | null;
/** PostgREST oddaje `null` zamiast pustej tablicy - osobny kształt odpowiedzi. */
let nullReads: boolean;

function donationRow(overrides: Partial<DonationRow> = {}): DonationRow {
  return {
    id: "don-1",
    tenant_id: TENANT,
    user_id: null,
    amount_cents: 5000,
    currency: "PLN",
    donor_email: "darczynca@example.com",
    message: null,
    provider: "stripe",
    provider_session_id: "cs_alfa_1",
    provider_intent_id: null,
    provider_subscription_id: null,
    recurring: false,
    status: "pending",
    paid_at: null,
    environment: "live",
    // WZGLĘDNA, nie kalendarzowa: dwie doby wstecz leżą w każdym oknie, które
    // ten moduł czyta (168 h uzgodnienia i 24 h wierszy osieroconych), i będą
    // tam leżeć zawsze, bo liczą się od zamrożonego „teraz".
    created_at: relativeIso(-2 * DZIEN),
    ...overrides,
  };
}

/**
 * Odczyt kolumny bez rzutowania. Nieznana kolumna to BŁĄD TESTU, a nie ciche
 * `undefined`: filtr, którego atrapa nie modeluje, przepuszczałby wszystko
 * i test „dowodziłby" zawężenia, którego nie ma.
 */
function fieldOf(row: DonationRow, column: string): string | null {
  switch (column) {
    case "id":
      return row.id;
    case "tenant_id":
      return row.tenant_id;
    case "status":
      return row.status;
    case "provider":
      return row.provider;
    case "provider_session_id":
      return row.provider_session_id;
    case "provider_intent_id":
      return row.provider_intent_id;
    case "created_at":
      return row.created_at;
    case "paid_at":
      return row.paid_at;
    default:
      throw new Error(`test: atrapa nie modeluje filtru na kolumnie "${column}"`);
  }
}

/** Czy wiersz przechodzi wszystkie filtry zapisane w łańcuchu. */
function matches(row: DonationRow, recorded: RecordedChain): boolean {
  for (const call of recorded.calls) {
    const column = call.args[0];
    const value = call.args[1];
    if (typeof column !== "string") continue;
    if (call.method === "eq" && fieldOf(row, column) !== value) return false;
    if (call.method === "neq" && fieldOf(row, column) === value) return false;
    if (call.method === "is" && fieldOf(row, column) !== value) return false;
    if (call.method === "gte" && String(fieldOf(row, column)) < String(value)) return false;
    if (call.method === "lt" && String(fieldOf(row, column)) >= String(value)) return false;
    if (call.method === "like") {
      const prefix = String(value).replace(/%$/, "");
      if (!(fieldOf(row, column) ?? "").startsWith(prefix)) return false;
    }
  }
  return true;
}

/** Ładunek `insert()`/`update()` w postaci obiektu. */
function payloadOf(recorded: RecordedChain, method: "insert" | "update"): Record<string, unknown> {
  const value = recorded.argsOf(method)?.[0];
  return typeof value === "object" && value !== null && !Array.isArray(value) ? { ...value } : {};
}

function respondDonations(recorded: RecordedChain): SupabaseResult {
  if (recorded.has("insert")) {
    if (writeFailure) return fail(writeFailure);
    const payload = payloadOf(recorded, "insert");
    const sessionId =
      typeof payload.provider_session_id === "string" ? payload.provider_session_id : "";
    // `UNIQUE (provider_session_id)` z migracji 20260714111000 - bez tego
    // atrapa „udowadniałaby" idempotencję, której baza pilnuje indeksem.
    if (rows.some((row) => row.provider_session_id === sessionId)) {
      return fail("duplicate key value violates unique constraint", "23505");
    }
    rows.push(Object.assign(donationRow({ id: `don-${rows.length + 1}` }), payload));
    return ok([{ id: `don-${rows.length}` }]);
  }

  // Odczyt wierszy osieroconych rozpoznajemy po filtrze wzorcem - to jedyne
  // zapytanie tego modułu, które go używa.
  if (staleReadFailure && recorded.has("like")) return fail(staleReadFailure);

  const matched = rows.filter((row) => matches(row, recorded));

  if (recorded.has("update")) {
    if (writeFailure) return fail(writeFailure);
    for (const row of matched) Object.assign(row, payloadOf(recorded, "update"));
    return ok(matched.map((row) => ({ id: row.id })));
  }

  const orderArgs = recorded.argsOf("order");
  const ordered = [...matched];
  if (typeof orderArgs?.[0] === "string") {
    const column = orderArgs[0];
    const options = orderArgs[1];
    const ascending =
      typeof options === "object" && options !== null && "ascending" in options
        ? options.ascending !== false
        : true;
    ordered.sort((a, b) => {
      const left = String(fieldOf(a, column) ?? "");
      const right = String(fieldOf(b, column) ?? "");
      return ascending ? left.localeCompare(right) : right.localeCompare(left);
    });
  }
  if (nullReads) return ok(null);
  const limitArg = recorded.argsOf("limit")?.[0];
  return ok(typeof limitArg === "number" ? ordered.slice(0, limitArg) : ordered);
}

/**
 * Sesja operatora w kształcie czytanym przez uzgodnienie.
 *
 * Metadane niosą STEMPEL TENANTA (`tenantId`), bo tak stempluje je
 * `createDonationSession`. To jest dowód przynależności wpłaty: klucz operatora
 * jest jeden na środowisko, więc lista sesji jest wspólna dla całej instalacji
 * i bez stempla nie da się powiedzieć, czyja jest sesja.
 */
function stripeSession(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "cs_stripe_1",
    status: "complete",
    payment_status: "paid",
    amount_total: 5000,
    currency: "pln",
    mode: "payment",
    created: 1_800_000_000,
    customer_details: { email: "Darczynca@Example.com" },
    payment_intent: "pi_stripe_1",
    subscription: null,
    metadata: { purpose: "donation", tenantId: TENANT },
    ...overrides,
  };
}

const rowById = (id: string): DonationRow | undefined => rows.find((row) => row.id === id);

beforeEach(() => {
  // All dated ledger fixtures below belong to this reconciliation window.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-08-31T12:00:00.000Z"));
  chain = supabaseFromStub();
  chain.setResponse("donations", respondDonations);
  h.from = (table: string) => chain.from(table);
  h.tenantId = TENANT;
  h.envs.length = 0;
  rows = [];
  writeFailure = null;
  staleReadFailure = null;
  nullReads = false;

  for (const fn of Object.values(h.fns)) fn.mockReset();
  h.fns.sessionsRetrieve.mockResolvedValue(stripeSession());
  h.fns.sessionsList.mockResolvedValue({ data: [], has_more: false });
  h.fns.intentsRetrieve.mockResolvedValue({ id: "pi_stripe_1", latest_charge: null });
  h.fns.chargesRetrieve.mockResolvedValue({ refunded: false, amount_refunded: 0 });
  h.fns.invalidateCache.mockResolvedValue(undefined);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// listAdminDonations
// ---------------------------------------------------------------------------

describe("listAdminDonations", () => {
  it("ODMOWA: nierozwiązany tenant oddaje pustą listę i NIE dotyka bazy", async () => {
    // Brak tenanta oznacza żądanie spod nieznanego hosta. Odczyt „na wszelki
    // wypadek" rolą serwisową pokazałby wpłaty WSZYSTKICH tenantów naraz.
    h.tenantId = null;

    await expect(listAdminDonations()).resolves.toEqual([]);
    expect(chain.chains).toHaveLength(0);
  });

  it("czyta wyłącznie wpłaty swojego tenanta, najnowsze pierwsze", async () => {
    rows = [
      donationRow({ id: "don-alfa", status: "paid", created_at: relativeIso(-40 * DZIEN) }),
      donationRow({
        id: "don-beta",
        tenant_id: FOREIGN_TENANT,
        provider_session_id: "cs_beta_1",
        created_at: relativeIso(-3 * DZIEN),
      }),
    ];

    const result = await listAdminDonations();

    expect(result.map((row) => row.id)).toEqual(["don-alfa"]);
    const query = chain.lastChain("donations")!;
    expect(query.argsOf("eq")).toEqual(["tenant_id", TENANT]);
    expect(query.argsOf("order")).toEqual(["created_at", { ascending: false }]);
  });

  it("limit jest przycinany do zakresu 1-200 i domyślnie wynosi 50", async () => {
    const cases: Array<[number | undefined, number]> = [
      [undefined, 50],
      [0, 1],
      [-10, 1],
      [1, 1],
      [200, 200],
      [5000, 200],
    ];

    for (const [requested, expected] of cases) {
      const result = requested === undefined ? listAdminDonations() : listAdminDonations(requested);
      await result;
      expect(chain.lastChain("donations")!.argsOf("limit"), String(requested)).toEqual([expected]);
    }
  });

  it("przepisuje wiersz rejestru na kształt czytelny dla panelu", async () => {
    rows = [
      donationRow({
        id: "don-1",
        status: "paid",
        recurring: true,
        amount_cents: 25000,
        currency: "EUR",
        donor_email: "darczynca@example.org",
        message: "Powodzenia",
        provider_intent_id: "pi_1",
        // JAWNE LITERAŁY SĄ TU POPRAWNE i celowo zostają: ten test dowodzi
        // KONWERSJI KSZTAŁTU (`created_at` -> `createdAt`, `paid_at` ->
        // `paidAt`, wartość przepisana bez zmiany), a nie odległości w czasie.
        // `listAdminDonations` nie liczy ŻADNEGO okna, więc data nie ma tu
        // zapalnika. Wcześniej wartość `createdAt` brała się z DOMYŚLNEJ daty
        // fabryki, a asercja niosła jej kopię - dlatego ten test przewracał się
        // przy każdej zmianie fabryki, choć o fabryce nic nie orzeka.
        created_at: "2026-08-30T10:00:00.000Z",
        paid_at: "2026-08-30T10:05:00.000Z",
      }),
    ];

    const [row] = await listAdminDonations();

    expect(row).toEqual({
      id: "don-1",
      amountCents: 25000,
      currency: "EUR",
      status: "paid",
      recurring: true,
      donorEmail: "darczynca@example.org",
      message: "Powodzenia",
      provider: "stripe",
      providerSessionId: "cs_alfa_1",
      providerIntentId: "pi_1",
      createdAt: "2026-08-30T10:00:00.000Z",
      paidAt: "2026-08-30T10:05:00.000Z",
    });
  });

  it("ODMOWA ODCZYTU jest zgłaszana, a nie zamieniana na pustą listę", async () => {
    chain.setResponse("donations", fail("permission denied for table donations"));

    await expect(listAdminDonations()).rejects.toThrow("permission denied for table donations");
  });

  it("odpowiedź bez wierszy (`null`) daje pustą listę, a nie wyjątek", async () => {
    // PostgREST potrafi oddać `null` zamiast pustej tablicy - panel ma wtedy
    // pokazać „brak wpłat", a nie ekran błędu.
    nullReads = true;

    await expect(listAdminDonations()).resolves.toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// syncDonationsFromStripe - tenant i kształt raportu
// ---------------------------------------------------------------------------

describe("syncDonationsFromStripe - bramka tenanta", () => {
  it("ODMOWA: brak tenanta kończy uzgodnienie ostrzeżeniem, bez bazy i bez operatora", async () => {
    h.tenantId = null;

    const report = await syncDonationsFromStripe("sandbox");

    expect(report.warnings).toEqual(["tenant_unresolved"]);
    expect(report).toMatchObject({ settled: 0, imported: 0, refunded: 0, expired: 0 });
    expect(chain.chains).toHaveLength(0);
    expect(h.envs).toEqual([]);
  });

  it("prosi operatora DOKŁADNIE o środowisko, o które poproszono uzgodnienie", async () => {
    await syncDonationsFromStripe("live");

    expect(h.envs).toEqual(["live"]);
  });

  it("okno czasowe raportu wynika z podanej liczby godzin", async () => {
    // Lokalne `vi.useFakeTimers()` z `finally` zniknęło - zegar zamraża teraz
    // cały plik. Treść asercji bez zmian: 24 godziny odejmowane są od „teraz",
    // a wynik trafia DOKŁADNIE do filtru `gte` zapytania.
    const oczekiwaneOkno = relativeIso(-24 * GODZINA);

    const report = await syncDonationsFromStripe("sandbox", 24);

    expect(report.sinceIso).toBe(oczekiwaneOkno);
    expect(chain.chainsFor("donations")[0]!.argsOf("gte")).toEqual(["created_at", oczekiwaneOkno]);
  });

  it("wiersz SPOZA okna 168 h jest pomijany, a jego brak nie jest zgłaszany jako problem", async () => {
    // KONTROLA DODATNIA NA SAMĄ REGUŁĘ OKNA.
    //
    // Do 2026-09-05 żaden test nie dowodził, że wiersz starszy niż 168 h ma
    // zostać POMINIĘTY. Regułę „udowadniała" wyłącznie przypadkowa czerwień:
    // gdy domyślna data fabryki wypadała z okna, część testów zaczynała padać -
    // i to padanie było jedynym sygnałem, że filtr w ogóle działa. Sygnał
    // pojawiał się raz na siedem dni, po czym trzeba go było gasić.
    //
    // Tutaj obie strony granicy są nazwane wprost i liczone od zamrożonego
    // „teraz", więc reguła jest sprawdzana W KAŻDYM przebiegu, a nie wtedy,
    // kiedy akurat wypadnie z kalendarza. Druga asercja jest równie ważna jak
    // pierwsza: wiersz spoza okna ma być NIEWIDOCZNY, a nie „widoczny i
    // zgłoszony jako kłopot" - inaczej uzgodnienie hałasowałoby ostrzeżeniem
    // przy każdej starszej wpłacie w rejestrze.
    rows = [
      donationRow({
        id: "don-w-oknie",
        provider_session_id: "cs_alfa_1",
        status: "pending",
        created_at: relativeIso(-6 * DZIEN),
      }),
      donationRow({
        id: "don-poza-oknem",
        provider_session_id: "cs_alfa_2",
        status: "pending",
        created_at: relativeIso(-8 * DZIEN),
      }),
    ];
    h.fns.sessionsRetrieve.mockImplementation(async (id: string) => stripeSession({ id }));

    const report = await syncDonationsFromStripe("sandbox");

    expect(report.settled).toBe(1);
    expect(rowById("don-w-oknie")).toMatchObject({ status: "paid" });
    expect(rowById("don-poza-oknem")).toMatchObject({ status: "pending" });
    expect(report.warnings).toEqual([]);
  });

  it("pusty rejestr w kształcie `null` przechodzi uzgodnienie bez zmian", async () => {
    nullReads = true;

    const report = await syncDonationsFromStripe("sandbox");

    expect(report).toMatchObject({ settled: 0, expired: 0, refunded: 0, imported: 0 });
    expect(report.warnings).toEqual([]);
  });

  it("ODMOWA ODCZYTU wierszy lokalnych jest zgłaszana", async () => {
    chain.setResponse("donations", fail("permission denied for table donations"));

    await expect(syncDonationsFromStripe("sandbox")).rejects.toThrow("permission denied");
  });
});

// ---------------------------------------------------------------------------
// Domknięcie wierszy oczekujących
// ---------------------------------------------------------------------------

describe("syncDonationsFromStripe - domknięcie wpłat oczekujących", () => {
  it("opłacona sesja domyka wiersz `pending` i ustawia datę zapłaty", async () => {
    rows = [donationRow({ provider_session_id: "cs_alfa_1", status: "pending" })];
    h.fns.sessionsRetrieve.mockResolvedValue(
      stripeSession({
        id: "cs_alfa_1",
        amount_total: 7500,
        currency: "pln",
        created: 1_800_000_000,
      }),
    );

    const report = await syncDonationsFromStripe("sandbox");

    expect(report.settled).toBe(1);
    expect(rowById("don-1")).toMatchObject({
      status: "paid",
      amount_cents: 7500,
      currency: "PLN",
      provider_intent_id: "pi_stripe_1",
      // E-mail normalizowany do małych liter - inaczej ten sam darczyńca ma
      // w rejestrze dwa wpisy.
      donor_email: "darczynca@example.com",
      paid_at: new Date(1_800_000_000 * 1000).toISOString(),
    });
  });

  it("uboga zwrotka operatora domyka wiersz, ale nie podmienia jego danych", async () => {
    // Sesja bez kwoty, waluty, intencji i adresu e-mail nadal DOWODZI zapłaty
    // (`payment_status: "paid"`), więc wiersz ma zostać domknięty - ale danymi
    // z rejestru, nie zerami z ubogiej odpowiedzi.
    rows = [donationRow({ provider_session_id: "cs_alfa_1", status: "pending" })];
    h.fns.sessionsRetrieve.mockResolvedValue({
      id: "cs_alfa_1",
      status: "complete",
      payment_status: "paid",
    });

    const report = await syncDonationsFromStripe("sandbox");

    expect(report.settled).toBe(1);
    expect(rowById("don-1")).toMatchObject({
      status: "paid",
      amount_cents: 5000,
      currency: "PLN",
      donor_email: "darczynca@example.com",
      provider_intent_id: null,
    });
    expect(rowById("don-1")?.paid_at).toBeTruthy();
  });

  it("sesja WYGASŁA zamyka wiersz jako anulowany, nie jako opłacony", async () => {
    rows = [donationRow({ provider_session_id: "cs_alfa_1", status: "pending" })];
    h.fns.sessionsRetrieve.mockResolvedValue(
      stripeSession({ id: "cs_alfa_1", status: "expired", payment_status: "unpaid" }),
    );

    const report = await syncDonationsFromStripe("sandbox");

    expect(report).toMatchObject({ expired: 1, settled: 0 });
    expect(rowById("don-1")).toMatchObject({ status: "canceled", paid_at: null });
  });

  it("sesja WCIĄŻ OTWARTA nie zmienia niczego - darczyńca właśnie płaci", async () => {
    rows = [donationRow({ provider_session_id: "cs_alfa_1", status: "pending" })];
    h.fns.sessionsRetrieve.mockResolvedValue(
      stripeSession({ id: "cs_alfa_1", status: "open", payment_status: "unpaid" }),
    );

    const report = await syncDonationsFromStripe("sandbox");

    expect(report).toMatchObject({ settled: 0, expired: 0 });
    expect(rowById("don-1")).toMatchObject({ status: "pending" });
  });

  it("ODMOWA: sesja nieznana operatorowi daje ostrzeżenie i NIE przerywa uzgodnienia", async () => {
    rows = [
      donationRow({ id: "don-1", provider_session_id: "cs_zgubiona", status: "pending" }),
      donationRow({
        id: "don-2",
        provider_session_id: "cs_alfa_2",
        status: "pending",
        created_at: relativeIso(-2 * DZIEN),
      }),
    ];
    h.fns.sessionsRetrieve.mockImplementation(async (id: string) => {
      if (id === "cs_zgubiona") throw new Error("No such checkout session");
      return stripeSession({ id });
    });

    const report = await syncDonationsFromStripe("sandbox");

    expect(report.warnings).toContain("session_lookup_failed:cs_zgubiona");
    // Druga wpłata MUSI zostać domknięta mimo awarii pierwszej.
    expect(report.settled).toBe(1);
    expect(rowById("don-2")).toMatchObject({ status: "paid" });
    expect(console.error).toHaveBeenCalled();
  });

  it("ODMOWA: wiersz z identyfikatorem tymczasowym nie jest odpytywany u operatora", async () => {
    // `pending:<uuid>` to nasz własny znacznik sprzed utworzenia sesji - pytanie
    // o niego operatora byłoby gwarantowanym błędem 404 przy każdym przebiegu.
    rows = [donationRow({ provider_session_id: "pending:abc", status: "pending" })];

    await syncDonationsFromStripe("sandbox");

    expect(h.fns.sessionsRetrieve).not.toHaveBeenCalled();
  });

  it("awaria odczytu wierszy osieroconych nie przerywa uzgodnienia", async () => {
    // Ten odczyt jest sprzątaniem, nie księgowaniem - jego awaria nie może
    // kosztować domknięcia wpłat, które właśnie zostały opłacone.
    staleReadFailure = "canceling statement due to statement timeout";
    rows = [donationRow({ provider_session_id: "cs_alfa_1", status: "pending" })];
    h.fns.sessionsRetrieve.mockResolvedValue(stripeSession({ id: "cs_alfa_1" }));

    const report = await syncDonationsFromStripe("sandbox");

    expect(report).toMatchObject({ settled: 1, expired: 0 });
  });

  it("osierocony wiersz tymczasowy starszy niż doba jest anulowany", async () => {
    rows = [
      donationRow({
        id: "don-stary",
        provider_session_id: "pending:stary",
        status: "pending",
        created_at: relativeIso(-2 * DZIEN),
      }),
      donationRow({
        id: "don-swiezy",
        provider_session_id: "pending:swiezy",
        status: "pending",
        created_at: relativeIso(-1 * GODZINA),
      }),
    ];

    const report = await syncDonationsFromStripe("sandbox");

    expect(report.expired).toBe(1);
    expect(rowById("don-stary")).toMatchObject({ status: "canceled" });
    // Wpłata sprzed godziny może jeszcze zostać opłacona.
    expect(rowById("don-swiezy")).toMatchObject({ status: "pending" });
  });
});

// ---------------------------------------------------------------------------
// Zwroty
// ---------------------------------------------------------------------------

describe("syncDonationsFromStripe - zwroty", () => {
  it("zwrócone obciążenie oznacza wpłatę jako zwróconą", async () => {
    rows = [
      donationRow({
        status: "paid",
        provider_intent_id: "pi_1",
        paid_at: relativeIso(-2 * DZIEN + 5 * 60 * 1000),
      }),
    ];
    h.fns.intentsRetrieve.mockResolvedValue({ id: "pi_1", latest_charge: { id: "ch_1" } });
    h.fns.chargesRetrieve.mockResolvedValue({ refunded: true, amount_refunded: 5000 });

    const report = await syncDonationsFromStripe("sandbox");

    expect(report.refunded).toBe(1);
    expect(rowById("don-1")).toMatchObject({ status: "refunded" });
  });

  it("zwrot CZĘŚCIOWY też liczy się jako zwrot", async () => {
    rows = [donationRow({ status: "paid", provider_intent_id: "pi_1" })];
    h.fns.intentsRetrieve.mockResolvedValue({ id: "pi_1", latest_charge: "ch_1" });
    h.fns.chargesRetrieve.mockResolvedValue({ refunded: false, amount_refunded: 500 });

    const report = await syncDonationsFromStripe("sandbox");

    expect(report.refunded).toBe(1);
  });

  it("obciążenie bez pola kwoty zwrotu nie jest uznane za zwrócone", async () => {
    rows = [donationRow({ status: "paid", provider_intent_id: "pi_1" })];
    h.fns.intentsRetrieve.mockResolvedValue({ id: "pi_1", latest_charge: { id: "ch_1" } });
    h.fns.chargesRetrieve.mockResolvedValue({ refunded: false });

    const report = await syncDonationsFromStripe("sandbox");

    expect(report.refunded).toBe(0);
    expect(rowById("don-1")).toMatchObject({ status: "paid" });
  });

  it("ODMOWA: wpłata bez identyfikatora intencji nie jest odpytywana o zwrot", async () => {
    rows = [donationRow({ status: "paid", provider_intent_id: null })];

    await syncDonationsFromStripe("sandbox");

    expect(h.fns.intentsRetrieve).not.toHaveBeenCalled();
  });

  it("ODMOWA: intencja bez obciążenia nie jest zwrotem", async () => {
    rows = [donationRow({ status: "paid", provider_intent_id: "pi_1" })];
    h.fns.intentsRetrieve.mockResolvedValue({ id: "pi_1", latest_charge: null });

    const report = await syncDonationsFromStripe("sandbox");

    expect(report.refunded).toBe(0);
    expect(h.fns.chargesRetrieve).not.toHaveBeenCalled();
    expect(rowById("don-1")).toMatchObject({ status: "paid" });
  });

  it("awaria odczytu obciążenia NIE oznacza wpłaty jako zwróconej", async () => {
    // Kierunek degradacji jest jedyny dopuszczalny: cofnięcie statusu
    // wspierającego na podstawie awarii sieci byłoby gorsze niż spóźniony
    // zwrot, który dojedzie w kolejnym przebiegu (operacja jest idempotentna).
    rows = [donationRow({ status: "paid", provider_intent_id: "pi_1" })];
    h.fns.intentsRetrieve.mockRejectedValue(new Error("rate_limited"));

    const report = await syncDonationsFromStripe("sandbox");

    expect(report.refunded).toBe(0);
    expect(rowById("don-1")).toMatchObject({ status: "paid" });
  });

  it("ODMOWA: wpłata już zwrócona albo anulowana nie jest ruszana ponownie", async () => {
    rows = [
      donationRow({ id: "don-1", status: "refunded", provider_intent_id: "pi_1" }),
      donationRow({
        id: "don-2",
        status: "canceled",
        provider_session_id: "cs_alfa_2",
        provider_intent_id: "pi_2",
      }),
    ];

    const report = await syncDonationsFromStripe("sandbox");

    expect(report).toMatchObject({ refunded: 0, settled: 0, expired: 0 });
    expect(h.fns.intentsRetrieve).not.toHaveBeenCalled();
    expect(h.fns.sessionsRetrieve).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Import brakujących sesji
// ---------------------------------------------------------------------------

describe("syncDonationsFromStripe - import sesji spoza rejestru", () => {
  it("importuje opłaconą darowiznę, której w rejestrze nie ma", async () => {
    h.fns.sessionsList.mockResolvedValue({
      data: [
        stripeSession({
          id: "cs_sierota",
          amount_total: 15000,
          currency: "eur",
          mode: "subscription",
          subscription: { id: "sub_1" },
          customer_details: { email: "NOWY@Example.org" },
        }),
      ],
      has_more: false,
    });

    const report = await syncDonationsFromStripe("sandbox");

    expect(report).toMatchObject({ scannedSessions: 1, imported: 1 });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      tenant_id: TENANT,
      amount_cents: 15000,
      currency: "EUR",
      donor_email: "nowy@example.org",
      provider: "stripe",
      provider_session_id: "cs_sierota",
      provider_intent_id: "pi_stripe_1",
      provider_subscription_id: "sub_1",
      recurring: true,
      status: "paid",
    });
  });

  it("sesja bez kompletu danych jest importowana z bezpiecznymi domyślnymi", async () => {
    // Sesja spoza naszego formularza (link płatniczy, pulpit operatora) bywa
    // uboga. Import ma się udać, ale NIE wolno mu zmyślać: brak kwoty to zero
    // do ręcznego uzupełnienia, brak daty utworzenia to brak daty zapłaty.
    h.fns.sessionsList.mockResolvedValue({
      data: [
        {
          id: "cs_niepelna",
          status: "complete",
          payment_status: "paid",
          metadata: { purpose: "donation", tenantId: TENANT },
        },
      ],
      has_more: false,
    });

    const report = await syncDonationsFromStripe("sandbox");

    expect(report.imported).toBe(1);
    expect(rows[0]).toMatchObject({
      amount_cents: 0,
      currency: "PLN",
      donor_email: null,
      provider_intent_id: null,
      provider_subscription_id: null,
      recurring: false,
      paid_at: null,
    });
  });

  it("domknięcie po identyfikatorze wpłaty nie nadpisuje kwoty, której sesja nie niesie", async () => {
    // Kwota z rejestru jest deklaracją darczyńcy - uboga sesja nie ma prawa
    // wyzerować jej ani podmienić waluty.
    rows = [donationRow({ id: "don-1", provider_session_id: "pending:abc", status: "pending" })];
    h.fns.sessionsList.mockResolvedValue({
      data: [
        {
          id: "cs_ubogie_domkniecie",
          status: "complete",
          payment_status: "paid",
          metadata: { purpose: "donation", donationId: "don-1" },
        },
      ],
      has_more: false,
    });

    const report = await syncDonationsFromStripe("sandbox");

    expect(report.settled).toBe(1);
    expect(rowById("don-1")).toMatchObject({
      status: "paid",
      amount_cents: 5000,
      currency: "PLN",
      donor_email: "darczynca@example.com",
      provider_session_id: "cs_ubogie_domkniecie",
    });
  });

  it("ODMOWA: sesja o innym przeznaczeniu nie jest ani liczona, ani importowana", async () => {
    h.fns.sessionsList.mockResolvedValue({
      data: [
        stripeSession({ id: "cs_bilet", metadata: { purpose: "event_ticket" } }),
        stripeSession({ id: "cs_bez_metadanych", metadata: null }),
      ],
      has_more: false,
    });

    const report = await syncDonationsFromStripe("sandbox");

    expect(report).toMatchObject({ scannedSessions: 0, imported: 0 });
    expect(rows).toHaveLength(0);
  });

  it("ODMOWA: sesja nieopłacona jest policzona, ale nie zaimportowana", async () => {
    h.fns.sessionsList.mockResolvedValue({
      data: [stripeSession({ id: "cs_porzucona", status: "open", payment_status: "unpaid" })],
      has_more: false,
    });

    const report = await syncDonationsFromStripe("sandbox");

    expect(report).toMatchObject({ scannedSessions: 1, imported: 0 });
    expect(rows).toHaveLength(0);
  });

  it("ODMOWA: sesja znana rejestrowi nie jest importowana po raz drugi", async () => {
    rows = [donationRow({ provider_session_id: "cs_znana", status: "paid" })];
    h.fns.sessionsList.mockResolvedValue({
      data: [stripeSession({ id: "cs_znana" })],
      has_more: false,
    });

    const report = await syncDonationsFromStripe("sandbox");

    expect(report.imported).toBe(0);
    expect(rows).toHaveLength(1);
  });

  it("sesja z identyfikatorem wpłaty domyka istniejący wiersz i przepisuje mu sesję", async () => {
    rows = [donationRow({ id: "don-1", provider_session_id: "pending:abc", status: "pending" })];
    h.fns.sessionsList.mockResolvedValue({
      data: [
        stripeSession({
          id: "cs_domkniecie",
          amount_total: 9000,
          metadata: { purpose: "donation", donationId: "don-1" },
        }),
      ],
      has_more: false,
    });

    const report = await syncDonationsFromStripe("sandbox");

    expect(report).toMatchObject({ settled: 1, imported: 0 });
    expect(rows).toHaveLength(1);
    expect(rowById("don-1")).toMatchObject({
      status: "paid",
      amount_cents: 9000,
      provider_session_id: "cs_domkniecie",
    });
  });

  it("ODMOWA: naruszenie unikalności przy imporcie daje ostrzeżenie, nie wyjątek", async () => {
    // `UNIQUE (provider_session_id)` jest ostatnim zamkiem idempotencji: dwa
    // równoległe przebiegi uzgodnienia nie mogą zdublować wpłaty.
    rows = [donationRow({ provider_session_id: "cs_sierota", status: "paid" })];
    h.fns.sessionsList.mockResolvedValue({
      data: [stripeSession({ id: "cs_sierota" })],
      has_more: false,
    });
    // Wiersz istnieje, ale POZA oknem czasowym uzgodnienia, więc nie trafił
    // do zbioru znanych sesji - import zderza się z indeksem bazy.
    rows[0]!.created_at = relativeIso(-30 * DZIEN);

    const report = await syncDonationsFromStripe("sandbox");

    expect(report.warnings).toContain("import_failed:cs_sierota");
    expect(report.imported).toBe(0);
    expect(rows).toHaveLength(1);
  });

  it("niepełna strona wyników operatora jest zgłaszana ostrzeżeniem", async () => {
    h.fns.sessionsList.mockResolvedValue({ data: [], has_more: true });

    const report = await syncDonationsFromStripe("sandbox");

    expect(report.warnings).toContain("sessions_page_limit");
  });

  it("ODMOWA OPERATORA na liście sesji nie wywraca uzgodnienia wierszy lokalnych", async () => {
    rows = [donationRow({ provider_session_id: "cs_alfa_1", status: "pending" })];
    h.fns.sessionsList.mockRejectedValue(new Error("api_down"));
    h.fns.sessionsRetrieve.mockResolvedValue(stripeSession({ id: "cs_alfa_1" }));

    const report = await syncDonationsFromStripe("sandbox");

    expect(report.warnings).toContain("stripe_list_failed");
    // Domknięcie lokalne zaszło PRZED awarią i musi zostać zaraportowane.
    expect(report.settled).toBe(1);
    expect(console.error).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Cache publicznych statystyk
// ---------------------------------------------------------------------------

describe("syncDonationsFromStripe - unieważnienie publicznych statystyk", () => {
  it("zmiana w rejestrze unieważnia cache od razu", async () => {
    rows = [donationRow({ provider_session_id: "cs_alfa_1", status: "pending" })];
    h.fns.sessionsRetrieve.mockResolvedValue(stripeSession({ id: "cs_alfa_1" }));

    await syncDonationsFromStripe("sandbox");

    expect(h.fns.invalidateCache).toHaveBeenCalledWith("donations:public-stats");
  });

  it("ODMOWA: przebieg bez zmian NIE unieważnia cache", async () => {
    // Cache jest wspólny dla całego izolatu - zrzucanie go przy każdym
    // kliknięciu „odśwież" zamieniałoby licznik wpłat w zapytanie do bazy
    // przy każdym wejściu na stronę.
    const report = await syncDonationsFromStripe("sandbox");

    expect(report).toMatchObject({ settled: 0, imported: 0, refunded: 0, expired: 0 });
    expect(h.fns.invalidateCache).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Defekty
// ---------------------------------------------------------------------------

describe("wiarygodność raportu i izolacja tenanta", () => {
  // DEFEKT NAPRAWIONY 31.08.2026 (`donationsAdmin.server.ts`).
  //
  // CO BYŁO ZŁE. Trzy zapisy w tym module nie sprawdzały błędu w ogóle:
  // `update({status:"refunded"})`, `update({status:"canceled"})` przy sesji
  // wygasłej i ten sam zapis w pętli wierszy osieroconych. Po każdym z nich
  // licznik raportu rósł BEZWARUNKOWO. Gdy zapis się nie powiódł (polityka,
  // konflikt, awaria), raport i tak mówił „zwrócono 1".
  //
  // JAKIE TO BYŁO RYZYKO. Ten raport jest JEDYNYM potwierdzeniem, jakie
  // dostaje człowiek domykający księgę. „Zwrócono 1" znaczy dla niego:
  // rejestr jest uzgodniony, status wspierającego cofnięty, eksport księgowy
  // pokazuje zwrot. W rzeczywistości wiersz dalej miał `paid`, darczyńca dalej
  // miał benefity opłacone pieniędzmi, które mu oddano, a rozbieżność wyszłaby
  // dopiero przy rocznym rozliczeniu. To ta sama klasa ryzyka, którą
  // `src/test/billing/fixtures.ts` nazywa wprost: operacja POZORNIE WYKONANA
  // jest gorsza od operacji zablokowanej.
  //
  // JAK ZOSTAŁO NAPRAWIONE. Każdy z trzech zapisów sprawdza `error`: przy
  // odmowie licznik NIE rośnie, a raport niesie ostrzeżenie
  // (`refund_write_failed:<id>` / `expire_write_failed:<id>`) - czyli kanał,
  // który panel już umie pokazać, bo `warnings` istnieje w kontrakcie raportu.
  it("nieudany zapis zwrotu NIE jest raportowany jako zwrot wykonany", async () => {
    rows = [donationRow({ status: "paid", provider_intent_id: "pi_1" })];
    h.fns.intentsRetrieve.mockResolvedValue({ id: "pi_1", latest_charge: { id: "ch_1" } });
    h.fns.chargesRetrieve.mockResolvedValue({ refunded: true, amount_refunded: 5000 });
    writeFailure = "permission denied for table donations";

    const report = await syncDonationsFromStripe("sandbox");

    // Raport nie ma prawa twierdzić, że zwrot został zaksięgowany, skoro
    // wiersz dalej jest opłacony.
    expect({ refunded: report.refunded, status: rowById("don-1")?.status }).toEqual({
      refunded: 0,
      status: "paid",
    });
    expect(report.warnings).toContain("refund_write_failed:don-1");
  });

  it("nieudane zamknięcie WYGASŁEJ sesji też nie podnosi licznika", async () => {
    rows = [donationRow({ status: "pending", provider_session_id: "cs_alfa_1" })];
    h.fns.sessionsRetrieve.mockResolvedValue(
      stripeSession({ id: "cs_alfa_1", status: "expired", payment_status: "unpaid" }),
    );
    writeFailure = "permission denied for table donations";

    const report = await syncDonationsFromStripe("sandbox");

    expect({ expired: report.expired, status: rowById("don-1")?.status }).toEqual({
      expired: 0,
      status: "pending",
    });
    expect(report.warnings).toContain("expire_write_failed:don-1");
  });

  it("nieudane anulowanie wiersza OSIEROCONEGO nie podnosi licznika", async () => {
    rows = [
      donationRow({
        id: "don-1",
        status: "pending",
        provider_session_id: "pending:abc",
        created_at: relativeIso(-2 * DZIEN),
      }),
    ];
    writeFailure = "permission denied for table donations";

    const report = await syncDonationsFromStripe("sandbox");

    expect({ expired: report.expired, status: rowById("don-1")?.status }).toEqual({
      expired: 0,
      status: "pending",
    });
    expect(report.warnings).toContain("expire_write_failed:don-1");
  });

  // DEFEKT NAPRAWIONY 31.08.2026 (`donationsAdmin.server.ts` przy imporcie
  // oraz `donations.server.ts` przy tworzeniu sesji).
  //
  // CO BYŁO ZŁE. Import „brakujących sesji" pyta operatora o WSZYSTKIE sesje
  // z okna czasowego (`checkout.sessions.list`) i brał każdą z
  // `metadata.purpose === "donation"`. Klucz operatora jest jeden na
  // ŚRODOWISKO (`STRIPE_LIVE_API_KEY`), a nie na tenanta - lista jest więc
  // wspólna dla całej instalacji. Sesja, której nie było w rejestrze, była
  // wstawiana z `tenant_id` = tenant WYWOŁUJĄCEGO, mimo że nic w sesji nie
  // mówiło, czyja ona jest: `createDonationSession` stemplował metadane
  // wyłącznie `purpose`, `donationId` i `userId`.
  //
  // JAKIE TO BYŁO RYZYKO. Cel tej gałęzi (zgodnie z nagłówkiem modułu) to
  // wpłaty powstałe POZA naszym formularzem - płatność z pulpitu operatora,
  // link płatniczy, ręczne domknięcie. Właśnie takie sesje nie mają
  // `donationId`, więc trafiały tu wszystkie. W instalacji wielotenantowej
  // wpłata na kampanię tenanta B lądowała w księdze tenanta A, bo to jego
  // administrator pierwszy kliknął „uzgodnij". Cudze pieniądze w cudzym
  // rejestrze przechodzą dalej do publicznych statystyk zbiórki, do eksportu
  // księgowego i do triggera nadającego status wspierającego. Izolacja tenanta
  // jest w tym repo regułą PIENIĘŻNĄ, nie kosmetyką - pilnuje jej nawet
  // `tenant_isolation_billing_storage_test.sql`.
  //
  // JAK ZOSTAŁO NAPRAWIONE. `createDonationSession` stempluje sesję
  // `metadata.tenantId`, a import wstawia WYŁĄCZNIE sesje z pasującym
  // stemplem. Sesja bez stempla (albo z cudzym) nie znika po cichu: raport
  // niesie `import_unassigned:<id>`, czyli listę do ręcznego przypisania.
  // Tak wygląda odpowiedź na pytanie „co z sesjami, które stempla nie mają":
  // nie są przypisywane automatycznie i nie są gubione.
  it("sesja bez dowodu przynależności NIE trafia do rejestru klikającego tenanta", async () => {
    h.fns.sessionsList.mockResolvedValue({
      data: [
        stripeSession({
          id: "cs_sierota_bez_tenanta",
          amount_total: 30000,
          metadata: { purpose: "donation" },
        }),
      ],
      has_more: false,
    });

    const report = await syncDonationsFromStripe("sandbox");

    expect({ imported: report.imported, wierszy: rows.length }).toEqual({
      imported: 0,
      wierszy: 0,
    });
  });

  it("sesja bez stempla jest ZGŁOSZONA do ręcznego przypisania, a nie przemilczana", async () => {
    // Cicha odmowa byłaby tu drugą wersją tego samego defektu: wpłata
    // istnieje u operatora, a nie ma jej w żadnej księdze i nikt o tym nie wie.
    h.fns.sessionsList.mockResolvedValue({
      data: [stripeSession({ id: "cs_sierota_bez_tenanta", metadata: { purpose: "donation" } })],
      has_more: false,
    });

    const report = await syncDonationsFromStripe("sandbox");

    expect(report.warnings).toContain("import_unassigned:cs_sierota_bez_tenanta");
    expect(report.scannedSessions).toBe(1);
  });

  it("sesja ze stemplem CUDZEGO tenanta też nie wchodzi do naszej księgi", async () => {
    h.fns.sessionsList.mockResolvedValue({
      data: [
        stripeSession({
          id: "cs_obcego_tenanta",
          metadata: { purpose: "donation", tenantId: FOREIGN_TENANT },
        }),
      ],
      has_more: false,
    });

    const report = await syncDonationsFromStripe("sandbox");

    expect(report.imported).toBe(0);
    expect(rows).toHaveLength(0);
    expect(report.warnings).toContain("import_unassigned:cs_obcego_tenanta");
  });

  it("sesja z NASZYM stemplem jest importowana normalnie", async () => {
    // Druga strona bramki: zawężenie nie może zabić funkcji, dla której ta
    // gałąź istnieje.
    h.fns.sessionsList.mockResolvedValue({
      data: [stripeSession({ id: "cs_nasza_sierota" })],
      has_more: false,
    });

    const report = await syncDonationsFromStripe("sandbox");

    expect(report.imported).toBe(1);
    expect(rows[0]).toMatchObject({ tenant_id: TENANT, provider_session_id: "cs_nasza_sierota" });
  });
});
