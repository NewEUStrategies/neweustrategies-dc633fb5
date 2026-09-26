// Molekuła „formularz sekcji" z PODGLĄDEM NA ŻYWO.
//
// CO TEN PLIK DOWODZI.
//   1. Nowa sekcja rzędów i nowy stół mają różne tytuły i różne pola (rzędy:
//      liczba rzędów, miejsc, schemat, numeracja, przejścia; stół: kształt
//      i liczba krzeseł). Przełączenie rodzaju w oknie przełącza pola.
//   2. Podgląd liczy miejsca tą samą formułą co baza (parytet ma własny test)
//      i znika, gdy parametry są błędne - zamiast rysować coś, czego baza nie
//      zapisze.
//   3. Błędy dopiero po próbie zapisu; poprawny formularz wysyła ładunek
//      z `mapId` (nowa sekcja) albo `id` (edycja), z przejściami jako liczbami
//      i kategorią `null` dla „bez kategorii”.
//   4. Odświeżenie sekcji w tle nie kasuje pracy; anuluj zamyka okno.
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

const h = vi.hoisted(() => ({ lang: "pl" }));

vi.mock("react-i18next", async () =>
  (await import("@/test/i18nStub")).reactI18nextStub(() => h.lang),
);
vi.mock("@/lib/i18n-admin-event-seating", () => ({ ensureSeatingI18n: () => undefined }));
vi.mock("@/components/atoms/FormSelect", async () =>
  (await import("@/test/events/seatingUiMocks")).formSelectModule(),
);
vi.mock("@/components/ui/dialog", async () =>
  (await import("@/test/events/seatingUiMocks")).dialogModule(),
);

import {
  EventSeatSectionDialog,
  type EventSeatSectionDialogProps,
} from "@/components/admin/events/molecules/EventSeatSectionDialog";
import { SEAT_MAP_ID, seatCategory, seatSection } from "@/test/events/seatingFixtures";

const S = "adminEventSeating.sectionDialog";

function okno(over: Partial<EventSeatSectionDialogProps> = {}) {
  const props: EventSeatSectionDialogProps = {
    open: true,
    onOpenChange: vi.fn(),
    mapId: SEAT_MAP_ID,
    section: null,
    kind: "rows",
    categories: [seatCategory()],
    isSaving: false,
    onSubmit: vi.fn(),
    ...over,
  };
  const view = render(<EventSeatSectionDialog {...props} />);
  return { ...view, props };
}

const pole = (klucz: string) => screen.getByLabelText(`${S}.${klucz}`) as HTMLInputElement;
const wpisz = (klucz: string, value: string) =>
  fireEvent.change(pole(klucz), { target: { value } });
const zapisz = () => fireEvent.click(screen.getByRole("button", { name: `${S}.save` }));
const podglad = () => screen.queryByRole("img");

describe("EventSeatSectionDialog - rzędy", () => {
  it("nowa sekcja rzędów: tytuł, pola rzędów i podgląd 5 x 10 miejsc", () => {
    okno();

    expect(screen.getByRole("heading", { name: `${S}.createRowsTitle` })).toBeTruthy();
    expect(pole("rowsCount").value).toBe("5");
    expect(screen.queryByLabelText(`${S}.tableSeats`)).toBeNull();
    expect(podglad()?.getAttribute("aria-label")).toBe(`${S}.previewCount(count=50)`);
    expect(podglad()?.querySelectorAll("circle")).toHaveLength(50);
  });

  it("podgląd idzie za parametrami i znika przy błędnych", () => {
    okno();
    wpisz("rowsCount", "2");
    wpisz("seatsPerRow", "3");
    expect(podglad()?.getAttribute("aria-label")).toBe(`${S}.previewCount(count=6)`);

    wpisz("seatsPerRow", "0");
    expect(podglad()).toBeNull();
    expect(screen.getByText(`${S}.previewInvalid`)).toBeTruthy();
  });

  it("obrót obraca podgląd, a przecinek dziesiętny jest przyjmowany", () => {
    okno();
    wpisz("rowsCount", "1");
    wpisz("seatsPerRow", "2");
    wpisz("rotation", "90,0");
    const kola = [...(podglad()?.querySelectorAll("circle") ?? [])];
    // Po obrocie o 90 stopni rząd biegnie w dół: x stałe, y rośnie.
    expect(kola.map((kolo) => kolo.getAttribute("cx"))).toEqual(["0", "0"]);
    expect(kola.map((kolo) => kolo.getAttribute("cy"))).toEqual(["0", "50"]);
  });

  it("błędy dopiero po próbie zapisu i blokują wysyłkę", () => {
    const { props } = okno();
    expect(screen.queryByText(`${S}.validation.labelRequired`)).toBeNull();

    wpisz("aisles", "3, x");
    zapisz();
    expect(screen.getByText(`${S}.validation.labelRequired`)).toBeTruthy();
    expect(screen.getByText(`${S}.validation.aislesInvalid`)).toBeTruthy();
    expect(props.onSubmit).not.toHaveBeenCalled();
  });

  it("poprawna nowa sekcja wysyła mapId, przejścia jako liczby i wybrane schematy", () => {
    const { props } = okno();
    wpisz("label", "  Parter  ");
    wpisz("rowsCount", "2");
    wpisz("seatsPerRow", "4");
    wpisz("aisles", "2");
    fireEvent.change(pole("rowLabelScheme"), { target: { value: "numeric" } });
    fireEvent.change(pole("seatNumbering"), { target: { value: "odd_even" } });
    fireEvent.change(pole("category"), { target: { value: "cat-vip" } });
    wpisz("originX", "10");
    wpisz("originY", "20");
    zapisz();

    expect(props.onSubmit).toHaveBeenCalledWith({
      mapId: SEAT_MAP_ID,
      label: "Parter",
      kind: "rows",
      categoryId: "cat-vip",
      originX: 10,
      originY: 20,
      rotationDeg: 0,
      rowsCount: 2,
      seatsPerRow: 4,
      rowLabelScheme: "numeric",
      rowLabelStart: 1,
      seatNumbering: "odd_even",
      seatNumberStart: 1,
      seatPitch: 50,
      rowPitch: 60,
      aisleAfter: [2],
      tableShape: null,
      tableSeats: null,
    });
  });
});

describe("EventSeatSectionDialog - numeracja i podziałki", () => {
  it("początek rzędów i numeracji oraz podziałki idą do ładunku i do podglądu", () => {
    const { props } = okno();
    wpisz("label", "Balkon");
    wpisz("rowsCount", "1");
    wpisz("seatsPerRow", "2");
    wpisz("rowLabelStart", "3");
    wpisz("seatNumberStart", "11");
    wpisz("seatPitch", "40");
    wpisz("rowPitch", "70");
    const numery = [...(podglad()?.querySelectorAll("text") ?? [])].map((node) => node.textContent);
    expect(numery).toEqual(["11", "12"]);
    zapisz();

    expect(props.onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        rowLabelStart: 3,
        seatNumberStart: 11,
        seatPitch: 40,
        rowPitch: 70,
      }),
    );
  });

  it("podziałka poza zakresem to błąd pola po próbie zapisu", () => {
    const { props } = okno();
    wpisz("label", "Balkon");
    wpisz("seatPitch", "5");
    zapisz();
    expect(screen.getAllByText(`${S}.validation.pitchRange`)).toHaveLength(1);
    expect(props.onSubmit).not.toHaveBeenCalled();
  });
});

describe("EventSeatSectionDialog - stół i edycja", () => {
  it("nowy stół: własny tytuł, kształt i krzesła, podgląd 8 miejsc", () => {
    okno({ kind: "table" });

    expect(screen.getByRole("heading", { name: `${S}.createTableTitle` })).toBeTruthy();
    expect(screen.queryByLabelText(`${S}.rowsCount`)).toBeNull();
    expect(pole("tableSeats").value).toBe("8");
    expect(podglad()?.querySelectorAll("circle")).toHaveLength(8);
  });

  it("przełączenie rodzaju w oknie przełącza pola, a stół wysyła kształt i krzesła", () => {
    const { props } = okno();
    fireEvent.change(pole("kind"), { target: { value: "table" } });
    fireEvent.change(pole("tableShape"), { target: { value: "rect" } });
    wpisz("tableSeats", "6");
    wpisz("label", "Stół 1");
    zapisz();

    expect(props.onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "table",
        tableShape: "rect",
        tableSeats: 6,
        rowsCount: null,
        seatsPerRow: null,
        rowLabelScheme: null,
        seatNumbering: null,
        aisleAfter: [],
      }),
    );
  });

  it("edycja: tytuł edycji, dane sekcji, identyfikator zamiast mapId, „bez kategorii” to null", () => {
    h.lang = "en";
    const { props } = okno({ section: seatSection({ aisleAfter: [1, 2] }) });

    expect(screen.getByRole("heading", { name: `${S}.editTitle` })).toBeTruthy();
    expect(pole("aisles").value).toBe("1, 2");
    expect(screen.getByRole("option", { name: "VIP zone" })).toBeTruthy();
    fireEvent.change(pole("category"), { target: { value: "__none__" } });
    zapisz();

    expect(props.onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ id: "sec-a", categoryId: null, label: "A", aisleAfter: [1, 2] }),
    );
    expect(vi.mocked(props.onSubmit).mock.calls[0]?.[0]).not.toHaveProperty("mapId");
    h.lang = "pl";
  });

  it("odświeżenie sekcji w tle nie kasuje pracy, a inna sekcja - tak", () => {
    const { rerender, props } = okno({ section: seatSection() });
    wpisz("label", "B");

    rerender(<EventSeatSectionDialog {...props} section={seatSection()} />);
    expect(pole("label").value).toBe("B");

    rerender(<EventSeatSectionDialog {...props} section={seatSection({ id: "x", label: "C" })} />);
    expect(pole("label").value).toBe("C");
  });

  it("anuluj zamyka okno, a w trakcie zapisu przyciski są zgaszone", () => {
    const { props, rerender } = okno();
    fireEvent.click(screen.getByRole("button", { name: `${S}.cancel` }));
    expect(props.onOpenChange).toHaveBeenCalledWith(false);

    rerender(<EventSeatSectionDialog {...props} isSaving />);
    expect(screen.getByRole("button", { name: `${S}.save` })).toBeDisabled();
  });

  it("zamknięte okno nic nie rysuje", () => {
    const { container } = okno({ open: false });
    expect(container.innerHTML).toBe("");
  });
});
