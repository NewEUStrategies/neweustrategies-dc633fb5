// Tracker korelacji: potwierdzenie ze strumienia, filtr typów zdarzeń,
// fallback do bazy na timeout, porządek stosu runWithCorrelation.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const rpcMock = vi.fn();

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: (...args: unknown[]) => rpcMock(...args) },
}));

import {
  awaitDomainEvent,
  CorrelationTimeoutError,
  currentCorrelationId,
  feedCorrelationTracker,
  pendingCorrelationCount,
  runWithCorrelation,
} from "@/lib/realtime/correlation";
import type { DomainEventRow } from "@/lib/realtime/domainEvents";

function eventOf(correlationId: string | null, eventType = "comment.created.v1"): DomainEventRow {
  return {
    id: "00000000-0000-0000-0000-000000000001",
    tenant_id: "00000000-0000-0000-0000-000000000002",
    aggregate_type: "comment",
    aggregate_id: "00000000-0000-0000-0000-000000000003",
    event_type: eventType,
    payload: {},
    correlation_id: correlationId,
    actor_id: null,
    created_at: new Date(0).toISOString(),
  };
}

const CID = "11111111-1111-4111-a111-111111111111";

describe("correlation tracker", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    rpcMock.mockReset();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("resolves a waiter when a matching event is fed from the stream", async () => {
    const promise = awaitDomainEvent(CID, { timeoutMs: 3000 });
    expect(pendingCorrelationCount()).toBe(1);
    feedCorrelationTracker(eventOf(CID));
    await expect(promise).resolves.toMatchObject({ correlation_id: CID });
    expect(pendingCorrelationCount()).toBe(0);
  });

  it("ignores events with other correlation ids and other event types", async () => {
    const promise = awaitDomainEvent(CID, {
      timeoutMs: 3000,
      eventTypes: ["crm_lead.stage_changed.v1"],
    });
    feedCorrelationTracker(eventOf("22222222-2222-4222-a222-222222222222"));
    feedCorrelationTracker(eventOf(CID, "comment.created.v1"));
    expect(pendingCorrelationCount()).toBe(1);
    feedCorrelationTracker(eventOf(CID, "crm_lead.stage_changed.v1"));
    await expect(promise).resolves.toMatchObject({ event_type: "crm_lead.stage_changed.v1" });
  });

  it("falls back to get_correlated_events on timeout before rejecting", async () => {
    rpcMock.mockResolvedValueOnce({ data: [eventOf(CID)], error: null });
    const promise = awaitDomainEvent(CID, { timeoutMs: 100 });
    await vi.advanceTimersByTimeAsync(150);
    await expect(promise).resolves.toMatchObject({ correlation_id: CID });
    expect(rpcMock).toHaveBeenCalledWith("get_correlated_events", { p_correlation_id: CID });
  });

  it("rejects with CorrelationTimeoutError when the database has no trace either", async () => {
    rpcMock.mockResolvedValueOnce({ data: [], error: null });
    const promise = awaitDomainEvent(CID, { timeoutMs: 100 });
    const assertion = expect(promise).rejects.toBeInstanceOf(CorrelationTimeoutError);
    await vi.advanceTimersByTimeAsync(150);
    await assertion;
  });

  it("runWithCorrelation exposes the id only for the duration of fn", async () => {
    expect(currentCorrelationId()).toBeNull();
    await runWithCorrelation(CID, async () => {
      expect(currentCorrelationId()).toBe(CID);
      await runWithCorrelation("33333333-3333-4333-a333-333333333333", async () => {
        expect(currentCorrelationId()).toBe("33333333-3333-4333-a333-333333333333");
      });
      expect(currentCorrelationId()).toBe(CID);
    });
    expect(currentCorrelationId()).toBeNull();
  });
});
