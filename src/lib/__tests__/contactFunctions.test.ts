// PUBLICZNY FORMULARZ KONTAKTOWY (`src/lib/contact.functions.ts`): 542 linie,
// jedna funkcja serwerowa, ZERO wykonanych linii przed tym plikiem.
//
// DLACZEGO TO JEST NAJWAŻNIEJSZA NIEPOKRYTA POWIERZCHNIA W TYM MODULE.
// `submitContactMessage` to JEDYNY endpoint platformy, który anonim wywołuje
// bez sesji i który w odpowiedzi WYSYŁA POCZTĘ na adres podany przez
// wywołującego. Niesie więc trzy rzeczy naraz: dane osobowe (imię, e-mail,
// telefon, IP, user-agent), zapis do skrzynki operatora oraz start double
// opt-inu newslettera. Każda z nich może paść osobno i - to jest sedno -
// PO CICHU.
//
// ZDANIE, KTÓRE TEN PLIK MA UDOWODNIĆ. Własny komentarz modułu obiecuje:
// „If Resend or LOVABLE_API_KEY are missing, email steps degrade silently -
// the message is still stored so the form never breaks” (linie 3-5). Cicha
// degradacja jest ŚWIADOMĄ decyzją produktową i jest słuszna: formularz nie
// może pękać, gdy padnie dostawca poczty. Ale jeśli oprócz ciszy nie ma
// SYGNAŁU w wyniku funkcji, to operator dowiaduje się o niedziałającej
// poczcie od klienta, nie z systemu. Dlatego dowodzimy trójkąta:
// WIADOMOŚĆ ZAPISANA + BRAK WYSYŁKI + SYGNAŁ W WYNIKU - i sprawdzamy, ile
// ten sygnał naprawdę mówi (patrz sekcja 12: dwa `it.fails`).
//
// CO DOWODZIMY, w kolejności sekcji:
//   1. OBUDOWA: metoda POST i - celowo - ZERO middleware (endpoint publiczny).
//   2. WALIDACJA: każde ramię schematu Zod, z wartościami brzegowymi.
//   3. TENANT: zgłoszenie jest PRZYPINANE do najemcy przeglądanego hosta,
//      a nierozwiązany host przerywa pracę przed jakimkolwiek zapisem.
//   4. POLITYKA PÓL: podłoga najemcy z RPC + dokładka widgetu, kolejność
//      względem limitu nadużyć, i co się dzieje, gdy RPC padnie.
//   5. ZAPIS: pełny kształt wiersza `contact_messages`.
//   6. NAGŁÓWKI: kolejność nośników IP, brak kontekstu żądania.
//   7. OCHRONA PRZED NADUŻYCIEM: dwa niezależne limity (IP i ADRESAT).
//   8. CRM: przekazanie pól hybrydowych, stempel rekrutacyjny, awarie.
//   9. POCZTA: dokąd, z jaką treścią, w JAKIEJ KOLEJNOŚCI, z jakim `from`.
//  10. CICHA DEGRADACJA (rdzeń pliku).
//  11. NEWSLETTER: double opt-in startuje / nie startuje, wszystkie ramiona.
//  12. DEFEKTY zgłoszone jako `it.fails` (produkcji NIE ruszamy).
//  13. HIGIENA WŁASNYCH FIXTURE'ÓW (bramka na siebie samego).
//
// CZEGO TEN HARNESS NIE UDAJE - I DLACZEGO TO NIE JEST LUKA.
// `@/test/serverFnHarness` nie uruchamia middleware (patrz nagłówek harnessu).
// Tutaj nie ma to jednak żadnego znaczenia, bo ta funkcja Z ZAŁOŻENIA nie ma
// middleware - formularz kontaktowy musi działać dla anonima. Brak middleware
// jest tu KONTRAKTEM, nie brakiem, więc sprawdzamy go jako deklarację
// (sekcja 1), a autoryzację zastępuje limit nadużyć (sekcja 7).
//
// CZEGO ŚWIADOMIE NIE DUBLUJE.
// - LIMITU NADUŻYĆ: `rateLimit` (atomowy RPC `rate_limit_hit`, fail-open vs
//   fail-closed) ma własne testy; tu jest atrapą i dowodzimy WYŁĄCZNIE, jakie
//   dwa zakresy formularz zamawia i co robi z odmową.
// - POLITYKI PÓL: `enforce_form_field_policy` to SECURITY DEFINER pilnowany
//   pgTAP-em; tu dowodzimy, CO aplikacja do niego wysyła i jak czyta odpowiedź.
// - KSZTAŁTU ŚCIEŻKI CV I NORMALIZACJI URL-a: `isCareerCvPath` /
//   `normalizeCvUrl` z `recruitmentShared` mają własne testy i są tu użyte
//   PRAWDZIWE (nie atrapy) - dowodzimy tylko, że formularz je stosuje.
// - INTERFEJSU SKRZYNKI: `src/routes/__tests__/adminContactRoute.test.tsx`.
// - POTWIERDZANIA ZAPISU DO NEWSLETTERA (drugi krok DOI, `/api/public/
//   newsletter/confirm`): `newsletter.functions.test.ts`.
//
// UWAGA O i18n. Ten moduł NIE korzysta z i18n - treści wiadomości są wpisane
// w kod jako pary PL/EN (`buildAutoReply`, `buildAdminNotice`,
// `buildDoiEmail`). Nie ma więc kluczy, na których można by oprzeć asercje;
// zamiast tego sprawdzamy PRZEŁĄCZNIK JĘZYKA (że PL i EN dają różną treść)
// oraz nadpisanie treści z `contact_form_settings`. Sam fakt braku i18n
// w wychodzącej poczcie jest ustaleniem tego pliku, nie jego pominięciem.
//
// DWIE GAŁĘZIE, KTÓRYCH NIE DA SIĘ POKRYĆ - i to jest ustalenie, nie luka.
// Po tym pliku `contact.functions.ts` ma 100% instrukcji, linii i funkcji;
// w gałęziach zostają DOKŁADNIE dwie, strukturalnie nieosiągalne:
//   * `contact.functions.ts:101` - `?? c` w `esc()`. Wyrażenie regularne
//     `/[&<>"']/g` dopasowuje wyłącznie te pięć znaków, które słownik ma jako
//     klucze, więc odwzorowanie NIGDY nie oddaje `undefined`. Żadne wejście -
//     w tym wielobajtowe i sterujące - tej gałęzi nie uruchomi.
//   * `contact.functions.ts:296` - `?? null` po `fwd.split(",")[0]?.trim()`.
//     `String.prototype.split` zwraca listę o długości co najmniej 1 (dla
//     pustego napisu `[""]`), więc element `[0]` nigdy nie jest `undefined`
//     i opcjonalne wywołanie nigdy nie zwiera. Sam pusty `x-forwarded-for` NIE
//     wchodzi tu w ogóle, bo `fwd` jest wtedy falsy - i to jest sprawdzone
//     osobnym testem („puste `x-forwarded-for` nie udaje adresu”).
// Obie są zabezpieczeniami „na wszelki wypadek” i nic złego w nich nie ma;
// wymuszanie ich testem wymagałoby podmiany wbudowanych metod, czyli dowodu
// o atrapie, nie o produkcji.
//
// RODO. Formularz kontaktowy niesie dane osobowe, więc fixture'y są
// syntetyczne: adresy WYŁĄCZNIE w `example.com`/`example.org`, adresy IP
// WYŁĄCZNIE z pul dokumentacyjnych RFC 5737 (`192.0.2.0/24`,
// `198.51.100.0/24`, `203.0.113.0/24`), imiona umowne, klucze API jawnie
// fałszywe. Sekcja 13 pilnuje tego automatycznie - również tego, że fałszywy
// klucz API nie wycieka do treści wysyłanej wiadomości. Moduł NIE HASZUJE IP
// (zapisuje je jawnie do `contact_messages.ip`), więc nie ma haszu, w którym
// można by szukać oryginału - jest za to asercja, że adres nie rozlewa się do
// pól nieprzeznaczonych na niego.
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ZodError } from "zod";
import { fail, ok, type SupabaseFromStub, type SupabaseResult } from "@/test/supabaseChain";
import {
  callServerFn,
  serverFnMiddlewareNames,
  validateServerFnInput,
  type ServerFnContext,
} from "@/test/serverFnHarness";

// ---------------------------------------------------------------------------
// Stan atrap. Wartości ustawiane per test; obiekty tworzone w fabrykach.
// ---------------------------------------------------------------------------

const h = vi.hoisted(() => ({
  /** Atrapa łańcucha PostgREST, tworzona w fabryce `vi.mock`. */
  db: null as SupabaseFromStub | null,
  /** Żądanie widziane przez handler; `null` = runtime oddał brak żądania. */
  request: null as Request | null,
  /** Gdy `true`, `getRequest()` rzuca - tak zachowuje się wywołanie poza HTTP. */
  requestThrows: false,
  /** Host, jaki oddaje warstwa `currentTenantHost()`. */
  tenantHost: null as string | null,
  /** Hosty, o które handler pytał katalog najemców. */
  resolvedHosts: [] as (string | null)[],
  /** Najemca przeglądanego hosta; `null` = host nierozwiązany. */
  hostTenantId: null as string | null,
  /** Wywołania RPC (kolejność + argumenty). */
  rpcCalls: [] as { name: string; args: unknown }[],
  /** Dane oddawane per nazwa RPC. */
  rpcData: {} as Record<string, unknown>,
  /** Błąd oddawany per nazwa RPC (komunikat). */
  rpcError: {} as Record<string, string>,
  /** Nazwy RPC, które mają RZUCIĆ (nie oddać błędu w polu `error`). */
  rpcThrows: [] as string[],
  /** Zamówione limity nadużyć - zakres, podmiot, próg, okno. */
  rateLimitCalls: [] as {
    scope: string;
    subjectId: string;
    max: number;
    windowMinutes?: number;
  }[],
  /** Zakresy limitu, które mają ODMÓWIĆ. */
  rateLimitDeny: [] as string[],
  /** Surowe wywołania bramki poczty (adres + opcje `fetch`). */
  fetchCalls: [] as { url: unknown; init: unknown }[],
  /**
   * Zachowanie bramki poczty per KOLEJNE wywołanie. Lista jest zużywana od
   * początku; brak wpisu = zachowanie domyślne („ok”).
   */
  fetchScript: [] as ("ok" | "http-error" | "unreadable-error" | "throw")[],
}));

vi.mock("@tanstack/react-start", async () => {
  const { serverFnStubModule } = await import("@/test/serverFnHarness");
  return serverFnStubModule();
});

vi.mock("@tanstack/react-start/server", () => ({
  getRequest: () => {
    if (h.requestThrows) throw new Error("brak kontekstu żądania");
    return h.request;
  },
}));

vi.mock("@/integrations/supabase/client.server", async () => {
  const { supabaseFromStub } = await import("@/test/supabaseChain");
  const db = supabaseFromStub();
  h.db = db;
  return {
    supabaseAdmin: {
      from: (table: string) => db.from(table),
      rpc: (name: string, args: unknown) => {
        h.rpcCalls.push({ name, args });
        if (h.rpcThrows.includes(name)) {
          return Promise.reject(new Error(`rpc ${name} wybuchł`));
        }
        const message = h.rpcError[name];
        if (message !== undefined) {
          return Promise.resolve({ data: null, error: { message } });
        }
        return Promise.resolve({ data: h.rpcData[name] ?? null, error: null });
      },
    },
  };
});

vi.mock("@/lib/server/tenant.server", () => ({
  resolveTenantIdForHost: (host: string | null) => {
    h.resolvedHosts.push(host);
    return Promise.resolve(h.hostTenantId);
  },
}));

vi.mock("@/lib/http/requestHost", () => ({
  currentTenantHost: () => Promise.resolve(h.tenantHost),
}));

vi.mock("@/lib/server/rate-limit.server", () => ({
  rateLimit: (opts: { scope: string; subjectId: string; max: number; windowMinutes?: number }) => {
    h.rateLimitCalls.push(opts);
    return Promise.resolve(!h.rateLimitDeny.includes(opts.scope));
  },
}));

import { submitContactMessage } from "@/lib/contact.functions";
import { CAREERS_FORM_ID } from "@/lib/careers/recruitmentShared";

// ---------------------------------------------------------------------------
// Fixture'y. Wyłącznie dane syntetyczne - patrz sekcja 13.
// ---------------------------------------------------------------------------

const IDS = {
  tenant: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  message: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  lead: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
} as const;

/** Dane „osobowe” w fixture'ach - wszystkie zmyślone, patrz sekcja 13. */
const PII = {
  senderEmail: "zglaszajacy@example.com",
  senderEmailMixedCase: "ZgLaszajacy@Example.com",
  adminInbox: "skrzynka.redakcji@example.org",
  fromAddress: "no-reply@example.org",
  senderName: "Zgłaszający Testowy",
  senderPhone: "+48 000 000 000",
  senderCompany: "Przykładowa Organizacja",
  /** RFC 5737 - pule DOKUMENTACYJNE, nikt ich nie ma przypisanych. */
  cloudflareIp: "203.0.113.7",
  proxyFirstHopIp: "198.51.100.42",
  realIp: "192.0.2.10",
} as const;

/** Klucze API jawnie fałszywe - ani jeden nie jest sekretem. */
const FAKE_KEYS = {
  lovable: "lovable-key-FAKE-do-testow",
  resend: "resend-key-FAKE-do-testow",
} as const;

const SITE_ORIGIN = "https://kontakt.example.org";
const GATEWAY = "https://connector-gateway.lovable.dev/resend/emails";

/** Ustalona data bazowa - żadnego `Date.now()` w asercjach. */
const BASE_ISO = "2026-03-10T09:00:00.000Z";
/** BASE + 48 h, czyli `DOI_TTL_MS` z produkcji, policzone RĘCZNIE. */
const DOI_EXPIRES_ISO = "2026-03-12T09:00:00.000Z";

/** Kształt wyniku, jaki oddaje produkcja (sekcja 10 sięga też POZA ten typ). */
interface ContactResult {
  readonly ok: true;
  readonly id: string;
  readonly emails: {
    readonly autoReply: boolean;
    readonly admin: boolean;
    readonly newsletter: {
      readonly ok: boolean;
      readonly status?: "pending" | "subscribed" | "exists";
      readonly error?: string;
    } | null;
  };
}

/** Jedna wiadomość przechwycona na bramce poczty, rozebrana z ciała JSON. */
interface SentEmail {
  readonly url: string;
  readonly authorization: string;
  readonly connectionKey: string;
  readonly from: string;
  readonly to: readonly string[];
  readonly subject: string;
  readonly html: string;
}

// ---------------------------------------------------------------------------
// Strażniki typu zamiast rzutowań.
// ---------------------------------------------------------------------------

function fieldOf(value: unknown, key: string): unknown {
  if (typeof value !== "object" || value === null) return undefined;
  return Reflect.get(value, key);
}

function textField(value: unknown, key: string): string {
  const raw = fieldOf(value, key);
  if (typeof raw !== "string") throw new Error(`test: pole "${key}" nie jest napisem`);
  return raw;
}

function stringList(value: unknown, key: string): string[] {
  const raw = fieldOf(value, key);
  if (!Array.isArray(raw)) throw new Error(`test: pole "${key}" nie jest listą`);
  return raw.map((entry) => {
    if (typeof entry !== "string") throw new Error(`test: pole "${key}" ma element nie-napisowy`);
    return entry;
  });
}

/**
 * Odczytuje z wyniku funkcji pole, którego w typie NIE MA. Używane wyłącznie
 * w sekcji 12, żeby zapytać system o coś, czego nie oddaje - bez rzutowań.
 */
function optionalText(value: unknown, key: string): string | null {
  const raw = fieldOf(value, key);
  return typeof raw === "string" ? raw : null;
}

// ---------------------------------------------------------------------------
// Pomocnicy testowe.
// ---------------------------------------------------------------------------

function db(): SupabaseFromStub {
  const stub = h.db;
  if (stub === null) throw new Error("test: atrapa supabaseAdmin nie została zainicjalizowana");
  return stub;
}

/**
 * Żądanie z podanymi nagłówkami - bez sieci.
 *
 * DLACZEGO NIE `new Request(url, { headers })`. Konstruktor `Request` stosuje
 * listę nagłówków ZABRONIONYCH dla skryptów i po cichu je odrzuca. Tu dotyczy
 * to wprost `cookie`, ale również sposobu, w jaki runtime serwera podaje
 * handlerowi nagłówki proxy - dlatego podkładamy własną instancję `Headers`
 * (sama `Headers` nie filtruje). Ten sam wzorzec, co w
 * `consentsFunctions.test.ts`; tam jest opisany szeroko.
 */
function request(headers: Record<string, string> = {}, url = `${SITE_ORIGIN}/kontakt`): Request {
  const req = new Request(url);
  Object.defineProperty(req, "headers", { value: new Headers(headers), configurable: true });
  return req;
}

function context(): ServerFnContext {
  // Handler NIE czyta kontekstu - pisze przez `supabaseAdmin` (omijając RLS),
  // bo wywołujący jest anonimem. Pusty kontekst jest tu prawdą, nie skrótem.
  return { supabase: null };
}

function payload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    name: PII.senderName,
    email: PII.senderEmail,
    message: "Poproszę o kontakt w sprawie współpracy.",
    consent: true,
    lang: "pl",
    ...overrides,
  };
}

function submit(overrides: Record<string, unknown> = {}): Promise<ContactResult> {
  return callServerFn<ContactResult>(submitContactMessage, {
    data: payload(overrides),
    context: context(),
  });
}

/** Ustawia domyślne, „szczęśliwe” odpowiedzi bazy. */
function planHappyPath(settings: Record<string, unknown> | null = null): void {
  db().setResponse("contact_messages", (chain) => {
    if (chain.has("insert")) return ok({ id: IDS.message, tenant_id: IDS.tenant });
    if (chain.has("update")) return ok(null);
    return fail("test: nieoczekiwany łańcuch na contact_messages");
  });
  db().setResponse("crm_leads", ok(null));
  db().setResponse("contact_form_settings", ok(settings));
}

/** Domyślne odpowiedzi warstwy newslettera (bez istniejącego subskrybenta). */
function planNewsletter(
  options: {
    newsletterSettings?: Record<string, unknown> | null;
    existing?: Record<string, unknown> | null;
    upsert?: SupabaseResult;
  } = {},
): void {
  db().setResponse("newsletter_settings", ok(options.newsletterSettings ?? null));
  db().setResponse("newsletter_subscribers", (chain) => {
    if (chain.has("upsert")) return options.upsert ?? ok(null);
    return ok(options.existing ?? null);
  });
}

/** Łańcuch danej tabeli zawierający wskazane ogniwo. */
function chainWith(table: string, method: string) {
  const chain = db()
    .chainsFor(table)
    .find((candidate) => candidate.has(method));
  if (chain === undefined) throw new Error(`test: brak łańcucha ${table}.${method}()`);
  return chain;
}

function insertedRow(): unknown {
  return chainWith("contact_messages", "insert").argsOf("insert")?.[0];
}

function subscriberRow(): unknown {
  return chainWith("newsletter_subscribers", "upsert").argsOf("upsert")?.[0];
}

/** Wiadomości przechwycone na bramce, w kolejności wysyłki. */
function sentEmails(): SentEmail[] {
  return h.fetchCalls.map((call) => {
    const url = call.url;
    if (typeof url !== "string") throw new Error("test: fetch bez adresu");
    const headers = fieldOf(call.init, "headers");
    const body: unknown = JSON.parse(textField(call.init, "body"));
    return {
      url,
      authorization: textField(headers, "Authorization"),
      connectionKey: textField(headers, "X-Connection-Api-Key"),
      from: textField(body, "from"),
      to: stringList(body, "to"),
      subject: textField(body, "subject"),
      html: textField(body, "html"),
    };
  });
}

function sentTo(): string[] {
  return sentEmails().map((mail) => mail.to[0]);
}

async function rejection(overrides: Record<string, unknown> = {}): Promise<string> {
  try {
    await submit(overrides);
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
  throw new Error("test: zgłoszenie zostało przyjęte, a miało zostać odrzucone");
}

/** Ścieżki pól, na których poległ schemat Zod. */
function rejectedPaths(input: unknown): string[] {
  try {
    validateServerFnInput(submitContactMessage, input);
  } catch (err) {
    if (err instanceof ZodError) return err.issues.map((issue) => issue.path.join("."));
    throw err;
  }
  throw new Error("test: wejście zostało przyjęte, a miało zostać odrzucone");
}

// ---------------------------------------------------------------------------
// Cykl życia.
// ---------------------------------------------------------------------------

// FABRYKA `vi.mock` JEST LENIWA - i to jest cała przyczyna, dla której ten plik
// nie startował. Produkcja importuje klienta admina DYNAMICZNIE, w środku
// handlera (`contact.functions.ts:213`), więc fabryka atrapy
// `@/integrations/supabase/client.server` - a wraz z nią przypisanie `h.db` -
// wykonuje się dopiero przy PIERWSZYM zgłoszeniu. `beforeEach` chce natomiast
// wyczyścić atrapę ZANIM padnie pierwsze zgłoszenie, więc widział `null`.
// Wymuszamy więc import modułu raz, przed wszystkimi testami. Nie da się tego
// zrobić statycznym importem na górze pliku: `submitContactMessage` nie
// pociąga klienta admina, a dodanie tu drugiego, „martwego” importu ukryłoby
// powód. Ta pętla jest jednocześnie asercją: brak atrapy po imporcie znaczy,
// że ścieżka modułu w `vi.mock` rozjechała się z produkcją.
beforeAll(async () => {
  await import("@/integrations/supabase/client.server");
  if (h.db === null) {
    throw new Error(
      "test: fabryka atrapy `@/integrations/supabase/client.server` nie ustawiła `h.db` - " +
        "sprawdź, czy produkcja importuje dokładnie ten specyfikator",
    );
  }
});

beforeEach(() => {
  db().reset();
  h.request = request();
  h.requestThrows = false;
  h.tenantHost = "kontakt.example.org";
  h.resolvedHosts = [];
  h.hostTenantId = IDS.tenant;
  h.rpcCalls = [];
  h.rpcData = { enforce_form_field_policy: [], crm_upsert_from_form: IDS.lead };
  h.rpcError = {};
  h.rpcThrows = [];
  h.rateLimitCalls = [];
  h.rateLimitDeny = [];
  h.fetchCalls = [];
  h.fetchScript = [];

  // Data bazowa. Tylko `Date` jest podmieniona - handler nie używa zegarów.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(BASE_ISO));

  // Poczta skonfigurowana; klucze jawnie fałszywe. Origin linku DOI ma
  // pochodzić z ŻĄDANIA, więc zmienne środowiskowe są tu wygaszone.
  vi.stubEnv("LOVABLE_API_KEY", FAKE_KEYS.lovable);
  vi.stubEnv("RESEND_API_KEY", FAKE_KEYS.resend);
  vi.stubEnv("PUBLIC_SITE_URL", undefined);
  vi.stubEnv("SITE_URL", undefined);
  vi.stubEnv("URL", undefined);

  vi.stubGlobal("fetch", (url: unknown, init: unknown) => {
    h.fetchCalls.push({ url, init });
    const mode = h.fetchScript.shift() ?? "ok";
    if (mode === "throw") return Promise.reject(new Error("gateway unreachable"));
    if (mode === "http-error") {
      return Promise.resolve({
        ok: false,
        status: 422,
        text: () => Promise.resolve("Resend: domain not verified"),
      });
    }
    if (mode === "unreadable-error") {
      return Promise.resolve({
        ok: false,
        status: 502,
        text: () => Promise.reject(new Error("ciało odpowiedzi urwane")),
      });
    }
    return Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve("{}") });
  });

  // Produkcja loguje diagnostykę do konsoli na KAŻDEJ ścieżce awarii. Cisza
  // w wyjściu testu jest tu wymagana, ale komunikaty nadal są sprawdzalne.
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// 1. OBUDOWA.
// ---------------------------------------------------------------------------

describe("formularz kontaktowy - obudowa funkcji serwerowej", () => {
  it("jest funkcją POST", () => {
    expect(Reflect.get(submitContactMessage, "method")).toBe("POST");
  });

  it("CELOWO nie ma żadnego middleware - to endpoint dla anonima", () => {
    // Gdyby ktoś dołożył tu `requireSupabaseAuth`, formularz kontaktowy
    // przestałby działać dla niezalogowanych, czyli dla wszystkich, do których
    // jest adresowany. Autoryzację zastępuje limit nadużyć (sekcja 7).
    expect(serverFnMiddlewareNames(submitContactMessage)).toEqual([]);
  });

  it("ma walidator wejścia", () => {
    expect(() => validateServerFnInput(submitContactMessage, {})).toThrow(ZodError);
  });
});

// ---------------------------------------------------------------------------
// 2. WALIDACJA WEJŚCIA.
// ---------------------------------------------------------------------------

describe("formularz kontaktowy - walidacja wejścia", () => {
  const REJECTED: ReadonlyArray<{ why: string; input: unknown; path: string }> = [
    { why: "brak nazwiska/nazwy", input: payload({ name: undefined }), path: "name" },
    { why: "nazwa z samych spacji", input: payload({ name: "   " }), path: "name" },
    { why: "nazwa dłuższa niż 200", input: payload({ name: "x".repeat(201) }), path: "name" },
    { why: "brak adresu e-mail", input: payload({ email: undefined }), path: "email" },
    { why: "adres bez małpy", input: payload({ email: "zglaszajacy.example.com" }), path: "email" },
    {
      why: "adres dłuższy niż 320",
      input: payload({ email: `${"a".repeat(310)}@example.com` }),
      path: "email",
    },
    { why: "brak treści", input: payload({ message: undefined }), path: "message" },
    { why: "treść z samych spacji", input: payload({ message: " \n\t " }), path: "message" },
    {
      why: "treść dłuższa niż 8000",
      input: payload({ message: "x".repeat(8001) }),
      path: "message",
    },
    { why: "brak pola zgody", input: payload({ consent: undefined }), path: "consent" },
    { why: "zgoda jako napis", input: payload({ consent: "tak" }), path: "consent" },
    { why: "brak języka", input: payload({ lang: undefined }), path: "lang" },
    { why: "język poza listą", input: payload({ lang: "de" }), path: "lang" },
    {
      why: "imię dłuższe niż 100",
      input: payload({ firstName: "x".repeat(101) }),
      path: "firstName",
    },
    {
      why: "nazwisko dłuższe niż 100",
      input: payload({ lastName: "x".repeat(101) }),
      path: "lastName",
    },
    { why: "telefon dłuższy niż 40", input: payload({ phone: "1".repeat(41) }), path: "phone" },
    { why: "firma dłuższa niż 200", input: payload({ company: "x".repeat(201) }), path: "company" },
    { why: "temat dłuższy niż 300", input: payload({ subject: "x".repeat(301) }), path: "subject" },
    { why: "źródło dłuższe niż 500", input: payload({ source: "x".repeat(501) }), path: "source" },
    { why: "formId dłuższy niż 120", input: payload({ formId: "x".repeat(121) }), path: "formId" },
    {
      why: "formName dłuższy niż 200",
      input: payload({ formName: "x".repeat(201) }),
      path: "formName",
    },
    {
      why: "pageUrl dłuższy niż 2000",
      input: payload({ pageUrl: "x".repeat(2001) }),
      path: "pageUrl",
    },
    {
      why: "referer dłuższy niż 2000",
      input: payload({ referer: "x".repeat(2001) }),
      path: "referer",
    },
    {
      why: "więcej niż 10 zgód",
      input: payload({
        consents: Array.from({ length: 11 }, (_, i) => ({ key: `k${i}`, text: "t" })),
      }),
      path: "consents",
    },
    {
      why: "zgoda bez klucza",
      input: payload({ consents: [{ key: "  ", text: "treść" }] }),
      path: "consents.0.key",
    },
    {
      why: "zgoda bez treści",
      input: payload({ consents: [{ key: "marketing", text: "" }] }),
      path: "consents.0.text",
    },
    {
      why: "wersja zgody dłuższa niż 32",
      input: payload({ consents: [{ key: "m", text: "t", version: "v".repeat(33) }] }),
      path: "consents.0.version",
    },
    {
      why: "język zgody dłuższy niż 8",
      input: payload({ consents: [{ key: "m", text: "t", lang: "pl-PL-x-long" }] }),
      path: "consents.0.lang",
    },
    {
      why: "więcej niż 20 pól wymaganych",
      input: payload({ requiredFields: Array.from({ length: 21 }, (_, i) => `f${i}`) }),
      path: "requiredFields",
    },
    {
      why: "nazwa pola wymaganego dłuższa niż 64",
      input: payload({ requiredFields: ["x".repeat(65)] }),
      path: "requiredFields.0",
    },
    {
      why: "wartość pola hybrydowego dłuższa niż 500",
      input: payload({ custom: { linkedin: "x".repeat(501) } }),
      path: "custom.linkedin",
    },
  ];

  it.each(REJECTED)("odrzuca wejście: $why", ({ input, path }) => {
    expect(rejectedPaths(input)).toContain(path);
  });

  const ACCEPTED: ReadonlyArray<{ why: string; input: Record<string, unknown> }> = [
    { why: "nazwa o długości dokładnie 200", input: { name: "x".repeat(200) } },
    { why: "treść o długości dokładnie 8000", input: { message: "x".repeat(8000) } },
    { why: "telefon o długości dokładnie 40", input: { phone: "1".repeat(40) } },
    // Granica GÓRNA, a nie pusta lista: `consents: []` przechodziłoby schemat
    // trywialnie i nie mówiłoby nic o limicie `.max(10)` / `.max(20)`.
    {
      why: "dokładnie 10 zgód",
      input: {
        consents: Array.from({ length: 10 }, (_, i) => ({ key: `zgoda-${i}`, text: `Treść ${i}` })),
      },
    },
    {
      why: "dokładnie 20 pól wymaganych",
      input: { requiredFields: Array.from({ length: 20 }, (_, i) => `pole${i}`) },
    },
    { why: "pusta lista zgód (pole opcjonalne)", input: { consents: [] } },
    { why: "brak zgody (`consent: false`) - schemat tego NIE blokuje", input: { consent: false } },
    { why: "język angielski", input: { lang: "en" } },
  ];

  it.each(ACCEPTED)("przyjmuje wejście: $why", ({ input }) => {
    expect(() => validateServerFnInput(submitContactMessage, payload(input))).not.toThrow();
  });

  it("obcina białe znaki w adresie i nazwie PRZED zapisem", () => {
    const parsed = validateServerFnInput(
      submitContactMessage,
      payload({ email: `  ${PII.senderEmail}  `, name: `  ${PII.senderName}  ` }),
    );
    expect(fieldOf(parsed, "email")).toBe(PII.senderEmail);
    expect(fieldOf(parsed, "name")).toBe(PII.senderName);
  });

  it("brak zgody przechodzi schemat, ale politykę pól przechodzi jako pusta wartość", async () => {
    // `consent: false` jest dla Zoda poprawne (pole jest booleanem, nie
    // literałem `true`). Egzekwuje je dopiero polityka pól najemcy, do której
    // handler wysyła `consent: ""`. To jest cała obrona zgody na tej warstwie.
    planHappyPath();
    await submit({ consent: false });
    const call = h.rpcCalls.find((entry) => entry.name === "enforce_form_field_policy");
    expect(fieldOf(fieldOf(call?.args, "_payload"), "consent")).toBe("");
    expect(fieldOf(insertedRow(), "consent")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 3. PRZYPIĘCIE DO NAJEMCY.
// ---------------------------------------------------------------------------

describe("formularz kontaktowy - najemca przeglądanego hosta", () => {
  it("przypina zgłoszenie do najemcy hosta, a nie do najemcy domyślnego", async () => {
    planHappyPath();
    const result = await submit();
    expect(h.resolvedHosts).toEqual(["kontakt.example.org"]);
    expect(fieldOf(insertedRow(), "tenant_id")).toBe(IDS.tenant);
    expect(result.id).toBe(IDS.message);
  });

  it("nierozwiązany host przerywa pracę PRZED jakimkolwiek zapisem i przed RPC", async () => {
    h.hostTenantId = null;
    expect(await rejection()).toBe("tenant unresolved");
    expect(db().chains).toEqual([]);
    expect(h.rpcCalls).toEqual([]);
    expect(h.rateLimitCalls).toEqual([]);
    expect(h.fetchCalls).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 4. POLITYKA PÓL WYMAGANYCH.
// ---------------------------------------------------------------------------

describe("formularz kontaktowy - polityka pól wymaganych", () => {
  it("pyta politykę najemcy o formularz `contact_form` z pełnym ładunkiem", async () => {
    planHappyPath();
    await submit({ firstName: "Imię", lastName: "Nazwisko", phone: PII.senderPhone });
    const call = h.rpcCalls[0];
    expect(call.name).toBe("enforce_form_field_policy");
    expect(fieldOf(call.args, "_tenant")).toBe(IDS.tenant);
    expect(fieldOf(call.args, "_form_type")).toBe("contact_form");
    expect(fieldOf(call.args, "_payload")).toEqual({
      firstName: "Imię",
      lastName: "Nazwisko",
      email: PII.senderEmail,
      phone: PII.senderPhone,
      company: "",
      subject: "",
      message: "Poproszę o kontakt w sprawie współpracy.",
      consent: "1",
    });
  });

  it("naruszenie podłogi najemcy przerywa pracę PRZED limitem i zapisem", async () => {
    h.rpcData.enforce_form_field_policy = ["required:phone", "required:company"];
    expect(await rejection()).toBe("policy_violation:required:phone,required:company");
    expect(h.rateLimitCalls).toEqual([]);
    expect(db().chains).toEqual([]);
  });

  it("pole wymagane zadeklarowane przez widget DOKŁADA naruszenie", async () => {
    // Klient może politykę tylko ZACIEŚNIĆ - nigdy rozluźnić.
    expect(await rejection({ requiredFields: ["phone"] })).toBe("policy_violation:required:phone");
  });

  it("nazwa pola nieznana ładunkowi polityki też jest naruszeniem", async () => {
    expect(await rejection({ requiredFields: ["nieistniejace"] })).toBe(
      "policy_violation:required:nieistniejace",
    );
  });

  it("wypełnione pole zadeklarowane przez widget przechodzi", async () => {
    planHappyPath();
    await expect(submit({ requiredFields: ["phone"], phone: PII.senderPhone })).resolves.toEqual(
      expect.objectContaining({ ok: true }),
    );
  });

  it("powtórzone naruszenie jest w komunikacie RAZ (deduplikacja)", async () => {
    h.rpcData.enforce_form_field_policy = ["required:phone"];
    expect(await rejection({ requiredFields: ["phone", "phone"] })).toBe(
      "policy_violation:required:phone",
    );
  });

  it("awaria RPC polityki NIE blokuje zgłoszenia - jest logowana i praca idzie dalej", async () => {
    // Fail-open jest tu decyzją: awaria bazy nie może zamknąć jedynego kanału
    // kontaktu. Cena: przy awarii RPC podłoga najemcy nie działa.
    h.rpcError.enforce_form_field_policy = "policy rpc down";
    planHappyPath();
    await expect(submit()).resolves.toEqual(expect.objectContaining({ ok: true }));
    expect(console.error).toHaveBeenCalledWith("[contact] policy check failed", {
      message: "policy rpc down",
    });
  });

  it("odpowiedź polityki, która nie jest listą, jest traktowana jak brak naruszeń", async () => {
    h.rpcData.enforce_form_field_policy = "coś nieoczekiwanego";
    planHappyPath();
    await expect(submit()).resolves.toEqual(expect.objectContaining({ ok: true }));
  });
});

// ---------------------------------------------------------------------------
// 5. ZAPIS ZGŁOSZENIA.
// ---------------------------------------------------------------------------

describe("formularz kontaktowy - zapis zgłoszenia", () => {
  it("zapisuje pełny wiersz `contact_messages` w oczekiwanym kształcie", async () => {
    planHappyPath();
    h.request = request({ "cf-connecting-ip": PII.cloudflareIp, "user-agent": "TestAgent/1.0" });

    await submit({
      firstName: "Imię",
      lastName: "Nazwisko",
      phone: PII.senderPhone,
      company: PII.senderCompany,
      subject: "Współpraca",
      newsletterOptIn: false,
      source: "/kontakt",
      formId: "widget-1",
      formName: "Formularz kontaktowy",
      pageUrl: `${SITE_ORIGIN}/kontakt`,
      referer: `${SITE_ORIGIN}/`,
      consents: [{ key: "privacy", text: "Zapoznałem się z polityką", version: "1.0" }],
    });

    expect(insertedRow()).toEqual({
      tenant_id: IDS.tenant,
      name: PII.senderName,
      first_name: "Imię",
      last_name: "Nazwisko",
      email: PII.senderEmail,
      phone: PII.senderPhone,
      company: PII.senderCompany,
      subject: "Współpraca",
      message: "Poproszę o kontakt w sprawie współpracy.",
      consent: true,
      lang: "pl",
      // SECURITY: adresat powiadomienia NIGDY nie pochodzi z wejścia - kolumna
      // zostaje pusta, a adres bierze się z `contact_form_settings`.
      recipient: null,
      newsletter_opt_in: false,
      source: "/kontakt",
      form_id: "widget-1",
      form_name: "Formularz kontaktowy",
      page_url: `${SITE_ORIGIN}/kontakt`,
      referer: `${SITE_ORIGIN}/`,
      ip: PII.cloudflareIp,
      user_agent: "TestAgent/1.0",
      consents: [{ key: "privacy", text: "Zapoznałem się z polityką", version: "1.0" }],
      custom: {},
      status: "new",
    });
    expect(chainWith("contact_messages", "insert").has("single")).toBe(true);
  });

  it("pola nieobecne w zgłoszeniu lądują jako NULL, a nie pusty napis", async () => {
    planHappyPath();
    const row = insertedRow.bind(null);
    await submit();
    for (const key of ["first_name", "last_name", "phone", "company", "subject", "source"]) {
      expect(fieldOf(row(), key), `pole ${key}`).toBeNull();
    }
    expect(fieldOf(row(), "consents")).toEqual([]);
    expect(fieldOf(row(), "newsletter_opt_in")).toBe(false);
  });

  it("awaria zapisu przerywa pracę - żadnej poczty i żadnego CRM-u", async () => {
    db().setResponse("contact_messages", fail("null value in column violates not-null"));
    expect(await rejection()).toBe("null value in column violates not-null");
    expect(h.fetchCalls).toEqual([]);
    expect(h.rpcCalls.map((call) => call.name)).toEqual(["enforce_form_field_policy"]);
  });

  it("zapis bez błędu, ale bez wiersza, też przerywa pracę", async () => {
    // PostgREST potrafi oddać `data: null, error: null` (np. gdy RETURNING nic
    // nie dał). Bez tej gałęzi handler poszedłby dalej z `inserted.id`.
    db().setResponse("contact_messages", ok(null));
    expect(await rejection()).toBe("insert failed");
    expect(h.fetchCalls).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 6. NAGŁÓWKI ŻĄDANIA (IP, USER-AGENT) I ORIGIN.
// ---------------------------------------------------------------------------

describe("formularz kontaktowy - odczyt nagłówków", () => {
  const IP_CASES: ReadonlyArray<{ why: string; headers: Record<string, string>; ip: string }> = [
    {
      why: "`cf-connecting-ip` wygrywa z listą proxy",
      headers: {
        "cf-connecting-ip": PII.cloudflareIp,
        "x-forwarded-for": `${PII.proxyFirstHopIp}, ${PII.realIp}`,
        "x-real-ip": PII.realIp,
      },
      ip: PII.cloudflareIp,
    },
    {
      why: "bez Cloudflare bierzemy PIERWSZY wpis z `x-forwarded-for`",
      headers: {
        "x-forwarded-for": `${PII.proxyFirstHopIp}, ${PII.realIp}`,
        "x-real-ip": PII.realIp,
      },
      ip: PII.proxyFirstHopIp,
    },
    {
      why: "`x-real-ip` jest ostatnią deską ratunku",
      headers: { "x-real-ip": PII.realIp },
      ip: PII.realIp,
    },
  ];

  it.each(IP_CASES)("kolejność nośników adresu: $why", async ({ headers, ip }) => {
    planHappyPath();
    h.request = request(headers);
    await submit();
    expect(fieldOf(insertedRow(), "ip")).toBe(ip);
    expect(h.rateLimitCalls[0].subjectId).toBe(ip);
  });

  it("puste `x-forwarded-for` nie udaje adresu", async () => {
    planHappyPath();
    h.request = request({ "x-forwarded-for": "" });
    await submit();
    expect(fieldOf(insertedRow(), "ip")).toBeNull();
  });

  it("brak kontekstu żądania nie wywraca zgłoszenia - IP i UA są NULL", async () => {
    planHappyPath();
    h.requestThrows = true;
    await submit();
    expect(fieldOf(insertedRow(), "ip")).toBeNull();
    expect(fieldOf(insertedRow(), "user_agent")).toBeNull();
  });

  it("runtime bez żądania (`getRequest()` oddaje null) też nie wywraca zgłoszenia", async () => {
    planHappyPath();
    h.request = null;
    await submit();
    expect(fieldOf(insertedRow(), "ip")).toBeNull();
    expect(fieldOf(insertedRow(), "user_agent")).toBeNull();
  });

  it("adres IP NIE rozlewa się do pól nieprzeznaczonych na niego", async () => {
    // Wiersz zgłoszenia ma dokładnie jedno pole na adres. Wyciek adresu do
    // `source`, `page_url` czy treści wiadomości byłby wyciekiem przez ślad.
    planHappyPath();
    h.request = request({ "cf-connecting-ip": PII.cloudflareIp });
    await submit({ source: "/kontakt", pageUrl: `${SITE_ORIGIN}/kontakt` });
    const row = insertedRow();
    if (typeof row !== "object" || row === null) throw new Error("test: brak wiersza");
    for (const [key, value] of Object.entries(row)) {
      if (key === "ip") continue;
      expect(JSON.stringify(value ?? ""), `adres wyciekł do ${key}`).not.toContain(
        PII.cloudflareIp,
      );
    }
  });
});

// ---------------------------------------------------------------------------
// 7. OCHRONA PRZED NADUŻYCIEM.
// ---------------------------------------------------------------------------

describe("formularz kontaktowy - ochrona przed nadużyciem", () => {
  it("zamawia DWA niezależne limity: po adresie IP i po ADRESACIE poczty", async () => {
    planHappyPath();
    h.request = request({ "cf-connecting-ip": PII.cloudflareIp });
    await submit({ email: PII.senderEmailMixedCase });

    expect(h.rateLimitCalls).toEqual([
      {
        scope: "contact.submit",
        subjectId: PII.cloudflareIp,
        max: 5,
        windowMinutes: 10,
      },
      {
        // Limit po adresacie jest prawdziwą bramką przed bombardowaniem
        // skrzynki: trzyma się, choćby napastnik rotował adresy IP.
        scope: "contact.recipient",
        subjectId: PII.senderEmail,
        max: 3,
        windowMinutes: 60,
      },
    ]);
  });

  it("nieznane IP wpada do WSPÓLNEGO wiadra, a nie omija limitu", async () => {
    planHappyPath();
    h.request = request();
    await submit();
    expect(h.rateLimitCalls[0].subjectId).toBe("unknown-ip");
  });

  it("odmowa limitu IP przerywa pracę przed zapisem i przed pocztą", async () => {
    h.rateLimitDeny = ["contact.submit"];
    expect(await rejection()).toBe("rate_limited");
    expect(db().chains).toEqual([]);
    expect(h.fetchCalls).toEqual([]);
    // Limit adresata nie jest już nawet sprawdzany - odmowa wyprzedza pracę.
    expect(h.rateLimitCalls.map((call) => call.scope)).toEqual(["contact.submit"]);
  });

  it("odmowa limitu ADRESATA przerywa pracę, choć limit IP przeszedł", async () => {
    h.rateLimitDeny = ["contact.recipient"];
    expect(await rejection()).toBe("rate_limited");
    expect(db().chains).toEqual([]);
    expect(h.fetchCalls).toEqual([]);
    expect(h.rateLimitCalls.map((call) => call.scope)).toEqual([
      "contact.submit",
      "contact.recipient",
    ]);
  });

  it("moduł NIE ma honeypota ani captchy - jedyną bramką jest limit", () => {
    // Ustalenie, nie zarzut: gdyby ktoś dołożył pole-pułapkę, ten test
    // przestanie być prawdą i trzeba będzie go świadomie zmienić.
    const parsed = validateServerFnInput(submitContactMessage, payload({ honeypot: "bot" }));
    expect(fieldOf(parsed, "honeypot")).toBeUndefined();
    expect(fieldOf(parsed, "captcha")).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 8. SYNCHRONIZACJA Z CRM.
// ---------------------------------------------------------------------------

describe("formularz kontaktowy - CRM", () => {
  it("przekazuje pola hybrydowe do pierwszorzędnych kolumn kontaktu", async () => {
    planHappyPath();
    await submit({
      firstName: "Imię",
      lastName: "Nazwisko",
      phone: PII.senderPhone,
      company: PII.senderCompany,
      source: "/zatrudniamy",
      custom: {
        position: "Analityk",
        linkedin: "linkedin.example.com/in/ktos",
        country: "PL",
      },
    });
    const call = h.rpcCalls.find((entry) => entry.name === "crm_upsert_from_form");
    expect(fieldOf(call?.args, "_tenant")).toBe(IDS.tenant);
    expect(fieldOf(call?.args, "_email")).toBe(PII.senderEmail);
    expect(fieldOf(call?.args, "_position")).toBe("Analityk");
    expect(fieldOf(call?.args, "_linkedin")).toBe("linkedin.example.com/in/ktos");
    expect(fieldOf(call?.args, "_country")).toBe("PL");
    expect(fieldOf(call?.args, "_source")).toBe("contact-form:/zatrudniamy");
  });

  it("bez pola `source` znacznik pochodzenia jest samym `contact-form`", async () => {
    planHappyPath();
    await submit();
    const call = h.rpcCalls.find((entry) => entry.name === "crm_upsert_from_form");
    expect(fieldOf(call?.args, "_source")).toBe("contact-form");
    expect(fieldOf(call?.args, "_custom")).toEqual({});
  });

  it("zgłoszenie rekrutacyjne stempluje kontakt jako `careers`, nie nadpisując mocniejszych", async () => {
    planHappyPath();
    await submit({ formId: CAREERS_FORM_ID });
    const chain = chainWith("crm_leads", "update");
    expect(chain.argsOf("update")?.[0]).toEqual({ source_type: "careers" });
    expect(chain.argsOf("eq")).toEqual(["id", IDS.lead]);
    // `.in(...)` jest tu obroną: płacący subskrybent, który składa CV, nie
    // traci silniejszej klasyfikacji.
    expect(chain.argsOf("in")).toEqual(["source_type", ["manual", "contact_form", "newsletter"]]);
  });

  it("zwykły formularz NIE stempluje kontaktu", async () => {
    planHappyPath();
    await submit({ formId: "widget-1" });
    expect(db().chainsFor("crm_leads")).toEqual([]);
  });

  it("brak identyfikatora kontaktu z RPC blokuje stempel rekrutacyjny", async () => {
    h.rpcData.crm_upsert_from_form = null;
    planHappyPath();
    await submit({ formId: CAREERS_FORM_ID });
    expect(db().chainsFor("crm_leads")).toEqual([]);
  });

  it("awaria CRM jest logowana, ale zgłoszenie i poczta idą dalej", async () => {
    h.rpcError.crm_upsert_from_form = "crm down";
    planHappyPath({ default_recipient: PII.adminInbox });
    const result = await submit();
    expect(result.ok).toBe(true);
    expect(sentTo()).toEqual([PII.senderEmail, PII.adminInbox]);
    expect(console.error).toHaveBeenCalledWith("[contact] crm sync failed", {
      message: "crm down",
    });
  });

  it("awaria stempla rekrutacyjnego jest logowana, a nie podnoszona", async () => {
    planHappyPath();
    db().setResponse("crm_leads", fail("update denied"));
    await expect(submit({ formId: CAREERS_FORM_ID })).resolves.toEqual(
      expect.objectContaining({ ok: true }),
    );
    expect(console.error).toHaveBeenCalledWith(
      "[contact] careers source_type stamp failed",
      expect.objectContaining({ message: "update denied" }),
    );
  });

  it("RZUT z warstwy CRM nie wywraca zgłoszenia", async () => {
    h.rpcThrows = ["crm_upsert_from_form"];
    planHappyPath();
    await expect(submit()).resolves.toEqual(expect.objectContaining({ ok: true }));
    expect(console.error).toHaveBeenCalledWith("[contact] crm sync threw", expect.any(Error));
  });
});

// ---------------------------------------------------------------------------
// 8b. POLA HYBRYDOWE: ŚCIEŻKA CV I LINK.
// ---------------------------------------------------------------------------

describe("formularz kontaktowy - sanityzacja pól hybrydowych", () => {
  const VALID_CV_PATH = `${IDS.tenant}/uploads/2026-03-10/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.pdf`;

  it("ścieżka CV w dozwolonym kształcie przechodzi (po obcięciu spacji)", async () => {
    planHappyPath();
    await submit({ custom: { cv_path: `  ${VALID_CV_PATH}  `, cv_file_name: "cv.pdf" } });
    expect(fieldOf(insertedRow(), "custom")).toEqual({
      cv_path: VALID_CV_PATH,
      cv_file_name: "cv.pdf",
    });
  });

  it("ścieżka CV poza kształtem jest ODRZUCANA wraz z nazwą pliku", async () => {
    // SECURITY: panel podpisuje ścieżkę bez pytania, więc dowolna ścieżka
    // z wejścia oznaczałaby podpisany link do CV innego kandydata.
    planHappyPath();
    await submit({
      custom: {
        cv_path: "../../inny-najemca/uploads/2026-03-10/tajne.pdf",
        cv_file_name: "cv.pdf",
      },
    });
    expect(fieldOf(insertedRow(), "custom")).toEqual({});
    expect(console.warn).toHaveBeenCalledWith("[contact] rejected cv_path shape");
  });

  it("link do CV bez schematu jest normalizowany do bezwzględnego adresu", async () => {
    planHappyPath();
    await submit({ custom: { cv_url: "linkedin.example.com/in/ktos" } });
    expect(fieldOf(fieldOf(insertedRow(), "custom"), "cv_url")).toBe(
      "https://linkedin.example.com/in/ktos",
    );
  });

  it("link do CV, którego nie da się znormalizować, jest USUWANY", async () => {
    planHappyPath();
    await submit({ custom: { cv_url: "nie-adres" } });
    expect(fieldOf(insertedRow(), "custom")).toEqual({});
  });

  it("to samo pole hybrydowe trafia do skrzynki i do CRM (bez rozjazdu)", async () => {
    planHappyPath();
    await submit({ custom: { linkedin: "linkedin.example.com/in/ktos" } });
    const call = h.rpcCalls.find((entry) => entry.name === "crm_upsert_from_form");
    expect(fieldOf(call?.args, "_custom")).toEqual(fieldOf(insertedRow(), "custom"));
  });
});

// ---------------------------------------------------------------------------
// 9. POCZTA: ADRESACI, TREŚĆ, KOLEJNOŚĆ.
// ---------------------------------------------------------------------------

describe("formularz kontaktowy - autoodpowiedź i powiadomienie", () => {
  it("wysyła NAJPIERW autoodpowiedź do nadawcy, POTEM powiadomienie do redakcji", async () => {
    planHappyPath({ default_recipient: PII.adminInbox });
    await submit();
    expect(sentTo()).toEqual([PII.senderEmail, PII.adminInbox]);
  });

  it("obie wiadomości idą przez bramkę konektora z fałszywymi kluczami", async () => {
    planHappyPath({ default_recipient: PII.adminInbox });
    await submit();
    for (const mail of sentEmails()) {
      expect(mail.url).toBe(GATEWAY);
      expect(mail.authorization).toBe(`Bearer ${FAKE_KEYS.lovable}`);
      expect(mail.connectionKey).toBe(FAKE_KEYS.resend);
    }
  });

  it("autoodpowiedź niesie temat i treść domyślną w języku zgłoszenia (PL)", async () => {
    planHappyPath();
    await submit({ lang: "pl" });
    const [reply] = sentEmails();
    expect(reply.subject).toBe("Dziękujemy za wiadomość");
    expect(reply.html).toContain(`Cześć ${PII.senderName},`);
    expect(reply.html).toContain("Dziękujemy za kontakt");
    expect(reply.html).toContain("Twoja wiadomość");
  });

  it("autoodpowiedź przełącza język na angielski", async () => {
    planHappyPath();
    await submit({ lang: "en" });
    const [reply] = sentEmails();
    expect(reply.subject).toBe("Thanks for reaching out");
    expect(reply.html).toContain(`Hi ${PII.senderName},`);
    expect(reply.html).toContain("Your message");
  });

  it("treść autoodpowiedzi da się nadpisać z `contact_form_settings` per język", async () => {
    planHappyPath({
      auto_reply_subject_pl: "Mamy Twoje zgłoszenie",
      auto_reply_body_pl: "Odezwiemy się w ciągu dwóch dni.",
    });
    await submit({ lang: "pl" });
    const [reply] = sentEmails();
    expect(reply.subject).toBe("Mamy Twoje zgłoszenie");
    expect(reply.html).toContain("Odezwiemy się w ciągu dwóch dni.");
  });

  it("powiadomienie dla redakcji niesie metryczkę zgłoszenia", async () => {
    planHappyPath({ default_recipient: PII.adminInbox });
    // Odpowiedzi warstwy newslettera MUSZĄ być zaplanowane PRZED zgłoszeniem:
    // `newsletterOptIn: true` sprawia, że handler pyta o nie w tym samym
    // przebiegu. Zaplanowane po fakcie nie zdążyłyby na nic, a atrapa oddałaby
    // „brak zaplanowanej odpowiedzi”, czyli test milcząco badałby ścieżkę
    // awaryjną zamiast tej, o której mówi jego nazwa.
    planNewsletter();
    await submit({
      subject: "Współpraca",
      phone: PII.senderPhone,
      company: PII.senderCompany,
      source: "/kontakt",
      newsletterOptIn: true,
    });
    const notice = sentEmails()[1];
    expect(notice.subject).toBe("[Contact] Współpraca");
    for (const fragment of [
      PII.senderName,
      PII.senderEmail,
      PII.senderPhone,
      PII.senderCompany,
      "/kontakt",
      "Newsletter opt-in",
    ]) {
      expect(notice.html, `brak „${fragment}” w powiadomieniu`).toContain(fragment);
    }
  });

  it("bez tematu powiadomienie dostaje etykietę zastępczą w języku zgłoszenia", async () => {
    planHappyPath({ default_recipient: PII.adminInbox });
    await submit({ lang: "en" });
    expect(sentEmails()[1].subject).toBe("[Contact] New message");
  });

  it("wiersze opcjonalne pojawiają się TYLKO, gdy zgłoszenie je niesie", async () => {
    planHappyPath({ default_recipient: PII.adminInbox });
    await submit();
    const notice = sentEmails()[1];
    for (const label of ["Phone", "Company", "Subject", "Page", "Newsletter opt-in"]) {
      expect(notice.html, `nieoczekiwany wiersz ${label}`).not.toContain(`>${label}<`);
    }
    expect(notice.html).toContain(">Consent<");
  });

  it("powiadomienie mówi WPROST, gdy zgody NIE udzielono", async () => {
    // RODO: wiersz „Consent” jest jedynym miejscem, z którego operator dowiaduje
    // się, na jakiej podstawie wolno mu odpisać. `consent: false` przechodzi
    // schemat (patrz sekcja 2), więc powiadomienie MUSI nieść „no”, a nie
    // pomijać wiersz - milczenie operator przeczytałby jako zgodę.
    planHappyPath({ default_recipient: PII.adminInbox });
    await submit({ consent: false });
    const notice = sentEmails()[1];
    expect(notice.html).toContain(">no<");
    expect(notice.html).not.toContain(">yes<");
  });

  it("treść wiadomości jest ESCAPE'OWANA w obu wiadomościach", async () => {
    // Skrzynka operatora renderuje HTML z pola, które przyszło od anonima.
    planHappyPath({ default_recipient: PII.adminInbox });
    await submit({ message: `<script>alert("x")</script> & 'koniec'`, name: `<b>Nazwa</b>` });
    for (const mail of sentEmails()) {
      expect(mail.html).not.toContain("<script>");
      expect(mail.html).toContain("&lt;script&gt;");
      expect(mail.html).toContain("&amp;");
      expect(mail.html).toContain("&#39;");
      expect(mail.html).toContain("&lt;b&gt;Nazwa&lt;/b&gt;");
    }
  });

  it("adres `from` składa się z nazwy i adresu z ustawień najemcy", async () => {
    planHappyPath({ from_address: PII.fromAddress, from_name: "Redakcja" });
    await submit();
    expect(sentEmails()[0].from).toBe(`Redakcja <${PII.fromAddress}>`);
  });

  it("sam adres bez nazwy jest używany wprost", async () => {
    planHappyPath({ from_address: PII.fromAddress });
    await submit();
    expect(sentEmails()[0].from).toBe(PII.fromAddress);
  });

  it("bez ustawień najemcy `from` spada do wartości domyślnej modułu", async () => {
    planHappyPath();
    await submit();
    expect(sentEmails()[0].from).toBe("New European Strategies <onboarding@resend.dev>");
  });

  it("wyłączona autoodpowiedź nie jest wysyłana, powiadomienie owszem", async () => {
    planHappyPath({ auto_reply_enabled: false, default_recipient: PII.adminInbox });
    const result = await submit();
    expect(sentTo()).toEqual([PII.adminInbox]);
    expect(result.emails.autoReply).toBe(false);
    expect(result.emails.admin).toBe(true);
  });

  it("wyłączone powiadomienie nie jest wysyłane, autoodpowiedź owszem", async () => {
    planHappyPath({ notify_admin_enabled: false, default_recipient: PII.adminInbox });
    const result = await submit();
    expect(sentTo()).toEqual([PII.senderEmail]);
    expect(result.emails.admin).toBe(false);
  });

  it("BRAK skonfigurowanego adresata to brak powiadomienia (bez otwartego przekaźnika)", async () => {
    // SECURITY: `recipient` nie jest częścią wejścia publicznego. Gdy najemca
    // nie ustawił skrzynki, powiadomienie po prostu nie ma dokąd pójść.
    planHappyPath({ notify_admin_enabled: true, default_recipient: null });
    const result = await submit();
    expect(sentTo()).toEqual([PII.senderEmail]);
    expect(result.emails.admin).toBe(false);
  });

  it("udana wysyłka stempluje zgłoszenie datą potwierdzenia (data bazowa)", async () => {
    planHappyPath({ default_recipient: PII.adminInbox });
    await submit();
    const chain = chainWith("contact_messages", "update");
    expect(chain.argsOf("update")?.[0]).toEqual({ confirmation_sent_at: BASE_ISO });
    expect(chain.argsOf("eq")).toEqual(["id", IDS.message]);
  });

  it("odmowa bramki poczty (HTTP 4xx) daje `false` i log z kodem odpowiedzi", async () => {
    h.fetchScript = ["http-error"];
    planHappyPath();
    const result = await submit();
    expect(result.emails.autoReply).toBe(false);
    expect(console.error).toHaveBeenCalledWith(
      "[contact] resend error",
      422,
      "Resend: domain not verified",
    );
  });

  it("nieczytelne ciało odpowiedzi błędu nie wywraca handlera", async () => {
    h.fetchScript = ["unreadable-error"];
    planHappyPath();
    const result = await submit();
    expect(result.emails.autoReply).toBe(false);
    expect(console.error).toHaveBeenCalledWith("[contact] resend error", 502, "");
  });

  it("RZUT transportu (bramka nieosiągalna) daje `false`, a zgłoszenie zostaje", async () => {
    h.fetchScript = ["throw"];
    planHappyPath();
    const result = await submit();
    expect(result.ok).toBe(true);
    expect(result.emails.autoReply).toBe(false);
    expect(console.error).toHaveBeenCalledWith("[contact] email send failed", expect.any(Error));
    expect(insertedRow()).not.toBeUndefined();
  });

  it("gdy ŻADNA wiadomość nie wyszła, znacznik potwierdzenia NIE jest stawiany", async () => {
    h.fetchScript = ["throw", "throw"];
    planHappyPath({ default_recipient: PII.adminInbox });
    await submit();
    expect(
      db()
        .chainsFor("contact_messages")
        .filter((chain) => chain.has("update")),
    ).toEqual([]);
  });

  it("fałszywy klucz API NIE wycieka do treści ani tematu wiadomości", async () => {
    planHappyPath({ default_recipient: PII.adminInbox });
    await submit();
    for (const mail of sentEmails()) {
      expect(mail.subject).not.toContain(FAKE_KEYS.resend);
      expect(mail.html).not.toContain(FAKE_KEYS.resend);
      expect(mail.html).not.toContain(FAKE_KEYS.lovable);
    }
  });
});

// ---------------------------------------------------------------------------
// 10. CICHA DEGRADACJA POCZTY - RDZEŃ TEGO PLIKU.
// ---------------------------------------------------------------------------

describe("formularz kontaktowy - CICHA DEGRADACJA POCZTY", () => {
  const MISSING: ReadonlyArray<{ why: string; key: "LOVABLE_API_KEY" | "RESEND_API_KEY" }> = [
    { why: "brak `LOVABLE_API_KEY`", key: "LOVABLE_API_KEY" },
    { why: "brak `RESEND_API_KEY` (konektor Resend nieskonfigurowany)", key: "RESEND_API_KEY" },
  ];

  it.each(MISSING)(
    "$why: wiadomość ZAPISANA, wysyłki BRAK, a wynik NIESIE sygnał",
    async ({ key }) => {
      vi.stubEnv(key, undefined);
      planHappyPath({ default_recipient: PII.adminInbox });

      const result = await submit();

      // 1) ZAPISANA - formularz nie pęka, zgłoszenie jest w skrzynce.
      expect(fieldOf(insertedRow(), "email")).toBe(PII.senderEmail);
      expect(result.id).toBe(IDS.message);
      // 2) BRAK WYSYŁKI - transport nie został nawet tknięty.
      expect(h.fetchCalls).toEqual([]);
      // 3) SYGNAŁ - wynik funkcji mówi, że ani jedna wiadomość nie wyszła.
      expect(result.emails.autoReply).toBe(false);
      expect(result.emails.admin).toBe(false);
      // 4) I nie kłamie znacznikiem „potwierdzenie wysłane”.
      expect(
        db()
          .chainsFor("contact_messages")
          .filter((chain) => chain.has("update")),
      ).toEqual([]);
    },
  );

  it("brak OBU kluczy zachowuje się identycznie (jeden warunek, nie dwa)", async () => {
    vi.stubEnv("LOVABLE_API_KEY", undefined);
    vi.stubEnv("RESEND_API_KEY", undefined);
    planHappyPath({ default_recipient: PII.adminInbox });
    const result = await submit();
    expect(h.fetchCalls).toEqual([]);
    expect(result.emails).toEqual({ autoReply: false, admin: false, newsletter: null });
  });

  it("cisza dotyczy TAKŻE potwierdzenia newslettera, choć zapis subskrybenta zostaje", async () => {
    // Najgorszy z możliwych stanów: subskrybent wisi w `pending` z tokenem,
    // którego nikt nigdy nie dostał. Bez sygnału w wyniku nikt tego nie widzi.
    vi.stubEnv("RESEND_API_KEY", undefined);
    planHappyPath();
    planNewsletter();
    const result = await submit({ newsletterOptIn: true });

    expect(h.fetchCalls).toEqual([]);
    expect(fieldOf(subscriberRow(), "status")).toBe("pending");
    expect(result.emails.newsletter).toEqual({
      ok: false,
      status: "pending",
      error: "email_not_configured",
    });
  });

  it("sygnał nie jest tożsamy z awarią zgłoszenia - `ok` pozostaje prawdą", async () => {
    vi.stubEnv("LOVABLE_API_KEY", undefined);
    planHappyPath({ default_recipient: PII.adminInbox });
    const result = await submit();
    // To jest ta część, którą MUSI zobaczyć wywołujący: sukces zapisu i
    // porażka poczty są w wyniku ROZDZIELONE.
    expect(result.ok).toBe(true);
    expect([result.emails.autoReply, result.emails.admin]).toEqual([false, false]);
  });
});

// ---------------------------------------------------------------------------
// 11. NEWSLETTER: DOUBLE OPT-IN.
// ---------------------------------------------------------------------------

describe("formularz kontaktowy - newsletter i double opt-in", () => {
  it("bez zgody na newsletter double opt-in NIE startuje", async () => {
    planHappyPath();
    const result = await submit();
    expect(result.emails.newsletter).toBeNull();
    expect(db().chainsFor("newsletter_settings")).toEqual([]);
    expect(db().chainsFor("newsletter_subscribers")).toEqual([]);
  });

  it("ze zgodą na newsletter startuje: subskrybent `pending` + token + 48 h", async () => {
    planHappyPath();
    planNewsletter();
    const result = await submit({ newsletterOptIn: true, lang: "en" });

    const row = subscriberRow();
    expect(fieldOf(row, "email")).toBe(PII.senderEmail);
    expect(fieldOf(row, "tenant_id")).toBe(IDS.tenant);
    expect(fieldOf(row, "display_name")).toBe(PII.senderName);
    expect(fieldOf(row, "language")).toBe("en");
    expect(fieldOf(row, "status")).toBe("pending");
    expect(fieldOf(row, "source")).toBe("contact-form");
    expect(fieldOf(row, "confirmation_expires_at")).toBe(DOI_EXPIRES_ISO);
    expect(chainWith("newsletter_subscribers", "upsert").argsOf("upsert")?.[1]).toEqual({
      onConflict: "tenant_id,email",
    });
    expect(result.emails.newsletter).toEqual({ ok: true, status: "pending" });
  });

  it("token jest losowy (64 znaki hex) i to DOKŁADNIE on stoi w linku", async () => {
    planHappyPath();
    planNewsletter();
    await submit({ newsletterOptIn: true });

    const token = textField(subscriberRow(), "confirmation_token");
    expect(token).toMatch(/^[0-9a-f]{64}$/);
    const doi = sentEmails().at(-1);
    expect(doi?.subject).toBe("Potwierdź zapis do newslettera");
    expect(doi?.html).toContain(
      `${SITE_ORIGIN}/api/public/newsletter/confirm?token=${encodeURIComponent(token)}`,
    );
  });

  it("dwa zgłoszenia dostają RÓŻNE tokeny", async () => {
    const tokens: string[] = [];
    for (let i = 0; i < 2; i += 1) {
      db().reset();
      h.fetchCalls = [];
      planHappyPath();
      planNewsletter();
      await submit({ newsletterOptIn: true });
      tokens.push(textField(subscriberRow(), "confirmation_token"));
    }
    expect(tokens[0]).not.toBe(tokens[1]);
  });

  it("adres subskrybenta jest zapisywany MAŁYMI literami (klucz unikalności)", async () => {
    planHappyPath();
    planNewsletter();
    await submit({ newsletterOptIn: true, email: PII.senderEmailMixedCase });
    expect(fieldOf(subscriberRow(), "email")).toBe(PII.senderEmail.toLowerCase());
    const select = db()
      .chainsFor("newsletter_subscribers")
      .find((chain) => chain.has("select"));
    expect(select?.calls.filter((call) => call.method === "eq").map((call) => call.args)).toEqual([
      ["tenant_id", IDS.tenant],
      ["email", PII.senderEmail.toLowerCase()],
    ]);
  });

  it("wiadomość DOI przełącza język na angielski", async () => {
    planHappyPath();
    planNewsletter();
    await submit({ newsletterOptIn: true, lang: "en" });
    const doi = sentEmails().at(-1);
    expect(doi?.subject).toBe("Confirm your newsletter subscription");
    expect(doi?.html).toContain("Confirm subscription");
    expect(doi?.html).toContain("48 hours");
  });

  it("DOI idzie na końcu - po autoodpowiedzi i powiadomieniu", async () => {
    planHappyPath({ default_recipient: PII.adminInbox });
    planNewsletter();
    await submit({ newsletterOptIn: true });
    expect(sentTo()).toEqual([PII.senderEmail, PII.adminInbox, PII.senderEmail]);
  });

  it("już potwierdzony subskrybent NIE jest resetowany do `pending`", async () => {
    planHappyPath();
    planNewsletter({ existing: { id: "sub-1", status: "subscribed" } });
    const result = await submit({ newsletterOptIn: true });
    expect(result.emails.newsletter).toEqual({ ok: true, status: "exists" });
    expect(
      db()
        .chainsFor("newsletter_subscribers")
        .filter((c) => c.has("upsert")),
    ).toEqual([]);
    expect(sentTo()).toEqual([PII.senderEmail]);
  });

  it("subskrybent w stanie `pending` dostaje NOWY token", async () => {
    planHappyPath();
    planNewsletter({ existing: { id: "sub-1", status: "pending" } });
    const result = await submit({ newsletterOptIn: true });
    expect(fieldOf(subscriberRow(), "status")).toBe("pending");
    expect(result.emails.newsletter).toEqual({ ok: true, status: "pending" });
  });

  const SINGLE_OPT_IN: ReadonlyArray<{
    why: string;
    newsletterSettings: Record<string, unknown> | null;
    contactSettings: Record<string, unknown> | null;
  }> = [
    {
      why: "wyłączony w `newsletter_settings.double_opt_in`",
      newsletterSettings: { double_opt_in: false, enabled: true },
      contactSettings: null,
    },
    {
      why: "wyłączony w `contact_form_settings.newsletter_double_optin`",
      newsletterSettings: null,
      contactSettings: { newsletter_double_optin: false },
    },
  ];

  it.each(SINGLE_OPT_IN)(
    "pojedynczy opt-in ($why): status `subscribed` od razu, bez wiadomości DOI",
    async ({ newsletterSettings, contactSettings }) => {
      planHappyPath(contactSettings);
      planNewsletter({ newsletterSettings });
      const result = await submit({ newsletterOptIn: true });

      expect(fieldOf(subscriberRow(), "status")).toBe("subscribed");
      expect(fieldOf(subscriberRow(), "confirmed_at")).toBe(BASE_ISO);
      expect(fieldOf(subscriberRow(), "confirmation_token")).toBeUndefined();
      expect(result.emails.newsletter).toEqual({ ok: true, status: "subscribed" });
      // Autoodpowiedź poszła, wiadomości potwierdzającej nie ma.
      expect(sentTo()).toEqual([PII.senderEmail]);
    },
  );

  it("awaria zapisu subskrybenta (DOI) wraca w wyniku i nie wysyła potwierdzenia", async () => {
    planHappyPath();
    planNewsletter({ upsert: fail("duplicate key value violates unique constraint") });
    const result = await submit({ newsletterOptIn: true });
    expect(result.emails.newsletter).toEqual({
      ok: false,
      error: "duplicate key value violates unique constraint",
    });
    expect(sentTo()).toEqual([PII.senderEmail]);
  });

  it("awaria zapisu subskrybenta (pojedynczy opt-in) też wraca w wyniku", async () => {
    planHappyPath();
    planNewsletter({
      newsletterSettings: { double_opt_in: false },
      upsert: fail("subscribers table locked"),
    });
    const result = await submit({ newsletterOptIn: true });
    expect(result.emails.newsletter).toEqual({ ok: false, error: "subscribers table locked" });
  });

  it("odmowa bramki przy wiadomości DOI zostawia subskrybenta w `pending` z błędem", async () => {
    h.fetchScript = ["ok", "http-error"];
    planHappyPath();
    planNewsletter();
    const result = await submit({ newsletterOptIn: true });
    expect(fieldOf(subscriberRow(), "status")).toBe("pending");
    expect(result.emails.newsletter).toEqual({
      ok: false,
      status: "pending",
      error: "Resend: domain not verified",
    });
  });
});

// ---------------------------------------------------------------------------
// 11b. ORIGIN LINKU POTWIERDZAJĄCEGO (bezpieczeństwo tokenu DOI).
// ---------------------------------------------------------------------------

describe("formularz kontaktowy - origin linku potwierdzającego", () => {
  it("IGNORUJE nagłówki `x-forwarded-*` - link nie może prowadzić na phishing", async () => {
    planHappyPath();
    planNewsletter();
    h.request = request(
      { "x-forwarded-host": "phishing.example.com", "x-forwarded-proto": "http" },
      `${SITE_ORIGIN}/kontakt`,
    );
    await submit({ newsletterOptIn: true });
    const doi = sentEmails().at(-1);
    expect(doi?.html).toContain(`${SITE_ORIGIN}/api/public/newsletter/confirm?token=`);
    expect(doi?.html).not.toContain("phishing.example.com");
  });

  const ENV_CASES: ReadonlyArray<{
    why: string;
    name: "PUBLIC_SITE_URL" | "SITE_URL" | "URL";
  }> = [
    { why: "PUBLIC_SITE_URL ma pierwszeństwo", name: "PUBLIC_SITE_URL" },
    { why: "SITE_URL jest drugim wyborem", name: "SITE_URL" },
    { why: "URL jest trzecim wyborem", name: "URL" },
  ];

  it.each(ENV_CASES)("$why (i obcina końcowe ukośniki)", async ({ name }) => {
    planHappyPath();
    planNewsletter();
    vi.stubEnv(name, "https://stala.example.org///");
    await submit({ newsletterOptIn: true });
    expect(sentEmails().at(-1)?.html).toContain(
      "https://stala.example.org/api/public/newsletter/confirm?token=",
    );
  });

  it("bez żądania i bez zmiennej origin jest PUSTY (link relatywny), a nie zmyślony", async () => {
    planHappyPath();
    planNewsletter();
    h.requestThrows = true;
    await submit({ newsletterOptIn: true });
    expect(sentEmails().at(-1)?.html).toContain('href="/api/public/newsletter/confirm?token=');
  });
});

// ---------------------------------------------------------------------------
// 12. DEFEKTY. Produkcji NIE naprawiamy - zgłaszamy.
// ---------------------------------------------------------------------------

describe("formularz kontaktowy - zgłoszone defekty", () => {
  it.fails(
    "DEFEKT: cicha degradacja poczty nie niesie POWODU - `false` znaczy pięć różnych rzeczy",
    async () => {
      // CO: `src/lib/contact.functions.ts:417-439` liczy `autoReplyResult`
      // i `adminResult` jako `{ ok, status?, error? }`, ale do wyniku funkcji
      // (linie 536-539) przepisuje WYŁĄCZNIE `.ok`. Powód - w tym literał
      // `"email_not_configured"` z linii 69 - jest wyrzucany.
      //
      // GDZIE: `contact.functions.ts:69` (powód powstaje),
      //        `contact.functions.ts:417` i `:430` (powód jest w zasięgu),
      //        `contact.functions.ts:536-539` (powód nie wychodzi).
      //
      // KONSEKWENCJA: `emails.autoReply === false` oznacza dziś JEDNOCZEŚNIE:
      // (1) poczta nieskonfigurowana (brak `LOVABLE_API_KEY`/`RESEND_API_KEY` -
      // awaria SYSTEMOWA, nie wychodzi NIC i nie wyjdzie do restartu z nowym
      // sekretem), (2) autoodpowiedź wyłączona przez najemcę (stan POPRAWNY),
      // (3) Resend odrzucił adres (awaria JEDNOSTKOWA), (4) bramka
      // nieosiągalna, (5) brak skonfigurowanego adresata. Widget po drugiej
      // stronie widzi te same `false` i - z braku powodu - nie może ani
      // zaalarmować operatora, ani odróżnić stanu poprawnego od awarii.
      // Ścieżka newslettera to samo pole `error` ODDAJE (linia 511), więc
      // asymetria jest w tym samym pliku, dwa akapity niżej.
      //
      // TEST DOWODZI ISTNIENIA DEFEKTU: pytamy wynik o powód i go nie ma.
      vi.stubEnv("RESEND_API_KEY", undefined);
      planHappyPath({ default_recipient: PII.adminInbox });
      const result = await submit();

      expect(result.emails.autoReply).toBe(false);
      expect(optionalText(result.emails, "autoReplyError")).toBe("email_not_configured");
      expect(optionalText(result.emails, "adminError")).toBe("email_not_configured");
    },
  );

  it.fails(
    "DEFEKT: znacznik „potwierdzenie wysłane” stawia się, choć nadawca nic nie dostał",
    async () => {
      // CO: `src/lib/contact.functions.ts:441-446` stawia
      // `contact_messages.confirmation_sent_at`, gdy `autoReplyResult.ok ||
      // adminResult.ok` - czyli wystarczy, że wyszło POWIADOMIENIE DLA
      // REDAKCJI. Autoodpowiedź do nadawcy mogła w ogóle nie zostać wysłana
      // (najemca ją wyłączył albo Resend ją odrzucił).
      //
      // GDZIE: `contact.functions.ts:441` (warunek `||`),
      //        `src/routes/admin.contact.tsx:243-247` (odczyt),
      //        `src/routes/admin.contact.tsx:468` / `:505` (etykieta:
      //        „Potwierdzenie wysłane” / „Confirmation sent”).
      //
      // KONSEKWENCJA: operator widzi w skrzynce plakietkę „Potwierdzenie
      // wysłane” przy zgłoszeniu, do którego NIKT nie odpisał. To dokładnie
      // ten sam mechanizm co cicha degradacja, tylko odwrócony: system nie
      // milczy, ale mówi rzecz nieprawdziwą. Skutkiem jest zgłoszenie
      // porzucone w przekonaniu, że klient ma potwierdzenie.
      planHappyPath({ auto_reply_enabled: false, default_recipient: PII.adminInbox });
      const result = await submit();

      expect(result.emails.autoReply).toBe(false);
      expect(result.emails.admin).toBe(true);
      expect(
        db()
          .chainsFor("contact_messages")
          .filter((chain) => chain.has("update")),
        "znacznik potwierdzenia postawiony bez autoodpowiedzi",
      ).toEqual([]);
    },
  );
});

// ---------------------------------------------------------------------------
// 13. HIGIENA WŁASNYCH FIXTURE'ÓW - bramka na siebie samego.
// ---------------------------------------------------------------------------

describe("higiena danych osobowych w fixture'ach", () => {
  const EMAIL_FIELDS = [
    "senderEmail",
    "senderEmailMixedCase",
    "adminInbox",
    "fromAddress",
  ] as const;
  const IP_FIELDS = ["cloudflareIp", "proxyFirstHopIp", "realIp"] as const;

  it.each(EMAIL_FIELDS)("adres %s należy do domeny przykładowej", (field) => {
    expect(PII[field].toLowerCase()).toMatch(/@(example\.com|example\.org)$/);
  });

  it.each(IP_FIELDS)("adres IP %s pochodzi z puli dokumentacyjnej RFC 5737", (field) => {
    const documentationRanges = [/^192\.0\.2\./, /^198\.51\.100\./, /^203\.0\.113\./];
    expect(
      documentationRanges.some((range) => range.test(PII[field])),
      `adres ${PII[field]} nie należy do puli dokumentacyjnej RFC 5737`,
    ).toBe(true);
  });

  it("klucze API w fixture'ach są jawnie fałszywe", () => {
    for (const key of Object.values(FAKE_KEYS)) {
      expect(key).toContain("FAKE");
    }
  });

  it("numer telefonu i nazwa firmy są ewidentnie zmyślone", () => {
    expect(PII.senderPhone.replace(/\D/g, "")).toMatch(/^480+$/);
    expect(PII.senderCompany).toContain("Przykładowa");
  });

  it("żaden test nie wychodzi do sieci - transport jest atrapą", async () => {
    // NIE `vi.isMockFunction(fetch) || h.fetchCalls.length === 0`: ta alternatywa
    // jest zawsze prawdziwa (drugi członek spełnia się sam, dopóki w tym teście
    // nikt nie wysyła poczty), więc nie dowodziłaby niczego. Dowód musi być
    // BEHAWIORALNY: wołamy transport pod prawdziwym adresem bramki i pokazujemy,
    // że wywołanie WYLĄDOWAŁO W REJESTRZE atrapy, a nie w sieci - gdyby globalny
    // `fetch` nie był podmieniony, ta linia próbowałaby rozwiązać DNS.
    const before = h.fetchCalls.length;
    const response = await fetch(GATEWAY, { method: "POST", body: "{}" });
    expect(h.fetchCalls).toHaveLength(before + 1);
    expect(h.fetchCalls.at(-1)?.url).toBe(GATEWAY);
    expect(fieldOf(response, "status")).toBe(200);
    expect(GATEWAY.startsWith("https://connector-gateway.lovable.dev/")).toBe(true);
  });
});
