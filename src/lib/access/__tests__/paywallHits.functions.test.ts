// Uderzenie GOŚCIA w paywall (`recordPaywallHitVisitor`): tożsamość wyłącznie
// z podpisanego cookie licznika (skrót HMAC, nigdy surowy identyfikator),
// najemca z hosta, bez wystawiania nowego cookie, literał RPC tylko dla
// `service_role`, walidacja ładunku.
//
// Moduł serwerowy licznika (`meteringVisitor.server.ts`) NIE jest atrapą:
// skrót liczy wspólny `meteringVisitorDigest`, więc test dowodzi, że handler
// czyta to samo podpisane cookie i ten sam sekret co limit gościa.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { hmac } from "@noble/hashes/hmac.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";
import { resetServerFnContext, serverFnMeta, setServerFnContext } from "@/test/serverFn";
import { signVisitorToken } from "@/lib/access/visitorToken";

const VISITOR = "6f9619ff-8b86-4d01-b42d-00cf4fc964ff";
const ENTITY = "00000000-0000-4000-8000-0000000000aa";
const SECRET = "s".repeat(48);

const h = vi.hoisted(() => ({
  rpc: vi.fn(),
  setCookie: vi.fn(),
  cookie: undefined as string | undefined,
  tenant: "tenant-1" as string | null,
}));

vi.mock("@tanstack/react-start", async () =>
  (await import("@/test/serverFn")).serverFnModuleMock(),
);
vi.mock("@tanstack/react-start/server", () => ({
  getCookie: (name: string) => (name === "nes_mvid" ? h.cookie : undefined),
  setCookie: (...args: unknown[]) => h.setCookie(...args),
  getRequest: () => new Request("https://example.test/analiza"),
}));
vi.mock("@/lib/billing/couponRpc.server", () => ({
  requestProbeIdentity: async () => ({ tenantId: h.tenant, probeSubject: "ip:abc" }),
}));
vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: { rpc: (name: string, args: unknown) => h.rpc(name, args) },
}));

import { recordPaywallHitVisitor } from "@/lib/access/paywallHits.functions";

const env = process.env;
const cookieFor = (visitorId: string, secret = SECRET) =>
  signVisitorToken(secret, visitorId, Math.floor(Date.now() / 1000));

const HIT = {
  entityType: "post",
  entityId: ENTITY,
  reason: "paid",
  requiredTierKey: null,
  variant: "default",
};

beforeEach(() => {
  process.env = { ...env, SESSION_SECRET: SECRET };
  h.rpc.mockReset().mockResolvedValue({ data: null, error: null });
  h.setCookie.mockReset();
  h.cookie = cookieFor(VISITOR);
  h.tenant = "tenant-1";
  setServerFnContext({ supabase: null });
});
afterEach(() => {
  process.env = env;
  resetServerFnContext();
});

describe("recordPaywallHitVisitor", () => {
  it("POST z walidatorem; bez middleware sesji (gość)", () => {
    expect(serverFnMeta(recordPaywallHitVisitor)?.method).toBe("POST");
    expect(serverFnMeta(recordPaywallHitVisitor)?.hasValidator).toBe(true);
  });

  it("skrót HMAC identyfikatora i najemca z hosta - nigdy surowy identyfikator", async () => {
    await expect(recordPaywallHitVisitor({ data: HIT })).resolves.toBe(true);
    // Odczyt bez wystawiania cookie.
    expect(h.setCookie).not.toHaveBeenCalled();
    const [name, args] = h.rpc.mock.calls[0] as [string, Record<string, unknown>];
    expect(name).toBe("record_paywall_hit_visitor");
    expect(args).toMatchObject({
      p_tenant: "tenant-1",
      p_entity_type: "post",
      p_entity_id: ENTITY,
      p_reason: "paid",
      p_required_tier_key: null,
      p_variant: "default",
    });
    expect(args.p_visitor_hash).toBe(
      bytesToHex(hmac(sha256, utf8ToBytes(SECRET), utf8ToBytes(`paywall_hit:${VISITOR}`))),
    );
    expect(JSON.stringify(args)).not.toContain(VISITOR);
  });

  it("ten sam gość = ten sam skrót (liczenie unikalnych), inny gość - inny", async () => {
    await recordPaywallHitVisitor({ data: HIT });
    await recordPaywallHitVisitor({ data: HIT });
    h.cookie = cookieFor("7f9619ff-8b86-4d01-b42d-00cf4fc964ff");
    await recordPaywallHitVisitor({ data: HIT });
    const hashes = h.rpc.mock.calls.map(
      (call) => (call[1] as Record<string, unknown>).p_visitor_hash,
    );
    expect(hashes[0]).toBe(hashes[1]);
    expect(hashes[2]).not.toBe(hashes[0]);
  });

  it("bez cookie, z podrobionym cookie, bez sekretu albo bez najemcy - nic nie zapisuje", async () => {
    h.cookie = undefined;
    await expect(recordPaywallHitVisitor({ data: HIT })).resolves.toBe(false);
    // Podpis innym sekretem i goły uuid - odrzucone przez wspólną weryfikację.
    h.cookie = cookieFor(VISITOR, "x".repeat(48));
    await expect(recordPaywallHitVisitor({ data: HIT })).resolves.toBe(false);
    h.cookie = VISITOR;
    await expect(recordPaywallHitVisitor({ data: HIT })).resolves.toBe(false);
    h.cookie = cookieFor(VISITOR);
    process.env = { ...env, SESSION_SECRET: "", SUPABASE_SERVICE_ROLE_KEY: "" };
    await expect(recordPaywallHitVisitor({ data: HIT })).resolves.toBe(false);
    process.env = { ...env, SESSION_SECRET: SECRET };
    h.tenant = null;
    await expect(recordPaywallHitVisitor({ data: HIT })).resolves.toBe(false);
    expect(h.rpc).not.toHaveBeenCalled();
    // Pomiar nigdy nie zakłada identyfikatora przeglądarki.
    expect(h.setCookie).not.toHaveBeenCalled();
  });

  it("błąd bazy to `false`, nie wyjątek", async () => {
    h.rpc.mockResolvedValue({ data: null, error: { message: "denied", code: "42501" } });
    await expect(recordPaywallHitVisitor({ data: HIT })).resolves.toBe(false);
  });

  it("walidator odrzuca obce byty, powody, warianty i identyfikatory", async () => {
    for (const bad of [
      { ...HIT, entityType: "event" },
      { ...HIT, reason: "other" },
      { ...HIT, variant: "Zły wariant" },
      { ...HIT, entityId: "post-1" },
      { ...HIT, requiredTierKey: "x".repeat(65) },
    ]) {
      await expect(recordPaywallHitVisitor({ data: bad as typeof HIT })).rejects.toThrow();
    }
    expect(h.rpc).not.toHaveBeenCalled();
  });
});
