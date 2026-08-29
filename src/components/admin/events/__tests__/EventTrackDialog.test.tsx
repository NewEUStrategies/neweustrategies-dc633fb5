// Molekuła „ŚCIEŻKA PROGRAMU" - formularz pasma, który sam wyprowadza klucz
// techniczny i sam pilnuje, co wolno wysłać do bazy.
//
// CO TEN PLIK DOWODZI.
//   1. DWA TRYBY TO DWA FORMULARZE, a otwarcie dla innego pasma nie może
//      pokazywać pól poprzedniego - pomyłka tej klasy kończy się opisem
//      jednej ścieżki wpisanym w drugą.
//   2. OBIE NAZWY SĄ WYMAGANE OSOBNO. Ścieżka bez nazwy angielskiej znika
//      z anglojęzycznej agendy publicznej, więc brak każdej z nich osobno
//      zatrzymuje zapis PRZED żądaniem - asercja stoi na mocku zapisu.
//   3. KLUCZ WYPROWADZAMY Z NAZWY I ZAMRAŻAMY. Nowa ścieżka dostaje klucz
//      z polskiej nazwy złożonej do ASCII; ścieżka z bazy zachowuje swój,
//      bo baza go przy edycji nie czyta - podmiana byłaby cichym zerwaniem
//      odnośników.
//   4. KOLOR SPOZA WZORU `#RRGGBB` NIE JEDZIE DO BAZY. Kolor wraca na publiczną
//      agendę do atrybutu `style`; „czerwony" byłby tam śmieciem, więc zamiast
//      niego jedzie brak koloru.
//   5. PUSTE POLE OPCJONALNE JEDZIE JAKO `null`, nie jako pusty łańcuch, a
//      białe znaki są obcinane - asercja na ARGUMENCIE warstwy zapisu.
//   6. LISTA SAL JEST PYTANA TYLKO PRZY OTWARTYM OKNIE, a „bez sali" jest
//      JAWNĄ pozycją listy i wraca do bazy jako brak sali.
//   7. TRWAJĄCY ZAPIS BLOKUJE OBA PRZYCISKI (podwójne kliknięcie = dwie
//      ścieżki), a odmowa zostawia pracę organizatora w polach.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE. (1) Reguł wersji roboczej - `emptyTrackDraft`,
// `trackDraftFromRow`, `deriveTrackKey`, `validateTrackDraft`,
// `trackDraftToInput` mają tabele w `lib/events/__tests__/agendaCatalogDraft.test.ts`;
// tutaj dowodzimy, że molekuła ich UŻYWA. (2) Wierszy formularza
// (`AdminFormTextRow`, `AdminFormSwitchRow`, `AdminFormEnumRow`) - osobne
// molekuły. (3) Uploadu grafiki (`EventImageDropzone`) - atrapa, bo przedmiotem
// dowodu jest to, CO molekuła z pola grafiki bierze i dokąd to wysyła.
//
// Radix Dialog, Select i Switch nie działają pod happy-dom bez pełnego pointer
// API - wszystkie trzy są podmienione na natywne odpowiedniki.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { radixSelectStub, radixSwitchStub } from "@/test/reactStubs";
import type { EventRoomRow, EventTrackInput, EventTrackRow } from "@/lib/events/sessionsApi";

const h = vi.hoisted(() => ({
  /** Sale wydarzenia widziane przez droplistę „sala domyślna". */
  rooms: [] as unknown[],
  /** Z jakim wydarzeniem molekuła zapytała o sale (`null` = nie zapytała). */
  roomQueries: [] as (string | null)[],
}));

vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());
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
// Pole grafiki ma własny upload do biblioteki mediów - tu liczy się wyłącznie
// to, JAKI adres molekuła z niego bierze i do JAKIEGO katalogu go kieruje.
vi.mock("@/components/admin/events/atoms/EventImageDropzone", () => ({
  EventImageDropzone: ({
    label,
    value,
    onValueChange,
    subfolder,
  }: {
    label: string;
    value: string;
    onValueChange: (value: string) => void;
    subfolder: string;
  }) => (
    <div data-testid="okladka" data-subfolder={subfolder}>
      <label htmlFor="pole-okladki">{label}</label>
      <input
        id="pole-okladki"
        value={value}
        onChange={(event) => onValueChange(event.target.value)}
      />
    </div>
  ),
}));
vi.mock("@/lib/events/useEventSessions", () => ({
  useEventRooms: (eventId: string | null) => {
    h.roomQueries.push(eventId);
    return { data: eventId === null ? undefined : h.rooms };
  },
}));

const { EventTrackDialog } = await import("@/components/admin/events/molecules/EventTrackDialog");

const EVENT_ID = "11111111-1111-4111-8111-111111111111";

function roomRow(overrides: Partial<EventRoomRow> = {}): EventRoomRow {
  return {
    booked_minutes: 0,
    capacity: 100,
    created_at: "2026-08-01T09:00:00.000Z",
    event_id: EVENT_ID,
    floor: "Parter",
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

/** Wiersz `admin_event_tracks_list` - pełny kształt sygnatury, nie wycinek. */
function trackRow(overrides: Partial<EventTrackRow> = {}): EventTrackRow {
  return {
    accent_color: "#fa9346",
    cover_url: "https://cdn.test/tracks/a.jpg",
    created_at: "2026-08-01T09:00:00.000Z",
    default_room_id: "room-a",
    default_room_name: "Sala Plenarna",
    description_en: "Digital sovereignty",
    description_pl: "Suwerenność cyfrowa",
    draft_count: 1,
    event_id: EVENT_ID,
    first_starts_at: "2026-09-01T08:00:00.000Z",
    id: "track-a",
    is_active: true,
    is_public: true,
    key: "sciezka_stara",
    last_ends_at: "2026-09-01T16:00:00.000Z",
    minutes_total: 240,
    name_en: "Digital Track",
    name_pl: "Ścieżka Cyfrowa",
    published_count: 4,
    sessions_count: 5,
    sort_order: 20,
    speakers_count: 7,
    tagline_en: "Rules for data",
    tagline_pl: "Reguły dla danych",
    updated_at: "2026-08-02T09:00:00.000Z",
    ...overrides,
  };
}

function renderuj(
  props: {
    open?: boolean;
    track?: EventTrackRow | null;
    isSaving?: boolean;
    nextSortOrder?: number;
  } = {},
) {
  const onOpenChange = vi.fn();
  const onSubmit = vi.fn();
  const wejscie = {
    open: props.open ?? true,
    track: props.track ?? null,
    isSaving: props.isSaving ?? false,
    nextSortOrder: props.nextSortOrder ?? 30,
  };
  const rysuj = () => (
    <EventTrackDialog
      open={wejscie.open}
      onOpenChange={onOpenChange}
      eventId={EVENT_ID}
      track={wejscie.track}
      nextSortOrder={wejscie.nextSortOrder}
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

const K = "adminEventAgenda.tracks.dialog.";
const poleNazwyPl = () => screen.getByLabelText(`${K}namePl`);
const poleNazwyEn = () => screen.getByLabelText(`${K}nameEn`);
const poleKoloru = () => screen.getByLabelText(`${K}accentColor`);
const poleZajawkiPl = () => screen.getByLabelText(`${K}taglinePl`);
const poleZajawkiEn = () => screen.getByLabelText(`${K}taglineEn`);
const poleOpisuPl = () => screen.getByLabelText(`${K}descriptionPl`);
const poleOpisuEn = () => screen.getByLabelText(`${K}descriptionEn`);
const poleOkladki = () => screen.getByLabelText(`${K}coverUrl`);
const droplistaSali = () => screen.getByLabelText(`${K}defaultRoom`);
const przelacznikAktywnosci = () => screen.getByLabelText(`${K}isActive`);
const przelacznikWidocznosci = () => screen.getByLabelText(`${K}isPublic`);
const przyciskZapisu = () => screen.getByRole("button", { name: `${K}saveAction` });
const przyciskAnuluj = () => screen.getByRole("button", { name: `${K}cancelAction` });

const ladunek = (onSubmit: ReturnType<typeof vi.fn>, nr = 0): EventTrackInput =>
  onSubmit.mock.calls[nr][0] as EventTrackInput;

/** Minimum, po którym walidacja przepuszcza zapis. */
function wypelnijNazwy(pl = "Ścieżka Cyfrowa", en = "Digital Track") {
  fireEvent.change(poleNazwyPl(), { target: { value: pl } });
  fireEvent.change(poleNazwyEn(), { target: { value: en } });
}

beforeEach(() => {
  vi.clearAllMocks();
  h.rooms = [roomRow(), roomRow({ id: "room-b", name: "Sala Warsztatowa" })];
  h.roomQueries = [];
});

describe("EventTrackDialog - tryb tworzenia kontra tryb edycji", () => {
  it("zamknięte okno nie renderuje formularza ANI nie pyta o sale", () => {
    // Lista sal jest podpowiedzią tego formularza, więc zamknięte okno nie ma
    // czego dopytywać - każdy wiersz katalogu trzymałby wtedy własne żądanie.
    renderuj({ open: false, track: trackRow() });
    expect(screen.queryByTestId("dialog-content")).not.toBeInTheDocument();
    expect(h.roomQueries.filter((pytanie) => pytanie !== null)).toEqual([]);
  });

  it("otwarcie BEZ wiersza daje pusty formularz, tytuł tworzenia i pyta o sale", () => {
    renderuj();
    expect(screen.getByText(`${K}createTitle`)).toBeInTheDocument();
    expect(poleNazwyPl()).toHaveValue("");
    expect(poleNazwyEn()).toHaveValue("");
    expect(poleKoloru()).toHaveValue("");
    expect(poleZajawkiPl()).toHaveValue("");
    expect(poleOkladki()).toHaveValue("");
    // Nowa ścieżka jest domyślnie czynna i widoczna publicznie - inaczej
    // organizator zakłada pasmo, którego nikt nie zobaczy.
    expect(przelacznikAktywnosci()).toBeChecked();
    expect(przelacznikWidocznosci()).toBeChecked();
    expect(h.roomQueries).toContain(EVENT_ID);
  });

  it("otwarcie Z wierszem wypełnia pola tą ścieżką i tytuł mówi o edycji", () => {
    renderuj({ track: trackRow() });
    expect(screen.getByText(`${K}editTitle`)).toBeInTheDocument();
    expect(poleNazwyPl()).toHaveValue("Ścieżka Cyfrowa");
    expect(poleNazwyEn()).toHaveValue("Digital Track");
    expect(poleKoloru()).toHaveValue("#fa9346");
    expect(poleZajawkiPl()).toHaveValue("Reguły dla danych");
    expect(poleZajawkiEn()).toHaveValue("Rules for data");
    expect(poleOpisuPl()).toHaveValue("Suwerenność cyfrowa");
    expect(poleOpisuEn()).toHaveValue("Digital sovereignty");
    expect(poleOkladki()).toHaveValue("https://cdn.test/tracks/a.jpg");
    expect(droplistaSali()).toHaveValue("room-a");
  });

  it("otwarcie dla INNEJ ścieżki nie zostawia pól poprzedniej", () => {
    // Regresja, którą to łapie: organizator otwiera pasmo „Zielone", widzi
    // opis i okładkę pasma „Cyfrowego" i zapisuje jedno treścią drugiego.
    const { przerysuj } = renderuj({ track: trackRow() });
    expect(poleNazwyPl()).toHaveValue("Ścieżka Cyfrowa");

    przerysuj({ open: false });
    przerysuj({
      open: true,
      track: trackRow({
        id: "track-b",
        key: "sciezka_zielona",
        name_pl: "Ścieżka Zielona",
        name_en: "Green Track",
        accent_color: "",
        tagline_pl: "",
        tagline_en: "",
        description_pl: "",
        description_en: "",
        cover_url: "",
        default_room_id: "",
        is_active: false,
        is_public: false,
      }),
    });

    expect(poleNazwyPl()).toHaveValue("Ścieżka Zielona");
    expect(poleNazwyEn()).toHaveValue("Green Track");
    expect(poleKoloru()).toHaveValue("");
    expect(poleZajawkiPl()).toHaveValue("");
    expect(poleOpisuPl()).toHaveValue("");
    expect(poleOkladki()).toHaveValue("");
    expect(przelacznikAktywnosci()).not.toBeChecked();
    expect(przelacznikWidocznosci()).not.toBeChecked();
  });

  it("porzucone zmiany nie wracają przy kolejnym otwarciu", () => {
    const { przerysuj } = renderuj();
    wypelnijNazwy("Pasmo porzucone", "Abandoned");
    przerysuj({ open: false });
    przerysuj({ open: true });
    expect(poleNazwyPl()).toHaveValue("");
    expect(poleNazwyEn()).toHaveValue("");
  });
});

describe("EventTrackDialog - walidacja", () => {
  it("brak nazwy POLSKIEJ zatrzymuje zapis przed żądaniem", () => {
    const { onSubmit } = renderuj();
    fireEvent.change(poleNazwyEn(), { target: { value: "Digital Track" } });
    fireEvent.click(przyciskZapisu());

    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getAllByRole("alert")).toHaveLength(1);
    expect(screen.getByRole("alert")).toHaveTextContent(`${K}validation.namesRequired`);
  });

  it("brak nazwy ANGIELSKIEJ zatrzymuje zapis osobno", () => {
    // Osobny przypadek, bo to osobna kolumna: pasmo bez `name_en` znika
    // z anglojęzycznej agendy, a formularz wyglądałby na wypełniony.
    const { onSubmit } = renderuj();
    fireEvent.change(poleNazwyPl(), { target: { value: "Ścieżka Cyfrowa" } });
    fireEvent.click(przyciskZapisu());

    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getAllByRole("alert")).toHaveLength(1);
  });

  it("obie nazwy puste dają DWA komunikaty, po jednym przy każdym polu", () => {
    const { onSubmit } = renderuj();
    fireEvent.click(przyciskZapisu());
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getAllByRole("alert")).toHaveLength(2);
  });

  it("komunikat pojawia się dopiero po próbie zapisu", () => {
    renderuj();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("uzupełnienie nazw gasi komunikaty i przepuszcza zapis", () => {
    const { onSubmit } = renderuj();
    fireEvent.click(przyciskZapisu());
    expect(screen.getAllByRole("alert")).toHaveLength(2);

    wypelnijNazwy();

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    fireEvent.click(przyciskZapisu());
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });
});

describe("EventTrackDialog - ładunek zapisu", () => {
  it("nowa ścieżka: klucz z nazwy, puste pola jako null, białe znaki obcięte", () => {
    const { onSubmit } = renderuj({ nextSortOrder: 30 });
    wypelnijNazwy("  Ścieżka Cyfrowa  ", "  Digital Track  ");
    fireEvent.click(przyciskZapisu());

    expect(ladunek(onSubmit)).toEqual({
      id: null,
      eventId: EVENT_ID,
      // Klucz jest identyfikatorem technicznym - organizator nie ma go
      // wpisywać, a polskie znaki muszą złożyć się do ASCII.
      key: "sciezka_cyfrowa",
      namePl: "Ścieżka Cyfrowa",
      nameEn: "Digital Track",
      accentColor: null,
      taglinePl: null,
      taglineEn: null,
      descriptionPl: null,
      descriptionEn: null,
      coverUrl: null,
      defaultRoomId: null,
      sortOrder: 30,
      isActive: true,
      isPublic: true,
    });
  });

  it("edycja zachowuje KLUCZ z bazy, choć nazwa się zmieniła", () => {
    // Klucz jest niezmienny: baza go przy edycji nie czyta, a wyprowadzenie go
    // na nowo z nowej nazwy byłoby cichą podmianą identyfikatora pasma.
    const { onSubmit } = renderuj({ track: trackRow({ key: "sciezka_stara" }) });
    fireEvent.change(poleNazwyPl(), { target: { value: "Zupełnie Nowa Nazwa" } });
    fireEvent.click(przyciskZapisu());

    expect(ladunek(onSubmit)).toMatchObject({ id: "track-a", key: "sciezka_stara" });
  });

  it("kolor spoza wzoru #RRGGBB jedzie jako BRAK koloru", () => {
    // Kolor wraca na publiczną agendę do atrybutu `style` - „czerwony" byłby
    // tam śmieciem, który nic nie pokoloruje, a zostanie w bazie.
    const { onSubmit } = renderuj();
    wypelnijNazwy();
    fireEvent.change(poleKoloru(), { target: { value: "czerwony" } });
    fireEvent.click(przyciskZapisu());
    expect(ladunek(onSubmit).accentColor).toBeNull();
  });

  it("kolor we wzorze jedzie znormalizowany do małych liter", () => {
    const { onSubmit } = renderuj();
    wypelnijNazwy();
    fireEvent.change(poleKoloru(), { target: { value: " #FA9346 " } });
    fireEvent.click(przyciskZapisu());
    expect(ladunek(onSubmit).accentColor).toBe("#fa9346");
  });

  it("wszystkie decyzje formularza dochodzą do warstwy zapisu", () => {
    const { onSubmit } = renderuj();
    wypelnijNazwy();
    fireEvent.change(poleZajawkiPl(), { target: { value: " Reguły dla danych " } });
    fireEvent.change(poleZajawkiEn(), { target: { value: "Rules for data" } });
    fireEvent.change(poleOpisuPl(), { target: { value: "Suwerenność cyfrowa" } });
    fireEvent.change(poleOpisuEn(), { target: { value: "Digital sovereignty" } });
    fireEvent.change(poleOkladki(), { target: { value: " https://cdn.test/a.jpg " } });
    fireEvent.change(droplistaSali(), { target: { value: "room-b" } });
    fireEvent.click(przelacznikAktywnosci());
    fireEvent.click(przelacznikWidocznosci());
    fireEvent.click(przyciskZapisu());

    expect(ladunek(onSubmit)).toMatchObject({
      taglinePl: "Reguły dla danych",
      taglineEn: "Rules for data",
      descriptionPl: "Suwerenność cyfrowa",
      descriptionEn: "Digital sovereignty",
      coverUrl: "https://cdn.test/a.jpg",
      defaultRoomId: "room-b",
      isActive: false,
      isPublic: false,
    });
  });

  it("okładka ścieżki ląduje w katalogu ścieżek biblioteki mediów", () => {
    renderuj();
    expect(screen.getByTestId("okladka")).toHaveAttribute("data-subfolder", "event-tracks");
  });
});

describe("EventTrackDialog - sala domyślna", () => {
  it("droplista pokazuje NAZWY sal i jawną pozycję „bez sali”", () => {
    renderuj();
    const opcje = Array.from(droplistaSali().querySelectorAll("option")).map((o) => o.textContent);
    expect(opcje).toEqual([`${K}defaultRoomNone`, "Sala Plenarna", "Sala Warsztatowa"]);
  });

  it("wybór „bez sali” wraca do bazy jako BRAK sali, nie jako wartownik", () => {
    // Wartownik `__none__` istnieje wyłącznie dlatego, że Radix Select zabrania
    // pustej wartości pozycji. Gdyby wyciekł do bazy, kolumna wskazywałaby salę
    // o identyfikatorze, którego nie ma.
    const { onSubmit } = renderuj({ track: trackRow({ default_room_id: "room-a" }) });
    expect(droplistaSali()).toHaveValue("room-a");

    fireEvent.change(droplistaSali(), { target: { value: "__none__" } });
    fireEvent.click(przyciskZapisu());

    expect(ladunek(onSubmit).defaultRoomId).toBeNull();
  });

  it("brak wczytanych sal zostawia samą pozycję „bez sali”, bez awarii", () => {
    h.rooms = [];
    renderuj();
    const opcje = Array.from(droplistaSali().querySelectorAll("option")).map((o) => o.value);
    expect(opcje).toEqual(["__none__"]);
  });
});

describe("EventTrackDialog - stan oczekiwania i odmowa", () => {
  it("trwający zapis blokuje oba przyciski, więc podwójne kliknięcie nie tworzy dwóch pasm", () => {
    const { onSubmit, onOpenChange, przerysuj } = renderuj();
    wypelnijNazwy();
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

  it("odmowa zapisu zostawia opis i okładkę w polach", () => {
    const { onSubmit, przerysuj } = renderuj();
    wypelnijNazwy();
    fireEvent.change(poleOpisuPl(), {
      target: { value: "Cztery akapity, których nikt nie napisze drugi raz" },
    });
    fireEvent.click(przyciskZapisu());

    przerysuj({ isSaving: true });
    przerysuj({ isSaving: false });

    expect(poleNazwyPl()).toHaveValue("Ścieżka Cyfrowa");
    expect(poleOpisuPl()).toHaveValue("Cztery akapity, których nikt nie napisze drugi raz");
    fireEvent.click(przyciskZapisu());
    expect(onSubmit).toHaveBeenCalledTimes(2);
  });

  it("anulowanie zamyka okno i nie wysyła niczego", () => {
    const { onOpenChange, onSubmit } = renderuj();
    wypelnijNazwy();
    fireEvent.click(przyciskAnuluj());
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("odświeżenie listy ścieżek w tle NIE kasuje wpisanego formularza", () => {
    // Zanim to naprawiono, stał tu ten sam defekt co w oknie sali: efekt
    // odtwarzający szkic miał w zależnościach `nextSortOrder`, czyli liczbę
    // z ŻYWEJ listy pasm (`rows.reduce(max) + 10` w `AgendaTracksPanel`).
    // Odświeżenie listy w tle - pasmo dołożone przez drugiego organizatora
    // albo powrót do karty przeglądarki po `staleTime` - nadpisywało szkic
    // pustym. Jak to widział użytkownik: opis pasma pisany od kilku minut
    // znikał bez słowa, razem z adresem okładki. Teraz zależnością efektu
    // jest TOŻSAMOŚĆ wiersza, a kolejność początkowa idzie przez `ref`.
    const { przerysuj } = renderuj({ nextSortOrder: 30 });
    wypelnijNazwy();
    fireEvent.change(poleOpisuPl(), { target: { value: "Opis pisany od kwadransa" } });

    przerysuj({ nextSortOrder: 40 });

    expect(poleNazwyPl()).toHaveValue("Ścieżka Cyfrowa");
    expect(poleOpisuPl()).toHaveValue("Opis pisany od kwadransa");
  });
});
