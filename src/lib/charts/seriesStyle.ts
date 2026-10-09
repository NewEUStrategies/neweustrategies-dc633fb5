// WYGLĄD SERII - kolor, kształt punktu, przerywanie linii i kreskowanie
// słupka, rozstrzygnięte RAZ dla serii i czytane przez rysunek, legendę
// i tooltip. Trzy powierzchnie muszą mówić o serii to samo; gdyby każda
// liczyła wygląd sama, legenda pokazywałaby inny kolor niż linia przy
// pierwszej zmianie reguły.
//
// DWIE PALETY.
//   * `focus` (domyślna, specyfikacja 2026-10): JEDNA seria w akcencie -
//     najważniejsza, pierwsza - a pozostałe w odcieniach neutralnych.
//     Kolejność: akcent, łupek główny, łupek drugi, dodatni, „powyżej".
//     Wykres czyta się wtedy jak zdanie: „to jest wskaźnik, reszta jest tłem
//     porównania". Powyżej pięciu serii paleta ról się kończy i seria bierze
//     swój slot z palety kategorialnej.
//   * `categorical`: kolor z zapisanego slotu (27 odcieni). Dla wykresów,
//     w których wszystkie serie są równorzędne (struktura, kraje obok siebie).
//
// KOLOR NIGDY NIE JEST JEDYNYM NOŚNIKIEM. Serie różnią się też KSZTAŁTEM
// punktu (koło, romb, trójkąt, kwadrat), trzecia i dalsze linią przerywaną
// 6 4, a trzecia seria słupków ukośnym kreskowaniem. Indeks serii jest jej
// pozycją w KONFIGURACJI, nie wśród serii widocznych - ukrycie serii w legendzie
// nie może przemalować pozostałych.
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

/** Od której pozycji seria idzie linią przerywaną (0 = pierwsza). */
export const DASHED_FROM_INDEX = 2;
/** Która pozycja słupków dostaje ukośne kreskowanie. */
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

export function seriesPaint(
  colorSlot: number,
  index: number,
  palette: ChartPalette,
  patternedSlots: ReadonlySet<number> = new Set(),
): SeriesPaint {
  const role = palette === "focus" ? FOCUS_ORDER[index] : undefined;
  // Slot poza zestawem bezpiecznym dla daltonizmu dostaje drugi nośnik tak
  // jak dotąd - ale tylko w palecie kategorialnej; w palecie ról kolejność
  // jest policzona tak, żeby sąsiednie serie rozchodziły się jasnością.
  const patterned = role === undefined && patternedSlots.has(colorSlot);
  return {
    color: role?.color ?? `var(--chart-${colorSlot})`,
    textColor: role?.text ?? `var(--chart-${colorSlot}t)`,
    marker: SERIES_MARKERS[index % SERIES_MARKERS.length],
    dashed: index >= DASHED_FROM_INDEX || patterned,
    hatched: index === HATCHED_INDEX || patterned,
    primary: index === 0,
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
