// BRAMKA UWIERZYTELNIENIA: ciała `requireSupabaseAuth` (`auth-middleware.ts`)
// i `attachSupabaseAuth` (`auth-attacher.ts`).
//
// PO CO TEN PLIK ISTNIEJE. `require-staff.ts` - bramka AUTORYZACJI, doprowadzona
// 04.09.2026 do 100% gałęzi - stoi NA `requireSupabaseAuth`: cały jej dowód
// zaczyna się od `context.supabase` i `context.userId`, które wstrzykuje ten
// moduł. A ten moduł miał 1/26 linii (3,84%), 0/22 GAŁĘZI (0,00%) i 0/1 funkcji.
// Pokryta była jedna linia: `export const requireSupabaseAuth = ...`, wykonywana
// przez sam import. Ciało `.server(async ...)` - czyli KAŻDA z ośmiu ścieżek
// odmowy i jedyna ścieżka przejścia - nie wykonało się ani raz.
// Znaczyło to dokładnie jedno: autoryzacja była przetestowana na
// NIEPRZETESTOWANYM uwierzytelnieniu.
//
// `attachSupabaseAuth` stał jeszcze niżej: 1/4 linii (25%), 0/1 funkcji, i to
// jedno pokrycie było przypadkowe - jedynym importerem jest `src/start.ts`,
// który wciągają dwa testy integracyjne z całkiem innego powodu.
//
// DLACZEGO OBA MODUŁY W JEDNYM PLIKU. To dwa końce JEDNEGO kontraktu, nie dwa
// sąsiedzkie moduły. Przeglądarka DOKŁADA nagłówek (`attachSupabaseAuth`),
// serwer go ZDEJMUJE (`requireSupabaseAuth`), a zgodność jest wyłącznie
// konwencją napisów: nazwa `Authorization` z wielkiej litery i schemat
// `Bearer ` z JEDNĄ spacją. Rozdzielone na dwa pliki, oba końce przechodziłyby
// na zielono także wtedy, gdy przestałyby się rozumieć - dlatego niżej stoi
// dowód domykający pętlę: nagłówek WYPRODUKOWANY przez klienta jest wkładany
// do żądania i przepuszczany przez bramkę serwera.
//
// CO JEST PRZEDMIOTEM DOWODU po stronie serwera - osiem ścieżek odmowy, każda
// z osobnym komunikatem, bo komunikat jest jedynym, po czym klient rozpoznaje
// przyczynę:
//   1. brak zmiennych środowiskowych -> komunikat WYMIENIA brakujące (trzy
//      różne treści: tylko URL, tylko klucz, oba),
//   2. brak `request.headers`         -> "Unauthorized: No request headers available"
//   3. brak nagłówka authorization    -> "Unauthorized: No authorization header provided"
//   4. schemat inny niż `Bearer `     -> "Unauthorized: Only Bearer tokens are supported"
//   5. `Bearer ` bez tokenu           -> "Unauthorized: No token provided"
//   6. `getClaims`: błąd lub brak claims -> "Unauthorized: Invalid token"
//   7. claims bez `sub`               -> "Unauthorized: No user ID found in token"
//   8. przejście -> `next({ context })` z `supabase`, `userId`, `claims`.
//
// I OSOBNO, RÓWNIE MERYTORYCZNIE: KSZTAŁT KLIENTA. Serwerowy klient MUSI
// powstawać z `auth: { persistSession: false, autoRefreshToken: false }`.
// To nie jest higiena konfiguracji, to granica tożsamości: bez
// `persistSession: false` klient supabase-js zaczyna trzymać sesję w pamięci
// izolatu, a izolat serwerowy obsługuje ŻĄDANIA WIELU UŻYTKOWNIKÓW po kolei -
// czyli następny wywołujący może zostać obsłużony jako poprzedni. Dlatego
// argumenty atrapy `createClient` są tu przypięte asercją, a nie zostawione
// jako szczegół implementacyjny. Tą samą asercją pilnujemy, że nagłówek klienta
// niesie TEN SAM token, co `getClaims` - rozjazd tych dwóch znaczyłby klienta
// działającego w imieniu innego podmiotu niż ten, którego claims odczytano.
//
// JAK ASERTUJEMY. Przez SKUTEK, nie przez rzut. Sam wyjątek jest zgodny również
// ze światem, w którym middleware najpierw przepuściło żądanie, a dopiero potem
// odmówiło - dlatego każda ścieżka odmowy patrzy dodatkowo na `nextCalls`
// (musi być PUSTE) i na to, czy klient bazy w ogóle powstał.
//
// REGUŁA TEGO PLIKU: NIE ATRAPUJEMY MODUŁÓW, KTÓRE POKRYWAMY. Podmienione są
// wyłącznie GRANICE: fabryka `createMiddleware` z frameworka (bez niej ciało
// middleware jest z testu niewywoływalne - to instrument pomiarowy),
// `getRequest` (w teście nie ma runtime'u serwera), `createClient` z SDK
// (szpieg - jego argumenty są przedmiotem dowodu) i przeglądarkowy `./client`
// (jego prawdziwa wersja to Proxy, które przy pierwszym dotknięciu czyta
// konfigurację publiczną i rzuca). PRAWDZIWE zostają: składanie komunikatów,
// kolejność bramek, wycinanie schematu z nagłówka i kształt wstrzykiwanego
// kontekstu. To one są przedmiotem dowodu.
//
// DANE. Żadnych prawdziwych sekretów, adresów ani identyfikatorów: klucz jest
// jawnie oznaczony jako nie-sekret, host jest w `example.com`, UUID jest
// syntetyczny, a "token" nie jest JWT i nigdzie nie wychodzi z procesu.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// --- atrapy granic ----------------------------------------------------------

// Jedyny instrument pomiarowy: bez podmiany fabryki ciało `.server()` / `.client()`
// nie jest nigdzie wystawione i nie da się go zawołać z testu jednostkowego.
vi.mock("@tanstack/react-start", async () =>
  (await import("@/test/middlewareHarness")).middlewareCaptureMock(),
);

// Żądanie HTTP. `current` jest polem mutowalnym, bo fabryka `vi.hoisted` jest
// wynoszona nad importy i nie wolno w niej sięgać po zaimportowane referencje.
const req = vi.hoisted(() => ({ current: null as unknown }));
vi.mock("@tanstack/react-start/server", () => ({ getRequest: () => req.current }));

/**
 * SDK Supabase. `client` ma STAŁĄ tożsamość, bo dowód "to TEN klient wszedł do
 * kontekstu" jest asercją o referencji, nie o kształcie: klient zbudowany bez
 * nagłówka autoryzacji wygląda identycznie, a działa jako anonim.
 */
const sdk = vi.hoisted(() => {
  const getClaims = vi.fn();
  return { createClient: vi.fn(), getClaims, client: { auth: { getClaims } } };
});
vi.mock("@supabase/supabase-js", () => ({ createClient: sdk.createClient }));

// Przeglądarkowy klient - granica dla `attachSupabaseAuth`. Prawdziwy `./client`
// jest Proxy, które przy pierwszym dotknięciu czyta konfigurację publiczną.
const browser = vi.hoisted(() => ({ getSession: vi.fn() }));
vi.mock("../client", () => ({ supabase: { auth: { getSession: browser.getSession } } }));

import {
  attemptMiddleware,
  capturedClient,
  capturedServer,
  declaredMiddleware,
  middlewarePassThrough,
  runMiddleware,
  type MiddlewareOutcome,
} from "@/test/middlewareHarness";
import { attachSupabaseAuth } from "../auth-attacher";
import { requireSupabaseAuth } from "../auth-middleware";

// --- dane syntetyczne -------------------------------------------------------

const SUPABASE_URL = "https://supabase.example.com";
/** Klucz publikowalny w bundlu przeglądarki - jawnie nie-sekret, tu atrapa. */
const SUPABASE_KEY = "publishable-key-placeholder-not-a-secret";
const TOKEN = "token-syntetyczny-nie-jest-jwt";
const USER = "00000000-0000-4000-8000-000000000001";

const ENV_PREFIX = "Missing Supabase environment variable(s): ";
const ENV_SUFFIX = ". Connect Supabase in the neweuropeanstrategies.com environment.";

// --- pomocnicze zawężenia (bez `any`) ---------------------------------------

/** Argumenty jednego wywołania `createClient`, jako lista `unknown`. */
function clientCalls(): readonly unknown[][] {
  return sdk.createClient.mock.calls as readonly unknown[][];
}

/** Trzeci argument `createClient` - obiekt opcji. Brak = błąd testu. */
function clientOptions(index = 0): Record<string, unknown> {
  const args = clientCalls()[index];
  if (!args) throw new Error("test: `createClient` nie zostało zawołane");
  const options = args[2];
  if (typeof options !== "object" || options === null) {
    throw new Error("test: trzeci argument `createClient` nie jest obiektem opcji");
  }
  return options as Record<string, unknown>;
}

/** Zagnieżdżona sekcja opcji (`auth`, `global`, `headers`). */
function section(source: Record<string, unknown>, key: string): Record<string, unknown> {
  const value = source[key];
  if (typeof value !== "object" || value === null) {
    throw new Error("test: brak sekcji opcji `" + key + "`");
  }
  return value as Record<string, unknown>;
}

/** Nagłówki, jakie `next()` dostało od ciała `.client()`. */
function nextHeaders(arg: unknown): Record<string, string> {
  if (typeof arg !== "object" || arg === null || !("headers" in arg)) {
    throw new Error("test: `next()` nie dostało pola `headers`");
  }
  const headers = arg.headers;
  if (typeof headers !== "object" || headers === null) {
    throw new Error("test: `headers` przekazane do `next()` nie jest obiektem");
  }
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (typeof value !== "string") {
      throw new Error("test: nagłówek `" + key + "` nie jest napisem");
    }
    out[key] = value;
  }
  return out;
}

/**
 * Uruchamia ciało `.client()`. Harness celowo nie ma runnera dla strony
 * przeglądarki (transport nagłówków nie ma kontekstu serwera ani zapisu
 * wstrzykniętego kontekstu), więc atrapa `next()` jest tutaj - ale ciało wciąż
 * czytamy przez `capturedClient`, czyli przez API harnessu.
 */
async function runClient(value: unknown): Promise<{ calls: unknown[]; result: unknown }> {
  const calls: unknown[] = [];
  const next = (arg?: unknown): unknown => {
    calls.push(arg);
    return middlewarePassThrough;
  };
  const result = await capturedClient(value)({ next });
  return { calls, result };
}

/** Żądanie z podanymi nagłówkami - prawdziwe `Headers`, więc szukanie po nazwie
 *  jest tak samo nieczułe na wielkość liter jak w runtime. */
function requestWith(headers?: Record<string, string>): void {
  req.current = { headers: new Headers(headers) };
}

/**
 * Odmowa jest WYJĄTKIEM, ale zapis `next()` musi ją przeżyć - inaczej nie da
 * się udowodnić zdania "odmowa nastąpiła PRZED handlerem", bo rzut zabiera
 * jedyny ślad tego, czy `next()` zdążyło się wykonać.
 */
async function attemptDenial(): Promise<MiddlewareOutcome> {
  const outcome = await attemptMiddleware(requireSupabaseAuth, {});
  if (!outcome.error) {
    throw new Error("test: middleware PRZEPUŚCIŁO żądanie, choć miało odmówić");
  }
  return outcome;
}

/** Sam komunikat odmowy - najczęstsza asercja tego pliku. */
async function denial(): Promise<Error> {
  const { error } = await attemptDenial();
  return error instanceof Error ? error : new Error(String(error));
}

beforeEach(() => {
  vi.stubEnv("SUPABASE_URL", SUPABASE_URL);
  vi.stubEnv("SUPABASE_PUBLISHABLE_KEY", SUPABASE_KEY);
  req.current = null;
  sdk.createClient.mockReset();
  sdk.createClient.mockReturnValue(sdk.client);
  sdk.getClaims.mockReset();
  sdk.getClaims.mockResolvedValue({ data: { claims: { sub: USER } }, error: null });
  browser.getSession.mockReset();
  browser.getSession.mockResolvedValue({ data: { session: null } });
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("premisa: jest co mierzyć", () => {
  it("`requireSupabaseAuth` rejestruje ciało `.server()`", () => {
    // Gdyby fabryka przestała rejestrować ciało, wszystkie dowody niżej
    // zamieniłyby się w dowody o atrapie.
    expect(typeof capturedServer(requireSupabaseAuth)).toBe("function");
  });

  it("`requireSupabaseAuth` NIE deklaruje niczego w łańcuchu w górę - jest dnem", () => {
    // Bramka uwierzytelnienia nie może stać na innym middleware, bo wtedy
    // istniałaby warstwa wykonywana PRZED sprawdzeniem tożsamości.
    expect(declaredMiddleware(requireSupabaseAuth)).toEqual([]);
  });

  it("`attachSupabaseAuth` rejestruje ciało `.client()`, a NIE `.server()`", () => {
    // Transport tokenu musi żyć w przeglądarce: tam jest sesja. Ciało
    // serwerowe w tym module znaczyłoby, że token dokłada się po fakcie.
    expect(typeof capturedClient(attachSupabaseAuth)).toBe("function");
    expect(() => capturedServer(attachSupabaseAuth)).toThrow();
  });
});

describe("odmowa 1/8: brak konfiguracji Supabase", () => {
  it("brak SUPABASE_URL wymienia w komunikacie DOKŁADNIE tę zmienną", async () => {
    // Komunikat jest jedyną wskazówką dla operatora - "coś z Supabase" kosztuje
    // godziny, "SUPABASE_URL" kosztuje minutę.
    vi.stubEnv("SUPABASE_URL", undefined);
    const err = await denial();
    expect(err.message).toBe(ENV_PREFIX + "SUPABASE_URL" + ENV_SUFFIX);
  });

  it("brak SUPABASE_PUBLISHABLE_KEY wymienia w komunikacie DOKŁADNIE tę zmienną", async () => {
    vi.stubEnv("SUPABASE_PUBLISHABLE_KEY", undefined);
    const err = await denial();
    expect(err.message).toBe(ENV_PREFIX + "SUPABASE_PUBLISHABLE_KEY" + ENV_SUFFIX);
  });

  it("brak OBU wymienia OBIE, po przecinku i w kolejności deklaracji", async () => {
    // Trzeci, osobny komunikat. Gdyby lista składała się przez `find` zamiast
    // `filter`, ten wariant zgłaszałby tylko pierwszą brakującą zmienną.
    vi.stubEnv("SUPABASE_URL", undefined);
    vi.stubEnv("SUPABASE_PUBLISHABLE_KEY", undefined);
    const err = await denial();
    expect(err.message).toBe(ENV_PREFIX + "SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY" + ENV_SUFFIX);
  });

  it("PUSTY napis liczy się jak brak - `SUPABASE_URL=` to nie konfiguracja", async () => {
    // Realny scenariusz: sekret wpisany w panelu i wyczyszczony. Pusty URL
    // przepuszczony dalej dawałby klienta celującego w `/auth/v1/...` na
    // własnym originie, czyli 404 zamiast diagnozy.
    vi.stubEnv("SUPABASE_URL", "");
    const err = await denial();
    expect(err.message).toBe(ENV_PREFIX + "SUPABASE_URL" + ENV_SUFFIX);
  });

  it("ta sama treść idzie do Server Logs z prefiksem `[Supabase]`", async () => {
    // Rzut widzi klient, log widzi operator - i muszą mówić to samo, inaczej
    // diagnoza z logu nie pasuje do zgłoszenia użytkownika.
    vi.stubEnv("SUPABASE_PUBLISHABLE_KEY", undefined);
    const err = await denial();
    expect(console.error).toHaveBeenCalledWith("[Supabase] " + err.message);
  });

  it("brak konfiguracji NIE dotyka żądania ani bazy i NIE przepuszcza dalej", async () => {
    // Kolejność jest treścią: sprawdzenie konfiguracji stoi PRZED odczytem
    // żądania, więc awaria wdrożenia nie może się przebrać za problem z tokenem.
    vi.stubEnv("SUPABASE_URL", undefined);
    requestWith({ Authorization: "Bearer " + TOKEN });
    const { nextCalls } = await attemptDenial();
    expect(sdk.createClient).not.toHaveBeenCalled();
    expect(sdk.getClaims).not.toHaveBeenCalled();
    expect(nextCalls).toEqual([]);
  });
});

describe("odmowa 2/8: brak nagłówków w żądaniu", () => {
  it("gdy `getRequest()` nie zwraca żądania - komunikat o BRAKU NAGŁÓWKÓW", async () => {
    // Ścieżka runtime'owa, nie użytkownicza: middleware wywołane poza
    // kontekstem żądania. Musi odmówić, a nie rzucić `TypeError` na `.headers`.
    req.current = null;
    const err = await denial();
    expect(err.message).toBe("Unauthorized: No request headers available");
  });

  it("żądanie BEZ pola `headers` daje ten sam komunikat, nie awarię", async () => {
    req.current = {};
    const err = await denial();
    expect(err.message).toBe("Unauthorized: No request headers available");
  });

  it("nie powstaje żaden klient bazy i `next()` nie jest wołane", async () => {
    req.current = null;
    const { nextCalls } = await attemptDenial();
    expect(sdk.createClient).not.toHaveBeenCalled();
    expect(nextCalls).toEqual([]);
  });
});

describe("odmowa 3/8: brak nagłówka authorization", () => {
  it("żądanie bez nagłówka jest odrzucane komunikatem o BRAKU nagłówka", async () => {
    requestWith();
    const err = await denial();
    expect(err.message).toBe("Unauthorized: No authorization header provided");
  });

  it("PUSTY nagłówek to nadal 'brak', a nie 'zły schemat'", async () => {
    // Rozróżnienie ma znaczenie diagnostyczne: "brak" wskazuje na klienta,
    // który nie dołożył nagłówka (patrz `attachSupabaseAuth`), "zły schemat"
    // na klienta, który dołożył go w złym formacie.
    requestWith({ Authorization: "" });
    const err = await denial();
    expect(err.message).toBe("Unauthorized: No authorization header provided");
  });

  it("odmowa jest przed budową klienta - anonimowe żądanie nie płaci za połączenie", async () => {
    requestWith();
    const { nextCalls } = await attemptDenial();
    expect(sdk.createClient).not.toHaveBeenCalled();
    expect(sdk.getClaims).not.toHaveBeenCalled();
    expect(nextCalls).toEqual([]);
  });
});

describe("odmowa 4/8: schemat inny niż Bearer", () => {
  it("`Basic ...` jest odrzucany - hasło w nagłówku nie jest tożsamością", async () => {
    // Przyjęcie `Basic` znaczyłoby drugi, nieaudytowany kanał uwierzytelnienia
    // obok JWT - z własnym cyklem życia i bez `aal`, na którym stoi MFA.
    requestWith({ Authorization: "Basic dXNlcjpwYXNz" });
    const err = await denial();
    expect(err.message).toBe("Unauthorized: Only Bearer tokens are supported");
  });

  it("`bearer` z małej litery jest odrzucany - porównanie jest czułe na wielkość", async () => {
    // To jest przypięcie zachowania, nie życzenie: RFC 6750 dopuszcza dowolną
    // wielkość liter w schemacie, a ta bramka NIE. Ktokolwiek dołoży drugiego
    // klienta (mobile, integracja), musi wysłać dokładnie `Bearer `.
    requestWith({ Authorization: "bearer " + TOKEN });
    const err = await denial();
    expect(err.message).toBe("Unauthorized: Only Bearer tokens are supported");
  });

  it("sam token bez schematu jest odrzucany", async () => {
    requestWith({ Authorization: TOKEN });
    const err = await denial();
    expect(err.message).toBe("Unauthorized: Only Bearer tokens are supported");
  });

  it("`Bearer` bez spacji jest odrzucany jako zły schemat, nie jako pusty token", async () => {
    // Granica między ścieżką 4 i 5 przechodzi DOKŁADNIE przez spację.
    requestWith({ Authorization: "Bearer" });
    const err = await denial();
    expect(err.message).toBe("Unauthorized: Only Bearer tokens are supported");
  });

  it("zły schemat nie buduje klienta i nie woła bazy", async () => {
    requestWith({ Authorization: "Basic dXNlcjpwYXNz" });
    const { nextCalls } = await attemptDenial();
    expect(sdk.createClient).not.toHaveBeenCalled();
    expect(sdk.getClaims).not.toHaveBeenCalled();
    expect(nextCalls).toEqual([]);
  });
});

describe("odmowa 5/8: `Bearer ` bez tokenu", () => {
  it("`Bearer ` z pustym tokenem daje osobny komunikat o BRAKU TOKENU", async () => {
    // Realny kształt żądania z klienta, który stracił sesję w połowie: nagłówek
    // jest, schemat jest, tokenu nie ma. Odmowa musi to nazwać wprost.
    requestWith({ Authorization: "Bearer " });
    const err = await denial();
    expect(err.message).toBe("Unauthorized: No token provided");
  });

  it("pusty token nie idzie do bazy - `getClaims` nie jest wołane", async () => {
    requestWith({ Authorization: "Bearer " });
    const { nextCalls } = await attemptDenial();
    expect(sdk.createClient).not.toHaveBeenCalled();
    expect(sdk.getClaims).not.toHaveBeenCalled();
    expect(nextCalls).toEqual([]);
  });

  it("token z samych spacji NIE jest 'brakiem tokenu' - idzie do weryfikacji", async () => {
    // Przypięcie zachowania: wycinanie schematu to `replace("Bearer ", "")`,
    // bez `trim()`, więc `"Bearer   "` daje token `"  "` - napis prawdziwy,
    // który przechodzi bramkę 5 i wpada na bramkę 6. Zachowanie zostaje
    // FAIL-CLOSED (odmowa), zmienia się tylko komunikat i cena jednego
    // zapytania. Gdyby ktoś dołożył `trim()`, ten test pokaże, że komunikat
    // przeskoczył z "Invalid token" na "No token provided".
    requestWith({ Authorization: "Bearer   " });
    sdk.getClaims.mockResolvedValue({ data: null, error: { message: "invalid JWT" } });
    const err = await denial();
    expect(err.message).toBe("Unauthorized: Invalid token");
    expect(sdk.getClaims).toHaveBeenCalledWith("  ");
  });
});

describe("kształt serwerowego klienta - granica tożsamości między żądaniami", () => {
  beforeEach(() => {
    requestWith({ Authorization: "Bearer " + TOKEN });
  });

  it("klient powstaje z URL i klucza z ŚRODOWISKA, a nie ze stałych w kodzie", async () => {
    await runMiddleware(requireSupabaseAuth, {});
    expect(clientCalls()).toHaveLength(1);
    expect(clientCalls()[0][0]).toBe(SUPABASE_URL);
    expect(clientCalls()[0][1]).toBe(SUPABASE_KEY);
  });

  it("klient niesie nagłówek `Authorization: Bearer <token>` z żądania", async () => {
    // Bez tego nagłówka klient jest ANONIMEM: każde zapytanie RLS przechodzi
    // jako `anon`, więc `requireStaff` czytałby `profiles` cudzymi oczami
    // i najczęściej dostawał puste wyniki - czyli odmowę dla uprawnionego.
    await runMiddleware(requireSupabaseAuth, {});
    const headers = section(section(clientOptions(), "global"), "headers");
    expect(headers.Authorization).toBe("Bearer " + TOKEN);
  });

  it("`persistSession: false` - klient NIE trzyma sesji między żądaniami", async () => {
    // Sedno tej sekcji. Izolat serwerowy obsługuje żądania wielu użytkowników
    // po kolei. Klient z `persistSession: true` zapisuje sesję w pamięci
    // procesu, więc kolejne żądanie może zostać obsłużone jako poprzedni
    // użytkownik - to wyciek tożsamości, nie usterka wydajnościowa.
    await runMiddleware(requireSupabaseAuth, {});
    expect(section(clientOptions(), "auth").persistSession).toBe(false);
  });

  it("`autoRefreshToken: false` - serwer nie odnawia cudzej sesji w tle", async () => {
    // Timer odświeżania w izolacie serwerowym przedłużałby życie tokenu, który
    // wygasł u właściciela, i robiłby to poza jakimkolwiek żądaniem.
    await runMiddleware(requireSupabaseAuth, {});
    expect(section(clientOptions(), "auth").autoRefreshToken).toBe(false);
  });

  it("`storage` jest ZADEKLAROWANE jako `undefined` - brak magazynu jest jawny", async () => {
    // Klucz musi ISTNIEĆ w opcjach (asercja na `in`, nie na wartości): jego
    // obecność jest deklaracją intencji "ten klient nie ma gdzie zapisywać",
    // czytelną przy każdej regeneracji pliku. Samo `undefined` nie wystarcza
    // jako gwarancja - tę niesie `persistSession: false` wyżej.
    await runMiddleware(requireSupabaseAuth, {});
    const auth = section(clientOptions(), "auth");
    expect("storage" in auth).toBe(true);
    expect(auth.storage).toBeUndefined();
  });

  it("cały trzeci argument ma dokładnie ten kształt - bez cichych dodatków", async () => {
    await runMiddleware(requireSupabaseAuth, {});
    expect(sdk.createClient).toHaveBeenCalledWith(SUPABASE_URL, SUPABASE_KEY, {
      global: { headers: { Authorization: "Bearer " + TOKEN } },
      auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
    });
  });

  it("`getClaims` dostaje TEN SAM token, co nagłówek klienta", async () => {
    // Rozjazd tych dwóch znaczyłby klienta działającego w imieniu innego
    // podmiotu niż ten, którego claims odczytano - czyli autoryzację liczoną
    // dla użytkownika A na danych użytkownika B.
    await runMiddleware(requireSupabaseAuth, {});
    const headers = section(section(clientOptions(), "global"), "headers");
    expect(sdk.getClaims).toHaveBeenCalledTimes(1);
    expect(sdk.getClaims).toHaveBeenCalledWith(TOKEN);
    expect(headers.Authorization).toBe("Bearer " + String(sdk.getClaims.mock.calls[0][0]));
  });

  it("na jedno żądanie powstaje DOKŁADNIE jeden klient", async () => {
    await runMiddleware(requireSupabaseAuth, {});
    expect(sdk.createClient).toHaveBeenCalledTimes(1);
  });
});

describe("odmowa 6/8: `getClaims` nie potwierdza tokenu", () => {
  beforeEach(() => {
    requestWith({ Authorization: "Bearer " + TOKEN });
  });

  it("błąd weryfikacji daje `Invalid token` - bez wycieku przyczyny do klienta", async () => {
    // Komunikat bazy ("invalid signature", "token is expired") mówi atakującemu,
    // CZY podrobił podpis, czy tylko spóźnił się z czasem. Bramka celowo
    // spłaszcza to do jednej treści.
    sdk.getClaims.mockResolvedValue({ data: null, error: { message: "invalid signature" } });
    const err = await denial();
    expect(err.message).toBe("Unauthorized: Invalid token");
    expect(err.message).not.toContain("signature");
  });

  it("BŁĄD wygrywa nad claimami, które wyglądają poprawnie", async () => {
    // To jest najgroźniejszy wariant tej ścieżki. Gdyby warunek brzmiał
    // `!data?.claims` bez `error ||`, odpowiedź niosąca JEDNOCZEŚNIE błąd
    // weryfikacji i zdekodowaną (niezweryfikowaną!) treść tokenu zostałaby
    // przyjęta - czyli podrobiony token z poprawnym `sub` przechodziłby bramkę.
    sdk.getClaims.mockResolvedValue({
      data: { claims: { sub: USER } },
      error: { message: "invalid signature" },
    });
    const err = await denial();
    expect(err.message).toBe("Unauthorized: Invalid token");
  });

  it("brak `data` (null) bez błędu też odmawia", async () => {
    sdk.getClaims.mockResolvedValue({ data: null, error: null });
    const err = await denial();
    expect(err.message).toBe("Unauthorized: Invalid token");
  });

  it("`data` bez pola `claims` też odmawia", async () => {
    sdk.getClaims.mockResolvedValue({ data: {}, error: null });
    const err = await denial();
    expect(err.message).toBe("Unauthorized: Invalid token");
  });

  it("`claims: null` też odmawia", async () => {
    sdk.getClaims.mockResolvedValue({ data: { claims: null }, error: null });
    const err = await denial();
    expect(err.message).toBe("Unauthorized: Invalid token");
  });

  it("odmowa NIE przepuszcza dalej, choć klient bazy JUŻ powstał", async () => {
    // Klient jest budowany PRZED weryfikacją (potrzebuje go samo `getClaims`),
    // więc "klient istnieje" nie może być tu dowodem przejścia - dowodem jest
    // `nextCalls`. To jest różnica między "zwróciło 401" i "zwróciło 401
    // i nic nie zrobiło".
    sdk.getClaims.mockResolvedValue({ data: null, error: { message: "invalid signature" } });
    const { nextCalls } = await attemptDenial();
    expect(sdk.createClient).toHaveBeenCalledTimes(1);
    expect(nextCalls).toEqual([]);
  });

  it("WYJĄTEK z `getClaims` (np. padnięta sieć) też nie przepuszcza", async () => {
    // Przypięcie zachowania: rzut z SDK NIE jest łapany, więc leci dalej
    // z własną treścią, a nie jako "Unauthorized: ...". Zachowanie jest
    // FAIL-CLOSED i to jest tu przedmiotem dowodu - niedostępny Supabase
    // odcina panel, a nie otwiera go.
    sdk.getClaims.mockRejectedValue(new Error("fetch failed"));
    const { error, nextCalls } = await attemptDenial();
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe("fetch failed");
    expect(nextCalls).toEqual([]);
  });
});

describe("odmowa 7/8: claims bez `sub`", () => {
  beforeEach(() => {
    requestWith({ Authorization: "Bearer " + TOKEN });
  });

  it("token zweryfikowany, ale bez `sub`, dostaje osobny komunikat", async () => {
    // To NIE jest ten sam przypadek co "Invalid token": podpis się zgadza,
    // brakuje tożsamości. Rozróżnienie jest istotne, bo taki token bywa
    // poprawnym tokenem SERWISOWYM (bez podmiotu), a nie próbą podszycia.
    sdk.getClaims.mockResolvedValue({ data: { claims: { aal: "aal2" } }, error: null });
    const err = await denial();
    expect(err.message).toBe("Unauthorized: No user ID found in token");
  });

  it('PUSTY `sub` liczy się jak brak - `userId: ""` nie może wejść do kontekstu', async () => {
    // `requireStaff` filtruje `user_roles` po `user_id`. Puste `userId`
    // w kontekście dałoby zapytanie `eq("user_id", "")` - i jego wynik zależy
    // wyłącznie od tego, czy w bazie zdarzy się taki wiersz.
    sdk.getClaims.mockResolvedValue({ data: { claims: { sub: "" } }, error: null });
    const err = await denial();
    expect(err.message).toBe("Unauthorized: No user ID found in token");
  });

  it("odmowa NIE przepuszcza dalej", async () => {
    sdk.getClaims.mockResolvedValue({ data: { claims: {} }, error: null });
    const { nextCalls } = await attemptDenial();
    expect(nextCalls).toEqual([]);
  });
});

describe("ścieżka 8/8: przejście wstrzykuje kontekst dla warstwy autoryzacji", () => {
  beforeEach(() => {
    requestWith({ Authorization: "Bearer " + TOKEN });
  });

  it("`next()` jest wołane DOKŁADNIE raz", async () => {
    const { nextCalls } = await runMiddleware(requireSupabaseAuth, {});
    expect(nextCalls).toHaveLength(1);
  });

  it("do kontekstu wchodzi TEN klient, który powstał z tokenem żądania", async () => {
    // Asercja na REFERENCJI, nie na kształcie: klient anonimowy wygląda
    // identycznie. `requireStaff` czyta `profiles` i `user_roles` dokładnie
    // tym obiektem, więc jego tożsamość jest tożsamością całej autoryzacji.
    const { injectedContext } = await runMiddleware(requireSupabaseAuth, {});
    expect(injectedContext.supabase).toBe(sdk.client);
  });

  it("`userId` to `claims.sub` - a nie nic innego z tokenu", async () => {
    sdk.getClaims.mockResolvedValue({
      data: { claims: { sub: USER, email: "kto@example.com", role: "authenticated" } },
      error: null,
    });
    const { injectedContext } = await runMiddleware(requireSupabaseAuth, {});
    expect(injectedContext.userId).toBe(USER);
  });

  it("`claims` wchodzą CAŁE - inaczej `requireStaff` nie zobaczy `aal`", async () => {
    // Wymuszanie MFA w `require-staff.ts` czyta `context.claims.aal`.
    // Przycięcie claimów do samego `sub` wyłączyłoby step-up dla całego panelu,
    // i to bez żadnego sygnału - `aal` byłoby po prostu `undefined`.
    const claims = { sub: USER, aal: "aal2", session_id: "sesja-syntetyczna" };
    sdk.getClaims.mockResolvedValue({ data: { claims }, error: null });
    const { injectedContext } = await runMiddleware(requireSupabaseAuth, {});
    expect(injectedContext.claims).toBe(claims);
  });

  it("kontekst niesie DOKŁADNIE trzy pola i nic więcej", async () => {
    const claims = { sub: USER, aal: "aal1" };
    sdk.getClaims.mockResolvedValue({ data: { claims }, error: null });
    const { nextCalls } = await runMiddleware(requireSupabaseAuth, {});
    expect(nextCalls[0].arg).toStrictEqual({
      context: { supabase: sdk.client, userId: USER, claims },
    });
  });

  it("wynik middleware to wynik `next()` - nic nie jest po drodze podmieniane", async () => {
    // Gdyby bramka zwracała cokolwiek własnego, odpowiedź handlera nigdy nie
    // dotarłaby do klienta.
    const { result } = await runMiddleware(requireSupabaseAuth, {});
    expect(result).toBe(middlewarePassThrough);
  });

  it("nagłówek `authorization` jest znajdowany niezależnie od wielkości liter", async () => {
    // Klient wysyła `Authorization`, bramka czyta `"authorization"`. Zgodność
    // niesie `Headers` (HTTP jest nieczułe na wielkość) - i to jest przypięte,
    // bo podmiana `Headers` na zwykły obiekt w jakiejkolwiek warstwie
    // pośredniej rozwaliłaby uwierzytelnienie po cichu.
    req.current = { headers: new Headers({ AUTHORIZATION: "Bearer " + TOKEN }) };
    const { nextCalls } = await runMiddleware(requireSupabaseAuth, {});
    expect(nextCalls).toHaveLength(1);
    expect(sdk.getClaims).toHaveBeenCalledWith(TOKEN);
  });

  it("token z kropkami i myślnikami przechodzi nietknięty", async () => {
    // Wycinanie schematu przez `replace` nie może zjeść niczego z tokenu -
    // JWT ma trzy segmenty rozdzielone kropkami i alfabet base64url.
    const jwtLike = "aaa-bbb.ccc_ddd.eee-fff";
    requestWith({ Authorization: "Bearer " + jwtLike });
    await runMiddleware(requireSupabaseAuth, {});
    expect(sdk.getClaims).toHaveBeenCalledWith(jwtLike);
    const headers = section(section(clientOptions(), "global"), "headers");
    expect(headers.Authorization).toBe("Bearer " + jwtLike);
  });
});

describe("attachSupabaseAuth: transport tokenu z przeglądarki", () => {
  it("sesja obecna -> `next()` dostaje nagłówek `Authorization: Bearer <token>`", async () => {
    // Bez tego ogniwa (zarejestrowanego jako globalny `functionMiddleware`
    // w `src/start.ts`) KAŻDE wywołanie serverFn leci bez tokenu i odbija się
    // od `requireSupabaseAuth` - czyli cały panel przestaje działać.
    browser.getSession.mockResolvedValue({ data: { session: { access_token: TOKEN } } });
    const { calls } = await runClient(attachSupabaseAuth);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toStrictEqual({ headers: { Authorization: "Bearer " + TOKEN } });
  });

  it("brak sesji -> `next()` dostaje PUSTY obiekt nagłówków, a nie brak pola", async () => {
    // To nie jest kosmetyka. `headers: undefined` w niektórych wersjach
    // transportu nadpisuje nagłówki wyliczone wyżej w łańcuchu, więc RPC
    // wychodzi bez tokenu i bez żadnego śladu - cichy defekt. Pusty obiekt
    // znaczy "nic nie dokładam" i niczego nie zabiera.
    browser.getSession.mockResolvedValue({ data: { session: null } });
    const { calls } = await runClient(attachSupabaseAuth);
    expect(calls[0]).toStrictEqual({ headers: {} });
  });

  it("brak pola `session` w odpowiedzi też daje pusty obiekt, nie awarię", async () => {
    browser.getSession.mockResolvedValue({ data: {} });
    const { calls } = await runClient(attachSupabaseAuth);
    expect(calls[0]).toStrictEqual({ headers: {} });
  });

  it("sesja z PUSTYM `access_token` nie produkuje nagłówka `Bearer `", async () => {
    // `Authorization: "Bearer "` przeszłoby bramkę schematu na serwerze
    // i zatrzymało się dopiero na "No token provided" - czyli zamieniałoby
    // "jestem anonimem" na "mam zepsuty token". Anonimowe odczyty przestałyby
    // działać.
    browser.getSession.mockResolvedValue({ data: { session: { access_token: "" } } });
    const { calls } = await runClient(attachSupabaseAuth);
    expect(calls[0]).toStrictEqual({ headers: {} });
  });

  it("`next()` jest wołane raz, a jego wynik jest zwracany bez zmian", async () => {
    browser.getSession.mockResolvedValue({ data: { session: { access_token: TOKEN } } });
    const { calls, result } = await runClient(attachSupabaseAuth);
    expect(calls).toHaveLength(1);
    expect(result).toBe(middlewarePassThrough);
  });

  it("sesja jest czytana raz na wywołanie - token nie jest cache'owany w module", async () => {
    // Token wygasa. Zapamiętany w module przetrwałby odświeżenie sesji
    // i zacząłby dawać 401 do końca życia karty.
    browser.getSession.mockResolvedValue({ data: { session: { access_token: TOKEN } } });
    await runClient(attachSupabaseAuth);
    await runClient(attachSupabaseAuth);
    expect(browser.getSession).toHaveBeenCalledTimes(2);
  });
});

describe("pętla domknięta: nagłówek klienta przechodzi bramkę serwera", () => {
  it("to, co dokłada `attachSupabaseAuth`, jest przyjmowane przez `requireSupabaseAuth`", async () => {
    // JEDYNY dowód na zgodność obu połówek. Zgodność jest konwencją napisów:
    // nazwa `Authorization` z wielkiej litery i schemat `Bearer ` z JEDNĄ
    // spacją. Osobno testowane, oba końce byłyby zielone także wtedy, gdy
    // przestałyby się rozumieć - a skutkiem byłby panel odrzucający KAŻDE
    // żądanie zalogowanego użytkownika.
    browser.getSession.mockResolvedValue({ data: { session: { access_token: TOKEN } } });
    const { calls } = await runClient(attachSupabaseAuth);

    requestWith(nextHeaders(calls[0]));
    const { nextCalls, injectedContext } = await runMiddleware(requireSupabaseAuth, {});

    expect(nextCalls).toHaveLength(1);
    expect(injectedContext.userId).toBe(USER);
    expect(sdk.getClaims).toHaveBeenCalledWith(TOKEN);
  });

  it("brak sesji w przeglądarce kończy się na serwerze BRAKIEM nagłówka, nie złym schematem", async () => {
    // Domknięcie drugiej strony pętli: anonimowy klient nie wysyła nagłówka,
    // więc serwer odmawia komunikatem "No authorization header provided" -
    // i po tym komunikacie operator wie, że to brak sesji, a nie zły token.
    browser.getSession.mockResolvedValue({ data: { session: null } });
    const { calls } = await runClient(attachSupabaseAuth);

    requestWith(nextHeaders(calls[0]));
    const err = await denial();

    expect(err.message).toBe("Unauthorized: No authorization header provided");
  });
});
