// SKALA KOLORU MAPY-CHOROPLETY - model czysty, bez DOM i bez Reacta.
//
// Mapa odpowiada na jedno pytanie: jakim kolorem pomalować kraj o danej
// wartości. Do tej pory odpowiedź siedziała w komponencie jako jedna linijka
// (rampa ciągła z podłogą 15%), więc legenda, tooltip i rysunek liczyły ją
// osobno, a nowych schematów nie dało się dołożyć bez kopiowania wzoru.
// Tutaj stoi raz, a komponent mapy, legenda i tabela czytają ten sam wynik.
//
// DWA RODZAJE SKALI.
//   * CIĄGŁA (`classes = 0`) - dokładnie to, co mapa robiła dotąd: udział
//     końca maksymalnego 15% + 85% * położenie w domenie. Mapy opublikowane
//     przed wprowadzeniem klas nie mają klucza `classes`, parser daje im 0,
//     więc nie zmieniają ani jednego odcienia.
//   * KLASOWA (3..7) - kraje wpadają do przedziałów, a każdy przedział ma
//     JEDEN kolor. Klasy czyta się jak legendę z liczbami, a nie jak gradient,
//     z którego trzeba szacować wartość okiem.
//
// DOMENA TO WARTOŚCI NARYSOWANE. Komponent podaje wyłącznie wartości krajów
// obecnych w zasobie geometrii - wartość kraju, którego nie ma na mapie,
// rozciągałaby skalę o liczbę, której czytelnik nigdzie nie zobaczy.
//
// KOLORY TO WYRAŻENIA CSS NA TOKENACH (`var(--chart-map-...)`,
// `color-mix(in oklab, ...)`), nigdy hex - motyw ciemny i druk przełączają
// tokeny, a model o motywie nie wie nic. Progi kontrastu tych mieszanin
// liczy bramka palety (`MAP_RAMPS`, `colorMixOklab`).
//
// HEX JEST OSOBNĄ DROGĄ (`stopOf`): przeglądarka bez `color-mix()` i eksport
// SVG dla programów, które nie czytają ani tokenów, ani `color-mix()`,
// potrzebują liczby. `stopOf` oddaje parę kotwic z MAP_RAMPS dla wskazanego
// motywu i udział `t` - ten sam, zaokrąglony do procenta, który stoi
// w wyrażeniu CSS - więc `colorMixOklab(to, t * 100, from)` jest dokładnie
// kolorem, który `color-mix()` daje z tokenów.
import { MAP_RAMPS, type ChartThemeName, type MapRampAnchors } from "../palette";
import { MAP_CLASSES_MAX, MAP_CLASSES_MIN, type MapMethod, type MapScheme } from "../types";

export interface MapClass {
  /** Dolna krawędź przedziału (włącznie). */
  from: number;
  /** Górna krawędź (wyłącznie, poza ostatnią klasą, która ją obejmuje). */
  to: number;
  /** Wyrażenie CSS na tokenach. */
  color: string;
}

export interface MapScale {
  kind: "continuous" | "classed";
  /**
   * Klasy rosnąco. Przy skali ciągłej - przystanki gradientu legendy: dwa
   * (minimum i maksimum), a w schemacie rozbieżnym trzy, gdy punkt środkowy
   * leży wewnątrz domeny - gradient z dwóch przystanków pominąłby neutralny
   * środek, czyli jedyną rzecz, którą schemat rozbieżny mówi. Pusta lista =
   * brak wartości.
   */
  classes: MapClass[];
  colorOf(value: number): string;
  /** Numer klasy wartości; null przy skali ciągłej i przy braku klas. */
  classIndexOf(value: number): number | null;
  /** Najmniejsza i największa wartość narysowana; [0, 0] bez wartości. */
  domain: [number, number];
  /** Punkt środkowy schematu rozbieżnego (null = 0 w konfiguracji); null poza nim. */
  midpoint: number | null;
  /**
   * Kolor wartości jako para kotwic HEX i udział: kolor to
   * `color-mix(in oklab, to t*100%, from)`, czyli `colorMixOklab(to, t * 100,
   * from)`. Kotwice są z MAP_RAMPS dla motywu (domyślnie jasnego - druk
   * i eksport malują jasną płytą). Ten sam kolor co `colorOf` - z tym samym
   * zaokrągleniem udziału do procenta. null dla wartości nieskończonej
   * i dla skali bez wartości (nie ma czego malować).
   */
  stopOf(value: number, theme?: ChartThemeName): MapStop | null;
}

/** Kolor jako para kotwic hex i udział końca `to` (0..1, krok 0,01). */
export interface MapStop {
  from: string;
  to: string;
  t: number;
}

/**
 * Udział końca maksymalnego w NAJNIŻSZEJ wartości skali ciągłej. Kraj
 * z najmniejszą wartością nie dostaje samego końca minimalnego, bo ten stoi
 * blisko płyty - wyglądałby jak kraj pominięty. Liczba jest ta sama, co
 * w mapie sprzed modelu, i musi nią zostać, bo od niej zależy wygląd
 * opublikowanych map ciągłych.
 */
export const MAP_CONTINUOUS_FLOOR = 0.15;

/**
 * Kotwica rampy. W rampie sekwencyjnej `min`/`max` to jej końce, w rozbieżnej
 * `min` to pełny ujemny, `max` pełny dodatni, a `mid` środek - ta sama
 * umowa co w MAP_RAMPS, więc kotwica znaczy to samo w tokenie i w hexie.
 */
type Anchor = "min" | "mid" | "max";

/** Kolor jako przepis: mieszanina końca `to` z `from` w udziale `pct` procent. */
interface Mix {
  from: Anchor;
  to: Anchor;
  /** Liczba całkowita 0..100 - ta sama, która trafia do `color-mix()`. */
  pct: number;
}

function anchorToken(scheme: MapScheme, anchor: Anchor): string {
  if (scheme === "diverging") {
    if (anchor === "min") return "var(--chart-negative)";
    if (anchor === "max") return "var(--chart-positive)";
    return "var(--chart-map-div-mid)";
  }
  // Rampa sekwencyjna nie ma środka; `mid` nigdy tu nie przychodzi, ale
  // gdyby przyszedł, koniec minimalny jest jedynym bezpiecznym kolorem.
  return `var(--chart-map-${scheme}-${anchor === "max" ? "max" : "min"})`;
}

function anchorHex(scheme: MapScheme, anchor: Anchor, theme: ChartThemeName): string {
  const ramp: MapRampAnchors = MAP_RAMPS[scheme][theme];
  if (anchor === "mid") return ramp.mid ?? ramp.min;
  return ramp[anchor];
}

function cssOf(scheme: MapScheme, mix: Mix): string {
  if (mix.pct <= 0) return anchorToken(scheme, mix.from);
  if (mix.pct >= 100) return anchorToken(scheme, mix.to);
  return `color-mix(in oklab, ${anchorToken(scheme, mix.to)} ${mix.pct}%, ${anchorToken(scheme, mix.from)})`;
}

function stopFrom(scheme: MapScheme, mix: Mix, theme: ChartThemeName): MapStop {
  return {
    from: anchorHex(scheme, mix.from, theme),
    to: anchorHex(scheme, mix.to, theme),
    t: mix.pct / 100,
  };
}

/** Rampa sekwencyjna przy danym udziale końca maksymalnego (0..1). */
function sequentialMix(share: number): Mix {
  return { from: "min", to: "max", pct: Math.round(Math.max(0, Math.min(1, share)) * 100) };
}

/**
 * Schemat rozbieżny przy położeniu -1..1 względem punktu środkowego: -1 to
 * pełny ujemny, 0 neutralny środek, 1 pełny dodatni.
 */
function divergingMix(position: number): Mix {
  const t = Math.max(-1, Math.min(1, position));
  return { from: "mid", to: t < 0 ? "min" : "max", pct: Math.round(Math.abs(t) * 100) };
}

/**
 * Kwantyl z posortowanej tablicy - interpolacja liniowa między sąsiednimi
 * obserwacjami (typ 7 Hyndmana-Fana, ten sam co w d3 i w arkuszach), więc
 * granice klas są powtarzalne i nie zależą od tego, czy liczba krajów
 * dzieli się przez liczbę klas.
 */
function quantileSorted(sorted: readonly number[], p: number): number {
  const h = (sorted.length - 1) * p;
  const lo = Math.floor(h);
  const hi = Math.min(sorted.length - 1, lo + 1);
  return sorted[lo] + (h - lo) * (sorted[hi] - sorted[lo]);
}

/**
 * Granice WEWNĘTRZNE klas (bez krańców domeny), rosnąco, bez powtórzeń.
 * Granica równa minimum albo maksimum domeny tworzyłaby klasę pustą
 * z definicji, więc odpada - przy wielu równych wartościach kwantyle się
 * zlepiają i klas zostaje mniej, niż zamówiono. To jest prawda o danych,
 * a nie usterka: trzy kraje o tej samej wartości nie dadzą się rozdzielić
 * na trzy klasy.
 */
function innerBreaks(candidates: readonly number[], lo: number, hi: number): number[] {
  const out: number[] = [];
  for (const b of candidates) {
    if (!Number.isFinite(b) || b <= lo || b >= hi) continue;
    if (out.length > 0 && b <= out[out.length - 1]) continue;
    out.push(b);
  }
  return out;
}

/** Liczba klas po dociśnięciu; 0 = skala ciągła. */
function effectiveClasses(classes: number): number {
  if (!Number.isFinite(classes) || classes <= 0) return 0;
  return Math.max(MAP_CLASSES_MIN, Math.min(MAP_CLASSES_MAX, Math.round(classes)));
}

export function mapScale(
  values: readonly number[],
  scheme: MapScheme,
  classes: number,
  method: MapMethod,
  midpoint: number | null,
): MapScale {
  const finite = values.filter((v) => Number.isFinite(v));
  const sorted = [...finite].sort((a, b) => a - b);
  const empty = sorted.length === 0;
  const lo = empty ? 0 : sorted[0];
  const hi = empty ? 0 : sorted[sorted.length - 1];
  const span = hi - lo;
  const diverging = scheme === "diverging";
  const mid = diverging ? (midpoint ?? 0) : null;
  const k = effectiveClasses(classes);
  // Odchylenie od środka mierzone NAJDALSZĄ stroną: ta sama odległość od
  // środka ma ten sam kolor po obu stronach, inaczej strona z mniejszym
  // zasięgiem wyglądałaby na mocniejszą, niż jest.
  const reach = mid === null || empty ? 0 : Math.max(Math.abs(lo - mid), Math.abs(hi - mid));
  // Kolor klasowej skali dla wartości spoza klas (brak klas, wartość
  // nieskończona): środek rozbieżnej, koniec minimalny sekwencyjnej.
  const neutral: Mix = { from: diverging ? "mid" : "min", to: "max", pct: 0 };

  if (k === 0) {
    const mixOf = (value: number): Mix => {
      if (mid !== null) return divergingMix(reach > 0 ? (value - mid) / reach : 0);
      const t = span > 0 ? Math.max(0, Math.min(1, (value - lo) / span)) : 0;
      return sequentialMix(MAP_CONTINUOUS_FLOOR + (1 - MAP_CONTINUOUS_FLOOR) * t);
    };
    const colorOf = (value: number): string => cssOf(scheme, mixOf(value));
    const stops: MapClass[] = [];
    if (!empty) {
      stops.push({ from: lo, to: lo, color: colorOf(lo) });
      if (mid !== null && mid > lo && mid < hi) {
        stops.push({ from: mid, to: mid, color: cssOf(scheme, divergingMix(0)) });
      }
      stops.push({ from: hi, to: hi, color: colorOf(hi) });
    }
    return {
      kind: "continuous",
      classes: stops,
      colorOf,
      classIndexOf: () => null,
      domain: [lo, hi],
      midpoint: mid,
      stopOf: (value, theme = "light") =>
        empty || !Number.isFinite(value) ? null : stopFrom(scheme, mixOf(value), theme),
    };
  }

  // ---- Granice klas.
  let edgeLo = lo;
  let edgeHi = hi;
  let breaks: number[];
  if (empty) {
    breaks = [];
  } else if (method === "equal" && mid !== null) {
    // Równe przedziały w schemacie rozbieżnym są SYMETRYCZNE wokół środka:
    // środek musi być środkiem skali, inaczej kolor neutralny trafiałby
    // w przypadkowy przedział. Klasy po stronie bez danych zostają w legendzie,
    // bo usunięcie ich zmieniałoby znaczenie kolorów strony z danymi.
    edgeLo = mid - reach;
    edgeHi = mid + reach;
    const width = (edgeHi - edgeLo) / k;
    breaks = innerBreaks(
      Array.from({ length: k - 1 }, (_, i) => edgeLo + (i + 1) * width),
      edgeLo,
      edgeHi,
    );
  } else if (method === "equal") {
    breaks = innerBreaks(
      Array.from({ length: k - 1 }, (_, i) => lo + ((i + 1) * span) / k),
      lo,
      hi,
    );
  } else {
    breaks = innerBreaks(
      Array.from({ length: k - 1 }, (_, i) => quantileSorted(sorted, (i + 1) / k)),
      lo,
      hi,
    );
  }

  // Zdegenerowana domena (jedna wartość albo wszystkie równe) daje jedną
  // klasę o zerowej szerokości - nadal jest co pokazać w legendzie.
  const edges = empty ? [] : [edgeLo, ...breaks, edgeHi];
  const bounds: Array<{ from: number; to: number }> = [];
  for (let i = 0; i + 1 < edges.length; i += 1) bounds.push({ from: edges[i], to: edges[i + 1] });

  // ---- Kolory klas.
  let mixes: Mix[];
  if (mid !== null) {
    // Kolor wg ŚRODKA klasy względem punktu środkowego, znormalizowany
    // skrajną klasą - skrajna klasa po dalszej stronie dostaje pełny kolor
    // końca, klasa zawierająca środek (przy nieparzystej liczbie
    // symetrycznych klas) dostaje dokładnie kolor neutralny.
    const centres = bounds.map((b) => (b.from + b.to) / 2 - mid);
    const far = Math.max(0, ...centres.map((c) => Math.abs(c)));
    mixes = centres.map((c) => divergingMix(far > 0 ? c / far : 0));
  } else {
    // Jedna klasa dostaje koniec maksymalny: przy jednej wartości nie ma
    // czego stopniować, a blady koniec czytałby się jako „mało".
    const n = bounds.length;
    mixes = bounds.map((_, i) => sequentialMix(n === 1 ? 1 : i / (n - 1)));
  }
  const classList: MapClass[] = bounds.map((b, i) => ({ ...b, color: cssOf(scheme, mixes[i]) }));

  const classIndexOf = (value: number): number | null => {
    if (classList.length === 0 || !Number.isFinite(value)) return null;
    // Wartość równa granicy należy do klasy WYŻSZEJ - granica jest dolną
    // krawędzią przedziału, tak jak w podpisie legendy „od X".
    let index = 0;
    while (index < breaks.length && value >= breaks[index]) index += 1;
    return Math.min(index, classList.length - 1);
  };

  return {
    kind: "classed",
    classes: classList,
    colorOf: (value: number) => {
      const index = classIndexOf(value);
      return index === null ? cssOf(scheme, neutral) : classList[index].color;
    },
    classIndexOf,
    domain: [lo, hi],
    midpoint: mid,
    stopOf: (value, theme = "light") => {
      const index = classIndexOf(value);
      return index === null ? null : stopFrom(scheme, mixes[index], theme);
    },
  };
}
