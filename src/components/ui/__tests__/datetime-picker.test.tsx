import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DateTimePicker } from "@/components/ui/datetime-picker";
import { axeViolations, summarize } from "@/test/axe";
import { freezeClock } from "@/test/time";

// Selektor sięga po `new Date()` przy wyborze godziny bez daty i przy „Teraz",
// a literały niżej są wejściem konwersji. Zamrożony zegar trzyma oba
// w tej samej dobie, niezależnie od dnia, w którym biegnie suita.
freezeClock("2026-09-24T12:00:00.000Z");

describe("DateTimePicker", () => {
  it("uses project-styled hour and minute selectors instead of a native time input", () => {
    render(<DateTimePicker value="2026-09-24T08:17:00.000Z" onChange={vi.fn()} lang="pl" />);

    fireEvent.click(screen.getByRole("button", { name: /24 wrz 2026/i }));

    expect(screen.queryByDisplayValue("10:17")).not.toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Godzina" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Minuta" })).toBeInTheDocument();
  });

  it("preserves a minute outside the five-minute steps", () => {
    render(<DateTimePicker value="2026-09-24T08:17:00.000Z" onChange={vi.fn()} lang="pl" />);

    fireEvent.click(screen.getByRole("button", { name: /24 wrz 2026/i }));
    expect(screen.getByRole("combobox", { name: "Minuta" })).toHaveTextContent("17");
  });

  it("changes the hour through the project selector", () => {
    const onChange = vi.fn();
    render(<DateTimePicker value="2026-09-24T08:15:00.000Z" onChange={onChange} lang="pl" />);

    fireEvent.click(screen.getByRole("button", { name: /24 wrz 2026/i }));
    const hour = screen.getByRole("combobox", { name: "Godzina" });
    fireEvent.click(hour);
    fireEvent.click(screen.getByRole("option", { name: "00" }));

    expect(onChange).toHaveBeenCalled();
    const changedValue = onChange.mock.calls.at(-1)?.[0];
    expect(typeof changedValue).toBe("string");
    expect(new Date(String(changedValue)).getHours()).toBe(0);
  });

  it("changes minutes in five-minute steps", () => {
    const onChange = vi.fn();
    render(<DateTimePicker value="2026-09-24T08:15:00.000Z" onChange={onChange} lang="pl" />);

    fireEvent.click(screen.getByRole("button", { name: /24 wrz 2026/i }));
    const minute = screen.getByRole("combobox", { name: "Minuta" });
    fireEvent.click(minute);
    fireEvent.click(screen.getByRole("option", { name: "00" }));

    expect(onChange).toHaveBeenCalled();
    const changedValue = onChange.mock.calls.at(-1)?.[0];
    expect(typeof changedValue).toBe("string");
    expect(new Date(String(changedValue)).getMinutes()).toBe(0);
  });
});

const otworz = (nazwa: RegExp | string) =>
  fireEvent.click(screen.getByRole("button", { name: nazwa }));
const ostatniaWartosc = (fn: ReturnType<typeof vi.fn>) =>
  fn.mock.calls.at(-1)?.[0] as string | null;

describe("DateTimePicker - pole i czyszczenie", () => {
  it("puste pole pokazuje podpowiedź w języku pola, a własna podpowiedź ją zastępuje", () => {
    const { rerender } = render(<DateTimePicker value={null} onChange={vi.fn()} lang="pl" />);
    expect(screen.getByRole("button", { name: "Wybierz datę i godzinę" })).toBeInTheDocument();
    rerender(<DateTimePicker value={null} onChange={vi.fn()} lang="en" />);
    expect(screen.getByRole("button", { name: "Pick date and time" })).toBeInTheDocument();
    rerender(<DateTimePicker value={null} onChange={vi.fn()} placeholder="Bez limitu" />);
    expect(screen.getByRole("button", { name: "Bez limitu" })).toBeInTheDocument();
  });

  it("nieczytelna wartość z bazy daje puste pole zamiast wywracać formularz", () => {
    render(<DateTimePicker value="nie-data" onChange={vi.fn()} lang="pl" />);
    expect(screen.getByRole("button", { name: "Wybierz datę i godzinę" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Wyczyść" })).toBeNull();
  });

  it("formatuje datę po polsku i po angielsku", () => {
    const { rerender } = render(
      <DateTimePicker value="2026-09-24T08:17:00.000Z" onChange={vi.fn()} lang="pl" />,
    );
    expect(screen.getByRole("button", { name: /^24 wrz 2026, \d\d:17$/ })).toBeInTheDocument();
    rerender(<DateTimePicker value="2026-09-24T08:17:00.000Z" onChange={vi.fn()} lang="en" />);
    expect(screen.getByRole("button", { name: /^Sep 24, 2026, \d\d:17$/ })).toBeInTheDocument();
  });

  it("czyszczenie stoi OBOK pola, nie w nim, i ustawia brak wartości", async () => {
    const onChange = vi.fn();
    const { container } = render(
      <DateTimePicker id="start" value="2026-09-24T08:17:00.000Z" onChange={onChange} lang="pl" />,
    );
    const pole = container.querySelector<HTMLButtonElement>("#start") as HTMLButtonElement;
    const wyczysc = screen.getByRole("button", { name: "Wyczyść" });
    expect(pole.contains(wyczysc)).toBe(false);
    expect(pole.parentElement?.contains(wyczysc)).toBe(true);
    expect(pole).toHaveAccessibleName(/^24 wrz 2026/);
    expect(pole).not.toHaveAccessibleName(/Wyczyść/);
    const naruszenia = await axeViolations(container);
    expect(naruszenia, summarize(naruszenia)).toEqual([]);
    fireEvent.click(wyczysc);
    expect(onChange).toHaveBeenCalledWith(null);
    // Klik w czyszczenie nie otwiera kalendarza.
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("własna etykieta czyszczenia trafia na krzyżyk i do stopki kalendarza", () => {
    render(
      <DateTimePicker
        value="2026-09-24T08:17:00.000Z"
        onChange={vi.fn()}
        lang="en"
        clearLabel="Remove limit"
      />,
    );
    expect(screen.getByRole("button", { name: "Remove limit" })).toBeInTheDocument();
    otworz(/Sep 24, 2026/);
    expect(
      within(screen.getByRole("dialog")).getByRole("button", { name: "Remove limit" }),
    ).toBeTruthy();
  });

  it("zablokowane pole blokuje też czyszczenie", () => {
    const onChange = vi.fn();
    render(
      <DateTimePicker value="2026-09-24T08:17:00.000Z" onChange={onChange} lang="pl" disabled />,
    );
    expect(screen.getByRole("button", { name: /24 wrz 2026/ })).toBeDisabled();
    const wyczysc = screen.getByRole("button", { name: "Wyczyść" });
    expect(wyczysc).toBeDisabled();
    fireEvent.click(wyczysc);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("błąd rodzica trafia na pole razem z opisem", () => {
    render(
      <>
        <DateTimePicker
          id="koniec"
          value={null}
          onChange={vi.fn()}
          aria-invalid
          aria-describedby="koniec-blad"
        />
        <p id="koniec-blad">Koniec przed początkiem</p>
      </>,
    );
    const pole = screen.getByRole("button", { name: "Wybierz datę i godzinę" });
    expect(pole).toHaveAttribute("id", "koniec");
    expect(pole).toHaveAttribute("aria-invalid", "true");
    expect(pole).toHaveAccessibleDescription("Koniec przed początkiem");
  });
});

describe("DateTimePicker - kalendarz i godzina", () => {
  it("ognisko po otwarciu trafia do siatki dni, nie na nawigację miesiąca", () => {
    render(<DateTimePicker value="2026-09-24T08:15:00.000Z" onChange={vi.fn()} lang="pl" />);
    otworz(/24 wrz 2026/);
    const aktywny = document.activeElement as HTMLElement;
    expect(aktywny.dataset.day).toBeDefined();
    expect(aktywny).toHaveAccessibleName(/24 września 2026/);
  });

  it("wybór dnia zachowuje godzinę i minutę i zapisuje ISO w UTC", () => {
    const onChange = vi.fn();
    render(<DateTimePicker value="2026-09-24T08:15:00.000Z" onChange={onChange} lang="pl" />);
    const przed = new Date("2026-09-24T08:15:00.000Z");
    otworz(/24 wrz 2026/);
    fireEvent.click(screen.getByRole("button", { name: /10 września 2026/ }));
    const iso = ostatniaWartosc(onChange) as string;
    expect(iso).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:00\.000Z$/);
    const po = new Date(iso);
    expect(po.getDate()).toBe(10);
    expect(po.getHours()).toBe(przed.getHours());
    expect(po.getMinutes()).toBe(15);
  });

  it("wybór dnia bez wartości bierze godzinę z bieżącej chwili", () => {
    const onChange = vi.fn();
    render(<DateTimePicker value={null} onChange={onChange} lang="pl" />);
    otworz("Wybierz datę i godzinę");
    fireEvent.click(screen.getByRole("button", { name: /10 września 2026/ }));
    const po = new Date(ostatniaWartosc(onChange) as string);
    const teraz = new Date();
    expect(po.getDate()).toBe(10);
    expect(po.getHours()).toBe(teraz.getHours());
    expect(po.getSeconds()).toBe(0);
  });

  it("ponowny klik w wybrany dzień niczego nie zapisuje", () => {
    const onChange = vi.fn();
    render(<DateTimePicker value="2026-09-24T08:15:00.000Z" onChange={onChange} lang="pl" />);
    otworz(/24 wrz 2026/);
    fireEvent.click(screen.getByRole("button", { name: /24 września 2026/ }));
    expect(onChange).not.toHaveBeenCalled();
  });

  it("dni przed datą minimalną są niedostępne", () => {
    render(
      <DateTimePicker value={null} onChange={vi.fn()} lang="pl" minDate={new Date(2026, 8, 20)} />,
    );
    otworz("Wybierz datę i godzinę");
    expect(screen.getByRole("button", { name: /19 września 2026/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: /21 września 2026/ })).not.toBeDisabled();
  });

  it("„Teraz” zapisuje bieżącą chwilę bez sekund", () => {
    const onChange = vi.fn();
    render(<DateTimePicker value={null} onChange={onChange} lang="pl" />);
    otworz("Wybierz datę i godzinę");
    fireEvent.click(screen.getByRole("button", { name: "Teraz" }));
    const iso = ostatniaWartosc(onChange) as string;
    const oczekiwane = new Date();
    oczekiwane.setSeconds(0, 0);
    expect(iso).toBe(oczekiwane.toISOString());
  });

  it("stopka po angielsku i czyszczenie ze stopki tylko przy ustawionej wartości", () => {
    const onChange = vi.fn();
    const { rerender } = render(<DateTimePicker value={null} onChange={onChange} lang="en" />);
    otworz("Pick date and time");
    const okno = () => screen.getByRole("dialog");
    expect(within(okno()).getByRole("button", { name: "Now" })).toBeTruthy();
    expect(within(okno()).queryByRole("button", { name: "Clear" })).toBeNull();
    expect(within(okno()).getByRole("group", { name: "Time" })).toBeTruthy();
    rerender(<DateTimePicker value="2026-09-24T08:15:00.000Z" onChange={onChange} lang="en" />);
    fireEvent.click(within(okno()).getByRole("button", { name: "Clear" }));
    expect(onChange).toHaveBeenLastCalledWith(null);
  });

  it("godzina wybrana bez daty ustawia dzisiejszą datę", () => {
    const onChange = vi.fn();
    render(<DateTimePicker value={null} onChange={onChange} lang="pl" />);
    otworz("Wybierz datę i godzinę");
    fireEvent.click(screen.getByRole("combobox", { name: "Godzina" }));
    fireEvent.click(screen.getByRole("option", { name: "07" }));
    const po = new Date(ostatniaWartosc(onChange) as string);
    expect(po.getDate()).toBe(new Date().getDate());
    expect(po.getHours()).toBe(7);
    expect(po.getMinutes()).toBe(0);
  });
});
