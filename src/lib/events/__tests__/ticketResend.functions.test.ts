// Ponowna wysyłka biletu z panelu: kolejność granic i kształt wyniku.
//
// DLACZEGO TEN TEST ISTNIEJE. Funkcja łączy dwa klienty o różnych
// uprawnieniach: RPC `admin_event_ticket_resend` idzie klientem ORGANIZATORA
// (bramka roli i najemcy w bazie), a wydanie kodu - kluczem serwisowym. Klucz
// serwisowy nie może dostać identyfikatora, którego baza nie przepuściła:
// wtedy dowolny zalogowany rotowałby kody cudzych gości. Dlatego dowodzimy,
// że przy odmowie RPC wydanie NIE rusza, a przy zgodzie dostaje identyfikator
// Z BAZY (korzeń grupy), a nie ten z żądania.
import { beforeEach, describe, expect, it, vi } from "vitest";

const { issueAndSendTicketCodes } = vi.hoisted(() => ({ issueAndSendTicketCodes: vi.fn() }));

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

const { resendEventTicket } = await import("@/lib/events/ticketResend.functions");

type Result = { ok: boolean; sent?: number; error?: string };
type Callable = (input: {
  data: { registrationId: string; includeGroup: boolean };
  context: { supabase: { rpc: ReturnType<typeof vi.fn> } };
}) => Promise<Result>;

const resend = resendEventTicket as unknown as Callable;
const validator = resendEventTicket as unknown as { validate: (data: unknown) => unknown };

const GUEST = "22222222-2222-4222-8222-222222222222";
const LEAD = "11111111-1111-4111-8111-111111111111";

function client(response: { data: unknown; error: { message: string } | null }) {
  const rpc = vi.fn(async (_name: string, _args: unknown) => response);
  return { supabase: { rpc }, rpc };
}

beforeEach(() => {
  issueAndSendTicketCodes.mockReset();
  issueAndSendTicketCodes.mockResolvedValue(3);
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
  it("woła RPC organizatora, a wydanie dostaje korzeń z BAZY", async () => {
    const { supabase, rpc } = client({ data: LEAD, error: null });
    const result = await resend({
      data: { registrationId: GUEST, includeGroup: true },
      context: { supabase },
    });
    expect(rpc).toHaveBeenCalledWith("admin_event_ticket_resend", {
      p_registration_id: GUEST,
      p_include_group: true,
    });
    expect(issueAndSendTicketCodes).toHaveBeenCalledWith(LEAD);
    expect(result).toEqual({ ok: true, sent: 3 });
  });

  it("przekazuje `includeGroup: false` bez zmian", async () => {
    const { supabase, rpc } = client({ data: GUEST, error: null });
    await resend({ data: { registrationId: GUEST, includeGroup: false }, context: { supabase } });
    expect(rpc.mock.calls[0]?.[1]).toEqual({ p_registration_id: GUEST, p_include_group: false });
    expect(issueAndSendTicketCodes).toHaveBeenCalledWith(GUEST);
  });

  it("odmowa bazy wraca jako tekst i NIE uruchamia klucza serwisowego", async () => {
    const { supabase } = client({
      data: null,
      error: { message: "ticket_not_issuable: only an approved and settled registration" },
    });
    const result = await resend({
      data: { registrationId: GUEST, includeGroup: true },
      context: { supabase },
    });
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
    expect(result).toEqual({ ok: true, sent: 0 });
  });
});
