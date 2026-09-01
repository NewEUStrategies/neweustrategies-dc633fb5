// PO CO TEN PLIK. `src/lib/analytics/ga4.server.ts` wchodził tu z ZEREM pokrycia
// (0 z 71 linii, 0 z 17 funkcji), a przechodzi przez niego KAŻDE uwierzytelnienie
// do PŁATNEGO Data API Google'a i KAŻDY odczyt property, z którego workspace
// czyta swoje liczby. Trzy klasy defektów, których nikt tu dotąd nie łapał:
//
//  1) KRYPTOGRAFIA BEZ ŚWIADKA. Moduł sam składa i podpisuje JWT Service
//     Accountu (`createSign("RSA-SHA256")` + ręcznie robiony base64url).
//     Wszystkie klasyczne wtopy tego kodu - padding "=" w base64url, "+"/"/"
//     zamiast "-"/"_", brak odescapowania `\n` w kluczu ze zmiennej
//     środowiskowej, zła kolejność segmentów `header.claim` przy podpisie,
//     `aud` niezgodne z `token_uri` - przechodzą przez `tsc`, przez przegląd
//     i przez lokalny start. Widać je dopiero, gdy Google odpowie
//     „Invalid JWT Signature", czyli na produkcji. Dlatego testy niżej NIE
//     porównują stringów z oczekiwanym podpisem, tylko WERYFIKUJĄ podpis
//     wygenerowanym w teście kluczem publicznym - i sprawdzają, że OBCY klucz
//     tego podpisu nie przyjmuje (inaczej „weryfikacja" nie dowodziłaby niczego).
//
//  2) DWA CACHE'E NA POZIOMIE MODUŁU. `saTokenCache` i `oauthTokenCache` żyją
//     w zasięgu modułu, czyli w izolacie workera - wspólnie dla wszystkich
//     najemców i wszystkich żądań. Granica jest jedna liczba: `exp - 60 > now`.
//     Za wcześnie -> płacimy Google'owi za podpis i wymianę przy każdym
//     widgecie; za późno -> żądanie w locie trafia na wygasły token i cały
//     dashboard pada na 401. Sekundę po obu stronach tej granicy pinują testy
//     w bloku „cache tokenu".
//
//  3) DEGRADACJA ZAMIAST WYWROTKI. `runGa4DataApiReport` obiecuje w komentarzu,
//     że NIGDY nie rzuca - jeden niedziałający widget nie ma prawa wywrócić
//     całego dashboardu. Ta obietnica nie miał kto sprawdzić dla żadnej z trzech
//     ścieżek błędu (non-ok, zdeformowany JSON, wyjątek z sieci).
//
// IZOLACJA NAJEMCÓW. `resolveGa4PropertyId` czyta wartość ZAPISANĄ PRZEZ
// WORKSPACE (`stored.ga4_property_id` z ustawień analityki) i pozwala ją
// nadpisać globalnym sekretem. Testy dowodzą, że bez sekretu każdy workspace
// dostaje WŁASNE property, oraz że raport oddaje property, o które poproszono -
// bo pomyłka na tym poziomie to pokazanie jednemu klientowi liczb drugiego.
//
// CZEGO TU NIE MA. Serwerowe funkcje (`runGa4Report`, `sendGa4Event`), bramka
// uprawnień `requireAnalyticsAdmin` i odczyt ustawień z bazy należą do
// `ga4.functions.ts` / `gateway.server.ts` i mają swoje miejsca. Tutaj chodzi
// wyłącznie o warstwę, która podpisuje, cache'uje i rozmawia z Google'em.
//
// ZERO SIECI, ZERO SEKRETÓW. `fetch` jest atrapą, a para kluczy RSA powstaje
// w tym pliku przy starcie - w repozytorium nie ma i nie może być materiału
// klucza. Wszystkie adresy e-mail są z domeny example.com.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createVerify, generateKeyPairSync } from "node:crypto";

import type { Ga4Report } from "../ga4.server";

type Ga4Module = typeof import("../ga4.server");

/** Wszystko, co moduł czyta ze środowiska - czyszczone przed KAŻDYM przypadkiem. */
const ENV_KEYS = [
  "GA4_SERVICE_ACCOUNT_JSON",
  "GA4_OAUTH_CLIENT_ID",
  "GA4_OAUTH_CLIENT_SECRET",
  "GA4_OAUTH_REFRESH_TOKEN",
  "GA4_PROPERTY_ID",
] as const;

const T0_MS = Date.UTC(2026, 8, 1, 10, 0, 0);
const T0_S = Math.floor(T0_MS / 1000);

const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";

/**
 * Para kluczy Service Accountu. Generowana RAZ na plik, bo RSA-2048 kosztuje
 * setki milisekund, a żaden przypadek nie potrzebuje ŚWIEŻEJ pary - potrzebuje
 * pary, której klucz publiczny zna wyłącznie test.
 */
const SA_KEYS = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  publicKeyEncoding: { type: "spki", format: "pem" },
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
});

/** Druga, niezwiązana para - dowód, że weryfikacja podpisu cokolwiek znaczy. */
const OBCE_KEYS = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  publicKeyEncoding: { type: "spki", format: "pem" },
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
});

const SA_EMAIL = "ga4-reader@example.com";
const SCOPE = "https://www.googleapis.com/auth/analytics.readonly";

/** Atrapy sekretów OAuth - jawnie testowe napisy, nie materiał uwierzytelniający. */
const OAUTH_CLIENT_ID = "client-id-testowy.apps.example.com";
const OAUTH_CLIENT_SECRET = "sekret-klienta-tylko-do-testu";
const OAUTH_REFRESH_TOKEN = "refresh-token-tylko-do-testu";

const fetchMock = vi.fn<(input: string | URL, init?: RequestInit) => Promise<Response>>();

/**
 * Świeża instancja modułu. Oba cache'e tokenów żyją w zasięgu modułu, więc bez
 * resetu jeden przypadek podpisywałby token następnym - i „cache działa"
 * przechodziłoby nawet wtedy, gdyby nie działał.
 */
async function loadGa4(): Promise<Ga4Module> {
  vi.resetModules();
  return import("../ga4.server");
}

function odpowiedz(status: number, body: string): Response {
  return new Response(body, { status });
}

function tokenOk(token: string, expiresIn: number | undefined = 3600): Response {
  return odpowiedz(200, JSON.stringify({ access_token: token, expires_in: expiresIn }));
}

/**
 * Ciało `Response` da się odczytać DOKŁADNIE RAZ, a niejeden przypadek niżej
 * woła `fetch` dwa razy (odświeżenie tokenu, drugi workspace). Atrapa musi więc
 * budować odpowiedź przy KAŻDYM wywołaniu - wspólna instancja padałaby na
 * „Body has already been used" i udawała defekt kodu produkcyjnego.
 */
function zawsze(buduj: () => Response): void {
  fetchMock.mockImplementation(() => Promise.resolve(buduj()));
}

interface Zadanie {
  readonly url: string;
  readonly init: RequestInit;
}

function zadanie(index: number): Zadanie {
  const call = fetchMock.mock.calls[index];
  expect(call, `brak zadania nr ${index}`).toBeDefined();
  return { url: String(call[0]), init: call[1] ?? {} };
}

/** Ciało żądania tokenowego - Google przyjmuje wyłącznie form-urlencoded. */
function formularz(index: number): URLSearchParams {
  return new URLSearchParams(String(zadanie(index).init.body ?? ""));
}

function dekoduj(segment: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(segment, "base64url").toString("utf8")) as Record<string, unknown>;
}

/** Niezależny weryfikator: podpis liczony jest z `header.claim`, nie z całego JWT. */
function podpisWazny(jwt: string, publicKey: string): boolean {
  const [header, claim, signature] = jwt.split(".");
  const verify = createVerify("RSA-SHA256");
  verify.update(`${header}.${claim}`);
  verify.end();
  return verify.verify(publicKey, Buffer.from(signature, "base64url"));
}

function saJson(fields: Record<string, string>): string {
  return JSON.stringify(fields);
}

/** Kompletny, poprawny plik Service Accountu. */
function saPoprawny(over: Partial<Record<"private_key" | "token_uri", string>> = {}): string {
  return saJson({
    client_email: SA_EMAIL,
    private_key: SA_KEYS.privateKey,
    ...over,
  });
}

function ustawOauth(): void {
  vi.stubEnv("GA4_OAUTH_CLIENT_ID", OAUTH_CLIENT_ID);
  vi.stubEnv("GA4_OAUTH_CLIENT_SECRET", OAUTH_CLIENT_SECRET);
  vi.stubEnv("GA4_OAUTH_REFRESH_TOKEN", OAUTH_REFRESH_TOKEN);
}

async function przechwycBlad(promise: Promise<unknown>): Promise<Error> {
  const wynik = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(wynik, "oczekiwano wyjatku, a wywolanie sie powiodlo").toBeInstanceOf(Error);
  return wynik as Error;
}

beforeEach(() => {
  // Fake'ujemy WYŁĄCZNIE `Date`: cache czyta `Date.now()`, ale odczyt ciała
  // odpowiedzi (`res.text()`) idzie przez prawdziwy runtime i nie ma powodu
  // wpuszczać go na sztuczną kolejkę timerów.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(T0_MS);
  for (const key of ENV_KEYS) vi.stubEnv(key, undefined);
  fetchMock.mockReset();
  zawsze(() => tokenOk("token-domyslny"));
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("readServiceAccount - bramka wejścia w tryb Service Account", () => {
  /** Dowód zejścia na OAuth: poleciała WYMIANA REFRESH TOKENU, nie asercja JWT. */
  async function oczekujZejsciaNaOauth(): Promise<void> {
    ustawOauth();
    zawsze(() => tokenOk("token-oauth"));
    const { resolveGa4AccessToken } = await loadGa4();

    const auth = await resolveGa4AccessToken();

    expect(auth).toEqual({ token: "token-oauth", source: "oauth" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(formularz(0).get("grant_type")).toBe("refresh_token");
    expect(formularz(0).get("assertion")).toBeNull();
  }

  it("bez GA4_SERVICE_ACCOUNT_JSON nie podpisuje żadnego JWT i schodzi na OAuth", async () => {
    await oczekujZejsciaNaOauth();
  });

  it("zdeformowany JSON w sekrecie nie wywraca odczytu - schodzi na OAuth", async () => {
    vi.stubEnv("GA4_SERVICE_ACCOUNT_JSON", '{"client_email": "ga4-reader@example.com",');
    await oczekujZejsciaNaOauth();
  });

  it("plik SA bez client_email schodzi na OAuth zamiast podpisywać JWT bez `iss`", async () => {
    vi.stubEnv("GA4_SERVICE_ACCOUNT_JSON", saJson({ private_key: SA_KEYS.privateKey }));
    await oczekujZejsciaNaOauth();
  });

  it("plik SA bez private_key schodzi na OAuth zamiast próbować podpisu bez klucza", async () => {
    vi.stubEnv("GA4_SERVICE_ACCOUNT_JSON", saJson({ client_email: SA_EMAIL }));
    await oczekujZejsciaNaOauth();
  });

  it("pusty client_email jest traktowany jak brak pola (falsy, nie „jest, ale puste”)", async () => {
    vi.stubEnv(
      "GA4_SERVICE_ACCOUNT_JSON",
      saJson({ client_email: "", private_key: SA_KEYS.privateKey }),
    );
    await oczekujZejsciaNaOauth();
  });
});

describe("podpis JWT Service Accountu", () => {
  it("podpis weryfikuje się kluczem publicznym SA, a obcym kluczem NIE", async () => {
    vi.stubEnv("GA4_SERVICE_ACCOUNT_JSON", saPoprawny());
    zawsze(() => tokenOk("token-sa"));
    const { resolveGa4AccessToken } = await loadGa4();

    const auth = await resolveGa4AccessToken();

    expect(auth).toEqual({ token: "token-sa", source: "sa" });
    const jwt = formularz(0).get("assertion") ?? "";
    expect(jwt.split(".")).toHaveLength(3);
    expect(podpisWazny(jwt, SA_KEYS.publicKey)).toBe(true);
    expect(podpisWazny(jwt, OBCE_KEYS.publicKey)).toBe(false);
  });

  it("nagłówek i claim niosą RS256/JWT, iss, scope analytics.readonly i exp = iat + 3600", async () => {
    vi.stubEnv("GA4_SERVICE_ACCOUNT_JSON", saPoprawny());
    zawsze(() => tokenOk("token-sa"));
    const { resolveGa4AccessToken } = await loadGa4();

    await resolveGa4AccessToken();

    const [header, claim] = (formularz(0).get("assertion") ?? "").split(".");
    expect(dekoduj(header)).toEqual({ alg: "RS256", typ: "JWT" });
    expect(dekoduj(claim)).toEqual({
      iss: SA_EMAIL,
      scope: SCOPE,
      aud: GOOGLE_TOKEN_URL,
      iat: T0_S,
      exp: T0_S + 3600,
    });
    // Zgranie assertion z grantem - Google odrzuca kazda inna kombinacje.
    expect(formularz(0).get("grant_type")).toBe("urn:ietf:params:oauth:grant-type:jwt-bearer");
    expect(zadanie(0).url).toBe(GOOGLE_TOKEN_URL);
  });

  it("token_uri z pliku SA nadpisuje JEDNOCZEŚNIE `aud` i adres wymiany", async () => {
    // Rozjazd tych dwóch wartości to bilet do „Invalid JWT: audience mismatch":
    // token leci pod inny adres, niż deklaruje podpisany claim.
    const wlasnyUri = "https://oauth2.example.org/token";
    vi.stubEnv("GA4_SERVICE_ACCOUNT_JSON", saPoprawny({ token_uri: wlasnyUri }));
    zawsze(() => tokenOk("token-sa"));
    const { resolveGa4AccessToken } = await loadGa4();

    await resolveGa4AccessToken();

    const [, claim] = (formularz(0).get("assertion") ?? "").split(".");
    expect(dekoduj(claim).aud).toBe(wlasnyUri);
    expect(zadanie(0).url).toBe(wlasnyUri);
  });

  it("private_key z literalnymi \\n (tak żyje w zmiennej środowiskowej) daje ważny podpis", async () => {
    // Klasyk wdrożeniowy: przełamania linii PEM-a zapisane jako dwa znaki.
    // Bez odescapowania `createSign().sign()` rzuca lub podpisuje śmieciem.
    const zEscape = SA_KEYS.privateKey.replace(/\n/g, "\\n");
    expect(zEscape).not.toContain("\n");
    vi.stubEnv("GA4_SERVICE_ACCOUNT_JSON", saPoprawny({ private_key: zEscape }));
    zawsze(() => tokenOk("token-sa"));
    const { resolveGa4AccessToken } = await loadGa4();

    const auth = await resolveGa4AccessToken();

    expect(auth?.source).toBe("sa");
    expect(podpisWazny(formularz(0).get("assertion") ?? "", SA_KEYS.publicKey)).toBe(true);
  });

  it("cały JWT jest w base64url - bez '=', '+' i '/'", async () => {
    vi.stubEnv("GA4_SERVICE_ACCOUNT_JSON", saPoprawny());
    zawsze(() => tokenOk("token-sa"));
    const { resolveGa4AccessToken } = await loadGa4();

    await resolveGa4AccessToken();

    const jwt = formularz(0).get("assertion") ?? "";
    expect(jwt).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    expect(jwt).not.toContain("=");
    expect(jwt).not.toContain("+");
    expect(jwt).not.toContain("/");
  });
});

describe("cache tokenu Service Accountu (granica exp - 60 s)", () => {
  async function pierwszyToken(): Promise<Ga4Module> {
    vi.stubEnv("GA4_SERVICE_ACCOUNT_JSON", saPoprawny());
    fetchMock.mockResolvedValueOnce(tokenOk("token-pierwszy"));
    fetchMock.mockResolvedValueOnce(tokenOk("token-drugi"));
    const mod = await loadGa4();
    expect((await mod.resolveGa4AccessToken())?.token).toBe("token-pierwszy");
    return mod;
  }

  it("sekundę PRZED granicą token jest reużywany - druga rozmowa nie idzie do Google'a", async () => {
    const { resolveGa4AccessToken } = await pierwszyToken();

    // exp = T0 + 3600, margines 60 s => ostatnia sekunda ważności to T0 + 3539.
    vi.setSystemTime((T0_S + 3539) * 1000);
    const drugi = await resolveGa4AccessToken();

    expect(drugi?.token).toBe("token-pierwszy");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("dokładnie NA granicy token jest podpisywany na nowo (świeży iat)", async () => {
    const { resolveGa4AccessToken } = await pierwszyToken();

    vi.setSystemTime((T0_S + 3540) * 1000);
    const drugi = await resolveGa4AccessToken();

    expect(drugi?.token).toBe("token-drugi");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const iat = (jwt: string): unknown => dekoduj(jwt.split(".")[1]).iat;
    expect(iat(formularz(0).get("assertion") ?? "")).toBe(T0_S);
    expect(iat(formularz(1).get("assertion") ?? "")).toBe(T0_S + 3540);
    // Drugi podpis też musi być ważny - nie wystarczy, że jest inny.
    expect(podpisWazny(formularz(1).get("assertion") ?? "", SA_KEYS.publicKey)).toBe(true);
  });

  it("odpowiedź bez expires_in nie zamraża cache'u - kolejne wywołanie podpisuje na nowo", async () => {
    // `now + undefined` to NaN, a `NaN - 60 > now` jest fałszem. Zachowanie
    // fail-safe (płacimy za podpis), ale musi być pinowane: gdyby porównanie
    // odwróciło się na `<`, NaN zamroziłby pusty token na zawsze.
    vi.stubEnv("GA4_SERVICE_ACCOUNT_JSON", saPoprawny());
    zawsze(() => odpowiedz(200, JSON.stringify({ access_token: "token-bez-exp" })));
    const { resolveGa4AccessToken } = await loadGa4();

    expect((await resolveGa4AccessToken())?.token).toBe("token-bez-exp");
    expect((await resolveGa4AccessToken())?.token).toBe("token-bez-exp");

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it.fails(
    "wymiana bez pola access_token nie może oddać { token: undefined } udającego string",
    async () => {
      // DEFEKT. Odpowiedź jest rzutowana (`as { access_token: string }`) bez
      // walidacji, więc brak pola daje `{ token: undefined, source: "sa" }` -
      // obiekt PRAWDZIWY, który przechodzi bramkę `if (!auth)` u wołającego
      // (`ga4.functions.ts`, `snapshot.functions.ts`) i kończy się nagłówkiem
      // „Bearer undefined" wysłanym do płatnego API. Kontrakt sygnatury
      // (`Promise<{ token: string } | null>`) jest tu złamany w czasie
      // wykonania: albo token, albo `null` - trzeciej opcji nie ma.
      vi.stubEnv("GA4_SERVICE_ACCOUNT_JSON", saPoprawny());
      zawsze(() => odpowiedz(200, JSON.stringify({ expires_in: 3600 })));
      const { resolveGa4AccessToken } = await loadGa4();

      const auth = await resolveGa4AccessToken();

      expect(auth === null || typeof auth.token === "string").toBe(true);
    },
  );

  it("nieudana wymiana rzuca z kodem statusu, a komunikat NIE niesie podpisanego JWT", async () => {
    vi.stubEnv("GA4_SERVICE_ACCOUNT_JSON", saPoprawny());
    zawsze(() =>
      odpowiedz(
        400,
        JSON.stringify({ error: "invalid_grant", error_description: "Invalid JWT Signature." }),
      ),
    );
    const { resolveGa4AccessToken } = await loadGa4();

    const blad = await przechwycBlad(resolveGa4AccessToken());

    expect(blad.message).toContain("400");
    expect(blad.message).toContain("invalid_grant");
    const jwt = formularz(0).get("assertion") ?? "";
    expect(jwt).not.toBe("");
    // Ani całego assertion, ani samego podpisu - komunikat błędu trafia do logu
    // i (przez niezłapany wyjątek w `runGa4Report`) do odpowiedzi HTTP.
    expect(blad.message).not.toContain(jwt);
    expect(blad.message).not.toContain(jwt.split(".")[2]);
    expect(blad.message).not.toContain(SA_KEYS.privateKey);
  });

  it("ciało błędu jest przycinane do 400 znaków, a nie wklejane w całości", async () => {
    vi.stubEnv("GA4_SERVICE_ACCOUNT_JSON", saPoprawny());
    zawsze(() => odpowiedz(500, `${"x".repeat(400)}OGON-KTORY-MA-ZNIKNAC`));
    const { resolveGa4AccessToken } = await loadGa4();

    const blad = await przechwycBlad(resolveGa4AccessToken());

    expect(blad.message).toContain("x".repeat(400));
    expect(blad.message).not.toContain("OGON-KTORY-MA-ZNIKNAC");
  });

  it("odpowiedź 200 ze zdeformowanym JSON-em rzuca (fail-loud), zamiast oddać pusty token", async () => {
    vi.stubEnv("GA4_SERVICE_ACCOUNT_JSON", saPoprawny());
    zawsze(() => odpowiedz(200, "<html>proxy przechwycil zadanie</html>"));
    const { resolveGa4AccessToken } = await loadGa4();

    const blad = await przechwycBlad(resolveGa4AccessToken());

    expect(blad).toBeInstanceOf(SyntaxError);
  });
});

describe("getOauthAccessToken - tryb refresh tokenu", () => {
  const KOMPLET: Record<string, string> = {
    GA4_OAUTH_CLIENT_ID: OAUTH_CLIENT_ID,
    GA4_OAUTH_CLIENT_SECRET: OAUTH_CLIENT_SECRET,
    GA4_OAUTH_REFRESH_TOKEN: OAUTH_REFRESH_TOKEN,
  };

  for (const brakujacy of Object.keys(KOMPLET)) {
    it(`brak ${brakujacy} daje null i ZERO ruchu sieciowego`, async () => {
      for (const [key, value] of Object.entries(KOMPLET)) {
        if (key !== brakujacy) vi.stubEnv(key, value);
      }
      const { resolveGa4AccessToken } = await loadGa4();

      expect(await resolveGa4AccessToken()).toBeNull();
      expect(fetchMock).not.toHaveBeenCalled();
    });
  }

  it("żądanie odświeżenia niesie grant_type=refresh_token i komplet trzech wartości", async () => {
    ustawOauth();
    zawsze(() => tokenOk("token-oauth"));
    const { resolveGa4AccessToken } = await loadGa4();

    const auth = await resolveGa4AccessToken();

    expect(auth).toEqual({ token: "token-oauth", source: "oauth" });
    expect(zadanie(0).url).toBe(GOOGLE_TOKEN_URL);
    expect(zadanie(0).init.method).toBe("POST");
    expect(new Headers(zadanie(0).init.headers).get("content-type")).toBe(
      "application/x-www-form-urlencoded",
    );
    expect(Object.fromEntries(formularz(0))).toEqual({
      grant_type: "refresh_token",
      client_id: OAUTH_CLIENT_ID,
      client_secret: OAUTH_CLIENT_SECRET,
      refresh_token: OAUTH_REFRESH_TOKEN,
    });
  });

  it("token OAuth w oknie ważności jest reużywany między wywołaniami", async () => {
    ustawOauth();
    fetchMock.mockResolvedValueOnce(tokenOk("token-oauth-1"));
    fetchMock.mockResolvedValueOnce(tokenOk("token-oauth-2"));
    const { resolveGa4AccessToken } = await loadGa4();

    expect((await resolveGa4AccessToken())?.token).toBe("token-oauth-1");
    vi.setSystemTime((T0_S + 3539) * 1000);
    expect((await resolveGa4AccessToken())?.token).toBe("token-oauth-1");

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("po przekroczeniu marginesu 60 s token OAuth jest pobierany na nowo", async () => {
    ustawOauth();
    fetchMock.mockResolvedValueOnce(tokenOk("token-oauth-1"));
    fetchMock.mockResolvedValueOnce(tokenOk("token-oauth-2"));
    const { resolveGa4AccessToken } = await loadGa4();

    expect((await resolveGa4AccessToken())?.token).toBe("token-oauth-1");
    vi.setSystemTime((T0_S + 3540) * 1000);
    expect((await resolveGa4AccessToken())?.token).toBe("token-oauth-2");

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("nieudane odświeżenie rzuca z kodem statusu i nie wypisuje sekretu ani refresh tokenu", async () => {
    ustawOauth();
    zawsze(() => odpowiedz(401, JSON.stringify({ error: "invalid_client" })));
    const { resolveGa4AccessToken } = await loadGa4();

    const blad = await przechwycBlad(resolveGa4AccessToken());

    expect(blad.message).toContain("401");
    expect(blad.message).toContain("invalid_client");
    expect(blad.message).not.toContain(OAUTH_CLIENT_SECRET);
    expect(blad.message).not.toContain(OAUTH_REFRESH_TOKEN);
  });
});

describe("resolveGa4AccessToken - priorytet źródeł", () => {
  it("Service Account wygrywa z OAuth, gdy skonfigurowane są OBA", async () => {
    vi.stubEnv("GA4_SERVICE_ACCOUNT_JSON", saPoprawny());
    ustawOauth();
    zawsze(() => tokenOk("token-sa"));
    const { resolveGa4AccessToken } = await loadGa4();

    const auth = await resolveGa4AccessToken();

    expect(auth).toEqual({ token: "token-sa", source: "sa" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(formularz(0).get("grant_type")).toBe("urn:ietf:params:oauth:grant-type:jwt-bearer");
    expect(formularz(0).get("refresh_token")).toBeNull();
  });

  it("brak obu trybów daje null bez ani jednego zapytania", async () => {
    const { resolveGa4AccessToken } = await loadGa4();

    expect(await resolveGa4AccessToken()).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("resolveGa4PropertyId - sekret kontra ustawienie workspace'u", () => {
  it("sekret GA4_PROPERTY_ID wygrywa z wartością zapisaną przez workspace", async () => {
    vi.stubEnv("GA4_PROPERTY_ID", "111111111");
    const { resolveGa4PropertyId } = await loadGa4();

    expect(resolveGa4PropertyId("222222222")).toBe("111111111");
  });

  it("wartość z bazy jest przycinana z białych znaków", async () => {
    const { resolveGa4PropertyId } = await loadGa4();

    expect(resolveGa4PropertyId("  222222222\n")).toBe("222222222");
  });

  it("sama biała spacja w bazie to BRAK konfiguracji, a nie property o nazwie spacja", async () => {
    const { resolveGa4PropertyId } = await loadGa4();

    expect(resolveGa4PropertyId("   ")).toBeUndefined();
    expect(resolveGa4PropertyId("")).toBeUndefined();
  });

  it("brak sekretu i brak wpisu (undefined/null) daje undefined", async () => {
    const { resolveGa4PropertyId } = await loadGa4();

    expect(resolveGa4PropertyId()).toBeUndefined();
    expect(resolveGa4PropertyId(null)).toBeUndefined();
  });

  it("bez sekretu KAŻDY workspace dostaje własne property - żaden nie widzi cudzego", async () => {
    const { resolveGa4PropertyId } = await loadGa4();

    const workspaceA = resolveGa4PropertyId("100000001");
    const workspaceB = resolveGa4PropertyId("100000002");

    expect(workspaceA).toBe("100000001");
    expect(workspaceB).toBe("100000002");
    expect(workspaceA).not.toBe(workspaceB);
  });

  it.fails(
    "pusty sekret GA4_PROPERTY_ID musi znaczyć BRAK sekretu, a nie property o pustej nazwie",
    async () => {
      // DEFEKT. `process.env.GA4_PROPERTY_ID ?? (stored?.trim() || undefined)`
      // używa `??`, które łapie tylko null/undefined - a pusta zmienna
      // środowiskowa to PUSTY STRING. Skutek: deklaracja `GA4_PROPERTY_ID=`
      // w .env / w sekretach CI (albo sekret wyczyszczony bez usunięcia klucza)
      // oddaje `""`, więc `if (!propertyId) return EMPTY_GA4_REPORT`
      // w `ga4.functions.ts` raportuje „GA4 nieskonfigurowane" KAŻDEMU
      // workspace'owi, który ma poprawne property w bazie. Funkcja sama
      // pokazuje intencję po drugiej stronie wyrażenia (`trim() || undefined`
      // traktuje pusty wpis jak brak), a siostrzany kod w tym samym module
      // (`ga4.functions.ts`: GA4_MEASUREMENT_ID?.trim() || stored...) używa
      // właśnie `||`. Ta asymetria jest błędem, nie decyzją.
      vi.stubEnv("GA4_PROPERTY_ID", "");
      const { resolveGa4PropertyId } = await loadGa4();

      expect(resolveGa4PropertyId("222222222")).toBe("222222222");
    },
  );
});

describe("runGa4DataApiReport - kształt żądania", () => {
  const REQ = {
    propertyId: "123456789",
    startDate: "2026-08-01",
    endDate: "2026-08-28",
    dimensions: ["date", "country"],
    metrics: ["sessions", "activeUsers"],
    limit: 100,
  } as const;

  it("uderza w properties/{id}:runReport z nagłówkiem Bearer i pełnym ciałem", async () => {
    zawsze(() => odpowiedz(200, "{}"));
    const { runGa4DataApiReport } = await loadGa4();

    await runGa4DataApiReport(REQ, "token-dostepowy");

    expect(zadanie(0).url).toBe(
      "https://analyticsdata.googleapis.com/v1beta/properties/123456789:runReport",
    );
    expect(zadanie(0).init.method).toBe("POST");
    const naglowki = new Headers(zadanie(0).init.headers);
    expect(naglowki.get("authorization")).toBe("Bearer token-dostepowy");
    expect(naglowki.get("content-type")).toBe("application/json");
    expect(JSON.parse(String(zadanie(0).init.body))).toEqual({
      dateRanges: [{ startDate: "2026-08-01", endDate: "2026-08-28" }],
      dimensions: [{ name: "date" }, { name: "country" }],
      metrics: [{ name: "sessions" }, { name: "activeUsers" }],
      // Data API przyjmuje `limit` jako string - liczba przechodzi przez tsc,
      // ale Google odpowiada 400.
      limit: "100",
    });
  });

  it("raport odpowiada property, o które poproszono - dwa workspace'y się nie mieszają", async () => {
    fetchMock.mockResolvedValueOnce(
      odpowiedz(
        200,
        JSON.stringify({
          metricHeaders: [{ name: "sessions" }],
          totals: [{ metricValues: [{ value: "11" }] }],
        }),
      ),
    );
    fetchMock.mockResolvedValueOnce(
      odpowiedz(
        200,
        JSON.stringify({
          metricHeaders: [{ name: "sessions" }],
          totals: [{ metricValues: [{ value: "22" }] }],
        }),
      ),
    );
    const { runGa4DataApiReport } = await loadGa4();

    const a = await runGa4DataApiReport({ ...REQ, propertyId: "100000001" }, "token-a");
    const b = await runGa4DataApiReport({ ...REQ, propertyId: "100000002" }, "token-b");

    expect(a.propertyId).toBe("100000001");
    expect(b.propertyId).toBe("100000002");
    expect(a.totals).toEqual(["11"]);
    expect(b.totals).toEqual(["22"]);
    expect(zadanie(0).url).toContain("properties/100000001:runReport");
    expect(zadanie(1).url).toContain("properties/100000002:runReport");
    expect(new Headers(zadanie(1).init.headers).get("authorization")).toBe("Bearer token-b");
  });
});

describe("runGa4DataApiReport - mapowanie odpowiedzi", () => {
  const REQ = {
    propertyId: "123456789",
    startDate: "2026-08-01",
    endDate: "2026-08-28",
    dimensions: ["date"],
    metrics: ["sessions", "activeUsers"],
    limit: 10,
  } as const;

  it("mapuje nagłówki, wiersze i totale w kolejności z odpowiedzi", async () => {
    zawsze(() =>
      odpowiedz(
        200,
        JSON.stringify({
          dimensionHeaders: [{ name: "date" }],
          metricHeaders: [{ name: "sessions" }, { name: "activeUsers" }],
          rows: [
            {
              dimensionValues: [{ value: "20260801" }],
              metricValues: [{ value: "12" }, { value: "9" }],
            },
            {
              dimensionValues: [{ value: "20260802" }],
              metricValues: [{ value: "5" }, { value: "4" }],
            },
          ],
          totals: [{ metricValues: [{ value: "17" }, { value: "13" }] }],
        }),
      ),
    );
    const { runGa4DataApiReport } = await loadGa4();

    const raport = await runGa4DataApiReport(REQ, "token");

    expect(raport).toEqual({
      configured: true,
      propertyId: "123456789",
      dimensionHeaders: ["date"],
      metricHeaders: ["sessions", "activeUsers"],
      rows: [
        { dims: ["20260801"], metrics: ["12", "9"] },
        { dims: ["20260802"], metrics: ["5", "4"] },
      ],
      totals: ["17", "13"],
    });
    expect(raport.error).toBeUndefined();
  });

  it("brakujące tablice i puste wartości mają czyste wartości domyślne", async () => {
    // GA4 pomija `rows`/`totals` przy zerowym ruchu, a pojedyncze `value`
    // potrafi nie przyjść. Domyślne "" dla wymiaru i "0" dla metryki są
    // kontraktem dla warstwy wykresów, która nie sprawdza undefined.
    zawsze(() =>
      odpowiedz(
        200,
        JSON.stringify({
          metricHeaders: [{ name: "sessions" }],
          rows: [{ dimensionValues: [{}], metricValues: [{}] }],
        }),
      ),
    );
    const { runGa4DataApiReport } = await loadGa4();

    const raport = await runGa4DataApiReport(REQ, "token");

    expect(raport.dimensionHeaders).toEqual([]);
    expect(raport.metricHeaders).toEqual(["sessions"]);
    expect(raport.rows).toEqual([{ dims: [""], metrics: ["0"] }]);
    expect(raport.totals).toEqual([]);
    expect(raport.configured).toBe(true);
  });

  it("wiersz bez tablic wartości i totals bez metricValues dają puste listy, nie wyjątek", async () => {
    // Data API pomija całe `dimensionValues` przy zapytaniu bez wymiarów
    // (`snapshot.functions.ts` woła właśnie tak: `dimensions: []`), a `totals`
    // potrafi przyjść jako `[{}]`. Każde z tych trzech `?? []` jest więc
    // ścieżką produkcyjną, a nie obroną przed niemożliwym.
    zawsze(() =>
      odpowiedz(
        200,
        JSON.stringify({
          metricHeaders: [{ name: "sessions" }],
          rows: [{}],
          totals: [{}],
        }),
      ),
    );
    const { runGa4DataApiReport } = await loadGa4();

    const raport = await runGa4DataApiReport(REQ, "token");

    expect(raport.rows).toEqual([{ dims: [], metrics: [] }]);
    expect(raport.totals).toEqual([]);
    expect(raport.error).toBeUndefined();
  });

  it("total bez pola value wchodzi jako '0' - tak samo jak metryka wiersza", async () => {
    zawsze(() =>
      odpowiedz(
        200,
        JSON.stringify({
          metricHeaders: [{ name: "sessions" }, { name: "activeUsers" }],
          totals: [{ metricValues: [{ value: "17" }, {}] }],
        }),
      ),
    );
    const { runGa4DataApiReport } = await loadGa4();

    const raport = await runGa4DataApiReport(REQ, "token");

    expect(raport.totals).toEqual(["17", "0"]);
  });

  it("pusta tablica totals (zakres bez ruchu) daje puste totale, a nie wyjątek na [0]", async () => {
    zawsze(() =>
      odpowiedz(
        200,
        JSON.stringify({ metricHeaders: [{ name: "sessions" }], rows: [], totals: [] }),
      ),
    );
    const { runGa4DataApiReport } = await loadGa4();

    const raport = await runGa4DataApiReport(REQ, "token");

    expect(raport.totals).toEqual([]);
    expect(raport.metricHeaders).toEqual(["sessions"]);
    expect(raport.error).toBeUndefined();
  });

  it("całkiem pusta odpowiedź 200 daje skonfigurowany raport bez ani jednego pola undefined", async () => {
    zawsze(() => odpowiedz(200, "{}"));
    const { runGa4DataApiReport } = await loadGa4();

    const raport = await runGa4DataApiReport(REQ, "token");

    expect(raport).toEqual({
      configured: true,
      propertyId: "123456789",
      dimensionHeaders: [],
      metricHeaders: [],
      rows: [],
      totals: [],
    });
  });

  it("odpowiedź non-ok NIE rzuca - wraca configured:true z błędem i bez tokenu w treści", async () => {
    zawsze(() =>
      odpowiedz(403, JSON.stringify({ error: { message: "User does not have access." } })),
    );
    const { runGa4DataApiReport } = await loadGa4();

    const raport = await runGa4DataApiReport(REQ, "token-dostepowy-abc");

    expect(raport.configured).toBe(true);
    expect(raport.propertyId).toBe("123456789");
    expect(raport.error).toContain("403");
    expect(raport.error).toContain("does not have access");
    expect(raport.error).not.toContain("token-dostepowy-abc");
    expect(raport.rows).toEqual([]);
  });

  it("ciało błędu raportu jest przycinane do 300 znaków", async () => {
    zawsze(() => odpowiedz(500, `${"y".repeat(300)}OGON-RAPORTU`));
    const { runGa4DataApiReport } = await loadGa4();

    const raport = await runGa4DataApiReport(REQ, "token");

    expect(raport.error).toContain("y".repeat(300));
    expect(raport.error).not.toContain("OGON-RAPORTU");
  });

  it("zdeformowany JSON w odpowiedzi 200 wraca jako błąd raportu, a nie wyjątek", async () => {
    zawsze(() => odpowiedz(200, "to nie jest JSON"));
    const { runGa4DataApiReport } = await loadGa4();

    const raport = await runGa4DataApiReport(REQ, "token");

    expect(raport.configured).toBe(true);
    expect(raport.error).toBeTruthy();
    expect(raport.rows).toEqual([]);
  });

  it("wyjątek z sieci wraca jako błąd raportu, bez tokenu w komunikacie", async () => {
    fetchMock.mockRejectedValue(new Error("fetch failed: ECONNRESET"));
    const { runGa4DataApiReport } = await loadGa4();

    const raport = await runGa4DataApiReport(REQ, "token-dostepowy-abc");

    expect(raport.error).toBe("fetch failed: ECONNRESET");
    expect(raport.error).not.toContain("token-dostepowy-abc");
    expect(raport.configured).toBe(true);
  });

  it("wyjątek, który nie jest Errorem, też nie wywraca raportu", async () => {
    fetchMock.mockRejectedValue("workerd: subrequest limit");
    const { runGa4DataApiReport } = await loadGa4();

    const raport = await runGa4DataApiReport(REQ, "token");

    expect(raport.error).toBe("workerd: subrequest limit");
  });

  it.fails(
    "raport błędu nie może współdzielić tablic z eksportowanym EMPTY_GA4_REPORT",
    async () => {
      // DEFEKT (utajony, ale wprost międzynajemcowy). `{ ...EMPTY_GA4_REPORT }`
      // to płytka kopia: `rows`, `totals`, `dimensionHeaders` i `metricHeaders`
      // każdego raportu błędu to TE SAME instancje tablic, co w module-scope'owej
      // stałej - wspólnej dla całego izolatu workera, czyli dla wszystkich
      // najemców. `Ga4Report.rows` jest publicznie typowane jako zwykła,
      // mutowalna tablica, więc sortowanie wierszy pod wykres jest normalnym
      // użyciem. `ga4.functions.ts` oddaje ponadto `EMPTY_GA4_REPORT` DOSŁOWNIE
      // (`if (!propertyId) return EMPTY_GA4_REPORT`), więc mutacja u jednego
      // wołającego jest widoczna u każdego następnego. Poniżej to samo w jednym
      // przebiegu: workspace A dopisuje wiersz do swojego raportu, a widzi go
      // workspace B.
      zawsze(() => odpowiedz(503, "chwilowo niedostepne"));
      const { runGa4DataApiReport, EMPTY_GA4_REPORT } = await loadGa4();

      const a = await runGa4DataApiReport({ ...REQ, propertyId: "100000001" }, "token-a");
      a.rows.push({ dims: ["wiersz workspace'u A"], metrics: ["1"] });
      const b = await runGa4DataApiReport({ ...REQ, propertyId: "100000002" }, "token-b");

      expect(b.rows).toEqual([]);
      expect(EMPTY_GA4_REPORT.rows).toEqual([]);
    },
  );
});

describe("ga4TotalsMap", () => {
  function raport(over: Partial<Ga4Report>): Ga4Report {
    return {
      configured: true,
      propertyId: "123456789",
      dimensionHeaders: [],
      metricHeaders: [],
      rows: [],
      totals: [],
      ...over,
    };
  }

  it("pusta mapa, gdy raport niesie błąd - brak danych to nie jest zero", async () => {
    const { ga4TotalsMap } = await loadGa4();

    const mapa = ga4TotalsMap(
      raport({ metricHeaders: ["sessions"], totals: ["42"], error: "GA4 403: brak dostepu" }),
    );

    expect(mapa.size).toBe(0);
  });

  it("wartości mapują się po KOLEJNOŚCI metricHeaders, nie po nazwach z totali", async () => {
    const { ga4TotalsMap } = await loadGa4();

    const mapa = ga4TotalsMap(
      raport({
        metricHeaders: ["sessions", "activeUsers", "screenPageViews"],
        totals: ["17", "13", "31"],
      }),
    );

    expect([...mapa.entries()]).toEqual([
      ["sessions", 17],
      ["activeUsers", 13],
      ["screenPageViews", 31],
    ]);
  });

  it("totale nieliczbowe i brakujące indeksy są pomijane, a nie podstawiane zerem", async () => {
    const { ga4TotalsMap } = await loadGa4();

    const mapa = ga4TotalsMap(
      raport({
        metricHeaders: ["sessions", "bounceRate", "activeUsers", "engagementRate"],
        // "n/d" -> NaN, brak czwartego indeksu -> undefined -> NaN.
        totals: ["17", "n/d", "Infinity"],
      }),
    );

    expect([...mapa.keys()]).toEqual(["sessions"]);
    expect(mapa.get("sessions")).toBe(17);
    expect(mapa.has("bounceRate")).toBe(false);
    expect(mapa.has("activeUsers")).toBe(false);
    expect(mapa.has("engagementRate")).toBe(false);
  });

  it("pusty string totala wchodzi jako 0 - granica, na której brak zlewa się z zerem", async () => {
    // Number("") to 0, więc metryka bez wartości jest nieodróżnialna od zera.
    // Pinowane ŚWIADOMIE: warstwa wyżej (`runGa4DataApiReport`) i tak podstawia
    // "0" za brakujące `value`, więc zmiana tego zachowania musi być decyzją,
    // a nie skutkiem ubocznym refaktoru.
    const { ga4TotalsMap } = await loadGa4();

    const mapa = ga4TotalsMap(raport({ metricHeaders: ["sessions"], totals: [""] }));

    expect(mapa.get("sessions")).toBe(0);
  });

  it("więcej totali niż nagłówków - nadmiarowe wartości nie trafiają do mapy", async () => {
    const { ga4TotalsMap } = await loadGa4();

    const mapa = ga4TotalsMap(raport({ metricHeaders: ["sessions"], totals: ["17", "99"] }));

    expect([...mapa.entries()]).toEqual([["sessions", 17]]);
  });
});
