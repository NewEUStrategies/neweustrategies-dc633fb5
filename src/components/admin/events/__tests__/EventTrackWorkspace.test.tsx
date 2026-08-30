// Organizm „PRZESTRZEŃ ROBOCZA ŚCIEŻKI" - osiem zakładek jednego pasma programu.
//
// PO CO TEN PLIK ISTNIEJE. Warsztat pasma jest największym ekranem agendy
// i jedynym, który czyta CZTERY niezależne zapytania naraz (sesje pasma, obsada
// pasma, wystawcy wydarzenia, zgłoszenia wydarzenia) i wystawia DWIE mutacje
// (zapis ścieżki, przypięcie i odpięcie sesji). Klasy błędów widoczne wyłącznie
// tutaj:
//
//   1. ZAKŁADKA, KTÓRA MYLI „PUSTO" Z „NIE UDAŁO SIĘ". Każda z czterech list ma
//      własny stan wczytywania i własną odmowę. Zakładka „Format i wideo", która
//      po odmowie mówi „pasmo nie ma jeszcze sesji", każe organizatorowi wpisać
//      program drugi raz.
//   2. LICZNIKI PASMA LICZĄ SIĘ Z SESJI, NIE Z WPISU. Formaty, transmisje,
//      nagrania, zapisy i reguła Chatham House to sumy po liście sesji - pomyłka
//      w jednym warunku pokazuje „3 sesje online" tam, gdzie nie ma ani jednej.
//   3. PRZYPIĘCIE I ODPIĘCIE SESJI TO DWIE INTENCJE = DWA WYWOŁANIA. Baza
//      rozróżnia „przypnij do pasma" od „odepnij" (`track_id = null`), więc jedno
//      wywołanie nie da się złożyć z obu, a komunikat o sukcesie jest SUMĄ obu
//      przebiegów.
//   4. OBSADA JEST WYLICZANA, NIE WPISYWANA. Prelegent należy do SESJI; pasmo
//      pokazuje sumę tych przypisań (`admin_event_track_speakers`), więc licznik
//      w nazwie zakładki i lista pod nią pochodzą z DWÓCH różnych źródeł.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE. (1) Okna ścieżki - `EventTrackDialog.test.tsx`.
// (2) Okna przypięcia sesji - `TrackSessionsLinkDialog.test.tsx`. (3) Warsztatu
// sesji - `AgendaSessionsPanel.test.tsx`; tutaj jest atrapą, bo dowodzimy tego,
// CZYM go zawężamy, a nie jego zawartości. (4) Hooków i unieważnień -
// `lib/events/__tests__/useEventSessions.test.ts`.
//
// RODO: adresy wyłącznie w domenie `example.com`, nazwiska wymyślone.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { radixTabsStub } from "@/test/reactStubs";
import { axeViolations, summarize } from "@/test/axe";
import { adminEventSessionRow } from "@/test/events/adminEventStudioRows";
import type { EventRegistrationRow, RegistrationsPage } from "@/lib/events/registrationsApi";
import type { EventSponsorRow } from "@/lib/events/sponsorsApi";
import type {
  EventSessionRow,
  EventTrackInput,
  EventTrackRow,
  EventTrackSpeakerRow,
  SessionsQuery,
} from "@/lib/events/sessionsApi";
import type { TrackSessionsLinkResult } from "@/components/admin/events/molecules/TrackSessionsLinkDialog";

/** Kształt drugiego argumentu `mutate` - obie gałęzie są opcjonalne. */
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

/** Propsy warsztatu sesji przechwycone z ostatniego renderu. */
interface PropsyPanelu {
  eventId: string;
  timeZoneLabel: string;
  lockedTrackId?: string;
  embedded?: boolean;
}

/** Filtr wysyłany do haków sponsorów i zgłoszeń - czytamy z niego frazę. */
interface FiltrZFraza {
  eventId: string;
  q: string;
  limit: number;
}

const h = vi.hoisted(() => ({
  language: "pl",
  sessions: undefined as EventSessionRow[] | undefined,
  sessionsLoading: false,
  sessionsError: null as Error | null,
  speakers: undefined as EventTrackSpeakerRow[] | undefined,
  speakersLoading: false,
  speakersError: null as Error | null,
  sponsors: undefined as EventSponsorRow[] | undefined,
  sponsorsLoading: false,
  sponsorsError: null as Error | null,
  attendees: undefined as RegistrationsPage | undefined,
  attendeesLoading: false,
  attendeesError: null as Error | null,
  sessionQueries: [] as SessionsQuery[],
  speakerTrackIds: [] as (string | null)[],
  sponsorQueries: [] as { eventId: string; q: string; limit: number }[],
  attendeeQueries: [] as { eventId: string; q: string; limit: number }[],
  saveInputs: [] as EventTrackInput[],
  saveFails: null as string | null,
  savePending: false,
  setTrackCalls: [] as { ids: readonly string[]; trackId: string | null }[],
  setTrackFails: null as string | null,
  setTrackPending: false,
  setTrackMoved: 2,
  okno: null as PropsyOkna | null,
  oknoLinku: null as { open: boolean; track: EventTrackRow | null; isSaving: boolean } | null,
  panelSesji: null as PropsyPanelu | null,
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
// potrzebny jest wyłącznie dowód, że odmowa DOCHODZI zdaniem, a nie kodem.
vi.mock("@/lib/events/adminAgendaErrors", () => ({
  adminAgendaErrorMessage: (error: unknown) =>
    `odmowa:${error instanceof Error ? error.message : String(error)}`,
}));

// Radix Tabs nie przełącza panelu pod happy-dom (potrzebuje zdarzeń wskaźnika),
// a to właśnie zakładki decydują, KTÓRA powierzchnia jest w ogóle zamontowana.
vi.mock("@/components/ui/tabs", async () => radixTabsStub(await import("react")));

vi.mock("@/components/admin/events/molecules/EventTrackDialog", () => ({
  EventTrackDialog: (
    props: PropsyOkna & {
      onSubmit: (input: EventTrackInput) => void;
      onOpenChange: (open: boolean) => void;
    },
  ) => {
    h.okno = {
      open: props.open,
      track: props.track,
      nextSortOrder: props.nextSortOrder,
      isSaving: props.isSaving,
    };
    if (!props.open) return null;
    return (
      <div role="dialog" aria-label="okno-sciezki">
        <button type="button" onClick={() => props.onSubmit(WEJSCIE_ZAPISU)}>
          zapisz-sciezke
        </button>
        <button type="button" onClick={() => props.onOpenChange(false)}>
          zamknij-sciezke
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

// Warsztat sesji to osobny organizm z własnym plikiem testowym - tutaj liczy
// się WYŁĄCZNIE to, czym warsztat pasma go zawęża.
vi.mock("@/components/admin/events/organisms/AgendaSessionsPanel", () => ({
  AgendaSessionsPanel: (props: PropsyPanelu) => {
    h.panelSesji = props;
    return <div aria-label="warsztat-sesji" />;
  },
}));

vi.mock("@/lib/events/useEventSessions", () => ({
  useEventSessions: (query: SessionsQuery) => {
    h.sessionQueries.push(query);
    return { data: h.sessions, isLoading: h.sessionsLoading, error: h.sessionsError };
  },
  useEventTrackSpeakers: (trackId: string | null) => {
    h.speakerTrackIds.push(trackId);
    return { data: h.speakers, isLoading: h.speakersLoading, error: h.speakersError };
  },
  useSaveEventTrack: () => ({
    isPending: h.savePending,
    mutate: (input: EventTrackInput, res: Wynik<string>) => {
      h.saveInputs.push(input);
      if (h.saveFails !== null) res.onError?.(new Error(h.saveFails));
      else res.onSuccess?.("pasmo");
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

vi.mock("@/lib/events/useEventSponsors", () => ({
  useSponsors: (query: FiltrZFraza) => {
    h.sponsorQueries.push(query);
    return { data: h.sponsors, isLoading: h.sponsorsLoading, error: h.sponsorsError };
  },
}));

vi.mock("@/lib/events/useEventRegistrations", () => ({
  useRegistrationsList: (query: FiltrZFraza) => {
    h.attendeeQueries.push(query);
    return { data: h.attendees, isLoading: h.attendeesLoading, error: h.attendeesError };
  },
}));

const { EventTrackWorkspace } =
  await import("@/components/admin/events/organisms/EventTrackWorkspace");

const EVENT_ID = "e5000000-0000-4000-8000-0000000000a1";
const TRACK_ID = "7c000000-0000-4000-8000-000000000001";
const STREFA = "Europe/Warsaw";

/** Ładunek, który atrapa okna oddaje przy zapisie - treść nie ma tu znaczenia. */
const WEJSCIE_ZAPISU: EventTrackInput = {
  id: TRACK_ID,
  eventId: EVENT_ID,
  key: "sciezka_cyfrowa",
  namePl: "Ścieżka Cyfrowa",
  nameEn: "Digital Track",
  accentColor: "#fa9346",
  taglinePl: null,
  taglineEn: null,
  descriptionPl: null,
  descriptionEn: null,
  coverUrl: null,
  defaultRoomId: null,
  sortOrder: 20,
  isActive: true,
  isPublic: true,
};

/**
 * Kolumny NULL-owalne, które GENERATOR typuje jako `string`.
 *
 * `admin_event_tracks_list` liczy okno programu jako `min(starts_at)` /
 * `max(ends_at)` po sesjach pasma - pasmo bez sesji dostaje tam `NULL`.
 * Tak samo `cover_url`, `tagline_*`, `description_*` i `default_room_name`
 * (LEFT JOIN na sale) są `NULL`, dopóki nikt ich nie wpisał, a `display_name`
 * i `avatar_url` obsady wiszą na LEFT JOIN do profilu. Sygnatura `RETURNS TABLE`
 * nie niesie `NOT NULL`, więc wygenerowany typ obiecuje `string`. Rzutujemy
 * tylko tutaj i tylko po to, żeby fixture'y mówiły PRAWDĘ o odpowiedzi bazy.
 *
 * DLACZEGO RZUTOWANIE JEST TU JEDYNYM WYJŚCIEM. Fixture musi mieć DOKŁADNIE
 * kształt wiersza z generatora - własny, poluzowany typ przestałby pilnować
 * sygnatury RPC, a to właśnie ona ma tu pęknąć, gdy zmieni się kolumna.
 * Wartość zgodna z typem (pusty napis, zero) byłaby KŁAMSTWEM o odpowiedzi
 * bazy i schowałaby dokładnie te przypadki, dla których ten plik istnieje.
 * Dług należy do wygenerowanych typów i znika, gdy generator nauczy się
 * `NOT NULL` (pilnuje tego `check:types-freshness`).
 */
const BRAK_NAPISU = null as unknown as string;

/** Wiersz `admin_event_tracks_list` - pełny kształt sygnatury, nie wycinek. */
function trackRow(overrides: Partial<EventTrackRow> = {}): EventTrackRow {
  return {
    accent_color: "#fa9346",
    cover_url: "https://cdn.example.com/pasmo.jpg",
    created_at: "2026-08-01T09:00:00.000Z",
    default_room_id: "a6000000-0000-4000-8000-000000000001",
    default_room_name: "Sala Główna",
    description_en: "Digital sovereignty strand",
    description_pl: "Pasmo o suwerenności cyfrowej",
    draft_count: 1,
    event_id: EVENT_ID,
    first_starts_at: "2026-09-01T07:00:00.000Z",
    id: TRACK_ID,
    is_active: true,
    is_public: true,
    key: "sciezka_cyfrowa",
    last_ends_at: "2026-09-01T10:00:00.000Z",
    minutes_total: 180,
    name_en: "Digital Track",
    name_pl: "Ścieżka Cyfrowa",
    published_count: 2,
    sessions_count: 3,
    sort_order: 20,
    speakers_count: 4,
    tagline_en: "Rules for the digital decade",
    tagline_pl: "Reguły cyfrowej dekady",
    updated_at: "2026-08-01T09:00:00.000Z",
    ...overrides,
  };
}

/** PASMO ŚWIEŻE - bez opisu, bez okładki, bez sali i bez ani jednej sesji. */
const PASMO_PUSTE = trackRow({
  cover_url: BRAK_NAPISU,
  default_room_id: BRAK_NAPISU,
  default_room_name: BRAK_NAPISU,
  description_en: BRAK_NAPISU,
  description_pl: BRAK_NAPISU,
  first_starts_at: BRAK_NAPISU,
  last_ends_at: BRAK_NAPISU,
  is_active: false,
  is_public: false,
  minutes_total: 0,
  published_count: 0,
  sessions_count: 0,
  speakers_count: 0,
  tagline_en: BRAK_NAPISU,
  tagline_pl: BRAK_NAPISU,
});

/** Wiersz `admin_event_track_speakers`. */
function speakerRow(overrides: Partial<EventTrackSpeakerRow> = {}): EventTrackSpeakerRow {
  return {
    avatar_url: "https://cdn.example.com/awatar.png",
    display_name: "Anna Kowalska",
    job_title: "Dyrektorka ds. polityki cyfrowej",
    roles: ["speaker"],
    sessions_count: 2,
    speaker_profile_id: "59000000-0000-4000-8000-0000000000a1",
    ...overrides,
  };
}

/** Wiersz `admin_event_sponsors_list` - pełny kształt sygnatury RPC. */
function sponsorRow(overrides: Partial<EventSponsorRow> = {}): EventSponsorRow {
  return {
    booth_label: "A12",
    company_id: "b1000000-0000-4000-8000-000000000001",
    contacts_count: 1,
    created_at: "2026-08-01T09:00:00.000Z",
    crm_city: "Warszawa",
    crm_country: "PL",
    crm_drift: false,
    crm_drift_fields: [],
    crm_logo_url: "https://alfa.example.com/logo.png",
    crm_name: "Alfa sp. z o.o.",
    crm_website: "https://alfa.example.com",
    event_id: EVENT_ID,
    id: "c2000000-0000-4000-8000-000000000001",
    is_published: true,
    materials_count: 0,
    published_materials_count: 0,
    role: "sponsor",
    snapshot_country: "PL",
    snapshot_description_en: "Leading logistics",
    snapshot_description_pl: "Lider logistyki",
    snapshot_logo_url: "https://alfa.example.com/logo.png",
    snapshot_name: "Alfa",
    snapshot_source: "crm",
    snapshot_taken_at: "2026-08-01T09:00:00.000Z",
    snapshot_website: "https://alfa.example.com",
    sort_order: 10,
    tier_accent_color: "#c9a227",
    tier_id: "d3000000-0000-4000-8000-000000000001",
    tier_key: "gold",
    tier_logo_size: "lg",
    tier_name_en: "Gold",
    tier_name_pl: "Złoty",
    tier_rank: 1,
    total_count: 2,
    updated_at: "2026-08-01T09:00:00.000Z",
    ...overrides,
  };
}

/** Wiersz `admin_event_registrations_list` - pełny kształt sygnatury RPC. */
function registrationRow(overrides: Partial<EventRegistrationRow> = {}): EventRegistrationRow {
  return {
    accepted_terms_count: 2,
    answers: {},
    attended_at: BRAK_NAPISU,
    cancelled_at: BRAK_NAPISU,
    company_id: BRAK_NAPISU,
    company_name: "Beta Institute",
    company_text: BRAK_NAPISU,
    consent_data_processing_at: "2026-08-02T10:00:00.000Z",
    consent_marketing_at: BRAK_NAPISU,
    consent_partner_sharing_at: BRAK_NAPISU,
    consent_withdrawn_at: BRAK_NAPISU,
    created_at: "2026-08-02T10:00:00.000Z",
    decided_at: BRAK_NAPISU,
    decided_by: BRAK_NAPISU,
    decision_note: BRAK_NAPISU,
    decision_source: BRAK_NAPISU,
    email: "uczestnik@example.com",
    event_id: EVENT_ID,
    extra_groups_count: 0,
    first_name: "Jan",
    group_color: BRAK_NAPISU,
    group_id: BRAK_NAPISU,
    group_key: BRAK_NAPISU,
    group_name_en: BRAK_NAPISU,
    group_name_pl: BRAK_NAPISU,
    has_qr: true,
    id: "f4000000-0000-4000-8000-000000000001",
    job_title: "Analityk",
    last_name: "Nowak",
    person_id: BRAK_NAPISU,
    person_user_id: BRAK_NAPISU,
    phone: BRAK_NAPISU,
    promoted_at: BRAK_NAPISU,
    registration_mode: "self",
    required_terms_missing: 0,
    social_profile_url: BRAK_NAPISU,
    source: "form",
    status: "confirmed",
    ticket_currency: "PLN",
    ticket_key: "standard",
    ticket_name_en: "Standard",
    ticket_name_pl: "Standard",
    ticket_price_cents: 0,
    ticket_type_id: BRAK_NAPISU,
    total_count: 1,
    waitlist_notified_at: BRAK_NAPISU,
    waitlist_position: 0,
    ...overrides,
  };
}

function renderuj(props: { track?: EventTrackRow; onBack?: () => void } = {}) {
  return render(
    <EventTrackWorkspace
      eventId={EVENT_ID}
      track={props.track ?? trackRow()}
      timeZoneLabel={STREFA}
      onBack={props.onBack ?? (() => undefined)}
    />,
  );
}

/** Przechodzi na zakładkę, której nazwa zawiera podany fragment klucza. */
function zakladka(fragment: string): void {
  const tab = screen
    .getAllByRole("tab")
    .find((node) => node.textContent?.includes(fragment) === true);
  if (tab === undefined) throw new Error(`brak zakładki „${fragment}”`);
  fireEvent.click(tab);
}

/** Nagłówek pasma - zdanie wprowadzające stoi TAKŻE w polu „Szczegółów". */
function naglowek(container: HTMLElement): HTMLElement {
  const el = container.querySelector("header");
  if (el === null) throw new Error("brak nagłówka pasma");
  return el;
}

/** Wartość pola „tylko do odczytu" / kafla metryki, znalezionego po etykiecie. */
function pole(etykieta: string): string {
  return screen.getByText(etykieta).nextElementSibling?.textContent ?? "";
}

/** Wiersz funkcji (format, transmisja, widoczność) po etykiecie. */
function wierszFunkcji(etykieta: string): HTMLElement {
  const li = screen
    .getAllByRole("listitem")
    .find((node) => node.textContent?.includes(etykieta) === true);
  if (li === undefined) throw new Error(`brak wiersza „${etykieta}”`);
  return li;
}

const W = "adminEventAgenda.tracks.workspace.";

beforeEach(() => {
  h.language = "pl";
  h.sessions = [];
  h.sessionsLoading = false;
  h.sessionsError = null;
  h.speakers = [];
  h.speakersLoading = false;
  h.speakersError = null;
  h.sponsors = [];
  h.sponsorsLoading = false;
  h.sponsorsError = null;
  h.attendees = { rows: [], total: 0 };
  h.attendeesLoading = false;
  h.attendeesError = null;
  h.sessionQueries = [];
  h.speakerTrackIds = [];
  h.sponsorQueries = [];
  h.attendeeQueries = [];
  h.saveInputs = [];
  h.saveFails = null;
  h.savePending = false;
  h.setTrackCalls = [];
  h.setTrackFails = null;
  h.setTrackPending = false;
  h.setTrackMoved = 2;
  h.okno = null;
  h.oknoLinku = null;
  h.panelSesji = null;
  h.toastSuccess.mockClear();
  h.toastError.mockClear();
  h.toastMessage.mockClear();
});

/* ---------------------------------------------------------------- nagłówek --- */

describe("nagłówek pasma", () => {
  it("pokazuje nazwę, zdanie wprowadzające i znacznik widoczności", () => {
    const { container } = renderuj();

    expect(screen.getByRole("heading", { name: "Ścieżka Cyfrowa" })).toBeTruthy();
    expect(within(naglowek(container)).getByText("Reguły cyfrowej dekady")).toBeTruthy();
    expect(screen.getByText(`${W}publicBadge`)).toBeTruthy();
  });

  it("pasmo ukryte dostaje znacznik „ukryta”, a nie „widoczna”", () => {
    renderuj({ track: PASMO_PUSTE });

    expect(screen.getByText(`${W}hiddenBadge`)).toBeTruthy();
    expect(screen.queryByText(`${W}publicBadge`)).toBeNull();
  });

  // PASMO BEZ ZDANIA WPROWADZAJĄCEGO nie rysuje pustego akapitu pod tytułem -
  // RPC oddaje tam `NULL`, dopóki nikt zdania nie wpisał.
  it("pasmo bez zdania wprowadzającego nie rysuje pustego akapitu", () => {
    const { container } = renderuj({ track: PASMO_PUSTE });

    expect(container.querySelector("header p")).toBeNull();
  });

  it("wersja angielska bierze angielską nazwę i angielskie zdanie", () => {
    h.language = "en";
    const { container } = renderuj();

    expect(screen.getByRole("heading", { name: "Digital Track" })).toBeTruthy();
    expect(within(naglowek(container)).getByText("Rules for the digital decade")).toBeTruthy();
  });

  // BRAK TŁUMACZENIA NIE MOŻE ZOSTAWIĆ PUSTEGO NAGŁÓWKA - pasmo bez nazwy EN
  // pokazuje po angielsku nazwę polską.
  it("pasmo bez nazwy w języku interfejsu spada na drugi język", () => {
    h.language = "en";
    const { container } = renderuj({ track: trackRow({ name_en: "", tagline_en: "" }) });

    expect(screen.getByRole("heading", { name: "Ścieżka Cyfrowa" })).toBeTruthy();
    expect(within(naglowek(container)).getByText("Reguły cyfrowej dekady")).toBeTruthy();
  });

  it("wersja polska bez nazwy PL spada na angielską", () => {
    const { container } = renderuj({ track: trackRow({ name_pl: "", tagline_pl: "" }) });

    expect(screen.getByRole("heading", { name: "Digital Track" })).toBeTruthy();
    expect(within(naglowek(container)).getByText("Rules for the digital decade")).toBeTruthy();
  });

  it("powrót woła wyjście podane przez rodzica, a nie historię przeglądarki", () => {
    const wroc = vi.fn();
    renderuj({ onBack: wroc });
    fireEvent.click(screen.getByText(`${W}backAction`));

    expect(wroc).toHaveBeenCalledOnce();
  });

  it("nazwy zakładek niosą liczniki pasma z WIERSZA ścieżki", () => {
    renderuj();

    const nazwy = screen.getAllByRole("tab").map((node) => node.textContent);
    expect(nazwy).toContain(`${W}tabSpeakers (4)`);
    expect(nazwy).toContain(`${W}tabSessions (3)`);
  });
});

/* ------------------------------------------------------ zakładka szczegółów --- */

describe("zakładka „Szczegóły”", () => {
  it("otwiera się jako pierwsza, bez klikania", () => {
    renderuj();

    expect(screen.getByText(`${W}details.asideTitle`)).toBeTruthy();
    expect(screen.queryByText(`${W}format.asideTitle`)).toBeNull();
  });

  it("pokazuje okładkę pasma, gdy pasmo ją ma", () => {
    const { container } = renderuj();

    expect(container.querySelector('img[src="https://cdn.example.com/pasmo.jpg"]')).toBeTruthy();
    expect(screen.queryByText(`${W}details.coverEmpty`)).toBeNull();
  });

  it("pasmo bez okładki mówi o braku grafiki zamiast rysować pustą ramkę", () => {
    const { container } = renderuj({ track: PASMO_PUSTE });

    expect(screen.getByText(`${W}details.coverEmpty`)).toBeTruthy();
    expect(container.querySelector("img")).toBeNull();
  });

  it("pola tylko do odczytu niosą nazwę, zdanie, okno programu i salę domyślną", () => {
    renderuj();

    expect(pole(`${W}details.nameField`)).toBe("Ścieżka Cyfrowa");
    expect(pole(`${W}details.taglineField`)).toBe("Reguły cyfrowej dekady");
    expect(pole(`${W}details.room`)).toBe("Sala Główna");
    // Okno programu składa się z dwóch dat w strefie czytelnika - sprawdzamy
    // ROK i separator, bo dokładny format należy do `Intl`, nie do panelu.
    expect(pole(`${W}window`)).toContain("2026");
    expect(pole(`${W}window`)).toContain(" - ");
  });

  // PASMO BEZ SESJI NIE MA OKNA PROGRAMU. RPC liczy je jako `min(starts_at)` /
  // `max(ends_at)` po sesjach pasma, więc pasmo świeże dostaje `NULL` - i to
  // musi być zdanie, a nie myślnik między dwiema pustkami.
  it("pasmo bez sesji mówi wprost, że nie ma okna programu", () => {
    renderuj({ track: PASMO_PUSTE });

    expect(pole(`${W}window`)).toBe(`${W}windowEmpty`);
  });

  it("pasmo bez zdania i bez opisu mówi o obu brakach osobno", () => {
    renderuj({ track: PASMO_PUSTE });

    expect(pole(`${W}details.taglineField`)).toBe(`${W}details.taglineEmpty`);
    expect(pole(`${W}details.descriptionField`)).toBe(`${W}details.descriptionEmpty`);
  });

  it("pasmo bez sali domyślnej pokazuje wpis „brak sali”", () => {
    renderuj({ track: PASMO_PUSTE });

    expect(pole(`${W}details.room`)).toBe("adminEventAgenda.tracks.dialog.defaultRoomNone");
  });

  it("opis pasma stoi pod własną etykietą", () => {
    renderuj();

    expect(pole(`${W}details.descriptionField`)).toBe("Pasmo o suwerenności cyfrowej");
  });

  it("wersja angielska bierze angielski opis", () => {
    h.language = "en";
    renderuj();

    expect(pole(`${W}details.descriptionField`)).toBe("Digital sovereignty strand");
  });

  // OPIS BEZ WERSJI W JĘZYKU INTERFEJSU spada na drugi język - pusty prostokąt
  // pod etykietą „Opis" wyglądałby jak pasmo bez opisu, choć opis jest.
  it("pasmo bez opisu PL pokazuje po polsku opis angielski", () => {
    renderuj({ track: trackRow({ description_pl: "" }) });

    expect(pole(`${W}details.descriptionField`)).toBe("Digital sovereignty strand");
  });

  it("pasmo bez opisu EN pokazuje po angielsku opis polski", () => {
    h.language = "en";
    renderuj({ track: trackRow({ description_en: "" }) });

    expect(pole(`${W}details.descriptionField`)).toBe("Pasmo o suwerenności cyfrowej");
  });

  it("cztery metryki pasma czytają liczniki z wiersza ścieżki", () => {
    renderuj();

    expect(pole(`${W}metricSessions`)).toBe("3");
    expect(pole(`${W}metricPublished`)).toBe("2 / 3");
    expect(pole(`${W}metricSpeakers`)).toBe("4");
    expect(pole(`${W}metricMinutes`)).toBe(`${W}minutes(count=180)`);
  });
});

/* -------------------------------------------------------- zakładka formatów --- */

describe("zakładka „Format i wideo” - liczniki liczone z sesji", () => {
  const SESJE = [
    adminEventSessionRow({ id: "s-1", format: "onsite", has_stream: true }),
    adminEventSessionRow({ id: "s-2", format: "online", has_stream: true, has_recording: true }),
    adminEventSessionRow({ id: "s-3", format: "hybrid", requires_signup: true }),
    adminEventSessionRow({ id: "s-4", format: "onsite", chatham_house: true }),
  ];

  it("wczytywanie sesji pokazuje postęp i NIE mówi o pustce", () => {
    h.sessions = undefined;
    h.sessionsLoading = true;
    renderuj();
    zakladka(`${W}tabFormat`);

    expect(screen.getByText(`${W}format.loading`)).toBeTruthy();
    expect(screen.queryByText(`${W}format.empty`)).toBeNull();
  });

  // AWARIA WYGLĄDAJĄCA JAK PUSTKA każe organizatorowi wpisać program drugi raz.
  it("awaria mówi treścią odmowy i NIE mówi „pasmo nie ma sesji”", () => {
    h.sessions = undefined;
    h.sessionsError = new Error("permission denied for function admin_event_sessions_list");
    renderuj();
    zakladka(`${W}tabFormat`);

    expect(
      screen.getByText("odmowa:permission denied for function admin_event_sessions_list"),
    ).toBeTruthy();
    expect(screen.queryByText(`${W}format.empty`)).toBeNull();
  });

  it("wczytywanie po nieudanej próbie bije awarię", () => {
    h.sessions = undefined;
    h.sessionsLoading = true;
    h.sessionsError = new Error("sessions_failed");
    renderuj();
    zakladka(`${W}tabFormat`);

    expect(screen.getByText(`${W}format.loading`)).toBeTruthy();
    expect(screen.queryByText("odmowa:sessions_failed")).toBeNull();
  });

  it("pasmo bez sesji mówi, że nie ma czego podsumować", () => {
    renderuj();
    zakladka(`${W}tabFormat`);

    expect(screen.getByText(`${W}format.empty`)).toBeTruthy();
  });

  // TRZY FORMATY SĄ SUMĄ PO LIŚCIE SESJI, nie polem pasma - pomyłka w jednym
  // warunku pokazałaby sesje online tam, gdzie nie ma ani jednej.
  it("rozbicie formatów liczy każdą sesję dokładnie raz", () => {
    h.sessions = SESJE;
    renderuj();
    zakladka(`${W}tabFormat`);

    expect(wierszFunkcji("adminEventAgenda.formats.onsite").textContent).toContain(
      `${W}format.sessionsCount(count=2)`,
    );
    expect(wierszFunkcji("adminEventAgenda.formats.online").textContent).toContain(
      `${W}format.sessionsCount(count=1)`,
    );
    expect(wierszFunkcji("adminEventAgenda.formats.hybrid").textContent).toContain(
      `${W}format.sessionsCount(count=1)`,
    );
  });

  // FORMAT SPOZA KATALOGU (nowa wartość z migracji, o której panel jeszcze nie
  // wie) nie może doliczyć się do żadnego z trzech znanych kubełków.
  it("format spoza katalogu nie doklei się do żadnego z trzech liczników", () => {
    h.sessions = [adminEventSessionRow({ id: "s-9", format: "metaverse" })];
    renderuj();
    zakladka(`${W}tabFormat`);

    expect(wierszFunkcji("adminEventAgenda.formats.onsite").textContent).toContain("(count=0)");
    expect(wierszFunkcji("adminEventAgenda.formats.online").textContent).toContain("(count=0)");
    expect(wierszFunkcji("adminEventAgenda.formats.hybrid").textContent).toContain("(count=0)");
  });

  it("funkcje na żywo liczą transmisje, nagrania, zapisy i regułę Chatham House", () => {
    h.sessions = SESJE;
    renderuj();
    zakladka(`${W}tabFormat`);

    expect(wierszFunkcji(`${W}format.stream`).textContent).toContain("2");
    expect(wierszFunkcji(`${W}format.recording`).textContent).toContain("1");
    expect(wierszFunkcji(`${W}format.signup`).textContent).toContain("1");
    expect(wierszFunkcji(`${W}format.chatham`).textContent).toContain("1");
  });
});

/* ------------------------------------------------------ zakładka prelegentów --- */

describe("zakładka „Prelegenci” - obsada wyliczona z sesji", () => {
  it("pyta o obsadę TEGO pasma, a nie całego wydarzenia", () => {
    renderuj();

    expect(h.speakerTrackIds.every((id) => id === TRACK_ID)).toBe(true);
  });

  it("wczytywanie obsady pokazuje postęp i NIE mówi o pustce", () => {
    h.speakers = undefined;
    h.speakersLoading = true;
    renderuj();
    zakladka(`${W}tabSpeakers`);

    expect(screen.getByText(`${W}speakersLoading`)).toBeTruthy();
    expect(screen.queryByText(`${W}speakersEmpty`)).toBeNull();
  });

  it("awaria obsady mówi treścią odmowy i NIE mówi o pustce", () => {
    h.speakers = undefined;
    h.speakersError = new Error("permission denied for function admin_event_track_speakers");
    renderuj();
    zakladka(`${W}tabSpeakers`);

    expect(
      screen.getByText("odmowa:permission denied for function admin_event_track_speakers"),
    ).toBeTruthy();
    expect(screen.queryByText(`${W}speakersEmpty`)).toBeNull();
  });

  it("wczytywanie obsady po nieudanej próbie bije awarię", () => {
    h.speakers = undefined;
    h.speakersLoading = true;
    h.speakersError = new Error("speakers_failed");
    renderuj();
    zakladka(`${W}tabSpeakers`);

    expect(screen.getByText(`${W}speakersLoading`)).toBeTruthy();
    expect(screen.queryByText("odmowa:speakers_failed")).toBeNull();
  });

  it("pasmo bez obsady tłumaczy, że obsada wynika z sesji", () => {
    renderuj();
    zakladka(`${W}tabSpeakers`);

    expect(screen.getByText(`${W}speakersEmpty`)).toBeTruthy();
  });

  it("wiersz obsady niesie nazwisko, stanowisko i liczbę sesji w paśmie", () => {
    h.speakers = [speakerRow()];
    renderuj();
    zakladka(`${W}tabSpeakers`);

    const li = screen
      .getAllByRole("listitem")
      .find((node) => node.textContent?.includes("Anna Kowalska") === true);
    expect(li?.textContent).toContain("Dyrektorka ds. polityki cyfrowej");
    expect(li?.textContent).toContain("2");
  });

  // PROFIL BEZ IMIENIA I BEZ STANOWISKA nie może wywrócić listy: `display_name`
  // wisi na LEFT JOIN do `profiles`, więc bywa `NULL`.
  it("prelegent bez nazwiska dostaje znak zapytania w awatarze, a nie pusty kafel", () => {
    h.speakers = [
      speakerRow({ display_name: BRAK_NAPISU, job_title: BRAK_NAPISU, avatar_url: BRAK_NAPISU }),
    ];
    renderuj();
    zakladka(`${W}tabSpeakers`);

    expect(screen.getByText("?")).toBeTruthy();
  });

  // INICJAŁY BIERZEMY Z DWÓCH PIERWSZYCH CZŁONÓW - trzyczłonowe nazwisko nie
  // może rozepchnąć awatara trzema literami.
  it("inicjały biorą DWA pierwsze człony nazwiska", () => {
    h.speakers = [speakerRow({ display_name: "Maria Anna Zawadzka", avatar_url: BRAK_NAPISU })];
    renderuj();
    zakladka(`${W}tabSpeakers`);

    expect(screen.getByText("MA")).toBeTruthy();
  });

  // LICZNIK W NAZWIE ZAKŁADKI I LISTA POD NIĄ MAJĄ DWA RÓŻNE ŹRÓDŁA: licznik
  // pochodzi z wiersza ścieżki (`speakers_count`), lista z osobnego RPC. Ten
  // przypadek utrwala tę asymetrię - żeby zmiana źródła była decyzją, a nie
  // przypadkiem.
  it("licznik zakładki pochodzi z wiersza pasma, a lista z osobnego zapytania", () => {
    h.speakers = [speakerRow()];
    renderuj();

    expect(screen.getAllByRole("tab").map((node) => node.textContent)).toContain(
      `${W}tabSpeakers (4)`,
    );
    zakladka(`${W}tabSpeakers`);
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
  });
});

/* -------------------------------------------------------- zakładka wystawców --- */

describe("zakładka „Wystawcy”", () => {
  it("pyta o wystawców TEGO wydarzenia, z pustą frazą na wejście", () => {
    renderuj();

    expect(h.sponsorQueries[0]).toEqual({ eventId: EVENT_ID, q: "", limit: 50 });
  });

  it("wpisana fraza jedzie do zapytania o wystawców", () => {
    h.sponsors = [sponsorRow()];
    renderuj();
    zakladka(`${W}tabExhibitors`);
    fireEvent.change(screen.getByLabelText(`${W}exhibitors.searchPlaceholder`), {
      target: { value: "alfa" },
    });

    expect(h.sponsorQueries[h.sponsorQueries.length - 1]?.q).toBe("alfa");
  });

  it("wczytywanie wystawców pokazuje postęp i NIE mówi o pustce", () => {
    h.sponsors = undefined;
    h.sponsorsLoading = true;
    renderuj();
    zakladka(`${W}tabExhibitors`);

    expect(screen.getByText(`${W}exhibitors.loading`)).toBeTruthy();
    expect(screen.queryByText(`${W}exhibitors.empty`)).toBeNull();
  });

  it("awaria wystawców mówi treścią odmowy i NIE mówi o pustce", () => {
    h.sponsors = undefined;
    h.sponsorsError = new Error("permission denied for function admin_event_sponsors_list");
    renderuj();
    zakladka(`${W}tabExhibitors`);

    expect(
      screen.getByText("odmowa:permission denied for function admin_event_sponsors_list"),
    ).toBeTruthy();
    expect(screen.queryByText(`${W}exhibitors.empty`)).toBeNull();
  });

  it("wydarzenie bez wystawców mówi to wprost", () => {
    renderuj();
    zakladka(`${W}tabExhibitors`);

    expect(screen.getByText(`${W}exhibitors.empty`)).toBeTruthy();
  });

  it("wiersz wystawcy niesie nazwę, poziom i znacznik publikacji", () => {
    h.sponsors = [sponsorRow()];
    renderuj();
    zakladka(`${W}tabExhibitors`);

    const li = screen.getAllByRole("listitem")[0];
    expect(li.textContent).toContain("Alfa");
    expect(li.textContent).toContain("Złoty");
    expect(li.textContent).toContain(`${W}exhibitors.publishedBadge`);
  });

  it("wystawca nieopublikowany dostaje znacznik „ukryty”", () => {
    h.sponsors = [sponsorRow({ is_published: false })];
    renderuj();
    zakladka(`${W}tabExhibitors`);

    expect(screen.getByText(`${W}exhibitors.hiddenBadge`)).toBeTruthy();
  });

  it("wersja angielska bierze angielską nazwę poziomu", () => {
    h.language = "en";
    h.sponsors = [sponsorRow()];
    renderuj();
    zakladka(`${W}tabExhibitors`);

    expect(screen.getByText("Gold")).toBeTruthy();
    expect(screen.queryByText("Złoty")).toBeNull();
  });

  it("wystawca z logotypem rysuje obrazek, a bez logotypu - zastępczą ikonę", () => {
    h.sponsors = [
      sponsorRow(),
      sponsorRow({ id: "c2000000-0000-4000-8000-000000000002", snapshot_logo_url: BRAK_NAPISU }),
    ];
    const { container } = renderuj();
    zakladka(`${W}tabExhibitors`);

    expect(container.querySelectorAll('img[src="https://alfa.example.com/logo.png"]')).toHaveLength(
      1,
    );
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
  });

  // LICZNIK W NAZWIE ZAKŁADKI LICZY WYNIK ZAPYTANIA, nie wszystkich wystawców -
  // to jest bezpośredni skutek tego, że lista jest jednocześnie wyszukiwarką.
  it("licznik zakładki wystawców pokazuje liczbę wierszy z ostatniej odpowiedzi", () => {
    h.sponsors = [sponsorRow(), sponsorRow({ id: "c2000000-0000-4000-8000-000000000002" })];
    renderuj();

    expect(screen.getAllByRole("tab").map((node) => node.textContent)).toContain(
      `${W}tabExhibitors (2)`,
    );
  });

  // ---------------------------------------------------------------------------
  // DEFEKT: zakładka wystawców jest jednocześnie WYSZUKIWARKĄ, ale ma tylko
  // JEDEN stan pustki. Po wpisaniu frazy, do której nic nie pasuje, ekran mówi
  // `exhibitors.empty`, czyli „Wydarzenie nie ma jeszcze wystawców." - a to
  // nieprawda o stanie bazy: wystawcy są, tylko nie pasują do filtra.
  // Organizator czyta z tego zgodę na przypięcie firmy, która już jest przypięta,
  // i dostaje odmowę unikalności.
  //
  // BLIŹNIACZA ZAKŁADKA ROBI TO POPRAWNIE: `attendees.empty` brzmi „Brak zgłoszeń
  // pasujących do wyszukiwania." Naprawa to drugi klucz (albo `emptyLabel`
  // zależny od `exhibitorQuery !== ""`), dokładnie jak u uczestników.
  // ---------------------------------------------------------------------------
  it.fails("DEFEKT: pusty wynik WYSZUKIWANIA wystawców mówi „wydarzenie nie ma wystawców”", () => {
    h.sponsors = [sponsorRow()];
    renderuj();
    zakladka(`${W}tabExhibitors`);
    // Baza oddaje pustą listę dla frazy, do której nic nie pasuje.
    h.sponsors = [];
    fireEvent.change(screen.getByLabelText(`${W}exhibitors.searchPlaceholder`), {
      target: { value: "nieistniejaca-firma" },
    });

    expect(screen.queryByText(`${W}exhibitors.empty`)).toBeNull();
  });
});

/* ------------------------------------------------------ zakładka uczestników --- */

describe("zakładka „Uczestnicy”", () => {
  it("pyta o zgłoszenia TEGO wydarzenia, z pustą frazą i stroną po 25", () => {
    renderuj();

    expect(h.attendeeQueries[0]?.eventId).toBe(EVENT_ID);
    expect(h.attendeeQueries[0]?.q).toBe("");
    expect(h.attendeeQueries[0]?.limit).toBe(25);
  });

  it("wpisana fraza jedzie do zapytania o zgłoszenia", () => {
    renderuj();
    zakladka(`${W}tabAttendees`);
    fireEvent.change(screen.getByLabelText(`${W}attendees.searchPlaceholder`), {
      target: { value: "nowak" },
    });

    expect(h.attendeeQueries[h.attendeeQueries.length - 1]?.q).toBe("nowak");
  });

  it("wczytywanie zgłoszeń pokazuje postęp i NIE mówi o pustce", () => {
    h.attendees = undefined;
    h.attendeesLoading = true;
    renderuj();
    zakladka(`${W}tabAttendees`);

    expect(screen.getByText(`${W}attendees.loading`)).toBeTruthy();
    expect(screen.queryByText(`${W}attendees.empty`)).toBeNull();
  });

  it("awaria zgłoszeń mówi treścią odmowy i NIE mówi o pustce", () => {
    h.attendees = undefined;
    h.attendeesError = new Error("permission denied for function admin_event_registrations_list");
    renderuj();
    zakladka(`${W}tabAttendees`);

    expect(
      screen.getByText("odmowa:permission denied for function admin_event_registrations_list"),
    ).toBeTruthy();
    expect(screen.queryByText(`${W}attendees.empty`)).toBeNull();
  });

  it("brak zgłoszeń mówi o braku WYNIKÓW wyszukiwania, a nie o braku zgłoszeń", () => {
    renderuj();
    zakladka(`${W}tabAttendees`);

    expect(screen.getByText(`${W}attendees.empty`)).toBeTruthy();
  });

  // SUMA POCHODZI Z OKNA NAD ZAPYTANIEM (`total_count`), nie z długości strony -
  // strona po 25 wierszach nie może twierdzić, że zgłoszeń jest 25.
  it("licznik zgłoszeń bierze sumę PO filtrach, a nie długość strony", () => {
    h.attendees = { rows: [registrationRow()], total: 137 };
    renderuj();
    zakladka(`${W}tabAttendees`);

    expect(screen.getByText(`${W}attendees.total(count=137)`)).toBeTruthy();
    expect(screen.getAllByRole("tab").map((node) => node.textContent)).toContain(
      `${W}tabAttendees (137)`,
    );
  });

  it("brak odpowiedzi daje zero, a nie pusty napis w liczniku", () => {
    h.attendees = undefined;
    renderuj();

    expect(screen.getAllByRole("tab").map((node) => node.textContent)).toContain(
      `${W}tabAttendees (0)`,
    );
  });

  it("wiersz tabeli niesie e-mail, imię z nazwiskiem, stanowisko i firmę", () => {
    h.attendees = { rows: [registrationRow()], total: 1 };
    renderuj();
    zakladka(`${W}tabAttendees`);

    const wiersz = screen.getAllByRole("row")[1];
    expect(within(wiersz).getByText("uczestnik@example.com")).toBeTruthy();
    expect(within(wiersz).getByText("Jan Nowak")).toBeTruthy();
    expect(within(wiersz).getByText("Analityk")).toBeTruthy();
    expect(within(wiersz).getByText("Beta Institute")).toBeTruthy();
  });

  // ZGŁOSZENIE BEZ FIRMY Z CRM-U spada na firmę WPISANĄ ręcznie - kolumna nie
  // może zostać pusta tylko dlatego, że nikt nie dopiął rekordu w CRM.
  it("zgłoszenie bez firmy z CRM-u pokazuje firmę wpisaną ręcznie", () => {
    h.attendees = {
      rows: [registrationRow({ company_name: BRAK_NAPISU, company_text: "Gamma Foundation" })],
      total: 1,
    };
    renderuj();
    zakladka(`${W}tabAttendees`);

    expect(screen.getByText("Gamma Foundation")).toBeTruthy();
  });

  it("zgłoszenie bez imienia i nazwiska nie wywraca tabeli", () => {
    h.attendees = {
      rows: [
        registrationRow({
          first_name: BRAK_NAPISU,
          last_name: BRAK_NAPISU,
          job_title: BRAK_NAPISU,
          company_name: BRAK_NAPISU,
          company_text: BRAK_NAPISU,
        }),
      ],
      total: 1,
    };
    renderuj();
    zakladka(`${W}tabAttendees`);

    expect(screen.getAllByRole("row")).toHaveLength(2);
    expect(screen.getByText("uczestnik@example.com")).toBeTruthy();
  });

  it("data zgłoszenia jest sformatowana, a nie surowa", () => {
    h.attendees = { rows: [registrationRow()], total: 1 };
    renderuj();
    zakladka(`${W}tabAttendees`);

    const komorki = screen.getAllByRole("cell");
    expect(komorki[komorki.length - 1].textContent).toContain("2026");
    expect(komorki[komorki.length - 1].textContent).not.toContain("2026-08-02T10:00:00.000Z");
  });

  // DATA NIE DO SPARSOWANIA MA ZOSTAWIĆ PUSTĄ KOMÓRKĘ, a nie napis „Invalid Date".
  it("data nie do sparsowania zostawia pustą komórkę zamiast „Invalid Date”", () => {
    h.attendees = { rows: [registrationRow({ created_at: "nie-data" })], total: 1 };
    renderuj();
    zakladka(`${W}tabAttendees`);

    const komorki = screen.getAllByRole("cell");
    expect(komorki[komorki.length - 1].textContent).toBe("");
  });

  it("pusta data zostawia pustą komórkę", () => {
    h.attendees = { rows: [registrationRow({ created_at: "" })], total: 1 };
    renderuj();
    zakladka(`${W}tabAttendees`);

    const komorki = screen.getAllByRole("cell");
    expect(komorki[komorki.length - 1].textContent).toBe("");
  });
});

/* ---------------------------------------------------------- zakładka sesji --- */

describe("zakładka „Sesje” - warsztat zawężony do pasma", () => {
  it("pyta o sesje TEGO pasma, a nie o cały program wydarzenia", () => {
    renderuj();

    expect(h.sessionQueries[0]?.eventId).toBe(EVENT_ID);
    expect(h.sessionQueries[0]?.trackId).toBe(TRACK_ID);
    expect(h.sessionQueries[0]?.status).toBe("all");
  });

  it("warsztat sesji dostaje pasmo na sztywno i tryb osadzony", () => {
    renderuj();
    zakladka(`${W}tabSessions`);

    expect(h.panelSesji).toEqual({
      eventId: EVENT_ID,
      timeZoneLabel: STREFA,
      lockedTrackId: TRACK_ID,
      embedded: true,
    });
  });
});

/* --------------------------------------------------- dokumenty i preferencje --- */

describe("zakładki „Dokumenty” i „Preferencje”", () => {
  it("dokumenty mają wyszukiwarkę wyłączoną i zdanie o pustce", () => {
    renderuj();
    zakladka(`${W}tabDocuments`);

    const szukajka = screen.getByLabelText(`${W}documents.searchPlaceholder`);
    expect(szukajka.hasAttribute("disabled")).toBe(true);
    expect(screen.getByText(`${W}documents.empty`)).toBeTruthy();
  });

  it("preferencje pokazują widoczność i aktywność pasma jako jedynki", () => {
    renderuj();
    zakladka(`${W}tabPreferences`);

    expect(wierszFunkcji(`${W}preferences.visibility`).textContent).toContain("1");
    expect(wierszFunkcji(`${W}preferences.active`).textContent).toContain("1");
  });

  it("pasmo ukryte i wyłączone pokazuje w preferencjach zera", () => {
    renderuj({ track: PASMO_PUSTE });
    zakladka(`${W}tabPreferences`);

    expect(wierszFunkcji(`${W}preferences.visibility`).textContent).toContain("0");
    expect(wierszFunkcji(`${W}preferences.active`).textContent).toContain("0");
  });

  it("preferencje niosą klucz techniczny, kolejność i identyfikator wewnętrzny", () => {
    renderuj();
    zakladka(`${W}tabPreferences`);

    expect(pole(`${W}details.keyField`)).toBe("sciezka_cyfrowa");
    expect(pole(`${W}preferences.order`)).toBe("20");
    expect(screen.getByText(TRACK_ID)).toBeTruthy();
  });
});

describe("kopiowanie identyfikatora pasma", () => {
  it("kopiuje identyfikator do schowka i potwierdza to zdaniem", async () => {
    const zapisz = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: zapisz },
    });
    renderuj();
    zakladka(`${W}tabPreferences`);
    fireEvent.click(screen.getByLabelText(`${W}preferences.copyAction`));

    await waitFor(() => expect(h.toastSuccess).toHaveBeenCalledWith(`${W}preferences.copied`));
    expect(zapisz).toHaveBeenCalledExactlyOnceWith(TRACK_ID);
  });

  // ODMOWA SCHOWKA (brak zgody przeglądarki) NIE MOŻE UDAWAĆ SUKCESU - lepiej
  // milczenie niż zdanie „skopiowano" nad pustym schowkiem.
  it("odmowa schowka nie pokazuje potwierdzenia kopiowania", async () => {
    const zapisz = vi.fn(() => Promise.reject(new Error("NotAllowedError")));
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: zapisz },
    });
    renderuj();
    zakladka(`${W}tabPreferences`);
    fireEvent.click(screen.getByLabelText(`${W}preferences.copyAction`));

    await waitFor(() => expect(zapisz).toHaveBeenCalledOnce());
    expect(h.toastSuccess).not.toHaveBeenCalled();
  });

  // PRZEGLĄDARKA BEZ API SCHOWKA (kontekst bez HTTPS) nie może wywrócić ekranu.
  it("brak API schowka nie wywraca ekranu ani nie mówi o sukcesie", () => {
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: undefined });
    renderuj();
    zakladka(`${W}tabPreferences`);
    fireEvent.click(screen.getByLabelText(`${W}preferences.copyAction`));

    expect(h.toastSuccess).not.toHaveBeenCalled();
    expect(screen.getByText(TRACK_ID)).toBeTruthy();
  });
});

/* ------------------------------------------------------------- zapis ścieżki --- */

describe("edycja pasma", () => {
  it("okno startuje ZAMKNIĘTE", () => {
    renderuj();

    expect(h.okno?.open).toBe(false);
    expect(screen.queryByLabelText("okno-sciezki")).toBeNull();
  });

  it("przycisk w nagłówku otwiera okno z TYM pasmem", () => {
    renderuj();
    fireEvent.click(screen.getAllByText(`${W}details.editAction`)[0]);

    expect(h.okno?.open).toBe(true);
    expect(h.okno?.track?.id).toBe(TRACK_ID);
  });

  it("przycisk w kolumnie objaśnień otwiera to samo okno", () => {
    renderuj();
    const przyciski = screen.getAllByText(`${W}details.editAction`);
    fireEvent.click(przyciski[przyciski.length - 1]);

    expect(h.okno?.open).toBe(true);
  });

  it("zapis zamyka okno i mówi o sukcesie", () => {
    renderuj();
    fireEvent.click(screen.getAllByText(`${W}details.editAction`)[0]);
    fireEvent.click(screen.getByText("zapisz-sciezke"));

    expect(h.saveInputs).toEqual([WEJSCIE_ZAPISU]);
    expect(h.toastSuccess).toHaveBeenCalledWith("adminEventAgenda.tracks.toasts.saved");
    expect(h.okno?.open).toBe(false);
  });

  // ODMOWA ZOSTAWIA OKNO OTWARTE - wpisana praca ma zostać na ekranie.
  it("odmowa zapisu dochodzi zdaniem i NIE zamyka okna", () => {
    h.saveFails = "track_key_taken: a track with this key already exists";
    renderuj();
    fireEvent.click(screen.getAllByText(`${W}details.editAction`)[0]);
    fireEvent.click(screen.getByText("zapisz-sciezke"));

    expect(h.toastError).toHaveBeenCalledWith(
      "odmowa:track_key_taken: a track with this key already exists",
    );
    expect(h.toastSuccess).not.toHaveBeenCalled();
    expect(h.okno?.open).toBe(true);
  });

  // ZAPIS W TOKU JEST JEDYNYM ŹRÓDŁEM BLOKADY PRZYCISKU W OKNIE - bez niego
  // drugie kliknięcie „Zapisz" wysyła drugi upsert tego samego pasma.
  it("okno dostaje stan „zapis w toku” z haka, a nie zgaduje go samo", () => {
    h.savePending = true;
    renderuj();
    fireEvent.click(screen.getAllByText(`${W}details.editAction`)[0]);

    expect(h.okno?.isSaving).toBe(true);
  });

  it("bez zapisu w toku okno ma odblokowany przycisk", () => {
    renderuj();
    fireEvent.click(screen.getAllByText(`${W}details.editAction`)[0]);

    expect(h.okno?.isSaving).toBe(false);
  });

  it("zamknięcie okna z jego wnętrza gasi je także w organizmie", () => {
    renderuj();
    fireEvent.click(screen.getAllByText(`${W}details.editAction`)[0]);
    fireEvent.click(screen.getByText("zamknij-sciezke"));

    expect(h.okno?.open).toBe(false);
  });
});

/* ------------------------------------------------- przypięcie i odpięcie sesji --- */

describe("przypięcie i odpięcie sesji", () => {
  const otworzLink = () => {
    fireEvent.click(screen.getAllByText("adminEventAgenda.tracks.linkAction")[0]);
  };

  it("okno przypięcia startuje ZAMKNIĘTE i otwiera się przyciskiem nagłówka", () => {
    renderuj();
    expect(h.oknoLinku?.open).toBe(false);

    otworzLink();
    expect(h.oknoLinku?.open).toBe(true);
    expect(h.oknoLinku?.track?.id).toBe(TRACK_ID);
  });

  it("przycisk w zakładce sesji otwiera to samo okno", () => {
    renderuj();
    zakladka(`${W}tabSessions`);
    const przyciski = screen.getAllByText("adminEventAgenda.tracks.linkAction");
    fireEvent.click(przyciski[przyciski.length - 1]);

    expect(h.oknoLinku?.open).toBe(true);
  });

  // PRZYPIĘCIE TO `track_id = <pasmo>`.
  it("samo przypięcie wysyła JEDNO wywołanie z identyfikatorem pasma", async () => {
    renderuj();
    otworzLink();
    fireEvent.click(screen.getByText("link-przypnij"));

    await waitFor(() => expect(h.toastSuccess).toHaveBeenCalled());
    expect(h.setTrackCalls).toEqual([{ ids: ["s-1", "s-2"], trackId: TRACK_ID }]);
  });

  // ODPIĘCIE TO `track_id = null` - to JEST operacja, a nie brak danych.
  it("samo odpięcie wysyła JEDNO wywołanie z jawnym `null`", async () => {
    renderuj();
    otworzLink();
    fireEvent.click(screen.getByText("link-odepnij"));

    await waitFor(() => expect(h.toastSuccess).toHaveBeenCalled());
    expect(h.setTrackCalls).toEqual([{ ids: ["s-3"], trackId: null }]);
  });

  // DWIE INTENCJE = DWA WYWOŁANIA. Baza nie umie w jednym ładunku i przypiąć,
  // i odpiąć, więc organizm musi rozbić to sam - i zsumować wyniki.
  it("przypięcie z odpięciem naraz to DWA wywołania, a komunikat jest ich SUMĄ", async () => {
    h.setTrackMoved = 2;
    renderuj();
    otworzLink();
    fireEvent.click(screen.getByText("link-oba"));

    await waitFor(() =>
      expect(h.toastSuccess).toHaveBeenCalledWith("adminEventAgenda.tracks.link.saved(count=4)"),
    );
    expect(h.setTrackCalls).toEqual([
      { ids: ["s-1"], trackId: TRACK_ID },
      { ids: ["s-3"], trackId: null },
    ]);
  });

  it("udane przypięcie zamyka okno", async () => {
    renderuj();
    otworzLink();
    fireEvent.click(screen.getByText("link-przypnij"));

    await waitFor(() => expect(h.oknoLinku?.open).toBe(false));
  });

  // ZAMKNIĘCIE BEZ ZMIAN NIE JEST BŁĘDEM ANI SUKCESEM - to trzeci komunikat,
  // bo zapis, który nic nie zapisał, nie może mówić „zapisano N sesji".
  it("zamknięcie okna bez zmian nie rusza bazy i mówi osobnym komunikatem", () => {
    renderuj();
    otworzLink();
    fireEvent.click(screen.getByText("link-nic"));

    expect(h.setTrackCalls).toEqual([]);
    expect(h.toastMessage).toHaveBeenCalledWith("adminEventAgenda.tracks.link.nothing");
    expect(h.toastSuccess).not.toHaveBeenCalled();
    expect(h.oknoLinku?.open).toBe(false);
  });

  it("odmowa przypięcia dochodzi zdaniem i NIE zamyka okna", async () => {
    h.setTrackFails = "forbidden: event editor role required";
    renderuj();
    otworzLink();
    fireEvent.click(screen.getByText("link-przypnij"));

    await waitFor(() =>
      expect(h.toastError).toHaveBeenCalledWith("odmowa:forbidden: event editor role required"),
    );
    expect(h.toastSuccess).not.toHaveBeenCalled();
    expect(h.oknoLinku?.open).toBe(true);
  });

  it("okno przypięcia dostaje stan „zapis w toku” z haka", () => {
    h.setTrackPending = true;
    renderuj();
    otworzLink();

    expect(h.oknoLinku?.isSaving).toBe(true);
  });

  // DRUGIE KLIKNIĘCIE W CZASIE ZAPISU. Organizm nie ma własnej blokady - cała
  // obrona mieszka w oknie, które dostaje `isSaving`. Ten przypadek utrwala
  // zastane zachowanie: dwa kliknięcia to dwa przebiegi, więc wyłączenie
  // `isSaving` w oknie natychmiast zdublowałoby zapis.
  it("dwa kliknięcia zapisu w oknie dają DWA przebiegi - blokada mieszka w oknie", async () => {
    renderuj();
    otworzLink();
    const przycisk = screen.getByText("link-przypnij");
    fireEvent.click(przycisk);
    fireEvent.click(przycisk);

    await waitFor(() => expect(h.setTrackCalls).toHaveLength(2));
    expect(h.setTrackCalls[0]).toEqual(h.setTrackCalls[1]);
  });

  it("zamknięcie okna z jego wnętrza gasi je także w organizmie", () => {
    renderuj();
    otworzLink();
    fireEvent.click(screen.getByText("zamknij-link"));

    expect(h.oknoLinku?.open).toBe(false);
  });
});

/* ------------------------------------------------------------- dostępność --- */

describe("dostępność", () => {
  it("zakładka szczegółów nie ma naruszeń dostępności", async () => {
    const { container } = renderuj();

    const violations = await axeViolations(container);
    expect(violations, summarize(violations)).toEqual([]);
  });

  it("zakładka uczestników z tabelą nie ma naruszeń dostępności", async () => {
    h.attendees = { rows: [registrationRow()], total: 1 };
    const { container } = renderuj();
    zakladka(`${W}tabAttendees`);

    const violations = await axeViolations(container);
    expect(violations, summarize(violations)).toEqual([]);
  });

  it("zakładka prelegentów z obsadą nie ma naruszeń dostępności", async () => {
    h.speakers = [
      speakerRow(),
      speakerRow({
        speaker_profile_id: "59000000-0000-4000-8000-0000000000a2",
        display_name: "Piotr Zieliński",
      }),
    ];
    const { container } = renderuj();
    zakladka(`${W}tabSpeakers`);

    const violations = await axeViolations(container);
    expect(violations, summarize(violations)).toEqual([]);
  });

  it("zakładka preferencji nie ma naruszeń dostępności", async () => {
    const { container } = renderuj();
    zakladka(`${W}tabPreferences`);

    const violations = await axeViolations(container);
    expect(violations, summarize(violations)).toEqual([]);
  });
});
