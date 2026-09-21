// Wygładzanie linii serii: MONOTONICZNY HERMITE (Fritsch-Carlson), nie
// Catmull-Rom.
//
// DLACZEGO NIE ZWYKŁY SPLINE. Catmull-Rom PRZESTRZELIWUJE poza wartości
// sąsiednich punktów: dla serii 10, 40, 42 rysuje między drugim i trzecim
// punktem łuk sięgający ponad 42, czyli maksimum, którego w danych nie ma.
// Na wykresie marży albo długu to jest WYMYŚLONA LICZBA - czytelnik odczyta
// z krzywej wartość, której nikt nie zmierzył. Styczne monotoniczne nie
// wychodzą poza przedział wyznaczony przez sąsiednie obserwacje: jeśli seria
// rośnie, wygładzony odcinek też tylko rośnie.
//
// WARUNEK UCZCIWOŚCI. Wygładzenie wolno włączyć TYLKO gdy punkty obserwacji
// są widoczne - bez nich czytelnik nie wie, gdzie kończą się dane, a gdzie
// zaczyna interpolacja, i odczytuje wartość z miejsca, w którym jej nie
// zmierzono. Pilnuje tego silnik (CartesianChart wymusza widoczne punkty przy
// każdym wygładzeniu > 0), nie ten moduł - tu jest sama matematyka.
//
// SIŁA. Jedna stała 0..1 miesza dwa warianty tego samego odcinka: "prosta"
// (punkty kontrolne na cięciwie) i "krzywa monotoniczna" (punkty kontrolne na
// stycznych). 0 daje łamaną, 1 pełną krzywą, 0,55 to wartość domyślna -
// kształt przestaje być kanciasty, a jeszcze nie zaczyna udawać pomiaru
// ciągłego. Zejdź do 0, gdy: seria ma prawdziwe skoki (zdarzenie jednorazowe,
// przeszacowanie), punktów jest mniej niż cztery, albo wykres jest czytany
// jako dokument techniczny.

/** Punkt w pikselach obszaru kreślenia. */
export type Point = readonly [x: number, y: number];

/** Domyślna siła wygładzenia. */
export const SMOOTHING_DEFAULT = 0.55;

/**
 * Poniżej tylu punktów wygładzanie jest wyłączane BEZWARUNKOWO. Przy trzech
 * obserwacjach krzywa opowiada o kształcie, którego dane nie potwierdzają -
 * jedna zmiana kierunku na trzech punktach to nie trend, to dwa odcinki.
 */
export const SMOOTHING_MIN_POINTS = 4;

/**
 * Styczne monotoniczne w każdym punkcie (Fritsch, Carlson 1980).
 *
 * W punkcie, w którym nachylenie zmienia znak (ekstremum lokalne) albo jedno
 * z nachyleń sąsiednich jest zerowe, styczna jest POZIOMA - to jest cała
 * treść monotoniczności: krzywa nie może "wybiec" za ekstremum. W pozostałych
 * punktach styczna to średnia harmoniczna nachyleń, ważona długościami
 * odcinków, więc gęstsze próbkowanie po jednej stronie nie przeciąga
 * kształtu na swoją stronę.
 */
export function monotoneTangents(points: readonly Point[]): number[] {
  const n = points.length;
  if (n === 0) return [];
  if (n === 1) return [0];

  // Nachylenia cięciw. dx === 0 (dwa punkty w tej samej kolumnie) daje 0,
  // bo pochodna nie istnieje, a NaN rozlałby się na całą ścieżkę.
  const slopes: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    const dx = points[i + 1][0] - points[i][0];
    slopes.push(dx === 0 ? 0 : (points[i + 1][1] - points[i][1]) / dx);
  }

  const tangents: number[] = new Array<number>(n);
  tangents[0] = slopes[0];
  for (let i = 1; i < n - 1; i++) {
    const before = slopes[i - 1];
    const after = slopes[i];
    if (before * after <= 0) {
      tangents[i] = 0;
      continue;
    }
    const h1 = points[i][0] - points[i - 1][0];
    const h2 = points[i + 1][0] - points[i][0];
    const w1 = 2 * h2 + h1;
    const w2 = h2 + 2 * h1;
    tangents[i] = (w1 + w2) / (w1 / before + w2 / after);
  }
  tangents[n - 1] = slopes[n - 2];
  return tangents;
}

export interface CurveSegment {
  from: Point;
  to: Point;
  c1: Point;
  c2: Point;
}

/**
 * Odcinki krzywej Béziera trzeciego stopnia dla łamanej `points`.
 *
 * Punkty kontrolne są INTERPOLOWANE między wariantem prostym i monotonicznym,
 * więc jedna stała `strength` steruje całym kształtem i nie ma drugiego
 * pokrętła, które mogłoby się z nią rozjechać.
 */
export function curveSegments(
  points: readonly Point[],
  strength: number = SMOOTHING_DEFAULT,
): CurveSegment[] {
  const out: CurveSegment[] = [];
  if (points.length < 2) return out;
  const t = Math.max(0, Math.min(1, strength));
  const tangents = monotoneTangents(points);

  for (let i = 0; i < points.length - 1; i++) {
    const [x0, y0] = points[i];
    const [x1, y1] = points[i + 1];
    const h = (x1 - x0) / 3;
    // Wariant "linia prosta": punkty kontrolne na cięciwie w 1/3 i 2/3.
    const straight1 = y0 + (y1 - y0) / 3;
    const straight2 = y0 + (2 * (y1 - y0)) / 3;
    // Wariant "krzywa monotoniczna": punkty kontrolne na stycznych.
    const curved1 = y0 + tangents[i] * h;
    const curved2 = y1 - tangents[i + 1] * h;
    out.push({
      from: points[i],
      to: points[i + 1],
      c1: [x0 + h, straight1 + (curved1 - straight1) * t],
      c2: [x1 - h, straight2 + (curved2 - straight2) * t],
    });
  }
  return out;
}

/**
 * Ścieżka SVG dla JEDNEGO ciągu punktów (bez luk). `strength === 0` daje
 * łamaną `L`, żeby ścieżka techniczna nie nosiła zbędnych krzywych.
 */
export function pathFromPoints(
  points: readonly Point[],
  strength: number = SMOOTHING_DEFAULT,
): string {
  if (points.length === 0) return "";
  const fixed = (v: number): string => v.toFixed(1);
  const head = `M${fixed(points[0][0])} ${fixed(points[0][1])}`;
  if (points.length === 1) return head;

  const effective = points.length < SMOOTHING_MIN_POINTS ? 0 : Math.max(0, Math.min(1, strength));
  if (effective === 0) {
    return (
      head +
      points
        .slice(1)
        .map((p) => ` L${fixed(p[0])} ${fixed(p[1])}`)
        .join("")
    );
  }
  return (
    head +
    curveSegments(points, effective)
      .map(
        (s) =>
          ` C${fixed(s.c1[0])} ${fixed(s.c1[1])} ${fixed(s.c2[0])} ${fixed(s.c2[1])} ${fixed(
            s.to[0],
          )} ${fixed(s.to[1])}`,
      )
      .join("")
  );
}

/**
 * Czy wygładzenie ma się w ogóle włączyć dla serii o tej liczbie punktów.
 * Silnik pyta o to, żeby zdecydować, czy MUSI pokazać punkty obserwacji -
 * warunek uczciwości dotyczy wyłącznie linii naprawdę wygładzonej.
 */
export function isSmoothingActive(pointCount: number, strength: number): boolean {
  return strength > 0 && pointCount >= SMOOTHING_MIN_POINTS;
}

/**
 * Największe odejście wygładzonej krzywej od przedziału wyznaczonego przez
 * sąsiednie obserwacje. Dla stycznych monotonicznych musi być ZERO - to
 * mierzalna postać zdania "krzywa nie rysuje maksimów, których nie było",
 * i dlatego jest tu, obok implementacji, a nie tylko w komentarzu.
 *
 * Ekstremum sześcianu Béziera liczymy z pochodnej analitycznie: zera
 * dB/dt = 3(1-t)^2(p1-p0) + 6(1-t)t(p2-p1) + 3t^2(p3-p2) w przedziale (0,1).
 */
export function maxOvershoot(
  points: readonly Point[],
  strength: number = SMOOTHING_DEFAULT,
): number {
  let worst = 0;
  for (const seg of curveSegments(points, strength)) {
    const [p0, p1, p2, p3] = [seg.from[1], seg.c1[1], seg.c2[1], seg.to[1]];
    const lo = Math.min(p0, p3);
    const hi = Math.max(p0, p3);
    const candidates = [0, 1, ...cubicExtremaParams(p0, p1, p2, p3)];
    for (const t of candidates) {
      if (t < 0 || t > 1) continue;
      const u = 1 - t;
      const y = u * u * u * p0 + 3 * u * u * t * p1 + 3 * u * t * t * p2 + t * t * t * p3;
      worst = Math.max(worst, lo - y, y - hi);
    }
  }
  return Math.max(0, worst);
}

/** Parametry t, w których pochodna sześcianu Béziera się zeruje. */
function cubicExtremaParams(p0: number, p1: number, p2: number, p3: number): number[] {
  const a = 3 * (-p0 + 3 * p1 - 3 * p2 + p3);
  const b = 6 * (p0 - 2 * p1 + p2);
  const c = 3 * (p1 - p0);
  if (Math.abs(a) < 1e-12) {
    if (Math.abs(b) < 1e-12) return [];
    return [-c / b];
  }
  const disc = b * b - 4 * a * c;
  if (disc < 0) return [];
  const root = Math.sqrt(disc);
  return [(-b + root) / (2 * a), (-b - root) / (2 * a)];
}
