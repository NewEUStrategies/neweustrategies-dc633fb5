// Bilety grupy po bezpłatnym zapisie - wysyłka wyzwalana kluczem `manage_token`.
//
// GRANICA NAJEMCY I TOŻSAMOŚCI. Ta funkcja kończy się wydaniem biletów KLUCZEM
// SERWISOWYM (`issueAndSendTicketCodes` omija RLS). Jedyną bramką przed nim jest
// `event_registration_notify_payload` wołane klientem ANONIMOWYM z nagłówkiem
// hosta: baza ustala najemcę przez `public_tenant_id()` i zgłoszenie przez hash
// klucza. Ten plik pilnuje, że:
//   1. bez poprawnego kształtu klucza do bazy nie idzie nic;
//   2. klient niesie hosta (`fetchWithTenantHost`) - inaczej baza szukałaby
//      zgłoszenia u najemcy domyślnego;
//   3. odmowa bramki (cudzy najemca, nieznany klucz) NIE dociera do klucza
//      serwisowego;
//   4. identyfikator do wydania pochodzi WYŁĄCZNIE z wiersza bazy.
//
// PUŁAPKA HARNESSU (jak w `registrationSelfNotify.functions.test.ts`): atrapa
// `createServerFn` oddaje z `.handler(fn)` samą funkcję z doklejonym
// `validate`, więc test woła PRAWDZIWY walidator i PRAWDZIWY handler.
import { beforeEach, describe, expect, it, vi } from "vitest";

const { createClient, rpc, tenantFetch, issueAndSendTicketCodes } = vi.hoisted(() => {
  const rpcFn = vi.fn();
  return {
    rpc: rpcFn,
    createClient: vi.fn(() => ({ rpc: rpcFn })),
    tenantFetch: vi.fn(),
    issueAndSendTicketCodes: vi.fn(),
  };
});

vi.mock("@supabase/supabase-js", () => ({ createClient }));
vi.mock("@/integrations/supabase/tenant-host-fetch", () => ({ fetchWithTenantHost: tenantFetch }));
vi.mock("@/lib/events/ticketCodeNotify.server", () => ({ issueAndSendTicketCodes }));
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

const { sendGroupTicketCodes } = await import("@/lib/events/groupTicketCodes.functions");

type Result = { ok: true; sent: number } | { ok: false; error: string };
type Callable = (input: { data: { manageToken: string } }) => Promise<Result>;
type WithValidator = { validate: (data: unknown) => unknown };

const send = sendGroupTicketCodes as unknown as Callable;
const validator = sendGroupTicketCodes as unknown as WithValidator;

const TOKEN = "abcdefghijklmnopqrstuvwxyz012345";
const LEAD = "11111111-1111-4111-8111-111111111111";

async function run(row: unknown, error: { message: string } | null = null) {
  rpc.mockResolvedValue({ data: row, error });
  return send({ data: { manageToken: TOKEN } });
}

beforeEach(() => {
  process.env.SUPABASE_URL = "https://przyklad.supabase.co";
  process.env.SUPABASE_PUBLISHABLE_KEY = "klucz-publiczny";
  createClient.mockClear();
  rpc.mockReset();
  issueAndSendTicketCodes.mockReset();
  issueAndSendTicketCodes.mockResolvedValue(3);
});

describe("walidator klucza prowadzącego", () => {
  it("przepuszcza dokładnie 32 znaki base64url", () => {
    expect(validator.validate({ manageToken: TOKEN })).toEqual({ manageToken: TOKEN });
  });

  it.each([
    "",
    TOKEN.slice(0, 31),
    `${TOKEN}x`,
    `${TOKEN.slice(0, 31)}+`,
    `${TOKEN.slice(0, 31)}/`,
  ])("odrzuca %j - zanim cokolwiek dotknie bazy", (manageToken) => {
    expect(() => validator.validate({ manageToken })).toThrow();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("odrzuca brak klucza i pola z innym typem", () => {
    expect(() => validator.validate({})).toThrow();
    expect(() => validator.validate({ manageToken: 123 })).toThrow();
  });
});

describe("bramka przed kluczem serwisowym", () => {
  it("klient jest ANONIMOWY i niesie hosta wołającego", async () => {
    await run({ registration_id: LEAD });
    expect(createClient).toHaveBeenCalledWith(
      "https://przyklad.supabase.co",
      "klucz-publiczny",
      expect.objectContaining({ global: { fetch: tenantFetch } }),
    );
    expect(rpc).toHaveBeenCalledWith("event_registration_notify_payload", {
      p_payload: { manage_token: TOKEN },
    });
  });

  it("odmowa bramki (cudzy najemca albo nieznany klucz) NIE wydaje biletów", async () => {
    const result = await run(null, { message: "not_found: registration does not exist" });
    expect(result).toEqual({ ok: false, error: "not_found: registration does not exist" });
    expect(issueAndSendTicketCodes).not.toHaveBeenCalled();
  });

  it.each([
    ["brak wiersza", null],
    ["tablica zamiast obiektu", [{ registration_id: LEAD }]],
    ["wiersz bez identyfikatora", { email: "a@example.org" }],
    ["pusty identyfikator", { registration_id: "" }],
    ["identyfikator nie-napis", { registration_id: 42 }],
  ])("%s: `not_found` i ani jednego biletu", async (_label, row) => {
    expect(await run(row)).toEqual({ ok: false, error: "not_found" });
    expect(issueAndSendTicketCodes).not.toHaveBeenCalled();
  });

  it("wydaje bilety dla zgłoszenia WSKAZANEGO PRZEZ BAZĘ i oddaje ich liczbę", async () => {
    expect(await run({ registration_id: LEAD, email: "lead@example.org" })).toEqual({
      ok: true,
      sent: 3,
    });
    expect(issueAndSendTicketCodes).toHaveBeenCalledTimes(1);
    expect(issueAndSendTicketCodes).toHaveBeenCalledWith(LEAD);
  });
});
