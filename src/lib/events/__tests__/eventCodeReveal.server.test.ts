// Odsłonięcie ukrytych biletów kodem - warstwa serwerowa
// (`eventCodeReveal.server.ts`) i jej obwódka (`eventCodeReveal.functions.ts`).
//
// CO KONKRETNIE PSUJE SIĘ BEZ TYCH TESTÓW.
//   1. WYROCZNIA BEZ LIMITU - odmowa limitu ma zapaść PRZED najemcą i bazą.
//   2. NAJEMCA DOMYŚLNY - `supabaseAdmin` nie niesie hosta, więc najemca idzie
//      do RPC jawnie, z zaufanego hosta.
//   3. AWARIA UDAJE „KOD NICZEGO NIE ODSŁANIA" - błąd bazy i brak najemcy to
//      powód `error`, nie pusta lista.
//   4. KOD O ZŁYM KSZTAŁCIE DOCIERA DO SERWERA - walidator go odrzuca, funkcja
//      jest publiczna (formularz zapisu jest dla anonimów) i jest POST.
//   5. SAME IDENTYFIKATORY PRZY FORMULARZU BEZ BILETÓW UKRYTYCH (REG-05) - od
//      B1a formularz ich nie oddaje, więc odsłonięcie MUSI nieść pełne wiersze
//      (`event_registration_revealed_tickets`), a stara funkcja z samymi
//      identyfikatorami zostaje wyłącznie na okno wdrożenia.
//   6. SUROWY ADRES W BAZIE - skrót adresu to `ip:<32 hex>`, nie nagłówek.
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  callServerFn,
  serverFnMiddlewareNames,
  validateServerFnInput,
} from "@/test/serverFnHarness";
import { requestRateSubject } from "@/lib/server/rateSubject.server";

const h = vi.hoisted(() => ({
  allowed: true,
  probeCalls: [] as { headers: Headers | null | undefined; userId: string | null }[],
  userId: null as string | null,
  userLookups: 0,
  tenant: "aaaaaaaa-0000-4000-8000-00000000000a" as string | null,
  tenantThrows: false,
  hosts: [] as (string | null)[],
  rpc: vi.fn(),
  request: new Request("https://nes.example/_serverFn", {
    headers: { "cf-connecting-ip": "192.0.2.7", "x-forwarded-for": "203.0.113.5" },
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
  optionalUserIdFromRequest: async () => {
    h.userLookups += 1;
    return h.userId;
  },
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
const TENANT = "aaaaaaaa-0000-4000-8000-00000000000a";

/** Wiersz biletu w kształcie formularza (`_event_registration_ticket_json`). */
const VIP_ROW = {
  id: "t-vip",
  key: "vip",
  name_pl: "Bilet VIP",
  name_en: "VIP pass",
  price_cents: 9900,
  effective_price_cents: 9900,
  currency: "PLN",
  availability: "on_sale",
  is_hidden: true,
  requires_access_code: false,
};

beforeEach(() => {
  h.allowed = true;
  h.probeCalls = [];
  h.userId = null;
  h.userLookups = 0;
  h.tenant = TENANT;
  h.tenantThrows = false;
  h.hosts = [];
  h.rpc.mockReset();
  h.rpc.mockResolvedValue({ data: [VIP_ROW], error: null });
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

  it("limit dostaje nagłówki żądania i konto z sesji; sesja czytana RAZ", async () => {
    h.userId = "user-1";
    await revealTicketsForEventCode(EVENT, "VIP10");

    expect(h.probeCalls).toHaveLength(1);
    expect(h.probeCalls[0]!.headers).toBe(h.request.headers);
    expect(h.probeCalls[0]!.userId).toBe("user-1");
    expect(h.userLookups).toBe(1);
    expect(h.rpc.mock.calls[0]![1]).toMatchObject({ _user_id: "user-1" });
  });

  it("najemca, konto (NULL dla gościa) i skrót adresu idą do RPC jawnie, kod po normalizacji", async () => {
    const result = await revealTicketsForEventCode(EVENT, "  vip10 ");
    expect(h.hosts).toEqual(["nes.example"]);
    expect(h.rpc).toHaveBeenCalledTimes(1);
    expect(h.rpc).toHaveBeenCalledWith("event_registration_revealed_tickets", {
      _tenant_id: TENANT,
      _user_id: null,
      _probe_subject: requestRateSubject(new Headers({ "cf-connecting-ip": "192.0.2.7" })),
      p_event_id: EVENT,
      p_code: "VIP10",
    });
    const subject = h.rpc.mock.calls[0]![1]._probe_subject as string;
    expect(subject).toMatch(/^ip:[0-9a-f]{32}$/);
    expect(JSON.stringify(h.rpc.mock.calls)).not.toContain("192.0.2.7");
    expect(JSON.stringify(h.rpc.mock.calls)).not.toContain("203.0.113.5");
    expect(result.ok).toBe(true);
  });

  it("odpowiedź niesie PEŁNE wiersze biletów w kształcie formularza", async () => {
    const result = await revealTicketsForEventCode(EVENT, "VIP10");
    if (!result.ok) throw new Error("test: oczekiwano odsłonięcia");
    expect(result.ticketIds).toEqual(["t-vip"]);
    expect(result.tickets).toHaveLength(1);
    expect(result.tickets[0]).toMatchObject({
      id: "t-vip",
      key: "vip",
      namePl: "Bilet VIP",
      effectivePriceCents: 9900,
      isHidden: true,
      availability: "on_sale",
    });
  });

  it("pusta lista z bazy to zwykła odpowiedź - pudło nie różni się od kodu bez biletów", async () => {
    h.rpc.mockResolvedValue({ data: [], error: null });
    expect(await revealTicketsForEventCode(EVENT, "ZLY")).toEqual({
      ok: true,
      ticketIds: [],
      tickets: [],
    });
  });

  it("odpowiedź bez listy (null) i śmieci w wierszach to pusta lista, nie awaria", async () => {
    h.rpc.mockResolvedValue({ data: null, error: null });
    expect(await revealTicketsForEventCode(EVENT, "VIP10")).toEqual({
      ok: true,
      ticketIds: [],
      tickets: [],
    });
    h.rpc.mockResolvedValue({ data: [VIP_ROW, 7, null, { key: "bez-id" }], error: null });
    const result = await revealTicketsForEventCode(EVENT, "VIP10");
    expect(result.ok ? result.ticketIds : null).toEqual(["t-vip"]);
  });

  it("błąd bazy to `error`, nie pusta lista - i NIE uruchamia starej funkcji", async () => {
    h.rpc.mockResolvedValue({ data: null, error: { code: "42501", message: "permission denied" } });
    expect(await revealTicketsForEventCode(EVENT, "VIP10")).toEqual({ ok: false, reason: "error" });
    expect(h.rpc).toHaveBeenCalledTimes(1);
  });

  it.each(["PGRST202", "42883"])(
    "okno wdrożenia (%s): stara funkcja oddaje same identyfikatory",
    async (code) => {
      h.rpc.mockImplementation(async (name: string) =>
        name === "event_registration_revealed_tickets"
          ? { data: null, error: { code, message: "function not found" } }
          : { data: ["t-vip", 7, null], error: null },
      );
      expect(await revealTicketsForEventCode(EVENT, " vip10 ")).toEqual({
        ok: true,
        ticketIds: ["t-vip"],
        tickets: [],
      });
      expect(h.rpc.mock.calls[1]).toEqual([
        "event_coupon_revealed_tickets",
        { p_tenant: TENANT, p_event_id: EVENT, p_code: "VIP10" },
      ]);
    },
  );

  it("błąd starej funkcji w oknie wdrożenia to też `error`", async () => {
    h.rpc.mockImplementation(async (name: string) =>
      name === "event_registration_revealed_tickets"
        ? { data: null, error: { code: "PGRST202", message: "x" } }
        : { data: null, error: { message: "permission denied" } },
    );
    expect(await revealTicketsForEventCode(EVENT, "VIP10")).toEqual({ ok: false, reason: "error" });
  });

  it("brak najemcy albo awaria katalogu to `error` bez pytania bazy", async () => {
    h.tenant = null;
    expect(await revealTicketsForEventCode(EVENT, "VIP10")).toEqual({ ok: false, reason: "error" });
    h.tenant = TENANT;
    h.tenantThrows = true;
    expect(await revealTicketsForEventCode(EVENT, "VIP10")).toEqual({ ok: false, reason: "error" });
    expect(h.rpc).not.toHaveBeenCalled();
  });
});

describe("revealEventCodeTickets (deklaracja)", () => {
  it("handler przekazuje wejście po walidacji do warstwy serwerowej", async () => {
    const result = await callServerFn<{ ok: boolean; ticketIds: string[] }>(
      revealEventCodeTickets,
      { data: { eventId: EVENT, code: " vip10 " }, context: { supabase: null } },
    );
    expect(result.ticketIds).toEqual(["t-vip"]);
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
