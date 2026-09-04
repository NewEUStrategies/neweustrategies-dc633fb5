// KONTRAKT FAIL-CLOSED PUBLICZNEGO /mcp: `src/lib/mcp/index.ts`.
//
// PO CO TEN PLIK ISTNIEJE. Do 04.09.2026 moduł miał 0/4 linii i 0/7 gałęzi -
// ani jednego testu. Stoją w nim dwa mechanizmy, których awaria kosztuje
// wszystko, i oba mają w kodzie zapisaną historię:
//
//   1. MODUŁ KIEDYŚ RZUCAŁ NA INICJALIZACJI przy braku `SUPABASE_URL`, a jest
//      TRANZYTYWNIE ładowany przez drzewo tras SSR przy KAŻDYM żądaniu. Rzut
//      przy zimnym workerze, prerenderze albo źle skonfigurowanym wdrożeniu
//      „brought the WHOLE site down with h3's HTTPError 500 - a
//      presentation-layer defect gating unrelated pages" (:12-22). Naprawą było
//      podstawienie składniowo poprawnego, ale NIEOSIĄGALNEGO wystawcy
//      `https://mcp-unconfigured.invalid/auth/v1`: każdy token pada na JWKS
//      z 401, a reszta serwisu renderuje się dalej. Dowodem tej naprawy jest
//      test, który IMPORTUJE moduł BEZ konfiguracji i NIE dostaje wyjątku -
//      bez niego nikt nie zauważy powrotu rzutu, dopóki nie położy witryny.
//
//   2. `auth: undefined` PRZEŁĄCZA SDK W TRYB NIEUWIERZYTELNIONY i otwiera
//      wszystkie narzędzia dla każdego (:12-14). Dlatego gałąź awaryjna nie
//      może „po prostu pominąć" `auth`. Ten plik asertuje WPROST, że `auth`
//      JEST OBECNE W OBU GAŁĘZIACH - to jest najważniejsza asercja w pliku.
//      Zwróć uwagę, że nie da się jej zastąpić sprawdzeniem wystawcy: `auth:
//      undefined` nie ma wystawcy do porównania, więc test patrzący tylko na
//      `issuer` przechodziłby przez `?.` i milczał dokładnie w świecie
//      otwartego endpointu.
//
// CO JEST PRZEDMIOTEM DOWODU:
//   * z `SUPABASE_URL` -> `issuer = <url>/auth/v1` z OBCIĘTYMI końcowymi
//     ukośnikami (:23-24). Ukośniki nie są kosmetyką: `iss` w tokenie Supabase
//     jest porównywany DOKŁADNIE, więc `https://x.example.com//auth/v1`
//     odrzuciłby każdy prawidłowy token - awaria po stronie ZAMKNIĘTEJ, ale
//     nadal awaria,
//   * bez `SUPABASE_URL` -> wystawca `mcp-unconfigured.invalid`, `console.warn`
//     wyemitowany (jedyny sygnał dla operatora), `auth` OBECNE,
//   * `VITE_SUPABASE_URL` jako awaryjne źródło adresu,
//   * polityka akceptacji tokenu (`acceptedAudiences`) przeżywa OBIE gałęzie,
//   * tożsamość serwera i skład narzędzi: trzy narzędzia, unikalne nazwy.
//
// DLACZEGO `vi.resetModules()` I DYNAMICZNY IMPORT. Obie gałęzie rozstrzygają
// się RAZ, na poziomie modułu, przy pierwszym imporcie. Bez zrzucenia rejestru
// modułów drugi przypadek testowy dostałby zapamiętany wynik pierwszego, więc
// jedna z dwóch gałęzi nigdy by się nie wykonała - i to jest dokładnie ta
// gałąź, która decyduje o tym, czy endpoint jest zamknięty.
//
// CZEGO NIE ATRAPUJEMY. `@lovable.dev/mcp-js` zostaje PRAWDZIWY. `defineMcp`
// nie jest funkcją tożsamościową: waliduje nazwy, sprawdza `auth` przez
// `parseSafeUrl` i ZAMRAŻA wynik. Atrapa zdjęłaby z testu właśnie tę walidację,
// czyli mechanizm, który przy złym wystawcy RZUCA na inicjalizacji - a to jest
// przedmiot dowodu numer 1. Nie atrapujemy też `@/lib/mcp/supabaseClient` ani
// narzędzi: to moduły z tego samego zlecenia, a atrapowanie pokrywanego kodu
// zamienia plik w test atrapy.
//
// Bez sieci i bez prawdziwych sekretów: adresy w `example.com`.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// --- typy i pomocnicy -------------------------------------------------------

/**
 * Kształt definicji MCP odczytany z MODUŁU, a nie z pakietu: `@lovable.dev/mcp-js`
 * nie eksportuje typów `McpDefinition`/`McpAuthConfig` po nazwie, a rzutowań
 * w tym repo nie ma. `typeof import(...)` daje ten sam typ bez `any`.
 */
type McpDefinitionShape = (typeof import("@/lib/mcp/index"))["default"];
type McpAuthShape = NonNullable<McpDefinitionShape["auth"]>;

/** Zmienne środowiskowe, z których moduł wyprowadza wystawcę. */
interface IssuerEnv {
  readonly supabaseUrl?: string;
  readonly viteSupabaseUrl?: string;
}

/**
 * Ładuje moduł od zera pod zadanym środowiskiem. Zwraca też zebrane
 * ostrzeżenia, bo `console.warn` jest JEDYNYM sygnałem gałęzi awaryjnej i musi
 * być mierzony w tym samym akcie co import.
 */
async function loadMcp(env: IssuerEnv): Promise<{
  mcp: McpDefinitionShape;
  warnings: unknown[][];
}> {
  vi.resetModules();
  vi.stubEnv("SUPABASE_URL", env.supabaseUrl);
  vi.stubEnv("VITE_SUPABASE_URL", env.viteSupabaseUrl);
  const warnings: unknown[][] = [];
  const warn = vi.spyOn(console, "warn").mockImplementation((...args: unknown[]) => {
    warnings.push(args);
  });
  try {
    const mod = await import("@/lib/mcp/index");
    return { mcp: mod.default, warnings };
  } finally {
    warn.mockRestore();
  }
}

/**
 * STRAŻNIK, nie rzutowanie: sprawdza w RUNTIME, że konfiguracja uwierzytelniania
 * istnieje, i dopiero wtedy zawęża typ. Komunikat wyjątku niesie powód, dla
 * którego to sprawdzenie tu stoi - brak `auth` to otwarty publiczny endpoint,
 * a nie brakujące pole opcjonalne.
 */
function authOf(mcp: McpDefinitionShape): McpAuthShape {
  const cfg = mcp.auth;
  if (!cfg) {
    throw new Error(
      "test: definicja MCP nie ma `auth` - SDK działałby w trybie nieuwierzytelnionym",
    );
  }
  return cfg;
}

const URL_OK = "https://db.example.com";
const UNREACHABLE_ISSUER = "https://mcp-unconfigured.invalid/auth/v1";

beforeEach(() => {
  vi.unstubAllEnvs();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("definicja MCP - wystawca wyprowadzony z konfiguracji", () => {
  it("skleja wystawcę jako <SUPABASE_URL>/auth/v1", async () => {
    const { mcp } = await loadMcp({ supabaseUrl: URL_OK });

    expect(authOf(mcp).issuer).toBe("https://db.example.com/auth/v1");
  });

  // `iss` porównuje się DOKŁADNIE, więc podwójny ukośnik odrzuciłby każdy
  // prawidłowy token. Trzy ukośniki, bo strażnik to `/\/+$/` - jeden by nie
  // odróżnił obcięcia od jego braku.
  it("obcina WSZYSTKIE końcowe ukośniki adresu", async () => {
    const { mcp } = await loadMcp({ supabaseUrl: "https://db.example.com///" });

    expect(authOf(mcp).issuer).toBe("https://db.example.com/auth/v1");
  });

  it("adres bez ukośnika i z ukośnikiem dają IDENTYCZNEGO wystawcę", async () => {
    const bez = await loadMcp({ supabaseUrl: URL_OK });
    const zUkosnikiem = await loadMcp({ supabaseUrl: `${URL_OK}/` });

    expect(authOf(zUkosnikiem.mcp).issuer).toBe(authOf(bez.mcp).issuer);
  });

  // Obcięcie dotyczy WYŁĄCZNIE końca adresu - ścieżka projektu (wdrożenia za
  // proxy potrafią mieć prefiks) nie może zostać zjedzona.
  it("nie rusza ukośników w środku adresu", async () => {
    const { mcp } = await loadMcp({ supabaseUrl: "https://proxy.example.com/supabase/" });

    expect(authOf(mcp).issuer).toBe("https://proxy.example.com/supabase/auth/v1");
  });

  it("czyta VITE_SUPABASE_URL, gdy SUPABASE_URL nie ma", async () => {
    const { mcp } = await loadMcp({ viteSupabaseUrl: "https://vite.example.com" });

    expect(authOf(mcp).issuer).toBe("https://vite.example.com/auth/v1");
  });

  // Kolejność źródeł jest kontraktem wdrożenia: sekret serwerowy bez prefiksu
  // wygrywa z adresem publikowanym do bundla klienta.
  it("SUPABASE_URL wygrywa z VITE_SUPABASE_URL", async () => {
    const { mcp } = await loadMcp({
      supabaseUrl: URL_OK,
      viteSupabaseUrl: "https://vite.example.com",
    });

    expect(authOf(mcp).issuer).toBe("https://db.example.com/auth/v1");
  });

  it("skonfigurowana ścieżka nie emituje ostrzeżenia operatora", async () => {
    const { warnings } = await loadMcp({ supabaseUrl: URL_OK });

    expect(warnings).toHaveLength(0);
  });
});

describe("definicja MCP - gałąź fail-closed bez konfiguracji", () => {
  // TO JEST NAJWAŻNIEJSZA ASERCJA W PLIKU. `auth: undefined` = otwarte
  // narzędzia dla każdego. Asercja jest WPROST na obecności `auth`, bo żadna
  // asercja o wystawcy nie odróżni braku `auth` od wystawcy nieoczekiwanego.
  it("BEZ konfiguracji `auth` NADAL JEST OBECNE - endpoint się nie otwiera", async () => {
    const { mcp } = await loadMcp({});

    expect(mcp.auth).toBeDefined();
    expect(mcp.auth).not.toBeUndefined();
    expect("auth" in mcp).toBe(true);
    expect(authOf(mcp).type).toBe("oauth");
  });

  it("Z konfiguracją `auth` też jest obecne - dowód jest o OBU gałęziach", async () => {
    const { mcp } = await loadMcp({ supabaseUrl: URL_OK });

    expect(mcp.auth).toBeDefined();
    expect(authOf(mcp).type).toBe("oauth");
  });

  it("podstawia nieosiągalnego wystawcę mcp-unconfigured.invalid", async () => {
    const { mcp } = await loadMcp({});

    expect(authOf(mcp).issuer).toBe(UNREACHABLE_ISSUER);
  });

  // `.invalid` jest TLD zarezerwowanym (RFC 2606) - nazwa NIGDY się nie
  // rozwiąże, więc pobranie JWKS pada, a każdy token dostaje 401. Na tym stoi
  // cały zamek: nie na braku klucza, a na nieosiągalności wystawcy.
  it("wystawca awaryjny jest w zarezerwowanej domenie .invalid", async () => {
    const { mcp } = await loadMcp({});
    const issuer = new URL(authOf(mcp).issuer);

    expect(issuer.hostname.endsWith(".invalid")).toBe(true);
    expect(issuer.protocol).toBe("https:");
    expect(issuer.pathname).toBe("/auth/v1");
  });

  it("emituje ostrzeżenie operatora nazywające brakującą zmienną", async () => {
    const { warnings } = await loadMcp({});

    expect(warnings).toHaveLength(1);
    expect(String(warnings[0][0])).toContain("SUPABASE_URL");
    expect(String(warnings[0][0])).toContain("fail-closed");
  });

  // TO JEST DOWÓD OPISANEGO INCYDENTU. Moduł jest ładowany tranzytywnie przez
  // drzewo tras SSR przy KAŻDYM żądaniu, więc rzut na inicjalizacji kładzie
  // CAŁĄ witrynę, nie tylko /mcp. Import bez konfiguracji MUSI się udać.
  it("import BEZ konfiguracji nie rzuca - nie kładzie drzewa tras SSR", async () => {
    await expect(loadMcp({})).resolves.toBeDefined();
  });

  it("pusty SUPABASE_URL traktuje jak brak - też nie rzuca i zostaje zamknięty", async () => {
    const { mcp, warnings } = await loadMcp({ supabaseUrl: "", viteSupabaseUrl: "" });

    expect(authOf(mcp).issuer).toBe(UNREACHABLE_ISSUER);
    expect(warnings).toHaveLength(1);
  });

  // Polityka akceptacji tokenu nie może wyparować razem z konfiguracją: gdyby
  // `acceptedAudiences` zniknęło w gałęzi awaryjnej, `defineMcp` odrzuciłby
  // definicję (rzut na inicjalizacji) - czyli wróciłby incydent numer 1.
  it("polityka akceptacji tokenu przeżywa gałąź awaryjną", async () => {
    const { mcp } = await loadMcp({});

    expect(authOf(mcp).acceptedAudiences).toEqual(["authenticated"]);
  });

  it("polityka akceptacji tokenu jest ta sama w obu gałęziach", async () => {
    const skonfigurowany = await loadMcp({ supabaseUrl: URL_OK });
    const awaryjny = await loadMcp({});

    expect(authOf(awaryjny.mcp).acceptedAudiences).toEqual(
      authOf(skonfigurowany.mcp).acceptedAudiences,
    );
  });
});

describe("definicja MCP - polityka akceptacji i tożsamość zasobu", () => {
  // `acceptedAudiences: "authenticated"` podane STRINGIEM musi wyjść TABLICĄ:
  // `defineMcp` waliduje wyłącznie tablicę i rzuciłby na stringu, a rzut tutaj
  // to znowu położona witryna.
  it("normalizuje pojedyncze `aud` do tablicy", async () => {
    const { mcp } = await loadMcp({ supabaseUrl: URL_OK });

    expect(authOf(mcp).acceptedAudiences).toEqual(["authenticated"]);
  });

  it("nazywa zasób chroniony dla wyzwania 401", async () => {
    const { mcp } = await loadMcp({ supabaseUrl: URL_OK });

    expect(authOf(mcp).resourceName).toBe("NEW EU Strategies MCP");
  });

  // Weryfikator jest wyłącznie JWKS-owy (`defineMcp` odrzuca HS* i "none"), a
  // definicja świadomie nie zawęża algorytmów. Przypinamy to, żeby wpisanie tu
  // kiedyś algorytmu z kluczem współdzielonym było widoczną zmianą.
  it("nie zawęża algorytmów - weryfikacja idzie przez JWKS wystawcy", async () => {
    const { mcp } = await loadMcp({ supabaseUrl: URL_OK });

    expect(authOf(mcp).algorithms).toBeUndefined();
    expect(authOf(mcp).jwksUri).toBeUndefined();
  });
});

describe("definicja MCP - tożsamość serwera i skład narzędzi", () => {
  it("wystawia trzy narzędzia przeglądania treści w zadeklarowanej kolejności", async () => {
    const { mcp } = await loadMcp({ supabaseUrl: URL_OK });

    expect(mcp.tools.map((t) => t.name)).toEqual([
      "search_posts",
      "get_post",
      "list_recent_posts",
    ]);
  });

  it("nazwy narzędzi są unikalne - to warunek przejścia przez defineMcp", async () => {
    const { mcp } = await loadMcp({ supabaseUrl: URL_OK });
    const nazwy = mcp.tools.map((t) => t.name);

    expect(new Set(nazwy).size).toBe(nazwy.length);
  });

  it("podaje tożsamość serwera czytaną przez klientów MCP", async () => {
    const { mcp } = await loadMcp({ supabaseUrl: URL_OK });

    expect(mcp.name).toBe("neweustrategies-mcp");
    expect(mcp.title).toBe("NEW EU Strategies");
    expect(mcp.version).toBe("0.1.0");
  });

  // Instrukcja serwera jest tekstem, po którym model wybiera narzędzie. Puste
  // `instructions` przechodzi walidację, więc bramką jest ten test: instrukcja
  // musi nazywać wszystkie trzy narzędzia, inaczej model ich nie znajdzie.
  it("instrukcja serwera nazywa każde z trzech narzędzi", async () => {
    const { mcp } = await loadMcp({ supabaseUrl: URL_OK });

    for (const nazwa of ["list_recent_posts", "search_posts", "get_post"]) {
      expect(mcp.instructions).toContain(nazwa);
    }
  });

  // Definicja jest ZAMROŻONA przez `defineMcp`. To nie kosmetyka: ten sam
  // obiekt jest współdzielony przez wszystkie żądania SSR, więc podmiana
  // `auth` po inicjalizacji byłaby zdjęciem bramki na żywo.
  it("konfiguracja uwierzytelniania jest zamrożona", async () => {
    const { mcp } = await loadMcp({ supabaseUrl: URL_OK });

    expect(Object.isFrozen(authOf(mcp))).toBe(true);
    expect(Object.isFrozen(mcp.tools)).toBe(true);
  });
});
