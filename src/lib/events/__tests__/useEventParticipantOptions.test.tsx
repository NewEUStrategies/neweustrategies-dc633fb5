// Hook publicznych flag uczestnika: brama `enabled`, klucz i świeżość.
//
// STAWKA: flagi nie mogą być pobierane „z automatu" (S38 - żadnego nowego
// zapytania przy wejściu na publiczną stronę wydarzenia). Wołający decyduje
// przez `enabled` (otwarte menu kalendarza, zalogowany panel).
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const api = vi.hoisted(() => ({ fetchEventParticipantOptions: vi.fn() }));
vi.mock("@/lib/events/participantOptionsApi", () => api);

import {
  participantOptionsKeys,
  useEventParticipantOptions,
} from "@/lib/events/useEventParticipantOptions";
import { makeEventParticipantOptions } from "@/test/events/participantFixtures";

let client: QueryClient;

function wrapper({ children }: { children: ReactNode }) {
  return createElement(QueryClientProvider, { client }, children);
}

beforeEach(() => {
  vi.clearAllMocks();
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});

describe("useEventParticipantOptions", () => {
  it("literał klucza (kontrakt z eventInvalidationMap)", () => {
    expect(participantOptionsKeys.one("forum-2030")).toEqual([
      "event-participant-options",
      "forum-2030",
    ]);
  });

  it("pobiera flagi, gdy wołający pozwala, i trzyma je minutę", async () => {
    const options = makeEventParticipantOptions();
    api.fetchEventParticipantOptions.mockResolvedValue(options);
    const { result } = renderHook(() => useEventParticipantOptions("forum-2030", true), {
      wrapper,
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(options);
    expect(api.fetchEventParticipantOptions).toHaveBeenCalledWith("forum-2030");
    const query = client
      .getQueryCache()
      .find({ queryKey: participantOptionsKeys.one("forum-2030") });
    expect(query?.observers[0]?.options.staleTime).toBe(60_000);
    expect(result.current.isStale).toBe(false);
  });

  it.each([
    ["enabled=false", "forum-2030", false],
    ["pusty slug", "", true],
  ])("nie pyta bazy (%s)", (_label, slug, enabled) => {
    renderHook(() => useEventParticipantOptions(slug, enabled), { wrapper });
    expect(api.fetchEventParticipantOptions).not.toHaveBeenCalled();
  });
});
