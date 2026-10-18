// Harmonogram rozliczeń: POST /api/public/billing-cron, gdy moduł ZAMIATARKI
// dziennika płatności nie daje się załadować.
//
// JAKIE RYZYKO TU PILNUJEMY. Zamiatarka jest dobową siatką bezpieczeństwa,
// dociąganą dynamicznym importem PO przypomnieniach i karencjach. Kontrakt
// wobec zewnętrznego schedulera mówi, że o kodzie odpowiedzi decydują
// WYŁĄCZNIE przypomnienia: 500 to sygnał „ponów cykl", a ponowiony cykl
// rozesłałby wszystko jeszcze raz (idempotencja wysyłki to tylko ostatnia
// zapora, nie powód, żeby ją testować na klientach). Zepsuty fragment
// wdrożenia z zamiatarką nie może więc ani wywrócić handlera, ani zamienić
// udanego cyklu w 500 - ślad zostaje w sekcji `webhookSweep` odpowiedzi,
// którą scheduler zapisuje w logu.
//
// Atrapy na granicach: klient Supabase (service role), dostawca poczty i sam
// moduł zamiatarki - ten ostatni celowo rzuca przy ładowaniu, bo to jest
// badana awaria. Przypomnienia, karencje, limiter i sekret biegną prawdziwe.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ok, supabaseFromStub, type SupabaseFromStub } from "@/test/supabaseChain";

const boundary = vi.hoisted(() => ({
  db: null as SupabaseFromStub | null,
  rpc: [] as string[],
}));

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    from: (table: string) => boundary.db!.from(table),
    rpc: (fn: string) => {
      boundary.rpc.push(fn);
      return Promise.resolve({ data: { expired: [] }, error: null });
    },
  },
}));

vi.mock("@/lib/email/transactional.server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/email/transactional.server")>()),
  sendTxEmail: () => Promise.resolve({ ok: true }),
}));

// Badana awaria: moduł zamiatarki rzuca przy ładowaniu (zepsuty fragment wdrożenia).
vi.mock("@/lib/billing/webhookReplay.server", () => {
  throw new Error("Failed to fetch dynamically imported module: webhookReplay.server.js");
});

const req = vi.hoisted(() => ({ current: null as Request | null }));
vi.mock("@tanstack/react-start/server", () => ({ getRequest: () => req.current }));

import { routeServerHandlers } from "@/test/routeHarness";
import { Route } from "@/routes/api/public/billing-cron";

const handler = routeServerHandlers(Route).POST!;
const SECRET = "sekret-testowy-crona-zamiatarka";

function post(ip: string): Promise<Response> {
  req.current = new Request("https://neweuropeanstrategies.com/api/public/billing-cron", {
    method: "POST",
    headers: {
      "x-forwarded-for": ip,
      "x-billing-cron-secret": SECRET,
      "content-type": "application/json",
    },
    body: JSON.stringify({ leadDays: 3 }),
  });
  return handler({ request: req.current });
}

beforeEach(() => {
  const stub = supabaseFromStub();
  // Pusty dzień: nikt nie czeka na przypomnienie, żaden zespół nie jest w karencji.
  stub.setResponse("subscriptions", ok([]));
  stub.setResponse("organization_seats", ok([]));
  stub.setResponse("member_organizations", ok([]));
  boundary.db = stub;
  boundary.rpc = [];
  vi.stubEnv("BILLING_CRON_SECRET", SECRET);
  vi.stubEnv("COMMUNITY_CRON_SECRET", "");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("billing-cron - moduł zamiatarki nie ładuje się", () => {
  it("cykl kończy się 200 z przypomnieniami, a awaria zamiatarki zostaje w jej sekcji odpowiedzi", async () => {
    const res = await post("10.78.0.1");
    const payload = (await res.json()) as Record<string, unknown>;

    expect(res.status).toBe(200);
    expect(payload).toMatchObject({ ok: true, leadDays: 3, renewal: 0, expiring: 0, skipped: 0 });
    const sweep = payload.webhookSweep as { error?: unknown };
    expect(typeof sweep.error).toBe("string");
    expect(String(sweep.error)).not.toBe("");
  });

  it("zadania przed zamiatarką naprawdę przebiegły - awaria importu nie cofa ich skutków", async () => {
    await post("10.78.0.2");

    expect(boundary.db!.chainsFor("subscriptions")).toHaveLength(1);
    expect(boundary.rpc).toContain("org_expire_seat_grace");
  });
});
