// @vitest-environment node
//
// ŚRODOWISKO NODE, NIE HAPPY-DOM - ta sama przyczyna co w
// `-sponsor-event.test.ts`: `Request` z happy-dom wycina nagłówek `Origin`,
// a to po nim filtr ruchu nieludzkiego rozpoznaje cudzą stronę.
//
// Ingest czasu czytania: POST /api/public/post-dwell.
//
// PO CO ASERCJE NA SKUTKU. Endpoint jest publiczny, bez sesji i podpisu,
// a KAŻDA ścieżka kończy się tym samym `204 no-store`. Zapis, odrzucenie
// i awaria wyglądają z zewnątrz identycznie, więc każda asercja patrzy na to,
// CZY i Z CZYM poszło `record_post_dwell` - jedyny obserwowalny skutek.
// Co konkretnie psuje się bez tych testów:
//   1. limiter po adresie przestaje działać - zalew zgłoszeń z jednego adresu;
//   2. obca strona zgłasza „czas czytania" przeglądarką gościa (Origin);
//   3. host spoza katalogu najemców wpada do najemcy domyślnego;
//   4. czas spoza 1 s - 30 min, ułamek albo napis dochodzi do bazy;
//   5. awaria bazy wyrzuca błąd do przeglądarki (beacon ma dostać 204).
// ATRAPUJEMY WYŁĄCZNIE GRANICE: klienta bazy, najemcę hosta i żądanie.
// Limiter, walidacja ładunku i filtr robotów biegną PRAWDZIWE.
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  tenantId: "aaaaaaaa-0000-4000-8000-00000000000a" as string | null,
  tenantThrows: false,
  rpcThrows: false,
  calls: [] as { fn: string; args: Record<string, unknown> }[],
  req: null as Request | null,
  host: "nes.example" as string | null,
  hostsResolved: [] as (string | null)[],
}));

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    rpc: async (fn: string, args: Record<string, unknown>) => {
      h.calls.push({ fn, args });
      if (h.rpcThrows) throw new Error("baza niedostępna");
      return { data: true, error: null };
    },
  },
}));
vi.mock("@/lib/server/tenant.server", () => ({
  resolveTenantIdForHost: async (host: string | null) => {
    h.hostsResolved.push(host);
    if (h.tenantThrows) throw new Error("brak katalogu najemców");
    return h.tenantId;
  },
}));
vi.mock("@/lib/http/requestHost", () => ({ currentTenantHost: async () => h.host }));
vi.mock("@tanstack/react-start/server", () => ({ getRequest: () => h.req }));

import { routeServerHandlers } from "@/test/routeHarness";
import { Route } from "@/routes/api/public/post-dwell";
import { parsePostDwellBeacon } from "@/lib/views/postDwellWire";

const handler = routeServerHandlers(Route).POST!;

const TENANT = "aaaaaaaa-0000-4000-8000-00000000000a";
const POST_ID = "11111111-1111-4111-8111-111111111111";
const HASH = "0123456789abcdef0123456789abcdef";
const CHROME =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36";

let ipCounter = 0;

interface PostOptions {
  raw?: string;
  headers?: Record<string, string>;
  ip?: string;
}

async function post(body: unknown, opts: PostOptions = {}): Promise<Response> {
  ipCounter += 1;
  h.req = new Request("https://nes.example/api/public/post-dwell", {
    method: "POST",
    headers: {
      "user-agent": CHROME,
      "cf-connecting-ip": opts.ip ?? `10.9.${Math.floor(ipCounter / 250)}.${ipCounter % 250}`,
      ...opts.headers,
    },
    body: opts.raw ?? JSON.stringify(body),
  });
  return handler({ request: h.req });
}

function beacon(patch: Record<string, unknown> = {}): Record<string, unknown> {
  return { postId: POST_ID, viewerHash: HASH, dwellMs: 45_000, ...patch };
}

function expectNoContent(res: Response): void {
  expect(res.status).toBe(204);
  expect(res.headers.get("cache-control")).toBe("no-store");
}

beforeEach(() => {
  h.tenantId = TENANT;
  h.tenantThrows = false;
  h.rpcThrows = false;
  h.calls = [];
  h.host = "nes.example";
  h.hostsResolved = [];
});

describe("ścieżka szczęśliwa - punkt odniesienia dla asercji odmowy", () => {
  it("zapisuje czas przez `record_post_dwell` z najemcą ZAUFANEGO hosta", async () => {
    expectNoContent(await post(beacon(), { headers: { origin: "https://nes.example" } }));
    expect(h.calls).toEqual([
      {
        fn: "record_post_dwell",
        args: { _tenant_id: TENANT, _post_id: POST_ID, _viewer_hash: HASH, _dwell_ms: 45_000 },
      },
    ]);
    expect(h.hostsResolved).toEqual(["nes.example"]);
  });

  it("identyfikator wpisu jest sprowadzany do małych liter", async () => {
    await post(beacon({ postId: POST_ID.toUpperCase() }));
    expect(h.calls[0]?.args._post_id).toBe(POST_ID);
  });
});

describe("ściany endpointu", () => {
  it("obca strona (Origin inny niż zaufany host) nie zgłosi czasu przeglądarką gościa", async () => {
    expectNoContent(await post(beacon(), { headers: { origin: "https://zly.example" } }));
    expect(h.calls).toHaveLength(0);
  });

  it("roboty i prefetch są odrzucane", async () => {
    expectNoContent(await post(beacon(), { headers: { "user-agent": "Googlebot/2.1" } }));
    expectNoContent(await post(beacon(), { headers: { "sec-purpose": "prefetch" } }));
    expect(h.calls).toHaveLength(0);
  });

  it("bez zaufanego hosta i bez rozpoznanego najemcy nic nie jedzie do bazy", async () => {
    h.host = null;
    expectNoContent(await post(beacon()));
    h.host = "nes.example";
    h.tenantId = null;
    expectNoContent(await post(beacon()));
    h.tenantId = TENANT;
    h.tenantThrows = true;
    expectNoContent(await post(beacon()));
    expect(h.calls).toHaveLength(0);
  });

  it("puste, za duże i niebędące JSON-em ciało nie dochodzi do bazy", async () => {
    expectNoContent(await post(null, { raw: "" }));
    expectNoContent(await post(null, { raw: JSON.stringify(beacon({ pad: "x".repeat(600) })) }));
    expectNoContent(await post(null, { raw: "{nie-json" }));
    expect(h.calls).toHaveLength(0);
  });

  it("zalew z jednego adresu wyczerpuje limiter - nie bazę", async () => {
    for (let i = 0; i < 70; i += 1) await post(beacon(), { ip: "198.51.100.7" });
    expect(h.calls.length).toBe(60);
  });

  it("awaria bazy kończy się 204, a nie błędem w przeglądarce", async () => {
    h.rpcThrows = true;
    expectNoContent(await post(beacon()));
    expect(h.calls).toHaveLength(1);
  });
});

describe("parsePostDwellBeacon - kształt ładunku", () => {
  it("przyjmuje poprawny ładunek", () => {
    expect(parsePostDwellBeacon(beacon())).toEqual({
      postId: POST_ID,
      viewerHash: HASH,
      dwellMs: 45_000,
    });
  });

  it.each([
    ["nie-obiekt", "napis"],
    ["null", null],
    ["tablica", [beacon()]],
    ["wpis nie-uuid", beacon({ postId: "wpis-1" })],
    ["brak wpisu", beacon({ postId: undefined })],
    ["za krótki viewer_hash", beacon({ viewerHash: "krotki" })],
    ["za długi viewer_hash", beacon({ viewerHash: "a".repeat(65) })],
    ["viewer_hash ze spacją", beacon({ viewerHash: "0123456789 abcdef" })],
    ["viewer_hash nie-napis", beacon({ viewerHash: 1234567890123456 })],
    ["czas jako napis", beacon({ dwellMs: "45000" })],
    ["czas ułamkowy", beacon({ dwellMs: 1500.5 })],
    ["czas poniżej sekundy", beacon({ dwellMs: 999 })],
    ["czas powyżej 30 minut", beacon({ dwellMs: 30 * 60_000 + 1 })],
  ])("odrzuca: %s", (_opis, value) => {
    expect(parsePostDwellBeacon(value)).toBeNull();
  });

  it("granice 1 s i 30 min są włączne", () => {
    expect(parsePostDwellBeacon(beacon({ dwellMs: 1_000 }))?.dwellMs).toBe(1_000);
    expect(parsePostDwellBeacon(beacon({ dwellMs: 30 * 60_000 }))?.dwellMs).toBe(30 * 60_000);
  });
});
