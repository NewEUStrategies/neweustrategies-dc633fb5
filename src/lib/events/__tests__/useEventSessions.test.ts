// Hooki modulu AGENDA: brama `enabled` przy odczycie, ladunek mutacji, stan
// „zapis w toku", odmowa bazy i ZASIEG uniewaznienia pamieci podrecznej.
//
// PO CO TEN PLIK ISTNIEJE. Agenda to SZESC list czytanych pod szescioma
// kluczami (sesje, sciezki, sale, obsada pasma, kolizje, zapisy) plus szczegol
// jednej sesji - a KAZDA z jedenastu mutacji rusza wiecej niz jedna z nich.
// Przypiecie sesji do pasma zmienia liste sesji, licznik `sessions_count`
// sciezki, zajetosc sali i raport kolizji naraz. Trzy klasy bledow, ktorych
// nie zlapie zaden test renderujacy panel:
//
//   1. KLUCZ, KTORY SIE ZLEWA, POKAZUJE PROGRAM CUDZEGO WYDARZENIA. Klucz jest
//      sklejany z identyfikatora wydarzenia; zgubiony segment znaczy, ze ekran
//      kongresu rysuje sesje warsztatu - czyli godziny i sale, ktorych ten
//      program nie ma.
//   2. BRAMA `enabled`, KTORA NIE DZIALA, PYTA BAZE, ZANIM WIADOMO O CO.
//      `null` to stan „jeszcze nie wybrano wydarzenia / sesji / pasma";
//      zapytanie wyslane w tym stanie konczy sie odmowa, ktora panel pokazuje
//      jako czerwone zdanie na ekranie, na ktorym nikt nic jeszcze nie zrobil.
//   3. UNIEWAZNIENIE, KTORE NIE SIEGA WSZYSTKICH LIST, ZOSTAWIA PANEL
//      KLAMIACY. Cala obietnica zyje w JEDNEJ prywatnej funkcji
//      `useInvalidateEvent` - skasowanie jednej z jej dwoch linii nie psuje
//      niczego widocznego od razu, a po minucie organizator planuje na
//      raporcie kolizji sprzed trzech zapisow.
//
// PARA „RUSZA SWOJE / NIE RUSZA CUDZEGO". Kazde uniewaznienie sprawdzamy
// z DRUGIEJ strony: galaz TEGO wydarzenia ma zwietrzec, galaz innego wydarzenia
// ma zostac. Sam dowod „cos sie uniewaznilo" przechodzilby takze dla
// `invalidateQueries()` bez klucza, czyli dla skasowania calej pamieci.
//
// ODMOWY BAZY BIERZEMY DOSLOWNIE Z `scripts/events-harness/runtime_test.d/10_sessions.sql`.
// Kod odmowy podrozuje GLOWA komunikatu wyjatku, wiec hak, ktory polyka wyjatek
// albo zamienia go na pusta liste, odbiera panelowi jedyny kanal, ktorym baza
// tlumaczy „czemu nie". Tabela odmow stoi tu, a nie w panelu, bo dotyczy
// wszystkich piatek kolizji naraz - takze tych, ktorych zaden z paneli agendy
// nie umie sam wywolac (`track_in_use`, `room_conflict`).
//
// CZEGO SWIADOMIE NIE DUBLUJE. (1) Ladunkow RPC - to `sessionsApi.test.ts`;
// tutaj `sessionsApi` jest w calosci atrapa i liczy sie WYLACZNIE styk hakow
// z pamiecia podreczna. (2) Ksztaltu kluczy - `agendaKeys.test.ts`. (3)
// Slownika odmow (`adminAgendaErrors.test.ts`). (4) Paneli - maja wlasne pliki.
//
// RODO: same UUID-y, zero danych osobowych.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { waitFor } from "@testing-library/react";
import type { Mock } from "vitest";
import type { QueryClient, UseMutationResult } from "@tanstack/react-query";

import { renderHookWithQueryClient } from "@/test/renderWithQueryClient";

const api = vi.hoisted(() => ({
  deleteEventRoom: vi.fn(),
  deleteEventSession: vi.fn(),
  deleteEventTrack: vi.fn(),
  fetchAgendaConflicts: vi.fn(),
  fetchEventRooms: vi.fn(),
  fetchEventSessions: vi.fn(),
  fetchEventTrackSpeakers: vi.fn(),
  fetchEventTracks: vi.fn(),
  fetchSessionDetail: vi.fn(),
  fetchSessionSignups: vi.fn(),
  reorderSessions: vi.fn(),
  saveEventRoom: vi.fn(),
  saveEventSession: vi.fn(),
  saveEventTrack: vi.fn(),
  setSessionSignup: vi.fn(),
  setSessionSpeakers: vi.fn(),
  setSessionsStatus: vi.fn(),
  setSessionsTrack: vi.fn(),
}));

// Warstwa sieci jest tu JEDYNA atrapa - reszta to prawdziwy react-query.
vi.mock("@/lib/events/sessionsApi", () => api);

import {
  agendaKeys,
  useAgendaConflicts,
  useDeleteEventRoom,
  useDeleteEventSession,
  useDeleteEventTrack,
  useEventRooms,
  useEventSessions,
  useEventTrackSpeakers,
  useEventTracks,
  useReorderSessions,
  useSaveEventRoom,
  useSaveEventSession,
  useSaveEventTrack,
  useSessionDetail,
  useSessionSignups,
  useSetSessionSignup,
  useSetSessionSpeakers,
  useSetSessionsStatus,
  useSetSessionsTrack,
} from "@/lib/events/useEventSessions";
import type {
  AgendaConflictRow,
  EventRoomInput,
  EventRoomRow,
  EventSessionInput,
  EventSessionRow,
  EventSessionSignupRow,
  EventTrackInput,
  EventTrackRow,
  EventTrackSpeakerRow,
  SessionOrderItem,
  SessionSpeakerInput,
  SessionsQuery,
} from "@/lib/events/sessionsApi";

const WYDARZENIE = "11111111-1111-4111-8111-111111111111";
const INNE_WYDARZENIE = "99999999-9999-4999-8999-999999999999";
const SESJA = "22222222-2222-4222-8222-222222222222";
const OBCA_SESJA = "88888888-8888-4888-8888-888888888888";
const SCIEZKA = "33333333-3333-4333-8333-333333333333";
const SALA = "44444444-4444-4444-8444-444444444444";
const PRELEGENT = "55555555-5555-4555-8555-555555555555";
const UCZESTNIK = "66666666-6666-4666-8666-666666666666";

/**
 * Listy trzymamy jako PUSTE tablice o typie wiersza z generatora.
 *
 * Hak nie czyta z wiersza ani jednej kolumny - oddaje go dalej takim, jaki
 * przyszedl. Dowodem jest wiec TOZSAMOSC obiektu i klucz, pod ktorym wyladowal,
 * a nie tresc kolumn; te maja wlasne pliki (`sessionsApi.test.ts`, panele).
 */
const LISTA_SESJI: EventSessionRow[] = [];
const LISTA_SCIEZEK: EventTrackRow[] = [];
const LISTA_SAL: EventRoomRow[] = [];
const LISTA_OBSADY: EventTrackSpeakerRow[] = [];
const LISTA_KOLIZJI: AgendaConflictRow[] = [];
const LISTA_ZAPISOW: EventSessionSignupRow[] = [];

const FILTR: SessionsQuery = {
  eventId: WYDARZENIE,
  status: "all",
  trackId: null,
  roomId: null,
  q: "",
};

const PORZADEK: SessionOrderItem[] = [{ id: SESJA, sortOrder: 10 }];

const OBSADA: SessionSpeakerInput[] = [
  { speakerProfileId: PRELEGENT, role: "speaker", sortOrder: 10, allowOverlap: false },
];

const WEJSCIE_SESJI: EventSessionInput = {
  id: SESJA,
  eventId: WYDARZENIE,
  titlePl: "Otwarcie",
  titleEn: "Opening",
  descriptionPl: "",
  descriptionEn: "",
  startsAt: "2026-09-01T09:00:00+02:00",
  endsAt: "2026-09-01T10:00:00+02:00",
  format: "onsite",
  status: "published",
  trackId: SCIEZKA,
  roomId: SALA,
  parentSessionId: null,
  requiresSignup: true,
  capacity: 20,
  minTierRank: 0,
  chathamHouse: false,
  isPrivate: false,
  allowOverlap: false,
  streamUrl: null,
  recordingUrl: null,
  sortOrder: 10,
};

const WEJSCIE_SCIEZKI: EventTrackInput = {
  id: SCIEZKA,
  eventId: WYDARZENIE,
  key: "cyber",
  namePl: "Cyfrowa",
  nameEn: "Digital",
  accentColor: "#fa9346",
  taglinePl: null,
  taglineEn: null,
  descriptionPl: null,
  descriptionEn: null,
  coverUrl: null,
  defaultRoomId: null,
  sortOrder: 10,
  isActive: true,
  isPublic: true,
};

const WEJSCIE_SALI: EventRoomInput = {
  id: SALA,
  eventId: WYDARZENIE,
  name: "Sala Krakow",
  capacity: 20,
  floor: null,
  locationNote: null,
  sortOrder: 10,
  isActive: true,
};

const WEJSCIE_STANU = { ids: [SESJA], status: "published" } as const;
const WEJSCIE_PASMA = { ids: [SESJA], trackId: SCIEZKA };
const WEJSCIE_OBSADY = { sessionId: SESJA, speakers: OBSADA };
const WEJSCIE_ZAPISU = {
  sessionId: SESJA,
  userId: UCZESTNIK,
  status: "registered",
  force: false,
} as const;

/** Odmowa, ktora baza wystawia edytorowi bez roli - komunikat jedzie w wyjatku. */
const ODMOWA = new Error("forbidden: event editor role required");

/** Sterowana obietnica - do dowodu na stan „zapis w toku". */
function odroczona<T>(): { promise: Promise<T>; spelnij: (value: T) => void } {
  let spelnij: (value: T) => void = () => undefined;
  const promise = new Promise<T>((resolve) => {
    spelnij = resolve;
  });
  return { promise, spelnij };
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
  api.fetchEventSessions.mockResolvedValue(LISTA_SESJI);
  api.fetchEventTracks.mockResolvedValue(LISTA_SCIEZEK);
  api.fetchEventRooms.mockResolvedValue(LISTA_SAL);
  api.fetchEventTrackSpeakers.mockResolvedValue(LISTA_OBSADY);
  api.fetchAgendaConflicts.mockResolvedValue(LISTA_KOLIZJI);
  api.fetchSessionSignups.mockResolvedValue(LISTA_ZAPISOW);
  api.fetchSessionDetail.mockResolvedValue(null);
  api.saveEventSession.mockResolvedValue(SESJA);
  api.deleteEventSession.mockResolvedValue(true);
  api.reorderSessions.mockResolvedValue(2);
  api.setSessionsStatus.mockResolvedValue(1);
  api.setSessionsTrack.mockResolvedValue(3);
  api.saveEventTrack.mockResolvedValue(SCIEZKA);
  api.deleteEventTrack.mockResolvedValue(true);
  api.saveEventRoom.mockResolvedValue(SALA);
  api.deleteEventRoom.mockResolvedValue(true);
  api.setSessionSpeakers.mockResolvedValue(1);
  api.setSessionSignup.mockResolvedValue({ status: "registered" });
});

/* ------------------------------------------------------------------ odczyt --- */

describe("brama `enabled` - para „pyta / nie pyta”", () => {
  it("lista sesji z filtrem IDZIE do bazy i laduje pod kluczem CALEGO filtra", async () => {
    const { result, queryClient } = renderHookWithQueryClient(() => useEventSessions(FILTR));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(api.fetchEventSessions).toHaveBeenCalledExactlyOnceWith(FILTR);
    expect(queryClient.getQueryData(agendaKeys.sessions(FILTR))).toBe(LISTA_SESJI);
  });

  // `null` TO STAN „JESZCZE NIE WIADOMO, KTORE WYDARZENIE" - warsztat pasma
  // montuje sie zanim trasa poda identyfikator.
  it("lista sesji dla `null` nie rusza do bazy i nie sadzi nic w pamieci", async () => {
    const { result, queryClient } = renderHookWithQueryClient(() => useEventSessions(null));
    await waitFor(() => expect(result.current.fetchStatus).toBe("idle"));

    expect(api.fetchEventSessions).not.toHaveBeenCalled();
    expect(queryClient.getQueryData(agendaKeys.sessions(null))).toBeUndefined();
  });

  // DWA FILTRY TO DWIE ROZNE ODPOWIEDZI BAZY. Wspolny klucz pokazywalby po
  // zmianie filtra sesje poprzedniego zapytania - czyli program, ktorego filtr
  // wlasnie nie przepuszcza.
  it("zmiana filtra to NOWE zapytanie, a nie podmiana danych pod tym samym kluczem", async () => {
    const stan = { filtr: FILTR };
    const { result, rerender, queryClient } = renderHookWithQueryClient(() =>
      useEventSessions(stan.filtr),
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const wezszy: SessionsQuery = { ...FILTR, trackId: SCIEZKA };
    stan.filtr = wezszy;
    rerender();
    await waitFor(() => expect(api.fetchEventSessions).toHaveBeenCalledTimes(2));

    expect(api.fetchEventSessions).toHaveBeenLastCalledWith(wezszy);
    expect(agendaKeys.sessions(wezszy)).not.toEqual(agendaKeys.sessions(FILTR));
    expect(queryClient.getQueryData(agendaKeys.sessions(wezszy))).toBe(LISTA_SESJI);
  });

  it("sciezki z identyfikatorem wydarzenia IDA do bazy", async () => {
    const { result, queryClient } = renderHookWithQueryClient(() => useEventTracks(WYDARZENIE));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(api.fetchEventTracks).toHaveBeenCalledExactlyOnceWith(WYDARZENIE);
    expect(queryClient.getQueryData(agendaKeys.tracks(WYDARZENIE))).toBe(LISTA_SCIEZEK);
  });

  it("sciezki dla `null` nie ruszaja do bazy", async () => {
    const { result } = renderHookWithQueryClient(() => useEventTracks(null));
    await waitFor(() => expect(result.current.fetchStatus).toBe("idle"));

    expect(api.fetchEventTracks).not.toHaveBeenCalled();
  });

  it("sale z identyfikatorem wydarzenia IDA do bazy", async () => {
    const { result, queryClient } = renderHookWithQueryClient(() => useEventRooms(WYDARZENIE));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(api.fetchEventRooms).toHaveBeenCalledExactlyOnceWith(WYDARZENIE);
    expect(queryClient.getQueryData(agendaKeys.rooms(WYDARZENIE))).toBe(LISTA_SAL);
  });

  it("sale dla `null` nie ruszaja do bazy", async () => {
    const { result } = renderHookWithQueryClient(() => useEventRooms(null));
    await waitFor(() => expect(result.current.fetchStatus).toBe("idle"));

    expect(api.fetchEventRooms).not.toHaveBeenCalled();
  });

  it("obsada pasma z identyfikatorem SCIEZKI idzie do bazy", async () => {
    const { result, queryClient } = renderHookWithQueryClient(() => useEventTrackSpeakers(SCIEZKA));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(api.fetchEventTrackSpeakers).toHaveBeenCalledExactlyOnceWith(SCIEZKA);
    expect(queryClient.getQueryData(agendaKeys.trackSpeakers(SCIEZKA))).toBe(LISTA_OBSADY);
  });

  it("obsada pasma dla `null` nie rusza do bazy - lista pasm nie ma otwartego pasma", async () => {
    const { result } = renderHookWithQueryClient(() => useEventTrackSpeakers(null));
    await waitFor(() => expect(result.current.fetchStatus).toBe("idle"));

    expect(api.fetchEventTrackSpeakers).not.toHaveBeenCalled();
  });

  it("raport kolizji z identyfikatorem wydarzenia idzie do bazy", async () => {
    const { result, queryClient } = renderHookWithQueryClient(() => useAgendaConflicts(WYDARZENIE));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(api.fetchAgendaConflicts).toHaveBeenCalledExactlyOnceWith(WYDARZENIE);
    expect(queryClient.getQueryData(agendaKeys.conflicts(WYDARZENIE))).toBe(LISTA_KOLIZJI);
  });

  it("raport kolizji dla `null` nie rusza do bazy", async () => {
    const { result } = renderHookWithQueryClient(() => useAgendaConflicts(null));
    await waitFor(() => expect(result.current.fetchStatus).toBe("idle"));

    expect(api.fetchAgendaConflicts).not.toHaveBeenCalled();
  });

  it("szczegol sesji z identyfikatorem idzie do bazy", async () => {
    const { result } = renderHookWithQueryClient(() => useSessionDetail(SESJA));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(api.fetchSessionDetail).toHaveBeenCalledExactlyOnceWith(SESJA);
  });

  // BRAK SESJI TO `null`, NIE `undefined`. Okno edycji rozroznia „jeszcze nie
  // wiem" od „nie ma czego edytowac" - od tego zalezy, czy `stream_url` wejdzie
  // do ladunku zapisu.
  it("szczegol nieistniejacej sesji oddaje `null`, a nie `undefined`", async () => {
    const { result } = renderHookWithQueryClient(() => useSessionDetail(SESJA));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toBeNull();
  });

  it("szczegol sesji dla `null` nie rusza do bazy - okno zamkniete nie dobiera adresu transmisji", async () => {
    const { result } = renderHookWithQueryClient(() => useSessionDetail(null));
    await waitFor(() => expect(result.current.fetchStatus).toBe("idle"));

    expect(api.fetchSessionDetail).not.toHaveBeenCalled();
  });

  it("zapisy na sesje z identyfikatorem ida do bazy", async () => {
    const { result, queryClient } = renderHookWithQueryClient(() => useSessionSignups(SESJA));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(api.fetchSessionSignups).toHaveBeenCalledExactlyOnceWith(SESJA);
    expect(queryClient.getQueryData(agendaKeys.signups(SESJA))).toBe(LISTA_ZAPISOW);
  });

  it("zapisy na sesje dla `null` nie ruszaja do bazy", async () => {
    const { result } = renderHookWithQueryClient(() => useSessionSignups(null));
    await waitFor(() => expect(result.current.fetchStatus).toBe("idle"));

    expect(api.fetchSessionSignups).not.toHaveBeenCalled();
  });
});

describe("odmowa bazy w odczycie", () => {
  it("odmowa listy sesji wychodzi z hakiem jako blad, a nie jako pusta lista", async () => {
    api.fetchEventSessions.mockRejectedValue(ODMOWA);
    const { result } = renderHookWithQueryClient(() => useEventSessions(FILTR));
    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(result.current.data).toBeUndefined();
    expect(result.current.error?.message).toBe(ODMOWA.message);
  });

  it("odmowa raportu kolizji wychodzi jako blad - „nie sprawdzilem” to nie „nie ma kolizji”", async () => {
    api.fetchAgendaConflicts.mockRejectedValue(ODMOWA);
    const { result } = renderHookWithQueryClient(() => useAgendaConflicts(WYDARZENIE));
    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(result.current.data).toBeUndefined();
  });

  it("odmowa obsady pasma wychodzi jako blad, a nie jako pasmo bez prelegentow", async () => {
    api.fetchEventTrackSpeakers.mockRejectedValue(ODMOWA);
    const { result } = renderHookWithQueryClient(() => useEventTrackSpeakers(SCIEZKA));
    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(result.current.data).toBeUndefined();
  });

  it("odmowa sal wychodzi jako blad", async () => {
    api.fetchEventRooms.mockRejectedValue(ODMOWA);
    const { result } = renderHookWithQueryClient(() => useEventRooms(WYDARZENIE));
    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(result.current.data).toBeUndefined();
  });

  // ODMOWA DLA DRUGIEGO WYDARZENIA NIE PODSTAWIA WYNIKOW PIERWSZEGO. Bez tego
  // przejscie na wydarzenie bez dostepu rysowaloby program poprzedniego.
  it("odmowa dla drugiego wydarzenia nie podstawia sal pierwszego", async () => {
    api.fetchEventRooms.mockResolvedValueOnce(LISTA_SAL);
    api.fetchEventRooms.mockRejectedValueOnce(ODMOWA);

    const stan = { eventId: WYDARZENIE };
    const { result, rerender, queryClient } = renderHookWithQueryClient(() =>
      useEventRooms(stan.eventId),
    );
    await waitFor(() => expect(result.current.data).toBe(LISTA_SAL));

    stan.eventId = INNE_WYDARZENIE;
    rerender();
    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(result.current.data).toBeUndefined();
    expect(queryClient.getQueryData(agendaKeys.rooms(WYDARZENIE))).toBe(LISTA_SAL);
    expect(queryClient.getQueryData(agendaKeys.rooms(INNE_WYDARZENIE))).toBeUndefined();
  });
});

/* ----------------------------------------------------------------- mutacje --- */

/**
 * Tyle stanu mutacji, ile ten plik naprawde czyta.
 *
 * Kazdy hak ma WLASNY typ wejscia i wyniku, wiec tabela nie moze trzymac ich
 * pod jednym `UseMutationResult` bez rzutowania. Zamiast rzutowac, zawezamy
 * odczyt do wspolnego podzbioru - kompilator sprawdza zgodnosc przy zwrocie
 * z `wyslij`, a kazdy wpis tabeli zamyka swoje typy w domknieciu.
 */
interface StanMutacji {
  isPending: boolean;
  isSuccess: boolean;
  isError: boolean;
  data: unknown;
  error: Error | null;
}

interface UchwytMutacji {
  result: { current: StanMutacji };
  queryClient: QueryClient;
}

interface PrzypadekMutacji {
  /** Atrapa warstwy sieci, ktora hak ma wywolac. */
  atrapa: Mock;
  /** Argumenty, z jakimi hak ma ja wywolac - nie zawsze jest to samo wejscie. */
  argumenty: readonly unknown[];
  /** Odpowiedz warstwy sieci - hak ma ja oddac bez podmiany. */
  wynik: unknown;
  /** Klucze, ktore mutacja ma podac do uniewaznienia, W TEJ KOLEJNOSCI. */
  uniewaznia: readonly (readonly unknown[])[];
  /** Renderuje hak i wysyla mutacje; zamyka w sobie wlasny typ wejscia. */
  wyslij: () => UchwytMutacji;
}

/** Renderuje hak mutacji i od razu ja wysyla - wspolny ksztalt dla tabeli. */
function wyslij<TInput, TResult>(
  hak: (eventId: string) => UseMutationResult<TResult, Error, TInput>,
  input: TInput,
): UchwytMutacji {
  const uchwyt = renderHookWithQueryClient(() => hak(WYDARZENIE));
  uchwyt.result.current.mutate(input);
  return { result: uchwyt.result, queryClient: uchwyt.queryClient };
}

/** Dwa uniewaznienia wspolne dla KAZDEJ mutacji modulu (`useInvalidateEvent`). */
const GALAZ_I_SZCZEGOLY = [agendaKeys.event(WYDARZENIE), [...agendaKeys.all, "session"]] as const;

const MUTACJE: ReadonlyArray<readonly [string, PrzypadekMutacji]> = [
  [
    "zapis sesji",
    {
      atrapa: api.saveEventSession,
      argumenty: [WEJSCIE_SESJI],
      wynik: SESJA,
      uniewaznia: GALAZ_I_SZCZEGOLY,
      wyslij: () => wyslij(useSaveEventSession, WEJSCIE_SESJI),
    },
  ],
  [
    "usuniecie sesji",
    {
      atrapa: api.deleteEventSession,
      argumenty: [SESJA],
      wynik: true,
      uniewaznia: GALAZ_I_SZCZEGOLY,
      wyslij: () => wyslij(useDeleteEventSession, SESJA),
    },
  ],
  [
    "porzadkowanie sesji",
    {
      atrapa: api.reorderSessions,
      argumenty: [PORZADEK],
      wynik: 2,
      uniewaznia: GALAZ_I_SZCZEGOLY,
      wyslij: () => wyslij(useReorderSessions, PORZADEK),
    },
  ],
  [
    "zbiorcza zmiana stanu sesji",
    {
      atrapa: api.setSessionsStatus,
      argumenty: [WEJSCIE_STANU],
      wynik: 1,
      uniewaznia: GALAZ_I_SZCZEGOLY,
      wyslij: () => wyslij(useSetSessionsStatus, WEJSCIE_STANU),
    },
  ],
  [
    "przypiecie sesji do pasma",
    {
      atrapa: api.setSessionsTrack,
      argumenty: [WEJSCIE_PASMA],
      wynik: 3,
      uniewaznia: GALAZ_I_SZCZEGOLY,
      wyslij: () => wyslij(useSetSessionsTrack, WEJSCIE_PASMA),
    },
  ],
  [
    "zapis sciezki",
    {
      atrapa: api.saveEventTrack,
      argumenty: [WEJSCIE_SCIEZKI],
      wynik: SCIEZKA,
      uniewaznia: GALAZ_I_SZCZEGOLY,
      wyslij: () => wyslij(useSaveEventTrack, WEJSCIE_SCIEZKI),
    },
  ],
  [
    "usuniecie sciezki",
    {
      atrapa: api.deleteEventTrack,
      argumenty: [SCIEZKA],
      wynik: true,
      uniewaznia: GALAZ_I_SZCZEGOLY,
      wyslij: () => wyslij(useDeleteEventTrack, SCIEZKA),
    },
  ],
  [
    "zapis sali",
    {
      atrapa: api.saveEventRoom,
      argumenty: [WEJSCIE_SALI],
      wynik: SALA,
      uniewaznia: GALAZ_I_SZCZEGOLY,
      wyslij: () => wyslij(useSaveEventRoom, WEJSCIE_SALI),
    },
  ],
  [
    "usuniecie sali",
    {
      atrapa: api.deleteEventRoom,
      argumenty: [SALA],
      wynik: true,
      uniewaznia: GALAZ_I_SZCZEGOLY,
      wyslij: () => wyslij(useDeleteEventRoom, SALA),
    },
  ],
  [
    "zapis obsady sesji",
    {
      atrapa: api.setSessionSpeakers,
      // Hak ROZBIJA jedno wejscie na dwa argumenty warstwy sieci - to jest
      // miejsce, w ktorym latwo zgubic identyfikator sesji i podmienic obsade
      // nie tej sesji, co trzeba.
      argumenty: [SESJA, OBSADA],
      wynik: 1,
      uniewaznia: [agendaKeys.session(SESJA), ...GALAZ_I_SZCZEGOLY],
      wyslij: () => wyslij(useSetSessionSpeakers, WEJSCIE_OBSADY),
    },
  ],
  [
    "zapis uczestnika na sesje",
    {
      atrapa: api.setSessionSignup,
      argumenty: [WEJSCIE_ZAPISU],
      wynik: { status: "registered" },
      uniewaznia: [agendaKeys.signups(SESJA), ...GALAZ_I_SZCZEGOLY],
      wyslij: () => wyslij(useSetSessionSignup, WEJSCIE_ZAPISU),
    },
  ],
];

describe("mutacje - sukces i to, co dojechalo do warstwy sieci", () => {
  it("tabela obejmuje KAZDA mutacje modulu", () => {
    // Nowy hak zapisu bez wpisu w tabeli przeszedlby ten plik nietkniety.
    expect(MUTACJE).toHaveLength(11);
  });

  it.each(MUTACJE)(
    "%s: wysyla dokladnie to, co dostala, i oddaje odpowiedz bazy",
    async (_nazwa, przypadek) => {
      const { result } = przypadek.wyslij();
      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(przypadek.atrapa).toHaveBeenCalledOnce();
      // Porownujemy ARGUMENTY ZNACZACE - react-query dokleja jeszcze wlasny
      // kontekst, co ma tu wlasny przypadek nizej.
      const wyslane = przypadek.atrapa.mock.calls[0].slice(0, przypadek.argumenty.length);
      expect(wyslane).toEqual([...przypadek.argumenty]);
      expect(result.current.data).toEqual(przypadek.wynik);
    },
  );

  // PULAPKA NA PRZYSZLOSC, NIE DZISIEJSZY BLAD. Dziesiec z jedenastu mutacji
  // podaje funkcje warstwy sieci PRZEZ REFERENCJE (`mutationFn: deleteEventRoom`),
  // wiec react-query wklada w jej DRUGI parametr wlasny kontekst. Dzis wszystkie
  // te funkcje maja jeden parametr i nadmiarowy argument ginie. W dniu, w ktorym
  // ktoras dostanie opcjonalny drugi parametr (`deleteEventRoom(id, hard?)`),
  // wypelni go obiekt kontekstu - czyli wartosc PRAWDZIWOSCIOWA, ktorej nikt
  // nie przekazal.
  it("mutacje podane przez referencje dostaja tez kontekst react-query jako drugi argument", async () => {
    const { result } = wyslij(useDeleteEventRoom, SALA);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(api.deleteEventRoom.mock.calls[0]).toHaveLength(2);
    expect(api.deleteEventRoom.mock.calls[0][0]).toBe(SALA);
  });

  // JEDYNA MUTACJA Z WLASNYM DOMKNIECIEM - do warstwy sieci nie dojezdza NIC
  // ponad to, co ta lambda zbudowala.
  it("zapis obsady wysyla DOKLADNIE dwa argumenty, bez kontekstu react-query", async () => {
    const { result } = wyslij(useSetSessionSpeakers, WEJSCIE_OBSADY);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(api.setSessionSpeakers).toHaveBeenCalledExactlyOnceWith(SESJA, OBSADA);
  });

  // OBSADA JEST PODMIANA CALEGO SKLADU, NIE DOPISANIEM. Pusta tablica znaczy
  // „zdejmij wszystkich" i musi dojechac jako pusta tablica, a nie zniknac.
  it("pusta obsada dojezdza jako PUSTA TABLICA - to jest polecenie „zdejmij wszystkich”", async () => {
    const { result } = wyslij(useSetSessionSpeakers, { sessionId: SESJA, speakers: [] });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(api.setSessionSpeakers).toHaveBeenCalledExactlyOnceWith(SESJA, []);
  });

  // ODPIECIE OD PASMA TO WARTOSC, NIE BRAK DANYCH. `trackId: null` musi
  // dojechac do bazy - zgubiony `null` zostawilby sesje w starym pasmie.
  it("odpiecie sesji od pasma niesie jawny `null`, a nie brak klucza", async () => {
    const wejscie = { ids: [SESJA, OBCA_SESJA], trackId: null };
    const { result } = wyslij(useSetSessionsTrack, wejscie);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(api.setSessionsTrack.mock.calls[0][0]).toEqual(wejscie);
  });
});

describe("mutacje - stan „zapis w toku”", () => {
  // ZAPIS W TOKU JEST JEDYNYM ZRODLEM BLOKADY PRZYCISKU W OKNIE. Hak, ktory nie
  // wystawia `isPending`, pozwala kliknac „Zapisz" drugi raz - a to druga sesja
  // o tej samej godzinie w tej samej sali.
  it.each(MUTACJE)("%s: melduje `isPending`, dopoki baza nie odpowie", async (_n, przypadek) => {
    const bramka = odroczona<unknown>();
    przypadek.atrapa.mockReturnValue(bramka.promise);

    const { result } = przypadek.wyslij();
    await waitFor(() => expect(result.current.isPending).toBe(true));
    expect(result.current.isSuccess).toBe(false);

    bramka.spelnij(przypadek.wynik);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.isPending).toBe(false);
  });
});

/* --------------------------------------------------------- odmowy z bazy --- */

/**
 * Odmowy przepisane z `scripts/events-harness/runtime_test.d/10_sessions.sql`.
 *
 * KOD JEST GLOWA KOMUNIKATU, nie polem obok. Hak, ktory zamienilby wyjatek na
 * `undefined` albo na pusta liste, odcialby panelowi jedyny kanal, z ktorego
 * organizator dowiaduje sie, CZEMU zapis nie przeszedl - a slownik
 * `adminAgendaErrors` czyta wlasnie ten napis.
 */
const ODMOWY: ReadonlyArray<readonly [string, string, () => UchwytMutacji]> = [
  // 1. DWIE SESJE W TEJ SAMEJ SALI W NACHODZACYCH SIE GODZINACH.
  // Baza ma na to ograniczenie wykluczajace (`event_sessions_room_no_overlap`),
  // a RPC panelu przechwytuje je i tlumaczy na `room_conflict`.
  [
    "kolizja sali przy zapisie sesji",
    "room_conflict: room is taken in this time range",
    () => wyslij(useSaveEventSession, WEJSCIE_SESJI),
  ],
  [
    "kolizja sali podniesiona wprost przez ograniczenie wykluczajace",
    "event_sessions_room_no_overlap",
    () => wyslij(useSaveEventSession, WEJSCIE_SESJI),
  ],
  // 2. TEN SAM PRELEGENT W DWOCH SESJACH NARAZ.
  [
    "kolizja prelegenta przy zapisie obsady",
    "speaker_overlap: speaker already has a session in this time range",
    () => wyslij(useSetSessionSpeakers, WEJSCIE_OBSADY),
  ],
  // 3. SESJA POZA GODZINAMI WYDARZENIA (dolna granica okna).
  [
    "sesja przed poczatkiem wydarzenia",
    "session_before_event: session starts before the event",
    () => wyslij(useSaveEventSession, WEJSCIE_SESJI),
  ],
  // 4. SESJA W SALI O POJEMNOSCI MNIEJSZEJ NIZ LIMIT MIEJSC - dwie strony tej
  // samej sprzecznosci: od strony sesji i od strony sali.
  [
    "limit miejsc sesji ponad pojemnosc sali",
    "capacity_over_room: seat limit 100 exceeds room capacity 20",
    () => wyslij(useSaveEventSession, WEJSCIE_SESJI),
  ],
  [
    "obnizenie pojemnosci sali ponizej limitu sesji",
    "capacity_below_sessions: 5 is below 20 seats already planned",
    () => wyslij(useSaveEventRoom, WEJSCIE_SALI),
  ],
  // 5. SCIEZKA I SALA W UZYCIU - kasowanie odmawiane przez UZYCIE, nie przez
  // brak uprawnien.
  [
    "sciezka z sesjami nie da sie usunac",
    "track_in_use: 3 sessions still use this track",
    () => wyslij(useDeleteEventTrack, SCIEZKA),
  ],
  [
    "sala z sesjami nie da sie usunac",
    "room_in_use: 2 sessions still use this room",
    () => wyslij(useDeleteEventRoom, SALA),
  ],
  // Sesja z zapisami i zapis ponad limit - dwie odmowy, ktore panel zapisow
  // pokazuje w tym samym miejscu co powyzsze.
  [
    "sesja z zapisami nie da sie usunac",
    "session_has_signups: 4 active signups",
    () => wyslij(useDeleteEventSession, SESJA),
  ],
  [
    "zapis ponad limit miejsc bez jawnej furtki",
    "session_full: 1 of 1 seats taken",
    () => wyslij(useSetSessionSignup, WEJSCIE_ZAPISU),
  ],
];

describe("mutacje - odmowa bazy dochodzi z KODEM, nie w cisze", () => {
  it.each(ODMOWY)("%s", async (_nazwa, komunikat, uruchom) => {
    for (const atrapa of Object.values(api)) atrapa.mockRejectedValue(new Error(komunikat));

    const { result } = uruchom();
    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(result.current.error?.message).toBe(komunikat);
    expect(result.current.data).toBeUndefined();
  });

  // KONTRAPUNKT DO `track_in_use` I `room_in_use`: odmowa dotyczy UZYCIA,
  // a nie samej operacji. Bez tej pary „nie da sie usunac" bylo by nieodroznialne
  // od „kasowanie w ogole nie dziala".
  it("sciezka BEZ sesji kasuje sie normalnie - odmowa dotyczy uzycia, nie operacji", async () => {
    const { result } = wyslij(useDeleteEventTrack, SCIEZKA);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toBe(true);
    expect(api.deleteEventTrack.mock.calls[0][0]).toBe(SCIEZKA);
  });

  it("sala BEZ sesji kasuje sie normalnie - kontrapunkt dla `room_in_use`", async () => {
    const { result } = wyslij(useDeleteEventRoom, SALA);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toBe(true);
  });

  it.each(MUTACJE)("%s: odmowa wychodzi z hakiem, a nie w cisze", async (_n, przypadek) => {
    przypadek.atrapa.mockRejectedValue(ODMOWA);

    const { result } = przypadek.wyslij();
    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(result.current.error?.message).toBe(ODMOWA.message);
    expect(result.current.data).toBeUndefined();
  });

  // NIEUDANY ZAPIS NIE UNIEWAZNIA NICZEGO. Odswiezenie listy po odmowie
  // sugerowaloby, ze cos sie zmienilo - a nie zmienilo.
  it.each(MUTACJE)("%s: odmowa NIE rusza pamieci podrecznej", async (_n, przypadek) => {
    przypadek.atrapa.mockRejectedValue(ODMOWA);

    const { result, queryClient } = przypadek.wyslij();
    const spy = vi.spyOn(queryClient, "invalidateQueries");
    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(spy).not.toHaveBeenCalled();
  });
});

/* --------------------------------------------- zasieg uniewaznienia --- */

describe("mutacje - zasieg uniewaznienia", () => {
  it.each(MUTACJE)(
    "%s: podaje DOKLADNIE swoje klucze, w swojej kolejnosci",
    async (_n, przypadek) => {
      const { result, queryClient } = przypadek.wyslij();
      const spy = vi.spyOn(queryClient, "invalidateQueries");
      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      const klucze = spy.mock.calls.map((call) => call[0]?.queryKey);
      expect(klucze).toEqual(przypadek.uniewaznia.map((klucz) => [...klucz]));
    },
  );

  /** Sadzi wartownika w kazdej galezi, ktorej dotyczy asercja pary. */
  function posiej(client: QueryClient): void {
    client.setQueryData(agendaKeys.sessions(FILTR), LISTA_SESJI);
    client.setQueryData(agendaKeys.tracks(WYDARZENIE), LISTA_SCIEZEK);
    client.setQueryData(agendaKeys.rooms(WYDARZENIE), LISTA_SAL);
    client.setQueryData(agendaKeys.conflicts(WYDARZENIE), LISTA_KOLIZJI);
    client.setQueryData(agendaKeys.session(SESJA), null);
    client.setQueryData(agendaKeys.signups(SESJA), LISTA_ZAPISOW);
    client.setQueryData(agendaKeys.sessions({ ...FILTR, eventId: INNE_WYDARZENIE }), LISTA_SESJI);
    client.setQueryData(agendaKeys.tracks(INNE_WYDARZENIE), LISTA_SCIEZEK);
    client.setQueryData(agendaKeys.rooms(INNE_WYDARZENIE), LISTA_SAL);
    client.setQueryData(agendaKeys.conflicts(INNE_WYDARZENIE), LISTA_KOLIZJI);
  }

  const zwietrzal = (client: QueryClient, klucz: readonly unknown[]): boolean =>
    client.getQueryState(klucz)?.isInvalidated === true;

  // ZAPIS SESJI RUSZA WSZYSTKIE CZTERY LISTY TEGO WYDARZENIA. Lista sesji - bo
  // doszedl wiersz. Sciezki - bo `sessions_count` i `minutes_total` sa liczone
  // z sesji. Sale - bo `booked_minutes` tez. Kolizje - bo nowa godzina moze
  // wlasnie utworzyc nachodzenie.
  it("zapis sesji wietrzy sesje, sciezki, sale i kolizje TEGO wydarzenia", async () => {
    const { result, queryClient } = wyslij(useSaveEventSession, WEJSCIE_SESJI);
    posiej(queryClient);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(zwietrzal(queryClient, agendaKeys.sessions(FILTR))).toBe(true);
    expect(zwietrzal(queryClient, agendaKeys.tracks(WYDARZENIE))).toBe(true);
    expect(zwietrzal(queryClient, agendaKeys.rooms(WYDARZENIE))).toBe(true);
    expect(zwietrzal(queryClient, agendaKeys.conflicts(WYDARZENIE))).toBe(true);
  });

  it("zapis sesji NIE rusza zadnej listy INNEGO wydarzenia", async () => {
    const { result, queryClient } = wyslij(useSaveEventSession, WEJSCIE_SESJI);
    posiej(queryClient);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const obcy: SessionsQuery = { ...FILTR, eventId: INNE_WYDARZENIE };
    expect(zwietrzal(queryClient, agendaKeys.sessions(obcy))).toBe(false);
    expect(zwietrzal(queryClient, agendaKeys.tracks(INNE_WYDARZENIE))).toBe(false);
    expect(zwietrzal(queryClient, agendaKeys.rooms(INNE_WYDARZENIE))).toBe(false);
    expect(zwietrzal(queryClient, agendaKeys.conflicts(INNE_WYDARZENIE))).toBe(false);
  });

  // SZCZEGOL SESJI STOI POZA GALEZIA WYDARZENIA - i to jest przyczyna DRUGIEGO
  // uniewaznienia. To wlasnie szczegol niesie `stream_url` i `recording_url`,
  // wiec bez tej linii ponowne otwarcie okna po zapisie pokazywaloby WARTOSC
  // SPRZED zapisu - i odsylalo ja z powrotem do bazy.
  it("zapis sesji wietrzy takze szczegol i zapisy sesji, mimo ze leza poza galezia", async () => {
    const { result, queryClient } = wyslij(useSaveEventSession, WEJSCIE_SESJI);
    posiej(queryClient);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(zwietrzal(queryClient, agendaKeys.session(SESJA))).toBe(true);
    expect(zwietrzal(queryClient, agendaKeys.signups(SESJA))).toBe(true);
  });

  // PRZYPIECIE SESJI DO PASMA JEST ZAPISEM, choc nie dotyka ani jednej kolumny
  // tresci: liczniki pasma i raport kolizji licza sie od nowa.
  it("przypiecie sesji do pasma wietrzy sciezki i kolizje, a cudze wydarzenie zostawia", async () => {
    const { result, queryClient } = wyslij(useSetSessionsTrack, WEJSCIE_PASMA);
    posiej(queryClient);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(zwietrzal(queryClient, agendaKeys.tracks(WYDARZENIE))).toBe(true);
    expect(zwietrzal(queryClient, agendaKeys.conflicts(WYDARZENIE))).toBe(true);
    expect(zwietrzal(queryClient, agendaKeys.tracks(INNE_WYDARZENIE))).toBe(false);
  });

  // ZAPIS UCZESTNIKA ZMIENIA RAPORT KOLIZJI (`overbooked`), a nie tylko liste
  // zapisow - dlatego mutacja siega galezi wydarzenia, a nie samej sesji.
  it("zapis uczestnika na sesje wietrzy raport kolizji, bo `overbooked` liczy sie z zapisow", async () => {
    const { result, queryClient } = wyslij(useSetSessionSignup, WEJSCIE_ZAPISU);
    posiej(queryClient);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(zwietrzal(queryClient, agendaKeys.signups(SESJA))).toBe(true);
    expect(zwietrzal(queryClient, agendaKeys.conflicts(WYDARZENIE))).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // DEFEKT: naglowek `useEventSessions.ts` obiecuje wprost „UNIEWAZNIAMY GALAZ
  // WYDARZENIA (...) kazda mutacja tego modulu potrafi ruszyc wiecej niz jedna
  // liste". OBSADA PASMA (`agendaKeys.trackSpeakers`) tej obietnicy nie dostaje:
  // klucz brzmi `["event-agenda", "track-speakers", trackId]`, wiec nie ma ani
  // przedrostka `agendaKeys.event(eventId)`, ani przedrostka
  // `[...agendaKeys.all, "session"]` - jedynych dwoch, ktore `useInvalidateEvent`
  // podaje. Zadna z jedenastu mutacji nie wietrzy wiec listy prelegentow pasma.
  //
  // WIDAC TO W WARSZTACIE PASMA (`EventTrackWorkspace`), ktorego naglowek mowi:
  // „OBSADA JEST WYLICZANA, NIE WPISYWANA. Prelegent nalezy do SESJI; pasmo
  // pokazuje sume tych przypisan". Dopisanie prelegenta do sesji tego pasma
  // zmienia `admin_event_track_speakers`, ale zakladka „Prelegenci" pokazuje
  // stara obsade jeszcze przez `CONFIG_STALE_MS` (60 s) - a organizator patrzy
  // na nia zaraz po zapisie, bo po to ja otworzyl.
  //
  // NAPRAWA: `agendaKeys.trackSpeakers` musialoby lezec w galezi wydarzenia
  // (`event(eventId), "track-speakers", trackId`) albo `useInvalidateEvent`
  // musialoby podac trzeci przedrostek.
  // ---------------------------------------------------------------------------
  it.fails(
    "DEFEKT: zapis obsady sesji NIE wietrzy obsady PASMA, choc pasmo liczy ja z sesji",
    async () => {
      const { result, queryClient } = wyslij(useSetSessionSpeakers, WEJSCIE_OBSADY);
      queryClient.setQueryData(agendaKeys.trackSpeakers(SCIEZKA), LISTA_OBSADY);
      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(zwietrzal(queryClient, agendaKeys.trackSpeakers(SCIEZKA))).toBe(true);
    },
  );

  it.fails("DEFEKT: przypiecie sesji do pasma NIE wietrzy obsady tego pasma", async () => {
    const { result, queryClient } = wyslij(useSetSessionsTrack, WEJSCIE_PASMA);
    queryClient.setQueryData(agendaKeys.trackSpeakers(SCIEZKA), LISTA_OBSADY);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(zwietrzal(queryClient, agendaKeys.trackSpeakers(SCIEZKA))).toBe(true);
  });
});
