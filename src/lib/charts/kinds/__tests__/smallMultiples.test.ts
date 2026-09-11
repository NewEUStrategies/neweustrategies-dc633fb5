// Model small multiples. Ten plik pinuje ZACHOWANIE, nie implementację:
// liczby pinujemy tam, gdzie wynikają z reguły podanej w specyfikacji (siatka
// jak najbliższa docelowej proporcji panelu, wspólna oś wartości, indeks
// z bazą 100), a wszędzie indziej sprawdzamy własności, które muszą zostać
// prawdziwe po każdej przebudowie: że panele dzielą JEDNĄ domenę, że osobna
// skala nie wchodzi po cichu, że panel bez danych NIE WYPADA z siatki, że
// kolejność paneli nie zależy od kolejności w arkuszu i że model NIGDY nie
// produkuje NaN ani nieskończoności.
//
// Najważniejsza grupa w tym pliku to "dane z bazy": treść bloku przychodzi
// z bazy i może pochodzić z wersji edytora, której ten kod nie zna, a bramka
// `src/components/blocks/__tests__/blockMatrix.test.tsx` sprawdza
// `textContent` bloków na obecność napisu "NaN" - `Intl.NumberFormat.format`
// zwraca dla nieliczby literalne "NaN", więc jedna nieosłonięta dzielnia
// w modelu wychodzi na stronie jako tekst.
import { describe, expect, it } from "vitest";
import {
  SMALL_MULTIPLES_FLATTENED_SHARE,
  SMALL_MULTIPLES_INDEX_BASE,
  SMALL_MULTIPLES_MAX_COMFORT,
  SMALL_MULTIPLES_MIN_PANEL_H,
  SMALL_MULTIPLES_MIN_PANEL_W,
  smallMultiplesExtent,
  smallMultiplesFit,
  smallMultiplesFormAdvice,
  smallMultiplesGrid,
  smallMultiplesModel,
  smallMultiplesModelFromConfig,
  smallMultiplesTable,
  type SmallMultiplesInput,
  type SmallMultiplesModel,
  type SmallMultiplesOptions,
} from "@/lib/charts/kinds/smallMultiples";
import { defaultChartConfig } from "@/lib/charts/parse";
import { INDEX_BASE, baseUsable } from "@/lib/charts/stats";
import { MAX_SERIES, type ChartConfig, type ChartSeries } from "@/lib/charts/types";

/** Wszystkie liczby w strukturze, także zagnieżdżone w panelach i punktach. */
function zbierzLiczby(wartosc: unknown, out: number[] = []): number[] {
  if (typeof wartosc === "number") {
    out.push(wartosc);
    return out;
  }
  if (Array.isArray(wartosc)) {
    for (const el of wartosc) zbierzLiczby(el, out);
    return out;
  }
  if (wartosc !== null && typeof wartosc === "object") {
    for (const el of Object.values(wartosc)) zbierzLiczby(el, out);
  }
  return out;
}

/** Wszystkie napisy w strukturze - do sprawdzenia, czy nie wyciekł "NaN". */
function zbierzNapisy(wartosc: unknown, out: string[] = []): string[] {
  if (typeof wartosc === "string") {
    out.push(wartosc);
    return out;
  }
  if (Array.isArray(wartosc)) {
    for (const el of wartosc) zbierzNapisy(el, out);
    return out;
  }
  if (wartosc !== null && typeof wartosc === "object") {
    for (const el of Object.values(wartosc)) zbierzNapisy(el, out);
  }
  return out;
}

/**
 * Jedno wspólne sprawdzenie dla całego pliku: model, tabela i doradzanie
 * formy nie zawierają ani jednej nieliczby i ani jednego napisu, który
 * bramka `blockMatrix` czyta jako defekt. Bez tego jedna nieosłonięta
 * dzielnia (a w tym modelu dzielimy przy każdej normalizacji pozycji, przy
 * średniej, przy indeksie, przy udziale osi i przy liczbie kolumn) wychodzi
 * na stronie jako napis "NaN" w tabeli danych.
 */
function bezNieliczb(model: SmallMultiplesModel): void {
  const struktury: unknown[] = [
    model,
    smallMultiplesTable(model),
    smallMultiplesFormAdvice(model),
    smallMultiplesExtent(model),
    smallMultiplesFit(model, { width: 640, height: 320 }),
  ];
  for (const struktura of struktury) {
    for (const l of zbierzLiczby(struktura)) {
      expect(Number.isFinite(l)).toBe(true);
    }
    for (const napis of zbierzNapisy(struktura)) {
      expect(napis).not.toContain("NaN");
      expect(napis).not.toContain("undefined");
      expect(napis).not.toContain("[object Object]");
      expect(napis).not.toContain("Infinity");
    }
  }
}

/** Wejście z paneli podanych jako pary nazwa - wartości. */
function wejscie(
  categories: readonly string[],
  panele: readonly (readonly [string, readonly (number | null)[]])[],
): SmallMultiplesInput {
  return { categories, panels: panele.map(([label, values]) => ({ label, values })) };
}

function model(
  categories: readonly string[],
  panele: readonly (readonly [string, readonly (number | null)[]])[],
  opts: SmallMultiplesOptions = {},
): SmallMultiplesModel {
  const m = smallMultiplesModel(wejscie(categories, panele), opts);
  bezNieliczb(m);
  return m;
}

function seria(name: string, values: (number | null)[], colorSlot = 1): ChartSeries {
  return { name, values, colorSlot };
}

function konfiguracja(over: Partial<ChartConfig> = {}): ChartConfig {
  return { ...defaultChartConfig(), ...over };
}

describe("siatka paneli", () => {
  it("dobiera liczbę kolumn tak, żeby komórka była najbliżej docelowej proporcji panelu", () => {
    // Bez tego siatka byłaby dobierana na oko (na przykład zawsze dwie
    // kolumny) i przy sześciu panelach w polu 640 na 320 px dostawalibyśmy
    // trzy rzędy po 320 na 106 px, czyli panele TRZYKROTNIE szersze niż
    // wysokie. Kąt nachylenia linii zależy od proporcji pola, więc taki
    // panel wygasza zmiany, których rysunek ma pokazać.
    expect(smallMultiplesGrid(6)).toMatchObject({ columns: 3, rows: 2 });
    expect(smallMultiplesGrid(4)).toMatchObject({ columns: 2, rows: 2 });
    expect(smallMultiplesGrid(2)).toMatchObject({ columns: 2, rows: 1 });
    expect(smallMultiplesGrid(12)).toMatchObject({ columns: 4, rows: 3 });
  });

  it("nie zostawia kolumny pustej w całości, ale zostawia niepełny ostatni rząd", () => {
    // Trzy panele w siatce 2 na 2 to jedno wolne miejsce w ostatnim rzędzie
    // i to jest nieuniknione. Kolumna pusta W CAŁOŚCI jest natomiast
    // zmarnowanym miejscem i po dociśnięciu nie powinna zostać: bez tego
    // dociśnięcia pięć paneli dostawało siatkę, w której skrajna kolumna
    // stała pusta w każdym rzędzie.
    const trzy = smallMultiplesGrid(3);
    expect(trzy).toMatchObject({ columns: 2, rows: 2, cells: 4, lastRowPanels: 1 });
    const piec = smallMultiplesGrid(5);
    expect(piec.columns * piec.rows).toBeGreaterThanOrEqual(5);
    expect(piec.columns).toBe(Math.ceil(5 / piec.rows));
  });

  it("respektuje wymuszoną liczbę kolumn, ale nigdy nie daje więcej kolumn niż paneli", () => {
    // Render, któremu zabrakło szerokości, zjeżdża do jednej kolumny - to
    // jedyne wyjście awaryjne tego rodzaju (patrz `smallMultiplesFit`).
    // Górne przycięcie chroni przed siatką 8 kolumn na 2 panele, w której
    // sześć kolumn stoi pustych i panele są ośmiokrotnie za wąskie.
    expect(smallMultiplesGrid(6, { columns: 1 })).toMatchObject({ columns: 1, rows: 6 });
    expect(smallMultiplesGrid(2, { columns: 8 }).columns).toBe(2);
  });

  it("komórki mają jednakowy rozmiar, także w niepełnym ostatnim rzędzie", () => {
    // Panel rozciągnięty na wolne miejsce miałby inną proporcję niż
    // pozostałe, a więc ten sam wzrost pokazywałby pod innym kątem - czyli
    // kodowałby coś, czego w danych nie ma.
    const m = model(
      ["2023", "2024", "2025"],
      [
        ["A", [3, 4, 5]],
        ["B", [2, 3, 4]],
        ["C", [1, 2, 3]],
      ],
    );
    const szerokosci = new Set(m.panels.map((p) => p.w));
    const wysokosci = new Set(m.panels.map((p) => p.h));
    expect(szerokosci.size).toBe(1);
    expect(wysokosci.size).toBe(1);
    expect(m.grid.lastRowPanels).toBe(1);
  });

  it("siatka bez paneli jest zerowa, a nie jednokomórkowa", () => {
    // Jedna komórka na zero paneli kazałaby renderowi narysować pustą ramkę
    // udającą panel, którego w danych nie ma.
    expect(smallMultiplesGrid(0)).toMatchObject({ columns: 0, rows: 0, cells: 0 });
  });

  it("geometria paneli jest względna i mieści się w obszarze siatki", () => {
    // Model nie zna pikseli, więc oddaje ułamki obszaru; gdyby oddawał
    // piksele, render musiałby je przeliczać przy każdej zmianie rozmiaru
    // i dwa rendery policzyłyby dwie różne siatki z tych samych danych.
    const m = model(
      ["a", "b"],
      [
        ["A", [1, 2]],
        ["B", [3, 4]],
        ["C", [5, 6]],
        ["D", [7, 8]],
      ],
    );
    for (const p of m.panels) {
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.y).toBeGreaterThanOrEqual(0);
      expect(p.x + p.w).toBeLessThanOrEqual(1.0000001);
      expect(p.y + p.h).toBeLessThanOrEqual(1.0000001);
    }
  });
});

describe("wspólna oś wartości", () => {
  it("wszystkie panele dostają TĘ SAMĄ domenę, gdy skala jest wspólna", () => {
    // To jest cała racja bytu tego rodzaju: porównanie między panelami jest
    // prawdziwe wyłącznie wtedy, gdy panele dzielą oś. Bez tego dwie linie
    // na tej samej wysokości mogłyby różnić się o rzędy wielkości, a rysunek
    // wyglądałby dokładnie tak samo.
    const m = model(
      ["2023", "2024"],
      [
        ["A", [10, 20]],
        ["B", [1000, 2000]],
      ],
    );
    const domeny = new Set(m.panels.map((p) => `${p.domain.min}..${p.domain.max}`));
    expect(domeny.size).toBe(1);
    expect(m.honesty.commonScaleOk).toBe(true);
    expect(m.scale.shared.max).toBeGreaterThanOrEqual(2000);
  });

  it("pozycja punktu jest liczona wspólną domeną, więc panel o małych wartościach leży nisko", () => {
    // Gdyby każdy panel normalizował się własnym zakresem, panel [1, 2]
    // i panel [1000, 2000] miałyby identyczne linie - i to jest właśnie to
    // kłamstwo, przed którym broni wspólna oś.
    const m = model(
      ["a", "b"],
      [
        ["duży", [1000, 2000]],
        ["mały", [1, 2]],
      ],
    );
    const maly = m.panels.find((p) => p.label === "mały");
    const duzy = m.panels.find((p) => p.label === "duży");
    expect(maly?.points[1]?.v ?? 1).toBeLessThan(0.1);
    expect(duzy?.points[1]?.v ?? 0).toBeGreaterThan(0.5);
  });

  it("osobna skala per panel jest zgłaszana jako defekt, gdy nie została opisana", () => {
    // "Osobna skala per panel to defekt, o ile nie jest jawnie zadeklarowana
    // i opisana". Bez tego sprawdzenia autor przełącza skale w edytorze,
    // rysunek nadal wygląda na porównywalny, a nic pod nim tego nie prostuje.
    const bezOpisu = model(
      ["a", "b"],
      [
        ["A", [1, 2]],
        ["B", [1000, 2000]],
      ],
      { scaleMode: "free" },
    );
    expect(bezOpisu.honesty.commonScaleOk).toBe(false);
    expect(bezOpisu.honesty.freeScaleDeclaredOk).toBe(false);
    expect(smallMultiplesFormAdvice(bezOpisu)).toContain("undeclaredFreeScale");

    const zOpisem = model(
      ["a", "b"],
      [
        ["A", [1, 2]],
        ["B", [1000, 2000]],
      ],
      { scaleMode: "free", freeScaleNote: "Każdy panel ma własną skalę - patrz podpis." },
    );
    expect(zOpisem.honesty.commonScaleOk).toBe(false);
    expect(zOpisem.honesty.freeScaleDeclaredOk).toBe(true);
  });

  it("przy skali osobnej panele mają RÓŻNE domeny, a wspólna nadal jest policzona", () => {
    // Wspólna domena jest jedyną miarą tego, o ile panele się rozjeżdżają,
    // i idzie do podpisu tabeli - czytelnik ma wiedzieć, czego panele nie
    // dzielą.
    const m = model(
      ["a", "b"],
      [
        ["A", [1, 2]],
        ["B", [1000, 2000]],
      ],
      { scaleMode: "free" },
    );
    const domeny = new Set(m.panels.map((p) => `${p.domain.min}..${p.domain.max}`));
    expect(domeny.size).toBe(2);
    expect(m.scale.shared.max).toBeGreaterThanOrEqual(2000);
  });

  it("milczy o wspólnej skali, gdy jest mniej niż dwa panele z danymi", () => {
    // Konwencja repo: `null` znaczy NIE MA CZEGO SPRAWDZAĆ. Jeden panel nie
    // ma z czym być porównywany, więc model nie zaświadcza, że skala jest
    // wspólna - to byłoby zaświadczenie bez sprawdzenia.
    const m = model(["a", "b"], [["A", [1, 2]]]);
    expect(m.honesty.commonScaleOk).toBeNull();
    expect(m.honesty.freeScaleDeclaredOk).toBeNull();
  });
});

describe("spłaszczenie i indeks bazowy", () => {
  it("zgłasza, że wspólna oś spłaszcza wszystkie panele poza jednym", () => {
    // To jest ta druga pułapka, odwrotna do osobnych skal: wspólna oś jest
    // uczciwa, ale bezużyteczna, gdy jeden podmiot jest o rzędy wielkości
    // większy. Bez tej flagi render nie ma z czego wiedzieć, że dziewięć
    // paneli to płaskie kreski, a czytelnik odczyta z nich "nic się nie
    // działo" - zdanie o danych, którego dane nie potwierdzają.
    const m = model(
      ["2023", "2024"],
      [
        ["gigant", [0, 1000]],
        ["mały A", [1, 2]],
        ["mały B", [2, 3]],
      ],
    );
    expect(m.honesty.sharedScaleReadableOk).toBe(false);
    expect(m.indexBaseAdvised).toBe(true);
    expect(smallMultiplesFormAdvice(m)).toContain("indexBaseBetter");
    expect(m.flattenedPanels).toBe(2);
  });

  it("nie zgłasza spłaszczenia, gdy panele mają porównywalną zmienność", () => {
    // Ostrzeżenie, które widać zawsze, uczy ignorowania wszystkich ostrzeżeń
    // - dlatego próg jest udziałem osi, a nie samą różnicą poziomów.
    const m = model(
      ["a", "b", "c"],
      [
        ["A", [0, 5, 10]],
        ["B", [2, 5, 8]],
        ["C", [4, 5, 6]],
      ],
    );
    expect(m.honesty.sharedScaleReadableOk).toBe(true);
    expect(m.indexBaseAdvised).toBe(false);
    expect(m.flattenedPanels).toBe(0);
  });

  it("udział własnej zmienności w osi wyznacza spłaszczenie i mieści się w 0..1", () => {
    // `occupancy` jest liczbą, z której bierze się rozstrzygnięcie o indeksie
    // - i jedyną kolumną tabeli, która oddaje czytelnikowi to, CO WIDZI.
    const m = model(
      ["a", "b"],
      [
        ["gigant", [0, 1000]],
        ["mały", [1, 2]],
      ],
    );
    for (const p of m.panels) {
      expect(p.occupancy).not.toBeNull();
      expect(p.occupancy ?? -1).toBeGreaterThanOrEqual(0);
      expect(p.occupancy ?? 2).toBeLessThanOrEqual(1);
      expect(p.flattened).toBe((p.occupancy ?? 1) < SMALL_MULTIPLES_FLATTENED_SHARE && p.n >= 2);
    }
  });

  it("milczy o spłaszczeniu, gdy mniej niż dwa panele mają po dwie wartości", () => {
    // Panel z jedną wartością ma rozpiętość zero z definicji, a nie z powodu
    // skali; nazwanie go spłaszczonym byłoby zdaniem o osi tam, gdzie nie ma
    // czego spłaszczać.
    const m = model(
      ["a", "b"],
      [
        ["A", [5, null]],
        ["B", [null, 900]],
      ],
    );
    expect(m.honesty.sharedScaleReadableOk).toBeNull();
    expect(m.indexBaseAdvised).toBe(false);
  });

  it("indeks liczy bazę = 100 w tej samej kategorii dla wszystkich paneli", () => {
    // Baza wybierana per panel (na przykład "pierwsza niepusta") dawałaby
    // tempo mierzone od różnych momentów, czyli kłamstwo trudniejsze do
    // zauważenia niż osobne skale.
    const m = model(
      ["2023", "2024"],
      [
        ["A", [50, 100]],
        ["B", [1000, 1500]],
      ],
      { mode: "index" },
    );
    const a = m.panels.find((p) => p.label === "A");
    const b = m.panels.find((p) => p.label === "B");
    expect(a?.points[0]?.indexed).toBe(SMALL_MULTIPLES_INDEX_BASE);
    expect(b?.points[0]?.indexed).toBe(SMALL_MULTIPLES_INDEX_BASE);
    expect(a?.points[1]?.indexed).toBe(200);
    expect(b?.points[1]?.indexed).toBe(150);
    expect(m.honesty.indexBaseOk).toBe(true);
    expect(m.scale.indexBaseAt).toBe(0);
  });

  it("odrzuca bazę zerową i ujemną, zamiast dzielić przez nią", () => {
    // Zero daje dzielenie przez zero (czyli napis "NaN" na stronie), a liczba
    // ujemna ODWRACA kierunek: spadek z -10 do -20 wyszedłby jako wzrost
    // o 100%. Oba przypadki są wykluczone, a nie "obsłużone".
    const m = model(
      ["2023", "2024"],
      [
        ["zero", [0, 50]],
        ["ujemny", [-10, -20]],
        ["dobry", [10, 20]],
      ],
      { mode: "index" },
    );
    expect(m.panels.find((p) => p.label === "zero")?.indexable).toBe(false);
    expect(m.panels.find((p) => p.label === "ujemny")?.indexable).toBe(false);
    expect(m.panels.find((p) => p.label === "dobry")?.indexable).toBe(true);
    expect(m.honesty.indexBaseOk).toBe(false);
    for (const p of m.panels) {
      if (p.indexable) continue;
      for (const point of p.points) expect(point.indexed).toBeNull();
    }
  });

  it("milczy o bazie indeksu w trybie poziomu, choćby baza była zerowa", () => {
    // W trybie poziomu brakująca baza nie odbiera rysunkowi ani jednego
    // punktu - puściejsza jest tylko kolumna indeksu w tabeli. Zgłaszanie
    // tego jako defektu rysunku byłoby ostrzeżeniem o czymś, czego czytelnik
    // na rysunku nie zobaczy.
    const m = model(
      ["a", "b"],
      [
        ["zero", [0, 5]],
        ["dobry", [10, 20]],
      ],
    );
    expect(m.honesty.indexBaseOk).toBeNull();
    expect(m.panels.find((p) => p.label === "zero")?.indexable).toBe(false);
  });

  it("nie doradza indeksu, gdy panele już są w indeksie", () => {
    // Doradzanie stanu, w którym rysunek już jest, jest szumem - a szum
    // w ostrzeżeniach uczy ich ignorowania.
    const m = model(
      ["a", "b"],
      [
        ["gigant", [1, 1000]],
        ["mały", [1, 2]],
      ],
      { mode: "index" },
    );
    expect(m.indexBaseAdvised).toBe(false);
  });

  it("indeks przepełniający podwójną precyzję jest luką, a NIE zerem", () => {
    // REGRESJA NA URUCHOMIONY KONTRPRZYKŁAD. Wzór indeksu stał wcześniej
    // w tym modelu wprost i szedł przez osłonę WYŚWIETLANIA, która
    // nieskończoność mapuje na zero. Dla bazy 1e-5 i wartości 1e308 iloraz
    // wychodzi poza podwójną precyzję:
    expect((1e308 / 1e-5) * SMALL_MULTIPLES_INDEX_BASE).toBe(Infinity);
    // ...więc panel rosnący o piętnaście rzędów wielkości dostawał
    // `indexed: 0` i pozycję 0 na osi, czyli był rysowany NA SAMYM DOLE -
    // odczyt odwrotny do prawdy, i to bez napisu "NaN", który zauważyłaby
    // bramka. Uczciwą odpowiedzią jest milczenie: przerwana linia.
    const m = model(
      ["baza", "po"],
      [
        ["przepełnienie", [1e-5, 1e308]],
        ["spokojny", [10, 20]],
      ],
      { mode: "index" },
    );
    const p = m.panels.find((x) => x.label === "przepełnienie");
    expect(p?.indexable).toBe(true);
    expect(p?.points[0]?.indexed).toBe(SMALL_MULTIPLES_INDEX_BASE);
    expect(p?.points[1]?.indexed).toBeNull();
    expect(p?.points[1]?.state).toBe("gap");
    expect(p?.points[1]?.v).toBeNull();
    // I - to jest druga połowa defektu - zero nie wchodzi do WSPÓLNEJ osi.
    // Wciągnięte tam obniżało domenę wszystkich paneli do zera, czyli
    // spłaszczało panele, którym nic nie dolegało.
    expect(m.scale.shared.min).toBe(SMALL_MULTIPLES_INDEX_BASE);
    expect(m.scale.shared.max).toBe(200);
  });

  it("kolumna indeksu milczy o przepełnieniu, nie zabierając poziomu", () => {
    // W trybie poziomu ten sam iloraz idzie tylko do TABELI. Poziom jest
    // policzalny i zostaje (punkt nadal ma wartość i etykietę), a puste jest
    // wyłącznie to, czego nie da się orzec.
    const m = model(["baza", "po"], [["przepełnienie", [1e-5, 1e308]]]);
    const p = m.panels[0];
    expect(p?.points[1]?.state).toBe("value");
    expect(p?.points[1]?.value).toBe(1e308);
    expect(p?.points[1]?.indexed).toBeNull();
    const t = smallMultiplesTable(m);
    expect(t.rows[0]?.cells[1]?.indexed).toBeNull();
    expect(t.rows[0]?.cells[1]?.value).toBe(1e308);
  });

  it("baza = 100 jest TĄ SAMĄ liczbą, co w reszcie silnika", () => {
    // Zgodności z modelem indeksu bazowego pilnował dotąd komentarz. Teraz
    // pilnuje jej import, a ten test pilnuje importu: gdyby ktoś wpisał tu
    // z powrotem własną setkę, oba rodzaje mogłyby rozjechać się linią
    // odniesienia, którą czytelnik widzi w jednym opracowaniu.
    expect(SMALL_MULTIPLES_INDEX_BASE).toBe(INDEX_BASE);
  });

  it("o użyteczności bazy panelu rozstrzyga ten sam werdykt, co w `stats`", () => {
    // Trzy powody nieużyteczności są trzema różnymi zdaniami dla czytelnika,
    // ale rozstrzygnięcie ma być JEDNO - inaczej ten sam szereg bywa
    // indeksowalny w panelach i odrzucony w indeksie bazowym.
    const bazy = [10, 0, -10, null];
    const m = model(
      ["baza", "po"],
      bazy.map((b, i) => [`p${i}`, [b, 5]] as const),
      { mode: "index" },
    );
    for (const [i, b] of bazy.entries()) {
      expect(m.panels.find((p) => p.label === `p${i}`)?.indexable).toBe(baseUsable(b) === "ok");
    }
  });

  it("liczy `n` z pomiarów, nie z punktów narysowanych w indeksie", () => {
    // Sekcja 8 każe podać `n` obserwacji. Panel bez użytecznej bazy nie ma
    // w indeksie ani jednego punktu, ale pomiary w nim SĄ - gdyby `n` liczyło
    // narysowane punkty, przełączenie na indeks zmieniałoby zadeklarowaną
    // próbkę, czyli zdanie o danych.
    const poziom = model(
      ["a", "b"],
      [
        ["zero", [0, 50]],
        ["dobry", [10, 20]],
      ],
    );
    const indeks = model(
      ["a", "b"],
      [
        ["zero", [0, 50]],
        ["dobry", [10, 20]],
      ],
      { mode: "index" },
    );
    expect(poziom.observations).toBe(4);
    expect(indeks.observations).toBe(4);
  });
});

describe("panel bez danych", () => {
  it("zostaje w siatce jako pusty, nie jest pomijany", () => {
    // "Pominięcie zmienia siatkę i czytelnik traci podmiot": po usunięciu
    // jednego panelu pozostałe przeskakują o jedno miejsce, więc czytelnik,
    // który zna zestaw podmiotów, nie zauważy, że jednego nie ma - zauważy
    // tylko, że siatka jest inna niż poprzednio.
    const m = model(
      ["a", "b"],
      [
        ["A", [1, 2]],
        ["pusty", [null, null]],
        ["C", [3, 4]],
      ],
    );
    expect(m.panelCount).toBe(3);
    expect(m.panels).toHaveLength(3);
    expect(m.panels.map((p) => p.label)).toContain("pusty");
    expect(m.emptyPanels).toBe(1);
    expect(m.drawablePanels).toBe(2);
  });

  it("odmawia usunięcia pustych paneli i zgłasza samo żądanie jako defekt", () => {
    // Żądanie z przyszłej albo cofniętej wersji edytora ma być NAZWANE,
    // a nie wykonane po cichu: model zostawia panele i mówi, że ktoś prosił
    // o ich usunięcie.
    const m = model(
      ["a", "b"],
      [
        ["A", [1, 2]],
        ["pusty", [null, null]],
      ],
      { dropEmptyPanels: true },
    );
    expect(m.panels).toHaveLength(2);
    expect(m.honesty.emptyPanelsKeptOk).toBe(false);
  });

  it("milczy o pustych panelach, gdy żadnego nie ma", () => {
    const m = model(
      ["a", "b"],
      [
        ["A", [1, 2]],
        ["B", [3, 4]],
      ],
    );
    expect(m.honesty.emptyPanelsKeptOk).toBeNull();
  });

  it("pusty panel nie ma ani jednej pozycji na osi wartości", () => {
    // Zero zamiast `null` postawiłoby pusty panel na dolnej krawędzi, czyli
    // w miejscu prawdziwej wartości minimalnej - i pusty panel czytałby się
    // jako panel o najniższej wartości w zestawie.
    const m = model(
      ["a", "b"],
      [
        ["A", [1, 2]],
        ["pusty", [null, null]],
      ],
    );
    const pusty = m.panels.find((p) => p.label === "pusty");
    expect(pusty?.empty).toBe(true);
    expect(pusty?.points.every((pt) => pt.v === null && pt.state === "gap")).toBe(true);
    expect(pusty?.mean).toBeNull();
    expect(pusty?.span).toBeNull();
  });
});

describe("kolejność paneli", () => {
  it("porządkuje panele kluczem z danych, nie kolejnością w arkuszu", () => {
    // Kolejność jest w small multiples nośnikiem informacji tak samo jak
    // w posortowanych słupkach: czytelnik czyta panele rzędami i pierwsze
    // wrażenie bierze z pierwszego rzędu. Bez porządkowania to wrażenie
    // zależy od tego, jak autor wklejał wiersze.
    const m = model(
      ["a", "b"],
      [
        ["mały", [1, 1]],
        ["duży", [100, 100]],
        ["średni", [10, 10]],
      ],
    );
    expect(m.panels.map((p) => p.label)).toEqual(["duży", "średni", "mały"]);
    expect(m.honesty.orderFromDataOk).toBe(true);
  });

  it("kolejność jest stabilna: te same dane dają tę samą siatkę", () => {
    // Siatka, która przy dwóch przebudowach z tych samych danych wychodzi
    // inna, uczy czytelnika, że pozycja panelu nic nie znaczy. Remisy
    // rozstrzyga etykieta, a potem indeks wejściowy, więc porządek jest
    // zawsze pełny.
    const dane: readonly (readonly [string, readonly (number | null)[]])[] = [
      ["B", [5, 5]],
      ["A", [5, 5]],
      ["C", [5, 5]],
    ];
    const pierwszy = model(["a", "b"], dane).panels.map((p) => p.label);
    const drugi = model(["a", "b"], dane).panels.map((p) => p.label);
    expect(pierwszy).toEqual(drugi);
    expect(pierwszy).toEqual(["A", "B", "C"]);
  });

  it("zgłasza kolejność z arkusza jako defekt", () => {
    // Autor ma prawo zażądać kolejności wejściowej (bywa chronologiczna albo
    // urzędowa), ale model tego nie przemilcza - inaczej "kolejność wynika
    // z danych" byłoby obietnicą bez pokrycia.
    const m = model(
      ["a", "b"],
      [
        ["mały", [1, 1]],
        ["duży", [100, 100]],
      ],
      { order: "input" },
    );
    expect(m.panels.map((p) => p.label)).toEqual(["mały", "duży"]);
    expect(m.honesty.orderFromDataOk).toBe(false);
    expect(smallMultiplesFormAdvice(m)).toContain("sheetOrder");
  });

  it("zgłasza defekt także wtedy, gdy klucz porządkujący jest we wszystkich panelach równy", () => {
    // Wtedy o kolejności decyduje rozstrzygacz remisów, czyli w praktyce
    // alfabet i arkusz - a model nie może twierdzić, że panele są
    // uporządkowane danymi, skoro dane nie miały czym ich uporządkować.
    const m = model(
      ["a", "b"],
      [
        ["A", [5, 5]],
        ["B", [5, 5]],
      ],
    );
    expect(m.honesty.orderFromDataOk).toBe(false);
  });

  it("panele bez danych idą na koniec siatki", () => {
    // Pusty panel na pierwszym miejscu mówiłby czytelnikowi, że najważniejszy
    // podmiot nie ma danych - a mówi tylko, że alfabet albo arkusz tak
    // ustawiły.
    const m = model(
      ["a", "b"],
      [
        ["pusty", [null, null]],
        ["A", [1, 2]],
        ["B", [10, 20]],
      ],
    );
    expect(m.panels[m.panels.length - 1]?.label).toBe("pusty");
  });

  it("pozycja w siatce zgadza się z wierszem i kolumną", () => {
    // Render czyta panele rzędami, a tabela danych ma pokazać je w tej samej
    // kolejności - rozjazd między `position` a `row`/`column` dawałby tabelę
    // opisującą inny rysunek.
    const m = model(
      ["a"],
      [
        ["A", [4]],
        ["B", [3]],
        ["C", [2]],
        ["D", [1]],
      ],
    );
    for (const p of m.panels) {
      expect(p.row * m.grid.columns + p.column).toBe(p.position);
    }
  });
});

describe("jednostki paneli", () => {
  it("różne jednostki wymuszają skale osobne, bo wspólna oś porównywałaby nieporównywalne", () => {
    // Wspólna oś dla panelu w procentach i panelu w mld EUR to dwie osie Y
    // rozłożone na n paneli. Model schodzi do skal osobnych (mniejsze zło)
    // i zgłasza to, bo milczące spełnienie żądania wspólnej osi byłoby tu
    // defektem, a milcząca degradacja zostawiłaby autora w przekonaniu, że
    // panele są porównywalne.
    const m = smallMultiplesModel({
      categories: ["a", "b"],
      panels: [
        { label: "marża", values: [10, 12], unit: "%" },
        { label: "przychód", values: [1000, 1200], unit: "mln EUR" },
      ],
    });
    bezNieliczb(m);
    expect(m.honesty.sameUnitOk).toBe(false);
    expect(m.scale.requestedScaleMode).toBe("shared");
    expect(m.scale.scaleMode).toBe("free");
    expect(smallMultiplesFormAdvice(m)).toContain("mixedUnits");
  });

  it("zgodne jednostki zostawiają wspólną oś", () => {
    const m = smallMultiplesModel({
      categories: ["a", "b"],
      panels: [
        { label: "A", values: [10, 12], unit: "%" },
        { label: "B", values: [20, 22], unit: "%" },
      ],
    });
    bezNieliczb(m);
    expect(m.honesty.sameUnitOk).toBe(true);
    expect(m.scale.scaleMode).toBe("shared");
  });

  it("milczy o jednostkach, gdy autor ich nie podał", () => {
    // `ChartConfig` ma jedną jednostkę na cały wykres, więc przy panelach
    // będących wskaźnikami model nie ma czego porównać - i nie udaje, że
    // sprawdził.
    const m = model(
      ["a", "b"],
      [
        ["A", [1, 2]],
        ["B", [3, 4]],
      ],
    );
    expect(m.honesty.sameUnitOk).toBeNull();
  });
});

describe("pozostałe sprawdzenia uczciwości", () => {
  it("zgłasza liczby, które nie trafiły w żaden panel", () => {
    // Wartość za ostatnią kategorią nie ma na osi miejsca, w które mogłaby
    // trafić - nie ma jej ani na rysunku, ani w tabeli. Bez tego licznika
    // dane po cichu znikają przy skróceniu listy kategorii w edytorze.
    const m = model(
      ["a", "b"],
      [
        ["A", [1, 2, 3, 4]],
        ["B", [5, 6]],
      ],
    );
    expect(m.valuesOutsideGrid).toBe(2);
    expect(m.honesty.inGridOk).toBe(false);
  });

  it("zgłasza wartość przyciętą do domeny podanej z zewnątrz", () => {
    // Domena z zewnątrz służy do porównywania kilku rysunków jedną skalą,
    // więc model jej NIE rozszerza - ale punkt przycięty do krawędzi panelu
    // leży tam, gdzie danych nie ma, i to musi być powiedziane.
    const m = model(
      ["a", "b"],
      [
        ["A", [1, 2]],
        ["B", [5, 500]],
      ],
      { domain: { min: 0, max: 10 } },
    );
    expect(m.honesty.inDomainOk).toBe(false);
    expect(m.scale.domainFromData).toBe(false);
    const przyciete = m.panels.flatMap((p) => p.points).filter((pt) => pt.clamped);
    expect(przyciete.length).toBeGreaterThan(0);
    for (const pt of przyciete) expect(pt.v).toBeLessThanOrEqual(1);
  });

  it("milczy o domenie, gdy wyliczył ją z danych", () => {
    // Domena z danych obejmuje je z definicji, więc nie ma czego sprawdzać -
    // ta sama cisza co suma kontrolna mostka bez jawnego stanu końcowego.
    const m = model(["a"], [["A", [1]]]);
    expect(m.honesty.inDomainOk).toBeNull();
  });

  it("wymaga zera w osi tam, gdzie znacznik koduje długość", () => {
    // Sekcja 8: oś słupków ZAWSZE od zera, bo długość koduje wartość
    // i ucięta oś wprost zniekształca proporcję. Przy linii zero nie jest
    // wymagane, więc model milczy - ale fakt ucięcia niesie osobno.
    const slupki = model(
      ["a", "b"],
      [
        ["A", [100, 102]],
        ["B", [101, 103]],
      ],
      { mark: "bar", domain: { min: 100, max: 104 } },
    );
    expect(slupki.honesty.zeroBaselineOk).toBe(false);

    const linia = model(
      ["a", "b"],
      [
        ["A", [100, 102]],
        ["B", [101, 103]],
      ],
    );
    expect(linia.honesty.zeroBaselineOk).toBeNull();
    expect(linia.axisTruncated).toBe(true);
  });

  it("wymusza zero w domenie z danych przy słupkach", () => {
    const m = model(
      ["a", "b"],
      [
        ["A", [100, 102]],
        ["B", [101, 103]],
      ],
      { mark: "bar" },
    );
    expect(m.scale.shared.includesZero).toBe(true);
    expect(m.honesty.zeroBaselineOk).toBe(true);
    expect(m.axisTruncated).toBe(false);
  });

  it("milczy o domenie z zewnątrz, gdy panele i tak rysują się we własnych", () => {
    // Domena z zewnątrz jest domeną RYSOWANIA tylko przy skali wspólnej.
    // Przy osobnej nic nie może wyjść poza nią z definicji, więc "wszystko
    // się mieści" byłoby zdaniem o domenie, w której rysunek nie powstał.
    const m = model(
      ["a", "b"],
      [
        ["A", [1, 2]],
        ["B", [5, 500]],
      ],
      { domain: { min: 0, max: 10 }, scaleMode: "free", freeScaleNote: "opis" },
    );
    expect(m.honesty.inDomainOk).toBeNull();
  });

  it("zgłasza brak rozproszenia", () => {
    // Wszystkie linie płaskie znaczą, że kolor, pozycja i kształt nie niosą
    // nic - a jedno zdanie mówi to samo bez rysunku.
    const m = model(
      ["a", "b"],
      [
        ["A", [5, 5]],
        ["B", [5, 5]],
      ],
    );
    expect(m.honesty.spreadOk).toBe(false);
    expect(smallMultiplesFormAdvice(m)).toContain("noSpread");
  });

  it("porównuje zadeklarowane `n` z liczbą obserwacji", () => {
    // Sekcja 8 każe podać `n` w podpisie; jeśli autor wpisał inne `n`, niż
    // jest realnych punktów, podpis kłamie o próbce.
    const zgodne = model(
      ["a", "b"],
      [
        ["A", [1, 2]],
        ["B", [3, 4]],
      ],
      { declaredSampleSize: 4 },
    );
    expect(zgodne.honesty.declaredSampleOk).toBe(true);

    const niezgodne = model(
      ["a", "b"],
      [
        ["A", [1, 2]],
        ["B", [3, null]],
      ],
      { declaredSampleSize: 4 },
    );
    expect(niezgodne.observations).toBe(3);
    expect(niezgodne.honesty.declaredSampleOk).toBe(false);

    const niepodane = model(["a"], [["A", [1]]]);
    expect(niepodane.honesty.declaredSampleOk).toBeNull();
  });

  it("domyślnie daje wszystkim panelom jeden slot palety i wtedy milczy o zawijaniu", () => {
    // Ten rodzaj jest ODPOWIEDZIĄ na przepełniony budżet koloru ("powyżej
    // grupuj albo idź w small multiples"), więc sam koloru na kategorie nie
    // wydaje: tożsamość niesie pozycja panelu i podpis.
    const m = smallMultiplesModel({
      categories: ["a"],
      panels: [
        { label: "A", values: [1], colorSlot: 1 },
        { label: "B", values: [2], colorSlot: 2 },
      ],
    });
    bezNieliczb(m);
    expect(m.slotsUniform).toBe(true);
    expect(new Set(m.panels.map((p) => p.colorSlot)).size).toBe(1);
    expect(m.honesty.paletteWrapOk).toBeNull();
  });

  it("zgłasza zawinięcie palety, gdy paneli z własnymi slotami jest więcej niż slotów", () => {
    // Wtedy dwa panele dostają ten sam kolor, nie będąc w żadnej relacji -
    // kolor przestaje być kluczem, a nadal wygląda jak klucz.
    const duzo = Array.from({ length: MAX_SERIES + 2 }, (_, i) => ({
      label: `P${i}`,
      values: [i + 1],
      colorSlot: i + 1,
    }));
    const m = smallMultiplesModel({ categories: ["a"], panels: duzo }, { keepPanelSlots: true });
    bezNieliczb(m);
    expect(m.honesty.paletteWrapOk).toBe(false);

    const malo = smallMultiplesModel(
      {
        categories: ["a"],
        panels: [
          { label: "A", values: [1], colorSlot: 1 },
          { label: "B", values: [2], colorSlot: 2 },
        ],
      },
      { keepPanelSlots: true },
    );
    bezNieliczb(malo);
    expect(malo.honesty.paletteWrapOk).toBe(true);
  });
});

describe("dane z bazy: model nie rzuca i nie produkuje nieliczb", () => {
  it("pusta konfiguracja daje pusty model, a nie wyjątek", () => {
    // Treść bloku pochodzi z bazy i może być z wersji edytora, której ten kod
    // nie zna. Wyjątek w modelu wywraca cały wpis, a nie tylko wykres.
    const m = model([], []);
    expect(m.panelCount).toBe(0);
    expect(m.observations).toBe(0);
    expect(m.grid.cells).toBe(0);
    expect(smallMultiplesFormAdvice(m)).toEqual([]);
    expect(smallMultiplesTable(m).rows).toEqual([]);
  });

  it("panele bez ani jednej wartości nie dzielą przez zero", () => {
    // Tu zbiegają się wszystkie mianowniki modelu: średnia, udział osi,
    // iloraz poziomów i normalizacja pozycji. Bez osłon każde z nich daje
    // NaN, a `Intl.NumberFormat.format(NaN)` wychodzi na stronie jako napis.
    const m = model(
      ["a", "b"],
      [
        ["A", [null, null]],
        ["B", [null, null]],
      ],
    );
    expect(m.observations).toBe(0);
    expect(m.honesty.spreadOk).toBeNull();
    expect(m.honesty.inGridOk).toBeNull();
    expect(m.scale.levelRatio).toBeNull();
    for (const p of m.panels) expect(p.occupancy).toBeNull();
  });

  it("jedna kategoria stawia punkt na środku panelu, a nie na krawędzi", () => {
    // Jeden punkt nie ma początku ani końca szeregu; postawiony na 0
    // wyglądałby na szereg ucięty z prawej strony.
    const m = model(
      ["tylko"],
      [
        ["A", [1]],
        ["B", [2]],
      ],
    );
    expect(m.panels.every((p) => p.points[0]?.t === 0.5)).toBe(true);
    expect(smallMultiplesFormAdvice(m)).toContain("oneCategory");
  });

  it("jeden panel jest zgłaszany jako zła forma, a nie rysowany jak zestaw", () => {
    // Jeden panel to wykres, któremu siatka odebrała miejsce na osie
    // i etykiety - właściwą formą jest zwykły liniowy albo słupkowy.
    const m = model(["a", "b"], [["A", [1, 2]]]);
    expect(smallMultiplesFormAdvice(m)).toContain("singlePanel");
  });

  it("wartości nieskończone i NaN są traktowane jak LUKA, a nie jak liczba", () => {
    // Luka i zero to dwa różne zdania, a nieliczba nie jest żadnym z nich:
    // wpuszczona do domeny rozsadza całą skalę (wszystkie pozostałe panele
    // spłaszczają się do jednej kreski), a wpuszczona do etykiety wychodzi
    // jako napis "NaN".
    const m = smallMultiplesModel({
      categories: ["a", "b", "c"],
      panels: [
        { label: "A", values: [Number.NaN, 5, Number.POSITIVE_INFINITY] },
        { label: "B", values: [1, 2, 3] },
      ],
    });
    bezNieliczb(m);
    const a = m.panels.find((p) => p.label === "A");
    expect(a?.n).toBe(1);
    expect(a?.points[0]?.state).toBe("gap");
    expect(a?.points[2]?.state).toBe("gap");
    expect(m.scale.shared.max).toBeLessThan(100);
  });

  it("wartości ujemne nie wywracają ani osi, ani indeksu, ani procentu zmiany", () => {
    // Ujemne wartości mają sens w szeregu (saldo, zmiana), więc muszą
    // przechodzić; nie mają sensu jako baza indeksu, więc tam są odrzucane.
    const m = model(
      ["a", "b"],
      [
        ["A", [-10, -5]],
        ["B", [-1, 3]],
      ],
    );
    expect(m.scale.shared.min).toBeLessThan(0);
    const a = m.panels.find((p) => p.label === "A");
    expect(a?.change).toBe(5);
    // Procent liczony od WARTOŚCI BEZWZGLĘDNEJ pierwszej wartości: inaczej
    // wzrost z -10 do -5 wyszedłby jako spadek o 50%.
    expect(a?.changePct).toBe(50);
  });

  it("nie liczy procentu zmiany od zera", () => {
    // Procent od zera nie istnieje; podany jako "nieskończony wzrost" byłby
    // dosłownie nieliczbą na stronie.
    const m = model(
      ["a", "b"],
      [
        ["A", [0, 5]],
        ["B", [1, 2]],
      ],
    );
    const a = m.panels.find((p) => p.label === "A");
    expect(a?.change).toBe(5);
    expect(a?.changePct).toBeNull();
  });

  it("proporcje zerowe, ujemne i nieskończone nie psują siatki", () => {
    // Kontener bez rozmiaru w SSR daje proporcję 0 albo Infinity; NaN
    // w liczbie kolumn dałby siatkę bez ani jednego panelu.
    for (const aspect of [0, -3, Number.POSITIVE_INFINITY, Number.NaN]) {
      const g = smallMultiplesGrid(6, { areaAspect: aspect, panelAspect: aspect });
      expect(Number.isFinite(g.columns)).toBe(true);
      expect(g.columns).toBeGreaterThanOrEqual(1);
      expect(g.rows).toBeGreaterThanOrEqual(1);
      expect(g.columns * g.rows).toBeGreaterThanOrEqual(6);
    }
    const zla = smallMultiplesGrid(Number.NaN);
    expect(zla.columns).toBe(0);
  });

  it("indeks bazowy poza zakresem kategorii jest przycinany, a nie dzieli przez brak", () => {
    // Konfiguracja z cofniętej wersji edytora może wskazywać kategorię, której
    // już nie ma.
    const m = model(
      ["a", "b"],
      [
        ["A", [10, 20]],
        ["B", [30, 60]],
      ],
      { mode: "index", indexBaseAt: 99 },
    );
    expect(m.scale.indexBaseAt).toBe(1);
    expect(m.honesty.indexBaseOk).toBe(true);
  });

  it("płaski szereg nie daje osi o zerowej rozpiętości", () => {
    // Domena bez rozpiętości byłaby mianownikiem zerowym w każdej
    // normalizacji pozycji; `niceScale` rozsuwa ją symetrycznie, więc linia
    // nie leży na krawędzi panelu.
    const m = model(
      ["a", "b"],
      [
        ["A", [7, 7]],
        ["B", [7, 7]],
      ],
    );
    expect(m.scale.shared.span).toBeGreaterThan(0);
    for (const p of m.panels) {
      for (const pt of p.points) {
        expect(pt.v).not.toBeNull();
        expect(Number.isFinite(pt.v ?? Number.NaN)).toBe(true);
      }
    }
  });

  it("etykiety kategorii puste i zduplikowane nie wywracają modelu", () => {
    const m = model(
      ["", "", "a"],
      [
        ["", [1, 2, 3]],
        ["", [4, 5, 6]],
      ],
    );
    expect(m.panels).toHaveLength(2);
    expect(m.categories).toHaveLength(3);
  });
});

describe("model z konfiguracji silnika", () => {
  it("panelem jest seria, a osią kategorie", () => {
    // To odczyt dla pytania "kilka szeregów o różnej skali": każdy szereg
    // dostaje własny panel zamiast drugiej osi Y.
    const m = smallMultiplesModelFromConfig(
      konfiguracja({
        categories: ["2023", "2024"],
        series: [seria("PL", [10, 20]), seria("DE", [100, 200], 2)],
        unit: "%",
        sampleSize: 4,
      }),
    );
    bezNieliczb(m);
    expect(m.panelCount).toBe(2);
    expect(m.categories).toEqual(["2023", "2024"]);
    expect(m.panels.map((p) => p.label).sort()).toEqual(["DE", "PL"]);
    // Jednostka wykresu jest jedna, więc wszystkie panele mierzą to samo
    // i to jest PRAWDA, a nie zaświadczenie bez sprawdzenia.
    expect(m.honesty.sameUnitOk).toBe(true);
    expect(m.honesty.declaredSampleOk).toBe(true);
  });

  it("po transpozycji panelem jest kategoria, a osią nazwy serii", () => {
    // To odczyt dla pytania "wiele podmiotów na wielu wskaźnikach", gdy
    // w arkuszu podmioty stoją w kategoriach, a wskaźniki w seriach.
    const m = smallMultiplesModelFromConfig(
      konfiguracja({
        categories: ["PL", "DE", "FR"],
        series: [seria("ROIC", [10, 12, 9]), seria("marża", [4, 6, 5], 2)],
        unit: "%",
      }),
      { panelBy: "category" },
    );
    bezNieliczb(m);
    expect(m.panelCount).toBe(3);
    expect(m.categories).toEqual(["ROIC", "marża"]);
    expect(m.panels.map((p) => p.label).sort()).toEqual(["DE", "FR", "PL"]);
    // Panele są tu WSKAŹNIKAMI, a konfiguracja ma jedną jednostkę na cały
    // wykres - więc model milczy, zamiast zaświadczać zgodność jednostek,
    // której nie sprawdził.
    expect(m.honesty.sameUnitOk).toBeNull();
  });

  it("konfiguracja domyślna (bez serii i kategorii) nie rzuca", () => {
    const m = smallMultiplesModelFromConfig(konfiguracja());
    bezNieliczb(m);
    expect(m.panelCount).toBe(m.panels.length);
  });

  it("`sampleSize` z konfiguracji jest domyślny, nie nadrzędny", () => {
    // Wywołujący, który rysuje wycinek danych, zna próbkę lepiej niż blok.
    const m = smallMultiplesModelFromConfig(
      konfiguracja({
        categories: ["a", "b"],
        series: [seria("A", [1, 2])],
        sampleSize: 99,
      }),
      { declaredSampleSize: 2 },
    );
    bezNieliczb(m);
    expect(m.honesty.declaredSampleOk).toBe(true);
  });
});

describe("mieszczenie się paneli w pikselach", () => {
  it("mówi, że rodzaj przestał działać, gdy panel schodzi pod próg", () => {
    // Poniżej progu albo podpis panelu jest ucięty (a wtedy czytelnik nie wie,
    // który podmiot widzi), albo obszar kreślenia schodzi pod podłogę
    // `MIN_INNER_*` i rysunek przestaje być rysunkiem.
    const m = model(
      ["a", "b"],
      Array.from({ length: 12 }, (_, i) => [`P${i}`, [i + 1, i + 2]] as const),
    );
    const ciasno = smallMultiplesFit(m, { width: 300, height: 160 });
    expect(ciasno.ok).toBe(false);
    const luzno = smallMultiplesFit(m, { width: 1200, height: 600 });
    expect(luzno.ok).toBe(true);
    expect(luzno.panelWidth).toBeGreaterThanOrEqual(SMALL_MULTIPLES_MIN_PANEL_W);
    expect(luzno.panelHeight).toBeGreaterThanOrEqual(SMALL_MULTIPLES_MIN_PANEL_H);
  });

  it("podaje WYJŚCIE, a nie tylko diagnozę", () => {
    // Właściwą reakcją na ciasną siatkę jest zwężenie liczby kolumn (panele
    // stają się szersze), a nie zmniejszenie paneli ani usunięcie któregoś -
    // dlatego model podaje, ile kolumn utrzyma panele nad progiem.
    const m = model(
      ["a", "b"],
      Array.from({ length: 6 }, (_, i) => [`P${i}`, [i + 1, i + 2]] as const),
    );
    // Domyślna siatka to trzy kolumny, czyli panele po 70 px - pod progiem.
    // Dwie kolumny dają 105 px i mieszczą się, więc to jest odpowiedź, a nie
    // "zmniejsz panele" ani "wyrzuć podmiot".
    const fit = smallMultiplesFit(m, { width: 210, height: 400 });
    expect(m.grid.columns).toBe(3);
    expect(fit.ok).toBe(false);
    expect(fit.suggestedColumns).toBe(2);
  });

  it("mówi wprost, gdy siatka nie ma wyjścia awaryjnego", () => {
    // Gdy nawet jedna kolumna nie mieści się w wysokości, rodzaj nie ma
    // wariantu awaryjnego w siatce i trzeba zejść do tabeli ze sparklines
    // albo do samej tabeli danych.
    const m = model(
      ["a", "b"],
      Array.from({ length: 8 }, (_, i) => [`P${i}`, [i + 1, i + 2]] as const),
    );
    const fit = smallMultiplesFit(m, { width: 80, height: 80 });
    expect(fit.suggestedColumns).toBeNull();
    expect(fit.maxPanels).toBe(0);
  });

  it("nie dzieli przez zerowy ani nieskończony rozmiar", () => {
    const m = model(
      ["a"],
      [
        ["A", [1]],
        ["B", [2]],
      ],
    );
    for (const size of [
      { width: 0, height: 0 },
      { width: Number.POSITIVE_INFINITY, height: 100 },
      { width: Number.NaN, height: Number.NaN },
    ]) {
      const fit = smallMultiplesFit(m, size);
      for (const l of zbierzLiczby(fit)) expect(Number.isFinite(l)).toBe(true);
    }
  });

  it("powyżej progu wygody doradza tabelę ze sparklines", () => {
    const m = model(
      ["a", "b"],
      Array.from(
        { length: SMALL_MULTIPLES_MAX_COMFORT + 1 },
        (_, i) => [`P${i}`, [i + 1, i + 2]] as const,
      ),
    );
    expect(smallMultiplesFormAdvice(m)).toContain("tooManyPanels");
  });
});

describe("alternatywa tekstowa", () => {
  it("tabela idzie w kolejności PANELI, nie arkusza", () => {
    // Czytelnik, który szuka w tabeli podmiotu widzianego w drugim rzędzie,
    // ma go znaleźć na tej samej pozycji.
    const m = model(
      ["a", "b"],
      [
        ["mały", [1, 1]],
        ["duży", [100, 100]],
      ],
    );
    const t = smallMultiplesTable(m);
    expect(t.rows.map((r) => r.label)).toEqual(m.panels.map((p) => p.label));
    expect(t.rows.map((r) => r.position)).toEqual([0, 1]);
  });

  it("luka jedzie do tabeli jako luka, a nie jako zero", () => {
    // Tabela i panele muszą kłamać tak samo albo nie kłamać wcale; rozjazd
    // między nimi jest defektem samym w sobie.
    const m = model(
      ["a", "b"],
      [
        ["A", [1, null]],
        ["B", [3, 4]],
      ],
    );
    const t = smallMultiplesTable(m);
    const a = t.rows.find((r) => r.label === "A");
    expect(a?.cells[1]?.value).toBeNull();
    expect(a?.cells[1]?.state).toBe("gap");
    expect(a?.cells[1]?.text).not.toContain("0");
  });

  it("tabela nazywa panele, których liczb NIE DA SIĘ odczytać z rysunku", () => {
    // Small multiples są jedynym rodzajem, w którym część danych bywa
    // nieczytelna z założenia: panel spłaszczony przez wspólną oś pokazuje
    // płaską kreskę, a jego liczby istnieją wyłącznie w tabeli. Bez tej listy
    // czytelnik nie wie, których paneli nie wolno mu czytać z obrazka.
    const m = model(
      ["a", "b"],
      [
        ["gigant", [0, 1000]],
        ["mały A", [1, 2]],
        ["mały B", [2, 3]],
      ],
    );
    const t = smallMultiplesTable(m);
    expect(t.flattenedLabels).toEqual(expect.arrayContaining(["mały A", "mały B"]));
    expect(t.flattenedLabels).not.toContain("gigant");
    expect(t.levelRatio).not.toBeNull();
  });

  it("tabela niesie wspólną domenę także wtedy, gdy panele jej nie dzielą", () => {
    const m = model(
      ["a", "b"],
      [
        ["A", [1, 2]],
        ["B", [1000, 2000]],
      ],
      { scaleMode: "free", freeScaleNote: "opis" },
    );
    const t = smallMultiplesTable(m);
    expect(t.scaleMode).toBe("free");
    expect(t.shared.max).toBeGreaterThanOrEqual(2000);
  });

  it("tabela podaje indeks obok poziomu, także w trybie poziomu", () => {
    // Indeks jest sposobem PATRZENIA na szereg, a nie nową liczbą - dlatego
    // etykieta punktu zostaje w jednostkach danych, a indeks stoi w osobnej
    // kolumnie. Dzięki temu czytelnik widzi, dlaczego panel wygląda płasko.
    const m = model(
      ["a", "b"],
      [
        ["A", [50, 100]],
        ["B", [1000, 1100]],
      ],
    );
    const t = smallMultiplesTable(m);
    const a = t.rows.find((r) => r.label === "A");
    expect(a?.cells[1]?.indexed).toBe(200);
    expect(a?.cells[1]?.text).toContain("100");
  });

  it("zakres osi zwracany dla renderu zgadza się ze wspólną domeną", () => {
    const m = model(
      ["a", "b"],
      [
        ["A", [1, 2]],
        ["B", [5, 9]],
      ],
    );
    expect(smallMultiplesExtent(m)).toEqual({
      min: m.scale.shared.min,
      max: m.scale.shared.max,
    });
  });

  it("doradzanie formy milczy, gdy nie ma ani jednej obserwacji", () => {
    // Lista ostrzeżeń pod pustym wykresem mówi o danych, których nie ma.
    const m = model(
      ["a"],
      [
        ["A", [null]],
        ["B", [null]],
      ],
    );
    expect(smallMultiplesFormAdvice(m)).toEqual([]);
  });
});
