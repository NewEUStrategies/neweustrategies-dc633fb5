// PO CO TEN PLIK. `gsc.functions.ts` to cała warstwa danych Search Console
// w panelu BI - trzy serwerowe funkcje wchodzące tu z 16,2 % linii (6 z 37)
// i ZEREM funkcji (0 z 8). Pokryte były wyłącznie deklaracje na górze pliku;
// ani jeden handler, ani jedna gałąź błędu, ani bramka roli nie były dotknięte.
//
// Ten moduł jest inny niż reszta analityki i to jest źródłem jego defektów:
// nie rozmawia z Google bezpośrednio, tylko przez WSPÓLNĄ bramkę konektora,
// uwierzytelnianą DWOMA globalnymi kluczami ze środowiska. Stąd cztery klasy
// defektów, których nikt tu dotąd nie łapał:
//
//  1) KLUCZ W NAGŁÓWKU, KLUCZ W KOMUNIKACIE BŁĘDU. `gwHeaders()` wkłada
//     `LOVABLE_API_KEY` do `Authorization` i `GOOGLE_SEARCH_CONSOLE_API_KEY`
//     do `X-Connection-Api-Key`, a `gwFetch` skleja komunikat błędu z
//     odpowiedzi bramki i RZUCA go do przeglądarki. Wystarczy, żeby ktoś
//     dorzucił do komunikatu kontekst żądania („żeby było łatwiej debugować"),
//     i klucze produkcyjne lądują w konsoli admina i w logach frontendu.
//     Testy niżej sprawdzają KAŻDĄ ścieżkę błędu pod kątem obu kluczy.
//
//  2) BRAK KONFIGURACJI JAKO AWARIA. Moduł ma na to sentinel
//     (`GSC_NOT_CONFIGURED`) i KAŻDA z trzech funkcji łapie go u siebie:
//     świeża instalacja bez konektora dostaje trzy razy uporządkowany stan
//     („nie podłączono"), a nie raz stan i dwa razy surowy wyjątek z nazwą
//     sentinela w treści. Trzy przypadki niżej pilnują tego osobno dla każdej
//     funkcji, bo załatanie jednej zostawiało dwa pozostałe kanały wycieku.
//
//  3) WEJŚCIE OD ADMINA WPROST W URL I W CIAŁO ŻĄDANIA. `siteUrl` trafia do
//     ścieżki (`sc-domain:example.com` MUSI być zakodowane, inaczej dwukropek
//     i ukośniki rozjeżdżają ścieżkę bramki), zakres dat i wymiary lecą do
//     Google jak podano. Bez walidacji granic jedno wywołanie z `rowLimit`
//     rzędu miliona albo z wymyślonym wymiarem to pewne 400 od Google - albo
//     rachunek za kwerendę, której nikt nie zamawiał.
//
//  4) DOMYŚLNE PUSTE TABLICE. Odpowiedź bramki bez `rows` / bez `siteEntry`
//     (typowa dla świeżo dodanej własności) musi dać `[]`, a nie `undefined`
//     przepuszczone do komponentu, który zaraz zrobi na tym `.map`.
//
// IZOLACJA NAJEMCÓW. Jedyny odczyt z bazy w tym module to `has_role` - i leci
// klientem WOŁAJĄCEGO, więc `current_tenant_id()` z jego JWT decyduje, czy
// rola w ogóle istnieje. Testy przepuszczają admina najemcy B przez klienta
// najemcy A i wymagają odmowy PRZED dotknięciem sieci. Świadoma granica tego
// dowodu: klucze bramki są GLOBALNE, więc każdy admin dowolnego najemcy pyta
// Google tym samym kontem konektora - zawężenie do własności robi wyłącznie
// `siteUrl` z wejścia. To własność architektury konektora, nie tego pliku,
// ale trzeba ją tu wypowiedzieć, żeby zieleń nie sugerowała więcej, niż jest.
//
// ZERO SIECI, ZERO SEKRETÓW. `fetch` jest atrapą, oba klucze to jawnie testowe
// napisy generowane w tym pliku, wszystkie adresy z example.com.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { callServerFn, validateServerFnInput, type ServerFnContext } from "@/test/serverFnHarness";

vi.mock("@tanstack/react-start", async () => {
  const { serverFnStubModule } = await import("@/test/serverFnHarness");
  return serverFnStubModule();
});
vi.mock("@/integrations/supabase/auth-middleware", () => ({
  requireSupabaseAuth: { name: "requireSupabaseAuth" },
}));

const { inspectGscUrl, listGscSites, queryGscAnalytics } = await import("../gsc.functions");
type GscSite = Awaited<ReturnType<typeof listGscSites>>["sites"][number];

const BRAMKA = "https://connector-gateway.lovable.dev/google_search_console";
const LOVABLE_KEY = "klucz-bramki-tylko-do-testu";
const GSC_KEY = "klucz-konektora-tylko-do-testu";

const TENANT_A = "11111111-1111-4111-8111-111111111111";
const TENANT_B = "22222222-2222-4222-8222-222222222222";
const ADMIN_A = "33333333-3333-4333-8333-333333333333";
const ADMIN_B = "44444444-4444-4444-8444-444444444444";
const REDAKTOR_A = "55555555-5555-4555-8555-555555555555";

/** Kto jest adminem i W KTÓRYM najemcy - odpowiednik filtra `current_tenant_id()`. */
const ROLA_ADMINA: Record<string, string> = { [ADMIN_A]: TENANT_A, [ADMIN_B]: TENANT_B };

const WITRYNA = "sc-domain:example.com";

const fetchMock = vi.fn<(input: string | URL, init?: RequestInit) => Promise<Response>>();

interface Najemca {
  readonly ctx: ServerFnContext;
  readonly rpcCalls: Array<{ fn: string; args: Record<string, unknown> }>;
}

function najemca(tenant: string, userId: string, hasRoleError?: string): Najemca {
  const rpcCalls: Najemca["rpcCalls"] = [];
  const supabase = {
    from: (table: string) => ({
      select: () => ({
        eq: () =>
          Promise.resolve({
            data: null,
            error: { message: `test: ten moduł nie ma prawa czytać tabeli "${table}"` },
          }),
      }),
    }),
    rpc: (fn: string, args: Record<string, unknown>) => {
      rpcCalls.push({ fn, args });
      if (hasRoleError) return Promise.resolve({ data: null, error: { message: hasRoleError } });
      return Promise.resolve({
        data: ROLA_ADMINA[String(args._user_id)] === tenant && args._role === "admin",
        error: null,
      });
    },
  };
  return { ctx: { supabase, userId }, rpcCalls };
}

const ADMIN = () => najemca(TENANT_A, ADMIN_A);

function odpowiedz(status: number, body: string): Response {
  return new Response(body, { status });
}

/**
 * Ciało `Response` czyta się DOKŁADNIE RAZ, a część przypadków woła bramkę
 * dwa razy (dwóch najemców). Atrapa buduje więc odpowiedź przy KAŻDYM
 * wywołaniu - wspólna instancja padałaby na „Body has already been used"
 * i udawała defekt kodu produkcyjnego.
 */
function zawsze(buduj: () => Response): void {
  fetchMock.mockImplementation(() => Promise.resolve(buduj()));
}

function json(body: unknown, status = 200): void {
  zawsze(() => odpowiedz(status, JSON.stringify(body)));
}

/** Adres i opcje N-tego wywołania bramki. */
function zadanie(i = 0): { url: string; init: RequestInit } {
  const [url, init] = fetchMock.mock.calls[i] as [string, RequestInit];
  return { url, init };
}

function naglowki(i = 0): Record<string, string> {
  return (zadanie(i).init.headers ?? {}) as Record<string, string>;
}

function cialo(i = 0): unknown {
  return JSON.parse(String(zadanie(i).init.body));
}

async function przechwycBlad(promise: Promise<unknown>): Promise<Error> {
  const wynik = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(wynik, "oczekiwano wyjątku, a wywołanie się powiodło").toBeInstanceOf(Error);
  return wynik as Error;
}

// Wywołania trzech funkcji z domyślnym, poprawnym wejściem.
function listuj(n: Najemca = ADMIN()) {
  return callServerFn<{ sites: GscSite[]; configured: boolean }>(listGscSites, { context: n.ctx });
}

function pytaj(data: unknown, n: Najemca = ADMIN()) {
  return callServerFn<{ rows: unknown[] }>(queryGscAnalytics, { data, context: n.ctx });
}

const ZAPYTANIE = {
  siteUrl: WITRYNA,
  startDate: "2026-08-01",
  endDate: "2026-08-28",
};

function inspekcja(data: unknown, n: Najemca = ADMIN()) {
  return callServerFn<{ raw: string }>(inspectGscUrl, { data, context: n.ctx });
}

const INSPEKCJA = {
  inspectionUrl: "https://example.com/artykul",
  siteUrl: WITRYNA,
};

beforeEach(() => {
  vi.stubEnv("LOVABLE_API_KEY", LOVABLE_KEY);
  vi.stubEnv("GOOGLE_SEARCH_CONSOLE_API_KEY", GSC_KEY);
  fetchMock.mockReset();
  json({});
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

// ---------------------------------------------------------------------------
describe("bramka roli - wspólna dla trzech funkcji", () => {
  it("redaktor nie wylistuje własności Search Console", async () => {
    const blad = await przechwycBlad(listuj(najemca(TENANT_A, REDAKTOR_A)));

    expect(blad.message).toBe("Forbidden: admin role required");
  });

  it("odmowa następuje PRZED jakimkolwiek wywołaniem bramki konektora", async () => {
    await przechwycBlad(listuj(najemca(TENANT_A, REDAKTOR_A)));
    await przechwycBlad(pytaj(ZAPYTANIE, najemca(TENANT_A, REDAKTOR_A)));
    await przechwycBlad(inspekcja(INSPEKCJA, najemca(TENANT_A, REDAKTOR_A)));

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("admin OBCEGO najemcy nie przechodzi bramki tego najemcy", async () => {
    const obcy = najemca(TENANT_A, ADMIN_B);

    const blad = await przechwycBlad(pytaj(ZAPYTANIE, obcy));

    expect(blad.message).toBe("Forbidden: admin role required");
    expect(fetchMock).not.toHaveBeenCalled();
    // Pytanie o rolę poszło klientem najemcy A, z tożsamością wołającego.
    expect(obcy.rpcCalls).toEqual([
      { fn: "has_role", args: { _user_id: ADMIN_B, _role: "admin" } },
    ]);
  });

  it("błąd bazy przy sprawdzaniu roli zamyka bramkę zamiast otwierać", async () => {
    const zepsuty = najemca(TENANT_A, ADMIN_A, "JWT expired");

    const blad = await przechwycBlad(listuj(zepsuty));

    expect(blad.message).toBe("JWT expired");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("admin swojego najemcy przechodzi i dopiero wtedy pyta bramkę", async () => {
    json({ siteEntry: [] });

    await listuj();

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
describe("brak konfiguracji konektora", () => {
  it("bez obu kluczy lista własności oddaje stan nieskonfigurowany, a nie błąd", async () => {
    vi.stubEnv("LOVABLE_API_KEY", undefined);
    vi.stubEnv("GOOGLE_SEARCH_CONSOLE_API_KEY", undefined);

    await expect(listuj()).resolves.toEqual({ sites: [], configured: false });
  });

  it("stan nieskonfigurowany nie kosztuje ANI JEDNEGO wywołania sieci", async () => {
    vi.stubEnv("LOVABLE_API_KEY", undefined);
    vi.stubEnv("GOOGLE_SEARCH_CONSOLE_API_KEY", undefined);

    await listuj();

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("brak samego klucza bramki to też brak konfiguracji", async () => {
    vi.stubEnv("LOVABLE_API_KEY", undefined);

    await expect(listuj()).resolves.toEqual({ sites: [], configured: false });
  });

  it("brak samego klucza konektora to też brak konfiguracji", async () => {
    vi.stubEnv("GOOGLE_SEARCH_CONSOLE_API_KEY", undefined);

    await expect(listuj()).resolves.toEqual({ sites: [], configured: false });
  });

  it("brak konfiguracji GSC nie wycieka do klienta jako surowy sentinel - kwerenda", async () => {
    // PILNUJE, żeby sentinel `GSC_NOT_CONFIGURED` nie opuścił serwera tym
    // kanałem. `queryGscAnalytics` łapie go u siebie, bo rzucany wprost
    // pokazywał adminowi świeżej instalacji (albo instalacji po rotacji
    // kluczy) napis „GSC_NOT_CONFIGURED" zamiast stanu „nie podłączono".
    // Kontrakt całej warstwy analityki jest taki: brak konfiguracji to
    // PIERWSZORZĘDNY STAN, nie awaria - dokładnie tak zachowuje się GA4
    // (`EMPTY_GA4_REPORT` z `configured: false`) i tak zachowuje się
    // sąsiednia funkcja tego samego pliku. Granica jest widoczna wyłącznie na
    // instalacji bez konektora, czyli nigdy u dewelopera z kluczami w .env -
    // dlatego pilnuje jej test, a nie przegląd kodu.
    vi.stubEnv("LOVABLE_API_KEY", undefined);
    vi.stubEnv("GOOGLE_SEARCH_CONSOLE_API_KEY", undefined);

    await expect(pytaj(ZAPYTANIE)).resolves.toEqual({ rows: [] });
  });

  it("brak konfiguracji GSC nie wycieka do klienta jako surowy sentinel - inspekcja URL", async () => {
    // Ta sama granica co wyżej, trzecia funkcja modułu. Trzymana osobno, bo
    // domknięcie musiało objąć OBIE - załatanie jednej zostawiłoby drugi
    // kanał. Pusty obiekt jest tu odpowiednikiem pustej odpowiedzi bramki,
    // którą panel już umie pokazać.
    vi.stubEnv("LOVABLE_API_KEY", undefined);
    vi.stubEnv("GOOGLE_SEARCH_CONSOLE_API_KEY", undefined);

    const wynik = await inspekcja(INSPEKCJA);

    expect(wynik.raw).toBe("{}");
  });

  it("brak JEDNEGO klucza degraduje kwerendę i nie wypuszcza ani sentinela, ani klucza", async () => {
    // Wcześniej ten przypadek pilnował treści surowego sentinela, którym
    // moduł wtedy rzucał („nie zawiera żadnego klucza"). Sentinel do klienta
    // już nie wychodzi, a intencja zostaje: degradacja jest cicha i niesie
    // ZERO materiału uwierzytelniającego. Wystarczy brak JEDNEGO z dwóch
    // kluczy - typowe w połowie rotacji.
    vi.stubEnv("LOVABLE_API_KEY", undefined);

    const wynik = await pytaj(ZAPYTANIE);

    expect(wynik).toEqual({ rows: [] });
    const zserializowany = JSON.stringify(wynik);
    expect(zserializowany).not.toContain("GSC_NOT_CONFIGURED");
    expect(zserializowany).not.toContain(LOVABLE_KEY);
    expect(zserializowany).not.toContain(GSC_KEY);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
describe("listGscSites", () => {
  it("pyta bramkę o listę własności metodą GET pod udokumentowaną ścieżką", async () => {
    json({ siteEntry: [] });

    await listuj();

    expect(zadanie().url).toBe(`${BRAMKA}/webmasters/v3/sites`);
    expect(zadanie().init.method).toBeUndefined();
  });

  it("uwierzytelnia się OBOMA kluczami i deklaruje JSON", async () => {
    json({ siteEntry: [] });

    await listuj();

    expect(naglowki()).toEqual({
      Authorization: `Bearer ${LOVABLE_KEY}`,
      "X-Connection-Api-Key": GSC_KEY,
      "Content-Type": "application/json",
    });
  });

  it("mapuje siteEntry na listę własności z poziomem uprawnień", async () => {
    json({
      siteEntry: [
        { siteUrl: "sc-domain:example.com", permissionLevel: "siteOwner" },
        { siteUrl: "https://blog.example.org/", permissionLevel: "siteFullUser" },
      ],
    });

    await expect(listuj()).resolves.toEqual({
      configured: true,
      sites: [
        { siteUrl: "sc-domain:example.com", permissionLevel: "siteOwner" },
        { siteUrl: "https://blog.example.org/", permissionLevel: "siteFullUser" },
      ],
    });
  });

  it("odpowiedź BEZ siteEntry to pusta lista, nie undefined", async () => {
    json({});

    await expect(listuj()).resolves.toEqual({ sites: [], configured: true });
  });

  it("pusta odpowiedź bramki (204 bez ciała) też daje pustą listę", async () => {
    zawsze(() => odpowiedz(200, ""));

    await expect(listuj()).resolves.toEqual({ sites: [], configured: true });
  });

  it("błąd bramki NIE udaje braku konfiguracji - to dwa różne stany panelu", async () => {
    zawsze(() => odpowiedz(502, "bad gateway"));

    const blad = await przechwycBlad(listuj());

    expect(blad.message).toBe("GSC 502: bad gateway");
  });

  it("komunikat błędu bramki nie zawiera ANI JEDNEGO klucza", async () => {
    zawsze(() => odpowiedz(401, "invalid credentials"));

    const blad = await przechwycBlad(listuj());

    expect(blad.message).not.toContain(LOVABLE_KEY);
    expect(blad.message).not.toContain(GSC_KEY);
  });

  it("długa odpowiedź błędu jest przycinana do 400 znaków - log nie przenosi całej strony HTML", async () => {
    zawsze(() => odpowiedz(500, "x".repeat(5000)));

    const blad = await przechwycBlad(listuj());

    expect(blad.message).toBe(`GSC 500: ${"x".repeat(400)}`);
  });

  it("odrzucenie NIE-Errorem nie zostaje wzięte za brak konfiguracji", async () => {
    // Runtime workera potrafi odrzucić obietnicę napisem, a nie `Error`
    // (limit podzapytań). Gałąź `e instanceof Error ? … : String(e)` istnieje
    // właśnie po to - i musi porównać ten napis z sentinelem, a nie uznać
    // dowolnej awarii za „konektor niepodłączony".
    fetchMock.mockRejectedValue("workerd: subrequest limit");

    const wynik = await listuj().then(
      () => null,
      (e: unknown) => e,
    );

    expect(wynik).toBe("workerd: subrequest limit");
  });

  it("zdeformowany JSON z bramki nie zostaje przemilczany jako brak konfiguracji", async () => {
    zawsze(() => odpowiedz(200, "<html>maintenance</html>"));

    const blad = await przechwycBlad(listuj());

    // Kluczowa asercja to NIE treść komunikatu parsera, tylko to, że wywołanie
    // się nie „udało" pustą listą - inaczej panel pokazałby „brak własności"
    // dla konta, które je ma.
    expect(blad).toBeInstanceOf(Error);
    expect(blad.message).not.toContain("GSC_NOT_CONFIGURED");
  });
});

// ---------------------------------------------------------------------------
describe("queryGscAnalytics - walidacja wejścia", () => {
  function waliduj(input: unknown): unknown {
    return validateServerFnInput(queryGscAnalytics, input);
  }

  it("uzupełnia wymiary i limit wartościami domyślnymi", () => {
    expect(waliduj(ZAPYTANIE)).toEqual({
      ...ZAPYTANIE,
      dimensions: ["date"],
      rowLimit: 100,
    });
  });

  it("odrzuca brak wejścia - kwerenda bez zakresu dat nie ma sensu", () => {
    expect(() => waliduj(undefined)).toThrow();
  });

  it("odrzuca datę spoza formatu YYYY-MM-DD", () => {
    expect(() => waliduj({ ...ZAPYTANIE, startDate: "2026-8-1" })).toThrow();
    expect(() => waliduj({ ...ZAPYTANIE, endDate: "wczoraj" })).toThrow();
    expect(() => waliduj({ ...ZAPYTANIE, endDate: "2026-08-28T00:00:00Z" })).toThrow();
  });

  it("odrzuca pusty adres własności", () => {
    expect(() => waliduj({ ...ZAPYTANIE, siteUrl: "" })).toThrow();
  });

  it("odrzuca wymiar spoza listy obsługiwanej przez API", () => {
    expect(() => waliduj({ ...ZAPYTANIE, dimensions: ["browser"] })).toThrow();
  });

  it("przyjmuje wszystkie pięć udokumentowanych wymiarów", () => {
    for (const wymiar of ["date", "query", "page", "country", "device"]) {
      expect(() => waliduj({ ...ZAPYTANIE, dimensions: [wymiar] })).not.toThrow();
    }
  });

  it("odrzuca więcej niż trzy wymiary - API i tak by odmówiło", () => {
    expect(() =>
      waliduj({ ...ZAPYTANIE, dimensions: ["date", "query", "page", "country"] }),
    ).toThrow();
    expect(() => waliduj({ ...ZAPYTANIE, dimensions: ["date", "query", "page"] })).not.toThrow();
  });

  it("odrzuca limit spoza zakresu 1-1000 i limit ułamkowy", () => {
    expect(() => waliduj({ ...ZAPYTANIE, rowLimit: 0 })).toThrow();
    expect(() => waliduj({ ...ZAPYTANIE, rowLimit: 1001 })).toThrow();
    expect(() => waliduj({ ...ZAPYTANIE, rowLimit: 10.5 })).toThrow();
    expect(() => waliduj({ ...ZAPYTANIE, rowLimit: -5 })).toThrow();
  });

  it("przyjmuje skrajne dopuszczalne limity", () => {
    expect(() => waliduj({ ...ZAPYTANIE, rowLimit: 1 })).not.toThrow();
    expect(() => waliduj({ ...ZAPYTANIE, rowLimit: 1000 })).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
describe("queryGscAnalytics - żądanie i odpowiedź", () => {
  it("koduje adres własności w ścieżce - dwukropek w sc-domain nie rozjeżdża URL", async () => {
    json({ rows: [] });

    await pytaj(ZAPYTANIE);

    expect(zadanie().url).toBe(
      `${BRAMKA}/webmasters/v3/sites/sc-domain%3Aexample.com/searchAnalytics/query`,
    );
  });

  it("koduje także własność podaną adresem z ukośnikami", async () => {
    json({ rows: [] });

    await pytaj({ ...ZAPYTANIE, siteUrl: "https://blog.example.org/" });

    expect(zadanie().url).toBe(
      `${BRAMKA}/webmasters/v3/sites/https%3A%2F%2Fblog.example.org%2F/searchAnalytics/query`,
    );
  });

  it("wysyła POST z DOKŁADNIE czterema polami kwerendy", async () => {
    json({ rows: [] });

    await pytaj({ ...ZAPYTANIE, dimensions: ["query", "page"], rowLimit: 25 });

    expect(zadanie().init.method).toBe("POST");
    expect(cialo()).toEqual({
      startDate: "2026-08-01",
      endDate: "2026-08-28",
      dimensions: ["query", "page"],
      rowLimit: 25,
    });
  });

  it("nie przemyca do bramki pól spoza schematu", async () => {
    json({ rows: [] });

    await pytaj({ ...ZAPYTANIE, aggregationType: "byPage", searchType: "discover" });

    expect(Object.keys(cialo() as Record<string, unknown>).sort()).toEqual([
      "dimensions",
      "endDate",
      "rowLimit",
      "startDate",
    ]);
  });

  it("przenosi wiersze z bramki bez przekształceń", async () => {
    const wiersze = [
      { keys: ["2026-08-01"], clicks: 12, impressions: 340, ctr: 0.0353, position: 8.4 },
      { keys: ["2026-08-02"], clicks: 0, impressions: 5, ctr: 0, position: 41 },
    ];
    json({ rows: wiersze });

    await expect(pytaj(ZAPYTANIE)).resolves.toEqual({ rows: wiersze });
  });

  it("odpowiedź BEZ rows to pusta tablica - komponent robi na niej .map", async () => {
    json({});

    await expect(pytaj(ZAPYTANIE)).resolves.toEqual({ rows: [] });
  });

  it("błąd bramki przenosi status i nie zawiera kluczy", async () => {
    zawsze(() => odpowiedz(403, "user does not have sufficient permission for site"));

    const blad = await przechwycBlad(pytaj(ZAPYTANIE));

    expect(blad.message).toBe("GSC 403: user does not have sufficient permission for site");
    expect(blad.message).not.toContain(LOVABLE_KEY);
    expect(blad.message).not.toContain(GSC_KEY);
  });

  it("zerwana sieć nie zamienia się w pustą kwerendę", async () => {
    fetchMock.mockRejectedValue(new Error("workerd: subrequest failed"));

    const blad = await przechwycBlad(pytaj(ZAPYTANIE));

    expect(blad.message).toBe("workerd: subrequest failed");
  });

  it("dwaj adminowie dwóch najemców pytają o SWOJE własności", async () => {
    json({ rows: [] });

    await pytaj({ ...ZAPYTANIE, siteUrl: "sc-domain:a.example.com" }, najemca(TENANT_A, ADMIN_A));
    await pytaj({ ...ZAPYTANIE, siteUrl: "sc-domain:b.example.org" }, najemca(TENANT_B, ADMIN_B));

    expect(zadanie(0).url).toContain("sc-domain%3Aa.example.com");
    expect(zadanie(1).url).toContain("sc-domain%3Ab.example.org");
  });
});

// ---------------------------------------------------------------------------
describe("inspectGscUrl", () => {
  function waliduj(input: unknown): unknown {
    return validateServerFnInput(inspectGscUrl, input);
  }

  it("odrzuca adres, który nie jest URL-em", () => {
    expect(() => waliduj({ ...INSPEKCJA, inspectionUrl: "example.com/artykul" })).toThrow();
    expect(() => waliduj({ ...INSPEKCJA, inspectionUrl: "" })).toThrow();
  });

  it("odrzuca pustą własność", () => {
    expect(() => waliduj({ ...INSPEKCJA, siteUrl: "" })).toThrow();
  });

  it("domyślnym językiem odpowiedzi jest pl-PL", () => {
    expect(waliduj(INSPEKCJA)).toEqual({ ...INSPEKCJA, languageCode: "pl-PL" });
  });

  it("wysyła POST na endpoint inspekcji z kompletem trzech pól", async () => {
    json({ inspectionResult: { indexStatusResult: { verdict: "PASS" } } });

    await inspekcja(INSPEKCJA);

    expect(zadanie().url).toBe(`${BRAMKA}/v1/urlInspection/index:inspect`);
    expect(zadanie().init.method).toBe("POST");
    expect(cialo()).toEqual({
      inspectionUrl: "https://example.com/artykul",
      siteUrl: WITRYNA,
      languageCode: "pl-PL",
    });
  });

  it("oddaje odpowiedź bramki jako surowy JSON - panel pokazuje ją bez interpretacji", async () => {
    const wynik = { inspectionResult: { indexStatusResult: { verdict: "PASS" } } };
    json(wynik);

    await expect(inspekcja(INSPEKCJA)).resolves.toEqual({ raw: JSON.stringify(wynik) });
  });

  it("pusta odpowiedź bramki daje pusty obiekt, nie undefined w polu raw", async () => {
    zawsze(() => odpowiedz(200, ""));

    await expect(inspekcja(INSPEKCJA)).resolves.toEqual({ raw: "{}" });
  });

  it("błąd inspekcji nie zawiera kluczy uwierzytelniających", async () => {
    zawsze(() => odpowiedz(429, "quota exceeded"));

    const blad = await przechwycBlad(inspekcja(INSPEKCJA));

    expect(blad.message).toBe("GSC 429: quota exceeded");
    expect(blad.message).not.toContain(LOVABLE_KEY);
    expect(blad.message).not.toContain(GSC_KEY);
  });
});
