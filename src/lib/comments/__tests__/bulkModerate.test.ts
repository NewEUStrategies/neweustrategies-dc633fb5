import { describe, expect, it, beforeEach, vi } from "vitest";

// Fluent supabase stub: from("comments").update({status}).in("id", ids).
const { calls } = vi.hoisted(() => ({
  calls: {
    from: [] as string[],
    update: [] as Array<Record<string, unknown>>,
    in: [] as Array<[string, readonly string[]]>,
    error: null as { message: string } | null,
  },
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => {
      calls.from.push(table);
      return {
        update: (patch: Record<string, unknown>) => {
          calls.update.push(patch);
          return {
            in: async (col: string, ids: readonly string[]) => {
              calls.in.push([col, ids]);
              return { error: calls.error };
            },
          };
        },
      };
    },
  },
}));

import { bulkModerateComments } from "@/lib/comments/api";

beforeEach(() => {
  calls.from = [];
  calls.update = [];
  calls.in = [];
  calls.error = null;
});

describe("bulkModerateComments", () => {
  it("no-ops on an empty id list (no query, count 0)", async () => {
    expect(await bulkModerateComments([], "approved")).toBe(0);
    expect(calls.from).toEqual([]);
  });

  it("updates the deduped ids in a single .in() call and returns the count", async () => {
    const n = await bulkModerateComments(["a", "b", "a", "c"], "spam");
    expect(n).toBe(3);
    expect(calls.from).toEqual(["comments"]);
    expect(calls.update).toEqual([{ status: "spam" }]);
    expect(calls.in).toEqual([["id", ["a", "b", "c"]]]);
  });

  it("propagates a supabase error", async () => {
    calls.error = { message: "rls denied" };
    await expect(bulkModerateComments(["a"], "deleted")).rejects.toEqual({ message: "rls denied" });
  });
});
