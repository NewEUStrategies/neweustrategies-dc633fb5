// Model słupka skumulowanego 100%. Najważniejsze asercje w tym pliku są pięć
// i wszystkie dotyczą uczciwości albo formy, a nie wygody wywołania:
// segmenty NIE są sortowane per kategoria (bo wtedy ta sama seria leżałaby
// w każdym słupku na innej wysokości i nie byłoby czego prowadzić wzdłuż
// wykresu), wartość ujemna ODRZUCA słupek (a nie wchodzi do mianownika po
// module), kategoria sumująca się do zera zostaje LUKĄ (a nie pełnym słupkiem
// pierwszej serii), udziały wyświetlane sumują się DOKŁADNIE do stu (bo
// czytelnik dodaje etykiety stojące jedna nad drugą), i model nie wypuszcza
// NaN, Infinity ani `undefined` - `Intl.NumberFormat.format(NaN)` zwraca
// literalny napis "NaN", którego bramka `blockMatrix` szuka w `textContent`
// strony.
//
// Testy pinują ZACHOWANIE modelu, nie jego implementację: sprawdzają liczby,
// które czytelnik odczyta z rysunku i z tabeli, oraz orzeczenia, które wejdą
// do podpisu - a nie kolejność kroków, która do nich doprowadziła.
import { describe, expect, it } from "vitest";
import i18n from "@/lib/i18n";
import "@/lib/i18n-charts";
import type { Json } from "@/lib/content-model/json";
import { parseChartConfig } from "@/lib/charts/parse";
import { CATEGORICAL_SAFE_SERIES, type ChartSeries } from "@/lib/charts/types";
import { slotForSeries } from "@/lib/charts/palette";
import {
  PERCENT_STACKED_COLUMNS,
  PERCENT_STACKED_DECLARED_TOLERANCE_PP,
  PERCENT_STACKED_LABEL_MIN_SHARE,
  PERCENT_STACKED_MAX_DISPLAY_DECIMALS,
  PERCENT_STACKED_MIN_BARS,
  PERCENT_STACKED_MIN_SEGMENTS,
  PERCENT_STACKED_VALUE_LIMIT,
  PERCENT_STACKED_WHOLE_PP,
  percentStackedExtent,
  percentStackedFormAdvice,
  percentStackedModel,
  percentStackedModelFromConfig,
  percentStackedTable,
  type PercentStackedInput,
  type PercentStackedModel,
} from "@/lib/charts/kinds/percentStacked";

function seria(name: string, values: (number | null)[], colorSlot = 1): ChartSeries {
  return { name, values, colorSlot };
}

function wejscie(categories: string[], series: ChartSeries[]): PercentStackedInput {
  return { categories, series };
}

/** Struktura trzech sektorów w dwóch okresach - podstawowy przypadek uczciwy. */
const OKRESY = ["2019", "2024"];
const USLUGI = seria("Usługi", [40, 55]);
const PRZEMYSL = seria("Przemysł", [45, 30]);
const ROLNICTWO = seria("Rolnictwo", [15, 15]);

function sumaWyswietlana(model: PercentStackedModel, bar: number): number {
  return model.bars[bar].segments.reduce((a, s) => a + s.displayShare, 0);
}

/**
 * Skan całego modelu w poszukiwaniu wartości, które po sformatowaniu trafiłyby
 * na stronę jako napis "NaN", "Infinity" albo "undefined". Chodzi po strukturze
 * rekurencyjnie, bo defekt tego rodzaju pojawia się zwykle w polu, o którym
 * nikt nie pamiętał (udział przy zerowym mianowniku, przesunięcie struktury
 * przy jednym słupku, rozminięcie zaokrąglenia przy braku segmentów), a nie
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
    for (const [key, value] of Object.entries(node)) {
      niedozwoloneWartosci(value, `${sciezka}.${key}`, out);
    }
  }
  return out;
}

describe("słupek 100% - normalizacja do całości", () => {
  it("zamienia wartości serii na udziały tej samej kategorii, a nie na udziały całego arkusza", () => {
    // Mianownikiem jest suma KOLUMNY, nie suma wszystkiego. Gdyby udział
    // liczył się z sumy całego arkusza, słupek okresu o mniejszej skali byłby
    // krótszy niż pełny - a wtedy forma przestałaby odpowiadać na pytanie
    // o strukturę i zaczęłaby (fałszywie) odpowiadać na pytanie o poziom.
    const model = percentStackedModel(wejscie(OKRESY, [USLUGI, PRZEMYSL, ROLNICTWO]));
    expect(model.bars.map((b) => b.total)).toEqual([100, 100]);
    expect(model.bars[0].segments.map((s) => s.share)).toEqual([0.4, 0.45, 0.15]);
    expect(model.bars[1].segments.map((s) => s.share)).toEqual([0.55, 0.3, 0.15]);
  });

  it("kolejność segmentów jest jedna dla wszystkich słupków i nie zależy od wielkości udziału", () => {
    // To jest cała różnica wobec tarczy, na której sortowanie malejące jest
    // OBOWIĄZKOWE. Tutaj posortowanie każdego słupka osobno położyłoby
    // "Przemysł" raz przy podstawie, raz w środku - a czytelnik prowadzi oko
    // wzdłuż JEDNEGO pasma i porównuje jego grubość, więc straciłby jedyną
    // rzecz, po którą do tej formy przychodzi.
    const model = percentStackedModel(wejscie(OKRESY, [USLUGI, PRZEMYSL, ROLNICTWO]));
    for (const bar of model.bars) {
      expect(bar.segments.map((s) => s.seriesName)).toEqual(["Usługi", "Przemysł", "Rolnictwo"]);
      expect(bar.segments.map((s) => s.seriesIndex)).toEqual([0, 1, 2]);
    }
    // W pierwszym okresie największy jest Przemysł, w drugim Usługi -
    // a mimo to segment przy podstawie w obu jest ten sam.
    expect(model.bars[0].segments[0].from).toBe(0);
    expect(model.bars[1].segments[0].from).toBe(0);
  });

  it("kolejność słupków jest arkuszowa - model nie przestawia kategorii", () => {
    // Odwrotnie niż w tornadzie, gdzie sortowanie JEST formą. Tu kategorie są
    // zwykle okresami, a przestawiony rok zamieniłby wykres struktury
    // w wykres rankingu i odwrócił wniosek o kierunku zmiany.
    const model = percentStackedModel(
      wejscie(["2024", "2019"], [seria("A", [10, 90]), seria("B", [90, 10])]),
    );
    expect(model.bars.map((b) => b.label)).toEqual(["2024", "2019"]);
    expect(model.bars.map((b) => b.index)).toEqual([0, 1]);
  });

  it("segmenty przylegają do siebie i domykają całość bez szczeliny", () => {
    // Szczelina między segmentami albo pod górną krawędzią czyta się jako
    // "czegoś tu brakuje", czyli jako niepełna struktura - a struktura jest
    // pełna, tylko podwójna precyzja nie domyka się sama.
    const model = percentStackedModel(
      wejscie(["A"], [seria("x", [1]), seria("y", [1]), seria("z", [1])]),
    );
    const segmenty = model.bars[0].segments;
    expect(segmenty[0].from).toBe(0);
    expect(segmenty[1].from).toBe(segmenty[0].to);
    expect(segmenty[2].from).toBe(segmenty[1].to);
    expect(segmenty[2].to).toBe(PERCENT_STACKED_WHOLE_PP);
  });

  it("koniec danych to górna krawędź ostatniego WIDOCZNEGO segmentu, nie ostatniej serii", () => {
    // Sekcja 3: zaokrągla się wyłącznie koniec danych, podstawa zostaje
    // kwadratowa. Gdyby render brał ostatnią serię, zaokrąglenie trafiłoby na
    // segment o zerowej długości i słupek dostałby twardą krawędź u szczytu
    // przy zaokrąglonym pustym miejscu obok.
    const model = percentStackedModel(
      wejscie(["A"], [seria("x", [50]), seria("y", [50]), seria("z", [0])]),
    );
    const segmenty = model.bars[0].segments;
    expect(segmenty.map((s) => s.isLastVisible)).toEqual([false, true, false]);
    expect(segmenty[1].to).toBe(PERCENT_STACKED_WHOLE_PP);
  });

  it("segment o wartości zero nie zabiera długości, ale zostaje na swojej pozycji w stosie", () => {
    // Zero jest POMIAREM, nie brakiem: kategoria zna ten składnik i mówi, że
    // go nie ma. Wyrzucenie takiego segmentu z tablicy przesunęłoby wszystkie
    // następne o jedno miejsce i legenda pokazywałaby nie te kolory co słupek.
    const model = percentStackedModel(
      wejscie(["A"], [seria("x", [50]), seria("y", [0]), seria("z", [50])]),
    );
    const srodek = model.bars[0].segments[1];
    expect(srodek.state).toBe("zero");
    expect(srodek.from).toBe(srodek.to);
    expect(srodek.visible).toBe(false);
    expect(srodek.value).toBe(0);
    expect(model.bars[0].segments[2].from).toBe(50);
  });

  it("luka w danych nie jest zerem i nie dokłada segmentu do stosu", () => {
    // Brak pomiaru nie jest pomiarem o wartości zero. Gdyby luka wchodziła
    // jako zero, mianownik zostałby ten sam, ale tabela pokazałaby "0" tam,
    // gdzie autor nic nie wpisał - czyli deklarację, której nie złożył.
    const model = percentStackedModel(wejscie(["A"], [seria("x", [30]), seria("y", [null])]));
    expect(model.bars[0].segments[1].state).toBe("missing");
    expect(model.bars[0].segments[1].value).toBeNull();
    expect(model.bars[0].total).toBe(30);
    expect(model.bars[0].segments[0].share).toBe(1);
  });
});

describe("słupek 100% - zaokrąglenie metodą największych reszt", () => {
  it("trzy równe udziały wyświetlają się jako 34, 33, 33, a nie trzy razy 33", () => {
    // Zaokrąglenie każdego udziału osobno daje trzy razy 33, czyli 99 -
    // a czytelnik DODAJE etykiety, bo stoją jedna nad drugą w jednym słupku.
    // Brakujący punkt procentowy wygląda wtedy na zgubioną kategorię.
    const model = percentStackedModel(
      wejscie(["A"], [seria("x", [1]), seria("y", [1]), seria("z", [1])]),
    );
    expect(model.bars[0].segments.map((s) => s.displayShare)).toEqual([34, 33, 33]);
    expect(sumaWyswietlana(model, 0)).toBe(PERCENT_STACKED_WHOLE_PP);
    expect(model.bars[0].displayTotal).toBe(PERCENT_STACKED_WHOLE_PP);
  });

  it("sześć równych udziałów nie wyświetla się jako sto dwa", () => {
    // 16,66% zaokrąglone osobno daje sześć razy 17, czyli 102. Suma powyżej
    // stu jest gorsza od sumy poniżej: sugeruje, że kategorie się nakładają.
    const model = percentStackedModel(
      wejscie(
        ["A"],
        Array.from({ length: 6 }, (_v, i) => seria(`s${i}`, [1])),
      ),
    );
    expect(model.bars[0].segments.map((s) => s.displayShare)).toEqual([17, 17, 17, 17, 16, 16]);
    expect(sumaWyswietlana(model, 0)).toBe(PERCENT_STACKED_WHOLE_PP);
  });

  it("brakującą jednostkę dostaje segment WIĘKSZY, bo tam waży relatywnie mniej", () => {
    // Udziały 62,5% i 37,5% mają identyczne reszty, więc rozstrzyga wielkość.
    // Punkt dołożony do 62% zmienia wyświetlaną liczbę o 1,6% jej wartości,
    // ten sam punkt dołożony do 37% o 2,7% - kłamiemy tam, gdzie kłamstwo
    // waży najmniej.
    const model = percentStackedModel(wejscie(["A"], [seria("duży", [2.5]), seria("mały", [1.5])]));
    expect(model.bars[0].segments.map((s) => s.displayShare)).toEqual([63, 37]);
  });

  it("suma domyka się do stu także przy dokładności ustawionej na jedno miejsce", () => {
    // Naiwne zaokrąglenie do jednego miejsca daje trzy razy 33,3, czyli 99,9 -
    // i to jest liczba, którą czytelnik widzi w podpisie jako sumę kontrolną.
    const model = percentStackedModel(
      wejscie(["A"], [seria("x", [1]), seria("y", [1]), seria("z", [1])]),
      { displayDecimals: 1 },
    );
    expect(model.bars[0].segments.map((s) => s.displayShare)).toEqual([33.4, 33.3, 33.3]);
    expect(model.bars[0].displayTotal).toBe(PERCENT_STACKED_WHOLE_PP);
  });

  it("suma z liczb całkowitych nie zostawia ogona podwójnej precyzji w podpisie", () => {
    // 33,3 nie ma dokładnej reprezentacji binarnej, więc dodanie trzech takich
    // liczb daje 99,99999999999999. `displayTotal` jest liczony z jednostek
    // całkowitych, więc podpis pokazuje sto, a nie dziewięćdziesiąt dziewięć
    // przecinek dziewięć dziewięć.
    const model = percentStackedModel(
      wejscie(["A"], [seria("x", [1]), seria("y", [1]), seria("z", [1])]),
      { displayDecimals: 1 },
    );
    expect(model.bars[0].displayTotal === PERCENT_STACKED_WHOLE_PP).toBe(true);
    expect(sumaWyswietlana(model, 0)).toBeCloseTo(PERCENT_STACKED_WHOLE_PP, 10);
  });

  it("dokładność wyświetlania jest przycięta sufitem, a nie przyjęta na słowo", () => {
    // Bez sufitu jedno pole konfiguracji dawałoby etykietę "16,666667%"
    // w segmencie grubym na 53 px, czyli napis, który nie ma gdzie się
    // zmieścić i obiecuje rozdzielczość nieistniejącą na rysunku.
    const model = percentStackedModel(wejscie(["A"], [seria("x", [1]), seria("y", [2])]), {
      displayDecimals: 9,
    });
    expect(model.displayDecimals).toBe(PERCENT_STACKED_MAX_DISPLAY_DECIMALS);
    expect(model.bars[0].displayTotal).toBe(PERCENT_STACKED_WHOLE_PP);
  });

  it("zaokrąglenie rusza WYŁĄCZNIE etykietą, geometria idzie z udziałów dokładnych", () => {
    // Gdyby krawędzie brały się z liczby zaokrąglonej, przy domyślnej
    // wysokości 320 px przesunęłyby się o 1,6 px - i rysunek kodowałby
    // etykietę, nie dane.
    const model = percentStackedModel(
      wejscie(["A"], [seria("x", [1]), seria("y", [1]), seria("z", [1])]),
    );
    const segmenty = model.bars[0].segments;
    expect(segmenty[0].displayShare).toBe(34);
    expect(segmenty[0].to).toBeCloseTo(33.3333333, 6);
    expect(segmenty[0].to).not.toBe(34);
  });

  it("rozminięcie etykiety z udziałem dokładnym jest ZMIERZONE i mniejsze od jednostki", () => {
    // Pole informacyjne, nie orzeczenie: zaokrąglenie jest tu konieczne, ale
    // czytelnik ma prawo wiedzieć, że etykieta jest zaokrągleniem, a nie
    // pomiarem. Wartość powyżej jednej jednostki wyświetlania znaczyłaby, że
    // rozdawanie reszt się zepsuło.
    const model = percentStackedModel(
      wejscie(
        ["A"],
        Array.from({ length: 6 }, (_v, i) => seria(`s${i}`, [1])),
      ),
    );
    expect(model.honesty.maxRoundingShiftPp).not.toBeNull();
    expect(model.honesty.maxRoundingShiftPp ?? 0).toBeLessThan(1);
    expect(model.honesty.maxRoundingShiftPp ?? 0).toBeGreaterThan(0);
  });

  it("udziały równe co do bitu dają zawsze ten sam wynik, bez losowania i bez zegara", () => {
    // Ten sam zbiór danych musi dać ten sam wykres w każdym przebiegu -
    // inaczej dwa zrzuty ekranu tego samego wpisu różniłyby się etykietami,
    // a nikt by nie wiedział, który jest prawdziwy.
    const dane = wejscie(["A", "B"], [seria("x", [1, 2]), seria("y", [1, 1]), seria("z", [1, 4])]);
    const pierwszy = percentStackedModel(dane);
    const drugi = percentStackedModel(dane);
    expect(drugi).toEqual(pierwszy);
  });
});

describe("słupek 100% - uczciwość: wartości ujemne", () => {
  it("odrzuca słupek z wartością ujemną, zamiast sumować po modułach", () => {
    // Udział ujemny nie ma długości. Suma modułów dałaby dla pary (-10, 100)
    // udziały 9% i 91%, które sumują się do stu i wyglądają poprawnie -
    // a mianownik byłby sumą rzeczy, których znaki się wykluczają.
    const model = percentStackedModel(
      wejscie(["Q1"], [seria("Wynik", [-10]), seria("Koszt", [100])]),
    );
    const bar = model.bars[0];
    expect(bar.state).toBe("rejected");
    expect(bar.drawable).toBe(false);
    expect(bar.total).toBe(0);
    expect(bar.segments.map((s) => s.share)).toEqual([0, 0]);
    expect(bar.segments.map((s) => s.visible)).toEqual([false, false]);
    expect(bar.segments.map((s) => s.state)).toEqual(["negative", "noShare"]);
  });

  it("nazywa kategorię, w której siedzi wartość ujemna, a nie tylko fakt jej istnienia", () => {
    // Podpis pod wykresem musi umieć powiedzieć, KTÓRY słupek jest wadliwy.
    // Samo "w danych są wartości ujemne" zostawia autora z szukaniem po całym
    // arkuszu.
    const model = percentStackedModel(
      wejscie(["Q1", "Q2"], [seria("Wynik", [-10, 30]), seria("Koszt", [100, 70])]),
    );
    expect(model.honesty.valuesNonNegativeOk).toBe(false);
    expect(model.honesty.negativeLabels).toEqual(["Q1"]);
    expect(percentStackedFormAdvice(model)).toContain("negativeValues");
  });

  it("defekt jest LOKALNY: słupek bez ujemnych liczy się normalnie", () => {
    // Wygaszenie całego wykresu z powodu jednej komórki ukrywałoby dane, które
    // autor już poprawnie wpisał, i nie dawałoby mu żadnej wskazówki, gdzie
    // szukać błędu.
    const model = percentStackedModel(
      wejscie(["Q1", "Q2"], [seria("Wynik", [-10, 30]), seria("Koszt", [100, 70])]),
    );
    expect(model.bars[1].state).toBe("stacked");
    expect(model.bars[1].segments.map((s) => s.share)).toEqual([0.3, 0.7]);
    expect(model.drawableBars).toBe(1);
  });

  it("model MILCZY o znaku, gdy w arkuszu nie ma ani jednej liczby", () => {
    // `null` znaczy NIE MA CZEGO SPRAWDZAĆ. Orzeczenie `true` na pustym
    // arkuszu byłoby zaświadczeniem, że dane są w porządku, wystawionym danym,
    // których nie ma.
    const model = percentStackedModel(wejscie(["A", "B"], [seria("x", [null, null])]));
    expect(model.honesty.valuesNonNegativeOk).toBeNull();
    expect(model.honesty.totalsPositiveOk).toBeNull();
  });

  it("wartość poza sufitem podwójnej precyzji odrzuca słupek i jest nazwana osobno", () => {
    // Powyżej 2^53-1 sąsiednie liczby całkowite przestają być rozróżnialne,
    // więc suma przestaje być mianownikiem, który ktokolwiek może sprawdzić.
    // Bez sufitu mianownik mógłby też przepełnić się do nieskończoności,
    // a wtedy każdy udział zszedłby do zera bez podania przyczyny.
    const model = percentStackedModel(
      wejscie(["A"], [seria("x", [PERCENT_STACKED_VALUE_LIMIT * 2]), seria("y", [1])]),
    );
    expect(model.bars[0].state).toBe("rejected");
    expect(model.honesty.outOfRangeLabels).toEqual(["A"]);
    expect(model.bars[0].segments[0].state).toBe("tooLarge");
    expect(model.honesty.valuesNonNegativeOk).toBe(true);
  });
});

describe("słupek 100% - uczciwość: kategoria bez sumy", () => {
  it("kategoria sumująca się do zera zostaje LUKĄ, nie pełnym słupkiem pierwszej serii", () => {
    // To jest błąd, który powstaje sam: `v / total` przy zerowym mianowniku
    // daje NaN, a osłona pisana odruchowo ("gdy nie ma sumy, weź pierwszą
    // serię") stawia w tym miejscu słupek pełny w 100% jednej kategorii -
    // czyli strukturę, której w danych nie ma.
    const model = percentStackedModel(
      wejscie(["Pusty rok"], [seria("x", [0]), seria("y", [0]), seria("z", [0])]),
    );
    const bar = model.bars[0];
    expect(bar.state).toBe("zeroTotal");
    expect(bar.drawable).toBe(false);
    expect(bar.segments.map((s) => s.share)).toEqual([0, 0, 0]);
    expect(bar.segments.map((s) => s.displayShare)).toEqual([0, 0, 0]);
    expect(bar.displayTotal).toBe(0);
    expect(bar.segments.every((s) => !s.visible)).toBe(true);
  });

  it("zerowa suma jest DEFEKTEM nazwanym, a nie cichą dziurą w wykresie", () => {
    // Luka bez wyjaśnienia jest dla czytelnika nierozróżnialna od pomyłki
    // renderu. Nazwanie kategorii pozwala napisać w podpisie, dlaczego
    // w tym miejscu nie ma słupka.
    const model = percentStackedModel(
      wejscie(["2023", "2024"], [seria("x", [0, 30]), seria("y", [0, 70])]),
    );
    expect(model.honesty.totalsPositiveOk).toBe(false);
    expect(model.honesty.zeroTotalLabels).toEqual(["2023"]);
    expect(model.honesty.emptyLabels).toEqual([]);
  });

  it("kategoria bez ani jednej liczby jest PUSTA, nie zerowa - to dwie różne przyczyny", () => {
    // Zero jest deklaracją autora, brak jest nieuzupełnionym polem. Jedno
    // zdanie na oba przypadki kazałoby autorowi szukać zera tam, gdzie
    // niczego nie wpisał.
    const model = percentStackedModel(
      wejscie(["Niewypełniony", "2024"], [seria("x", [null, 30]), seria("y", [null, 70])]),
    );
    expect(model.bars[0].state).toBe("empty");
    expect(model.bars[0].filled).toBe(0);
    expect(model.honesty.emptyLabels).toEqual(["Niewypełniony"]);
    expect(model.honesty.zeroTotalLabels).toEqual([]);
    expect(model.honesty.totalsPositiveOk).toBe(true);
  });
});

describe("słupek 100% - uczciwość: porównywalność struktury", () => {
  it("nazywa słupek, któremu brakuje składnika obecnego w pozostałych", () => {
    // Oba słupki wyglądają identycznie: pełne, podpisane stu procentami.
    // Tylko że jeden rozkłada trzy składniki, a drugi dwa - więc jego udziały
    // są policzone z innego mianownika i porównanie ich jest porównaniem
    // dwóch różnych całości.
    const model = percentStackedModel(
      wejscie(
        ["2023", "2024"],
        [seria("x", [30, 30]), seria("y", [50, 70]), seria("z", [20, null])],
      ),
    );
    expect(model.honesty.structureComparableOk).toBe(false);
    expect(model.honesty.incompleteLabels).toEqual(["2024"]);
  });

  it("nie orzeka o porównywalności, gdy rysowany jest jeden słupek", () => {
    // Jeden słupek nie ma z czym być porównany, więc `false` byłoby zarzutem
    // bez podstawy, a `true` zaświadczeniem o czymś, czego nikt nie sprawdził.
    const model = percentStackedModel(wejscie(["A"], [seria("x", [30]), seria("y", [70])]));
    expect(model.honesty.structureComparableOk).toBeNull();
  });

  it("słupki o tych samych składnikach przechodzą sprawdzenie", () => {
    // Orzeczenie musi umieć powiedzieć "sprawdzone i w porządku" - bramka,
    // która zawsze zgłasza defekt, uczy ignorowania wszystkich ostrzeżeń.
    const model = percentStackedModel(wejscie(OKRESY, [USLUGI, PRZEMYSL, ROLNICTWO]));
    expect(model.honesty.structureComparableOk).toBe(true);
    expect(model.honesty.incompleteLabels).toEqual([]);
  });

  it("powtórzona etykieta kategorii i powtórzona nazwa serii są nazwane osobno", () => {
    // W tej formie tożsamość kategorii niesie WYŁĄCZNIE etykieta pod słupkiem,
    // a tożsamość segmentu wyłącznie legenda albo etykieta bezpośrednia (blade
    // wnętrze jej nie niesie). Dwie takie same nazwy dają elementy, których nie
    // da się rozdzielić żadnym kanałem.
    const model = percentStackedModel(
      wejscie(["2024", "2024"], [seria("Inne", [30, 30]), seria("Inne", [70, 70])]),
    );
    expect(model.honesty.duplicateLabels).toEqual(["2024"]);
    expect(model.honesty.duplicateSeriesNames).toEqual(["Inne"]);
  });

  it("liczy wartości, które nie miały kategorii, zamiast je przemilczeć", () => {
    // Zdarza się przy treści z cofniętej wersji edytora: wartość dopisano,
    // kategorii nie. Bez kategorii nie ma czego narysować, więc liczba wypada
    // z wykresu - i to musi być widoczne, bo mianownik jest wtedy inny, niż
    // autor sądzi.
    const model = percentStackedModel(wejscie(["A"], [seria("x", [30, 999]), seria("y", [70, 1])]));
    expect(model.honesty.droppedValueCount).toBe(2);
    expect(model.bars).toHaveLength(1);
  });
});

describe("słupek 100% - uczciwość: udziały podane przez autora", () => {
  it("wykrywa przeskalowanie udziałów, które w arkuszu nie sumowały się do stu", () => {
    // SPRAWDZAMY DANE AUTORA, NIE WŁASNĄ ARYTMETYKĘ. Udziały policzone przez
    // model dzielą wartości przez ich własną sumę, więc domykają się
    // z definicji. Realny defekt jest inny: autor wkleja udziały sumujące się
    // do 96, a stos przeskalowuje je po cichu - i liczba na segmencie (31)
    // przestaje być liczbą z arkusza (30).
    const model = percentStackedModel(
      wejscie(["A"], [seria("x", [30]), seria("y", [30]), seria("z", [36])]),
      { valuesAreShares: true },
    );
    expect(model.bars[0].total).toBe(96);
    expect(model.bars[0].rescaled).toBe(true);
    expect(model.honesty.declaredTotalsOk).toBe(false);
    expect(model.honesty.rescaledLabels).toEqual(["A"]);
    expect(model.bars[0].segments.map((s) => s.displayShare)).toEqual([31, 31, 38]);
  });

  it("zaokrąglenie w arkuszu autora nie odpala ostrzeżenia, a brakująca kategoria odpala", () => {
    // Trzy równe udziały podane jako 33,3 sumują się do 99,9, czyli mieszczą
    // się w tolerancji: ostrzeżenie widoczne przy każdym takim arkuszu uczyłoby
    // ignorowania wszystkich ostrzeżeń. Te same trzy udziały podane jako 33,1
    // sumują się do 99,3 i to już nie jest zaokrąglenie, tylko brakujący
    // ułamek całości - próg musi rozdzielać te dwa przypadki, a nie tylko
    // istnieć.
    const zaokraglone = percentStackedModel(
      wejscie(["A"], [seria("x", [33.3]), seria("y", [33.3]), seria("z", [33.3])]),
      { valuesAreShares: true },
    );
    expect(PERCENT_STACKED_WHOLE_PP - 3 * 33.3).toBeLessThan(PERCENT_STACKED_DECLARED_TOLERANCE_PP);
    expect(zaokraglone.bars[0].rescaled).toBe(false);
    expect(zaokraglone.honesty.declaredTotalsOk).toBe(true);

    const niepelne = percentStackedModel(
      wejscie(["A"], [seria("x", [33.1]), seria("y", [33.1]), seria("z", [33.1])]),
      { valuesAreShares: true },
    );
    expect(niepelne.bars[0].rescaled).toBe(true);
    expect(niepelne.honesty.declaredTotalsOk).toBe(false);
  });

  it("bez deklaracji, że liczby SĄ udziałami, model o sumie milczy", () => {
    // Heurystyka "sumują się blisko stu" odpalałaby na czterech kwartałach po
    // 25 mln i milczałaby na udziałach sumujących się do 60, czyli dokładnie
    // tam, gdzie ostrzeżenie jest potrzebne. Deklaracją jest jednostka.
    const model = percentStackedModel(
      wejscie(["A"], [seria("x", [30]), seria("y", [30]), seria("z", [36])]),
    );
    expect(model.valuesAreShares).toBe(false);
    expect(model.honesty.declaredTotalsOk).toBeNull();
    expect(model.honesty.rescaledLabels).toEqual([]);
  });
});

describe("słupek 100% - doradztwo formy", () => {
  it("ostrzega powyżej zestawu rozdzielnego dla daltonizmu, bo kolor przestaje nieść kategorię", () => {
    // Powyżej `CATEGORICAL_SAFE_SERIES` slotów odległość barw po symulacji
    // spada poniżej progu rozdzielności, więc dwa segmenty stają się tym samym
    // kolorem - a w stosie kolor jest jedynym nośnikiem tożsamości segmentu,
    // który nie unosi swojej etykiety.
    const ile = CATEGORICAL_SAFE_SERIES + 1;
    const model = percentStackedModel(
      wejscie(
        ["A"],
        Array.from({ length: ile }, (_v, i) => seria(`s${i}`, [10])),
      ),
    );
    expect(model.filledSeries).toBe(ile);
    expect(model.honesty.segmentsOverSafePalette).toBe(1);
    expect(percentStackedFormAdvice(model)).toContain("tooManySegments");
  });

  it("nie ostrzega o palecie dokładnie na granicy zestawu bezpiecznego", () => {
    // Ostrzeżenie o jeden za wcześnie zabiera autorowi slot, który jest
    // policzalnie bezpieczny - a paleta ma ich dokładnie tyle.
    const model = percentStackedModel(
      wejscie(
        ["A"],
        Array.from({ length: CATEGORICAL_SAFE_SERIES }, (_v, i) => seria(`s${i}`, [10])),
      ),
    );
    expect(model.honesty.segmentsOverSafePalette).toBe(0);
    expect(percentStackedFormAdvice(model)).not.toContain("tooManySegments");
  });

  it("ostrzeżenie o palecie przeżywa odrzucenie słupków, bo legenda pokazuje serie dalej", () => {
    // Gdyby liczba serii szła z samych słupków rysowanych, jedna wartość
    // ujemna zabrałaby ostrzeżenie o czymś, co z jej znakiem nie ma nic
    // wspólnego - a legenda i tak wypisze wszystkie serie z liczbami.
    const ile = CATEGORICAL_SAFE_SERIES + 2;
    const model = percentStackedModel(
      wejscie(
        ["A"],
        Array.from({ length: ile }, (_v, i) => seria(`s${i}`, [i === 0 ? -1 : 10])),
      ),
    );
    expect(model.drawableBars).toBe(0);
    expect(percentStackedFormAdvice(model)).toContain("tooManySegments");
  });

  it("jedna seria to stos bez struktury, więc doradza inną formę", () => {
    // Jeden segment daje w każdym słupku pełne sto procent: rysunek jednakowo
    // długich słupków, z którego nie da się odczytać niczego. Poziomy pokazuje
    // wtedy zwykły słupek, nie stos.
    const model = percentStackedModel(
      wejscie(
        ["A", "B"],
        Array.from({ length: PERCENT_STACKED_MIN_SEGMENTS - 1 }, (_v, i) =>
          seria(`s${i}`, [30, 70]),
        ),
      ),
    );
    expect(percentStackedFormAdvice(model)).toContain("singleSegment");
  });

  it("jeden słupek nie ma z czym być porównany, więc doradza pierścień", () => {
    // Ta forma została wybrana dla PORÓWNANIA struktury między kategoriami.
    // Przy jednej kategorii tabela doboru formy dopuszcza pierścień do pięciu
    // kategorii, który czyta się jednym spojrzeniem.
    const okresy = Array.from({ length: PERCENT_STACKED_MIN_BARS - 1 }, (_v, i) => `okres ${i}`);
    const model = percentStackedModel(
      wejscie(okresy, [
        seria(
          "x",
          okresy.map(() => 30),
        ),
        seria(
          "y",
          okresy.map(() => 70),
        ),
      ]),
    );
    expect(percentStackedFormAdvice(model)).toContain("singleBar");
  });

  it("dwa słupki i dwie serie nie dostają żadnej porady", () => {
    // Wykres poprawny musi wychodzić z doradztwa czysty, inaczej autor
    // przestaje czytać ostrzeżenia.
    const model = percentStackedModel(wejscie(OKRESY, [USLUGI, PRZEMYSL, ROLNICTWO]));
    expect(percentStackedFormAdvice(model)).toEqual([]);
  });

  it("arkusz z liczbami, ale bez ani jednego słupka do narysowania, mówi o braku struktury", () => {
    // Same zerowe sumy dają wykres, na którym nie ma nic - a autor widzi
    // pustą płytę i nie wie, czy to jego dane, czy awaria.
    const model = percentStackedModel(
      wejscie(["A", "B"], [seria("x", [0, 0]), seria("y", [0, 0])]),
    );
    expect(percentStackedFormAdvice(model)).toContain("noStructure");
  });

  it("pusty blok nie dostaje ani jednej porady, bo autor dopiero wpisuje dane", () => {
    // Ostrzeżenie widoczne od pierwszego kliknięcia w edytorze jest szumem,
    // przez który nie widać ostrzeżeń prawdziwych.
    const pusty = percentStackedModel(wejscie([], []));
    expect(percentStackedFormAdvice(pusty)).toEqual([]);
    const bezLiczb = percentStackedModel(wejscie(["A", "B"], [seria("x", [null, null])]));
    expect(percentStackedFormAdvice(bezLiczb)).toEqual([]);
  });
});

describe("słupek 100% - etykieta wewnątrz segmentu", () => {
  it("segment cieńszy od wiersza tekstu nie dostaje etykiety wewnątrz", () => {
    // Sekcja 2: blade wnętrze nie niesie tożsamości serii, więc etykieta
    // bezpośrednia jest drugim nośnikiem. Postawiona w segmencie o udziale
    // 3% nachodziłaby na obie jego krawędzie, czyli na sąsiednie serie -
    // a wtedy nie wiadomo, do którego segmentu należy.
    const model = percentStackedModel(
      wejscie(["A"], [seria("duży", [96]), seria("mały", [3]), seria("drzazga", [1])]),
    );
    expect(model.bars[0].segments.map((s) => s.labelInside)).toEqual([true, false, false]);
  });

  it("granica przebiega dokładnie na progu, nie o punkt wyżej ani niżej", () => {
    // Próg jest wyprowadzony z geometrii (11 px fontu plus dwa razy 4 px
    // odstępu na 320 px wysokości), więc segment dokładnie na nim liczbę
    // unosi. Odesłanie go do tabeli oznaczałoby, że etykieta bezpośrednia
    // znika tam, gdzie się mieści - a wtedy tożsamość segmentu zostaje bez
    // drugiego nośnika bez potrzeby.
    const naProgu = PERCENT_STACKED_LABEL_MIN_SHARE * PERCENT_STACKED_WHOLE_PP;
    const model = percentStackedModel(
      wejscie(
        ["Na progu", "Pod progiem"],
        [
          seria("mały", [naProgu, naProgu - 1]),
          seria("duży", [
            PERCENT_STACKED_WHOLE_PP - naProgu,
            PERCENT_STACKED_WHOLE_PP - naProgu + 1,
          ]),
        ],
      ),
    );
    expect(model.bars[0].segments[0].share).toBe(PERCENT_STACKED_LABEL_MIN_SHARE);
    expect(model.bars[0].segments[0].labelInside).toBe(true);
    expect(model.bars[1].segments[0].labelInside).toBe(false);
  });

  it("próg etykiety schodzi razem z wysokością rysunku podaną przez render", () => {
    // Próg domyślny jest wyprowadzony dla wysokości 320 px; blok o wysokości
    // 640 px unosi etykietę w segmencie dwa razy cieńszym. Model nie zna
    // pikseli, więc próg przyjmuje z zewnątrz - inaczej wysoki wykres
    // odsyłałby do tabeli liczby, które w segmencie się mieszczą.
    const model = percentStackedModel(
      wejscie(["A"], [seria("duży", [96]), seria("mały", [3]), seria("drzazga", [1])]),
      { labelMinShare: 0.03 },
    );
    expect(model.labelMinShare).toBe(0.03);
    expect(model.bars[0].segments.map((s) => s.labelInside)).toEqual([true, true, false]);
  });

  it("segment niewidoczny nie dostaje etykiety, choćby próg był zerowy", () => {
    // Liczba postawiona w segmencie o zerowej długości leżałaby na krawędzi
    // między dwiema innymi seriami i opisywała tę, do której nie należy.
    const model = percentStackedModel(
      wejscie(["A"], [seria("x", [50]), seria("y", [0]), seria("z", [50])]),
      { labelMinShare: 0 },
    );
    expect(model.bars[0].segments[1].labelInside).toBe(false);
  });
});

describe("słupek 100% - zakres osi", () => {
  it("oś idzie od zera do stu zawsze, niezależnie od danych", () => {
    // Sekcja 8: długość koduje wartość, więc ucięta oś wprost zniekształca
    // proporcję. Górna granica jest z definicji formy - oś dociągnięta do
    // najwyższej sumy albo do "ładnej" podziałki postawiłaby szczyt stosu
    // poniżej krawędzi rysunku, a wtedy pełny słupek przestałby znaczyć
    // "całość".
    expect(percentStackedExtent()).toEqual({ min: 0, max: PERCENT_STACKED_WHOLE_PP });
  });

  it("krawędzie segmentów nigdy nie wychodzą poza zakres osi", () => {
    // Krawędź powyżej stu albo poniżej zera wyszłaby poza obszar kreślenia,
    // a `overflow: hidden` ucięłoby ją bez śladu - czyli ukryło kolizję.
    const model = percentStackedModel(
      wejscie(["A", "B", "C"], [seria("x", [1, 0, null]), seria("y", [1e-9, 0, 5])]),
    );
    for (const bar of model.bars) {
      for (const seg of bar.segments) {
        expect(seg.from).toBeGreaterThanOrEqual(0);
        expect(seg.to).toBeLessThanOrEqual(PERCENT_STACKED_WHOLE_PP);
        expect(seg.to).toBeGreaterThanOrEqual(seg.from);
        expect(seg.displayShare).toBeGreaterThanOrEqual(0);
        expect(seg.displayShare).toBeLessThanOrEqual(PERCENT_STACKED_WHOLE_PP);
      }
    }
  });
});

describe("słupek 100% - tabela danych", () => {
  it("niesie udział i wartość bezwzględną RAZEM, bo stos wyrzuca poziom", () => {
    // Dwa słupki o identycznej strukturze mogą różnić się rzędem wielkości
    // i wyglądają wtedy tak samo. Udział bez wartości bezwzględnej jest w tej
    // formie informacją niepełną.
    const model = percentStackedModel(
      wejscie(["Mały", "Duży"], [seria("x", [3, 3000]), seria("y", [7, 7000])]),
    );
    const table = percentStackedTable(model);
    expect(table.rows.map((r) => r.total)).toEqual([10, 10000]);
    expect(table.rows[0].cells.map((c) => [c.value, c.displayShare])).toEqual([
      [3, 30],
      [7, 70],
    ]);
    expect(table.rows[1].cells.map((c) => [c.value, c.displayShare])).toEqual([
      [3000, 30],
      [7000, 70],
    ]);
  });

  it("wiersze idą w kolejności rysowania, więc liczbę czyta się przy tym słupku, na który się patrzy", () => {
    // Inna kolejność w tabeli niż na rysunku kazałaby czytelnikowi szukać
    // nazwy - a to jest dokładnie ten koszt, którego ta forma go pozbawia.
    const model = percentStackedModel(wejscie(OKRESY, [USLUGI, PRZEMYSL, ROLNICTWO]));
    const table = percentStackedTable(model);
    expect(table.rows.map((r) => r.label)).toEqual(model.bars.map((b) => b.label));
    expect(table.seriesLabels).toEqual(["Usługi", "Przemysł", "Rolnictwo"]);
  });

  it("brzeg serii podaje przesunięcie struktury, którego rysunek pokazuje najsłabiej", () => {
    // Segment środkowy nie leży na wspólnej skali, więc odpowiedź "czy udział
    // tej serii rośnie" odczytuje się z wykresu przez porównanie dwóch
    // różnic. Tabela podaje ją liczbą.
    const model = percentStackedModel(
      wejscie(["2019", "2024"], [seria("Usługi", [20, 40]), seria("Przemysł", [80, 60])]),
    );
    const table = percentStackedTable(model);
    expect(table.series[0].firstShare).toBe(0.2);
    expect(table.series[0].lastShare).toBe(0.4);
    expect(table.series[0].shiftPp ?? 0).toBeCloseTo(20, 9);
    expect(table.series[0].spanPp ?? 0).toBeCloseTo(20, 9);
    expect(table.series[1].shiftPp ?? 0).toBeCloseTo(-20, 9);
  });

  it("nie orzeka o przesunięciu struktury z jednego słupka", () => {
    // Różnica policzona z jednego słupka byłaby zerem podanym jako "nic się
    // nie zmieniło" - a to jest wniosek, którego dane nie zawierają.
    const model = percentStackedModel(wejscie(["A"], [seria("x", [30]), seria("y", [70])]));
    const table = percentStackedTable(model);
    expect(table.series[0].shiftPp).toBeNull();
    expect(table.series[0].spanPp).toBe(0);
    expect(table.series[0].bars).toBe(1);
  });

  it("przypisy wiersza nazywają przyczynę, dla której słupka nie ma", () => {
    // Trzy różne przyczyny braku słupka wyglądają na rysunku identycznie:
    // w tym miejscu nic nie ma. Tabela jest jedynym miejscem, w którym da się
    // je rozdzielić.
    const model = percentStackedModel(
      wejscie(
        ["Ujemny", "Zerowy", "Pusty", "Dobry"],
        [seria("x", [-1, 0, null, 30]), seria("y", [2, 0, null, 70])],
      ),
    );
    const table = percentStackedTable(model);
    expect(table.rows.map((r) => r.notes)).toEqual([["rejected"], ["zeroTotal"], ["empty"], []]);
  });

  it("przypis komórki niesie stan segmentu, a komórka z udziałem zostaje bez przypisu", () => {
    // Przypis przy każdej komórce byłby szumem; przypis tylko przy komórce
    // wadliwej jest informacją. Dla wartości ujemnej czytelnik musi wiedzieć,
    // że to ONA odrzuciła słupek, a nie sąsiadka.
    const model = percentStackedModel(
      wejscie(["A", "B"], [seria("x", [-1, 30]), seria("y", [2, 70])]),
    );
    const table = percentStackedTable(model);
    expect(table.rows[0].cells.map((c) => c.notes)).toEqual([["negative"], ["noShare"]]);
    expect(table.rows[1].cells.map((c) => c.notes)).toEqual([[], []]);
  });

  it("nie liczy udziałów po raz drugi: przy słupku odrzuconym wartości są, udziałów nie ma", () => {
    // Tabela, która dzieliłaby wartości przez własną sumę, podałaby przy
    // odrzuconym słupku udziały, których na rysunku nie ma - i czytelnik
    // dostałby strukturę wyliczoną z mianownika, którego forma nie unosi.
    const model = percentStackedModel(wejscie(["A"], [seria("x", [-1]), seria("y", [3])]));
    const table = percentStackedTable(model);
    expect(table.rows[0].cells.map((c) => c.value)).toEqual([-1, 3]);
    expect(table.rows[0].cells.map((c) => c.share)).toEqual([0, 0]);
    expect(table.rows[0].displayTotal).toBe(0);
  });

  it("przypis mówi też o przeskalowaniu udziałów podanych w arkuszu", () => {
    // Bez tego przypisu liczba w tabeli (31%) różniłaby się od liczby, którą
    // autor wpisał (30), i nic by tego nie wyjaśniało.
    const model = percentStackedModel(
      wejscie(["A"], [seria("x", [30]), seria("y", [30]), seria("z", [36])]),
      { valuesAreShares: true },
    );
    const table = percentStackedTable(model);
    expect(table.rows[0].notes).toContain("rescaled");
    expect(table.valuesAreShares).toBe(true);
  });

  it("kolumny są kluczami słownika, nie napisami dla człowieka", () => {
    // Model nie zna języka. Cztery z pięciu kluczy mają dziś tłumaczenie
    // w `charts.frame`, więc tabela ma nagłówek jeszcze przed dopisaniem
    // własnej sekcji do słownika - i ten test pilnuje, żeby te cztery nie
    // zniknęły komuś pod ręką.
    expect(PERCENT_STACKED_COLUMNS).toEqual(["category", "series", "value", "share", "total"]);
    for (const klucz of ["category", "value", "share", "total"]) {
      expect(i18n.t(`charts.frame.${klucz}`, { lng: "pl" })).not.toBe(`charts.frame.${klucz}`);
      expect(i18n.t(`charts.frame.${klucz}`, { lng: "en" })).not.toBe(`charts.frame.${klucz}`);
    }
    expect(i18n.t("charts.frame.share", { lng: "pl" })).toBe("Udział");
    expect(i18n.t("charts.frame.share", { lng: "en" })).toBe("Share");
  });
});

describe("słupek 100% - wejście z konfiguracji bloku", () => {
  function config(data: Record<string, Json>) {
    return parseChartConfig({ kind: "bar", ...data });
  }

  it("czyta kategorie i serie z konfiguracji, w kolejności arkuszowej", () => {
    const model = percentStackedModelFromConfig(
      config({
        categories: ["2019", "2024"],
        series: [
          { name: "Usługi", values: [40, 55] },
          { name: "Przemysł", values: [60, 45] },
        ],
      }),
    );
    expect(model.bars.map((b) => b.label)).toEqual(["2019", "2024"]);
    expect(model.bars[0].segments.map((s) => s.share)).toEqual([0.4, 0.6]);
  });

  it("jednostka procentowa włącza sprawdzenie sumy podanych udziałów", () => {
    // Jednostka jest deklaracją autora o tym, co liczby znaczą - i to jest
    // właściwa podstawa, bo kształt liczb nie odróżnia udziałów od kwot.
    const zProcentem = percentStackedModelFromConfig(
      config({
        unit: "%",
        categories: ["A"],
        series: [
          { name: "x", values: [30] },
          { name: "y", values: [60] },
        ],
      }),
    );
    expect(zProcentem.valuesAreShares).toBe(true);
    expect(zProcentem.honesty.declaredTotalsOk).toBe(false);

    const zKwota = percentStackedModelFromConfig(
      config({
        unit: " mld EUR",
        categories: ["A"],
        series: [
          { name: "x", values: [30] },
          { name: "y", values: [60] },
        ],
      }),
    );
    expect(zKwota.valuesAreShares).toBe(false);
    expect(zKwota.honesty.declaredTotalsOk).toBeNull();
  });

  it("flaga `stacked` z konfiguracji nie ma tu nic do rzeczy", () => {
    // Normalizacja do całości JEST stosem, więc "słupek skumulowany 100%,
    // który nie jest skumulowany" nie jest żadną formą. Gdyby model
    // respektował tę flagę, odklikniecie jednego pola w edytorze zamieniałoby
    // rodzaj w coś, czego tabela doboru formy nie zna.
    const dane = {
      categories: ["A", "B"],
      series: [
        { name: "x", values: [30, 40] },
        { name: "y", values: [70, 60] },
      ],
    };
    const zeStosem = percentStackedModelFromConfig(config({ ...dane, stacked: true }));
    const bezStosu = percentStackedModelFromConfig(config({ ...dane, stacked: false }));
    expect(bezStosu.bars).toEqual(zeStosem.bars);
  });

  it("konfiguracja bez kategorii i bez serii nie wywraca modelu", () => {
    // Treść bloku przychodzi z bazy i może być z wersji edytora, której ten
    // kod nie zna. Wyjątek w modelu wywraca cały wpis, nie tylko wykres.
    const model = percentStackedModelFromConfig(config({}));
    expect(model.bars).toEqual([]);
    expect(model.series).toEqual([]);
    expect(model.drawableBars).toBe(0);
    expect(niedozwoloneWartosci(model)).toEqual([]);
  });
});

describe("słupek 100% - zero NaN na ekranie", () => {
  const przypadki: [string, PercentStackedInput][] = [
    ["pusty arkusz", wejscie([], [])],
    ["kategorie bez serii", wejscie(["A", "B"], [])],
    ["seria bez kategorii", wejscie([], [seria("x", [1, 2])])],
    ["same luki", wejscie(["A"], [seria("x", [null]), seria("y", [null])])],
    ["same zera", wejscie(["A", "B"], [seria("x", [0, 0]), seria("y", [0, 0])])],
    ["jedna wartość", wejscie(["A"], [seria("x", [7])])],
    ["same równe wartości", wejscie(["A", "B"], [seria("x", [5, 5]), seria("y", [5, 5])])],
    ["wartości ujemne", wejscie(["A"], [seria("x", [-5]), seria("y", [-5])])],
    ["ujemna i dodatnia", wejscie(["A"], [seria("x", [-5]), seria("y", [15])])],
    [
      "nieliczby z bazy",
      wejscie(["A"], [seria("x", [Number.NaN]), seria("y", [Number.POSITIVE_INFINITY])]),
    ],
    [
      "wartości poza sufitem",
      wejscie(["A"], [seria("x", [1e308]), seria("y", [1e308]), seria("z", [1])]),
    ],
    ["wartości denormalne", wejscie(["A"], [seria("x", [5e-324]), seria("y", [5e-324])])],
    ["udział znikomy", wejscie(["A"], [seria("x", [1e12]), seria("y", [1])])],
    ["więcej wartości niż kategorii", wejscie(["A"], [seria("x", [1, 2, 3])])],
    [
      "slot koloru z nieliczby",
      wejscie(["A"], [{ name: "x", values: [1], colorSlot: Number.NaN }]),
    ],
  ];

  for (const [nazwa, dane] of przypadki) {
    it(`nie wypuszcza NaN, Infinity ani undefined: ${nazwa}`, () => {
      // `Intl.NumberFormat.format(NaN)` zwraca literalny napis "NaN", a bramka
      // `blockMatrix` szuka go w `textContent` strony - więc każdy atrybut
      // liczbowy musi być skończony także dla danych, których nikt nie
      // przewidział.
      const model = percentStackedModel(dane);
      expect(niedozwoloneWartosci(model)).toEqual([]);
      expect(niedozwoloneWartosci(percentStackedTable(model), "table")).toEqual([]);
      expect(niedozwoloneWartosci(percentStackedFormAdvice(model), "advice")).toEqual([]);
    });
  }

  it("nie wypuszcza NaN także przy każdej dozwolonej dokładności wyświetlania", () => {
    // Jednostka wyświetlania jest mianownikiem dzielenia, więc jej zmiana
    // dotyka każdego udziału na wykresie.
    for (let decimals = 0; decimals <= PERCENT_STACKED_MAX_DISPLAY_DECIMALS; decimals++) {
      const model = percentStackedModel(
        wejscie(["A", "B"], [seria("x", [1, 0]), seria("y", [2, 0]), seria("z", [4, 1])]),
        { displayDecimals: decimals },
      );
      expect(niedozwoloneWartosci(model, `decimals=${decimals}`)).toEqual([]);
    }
  });

  it("slot poza paletą schodzi na POZYCJĘ w stosie, a nie na pierwszy slot", () => {
    // Slot poza zakresem 1..8 nie ma tokena, więc segment wyszedłby bez
    // wypełnienia. Odruchowe `Math.max(1, ...)` sprowadziłoby jednak wszystkie
    // takie slupki do jedynki, a dwa segmenty w jednym kolorze przestają być
    // kluczem legendy - w stosie tożsamości nie niesie nic poza kolorem
    // i etykietą. Pozycja jest unikalna z definicji, więc to ona jest
    // osłoną - tak samo jak w `parseChartSeries`.
    const model = percentStackedModel(
      wejscie(
        ["A"],
        [
          { name: "x", values: [1], colorSlot: Number.NaN },
          seria("y", [1], 0),
          seria("z", [1], 99),
          seria("v", [1], 5),
        ],
      ),
    );
    // Slot spoza palety schodzi na slot z SEKWENCJI dla tej pozycji w stosie,
    // a nie na numer pozycji: dwa segmenty w jednym kolorze byłyby gorsze niż
    // segment w kolorze, którego autor nie wybrał.
    const oczekiwane = [slotForSeries(0), slotForSeries(1), slotForSeries(2), 5];
    expect(model.bars[0].segments.map((s) => s.colorSlot)).toEqual(oczekiwane);
    expect(model.series.map((s) => s.colorSlot)).toEqual(oczekiwane);
  });
});
