// Współdzielone pole daty panelu (kupony, realizacje, analityka, zadania CRM).
// To JEDYNE miejsce, w którym powstaje `Date` dla filtrów zakresu i dla kolumn
// ważności kuponu - a więc jedyne miejsce, w którym może powstać zła godzina.
//
// CO TEN PLIK DOWODZI.
//   1. BEZ TRYBU CZASU POLE NIE NORMALIZUJE GODZINY. Kalendarz oddaje LOKALNĄ
//      PÓŁNOC i taka data wychodzi na zewnątrz. To nie jest szczegół: filtr
//      realizacji buduje z niej `lte("created_at", ...)`, więc wybranie „do:
//      dzisiaj” wycina z raportu cały ostatni dzień. Dowód stoi tutaj, bo tu
//      leży przyczyna, a nie w panelu, który jej używa.
//   2. Z TRYBEM CZASU WYBÓR DNIA DZIEDZICZY GODZINĘ z poprzedniej wartości -
//      zmiana dnia nie może przestawiać terminu zadania CRM na północ.
//   3. WYCZYSZCZENIE ODDAJE `undefined`, a nie „datę zerową”: od tego zależy,
//      czy zapytanie w ogóle dostanie ogniwo filtrujące.
//   4. POLE GODZINY ZACISKA WARTOŚĆ NIEPARSOWALNĄ i nie woła `onChange` -
//      to JEDYNE miejsce w tej powierzchni, które faktycznie zatrzymuje `NaN`
//      (pola liczbowe dialogu kuponu tego nie robią).
//   5. DWA NAPISY TEGO KOMPONENTU SĄ ZASZYTE W KODZIE, POZA SŁOWNIKIEM -
//      podpowiedź pola i etykieta godziny zmieniają się z językiem, ale nie
//      widzi ich żadna bramka parytetu i18n.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE. (1) Kalendarza `react-day-picker` - to biblioteka
// zewnętrzna, tu jest atrapą, bo przedmiotem dowodu jest to, CO pole robi
// z oddaną przez nią datą. (2) Formatowania `date-fns` - sprawdzamy wyłącznie,
// że wartość w ogóle trafia na przycisk. (3) Użycia pola w filtrach realizacji -
// to testy tamtej trasy.
//
// Popover i Calendar są podmienione: pod happy-dom Radix nie ma pełnego API
// wskaźnika ani pomiarów układu, więc bez atrapy zawartość warstwy nigdy nie
// trafiłaby do DOM-u.
import { describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { fireEvent, render, screen } from "@testing-library/react";

const h = vi.hoisted(() => ({ language: "pl" }));

vi.mock("react-i18next", async () =>
  (await import("@/test/i18nStub")).reactI18nextStub(() => h.language),
);

vi.mock("@/components/ui/popover", () => ({
  Popover: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  PopoverTrigger: ({ children }: { asChild?: boolean; children?: ReactNode }) => <>{children}</>,
  PopoverContent: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}));

// Atrapa kalendarza oddaje DWIE decyzje, których produkcja nie kontroluje:
// wybór konkretnego dnia (z lokalną północą, tak jak react-day-picker)
// i wyczyszczenie zaznaczenia.
vi.mock("@/components/ui/calendar", () => ({
  Calendar: ({ onSelect }: { onSelect: (d: Date | undefined) => void }) => (
    <div>
      <button type="button" onClick={() => onSelect(new Date(2026, 7, 22, 0, 0, 0, 0))}>
        wybierz-22-sierpnia
      </button>
      <button type="button" onClick={() => onSelect(undefined)}>
        wyczysc
      </button>
    </div>
  ),
}));

import { DatePickerField } from "@/components/admin/coupons/DatePickerField";

describe("wybór dnia bez trybu czasu", () => {
  it("data wychodzi Z GODZINĄ, jaką dał kalendarz - pole nie domyka końca dnia", () => {
    const onChange = vi.fn();
    render(<DatePickerField value={undefined} onChange={onChange} />);
    fireEvent.click(screen.getByText("wybierz-22-sierpnia"));
    const wybrana = onChange.mock.calls[0][0] as Date;
    expect(wybrana.getHours()).toBe(0);
    expect(wybrana.getMinutes()).toBe(0);
    // Konsekwencja: filtr „do” zbudowany z tej daty wycina cały wybrany dzień.
    expect(wybrana.getDate()).toBe(22);
  });

  it("wyczyszczenie zaznaczenia oddaje undefined, a nie datę zastępczą", () => {
    const onChange = vi.fn();
    render(<DatePickerField value={new Date(2026, 7, 22)} onChange={onChange} />);
    fireEvent.click(screen.getByText("wyczysc"));
    expect(onChange).toHaveBeenCalledWith(undefined);
  });

  it("bez trybu czasu pola godziny w ogóle nie ma", () => {
    render(<DatePickerField value={undefined} onChange={vi.fn()} withTime={false} />);
    expect(screen.queryByText("Godzina")).toBeNull();
  });
});

describe("wybór dnia z trybem czasu", () => {
  it("nowy dzień DZIEDZICZY godzinę z poprzedniej wartości", () => {
    const onChange = vi.fn();
    render(<DatePickerField value={new Date(2026, 0, 1, 14, 30)} onChange={onChange} withTime />);
    fireEvent.click(screen.getByText("wybierz-22-sierpnia"));
    const wybrana = onChange.mock.calls[0][0] as Date;
    expect([wybrana.getHours(), wybrana.getMinutes()]).toEqual([14, 30]);
    expect(wybrana.getDate()).toBe(22);
  });

  it("wpisana godzina zmienia CZAS, zostawiając dzień bez zmian", () => {
    const onChange = vi.fn();
    render(<DatePickerField value={new Date(2026, 0, 1, 14, 30)} onChange={onChange} withTime />);
    fireEvent.change(screen.getByDisplayValue("14:30"), { target: { value: "09:05" } });
    const wybrana = onChange.mock.calls[0][0] as Date;
    expect([wybrana.getHours(), wybrana.getMinutes(), wybrana.getSeconds()]).toEqual([9, 5, 0]);
    expect(wybrana.getDate()).toBe(1);
  });

  it.each([
    ["puste pole", ""],
    ["maska bez liczb", "--:--"],
    ["sam napis", "abc"],
  ])("godzina nieparsowalna (%s) NIE wychodzi na zewnątrz", (_opis, wartosc) => {
    const onChange = vi.fn();
    render(<DatePickerField value={new Date(2026, 0, 1, 14, 30)} onChange={onChange} withTime />);
    fireEvent.change(screen.getByDisplayValue("14:30"), { target: { value: wartosc } });
    expect(onChange).not.toHaveBeenCalled();
  });

  it("bez wybranej daty pole godziny startuje od 09:00, a nie od pustego napisu", () => {
    render(<DatePickerField value={undefined} onChange={vi.fn()} withTime />);
    expect(screen.getByDisplayValue("09:00")).toBeInTheDocument();
  });
});

describe("napisy pola daty", () => {
  it("podpowiedź podana propem wygrywa z napisem zaszytym w komponencie", () => {
    render(<DatePickerField value={undefined} onChange={vi.fn()} placeholder="Data wygaśnięcia" />);
    expect(screen.getByText("Data wygaśnięcia")).toBeInTheDocument();
  });

  it("bez podpowiedzi komponent wypisuje własny napis PO POLSKU", () => {
    h.language = "pl";
    render(<DatePickerField value={undefined} onChange={vi.fn()} />);
    expect(screen.getByText("Wybierz datę")).toBeInTheDocument();
  });

  it("w interfejsie angielskim ten sam napis jest po angielsku - ale poza słownikiem", () => {
    // Dwa literały PL/EN żyją w kodzie komponentu, więc żadna bramka parytetu
    // i18n ich nie widzi. To dług zapisany, nie naprawiany tym testem.
    h.language = "en";
    render(<DatePickerField value={undefined} onChange={vi.fn()} withTime />);
    expect(screen.getByText("Pick a date")).toBeInTheDocument();
    expect(screen.getByText("Time")).toBeInTheDocument();
    h.language = "pl";
  });

  it("etykieta pola pojawia się tylko wtedy, gdy ją podano", () => {
    const { rerender } = render(
      <DatePickerField value={undefined} onChange={vi.fn()} label="Ważny od" />,
    );
    expect(screen.getByText("Ważny od")).toBeInTheDocument();
    rerender(<DatePickerField value={undefined} onChange={vi.fn()} />);
    expect(screen.queryByText("Ważny od")).toBeNull();
  });

  it("wybrana data zastępuje podpowiedź na przycisku", () => {
    render(<DatePickerField value={new Date(2026, 7, 22)} onChange={vi.fn()} />);
    expect(screen.queryByText("Wybierz datę")).toBeNull();
    expect(screen.getAllByRole("button")[0].textContent).toContain("2026");
  });

  it("pole wyłączone nie daje się otworzyć - przycisk jest nieaktywny", () => {
    render(<DatePickerField value={undefined} onChange={vi.fn()} disabled />);
    expect(screen.getAllByRole("button")[0]).toBeDisabled();
  });
});
