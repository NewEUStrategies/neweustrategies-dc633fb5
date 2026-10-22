// tableChannelHub: jeden websocketowy kanał per specyfikacja (schema, table,
// event, filter) niezależnie od liczby subskrybentów; ostatni unsubscribe
// zamyka kanał.
import { describe, it, expect, vi, beforeEach } from "vitest";

interface FakeChannel {
  on: ReturnType<typeof vi.fn>;
  subscribe: ReturnType<typeof vi.fn>;
  handler: ((payload: unknown) => void) | null;
  /** Wywołanie zwrotne stanu z `.subscribe(status)` (I9, Z-S7-05). */
  status: ((status: string) => void) | null;
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
        status: null,
        on: vi.fn((_type: string, _spec: unknown, cb: (payload: unknown) => void) => {
          fake.handler = cb;
          return fake;
        }),
        subscribe: vi.fn((cb?: (status: string) => void) => {
          fake.status = cb ?? null;
          return fake;
        }),
      };
      channels.push(fake);
      return fake;
    }),
    removeChannel,
  },
}));

import {
  activeChannelCount,
  subscribeToChannelStatus,
  subscribeToTable,
  tableChannelsInterrupted,
} from "@/lib/realtime/tableChannelHub";

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

describe("tableChannelHub - stan kanału (I9, Z-S7-05)", () => {
  beforeEach(() => {
    channels.length = 0;
    removeChannel.mockClear();
  });

  it("awaria kanału tabeli powiadamia słuchaczy i znika po ponownym połączeniu", () => {
    const notified = vi.fn();
    const stop = subscribeToChannelStatus(notified);
    const off = subscribeToTable({ table: "domain_events", event: "INSERT" }, () => undefined);

    // Łączenie (brak stanu) to nie awaria.
    expect(tableChannelsInterrupted("domain_events")).toBe(false);
    channels[0].status?.("CHANNEL_ERROR");
    expect(tableChannelsInterrupted("domain_events")).toBe(true);
    expect(tableChannelsInterrupted("notifications")).toBe(false);
    expect(notified).toHaveBeenCalledTimes(1);

    channels[0].status?.("SUBSCRIBED");
    expect(tableChannelsInterrupted("domain_events")).toBe(false);

    channels[0].status?.("TIMED_OUT");
    off();
    // Zamknięty przez nas kanał - ani awaria, ani spóźniony stan po `removeChannel`.
    expect(tableChannelsInterrupted("domain_events")).toBe(false);
    channels[0].status?.("CLOSED");
    expect(tableChannelsInterrupted("domain_events")).toBe(false);
    stop();
  });

  it("nieznany stan biblioteki jest ignorowany", () => {
    const off = subscribeToTable({ table: "domain_events", event: "INSERT" }, () => undefined);
    channels[0].status?.("SOMETHING_NEW");
    expect(tableChannelsInterrupted("domain_events")).toBe(false);
    off();
  });
});
