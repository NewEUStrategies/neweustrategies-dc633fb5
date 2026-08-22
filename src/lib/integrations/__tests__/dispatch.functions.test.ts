// DISPATCHER INTEGRACJI WYCHODZĄCYCH (`src/lib/integrations/dispatch.functions.ts`,
// 64 niepokryte linie, 0% wykonanych funkcji przed tą zmianą) - JEDYNE miejsce
// w platformie, które wykonuje HTTP do usługi zewnętrznej i JEDYNE, które czyta
// sekret endpointu z Vault.
//
// CO TEN PLIK DOWODZI. Dispatcher jest pętlą bez widza: dostawy są zdejmowane
// claim-em, wysyłane i raportowane bez udziału człowieka (cron `jobs-tick` co
// minutę). Każda cicha gałąź kosztuje tu inaczej niż w interfejsie:
//
//   1. KLUCZ NIEUSTAWIONY (Vault oddaje `null`, `""` albo wartość spoza
//      łańcucha) NIE MOŻE udawać działającej integracji. Dla HubSpota i partnera
//      CRM w trybie Bearer dostawa MUSI się nie udać z powodem nazywającym
//      brakujący sekret - inaczej endpoint bez tokenu wygląda jak sprawny,
//      a odbiorca po prostu nic nie dostaje.
//   2. KLUCZ NIEPRAWIDŁOWY = odpowiedź 401/403 od usługi. Musi wylądować
//      w `finish_integration_delivery` jako `HTTP 401`, bo to jedyny ślad,
//      po którym operator pozna, że token wygasł.
//   3. AWARIA USŁUGI (5xx) i TIMEOUT (przerwane żądanie) degradują się do
//      dostawy nieudanej z powodem - nigdy do fałszywego sukcesu. Test jest
//      DETERMINISTYCZNY: atrapa transportu odrzuca NATYCHMIAST, w pliku nie ma
//      ani jednego `setTimeout` ani czekania na zegar.
//   4. PODPIS HMAC-SHA256 jest liczony i wpisywany w te nagłówki, których
//      oczekuje odbiorca (generyczny webhook: `x-nes-signature`; partner CRM
//      dodatkowo legacy `X-Signature`). Wartość jest sprawdzana względem
//      NIEZALEŻNEJ implementacji (`node:crypto`), nie względem samej siebie.
//   5. SEKRET NIE WYCIEKA: ani do argumentów raportu dostawy, ani do
//      podsumowania, ani do logu błędu.
//   6. BRAMKA ROLI: powierzchnia wołalna z sieci (`dispatchIntegrationDeliveries`)
//      deklaruje `requireStaff`, a jedynym parametrem od wywołującego jest
//      `limit` - żadna wartość z wejścia nie wchodzi do filtra tabeli, więc
//      z panelu nie da się dosięgnąć dostaw innego najemcy.
//
// CZEGO TEN HARNESS NIE UDAJE - I DLACZEGO TO NIE JEST LUKA.
// `@/test/serverFnHarness` NIE URUCHAMIA middleware (patrz nagłówek harnessu),
// więc żaden test w tym pliku nie dowodzi, że żądanie bez sesji zostanie
// odrzucone. „Brak sesji” jest tu sprawdzany jako DEKLARACJA middleware
// (`serverFnMiddlewareNames`), a nie jako zachowanie handlera - test, który
// udawałby jedno drugim, dawałby fałszywą pewność co do warstwy, której w ogóle
// nie dotyka. Runtime pilnuje `requireStaff`, a bramka statyczna
// `check:authz-snapshot`.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE.
// - ADAPTERÓW FORMATU: `formats.test.ts` (sąsiedni plik) ma Block Kit, upsert
//   HubSpota, mapowanie zgód partnera CRM i normalizację rodzaju. Tutaj
//   `formats.ts` jest używany PRAWDZIWY, ale asercje dotyczą tego, co
//   dispatcher robi Z JEGO WYNIKIEM (`send`/`skip`/`fail`), nie kształtu body
//   w każdym wariancie.
// - BRAMKI SSRF: `src/lib/http/__tests__/egressGuard.test.ts` ma pełny zestaw
//   adresów prywatnych i zarezerwowanych. Tutaj bramka jest atrapą i dowodzimy
//   WYŁĄCZNIE tego, że dispatcher ją woła PRZED `fetch` i że jej odmowa kończy
//   dostawę błędem.
// - AUTORYTETU BAZY: backoff wykładniczy, status `dead` po ośmiu próbach
//   i zakres najemcy w `claim_integration_deliveries` liczy baza (pgTAP);
//   aplikacja jedynie raportuje wynik.
//
// BEZPIECZEŃSTWO TESTU: żaden test nie wychodzi do sieci - globalny `fetch` jest
// atrapą, a `afterEach` pilnuje mechanicznie, że każdy adres, na który
// dispatcher próbował się wybrać, jest w domenie `example.com`/`example.org`.
// Sekrety w fixture'ach są jawnie fałszywe (`test-key-not-real`), nigdy
// w formacie realnego tokena dostawcy. Adresy e-mail: wyłącznie `example.org`.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHmac } from "node:crypto";
import type { RecordedChain, SupabaseFromStub } from "@/test/supabaseChain";

/** Ustalona data bazowa - żadnego `Date.now()`. */
const BASE_ISO = "2026-08-21T09:30:00.000Z";

/** Jawnie fałszywy sekret - nigdy w formacie realnego tokena dostawcy. */
const FAKE_SECRET = "test-key-not-real";
const FAKE_SECRET_B = "test-key-not-real-rotated";

/** Odpowiedź RPC w kształcie, w jakim ją czyta dispatcher. */
interface RpcResult {
  data: unknown;
  error: { message: string } | null;
}

/** Opcje `fetch`, jakie podaje dispatcher (i tylko one). */
interface DispatchFetchInit {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  signal?: unknown;
  redirect?: string;
}

interface FetchCall {
  url: string;
  init: DispatchFetchInit;
}

const h = vi.hoisted(() => ({
  /** Atrapa łańcucha PostgREST dla `supabaseAdmin` (klient omijający RLS). */
  admin: null as SupabaseFromStub | null,
  rpcCalls: [] as { name: string; args: unknown }[],
  /** Wynik `claim_integration_deliveries`. */
  claim: { data: [], error: null } as { data: unknown; error: { message: string } | null },
  /** Wartość, jaką Vault oddaje przez `integration_endpoint_get_secret`. */
  secret: null as unknown,
  /** Błąd raportu dostawy (`finish_integration_delivery`). */
  finishError: null as { message: string } | null,
  /** Atrapa bramki SSRF - dispatcher woła ją dynamicznym importem. */
  guard: vi.fn(),
  fetchCalls: [] as FetchCall[],
  /** Status odpowiedzi atrapy transportu. */
  fetchStatus: 200,
  /**
   * Gdy ustawione, transport ODRZUCA tą wartością - natychmiast. `unknown`, bo
   * odrzucenie spoza `Error` to osobna gałąź (`e instanceof Error ? … : "network error"`).
   */
  fetchRejection: undefined as unknown,
}));

vi.mock("@tanstack/react-start", async () => {
  const { serverFnStubModule } = await import("@/test/serverFnHarness");
  return serverFnStubModule();
});
vi.mock("@/integrations/supabase/require-staff", () => ({
  requireStaff: { name: "requireStaff" },
}));
// Bramka SSRF jest serwerowa i sięga do `node:dns` - bez atrapy test
// WYSZEDŁBY DO SIECI po pierwszym adresie endpointu.
vi.mock("@/lib/http/egressGuard.server", () => ({ assertPublicHttpUrl: h.guard }));
vi.mock("@/integrations/supabase/client.server", async () => {
  const { supabaseFromStub } = await import("@/test/supabaseChain");
  const admin = supabaseFromStub();
  h.admin = admin;
  return {
    supabaseAdmin: {
      from: (table: string) => admin.from(table),
      rpc: (name: string, args: unknown): Promise<RpcResult> => {
        h.rpcCalls.push({ name, args });
        if (name === "claim_integration_deliveries") return Promise.resolve(h.claim);
        if (name === "integration_endpoint_get_secret") {
          return Promise.resolve({ data: h.secret, error: null });
        }
        if (name === "finish_integration_delivery") {
          return Promise.resolve({ data: null, error: h.finishError });
        }
        return Promise.resolve({
          data: null,
          error: { message: `test: nieplanowane RPC ${name}` },
        });
      },
    },
  };
});

import * as dispatchModule from "@/lib/integrations/dispatch.functions";
import {
  dispatchIntegrationDeliveries,
  runIntegrationDispatch,
  type DispatchSummary,
} from "@/lib/integrations/dispatch.functions";
import {
  callServerFn,
  serverFnMiddlewareNames,
  validateServerFnInput,
} from "@/test/serverFnHarness";
import { fail, ok } from "@/test/supabaseChain";
import { CRM_PARTNER_SIGNATURE_HEADERS } from "@/lib/integrations/formats";

const ENDPOINTS = "integration_endpoints";
const CRM_PROFILES = "crm_webhook_endpoints";
const CRM_LEADS = "crm_leads";
const SIGNATURE_HEADER = "x-nes-signature";

const IDS = {
  delivery: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
  deliveryB: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
  deliveryC: "ffffffff-ffff-4fff-8fff-ffffffffffff",
  endpoint: "11111111-1111-4111-8111-111111111111",
  lead: "22222222-2222-4222-8222-222222222222",
  workspace: "33333333-3333-4333-8333-333333333333",
} as const;

/** Atrapa klienta serwisowego - STRAŻNIK zamiast rzutowania stanu z `vi.hoisted`. */
function admin(): SupabaseFromStub {
  const value = h.admin;
  if (!value) throw new Error("test: atrapa `supabaseAdmin` nie została zainicjowana");
  return value;
}

interface DeliveryFixture {
  id: string;
  endpoint_id: string;
  event_type: string;
  payload: Record<string, unknown>;
}

/** Koperta zdarzenia w kształcie, jaki wkłada do outboxu trigger routera. */
function envelope(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    event_type: "crm_lead.created.v1",
    aggregate_type: "crm_lead",
    aggregate_id: IDS.lead,
    payload: {
      email: "lead@example.org",
      stage: "new",
      first_name: "Ala",
      last_name: "Nowak",
    },
    correlation_id: "corr-1",
    created_at: BASE_ISO,
    ...overrides,
  };
}

function delivery(overrides: Partial<DeliveryFixture> = {}): DeliveryFixture {
  return {
    id: IDS.delivery,
    endpoint_id: IDS.endpoint,
    event_type: "crm_lead.created.v1",
    payload: envelope(),
    ...overrides,
  };
}

interface EndpointFixture {
  url: string;
  enabled: boolean;
  integration: string;
}

function endpointRow(overrides: Partial<EndpointFixture> = {}): EndpointFixture {
  return {
    url: "https://receiver.example.com/hook",
    enabled: true,
    integration: "webhook",
    ...overrides,
  };
}

/** Profil partnera CRM (`crm_webhook_endpoints`). */
function crmProfile(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    auth_kind: "hmac",
    consent_mapping: [
      {
        source_key: "marketing_consent",
        source_label: "Zgoda marketingowa",
        partner_field: "marketing",
        partner_category: "marketing",
        required: true,
      },
    ],
    workspace_id: IDS.workspace,
    ...overrides,
  };
}

/** Snapshot leada czytany w chwili dostawy. */
function leadRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: IDS.lead,
    email: "lead@example.org",
    first_name: "Ala",
    last_name: "Nowak",
    phone: null,
    company: null,
    stage: "new",
    tags: null,
    marketing_consent: true,
    newsletter_status: null,
    created_at: BASE_ISO,
    last_activity_at: BASE_ISO,
    ...overrides,
  };
}

/** Plan odczytu tabel: co oddaje `supabaseAdmin` dla kolejnych zapytań. */
function planEndpoint(row: EndpointFixture | null): void {
  admin().setResponse(ENDPOINTS, ok(row));
}

/** Transport - atrapa. Rejestruje wywołanie i oddaje zaplanowany wynik. */
function fetchStub(url: string, init: DispatchFetchInit): Promise<{ ok: boolean; status: number }> {
  h.fetchCalls.push({ url, init });
  if (h.fetchRejection !== undefined) return Promise.reject(h.fetchRejection);
  return Promise.resolve({
    ok: h.fetchStatus >= 200 && h.fetchStatus < 300,
    status: h.fetchStatus,
  });
}

/** Argumenty ostatniego wywołania RPC o danej nazwie. */
function rpcArgs(name: string): Record<string, unknown> | undefined {
  const call = h.rpcCalls.filter((entry) => entry.name === name).at(-1);
  const args = call?.args;
  if (args === undefined) return undefined;
  if (args === null || typeof args !== "object" || Array.isArray(args)) {
    throw new Error(`test: RPC ${name} bez argumentów obiektowych`);
  }
  return { ...args };
}

function rpcNames(): string[] {
  return h.rpcCalls.map((call) => call.name);
}

/** Wszystkie raporty dostaw - w kolejności. */
function finishCalls(): Record<string, unknown>[] {
  const calls: Record<string, unknown>[] = [];
  for (const call of h.rpcCalls) {
    if (call.name !== "finish_integration_delivery") continue;
    const args = call.args;
    if (args === null || typeof args !== "object" || Array.isArray(args)) {
      throw new Error("test: raport dostawy bez argumentów obiektowych");
    }
    calls.push({ ...args });
  }
  return calls;
}

function lastFetch(): FetchCall {
  const call = h.fetchCalls.at(-1);
  if (!call) throw new Error("test: transport nie został wywołany");
  return call;
}

function headerOf(call: FetchCall, name: string): string | undefined {
  return call.init.headers?.[name];
}

/**
 * Oczekiwany podpis liczony NIEZALEŻNĄ implementacją (`node:crypto`), a nie tą
 * samą, której używa produkcja (WebCrypto). Test, który liczyłby podpis tak jak
 * kod, dowodziłby tylko, że dwa razy wywołano to samo.
 */
function expectedHmac(secret: string, body: string): string {
  return createHmac("sha256", secret).update(body).digest("hex");
}

/** Jedna dostawa gotowa do wysłania - najczęstszy układ. */
function planSingleDelivery(overrides: Partial<DeliveryFixture> = {}): void {
  h.claim = { data: [delivery(overrides)], error: null };
}

let consoleError: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  admin().reset();
  h.rpcCalls = [];
  h.claim = { data: [], error: null };
  h.secret = FAKE_SECRET;
  h.finishError = null;
  h.guard.mockReset();
  h.guard.mockResolvedValue(new URL("https://receiver.example.com/hook"));
  h.fetchCalls = [];
  h.fetchStatus = 200;
  h.fetchRejection = undefined;
  vi.stubGlobal("fetch", fetchStub);
  consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  // Mechaniczna gwarancja braku sieci: transport jest atrapą, a każdy adres,
  // na który dispatcher próbował wyjść, należy do domeny testowej.
  for (const call of h.fetchCalls) {
    expect(call.url, `adres poza domeną testową: ${call.url}`).toMatch(
      /^https:\/\/[a-z0-9.-]*example\.(com|org)(\/|$)/,
    );
  }
  consoleError.mockRestore();
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------
// 1. OBUDOWA - bramka strukturalna po WSZYSTKICH eksportach modułu.
// ---------------------------------------------------------------------------

/** Czy eksport jest specyfikacją funkcji serwerowej (kształt z atrapy fabryki). */
function isServerFnLike(
  value: unknown,
): value is { middleware: unknown[]; handler: unknown; method?: unknown; validator?: unknown } {
  return (
    typeof value === "object" &&
    value !== null &&
    "middleware" in value &&
    "handler" in value &&
    Array.isArray(Reflect.get(value, "middleware"))
  );
}

type ServerFnLike = {
  middleware: unknown[];
  handler: unknown;
  method?: unknown;
  validator?: unknown;
};

/**
 * Wszystkie eksporty modułu, które są funkcjami serwerowymi. Zawężenie robi
 * STRAŻNIK na krotce (`entry is [string, ServerFnLike]`), a nie rzutowanie -
 * inaczej `fn` w tabelach niżej byłoby `unknown` i asercje na `middleware`
 * wymagałyby `as`.
 */
const SERVER_FNS: readonly { name: string; fn: ServerFnLike }[] = Object.entries(
  dispatchModule,
).flatMap(([name, value]) => (isServerFnLike(value) ? [{ name, fn: value }] : []));

describe("dispatcher - obudowa funkcji serwerowych", () => {
  it("moduł wystawia DOKŁADNIE jedną powierzchnię wołalną z sieci", () => {
    // Kanarek zasięgu tej sekcji: każdy nowy `createServerFn` w tym module
    // wchodzi automatycznie do tabel niżej, a ta asercja mówi, że o nim wiemy.
    expect(SERVER_FNS.map((entry) => entry.name)).toEqual(["dispatchIntegrationDeliveries"]);
  });

  it.each(SERVER_FNS)("$name deklaruje `requireStaff`", ({ fn }) => {
    // Bramka STRUKTURALNA: harness nie uruchamia middleware, więc to jedyne
    // miejsce, w którym da się dowieść, że funkcja je w ogóle ma. Bez niego
    // każdy anonim mógłby drenować outbox integracji obcego najemcy.
    expect(serverFnMiddlewareNames(fn)).toContain("requireStaff");
  });

  it.each(SERVER_FNS)("$name ma metodę POST", ({ fn }) => {
    // `GET` dałby się wywołać z `<img src>` - metoda jest częścią obrony przed
    // CSRF, nie kosmetyką.
    expect(Reflect.get(fn, "method")).toBe("POST");
  });

  it.each(SERVER_FNS)("$name waliduje wejście", ({ fn }) => {
    expect(Reflect.get(fn, "validator")).toBeTypeOf("function");
  });

  it("rdzeń `runIntegrationDispatch` jest zwykłą funkcją - to cron, nie trasa", () => {
    // `jobs-tick` woła rdzeń bez frameworka (domknięcie D2: dostawy płyną bez
    // wejścia staffu do panelu). Autorytetem jest tu klucz service_role i to,
    // że claim jest RPC-em bazy - nie middleware.
    expect(runIntegrationDispatch).toBeTypeOf("function");
    expect(isServerFnLike(runIntegrationDispatch)).toBe(false);
  });
});

describe("dispatcher - walidacja wejścia", () => {
  it.each([
    { label: "brak wejścia", input: undefined },
    { label: "puste wejście", input: {} },
  ])("$label daje domyślną partię 20", ({ input }) => {
    // Domyślna wartość jest częścią kontraktu: panel wysyła 50, cron nic -
    // i wtedy partia musi mieć rozmiar, a nie „nieskończoność”.
    expect(validateServerFnInput(dispatchIntegrationDeliveries, input)).toEqual({ limit: 20 });
  });

  it.each([
    { label: "dolna granica", limit: 1 },
    { label: "górna granica", limit: 100 },
  ])("$label przechodzi", ({ limit }) => {
    expect(validateServerFnInput(dispatchIntegrationDeliveries, { limit })).toEqual({ limit });
  });

  it.each([
    { label: "zero", limit: 0 },
    { label: "wartość ujemna", limit: -5 },
    { label: "ponad limit partii", limit: 101 },
    { label: "wartość niecałkowita", limit: 1.5 },
    { label: "liczba jako łańcuch", limit: "20" },
    { label: "wartość pusta", limit: null },
  ])("$label jest odrzucana przez walidator", ({ limit }) => {
    // Partia bez górnego ograniczenia to jedno wywołanie trzymające połączenie
    // do bazy przez minuty i tysiące żądań do obcych usług.
    expect(() => validateServerFnInput(dispatchIntegrationDeliveries, { limit })).toThrow();
  });

  it("handler przekazuje ZWALIDOWANY limit do claimu i nic więcej", async () => {
    // Jedyny parametr od wywołującego. Gdyby handler przyjmował cokolwiek
    // jeszcze (id endpointu, najemcę), panel jednego najemcy mógłby dosięgnąć
    // dostaw innego - zakres claimu liczy WYŁĄCZNIE baza.
    const summary = await callServerFn<DispatchSummary>(dispatchIntegrationDeliveries, {
      data: { limit: 7 },
      context: { supabase: null },
    });

    expect(rpcArgs("claim_integration_deliveries")).toEqual({ p_limit: 7 });
    expect(summary).toEqual({ claimed: 0, delivered: 0, failed: 0 });
  });
});

// ---------------------------------------------------------------------------
// 2. CLAIM - odmowa wyprzedza pracę.
// ---------------------------------------------------------------------------

describe("dispatcher - przejmowanie partii", () => {
  it("awaria claimu RZUCA z powodem i NIE TYKA żadnej tabeli ani innego RPC", async () => {
    // Cichy `return` po nieudanym claimie zamieniłby awarię bazy w „brak
    // dostaw" - kolejka rosłaby bez żadnego sygnału.
    h.claim = { data: null, error: { message: "deadlock detected" } };

    await expect(runIntegrationDispatch(20)).rejects.toThrow(
      "integration dispatch: claim failed (deadlock detected)",
    );
    expect(admin().chains).toHaveLength(0);
    expect(rpcNames()).toEqual(["claim_integration_deliveries"]);
    expect(h.fetchCalls).toHaveLength(0);
  });

  it("`data: null` z claimu to partia pusta, nie wyjątek", async () => {
    // Prawe ramię `batch ?? []`.
    h.claim = { data: null, error: null };

    expect(await runIntegrationDispatch(20)).toEqual({ claimed: 0, delivered: 0, failed: 0 });
    expect(h.fetchCalls).toHaveLength(0);
  });

  it("pusta partia nie woła transportu ani raportu", async () => {
    h.claim = { data: [], error: null };

    expect(await runIntegrationDispatch(5)).toEqual({ claimed: 0, delivered: 0, failed: 0 });
    expect(rpcNames()).toEqual(["claim_integration_deliveries"]);
  });
});

// ---------------------------------------------------------------------------
// 3. ENDPOINT - odczyt konfiguracji odbiorcy.
// ---------------------------------------------------------------------------

describe("dispatcher - konfiguracja endpointu", () => {
  it("czyta endpoint po identyfikatorze z dostawy - trzy kolumny, jeden wiersz", async () => {
    planSingleDelivery();
    planEndpoint(endpointRow());

    await runIntegrationDispatch(1);

    const chain: RecordedChain | undefined = admin().lastChain(ENDPOINTS);
    expect(chain?.argsOf("select")).toEqual(["url, enabled, integration"]);
    expect(chain?.argsOf("eq")).toEqual(["id", IDS.endpoint]);
    expect(chain?.has("maybeSingle")).toBe(true);
  });

  it("AWARIA odczytu endpointu kończy dostawę błędem z powodem z bazy", async () => {
    planSingleDelivery();
    admin().setResponse(ENDPOINTS, fail("permission denied for table integration_endpoints"));

    expect(await runIntegrationDispatch(1)).toEqual({ claimed: 1, delivered: 0, failed: 1 });
    expect(finishCalls()).toEqual([
      {
        p_id: IDS.delivery,
        p_succeeded: false,
        p_error: "permission denied for table integration_endpoints",
      },
    ]);
    // Odmowa wyprzedza pracę: ani sekretu, ani transportu.
    expect(rpcNames()).not.toContain("integration_endpoint_get_secret");
    expect(h.fetchCalls).toHaveLength(0);
  });

  it("BRAK wiersza endpointu ma własny, nazwany powód", async () => {
    // Prawe ramię `endpointError?.message ?? "endpoint missing"`: dostawa
    // osierocona po usunięciu endpointu nie może raportować pustego powodu.
    planSingleDelivery();
    planEndpoint(null);

    expect(await runIntegrationDispatch(1)).toEqual({ claimed: 1, delivered: 0, failed: 1 });
    expect(finishCalls().at(0)?.p_error).toBe("endpoint missing");
    expect(h.fetchCalls).toHaveLength(0);
  });

  it("endpoint WYŁĄCZONY jest pomijany bez czytania sekretu i bez HTTP", async () => {
    // To jest umowa opisana w panelu („wpis wyłączony jest pomijany - nie ma
    // retry"). Sekret wyłączonego endpointu nie ma prawa opuścić Vaulta.
    planSingleDelivery();
    planEndpoint(endpointRow({ enabled: false }));

    expect(await runIntegrationDispatch(1)).toEqual({ claimed: 1, delivered: 0, failed: 1 });
    expect(finishCalls().at(0)?.p_error).toBe("endpoint disabled");
    expect(rpcNames()).not.toContain("integration_endpoint_get_secret");
    expect(h.fetchCalls).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 4. SEKRET Z VAULTA - klucz nieustawiony, nieprawidłowy, fałszywy ale prawidłowy.
// ---------------------------------------------------------------------------

describe("dispatcher - sekret endpointu", () => {
  it("czyta sekret RPC-em service_role po identyfikatorze endpointu", async () => {
    planSingleDelivery();
    planEndpoint(endpointRow());

    await runIntegrationDispatch(1);

    expect(rpcArgs("integration_endpoint_get_secret")).toEqual({ _endpoint_id: IDS.endpoint });
  });

  it("webhook z kluczem: podpis HMAC-SHA256 (hex) w `x-nes-signature`", async () => {
    const payload = envelope();
    planSingleDelivery({ payload });
    planEndpoint(endpointRow());
    h.secret = FAKE_SECRET;

    await runIntegrationDispatch(1);

    const call = lastFetch();
    // Podpisywane jest DOKŁADNIE to, co idzie w body - inaczej odbiorca odrzuci
    // każdą dostawę.
    expect(call.init.body).toBe(JSON.stringify(payload));
    expect(headerOf(call, SIGNATURE_HEADER)).toBe(
      expectedHmac(FAKE_SECRET, JSON.stringify(payload)),
    );
    expect(headerOf(call, SIGNATURE_HEADER)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("ROTACJA klucza zmienia podpis - ten sam ładunek, inny sekret", async () => {
    const payload = envelope();
    planSingleDelivery({ payload });
    planEndpoint(endpointRow());
    h.secret = FAKE_SECRET;
    await runIntegrationDispatch(1);
    const first = headerOf(lastFetch(), SIGNATURE_HEADER);

    h.secret = FAKE_SECRET_B;
    await runIntegrationDispatch(1);
    const second = headerOf(lastFetch(), SIGNATURE_HEADER);

    expect(first).not.toBe(second);
    expect(second).toBe(expectedHmac(FAKE_SECRET_B, JSON.stringify(payload)));
  });

  it.each([
    { label: "brak wiersza w Vault (`null`)", secret: null },
    { label: "wartość fałszywa ale prawidłowa (pusty łańcuch)", secret: "" },
    { label: "wartość spoza łańcucha (liczba z jsonb)", secret: 12345 },
    { label: "wartość spoza łańcucha (obiekt z jsonb)", secret: { value: "x" } },
  ])("webhook BEZ użytecznego klucza ($label) leci BEZ podpisu", async ({ secret }) => {
    // Kontrakt (nie życzenie): generyczny webhook bez sekretu wysyła dostawę
    // NIEPODPISANĄ - identycznie jak przed adapterami. Konsekwencja jest realna:
    // odbiorca nie ma czym zweryfikować nadawcy, więc panel MUSI pokazywać taki
    // endpoint jako „sekret nieustawiony” (i pokazuje - patrz test panelu).
    planSingleDelivery();
    planEndpoint(endpointRow());
    h.secret = secret;

    expect(await runIntegrationDispatch(1)).toEqual({ claimed: 1, delivered: 1, failed: 0 });
    const call = lastFetch();
    expect(headerOf(call, SIGNATURE_HEADER)).toBeUndefined();
    expect(Object.keys(call.init.headers ?? {})).not.toContain(SIGNATURE_HEADER);
  });

  it("HubSpot BEZ tokenu NIE UDAJE działającej integracji - dostawa nieudana, zero HTTP", async () => {
    // Najdroższy przypadek całego modułu: endpoint bez tokenu, który „działa”.
    // Powód musi nazywać brakujący sekret, bo to jedyna wskazówka dla operatora.
    planSingleDelivery();
    planEndpoint(endpointRow({ integration: "hubspot", url: "https://api.example.com" }));
    h.secret = null;

    expect(await runIntegrationDispatch(1)).toEqual({ claimed: 1, delivered: 0, failed: 1 });
    expect(finishCalls().at(0)?.p_error).toBe("hubspot access token missing (set endpoint secret)");
    expect(h.fetchCalls).toHaveLength(0);
  });

  it("HubSpot z tokenem: `Authorization: Bearer`, doklejona ścieżka upsertu, bez podpisu", async () => {
    planSingleDelivery();
    planEndpoint(endpointRow({ integration: "hubspot", url: "https://api.example.com/" }));
    h.secret = FAKE_SECRET;

    expect(await runIntegrationDispatch(1)).toEqual({ claimed: 1, delivered: 1, failed: 0 });
    const call = lastFetch();
    expect(call.url).toBe("https://api.example.com/crm/v3/objects/contacts/batch/upsert");
    expect(headerOf(call, "authorization")).toBe(`Bearer ${FAKE_SECRET}`);
    // Token idzie w nagłówku autoryzacji - podpisu HMAC HubSpot nie zna.
    expect(headerOf(call, SIGNATURE_HEADER)).toBeUndefined();
  });

  it("KLUCZ NIEPRAWIDŁOWY: 401 od usługi ląduje w raporcie jako `HTTP 401`", async () => {
    // Wygasły token nie objawia się wyjątkiem, a odpowiedzią. Bez tego zapisu
    // operator nie ma skąd wiedzieć, że integracja przestała działać.
    planSingleDelivery();
    planEndpoint(endpointRow({ integration: "hubspot", url: "https://api.example.com" }));
    h.secret = FAKE_SECRET;
    h.fetchStatus = 401;

    expect(await runIntegrationDispatch(1)).toEqual({ claimed: 1, delivered: 0, failed: 1 });
    expect(finishCalls().at(0)?.p_error).toBe("HTTP 401");
  });

  it("SEKRET NIE WYCIEKA do raportu dostawy ani do podsumowania", async () => {
    planSingleDelivery();
    planEndpoint(endpointRow({ integration: "hubspot", url: "https://api.example.com" }));
    h.secret = FAKE_SECRET;
    h.fetchStatus = 403;

    const summary = await runIntegrationDispatch(1);

    expect(JSON.stringify(finishCalls())).not.toContain(FAKE_SECRET);
    expect(JSON.stringify(summary)).not.toContain(FAKE_SECRET);
    // Ani do logu - `console.error` jest tu jedynym kanałem wyjścia poza RPC.
    for (const call of consoleError.mock.calls) {
      expect(JSON.stringify(call)).not.toContain(FAKE_SECRET);
    }
  });
});

// ---------------------------------------------------------------------------
// 5. PARTNER CRM - profil, snapshot leada, tryb uwierzytelnienia.
// ---------------------------------------------------------------------------

describe("dispatcher - partner CRM", () => {
  it("czyta profil po `endpoint_id` i ŚWIEŻY snapshot leada po `aggregate_id`", async () => {
    // Snapshot czytany w chwili dostawy (a nie z koperty) jest sensem retry po
    // backoffie: po awarii odbiorca ma dostać stan aktualny, nie sprzed awarii.
    planSingleDelivery();
    planEndpoint(endpointRow({ integration: "crm_partner" }));
    admin().setResponse(CRM_PROFILES, ok(crmProfile()));
    admin().setResponse(CRM_LEADS, ok(leadRow({ stage: "qualified" })));

    await runIntegrationDispatch(1);

    expect(admin().lastChain(CRM_PROFILES)?.argsOf("select")).toEqual([
      "auth_kind, consent_mapping, workspace_id",
    ]);
    expect(admin().lastChain(CRM_PROFILES)?.argsOf("eq")).toEqual(["endpoint_id", IDS.endpoint]);
    expect(admin().lastChain(CRM_LEADS)?.argsOf("eq")).toEqual(["id", IDS.lead]);
    const body: unknown = JSON.parse(lastFetch().init.body ?? "null");
    expect(body).toMatchObject({ id: IDS.lead, stage: "qualified", workspace_id: IDS.workspace });
  });

  it("BRAK profilu = błąd konfiguracji: dostawa nieudana, leada NIE czytamy", async () => {
    // Prawe ramię `?? undefined` przy kontekście partnera. Odmowa wyprzedza
    // pracę - odczyt leada byłby dostępem do danych osobowych bez odbiorcy.
    planSingleDelivery();
    planEndpoint(endpointRow({ integration: "crm_partner" }));
    admin().setResponse(CRM_PROFILES, ok(null));

    expect(await runIntegrationDispatch(1)).toEqual({ claimed: 1, delivered: 0, failed: 1 });
    expect(finishCalls().at(0)?.p_error).toBe(
      "crm partner profile missing (crm_webhook_endpoints row)",
    );
    expect(admin().chainsFor(CRM_LEADS)).toHaveLength(0);
    expect(h.fetchCalls).toHaveLength(0);
  });

  it("tryb `hmac` wpisuje TEN SAM podpis w oba nagłówki kontraktu", async () => {
    planSingleDelivery();
    planEndpoint(endpointRow({ integration: "crm_partner" }));
    admin().setResponse(CRM_PROFILES, ok(crmProfile({ auth_kind: "hmac" })));
    admin().setResponse(CRM_LEADS, ok(leadRow()));

    await runIntegrationDispatch(1);

    const call = lastFetch();
    const signature = expectedHmac(FAKE_SECRET, call.init.body ?? "");
    for (const header of CRM_PARTNER_SIGNATURE_HEADERS) {
      expect(headerOf(call, header), `brak podpisu w ${header}`).toBe(signature);
    }
  });

  it.each([
    { label: "wartość spoza enumu", authKind: "basic" },
    { label: "wartość pusta", authKind: null },
  ])("tryb uwierzytelnienia $label spada do `hmac`, nie do braku podpisu", async ({ authKind }) => {
    // Lewe ramię `profile.auth_kind === "bearer" ? "bearer" : "hmac"`: profil
    // z nieznanym trybem nie może wysłać dostawy bez żadnej autoryzacji.
    planSingleDelivery();
    planEndpoint(endpointRow({ integration: "crm_partner" }));
    admin().setResponse(CRM_PROFILES, ok(crmProfile({ auth_kind: authKind })));
    admin().setResponse(CRM_LEADS, ok(leadRow()));

    await runIntegrationDispatch(1);

    const call = lastFetch();
    expect(headerOf(call, SIGNATURE_HEADER)).toMatch(/^[0-9a-f]{64}$/);
    expect(headerOf(call, "authorization")).toBeUndefined();
  });

  it("tryb `bearer` BEZ klucza kończy dostawę powodem nazywającym brak sekretu", async () => {
    planSingleDelivery();
    planEndpoint(endpointRow({ integration: "crm_partner" }));
    admin().setResponse(CRM_PROFILES, ok(crmProfile({ auth_kind: "bearer" })));
    admin().setResponse(CRM_LEADS, ok(leadRow()));
    h.secret = null;

    expect(await runIntegrationDispatch(1)).toEqual({ claimed: 1, delivered: 0, failed: 1 });
    expect(finishCalls().at(0)?.p_error).toBe("partner api key missing (set endpoint secret)");
    expect(h.fetchCalls).toHaveLength(0);
  });

  it("tryb `bearer` z kluczem autoryzuje nagłówkiem i NIE podpisuje body", async () => {
    planSingleDelivery();
    planEndpoint(endpointRow({ integration: "crm_partner" }));
    admin().setResponse(CRM_PROFILES, ok(crmProfile({ auth_kind: "bearer" })));
    admin().setResponse(CRM_LEADS, ok(leadRow()));

    expect(await runIntegrationDispatch(1)).toEqual({ claimed: 1, delivered: 1, failed: 0 });
    const call = lastFetch();
    expect(headerOf(call, "authorization")).toBe(`Bearer ${FAKE_SECRET}`);
    for (const header of CRM_PARTNER_SIGNATURE_HEADERS) {
      expect(headerOf(call, header)).toBeUndefined();
    }
  });

  it("`workspace_id` PUSTY jedzie jako `null`, nie znika z ładunku", async () => {
    // Oba ramiona `profile.workspace_id ?? null`: brak przestrzeni roboczej to
    // informacja dla odbiorcy, nie brak pola.
    planSingleDelivery();
    planEndpoint(endpointRow({ integration: "crm_partner" }));
    admin().setResponse(CRM_PROFILES, ok(crmProfile({ workspace_id: null })));
    admin().setResponse(CRM_LEADS, ok(leadRow()));

    await runIntegrationDispatch(1);

    const body: unknown = JSON.parse(lastFetch().init.body ?? "null");
    expect(body).toMatchObject({ workspace_id: null });
  });

  it("LEAD USUNIĘTY między zdarzeniem a dostawą: pomijamy bez HTTP i bez błędu", async () => {
    // Prawe ramię `(row as CrmLeadSnapshot | null) ?? null`. Dostawa kończy się
    // SUKCESEM (nie ma czego wysyłać), więc nie wchodzi w backoff do statusu
    // `dead` - i to jest zamierzone.
    planSingleDelivery();
    planEndpoint(endpointRow({ integration: "crm_partner" }));
    admin().setResponse(CRM_PROFILES, ok(crmProfile()));
    admin().setResponse(CRM_LEADS, ok(null));

    expect(await runIntegrationDispatch(1)).toEqual({ claimed: 1, delivered: 1, failed: 0 });
    expect(finishCalls()).toEqual([{ p_id: IDS.delivery, p_succeeded: true, p_error: undefined }]);
    expect(h.fetchCalls).toHaveLength(0);
  });

  it("koperta BEZ `aggregate_id` nie pyta o leada - i też jest pominięciem", async () => {
    // Lewe ramię `if (aggregateId)`: zdarzenie bez agregatu nie ma leada do
    // przeczytania, a zapytanie `id = null` przeczytałoby cudzy wiersz albo nic.
    planSingleDelivery({ payload: envelope({ aggregate_id: null }) });
    planEndpoint(endpointRow({ integration: "crm_partner" }));
    admin().setResponse(CRM_PROFILES, ok(crmProfile()));

    expect(await runIntegrationDispatch(1)).toEqual({ claimed: 1, delivered: 1, failed: 0 });
    expect(admin().chainsFor(CRM_LEADS)).toHaveLength(0);
    expect(h.fetchCalls).toHaveLength(0);
  });

  it("zdarzenie NIEMAPOWANE na partnera CRM jest pomijane - ale profil i lead są czytane", async () => {
    // Kontrakt, nie życzenie: `loadCrmPartnerContext` biegnie PRZED sprawdzeniem
    // typu zdarzenia (`dispatch.functions.ts:120-126`), więc każde niemapowane
    // zdarzenie kosztuje dwa odczyty. Zapisane tutaj, żeby zmiana kolejności
    // była widoczna jako zmiana kontraktu, a nie cicha optymalizacja.
    planSingleDelivery({ payload: envelope({ event_type: "post.published.v1" }) });
    planEndpoint(endpointRow({ integration: "crm_partner" }));
    admin().setResponse(CRM_PROFILES, ok(crmProfile()));
    admin().setResponse(CRM_LEADS, ok(leadRow()));

    expect(await runIntegrationDispatch(1)).toEqual({ claimed: 1, delivered: 1, failed: 0 });
    expect(admin().chainsFor(CRM_PROFILES)).toHaveLength(1);
    expect(admin().chainsFor(CRM_LEADS)).toHaveLength(1);
    expect(h.fetchCalls).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 6. TRANSPORT - kształt żądania, 5xx, timeout, bramka SSRF.
// ---------------------------------------------------------------------------

describe("dispatcher - transport", () => {
  it("żądanie jest POST-em bez podążania za przekierowaniem i z sygnałem przerwania", async () => {
    // `redirect: "manual"` zamyka obejście bramki SSRF przez 30x na adres
    // wewnętrzny; sygnał przerwania jest jedynym ogranicznikiem czasu dostawy.
    planSingleDelivery();
    planEndpoint(endpointRow());

    await runIntegrationDispatch(1);

    const call = lastFetch();
    expect(call.url).toBe("https://receiver.example.com/hook");
    expect(call.init.method).toBe("POST");
    expect(call.init.redirect).toBe("manual");
    expect(call.init.signal).toBeInstanceOf(AbortSignal);
    expect(headerOf(call, "content-type")).toBe("application/json");
    expect(headerOf(call, "x-nes-event")).toBe("crm_lead.created.v1");
  });

  it("bramka SSRF jest wołana PRZED transportem - jej odmowa kończy dostawę", async () => {
    // Adres endpointu konfiguruje najemca, więc bez tej bramki dispatcher jest
    // czytnikiem infrastruktury (metadata endpoint, usługi wewnętrzne).
    planSingleDelivery();
    planEndpoint(endpointRow({ url: "https://receiver.example.com/hook" }));
    h.guard.mockRejectedValue(new Error("blocked: private or reserved address"));

    expect(await runIntegrationDispatch(1)).toEqual({ claimed: 1, delivered: 0, failed: 1 });
    expect(h.guard).toHaveBeenCalledWith("https://receiver.example.com/hook");
    expect(h.fetchCalls).toHaveLength(0);
    expect(finishCalls().at(0)?.p_error).toBe("blocked: private or reserved address");
  });

  it.each([
    { label: "500 z usługi", status: 500, reason: "HTTP 500" },
    { label: "503 z usługi", status: 503, reason: "HTTP 503" },
    { label: "przekierowanie zablokowane (302)", status: 302, reason: "HTTP 302" },
  ])("$label degraduje się do dostawy nieudanej z powodem", async ({ status, reason }) => {
    // Brak fałszywego sukcesu: `response.ok` jest jedynym kryterium, a powód
    // niesie kod, po którym operator pozna awarię odbiorcy.
    planSingleDelivery();
    planEndpoint(endpointRow());
    h.fetchStatus = status;

    expect(await runIntegrationDispatch(1)).toEqual({ claimed: 1, delivered: 0, failed: 1 });
    expect(finishCalls().at(0)).toEqual({
      p_id: IDS.delivery,
      p_succeeded: false,
      p_error: reason,
    });
  });

  it("TIMEOUT (żądanie przerwane) kończy dostawę komunikatem przerwania", async () => {
    // DETERMINIZM: atrapa transportu odrzuca NATYCHMIAST błędem przerwania -
    // nie czekamy 10 sekund na `AbortController` i nie ruszamy zegara.
    const aborted = new Error("The operation was aborted due to timeout");
    aborted.name = "AbortError";
    planSingleDelivery();
    planEndpoint(endpointRow());
    h.fetchRejection = aborted;

    expect(await runIntegrationDispatch(1)).toEqual({ claimed: 1, delivered: 0, failed: 1 });
    expect(finishCalls().at(0)?.p_error).toBe("The operation was aborted due to timeout");
  });

  it("odrzucenie SPOZA `Error` ma powód zastępczy, nie `undefined`", async () => {
    // Prawe ramię `e instanceof Error ? e.message : "network error"`. Powód
    // `undefined` w raporcie znaczy „udało się” - a tu się nie udało.
    planSingleDelivery();
    planEndpoint(endpointRow());
    h.fetchRejection = "ECONNRESET";

    expect(await runIntegrationDispatch(1)).toEqual({ claimed: 1, delivered: 0, failed: 1 });
    expect(finishCalls().at(0)?.p_error).toBe("network error");
  });

  it("Slack: Block Kit pod adresem endpointu, bez podpisu i bez zmiany adresu", async () => {
    planSingleDelivery();
    planEndpoint(
      endpointRow({ integration: "slack", url: "https://hooks.example.com/services/T0" }),
    );

    expect(await runIntegrationDispatch(1)).toEqual({ claimed: 1, delivered: 1, failed: 0 });
    const call = lastFetch();
    expect(call.url).toBe("https://hooks.example.com/services/T0");
    const body: unknown = JSON.parse(call.init.body ?? "null");
    expect(body).toMatchObject({ text: expect.stringContaining("Nowy lead CRM") });
    // Incoming webhook autoryzuje sam adres - podpis HMAC nie ma tam odbiorcy.
    expect(headerOf(call, SIGNATURE_HEADER)).toBeUndefined();
  });

  it("rodzaj SPOZA enumu (`gcal`, wartość obca) idzie generyczną kopertą 1:1", async () => {
    // Nowy rodzaj w bazie bez adaptera nie może wstrzymać dostaw - koperta
    // surowa jest wariantem domyślnym i ma zostać podpisana.
    const payload = envelope({ event_type: "policy.updated.v1" });
    planSingleDelivery({ payload });
    planEndpoint(endpointRow({ integration: "cokolwiek-z-migracji" }));

    expect(await runIntegrationDispatch(1)).toEqual({ claimed: 1, delivered: 1, failed: 0 });
    const call = lastFetch();
    expect(call.init.body).toBe(JSON.stringify(payload));
    expect(headerOf(call, SIGNATURE_HEADER)).toBe(
      expectedHmac(FAKE_SECRET, JSON.stringify(payload)),
    );
  });

  it("koperta NIEPRAWIDŁOWA (jsonb spoza obiektu) nie wywala pętli", async () => {
    // Outbox trzyma jsonb - kształt jest niezaufany. Typ zdarzenia spada wtedy
    // na kolumnę dostawy, a dostawa MUSI dojść do raportu.
    h.claim = {
      data: [
        {
          id: IDS.delivery,
          endpoint_id: IDS.endpoint,
          event_type: "post.deleted.v1",
          payload: "nie-obiekt",
        },
      ],
      error: null,
    };
    planEndpoint(endpointRow());

    expect(await runIntegrationDispatch(1)).toEqual({ claimed: 1, delivered: 1, failed: 0 });
    expect(headerOf(lastFetch(), "x-nes-event")).toBe("post.deleted.v1");
    expect(lastFetch().init.body).toBe(JSON.stringify("nie-obiekt"));
  });
});

// ---------------------------------------------------------------------------
// 7. RAPORT DOSTAWY I PODSUMOWANIE PARTII.
// ---------------------------------------------------------------------------

describe("dispatcher - raport i podsumowanie", () => {
  it("dostawa udana raportuje sukces BEZ powodu błędu", async () => {
    // Lewe ramię `lastError ?? undefined`: przekazanie `null` do RPC zapisałoby
    // w bazie pusty powód przy dostawie udanej.
    planSingleDelivery();
    planEndpoint(endpointRow());

    expect(await runIntegrationDispatch(1)).toEqual({ claimed: 1, delivered: 1, failed: 0 });
    expect(finishCalls()).toEqual([{ p_id: IDS.delivery, p_succeeded: true, p_error: undefined }]);
  });

  it("AWARIA raportu jest logowana z identyfikatorem dostawy, a pętla leci dalej", async () => {
    // Nieudany raport to dostawa, która zostanie ponowiona - ale pozostałe
    // dostawy z partii nie mogą przez to zginąć.
    h.claim = {
      data: [delivery(), delivery({ id: IDS.deliveryB })],
      error: null,
    };
    planEndpoint(endpointRow());
    h.finishError = { message: "could not serialize access" };

    expect(await runIntegrationDispatch(2)).toEqual({ claimed: 2, delivered: 2, failed: 0 });
    expect(consoleError).toHaveBeenCalledTimes(2);
    expect(consoleError.mock.calls.at(0)?.[0]).toBe(
      "[integrations] finish_integration_delivery failed",
    );
    expect(consoleError.mock.calls.at(0)?.[1]).toEqual({
      deliveryId: IDS.delivery,
      message: "could not serialize access",
    });
  });

  it("partia MIESZANA liczy się osobno: sukces, wyłączony endpoint, awaria usługi", async () => {
    // Podsumowanie jest jedynym wynikiem, jaki widzi panel i cron - musi się
    // zgadzać co do jednej dostawy.
    h.claim = {
      data: [
        delivery({ id: IDS.delivery, endpoint_id: "ep-ok" }),
        delivery({ id: IDS.deliveryB, endpoint_id: "ep-off" }),
        delivery({ id: IDS.deliveryC, endpoint_id: "ep-5xx" }),
      ],
      error: null,
    };
    admin().setResponse(ENDPOINTS, (chain: RecordedChain) => {
      const id = chain.argsOf("eq")?.[1];
      if (id === "ep-off") return ok(endpointRow({ enabled: false }));
      return ok(endpointRow());
    });
    // Trzecia dostawa pada na transporcie: status ustawiamy po dwóch udanych.
    let sent = 0;
    vi.stubGlobal("fetch", (url: string, init: DispatchFetchInit) => {
      sent += 1;
      h.fetchStatus = sent >= 2 ? 500 : 200;
      return fetchStub(url, init);
    });

    expect(await runIntegrationDispatch(3)).toEqual({ claimed: 3, delivered: 1, failed: 2 });
    expect(finishCalls().map((call) => call.p_succeeded)).toEqual([true, false, false]);
    expect(finishCalls().map((call) => call.p_error)).toEqual([
      undefined,
      "endpoint disabled",
      "HTTP 500",
    ]);
  });

  it("każda dostawa z partii dostaje SWÓJ raport - żadna nie zostaje bez zamknięcia", async () => {
    // Dostawa bez raportu zostaje w statusie `delivering` na zawsze: kolejny
    // claim jej nie weźmie (FOR UPDATE SKIP LOCKED po statusie), więc cicho
    // ginie.
    h.claim = {
      data: [delivery(), delivery({ id: IDS.deliveryB }), delivery({ id: IDS.deliveryC })],
      error: null,
    };
    planEndpoint(endpointRow());

    await runIntegrationDispatch(3);

    expect(finishCalls().map((call) => call.p_id)).toEqual([
      IDS.delivery,
      IDS.deliveryB,
      IDS.deliveryC,
    ]);
  });
});
