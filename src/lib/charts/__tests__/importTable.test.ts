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
  fileExtension,
  formatImportedCell,
  needsTextCellFix,
  safeTextCell,
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
  it("mapa wraca tekstem, który parser mapy czyta z powrotem 1:1", () => {
    const wartosci = [
      { id: "PL", value: 12.5 },
      { id: "DE", value: -3 },
    ];
    expect(parseMapData(mapValuesToText(wartosci))).toEqual(wartosci);
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

// ---------------------------------------------------------------------------
// REGRESJE Z PRZEGLĄDU ADWERSARIALNEGO
//
// Każdy test niżej odpowiada błędowi POTWIERDZONEMU uruchomieniem na kodzie
// sprzed poprawki. Pięć z siedmiu gubiło dane MILCZĄCO - czyli łamało
// deklarację z nagłówka modułu, że nic nie znika bez zgłoszenia. To jest
// dokładnie ta klasa błędu, której nie widać w podglądzie: wykres się rysuje,
// tylko na innych danych niż plik.
// ---------------------------------------------------------------------------

describe("import - regresje parsera tekstu", () => {
  it("cal w niecytowanym polu NIE połyka reszty pliku", () => {
    // Było: `"` w środku pola przełączał tryb cytowania i trzy wiersze
    // lądowały w jednej komórce, bez ani jednego problemu w raporcie.
    const rows = parseDelimitedText('Kraj;Wartosc\nRura 5" DN;10\nRura 8 DN;20\nRura 10 DN;30');
    expect(rows).toHaveLength(4);
    expect(rows[1]).toEqual(['Rura 5" DN', "10"]);
    expect(rows[3]).toEqual(["Rura 10 DN", "30"]);
  });

  it("niedomknięty cudzysłów na końcu pliku NIE scala wierszy", () => {
    const rows = parseDelimitedText('a;b\n"c;d\ne;f');
    expect(rows.length).toBeGreaterThanOrEqual(3);
    expect(rows[0]).toEqual(["a", "b"]);
  });

  it("pole wielowierszowe w cudzysłowach nie psuje wyboru separatora", () => {
    // RFC 4180 pozwala na znak nowej linii wewnątrz pola. Stan cytowania musi
    // przechodzić przez końce wierszy, inaczej średnik ukryty w takim polu
    // wygrywał z prawdziwym przecinkiem i tabela robiła się jednokolumnowa.
    const text = 'Name,Value\n"a\nb; c; d",10\nOther,20';
    expect(sniffDelimiter(text)).toBe(",");
    const rows = parseDelimitedText(text);
    expect(rows[0]).toEqual(["Name", "Value"]);
    expect(rows[1]).toEqual(["a\nb; c; d", "10"]);
    expect(rows[2]).toEqual(["Other", "20"]);
  });

  it("pole cytowane zachowuje spacje brzegowe, niecytowane je traci", () => {
    const rows = parseDelimitedText('"  wcięcie  ";  luz  ');
    expect(rows[0][0]).toBe("  wcięcie  ");
    expect(rows[0][1]).toBe("luz");
  });

  it("CRLF nie zostawia surowego \\r wewnątrz pola wielowierszowego", () => {
    const rows = parseDelimitedText('a;b\r\n"x\r\ny";5\r\n');
    expect(rows[1][0]).toBe("x\ny");
  });
});

describe("import - regresje liczb i dat", () => {
  it("odrzuca zapis, który tylko UDAJE grupowanie tysięcy", () => {
    // Było: 123.4 - czyli śmieć zamieniony w wiarygodnie wyglądającą liczbę.
    expect(parseImportedNumber("1.2.3,4")).toBeNull();
    // A prawdziwe grupowanie dalej przechodzi.
    expect(parseImportedNumber("1.234,5")).toBe(1234.5);
    expect(parseImportedNumber("12.345.678,9")).toBe(12345678.9);
  });

  it("data z komórki NIE przesuwa się o dzień w strefie na wschód od UTC", () => {
    // `toISOString()` cofał dzień u polskiego redaktora: 2024-01-15 wychodziło
    // jako „2024-01-14 23:00:00". Data jest etykietą osi, więc to nie kosmetyka.
    expect(formatImportedCell(new Date(2024, 0, 15, 0, 0, 0))).toBe("2024-01-15");
    expect(formatImportedCell(new Date(2024, 5, 30, 0, 0, 0))).toBe("2024-06-30");
    // Godzina niezerowa zostaje, bo niesie informację.
    expect(formatImportedCell(new Date(2024, 0, 15, 14, 30, 0))).toBe("2024-01-15 14:30:00");
    // Data nieprawidłowa to pusta komórka, nie „Invalid Date" na osi.
    expect(formatImportedCell(new Date(NaN))).toBe("");
  });
});

describe("import - regresje mapy", () => {
  const indeks = buildCountryIndex([
    { id: "PL", pl: "Polska", en: "Poland" },
    { id: "DE", pl: "Niemcy", en: "Germany" },
  ]);

  it("pierwszy kraj bez wartości NIE jest zjadany jako nagłówek", () => {
    // Było: wiersz PL znikał bez śladu, `problems` puste.
    const out = tableToMapValues(
      [
        ["PL", ""],
        ["DE", "12"],
      ],
      indeks,
    );
    expect(out.values).toEqual([{ id: "DE", value: 12 }]);
    expect(out.problems).toContainEqual({ code: "rowsSkipped", count: 1 });
  });

  it("pierwszy kraj z wartością nieliczbową też jest zgłaszany, nie zjadany", () => {
    const out = tableToMapValues(
      [
        ["PL", "b.d."],
        ["DE", "12"],
      ],
      indeks,
    );
    expect(out.problems).toContainEqual({ code: "rowsSkipped", count: 1 });
  });

  it("PUSTY skorowidz znaczy brak skorowidza, nie brak krajów", () => {
    // Zasób geometrii dociąga się fetchem z `retry: 1`. Gdy nie zdążył albo
    // padł, wywołujący przekazuje pusty indeks - i import poprawnego pliku
    // kończył się komunikatem „nierozpoznane kraje: PL, DE".
    const out = tableToMapValues(
      [
        ["PL", "1"],
        ["DE", "2"],
      ],
      buildCountryIndex([]),
    );
    expect(out.values).toEqual([
      { id: "PL", value: 1 },
      { id: "DE", value: 2 },
    ]);
    expect(out.problems).toEqual([]);
  });
});

describe("import - etykiety bezpieczne dla formatu średnikowego", () => {
  it("średnik i złamanie wiersza znikają z etykiety", () => {
    expect(safeTextCell("Kraków; Polska")).toBe("Kraków, Polska");
    expect(safeTextCell("linia1\nlinia2")).toBe("linia1 linia2");
  });

  it("rozpoznaje, które etykiety wymagają podmiany", () => {
    expect(needsTextCellFix("Kraków; Polska")).toBe(true);
    expect(needsTextCellFix("linia1\nlinia2")).toBe(true);
    expect(needsTextCellFix("Polska")).toBe(false);
  });

  it("po podmianie etykieta przeżywa round-trip przez format średnikowy", () => {
    const kategoria = safeTextCell("Kraków; Polska");
    const tekst = `; A\n${kategoria}; 20`;
    const wynik = parseChartData(tekst);
    expect(wynik.categories).toEqual([kategoria]);
    expect(wynik.series[0].values).toEqual([20]);
  });
});
