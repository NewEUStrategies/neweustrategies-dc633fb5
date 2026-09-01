// PO CO TEN PLIK. `src/lib/analytics/ga4.server.ts` wchodzil tu z ZEREM pokrycia
// (0 z 71 linii, 0 z 17 funkcji), a przechodzi przez niego KAZDE uwierzytelnienie
// do PLATNEGO Data API Google'a i KAZDY odczyt property, z ktorego workspace
// czyta swoje liczby. Trzy klasy defektow, ktorych nikt tu dotad nie lapal:
//
//  1) KRYPTOGRAFIA BEZ SWIADKA. Modul sam sklada i podpisuje JWT Service
//     Accountu (`createSign("RSA-SHA256")` + recznie robiony base64url).
//     Wszystkie klasyczne wtopy tego kodu - padding "=" w base64url, "+"/"/"
//     zamiast "-"/"_", brak odescapowania `\n` w kluczu ze zmiennej
//     srodowiskowej, zla kolejnosc segmentow `header.claim` przy podpisie,
//     `aud` niezgodne z `token_uri` - przechodza przez `tsc`, przez przeglad
//     i przez lokalny start. Widac je dopiero, gdy Google odpowie
//     "Invalid JWT Signature", czyli na produkcji. Dlatego testy nizej NIE
//     porownuja stringow z oczekiwanym podpisem, tylko WERYFIKUJA podpis
//     wygenerowanym w tescie kluczem publicznym - i sprawdzaja, ze OBCY klucz
//     tego podpisu nie przyjmuje (inaczej "weryfikacja" nie dowodzilaby niczego).
//
//  2) DWA CACHE'E NA POZIOMIE MODULU. `saTokenCache` i `oauthTokenCache` zyja
//     w zasiegu modulu, czyli w izolacie workera - wspolnie dla wszystkich
//     najemcow i wszystkich zadan. Granica jest jedna liczba: `exp - 60 > now`.
//     Za wczesnie -> placimy Google'owi za podpis i wymiane przy kazdym
//     widgecie; za pozno -> zadanie w locie trafia na wygasly token i caly
//     dashboard pada na 401. Sekunde po obu stronach tej granicy pinuja testy
//     w bloku "cache tokenu".
//
//  3) DEGRADACJA ZAMIAST WYWROTKI. `runGa4DataApiReport` obiecuje w komentarzu,
//     ze NIGDY nie rzuca - jeden niedzialajacy widget nie ma prawa wywrocic
//     calego dashboardu. Ta obietnica nie mial kto sprawdzic dla zadnej z trzech
//     sciezek bledu (non-ok, zdeformowany JSON, wyjatek z sieci).
//
// IZOLACJA NAJEMCOW. `resolveGa4PropertyId` czyta wartosc ZAPISANA PRZEZ
// WORKSPACE (`stored.ga4_property_id` z ustawien analityki) i pozwala ja
// nadpisac globalnym sekretem. Testy dowodza, ze bez sekretu kazdy workspace
// dostaje WLASNE property, oraz ze raport oddaje property, o ktore poproszono -
// bo pomylka na tym poziomie to pokazanie jednemu klientowi liczb drugiego.
//
// CZEGO TU NIE MA. Serwerowe funkcje (`runGa4Report`, `sendGa4Event`), bramka
// uprawnien `requireAnalyticsAdmin` i odczyt ustawien z bazy naleza do
// `ga4.functions.ts` / `gateway.server.ts` i maja swoje miejsca. Tutaj chodzi
// wylacznie o warstwe, ktora podpisuje, cache'uje i rozmawia z Google'em.
//
// ZERO SIECI, ZERO SEKRETOW. `fetch` jest atrapa, a para kluczy RSA powstaje
// w tym pliku przy starcie - w repozytorium nie ma i nie moze byc materialu
// klucza. Wszystkie adresy e-mail sa z domeny example.com.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createVerify, generateKeyPairSync } from "node:crypto";

import type { Ga4Report } from "../ga4.server";

type Ga4Module = typeof import("../ga4.server");

/** Wszystko, co modul czyta ze srodowiska - czyszczone przed KAZDYM przypadkiem. */
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
 * setki milisekund, a zaden przypadek nie potrzebuje SWIEZEJ pary - potrzebuje
 * pary, ktorej klucz publiczny zna wylacznie test.
 */
const SA_KEYS = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  publicKeyEncoding: { type: "spki", format: "pem" },
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
});

/** Druga, niezwiazana para - dowod, ze weryfikacja podpisu cokolwiek znaczy. */
const OBCE_KEYS = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  publicKeyEncoding: { type: "spki", format: "pem" },
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
});

const SA_EMAIL = "ga4-reader@example.com";
const SCOPE = "https://www.googleapis.com/auth/analytics.readonly";

/** Atrapy sekretow OAuth - jawnie testowe napisy, nie material uwierzytelniajacy. */
const OAUTH_CLIENT_ID = "client-id-testowy.apps.example.com";
const OAUTH_CLIENT_SECRET = "sekret-klienta-tylko-do-testu";
const OAUTH_REFRESH_TOKEN = "refresh-token-tylko-do-testu";

const fetchMock = vi.fn<(input: string | URL, init?: RequestInit) => Promise<Response>>();

/**
 * Swieza instancja modulu. Oba cache'e tokenow zyja w zasiegu modulu, wiec bez
 * resetu jeden przypadek podpisywalby token nastepnym - i "cache dziala"
 * przechodziloby nawet wtedy, gdyby nie dzialal.
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
 * Cialo `Response` da sie odczytac DOKLADNIE RAZ, a niejeden przypadek nizej
 * wola `fetch` dwa razy (odswiezenie tokenu, drugi workspace). Atrapa musi wiec
 * budowac odpowiedz przy KAZDYM wywolaniu - wspolna instancja padalaby na
 * "Body has already been used" i udawala defekt kodu produkcyjnego.
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

/** Cialo zadania tokenowego - Google przyjmuje wylacznie form-urlencoded. */
function formularz(index: number): URLSearchParams {
  return new URLSearchParams(String(zadanie(index).init.body ?? ""));
}

function dekoduj(segment: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(segment, "base64url").toString("utf8")) as Record<string, unknown>;
}

/** Niezalezny weryfikator: podpis liczony jest z `header.claim`, nie z calego JWT. */
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
  // Fake'ujemy WYLACZNIE `Date`: cache czyta `Date.now()`, ale odczyt ciala
  // odpowiedzi (`res.text()`) idzie przez prawdziwy runtime i nie ma powodu
  // wpuszczac go na sztuczna kolejke timerow.
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

describe("readServiceAccount - bramka wejscia w tryb Service Account", () => {
  /** Dowod zejscia na OAuth: poleciala WYMIANA REFRESH TOKENU, nie asercja JWT. */
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

  it("bez GA4_SERVICE_ACCOUNT_JSON nie podpisuje zadnego JWT i schodzi na OAuth", async () => {
    await oczekujZejsciaNaOauth();
  });

  it("zdeformowany JSON w sekrecie nie wywraca odczytu - schodzi na OAuth", async () => {
    vi.stubEnv("GA4_SERVICE_ACCOUNT_JSON", '{"client_email": "ga4-reader@example.com",');
    await oczekujZejsciaNaOauth();
  });

  it("plik SA bez client_email schodzi na OAuth zamiast podpisywac JWT bez `iss`", async () => {
    vi.stubEnv("GA4_SERVICE_ACCOUNT_JSON", saJson({ private_key: SA_KEYS.privateKey }));
    await oczekujZejsciaNaOauth();
  });

  it("plik SA bez private_key schodzi na OAuth zamiast probowac podpisu bez klucza", async () => {
    vi.stubEnv("GA4_SERVICE_ACCOUNT_JSON", saJson({ client_email: SA_EMAIL }));
    await oczekujZejsciaNaOauth();
  });

  it("pusty client_email jest traktowany jak brak pola (falsy, nie 'jest, ale puste')", async () => {
    vi.stubEnv(
      "GA4_SERVICE_ACCOUNT_JSON",
      saJson({ client_email: "", private_key: SA_KEYS.privateKey }),
    );
    await oczekujZejsciaNaOauth();
  });
});

describe("podpis JWT Service Accountu", () => {
  it("podpis weryfikuje sie kluczem publicznym SA, a obcym kluczem NIE", async () => {
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

  it("naglowek i claim niosa RS256/JWT, iss, scope analytics.readonly i exp = iat + 3600", async () => {
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

  it("token_uri z pliku SA nadpisuje JEDNOCZESNIE `aud` i adres wymiany", async () => {
    // Rozjazd tych dwoch wartosci to bilet do "Invalid JWT: audience mismatch":
    // token leci pod inny adres, niz deklaruje podpisany claim.
    const wlasnyUri = "https://oauth2.example.org/token";
    vi.stubEnv("GA4_SERVICE_ACCOUNT_JSON", saPoprawny({ token_uri: wlasnyUri }));
    zawsze(() => tokenOk("token-sa"));
    const { resolveGa4AccessToken } = await loadGa4();

    await resolveGa4AccessToken();

    const [, claim] = (formularz(0).get("assertion") ?? "").split(".");
    expect(dekoduj(claim).aud).toBe(wlasnyUri);
    expect(zadanie(0).url).toBe(wlasnyUri);
  });

  it("private_key z literalnymi \\n (tak zyje w zmiennej srodowiskowej) daje wazny podpis", async () => {
    // Klasyk wdrozeniowy: przelamania linii PEM-a zapisane jako dwa znaki.
    // Bez odescapowania `createSign().sign()` rzuca lub podpisuje smieciem.
    const zEscape = SA_KEYS.privateKey.replace(/\n/g, "\\n");
    expect(zEscape).not.toContain("\n");
    vi.stubEnv("GA4_SERVICE_ACCOUNT_JSON", saPoprawny({ private_key: zEscape }));
    zawsze(() => tokenOk("token-sa"));
    const { resolveGa4AccessToken } = await loadGa4();

    const auth = await resolveGa4AccessToken();

    expect(auth?.source).toBe("sa");
    expect(podpisWazny(formularz(0).get("assertion") ?? "", SA_KEYS.publicKey)).toBe(true);
  });

  it("caly JWT jest w base64url - bez '=', '+' i '/'", async () => {
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

  it("sekunde PRZED granica token jest reuzywany - druga rozmowa nie idzie do Google'a", async () => {
    const { resolveGa4AccessToken } = await pierwszyToken();

    // exp = T0 + 3600, margines 60 s => ostatnia sekunda waznosci to T0 + 3539.
    vi.setSystemTime((T0_S + 3539) * 1000);
    const drugi = await resolveGa4AccessToken();

    expect(drugi?.token).toBe("token-pierwszy");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("dokladnie NA granicy token jest podpisywany na nowo (swiezy iat)", async () => {
    const { resolveGa4AccessToken } = await pierwszyToken();

    vi.setSystemTime((T0_S + 3540) * 1000);
    const drugi = await resolveGa4AccessToken();

    expect(drugi?.token).toBe("token-drugi");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const iat = (jwt: string): unknown => dekoduj(jwt.split(".")[1]).iat;
    expect(iat(formularz(0).get("assertion") ?? "")).toBe(T0_S);
    expect(iat(formularz(1).get("assertion") ?? "")).toBe(T0_S + 3540);
    // Drugi podpis tez musi byc wazny - nie wystarczy, ze jest inny.
    expect(podpisWazny(formularz(1).get("assertion") ?? "", SA_KEYS.publicKey)).toBe(true);
  });

  it("odpowiedz bez expires_in nie zamraza cache'u - kolejne wywolanie podpisuje na nowo", async () => {
    // `now + undefined` to NaN, a `NaN - 60 > now` jest falszem. Zachowanie
    // fail-safe (placimy za podpis), ale musi byc pinowane: gdyby porownanie
    // odwrocilo sie na `<`, NaN zamrozilby pusty token na zawsze.
    vi.stubEnv("GA4_SERVICE_ACCOUNT_JSON", saPoprawny());
    zawsze(() => odpowiedz(200, JSON.stringify({ access_token: "token-bez-exp" })));
    const { resolveGa4AccessToken } = await loadGa4();

    expect((await resolveGa4AccessToken())?.token).toBe("token-bez-exp");
    expect((await resolveGa4AccessToken())?.token).toBe("token-bez-exp");

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it.fails(
    "wymiana bez pola access_token nie moze oddac { token: undefined } udajacego string",
    async () => {
      // DEFEKT. Odpowiedz jest rzutowana (`as { access_token: string }`) bez
      // walidacji, wiec brak pola daje `{ token: undefined, source: "sa" }` -
      // obiekt PRAWDZIWY, ktory przechodzi bramke `if (!auth)` u wolajacego
      // (`ga4.functions.ts`, `snapshot.functions.ts`) i konczy sie naglowkiem
      // "Bearer undefined" wyslanym do platnego API. Kontrakt sygnatury
      // (`Promise<{ token: string } | null>`) jest tu zlamany w czasie
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
    // Ani calego assertion, ani samego podpisu - komunikat bledu trafia do logu
    // i (przez niezlapany wyjatek w `runGa4Report`) do odpowiedzi HTTP.
    expect(blad.message).not.toContain(jwt);
    expect(blad.message).not.toContain(jwt.split(".")[2]);
    expect(blad.message).not.toContain(SA_KEYS.privateKey);
  });

  it("cialo bledu jest przycinane do 400 znakow, a nie wklejane w calosci", async () => {
    vi.stubEnv("GA4_SERVICE_ACCOUNT_JSON", saPoprawny());
    zawsze(() => odpowiedz(500, `${"x".repeat(400)}OGON-KTORY-MA-ZNIKNAC`));
    const { resolveGa4AccessToken } = await loadGa4();

    const blad = await przechwycBlad(resolveGa4AccessToken());

    expect(blad.message).toContain("x".repeat(400));
    expect(blad.message).not.toContain("OGON-KTORY-MA-ZNIKNAC");
  });

  it("odpowiedz 200 ze zdeformowanym JSON-em rzuca (fail-loud), zamiast oddac pusty token", async () => {
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

  it("zadanie odswiezenia niesie grant_type=refresh_token i komplet trzech wartosci", async () => {
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

  it("token OAuth w oknie waznosci jest reuzywany miedzy wywolaniami", async () => {
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

  it("nieudane odswiezenie rzuca z kodem statusu i nie wypisuje sekretu ani refresh tokenu", async () => {
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

describe("resolveGa4AccessToken - priorytet zrodel", () => {
  it("Service Account wygrywa z OAuth, gdy skonfigurowane sa OBA", async () => {
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

  it("brak obu trybow daje null bez ani jednego zapytania", async () => {
    const { resolveGa4AccessToken } = await loadGa4();

    expect(await resolveGa4AccessToken()).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("resolveGa4PropertyId - sekret kontra ustawienie workspace'u", () => {
  it("sekret GA4_PROPERTY_ID wygrywa z wartoscia zapisana przez workspace", async () => {
    vi.stubEnv("GA4_PROPERTY_ID", "111111111");
    const { resolveGa4PropertyId } = await loadGa4();

    expect(resolveGa4PropertyId("222222222")).toBe("111111111");
  });

  it("wartosc z bazy jest przycinana z bialych znakow", async () => {
    const { resolveGa4PropertyId } = await loadGa4();

    expect(resolveGa4PropertyId("  222222222\n")).toBe("222222222");
  });

  it("sama biala spacja w bazie to BRAK konfiguracji, a nie property o nazwie spacja", async () => {
    const { resolveGa4PropertyId } = await loadGa4();

    expect(resolveGa4PropertyId("   ")).toBeUndefined();
    expect(resolveGa4PropertyId("")).toBeUndefined();
  });

  it("brak sekretu i brak wpisu (undefined/null) daje undefined", async () => {
    const { resolveGa4PropertyId } = await loadGa4();

    expect(resolveGa4PropertyId()).toBeUndefined();
    expect(resolveGa4PropertyId(null)).toBeUndefined();
  });

  it("bez sekretu KAZDY workspace dostaje wlasne property - zaden nie widzi cudzego", async () => {
    const { resolveGa4PropertyId } = await loadGa4();

    const workspaceA = resolveGa4PropertyId("100000001");
    const workspaceB = resolveGa4PropertyId("100000002");

    expect(workspaceA).toBe("100000001");
    expect(workspaceB).toBe("100000002");
    expect(workspaceA).not.toBe(workspaceB);
  });

  it.fails(
    "pusty sekret GA4_PROPERTY_ID musi znaczyc BRAK sekretu, a nie property o pustej nazwie",
    async () => {
      // DEFEKT. `process.env.GA4_PROPERTY_ID ?? (stored?.trim() || undefined)`
      // uzywa `??`, ktore lapie tylko null/undefined - a pusta zmienna
      // srodowiskowa to PUSTY STRING. Skutek: deklaracja `GA4_PROPERTY_ID=`
      // w .env / w sekretach CI (albo sekret wyczyszczony bez usuniecia klucza)
      // oddaje `""`, wiec `if (!propertyId) return EMPTY_GA4_REPORT`
      // w `ga4.functions.ts` raportuje "GA4 nieskonfigurowane" KAZDEMU
      // workspace'owi, ktory ma poprawne property w bazie. Funkcja sama
      // pokazuje intencje po drugiej stronie wyrazenia (`trim() || undefined`
      // traktuje pusty wpis jak brak), a siostrzany kod w tym samym module
      // (`ga4.functions.ts`: GA4_MEASUREMENT_ID?.trim() || stored...) uzywa
      // wlasnie `||`. Ta asymetria jest bledem, nie decyzja.
      vi.stubEnv("GA4_PROPERTY_ID", "");
      const { resolveGa4PropertyId } = await loadGa4();

      expect(resolveGa4PropertyId("222222222")).toBe("222222222");
    },
  );
});

describe("runGa4DataApiReport - ksztalt zadania", () => {
  const REQ = {
    propertyId: "123456789",
    startDate: "2026-08-01",
    endDate: "2026-08-28",
    dimensions: ["date", "country"],
    metrics: ["sessions", "activeUsers"],
    limit: 100,
  } as const;

  it("uderza w properties/{id}:runReport z naglowkiem Bearer i pelnym cialem", async () => {
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

  it("raport odpowiada property, o ktore poproszono - dwa workspace'y sie nie mieszaja", async () => {
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

  it("mapuje naglowki, wiersze i totale w kolejnosci z odpowiedzi", async () => {
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

  it("brakujace tablice i puste wartosci maja czyste wartosci domyslne", async () => {
    // GA4 pomija `rows`/`totals` przy zerowym ruchu, a pojedyncze `value`
    // potrafi nie przyjsc. Domyslne "" dla wymiaru i "0" dla metryki sa
    // kontraktem dla warstwy wykresow, ktora nie sprawdza undefined.
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

  it("wiersz bez tablic wartosci i totals bez metricValues daja puste listy, nie wyjatek", async () => {
    // Data API pomija cale `dimensionValues` przy zapytaniu bez wymiarow
    // (`snapshot.functions.ts` wola wlasnie tak: `dimensions: []`), a `totals`
    // potrafi przyjsc jako `[{}]`. Kazde z tych trzech `?? []` jest wiec
    // sciezka produkcyjna, a nie obrona przed niemozliwym.
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

  it("pusta tablica totals (zakres bez ruchu) daje puste totale, a nie wyjatek na [0]", async () => {
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

  it("calkiem pusta odpowiedz 200 daje skonfigurowany raport bez ani jednego pola undefined", async () => {
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

  it("odpowiedz non-ok NIE rzuca - wraca configured:true z bledem i bez tokenu w tresci", async () => {
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

  it("cialo bledu raportu jest przycinane do 300 znakow", async () => {
    zawsze(() => odpowiedz(500, `${"y".repeat(300)}OGON-RAPORTU`));
    const { runGa4DataApiReport } = await loadGa4();

    const raport = await runGa4DataApiReport(REQ, "token");

    expect(raport.error).toContain("y".repeat(300));
    expect(raport.error).not.toContain("OGON-RAPORTU");
  });

  it("zdeformowany JSON w odpowiedzi 200 wraca jako blad raportu, a nie wyjatek", async () => {
    zawsze(() => odpowiedz(200, "to nie jest JSON"));
    const { runGa4DataApiReport } = await loadGa4();

    const raport = await runGa4DataApiReport(REQ, "token");

    expect(raport.configured).toBe(true);
    expect(raport.error).toBeTruthy();
    expect(raport.rows).toEqual([]);
  });

  it("wyjatek z sieci wraca jako blad raportu, bez tokenu w komunikacie", async () => {
    fetchMock.mockRejectedValue(new Error("fetch failed: ECONNRESET"));
    const { runGa4DataApiReport } = await loadGa4();

    const raport = await runGa4DataApiReport(REQ, "token-dostepowy-abc");

    expect(raport.error).toBe("fetch failed: ECONNRESET");
    expect(raport.error).not.toContain("token-dostepowy-abc");
    expect(raport.configured).toBe(true);
  });

  it("wyjatek, ktory nie jest Errorem, tez nie wywraca raportu", async () => {
    fetchMock.mockRejectedValue("workerd: subrequest limit");
    const { runGa4DataApiReport } = await loadGa4();

    const raport = await runGa4DataApiReport(REQ, "token");

    expect(raport.error).toBe("workerd: subrequest limit");
  });

  it.fails(
    "raport bledu nie moze wspoldzielic tablic z eksportowanym EMPTY_GA4_REPORT",
    async () => {
      // DEFEKT (utajony, ale wprost miedzynajemcowy). `{ ...EMPTY_GA4_REPORT }`
      // to plytka kopia: `rows`, `totals`, `dimensionHeaders` i `metricHeaders`
      // kazdego raportu bledu to TE SAME instancje tablic, co w module-scope'owej
      // stalej - wspolnej dla calego izolatu workera, czyli dla wszystkich
      // najemcow. `Ga4Report.rows` jest publicznie typowane jako zwykla,
      // mutowalna tablica, wiec sortowanie wierszy pod wykres jest normalnym
      // uzyciem. `ga4.functions.ts` oddaje ponadto `EMPTY_GA4_REPORT` DOSLOWNIE
      // (`if (!propertyId) return EMPTY_GA4_REPORT`), wiec mutacja u jednego
      // wolajacego jest widoczna u kazdego nastepnego. Ponizej to samo w jednym
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

  it("pusta mapa, gdy raport niesie blad - brak danych to nie jest zero", async () => {
    const { ga4TotalsMap } = await loadGa4();

    const mapa = ga4TotalsMap(
      raport({ metricHeaders: ["sessions"], totals: ["42"], error: "GA4 403: brak dostepu" }),
    );

    expect(mapa.size).toBe(0);
  });

  it("wartosci mapuja sie po KOLEJNOSCI metricHeaders, nie po nazwach z totali", async () => {
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

  it("totale nieliczbowe i brakujace indeksy sa pomijane, a nie podstawiane zerem", async () => {
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

  it("pusty string totala wchodzi jako 0 - granica, na ktorej brak zlewa sie z zerem", async () => {
    // Number("") to 0, wiec metryka bez wartosci jest nieodrozninalna od zera.
    // Pinowane SWIADOMIE: warstwa wyzej (`runGa4DataApiReport`) i tak podstawia
    // "0" za brakujace `value`, wiec zmiana tego zachowania musi byc decyzja,
    // a nie skutkiem ubocznym refaktoru.
    const { ga4TotalsMap } = await loadGa4();

    const mapa = ga4TotalsMap(raport({ metricHeaders: ["sessions"], totals: [""] }));

    expect(mapa.get("sessions")).toBe(0);
  });

  it("wiecej totali niz naglowkow - nadmiarowe wartosci nie trafiaja do mapy", async () => {
    const { ga4TotalsMap } = await loadGa4();

    const mapa = ga4TotalsMap(raport({ metricHeaders: ["sessions"], totals: ["17", "99"] }));

    expect([...mapa.entries()]).toEqual([["sessions", 17]]);
  });
});
