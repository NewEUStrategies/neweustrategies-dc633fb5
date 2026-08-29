// Molekuła „POWIĄZANIE SESJI ZE ŚCIEŻKĄ" - jedno okno zamiast dwunastu.
//
// CO TEN PLIK DOWODZI.
//   1. OKNO CZYTA STAN Z BAZY, A NIE Z PAMIĘCI. Sesje należące do pasma są
//      zaznaczone od otwarcia, a otwarcie dla INNEJ ścieżki nie może pokazywać
//      zaznaczeń poprzedniej - to zaznaczenia decydują, co zostanie odpięte.
//   2. ZAPIS NIESIE DWIE OSOBNE LISTY. Baza rozróżnia „przypnij do tej
//      ścieżki" od „odepnij" (`track_id = null`), więc asercja stoi na
//      ARGUMENCIE warstwy zapisu: co dokładnie jest w `attach`, a co w
//      `detach`. Jedno wywołanie z dwiema intencjami nie istnieje.
//   3. NIC DO ZROBIENIA = NIC DO WYSŁANIA. Przycisk jest nieczynny, dopóki
//      zaznaczenia zgadzają się ze stanem bazy, i nieczynny bez wybranej
//      ścieżki - inaczej okno wysyłałoby puste żądanie i unieważniało cache.
//   4. PODPOWIADAMY, CO ZABIERAMY CUDZEJ ŚCIEŻCE. Sesja ma dokładnie jedną
//      ścieżkę, więc zaznaczenie jej tutaj zdejmuje ją z poprzedniego pasma -
//      wiersz mówi to WPROST, zanim organizator kliknie zapis.
//   5. TRZY STANY LISTY MAJĄ TRZY WIDOKI: wczytywanie, pustka po filtrze
//      i pełna lista. Filtr szuka po tytule w JĘZYKU INTERFEJSU.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE. (1) Zapytania o sesje (`useEventSessions`,
// klucze cache) - zamockowane na poziomie MODUŁU; dowodzimy, o CO okno pyta.
// (2) Mutacji `setSessionsTrack` - okno jej nie zna, oddaje wynik organizmowi.
// (3) Warstwy wizualnej odznaki i pola wyszukiwania - to atomy panelu.
//
// Radix Dialog i Checkbox nie działają pod happy-dom bez pełnego pointer API -
// oba są podmienione na natywne odpowiedniki.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import type { EventSessionRow, EventTrackRow, SessionsQuery } from "@/lib/events/sessionsApi";
import type { TrackSessionsLinkResult } from "@/components/admin/events/molecules/TrackSessionsLinkDialog";

const h = vi.hoisted(() => ({
  language: "pl",
  rows: undefined as unknown,
  isLoading: false,
  /** Z jakim filtrem okno zapytało o sesje. */
  queries: [] as unknown[],
}));

vi.mock("react-i18next", async () =>
  (await import("@/test/i18nStub")).reactI18nextStub(() => h.language),
);
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
vi.mock("@/components/ui/checkbox", () => ({
  Checkbox: ({
    checked,
    onCheckedChange,
    ...rest
  }: {
    checked?: boolean;
    onCheckedChange?: (next: boolean) => void;
    [key: string]: unknown;
  }) => (
    <input
      {...rest}
      type="checkbox"
      checked={checked === true}
      onChange={(event) => onCheckedChange?.(event.target.checked)}
    />
  ),
}));
vi.mock("@/lib/events/useEventSessions", () => ({
  useEventSessions: (query: SessionsQuery | null) => {
    h.queries.push(query);
    return { data: h.rows, isLoading: h.isLoading };
  },
}));

const { TrackSessionsLinkDialog } =
  await import("@/components/admin/events/molecules/TrackSessionsLinkDialog");

const EVENT_ID = "11111111-1111-4111-8111-111111111111";

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
    room_id: "room-a",
    room_name: "Sala Plenarna",
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

/** Trzy sesje: jedna już w paśmie, jedna bez pasma, jedna w CUDZYM paśmie. */
function trzySesje(): EventSessionRow[] {
  return [
    sessionRow({ id: "s-moja", title_pl: "Otwarcie", title_en: "Opening", track_id: "track-a" }),
    sessionRow({ id: "s-wolna", title_pl: "Warsztat", title_en: "Workshop", track_id: "" }),
    sessionRow({
      id: "s-cudza",
      title_pl: "Debata",
      title_en: "Debate",
      track_id: "track-b",
      track_name_pl: "Ścieżka Zielona",
      track_name_en: "Green Track",
    }),
  ];
}

function renderuj(
  props: { open?: boolean; track?: EventTrackRow | null; isSaving?: boolean } = {},
) {
  const onOpenChange = vi.fn();
  const onSubmit = vi.fn();
  const wejscie = {
    open: props.open ?? true,
    track: props.track === undefined ? trackRow() : props.track,
    isSaving: props.isSaving ?? false,
  };
  const rysuj = () => (
    <TrackSessionsLinkDialog
      open={wejscie.open}
      onOpenChange={onOpenChange}
      eventId={EVENT_ID}
      track={wejscie.track}
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

const L = "adminEventAgenda.tracks.link.";
const S = "adminEventAgenda.sessions.";
const poleSzukania = () => screen.getByLabelText(`${S}searchPlaceholder`);
const kratka = (nazwa: string) => screen.getByRole("checkbox", { name: nazwa });
const przyciskZapisu = () =>
  screen.getByRole("button", { name: "adminEventAgenda.tracks.dialog.saveAction" });
const przyciskAnuluj = () =>
  screen.getByRole("button", { name: "adminEventAgenda.tracks.dialog.cancelAction" });
const podsumowanie = (attach: number, detach: number) =>
  screen.getByText(`${L}summary(attach=${attach},detach=${detach})`);

const wynikZapisu = (onSubmit: ReturnType<typeof vi.fn>): TrackSessionsLinkResult =>
  onSubmit.mock.calls[0][0] as TrackSessionsLinkResult;

beforeEach(() => {
  vi.clearAllMocks();
  h.language = "pl";
  h.rows = trzySesje();
  h.isLoading = false;
  h.queries = [];
});

describe("TrackSessionsLinkDialog - stan początkowy", () => {
  it("zamknięte okno nie renderuje listy", () => {
    renderuj({ open: false });
    expect(screen.queryByTestId("dialog-content")).not.toBeInTheDocument();
  });

  it("okno pyta o CAŁY program wydarzenia, bez filtra ścieżki", () => {
    // Sens tego okna: organizator widzi cały program naraz. Filtr ścieżki
    // pokazywałby to, co już jest w paśmie, czyli dokładnie nie to, czego
    // szuka.
    renderuj();
    expect(h.queries[0]).toEqual({
      eventId: EVENT_ID,
      q: "",
      trackId: null,
      roomId: null,
      status: "all",
    });
  });

  it("nagłówek nazywa ścieżkę, której dotyczy wybór", () => {
    renderuj();
    expect(screen.getByText(`${L}description(track=Ścieżka Cyfrowa)`)).toBeInTheDocument();
  });

  it("sesje należące do pasma są ZAZNACZONE od otwarcia, reszta nie", () => {
    renderuj();
    expect(kratka("Otwarcie")).toBeChecked();
    expect(kratka("Warsztat")).not.toBeChecked();
    expect(kratka("Debata")).not.toBeChecked();
    // Zaznaczenie zgodne z bazą to brak roboty - i brak czynnego przycisku.
    expect(podsumowanie(0, 0)).toBeInTheDocument();
    expect(przyciskZapisu()).toBeDisabled();
  });

  it("wiersz mówi, w jakiej sali i jak długo trwa sesja", () => {
    // Sam tytuł nie wystarczy do decyzji „czy to należy do pasma": dwie sesje
    // o podobnym tytule rozróżnia sala i długość.
    h.rows = [sessionRow({ room_name: "Sala Plenarna", duration_minutes: 90 })];
    renderuj();
    expect(screen.getByText(/Sala Plenarna · 90 min/)).toBeInTheDocument();
  });

  it("sesja bez sali dostaje NAZWANY stan „bez sali”, a nie pustkę", () => {
    h.rows = [sessionRow({ room_id: "", room_name: "" })];
    renderuj();
    expect(screen.getByText(new RegExp(`${S}noRoom`))).toBeInTheDocument();
  });
});

describe("TrackSessionsLinkDialog - trzy stany listy", () => {
  it("wczytywanie mówi „wczytywanie”, zamiast pokazywać pustą listę", () => {
    h.rows = undefined;
    h.isLoading = true;
    renderuj();
    expect(screen.getByText(`${S}loading`)).toBeInTheDocument();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  });

  it("program bez ani jednej sesji mówi to wprost", () => {
    h.rows = [];
    renderuj();
    expect(screen.getByText(`${S}emptyFiltered`)).toBeInTheDocument();
  });

  it("filtr zawężający do zera mówi to samo, ale po odsianiu wierszy", () => {
    renderuj();
    fireEvent.change(poleSzukania(), { target: { value: "czegoś takiego nie ma" } });
    expect(screen.getByText(`${S}emptyFiltered`)).toBeInTheDocument();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  });

  it("filtr szuka po tytule, bez oglądania się na wielkość liter", () => {
    renderuj();
    fireEvent.change(poleSzukania(), { target: { value: "  WARSZ  " } });
    expect(screen.getByRole("checkbox", { name: "Warsztat" })).toBeInTheDocument();
    expect(screen.queryByRole("checkbox", { name: "Otwarcie" })).not.toBeInTheDocument();
  });

  it("w interfejsie angielskim filtr szuka po tytule ANGIELSKIM", () => {
    // Organizator pracujący po angielsku wpisuje to, co widzi na liście -
    // filtr po niewidocznej kolumnie polskiej nie znalazłby niczego.
    h.language = "en";
    renderuj();
    fireEvent.change(poleSzukania(), { target: { value: "workshop" } });
    expect(screen.getByRole("checkbox", { name: "Workshop" })).toBeInTheDocument();
    expect(screen.queryByRole("checkbox", { name: "Opening" })).not.toBeInTheDocument();
  });

  it("brak tytułu w języku interfejsu spada na drugą kolumnę", () => {
    // Sesja opisana tylko po polsku nie może wejść na listę jako wiersz bez
    // nazwy - kratki bez etykiety nie da się ani przeczytać, ani kliknąć
    // świadomie.
    h.language = "en";
    h.rows = [sessionRow({ id: "s-1", title_pl: "Otwarcie", title_en: "" })];
    renderuj();
    expect(screen.getByRole("checkbox", { name: "Otwarcie" })).toBeInTheDocument();
  });

  it("brak tytułu polskiego w interfejsie polskim spada na angielski", () => {
    // Druga strona tej samej reguły. Bez tego przypadku „spadek na drugą
    // kolumnę" byłby udowodniony tylko dla jednego z dwóch języków panelu.
    h.rows = [sessionRow({ id: "s-1", title_pl: "", title_en: "Opening" })];
    renderuj();
    expect(screen.getByRole("checkbox", { name: "Opening" })).toBeInTheDocument();
  });
});

describe("TrackSessionsLinkDialog - co jedzie do warstwy zapisu", () => {
  it("dopięcie sesji wysyła ją w `attach`, a `detach` zostaje pusty", () => {
    const { onSubmit } = renderuj();
    fireEvent.click(kratka("Warsztat"));

    expect(podsumowanie(1, 0)).toBeInTheDocument();
    expect(przyciskZapisu()).toBeEnabled();
    fireEvent.click(przyciskZapisu());

    expect(wynikZapisu(onSubmit)).toEqual({ attach: ["s-wolna"], detach: [] });
  });

  it("odznaczenie sesji pasma wysyła ją w `detach` - to inne żądanie do bazy", () => {
    // Baza rozróżnia „przypnij" od „odepnij" (`track_id = null`), więc sklejenie
    // obu list w jedną odebrałoby organizatorowi możliwość zdjęcia sesji z pasma.
    const { onSubmit } = renderuj();
    fireEvent.click(kratka("Otwarcie"));

    expect(podsumowanie(0, 1)).toBeInTheDocument();
    fireEvent.click(przyciskZapisu());

    expect(wynikZapisu(onSubmit)).toEqual({ attach: [], detach: ["s-moja"] });
  });

  it("jedno kliknięcie w dwie strony wraca do stanu bazy i gasi przycisk", () => {
    // Dowód, że lista zaznaczeń jest STANEM, a nie dziennikiem kliknięć: bez
    // tego przypadku okno wysyłałoby „odepnij i przypnij tę samą sesję".
    const { onSubmit } = renderuj();
    fireEvent.click(kratka("Warsztat"));
    fireEvent.click(kratka("Warsztat"));

    expect(podsumowanie(0, 0)).toBeInTheDocument();
    expect(przyciskZapisu()).toBeDisabled();
    fireEvent.click(przyciskZapisu());
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("obie intencje naraz jadą osobnymi listami", () => {
    const { onSubmit } = renderuj();
    fireEvent.click(kratka("Otwarcie"));
    fireEvent.click(kratka("Debata"));
    fireEvent.click(kratka("Warsztat"));

    expect(podsumowanie(2, 1)).toBeInTheDocument();
    fireEvent.click(przyciskZapisu());

    const wynik = wynikZapisu(onSubmit);
    expect([...wynik.attach].sort()).toEqual(["s-cudza", "s-wolna"]);
    expect(wynik.detach).toEqual(["s-moja"]);
  });

  it("bez wybranej ścieżki zapis jest niemożliwy, choć coś zaznaczono", () => {
    // Okno bywa zamontowane, zanim organizator wybierze pasmo. Żądanie bez
    // ścieżki nie ma dokąd dopiąć sesji.
    const { onSubmit } = renderuj({ track: null });
    fireEvent.click(kratka("Otwarcie"));

    expect(podsumowanie(1, 0)).toBeInTheDocument();
    expect(przyciskZapisu()).toBeDisabled();
    fireEvent.click(przyciskZapisu());
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("bez wybranej ścieżki nagłówek nie kłamie o nazwie pasma", () => {
    renderuj({ track: null });
    expect(screen.getByText(`${L}description(track=)`)).toBeInTheDocument();
  });

  it("trwający zapis blokuje przycisk, więc podwójne kliknięcie nie wysyła dwóch żądań", () => {
    const { onSubmit, przerysuj } = renderuj();
    fireEvent.click(kratka("Warsztat"));
    fireEvent.click(przyciskZapisu());
    expect(onSubmit).toHaveBeenCalledTimes(1);

    przerysuj({ isSaving: true });

    expect(przyciskZapisu()).toBeDisabled();
    fireEvent.click(przyciskZapisu());
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it("anulowanie zamyka okno bez żądania", () => {
    const { onOpenChange, onSubmit } = renderuj();
    fireEvent.click(kratka("Warsztat"));
    fireEvent.click(przyciskAnuluj());
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(onSubmit).not.toHaveBeenCalled();
  });
});

describe("TrackSessionsLinkDialog - co zabieramy cudzej ścieżce", () => {
  it("sesja z CUDZEGO pasma niesie ostrzeżenie z nazwą tamtego pasma", () => {
    renderuj();
    expect(screen.getByText(`${L}movesFrom(track=Ścieżka Zielona)`)).toBeInTheDocument();
  });

  it("sesja TEGO pasma i sesja bez pasma nie niosą ostrzeżenia", () => {
    // Kontrapunkt: gdyby odznaka wisiała przy każdym wierszu, ostrzeżenie
    // przestałoby cokolwiek znaczyć.
    renderuj();
    expect(screen.queryByText(`${L}movesFrom(track=Ścieżka Cyfrowa)`)).not.toBeInTheDocument();
    expect(screen.getAllByText(new RegExp(`${L}movesFrom`))).toHaveLength(1);
  });

  it("w interfejsie angielskim ostrzeżenie niesie ANGIELSKĄ nazwę pasma", () => {
    h.language = "en";
    renderuj();
    expect(screen.getByText(`${L}movesFrom(track=Green Track)`)).toBeInTheDocument();
    // Nagłówek okna czyta nazwę tym samym prawem - inaczej okno mówiłoby
    // o dwóch różnych pasmach naraz.
    expect(screen.getByText(`${L}description(track=Digital Track)`)).toBeInTheDocument();
  });

  it("pasmo opisane tylko w jednym języku nadal ma nazwę w ostrzeżeniu", () => {
    // Ostrzeżenie „przenosimy z ..." bez nazwy pasma nie mówi nic - a to jest
    // jedyna informacja, po której organizator poznaje, komu coś zabiera.
    h.language = "en";
    h.rows = [
      sessionRow({
        id: "s-cudza",
        track_id: "track-b",
        track_name_pl: "Ścieżka Zielona",
        track_name_en: "",
      }),
    ];
    renderuj({ track: trackRow({ name_en: "" }) });
    expect(screen.getByText(`${L}movesFrom(track=Ścieżka Zielona)`)).toBeInTheDocument();
    expect(screen.getByText(`${L}description(track=Ścieżka Cyfrowa)`)).toBeInTheDocument();
  });

  it("w interfejsie polskim brak nazwy polskiej pasma spada na angielską", () => {
    h.rows = [
      sessionRow({
        id: "s-cudza",
        track_id: "track-b",
        track_name_pl: "",
        track_name_en: "Green Track",
      }),
    ];
    renderuj({ track: trackRow({ name_pl: "" }) });
    expect(screen.getByText(`${L}movesFrom(track=Green Track)`)).toBeInTheDocument();
    expect(screen.getByText(`${L}description(track=Digital Track)`)).toBeInTheDocument();
  });

  it("bez wybranej ścieżki ostrzeżenie dotyczy KAŻDEJ sesji, która pasmo ma", () => {
    renderuj({ track: null });
    expect(screen.getAllByText(new RegExp(`${L}movesFrom`))).toHaveLength(2);
  });
});

describe("TrackSessionsLinkDialog - otwarcie dla innej ścieżki", () => {
  it("zaznaczenia i filtr są czytane od nowa przy każdym otwarciu", () => {
    // Regresja, którą to łapie: okno otwarte dla pasma B pamięta zaznaczenia
    // z pasma A - a zaznaczenia decydują, co zostanie ODPIĘTE. Zapis zdjąłby
    // wtedy z pasma B sesje, których organizator w ogóle nie widział.
    const { przerysuj } = renderuj();
    fireEvent.change(poleSzukania(), { target: { value: "Warsz" } });
    fireEvent.click(screen.getByRole("checkbox", { name: "Warsztat" }));

    przerysuj({ open: false });
    przerysuj({ open: true, track: trackRow({ id: "track-b", name_pl: "Ścieżka Zielona" }) });

    expect(poleSzukania()).toHaveValue("");
    expect(kratka("Debata")).toBeChecked();
    expect(kratka("Warsztat")).not.toBeChecked();
    expect(kratka("Otwarcie")).not.toBeChecked();
    expect(podsumowanie(0, 0)).toBeInTheDocument();
  });

  it("odświeżenie listy w tle NIE kasuje zaznaczeń zrobionych przez organizatora", () => {
    const { przerysuj } = renderuj();
    fireEvent.click(kratka("Warsztat"));

    h.rows = trzySesje();
    przerysuj({});

    expect(kratka("Warsztat")).toBeChecked();
    expect(podsumowanie(1, 0)).toBeInTheDocument();
  });

  it("REGRESJA: okno otwarte PRZED wczytaniem listy NIE odpina sesji pasma", () => {
    // Zanim to naprawiono, efekt czytający stan z bazy miał w zależnościach
    // `open` i `track?.id`, ale NIE listę sesji. Gdy okno otwierało się, zanim
    // zapytanie odpowiedziało, `selected` ustawiało się na pustą listę i już się
    // nie odświeżało - a po przyjściu danych `detach` zawierał KAŻDĄ sesję pasma.
    // Jak widział to użytkownik: otwierał okno zaraz po wejściu na zakładkę,
    // widział wszystkie sesje niezaznaczone (choć pasmo miało ich dwanaście),
    // zaznaczał jedną nową i zapisywał - pasmo zostawało z tą jedną sesją,
    // a pozostałe jedenaście wypadało z programu bez ostrzeżenia.
    h.rows = undefined;
    h.isLoading = true;
    const { przerysuj } = renderuj();

    h.rows = trzySesje();
    h.isLoading = false;
    przerysuj({});

    expect(kratka("Otwarcie")).toBeChecked();
    expect(podsumowanie(0, 0)).toBeInTheDocument();
  });

  it("REGRESJA: sesja BEZ ścieżki nie dostaje ostrzeżenia, że zabieramy ją cudzemu pasmu", () => {
    // `admin_event_sessions_list` zwraca `track_id` jako kolumnę NULL-owalną
    // (migracja 20260824084250: `track_id uuid`, bez `coalesce`), a wiersz
    // porównywał ją z PUSTYM ŁAŃCUCHEM. `null !== ""` jest prawdą, więc zanim to
    // naprawiono, każda sesja bez pasma dostawała odznakę „przenosimy z ..."
    // z pustą nazwą. Jak widział to użytkownik: przy sesjach, które nie należą
    // nigdzie, wisiało ostrzeżenie o zabieraniu ich cudzej ścieżce - i nie
    // mówiło, której.
    h.rows = [
      sessionRow({ id: "s-wolna", title_pl: "Warsztat", track_id: null as unknown as string }),
    ];
    renderuj();
    expect(screen.queryByText(new RegExp(`${L}movesFrom`))).not.toBeInTheDocument();
  });

  it("REGRESJA: sesja BEZ sali dostaje nazwany stan „bez sali”", () => {
    // Ta sama przyczyna: `room_name` przychodzi z LEFT JOIN-a jako `null`,
    // a wiersz sprawdzał `=== ""`. Zanim to naprawiono, zamiast napisu „bez
    // sali" użytkownik widział sam separator i czas trwania, jakby nazwa sali
    // się nie doczytała.
    h.rows = [
      sessionRow({
        id: "s-wolna",
        title_pl: "Warsztat",
        room_id: null as unknown as string,
        room_name: null as unknown as string,
      }),
    ];
    renderuj();
    expect(screen.getByText(new RegExp(`${S}noRoom`))).toBeInTheDocument();
  });
});
