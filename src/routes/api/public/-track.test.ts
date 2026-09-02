// Ingest zdarzeń analitycznych: POST /api/public/track.
//
// PO CO. To jest JEDNA Z CZTERECH publicznie osiągalnych ścieżek ZAPISU w tej
// platformie, do której dowolny klient dociera bez sesji i bez podpisu:
// `src/lib/analytics/track.ts` wysyła batch `sendBeacon`em, a endpoint wstawia
// wiersze klientem service_role, czyli z pominięciem RLS. Cała jego obrona to
// walidacja wejścia i limiter - i do wydania 8 audytu nie miał ani jednego
// testu (0/43 linii, 0/4 funkcji), przy 95,4-100% na każdym endpoincie, który
// swój test ma.
//
// Trzy reguły, których pilnuje ten plik (wzorzec: `-popup-event.test.ts`):
//   * nieznany `event_type` rozsypuje raport NA ZAWSZE - wiersza, którego panel
//     nie umie policzyć, nikt potem nie odczyści;
//   * batch bez limitu długości (`MAX_EVENTS`, `MAX_BODY`, `MAX_META_BYTES`,
//     `MAX_STRING`) to zapchanie pamięci workera JEDNYM żądaniem;
//   * `path`/`referrer` idą przez `redactUrl`, bo query string bywa nośnikiem
//     tokenów i adresów e-mail - RODO nie kończy się na froncie.
//
// Czwarta, wspólna dla wszystkich beaconów: KAŻDA ścieżka oddaje 204 i połyka
// błąd. Beacon nie ma jak obsłużyć odpowiedzi, a 5xx w odpowiedzi na
// `sendBeacon` w części przeglądarek ląduje w konsoli odwiedzającego.
import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  insert: vi.fn(),
  tenantId: "tenant-1" as string | null,
  tenantThrows: false,
}));

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: { from: () => ({ insert: h.insert }) },
}));
vi.mock("@/lib/server/tenant.server", () => ({
  resolveTenantIdForHost: async () => {
    if (h.tenantThrows) throw new Error("brak katalogu tenantów");
    return h.tenantId;
  },
}));
vi.mock("@/lib/http/requestHost", () => ({
  currentTenantHost: async () => "redakcja.example.test",
}));

const req = vi.hoisted(() => ({ current: null as Request | null }));
vi.mock("@tanstack/react-start/server", () => ({ getRequest: () => req.current }));

import { routeServerHandlers } from "@/test/routeHarness";
import { Route } from "@/routes/api/public/track";

const handler = routeServerHandlers(Route).POST!;

/** Żądanie z unikalnym adresem klienta - limiter jest wspólny dla modułu. */
let ipCounter = 0;
function uniqueIp(): string {
  ipCounter += 1;
  return `10.2.${Math.floor(ipCounter / 250)}.${ipCounter % 250}`;
}

interface EventInput {
  type?: unknown;
  name?: unknown;
  entity_type?: unknown;
  entity_id?: unknown;
  meta?: unknown;
  path?: unknown;
  referrer?: unknown;
  session_id?: unknown;
  anon_id?: unknown;
  lang?: unknown;
}

function beacon(body: unknown, raw?: string, headers?: Record<string, string>): Request {
  return new Request("https://redakcja.example.test/api/public/track", {
    method: "POST",
    headers: { "x-forwarded-for": uniqueIp(), ...(headers ?? {}) },
    body: raw ?? JSON.stringify(body),
  });
}

async function post(body: unknown, raw?: string, headers?: Record<string, string>) {
  req.current = beacon(body, raw, headers);
  return handler({ request: req.current });
}

/** Skrót: batch jednego prawidłowego zdarzenia z nadpisanymi polami. */
async function postOne(event: EventInput, headers?: Record<string, string>) {
  return post(
    { events: [{ type: "cta_click", name: "pricing_signup_click", ...event }] },
    undefined,
    headers,
  );
}

/** Wiersze przekazane do `insert` w ostatnim wywołaniu. */
function insertedRows(): Record<string, unknown>[] {
  const call = h.insert.mock.calls[0];
  return (call?.[0] ?? []) as Record<string, unknown>[];
}

beforeEach(() => {
  h.insert.mockReset();
  h.insert.mockResolvedValue({ error: null });
  h.tenantId = "tenant-1";
  h.tenantThrows = false;
});

// ---------------------------------------------------------------------------
describe("zapis batcha", () => {
  it("prawidłowy batch zapisuje JEDEN wielowierszowy insert, nie N pojedynczych", async () => {
    // To jest cały sens batchowania po stronie klienta: 20 zdarzeń ma kosztować
    // jeden round-trip do bazy, a nie dwadzieścia.
    const res = await post({
      events: [
        { type: "page_view", name: "page_view", path: "/o-nas" },
        { type: "cta_click", name: "pricing_signup_click" },
        { type: "search", name: "internal_search", entity_type: "search_query", entity_id: "cee" },
      ],
    });

    expect(res.status).toBe(204);
    expect(h.insert).toHaveBeenCalledTimes(1);
    expect(insertedRows()).toHaveLength(3);
  });

  it("wiersz niesie TENANTA rozwiązanego z hosta - raport obcej instalacji nie jest zatruwany", async () => {
    await postOne({});

    expect(insertedRows()[0]).toMatchObject({ tenant_id: "tenant-1" });
  });

  it("BRAK tenanta zostawia kolumnę pustą - domyślna wartość kolumny wchodzi w grę", async () => {
    h.tenantId = null;

    await postOne({});

    expect(Object.keys(insertedRows()[0]!)).not.toContain("tenant_id");
    // Wiersz JEST zapisywany - brak tenanta nie gubi zdarzenia.
    expect(insertedRows()).toHaveLength(1);
  });

  it("AWARIA rozwiązania tenanta nie blokuje zapisu", async () => {
    h.tenantThrows = true;

    const res = await postOne({});

    expect(res.status).toBe(204);
    expect(insertedRows()).toHaveLength(1);
  });

  it("mapowanie pól wejścia na kolumny jest pełne i stabilne", async () => {
    await postOne({
      type: "view",
      name: "post_view",
      entity_type: "post",
      entity_id: "abc",
      session_id: "sess-1",
      anon_id: "anon-1",
      lang: "pl",
      path: "/wpis/x",
      referrer: "https://example.org/skad",
      meta: { position: 3 },
    });

    expect(insertedRows()[0]).toMatchObject({
      event_type: "view",
      event_name: "post_view",
      entity_type: "post",
      entity_id: "abc",
      session_id: "sess-1",
      anon_id: "anon-1",
      lang: "pl",
      path: "/wpis/x",
      referrer: "https://example.org/skad",
      meta: { position: 3 },
    });
  });

  it("USER-AGENT z nagłówka trafia do wiersza, przycięty", async () => {
    await postOne({}, { "user-agent": "Mozilla/5.0 " + "x".repeat(400) });

    const ua = insertedRows()[0]!.ua as string;
    expect(ua.startsWith("Mozilla/5.0")).toBe(true);
    expect(ua.length).toBe(300);
  });

  it("odpowiedź NIE JEST cachowana - beacon musi dojść za każdym razem", async () => {
    const res = await postOne({});

    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(res.status).toBe(204);
  });
});

// ---------------------------------------------------------------------------
describe("walidacja wejścia", () => {
  it("PUSTA tablica zdarzeń nie dotyka bazy", async () => {
    const res = await post({ events: [] });

    expect(res.status).toBe(204);
    expect(h.insert).not.toHaveBeenCalled();
  });

  it("brak pola `events` nie dotyka bazy", async () => {
    await post({ foo: "bar" });

    expect(h.insert).not.toHaveBeenCalled();
  });

  it("`events` niebędące tablicą nie dotyka bazy", async () => {
    await post({ events: { name: "x" } });

    expect(h.insert).not.toHaveBeenCalled();
  });

  it("ponad MAX_EVENTS = 40 zdarzeń jest PRZYCINANE do 40, a nie odrzucane w całości", async () => {
    // Przycięcie, nie odrzucenie: klient, który przekroczył limit, i tak
    // dostarcza pierwsze 40 zdarzeń - inaczej jeden zbyt duży batch gubi
    // cały ruch sesji.
    await post({
      events: Array.from({ length: 55 }, (_, i) => ({ type: "interaction", name: `e${i}` })),
    });

    expect(insertedRows()).toHaveLength(40);
  });

  it("ciało ponad MAX_BODY = 32 000 znaków jest odrzucane BEZ parsowania", async () => {
    // Bez limitu jedno żądanie zapycha pamięć workera.
    const raw = JSON.stringify({
      events: [{ type: "interaction", name: "x", meta: { pad: "y".repeat(40_000) } }],
    });
    expect(raw.length).toBeGreaterThan(32_000);

    const res = await post(null, raw);

    expect(res.status).toBe(204);
    expect(h.insert).not.toHaveBeenCalled();
  });

  it("TYP spoza ALLOWED_TYPES jest pomijany - jeden zły wiersz nie rozsypuje raportu", async () => {
    await post({
      events: [
        { type: "wlasny_typ", name: "a" },
        { type: "page_view", name: "b" },
      ],
    });

    expect(insertedRows()).toHaveLength(1);
    expect(insertedRows()[0]).toMatchObject({ event_name: "b" });
  });

  it("BRAK typu domyślnie wpada w `interaction`, które jest dozwolone", async () => {
    await post({ events: [{ name: "bez_typu" }] });

    expect(insertedRows()[0]).toMatchObject({ event_type: "interaction" });
  });

  it("zdarzenie bez NAZWY jest pomijane - wiersz bez nazwy jest niepoliczalny", async () => {
    await post({
      events: [
        { type: "page_view" },
        { type: "page_view", name: "   " },
        { type: "page_view", name: "ok" },
      ],
    });

    expect(insertedRows()).toHaveLength(1);
    expect(insertedRows()[0]).toMatchObject({ event_name: "ok" });
  });

  it("ENTITY_TYPE spoza ALLOWED_ENTITIES jest zerowany, ale zdarzenie zostaje", async () => {
    // Encja jest atrybutem opisowym, nie kluczem zdarzenia: nieznana wartość
    // ma zniknąć, samo zdarzenie ma się policzyć.
    await postOne({ entity_type: "wymyslona_encja", entity_id: "1" });

    expect(insertedRows()[0]).toMatchObject({ entity_type: null, entity_id: "1" });
  });

  it("wszystkie napisy są przycinane do limitów kolumn", async () => {
    await postOne({
      name: "n".repeat(300),
      entity_id: "e".repeat(300),
      session_id: "s".repeat(300),
      anon_id: "a".repeat(300),
      lang: "pl-PL-x-long",
      path: "/" + "p".repeat(900),
    });

    const row = insertedRows()[0]!;
    expect((row.event_name as string).length).toBe(120);
    expect((row.entity_id as string).length).toBe(120);
    expect((row.session_id as string).length).toBe(80);
    expect((row.anon_id as string).length).toBe(80);
    expect((row.lang as string).length).toBe(8);
    expect((row.path as string).length).toBeLessThanOrEqual(512);
  });

  it("pola innego typu niż napis stają się `null`, nie łańcuchem `[object Object]`", async () => {
    await postOne({ entity_id: 12_345, session_id: { a: 1 }, lang: ["pl"] });

    expect(insertedRows()[0]).toMatchObject({ entity_id: null, session_id: null, lang: null });
  });

  it("META ponad MAX_META_BYTES = 4 000 znaków jest zastępowana pustym obiektem", async () => {
    await postOne({ meta: { pad: "z".repeat(5_000) } });

    expect(insertedRows()[0]).toMatchObject({ meta: {} });
  });

  it("META niebędąca obiektem (tablica, napis, null) staje się pustym obiektem", async () => {
    await post({
      events: [
        { type: "interaction", name: "a", meta: ["x"] },
        { type: "interaction", name: "b", meta: "x" },
        { type: "interaction", name: "c", meta: null },
      ],
    });

    for (const row of insertedRows()) expect(row).toMatchObject({ meta: {} });
  });

  it("META TUŻ PONIŻEJ limitu przechodzi w całości - próg nie jest ustawiony o jeden za nisko", async () => {
    // Granica liczona jest na SERIALIZACJI, nie na długości wartości: sam
    // `{"pad":"…"}` dokłada 11 znaków.
    const pad = "z".repeat(3_980);
    await postOne({ meta: { pad } });

    expect(insertedRows()[0]!.meta).toEqual({ pad });
  });

  it("META zagnieżdżona jest zachowywana strukturalnie, nie spłaszczana do napisu", async () => {
    await postOne({ meta: { interval: "yearly", ab: { variant: "b", weight: 0.5 } } });

    expect(insertedRows()[0]!.meta).toEqual({
      interval: "yearly",
      ab: { variant: "b", weight: 0.5 },
    });
  });

  it("PUSTE body nie wywala endpointu", async () => {
    const res = await post(null, "");

    expect(res.status).toBe(204);
    expect(h.insert).not.toHaveBeenCalled();
  });

  it("body, które nie jest JSON-em, nie wywala endpointu", async () => {
    const res = await post(null, "to nie jest json");

    expect(res.status).toBe(204);
    expect(h.insert).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
describe("RODO: redakcja adresów", () => {
  it("QUERY STRING ze ścieżki jest wycinany - w kolumnie nie ma oryginału", async () => {
    // Query string bywa nośnikiem tokenu resetu hasła i adresu e-mail.
    await postOne({ path: "/konto?token=abc123def456ghi789jkl&email=jan.kowalski@example.com" });

    const path = insertedRows()[0]!.path as string;
    expect(path).not.toContain("abc123def456ghi789jkl");
    expect(path).not.toContain("jan.kowalski@example.com");
    expect(path).not.toContain("@");
    expect(path.startsWith("/konto")).toBe(true);
  });

  it("QUERY STRING z REFERRERA też jest wycinany", async () => {
    await postOne({ referrer: "https://example.org/szukaj?q=jan.kowalski@example.com&code=xyz" });

    const referrer = insertedRows()[0]!.referrer as string;
    expect(referrer).not.toContain("jan.kowalski@example.com");
    expect(referrer).not.toContain("xyz");
    expect(referrer).toContain("example.org/szukaj");
  });

  it("adres e-mail wklejony wprost w ścieżkę (bez query) też jest redagowany", async () => {
    await postOne({ path: "/autor/jan.kowalski@example.org" });

    const path = insertedRows()[0]!.path as string;
    expect(path).not.toContain("jan.kowalski@example.org");
    expect(path).toContain("[redacted-email]");
  });
});

// ---------------------------------------------------------------------------
describe("odporność", () => {
  it("AWARIA zapisu nadal oddaje 204 - beacon nie ma jak obsłużyć błędu", async () => {
    h.insert.mockRejectedValue(new Error("baza padla"));

    const res = await postOne({});

    expect(res.status).toBe(204);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });

  it("LIMITER (120 żetonów, 2/s) wycisza zalew z JEDNEGO adresu, nie zwracając błędu", async () => {
    const stableIp = { "x-forwarded-for": "10.8.8.8" };
    const statuses: number[] = [];
    for (let i = 0; i < 140; i += 1) {
      req.current = new Request("https://redakcja.example.test/api/public/track", {
        method: "POST",
        headers: stableIp,
        body: JSON.stringify({ events: [{ type: "interaction", name: `e${i}` }] }),
      });
      statuses.push((await handler({ request: req.current })).status);
    }

    expect(new Set(statuses)).toEqual(new Set([204]));
    expect(h.insert.mock.calls.length).toBeLessThan(140);
  });

  it("limiter NIE karze innego adresu - jeden zalewający klient nie wycisza reszty świata", async () => {
    for (let i = 0; i < 140; i += 1) {
      req.current = new Request("https://redakcja.example.test/api/public/track", {
        method: "POST",
        headers: { "x-forwarded-for": "10.8.9.9" },
        body: JSON.stringify({ events: [{ type: "interaction", name: "spam" }] }),
      });
      await handler({ request: req.current });
    }
    h.insert.mockClear();

    await postOne({});

    expect(h.insert).toHaveBeenCalledTimes(1);
  });

  it("żądanie BEZ nagłówka adresu wpada do wspólnego kubełka, a nie omija limitu", async () => {
    // `clientIpFromHeaders` oddaje "unknown" - klucz stały, więc seria bez
    // adresu ogranicza się sama zamiast dostać nielimitowany kanał.
    const statuses: number[] = [];
    for (let i = 0; i < 140; i += 1) {
      req.current = new Request("https://redakcja.example.test/api/public/track", {
        method: "POST",
        body: JSON.stringify({ events: [{ type: "interaction", name: `e${i}` }] }),
      });
      statuses.push((await handler({ request: req.current })).status);
    }

    expect(new Set(statuses)).toEqual(new Set([204]));
    expect(h.insert.mock.calls.length).toBeLessThan(140);
  });
});
