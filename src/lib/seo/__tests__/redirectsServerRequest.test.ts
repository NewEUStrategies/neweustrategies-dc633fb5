// CO DOWODZI TEN PLIK
// Middleware przekierowań i monitor 404 na poziomie ŻĄDANIA
// (`src/lib/seo/redirects.server.ts`) - warstwa, bez której panel
// /admin/redirects jest martwą metadaną, a 301-ki po migracji z WP nigdy nie
// docierają do przeglądarki. Mierzone są WYŁĄCZNIE własne gałęzie tego modułu:
//   1. bramki wejściowe `resolveRedirectForRequest` (metoda HTTP, ścieżka
//      chroniona, nieznany host, pusty indeks - każda MUSI odciąć się bez
//      odczytu bazy, bo middleware stoi przed cache dokumentów),
//   2. KSZTAŁT zwrotki middleware'u ({target, status}, 410 jako
//      `{ target: "", status: 410 }`),
//   3. degradacja loadera indeksu: błąd PostgREST, wybuch klienta
//      service-role, `data: null` - nigdy wyjątek na ścieżce SSR, a przy
//      ciepłym cache STARE reguły dalej działają (obrona przed 500 na każdym
//      żądaniu),
//   4. filtr `shouldLog404` i dwie ścieżki zapisu monitora (update wpisu
//      istniejącego vs upsert nowego), obcinanie do 2048, `referer`/`referrer`
//      oraz to, że błąd zapisu NIE wywraca odpowiedzi.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE
//   * `redirectsServerSwr.test.ts` - kontrakt stale-while-revalidate cache
//     indeksu (zimny izolat, nieświeży indeks po TTL, izolacja tenantów). Te
//     trzy testy NIE są tu powtarzane; `getRedirectIndexForTenant` dotykam
//     tylko gałęziami BŁĘDU loadera, których tamten plik nie ma, oraz kosztem
//     gorącej ścieżki (jeden odczyt na okno TTL).
//   * `redirects.test.ts` - semantyka czystego matchera (normalizacja źródeł
//     i celów, priorytety dopasowania, CSV). Tutaj te same wejścia jadą przez
//     `Request`, bo przedmiotem dowodu jest decyzja middleware'u i kształt
//     jego zwrotki, nie matcher.
//   * `redirects.functions.ts` (panel + import CSV) i parytet
//     admin <-> import <-> middleware - osobna powierzchnia, osobne pliki.
//   * `e2e/seo.spec.ts` - jedyny styk powierzchni to test
//     "sitemap-index.xml redirects to the canonical index", który dowodzi
//     przekierowania BAJTAMI na żywym SSR (kod odpowiedzi + nagłówek
//     `Location`). Ten plik nie wykonuje ani jednego żądania HTTP na żywym
//     serwerze i nie sprawdza nagłówków odpowiedzi - mierzy DECYZJĘ funkcji,
//     zanim ktokolwiek zbuduje z niej odpowiedź.
//   * RLS i RPC (`seo_404_hits`) - to domena pgTAP; tutaj PostgREST jest
//     atrapą.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { pgError } from "@/test/supabaseChain";
import {
  getRedirectIndexForTenant,
  invalidateRedirectCache,
  maybeLog404,
  resolveRedirectForRequest,
} from "@/lib/seo/redirects.server";

/** Wiersz tabeli `redirects` w kształcie, w jakim czyta go loader indeksu. */
interface RedirectRow {
  id: string;
  source_path: string;
  target_path: string;
  status_code: number;
}

/** Odpowiedź PostgREST w kształcie, jaki rozpakowuje kod produkcyjny. */
interface Reply {
  data: unknown;
  error: Error | null;
}

/** Jedno zapytanie zapisane przez atrapę - test czyta z niego payload i filtry. */
interface RecordedOp {
  table: string;
  kind: "select" | "update" | "upsert";
  columns: string | null;
  payload: Record<string, unknown> | null;
  options: Record<string, unknown> | null;
  filters: Record<string, unknown>;
  limit: number | null;
}

interface SelectBuilder {
  eq(column: string, value: unknown): SelectBuilder;
  limit(count: number): Promise<Reply>;
  maybeSingle(): Promise<Reply>;
}

interface UpdateBuilder {
  eq(column: string, value: unknown): UpdateBuilder;
  then(
    onFulfilled?: (value: Reply) => unknown,
    onRejected?: (reason: unknown) => unknown,
  ): Promise<unknown>;
}

// Atrapa granicy I/O żyje w `vi.hoisted`, bo fabryki `vi.mock` są wynoszone
// nad ciało modułu - stan trzymany w zwykłym `const` byłby w TDZ w chwili,
// w której `redirects.server.ts` importuje `tenant.server`.
const mockState = vi.hoisted(() => {
  const state = {
    /** host -> tenant_id; brak wpisu = host nieznany (`resolveTenantForHost` -> null). */
    tenantsByHost: new Map<string, string>(),
    tenantCalls: [] as Array<string | null>,
    /** Obietnice oddane do `runAfterResponse` - test domyka nimi tło. */
    background: [] as Array<Promise<unknown>>,
    matcherCalls: 0,
    ops: [] as RecordedOp[],
    redirectRows: null as RedirectRow[] | null,
    redirectError: null as Error | null,
    /** Import `client.server` rzuca (moduł klienta service-role niedostępny). */
    clientThrows: false,
    /** Samo zapytanie rzuca (klient wybuchł na `from`). */
    fromThrows: false,
    /** `hits` istniejącego wpisu w `seo_404_hits`; null = wpisu nie ma. */
    existingHits: null as number | null,
    writeFailure: "none" as "none" | "throw" | "reject",
  };

  function redirectsReply(): Promise<Reply> {
    if (state.redirectError) return Promise.resolve({ data: null, error: state.redirectError });
    return Promise.resolve({ data: state.redirectRows, error: null });
  }

  function hitsReply(): Promise<Reply> {
    return Promise.resolve({
      data: state.existingHits === null ? null : { hits: state.existingHits },
      error: null,
    });
  }

  function writeReply(): Promise<Reply> {
    if (state.writeFailure === "reject") {
      return Promise.reject(new Error("seo_404_hits: PostgREST odrzucił zapis"));
    }
    return Promise.resolve({ data: null, error: null });
  }

  function record(op: RecordedOp): RecordedOp {
    state.ops.push(op);
    return op;
  }

  const client = {
    from(table: string) {
      if (state.fromThrows) throw new Error("klient service-role wybuchł na zapytaniu");
      return {
        select(columns: string): SelectBuilder {
          const op = record({
            table,
            kind: "select",
            columns,
            payload: null,
            options: null,
            filters: {},
            limit: null,
          });
          const builder: SelectBuilder = {
            eq(column, value) {
              op.filters[column] = value;
              return builder;
            },
            limit(count) {
              op.limit = count;
              return redirectsReply();
            },
            maybeSingle() {
              return hitsReply();
            },
          };
          return builder;
        },
        update(payload: Record<string, unknown>): UpdateBuilder {
          const op = record({
            table,
            kind: "update",
            columns: null,
            payload,
            options: null,
            filters: {},
            limit: null,
          });
          if (state.writeFailure === "throw") {
            throw new Error("seo_404_hits: klient wybuchł na update");
          }
          const builder: UpdateBuilder = {
            eq(column, value) {
              op.filters[column] = value;
              return builder;
            },
            then(onFulfilled, onRejected) {
              return writeReply().then(onFulfilled, onRejected);
            },
          };
          return builder;
        },
        upsert(payload: Record<string, unknown>, options: Record<string, unknown>): Promise<Reply> {
          record({
            table,
            kind: "upsert",
            columns: null,
            payload,
            options,
            filters: {},
            limit: null,
          });
          if (state.writeFailure === "throw") {
            throw new Error("seo_404_hits: klient wybuchł na upsert");
          }
          return writeReply();
        },
      };
    },
  };

  return Object.assign(state, { client });
});

vi.mock("@/integrations/supabase/client.server", () => ({
  // Getter, nie stała: gałąź „import klienta service-role nie wychodzi"
  // (Workers bez sekretu, degradacja bundla) musi być dosięgalna z testu.
  get supabaseAdmin() {
    if (mockState.clientThrows) throw new Error("import klienta service-role nieudany");
    return mockState.client;
  },
}));

vi.mock("@/lib/server/tenant.server", () => ({
  resolveTenantForHost: (rawHost: string | null | undefined) => {
    mockState.tenantCalls.push(rawHost ?? null);
    const id = mockState.tenantsByHost.get((rawHost ?? "").toLowerCase());
    return Promise.resolve(
      id ? { id, slug: "nes", domain: rawHost ?? null, isDefault: true } : null,
    );
  },
}));

vi.mock("@/lib/http/waitUntil.server", () => ({
  runAfterResponse: (work: Promise<unknown>) => {
    mockState.background.push(work);
    void work.catch(() => undefined);
  },
}));

// Matcher wykonuje się REALNIE - liczymy tylko wywołania, żeby móc dowieść,
// że bramka pustego indeksu odcina żądanie PRZED dopasowaniem.
vi.mock("@/lib/seo/redirects", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/seo/redirects")>();
  return {
    ...actual,
    matchRedirectForPath: (
      ...args: Parameters<typeof actual.matchRedirectForPath>
    ): ReturnType<typeof actual.matchRedirectForPath> => {
      mockState.matcherCalls += 1;
      return actual.matchRedirectForPath(...args);
    },
  };
});

const HOST = "neweuropeanstrategies.com";
const TENANT_ID = "t-nes";
/** Kod produkcyjny woła `Date.now()` i `new Date().toISOString()` - czas jest ustalony. */
const NOW_ISO = "2026-02-03T10:15:00.000Z";

function rule(source: string, target: string, status = 301): RedirectRow {
  return { id: `r${source}`, source_path: source, target_path: target, status_code: status };
}

function request(path: string, init?: { method?: string; host?: string }): Request {
  return new Request(`https://${init?.host ?? HOST}${path}`, { method: init?.method ?? "GET" });
}

/**
 * Konstruktor `Request` FILTRUJE `referer` (nagłówek zabroniony dla fetch),
 * ale `headers.set` na gotowej instancji już go przyjmuje - bez tego gałąź
 * `referer ?? referrer` byłaby z testu nieosiągalna.
 */
function requestWithHeaders(path: string, headers: Record<string, string>): Request {
  const req = request(path);
  for (const [name, value] of Object.entries(headers)) req.headers.set(name, value);
  return req;
}

function response(status: number, contentType: string | null): Response {
  const headers = new Headers();
  if (contentType !== null) headers.set("content-type", contentType);
  return new Response(null, { status, headers });
}

function html404(): Response {
  return response(404, "text/html; charset=utf-8");
}

function spyOnWarn() {
  return vi.spyOn(console, "warn").mockImplementation(() => undefined);
}

let warn: ReturnType<typeof spyOnWarn>;

function opsFor(table: string): RecordedOp[] {
  return mockState.ops.filter((op) => op.table === table);
}

function opOfKind(kind: RecordedOp["kind"]): RecordedOp | undefined {
  return mockState.ops.find((op) => op.kind === kind);
}

beforeEach(() => {
  invalidateRedirectCache();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-02-03T10:15:00Z"));
  warn = spyOnWarn();
  mockState.tenantsByHost = new Map([[HOST, TENANT_ID]]);
  mockState.tenantCalls = [];
  mockState.background = [];
  mockState.matcherCalls = 0;
  mockState.ops = [];
  mockState.redirectRows = [];
  mockState.redirectError = null;
  mockState.clientThrows = false;
  mockState.fromThrows = false;
  mockState.existingHits = null;
  mockState.writeFailure = "none";
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("resolveRedirectForRequest - bramki wejściowe", () => {
  // Metoda inna niż GET/HEAD nie może kosztować NICZEGO: POST-y formularzy
  // i wywołania server functions idą tą samą ścieżką middleware'u.
  it.each(["POST", "PUT", "DELETE", "PATCH"])(
    "metoda %s nie przekierowuje i nie dotyka bazy ani katalogu tenantów",
    async (method) => {
      mockState.redirectRows = [rule("/stary", "/nowy")];

      const result = await resolveRedirectForRequest(request("/stary", { method }));

      expect(result).toBeNull();
      expect(mockState.tenantCalls).toHaveLength(0);
      expect(mockState.ops).toHaveLength(0);
      expect(mockState.matcherCalls).toBe(0);
    },
  );

  it.each(["GET", "HEAD"])("metoda %s przechodzi bramkę i widzi regułę", async (method) => {
    mockState.redirectRows = [rule("/stary", "/nowy")];

    const result = await resolveRedirectForRequest(request("/stary", { method }));

    expect(result).toEqual({ target: "/nowy", status: 301 });
  });

  it("metoda zapisana małymi literami przechodzi (gałąź toUpperCase)", async () => {
    mockState.redirectRows = [rule("/stary", "/nowy")];
    const req = request("/stary");
    // `new Request(url, { method: "get" })` normalizuje metodę do "GET" (WHATWG),
    // więc jedyny sposób dosięgnięcia gałęzi to podmiana właściwości instancji.
    Object.defineProperty(req, "method", { value: "get", configurable: true });

    expect(req.method).toBe("get");
    await expect(resolveRedirectForRequest(req)).resolves.toEqual({
      target: "/nowy",
      status: 301,
    });
  });

  // `isProtectedPath` (PROTECTED_PREFIXES: /admin, /api, /_) - reguła
  // przekierowania nie może przesłonić panelu ani API, nawet gdy operator
  // wpisze ją do tabeli. Bramka stoi PRZED odczytem katalogu tenantów.
  it.each(["/admin", "/admin/redirects", "/api/newsletter/subscribe", "/_/vite-hmr"])(
    "ścieżka chroniona %s nie przekierowuje i nie dotyka bazy",
    async (path) => {
      mockState.redirectRows = [rule(path, "/przejete-przez-regule")];

      const result = await resolveRedirectForRequest(request(path));

      expect(result).toBeNull();
      expect(mockState.tenantCalls).toHaveLength(0);
      expect(mockState.ops).toHaveLength(0);
    },
  );

  it("nieznany host nie przekierowuje (brak tenanta = brak reguł)", async () => {
    mockState.redirectRows = [rule("/stary", "/nowy")];

    const result = await resolveRedirectForRequest(request("/stary", { host: "obca.example" }));

    expect(result).toBeNull();
    expect(mockState.tenantCalls).toEqual(["obca.example"]);
    // Service role obchodzi RLS - bez tenanta NIE WOLNO nawet czytać tabeli.
    expect(mockState.ops).toHaveLength(0);
  });

  it("pusty indeks (zero reguł) kończy żądanie bez wołania matchera", async () => {
    mockState.redirectRows = [];

    const result = await resolveRedirectForRequest(request("/stary"));

    expect(result).toBeNull();
    expect(mockState.matcherCalls).toBe(0);
    expect(opsFor("redirects")).toHaveLength(1);
  });

  it("indeks bez reguł dokładnych, ale z wildcardem przechodzi bramkę pustego indeksu", async () => {
    mockState.redirectRows = [rule("/stara-sekcja/*", "/nowa-sekcja/*")];

    const result = await resolveRedirectForRequest(request("/stara-sekcja/a/b"));

    expect(result).toEqual({ target: "/nowa-sekcja/a/b", status: 301 });
    expect(mockState.matcherCalls).toBe(1);
  });

  it("gorąca ścieżka: dwa żądania w oknie TTL to JEDEN odczyt indeksu", async () => {
    mockState.redirectRows = [rule("/stary", "/nowy")];

    await resolveRedirectForRequest(request("/stary"));
    await resolveRedirectForRequest(request("/stary"));

    expect(opsFor("redirects")).toHaveLength(1);
    // Odświeżenie indeksu jest rejestrowane w `waitUntil`, nie porzucane -
    // workerd inaczej ucina je razem z domknięciem odpowiedzi.
    expect(mockState.background).toHaveLength(1);
  });

  it("dwa RÓWNOLEGŁE żądania na zimnym izolacie dzielą jeden odczyt (single-flight)", async () => {
    mockState.redirectRows = [rule("/stary", "/nowy")];

    // Oba żądania wchodzą przed rozstrzygnięciem pierwszego odczytu, więc
    // drugie MUSI dosiąść się do biegnącej obietnicy. Bez tego pierwsze
    // uderzenie ruchu po deployu mnożyłoby round-tripy do bazy przez liczbę
    // równoległych żądań na izolacie.
    const [first, second] = await Promise.all([
      resolveRedirectForRequest(request("/stary")),
      resolveRedirectForRequest(request("/stary")),
    ]);

    expect(first).toEqual({ target: "/nowy", status: 301 });
    expect(second).toEqual(first);
    expect(opsFor("redirects")).toHaveLength(1);
  });

  it("odczyt indeksu jest filtrowany tenantem i włączonymi regułami", async () => {
    mockState.redirectRows = [rule("/stary", "/nowy")];

    await resolveRedirectForRequest(request("/stary"));

    const read = opsFor("redirects")[0];
    expect(read.filters).toEqual({ tenant_id: TENANT_ID, is_enabled: true });
    expect(read.limit).toBe(5000);
  });
});

describe("resolveRedirectForRequest - kształt zwrotki", () => {
  it("trafienie dokładne 301 zwraca cel i kod reguły", async () => {
    mockState.redirectRows = [rule("/o-firmie", "/o-nas", 301)];

    await expect(resolveRedirectForRequest(request("/o-firmie"))).resolves.toEqual({
      target: "/o-nas",
      status: 301,
    });
  });

  it("trafienie dokładne 302 zwraca kod tymczasowy, nie 301", async () => {
    mockState.redirectRows = [rule("/promocja", "/kampania", 302)];

    await expect(resolveRedirectForRequest(request("/promocja"))).resolves.toEqual({
      target: "/kampania",
      status: 302,
    });
  });

  it("pudło na niepustym indeksie zwraca null (żądanie leci dalej do routera)", async () => {
    mockState.redirectRows = [rule("/stary", "/nowy")];

    await expect(resolveRedirectForRequest(request("/zupelnie-inna"))).resolves.toBeNull();
    expect(mockState.matcherCalls).toBe(1);
  });

  it("reguła 410 zwraca PUSTY cel i status 410 (Gone nie ma Location)", async () => {
    mockState.redirectRows = [rule("/usuniete", "/", 410)];

    await expect(resolveRedirectForRequest(request("/usuniete"))).resolves.toEqual({
      target: "",
      status: 410,
    });
  });

  it("cel relatywny wychodzi jako ścieżka", async () => {
    mockState.redirectRows = [rule("/stary", "/nowy")];

    await expect(resolveRedirectForRequest(request("/stary"))).resolves.toEqual({
      target: "/nowy",
      status: 301,
    });
  });

  it("cel absolutny na dozwolonym hoście wychodzi bez zmiany kształtu", async () => {
    // Allowlista hostów jest pilnowana przy ZAPISIE reguły
    // (`normalizeTargetPath`); middleware oddaje gotowy cel bez ponownej
    // normalizacji, więc kształt zwrotki musi być identyczny jak dla ścieżki.
    mockState.redirectRows = [rule("/abs", `https://www.${HOST}/nowy`)];

    await expect(resolveRedirectForRequest(request("/abs"))).resolves.toEqual({
      target: `https://www.${HOST}/nowy`,
      status: 301,
    });
  });

  it("łańcuch A->B->C jest zwijany do CELU KOŃCOWEGO w jednym skoku", async () => {
    mockState.redirectRows = [rule("/a", "/b", 301), rule("/b", "/c", 302)];

    const result = await resolveRedirectForRequest(request("/a"));

    // ZMIERZONY FAKT: middleware NIE zwraca "/b". `resolveChain` idzie po
    // regułach dokładnych do MAX_CHAIN_HOPS, więc crawler dostaje jeden skok
    // prosto na "/c" - nie ma drugiego round-tripu i nie ma rozmycia sygnału
    // rankingowego na pośrednim adresie.
    expect(result).toEqual({ target: "/c", status: 302 });
    // KONSEKWENCJA DO ZAPAMIĘTANIA: kod odpowiedzi bierze się z reguły
    // KOŃCOWEJ (302 z /b->/c), a nie z tej, która została dopasowana
    // (301 z /a->/b). Zmiana statusu ostatniego ogniwa łańcucha zmienia
    // status widziany na PIERWSZYM adresie.
  });

  it("przekierowanie na siebie (A->A) jest odrzucane, nie zwracane", async () => {
    mockState.redirectRows = [rule("/petla", "/petla")];

    // Gdyby middleware oddał tu `{ target: "/petla" }`, przeglądarka
    // pokazałaby ERR_TOO_MANY_REDIRECTS i strona byłaby niedostępna.
    // Czysty matcher odrzuca taki cel (`matchRedirect`), więc żądanie leci
    // dalej do routera - i to jest zachowanie, które przypinamy.
    await expect(resolveRedirectForRequest(request("/petla"))).resolves.toBeNull();
  });

  it("cykl A->B->A jest odrzucany z obu stron", async () => {
    mockState.redirectRows = [rule("/a", "/b"), rule("/b", "/a")];

    await expect(resolveRedirectForRequest(request("/a"))).resolves.toBeNull();
    await expect(resolveRedirectForRequest(request("/b"))).resolves.toBeNull();
  });

  it("wildcard przenosi resztę ścieżki na nowy prefiks", async () => {
    mockState.redirectRows = [rule("/blog/*", "/aktualnosci/*")];

    await expect(resolveRedirectForRequest(request("/blog/2019/wpis"))).resolves.toEqual({
      target: "/aktualnosci/2019/wpis",
      status: 301,
    });
  });

  it("query żądania jest ZACHOWANE na celu, gdy reguła go nie skonsumowała", async () => {
    mockState.redirectRows = [rule("/stary", "/nowy")];

    // FAKT (zmierzony, nie założony): parametry kampanii przechodzą na cel -
    // atrybucja UTM przeżywa 301-kę.
    await expect(resolveRedirectForRequest(request("/stary?utm_source=x"))).resolves.toEqual({
      target: "/nowy?utm_source=x",
      status: 301,
    });
  });

  it("shortlink WP /?p=123 dopasowuje się z query i je KONSUMUJE", async () => {
    mockState.redirectRows = [rule("/?p=123", "/artykul")];

    // Reguła „ścieżka?query" wygrywa z regułą samej ścieżki i query NIE jest
    // doklejane do celu - inaczej cel wyglądałby "/artykul?p=123".
    await expect(resolveRedirectForRequest(request("/?p=123"))).resolves.toEqual({
      target: "/artykul",
      status: 301,
    });
  });

  it("gdy cel reguły ma WŁASNE query, query żądania jest GUBIONE", async () => {
    mockState.redirectRows = [rule("/stary", "/nowy?wariant=a")];

    // FAKT: warunek `!target.includes("?")` blokuje doklejenie, więc
    // "?utm_source=x" nie dojeżdża na cel. To jest zmierzony wariant -
    // reguła z własnym query ucina atrybucję z linku wejściowego.
    await expect(resolveRedirectForRequest(request("/stary?utm_source=x"))).resolves.toEqual({
      target: "/nowy?wariant=a",
      status: 301,
    });
  });
});

describe("getRedirectIndexForTenant - degradacja odczytu indeksu", () => {
  it("błąd PostgREST przy ZIMNYM cache daje pusty indeks i ostrzeżenie", async () => {
    mockState.redirectError = pgError("statement timeout", "57014");

    const index = await getRedirectIndexForTenant(TENANT_ID);

    expect(index.exact.size).toBe(0);
    expect(index.wildcards).toHaveLength(0);
    expect(warn).toHaveBeenCalledWith("[redirects] index load failed:", mockState.redirectError);
  });

  it("błąd PostgREST przy zimnym cache nie wywraca żądania (brak przekierowania)", async () => {
    mockState.redirectError = pgError("statement timeout", "57014");

    await expect(resolveRedirectForRequest(request("/stary"))).resolves.toBeNull();
    expect(mockState.matcherCalls).toBe(0);
  });

  it("błąd PostgREST przy CIEPŁYM cache serwuje STARY indeks (stale-over-error)", async () => {
    mockState.redirectRows = [rule("/stary", "/nowy")];
    await expect(resolveRedirectForRequest(request("/stary"))).resolves.toEqual({
      target: "/nowy",
      status: 301,
    });

    // Supabase pada; TTL indeksu (30 s) mija.
    mockState.redirectError = pgError("503 upstream", "PGRST503");
    vi.advanceTimersByTime(31_000);

    // Reguły MUSZĄ dalej działać - inaczej awaria bazy zamienia każdą 301-kę
    // w 404 na całym serwisie.
    await expect(resolveRedirectForRequest(request("/stary"))).resolves.toEqual({
      target: "/nowy",
      status: 301,
    });

    // Odświeżenie w tle też pada - i też zostawia stary indeks w cache.
    await Promise.all(mockState.background);
    vi.advanceTimersByTime(31_000);
    await expect(resolveRedirectForRequest(request("/stary"))).resolves.toEqual({
      target: "/nowy",
      status: 301,
    });
    expect(warn).toHaveBeenCalled();
  });

  it("wybuch klienta service-role na zapytaniu daje pusty indeks bez wyjątku", async () => {
    mockState.fromThrows = true;

    const index = await getRedirectIndexForTenant(TENANT_ID);

    expect(index.exact.size).toBe(0);
    expect(warn).toHaveBeenCalled();
  });

  it("nieudany import klienta service-role daje pusty indeks bez wyjątku", async () => {
    mockState.clientThrows = true;

    await expect(resolveRedirectForRequest(request("/stary"))).resolves.toBeNull();
    expect(mockState.ops).toHaveLength(0);
    expect(warn).toHaveBeenCalled();
  });

  it("data: null (odczyt bez wiersza i bez błędu) daje pusty indeks", async () => {
    mockState.redirectRows = null;

    const index = await getRedirectIndexForTenant(TENANT_ID);

    expect(index.exact.size).toBe(0);
    expect(index.wildcards).toHaveLength(0);
    // Gałąź `?? []` to NIE błąd - żadnego ostrzeżenia być nie może.
    expect(warn).not.toHaveBeenCalled();
  });
});

describe("maybeLog404 - filtr shouldLog404", () => {
  it.each([200, 301, 500])("status %i nie trafia do monitora", async (status) => {
    await maybeLog404(request("/nie-ma"), response(status, "text/html; charset=utf-8"));

    expect(mockState.tenantCalls).toHaveLength(0);
    expect(mockState.ops).toHaveLength(0);
  });

  const TYPY_TRESCI: ReadonlyArray<{ nazwa: string; typ: string | null; zapis: boolean }> = [
    { nazwa: "brak content-type", typ: null, zapis: false },
    { nazwa: "application/json (404 z API)", typ: "application/json", zapis: false },
    { nazwa: "application/xml (404 sitemapy/feedu)", typ: "application/xml", zapis: false },
    // Case-sensitive `includes("text/html")`: realny SSR wysyła nagłówek
    // małymi literami, więc wariant wielkimi literami jest tu tylko
    // przypięciem faktu, nie oczekiwanym wejściem.
    { nazwa: "TEXT/HTML wielkimi literami", typ: "TEXT/HTML; charset=utf-8", zapis: false },
    {
      nazwa: "text/html; charset=utf-8 (dokument routera)",
      typ: "text/html; charset=utf-8",
      zapis: true,
    },
    { nazwa: "text/html bez charsetu", typ: "text/html", zapis: true },
  ];

  it.each(TYPY_TRESCI)("$nazwa -> zapis: $zapis", async ({ typ, zapis }) => {
    await maybeLog404(request("/nie-ma"), response(404, typ));

    expect(opsFor("seo_404_hits").length > 0).toBe(zapis);
  });

  it.each(["/admin/nie-ma", "/api/nie-ma", "/_"])(
    "ścieżka chroniona %s nie trafia do monitora",
    async (path) => {
      await maybeLog404(request(path), html404());

      expect(mockState.tenantCalls).toHaveLength(0);
      expect(mockState.ops).toHaveLength(0);
    },
  );

  // Szum assetów: `.` w ostatnim segmencie = plik, nawet gdy trasa
  // przypadkiem wyrenderowała HTML. Wariant "?" w regexie jest w praktyce
  // martwy (`url.pathname` nigdy nie zawiera query) - "/a.b?x=1" jest
  // odrzucane przez alternatywę "$" na ścieżce "/a.b".
  it.each(["/favicon.ico", "/robots.txt", "/plik.pdf", "/a.b?x=1"])(
    "ścieżka z rozszerzeniem %s nie trafia do monitora",
    async (path) => {
      await maybeLog404(request(path), html404());

      expect(mockState.tenantCalls).toHaveLength(0);
      expect(mockState.ops).toHaveLength(0);
    },
  );

  it("ścieżka bez rozszerzenia trafia do monitora", async () => {
    await maybeLog404(request("/o-nas-2019"), html404());

    expect(opsFor("seo_404_hits")).not.toHaveLength(0);
  });

  it("ścieżka dłuższa niż 2048 znaków nie trafia do monitora", async () => {
    const path = `/${"a".repeat(2100)}`;

    await maybeLog404(request(path), html404());

    expect(mockState.tenantCalls).toHaveLength(0);
    expect(mockState.ops).toHaveLength(0);
  });

  it("nieznany host nie trafia do monitora (brak tenanta = brak zapisu)", async () => {
    await maybeLog404(request("/nie-ma", { host: "obca.example" }), html404());

    expect(mockState.tenantCalls).toEqual(["obca.example"]);
    expect(mockState.ops).toHaveLength(0);
  });
});

describe("maybeLog404 - zapis wpisu", () => {
  it("wpis ISTNIEJĄCY jest inkrementowany przez update (hits + 1, last_seen)", async () => {
    mockState.existingHits = 3;

    await maybeLog404(request("/o-nas-2019"), html404());

    const read = opsFor("seo_404_hits")[0];
    expect(read.columns).toBe("hits");
    expect(read.filters).toEqual({ tenant_id: TENANT_ID, path: "/o-nas-2019" });

    const update = opOfKind("update");
    expect(update?.payload).toEqual({ hits: 4, last_seen: NOW_ISO, last_referrer: null });
    expect(update?.filters).toEqual({ tenant_id: TENANT_ID, path: "/o-nas-2019" });
    expect(opOfKind("upsert")).toBeUndefined();
  });

  it("wpis NOWY jest zakładany przez upsert (hits: 1, onConflict tenant_id,path)", async () => {
    mockState.existingHits = null;

    await maybeLog404(request("/o-nas-2019"), html404());

    const upsert = opOfKind("upsert");
    expect(upsert?.payload).toEqual({
      tenant_id: TENANT_ID,
      path: "/o-nas-2019",
      hits: 1,
      first_seen: NOW_ISO,
      last_seen: NOW_ISO,
      last_referrer: null,
    });
    // Bez `onConflict` równoległe żądania na tę samą ścieżkę wywalałyby
    // konflikt klucza (tenant_id, path) zamiast scalić wpis.
    expect(upsert?.options).toEqual({ onConflict: "tenant_id,path" });
    expect(opOfKind("update")).toBeUndefined();
  });

  it("query jest ZACHOWANE w zapisanej ścieżce (shortlink WP to osobny wpis)", async () => {
    await maybeLog404(request("/?p=123"), html404());

    expect(opOfKind("upsert")?.payload).toMatchObject({ path: "/?p=123" });
  });

  it("zapisywana ścieżka (pathname + search) jest obcinana do 2048 znaków", async () => {
    const pathname = `/${"a".repeat(2000)}`;
    const search = `?${"b".repeat(300)}`;

    await maybeLog404(request(`${pathname}${search}`), html404());

    const payload = opOfKind("upsert")?.payload;
    const path = payload?.path;
    expect(typeof path).toBe("string");
    expect(String(path)).toHaveLength(2048);
    expect(String(path).startsWith(pathname)).toBe(true);
  });

  const REFERERY: ReadonlyArray<{
    nazwa: string;
    naglowki: Record<string, string>;
    oczekiwany: string | null;
  }> = [
    {
      nazwa: "referer obecny",
      naglowki: { referer: "https://www.google.com/search?q=nes" },
      oczekiwany: "https://www.google.com/search?q=nes",
    },
    {
      nazwa: "brak referer, obecny referrer (gałąź ??)",
      naglowki: { referrer: "https://bing.com/search" },
      oczekiwany: "https://bing.com/search",
    },
    {
      nazwa: "oba obecne - wygrywa referer",
      naglowki: { referer: "https://a.example/1", referrer: "https://b.example/2" },
      oczekiwany: "https://a.example/1",
    },
    { nazwa: "oba nieobecne", naglowki: {}, oczekiwany: null },
  ];

  it.each(REFERERY)("$nazwa -> last_referrer", async ({ naglowki, oczekiwany }) => {
    await maybeLog404(requestWithHeaders("/o-nas-2019", naglowki), html404());

    expect(opOfKind("upsert")?.payload).toMatchObject({ last_referrer: oczekiwany });
  });

  it("referer dłuższy niż 2048 znaków jest obcinany", async () => {
    const referer = `https://x.example/${"a".repeat(3000)}`;

    await maybeLog404(requestWithHeaders("/o-nas-2019", { referer }), html404());

    const stored = opOfKind("upsert")?.payload?.last_referrer;
    expect(typeof stored).toBe("string");
    expect(String(stored)).toHaveLength(2048);
    expect(referer.startsWith(String(stored))).toBe(true);
  });

  // KLUCZOWA ASERCJA SEKCJI: monitor 404 jest telemetrią. Gdyby jego błąd
  // wychodził na zewnątrz, middleware wywróciłby ODPOWIEDŹ, którą właśnie
  // opisuje - z 404 zrobiłoby się 500.
  it("wyjątek klienta przy zapisie NIE wychodzi z maybeLog404", async () => {
    mockState.writeFailure = "throw";

    await expect(maybeLog404(request("/o-nas-2019"), html404())).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalled();
  });

  it("odrzucona obietnica zapisu NIE wychodzi z maybeLog404", async () => {
    mockState.writeFailure = "reject";

    await expect(maybeLog404(request("/o-nas-2019"), html404())).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalled();
  });

  it("wyjątek przy INKREMENTACJI istniejącego wpisu też jest połknięty", async () => {
    mockState.existingHits = 7;
    mockState.writeFailure = "reject";

    await expect(maybeLog404(request("/o-nas-2019"), html404())).resolves.toBeUndefined();
    expect(opOfKind("update")?.payload).toMatchObject({ hits: 8 });
    expect(warn).toHaveBeenCalled();
  });
});
