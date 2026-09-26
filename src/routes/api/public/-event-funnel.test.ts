// Ingest krokow lejka wydarzenia: POST /api/public/event-funnel.
//
// CO KONKRETNIE PSUJE SIE BEZ TYCH TESTOW. Endpoint jest publiczny, bez sesji
// i bez podpisu, a KAZDA sciezka konczy sie tym samym 204 - kod odpowiedzi nie
// odroznia dzialajacej bramki od zdjetej. Dlatego kazda asercja patrzy na
// SKUTEK: czy RPC `event_funnel_track` zostalo wywolane i z czym.
//   1. limiter po adresie przestaje dzialac - zalew z jednego adresu;
//   2. roboty i podglady linkow licza sie jako wizyty;
//   3. za duze / zle / puste cialo dochodzi do bazy;
//   4. NIEROZPOZNANY najemca wpada do najemcy domyslnego (zamiast odrzucenia);
//   5. identyfikator klikniecia bez `ad_consent` idzie do bazy;
//   6. awaria bazy wyrzuca blad do przegladarki (beacon ma dostac 204).
// ATRAPUJEMY WYLACZNIE GRANICE: klienta bazy, najemce hosta i zadanie. Limiter,
// walidacja ladunku i filtr robotow biegna PRAWDZIWE.
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  tenantId: "aaaaaaaa-0000-0000-0000-00000000000a" as string | null,
  tenantThrows: false,
  rpcThrows: false,
  rpc: vi.fn(async (_name: string, _args: Record<string, unknown>) => ({
    data: true,
    error: null,
  })),
  req: null as Request | null,
}));

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    rpc: async (name: string, args: Record<string, unknown>) => {
      if (h.rpcThrows) throw new Error("baza lezy");
      return h.rpc(name, args);
    },
  },
}));
vi.mock("@/lib/server/tenant.server", () => ({
  resolveTenantIdForHost: async () => {
    if (h.tenantThrows) throw new Error("brak katalogu najemcow");
    return h.tenantId;
  },
}));
vi.mock("@/lib/http/requestHost", () => ({
  currentTenantHost: async () => "wydarzenia.example.test",
}));
vi.mock("@tanstack/react-start/server", () => ({ getRequest: () => h.req }));

import { routeServerHandlers } from "@/test/routeHarness";
import { Route } from "@/routes/api/public/event-funnel";

const handler = routeServerHandlers(Route).POST!;

const TENANT = "aaaaaaaa-0000-0000-0000-00000000000a";
const SESSION = "0f3c2a4e-1111-4222-8333-444455556666";
const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/128.0 Safari/537.36";

let ipCounter = 0;

function beaconBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { step: "visit", slug: "kongres-2026", visitor: "", session: SESSION, ...overrides };
}

async function post(
  body: unknown,
  opts: { raw?: string; ip?: string; ua?: string | null; country?: string } = {},
): Promise<Response> {
  ipCounter += 1;
  const headers: Record<string, string> = {
    "cf-connecting-ip": opts.ip ?? `10.8.${Math.floor(ipCounter / 250)}.${ipCounter % 250}`,
  };
  if (opts.ua !== null) headers["user-agent"] = opts.ua ?? BROWSER_UA;
  if (opts.country) headers["cf-ipcountry"] = opts.country;
  h.req = new Request("https://wydarzenia.example.test/api/public/event-funnel", {
    method: "POST",
    headers,
    body: opts.raw ?? JSON.stringify(body),
  });
  return handler({ request: h.req });
}

function expectNoContent(res: Response): void {
  expect(res.status).toBe(204);
  expect(res.headers.get("cache-control")).toBe("no-store");
}

beforeEach(() => {
  h.tenantId = TENANT;
  h.tenantThrows = false;
  h.rpcThrows = false;
  h.rpc.mockClear();
});

describe("sciezka szczesliwa - punkt odniesienia dla asercji odmowy", () => {
  it("zapisuje krok przez RPC z najemca HOSTA i krajem z naglowka brzegu", async () => {
    const res = await post(
      beaconBody({
        ad_consent: true,
        touch: { ts: 5, click_id_type: "gclid", click_id: "Cj0KCQjw-abc", utm_source: "google" },
      }),
      { country: "PL" },
    );
    expectNoContent(res);
    expect(h.rpc).toHaveBeenCalledTimes(1);
    expect(h.rpc.mock.calls[0]?.[0]).toBe("event_funnel_track");
    expect(h.rpc.mock.calls[0]?.[1]).toEqual({
      p_tenant: TENANT,
      p_payload: {
        step: "visit",
        slug: "kongres-2026",
        visitor: "",
        session: SESSION,
        ad_consent: true,
        touch: { ts: 5, click_id_type: "gclid", click_id: "Cj0KCQjw-abc", utm_source: "google" },
        country: "PL",
      },
    });
  });

  it("bez naglowka kraju ladunek nie niesie kraju", async () => {
    await post(beaconBody());
    expect(h.rpc.mock.calls[0]?.[1]?.p_payload).not.toHaveProperty("country");
  });
});

describe("sciany endpointu", () => {
  it("identyfikator klikniecia bez zgody reklamowej NIE dochodzi do bazy", async () => {
    await post(beaconBody({ touch: { ts: 5, click_id_type: "gclid", click_id: "Cj0KCQjw-abc" } }));
    const payload = h.rpc.mock.calls[0]?.[1]?.p_payload as Record<string, unknown>;
    expect(payload.touch).toEqual({ ts: 5, click_id_type: "gclid" });
    expect(payload.ad_consent).toBe(false);
  });

  it("roboty i brak user-agenta sa odrzucane", async () => {
    expectNoContent(await post(beaconBody(), { ua: "Slackbot-LinkExpanding 1.0" }));
    expectNoContent(await post(beaconBody(), { ua: null }));
    expect(h.rpc).not.toHaveBeenCalled();
  });

  it("puste, za duze i zle cialo nie dochodza do bazy", async () => {
    expectNoContent(await post(null, { raw: "" }));
    expectNoContent(await post(null, { raw: "x".repeat(4_001) }));
    expectNoContent(await post(null, { raw: "{zly json" }));
    expectNoContent(await post(beaconBody({ step: "purchase" })));
    expect(h.rpc).not.toHaveBeenCalled();
  });

  it("nierozpoznany najemca (albo awaria katalogu) = odrzucenie, nie najemca domyslny", async () => {
    h.tenantId = null;
    expectNoContent(await post(beaconBody()));
    h.tenantId = TENANT;
    h.tenantThrows = true;
    expectNoContent(await post(beaconBody()));
    expect(h.rpc).not.toHaveBeenCalled();
  });

  it("awaria bazy nie wychodzi do przegladarki", async () => {
    h.rpcThrows = true;
    expectNoContent(await post(beaconBody()));
  });

  it("limiter po adresie: 60 beaconow z jednego adresu przechodzi, 61. nie", async () => {
    // Zegar stoi - kubelek nie odnawia sie w trakcie petli, nawet na wolnym CI.
    vi.spyOn(Date, "now").mockReturnValue(1_700_000_000_000);
    const ip = "203.0.113.77";
    for (let i = 0; i < 60; i += 1) await post(beaconBody(), { ip });
    expect(h.rpc).toHaveBeenCalledTimes(60);
    expectNoContent(await post(beaconBody(), { ip }));
    expect(h.rpc).toHaveBeenCalledTimes(60);
    // Inny adres - wlasny kubelek.
    await post(beaconBody(), { ip: "203.0.113.78" });
    expect(h.rpc).toHaveBeenCalledTimes(61);
    vi.restoreAllMocks();
  });
});
