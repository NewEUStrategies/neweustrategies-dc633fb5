// Współdzielenie i zwalnianie kanałów huba - warstwa, w której WSZYSTKIE błędy
// są odroczone w czasie. Zgubiony `removeChannel` nie psuje żadnego widoku od
// razu: dopiero po kilkunastu przejściach między trasami kończy się limit
// kanałów Realtime i cała aplikacja cicho przestaje dostawać zdarzenia.
//
// Istniejący `tableChannelHub.test.ts` sprawdza wspólny kanał na własnej,
// minimalnej atrapie. Ten plik dokłada to, czego tamten nie mierzy, a co
// decyduje o poprawności w praktyce:
//
//   * OBSERWOWALNY refcount na wspólnej atrapie kanałów (`subscribeCount`,
//     `removed`) - jedna subskrypcja websocketu na specyfikację, nie N;
//   * ODPORNOŚĆ NA PODWÓJNY UNSUBSCRIBE - React w trybie StrictMode i podwójne
//     sprzątanie efektu wołają ten sam zwrot dwa razy;
//   * ŚCIEŻKA SSR - na serwerze nie wolno w ogóle dotknąć klienta Realtime.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RealtimeStub } from "@/test/supabase";

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

import { activeChannelCount, subscribeToTable } from "@/lib/realtime/tableChannelHub";

const rt = () => stubs.realtime as RealtimeStub;

const USER_ID = "11111111-1111-4111-a111-111111111111";

beforeEach(() => {
  rt().reset();
});

afterEach(() => {
  vi.unstubAllGlobals();
  // Refcount huba żyje w STANIE MODUŁU. Test, który zostawi wiszącą
  // subskrypcję, podałby następnemu kanał z poprzedniego przebiegu.
  expect(activeChannelCount()).toBe(0);
});

describe("tableChannelHub - współdzielenie kanału", () => {
  it("dwóch subskrybentów tej samej specyfikacji dostaje JEDEN kanał i JEDNĄ subskrypcję", () => {
    // Kanał na hooka oznaczałby N websocketów na tę samą tabelę: dzwonek, dock
    // i strona to trzy niezależne miejsca czytające te same zmiany.
    const first: string[] = [];
    const second: string[] = [];
    const offFirst = subscribeToTable({ table: "notifications" }, () => first.push("hit"));
    const offSecond = subscribeToTable({ table: "notifications" }, () => second.push("hit"));

    expect(rt().liveChannels("hub:")).toHaveLength(1);
    expect(activeChannelCount()).toBe(1);
    expect(rt().liveChannels("hub:")[0].subscribeCount).toBe(1);

    rt().liveChannels("hub:")[0].emitPostgres("notifications", { eventType: "INSERT", new: {} });
    expect(first).toEqual(["hit"]);
    expect(second).toEqual(["hit"]);

    offFirst();
    offSecond();
  });

  it("odejście pierwszego subskrybenta NIE zabiera kanału drugiemu", () => {
    const survivor: string[] = [];
    const leaving: string[] = [];
    const offLeaving = subscribeToTable({ table: "notifications" }, () => leaving.push("hit"));
    const offSurvivor = subscribeToTable({ table: "notifications" }, () => survivor.push("hit"));
    const channel = rt().liveChannels("hub:")[0];

    offLeaving();
    expect(channel.removed).toBe(false);
    expect(activeChannelCount()).toBe(1);

    channel.emitPostgres("notifications", { eventType: "INSERT", new: {} });
    expect(survivor).toEqual(["hit"]);
    // Handler, który odszedł, nie może już nic dostać - inaczej odmontowany
    // komponent nadal aktualizowałby swój (martwy) stan.
    expect(leaving).toEqual([]);

    offSurvivor();
    expect(channel.removed).toBe(true);
    expect(activeChannelCount()).toBe(0);
  });

  it("dopiero ostatni subskrybent zamyka kanał", () => {
    const offs = [1, 2, 3].map(() =>
      subscribeToTable({ table: "cross_references" }, () => undefined),
    );
    const channel = rt().liveChannels("hub:")[0];

    offs[0]();
    offs[1]();
    expect(channel.removed).toBe(false);
    expect(activeChannelCount()).toBe(1);

    offs[2]();
    expect(channel.removed).toBe(true);
    expect(activeChannelCount()).toBe(0);
  });

  it("specyfikacja rozróżnia schemat, zdarzenie i filtr - każda dostaje własny kanał", () => {
    // Klucz zlepia cztery pola. Gdyby pomijał którekolwiek, dwa różne
    // nasłuchy dzieliłyby kanał o CUDZEJ specyfikacji i jeden z nich milczałby.
    const offs = [
      subscribeToTable({ table: "notifications" }, () => undefined),
      subscribeToTable({ table: "notifications", event: "INSERT" }, () => undefined),
      subscribeToTable({ table: "notifications", schema: "storage" }, () => undefined),
      subscribeToTable(
        { table: "notifications", filter: `user_id=eq.${USER_ID}` },
        () => undefined,
      ),
    ];

    expect(activeChannelCount()).toBe(4);
    expect(rt().liveChannels("hub:")).toHaveLength(4);

    for (const off of offs) off();
  });

  it("domyślne wartości specyfikacji trafiają do zapisu na kanale", () => {
    // Brak `event` musi znaczyć „wszystkie operacje", a brak `schema` - "public".
    // Podstawienie tu czegokolwiek innego uciszyłoby DELETE albo wskazało
    // nieistniejący schemat.
    const off = subscribeToTable({ table: "cross_references" }, () => undefined);
    const channel = rt().liveChannels("hub:")[0];

    expect(channel.name.startsWith("hub:public|cross_references|*|:")).toBe(true);
    expect(channel.listeners).toHaveLength(1);
    expect(channel.listeners[0].filter).toEqual({
      event: "*",
      schema: "public",
      table: "cross_references",
    });
    expect("filter" in channel.listeners[0].filter).toBe(false);

    off();
  });

  it("po pełnym zwolnieniu powstaje NOWY kanał o innej nazwie", () => {
    // Nazwa niesie losowy sufiks celowo: ponowne użycie tej samej nazwy zwraca
    // z supabase-js instancję JUŻ zasubskrybowaną, która odrzuca nowe callbacki
    // `.on()` - po remouncie trasy handler nie dostawałby nic.
    const offFirst = subscribeToTable({ table: "cross_references" }, () => undefined);
    const firstName = rt().liveChannels("hub:")[0].name;
    offFirst();

    const offSecond = subscribeToTable({ table: "cross_references" }, () => undefined);
    const secondName = rt().liveChannels("hub:")[0].name;

    expect(rt().channels).toHaveLength(2);
    expect(secondName).not.toBe(firstName);
    expect(secondName.startsWith("hub:public|cross_references|*|:")).toBe(true);

    offSecond();
  });
});

describe("tableChannelHub - odporność zwrotu unsubscribe", () => {
  it("podwójne wywołanie TEGO SAMEGO unsubscribe jest bezpieczne", () => {
    // StrictMode montuje efekt dwa razy, a niejeden hook woła sprzątanie także
    // ręcznie. Drugie wywołanie musi być no-opem, nie wyjątkiem.
    const off = subscribeToTable({ table: "notifications" }, () => undefined);
    const channel = rt().liveChannels("hub:")[0];

    off();
    expect(channel.removed).toBe(true);
    expect(activeChannelCount()).toBe(0);

    expect(() => off()).not.toThrow();
    expect(activeChannelCount()).toBe(0);
  });

  it("spóźniony unsubscribe NIE zabiera kanału odtworzonego po nim", () => {
    // To jest realny wyścig: trasa się odmontowuje, natychmiast montuje nowa
    // z tą samą specyfikacją, a spóźnione sprzątanie starej trafia już w NOWY
    // wpis huba. Gdyby usunęło z niego cudzy handler albo zamknęło kanał,
    // świeżo zamontowany ekran zostałby bez zdarzeń.
    const stale = subscribeToTable({ table: "notifications" }, () => undefined);
    stale();

    const received: string[] = [];
    const fresh = subscribeToTable({ table: "notifications" }, () => received.push("hit"));
    const freshChannel = rt().liveChannels("hub:")[0];

    stale();

    expect(freshChannel.removed).toBe(false);
    expect(activeChannelCount()).toBe(1);
    freshChannel.emitPostgres("notifications", { eventType: "INSERT", new: {} });
    expect(received).toEqual(["hit"]);

    fresh();
    expect(freshChannel.removed).toBe(true);
  });

  it("unsubscribe jednego z dwóch subskrybentów wywołany dwukrotnie nie rusza refcountu drugiego", () => {
    const offFirst = subscribeToTable({ table: "notifications" }, () => undefined);
    const offSecond = subscribeToTable({ table: "notifications" }, () => undefined);
    const channel = rt().liveChannels("hub:")[0];

    offFirst();
    offFirst();
    expect(channel.removed).toBe(false);
    expect(activeChannelCount()).toBe(1);

    offSecond();
    expect(channel.removed).toBe(true);
  });
});

describe("tableChannelHub - ścieżka SSR", () => {
  it("bez obiektu window NIE dotyka klienta Realtime i zwraca no-op", () => {
    // Moduł jest importowany także w renderze serwerowym (root layout ciągnie
    // za sobą cały mostek spójności). Utworzenie kanału na serwerze rzuciłoby
    // w kliencie Supabase albo - gorzej - otworzyło websocket na render.
    vi.stubGlobal("window", undefined);
    expect(typeof window).toBe("undefined");

    const handler = vi.fn();
    const unsubscribe = subscribeToTable({ table: "notifications" }, handler);

    expect(rt().channels).toEqual([]);
    expect(activeChannelCount()).toBe(0);
    expect(unsubscribe()).toBeUndefined();
    expect(handler).not.toHaveBeenCalled();
  });

  it("po powrocie do przeglądarki subskrypcja działa normalnie", () => {
    // Dowód, że no-op serwerowy nie zostawia po sobie żadnego stanu w hubie:
    // hydracja po SSR musi założyć kanał tak, jakby serwera nie było.
    vi.stubGlobal("window", undefined);
    const serverSide = subscribeToTable({ table: "notifications" }, () => undefined);
    serverSide();
    vi.unstubAllGlobals();

    const received: string[] = [];
    const off = subscribeToTable({ table: "notifications" }, () => received.push("hit"));
    expect(activeChannelCount()).toBe(1);
    rt().liveChannels("hub:")[0].emitPostgres("notifications", { eventType: "INSERT", new: {} });
    expect(received).toEqual(["hit"]);

    off();
  });
});
