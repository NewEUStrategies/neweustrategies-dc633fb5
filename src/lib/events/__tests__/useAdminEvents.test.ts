// Hooki LISTY WYDARZEN modulu: dwa rozlaczne klucze (lista i liczniki
// zakladek), zamrozenie granicy czasu na pelna minute i zasieg uniewaznienia
// po utworzeniu wydarzenia z rodzaju.
//
// PO CO TEN PLIK ISTNIEJE - trzy obietnice z naglowka modulu, ktorych nie
// sprawdzi zaden test renderujacy ekran listy.
//
// 1) ZEGAR W KLUCZU. `Date.now()` w kluczu zapytania to nieskonczona petla
//    pobran: kazdy render daje nowy klucz, nowy klucz daje nowe zapytanie,
//    nowe zapytanie daje nowy render. Modul rozwiazuje to zamrozeniem
//    znacznika CO DO MINUTY - a rozdzielczosc znacznika (minuta czy sekunda)
//    jest niewidoczna w kodzie i nie wywala kompilacji. Tutaj jest mierzona
//    liczba wywolan RPC przy przesunieciu zegara.
//
// 2) LICZNIKI ODDZIELONE OD LISTY. Zakladka „Szkice" ma pokazywac, ile jest
//    szkicow WSROD WSZYSTKICH wydarzen - dlatego liczniki maja wlasny klucz
//    BEZ znacznika minuty. Wpuszczenie minuty do klucza licznikow oznacza
//    mrugniecie wszystkich szesciu liczb co minute.
//
// 3) UTWORZENIE WYDARZENIA RUSZA TRZY EKRANY. Lista, katalog rodzajow
//    (licznik uzycia rodzaju blokuje kosz) i stara lista sekcji spolecznosci
//    czytaja te same wiersze. Kazda z trzech linii `onSuccess` jest osobna
//    i kazda da sie skasowac bez zadnego widocznego skutku od razu.
//
// Zaleznoscia jest tu `eventsListApi` (siec) - i tylko ona jest atrapa. Klucz
// katalogu rodzajow bierzemy PRAWDZIWY z `useEventTypes`, bo stala przepisana
// w tescie nie dowodzilaby, ze oba moduly mowia o tym samym kluczu.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const api = vi.hoisted(() => ({
  fetchAdminEvents: vi.fn(),
  fetchAdminEventCounts: vi.fn(),
  createEventFromType: vi.fn(),
}));

// Klient bazy jest atrapowany wzorcem repozytorium, bo `useEventTypes`
// (zrodlo prawdziwego klucza katalogu rodzajow) ciagnie go w imporcie.
const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc } }));
vi.mock("@/lib/events/eventsListApi", () => api);

import {
  adminEventKeys,
  useAdminEventCounts,
  useAdminEventsList,
  useCreateEventFromType,
} from "@/lib/events/useAdminEvents";
import { eventTypeKeys } from "@/lib/events/useEventTypes";
import { eventCountsQueryArgs, type EventListParams } from "@/lib/events/eventListParams";
import type { AdminEventCounts, EventCreateInput } from "@/lib/events/eventsListApi";

const DRAFTS: EventListParams = { tab: "draft" };
const PUBLISHED: EventListParams = { tab: "published" };

/** Chwila w srodku minuty - sekundy i milisekundy MUSZA zostac odciete. */
const MID_MINUTE = new Date("2026-08-28T12:34:56.789Z");
const SAME_MINUTE_LATER = new Date("2026-08-28T12:34:59.999Z");
const NEXT_MINUTE = new Date("2026-08-28T12:35:00.001Z");

const MINUTE = "2026-08-28T12:34";
const NEXT = "2026-08-28T12:35";

let client: QueryClient;

function wrapper({ children }: { children: ReactNode }) {
  return createElement(QueryClientProvider, { client }, children);
}

function counts(overrides: Partial<AdminEventCounts> = {}): AdminEventCounts {
  return { all: 9, draft: 3, published: 4, cancelled: 1, upcoming: 2, past: 2, ...overrides };
}

function createInput(overrides: Partial<EventCreateInput> = {}): EventCreateInput {
  return {
    eventTypeId: "type-1",
    titlePl: "Sniadanie prasowe",
    titleEn: "Press breakfast",
    startsAt: "2026-09-01T08:00:00Z",
    endsAt: null,
    timezone: null,
    format: null,
    city: null,
    country: null,
    externalRegistrationUrl: null,
    ...overrides,
  };
}

/** Data przekazana do RPC przy n-tym wywolaniu listy. */
function frozenDateOfCall(index: number): Date {
  const call = api.fetchAdminEvents.mock.calls[index];
  if (call === undefined) throw new Error(`lista nie byla wolana ${index + 1} raz`);
  return call[1] as Date;
}

beforeEach(() => {
  vi.clearAllMocks();
  client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  api.fetchAdminEvents.mockResolvedValue([]);
  api.fetchAdminEventCounts.mockResolvedValue(counts());
});

describe("klucze listy i licznikow", () => {
  it("oba klucze wisza pod jednym korzeniem `admin-module-events`", () => {
    // Utworzenie wydarzenia kasuje korzen. Klucz spod innego korzenia
    // przezylby zapis - nowe wydarzenie nie pojawiloby sie na liscie.
    expect(adminEventKeys.all).toEqual(["admin-module-events"]);
    expect(adminEventKeys.list(DRAFTS, MINUTE).slice(0, 1)).toEqual(adminEventKeys.all);
    expect(adminEventKeys.counts(DRAFTS).slice(0, 1)).toEqual(adminEventKeys.all);
  });

  it("lista i liczniki maja ROZLACZNE szuflady przy tych samych filtrach", () => {
    // Wspolny klucz znaczylby, ze tablica wierszy i obiekt licznikow
    // nadpisuja sie nawzajem w jednej szufladzie.
    expect(adminEventKeys.list(DRAFTS, MINUTE)).toEqual([
      "admin-module-events",
      "list",
      DRAFTS,
      MINUTE,
    ]);
    expect(adminEventKeys.counts(DRAFTS)).toEqual([
      "admin-module-events",
      "counts",
      eventCountsQueryArgs(DRAFTS),
    ]);
    expect(adminEventKeys.list(DRAFTS, MINUTE)).not.toEqual(adminEventKeys.counts(DRAFTS));
  });

  it("klucz licznikow NIE niesie zakladki ani strony - inaczej liczby mrugaja do zera", () => {
    // Liczniki podaja WSZYSTKIE zakladki naraz, wiec `eventCountsQueryArgs`
    // swiadomie pomija `tab`, `page` i `size`. Gdy te pola siedzialy w kluczu,
    // przelaczenie zakladki albo strony trafialo w PUSTA szuflade: `data`
    // stawalo sie na moment `undefined`, a `count: countsQ.data?.[tab] ?? 0`
    // w `EventsListManager` pokazywalo szesc zer, po czym liczby wracaly.
    // Asercja porownuje klucze dla ustawien roznicych sie WYLACZNIE tymi polami.
    const first = adminEventKeys.counts({ ...DRAFTS, page: 1 });
    const second = adminEventKeys.counts({ ...DRAFTS, page: 4, size: 50 });
    expect(second).toEqual(first);
    expect(adminEventKeys.counts(PUBLISHED)).toEqual(adminEventKeys.counts(DRAFTS));

    // A filtry, ktore liczniki NAPRAWDE dostaja, klucz nadal rozroznia -
    // inaczej asercja wyzej byla dowodem na to, ze klucz jest staly.
    expect(adminEventKeys.counts({ ...DRAFTS, q: "bruksela" })).not.toEqual(first);
  });

  it("znacznik minuty jest TYLKO w kluczu listy", () => {
    // Klucz licznikow ma trzy segmenty i zadnego zegara - inaczej wszystkie
    // szesc liczb w zakladkach gasloby przy kazdym przejsciu minuty.
    expect(adminEventKeys.counts(DRAFTS)).toHaveLength(3);
    expect(adminEventKeys.counts(DRAFTS)).not.toContain(MINUTE);
    expect(adminEventKeys.list(DRAFTS, MINUTE)).toContain(MINUTE);
  });

  it("rozne zakladki i rozna minuta daja rozne klucze listy", () => {
    expect(adminEventKeys.list(DRAFTS, MINUTE)).not.toEqual(adminEventKeys.list(PUBLISHED, MINUTE));
    expect(adminEventKeys.list(DRAFTS, MINUTE)).not.toEqual(adminEventKeys.list(DRAFTS, NEXT));
  });
});

describe("useAdminEventsList", () => {
  it("granica czasu jedzie do RPC ZAOKRAGLONA W DOL do pelnej minuty", async () => {
    // Sekundy i milisekundy z zegara przegladarki musza zniknac. Znacznik
    // z sekundami dawalby nowy klucz co sekunde - i nowe zapytanie do bazy.
    const { result } = renderHook(() => useAdminEventsList(DRAFTS, MID_MINUTE), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(frozenDateOfCall(0).toISOString()).toBe("2026-08-28T12:34:00.000Z");
  });

  it("filtry ida do RPC bez przerabiania, obok zamrozonej daty", async () => {
    const params: EventListParams = { tab: "upcoming", q: "forum", t: "type-1", page: 2, size: 50 };

    const { result } = renderHook(() => useAdminEventsList(params, MID_MINUTE), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(api.fetchAdminEvents).toHaveBeenCalledTimes(1);
    expect(api.fetchAdminEvents.mock.calls[0]?.[0]).toBe(params);
  });

  it("kolejne rendery W TEJ SAMEJ minucie NIE pytaja bazy drugi raz", async () => {
    // Dokladnie ta petla, przed ktora broni sie naglowek modulu: zegar
    // podawany z zewnatrz zmienia sie przy kazdym renderze ekranu.
    const { result, rerender } = renderHook(
      ({ now }: { now: Date }) => useAdminEventsList(DRAFTS, now),
      { wrapper, initialProps: { now: MID_MINUTE } },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    rerender({ now: SAME_MINUTE_LATER });
    rerender({ now: new Date("2026-08-28T12:34:00.123Z") });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(api.fetchAdminEvents).toHaveBeenCalledTimes(1);
  });

  it("przejscie na kolejna minute pobiera liste PONOWNIE z nowa granica", async () => {
    // Granica „przyszle/przeszle" ma sie przesuwac - zamrozenie jest po to,
    // zeby robila to raz na minute, a nie zeby stanela na zawsze.
    const { result, rerender } = renderHook(
      ({ now }: { now: Date }) => useAdminEventsList(DRAFTS, now),
      { wrapper, initialProps: { now: MID_MINUTE } },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    rerender({ now: NEXT_MINUTE });
    await waitFor(() => expect(api.fetchAdminEvents).toHaveBeenCalledTimes(2));

    expect(frozenDateOfCall(1).toISOString()).toBe("2026-08-28T12:35:00.000Z");
    // Poprzednia minuta zostaje w pamieci podrecznej pod wlasnym kluczem.
    expect(client.getQueryData(adminEventKeys.list(DRAFTS, MINUTE))).toEqual([]);
    expect(client.getQueryData(adminEventKeys.list(DRAFTS, NEXT))).toEqual([]);
  });

  it("zmiana zakladki pobiera OSOBNY zestaw wierszy", async () => {
    api.fetchAdminEvents.mockImplementation((params: EventListParams) =>
      Promise.resolve([{ id: params.tab }]),
    );

    const { result, rerender } = renderHook(
      ({ params }: { params: EventListParams }) => useAdminEventsList(params, MID_MINUTE),
      { wrapper, initialProps: { params: DRAFTS } },
    );
    await waitFor(() => expect(result.current.data).toEqual([{ id: "draft" }]));

    rerender({ params: PUBLISHED });
    await waitFor(() => expect(result.current.data).toEqual([{ id: "published" }]));

    expect(client.getQueryData(adminEventKeys.list(DRAFTS, MINUTE))).toEqual([{ id: "draft" }]);
    expect(api.fetchAdminEvents).toHaveBeenCalledTimes(2);
  });

  it("ODMOWA DOSTEPU nie zostawia na ekranie wierszy z poprzedniej zakladki", async () => {
    // Lista modulu pokazuje wydarzenia, do ktorych wolajacy ma prawo. Gdyby
    // hook trzymal poprzednie dane przy zmianie klucza, odmowa RPC dla
    // wezszego filtra narysowalaby wiersze pobrane wczesniej - bez zadnego
    // komunikatu, ze zapytanie w ogole sie nie powiodlo.
    const mine = [{ id: "evt-moje" }];
    api.fetchAdminEvents.mockResolvedValueOnce(mine);
    api.fetchAdminEvents.mockRejectedValueOnce(new Error("insufficient_privilege"));

    const { result, rerender } = renderHook(
      ({ params }: { params: EventListParams }) => useAdminEventsList(params, MID_MINUTE),
      { wrapper, initialProps: { params: DRAFTS } },
    );
    await waitFor(() => expect(result.current.data).toBe(mine));

    rerender({ params: PUBLISHED });
    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(result.current.error?.message).toBe("insufficient_privilege");
    expect(result.current.data).toBeUndefined();
    expect(client.getQueryData(adminEventKeys.list(PUBLISHED, MINUTE))).toBeUndefined();
  });

  it("PUSTA lista jest poprawnym wynikiem, nie stanem ladowania", async () => {
    // Ekran rozroznia „nie ma szkicow" od „jeszcze nie wiem" - to dwa rozne
    // widoki (pusty stan z przyciskiem kontra szkielet).
    api.fetchAdminEvents.mockResolvedValue([]);

    const { result } = renderHook(() => useAdminEventsList(DRAFTS, MID_MINUTE), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toEqual([]);
    expect(result.current.isPending).toBe(false);
  });

  it("lista zostaje swieza przez 15 sekund", async () => {
    // Powrot z edycji wydarzenia nie moze bic w baze przy kazdym wejsciu.
    const first = renderHook(() => useAdminEventsList(DRAFTS, MID_MINUTE), { wrapper });
    await waitFor(() => expect(first.result.current.isSuccess).toBe(true));
    first.unmount();

    const second = renderHook(() => useAdminEventsList(DRAFTS, MID_MINUTE), { wrapper });
    await waitFor(() => expect(second.result.current.isSuccess).toBe(true));

    expect(api.fetchAdminEvents).toHaveBeenCalledTimes(1);
  });
});

describe("useAdminEventCounts", () => {
  it("liczniki jada do RPC z tymi samymi filtrami i ladują pod wlasnym kluczem", async () => {
    const totals = counts({ draft: 7 });
    api.fetchAdminEventCounts.mockResolvedValue(totals);

    const { result } = renderHook(() => useAdminEventCounts(DRAFTS), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(api.fetchAdminEventCounts).toHaveBeenCalledExactlyOnceWith(DRAFTS);
    expect(result.current.data).toBe(totals);
    expect(client.getQueryData(adminEventKeys.counts(DRAFTS))).toBe(totals);
  });

  it("liczniki NIE odswiezaja sie przy przejsciu minuty, a lista tak", async () => {
    // Sedno rozdzielenia obu zapytan. Gdyby liczniki dzielily klucz z lista
    // (albo tylko przejely jej znacznik minuty), wszystkie szesc liczb
    // w zakladkach znikaloby na czas pobrania co minute.
    const { result, rerender } = renderHook(
      ({ now }: { now: Date }) => ({
        list: useAdminEventsList(DRAFTS, now),
        counts: useAdminEventCounts(DRAFTS),
      }),
      { wrapper, initialProps: { now: MID_MINUTE } },
    );
    await waitFor(() => expect(result.current.counts.isSuccess).toBe(true));

    rerender({ now: NEXT_MINUTE });
    await waitFor(() => expect(api.fetchAdminEvents).toHaveBeenCalledTimes(2));

    expect(api.fetchAdminEventCounts).toHaveBeenCalledTimes(1);
    expect(result.current.counts.data).toEqual(counts());
    expect(result.current.counts.isFetching).toBe(false);
  });

  it("blad licznikow nie kasuje listy - i odwrotnie", async () => {
    // Dwa zapytania znacza dwie niezalezne awarie: brak liczb w zakladkach
    // nie moze zabrac redaktorowi wierszy, ktore juz przyszly.
    api.fetchAdminEvents.mockResolvedValue([{ id: "evt-1" }]);
    api.fetchAdminEventCounts.mockRejectedValue(new Error("counts_timeout"));

    const { result } = renderHook(
      () => ({ list: useAdminEventsList(DRAFTS, MID_MINUTE), counts: useAdminEventCounts(DRAFTS) }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.counts.isError).toBe(true));
    await waitFor(() => expect(result.current.list.isSuccess).toBe(true));

    expect(result.current.list.data).toEqual([{ id: "evt-1" }]);
    expect(result.current.counts.data).toBeUndefined();
  });
});

describe("useCreateEventFromType", () => {
  it("oddaje warstwie RPC caly formularz i zwraca identyfikator wydarzenia", async () => {
    // Ekran kreatora przechodzi na `/admin/events/<id>` na podstawie
    // ZWROCONEGO identyfikatora - zgubiony wynik konczy sie martwym linkiem.
    const input = createInput({ externalRegistrationUrl: "https://example.org/zapisy" });
    api.createEventFromType.mockResolvedValue("evt-nowe");

    const { result } = renderHook(() => useCreateEventFromType(), { wrapper });
    const id = await result.current.mutateAsync(input);

    // Funkcja RPC jest podana WPROST jako `mutationFn`, wiec TanStack dokłada
    // jej drugi argument z kontekstem mutacji - liczy sie pierwszy.
    expect(api.createEventFromType).toHaveBeenCalledTimes(1);
    expect(api.createEventFromType.mock.calls[0]?.[0]).toBe(input);
    expect(id).toBe("evt-nowe");
  });

  it("sukces kasuje TRZY galezie: wydarzenia, katalog rodzajow i liste spolecznosci", async () => {
    // Trzy osobne linie `onSuccess`, kazda dla innego ekranu. Skasowanie
    // srodkowej zostawia w katalogu rodzajow stary licznik uzycia - a razem
    // z nim odblokowany kosz przy rodzaju, ktory wlasnie zostal uzyty.
    api.createEventFromType.mockResolvedValue("evt-1");
    const invalidate = vi.spyOn(client, "invalidateQueries").mockResolvedValue(undefined);

    const { result } = renderHook(() => useCreateEventFromType(), { wrapper });
    await result.current.mutateAsync(createInput());

    expect(invalidate.mock.calls.map((call) => call[0]?.queryKey)).toEqual([
      adminEventKeys.all,
      eventTypeKeys.all,
      ["admin-community-events"],
    ]);
  });

  it("klucz katalogu rodzajow pochodzi z modulu rodzajow, a nie z przepisanej stalej", () => {
    // Gdyby `eventTypeKeys.all` zmienil ksztalt, uniewaznienie przestaloby
    // trafiac w katalog rodzajow - i nic by o tym nie krzyknelo.
    expect(eventTypeKeys.all).toEqual(["event-types"]);
    expect(eventTypeKeys.all).not.toEqual(adminEventKeys.all);
  });

  it("NIEUDANE tworzenie niczego nie kasuje", async () => {
    // Baza odrzuca rodzaj `external` bez adresu zapisow. Kasowanie pamieci
    // po odmowie kazaloby pobrac te same dane i wygladaloby jak sukces.
    api.createEventFromType.mockRejectedValue(new Error("external_url_required"));
    const invalidate = vi.spyOn(client, "invalidateQueries").mockResolvedValue(undefined);

    const { result } = renderHook(() => useCreateEventFromType(), { wrapper });
    await expect(result.current.mutateAsync(createInput())).rejects.toThrow(
      "external_url_required",
    );

    expect(invalidate).not.toHaveBeenCalled();
  });

  it("po utworzeniu lista I liczniki pobieraja sie ponownie BEZ odswiezenia strony", async () => {
    // Sprawdzenie skutku, a nie samego wywolania: korzen `adminEventKeys.all`
    // musi obejmowac obie galezie naraz. Uniewaznienie samego klucza listy
    // przeszloby test wyzej i zostawiloby zakladki z za mala liczba.
    api.fetchAdminEvents.mockResolvedValue([]);
    api.createEventFromType.mockResolvedValue("evt-nowe");

    const { result } = renderHook(
      () => ({
        list: useAdminEventsList(DRAFTS, MID_MINUTE),
        counts: useAdminEventCounts(DRAFTS),
        create: useCreateEventFromType(),
      }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.list.isSuccess).toBe(true));
    await waitFor(() => expect(result.current.counts.isSuccess).toBe(true));

    api.fetchAdminEvents.mockResolvedValue([{ id: "evt-nowe" }]);
    api.fetchAdminEventCounts.mockResolvedValue(counts({ all: 10, draft: 4 }));
    await result.current.create.mutateAsync(createInput());

    await waitFor(() => expect(result.current.list.data).toEqual([{ id: "evt-nowe" }]));
    await waitFor(() => expect(result.current.counts.data?.draft).toBe(4));
    expect(api.fetchAdminEvents).toHaveBeenCalledTimes(2);
    expect(api.fetchAdminEventCounts).toHaveBeenCalledTimes(2);
  });
});
