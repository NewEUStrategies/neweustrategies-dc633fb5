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
//   4. filtr `shouldLog404` i zapis monitora JEDNYM atomowym RPC
//      `record_seo_404` (zero select/update/upsert na `seo_404_hits`, także
//      przy równoległych 404 na tę samą ścieżkę), obcinanie do limitu bazy
//      (500), `referer`/`referrer` oraz to, że błąd zapisu - wyjątek,
//      odrzucenie albo `{ error }` - NIE wywraca odpowiedzi,
//   5. licznik trafień reguły: `record_redirect_hit` z id reguły WEJŚCIOWEJ,
//      zaplanowany za odpowiedzią (`runAfterResponse`), nigdy na ścieżce
//      żądania; HEAD i pudło nie liczą, 410 liczy,
//   6. dławienie licznika: najwyżej 5 zapisów jednej reguły na 10 s w izolacie
//      (seria skanera WP na wildcard 410 nie zamienia się w setki UPDATE-ów
//      tego samego wiersza), budżet per reguła, odnawiany po oknie.
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
//   * RLS i ciała RPC (`redirects`, `seo_404_hits`, atomowość upsertu,
//     uprawnienia EXECUTE) - to domena pgTAP
//     (`supabase/tests/redirects_seo_404_tenant_rls_test.sql`); tutaj
//     PostgREST jest atrapą, a dowodem jest KSZTAŁT wywołania.
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

/**
 * Jedno zapytanie zapisane przez atrapę - test czyta z niego payload i filtry.
 * Dla `kind: "rpc"` pole `table` niesie NAZWĘ FUNKCJI, a `payload` jej argumenty.
 */
interface RecordedOp {
  table: string;
  kind: "select" | "update" | "upsert" | "rpc";
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
    /**
     * Awaria RPC: `throw` - klient wybucha synchronicznie, `reject` -
     * obietnica odrzuca, `error` - PostgREST oddaje `{ error }` (najczęstszy
     * realny przypadek: brak uprawnień, timeout instrukcji).
     */
    rpcFailure: "none" as "none" | "throw" | "reject" | "error",
    /** Odpowiedź RPC jest wstrzymana do ręcznego `releaseRpc()`. */
    rpcHeld: false,
    heldRpc: [] as Array<() => void>,
  };

  function redirectsReply(): Promise<Reply> {
    if (state.redirectError) return Promise.resolve({ data: null, error: state.redirectError });
    return Promise.resolve({ data: state.redirectRows, error: null });
  }

  function rpcReply(fn: string): Promise<Reply> {
    if (state.rpcFailure === "reject") {
      return Promise.reject(new Error(`${fn}: PostgREST odrzucił wywołanie`));
    }
    const reply: Reply =
      state.rpcFailure === "error"
        ? { data: null, error: new Error(`${fn}: permission denied`) }
        : { data: null, error: null };
    if (!state.rpcHeld) return Promise.resolve(reply);
    return new Promise((resolve) => state.heldRpc.push(() => resolve(reply)));
  }

  // Zapis do `seo_404_hits` przez builder tabeli to od 2026-10-02 REGRESJA
  // (read-then-write gubił zliczenia) - atrapa dalej go umie, żeby test mógł
  // policzyć takie operacje i dowieść, że jest ich ZERO.
  function legacyReply(): Promise<Reply> {
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
              return legacyReply();
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
          const builder: UpdateBuilder = {
            eq(column, value) {
              op.filters[column] = value;
              return builder;
            },
            then(onFulfilled, onRejected) {
              return legacyReply().then(onFulfilled, onRejected);
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
          return legacyReply();
        },
      };
    },
    rpc(fn: string, args: Record<string, unknown>): Promise<Reply> {
      if (state.fromThrows) throw new Error("klient service-role wybuchł na zapytaniu");
      record({
        table: fn,
        kind: "rpc",
        columns: null,
        payload: args,
        options: null,
        filters: {},
        limit: null,
      });
      if (state.rpcFailure === "throw") throw new Error(`${fn}: klient wybuchł na rpc`);
      return rpcReply(fn);
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
/** Limit `left(..., 500)` z ciała `record_seo_404` - aplikacja tnie do tej samej długości. */
const SEO_404_DB_LIMIT = 500;

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

/** Wywołania RPC o danej nazwie, w kolejności. */
function rpcCalls(fn: string): RecordedOp[] {
  return mockState.ops.filter((op) => op.kind === "rpc" && op.table === fn);
}

/** Argumenty JEDYNEGO wywołania `record_seo_404` (test pada, gdy jest ich inna liczba). */
function only404Args(): Record<string, unknown> | null {
  const calls = rpcCalls("record_seo_404");
  expect(calls).toHaveLength(1);
  return calls[0]?.payload ?? null;
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
  mockState.rpcFailure = "none";
  mockState.rpcHeld = false;
  mockState.heldRpc = [];
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
    // workerd inaczej ucina je razem z domknięciem odpowiedzi. W tle są:
    // odświeżenie indeksu, jego migawka współdzielona i DWA liczniki trafień
    // (po jednym na przekierowane żądanie).
    expect(mockState.background).toHaveLength(4);
    await Promise.all(mockState.background);
    expect(rpcCalls("record_redirect_hit")).toHaveLength(2);
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

    expect(rpcCalls("record_seo_404").length > 0).toBe(zapis);
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

    expect(rpcCalls("record_seo_404")).toHaveLength(1);
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

describe("maybeLog404 - zapis wpisu atomowym RPC record_seo_404", () => {
  it("trafienie to JEDNO wywołanie RPC z tenantem hosta i ścieżką", async () => {
    await maybeLog404(request("/o-nas-2019"), html404());

    expect(only404Args()).toEqual({ _tenant_id: TENANT_ID, _path: "/o-nas-2019" });
    // Zero operacji na tabeli: inkrementację robi baza (ON CONFLICT ... hits + 1).
    expect(opsFor("seo_404_hits")).toHaveLength(0);
  });

  it("dwa RÓWNOLEGŁE 404 na tę samą ścieżkę to dwa RPC i ZERO read-then-write", async () => {
    // Stary zapis czytał `hits` i pisał `hits + 1`: dwa żądania, które
    // przeczytały to samo `hits = 3`, zapisywały oba `4` - jedno trafienie
    // ginęło. Odpowiedź RPC jest tu WSTRZYMANA, więc oba wywołania są
    // w locie naraz - dokładnie okno, w którym stary kod gubił zliczenie.
    mockState.rpcHeld = true;

    const first = maybeLog404(request("/o-nas-2019"), html404());
    const second = maybeLog404(request("/o-nas-2019"), html404());
    await vi.waitFor(() => expect(rpcCalls("record_seo_404")).toHaveLength(2));
    for (const release of mockState.heldRpc) release();
    await Promise.all([first, second]);

    expect(rpcCalls("record_seo_404").map((op) => op.payload)).toEqual([
      { _tenant_id: TENANT_ID, _path: "/o-nas-2019" },
      { _tenant_id: TENANT_ID, _path: "/o-nas-2019" },
    ]);
    // Dowód braku wyścigu po stronie aplikacji: ani jednego select/update/
    // upsert na `seo_404_hits` - aplikacja nie zna i nie przesyła `hits`.
    expect(opsFor("seo_404_hits")).toHaveLength(0);
    expect(mockState.ops.every((op) => op.kind === "rpc")).toBe(true);
    expect(warn).not.toHaveBeenCalled();
  });

  it("query jest ZACHOWANE w zapisanej ścieżce (shortlink WP to osobny wpis)", async () => {
    await maybeLog404(request("/?p=123"), html404());

    expect(only404Args()).toMatchObject({ _path: "/?p=123" });
  });

  it("ścieżka (pathname + search) jest obcinana do limitu BAZY (500), nie do 2048", async () => {
    // `record_seo_404` i tak robi `left(_path, 500)`; obcięcie w aplikacji do
    // innej długości dawało dwa źródła prawdy o tym, który wpis jest „tym".
    const pathname = `/${"a".repeat(450)}`;
    const search = `?${"b".repeat(300)}`;

    await maybeLog404(request(`${pathname}${search}`), html404());

    const path = String(only404Args()?._path);
    expect(path).toHaveLength(SEO_404_DB_LIMIT);
    expect(path.startsWith(`${pathname}?`)).toBe(true);
  });

  it("ścieżka krótsza niż limit przechodzi bez zmian (kontrola przed nad-obcinaniem)", async () => {
    const path = `/${"a".repeat(SEO_404_DB_LIMIT - 1)}`;

    await maybeLog404(request(path), html404());

    expect(only404Args()?._path).toBe(path);
  });

  const REFERERY: ReadonlyArray<{
    nazwa: string;
    naglowki: Record<string, string>;
    oczekiwany: string | undefined;
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
    // Brak referera = argument POMINIĘTY (DEFAULT NULL), a RPC robi
    // `COALESCE(EXCLUDED.last_referrer, h.last_referrer)`: wejście bez
    // referera NIE kasuje ostatniego znanego źródła ruchu.
    { nazwa: "oba nieobecne", naglowki: {}, oczekiwany: undefined },
  ];

  it.each(REFERERY)("$nazwa -> _referrer", async ({ naglowki, oczekiwany }) => {
    await maybeLog404(requestWithHeaders("/o-nas-2019", naglowki), html404());

    const args = only404Args();
    expect(args?._referrer).toBe(oczekiwany);
    expect(args !== null && "_referrer" in args).toBe(oczekiwany !== undefined);
  });

  it("referer dłuższy niż limit bazy (500) jest obcinany", async () => {
    const referer = `https://x.example/${"a".repeat(3000)}`;

    await maybeLog404(requestWithHeaders("/o-nas-2019", { referer }), html404());

    const stored = String(only404Args()?._referrer);
    expect(stored).toHaveLength(SEO_404_DB_LIMIT);
    expect(referer.startsWith(stored)).toBe(true);
  });

  // KLUCZOWA ASERCJA SEKCJI: monitor 404 jest telemetrią. Gdyby jego błąd
  // wychodził na zewnątrz, middleware wywróciłby ODPOWIEDŹ, którą właśnie
  // opisuje - z 404 zrobiłoby się 500.
  it.each([
    { tryb: "throw" as const, opis: "wyjątek klienta przy wywołaniu RPC" },
    { tryb: "reject" as const, opis: "odrzucona obietnica RPC" },
    { tryb: "error" as const, opis: "odpowiedź RPC z polem error" },
  ])("$opis NIE wychodzi z maybeLog404 i trafia do ostrzeżenia", async ({ tryb }) => {
    mockState.rpcFailure = tryb;

    await expect(maybeLog404(request("/o-nas-2019"), html404())).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith("[seo-404] log failed:", expect.any(Error));
  });

  it("nieudany import klienta service-role też jest połknięty", async () => {
    mockState.clientThrows = true;

    await expect(maybeLog404(request("/o-nas-2019"), html404())).resolves.toBeUndefined();
    expect(mockState.ops).toHaveLength(0);
    expect(warn).toHaveBeenCalledWith("[seo-404] log failed:", expect.any(Error));
  });

  it("udany zapis nie loguje niczego (kontrola negatywna ostrzeżenia)", async () => {
    await maybeLog404(request("/o-nas-2019"), html404());

    expect(warn).not.toHaveBeenCalled();
  });
});

describe("resolveRedirectForRequest - licznik trafień reguły (record_redirect_hit)", () => {
  /** Domyka całe tło żądania; rzuca, gdyby którakolwiek praca w tle odrzuciła. */
  async function drainBackground(): Promise<void> {
    await expect(Promise.all(mockState.background)).resolves.toBeDefined();
  }

  it("trafienie planuje JEDNO wywołanie RPC z id reguły, ZA odpowiedzią", async () => {
    mockState.redirectRows = [rule("/stary", "/nowy")];
    // Odpowiedź RPC wstrzymana: gdyby licznik stał na ścieżce żądania,
    // `resolveRedirectForRequest` nigdy by nie wróciła.
    mockState.rpcHeld = true;

    await expect(resolveRedirectForRequest(request("/stary"))).resolves.toEqual({
      target: "/nowy",
      status: 301,
    });

    await vi.waitFor(() => expect(rpcCalls("record_redirect_hit")).toHaveLength(1));
    expect(rpcCalls("record_redirect_hit")[0]?.payload).toEqual({ _id: "r/stary" });
    for (const release of mockState.heldRpc) release();
    await drainBackground();
    expect(warn).not.toHaveBeenCalled();
  });

  it("w łańcuchu A->B->C liczona jest reguła WEJŚCIOWA (A), nie końcowa", async () => {
    mockState.redirectRows = [rule("/a", "/b"), rule("/b", "/c", 302)];

    await expect(resolveRedirectForRequest(request("/a"))).resolves.toEqual({
      target: "/c",
      status: 302,
    });
    await drainBackground();

    // Cel i kod z reguły końcowej, licznik na regule, w którą wszedł czytelnik.
    expect(rpcCalls("record_redirect_hit").map((op) => op.payload)).toEqual([{ _id: "r/a" }]);
  });

  it("dopasowanie przez prefiks języka liczy regułę kanoniczną", async () => {
    mockState.redirectRows = [rule("/stary", "/nowy")];

    await expect(resolveRedirectForRequest(request("/en/stary"))).resolves.toEqual({
      target: "/en/nowy",
      status: 301,
    });
    await drainBackground();

    expect(rpcCalls("record_redirect_hit").map((op) => op.payload)).toEqual([{ _id: "r/stary" }]);
  });

  it("410 Gone też jest liczone (usunięty adres wciąż dostaje ruch)", async () => {
    mockState.redirectRows = [rule("/usuniete", "/", 410)];

    await expect(resolveRedirectForRequest(request("/usuniete"))).resolves.toEqual({
      target: "",
      status: 410,
    });
    await drainBackground();

    expect(rpcCalls("record_redirect_hit").map((op) => op.payload)).toEqual([
      { _id: "r/usuniete" },
    ]);
  });

  it("HEAD przekierowuje, ale NIE liczy (ruch narzędzi, nie czytelników)", async () => {
    mockState.redirectRows = [rule("/stary", "/nowy")];

    await expect(resolveRedirectForRequest(request("/stary", { method: "HEAD" }))).resolves.toEqual(
      { target: "/nowy", status: 301 },
    );
    await drainBackground();

    expect(rpcCalls("record_redirect_hit")).toHaveLength(0);
  });

  it("pudło na niepustym indeksie nie wywołuje RPC", async () => {
    mockState.redirectRows = [rule("/stary", "/nowy")];

    await expect(resolveRedirectForRequest(request("/inny-adres"))).resolves.toBeNull();
    await drainBackground();

    expect(rpcCalls("record_redirect_hit")).toHaveLength(0);
  });

  it("pętla odrzucona przez matcher nie jest liczona jako trafienie", async () => {
    mockState.redirectRows = [rule("/a", "/b"), rule("/b", "/a")];

    await expect(resolveRedirectForRequest(request("/a"))).resolves.toBeNull();
    await drainBackground();

    expect(rpcCalls("record_redirect_hit")).toHaveLength(0);
  });

  it("id pochodzi z indeksu tenanta HOSTA żądania", async () => {
    // Funkcja SQL aktualizuje po samym `id` - izolację daje to, że id bierze
    // się wyłącznie z odczytu przefiltrowanego tenantem hosta.
    mockState.tenantsByHost.set("drugi.example", "t-drugi");
    mockState.redirectRows = [{ ...rule("/stary", "/nowy"), id: "id-drugiego-tenanta" }];

    await resolveRedirectForRequest(request("/stary", { host: "drugi.example" }));
    await drainBackground();

    expect(opsFor("redirects")[0]?.filters).toEqual({ tenant_id: "t-drugi", is_enabled: true });
    expect(rpcCalls("record_redirect_hit").map((op) => op.payload)).toEqual([
      { _id: "id-drugiego-tenanta" },
    ]);
  });

  it.each([
    { tryb: "throw" as const, opis: "wyjątek klienta" },
    { tryb: "reject" as const, opis: "odrzucona obietnica" },
    { tryb: "error" as const, opis: "odpowiedź z polem error" },
  ])("awaria RPC ($opis) nie zmienia przekierowania i jest połknięta", async ({ tryb }) => {
    mockState.redirectRows = [rule("/stary", "/nowy")];
    mockState.rpcFailure = tryb;

    await expect(resolveRedirectForRequest(request("/stary"))).resolves.toEqual({
      target: "/nowy",
      status: 301,
    });
    await drainBackground();

    expect(warn).toHaveBeenCalledWith("[redirects] hit accounting failed:", expect.any(Error));
  });

  it("zwykły ruch (poniżej progu okna) jest liczony DOKŁADNIE: każde żądanie to jedno RPC", async () => {
    mockState.redirectRows = [rule("/stary", "/nowy")];

    await resolveRedirectForRequest(request("/stary"));
    await resolveRedirectForRequest(request("/stary?utm=x"));
    await drainBackground();

    expect(rpcCalls("record_redirect_hit")).toHaveLength(2);
  });
});

describe("resolveRedirectForRequest - dławienie licznika trafień (seria skanera)", () => {
  /** Budżet zapisów jednej reguły w oknie - lustro stałej modułu. */
  const ZAPISY_NA_OKNO = 5;
  /** Długość okna - lustro stałej modułu. */
  const OKNO_MS = 10_000;

  async function drainBackground(): Promise<void> {
    await expect(Promise.all(mockState.background)).resolves.toBeDefined();
  }

  it("seria GET-ów na wildcard 410 /wp-content/* daje najwyżej 5 zapisów w oknie, a każda odpowiedź to nadal 410", async () => {
    // Kształt produkcyjny: reguła z migracji 20260801152304, w którą biją skanery WP.
    mockState.redirectRows = [rule("/wp-content/*", "/", 410)];

    for (let i = 0; i < 50; i += 1) {
      await expect(
        resolveRedirectForRequest(request(`/wp-content/plugins/p${i}/readme`)),
      ).resolves.toEqual({ target: "", status: 410 });
    }
    await drainBackground();

    expect(rpcCalls("record_redirect_hit")).toHaveLength(ZAPISY_NA_OKNO);
    expect(new Set(rpcCalls("record_redirect_hit").map((op) => op.payload?._id))).toEqual(
      new Set(["r/wp-content/*"]),
    );
  });

  it("po upływie okna budżet się odnawia (licznik nie zamiera na stałe)", async () => {
    mockState.redirectRows = [rule("/stary", "/nowy")];

    for (let i = 0; i < ZAPISY_NA_OKNO + 3; i += 1) {
      await resolveRedirectForRequest(request("/stary"));
    }
    // Tuż przed końcem okna - nadal zdławione.
    vi.setSystemTime(Date.now() + OKNO_MS - 1);
    await resolveRedirectForRequest(request("/stary"));
    await drainBackground();
    expect(rpcCalls("record_redirect_hit")).toHaveLength(ZAPISY_NA_OKNO);

    // Granica okna - nowe okno, nowy budżet.
    vi.setSystemTime(Date.now() + 1);
    await resolveRedirectForRequest(request("/stary"));
    await drainBackground();
    expect(rpcCalls("record_redirect_hit")).toHaveLength(ZAPISY_NA_OKNO + 1);
  });

  it("budżet jest PER REGUŁA: seria na jednej nie zjada liczenia drugiej", async () => {
    mockState.redirectRows = [rule("/wp-json/*", "/", 410), rule("/stary", "/nowy")];

    for (let i = 0; i < 20; i += 1) {
      await resolveRedirectForRequest(request(`/wp-json/wp/v2/users/${i}`));
    }
    await resolveRedirectForRequest(request("/stary"));
    await drainBackground();

    const ids = rpcCalls("record_redirect_hit").map((op) => op.payload?._id);
    expect(ids.filter((id) => id === "r/wp-json/*")).toHaveLength(ZAPISY_NA_OKNO);
    expect(ids.filter((id) => id === "r/stary")).toHaveLength(1);
  });

  it("HEAD nie zużywa budżetu okna (nie jest liczone w ogóle)", async () => {
    mockState.redirectRows = [rule("/stary", "/nowy")];

    for (let i = 0; i < 10; i += 1) {
      await resolveRedirectForRequest(request("/stary", { method: "HEAD" }));
    }
    for (let i = 0; i < ZAPISY_NA_OKNO; i += 1) {
      await resolveRedirectForRequest(request("/stary"));
    }
    await drainBackground();

    expect(rpcCalls("record_redirect_hit")).toHaveLength(ZAPISY_NA_OKNO);
  });

  it("zdławione trafienie nie planuje żadnej pracy w tle", async () => {
    mockState.redirectRows = [rule("/stary", "/nowy")];
    for (let i = 0; i < ZAPISY_NA_OKNO; i += 1) {
      await resolveRedirectForRequest(request("/stary"));
    }
    await drainBackground();
    const pracePrzed = mockState.background.length;

    await resolveRedirectForRequest(request("/stary"));

    expect(mockState.background).toHaveLength(pracePrzed);
  });

  it("tysiące różnych reguł nie blokują liczenia nowej (sufit pamięci zwalnia miejsce)", async () => {
    // Sufit mapy to 2 000 wpisów; 2 100 reguł przekracza go o 100.
    const reguly = Array.from({ length: 2_100 }, (_, i) => rule(`/stary-${i}`, "/nowy"));
    mockState.redirectRows = reguly;

    for (const r of reguly) await resolveRedirectForRequest(request(r.source_path));
    await drainBackground();

    // Każda reguła dostała swój pierwszy zapis - przepełnienie nie gubi liczenia.
    expect(rpcCalls("record_redirect_hit")).toHaveLength(2_100);
  });
});
