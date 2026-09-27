// @vitest-environment node
//
// ŚRODOWISKO NODE, NIE HAPPY-DOM. `Request` z happy-dom wycina nagłówki
// zakazane w przeglądarce (`Origin`, `Sec-Purpose`) - a to dokładnie te,
// po których filtr ruchu nieludzkiego rozpoznaje cudzą stronę i prefetch.
// Endpoint i tak biegnie na serwerze, więc `Request` z Node jest tym prawdziwym.
//
// Ingest ekspozycji sponsorów: POST /api/public/sponsor-event.
//
// PO CO ASERCJE NA SKUTKU. Endpoint jest publiczny, bez sesji i podpisu,
// a KAŻDA ścieżka kończy się tym samym `204 no-store` i połyka wyjątki. Zapis,
// odrzucenie i awaria wyglądają z zewnątrz identycznie, więc test kodu
// odpowiedzi nie odróżniłby działającej ściany od zdjętej. Każda asercja
// niżej patrzy na to, CZY i Z CZYM poszło wywołanie
// `event_sponsor_exposure_ingest` - jedyny obserwowalny skutek.
//
// Ściany (wzorzec `-ad-event.test.ts`):
//   1. limiter po IP (60 w zapasie, 1/s),
//   2. limit długości ciała (8 000 znaków),
//   3. zaufany host strony - bez niego nic nie jedzie do bazy,
//   4. filtr ruchu nieludzkiego (agent, prefetch, `Origin` inny niż ZAUFANY
//      host - także gdy żądanie przyszło zza pośrednika pod hostem
//      wewnętrznym, a publiczny niesie `X-Forwarded-Host`),
//   5. kształt: slug, sesja, biała lista miejsc i rodzajów, uuid, 40 pozycji,
//      macierz miejsce x rodzaj,
//   6. najemca z zaufanego hosta - bez niego nic nie jedzie do bazy.
// Przynależność sponsora/materiału/reklamy do wydarzenia sprawdza baza
// (asercje harnessu `32_sponsor_report.sql`), więc tu jej nie udajemy.
//
// ATRAPUJEMY WYŁĄCZNIE GRANICE: klienta bazy, rozwiązywanie najemcy i host.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
      return { data: 1, error: null };
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
// Zaufany host (`currentTenantHost`) to granica: w produkcji waliduje
// `Host`/`X-Forwarded-Host` względem katalogu najemców - tu podajemy wynik.
vi.mock("@/lib/http/requestHost", () => ({ currentTenantHost: async () => h.host }));
vi.mock("@tanstack/react-start/server", () => ({ getRequest: () => h.req }));

import { routeServerHandlers } from "@/test/routeHarness";
import { Route } from "@/routes/api/public/sponsor-event";

const handler = routeServerHandlers(Route).POST!;

const TENANT = "aaaaaaaa-0000-4000-8000-00000000000a";
const SPONSOR = "11111111-1111-4111-8111-111111111111";
const MATERIAL = "22222222-2222-4222-8222-222222222222";
const AD = "33333333-3333-4333-8333-333333333333";
const SESSION = "f".repeat(32);
const CHROME =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36";

let ipCounter = 0;
interface PostOptions {
  raw?: string;
  headers?: Record<string, string>;
  ip?: string;
  /** Adres, pod który żądanie dotarło do serwera (za pośrednikiem - wewnętrzny). */
  url?: string;
}

function request(body: unknown, opts: PostOptions = {}): Request {
  ipCounter += 1;
  return new Request(opts.url ?? "https://nes.example/api/public/sponsor-event", {
    method: "POST",
    headers: {
      "user-agent": CHROME,
      "x-forwarded-for": opts.ip ?? `10.8.${Math.floor(ipCounter / 250)}.${ipCounter % 250}`,
      ...opts.headers,
    },
    body: opts.raw ?? JSON.stringify(body),
  });
}

async function post(body: unknown, opts: PostOptions = {}): Promise<Response> {
  h.req = request(body, opts);
  return handler({ request: h.req });
}

function batch(items: unknown[], patch: Record<string, unknown> = {}) {
  return { event_slug: "kongres-2099", session: SESSION, items, ...patch };
}

const VIEW = { sponsor_id: SPONSOR, placement: "home_strip", kind: "view" };

beforeEach(() => {
  h.tenantId = TENANT;
  h.tenantThrows = false;
  h.rpcThrows = false;
  h.calls = [];
  h.host = "nes.example";
  h.hostsResolved = [];
});

describe("ścieżka szczęśliwa", () => {
  it("zapisuje paczkę z najemcą hosta; odpowiedź 204 bez cache", async () => {
    const res = await post(
      batch([
        VIEW,
        { sponsor_id: SPONSOR.toUpperCase(), placement: "partners_tab", kind: "click" },
        {
          sponsor_id: SPONSOR,
          placement: "materials",
          kind: "material_open",
          material_id: MATERIAL,
        },
        { placement: "home_ad", kind: "view", home_ad_id: AD },
      ]),
    );
    expect(res.status).toBe(204);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(h.calls).toEqual([
      {
        fn: "event_sponsor_exposure_ingest",
        args: {
          p_tenant: TENANT,
          p_payload: {
            event_slug: "kongres-2099",
            session: SESSION,
            items: [
              { sponsor_id: SPONSOR, placement: "home_strip", kind: "view" },
              // uuid wielkimi literami przychodzi znormalizowany.
              { sponsor_id: SPONSOR, placement: "partners_tab", kind: "click" },
              {
                sponsor_id: SPONSOR,
                placement: "materials",
                kind: "material_open",
                material_id: MATERIAL,
              },
              { placement: "home_ad", kind: "view", home_ad_id: AD },
            ],
          },
        },
      },
    ]);
  });

  it("Origin własnej strony przechodzi, a najemcę wyprowadza ten sam zaufany host", async () => {
    await post(batch([VIEW]), { headers: { origin: "https://nes.example" } });
    expect(h.calls).toHaveLength(1);
    expect(h.hostsResolved).toEqual(["nes.example"]);
  });

  it("za pośrednikiem: host wewnętrzny w adresie żądania, publiczny w X-Forwarded-Host - beacon się liczy", async () => {
    // Pośrednik przepisuje Host na wewnętrzny; zaufany host (z walidacji
    // `X-Forwarded-Host` względem katalogu) to strona, którą ogląda gość.
    await post(batch([VIEW]), {
      url: "http://origin-internal.svc:8080/api/public/sponsor-event",
      headers: {
        host: "origin-internal.svc:8080",
        "x-forwarded-host": "nes.example",
        origin: "https://nes.example",
      },
    });
    expect(h.calls).toHaveLength(1);
    expect(h.hostsResolved).toEqual(["nes.example"]);
  });

  it("strona pod aliasem www to ta sama strona", async () => {
    await post(batch([VIEW]), { headers: { origin: "https://www.nes.example" } });
    expect(h.calls).toHaveLength(1);
  });

  it("więcej niż 40 pozycji: do bazy jedzie pierwsze 40", async () => {
    await post(batch(Array.from({ length: 45 }, () => VIEW)));
    expect((h.calls[0].args.p_payload as { items: unknown[] }).items).toHaveLength(40);
  });

  it("złe pozycje odpadają pojedynczo, reszta paczki jedzie", async () => {
    await post(
      batch([
        VIEW,
        null,
        [VIEW],
        "view",
        { ...VIEW, placement: "billboard" },
        { ...VIEW, kind: "hover" },
        { ...VIEW, sponsor_id: "nie-uuid" },
        { placement: "agenda_session", kind: "click", sponsor_id: SPONSOR },
        { placement: "materials", kind: "material_open", sponsor_id: SPONSOR },
        { placement: "home_ad", kind: "view" },
      ]),
    );
    expect((h.calls[0].args.p_payload as { items: unknown[] }).items).toEqual([
      { sponsor_id: SPONSOR, placement: "home_strip", kind: "view" },
    ]);
  });
});

describe("ściana 1: limiter po adresie klienta", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2099-06-15T10:00:00.000Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("przepuszcza DOKŁADNIE 60 żądań z jednego IP, a po sekundzie jeden żeton", async () => {
    const ip = "10.250.0.1";
    for (let i = 0; i < 62; i += 1) await post(batch([VIEW]), { ip });
    expect(h.calls).toHaveLength(60);
    vi.setSystemTime(new Date("2099-06-15T10:00:01.000Z"));
    await post(batch([VIEW]), { ip });
    await post(batch([VIEW]), { ip });
    expect(h.calls).toHaveLength(61);
    // Inny adres ma własny kubełek.
    await post(batch([VIEW]), { ip: "10.250.0.2" });
    expect(h.calls).toHaveLength(62);
  });
});

describe("ściana 2: długość ciała", () => {
  it("ciało ponad 8 000 znaków i puste ciało nie docierają do bazy", async () => {
    await post(null, { raw: JSON.stringify(batch([VIEW], { pad: "x".repeat(8_000) })) });
    await post(null, { raw: "" });
    expect(h.calls).toEqual([]);
  });
});

describe("ściana 3: zaufany host strony", () => {
  it("host spoza katalogu najemców (brak zaufanego hosta) - nic nie jedzie do bazy", async () => {
    h.host = null;
    await post(batch([VIEW]), { headers: { origin: "https://nes.example" } });
    await post(batch([VIEW]));
    expect(h.calls).toEqual([]);
    // Nie wpadamy do najemcy domyślnego: rozwiązania najemcy nie było wcale.
    expect(h.hostsResolved).toEqual([]);
  });
});

describe("ściana 4: ruch nieludzki", () => {
  it("robot, prefetch i cudzy Origin nie nabijają wyświetleń", async () => {
    await post(batch([VIEW]), { headers: { "user-agent": "Googlebot/2.1" } });
    await post(batch([VIEW]), { headers: { "sec-purpose": "prefetch" } });
    await post(batch([VIEW]), { headers: { origin: "https://obca.example" } });
    expect(h.calls).toEqual([]);
  });

  it("Origin porównujemy z ZAUFANYM hostem, nie z hostem adresu żądania", async () => {
    // Adres żądania mówi „nes.example", ale zaufany host strony to inny
    // najemca - `Origin` nes.example jest dla niego cudzą stroną.
    h.host = "inny-najemca.example";
    await post(batch([VIEW]), { headers: { origin: "https://nes.example" } });
    expect(h.calls).toEqual([]);
  });
});

describe("ściana 5: kształt paczki", () => {
  it.each([
    ["zły slug", batch([VIEW], { event_slug: "Kongres 2099" })],
    ["za krótki slug", batch([VIEW], { event_slug: "ab" })],
    ["slug nie-napis", batch([VIEW], { event_slug: 7 })],
    ["zła sesja", batch([VIEW], { session: "krotka" })],
    ["sesja nie-napis", batch([VIEW], { session: null })],
    ["pozycje nie-lista", batch([VIEW], { items: VIEW })],
    ["pusta lista", batch([])],
    ["same złe pozycje", batch([{ ...VIEW, kind: "hover" }])],
  ])("%s: nic nie jedzie do bazy", async (_label, body) => {
    await post(body);
    expect(h.calls).toEqual([]);
  });

  it("zepsuty JSON i JSON-owy null są połykane", async () => {
    const res = await post(null, { raw: "{nie-json" });
    await post(null, { raw: "null" });
    expect(res.status).toBe(204);
    expect(h.calls).toEqual([]);
  });
});

describe("ściana 6: najemca z zaufanego hosta", () => {
  it("nierozpoznany najemca albo awaria katalogu - nic nie jedzie do bazy", async () => {
    h.tenantId = null;
    await post(batch([VIEW]));
    h.tenantId = TENANT;
    h.tenantThrows = true;
    await post(batch([VIEW]));
    expect(h.calls).toEqual([]);
  });

  it("awaria bazy jest połykana - beacon dostaje 204", async () => {
    h.rpcThrows = true;
    const res = await post(batch([VIEW]));
    expect(h.calls).toHaveLength(1);
    expect(res.status).toBe(204);
  });
});
