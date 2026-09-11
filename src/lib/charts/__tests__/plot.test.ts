// STREFA TRAFIENIA - ARYTMETYKA SPRAWDZANA BEZPOŚREDNIO, NIE PRZEZ RENDER.
//
// PO CO OSOBNY PLIK. Ta arytmetyka była domknięciem wewnątrz
// `CartesianChart`, więc jedyną drogą do jej sprawdzenia było wyrenderowanie
// wykresu, podstawienie `getBoundingClientRect` i wysłanie zdarzenia
// wskaźnika. Dla czterech liczb to najdroższa możliwa droga, a przy tym
// najsłabsza: przypadki graniczne (zerowy prostokąt, jeden punkt, wskaźnik
// poza polem) giną w szumie renderu.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

import {
  bandIndex,
  cellAddress,
  HIT_RADIUS_PX,
  nearestPointInCloud,
  nearestPointIndex,
  pointerToPlot,
} from "@/lib/charts/plot";

const RECT = { left: 40, top: 10, width: 720, height: 270 };

describe("pointerToPlot - przeniesienie z ekranu do pola rysunku", () => {
  it("skaluje proporcjonalnie, gdy element jest MNIEJSZY niż układ rysunku", () => {
    // Realny przypadek: pole rysunku ma 720 jednostek, a element na telefonie
    // 360 px. Bez skalowania wskaźnik na prawej krawędzi ekranu wskazywałby
    // środek danych.
    const p = pointerToPlot(40 + 180, 10 + 67.5, { ...RECT, width: 360, height: 135 }, 720, 270);
    expect(p).toEqual({ x: 360, y: 135 });
  });

  it("odejmuje przesunięcie elementu, nie tylko dzieli", () => {
    // `clientX` jest względem okna, nie elementu. Pominięcie `left` daje
    // przesunięcie o szerokość wszystkiego, co leży po lewej - w panelu
    // admina to cały sidebar.
    expect(pointerToPlot(40, 10, RECT, 720, 270)).toEqual({ x: 0, y: 0 });
  });

  it("ZEROWY prostokąt daje null, a nie Infinity", () => {
    // To nie jest przypadek teoretyczny: happy-dom zwraca z
    // `getBoundingClientRect()` same zera, a element schowany przez
    // `display: none` robi to samo w przeglądarce. Dzielenie przez zero dałoby
    // `Infinity`, a po `Math.floor` indeks wyglądający jak prawdziwy - czyli
    // dymek nad kategorią wybraną przez przypadek.
    expect(pointerToPlot(100, 100, { left: 0, top: 0, width: 0, height: 0 }, 720, 270)).toBeNull();
    expect(pointerToPlot(100, 100, { ...RECT, height: 0 }, 720, 270)).toBeNull();
  });

  it("współrzędna nie-liczba daje null", () => {
    expect(pointerToPlot(Number.NaN, 10, RECT, 720, 270)).toBeNull();
    expect(pointerToPlot(40, Number.POSITIVE_INFINITY, RECT, 720, 270)).toBeNull();
  });

  it("wskaźnik POZA elementem daje współrzędne poza polem, a nie przyciętą", () => {
    // Przycinanie musi zostać decyzją funkcji adresującej, nie
    // przeliczającej: mapa ciepła ma na „poza siatką" odpowiedzieć `null`,
    // a pasma kategorii mają się docisnąć do skrajnego pasma. Jedno
    // przycięcie tutaj odebrałoby mapie ciepła tę informację.
    const p = pointerToPlot(20, 10, RECT, 720, 270);
    expect(p?.x).toBeLessThan(0);
  });
});

describe("nearestPointIndex - punkty na KRAWĘDZIACH (linia)", () => {
  it("granica decyzji biegnie w POŁOWIE odstępu", () => {
    // Pięć punktów na 400 jednostkach to odstęp 100. Wskaźnik na 149 jest
    // bliżej punktu 1, na 151 bliżej punktu 2. Obcięcie zamiast zaokrąglenia
    // dałoby tu 1 w obu przypadkach, czyli dymek o jedną kategorię za wcześnie
    // przez całą prawą połowę każdego odstępu.
    expect(nearestPointIndex(149, 400, 5)).toBe(1);
    expect(nearestPointIndex(151, 400, 5)).toBe(2);
  });

  it("skrajne punkty siedzą na krawędziach pola", () => {
    expect(nearestPointIndex(0, 400, 5)).toBe(0);
    expect(nearestPointIndex(400, 400, 5)).toBe(4);
  });

  it("wskaźnik poza polem dociska się do skrajnego punktu", () => {
    // Wskaźnik wyjeżdża poza pole przy szybkim ruchu myszą; wtedy właściwą
    // odpowiedzią jest skrajna kategoria, a nie brak dymka.
    expect(nearestPointIndex(-500, 400, 5)).toBe(0);
    expect(nearestPointIndex(9000, 400, 5)).toBe(4);
  });

  it("JEDEN punkt nie dzieli przez zero", () => {
    // Odstępów jest `count - 1`, więc przy jednym punkcie mianownik to zero.
    expect(nearestPointIndex(123, 400, 1)).toBe(0);
    expect(nearestPointIndex(123, 400, 0)).toBe(0);
  });

  it("zerowa rozpiętość pola daje pierwszy punkt, nie NaN", () => {
    expect(nearestPointIndex(50, 0, 5)).toBe(0);
  });
});

describe("bandIndex - punkty w ŚRODKACH pasm (słupki)", () => {
  it("całe pasmo należy do swojego słupka", () => {
    // Pasmo 100 jednostek: 0 i 99,9 to ten sam słupek. Zaokrąglenie oddałoby
    // lewą połowę pierwszego pasma indeksowi -1, a prawą połowę ostatniego
    // indeksowi `count`.
    expect(bandIndex(0, 100, 4)).toBe(0);
    expect(bandIndex(99.9, 100, 4)).toBe(0);
    expect(bandIndex(100, 100, 4)).toBe(1);
  });

  it("prawa krawędź pola należy do OSTATNIEGO pasma", () => {
    // Dokładnie na krawędzi `floor(400/100)` daje 4, czyli indeks poza
    // tablicą - i to jest miejsce, w którym brak przycięcia daje `undefined`
    // w dymku.
    expect(bandIndex(400, 100, 4)).toBe(3);
  });

  it("zerowa szerokość pasma i brak pasm nie dają NaN", () => {
    expect(bandIndex(50, 0, 4)).toBe(0);
    expect(bandIndex(50, 100, 0)).toBe(0);
  });
});

describe("cellAddress - adres (wiersz, kolumna) dla mapy ciepła", () => {
  const W = 600;
  const H = 300;

  it("wiersze liczy od GÓRY, tak jak je widzi czytelnik", () => {
    // Konwencja zapisana wprost, bo pomyłka o jeden wiersz w mapie ciepła nie
    // wygląda na błąd - wygląda na inne dane.
    expect(cellAddress({ x: 10, y: 10 }, W, H, 3, 4)).toEqual({ row: 0, col: 0 });
    expect(cellAddress({ x: 10, y: 290 }, W, H, 3, 4)).toEqual({ row: 2, col: 0 });
  });

  it("kolumna i wiersz są NIEZALEŻNE - to jest cały sens tej funkcji", () => {
    // Jedna współrzędna nie wskazuje komórki. Ten przypadek pada dla każdej
    // implementacji, która czyta tylko x albo tylko y.
    expect(cellAddress({ x: 310, y: 110 }, W, H, 3, 4)).toEqual({ row: 1, col: 2 });
  });

  it("wskaźnik POZA siatką daje null, nie skrajną komórkę", () => {
    // Mapa ciepła rysuje siatkę na całym polu, więc „poza polem" znaczy
    // naprawdę poza danymi. Docisk do skrajnej komórki twierdziłby, że
    // wskaźnik jest nad wartością, której tam nie ma.
    expect(cellAddress({ x: -1, y: 10 }, W, H, 3, 4)).toBeNull();
    expect(cellAddress({ x: 10, y: 301 }, W, H, 3, 4)).toBeNull();
  });

  it("prawa i dolna KRAWĘDŹ należą do ostatniej komórki", () => {
    expect(cellAddress({ x: W, y: H }, W, H, 3, 4)).toEqual({ row: 2, col: 3 });
  });

  it("pusta siatka i zerowe pole dają null", () => {
    expect(cellAddress({ x: 10, y: 10 }, W, H, 0, 4)).toBeNull();
    expect(cellAddress({ x: 10, y: 10 }, W, H, 3, 0)).toBeNull();
    expect(cellAddress({ x: 10, y: 10 }, 0, H, 3, 4)).toBeNull();
  });
});

describe("nearestPointInCloud - najbliższa obserwacja, ale nie z drugiego końca płyty", () => {
  const CHMURA = [
    { x: 10, y: 10 },
    { x: 100, y: 100 },
    { x: 105, y: 100 },
    { x: 500, y: 250 },
  ];

  it("wybiera najbliższy punkt w OBU osiach naraz", () => {
    expect(nearestPointInCloud({ x: 102, y: 98 }, CHMURA)).toBe(1);
  });

  it("poza progiem zwraca null, a nie najbliższy z daleka", () => {
    // Bez progu wykres z czterema obserwacjami pokazywałby dymek w każdym
    // miejscu płyty - czyli twierdziłby, że wskaźnik jest nad obserwacją,
    // której tam nie ma.
    expect(nearestPointInCloud({ x: 300, y: 30 }, CHMURA)).toBeNull();
  });

  it("próg jest domknięty - punkt DOKŁADNIE na promieniu jeszcze się liczy", () => {
    expect(nearestPointInCloud({ x: 10 + HIT_RADIUS_PX, y: 10 }, CHMURA)).toBe(0);
    expect(nearestPointInCloud({ x: 10 + HIT_RADIUS_PX + 0.001, y: 10 }, CHMURA)).toBeNull();
  });

  it("REMIS rozstrzyga niższy indeks - dymek nie może migać", () => {
    // Dwie obserwacje w tym samym miejscu (beeswarm z remisami, punktowy
    // z duplikatami). Bez jawnej reguły dymek przeskakiwałby między nimi przy
    // NIERUCHOMYM wskaźniku, zależnie od kolejności w danych.
    const remis = [
      { x: 50, y: 50 },
      { x: 50, y: 50 },
    ];
    expect(nearestPointInCloud({ x: 50, y: 50 }, remis)).toBe(0);
    // Powtarzalność: ta sama odpowiedź przy każdym wywołaniu.
    expect(nearestPointInCloud({ x: 50, y: 50 }, remis)).toBe(0);
  });

  it("punkty z wartościami nie-liczba są POMIJANE, nie wybierane", () => {
    // Wartość szeregu może być NaN (pochodzi z bazy). Punkt o współrzędnej
    // NaN dawałby odległość NaN, a każde porównanie z NaN jest fałszywe -
    // więc bez jawnego pominięcia taki punkt nigdy nie wygra, ale też nie
    // przesłoni sąsiada. Asercja pilnuje, że sąsiad JEST wybierany.
    const zNan = [{ x: Number.NaN, y: 50 }, ...CHMURA];
    expect(nearestPointInCloud({ x: 102, y: 98 }, zNan)).toBe(2);
  });

  it("pusta chmura daje null", () => {
    expect(nearestPointInCloud({ x: 0, y: 0 }, [])).toBeNull();
  });

  it("własny próg zawęża i rozszerza zasięg", () => {
    expect(nearestPointInCloud({ x: 130, y: 100 }, CHMURA, 10)).toBeNull();
    expect(nearestPointInCloud({ x: 130, y: 100 }, CHMURA, 40)).toBe(2);
  });
});

describe("niezmiennik układu współrzędnych", () => {
  it("SVG wykresu kartezjańskiego NIE MA `viewBox`", () => {
    // TO JEST ZAŁOŻENIE, NA KTÓRYM STOI CAŁY TEN MODUŁ. Bez `viewBox` jedna
    // jednostka użytkownika to jeden piksel CSS, więc odległość euklidesowa
    // w jednostkach rysunku jest odległością na ekranie i próg
    // `HIT_RADIUS_PX` znaczy to, co mówi jego nazwa. Z `viewBox` obie osie
    // mogłyby dostać różne współczynniki skalowania i „najbliższy punkt"
    // zaczęłoby zależeć od proporcji elementu, a nie od danych - wtedy
    // `nearestPointInCloud` potrzebuje osobnych współczynników dla x i y.
    const zrodlo = readFileSync("src/components/charts/CartesianChart.tsx", "utf8");
    expect(zrodlo).not.toContain("viewBox");
  });
});
