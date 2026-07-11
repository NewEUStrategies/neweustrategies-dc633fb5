// Optymistyczna mutacja potwierdzana zdarzeniem: łatka natychmiast w cache,
// potwierdzenie po correlation_id utrwala, brak potwierdzenia w oknie
// czasowym wycofuje łatkę (naprawa "znika po refresh").
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

const rpcMock = vi.fn();

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: (...args: unknown[]) => rpcMock(...args) },
}));

import { feedCorrelationTracker } from "@/lib/realtime/correlation";
import { useEventConfirmedMutation } from "@/lib/realtime/useEventConfirmedMutation";
import type { DomainEventRow } from "@/lib/realtime/domainEvents";

const QUERY_KEY = ["cohesion-test", "list"] as const;

function eventOf(correlationId: string): DomainEventRow {
  return {
    id: "00000000-0000-0000-0000-000000000001",
    tenant_id: "00000000-0000-0000-0000-000000000002",
    aggregate_type: "comment",
    aggregate_id: "00000000-0000-0000-0000-000000000003",
    event_type: "comment.created.v1",
    payload: {},
    correlation_id: correlationId,
    actor_id: null,
    created_at: new Date(0).toISOString(),
  };
}

function setup(confirmTimeoutMs: number, onRolledBack: () => void, onConfirmed: () => void) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  qc.setQueryData<string[]>(QUERY_KEY, ["existing"]);
  const captured: { correlationId: string | null } = { correlationId: null };
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  const hook = renderHook(
    () =>
      useEventConfirmedMutation<{ ok: boolean }, string, string[]>({
        mutationFn: async (_item, ctx) => {
          captured.correlationId = ctx.correlationId;
          return { ok: true };
        },
        queryKey: [...QUERY_KEY],
        optimisticUpdate: (current, item) => [...(current ?? []), item],
        confirmTimeoutMs,
        onRolledBack,
        onConfirmed,
      }),
    { wrapper },
  );
  return { qc, captured, hook };
}

describe("useEventConfirmedMutation", () => {
  beforeEach(() => {
    rpcMock.mockReset();
  });

  it("applies the optimistic patch and keeps it after an event confirms", async () => {
    const onRolledBack = vi.fn();
    const onConfirmed = vi.fn();
    const { qc, captured, hook } = setup(2000, onRolledBack, onConfirmed);

    await act(async () => {
      await hook.result.current.mutateAsync("fresh");
    });
    expect(qc.getQueryData(QUERY_KEY)).toEqual(["existing", "fresh"]);
    expect(captured.correlationId).toBeTruthy();

    act(() => {
      feedCorrelationTracker(eventOf(captured.correlationId ?? ""));
    });
    await waitFor(() => expect(onConfirmed).toHaveBeenCalledTimes(1));
    expect(onRolledBack).not.toHaveBeenCalled();
    expect(qc.getQueryData(QUERY_KEY)).toEqual(["existing", "fresh"]);
  });

  it("rolls the patch back when no confirming event arrives in the window", async () => {
    // Fallback do bazy też nie znajduje śladu -> rollback.
    rpcMock.mockResolvedValue({ data: [], error: null });
    const onRolledBack = vi.fn();
    const onConfirmed = vi.fn();
    const { qc, hook } = setup(30, onRolledBack, onConfirmed);

    await act(async () => {
      await hook.result.current.mutateAsync("ghost");
    });
    expect(qc.getQueryData(QUERY_KEY)).toEqual(["existing", "ghost"]);

    await waitFor(() => expect(onRolledBack).toHaveBeenCalledTimes(1));
    expect(qc.getQueryData(QUERY_KEY)).toEqual(["existing"]);
    expect(onConfirmed).not.toHaveBeenCalled();
  });

  it("rolls back immediately when the mutation itself fails", async () => {
    const onRolledBack = vi.fn();
    const qc = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    qc.setQueryData<string[]>(QUERY_KEY, ["existing"]);
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    );
    const hook = renderHook(
      () =>
        useEventConfirmedMutation<{ ok: boolean }, string, string[]>({
          mutationFn: async () => {
            throw new Error("server said no");
          },
          queryKey: [...QUERY_KEY],
          optimisticUpdate: (current, item) => [...(current ?? []), item],
          onRolledBack,
        }),
      { wrapper },
    );

    await act(async () => {
      await expect(hook.result.current.mutateAsync("nope")).rejects.toThrow("server said no");
    });
    expect(qc.getQueryData(QUERY_KEY)).toEqual(["existing"]);
    expect(onRolledBack).toHaveBeenCalledTimes(1);
  });
});
