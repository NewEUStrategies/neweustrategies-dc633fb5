// Prawo do podglądu linku: tylko AKTYWNY członek klubu we własnym najemcy.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ok, fail, supabaseFromStub } from "@/test/supabaseChain";

const h = vi.hoisted(() => ({ tenant: "tenant-1" as string | null, tenantThrows: false }));
const db = supabaseFromStub();

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: { from: (table: string) => db.from(table) },
}));
vi.mock("@/lib/server/userTenant.server", () => ({
  readUserTenantId: async () => {
    if (h.tenantThrows) throw new Error("db down");
    return h.tenant;
  },
}));

import { canRequestClubLinkPreview } from "@/lib/clubs/linkPreviewEligibility.server";

beforeEach(() => {
  db.reset();
  h.tenant = "tenant-1";
  h.tenantThrows = false;
  db.setResponse("club_members", ok([{ id: "m-1" }]));
});

describe("canRequestClubLinkPreview", () => {
  it("aktywny członek klubu w swoim najemcy dostaje podgląd", async () => {
    expect(await canRequestClubLinkPreview("user-1")).toBe(true);
    const chain = db.lastChain("club_members");
    const eqs = (chain?.calls ?? []).filter((c) => c.method === "eq").map((c) => [...c.args]);
    expect(eqs).toEqual([
      ["user_id", "user-1"],
      ["tenant_id", "tenant-1"],
      ["status", "active"],
    ]);
  });

  it("konto bez członkostwa nie dostaje podglądu", async () => {
    db.setResponse("club_members", ok([]));
    expect(await canRequestClubLinkPreview("user-1")).toBe(false);
  });

  it("konto bez najemcy nie pyta o członkostwo", async () => {
    h.tenant = null;
    expect(await canRequestClubLinkPreview("user-1")).toBe(false);
    expect(db.chainsFor("club_members")).toHaveLength(0);
  });

  it("błąd odczytu = odmowa (fail-closed)", async () => {
    db.setResponse("club_members", fail("odmowa"));
    expect(await canRequestClubLinkPreview("user-1")).toBe(false);
    h.tenantThrows = true;
    expect(await canRequestClubLinkPreview("user-1")).toBe(false);
  });
});
