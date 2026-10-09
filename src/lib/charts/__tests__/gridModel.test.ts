// SIATKA DANYCH: operacje edytora wykresu i mapy.
//
// Każda operacja jest czysta: wejście zostaje nietknięte (historia cofania
// trzyma poprzednie wersje), a operacja niewykonalna oddaje TEN SAM obiekt.
// Najwięcej uwagi dostaje wklejenie, bo to ono przenosi cudze dane do
// wykresu: kotwica w wierszu nazw (-1), w kolumnie kategorii (-1) i w
// komórce wartości, wzrost do limitów z dokładnym raportem, i to, że pusta
// komórka nazwy nie kasuje nazwy, a pusta komórka wartości robi lukę.
import { describe, expect, it } from "vitest";
import {
  GRID_LIMITS,
  MAP_GRID_MAX_ROWS,
  applyMapPasteAt,
  applyPasteAt,
  canTranspose,
  indexAfterInsert,
  indexAfterMove,
  indexAfterRemove,
  insertCategory,
  insertSeries,
  mapRowsToValues,
  moveCategory,
  moveSeries,
  removeCategory,
  removeSeries,
  sortByColumn,
  transpose,
  type GridModel,
  type MapGridRow,
} from "@/lib/charts/gridModel";
import { buildCountryIndex } from "@/lib/charts/importTable";
import { SLOT_SEQUENCE, slotForSeries } from "@/lib/charts/palette";
import { MAX_SERIES } from "@/lib/charts/types";
import { MAX_CATEGORIES } from "@/lib/charts/parse";

function model(): GridModel {
  return {
    categories: ["2021", "2022", "2023"],
    series: [
      { name: "Eksport", values: [1, 2, 3], colorSlot: 3 },
      { name: "Import", values: [4, null, 6], colorSlot: 4 },
    ],
  };
}

/** Głęboka kopia do sprawdzenia, że operacja nie dotknęła wejścia. */
function kopia<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

describe("siatka - kategorie", () => {
  it("wstawia kategorię z lukami w każdej serii", () => {
    const m = model();
    const przed = kopia(m);
    const out = insertCategory(m, 1, "2021,5");
    expect(out.categories).toEqual(["2021", "2021,5", "2022", "2023"]);
    expect(out.series.map((s) => s.values)).toEqual([
      [1, null, 2, 3],
      [4, null, null, 6],
    ]);
    expect(m).toEqual(przed);
  });

  it("pozycja poza zakresem jest przycinana: początek albo koniec", () => {
    expect(insertCategory(model(), -5).categories[0]).toBe("");
    expect(insertCategory(model(), 99).categories.at(-1)).toBe("");
  });

  it("na limicie kategorii nic nie wstawia i oddaje ten sam obiekt", () => {
    const m = model();
    expect(insertCategory(m, 0, "", { maxCategories: 3, maxSeries: 10 })).toBe(m);
  });

  it("usuwa kategorię razem z jej wartościami", () => {
    const out = removeCategory(model(), 1);
    expect(out.categories).toEqual(["2021", "2023"]);
    expect(out.series[1].values).toEqual([4, 6]);
    const m = model();
    expect(removeCategory(m, 3)).toBe(m);
    expect(removeCategory(m, -1)).toBe(m);
  });

  it("przesuwa kategorię razem z wartościami; na krawędzi nic nie robi", () => {
    const out = moveCategory(model(), 0, 1);
    expect(out.categories).toEqual(["2022", "2021", "2023"]);
    expect(out.series[0].values).toEqual([2, 1, 3]);
    const m = model();
    expect(moveCategory(m, 0, -1)).toBe(m);
    expect(moveCategory(m, 2, 1)).toBe(m);
  });
});

describe("siatka - serie", () => {
  it("nowa seria ma luki i WOLNY kolor - nie kolor serii, która już jest", () => {
    const out = insertSeries(model(), 2, { name: "Saldo" });
    const nowa = out.series[2];
    expect(nowa.name).toBe("Saldo");
    expect(nowa.values).toEqual([null, null, null]);
    expect([3, 4]).not.toContain(nowa.colorSlot);
    expect(nowa.colorSlot).toBe(SLOT_SEQUENCE.find((s) => s !== 3 && s !== 4));
  });

  it("kolor podany jawnie wygrywa", () => {
    expect(insertSeries(model(), 0, { colorSlot: 21 }).series[0].colorSlot).toBe(21);
  });

  it("na limicie serii nic nie wstawia", () => {
    const m = model();
    expect(insertSeries(m, 0, {}, { maxCategories: 60, maxSeries: 2 })).toBe(m);
  });

  it("usuwa serię; indeks spoza zakresu oddaje ten sam obiekt", () => {
    expect(removeSeries(model(), 0).series.map((s) => s.name)).toEqual(["Import"]);
    const m = model();
    expect(removeSeries(m, 2)).toBe(m);
  });

  it("przesunięta seria zabiera kolor i AKCENT", () => {
    const { model: out, accentSeries } = moveSeries(model(), 0, 1, 0);
    expect(out.series.map((s) => s.name)).toEqual(["Import", "Eksport"]);
    expect(out.series.map((s) => s.colorSlot)).toEqual([4, 3]);
    expect(accentSeries).toBe(1);
  });

  it("akcent na sąsiadce zostaje na sąsiadce", () => {
    expect(moveSeries(model(), 0, 1, 1).accentSeries).toBe(0);
  });

  it("akcent na serii spoza ruchu się nie rusza", () => {
    const m = insertSeries(model(), 2, { name: "C" });
    expect(moveSeries(m, 0, 1, 2).accentSeries).toBe(2);
  });

  it("ruch poza krawędź: ten sam model i ten sam akcent", () => {
    const m = model();
    expect(moveSeries(m, 1, 1, 1)).toEqual({ model: m, accentSeries: 1 });
    expect(moveSeries(m, 1, 1, 1).model).toBe(m);
  });
});

describe("siatka - wskaźniki", () => {
  it("po wstawieniu", () => {
    expect(indexAfterInsert(2, 1)).toBe(3);
    expect(indexAfterInsert(2, 2)).toBe(3);
    expect(indexAfterInsert(2, 3)).toBe(2);
  });

  it("po usunięciu; usunięty wskazany to null", () => {
    expect(indexAfterRemove(2, 1)).toBe(1);
    expect(indexAfterRemove(2, 2)).toBeNull();
    expect(indexAfterRemove(2, 3)).toBe(2);
  });

  it("po przeniesieniu z przesunięciem reszty", () => {
    expect(indexAfterMove(1, 1, 4)).toBe(4);
    expect(indexAfterMove(3, 1, 4)).toBe(2);
    expect(indexAfterMove(2, 4, 1)).toBe(3);
    expect(indexAfterMove(0, 1, 4)).toBe(0);
    expect(indexAfterMove(5, 1, 4)).toBe(5);
  });
});

describe("siatka - obrót i sortowanie", () => {
  it("obraca kategorie w serie i z powrotem bez utraty danych", () => {
    const m = model();
    const t = transpose(m);
    expect(t.categories).toEqual(["Eksport", "Import"]);
    expect(t.series.map((s) => s.name)).toEqual(["2021", "2022", "2023"]);
    expect(t.series[1].values).toEqual([2, null]);
    expect(t.series.map((s) => s.colorSlot)).toEqual([0, 1, 2].map(slotForSeries));
    const back = transpose(t);
    expect(back.categories).toEqual(m.categories);
    expect(back.series.map((s) => [s.name, s.values])).toEqual(
      m.series.map((s) => [s.name, s.values]),
    );
  });

  it("obrót ponad limity NIE ucina - oddaje ten sam model", () => {
    const szeroki: GridModel = {
      categories: Array.from({ length: MAX_SERIES + 1 }, (_, i) => `K${i}`),
      series: [
        { name: "A", values: Array.from({ length: MAX_SERIES + 1 }, () => 1), colorSlot: 3 },
      ],
    };
    expect(canTranspose(szeroki)).toBe(false);
    expect(transpose(szeroki)).toBe(szeroki);
    expect(canTranspose(model(), GRID_LIMITS)).toBe(true);
  });

  it("sortuje po wartościach serii; luki zawsze na końcu", () => {
    const { model: asc, order } = sortByColumn(model(), 1, "asc");
    expect(asc.series[1].values).toEqual([4, 6, null]);
    expect(asc.categories).toEqual(["2021", "2023", "2022"]);
    expect(asc.series[0].values).toEqual([1, 3, 2]);
    expect(order).toEqual([0, 2, 1]);
    const { model: desc } = sortByColumn(model(), 1, "desc");
    expect(desc.series[1].values).toEqual([6, 4, null]);
  });

  it("sortuje etykiety naturalnie („2” przed „10”), puste na końcu, stabilnie", () => {
    const m: GridModel = {
      categories: ["10", "", "2", "b", "B"],
      series: [{ name: "A", values: [1, 2, 3, 4, 5], colorSlot: 3 }],
    };
    const { model: out } = sortByColumn(m, -1, "asc");
    expect(out.categories).toEqual(["2", "10", "b", "B", ""]);
    expect(out.series[0].values).toEqual([3, 1, 4, 5, 2]);
    expect(sortByColumn(m, -1, "desc").model.categories).toEqual(["b", "B", "10", "2", ""]);
  });

  it("kolumna spoza zakresu: ten sam model i porządek tożsamościowy", () => {
    const m = model();
    expect(sortByColumn(m, 5, "asc")).toEqual({ model: m, order: [0, 1, 2] });
  });
});

describe("siatka - wklejenie w róg (-1, -1): cała tabela", () => {
  const tabela = [
    ["", "Eksport", "Import", "Saldo"],
    ["2021", "10", "20", "-10"],
    ["2022", "11", "21", "-10"],
    ["2023", "12", "22", "-10"],
    ["2024", "13", "23", "-10"],
  ];

  it("nazwy, etykiety i wartości naraz; siatka rośnie o wiersz i serię", () => {
    const m = model();
    const przed = kopia(m);
    const { model: out, problems, range } = applyPasteAt(m, tabela, { row: -1, col: -1 });
    expect(out.categories).toEqual(["2021", "2022", "2023", "2024"]);
    expect(out.series.map((s) => s.name)).toEqual(["Eksport", "Import", "Saldo"]);
    expect(out.series[2].values).toEqual([-10, -10, -10, -10]);
    expect(out.series[0].values).toEqual([10, 11, 12, 13]);
    expect(problems).toEqual([]);
    expect(range).toEqual({ fromRow: -1, toRow: 3, fromCol: -1, toCol: 2 });
    expect(m).toEqual(przed);
  });

  it("kolor serii zostaje przy serii, nowa seria dostaje wolny", () => {
    const { model: out } = applyPasteAt(model(), tabela, { row: -1, col: -1 });
    expect(out.series.map((s) => s.colorSlot).slice(0, 2)).toEqual([3, 4]);
    expect([3, 4]).not.toContain(out.series[2].colorSlot);
  });
});

describe("siatka - wklejenie w wiersz nazw i w kolumnę kategorii", () => {
  it("kotwica w wierszu nazw (-1, 0): pierwszy wiersz bloku to nazwy serii", () => {
    const { model: out } = applyPasteAt(
      model(),
      [
        ["A", "B"],
        ["7", "8"],
      ],
      { row: -1, col: 0 },
    );
    expect(out.series.map((s) => s.name)).toEqual(["A", "B"]);
    expect(out.series.map((s) => s.values[0])).toEqual([7, 8]);
    expect(out.categories).toEqual(model().categories);
  });

  it("kotwica w kolumnie kategorii (1, -1): pierwsza kolumna bloku to etykiety", () => {
    const { model: out } = applyPasteAt(
      model(),
      [
        ["Q2", "9"],
        ["Q3", "10"],
      ],
      { row: 1, col: -1 },
    );
    expect(out.categories).toEqual(["2021", "Q2", "Q3"]);
    expect(out.series[0].values).toEqual([1, 9, 10]);
    expect(out.series[1].values).toEqual([4, null, 6]);
  });

  it("pusta komórka nazwy albo etykiety NIE kasuje istniejącej", () => {
    const { model: out } = applyPasteAt(model(), [["", "Nowa"]], { row: -1, col: 0 });
    expect(out.series.map((s) => s.name)).toEqual(["Eksport", "Nowa"]);
    const { model: out2 } = applyPasteAt(model(), [[""], ["X"]], { row: 0, col: -1 });
    expect(out2.categories).toEqual(["2021", "X", "2023"]);
  });

  it("róg bloku w rogu siatki jest pomijany", () => {
    const { model: out } = applyPasteAt(
      model(),
      [
        ["RÓG", "A"],
        ["K", "1"],
      ],
      { row: -1, col: -1 },
    );
    expect(out.categories[0]).toBe("K");
    expect(out.series[0].name).toBe("A");
    expect(out.categories).not.toContain("RÓG");
  });
});

describe("siatka - wklejenie w komórki wartości", () => {
  it("nadpisuje blok od kotwicy; pusta komórka wartości robi lukę", () => {
    const { model: out, range } = applyPasteAt(
      model(),
      [
        ["9", ""],
        ["8", "7"],
      ],
      { row: 1, col: 0 },
    );
    expect(out.series[0].values).toEqual([1, 9, 8]);
    expect(out.series[1].values).toEqual([4, null, 7]);
    expect(range).toEqual({ fromRow: 1, toRow: 2, fromCol: 0, toCol: 1 });
  });

  it("blok wychodzący poza siatkę dokłada kategorie i serie z nazwami zastępczymi", () => {
    const { model: out } = applyPasteAt(
      model(),
      [
        ["5", "6", "7"],
        ["8", "9", "10"],
      ],
      { row: 2, col: 0 },
      GRID_LIMITS,
      { seriesName: (i) => `Seria ${i + 1}`, categoryLabel: (i) => `K${i + 1}` },
    );
    expect(out.categories).toEqual(["2021", "2022", "2023", "K4"]);
    expect(out.series.map((s) => s.name)).toEqual(["Eksport", "Import", "Seria 3"]);
    expect(out.series[2].values).toEqual([null, null, 7, 10]);
    expect(new Set(out.series.map((s) => s.colorSlot)).size).toBe(3);
  });

  it("domyślne nazwy zastępcze to numery - jak w imporcie pliku", () => {
    const { model: out } = applyPasteAt(model(), [["1", "2", "3"]], { row: 3, col: 1 });
    expect(out.categories.at(-1)).toBe("4");
    expect(out.series.map((s) => s.name)).toEqual(["Eksport", "Import", "3", "4"]);
  });

  it("kotwica spoza siatki jest przycinana do jej krawędzi", () => {
    const { model: out, range } = applyPasteAt(model(), [["5"]], { row: 99, col: 99 });
    expect(out.categories).toHaveLength(4);
    expect(out.series).toHaveLength(3);
    expect(range).toEqual({ fromRow: 3, toRow: 3, fromCol: 2, toCol: 2 });
  });

  it("limity: to, co nie weszło, jest zgłoszone z DOKŁADNĄ liczbą", () => {
    const limits = { maxCategories: 4, maxSeries: 3 };
    const blok = Array.from({ length: 5 }, () => ["1", "2", "3", "4"]);
    const { model: out, problems, range } = applyPasteAt(model(), blok, { row: 1, col: 0 }, limits);
    expect(out.categories).toHaveLength(4);
    expect(out.series).toHaveLength(3);
    // Blok sięga wiersza 5 (indeksy 1..5) i kolumny 3 (0..3).
    expect(problems).toEqual([
      { code: "seriesTruncated", dropped: 1 },
      { code: "categoriesTruncated", dropped: 2 },
    ]);
    expect(range).toEqual({ fromRow: 1, toRow: 3, fromCol: 0, toCol: 2 });
  });

  it("domyślne limity to limity konfiguracji wykresu", () => {
    expect(GRID_LIMITS).toEqual({ maxCategories: MAX_CATEGORIES, maxSeries: MAX_SERIES });
    const blok = Array.from({ length: MAX_CATEGORIES + 2 }, () => ["1"]);
    const { problems } = applyPasteAt(model(), blok, { row: 0, col: 0 });
    expect(problems).toEqual([{ code: "categoriesTruncated", dropped: 2 }]);
  });

  it("liczby czyta reguła importu: waluta, flagi, braki i komórki nieliczbowe", () => {
    const { model: out, problems } = applyPasteAt(
      model(),
      [["1 234,50 zł"], ["12,5 p"], [":"], ["b.d."]],
      { row: 0, col: 0 },
    );
    expect(out.series[0].values).toEqual([1234.5, 12.5, null, null]);
    expect(problems).toEqual([
      { code: "nonNumericCells", count: 1 },
      { code: "dataFlags", count: 1 },
    ]);
  });

  it("konwencja liczb rozpoznana z wklejanych wartości albo wybrana jawnie", () => {
    const en = applyPasteAt(model(), [["1,234"], ["3.5"]], { row: 0, col: 0 });
    expect(en.model.series[0].values.slice(0, 2)).toEqual([1234, 3.5]);
    const niejasne = applyPasteAt(model(), [["1,234"]], { row: 0, col: 0 });
    expect(niejasne.model.series[0].values[0]).toBe(1.234);
    expect(niejasne.problems).toEqual([{ code: "localeAmbiguous", count: 1 }]);
    const wybor = applyPasteAt(model(), [["1,234"]], { row: 0, col: 0 }, GRID_LIMITS, {
      locale: "en",
    });
    expect(wybor.model.series[0].values[0]).toBe(1234);
    expect(wybor.problems).toEqual([]);
  });

  it("etykiety w bloku nie są świadectwem konwencji", () => {
    // „1.5" w kolumnie kategorii nie może przestawić konwencji wartości.
    const { model: out } = applyPasteAt(model(), [["1.5", "1.234"]], { row: 0, col: -1 });
    expect(out.categories[0]).toBe("1.5");
    expect(out.series[0].values[0]).toBe(1.234);
  });

  it("pusty blok nic nie zmienia", () => {
    const m = model();
    expect(applyPasteAt(m, [], { row: 0, col: 0 })).toEqual({
      model: m,
      problems: [],
      range: null,
    });
    expect(applyPasteAt(m, [[]], { row: 0, col: 0 }).model).toBe(m);
  });
});

describe("siatka mapy - wklejenie", () => {
  const indeks = buildCountryIndex([
    { id: "PL", pl: "Polska", en: "Poland" },
    { id: "DE", pl: "Niemcy", en: "Germany" },
    { id: "CZ", pl: "Czechy", en: "Czech Republic" },
    { id: "GR", pl: "Grecja", en: "Greece" },
  ]);
  const obecne: MapGridRow[] = [
    { id: "PL", value: 1 },
    { id: "DE", value: 2 },
  ];

  it("tabela z nagłówkiem: nagłówek pominięty, aliasy zgłoszone, nadmiarowe kolumny też", () => {
    const { rows, problems, range } = applyMapPasteAt(
      [],
      [
        ["Kraj", "2019", "2020"],
        ["POL", "1,5", "9"],
        ["Czechia", "2,5", "9"],
        ["EL", "3,5", "9"],
      ],
      { row: 0, col: 0 },
      indeks,
    );
    expect(rows).toEqual([
      { id: "PL", value: 1.5 },
      { id: "CZ", value: 2.5 },
      { id: "GR", value: 3.5 },
    ]);
    expect(problems).toEqual([
      { code: "aliasesApplied", labels: ["POL (PL)", "Czechia (CZ)", "EL (GR)"] },
      { code: "columnsIgnored", labels: ["2020"] },
    ]);
    expect(range).toEqual({ fromRow: 0, toRow: 2 });
  });

  it("same wartości w kolumnie wartości: kraje zostają, nowe wiersze bez kraju", () => {
    const { rows } = applyMapPasteAt(obecne, [["5"], ["6"], ["7"]], { row: 0, col: 1 }, indeks);
    expect(rows).toEqual([
      { id: "PL", value: 5 },
      { id: "DE", value: 6 },
      { id: "", value: 7 },
    ]);
    expect(mapRowsToValues(rows)).toEqual([
      { id: "PL", value: 5 },
      { id: "DE", value: 6 },
    ]);
  });

  it("kolumna wartości z nagłówkiem tekstowym pomija nagłówek", () => {
    const { rows } = applyMapPasteAt(obecne, [["Wartość"], ["5"]], { row: 0, col: 1 }, indeks);
    expect(rows[0]).toEqual({ id: "PL", value: 5 });
  });

  it("nieznany kraj NIE jest zapisany - wiersz pod nim zostaje nietknięty", () => {
    const { rows, problems } = applyMapPasteAt(
      obecne,
      [
        ["Atlantyda", "9"],
        ["CZ", "3"],
      ],
      { row: 0, col: 0 },
      indeks,
    );
    expect(rows).toEqual([
      { id: "PL", value: 1 },
      { id: "CZ", value: 3 },
    ]);
    expect(problems).toContainEqual({ code: "unknownCountries", labels: ["Atlantyda"] });
  });

  it("kraj wklejony drugi raz: w bloku wygrywa pierwszy, poza blokiem znika stary wiersz", () => {
    const { rows, problems, range } = applyMapPasteAt(
      obecne,
      [
        ["DE", "5"],
        ["Niemcy", "6"],
      ],
      { row: 2, col: 0 },
      indeks,
    );
    expect(rows).toEqual([
      { id: "PL", value: 1 },
      { id: "DE", value: 5 },
    ]);
    expect(problems).toContainEqual({ code: "duplicateCountries", labels: ["Niemcy", "DE"] });
    // Zakres wskazuje wiersz po usunięciu starego DE.
    expect(range).toEqual({ fromRow: 1, toRow: 1 });
  });

  it("pusta komórka wartości czyści wartość, kraj zostaje", () => {
    const { rows } = applyMapPasteAt(obecne, [["PL", ""]], { row: 0, col: 0 }, indeks);
    expect(rows[0]).toEqual({ id: "PL", value: null });
  });

  it("limit wierszy: nadmiar zgłoszony dokładnie", () => {
    const blok = [
      ["PL", "1"],
      ["DE", "2"],
      ["CZ", "3"],
    ];
    const { rows, problems } = applyMapPasteAt([], blok, { row: 0, col: 0 }, indeks, {
      maxRows: 2,
    });
    expect(rows).toHaveLength(2);
    expect(problems).toContainEqual({ code: "categoriesTruncated", dropped: 1 });
    expect(MAP_GRID_MAX_ROWS).toBeGreaterThan(250);
  });

  it("bez skorowidza przyjmuje kody ISO-2 i mapuje kody Eurostatu", () => {
    const { rows } = applyMapPasteAt(
      [],
      [
        ["PL", "1"],
        ["UK", "2"],
      ],
      { row: 0, col: 0 },
    );
    expect(rows.map((r) => r.id)).toEqual(["PL", "GB"]);
  });

  it("nie zmienia wejścia i przyjmuje zapisane dane bloku bez konwersji", () => {
    const zapisane = [{ id: "PL", value: 1 }];
    const przed = kopia(zapisane);
    applyMapPasteAt(zapisane, [["2"]], { row: 0, col: 1 }, indeks);
    expect(zapisane).toEqual(przed);
  });

  it("dane bloku z siatki: tylko pełne wiersze, pierwszy kraj wygrywa", () => {
    expect(
      mapRowsToValues([
        { id: "pl", value: 1 },
        { id: "", value: 2 },
        { id: "DE", value: null },
        { id: "PL", value: 3 },
      ]),
    ).toEqual([{ id: "PL", value: 1 }]);
  });
});
