// Arkusz danych wykresu: siatka „jak w Excelu” + podgląd na żywo.
//
// Ten dialog jest jedynym miejscem, w którym redakcja wpisuje liczby do
// wykresu, więc test pilnuje trzech rzeczy naraz:
//
//  1. TŁUMACZENIE CSV <-> SIATKA w obie strony. Format widgetu to
//     „; Seria A; Seria B\n2024; 12; 8”. Zgubiony średnik albo przesunięta
//     kolumna to cudze dane pokazane pod złą serią.
//  2. PARYTET PODGLĄDU. Wykres w arkuszu MUSI dostać te same ustawienia, co
//     kanwa (legenda, siatka, etykiety, skumulowanie, wysokość, jednostka) -
//     inaczej autor akceptuje wygląd, którego czytelnik nie zobaczy. Jedynym
//     świadomym wyjątkiem jest wyłączona animacja wejścia.
//  3. LIMITY I SPÓJNOŚĆ SIATKI. Nie da się usunąć ostatniej serii ani
//     ostatniego wiersza (puste dane wykresu to pusty wykres), a dodawanie
//     zatrzymuje się na limitach `MAX_CATEGORIES` / `MAX_SERIES`.
//
// `Chart` jest atrapą wypisującą otrzymaną konfigurację - silnik wykresów ma
// własne testy, a tutaj sprawdzamy WEJŚCIE, które arkusz mu podaje.
import { describe, it, expect, vi } from "vitest";
import { useState } from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MAX_SERIES } from "@/lib/charts/types";
import { MAX_CATEGORIES } from "@/lib/charts/parse";
import { ChartDataSpreadsheetDialog } from "../ChartDataSpreadsheetDialog";

vi.mock("@/components/charts/Chart", () => ({
  Chart: ({ config, lang }: { config: Record<string, unknown>; lang: string }) => (
    <div data-testid="podglad" data-lang={lang} data-config={JSON.stringify(config)} />
  ),
}));

const CSV = "; Eksport; Import\n2023; 10; 5\n2024; 12; 8";

function renderDialog(
  initial = CSV,
  extra: Partial<{
    kind: string;
    unit: string;
    title: string;
    content: Record<string, unknown>;
  }> = {},
  lang: "pl" | "en" = "pl",
) {
  const onChange = vi.fn();
  function Host() {
    const [value, setValue] = useState(initial);
    return (
      <ChartDataSpreadsheetDialog
        value={value}
        onChange={(next) => {
          onChange(next);
          setValue(next);
        }}
        lang={lang}
        {...extra}
      />
    );
  }
  render(<Host />);
  return { onChange };
}

const openSheet = (label = "Otwórz arkusz") =>
  fireEvent.click(screen.getByRole("button", { name: label }));

/** Komórki liczbowe: pola z wyrównaniem do prawej (kolumny serii). */
const numberCells = (): HTMLInputElement[] =>
  Array.from(document.querySelectorAll<HTMLInputElement>("input.text-right"));

/** Pola nazw kategorii i serii - wszystkie pozostałe pola tekstowe siatki. */
const textCells = (): HTMLInputElement[] =>
  Array.from(document.querySelectorAll<HTMLInputElement>("table input:not(.text-right)"));

const config = (): Record<string, unknown> =>
  JSON.parse(screen.getByTestId("podglad").getAttribute("data-config") ?? "{}");

describe("ChartDataSpreadsheetDialog - wczytanie CSV", () => {
  it("zamknięty pokazuje tylko przycisk otwarcia", () => {
    renderDialog();
    expect(screen.getByRole("button", { name: "Otwórz arkusz" })).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("rozkłada CSV na serie, kategorie i komórki", () => {
    renderDialog();
    openSheet();
    expect(textCells().map((i) => i.value)).toEqual(["Eksport", "Import", "2023", "2024"]);
    expect(numberCells().map((i) => i.value)).toEqual(["10", "5", "12", "8"]);
  });

  it.each([
    ["pusty tekst", ""],
    ["same puste linie", "\n\n   \n"],
  ])("dla wejścia %s tworzy jedną serię i jeden wiersz", (_label, csv) => {
    renderDialog(csv);
    openSheet();
    // Pusty arkusz jest bezużyteczny - startujemy od jednej komórki, żeby
    // redaktor miał gdzie kliknąć.
    expect(textCells().map((i) => i.value)).toEqual(["Seria A", "2024"]);
    expect(numberCells()).toHaveLength(1);
  });

  it("nagłówek bez serii dostaje serię domyślną", () => {
    // Pierwsza niepusta linia jest ZAWSZE nagłówkiem. Linia bez średnika nie
    // wnosi więc żadnej serii - arkusz musi dołożyć jedną, bo inaczej nie ma
    // ani jednej kolumny do wpisania liczb.
    renderDialog("2024");
    openSheet();
    expect(textCells().map((i) => i.value)).toEqual(["Seria A", "2024"]);
  });

  it("sam nagłówek bez wiersza danych dostaje wiersz startowy", () => {
    renderDialog("; Eksport");
    openSheet();
    expect(textCells().map((i) => i.value)).toEqual(["Eksport", "2024"]);
    expect(numberCells().map((i) => i.value)).toEqual([""]);
  });

  it("brakujące komórki w wierszu są puste, nie „undefined”", () => {
    renderDialog("; A; B\n2024; 12");
    openSheet();
    expect(numberCells().map((i) => i.value)).toEqual(["12", ""]);
  });

  it("obcina serie i kategorie do limitów", () => {
    const series = Array.from({ length: MAX_SERIES + 3 }, (_, i) => `S${i}`);
    const rows = Array.from({ length: MAX_CATEGORIES + 5 }, (_, i) => `R${i}; 1`);
    renderDialog(["", ...series].join("; ") + "\n" + rows.join("\n"));
    openSheet();
    const headers = document.querySelectorAll("thead th");
    // Dwie kolumny stałe (#, kategoria) + limit serii.
    expect(headers).toHaveLength(MAX_SERIES + 2);
    expect(document.querySelectorAll("tbody tr")).toHaveLength(MAX_CATEGORIES);
  });

  it("radzi sobie z końcami linii Windows", () => {
    renderDialog("; A\r\n2024; 7\r\n");
    openSheet();
    expect(numberCells().map((i) => i.value)).toEqual(["7"]);
  });

  it("ponowne otwarcie wczytuje wartość z zewnątrz", () => {
    renderDialog();
    openSheet();
    fireEvent.click(screen.getByRole("button", { name: "Zamknij" }));
    openSheet();
    // Rehydracja przy otwarciu - inaczej arkusz pokazywałby stan z poprzedniej
    // sesji edycji, mimo że treść widgetu zmieniła się w innym polu.
    expect(numberCells().map((i) => i.value)).toEqual(["10", "5", "12", "8"]);
  });
});

describe("ChartDataSpreadsheetDialog - edycja i zapis", () => {
  it("zmiana komórki propaguje CSV po debounce", async () => {
    const { onChange } = renderDialog();
    openSheet();
    fireEvent.change(numberCells()[0], { target: { value: "99" } });
    // Status „synchronizacja” pojawia się natychmiast, zapis po debounce.
    expect(screen.getByRole("status").textContent).toContain("Synchronizacja");
    await waitFor(() =>
      expect(onChange).toHaveBeenCalledWith("; Eksport; Import\n2023; 99; 5\n2024; 12; 8"),
    );
    await waitFor(() =>
      expect(screen.getByRole("status").textContent).toContain("Zsynchronizowano"),
    );
  });

  it("zmiana nazwy kategorii i serii trafia do CSV", async () => {
    const { onChange } = renderDialog();
    openSheet();
    fireEvent.change(textCells()[0], { target: { value: "Wywóz" } });
    await waitFor(() => expect(onChange).toHaveBeenCalled());
    expect(onChange.mock.calls.at(-1)?.[0]).toContain("; Wywóz; Import");
    fireEvent.change(textCells()[2], { target: { value: "2022" } });
    await waitFor(() => expect(onChange.mock.calls.at(-1)?.[0]).toContain("2022; 10; 5"));
  });

  it("zapisz i zamknij zapisuje ostatnią edycję bez czekania na debounce", () => {
    const { onChange } = renderDialog();
    openSheet();
    fireEvent.change(numberCells()[0], { target: { value: "42" } });
    fireEvent.click(screen.getByRole("button", { name: "Zapisz i zamknij" }));
    // Klik w „Zapisz” w oknie debounce nie może zgubić wpisu.
    expect(onChange).toHaveBeenLastCalledWith("; Eksport; Import\n2023; 42; 5\n2024; 12; 8");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("zapisz bez zmian nie wywołuje zapisu", () => {
    const { onChange } = renderDialog();
    openSheet();
    fireEvent.click(screen.getByRole("button", { name: "Zapisz i zamknij" }));
    expect(onChange).not.toHaveBeenCalled();
  });

  it("przywrócenie cofa edycję jeszcze niezsynchronizowaną", () => {
    renderDialog();
    openSheet();
    fireEvent.change(numberCells()[0], { target: { value: "1" } });
    fireEvent.click(screen.getByRole("button", { name: "Przywróć" }));
    expect(numberCells().map((i) => i.value)).toEqual(["10", "5", "12", "8"]);
  });

  // BŁĄD PRODUKCYJNY (udokumentowany, nienaprawiony w tym etapie).
  // „Przywróć” czyta `initialRef`, a ten jest NADPISYWANY przez efekt
  // rehydracji `[open, value]` - a `value` zmienia się przy każdej
  // synchronizacji na żywo (debounce 150 ms). Skutek: po pierwszej
  // zsynchronizowanej edycji „Przywróć” cofa do stanu SPRZED chwili, nie do
  // stanu z otwarcia arkusza - czyli praktycznie nie robi nic. Poprawka to
  // rehydracja wyłącznie na ZMIANĘ `open` (albo pominięcie wartości, którą
  // arkusz sam wysłał). Zmiany produkcyjnej w etapie testowym nie robię.
  it.fails("przywrócenie wraca do stanu z OTWARCIA arkusza", async () => {
    const { onChange } = renderDialog();
    openSheet();
    fireEvent.change(numberCells()[0], { target: { value: "1" } });
    await waitFor(() => expect(onChange).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: "Przywróć" }));
    expect(numberCells().map((i) => i.value)).toEqual(["10", "5", "12", "8"]);
  });

  it("po synchronizacji przywrócenie nie cofa już edycji - stan faktyczny", async () => {
    const { onChange } = renderDialog();
    openSheet();
    fireEvent.change(numberCells()[0], { target: { value: "1" } });
    await waitFor(() => expect(onChange).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: "Przywróć" }));
    expect(numberCells().map((i) => i.value)).toEqual(["1", "5", "12", "8"]);
  });
});

describe("ChartDataSpreadsheetDialog - struktura siatki", () => {
  it("dodaje wiersz z pustymi komórkami dla każdej serii", () => {
    renderDialog();
    openSheet();
    fireEvent.click(screen.getByRole("button", { name: "Dodaj wiersz" }));
    expect(document.querySelectorAll("tbody tr")).toHaveLength(3);
    expect(
      numberCells()
        .slice(-2)
        .map((i) => i.value),
    ).toEqual(["", ""]);
  });

  it("dodaje serię z kolejną literą i pustą kolumną", () => {
    renderDialog("; Eksport\n2024; 3");
    openSheet();
    fireEvent.click(screen.getByRole("button", { name: "Dodaj serię" }));
    expect(textCells()[1].value).toBe("Seria B");
    expect(numberCells().map((i) => i.value)).toEqual(["3", ""]);
  });

  it("usuwa wskazany wiersz", () => {
    renderDialog();
    openSheet();
    fireEvent.click(screen.getAllByLabelText("Usuń wiersz")[0]);
    expect(document.querySelectorAll("tbody tr")).toHaveLength(1);
    expect(numberCells().map((i) => i.value)).toEqual(["12", "8"]);
  });

  it("usuwa wskazaną serię wraz z jej kolumną", () => {
    renderDialog();
    openSheet();
    fireEvent.click(screen.getAllByLabelText("Usuń serię")[0]);
    expect(numberCells().map((i) => i.value)).toEqual(["5", "8"]);
  });

  it("nie pozwala usunąć ostatniego wiersza ani ostatniej serii", () => {
    renderDialog("; A\n2024; 1");
    openSheet();
    // Wykres bez serii i bez kategorii to pusty wykres - przyciski są
    // wyłączone, a nie „miękko ignorowane”.
    expect(screen.getByLabelText("Usuń wiersz")).toBeDisabled();
    expect(screen.getByLabelText("Usuń serię")).toBeDisabled();
  });

  it("dodawanie zatrzymuje się na limicie serii", () => {
    const series = Array.from({ length: MAX_SERIES }, (_, i) => `S${i}`);
    renderDialog(["", ...series].join("; ") + "\n2024; 1");
    openSheet();
    expect(screen.getByRole("button", { name: "Dodaj serię" })).toBeDisabled();
  });

  it("dodawanie zatrzymuje się na limicie kategorii", () => {
    const rows = Array.from({ length: MAX_CATEGORIES }, (_, i) => `R${i}; 1`);
    renderDialog("; A\n" + rows.join("\n"));
    openSheet();
    expect(screen.getByRole("button", { name: "Dodaj wiersz" })).toBeDisabled();
  });

  it("stopka podaje oba limity", () => {
    renderDialog();
    openSheet();
    expect(screen.getByText(`Limit: ${MAX_CATEGORIES} · Limit: ${MAX_SERIES}`)).toBeInTheDocument();
  });
});

describe("ChartDataSpreadsheetDialog - podgląd", () => {
  it("podgląd dostaje serie i kategorie z siatki", () => {
    renderDialog(CSV, { kind: "line", unit: "mld €", title: "Handel" });
    openSheet();
    const c = config();
    expect(c.kind).toBe("line");
    expect(c.unit).toBe("mld €");
    expect(c.title).toBe("Handel");
    expect(c.categories).toEqual(["2023", "2024"]);
    expect((c.series as Array<{ name: string }>).map((s) => s.name)).toEqual(["Eksport", "Import"]);
  });

  it("nieznany rodzaj wykresu spada na słupkowy", () => {
    renderDialog(CSV, { kind: "nie-ma-takiego" });
    openSheet();
    expect(config().kind).toBe("bar");
  });

  it("brak rodzaju też daje słupkowy", () => {
    renderDialog(CSV);
    openSheet();
    expect(config().kind).toBe("bar");
    expect(config().unit).toBe("");
    expect(config().title).toBe("");
  });

  it("podgląd czyta ustawienia wyglądu z treści widgetu", () => {
    renderDialog(CSV, {
      content: { stacked: true, showLegend: false, showGrid: false, showValues: true, height: 480 },
    });
    openSheet();
    const c = config();
    expect(c.stacked).toBe(true);
    expect(c.showLegend).toBe(false);
    expect(c.showGrid).toBe(false);
    expect(c.showValues).toBe(true);
    expect(c.height).toBe(480);
  });

  it("bez treści widgetu podgląd używa wartości domyślnych wykresu", () => {
    renderDialog(CSV);
    openSheet();
    const c = config();
    expect(c.stacked).toBe(false);
    expect(c.showLegend).toBe(true);
    expect(c.showGrid).toBe(true);
    expect(c.showValues).toBe(false);
    expect(c.height).toBe(320);
  });

  it.each([
    ["powyżej zakresu", 5000, 640],
    ["poniżej zakresu", 10, 160],
    ["nieliczbowa", "wysoko", 320],
  ])("wysokość %s jest przycinana do zakresu wykresu", (_label, height, expected) => {
    renderDialog(CSV, { content: { height } });
    openSheet();
    expect(config().height).toBe(expected);
  });

  it("animacja wejścia jest w podglądzie wyłączona", () => {
    renderDialog(CSV);
    openSheet();
    // Jedyne świadome odstępstwo od parytetu z kanwą: animacja odpalana na
    // każde naciśnięcie klawisza byłaby migotaniem, nie podglądem.
    expect(config().animate).toBe(false);
  });

  it("podgląd odświeża się po edycji komórki", () => {
    renderDialog();
    openSheet();
    fireEvent.change(numberCells()[0], { target: { value: "77" } });
    const series = config().series as Array<{ values: number[] }>;
    expect(series[0].values[0]).toBe(77);
  });

  it("podgląd dostaje język panelu", () => {
    renderDialog(CSV, {}, "en");
    fireEvent.click(screen.getByRole("button", { name: "Open spreadsheet" }));
    expect(screen.getByTestId("podglad").dataset.lang).toBe("en");
  });
});

describe("ChartDataSpreadsheetDialog - język interfejsu", () => {
  it("angielski panel ma angielskie napisy", () => {
    renderDialog(CSV, {}, "en");
    fireEvent.click(screen.getByRole("button", { name: "Open spreadsheet" }));
    expect(screen.getByText("Chart data spreadsheet")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add row" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save & close" })).toBeInTheDocument();
    expect(screen.getByRole("status").textContent).toContain("In sync");
  });

  it("polski panel ma polskie napisy", () => {
    renderDialog();
    openSheet();
    expect(screen.getByText("Arkusz danych wykresu")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Dodaj serię" })).toBeInTheDocument();
  });
});
