// Metering gościa po stronie serwera (audyt billingowy SUB-17): do bazy trafia
// WYŁĄCZNIE identyfikator z ważnym podpisem, najemca z hosta i solony skrót
// adresu - nigdy wartość podana przez przeglądarkę. Dowodzimy kontraktu
// warstwy, która stoi między cookie a funkcjami `service_role`:
//   * ważne cookie -> ten sam gość, bez ponownego Set-Cookie;
//   * cookie podrobione / bez podpisu -> NOWY gość (HttpOnly Set-Cookie),
//     a podrobiony uuid nie dochodzi do RPC;
//   * odczyt stanu nie wystawia tożsamości (bez `_visitor_id`, bez cookie);
//   * brak sekretu -> ściana rejestracji bez dotykania bazy;
//   * brak najemcy hosta -> brak werdyktu, bez wołania RPC.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  cookie: undefined as string | undefined,
  setCookie: vi.fn(),
  rpc: vi.fn(),
  tenantId: "a5000000-0000-0000-0000-0000000000aa" as string | null,
}));

vi.mock("@tanstack/react-start/server", () => ({
  getCookie: (name: string) => (name === "nes_mvid" ? h.cookie : undefined),
  setCookie: (...args: unknown[]) => h.setCookie(...args),
  getRequest: () =>
    new Request("https://example.test/analiza", { headers: { "x-forwarded-proto": "https" } }),
}));
vi.mock("@/lib/billing/couponRpc.server", () => ({
  requestProbeIdentity: async () => ({
    tenantId: h.tenantId,
    probeSubject: "ip:0123456789abcdef0123456789abcdef",
  }),
}));
vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: { rpc: (name: string, args: unknown) => h.rpc(name, args) },
}));

import { signVisitorToken } from "@/lib/access/visitorToken";
import {
  consumeVisitorView,
  meteringVisitorSecret,
  visitorQuota,
} from "@/lib/access/meteringVisitor.server";

const SECRET = "k".repeat(64);
const VISITOR = "0b6f1d2e-3c4a-4b5c-8d6e-7f8091a2b3c4";
const ENTITY = "a5000000-0000-0000-0000-000000000101";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const consumeRow = {
  granted: true,
  consumed: true,
  used: 1,
  monthly_limit: 3,
  remaining: 2,
  requires_registration: false,
  show_counter: true,
  content_pl: "<p>Treść</p>",
  content_en: null,
  builder_data: null,
  blocks_data: null,
};

const env = process.env;

beforeEach(() => {
  process.env = { ...env, SESSION_SECRET: SECRET };
  h.cookie = undefined;
  h.tenantId = "a5000000-0000-0000-0000-0000000000aa";
  h.setCookie.mockReset();
  h.rpc.mockReset().mockResolvedValue({ data: [consumeRow], error: null });
});

afterEach(() => {
  process.env = env;
});

describe("meteringVisitorSecret", () => {
  it("bierze pierwszy sekret serwera, który obroni HMAC; krótki pomija", () => {
    expect(meteringVisitorSecret({ SESSION_SECRET: SECRET })).toBe(SECRET);
    expect(
      meteringVisitorSecret({ SESSION_SECRET: "short", SUPABASE_SERVICE_ROLE_KEY: "r".repeat(40) }),
    ).toBe("r".repeat(40));
    expect(meteringVisitorSecret({})).toBeNull();
  });
});

describe("consumeVisitorView", () => {
  it("ważne cookie: ten sam gość dochodzi do RPC, bez ponownego Set-Cookie", async () => {
    h.cookie = signVisitorToken(SECRET, VISITOR, Math.floor(Date.now() / 1000) - 60);
    await expect(consumeVisitorView("post", ENTITY)).resolves.toEqual(consumeRow);
    expect(h.setCookie).not.toHaveBeenCalled();
    expect(h.rpc).toHaveBeenCalledWith("consume_metered_view_visitor", {
      _tenant: "a5000000-0000-0000-0000-0000000000aa",
      _entity_type: "post",
      _entity_id: ENTITY,
      _visitor_id: VISITOR,
      _ip_subject: "ip:0123456789abcdef0123456789abcdef",
    });
  });

  it("niepodpisany uuid w cookie: odrzucony - nowy gość z HttpOnly cookie", async () => {
    h.cookie = VISITOR;
    await consumeVisitorView("post", ENTITY);
    const sent = (h.rpc.mock.calls[0][1] as { _visitor_id: string })._visitor_id;
    expect(sent).not.toBe(VISITOR);
    expect(sent).toMatch(UUID_RE);
    expect(h.setCookie).toHaveBeenCalledTimes(1);
    const [name, token, options] = h.setCookie.mock.calls[0] as [string, string, object];
    expect(name).toBe("nes_mvid");
    expect(token.startsWith(`v1.${sent}.`)).toBe(true);
    expect(options).toMatchObject({ httpOnly: true, secure: true, sameSite: "lax", path: "/" });
  });

  it("token podpisany innym sekretem: odrzucony tak samo", async () => {
    h.cookie = signVisitorToken("x".repeat(64), VISITOR, Math.floor(Date.now() / 1000));
    await consumeVisitorView("page", ENTITY);
    expect((h.rpc.mock.calls[0][1] as { _visitor_id: string })._visitor_id).not.toBe(VISITOR);
    expect(h.setCookie).toHaveBeenCalledTimes(1);
  });

  it("brak sekretu serwera: ściana rejestracji, baza nietknięta, nic nie wystawione", async () => {
    process.env = { ...env, SESSION_SECRET: "", SUPABASE_SERVICE_ROLE_KEY: "" };
    await expect(consumeVisitorView("post", ENTITY)).resolves.toMatchObject({
      granted: false,
      requires_registration: true,
      content_pl: null,
    });
    expect(h.rpc).not.toHaveBeenCalled();
    expect(h.setCookie).not.toHaveBeenCalled();
  });

  it("brak najemcy hosta: brak werdyktu i brak wywołania RPC", async () => {
    h.tenantId = null;
    await expect(consumeVisitorView("post", ENTITY)).resolves.toBeNull();
    expect(h.rpc).not.toHaveBeenCalled();
  });

  it("błąd RPC idzie do wołającego (paywall zostaje zamknięty)", async () => {
    h.rpc.mockResolvedValue({ data: null, error: { message: "permission denied" } });
    await expect(consumeVisitorView("post", ENTITY)).rejects.toThrow("permission denied");
  });
});

describe("visitorQuota", () => {
  it("bez cookie: stan samego adresu, bez wystawiania tożsamości", async () => {
    h.rpc.mockResolvedValue({ data: [{ enabled: true }], error: null });
    await visitorQuota();
    expect(h.setCookie).not.toHaveBeenCalled();
    expect(h.rpc).toHaveBeenCalledWith("metering_state_visitor", {
      _tenant: "a5000000-0000-0000-0000-0000000000aa",
      _ip_subject: "ip:0123456789abcdef0123456789abcdef",
      _visitor_id: undefined,
    });
  });

  it("z ważnym cookie: stan tego gościa", async () => {
    h.cookie = signVisitorToken(SECRET, VISITOR, Math.floor(Date.now() / 1000));
    h.rpc.mockResolvedValue({ data: [{ enabled: true }], error: null });
    await visitorQuota();
    expect((h.rpc.mock.calls[0][1] as { _visitor_id?: string })._visitor_id).toBe(VISITOR);
  });
});
