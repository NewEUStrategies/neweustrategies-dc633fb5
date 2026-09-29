import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { supabaseRpcStub } from "@/test/supabase/rpc";
import { runEventTicketLifecycle } from "@/lib/events/jobs/ticketLifecycleJob.server";

const h = vi.hoisted(() => ({ refund: vi.fn() }));
vi.mock("@/lib/billing/refundProvider.server", () => ({ refundTransactionFully: h.refund }));
const job = {
  id: "job-1",
  claim_token: "lease-1",
  order_id: "order-1",
  tenant_id: "tenant-1",
  environment: "sandbox",
  provider: "stripe",
  transaction_id: "pi_test_payment",
  order_status: "paid",
};
let stub: ReturnType<typeof supabaseRpcStub>;
const client = () => ({ rpc: stub.rpc }) as unknown as SupabaseClient<Database>;
const run = () => runEventTicketLifecycle(client(), { deadlineAt: Date.now() + 6_000, limit: 5 });

beforeEach(() => {
  stub = supabaseRpcStub();
  stub.setData("_event_registration_refunds_claim", [job]);
  stub.setData("_event_registration_refunds_settle", true);
  h.refund.mockReset().mockResolvedValue({ ok: true, adjustmentId: "re_test_refund" });
});
afterEach(() => vi.useRealTimers());

describe("registration rejection refund worker", () => {
  it("uses the order's environment, stable order idempotency and the exact lease", async () => {
    expect(await run()).toEqual({
      claimed: 1,
      sent: 1,
      skipped: 0,
      failed: 0,
      note: "registration_refunds",
    });
    expect(h.refund).toHaveBeenCalledWith(
      "sandbox",
      "pi_test_payment",
      "registration_rejected",
      "event-rejection:order-1",
    );
    expect(stub.lastCall("_event_registration_refunds_settle")?.args).toEqual({
      p_job_id: "job-1",
      p_claim_token: "lease-1",
      p_refund_id: "re_test_refund",
      p_error: null,
    });
    stub.setData("_event_registration_refunds_claim", [{ ...job, claim_token: "lease-retry" }]);
    await run();
    expect(h.refund.mock.calls[1]).toEqual(h.refund.mock.calls[0]);
    expect(stub.lastCall("_event_registration_refunds_settle")?.arg("p_claim_token")).toBe(
      "lease-retry",
    );
  });

  it.each([
    { environment: "unknown" },
    { provider: "mock" },
    { order_status: "pending" },
    { transaction_id: "invalid" },
  ])("does not issue a refund for an invalid order: %j", async (overrides) => {
    stub.setData("_event_registration_refunds_claim", [{ ...job, ...overrides }]);
    expect(await run()).toMatchObject({ sent: 0, failed: 1 });
    expect(h.refund).not.toHaveBeenCalled();
    expect(stub.lastCall("_event_registration_refunds_settle")?.arg("p_error")).toBe(
      "invalid_refund_order",
    );
  });

  it("records provider failure for a database-controlled retry", async () => {
    h.refund.mockResolvedValue({ ok: false, error: "provider_unavailable" });
    expect(await run()).toMatchObject({ sent: 0, failed: 1 });
    expect(stub.lastCall("_event_registration_refunds_settle")?.arg("p_error")).toBe(
      "provider_unavailable",
    );
  });

  it("does not invent a refund id when the provider omits it", async () => {
    h.refund.mockResolvedValue({ ok: true, adjustmentId: null });
    expect(await run()).toMatchObject({ sent: 0, failed: 1 });
  });

  it("surfaces acknowledgement failure so the lease and idempotency recover it", async () => {
    stub.setError("_event_registration_refunds_settle", "unavailable");
    await expect(run()).rejects.toMatchObject({ message: "unavailable" });
    expect(h.refund).toHaveBeenCalledTimes(1);
  });

  it("does not overwrite a completion already recorded by the webhook", async () => {
    stub.setData("_event_registration_refunds_settle", false);
    expect(await run()).toMatchObject({ sent: 0, failed: 0 });
  });

  it("does not claim work after its deadline", async () => {
    expect(await runEventTicketLifecycle(client(), { deadlineAt: Date.now() - 1 })).toMatchObject({
      claimed: 0,
    });
    expect(stub.calls).toHaveLength(0);
    expect(h.refund).not.toHaveBeenCalled();
  });
});
