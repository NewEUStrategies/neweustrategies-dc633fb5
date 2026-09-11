// Model wachlarza scenariuszy. Najważniejsze asercje w tym pliku są cztery
// i wszystkie dotyczą uczciwości, a nie wyglądu: pasma muszą być
// ZAGNIEŻDŻONE i przecięcie krawędzi jest nazwane, pasmo musi ZAWIERAĆ
// ścieżkę centralną, zadeklarowana pewność musi zgadzać się ze zmierzoną
// szerokością (a przy pewnościach nieznanych model MILCZY, zamiast
// zaświadczać), i model nie wypuszcza NaN, Infinity ani `undefined` - bo
// `Intl.NumberFormat.format(NaN)` zwraca literalny napis "NaN", którego
// bramka `blockMatrix` szuka w `textContent` strony.
//
// Testy pinują ZACHOWANIE modelu, nie jego implementację: sprawdzają liczby,
// które czytelnik odczyta z rysunku i z tabeli, oraz orzeczenia, które wejdą
// do podpisu - a nie kolejność kroków, która do nich doprowadziła.
import { describe, expect, it } from "vitest";
import type { ChartSeries } from "@/lib/charts/types";
import {
  FAN_LEVELS_ADVICE_MAX,
  FAN_MIN_FORECAST_STEPS,
  FAN_VALUE_LIMIT,
  FAN_WIDE_START_SHARE,
  fanExtent,
  fanFormAdvice,
  fanModel,
  fanTable,
  type FanInput,
  type FanModel,
  type FanOptions,
} from "@/lib/charts/kinds/fanChart";

function seria(name: string, values: (number | null)[], colorSlot = 1): ChartSeries {
  return { name, values, colorSlot };
}

function wejscie(categories: string[], series: ChartSeries[]): FanInput {
  return { categories, series };
}

/** Pięć kroków historii i trzy prognozy - najkrótszy sensowny wachlarz. */
const OKRESY = ["2021", "2022", "2023", "2024", "2025", "2026", "2027", "2028"];
const CENTRUM = seria("PKB", [100, 104, 107, 111, 115, 119, 123, 128]);
const OD_PROGNOZY: FanOptions = { forecastFrom: 5 };

/**
 * Trzy zagnieżdżone pasma podane WPROST, rozchodzące się z horyzontem - taki
 * kształt ma poprawny wachlarz i taki jest tu punktem odniesienia dla
 * wszystkich sprawdzeń, które mają MILCZEĆ albo mówić `true`.
 */
const PASMA_POPRAWNE: ChartSeries[] = [
  CENTRUM,
  seria("50% dolna", [null, null, null, null, 115, 117, 119, 122]),
  seria("50% górna", [null, null, null, null, 115, 121, 127, 134]),
  seria("80% dolna", [null, null, null, null, 115, 115, 115, 116]),
  seria("80% górna", [null, null, null, null, 115, 123, 131, 140]),
  seria("95% dolna", [null, null, null, null, 115, 113, 111, 110]),
  seria("95% górna", [null, null, null, null, 115, 125, 135, 146]),
];

/**
 * Skan całego modelu w poszukiwaniu wartości, które po sformatowaniu trafiłyby
 * do strony jako napis "NaN", "Infinity" albo "undefined". Chodzi po
 * strukturze rekurencyjnie, bo defekt tego rodzaju pojawia się zwykle w polu,
 * o którym nikt nie pamiętał (udział szerokości przy zerowym mianowniku,
 * asymetria przy zerowej szerokości, granica przy zerze kategorii), a nie
 * w tym, które test wybrał ręcznie.
 */
function niedozwoloneWartosci(node: unknown, sciezka = "model", out: string[] = []): string[] {
  if (typeof node === "number") {
    if (!Number.isFinite(node)) out.push(`${sciezka} = ${String(node)}`);
    return out;
  }
  if (node === undefined) {
    out.push(`${sciezka} = undefined`);
    return out;
  }
  if (Array.isArray(node)) {
    node.forEach((element, i) => niedozwoloneWartosci(element, `${sciezka}[${i}]`, out));
    return out;
  }
  if (node !== null && typeof node === "object") {
    if (node instanceof Map) {
      for (const [key, value] of node.entries()) {
        niedozwoloneWartosci(value, `${sciezka}.get(${String(key)})`, out);
      }
      return out;
    }
    for (const [key, value] of Object.entries(node)) {
      niedozwoloneWartosci(value, `${sciezka}.${key}`, out);
    }
  }
  return out;
}

/** Skrót: model plus tabela, bo alternatywa tekstowa też nie może nieść NaN. */
function skanuj(model: FanModel): string[] {
  return [
    ...niedozwoloneWartosci(model),
    ...niedozwoloneWartosci(fanTable(model), "tabela"),
    ...niedozwoloneWartosci(fanExtent(model), "zakres"),
    ...niedozwoloneWartosci(fanFormAdvice(model), "porady"),
  ];
}

describe("fanModel: granica historia/prognoza", () => {
  // Bez tego testu renderer nie ma skąd wziąć trzech nośników odróżnienia
  // prognozy i wachlarz spada do pojedynczej linii - czyli dokładnie do tego,
  // czego kolumna "Czego unikać" zabrania.
  it("oddaje separator MIĘDZY ostatnią obserwacją a pierwszą prognozą", () => {
    const model = fanModel(wejscie(OKRESY, PASMA_POPRAWNE), OD_PROGNOZY);
    expect(model.boundary).not.toBeNull();
    expect(model.boundary?.forecastFrom).toBe(5);
    expect(model.boundary?.lastObservation).toBe(4);
    // Pół kroku, nie na kategorii: separator postawiony na kategorii dzieli
    // jej kolumnę i czytelnik nie wie, po której stronie granicy ona jest.
    expect(model.boundary?.separatorAt).toBe(4.5);
    expect(model.boundary?.zoneFrom).toBe(4.5);
    expect(model.boundary?.zoneTo).toBe(7.5);
    expect(model.boundary?.historyCount).toBe(5);
    expect(model.boundary?.forecastCount).toBe(3);
  });

  // Bez tego testu punkt obserwacji pojawiałby się w prognozie, a wtedy
  // czytelnik odczytuje wartość z miejsca, w którym nikt niczego nie zmierzył.
  it("stawia punkty obserwacji WYŁĄCZNIE na odcinku historycznym", () => {
    const model = fanModel(wejscie(OKRESY, PASMA_POPRAWNE), OD_PROGNOZY);
    const zPunktami = model.steps.filter((s) => s.isObservation).map((s) => s.index);
    expect(zPunktami).toEqual([0, 1, 2, 3, 4]);
    expect(model.steps.filter((s) => s.isForecast).every((s) => !s.isObservation)).toBe(true);
    expect(model.honesty.observationCount).toBe(5);
  });

  // Bez tego testu granica z cofniętej wersji edytora (prognoza od kroku 40
  // na szeregu ośmiokrokowym) trafiałaby do rysunku po przycięciu do
  // przypadkowego miejsca - a wykres z granicą w losowym miejscu kłamie
  // mocniej niż wykres bez granicy.
  it("ODRZUCA granicę poza zakresem, zamiast ją przycinać, i mówi o tym", () => {
    for (const zla of [0, -3, 8, 40, 2.5]) {
      const model = fanModel(wejscie(OKRESY, [CENTRUM]), { forecastFrom: zla, bandPct: 10 });
      expect(model.boundary).toBeNull();
      expect(model.honesty.boundaryDropped).toBe(true);
      expect(model.steps.every((s) => !s.isForecast)).toBe(true);
      expect(skanuj(model)).toEqual([]);
    }
    // Brak deklaracji NIE JEST odrzuceniem deklaracji.
    const bez = fanModel(wejscie(OKRESY, [CENTRUM]), {});
    expect(bez.honesty.boundaryDropped).toBe(false);
  });
});

describe("fanModel: pasma z nazw serii", () => {
  // Bez tego testu wiele poziomów pewności nie da się wyrazić w obecnym
  // schemacie bloku i wachlarz zawsze degradowałby do jednego pasma.
  it("składa poziomy z par dolna/górna i porządkuje je od NAJSZERSZEGO", () => {
    const model = fanModel(wejscie(OKRESY, PASMA_POPRAWNE), OD_PROGNOZY);
    expect(model.bandSource).toBe("series");
    expect(model.centralSource).toBe("fallback");
    expect(model.levels.map((l) => l.confidence)).toEqual([95, 80, 50]);
    expect(model.levels.map((l) => l.layer)).toEqual([0, 1, 2]);
    // Krycie: przy malowaniu pełnych pasm najwęższe leży pod dwoma innymi.
    expect(model.levels.map((l) => l.overlapDepth)).toEqual([0, 1, 2]);
  });

  // Bez tego testu "P10"/"P90" byłoby czytane jako dwie serie bez pary,
  // a to jest najczęstszy zapis pasm w publikacjach prognostycznych.
  it("czyta zapis percentylowy: P10 i P90 to pasmo 80%, a P50 to centrum", () => {
    const model = fanModel(
      wejscie(
        ["I", "II", "III"],
        [seria("P50", [10, 11, 12]), seria("P10", [null, 10, 9]), seria("P90", [null, 12, 15])],
      ),
      { forecastFrom: 1 },
    );
    expect(model.centralSource).toBe("name");
    expect(model.levels).toHaveLength(1);
    expect(model.levels[0].confidence).toBe(80);
    expect(model.honesty.unpairedEdgeNames).toEqual([]);
    expect(skanuj(model)).toEqual([]);
  });

  // Bez tego testu krawędź bez pary byłaby po cichu odbijana wokół centrum
  // albo pomijana bez słowa - a odbicie wymyśliłoby liczbę, bo przedział
  // niesymetryczny jest normą, nie wyjątkiem.
  it("NIE dorysowuje brakującej krawędzi, tylko nazywa serię bez pary", () => {
    const model = fanModel(
      wejscie(
        ["I", "II", "III"],
        [seria("Prognoza", [10, 11, 12]), seria("80% dolna", [null, 9, 8])],
      ),
      { forecastFrom: 1 },
    );
    expect(model.levels).toEqual([]);
    expect(model.honesty.unpairedEdgeNames).toEqual(["80% dolna"]);
    expect(model.honesty.forecastDistinguished).toBe(false);
    expect(model.honesty.carriers).not.toContain("band");
  });

  // Bez tego testu druga kolumna zgłoszona do tej samej krawędzi znikałaby
  // bez śladu i autor widziałby wykres bez własnych danych, nie wiedząc czemu.
  it("nazywa drugą kolumnę zgłoszoną do tej samej krawędzi poziomu", () => {
    const model = fanModel(
      wejscie(
        ["I", "II"],
        [
          seria("Centralna", [10, 11]),
          seria("80% górna", [null, 13]),
          seria("80 górna wariant B", [null, 14]),
          seria("80% dolna", [null, 9]),
        ],
      ),
      { forecastFrom: 1 },
    );
    expect(model.honesty.duplicateEdgeNames).toEqual(["80 górna wariant B"]);
    expect(model.levels).toHaveLength(1);
    expect(model.levels[0].steps[0].upper).toBe(13);
  });

  // Bez tego testu seria, której wachlarz nie czyta, byłaby przemilczana -
  // a autor, który wpisał trzy osobne scenariusze zamiast pasm, ma prawo
  // dowiedzieć się, że wykres bierze z nich jeden.
  it("nazywa serie, których nie czyta", () => {
    const model = fanModel(
      wejscie(
        ["I", "II"],
        [
          seria("Scenariusz bazowy", [10, 11]),
          seria("Scenariusz szoku energetycznego", [10, 8]),
          seria("Scenariusz odbicia", [10, 14]),
        ],
      ),
      { forecastFrom: 1, bandPct: 8 },
    );
    // "bazowy" jest rdzeniem centralnym, więc centrum jest rozpoznane PO
    // NAZWIE, a nie po pozycji - i dobrze, bo pozycja w arkuszu jest
    // przypadkowa.
    expect(model.centralSource).toBe("name");
    expect(model.honesty.extraSeriesNames).toEqual([
      "Scenariusz szoku energetycznego",
      "Scenariusz odbicia",
    ]);
  });
});

describe("fanModel: uczciwość pasm", () => {
  // TO JEST NAJWAŻNIEJSZY TEST W PLIKU. Bez niego pasmo 50% mogłoby wyjść
  // poza pasmo 80% i wykres pokazywałby dwa rozkłady jednocześnie, z których
  // przynajmniej jeden nie jest tym, o którym mówi jego etykieta.
  it("wykrywa PRZECIĘCIE krawędzi dwóch poziomów i nazywa krok", () => {
    const zepsute: ChartSeries[] = [
      CENTRUM,
      seria("50% dolna", [null, null, null, null, 115, 117, 119, 122]),
      // W 2027 górna 50% wychodzi POWYŻEJ górnej 80% - zagnieżdżenie pęka.
      seria("50% górna", [null, null, null, null, 115, 121, 133, 134]),
      seria("80% dolna", [null, null, null, null, 115, 115, 115, 116]),
      seria("80% górna", [null, null, null, null, 115, 123, 131, 140]),
    ];
    const model = fanModel(wejscie(OKRESY, zepsute), OD_PROGNOZY);
    expect(model.honesty.bandsNested).toBe(false);
    expect(model.honesty.crossingLabels).toEqual(["2027"]);
    // Poprawny wachlarz z tego samego zestawu musi dać `true`, inaczej test
    // pinowałby stałą, a nie zachowanie.
    const dobry = fanModel(wejscie(OKRESY, PASMA_POPRAWNE), OD_PROGNOZY);
    expect(dobry.honesty.bandsNested).toBe(true);
    expect(dobry.honesty.crossingLabels).toEqual([]);
  });

  // Bez tego testu model milczałby o pasmie mijającym centrum, a to znaczy,
  // że krawędzie i ścieżka pochodzą z dwóch różnych prognoz - defekt tej
  // samej klasy co mostek, którego składniki nie domykają różnicy stanów.
  it("wykrywa pasmo, które NIE ZAWIERA ścieżki centralnej", () => {
    const model = fanModel(
      wejscie(
        ["I", "II", "III"],
        [
          seria("Centralna", [10, 20, 30]),
          seria("80% dolna", [null, 22, 28]),
          seria("80% górna", [null, 26, 34]),
        ],
      ),
      { forecastFrom: 1 },
    );
    expect(model.honesty.bandsContainCentral).toBe(false);
    expect(model.honesty.centralOutsideLabels).toEqual(["II"]);
    const dobry = fanModel(wejscie(OKRESY, PASMA_POPRAWNE), OD_PROGNOZY);
    expect(dobry.honesty.bandsContainCentral).toBe(true);
  });

  // Bez tego testu model sortowałby poziomy po zmierzonej szerokości
  // i przyklejał etykiety po kolei - a wtedy pasmo 95% węższe od 80%
  // wychodziłoby z modelu jako poprawne i defekt deklaracji znikałby.
  it("wykrywa pasmo o WYŻSZEJ pewności, które jest WĘŻSZE", () => {
    const model = fanModel(
      wejscie(
        ["I", "II", "III"],
        [
          seria("Centralna", [10, 20, 30]),
          seria("80% dolna", [null, 15, 20]),
          seria("80% górna", [null, 25, 40]),
          // 95% ciaśniejsze niż 80% - deklaracja przeczy liczbom.
          seria("95% dolna", [null, 19, 29]),
          seria("95% górna", [null, 21, 31]),
        ],
      ),
      { forecastFrom: 1 },
    );
    expect(model.honesty.confidenceMatchesWidth).toBe(false);
    expect(model.honesty.misorderedConfidences).toEqual([95, 80]);
    // Kolejność warstw idzie za DEKLARACJĄ, nie za szerokością - inaczej
    // defektu nie byłoby jak zobaczyć.
    expect(model.levels.map((l) => l.confidence)).toEqual([95, 80]);
  });

  // Bez tego testu model zaświadczałby o sprawdzeniu, którego nie da się
  // przeprowadzić: przy nieznanych pewnościach sortuje po szerokości, więc
  // sprawdzałby własne sortowanie. To ta sama lekcja co suma udziałów tarczy.
  it("MILCZY o kolejności, gdy pewności są nieznane", () => {
    const model = fanModel(
      wejscie(
        ["I", "II"],
        [
          seria("Centralna", [10, 20]),
          seria("dolna", [null, 15]),
          seria("górna", [null, 25]),
          seria("scenariusz minimum", [null, 12]),
          seria("scenariusz maksimum", [null, 28]),
        ],
      ),
      { forecastFrom: 1 },
    );
    expect(model.levels.length).toBeGreaterThanOrEqual(1);
    expect(model.honesty.confidenceMatchesWidth).toBeNull();
    expect(model.honesty.misorderedConfidences).toEqual([]);
  });

  // Bez tego testu pasmo zwężone do linii wyglądałoby na policzone, a jest
  // twierdzeniem "tę przyszłą wartość znam dokładnie".
  it("wykrywa pasmo o ZEROWEJ szerokości w kroku prognozy", () => {
    const model = fanModel(
      wejscie(
        ["I", "II", "III"],
        [
          seria("Centralna", [10, 20, 30]),
          seria("80% dolna", [null, 20, 25]),
          seria("80% górna", [null, 20, 35]),
        ],
      ),
      { forecastFrom: 1 },
    );
    expect(model.honesty.bandsHaveWidth).toBe(false);
    expect(model.honesty.zeroWidthLabels).toEqual(["II"]);
  });

  // Bez tego testu kotwica na granicy odpalałaby ostrzeżenie o zerowej
  // szerokości na KAŻDYM wachlarzu z pasmem procentowym - a ostrzeżenie,
  // które widać zawsze, uczy ignorowania wszystkich ostrzeżeń.
  it("NIE liczy kotwicy na granicy jako pasma o zerowej szerokości", () => {
    const model = fanModel(wejscie(OKRESY, [CENTRUM]), { forecastFrom: 5, bandPct: 10 });
    expect(model.bandSource).toBe("bandPct");
    const kotwice = model.levels[0].steps.filter((s) => s.isAnchor);
    expect(kotwice).toHaveLength(1);
    expect(kotwice[0].index).toBe(4);
    expect(kotwice[0].width).toBe(0);
    expect(model.honesty.bandsHaveWidth).toBe(true);
    expect(model.honesty.zeroWidthLabels).toEqual([]);
  });

  // Bez tego testu WZORCOWY wachlarz z tego pliku dostawał czerwony przypis.
  // `PASMA_POPRAWNE` domyka wszystkie trzy pasma na ostatniej obserwacji
  // równymi krawędziami (115/115) - to ta sama kotwica, co na drodze
  // procentowej, tylko postawiona ręką autora, więc bez flagi `isAnchor`.
  // Sprawdzenie chodzące po wszystkich krokach nazywało ją defektem
  // „pasmo ma zerową szerokość w krokach: 2025", czyli oskarżało autora
  // o technikę, którą ten sam plik opisuje jako poprawną.
  it("NIE liczy kotwicy PODANEJ WPROST jako pasma o zerowej szerokości", () => {
    const model = fanModel(wejscie(OKRESY, PASMA_POPRAWNE), OD_PROGNOZY);
    const naGranicy = model.levels.map((l) => l.steps.find((s) => s.index === 4));
    expect(naGranicy.every((s) => s !== undefined && s.width === 0 && !s.isAnchor)).toBe(true);
    expect(model.honesty.zeroWidthLabels).toEqual([]);
    expect(model.honesty.bandsHaveWidth).toBe(true);
  });

  // Bez tego testu poprawka powyżej mogłaby zostać rozlana na całą prognozę
  // i orzeczenie przestałoby cokolwiek wykrywać. Jedne dane, dwa kierunki:
  // pasmo przylega do linii przez CAŁĄ historię (poprawnie, bo tam są
  // pomiary) i zwęża się do linii w JEDNYM kroku prognozy (defekt).
  it("sądzi zerową szerokość WYŁĄCZNIE w krokach prognozy", () => {
    const model = fanModel(
      wejscie(
        ["I", "II", "III", "IV"],
        [
          seria("Centralna", [10, 20, 30, 40]),
          seria("80% dolna", [10, 20, 30, 35]),
          seria("80% górna", [10, 20, 30, 45]),
        ],
      ),
      { forecastFrom: 2 },
    );
    // Historia: zero na krokach I i II jest prawdą o pomiarze, nie defektem.
    expect(model.honesty.zeroWidthLabels).toEqual(["III"]);
    expect(model.honesty.bandsHaveWidth).toBe(false);
    // ...i nie przenosi się do informacji o paśmie nad historią, bo tam
    // liczy się pasmo o DODATNIEJ szerokości.
    expect(model.honesty.bandOverHistoryLabels).toEqual([]);
  });

  // Bez tego testu dziura w paśmie była CICHA. Krok z jedną krawędzią wypada
  // z modelu w całości (pół pasma nie jest pasmem), więc wielokąt urywa się
  // i zaczyna dalej, a żadne pole nie mówiło, że tak się stało. Luka
  // w ścieżce centralnej ma własne orzeczenie od początku; pasmo nie miało
  // żadnego, choć niesie tę samą informację - ile nie wiemy.
  it("NAZYWA dziurę wewnątrz pasma, choć krok z jedną krawędzią wypada", () => {
    const model = fanModel(
      wejscie(OKRESY, [
        CENTRUM,
        seria("80% dolna", [null, null, null, null, 115, 115, null, 116]),
        seria("80% górna", [null, null, null, null, 115, 123, 131, 140]),
      ]),
      OD_PROGNOZY,
    );
    // Krok „2027" (indeks 6) wypadł z pasma...
    expect(model.levels[0].steps.map((s) => s.index)).toEqual([4, 5, 7]);
    // ...i model o tym MÓWI, zamiast zostawić na rysunku niewyjaśnioną przerwę.
    expect(model.honesty.bandGapLabels).toEqual(["2027"]);
    expect(model.honesty.bandsContinuous).toBe(false);
    // Wiersz tabeli niesie ten sam fakt, co uwaga pod rysunkiem.
    const wiersz = fanTable(model).rows.find((r) => r.label === "2027");
    expect(wiersz?.notes).toContain("bandGap");
  });

  it("pasmo zaczynające się na granicy NIE jest dziurą", () => {
    // Druga strona umowy. Pasmo istnieje wyłącznie w prognozie i to jest
    // REGUŁA tego rodzaju, a nie przerwa - orzeczenie liczące brakujące
    // krańce zapalałoby się na każdym poprawnym wachlarzu, czyli uczyłoby
    // ignorowania całej listy uwag.
    const model = fanModel(wejscie(OKRESY, PASMA_POPRAWNE), OD_PROGNOZY);
    expect(model.honesty.bandGapLabels).toEqual([]);
    expect(model.honesty.bandsContinuous).toBe(true);
    expect(fanTable(model).rows.every((r) => !r.notes.includes("bandGap"))).toBe(true);
  });

  // Bez tego testu model mówił tylko SKĄD wziął ścieżkę centralną
  // (`centralSource`), a nie KTÓRA to seria - i renderer nie miał czym
  // zaadresować slotu palety. Malował wtedy cały wachlarz kolorem serii
  // PIERWSZEJ, czyli u autora z kolumnami „dolna, górna, centralna" kolorem
  // krawędzi. Kolor jest w tym systemie przydziałem, nie ozdobą.
  // Bez tego testu luka NAD POMIAREM była zupełnie cicha. Ten sam brak jeden
  // krok dalej (w prognozie) dostawał czerwoną uwagę, a nad danymi, o których
  // wykres twierdzi, że je zmierzono, nie mówiło o nim nic.
  it("NAZYWA lukę w ścieżce centralnej NAD POMIAREM, osobno od luki w prognozie", () => {
    const model = fanModel(
      wejscie(OKRESY, [
        seria("PKB centralna", [100, null, 107, 111, 115, 119, null, 128]),
        seria("80% dolna", [null, null, null, null, 115, 115, 115, 116]),
        seria("80% górna", [null, null, null, null, 115, 123, 131, 140]),
      ]),
      OD_PROGNOZY,
    );
    // KAŻDA faza ma swoje etykiety, bo każda ma swój powód: w prognozie pasmo
    // zostaje bez linii, nad pomiarem brakuje pomiaru.
    expect(model.honesty.centralHistoryGapLabels).toEqual(["2022"]);
    expect(model.honesty.centralContinuousInHistory).toBe(false);
    expect(model.honesty.centralForecastGapLabels).toEqual(["2027"]);
    expect(model.honesty.centralContinuousInForecast).toBe(false);
  });

  it("szereg zaczynający się później NIE jest luką w historii", () => {
    // Druga strona umowy. Brak na POCZĄTKU historii znaczy „pomiary zaczynają
    // się później" i zdarza się w połowie danych z bazy; orzeczenie zapalające
    // się na tym byłoby widoczne wszędzie i uczyło pomijania całej listy.
    const model = fanModel(
      wejscie(OKRESY, [
        seria("PKB centralna", [null, null, 107, 111, 115, 119, 123, 128]),
        seria("80% dolna", [null, null, null, null, 115, 115, 115, 116]),
        seria("80% górna", [null, null, null, null, 115, 123, 131, 140]),
      ]),
      OD_PROGNOZY,
    );
    expect(model.honesty.centralHistoryGapLabels).toEqual([]);
    expect(model.honesty.centralContinuousInHistory).toBe(true);
  });

  it("ODDAJE indeks serii, z której wziął ścieżkę centralną", () => {
    // 1. Z NAZWY - centralna stoi jako trzecia kolumna.
    const zNazwy = fanModel(
      wejscie(OKRESY, [
        seria("80% dolna", [null, null, null, null, 115, 115, 115, 116]),
        seria("80% górna", [null, null, null, null, 115, 123, 131, 140]),
        seria("PKB centralna", [100, 104, 107, 111, 115, 119, 123, 128]),
      ]),
      OD_PROGNOZY,
    );
    expect(zNazwy.centralSource).toBe("name");
    expect(zNazwy.centralIndex).toBe(2);

    // 2. Z OPCJI - wskazanie autora wygrywa z nazwą.
    const zOpcji = fanModel(wejscie(OKRESY, [CENTRUM, seria("Druga", CENTRUM.values)]), {
      ...OD_PROGNOZY,
      centralSeriesIndex: 1,
    });
    expect(zOpcji.centralSource).toBe("option");
    expect(zOpcji.centralIndex).toBe(1);

    // 3. Z FALLBACKU - jedna seria bez nazwy mówiącej o roli.
    const zFallbacku = fanModel(wejscie(OKRESY, [CENTRUM]), { forecastFrom: 5, bandPct: 10 });
    expect(zFallbacku.centralSource).toBe("fallback");
    expect(zFallbacku.centralIndex).toBe(0);

    // 4. BRAK - `null` znaczy „nie ma ścieżki", a nie „pierwsza kolumna".
    const bez = fanModel(wejscie([], []), OD_PROGNOZY);
    expect(bez.centralSource).toBe("none");
    expect(bez.centralIndex).toBeNull();
  });

  it("MILCZY, gdy nie ma między czym szukać przerwy", () => {
    // Poziom o jednym kroku albo brak poziomów: `null` znaczy „nie ma o czym
    // orzekać", a nie „jest w porządku". Bez tego rozróżnienia pusty wykres
    // zaświadczałby o ciągłości pasma, którego nie ma.
    const pusty = fanModel(wejscie([], []), OD_PROGNOZY);
    expect(pusty.honesty.bandsContinuous).toBeNull();
    const jeden = fanModel(
      wejscie(
        ["I", "II", "III"],
        [
          seria("Centralna", [10, 20, 30]),
          seria("80% dolna", [null, null, 25]),
          seria("80% górna", [null, null, 35]),
        ],
      ),
      { forecastFrom: 2 },
    );
    expect(jeden.levels[0].steps).toHaveLength(1);
    expect(jeden.honesty.bandsContinuous).toBeNull();
  });

  // Bez tego testu zamienione kolumny byłyby po cichu sortowane i defekt
  // danych znikał - a razem z nim informacja, że autor pomylił krawędzie.
  it("NAZYWA odwróconą parę krawędzi, choć naprawia geometrię", () => {
    const model = fanModel(
      wejscie(
        ["I", "II"],
        [
          seria("Centralna", [10, 20]),
          // Dolna wyżej od górnej: kolumny zamienione.
          seria("80% dolna", [null, 25]),
          seria("80% górna", [null, 15]),
        ],
      ),
      { forecastFrom: 1 },
    );
    expect(model.honesty.bandPairsOrdered).toBe(false);
    expect(model.honesty.invertedLabels).toEqual(["II"]);
    // Geometria naprawiona, żeby wielokąt dał się narysować.
    expect(model.levels[0].steps[0].lower).toBe(15);
    expect(model.levels[0].steps[0].upper).toBe(25);
    expect(model.levels[0].steps[0].inverted).toBe(true);
  });

  // Bez tego testu model odpowiadałby `true` na pytanie, którego nie da się
  // postawić: pasmo policzone z jednego procentu nie ma jak być odwrócone.
  it("MILCZY o uporządkowaniu pary, gdy pasmo pochodzi z procentu", () => {
    const model = fanModel(wejscie(OKRESY, [CENTRUM]), { forecastFrom: 5, bandPct: 12 });
    expect(model.honesty.bandPairsOrdered).toBeNull();
  });

  // Bez tego testu wykres z prognozą bez pasma przechodziłby jako uczciwy,
  // a to jest, wprost z sekcji 8, najczęstsza forma kłamstwa na wykresie.
  it("orzeka o TRZECH nośnikach odróżnienia prognozy", () => {
    const bez = fanModel(wejscie(OKRESY, [CENTRUM]), { forecastFrom: 5 });
    expect(bez.honesty.carriers).toEqual(["zone", "separator"]);
    expect(bez.honesty.forecastDistinguished).toBe(false);

    const z = fanModel(wejscie(OKRESY, PASMA_POPRAWNE), OD_PROGNOZY);
    expect(z.honesty.carriers).toEqual(["band", "zone", "separator"]);
    expect(z.honesty.forecastDistinguished).toBe(true);

    // Bez prognozy nie ma czego odróżniać, więc model MILCZY.
    const historia = fanModel(wejscie(OKRESY, [CENTRUM]), {});
    expect(historia.honesty.forecastDistinguished).toBeNull();
  });

  // Bez tego testu luka w prognozie przechodziłaby niezauważona, a pasmo
  // wokół brakującej wartości nie ma do czego się odnieść.
  it("wykrywa lukę w ścieżce centralnej na odcinku prognozy", () => {
    const model = fanModel(
      wejscie(OKRESY, [seria("PKB", [100, 104, 107, 111, 115, 119, null, 128])]),
      { forecastFrom: 5, bandPct: 10 },
    );
    expect(model.honesty.centralContinuousInForecast).toBe(false);
    expect(model.honesty.centralForecastGapLabels).toEqual(["2027"]);
    // Luka PRZERYWA odcinek linii, ale nie zmienia jej stylu na kreskowany:
    // trzy nośniki wystarczają, a czwarty wygląda na artefakt renderu.
    expect(model.centralSegments).toHaveLength(2);
    expect(model.centralSegments[0].map((p) => p.index)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(model.centralSegments[1].map((p) => p.index)).toEqual([7]);
    // Pasmo też nie przechodzi przez lukę - wypełnienie przeciągnięte przez
    // krok bez danych twierdziłoby, że niepewność tam jest znana.
    expect(model.levels[0].segments).toHaveLength(2);
  });
});

describe("fanModel: informacje, nie defekty", () => {
  // Bez tego testu szeroki start byłby albo przemilczany, albo zgłaszany jako
  // defekt - a jest podejrzeniem: przy prognozie kwartalnej pierwszy krok
  // bywa równie niepewny jak czwarty.
  it("zgłasza szeroki start jako INFORMACJĘ z udziałem, nie jako defekt", () => {
    const model = fanModel(
      wejscie(
        ["I", "II", "III", "IV"],
        [
          seria("Centralna", [10, 20, 30, 40]),
          seria("80% dolna", [null, 10, 19, 28]),
          seria("80% górna", [null, 30, 41, 52]),
        ],
      ),
      { forecastFrom: 1 },
    );
    expect(model.honesty.firstStepWidthShare).toBeCloseTo(20 / 24, 10);
    expect(model.honesty.firstStepWidthShare ?? 0).toBeGreaterThanOrEqual(FAN_WIDE_START_SHARE);
    expect(model.honesty.wideAtStart).toBe(true);
    // Defektem NIE JEST - orzeczenia uczciwości pozostają czyste.
    expect(model.honesty.bandsNested).toBeNull();
    expect(model.honesty.bandsHaveWidth).toBe(true);
    expect(model.honesty.bandsContainCentral).toBe(true);
  });

  // Bez tego testu wachlarz rozchodzący się normalnie zgłaszałby szeroki
  // start i ostrzeżenie straciłoby wartość.
  it("nie zgłasza szerokiego startu przy wachlarzu, który się rozchodzi", () => {
    const model = fanModel(wejscie(OKRESY, PASMA_POPRAWNE), OD_PROGNOZY);
    expect(model.honesty.wideAtStart).toBe(false);
    expect(model.honesty.firstStepWidthShare ?? 1).toBeLessThan(FAN_WIDE_START_SHARE);
  });

  // Bez tego testu pasmo o stałej szerokości wyglądałoby na wachlarz, choć
  // nie mówi nic o horyzoncie.
  it("zgłasza pasmo o STAŁEJ szerokości i podpowiada inną formę", () => {
    const model = fanModel(
      wejscie(
        ["I", "II", "III", "IV"],
        [
          seria("Centralna", [10, 20, 30, 40]),
          seria("dolna", [null, 15, 25, 35]),
          seria("górna", [null, 25, 35, 45]),
        ],
      ),
      { forecastFrom: 1 },
    );
    expect(model.honesty.constantWidth).toBe(true);
    expect(fanFormAdvice(model)).toContain("constantBand");
  });

  // Bez tego testu zwężanie się wachlarza z horyzontem byłoby przemilczane,
  // a to najczęstszy objaw odwróconej kolejności kolumn.
  it("nazywa kroki, w których pasmo ZWĘŻA SIĘ z horyzontem", () => {
    const model = fanModel(
      wejscie(
        ["I", "II", "III", "IV"],
        [
          seria("Centralna", [10, 20, 30, 40]),
          seria("dolna", [null, 5, 25, 38]),
          seria("górna", [null, 35, 35, 42]),
        ],
      ),
      { forecastFrom: 1 },
    );
    expect(model.honesty.narrowingLabels).toEqual(["III", "IV"]);
    expect(model.honesty.constantWidth).toBe(false);
  });

  // Bez tego testu pasmo nad historią byłoby przemilczane, a najczęściej
  // znaczy, że granica prognozy jest przesunięta o krok.
  it("nazywa kroki HISTORYCZNE, nad którymi jest pasmo", () => {
    const model = fanModel(
      wejscie(
        ["I", "II", "III"],
        [
          seria("Centralna", [10, 20, 30]),
          seria("dolna", [8, 18, 25]),
          seria("górna", [12, 22, 35]),
        ],
      ),
      { forecastFrom: 2 },
    );
    expect(model.honesty.bandOverHistoryLabels).toEqual(["I", "II"]);
    // Informacja, nie defekt: orzeczenia zostają czyste.
    expect(model.honesty.bandsHaveWidth).toBe(true);
  });

  // Bez tego testu asymetria pasma byłaby uśredniana albo gubiona, a "w dół
  // może spaść o 40, w górę urosnąć o 8" jest treścią prognozy.
  it("zachowuje ASYMETRIĘ pasma wokół centrum, zamiast ją symetryzować", () => {
    const model = fanModel(
      wejscie(
        ["I", "II"],
        [seria("Centralna", [100, 100]), seria("dolna", [null, 60]), seria("górna", [null, 108])],
      ),
      { forecastFrom: 1 },
    );
    const krok = model.levels[0].steps[0];
    expect(krok.lower).toBe(60);
    expect(krok.upper).toBe(108);
    // |(108-100) - (100-60)| / 48
    expect(model.levels[0].maxAsymmetry).toBeCloseTo(32 / 48, 10);
  });
});

describe("fanModel: odporność na dane z bazy", () => {
  // Bez tego testu wykres z pustą konfiguracją wywracałby cały wpis, bo
  // wyjątek w modelu nie kończy się na wykresie.
  it("nie rzuca i nie zaświadcza przy braku kategorii i serii", () => {
    const model = fanModel(wejscie([], []), { forecastFrom: 3, bandPct: 20 });
    expect(model.steps).toEqual([]);
    expect(model.levels).toEqual([]);
    expect(model.rings).toEqual([]);
    expect(model.boundary).toBeNull();
    expect(model.bandSource).toBe("none");
    expect(model.centralSource).toBe("none");
    expect(model.honesty.bandsNested).toBeNull();
    expect(model.honesty.bandsContainCentral).toBeNull();
    expect(model.honesty.bandsHaveWidth).toBeNull();
    expect(model.honesty.bandPairsOrdered).toBeNull();
    expect(model.honesty.forecastDistinguished).toBeNull();
    expect(model.honesty.constantWidth).toBeNull();
    expect(model.honesty.firstStepWidthShare).toBeNull();
    expect(skanuj(model)).toEqual([]);
  });

  // Bez tego testu seria z samymi lukami dawała pasmo policzone z centrum,
  // którego nie ma, i wykres pokazywałby przedział wokół niczego.
  it("nie buduje pasm z serii, w której są same luki", () => {
    const model = fanModel(wejscie(["I", "II", "III"], [seria("Puste", [null, null, null])]), {
      forecastFrom: 1,
      bandPct: 15,
    });
    expect(model.centralSegments).toEqual([]);
    expect(model.levels[0]?.steps ?? []).toEqual([]);
    expect(model.honesty.observationCount).toBe(0);
    // Bez ANI JEDNEJ wartości centralnej nie ma między czym szukać przerwy:
    // orzeczenie MILCZY, zamiast zaświadczać o ciągłości linii, której nie ma.
    expect(model.honesty.centralHistoryGapLabels).toEqual([]);
    expect(model.honesty.centralContinuousInHistory).toBeNull();
    expect(fanFormAdvice(model)).toContain("noCentral");
    expect(skanuj(model)).toEqual([]);
  });

  // Bez tego testu jedna kategoria dawała granicę prognozy o zerowej
  // szerokości strefy albo wykres bez ani jednej obserwacji.
  it("nie buduje granicy na jednej kategorii", () => {
    const model = fanModel(wejscie(["I"], [seria("PKB", [100])]), {
      forecastFrom: 1,
      bandPct: 10,
    });
    expect(model.boundary).toBeNull();
    expect(model.honesty.boundaryDropped).toBe(true);
    expect(fanFormAdvice(model)).toContain("noForecast");
    expect(skanuj(model)).toEqual([]);
  });

  // Bez tego testu procentowe pasmo wokół zera dawało szerokość zero i wykres
  // twierdziłby, że w tym kroku wartość jest znana dokładnie - a to jest
  // realna właściwość pasma liczonego jako procent wartości.
  it("wykrywa zerowe pasmo tam, gdzie ścieżka centralna przechodzi przez zero", () => {
    const model = fanModel(wejscie(["I", "II", "III", "IV"], [seria("Saldo", [5, 2, 0, -4])]), {
      forecastFrom: 2,
      bandPct: 25,
    });
    expect(model.honesty.bandsHaveWidth).toBe(false);
    expect(model.honesty.zeroWidthLabels).toEqual(["III"]);
    // Ujemna wartość centralna nadal daje pasmo o DODATNIEJ szerokości -
    // szerokość jest liczona z modułu, bo pasmo nie ma znaku.
    const ostatni = model.levels[0].steps.find((s) => s.index === 3);
    expect(ostatni?.width).toBeCloseTo(2, 10);
    expect(ostatni?.lower).toBeCloseTo(-5, 10);
    expect(ostatni?.upper).toBeCloseTo(-3, 10);
    expect(skanuj(model)).toEqual([]);
  });

  // Bez tego testu ujemna albo zerowa szerokość pasma z konfiguracji dawała
  // pasmo odwrócone, które wygląda jak poprawne.
  it("odrzuca poziom o niedodatniej połowie szerokości", () => {
    const model = fanModel(wejscie(OKRESY, [CENTRUM]), {
      forecastFrom: 5,
      levels: [
        { confidence: 80, pct: -12 },
        { confidence: 50, pct: 0 },
        { confidence: 95, pct: 20 },
      ],
    });
    expect(model.levels).toHaveLength(1);
    expect(model.levels[0].confidence).toBe(95);
    expect(skanuj(model)).toEqual([]);
  });

  // Bez tego testu pewność 120% albo 0% wchodziłaby do sortowania warstw
  // i model orzekałby o kolejności na podstawie liczby, która nie jest
  // pewnością.
  it("odrzuca niemożliwe pewności i mówi o nich", () => {
    const model = fanModel(wejscie(OKRESY, [CENTRUM]), {
      forecastFrom: 5,
      levels: [
        { confidence: 120, pct: 20 },
        { confidence: 0, pct: 10 },
      ],
    });
    expect(model.honesty.outOfRangeConfidences).toEqual([120, 0]);
    expect(model.levels.every((l) => l.confidence === null)).toBe(true);
    expect(model.honesty.confidenceMatchesWidth).toBeNull();
    expect(skanuj(model)).toEqual([]);
  });

  // Bez tego testu liczba spoza zakresu bezpiecznego wchodziła w arytmetykę
  // pasm i wychodziła z modelu jako Infinity, a `Intl.NumberFormat` wypisuje
  // ją w stronie literalnie.
  it("odcina wartości niemożliwe i liczy, ile odpadło", () => {
    const model = fanModel(
      wejscie(
        ["I", "II", "III"],
        [
          seria("Centralna", [10, Number.POSITIVE_INFINITY, Number.NaN]),
          seria("dolna", [null, FAN_VALUE_LIMIT * 4, 8]),
          seria("górna", [null, 20, 30, 40, 50]),
        ],
      ),
      { forecastFrom: 1 },
    );
    // Trzy odrzucone liczby plus dwie wartości bez kategorii.
    expect(model.honesty.droppedValueCount).toBe(5);
    expect(skanuj(model)).toEqual([]);
  });

  // Bez tego testu ujemne wartości w całym szeregu (deficyt, saldo migracji)
  // dawały odwrócone porządki krawędzi i pasma poza zakresem osi.
  it("radzi sobie z szeregiem w całości ujemnym", () => {
    const model = fanModel(
      wejscie(
        ["I", "II", "III"],
        [
          seria("Saldo", [-10, -12, -15]),
          seria("80% dolna", [null, -14, -20]),
          seria("80% górna", [null, -10, -11]),
        ],
      ),
      { forecastFrom: 1 },
    );
    expect(model.honesty.bandsContainCentral).toBe(true);
    expect(model.honesty.bandsNested).toBeNull();
    const zakres = fanExtent(model);
    expect(zakres.min).toBe(-20);
    expect(zakres.max).toBe(-10);
    expect(skanuj(model)).toEqual([]);
  });

  // Bez tego testu płaski szereg zerowy dawał dzielenie zero przez zero
  // w udziałach szerokości i asymetrii.
  it("nie produkuje NaN na szeregu złożonym z samych zer", () => {
    const model = fanModel(
      wejscie(
        ["I", "II", "III"],
        [seria("Zero", [0, 0, 0]), seria("dolna", [null, 0, 0]), seria("górna", [null, 0, 0])],
      ),
      { forecastFrom: 1, bandPct: 30 },
    );
    expect(model.honesty.firstStepWidthShare).toBe(0);
    expect(model.levels[0].maxAsymmetry).toBeNull();
    expect(skanuj(model)).toEqual([]);
  });

  // Bramka `blockMatrix` szuka w `textContent` napisów "NaN", "undefined"
  // i "[object Object]", więc żadne pole modelu nie może ich wyprodukować
  // przy ŻADNYM wejściu. Ten test przechodzi po wejściach patologicznych
  // hurtem, bo defekt tego rodzaju siedzi zwykle w kombinacji, której nikt
  // nie napisał ręcznie.
  it("NIGDY nie wypuszcza NaN, Infinity ani undefined", () => {
    const patologie: { categories: string[]; series: ChartSeries[]; opts: FanOptions }[] = [
      { categories: [], series: [], opts: {} },
      { categories: [""], series: [seria("", [])], opts: { forecastFrom: 1, bandPct: 99 } },
      {
        categories: ["I", "II"],
        series: [seria("dolna", [1, 2]), seria("górna", [3, 4])],
        opts: { forecastFrom: 1 },
      },
      {
        categories: ["I", "II", "III"],
        series: [seria("P50", [0, 0, 0]), seria("P1", [0, 0, 0]), seria("P99", [0, 0, 0])],
        opts: { forecastFrom: 1 },
      },
      {
        categories: ["I", "II"],
        series: [seria("Centralna", [null, null])],
        opts: { forecastFrom: 1, levels: [{ confidence: 50, pct: 1e308 }] },
      },
      {
        categories: ["I", "II", "III"],
        series: [
          seria("Centralna", [1e15, -1e15, 1e15]),
          seria("95% dolna", [null, -1e15, -1e15]),
          seria("95% górna", [null, 1e15, 1e15]),
        ],
        opts: { forecastFrom: 1 },
      },
      {
        categories: ["I", "II"],
        series: [seria("Centralna", [1, 2])],
        opts: { forecastFrom: 1, bandPct: Number.NaN },
      },
      {
        categories: ["I", "II"],
        series: [seria("Centralna", [1, 2])],
        opts: { forecastFrom: Number.NaN, bandPct: 10 },
      },
      {
        categories: ["I", "II"],
        series: [seria("Centralna", [1, 2])],
        opts: { forecastFrom: 1, centralSeriesIndex: 99 },
      },
    ];
    for (const p of patologie) {
      const model = fanModel(wejscie(p.categories, p.series), p.opts);
      expect(skanuj(model)).toEqual([]);
    }
  });
});

describe("fanModel: pierścienie i zakres", () => {
  // Bez tego testu renderer malowałby trzy pełne pasma jedno na drugim i
  // najwęższe wychodziło na krycie 0,27 przy alfie 0,10 - dwa i pół raza
  // ciemniejsze od projektu i poza korytarzem 1,10-1,17:1.
  it("dzieli zagnieżdżone pasma na NIENAKŁADAJĄCE SIĘ pierścienie", () => {
    const model = fanModel(wejscie(OKRESY, PASMA_POPRAWNE), OD_PROGNOZY);
    expect(model.ringsComplete).toBe(true);
    // Dwie warstwy zewnętrzne dają po dwa paski, najwęższa jeden rdzeń.
    expect(model.rings.map((r) => `${r.layer}:${r.side}`)).toEqual([
      "0:lower",
      "0:upper",
      "1:lower",
      "1:upper",
      "2:core",
    ]);
    // Suma pierścieni pokrywa pasmo najszersze bez dziur i bez zakładek.
    const krok = 7;
    const paski = model.rings
      .flatMap((r) => r.segments.flat())
      .filter((s) => s.index === krok)
      .map((s) => [s.from, s.to] as const)
      .sort((a, b) => a[0] - b[0]);
    expect(paski[0][0]).toBe(110);
    expect(paski[paski.length - 1][1]).toBe(146);
    for (let i = 1; i < paski.length; i++) {
      expect(paski[i][0]).toBeCloseTo(paski[i - 1][1], 10);
    }
  });

  // Bez tego testu pierścień sięgałby przez krok, w którym węższego pasma
  // nie ma, i najwęższy poziom pewności znikałby dokładnie tam, gdzie ma lukę.
  it("mówi, że pierścienie są NIEKOMPLETNE, gdy poziomy mają różne kroki", () => {
    const model = fanModel(
      wejscie(
        ["I", "II", "III"],
        [
          seria("Centralna", [10, 20, 30]),
          seria("50% dolna", [null, 18, null]),
          seria("50% górna", [null, 22, null]),
          seria("95% dolna", [null, 15, 20]),
          seria("95% górna", [null, 25, 40]),
        ],
      ),
      { forecastFrom: 1 },
    );
    expect(model.ringsComplete).toBe(false);
    // Pełne pasma zostają do dyspozycji renderu razem z głębokością krycia.
    expect(model.levels.map((l) => l.overlapDepth)).toEqual([0, 1]);
  });

  // Bez tego testu skala liczona z samej linii przycinałaby pasmo krawędzią
  // rysunku, a przycięte pasmo sugeruje, że niepewność KOŃCZY SIĘ tam, gdzie
  // kończy się obszar kreślenia.
  it("obejmuje zakresem KRAWĘDZIE pasm, nie tylko ścieżkę centralną", () => {
    const model = fanModel(wejscie(OKRESY, PASMA_POPRAWNE), OD_PROGNOZY);
    const zakres = fanExtent(model);
    expect(zakres.min).toBe(100);
    expect(zakres.max).toBe(146);
    // Zero NIE jest domykane: wachlarz jest rodzajem liniowym, a domknięcie
    // zera na dużych poziomach spłaszczyłoby pasma do niewidoczności.
    expect(zakres.min).toBeGreaterThan(0);
  });

  // Bez tego testu wykres bez ani jednej liczby dawał zakres
  // [Infinity, -Infinity] i skala wychodziła z NaN.
  it("oddaje sensowny zakres, gdy nie ma ani jednej liczby", () => {
    const model = fanModel(wejscie(["I", "II"], [seria("Puste", [null, null])]), {});
    expect(fanExtent(model)).toEqual({ min: 0, max: 1 });
  });
});

describe("fanTable: alternatywa tekstowa", () => {
  // Bez tego testu krawędź pasma zostawałaby wyłącznie w grafice - a to
  // jedyna liczba na tym wykresie, której nie da się odczytać z rysunku:
  // pasmo ma 10-11% krycia i nie ma przy sobie podziałki.
  it("oddaje krawędzie WSZYSTKICH poziomów w kolejności kroków czasu", () => {
    const tabela = fanTable(fanModel(wejscie(OKRESY, PASMA_POPRAWNE), OD_PROGNOZY));
    expect(tabela.rows.map((r) => r.label)).toEqual(OKRESY);
    expect(tabela.levels.map((l) => l.confidence)).toEqual([95, 80, 50]);
    expect(tabela.hasKnownConfidence).toBe(true);
    expect(tabela.observationCount).toBe(5);
    const ostatni = tabela.rows[7];
    expect(ostatni.phase).toBe("forecast");
    expect(ostatni.central).toBe(128);
    expect(ostatni.bands.map((b) => [b.lower, b.upper])).toEqual([
      [110, 146],
      [116, 140],
      [122, 134],
    ]);
    expect(ostatni.bands.map((b) => b.width)).toEqual([36, 24, 12]);
  });

  // Bez tego testu tabela podawałaby prognozę i pomiar w jednej kolumnie
  // liczb, a wtedy cała ostrożność wykresu kończy się w momencie, w którym
  // ktoś skopiuje liczby do arkusza.
  it("rozdziela fazy i oznacza krok granicy", () => {
    const tabela = fanTable(fanModel(wejscie(OKRESY, PASMA_POPRAWNE), OD_PROGNOZY));
    expect(tabela.rows.filter((r) => r.phase === "history")).toHaveLength(5);
    expect(tabela.rows.filter((r) => r.phase === "forecast")).toHaveLength(3);
    expect(tabela.rows[4].notes).toContain("boundary");
  });

  // Bez tego testu nagłówek kolumny mógłby dopisać "95%" do pasma, którego
  // pewności autor nie podał - czyli dopisać liczbę za autora.
  it("mówi, że pewność jest NIEZNANA, gdy pasmo pochodzi z procentu", () => {
    const tabela = fanTable(fanModel(wejscie(OKRESY, [CENTRUM]), { forecastFrom: 5, bandPct: 12 }));
    expect(tabela.bandSource).toBe("bandPct");
    expect(tabela.hasKnownConfidence).toBe(false);
    expect(tabela.levels[0].confidence).toBeNull();
  });

  // Bez tego testu przypisy w tabeli mogłyby rozjechać się z orzeczeniami
  // uczciwości i podpis mówiłby o innym kroku niż tabela.
  it("nosi przy wierszu te same fakty, co orzeczenia uczciwości", () => {
    const model = fanModel(
      wejscie(
        ["I", "II", "III", "IV"],
        [
          seria("Centralna", [10, null, 30, 100]),
          seria("80% dolna", [null, 20, 35, 20]),
          seria("80% górna", [null, 20, 25, 30]),
        ],
      ),
      { forecastFrom: 1 },
    );
    const tabela = fanTable(model);
    expect(tabela.rows[1].notes).toContain("gap");
    expect(tabela.rows[1].notes).toContain("zeroWidth");
    // Krok III: para odwrócona, ale PO NAPRAWIE geometrii pasmo obejmuje
    // centrum - więc jest przypis o odwróceniu i nie ma przypisu o centrum
    // poza pasmem. Zawieranie sprawdzamy na tej geometrii, którą renderer
    // narysuje, bo inaczej podpis mówiłby o kształcie, którego nie ma na
    // obrazku.
    expect(tabela.rows[2].notes).toContain("inverted");
    expect(tabela.rows[2].notes).not.toContain("centralOutside");
    // Krok IV: pasmo mija centrum i to jest osobny defekt.
    expect(tabela.rows[3].notes).toContain("centralOutside");
    expect(model.honesty.bandsContainCentral).toBe(false);
    expect(model.honesty.centralOutsideLabels).toEqual(["IV"]);
    expect(skanuj(model)).toEqual([]);
  });
});

describe("fanFormAdvice", () => {
  // Bez tego testu autor, który wybrał wachlarz i nie ma prognozy ani pasma,
  // nie dostaje ani jednego zdania o tym, czego brakuje.
  it("mówi, czego brakuje, żeby wachlarz był wachlarzem", () => {
    const goly = fanModel(wejscie(OKRESY, [CENTRUM]), {});
    expect(fanFormAdvice(goly)).toEqual(expect.arrayContaining(["noForecast", "noBand"]));

    const jedno = fanModel(wejscie(OKRESY, [CENTRUM]), { forecastFrom: 5, bandPct: 10 });
    expect(fanFormAdvice(jedno)).toContain("singleLevel");
    expect(fanFormAdvice(jedno)).not.toContain("noBand");

    const trzy = fanModel(wejscie(OKRESY, PASMA_POPRAWNE), OD_PROGNOZY);
    expect(fanFormAdvice(trzy)).toEqual([]);
  });

  // Bez tego testu jeden krok prognozy przechodziłby jako wachlarz, a jest
  // słupkiem błędu przy ostatnim punkcie: pasmo nie ma się od czego rozchodzić.
  it("zgłasza jeden krok prognozy jako zbyt krótki horyzont", () => {
    const model = fanModel(wejscie(["I", "II"], [seria("PKB", [10, 12])]), {
      forecastFrom: 1,
      bandPct: 10,
    });
    expect(model.boundary?.forecastCount).toBe(1);
    expect(model.boundary?.forecastCount).toBeLessThan(FAN_MIN_FORECAST_STEPS);
    expect(fanFormAdvice(model)).toContain("singleForecastStep");
  });

  // Bez tego testu piąty poziom pewności wchodziłby na wykres, choć korytarz
  // krycia pasma (1,10-1,17:1 do płyty) nie ma już dla niego rozdzielczości.
  it("zgłasza nadmiar poziomów pewności", () => {
    const model = fanModel(wejscie(OKRESY, [CENTRUM]), {
      forecastFrom: 5,
      levels: [
        { confidence: 99, pct: 30 },
        { confidence: 95, pct: 24 },
        { confidence: 90, pct: 18 },
        { confidence: 80, pct: 12 },
        { confidence: 50, pct: 6 },
      ],
    });
    expect(model.levels.length).toBeGreaterThan(FAN_LEVELS_ADVICE_MAX);
    expect(fanFormAdvice(model)).toContain("tooManyLevels");
    // Poziomy jawne muszą wyjść ZAGNIEŻDŻONE i wokół centrum - inaczej
    // rozszerzenie konfiguracji produkowałoby defekt przy poprawnym wejściu.
    expect(model.honesty.bandsNested).toBe(true);
    expect(model.honesty.bandsContainCentral).toBe(true);
    expect(model.honesty.confidenceMatchesWidth).toBe(true);
    expect(skanuj(model)).toEqual([]);
  });
});
