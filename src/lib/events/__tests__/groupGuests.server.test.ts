// Dopisanie gości przez SERWER (`groupGuests.functions.ts` + `groupGuests.server.ts`,
// przegląd R38, REG-04).
//
// CO KONKRETNIE PSUJE SIĘ BEZ TYCH TESTÓW.
//   1. WYROCZNIA CZŁONKOSTWA W ODPOWIEDZI - adres gościa, który ma już zapis,
//      w `client` (ogon odmowy, lista pominiętych) mówi prowadzącemu, kto jest
//      zapisany na wydarzenie.
//   2. CICHE POMINIĘCIE - gość z zapisem znika z listy, a jego właściciel nie
//      wie, że ktoś wpisał jego adres; wiadomość musi wyjść z SERWERA.
//   3. KUBEŁEK ADRESU OBCHODZONY - surowy adres w bazie albo kubełek kluczowany
//      nagłówkiem, który klient podrabia (`x-forwarded-for`).
//   4. TOŻSAMOŚĆ Z CIAŁA ŻĄDANIA - najemca albo konto z ładunku.
//   5. FAŁSZYWE OKNO WDROŻENIA - stara funkcja wołana przy KAŻDYM błędzie,
//      a nie tylko przy PGRST202/42883.
//
// ATRAPUJEMY WYŁĄCZNIE GRANICE: żądanie, sesję, host, katalog najemców, klienta
// serwisowego, klienta z nagłówkiem hosta, pocztę i `waitUntil`.
// `requestRateSubject`, parser dostawy, wysyłka wiadomości „już zapisany"
// (`deliverRegistration`) i walidator Zod jadą PRAWDZIWE.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { requestRateSubject } from "@/lib/server/rateSubject.server";
import {
  callServerFn,
  serverFnMiddlewareNames,
  validateServerFnInput,
} from "@/test/serverFnHarness";
import { REGISTRATION_FIELD_LIMITS } from "@/lib/events/registrationFieldLimits";

const CF_IP = "192.0.2.7";
const SPOOF_IP = "203.0.113.99";

const h = vi.hoisted(() => ({
  request: null as Request | null,
  userId: null as string | null,
  bearer: null as string | null,
  tenant: "aaaaaaaa-0000-4000-8000-00000000000a" as string | null,
  hosts: [] as (string | null)[],
  rpc: vi.fn(),
  hostRpc: vi.fn(),
  hostBearers: [] as (string | null)[],
  background: [] as Promise<unknown>[],
  sendTxEmail: vi.fn(),
}));

vi.mock("@tanstack/react-start", async () =>
  (await import("@/test/serverFnHarness")).serverFnStubModule(),
);
vi.mock("@tanstack/react-start/server", () => ({
  getRequest: () => {
    if (h.request === null) throw new Error("brak żądania");
    return h.request;
  },
}));
vi.mock("@/lib/auth/optionalUser.server", () => ({
  optionalUserIdFromRequest: async () => h.userId,
  optionalBearerFromRequest: async () => h.bearer,
}));
vi.mock("@/lib/http/requestHost", () => ({ currentTenantHost: async () => "nes.example" }));
vi.mock("@/lib/server/tenant.server", () => ({
  resolveTenantIdForHost: async (host: string | null) => {
    h.hosts.push(host);
    return h.tenant;
  },
}));
vi.mock("@/integrations/supabase/client.server", () => ({ supabaseAdmin: { rpc: h.rpc } }));
vi.mock("@/lib/http/waitUntil.server", () => ({
  runAfterResponse: (work: Promise<unknown>) => {
    h.background.push(work);
  },
}));
vi.mock("@/lib/events/registrationSelfNotify.server", () => ({
  hostAnonClient: async (bearer: string | null = null) => {
    h.hostBearers.push(bearer);
    return { rpc: h.hostRpc };
  },
  sendRegistrationNoticeForManageToken: vi.fn(),
}));
vi.mock("@/lib/email/transactional.server", () => ({
  sendTxEmail: (input: unknown) => h.sendTxEmail(input),
}));

const { registerEventGroupGuestsForRequest } = await import("@/lib/events/groupGuests.server");
const { registerEventGroupGuests } = await import("@/lib/events/groupGuests.functions");

const TENANT = "aaaaaaaa-0000-4000-8000-00000000000a";
const USER = "cccccccc-0000-4000-8000-00000000000c";
const LEAD = "dddddddd-0000-4000-8000-00000000000d";
const TAKEN_REG = "eeeeeeee-0000-4000-8000-0000000000e1";
const MEMBER_EMAIL = "zapisana@example.org";

const GUESTS = [
  { first_name: "Maria", last_name: "Zapisana", email: MEMBER_EMAIL },
  { first_name: "Jan", last_name: "Nowy", email: "jan.nowy@example.org" },
];

function request(headers: Record<string, string> = {}): Request {
  return new Request("https://nes.example/_serverFn/guests", {
    method: "POST",
    headers: { "cf-connecting-ip": CF_IP, "x-forwarded-for": `${SPOOF_IP}, 10.0.0.1`, ...headers },
  });
}

/** Wiadomość „już zapisany" w kształcie dostawy zapisu (kanał serwerowy). */
function notice(over: Record<string, unknown> = {}) {
  return {
    kind: "already_registered",
    registration_id: TAKEN_REG,
    status: "approved",
    recipient: { email: MEMBER_EMAIL, first_name: "Maria", lang: "en" },
    event: {
      id: "ffffffff-0000-4000-8000-0000000000f1",
      slug: "kongres",
      title_pl: "Kongres",
      title_en: "Congress",
      starts_at: "2099-09-01T08:00:00Z",
    },
    consent_confirmation: null,
    ...over,
  };
}

function respond(client: unknown, delivery: unknown = []): void {
  h.rpc.mockResolvedValue({ data: { client, delivery }, error: null });
}

/** Argumenty jedynego wywołania wejścia serwerowego. */
function guestsArgs(): Record<string, unknown> {
  const calls = h.rpc.mock.calls.filter(
    ([name]) => name === "event_register_group_guests_for_client",
  );
  expect(calls).toHaveLength(1);
  return calls[0]![1] as Record<string, unknown>;
}

async function drain(): Promise<void> {
  const pending = [...h.background];
  h.background = [];
  await Promise.all(pending);
}

function duplicateNotices(): Record<string, unknown>[] {
  return h.sendTxEmail.mock.calls
    .map(([arg]) => arg as Record<string, unknown>)
    .filter((arg) => arg.type === "event_registration_already_registered");
}

beforeEach(() => {
  h.request = request();
  h.userId = USER;
  h.bearer = "user-jwt";
  h.tenant = TENANT;
  h.hosts = [];
  h.rpc.mockReset();
  h.hostRpc.mockReset();
  h.hostBearers = [];
  h.background = [];
  h.sendTxEmail.mockReset();
  h.sendTxEmail.mockResolvedValue({ ok: true });
  respond({ ok: true, added: 2 });
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("tożsamość z serwera, nigdy z ciała żądania", () => {
  it("woła wejście serwerowe z najemcą z hosta, kontem z sesji i solonym skrótem adresu", async () => {
    await registerEventGroupGuestsForRequest({ leadRegistrationId: LEAD, guests: GUESTS });
    const args = guestsArgs();
    expect(Object.keys(args).sort()).toEqual([
      "_ip_subject",
      "_tenant_id",
      "_user_id",
      "p_guests",
      "p_lead_registration_id",
    ]);
    expect(h.hosts).toEqual(["nes.example"]);
    expect(args._tenant_id).toBe(TENANT);
    expect(args._user_id).toBe(USER);
    expect(args._ip_subject).toMatch(/^ip:[0-9a-f]{32}$/);
    expect(args._ip_subject).toBe(requestRateSubject(new Headers({ "cf-connecting-ip": CF_IP })));
    expect(args.p_lead_registration_id).toBe(LEAD);
    expect(args.p_guests).toEqual(GUESTS);
  });

  it("podrobiony x-forwarded-for nie zmienia kubełka, a surowy adres nie trafia do bazy", async () => {
    await registerEventGroupGuestsForRequest({ leadRegistrationId: LEAD, guests: GUESTS });
    const subject = guestsArgs()._ip_subject;
    h.rpc.mockClear();
    h.request = request({ "x-forwarded-for": "198.51.100.1" });
    await registerEventGroupGuestsForRequest({ leadRegistrationId: LEAD, guests: GUESTS });
    expect(guestsArgs()._ip_subject).toBe(subject);
    const serialized = JSON.stringify(h.rpc.mock.calls);
    expect(serialized).not.toContain(CF_IP);
    expect(serialized).not.toContain(SPOOF_IP);
  });

  it("bez sesji - account_required bez pytania bazy (i bez kubełka)", async () => {
    h.userId = null;
    expect(
      await registerEventGroupGuestsForRequest({ leadRegistrationId: LEAD, guests: GUESTS }),
    ).toEqual({ ok: false, error: "account_required" });
    expect(h.rpc).not.toHaveBeenCalled();
  });

  it("host bez najemcy to `unknown` BEZ pytania bazy", async () => {
    h.tenant = null;
    expect(
      await registerEventGroupGuestsForRequest({ leadRegistrationId: LEAD, guests: GUESTS }),
    ).toEqual({ ok: false, error: "unknown" });
    expect(h.rpc).not.toHaveBeenCalled();
  });
});

describe("odpowiedź bez wyroczni członkostwa (R38)", () => {
  it("gość z zapisem: przeglądarka dostaje samo {ok, added}, adres idzie wyłącznie do skrzynki", async () => {
    respond({ ok: true, added: 2 }, [notice()]);

    const client = await registerEventGroupGuestsForRequest({
      leadRegistrationId: LEAD,
      guests: GUESTS,
    });

    expect(client).toEqual({ ok: true, added: 2 });
    expect(JSON.stringify(client)).not.toContain(MEMBER_EMAIL);
    expect(JSON.stringify(client)).not.toContain(TAKEN_REG);
    // Wiadomość biegnie PO odpowiedzi - czas odpowiedzi nie zdradza pominięcia.
    expect(h.sendTxEmail).not.toHaveBeenCalled();
    await drain();
    const sent = duplicateNotices();
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      to: MEMBER_EMAIL,
      lang: "en",
      tenantId: TENANT,
      ctaPath: "/events/kongres",
      metaName: "Maria",
    });
    expect(String(sent[0]!.idempotencyKey)).toContain(TAKEN_REG);
  });

  it("lista bez pominiętych - ta sama odpowiedź i żadnej wiadomości", async () => {
    respond({ ok: true, added: 2 }, []);
    expect(
      await registerEventGroupGuestsForRequest({ leadRegistrationId: LEAD, guests: GUESTS }),
    ).toEqual({ ok: true, added: 2 });
    expect(h.background).toEqual([]);
  });

  it("dostawa innego rodzaju niż „już zapisany” nie wysyła niczego", async () => {
    respond({ ok: true, added: 1 }, [notice({ kind: "created", manage_token: "x".repeat(32) })]);
    await registerEventGroupGuestsForRequest({ leadRegistrationId: LEAD, guests: GUESTS });
    await drain();
    expect(h.sendTxEmail).not.toHaveBeenCalled();
  });

  it("odmowa to SAM kod - ogon (np. adres) nie wychodzi", async () => {
    respond({ ok: false, error: "duplicate_guest", detail: MEMBER_EMAIL });
    expect(
      await registerEventGroupGuestsForRequest({ leadRegistrationId: LEAD, guests: GUESTS }),
    ).toEqual({ ok: false, error: "duplicate_guest" });
  });

  it("nieznany kształt albo kod to `unknown`", async () => {
    for (const client of [
      null,
      "ok",
      { ok: true },
      { ok: true, added: -1 },
      { ok: false, error: "Zły Kod" },
    ]) {
      respond(client);
      expect(
        await registerEventGroupGuestsForRequest({ leadRegistrationId: LEAD, guests: GUESTS }),
        JSON.stringify(client),
      ).toEqual({ ok: false, error: "unknown" });
    }
  });
});

describe("okno wdrożenia - stara funkcja tylko przy PGRST202/42883", () => {
  for (const code of ["PGRST202", "42883"]) {
    it(`${code}: stara funkcja z tokenem wołającego; jej adres z ogona nie wychodzi`, async () => {
      h.rpc.mockResolvedValue({ data: null, error: { code, message: "missing" } });
      h.hostRpc.mockResolvedValueOnce({
        data: null,
        error: { message: `already_registered: ${MEMBER_EMAIL}` },
      });

      const client = await registerEventGroupGuestsForRequest({
        leadRegistrationId: LEAD,
        guests: GUESTS,
      });

      expect(client).toEqual({ ok: false, error: "already_registered" });
      expect(h.hostBearers).toEqual(["user-jwt"]);
      expect(h.hostRpc).toHaveBeenCalledWith("event_register_group_guests", {
        p_lead_registration_id: LEAD,
        p_guests: GUESTS,
      });

      h.hostRpc.mockResolvedValueOnce({
        data: { ok: true, added: 2, registration_ids: ["r-1", "r-2"] },
        error: null,
      });
      expect(
        await registerEventGroupGuestsForRequest({ leadRegistrationId: LEAD, guests: GUESTS }),
      ).toEqual({ ok: true, added: 2 });
    });
  }

  it("każdy inny błąd bazy to `unknown` bez starej funkcji", async () => {
    h.rpc.mockResolvedValue({ data: null, error: { code: "42501", message: "permission denied" } });
    expect(
      await registerEventGroupGuestsForRequest({ leadRegistrationId: LEAD, guests: GUESTS }),
    ).toEqual({ ok: false, error: "unknown" });
    expect(h.hostRpc).not.toHaveBeenCalled();
  });
});

describe("funkcja serwerowa `registerEventGroupGuests`", () => {
  const valid = { leadRegistrationId: LEAD, guests: GUESTS };

  it("jest POST bez middleware (bez konta odpowiada account_required) i przekazuje wejście", async () => {
    expect(serverFnMiddlewareNames(registerEventGroupGuests)).toEqual([]);
    expect(Reflect.get(registerEventGroupGuests as object, "method")).toBe("POST");
    expect(
      await callServerFn(registerEventGroupGuests, { data: valid, context: { supabase: null } }),
    ).toEqual({ ok: true, added: 2 });
    expect(guestsArgs().p_guests).toEqual(GUESTS);
  });

  it("odrzuca klucze tożsamości, nie-uuid prowadzącego, ponad 49 gości i pola ponad sufity", () => {
    const L = REGISTRATION_FIELD_LIMITS;
    expect(validateServerFnInput(registerEventGroupGuests, valid)).toEqual(valid);
    for (const bad of [
      { ...valid, tenantId: TENANT },
      { ...valid, userId: USER },
      { ...valid, leadRegistrationId: "nie-uuid" },
      { ...valid, guests: Array.from({ length: 50 }, () => GUESTS[1]) },
      { ...valid, guests: [{ ...GUESTS[1], first_name: "A".repeat(L.name + 1) }] },
      { ...valid, guests: [{ ...GUESTS[1], email: `${"a".repeat(L.email)}@x.pl` }] },
      { ...valid, guests: [{ ...GUESTS[1], person_id: LEAD }] },
    ]) {
      expect(() => validateServerFnInput(registerEventGroupGuests, bad)).toThrow();
    }
  });
});
