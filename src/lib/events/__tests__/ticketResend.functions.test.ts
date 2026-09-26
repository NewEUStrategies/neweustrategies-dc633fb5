// Ponowna wysyłka biletu z panelu: kolejność granic i kształt wyniku.
//
// DLACZEGO TEN TEST ISTNIEJE. Funkcja łączy dwa klienty o różnych
// uprawnieniach: RPC `admin_event_ticket_resend_scope` i `admin_event_ticket_resend`
// idą klientem ORGANIZATORA (bramka roli i najemcy w bazie), a bramka listy
// wykluczeń i wydanie kodu - kluczem serwisowym. Klucz serwisowy nie może
// dostać identyfikatora, którego baza nie przepuściła: wtedy dowolny zalogowany
// rotowałby kody cudzych gości. Dlatego dowodzimy, że przy odmowie RPC wydanie
// NIE rusza, a przy zgodzie dostaje identyfikator Z BAZY (korzeń grupy), a nie
// ten z żądania.
//
// DRUGA RZECZ: ADRES Z LISTY WYKLUCZEŃ NIE TRACI BILETU. Wydanie rotuje kod
// przed wysyłką, a mail na zablokowany adres nie wyjdzie - więc pojedynczy
// wiersz z takim adresem kończy się odmową BEZ wywołania ponownej wysyłki,
// a z grupy zablokowane wiersze idą do `p_exclude_ids`.
import { beforeEach, describe, expect, it, vi } from "vitest";

const { issueAndSendTicketCodes, suppressedTicketRecipients } = vi.hoisted(() => ({
  issueAndSendTicketCodes: vi.fn(),
  suppressedTicketRecipients: vi.fn(),
}));

vi.mock("@tanstack/react-start", () => ({
  createServerFn: () => {
    let validate: ((data: unknown) => unknown) | undefined;
    const api = {
      middleware: () => api,
      inputValidator: (fn: (data: unknown) => unknown) => {
        validate = fn;
        return api;
      },
      handler: (fn: unknown) => Object.assign(fn as object, { validate }),
    };
    return api;
  },
}));

vi.mock("@/integrations/supabase/auth-middleware", () => ({ requireSupabaseAuth: {} }));
vi.mock("@/lib/events/ticketCodeNotify.server", () => ({ issueAndSendTicketCodes }));
vi.mock("@/lib/events/ticketResend.server", () => ({ suppressedTicketRecipients }));

const { resendEventTicket } = await import("@/lib/events/ticketResend.functions");

type Result = {
  ok: boolean;
  sent?: number;
  attempted?: number;
  skippedSuppressed?: number;
  error?: string;
};
type Callable = (input: {
  data: { registrationId: string; includeGroup: boolean };
  context: { supabase: { rpc: ReturnType<typeof vi.fn> } };
}) => Promise<Result>;

const resend = resendEventTicket as unknown as Callable;
const validator = resendEventTicket as unknown as { validate: (data: unknown) => unknown };

const GUEST = "22222222-2222-4222-8222-222222222222";
const LEAD = "11111111-1111-4111-8111-111111111111";
const TENANT = "33333333-3333-4333-8333-333333333333";

type Response = { data: unknown; error: { message: string } | null };

const SCOPE = [
  { registration_id: LEAD, email: "lead@example.org", tenant_id: TENANT },
  { registration_id: GUEST, email: "guest@example.org", tenant_id: TENANT },
];

/** Atrapa klienta organizatora: osobna odpowiedź dla zakresu i dla ponownej wysyłki. */
function client(resendResponse: Response, scopeResponse: Response = { data: SCOPE, error: null }) {
  const rpc = vi.fn(async (name: string, _args: unknown) =>
    name === "admin_event_ticket_resend_scope" ? scopeResponse : resendResponse,
  );
  return { supabase: { rpc }, rpc };
}

const resendCalls = (rpc: ReturnType<typeof vi.fn>) =>
  rpc.mock.calls.filter((call) => call[0] === "admin_event_ticket_resend");

beforeEach(() => {
  issueAndSendTicketCodes.mockReset();
  issueAndSendTicketCodes.mockResolvedValue(3);
  suppressedTicketRecipients.mockReset();
  suppressedTicketRecipients.mockResolvedValue([]);
});

describe("walidator wejścia", () => {
  it("domyślnie obejmuje całą grupę", () => {
    expect(validator.validate({ registrationId: GUEST })).toEqual({
      registrationId: GUEST,
      includeGroup: true,
    });
  });

  it("przepuszcza jawne `includeGroup: false`", () => {
    expect(validator.validate({ registrationId: GUEST, includeGroup: false })).toEqual({
      registrationId: GUEST,
      includeGroup: false,
    });
  });

  it("odrzuca identyfikator, który nie jest UUID, i flagę, która nie jest logiczna", () => {
    expect(() => validator.validate({ registrationId: "1 OR 1=1" })).toThrow();
    expect(() => validator.validate({ registrationId: GUEST, includeGroup: "tak" })).toThrow();
    expect(() => validator.validate(null)).toThrow();
  });
});

describe("resendEventTicket", () => {
  it("czyta zakres, sprawdza adresy, woła RPC organizatora - wydanie dostaje korzeń z BAZY", async () => {
    const { supabase, rpc } = client({ data: LEAD, error: null });
    const result = await resend({
      data: { registrationId: GUEST, includeGroup: true },
      context: { supabase },
    });
    expect(rpc.mock.calls.map((call) => call[0])).toEqual([
      "admin_event_ticket_resend_scope",
      "admin_event_ticket_resend",
    ]);
    expect(rpc).toHaveBeenCalledWith("admin_event_ticket_resend_scope", {
      p_registration_id: GUEST,
      p_include_group: true,
    });
    expect(suppressedTicketRecipients).toHaveBeenCalledWith(SCOPE);
    expect(rpc).toHaveBeenCalledWith("admin_event_ticket_resend", {
      p_registration_id: GUEST,
      p_include_group: true,
      p_exclude_ids: [],
    });
    expect(issueAndSendTicketCodes).toHaveBeenCalledWith(LEAD);
    expect(result).toEqual({ ok: true, sent: 3, attempted: 2, skippedSuppressed: 0 });
  });

  it("przekazuje `includeGroup: false` bez zmian", async () => {
    const { supabase, rpc } = client({ data: GUEST, error: null });
    await resend({ data: { registrationId: GUEST, includeGroup: false }, context: { supabase } });
    expect(rpc.mock.calls[0]?.[1]).toEqual({ p_registration_id: GUEST, p_include_group: false });
    expect(resendCalls(rpc)[0]?.[1]).toEqual({
      p_registration_id: GUEST,
      p_include_group: false,
      p_exclude_ids: [],
    });
    expect(issueAndSendTicketCodes).toHaveBeenCalledWith(GUEST);
  });

  it("grupa: zablokowane adresy wypadają z ponownej wysyłki i wracają jako pominięte", async () => {
    suppressedTicketRecipients.mockResolvedValue([GUEST]);
    issueAndSendTicketCodes.mockResolvedValue(1);
    const { supabase, rpc } = client({ data: LEAD, error: null });
    const result = await resend({
      data: { registrationId: LEAD, includeGroup: true },
      context: { supabase },
    });
    expect(resendCalls(rpc)[0]?.[1]).toEqual({
      p_registration_id: LEAD,
      p_include_group: true,
      p_exclude_ids: [GUEST],
    });
    expect(result).toEqual({ ok: true, sent: 1, attempted: 1, skippedSuppressed: 1 });
  });

  it("cała grupa na liście wykluczeń: nikogo nie przekazano do wysyłki (`attempted: 0`) - to nie awaria", async () => {
    suppressedTicketRecipients.mockResolvedValue([LEAD, GUEST]);
    issueAndSendTicketCodes.mockResolvedValue(0);
    const { supabase, rpc } = client({ data: LEAD, error: null });
    const result = await resend({
      data: { registrationId: LEAD, includeGroup: true },
      context: { supabase },
    });
    // Wszystkie wiersze wykluczone - żaden znacznik nie znika, żaden kod się nie rotuje.
    expect(resendCalls(rpc)[0]?.[1]).toEqual({
      p_registration_id: LEAD,
      p_include_group: true,
      p_exclude_ids: [LEAD, GUEST],
    });
    expect(result).toEqual({ ok: true, sent: 0, attempted: 0, skippedSuppressed: 2 });
  });

  it("pojedynczy wiersz z zablokowanym adresem: odmowa BEZ ponownej wysyłki - stary kod działa", async () => {
    suppressedTicketRecipients.mockResolvedValue([GUEST]);
    const { supabase, rpc } = client(
      { data: GUEST, error: null },
      { data: [SCOPE[1]], error: null },
    );
    const result = await resend({
      data: { registrationId: GUEST, includeGroup: false },
      context: { supabase },
    });
    expect(result).toEqual({
      ok: false,
      error: "ticket_address_suppressed: the address is on the suppression list",
    });
    expect(resendCalls(rpc)).toEqual([]);
    expect(issueAndSendTicketCodes).not.toHaveBeenCalled();
  });

  it("odmowa odczytu zakresu wraca jako tekst i niczego dalej nie uruchamia", async () => {
    const { supabase, rpc } = client(
      { data: LEAD, error: null },
      { data: null, error: { message: "forbidden: admin role required" } },
    );
    const result = await resend({
      data: { registrationId: GUEST, includeGroup: true },
      context: { supabase },
    });
    expect(result).toEqual({ ok: false, error: "forbidden: admin role required" });
    expect(suppressedTicketRecipients).not.toHaveBeenCalled();
    expect(resendCalls(rpc)).toEqual([]);
    expect(issueAndSendTicketCodes).not.toHaveBeenCalled();
  });

  it("pusty zakres (null z bazy) to pusta lista do sprawdzenia - odmowę da ponowna wysyłka", async () => {
    const { supabase } = client(
      {
        data: null,
        error: { message: "ticket_not_issuable: only an approved and settled registration" },
      },
      { data: null, error: null },
    );
    const result = await resend({
      data: { registrationId: GUEST, includeGroup: true },
      context: { supabase },
    });
    expect(suppressedTicketRecipients).toHaveBeenCalledWith([]);
    expect(result).toEqual({
      ok: false,
      error: "ticket_not_issuable: only an approved and settled registration",
    });
    expect(issueAndSendTicketCodes).not.toHaveBeenCalled();
  });

  it.each([null, "", 42])("odpowiedź bez identyfikatora (%j) to `not_found`", async (data) => {
    const { supabase } = client({ data, error: null });
    const result = await resend({
      data: { registrationId: GUEST, includeGroup: true },
      context: { supabase },
    });
    expect(result).toEqual({ ok: false, error: "not_found" });
    expect(issueAndSendTicketCodes).not.toHaveBeenCalled();
  });

  it("zero wysłanych to wynik, nie wyjątek - panel mówi o nim osobno", async () => {
    issueAndSendTicketCodes.mockResolvedValue(0);
    const { supabase } = client({ data: LEAD, error: null });
    const result = await resend({
      data: { registrationId: LEAD, includeGroup: true },
      context: { supabase },
    });
    expect(result).toEqual({ ok: true, sent: 0, attempted: 2, skippedSuppressed: 0 });
  });
});
