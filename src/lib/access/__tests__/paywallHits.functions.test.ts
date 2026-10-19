// Uderzenie GOŚCIA w paywall (`recordPaywallHitVisitor`): tożsamość wyłącznie
// z podpisanego cookie licznika (skrót HMAC, nigdy surowy identyfikator),
// najemca z hosta, bez wystawiania nowego cookie, literał RPC tylko dla
// `service_role`, walidacja ładunku.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetServerFnContext, serverFnMeta, setServerFnContext } from "@/test/serverFn";

const VISITOR = "6f9619ff-8b86-4d01-b42d-00cf4fc964ff";
const ENTITY = "00000000-0000-4000-8000-0000000000aa";

const h = vi.hoisted(() => ({
  rpc: vi.fn(),
  resolve: vi.fn(),
  secret: "s".repeat(48) as string | null,
  tenant: "tenant-1" as string | null,
}));

vi.mock("@tanstack/react-start", async () =>
  (await import("@/test/serverFn")).serverFnModuleMock(),
);
vi.mock("@/lib/access/meteringVisitor.server", () => ({
  meteringVisitorSecret: () => h.secret,
  resolveMeteringVisitor: (mint: boolean) => h.resolve(mint),
}));
vi.mock("@/lib/billing/couponRpc.server", () => ({
  requestProbeIdentity: async () => ({ tenantId: h.tenant, probeSubject: "ip:abc" }),
}));
vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: { rpc: (name: string, args: unknown) => h.rpc(name, args) },
}));

import { recordPaywallHitVisitor } from "@/lib/access/paywallHits.functions";

const HIT = {
  entityType: "post",
  entityId: ENTITY,
  reason: "paid",
  requiredTierKey: null,
  variant: "default",
};

beforeEach(() => {
  h.rpc.mockReset().mockResolvedValue({ data: null, error: null });
  h.resolve.mockReset().mockReturnValue(VISITOR);
  h.secret = "s".repeat(48);
  h.tenant = "tenant-1";
  setServerFnContext({ supabase: null });
});
afterEach(() => resetServerFnContext());

describe("recordPaywallHitVisitor", () => {
  it("POST z walidatorem; bez middleware sesji (gość)", () => {
    expect(serverFnMeta(recordPaywallHitVisitor)?.method).toBe("POST");
    expect(serverFnMeta(recordPaywallHitVisitor)?.hasValidator).toBe(true);
  });

  it("skrót HMAC identyfikatora i najemca z hosta - nigdy surowy identyfikator", async () => {
    await expect(recordPaywallHitVisitor({ data: HIT })).resolves.toBe(true);
    // Odczyt bez wystawiania cookie.
    expect(h.resolve).toHaveBeenCalledWith(false);
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
    expect(args.p_visitor_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(args)).not.toContain(VISITOR);
  });

  it("ten sam gość = ten sam skrót (liczenie unikalnych), inny gość - inny", async () => {
    await recordPaywallHitVisitor({ data: HIT });
    await recordPaywallHitVisitor({ data: HIT });
    h.resolve.mockReturnValue("7f9619ff-8b86-4d01-b42d-00cf4fc964ff");
    await recordPaywallHitVisitor({ data: HIT });
    const hashes = h.rpc.mock.calls.map(
      (call) => (call[1] as Record<string, unknown>).p_visitor_hash,
    );
    expect(hashes[0]).toBe(hashes[1]);
    expect(hashes[2]).not.toBe(hashes[0]);
  });

  it("bez cookie, bez sekretu albo bez najemcy - nic nie zapisuje", async () => {
    h.resolve.mockReturnValue(null);
    await expect(recordPaywallHitVisitor({ data: HIT })).resolves.toBe(false);
    h.resolve.mockReturnValue(VISITOR);
    h.secret = null;
    await expect(recordPaywallHitVisitor({ data: HIT })).resolves.toBe(false);
    h.secret = "s".repeat(48);
    h.tenant = null;
    await expect(recordPaywallHitVisitor({ data: HIT })).resolves.toBe(false);
    expect(h.rpc).not.toHaveBeenCalled();
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
