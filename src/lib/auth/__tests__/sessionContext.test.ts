// KONTEKST SESJI: „użytkownik albo nic” na serwerze i po stronie klienta.
//
// Dwa moduły, jedna odpowiedzialność - odpowiedzieć na pytanie „kto to jest”,
// nie wywracając przy tym żądania:
//   * `src/lib/auth/optionalUser.server.ts` - serwerowy, dla funkcji otwartych
//     dla anonimów (darowizna bez logowania),
//   * `src/lib/auth/currentUser.ts` - kliencki, dla kodu poza Reactem
//     (buildery, mutacje, listy „moje”).
//
// CO TEN PLIK DOWODZI - co konkretnie się psuje, gdy to przestanie działać:
//
//  1. TRASA PUBLICZNA NIE MOŻE WYWRÓCIĆ SIĘ NA BRAKU SESJI.
//     `optionalUserIdFromRequest` jest wołane z `createDonationSession`
//     (`src/lib/billing/donations.functions.ts:170`). Każdy wyjątek z tego
//     helpera to błąd 500 na formularzu wpłaty dla osoby NIEZALOGOWANEJ,
//     czyli utracona darowizna. Dowodzimy, że brak nagłówka, obcy schemat
//     autoryzacji, pusty token, token wygasły, token USZKODZONY, brak
//     konfiguracji Supabase i brak kontekstu HTTP dają ten sam bezpieczny
//     wynik `null` - i że ŻADEN z nich nie rzuca.
//
//  2. TOŻSAMOŚĆ POCHODZI Z WERYFIKACJI, NIE Z TREŚCI TOKENU. Ciało JWT jest
//     czytelne dla każdego i każdy może je sobie ułożyć. Gdyby helper
//     odkodowywał `sub` sam, dowolna osoba wpisałaby cudzy identyfikator
//     i wpłata (a z nią status wspierającego nadawany triggerem) wylądowałaby
//     na cudzym koncie. Dowodzimy, że wynik bierze się WYŁĄCZNIE z odpowiedzi
//     `getClaims` (weryfikacja podpisu po stronie Supabase), a podrobiony
//     `sub` z ciała tokenu nie wycieka do wyniku.
//
//  3. KLIENT ANONIMOWY NIE PRZECHOWUJE SESJI. Serwerowy klient z włączonym
//     `persistSession` trzymałby sesję jednego użytkownika w pamięci procesu
//     i podawał ją NASTĘPNYM żądaniom - czyli mieszałby tożsamości między
//     osobami. Dowodzimy opcji, z jakimi jest tworzony, i tego, że powstaje
//     dokładnie raz.
//
//  4. BŁĄD ODCZYTU SESJI kontra BRAK SESJI po stronie klienta. `currentUser.ts`
//     zwraca `null` w obu przypadkach - to jest zgłoszony defekt (`it.fails`
//     na końcu pliku), bo awaria odświeżania tokenu wygląda dla wywołujących
//     dokładnie jak wylogowanie i zamienia „coś się zepsuło” w „nie masz
//     członkostwa”.
//
//  5. ODCZYT TOŻSAMOŚCI NIE UDERZA W AUTH API. Atrapa klienta wystawia
//     WYŁĄCZNIE `auth.getSession`. Gdyby moduł wrócił do `auth.getUser()`
//     (round-trip POST /auth/v1/user przy każdym otwarciu buildera, listy
//     materiałów i portalu członkowskiego - powód powstania tego modułu),
//     testy padłyby natychmiast na brakującej metodzie.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE:
//  - `requireSupabaseAuth` (ścieżka TWARDEGO wymogu tokenu) -
//    `src/integrations/supabase/auth-middleware.ts` jest generowane, a jego
//    bramki pilnuje `check:authz-snapshot` i pgTAP.
//  - samej darowizny (kształt sesji płatności, kubełek limitu) -
//    `src/lib/billing/__tests__` i testy tras.
//  - RLS ani RPC - to warstwa pgTAP; tutaj dowodzimy zachowania KODU wobec
//    wyniku, jaki dostał.
//  - haseł, MFA i panelu bezpieczeństwa - `src/lib/auth/__tests__/mfa.test.ts`
//    i `securityPanel.test.ts`.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/** Konto wołającego - stałe UUID-y, zero losowania. */
const OWNER_ID = "33333333-3333-4333-8333-333333333333";
/** Konto, pod które próbujemy się podszyć podrobionym tokenem. */
const VICTIM_ID = "44444444-4444-4444-8444-444444444444";
const OWNER_EMAIL = "czlonek@example.com";

const SUPABASE_URL = "https://projekt.example.com";
const SUPABASE_KEY = "publiczny-klucz-testowy";

const h = vi.hoisted(() => ({
  /** To, co oddaje `getRequest()` - `undefined` znaczy „brak żądania”. */
  request: undefined as { headers?: { get(name: string): string | null } } | undefined,
  /** Czy `getRequest()` ma rzucić (funkcja serwerowa poza kontekstem HTTP). */
  requestThrows: false,
  getClaims: vi.fn(),
  createClient: vi.fn(),
  getSession: vi.fn(),
}));

vi.mock("@tanstack/react-start/server", () => ({
  getRequest: () => {
    if (h.requestThrows) throw new Error("No Start context found in AsyncLocalStorage");
    return h.request;
  },
}));

vi.mock("@supabase/supabase-js", () => ({
  createClient: (url: string, key: string, options: unknown) => h.createClient(url, key, options),
}));

// Atrapa klienta przeglądarkowego wystawia TYLKO `getSession` - patrz punkt 5
// nagłówka. To jest asercja wpisana w kształt atrapy, nie przeoczenie.
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { auth: { getSession: () => h.getSession() } },
}));

const { currentUserFromSession, currentUserIdFromSession } = await import("@/lib/auth/currentUser");

// ---------------------------------------------------------------------------
// Pomocnicze - bez rzutowań typu, wyłącznie strażnicy runtime.
// ---------------------------------------------------------------------------

/**
 * `optionalUser.server.ts` trzyma klienta anonimowego w zmiennej modułu, więc
 * KAŻDY test o tworzeniu klienta musi startować z czystym modułem. Bez tego
 * pierwszy test podgrzewałby cache dla wszystkich następnych i „brak
 * konfiguracji Supabase” przechodziłby fałszywie na zapamiętanym kliencie.
 */
async function loadOptionalUserId(): Promise<() => Promise<string | null>> {
  vi.resetModules();
  const mod = await import("@/lib/auth/optionalUser.server");
  return mod.optionalUserIdFromRequest;
}

/** Skrót: świeży moduł + jedno wywołanie. */
async function optionalUserId(): Promise<string | null> {
  const fn = await loadOptionalUserId();
  return fn();
}

function withAuthorization(value: string | null): void {
  h.request = {
    headers: { get: (name: string) => (name.toLowerCase() === "authorization" ? value : null) },
  };
}

/**
 * JWT o poprawnym KSZTAŁCIE i podrobionej treści - ciało nosi cudze `sub`,
 * podpis jest bezwartościowy. Dokładnie to, co może wysłać dowolny anonim.
 */
function forgedJwt(sub: string): string {
  const segment = (value: object): string =>
    Buffer.from(JSON.stringify(value)).toString("base64url");
  return [
    segment({ alg: "HS256", typ: "JWT" }),
    segment({ sub, role: "authenticated", exp: 4102444800 }),
    "podpis-ktorego-nie-ma",
  ].join(".");
}

/** Opcje `auth` przekazane do `createClient`, wyjęte strażnikiem runtime. */
interface AnonAuthOptions {
  readonly storage: unknown;
  readonly persistSession: unknown;
  readonly autoRefreshToken: unknown;
}

function anonAuthOptions(value: unknown): AnonAuthOptions {
  if (value === null || typeof value !== "object") {
    throw new Error("test: createClient nie dostał obiektu opcji");
  }
  const auth = Reflect.get(value, "auth");
  if (auth === null || typeof auth !== "object") {
    throw new Error("test: opcje createClient nie mają sekcji auth");
  }
  return {
    storage: Reflect.get(auth, "storage"),
    persistSession: Reflect.get(auth, "persistSession"),
    autoRefreshToken: Reflect.get(auth, "autoRefreshToken"),
  };
}

/** Kształt sesji, jaki oddaje atrapa `auth.getSession()`. */
interface UserLike {
  readonly id?: string;
  readonly email?: string;
}
interface SessionLike {
  readonly user: UserLike | null;
}
interface GetSessionResult {
  readonly data: { readonly session: SessionLike | null };
  readonly error: Error | null;
}

function sessionResult(session: SessionLike | null, error: Error | null = null): GetSessionResult {
  return { data: { session }, error };
}

const ENV_KEYS = ["SUPABASE_URL", "SUPABASE_PUBLISHABLE_KEY"] as const;
const savedEnv = new Map<string, string | undefined>();

beforeEach(() => {
  for (const key of ENV_KEYS) savedEnv.set(key, process.env[key]);
  process.env.SUPABASE_URL = SUPABASE_URL;
  process.env.SUPABASE_PUBLISHABLE_KEY = SUPABASE_KEY;

  h.request = undefined;
  h.requestThrows = false;

  h.getClaims.mockReset();
  h.getClaims.mockResolvedValue({ data: { claims: { sub: OWNER_ID } }, error: null });

  h.createClient.mockReset();
  h.createClient.mockImplementation(() => ({
    auth: { getClaims: (token: string) => h.getClaims(token) },
  }));

  h.getSession.mockReset();
  h.getSession.mockResolvedValue(sessionResult({ user: { id: OWNER_ID, email: OWNER_EMAIL } }));
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    const value = savedEnv.get(key);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

// ---------------------------------------------------------------------------
// optionalUserIdFromRequest
// ---------------------------------------------------------------------------

describe("optionalUserIdFromRequest - brak tożsamości to wynik, nie awaria", () => {
  it("brak nagłówka autoryzacji nie tworzy nawet klienta Supabase", async () => {
    withAuthorization(null);

    expect(await optionalUserId()).toBeNull();
    // Anonim nie ma po co płacić za utworzenie klienta ani za round-trip.
    expect(h.createClient).not.toHaveBeenCalled();
    expect(h.getClaims).not.toHaveBeenCalled();
  });

  it("obcy schemat autoryzacji (Basic) jest traktowany jak brak tokenu", async () => {
    withAuthorization("Basic dXNlcjpoYXNsbw==");

    expect(await optionalUserId()).toBeNull();
    expect(h.getClaims).not.toHaveBeenCalled();
  });

  it("nagłówek z samym słowem Bearer i spacjami nie jest tokenem", async () => {
    withAuthorization("Bearer     ");

    expect(await optionalUserId()).toBeNull();
    expect(h.getClaims).not.toHaveBeenCalled();
  });

  it("schemat pisany małą literą daje anonima", async () => {
    // ŚWIADOMY OPIS RZECZYWISTOŚCI, nie życzenie: RFC 7235 mówi, że nazwa
    // schematu jest nieczuła na wielkość liter, a ten helper wymaga dokładnie
    // „Bearer ”. Tak samo robi `requireSupabaseAuth`, a klient tej aplikacji
    // zawsze wysyła formę kanoniczną - reguła jest więc spójna w całym repo.
    // Skutek dla obcego klienta HTTP: wpłata zostaje anonimowa zamiast trafić
    // na konto. Nie jest to luka (na cudze konto też nie trafi).
    withAuthorization("bearer token-w-dobrym-ksztalcie");

    expect(await optionalUserId()).toBeNull();
  });

  it("brak obiektu żądania (np. wywołanie w tle) daje null", async () => {
    h.request = undefined;

    expect(await optionalUserId()).toBeNull();
  });

  it("żądanie bez nagłówków daje null", async () => {
    h.request = {};

    expect(await optionalUserId()).toBeNull();
  });

  it("wyjątek z getRequest() NIE wychodzi na trasę publiczną", async () => {
    // Bez tego `catch` formularz darowizny dla osoby niezalogowanej kończyłby
    // się błędem 500 zamiast wpłatą.
    h.requestThrows = true;

    expect(await optionalUserId()).toBeNull();
  });
});

describe("optionalUserIdFromRequest - token nieważny nie daje tożsamości", () => {
  it("token wygasły (getClaims zwraca błąd) daje null", async () => {
    withAuthorization("Bearer wygasly-token");
    h.getClaims.mockResolvedValue({ data: null, error: new Error("token is expired") });

    expect(await optionalUserId()).toBeNull();
  });

  it("token USZKODZONY nie przenosi podrobionego sub do wyniku", async () => {
    // Sedno punktu 2 nagłówka: w ciele tokenu siedzi cudzy identyfikator,
    // weryfikacja podpisu go odrzuca, a helper NIE zagląda do ciała sam.
    const token = forgedJwt(VICTIM_ID);
    withAuthorization(`Bearer ${token}`);
    h.getClaims.mockResolvedValue({ data: null, error: new Error("invalid signature") });

    const result = await optionalUserId();

    expect(result).toBeNull();
    expect(result).not.toBe(VICTIM_ID);
    // Token poszedł do WERYFIKACJI, a nie do lokalnego dekodowania.
    expect(h.getClaims).toHaveBeenCalledWith(token);
  });

  it("wyjątek z getClaims (np. sieć) daje null, nie awarię", async () => {
    withAuthorization("Bearer token");
    h.getClaims.mockRejectedValue(new Error("fetch failed"));

    expect(await optionalUserId()).toBeNull();
  });

  it.each([
    ["brak danych w odpowiedzi", { data: null, error: null }],
    ["brak claimów", { data: {}, error: null }],
    ["claimy bez sub", { data: { claims: {} }, error: null }],
    ["sub pustym napisem", { data: { claims: { sub: "" } }, error: null }],
    ["sub liczbą, nie napisem", { data: { claims: { sub: 42 } }, error: null }],
  ])("odpowiedź bez użytecznego sub daje null: %s", async (_label, response) => {
    withAuthorization("Bearer token");
    h.getClaims.mockResolvedValue(response);

    expect(await optionalUserId()).toBeNull();
  });

  it("wszystkie drogi bez tożsamości kończą się TYM SAMYM bezpiecznym wynikiem", async () => {
    // Rozłączność, o którą tu chodzi, jest binarna: albo zweryfikowana
    // tożsamość, albo nic. „Coś pomiędzy” (np. identyfikator z niepodpisanego
    // tokenu) byłoby przejęciem konta, więc scalenie tych ścieżek w `null`
    // jest kontraktem, nie zaniedbaniem.
    const scenarios: ReadonlyArray<{ label: string; arrange: () => void }> = [
      { label: "brak nagłówka", arrange: () => withAuthorization(null) },
      { label: "obcy schemat", arrange: () => withAuthorization("Basic xx") },
      { label: "pusty token", arrange: () => withAuthorization("Bearer ") },
      {
        label: "token wygasły",
        arrange: () => {
          withAuthorization("Bearer wygasly");
          h.getClaims.mockResolvedValue({ data: null, error: new Error("expired") });
        },
      },
      {
        label: "token uszkodzony",
        arrange: () => {
          withAuthorization(`Bearer ${forgedJwt(VICTIM_ID)}`);
          h.getClaims.mockResolvedValue({ data: null, error: new Error("invalid signature") });
        },
      },
      {
        label: "brak kontekstu HTTP",
        arrange: () => {
          h.requestThrows = true;
        },
      },
    ];

    const results: Array<{ label: string; value: string | null }> = [];
    for (const scenario of scenarios) {
      h.requestThrows = false;
      h.getClaims.mockResolvedValue({ data: { claims: { sub: OWNER_ID } }, error: null });
      scenario.arrange();
      results.push({ label: scenario.label, value: await optionalUserId() });
    }

    expect(results).toEqual(scenarios.map((s) => ({ label: s.label, value: null })));
  });

  it("uszkodzony token nie trafia do logów", async () => {
    // RODO / higiena logów: token to poświadczenie. Jego wyciek do logu
    // aplikacji jest równoważny wyciekowi hasła sesyjnego.
    const token = forgedJwt(VICTIM_ID);
    const spies = [
      vi.spyOn(console, "error").mockImplementation(() => undefined),
      vi.spyOn(console, "warn").mockImplementation(() => undefined),
      vi.spyOn(console, "log").mockImplementation(() => undefined),
      vi.spyOn(console, "info").mockImplementation(() => undefined),
    ];
    try {
      withAuthorization(`Bearer ${token}`);
      h.getClaims.mockRejectedValue(new Error("invalid signature"));

      expect(await optionalUserId()).toBeNull();

      const written = JSON.stringify(spies.map((spy) => spy.mock.calls));
      expect(written).not.toContain(token);
      expect(written).not.toContain(VICTIM_ID);
    } finally {
      for (const spy of spies) spy.mockRestore();
    }
  });
});

describe("optionalUserIdFromRequest - tożsamość zweryfikowana", () => {
  it("zwraca sub z WERYFIKOWANYCH claimów, ignorując ciało tokenu", async () => {
    // Dwa różne identyfikatory: podrobiony w ciele, prawdziwy w odpowiedzi
    // weryfikacji. Wynik musi pochodzić z drugiego.
    withAuthorization(`Bearer ${forgedJwt(VICTIM_ID)}`);
    h.getClaims.mockResolvedValue({ data: { claims: { sub: OWNER_ID } }, error: null });

    expect(await optionalUserId()).toBe(OWNER_ID);
  });

  it("token jest obcinany z prefiksu i z białych znaków przed weryfikacją", async () => {
    withAuthorization("Bearer   token-z-bialymi-znakami  ");

    expect(await optionalUserId()).toBe(OWNER_ID);
    expect(h.getClaims).toHaveBeenCalledWith("token-z-bialymi-znakami");
  });
});

describe("optionalUserIdFromRequest - klient anonimowy", () => {
  it("brak SUPABASE_URL daje anonima, a nie wyjątek", async () => {
    // Trasa darowizny musi się wyrenderować także wtedy, gdy środowisko jest
    // niedopięte - inaczej błąd konfiguracji zamienia się w błąd 500.
    delete process.env.SUPABASE_URL;
    withAuthorization("Bearer poprawny-token");

    expect(await optionalUserId()).toBeNull();
    expect(h.createClient).not.toHaveBeenCalled();
    expect(h.getClaims).not.toHaveBeenCalled();
  });

  it("brak SUPABASE_PUBLISHABLE_KEY daje anonima, a nie wyjątek", async () => {
    delete process.env.SUPABASE_PUBLISHABLE_KEY;
    withAuthorization("Bearer poprawny-token");

    expect(await optionalUserId()).toBeNull();
    expect(h.createClient).not.toHaveBeenCalled();
  });

  it("klient powstaje BEZ trwałej sesji i bez odświeżania tokenu", async () => {
    // Serwerowy klient z `persistSession` trzymałby sesję jednej osoby
    // w pamięci procesu i podawał ją następnym żądaniom - to jest pomieszanie
    // tożsamości między użytkownikami, nie optymalizacja.
    withAuthorization("Bearer token");

    await optionalUserId();

    expect(h.createClient).toHaveBeenCalledTimes(1);
    const [url, key, options] = h.createClient.mock.calls[0];
    expect(url).toBe(SUPABASE_URL);
    expect(key).toBe(SUPABASE_KEY);
    expect(anonAuthOptions(options)).toEqual({
      storage: undefined,
      persistSession: false,
      autoRefreshToken: false,
    });
  });

  it("klient jest tworzony RAZ i reużywany między żądaniami", async () => {
    // Bez pamięci modułu każda wpłata anonimowa dokładałaby nowy klient
    // (i nowy pool połączeń) do procesu serwera.
    const fn = await loadOptionalUserId();
    withAuthorization("Bearer token");

    expect(await fn()).toBe(OWNER_ID);
    expect(await fn()).toBe(OWNER_ID);

    expect(h.createClient).toHaveBeenCalledTimes(1);
    expect(h.getClaims).toHaveBeenCalledTimes(2);
  });
});

// ---------------------------------------------------------------------------
// currentUser.ts
// ---------------------------------------------------------------------------

describe("currentUser - odczyt tożsamości z lokalnej sesji", () => {
  it("zwraca użytkownika z sesji, nie z Auth API", async () => {
    const user = await currentUserFromSession();

    expect(user?.id).toBe(OWNER_ID);
    // Atrapa wystawia wyłącznie `getSession`; wywołanie `getUser()` wywaliłoby
    // ten test na brakującej metodzie - i taki jest zamiar.
    expect(h.getSession).toHaveBeenCalledTimes(1);
  });

  it("zwraca identyfikator z sesji", async () => {
    expect(await currentUserIdFromSession()).toBe(OWNER_ID);
  });

  it("brak sesji daje null w obu helperach", async () => {
    h.getSession.mockResolvedValue(sessionResult(null));

    expect(await currentUserFromSession()).toBeNull();
    expect(await currentUserIdFromSession()).toBeNull();
  });

  it("sesja bez użytkownika daje null (a nie undefined)", async () => {
    // Sesja bez użytkownika to stan przejściowy klienta Supabase. `undefined`
    // przeciekłoby do `insert({ created_by: undefined })`
    // (`src/lib/admin/membership-admin.ts:104`), czyli do wiersza bez autora.
    h.getSession.mockResolvedValue(sessionResult({ user: null }));

    expect(await currentUserFromSession()).toBeNull();
    expect(await currentUserIdFromSession()).toBeNull();
  });

  it("wyjątek z getSession() przechodzi na zewnątrz - awaria jest widoczna", async () => {
    // ŚWIADOMY OPIS RZECZYWISTOŚCI i jednocześnie kontrola dodatnia dla
    // `it.fails` poniżej: RZUCONY błąd odczytu sesji jest widoczny, a błąd
    // ZWRÓCONY w polu `error` - nie. Ta asymetria jest sednem defektu.
    h.getSession.mockRejectedValue(new Error("storage is not available"));

    await expect(currentUserFromSession()).rejects.toThrow("storage is not available");
    await expect(currentUserIdFromSession()).rejects.toThrow("storage is not available");
  });

  it("błąd odczytu sesji jest dziś raportowany jako brak sesji", async () => {
    // Kontrola dodatnia: przypina STAN FAKTYCZNY, żeby zgłoszony niżej defekt
    // nie był jedynym śladem tego zachowania w suicie.
    h.getSession.mockResolvedValue(sessionResult(null, new Error("refresh_token_not_found")));

    expect(await currentUserFromSession()).toBeNull();
    expect(await currentUserIdFromSession()).toBeNull();
  });

  // DEFEKT - src/lib/auth/currentUser.ts:17-18 i 22-23.
  // CO: oba helpery destrukturyzują z `getSession()` wyłącznie `data`
  // i wyrzucają `error`. Nieudane odświeżenie tokenu, uszkodzony wpis
  // w `localStorage` albo błąd sieci przy refreshu dają więc `null` -
  // identycznie jak poprawnie wykryty brak sesji.
  // GDZIE BOLI: `fetchMyGrants` (`src/lib/billing/membership.ts:27-28`) na
  // `null` zwraca PUSTĄ LISTĘ, a nie błąd. Podobnie `createQaSession`
  // (`src/lib/admin/community.ts:592-593`) i `uploadResourceFile`
  // (`src/lib/admin/library.ts:29-30`) rzucają „Not authenticated”.
  // KONSEKWENCJA DLA UŻYTKOWNIKA: opłacony członek widzi „nie masz żadnych
  // uprawnień” zamiast „nie udało się odczytać sesji, odśwież stronę”,
  // i nie ma powodu ponawiać. Awaria jest raportowana jako brak prawa -
  // czyli najgorszy możliwy komunikat przy problemie przejściowym.
  it.fails("DEFEKT: błąd odczytu sesji jest nieodróżnialny od braku sesji", async () => {
    h.getSession.mockResolvedValue(sessionResult(null, new Error("refresh_token_not_found")));

    // Oczekiwanie: awaria odczytu MA być odróżnialna od anonimowości -
    // przez rzucenie albo przez osobny wynik. Dziś nie jest.
    await expect(currentUserIdFromSession()).rejects.toThrow();
  });
});
