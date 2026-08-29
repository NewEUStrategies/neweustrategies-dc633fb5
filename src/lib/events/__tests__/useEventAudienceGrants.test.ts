// Hooki NADAN STAWEK (akademicka, NGO, firmowa): klucze pamieci podrecznej,
// brama `enabled` dziennika i zasieg uniewaznienia po zapisie.
//
// PO CO TEN PLIK ISTNIEJE. To sa hooki UPRAWNIENIOWE - wiersz nadania mowi
// „ta osoba placi mniej i oto podstawa". Trzy klasy bledow, ktorych nie zlapie
// zaden test renderujacy panel nadan.
//
// 1) KLUCZ, KTORY SIE ZLEWA Z INNYM, POKAZUJE CUDZE NADANIA. Klucz jest
//    sklejany z segmentow filtra (wydarzenie, grupa odbiorcow, „z wycofanymi",
//    fraza). Zgubiony segment niczego nie wywala przy kompilacji - po prostu
//    widok „tylko aktywne" zaczyna rysowac wiersze pobrane dla widoku
//    „z wycofanymi", a filtr „akademicka" pokazuje nadania firmowe. Klucze sa
//    tu asercja same w sobie.
//
// 2) UNIEWAZNIENIE, KTORE NIE SIEGA DZIENNIKA, ZOSTAWIA AUDYT KLAMIACY.
//    Naglowek modulu obiecuje, ze zapis nadania rusza JEDNOCZESNIE liste
//    i historie zmian, bo dziennik zmienia sie wylacznie jako skutek zapisu.
//    Obietnica zyje w jednej prywatnej funkcji `useInvalidate` - skasowanie
//    jednej z dwoch linii nie psuje niczego widocznego od razu.
//
// 3) DZIENNIK POBRANY MIMO WYLACZENIA. `useAudienceGrantHistory` ma bramę
//    `enabled`, ktorej panel uzywa do zakladki audytu. Brama, ktora nie
//    dziala, oznacza zapytanie o dziennik rozliczen wysylane przy kazdym
//    wejsciu na ekran nadan.
//
// Zaleznoscia jest tu `audienceGrantsApi` (siec) - i tylko ona jest atrapa.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const api = vi.hoisted(() => ({
  fetchAudienceGrants: vi.fn(),
  fetchAudienceGrantHistory: vi.fn(),
  saveAudienceGrant: vi.fn(),
  revokeAudienceGrant: vi.fn(),
}));

vi.mock("@/lib/events/audienceGrantsApi", () => api);

import {
  audienceGrantHistoryKeys,
  audienceGrantKeys,
  useAudienceGrantHistory,
  useAudienceGrants,
  useRevokeAudienceGrant,
  useSaveAudienceGrant,
} from "@/lib/events/useEventAudienceGrants";
import type {
  AudienceGrantHistoryQuery,
  AudienceGrantInput,
  AudienceGrantsQuery,
} from "@/lib/events/audienceGrantsApi";

const EVENT = "evt-1";
const OTHER_EVENT = "evt-2";

let client: QueryClient;

function wrapper({ children }: { children: ReactNode }) {
  return createElement(QueryClientProvider, { client }, children);
}

function grantsQuery(overrides: Partial<AudienceGrantsQuery> = {}): AudienceGrantsQuery {
  return { eventId: EVENT, audience: "all", includeRevoked: false, search: "", ...overrides };
}

function historyQuery(
  overrides: Partial<AudienceGrantHistoryQuery> = {},
): AudienceGrantHistoryQuery {
  return { eventId: EVENT, grantId: null, search: "", limit: 50, ...overrides };
}

function grantInput(overrides: Partial<AudienceGrantInput> = {}): AudienceGrantInput {
  return {
    audience: "academic",
    userId: "usr-1",
    personId: null,
    companyId: null,
    eventId: EVENT,
    evidence: "legitymacja 123",
    validUntil: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  api.fetchAudienceGrants.mockResolvedValue([]);
  api.fetchAudienceGrantHistory.mockResolvedValue([]);
});

describe("klucze listy nadan", () => {
  it("kazdy klucz filtra wisi pod korzeniem `event-audience-grants`", () => {
    // Uniewaznienie po mutacji kasuje `audienceGrantKeys.all`. Klucz, ktory
    // wypadlby spod tego korzenia, przezylby wycofanie nadania - panel dalej
    // pokazywalby stawke, ktorej juz nie ma.
    expect(audienceGrantKeys.all).toEqual(["event-audience-grants"]);
    expect(audienceGrantKeys.list(grantsQuery()).slice(0, 1)).toEqual(audienceGrantKeys.all);
    expect(audienceGrantKeys.list(grantsQuery())).toEqual([
      "event-audience-grants",
      EVENT,
      "all",
      "active",
      "",
    ]);
  });

  it("nadanie na CALEGO najemcy dostaje segment `all`, a nie pusty", () => {
    // `eventId: null` znaczy „obowiazuje we wszystkich wydarzeniach". Bez
    // segmentu zastepczego klucz skrocilby sie o jedna pozycje i zlalby sie
    // z kluczem listy innego filtra.
    expect(audienceGrantKeys.list(grantsQuery({ eventId: null }))).toEqual([
      "event-audience-grants",
      "all",
      "all",
      "active",
      "",
    ]);
  });

  it("lista najemcy i lista wydarzenia NIE dziela jednej szuflady", () => {
    expect(audienceGrantKeys.list(grantsQuery({ eventId: null }))).not.toEqual(
      audienceGrantKeys.list(grantsQuery({ eventId: EVENT })),
    );
    expect(audienceGrantKeys.list(grantsQuery({ eventId: OTHER_EVENT }))).not.toEqual(
      audienceGrantKeys.list(grantsQuery({ eventId: EVENT })),
    );
  });

  it("widok Z WYCOFANYMI ma inna szuflade niz widok tylko aktywnych", () => {
    // Zlanie tych dwoch kluczy jest wyciekiem widocznym golym okiem: lista
    // „aktywne" narysowalaby nadania wycofane, czyli stawki, ktore juz nie
    // przysluguja.
    const active = audienceGrantKeys.list(grantsQuery({ includeRevoked: false }));
    const withRevoked = audienceGrantKeys.list(grantsQuery({ includeRevoked: true }));

    expect(active).toContain("active");
    expect(withRevoked).toContain("with-revoked");
    expect(active).not.toEqual(withRevoked);
  });

  it("kazda grupa odbiorcow ma WLASNA szuflade", () => {
    // Filtr „akademicka" pokazujacy nadania firmowe to nie kosmetyka, tylko
    // zla podstawa rozliczenia na ekranie organizatora.
    const academic = audienceGrantKeys.list(grantsQuery({ audience: "academic" }));
    const company = audienceGrantKeys.list(grantsQuery({ audience: "company" }));
    const every = audienceGrantKeys.list(grantsQuery({ audience: "all" }));

    expect(academic).toContain("academic");
    expect(academic).not.toEqual(company);
    expect(academic).not.toEqual(every);
    expect(company).not.toEqual(every);
  });

  it("fraza jest w kluczu ZNORMALIZOWANA - wpisane z wielkiej litery i ze spacjami to jedno zapytanie", () => {
    expect(audienceGrantKeys.list(grantsQuery({ search: "  Ala  " }))).toEqual(
      audienceGrantKeys.list(grantsQuery({ search: "ala" })),
    );
    expect(audienceGrantKeys.list(grantsQuery({ search: "ala" }))).not.toEqual(
      audienceGrantKeys.list(grantsQuery({ search: "ola" })),
    );
  });
});

describe("useAudienceGrants", () => {
  it("oddaje warstwie RPC CALY filtr, z fraza w postaci wpisanej przez czlowieka", async () => {
    // Normalizacja frazy nalezy do klucza, a nie do zapytania - przycinaniem
    // zajmuje sie warstwa RPC. Hook nie moze podmieniac tego, co wpisano.
    const query = grantsQuery({ search: "  Ala  ", audience: "ngo", includeRevoked: true });
    const rows = [{ id: "grant-1" }];
    api.fetchAudienceGrants.mockResolvedValue(rows);

    const { result } = renderHook(() => useAudienceGrants(query), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(api.fetchAudienceGrants).toHaveBeenCalledExactlyOnceWith(query);
    expect(result.current.data).toBe(rows);
    expect(client.getQueryData(audienceGrantKeys.list(query))).toBe(rows);
  });

  it("PUSTA lista nadan jest poprawnym wynikiem, nie stanem ladowania", async () => {
    // Panel rozroznia „nikt nie ma stawki zniżkowej" od „jeszcze nie wiem".
    api.fetchAudienceGrants.mockResolvedValue([]);

    const { result } = renderHook(() => useAudienceGrants(grantsQuery()), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toEqual([]);
    expect(result.current.isPending).toBe(false);
  });

  it("ODMOWA UPRAWNIEN nie podstawia wynikow poprzedniego filtra", async () => {
    // Najwazniejszy przypadek tego pliku. Gdyby hook trzymal poprzednie dane
    // przy zmianie klucza (`placeholderData`), odmowa dostępu do nadan innego
    // wydarzenia narysowalaby liste, ktorej wolajacy nie ma prawa zobaczyc -
    // i to bez zadnego komunikatu o bledzie.
    const mine = [{ id: "grant-moje" }];
    api.fetchAudienceGrants.mockResolvedValueOnce(mine);
    api.fetchAudienceGrants.mockRejectedValueOnce(new Error("brak uprawnien"));

    const { result, rerender } = renderHook(
      ({ eventId }: { eventId: string }) => useAudienceGrants(grantsQuery({ eventId })),
      { wrapper, initialProps: { eventId: EVENT } },
    );
    await waitFor(() => expect(result.current.data).toBe(mine));

    rerender({ eventId: OTHER_EVENT });
    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(result.current.error?.message).toBe("brak uprawnien");
    expect(result.current.data).toBeUndefined();
    // Wlasna szuflada wolajacego zostaje nietknieta - odmowa dotyczy JEDNEGO
    // filtra, a nie calej pamieci podrecznej.
    expect(client.getQueryData(audienceGrantKeys.list(grantsQuery({ eventId: EVENT })))).toBe(mine);
    expect(
      client.getQueryData(audienceGrantKeys.list(grantsQuery({ eventId: OTHER_EVENT }))),
    ).toBeUndefined();
  });

  it("lista nadan zostaje swieza przez 30 sekund", async () => {
    // Panel nadan jest zakladka obok listy zgloszen; przelaczanie tam i z
    // powrotem nie moze bic w baze przy kazdym klikniciu.
    const first = renderHook(() => useAudienceGrants(grantsQuery()), { wrapper });
    await waitFor(() => expect(first.result.current.isSuccess).toBe(true));
    first.unmount();

    const second = renderHook(() => useAudienceGrants(grantsQuery()), { wrapper });
    await waitFor(() => expect(second.result.current.isSuccess).toBe(true));

    expect(api.fetchAudienceGrants).toHaveBeenCalledTimes(1);
  });
});

describe("klucze dziennika nadan", () => {
  it("dziennik ma WLASNY korzen, rozlaczny z lista nadan", () => {
    // Wspolny korzen znaczylby, ze uniewaznienie listy kasuje takze dziennik
    // (i odwrotnie) - a wtedy druga linia `useInvalidate` bylaby martwa
    // i nikt by nie zauwazyl jej skasowania.
    expect(audienceGrantHistoryKeys.all).toEqual(["event-audience-grant-history"]);
    expect(audienceGrantHistoryKeys.all).not.toEqual(audienceGrantKeys.all);
    expect(audienceGrantHistoryKeys.list(historyQuery()).slice(0, 1)).toEqual(
      audienceGrantHistoryKeys.all,
    );
  });

  it("brak wydarzenia i brak nadania daja segmenty `all`", () => {
    // Dwa niezalezne zawezenia: „historia calego najemcy" i „sciezka jednego
    // uprawnienia". Bez segmentow zastepczych klucz „wszystko" skrocilby sie
    // i zaczal sie zlewac z kluczem konkretnej sciezki.
    expect(audienceGrantHistoryKeys.list(historyQuery({ eventId: null, grantId: null }))).toEqual([
      "event-audience-grant-history",
      "all",
      "all",
      "",
      50,
    ]);
  });

  it("historia JEDNEGO nadania nie dziela szuflady z historia wszystkich", () => {
    expect(audienceGrantHistoryKeys.list(historyQuery({ grantId: "grant-7" }))).not.toEqual(
      audienceGrantHistoryKeys.list(historyQuery({ grantId: null })),
    );
    expect(audienceGrantHistoryKeys.list(historyQuery({ grantId: "grant-7" }))).toContain(
      "grant-7",
    );
  });

  it("limit jest CZESCIA klucza - 20 ostatnich wpisow to nie to samo co 200", () => {
    // Bez limitu w kluczu zwiekszenie „pokaz wiecej" oddaloby z pamieci
    // podrecznej poprzednia, krotsza liste i przycisk wygladalby na zepsuty.
    expect(audienceGrantHistoryKeys.list(historyQuery({ limit: 20 }))).not.toEqual(
      audienceGrantHistoryKeys.list(historyQuery({ limit: 200 })),
    );
  });

  it("fraza dziennika jest normalizowana tak samo jak fraza listy", () => {
    expect(audienceGrantHistoryKeys.list(historyQuery({ search: " KOWALSKI " }))).toEqual(
      audienceGrantHistoryKeys.list(historyQuery({ search: "kowalski" })),
    );
  });
});

describe("useAudienceGrantHistory", () => {
  it("bez drugiego argumentu dziennik jest WLACZONY", async () => {
    // Panel historii wola hook z jednym argumentem. Gdyby domyslna wartosc
    // `enabled` byla `false`, zakladka audytu zostalaby pusta na zawsze.
    const rows = [{ id: "audit-1" }];
    api.fetchAudienceGrantHistory.mockResolvedValue(rows);
    const query = historyQuery();

    const { result } = renderHook(() => useAudienceGrantHistory(query), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(api.fetchAudienceGrantHistory).toHaveBeenCalledExactlyOnceWith(query);
    expect(result.current.data).toBe(rows);
  });

  it("WYLACZONY dziennik nie pyta bazy o audyt rozliczen", async () => {
    // Brama dla wolajacego bez prawa do audytu (albo dla zwinietej zakladki):
    // sprawdzamy, ze zapytanie NIE poszlo i ze na wyjsciu nie ma zadnych
    // wierszy - nie tylko ze hook nie rzucil.
    const { result } = renderHook(() => useAudienceGrantHistory(historyQuery(), false), {
      wrapper,
    });

    await waitFor(() => expect(result.current.fetchStatus).toBe("idle"));
    expect(api.fetchAudienceGrantHistory).not.toHaveBeenCalled();
    expect(result.current.data).toBeUndefined();
    expect(result.current.isPending).toBe(true);
    expect(client.getQueryData(audienceGrantHistoryKeys.list(historyQuery()))).toBeUndefined();
  });

  it("otwarcie zakladki PO wejsciu na ekran uruchamia pobranie dziennika", async () => {
    const { result, rerender } = renderHook(
      ({ enabled }: { enabled: boolean }) => useAudienceGrantHistory(historyQuery(), enabled),
      { wrapper, initialProps: { enabled: false } },
    );
    expect(api.fetchAudienceGrantHistory).not.toHaveBeenCalled();

    rerender({ enabled: true });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(api.fetchAudienceGrantHistory).toHaveBeenCalledExactlyOnceWith(historyQuery());
  });

  it("blad dziennika dociera do ekranu jako blad, a nie jako pusta historia", async () => {
    // „Brak wpisow" i „nie wolno ci ich zobaczyc" to dwa rozne komunikaty.
    api.fetchAudienceGrantHistory.mockRejectedValue(new Error("brak dostepu do audytu"));

    const { result } = renderHook(() => useAudienceGrantHistory(historyQuery()), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(result.current.error?.message).toBe("brak dostepu do audytu");
    expect(result.current.data).toBeUndefined();
  });
});

describe("mutacje nadan - argumenty i wynik", () => {
  it("zapis oddaje warstwie RPC caly formularz i zwraca identyfikator nadania", async () => {
    const input = grantInput({ validUntil: "2026-12-31T23:59:59Z" });
    api.saveAudienceGrant.mockResolvedValue("grant-77");

    const { result } = renderHook(() => useSaveAudienceGrant(), { wrapper });
    const id = await result.current.mutateAsync(input);

    // Mutacja podaje funkcje RPC WPROST jako `mutationFn`, wiec TanStack
    // dokłada jej drugi argument z kontekstem mutacji - liczy sie pierwszy.
    expect(api.saveAudienceGrant).toHaveBeenCalledTimes(1);
    expect(api.saveAudienceGrant.mock.calls[0]?.[0]).toBe(input);
    // Formularz zamyka okno na podstawie ZWROCONEGO identyfikatora.
    expect(id).toBe("grant-77");
    await waitFor(() => expect(result.current.data).toBe("grant-77"));
  });

  it("wycofanie idzie do bazy z identyfikatorem nadania, a nie z calym wierszem", async () => {
    api.revokeAudienceGrant.mockResolvedValue(true);

    const { result } = renderHook(() => useRevokeAudienceGrant(), { wrapper });
    const done = await result.current.mutateAsync("grant-9");

    expect(api.revokeAudienceGrant).toHaveBeenCalledTimes(1);
    expect(api.revokeAudienceGrant.mock.calls[0]?.[0]).toBe("grant-9");
    expect(done).toBe(true);
  });

  it("odrzucony zapis konczy sie bledem mutacji, a nie cichym sukcesem", async () => {
    // Baza wymaga podstawy nadania - odmowa musi dojechac do formularza,
    // inaczej organizator zamknie okno przekonany, ze stawke nadal.
    api.saveAudienceGrant.mockRejectedValue(new Error("evidence_required"));

    const { result } = renderHook(() => useSaveAudienceGrant(), { wrapper });
    await expect(result.current.mutateAsync(grantInput())).rejects.toThrow("evidence_required");
    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(result.current.error?.message).toBe("evidence_required");
  });
});

describe("zasieg uniewaznienia po mutacji", () => {
  it("zapis kasuje OBIE galezie: liste nadan i dziennik", async () => {
    // Dziennik zmienia sie wylacznie jako SKUTEK zapisu, wiec nie ma wlasnego
    // momentu odswiezenia. Skasowanie drugiej linii `useInvalidate` zostawia
    // audyt bez wpisu, ktory wlasnie powstal.
    api.saveAudienceGrant.mockResolvedValue("grant-1");
    const invalidate = vi.spyOn(client, "invalidateQueries").mockResolvedValue(undefined);

    const { result } = renderHook(() => useSaveAudienceGrant(), { wrapper });
    await result.current.mutateAsync(grantInput());

    expect(invalidate.mock.calls.map((call) => call[0]?.queryKey)).toEqual([
      audienceGrantKeys.all,
      audienceGrantHistoryKeys.all,
    ]);
  });

  it("wycofanie kasuje TE SAME dwie galezie co zapis", async () => {
    // `onSuccess` jest dopisany osobno przy kazdej z dwoch mutacji - wspolna
    // funkcja nie gwarantuje, ze obie ja faktycznie wolaja.
    api.revokeAudienceGrant.mockResolvedValue(true);
    const invalidate = vi.spyOn(client, "invalidateQueries").mockResolvedValue(undefined);

    const { result } = renderHook(() => useRevokeAudienceGrant(), { wrapper });
    await result.current.mutateAsync("grant-1");

    expect(invalidate.mock.calls.map((call) => call[0]?.queryKey)).toEqual([
      audienceGrantKeys.all,
      audienceGrantHistoryKeys.all,
    ]);
  });

  it("NIEUDANA mutacja niczego nie kasuje", async () => {
    // Kasowanie pamieci po odmowie kazaloby pobrac dokladnie te same dane
    // i wygladaloby jak „cos sie jednak zapisalo".
    api.revokeAudienceGrant.mockRejectedValue(new Error("nadanie juz wycofane"));
    const invalidate = vi.spyOn(client, "invalidateQueries").mockResolvedValue(undefined);

    const { result } = renderHook(() => useRevokeAudienceGrant(), { wrapper });
    await expect(result.current.mutateAsync("grant-1")).rejects.toThrow("nadanie juz wycofane");

    expect(invalidate).not.toHaveBeenCalled();
  });

  it("po wycofaniu wiersz znika z listy BEZ odswiezenia strony", async () => {
    // Sprawdzenie skutku, a nie samego wywolania: uniewaznienie musi trafic
    // w klucz zamontowanej listy. Klucz spod innego korzenia przeszedlby
    // poprzedni test i zostawilby wycofane nadanie na ekranie.
    api.fetchAudienceGrants.mockResolvedValue([{ id: "grant-1", state: "active" }]);
    api.revokeAudienceGrant.mockResolvedValue(true);

    const { result } = renderHook(
      () => ({ list: useAudienceGrants(grantsQuery()), revoke: useRevokeAudienceGrant() }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.list.isSuccess).toBe(true));

    api.fetchAudienceGrants.mockResolvedValue([]);
    await result.current.revoke.mutateAsync("grant-1");

    await waitFor(() => expect(result.current.list.data).toEqual([]));
    expect(api.fetchAudienceGrants).toHaveBeenCalledTimes(2);
  });

  it("po zapisie dziennik dociaga nowy wpis BEZ odswiezenia strony", async () => {
    api.fetchAudienceGrantHistory.mockResolvedValue([]);
    api.saveAudienceGrant.mockResolvedValue("grant-1");

    const { result } = renderHook(
      () => ({
        history: useAudienceGrantHistory(historyQuery()),
        save: useSaveAudienceGrant(),
      }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.history.isSuccess).toBe(true));

    api.fetchAudienceGrantHistory.mockResolvedValue([{ action: "event_audience_grant.granted" }]);
    await result.current.save.mutateAsync(grantInput());

    await waitFor(() =>
      expect(result.current.history.data).toEqual([{ action: "event_audience_grant.granted" }]),
    );
    expect(api.fetchAudienceGrantHistory).toHaveBeenCalledTimes(2);
  });

  it("uniewaznienie siega KAZDEGO filtra listy, nie tylko otwartego", async () => {
    // Nadanie zmienia wycene wszystkich pakietow i biletow grupy, wiec zapis
    // kasuje CALY korzen - takze widok „z wycofanymi" otwarty w drugiej
    // zakladce. Utrwalony swiadomie szeroki zasieg z naglowka modulu.
    api.saveAudienceGrant.mockResolvedValue("grant-1");

    const { result } = renderHook(
      () => ({
        active: useAudienceGrants(grantsQuery({ includeRevoked: false })),
        withRevoked: useAudienceGrants(grantsQuery({ includeRevoked: true })),
        save: useSaveAudienceGrant(),
      }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.active.isSuccess).toBe(true));
    await waitFor(() => expect(result.current.withRevoked.isSuccess).toBe(true));
    expect(api.fetchAudienceGrants).toHaveBeenCalledTimes(2);

    await result.current.save.mutateAsync(grantInput());

    await waitFor(() => expect(api.fetchAudienceGrants).toHaveBeenCalledTimes(4));
  });
});
