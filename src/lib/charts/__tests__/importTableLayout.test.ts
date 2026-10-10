// UKŁAD TABELI: nagłówek, orientacja, konwencja liczb, kolory i mapa.
//
// Do 2026-10 import zakładał JEDEN układ: pierwszy wiersz to nazwy serii,
// pierwsza kolumna to kategorie, druga kolumna mapy to wartość. Każda tabela
// spoza tego układu wchodziła po cichu źle: wiersz danych stawał się nazwami
// serii („120", „80"), tabela Eurostatu (kraje w wierszach, lata w kolumnach)
// rysowała lata jako serie, a kolejne lata na mapie znikały bez śladu.
//
// Ten plik pilnuje, że:
//   1. bez `opts` `tableToChartData` zachowuje się DOKŁADNIE jak dotąd (stare
//      wywołania w edytorach nie zmieniają wyniku),
//   2. rozpoznanie układu jest domyślnym położeniem przełączników, a decyzja
//      podjęta automatycznie, która zmienia nazwy serii, jest zgłaszana,
//   3. ponowny import nie przemalowuje serii, które redaktor już pokolorował,
//   4. mapa rozpoznaje aliasy krajów i zgłasza każdą kolumnę, której nie użyła.
import { describe, expect, it } from "vitest";
import {
  analyseTable,
  buildCountryIndex,
  columnLetter,
  isPeriodLabel,
  mergeSeriesColors,
  rectangularTable,
  resolveCountryLabel,
  tableToChartData,
  tableToMapValues,
  transposeTable,
} from "@/lib/charts/importTable";
import { SLOT_SEQUENCE, slotForSeries } from "@/lib/charts/palette";
import type { ChartSeries } from "@/lib/charts/types";

const EUROSTAT = [
  ["", "2019", "2020", "2021"],
  ["PL", "1,5", "2,5", "3,5"],
  ["DE", "4,5", "5,5", "6,5"],
];

describe("analyseTable - nagłówek", () => {
  it("wiersz etykiet jest nagłówkiem", () => {
    expect(
      analyseTable([
        ["", "Eksport", "Import"],
        ["2021", "120", "80"],
      ]).headerRow,
    ).toBe(true);
  });

  it("wiersz liczb z kategorią w pierwszej komórce jest DANĄ", () => {
    // Regresja: ten kształt robił serie „120" i „80" i gubił rok 2021.
    const t = [
      ["2021", "120", "80"],
      ["2022", "150", "95"],
    ];
    expect(analyseTable(t).headerRow).toBe(false);
  });

  it("liczby pod pustym narożnikiem i lata pod tekstowym narożnikiem to nagłówek", () => {
    expect(analyseTable(EUROSTAT).headerRow).toBe(true);
    expect(
      analyseTable([
        ["Kraj", "2019", "2020"],
        ["PL", "1", "2"],
      ]).headerRow,
    ).toBe(true);
  });

  it("kraj z liczbami w pierwszym wierszu to dana, nie nagłówek", () => {
    expect(
      analyseTable([
        ["PL", "1", "2"],
        ["DE", "3", "4"],
      ]).headerRow,
    ).toBe(false);
  });

  it("tabela jednokolumnowa: tekst nad liczbami to nagłówek", () => {
    expect(analyseTable([["Wartość"], ["1,5"], ["2,5"]]).headerRow).toBe(true);
    expect(analyseTable([["1,5"], ["2,5"]]).headerRow).toBe(false);
  });

  it("pusta tabela nie ma nagłówka", () => {
    expect(analyseTable([])).toEqual({ headerRow: false, seriesInRows: false, numberLocale: "pl" });
  });
});

describe("analyseTable - orientacja serii", () => {
  it("lata w nagłówku i kraje w pierwszej kolumnie to serie w wierszach", () => {
    expect(analyseTable(EUROSTAT).seriesInRows).toBe(true);
  });

  it("zwykła tabela wykresu (lata w wierszach) nie jest obracana", () => {
    const t = [
      ["", "Eksport", "Import"],
      ["2021", "120", "80"],
      ["2022", "150", "95"],
    ];
    expect(analyseTable(t).seriesInRows).toBe(false);
  });

  it("tabela, która mieści się w limitach tylko po obróceniu, jest obracana", () => {
    const wide = [
      ["", ...Array.from({ length: 15 }, (_, i) => `K${i}`)],
      ["A", ...Array.from({ length: 15 }, () => "1")],
    ];
    expect(analyseTable(wide).seriesInRows).toBe(true);
  });

  it("okresy rozpoznaje w zapisach Eurostatu, GUS i arkuszy", () => {
    for (const okres of ["2024", "2024Q1", "2024-K1", "Q1 2024", "2024M01", "2024-01", "01.2024"]) {
      expect(isPeriodLabel(okres), okres).toBe(true);
    }
    for (const obcy of ["PL", "120", "1,5", "Polska", "3000"]) {
      expect(isPeriodLabel(obcy), obcy).toBe(false);
    }
  });
});

describe("analyseTable - konwencja liczb", () => {
  it("polski ułamek przesądza o konwencji pl", () => {
    expect(analyseTable(EUROSTAT).numberLocale).toBe("pl");
  });

  it("angielski ułamek przesądza o konwencji en", () => {
    expect(
      analyseTable([
        ["", "A"],
        ["x", "3.5"],
        ["y", "1,234"],
      ]).numberLocale,
    ).toBe("en");
  });

  it("same zapisy dwuznaczne to „ambiguous”", () => {
    expect(
      analyseTable([
        ["", "A"],
        ["x", "1,234"],
        ["y", "2,345"],
      ]).numberLocale,
    ).toBe("ambiguous");
  });

  it("bez rozdzielaczy - konwencja domowa, która niczego nie zmienia", () => {
    expect(
      analyseTable([
        ["", "A"],
        ["x", "12"],
      ]).numberLocale,
    ).toBe("pl");
  });
});

describe("tableToChartData - wybory układu", () => {
  it("bez opts: zastany układ, bez rozpoznania i bez nowych zgłoszeń", () => {
    const t = [
      ["2021", "120", "80"],
      ["2022", "150", "95"],
    ];
    const out = tableToChartData(t);
    expect(out.series.map((s) => s.name)).toEqual(["120", "80"]);
    expect(out.categories).toEqual(["2022"]);
    expect(out.problems).toEqual([]);
  });

  it("z opts: brak nagłówka rozpoznany, serie ponumerowane i ZGŁOSZONE", () => {
    const out = tableToChartData(
      [
        ["2021", "120", "80"],
        ["2022", "150", "95"],
      ],
      {},
    );
    expect(out.categories).toEqual(["2021", "2022"]);
    expect(out.series.map((s) => s.name)).toEqual(["1", "2"]);
    expect(out.series[0].values).toEqual([120, 150]);
    expect(out.problems).toContainEqual({ code: "headerAssumed" });
  });

  it("nagłówek wybrany jawnie nie jest zgłaszany", () => {
    const out = tableToChartData([["2021", "120", "80"]], { header: false });
    expect(out.categories).toEqual(["2021"]);
    expect(out.problems).toEqual([]);
  });

  it("tabela Eurostatu obraca się sama: lata to kategorie, kraje to serie", () => {
    const out = tableToChartData(EUROSTAT, {});
    expect(out.categories).toEqual(["2019", "2020", "2021"]);
    expect(out.series.map((s) => s.name)).toEqual(["PL", "DE"]);
    expect(out.series[0].values).toEqual([1.5, 2.5, 3.5]);
    expect(out.series[1].values).toEqual([4.5, 5.5, 6.5]);
    expect(out.problems).toEqual([]);
  });

  it("obrót wyłączony jawnie zostawia kraje jako kategorie", () => {
    const out = tableToChartData(EUROSTAT, { transpose: false });
    expect(out.categories).toEqual(["PL", "DE"]);
    expect(out.series.map((s) => s.name)).toEqual(["2019", "2020", "2021"]);
  });

  it("obrót bez nagłówka: kategorie z numerów, każdy wiersz jest serią", () => {
    const out = tableToChartData(
      [
        ["PL", "1", "2"],
        ["DE", "3", "4"],
      ],
      { header: false, transpose: true },
    );
    expect(out.categories).toEqual(["1", "2"]);
    expect(out.series.map((s) => s.name)).toEqual(["PL", "DE"]);
    expect(out.series[1].values).toEqual([3, 4]);
  });

  it("konwencja rozpoznana: angielski ułamek czyni „1,234” tysiącem", () => {
    const out = tableToChartData(
      [
        ["", "A"],
        ["x", "1,234"],
        ["y", "3.5"],
      ],
      {},
    );
    expect(out.series[0].values).toEqual([1234, 3.5]);
    expect(out.problems).toEqual([]);
  });

  it("konwencja nierozstrzygnięta: reguła zastana i zgłoszenie z liczbą komórek", () => {
    const out = tableToChartData(
      [
        ["", "A"],
        ["x", "1,234"],
        ["y", "2,345"],
        ["z", "7"],
      ],
      {},
    );
    expect(out.series[0].values).toEqual([1.234, 2.345, 7]);
    expect(out.problems).toContainEqual({ code: "localeAmbiguous", count: 2 });
  });

  it("konwencja wybrana jawnie wygrywa i nie jest zgłaszana", () => {
    const out = tableToChartData(
      [
        ["", "A"],
        ["x", "1,234"],
      ],
      { locale: "en" },
    );
    expect(out.series[0].values).toEqual([1234]);
    expect(out.problems).toEqual([]);
  });

  it("flagi Eurostatu są liczone, a „:” jest luką, nie błędem", () => {
    const out = tableToChartData([
      ["", "A"],
      ["2021", "12.5 p"],
      ["2022", ":"],
      ["2023", "b.d."],
    ]);
    expect(out.series[0].values).toEqual([12.5, null, null]);
    expect(out.problems).toContainEqual({ code: "dataFlags", count: 1 });
    expect(out.problems).toContainEqual({ code: "nonNumericCells", count: 1 });
  });

  it("tabela nierówna jest dociągana do prostokąta - nic nie ginie za nagłówkiem", () => {
    const out = tableToChartData(
      [
        ["", "A"],
        ["x", "1", "2"],
      ],
      {},
    );
    expect(out.series).toHaveLength(2);
    expect(out.series[1].values).toEqual([2]);
  });
});

describe("mergeSeriesColors - kolor idzie za serią", () => {
  const prev: ChartSeries[] = [
    { name: "Eksport", values: [], colorSlot: 14 },
    { name: "Import", values: [], colorSlot: 20 },
  ];
  const seria = (name: string, i: number): ChartSeries => ({
    name,
    values: [],
    colorSlot: slotForSeries(i),
  });

  it("po nazwie, bez względu na kolejność, wielkość liter i spacje", () => {
    const out = mergeSeriesColors([seria(" import ", 0), seria("EKSPORT", 1)], prev);
    expect(out.map((s) => s.colorSlot)).toEqual([20, 14]);
  });

  it("po pozycji, gdy seria zmieniła nazwę", () => {
    const out = mergeSeriesColors([seria("Eksport netto", 0), seria("Import", 1)], prev);
    expect(out.map((s) => s.colorSlot)).toEqual([14, 20]);
  });

  it("nowa seria dostaje slot, którego nie ma żadna zachowana", () => {
    const zajety: ChartSeries[] = [{ name: "A", values: [], colorSlot: slotForSeries(1) }];
    const out = mergeSeriesColors([seria("A", 0), seria("B", 1)], zajety);
    expect(out[0].colorSlot).toBe(slotForSeries(1));
    expect(out[1].colorSlot).not.toBe(slotForSeries(1));
    expect(SLOT_SEQUENCE).toContain(out[1].colorSlot);
  });

  it("pozycja zabrana przez dopasowanie nazwy nie oddaje koloru drugi raz", () => {
    // „Import" zabiera kolor 20 po nazwie; nowa seria na pozycji 1 NIE może
    // dostać tego samego koloru z pozycji.
    const out = mergeSeriesColors([seria("Import", 0), seria("Nowa", 1)], prev);
    expect(out[0].colorSlot).toBe(20);
    expect(out[1].colorSlot).not.toBe(20);
  });

  it("nie zmienia wejścia", () => {
    const next = [seria("Eksport", 0)];
    mergeSeriesColors(next, prev);
    expect(next[0].colorSlot).toBe(slotForSeries(0));
  });
});

describe("tabela -> mapa: kolumny, nagłówek i aliasy", () => {
  const indeks = buildCountryIndex([
    { id: "PL", pl: "Polska", en: "Poland" },
    { id: "DE", pl: "Niemcy", en: "Germany" },
    { id: "CZ", pl: "Czechy", en: "Czech Republic" },
    { id: "NL", pl: "Holandia", en: "Netherlands" },
    { id: "GR", pl: "Grecja", en: "Greece" },
    { id: "GB", pl: "Wielka Brytania", en: "United Kingdom" },
    { id: "BA", pl: "Bośnia i Hercegowina", en: "Bosnia and Herzegovina" },
    { id: "MK", pl: "Macedonia Północna", en: "The Republic of North Macedonia" },
  ]);

  it("wybrana kolumna wartości, a pozostałe kolumny z liczbami są ZGŁOSZONE", () => {
    const out = tableToMapValues(
      [
        ["Kraj", "2019", "2020", "Uwagi"],
        ["PL", "1", "2", "x"],
        ["DE", "3", "4", ""],
      ],
      indeks,
      { valueColumn: 2 },
    );
    expect(out.values).toEqual([
      { id: "PL", value: 2 },
      { id: "DE", value: 4 },
    ]);
    expect(out.problems).toContainEqual({ code: "columnsIgnored", labels: ["2019"] });
  });

  it("wywołanie zastane też zgłasza kolumny, których nie użyło", () => {
    const out = tableToMapValues(
      [
        ["PL", "1", "2"],
        ["DE", "3", "4"],
      ],
      indeks,
    );
    expect(out.values.map((v) => v.value)).toEqual([1, 3]);
    expect(out.problems).toEqual([{ code: "columnsIgnored", labels: ["C"] }]);
  });

  it("nagłówek z latami jest nagłówkiem, a nie nieznanym krajem „Kraj”", () => {
    const out = tableToMapValues(
      [
        ["Kraj", "2019"],
        ["PL", "1"],
      ],
      indeks,
    );
    expect(out.values).toEqual([{ id: "PL", value: 1 }]);
    expect(out.problems).toEqual([]);
  });

  it("nagłówek wymuszony jawnie", () => {
    const zNaglowkiem = tableToMapValues(
      [
        ["PL", "1"],
        ["DE", "2"],
      ],
      indeks,
      { header: true },
    );
    expect(zNaglowkiem.values).toEqual([{ id: "DE", value: 2 }]);
    const bez = tableToMapValues(
      [
        ["Kraj", "Wartość"],
        ["PL", "1"],
      ],
      indeks,
      { header: false },
    );
    expect(bez.problems).toContainEqual({ code: "unknownCountries", labels: ["Kraj"] });
  });

  it("ISO-3, kody Eurostatu i nazwy zastępcze trafiają - i są ZGŁOSZONE", () => {
    const out = tableToMapValues(
      [
        ["POL", "1"],
        ["Czechia", "2"],
        ["EL", "3"],
        ["UK", "4"],
        ["Holland", "5"],
      ],
      indeks,
    );
    expect(out.values.map((v) => v.id)).toEqual(["PL", "CZ", "GR", "GB", "NL"]);
    expect(out.problems).toEqual([
      {
        code: "aliasesApplied",
        labels: ["POL (PL)", "Czechia (CZ)", "EL (GR)", "UK (GB)", "Holland (NL)"],
      },
    ]);
  });

  it("warianty nazw z zasobu („&”, „The”) trafiają bez zgłoszenia aliasu", () => {
    const out = tableToMapValues(
      [
        ["Bosnia & Herzegovina", "1"],
        ["The Netherlands", "2"],
        ["Republic of North Macedonia", "3"],
      ],
      indeks,
    );
    expect(out.values.map((v) => v.id)).toEqual(["BA", "NL", "MK"]);
    expect(out.problems).toEqual([]);
  });

  it("alias do kraju spoza regionu jest nieznanym krajem", () => {
    const out = tableToMapValues([["JPN", "1"]], indeks);
    expect(out.values).toEqual([]);
    expect(out.problems).toContainEqual({ code: "unknownCountries", labels: ["JPN"] });
  });

  it("bez skorowidza EL i UK idą do GR i GB, a nie jako kody, których mapa nie zna", () => {
    const out = tableToMapValues([
      ["EL", "1"],
      ["UK", "2"],
      ["PL", "3"],
    ]);
    expect(out.values.map((v) => v.id)).toEqual(["GR", "GB", "PL"]);
    expect(out.problems).toEqual([{ code: "aliasesApplied", labels: ["EL (GR)", "UK (GB)"] }]);
  });

  it("ISO-3 i jego ISO-2 w jednej tabeli to duplikat", () => {
    const out = tableToMapValues(
      [
        ["PL", "1"],
        ["POL", "2"],
      ],
      indeks,
    );
    expect(out.values).toEqual([{ id: "PL", value: 1 }]);
    expect(out.problems).toContainEqual({ code: "duplicateCountries", labels: ["POL"] });
  });

  it("flagi Eurostatu w wartościach mapy są liczone", () => {
    const out = tableToMapValues(
      [
        ["PL", "12.5 p"],
        ["DE", "3"],
      ],
      indeks,
    );
    expect(out.values).toEqual([
      { id: "PL", value: 12.5 },
      { id: "DE", value: 3 },
    ]);
    expect(out.problems).toEqual([{ code: "dataFlags", count: 1 }]);
  });

  it("konwencja rozpoznana także dla mapy, gdy podano opts", () => {
    const out = tableToMapValues(
      [
        ["PL", "1,234"],
        ["DE", "3.5"],
      ],
      indeks,
      {},
    );
    expect(out.values.map((v) => v.value)).toEqual([1234, 3.5]);
  });

  it("pojedyncza etykieta rozwiązuje się tymi samymi regułami", () => {
    expect(resolveCountryLabel("POL", indeks)).toEqual({ id: "PL", alias: true });
    expect(resolveCountryLabel("Polska", indeks)).toEqual({ id: "PL", alias: false });
    expect(resolveCountryLabel("Atlantyda", indeks)).toBeNull();
  });
});

describe("narzędzia tabeli", () => {
  it("prostokąt: dociąga i wyrzuca puste wiersze", () => {
    expect(rectangularTable([["a"], [], ["b", "c"]])).toEqual([
      ["a", ""],
      ["b", "c"],
    ]);
  });

  it("transpozycja zamienia wiersze z kolumnami i wraca do punktu wyjścia", () => {
    const t = [
      ["a", "b", "c"],
      ["1", "2", "3"],
    ];
    expect(transposeTable(t)).toEqual([
      ["a", "1"],
      ["b", "2"],
      ["c", "3"],
    ]);
    expect(transposeTable(transposeTable(t))).toEqual(t);
  });

  it("litera kolumny jak w arkuszu", () => {
    expect([0, 1, 25, 26, 27, 701, 702].map(columnLetter)).toEqual([
      "A",
      "B",
      "Z",
      "AA",
      "AB",
      "ZZ",
      "AAA",
    ]);
  });
});
