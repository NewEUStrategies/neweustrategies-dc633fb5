// withCommandIdempotency: pierwszy claim wykonuje run(), duplikat succeeded
// dostaje replay wyniku, in_progress odmawia, failed pozwala spróbować
// ponownie, a błąd run() jest raportowany do complete_command.
import { describe, it, expect, vi } from "vitest";
import {
  CommandInProgressError,
  newIdempotencyKey,
  withCommandIdempotency,
  type RpcClient,
} from "@/lib/http/idempotency";

function clientWithClaim(claim: unknown): { client: RpcClient; rpc: ReturnType<typeof vi.fn> } {
  const rpc = vi.fn(async (fn: string) => {
    if (fn === "claim_command") return { data: claim, error: null };
    return { data: null, error: null };
  });
  return { client: { rpc } as RpcClient, rpc };
}

describe("withCommandIdempotency", () => {
  it("runs the command on a fresh claim and records success", async () => {
    const { client, rpc } = clientWithClaim({ claimed: true, status: "in_progress" });
    const outcome = await withCommandIdempotency(client, {
      key: "k1",
      command: "test.cmd",
      run: async () => ({ ok: true }),
    });
    expect(outcome).toEqual({ replayed: false, result: { ok: true } });
    expect(rpc).toHaveBeenCalledWith("complete_command", {
      p_key: "k1",
      p_succeeded: true,
      p_result: { ok: true },
    });
  });

  it("replays the stored result for a succeeded duplicate without running", async () => {
    const { client } = clientWithClaim({
      claimed: false,
      status: "succeeded",
      result: { ok: true, id: "n1" },
    });
    const run = vi.fn();
    const outcome = await withCommandIdempotency(client, {
      key: "k1",
      command: "test.cmd",
      run: run as unknown as () => Promise<{ ok: boolean; id: string }>,
    });
    expect(outcome.replayed).toBe(true);
    expect(outcome.result).toEqual({ ok: true, id: "n1" });
    expect(run).not.toHaveBeenCalled();
  });

  it("refuses a duplicate that is still in progress", async () => {
    const { client } = clientWithClaim({ claimed: false, status: "in_progress" });
    await expect(
      withCommandIdempotency(client, {
        key: "k1",
        command: "test.cmd",
        run: async () => "never",
      }),
    ).rejects.toBeInstanceOf(CommandInProgressError);
  });

  it("re-runs after a failed previous attempt", async () => {
    const { client } = clientWithClaim({ claimed: false, status: "failed" });
    const outcome = await withCommandIdempotency(client, {
      key: "k1",
      command: "test.cmd",
      run: async () => "second-try",
    });
    expect(outcome).toEqual({ replayed: false, result: "second-try" });
  });

  it("records the failure and rethrows when run() throws", async () => {
    const { client, rpc } = clientWithClaim({ claimed: true, status: "in_progress" });
    await expect(
      withCommandIdempotency(client, {
        key: "k1",
        command: "test.cmd",
        run: async () => {
          throw new Error("boom");
        },
      }),
    ).rejects.toThrow("boom");
    expect(rpc).toHaveBeenCalledWith("complete_command", {
      p_key: "k1",
      p_succeeded: false,
      p_result: { message: "boom" },
    });
  });

  it("newIdempotencyKey scopes the uuid by command", () => {
    const key = newIdempotencyKey("crm.add_note");
    expect(key.startsWith("crm.add_note:")).toBe(true);
    expect(key.length).toBeGreaterThan("crm.add_note:".length + 30);
  });
});
