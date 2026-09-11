// ALTERNATYWY TEKSTOWE CZTERECH RODZAJÓW BEZ RYSUNKU - CO MUSI BYĆ PRAWDĄ
// O TABELI.
//
// CZEGO TU NIE MA. Arytmetyka pasm, indeksów, udziałów i paneli ma własne
// pliki testowe przy modelach; tutaj sprawdzam wyłącznie to, czego model
// sprawdzić nie może - czy TABELA mówi to, co model policzył, w języku, który
// dostała propsem, i czy milczenie modelu zostaje milczeniem.
//
// ŻADNYCH MIGAWEK HTML. Migawka oblewa się na przestawionej klasie i przechodzi
// na podmienionym kluczu słownika, czyli jest czerwona dokładnie tam, gdzie nic
// się nie stało, i zielona tam, gdzie coś się stało.
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { parseChartConfig } from "@/lib/charts/parse";
import type { Json } from "@/lib/content-model/json";
import type { ChartConfig } from "@/lib/charts/types";
import type { ChartLang } from "@/lib/charts/format";
import i18n from "@/lib/i18n";
import "@/lib/i18n-charts";
import type { FanBandSource, FanCentralSource, FanRowNote } from "@/lib/charts/kinds/fanChart";
import type {
  IndexBaseRejection,
  IndexBaseSeriesNote,
  IndexBaseSource,
} from "@/lib/charts/kinds/indexBase";
import type {
  PercentStackedCellNote,
  PercentStackedRowNote,
} from "@/lib/charts/kinds/percentStacked";
import type {
  SmallMultiplesOrder,
  SmallMultiplesScaleMode,
} from "@/lib/charts/kinds/smallMultiples";
import {
  FanDataTable,
  IndexBaseDataTable,
  PercentStackedDataTable,
  SmallMultiplesDataTable,
} from "../Chart";

/**
 * Konfiguracja PRZEZ PARSER bloku, nie literałem `ChartConfig`: literał
 * trzeba by dopisywać przy każdym nowym polu konfiguracji, a parser jest tą
 * samą drogą, którą arkusz autora wchodzi do silnika. `kind` jest tu obojętny,
 * bo żaden z czterech rodzajów nie jest jeszcze w `CHART_KINDS` - tabele
 * renderuję wprost, a nie przez rozdzielnik ramki.
 */
const cfg = (d: Record<string, Json>): ChartConfig =>
  parseChartConfig({ kind: "line", animate: false, ...d });

const tekst = (config: ChartConfig, lang: ChartLang, Tabela: typeof FanDataTable): string =>
  render(<Tabela config={config} lang={lang} />).container.textContent ?? "";

/** Wiersze ciała tabeli o podanym numerze, komórka po komórce. */
function wiersze(
  config: ChartConfig,
  lang: ChartLang,
  Tabela: typeof FanDataTable,
  numer = 0,
): string[][] {
  const { container } = render(<Tabela config={config} lang={lang} />);
  const tabela = container.querySelectorAll("table")[numer];
  return [...tabela.querySelectorAll("tbody tr")].map((tr) =>
    [...tr.querySelectorAll("th,td")].map((c) => c.textContent ?? ""),
  );
}

/**
 * Ścieżka klucza słownika, która wyciekła na stronę zamiast zdania. Wzorzec
 * jest tu ważniejszy niż wygląda: bramka parytetu PL/EN pilnuje kluczy
 * OBECNYCH, a klucz, którego nie ma w żadnym języku, przechodzi przez nią
 * niezauważony i ląduje w tabeli jako własna nazwa - tak na stronie publicznej
 * stanął kiedyś napis „tornado.note.oneLegged".
 */
const KLUCZ = /\b(fan|indexBase|percentStacked|smallMultiples)\.[a-z]/;

const JEZYKI = ["pl", "en"] as const;

/**
 * Wszystkie wartości unii, wypisane jako `Record<Unia, true>`. Kompilator
 * pilnuje wyczerpania (brakująca wartość to błąd typu), a `Object.keys` daje
 * z tego listę runtime - inaczej test przechodziłby pętlą po trzech wartościach
 * unii o siedmiu i nazywał to kompletem.
 */
const klucze = <T extends string>(mapa: Record<T, true>): T[] => Object.keys(mapa) as T[];

const FAN_NOTES = klucze<FanRowNote>({
  gap: true,
  centralOutside: true,
  crossing: true,
  zeroWidth: true,
  inverted: true,
  bandOverHistory: true,
  bandGap: true,
  narrowing: true,
  anchor: true,
  boundary: true,
});

const FAN_BAND_SOURCES = klucze<FanBandSource>({
  series: true,
  levels: true,
  bandPct: true,
  none: true,
});

const FAN_CENTRAL_SOURCES = klucze<FanCentralSource>({
  option: true,
  name: true,
  fallback: true,
  none: true,
});

const INDEX_REJECTIONS = klucze<IndexBaseRejection>({
  missingBase: true,
  zeroBase: true,
  negativeBase: true,
});

const INDEX_NOTES = klucze<IndexBaseSeriesNote>({
  noBase: true,
  extremeBase: true,
  mixedSign: true,
  unrepresentable: true,
  flat: true,
});

const INDEX_SOURCES = klucze<IndexBaseSource>({ explicit: true, first: true, none: true });

const PS_CELL_NOTES = klucze<PercentStackedCellNote>({
  zero: true,
  missing: true,
  negative: true,
  tooLarge: true,
  noShare: true,
});

const PS_ROW_NOTES = klucze<PercentStackedRowNote>({
  empty: true,
  zeroTotal: true,
  rejected: true,
  incomplete: true,
  rescaled: true,
  duplicate: true,
});

const SM_ORDERS = klucze<SmallMultiplesOrder>({
  mean: true,
  max: true,
  span: true,
  last: true,
  label: true,
  input: true,
});

const SM_SCALES = klucze<SmallMultiplesScaleMode>({ shared: true, free: true });

/**
 * Czy `prefiks.wartosc` jest ZDANIEM w obu językach. i18next na kluczu bez
 * treści zwraca sam klucz, więc porównanie z nim wykrywa dokładnie ten defekt,
 * który wypuszcza ścieżkę na stronę; `{{` łapie drugi, cichszy: wstawkę, której
 * nikt nie wypełnił, i18next zostawia w zdaniu SUROWĄ.
 */
function zdaniaUnii(prefiks: string, wartosci: readonly string[]): void {
  for (const jezyk of JEZYKI) {
    for (const w of wartosci) {
      const klucz = `charts.${prefiks}.${w}`;
      const tresc = i18n.t(klucz, { lng: jezyk });
      expect(tresc, `${klucz} (${jezyk}) nie ma treści`).not.toBe(klucz);
      expect(tresc, `${klucz} (${jezyk}) jest pustym napisem`).not.toBe("");
      expect(tresc, `${klucz} (${jezyk}) zostawia surową wstawkę`).not.toContain("{{");
    }
  }
}

/* ------------------------------------------------------------------ *
 * WACHLARZ                                                            *
 * ------------------------------------------------------------------ */

/** Dwa kroki historii i dwa prognozy, pasma podane parą serii. */
const WACHLARZ = cfg({
  categories: ["2023", "2024", "2025", "2026"],
  series: [
    { name: "Ścieżka centralna", values: [10000, 10400, 10800, 11200] },
    { name: "Dolna 80%", values: [null, null, 10200, 10400] },
    { name: "Górna 80%", values: [null, null, 11400, 12000] },
  ],
  forecastFrom: 2,
  unit: " mld EUR",
});

/**
 * Arkusz dobrany tak, żeby model NAPRAWDĘ wykrył komplet defektów: luka
 * centrum, pasmo nad historią, para odwrócona, krawędź mijająca centrum,
 * zerowa szerokość i zwężenie wobec kroku poprzedniego.
 */
const WACHLARZ_WADLIWY = cfg({
  categories: ["2020", "2021", "2022", "2023"],
  series: [
    { name: "Ścieżka centralna", values: [100, null, 108, 112] },
    { name: "Dolna 80%", values: [95, 99, 130, 110] },
    { name: "Górna 80%", values: [105, 101, 120, 110] },
  ],
  forecastFrom: 2,
  unit: "",
});

describe("alternatywa tekstowa wachlarza", () => {
  it("nie wypuszcza surowej wstawki ani ścieżki klucza", () => {
    // Bez tego przeszłoby „Pasmo {{confidence}}%" - i18next zostawia
    // niewypełnioną wstawkę SUROWĄ, a żadna bramka i18n tego nie widzi, bo
    // klucz istnieje i ma treść w obu językach. Brakuje wyłącznie LICZBY.
    for (const jezyk of JEZYKI) {
      for (const arkusz of [WACHLARZ, WACHLARZ_WADLIWY]) {
        const t = tekst(arkusz, jezyk, FanDataTable);
        expect(t).not.toContain("{{");
        expect(t).not.toMatch(KLUCZ);
      }
    }
  });

  it("krok bez pasma dostaje kreskę, a nie zero", () => {
    // Model oddaje w kroku historycznym `lower/upper/width === null`, czyli
    // MILCZY. Zero wpisane w te komórki czytałoby się jak przedział zwężony do
    // punktu - twierdzenie „tę wartość znam dokładnie", mocniejsze niż
    // cokolwiek na rysunku, i nie do odróżnienia od liczby policzonej.
    const [rok2023] = wiersze(WACHLARZ, "pl", FanDataTable);
    expect(rok2023.slice(-3)).toEqual(["-", "-", "-"]);
    expect(rok2023.slice(-3)).not.toContain("0");
  });

  it("krawędzie pasma prognozy stoją liczbą, nie kreską", () => {
    // Odwrotna strona poprzedniego testu: gdyby tabela dawała kreskę wszędzie,
    // pierwszy test byłby zielony na tabeli, która nie pokazuje NICZEGO -
    // a krawędź pasma jest jedyną liczbą wachlarza, której nie ma na rysunku.
    const [, , rok2025] = wiersze(WACHLARZ, "pl", FanDataTable);
    expect(rok2025.slice(-3)).toEqual([
      "10\u00A0200 mld EUR",
      "11\u00A0400 mld EUR",
      "1200 mld EUR",
    ]);
  });

  it("ta sama tabela czyta się inaczej po polsku i po angielsku", () => {
    // Język jedzie PROPSEM, nie z `i18n.language`. Strony publiczne są
    // cache'owane na brzegu sieci, więc odczyt z singletona serwowałby polski
    // tekst pod angielskim adresem - a test w jednym języku tego nie widzi.
    // Twarda spacja U+00A0 stoi w oczekiwaniu wprost, bo pl-PL grupuje nią
    // tysiące i normalizacja białych znaków zamiotłaby różnicę pod dywan.
    // Zapisana ESCAPE'em, a nie samym znakiem: w źródle wygląda identycznie
    // jak zwykła spacja, więc pierwsza poprawka „literówki" przez kogoś, kto
    // jej nie widzi, cicho rozbraja ten test.
    const pl = tekst(WACHLARZ, "pl", FanDataTable);
    const en = tekst(WACHLARZ, "en", FanDataTable);
    expect(pl).toContain("10\u00A0000 mld EUR");
    expect(pl).toContain("Prognoza");
    expect(pl).not.toContain("10,000");
    expect(en).toContain("10,000 mld EUR");
    expect(en).toContain("Forecast");
    expect(en).not.toContain("10\u00A0000");
  });

  it("pasmo bez podanej pewności nie dostaje procentu", () => {
    // Autor, który podał samą szerokość (±12%), NIE podał poziomu pewności.
    // Nagłówek „Pasmo 12%" przypisałby mu liczbę, której nie policzył, a przy
    // pasmach z serii ta sama liczba znaczy co innego.
    const bezPewnosci = cfg({
      categories: ["2023", "2024", "2025"],
      series: [{ name: "Ścieżka centralna", values: [100, 104, 108] }],
      forecastFrom: 2,
      forecastBandPct: 12,
      unit: " mld EUR",
    });
    const pl = tekst(bezPewnosci, "pl", FanDataTable);
    expect(pl).toContain("Pasmo o nieznanej pewności");
    expect(pl).not.toContain("Pasmo 12%");
  });

  it("każdy przypis wiersza ma zdanie w obu językach", () => {
    // Unia ma dziewięć wartości. Gdyby słownik miał siedem, dwa wiersze
    // dostałyby w tabeli własną ścieżkę klucza zamiast zdania - dokładnie to
    // stało się kiedyś tornadu i przez to nie łapie tego żadna z trzech bramek
    // i18n: klucza bez treści nie ma z czym porównać.
    zdaniaUnii("fan.note", FAN_NOTES);
  });

  it("wykryte przypisy wychodzą zdaniem przy swoim wierszu", () => {
    // Sam komplet w słowniku nie dowodzi, że mapa renderu wskazuje WŁAŚCIWY
    // klucz: `gap: "fan.note.crossing"` przeszłoby poprzedni test i pisałoby
    // przy luce zdanie o przecinających się krawędziach.
    const [, rok2021, rok2022, rok2023] = wiersze(WACHLARZ_WADLIWY, "pl", FanDataTable);
    expect(rok2021[0]).toContain("brak wartości centralnej w tym kroku");
    expect(rok2021[0]).toContain("ostatnia obserwacja");
    expect(rok2022[0]).toContain("para krawędzi odwrócona");
    expect(rok2023[0]).toContain("zerowej szerokości");
    expect(rok2023[0]).toContain("węższe niż w kroku poprzednim");
  });

  it("źródło pasm i ścieżki centralnej ma zdanie w obu językach", () => {
    // Cztery wartości każdej unii, a rysunek pokazuje tylko jedną naraz -
    // wartość bez treści ujawniłaby się dopiero na arkuszu, który akurat w nią
    // trafi, czyli u czytelnika.
    zdaniaUnii("fan.bandSource", FAN_BAND_SOURCES);
    zdaniaUnii("fan.centralSource", FAN_CENTRAL_SOURCES);
  });

  it("mówi, skąd wzięły się pasma i ścieżka centralna", () => {
    // Pasmo z `forecastBandPct` deklaruje SZEROKOŚĆ, a nie pewność, i tabela
    // musi to powiedzieć - inaczej czytelnik czyta ±12% jak przedział ufności.
    const pl = tekst(WACHLARZ, "pl", FanDataTable);
    expect(pl).toContain("Krawędzie pasm pochodzą z par serii");
    expect(pl).toContain("Ścieżkę centralną rozpoznano po nazwie serii");
  });

  it("liczebność obserwacji nie dostaje jednostki danych", () => {
    // „2 mld EUR" zamiast „2 obserwacje" jest zdaniem fałszywym o próbce,
    // a wygląda dokładnie tak samo wiarygodnie jak wartość.
    const pl = tekst(WACHLARZ, "pl", FanDataTable);
    expect(pl).toContain("Obserwacje: 2");
    expect(pl).not.toContain("Obserwacje: 2 mld EUR");
  });

  it("pusty arkusz, jedna kategoria i same luki nie wywracają tabeli", () => {
    // Trzy stany, w których model nie ma czego policzyć. Render, który na nich
    // rzuca wyjątkiem, wywala CAŁY wpis, a nie tylko wykres - a arkusz
    // z jedną kategorią jest zwykłym stanem pośrednim w edytorze.
    for (const arkusz of [PUSTO, JEDNA_KATEGORIA, SAME_LUKI]) {
      const t = tekst(arkusz, "pl", FanDataTable);
      expect(t).not.toContain("{{");
      expect(t).not.toMatch(KLUCZ);
      expect(t).not.toContain("NaN");
    }
  });
});

/* ------------------------------------------------------------------ *
 * WSPÓLNE ARKUSZE BRZEGOWE                                            *
 * ------------------------------------------------------------------ */

const PUSTO = cfg({ categories: [], series: [] });

const JEDNA_KATEGORIA = cfg({
  categories: ["A"],
  series: [{ name: "Seria", values: [5] }],
  unit: " mld EUR",
});

const SAME_LUKI = cfg({
  categories: ["A", "B"],
  series: [{ name: "Seria", values: [null, null] }],
  unit: " mld EUR",
});

/* ------------------------------------------------------------------ *
 * LINIA NA INDEKSIE                                                   *
 * ------------------------------------------------------------------ */

/** Seria zdrowa, seria o bazie zerowej i seria bez wartości w bazie. */
const INDEKS = cfg({
  categories: ["2020", "2021", "2022"],
  series: [
    { name: "Polska", values: [12345, 13000, 14000] },
    { name: "Zero", values: [0, 5, 7] },
  ],
  unit: " mld EUR",
});

const INDEKS_ODRZUCENIA = cfg({
  categories: ["2020", "2021", "2022"],
  series: [
    { name: "Ujemna", values: [-10, -12, -14] },
    { name: "Płaska", values: [50, 50, 50] },
    { name: "Luka", values: [null, 5, 7] },
  ],
  unit: " mld EUR",
});

describe("alternatywa tekstowa linii na indeksie", () => {
  it("nie wypuszcza surowej wstawki ani ścieżki klucza", () => {
    // Nagłówek kolumny źródłowej i podpis bazy mają wstawki (`{{unit}}`,
    // `{{period}}`); niewypełniona zostaje na stronie surowa i nie widzi jej
    // żadna bramka, bo klucz i treść istnieją.
    for (const jezyk of JEZYKI) {
      for (const arkusz of [INDEKS, INDEKS_ODRZUCENIA]) {
        const t = tekst(arkusz, jezyk, IndexBaseDataTable);
        expect(t).not.toContain("{{");
        expect(t).not.toMatch(KLUCZ);
      }
    }
  });

  it("indeks bez bazy dostaje kreskę, a nie zero ani sto", () => {
    // Seria o bazie zerowej nie ma indeksu w ŻADNYM okresie - model milczy
    // (`indexed === null`). Zero czytałoby się jak spadek do dna, a sto jak
    // brak zmiany; obie liczby wyglądają równie wiarygodnie jak policzone.
    const [rok2020, rok2021] = wiersze(INDEKS, "pl", IndexBaseDataTable);
    expect(rok2020[rok2020.length - 1]).toBe("-");
    expect(rok2021[rok2021.length - 1]).toBe("-");
  });

  it("wartość źródłowa stoi obok indeksu i tylko ona ma jednostkę", () => {
    // Indeks jest ILORAZEM dwóch wartości w tej samej jednostce, więc jest
    // bezwymiarowy - „100 mld EUR" byłoby zdaniem fałszywym o każdej liczbie
    // w kolumnie. A tabela bez kolumny źródłowej zamieniłaby przeliczenie
    // danych w ich podmianę: poziomu nie byłoby w bloku nigdzie.
    const [rok2020] = wiersze(INDEKS, "pl", IndexBaseDataTable);
    expect(rok2020[1]).toBe("12\u00A0345 mld EUR");
    expect(rok2020[2]).toBe("100");
  });

  it("wiersz bazowy jest oznaczony", () => {
    // To jedyne miejsce, w którym czytelnik widzi, wobec czego czyta cały
    // wykres. Bez oznaczenia setka w pierwszym wierszu wygląda na pomiar.
    const [rok2020, rok2021] = wiersze(INDEKS, "pl", IndexBaseDataTable);
    expect(rok2020[0]).toContain("wiersz bazowy");
    expect(rok2021[0]).not.toContain("wiersz bazowy");
  });

  it("seria odrzucona zostaje w tabeli z nazwanym powodem", () => {
    // Seria nieobecna wśród obecnych czyta się jako „nie było takiego
    // szeregu", a nie jako „nie dało się go zaindeksować" - a to jest różnica
    // między brakiem danych a defektem wyboru bazy.
    const status = wiersze(INDEKS_ODRZUCENIA, "pl", IndexBaseDataTable, 1);
    expect(status.map((w) => w[0])).toEqual(["Ujemna", "Płaska", "Luka"]);
    expect(status[0][3]).toContain("wartość bazowa jest ujemna");
    expect(status[2][3]).toContain("nie ma wartości");
  });

  it("każda przyczyna odrzucenia i każdy przypis serii ma zdanie w obu językach", () => {
    // Trzy przyczyny i pięć przypisów. Wartość bez treści ujawnia się dopiero
    // na arkuszu, który akurat w nią trafi - czyli u czytelnika, nie w CI.
    zdaniaUnii("indexBase.rejection", INDEX_REJECTIONS);
    zdaniaUnii("indexBase.note", INDEX_NOTES);
    zdaniaUnii("indexBase.base.source", INDEX_SOURCES);
  });

  it("podpis nazywa okres bazowy i bezjednostkowość osi", () => {
    // Podpis urwany na „= 100" nie mówi, wobec którego okresu liczona jest
    // każda liczba na rysunku, a oś podpisana jednostką autora byłaby zdaniem
    // fałszywym o wszystkich wartościach naraz.
    const pl = tekst(INDEKS, "pl", IndexBaseDataTable);
    expect(pl).toContain("Baza: 2020 = 100");
    expect(pl).toContain("Wartości na osi są bezjednostkowe");
  });

  it("bez okresu bazowego NIE ogłasza bazy równej stu", () => {
    // Defekt, który ten test pinuje: `base.label` brzmi „Baza: {{period}} = 100",
    // a przy arkuszu bez osi okresów model daje `baseLabel` PUSTY. Wychodziło
    // z tego „Baza:  = 100" - zdanie TWIERDZĄCE, że jakiś okres bazowy równa
    // się stu, postawione bezpośrednio przed zdaniem mówiącym, że okresu
    // bazowego nie ma. Żadna bramka i18n tego nie widziała, bo wstawka BYŁA
    // wypełniona: pustego napisu nie da się odróżnić od nazwy okresu.
    for (const lang of JEZYKI) {
      const t = tekst(PUSTO, lang, IndexBaseDataTable);
      expect(t).not.toMatch(/Baza:\s+=/);
      expect(t).not.toMatch(/Base:\s+=/);
      // Podwójna spacja jest tu objawem, nie przyczyną - pinuję oba.
      expect(t).not.toContain("  ");
    }
    // Przyczyna zostaje wypowiedziana: to ona niesie całą treść podpisu.
    expect(tekst(PUSTO, "pl", IndexBaseDataTable)).toContain("nie ma okresu bazowego");
    // A tam, gdzie okres bazowy JEST, podpis nadal go nazywa.
    expect(tekst(INDEKS, "pl", IndexBaseDataTable)).toContain("Baza: 2020 = 100");
  });

  it("podpis tabeli baz NAZYWA tabelę, a nie powtarza nagłówka kolumny", () => {
    // Oba stały wcześniej na jednym kluczu `indexBase.table.status`, więc
    // czytelnik ekranu słyszał „Status serii" najpierw jako nazwę tabeli,
    // a potem jako nagłówek jednej z jej kolumn - z podpisu nie dowiadywał
    // się, czego tabela dotyczy. Test pyta o RÓŻNICĘ, nie o konkretne słowa.
    for (const lang of JEZYKI) {
      const { container } = render(<IndexBaseDataTable config={INDEKS_ODRZUCENIA} lang={lang} />);
      const podpisy = [...container.querySelectorAll("table caption")].map(
        (c) => c.textContent ?? "",
      );
      expect(podpisy.length).toBeGreaterThan(0);
      for (const podpis of podpisy) {
        expect(podpis.length).toBeGreaterThan(0);
        const naglowki = [...container.querySelectorAll("table thead th")].map(
          (th) => th.textContent ?? "",
        );
        expect(naglowki, `podpis „${podpis}" powtarza nagłówek kolumny`).not.toContain(podpis);
      }
    }
  });

  it("pusty arkusz, jedna kategoria i same luki nie wywracają tabeli", () => {
    for (const arkusz of [PUSTO, JEDNA_KATEGORIA, SAME_LUKI]) {
      const t = tekst(arkusz, "pl", IndexBaseDataTable);
      expect(t).not.toContain("{{");
      expect(t).not.toMatch(KLUCZ);
      expect(t).not.toContain("NaN");
    }
  });
});

/* ------------------------------------------------------------------ *
 * SŁUPEK SKUMULOWANY 100%                                             *
 * ------------------------------------------------------------------ */

/** Słupek pełny, słupek odrzucony wartością ujemną i kategoria bez liczb. */
const STOS = cfg({
  categories: ["A", "B", "C"],
  series: [
    { name: "Usługi", values: [30000, 0, null] },
    { name: "Przemysł", values: [70000, -5, null] },
  ],
  unit: " mld EUR",
});

describe("alternatywa tekstowa stosu 100%", () => {
  it("nie wypuszcza surowej wstawki ani ścieżki klucza", () => {
    for (const jezyk of JEZYKI) {
      const t = tekst(STOS, jezyk, PercentStackedDataTable);
      expect(t).not.toContain("{{");
      expect(t).not.toMatch(KLUCZ);
    }
  });

  it("suma bezwzględna stoi przy każdym udziale", () => {
    // Stos 100% z definicji WYRZUCA poziom: dwa słupki o identycznej
    // strukturze mogą różnić się rzędem wielkości i wyglądają wtedy tak samo.
    // Tabela jest jedynym miejscem, w którym czytelnik tę różnicę zobaczy.
    const [uslugiA, przemyslA] = wiersze(STOS, "pl", PercentStackedDataTable);
    expect(uslugiA.slice(1, 5)).toEqual([
      "Usługi",
      "30\u00A0000 mld EUR",
      "30%",
      "100\u00A0000 mld EUR",
    ]);
    expect(przemyslA[4]).toBe("100\u00A0000 mld EUR");
  });

  it("brak liczby to kreska, a nie zero", () => {
    // Zero jest POMIAREM, brak jest nieuzupełnionym polem - i to jest w tej
    // formie różnica strukturalna, bo zero wchodzi do mianownika, a brak nie.
    // Jedna kreska na oba dawałaby udziały liczone z innej całości.
    const [, , uslugiB, , uslugiC] = wiersze(STOS, "pl", PercentStackedDataTable);
    expect(uslugiB[2]).toBe("0 mld EUR");
    expect(uslugiC[2]).toBe("-");
  });

  it("udział bez mianownika jest kreską, a nie zerem procent", () => {
    // Słupek odrzucony i słupek pusty nie mają mianownika, a model oddaje
    // w obu `total: 0`. „0%" wpisane w tę komórkę czytałoby się jak zmierzony
    // udział zerowy, czyli jako wynik, którego nikt nie policzył.
    const [, , uslugiB] = wiersze(STOS, "pl", PercentStackedDataTable);
    expect(uslugiB[3]).toBe("-");
    expect(uslugiB[4]).toBe("-");
  });

  it("kategoria bez ani jednej liczby zostaje w tabeli", () => {
    // Kategoria, która stoi na osi bez słupka, jest faktem o danych. Tabela
    // bez jej wiersza mówiłaby, że autor jej nie wpisał.
    const etykiety = wiersze(STOS, "pl", PercentStackedDataTable).map((w) => w[0]);
    expect(etykiety.filter((e) => e.startsWith("C"))).toHaveLength(2);
  });

  it("każdy przypis komórki i wiersza ma zdanie w obu językach", () => {
    // Pięć stanów komórki i sześć stanów wiersza. Trzech z nich nie da się
    // wywołać arkuszem, który da się wpisać w edytorze, więc bez tej pętli
    // ujawniłyby się dopiero na stronie.
    zdaniaUnii("percentStacked.cellNote", PS_CELL_NOTES);
    zdaniaUnii("percentStacked.note", PS_ROW_NOTES);
  });

  it("wykryte przypisy wychodzą zdaniem przy swojej komórce i swoim wierszu", () => {
    // Dowód, że mapa renderu wskazuje WŁAŚCIWY klucz, a nie dowolny istniejący:
    // podmiana `missing` na `zero` przeszłaby poprzedni test i pisałaby przy
    // pustym polu, że składnik jest znany i wynosi zero.
    const w = wiersze(STOS, "pl", PercentStackedDataTable);
    expect(w[2][0]).toContain("słupek odrzucony");
    expect(w[3][5]).toContain("wartość ujemna");
    expect(w[4][0]).toContain("żadna seria nie podała w tej kategorii liczby");
    expect(w[4][5]).toContain("nieuzupełnione pole");
  });

  it("ta sama tabela czyta się inaczej po polsku i po angielsku", () => {
    const pl = tekst(STOS, "pl", PercentStackedDataTable);
    const en = tekst(STOS, "en", PercentStackedDataTable);
    expect(pl).toContain("30\u00A0000 mld EUR");
    expect(pl).toContain("Suma kategorii");
    expect(en).toContain("30,000 mld EUR");
    expect(en).toContain("Category total");
    expect(pl).not.toBe(en);
  });

  it("pusty arkusz, jedna kategoria i same luki nie wywracają tabeli", () => {
    for (const arkusz of [PUSTO, JEDNA_KATEGORIA, SAME_LUKI]) {
      const t = tekst(arkusz, "pl", PercentStackedDataTable);
      expect(t).not.toContain("{{");
      expect(t).not.toMatch(KLUCZ);
      expect(t).not.toContain("NaN");
    }
  });
});

/* ------------------------------------------------------------------ *
 * PANELE                                                              *
 * ------------------------------------------------------------------ */

/** Panel czytelny, panel spłaszczony wspólną osią i panel bez ani jednej liczby. */
const PANELE = cfg({
  categories: ["2020", "2021", "2022"],
  series: [
    { name: "Duży", values: [12345, 13000, 15000] },
    { name: "Mały", values: [1, 2, 3] },
    { name: "Pusty", values: [null, null, null] },
  ],
  unit: " mld EUR",
});

describe("alternatywa tekstowa paneli", () => {
  it("nie wypuszcza surowej wstawki ani ścieżki klucza", () => {
    for (const jezyk of JEZYKI) {
      const t = tekst(PANELE, jezyk, SmallMultiplesDataTable);
      expect(t).not.toContain("{{");
      expect(t).not.toMatch(KLUCZ);
    }
  });

  it("panel bez wartości dostaje kreski, a nie zera", () => {
    // Pusty panel znaczy BRAK DANYCH o tym podmiocie, a nie wartości zerowe -
    // model milczy (`min/max/mean/first/last === null`). Zera w tym wierszu
    // dopisałyby podmiotowi szereg, którego nikt nie zmierzył.
    const pusty = wiersze(PANELE, "pl", SmallMultiplesDataTable)[2];
    expect(pusty[1]).toBe("0");
    expect(pusty.slice(2)).toEqual(["-", "-", "-", "-", "-", "-", "-", "-"]);
  });

  it("udział we wspólnej osi zostaje w tabeli", () => {
    // `occupancy` jest jedyną liczbą, która mówi, JAKĄ CZĘŚĆ osi zajmuje ten
    // panel, czyli dlaczego jest płaski. Bez niej płaskość wygląda na własność
    // danych, a jest własnością skali - i tego z rysunku nie widać.
    const [duzy, maly] = wiersze(PANELE, "pl", SmallMultiplesDataTable);
    expect(duzy[duzy.length - 1]).toBe("18%");
    expect(maly[maly.length - 1]).toBe("0%");
    expect(maly[0]).toContain("spłaszczony");
  });

  it("liczebność obserwacji nie dostaje jednostki panelu", () => {
    // „3 mld EUR" zamiast „3 punkty pomiarowe" byłoby zdaniem fałszywym
    // o próbce panelu, a wygląda jak zwykła wartość.
    const [duzy] = wiersze(PANELE, "pl", SmallMultiplesDataTable);
    expect(duzy[1]).toBe("3");
  });

  it("tryb skali i porządek paneli są napisane", () => {
    // Od nich zależy, czy panele wolno porównywać wzrokiem: przy osobnych
    // osiach dwie linie na tej samej wysokości mogą różnić się o rzędy
    // wielkości, a kolejność paneli niesie pierwsze wrażenie.
    const pl = tekst(PANELE, "pl", SmallMultiplesDataTable);
    expect(pl).toContain("Wszystkie panele dzielą jedną oś wartości.");
    expect(pl).toContain("Panele uporządkowane średnią.");
  });

  it("każdy tryb skali i każdy porządek ma zdanie w obu językach", () => {
    // Sześć porządków i dwa tryby, a jeden render pokazuje po jednym z każdej
    // unii - reszta ujawniłaby się dopiero przy arkuszu, który w nią trafi.
    zdaniaUnii("smallMultiples.order", SM_ORDERS);
    zdaniaUnii("smallMultiples.scale", SM_SCALES);
  });

  it("ta sama tabela czyta się inaczej po polsku i po angielsku", () => {
    const pl = tekst(PANELE, "pl", SmallMultiplesDataTable);
    const en = tekst(PANELE, "en", SmallMultiplesDataTable);
    expect(pl).toContain("12\u00A0345");
    expect(pl).toContain("Udział we wspólnej osi");
    expect(en).toContain("12,345");
    expect(en).toContain("Share of the shared axis");
    expect(pl).not.toBe(en);
  });

  it("pusty arkusz, jedna kategoria i same luki nie wywracają tabeli", () => {
    for (const arkusz of [PUSTO, JEDNA_KATEGORIA, SAME_LUKI]) {
      const t = tekst(arkusz, "pl", SmallMultiplesDataTable);
      expect(t).not.toContain("{{");
      expect(t).not.toMatch(KLUCZ);
      expect(t).not.toContain("NaN");
    }
  });
});
