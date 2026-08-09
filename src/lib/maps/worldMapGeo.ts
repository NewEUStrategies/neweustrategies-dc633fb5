// Czysta geometria i harmonogram animacji widgetu „Mapa świata".
//
// Moduł jest bezstanowy i wolny od Reacta / DOM-u, więc obie strony (renderer
// publiczny i panel buildera) liczą DOKŁADNIE to samo, a testy jednostkowe
// sprawdzają rzutowanie i klatki kluczowe bez montowania komponentu.
//
// Wierność pierwowzorowi: `projectPoint`, `createCurvedPath` i cały rachunek
// czasu (stagger 0.3 s, pauza 2 s, `startTime` / `endTime` / `resetTime`
// dzielone przez pełny cykl) są przeniesione 1:1 z komponentu źródłowego.
// Zmieniło się tylko wykonanie: framer-motion nie istnieje w tym repozytorium,
// więc te same ułamki cyklu stają się PROCENTAMI klatek kluczowych CSS.

/** Płótno rzutowania - ten sam układ, w którym wygenerowana jest warstwa kropek. */
export const MAP_VIEW_W = 800;
export const MAP_VIEW_H = 400;

/** Odstęp startów kolejnych łuków (sekundy) - jak `staggerDelay` w pierwowzorze. */
export const ARC_STAGGER_S = 0.3;
/** Pauza po dorysowaniu wszystkich łuków, zanim pętla wystartuje od nowa. */
export const ARC_PAUSE_S = 2;

export interface MapPoint {
  lat: number;
  lng: number;
  label?: string;
  /** Odsyłacz punktu (np. publiczny profil eksperta) - rozszerzenie platformowe. */
  href?: string;
}

export interface MapArc {
  start: MapPoint;
  end: MapPoint;
}

export interface Point2D {
  x: number;
  y: number;
}

/** Rzut równoodległościowy lon/lat -> px płótna 800x400 (1:1 z pierwowzorem). */
export function projectPoint(lat: number, lng: number): Point2D {
  return {
    x: ((lng + 180) * MAP_VIEW_W) / 360,
    y: ((90 - lat) * MAP_VIEW_H) / 180,
  };
}

/**
 * Łuk między dwoma punktami: kwadratowa krzywa Béziera z wierzchołkiem
 * uniesionym 50 px ponad wyższy z końców - dokładnie `createCurvedPath`
 * z pierwowzoru. Współrzędne przycinamy do jednego miejsca po przecinku, żeby
 * SSR i klient wygenerowały identyczny atrybut `d` (inaczej React odrzuca
 * uwodnione drzewo przy różnicach zaokrąglenia zmiennoprzecinkowego).
 */
export function createCurvedPath(start: Point2D, end: Point2D): string {
  const midX = (start.x + end.x) / 2;
  const midY = Math.min(start.y, end.y) - 50;
  const n = (v: number) => v.toFixed(1);
  return `M ${n(start.x)} ${n(start.y)} Q ${n(midX)} ${n(midY)} ${n(end.x)} ${n(end.y)}`;
}

export interface ArcTiming {
  /** Pełny cykl pętli w sekundach (rysowanie wszystkich łuków + pauza). */
  cycleS: number;
  /** Czas, po którym ostatni łuk jest dorysowany (bez pauzy). */
  drawS: number;
  /** Procent cyklu, w którym łuk `i` zaczyna się rysować. */
  startPct: (i: number) => number;
  /** Procent cyklu, w którym łuk `i` jest gotowy. */
  endPct: (i: number) => number;
  /** Procent cyklu, w którym wszystkie łuki znikają przed kolejnym obrotem. */
  resetPct: number;
}

/**
 * Harmonogram rysowania łuków.
 *
 * Pierwowzór liczy dla każdej ścieżki `startTime`, `endTime` i wspólny
 * `resetTime` jako UŁAMKI pełnego cyklu i podaje je framer-motion jako `times`.
 * Tu te same ułamki wyrażamy w procentach - jedna reguła `@keyframes` na łuk,
 * zero JS w pętli animacji.
 */
export function arcTiming(count: number, durationS: number): ArcTiming {
  const duration = Math.max(0.1, durationS);
  const drawS = count * ARC_STAGGER_S + duration;
  const cycleS = drawS + ARC_PAUSE_S;
  const pct = (seconds: number) => Math.min(100, Math.max(0, (seconds / cycleS) * 100));
  return {
    cycleS,
    drawS,
    startPct: (i) => pct(i * ARC_STAGGER_S),
    endPct: (i) => pct(i * ARC_STAGGER_S + duration),
    resetPct: pct(drawS),
  };
}

/**
 * Reguła `@keyframes` rysująca jeden łuk w pętli.
 *
 * `pathLength="1"` na elemencie `<path>` normalizuje długość ścieżki, więc
 * `stroke-dasharray: 1` + `stroke-dashoffset` od 1 do 0 daje ten sam efekt, co
 * `pathLength: 0 -> 1` w framer-motion, bez mierzenia ścieżki w JS.
 */
export function arcKeyframes(name: string, i: number, timing: ArcTiming, loop: boolean): string {
  const start = timing.startPct(i).toFixed(3);
  const end = timing.endPct(i).toFixed(3);
  if (!loop) {
    return `@keyframes ${name}{from{stroke-dashoffset:1}to{stroke-dashoffset:0}}`;
  }
  const reset = timing.resetPct.toFixed(3);
  // Łuk czeka (offset 1), rysuje się między `start` a `end`, stoi gotowy przez
  // pauzę, a na `reset` wraca do stanu początkowego - tak samo jak keyframe
  // `resetTime` w pierwowzorze.
  return (
    `@keyframes ${name}{` +
    `0%{stroke-dashoffset:1}` +
    `${start}%{stroke-dashoffset:1}` +
    `${end}%{stroke-dashoffset:0}` +
    `${reset}%{stroke-dashoffset:0}` +
    `100%{stroke-dashoffset:1}}`
  );
}

/** Znormalizowany, gotowy do rysowania łuk (punkty już zrzutowane). */
export interface ResolvedArc {
  key: string;
  start: MapPoint;
  end: MapPoint;
  startPoint: Point2D;
  endPoint: Point2D;
  path: string;
}

export function resolveArcs(arcs: ReadonlyArray<MapArc>): ResolvedArc[] {
  return arcs.map((arc, i) => {
    const startPoint = projectPoint(arc.start.lat, arc.start.lng);
    const endPoint = projectPoint(arc.end.lat, arc.end.lng);
    return {
      key: `${i}-${arc.start.lat},${arc.start.lng}-${arc.end.lat},${arc.end.lng}`,
      start: arc.start,
      end: arc.end,
      startPoint,
      endPoint,
      path: createCurvedPath(startPoint, endPoint),
    };
  });
}

/** Znacznik do narysowania: jedno miejsce na mapie, nie jeden koniec łuku. */
export interface ResolvedMarker {
  key: string;
  point: MapPoint;
  xy: Point2D;
  /** Przesunięcie etykiety w pionie (jednostki płótna) - patrz `assignLabelRows`. */
  labelDy: number;
}

/**
 * Unikalne punkty ze wszystkich łuków.
 *
 * Układ „centrala -> świat" powtarza ten sam początek w każdym połączeniu, więc
 * rysowanie znacznika per koniec łuku układało N identycznych kropek i N
 * identycznych etykiet jedna na drugiej (widoczne jako pogrubiony, nieczytelny
 * napis). Klucz to zaokrąglona pozycja NA PŁÓTNIE, a nie surowe lat/lng: dwa
 * punkty odległe o setne stopnia i tak trafiają w ten sam piksel.
 *
 * Pierwszy punkt w danym miejscu wygrywa etykietą, ale jeśli jest bez etykiety,
 * a późniejszy ją ma - bierzemy tę drugą (nie gubimy nazwy przez kolejność).
 */
export function resolveMarkers(
  arcs: ReadonlyArray<ResolvedArc>,
  labelSize = DEFAULT_LABEL_SIZE,
): ResolvedMarker[] {
  const byPlace = new Map<string, ResolvedMarker>();
  const push = (point: MapPoint, xy: Point2D) => {
    const key = `${xy.x.toFixed(1)},${xy.y.toFixed(1)}`;
    const existing = byPlace.get(key);
    if (!existing) {
      byPlace.set(key, { key, point, xy, labelDy: LABEL_ROW_BASE });
      return;
    }
    // Scalamy POLE PO POLU: pierwsze wystąpienie ustala pozycję, ale etykieta
    // czy odsyłacz dopisane przy późniejszym łuku nie mogą przepaść tylko
    // dlatego, że wcześniejszy koniec miał je puste.
    byPlace.set(key, {
      ...existing,
      point: {
        ...existing.point,
        label: existing.point.label || point.label,
        href: existing.point.href || point.href,
      },
    });
  };
  for (const arc of arcs) {
    push(arc.start, arc.startPoint);
    push(arc.end, arc.endPoint);
  }
  return assignLabelRows(Array.from(byPlace.values()), labelSize);
}

/** Domyślny rozmiar etykiety w jednostkach płótna (zgodny z domyślną treścią). */
const DEFAULT_LABEL_SIZE = 10;
/** Pierwszy „wiersz" etykiet: tuż nad kropką. */
const LABEL_ROW_BASE = -8;
/** Odstęp między wierszami etykiet. */
const LABEL_ROW_STEP = -11;
/** Ile wierszy wolno wykorzystać, zanim etykiety zaczną się powtarzać. */
const LABEL_ROW_COUNT = 3;

/**
 * Rozkłada etykiety na kilka wierszy, żeby sąsiadujące miasta się nie zlepiały.
 *
 * Układ „Bruksela - Berlin - Warszawa - Kijów" mieści się w ~26° długości, więc
 * na płótnie 800x400 cztery napisy lądują na tym samym pasie i tworzą nieczytelną
 * plamę. Algorytm jest ZACHOWAWCZY i deterministyczny (ten sam wynik na serwerze
 * i w przeglądarce): idzie od lewej i sadza etykietę w pierwszym wierszu, w
 * którym nie zachodzi na już postawioną; gdy wszystkie wiersze są zajęte, wraca
 * do pierwszego (lepiej powtórzyć wiersz niż odsunąć napis od jego kropki).
 *
 * Szerokość napisu szacujemy z długości tekstu (0,5 szerokości znaku na
 * rozmiar) - to wystarcza do rozstrzygania kolizji, a nie wymaga mierzenia
 * tekstu w DOM-ie (którego przy SSR i tak nie ma).
 */
export function assignLabelRows(
  markers: ReadonlyArray<ResolvedMarker>,
  labelSize: number,
): ResolvedMarker[] {
  const halfWidth = (marker: ResolvedMarker) =>
    ((marker.point.label?.length ?? 0) * labelSize * 0.5) / 2;
  const order = [...markers].sort((a, b) => a.xy.x - b.xy.x || a.xy.y - b.xy.y);
  const rows: Array<Array<{ left: number; right: number; y: number }>> = Array.from(
    { length: LABEL_ROW_COUNT },
    () => [],
  );
  const dyOf = new Map<string, number>();

  for (const marker of order) {
    if (!marker.point.label) continue;
    const half = halfWidth(marker);
    const left = marker.xy.x - half;
    const right = marker.xy.x + half;
    let row = 0;
    for (let candidate = 0; candidate < LABEL_ROW_COUNT; candidate++) {
      const collides = rows[candidate].some(
        // Kolizja tylko w tym samym pasie pionowym - napisy oddalone o pół
        // płótna w pionie nie mają jak na siebie wejść.
        (box) => left < box.right && right > box.left && Math.abs(box.y - marker.xy.y) < 24,
      );
      if (!collides) {
        row = candidate;
        break;
      }
      row = (candidate + 1) % LABEL_ROW_COUNT;
    }
    rows[row].push({ left, right, y: marker.xy.y });
    dyOf.set(marker.key, LABEL_ROW_BASE + row * LABEL_ROW_STEP);
  }

  return markers.map((marker) => ({
    ...marker,
    labelDy: dyOf.get(marker.key) ?? LABEL_ROW_BASE,
  }));
}

/** Współrzędna geograficzna po walidacji; poza zakresem -> `null`. */
export function coerceLat(value: unknown): number | null {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) && n >= -90 && n <= 90 ? n : null;
}

export function coerceLng(value: unknown): number | null {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) && n >= -180 && n <= 180 ? n : null;
}
