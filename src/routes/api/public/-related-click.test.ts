// @vitest-environment node
//
// ŚRODOWISKO NODE, NIE HAPPY-DOM. `Request` z happy-dom wycina nagłówki
// zakazane w przeglądarce (`Origin`, `Sec-Fetch-Site`) - a to dokładnie te,
// po których bramka CSRF rozpoznaje cudzą stronę. Endpoint i tak biegnie na
// serwerze, więc `Request` z Node jest tym prawdziwym (wzorzec
// `-sponsor-event.test.ts`).
//
// Beacon kliknięć w rekomendacje: POST /api/public/related-click.
//
// PO CO. Trasa nie miała ŻADNEGO testu, a jest publicznym ZAPISEM do
// `related_post_clicks` na prefiksie `/api/public/*`, który omija broker
// uwierzytelnienia platformy. Cały ciężar decyzji „czy ten wiersz ma powstać"
// spoczywa na handlerze: walidacja Zod, limiter per `viewer_hash`, zgodność
// tenanta obu wpisów i kształt odpowiedzi błędu.
//
// Zapory, których pilnuje ten plik po wydaniu domykającym granicę publiczną:
//   1. 500 NIE oddaje komunikatu Postgresa - na ścieżce bez sesji nazwy tabel,
//      kolumn i ograniczeń są darmową mapą schematu dla dalszego ataku.
//   2. POST z OBCEGO originu dostaje 403. Sam preflight niczego nie bronił:
//      `text/plain` z ciałem JSON go nie wymaga, a handler czyta ciało bez
//      względu na `Content-Type` - obca strona wysyłała więc POST przeglądarką
//      swojego gościa i wiersz z `viewer_hash` OFIARY powstawał.
//   3. Preflight odbija Origin wyłącznie według tej samej reguły co POST: host
//      żądania albo domena ZAREJESTROWANA w katalogu tenantów.
//   4. `viewer_hash` liczony ze WSPÓLNEJ definicji „kto dzwoni" - pierwszy wpis
//      `x-forwarded-for` pochodzi od klienta, więc kubełek po nim kluczowany
//      rotował się jednym nagłówkiem.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { freezeClock, relativeIso, MINUTA } from "@/test/time";

interface ClickRow {
  tenant_id: string;
  viewer_hash: string;
  clicked_at: string;
}

interface InsertedRow {
  tenant_id: string;
  source_post_id: string;
  target_post_id: string;
  viewer_hash: string;
}

const h = vi.hoisted(() => {
  const state = {
    /** Wiersze już zapisane - atrapa FILTRUJE po nich naprawdę. */
    clicks: [] as { tenant_id: string; viewer_hash: string; clicked_at: string }[],
    posts: new Map<string, { tenant_id: string }>(),
    inserted: [] as Record<string, unknown>[],
    insertError: null as { message: string } | null,
    /** Awaria licznika limitera - PostgREST oddaje wtedy `count: null`. */
    countError: null as { message: string } | null,
    /** Tabele, których dotknął handler - bramka CSRF ma stać PRZED bazą. */
    tables: [] as string[],
    tenantDomains: ["redakcja.example.test"] as string[],
  };

  // Atrapa łańcucha PostgREST, która REALNIE stosuje zapisane filtry: licznik
  // klików liczy wyłącznie wiersze tego NAJEMCY i tego `viewer_hash`, nie
  // starsze niż `clicked_at >= since`, a odczyt wpisu oddaje wiersz spod
  // podanego `id`. Atrapa zwracająca stałą „dowodziłaby" limitu, którego nie ma.
  //
  // FILTR NAJEMCY DOSZEDŁ 2026-09-14 RAZEM Z NAPRAWĄ TRASY. Do tego dnia atrapa
  // czytała wyłącznie `viewer_hash` i `clicked_at`, więc PRZEPUŚCIŁABY handler
  // liczący bez `tenant_id` - czyli dokładnie defekt, który naprawiamy: licznik
  // sumował ruch wszystkich najemców i aktywny najemca wyczerpywał limit
  // czytelnikom cudzego serwisu. Atrapa, która ignoruje filtr, nie dowodzi
  // zawężenia; ta go wymusza.
  function from(table: string): unknown {
    state.tables.push(table);
    const filters = new Map<string, unknown>();
    const builder: Record<string, unknown> = {};
    const self = () => builder;

    builder.select = () => self();
    builder.eq = (column: string, value: unknown) => {
      filters.set(column, value);
      return self();
    };
    builder.gte = (column: string, value: unknown) => {
      filters.set(`gte:${column}`, value);
      return self();
    };
    builder.maybeSingle = async () => {
      const id = String(filters.get("id") ?? "");
      const row = state.posts.get(id);
      return { data: row ?? null, error: null };
    };
    builder.insert = async (row: Record<string, unknown>) => {
      state.inserted.push(row);
      return { error: state.insertError };
    };
    builder.then = (
      onFulfilled: (value: {
        count: number | null;
        data: null;
        error: { message: string } | null;
      }) => unknown,
    ) => {
      if (table !== "related_post_clicks") {
        throw new Error(`test: nieoczekiwany odczyt tabeli "${table}"`);
      }
      if (state.countError) {
        return Promise.resolve({ count: null, data: null, error: state.countError }).then(
          onFulfilled,
        );
      }
      const tenant = String(filters.get("tenant_id") ?? "");
      const viewer = String(filters.get("viewer_hash") ?? "");
      const since = String(filters.get("gte:clicked_at") ?? "");
      const count = state.clicks.filter(
        (click) =>
          click.tenant_id === tenant && click.viewer_hash === viewer && click.clicked_at >= since,
      ).length;
      return Promise.resolve({ count, data: null, error: null }).then(onFulfilled);
    };
    return builder;
  }

  return { state, from };
});

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: { from: h.from },
}));
vi.mock("@/lib/server/tenant.server", () => ({
  // Katalog tenantów jest bramką preflightu: Origin odbijamy wyłącznie dla
  // domen w nim zarejestrowanych (mikrosite'y stoją na własnych domenach).
  getTenantDirectory: async () => ({
    byDomain: new Map(
      h.state.tenantDomains.map((domain) => [
        domain,
        { id: "tenant-1", slug: "redakcja", domain, isDefault: true },
      ]),
    ),
    defaultTenant: { id: "tenant-1", slug: "redakcja", domain: null, isDefault: true },
  }),
}));

import { routeServerHandlers } from "@/test/routeHarness";
import { Route } from "@/routes/api/public/related-click";

const handlers = routeServerHandlers(Route);
const POST = handlers.POST!;
const OPTIONS = handlers.OPTIONS!;

const SOURCE_ID = "11111111-2222-3333-4444-555555555555";
const TARGET_ID = "66666666-7777-8888-9999-aaaaaaaaaaaa";
// Najemca obu zasiewanych wpisów. Limiter jest od 2026-09-14 zawężony do niego,
// więc stała musi być jedna dla zasiewu wpisów, zasiewu klików i asercji zapisu.
const TENANT_ZRODLA = "tenant-1";
const TENANT_OBCY = "tenant-2";

freezeClock();

function body(patch: Record<string, unknown> = {}): Record<string, unknown> {
  return { sourcePostId: SOURCE_ID, targetPostId: TARGET_ID, ...patch };
}

const BEACON_URL = "https://redakcja.example.test/api/public/related-click";

function post(
  payload: unknown,
  options: { raw?: string; headers?: Record<string, string>; url?: string } = {},
): Promise<Response> {
  return POST({
    request: new Request(options.url ?? BEACON_URL, {
      method: "POST",
      headers: {
        "cf-connecting-ip": "203.0.113.10",
        "user-agent": "Firefox/1",
        ...(options.headers ?? {}),
      },
      body: options.raw ?? JSON.stringify(payload),
    }),
  });
}

/**
 * Żądanie preflightu. Domyślny cel to INNY host niż domeny tenantów
 * zasiewane w testach - inaczej każdy origin „przechodziłby" jako własny
 * host żądania, a nie jako domena z katalogu.
 */
function preflightRequest(
  origin?: string,
  url = "https://nes.example.test/api/public/related-click",
): Request {
  return new Request(url, { method: "OPTIONS", headers: origin ? { origin } : {} });
}

/** Ostatni zapisany wiersz w kształcie, o który pytają asercje. */
function lastInserted(): InsertedRow {
  const row = h.state.inserted.at(-1);
  if (!row) throw new Error("test: nie zapisano żadnego wiersza");
  return row as unknown as InsertedRow;
}

/** Wiersze klików tego samego widza w oknie limitu (domyślnie najemca źródła). */
function clicksOf(viewerHash: string, count: number, tenantId = TENANT_ZRODLA): ClickRow[] {
  return Array.from({ length: count }, () => ({
    tenant_id: tenantId,
    viewer_hash: viewerHash,
    clicked_at: relativeIso(-1 * MINUTA),
  }));
}

beforeEach(() => {
  h.state.clicks = [];
  h.state.posts = new Map([
    [SOURCE_ID, { tenant_id: TENANT_ZRODLA }],
    [TARGET_ID, { tenant_id: TENANT_ZRODLA }],
  ]);
  h.state.inserted = [];
  h.state.insertError = null;
  h.state.countError = null;
  h.state.tables = [];
  h.state.tenantDomains = ["redakcja.example.test"];
});

// ---------------------------------------------------------------------------
describe("zapis kliknięcia", () => {
  it("prawidłowa para wpisów zapisuje wiersz z tenantem ŹRÓDŁA i oddaje 202", async () => {
    const res = await post(body());

    expect(res.status).toBe(202);
    expect(lastInserted()).toMatchObject({
      tenant_id: TENANT_ZRODLA,
      source_post_id: SOURCE_ID,
      target_post_id: TARGET_ID,
    });
    expect(lastInserted().viewer_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("`viewer_hash` NIE zawiera surowego adresu - tabela klików nie jest rejestrem IP", async () => {
    await post(body(), { headers: { "cf-connecting-ip": "203.0.113.42" } });

    expect(lastInserted().viewer_hash).not.toContain("203.0.113.42");
  });

  it("brak `user-agent` nie wywala zapisu - hash liczy się z samego adresu", async () => {
    const res = await POST({
      request: new Request(BEACON_URL, {
        method: "POST",
        headers: { "cf-connecting-ip": "203.0.113.10" },
        body: JSON.stringify(body()),
      }),
    });

    expect(res.status).toBe(202);
    expect(lastInserted().viewer_hash).toMatch(/^[0-9a-f]{64}$/);
  });
});

// ---------------------------------------------------------------------------
describe("walidacja wejścia", () => {
  it("ciało niebędące JSON-em kończy się 400, a nie wyjątkiem", async () => {
    const res = await post(null, { raw: "to nie jest json" });

    expect(res.status).toBe(400);
    expect(h.state.inserted).toHaveLength(0);
  });

  it("identyfikator spoza formatu UUID jest odrzucany przed dotknięciem bazy", async () => {
    const res = await post(body({ sourcePostId: "'; drop table posts; --" }));

    expect(res.status).toBe(400);
    expect(h.state.inserted).toHaveLength(0);
  });

  it("kliknięcie wpisu W SAMEGO SIEBIE jest odrzucane - rekomendacja na siebie nie istnieje", async () => {
    const res = await post(body({ targetPostId: SOURCE_ID }));

    expect(res.status).toBe(400);
    expect(await res.text()).toBe("Self-reference");
    expect(h.state.inserted).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
describe("limiter", () => {
  it("30 klików tego samego widza w oknie 5 min kończy się 429 i NIE zapisuje wiersza", async () => {
    const probe = await post(body());
    const viewer = lastInserted().viewer_hash;
    expect(probe.status).toBe(202);
    h.state.inserted = [];
    h.state.clicks = clicksOf(viewer, 30);

    const res = await post(body());

    expect(res.status).toBe(429);
    expect(h.state.inserted).toHaveLength(0);
  });

  it("limit dotyczy TEGO widza - kliki innego widza nie blokują nikogo", async () => {
    h.state.clicks = clicksOf("inny-widz-hash", 100);

    const res = await post(body());

    expect(res.status).toBe(202);
  });

  // REGRESJA IZOLACJI NAJEMCY W LIMITERZE.
  //
  // Do 2026-09-14 licznik pytał WYŁĄCZNIE o `viewer_hash`, więc sumował kliki
  // wszystkich najemców naraz: aktywny serwis wyczerpywał limit czytelnikom
  // cudzego. Ten przypadek zasiewa komplet klików TEGO SAMEGO widza pod OBCYM
  // najemcą - po naprawie nie mają one prawa zablokować zapisu w najemcy źródła.
  // Uwaga dla czytającego: przed naprawą ten test zwracał 429, nie 202.
  it("kliki tego samego widza u INNEGO najemcy nie wyczerpują limitu", async () => {
    const probe = await post(body());
    const viewer = lastInserted().viewer_hash;
    expect(probe.status).toBe(202);
    h.state.inserted = [];
    h.state.clicks = clicksOf(viewer, 100, TENANT_OBCY);

    const res = await post(body());

    expect(res.status).toBe(202);
    expect(h.state.inserted).toHaveLength(1);
  });

  it("kliki STARSZE niż okno 5 min nie liczą się do limitu", async () => {
    const probe = await post(body());
    const viewer = lastInserted().viewer_hash;
    expect(probe.status).toBe(202);
    h.state.clicks = Array.from({ length: 50 }, () => ({
      tenant_id: TENANT_ZRODLA,
      viewer_hash: viewer,
      clicked_at: relativeIso(-30 * MINUTA),
    }));

    const res = await post(body());

    expect(res.status).toBe(202);
  });

  it("ten sam cf-connecting-ip z RÓŻNYM x-forwarded-for daje TEN SAM `viewer_hash`", async () => {
    // Gdyby o kluczu decydował pierwszy wpis `x-forwarded-for`, limit 30/5 min
    // rotowałby się jednym nagłówkiem - czyli nie istniałby.
    await post(body(), { headers: { "x-forwarded-for": "1.1.1.1" } });
    await post(body(), { headers: { "x-forwarded-for": "2.2.2.2, 3.3.3.3" } });

    const [first, second] = h.state.inserted as unknown as InsertedRow[];
    expect(first.viewer_hash).toBe(second.viewer_hash);
  });

  it("awaria LICZNIKA nie gasi beaconu - `count: null` liczy się jak zero", async () => {
    // Świadomy fail-open: to telemetria, nie bramka dostępu. Gdyby `null`
    // porównywać wprost, `null >= 30` jest fałszem i wynik byłby ten sam - ale
    // jawne `?? 0` mówi, że to decyzja, nie przypadek.
    h.state.countError = { message: "statement timeout" };

    const res = await post(body());

    expect(res.status).toBe(202);
    expect(h.state.inserted).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
describe("izolacja najemcy", () => {
  it("nieistniejący wpis ŹRÓDŁOWY kończy się 404", async () => {
    h.state.posts.delete(SOURCE_ID);

    const res = await post(body());

    expect(res.status).toBe(404);
    expect(await res.text()).toBe("Source not found");
  });

  it("nieistniejący wpis DOCELOWY kończy się 404", async () => {
    h.state.posts.delete(TARGET_ID);

    const res = await post(body());

    expect(res.status).toBe(404);
    expect(await res.text()).toBe("Target not found");
  });

  it("wpisy RÓŻNYCH tenantów są odrzucane - klik z witryny A nie zasila raportu firmy B", async () => {
    h.state.posts.set(TARGET_ID, { tenant_id: "tenant-OBCY" });

    const res = await post(body());

    expect(res.status).toBe(400);
    expect(await res.text()).toBe("Cross-tenant blocked");
    expect(h.state.inserted).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
describe("granica publiczna", () => {
  it("500 NIE oddaje treści błędu Postgresa - anonim nie dostaje mapy schematu", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    h.state.insertError = {
      message: 'insert violates foreign key constraint "related_post_clicks_tenant_id_fkey"',
    };

    const res = await post(body());
    const text = await res.text();

    expect(res.status).toBe(500);
    expect(text).toBe("Insert failed");
    expect(text).not.toContain("related_post_clicks_tenant_id_fkey");
    expect(logged).toHaveBeenCalledWith(
      "[related-click] insert failed",
      expect.stringContaining("related_post_clicks_tenant_id_fkey"),
    );
    logged.mockRestore();
  });

  it("preflight ZNANEJ domeny tenanta odbija Origin i ustawia `Vary: Origin`", async () => {
    // Cel to `nes.example.test`, origin - zarejestrowany mikrosite: przechodzi
    // KATALOGIEM, a nie jako własny host żądania.
    const res = await OPTIONS({ request: preflightRequest("https://redakcja.example.test") });

    expect(res.status).toBe(204);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("https://redakcja.example.test");
    expect(res.headers.get("Access-Control-Allow-Methods")).toBe("POST, OPTIONS");
    expect(res.headers.get("Vary")).toBe("Origin");
  });

  it("preflight OBCEGO originu nie dostaje nagłówków CORS - to endpoint ZAPISU", async () => {
    const res = await OPTIONS({ request: preflightRequest("https://zlodziej.example") });

    expect(res.status).toBe(204);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBeNull();
    expect(res.headers.get("Access-Control-Allow-Methods")).toBeNull();
    expect(res.headers.get("Vary")).toBe("Origin");
  });

  it("lokalny dev przechodzi jako TEN SAM HOST - port się nie liczy, katalog niepotrzebny", async () => {
    h.state.tenantDomains = [];
    const res = await OPTIONS({
      request: preflightRequest(
        "http://localhost:5173",
        "http://localhost:3000/api/public/related-click",
      ),
    });

    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("http://localhost:5173");
    expect(res.headers.get("Access-Control-Allow-Headers")).toBe("content-type");
  });

  it("CUDZY host podglądu nie dostaje CORS - `*.pages.dev` może założyć każdy", async () => {
    // Do tego wydania preflight przepuszczał KAŻDY host z `isPreviewHost`,
    // czyli także darmową subdomenę `pages.dev` atakującego.
    const res = await OPTIONS({ request: preflightRequest("https://zlodziej.pages.dev") });

    expect(res.status).toBe(204);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });

  it("preflight bez Origin i z Originem niebędącym adresem nie wywala się na wyjątku", async () => {
    const bare = await OPTIONS({ request: preflightRequest() });
    const broken = await OPTIONS({ request: preflightRequest("to-nie-jest-adres") });

    expect(bare.status).toBe(204);
    expect(bare.headers.get("Access-Control-Allow-Origin")).toBeNull();
    expect(broken.status).toBe(204);
    expect(broken.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// BRAMKA CSRF ZAPISU.
//
// Do tego wydania POST nie czytał ani `Origin`, ani `Sec-Fetch-Site`, a komentarz
// nad preflightem powoływał się na „gate tenanta w POST", którego nie było.
// Każdy przypadek „obcy origin" niżej zwracał przed naprawą 202 i zapisywał
// wiersz - czyli dokładnie sfabrykowany klik z `viewer_hash` ofiary.
describe("bramka CSRF zapisu", () => {
  it("POST z OBCEGO originu dostaje 403 i nie dotyka bazy", async () => {
    const res = await post(body(), { headers: { origin: "https://zlodziej.example" } });

    expect(res.status).toBe(403);
    expect(await res.text()).toBe("Forbidden origin");
    expect(h.state.inserted).toHaveLength(0);
    // Odrzucenie PRZED odczytem wpisów i licznikiem: fałszywka nie kosztuje
    // ani jednego zapytania.
    expect(h.state.tables).toEqual([]);
  });

  it("Origin = host żądania przechodzi także bez wpisu w katalogu tenantów", async () => {
    h.state.tenantDomains = [];

    const own = await post(body(), { headers: { origin: "https://redakcja.example.test" } });
    const www = await post(body(), { headers: { origin: "https://www.redakcja.example.test" } });

    expect(own.status).toBe(202);
    expect(www.status).toBe(202);
    expect(h.state.inserted).toHaveLength(2);
  });

  it("za pośrednikiem Origin zgodny z `X-Forwarded-Host` przechodzi, choć adres niesie host wewnętrzny", async () => {
    // Porównanie z samym `request.url` odrzucałoby tu KAŻDY prawdziwy beacon.
    h.state.tenantDomains = [];

    const res = await post(body(), {
      url: "https://worker-7.internal.example/api/public/related-click",
      headers: {
        origin: "https://redakcja.example.test",
        "x-forwarded-host": "redakcja.example.test, edge.internal.example",
      },
    });

    expect(res.status).toBe(202);
    expect(h.state.inserted).toHaveLength(1);
  });

  it("mikrosite z KATALOGU tenantów przechodzi, nawet gdy przeglądarka mówi `cross-site`", async () => {
    h.state.tenantDomains = ["mikrosite.example.test"];

    const res = await post(body(), {
      headers: { origin: "https://mikrosite.example.test", "sec-fetch-site": "cross-site" },
    });

    expect(res.status).toBe(202);
    expect(h.state.inserted).toHaveLength(1);
  });

  it("cudzy host PODGLĄDU nie jest wyjątkiem - `*.pages.dev` może założyć każdy", async () => {
    const res = await post(body(), { headers: { origin: "https://zlodziej.pages.dev" } });

    expect(res.status).toBe(403);
    expect(h.state.inserted).toHaveLength(0);
  });

  it("`Origin: null` (piaskownica) i origin bez hosta są odrzucane", async () => {
    const sandbox = await post(body(), { headers: { origin: "null" } });
    const hostless = await post(body(), { headers: { origin: "file:///etc/passwd" } });

    expect(sandbox.status).toBe(403);
    expect(hostless.status).toBe(403);
    expect(h.state.inserted).toHaveLength(0);
  });

  it("brak Origin przy `Sec-Fetch-Site: cross-site` dostaje 403", async () => {
    const res = await post(body(), { headers: { "sec-fetch-site": "cross-site" } });

    expect(res.status).toBe(403);
    expect(h.state.inserted).toHaveLength(0);
  });

  it("brak Origin bez sygnału cross-site przechodzi jak dotąd (starsze przeglądarki)", async () => {
    const bare = await post(body());
    const sameOrigin = await post(body(), { headers: { "sec-fetch-site": "same-origin" } });

    expect(bare.status).toBe(202);
    expect(sameOrigin.status).toBe(202);
    expect(h.state.inserted).toHaveLength(2);
  });
});
