// IMPORT DANYCH Z PLIKU: co wolno przepuścić, a co MUSI zostać zgłoszone.
//
// Ten plik pilnuje trzech rzeczy, z których każda już raz kogoś kosztowała
// błędny wykres w publikacji:
//   1. liczba z Excela jest czytana w OBU konwencjach rozdzielaczy,
//   2. nic nie znika po cichu - obcięcie serii, nieznany kraj i duplikat
//      wychodzą w `problems`,
//   3. import i textarea rozumieją ten sam napis tak samo.
import { describe, expect, it } from "vitest";
import {
  buildCountryIndex,
  chartDataToText,
  fileExtension,
  isImportableName,
  mapValuesToText,
  normaliseCountryName,
  parseDelimitedText,
  parseImportedNumber,
  sniffDelimiter,
  tableToChartData,
  tableToMapValues,
} from "@/lib/charts/importTable";
import { parseChartData, parseMapData } from "@/lib/charts/csv";
import { MAX_SERIES } from "@/lib/charts/types";
import { MAX_CATEGORIES } from "@/lib/charts/parse";

describe("import - liczby z komórki", () => {
  it("czyta obie konwencje rozdzielaczy na tę samą wartość", () => {
    // To jest sedno: ten sam tysiąc dwieście trzydzieści cztery i pół,
    // zapisany po polsku i po angielsku, MUSI dać tę samą liczbę.
    expect(parseImportedNumber("1.234,5")).toBe(1234.5);
    expect(parseImportedNumber("1,234.5")).toBe(1234.5);
    expect(parseImportedNumber("1 234,5")).toBe(1234.5);
    expect(parseImportedNumber("1 234,5")).toBe(1234.5);
  });

  it("pojedynczy przecinek jest dziesiętny - tak samo jak w textarei", () => {
    expect(parseImportedNumber("12,5")).toBe(12.5);
    // Zgodność z parserem textarei na tym samym napisie: gdyby się rozjechały,
    // import i ręczne wpisanie dawałyby inny wykres z tych samych danych.
    const zTextarei = parseChartData("; A\nX; 12,5").series[0].values[0];
    expect(zTextarei).toBe(parseImportedNumber("12,5"));
  });

  it("znosi zapis księgowy, procent i wykładnik", () => {
    expect(parseImportedNumber("(123)")).toBe(-123);
    expect(parseImportedNumber("45%")).toBe(45); // NIE dzieli przez sto
    expect(parseImportedNumber("1.5e3")).toBe(1500);
    expect(parseImportedNumber("-0,75")).toBe(-0.75);
  });

  it("odrzuca to, co liczbą nie jest", () => {
    for (const obce of ["", "   ", "brak", "12 ludzi", "--", "1.2.3"]) {
      expect(parseImportedNumber(obce), `"${obce}"`).toBeNull();
    }
  });
});

describe("import - tekst rozdzielany", () => {
  it("zgaduje separator POZA cudzysłowami", () => {
    // Przecinek siedzi w nazwie kategorii, ale plik jest średnikowy.
    const text = '"Warszawa, Polska";12\n"Kraków, Polska";8';
    expect(sniffDelimiter(text)).toBe(";");
    const rows = parseDelimitedText(text);
    expect(rows[0][0]).toBe("Warszawa, Polska");
    expect(rows[0][1]).toBe("12");
  });

  it("czyta przecinek, tabulator i podwojony cudzysłów", () => {
    expect(parseDelimitedText("a,b\n1,2")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
    expect(parseDelimitedText("a\tb\n1\t2")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
    expect(parseDelimitedText('"on ""tak"" rzekl";1')[0][0]).toBe('on "tak" rzekl');
  });

  it("zjada BOM i puste wiersze", () => {
    const rows = parseDelimitedText("﻿a;b\n\n1;2\n");
    expect(rows).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });
});

describe("import - tabela na dane wykresu", () => {
  const tabela = [
    ["", "Eksport", "Import"],
    ["2021", "120", "80"],
    ["2022", "150,5", "95"],
  ];

  it("pierwszy wiersz to serie, pierwsza kolumna to kategorie", () => {
    const out = tableToChartData(tabela);
    expect(out.categories).toEqual(["2021", "2022"]);
    expect(out.series.map((s) => s.name)).toEqual(["Eksport", "Import"]);
    expect(out.series[0].values).toEqual([120, 150.5]);
    expect(out.problems).toEqual([]);
  });

  it("każda seria dostaje slot koloru z sekwencji, nie z pozycji", () => {
    const out = tableToChartData(tabela);
    // Sloty muszą być różne - inaczej dwie serie byłyby tego samego koloru.
    expect(new Set(out.series.map((s) => s.colorSlot)).size).toBe(out.series.length);
  });

  it("ZGŁASZA obcięcie serii ponad limit", () => {
    const szeroka = [
      ["", ...Array.from({ length: MAX_SERIES + 3 }, (_, i) => `S${i}`)],
      ["A", ...Array.from({ length: MAX_SERIES + 3 }, () => "1")],
    ];
    const out = tableToChartData(szeroka);
    expect(out.series).toHaveLength(MAX_SERIES);
    expect(out.problems).toContainEqual({ code: "seriesTruncated", dropped: 3 });
  });

  it("ZGŁASZA obcięcie kategorii ponad limit", () => {
    const dluga = [
      ["", "A"],
      ...Array.from({ length: MAX_CATEGORIES + 2 }, (_, i) => [`K${i}`, "1"]),
    ];
    const out = tableToChartData(dluga);
    expect(out.categories).toHaveLength(MAX_CATEGORIES);
    expect(out.problems).toContainEqual({ code: "categoriesTruncated", dropped: 2 });
  });

  it("ZGŁASZA komórki nieliczbowe, a puste traktuje jako lukę", () => {
    const out = tableToChartData([
      ["", "A"],
      ["2021", "brak"],
      ["2022", ""],
    ]);
    expect(out.series[0].values).toEqual([null, null]);
    // Pusta komórka to luka (świadoma), napis „brak" to błąd (do zgłoszenia).
    expect(out.problems).toContainEqual({ code: "nonNumericCells", count: 1 });
  });

  it("kolumna bez nagłówka zostaje serią z nazwą zastępczą", () => {
    const out = tableToChartData([
      ["", ""],
      ["2021", "5"],
    ]);
    expect(out.series).toHaveLength(1);
    expect(out.series[0].name).toBe("1");
    expect(out.series[0].values).toEqual([5]);
  });

  it("tabela bez wierszy danych daje pustkę, nie wyjątek", () => {
    expect(tableToChartData([]).categories).toEqual([]);
    expect(tableToChartData([["", "A"]]).series).toEqual([]);
  });
});

describe("import - tabela na dane mapy", () => {
  const indeks = buildCountryIndex([
    { id: "PL", pl: "Polska", en: "Poland" },
    { id: "DE", pl: "Niemcy", en: "Germany" },
    { id: "FR", pl: "Francja", en: "France" },
  ]);

  it("czyta kod ISO-2 i nazwę w obu językach", () => {
    const out = tableToMapValues(
      [
        ["PL", "12,5"],
        ["Niemcy", "8"],
        ["France", "3"],
      ],
      indeks,
    );
    expect(out.values).toEqual([
      { id: "PL", value: 12.5 },
      { id: "DE", value: 8 },
      { id: "FR", value: 3 },
    ]);
    expect(out.problems).toEqual([]);
  });

  it("dopasowuje nazwę bez ogonków i bez względu na wielkość liter", () => {
    expect(normaliseCountryName("Polska")).toBe(normaliseCountryName("POLSKA"));
    const out = tableToMapValues([["polska", "1"]], indeks);
    expect(out.values).toEqual([{ id: "PL", value: 1 }]);
  });

  it("wykrywa wiersz nagłówka, ale nie zjada pierwszego kraju bez niego", () => {
    const zNaglowkiem = tableToMapValues(
      [
        ["Kraj", "Wartość"],
        ["PL", "1"],
      ],
      indeks,
    );
    expect(zNaglowkiem.values).toEqual([{ id: "PL", value: 1 }]);

    const bezNaglowka = tableToMapValues(
      [
        ["PL", "1"],
        ["DE", "2"],
      ],
      indeks,
    );
    expect(bezNaglowka.values).toHaveLength(2);
  });

  it("ZGŁASZA nieznany kraj zamiast go milcząco pominąć", () => {
    const out = tableToMapValues(
      [
        ["PL", "1"],
        ["Atlantyda", "9"],
      ],
      indeks,
    );
    expect(out.values).toEqual([{ id: "PL", value: 1 }]);
    expect(out.problems).toContainEqual({ code: "unknownCountries", labels: ["Atlantyda"] });
  });

  it("kod spoza REGIONU jest nieznany, choć jest poprawnym ISO-2", () => {
    // Skorowidz powstaje z zasobu geometrii wybranego regionu. Kraj, którego
    // ten region nie rysuje, nie ma prawa wejść jako dana - byłby niewidoczny.
    const out = tableToMapValues([["JP", "5"]], indeks);
    expect(out.values).toEqual([]);
    expect(out.problems).toContainEqual({ code: "unknownCountries", labels: ["JP"] });
  });

  it("ZGŁASZA duplikat i zachowuje pierwsze wystąpienie", () => {
    const out = tableToMapValues(
      [
        ["PL", "1"],
        ["Polska", "2"],
      ],
      indeks,
    );
    expect(out.values).toEqual([{ id: "PL", value: 1 }]);
    expect(out.problems).toContainEqual({ code: "duplicateCountries", labels: ["Polska"] });
  });

  it("bez skorowidza przepuszcza każdy poprawny ISO-2", () => {
    const out = tableToMapValues([["JP", "5"]]);
    expect(out.values).toEqual([{ id: "JP", value: 5 }]);
  });
});

describe("import - serializacja do textarei", () => {
  it("wykres wraca tekstem, który textarea czyta z powrotem 1:1", () => {
    const dane = tableToChartData([
      ["", "Eksport", "Import"],
      ["2021", "120", "80"],
      ["2022", "150,5", "95"],
    ]);
    const tekst = chartDataToText(dane);
    const zpowrotem = parseChartData(tekst);
    expect(zpowrotem.categories).toEqual(dane.categories);
    expect(zpowrotem.series.map((s) => s.name)).toEqual(dane.series.map((s) => s.name));
    expect(zpowrotem.series.map((s) => s.values)).toEqual(dane.series.map((s) => s.values));
  });

  it("mapa wraca tekstem, który parser mapy czyta z powrotem 1:1", () => {
    const wartosci = [
      { id: "PL", value: 12.5 },
      { id: "DE", value: -3 },
    ];
    expect(parseMapData(mapValuesToText(wartosci))).toEqual(wartosci);
  });

  it("luka w serii zostaje luką, a nie zerem", () => {
    const tekst = chartDataToText({
      categories: ["A", "B"],
      series: [{ name: "S", values: [null, 5], colorSlot: 1 }],
    });
    expect(parseChartData(tekst).series[0].values).toEqual([null, 5]);
  });
});

describe("import - rozpoznawanie pliku", () => {
  it("zna rozszerzenia, które umie przeczytać", () => {
    expect(fileExtension("dane.XLSX")).toBe("xlsx");
    expect(isImportableName("dane.xlsx")).toBe(true);
    expect(isImportableName("dane.csv")).toBe(true);
    expect(isImportableName("dane.pdf")).toBe(false);
    expect(isImportableName("dane")).toBe(false);
  });
});
