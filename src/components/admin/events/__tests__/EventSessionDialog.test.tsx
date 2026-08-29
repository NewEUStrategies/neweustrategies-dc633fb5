// Molekuła „SESJA PROGRAMU" - dwadzieścia pól, z których cztery potrafią
// skasować pracę zespołu, jeśli formularz pomyli tryb albo wiersz.
//
// CO TEN PLIK DOWODZI.
//   1. EDYCJA CZEKA NA SZCZEGÓŁ, A ZAPIS JEST DO TEGO CZASU ZABLOKOWANY.
//      Adresy transmisji i nagrania są odcięte od listy grantem kolumnowym,
//      więc wiersz listy ICH NIE NIESIE. Gdyby okno zapisywało to, co ma
//      z listy, KAŻDE otwarcie i zapisanie sesji kasowałoby oba adresy - i to
//      jest dokładnie ta klasa błędu, której pilnuje ten plik.
//   2. TRYB TWORZENIA I TRYB EDYCJI TO DWA RÓŻNE FORMULARZE, a otwarcie dla
//      innej sesji nie może pokazywać pól poprzedniej.
//   3. KAŻDE POLE WYMAGANE OSOBNO ZATRZYMUJE ZAPIS PRZED ŻĄDANIEM - obie
//      nazwy, obie godziny i porządek godzin. Asercja stoi na MOCKU zapisu,
//      nie na wyglądzie.
//   4. LIMIT MIEJSC ŻYJE RAZEM Z ZAPISAMI. Baza odmawia limitu bez zapisów
//      (`capacity_requires_signup`), więc pole jest zablokowane, a wyłączenie
//      zapisów ZDEJMUJE wpisany limit - inaczej szkic zostawałby w stanie,
//      którego nie da się zapisać.
//   5. SESJA NADRZĘDNA NIE MOŻE BYĆ TĄ SESJĄ ANI PODSESJĄ INNEJ - lista
//      kandydatów jest odfiltrowana, a nie zdana na odmowę bazy.
//   6. KSZTAŁT ŁADUNKU jest asertowany na OBIEKCIE oddanym warstwie zapisu:
//      puste pole opcjonalne jako `null`, białe znaki obcięte, wartownik
//      „bez ścieżki" NIE wycieka do bazy.
//   7. TRWAJĄCY ZAPIS BLOKUJE OBA PRZYCISKI, a odmowa zostawia pracę w polach.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE. (1) Reguł wersji roboczej - `emptySessionDraft`,
// `sessionDraftFromRow`, `validateSessionDraft`, `sessionDraftToInput` mają
// tabele w `lib/events/__tests__/sessionDraft.test.ts`; tutaj dowodzimy, że
// molekuła ich UŻYWA i co robi z wynikiem. (2) Wierszy formularza
// (`AdminForm*Row`) - osobne molekuły panelu. (3) Zapytania o szczegół
// (`useSessionDetail`, klucze cache) - zamockowane na poziomie MODUŁU, bo
// przedmiotem dowodu jest, O CO molekuła pyta i co robi z odpowiedzią.
//
// DETERMINIZM STREFY: godziny przechodzą przez `toLocalInput`/`fromLocalInput`
// z modułu reguł, więc test nie zakłada strefy maszyny, na której leci.
// Radix Dialog, Select i Switch są podmienione na natywne odpowiedniki.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { radixSelectStub, radixSwitchStub } from "@/test/reactStubs";
import { fromLocalInput, toLocalInput } from "@/lib/events/sessionDraft";
import type {
  EventRoomRow,
  EventSessionDetailRow,
  EventSessionInput,
  EventSessionRow,
  EventTrackRow,
} from "@/lib/events/sessionsApi";

const h = vi.hoisted(() => ({
  language: "pl",
  /** Szczegóły sesji dostępne „z serwera" - brak klucza = zapytanie w locie. */
  details: {} as Record<string, unknown>,
  /** O którą sesję molekuła zapytała (`null` = nie zapytała wcale). */
  detailQueries: [] as (string | null)[],
}));

vi.mock("react-i18next", async () =>
  (await import("@/test/i18nStub")).reactI18nextStub(() => h.language),
);
vi.mock("@/components/ui/select", async () => radixSelectStub(await import("react")));
vi.mock("@/components/ui/switch", async () => radixSwitchStub(await import("react")));
vi.mock("@/components/ui/dialog", () => {
  const stan = { open: false };
  return {
    Dialog: ({ open, children }: { open: boolean; children?: ReactNode }) => {
      stan.open = open;
      return <div data-open={String(open)}>{children}</div>;
    },
    DialogContent: ({ children }: { children?: ReactNode }) =>
      stan.open ? <div data-testid="dialog-content">{children}</div> : null,
    DialogHeader: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
    DialogFooter: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
    DialogTitle: ({ children }: { children?: ReactNode }) => <h2>{children}</h2>,
    DialogDescription: ({ children }: { children?: ReactNode }) => <p>{children}</p>,
  };
});
vi.mock("@/lib/events/useEventSessions", () => ({
  useSessionDetail: (sessionId: string | null) => {
    h.detailQueries.push(sessionId);
    return { data: sessionId === null ? undefined : h.details[sessionId] };
  },
}));

const { EventSessionDialog } =
  await import("@/components/admin/events/molecules/EventSessionDialog");

const EVENT_ID = "11111111-1111-4111-8111-111111111111";
const STREFA = "Europe/Warsaw";

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
    sessions_count: 0,
    sort_order: 10,
    speakers_count: 0,
    tagline_en: "",
    tagline_pl: "",
    updated_at: "2026-08-01T09:00:00.000Z",
    ...overrides,
  };
}

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

/** Wiersz LISTY sesji - to z niego bierzemy kandydatów na sesję nadrzędną. */
function sessionRow(overrides: Partial<EventSessionRow> = {}): EventSessionRow {
  return {
    allow_overlap: true,
    cancelled_at: "",
    cancelled_count: 0,
    capacity: null as unknown as number,
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

/**
 * Wiersz SZCZEGÓŁU - osobna sygnatura `admin_event_session_detail`, bo tylko
 * ona niesie `stream_url` i `recording_url` (grant kolumnowy odcina je od listy).
 */
function detailRow(overrides: Partial<EventSessionDetailRow> = {}): EventSessionDetailRow {
  return {
    allow_overlap: true,
    cancelled_at: "",
    capacity: null as unknown as number,
    chatham_house: false,
    description_en: "Opening remarks",
    description_pl: "Słowo wstępne",
    ends_at: "2026-09-01T09:00:00.000Z",
    event_ends_at: "2026-09-01T18:00:00.000Z",
    event_id: EVENT_ID,
    event_starts_at: "2026-09-01T07:00:00.000Z",
    event_timezone: STREFA,
    event_title_en: "Congress",
    event_title_pl: "Kongres",
    format: "onsite",
    id: "session-a",
    is_private: false,
    min_tier_rank: 0,
    parent_session_id: "",
    published_at: "",
    recording_url: "https://cdn.test/nagranie.mp4",
    registered_count: 0,
    requires_signup: false,
    room_id: "room-a",
    seats_left: 0,
    sort_order: 10,
    speakers: [],
    starts_at: "2026-09-01T08:00:00.000Z",
    status: "draft",
    stream_url: "https://cdn.test/transmisja",
    title_en: "Opening",
    title_pl: "Otwarcie",
    track_id: "track-a",
    waitlist_count: 0,
    ...overrides,
  };
}

function renderuj(
  props: {
    open?: boolean;
    session?: EventSessionRow | null;
    sessions?: readonly EventSessionRow[];
    tracks?: readonly EventTrackRow[];
    rooms?: readonly EventRoomRow[];
    defaultTrackId?: string | null;
    isSaving?: boolean;
    nextSortOrder?: number;
  } = {},
) {
  const onOpenChange = vi.fn();
  const onSubmit = vi.fn();
  const wejscie = {
    open: props.open ?? true,
    session: props.session ?? null,
    sessions: props.sessions ?? [],
    tracks: props.tracks ?? [trackRow()],
    rooms: props.rooms ?? [roomRow()],
    defaultTrackId: props.defaultTrackId ?? null,
    isSaving: props.isSaving ?? false,
    nextSortOrder: props.nextSortOrder ?? 50,
  };
  const rysuj = () => (
    <EventSessionDialog
      open={wejscie.open}
      onOpenChange={onOpenChange}
      eventId={EVENT_ID}
      session={wejscie.session}
      tracks={wejscie.tracks}
      rooms={wejscie.rooms}
      sessions={wejscie.sessions}
      timeZoneLabel={STREFA}
      nextSortOrder={wejscie.nextSortOrder}
      defaultTrackId={wejscie.defaultTrackId}
      isSaving={wejscie.isSaving}
      onSubmit={onSubmit}
    />
  );
  const wynik = render(rysuj());
  const przerysuj = (zmiana: Partial<typeof wejscie>) => {
    Object.assign(wejscie, zmiana);
    wynik.rerender(rysuj());
  };
  return { ...wynik, onOpenChange, onSubmit, przerysuj };
}

const K = "adminEventAgenda.sessionDialog.";
const poleTytuluPl = () => screen.getByLabelText(`${K}titlePl`);
const poleTytuluEn = () => screen.getByLabelText(`${K}titleEn`);
const poleOpisuPl = () => screen.getByLabelText(`${K}descriptionPl`);
const poleOpisuEn = () => screen.getByLabelText(`${K}descriptionEn`);
const poleStartu = () => screen.getByLabelText(`${K}startsAt`);
const poleKonca = () => screen.getByLabelText(`${K}endsAt`);
const droplistaFormatu = () => screen.getByLabelText(`${K}format`);
const droplistaStatusu = () => screen.getByLabelText(`${K}status`);
const droplistaSciezki = () => screen.getByLabelText(`${K}track`);
const droplistaSali = () => screen.getByLabelText(`${K}room`);
const droplistaRodzica = () => screen.getByLabelText(`${K}parentSession`);
const przelacznikZapisow = () => screen.getByLabelText(`${K}requiresSignup`);
const poleLimitu = () => screen.getByLabelText(`${K}capacity`);
const poleProgu = () => screen.getByLabelText(`${K}minTierRank`);
const poleKolejnosci = () => screen.getByLabelText("adminEventAgenda.tracks.dialog.sortOrder");
const przelacznikNachodzenia = () => screen.getByLabelText(`${K}allowOverlap`);
const przelacznikChatham = () => screen.getByLabelText(`${K}chathamHouse`);
const przelacznikPrywatnosci = () => screen.getByLabelText(`${K}isPrivate`);
const poleTransmisji = () => screen.getByLabelText(`${K}streamUrl`);
const poleNagrania = () => screen.getByLabelText(`${K}recordingUrl`);
const przyciskZapisu = () => screen.getByRole("button", { name: `${K}saveAction` });
const przyciskAnuluj = () => screen.getByRole("button", { name: `${K}cancelAction` });

const ladunek = (onSubmit: ReturnType<typeof vi.fn>, nr = 0): EventSessionInput =>
  onSubmit.mock.calls[nr][0] as EventSessionInput;

const opcje = (select: HTMLElement): string[] =>
  Array.from(select.querySelectorAll("option")).map((option) => option.value);
const etykietyOpcji = (select: HTMLElement): (string | null)[] =>
  Array.from(select.querySelectorAll("option")).map((option) => option.textContent);

/** Minimum, po którym walidacja przepuszcza zapis. */
function wypelnijMinimum() {
  fireEvent.change(poleTytuluPl(), { target: { value: "Otwarcie" } });
  fireEvent.change(poleTytuluEn(), { target: { value: "Opening" } });
  fireEvent.change(poleStartu(), { target: { value: "2026-09-01T09:00" } });
  fireEvent.change(poleKonca(), { target: { value: "2026-09-01T10:00" } });
}

beforeEach(() => {
  vi.clearAllMocks();
  h.language = "pl";
  h.details = {};
  h.detailQueries = [];
});

describe("EventSessionDialog - tryb tworzenia kontra tryb edycji", () => {
  it("zamknięte okno nie renderuje formularza ANI nie pyta o szczegół", () => {
    h.details["session-a"] = detailRow();
    renderuj({ open: false, session: sessionRow() });
    expect(screen.queryByTestId("dialog-content")).not.toBeInTheDocument();
    expect(h.detailQueries.filter((pytanie) => pytanie !== null)).toEqual([]);
  });

  it("otwarcie BEZ wiersza daje pusty formularz z wartościami domyślnymi", () => {
    renderuj({ nextSortOrder: 50 });
    expect(screen.getByText(`${K}createTitle`)).toBeInTheDocument();
    expect(poleTytuluPl()).toHaveValue("");
    expect(poleTytuluEn()).toHaveValue("");
    expect(poleStartu()).toHaveValue("");
    expect(poleKonca()).toHaveValue("");
    expect(droplistaFormatu()).toHaveValue("onsite");
    expect(droplistaStatusu()).toHaveValue("draft");
    expect(poleProgu()).toHaveValue("0");
    expect(poleKolejnosci()).toHaveValue("50");
    // Zgoda na nachodzenie jest domyślnie włączona; wyłączona blokowałaby
    // planowanie równoległych punktów programu.
    expect(przelacznikNachodzenia()).toBeChecked();
    expect(przelacznikZapisow()).not.toBeChecked();
    // Nowa sesja nie ma po co pytać o szczegół - nie ma czego dociągać.
    expect(h.detailQueries.filter((pytanie) => pytanie !== null)).toEqual([]);
    expect(przyciskZapisu()).toBeEnabled();
  });

  it("sesja planowana Z POZIOMU PASMA startuje z tym pasmem wybranym", () => {
    // Formularz nie może pytać o to, co organizator wybrał, wchodząc w ścieżkę.
    renderuj({ defaultTrackId: "track-a" });
    expect(droplistaSciezki()).toHaveValue("track-a");
  });

  it("edycja PYTA O SZCZEGÓŁ i do jego przyjścia BLOKUJE zapis", () => {
    // Wiersz listy nie niesie adresów transmisji i nagrania (grant kolumnowy),
    // więc zapis przed przyjściem szczegółu skasowałby oba - blokada przycisku
    // jest jedyną obroną przed tym wyścigiem.
    const { onSubmit } = renderuj({ session: sessionRow() });
    expect(h.detailQueries).toContain("session-a");
    expect(przyciskZapisu()).toBeDisabled();
    expect(poleTytuluPl()).toHaveValue("");

    fireEvent.click(przyciskZapisu());
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("przyjście szczegółu wypełnia pola i odblokowuje zapis", () => {
    const { przerysuj } = renderuj({ session: sessionRow() });
    h.details["session-a"] = detailRow();
    przerysuj({});

    expect(screen.getByText(`${K}editTitle`)).toBeInTheDocument();
    expect(poleTytuluPl()).toHaveValue("Otwarcie");
    expect(poleTytuluEn()).toHaveValue("Opening");
    expect(poleOpisuPl()).toHaveValue("Słowo wstępne");
    expect(poleOpisuEn()).toHaveValue("Opening remarks");
    expect(poleStartu()).toHaveValue(toLocalInput("2026-09-01T08:00:00.000Z"));
    expect(poleKonca()).toHaveValue(toLocalInput("2026-09-01T09:00:00.000Z"));
    expect(droplistaSciezki()).toHaveValue("track-a");
    expect(droplistaSali()).toHaveValue("room-a");
    // TO JEST POWÓD ISTNIENIA ZAPYTANIA O SZCZEGÓŁ: oba adresy są w formularzu,
    // więc zapis ich nie skasuje.
    expect(poleTransmisji()).toHaveValue("https://cdn.test/transmisja");
    expect(poleNagrania()).toHaveValue("https://cdn.test/nagranie.mp4");
    expect(przyciskZapisu()).toBeEnabled();
  });

  it("sesja bez limitu miejsc pokazuje PUSTE pole limitu, nie zero", () => {
    // `capacity = null` znaczy „bez limitu", `0` - „ani jednego miejsca".
    // Sklejenie obu zamknęłoby zapisy na sesję, która miała ich nie ograniczać.
    h.details["session-a"] = detailRow({ capacity: null as unknown as number });
    renderuj({ session: sessionRow() });
    expect(poleLimitu()).toHaveValue("");
  });

  it("otwarcie dla INNEJ sesji, której szczegół już jest, pokazuje TĘ sesję", () => {
    h.details["session-a"] = detailRow();
    // Kolumny NULL-owalne wracają z RPC jako `null` (SQL ich nie skleja do
    // pustego łańcucha), więc atrapa szczegółu musi je oddać dokładnie tak.
    h.details["session-b"] = detailRow({
      id: "session-b",
      title_pl: "Panel zamykający",
      title_en: "Closing panel",
      stream_url: null as unknown as string,
      recording_url: null as unknown as string,
      track_id: null as unknown as string,
      room_id: null as unknown as string,
    });
    const { przerysuj } = renderuj({ session: sessionRow() });
    expect(poleTytuluPl()).toHaveValue("Otwarcie");

    przerysuj({ open: false });
    przerysuj({ open: true, session: sessionRow({ id: "session-b" }) });

    expect(poleTytuluPl()).toHaveValue("Panel zamykający");
    expect(poleTransmisji()).toHaveValue("");
    expect(droplistaSciezki()).toHaveValue("__none__");
  });

  it("porzucone zmiany nie wracają przy kolejnym otwarciu tej samej sesji", () => {
    h.details["session-a"] = detailRow();
    const { przerysuj } = renderuj({ session: sessionRow() });
    fireEvent.change(poleTytuluPl(), { target: { value: "Tytuł, którego nikt nie zapisał" } });

    przerysuj({ open: false });
    przerysuj({ open: true });

    expect(poleTytuluPl()).toHaveValue("Otwarcie");
  });
});

describe("EventSessionDialog - walidacja", () => {
  it("pusty formularz nie wychodzi do warstwy zapisu i wskazuje CZTERY pola", () => {
    const { onSubmit } = renderuj();
    fireEvent.click(przyciskZapisu());

    expect(onSubmit).not.toHaveBeenCalled();
    // Obie nazwy i obie godziny - odmowa `23514` z bazy nie powiedziałaby,
    // które z dwudziestu pól poprawić.
    expect(screen.getAllByRole("alert")).toHaveLength(4);
  });

  it("brak nazwy ANGIELSKIEJ zatrzymuje zapis osobno", () => {
    const { onSubmit } = renderuj();
    fireEvent.change(poleTytuluPl(), { target: { value: "Otwarcie" } });
    fireEvent.change(poleStartu(), { target: { value: "2026-09-01T09:00" } });
    fireEvent.change(poleKonca(), { target: { value: "2026-09-01T10:00" } });
    fireEvent.click(przyciskZapisu());

    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(`${K}validation.titleRequired`);
  });

  it("brak godziny KOŃCA zatrzymuje zapis osobno", () => {
    const { onSubmit } = renderuj();
    fireEvent.change(poleTytuluPl(), { target: { value: "Otwarcie" } });
    fireEvent.change(poleTytuluEn(), { target: { value: "Opening" } });
    fireEvent.change(poleStartu(), { target: { value: "2026-09-01T09:00" } });
    fireEvent.click(przyciskZapisu());

    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(`${K}validation.timesRequired`);
  });

  it("koniec przed startem jest odrzucany PRZED żądaniem", () => {
    const { onSubmit } = renderuj();
    wypelnijMinimum();
    fireEvent.change(poleKonca(), { target: { value: "2026-09-01T08:00" } });
    fireEvent.click(przyciskZapisu());

    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(`${K}validation.endBeforeStart`);
  });

  it("limit miejsc, który nie jest liczbą, nie wychodzi z okna", () => {
    const { onSubmit } = renderuj();
    wypelnijMinimum();
    fireEvent.click(przelacznikZapisow());
    fireEvent.change(poleLimitu(), { target: { value: "dwadzieścia" } });
    fireEvent.click(przyciskZapisu());

    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(`${K}validation.capacityNegative`);
  });

  it("adres transmisji bez https nie wychodzi z okna", () => {
    const { onSubmit } = renderuj();
    wypelnijMinimum();
    fireEvent.change(poleTransmisji(), { target: { value: "http://transmisja.test" } });
    fireEvent.click(przyciskZapisu());

    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(`${K}validation.urlNotHttps`);
  });

  it("komunikaty pojawiają się dopiero po próbie zapisu", () => {
    renderuj();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});

describe("EventSessionDialog - limit miejsc żyje razem z zapisami", () => {
  it("pole limitu jest ZABLOKOWANE, dopóki zapisy są wyłączone", () => {
    // Baza odmawia limitu bez zapisów, więc zamiast pozwolić wpisać liczbę,
    // która wróci odmową, pole jest nieczynne.
    renderuj();
    expect(poleLimitu()).toBeDisabled();
    fireEvent.click(przelacznikZapisow());
    expect(poleLimitu()).toBeEnabled();
  });

  it("wyłączenie zapisów ZDEJMUJE wpisany limit razem z nimi", () => {
    // Bez tego szkic zostawałby w stanie „limit bez zapisów", którego baza nie
    // przyjmie, a organizator widziałby liczbę w nieczynnym polu.
    const { onSubmit } = renderuj();
    wypelnijMinimum();
    fireEvent.click(przelacznikZapisow());
    fireEvent.change(poleLimitu(), { target: { value: "40" } });
    fireEvent.click(przelacznikZapisow());

    expect(poleLimitu()).toHaveValue("");
    fireEvent.click(przyciskZapisu());
    expect(ladunek(onSubmit)).toMatchObject({ requiresSignup: false, capacity: null });
  });

  it("limit przy włączonych zapisach dochodzi do warstwy zapisu jako LICZBA", () => {
    const { onSubmit } = renderuj();
    wypelnijMinimum();
    fireEvent.click(przelacznikZapisow());
    fireEvent.change(poleLimitu(), { target: { value: "40" } });
    fireEvent.click(przyciskZapisu());
    expect(ladunek(onSubmit)).toMatchObject({ requiresSignup: true, capacity: 40 });
  });
});

describe("EventSessionDialog - ścieżka, sala i sesja nadrzędna", () => {
  it("droplisty pokazują NAZWY, a nie identyfikatory, i jawną pozycję „brak”", () => {
    // Wpisywany identyfikator byłby jedynym miejscem panelu, gdzie organizator
    // musi znać UUID.
    renderuj({ sessions: [sessionRow()] });
    expect(etykietyOpcji(droplistaSciezki())).toEqual([
      "adminEventAgenda.sessions.noTrack",
      "Ścieżka Cyfrowa",
    ]);
    expect(etykietyOpcji(droplistaSali())).toEqual([
      "adminEventAgenda.sessions.noRoom",
      "Sala Plenarna",
    ]);
    expect(etykietyOpcji(droplistaRodzica())).toEqual(["-", "Otwarcie"]);
  });

  it("kandydatem na rodzica NIE jest ta sesja ani sesja, która sama ma rodzica", () => {
    // Drzewo ma dwa poziomy - odmowa bazy (`parent_depth`) ma być ostatnią
    // linią, a nie pierwszą, którą organizator zobaczy.
    h.details["session-a"] = detailRow();
    renderuj({
      session: sessionRow(),
      sessions: [
        // Sesja bez rodzica wraca z RPC jako `null`; pusty łańcuch to druga
        // przyjmowana postać tego samego stanu - obie muszą zostać kandydatami.
        sessionRow({ parent_session_id: null as unknown as string }),
        sessionRow({ id: "session-b", title_pl: "Panel", parent_session_id: "" }),
        sessionRow({ id: "session-c", title_pl: "Podsesja", parent_session_id: "session-b" }),
      ],
    });

    expect(opcje(droplistaRodzica())).toEqual(["__none__", "session-b"]);
  });

  it("dla NOWEJ sesji kandydatami są wszystkie sesje bez rodzica", () => {
    renderuj({
      sessions: [sessionRow(), sessionRow({ id: "session-c", parent_session_id: "session-a" })],
    });
    expect(opcje(droplistaRodzica())).toEqual(["__none__", "session-a"]);
  });

  it("wartownik „brak” NIE wycieka do warstwy zapisu - jedzie null", () => {
    const { onSubmit } = renderuj({ sessions: [sessionRow()] });
    wypelnijMinimum();
    fireEvent.change(droplistaSciezki(), { target: { value: "track-a" } });
    fireEvent.change(droplistaSali(), { target: { value: "room-a" } });
    fireEvent.change(droplistaRodzica(), { target: { value: "session-a" } });
    fireEvent.change(droplistaSciezki(), { target: { value: "__none__" } });
    fireEvent.change(droplistaSali(), { target: { value: "__none__" } });
    fireEvent.change(droplistaRodzica(), { target: { value: "__none__" } });
    fireEvent.click(przyciskZapisu());

    expect(ladunek(onSubmit)).toMatchObject({ trackId: null, roomId: null, parentSessionId: null });
  });

  it("wybór ścieżki, sali i rodzica dochodzi do warstwy zapisu", () => {
    const { onSubmit } = renderuj({ sessions: [sessionRow()] });
    wypelnijMinimum();
    fireEvent.change(droplistaSciezki(), { target: { value: "track-a" } });
    fireEvent.change(droplistaSali(), { target: { value: "room-a" } });
    fireEvent.change(droplistaRodzica(), { target: { value: "session-a" } });
    fireEvent.click(przyciskZapisu());

    expect(ladunek(onSubmit)).toMatchObject({
      trackId: "track-a",
      roomId: "room-a",
      parentSessionId: "session-a",
    });
  });

  it("interfejs angielski bierze nazwy ANGIELSKIE, polski - polskie", () => {
    h.language = "en";
    renderuj({ sessions: [sessionRow()] });
    expect(etykietyOpcji(droplistaSciezki())).toContain("Digital Track");
    expect(etykietyOpcji(droplistaRodzica())).toContain("Opening");
  });

  it("brak nazwy w języku interfejsu spada na drugą kolumnę, a nie na pustkę", () => {
    // Pasmo opisane tylko po polsku nie może zniknąć z anglojęzycznej droplisty -
    // pusta pozycja wygląda jak awaria listy.
    h.language = "en";
    renderuj({
      tracks: [trackRow({ name_en: "" })],
      sessions: [sessionRow({ title_en: "" })],
    });
    expect(etykietyOpcji(droplistaSciezki())).toContain("Ścieżka Cyfrowa");
    expect(etykietyOpcji(droplistaRodzica())).toContain("Otwarcie");
  });

  it("brak nazwy polskiej w interfejsie polskim spada na angielską", () => {
    renderuj({
      tracks: [trackRow({ name_pl: "" })],
      sessions: [sessionRow({ title_pl: "" })],
    });
    expect(etykietyOpcji(droplistaSciezki())).toContain("Digital Track");
    expect(etykietyOpcji(droplistaRodzica())).toContain("Opening");
  });
});

describe("EventSessionDialog - ładunek zapisu", () => {
  it("nowa sesja: białe znaki obcięte, puste adresy jako null", () => {
    const { onSubmit } = renderuj({ nextSortOrder: 50 });
    fireEvent.change(poleTytuluPl(), { target: { value: "  Otwarcie  " } });
    fireEvent.change(poleTytuluEn(), { target: { value: "  Opening  " } });
    fireEvent.change(poleStartu(), { target: { value: "2026-09-01T09:00" } });
    fireEvent.change(poleKonca(), { target: { value: "2026-09-01T10:00" } });
    fireEvent.click(przyciskZapisu());

    expect(ladunek(onSubmit)).toEqual({
      id: null,
      eventId: EVENT_ID,
      titlePl: "Otwarcie",
      titleEn: "Opening",
      descriptionPl: "",
      descriptionEn: "",
      startsAt: fromLocalInput("2026-09-01T09:00"),
      endsAt: fromLocalInput("2026-09-01T10:00"),
      format: "onsite",
      status: "draft",
      trackId: null,
      roomId: null,
      parentSessionId: null,
      requiresSignup: false,
      capacity: null,
      minTierRank: 0,
      chathamHouse: false,
      isPrivate: false,
      allowOverlap: true,
      // Puste adresy MUSZĄ jechać jako `null`: pusty łańcuch w kolumnie znaczy
      // „transmisja pod adresem zero-znakowym", a nie „bez transmisji".
      streamUrl: null,
      recordingUrl: null,
      sortOrder: 50,
    });
  });

  it("godzina z pola trafia do ładunku jako czas UTC tej samej chwili", () => {
    const { onSubmit } = renderuj();
    wypelnijMinimum();
    fireEvent.click(przyciskZapisu());

    const wyslane = ladunek(onSubmit);
    expect(wyslane.startsAt.endsWith("Z")).toBe(true);
    // Droga powrotna musi dać dokładnie to, co organizator wpisał - inaczej
    // sesja przesuwa się o strefę przy każdym zapisie.
    expect(toLocalInput(wyslane.startsAt)).toBe("2026-09-01T09:00");
  });

  it("wszystkie przełączniki i liczby dochodzą do warstwy zapisu", () => {
    const { onSubmit } = renderuj();
    wypelnijMinimum();
    fireEvent.change(poleOpisuPl(), { target: { value: " Słowo wstępne " } });
    fireEvent.change(poleOpisuEn(), { target: { value: "Opening remarks" } });
    fireEvent.change(droplistaFormatu(), { target: { value: "hybrid" } });
    fireEvent.change(droplistaStatusu(), { target: { value: "published" } });
    fireEvent.change(poleProgu(), { target: { value: "20" } });
    fireEvent.change(poleKolejnosci(), { target: { value: "70" } });
    fireEvent.click(przelacznikNachodzenia());
    fireEvent.click(przelacznikChatham());
    fireEvent.click(przelacznikPrywatnosci());
    fireEvent.change(poleTransmisji(), { target: { value: " https://cdn.test/live " } });
    fireEvent.change(poleNagrania(), { target: { value: "https://cdn.test/vod" } });
    fireEvent.click(przyciskZapisu());

    expect(ladunek(onSubmit)).toMatchObject({
      descriptionPl: "Słowo wstępne",
      descriptionEn: "Opening remarks",
      format: "hybrid",
      status: "published",
      minTierRank: 20,
      sortOrder: 70,
      allowOverlap: false,
      chathamHouse: true,
      isPrivate: true,
      streamUrl: "https://cdn.test/live",
      recordingUrl: "https://cdn.test/vod",
    });
  });

  it("edycja niesie IDENTYFIKATOR sesji - inaczej zapis założyłby drugą", () => {
    h.details["session-a"] = detailRow();
    const { onSubmit } = renderuj({ session: sessionRow() });
    fireEvent.change(poleTytuluPl(), { target: { value: "Otwarcie kongresu" } });
    fireEvent.click(przyciskZapisu());

    expect(ladunek(onSubmit)).toMatchObject({
      id: "session-a",
      titlePl: "Otwarcie kongresu",
      streamUrl: "https://cdn.test/transmisja",
      recordingUrl: "https://cdn.test/nagranie.mp4",
    });
  });
});

describe("EventSessionDialog - stan oczekiwania i odmowa", () => {
  it("trwający zapis blokuje oba przyciski, więc podwójne kliknięcie nie tworzy dwóch sesji", () => {
    const { onSubmit, onOpenChange, przerysuj } = renderuj();
    wypelnijMinimum();
    fireEvent.click(przyciskZapisu());
    expect(onSubmit).toHaveBeenCalledTimes(1);

    przerysuj({ isSaving: true });

    expect(przyciskZapisu()).toBeDisabled();
    expect(przyciskAnuluj()).toBeDisabled();
    fireEvent.click(przyciskZapisu());
    fireEvent.click(przyciskAnuluj());
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it("odmowa zapisu zostawia cały formularz nietknięty", () => {
    const { onSubmit, przerysuj } = renderuj();
    wypelnijMinimum();
    fireEvent.change(poleOpisuPl(), { target: { value: "Opis pisany kwadrans" } });
    fireEvent.click(przyciskZapisu());

    przerysuj({ isSaving: true });
    przerysuj({ isSaving: false });

    expect(poleTytuluPl()).toHaveValue("Otwarcie");
    expect(poleOpisuPl()).toHaveValue("Opis pisany kwadrans");
    expect(poleStartu()).toHaveValue("2026-09-01T09:00");
    fireEvent.click(przyciskZapisu());
    expect(onSubmit).toHaveBeenCalledTimes(2);
    expect(ladunek(onSubmit, 1)).toEqual(ladunek(onSubmit, 0));
  });

  it("anulowanie zamyka okno i nie wysyła niczego", () => {
    const { onOpenChange, onSubmit } = renderuj();
    wypelnijMinimum();
    fireEvent.click(przyciskAnuluj());
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("otwarcie dla innej sesji NIE zostawia pól POPRZEDNIEJ, dopóki nie przyjdzie szczegół", () => {
    // Zanim to naprawiono, efekt odtwarzający szkic wychodził przy
    // `detail === null`, więc przez czas zapytania o szczegół sesji B
    // w polach stała sesja A. Zapis był wtedy zablokowany, ale ekran KŁAMAŁ:
    // organizator czytał tytuł, godziny i adres transmisji zupełnie innego
    // punktu programu i na tej podstawie decydował, co poprawić. Teraz
    // zmiana sesji zeruje pola (jak przy pierwszym otwarciu), a wypełnia je
    // dopiero przyjście szczegółu.
    h.details["session-a"] = detailRow();
    const { przerysuj } = renderuj({ session: sessionRow() });
    expect(poleTytuluPl()).toHaveValue("Otwarcie");

    przerysuj({ open: false });
    przerysuj({ open: true, session: sessionRow({ id: "session-b" }) });

    expect(poleTytuluPl()).toHaveValue("");
    expect(poleTransmisji()).toHaveValue("");
  });

  it("odświeżenie szczegółu w tle NIE kasuje poprawek wpisanych w otwartym oknie", () => {
    // Zanim to naprawiono, `detail` był w zależnościach efektu, a
    // `useSessionDetail` oddaje przy każdym pobraniu NOWY obiekt. Odświeżenie
    // w tle (powrót do karty przeglądarki po `staleTime`, unieważnienie cache
    // przez inną mutację) nadpisywało szkic wartościami z serwera.
    // Jak to widział użytkownik: poprawiony tytuł i przepisany opis znikały
    // w trakcie pisania, bez żadnego komunikatu, i wracały stare treści.
    // Teraz zależnością jest TOŻSAMOŚĆ szczegółu, więc ponowne pobranie tego
    // samego wiersza niczego nie nadpisuje.
    h.details["session-a"] = detailRow();
    const { przerysuj } = renderuj({ session: sessionRow() });
    fireEvent.change(poleTytuluPl(), { target: { value: "Otwarcie kongresu" } });

    h.details["session-a"] = detailRow();
    przerysuj({});

    expect(poleTytuluPl()).toHaveValue("Otwarcie kongresu");
  });
});
