// Hooki KATALOGU RODZAJOW WYDARZEN: brama `enabled`, okna swiezosci i zasieg
// uniewaznienia po zapisie.
//
// PO CO TEN PLIK ISTNIEJE - trzy klasy bledow, ktorych nie zlapie zaden test
// renderujacy ekran katalogu.
//
// 1) UNIEWAZNIENIE, KTORE NIE SIEGA SELEKTU W KREATORZE. Naglowek modulu
//    (`useEventTypes.ts:6-9`) nazywa przyczyne wprost: rozsypane literaly kluczy
//    konczyly sie tym, ze kasowanie trafialo w klucz, ktorego nikt nie czyta -
//    "zapisalem, a lista sie nie odswiezyla". Obietnica zyje w jednej prywatnej
//    funkcji `useEventTypeInvalidation`, ale `onSuccess` jest dopisany OSOBNO
//    przy kazdym z czterech hakow, wiec kazdy dostaje wlasny przypadek.
// 2) OKNA SWIEZOSCI POMYLONE MIEDZY EKRANAMI. Selekt kreatora trzyma katalog
//    piec minut (zeby nie migotal przy kazdym otwarciu dialogu), panel
//    redakcyjny trzydziesci sekund (zeby redaktor zobaczyl wlasny zapis).
//    Zamiana tych dwoch stalych miejscami niczego nie wywraca w kompilacji,
//    a kosztuje albo migotanie kreatora, albo panel klamiacy po zapisie.
// 3) KATALOG, KTORY W BLEDZIE UDAJE, ZE MA DANE. Komentarz :37-44 mowi, ze modul
//    CELOWO nie ma listy awaryjnej: rodzaje sa per tenant i redakcyjne, wiec
//    kazda stala w kodzie bylaby cudzym katalogiem. Blad ma wiec zostac bledem,
//    a nie szescioma rodzajami systemowymi w selekcie.
//
// Zaleznoscia jest tu `eventTypesApi` (siec) - i tylko ona jest atrapa. Hooki
// biora udzial w tescie w calosci, bo to one sa przedmiotem pomiaru.
//
// ZAWEZENIE NAJEMCA siedzi w SQL-u: zapis idzie przez `admin_event_type_*`
// z bramka `assert_admin_tenant()` (patrz naglowek `eventTypesApi.ts`), a nie
// przez `.from(...)`. Po stronie hakow pilnujemy wiec nazwy i ladunku, ktore
// jada do warstwy RPC; samego filtra tenanta pilnuje bramka
// `check:sql-tenant-scope`.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const api = vi.hoisted(() => ({
  fetchActiveEventTypes: vi.fn(),
  fetchAdminEventTypes: vi.fn(),
  upsertEventType: vi.fn(),
  setEventTypeActive: vi.fn(),
  deleteEventType: vi.fn(),
  reassignEventType: vi.fn(),
}));

vi.mock("@/lib/events/eventTypesApi", () => api);

import {
  eventTypeKeys,
  useAdminEventTypes,
  useDeleteEventType,
  useEventTypes,
  useReassignEventType,
  useSetEventTypeActive,
  useUpsertEventType,
} from "@/lib/events/useEventTypes";
import type { EventTypeUpsertInput } from "@/lib/events/eventTypesApi";

/**
 * Klucz starej listy wydarzen w sekcji spolecznosci. Literal, a nie fabryka -
 * i tak jest w calym repozytorium (`useAdminEvents.ts:97`,
 * `useAdminEventDetail.ts:52`, `organisms/EventsListManager.tsx:369`,
 * `src/lib/realtime/eventInvalidationMap.ts:353`). Przepisany tutaj SWIADOMIE,
 * bo zrodlo prawdy dla tego klucza nie istnieje - i test ma pasc, gdy ktos
 * zmieni literal w haku, nie ruszajac czytelnikow.
 */
const ADMIN_EVENTS_KEY = ["admin-community-events"];

/**
 * Publiczna lista wydarzen - `src/lib/community/publicQueries.ts:91`,
 * rozgrzewana w SSR trasy `/events`.
 */
const PUBLIC_EVENTS_KEY = ["public-events"];

const BASE_MS = Date.parse("2026-05-11T09:00:00.000Z");

let client: QueryClient;

function wrapper({ children }: { children: ReactNode }) {
  return createElement(QueryClientProvider, { client }, children);
}

function typeInput(overrides: Partial<EventTypeUpsertInput> = {}): EventTypeUpsertInput {
  return {
    id: null,
    key: "panel_dyskusyjny",
    namePl: "Panel dyskusyjny",
    nameEn: "Panel discussion",
    descriptionPl: "",
    descriptionEn: "",
    icon: "mic",
    accentColor: null,
    defaultFormat: "onsite",
    defaultRegistrationMode: "form",
    defaultRegistrationFlow: "approval",
    defaultGuestMode: "teaser",
    defaultCapacity: null,
    defaultDurationMinutes: 90,
    defaultMinTierRank: 0,
    defaultChathamHouse: false,
    requiresTicket: false,
    sortOrder: 10,
    isActive: true,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  api.fetchActiveEventTypes.mockResolvedValue([]);
  api.fetchAdminEventTypes.mockResolvedValue([]);
  api.upsertEventType.mockResolvedValue("typ-1");
  api.setEventTypeActive.mockResolvedValue(true);
  api.deleteEventType.mockResolvedValue(true);
  api.reassignEventType.mockResolvedValue(0);
});

afterEach(() => {
  // Czesc przypadkow podmienia SAM ZEGAR (bez podmiany `setTimeout`), zeby
  // zmierzyc okno swiezosci - bez tego sprzatania nastepny plik dostalby
  // zatrzymana date.
  vi.useRealTimers();
});

describe("klucze pamieci podrecznej katalogu", () => {
  it("oba ekrany wisza pod JEDNYM korzeniem `event-types`", () => {
    // Uniewaznienie po zapisie kasuje `eventTypeKeys.all`. Klucz, ktory
    // wypadlby spod tego korzenia, przezylby zapis z nieaktualnym katalogiem.
    expect(eventTypeKeys.all).toEqual(["event-types"]);
    expect(eventTypeKeys.active()).toEqual(["event-types", "active"]);
    expect(eventTypeKeys.admin()).toEqual(["event-types", "admin"]);
    expect(eventTypeKeys.active().slice(0, 1)).toEqual(eventTypeKeys.all);
    expect(eventTypeKeys.admin().slice(0, 1)).toEqual(eventTypeKeys.all);
  });

  it("selekt kreatora i panel redakcyjny maja ROZLACZNE szuflady", () => {
    // Panel widzi takze rodzaje wylaczone, selekt tylko aktywne. Wspolna
    // szuflada pokazalaby w kreatorze rodzaj zdjety z uzytku.
    expect(eventTypeKeys.active()).not.toEqual(eventTypeKeys.admin());
  });
});

describe("useEventTypes - selekt w kreatorze", () => {
  it("pobiera aktywne rodzaje i oddaje je pod kluczem `active`", async () => {
    const rows = [{ id: "typ-1", key: "kongres" }];
    api.fetchActiveEventTypes.mockResolvedValue(rows);

    const { result } = renderHook(() => useEventTypes(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(api.fetchActiveEventTypes).toHaveBeenCalledTimes(1);
    expect(result.current.data).toBe(rows);
    expect(client.getQueryData(eventTypeKeys.active())).toBe(rows);
  });

  it("hak wolany BEZ argumentu pyta baze - domyslka jest `enabled`", async () => {
    // Wiekszosc wywolan w panelu nie podaje argumentu; zamiana domyslki na
    // `false` dalaby pusty selekt bez jednego bledu w konsoli.
    const { result } = renderHook(() => useEventTypes(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(api.fetchActiveEventTypes).toHaveBeenCalledTimes(1);
  });

  it("`enabled === false` NIE dotyka bazy wcale", async () => {
    // Dialog kreatora montuje hak, zanim redaktor go otworzy. Zapytanie
    // wypuszczone mimo brany to ruch do bazy na kazdym wejsciu na liste.
    const { result } = renderHook(() => useEventTypes(false), { wrapper });

    await waitFor(() => expect(result.current.fetchStatus).toBe("idle"));
    expect(result.current.isPending).toBe(true);
    expect(result.current.data).toBeUndefined();
    expect(api.fetchActiveEventTypes).not.toHaveBeenCalled();
  });

  it("otwarcie dialogu PO montazu uruchamia pobranie", async () => {
    const { result, rerender } = renderHook(({ open }: { open: boolean }) => useEventTypes(open), {
      wrapper,
      initialProps: { open: false },
    });
    expect(api.fetchActiveEventTypes).not.toHaveBeenCalled();

    rerender({ open: true });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(api.fetchActiveEventTypes).toHaveBeenCalledTimes(1);
  });

  it("blad katalogu zostaje BLEDEM, a nie cicha lista rodzajow systemowych", async () => {
    // Komentarz `useEventTypes.ts:37-44`: modul celowo nie ma listy awaryjnej,
    // bo rodzaje sa per tenant. Sciszenie bledu do stalej pokazaloby
    // organizacji cudzy katalog - i redaktor zapisalby wydarzenie na rodzaju,
    // ktorego jego tenant nie ma.
    api.fetchActiveEventTypes.mockRejectedValue(new Error("brak uprawnien"));

    const { result } = renderHook(() => useEventTypes(), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(result.current.error?.message).toBe("brak uprawnien");
    expect(result.current.data).toBeUndefined();
    expect(client.getQueryData(eventTypeKeys.active())).toBeUndefined();
  });

  it("PUSTY katalog jest poprawna odpowiedzia, nie stanem ladowania", async () => {
    // Tenant, ktory nie zdefiniowal jeszcze rodzajow, ma widziec pusty selekt
    // z komunikatem, a nie wieczna kreciolke.
    api.fetchActiveEventTypes.mockResolvedValue([]);

    const { result } = renderHook(() => useEventTypes(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toEqual([]);
    expect(result.current.isPending).toBe(false);
  });
});

describe("useAdminEventTypes - panel redakcyjny", () => {
  it("pobiera pelny katalog i oddaje go pod kluczem `admin`", async () => {
    const rows = [{ id: "typ-1", key: "kongres", is_active: false }];
    api.fetchAdminEventTypes.mockResolvedValue(rows);

    const { result } = renderHook(() => useAdminEventTypes(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(api.fetchAdminEventTypes).toHaveBeenCalledTimes(1);
    expect(client.getQueryData(eventTypeKeys.admin())).toBe(rows);
    // Panel czyta INNA funkcje niz selekt - podmiana jednej na druga ukrylaby
    // przed redaktorem rodzaje wylaczone, czyli te, ktore chce wlasnie wrocic.
    expect(api.fetchActiveEventTypes).not.toHaveBeenCalled();
  });

  it("`enabled === false` NIE dotyka bazy wcale", async () => {
    const { result } = renderHook(() => useAdminEventTypes(false), { wrapper });

    await waitFor(() => expect(result.current.fetchStatus).toBe("idle"));
    expect(api.fetchAdminEventTypes).not.toHaveBeenCalled();
    // Zamknieta brama ma zostawic stan "jeszcze nie pytalem", a nie pusty
    // katalog: panel rozrozniajacy oba przez `data ?? []` napisalby "brak
    // rodzajow" organizacji, ktora ma ich kilkanascie.
    expect(result.current.data).toBeUndefined();
    expect(result.current.isPending).toBe(true);
  });

  it("blad panelu dociera do ekranu", async () => {
    // Tresc bledu jest jedyna wskazowka dla redaktora, ktory nie ma roli -
    // "brak roli" kaze mu isc do administratora, a pusta tabela kaze zakladac
    // katalog od nowa.
    api.fetchAdminEventTypes.mockRejectedValue(new Error("brak roli"));

    const { result } = renderHook(() => useAdminEventTypes(), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(result.current.error?.message).toBe("brak roli");
    expect(result.current.data).toBeUndefined();
  });
});

describe("okna swiezosci", () => {
  it("ponowne wejscie do kreatora w oknie pieciu minut NIE pyta bazy", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(BASE_MS));

    const first = renderHook(() => useEventTypes(), { wrapper });
    await waitFor(() => expect(first.result.current.isSuccess).toBe(true));
    first.unmount();

    // Cztery minuty pozniej - redaktor zamknal i otworzyl dialog kilka razy.
    vi.setSystemTime(new Date(BASE_MS + 4 * 60_000));
    const second = renderHook(() => useEventTypes(), { wrapper });
    await waitFor(() => expect(second.result.current.isSuccess).toBe(true));

    expect(api.fetchActiveEventTypes).toHaveBeenCalledTimes(1);
    second.unmount();
  });

  it("po pieciu minutach kreator idzie po swiezy katalog", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(BASE_MS));

    const first = renderHook(() => useEventTypes(), { wrapper });
    await waitFor(() => expect(first.result.current.isSuccess).toBe(true));
    first.unmount();

    // Katalog jest maly, ale nie jest niezmienny: rodzaj dodany przez innego
    // redaktora ma sie pojawic bez przeladowania aplikacji.
    vi.setSystemTime(new Date(BASE_MS + 6 * 60_000));
    const second = renderHook(() => useEventTypes(), { wrapper });
    await waitFor(() => expect(api.fetchActiveEventTypes).toHaveBeenCalledTimes(2));
    second.unmount();
  });

  it("panel redakcyjny odswieza sie SZYBCIEJ niz selekt kreatora", async () => {
    // Dwie rozne stale, dwa rozne powody: redaktor ma zobaczyc wlasny zapis po
    // pol minuty, a selekt w kreatorze nie moze migotac przy kazdym otwarciu.
    // Zamiana ich miejscami jest w kodzie niewidoczna.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(BASE_MS));

    const first = renderHook(() => ({ active: useEventTypes(), admin: useAdminEventTypes() }), {
      wrapper,
    });
    await waitFor(() => expect(first.result.current.active.isSuccess).toBe(true));
    await waitFor(() => expect(first.result.current.admin.isSuccess).toBe(true));
    first.unmount();

    vi.setSystemTime(new Date(BASE_MS + 40_000));
    const second = renderHook(() => ({ active: useEventTypes(), admin: useAdminEventTypes() }), {
      wrapper,
    });
    await waitFor(() => expect(api.fetchAdminEventTypes).toHaveBeenCalledTimes(2));

    expect(api.fetchActiveEventTypes).toHaveBeenCalledTimes(1);
    second.unmount();
  });
});

// DRUGI ARGUMENT `mutationFn`. TanStack Query 5 wola funkcje mutujaca jako
// (zmienne, kontekst), wiec asercje o argumentach hakow podajacych funkcje
// warstwy RPC WPROST domykamy `expect.anything()`. Bez tego czerwienilyby sie
// na wydaniu biblioteki, a nie na bledzie w kodzie.
describe("mutacje katalogu - argumenty i wynik", () => {
  it("useUpsertEventType oddaje warstwie RPC CALY formularz bez przerabiania", async () => {
    // Osiemnascie pol redakcyjnych jedzie jednym ladunkiem `p_payload`
    // (naglowek `eventTypesApi.ts`). Hak nie ma prawa niczego po drodze
    // dolozyc ani zgubic - zgubione pole to cicha utrata wartosci w bazie.
    const input = typeInput({ id: "typ-7", defaultCapacity: 120 });
    api.upsertEventType.mockResolvedValue("typ-7");

    const { result } = renderHook(() => useUpsertEventType(), { wrapper });
    const saved = await result.current.mutateAsync(input);

    expect(api.upsertEventType).toHaveBeenCalledWith(input, expect.anything());
    expect(saved).toBe("typ-7");
    await waitFor(() => expect(result.current.data).toBe("typ-7"));
  });

  it("useSetEventTypeActive rozpakowuje obiekt na argumenty (id, isActive)", async () => {
    // Jedyny hak katalogu, ktory przeklada ksztalt wejscia na argumenty
    // pozycyjne. Sprawdzamy DOKLADNA liste argumentow, nie podzbior: gdyby
    // `mutationFn` dostal wprost `setEventTypeActive`, wywolanie mialoby ksztalt
    // (obiekt, kontekst) i baza dostalaby obiekt zamiast identyfikatora.
    const { result } = renderHook(() => useSetEventTypeActive(), { wrapper });
    const done = await result.current.mutateAsync({ id: "typ-3", isActive: false });

    expect(api.setEventTypeActive.mock.calls[0]).toEqual(["typ-3", false]);
    expect(done).toBe(true);
  });

  it("useSetEventTypeActive przenosi obie decyzje - wlaczenie i wylaczenie", async () => {
    // `isActive` jedzie jako wartosc, nie jako sama obecnosc pola: zamiana na
    // `true` na sztywno wskrzeszalaby rodzaje zdjete z uzytku.
    const { result } = renderHook(() => useSetEventTypeActive(), { wrapper });

    await result.current.mutateAsync({ id: "typ-3", isActive: false });
    await result.current.mutateAsync({ id: "typ-3", isActive: true });

    expect(api.setEventTypeActive.mock.calls).toEqual([
      ["typ-3", false],
      ["typ-3", true],
    ]);
  });

  it("useDeleteEventType kasuje rodzaj po identyfikatorze", async () => {
    const { result } = renderHook(() => useDeleteEventType(), { wrapper });
    const removed = await result.current.mutateAsync("typ-9");

    expect(api.deleteEventType).toHaveBeenCalledWith("typ-9", expect.anything());
    expect(removed).toBe(true);
  });

  it("useReassignEventType przekazuje rodzaj ZRODLOWY przed docelowym", async () => {
    // Zamiana argumentow miejscami przechodzi typowanie (oba sa napisami),
    // a w bazie przepisuje wydarzenia w DRUGA STRONE - czyli kasuje rozdzial,
    // ktory redaktor wlasnie budowal. Stad dokladna lista argumentow.
    api.reassignEventType.mockResolvedValue(12);

    const { result } = renderHook(() => useReassignEventType(), { wrapper });
    await result.current.mutateAsync({ fromId: "typ-stary", toId: "typ-nowy" });

    expect(api.reassignEventType.mock.calls[0]).toEqual(["typ-stary", "typ-nowy"]);
  });

  it("useReassignEventType oddaje LICZBE przepietych wydarzen", async () => {
    // Liczba jest trescia potwierdzenia dla redaktora (naglowek
    // `reassignEventType`): "przepieto" na czterdziestu wydarzeniach jest inna
    // informacja niz "przepieto" na zerze.
    api.reassignEventType.mockResolvedValue(40);

    const { result } = renderHook(() => useReassignEventType(), { wrapper });
    const moved = await result.current.mutateAsync({ fromId: "a", toId: "b" });

    expect(moved).toBe(40);
    await waitFor(() => expect(result.current.data).toBe(40));
  });

  it("przepiecie ZERA wydarzen jest sukcesem z zerem, nie brakiem wyniku", async () => {
    // `result.current.data` musi byc liczba, a nie `undefined`: ekran
    // rozrozniajacy oba stany przez `data ?? ...` pokazalby "przepieto" bez
    // liczby dokladnie wtedy, gdy nic sie nie stalo.
    api.reassignEventType.mockResolvedValue(0);

    const { result } = renderHook(() => useReassignEventType(), { wrapper });
    await result.current.mutateAsync({ fromId: "a", toId: "b" });

    await waitFor(() => expect(result.current.data).toBe(0));
    expect(result.current.isSuccess).toBe(true);
  });

  it("odrzucony zapis konczy sie bledem mutacji, a nie cichym sukcesem", async () => {
    // Baza pilnuje unikalnosci klucza rodzaju; ekran musi to pokazac, bo
    // redaktor inaczej zamknie dialog przekonany, ze zapisal.
    api.upsertEventType.mockRejectedValue(new Error("klucz zajety"));

    const { result } = renderHook(() => useUpsertEventType(), { wrapper });
    await expect(result.current.mutateAsync(typeInput())).rejects.toThrow("klucz zajety");
    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(result.current.error?.message).toBe("klucz zajety");
    expect(result.current.data).toBeUndefined();
  });
});

describe("zasieg uniewaznienia po mutacji", () => {
  it("kazdy z trzech prostych hakow kasuje CALA rodzine `event-types`", async () => {
    // Wylaczenie rodzaju musi zniknac takze z selektu kreatora, ktory czyta
    // `active()` - stad korzen, a nie sam klucz panelu (komentarz :63-67).
    // `onSuccess` jest dopisany osobno przy kazdym haku, wiec kazdy przechodzi
    // przez ten sam przebieg.
    //
    // PODGLAD NIE ZASTEPUJE IMPLEMENTACJI. Sam zapis wywolania przeszedlby
    // takze dla klucza, ktorego nikt nie czyta, wiec obok listy kluczy
    // sprawdzamy SKUTEK w pamieci: obie szuflady katalogu traca waznosc,
    // a lista wydarzen panelu nie - zapis pojedynczego rodzaju nie przepisuje
    // zadnego wydarzenia, wiec nie ma po co jej pobierac drugi raz.
    const { result } = renderHook(
      () => ({
        upsert: useUpsertEventType(),
        setActive: useSetEventTypeActive(),
        remove: useDeleteEventType(),
      }),
      { wrapper },
    );

    const cases: ReadonlyArray<{ name: string; run: () => Promise<unknown> }> = [
      { name: "useUpsertEventType", run: () => result.current.upsert.mutateAsync(typeInput()) },
      {
        name: "useSetEventTypeActive",
        run: () => result.current.setActive.mutateAsync({ id: "typ-1", isActive: false }),
      },
      { name: "useDeleteEventType", run: () => result.current.remove.mutateAsync("typ-1") },
    ];

    for (const testCase of cases) {
      // `setQueryData` zeruje znacznik uniewaznienia, wiec kazdy obieg petli
      // zaczyna od trzech swiezych szuflad.
      client.setQueryData(eventTypeKeys.active(), [{ id: "typ-1", key: "kongres" }]);
      client.setQueryData(eventTypeKeys.admin(), [{ id: "typ-1", key: "kongres" }]);
      client.setQueryData(ADMIN_EVENTS_KEY, [{ id: "evt-1" }]);

      const invalidate = vi.spyOn(client, "invalidateQueries");
      await testCase.run();

      const keys = invalidate.mock.calls.map((call) => call[0]?.queryKey);
      expect(keys, testCase.name).toEqual([eventTypeKeys.all]);
      expect(client.getQueryState(eventTypeKeys.active())?.isInvalidated, testCase.name).toBe(true);
      expect(client.getQueryState(eventTypeKeys.admin())?.isInvalidated, testCase.name).toBe(true);
      expect(client.getQueryState(ADMIN_EVENTS_KEY)?.isInvalidated, testCase.name).toBe(false);
      invalidate.mockRestore();
    }
  });

  it("po zapisie OBA ekrany pobieraja katalog ponownie, bez przeladowania strony", async () => {
    // Dowod na to, ze korzen naprawde siega obu szuflad - sama asercja na
    // ksztalt klucza przeszlaby takze dla klucza, ktorego nikt nie czyta.
    const { result } = renderHook(
      () => ({
        active: useEventTypes(),
        admin: useAdminEventTypes(),
        upsert: useUpsertEventType(),
      }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.active.isSuccess).toBe(true));
    await waitFor(() => expect(result.current.admin.isSuccess).toBe(true));

    await result.current.upsert.mutateAsync(typeInput({ namePl: "Sniadanie prasowe" }));

    await waitFor(() => expect(api.fetchActiveEventTypes).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(api.fetchAdminEventTypes).toHaveBeenCalledTimes(2));
  });

  it("useReassignEventType kasuje TRZY rodziny: katalog, liste panelu I liste publiczna", async () => {
    // Operacja masowa zmienia `events.event_type_id` i `events.kind`, wiec sama
    // rodzina `event-types` nie wystarcza: lista wydarzen w panelu trzymalaby
    // po niej stary rodzaj przy kazdym wierszu, a publiczny katalog - stary
    // rodzaj na kaflu. Kolejnosc tez jest utrwalona - kazda kolejna linia
    // `onSuccess` jest ta, ktora najlatwiej zgubic przy refaktorze.
    api.reassignEventType.mockResolvedValue(3);
    client.setQueryData(eventTypeKeys.admin(), [{ id: "typ-stary", key: "kongres" }]);
    client.setQueryData(ADMIN_EVENTS_KEY, [{ id: "evt-1", kind: "kongres" }]);
    client.setQueryData(PUBLIC_EVENTS_KEY, [{ id: "evt-1", kind: "kongres" }]);
    const invalidate = vi.spyOn(client, "invalidateQueries");

    const { result } = renderHook(() => useReassignEventType(), { wrapper });
    await result.current.mutateAsync({ fromId: "typ-stary", toId: "typ-nowy" });

    const keys = invalidate.mock.calls.map((call) => call[0]?.queryKey);
    expect(keys).toEqual([eventTypeKeys.all, ADMIN_EVENTS_KEY, PUBLIC_EVENTS_KEY]);
    // Wszystkie trzy rodziny naprawde traca waznosc. Bez tego zostaje asercja
    // o samym wywolaniu - a ta przeszlaby takze dla klucza, ktorego nikt nie czyta.
    expect(client.getQueryState(eventTypeKeys.admin())?.isInvalidated).toBe(true);
    expect(client.getQueryState(ADMIN_EVENTS_KEY)?.isInvalidated).toBe(true);
    expect(client.getQueryState(PUBLIC_EVENTS_KEY)?.isInvalidated).toBe(true);
  });

  it("uniewaznienie listy wydarzen siega KAZDEGO jej przekroju filtra", async () => {
    // Klucz `["admin-community-events"]` jest KORZENIEM rodziny - realne
    // zapytania nosza pod nim jeszcze parametry filtra. Gdyby hak kasowal
    // pelny klucz z parametrami, redaktor stojacy na innym filtrze zostalby
    // ze stara lista.
    api.reassignEventType.mockResolvedValue(3);
    client.setQueryData([...ADMIN_EVENTS_KEY, { status: "draft", page: 2 }], [{ id: "evt-1" }]);

    const { result } = renderHook(() => useReassignEventType(), { wrapper });
    await result.current.mutateAsync({ fromId: "typ-stary", toId: "typ-nowy" });

    const state = client.getQueryState([...ADMIN_EVENTS_KEY, { status: "draft", page: 2 }]);
    expect(state?.isInvalidated).toBe(true);
  });

  it("przepiecie rodzaju uniewaznia takze PUBLICZNA liste wydarzen", async () => {
    // NAPRAWIONY DEFEKT. Komentarz nad hakiem obiecuje, ze uniewaznienie
    // obejmuje takze "widgety publiczne" - i ma po temu powod, bo operacja
    // przepisuje `events.kind`, po ktorym publiczna lista filtruje i ktory
    // rysuje na kafelku. Wczesniej kod kasowal WYLACZNIE `event-types`
    // i `["admin-community-events"]`.
    //
    // DLACZEGO TO BOLALO. `["public-events"]`
    // (`src/lib/community/publicQueries.ts:91`) jest rozgrzewane w SSR trasy
    // `/events` i zyje w tym samym kliencie zapytan, wiec redaktor, ktory po
    // operacji masowej przechodzil na strone publiczna przejsciem klienckim,
    // widzial stare rodzaje. Nie ratuje tego kanal czasu rzeczywistego:
    // `src/lib/realtime/eventInvalidationMap.ts:92-93` kasuje te rodzine
    // (przez `eventKeys()`, lista kluczy :349-354) WYLACZNIE dla
    // `event.published.v1` i `event.cancelled.v1`, a sama funkcja bazy
    // `admin_event_type_reassign` (migracja 20260824081304, :602) przepisuje
    // `events.kind` i nie emituje zadnego zdarzenia.
    api.reassignEventType.mockResolvedValue(3);
    // Wpis rozgrzany w SSR: publiczna lista z parametrami trasy `/events`.
    const publicListKey = [...PUBLIC_EVENTS_KEY, { locale: "pl", page: 1 }];
    client.setQueryData(publicListKey, [{ id: "evt-1", kind: "kongres" }]);

    const { result } = renderHook(() => useReassignEventType(), { wrapper });
    await result.current.mutateAsync({ fromId: "typ-stary", toId: "typ-nowy" });

    // Asercja na SKUTEK, nie na liste wywolan: to jest dokladnie ten wpis,
    // z ktorego strona publiczna rysuje kafelek po przejsciu klienckim.
    // Uniewaznienie musi siegac KORZENIA rodziny, bo realny wpis nosi pod nim
    // jeszcze parametry trasy.
    expect(client.getQueryState(publicListKey)?.isInvalidated).toBe(true);
  });

  it("NIEUDANY zapis niczego nie uniewaznia", async () => {
    // Kasowanie pamieci po bledzie kazaloby ekranowi pobrac dokladnie te same
    // dane i wygladaloby jak "cos sie stalo" - a nie stalo sie nic.
    api.upsertEventType.mockRejectedValue(new Error("klucz zajety"));
    const invalidate = vi.spyOn(client, "invalidateQueries").mockResolvedValue(undefined);

    const { result } = renderHook(() => useUpsertEventType(), { wrapper });
    await expect(result.current.mutateAsync(typeInput())).rejects.toThrow("klucz zajety");

    expect(invalidate).not.toHaveBeenCalled();
  });

  it("NIEUDANE przepiecie zostawia obie rodziny nietkniete", async () => {
    // Przepiecie potrafi upasc na blokadzie po stronie bazy (rodzaj docelowy
    // nieaktywny). Wtedy zaden wiersz nie zmienil rodzaju, wiec lista wydarzen
    // w panelu jest nadal prawdziwa i nie ma po co jej pobierac.
    api.reassignEventType.mockRejectedValue(new Error("rodzaj docelowy nieaktywny"));
    const invalidate = vi.spyOn(client, "invalidateQueries").mockResolvedValue(undefined);

    const { result } = renderHook(() => useReassignEventType(), { wrapper });
    await expect(
      result.current.mutateAsync({ fromId: "typ-stary", toId: "typ-nowy" }),
    ).rejects.toThrow("rodzaj docelowy nieaktywny");

    expect(invalidate).not.toHaveBeenCalled();
    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});
