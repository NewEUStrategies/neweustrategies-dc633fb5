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

/** Wersjonowana maska kropek lądu (scripts/generate-dotted-world.ts). */
export const WORLD_DOTS_URL = "/geo/world-dots.v1.svg";

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
  /** Zdjęcie profilowe eksperta - etykieta staje się wtedy kartą osoby. */
  avatar?: string;
  /** Rola / stanowisko pod nazwiskiem (drugi wiersz etykiety). */
  role?: string;
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

/** Wzniesienie łuku pierwowzoru - stała, do której sprowadza się `arcLift`. */
export const ARC_LIFT_MAX = 50;
const ARC_LIFT_MIN = 16;
const ARC_LIFT_RATIO = 0.3;

/**
 * Wzniesienie wierzchołka łuku ponad wyższy koniec.
 *
 * Pierwowzór ma tu STAŁE 50 px, bo jego demo łączy kontynenty - przy cięciwie
 * ~400 px daje to zgrabny łuk. Ta sama stała na trasie Bruksela - Berlin
 * (cięciwa ~20 px) robi z połączenia pionową pętlę wyższą niż odległość między
 * miastami: rysunek przestaje czytać się jako trasa. Wzniesienie proporcjonalne
 * do cięciwy, z sufitem dokładnie na wartości pierwowzoru, zachowuje jego
 * wygląd tam, gdzie pierwowzór był projektowany, i naprawia bliskie pary.
 */
export function arcLift(start: Point2D, end: Point2D): number {
  const chord = Math.hypot(end.x - start.x, end.y - start.y);
  return Math.min(ARC_LIFT_MAX, Math.max(ARC_LIFT_MIN, chord * ARC_LIFT_RATIO));
}

/**
 * Łuk między dwoma punktami: kwadratowa krzywa Béziera z wierzchołkiem
 * uniesionym ponad wyższy z końców - `createCurvedPath` z pierwowzoru,
 * z wzniesieniem wyliczanym przez `arcLift` (domyślnie stała pierwowzoru).
 * Współrzędne przycinamy do jednego miejsca po przecinku, żeby SSR i klient
 * wygenerowały identyczny atrybut `d` (inaczej React odrzuca uwodnione drzewo
 * przy różnicach zaokrąglenia zmiennoprzecinkowego).
 */
export function createCurvedPath(start: Point2D, end: Point2D, lift = ARC_LIFT_MAX): string {
  const midX = (start.x + end.x) / 2;
  const midY = Math.min(start.y, end.y) - lift;
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
  //
  // `animation-timing-function` w klatce `start` dotyczy ODCINKA start->end,
  // więc samo rysowanie jest wyprowadzone krzywą (zwalnia przy dobiciu do celu),
  // a nie liniowe. Cała animacja musi zostać `linear`, bo jej klatki to
  // harmonogram - to jedyne miejsce, w którym wolno wpuścić „miękkość".
  // Znikanie na `reset` dostaje wygaszenie, żeby łuk nie ucinał się skokiem.
  return (
    `@keyframes ${name}{` +
    `0%{stroke-dashoffset:1;opacity:1}` +
    `${start}%{stroke-dashoffset:1;opacity:1;animation-timing-function:cubic-bezier(0.33,0.9,0.35,1)}` +
    `${end}%{stroke-dashoffset:0;opacity:1}` +
    `${reset}%{stroke-dashoffset:0;opacity:1}` +
    `100%{stroke-dashoffset:0;opacity:0}}`
  );
}

/** Długość biegnącej iskry jako ułamek trasy (`pathLength="1"`). */
const SPARK_LEN = 0.06;

/**
 * Reguła `@keyframes` dla „iskry" biegnącej wzdłuż trasy.
 *
 * Sam narysowany łuk jest statyczny - to linia, a nie połączenie. Krótki
 * jaskrawy odcinek przebiegający od startu do końca w tym samym oknie czasu, co
 * rysowanie, nadaje trasie KIERUNEK i jest tym, co czyta się jako „ruch".
 * Technicznie to ta sama sztuczka co rysowanie: `stroke-dasharray` z krótką
 * kreską i długą przerwą, przesuwana przez `stroke-dashoffset`.
 *
 * Poza swoim oknem iskra jest wygaszona (`opacity: 0`), więc nie zostawia
 * kropki wiszącej na końcu trasy podczas pauzy.
 */
export function sparkKeyframes(name: string, i: number, timing: ArcTiming, loop: boolean): string {
  const dash = SPARK_LEN.toFixed(3);
  const run = `stroke-dasharray:${dash} ${(1 - SPARK_LEN).toFixed(3)}`;
  if (!loop) {
    return (
      `@keyframes ${name}{` +
      `0%{${run};stroke-dashoffset:${dash};opacity:0}` +
      `8%{opacity:1}` +
      `92%{opacity:1}` +
      `100%{${run};stroke-dashoffset:-1;opacity:0}}`
    );
  }
  const start = timing.startPct(i);
  const end = timing.endPct(i);
  const fadeIn = Math.min(end, start + (end - start) * 0.12).toFixed(3);
  const fadeOut = Math.max(start, end - (end - start) * 0.12).toFixed(3);
  return (
    `@keyframes ${name}{` +
    `0%{${run};stroke-dashoffset:${dash};opacity:0}` +
    `${start.toFixed(3)}%{${run};stroke-dashoffset:${dash};opacity:0}` +
    `${fadeIn}%{opacity:1}` +
    `${fadeOut}%{opacity:1}` +
    `${end.toFixed(3)}%{${run};stroke-dashoffset:-1;opacity:0}` +
    `100%{${run};stroke-dashoffset:-1;opacity:0}}`
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
      path: createCurvedPath(startPoint, endPoint, arcLift(startPoint, endPoint)),
    };
  });
}

/** Znacznik do narysowania: jedno miejsce na mapie, nie jeden koniec łuku. */
export interface ResolvedMarker {
  key: string;
  point: MapPoint;
  xy: Point2D;
  /** Numer wiersza etykiety (0 = tuż nad kropką) - patrz `assignLabelRows`. */
  labelRow: number;
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
  view: ViewBox = WORLD_VIEW_BOX,
): ResolvedMarker[] {
  const byPlace = new Map<string, ResolvedMarker>();
  const push = (point: MapPoint, xy: Point2D) => {
    const key = `${xy.x.toFixed(1)},${xy.y.toFixed(1)}`;
    const existing = byPlace.get(key);
    if (!existing) {
      byPlace.set(key, { key, point, xy, labelRow: 0 });
      return;
    }
    // Scalamy POLE PO POLU: pierwsze wystąpienie ustala pozycję, ale etykieta,
    // odsyłacz czy dane profilu dopisane przy późniejszym łuku nie mogą
    // przepaść tylko dlatego, że wcześniejszy koniec miał je puste.
    byPlace.set(key, {
      ...existing,
      point: {
        ...existing.point,
        label: existing.point.label || point.label,
        href: existing.point.href || point.href,
        avatar: existing.point.avatar || point.avatar,
        role: existing.point.role || point.role,
      },
    });
  };
  for (const arc of arcs) {
    push(arc.start, arc.startPoint);
    push(arc.end, arc.endPoint);
  }
  return assignLabelRows(Array.from(byPlace.values()), view);
}

/** Ile wierszy wolno wykorzystać, zanim etykiety zaczną się powtarzać. */
const LABEL_ROW_COUNT = 3;
/**
 * Założona szerokość widgetu w pikselach na potrzeby wykrywania kolizji.
 *
 * Etykiety są HTML-em o stałym rozmiarze w px, a kolizje rozstrzygamy w
 * jednostkach płótna - przelicznik wymaga JAKIEJŚ szerokości. Mierzenie DOM-u
 * odpada (SSR musi dać ten sam wynik co klient), więc bierzemy typową
 * szerokość kolumny treści. Błąd oszacowania przesuwa co najwyżej próg, przy
 * którym napisy zaczynają się rozjeżdżać na wiersze - nigdy nie psuje układu.
 */
const ASSUMED_WIDTH_PX = 1000;
/** Szerokość znaku etykiety w px (11 px, medium) - z zapasem na padding chipa. */
const LABEL_CHAR_PX = 6.4;
const LABEL_PAD_PX = 22;
/** Wysokość jednego wiersza etykiet w px - musi zgadzać się z CSS-em chipa. */
const LABEL_ROW_PX = 24;

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
 * Szerokość napisu szacujemy z długości tekstu (stała szerokość znaku plus
 * padding chipa), przeliczoną z pikseli na jednostki KADRU - to wystarcza do
 * rozstrzygania kolizji, a nie wymaga mierzenia tekstu w DOM-ie (którego przy
 * SSR i tak nie ma).
 */
export function assignLabelRows(
  markers: ReadonlyArray<ResolvedMarker>,
  view: ViewBox,
): ResolvedMarker[] {
  // Jednostki płótna na piksel ekranu - zależą od kadru, więc przy zbliżeniu
  // ten sam napis zajmuje mniej jednostek i rzadziej z czymkolwiek koliduje.
  const unitsPerPx = view.w / ASSUMED_WIDTH_PX;
  const halfWidth = (marker: ResolvedMarker) =>
    (((marker.point.label?.length ?? 0) * LABEL_CHAR_PX + LABEL_PAD_PX) * unitsPerPx) / 2;
  const rowGap = LABEL_ROW_PX * unitsPerPx;
  const order = [...markers].sort((a, b) => a.xy.x - b.xy.x || a.xy.y - b.xy.y);
  const rows: Array<Array<{ left: number; right: number; y: number }>> = Array.from(
    { length: LABEL_ROW_COUNT },
    () => [],
  );
  const rowOf = new Map<string, number>();

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
        (box) => left < box.right && right > box.left && Math.abs(box.y - marker.xy.y) < rowGap,
      );
      if (!collides) {
        row = candidate;
        break;
      }
      row = (candidate + 1) % LABEL_ROW_COUNT;
    }
    rows[row].push({ left, right, y: marker.xy.y });
    rowOf.set(marker.key, row);
  }

  return markers.map((marker) => ({
    ...marker,
    labelRow: rowOf.get(marker.key) ?? 0,
  }));
}

/** Kadr rysunku w układzie płótna 800x400 (atrybut `viewBox`). */
export interface ViewBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const WORLD_VIEW_BOX: ViewBox = { x: 0, y: 0, w: MAP_VIEW_W, h: MAP_VIEW_H };

/** Tryby kadrowania oferowane w panelu. */
export type MapFit = "auto" | "world" | "europe";

/** Ramka Europy (lon -26..46, lat 33..72) - stały kadr „nasz region". */
const EUROPE_BOUNDS = { west: -26, east: 46, south: 33, north: 72 };

/** Najciaśniejszy dopuszczalny kadr: poniżej kropki lądu robią się kulami. */
const MIN_VIEW_W = 150;
/**
 * Margines wokół punktów jako ułamek WIĘKSZEGO boku ich ramki.
 *
 * Wartość jest kompromisem między dwiema porażkami: za mało - etykiety
 * przycinają się o krawędź i mapa dusi się przy brzegach; za dużo - kadr rośnie
 * do całego świata i „dopasowanie" przestaje cokolwiek dopasowywać (przy 0,55
 * zestaw Bruksela - Waszyngton dawał kadr 676 z 800 jednostek, czyli praktycznie
 * świat). 0,22 zostawia powietrze na chipy i wzniesienie łuku, a nadal wyraźnie
 * przybliża.
 */
const AUTO_PAD_RATIO = 0.22;
/** Margines minimalny (jednostki płótna) - dla jednego punktu lub bardzo ciasnej grupy. */
const AUTO_PAD_MIN = 42;

function clampBox(box: ViewBox, aspect: number): ViewBox {
  // Kadr nie może wyjść poza świat: najpierw przycinamy rozmiar, potem
  // dosuwamy pozycję, żeby po przycięciu nadal trzymał zadaną proporcję.
  let w = Math.min(box.w, MAP_VIEW_W);
  let h = w / aspect;
  if (h > MAP_VIEW_H) {
    h = MAP_VIEW_H;
    w = h * aspect;
  }
  const x = Math.min(Math.max(box.x + (box.w - w) / 2, 0), MAP_VIEW_W - w);
  const y = Math.min(Math.max(box.y + (box.h - h) / 2, 0), MAP_VIEW_H - h);
  return { x, y, w, h };
}

/** Ramka punktów rozciągnięta do proporcji płótna widgetu. */
function toAspect(box: ViewBox, aspect: number): ViewBox {
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  const w = Math.max(box.w, box.h * aspect);
  const h = w / aspect;
  return { x: cx - w / 2, y: cy - h / 2, w, h };
}

/**
 * Kadr rysunku.
 *
 * `auto` to domyślny i najważniejszy tryb: mapa świata z czterema stolicami
 * Europy jest w 85% pustym oceanem, a treść siedzi w rogu jak przypadek.
 * Dopasowanie kadru do ramki punktów (z hojnym marginesem, żeby łuki i etykiety
 * miały powietrze) zamienia to w kompozycję: połączenia wypełniają płótno,
 * a widz od razu widzi region, o którym mowa.
 *
 * Funkcja jest czysta i deterministyczna - ten sam kadr na serwerze i kliencie,
 * więc SSR nie rozjeżdża się z hydratacją.
 */
export function fitViewBox(
  points: ReadonlyArray<Point2D>,
  fit: MapFit,
  aspect = MAP_VIEW_W / MAP_VIEW_H,
): ViewBox {
  if (fit === "world") return clampBox(WORLD_VIEW_BOX, aspect);
  if (fit === "europe") {
    // UWAGA na kolejność: kadr stały NIE zależy od punktów, więc skrót
    // „brak punktów -> cały świat" musi zostać pod tą gałęzią, inaczej pusta
    // mapa w trybie Europy pokazywałaby świat.
    const topLeft = projectPoint(EUROPE_BOUNDS.north, EUROPE_BOUNDS.west);
    const bottomRight = projectPoint(EUROPE_BOUNDS.south, EUROPE_BOUNDS.east);
    return clampBox(
      toAspect(
        {
          x: topLeft.x,
          y: topLeft.y,
          w: bottomRight.x - topLeft.x,
          h: bottomRight.y - topLeft.y,
        },
        aspect,
      ),
      aspect,
    );
  }
  if (points.length === 0) return clampBox(WORLD_VIEW_BOX, aspect);
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  // Łuk wznosi się ponad wyższy koniec - bez tego zapasu górna krzywa
  // wychodziłaby poza kadr.
  minY -= ARC_LIFT_MAX;
  const pad = Math.max(AUTO_PAD_MIN, Math.max(maxX - minX, maxY - minY) * AUTO_PAD_RATIO);
  const raw: ViewBox = {
    x: minX - pad,
    y: minY - pad,
    w: maxX - minX + pad * 2,
    h: maxY - minY + pad * 2,
  };
  const sized = toAspect(raw, aspect);
  if (sized.w < MIN_VIEW_W) {
    const cx = sized.x + sized.w / 2;
    const cy = sized.y + sized.h / 2;
    const w = MIN_VIEW_W;
    const h = w / aspect;
    return clampBox({ x: cx - w / 2, y: cy - h / 2, w, h }, aspect);
  }
  return clampBox(sized, aspect);
}

/**
 * Skala optyczna kadru: ile jednostek płótna przypada na „jednostkę projektu".
 *
 * Kadrowanie powiększa WSZYSTKO, więc bez tego współczynnika linia grubości 1
 * przy zbliżeniu na Europę robi się wstęgą, a kropka znacznika - plamą.
 * Mnożąc przez `k` promienie i grubości, trzymamy stałą wielkość NA EKRANIE
 * niezależnie od kadru.
 */
export function opticalScale(view: ViewBox): number {
  return view.h / MAP_VIEW_H;
}

/** Pozycja punktu w kadrze wyrażona w procentach - do warstwy HTML nad SVG. */
export function pointPercent(view: ViewBox, p: Point2D): { left: number; top: number } {
  return {
    left: ((p.x - view.x) / view.w) * 100,
    top: ((p.y - view.y) / view.h) * 100,
  };
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
