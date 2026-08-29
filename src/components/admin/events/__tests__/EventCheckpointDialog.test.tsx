// Molekuła „punkt kontrolny" - RODZAJ PUNKTU RZĄDZI RESZTĄ FORMULARZA.
//
// CO TEN PLIK DOWODZI.
//   1. RODZAJ PUNKTU ODSŁANIA I ZASŁANIA POWIĄZANIA. Punkt sesyjny pyta o
//      sesję, stoisko firmowe o sponsora, wejście na wydarzenie o żadne z nich.
//      Wybór sesji widoczny przy wejściu głównym sugerowałby, że bramka
//      wpuszcza tylko na tę sesję - a wpuszcza na całe wydarzenie.
//   2. POWIĄZANIE ZDEJMUJE KONWERSJA, NIE UŻYTKOWNIK. Zmiana rodzaju z `session`
//      na `event_entry` musi wysłać `sessionId: null`. Bez tego w bazie zostaje
//      sierota po poprzedniej wersji formularza: punkt wejściowy przypięty do
//      sesji, która skończyła się wczoraj.
//   3. PUNKT SESYJNY BEZ SESJI I STOISKO BEZ SPONSORA NIE PRZECHODZĄ. Baza
//      odmawia (`sessionRequired`, `sponsorRequired`), a odmowa przy bramce
//      kosztuje kolejkę - lepiej zatrzymać to w oknie.
//   4. PUSTA POJEMNOŚĆ TO BRAK LIMITU, ZERO TO ZAKAZ WEJŚCIA. Dwa różne zdania
//      w jednym polu; ładunek musi je rozróżniać (`null` kontra `0`).
//   5. TRYB TWORZENIA I TRYB EDYCJI TO DWA RÓŻNE ŻĄDANIA: nowy punkt niesie
//      `eventId`, poprawiany niesie `id` i NIE niesie `eventId`.
//   6. OTWARCIE DLA INNEGO WIERSZA NIE NIESIE POPRZEDNIEGO.
//   7. NIEPEŁNY FORMULARZ NIE WOŁA WARSTWY ZAPISU - asercja na atrapie
//      `onSubmit`, nie na wyglądzie przycisku.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE. (1) Reguł wersji roboczej (zakresy, konwersja
// tekst -> liczba, komplet komunikatów) - tabele przypadków są
// w `lib/events/onsiteDraft.test.ts`; tutaj dowodzimy, że okno ich UŻYWA
// i co pokazuje. (2) Zgodności słowników rodzajów i trybów z bazą - to bramka
// `lib/events/__tests__/dbEnumParity.test.ts`. (3) Zapisu RPC - molekuła
// dostaje `onSubmit` w propsie.
//
// Radix Dialog i Radix Select nie działają pod happy-dom bez pełnego pointer
// API - oba są podmienione na natywne odpowiedniki.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import {
  CHECKPOINT_KINDS,
  type CheckpointInput,
  type EventCheckpointRow,
} from "@/lib/events/onsiteApi";
import type { CheckpointRelationOption } from "@/components/admin/events/molecules/EventCheckpointDialog";

vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());
// Klient bazy nie jest przedmiotem dowodu, a jego moduł domaga się konfiguracji
// środowiska przy imporcie - okno bierze z `onsiteApi` wyłącznie SŁOWNIKI.
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

vi.mock("@/components/ui/dialog", () => {
  const stan = { open: false };
  return {
    Dialog: ({ open, children }: { open: boolean; children?: ReactNode }) => {
      stan.open = open;
      return <div data-testid="dialog-root">{children}</div>;
    },
    DialogContent: ({ children }: { children?: ReactNode }) =>
      stan.open ? <div role="dialog">{children}</div> : null,
    DialogHeader: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
    DialogFooter: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
    DialogTitle: ({ children }: { children?: ReactNode }) => <h2>{children}</h2>,
    DialogDescription: ({ children }: { children?: ReactNode }) => <p>{children}</p>,
  };
});

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

const { EventCheckpointDialog } =
  await import("@/components/admin/events/molecules/EventCheckpointDialog");

const WYDARZENIE = "8c2b1a55-1111-4222-8333-444455556666";
const SESJA = "sesja-otwarcie";
const SALA = "sala-a";
const SPONSOR = "sponsor-alfa";
const BLAD = "adminEventOnsite.errors.";
const D = "adminEventOnsite.checkpoints.dialog.";

const SESJE: CheckpointRelationOption[] = [{ id: SESJA, label: "Sesja otwarcia" }];
const SALE: CheckpointRelationOption[] = [{ id: SALA, label: "Sala A" }];
const SPONSORZY: CheckpointRelationOption[] = [{ id: SPONSOR, label: "Alfa sp. z o.o." }];

// Wiersz punktu tak, jak oddaje go RPC listy. `capacity`, `session_id`,
// `room_id`, `sponsor_id` i `last_checkin_at` są w bazie NULLOWALNE - punkt bez
// limitu i bez powiązań to przypadek DOMYŚLNY, a nie wyjątek. Wygenerowany typ
// pokazuje je jako wymagane, bo kodogenerator nie zna nullowalności kolumn
// wyniku funkcji.
const BAZOWY_WIERSZ: Record<string, unknown> = {
  id: "cp-1",
  event_id: WYDARZENIE,
  name_pl: "Wejście główne",
  name_en: "Main entrance",
  kind: "event_entry",
  session_id: null,
  session_title_pl: null,
  session_title_en: null,
  room_id: null,
  room_name: null,
  sponsor_id: null,
  sponsor_name: null,
  direction_mode: "in_only",
  access_mode: "control",
  capacity: null,
  dedupe_window_seconds: 120,
  is_active: true,
  sort_order: 0,
  occupancy: 0,
  granted_count: 0,
  denied_count: 0,
  repeat_count: 0,
  device_count: 0,
  last_checkin_at: null,
  created_at: "2026-08-01T10:00:00Z",
  updated_at: "2026-08-01T10:00:00Z",
};

function punkt(overrides: Partial<EventCheckpointRow> = {}): EventCheckpointRow {
  return { ...BAZOWY_WIERSZ, ...overrides } as EventCheckpointRow;
}

function renderuj(props: { open?: boolean; checkpoint?: EventCheckpointRow | null } = {}) {
  const onOpenChange = vi.fn();
  const onSubmit = vi.fn<(input: CheckpointInput) => void>();
  const stan = {
    open: props.open ?? true,
    checkpoint: props.checkpoint ?? null,
    isSaving: false,
  };
  const drzewo = () => (
    <EventCheckpointDialog
      open={stan.open}
      onOpenChange={onOpenChange}
      eventId={WYDARZENIE}
      checkpoint={stan.checkpoint}
      sessions={SESJE}
      rooms={SALE}
      sponsors={SPONSORZY}
      isSaving={stan.isSaving}
      onSubmit={onSubmit}
    />
  );
  const wynik = render(drzewo());
  const przerysuj = (zmiana: Partial<typeof stan>) => {
    Object.assign(stan, zmiana);
    wynik.rerender(drzewo());
  };
  return { ...wynik, onOpenChange, onSubmit, przerysuj };
}

const nazwaPl = () => screen.getByLabelText(`${D}namePl`);
const nazwaEn = () => screen.getByLabelText(`${D}nameEn`);
const rodzaj = () => screen.getByLabelText(`${D}kind`);
const trybDostepu = () => screen.getByLabelText(`${D}accessMode`);
const kierunek = () => screen.getByLabelText(`${D}directionMode`);
const pojemnosc = () => screen.getByLabelText(`${D}capacity`);
const oknoPowtorzen = () => screen.getByLabelText(`${D}dedupeWindowSeconds`);
const kolejnosc = () => screen.getByLabelText(`${D}sortOrder`);
const sala = () => screen.getByLabelText(`${D}room`);
const sesja = () => screen.getByLabelText(`${D}session`);
const sponsor = () => screen.getByLabelText(`${D}sponsor`);
const zapisz = () => screen.getByRole("button", { name: "adminEventOnsite.actions.save" });
const anuluj = () => screen.getByRole("button", { name: "adminEventOnsite.actions.cancel" });

/** Minimum, którego wymaga każdy rodzaj punktu: nazwa w obu językach. */
function wypelnijNazwy(pl = "Wejście główne", en = "Main entrance") {
  fireEvent.change(nazwaPl(), { target: { value: pl } });
  fireEvent.change(nazwaEn(), { target: { value: en } });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("EventCheckpointDialog - otwarcie, tryb i pozostałość", () => {
  it("okno ZAMKNIĘTE nie renderuje formularza", () => {
    renderuj({ open: false });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.queryByText(`${D}createTitle`)).not.toBeInTheDocument();
  });

  it("TRYB TWORZENIA: tytuł zakładania i domyślne ustawienia bramki", () => {
    renderuj();
    expect(screen.getByRole("heading", { name: `${D}createTitle` })).toBeInTheDocument();
    expect(nazwaPl()).toHaveValue("");
    expect(rodzaj()).toHaveValue("event_entry");
    expect(kierunek()).toHaveValue("in_only");
    expect(trybDostepu()).toHaveValue("control");
    expect(pojemnosc()).toHaveValue("");
    expect(oknoPowtorzen()).toHaveValue("120");
    expect(screen.getByRole("switch", { name: `${D}isActive` })).toBeChecked();
  });

  it("TRYB EDYCJI: tytuł poprawiania i wartości z wiersza", () => {
    renderuj({
      checkpoint: punkt({
        name_pl: "Sala A",
        name_en: "Room A",
        kind: "session",
        session_id: SESJA,
        room_id: SALA,
        direction_mode: "in_out",
        access_mode: "track",
        capacity: 80,
        dedupe_window_seconds: 300,
        is_active: false,
        sort_order: 40,
      }),
    });
    expect(screen.getByRole("heading", { name: `${D}editTitle` })).toBeInTheDocument();
    expect(nazwaPl()).toHaveValue("Sala A");
    expect(nazwaEn()).toHaveValue("Room A");
    expect(rodzaj()).toHaveValue("session");
    expect(sesja()).toHaveValue(SESJA);
    expect(sala()).toHaveValue(SALA);
    expect(kierunek()).toHaveValue("in_out");
    expect(trybDostepu()).toHaveValue("track");
    expect(pojemnosc()).toHaveValue("80");
    expect(oknoPowtorzen()).toHaveValue("300");
    expect(kolejnosc()).toHaveValue("40");
    expect(screen.getByRole("switch", { name: `${D}isActive` })).not.toBeChecked();
  });

  it("OTWARCIE DLA INNEGO WIERSZA nie niesie wartości poprzedniego", () => {
    // Regresja, którą to łapie: poprawka punktu B startuje z nazwą, rodzajem
    // i pojemnością punktu A - i zapisuje je pod identyfikatorem B.
    const { przerysuj } = renderuj({
      checkpoint: punkt({ name_pl: "Sala A", kind: "session", session_id: SESJA, capacity: 80 }),
    });
    fireEvent.change(nazwaPl(), { target: { value: "Ręczna zmiana" } });

    przerysuj({ open: false });
    przerysuj({
      open: true,
      checkpoint: punkt({
        id: "cp-2",
        name_pl: "Szatnia",
        name_en: "Cloakroom",
        kind: "cloakroom",
      }),
    });

    expect(nazwaPl()).toHaveValue("Szatnia");
    expect(rodzaj()).toHaveValue("cloakroom");
    expect(pojemnosc()).toHaveValue("");
    expect(screen.queryByLabelText(`${D}session`)).not.toBeInTheDocument();
  });

  it("ZMIANA WIERSZA PRZY ZAMKNIĘTYM OKNIE nie przestawia formularza", () => {
    // Efekt wychodzi wcześnie, gdy okno jest zamknięte. Bez tego wyjścia
    // odświeżenie listy pod zamkniętym oknem kasowałoby pracę operatora.
    const { przerysuj } = renderuj({ open: false, checkpoint: punkt({ name_pl: "Wejście" }) });
    przerysuj({ open: true });
    fireEvent.change(nazwaPl(), { target: { value: "Wejście boczne" } });

    przerysuj({ open: false });
    przerysuj({ checkpoint: punkt({ name_pl: "Wejście" }) });
    przerysuj({ open: true });

    expect(nazwaPl()).toHaveValue("Wejście");
  });
});

describe("EventCheckpointDialog - rodzaj punktu rządzi powiązaniami", () => {
  it("droplista rodzajów oferuje DOKŁADNIE zbiór przyjmowany przez bazę", () => {
    renderuj();
    const wartosci = Array.from(rodzaj().querySelectorAll("option")).map(
      (option) => (option as HTMLOptionElement).value,
    );
    expect(wartosci).toEqual([...CHECKPOINT_KINDS]);
  });

  it("WEJŚCIE NA WYDARZENIE nie pyta ani o sesję, ani o sponsora - pyta o salę", () => {
    renderuj();
    expect(screen.queryByLabelText(`${D}session`)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(`${D}sponsor`)).not.toBeInTheDocument();
    expect(sala()).toBeInTheDocument();
  });

  it("PUNKT SESYJNY odsłania wybór sesji i nadal nie pyta o sponsora", () => {
    renderuj();
    fireEvent.change(rodzaj(), { target: { value: "session" } });
    expect(sesja()).toBeInTheDocument();
    expect(screen.queryByLabelText(`${D}sponsor`)).not.toBeInTheDocument();
  });

  it("STOISKO FIRMOWE odsłania wybór sponsora i nie pyta o sesję", () => {
    renderuj();
    fireEvent.change(rodzaj(), { target: { value: "company_booth" } });
    expect(sponsor()).toBeInTheDocument();
    expect(screen.queryByLabelText(`${D}session`)).not.toBeInTheDocument();
  });

  it("punkt sesyjny BEZ WSKAZANEJ SESJI nie wysyła żądania i mówi to przy polu", () => {
    const { onSubmit } = renderuj();
    wypelnijNazwy();
    fireEvent.change(rodzaj(), { target: { value: "session" } });
    fireEvent.click(zapisz());

    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText(`${BLAD}sessionRequired`)).toBeInTheDocument();
  });

  it("stoisko firmowe BEZ WSKAZANEGO SPONSORA nie wysyła żądania", () => {
    const { onSubmit } = renderuj();
    wypelnijNazwy();
    fireEvent.change(rodzaj(), { target: { value: "company_booth" } });
    fireEvent.click(zapisz());

    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText(`${BLAD}sponsorRequired`)).toBeInTheDocument();
  });

  it("wskazana sesja odblokowuje zapis i jedzie w ładunku", () => {
    const { onSubmit } = renderuj();
    wypelnijNazwy();
    fireEvent.change(rodzaj(), { target: { value: "session" } });
    fireEvent.change(sesja(), { target: { value: SESJA } });
    fireEvent.click(zapisz());

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0][0]).toMatchObject({
      kind: "session",
      sessionId: SESJA,
      sponsorId: null,
    });
  });

  it("ZMIANA RODZAJU ZDEJMUJE WSKAZANIE SESJI jawnym null", () => {
    // Bez tego w bazie zostaje sierota: wejście główne przypięte do sesji,
    // która skończyła się wczoraj - i bramka liczy je do jej frekwencji.
    const { onSubmit } = renderuj({
      checkpoint: punkt({ kind: "session", session_id: SESJA, room_id: SALA }),
    });
    expect(sesja()).toHaveValue(SESJA);

    fireEvent.change(rodzaj(), { target: { value: "event_entry" } });
    fireEvent.click(zapisz());

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0][0]).toMatchObject({
      kind: "event_entry",
      sessionId: null,
      roomId: SALA,
    });
  });

  it("ZMIANA RODZAJU ZDEJMUJE WSKAZANIE SPONSORA jawnym null", () => {
    const { onSubmit } = renderuj({
      checkpoint: punkt({ kind: "company_booth", sponsor_id: SPONSOR }),
    });
    expect(sponsor()).toHaveValue(SPONSOR);

    fireEvent.change(rodzaj(), { target: { value: "zone" } });
    fireEvent.click(zapisz());

    expect(onSubmit.mock.calls[0][0]).toMatchObject({ kind: "zone", sponsorId: null });
  });

  it("„bez wskazania” na dowolnej dropliście powiązań jedzie jako null", () => {
    // Wartownik `__none__` istnieje tylko dlatego, że Radix nie przyjmuje
    // pustej wartości pozycji; do ładunku nie ma prawa dojechać.
    const { onSubmit } = renderuj({
      checkpoint: punkt({ kind: "company_booth", sponsor_id: SPONSOR, room_id: SALA }),
    });
    fireEvent.change(sala(), { target: { value: "__none__" } });
    fireEvent.change(sponsor(), { target: { value: "__none__" } });
    fireEvent.click(zapisz());

    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText(`${BLAD}sponsorRequired`)).toBeInTheDocument();

    fireEvent.change(sponsor(), { target: { value: SPONSOR } });
    fireEvent.click(zapisz());
    expect(onSubmit.mock.calls[0][0]).toMatchObject({ roomId: null, sponsorId: SPONSOR });
  });
});

describe("EventCheckpointDialog - walidacja pól", () => {
  it("BŁĘDY NIE POKAZUJĄ SIĘ przed pierwszą próbą zapisu", () => {
    renderuj();
    expect(screen.queryByText(`${BLAD}invalidNames`)).not.toBeInTheDocument();
    expect(nazwaPl()).not.toHaveAttribute("aria-invalid");

    fireEvent.click(zapisz());
    expect(screen.getAllByText(`${BLAD}invalidNames`)).toHaveLength(2);
  });

  it("nazwa TYLKO po polsku nie wystarczy - bramka mówi w dwóch językach", () => {
    const { onSubmit } = renderuj();
    fireEvent.change(nazwaPl(), { target: { value: "Wejście główne" } });
    fireEvent.click(zapisz());

    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getAllByText(`${BLAD}invalidNames`)).toHaveLength(1);
    expect(nazwaEn()).toHaveAttribute("aria-invalid", "true");
  });

  it("PUSTA POJEMNOŚĆ to brak limitu - w ładunku null", () => {
    const { onSubmit } = renderuj();
    wypelnijNazwy();
    fireEvent.click(zapisz());
    expect(onSubmit.mock.calls[0][0].capacity).toBeNull();
  });

  it("POJEMNOŚĆ ZERO to zakaz wejścia - w ładunku 0, nie null", () => {
    // Gdyby `0` zwijało się do `null`, punkt zamknięty na klucz wpuszczałby
    // wszystkich - i nikt by tego nie zauważył aż do bramki.
    const { onSubmit } = renderuj();
    wypelnijNazwy();
    fireEvent.change(pojemnosc(), { target: { value: "0" } });
    fireEvent.click(zapisz());
    expect(onSubmit.mock.calls[0][0].capacity).toBe(0);
  });

  it("pojemność, która nie jest liczbą całkowitą nieujemną, blokuje zapis", () => {
    const { onSubmit } = renderuj();
    wypelnijNazwy();
    fireEvent.change(pojemnosc(), { target: { value: "-5" } });
    fireEvent.click(zapisz());

    expect(onSubmit).not.toHaveBeenCalled();
    expect(pojemnosc()).toHaveAttribute("aria-invalid", "true");
  });

  it("PUSTE okno powtórzeń blokuje zapis - to nie jest „bez okna”", () => {
    // Puste pole pojemności znaczy „bez limitu", ale puste okno powtórzeń nie
    // ma takiego znaczenia: baza wymaga liczby sekund.
    const { onSubmit } = renderuj();
    wypelnijNazwy();
    fireEvent.change(oknoPowtorzen(), { target: { value: "" } });
    fireEvent.click(zapisz());

    expect(onSubmit).not.toHaveBeenCalled();
    expect(oknoPowtorzen()).toHaveAttribute("aria-invalid", "true");
  });

  it("okno powtórzeń dłuższe niż doba blokuje zapis, a doba równo przechodzi", () => {
    const { onSubmit } = renderuj();
    wypelnijNazwy();
    fireEvent.change(oknoPowtorzen(), { target: { value: "86401" } });
    fireEvent.click(zapisz());
    expect(onSubmit).not.toHaveBeenCalled();

    fireEvent.change(oknoPowtorzen(), { target: { value: "86400" } });
    fireEvent.click(zapisz());
    expect(onSubmit.mock.calls[0][0].dedupeWindowSeconds).toBe(86_400);
  });
});

describe("EventCheckpointDialog - ładunek zapisu", () => {
  it("NOWY punkt niesie identyfikator wydarzenia i obcięte nazwy", () => {
    const { onSubmit } = renderuj();
    wypelnijNazwy("  Wejście główne  ", "  Main entrance  ");
    fireEvent.change(kierunek(), { target: { value: "in_out" } });
    fireEvent.change(trybDostepu(), { target: { value: "track" } });
    fireEvent.change(sala(), { target: { value: SALA } });
    fireEvent.change(kolejnosc(), { target: { value: "30" } });
    fireEvent.click(screen.getByRole("switch", { name: `${D}isActive` }));
    fireEvent.click(zapisz());

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0][0]).toEqual({
      id: undefined,
      eventId: WYDARZENIE,
      namePl: "Wejście główne",
      nameEn: "Main entrance",
      kind: "event_entry",
      sessionId: null,
      roomId: SALA,
      sponsorId: null,
      directionMode: "in_out",
      accessMode: "track",
      capacity: null,
      dedupeWindowSeconds: 120,
      isActive: false,
      sortOrder: 30,
    });
  });

  it("POPRAWIANY punkt niesie własny identyfikator i NIE niesie wydarzenia", () => {
    // Wysłanie `eventId` przy poprawce jest w tym RPC żądaniem założenia
    // drugiego punktu - przy bramce stają wtedy dwa o tej samej nazwie.
    const { onSubmit } = renderuj({ checkpoint: punkt({ id: "cp-77" }) });
    fireEvent.change(nazwaPl(), { target: { value: "Wejście VIP" } });
    fireEvent.click(zapisz());

    expect(onSubmit.mock.calls[0][0]).toMatchObject({ id: "cp-77", eventId: undefined });
  });
});

describe("EventCheckpointDialog - zapis w locie i wyjście", () => {
  it("trwający zapis odcina OBA przyciski i nie przepuszcza drugiego żądania", () => {
    const { onSubmit, onOpenChange, przerysuj } = renderuj();
    wypelnijNazwy();
    fireEvent.click(zapisz());
    expect(onSubmit).toHaveBeenCalledTimes(1);

    przerysuj({ isSaving: true });
    fireEvent.click(zapisz());
    fireEvent.click(anuluj());

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it("okno NIE zamyka się samo po wysłaniu - odmowa zostawia pracę na ekranie", () => {
    const { onOpenChange } = renderuj();
    wypelnijNazwy("Wejście VIP", "VIP entrance");
    fireEvent.change(pojemnosc(), { target: { value: "50" } });
    fireEvent.click(zapisz());

    expect(onOpenChange).not.toHaveBeenCalled();
    expect(nazwaPl()).toHaveValue("Wejście VIP");
    expect(pojemnosc()).toHaveValue("50");
  });

  it("anulowanie zamyka okno BEZ żądania zapisu", () => {
    const { onOpenChange, onSubmit } = renderuj();
    wypelnijNazwy();
    fireEvent.click(anuluj());

    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
