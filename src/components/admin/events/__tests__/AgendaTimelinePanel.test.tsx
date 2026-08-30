// Organizm „SIATKA CZASU" - sala (kolumna) x godzina (oś pionowa).
//
// PO CO TEN PLIK ISTNIEJE. Lista sesji odpowiada na pytanie „co jest
// w programie", siatka na pytanie „co dzieje się JEDNOCZEŚNIE" - i to drugie
// jest jedynym sposobem, żeby zobaczyć nachodzące się pasma. Raport tekstowy
// mówi CO jest nie tak, siatka pokazuje GDZIE, więc jej testem nie może być
// pusty grafik: trzon pliku to DWIE SESJE W TEJ SAMEJ SALI W NACHODZĄCYCH SIĘ
// GODZINACH, rozsunięte na dwa pasy jednej kolumny.
//
// CO TEN PLIK DOWODZI.
//   1. TRZY STANY MAJĄ TRZY WIDOKI, a „pusto" NIE MOŻE znaczyć „nie udało się".
//      Program bez sesji rysuje zdanie o pustce; odmowa bazy rysuje odmowę.
//   2. KOLIZJE SĄ PODŚWIETLONE NA KAFLU, a licznik w nagłówku liczy SESJE,
//      nie wiersze raportu: jedna sesja z dwiema sprzecznościami to jeden
//      problem do rozwiązania, nie dwa.
//   3. UKŁAD LICZY MODUŁ `agendaTimeline`, więc jest tu PRAWDZIWY - przedmiotem
//      dowodu jest to, co organizator widzi na ekranie po jego arytmetyce:
//      dwa pasy o połowie szerokości, kolumna „bez sali", oś godzin.
//   4. DZIEŃ WYBRANY KLIKNIĘCIEM MOŻE ZNIKNĄĆ (ostatnia sesja dnia skasowana) -
//      siatka wraca wtedy na pierwszy dzień zamiast rysować pustkę.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE. (1) Arytmetyki układu - ma własny plik
// `lib/events/__tests__/agendaTimeline.test.ts`. (2) Raportu tekstowego -
// `AgendaConflictsPanel.test.tsx`. (3) Hooków - `useEventSessions.test.ts`.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { axeViolations, summarize } from "@/test/axe";
import { TIMELINE_MINUTE_PX } from "@/lib/events/agendaTimeline";
import type { AgendaConflictRow, EventRoomRow, EventSessionRow } from "@/lib/events/sessionsApi";

const h = vi.hoisted(() => ({
  language: "pl",
  sessions: [] as EventSessionRow[] | undefined,
  rooms: [] as EventRoomRow[] | undefined,
  conflicts: [] as AgendaConflictRow[] | undefined,
  sessionsLoading: false,
  roomsLoading: false,
  sessionsError: null as Error | null,
}));

vi.mock("react-i18next", async () =>
  (await import("@/test/i18nStub")).reactI18nextStub(() => h.language),
);

// Nakładka słownika agendy jest efektem ubocznym importu i ciągnie realny
// i18next; `ensureAgendaI18n` to sam znacznik wywołania, więc atrapa może być
// pusta - a bez niej cały plik ładowałby drugi silnik tłumaczeń.
vi.mock("@/lib/i18n-admin-event-agenda", () => ({ ensureAgendaI18n: () => undefined }));

vi.mock("@/lib/events/adminAgendaErrors", () => ({
  adminAgendaErrorMessage: (error: unknown) =>
    `odmowa:${error instanceof Error ? error.message : String(error)}`,
}));

vi.mock("@/lib/events/useEventSessions", () => ({
  useEventSessions: () => ({
    data: h.sessions,
    isLoading: h.sessionsLoading,
    error: h.sessionsError,
  }),
  useEventRooms: () => ({ data: h.rooms, isLoading: h.roomsLoading, error: null }),
  useAgendaConflicts: () => ({ data: h.conflicts, isLoading: false, error: null }),
}));

const { AgendaTimelinePanel } =
  await import("@/components/admin/events/organisms/AgendaTimelinePanel");

const EVENT_ID = "e5000000-0000-4000-8000-0000000000a1";
const STREFA = "Europe/Warsaw";
const SALA_A = "a6000000-0000-4000-8000-000000000001";
const SALA_B = "a6000000-0000-4000-8000-000000000002";
const SESJA_1 = "aa000000-0000-4000-8000-000000000001";
const SESJA_2 = "aa000000-0000-4000-8000-000000000002";
const SESJA_3 = "aa000000-0000-4000-8000-000000000003";

/**
 * Kolumny, które RPC oddaje jako `NULL`, a generator typuje jako `number`.
 *
 * `admin_event_rooms_list` oddaje `capacity` wprost z tabeli - sala bez
 * zadeklarowanej pojemności ma tam `NULL`, a sygnatura `RETURNS TABLE` nie
 * niesie `NOT NULL`. To samo dotyczy kolumn raportu kolizji, które
 * `admin_event_agenda_conflicts` uzupełnia literałami `NULL::uuid`,
 * `NULL::text` i `NULL::integer` w trzech z czterech gałęzi `UNION ALL`.
 *
 * DLACZEGO RZUTOWANIE JEST TU JEDYNYM WYJŚCIEM. Fixture musi mieć DOKŁADNIE
 * kształt wiersza z generatora - własny, poluzowany typ przestałby pilnować
 * sygnatury RPC, a to właśnie ona ma tu pęknąć, gdy zmieni się kolumna.
 * Wartość zgodna z typem (pusty napis, zero) byłaby KŁAMSTWEM o odpowiedzi
 * bazy i schowałaby dokładnie te przypadki, dla których ten plik istnieje.
 * Dług należy do wygenerowanych typów i znika, gdy generator nauczy się
 * `NOT NULL` (pilnuje tego `check:types-freshness`).
 */
const BRAK_POJEMNOSCI = null as unknown as number;
const BRAK_NAPISU = null as unknown as string;
const BRAK_LICZBY = null as unknown as number;

/** Wiersz `admin_event_sessions_list` - pełny kształt sygnatury RPC. */
function sessionRow(overrides: Partial<EventSessionRow> = {}): EventSessionRow {
  return {
    allow_overlap: false,
    cancelled_at: "",
    cancelled_count: 0,
    capacity: 0,
    chatham_house: false,
    children_count: 0,
    description_en: "",
    description_pl: "",
    duration_minutes: 60,
    ends_at: "2026-09-01T08:00:00.000Z",
    event_id: EVENT_ID,
    format: "onsite",
    has_recording: false,
    has_stream: false,
    id: SESJA_1,
    is_private: false,
    min_tier_rank: 0,
    parent_session_id: "",
    published_at: "",
    registered_count: 0,
    requires_signup: false,
    room_capacity: 120,
    room_id: SALA_A,
    room_name: "Sala Główna",
    seats_left: 0,
    sort_order: 10,
    speakers_count: 0,
    // 07:00 UTC = 09:00 w Warszawie (CEST).
    starts_at: "2026-09-01T07:00:00.000Z",
    status: "published",
    title_en: "Opening",
    title_pl: "Otwarcie",
    track_accent_color: "",
    track_id: "",
    track_key: "",
    track_name_en: "",
    track_name_pl: "",
    waitlist_count: 0,
    ...overrides,
  };
}

/** Wiersz `admin_event_rooms_list`. */
function roomRow(overrides: Partial<EventRoomRow> = {}): EventRoomRow {
  return {
    booked_minutes: 60,
    capacity: 120,
    created_at: "2026-08-01T09:00:00.000Z",
    event_id: EVENT_ID,
    floor: "Parter",
    id: SALA_A,
    is_active: true,
    location_note: "",
    name: "Sala Główna",
    sessions_count: 1,
    sort_order: 10,
    updated_at: "2026-08-01T09:00:00.000Z",
    ...overrides,
  };
}

/** Wiersz `admin_event_agenda_conflicts` - tu liczy się WYŁĄCZNIE `session_id`. */
function conflictRow(sessionId: string, kind: string): AgendaConflictRow {
  return {
    actual_value: BRAK_LICZBY,
    expected_value: BRAK_LICZBY,
    kind,
    other_session_id: BRAK_NAPISU,
    other_title_en: BRAK_NAPISU,
    other_title_pl: BRAK_NAPISU,
    session_id: sessionId,
    session_starts_at: "2026-09-01T07:00:00.000Z",
    session_title_en: "Opening",
    session_title_pl: "Otwarcie",
    subject_id: BRAK_NAPISU,
    subject_name: BRAK_NAPISU,
  };
}

const SALE = [roomRow(), roomRow({ id: SALA_B, name: "Sala Kraków", capacity: 20 })];

/**
 * DWIE SESJE W TEJ SAMEJ SALI W NACHODZĄCYCH SIĘ GODZINACH.
 *
 * Baza takiego stanu nie przyjmie przez RPC panelu (ograniczenie wykluczające
 * `event_sessions_room_no_overlap`, tłumaczone na `room_conflict`), ale siatka
 * musi umieć go NARYSOWAĆ: dane trafiają do niej także z importu, z zapisu
 * wprost na tabelę i z sesji, którą ktoś przesunął w drugiej karcie.
 */
const KOLIZJA_SALI = [
  sessionRow({
    id: SESJA_1,
    title_pl: "Otwarcie",
    starts_at: "2026-09-01T07:00:00.000Z",
    ends_at: "2026-09-01T08:00:00.000Z",
  }),
  sessionRow({
    id: SESJA_2,
    title_pl: "Panel południowy",
    title_en: "Noon panel",
    starts_at: "2026-09-01T07:30:00.000Z",
    ends_at: "2026-09-01T08:30:00.000Z",
  }),
];

function renderuj(props: { onOpenSession?: (sessionId: string) => void } = {}) {
  return render(
    <AgendaTimelinePanel
      eventId={EVENT_ID}
      timezone={STREFA}
      onOpenSession={props.onOpenSession}
    />,
  );
}

/** Kafel sesji po jej widocznym tytule. */
function kafel(tytul: string): HTMLElement {
  const node = screen
    .getAllByRole("button")
    .find((button) => button.textContent?.includes(tytul) === true);
  if (node === undefined) throw new Error(`brak kafla „${tytul}” na siatce`);
  return node;
}

beforeEach(() => {
  h.language = "pl";
  h.sessions = [];
  h.rooms = SALE;
  h.conflicts = [];
  h.sessionsLoading = false;
  h.roomsLoading = false;
  h.sessionsError = null;
});

describe("trzy stany siatki", () => {
  it("wczytywanie sesji pokazuje postęp i NIE mówi o pustce", () => {
    h.sessions = undefined;
    h.conflicts = undefined;
    h.sessionsLoading = true;
    renderuj();

    expect(screen.getByText("adminEventAgenda.timeline.loading")).toBeTruthy();
    expect(screen.queryByText("adminEventAgenda.timeline.empty")).toBeNull();
  });

  // SALE SĄ KOLUMNAMI SIATKI, więc ich wczytywanie też jest wczytywaniem
  // siatki - bez tego warunku ekran przez chwilę rysowałby kolumny z samych
  // identyfikatorów sal.
  it("wczytywanie SAL także pokazuje postęp, bo sale są kolumnami", () => {
    h.rooms = undefined;
    h.roomsLoading = true;
    renderuj();

    expect(screen.getByText("adminEventAgenda.timeline.loading")).toBeTruthy();
  });

  it("awaria mówi treścią odmowy i NIE mówi o pustce", () => {
    h.sessionsError = new Error("permission denied for function admin_event_sessions_list");
    renderuj();

    expect(
      screen.getByText("odmowa:permission denied for function admin_event_sessions_list"),
    ).toBeTruthy();
    expect(screen.queryByText("adminEventAgenda.timeline.empty")).toBeNull();
  });

  it("wczytywanie po nieudanej próbie bije awarię", () => {
    h.sessionsLoading = true;
    h.sessionsError = new Error("sessions_failed");
    renderuj();

    expect(screen.getByText("adminEventAgenda.timeline.loading")).toBeTruthy();
    expect(screen.queryByText("odmowa:sessions_failed")).toBeNull();
  });

  // „PUSTO" TO NIE „NIE UDAŁO SIĘ". Program bez sesji jest legalnym stanem
  // przed wpisaniem agendy i ma o tym mówić wprost.
  it("program bez sesji mówi o pustce i nie rysuje siatki", () => {
    renderuj();

    expect(screen.getByText("adminEventAgenda.timeline.empty")).toBeTruthy();
    expect(screen.queryByText("adminEventAgenda.timeline.hourAxis")).toBeNull();
  });

  // SESJA BEZ GODZINY ROZPOCZĘCIA nie ma dnia, więc nie ma jej na siatce -
  // i to nadal jest „pusto", a nie awaria.
  it("sesja bez godziny rozpoczęcia nie robi dnia - siatka nadal mówi o pustce", () => {
    h.sessions = [sessionRow({ starts_at: "" })];
    renderuj();

    expect(screen.getByText("adminEventAgenda.timeline.empty")).toBeTruthy();
  });

  it("nagłówek stoi także nad pustą siatką", () => {
    renderuj();

    expect(screen.getByText("adminEventAgenda.timeline.title")).toBeTruthy();
    expect(screen.getByText("adminEventAgenda.timeline.subtitle")).toBeTruthy();
  });
});

describe("dwie sesje w tej samej sali w nachodzących się godzinach", () => {
  // TO JEST GŁÓWNY POWÓD ISTNIENIA SIATKI. Lista sesji pokazałaby dwa wiersze
  // pod sobą i nic więcej; siatka rozsuwa je na DWA PASY tej samej kolumny,
  // czyli pokazuje, że w Sali Głównej o 09:30 dzieją się dwie rzeczy naraz.
  it("nachodzące się sesje jednej sali dostają DWA PASY po połowie szerokości", () => {
    h.sessions = KOLIZJA_SALI;
    renderuj();

    const pierwszy = kafel("Otwarcie");
    const drugi = kafel("Panel południowy");
    expect(pierwszy.style.width).toBe("calc(50% - 4px)");
    expect(drugi.style.width).toBe("calc(50% - 4px)");
    expect(pierwszy.style.left).toBe("calc(0% + 2px)");
    expect(drugi.style.left).toBe("calc(50% + 2px)");
  });

  it("obie nachodzące sesje stoją w JEDNEJ kolumnie - bo to jedna sala", () => {
    h.sessions = KOLIZJA_SALI;
    renderuj();

    // Kolumna sali jest jedna, więc nagłówek „Sala Główna" pojawia się raz.
    expect(screen.getAllByText("Sala Główna")).toHaveLength(1);
    expect(screen.queryByText("Sala Kraków")).toBeNull();
  });

  // KONTRAPUNKT: ta sama godzina w INNEJ sali jest legalna i baza ją przyjmuje.
  // Siatka ma to pokazać jako dwie kolumny po pełnej szerokości, a nie jako
  // kolizję - inaczej cały równoległy program wyglądałby na błąd.
  it("te same godziny w DWÓCH salach to dwie kolumny po pełnej szerokości", () => {
    h.sessions = [
      sessionRow({ id: SESJA_1 }),
      sessionRow({
        id: SESJA_2,
        room_id: SALA_B,
        room_name: "Sala Kraków",
        title_pl: "Panel równoległy",
      }),
    ];
    renderuj();

    expect(kafel("Otwarcie").style.width).toBe("calc(100% - 4px)");
    expect(kafel("Panel równoległy").style.width).toBe("calc(100% - 4px)");
    expect(screen.getByText("Sala Główna")).toBeTruthy();
    expect(screen.getByText("Sala Kraków")).toBeTruthy();
  });

  // STYK W STYK NIE JEST NACHODZENIEM (przedział półotwarty `[)`), więc obie
  // sesje wracają na jeden pas.
  it("sesje styk w styk w jednej sali wracają na JEDEN pas", () => {
    h.sessions = [
      sessionRow({ id: SESJA_1, ends_at: "2026-09-01T08:00:00.000Z" }),
      sessionRow({
        id: SESJA_2,
        title_pl: "Panel południowy",
        starts_at: "2026-09-01T08:00:00.000Z",
        ends_at: "2026-09-01T09:00:00.000Z",
      }),
    ];
    renderuj();

    expect(kafel("Otwarcie").style.width).toBe("calc(100% - 4px)");
    expect(kafel("Panel południowy").style.width).toBe("calc(100% - 4px)");
  });

  // POZYCJA PIONOWA LICZY SIĘ W STREFIE WYDARZENIA. Sesja o 07:00 UTC to 09:00
  // w Warszawie, a oś zaczyna się o pełnej godzinie 9 - kafel siada więc na
  // zerze, a ten o 09:30 pół godziny niżej.
  it("kafel siada na minucie liczonej w strefie WYDARZENIA, nie przeglądarki", () => {
    h.sessions = KOLIZJA_SALI;
    renderuj();

    expect(kafel("Otwarcie").style.top).toBe("0px");
    expect(kafel("Panel południowy").style.top).toBe(`${30 * TIMELINE_MINUTE_PX}px`);
  });
});

describe("kolizje podświetlone na kaflu i policzone w nagłówku", () => {
  it("bez kolizji nagłówek NIE pokazuje licznika", () => {
    h.sessions = [sessionRow()];
    renderuj();

    expect(screen.queryByText(/timeline\.conflictCount/)).toBeNull();
    expect(screen.queryByText(/timeline\.conflictBadge/)).toBeNull();
  });

  it("kafel sesji z kolizją dostaje własne oznaczenie", () => {
    h.sessions = [sessionRow()];
    h.conflicts = [conflictRow(SESJA_1, "speaker_overlap")];
    renderuj();

    expect(kafel("Otwarcie").textContent).toContain("adminEventAgenda.timeline.conflictBadge");
    expect(kafel("Otwarcie").className).toContain("border-destructive");
  });

  it("kafel sesji BEZ kolizji zostaje przy zwykłej ramce", () => {
    h.sessions = KOLIZJA_SALI;
    h.conflicts = [conflictRow(SESJA_1, "speaker_overlap")];
    renderuj();

    expect(kafel("Panel południowy").className).toContain("bg-card");
    expect(kafel("Panel południowy").textContent).not.toContain(
      "adminEventAgenda.timeline.conflictBadge",
    );
  });

  // LICZNIK LICZY SESJE, NIE WIERSZE RAPORTU. Jedna sesja poza oknem wydarzenia,
  // która dodatkowo ma przekroczony limit, to JEDEN problem do rozwiązania -
  // dwójka w nagłówku kazałaby szukać drugiej sesji, której nie ma.
  it("licznik w nagłówku liczy SESJE, a nie wiersze raportu", () => {
    h.sessions = KOLIZJA_SALI;
    h.conflicts = [
      conflictRow(SESJA_1, "speaker_overlap"),
      conflictRow(SESJA_1, "outside_event_window"),
    ];
    renderuj();

    expect(screen.getByText("adminEventAgenda.timeline.conflictCount(count=1)")).toBeTruthy();
  });

  it("dwie różne sesje z kolizją dają dwójkę w liczniku", () => {
    h.sessions = KOLIZJA_SALI;
    h.conflicts = [conflictRow(SESJA_1, "speaker_overlap"), conflictRow(SESJA_2, "overbooked")];
    renderuj();

    expect(screen.getByText("adminEventAgenda.timeline.conflictCount(count=2)")).toBeTruthy();
  });

  // LICZNIK STOI TAKŻE WTEDY, GDY SIATKA JEST PUSTA - raport liczy się z danych
  // bazy, a nie z tego, co udało się narysować.
  // RAPORT KOLIZJI JEST OSOBNYM ZAPYTANIEM i bywa jeszcze w drodze, gdy sesje
  // i sale już przyszły. Siatka ma się wtedy narysować BEZ podświetleń, a nie
  // czekać - „jeszcze nie wiem o kolizjach" nie jest powodem, żeby chować program.
  it("raport kolizji jeszcze w drodze nie wstrzymuje siatki ani nie podświetla kafli", () => {
    h.sessions = KOLIZJA_SALI;
    h.conflicts = undefined;
    renderuj();

    expect(kafel("Otwarcie")).toBeTruthy();
    expect(screen.queryByText(/timeline\.conflictCount/)).toBeNull();
    expect(kafel("Otwarcie").className).toContain("bg-card");
  });

  it("licznik kolizji stoi w nagłówku nawet nad pustą siatką", () => {
    h.conflicts = [conflictRow(SESJA_1, "speaker_overlap")];
    renderuj();

    expect(screen.getByText("adminEventAgenda.timeline.conflictCount(count=1)")).toBeTruthy();
    expect(screen.getByText("adminEventAgenda.timeline.empty")).toBeTruthy();
  });
});

describe("kolumny siatki", () => {
  it("kolumna sali pokazuje nazwę i pojemność", () => {
    h.sessions = [sessionRow({ room_id: SALA_B, room_name: "Sala Kraków" })];
    renderuj();

    expect(screen.getByText("Sala Kraków")).toBeTruthy();
    expect(screen.getByText("adminEventAgenda.timeline.capacity(count=20)")).toBeTruthy();
  });

  it("sala bez zadeklarowanej pojemności NIE dostaje wiersza z pojemnością", () => {
    h.rooms = [roomRow({ capacity: BRAK_POJEMNOSCI })];
    h.sessions = [sessionRow()];
    renderuj();

    expect(screen.queryByText(/timeline\.capacity/)).toBeNull();
  });

  // SESJA BEZ SALI MA WŁASNĄ KOLUMNĘ, bo to najczęstsza rzecz do poprawienia
  // przed publikacją - schowanie jej znaczyłoby, że siatka kłamie o dniu.
  it("sesja bez sali dostaje kolumnę „bez przypisania”", () => {
    h.sessions = [sessionRow({ room_id: "", room_name: "" })];
    renderuj();

    expect(screen.getByText("adminEventAgenda.timeline.noRoom")).toBeTruthy();
    expect(kafel("Otwarcie")).toBeTruthy();
  });

  // SALA SPOZA LISTY (skasowana, ale wciąż wpięta w sesję) nie może zniknąć -
  // inaczej sesja przepadłaby razem z kolumną.
  it("sala spoza listy sal nadal daje kolumnę - sesja nie może zniknąć", () => {
    h.rooms = [];
    h.sessions = [sessionRow()];
    renderuj();

    expect(screen.getByText(SALA_A)).toBeTruthy();
    expect(kafel("Otwarcie")).toBeTruthy();
  });

  it("oś godzin zaczyna się na godzinie pierwszej sesji w strefie wydarzenia", () => {
    h.sessions = [sessionRow()];
    renderuj();

    expect(screen.getByText("adminEventAgenda.timeline.hourAxis")).toBeTruthy();
    expect(screen.getByText("09:00")).toBeTruthy();
    expect(screen.getByText("10:00")).toBeTruthy();
  });
});

describe("dni programu", () => {
  const DWA_DNI = [
    sessionRow({ id: SESJA_1 }),
    sessionRow({
      id: SESJA_2,
      title_pl: "Drugi dzień",
      starts_at: "2026-09-02T07:00:00.000Z",
      ends_at: "2026-09-02T08:00:00.000Z",
    }),
  ];

  it("jeden dzień programu NIE rysuje przełącznika dni", () => {
    h.sessions = [sessionRow()];
    renderuj();

    expect(screen.queryByRole("tablist")).toBeNull();
  });

  it("dwa dni programu dają dwa przyciski dnia, pierwszy wybrany", () => {
    h.sessions = DWA_DNI;
    renderuj();

    const dni = screen.getAllByRole("tab");
    expect(dni).toHaveLength(2);
    expect(dni[0].getAttribute("aria-selected")).toBe("true");
    expect(dni[1].getAttribute("aria-selected")).toBe("false");
    expect(kafel("Otwarcie")).toBeTruthy();
  });

  it("kliknięcie drugiego dnia przerysowuje siatkę na jego sesje", () => {
    h.sessions = DWA_DNI;
    renderuj();
    fireEvent.click(screen.getAllByRole("tab")[1]);

    expect(screen.getAllByRole("tab")[1].getAttribute("aria-selected")).toBe("true");
    expect(kafel("Drugi dzień")).toBeTruthy();
    expect(screen.queryByText("Otwarcie")).toBeNull();
  });

  // DZIEŃ WYBRANY KLIKNIĘCIEM MOŻE ZNIKNĄĆ - po skasowaniu ostatniej sesji dnia
  // indeks wskazuje poza listę. Siatka wraca wtedy na pierwszy dzień, zamiast
  // rysować „poza zakresem".
  it("po zniknięciu wybranego dnia siatka wraca na pierwszy, a nie na pustkę", () => {
    h.sessions = DWA_DNI;
    const { rerender } = renderuj();
    fireEvent.click(screen.getAllByRole("tab")[1]);
    expect(kafel("Drugi dzień")).toBeTruthy();

    h.sessions = [sessionRow({ id: SESJA_1 })];
    rerender(<AgendaTimelinePanel eventId={EVENT_ID} timezone={STREFA} />);

    expect(kafel("Otwarcie")).toBeTruthy();
    expect(screen.queryByRole("tablist")).toBeNull();
  });
});

describe("kafel sesji", () => {
  it("kafel niesie godziny, tytuł i nazwę pasma", () => {
    h.sessions = [sessionRow({ track_name_pl: "Cyfrowa", track_name_en: "Digital" })];
    renderuj();

    const node = kafel("Otwarcie");
    expect(node.textContent).toContain("09:00");
    expect(node.textContent).toContain("10:00");
    expect(node.textContent).toContain("Cyfrowa");
  });

  it("sesja bez pasma nie rysuje pustego wiersza pod tytułem", () => {
    h.sessions = [sessionRow()];
    renderuj();

    // Trzy węzły tekstowe: godziny, tytuł, i nic więcej.
    expect(kafel("Otwarcie").textContent).toBe("09:00-10:00Otwarcie");
  });

  it("kolor pasma ląduje na lewej krawędzi kafla", () => {
    h.sessions = [sessionRow({ track_accent_color: "#fa9346" })];
    renderuj();

    expect(kafel("Otwarcie").style.borderLeftWidth).toBe("3px");
  });

  it("sesja ODWOŁANA jest przekreślona i przygaszona", () => {
    h.sessions = [sessionRow({ status: "cancelled" })];
    renderuj();

    expect(kafel("Otwarcie").className).toContain("line-through");
    expect(kafel("Otwarcie").className).toContain("opacity-60");
  });

  it("wersja angielska bierze angielskie tytuły sesji i pasm", () => {
    h.language = "en";
    h.sessions = [sessionRow({ track_name_pl: "Cyfrowa", track_name_en: "Digital" })];
    renderuj();

    expect(kafel("Opening").textContent).toContain("Digital");
    expect(screen.queryByText("Otwarcie")).toBeNull();
  });

  it("kliknięcie kafla otwiera TĘ sesję", () => {
    const otworz = vi.fn();
    h.sessions = KOLIZJA_SALI;
    renderuj({ onOpenSession: otworz });
    fireEvent.click(kafel("Panel południowy"));

    expect(otworz).toHaveBeenCalledExactlyOnceWith(SESJA_2);
  });

  // SIATKA DZIAŁA TEŻ JAKO SAM PODGLĄD - bez `onOpenSession` kafel nie robi nic
  // i nie udaje, że da się go kliknąć.
  it("bez `onOpenSession` kliknięcie kafla nic nie robi i nie wywraca ekranu", () => {
    h.sessions = [sessionRow()];
    renderuj();
    fireEvent.click(kafel("Otwarcie"));

    expect(kafel("Otwarcie").className).not.toContain("hover:shadow-md");
  });
});

describe("dostępność", () => {
  it("siatka z kolizją sali nie ma naruszeń dostępności", async () => {
    h.sessions = KOLIZJA_SALI;
    h.conflicts = [conflictRow(SESJA_1, "speaker_overlap")];
    const { container } = renderuj({ onOpenSession: vi.fn() });

    const violations = await axeViolations(container);
    expect(violations, summarize(violations)).toEqual([]);
  });

  it("siatka z dwoma dniami nie ma naruszeń dostępności", async () => {
    h.sessions = [
      sessionRow({ id: SESJA_1 }),
      sessionRow({
        id: SESJA_3,
        title_pl: "Drugi dzień",
        starts_at: "2026-09-02T07:00:00.000Z",
        ends_at: "2026-09-02T08:00:00.000Z",
      }),
    ];
    const { container } = renderuj();

    const violations = await axeViolations(container);
    expect(violations, summarize(violations)).toEqual([]);
  });

  it("pusta siatka nie ma naruszeń dostępności", async () => {
    const { container } = renderuj();

    const violations = await axeViolations(container);
    expect(violations, summarize(violations)).toEqual([]);
  });
});
