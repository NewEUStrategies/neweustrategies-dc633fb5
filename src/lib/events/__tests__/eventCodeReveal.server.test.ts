// Odsłonięcie ukrytych biletów kodem - warstwa serwerowa
// (`eventCodeReveal.server.ts`) i jej obwódka (`eventCodeReveal.functions.ts`).
//
// CO KONKRETNIE PSUJE SIĘ BEZ TYCH TESTÓW.
//   1. WYROCZNIA BEZ LIMITU - odmowa limitu ma zapaść PRZED najemcą i bazą.
//   2. NAJEMCA DOMYŚLNY - `supabaseAdmin` nie niesie hosta, więc najemca idzie
//      do RPC jawnie (`p_tenant`), z zaufanego hosta.
//   3. AWARIA UDAJE „KOD NICZEGO NIE ODSŁANIA" - błąd bazy i brak najemcy to
//      powód `error`, nie pusta lista.
//   4. KOD O ZŁYM KSZTAŁCIE DOCIERA DO SERWERA - walidator go odrzuca, funkcja
//      jest publiczna (formularz zapisu jest dla anonimów) i jest POST.
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  callServerFn,
  serverFnMiddlewareNames,
  validateServerFnInput,
} from "@/test/serverFnHarness";

const h = vi.hoisted(() => ({
  allowed: true,
  probeCalls: [] as { headers: Headers | null | undefined; userId: string | null }[],
  userId: null as string | null,
  tenant: "aaaaaaaa-0000-4000-8000-00000000000a" as string | null,
  tenantThrows: false,
  hosts: [] as (string | null)[],
  rpc: vi.fn(),
  request: new Request("https://nes.example/_serverFn", {
    headers: { "cf-connecting-ip": "192.0.2.7" },
  }),
}));

vi.mock("@tanstack/react-start", async () =>
  (await import("@/test/serverFnHarness")).serverFnStubModule(),
);
vi.mock("@tanstack/react-start/server", () => ({ getRequest: () => h.request }));
vi.mock("@/lib/events/codeProbeLimit.server", () => ({
  allowCodeProbe: async (
    headers: Headers | null | undefined,
    resolveUserId: () => Promise<string | null>,
  ) => {
    h.probeCalls.push({ headers, userId: h.allowed ? await resolveUserId() : null });
    return h.allowed;
  },
}));
vi.mock("@/lib/auth/optionalUser.server", () => ({
  optionalUserIdFromRequest: async () => h.userId,
}));
vi.mock("@/lib/http/requestHost", () => ({
  currentTenantHost: async () => "nes.example",
}));
vi.mock("@/lib/server/tenant.server", () => ({
  resolveTenantIdForHost: async (host: string | null) => {
    h.hosts.push(host);
    if (h.tenantThrows) throw new Error("katalog najemców niedostępny");
    return h.tenant;
  },
}));
vi.mock("@/integrations/supabase/client.server", () => ({ supabaseAdmin: { rpc: h.rpc } }));

import { revealTicketsForEventCode } from "@/lib/events/eventCodeReveal.server";
import { revealEventCodeTickets } from "@/lib/events/eventCodeReveal.functions";

const EVENT = "bbbbbbbb-0000-4000-8000-00000000000b";

beforeEach(() => {
  h.allowed = true;
  h.probeCalls = [];
  h.userId = null;
  h.tenant = "aaaaaaaa-0000-4000-8000-00000000000a";
  h.tenantThrows = false;
  h.hosts = [];
  h.rpc.mockReset();
  h.rpc.mockResolvedValue({ data: ["t-vip"], error: null });
});

describe("revealTicketsForEventCode", () => {
  it("odmowa limitu zapada przed najemcą i przed bazą", async () => {
    h.allowed = false;

    expect(await revealTicketsForEventCode(EVENT, "VIP10")).toEqual({
      ok: false,
      reason: "rate_limited",
    });
    expect(h.hosts).toEqual([]);
    expect(h.rpc).not.toHaveBeenCalled();
  });

  it("limit dostaje nagłówki żądania i konto z sesji, gdy jest", async () => {
    h.userId = "user-1";
    await revealTicketsForEventCode(EVENT, "VIP10");

    expect(h.probeCalls).toHaveLength(1);
    expect(h.probeCalls[0]!.headers).toBe(h.request.headers);
    expect(h.probeCalls[0]!.userId).toBe("user-1");
  });

  it("najemca z zaufanego hosta idzie do RPC jawnie, kod po normalizacji", async () => {
    expect(await revealTicketsForEventCode(EVENT, "  vip10 ")).toEqual({
      ok: true,
      ticketIds: ["t-vip"],
    });
    expect(h.hosts).toEqual(["nes.example"]);
    expect(h.rpc).toHaveBeenCalledWith("event_coupon_revealed_tickets", {
      p_tenant: "aaaaaaaa-0000-4000-8000-00000000000a",
      p_event_id: EVENT,
      p_code: "VIP10",
    });
  });

  it("pusta lista z bazy to zwykła odpowiedź - pudło nie różni się od kodu bez biletów", async () => {
    h.rpc.mockResolvedValue({ data: [], error: null });
    expect(await revealTicketsForEventCode(EVENT, "ZLY")).toEqual({ ok: true, ticketIds: [] });
  });

  it("błąd bazy to `error`, nie pusta lista", async () => {
    h.rpc.mockResolvedValue({ data: null, error: { message: "permission denied" } });
    expect(await revealTicketsForEventCode(EVENT, "VIP10")).toEqual({ ok: false, reason: "error" });
  });

  it("brak najemcy albo awaria katalogu to `error` bez pytania bazy", async () => {
    h.tenant = null;
    expect(await revealTicketsForEventCode(EVENT, "VIP10")).toEqual({ ok: false, reason: "error" });
    h.tenant = "aaaaaaaa-0000-4000-8000-00000000000a";
    h.tenantThrows = true;
    expect(await revealTicketsForEventCode(EVENT, "VIP10")).toEqual({ ok: false, reason: "error" });
    expect(h.rpc).not.toHaveBeenCalled();
  });

  it("odpowiedź bez listy (null) to pusta lista, nie awaria", async () => {
    h.rpc.mockResolvedValue({ data: null, error: null });
    expect(await revealTicketsForEventCode(EVENT, "VIP10")).toEqual({ ok: true, ticketIds: [] });
  });

  it("z odpowiedzi zostają tylko identyfikatory", async () => {
    h.rpc.mockResolvedValue({ data: ["t-vip", 7, null], error: null });
    expect(await revealTicketsForEventCode(EVENT, "VIP10")).toEqual({
      ok: true,
      ticketIds: ["t-vip"],
    });
  });
});

describe("revealEventCodeTickets (deklaracja)", () => {
  it("handler przekazuje wejście po walidacji do warstwy serwerowej", async () => {
    expect(
      await callServerFn(revealEventCodeTickets, {
        data: { eventId: EVENT, code: " vip10 " },
        context: { supabase: null },
      }),
    ).toEqual({ ok: true, ticketIds: ["t-vip"] });
    expect(h.rpc.mock.lastCall?.[1]).toMatchObject({ p_event_id: EVENT, p_code: "VIP10" });
  });

  it("jest publiczna - formularz zapisu działa dla anonima", () => {
    expect(serverFnMiddlewareNames(revealEventCodeTickets)).toEqual([]);
  });

  it("jest POST - każda odpowiedź liczy się do limitu i nie może leżeć w cache", () => {
    expect(Reflect.get(revealEventCodeTickets as object, "method")).toBe("POST");
  });

  it("walidator przycina kod i odrzuca zły kształt wejścia", () => {
    expect(
      validateServerFnInput(revealEventCodeTickets, { eventId: EVENT, code: " vip " }),
    ).toEqual({ eventId: EVENT, code: "vip" });
    expect(() =>
      validateServerFnInput(revealEventCodeTickets, { eventId: "x", code: "VIP" }),
    ).toThrow();
    expect(() =>
      validateServerFnInput(revealEventCodeTickets, { eventId: EVENT, code: "  " }),
    ).toThrow();
    expect(() =>
      validateServerFnInput(revealEventCodeTickets, { eventId: EVENT, code: "A".repeat(65) }),
    ).toThrow();
  });
});
