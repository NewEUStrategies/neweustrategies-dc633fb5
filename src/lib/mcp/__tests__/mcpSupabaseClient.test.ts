// IZOLACJA NAJEMCY NA PUBLICZNYM /mcp: `mcpSupabase()` z `src/lib/mcp/supabaseClient.ts`.
//
// PO CO TEN PLIK ISTNIEJE. Cała izolacja najemcy trzech narzędzi MCP wisi na
// JEDNEJ funkcji, a jej awaria jest CICHA. Do 04.09.2026 plik miał 0/5 linii,
// 0/6 gałęzi i 0/1 funkcji - ani jednego testu. Komentarz w kodzie
// (`supabaseClient.ts`:1-5) opisuje mechanizm wprost: goły `createClient()` NIE
// wysyła nagłówka `x-tenant-host`, więc SQL-owa `public.public_tenant_id()`
// spada na najemcę DOMYŚLNEGO i narzędzia serwują treść ZŁEJ STRONY na
// wdrożeniu wielonajemcowym. Bez wyjątku, bez kodu błędu, bez wpisu w logu -
// odpowiedź jest poprawna składniowo i dotyczy nie tej witryny, o którą pytał
// wołający. Regresja tego rodzaju nie ma jak się ujawnić inaczej niż testem
// patrzącym na ARGUMENTY `createClient`.
//
// CO JEST PRZEDMIOTEM DOWODU. Trzy niezależne rzeczy:
//   1. host obecny -> klient jest OZNACZONY nagłówkiem `x-tenant-host` o
//      dokładnie tej wartości (i tylko nim - żadnych nagłówków dodatkowych),
//   2. host `null` -> nagłówek jest POMINIĘTY, a nie wysłany jako pusty `""`.
//      To rozróżnienie jest istotą gałęzi `host ? {...} : {}` (:16): pusty
//      nagłówek TRAFIŁBY do `public.request_public_host()` jako wartość i mógłby
//      zmienić rozstrzygnięcie najemcy, podczas gdy brak nagłówka jest
//      świadomie zdefiniowanym „brak podpowiedzi o najemcy",
//   3. brak konfiguracji backendu (`SUPABASE_URL` albo `SUPABASE_PUBLISHABLE_KEY`)
//      -> `null` ORAZ ani jedno wywołanie `createClient`. Zwrot `null` jest
//      kontraktem, na którym stoi „Backend not configured" w trzech
//      narzędziach; gdyby funkcja zaczęła zwracać klienta bez klucza, narzędzia
//      przeszłyby do zapytania i oddały błąd PostgREST zamiast czytelnej
//      odmowy.
//
// KLUCZ NAGŁÓWKA ASERTUJEMY PRZEZ STAŁĄ `TENANT_HOST_HEADER`, nie przez własny
// literał. Kod produkcyjny wpisuje `"x-tenant-host"` z ręki, a stała z
// `@/lib/http/host` jest tym samym ciągiem, który czyta funkcja SQL
// `public.request_public_host()`. Porównanie z nią zamyka pętlę dryfu: literówka
// w narzędziu MCP albo zmiana nazwy nagłówka po stronie SQL zapala ten test,
// zamiast po cichu odciąć narzędzia od właściwego najemcy.
//
// GRANICE, KTÓRE ATRAPUJEMY, I DLACZEGO:
//   * `@supabase/supabase-js` - `createClient` jako SZPIEG. To jedyny sposób
//     zobaczyć nagłówek: prawdziwy klient wysłałby go dopiero w żądaniu
//     sieciowym, a testy w tym repo nie chodzą do sieci,
//   * `@/lib/http/requestHost` (`currentTenantHost`) - to SĄSIEDNI moduł
//     z własnym zleceniem (`requestHost.server.ts` jest tu nietykalny).
//     Atrapa jest instrumentem podania hosta, nie zastępstwem dowodu o nim.
// PRAWDZIWE zostaje `mcpSupabase()` - czyli ten moduł, który pokrywamy. Jego
// zaatrapowanie zamieniłoby plik w test atrapy (to jest przyczyna, dla której
// `require-staff.ts` stał na zerze przy 39 plikach testowych).
//
// Bez sieci i bez prawdziwych sekretów: adresy w `example.com`, klucz to
// oczywisty ciąg testowy.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { TENANT_HOST_HEADER } from "@/lib/http/host";

// --- atrapy granic ----------------------------------------------------------

/** Opcje, z jakimi kod produkcyjny woła `createClient` - tylko pola, o które toczy się dowód. */
interface McpClientOptions {
  readonly auth?: { readonly persistSession?: boolean; readonly autoRefreshToken?: boolean };
  readonly global?: { readonly headers?: Record<string, string> };
}

interface CreateClientCall {
  readonly url: string;
  readonly key: string;
  readonly options: McpClientOptions;
}

const spy = vi.hoisted(() => ({
  calls: [] as CreateClientCall[],
  /** Obiekty zwrócone przez atrapę - do dowodu tożsamości zwracanego klienta. */
  returned: [] as object[],
  host: null as string | null,
}));

vi.mock("@supabase/supabase-js", () => ({
  createClient: (url: string, key: string, options: McpClientOptions) => {
    spy.calls.push({ url, key, options });
    const client = { mcpAnonClient: spy.calls.length };
    spy.returned.push(client);
    return client;
  },
}));

vi.mock("@/lib/http/requestHost", () => ({
  currentTenantHost: () => Promise.resolve(spy.host),
}));

import { mcpSupabase } from "@/lib/mcp/supabaseClient";

// --- pomocnicy --------------------------------------------------------------

const URL_OK = "https://db.example.com";
const KEY_OK = "publishable-key-testowy";

/** Konfiguracja backendu obecna - punkt wyjścia większości przypadków. */
function configureBackend(): void {
  vi.stubEnv("SUPABASE_URL", URL_OK);
  vi.stubEnv("SUPABASE_PUBLISHABLE_KEY", KEY_OK);
}

/**
 * Ostatnie wywołanie `createClient` - z twardym błędem, gdy go nie było.
 * Wyjątek zamiast `undefined`, bo test „przechodzący" na braku wywołania nie
 * dowodziłby niczego o nagłówku.
 */
function lastCall(): CreateClientCall {
  const call = spy.calls.at(-1);
  if (!call) throw new Error("test: `createClient` nie został zawołany ani raz");
  return call;
}

beforeEach(() => {
  spy.calls.length = 0;
  spy.returned.length = 0;
  spy.host = null;
  vi.unstubAllEnvs();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("mcpSupabase - oznaczenie klienta hostem najemcy", () => {
  it("dokłada nagłówek x-tenant-host o wartości hosta z bieżącego żądania", async () => {
    configureBackend();
    spy.host = "pl.example.com";

    const client = await mcpSupabase();

    expect(client).not.toBeNull();
    expect(lastCall().options.global?.headers).toEqual({ [TENANT_HOST_HEADER]: "pl.example.com" });
  });

  // Klucz nagłówka MUSI być tym samym ciągiem, który czyta
  // `public.request_public_host()`. Dowód przez stałą, nie przez literał.
  it("używa dokładnie klucza nagłówka wspólnego z warstwą SQL", async () => {
    configureBackend();
    spy.host = "pl.example.com";

    await mcpSupabase();

    expect(Object.keys(lastCall().options.global?.headers ?? {})).toEqual([TENANT_HOST_HEADER]);
    expect(TENANT_HOST_HEADER).toBe("x-tenant-host");
  });

  // Różne hosty muszą dawać różne oznaczenia. Bez tego przypadku test wyżej
  // przechodziłby też w świecie, w którym host jest zaszyty na stałe.
  it("przenosi KAŻDY host, nie jeden zaszyty na stałe", async () => {
    configureBackend();

    spy.host = "pl.example.com";
    await mcpSupabase();
    spy.host = "en.example.org";
    await mcpSupabase();

    expect(spy.calls.map((c) => c.options.global?.headers?.[TENANT_HOST_HEADER])).toEqual([
      "pl.example.com",
      "en.example.org",
    ]);
  });

  it("oddaje TEN klient, który zbudował - bez owijki gubiącej nagłówki", async () => {
    configureBackend();
    spy.host = "pl.example.com";

    const client = await mcpSupabase();

    expect(client).toBe(spy.returned[0]);
  });

  it("przekazuje adres i klucz publikowalny z konfiguracji serwera", async () => {
    configureBackend();
    spy.host = "pl.example.com";

    await mcpSupabase();

    expect(lastCall().url).toBe(URL_OK);
    expect(lastCall().key).toBe(KEY_OK);
  });

  // Klient MCP obsługuje żądanie anonimowe i nie ma prawa utrwalać ani
  // odświeżać sesji: zapis sesji w środowisku serwerowym przeciekałby stan
  // między żądaniami różnych najemców.
  it("nie utrwala i nie odświeża sesji", async () => {
    configureBackend();
    spy.host = "pl.example.com";

    await mcpSupabase();

    expect(lastCall().options.auth).toEqual({ persistSession: false, autoRefreshToken: false });
  });
});

describe("mcpSupabase - brak hosta pomija nagłówek, a nie wysyła pustego", () => {
  // TO JEST SEDNO GAŁĘZI `host ? {...} : {}` (:16). Pusty nagłówek jest
  // WARTOŚCIĄ, którą `public.request_public_host()` odczyta i weźmie pod uwagę;
  // brak nagłówka to zdefiniowane „nie mam podpowiedzi o najemcy". Te dwa
  // światy różnią się rozstrzygnięciem najemcy, więc różnica MUSI być przypięta.
  it("host null -> `global` jest puste, bez klucza x-tenant-host", async () => {
    configureBackend();
    spy.host = null;

    const client = await mcpSupabase();

    expect(client).not.toBeNull();
    const global = lastCall().options.global ?? {};
    expect(global).toEqual({});
    expect(Object.keys(global)).toEqual([]);
    expect(TENANT_HOST_HEADER in global).toBe(false);
  });

  it("host null -> nagłówek NIE jest wysłany jako pusty ciąg", async () => {
    configureBackend();
    spy.host = null;

    await mcpSupabase();

    expect(lastCall().options.global?.headers?.[TENANT_HOST_HEADER]).toBeUndefined();
    expect(lastCall().options.global?.headers).toBeUndefined();
  });

  // Host pusty jest tą samą gałęzią co `null` i to jest zamierzone:
  // `normalizeHost` oddaje `null` dla pustego wejścia, ale gdyby kiedyś oddał
  // `""`, strażnik `host ?` nadal ma pominąć nagłówek zamiast wysłać puste pole.
  it("host pusty traktuje jak brak hosta", async () => {
    configureBackend();
    spy.host = "";

    await mcpSupabase();

    expect(lastCall().options.global).toEqual({});
  });

  // Brak hosta NIE jest awarią: poza zasięgiem żądania (rozgrzewka, prerender)
  // narzędzia mają dalej działać na najemcy domyślnym.
  it("brak hosta nie odbiera klienta", async () => {
    configureBackend();
    spy.host = null;

    expect(await mcpSupabase()).not.toBeNull();
    expect(spy.calls).toHaveLength(1);
  });
});

describe("mcpSupabase - brak konfiguracji backendu oddaje null", () => {
  // `null` jest KONTRAKTEM: na nim stoi czytelne „Backend not configured"
  // z `isError: true` we wszystkich trzech narzędziach. Klient zbudowany bez
  // klucza dałby zamiast tego surowy błąd PostgREST.
  it("brak SUPABASE_URL -> null i ani jedno wywołanie createClient", async () => {
    vi.stubEnv("SUPABASE_URL", undefined);
    vi.stubEnv("SUPABASE_PUBLISHABLE_KEY", KEY_OK);
    spy.host = "pl.example.com";

    expect(await mcpSupabase()).toBeNull();
    expect(spy.calls).toHaveLength(0);
  });

  it("brak SUPABASE_PUBLISHABLE_KEY -> null i ani jedno wywołanie createClient", async () => {
    vi.stubEnv("SUPABASE_URL", URL_OK);
    vi.stubEnv("SUPABASE_PUBLISHABLE_KEY", undefined);
    spy.host = "pl.example.com";

    expect(await mcpSupabase()).toBeNull();
    expect(spy.calls).toHaveLength(0);
  });

  it("brak obu zmiennych -> null", async () => {
    vi.stubEnv("SUPABASE_URL", undefined);
    vi.stubEnv("SUPABASE_PUBLISHABLE_KEY", undefined);

    expect(await mcpSupabase()).toBeNull();
    expect(spy.calls).toHaveLength(0);
  });

  // Pusty ciąg jest w praktyce częstszy od braku zmiennej (niewypełniony sekret
  // w panelu wdrożenia), a strażnik `!url || !key` ma go łapać tak samo.
  it("pusty SUPABASE_URL traktuje jak brak konfiguracji", async () => {
    vi.stubEnv("SUPABASE_URL", "");
    vi.stubEnv("SUPABASE_PUBLISHABLE_KEY", KEY_OK);

    expect(await mcpSupabase()).toBeNull();
    expect(spy.calls).toHaveLength(0);
  });

  it("pusty SUPABASE_PUBLISHABLE_KEY traktuje jak brak konfiguracji", async () => {
    vi.stubEnv("SUPABASE_URL", URL_OK);
    vi.stubEnv("SUPABASE_PUBLISHABLE_KEY", "");

    expect(await mcpSupabase()).toBeNull();
    expect(spy.calls).toHaveLength(0);
  });

  // Odmowa MUSI wyprzedzać odczyt hosta: gdyby kolejność była odwrotna, brak
  // konfiguracji na ścieżce SSR ciągnąłby cały rezolwer najemcy przy każdym
  // żądaniu bez żadnego pożytku.
  it("odmawia PRZED zapytaniem o host najemcy", async () => {
    const hostReads: number[] = [];
    spy.host = "pl.example.com";
    vi.stubEnv("SUPABASE_URL", undefined);
    vi.stubEnv("SUPABASE_PUBLISHABLE_KEY", undefined);
    const requestHost = await import("@/lib/http/requestHost");
    const watched = vi.spyOn(requestHost, "currentTenantHost").mockImplementation(() => {
      hostReads.push(1);
      return Promise.resolve("pl.example.com");
    });

    expect(await mcpSupabase()).toBeNull();
    expect(hostReads).toHaveLength(0);

    watched.mockRestore();
  });
});
