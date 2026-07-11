// tableChannelHub: jeden websocketowy kanał per specyfikacja (schema, table,
// event, filter) niezależnie od liczby subskrybentów; ostatni unsubscribe
// zamyka kanał.
import { describe, it, expect, vi, beforeEach } from "vitest";

interface FakeChannel {
  on: ReturnType<typeof vi.fn>;
  subscribe: ReturnType<typeof vi.fn>;
  handler: ((payload: unknown) => void) | null;
}

// vi.mock jest hoistowany na początek pliku - stan współdzielony z fabryką
// mocka musi powstać przez vi.hoisted.
const { channels, removeChannel } = vi.hoisted(() => ({
  channels: [] as FakeChannel[],
  removeChannel: vi.fn(),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    channel: vi.fn(() => {
      const fake: FakeChannel = {
        handler: null,
        on: vi.fn((_type: string, _spec: unknown, cb: (payload: unknown) => void) => {
          fake.handler = cb;
          return fake;
        }),
        subscribe: vi.fn(() => fake),
      };
      channels.push(fake);
      return fake;
    }),
    removeChannel,
  },
}));

import { activeChannelCount, subscribeToTable } from "@/lib/realtime/tableChannelHub";

describe("tableChannelHub", () => {
  beforeEach(() => {
    channels.length = 0;
    removeChannel.mockClear();
  });

  it("shares one channel between subscribers of the same spec", () => {
    const seen: string[] = [];
    const off1 = subscribeToTable({ table: "domain_events", event: "INSERT" }, () =>
      seen.push("first"),
    );
    const off2 = subscribeToTable({ table: "domain_events", event: "INSERT" }, () =>
      seen.push("second"),
    );

    expect(channels).toHaveLength(1);
    expect(activeChannelCount()).toBe(1);

    channels[0].handler?.({ new: {} });
    expect(seen).toEqual(["first", "second"]);

    off1();
    expect(removeChannel).not.toHaveBeenCalled();
    off2();
    expect(removeChannel).toHaveBeenCalledTimes(1);
    expect(activeChannelCount()).toBe(0);
  });

  it("keeps distinct channels for distinct specs (filter is part of the key)", () => {
    const off1 = subscribeToTable(
      { table: "notifications", filter: "user_id=eq.a" },
      () => undefined,
    );
    const off2 = subscribeToTable(
      { table: "notifications", filter: "user_id=eq.b" },
      () => undefined,
    );
    expect(channels).toHaveLength(2);
    expect(activeChannelCount()).toBe(2);
    off1();
    off2();
    expect(activeChannelCount()).toBe(0);
  });

  it("recreates the channel after full teardown", () => {
    const off1 = subscribeToTable({ table: "cross_references" }, () => undefined);
    off1();
    const off2 = subscribeToTable({ table: "cross_references" }, () => undefined);
    expect(channels).toHaveLength(2);
    expect(activeChannelCount()).toBe(1);
    off2();
  });
});
