// Limit prób kodów na publicznych endpointach sondy (`codeProbeLimit.server.ts`).
//
// CO KONKRETNIE PSUJE SIĘ BEZ TYCH TESTÓW.
//   1. LIMIT ZDJĘTY PRZY AWARII LICZNIKA - oba kubełki muszą jechać z
//      `failClosed: true`.
//   2. LICZBY Z AUDYTU - 30 prób na 10 minut: trzydziesta pierwsza w oknie to
//      odmowa (sam licznik `rate_limit_hit` sprawdza pgTAP).
//   3. SUROWY ADRES W `rate_limits` - podmiot ma być solonym skrótem.
//   4. PRÓG IP ZALEŻNY OD SESJI - anonim 30, wołający z sesją 120 (biuro
//      i sieć konferencyjna za jednym adresem), a konto ma własny kubełek 30.
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  allowed: { "coupon_probe.ip": true, "coupon_probe.user": true } as Record<string, boolean>,
  rateCalls: [] as Record<string, unknown>[],
  userId: null as string | null,
  userLookups: 0,
  request: null as Request | null,
}));

vi.mock("@/lib/server/rate-limit.server", () => ({
  rateLimit: async (opts: Record<string, unknown>) => {
    h.rateCalls.push(opts);
    return h.allowed[String(opts.scope)] ?? false;
  },
}));
vi.mock("@tanstack/react-start/server", () => ({
  getRequest: () => {
    if (h.request === null) throw new Error("brak kontekstu żądania");
    return h.request;
  },
}));
vi.mock("@/lib/auth/optionalUser.server", () => ({
  optionalUserIdFromRequest: async () => {
    h.userLookups += 1;
    return h.userId;
  },
}));

import {
  CODE_PROBE_IP_SCOPE,
  CODE_PROBE_RATE_LIMIT,
  CODE_PROBE_SIGNED_IN_IP_MAX,
  CODE_PROBE_USER_SCOPE,
  allowCodeProbe,
  allowCodeProbeForRequest,
} from "@/lib/events/codeProbeLimit.server";

const headers = (ip: string) => new Headers({ "cf-connecting-ip": ip });

beforeEach(() => {
  h.allowed = { "coupon_probe.ip": true, "coupon_probe.user": true };
  h.rateCalls = [];
  h.userId = null;
  h.userLookups = 0;
  h.request = new Request("https://nes.example/_serverFn", { headers: headers("192.0.2.7") });
});

describe("allowCodeProbe", () => {
  it("anonim: 30 prób na 10 minut z adresu, fail-closed (31. próba to odmowa)", async () => {
    expect(CODE_PROBE_RATE_LIMIT).toEqual({ max: 30, windowMinutes: 10 });
    expect(await allowCodeProbe(headers("192.0.2.7"), async () => null)).toBe(true);

    expect(h.rateCalls).toEqual([
      expect.objectContaining({
        scope: CODE_PROBE_IP_SCOPE,
        max: 30,
        windowMinutes: 10,
        failClosed: true,
      }),
    ]);
  });

  it("z sesją: próg IP 120, a konto ma własny kubełek 30 - oba fail-closed", async () => {
    expect(CODE_PROBE_SIGNED_IN_IP_MAX).toBe(120);
    expect(await allowCodeProbe(headers("192.0.2.7"), async () => "user-1")).toBe(true);

    expect(h.rateCalls).toEqual([
      expect.objectContaining({ scope: CODE_PROBE_IP_SCOPE, max: 120, failClosed: true }),
      expect.objectContaining({ scope: CODE_PROBE_USER_SCOPE, max: 30, failClosed: true }),
    ]);
  });

  it("podmiot to solony skrót - ani adres, ani identyfikator konta nie trafia do licznika", async () => {
    await allowCodeProbe(headers("192.0.2.7"), async () => "user-1");

    const [ip, user] = h.rateCalls.map((c) => String(c.subjectId));
    expect(ip).toMatch(/^ip:[0-9a-f]{32}$/);
    expect(user).toMatch(/^user:[0-9a-f]{32}$/);
    expect(ip).not.toContain("192.0.2.7");
    expect(user).not.toContain("user-1");
  });

  it("dwa adresy to dwa kubełki", async () => {
    await allowCodeProbe(headers("192.0.2.7"), async () => null);
    await allowCodeProbe(headers("198.51.100.4"), async () => null);

    expect(h.rateCalls[0]!.subjectId).not.toBe(h.rateCalls[1]!.subjectId);
  });

  it("odmowa kubełka IP kończy pracę przed kubełkiem konta", async () => {
    h.allowed["coupon_probe.ip"] = false;

    expect(await allowCodeProbe(headers("192.0.2.7"), async () => "user-1")).toBe(false);
    expect(h.rateCalls.map((c) => c.scope)).toEqual([CODE_PROBE_IP_SCOPE]);
  });

  it("anonim ma tylko kubełek IP", async () => {
    expect(await allowCodeProbe(headers("192.0.2.7"), async () => null)).toBe(true);
    expect(h.rateCalls.map((c) => c.scope)).toEqual([CODE_PROBE_IP_SCOPE]);
  });

  it("pełny kubełek konta to odmowa nawet z nowego adresu", async () => {
    h.allowed["coupon_probe.user"] = false;
    expect(await allowCodeProbe(headers("203.0.113.9"), async () => "user-1")).toBe(false);
  });

  it("brak nagłówków nie znosi limitu - wpada do wspólnego kubełka adresu nieznanego", async () => {
    await allowCodeProbe(null, async () => null);
    await allowCodeProbe(undefined, async () => null);

    expect(h.rateCalls).toHaveLength(2);
    expect(h.rateCalls[0]!.subjectId).toBe(h.rateCalls[1]!.subjectId);
  });
});

describe("allowCodeProbeForRequest", () => {
  it("bierze adres z bieżącego żądania i konto z sesji", async () => {
    h.userId = "user-1";
    expect(await allowCodeProbeForRequest()).toBe(true);

    expect(h.userLookups).toBe(1);
    expect(h.rateCalls.map((c) => c.scope)).toEqual([CODE_PROBE_IP_SCOPE, CODE_PROBE_USER_SCOPE]);
  });

  it("brak kontekstu żądania liczy się do wspólnego kubełka, a nie omija bramki", async () => {
    h.request = null;
    expect(await allowCodeProbeForRequest()).toBe(true);
    const anonymous = h.rateCalls[0]!.subjectId;

    h.rateCalls = [];
    await allowCodeProbe(null, async () => null);
    expect(h.rateCalls[0]!.subjectId).toBe(anonymous);
  });
});
