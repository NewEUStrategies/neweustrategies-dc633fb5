// WKLEJENIE ARKUSZA DO POLA TEKSTOWEGO DANYCH WIDGETU (kontrakt PR2,
// „DataGrid behaviour" 5): zakres z Excela, Arkuszy Google albo LibreOffice
// zamienia się na format średnikowy z KROPKĄ dziesiętną, który czyta
// `csv.ts` (bez zmiany jego gramatyki), a zwykły tekst wkleja się po staremu.
import { describe, expect, it } from "vitest";
import { parseChartData, parseMapData } from "@/lib/charts/csv";
import { buildCountryIndex } from "@/lib/charts/importTable";
import { clipboardToChartText, clipboardToMapText } from "../textareaPaste";

describe("pole danych wykresu", () => {
  it("TSV z polskim przecinkiem dziesiętnym daje średniki i kropkę", () => {
    const wynik = clipboardToChartText({
      text: "\tEksport\tImport\n2023\t12,5\t8\n2024\t1 234,5\t9",
    });
    expect(wynik?.text).toBe("; Eksport; Import\n2023; 12.5; 8\n2024; 1234.5; 9");
    // Tekst czyta parser strony bez zmian - te same liczby.
    const dane = parseChartData(wynik?.text ?? "");
    expect(dane.series[0].values).toEqual([12.5, 1234.5]);
  });

  it("tabela HTML z Excela bierze surowe wartości komórek", () => {
    const html =
      '<table><tr><td></td><td>A</td></tr><tr><td>2024</td><td x:num="0.125" style="mso-number-format:Percent">12,5%</td></tr></table>';
    const wynik = clipboardToChartText({ html, text: "\tA\n2024\t12,5%" });
    expect(wynik?.text).toBe("; A\n2024; 12.5");
  });

  it("zwykły tekst - także gotowy format średnikowy - wkleja się po staremu", () => {
    expect(clipboardToChartText({ text: "; A; B\n2024; 1; 2" })).toBeNull();
    expect(clipboardToChartText({ text: "12,5" })).toBeNull();
  });

  it("obcięcie i komórki nieliczbowe wracają jako problemy", () => {
    const wynik = clipboardToChartText({ text: "\tA\n2024\tabc" });
    expect(wynik?.problems).toContainEqual({ code: "nonNumericCells", count: 1 });
  });
});

describe("pole danych mapy", () => {
  it("nazwy krajów rozwiązuje skorowidz regionu, liczby idą z kropką", () => {
    const index = buildCountryIndex([
      { id: "PL", pl: "Polska", en: "Poland" },
      { id: "DE", pl: "Niemcy", en: "Germany" },
    ]);
    const wynik = clipboardToMapText({ text: "Kraj\tWartość\nPolska\t12,5\nGermany\t3" }, index);
    expect(wynik?.text).toBe("PL; 12.5\nDE; 3");
    expect(parseMapData(wynik?.text ?? "")).toEqual([
      { id: "PL", value: 12.5 },
      { id: "DE", value: 3 },
    ]);
  });
});
