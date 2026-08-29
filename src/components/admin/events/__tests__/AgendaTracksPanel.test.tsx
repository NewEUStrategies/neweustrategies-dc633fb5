// Organizm „ŚCIEŻKI PROGRAMU" - lista pasm, która jest jednocześnie WEJŚCIEM
// do warsztatu pasma.
//
// CO TEN PLIK DOWODZI.
//   1. CZTERY STANY LISTY MAJĄ CZTERY WIDOKI, a awaria NIE MOŻE mówić „nie ma
//      jeszcze ścieżek" - po takim napisie organizator zakłada drugie pasmo
//      o tej samej nazwie, a baza odmawia mu z powodu klucza.
//   2. OTWARTA ŚCIEŻKA MOŻE MIESZKAĆ W ADRESIE. Organizm ma dwa tryby: własny
//      stan i sterowanie z trasy. Bez obu przypadków test nie odróżnia „działa
//      lokalnie" od „działa też z `?track=`" - a to drugie decyduje o tym, czy
//      odświeżenie strony wraca w to samo miejsce.
//   3. OTWARTĄ ŚCIEŻKĘ TRZYMAMY PO IDENTYFIKATORZE, nie po wierszu: pasmo,
//      którego nie ma już na liście, wraca do listy zamiast pokazywać zamrożoną
//      kopię sprzed skasowania.
//   4. PRZEŁĄCZNIK „AKTYWNA" WYSYŁA CAŁY WIERSZ - RPC zapisu jest upsertem,
//      więc pole pominięte w ładunku znika z bazy. Asercja stoi na PEŁNYM
//      obiekcie, bo to jedyne miejsce, w którym opis pasma da się zgubić po cichu.
//   5. NOWE PASMO OTWIERA SIĘ OD RAZU, a edytowane - NIE. Ścieżka bez warsztatu
//      jest tylko wierszem, ale przeskok warsztatu przy każdej edycji wyrzucałby
//      organizatora z listy, na której właśnie pracuje.
//   6. PRZYPIĘCIE I ODPIĘCIE SESJI TO DWIE INTENCJE = DWA WYWOŁANIA. Baza
//      rozróżnia „przypnij do pasma" od „odepnij" (`track_id = null`), więc
//      jedno wywołanie nie da się złożyć z obu.
//   7. ODMOWA BAZY DOCHODZI ZDANIEM I NIE KASUJE EKRANU.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE. (1) Molekuły okna ścieżki - `EventTrackDialog.test.tsx`.
// (2) Okna przypięcia sesji - `TrackSessionsLinkDialog.test.tsx`. (3) Warsztatu
// pasma - osobny organizm, tu jest atrapą, bo dowodzimy WEJŚCIA do niego,
// a nie jego zawartości. (4) Reguł wersji roboczej (`trackDraftFromRow`,
// `trackDraftToInput`) - mają tabelę w `lib/events/__tests__/agendaCatalogDraft.test.ts`
// i tutaj są PRAWDZIWE, bo przedmiotem dowodu jest ich WYNIK w ładunku.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { radixSwitchStub } from "@/test/reactStubs";
import type { EventSessionRow, EventTrackInput, EventTrackRow } from "@/lib/events/sessionsApi";
import type { TrackSessionsLinkResult } from "@/components/admin/events/molecules/TrackSessionsLinkDialog";

/**
 * Kształt drugiego argumentu `mutate`. Obie gałęzie są OPCJONALNE, bo
 * przełącznik „aktywna" świadomie nie podaje `onSuccess` - i to też jest
 * zachowanie, które ten plik sprawdza.
 */
interface Wynik<T> {
  onSuccess?: (value: T) => void;
  onError?: (error: Error) => void;
}

/** Propsy okna ścieżki przechwycone z ostatniego renderu. */
interface PropsyOkna {
  open: boolean;
  track: EventTrackRow | null;
  nextSortOrder: number;
  isSaving: boolean;
}

const h = vi.hoisted(() => ({
  language: "pl",
  tracks: undefined as unknown,
  sessions: undefined as unknown,
  isLoading: false,
  listError: null as Error | null,
  saveInputs: [] as unknown[],
  saveFails: null as string | null,
  savePending: false,
  saveReturns: "nowe-pasmo" as unknown,
  removeIds: [] as string[],
  removeFails: null as string | null,
  setTrackCalls: [] as { ids: readonly string[]; trackId: string | null }[],
  setTrackFails: null as string | null,
  setTrackPending: false,
  setTrackMoved: 2,
  okno: null as PropsyOkna | null,
  oknoLinku: null as { open: boolean; track: EventTrackRow | null; isSaving: boolean } | null,
  warsztat: null as { trackId: string; timeZoneLabel: string } | null,
  diagram: null as { unassignedCount: number; highlight: string; tracks: unknown[] } | null,
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  toastMessage: vi.fn(),
}));

vi.mock("react-i18next", async () =>
  (await import("@/test/i18nStub")).reactI18nextStub(() => h.language),
);
vi.mock("sonner", () => ({
  toast: { success: h.toastSuccess, error: h.toastError, message: h.toastMessage },
}));

// Słownik odmów bazy ma własny plik testowy i ciągnie realny i18next; tutaj
// potrzebny jest wyłącznie dowód, że odmowa DOCHODZI zdaniem.
vi.mock("@/lib/events/adminAgendaErrors", () => ({
  adminAgendaErrorMessage: (error: unknown) =>
    `odmowa:${error instanceof Error ? error.message : String(error)}`,
}));

// Radix Switch nie przełącza się pod happy-dom bez pointer API - przełącznik
// „aktywna" jest natywnym polem wyboru z tą samą dostępną nazwą.
vi.mock("@/components/ui/switch", async () => radixSwitchStub(await import("react")));

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

vi.mock("@/components/admin/events/molecules/EventTrackDialog", () => ({
  EventTrackDialog: (
    props: PropsyOkna & {
      onSubmit: (input: EventTrackInput) => void;
      onOpenChange: (open: boolean) => void;
    },
  ) => {
    h.okno = props;
    if (!props.open) return null;
    return (
      <div role="dialog" aria-label="okno-sciezki">
        <button
          type="button"
          onClick={() =>
            props.onSubmit({
              id: props.track?.id ?? null,
              namePl: "Nowe pasmo",
            } as unknown as EventTrackInput)
          }
        >
          zapisz-sciezke
        </button>
      </div>
    );
  },
}));

// Okno przypięcia sesji ma własny plik testowy. Tutaj potrzebne są cztery
// wyjścia z niego, bo KAŻDE z nich organizm obsługuje inaczej.
vi.mock("@/components/admin/events/molecules/TrackSessionsLinkDialog", () => ({
  TrackSessionsLinkDialog: (props: {
    open: boolean;
    track: EventTrackRow | null;
    isSaving: boolean;
    onSubmit: (result: TrackSessionsLinkResult) => void;
    onOpenChange: (open: boolean) => void;
  }) => {
    h.oknoLinku = { open: props.open, track: props.track, isSaving: props.isSaving };
    if (!props.open) return null;
    const wyslij = (attach: string[], detach: string[]) => () => props.onSubmit({ attach, detach });
    return (
      <div role="dialog" aria-label="okno-linku">
        <button type="button" onClick={wyslij(["s-1", "s-2"], [])}>
          link-przypnij
        </button>
        <button type="button" onClick={wyslij([], ["s-3"])}>
          link-odepnij
        </button>
        <button type="button" onClick={wyslij(["s-1"], ["s-3"])}>
          link-oba
        </button>
        <button type="button" onClick={wyslij([], [])}>
          link-nic
        </button>
        <button type="button" onClick={() => props.onOpenChange(false)}>
          zamknij-link
        </button>
      </div>
    );
  },
}));

// Warsztat pasma to osobny organizm z ośmioma zakładkami - tutaj dowodzimy
// wyłącznie tego, KIEDY się otwiera i CZYM.
vi.mock("@/components/admin/events/organisms/EventTrackWorkspace", () => ({
  EventTrackWorkspace: (props: {
    track: EventTrackRow;
    timeZoneLabel: string;
    onBack: () => void;
  }) => {
    h.warsztat = { trackId: props.track.id, timeZoneLabel: props.timeZoneLabel };
    return (
      <div aria-label="warsztat-pasma">
        <p>{props.track.name_pl}</p>
        <button type="button" onClick={props.onBack}>
          wroc-z-warsztatu
        </button>
      </div>
    );
  },
}));

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
  useEventTracks: () => ({ data: h.tracks, isLoading: h.isLoading, error: h.listError }),
  useEventSessions: () => ({ data: h.sessions }),
  useSaveEventTrack: () => ({
    isPending: h.savePending,
    mutate: (input: EventTrackInput, res: Wynik<string>) => {
      h.saveInputs.push(input);
      if (h.saveFails !== null) res.onError?.(new Error(h.saveFails));
      else res.onSuccess?.(h.saveReturns as string);
    },
  }),
  useDeleteEventTrack: () => ({
    isPending: false,
    mutate: (id: string, res: Wynik<boolean>) => {
      h.removeIds.push(id);
      if (h.removeFails !== null) res.onError?.(new Error(h.removeFails));
      else res.onSuccess?.(true);
    },
  }),
  useSetSessionsTrack: () => ({
    isPending: h.setTrackPending,
    mutateAsync: async (input: { ids: readonly string[]; trackId: string | null }) => {
      h.setTrackCalls.push(input);
      if (h.setTrackFails !== null) throw new Error(h.setTrackFails);
      return h.setTrackMoved;
    },
  }),
}));

const { AgendaTracksPanel } = await import("@/components/admin/events/organisms/AgendaTracksPanel");

const EVENT_ID = "11111111-1111-4111-8111-111111111111";
const STREFA = "Europe/Warsaw";

/** Wiersz `admin_event_tracks_list` - pełny kształt sygnatury, nie wycinek. */
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

/** Wiersz `admin_event_sessions_list` - potrzebny wyłącznie dla licznika diagramu. */
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

function renderuj(
  props: { openedTrackId?: string | null; onOpenTrack?: (trackId: string | null) => void } = {},
) {
  return render(
    <AgendaTracksPanel
      eventId={EVENT_ID}
      timeZoneLabel={STREFA}
      openedTrackId={props.openedTrackId}
      onOpenTrack={props.onOpenTrack}
    />,
  );
}

/** Wiersz listy po widocznej nazwie pasma. */
function wiersz(nazwa: string): HTMLElement {
  const li = screen
    .getAllByRole("listitem")
    .find((node) => node.textContent?.includes(nazwa) === true);
  if (li === undefined) throw new Error(`brak wiersza „${nazwa}” na ekranie`);
  return li;
}

beforeEach(() => {
  h.language = "pl";
  h.tracks = [];
  h.sessions = [];
  h.isLoading = false;
  h.listError = null;
  h.saveInputs = [];
  h.saveFails = null;
  h.savePending = false;
  h.saveReturns = "nowe-pasmo";
  h.removeIds = [];
  h.removeFails = null;
  h.setTrackCalls = [];
  h.setTrackFails = null;
  h.setTrackPending = false;
  h.setTrackMoved = 2;
  h.okno = null;
  h.oknoLinku = null;
  h.warsztat = null;
  h.diagram = null;
  h.toastSuccess.mockClear();
  h.toastError.mockClear();
  h.toastMessage.mockClear();
});

describe("cztery stany listy ścieżek", () => {
  it("wczytywanie pokazuje postęp i NIE mówi o pustce", () => {
    h.tracks = undefined;
    h.isLoading = true;
    renderuj();
    expect(screen.getByText("adminEventAgenda.tracks.loading")).toBeTruthy();
    expect(screen.queryByText("adminEventAgenda.tracks.empty")).toBeNull();
    expect(screen.queryByRole("listitem")).toBeNull();
  });

  // UDOKUMENTOWANA KLASA BŁĘDU TEGO MODUŁU: awaria wyglądająca jak pustka
  // każe organizatorowi założyć pasmo, które już istnieje - a wtedy baza
  // odmawia z powodu unikalnego klucza i wygląda to na drugi błąd.
  it("awaria mówi treścią odmowy i NIE mówi o pustce", () => {
    h.tracks = undefined;
    h.listError = new Error("permission denied for function admin_event_tracks_list");
    renderuj();
    expect(
      screen.getByText("odmowa:permission denied for function admin_event_tracks_list"),
    ).toBeTruthy();
    expect(screen.queryByText("adminEventAgenda.tracks.empty")).toBeNull();
  });

  it("wczytywanie po nieudanej próbie bije awarię", () => {
    h.tracks = undefined;
    h.isLoading = true;
    h.listError = new Error("tracks_failed");
    renderuj();
    expect(screen.getByText("adminEventAgenda.tracks.loading")).toBeTruthy();
    expect(screen.queryByText("odmowa:tracks_failed")).toBeNull();
  });

  it("pustka mówi to wprost i nie rysuje ani jednego wiersza", () => {
    renderuj();
    expect(screen.getByText("adminEventAgenda.tracks.empty")).toBeTruthy();
    expect(screen.queryByRole("listitem")).toBeNull();
  });

  it("lista z danymi rysuje wiersz z nazwą, kluczem i licznikiem sesji", () => {
    h.tracks = [trackRow()];
    renderuj();
    const li = wiersz("Ścieżka Cyfrowa");
    expect(within(li).getByText("sciezka_cyfrowa")).toBeTruthy();
    expect(within(li).getByText("adminEventAgenda.tracks.sessionsCount(count=3)")).toBeTruthy();
  });

  // LICZBĘ SESJI POKAZUJEMY OBOK NAZWY, bo bez niej organizator nie wie,
  // czy usunięcie ma szansę się udać - i czyta odmowę bazy jako awarię.
  it("pasmo bez sesji ma licznik zerowy, a nie pusty", () => {
    h.tracks = [trackRow({ sessions_count: 0 })];
    renderuj();
    expect(
      within(wiersz("Ścieżka Cyfrowa")).getByText("adminEventAgenda.tracks.sessionsCount(count=0)"),
    ).toBeTruthy();
  });

  it("po angielsku nazwa idzie po angielsku, a brak angielskiej wraca do polskiej", () => {
    h.language = "en";
    h.tracks = [
      trackRow({ id: "a", name_pl: "Ścieżka Cyfrowa", name_en: "Digital Track" }),
      trackRow({ id: "b", key: "zielona", name_pl: "Zielona", name_en: "" }),
    ];
    renderuj();
    expect(screen.getByText("Digital Track")).toBeTruthy();
    expect(screen.getByText("Zielona")).toBeTruthy();
  });

  it("po polsku brak nazwy polskiej wraca do angielskiej", () => {
    h.tracks = [trackRow({ name_pl: "", name_en: "Digital Track" })];
    renderuj();
    expect(screen.getByText("Digital Track")).toBeTruthy();
  });
});

describe("diagram struktury", () => {
  it("dostaje ścieżki z listy i podświetlenie ścieżek", () => {
    h.tracks = [trackRow()];
    renderuj();
    expect(h.diagram?.highlight).toBe("tracks");
    expect(h.diagram?.tracks).toEqual([
      { id: "track-a", name: "Ścieżka Cyfrowa", accentColor: "#fa9346", sessionsCount: 3 },
    ]);
  });

  // LICZNIK „BEZ ŚCIEŻKI" CZYTA PROGRAM, NIE SAME ŚCIEŻKI - dlatego to tutaj
  // może się rozjechać z tym, co widać na liście pasm.
  it("liczy sesje BEZ pasma, nie długość programu", () => {
    h.sessions = [
      sessionRow({ id: "a", track_id: "" }),
      sessionRow({ id: "b", track_id: "track-a" }),
      sessionRow({ id: "c", track_id: "" }),
    ];
    renderuj();
    expect(h.diagram?.unassignedCount).toBe(2);
  });

  it("program jeszcze niewczytany nie wywraca diagramu", () => {
    h.sessions = undefined;
    renderuj();
    expect(h.diagram?.unassignedCount).toBe(0);
  });
});

describe("wejście do warsztatu pasma", () => {
  it("bez sterowania z trasy klik w nazwę ZASTĘPUJE listę warsztatem", () => {
    h.tracks = [trackRow()];
    renderuj();
    expect(screen.queryByLabelText("warsztat-pasma")).toBeNull();
    fireEvent.click(
      within(wiersz("Ścieżka Cyfrowa")).getByRole("button", { name: /Ścieżka Cyfrowa/ }),
    );
    expect(screen.getByLabelText("warsztat-pasma")).toBeTruthy();
    expect(h.warsztat).toEqual({ trackId: "track-a", timeZoneLabel: STREFA });
    expect(screen.queryByRole("listitem")).toBeNull();
  });

  it("przycisk „Otwórz” prowadzi tam samo, co nazwa", () => {
    h.tracks = [trackRow()];
    renderuj();
    fireEvent.click(
      within(wiersz("Ścieżka Cyfrowa")).getByText("adminEventAgenda.tracks.openAction"),
    );
    expect(h.warsztat?.trackId).toBe("track-a");
  });

  it("powrót z warsztatu wraca na listę", () => {
    h.tracks = [trackRow()];
    renderuj();
    fireEvent.click(
      within(wiersz("Ścieżka Cyfrowa")).getByText("adminEventAgenda.tracks.openAction"),
    );
    fireEvent.click(screen.getByText("wroc-z-warsztatu"));
    expect(screen.getByRole("listitem")).toBeTruthy();
  });

  // OTWARTA ŚCIEŻKA MOŻE MIESZKAĆ W ADRESIE. W trybie sterowanym organizm sam
  // nie przełącza widoku - oddaje decyzję trasie, żeby odświeżenie strony
  // i wklejony link wracały w to samo miejsce.
  it("ze sterowaniem z trasy klik ODDAJE identyfikator, a widoku sam nie zmienia", () => {
    const onOpenTrack = vi.fn();
    h.tracks = [trackRow()];
    renderuj({ openedTrackId: null, onOpenTrack });
    fireEvent.click(
      within(wiersz("Ścieżka Cyfrowa")).getByText("adminEventAgenda.tracks.openAction"),
    );
    expect(onOpenTrack).toHaveBeenCalledWith("track-a");
    expect(screen.queryByLabelText("warsztat-pasma")).toBeNull();
  });

  it("ze sterowaniem z trasy pasmo z adresu otwiera warsztat od razu", () => {
    h.tracks = [trackRow()];
    renderuj({ openedTrackId: "track-a", onOpenTrack: vi.fn() });
    expect(h.warsztat?.trackId).toBe("track-a");
  });

  it("powrót w trybie sterowanym oddaje trasie pustą wartość", () => {
    const onOpenTrack = vi.fn();
    h.tracks = [trackRow()];
    renderuj({ openedTrackId: "track-a", onOpenTrack });
    fireEvent.click(screen.getByText("wroc-z-warsztatu"));
    expect(onOpenTrack).toHaveBeenCalledWith(null);
  });

  // PASMO TRZYMANE PO IDENTYFIKATORZE, NIE PO WIERSZU. Identyfikator z adresu,
  // którego nie ma już na liście (pasmo skasowane w innej karcie), musi wrócić
  // do listy - zamrożona kopia pokazywałaby warsztat nieistniejącego pasma.
  it("pasmo z adresu, którego nie ma na liście, wraca do listy", () => {
    h.tracks = [trackRow({ id: "track-a" })];
    renderuj({ openedTrackId: "track-znikniete", onOpenTrack: vi.fn() });
    expect(screen.queryByLabelText("warsztat-pasma")).toBeNull();
    expect(wiersz("Ścieżka Cyfrowa")).toBeTruthy();
  });
});

describe("przełącznik „aktywna” w wierszu", () => {
  // RPC ZAPISU JEST UPSERTEM, więc pole pominięte w ładunku znika z bazy.
  // Asercja na PEŁNYM obiekcie jest jedyną, która to złapie: sam `isActive`
  // przeszedłby także wtedy, gdyby opis i kolor pasma pojechały jako puste.
  it("wyłączenie wysyła CAŁY wiersz ze zmienionym znacznikiem", () => {
    h.tracks = [
      trackRow({
        tagline_pl: "  Pasmo cyfrowe  ",
        description_pl: "Opis",
        cover_url: "https://cdn.test/okladka.jpg",
        default_room_id: "room-a",
        sort_order: 30,
      }),
    ];
    renderuj();
    fireEvent.click(
      within(wiersz("Ścieżka Cyfrowa")).getByLabelText("adminEventAgenda.tracks.dialog.isActive"),
    );
    expect(h.saveInputs).toEqual([
      {
        id: "track-a",
        eventId: EVENT_ID,
        key: "sciezka_cyfrowa",
        namePl: "Ścieżka Cyfrowa",
        nameEn: "Digital Track",
        accentColor: "#fa9346",
        taglinePl: "Pasmo cyfrowe",
        taglineEn: null,
        descriptionPl: "Opis",
        descriptionEn: null,
        coverUrl: "https://cdn.test/okladka.jpg",
        defaultRoomId: "room-a",
        sortOrder: 30,
        isActive: false,
        isPublic: true,
      },
    ]);
  });

  it("włączenie wyłączonego pasma wysyła znacznik w drugą stronę", () => {
    h.tracks = [trackRow({ is_active: false })];
    renderuj();
    fireEvent.click(
      within(wiersz("Ścieżka Cyfrowa")).getByLabelText("adminEventAgenda.tracks.dialog.isActive"),
    );
    expect((h.saveInputs[0] as EventTrackInput).isActive).toBe(true);
  });

  it("odmowa przełączenia dochodzi zdaniem i zostawia wiersz na ekranie", () => {
    h.tracks = [trackRow()];
    h.saveFails = "track_in_use: 3 sessions use this track";
    renderuj();
    fireEvent.click(
      within(wiersz("Ścieżka Cyfrowa")).getByLabelText("adminEventAgenda.tracks.dialog.isActive"),
    );
    expect(h.toastError).toHaveBeenCalledWith("odmowa:track_in_use: 3 sessions use this track");
    expect(wiersz("Ścieżka Cyfrowa")).toBeTruthy();
  });

  // PRZEŁĄCZNIK NIE MELDUJE SUKCESU. Toast przy każdym kliknięciu przełącznika
  // zasypałby ekran przy porządkowaniu kilkunastu pasm.
  it("udane przełączenie nie zasypuje ekranu komunikatem", () => {
    h.tracks = [trackRow()];
    renderuj();
    fireEvent.click(
      within(wiersz("Ścieżka Cyfrowa")).getByLabelText("adminEventAgenda.tracks.dialog.isActive"),
    );
    expect(h.toastSuccess).not.toHaveBeenCalled();
  });
});

describe("okno ścieżki - tworzenie i edycja", () => {
  it("„Dodaj” otwiera okno BEZ wiersza i z następną pozycją sortowania", () => {
    h.tracks = [trackRow({ id: "a", sort_order: 10 }), trackRow({ id: "b", sort_order: 70 })];
    renderuj();
    fireEvent.click(screen.getByText("adminEventAgenda.tracks.addAction"));
    expect(h.okno?.track).toBeNull();
    expect(h.okno?.nextSortOrder).toBe(80);
  });

  it("pusta lista daje pierwszemu pasmu pozycję dziesiątą", () => {
    renderuj();
    expect(h.okno?.nextSortOrder).toBe(10);
  });

  it("ołówek otwiera okno Z TYM wierszem, nie z pierwszym z listy", () => {
    h.tracks = [
      trackRow({ id: "a", name_pl: "Ścieżka Cyfrowa" }),
      trackRow({ id: "b", key: "zielona", name_pl: "Zielona" }),
    ];
    renderuj();
    fireEvent.click(
      within(wiersz("Zielona")).getByLabelText("adminEventAgenda.tracks.dialog.editTitle"),
    );
    expect(h.okno?.track?.id).toBe("b");
  });

  it("trwający zapis jedzie do okna, żeby zgasiło własne przyciski", () => {
    h.savePending = true;
    renderuj();
    expect(h.okno?.isSaving).toBe(true);
  });

  // NOWE PASMO OTWIERAMY OD RAZU: ścieżka bez warsztatu jest tylko wierszem
  // na liście, a cały program planuje się w jej zakładkach.
  it("zapis NOWEGO pasma zamyka okno i wchodzi w jego warsztat", () => {
    h.saveReturns = "track-nowy";
    h.tracks = [trackRow({ id: "track-nowy", name_pl: "Nowe pasmo" })];
    renderuj();
    fireEvent.click(screen.getByText("adminEventAgenda.tracks.addAction"));
    fireEvent.click(screen.getByText("zapisz-sciezke"));
    expect(h.toastSuccess).toHaveBeenCalledWith("adminEventAgenda.tracks.toasts.saved");
    expect(h.warsztat?.trackId).toBe("track-nowy");
  });

  // KONTRAPUNKT: przeskok warsztatu przy KAŻDYM zapisie wyrzucałby
  // organizatora z listy, na której właśnie porządkuje pasma.
  it("zapis EDYTOWANEGO pasma zostawia organizatora na liście", () => {
    h.tracks = [trackRow()];
    renderuj();
    fireEvent.click(
      within(wiersz("Ścieżka Cyfrowa")).getByLabelText("adminEventAgenda.tracks.dialog.editTitle"),
    );
    fireEvent.click(screen.getByText("zapisz-sciezke"));
    expect(h.toastSuccess).toHaveBeenCalledWith("adminEventAgenda.tracks.toasts.saved");
    expect(h.warsztat).toBeNull();
    expect(wiersz("Ścieżka Cyfrowa")).toBeTruthy();
  });

  // BAZA MOŻE NIE ODDAĆ IDENTYFIKATORA (starsza sygnatura RPC). Wtedy zamiast
  // warsztatu pustego pasma zostajemy na liście - lepiej niż ekran o pasmie,
  // którego organizm nie umie wskazać.
  it("nowe pasmo bez identyfikatora z bazy nie otwiera pustego warsztatu", () => {
    h.saveReturns = "";
    renderuj();
    fireEvent.click(screen.getByText("adminEventAgenda.tracks.addAction"));
    fireEvent.click(screen.getByText("zapisz-sciezke"));
    expect(h.warsztat).toBeNull();
  });

  it("odmowa zapisu dochodzi zdaniem i ZOSTAWIA okno otwarte", () => {
    h.saveFails = "track_key_taken: sciezka_cyfrowa";
    renderuj();
    fireEvent.click(screen.getByText("adminEventAgenda.tracks.addAction"));
    fireEvent.click(screen.getByText("zapisz-sciezke"));
    expect(h.toastError).toHaveBeenCalledWith("odmowa:track_key_taken: sciezka_cyfrowa");
    expect(screen.getByRole("dialog", { name: "okno-sciezki" })).toBeTruthy();
  });
});

describe("przypięcie sesji do pasma", () => {
  function otworzLink() {
    fireEvent.click(
      within(wiersz("Ścieżka Cyfrowa")).getByText("adminEventAgenda.tracks.linkAction"),
    );
  }

  it("okno otwiera się z TYM pasmem", () => {
    h.tracks = [trackRow()];
    renderuj();
    expect(h.oknoLinku?.open).toBe(false);
    otworzLink();
    expect(h.oknoLinku?.open).toBe(true);
    expect(h.oknoLinku?.track?.id).toBe("track-a");
  });

  it("trwające przepięcie jedzie do okna", () => {
    h.tracks = [trackRow()];
    h.setTrackPending = true;
    renderuj();
    expect(h.oknoLinku?.isSaving).toBe(true);
  });

  it("samo przypięcie idzie jednym wywołaniem z identyfikatorem pasma", async () => {
    h.tracks = [trackRow()];
    renderuj();
    otworzLink();
    fireEvent.click(screen.getByText("link-przypnij"));
    await waitFor(() => expect(h.toastSuccess).toHaveBeenCalled());
    expect(h.setTrackCalls).toEqual([{ ids: ["s-1", "s-2"], trackId: "track-a" }]);
  });

  it("samo odpięcie idzie jednym wywołaniem z pustym pasmem", async () => {
    h.tracks = [trackRow()];
    renderuj();
    otworzLink();
    fireEvent.click(screen.getByText("link-odepnij"));
    await waitFor(() => expect(h.toastSuccess).toHaveBeenCalled());
    expect(h.setTrackCalls).toEqual([{ ids: ["s-3"], trackId: null }]);
  });

  // DWIE INTENCJE = DWA WYWOŁANIA. Baza rozróżnia „przypnij" od „odepnij"
  // (`track_id = null`), więc jednym ładunkiem tego nie da się wyrazić -
  // a komunikat sumuje OBA wyniki, nie pokazuje dwóch osobnych.
  it("przypięcie i odpięcie naraz to DWA wywołania i JEDEN zsumowany komunikat", async () => {
    h.tracks = [trackRow()];
    h.setTrackMoved = 5;
    renderuj();
    otworzLink();
    fireEvent.click(screen.getByText("link-oba"));
    await waitFor(() => expect(h.toastSuccess).toHaveBeenCalled());
    expect(h.setTrackCalls).toEqual([
      { ids: ["s-1"], trackId: "track-a" },
      { ids: ["s-3"], trackId: null },
    ]);
    expect(h.toastSuccess).toHaveBeenCalledWith("adminEventAgenda.tracks.link.saved(count=10)");
  });

  // PUSTE ZATWIERDZENIE NIE JEST BŁĘDEM, ale nie jest też sukcesem - komunikat
  // „przepięto 0 sesji" czyta się jak operacja, która się nie udała.
  it("zatwierdzenie bez zmian nie woła bazy i mówi trzecią rzecz", async () => {
    h.tracks = [trackRow()];
    renderuj();
    otworzLink();
    fireEvent.click(screen.getByText("link-nic"));
    expect(h.setTrackCalls).toEqual([]);
    expect(h.toastMessage).toHaveBeenCalledWith("adminEventAgenda.tracks.link.nothing");
    expect(h.toastSuccess).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByLabelText("okno-linku")).toBeNull());
  });

  // ZAMKNIĘCIE BEZ ZATWIERDZENIA NIE MOŻE NICZEGO PRZEPIĄĆ. Okno wybiera sesje
  // zaznaczeniem, więc rezygnacja w połowie jest tu normalną drogą - i musi
  // zostawić program bez zmian.
  it("zamknięcie okna bez zatwierdzenia nie woła bazy", () => {
    h.tracks = [trackRow()];
    renderuj();
    otworzLink();
    fireEvent.click(screen.getByText("zamknij-link"));
    expect(h.setTrackCalls).toEqual([]);
    expect(h.oknoLinku?.open).toBe(false);
  });

  it("odmowa przepięcia dochodzi zdaniem i ZOSTAWIA okno otwarte", async () => {
    h.tracks = [trackRow()];
    h.setTrackFails = "track_inactive: cannot attach to a disabled track";
    renderuj();
    otworzLink();
    fireEvent.click(screen.getByText("link-przypnij"));
    await waitFor(() =>
      expect(h.toastError).toHaveBeenCalledWith(
        "odmowa:track_inactive: cannot attach to a disabled track",
      ),
    );
    expect(h.oknoLinku?.open).toBe(true);
  });
});

describe("usunięcie ścieżki za potwierdzeniem", () => {
  it("kosz OTWIERA pytanie i sam z siebie nic nie kasuje", () => {
    h.tracks = [trackRow()];
    renderuj();
    expect(screen.queryByRole("alertdialog")).toBeNull();
    fireEvent.click(
      within(wiersz("Ścieżka Cyfrowa")).getByLabelText("adminEventAgenda.tracks.deleteConfirm"),
    );
    expect(screen.getByRole("alertdialog")).toBeTruthy();
    expect(h.removeIds).toEqual([]);
  });

  it("potwierdzenie kasuje TEN wiersz i zamyka pytanie", () => {
    h.tracks = [
      trackRow({ id: "a", name_pl: "Ścieżka Cyfrowa" }),
      trackRow({ id: "b", key: "zielona", name_pl: "Zielona" }),
    ];
    renderuj();
    fireEvent.click(
      within(wiersz("Zielona")).getByLabelText("adminEventAgenda.tracks.deleteConfirm"),
    );
    fireEvent.click(
      within(screen.getByRole("alertdialog")).getByText(
        "adminEventAgenda.tracks.dialog.saveAction",
      ),
    );
    expect(h.removeIds).toEqual(["b"]);
    expect(h.toastSuccess).toHaveBeenCalledWith("adminEventAgenda.tracks.toasts.deleted");
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("wycofanie się z pytania nie woła mutacji", () => {
    h.tracks = [trackRow()];
    renderuj();
    fireEvent.click(
      within(wiersz("Ścieżka Cyfrowa")).getByLabelText("adminEventAgenda.tracks.deleteConfirm"),
    );
    fireEvent.click(
      within(screen.getByRole("alertdialog")).getByText(
        "adminEventAgenda.tracks.dialog.cancelAction",
      ),
    );
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(h.removeIds).toEqual([]);
  });

  // BAZA ODMAWIA SKASOWANIA PASMA UŻYWANEGO PRZEZ SESJE (`track_in_use`), bo
  // publiczna agenda straciłaby pasmo. To normalna droga tego ekranu, więc
  // lista musi po odmowie stać dalej.
  it("odmowa usunięcia dochodzi zdaniem i zostawia listę na ekranie", () => {
    h.tracks = [trackRow()];
    h.removeFails = "track_in_use: 3 sessions still use this track";
    renderuj();
    fireEvent.click(
      within(wiersz("Ścieżka Cyfrowa")).getByLabelText("adminEventAgenda.tracks.deleteConfirm"),
    );
    fireEvent.click(
      within(screen.getByRole("alertdialog")).getByText(
        "adminEventAgenda.tracks.dialog.saveAction",
      ),
    );
    expect(h.toastError).toHaveBeenCalledWith(
      "odmowa:track_in_use: 3 sessions still use this track",
    );
    expect(h.toastSuccess).not.toHaveBeenCalled();
    expect(wiersz("Ścieżka Cyfrowa")).toBeTruthy();
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });
});
