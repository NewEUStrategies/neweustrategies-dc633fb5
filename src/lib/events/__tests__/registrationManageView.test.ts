// Podgląd stanu zgłoszenia po kluczu (`event_registration_manage_view`) -
// odczyt odpowiedzi bazy (REG-17, migracja 20261012160000).
//
// Klucz wygasły z końcem wydarzenia baza oddaje jako `{ok:false,
// reason:'expired'}`. Strona samoobsługi mówi wtedy „odnośnik wygasł" (i co
// zrobić), a nie „nie znaleziono" - uczestnik nie szuka literówki w kluczu.
// `fetchRegistrationManageView` zostaje obwódką „jest albo nie ma" dla
// dotychczasowych wołających (gniazda, atrapy), więc jej kształt się nie zmienia.
import { beforeEach, describe, expect, it, vi } from "vitest";

import { supabaseRpcStub } from "@/test/supabase/rpc";

const h = vi.hoisted(() => ({
  rpc: null as ReturnType<typeof import("@/test/supabase/rpc").supabaseRpcStub> | null,
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (name: string, args?: Record<string, unknown>) => {
      if (h.rpc === null) throw new Error("test: atrapa RPC nie zostala ustawiona");
      return h.rpc.rpc(name, args);
    },
  },
}));

vi.mock("@/lib/events/eventRegistration.functions", () => ({
  submitEventRegistration: vi.fn(),
}));

const api = await import("@/lib/events/publicRegistrationApi");

const TOKEN = "Ab3d_Xy9-Qw1zEr4TyU7iOp2AsDf1gHj";
const REG = "dddddddd-dddd-dddd-dddd-dddddddddddd";

const ROW = {
  ok: true,
  registration_id: REG,
  event_id: "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee",
  event_slug: "kongres",
  ticket_type_id: null,
  status: "approved",
  payment_status: "unpaid",
  waitlist_position: null,
  amount_cents: 5000,
  price_source: "quote",
  quote_valid_until: "2026-10-14T10:00:00+00:00",
  currency: "PLN",
  owned_by_caller: false,
};

function rpc(): ReturnType<typeof supabaseRpcStub> {
  if (h.rpc === null) throw new Error("test: atrapa RPC nie zostala ustawiona");
  return h.rpc;
}

beforeEach(() => {
  h.rpc = supabaseRpcStub();
});

describe("loadRegistrationManageView", () => {
  it("klucz jedzie w `p_payload.manage_token` - i nic więcej", async () => {
    rpc().setData("event_registration_manage_view", ROW);
    await api.loadRegistrationManageView({ manageToken: TOKEN });
    expect(rpc().lastCall("event_registration_manage_view")?.arg("p_payload")).toEqual({
      manage_token: TOKEN,
    });
  });

  it("odpowiedź `ok` -> widok ze stanem i kwotą", async () => {
    rpc().setData("event_registration_manage_view", ROW);
    expect(await api.loadRegistrationManageView({ manageToken: TOKEN })).toEqual({
      kind: "view",
      view: {
        registrationId: REG,
        eventId: ROW.event_id,
        eventSlug: "kongres",
        ticketTypeId: null,
        status: "approved",
        paymentStatus: "unpaid",
        waitlistPosition: null,
        amountCents: 5000,
        currency: "PLN",
        ownedByCaller: false,
        // SCALENIE Z MAIN (runda 4): flaga zgody partnerskiej (main OPS-01,
        // 20261013110400) w widoku REG-17; odpowiedź bez klucza -> `false`.
        partnerConsent: false,
      },
    });
  });

  it("OPS-01 (main) w widoku REG-17: `partner_consent: true` -> `partnerConsent`", async () => {
    rpc().setData("event_registration_manage_view", { ...ROW, partner_consent: true });
    const result = await api.loadRegistrationManageView({ manageToken: TOKEN });
    expect(result.kind === "view" && result.view.partnerConsent).toBe(true);
  });

  it("REG-17: `{ok:false, reason:'expired'}` -> `expired`, nie „nie znaleziono”", async () => {
    rpc().setData("event_registration_manage_view", { ok: false, reason: "expired" });
    expect(await api.loadRegistrationManageView({ manageToken: TOKEN })).toEqual({
      kind: "expired",
    });
  });

  it.each([
    ["nieznany klucz", { ok: false, reason: "not_found" }],
    ["inny powód", { ok: false, reason: "cos_nowego" }],
    ["brak obiektu", null],
    ["wiersz bez identyfikatora", { ...ROW, registration_id: null }],
  ])("%s -> `not_found`", async (_label, data) => {
    rpc().setData("event_registration_manage_view", data);
    expect(await api.loadRegistrationManageView({ manageToken: TOKEN })).toEqual({
      kind: "not_found",
    });
  });

  it("błąd bazy to wyjątek (awaria), nie „nie znaleziono”", async () => {
    rpc().setError("event_registration_manage_view", "boom", "XX000");
    await expect(api.loadRegistrationManageView({ manageToken: TOKEN })).rejects.toBeTruthy();
  });
});

describe("fetchRegistrationManageView (obwódka „jest albo nie ma”)", () => {
  it("widok -> widok; wygasły i nieznany -> `null`", async () => {
    rpc().setData("event_registration_manage_view", ROW);
    expect((await api.fetchRegistrationManageView({ manageToken: TOKEN }))?.registrationId).toBe(
      REG,
    );
    rpc().setData("event_registration_manage_view", { ok: false, reason: "expired" });
    expect(await api.fetchRegistrationManageView({ manageToken: TOKEN })).toBeNull();
    rpc().setData("event_registration_manage_view", { ok: false, reason: "not_found" });
    expect(await api.fetchRegistrationManageView({ manageToken: TOKEN })).toBeNull();
  });
});
