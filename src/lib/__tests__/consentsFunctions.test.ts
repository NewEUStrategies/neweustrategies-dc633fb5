// SERWEROWA WARSTWA REJESTRU ZGÓD (`consents.functions.ts` - 10%,
// `consents.server.ts` - 50%) ORAZ ODCZYT GPC PO STRONIE KLIENTA
// (`consent/gpcClient.ts` - 22%).
//
// ZDANIE, KTÓRE TEN PLIK MA UDOWODNIĆ: **GPC JEST RESPEKTOWANY, A KLIENT NIE
// MOŻE GO ZATAIĆ.** `Sec-GPC: 1` musi wyłączać kategorie niekonieczne bez
// pytania, a znacznik zapisany w audycie jest ORAZ deklaracji klienta i odczytu
// serwerowego. Ta asymetria jest całym mechanizmem: klient może sygnał
// POTWIERDZIĆ (bo widzi `navigator.globalPrivacyControl`, którego serwer nie
// zobaczy nigdy), ale nie może go UKRYĆ (bo serwer czyta nagłówek i cookie).
//
// CO DOWODZIMY:
//   1. ODCZYT SERWEROWY SYGNAŁU: nagłówek obecny, nieobecny, wartość inna niż
//      „1”, cookie jako fallback (nagłówek dochodzi do NAWIGACJI, nie do
//      każdego fetcha RPC), oraz brak żądania.
//   2. FAIL-CLOSED W STRONĘ PRYWATNOŚCI: tabela wszystkich kombinacji
//      deklaracji klienta i sygnału serwerowego. Ani jedna kombinacja nie może
//      dać `false`, jeśli którakolwiek strona widzi sygnał.
//   3. SYGNAŁ WOBEC ISTNIEJĄCEJ ZGODY: co wygrywa. Odczytane z kodu i zapisane
//      testem - `resolveGpcForWrite` nie patrzy na wcześniejszą zgodę wcale,
//      a klamrowanie runtime jest osobną warstwą (`gpc.ts`, własne testy).
//   4. IP I USER-AGENT: kolejność nośników (`x-forwarded-for` przed
//      `cf-connecting-ip` i `x-real-ip`), pierwszy adres z listy proxy,
//      obcięcie UA do 500 znaków.
//   5. WALIDATORY: klucz spoza katalogu odrzucony, wersja wymagana, limit
//      partii, `decisionId` musi być UUID, `pageUrl` obcięty limitem.
//   6. PARTIA: sygnał rozstrzygany RAZ na całe żądanie (inaczej audyt
//      sugerowałby, że sygnał migał w trakcie jednej decyzji), a błąd jednego
//      klucza przerywa partię z NAZWĄ tego klucza w komunikacie.
//   7. KLIENT: `readGpcSignal` czyta za KAŻDYM wywołaniem (bez cache),
//      subskrypcja łapie trzy zdarzenia, `notifyGpcChange` je rozgłasza.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE.
// - RDZENIA GPC (`gpc.ts`): parsowanie wartości, klamrowanie kategorii,
//   ważność świadomego override'u i deklaracja `/.well-known/gpc.json` mają
//   `gpc.test.ts` i `gpcCmpClamp.test.ts`. Tu jest wyłącznie warstwa DOM
//   i warstwa żądania.
// - MIDDLEWARE `gpcMiddleware` i ustawiania cookie transportowego:
//   `gpcServer.test.ts`.
// - RPC `set_user_consent`: utwardzony SECURITY DEFINER z pgTAP
//   (`consent_evidence_hardening_test.sql`). Test na atrapie nie odtwarza jego
//   reguł - dowodzi, CO aplikacja do niego wysyła.
// - MOSTU CMP -> REJESTR: `registryBridge.test.ts` i `registryBridgeSync.test.ts`.
//
// RODO: adresy IP w fixture'ach pochodzą WYŁĄCZNIE z puli dokumentacyjnej
// RFC 5737 (`192.0.2.0/24`, `198.51.100.0/24`, `203.0.113.0/24`) - to bloki
// zarezerwowane, których nikt nie może mieć przypisanych. Osobna asercja
// pilnuje, że fixture'y nie zawierają adresu spoza tych pul.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fail, ok, supabaseFromStub, type SupabaseResult } from "@/test/supabaseChain";
import {
  callServerFn,
  serverFnMiddlewareNames,
  validateServerFnInput,
  type ServerFnContext,
} from "@/test/serverFnHarness";

const h = vi.hoisted(() => ({
  /** Żądanie widziane przez handler; `null` = brak kontekstu żądania. */
  request: null as Request | null,
  /** Gdy `true`, `getRequest()` rzuca - tak zachowuje się poza żądaniem. */
  requestThrows: false,
  /** Zapisane wywołania RPC `set_user_consent`. */
  rpcCalls: [] as { name: string; args: Record<string, unknown> }[],
  /** Błąd RPC per numer wywołania (1-indeksowany); `null` = powodzenie. */
  rpcErrorAtCall: null as number | null,
}));

vi.mock("@tanstack/react-start", async () => {
  const { serverFnStubModule } = await import("@/test/serverFnHarness");
  return serverFnStubModule();
});
vi.mock("@tanstack/react-start/server", () => ({
  getRequest: () => {
    if (h.requestThrows) throw new Error("no request context");
    return h.request;
  },
}));
vi.mock("@/integrations/supabase/auth-middleware", () => ({
  requireSupabaseAuth: { name: "requireSupabaseAuth" },
}));

import {
  listMyConsentEvents,
  listMyConsents,
  setMyConsent,
  setMyConsentsBulk,
} from "@/lib/consents.functions";
import {
  readGpc,
  readIp,
  readUserAgent,
  resolveGpcForWrite,
  ListEventsSchema,
} from "@/lib/consents.server";
import { GPC_COOKIE } from "@/lib/consent/gpc";
import {
  isGpcSignalActive,
  notifyGpcChange,
  readGpcSignal,
  subscribeGpc,
} from "@/lib/consent/gpcClient";

const USER = "11111111-1111-4111-8111-111111111111";
/** Adresy z pul DOKUMENTACYJNYCH RFC 5737 - nikt ich nie ma przypisanych. */
const DOC_IP = {
  client: "203.0.113.7",
  proxyHop: "198.51.100.42",
  edge: "192.0.2.10",
} as const;

let db: ReturnType<typeof supabaseFromStub>;

function context(): ServerFnContext {
  return {
    supabase: {
      from: (table: string) => db.from(table),
      rpc: (name: string, args: Record<string, unknown>) => {
        h.rpcCalls.push({ name, args });
        const callNumber = h.rpcCalls.length;
        const shouldFail = h.rpcErrorAtCall === callNumber;
        return Promise.resolve(
          shouldFail
            ? { data: null, error: new Error("consent_key_unknown") }
            : { data: { consent_key: args.p_key }, error: null },
        );
      },
    },
    userId: USER,
  };
}

/**
 * Żądanie z podanymi nagłówkami - bez sieci.
 *
 * DLACZEGO NIE `new Request(url, { headers })`. Konstruktor `Request` stosuje
 * listę nagłówków ZABRONIONYCH dla skryptów (`Sec-*`, `Cookie`, …) i po cichu
 * je odrzuca - sprawdzone, nie założone: `r.headers.get("sec-gpc")` oddaje
 * wtedy `null`, a test „sygnał obecny" przechodziłby przez przypadek na
 * ścieżce „sygnału nie ma". I tak MA być w przeglądarce: te nagłówki ustawia
 * wyłącznie przeglądarka. W produkcji handler dostaje je od runtime'u serwera,
 * więc test podkłada je, podmieniając własność `headers` na instancję
 * `Headers` (sama `Headers` nie filtruje).
 */
function request(headers: Record<string, string> = {}): Request {
  const req = new Request("https://example.org/_serverFn/setMyConsent");
  Object.defineProperty(req, "headers", {
    value: new Headers(headers),
    configurable: true,
  });
  return req;
}

function setConsents(result: SupabaseResult): void {
  db.setResponse("user_consents", result);
}

const VALID_ENTRY = {
  key: "cookies_analytics",
  given: false,
  version: "2.0",
} as const;

beforeEach(() => {
  db = supabaseFromStub();
  h.request = null;
  h.requestThrows = false;
  h.rpcCalls = [];
  h.rpcErrorAtCall = null;
});

// ---------------------------------------------------------------------------
// 1. OBUDOWA.
// ---------------------------------------------------------------------------

describe("rejestr zgód - obudowa server functions", () => {
  const EXPORTS = [
    { name: "listMyConsents", fn: listMyConsents, method: "GET" },
    { name: "setMyConsent", fn: setMyConsent, method: "POST" },
    { name: "setMyConsentsBulk", fn: setMyConsentsBulk, method: "POST" },
    { name: "listMyConsentEvents", fn: listMyConsentEvents, method: "GET" },
  ] as const;

  it.each(EXPORTS)("$name wymaga uwierzytelnienia", ({ fn }) => {
    // Rejestr zgód jest per użytkownik; funkcja bez middleware oddawałaby
    // historię decyzji dowolnej osoby anonimowi.
    expect(serverFnMiddlewareNames(fn)).toContain("requireSupabaseAuth");
  });

  it.each(EXPORTS)("$name ma metodę $method", ({ fn, method }) => {
    expect(Reflect.get(fn as object, "method")).toBe(method);
  });
});

// ---------------------------------------------------------------------------
// 2. GPC PO STRONIE ŻĄDANIA.
// ---------------------------------------------------------------------------

describe("readGpc - sygnał odczytany z żądania", () => {
  const HEADER_CASES: readonly {
    label: string;
    headers: Record<string, string>;
    expected: boolean;
  }[] = [
    { label: "nagłówek `Sec-GPC: 1`", headers: { "sec-gpc": "1" }, expected: true },
    { label: "nagłówka nie ma", headers: {}, expected: false },
    // Spec GPC zna WYŁĄCZNIE „1”. Każda inna wartość to nie sygnał - i nie
    // wolno jej czytać jako zgody ani jako opt-outu.
    { label: "wartość `0`", headers: { "sec-gpc": "0" }, expected: false },
    { label: "wartość `true`", headers: { "sec-gpc": "true" }, expected: false },
    { label: "wartość pusta", headers: { "sec-gpc": "" }, expected: false },
    { label: "wartość `2`", headers: { "sec-gpc": "2" }, expected: false },
  ];

  it.each(HEADER_CASES)("$label -> $expected", ({ headers, expected }) => {
    expect(readGpc(request(headers))).toBe(expected);
  });

  it("cookie transportowe jest FALLBACKIEM, gdy nagłówka nie ma", () => {
    // Przeglądarka dokłada `Sec-GPC` do NAWIGACJI, a nie do każdego fetcha RPC.
    // Bez cookie wywołanie server fn wyglądałoby jak brak sygnału, choć sygnał
    // jest aktywny - i decyzja trafiłaby do audytu bez znacznika.
    expect(readGpc(request({ cookie: `${GPC_COOKIE}=1` }))).toBe(true);
  });

  it("cookie o innej wartości nie jest sygnałem", () => {
    expect(readGpc(request({ cookie: `${GPC_COOKIE}=0` }))).toBe(false);
  });

  it("nagłówek WYGRYWA nad brakiem cookie, a cookie nad brakiem nagłówka", () => {
    expect(readGpc(request({ "sec-gpc": "1" }))).toBe(true);
    expect(readGpc(request({ cookie: `inne=x; ${GPC_COOKIE}=1; jeszcze=y` }))).toBe(true);
  });

  it("BRAK żądania to brak sygnału - nie wyjątek", () => {
    expect(readGpc(null)).toBe(false);
  });
});

describe("resolveGpcForWrite - fail-closed w stronę prywatności", () => {
  // Tabela WSZYSTKICH kombinacji. Reguła: sygnał zapisany w audycie to OR
  // deklaracji klienta i odczytu serwerowego, więc jedyną kombinacją dającą
  // `false` jest ta, w której NIKT sygnału nie widzi.
  const CASES = [
    { client: true, server: true, expected: true },
    { client: true, server: false, expected: true },
    { client: false, server: true, expected: true },
    { client: false, server: false, expected: false },
    { client: undefined, server: true, expected: true },
    { client: undefined, server: false, expected: false },
  ] as const;

  it.each(CASES)("klient=$client, serwer=$server -> $expected", ({ client, server, expected }) => {
    const req = server ? request({ "sec-gpc": "1" }) : request();
    expect(resolveGpcForWrite(req, client)).toBe(expected);
  });

  it("klient może sygnał POTWIERDZIĆ, ale nie ZATAIĆ - to cała asymetria", () => {
    // Potwierdzenie: serwer nagłówka nie widzi (fetch RPC), klient widzi
    // `navigator.globalPrivacyControl` -> sygnał trafia do audytu.
    expect(resolveGpcForWrite(request(), true)).toBe(true);
    // Zatajenie: klient deklaruje brak sygnału, serwer widzi nagłówek ->
    // deklaracja klienta jest danymi wejściowymi, więc przegrywa.
    expect(resolveGpcForWrite(request({ "sec-gpc": "1" }), false)).toBe(true);
  });

  it("brak żądania i brak deklaracji daje `false` - sygnału się nie wymyśla", () => {
    // Wymyślone `true` byłoby zapisem opt-outu, którego użytkownik nie wysłał.
    expect(resolveGpcForWrite(null, undefined)).toBe(false);
  });

  it("brak żądania z deklaracją klienta daje `true`", () => {
    expect(resolveGpcForWrite(null, true)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 3. IP I USER-AGENT.
// ---------------------------------------------------------------------------

describe("readIp - kolejność nośników adresu", () => {
  it("`x-forwarded-for` jest pierwszy i bierzemy PIERWSZY adres z listy", () => {
    // Lista `x-forwarded-for` rośnie od klienta w stronę serwera, więc adresem
    // podmiotu jest ten PIERWSZY. Wzięcie ostatniego zapisałoby w dowodzie
    // zgody adres własnego proxy - czyli dowód o niczym.
    const ip = readIp(
      request({ "x-forwarded-for": `${DOC_IP.client}, ${DOC_IP.proxyHop}, ${DOC_IP.edge}` }),
    );
    expect(ip).toBe(DOC_IP.client);
  });

  it("obcina spacje wokół adresu", () => {
    expect(readIp(request({ "x-forwarded-for": `  ${DOC_IP.client}  ` }))).toBe(DOC_IP.client);
  });

  it("PUSTY `x-forwarded-for` schodzi na kolejne nagłówki", () => {
    expect(
      readIp(request({ "x-forwarded-for": " , ", "cf-connecting-ip": DOC_IP.edge })),
    ).toBeNull();
  });

  it("bez `x-forwarded-for` czyta `cf-connecting-ip`, potem `x-real-ip`", () => {
    expect(readIp(request({ "cf-connecting-ip": DOC_IP.edge }))).toBe(DOC_IP.edge);
    expect(readIp(request({ "x-real-ip": DOC_IP.proxyHop }))).toBe(DOC_IP.proxyHop);
    // `cf-connecting-ip` ma pierwszeństwo nad `x-real-ip`.
    expect(readIp(request({ "cf-connecting-ip": DOC_IP.edge, "x-real-ip": DOC_IP.proxyHop }))).toBe(
      DOC_IP.edge,
    );
  });

  it("bez żadnego nagłówka i bez żądania oddaje `null`", () => {
    expect(readIp(request())).toBeNull();
    expect(readIp(null)).toBeNull();
  });
});

describe("readUserAgent - obcięcie i brak", () => {
  it("przenosi nagłówek bez zmian, gdy mieści się w limicie", () => {
    const ua = "Mozilla/5.0 (X11; Linux x86_64) TestAgent/1.0";
    expect(readUserAgent(request({ "user-agent": ua }))).toBe(ua);
  });

  it("obcina do 500 znaków - kolumna ma limit, a nagłówek nie", () => {
    // `User-Agent` może być dowolnie długi (rozszerzenia dopisują tokeny);
    // bez obcięcia zapis zgody wywalałby się na ograniczeniu kolumny, czyli
    // ślad audytowy przepadałby przez cudzą przeglądarkę.
    const long = `Mozilla/${"x".repeat(900)}`;
    expect(readUserAgent(request({ "user-agent": long }))).toHaveLength(500);
  });

  it("brak nagłówka i brak żądania oddają `null`", () => {
    expect(readUserAgent(request())).toBeNull();
    expect(readUserAgent(null)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 4. WALIDATORY.
// ---------------------------------------------------------------------------

describe("walidatory rejestru zgód", () => {
  it("klucz SPOZA katalogu zgód jest odrzucany", () => {
    // Klucz jest enumem z katalogu, nie dowolnym łańcuchem: wpis o nieznanym
    // kluczu byłby zgodą, do której nie ma treści ani wersji.
    expect(() =>
      validateServerFnInput(setMyConsent, { ...VALID_ENTRY, key: "cookies_wymyslone" }),
    ).toThrow();
  });

  it("wersja treści jest WYMAGANA i ograniczona do 32 znaków", () => {
    // Bez wersji zapis nie mówi, NA CO ktoś się zgodził - a to jest cała
    // dowodliwość zgody.
    expect(() =>
      validateServerFnInput(setMyConsent, { key: VALID_ENTRY.key, given: true }),
    ).toThrow();
    expect(() => validateServerFnInput(setMyConsent, { ...VALID_ENTRY, version: "" })).toThrow();
    expect(() =>
      validateServerFnInput(setMyConsent, { ...VALID_ENTRY, version: "v".repeat(33) }),
    ).toThrow();
  });

  it('`given` musi być wartością logiczną - `"true"` nie przechodzi', () => {
    // Łańcuch `"false"` jest w JS prawdziwy; cicha konwersja zapisałaby zgodę,
    // której nie udzielono.
    expect(() => validateServerFnInput(setMyConsent, { ...VALID_ENTRY, given: "false" })).toThrow();
  });

  it("język jest opcjonalny, ale ograniczony do `pl`/`en`", () => {
    expect(() => validateServerFnInput(setMyConsent, { ...VALID_ENTRY, lang: "de" })).toThrow();
    expect(() => validateServerFnInput(setMyConsent, { ...VALID_ENTRY, lang: "en" })).not.toThrow();
  });

  it("`decisionId` musi być UUID - dowolny łańcuch scalałby obce decyzje", () => {
    expect(() =>
      validateServerFnInput(setMyConsent, { ...VALID_ENTRY, decisionId: "abc" }),
    ).toThrow();
    expect(() =>
      validateServerFnInput(setMyConsent, {
        ...VALID_ENTRY,
        decisionId: "44444444-4444-4444-8444-444444444444",
      }),
    ).not.toThrow();
  });

  it("`pageUrl` ma limit 500 znaków, a źródło 64", () => {
    expect(() =>
      validateServerFnInput(setMyConsent, { ...VALID_ENTRY, pageUrl: "x".repeat(501) }),
    ).toThrow();
    expect(() =>
      validateServerFnInput(setMyConsent, { ...VALID_ENTRY, source: "s".repeat(65) }),
    ).toThrow();
  });

  it("partia wymaga co najmniej jednego wpisu i przyjmuje maksymalnie dziesięć", () => {
    // Limit 10 = rozmiar katalogu z zapasem. Bez górnej granicy jedno żądanie
    // mogłoby wygenerować dowolnie długą serię zapisów definera.
    expect(() => validateServerFnInput(setMyConsentsBulk, { entries: [] })).toThrow();
    const many = Array.from({ length: 11 }, () => VALID_ENTRY);
    expect(() => validateServerFnInput(setMyConsentsBulk, { entries: many })).toThrow();
    expect(() =>
      validateServerFnInput(setMyConsentsBulk, { entries: many.slice(0, 10) }),
    ).not.toThrow();
  });

  it("limit listy zdarzeń: domyślny brak, zakres 1-200, tylko liczby całkowite", () => {
    expect(ListEventsSchema.parse({})).toEqual({});
    expect(() => ListEventsSchema.parse({ limit: 0 })).toThrow();
    expect(() => ListEventsSchema.parse({ limit: 201 })).toThrow();
    expect(() => ListEventsSchema.parse({ limit: 1.5 })).toThrow();
    expect(ListEventsSchema.parse({ limit: 200 })).toEqual({ limit: 200 });
  });

  it("walidator listy zdarzeń przyjmuje BRAK wejścia", () => {
    // Trasa woła `listMyConsentEvents()` bez argumentów, a walidator dostaje
    // `undefined` - bez `?? {}` byłby to błąd walidacji na pustym wywołaniu.
    expect(validateServerFnInput(listMyConsentEvents, undefined)).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// 5. HANDLERY.
// ---------------------------------------------------------------------------

describe("listMyConsents - odczyt własnych zgód", () => {
  it("czyta WYŁĄCZNIE wiersze wywołującego i niesie kolumny audytowe", async () => {
    // Bez `.eq("user_id", …)` odczyt polegałby tylko na RLS. Warstwy się
    // dublują świadomie: to jest dane osobowe szczególnej kategorii dowodowej.
    setConsents(ok([{ consent_key: "cookies_analytics", given: false }]));
    const result = await callServerFn<unknown[]>(listMyConsents, { context: context() });
    expect(result).toHaveLength(1);
    const chain = db.lastChain("user_consents");
    expect(chain?.argsOf("eq")).toEqual(["user_id", USER]);
    const columns = String(chain?.argsOf("select")?.[0] ?? "");
    for (const column of ["consent_key", "given", "version", "lang", "gpc", "withdrawn_at"]) {
      expect(columns, `brak kolumny audytowej ${column}`).toContain(column);
    }
  });

  it("odczyt zwracający `null` daje pustą listę", async () => {
    setConsents(ok(null));
    await expect(callServerFn(listMyConsents, { context: context() })).resolves.toEqual([]);
  });

  it("awaria odczytu przenosi komunikat bazy", async () => {
    setConsents(fail("statement timeout"));
    await expect(callServerFn(listMyConsents, { context: context() })).rejects.toThrow(
      "statement timeout",
    );
  });
});

describe("setMyConsent - zapis jednej decyzji", () => {
  it("wysyła do definera WSZYSTKIE dowody: sygnał, adres, klienta, źródło, wersję", async () => {
    h.request = request({
      "sec-gpc": "1",
      "x-forwarded-for": DOC_IP.client,
      "user-agent": "TestAgent/1.0",
    });
    await callServerFn(setMyConsent, {
      data: {
        key: "cookies_marketing",
        given: false,
        version: "2.0",
        lang: "pl",
        source: "cmp_banner",
        bannerVersion: "cmp-v2.0",
        decisionId: "44444444-4444-4444-8444-444444444444",
        pageUrl: "https://example.org/regulamin",
      },
      context: context(),
    });
    expect(h.rpcCalls).toHaveLength(1);
    expect(h.rpcCalls[0].name).toBe("set_user_consent");
    expect(h.rpcCalls[0].args).toEqual({
      p_key: "cookies_marketing",
      p_given: false,
      p_version: "2.0",
      p_gpc: true,
      p_lang: "pl",
      p_ip: DOC_IP.client,
      p_user_agent: "TestAgent/1.0",
      p_source: "cmp_banner",
      p_banner_version: "cmp-v2.0",
      p_decision_id: "44444444-4444-4444-8444-444444444444",
      p_page_url: "https://example.org/regulamin",
    });
  });

  it("brak źródła schodzi na `account`, a nie na `undefined`", async () => {
    // Kolumna `source` odpowiada na pytanie „gdzie ta decyzja zapadła".
    // `undefined` zostawiłoby wpis bez tej informacji.
    h.request = request();
    await callServerFn(setMyConsent, { data: { ...VALID_ENTRY }, context: context() });
    expect(h.rpcCalls[0].args.p_source).toBe("account");
  });

  it("brak adresu i klienta idzie jako `undefined` - kolumna zostaje pusta", async () => {
    // `null` w argumencie definera byłby wartością „wiemy, że nie ma";
    // `undefined` znaczy „nie podano" i pozwala procedurze użyć domyślnej.
    h.request = request();
    await callServerFn(setMyConsent, { data: { ...VALID_ENTRY }, context: context() });
    expect(h.rpcCalls[0].args.p_ip).toBeUndefined();
    expect(h.rpcCalls[0].args.p_user_agent).toBeUndefined();
  });

  it("BRAK kontekstu żądania (rzut `getRequest`) nie wywraca zapisu", async () => {
    // Wywołanie spoza żądania (np. z zadania w tle) musi zapisać decyzję bez
    // dowodów transportowych, a nie wywalić się na braku kontekstu.
    h.requestThrows = true;
    await callServerFn(setMyConsent, { data: { ...VALID_ENTRY }, context: context() });
    expect(h.rpcCalls).toHaveLength(1);
    expect(h.rpcCalls[0].args.p_gpc).toBe(false);
  });

  it("deklaracja GPC klienta jest OR-owana z odczytem serwerowym", async () => {
    h.request = request();
    await callServerFn(setMyConsent, {
      data: { ...VALID_ENTRY, gpc: true },
      context: context(),
    });
    expect(h.rpcCalls[0].args.p_gpc).toBe(true);
  });

  it("odmowa definera przenosi komunikat", async () => {
    h.request = request();
    h.rpcErrorAtCall = 1;
    await expect(
      callServerFn(setMyConsent, { data: { ...VALID_ENTRY }, context: context() }),
    ).rejects.toThrow("consent_key_unknown");
  });

  it("wynik definera wraca do wywołującego", async () => {
    h.request = request();
    await expect(
      callServerFn(setMyConsent, { data: { ...VALID_ENTRY }, context: context() }),
    ).resolves.toEqual({ consent_key: "cookies_analytics" });
  });
});

describe("setMyConsentsBulk - jedna decyzja, kilka kategorii", () => {
  const THREE = [
    { key: "cookies_functional", given: true, version: "2.0" },
    { key: "cookies_analytics", given: false, version: "2.0" },
    { key: "cookies_marketing", given: false, version: "2.0" },
  ];

  it("każdy wpis idzie OSOBNYM wywołaniem definera - upsert+event jest atomowy", async () => {
    h.request = request();
    const result = await callServerFn<{ saved: string[] }>(setMyConsentsBulk, {
      data: { entries: THREE },
      context: context(),
    });
    expect(h.rpcCalls).toHaveLength(3);
    expect(h.rpcCalls.every((call) => call.name === "set_user_consent")).toBe(true);
    expect(result.saved).toEqual(["cookies_functional", "cookies_analytics", "cookies_marketing"]);
  });

  it("sygnał GPC jest rozstrzygany RAZ na całą partię", async () => {
    // Jedno żądanie = jeden stan przeglądarki. Różne znaczniki w obrębie jednej
    // decyzji sugerowałyby w audycie, że sygnał migał w trakcie kliknięcia.
    h.request = request();
    await callServerFn(setMyConsentsBulk, {
      data: {
        entries: [{ ...THREE[0], gpc: false }, { ...THREE[1], gpc: true }, { ...THREE[2] }],
      },
      context: context(),
    });
    const flags = h.rpcCalls.map((call) => call.args.p_gpc);
    expect(new Set(flags).size).toBe(1);
    // Wystarczy JEDEN wpis deklarujący sygnał, żeby cała partia go niosła -
    // fail-closed w stronę prywatności.
    expect(flags[0]).toBe(true);
  });

  it("bez deklaracji i bez nagłówka cała partia niesie `false`", async () => {
    h.request = request();
    await callServerFn(setMyConsentsBulk, { data: { entries: THREE }, context: context() });
    expect(h.rpcCalls.every((call) => call.args.p_gpc === false)).toBe(true);
  });

  it("sygnał SERWEROWY nadpisuje brak deklaracji w każdym wpisie", async () => {
    h.request = request({ "sec-gpc": "1" });
    await callServerFn(setMyConsentsBulk, { data: { entries: THREE }, context: context() });
    expect(h.rpcCalls.every((call) => call.args.p_gpc === true)).toBe(true);
  });

  it("adres i klient są IDENTYCZNE dla wszystkich wpisów partii", async () => {
    // Jedna decyzja, jedno żądanie - różne IP w obrębie partii byłyby
    // niemożliwe fizycznie, więc ich wystąpienie znaczyłoby błąd kodu.
    h.request = request({ "x-forwarded-for": DOC_IP.client, "user-agent": "TestAgent/1.0" });
    await callServerFn(setMyConsentsBulk, { data: { entries: THREE }, context: context() });
    expect(new Set(h.rpcCalls.map((call) => call.args.p_ip)).size).toBe(1);
    expect(new Set(h.rpcCalls.map((call) => call.args.p_user_agent)).size).toBe(1);
  });

  it("błąd wpisu PRZERYWA partię i NAZYWA klucz, który padł", async () => {
    // Bez nazwy klucza administrator nie wie, która kategoria nie zapisała się
    // z trzech - a kolejne wpisy zostały nietknięte, co trzeba ustalić.
    h.request = request();
    h.rpcErrorAtCall = 2;
    await expect(
      callServerFn(setMyConsentsBulk, { data: { entries: THREE }, context: context() }),
    ).rejects.toThrow("cookies_analytics: consent_key_unknown");
    // Trzeci wpis NIE poszedł - partia nie jest transakcją.
    expect(h.rpcCalls).toHaveLength(2);
  });

  it("metadane decyzji przechodzą per wpis", async () => {
    h.request = request();
    await callServerFn(setMyConsentsBulk, {
      data: {
        entries: [
          {
            ...THREE[0],
            lang: "en",
            source: "profile_privacy",
            bannerVersion: "cmp-v2.0",
            decisionId: "44444444-4444-4444-8444-444444444444",
            pageUrl: "https://example.org/profile",
          },
        ],
      },
      context: context(),
    });
    expect(h.rpcCalls[0].args).toMatchObject({
      p_lang: "en",
      p_source: "profile_privacy",
      p_banner_version: "cmp-v2.0",
      p_decision_id: "44444444-4444-4444-8444-444444444444",
      p_page_url: "https://example.org/profile",
    });
  });

  it("brak kontekstu żądania w partii też nie wywraca zapisu", async () => {
    h.requestThrows = true;
    await callServerFn(setMyConsentsBulk, { data: { entries: THREE }, context: context() });
    expect(h.rpcCalls).toHaveLength(3);
  });
});

describe("listMyConsentEvents - historia decyzji", () => {
  function setEvents(result: SupabaseResult): void {
    db.setResponse("user_consent_events", result);
  }

  it("czyta zdarzenia wywołującego, najnowsze pierwsze, z domyślnym limitem 100", async () => {
    setEvents(ok([{ id: "e1" }]));
    await callServerFn(listMyConsentEvents, { data: {}, context: context() });
    const chain = db.lastChain("user_consent_events");
    expect(chain?.argsOf("eq")).toEqual(["user_id", USER]);
    expect(chain?.argsOf("order")).toEqual(["created_at", { ascending: false }]);
    expect(chain?.argsOf("limit")).toEqual([100]);
  });

  it("jawny limit przechodzi", async () => {
    setEvents(ok([]));
    await callServerFn(listMyConsentEvents, { data: { limit: 25 }, context: context() });
    expect(db.lastChain("user_consent_events")?.argsOf("limit")).toEqual([25]);
  });

  it("historia niesie kolumny, bez których audyt nie ma sensu", async () => {
    setEvents(ok([]));
    await callServerFn(listMyConsentEvents, { data: {}, context: context() });
    const columns = String(db.lastChain("user_consent_events")?.argsOf("select")?.[0] ?? "");
    for (const column of [
      "consent_key",
      "given",
      "version",
      "source",
      "gpc",
      "banner_version",
      "decision_id",
      "created_at",
    ]) {
      expect(columns, `brak kolumny ${column}`).toContain(column);
    }
    // Adresu IP i klienta NIE zwracamy do przeglądarki - są w tabeli dla
    // audytora, nie dla ekranu użytkownika.
    expect(columns).not.toContain("ip");
    expect(columns).not.toContain("user_agent");
  });

  it("odczyt zwracający `null` daje pustą listę, a awaria rzuca", async () => {
    setEvents(ok(null));
    await expect(
      callServerFn(listMyConsentEvents, { data: {}, context: context() }),
    ).resolves.toEqual([]);

    setEvents(fail("permission denied"));
    await expect(
      callServerFn(listMyConsentEvents, { data: {}, context: context() }),
    ).rejects.toThrow("permission denied");
  });
});

// ---------------------------------------------------------------------------
// 6. ODCZYT SYGNAŁU PO STRONIE KLIENTA.
// ---------------------------------------------------------------------------

describe("gpcClient - sygnał w karcie przeglądarki", () => {
  /** Ustaw `navigator.globalPrivacyControl` na czas jednego testu. */
  function withNavigatorSignal(value: boolean | undefined, run: () => void): void {
    const had = "globalPrivacyControl" in navigator;
    const previous = Reflect.get(navigator, "globalPrivacyControl");
    if (value === undefined) Reflect.deleteProperty(navigator, "globalPrivacyControl");
    else Object.defineProperty(navigator, "globalPrivacyControl", { value, configurable: true });
    try {
      run();
    } finally {
      if (had) {
        Object.defineProperty(navigator, "globalPrivacyControl", {
          value: previous,
          configurable: true,
        });
      } else {
        Reflect.deleteProperty(navigator, "globalPrivacyControl");
      }
    }
  }

  beforeEach(() => {
    document.cookie = `${GPC_COOKIE}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/`;
  });

  it("`navigator.globalPrivacyControl === true` daje sygnał aktywny ze źródłem", () => {
    withNavigatorSignal(true, () => {
      const signal = readGpcSignal();
      expect(signal.active).toBe(true);
      expect(signal.source).toBe("navigator");
      expect(isGpcSignalActive()).toBe(true);
    });
  });

  it("brak właściwości i brak cookie to brak sygnału", () => {
    withNavigatorSignal(undefined, () => {
      expect(readGpcSignal()).toEqual({ active: false, source: "none" });
      expect(isGpcSignalActive()).toBe(false);
    });
  });

  it("cookie transportowe od SSR daje sygnał, gdy właściwości nie ma", () => {
    // Część rozszerzeń wysyła TYLKO nagłówek, więc `navigator` jest pusty,
    // a sygnał realnie aktywny. Bez cookie hydratacja zgubiłaby opt-out.
    withNavigatorSignal(undefined, () => {
      document.cookie = `${GPC_COOKIE}=1; path=/`;
      const signal = readGpcSignal();
      expect(signal.active).toBe(true);
      expect(signal.source).toBe("cookie");
    });
  });

  it("odczyt NIE JEST cache'owany - przestawienie rozszerzenia w trakcie sesji działa", () => {
    // Zapamiętana wartość zamieniłaby cofnięty opt-out w trwały, albo - gorzej -
    // świeży opt-out w ignorowany.
    withNavigatorSignal(false, () => {
      expect(readGpcSignal().active).toBe(false);
      Object.defineProperty(navigator, "globalPrivacyControl", {
        value: true,
        configurable: true,
      });
      expect(readGpcSignal().active).toBe(true);
    });
  });

  it("subskrypcja łapie TRZY zdarzenia: własne, `focus` i `storage`", () => {
    // Przeglądarki nie mają dla GPC własnego zdarzenia, a rozszerzenie da się
    // przestawić w innej karcie - stąd `focus` i `storage`.
    let calls = 0;
    const unsubscribe = subscribeGpc(() => {
      calls += 1;
    });
    try {
      notifyGpcChange();
      expect(calls).toBe(1);
      window.dispatchEvent(new Event("focus"));
      expect(calls).toBe(2);
      window.dispatchEvent(new Event("storage"));
      expect(calls).toBe(3);
    } finally {
      unsubscribe();
    }
  });

  it("odsubskrybowanie ODPINA wszystkie trzy nasłuchy", () => {
    let calls = 0;
    const unsubscribe = subscribeGpc(() => {
      calls += 1;
    });
    unsubscribe();
    notifyGpcChange();
    window.dispatchEvent(new Event("focus"));
    window.dispatchEvent(new Event("storage"));
    expect(calls).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 7. HIGIENA DANYCH W TEŚCIE.
// ---------------------------------------------------------------------------

describe("higiena danych osobowych w fixture'ach", () => {
  it("adresy IP pochodzą WYŁĄCZNIE z pul dokumentacyjnych RFC 5737", () => {
    // Bramka na własnych danych testowych: realny adres IP w repozytorium to
    // dana osobowa, a ten test dotyczy właśnie dowodów zgody.
    const documentationRanges = [/^192\.0\.2\./, /^198\.51\.100\./, /^203\.0\.113\./];
    for (const ip of Object.values(DOC_IP)) {
      expect(
        documentationRanges.some((range) => range.test(ip)),
        `adres ${ip} nie należy do puli dokumentacyjnej RFC 5737`,
      ).toBe(true);
    }
  });

  it("test NIE zapisuje adresu IP w postaci jawnej do żadnego pola audytu poza `p_ip`", async () => {
    // `p_ip` jest jedynym polem, w którym adres ma prawo się znaleźć - hashuje
    // go baza (patrz `consent_evidence_hardening_test.sql`). Wyciek adresu do
    // `p_page_url` albo `p_source` byłby wyciekiem przez ślad, który powstaje
    // po to, żeby chronić dane.
    h.request = request({ "x-forwarded-for": DOC_IP.client, "user-agent": "TestAgent/1.0" });
    await callServerFn(setMyConsent, {
      data: { ...VALID_ENTRY, pageUrl: "https://example.org/regulamin" },
      context: context(),
    });
    const args = h.rpcCalls[0].args;
    for (const [name, value] of Object.entries(args)) {
      if (name === "p_ip") continue;
      expect(String(value ?? ""), `adres wyciekł do ${name}`).not.toContain(DOC_IP.client);
    }
  });
});

// ---------------------------------------------------------------------------
// 8. BRZEGI SSR I OSTATNIE RAMIONA WARUNKÓW.
// ---------------------------------------------------------------------------

/**
 * Uruchamia funkcję z „wygaszonym" globalem przeglądarki, symulując render po
 * stronie serwera. `typeof x` oddaje `"undefined"` także dla własności, która
 * ISTNIEJE i ma wartość `undefined` - dzięki temu strażniki SSR
 * (`typeof window === "undefined"`) da się przejechać bez osobnego środowiska
 * testowego. To nie jest sztuczka na pokrycie: te gałęzie decydują o tym, czy
 * moduł zgód da się w ogóle zaimportować w renderze serwerowym.
 */
function withoutGlobal<T>(name: "window" | "navigator" | "document", run: () => T): T {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, name);
  Object.defineProperty(globalThis, name, { value: undefined, configurable: true });
  try {
    return run();
  } finally {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else Reflect.deleteProperty(globalThis, name);
  }
}

describe("gpcClient - render po stronie serwera", () => {
  it("BEZ `window` sygnał jest nieaktywny, a nie wyjątek", () => {
    // Moduł zgód jest importowany także w renderze serwerowym (baner jest
    // `React.lazy`, ale jego zależności trafiają do grafu). Rzut na globalu
    // przeglądarki wywalałby cały dokument.
    withoutGlobal("window", () => {
      expect(readGpcSignal()).toEqual({ active: false, source: "none" });
      expect(isGpcSignalActive()).toBe(false);
    });
  });

  it("BEZ `window` subskrypcja oddaje funkcję odsubskrybowania, która nic nie robi", () => {
    // Wywołujący (efekt Reacta) zawsze woła zwróconą funkcję przy czyszczeniu -
    // `undefined` dałoby tam `TypeError` przy pierwszym odmontowaniu.
    withoutGlobal("window", () => {
      const unsubscribe = subscribeGpc(() => undefined);
      expect(unsubscribe).toBeTypeOf("function");
      expect(() => unsubscribe()).not.toThrow();
    });
  });

  it("BEZ `window` rozgłoszenie zmiany jest bezpieczne", () => {
    withoutGlobal("window", () => {
      expect(() => notifyGpcChange()).not.toThrow();
    });
  });

  it("BEZ `navigator` czytamy WYŁĄCZNIE cookie", () => {
    // Część środowisk renderujących nie ma `navigator`, a cookie transportowe
    // i tak jest dostępne w dokumencie po hydratacji.
    document.cookie = `${GPC_COOKIE}=1; path=/`;
    try {
      withoutGlobal("navigator", () => {
        const signal = readGpcSignal();
        expect(signal.active).toBe(true);
        expect(signal.source).toBe("cookie");
      });
    } finally {
      document.cookie = `${GPC_COOKIE}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/`;
    }
  });

  it("BEZ `document` nie ma z czego czytać cookie - sygnał zostaje nieaktywny", () => {
    withoutGlobal("document", () => {
      expect(readGpcSignal().active).toBe(false);
    });
  });
});

describe("setMyConsent - ostatnie ramiona warunków", () => {
  it("definer, który NIE ODDAŁ wiersza, daje `null`, a nie `undefined`", async () => {
    // `undefined` w odpowiedzi server fn gubi się w serializacji i klient
    // dostaje pustkę bez informacji, czy zapis się udał.
    const nullReturningContext: ServerFnContext = {
      supabase: {
        from: (table: string) => db.from(table),
        rpc: (name: string, args: Record<string, unknown>) => {
          h.rpcCalls.push({ name, args });
          return Promise.resolve({ data: null, error: null });
        },
      },
      userId: USER,
    };
    await expect(
      callServerFn(setMyConsent, { data: { ...VALID_ENTRY }, context: nullReturningContext }),
    ).resolves.toBeNull();
  });
});
