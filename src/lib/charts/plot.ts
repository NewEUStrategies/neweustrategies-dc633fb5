// STREFA TRAFIENIA: JEDNA IMPLEMENTACJA, TRZY GEOMETRIE.
//
// PO CO TEN MODUŁ ISTNIEJE. Przeniesienie wskaźnika z ekranu do układu
// rysunku było napisane WEWNĄTRZ `CartesianChart` jako domknięcie
// (`indexFromPointer`) i umiało dokładnie jedną rzecz: czytało JEDNĄ
// współrzędną i zwracało JEDEN indeks kategorii. To wystarcza dla linii,
// słupków i mostka, bo tam kategoria jest adresem. Nie wystarcza dla trzech
// rodzajów wykresu z sekcji 1 specyfikacji:
//
//   * MAPA CIEPŁA adresuje PARĄ (wiersz, kolumna) - jedna współrzędna nie
//     wskazuje komórki, tylko kolumnę;
//   * PUNKTOWY nie ma pasm ani równych odstępów - najbliższy punkt zależy od
//     obu współrzędnych jednocześnie;
//   * BEESWARM ma na jednej pozycji osi WIELE punktów rozsuniętych
//     prostopadle, więc bez drugiej współrzędnej nie da się wskazać żadnego.
//
// Jako domknięcie ten kod był też niedostępny dla testu inaczej niż przez
// wyrenderowanie całego wykresu i podstawienie `getBoundingClientRect` -
// czyli najdroższą możliwą drogą do sprawdzenia arytmetyki na czterech
// liczbach.
//
// UKŁAD WSPÓŁRZĘDNYCH, I DLACZEGO TO JEST TU ZAPISANE. `CartesianChart`
// rysuje `<svg width={width} height={height}>` BEZ `viewBox`. Brak `viewBox`
// znaczy, że jedna jednostka użytkownika to jeden piksel CSS, więc odległość
// euklidesowa liczona w jednostkach rysunku JEST odległością na ekranie.
// Gdyby ktoś dołożył `viewBox`, obie osie mogłyby dostać różne
// współczynniki skalowania i „najbliższy punkt" zaczęłoby zależeć od
// proporcji elementu, a nie od danych - dlatego niezmiennik „bez viewBox"
// pilnuje bramka w `__tests__/plot.test.ts`.
//
// Wszystko poniżej jest czystą arytmetyką: żadnego DOM-u, żadnego zdarzenia,
// żaden argument nie jest obiektem przeglądarki. Komponent podaje odczytany
// prostokąt i współrzędne, a dostaje adres.

/**
 * Prostokąt warstwy trafień na ekranie - to, co zwraca
 * `getBoundingClientRect()`, obcięte do czterech pól, których naprawdę
 * używamy. Węższy typ niż `DOMRect` po to, żeby test mógł podać zwykły
 * literał, a nie budować pełny `DOMRect` z ośmioma polami.
 */
export interface HitRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Punkt w układzie POLA RYSUNKU (nie całego SVG - bez marginesów osi). */
export interface PlotPoint {
  x: number;
  y: number;
}

/**
 * MAKSYMALNA ODLEGŁOŚĆ, Z JAKIEJ WOLNO PRZYPISAĆ WSKAŹNIK DO PUNKTU, w
 * pikselach.
 *
 * SKĄD TA LICZBA. WCAG 2.5.8 (Target Size Minimum, poziom AA) wymaga celu
 * wskazywania nie mniejszego niż 24 x 24 px. Użyta tu jako PROMIEŃ, daje
 * cel efektywny 48 x 48 px, czyli tyle, ile zalecają wytyczne dotykowe
 * (44-48 px) - punkt o średnicy 5,6 px jest inaczej niewskazywalny palcem.
 *
 * DLACZEGO NIE WIĘCEJ. Pole rysunku ma około 720 px szerokości, więc 24 px
 * to 3,3% szerokości: przy takim progu nie da się „trafić" w punkt leżący po
 * drugiej stronie chmury. Bez progu w ogóle (czyli przy zwykłym „najbliższy
 * wygrywa") wykres punktowy z czterema obserwacjami pokazywałby dymek
 * zawsze, w każdym miejscu płyty - a to jest twierdzenie, że wskaźnik jest
 * nad obserwacją, której tam nie ma.
 */
export const HIT_RADIUS_PX = 24;

/**
 * Przeniesienie wskaźnika z ekranu do pola rysunku.
 *
 * `null` znaczy „nie ma jak policzyć", i to jest odpowiedź, nie awaria:
 * prostokąt o zerowej szerokości albo wysokości daje element niezmierzony -
 * schowany przez `display: none`, jeszcze nie zmierzony przez przeglądarkę
 * albo (w testach) happy-dom, które zwraca z `getBoundingClientRect()` same
 * zera. Dzielenie przez zero dałoby tam `Infinity`, a po `Math.floor`
 * indeks, który wygląda jak prawdziwy - czyli dymek nad kategorią wybraną
 * przez przypadek.
 */
export function pointerToPlot(
  clientX: number,
  clientY: number,
  rect: HitRect,
  innerW: number,
  innerH: number,
): PlotPoint | null {
  if (!(rect.width > 0) || !(rect.height > 0)) return null;
  if (!Number.isFinite(clientX) || !Number.isFinite(clientY)) return null;
  return {
    x: ((clientX - rect.left) / rect.width) * innerW,
    y: ((clientY - rect.top) / rect.height) * innerH,
  };
}

/**
 * Najbliższy indeks na osi RÓWNOMIERNEJ, na której punkty leżą na
 * KRAWĘDZIACH - tak stoją punkty wykresu liniowego: pierwszy na lewej
 * krawędzi pola, ostatni na prawej, więc odstępów jest `count - 1`.
 *
 * Zaokrąglenie, nie obcięcie: czytelnik celuje w punkt, a nie w przedział
 * między punktami, więc granica decyzji ma biec w POŁOWIE odstępu.
 */
export function nearestPointIndex(along: number, span: number, count: number): number {
  if (count <= 1) return 0;
  if (!(span > 0) || !Number.isFinite(along)) return 0;
  const step = span / (count - 1);
  return clampIndex(Math.round(along / step), count);
}

/**
 * Indeks PASMA - tak stoją słupki: każdy siedzi w środku swojego pasma,
 * a pasm jest dokładnie `count`.
 *
 * Obcięcie, nie zaokrąglenie: pasmo jest przedziałem, a nie punktem, więc
 * całe pasmo należy do swojego słupka. Zaokrąglenie oddawałoby lewą połowę
 * pierwszego pasma indeksowi -1.
 */
export function bandIndex(along: number, band: number, count: number): number {
  if (count <= 0) return 0;
  if (!(band > 0) || !Number.isFinite(along)) return 0;
  return clampIndex(Math.floor(along / band), count);
}

/** Adres komórki macierzy - dla mapy ciepła i macierzy wrażliwości. */
export interface CellAddress {
  row: number;
  col: number;
}

/**
 * Adres komórki pod wskaźnikiem. `null`, gdy wskaźnik jest poza siatką albo
 * gdy siatka jest pusta - mapa ciepła bez wierszy nie ma komórki „zero".
 *
 * Wiersze liczone od GÓRY, bo tak są rysowane i tak je czyta człowiek;
 * pierwsza pozycja tablicy danych to pierwszy wiersz od góry, a nie od dołu.
 * Ta konwencja jest tu zapisana, bo pomyłka o jeden wiersz w mapie ciepła nie
 * wygląda na błąd - wygląda na inne dane.
 */
export function cellAddress(
  point: PlotPoint,
  innerW: number,
  innerH: number,
  rows: number,
  cols: number,
): CellAddress | null {
  if (rows <= 0 || cols <= 0) return null;
  if (!(innerW > 0) || !(innerH > 0)) return null;
  if (point.x < 0 || point.y < 0 || point.x > innerW || point.y > innerH) return null;
  return {
    row: clampIndex(Math.floor((point.y / innerH) * rows), rows),
    col: clampIndex(Math.floor((point.x / innerW) * cols), cols),
  };
}

/**
 * Najbliższy punkt chmury, albo `null`, gdy żaden nie leży bliżej niż
 * `maxDistance`.
 *
 * REMIS ROZSTRZYGA NIŻSZY INDEKS, i to nie jest szczegół implementacji:
 * bez jawnej reguły dymek nad dwoma pokrywającymi się obserwacjami
 * przeskakiwałby między nimi zależnie od kolejności iteracji, a ta zależy od
 * kolejności w danych. Wykres, który przy nieruchomym wskaźniku pokazuje raz
 * jedną, raz drugą obserwację, wygląda na zepsuty - i jest.
 *
 * Porównujemy KWADRATY odległości: pierwiastek jest monotoniczny, więc nie
 * zmienia zwycięzcy, a kosztuje tyle samo wywołań, ile jest punktów.
 */
export function nearestPointInCloud(
  point: PlotPoint,
  points: readonly PlotPoint[],
  maxDistance = HIT_RADIUS_PX,
): number | null {
  const limit = maxDistance * maxDistance;
  let best: number | null = null;
  let bestDist = Number.POSITIVE_INFINITY;
  for (let i = 0; i < points.length; i += 1) {
    const p = points[i];
    if (p === undefined) continue;
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
    const dx = p.x - point.x;
    const dy = p.y - point.y;
    const d = dx * dx + dy * dy;
    // Ostro mniejsze, nie „mniejsze lub równe" - to jest cała reguła remisu.
    if (d < bestDist && d <= limit) {
      bestDist = d;
      best = i;
    }
  }
  return best;
}

/** Przycięcie indeksu do zakresu tablicy. Wspólne, bo pomyłka tu jest cicha. */
function clampIndex(raw: number, count: number): number {
  if (!Number.isFinite(raw)) return 0;
  return Math.max(0, Math.min(count - 1, raw));
}
