import { describe, expect, it, vi, beforeEach } from "vitest";

const adminUpdate = vi.fn();
vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    from: () => ({
      update: (patch: unknown) => {
        adminUpdate(patch);
        const chain = {
          eq: () => chain,
          is: () => chain,
          in: () => chain,
          select: () => Promise.resolve({ data: [{ id: "o1" }], error: null }),
        };
        return chain;
      },
    }),
  },
}));

import { markOrderSession } from "@/lib/billing/markOrderSession.server";

type RpcResult = { data: unknown; error: { message: string } | null };
const client = (result: RpcResult) => ({ rpc: vi.fn(async () => result) });

describe("markOrderSession", () => {
  beforeEach(() => {
    adminUpdate.mockClear();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("ufa RPC gdy zwróci true - bez roli serwisowej", async () => {
    const supabase = client({ data: true, error: null });
    const ok = await markOrderSession(supabase, {
      orderId: "o1",
      sessionId: "cs_1",
      status: "processing",
    });
    expect(ok).toBe(true);
    expect(adminUpdate).not.toHaveBeenCalled();
  });

  it("domyka zapis rolą serwisową gdy RPC zwróci false", async () => {
    const supabase = client({ data: false, error: null });
    const ok = await markOrderSession(supabase, {
      orderId: "o1",
      sessionId: "cs_1",
      status: "processing",
    });
    expect(ok).toBe(true);
    expect(adminUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ status: "processing", provider_session_id: "cs_1" }),
    );
  });

  it("błąd RPC też uruchamia fallback, a brak sesji nie nadpisuje kolumny", async () => {
    const supabase = client({ data: null, error: { message: "not found" } });
    await markOrderSession(supabase, { orderId: "o1", sessionId: null, status: "failed" });
    const patch = adminUpdate.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(patch["status"]).toBe("failed");
    expect(patch).not.toHaveProperty("provider_session_id");
  });
});
