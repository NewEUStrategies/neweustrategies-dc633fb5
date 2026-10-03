// Harmonogram rozliczeń: POST /api/public/billing-cron, gdy moduł zadań NIE
// DAJE SIĘ ZAŁADOWAĆ.
//
// JAKIE RYZYKO TU PILNUJEMY. Zadania crona (przypomnienia o odnowieniu,
// karencja miejsc zespołowych) są dociągane dynamicznym importem. Zepsuty
// fragment wdrożenia albo wyjątek przy inicjalizacji modułu to awaria, której
// `-billing-cron.test.ts` nie widzi - tam moduły ładują się zawsze. Kontrakt
// wobec zewnętrznego schedulera jest jeden: KAŻDA porażka cyklu to
// `500 {"error":"cron_failed"}` z `no-store`. Na tym kodzie scheduler opiera
// alarm i ponowienie (bezpieczne - idempotencja siedzi w warstwie wysyłki).
// Wyjątek przepuszczony z handlera dałby odpowiedź frameworka bez tego
// kształtu, a cykl, który NIC nie zrobił, mógłby nie podnieść alarmu.
//
// Atrapy na granicach: klient Supabase (service role), dostawca poczty i sam
// moduł zadań - ten ostatni celowo rzuca przy ładowaniu, bo to jest badana
// awaria. Limiter, porównanie sekretu i handler biegną prawdziwe.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const boundary = vi.hoisted(() => ({
  /** Każde dotknięcie bazy: `from:<tabela>` albo `rpc:<funkcja>`. */
  db: [] as string[],
  mails: [] as string[],
}));

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    from: (table: string) => {
      boundary.db.push(`from:${table}`);
      throw new Error(`test: nieoczekiwany odczyt tabeli ${table}`);
    },
    rpc: (fn: string) => {
      boundary.db.push(`rpc:${fn}`);
      return Promise.resolve({ data: null, error: { message: "test: nieoczekiwane RPC" } });
    },
  },
}));

vi.mock("@/lib/email/transactional.server", () => ({
  sendTxEmail: (input: { type: string }) => {
    boundary.mails.push(input.type);
    return Promise.resolve({ ok: true });
  },
}));

// Badana awaria: moduł zadań rzuca przy ładowaniu (zepsuty fragment wdrożenia).
vi.mock("@/lib/billing/reminders.server", () => {
  throw new Error("Failed to fetch dynamically imported module: reminders.server.js");
});

const req = vi.hoisted(() => ({ current: null as Request | null }));
vi.mock("@tanstack/react-start/server", () => ({ getRequest: () => req.current }));

import { routeServerHandlers } from "@/test/routeHarness";
import { Route } from "@/routes/api/public/billing-cron";

const handler = routeServerHandlers(Route).POST!;
const SECRET = "sekret-testowy-crona-modul";

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

let errorLog: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  boundary.db = [];
  boundary.mails = [];
  vi.stubEnv("BILLING_CRON_SECRET", SECRET);
  vi.stubEnv("COMMUNITY_CRON_SECRET", "");
  errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  errorLog.mockRestore();
});

describe("billing-cron - moduł zadań nie ładuje się", () => {
  it("odpowiada `500 cron_failed` bez cache, zamiast wypuścić wyjątek z handlera", async () => {
    const res = await post("10.77.0.1");

    expect(res.status).toBe(500);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(res.headers.get("Content-Type")).toBe("application/json");
    expect(await res.json()).toEqual({ error: "cron_failed" });
  });

  it("porażka jest zalogowana z przyczyną - dyżurny widzi, CO nie wstało", async () => {
    await post("10.77.0.2");

    expect(errorLog).toHaveBeenCalledWith("[billing-cron] failed", expect.any(Error));
    // Pierwotna przyczyna jest w łańcuchu `cause` - log niesie ją w całości.
    const messages: string[] = [];
    let cause: unknown = errorLog.mock.calls[0]?.[1];
    while (cause instanceof Error) {
      messages.push(cause.message);
      cause = cause.cause;
    }
    expect(messages.join(" | ")).toContain("Failed to fetch dynamically imported module");
  });

  it("nic nie wychodzi połowicznie: zero maili, zero zapisów, zero odebranych dostępów", async () => {
    // Sekret pochodzi ze środowiska, więc baza nie jest potrzebna nawet do
    // autoryzacji - każde jej dotknięcie byłoby tu skutkiem ubocznym cyklu.
    await post("10.77.0.3");

    expect(boundary.mails).toEqual([]);
    expect(boundary.db).toEqual([]);
  });
});
