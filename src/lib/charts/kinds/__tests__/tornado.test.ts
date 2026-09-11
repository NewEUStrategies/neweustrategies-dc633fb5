// Model tornada. Najważniejsze asercje w tym pliku są cztery i wszystkie
// dotyczą uczciwości, a nie wyglądu: bez przypadku bazowego model MILCZY
// (nie dorysowuje bazy z wyników), odwrócona para jest NAZWANA (a nie po
// cichu posortowana), asymetria rozpiętości ZOSTAJE (a nie jest uśredniana),
// i model nie wypuszcza NaN, Infinity ani `undefined` - bo
// `Intl.NumberFormat.format(NaN)` zwraca literalny napis "NaN", którego
// bramka `blockMatrix` szuka w `textContent` strony.
//
// Testy pinują ZACHOWANIE modelu, nie jego implementację: sprawdzają liczby,
// które czytelnik odczyta z rysunku i z tabeli, oraz orzeczenia, które
// wejdą do podpisu - a nie kolejność kroków, która do nich doprowadziła.
import { describe, expect, it } from "vitest";
import type { Json } from "@/lib/content-model/json";
import { parseChartConfig } from "@/lib/charts/parse";
import type { ChartSeries } from "@/lib/charts/types";
import {
  TORNADO_BAR_RATIO,
  TORNADO_COLUMNS,
  TORNADO_FLAT_RANKING_RATIO,
  TORNADO_MIN_PARAMS,
  TORNADO_ROWS_ADVICE_MAX,
  TORNADO_VALUE_LIMIT,
  tornadoExtent,
  tornadoFormAdvice,
  tornadoModel,
  tornadoModelFromConfig,
  tornadoTable,
  type TornadoInput,
  type TornadoModel,
  type TornadoOptions,
} from "@/lib/charts/kinds/tornado";

function seria(name: string, values: (number | null)[], colorSlot = 1): ChartSeries {
  return { name, values, colorSlot };
}

function wejscie(categories: string[], series: ChartSeries[]): TornadoInput {
  return { categories, series };
}

/**
 * Trzy parametry o wyraźnie różnych rozpiętościach wokół bazy 100, podane
 * w kolejności ARKUSZOWEJ, czyli nieposortowanej - bo właśnie posortowanie
 * jest tu przedmiotem testu.
 */
const PARAMETRY = ["Kurs EUR", "Cena energii", "Wolumen"];
const DOL = seria("Dolny koniec", [90, 95, 99]);
const GORA = seria("Górny koniec", [130, 108, 101]);
const Z_BAZA: TornadoOptions = { base: 100 };

/**
 * Skan całego modelu w poszukiwaniu wartości, które po sformatowaniu trafiłyby
 * do strony jako napis "NaN", "Infinity" albo "undefined". Chodzi po
 * strukturze rekurencyjnie, bo defekt tego rodzaju pojawia się zwykle w polu,
 * o którym nikt nie pamiętał (udział rozpiętości przy zerowym mianowniku,
 * asymetria przy zerowej rozpiętości, środek pasma przy zerze wierszy), a nie
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

describe("tornado - kolejność i kształt", () => {
  it("sortuje parametry malejąco po rozpiętości, bo z tego bierze się kształt tornada", () => {
    // Bez tego testu wolno byłoby zostawić kolejność arkuszową i wykres
    // nadal by się rysował - tylko przestałby odpowiadać na swoje pytanie.
    // Ranking wrażliwości jest tu niesiony SYLWETKĄ, więc kolejność wierszy
    // jest treścią, nie porządkiem prezentacji.
    const model = tornadoModel(
      wejscie(
        ["Wolumen", "Kurs EUR", "Cena energii"],
        [seria("Dolny", [99, 90, 95]), seria("Górny", [101, 130, 108])],
      ),
      Z_BAZA,
    );
    expect(model.rows.map((r) => r.label)).toEqual(["Kurs EUR", "Cena energii", "Wolumen"]);
    expect(model.rows.map((r) => r.rank)).toEqual([0, 1, 2]);
    expect(model.rows.map((r) => r.span)).toEqual([40, 13, 2]);
    // Renderer i tabela muszą wiedzieć, że indeks kategorii przestał być
    // pozycją wiersza - inaczej cokolwiek indeksuje po kategorii, pokaże
    // liczbę innego parametru.
    expect(model.reordered).toBe(true);
    expect(model.rows.map((r) => r.index)).toEqual([1, 2, 0]);
  });

  it("arkusz już posortowany nie jest przestawiany i model tego nie zgłasza", () => {
    // `reordered` musi odróżniać "przestawiłem" od "było dobrze". Gdyby było
    // zawsze prawdziwe, renderer nie miałby po czym poznać, że kolejność
    // kategorii jest bezpieczna, i tracił na tym każdą optymalizację
    // indeksowania po kategorii.
    const model = tornadoModel(wejscie(PARAMETRY, [DOL, GORA]), Z_BAZA);
    expect(model.reordered).toBe(false);
    expect(model.rows.map((r) => r.label)).toEqual(PARAMETRY);
  });

  it("rozpiętość mierzy WIDOCZNĄ szerokość wiersza, także gdy oba końce są po tej samej stronie bazy", () => {
    // Sedno różnicy między rozpiętością i wahaniem. Para (5, 9) przy bazie 0
    // jest rysowana od bazy do 9, czyli ma szerokość 9, a |high - low| = 4.
    // Sortowanie po wahaniu ustawiłoby ten wiersz NIŻEJ od wiersza (-3, 3),
    // który jest węższy - i wykres pokazywałby ranking inny niż ten, który
    // sam narysował.
    const model = tornadoModel(
      wejscie(["Jednostronny", "Symetryczny"], [seria("Dolny", [5, -3]), seria("Górny", [9, 3])]),
      { base: 0 },
    );
    expect(model.rows.map((r) => r.label)).toEqual(["Jednostronny", "Symetryczny"]);
    expect(model.rows[0].span).toBe(9);
    expect(model.rows[0].swing).toBe(4);
    expect(model.rows[1].span).toBe(6);
    // Para jednostronna jest faktem do przypisu, a nie orzeczeniem - patrz
    // osobny test w sekcji uczciwości.
    expect(model.honesty.oneSidedLabels).toEqual(["Jednostronny"]);
  });

  it("remis rozpiętości rozstrzyga stabilnie indeksem arkusza i go NAZYWA", () => {
    // Dwa parametry o tej samej rozpiętości stoją jeden nad drugim, więc
    // czytelnik odczyta z tego ranking, którego w danych nie ma. Kolejność
    // musi być stabilna (ten sam wykres na serwerze i w przeglądarce),
    // a remis musi być powiedziany.
    const model = tornadoModel(
      wejscie(["B", "A"], [seria("Dolny", [80, 80]), seria("Górny", [120, 120])]),
      Z_BAZA,
    );
    expect(model.rows.map((r) => r.label)).toEqual(["B", "A"]);
    expect(model.honesty.tiedSpanLabels).toEqual(["B", "A"]);
    expect(model.rows.every((r) => r.tiedWithNeighbour)).toBe(true);
  });

  it("różnica rozpiętości powyżej progu remisu nie jest remisem", () => {
    // Próg musi coś odsiewać, ale nie może zgłaszać każdej pary jako
    // nierozstrzygniętej - inaczej przypis o arbitralnej kolejności wisiałby
    // pod każdym tornadem i przestałby być czytany.
    const model = tornadoModel(
      wejscie(["A", "B"], [seria("Dolny", [80, 90]), seria("Górny", [120, 110])]),
      Z_BAZA,
    );
    expect(model.honesty.tiedSpanLabels).toEqual([]);
  });

  it("udział rozpiętości liczy z największej i nie dzieli przez zero", () => {
    // Wszystkie rozpiętości zerowe dają mianownik 0. Bez osłony `spanShare`
    // wychodziło NaN i tabela pokazywała "NaN%", czyli dokładnie to, czego
    // szuka bramka `blockMatrix`.
    const model = tornadoModel(
      wejscie(["A", "B"], [seria("Dolny", [100, 100]), seria("Górny", [100, 100])]),
      Z_BAZA,
    );
    expect(model.maxSpan).toBe(0);
    expect(model.rows.map((r) => r.spanShare)).toEqual([0, 0]);
    expect(niedozwoloneWartosci(model)).toEqual([]);
  });

  it("udział rozpiętości odnosi się do najszerszego słupka", () => {
    // To jedyna liczba w tabeli, która oddaje TO, CO CZYTELNIK WIDZI, więc
    // musi zgadzać się z długością słupka, a nie z wartością wyniku.
    const model = tornadoModel(wejscie(PARAMETRY, [DOL, GORA]), Z_BAZA);
    expect(model.rows[0].spanShare).toBe(1);
    expect(model.rows[1].spanShare).toBeCloseTo(13 / 40, 12);
    expect(model.rows[2].spanShare).toBeCloseTo(2 / 40, 12);
  });
});

describe("tornado - przypadek bazowy", () => {
  it("bez bazy MILCZY: żaden wiersz nie ma nóg, a liczby zostają do tabeli", () => {
    // Najważniejszy test w pliku. Bez bazy słupek nie ma od czego się
    // rozchodzić, a słupek liczony od zera kodowałby POZIOM wyniku przebrany
    // za wrażliwość. Model nie zgaduje bazy ze średniej nóg (byłoby to
    // podstawienie środka rozkładu pod przypadek bazowy) i nie zaświadcza,
    // że jest dobrze - orzeczenie o jednej bazie jest `null`, nie `false`
    // i nie `true`.
    const model = tornadoModel(wejscie(PARAMETRY, [DOL, GORA]));
    expect(model.base).toBeNull();
    expect(model.baseSource).toBe("none");
    expect(model.honesty.baseIsSingle).toBeNull();
    expect(model.rows.every((r) => r.legs.length === 0)).toBe(true);
    // Liczby jednak zostają: tabela jest zawsze pod wykresem i ranking
    // rozpiętości pary nie zależy od bazy.
    expect(model.rows[0].low).toBe(90);
    expect(model.rows[0].high).toBe(130);
    expect(model.rows[0].span).toBe(40);
    expect(tornadoFormAdvice(model)).toContain("noBase");
  });

  it("bazę bierze z serii, której NAZWA ją deklaruje, gdy jest stała", () => {
    // Obecny schemat bloku nie ma pola na bazę, więc bez tej drogi tornado
    // byłoby nierysowalne w trybie bezwzględnym do czasu rozszerzenia
    // konfiguracji. Rozpoznanie idzie po nazwie, bo nazwa jest DEKLARACJĄ
    // autora, a "seria o równych wartościach" to heurystyka, która
    // odpalałaby na płaskiej serii pomiarowej.
    const model = tornadoModel(
      wejscie(PARAMETRY, [DOL, GORA, seria("Przypadek bazowy", [100, 100, 100])]),
    );
    expect(model.base).toBe(100);
    expect(model.baseSource).toBe("series");
    expect(model.honesty.baseIsSingle).toBe(true);
    expect(model.rows[0].legs.length).toBe(2);
    // Seria bazowa nie jest nogą, więc nie może wejść do listy serii
    // nieczytanych - inaczej przypis mówiłby, że model ją zignorował.
    expect(model.honesty.extraSeriesNames).toEqual([]);
  });

  it("ta sama baza powtórzona w każdym wierszu to JEDNA baza, także z szumem arkusza", () => {
    // Typowy arkusz ma kolumnę bazy wypełnioną w każdym wierszu, a arkusz
    // liczy 0,1 + 0,2 jako 0,30000000000000004. Bez tolerancji względnej
    // model widziałby dwie różne bazy, zgłaszał defekt i przestawał rysować
    // poprawne dane.
    const model = tornadoModel(
      wejscie(
        ["A", "B"],
        [seria("Dolny", [0.1, 0.2]), seria("Górny", [0.5, 0.6]), seria("Baza", [0.3, 0.1 + 0.2])],
      ),
    );
    expect(model.honesty.baseIsSingle).toBe(true);
    expect(model.base).toBe(0.3);
    expect(model.honesty.baseSpread).toBe(0);
  });

  it("kilka RÓŻNYCH baz to defekt, a w trybie bezwzględnym model przestaje rysować", () => {
    // Słupki rozchodzące się od dwóch różnych linii nie są porównywalne,
    // czyli ginie jedyna rzecz, po którą się na tornado przychodzi. Model
    // nie wybiera bazy arbitralnie (pierwsza z arkusza), bo wybór jednej
    // z dwóch sprzecznych deklaracji byłby zgadywaniem.
    const model = tornadoModel(
      wejscie(PARAMETRY, [DOL, GORA, seria("Wartość bazowa", [100, 90, 100])]),
    );
    expect(model.honesty.baseIsSingle).toBe(false);
    expect(model.honesty.baseSpread).toBe(10);
    expect(model.base).toBeNull();
    expect(model.rows.every((r) => r.legs.length === 0)).toBe(true);
  });

  it("jawna baza z konfiguracji jest źródłem 'config' i wystarcza bez serii bazowej", () => {
    // To jest miejsce dla proponowanego pola `tornadoBase`: gdy silnik je
    // dostanie, żadna heurystyka po nazwie nie musi się odpalać.
    const model = tornadoModel(wejscie(PARAMETRY, [DOL, GORA]), { base: 100 });
    expect(model.baseSource).toBe("config");
    expect(model.honesty.baseIsSingle).toBe(true);
    expect(model.rows[0].legs.map((l) => l.value)).toEqual([90, 130]);
  });

  it("jawny indeks serii bazowej wygrywa z rozpoznaniem po nazwie", () => {
    // Rozpoznanie po nazwie jest awaryjną drogą dla obecnego schematu bloku,
    // a nie regułą nadrzędną: gdy silnik poda indeks wprost (przyszłe pole
    // konfiguracji), musi on wskazać bazę także wtedy, gdy seria nazywa się
    // dowolnie, a inna seria ma w nazwie słowo "bazowy". Odwrotne
    // pierwszeństwo znaczyłoby, że literówka w nazwie serii unieważnia
    // konfigurację.
    const model = tornadoModel(
      wejscie(
        ["Kurs"],
        [
          seria("Dolny", [90]),
          seria("Górny", [130]),
          seria("Scenariusz bazowy", [77]),
          seria("Odniesienie zarządu", [100]),
        ],
      ),
      { baseSeriesIndex: 3 },
    );
    expect(model.base).toBe(100);
    expect(model.baseSource).toBe("series");
    // Seria z bazowym słowem w nazwie nie jest wtedy bazą, więc musi trafić
    // na listę serii nieczytanych - inaczej zniknęłaby bez śladu.
    expect(model.honesty.extraSeriesNames).toEqual(["Scenariusz bazowy"]);
  });

  it("tryb odchyleń rysuje bez żadnej bazy, bo linia bazowa leży w zerze z definicji", () => {
    // Druga droga do kompletnego tornada na OBECNYM schemacie bloku:
    // odchylenia są samowystarczalne. Nie ma tu zgadywania - autor
    // zadeklarował, że liczby są odchyleniami.
    const model = tornadoModel(wejscie(["Kurs"], [seria("Dolny", [-10]), seria("Górny", [12])]), {
      mode: "deviation",
    });
    expect(model.base).toBe(0);
    expect(model.baseSource).toBe("zero");
    expect(model.rows[0].span).toBe(22);
    expect(model.rows[0].legs.map((l) => l.direction)).toEqual(["below", "above"]);
    // Poziomów wyniku nie znamy w ogóle, więc kolumny poziomów w tabeli
    // powtarzałyby odchylenia i nie wolno ich podać jako poziomy.
    expect(tornadoTable(model).hasAbsoluteLevels).toBe(false);
  });

  it("w trybie odchyleń podana baza podnosi odchylenia do POZIOMÓW", () => {
    // Odchylenia plus znany poziom bazowy dają pełny obraz i tabela może
    // pokazać jedno i drugie. Bez tego przeliczenia czytelnik musiałby
    // dodawać w głowie, czyli robić to, czego wykres ma go oszczędzić.
    const model = tornadoModel(wejscie(["Kurs"], [seria("Dolny", [-10]), seria("Górny", [12])]), {
      mode: "deviation",
      base: 100,
    });
    expect(model.base).toBe(100);
    expect(model.rows[0].low).toBe(90);
    expect(model.rows[0].high).toBe(112);
    expect(model.rows[0].lowDelta).toBe(-10);
    expect(model.rows[0].highDelta).toBe(12);
    expect(model.rows[0].span).toBe(22);
    expect(tornadoTable(model).hasAbsoluteLevels).toBe(true);
  });

  it("baza nieskończona i baza spoza zakresu dokładnej arytmetyki nie są bazą", () => {
    // Wartość z bazy danych może być czymkolwiek. Baza `Infinity` weszłaby
    // do odejmowania i cały model wychodziłby nieskończony, a `1e308` psuje
    // różnicę przez przekręcenie zakresu.
    for (const zla of [Infinity, -Infinity, Number.NaN, 1e308]) {
      const model = tornadoModel(wejscie(PARAMETRY, [DOL, GORA]), { base: zla });
      expect(model.base).toBeNull();
      expect(model.honesty.baseIsSingle).toBeNull();
      expect(niedozwoloneWartosci(model)).toEqual([]);
    }
  });
});

describe("tornado - znak, kierunek i geometria nogi", () => {
  it("znak koduje POZYCJĄ względem bazy i osobnym polem kierunku, nie samym kolorem", () => {
    // Około 8% mężczyzn nie odróżnia czerwieni od zieleni, więc dla nich
    // wykres kodowany wyłącznie kolorem jest pusty. Model musi oddać
    // kierunek jako dane, a krawędzie muszą leżeć po właściwej stronie
    // linii bazowej - kolor jest wtedy drugim nośnikiem, nigdy pierwszym.
    const model = tornadoModel(wejscie(["Kurs"], [seria("Dolny", [90]), seria("Górny", [130])]), {
      base: 100,
    });
    const [dolna, gorna] = model.rows[0].legs;
    expect(dolna.side).toBe("low");
    expect(dolna.direction).toBe("below");
    expect(dolna.delta).toBe(-10);
    // Krawędź odniesienia (kwadratowa podstawa) to dla nogi w dół GÓRNA
    // krawędź, czyli `to` - i musi leżeć dokładnie na bazie.
    expect(dolna.to).toBe(100);
    expect(dolna.from).toBe(90);
    expect(gorna.side).toBe("high");
    expect(gorna.direction).toBe("above");
    // Dla nogi w górę odniesieniem jest `from`.
    expect(gorna.from).toBe(100);
    expect(gorna.to).toBe(130);
  });

  it("nogi zawsze idą w kolejności dolna, górna - także przy odwróconej parze", () => {
    // Renderer rysuje po tej tablicy, a przypis mówi "dolny koniec
    // parametru". Gdyby kolejność zależała od wartości, przy odwróconej
    // parze etykieta trafiałaby na drugą nogę i wykres opisywałby dane
    // odwrotnie niż arkusz.
    const model = tornadoModel(wejscie(["Kurs"], [seria("Dolny", [130]), seria("Górny", [90])]), {
      base: 100,
    });
    expect(model.rows[0].legs.map((l) => l.side)).toEqual(["low", "high"]);
    expect(model.rows[0].legs.map((l) => l.direction)).toEqual(["above", "below"]);
  });

  it("noga równa bazie ma kierunek flat i zerową długość, ale zostaje w modelu", () => {
    // Zniknięcie takiej nogi byłoby nieuczciwe: "wynik się nie zmienia"
    // jest wynikiem pomiaru, a pusta przestrzeń czyta się jako brak danych.
    // Sekcja 3 mówi to samo o słupku o wartości zero - zostaje widoczną
    // kreską dzięki wsunięciu obwódki.
    const model = tornadoModel(wejscie(["Kurs"], [seria("Dolny", [100]), seria("Górny", [130])]), {
      base: 100,
    });
    const [dolna] = model.rows[0].legs;
    expect(dolna.direction).toBe("flat");
    expect(dolna.delta).toBe(0);
    expect(dolna.from).toBe(100);
    expect(dolna.to).toBe(100);
  });

  it("asymetrii rozpiętości NIE symetryzuje", () => {
    // Asymetria jest informacją o kształcie wrażliwości: "w dół wynik może
    // spaść o 40, w górę urosnąć o 8" to cała treść takiego wiersza.
    // Uśrednienie nóg albo dorysowanie brakującej strony zamieniłoby pomiar
    // na ozdobę symetryczną.
    const model = tornadoModel(wejscie(["Kurs"], [seria("Dolny", [60]), seria("Górny", [108])]), {
      base: 100,
    });
    const wiersz = model.rows[0];
    expect(wiersz.lowDelta).toBe(-40);
    expect(wiersz.highDelta).toBe(8);
    expect(wiersz.span).toBe(48);
    expect(wiersz.asymmetry).toBeCloseTo((8 - 40) / 48, 12);
    expect(model.honesty.maxAsymmetry).toBeCloseTo(32 / 48, 12);
  });

  it("asymetria przy zerowej rozpiętości MILCZY, zamiast twierdzić, że jest symetryczna", () => {
    // Zero znaczyłoby "sprawdzone, symetryczna". Przy zerowej rozpiętości
    // nie ma czego dzielić, więc jedyna uczciwa odpowiedź to brak
    // odpowiedzi - ta sama konwencja co przy sumie kontrolnej mostka.
    const model = tornadoModel(wejscie(["Kurs"], [seria("Dolny", [100]), seria("Górny", [100])]), {
      base: 100,
    });
    expect(model.rows[0].asymmetry).toBeNull();
    expect(model.honesty.maxAsymmetry).toBeNull();
  });

  it("pasma wierszy dzielą wysokość równo i nie wychodzą poza obszar kreślenia", () => {
    // Model operuje jednostkami względnymi, bo wysokości pola rysunku nie
    // zna - zna ją dopiero renderer. Pasmo jest osobne od słupka, bo strefa
    // trafienia nigdy nie jest kształtem elementu (sekcja 6): słupek
    // o rozpiętości 2 ma trzy piksele i jest nietrafialny.
    const model = tornadoModel(wejscie(PARAMETRY, [DOL, GORA]), Z_BAZA);
    expect(model.rows.map((r) => r.bandThickness)).toEqual([1 / 3, 1 / 3, 1 / 3]);
    // Porównanie z tolerancją, bo (rank + 0,5) * (1/3) i 5/6 różnią się
    // ostatnim bitem mantysy - a testujemy podział pasm, nie kolejność
    // mnożeń, którą model wykonuje.
    const srodki = model.rows.map((r) => r.bandCenter);
    expect(srodki[0]).toBeCloseTo(1 / 6, 12);
    expect(srodki[1]).toBeCloseTo(0.5, 12);
    expect(srodki[2]).toBeCloseTo(5 / 6, 12);
    for (const wiersz of model.rows) {
      expect(wiersz.barThickness).toBeCloseTo(wiersz.bandThickness * TORNADO_BAR_RATIO, 12);
      expect(wiersz.bandCenter - wiersz.bandThickness / 2).toBeGreaterThanOrEqual(0);
      expect(wiersz.bandCenter + wiersz.bandThickness / 2).toBeLessThanOrEqual(1);
      expect(wiersz.barThickness).toBeLessThan(wiersz.bandThickness);
    }
  });
});

describe("tornado - sprawdzenia uczciwości", () => {
  it("odwrócona para to DEFEKT i model podaje jej nazwę", () => {
    // Ciche posortowanie pary od mniejszej do większej ukryłoby defekt
    // i zgubiło informację o kierunku wpływu. Dlatego model ufa kolejności
    // serii i porównuje, zamiast normalizować.
    const model = tornadoModel(
      wejscie(["Kurs", "Cena"], [seria("Dolny", [130, 95]), seria("Górny", [90, 108])]),
      Z_BAZA,
    );
    expect(model.honesty.pairsOrdered).toBe(false);
    expect(model.honesty.invertedLabels).toEqual(["Kurs"]);
    expect(model.rows.find((r) => r.label === "Kurs")?.inverted).toBe(true);
    expect(model.rows.find((r) => r.label === "Cena")?.inverted).toBe(false);
    // Kierunek wpływu zostaje odczytywalny: ujemne wahanie znaczy "wynik
    // rośnie, gdy parametr maleje".
    expect(model.rows.find((r) => r.label === "Kurs")?.swing).toBe(-40);
  });

  it("para równa z dokładnością do szumu arytmetyki NIE jest odwrócona", () => {
    // 0,1 + 0,2 daje 0,30000000000000004, czyli formalnie więcej niż 0,3.
    // Bez tolerancji względnej model zgłaszałby defekt na danych, które są
    // poprawne, a autor nie miałby czego naprawić.
    const model = tornadoModel(
      wejscie(["A"], [seria("Dolny", [0.1 + 0.2]), seria("Górny", [0.3])]),
      { base: 0 },
    );
    expect(model.rows[0].inverted).toBe(false);
    expect(model.honesty.pairsOrdered).toBe(true);
  });

  it("gdy ŻADNA para nie jest kompletna, orzeczenie o kolejności par MILCZY", () => {
    // Różnica między `null` i `true` jest tu całą treścią konwencji: przy
    // jednej serii nie ma czego porównywać, więc model nie może zaświadczyć,
    // że pary są uporządkowane - bo par nie ma.
    const model = tornadoModel(wejscie(PARAMETRY, [DOL]), Z_BAZA);
    expect(model.honesty.pairsOrdered).toBeNull();
    expect(model.honesty.pairsComplete).toBe(false);
    expect(model.honesty.oneLeggedLabels).toEqual(["Kurs EUR", "Cena energii", "Wolumen"]);
  });

  it("jedna noga to niekompletna para: słupek pokazuje mniej wrażliwości niż jest", () => {
    // Wiersz z jedną nogą wygląda jak zmierzony, a jest połową pomiaru.
    // Bez tego orzeczenia ranking porównywałby połowę przedziału jednego
    // parametru z pełnym przedziałem drugiego.
    const model = tornadoModel(
      wejscie(["Kurs", "Cena"], [seria("Dolny", [90, null]), seria("Górny", [130, 108])]),
      Z_BAZA,
    );
    const cena = model.rows.find((r) => r.label === "Cena");
    expect(cena?.pair).toBe("highOnly");
    expect(cena?.legs.length).toBe(1);
    expect(cena?.swing).toBeNull();
    expect(cena?.asymmetry).toBeNull();
    expect(model.honesty.pairsComplete).toBe(false);
    expect(model.honesty.oneLeggedLabels).toEqual(["Cena"]);
  });

  it("parametr o ZEROWEJ rozpiętości jest nazwany, bo nic nie wnosi do rankingu", () => {
    // Taki wiersz zajmuje miejsce w rankingu i wygląda na pomiar. Nazwanie
    // go jest tanie, a bez tego czytelnik szuka słupka, którego nie ma.
    const model = tornadoModel(
      wejscie(["Kurs", "Podatek"], [seria("Dolny", [90, 100]), seria("Górny", [130, 100])]),
      Z_BAZA,
    );
    expect(model.honesty.allSpansContribute).toBe(false);
    expect(model.honesty.zeroSpanLabels).toEqual(["Podatek"]);
    // Wiersz zerowy spada na koniec rankingu, ale nie wypada z modelu.
    expect(model.rows.map((r) => r.label)).toEqual(["Kurs", "Podatek"]);
    expect(model.rows[1].zeroSpan).toBe(true);
  });

  it("parametr bez ani jednej liczby zostaje w rankingu jako pusty", () => {
    // Wyrzucenie takiego wiersza byłoby kadrowaniem: czytelnik nie
    // dowiedziałby się, że parametr był rozważany i nie ma danych.
    // "Nie podano" jest informacją.
    const model = tornadoModel(
      wejscie(["Kurs", "Stopa"], [seria("Dolny", [90, null]), seria("Górny", [130, null])]),
      Z_BAZA,
    );
    const stopa = model.rows.find((r) => r.label === "Stopa");
    expect(stopa?.pair).toBe("empty");
    expect(stopa?.legs).toEqual([]);
    expect(stopa?.span).toBe(0);
    expect(model.honesty.emptyLabels).toEqual(["Stopa"]);
    // Wiersz pusty nie jest niekompletną parą ani zerową rozpiętością - to
    // trzy różne fakty i trzy różne przypisy.
    expect(model.honesty.oneLeggedLabels).toEqual([]);
    expect(model.honesty.zeroSpanLabels).toEqual([]);
    expect(model.honesty.pairsComplete).toBe(true);
  });

  it("gdy nie ma ani jednej liczby, WSZYSTKIE orzeczenia MILCZĄ", () => {
    // Model bez danych nie ma prawa zaświadczyć o niczym. Gdyby zwracał
    // `true`, podpis pod wykresem twierdziłby, że pary są uporządkowane
    // i rozpiętości wnoszą treść - na pustym arkuszu.
    const model = tornadoModel(
      wejscie(["A", "B"], [seria("Dolny", [null, null]), seria("Górny", [null, null])]),
    );
    expect(model.honesty.pairsOrdered).toBeNull();
    expect(model.honesty.pairsComplete).toBeNull();
    expect(model.honesty.allSpansContribute).toBeNull();
    expect(model.honesty.baseIsSingle).toBeNull();
    expect(model.honesty.maxAsymmetry).toBeNull();
    expect(model.minSpan).toBeNull();
  });

  it("para jednostronna jest INFORMACJĄ, a nie orzeczeniem o defekcie", () => {
    // Odpowiedź wyniku na parametr nie musi być monotoniczna: oba końce
    // przedziału kursu mogą obniżać zysk. Model podaje fakt, a rozstrzyga
    // autor - dlatego nie ma tu boolean, który psułby werdykt o parach.
    const model = tornadoModel(
      wejscie(["Kurs"], [seria("Dolny", [105]), seria("Górny", [109])]),
      Z_BAZA,
    );
    expect(model.honesty.oneSidedLabels).toEqual(["Kurs"]);
    expect(model.honesty.pairsOrdered).toBe(true);
    expect(model.rows[0].straddlesBase).toBe(false);
    expect(model.rows[0].span).toBe(9);
  });

  it("powtórzone etykiety parametrów są nazwane, bo po sortowaniu nie sąsiadują", () => {
    // Dwa wiersze o tej samej nazwie w dwóch różnych miejscach rankingu są
    // nierozróżnialne, a czytelnik zakłada, że nazwa identyfikuje parametr.
    const model = tornadoModel(
      wejscie(
        ["Kurs", "Cena", "Kurs"],
        [seria("Dolny", [90, 95, 99]), seria("Górny", [130, 108, 101])],
      ),
      Z_BAZA,
    );
    expect(model.honesty.duplicateLabels).toEqual(["Kurs"]);
    expect(tornadoTable(model).rows.filter((r) => r.notes.includes("duplicate")).length).toBe(2);
  });

  it("wartość poza zakresem dokładnej arytmetyki nie wchodzi do modelu i jest nazwana", () => {
    // Różnica dwóch liczb bliskich `MAX_VALUE` przekręca się w `Infinity`,
    // a powyżej 2^53 arytmetyka całkowita przestaje być dokładna - taka
    // wartość nie jest pomiarem, tylko uszkodzonym rekordem. Milczące
    // potraktowanie jej jako luki gubiłoby powód, dla którego wiersz jest
    // niekompletny.
    const model = tornadoModel(
      wejscie(
        ["Kurs", "Cena"],
        [seria("Dolny", [1e308, 95]), seria("Górny", [TORNADO_VALUE_LIMIT + 1000, 108])],
      ),
      Z_BAZA,
    );
    expect(model.honesty.outOfRangeLabels).toEqual(["Kurs"]);
    expect(model.rows.find((r) => r.label === "Kurs")?.pair).toBe("empty");
    expect(niedozwoloneWartosci(model)).toEqual([]);
  });

  it("liczba bez nazwy parametru jest POLICZONA, a nie przemilczana", () => {
    // Treść bloku pochodzi z bazy i może być z cofniętej wersji edytora,
    // gdzie dopisano wartość, a nie dopisano kategorii. Bez nazwy nie ma
    // czego narysować, ale zniknięcie liczby bez śladu jest cichą utratą
    // danych.
    const model = tornadoModel(
      wejscie(["Kurs"], [seria("Dolny", [90, 80, null]), seria("Górny", [130, 140])]),
      Z_BAZA,
    );
    expect(model.rows.length).toBe(1);
    expect(model.honesty.droppedValueCount).toBe(2);
  });

  it("serii, których tornado nie czyta, nie przemilcza", () => {
    // Rodzaj bierze dokładnie dwie nogi i najwyżej jedną bazę. Trzecia
    // seria pomiarowa znaczy, że autor spodziewał się czegoś innego (na
    // przykład trzech scenariuszy), i lepiej mu to powiedzieć.
    const model = tornadoModel(
      wejscie(
        ["Kurs"],
        [
          seria("Dolny", [90]),
          seria("Górny", [130]),
          seria("Baza", [100]),
          seria("Scenariusz szokowy", [70]),
        ],
      ),
    );
    expect(model.honesty.extraSeriesNames).toEqual(["Scenariusz szokowy"]);
    expect(model.base).toBe(100);
  });
});

describe("tornado - odporność na dane z bazy", () => {
  /**
   * Bateria wejść, z których każde realnie przychodzi z bazy: pusty blok,
   * sama luka, jedna kategoria, wartości ujemne, baza ujemna, wartości
   * niesłużące niczemu (NaN, nieskończoności), tryb odchyleń bez danych,
   * opcje wskazujące serie, których nie ma, i seria dłuższa od kategorii.
   */
  const BATERIA: { nazwa: string; input: TornadoInput; opts?: TornadoOptions }[] = [
    { nazwa: "pusty blok", input: wejscie([], []) },
    { nazwa: "kategorie bez serii", input: wejscie(["A", "B"], []) },
    { nazwa: "serie bez kategorii", input: wejscie([], [seria("Dolny", [1, 2])]) },
    {
      nazwa: "sama luka",
      input: wejscie(["A"], [seria("Dolny", [null]), seria("Górny", [null])]),
      opts: Z_BAZA,
    },
    {
      nazwa: "jedna kategoria",
      input: wejscie(["A"], [seria("Dolny", [90]), seria("Górny", [130])]),
      opts: Z_BAZA,
    },
    {
      nazwa: "NaN i nieskończoności w danych",
      input: wejscie(
        ["A", "B"],
        [seria("Dolny", [Number.NaN, -Infinity]), seria("Górny", [Infinity, 108])],
      ),
      opts: Z_BAZA,
    },
    {
      nazwa: "wartości ujemne przy ujemnej bazie",
      input: wejscie(["A"], [seria("Dolny", [-80]), seria("Górny", [-20])]),
      opts: { base: -50 },
    },
    {
      nazwa: "baza zerowa i wartości zerowe",
      input: wejscie(["A"], [seria("Dolny", [0]), seria("Górny", [0])]),
      opts: { base: 0 },
    },
    {
      nazwa: "odchylenia bez bazy",
      input: wejscie(["A"], [seria("Dolny", [-1]), seria("Górny", [1])]),
      opts: { mode: "deviation" },
    },
    {
      nazwa: "opcje wskazujące serie, których nie ma",
      input: wejscie(["A"], [seria("Dolny", [90])]),
      opts: { base: 100, legs: { low: 7, high: 9 }, baseSeriesIndex: 42 },
    },
    {
      nazwa: "ta sama seria po obu stronach pary",
      input: wejscie(["A"], [seria("Dolny", [90]), seria("Górny", [130])]),
      opts: { base: 100, legs: { low: 0, high: 0 } },
    },
    {
      nazwa: "seria dłuższa od kategorii",
      input: wejscie(["A"], [seria("Dolny", [90, 91, 92]), seria("Górny", [130, 131])]),
      opts: Z_BAZA,
    },
    {
      nazwa: "skrajne wartości w zakresie dokładnej arytmetyki",
      input: wejscie(
        ["A"],
        [seria("Dolny", [-TORNADO_VALUE_LIMIT]), seria("Górny", [TORNADO_VALUE_LIMIT])],
      ),
      opts: { base: 0 },
    },
  ];

  it("nie rzuca i nie produkuje NaN, Infinity ani undefined przy żadnym wejściu brzegowym", () => {
    // TWARDE WYMAGANIE, nie życzenie: `Intl.NumberFormat.format(NaN)` zwraca
    // literalny napis "NaN", a bramka `blockMatrix` sprawdza `textContent`
    // strony na obecność napisów "NaN", "undefined" i "[object Object]".
    // Skan idzie po CAŁEJ strukturze, bo pole, o którym nikt nie pamiętał,
    // jest właśnie tym, które wypuści NaN.
    for (const przypadek of BATERIA) {
      const model = tornadoModel(przypadek.input, przypadek.opts);
      expect(niedozwoloneWartosci(model), przypadek.nazwa).toEqual([]);
      expect(niedozwoloneWartosci(tornadoTable(model)), przypadek.nazwa).toEqual([]);
      expect(niedozwoloneWartosci(tornadoExtent(model)), przypadek.nazwa).toEqual([]);
      expect(() => tornadoFormAdvice(model), przypadek.nazwa).not.toThrow();
    }
  });

  it("pusty blok daje puste tornado, nie wyjątek", () => {
    // Blok świeżo wstawiony przez autora nie ma jeszcze ani kategorii, ani
    // serii, a wpis musi się wyrenderować. Wyjątek w modelu wywraca cały
    // wpis, nie tylko wykres.
    const model = tornadoModel(wejscie([], []));
    expect(model.rows).toEqual([]);
    expect(model.maxSpan).toBe(0);
    expect(model.minSpan).toBeNull();
    expect(tornadoExtent(model)).toEqual({ min: 0, max: 0 });
    expect(tornadoTable(model).rows).toEqual([]);
  });

  it("NaN i nieskończoność w danych są traktowane jak brak, nie jak zero", () => {
    // Podstawienie zera pod NaN dorysowałoby słupek do linii bazowej
    // i czytelnik przeczytałby "parametr nie zmienia wyniku" tam, gdzie
    // pomiaru nie ma wcale.
    const model = tornadoModel(
      wejscie(["A"], [seria("Dolny", [Number.NaN]), seria("Górny", [Infinity])]),
      Z_BAZA,
    );
    expect(model.rows[0].low).toBeNull();
    expect(model.rows[0].high).toBeNull();
    expect(model.rows[0].pair).toBe("empty");
    expect(model.rows[0].legs).toEqual([]);
  });

  it("ujemna baza i ujemne wartości nie psują kierunków ani rozpiętości", () => {
    // "Wartości ujemne tam, gdzie nie mają sensu" jest w tym rodzaju
    // normalnym przypadkiem: wynikiem bywa strata. Kierunek liczy się
    // względem bazy, nie względem zera - i to jest cała różnica.
    const model = tornadoModel(wejscie(["A"], [seria("Dolny", [-80]), seria("Górny", [-20])]), {
      base: -50,
    });
    expect(model.rows[0].legs.map((l) => l.direction)).toEqual(["below", "above"]);
    expect(model.rows[0].lowDelta).toBe(-30);
    expect(model.rows[0].highDelta).toBe(30);
    expect(model.rows[0].span).toBe(60);
    expect(tornadoExtent(model)).toEqual({ min: -80, max: -20 });
  });

  it("jedna kategoria buduje się i dostaje poradę formy, a nie odmowę", () => {
    // Model nie jest cenzorem: rysuje, co dostał, i mówi, że lepiej byłoby
    // inaczej. Odmowa zostawiłaby autora z pustym miejscem we wpisie.
    const model = tornadoModel(
      wejscie(["A"], [seria("Dolny", [90]), seria("Górny", [130])]),
      Z_BAZA,
    );
    expect(model.rows.length).toBe(1);
    expect(model.rows[0].bandCenter).toBe(0.5);
    expect(tornadoFormAdvice(model)).toContain("singleParameter");
  });
});

describe("tornado - alternatywa tekstowa", () => {
  it("tabela idzie w KOLEJNOŚCI RYSOWANIA i niesie te same liczby co rysunek", () => {
    // Gdyby tabela sortowała po wahaniu, a rysunek po rozpiętości widocznej,
    // wiersz z parą jednostronną wypadłby w tabeli na innym miejscu niż na
    // wykresie i czytelnik odczytałby liczbę nie tego parametru. Dlatego
    // tabela powstaje z GOTOWEGO modelu, a nie liczy po raz drugi.
    const model = tornadoModel(
      wejscie(["Wolumen", "Kurs EUR"], [seria("Dolny", [99, 90]), seria("Górny", [101, 130])]),
      Z_BAZA,
    );
    const tabela = tornadoTable(model);
    expect(tabela.rows.map((r) => r.label)).toEqual(model.rows.map((r) => r.label));
    expect(tabela.rows.map((r) => r.rank)).toEqual([0, 1]);
    expect(tabela.rows[0]).toMatchObject({
      label: "Kurs EUR",
      low: 90,
      high: 130,
      lowDelta: -10,
      highDelta: 30,
      swing: 40,
      span: 40,
      spanShare: 1,
    });
    expect(tabela.base).toBe(100);
    expect(tabela.baseSource).toBe("config");
  });

  it("kolumny obejmują udział rozpiętości, czyli to, co czytelnik widzi", () => {
    // Bez tej kolumny tabela oddaje wyłącznie liczby, z których powstały
    // długości, i nie da się z niej sprawdzić samego RYSUNKU.
    expect(TORNADO_COLUMNS).toContain("span");
    expect(TORNADO_COLUMNS).toContain("spanShare");
    expect(TORNADO_COLUMNS[0]).toBe("parameter");
  });

  it("przypisy wiersza powtarzają dokładnie fakty z orzeczeń uczciwości", () => {
    // Dwie drogi do tych samych faktów (podpis pod wykresem z `honesty`,
    // przypis przy wierszu z tabeli) muszą mówić jednym głosem - rozjazd
    // między nimi jest defektem samym w sobie.
    const model = tornadoModel(
      wejscie(
        ["Odwrocony", "Zerowy", "Pusty", "Polowa"],
        [seria("Dolny", [130, 100, null, 90]), seria("Górny", [90, 100, null, null])],
      ),
      Z_BAZA,
    );
    const tabela = tornadoTable(model);
    const przypisy = new Map(tabela.rows.map((r) => [r.label, r.notes]));
    expect(przypisy.get("Odwrocony")).toContain("inverted");
    expect(przypisy.get("Zerowy")).toContain("zeroSpan");
    expect(przypisy.get("Pusty")).toContain("empty");
    expect(przypisy.get("Polowa")).toContain("oneLegged");
    expect(model.honesty.invertedLabels).toEqual(["Odwrocony"]);
    expect(model.honesty.zeroSpanLabels).toEqual(["Zerowy"]);
    expect(model.honesty.emptyLabels).toEqual(["Pusty"]);
    expect(model.honesty.oneLeggedLabels).toEqual(["Polowa"]);
  });

  it("tabela oznacza wiersz jednostronny, choć nie jest on defektem", () => {
    // Przypis "oneSided" jest jedynym miejscem, w którym czytelnik dowie się,
    // dlaczego słupek leży całkowicie po jednej stronie linii bazowej. Bez
    // niego taki wiersz wygląda na błąd rysowania, a bywa poprawnym obrazem
    // niemonotonicznej odpowiedzi wyniku na parametr.
    const model = tornadoModel(
      wejscie(
        ["Jednostronny", "Symetryczny"],
        [seria("Dolny", [105, 90]), seria("Górny", [109, 110])],
      ),
      Z_BAZA,
    );
    const tabela = tornadoTable(model);
    const jednostronny = tabela.rows.find((r) => r.label === "Jednostronny");
    const symetryczny = tabela.rows.find((r) => r.label === "Symetryczny");
    expect(jednostronny?.notes).toEqual(["oneSided"]);
    expect(symetryczny?.notes).toEqual([]);
  });

  it("bez bazy tabela nadal podaje liczby, choć rysunku nie ma", () => {
    // To jest sens milczenia modelu: brakuje bazy, więc nie ma słupków,
    // ale liczby z arkusza czytelnik dostaje mimo to. Grafika nigdy nie jest
    // jedyną drogą do liczby, a przy braku grafiki jest nią wyłącznie tabela.
    const model = tornadoModel(wejscie(PARAMETRY, [DOL, GORA]));
    const tabela = tornadoTable(model);
    expect(tabela.base).toBeNull();
    expect(tabela.rows[0].low).toBe(90);
    expect(tabela.rows[0].high).toBe(130);
    expect(tabela.rows[0].lowDelta).toBeNull();
    expect(tabela.rows[0].highDelta).toBeNull();
  });
});

describe("tornado - domena osi", () => {
  it("domena ZAWSZE zawiera linię bazową", () => {
    // Oś, która bazy nie zawiera, pokazywałaby długości bez punktu, od
    // którego są liczone. Tu wszystkie nogi leżą nad bazą, więc domena musi
    // ją dociągnąć od dołu.
    const model = tornadoModel(wejscie(["A"], [seria("Dolny", [105]), seria("Górny", [130])]), {
      base: 100,
    });
    expect(tornadoExtent(model)).toEqual({ min: 100, max: 130 });
  });

  it("bez bazy domena jest punktem, bo nie ma czego rysować", () => {
    // Zakres zbudowany z samych `low` i `high` sugerowałby, że wykres jest
    // kompletny - a renderer musi wtedy zejść do tabeli danych.
    const model = tornadoModel(wejscie(PARAMETRY, [DOL, GORA]));
    expect(tornadoExtent(model)).toEqual({ min: 0, max: 0 });
  });
});

describe("tornado - porady doboru formy", () => {
  function ranking(spans: number[]): TornadoModel {
    return tornadoModel(
      wejscie(
        spans.map((_s, i) => `P${i}`),
        [
          seria(
            "Dolny",
            spans.map((s) => 100 - s / 2),
          ),
          seria(
            "Górny",
            spans.map((s) => 100 + s / 2),
          ),
        ],
      ),
      Z_BAZA,
    );
  }

  it("płaski ranking jest nazwany, bo sylwetka tornada obiecuje kolejność, której nie ma", () => {
    // Przy rozpiętościach w granicach dziesięciu procent klin wykresu
    // pokazuje ranking rzędu grubości obwódki. To nie defekt danych, tylko
    // zły dobór formy - i o tym trzeba powiedzieć autorowi, nie czytelnikowi.
    const plaski = ranking([40, 39.5, 38.5, 37]);
    expect(plaski.maxSpan / (plaski.minSpan ?? 1)).toBeLessThanOrEqual(TORNADO_FLAT_RANKING_RATIO);
    expect(tornadoFormAdvice(plaski)).toContain("flatRanking");
    const wyrazny = ranking([40, 13, 2]);
    expect(tornadoFormAdvice(wyrazny)).not.toContain("flatRanking");
  });

  it("zbyt wiele wierszy jest nazwane, ale ŻADEN wiersz nie wypada", () => {
    // Obcięcie rankingu do "górnych dziesięciu" bez powiedzenia o tym jest
    // manipulacją przez kadrowanie (sekcja 8). Model doradza grupowanie
    // i oddaje wszystkie wiersze.
    const duzo = ranking(Array.from({ length: TORNADO_ROWS_ADVICE_MAX + 1 }, (_v, i) => i + 1));
    expect(duzo.rows.length).toBe(TORNADO_ROWS_ADVICE_MAX + 1);
    expect(tornadoFormAdvice(duzo)).toContain("tooManyRows");
    expect(tornadoFormAdvice(ranking([40, 13, 2]))).not.toContain("tooManyRows");
  });

  it("jeden parametr z treścią to nie tornado, a próg jest jawny", () => {
    // Jeden wiersz to zwykły słupek dwustronny i lepiej podać liczbę
    // w zdaniu. Wiersze puste i zerowe nie liczą się do progu, bo nie niosą
    // treści - inaczej tornado z jednym pomiarem i pięcioma pustymi
    // wierszami udawałoby ranking.
    const model = tornadoModel(
      wejscie(["A", "B", "C"], [seria("Dolny", [90, null, 100]), seria("Górny", [130, null, 100])]),
      Z_BAZA,
    );
    expect(TORNADO_MIN_PARAMS).toBe(2);
    expect(tornadoFormAdvice(model)).toContain("singleParameter");
  });

  it("kompletne tornado nie zbiera żadnej porady", () => {
    // Porady muszą być rzadkie, inaczej nikt ich nie czyta. Ten test jest
    // przeciwwagą dla czterech poprzednich: na danych, które są w porządku,
    // model milczy.
    expect(tornadoFormAdvice(ranking([40, 20, 8, 3]))).toEqual([]);
  });
});

describe("tornado - adapter z konfiguracji bloku", () => {
  /**
   * Arkusz w takiej postaci, w jakiej wychodzi z edytora bloku: parametry
   * w kategoriach, dwie kolumny wyników w seriach. `kind` jest tu obojętny,
   * bo adapter czyta wyłącznie kategorie i serie - a rodzaju "tornado" nie ma
   * jeszcze w `CHART_KINDS`, więc `parseChartConfig` zdegradowałby go do
   * słupków i test mówiłby o czymś innym, niż wygląda.
   */
  function blok(data: Record<string, Json>) {
    return parseChartConfig({ kind: "bar", animate: false, ...data });
  }

  const ARKUSZ: Record<string, Json> = {
    categories: PARAMETRY,
    series: [
      { name: "Dolny koniec", values: [90, 95, 99] },
      { name: "Górny koniec", values: [130, 108, 101] },
    ],
  };

  it("czyta arkusz bloku bez tłumaczenia konwencji w renderze", () => {
    // Gdyby render musiał sam wiedzieć, że kategoria to parametr, a pierwsza
    // seria to noga dolna, ta wiedza istniałaby w dwóch miejscach i jedno
    // z nich rozjechałoby się przy pierwszej zmianie schematu bloku.
    const model = tornadoModelFromConfig(blok(ARKUSZ), Z_BAZA);
    expect(model.rows.map((r) => r.label)).toEqual(["Kurs EUR", "Cena energii", "Wolumen"]);
    expect(model.rows[0].low).toBe(90);
    expect(model.rows[0].high).toBe(130);
    expect(model.rows[0].legs).toHaveLength(2);
  });

  it("rozpoznaje bazę po NAZWIE serii, bo schemat bloku nie ma na nią pola", () => {
    // To jest dzisiaj jedyna droga, którą autor wpisu może podać przypadek
    // bazowy bez zmiany schematu. Bez niej każde tornado z edytora byłoby
    // wykresem bez słupków - model milczy, gdy nie ma od czego odchylać.
    const model = tornadoModelFromConfig(
      blok({
        ...ARKUSZ,
        series: [
          { name: "Dolny koniec", values: [90, 95, 99] },
          { name: "Górny koniec", values: [130, 108, 101] },
          { name: "Scenariusz bazowy", values: [100, 100, 100] },
        ],
      }),
    );
    expect(model.base).toBe(100);
    expect(model.baseSource).toBe("series");
    expect(model.honesty.baseIsSingle).toBe(true);
    // Seria bazowa nie jest nogą: gdyby nią została, trzeci wiersz arkusza
    // wypadłby z pary i wykres pokazałby o jedną nogę mniej, niż autor podał.
    expect(model.honesty.extraSeriesNames).toEqual([]);
    expect(model.rows.every((r) => r.legs.length === 2)).toBe(true);
  });

  it("bez bazy w arkuszu oddaje liczby i PORADĘ, a nie słupki", () => {
    // Czytelnik zobaczy wtedy tabelę i jedno zdanie o brakującej wartości
    // bazowej - a nie paski dorysowane od środka rozkładu wyników.
    const model = tornadoModelFromConfig(blok(ARKUSZ));
    expect(model.base).toBeNull();
    expect(model.rows.every((r) => r.legs.length === 0)).toBe(true);
    expect(tornadoTable(model).rows[0].low).toBe(90);
    expect(tornadoFormAdvice(model)).toContain("noBase");
  });

  it("NIE odsiewa serii bez liczb, bo pozycja serii mówi, która noga jest która", () => {
    // Arkusz z pustą kolumną "niska" i wypełnioną "wysoka": po odsianiu
    // pustej seria "Wysoka" awansowałaby na nogę DOLNĄ i wykres podpisałby
    // wyniki przy wartości wysokiej jako niskie. To cicha zamiana znaczenia,
    // a nie brakująca dana - dlatego wiersze zostają jednonożne i model
    // nazywa je w `oneLeggedLabels`.
    const model = tornadoModelFromConfig(
      blok({
        ...ARKUSZ,
        series: [
          { name: "Niska", values: [null, null, null] },
          { name: "Wysoka", values: [130, 108, 101] },
        ],
      }),
      Z_BAZA,
    );
    expect(model.rows.every((r) => r.pair === "highOnly")).toBe(true);
    expect(model.rows[0].high).toBe(130);
    expect(model.honesty.pairsComplete).toBe(false);
    expect(model.honesty.oneLeggedLabels).toHaveLength(3);
  });

  it("przekazuje opcje wywołującego, bo tryb odchyleń jest polem bloku, nie kształtem liczb", () => {
    // Zgadywanie trybu z danych daje wykres, który rysuje się normalnie,
    // a stoi na linii bazowej w innym miejscu - i nic tego nie zdradza.
    // Dlatego tryb wchodzi z zewnątrz i adapter musi go przepuścić.
    const model = tornadoModelFromConfig(
      blok({
        categories: ["A", "B"],
        series: [
          { name: "Dolny", values: [-8, -3] },
          { name: "Górny", values: [2, 12] },
        ],
      }),
      { mode: "deviation" },
    );
    expect(model.base).toBe(0);
    expect(model.baseSource).toBe("zero");
    // Kolejność malejąca po rozpiętości działa tak samo jak na poziomach:
    // parametr B ma rozpiętość 15, A tylko 10.
    expect(model.rows.map((r) => r.label)).toEqual(["B", "A"]);
  });

  it("blok bez kategorii i bez serii nie wywraca modelu", () => {
    // Treść bloku pochodzi z bazy i bywa z cofniętej wersji edytora. Model
    // nie ma prawa rzucić, bo wyjątek wywraca cały wpis, nie tylko wykres.
    const model = tornadoModelFromConfig(blok({ categories: [], series: [] }));
    expect(model.rows).toEqual([]);
    expect(model.maxSpan).toBe(0);
    expect(niedozwoloneWartosci(model)).toEqual([]);
  });
});
