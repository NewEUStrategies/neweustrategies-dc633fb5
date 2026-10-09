// WYGLĄD SERII - kolor, kształt punktu, przerywanie linii i kreskowanie
// słupka, rozstrzygnięte RAZ dla serii i czytane przez rysunek, legendę
// i tooltip. Trzy powierzchnie muszą mówić o serii to samo; gdyby każda
// liczyła wygląd sama, legenda pokazywałaby inny kolor niż linia przy
// pierwszej zmianie reguły.
//
// DWIE PALETY.
//   * `focus` (domyślna, specyfikacja 2026-10): JEDNA seria w akcencie -
//     wyróżniona (`accentSeries`, domyślnie pierwsza) - a pozostałe
//     w odcieniach neutralnych.
//     Kolejność: akcent, łupek główny, łupek drugi, dodatni, „powyżej".
//     Wykres czyta się wtedy jak zdanie: „to jest wskaźnik, reszta jest tłem
//     porównania". Powyżej pięciu serii paleta ról się kończy i seria bierze
//     swój slot z palety kategorialnej.
//   * `categorical`: kolor z zapisanego slotu (27 odcieni). Dla wykresów,
//     w których wszystkie serie są równorzędne (struktura, kraje obok siebie).
//
// KOLOR NIGDY NIE JEST JEDYNYM NOŚNIKIEM. Serie różnią się też KSZTAŁTEM
// punktu (koło, romb, trójkąt, kwadrat), trzecia i dalsze linią przerywaną
// 6 4, a trzecia seria słupków ukośnym kreskowaniem.
//
// RANGA, NIE INDEKS. Wygląd serii wynika z jej RANGI (`seriesRank`): seria
// wyróżniona (`accentSeries`) ma rangę 0, pozostałe zachowują względną
// kolejność konfiguracji. Przy `accentSeries = 0` ranga jest indeksem, więc
// wykresy zapisane przed wprowadzeniem pola wyglądają tak samo. Ranga liczy
// się z pozycji w KONFIGURACJI, nie wśród serii widocznych - ukrycie serii
// w legendzie nie może przemalować pozostałych.
import { ROLE } from "./roles";

export const CHART_PALETTES = ["focus", "categorical"] as const;
export type ChartPalette = (typeof CHART_PALETTES)[number];

export function isChartPalette(raw: unknown): raw is ChartPalette {
  return typeof raw === "string" && (CHART_PALETTES as readonly string[]).includes(raw);
}

export const SERIES_MARKERS = ["circle", "diamond", "triangle", "square"] as const;
export type SeriesMarker = (typeof SERIES_MARKERS)[number];

/** Kolejność ról palety `focus` - kolor znacznika i kolor napisu. */
const FOCUS_ORDER: readonly { color: string; text: string }[] = [
  { color: ROLE.acc, text: ROLE.accText },
  { color: ROLE.sMain, text: ROLE.sMain },
  { color: ROLE.sAlt, text: ROLE.sAltText },
  { color: ROLE.pos, text: ROLE.posText },
  { color: ROLE.warn, text: ROLE.warn },
];

/** Ile serii obsługuje paleta ról, zanim seria sięgnie po slot. */
export const FOCUS_SERIES_MAX = FOCUS_ORDER.length;

/** Od której rangi seria idzie linią przerywaną (0 = wyróżniona). */
export const DASHED_FROM_INDEX = 2;
/** Która ranga słupków dostaje ukośne kreskowanie. */
export const HATCHED_INDEX = 2;

export interface SeriesPaint {
  /** Kolor linii, punktu i wypełnienia słupka (próg grafiki). */
  color: string;
  /** Kolor napisu identyfikującego serię (próg tekstu 4,5:1). */
  textColor: string;
  marker: SeriesMarker;
  /** Linia przerywana 6 4. */
  dashed: boolean;
  /** Ukośne kreskowanie wypełnienia słupka. */
  hatched: boolean;
  /** Seria główna - dostaje pełne (15%) wypełnienie pod linią. */
  primary: boolean;
}

/**
 * Ranga serii w wyglądzie: 0 dla serii wyróżnionej, pozostałe w kolejności
 * konfiguracji - seria przed wyróżnioną przesuwa się o jedno miejsce w dół
 * listy ról, seria za nią zostaje na swoim miejscu. Dzięki temu wybór akcentu
 * zmienia wygląd TYLKO dwóch grup serii (wyróżnionej i tych, które ją
 * poprzedzały), a nie przetasowuje całego wykresu.
 *
 * `accentSeries` musi być indeksem istniejącej serii - pilnuje tego parser
 * (`parseAccentSeries`). Wartość ujemna albo niecałkowita jest tu traktowana
 * jak 0, żeby config zbudowany w kodzie nie zgubił akcentu w ogóle.
 */
export function seriesRank(index: number, accentSeries: number): number {
  const accent = Number.isInteger(accentSeries) && accentSeries > 0 ? accentSeries : 0;
  if (index === accent) return 0;
  return index < accent ? index + 1 : index;
}

/**
 * Wygląd serii. `rank` to ranga z `seriesRank`, NIE surowy indeks serii -
 * kolor roli, kształt punktu, przerywanie, kreskowanie i `primary` idą za
 * rangą, więc seria wyróżniona dostaje akcent, koło i pełne pole pod linią
 * niezależnie od tego, na której pozycji stoi w arkuszu.
 */
export function seriesPaint(
  colorSlot: number,
  rank: number,
  palette: ChartPalette,
  patternedSlots: ReadonlySet<number> = new Set(),
): SeriesPaint {
  const role = palette === "focus" ? FOCUS_ORDER[rank] : undefined;
  // Slot poza zestawem bezpiecznym dla daltonizmu dostaje drugi nośnik tak
  // jak dotąd - ale tylko w palecie kategorialnej; w palecie ról kolejność
  // jest policzona tak, żeby sąsiednie serie rozchodziły się jasnością.
  const patterned = role === undefined && patternedSlots.has(colorSlot);
  return {
    color: role?.color ?? `var(--chart-${colorSlot})`,
    textColor: role?.text ?? `var(--chart-${colorSlot}t)`,
    marker: SERIES_MARKERS[rank % SERIES_MARKERS.length],
    dashed: rank >= DASHED_FROM_INDEX || patterned,
    hatched: rank === HATCHED_INDEX || patterned,
    primary: rank === 0,
  };
}

/** Kolor kategorii - wycinka tarczy albo pierścienia. */
export interface CategoryPaint {
  /** Wypełnienie (próg grafiki 3,0:1 na płycie). */
  color: string;
  /** Napis identyfikujący kategorię (próg tekstu 4,5:1). */
  textColor: string;
}

/**
 * Wygląd KATEGORII dla rodzajów, w których kolor należy do kategorii, a nie
 * do serii (tarcza, pierścień).
 *
 * PALETA `focus`: ranga 0 (wycinek wyróżniony) w akcencie, pozostałe
 * w STOPNIACH NEUTRALNYCH od łupka głównego do łupka drugiego, mieszanych
 * w OKLab (`color-mix(in oklab, ...)`). Stopnie, nie jeden kolor: wycinki tła
 * muszą się dać policzyć i wskazać w tabeli klucza, a odcień neutralny
 * zostawia akcent jedynym kolorem, który coś mówi. Oba końce stopni mają
 * w obu motywach co najmniej 3:1 na płycie, a mieszanie w OKLab dwóch
 * niemal neutralnych odcieni prowadzi luminancję monotonicznie między nimi,
 * więc każdy stopień pośredni też - bramka `seriesStyle.test.ts` liczy to
 * na wartościach z arkusza, a nie na tej obietnicy.
 *
 * Napis idzie tą samą drogą, tylko od łupka głównego do wariantu tekstowego
 * łupka drugiego - oba przechodzą próg 4,5:1.
 *
 * PALETA `categorical`: kolor zapisanego slotu kategorii, jak dotąd.
 */
export function categoryPaint(
  rank: number,
  count: number,
  palette: ChartPalette,
  colorSlot: number,
): CategoryPaint {
  if (palette !== "focus") {
    return { color: `var(--chart-${colorSlot})`, textColor: `var(--chart-${colorSlot}t)` };
  }
  if (rank <= 0) return { color: ROLE.acc, textColor: ROLE.accText };
  // Stopni neutralnych jest tyle, ile kategorii poza wyróżnioną.
  const steps = Math.max(1, count - 1);
  const t = steps === 1 ? 0 : Math.min(1, (rank - 1) / (steps - 1));
  const pct = Math.round(t * 100);
  if (pct === 0) return { color: ROLE.sMain, textColor: ROLE.sMain };
  if (pct === 100) return { color: ROLE.sAlt, textColor: ROLE.sAltText };
  return {
    color: `color-mix(in oklab, ${ROLE.sAlt} ${pct}%, ${ROLE.sMain})`,
    textColor: `color-mix(in oklab, ${ROLE.sAltText} ${pct}%, ${ROLE.sMain})`,
  };
}

/**
 * Ścieżka SVG znacznika punktu wokół (cx, cy). `r` to promień koła; pozostałe
 * kształty są przeskalowane do tej samej POWIERZCHNI optycznej, żeby żadna
 * seria nie wyglądała na ważniejszą tylko dlatego, że ma większy znacznik.
 */
export function markerPath(marker: SeriesMarker, cx: number, cy: number, r: number): string {
  const f = (n: number): string => n.toFixed(2);
  switch (marker) {
    case "circle":
      return `M${f(cx - r)} ${f(cy)}a${f(r)} ${f(r)} 0 1 0 ${f(2 * r)} 0a${f(r)} ${f(r)} 0 1 0 ${f(-2 * r)} 0Z`;
    case "diamond": {
      const s = r * 1.3;
      return `M${f(cx)} ${f(cy - s)}L${f(cx + s)} ${f(cy)}L${f(cx)} ${f(cy + s)}L${f(cx - s)} ${f(cy)}Z`;
    }
    case "triangle": {
      const s = r * 1.4;
      return `M${f(cx)} ${f(cy - s)}L${f(cx + s * 0.866)} ${f(cy + s / 2)}L${f(cx - s * 0.866)} ${f(cy + s / 2)}Z`;
    }
    case "square": {
      const h = r * 0.88;
      return `M${f(cx - h)} ${f(cy - h)}h${f(2 * h)}v${f(2 * h)}h${f(-2 * h)}Z`;
    }
  }
}
