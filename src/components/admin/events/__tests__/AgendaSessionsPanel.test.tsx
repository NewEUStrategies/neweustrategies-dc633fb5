// Organizm „LISTA SESJI PROGRAMU" - cztery stany zapytania i dziewięć akcji
// wiersza, z których trzy zmieniają stan publiczny agendy.
//
// CO TEN PLIK DOWODZI.
//   1. CZTERY STANY ZAPYTANIA MAJĄ CZTERY WIDOKI. Awaria NIE MOŻE mówić „nie ma
//      jeszcze sesji" - to nieprawda o stanie bazy, po której organizator wpisuje
//      program drugi raz. Pustka ma trzy różne napisy, bo pustka po filtrze,
//      pustka wydarzenia i pustka pasma to trzy różne decyzje.
//   2. FILTRY IDĄ DO BAZY, NIE DO TABLICY W PRZEGLĄDARCE. Asercja stoi na
//      ARGUMENCIE zapytania, nie na liczbie wierszy - lista wydarzenia potrafi
//      mieć setki sesji i filtrowanie po stronie klienta pokazywałoby wynik
//      z jednej strony wyników jako całość.
//   3. ZAKŁADKA PASMA TO INNY EKRAN Z TEGO SAMEGO ORGANIZMU: filtr ścieżki
//      znika (nie ma czego wybierać), zapytanie i tak jedzie z pasmem, a nowa
//      sesja rodzi się przypięta. Bez kontrapunktu (panel bez pasma) test nie
//      odróżniłby „ukryliśmy filtr w zakładce" od „ukryliśmy filtr wszystkim".
//   4. PUBLIKACJA JEST OPERACJĄ ZBIORCZĄ - jeden przycisk wysyła jednoelementową
//      listę identyfikatorów, a nie „drugie RPC dla jednej sesji". Asercja jest
//      na kształcie ładunku, bo to on jest kontraktem z bazą.
//   5. TRWAJĄCE ŻĄDANIE GASI PRZYCISKI STANU. Bez tego dwa kliknięcia w
//      „Opublikuj" to dwie operacje zbiorcze na tym samym wierszu.
//   6. ODMOWA BAZY DOCHODZI ZDANIEM I NIE KASUJE EKRANU. Usunięcie sesji
//      z zapisami jest odmawiane (`session_has_signups`) - to jest normalna
//      droga tego ekranu, nie awaria, więc lista musi po niej stać dalej.
//   7. KOLEJNOŚĆ WIERSZY POCHODZI Z BAZY. Organizm liczy z listy tylko dwie
//      rzeczy: następną pozycję sortowania i licznik sesji bez ścieżki.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE. (1) Molekuły okna sesji - ma własny plik
// `EventSessionDialog.test.tsx`; tutaj jest atrapą, bo przedmiotem dowodu jest
// to, CO organizm do niej wysyła i co robi z jej odpowiedzią. (2) Diagramu
// struktury - `AgendaStructureDiagram.test.tsx`. (3) Słownika odmów bazy -
// `lib/events/__tests__` ma jego tabelę; tu wystarczy dowód, że odmowa DOCHODZI.
// (4) Hooków (klucze cache, unieważnianie) - zamockowane na poziomie MODUŁU.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import type {
  EventRoomRow,
  EventSessionInput,
  EventSessionRow,
  EventTrackRow,
} from "@/lib/events/sessionsApi";

/** Kształt drugiego argumentu `mutate` - tylko to, co organizm przekazuje. */
interface Wynik<T> {
  onSuccess: (value: T) => void;
  onError: (error: Error) => void;
}

/** Zapytanie listy sesji - to, co organizm wysyła do warstwy danych. */
interface ZapytanieSesji {
  eventId: string;
  q: string;
  trackId: string | null;
  roomId: string | null;
  status: string;
}

/** Propsy okna sesji przechwycone z ostatniego renderu. */
interface PropsyOkna {
  open: boolean;
  session: EventSessionRow | null;
  nextSortOrder: number;
  defaultTrackId: string | null;
  isSaving: boolean;
  tracks: readonly EventTrackRow[];
  rooms: readonly EventRoomRow[];
  sessions: readonly EventSessionRow[];
  timeZoneLabel: string;
}

const h = vi.hoisted(() => ({
  language: "pl",
  // Typ `unknown`, a nie `unknown[]`: KAŻDE z trzech zapytań może wrócić jako
  // `undefined` (jeszcze nie dojechało) i organizm musi to przeżyć.
  sessions: [] as unknown,
  tracks: [] as unknown,
  rooms: [] as unknown,
  isLoading: false,
  listError: null as Error | null,
  sessionQueries: [] as unknown[],
  saveInputs: [] as unknown[],
  saveFails: null as string | null,
  savePending: false,
  removeIds: [] as string[],
  removeFails: null as string | null,
  statusCalls: [] as { ids: readonly string[]; status: string }[],
  statusFails: null as string | null,
  statusPending: false,
  statusChanged: 1,
  okno: null as PropsyOkna | null,
  diagram: null as { unassignedCount: number; highlight: string; tracks: unknown[] } | null,
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("react-i18next", async () =>
  (await import("@/test/i18nStub")).reactI18nextStub(() => h.language),
);
vi.mock("sonner", () => ({ toast: { success: h.toastSuccess, error: h.toastError } }));

// Słownik odmów bazy ma własny plik testowy i ciągnie realny i18next; tutaj
// potrzebny jest wyłącznie dowód, że odmowa DOCHODZI do organizatora zdaniem,
// a nie kodem `23514`.
vi.mock("@/lib/events/adminAgendaErrors", () => ({
  adminAgendaErrorMessage: (error: unknown) =>
    `odmowa:${error instanceof Error ? error.message : String(error)}`,
}));

// Radix Select nie renderuje opcji bez pointer API - droplista jest natywnym
// `<select>`, którego wartość jedzie tą samą drogą (`onValueChange`).
vi.mock("@/components/atoms/FormSelect", () => ({
  FormSelect: ({
    id,
    value,
    options,
    onValueChange,
    "aria-label": ariaLabel,
  }: {
    id?: string;
    value: string;
    options: readonly { value: string; label: ReactNode }[];
    onValueChange: (next: string) => void;
    "aria-label"?: string;
  }) => (
    <select
      id={id}
      aria-label={ariaLabel}
      value={value}
      onChange={(event) => onValueChange(event.target.value)}
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {String(option.label)}
        </option>
      ))}
    </select>
  ),
}));

// Atrapa Radixa: `Root` renderuje dzieci zawsze, `Content` tylko przy otwartym
// pytaniu - portal nie jest wtedy montowany, dokładnie jak w produkcji.
vi.mock("@/components/ui/alert-dialog", () => {
  let open = false;
  let setOpen: ((next: boolean) => void) | null = null;
  return {
    AlertDialog: ({
      open: isOpen,
      onOpenChange,
      children,
    }: {
      open: boolean;
      onOpenChange: (next: boolean) => void;
      children: ReactNode;
    }) => {
      open = isOpen;
      setOpen = onOpenChange;
      return <div>{children}</div>;
    },
    AlertDialogContent: ({ children }: { children: ReactNode }) =>
      open ? <div role="alertdialog">{children}</div> : null,
    AlertDialogHeader: ({ children }: { children: ReactNode }) => <div>{children}</div>,
    AlertDialogTitle: ({ children }: { children: ReactNode }) => <h2>{children}</h2>,
    AlertDialogDescription: ({ children }: { children: ReactNode }) => <p>{children}</p>,
    AlertDialogFooter: ({ children }: { children: ReactNode }) => <div>{children}</div>,
    AlertDialogCancel: ({ children }: { children: ReactNode }) => (
      <button type="button" onClick={() => setOpen?.(false)}>
        {children}
      </button>
    ),
    AlertDialogAction: ({ children, onClick }: { children: ReactNode; onClick?: () => void }) => (
      <button type="button" onClick={onClick}>
        {children}
      </button>
    ),
  };
});

// Okno sesji ma własny plik testowy. Tutaj liczy się WYŁĄCZNIE to, z czym
// organizm je otwiera - dlatego atrapa zapisuje propsy i daje dwa przyciski
// odpowiadające obu wyjściom z okna.
vi.mock("@/components/admin/events/molecules/EventSessionDialog", () => ({
  EventSessionDialog: (
    props: PropsyOkna & {
      onSubmit: (input: EventSessionInput) => void;
      onOpenChange: (open: boolean) => void;
    },
  ) => {
    h.okno = props;
    if (!props.open) return null;
    return (
      <div role="dialog" aria-label="okno-sesji">
        <button
          type="button"
          onClick={() =>
            props.onSubmit({ id: props.session?.id ?? null } as unknown as EventSessionInput)
          }
        >
          zapisz-sesje
        </button>
        <button type="button" onClick={() => props.onOpenChange(false)}>
          zamknij-sesje
        </button>
      </div>
    );
  },
}));

// Diagram struktury liczy tylko to, co dostanie - jego własne reguły mają
// osobny plik. Atrapa przechwytuje ładunek, bo licznik „bez ścieżki" jest
// wyliczany PRZEZ TEN organizm.
vi.mock("@/components/admin/events/molecules/AgendaStructureDiagram", () => ({
  AgendaStructureDiagram: (props: {
    tracks: unknown[];
    unassignedCount: number;
    highlight: string;
  }) => {
    h.diagram = props;
    return <div aria-label="diagram-struktury" />;
  },
}));

vi.mock("@/lib/events/useEventSessions", () => ({
  useEventTracks: () => ({ data: h.tracks }),
  useEventRooms: () => ({ data: h.rooms }),
  useEventSessions: (query: ZapytanieSesji) => {
    h.sessionQueries.push(query);
    return { data: h.sessions, isLoading: h.isLoading, error: h.listError };
  },
  useSaveEventSession: () => ({
    isPending: h.savePending,
    mutate: (input: EventSessionInput, res: Wynik<string>) => {
      h.saveInputs.push(input);
      if (h.saveFails !== null) res.onError(new Error(h.saveFails));
      else res.onSuccess("nowe-id");
    },
  }),
  useDeleteEventSession: () => ({
    isPending: false,
    mutate: (id: string, res: Wynik<boolean>) => {
      h.removeIds.push(id);
      if (h.removeFails !== null) res.onError(new Error(h.removeFails));
      else res.onSuccess(true);
    },
  }),
  useSetSessionsStatus: () => ({
    isPending: h.statusPending,
    mutate: (input: { ids: readonly string[]; status: string }, res: Wynik<number>) => {
      h.statusCalls.push(input);
      if (h.statusFails !== null) res.onError(new Error(h.statusFails));
      else res.onSuccess(h.statusChanged);
    },
  }),
}));

const { AgendaSessionsPanel } =
  await import("@/components/admin/events/organisms/AgendaSessionsPanel");

const EVENT_ID = "11111111-1111-4111-8111-111111111111";
const STREFA = "Europe/Warsaw";

/** Wiersz `admin_event_sessions_list` - pełny kształt sygnatury, nie wycinek. */
function sessionRow(overrides: Partial<EventSessionRow> = {}): EventSessionRow {
  return {
    allow_overlap: true,
    cancelled_at: "",
    cancelled_count: 0,
    capacity: 0,
    chatham_house: false,
    children_count: 0,
    description_en: "",
    description_pl: "",
    duration_minutes: 60,
    ends_at: "2026-09-01T09:00:00.000Z",
    event_id: EVENT_ID,
    format: "onsite",
    has_recording: false,
    has_stream: false,
    id: "session-a",
    is_private: false,
    min_tier_rank: 0,
    parent_session_id: "",
    published_at: "",
    registered_count: 0,
    requires_signup: false,
    room_capacity: 0,
    room_id: "",
    room_name: "",
    seats_left: 0,
    sort_order: 10,
    speakers_count: 0,
    starts_at: "2026-09-01T08:00:00.000Z",
    status: "draft",
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

/** Wiersz `admin_event_tracks_list` - pełny kształt sygnatury. */
function trackRow(overrides: Partial<EventTrackRow> = {}): EventTrackRow {
  return {
    accent_color: "#fa9346",
    cover_url: "",
    created_at: "2026-08-01T09:00:00.000Z",
    default_room_id: "",
    default_room_name: "",
    description_en: "",
    description_pl: "",
    draft_count: 0,
    event_id: EVENT_ID,
    first_starts_at: "",
    id: "track-a",
    is_active: true,
    is_public: true,
    key: "sciezka_cyfrowa",
    last_ends_at: "",
    minutes_total: 0,
    name_en: "Digital Track",
    name_pl: "Ścieżka Cyfrowa",
    published_count: 0,
    sessions_count: 3,
    sort_order: 10,
    speakers_count: 0,
    tagline_en: "",
    tagline_pl: "",
    updated_at: "2026-08-01T09:00:00.000Z",
    ...overrides,
  };
}

/** Wiersz `admin_event_rooms_list` - pełny kształt sygnatury. */
function roomRow(overrides: Partial<EventRoomRow> = {}): EventRoomRow {
  return {
    booked_minutes: 0,
    capacity: 100,
    created_at: "2026-08-01T09:00:00.000Z",
    event_id: EVENT_ID,
    floor: "",
    id: "room-a",
    is_active: true,
    location_note: "",
    name: "Sala Plenarna",
    sessions_count: 0,
    sort_order: 10,
    updated_at: "2026-08-01T09:00:00.000Z",
    ...overrides,
  };
}

function renderuj(props: { lockedTrackId?: string | null; embedded?: boolean } = {}) {
  return render(
    <AgendaSessionsPanel
      eventId={EVENT_ID}
      timeZoneLabel={STREFA}
      lockedTrackId={props.lockedTrackId ?? null}
      embedded={props.embedded ?? false}
    />,
  );
}

/** Wiersz listy po widocznym tytule sesji. */
function wiersz(tytul: string): HTMLElement {
  const li = screen
    .getAllByRole("listitem")
    .find((node) => node.textContent?.includes(tytul) === true);
  if (li === undefined) throw new Error(`brak wiersza „${tytul}” na ekranie`);
  return li;
}

/** Ostatnie zapytanie, które organizm wysłał do warstwy danych. */
function ostatnieZapytanie(): ZapytanieSesji {
  const last = h.sessionQueries.at(-1);
  if (last === undefined) throw new Error("organizm nie zapytał o sesje");
  return last as ZapytanieSesji;
}

beforeEach(() => {
  h.language = "pl";
  h.sessions = [];
  h.tracks = [];
  h.rooms = [];
  h.isLoading = false;
  h.listError = null;
  h.sessionQueries = [];
  h.saveInputs = [];
  h.saveFails = null;
  h.savePending = false;
  h.removeIds = [];
  h.removeFails = null;
  h.statusCalls = [];
  h.statusFails = null;
  h.statusPending = false;
  h.statusChanged = 1;
  h.okno = null;
  h.diagram = null;
  h.toastSuccess.mockClear();
  h.toastError.mockClear();
});

describe("cztery stany zapytania", () => {
  it("wczytywanie pokazuje postęp i NIE mówi o pustce", () => {
    h.isLoading = true;
    renderuj();
    expect(screen.getByText("adminEventAgenda.sessions.loading")).toBeTruthy();
    expect(screen.queryByText("adminEventAgenda.sessions.empty")).toBeNull();
    expect(screen.queryByRole("listitem")).toBeNull();
  });

  // TO JEST UDOKUMENTOWANA KLASA BŁĘDU TEGO MODUŁU. „Nie ma jeszcze sesji" po
  // nieudanym zapytaniu to nieprawda o stanie bazy: organizator wpisuje wtedy
  // program drugi raz, bo widzi pusty ekran zamiast prośby o odświeżenie.
  it("awaria mówi treścią odmowy i NIE mówi o pustce", () => {
    h.listError = new Error("permission denied for function admin_event_sessions_list");
    renderuj();
    expect(
      screen.getByText("odmowa:permission denied for function admin_event_sessions_list"),
    ).toBeTruthy();
    expect(screen.queryByText("adminEventAgenda.sessions.empty")).toBeNull();
    expect(screen.queryByText("adminEventAgenda.sessions.loading")).toBeNull();
  });

  // KOLEJNOŚĆ WARUNKÓW JEST REGUŁĄ: zapytanie w locie po nieudanej próbie
  // pokazuje postęp, a nie stary błąd.
  it("wczytywanie po nieudanej próbie bije awarię", () => {
    h.isLoading = true;
    h.listError = new Error("session_list_failed");
    renderuj();
    expect(screen.getByText("adminEventAgenda.sessions.loading")).toBeTruthy();
    expect(screen.queryByText("odmowa:session_list_failed")).toBeNull();
  });

  it("pustka bez filtrów mówi „program jest pusty”", () => {
    renderuj();
    expect(screen.getByText("adminEventAgenda.sessions.empty")).toBeTruthy();
    expect(screen.queryByText("adminEventAgenda.sessions.emptyFiltered")).toBeNull();
  });

  // PUSTKA PO FILTRZE TO INNA INFORMACJA: program istnieje, tylko ten wycinek
  // jest pusty. Ten sam napis kazałby organizatorowi zakładać sesję, która już
  // jest - tylko pod innym filtrem.
  it("pustka po zawężeniu frazą mówi coś INNEGO", () => {
    renderuj();
    fireEvent.change(screen.getByLabelText("adminEventAgenda.sessions.searchPlaceholder"), {
      target: { value: "panel" },
    });
    expect(screen.getByText("adminEventAgenda.sessions.emptyFiltered")).toBeTruthy();
    expect(screen.queryByText("adminEventAgenda.sessions.empty")).toBeNull();
  });

  // TRZY ZAPYTANIA WRACAJĄ NIEZALEŻNIE. Katalog ścieżek albo sal, który jeszcze
  // nie dojechał, nie może wywrócić ekranu - filtry mają wtedy pokazać samą
  // pozycję „wszystkie", a nie pustą droplistę.
  it("katalogi jeszcze niewczytane nie wywracają ekranu", () => {
    h.sessions = undefined;
    h.tracks = undefined;
    h.rooms = undefined;
    renderuj();
    expect(screen.getByText("adminEventAgenda.sessions.empty")).toBeTruthy();
    expect(
      within(screen.getByLabelText("adminEventAgenda.nav.tracks")).getAllByRole("option"),
    ).toHaveLength(1);
    expect(
      within(screen.getByLabelText("adminEventAgenda.nav.rooms")).getAllByRole("option"),
    ).toHaveLength(1);
    expect(h.diagram).toEqual({ tracks: [], unassignedCount: 0, highlight: "sessions" });
  });

  it("lista z danymi rysuje wiersze i nie mówi ani o pustce, ani o postępie", () => {
    h.sessions = [sessionRow(), sessionRow({ id: "session-b", title_pl: "Panel" })];
    renderuj();
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    expect(screen.queryByText("adminEventAgenda.sessions.empty")).toBeNull();
    expect(screen.queryByText("adminEventAgenda.sessions.loading")).toBeNull();
  });
});

describe("filtry jadą do warstwy danych", () => {
  it("stan początkowy nie zawęża niczego", () => {
    renderuj();
    expect(ostatnieZapytanie()).toEqual({
      eventId: EVENT_ID,
      q: "",
      trackId: null,
      roomId: null,
      status: "all",
    });
  });

  // FILTR IDZIE DO BAZY, NIE DO TABLICY. Gdyby fraza filtrowała już wczytane
  // wiersze, organizator widziałby wynik z JEDNEJ strony wyników jako całość.
  it("fraza jedzie w zapytaniu", () => {
    h.sessions = [sessionRow()];
    renderuj();
    fireEvent.change(screen.getByLabelText("adminEventAgenda.sessions.searchPlaceholder"), {
      target: { value: "  panel  " },
    });
    expect(ostatnieZapytanie().q).toBe("  panel  ");
  });

  it("wybór ścieżki jedzie w zapytaniu, a „wszystkie” wraca do braku zawężenia", () => {
    h.tracks = [trackRow()];
    renderuj();
    const droplista = screen.getByLabelText("adminEventAgenda.nav.tracks");
    fireEvent.change(droplista, { target: { value: "track-a" } });
    expect(ostatnieZapytanie().trackId).toBe("track-a");
    fireEvent.change(droplista, { target: { value: "all" } });
    expect(ostatnieZapytanie().trackId).toBeNull();
  });

  it("wybór sali jedzie w zapytaniu, a „wszystkie” wraca do braku zawężenia", () => {
    h.rooms = [roomRow()];
    renderuj();
    const droplista = screen.getByLabelText("adminEventAgenda.nav.rooms");
    fireEvent.change(droplista, { target: { value: "room-a" } });
    expect(ostatnieZapytanie().roomId).toBe("room-a");
    fireEvent.change(droplista, { target: { value: "all" } });
    expect(ostatnieZapytanie().roomId).toBeNull();
  });

  it("wybór stanu jedzie w zapytaniu bez zamiany na wartość pustą", () => {
    renderuj();
    fireEvent.change(screen.getByLabelText("adminEventAgenda.sessionDialog.status"), {
      target: { value: "cancelled" },
    });
    expect(ostatnieZapytanie().status).toBe("cancelled");
  });

  it("droplista stanów niesie WSZYSTKIE wartości enuma i pozycję „wszystkie”", () => {
    renderuj();
    const opcje = within(screen.getByLabelText("adminEventAgenda.sessionDialog.status"))
      .getAllByRole("option")
      .map((option) => option.textContent);
    expect(opcje).toEqual([
      "adminEventAgenda.sessions.allStatuses",
      "adminEventAgenda.statuses.draft",
      "adminEventAgenda.statuses.published",
      "adminEventAgenda.statuses.cancelled",
    ]);
  });

  // ETYKIETA WYPROWADZANA Z LISTY, NIE Z WIERSZA. Ścieżka skasowana w innej
  // karcie znika z listy szybciej niż z filtra - wtedy zamiast pustej pozycji
  // pokazujemy identyfikator, żeby wybór dało się cofnąć.
  it("ścieżka spoza listy pokazuje identyfikator, a nie pustą pozycję", () => {
    h.tracks = [trackRow({ id: "track-a", name_pl: "Ścieżka Cyfrowa" })];
    renderuj();
    const opcje = within(screen.getByLabelText("adminEventAgenda.nav.tracks"))
      .getAllByRole("option")
      .map((option) => option.textContent);
    expect(opcje).toEqual(["adminEventAgenda.sessions.allTracks", "Ścieżka Cyfrowa"]);
  });

  it("sala bez nazwy w katalogu pokazuje identyfikator", () => {
    h.rooms = [roomRow({ id: "room-a", name: "Sala Plenarna" })];
    renderuj();
    const opcje = within(screen.getByLabelText("adminEventAgenda.nav.rooms"))
      .getAllByRole("option")
      .map((option) => option.textContent);
    expect(opcje).toEqual(["adminEventAgenda.sessions.allRooms", "Sala Plenarna"]);
  });

  it("po angielsku ścieżka bierze nazwę angielską, po polsku - polską", () => {
    h.tracks = [trackRow({ name_pl: "Ścieżka Cyfrowa", name_en: "Digital Track" })];
    h.language = "en";
    renderuj();
    expect(
      within(screen.getByLabelText("adminEventAgenda.nav.tracks")).getByText("Digital Track"),
    ).toBeTruthy();
  });

  it("ścieżka bez nazwy angielskiej nie znika z filtra w wersji angielskiej", () => {
    h.tracks = [trackRow({ name_pl: "Ścieżka Cyfrowa", name_en: "" })];
    h.language = "en";
    renderuj();
    expect(
      within(screen.getByLabelText("adminEventAgenda.nav.tracks")).getByText("Ścieżka Cyfrowa"),
    ).toBeTruthy();
  });

  // PASMO ZAŁOŻONE PO ANGIELSKU (redakcja anglojęzyczna) nie ma nazwy polskiej.
  // Bez tej gałęzi znikałoby z polskiego filtra I z diagramu naraz - a to
  // dwie różne miejsca, w których organizator go szuka.
  it("ścieżka bez nazwy polskiej nie znika z polskiego filtra ani z diagramu", () => {
    h.tracks = [trackRow({ name_pl: "", name_en: "Digital Track" })];
    renderuj();
    expect(
      within(screen.getByLabelText("adminEventAgenda.nav.tracks")).getByText("Digital Track"),
    ).toBeTruthy();
    expect(h.diagram?.tracks).toEqual([
      { id: "track-a", name: "Digital Track", accentColor: "#fa9346", sessionsCount: 3 },
    ]);
  });
});

describe("zakładka pasma - ten sam organizm, inny ekran", () => {
  it("filtr ścieżki znika, a zapytanie i tak jedzie z pasmem", () => {
    h.tracks = [trackRow()];
    renderuj({ lockedTrackId: "track-a", embedded: true });
    expect(screen.queryByLabelText("adminEventAgenda.nav.tracks")).toBeNull();
    expect(ostatnieZapytanie().trackId).toBe("track-a");
  });

  // KONTRAPUNKT: gdyby filtr zniknął WSZYSTKIM, asercja wyżej przechodziłaby na
  // regresji, która odbiera organizatorowi działający filtr.
  it("panel bez pasma filtr ścieżki MA", () => {
    h.tracks = [trackRow()];
    renderuj();
    expect(screen.getByLabelText("adminEventAgenda.nav.tracks")).toBeTruthy();
  });

  // PASMO NIE JEST FILTREM. Stan filtra startuje z wartością pasma, więc bez
  // osłony `lockedTrackId === null` pusta zakładka mówiłaby „zmień filtr",
  // choć nie ma czego zmieniać.
  it("pustka w zakładce pasma mówi o pasmie, a nie o filtrze", () => {
    renderuj({ lockedTrackId: "track-a", embedded: true });
    expect(screen.getByText("adminEventAgenda.tracks.workspace.sessionsEmpty")).toBeTruthy();
    expect(screen.queryByText("adminEventAgenda.sessions.emptyFiltered")).toBeNull();
  });

  it("fraza w zakładce pasma nadal przełącza napis na „pustka po filtrze”", () => {
    renderuj({ lockedTrackId: "track-a", embedded: true });
    fireEvent.change(screen.getByLabelText("adminEventAgenda.sessions.searchPlaceholder"), {
      target: { value: "panel" },
    });
    expect(screen.getByText("adminEventAgenda.sessions.emptyFiltered")).toBeTruthy();
  });

  it("nowa sesja w zakładce pasma rodzi się PRZYPIĘTA do pasma", () => {
    renderuj({ lockedTrackId: "track-a", embedded: true });
    fireEvent.click(screen.getByText("adminEventAgenda.sessions.addAction"));
    expect(h.okno?.defaultTrackId).toBe("track-a");
  });

  it("nowa sesja poza zakładką pasma nie ma domyślnego pasma", () => {
    renderuj();
    fireEvent.click(screen.getByText("adminEventAgenda.sessions.addAction"));
    expect(h.okno?.defaultTrackId).toBeNull();
  });
});

describe("nagłówek i diagram", () => {
  it("panel samodzielny ma tytuł, podtytuł i diagram struktury", () => {
    renderuj();
    expect(screen.getByText("adminEventAgenda.sessions.title")).toBeTruthy();
    expect(screen.getByText("adminEventAgenda.sessions.subtitle")).toBeTruthy();
    expect(h.diagram?.highlight).toBe("sessions");
  });

  // W ZAKŁADCE PASMA NAGŁÓWEK I DIAGRAM STOJĄ WYŻEJ. Powtórzony diagram czyta
  // się jak druga, niezgodna struktura tego samego programu.
  it("panel zagnieżdżony ma zdanie wprowadzające i NIE powtarza diagramu", () => {
    renderuj({ lockedTrackId: "track-a", embedded: true });
    expect(screen.getByText("adminEventAgenda.tracks.workspace.sessionsLead")).toBeTruthy();
    expect(screen.queryByText("adminEventAgenda.sessions.title")).toBeNull();
    expect(h.diagram).toBeNull();
  });

  // LICZNIK „BEZ ŚCIEŻKI" LICZY TEN ORGANIZM, więc to tutaj może się rozjechać.
  it("diagram dostaje liczbę sesji BEZ ścieżki, nie długość listy", () => {
    h.sessions = [
      sessionRow({ id: "a", track_id: "" }),
      sessionRow({ id: "b", track_id: "track-a" }),
      sessionRow({ id: "c", track_id: "" }),
    ];
    h.tracks = [trackRow()];
    renderuj();
    expect(h.diagram?.unassignedCount).toBe(2);
  });

  it("diagram dostaje ścieżki z nazwą w języku interfejsu", () => {
    h.tracks = [trackRow({ name_pl: "Ścieżka Cyfrowa", name_en: "Digital Track" })];
    h.language = "en";
    renderuj();
    expect(h.diagram?.tracks).toEqual([
      { id: "track-a", name: "Digital Track", accentColor: "#fa9346", sessionsCount: 3 },
    ]);
  });
});

describe("treść wiersza sesji", () => {
  it("tytuł idzie po polsku, a brak polskiego nie zostawia pustego wiersza", () => {
    h.sessions = [
      sessionRow({ id: "a", title_pl: "Otwarcie", title_en: "Opening" }),
      sessionRow({ id: "b", title_pl: "", title_en: "Closing" }),
    ];
    renderuj();
    expect(screen.getByText("Otwarcie")).toBeTruthy();
    expect(screen.getByText("Closing")).toBeTruthy();
  });

  it("po angielsku tytuł idzie po angielsku, a brak angielskiego wraca do polskiego", () => {
    h.language = "en";
    h.sessions = [
      sessionRow({ id: "a", title_pl: "Otwarcie", title_en: "Opening" }),
      sessionRow({ id: "b", title_pl: "Zamknięcie", title_en: "" }),
    ];
    renderuj();
    expect(screen.getByText("Opening")).toBeTruthy();
    expect(screen.getByText("Zamknięcie")).toBeTruthy();
  });

  it("sesja bez sali mówi to wprost, a sesja z salą pokazuje jej nazwę", () => {
    h.sessions = [
      sessionRow({ id: "a", title_pl: "Bez sali", room_name: "" }),
      sessionRow({ id: "b", title_pl: "Z salą", room_name: "Sala Plenarna" }),
    ];
    renderuj();
    expect(wiersz("Bez sali").textContent).toContain("adminEventAgenda.sessions.noRoom");
    expect(wiersz("Z salą").textContent).toContain("Sala Plenarna");
  });

  it("godzina jest formatowana w STREFIE WYDARZENIA, nie w strefie maszyny", () => {
    h.sessions = [sessionRow({ starts_at: "2026-09-01T08:00:00.000Z" })];
    renderuj();
    const oczekiwana = new Intl.DateTimeFormat("pl-PL", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: STREFA,
    }).format(new Date("2026-09-01T08:00:00.000Z"));
    expect(wiersz("Otwarcie").textContent).toContain(oczekiwana);
  });

  // GAŁĄŹ RATUNKOWA: sesja z niesparsowalną godziną nie może wygasić CAŁEJ
  // listy - reszta programu ma się dalej wyświetlić.
  it("sesja z niesparsowalną godziną nie wywraca listy", () => {
    h.sessions = [
      sessionRow({ id: "a", title_pl: "Zepsuta", starts_at: "nie-data" }),
      sessionRow({ id: "b", title_pl: "Zdrowa" }),
    ];
    renderuj();
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    expect(wiersz("Zepsuta").textContent).toContain("Invalid Date");
  });

  // GAŁĄŹ RATUNKOWA TEŻ MA JĘZYK. Napis awaryjny składany zawsze po polsku
  // byłby jedynym polskim fragmentem anglojęzycznego ekranu.
  it("gałąź ratunkowa składa godzinę w języku interfejsu", () => {
    h.language = "en";
    h.sessions = [sessionRow({ title_en: "Broken", starts_at: "nie-data" })];
    renderuj();
    expect(wiersz("Broken").textContent).toContain(new Date("nie-data").toLocaleString("en-GB"));
  });

  it("trzy warianty zapisów mówią trzy różne rzeczy", () => {
    h.sessions = [
      sessionRow({ id: "a", title_pl: "Bez zapisów", requires_signup: false }),
      sessionRow({ id: "b", title_pl: "Bez limitu", requires_signup: true, capacity: 0 }),
      sessionRow({
        id: "c",
        title_pl: "Z limitem",
        requires_signup: true,
        capacity: 120,
        seats_left: 8,
      }),
    ];
    renderuj();
    expect(
      within(wiersz("Bez zapisów")).getByText("adminEventAgenda.sessions.signupsOff"),
    ).toBeTruthy();
    expect(
      within(wiersz("Bez limitu")).getByText("adminEventAgenda.sessions.seatsUnlimited"),
    ).toBeTruthy();
    expect(
      within(wiersz("Z limitem")).getByText("adminEventAgenda.sessions.seats(capacity=120,left=8)"),
    ).toBeTruthy();
  });

  it("licznik podsesji pojawia się tylko tam, gdzie podsesje są", () => {
    h.sessions = [
      sessionRow({ id: "a", title_pl: "Z podsesjami", children_count: 3 }),
      sessionRow({ id: "b", title_pl: "Bez podsesji", children_count: 0 }),
    ];
    renderuj();
    expect(
      within(wiersz("Z podsesjami")).getByText("adminEventAgenda.sessions.childrenCount(count=3)"),
    ).toBeTruthy();
    expect(within(wiersz("Bez podsesji")).queryByText(/sessions\.childrenCount/)).toBeNull();
  });

  it("zasada Chatham House i sesja zamknięta są NAZWANE tylko tam, gdzie obowiązują", () => {
    h.sessions = [
      sessionRow({ id: "a", title_pl: "Zamknięta", chatham_house: true, is_private: true }),
      sessionRow({ id: "b", title_pl: "Otwarta" }),
    ];
    renderuj();
    const zamknieta = wiersz("Zamknięta");
    expect(within(zamknieta).getByText("adminEventAgenda.sessions.chathamHouse")).toBeTruthy();
    expect(within(zamknieta).getByText("adminEventAgenda.sessions.isPrivate")).toBeTruthy();
    const otwarta = wiersz("Otwarta");
    expect(within(otwarta).queryByText("adminEventAgenda.sessions.chathamHouse")).toBeNull();
    expect(within(otwarta).queryByText("adminEventAgenda.sessions.isPrivate")).toBeNull();
  });

  it("stan i format sesji stoją w wierszu jako osobne plakietki", () => {
    h.sessions = [sessionRow({ status: "published", format: "hybrid" })];
    renderuj();
    const li = wiersz("Otwarcie");
    expect(within(li).getByText("adminEventAgenda.statuses.published")).toBeTruthy();
    expect(within(li).getByText("adminEventAgenda.formats.hybrid")).toBeTruthy();
  });

  // KOLOR PASMA JEST JEDYNYM ZNACZNIKIEM PRZYNALEŻNOŚCI w wierszu. Sesja bez
  // pasma nie może dostać czarnego paska - to wyglądałoby na pasmo bez nazwy.
  it("pasek pasma bierze kolor ścieżki, a sesja bez pasma zostaje bez koloru", () => {
    h.sessions = [
      sessionRow({ id: "a", title_pl: "W paśmie", track_accent_color: "#fa9346" }),
      sessionRow({ id: "b", title_pl: "Bez pasma", track_accent_color: "" }),
    ];
    renderuj();
    const zKolorem = wiersz("W paśmie").querySelector("span[aria-hidden='true']");
    const bezKoloru = wiersz("Bez pasma").querySelector("span[aria-hidden='true']");
    expect(zKolorem?.getAttribute("style")).toContain("#fa9346");
    expect(bezKoloru?.getAttribute("style")).toContain("transparent");
  });

  // KOLEJNOŚĆ POCHODZI Z BAZY - RPC listy sortuje program po godzinie. Gdyby
  // organizm zaczął sortować sam, wynik rozjechałby się z publiczną agendą,
  // która czyta tę samą kolejność z bazy.
  it("wiersze stoją w kolejności otrzymanej z bazy, bez własnego sortowania", () => {
    h.sessions = [
      sessionRow({ id: "a", title_pl: "Popołudnie", starts_at: "2026-09-01T14:00:00.000Z" }),
      sessionRow({ id: "b", title_pl: "Poranek", starts_at: "2026-09-01T08:00:00.000Z" }),
    ];
    renderuj();
    const tytuly = screen
      .getAllByRole("listitem")
      .map((li) => li.querySelector("p.font-medium")?.textContent);
    expect(tytuly).toEqual(["Popołudnie", "Poranek"]);
  });
});

describe("publikacja, cofnięcie i odwołanie", () => {
  it("szkic ma przycisk publikacji i wysyła JEDNOELEMENTOWĄ listę", () => {
    h.sessions = [sessionRow({ status: "draft" })];
    renderuj();
    fireEvent.click(
      within(wiersz("Otwarcie")).getByText("adminEventAgenda.sessions.publishAction"),
    );
    expect(h.statusCalls).toEqual([{ ids: ["session-a"], status: "published" }]);
    expect(h.toastSuccess).toHaveBeenCalledWith(
      "adminEventAgenda.sessions.toasts.statusChanged(count=1)",
    );
  });

  it("sesja opublikowana ma cofnięcie publikacji ZAMIAST publikacji", () => {
    h.sessions = [sessionRow({ status: "published" })];
    renderuj();
    const li = wiersz("Otwarcie");
    expect(within(li).queryByText("adminEventAgenda.sessions.publishAction")).toBeNull();
    fireEvent.click(within(li).getByText("adminEventAgenda.sessions.unpublishAction"));
    expect(h.statusCalls).toEqual([{ ids: ["session-a"], status: "draft" }]);
  });

  it("odwołanie sesji stempluje stan „odwołana”", () => {
    h.sessions = [sessionRow({ status: "draft" })];
    renderuj();
    fireEvent.click(within(wiersz("Otwarcie")).getByText("adminEventAgenda.sessions.cancelAction"));
    expect(h.statusCalls).toEqual([{ ids: ["session-a"], status: "cancelled" }]);
  });

  // SESJA JUŻ ODWOŁANA nie ma czego odwoływać - przycisk, który zawsze robi to
  // samo, co widoczny stan, jest obietnicą bez pokrycia. Publikacja zostaje,
  // bo to jedyna droga powrotna.
  it("sesja odwołana traci przycisk odwołania, ale zachowuje publikację", () => {
    h.sessions = [sessionRow({ status: "cancelled" })];
    renderuj();
    const li = wiersz("Otwarcie");
    expect(within(li).queryByText("adminEventAgenda.sessions.cancelAction")).toBeNull();
    expect(within(li).getByText("adminEventAgenda.sessions.publishAction")).toBeTruthy();
  });

  // TRWAJĄCE ŻĄDANIE GASI PRZYCISKI. Bez tego dwa kliknięcia to dwie operacje
  // zbiorcze na tym samym wierszu - a druga jedzie na nieaktualnym stanie.
  it("trwająca zmiana stanu gasi przyciski i drugie kliknięcie nic nie wysyła", () => {
    h.sessions = [sessionRow({ status: "draft" })];
    h.statusPending = true;
    renderuj();
    const przycisk = within(wiersz("Otwarcie"))
      .getByText("adminEventAgenda.sessions.publishAction")
      .closest("button");
    expect(przycisk?.hasAttribute("disabled")).toBe(true);
    fireEvent.click(przycisk as HTMLElement);
    expect(h.statusCalls).toEqual([]);
  });

  it("odmowa zmiany stanu dochodzi zdaniem i NIE kasuje wiersza z ekranu", () => {
    h.sessions = [sessionRow({ status: "draft" })];
    h.statusFails = "session_locked: agenda is frozen";
    renderuj();
    fireEvent.click(
      within(wiersz("Otwarcie")).getByText("adminEventAgenda.sessions.publishAction"),
    );
    expect(h.toastError).toHaveBeenCalledWith("odmowa:session_locked: agenda is frozen");
    expect(h.toastSuccess).not.toHaveBeenCalled();
    expect(wiersz("Otwarcie")).toBeTruthy();
  });

  it("licznik z bazy jedzie do komunikatu, a nie stała jedynka", () => {
    h.sessions = [sessionRow({ status: "draft" })];
    h.statusChanged = 4;
    renderuj();
    fireEvent.click(
      within(wiersz("Otwarcie")).getByText("adminEventAgenda.sessions.publishAction"),
    );
    expect(h.toastSuccess).toHaveBeenCalledWith(
      "adminEventAgenda.sessions.toasts.statusChanged(count=4)",
    );
  });
});

describe("okno sesji - z czym się otwiera i co robi z odpowiedzią", () => {
  it("przy zamkniętym oknie organizm nic nie rysuje w jego miejscu", () => {
    renderuj();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(h.okno?.open).toBe(false);
  });

  it("„Dodaj” otwiera okno BEZ wiersza", () => {
    h.sessions = [sessionRow()];
    renderuj();
    fireEvent.click(screen.getByText("adminEventAgenda.sessions.addAction"));
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(h.okno?.session).toBeNull();
  });

  it("„Edytuj” otwiera okno Z TYM wierszem, nie z pierwszym z listy", () => {
    h.sessions = [
      sessionRow({ id: "a", title_pl: "Otwarcie" }),
      sessionRow({ id: "b", title_pl: "Panel" }),
    ];
    renderuj();
    fireEvent.click(within(wiersz("Panel")).getByText("adminEventAgenda.sessionDialog.editTitle"));
    expect(h.okno?.session?.id).toBe("b");
  });

  // NASTĘPNA POZYCJA SORTOWANIA WYPROWADZANA JEST Z LISTY. Odwrócenie
  // porównania (`Math.min`) dałoby nowej sesji pozycję PRZED istniejącymi -
  // czyli program w innej kolejności niż wpisany.
  it("nowa sesja dostaje pozycję ZA najdalszą istniejącą", () => {
    h.sessions = [
      sessionRow({ id: "a", sort_order: 10 }),
      sessionRow({ id: "b", sort_order: 90 }),
      sessionRow({ id: "c", sort_order: 40 }),
    ];
    renderuj();
    expect(h.okno?.nextSortOrder).toBe(100);
  });

  it("pusty program daje pierwszej sesji pozycję dziesiątą", () => {
    renderuj();
    expect(h.okno?.nextSortOrder).toBe(10);
  });

  it("okno dostaje katalogi ścieżek i sal oraz strefę wydarzenia", () => {
    h.tracks = [trackRow()];
    h.rooms = [roomRow()];
    h.sessions = [sessionRow()];
    renderuj();
    expect(h.okno?.tracks).toHaveLength(1);
    expect(h.okno?.rooms).toHaveLength(1);
    expect(h.okno?.sessions).toHaveLength(1);
    expect(h.okno?.timeZoneLabel).toBe(STREFA);
  });

  it("trwający zapis jedzie do okna, żeby zgasiło własne przyciski", () => {
    h.savePending = true;
    renderuj();
    fireEvent.click(screen.getByText("adminEventAgenda.sessions.addAction"));
    expect(h.okno?.isSaving).toBe(true);
  });

  it("udany zapis mówi o tym i ZAMYKA okno", () => {
    renderuj();
    fireEvent.click(screen.getByText("adminEventAgenda.sessions.addAction"));
    fireEvent.click(screen.getByText("zapisz-sesje"));
    expect(h.saveInputs).toHaveLength(1);
    expect(h.toastSuccess).toHaveBeenCalledWith("adminEventAgenda.sessions.toasts.saved");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  // ODMOWA NIE MOŻE KASOWAĆ PRACY. Zamknięte okno po odmowie znaczy, że
  // dwadzieścia wypełnionych pól znika razem z komunikatem błędu.
  it("odmowa zapisu dochodzi zdaniem i ZOSTAWIA okno otwarte", () => {
    h.saveFails = "overlapping_session: room is busy";
    renderuj();
    fireEvent.click(screen.getByText("adminEventAgenda.sessions.addAction"));
    fireEvent.click(screen.getByText("zapisz-sesje"));
    expect(h.toastError).toHaveBeenCalledWith("odmowa:overlapping_session: room is busy");
    expect(screen.getByRole("dialog")).toBeTruthy();
  });

  it("zamknięcie okna z jego wnętrza gasi je w organizmie", () => {
    renderuj();
    fireEvent.click(screen.getByText("adminEventAgenda.sessions.addAction"));
    fireEvent.click(screen.getByText("zamknij-sesje"));
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("usunięcie sesji za potwierdzeniem", () => {
  it("kosz OTWIERA pytanie i sam z siebie nic nie kasuje", () => {
    h.sessions = [sessionRow()];
    renderuj();
    expect(screen.queryByRole("alertdialog")).toBeNull();
    fireEvent.click(
      within(wiersz("Otwarcie")).getByLabelText("adminEventAgenda.sessions.deleteConfirm"),
    );
    expect(screen.getByRole("alertdialog")).toBeTruthy();
    expect(h.removeIds).toEqual([]);
  });

  it("potwierdzenie kasuje TEN wiersz i zamyka pytanie", () => {
    h.sessions = [
      sessionRow({ id: "a", title_pl: "Otwarcie" }),
      sessionRow({ id: "b", title_pl: "Panel" }),
    ];
    renderuj();
    fireEvent.click(
      within(wiersz("Panel")).getByLabelText("adminEventAgenda.sessions.deleteConfirm"),
    );
    fireEvent.click(
      within(screen.getByRole("alertdialog")).getByText(
        "adminEventAgenda.sessionDialog.saveAction",
      ),
    );
    expect(h.removeIds).toEqual(["b"]);
    expect(h.toastSuccess).toHaveBeenCalledWith("adminEventAgenda.sessions.toasts.deleted");
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("wycofanie się z pytania nie woła mutacji", () => {
    h.sessions = [sessionRow()];
    renderuj();
    fireEvent.click(
      within(wiersz("Otwarcie")).getByLabelText("adminEventAgenda.sessions.deleteConfirm"),
    );
    fireEvent.click(
      within(screen.getByRole("alertdialog")).getByText(
        "adminEventAgenda.sessionDialog.cancelAction",
      ),
    );
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(h.removeIds).toEqual([]);
  });

  // USUNIĘCIE SESJI Z ZAPISAMI JEST ODMAWIANE PRZEZ BAZĘ - to normalna droga
  // tego ekranu, nie awaria. Lista musi po niej stać dalej, a organizator ma
  // przeczytać, DLACZEGO nie wyszło.
  it("odmowa usunięcia dochodzi zdaniem i zostawia listę na ekranie", () => {
    h.sessions = [sessionRow()];
    h.removeFails = "session_has_signups: 12 people signed up";
    renderuj();
    fireEvent.click(
      within(wiersz("Otwarcie")).getByLabelText("adminEventAgenda.sessions.deleteConfirm"),
    );
    fireEvent.click(
      within(screen.getByRole("alertdialog")).getByText(
        "adminEventAgenda.sessionDialog.saveAction",
      ),
    );
    expect(h.toastError).toHaveBeenCalledWith("odmowa:session_has_signups: 12 people signed up");
    expect(h.toastSuccess).not.toHaveBeenCalled();
    expect(wiersz("Otwarcie")).toBeTruthy();
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// `timeLabel` budował `Intl.DateTimeFormat` PRZED blokiem `try`, a to
// KONSTRUKTOR rzuca `RangeError` dla nieznanej strefy - nie `format()`.
// Komentarz przy gałęzi ratunkowej obiecywał coś, czego ta gałąź nie robiła:
// „nieznana strefa nie może wygasić całej listy". Wygaszała - użytkownik
// dostawał biały ekran w miejscu programu, bez komunikatu.
//
// Że to nie była hipoteza, mówi sama nazwa propa: `timeZoneLabel`, nie
// `timeZone`. `eventTimeZoneLabel()` z TEGO SAMEGO modułu zwraca ETYKIETĘ
// („GMT+2"), nie identyfikator IANA - wystarczyłby jeden taki wywołujący.
// Formater powstaje teraz w środku `try`.
// ─────────────────────────────────────────────────────────────────────────────
it("nieznana strefa degraduje pojedynczy wiersz, a nie całą listę sesji", () => {
  h.sessions = [sessionRow({ title_pl: "Otwarcie" })];
  render(
    <AgendaSessionsPanel
      eventId={EVENT_ID}
      timeZoneLabel="GMT+2"
      lockedTrackId={null}
      embedded={false}
    />,
  );
  expect(screen.getByText("Otwarcie")).toBeTruthy();
});
