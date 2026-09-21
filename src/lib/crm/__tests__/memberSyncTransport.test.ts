import { createClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import type { Database } from "@/integrations/supabase/types";
import { syncMemberToCrm } from "../memberSync.server";

describe("member CRM RPC transport", () => {
  it.each(["manual_revoke", "backfill"] as const)(
    "preserves required null arguments for %s after type regeneration",
    async (reason) => {
      const request = vi.fn<typeof fetch>().mockResolvedValue(
        new Response(JSON.stringify({ status: "skipped" }), {
          headers: { "Content-Type": "application/json" },
        }),
      );
      const client = createClient<Database>("https://db.example.test", "test-key", {
        global: { fetch: request },
        auth: { persistSession: false, autoRefreshToken: false, storageKey: `crm-${reason}` },
      });
      const result = await syncMemberToCrm(client, {
        userId: "a0000000-0000-0000-0000-00000000c901",
        tenantId: "a1111111-1111-1111-1111-11111111c901",
        tierKey: null,
        actorId: null,
        reason,
      });
      expect(result).toBeNull();
      expect(request).toHaveBeenCalledOnce();
      const [url, init] = request.mock.calls[0];
      expect(String(url)).toContain("/rpc/crm_sync_member");
      expect(JSON.parse(String(init?.body))).toEqual({
        p_user_id: "a0000000-0000-0000-0000-00000000c901",
        p_tenant_id: "a1111111-1111-1111-1111-11111111c901",
        p_tier_key: null,
        p_actor_id: null,
        p_reason: reason,
      });
    },
  );
});
