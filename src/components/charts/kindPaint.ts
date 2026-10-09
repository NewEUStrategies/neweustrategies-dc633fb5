// FARBA RODZAJU - jedno rozstrzygnięcie koloru dla rysunków spoza
// `CartesianChart` (rozkłady, chmura, wachlarz, indeks, stos 100%, panele).
//
// PO CO. Paleta ról `focus` (akcent + neutralne) jest domyślna dla KAŻDEGO
// rodzaju, ale rysunki spoza silnika kartezjańskiego malowały się dotąd
// slotem (`var(--chart-N)`) i jego odmianami z arkusza (`-inner`, `-edge`,
// `-hover`). Rola palety ról NIE MA takich odmian - i nie dostanie nowych
// tokenów (kontrakt PR2), bo każdy token to trzy wartości (jasny, ciemny,
// druk) i bramka. Odmiany są więc wyprowadzane z koloru roli STAŁYMI
// mieszankami w OKLab:
//   * wnętrze = 18% koloru na płycie,
//   * obwódka = sam kolor,
//   * wskazanie = 85% koloru na płycie,
//   * pasmo = 12% koloru na przezroczystym.
// Ta sama arytmetyka w obu motywach - zmienia się wyłącznie wartość tokenów,
// geometria i proporcje zostają.
//
// Paleta kategorialna i role powyżej pięciu serii zostają przy SLOCIE i jego
// odmianach z arkusza: są dobrane per slot (obwódka dociągnięta do progu
// 3:1), więc mieszanka byłaby tu krokiem wstecz.
//
// DRUGI NOŚNIK AKCENTU. Akcent (#FA9346) ma na bieli 2,25:1, więc kształt
// WYPEŁNIONY akcentem dostaje obwódkę 1 px w `--chart-accent-audit-graphic`
// (3,56:1 na płycie) - granica kształtu przechodzi wtedy próg grafiki,
// choć samo wypełnienie go nie przechodzi. Grubość jest jedna dla obu
// motywów; w ciemnym token ma wartość akcentu, więc obwódka zlewa się
// z wypełnieniem, a geometria zostaje ta sama.
import type { ChartConfig } from "@/lib/charts/types";
import { BAR_EDGE_INSET } from "@/lib/charts/geometry";
import { ROLE } from "@/lib/charts/roles";
import { seriesPaint, seriesRank, type SeriesPaint } from "@/lib/charts/seriesStyle";

/** Stałe mieszanki odmian koloru roli, w procentach koloru. */
export const FOCUS_MIX = { inner: 18, hover: 85, band: 12 } as const;

/** Grubość obwódki drugiego nośnika akcentu, w px - ta sama w obu motywach. */
export const ACCENT_EDGE_PX = 1;

/**
 * Grubość KRAWĘDZI ODCZYTU (wąs i poprzeczka pudełka, kreska końca bliższego
 * w tornado, obwódka słupka w wariancie bladym), w px - JEDNA w obu motywach.
 *
 * Token `--chart-bar-edge` ma w motywach różne wartości (1,5 px jasny,
 * 1,25 px ciemny - korekta irradiacji), czyli przełączenie motywu
 * przesuwało krawędzie rysunku, a w motywie mają się zmieniać wyłącznie
 * kolory (AGENTS.md). Wartość to dwa wsunięcia kształtu (`BAR_EDGE_INSET`),
 * więc obwódka i wsunięcie słupka nadal się znoszą. Arkusz ma tę samą liczbę
 * w regule `.neh-bar[data-edged="true"]` - pilnuje tego bramka
 * `themeInvariantGeometry.test.ts`.
 */
export const EDGE_STROKE_PX = 2 * BAR_EDGE_INSET;

/**
 * Tusz NA PEŁNYM WYPEŁNIENIU AKCENTEM (kreska albo liczba na akcencie).
 *
 * Kolor płyty ma na akcencie 2,25:1 (biel), a tusz główny w ciemnym motywie
 * jest jasny - żaden z nich nie przechodzi progu linii 3:1 w obu motywach.
 * Akcent jest ochrą marki ze slotu 2 (`--chart-2` ma tę samą wartość co
 * `--chart-accent` w jasnym, ciemnym i druku), więc jego tusz to tusz slotu 2
 * dobrany do nasyconego wypełnienia: ~8:1 na akcencie w każdym motywie.
 * Równość obu tokenów pilnuje bramka `accentSecondCarrier.test.tsx`.
 */
export const ACCENT_INK = "var(--chart-ink-2)";

export interface PaintVariants {
  /** Kolor znacznika - wypełnienie pełne, linia, punkt (próg grafiki). */
  color: string;
  /** Kolor napisu identyfikującego serię (próg tekstu). */
  textColor: string;
  /** Blade wnętrze. */
  inner: string;
  /** Obwódka. */
  edge: string;
  /** Wypełnienie pod wskazaniem. */
  hover: string;
  /** Krycie pasma (mnożnik `fill-opacity`) - wyrażenie CSS. */
  bandOpacity: string;
  /** Obwódka drugiego nośnika akcentu; `null`, gdy kolor nie jest akcentem. */
  accentEdge: string | null;
}

/** Mieszanka OKLab koloru z drugim kolorem - zapis jak w arkuszu. */
function mix(color: string, pct: number, other: string): string {
  return `color-mix(in oklab, ${color} ${pct}%, ${other})`;
}

/**
 * Odmiany koloru. Kolor równy tokenowi slotu (`var(--chart-N)`) bierze
 * odmiany slotu z arkusza; każdy inny (rola palety `focus`) - stałe
 * mieszanki. Rozstrzygnięcie po NAPISIE koloru, a nie po palecie, bo paleta
 * ról sama oddaje slot powyżej pięciu serii (`seriesPaint`).
 */
export function paintVariants(color: string, textColor: string, colorSlot: number): PaintVariants {
  if (color === `var(--chart-${colorSlot})`) {
    return {
      color,
      textColor,
      inner: `var(--chart-${colorSlot}-inner)`,
      edge: `var(--chart-${colorSlot}-edge)`,
      hover: `var(--chart-${colorSlot}-active, var(--chart-${colorSlot}-hover))`,
      bandOpacity: `var(--chart-band-${colorSlot})`,
      accentEdge: null,
    };
  }
  return {
    color,
    textColor,
    inner: mix(color, FOCUS_MIX.inner, "var(--card)"),
    edge: color,
    hover: mix(color, FOCUS_MIX.hover, "var(--card)"),
    bandOpacity: (FOCUS_MIX.band / 100).toFixed(2),
    accentEdge: color === ROLE.acc ? ROLE.accFocus : null,
  };
}

export type KindPaint = SeriesPaint & PaintVariants;

/**
 * Farba serii o pozycji `index` w KONFIGURACJI - ranga z `accentSeries`, ta
 * sama droga co w `CartesianChart`, więc ta sama seria ma ten sam kolor na
 * każdym rodzaju wykresu we wpisie.
 */
export function kindSeriesPaint(
  config: Pick<ChartConfig, "palette" | "accentSeries">,
  colorSlot: number,
  index: number,
  patternedSlots?: ReadonlySet<number>,
): KindPaint {
  const paint = seriesPaint(
    colorSlot,
    seriesRank(index, config.accentSeries),
    config.palette,
    patternedSlots,
  );
  return { ...paint, ...paintVariants(paint.color, paint.textColor, colorSlot) };
}

/**
 * Farby chmur wykresu punktowego, w kolejności chmur. Wyróżniona jest chmura
 * serii `accentSeries`; gdy tą serią jest kolumna osi X (tryb `series`),
 * która chmurą nie jest, akcent dostaje pierwsza chmura - wykres punktowy
 * zawsze ma jedną chmurę „o czym jest mowa". Wspólne dla rysunku i legendy
 * ramy, więc próbka legendy jest kolorem z rysunku.
 */
export function cloudPaints(
  config: Pick<ChartConfig, "palette" | "accentSeries">,
  clouds: readonly { seriesIndex: number; colorSlot: number }[],
): KindPaint[] {
  const wyrozniona = Math.max(
    0,
    clouds.findIndex((c) => c.seriesIndex === config.accentSeries),
  );
  return clouds.map((c, ci) =>
    kindSeriesPaint({ palette: config.palette, accentSeries: wyrozniona }, c.colorSlot, ci),
  );
}

/**
 * Farba rysunku JEDNOBARWNEGO (histogram, linia centralna wachlarza, panele):
 * pod `focus` zawsze akcent - rysunek mówi o jednej wielkości, więc to ona
 * jest wyróżniona - pod `categorical` slot serii, jak dotąd.
 */
export function kindSinglePaint(
  config: Pick<ChartConfig, "palette">,
  colorSlot: number,
): KindPaint {
  const paint = seriesPaint(colorSlot, 0, config.palette);
  return { ...paint, ...paintVariants(paint.color, paint.textColor, colorSlot) };
}
