// Molekuła „SALA WYDARZENIA" - formularz, który nie ma prawa zgubić pracy
// organizatora ani zdublować sali.
//
// CO TEN PLIK DOWODZI.
//   1. DWA TRYBY TO DWA FORMULARZE. Otwarcie bez wiersza daje pusty formularz
//      z tytułem „nowa sala"; otwarcie z wierszem wypełnia pola TĄ salą i mówi
//      „edycja". Osobno pilnowana jest POZOSTAŁOŚĆ PO POPRZEDNIM WIERSZU:
//      dialog zamknięty i otwarty dla innej sali nie może pokazywać danych
//      poprzedniej - organizator poprawia wtedy salę, której nie widzi.
//   2. WALIDACJA ODCINA ZAPIS PRZED ŻĄDANIEM. Pusta nazwa i pojemność spoza
//      zakresu (zero, tekst) nie wychodzą z tego okna: asercja stoi na MOCKU
//      zapisu, nie na wyglądzie przycisku, bo to warstwa danych ma nie dostać
//      niczego. Komunikat pojawia się DOPIERO po próbie zapisu - formularz,
//      który czerwieni się przy pierwszym otwarciu, uczy ignorować czerwień.
//   3. KSZTAŁT ŁADUNKU jest asertowany na OBIEKCIE oddanym warstwie zapisu:
//      puste pole opcjonalne jedzie jako `null` (nie jako pusty łańcuch, bo
//      kolumna ma być NULL-em, a nie „napisem zero-znakowym"), białe znaki są
//      obcinane, a brakująca kolejność wraca do wartości domyślnej.
//   4. TRWAJĄCY ZAPIS BLOKUJE OBA PRZYCISKI - podwójne kliknięcie to dwie sale
//      o tej samej nazwie, bo dialog nie zna identyfikatora, który dopiero
//      powstaje.
//   5. ODMOWA ZAPISU NIE KASUJE PRACY. Po nieudanym zapisie wpisane pola
//      zostają i ta sama treść daje się wysłać ponownie.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE. (1) Reguł wersji roboczej - tabele przypadków
// `emptyRoomDraft`, `roomDraftFromRow`, `validateRoomDraft` i `roomDraftToInput`
// są w `lib/events/__tests__/agendaCatalogDraft.test.ts`; tutaj dowodzimy, że
// molekuła ich UŻYWA i co robi z wynikiem. (2) Wierszy formularza
// (`AdminFormTextRow`, `AdminFormSwitchRow`) - to osobne molekuły panelu.
// (3) Mutacji i unieważniania cache - dialog ich nie zna, dostaje `onSubmit`
// i `isSaving` od organizmu.
//
// Radix Dialog i Switch nie działają pod happy-dom bez pełnego pointer API -
// oba są podmienione na natywne odpowiedniki (`src/test/reactStubs.ts`).
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { radixSwitchStub } from "@/test/reactStubs";
import type { EventRoomInput, EventRoomRow } from "@/lib/events/sessionsApi";

vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());
vi.mock("@/components/ui/switch", async () => radixSwitchStub(await import("react")));
// Radix Dialog: `Root` zawsze renderuje dzieci, ale `Content` istnieje wyłącznie
// przy otwartym oknie (portal nie jest montowany). Atrapa odwzorowuje to wprost,
// bo inaczej „zamknięty dialog nie renderuje treści" byłoby dowodem na atrapę.
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

const { EventRoomDialog } = await import("@/components/admin/events/molecules/EventRoomDialog");

const EVENT_ID = "11111111-1111-4111-8111-111111111111";

/** Wiersz `admin_event_rooms_list` - pełny kształt sygnatury, nie wycinek. */
function roomRow(overrides: Partial<EventRoomRow> = {}): EventRoomRow {
  return {
    booked_minutes: 0,
    capacity: 120,
    created_at: "2026-08-01T09:00:00.000Z",
    event_id: EVENT_ID,
    floor: "Parter",
    id: "room-a",
    is_active: true,
    location_note: "Wejście od strony ogrodu",
    name: "Sala Plenarna",
    sessions_count: 3,
    sort_order: 10,
    updated_at: "2026-08-02T09:00:00.000Z",
    ...overrides,
  };
}

function renderuj(
  props: {
    open?: boolean;
    room?: EventRoomRow | null;
    isSaving?: boolean;
    nextSortOrder?: number;
  } = {},
) {
  const onOpenChange = vi.fn();
  const onSubmit = vi.fn();
  const wejscie = {
    open: props.open ?? true,
    room: props.room ?? null,
    isSaving: props.isSaving ?? false,
    nextSortOrder: props.nextSortOrder ?? 40,
  };
  const wynik = render(
    <EventRoomDialog
      open={wejscie.open}
      onOpenChange={onOpenChange}
      eventId={EVENT_ID}
      room={wejscie.room}
      nextSortOrder={wejscie.nextSortOrder}
      isSaving={wejscie.isSaving}
      onSubmit={onSubmit}
    />,
  );
  const przerysuj = (zmiana: Partial<typeof wejscie>) => {
    Object.assign(wejscie, zmiana);
    wynik.rerender(
      <EventRoomDialog
        open={wejscie.open}
        onOpenChange={onOpenChange}
        eventId={EVENT_ID}
        room={wejscie.room}
        nextSortOrder={wejscie.nextSortOrder}
        isSaving={wejscie.isSaving}
        onSubmit={onSubmit}
      />,
    );
  };
  return { ...wynik, onOpenChange, onSubmit, przerysuj };
}

const K = "adminEventAgenda.rooms.dialog.";
const poleNazwy = () => screen.getByLabelText(`${K}name`);
const polePojemnosci = () => screen.getByLabelText(`${K}capacity`);
const polePietra = () => screen.getByLabelText(`${K}floor`);
const poleKolejnosci = () => screen.getByLabelText(`${K}sortOrder`);
const poleNotatki = () => screen.getByLabelText(`${K}locationNote`);
const przelacznikAktywnosci = () => screen.getByLabelText(`${K}isActive`);
const przyciskZapisu = () => screen.getByRole("button", { name: `${K}saveAction` });
const przyciskAnuluj = () => screen.getByRole("button", { name: `${K}cancelAction` });

/** Ostatni ładunek oddany warstwie zapisu. */
const ladunek = (onSubmit: ReturnType<typeof vi.fn>, nr = 0): EventRoomInput =>
  onSubmit.mock.calls[nr][0] as EventRoomInput;

beforeEach(() => {
  vi.clearAllMocks();
});

describe("EventRoomDialog - tryb tworzenia kontra tryb edycji", () => {
  it("zamknięte okno nie renderuje formularza", () => {
    renderuj({ open: false, room: roomRow() });
    expect(screen.queryByTestId("dialog-content")).not.toBeInTheDocument();
    expect(screen.queryByText(`${K}editTitle`)).not.toBeInTheDocument();
  });

  it("otwarcie BEZ wiersza daje pusty formularz i tytuł tworzenia", () => {
    renderuj({ nextSortOrder: 40 });
    expect(screen.getByText(`${K}createTitle`)).toBeInTheDocument();
    expect(poleNazwy()).toHaveValue("");
    expect(polePojemnosci()).toHaveValue("");
    expect(polePietra()).toHaveValue("");
    expect(poleNotatki()).toHaveValue("");
    // Kolejność podpowiada lista, żeby nowa sala stanęła NA KOŃCU, a nie
    // w środku katalogu.
    expect(poleKolejnosci()).toHaveValue("40");
    expect(przelacznikAktywnosci()).toBeChecked();
  });

  it("otwarcie Z wierszem wypełnia pola tą salą i tytuł mówi o edycji", () => {
    renderuj({ room: roomRow() });
    expect(screen.getByText(`${K}editTitle`)).toBeInTheDocument();
    expect(screen.queryByText(`${K}createTitle`)).not.toBeInTheDocument();
    expect(poleNazwy()).toHaveValue("Sala Plenarna");
    expect(polePojemnosci()).toHaveValue("120");
    expect(polePietra()).toHaveValue("Parter");
    expect(poleNotatki()).toHaveValue("Wejście od strony ogrodu");
    expect(poleKolejnosci()).toHaveValue("10");
  });

  it("sala BEZ zadeklarowanej pojemności zostawia pole PUSTE, a nie zerowe", () => {
    // Zero znaczy „sala bez ani jednego miejsca" i baza go odmawia; brak
    // deklaracji ma zostać brakiem. Gdyby `null` wpadł tu jako „0", pierwsze
    // otwarcie i zapisanie sali robiłoby z niej salę nie do obsadzenia.
    renderuj({ room: roomRow({ capacity: null as unknown as number }) });
    expect(polePojemnosci()).toHaveValue("");
  });

  it("otwarcie dla INNEJ sali nie zostawia pól poprzedniej", () => {
    // Regresja, którą to łapie: organizator poprawia „Salę B", widząc dane
    // „Sali A" - i zapisuje jedną salę treścią drugiej. Formularz wygląda przy
    // tym na wypełniony poprawnie, więc nikt tego nie zauważa.
    const { przerysuj } = renderuj({ room: roomRow() });
    expect(poleNazwy()).toHaveValue("Sala Plenarna");

    przerysuj({ open: false });
    przerysuj({
      open: true,
      room: roomRow({
        id: "room-b",
        name: "Sala Warsztatowa",
        capacity: 30,
        floor: "1. piętro",
        location_note: "",
        sort_order: 20,
      }),
    });

    expect(poleNazwy()).toHaveValue("Sala Warsztatowa");
    expect(polePojemnosci()).toHaveValue("30");
    expect(polePietra()).toHaveValue("1. piętro");
    expect(poleNotatki()).toHaveValue("");
    expect(poleKolejnosci()).toHaveValue("20");
  });

  it("porzucone zmiany nie wracają przy kolejnym otwarciu tej samej sali", () => {
    const { przerysuj } = renderuj({ room: roomRow() });
    fireEvent.change(poleNazwy(), { target: { value: "Nazwa, której nikt nie zapisał" } });

    przerysuj({ open: false });
    przerysuj({ open: true });

    expect(poleNazwy()).toHaveValue("Sala Plenarna");
  });
});

describe("EventRoomDialog - walidacja", () => {
  it("pusta nazwa NIE dochodzi do warstwy zapisu i mówi to przy polu", () => {
    const { onSubmit } = renderuj();
    fireEvent.click(przyciskZapisu());
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(`${K}validation.nameRequired`);
  });

  it("komunikat pojawia się DOPIERO po próbie zapisu", () => {
    // Pusty formularz świecący czerwienią od pierwszego otwarcia uczy
    // organizatora, że czerwień nic nie znaczy - a wtedy nie przeczyta jej
    // w chwili, w której naprawdę coś znaczy.
    renderuj();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("pojemność ZERO jest odrzucana - to sala bez miejsc, nie sala bez limitu", () => {
    const { onSubmit } = renderuj();
    fireEvent.change(poleNazwy(), { target: { value: "Sala C" } });
    fireEvent.change(polePojemnosci(), { target: { value: "0" } });
    fireEvent.click(przyciskZapisu());

    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(`${K}validation.capacityPositive`);
  });

  it("pojemność, która nie jest liczbą całkowitą, też nie wychodzi z okna", () => {
    const { onSubmit } = renderuj();
    fireEvent.change(poleNazwy(), { target: { value: "Sala C" } });
    fireEvent.change(polePojemnosci(), { target: { value: "sto" } });
    fireEvent.click(przyciskZapisu());
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("poprawienie pola gasi komunikat i przepuszcza zapis", () => {
    // Dowód, że czerwień jest STANEM POLA, a nie jednorazowym stemplem po
    // kliknięciu: bez tego przypadku formularz mógłby zostać czerwony na zawsze.
    const { onSubmit } = renderuj();
    fireEvent.click(przyciskZapisu());
    expect(screen.getByRole("alert")).toBeInTheDocument();

    fireEvent.change(poleNazwy(), { target: { value: "Sala C" } });

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    fireEvent.click(przyciskZapisu());
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });
});

describe("EventRoomDialog - ładunek zapisu", () => {
  it("nowa sala: białe znaki obcięte, puste pola opcjonalne jako null", () => {
    const { onSubmit } = renderuj({ nextSortOrder: 40 });
    fireEvent.change(poleNazwy(), { target: { value: "  Sala Kominkowa  " } });
    fireEvent.change(polePietra(), { target: { value: "   " } });
    fireEvent.click(przyciskZapisu());

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(ladunek(onSubmit)).toEqual({
      id: null,
      eventId: EVENT_ID,
      name: "Sala Kominkowa",
      // Puste pole opcjonalne MUSI jechać jako `null`. Pusty łańcuch trafiłby
      // do kolumny jako wartość i publiczna agenda pokazałaby pustą etykietę
      // piętra zamiast jej braku.
      capacity: null,
      floor: null,
      locationNote: null,
      sortOrder: 40,
      isActive: true,
    });
  });

  it("wypełnione pola i przełącznik dochodzą do warstwy zapisu", () => {
    const { onSubmit } = renderuj();
    fireEvent.change(poleNazwy(), { target: { value: "Sala Kominkowa" } });
    fireEvent.change(polePojemnosci(), { target: { value: "45" } });
    fireEvent.change(polePietra(), { target: { value: " 2. piętro " } });
    fireEvent.change(poleNotatki(), { target: { value: " Winda po prawej " } });
    fireEvent.change(poleKolejnosci(), { target: { value: "70" } });
    fireEvent.click(przelacznikAktywnosci());
    fireEvent.click(przyciskZapisu());

    expect(ladunek(onSubmit)).toEqual({
      id: null,
      eventId: EVENT_ID,
      name: "Sala Kominkowa",
      capacity: 45,
      floor: "2. piętro",
      locationNote: "Winda po prawej",
      sortOrder: 70,
      isActive: false,
    });
  });

  it("edycja niesie IDENTYFIKATOR sali - inaczej zapis założyłby drugą salę", () => {
    const { onSubmit } = renderuj({ room: roomRow() });
    fireEvent.change(poleNazwy(), { target: { value: "Sala Plenarna A" } });
    fireEvent.click(przyciskZapisu());

    expect(ladunek(onSubmit)).toMatchObject({ id: "room-a", name: "Sala Plenarna A" });
  });

  it("pusta kolejność wraca do wartości domyślnej, a nie do NaN", () => {
    const { onSubmit } = renderuj();
    fireEvent.change(poleNazwy(), { target: { value: "Sala C" } });
    fireEvent.change(poleKolejnosci(), { target: { value: "" } });
    fireEvent.click(przyciskZapisu());
    expect(ladunek(onSubmit).sortOrder).toBe(100);
  });
});

describe("EventRoomDialog - stan oczekiwania i odmowa", () => {
  it("trwający zapis blokuje oba przyciski, więc podwójne kliknięcie nie tworzy dwóch sal", () => {
    const { onSubmit, onOpenChange, przerysuj } = renderuj();
    fireEvent.change(poleNazwy(), { target: { value: "Sala C" } });
    fireEvent.click(przyciskZapisu());
    expect(onSubmit).toHaveBeenCalledTimes(1);

    przerysuj({ isSaving: true });

    expect(przyciskZapisu()).toBeDisabled();
    // Anulowanie też jest zablokowane: zamknięcie okna w trakcie żądania
    // zostawia organizatora bez odpowiedzi, czy sala powstała.
    expect(przyciskAnuluj()).toBeDisabled();
    fireEvent.click(przyciskZapisu());
    fireEvent.click(przyciskAnuluj());
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it("odmowa zapisu zostawia wpisaną treść i pozwala wysłać ją ponownie", () => {
    // Odmowa bazy (np. `capacity_below_sessions`) nie może być karą: wpisane
    // pola zostają dokładnie tam, gdzie były, a organizator poprawia jedno
    // pole zamiast wypełniać formularz od nowa.
    const { onSubmit, przerysuj } = renderuj();
    fireEvent.change(poleNazwy(), { target: { value: "Sala Kominkowa" } });
    fireEvent.change(polePojemnosci(), { target: { value: "45" } });
    fireEvent.click(przyciskZapisu());

    przerysuj({ isSaving: true });
    przerysuj({ isSaving: false });

    expect(poleNazwy()).toHaveValue("Sala Kominkowa");
    expect(polePojemnosci()).toHaveValue("45");
    fireEvent.click(przyciskZapisu());
    expect(onSubmit).toHaveBeenCalledTimes(2);
    expect(ladunek(onSubmit, 1)).toEqual(ladunek(onSubmit, 0));
  });

  it("anulowanie zamyka okno i nie wysyła niczego", () => {
    const { onOpenChange, onSubmit } = renderuj();
    fireEvent.change(poleNazwy(), { target: { value: "Sala C" } });
    fireEvent.click(przyciskAnuluj());
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("odświeżenie listy sal w tle NIE kasuje wpisanych danych otwartego formularza", () => {
    // Zanim to naprawiono, `useEffect` odtwarzający szkic miał w zależnościach
    // `nextSortOrder`, czyli liczbę wyprowadzoną z ŻYWEJ listy sal
    // (`rows.reduce(max) + 10` w `AgendaRoomsPanel`). Każde odświeżenie listy
    // w tle - dołożenie sali przez drugiego organizatora, powrót do karty
    // przeglądarki po upływie `staleTime` - zmieniało tę liczbę, a efekt
    // nadpisywał szkic pustym. Jak to widział użytkownik: wpisywał nazwę
    // i notatkę dojścia, na moment przełączał się na inne okno, wracał -
    // formularz był pusty, bez żadnego komunikatu. Teraz zależnością efektu
    // jest TOŻSAMOŚĆ wiersza, a kolejność początkowa idzie przez `ref`.
    const { przerysuj } = renderuj({ nextSortOrder: 40 });
    fireEvent.change(poleNazwy(), { target: { value: "Sala Kominkowa" } });
    fireEvent.change(poleNotatki(), { target: { value: "Winda po prawej" } });

    przerysuj({ nextSortOrder: 50 });

    expect(poleNazwy()).toHaveValue("Sala Kominkowa");
    expect(poleNotatki()).toHaveValue("Winda po prawej");
  });
});
