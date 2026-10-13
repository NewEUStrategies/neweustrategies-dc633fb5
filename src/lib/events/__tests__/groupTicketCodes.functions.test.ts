// Bilety grupy po bezpłatnym zapisie - wysyłka wyzwalana kluczem `manage_token`.
//
// GRANICA NAJEMCY I TOŻSAMOŚCI. Ta funkcja kończy się wydaniem biletów KLUCZEM
// SERWISOWYM (`issueAndSendTicketCodes` omija RLS). Jedyną bramką przed nim jest
// `event_registration_notify_payload_for_tenant` (A1, tylko `service_role`):
// najemca z ZAUFANEGO hosta (argumentem), klucz rozstrzygany jedną regułą
// (`_event_manage_token_resolve`, cel `contact` - wygasły z końcem wydarzenia
// i zamknięty nie wydają biletów, REG-17). Ten plik pilnuje, że:
//   1. bez poprawnego kształtu klucza do bazy nie idzie nic;
//   2. najemca pochodzi z hosta żądania, a host bez najemcy to odmowa BEZ
//      pytania bazy;
//   3. nowa funkcja idzie przez `supabaseAdmin` z najemcą i kluczem, a stara
//      (`event_registration_notify_payload`, klient ANONIMOWY z nagłówkiem
//      hosta) - WYŁĄCZNIE w oknie wdrożenia (PGRST202/42883);
//   4. odmowa bramki (cudzy najemca, nieznany, wygasły klucz) NIE dociera do
//      klucza serwisowego;
//   5. identyfikator do wydania pochodzi WYŁĄCZNIE z wiersza bazy.
//
// Harness `serverFnStubModule` uruchamia PRAWDZIWY walidator i PRAWDZIWY
// handler (z dynamicznym importem `groupTicketCodes.server`).
import { beforeEach, describe, expect, it, vi } from "vitest";

import { callServerFn, validateServerFnInput } from "@/test/serverFnHarness";

const h = vi.hoisted(() => {
  const anonRpc = vi.fn();
  return {
    adminRpc: vi.fn(),
    anonRpc,
    createClient: vi.fn((..._args: unknown[]) => ({ rpc: anonRpc })),
    tenantFetch: vi.fn(),
    issueAndSendTicketCodes: vi.fn(),
    tenant: "tenant-host" as string | null,
    hosts: [] as (string | null)[],
  };
});

vi.mock("@tanstack/react-start", async () =>
  (await import("@/test/serverFnHarness")).serverFnStubModule(),
);
vi.mock("@supabase/supabase-js", () => ({ createClient: h.createClient }));
vi.mock("@/integrations/supabase/tenant-host-fetch", () => ({
  fetchWithTenantHost: h.tenantFetch,
}));
vi.mock("@/integrations/supabase/client.server", () => ({ supabaseAdmin: { rpc: h.adminRpc } }));
vi.mock("@/lib/events/ticketCodeNotify.server", () => ({
  issueAndSendTicketCodes: h.issueAndSendTicketCodes,
}));
vi.mock("@/lib/http/requestHost", () => ({ currentTenantHost: async () => "nes.example" }));
vi.mock("@/lib/server/tenant.server", () => ({
  resolveTenantIdForHost: async (host: string | null) => {
    h.hosts.push(host);
    return h.tenant;
  },
}));

const { sendGroupTicketCodes } = await import("@/lib/events/groupTicketCodes.functions");

type Result = { ok: true; sent: number } | { ok: false; error: string };

/** 32 znaki base64url - dokładnie tyle, ile daje `_event_new_qr_token()`. */
const TOKEN = "abcdefghijklmnopqrstuvwxyz012345";
const LEAD = "11111111-1111-4111-8111-111111111111";
const TENANT = "22222222-2222-4222-8222-222222222222";

function send(manageToken: string = TOKEN): Promise<Result> {
  return callServerFn<Result>(sendGroupTicketCodes, { data: { manageToken }, context: {} });
}

async function run(row: unknown, error: { message: string; code?: string } | null = null) {
  h.adminRpc.mockResolvedValue({ data: row, error });
  return send();
}

beforeEach(() => {
  process.env.SUPABASE_URL = "https://przyklad.supabase.co";
  process.env.SUPABASE_PUBLISHABLE_KEY = "klucz-publiczny";
  h.createClient.mockClear();
  h.adminRpc.mockReset();
  h.anonRpc.mockReset();
  h.issueAndSendTicketCodes.mockReset();
  h.issueAndSendTicketCodes.mockResolvedValue(3);
  h.tenant = TENANT;
  h.hosts = [];
});

describe("walidator klucza prowadzącego", () => {
  const validate = (data: unknown) => validateServerFnInput(sendGroupTicketCodes, data);

  it("przepuszcza dokładnie 32 znaki base64url", () => {
    expect(validate({ manageToken: TOKEN })).toEqual({ manageToken: TOKEN });
  });

  it.each([
    "",
    TOKEN.slice(0, 31),
    `${TOKEN}x`,
    `${TOKEN.slice(0, 31)}+`,
    `${TOKEN.slice(0, 31)}/`,
  ])("odrzuca %j - zanim cokolwiek dotknie bazy", (manageToken) => {
    expect(() => validate({ manageToken })).toThrow();
    expect(h.adminRpc).not.toHaveBeenCalled();
    expect(h.anonRpc).not.toHaveBeenCalled();
  });

  it("odrzuca brak klucza i pola z innym typem", () => {
    expect(() => validate({})).toThrow();
    expect(() => validate({ manageToken: 123 })).toThrow();
  });
});

describe("REG-17: bramka przed kluczem serwisowym - najemca z hosta, jedna reguła klucza", () => {
  it("woła `event_registration_notify_payload_for_tenant` przez supabaseAdmin z najemcą z hosta", async () => {
    await run({ registration_id: LEAD });
    expect(h.hosts).toEqual(["nes.example"]);
    expect(h.adminRpc.mock.calls).toEqual([
      [
        "event_registration_notify_payload_for_tenant",
        { _tenant_id: TENANT, p_payload: { manage_token: TOKEN } },
      ],
    ]);
    // Nowa funkcja odpowiedziała - stara nie jest pytana wcale.
    expect(h.createClient).not.toHaveBeenCalled();
    expect(h.anonRpc).not.toHaveBeenCalled();
  });

  it("host bez najemcy: odmowa bez pytania bazy i bez biletów", async () => {
    h.tenant = null;
    expect(await send()).toEqual({ ok: false, error: "tenant_unresolved" });
    expect(h.adminRpc).not.toHaveBeenCalled();
    expect(h.anonRpc).not.toHaveBeenCalled();
    expect(h.issueAndSendTicketCodes).not.toHaveBeenCalled();
  });

  it.each(["PGRST202", "42883"])(
    "okno wdrożenia (%s): stara funkcja klientem ANONIMOWYM z nagłówkiem hosta",
    async (code) => {
      h.anonRpc.mockResolvedValue({ data: { registration_id: LEAD }, error: null });
      const result = await run(null, { code, message: "function not found" });
      expect(h.anonRpc.mock.calls).toEqual([
        ["event_registration_notify_payload", { p_payload: { manage_token: TOKEN } }],
      ]);
      const [url, key, options] = h.createClient.mock.calls[0] as unknown as [
        string,
        string,
        { global: { fetch: unknown; headers?: unknown } },
      ];
      expect(url).toBe("https://przyklad.supabase.co");
      expect(key).toBe("klucz-publiczny");
      // Bez tego `fetch` najemca rozwiązałby się do domyślnego.
      expect(options.global.fetch).toBe(h.tenantFetch);
      expect(options.global.headers).toBeUndefined();
      expect(result).toEqual({ ok: true, sent: 3 });
      expect(h.issueAndSendTicketCodes).toHaveBeenCalledWith(LEAD);
    },
  );

  it("okno wdrożenia bez konfiguracji klienta: odmowa, bez biletów", async () => {
    delete process.env.SUPABASE_PUBLISHABLE_KEY;
    expect(await run(null, { code: "PGRST202", message: "function not found" })).toEqual({
      ok: false,
      error: "server_misconfigured",
    });
    expect(h.issueAndSendTicketCodes).not.toHaveBeenCalled();
  });

  it.each([
    "manage_expired: this management link expired when the event ended",
    "not_found: registration does not exist",
  ])("odmowa bramki (%s) NIE wydaje biletów i NIE włącza starej funkcji", async (message) => {
    const result = await run(null, { code: "P0001", message });
    expect(result).toEqual({ ok: false, error: message });
    expect(h.anonRpc).not.toHaveBeenCalled();
    expect(h.issueAndSendTicketCodes).not.toHaveBeenCalled();
  });

  it.each([
    ["brak wiersza", null],
    ["tablica zamiast obiektu", [{ registration_id: LEAD }]],
    ["wiersz bez identyfikatora", { email: "a@example.org" }],
    ["pusty identyfikator", { registration_id: "" }],
    ["identyfikator nie-napis", { registration_id: 42 }],
  ])("%s: `not_found` i ani jednego biletu", async (_label, row) => {
    expect(await run(row)).toEqual({ ok: false, error: "not_found" });
    expect(h.issueAndSendTicketCodes).not.toHaveBeenCalled();
  });

  it("wydaje bilety dla zgłoszenia WSKAZANEGO PRZEZ BAZĘ i oddaje ich liczbę", async () => {
    expect(await run({ registration_id: LEAD, email: "lead@example.org" })).toEqual({
      ok: true,
      sent: 3,
    });
    expect(h.issueAndSendTicketCodes).toHaveBeenCalledTimes(1);
    expect(h.issueAndSendTicketCodes).toHaveBeenCalledWith(LEAD);
  });
});
