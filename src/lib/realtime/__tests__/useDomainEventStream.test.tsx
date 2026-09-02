// Strumień zdarzeń domenowych - wejście do CAŁEJ warstwy spójności. Plik miał
// 0 pokrytych linii, a odpowiada za trzy rzeczy, których błędy są niewidoczne
// z poziomu ekranu:
//
//   1. FILTR SERWEROWY (`aggregate_type=eq.<typ>`) - jego brak w specyfikacji
//      kanału oznacza, że każda karta dostaje CAŁY strumień tenanta i dopiero
//      u siebie go odsiewa (koszt websocketu i baterii, nie funkcji);
//   2. DOPRECYZOWANIE KLIENCKIE po `aggregate_id` - postgres_changes filtruje
//      po jednej kolumnie, więc zawężenie do encji musi zrobić klient; jego
//      brak wpuszcza cudze zdarzenia do handlera pojedynczego ekranu;
//   3. STRAŻNIK KSZTAŁTU WIERSZA (`isDomainEventRow`) - zdeformowany wiersz
//      przepuszczony dalej wywraca konsumenta wewnątrz callbacku websocketu,
//      czyli w miejscu, gdzie nie ma żadnego error boundary.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import type { FakeChannel, RealtimeStub } from "@/test/supabase";

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
      rpc: async () => ({ data: [], error: null }),
    },
  };
});

import { subscribeToDomainEvents, useDomainEventStream } from "@/lib/realtime/useDomainEventStream";
import { activeChannelCount } from "@/lib/realtime/tableChannelHub";
import { awaitDomainEvent, pendingCorrelationCount } from "@/lib/realtime/correlation";
import type { DomainEventRow } from "@/lib/realtime/domainEvents";

const rt = () => stubs.realtime as RealtimeStub;

const LEAD_ID = "33333333-3333-4333-a333-333333333333";
const OTHER_LEAD_ID = "66666666-6666-4666-a666-666666666666";

function hubPrefix(aggregateType?: string): string {
  const filter = aggregateType ? `aggregate_type=eq.${aggregateType}` : "";
  return `hub:public|domain_events|INSERT|${filter}:`;
}

function liveChannel(aggregateType?: string): FakeChannel {
  const found = rt().liveChannels(hubPrefix(aggregateType));
  expect(found).toHaveLength(1);
  return found[0];
}

function domainEvent(overrides: Partial<DomainEventRow> = {}): DomainEventRow {
  return {
    id: "55555555-5555-4555-a555-555555555555",
    tenant_id: "22222222-2222-4222-a222-222222222222",
    aggregate_type: "crm_lead",
    aggregate_id: LEAD_ID,
    event_type: "crm_lead.updated.v1",
    payload: {},
    correlation_id: null,
    actor_id: null,
    created_at: "2026-09-01T10:00:00.000Z",
    ...overrides,
  };
}

/** Wpuszcza DOWOLNY ładunek do kanału - także zdeformowany wiersz. */
function emitRaw(aggregateType: string | undefined, row: unknown): void {
  act(() => {
    liveChannel(aggregateType).emitPostgres("domain_events", { eventType: "INSERT", new: row });
  });
}

beforeEach(() => {
  rt().reset();
});

afterEach(() => {
  // Hub i tracker korelacji trzymają stan w MODULE - niedomknięta subskrypcja
  // albo wiszący waiter zafałszowałyby następny test w tym pliku.
  expect(activeChannelCount()).toBe(0);
  expect(pendingCorrelationCount()).toBe(0);
});

describe("useDomainEventStream - specyfikacja kanału", () => {
  it("wkłada filtr po agregacie do specyfikacji SERWEROWEJ", () => {
    const { unmount } = renderHook(() =>
      useDomainEventStream({ aggregateType: "crm_lead", onEvent: () => undefined }),
    );

    expect(liveChannel("crm_lead").listeners[0].filter).toEqual({
      event: "INSERT",
      schema: "public",
      table: "domain_events",
      filter: "aggregate_type=eq.crm_lead",
    });

    unmount();
  });

  it("bez agregatu NIE dokłada klucza `filter` do specyfikacji", () => {
    // Pusty string zamiast braku klucza dałby PostgREST-owi filtr bez sensu,
    // a supabase-js odrzuciłby subskrypcję - cisza zamiast strumienia.
    const { unmount } = renderHook(() => useDomainEventStream({ onEvent: () => undefined }));

    const spec = liveChannel().listeners[0].filter;
    expect(spec).toEqual({ event: "INSERT", schema: "public", table: "domain_events" });
    expect("filter" in spec).toBe(false);

    unmount();
  });

  it("słucha WYŁĄCZNIE INSERT-ów - szyna zdarzeń jest append-only", () => {
    const { unmount } = renderHook(() =>
      useDomainEventStream({ aggregateType: "post", onEvent: () => undefined }),
    );
    expect(liveChannel("post").listeners[0].filter.event).toBe("INSERT");
    expect(liveChannel("post").listeners[0].type).toBe("postgres_changes");
    unmount();
  });

  it("enabled:false nie tworzy kanału", () => {
    const onEvent = vi.fn();
    const { unmount } = renderHook(() =>
      useDomainEventStream({ aggregateType: "crm_lead", enabled: false, onEvent }),
    );
    expect(rt().channels).toEqual([]);
    expect(activeChannelCount()).toBe(0);
    unmount();
  });

  it("dwa ekrany z tym samym agregatem dzielą JEDEN kanał", () => {
    const first = vi.fn();
    const second = vi.fn();
    const a = renderHook(() => useDomainEventStream({ aggregateType: "crm_lead", onEvent: first }));
    const b = renderHook(() =>
      useDomainEventStream({ aggregateType: "crm_lead", onEvent: second }),
    );

    expect(rt().liveChannels("hub:")).toHaveLength(1);
    expect(activeChannelCount()).toBe(1);

    emitRaw("crm_lead", domainEvent());
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);

    a.unmount();
    // Pierwszy odbiorca odchodzi, kanał zostaje dla drugiego.
    expect(rt().liveChannels("hub:")).toHaveLength(1);
    emitRaw("crm_lead", domainEvent());
    expect(second).toHaveBeenCalledTimes(2);
    expect(first).toHaveBeenCalledTimes(1);

    b.unmount();
    expect(rt().liveChannels("hub:")).toEqual([]);
  });
});

describe("useDomainEventStream - doprecyzowanie po encji", () => {
  it("zdarzenie INNEJ encji nie dociera do handlera", () => {
    // Filtr serwerowy zna tylko `aggregate_type`. Bez zawężenia po stronie
    // klienta karta jednego leada odświeżałaby się na każdą zmianę każdego
    // leada tenanta - i pokazywałaby cudze zdarzenia w panelu aktywności.
    const onEvent = vi.fn();
    const { unmount } = renderHook(() =>
      useDomainEventStream({ aggregateType: "crm_lead", aggregateId: LEAD_ID, onEvent }),
    );

    emitRaw("crm_lead", domainEvent({ aggregate_id: OTHER_LEAD_ID }));
    expect(onEvent).not.toHaveBeenCalled();

    emitRaw("crm_lead", domainEvent({ aggregate_id: LEAD_ID }));
    expect(onEvent).toHaveBeenCalledTimes(1);
    expect(onEvent.mock.calls[0][0]).toMatchObject({ aggregate_id: LEAD_ID });

    unmount();
  });

  it("bez `aggregateId` przechodzą zdarzenia wszystkich encji agregatu", () => {
    const onEvent = vi.fn();
    const { unmount } = renderHook(() =>
      useDomainEventStream({ aggregateType: "crm_lead", onEvent }),
    );

    emitRaw("crm_lead", domainEvent({ aggregate_id: OTHER_LEAD_ID }));
    emitRaw("crm_lead", domainEvent({ aggregate_id: LEAD_ID }));
    expect(onEvent).toHaveBeenCalledTimes(2);

    unmount();
  });

  it("zmiana referencji `onEvent` NIE przepina websocketu", () => {
    // Handler zwykle powstaje w ciele komponentu, więc ma nową tożsamość co
    // render. Gdyby wpadał do zależności efektu, każdy render zrywałby kanał.
    const first = vi.fn();
    const second = vi.fn();
    const holder = { onEvent: first };
    const { rerender, unmount } = renderHook(() =>
      useDomainEventStream({ aggregateType: "post", onEvent: holder.onEvent }),
    );
    const before = liveChannel("post");

    holder.onEvent = second;
    act(() => rerender());

    expect(liveChannel("post")).toBe(before);
    expect(before.subscribeCount).toBe(1);

    emitRaw("post", domainEvent({ aggregate_type: "post", event_type: "post.published.v1" }));
    expect(second).toHaveBeenCalledTimes(1);
    expect(first).not.toHaveBeenCalled();

    unmount();
  });
});

describe("isDomainEventRow - strażnik kształtu wiersza", () => {
  const malformed: Array<[string, unknown]> = [
    ["null zamiast wiersza", null],
    ["wartość skalarna", 42],
    ["pusty string", ""],
    ["tablica", []],
    ["brak event_type", { aggregate_type: "crm_lead", aggregate_id: LEAD_ID }],
    ["brak aggregate_type", { event_type: "crm_lead.updated.v1", aggregate_id: LEAD_ID }],
    ["brak aggregate_id", { event_type: "crm_lead.updated.v1", aggregate_type: "crm_lead" }],
    [
      "aggregate_type nie jest stringiem",
      { event_type: "crm_lead.updated.v1", aggregate_type: 7, aggregate_id: LEAD_ID },
    ],
    [
      "event_type jest nullem",
      { event_type: null, aggregate_type: "crm_lead", aggregate_id: LEAD_ID },
    ],
    [
      "aggregate_id jest liczbą",
      { event_type: "crm_lead.updated.v1", aggregate_type: "crm_lead", aggregate_id: 12 },
    ],
  ];

  it.each(malformed)("odrzuca zdeformowany wiersz: %s", (_label, row) => {
    // Konsumenci czytają `event.event_type` i `event.payload` bez własnych
    // sprawdzeń. Przepuszczony śmieć wywala się w callbacku websocketu, poza
    // zasięgiem jakiegokolwiek error boundary - a UI zostaje bez realtime do
    // przeładowania strony.
    const onEvent = vi.fn();
    const { unmount } = renderHook(() =>
      useDomainEventStream({ aggregateType: "crm_lead", onEvent }),
    );

    emitRaw("crm_lead", row);
    expect(onEvent).not.toHaveBeenCalled();

    unmount();
  });

  it("poprawny wiersz przechodzi w całości, bez przycinania pól", () => {
    const onEvent = vi.fn();
    const { unmount } = renderHook(() =>
      useDomainEventStream({ aggregateType: "crm_lead", onEvent }),
    );
    const event = domainEvent({ payload: { lead_id: LEAD_ID }, actor_id: null });

    emitRaw("crm_lead", event);
    expect(onEvent).toHaveBeenCalledWith(event);

    unmount();
  });
});

describe("zasilanie trackera korelacji", () => {
  it("zdarzenie ze strumienia POTWIERDZA oczekującą korelację", async () => {
    // Optymistyczne mutacje czekają na potwierdzenie przez `awaitDomainEvent`.
    // Gdyby strumień nie zasilał trackera, KAŻDA taka mutacja kończyłaby się
    // rollbackiem po timeoucie - mimo że zapis się powiódł.
    const { unmount } = renderHook(() =>
      useDomainEventStream({ aggregateType: "crm_lead", onEvent: () => undefined }),
    );
    const correlationId = "77777777-7777-4777-a777-777777777777";
    const confirmed = awaitDomainEvent(correlationId, { timeoutMs: 5000 });
    expect(pendingCorrelationCount()).toBe(1);

    const event = domainEvent({ correlation_id: correlationId });
    emitRaw("crm_lead", event);

    await expect(confirmed).resolves.toEqual(event);
    expect(pendingCorrelationCount()).toBe(0);

    unmount();
  });

  it("zdeformowany wiersz NIE zasila trackera", async () => {
    // Strażnik kształtu stoi PRZED trackerem. Gdyby było odwrotnie, śmieciowa
    // ramka mogłaby potwierdzić mutację, która nigdy nie doszła do bazy.
    const { unmount } = renderHook(() =>
      useDomainEventStream({ aggregateType: "crm_lead", onEvent: () => undefined }),
    );
    const correlationId = "88888888-8888-4888-a888-888888888888";
    const confirmed = awaitDomainEvent(correlationId, { timeoutMs: 5000 });

    emitRaw("crm_lead", { aggregate_type: "crm_lead", correlation_id: correlationId });
    expect(pendingCorrelationCount()).toBe(1);

    // Sprzątamy waitera poprawnym zdarzeniem, żeby nie został wiszący timer.
    const event = domainEvent({ correlation_id: correlationId });
    emitRaw("crm_lead", event);
    await expect(confirmed).resolves.toEqual(event);

    unmount();
  });

  it("zdarzenie doprecyzowane po encji zasila tracker NIEZALEŻNIE od filtra klienckiego", async () => {
    // Filtr kliencki tnie tylko callback konsumenta. Tracker musi widzieć całą
    // ramkę - inaczej ekran zawężony do jednej encji przestawałby potwierdzać
    // mutacje wykonane na innej.
    const onEvent = vi.fn();
    const { unmount } = renderHook(() =>
      useDomainEventStream({ aggregateType: "crm_lead", aggregateId: LEAD_ID, onEvent }),
    );
    const correlationId = "99999999-9999-4999-a999-999999999999";
    const confirmed = awaitDomainEvent(correlationId, { timeoutMs: 5000 });

    const event = domainEvent({ aggregate_id: OTHER_LEAD_ID, correlation_id: correlationId });
    emitRaw("crm_lead", event);

    await expect(confirmed).resolves.toEqual(event);
    expect(onEvent).not.toHaveBeenCalled();

    unmount();
  });
});

describe("subscribeToDomainEvents - wariant nie-hookowy", () => {
  it("zwraca unsubscribe zwalniający kanał", () => {
    const onEvent = vi.fn();
    const unsubscribe = subscribeToDomainEvents("club_thread", onEvent);

    const channel = liveChannel("club_thread");
    act(() => {
      channel.emitPostgres("domain_events", {
        eventType: "INSERT",
        new: domainEvent({ aggregate_type: "club_thread", event_type: "club_thread.created.v1" }),
      });
    });
    expect(onEvent).toHaveBeenCalledTimes(1);

    unsubscribe();
    expect(channel.removed).toBe(true);
    expect(activeChannelCount()).toBe(0);
  });

  it("bez agregatu subskrybuje CAŁĄ szynę", () => {
    const onEvent = vi.fn();
    const unsubscribe = subscribeToDomainEvents(undefined, onEvent);

    const spec = liveChannel().listeners[0].filter;
    expect("filter" in spec).toBe(false);

    unsubscribe();
  });
});
