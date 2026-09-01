// Warstwa uwierzytelnienia GA4 (`ga4.server.ts`): co ten moduł NAPRAWDĘ podpisuje,
// kiedy sięga po sieć, a kiedy oddaje token z pamięci.
//
// CO TO DOWODZI. Ten plik trzyma jedyną w repozytorium logikę, która PODPISUJE
// asercję RS256 kluczem konta serwisowego i wymienia ją na bearer w Google.
// Błąd tutaj nie wygląda jak błąd: dashboard pokazuje pustą kafelkę, a nie
// wyjątek. Dlatego przypinam rzeczy, których przegląd kodu nie widzi:
//   * podpis JWT-a WERYFIKUJE SIĘ kluczem publicznym wygenerowanym w teście,
//     a obcy klucz go nie weryfikuje (czyli podpisujemy tym, czym trzeba,
//     nad tym, co trzeba - `header.claim`, nie nad samym claimem);
//   * klucz z LITERALNYMI `\n` (tak siedzi w zmiennej środowiskowej po
//     wklejeniu JSON-a jednolinijkowo) jest odescapowany, zanim trafi do
//     `createSign` - bez tego pierwsza wysyłka wywala się na `DECODER routines`;
//   * margines odświeżania 60 s przed wygaśnięciem jest DOKŁADNIE tam, gdzie
//     mówi komentarz: +3539 s to jeszcze cache, +3540 s to już nowy podpis;
//   * żadna ścieżka błędu nie wnosi do komunikatu ANI asercji JWT, ANI bearera
//     - te komunikaty lecą do panelu administratora i do logów.
//
// SEKRETÓW W TYM PLIKU NIE MA I BYĆ NIE MOŻE. Para RSA powstaje w teście przez
// `generateKeyPairSync`, refresh token i client secret to jawne atrapy, a sieci
// nie ma wcale - `fetch` jest podmieniony i każdy przypadek sprawdza, ile razy
// (i pod jaki adres) moduł próbował wyjść na zewnątrz.
//
// DLACZEGO `vi.resetModules()` A NIE EKSPORTOWANY RESET. Moduł trzyma DWA
// cache'e tokenów w zmiennych modułowych (`saTokenCache`, `oauthTokenCache`).
// Sąsiedni `webpush.server.ts` eksportuje `resetVapidCaches()`, ale tam cache
// jest mapą LRU dzieloną między wiele przypadków JEDNEJ instancji modułu.
// Tutaj świeża instancja jest DARMOWA (moduł nie ma żadnej inicjalizacji poza
// importem `node:crypto`), więc nie ma powodu dokładać do produkcji furtki
// istniejącej wyłącznie dla testu. `loadModule()` niżej daje każdemu
// przypadkowi zerowe cache'e bez jednej linii zmiany w kodzie produkcyjnym.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createVerify, generateKeyPairSync } from "node:crypto";

type Ga4ServerModule = typeof import("@/lib/analytics/ga4.server");

/** Zegar ustalony na pełną sekundę - `Math.floor(Date.now()/1000)` bez reszty. */
const NOW_ISO = "2026-09-01T00:00:00.000Z";
const NOW_S = Math.floor(Date.parse(NOW_ISO) / 1000);
/** Google wydaje bearer na 1 h, moduł odświeża 60 s wcześniej. */
const TTL_S = 3600;
const MARGIN_S = 60;
const DEFAULT_TOKEN_URI = "https://oauth2.googleapis.com/token";

/** Klucze GENEROWANE - w repozytorium nie ma żadnego klucza konta serwisowego. */
function rsa(): { privateKey: string; publicKey: string } {
  return generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });
}
const KEY = rsa();
const OBCY = rsa();

/** Atrapy - żadna z tych wartości nie jest i nie może być prawdziwym sekretem. */
const SA_EMAIL = "ga4-tester@example.iam.gserviceaccount.com";
const SA_TOKEN = "ya29.ATRAPA-BEARER-SA";
const OAUTH_TOKEN = "ya29.ATRAPA-BEARER-OAUTH";
const OAUTH_CLIENT_ID = "1234.apps.googleusercontent.com";
const OAUTH_CLIENT_SECRET = "ATRAPA-CLIENT-SECRET";
const OAUTH_REFRESH = "1//ATRAPA-REFRESH-TOKEN";

const GA4_ENV = [
  "GA4_SERVICE_ACCOUNT_JSON",
  "GA4_OAUTH_CLIENT_ID",
  "GA4_OAUTH_CLIENT_SECRET",
  "GA4_OAUTH_REFRESH_TOKEN",
  "GA4_PROPERTY_ID",
] as const;

const h = vi.hoisted(() => ({
  fetchMock: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
}));

/** Świeży moduł = zerowe cache'e tokenów. Patrz nagłówek pliku. */
async function loadModule(): Promise<Ga4ServerModule> {
  vi.resetModules();
  return import("@/lib/analytics/ga4.server");
}

function res(body: unknown, init: { ok?: boolean; status?: number } = {}) {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  return { ok: init.ok ?? true, status: init.status ?? 200, text: async () => text };
}

function tokenBody(token: string, expiresIn = TTL_S) {
  return { access_token: token, expires_in: expiresIn };
}

function serviceAccount(over: Record<string, unknown> = {}): Record<string, unknown> {
  return { client_email: SA_EMAIL, private_key: KEY.privateKey, ...over };
}

function stubSa(json: string | Record<string, unknown>): void {
  vi.stubEnv("GA4_SERVICE_ACCOUNT_JSON", typeof json === "string" ? json : JSON.stringify(json));
}

function stubOauth(): void {
  vi.stubEnv("GA4_OAUTH_CLIENT_ID", OAUTH_CLIENT_ID);
  vi.stubEnv("GA4_OAUTH_CLIENT_SECRET", OAUTH_CLIENT_SECRET);
  vi.stubEnv("GA4_OAUTH_REFRESH_TOKEN", OAUTH_REFRESH);
}

function callUrl(i: number): string {
  return String(h.fetchMock.mock.calls[i]?.[0]);
}
function callInit(i: number): RequestInit {
  return (h.fetchMock.mock.calls[i]?.[1] ?? {}) as RequestInit;
}
function callBody(i: number): string {
  return String(callInit(i).body ?? "");
}
function callHeaders(i: number): Record<string, string> {
  return (callInit(i).headers ?? {}) as Record<string, string>;
}
/** Asercja JWT wyjęta z ciała `application/x-www-form-urlencoded`. */
function assertionOf(i: number): string {
  return new URLSearchParams(callBody(i)).get("assertion") ?? "";
}

interface DecodedJwt {
  header: Record<string, unknown>;
  claim: Record<string, unknown>;
  signInput: string;
  signature: string;
}
function decodeJwt(jwt: string): DecodedJwt {
  const [h64, c64, s64] = jwt.split(".");
  return {
    header: JSON.parse(Buffer.from(h64, "base64url").toString("utf8")) as Record<string, unknown>,
    claim: JSON.parse(Buffer.from(c64, "base64url").toString("utf8")) as Record<string, unknown>,
    signInput: `${h64}.${c64}`,
    signature: s64,
  };
}
/** Weryfikacja podpisu NIEZALEŻNA od implementacji modułu. */
function verifyJwt(jwt: string, publicKeyPem: string): boolean {
  const { signInput, signature } = decodeJwt(jwt);
  const v = createVerify("RSA-SHA256");
  v.update(signInput);
  v.end();
  return v.verify(publicKeyPem, signature, "base64url");
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(NOW_ISO));
  vi.stubGlobal("fetch", h.fetchMock);
  h.fetchMock.mockReset();
  h.fetchMock.mockImplementation(async () => res(tokenBody(SA_TOKEN)));
  // Środowisko hosta nie może przeciekać do przypadku - kasujemy WSZYSTKIE
  // zmienne GA4, żeby "brak konfiguracji" znaczyło brak konfiguracji.
  for (const k of GA4_ENV) vi.stubEnv(k, undefined);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

/* ===================================================================== */

describe("readServiceAccount - kiedy konto serwisowe w ogóle wchodzi do gry", () => {
  it("brak zmiennej: konto serwisowe nie wchodzi i nie ma żadnego zapytania", async () => {
    const { resolveGa4AccessToken } = await loadModule();

    await expect(resolveGa4AccessToken()).resolves.toBeNull();
    expect(h.fetchMock).not.toHaveBeenCalled();
  });

  it("zepsuty JSON nie wywraca resolwera - konto jest po prostu nieskonfigurowane", async () => {
    stubSa("{to nie jest json");
    const { resolveGa4AccessToken } = await loadModule();

    await expect(resolveGa4AccessToken()).resolves.toBeNull();
    expect(h.fetchMock).not.toHaveBeenCalled();
  });

  it("JSON bez client_email jest odrzucany zanim cokolwiek podpiszemy", async () => {
    stubSa({ private_key: KEY.privateKey });
    const { resolveGa4AccessToken } = await loadModule();

    await expect(resolveGa4AccessToken()).resolves.toBeNull();
    expect(h.fetchMock).not.toHaveBeenCalled();
  });

  it("JSON bez private_key jest odrzucany zanim cokolwiek podpiszemy", async () => {
    stubSa({ client_email: SA_EMAIL });
    const { resolveGa4AccessToken } = await loadModule();

    await expect(resolveGa4AccessToken()).resolves.toBeNull();
    expect(h.fetchMock).not.toHaveBeenCalled();
  });

  it("poprawne konto daje token ze źródłem 'sa'", async () => {
    stubSa(serviceAccount());
    const { resolveGa4AccessToken } = await loadModule();

    await expect(resolveGa4AccessToken()).resolves.toEqual({ token: SA_TOKEN, source: "sa" });
    expect(h.fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("getServiceAccountToken - podpis asercji", () => {
  it("podpisany JWT weryfikuje się kluczem publicznym pary wygenerowanej w teście", async () => {
    stubSa(serviceAccount());
    const { resolveGa4AccessToken } = await loadModule();

    await resolveGa4AccessToken();
    const jwt = assertionOf(0);
    const { header, claim } = decodeJwt(jwt);

    expect(verifyJwt(jwt, KEY.publicKey)).toBe(true);
    expect(header).toEqual({ alg: "RS256", typ: "JWT" });
    expect(claim.iss).toBe(SA_EMAIL);
    expect(claim.scope).toBe("https://www.googleapis.com/auth/analytics.readonly");
    expect(claim.aud).toBe(DEFAULT_TOKEN_URI);
    expect(claim.iat).toBe(NOW_S);
    expect(claim.exp).toBe(NOW_S + TTL_S);
  });

  it("obcy klucz publiczny NIE weryfikuje podpisu", async () => {
    stubSa(serviceAccount());
    const { resolveGa4AccessToken } = await loadModule();

    await resolveGa4AccessToken();

    expect(verifyJwt(assertionOf(0), OBCY.publicKey)).toBe(false);
  });

  it("podpis idzie nad `header.claim`, nie nad samym claimem (podmiana nagłówka psuje podpis)", async () => {
    stubSa(serviceAccount());
    const { resolveGa4AccessToken } = await loadModule();

    await resolveGa4AccessToken();
    const { claim, signature } = decodeJwt(assertionOf(0));
    const podmieniony = [
      Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url"),
      Buffer.from(JSON.stringify(claim)).toString("base64url"),
      signature,
    ].join(".");

    expect(verifyJwt(podmieniony, KEY.publicKey)).toBe(false);
  });

  it("klucz z LITERALNYMI `\\n` jest odescapowany i podpisuje tak samo poprawnie", async () => {
    // Tak wygląda klucz wklejony do zmiennej środowiskowej jako jedna linia.
    stubSa(serviceAccount({ private_key: KEY.privateKey.replace(/\n/g, "\\n") }));
    const { resolveGa4AccessToken } = await loadModule();

    await expect(resolveGa4AccessToken()).resolves.toEqual({ token: SA_TOKEN, source: "sa" });
    expect(verifyJwt(assertionOf(0), KEY.publicKey)).toBe(true);
  });

  it("token_uri z konta nadpisuje adres wymiany ORAZ `aud` asercji", async () => {
    const custom = "https://oauth2.example.test/token";
    stubSa(serviceAccount({ token_uri: custom }));
    const { resolveGa4AccessToken } = await loadModule();

    await resolveGa4AccessToken();

    expect(callUrl(0)).toBe(custom);
    expect(decodeJwt(assertionOf(0)).claim.aud).toBe(custom);
  });

  it("wymiana leci POST-em jako form-urlencoded z grant_type jwt-bearer", async () => {
    stubSa(serviceAccount());
    const { resolveGa4AccessToken } = await loadModule();

    await resolveGa4AccessToken();
    const params = new URLSearchParams(callBody(0));

    expect(callUrl(0)).toBe(DEFAULT_TOKEN_URI);
    expect(callInit(0).method).toBe("POST");
    expect(callHeaders(0)["Content-Type"]).toBe("application/x-www-form-urlencoded");
    expect(params.get("grant_type")).toBe("urn:ietf:params:oauth:grant-type:jwt-bearer");
  });

  it("klucz nie do odczytania rzuca, ale komunikat NIE zawiera materiału klucza", async () => {
    stubSa(
      serviceAccount({
        private_key: "-----BEGIN PRIVATE KEY-----\nATRAPA-CIALO\n-----END PRIVATE KEY-----\n",
      }),
    );
    const { resolveGa4AccessToken } = await loadModule();

    await expect(resolveGa4AccessToken()).rejects.toThrow();
    await expect(resolveGa4AccessToken()).rejects.not.toThrow(/ATRAPA-CIALO/);
    expect(h.fetchMock).not.toHaveBeenCalled();
  });
});

describe("getServiceAccountToken - cache i margines 60 s", () => {
  it("token w oknie ważności jest REUŻYWANY: +3539 s to nadal jedno zapytanie", async () => {
    stubSa(serviceAccount());
    const { resolveGa4AccessToken } = await loadModule();

    await resolveGa4AccessToken();
    // exp = NOW + 3600; warunek reużycia to `exp - 60 > now`, czyli now < NOW+3540.
    vi.setSystemTime(new Date((NOW_S + TTL_S - MARGIN_S - 1) * 1000));
    await expect(resolveGa4AccessToken()).resolves.toEqual({ token: SA_TOKEN, source: "sa" });

    expect(h.fetchMock).toHaveBeenCalledTimes(1);
  });

  it("token wchodzący w margines jest PODPISYWANY NA NOWO: +3540 s to drugie zapytanie", async () => {
    stubSa(serviceAccount());
    h.fetchMock
      .mockImplementationOnce(async () => res(tokenBody(SA_TOKEN)))
      .mockImplementationOnce(async () => res(tokenBody(`${SA_TOKEN}-2`)));
    const { resolveGa4AccessToken } = await loadModule();

    await resolveGa4AccessToken();
    const przesuniecie = NOW_S + TTL_S - MARGIN_S;
    vi.setSystemTime(new Date(przesuniecie * 1000));
    await expect(resolveGa4AccessToken()).resolves.toEqual({
      token: `${SA_TOKEN}-2`,
      source: "sa",
    });

    expect(h.fetchMock).toHaveBeenCalledTimes(2);
    const drugi = decodeJwt(assertionOf(1)).claim;
    expect(drugi.iat).toBe(przesuniecie);
    expect(drugi.exp).toBe(przesuniecie + TTL_S);
  });

  it("krótkie `expires_in` skraca okno cache'u (30 s < margines, więc zawsze świeży podpis)", async () => {
    stubSa(serviceAccount());
    h.fetchMock.mockImplementation(async () => res(tokenBody(SA_TOKEN, 30)));
    const { resolveGa4AccessToken } = await loadModule();

    await resolveGa4AccessToken();
    await resolveGa4AccessToken();

    expect(h.fetchMock).toHaveBeenCalledTimes(2);
  });

  it.fails(
    "DEFEKT: cache nie jest kluczowany tożsamością konta - drugie konto dostaje CUDZY bearer",
    async () => {
      // `saTokenCache` to JEDNA zmienna modułowa bez klucza. Po rotacji sekretu
      // (albo w konfiguracji wielodzierżawnej) moduł przez maksymalnie godzinę
      // oddaje bearer WYSTAWIONY DLA POPRZEDNIEGO konta i nie robi żadnego
      // zapytania - a wywołujący nie ma jak tego zauważyć, bo dostaje `source: "sa"`.
      // STAN FAKTYCZNY: fetch wołany RAZ, drugie konto dostaje token pierwszego.
      stubSa(serviceAccount());
      h.fetchMock
        .mockImplementationOnce(async () => res(tokenBody(SA_TOKEN)))
        .mockImplementationOnce(async () => res(tokenBody(`${SA_TOKEN}-INNE-KONTO`)));
      const { resolveGa4AccessToken } = await loadModule();

      await resolveGa4AccessToken();
      stubSa(serviceAccount({ client_email: "inne-konto@example.iam.gserviceaccount.com" }));

      await expect(resolveGa4AccessToken()).resolves.toEqual({
        token: `${SA_TOKEN}-INNE-KONTO`,
        source: "sa",
      });
      expect(h.fetchMock).toHaveBeenCalledTimes(2);
    },
  );
});

describe("getServiceAccountToken - kształt odpowiedzi nie jest sprawdzany", () => {
  it.fails("DEFEKT: wymiana bez pola access_token oddaje `undefined` udające string", async () => {
    // `JSON.parse(body) as { access_token: string; expires_in: number }` to
    // rzutowanie, nie walidacja. Odpowiedź 200 bez `access_token` (proxy,
    // zmiana kontraktu, częściowa awaria) daje `{ token: undefined }` z
    // typem `string`, a wołający wstawia to do nagłówka jako
    // "Authorization: Bearer undefined" i dostaje z GA4 401, który
    // wygląda jak problem z uprawnieniami, a nie z wymianą tokenu.
    // STAN FAKTYCZNY: resolwer oddaje { token: undefined, source: "sa" }.
    stubSa(serviceAccount());
    h.fetchMock.mockImplementation(async () => res({ expires_in: TTL_S }));
    const { resolveGa4AccessToken } = await loadModule();

    await expect(resolveGa4AccessToken()).rejects.toThrow();
  });

  it("STAN FAKTYCZNY: brak expires_in daje exp = NaN, więc cache nigdy nie trafia", async () => {
    // Skutek uboczny tego samego rzutowania - akurat bezpieczny: `NaN - 60 > now`
    // jest fałszem, więc moduł podpisuje na nowo, zamiast oddawać wieczny token.
    stubSa(serviceAccount());
    h.fetchMock.mockImplementation(async () => res({ access_token: SA_TOKEN }));
    const { resolveGa4AccessToken } = await loadModule();

    await resolveGa4AccessToken();
    await resolveGa4AccessToken();

    expect(h.fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe("getServiceAccountToken - błąd wymiany nie wynosi sekretów", () => {
  it("nie-ok rzuca ze STATUSEM, a komunikat nie zawiera ani asercji, ani bearera", async () => {
    stubSa(serviceAccount());
    h.fetchMock.mockImplementation(async () =>
      res('{"error":"invalid_grant","error_description":"Invalid JWT Signature."}', {
        ok: false,
        status: 400,
      }),
    );
    const { resolveGa4AccessToken } = await loadModule();

    const blad = await resolveGa4AccessToken().catch((e: unknown) => e);

    expect(blad).toBeInstanceOf(Error);
    const msg = (blad as Error).message;
    expect(msg).toContain("400");
    expect(msg).toContain("invalid_grant");
    expect(msg).not.toContain(assertionOf(0));
    expect(msg).not.toContain(SA_TOKEN);
    // Nawet fragment podpisu nie może wyciec - komunikat idzie do panelu i logów.
    expect(msg).not.toContain(assertionOf(0).split(".")[2].slice(0, 24));
  });

  it("ciało odpowiedzi jest przycięte do 400 znaków (log nie dostaje megabajta)", async () => {
    stubSa(serviceAccount());
    h.fetchMock.mockImplementation(async () => res("x".repeat(5000), { ok: false, status: 500 }));
    const { resolveGa4AccessToken } = await loadModule();

    const blad = (await resolveGa4AccessToken().catch((e: unknown) => e)) as Error;

    expect(blad.message).toHaveLength("GA4 SA token exchange 500: ".length + 400);
  });

  it("PIN: SyntaxError z ciała 200 nie może urosnąć do pełnego bearera", async () => {
    // Node 22 wkleja do komunikatu `JSON.parse` pierwsze ~10 znaków wejścia
    // ("Unexpected token 'y', \"ya29.ATRAP\"... is not valid JSON"). To JEDYNA
    // resztkowa ekspozycja w tym module i jest ograniczona do tych ~10 znaków.
    // Test istnieje po to, żeby ktoś, kto "poprawi" diagnostykę przez
    // `catch { throw new Error(... body.slice(0, 400)) }` wokół `JSON.parse`,
    // zobaczył czerwień: tamten wariant wyniósłby CAŁY bearer do logu.
    stubSa(serviceAccount());
    h.fetchMock.mockImplementation(async () => res(`${SA_TOKEN}\n<uciete przez proxy>`));
    const { resolveGa4AccessToken } = await loadModule();

    const blad = (await resolveGa4AccessToken().catch((e: unknown) => e)) as Error;

    expect(blad.message).not.toContain(SA_TOKEN);
    expect(blad.message).not.toContain(SA_TOKEN.slice(0, 12));
  });

  it("odpowiedź 200 o nie-JSON-owym ciele rzuca, a cache zostaje pusty", async () => {
    stubSa(serviceAccount());
    h.fetchMock.mockImplementation(async () => res("<html>proxy</html>"));
    const { resolveGa4AccessToken } = await loadModule();

    await expect(resolveGa4AccessToken()).rejects.toThrow(/JSON/);
    // Nieudana wymiana nie może zapisać nic do cache'u: druga próba znów pyta.
    await expect(resolveGa4AccessToken()).rejects.toThrow(/JSON/);
    expect(h.fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe("getOauthAccessToken", () => {
  it.each([["GA4_OAUTH_CLIENT_ID"], ["GA4_OAUTH_CLIENT_SECRET"], ["GA4_OAUTH_REFRESH_TOKEN"]])(
    "brak %s to brak tokenu i brak zapytania",
    async (brakujaca) => {
      stubOauth();
      vi.stubEnv(brakujaca, undefined);
      const { resolveGa4AccessToken } = await loadModule();

      await expect(resolveGa4AccessToken()).resolves.toBeNull();
      expect(h.fetchMock).not.toHaveBeenCalled();
    },
  );

  it("komplet trzech zmiennych daje token ze źródłem 'oauth' i pełnym ciałem refresh", async () => {
    stubOauth();
    h.fetchMock.mockImplementation(async () => res(tokenBody(OAUTH_TOKEN)));
    const { resolveGa4AccessToken } = await loadModule();

    await expect(resolveGa4AccessToken()).resolves.toEqual({
      token: OAUTH_TOKEN,
      source: "oauth",
    });
    const params = new URLSearchParams(callBody(0));
    expect(callUrl(0)).toBe(DEFAULT_TOKEN_URI);
    expect(params.get("grant_type")).toBe("refresh_token");
    expect(params.get("client_id")).toBe(OAUTH_CLIENT_ID);
    expect(params.get("client_secret")).toBe(OAUTH_CLIENT_SECRET);
    expect(params.get("refresh_token")).toBe(OAUTH_REFRESH);
  });

  it("token OAuth jest reużywany w oknie ważności (+3539 s = jedno zapytanie)", async () => {
    stubOauth();
    h.fetchMock.mockImplementation(async () => res(tokenBody(OAUTH_TOKEN)));
    const { resolveGa4AccessToken } = await loadModule();

    await resolveGa4AccessToken();
    vi.setSystemTime(new Date((NOW_S + TTL_S - MARGIN_S - 1) * 1000));
    await resolveGa4AccessToken();

    expect(h.fetchMock).toHaveBeenCalledTimes(1);
  });

  it("token OAuth w marginesie jest odświeżany (+3540 s = drugie zapytanie)", async () => {
    stubOauth();
    h.fetchMock
      .mockImplementationOnce(async () => res(tokenBody(OAUTH_TOKEN)))
      .mockImplementationOnce(async () => res(tokenBody(`${OAUTH_TOKEN}-2`)));
    const { resolveGa4AccessToken } = await loadModule();

    await resolveGa4AccessToken();
    vi.setSystemTime(new Date((NOW_S + TTL_S - MARGIN_S) * 1000));

    await expect(resolveGa4AccessToken()).resolves.toEqual({
      token: `${OAUTH_TOKEN}-2`,
      source: "oauth",
    });
    expect(h.fetchMock).toHaveBeenCalledTimes(2);
  });

  it("nie-ok rzuca ze statusem, a komunikat nie niesie client_secret ani refresh tokenu", async () => {
    stubOauth();
    h.fetchMock.mockImplementation(async () =>
      res('{"error":"invalid_grant"}', { ok: false, status: 401 }),
    );
    const { resolveGa4AccessToken } = await loadModule();

    const blad = (await resolveGa4AccessToken().catch((e: unknown) => e)) as Error;

    expect(blad.message).toContain("GA4 OAuth refresh 401");
    expect(blad.message).not.toContain(OAUTH_CLIENT_SECRET);
    expect(blad.message).not.toContain(OAUTH_REFRESH);
  });
});

describe("resolveGa4AccessToken - pierwszeństwo źródeł", () => {
  it("konto serwisowe WYGRYWA z OAuth - refresh nie jest nawet próbowany", async () => {
    stubSa(serviceAccount());
    stubOauth();
    h.fetchMock.mockImplementation(async () => res(tokenBody(SA_TOKEN)));
    const { resolveGa4AccessToken } = await loadModule();

    await expect(resolveGa4AccessToken()).resolves.toEqual({ token: SA_TOKEN, source: "sa" });
    expect(h.fetchMock).toHaveBeenCalledTimes(1);
    expect(new URLSearchParams(callBody(0)).get("grant_type")).toBe(
      "urn:ietf:params:oauth:grant-type:jwt-bearer",
    );
  });

  it("zepsute konto serwisowe przepuszcza ruch na OAuth", async () => {
    stubSa("{zepsuty");
    stubOauth();
    h.fetchMock.mockImplementation(async () => res(tokenBody(OAUTH_TOKEN)));
    const { resolveGa4AccessToken } = await loadModule();

    await expect(resolveGa4AccessToken()).resolves.toEqual({
      token: OAUTH_TOKEN,
      source: "oauth",
    });
  });

  it("brak obu konfiguracji to null bez ani jednego zapytania", async () => {
    const { resolveGa4AccessToken } = await loadModule();

    await expect(resolveGa4AccessToken()).resolves.toBeNull();
    expect(h.fetchMock).not.toHaveBeenCalled();
  });

  it.fails(
    "DEFEKT: padnięta wymiana SA nie spada na skonfigurowany OAuth, tylko rzuca",
    async () => {
      // `resolveGa4AccessToken` woła `getServiceAccountToken` BEZ try/catch, więc
      // 400 od Google (np. odwołany klucz) wychodzi wyjątkiem przez całą warstwę
      // serwerową, choć sprawny refresh token siedzi obok w konfiguracji.
      // Kontrakt raportu ("nigdy nie rzuca") kończy się poziom niżej, w
      // `runGa4DataApiReport` - tu go nie ma. STAN FAKTYCZNY: rzuca.
      stubSa(serviceAccount());
      stubOauth();
      h.fetchMock
        .mockImplementationOnce(async () =>
          res('{"error":"invalid_grant"}', { ok: false, status: 400 }),
        )
        .mockImplementationOnce(async () => res(tokenBody(OAUTH_TOKEN)));
      const { resolveGa4AccessToken } = await loadModule();

      await expect(resolveGa4AccessToken()).resolves.toEqual({
        token: OAUTH_TOKEN,
        source: "oauth",
      });
    },
  );
});

describe("resolveGa4PropertyId", () => {
  it("sekret wygrywa z wartością z bazy", async () => {
    vi.stubEnv("GA4_PROPERTY_ID", "111");
    const { resolveGa4PropertyId } = await loadModule();

    expect(resolveGa4PropertyId("222")).toBe("111");
  });

  it("wartość z bazy jest przycinana z białych znaków", async () => {
    const { resolveGa4PropertyId } = await loadModule();

    expect(resolveGa4PropertyId("  222  ")).toBe("222");
  });

  it.each([
    ["", undefined],
    ["   ", undefined],
    [null, undefined],
    [undefined, undefined],
  ])("pusta wartość z bazy (%j) daje undefined, a nie pusty string", async (stored, oczekiwane) => {
    const { resolveGa4PropertyId } = await loadModule();

    expect(resolveGa4PropertyId(stored as string | null | undefined)).toBe(oczekiwane);
  });

  it.fails("DEFEKT: PUSTY sekret GA4_PROPERTY_ID wygrywa z poprawną wartością z bazy", async () => {
    // `process.env.GA4_PROPERTY_ID ?? (...)` - `??` łapie tylko null/undefined,
    // a zmienna ustawiona na pusty string jest pustym STRINGIEM, nie brakiem.
    // Skutek: deploy z `GA4_PROPERTY_ID=` w panelu hostingu wyłącza GA4 po cichu
    // (`if (!propertyId) return EMPTY_GA4_REPORT` w ga4.functions.ts), mimo że
    // administrator ustawił property w bazie. STAN FAKTYCZNY: zwraca "".
    vi.stubEnv("GA4_PROPERTY_ID", "");
    const { resolveGa4PropertyId } = await loadModule();

    expect(resolveGa4PropertyId("222")).toBe("222");
  });

  it.fails("DEFEKT: wartość z sekretu nie jest przycinana, w przeciwieństwie do bazy", async () => {
    // Ta sama wartość z bazy przechodzi przez `.trim()`, a z sekretu - nie.
    // " 111 " trafia wprost do URL-a `properties/ 111 :runReport`.
    vi.stubEnv("GA4_PROPERTY_ID", " 111 ");
    const { resolveGa4PropertyId } = await loadModule();

    expect(resolveGa4PropertyId(null)).toBe("111");
  });
});

describe("runGa4DataApiReport - ścieżka szczęśliwa", () => {
  const req = {
    propertyId: "123456",
    startDate: "28daysAgo",
    endDate: "today",
    dimensions: ["date", "country"],
    metrics: ["sessions", "activeUsers"],
    limit: 100,
  } as const;

  const odpowiedz = {
    dimensionHeaders: [{ name: "date" }, { name: "country" }],
    metricHeaders: [{ name: "sessions" }, { name: "activeUsers" }],
    rows: [
      {
        dimensionValues: [{ value: "20260901" }, { value: "PL" }],
        metricValues: [{ value: "12" }, { value: "7" }],
      },
    ],
    totals: [{ metricValues: [{ value: "12" }, { value: "7" }] }],
  };

  it("mapuje nagłówki, wiersze i totale na DTO raportu", async () => {
    h.fetchMock.mockImplementation(async () => res(odpowiedz));
    const { runGa4DataApiReport } = await loadModule();

    await expect(runGa4DataApiReport(req, SA_TOKEN)).resolves.toEqual({
      configured: true,
      propertyId: "123456",
      dimensionHeaders: ["date", "country"],
      metricHeaders: ["sessions", "activeUsers"],
      rows: [{ dims: ["20260901", "PL"], metrics: ["12", "7"] }],
      totals: ["12", "7"],
    });
  });

  it("nagłówek Authorization niesie bearer, a ciało - zakres, wymiary i limit jako string", async () => {
    h.fetchMock.mockImplementation(async () => res(odpowiedz));
    const { runGa4DataApiReport } = await loadModule();

    await runGa4DataApiReport(req, SA_TOKEN);

    expect(callUrl(0)).toBe(
      "https://analyticsdata.googleapis.com/v1beta/properties/123456:runReport",
    );
    expect(callHeaders(0).Authorization).toBe(`Bearer ${SA_TOKEN}`);
    expect(callHeaders(0)["Content-Type"]).toBe("application/json");
    expect(JSON.parse(callBody(0))).toEqual({
      dateRanges: [{ startDate: "28daysAgo", endDate: "today" }],
      dimensions: [{ name: "date" }, { name: "country" }],
      metrics: [{ name: "sessions" }, { name: "activeUsers" }],
      limit: "100",
    });
  });

  it("odpowiedź bez rows i bez totals nie wywraca mapowania (same puste tablice)", async () => {
    h.fetchMock.mockImplementation(async () => res({}));
    const { runGa4DataApiReport } = await loadModule();

    await expect(runGa4DataApiReport(req, SA_TOKEN)).resolves.toEqual({
      configured: true,
      propertyId: "123456",
      dimensionHeaders: [],
      metricHeaders: [],
      rows: [],
      totals: [],
    });
  });

  it.each([
    ["pusta tablica totals", { totals: [] }],
    ["totals bez metricValues", { totals: [{}] }],
  ])("%s daje puste totale, a nie wyjątek", async (_nazwa, payload) => {
    h.fetchMock.mockImplementation(async () => res(payload));
    const { runGa4DataApiReport } = await loadModule();

    await expect(runGa4DataApiReport(req, SA_TOKEN)).resolves.toMatchObject({ totals: [] });
  });

  it("total bez pola value schodzi do '0' (tak jak metryka w wierszu)", async () => {
    h.fetchMock.mockImplementation(async () => res({ totals: [{ metricValues: [{}] }] }));
    const { runGa4DataApiReport } = await loadModule();

    await expect(runGa4DataApiReport(req, SA_TOKEN)).resolves.toMatchObject({ totals: ["0"] });
  });

  it("brakujące pola odpowiedzi dają puste tablice, a brakujące wartości - '' i '0'", async () => {
    h.fetchMock.mockImplementation(async () =>
      res({ rows: [{}, { dimensionValues: [{}], metricValues: [{}] }] }),
    );
    const { runGa4DataApiReport } = await loadModule();

    await expect(runGa4DataApiReport(req, SA_TOKEN)).resolves.toEqual({
      configured: true,
      propertyId: "123456",
      dimensionHeaders: [],
      metricHeaders: [],
      rows: [
        { dims: [], metrics: [] },
        { dims: [""], metrics: ["0"] },
      ],
      totals: [],
    });
  });
});

describe("runGa4DataApiReport - degradacja zamiast wyjątku", () => {
  const req = {
    propertyId: "123456",
    startDate: "28daysAgo",
    endDate: "today",
    dimensions: [],
    metrics: ["sessions"],
    limit: 10,
  } as const;

  it("nie-ok oddaje configured:true z błędem i NIE rzuca, a bearer nie trafia do komunikatu", async () => {
    h.fetchMock.mockImplementation(async () =>
      res('{"error":{"code":403,"message":"caller lacks permission"}}', {
        ok: false,
        status: 403,
      }),
    );
    const { runGa4DataApiReport } = await loadModule();

    const raport = await runGa4DataApiReport(req, SA_TOKEN);

    expect(raport.configured).toBe(true);
    expect(raport.propertyId).toBe("123456");
    expect(raport.rows).toEqual([]);
    expect(raport.error).toContain("GA4 403");
    expect(raport.error).toContain("caller lacks permission");
    expect(raport.error).not.toContain(SA_TOKEN);
  });

  it("ciało błędu jest przycięte do 300 znaków", async () => {
    h.fetchMock.mockImplementation(async () => res("y".repeat(4000), { ok: false, status: 500 }));
    const { runGa4DataApiReport } = await loadModule();

    const raport = await runGa4DataApiReport(req, SA_TOKEN);

    expect(raport.error).toHaveLength("GA4 500: ".length + 300);
  });

  it("odpowiedź 200 o zepsutym JSON-ie kończy się polem error, nie wyjątkiem", async () => {
    h.fetchMock.mockImplementation(async () => res("<html>504 gateway</html>"));
    const { runGa4DataApiReport } = await loadModule();

    const raport = await runGa4DataApiReport(req, SA_TOKEN);

    expect(raport.configured).toBe(true);
    expect(raport.error).toBeTruthy();
    expect(raport.error).not.toContain(SA_TOKEN);
  });

  it("wyjątek z samego fetch (sieć padła) staje się polem error", async () => {
    h.fetchMock.mockImplementation(async () => {
      throw new Error("fetch failed");
    });
    const { runGa4DataApiReport } = await loadModule();

    await expect(runGa4DataApiReport(req, SA_TOKEN)).resolves.toMatchObject({
      configured: true,
      error: "fetch failed",
    });
  });

  it("rzucona wartość nie będąca Error też nie wywraca raportu", async () => {
    h.fetchMock.mockImplementation(async () => {
      throw "timeout";
    });
    const { runGa4DataApiReport } = await loadModule();

    await expect(runGa4DataApiReport(req, SA_TOKEN)).resolves.toMatchObject({
      configured: true,
      error: "timeout",
    });
  });
});

describe("runGa4DataApiReport - izolacja od eksportowanej stałej", () => {
  const req = {
    propertyId: "123456",
    startDate: "28daysAgo",
    endDate: "today",
    dimensions: [],
    metrics: ["sessions"],
    limit: 10,
  } as const;

  it.fails(
    "DEFEKT: raport ze ścieżki błędu WSPÓŁDZIELI tablice z eksportowanym EMPTY_GA4_REPORT",
    async () => {
      // `{ ...EMPTY_GA4_REPORT }` to płytka kopia: `rows`, `totals`,
      // `dimensionHeaders` i `metricHeaders` to TE SAME instancje tablic co
      // w eksportowanej stałej. Każdy raport ze ścieżki błędu (a takich jest
      // większość w awarii) oddaje wołającemu uchwyt do współdzielonego stanu
      // modułu - jeden `report.rows.push(...)` u konsumenta zatruwa raporty
      // wszystkich następnych wywołań w tym workerze, także innych najemców.
      // STAN FAKTYCZNY: to ta sama referencja.
      h.fetchMock.mockImplementation(async () => res("nie ma", { ok: false, status: 500 }));
      const { runGa4DataApiReport, EMPTY_GA4_REPORT } = await loadModule();

      const raport = await runGa4DataApiReport(req, SA_TOKEN);

      expect(raport.rows).not.toBe(EMPTY_GA4_REPORT.rows);
      expect(raport.totals).not.toBe(EMPTY_GA4_REPORT.totals);
      expect(raport.metricHeaders).not.toBe(EMPTY_GA4_REPORT.metricHeaders);
    },
  );

  it("ścieżka szczęśliwa buduje własne tablice (defekt dotyczy tylko błędów)", async () => {
    h.fetchMock.mockImplementation(async () => res({ rows: [], totals: [] }));
    const { runGa4DataApiReport, EMPTY_GA4_REPORT } = await loadModule();

    const raport = await runGa4DataApiReport(req, SA_TOKEN);

    expect(raport.rows).not.toBe(EMPTY_GA4_REPORT.rows);
    expect(raport.totals).not.toBe(EMPTY_GA4_REPORT.totals);
  });
});

describe("ga4TotalsMap", () => {
  function raport(over: Record<string, unknown> = {}) {
    return {
      configured: true,
      dimensionHeaders: [],
      metricHeaders: ["sessions", "activeUsers"],
      rows: [],
      totals: ["12", "7"],
      ...over,
    } as Parameters<Ga4ServerModule["ga4TotalsMap"]>[0];
  }

  it("raport z błędem daje PUSTĄ mapę - brak danych to nie zero", async () => {
    const { ga4TotalsMap } = await loadModule();

    expect(ga4TotalsMap(raport({ error: "GA4 403: brak dostępu" })).size).toBe(0);
  });

  it("mapuje totale po KOLEJNOŚCI nagłówków metryk", async () => {
    const { ga4TotalsMap } = await loadModule();

    expect([...ga4TotalsMap(raport())]).toEqual([
      ["sessions", 12],
      ["activeUsers", 7],
    ]);
  });

  it("pomija metryki bez skończonej liczby (brak totalu, tekst, Infinity)", async () => {
    const { ga4TotalsMap } = await loadModule();

    const mapa = ga4TotalsMap(
      raport({
        metricHeaders: ["sessions", "brakTotalu", "tekst", "nieskonczonosc"],
        totals: ["12", undefined, "n/d", "Infinity"],
      }),
    );

    expect([...mapa.keys()]).toEqual(["sessions"]);
  });

  it("nadmiarowe totale ponad liczbę nagłówków nie wchodzą do mapy", async () => {
    const { ga4TotalsMap } = await loadModule();

    const mapa = ga4TotalsMap(raport({ metricHeaders: ["sessions"], totals: ["12", "999"] }));

    expect([...mapa]).toEqual([["sessions", 12]]);
  });

  it("pusty raport (bez metryk) daje pustą mapę", async () => {
    const { ga4TotalsMap, EMPTY_GA4_REPORT } = await loadModule();

    expect(ga4TotalsMap(EMPTY_GA4_REPORT).size).toBe(0);
  });

  it("STAN FAKTYCZNY: pusty string w totalu wchodzi jako 0, a nie jest pomijany", async () => {
    // `Number("") === 0`. GA4 zwraca "0", więc realnie to nie boli, ale kontrakt
    // "odróżnij brak danych od zera" tego przypadku NIE pokrywa - przypinam stan.
    const { ga4TotalsMap } = await loadModule();

    expect(
      ga4TotalsMap(raport({ metricHeaders: ["sessions"], totals: [""] })).get("sessions"),
    ).toBe(0);
  });
});
