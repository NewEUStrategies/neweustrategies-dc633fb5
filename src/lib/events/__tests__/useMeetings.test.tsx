// Hooki PANELU ORGANIZATORA giełdy spotkań 1-1 - warstwa, przez którą przechodzi
// KAŻDA liczba i KAŻDA decyzja tego modułu.
//
// CO TEN PLIK DOWODZI I DLACZEGO TO WAŻNE:
//
//  1. PUSTE `eventId` NIE PYTA BAZY. Panel montuje się, zanim organizator wybierze
//     wydarzenie. Zapytanie z pustym identyfikatorem nie kończy się błędem, tylko
//     wierszami CUDZEGO wydarzenia albo pustą listą wyglądającą jak „nie ma
//     stolików" - a to jest zaproszenie do założenia ich drugi raz.
//
//  2. WOLNE TERMINY NIE RUSZAJĄ DLA PARY „JA I JA". `admin_event_meeting_arrange`
//     odrzuca spotkanie z samym sobą (`event_meetings_no_self` w migracji), więc
//     zapytanie o wspólne terminy takiej pary jest z definicji bez odpowiedzi.
//     Bramka `aRegistrationId !== bRegistrationId` jest jedynym miejscem, w którym
//     ta kolizja jest rozstrzygana PRZED wyjściem do sieci.
//
//  3. KAŻDA MUTACJA UNIEWAŻNIA CAŁĄ GAŁĄŹ WYDARZENIA. Odznaczenie frekwencji
//     zmienia listę ORAZ obciążenie stolika ORAZ wskaźnik obecności. Punktowe
//     unieważnienie zostawiłoby na sąsiedniej zakładce liczbę sprzed decyzji -
//     czyli liczbę wyglądającą wiarygodnie i nieprawdziwą.
//
//  4. `select` STATYSTYK BIEGNIE POZA `queryFn`. Surowy `jsonb` nie ma prawa
//     wyjść z tej warstwy; ekran dostaje model, w którym `null` znaczy „nie ma
//     z czego liczyć", a nie „zero procent".
//
//  5. KLUCZ LISTY NIESIE CAŁE ZAPYTANIE. Filtr statusu, stolika i strona są
//     częścią klucza, więc dwa różne widoki nie mogą podmienić sobie danych
//     w pamięci podręcznej.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE. Warstwy sieciowej (`meetingsApi`) i parserów
// (`meetingsStats`, `meetingParticipants`) - mają własne pliki testowe. Tutaj
// atrapą jest DOKŁADNIE ta warstwa, bo przedmiotem dowodu jest to, KIEDY hooki
// do niej sięgają i co robią z wynikiem.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { waitFor } from "@testing-library/react";

import { renderHookWithQueryClient } from "@/test/renderWithQueryClient";
import type { AdminMeetingsQuery } from "@/lib/events/meetingsApi";

const h = vi.hoisted(() => ({
  tables: vi.fn(),
  settings: vi.fn(),
  stats: vi.fn(),
  meetings: vi.fn(),
  freeSlots: vi.fn(),
  saveTable: vi.fn(),
  deleteTable: vi.fn(),
  saveSettings: vi.fn(),
  setStatus: vi.fn(),
  arrange: vi.fn(),
  participants: vi.fn(),
}));

// Warstwa sieciowa jest JEDYNĄ atrapą - fabryka kluczy, bramki `enabled`
// i unieważnianie zostają prawdziwe, bo to one są przedmiotem dowodu.
vi.mock("@/lib/events/meetingsApi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/events/meetingsApi")>()),
  fetchMeetingTables: (eventId: string) => h.tables(eventId),
  fetchMeetingSettings: (eventId: string) => h.settings(eventId),
  fetchMeetingStats: (eventId: string) => h.stats(eventId),
  fetchAdminMeetings: (query: unknown) => h.meetings(query),
  fetchAdminFreeSlots: (input: unknown) => h.freeSlots(input),
  saveMeetingTable: (input: unknown) => h.saveTable(input),
  deleteMeetingTable: (id: string) => h.deleteTable(id),
  saveMeetingSettings: (input: unknown) => h.saveSettings(input),
  setMeetingStatus: (input: unknown) => h.setStatus(input),
  arrangeMeeting: (input: unknown) => h.arrange(input),
}));

vi.mock("@/lib/events/meetingParticipants", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/events/meetingParticipants")>()),
  searchMeetingParticipants: (input: unknown) => h.participants(input),
}));

// Klient Supabase nie ma w teście adresu ani sesji; żaden hook nie ma prawa
// tu dojść, ale gdyby doszedł - ma się o czym odbić, a nie wyjść do sieci.
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: () => Promise.resolve({ data: null, error: null }) },
}));

const {
  meetingKeys,
  useAdminMeetings,
  useArrangeMeeting,
  useDeleteMeetingTable,
  useMeetingFreeSlots,
  useMeetingParticipants,
  useMeetingSettings,
  useMeetingStats,
  useMeetingTables,
  useSaveMeetingSettings,
  useSaveMeetingTable,
  useSetMeetingStatus,
} = await import("@/lib/events/useMeetings");

const WYDARZENIE = "11111111-1111-4111-8111-111111111111";
const ZAPIS_A = "22222222-2222-4222-8222-222222222222";
const ZAPIS_B = "33333333-3333-4333-8333-333333333333";

function zapytanie(over: Partial<AdminMeetingsQuery> = {}): AdminMeetingsQuery {
  return { eventId: WYDARZENIE, status: "all", limit: 25, offset: 0, ...over };
}

beforeEach(() => {
  vi.clearAllMocks();
  h.tables.mockResolvedValue([]);
  h.settings.mockResolvedValue({});
  h.stats.mockResolvedValue({});
  h.meetings.mockResolvedValue([]);
  h.freeSlots.mockResolvedValue([]);
  h.participants.mockResolvedValue([]);
  h.saveTable.mockResolvedValue("t-1");
  h.deleteTable.mockResolvedValue(true);
  h.saveSettings.mockResolvedValue({});
  h.setStatus.mockResolvedValue({});
  h.arrange.mockResolvedValue({});
});

describe("meetingKeys - jedna fabryka na cały moduł", () => {
  it("gałąź wydarzenia jest PREFIKSEM każdego klucza tego modułu", () => {
    // Unieważnianie idzie po gałęzi, więc klucz, który z niej wypada, nigdy
    // się nie odświeży - i pokaże liczbę sprzed decyzji.
    const galaz = meetingKeys.event(WYDARZENIE);
    for (const klucz of [
      meetingKeys.tables(WYDARZENIE),
      meetingKeys.settings(WYDARZENIE),
      meetingKeys.stats(WYDARZENIE),
      meetingKeys.list(zapytanie()),
    ]) {
      expect(klucz.slice(0, galaz.length)).toEqual([...galaz]);
    }
  });

  it("klucz listy niesie CAŁE zapytanie, nie samo wydarzenie", () => {
    // Dwie zakładki („Oczekujące" i „Odbyte") to dwa różne zbiory wierszy;
    // wspólny klucz podmieniałby jeden drugim.
    const oczekujace = meetingKeys.list(zapytanie({ status: "pending" }));
    const odbyte = meetingKeys.list(zapytanie({ status: "held" }));
    expect(oczekujace).not.toEqual(odbyte);
    expect(meetingKeys.list(zapytanie({ offset: 25 }))).not.toEqual(
      meetingKeys.list(zapytanie({ offset: 0 })),
    );
  });

  it("dwa różne wydarzenia mają rozłączne gałęzie", () => {
    expect(meetingKeys.event(WYDARZENIE)).not.toEqual(meetingKeys.event(ZAPIS_A));
  });
});

describe("bramka `enabled` - puste wydarzenie nie pyta bazy", () => {
  it.each([
    ["null", null],
    ["pusty napis", ""],
  ])("useMeetingTables nie woła RPC dla wydarzenia %s", async (_opis, eventId) => {
    const { result } = renderHookWithQueryClient(() => useMeetingTables(eventId));
    await waitFor(() => expect(result.current.fetchStatus).toBe("idle"));
    expect(h.tables).not.toHaveBeenCalled();
    expect(result.current.data).toBeUndefined();
  });

  it("useMeetingSettings milczy bez wydarzenia i pyta z wydarzeniem", async () => {
    const bez = renderHookWithQueryClient(() => useMeetingSettings(""));
    await waitFor(() => expect(bez.result.current.fetchStatus).toBe("idle"));
    expect(h.settings).not.toHaveBeenCalled();

    const z = renderHookWithQueryClient(() => useMeetingSettings(WYDARZENIE));
    await waitFor(() => expect(z.result.current.isSuccess).toBe(true));
    expect(h.settings).toHaveBeenCalledWith(WYDARZENIE);
  });

  it("useAdminMeetings z pustym wydarzeniem nie wysyła zapytania", async () => {
    const { result } = renderHookWithQueryClient(() =>
      useAdminMeetings(zapytanie({ eventId: "" })),
    );
    await waitFor(() => expect(result.current.fetchStatus).toBe("idle"));
    expect(h.meetings).not.toHaveBeenCalled();
  });

  it("useAdminMeetings przekazuje zapytanie do warstwy sieciowej BEZ zmian", async () => {
    const query = zapytanie({ status: "expired", tableId: null, search: "kowalska" });
    const { result } = renderHookWithQueryClient(() => useAdminMeetings(query));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(h.meetings).toHaveBeenCalledWith(query);
  });

  it("useMeetingParticipants nie pyta bazy bez wydarzenia", async () => {
    const { result } = renderHookWithQueryClient(() => useMeetingParticipants(null, "kow"));
    await waitFor(() => expect(result.current.fetchStatus).toBe("idle"));
    expect(h.participants).not.toHaveBeenCalled();
  });

  it("useMeetingParticipants trzyma frazę w kluczu, więc nowa fraza to nowe zapytanie", async () => {
    let fraza = "kow";
    const { result, rerender, queryClient } = renderHookWithQueryClient(() =>
      useMeetingParticipants(WYDARZENIE, fraza),
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(h.participants).toHaveBeenCalledWith({ eventId: WYDARZENIE, query: "kow" });

    fraza = "nowak";
    rerender();
    await waitFor(() => expect(h.participants).toHaveBeenCalledTimes(2));
    expect(h.participants).toHaveBeenLastCalledWith({ eventId: WYDARZENIE, query: "nowak" });
    // Poprzednia fraza zostaje w pamięci pod SWOIM kluczem - powrót do niej
    // nie kosztuje kolejnego zapytania.
    expect(
      queryClient.getQueryData([...meetingKeys.event(WYDARZENIE), "participants", "kow"]),
    ).toBeDefined();
  });
});

describe("useMeetingFreeSlots - kolizja „ja i ja” rozstrzygnięta przed siecią", () => {
  it("NIE pyta bazy, gdy obie strony to TEN SAM zapis", async () => {
    // `event_meetings_no_self` odrzuca taką parę w bazie, a `_free_slots`
    // policzyłby dla niej część wspólną okien tej samej osoby - czyli listę
    // terminów, na których „obie strony" są wolne. Wynik wyglądałby poprawnie
    // i prowadziłby prosto do odmowy przy zapisie.
    const { result } = renderHookWithQueryClient(() =>
      useMeetingFreeSlots({
        eventId: WYDARZENIE,
        aRegistrationId: ZAPIS_A,
        bRegistrationId: ZAPIS_A,
      }),
    );
    await waitFor(() => expect(result.current.fetchStatus).toBe("idle"));
    expect(h.freeSlots).not.toHaveBeenCalled();
  });

  it.each([
    ["brak pierwszej strony", null, ZAPIS_B],
    ["brak drugiej strony", ZAPIS_A, null],
    ["pusty identyfikator pierwszej strony", "", ZAPIS_B],
    ["pusty identyfikator drugiej strony", ZAPIS_A, ""],
  ])("nie pyta bazy przy %s", async (_opis, a, b) => {
    const { result } = renderHookWithQueryClient(() =>
      useMeetingFreeSlots({ eventId: WYDARZENIE, aRegistrationId: a, bRegistrationId: b }),
    );
    await waitFor(() => expect(result.current.fetchStatus).toBe("idle"));
    expect(h.freeSlots).not.toHaveBeenCalled();
  });

  it("pyta bazy dopiero dla DWÓCH RÓŻNYCH stron", async () => {
    const { result } = renderHookWithQueryClient(() =>
      useMeetingFreeSlots({
        eventId: WYDARZENIE,
        aRegistrationId: ZAPIS_A,
        bRegistrationId: ZAPIS_B,
      }),
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(h.freeSlots).toHaveBeenCalledWith({
      eventId: WYDARZENIE,
      aRegistrationId: ZAPIS_A,
      bRegistrationId: ZAPIS_B,
    });
  });

  it("odwrócona para ma INNY klucz - terminy nie podmieniają się w pamięci", async () => {
    const { queryClient, result } = renderHookWithQueryClient(() =>
      useMeetingFreeSlots({
        eventId: WYDARZENIE,
        aRegistrationId: ZAPIS_A,
        bRegistrationId: ZAPIS_B,
      }),
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const klucze = queryClient
      .getQueryCache()
      .getAll()
      .map((query) => query.queryKey);
    expect(klucze).toContainEqual([
      ...meetingKeys.event(WYDARZENIE),
      "free-slots",
      ZAPIS_A,
      ZAPIS_B,
    ]);
  });
});

describe("useMeetingStats - `select` zamienia jsonb w model ekranu", () => {
  it("brak podstawy zostaje `null`, a nie zerem procent", async () => {
    h.stats.mockResolvedValue({ total: 4, acceptance_rate: null, attendance_rate: null });
    const { result } = renderHookWithQueryClient(() => useMeetingStats(WYDARZENIE));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.acceptanceRate).toBeNull();
    expect(result.current.data?.attendanceRate).toBeNull();
    expect(result.current.data?.total).toBe(4);
  });

  it("surowy `jsonb` nie wychodzi z warstwy hooka", async () => {
    h.stats.mockResolvedValue({ total: 2, acceptance_rate: 50 });
    const { result } = renderHookWithQueryClient(() => useMeetingStats(WYDARZENIE));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    // Klucze snake_case z RPC nie mają prawa dojść do ekranu - gdyby doszły,
    // pierwsza zmiana nazwy pola w SQL-u dałaby „NaN%" bez błędu w konsoli.
    expect(result.current.data).not.toHaveProperty("acceptance_rate");
    expect(result.current.data?.acceptanceRate).toBe(50);
    expect(result.current.data?.tables).toEqual([]);
  });

  it("odpowiedź, która nie jest obiektem, degraduje do pustych statystyk", async () => {
    h.stats.mockResolvedValue(null);
    const { result } = renderHookWithQueryClient(() => useMeetingStats(WYDARZENIE));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.total).toBe(0);
    expect(result.current.data?.acceptanceRate).toBeNull();
  });
});

describe("unieważnianie - jedna gałąź na wszystkie mutacje", () => {
  it("zapis stolika kasuje CAŁĄ gałąź wydarzenia", async () => {
    const { result, queryClient } = renderHookWithQueryClient(() =>
      useSaveMeetingTable(WYDARZENIE),
    );
    const szpieg = vi.spyOn(queryClient, "invalidateQueries");
    result.current.mutate({
      id: null,
      eventId: WYDARZENIE,
      label: "Stolik 1",
      zone: null,
      roomId: null,
      capacity: 1,
      note: null,
      sortOrder: 0,
      isActive: true,
    });
    await waitFor(() => expect(szpieg).toHaveBeenCalled());
    expect(szpieg).toHaveBeenCalledWith({ queryKey: meetingKeys.event(WYDARZENIE) });
  });

  it("usunięcie stolika kasuje gałąź wydarzenia", async () => {
    const { result, queryClient } = renderHookWithQueryClient(() =>
      useDeleteMeetingTable(WYDARZENIE),
    );
    const szpieg = vi.spyOn(queryClient, "invalidateQueries");
    result.current.mutate("t-1");
    await waitFor(() => expect(szpieg).toHaveBeenCalled());
    expect(szpieg).toHaveBeenCalledWith({ queryKey: meetingKeys.event(WYDARZENIE) });
    expect(h.deleteTable).toHaveBeenCalledWith("t-1");
  });

  it("odznaczenie frekwencji odświeża listę I obciążenie stolików", async () => {
    // To jest sedno wspólnej gałęzi: „odbyło się" zmienia wiersz listy oraz
    // licznik spotkań przy stoliku w zakładce obok.
    const { result, queryClient } = renderHookWithQueryClient(() => {
      const lista = useAdminMeetings(zapytanie());
      const stoliki = useMeetingTables(WYDARZENIE);
      const status = useSetMeetingStatus(WYDARZENIE);
      return { lista, stoliki, status };
    });
    await waitFor(() => expect(result.current.lista.isSuccess).toBe(true));
    await waitFor(() => expect(result.current.stoliki.isSuccess).toBe(true));
    expect(h.meetings).toHaveBeenCalledTimes(1);
    expect(h.tables).toHaveBeenCalledTimes(1);

    result.current.status.mutate({ meetingId: "m-1", status: "held" });
    await waitFor(() => expect(h.meetings).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(h.tables).toHaveBeenCalledTimes(2));
    expect(h.setStatus).toHaveBeenCalledWith({ meetingId: "m-1", status: "held" });
    expect(queryClient.getQueryState(meetingKeys.tables(WYDARZENIE))?.isInvalidated).toBe(false);
  });

  it("odwołanie spotkania przekazuje powód i też odświeża gałąź", async () => {
    const { result, queryClient } = renderHookWithQueryClient(() =>
      useSetMeetingStatus(WYDARZENIE),
    );
    const szpieg = vi.spyOn(queryClient, "invalidateQueries");
    result.current.mutate({ meetingId: "m-1", status: "cancelled", reason: "sala zajęta" });
    await waitFor(() => expect(szpieg).toHaveBeenCalled());
    expect(h.setStatus).toHaveBeenCalledWith({
      meetingId: "m-1",
      status: "cancelled",
      reason: "sala zajęta",
    });
  });

  it("umówienie spotkania przez organizatora kasuje gałąź wydarzenia", async () => {
    const { result, queryClient } = renderHookWithQueryClient(() => useArrangeMeeting(WYDARZENIE));
    const szpieg = vi.spyOn(queryClient, "invalidateQueries");
    result.current.mutate({
      eventId: WYDARZENIE,
      requesterRegistrationId: ZAPIS_A,
      inviteeRegistrationId: ZAPIS_B,
      startsAt: "2026-09-10T08:00:00.000Z",
    });
    await waitFor(() => expect(szpieg).toHaveBeenCalled());
    expect(szpieg).toHaveBeenCalledWith({ queryKey: meetingKeys.event(WYDARZENIE) });
  });

  it("zapis konfiguracji kasuje gałąź wydarzenia", async () => {
    const { result, queryClient } = renderHookWithQueryClient(() =>
      useSaveMeetingSettings(WYDARZENIE),
    );
    const szpieg = vi.spyOn(queryClient, "invalidateQueries");
    result.current.mutate({
      eventId: WYDARZENIE,
      isEnabled: true,
      timezone: "Europe/Warsaw",
      slotMinutes: 20,
      breakMinutes: 5,
      dayStartTime: "09:00",
      dayEndTime: "17:00",
      meetingDays: ["2026-09-10"],
      invitesOpenAt: null,
      invitesCloseAt: null,
      inviteExpiresAfterHours: 48,
      maxInvitesPerPerson: null,
      maxMeetingsPerDay: null,
      visibility: "everyone",
      introPl: "",
      introEn: "",
    });
    await waitFor(() => expect(szpieg).toHaveBeenCalled());
    expect(szpieg).toHaveBeenCalledWith({ queryKey: meetingKeys.event(WYDARZENIE) });
  });

  it.each([
    ["null", null],
    ["pusty napis", ""],
  ])("mutacja bez wydarzenia (%s) NIE kasuje niczyjej pamięci", async (_opis, eventId) => {
    // Unieważnienie z pustym identyfikatorem trafiłoby w gałąź `["event-meetings", ""]`,
    // czyli w nic - ale gdyby kiedyś fabryka kluczy skróciła się do `all`,
    // wyczyściłoby WSZYSTKIE wydarzenia naraz.
    const { result, queryClient } = renderHookWithQueryClient(() => useDeleteMeetingTable(eventId));
    const szpieg = vi.spyOn(queryClient, "invalidateQueries");
    result.current.mutate("t-1");
    await waitFor(() => expect(h.deleteTable).toHaveBeenCalled());
    expect(szpieg).not.toHaveBeenCalled();
  });

  it("nieudana mutacja NIE unieważnia gałęzi", async () => {
    // Odmowa bazy (np. `table_in_use`) niczego nie zmieniła, więc odświeżanie
    // list byłoby pustym round-tripem, a migający ekran sugerowałby sukces.
    h.deleteTable.mockRejectedValue(new Error("table_in_use: table is used by 3 meetings"));
    const { result, queryClient } = renderHookWithQueryClient(() =>
      useDeleteMeetingTable(WYDARZENIE),
    );
    const szpieg = vi.spyOn(queryClient, "invalidateQueries");
    result.current.mutate("t-1");
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(szpieg).not.toHaveBeenCalled();
    expect(result.current.error?.message).toContain("table_in_use");
  });
});

// ---------------------------------------------------------------------------
// KOLIZJE BAZY - ostatnia bramka giełdy widziana od strony hooków
//
// Wszystkie kody w tej sekcji są PRZEPISANE z `RAISE EXCEPTION` w migracji
// `20260823190000_event_meetings.sql` i z asercji odmów w harnessie
// `scripts/events-harness/runtime_test.d/60_meetings.sql`. Nie są wymyślone
// i nie wolno ich „poprawić" na ładniejsze: klucz przed dwukropkiem jest
// KONTRAKTEM, z którego `adminMeetingFailure` czyta zdanie dla organizatora.
//
// Warstwa hooków ma wobec odmowy dokładnie dwa obowiązki i oba są tu mierzone:
//   (1) NIE unieważniać gałęzi - nic się nie zmieniło, więc odświeżenie list
//       byłoby pustym obiegiem, a migający ekran fałszywym potwierdzeniem;
//   (2) PRZEPUŚCIĆ komunikat bez zmian - to jedyne wejście mapera odmów.
// ---------------------------------------------------------------------------

/**
 * Ładunek „umów spotkanie". Typ bierzemy z PARAMETRU MUTACJI, a nie z ręcznie
 * przepisanego kształtu - inaczej dodanie pola w `arrangeMeeting` przechodziłoby
 * tu bez jednego czerwonego testu.
 */
type Umowienie = Parameters<ReturnType<typeof useArrangeMeeting>["mutate"]>[0];

function umowienie(over: Partial<Umowienie> = {}): Umowienie {
  return {
    eventId: WYDARZENIE,
    requesterRegistrationId: ZAPIS_A,
    inviteeRegistrationId: ZAPIS_B,
    startsAt: "2026-09-10T09:00:00.000Z",
    ...over,
  };
}

describe("kolizje przy umawianiu spotkania - odmowa nie rusza pamięci podręcznej", () => {
  it.each([
    // (A) `event_meetings_table_no_overlap`: JEDNO MIEJSCE przy stoliku nie
    //     obsłuży dwóch zajętych spotkań w tym samym oknie.
    [
      "to samo MIEJSCE przy stoliku w tym samym oknie",
      "table_busy: the seat at this table is already taken in this slot",
    ],
    // (B) `event_meeting_attendees_no_overlap`: jeden CZŁOWIEK, jedno spotkanie
    //     w danej chwili - nawet przy innym stoliku.
    [
      "ta sama OSOBA na dwóch spotkaniach w tym samym oknie",
      "participant_busy: one of the parties already has a meeting in this slot",
    ],
    // Pojemność wyczerpana do końca: nie ma już wolnego miejsca przy ŻADNYM
    // czynnym stoliku w tym slocie.
    ["stoliki zajęte DO KOŃCA", "no_free_table: no free seat at any active table in this slot"],
    // Numer miejsca poza pojemnością stolika.
    [
      "numer MIEJSCA poza pojemnością stolika",
      "table_seat_out_of_range: seat 3 exceeds table capacity 2",
    ],
    // Stolik wyłączony nie przyjmuje nowych spotkań.
    ["stolik WYŁĄCZONY", "table_inactive: the table is switched off for new meetings"],
    // Termin poza siatką liczoną z konfiguracji giełdy (np. 09:07 przy slocie 30 min).
    ["termin POZA SIATKĄ slotów", "slot_not_in_grid: the slot does not belong to the meeting grid"],
    // Okno dostępności poza godzinami wydarzenia: slot jest w siatce, ale żadna
    // ze stron nie ma na niego OTWARTEGO okna.
    [
      "brak OTWARTEGO okna dostępności strony proszącej",
      "requester_unavailable: the requester has no open availability window for this slot",
    ],
    [
      "brak OTWARTEGO okna dostępności strony zapraszanej",
      "invitee_unavailable: the invitee has no open availability window for this slot",
    ],
    // Zaproszenie do samego siebie.
    ["spotkanie z SAMYM SOBĄ", "self_invite: a person cannot meet themselves"],
    // Zaproszenie osoby spoza wydarzenia (zapis nieuczestniczący albo obcy).
    [
      "osoba SPOZA wydarzenia po stronie zapraszanej",
      "invitee_not_participating: the second person is not a participating registration",
    ],
    [
      "osoba SPOZA wydarzenia po stronie proszącej",
      "requester_not_participating: the first person is not a participating registration",
    ],
  ])("ODMOWA „%s” nie unieważnia gałęzi i dojeżdża w całości", async (_opis, komunikat) => {
    h.arrange.mockRejectedValue(new Error(komunikat));
    const { result, queryClient } = renderHookWithQueryClient(() => useArrangeMeeting(WYDARZENIE));
    const szpieg = vi.spyOn(queryClient, "invalidateQueries");

    result.current.mutate(umowienie());

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(szpieg).not.toHaveBeenCalled();
    // Klucz techniczny musi przetrwać w CAŁOŚCI - to jedyne wejście mapera odmów.
    expect(result.current.error?.message).toBe(komunikat);
  });

  it("UDANE umówienie unieważnia gałąź - miejsce przy stoliku właśnie zniknęło", async () => {
    const { result, queryClient } = renderHookWithQueryClient(() => useArrangeMeeting(WYDARZENIE));
    const szpieg = vi.spyOn(queryClient, "invalidateQueries");

    result.current.mutate(umowienie({ tableId: "t-1" }));

    await waitFor(() => expect(szpieg).toHaveBeenCalled());
    expect(szpieg).toHaveBeenCalledWith({ queryKey: meetingKeys.event(WYDARZENIE) });
    expect(h.arrange).toHaveBeenCalledWith(umowienie({ tableId: "t-1" }));
  });
});

describe("odwołanie spotkania PO akceptacji - miejsce przy stoliku wraca do puli", () => {
  it("odwołanie przelicza JEDNOCZEŚNIE listę, stoliki i statystyki", async () => {
    // Ograniczenie `event_meetings_table_no_overlap` jest CZĘŚCIOWE po statusie,
    // więc odwołane spotkanie naprawdę zwalnia miejsce i termin dla następnej
    // pary (harness `60_meetings.sql`: „ODWOLANE spotkanie zwalnia miejsce
    // i termin dla nastepnego"). Ekran, który po odwołaniu nadal pokazuje
    // stolik jako pełny, kłamie o przepustowości giełdy - a organizator
    // podejmuje na tej liczbie decyzję, ilu jeszcze osobom obiecać rozmowę.
    h.stats.mockResolvedValue({ confirmed: 1, cancelled: 0, seats_count: 4 });

    const { result } = renderHookWithQueryClient(() => {
      const lista = useAdminMeetings(zapytanie({ status: "accepted" }));
      const stoliki = useMeetingTables(WYDARZENIE);
      const statystyki = useMeetingStats(WYDARZENIE);
      const status = useSetMeetingStatus(WYDARZENIE);
      return { lista, stoliki, statystyki, status };
    });

    await waitFor(() => expect(result.current.statystyki.isSuccess).toBe(true));
    expect(h.meetings).toHaveBeenCalledTimes(1);
    expect(h.tables).toHaveBeenCalledTimes(1);
    expect(h.stats).toHaveBeenCalledTimes(1);

    h.stats.mockResolvedValue({ confirmed: 0, cancelled: 1, seats_count: 4 });
    result.current.status.mutate({ meetingId: "m-1", status: "cancelled", reason: "sala zajęta" });

    await waitFor(() => expect(h.stats).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(h.tables).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(h.meetings).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(result.current.statystyki.data?.cancelled).toBe(1));
    expect(result.current.statystyki.data?.confirmed).toBe(0);
  });

  it.each([
    // Odwołanie spotkania, które nie jest już ani otwartym zaproszeniem, ani
    // przyjętym spotkaniem - np. drugie kliknięcie „Odwołaj".
    [
      "spotkanie NIE JEST już aktywne",
      "meeting_not_active: only an open invitation or an accepted meeting can be cancelled",
    ],
    // Frekwencję da się odznaczyć wyłącznie na spotkaniu PRZYJĘTYM.
    [
      "frekwencja na spotkaniu NIEPRZYJĘTYM",
      "attendance_needs_accepted: attendance can only be marked on an accepted meeting",
    ],
    // Ostatnia bramka bazy: przepięcie spotkania na innego człowieka zaciera
    // ślad i jest zabronione TRIGGEREM, a nie regułą interfejsu. Klient sam
    // takiej zmiany nie wysyła - ale gdyby kiedykolwiek wysłał (import, druga
    // ścieżka zapisu), odmowa nie ma prawa zostać połknięta jako „nie udało się".
    [
      "próba PRZEPIĘCIA spotkania na innego człowieka",
      "meeting_identity_immutable: event and both parties are immutable",
    ],
  ])("ODMOWA „%s” zostawia pamięć podręczną nietkniętą", async (_opis, komunikat) => {
    h.setStatus.mockRejectedValue(new Error(komunikat));
    const { result, queryClient } = renderHookWithQueryClient(() =>
      useSetMeetingStatus(WYDARZENIE),
    );
    const szpieg = vi.spyOn(queryClient, "invalidateQueries");

    result.current.mutate({ meetingId: "m-1", status: "cancelled" });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(szpieg).not.toHaveBeenCalled();
    expect(result.current.error?.message).toBe(komunikat);
  });
});

describe("`null` i pusty napis to TEN SAM brak wydarzenia", () => {
  it.each([
    ["konfiguracja", (eventId: string | null) => useMeetingSettings(eventId), () => h.settings],
    ["statystyki", (eventId: string | null) => useMeetingStats(eventId), () => h.stats],
  ])(
    "%s: klucz dla `null` i dla „" + '""' + "” trafia w tę samą, PUSTĄ gałąź",
    async (_opis, hook, atrapa) => {
      // Studio podaje `null`, dopóki organizator nie wybierze wydarzenia,
      // a puste pole formularza daje `""`. Gdyby te dwa przypadki lądowały pod
      // różnymi kluczami, pamięć podręczna trzymałaby dwa „puste" wydarzenia
      // i pierwsze unieważnienie ominęłoby jedno z nich.
      const zNullem = renderHookWithQueryClient(() => hook(null));
      await waitFor(() => expect(zNullem.result.current.fetchStatus).toBe("idle"));
      expect(atrapa()).not.toHaveBeenCalled();

      const zPustym = renderHookWithQueryClient(() => hook(""));
      await waitFor(() => expect(zPustym.result.current.fetchStatus).toBe("idle"));
      expect(atrapa()).not.toHaveBeenCalled();

      const kluczNull = zNullem.queryClient
        .getQueryCache()
        .getAll()
        .map((query) => query.queryKey);
      const kluczPusty = zPustym.queryClient
        .getQueryCache()
        .getAll()
        .map((query) => query.queryKey);
      expect(kluczNull).toEqual(kluczPusty);
    },
  );
});

describe("useMeetingFreeSlots - brak wydarzenia po stronie wywołującego", () => {
  it("bez wydarzenia zapytanie stoi, a klucz spada do PUSTEJ gałęzi", async () => {
    // Dialog „Umów spotkanie" montuje się razem z zakładką, więc `eventId`
    // bywa jeszcze `null`. Klucz musi wtedy wylądować w gałęzi pustego
    // wydarzenia, a nie w gałęzi wydarzenia poprzedniego - inaczej terminy
    // jednej giełdy pokazałyby się przy drugiej.
    const { result, queryClient } = renderHookWithQueryClient(() =>
      useMeetingFreeSlots({
        eventId: null,
        aRegistrationId: ZAPIS_A,
        bRegistrationId: ZAPIS_B,
      }),
    );
    await waitFor(() => expect(result.current.fetchStatus).toBe("idle"));
    expect(h.freeSlots).not.toHaveBeenCalled();

    const klucze = queryClient
      .getQueryCache()
      .getAll()
      .map((query) => query.queryKey);
    expect(klucze).toContainEqual([...meetingKeys.event(""), "free-slots", ZAPIS_A, ZAPIS_B]);
    expect(klucze).not.toContainEqual([
      ...meetingKeys.event(WYDARZENIE),
      "free-slots",
      ZAPIS_A,
      ZAPIS_B,
    ]);
  });
});
