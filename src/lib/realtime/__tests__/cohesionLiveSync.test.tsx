// Globalny mostek warstwy spójności - trzy linijki, od których zależy, czy
// CAŁA aplikacja odświeża się po zdarzeniach domenowych. Komponent nie ma
// żadnego wyjścia wizualnego (zwraca null), więc jego regresja jest z definicji
// niewidoczna w testach renderujących: usunięcie jednego z dwóch hooków nie
// zmienia ANI JEDNEGO piksela, a badge'e i listy przestają żyć.
//
// Dlatego dowodem zamontowania hooków są KANAŁY na atrapie Realtime i realny
// przepływ zdarzenia do inwalidacji cache - nie sam fakt, że render przeszedł.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "@testing-library/react";
import type { QueryClient, QueryKey } from "@tanstack/react-query";
import { renderWithQueryClient } from "@/test/renderWithQueryClient";
import type { FakeChannel, RealtimeStub } from "@/test/supabase";

const USER_ID = "11111111-1111-4111-a111-111111111111";
const TENANT_ID = "22222222-2222-4222-a222-222222222222";
const POST_ID = "33333333-3333-4333-a333-333333333333";

const h = vi.hoisted(() => ({
  auth: { uid: "11111111-1111-4111-a111-111111111111" as string | null },
}));

const stubs = vi.hoisted(() => ({ realtime: null as unknown }));

vi.mock("@/integrations/supabase/client", async () => {
  const atoms = await import("@/test/supabase");
  const realtime = atoms.realtimeStub();
  stubs.realtime = realtime;
  return {
    supabase: {
      channel: realtime.channel,
      removeChannel: realtime.removeChannel,
      from: () => ({}),
      rpc: async () => ({ data: null, error: null }),
    },
  };
});

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({
    user: h.auth.uid ? { id: h.auth.uid } : null,
    tenantId: TENANT_ID,
  }),
}));

import { CohesionLiveSync } from "@/lib/realtime/cohesionLiveSync";
import { activeChannelCount } from "@/lib/realtime/tableChannelHub";
import type { DomainEventRow } from "@/lib/realtime/domainEvents";

const rt = () => stubs.realtime as RealtimeStub;

const DOMAIN_EVENTS_PREFIX = "hub:public|domain_events|INSERT|:";
const USER_COUNTERS_PREFIX = `hub:public|user_pending_counters|*|user_id=eq.${USER_ID}:`;

function liveChannel(prefix: string): FakeChannel {
  const found = rt().liveChannels(prefix);
  expect(found, `brak żywego kanału o prefiksie ${prefix}`).toHaveLength(1);
  return found[0];
}

function trackInvalidations(queryClient: QueryClient): QueryKey[] {
  const seen: QueryKey[] = [];
  vi.spyOn(queryClient, "invalidateQueries").mockImplementation(async (filters) => {
    seen.push(filters?.queryKey ?? []);
  });
  return seen;
}

function domainEvent(overrides: Partial<DomainEventRow> = {}): DomainEventRow {
  return {
    id: "44444444-4444-4444-a444-444444444444",
    tenant_id: TENANT_ID,
    aggregate_type: "comment",
    aggregate_id: "55555555-5555-4555-a555-555555555555",
    event_type: "comment.created.v1",
    payload: { post_id: POST_ID },
    correlation_id: null,
    actor_id: null,
    created_at: "2026-09-01T10:00:00.000Z",
    ...overrides,
  };
}

beforeEach(() => {
  h.auth.uid = USER_ID;
  rt().reset();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  expect(activeChannelCount()).toBe(0);
});

describe("CohesionLiveSync", () => {
  it("nie renderuje NICZEGO - to mostek, nie widok", () => {
    const { container, unmount } = renderWithQueryClient(<CohesionLiveSync />);
    expect(container).toBeEmptyDOMElement();
    unmount();
  });

  it("montuje OBA hooki: szynę zdarzeń i realtime liczników", () => {
    // Dowód po kanałach, bo tylko one odróżniają „komponent się wyrenderował"
    // od „hook naprawdę zasubskrybował". Usunięcie któregokolwiek wywołania
    // z ciała komponentu nie zmieniłoby DOM-u, ale zabrałoby jeden z tych wpisów.
    const { unmount } = renderWithQueryClient(<CohesionLiveSync />);

    expect(liveChannel(DOMAIN_EVENTS_PREFIX)).toBeDefined();
    expect(liveChannel(USER_COUNTERS_PREFIX)).toBeDefined();
    expect(rt().liveChannels("hub:")).toHaveLength(2);
    expect(activeChannelCount()).toBe(2);

    unmount();
  });

  it("szyna zdarzeń idzie BEZ filtra agregatu, liczniki Z filtrem po użytkowniku", () => {
    // Globalny mostek musi widzieć całą szynę (mapa inwalidacji rozstrzyga, co
    // odświeżyć), a liczniki - wyłącznie własne wiersze; filtr po `user_id`
    // jest tu jedyną rzeczą, która trzyma ruch w ryzach przy tysiącu kart.
    const { unmount } = renderWithQueryClient(<CohesionLiveSync />);

    expect(liveChannel(DOMAIN_EVENTS_PREFIX).listeners[0].filter).toEqual({
      event: "INSERT",
      schema: "public",
      table: "domain_events",
    });
    expect(liveChannel(USER_COUNTERS_PREFIX).listeners[0].filter).toEqual({
      event: "*",
      schema: "public",
      table: "user_pending_counters",
      filter: `user_id=eq.${USER_ID}`,
    });

    unmount();
  });

  it("nie subskrybuje liczników TENANTOWYCH - to kanał panelu staffu, nie mostka globalnego", () => {
    // `usePendingCountersRealtime()` wołane bez opcji zostaje przy liczniku
    // użytkownika. Dołożenie tu kanału tenantowego otwierałoby websocket
    // kolejek moderacji KAŻDEMU zalogowanemu, także bez uprawnień staffu.
    const { unmount } = renderWithQueryClient(<CohesionLiveSync />);

    expect(rt().liveChannels("hub:public|tenant_pending_counters")).toEqual([]);

    unmount();
  });

  it("zdarzenie domenowe realnie unieważnia cache modułu", () => {
    // Kanał to za mało - liczy się to, że ramka przechodzi przez mapę
    // inwalidacji. Ten test pada, gdy mostek subskrybuje, ale nie podpina
    // konsumenta (regresja typu „kanał jest, odświeżania nie ma").
    const { queryClient, unmount } = renderWithQueryClient(<CohesionLiveSync />);
    const seen = trackInvalidations(queryClient);

    act(() => {
      liveChannel(DOMAIN_EVENTS_PREFIX).emitPostgres("domain_events", {
        eventType: "INSERT",
        new: domainEvent(),
      });
    });
    act(() => vi.advanceTimersByTime(250));

    expect(seen).toEqual([
      ["comments", POST_ID],
      ["pending-counters", "tenant"],
    ]);

    unmount();
  });

  it("zmiana licznika użytkownika odświeża jego klucz badge'y", () => {
    const { queryClient, unmount } = renderWithQueryClient(<CohesionLiveSync />);
    const seen = trackInvalidations(queryClient);

    act(() => {
      liveChannel(USER_COUNTERS_PREFIX).emitPostgres("user_pending_counters", {
        eventType: "UPDATE",
        new: { counter_key: "notifications_unread", value: 3 },
      });
    });

    expect(seen).toEqual([["pending-counters", "user", USER_ID]]);

    unmount();
  });

  it("odmontowanie zwalnia OBA kanały", () => {
    // Mostek żyje w root layoucie, więc odmontowuje się przy wylogowaniu.
    // Zostawiony websocket trzymałby subskrypcję na dane poprzedniej sesji.
    const { unmount } = renderWithQueryClient(<CohesionLiveSync />);
    const opened = rt().liveChannels("hub:");
    expect(opened).toHaveLength(2);

    unmount();

    for (const channel of opened) expect(channel.removed).toBe(true);
    expect(rt().liveChannels("hub:")).toEqual([]);
    expect(activeChannelCount()).toBe(0);
  });

  it("dla anonimowego odwiedzającego nie otwiera ŻADNEGO kanału", () => {
    // Ta sama doktryna co siteSettingsLiveSync: anonimowi nie mogą zjadać
    // kwoty połączeń Realtime, a RLS i tak nie dałby im żadnego wiersza.
    h.auth.uid = null;
    const { container, unmount } = renderWithQueryClient(<CohesionLiveSync />);

    expect(container).toBeEmptyDOMElement();
    expect(rt().channels).toEqual([]);
    expect(activeChannelCount()).toBe(0);

    unmount();
  });

  it("dwie instancje mostka dzielą kanały zamiast je mnożyć", () => {
    // Podwójne zamontowanie zdarza się przy StrictMode i przy przejściowym
    // nałożeniu się starego i nowego drzewa trasy. Hub ma to zamortyzować.
    const first = renderWithQueryClient(<CohesionLiveSync />);
    const second = renderWithQueryClient(<CohesionLiveSync />);

    expect(rt().liveChannels("hub:")).toHaveLength(2);
    expect(activeChannelCount()).toBe(2);

    first.unmount();
    expect(rt().liveChannels("hub:")).toHaveLength(2);

    second.unmount();
    expect(activeChannelCount()).toBe(0);
  });
});
