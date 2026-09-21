// ODMOWA JAKO FUNKCJA: kto NIE dostaje kanału realtime i który klucz cache
// NIE jest unieważniany.
//
// `widgetCacheInvalidation.tsx` renderuje `null`, więc każda jego regresja jest
// z definicji niewidoczna w testach renderujących - usunięcie `if (!isStaff)`
// nie zmienia ani jednego piksela. Zmienia natomiast koszt: każdy anonimowy
// czytelnik otwierałby wtedy własne połączenie Realtime z SZEŚCIOMA
// nasłuchami `postgres_changes`, a każdy zapis treści rozchodziłby się w burzę
// refetchów po wszystkich otwartych kartach serwisu. Nagłówek pliku
// produkcyjnego (linie 6-11) nazywa to wprost, ale nic tego dotąd nie pilnowało:
// cztery istniejące testy dotykają tego modułu WYŁĄCZNIE przez
// `emitWidgetCacheInvalidate`, a `WidgetLiveSync` i predykat `isWidgetQueryKey`
// nie były wołane nigdzie.
//
// DOWODEM SĄ KANAŁY I PREDYKAT, nie fakt, że render przeszedł:
//   * czytelnik (isStaff === false) -> `supabase.channel` ZERO razy,
//   * redakcja (isStaff === true)   -> jeden kanał `widget-live-sync`
//     z sześcioma nasłuchami i zdjęcie kanału przy odmontowaniu,
//   * predykat -> klucz spoza katalogu `LIVE_INVALIDATED_ROOTS` nie może
//     zostać unieważniony (inaczej „unieważnij widgety" znaczyłoby
//     „unieważnij wszystko", łącznie ze slotami spotkań, które mają własną,
//     krótką świeżość).
//
// DANE: wyłącznie fikcyjne (RODO); ten moduł nie czyta żadnych danych osobowych.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "@testing-library/react";
import type { Query, QueryClient, QueryKey } from "@tanstack/react-query";
import { renderWithQueryClient } from "@/test/renderWithQueryClient";
import type { RealtimeStub } from "@/test/supabase";

const h = vi.hoisted(() => ({
  auth: { isStaff: false },
  realtime: null as unknown,
}));

vi.mock("@/integrations/supabase/client", async () => {
  const { realtimeStub } = await import("@/test/supabase");
  const realtime = realtimeStub();
  h.realtime = realtime;
  return {
    supabase: {
      channel: vi.fn(realtime.channel),
      removeChannel: vi.fn(realtime.removeChannel),
    },
  };
});

vi.mock("@/hooks/useAuth", () => ({ useAuth: () => h.auth }));

import { supabase } from "@/integrations/supabase/client";
import {
  WidgetLiveSync,
  emitWidgetCacheInvalidate,
  invalidateWidgetCaches,
} from "@/lib/builder/widgetCacheInvalidation";
import { WIDGET_LIVE_QUERY_PREFIXES, WIDGET_QUERY_ROOTS } from "@/lib/builder/queryKeys";
import { sliderAuthorsQueryOptions } from "@/lib/builder/sliderAuthorsQuery";

const rt = () => h.realtime as RealtimeStub;

/** Atrapa `supabase.channel` widziana jako szpieg (mock fabryki wyżej). */
function channelSpy() {
  return vi.mocked(supabase.channel);
}

function removeChannelSpy() {
  return vi.mocked(supabase.removeChannel);
}

/**
 * Wyciąga predykat przekazany do `invalidateQueries` - to JEDYNE wejście do
 * `isWidgetQueryKey`, bo funkcja jest modulo-prywatna.
 */
function capturePredicate(): (key: QueryKey) => boolean {
  let predicate: ((q: Query) => boolean) | undefined;
  const client = {
    invalidateQueries: (filters: { predicate?: (q: Query) => boolean }) => {
      predicate = filters.predicate;
      return Promise.resolve();
    },
  } as unknown as QueryClient;

  invalidateWidgetCaches(client);

  if (!predicate) throw new Error("test: `invalidateQueries` nie dostalo predykatu");
  const fn = predicate;
  return (key: QueryKey) => fn({ queryKey: key } as unknown as Query);
}

beforeEach(() => {
  h.auth = { isStaff: false };
  rt().reset();
  channelSpy().mockClear();
  removeChannelSpy().mockClear();
});

describe("predykat inwalidacji - co NIE zostanie unieważnione", () => {
  it("unieważnianie idzie przez predykat, a nie przez listę kluczy", () => {
    // Gdyby moduł przekazywał `queryKey`, unieważniałby JEDEN klucz zamiast
    // wszystkich zapytań widgetowych naraz.
    const calls: Array<Record<string, unknown>> = [];
    const client = {
      invalidateQueries: (filters: Record<string, unknown>) => {
        calls.push(filters);
        return Promise.resolve();
      },
    } as unknown as QueryClient;

    invalidateWidgetCaches(client);

    expect(calls).toHaveLength(1);
    expect(typeof calls[0].predicate).toBe("function");
    expect(calls[0].queryKey).toBeUndefined();
  });

  it("klucz o pierwszym elemencie NIE-napisowym nie jest kluczem widgetu", () => {
    const predicate = capturePredicate();

    expect(predicate([42, {}] as unknown as QueryKey)).toBe(false);
    expect(predicate([{ scope: "posts" }] as unknown as QueryKey)).toBe(false);
    expect(predicate([] as unknown as QueryKey)).toBe(false);
  });

  it("klucz NIE-tablicowy przechodzi przez gałąź `: key` i nie wywraca predykatu", () => {
    // react-query zawsze podaje tablicę, ale predykat dostaje `q.queryKey`
    // z cache, którą testy i narzędzia potrafią podstawić - gałąź ma być
    // odporna, a nie rzucać przy `key[0]` na liczbie.
    const predicate = capturePredicate();

    expect(predicate(42 as unknown as QueryKey)).toBe(false);
    expect(predicate(null as unknown as QueryKey)).toBe(false);
  });

  it("korzeń świadomie POZA katalogiem live nie jest unieważniany", () => {
    // `meetingSlots` jest w `WIDGET_QUERY_ROOTS`, ale CELOWO nie ma go
    // w `LIVE_INVALIDATED_ROOTS` (queryKeys.ts:76-80): sloty spotkań mają
    // własną, krótką świeżość i własną inwalidację po mutacji, więc globalne
    // unieważnianie generowałoby wyłącznie ruch.
    const predicate = capturePredicate();

    expect(WIDGET_LIVE_QUERY_PREFIXES.has(WIDGET_QUERY_ROOTS.meetingSlots)).toBe(false);
    expect(predicate([WIDGET_QUERY_ROOTS.meetingSlots, {}, "u1"])).toBe(false);
    expect(predicate(["zupelnie-obcy-korzen", 1])).toBe(false);
  });

  it("korzeń z katalogu live jest unieważniany - i to dla KAŻDEJ pozycji katalogu", () => {
    const predicate = capturePredicate();

    expect(predicate([WIDGET_QUERY_ROOTS.postList, { limit: 5 }, "pl"])).toBe(true);
    for (const root of WIDGET_LIVE_QUERY_PREFIXES) {
      expect(predicate([root, "cokolwiek"]), `korzeń ${root} musi być unieważniany`).toBe(true);
    }
  });

  // DEFEKT: KORZEŃ KLUCZA AUTORÓW SLIDERA JEST POZA KATALOGIEM.
  //
  // WEJSCIE: `sliderAuthorsQueryOptions([...]).queryKey[0]`, czyli goły literał
  //   "builder-slider-authors" wpisany bezpośrednio w
  //   src/lib/builder/sliderAuthorsQuery.ts:64 - z pominięciem
  //   `WIDGET_QUERY_ROOTS`.
  // CO PSUJE: skoro korzenia nie ma w `WIDGET_QUERY_ROOTS`, nie ma go też
  //   w `LIVE_INVALIDATED_ROOTS` ani w `WIDGET_LIVE_QUERY_PREFIXES`, więc
  //   predykat `isWidgetQueryKey` (widgetCacheInvalidation.tsx:19-21) NIGDY
  //   nie trafia w to zapytanie. Ani nasłuch realtime redakcji, ani sygnał
  //   między kartami (`emitWidgetCacheInvalidate`) go nie dosięgają.
  // KONSEKWENCJA: zmiana nazwiska, awatara albo adresu profilu autora nie
  //   odświeża byline slidera na stronie głównej - hero trzyma stare dane
  //   osobowe do wygaśnięcia `staleTime` (60 s) LUB do pełnego przeładowania
  //   karty. To dokładnie ta klasa cichego rozjazdu, dla której powstał
  //   `queryKeys.ts` (nagłówek, linie 3-14), tylko ominięta: `queryKeys.test.ts`
  //   sprawdza kierunek korzeń -> użycie, a nie użycie -> korzeń.
  // WYMAGANA POPRAWKA: dopisać `sliderAuthors: "builder-slider-authors"` do
  //   `WIDGET_QUERY_ROOTS`, użyć stałej w `sliderAuthorsQuery.ts:64`
  //   i - ponieważ zapytanie zależy od treści redakcyjnej - dopisać ją do
  //   `LIVE_INVALIDATED_ROOTS`.
  it.fails("DEFEKT: korzeń klucza autorów slidera MUSI być w katalogu inwalidacji", () => {
    const root = sliderAuthorsQueryOptions([]).queryKey[0];
    const predicate = capturePredicate();

    expect(Object.values<string>(WIDGET_QUERY_ROOTS)).toContain(root);
    expect(WIDGET_LIVE_QUERY_PREFIXES.has(root)).toBe(true);
    expect(predicate([root, ["autor-1"]])).toBe(true);
  });
});

describe("WidgetLiveSync - kto dostaje kanał realtime", () => {
  it("ODMOWA GŁÓWNA: czytelnik anonimowy/zwykły NIE dostaje ani jednego kanału", () => {
    h.auth = { isStaff: false };

    const view = renderWithQueryClient(<WidgetLiveSync />);

    expect(channelSpy()).not.toHaveBeenCalled();
    expect(rt().channels).toHaveLength(0);

    view.unmount();
    expect(removeChannelSpy()).not.toHaveBeenCalled();
  });

  it("redakcja dostaje JEDEN kanał z sześcioma nasłuchami postgres_changes", () => {
    h.auth = { isStaff: true };

    const view = renderWithQueryClient(<WidgetLiveSync />);

    expect(channelSpy()).toHaveBeenCalledTimes(1);
    expect(channelSpy()).toHaveBeenCalledWith("widget-live-sync");
    const channel = rt().channelByPrefix("widget-live-sync");
    expect(channel).toBeDefined();
    expect(channel?.subscribeCount).toBe(1);
    expect(channel?.listeners.map((l) => l.filter.table)).toEqual([
      "posts",
      "pages",
      "categories",
      "tags",
      "builder_global_widgets",
      "builder_popups",
    ]);
    expect(channel?.listeners.every((l) => l.type === "postgres_changes")).toBe(true);
    expect(channel?.listeners.every((l) => l.filter.event === "*")).toBe(true);
    expect(channel?.listeners.every((l) => l.filter.schema === "public")).toBe(true);

    view.unmount();
  });

  it("każde z sześciu zdarzeń bazy unieważnia cache widgetów", () => {
    h.auth = { isStaff: true };
    const view = renderWithQueryClient(<WidgetLiveSync />);
    const spy = vi.spyOn(view.queryClient, "invalidateQueries").mockResolvedValue(undefined);
    const channel = rt().channelByPrefix("widget-live-sync");

    for (const table of [
      "posts",
      "pages",
      "categories",
      "tags",
      "builder_global_widgets",
      "builder_popups",
    ]) {
      act(() => channel?.emitPostgres(table, { eventType: "UPDATE" }));
    }

    expect(spy).toHaveBeenCalledTimes(6);
    view.unmount();
  });

  it("odmontowanie zdejmuje kanał - inaczej po kilku przejściach kończy się pula połączeń", () => {
    h.auth = { isStaff: true };

    const view = renderWithQueryClient(<WidgetLiveSync />);
    const channel = rt().channelByPrefix("widget-live-sync");
    expect(channel?.removed).toBe(false);

    view.unmount();

    expect(removeChannelSpy()).toHaveBeenCalledTimes(1);
    expect(channel?.removed).toBe(true);
    expect(rt().liveChannels("widget-live-sync")).toHaveLength(0);
  });
});

describe("sygnał między kartami - tani i dla wszystkich", () => {
  it("czytelnik BEZ kanału realtime i tak reaguje na lokalne zdarzenie unieważnienia", () => {
    h.auth = { isStaff: false };
    const view = renderWithQueryClient(<WidgetLiveSync />);
    const spy = vi.spyOn(view.queryClient, "invalidateQueries").mockResolvedValue(undefined);

    act(() => emitWidgetCacheInvalidate());

    expect(spy).toHaveBeenCalledTimes(1);
    expect(channelSpy()).not.toHaveBeenCalled();
    view.unmount();
  });

  it("po odmontowaniu nasłuch jest zdjęty - drugie zdarzenie nie podbija licznika", () => {
    h.auth = { isStaff: false };
    const view = renderWithQueryClient(<WidgetLiveSync />);
    const spy = vi.spyOn(view.queryClient, "invalidateQueries").mockResolvedValue(undefined);

    act(() => emitWidgetCacheInvalidate());
    expect(spy).toHaveBeenCalledTimes(1);

    view.unmount();
    act(() => emitWidgetCacheInvalidate());

    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("emitWidgetCacheInvalidate wysyła zdarzenie o UZGODNIONEJ nazwie", () => {
    const seen: string[] = [];
    const listener = (e: Event) => seen.push(e.type);
    window.addEventListener("widget-cache:invalidate", listener);

    emitWidgetCacheInvalidate();

    expect(seen).toEqual(["widget-cache:invalidate"]);
    window.removeEventListener("widget-cache:invalidate", listener);
  });
});
