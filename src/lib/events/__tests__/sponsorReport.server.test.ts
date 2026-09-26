// Odczyt raportu dla sponsora po tokenie - warstwa serwerowa
// (`sponsorReport.server.ts`) i jej obwódka (`sponsorReport.functions.ts`).
//
// CO KONKRETNIE PSUJE SIĘ BEZ TYCH TESTÓW.
//   1. LIMIT PRÓB ZDJĘTY PRZY AWARII LICZNIKA - `failClosed` musi jechać do
//      `rateLimit`, a odmowa kończy się PRZED jakimkolwiek odczytem bazy.
//   2. NAJEMCA Z NIEZAUFANEGO ŹRÓDŁA - host rozwiązuje `currentTenantHost`,
//      a brak najemcy (albo awaria katalogu) to „nie znaleziono", nie odczyt
//      w najemcy domyślnym.
//   3. BŁĄD BAZY WYCIEKA DO KLIENTA - zamiast komunikatu mamy tylko `error`.
//   4. TOKEN O ZŁYM KSZTAŁCIE DOCIERA DO SERWERA - walidator ma go odrzucić,
//      a funkcja jest POST (odpowiedź dotyczy jednego sponsora, bez cache).
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  allowed: true,
  rateCalls: [] as Record<string, unknown>[],
  tenant: "aaaaaaaa-0000-4000-8000-00000000000a" as string | null,
  tenantThrows: false,
  hosts: [] as string[],
  rpc: vi.fn(),
  request: new Request("https://nes.example/_serverFn", {
    headers: { "x-forwarded-for": "10.0.0.1, 192.0.2.7" },
  }),
  spec: {
    method: undefined as string | undefined,
    validate: null as null | ((d: unknown) => unknown),
  },
}));

vi.mock("@tanstack/react-start/server", () => ({ getRequest: () => h.request }));
vi.mock("@/lib/server/rate-limit.server", () => ({
  rateLimit: async (opts: Record<string, unknown>) => {
    h.rateCalls.push(opts);
    return h.allowed;
  },
}));
vi.mock("@/lib/http/requestHost", () => ({
  currentTenantHost: async () => "nes.example",
}));
vi.mock("@/lib/server/tenant.server", () => ({
  resolveTenantIdForHost: async (host: string) => {
    h.hosts.push(host);
    if (h.tenantThrows) throw new Error("katalog najemców niedostępny");
    return h.tenant;
  },
}));
vi.mock("@/integrations/supabase/client.server", () => ({ supabaseAdmin: { rpc: h.rpc } }));
vi.mock("@tanstack/react-start", () => ({
  createServerFn: (options?: { method?: string }) => {
    h.spec.method = options?.method;
    const api = {
      inputValidator: (fn: (d: unknown) => unknown) => {
        h.spec.validate = fn;
        return api;
      },
      handler: (fn: (args: { data: unknown }) => unknown) => async (input: { data: unknown }) =>
        fn({ data: h.spec.validate ? h.spec.validate(input.data) : input.data }),
    };
    return api;
  },
}));

import {
  SPONSOR_REPORT_RATE_LIMIT,
  loadSponsorReportByToken,
} from "@/lib/events/sponsorReport.server";
import { getSponsorReportByToken } from "@/lib/events/sponsorReport.functions";

const TOKEN = "Ab3_-Ab3_-Ab3_-Ab3_-Ab3_-Ab3_-Ab";

beforeEach(() => {
  h.allowed = true;
  h.rateCalls = [];
  h.tenant = "aaaaaaaa-0000-4000-8000-00000000000a";
  h.tenantThrows = false;
  h.hosts = [];
  h.rpc.mockReset();
  h.rpc.mockResolvedValue({ data: { ok: true, totals: { views_unique: 3 } }, error: null });
});

describe("loadSponsorReportByToken", () => {
  it("limit po IP (ostatni adres łańcucha), FAIL-CLOSED, potem RPC z najemcą hosta", async () => {
    const out = await loadSponsorReportByToken(TOKEN);
    expect(h.rateCalls).toEqual([
      {
        scope: "event.sponsor_report",
        subjectId: "192.0.2.7",
        max: SPONSOR_REPORT_RATE_LIMIT.max,
        windowMinutes: SPONSOR_REPORT_RATE_LIMIT.windowMinutes,
        failClosed: true,
      },
    ]);
    expect(h.hosts).toEqual(["nes.example"]);
    expect(h.rpc).toHaveBeenCalledWith("event_sponsor_report_for_token", {
      p_tenant: "aaaaaaaa-0000-4000-8000-00000000000a",
      p_token: TOKEN,
    });
    expect(JSON.parse(out.json)).toEqual({ ok: true, totals: { views_unique: 3 } });
  });

  it("odmowa limitu kończy się przed rozwiązaniem najemcy i przed bazą", async () => {
    h.allowed = false;
    const out = await loadSponsorReportByToken(TOKEN);
    expect(JSON.parse(out.json)).toEqual({ ok: false, reason: "rate_limited" });
    expect(h.hosts).toEqual([]);
    expect(h.rpc).not.toHaveBeenCalled();
  });

  it("nierozpoznany najemca albo awaria katalogu to „nie znaleziono”, bez odczytu bazy", async () => {
    h.tenant = null;
    expect(JSON.parse((await loadSponsorReportByToken(TOKEN)).json)).toEqual({
      ok: false,
      reason: "not_found",
    });
    h.tenant = "aaaaaaaa-0000-4000-8000-00000000000a";
    h.tenantThrows = true;
    expect(JSON.parse((await loadSponsorReportByToken(TOKEN)).json)).toEqual({
      ok: false,
      reason: "not_found",
    });
    expect(h.rpc).not.toHaveBeenCalled();
  });

  it("błąd bazy to `error` bez treści błędu; odmowa bazy przechodzi bez zmian", async () => {
    h.rpc.mockResolvedValueOnce({ data: null, error: { message: "permission denied for x" } });
    const failed = await loadSponsorReportByToken(TOKEN);
    expect(failed.json).toBe(JSON.stringify({ ok: false, reason: "error" }));
    h.rpc.mockResolvedValueOnce({ data: { ok: false, reason: "expired" }, error: null });
    expect(JSON.parse((await loadSponsorReportByToken(TOKEN)).json)).toEqual({
      ok: false,
      reason: "expired",
    });
  });
});

describe("getSponsorReportByToken", () => {
  it("jest POST i woła warstwę serwerową z tokenem", async () => {
    expect(h.spec.method).toBe("POST");
    const call = getSponsorReportByToken as unknown as (i: {
      data: unknown;
    }) => Promise<{ json: string }>;
    const out = await call({ data: { token: TOKEN } });
    expect(JSON.parse(out.json)).toEqual({ ok: true, totals: { views_unique: 3 } });
    expect(h.rpc).toHaveBeenCalledTimes(1);
  });

  it("walidator odrzuca token o złym kształcie, zanim dotknie serwera", async () => {
    const call = getSponsorReportByToken as unknown as (i: { data: unknown }) => Promise<unknown>;
    await expect(call({ data: { token: "krotki" } })).rejects.toThrow();
    await expect(call({ data: { token: `${TOKEN}=` } })).rejects.toThrow();
    await expect(call({ data: {} })).rejects.toThrow();
    expect(h.rateCalls).toEqual([]);
    expect(h.rpc).not.toHaveBeenCalled();
  });
});
