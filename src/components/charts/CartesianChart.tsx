// Wykres kartezjański (line / area / bar / bar-horizontal / waterfall, plus
// stacked) - system wykresów ze specyfikacji 2026-10.
//
// WYGLĄD, każdy parametr z `lib/charts/geometry.ts` albo z tokena:
//  - linia 2 px z zaokrąglonymi końcami, wygładzona MONOTONICZNYM Hermite'em
//    (Fritsch-Carlson), bez łączenia przerw; pod kursorem seria aktywna
//    pogrubia się do 2,5 px, a pozostałe przygasają;
//  - punkty 7 px wypełnione kolorem serii z obwódką 1,5 px w kolorze płyty,
//    w czterech KSZTAŁTACH (koło, romb, trójkąt, kwadrat) - kolor nie jest
//    jedynym nośnikiem tożsamości; przy ponad 20 punktach chowane i pokazywane
//    tylko na aktywnej kategorii;
//  - pole pod linią: gradient pionowy od 15% krycia (seria główna) albo 8%
//    (pozostałe, tylko na wykresie pól) do zera przy linii bazowej;
//  - słupki pełne, najwyżej 22 px (34 px w stosie), odstęp serii 25%,
//    zaokrąglony 4 px WYŁĄCZNIE koniec danych; wartość ujemna pojedynczej
//    serii w czerwieni z zaokrągleniem na dole; trzecia seria z ukośnym
//    kreskowaniem;
//  - pasmo optimum (akcent 10%) z etykietą „przedział", linia celu
//    przerywana 5 4 z etykietą „cel X" - oba nieaktywne dla myszy;
//  - jednostka jako nazwa osi nad osią wartości; maksimum osi z 4% zapasu
//    nad najwyższym punktem, pasmem albo celem.
//
// INTERAKCJA: prowadnica przerywana 4 4 w tuszu trzecim i jeden tooltip ze
// wszystkimi seriami w punkcie osi (linie); tło kolumny w tuszu trzecim 8%
// (słupki). Seria pod kursorem jest rozpoznawana z geometrii - dystansu do
// linii albo słupka - i tylko wtedy przygasza pozostałe. Kliknięcie punktu
// oddaje go ramie (okno z definicją wskaźnika), a panel analityczny dostaje
// swoje `onSelect`. Powyżej 30 kategorii: suwak zakresu pod wykresem
// i przybliżanie Shiftem z kółkiem myszy (bez Shiftu kółko przewija stronę).
//
// MARGINESY LICZONE Z POMIARU, NIE ZGADYWANE - pomiar `canvas.measureText`
// wchodzi PO zamontowaniu (patrz `useLabelMetrics`), a pierwsze przejście
// używa heurystyki i szerokości 720, więc geometria SSR jest deterministyczna.
// KOLIZJE ETYKIET OSI rozwiązuje drabina z `lib/charts/labels.ts`.
// SSR: pełny, statyczny SVG w HTML (interakcja dogrywa się po hydracji).
import {
  Fragment,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
} from "react";
import { useTranslation } from "react-i18next";
import type { ChartConfig, ChartSeries } from "@/lib/charts/types";
import { slotsNeedingPattern } from "@/lib/charts/palette";
import { markerPath, seriesPaint, type SeriesPaint } from "@/lib/charts/seriesStyle";
import { ROLE } from "@/lib/charts/roles";
import { effectiveBand, referenceExtent } from "@/lib/charts/status";
import {
  extendDomain,
  forecastBandExtent,
  linearScale,
  niceScale,
  seriesExtent,
  stackSeries,
} from "@/lib/charts/scale";
import {
  formatAxisTick,
  formatChartValue,
  formatSignedValue,
  type ChartLang,
} from "@/lib/charts/format";
import {
  BAR_RADIUS,
  CATEGORY_LABEL_MAX_CHARS,
  CATEGORY_LABEL_MAX_WIDTH,
  CATEGORY_LABEL_MAX_WIDTH_COMPACT,
  DOT_RADIUS,
  FONT_END_LABEL,
  FONT_VALUE,
  MIN_INNER_H,
  MIN_INNER_W,
  PAD_BOTTOM,
  PAD_LEFT_CATEGORY_MIN,
  PAD_LEFT_EDGE,
  PAD_LEFT_MIN,
  PAD_SIDE,
  PAD_TOP,
  PAD_TOP_WITH_LABELS,
  SLIDER_GAP,
  VALUE_HEADROOM,
  ZOOM_MIN_POINTS,
  axisFontSize,
  barLayout,
  clampBarRadius,
  clampRadius,
  effectiveSmoothing,
  isCompact,
  padRightFor,
  shouldShowDots,
  snapToGrid,
  valueTickTarget,
} from "@/lib/charts/geometry";
import { bandIndex, nearestPointIndex, pointerToPlot } from "@/lib/charts/plot";
import { SMOOTHING_MIN_POINTS, pathFromPoints, type Point } from "@/lib/charts/smooth";
import { estimateLabelWidth, useLabelMetrics } from "@/lib/charts/measureText";
import { WRAP_LINE_EM, planCategoryLabels, type CategoryLabelPlan } from "@/lib/charts/labels";
import { waterfallExtent, waterfallModel } from "@/lib/charts/waterfall";
import { clampZoom, sliceConfig, zoomAround, type ZoomRange } from "@/lib/charts/zoom";
import { useContainerWidth } from "@/hooks/useContainerWidth";
import { useTapAwayDismiss } from "@/hooks/useTapAwayDismiss";
import { useRevealOnScroll, revealClassName } from "@/hooks/useRevealOnScroll";
import { ChartTooltip, type TooltipFact, type TooltipRow } from "./ChartTooltip";
import { RangeSlider } from "./RangeSlider";
import { isIndicator, sourceLine, valueFacts } from "./chartFacts";
import "@/lib/i18n-charts";
import {
  categorySelection,
  isSelectKey,
  type ChartPointHandler,
  type ChartSelectHandler,
  type LegendMode,
} from "@/lib/charts/selection";

export interface CartesianChartProps {
  config: ChartConfig;
  lang: ChartLang;
  /**
   * Wskazanie ODDANE NA ZEWNĄTRZ - kliknięciem albo klawiszem Enter. Podaje
   * je panel analityczny, który otwiera okno szczegółów; pominięcie znaczy
   * „wykres tylko do czytania".
   */
  onSelect?: ChartSelectHandler;
  /** Nazwa dostępna rysunku podana z zewnątrz (gdy osadzenie rysuje nagłówek). */
  ariaLabel?: string;
  /** Indeksy serii ukrytych w legendzie (pozycje w konfiguracji). */
  hidden?: ReadonlySet<number>;
  /** Kliknięty punkt (seria rozstrzygnięta) - rama otwiera okno definicji. */
  onPointClick?: ChartPointHandler;
  /** Czy serie nazywa legenda, czy etykiety przy końcu linii. */
  onLegendMode?: (mode: LegendMode) => void;
}

/** Pozycja kotwicy tooltipa w px kontenera - liczona z indeksu przy renderze. */
interface Anchor {
  x: number;
  y: number;
}

/**
 * Ciąg punktów linii bez luk, RAZEM z indeksami kategorii, z których powstał -
 * inaczej nie da się powiedzieć, które punkty ciągu są prognozą.
 */
interface LineRun {
  points: Point[];
  indices: number[];
}

/** Seria widoczna na rysunku razem z pozycją w konfiguracji i wyglądem. */
interface Entry {
  s: ChartSeries;
  /** Pozycja w `config.series` - po niej idzie wygląd i ukrywanie. */
  index: number;
  paint: SeriesPaint;
}

/** Koniec DANYCH słupka - ten, który wolno zaokrąglić. */
type DataEnd = "top" | "bottom" | "left" | "right" | "none";

/** Koniec danych wynika ze ZNAKU WARTOŚCI, nie z pionu. */
function dataEndOf(horizontal: boolean, negative: boolean): DataEnd {
  if (horizontal) return negative ? "left" : "right";
  return negative ? "bottom" : "top";
}

function barPath(
  x: number,
  y: number,
  w: number,
  h: number,
  radius: number,
  roundedEnd: DataEnd,
): string {
  // Słupek jest pełny (bez obwódki), więc oko czyta MASĘ wypełnienia - promień
  // nie może przekroczyć połowy długości, inaczej niski słupek staje się
  // kopułką i jego wysokość przestaje być czytelna.
  const alongValue = roundedEnd === "left" || roundedEnd === "right";
  const r =
    radius === 0
      ? 0
      : clampBarRadius(alongValue ? h : w, alongValue ? w : h, { bordered: false, inset: 0 });
  if (r === 0 || roundedEnd === "none") {
    return `M${x} ${y}h${w}v${h}h${-w}Z`;
  }
  switch (roundedEnd) {
    case "top":
      return `M${x} ${y + h}v${-(h - r)}q0 ${-r} ${r} ${-r}h${w - 2 * r}q${r} 0 ${r} ${r}v${h - r}Z`;
    case "bottom":
      return `M${x} ${y}v${h - r}q0 ${r} ${r} ${r}h${w - 2 * r}q${r} 0 ${r} ${-r}v${-(h - r)}Z`;
    case "right":
      return `M${x} ${y}h${w - r}q${r} 0 ${r} ${r}v${h - 2 * r}q0 ${r} ${-r} ${r}h${-(w - r)}Z`;
    case "left":
      return `M${x + w} ${y}v${h}h${-(w - r)}q${-r} 0 ${-r} ${-r}v${-(h - 2 * r)}q0 ${-r} ${r} ${-r}Z`;
  }
}

/**
 * Rodzaje, które dostają suwak zakresu: oś kategorii biegnie w poziomie
 * i ma porządek, który wolno ciąć oknem. Mostek nie - jego suma kontrolna
 * wymaga wszystkich kroków naraz.
 */
function zoomableKind(kind: ChartConfig["kind"]): boolean {
  return kind === "line" || kind === "area" || kind === "bar";
}

export function CartesianChart(props: CartesianChartProps) {
  const { config } = props;
  const total = config.categories.length;
  const zoomable = zoomableKind(config.kind) && total > ZOOM_MIN_POINTS;
  const [range, setRange] = useState<ZoomRange | null>(null);
  const view = zoomable && range !== null ? clampZoom(range, total) : null;
  const start = view?.start ?? 0;
  const end = view?.end ?? Math.max(0, total - 1);
  const viewConfig = useMemo(
    () => (view === null ? config : sliceConfig(config, start, end)),
    // `view` jest nowym obiektem przy każdym renderze - zależą od niego
    // wyłącznie jego dwie liczby.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [config, view === null, start, end],
  );
  return (
    <CartesianPlot
      {...props}
      config={viewConfig}
      full={config}
      offset={start}
      zoom={zoomable ? { total, range: { start, end }, onChange: setRange } : null}
    />
  );
}

interface PlotProps extends CartesianChartProps {
  /** Konfiguracja CAŁA - do zmiany względem poprzedniego punktu i do suwaka. */
  full: ChartConfig;
  /** Indeks pierwszej widocznej kategorii w konfiguracji całej. */
  offset: number;
  zoom: { total: number; range: ZoomRange; onChange: (range: ZoomRange) => void } | null;
}

function CartesianPlot({
  config,
  full,
  offset,
  zoom,
  lang,
  onSelect,
  ariaLabel: nazwaZadana,
  hidden,
  onPointClick,
  onLegendMode,
}: PlotProps) {
  // `keyPrefix` zamiast sklejania klucza w szablonie - bramka rozjazdu
  // kod<->słownik rozumie WYŁĄCZNIE prefiks podany hakowi.
  const { t: scoped } = useTranslation("translation", { keyPrefix: "charts" });
  const t = (key: string, values?: Record<string, string | number>): string =>
    scoped(key, { lng: lang, ...values });
  const { ref: widthRef, width } = useContainerWidth<HTMLDivElement>(720);
  const { ref: revealRef, state: revealState } = useRevealOnScroll<HTMLDivElement>(config.animate, {
    onMount: true,
  });
  // W stanie siedzi WYŁĄCZNIE indeks kategorii i seria, a nie gotowa
  // kotwica: piksele zależą od geometrii, a ta zmienia się z każdą zmianą.
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const [activeSeries, setActiveSeries] = useState<number | null>(null);
  const lastPointer = useRef<string>("mouse");
  const clearActive = useCallback(() => {
    setActiveIndex(null);
    setActiveSeries(null);
  }, []);
  useTapAwayDismiss(activeIndex !== null, widthRef, clearActive);
  // Identyfikator definicji SVG (kreskowanie, gradienty) - unikalny per
  // instancja, bo `url(#id)` wiąże się z PIERWSZYM elementem o tym id na
  // stronie. Dwukropki lecą, bo część przeglądarek nie przechodzi `url(#a:b)`.
  const uid = useId().replace(/:/g, "");

  const compact = isCompact(width);
  const fontAxis = axisFontSize(width);
  const horizontal = config.kind === "bar-horizontal";
  const isLine = config.kind === "line" || config.kind === "area";
  const isWaterfall = config.kind === "waterfall";
  const n = config.categories.length;

  // Wygląd liczony dla WSZYSTKICH serii konfiguracji (pozycja = tożsamość),
  // a rysowane tylko te widoczne i niepuste.
  const patterned = useMemo(
    () => slotsNeedingPattern(config.series.map((s) => s.colorSlot)),
    [config.series],
  );
  const entries: Entry[] = useMemo(
    () =>
      config.series
        .map((s, index) => ({
          s,
          index,
          paint: seriesPaint(s.colorSlot, index, config.palette, patterned),
        }))
        .filter((e) => !hidden?.has(e.index) && e.s.values.some((v) => v !== null)),
    [config.series, config.palette, patterned, hidden],
  );
  const series = useMemo(() => entries.map((e) => e.s), [entries]);
  const stacked = config.stacked && !isLine && !isWaterfall && series.length > 1;
  const height = config.height;

  // Mostek czyta WYŁĄCZNIE pierwszą serię: nie da się dodać dwóch dekompozycji
  // tej samej różnicy.
  const waterfall = useMemo(
    () => (isWaterfall ? waterfallModel(config.categories, config.series[0]?.values ?? []) : null),
    [isWaterfall, config.categories, config.series],
  );

  // ---- Granica prognozy. Zero wolno tylko w oknie zakresu, które zaczyna się
  // już w prognozie - na pełnej osi cały szereg-prognoza nie ma historii,
  // od której by się odróżniał.
  const forecastFrom =
    config.forecastFrom !== null &&
    config.forecastFrom >= (offset > 0 ? 0 : 1) &&
    config.forecastFrom < n
      ? config.forecastFrom
      : null;
  const bandPct = forecastFrom !== null && isLine ? config.forecastBandPct : 0;

  // ---- Odniesienia: pasmo WYŁĄCZNIE ze źródłem (albo demo), cel.
  const optimum = useMemo(
    () =>
      effectiveBand(
        config.band,
        config.sources.map((s) => s.id),
      ),
    [config.band, config.sources],
  );
  const target = config.target;
  const indicator = isIndicator(config);

  // ---- Skala wartości: dane + pasmo prognozy + pasmo optimum + cel + zapas.
  const scaleInfo = useMemo(() => {
    const extent = waterfall
      ? waterfallExtent(waterfall)
      : seriesExtent(series, n, { stacked, includeZero: !isLine });
    const domain = extendDomain(
      extent,
      [forecastBandExtent(series, forecastFrom, bandPct), referenceExtent(optimum, target)],
      VALUE_HEADROOM,
    );
    return niceScale(domain.min, domain.max, valueTickTarget(height, horizontal));
  }, [
    waterfall,
    series,
    n,
    stacked,
    isLine,
    horizontal,
    height,
    forecastFrom,
    bandPct,
    optimum,
    target,
  ]);

  const tickLabels = useMemo(
    () => scaleInfo.ticks.map((tick) => formatAxisTick(tick, lang)),
    [scaleInfo, lang],
  );

  // Pomiar POST-MOUNT. `null` w pierwszym przejściu - wtedy liczy heurystyka.
  const metrics = useLabelMetrics(tickLabels, config.categories, fontAxis);

  // ETYKIETY NA KOŃCU LINII zamiast legendy: 2-4 serie, wykres nie zwarty.
  const endLabels = isLine && !compact && entries.length >= 2 && entries.length <= 4;
  const endLabelText = useCallback(
    (e: Entry): string => {
      const idx = lastNonNullIndex(e.s.values);
      const value =
        config.showValues && idx >= 0
          ? ` ${formatChartValue(e.s.values[idx] as number, lang, config.unit)}`
          : "";
      return `${e.s.name}${value}`;
    },
    [config.showValues, config.unit, lang],
  );

  useEffect(() => {
    onLegendMode?.(endLabels ? "labels" : "legend");
  }, [endLabels, onLegendMode]);

  const geometry = useMemo(() => {
    const tickWidth = metrics.value ?? estimateLabelWidth(longest(tickLabels), fontAxis);
    const catWidth = metrics.category ?? estimateLabelWidth(longest(config.categories), fontAxis);
    const labelColumn = compact ? CATEGORY_LABEL_MAX_WIDTH_COMPACT : CATEGORY_LABEL_MAX_WIDTH;

    // Prawy margines: etykiety na końcu linii (nazwa pogrubiona) albo wartość
    // na szczycie poziomego słupka - nigdy nie przycinamy etykiet.
    const endLabelW = endLabels
      ? Math.max(
          ...entries.map((e) => estimateLabelWidth(endLabelText(e), FONT_END_LABEL) * 1.08),
        ) + 12
      : 0;
    const valueLabelW =
      config.showValues && (isLine || horizontal)
        ? longestValueWidth(series, config, lang) + 10
        : 0;
    const padTop = !isLine && !horizontal && config.showValues ? PAD_TOP_WITH_LABELS : PAD_TOP;
    const padRight = Math.max(padRightFor(width), endLabelW, valueLabelW);
    const padLeft = horizontal
      ? Math.min(labelColumn, Math.max(PAD_LEFT_CATEGORY_MIN, catWidth + PAD_SIDE))
      : Math.max(PAD_LEFT_MIN, PAD_LEFT_EDGE + tickWidth + 8);

    const measureLabel = (text: string): number =>
      metrics.category !== null && text === longest(config.categories)
        ? metrics.category
        : estimateLabelWidth(text, fontAxis);

    // BUDŻET NA MARGINES DOLNY - nadwyżka obróconych etykiet idzie do drabiny,
    // nie przepada pod kartą.
    const bottomBudget = Math.max(PAD_BOTTOM, height - padTop - MIN_INNER_H);

    const planFor = (): { plan: CategoryLabelPlan; padBottom: number } => {
      const innerWidth = Math.max(MIN_INNER_W, width - padLeft - padRight);
      const slot = n > 0 ? innerWidth / (isLine && n > 1 ? Math.max(1, n - 1) : n) : innerWidth;
      const plan = planCategoryLabels(config.categories, {
        slotWidth: slot,
        fontSize: fontAxis,
        measure: measureLabel,
        maxBottomSpace: bottomBudget,
      });
      return { plan, padBottom: Math.max(PAD_BOTTOM, snapToGrid(plan.bottomSpace)) };
    };

    const ladder = horizontal ? null : planFor();
    const padBottom = horizontal
      ? PAD_BOTTOM
      : Math.min(bottomBudget, ladder?.padBottom ?? PAD_BOTTOM);

    const innerW = Math.max(MIN_INNER_W, width - padLeft - padRight);
    const innerH = Math.max(MIN_INNER_H, height - padTop - padBottom);

    const value = horizontal
      ? linearScale(scaleInfo.min, scaleInfo.max, padLeft, padLeft + innerW)
      : linearScale(scaleInfo.min, scaleInfo.max, padTop + innerH, padTop);

    const catSpan = horizontal ? innerH : innerW;
    const catStart = horizontal ? padTop : padLeft;
    const band = n > 0 ? catSpan / n : catSpan;
    const catCenter = (i: number): number =>
      isLine && n > 1 ? catStart + (catSpan * i) / (n - 1) : catStart + band * (i + 0.5);

    const pointSpacing = isLine && n > 1 ? catSpan / (n - 1) : band;
    const smoothing = isLine
      ? effectiveSmoothing(n, config.smoothing, pointSpacing, SMOOTHING_MIN_POINTS)
      : 0;

    const stacks = stacked ? stackSeries(series, n) : null;
    return {
      padTop,
      padLeft,
      padBottom,
      padRight,
      innerW,
      innerH,
      value,
      band,
      catCenter,
      stacks,
      smoothing,
      labelColumn,
      plan: ladder?.plan ?? null,
    };
  }, [
    metrics,
    tickLabels,
    series,
    entries,
    endLabels,
    endLabelText,
    n,
    stacked,
    isLine,
    horizontal,
    height,
    width,
    compact,
    fontAxis,
    lang,
    scaleInfo,
    config,
  ]);

  // PRZYBLIŻANIE SHIFTEM Z KÓŁKIEM. Natywny nasłuch z `passive: false`, bo
  // React podpina `wheel` jako pasywny i `preventDefault` by nie zadziałał -
  // a bez niego Shift+kółko przewijałby jeszcze stronę w poziomie. Bez Shiftu
  // nie robimy NIC: kółko należy do przewijania strony.
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  const plotBox = useRef({ padLeft: 0, innerW: 1 });
  plotBox.current = { padLeft: geometry.padLeft, innerW: geometry.innerW };
  useEffect(() => {
    const node = widthRef.current;
    if (!node || zoom === null) return;
    const onWheel = (e: WheelEvent): void => {
      const z = zoomRef.current;
      if (!e.shiftKey || z === null) return;
      const delta = e.deltaY !== 0 ? e.deltaY : e.deltaX;
      if (delta === 0) return;
      e.preventDefault();
      const rect = node.getBoundingClientRect();
      const scale = rect.width > 0 ? node.clientWidth / rect.width : 1;
      const local = (e.clientX - rect.left) * scale - plotBox.current.padLeft;
      const anchor = local / Math.max(1, plotBox.current.innerW);
      z.onChange(zoomAround(z.range, z.total, anchor, delta > 0 ? 1.25 : 0.8));
    };
    node.addEventListener("wheel", onWheel, { passive: false });
    return () => node.removeEventListener("wheel", onWheel);
    // Nasłuch zależy tylko od tego, CZY zakres istnieje - jego wartości czyta
    // przez ref, inaczej każdy ruch suwaka przepinałby nasłuch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoom === null, widthRef]);

  if (n === 0 || (series.length === 0 && !waterfall)) return null;

  const {
    padTop,
    padLeft,
    innerW,
    innerH,
    value,
    band,
    catCenter,
    stacks,
    smoothing,
    labelColumn,
    plan,
  } = geometry;
  const zeroPos = value(Math.max(scaleInfo.min, Math.min(0, scaleInfo.max)));
  const showDots = shouldShowDots(n);

  // ---- Słupki: szerokość i odstęp serii z `barLayout`.
  const groupCount = stacked || waterfall ? 1 : series.length;
  const { width: barW, gap: barGap } = barLayout(band, groupCount, stacked);
  const groupW = groupCount * barW + (groupCount - 1) * barGap;
  const barOffset = (k: number): number => -groupW / 2 + k * (barW + barGap);

  // ---- Prognoza: granica w pikselach. Biegnie POŚRODKU między ostatnią
  // obserwacją i pierwszą prognozą - pomiar nadal jest pomiarem.
  const forecastBoundary =
    forecastFrom === null
      ? null
      : forecastFrom === 0
        ? horizontal
          ? padTop
          : padLeft
        : isLine
          ? (catCenter(forecastFrom - 1) + catCenter(forecastFrom)) / 2
          : catCenter(forecastFrom) - band / 2;

  /**
   * Seria pod kursorem - rozpoznana z GEOMETRII, nie z elementu DOM: strefa
   * trafienia obejmuje cały obszar kreślenia, więc pytamy, czy kursor stoi
   * blisko linii (14 px, z interpolacją między punktami) albo w słupku.
   * Puste tło nie wskazuje żadnej serii i niczego nie przygasza.
   */
  const seriesAt = (index: number, x: number, y: number): number | null => {
    if (waterfall) return null;
    if (isLine) {
      const step = n > 1 ? innerW / (n - 1) : innerW;
      const tpos = n > 1 ? (x - padLeft) / step : 0;
      const i0 = Math.max(0, Math.min(n - 1, Math.floor(tpos)));
      const i1 = Math.max(0, Math.min(n - 1, Math.ceil(tpos)));
      const frac = tpos - i0;
      let best: number | null = null;
      let bestDist = 14;
      for (const e of entries) {
        const v0 = e.s.values[i0];
        const v1 = e.s.values[i1];
        const v = v0 !== null && v1 !== null ? v0 + (v1 - v0) * frac : (e.s.values[index] ?? null);
        if (v === null) continue;
        const dist = Math.abs(value(v) - y);
        if (dist <= bestDist) {
          bestDist = dist;
          best = e.index;
        }
      }
      return best;
    }
    const along = horizontal ? y : x;
    const across = horizontal ? x : y;
    const center = catCenter(index);
    if (stacked && stacks) {
      for (let k = 0; k < entries.length; k++) {
        const cell = stacks[k][index];
        if (cell.value === null || cell.value === 0) continue;
        if (Math.abs(along - center) > barW / 2) return null;
        const a = value(cell.from);
        const b = value(cell.to);
        if (across >= Math.min(a, b) - 1 && across <= Math.max(a, b) + 1) return entries[k].index;
      }
      return null;
    }
    const rel = along - (center + barOffset(0));
    const k = Math.floor(rel / (barW + barGap));
    if (k < 0 || k >= entries.length || rel - k * (barW + barGap) > barW) return null;
    const v = entries[k].s.values[index];
    if (v === null) return null;
    const b = value(v);
    return across >= Math.min(zeroPos, b) - 4 && across <= Math.max(zeroPos, b) + 4
      ? entries[k].index
      : null;
  };

  const locate = (
    e: PointerEvent<SVGRectElement>,
  ): { index: number; seriesIndex: number | null } => {
    const point = pointerToPlot(
      e.clientX,
      e.clientY,
      e.currentTarget.getBoundingClientRect(),
      innerW,
      innerH,
    );
    if (point === null) return { index: 0, seriesIndex: null };
    const alongAxis = horizontal ? point.y : point.x;
    const index =
      isLine && n > 1
        ? nearestPointIndex(alongAxis, horizontal ? innerH : innerW, n)
        : bandIndex(alongAxis, band, n);
    return { index, seriesIndex: seriesAt(index, padLeft + point.x, padTop + point.y) };
  };

  const anchorFor = (index: number): Anchor => {
    const c = catCenter(index);
    const positions = waterfall
      ? waterfall.steps.filter((s) => s.index === index).map((s) => value(s.to))
      : series
          .map((s) => s.values[index])
          .filter((v): v is number => v !== null)
          .map((v) => value(v));
    if (horizontal) {
      return { x: positions.length ? Math.max(...positions) : zeroPos, y: c };
    }
    const yTop = positions.length ? Math.min(...positions) : padTop;
    return { x: c, y: Math.max(padTop, yTop) };
  };

  // Klamra na indeksie: aktywna kategoria przeżywa podmianę configu, a nowy
  // zestaw bywa KRÓTSZY.
  const active = activeIndex === null ? null : Math.max(0, Math.min(n - 1, activeIndex));
  const anchor = active === null ? null : anchorFor(active);
  const focused =
    activeSeries !== null && entries.some((e) => e.index === activeSeries) ? activeSeries : null;

  /** Wartość w poprzednim punkcie osi - z konfiguracji CAŁEJ, więc działa też na krawędzi okna. */
  const previousOf = (seriesIndex: number, localIndex: number): number | null => {
    const global = offset + localIndex;
    return global > 0 ? (full.series[seriesIndex]?.values[global - 1] ?? null) : null;
  };

  const pointDetail = (localIndex: number, seriesIndex: number) => {
    const s = config.series[seriesIndex];
    return {
      categoryIndex: offset + localIndex,
      category: config.categories[localIndex] ?? "",
      seriesIndex,
      seriesName: s?.name ?? "",
      value: s?.values[localIndex] ?? null,
      previous: previousOf(seriesIndex, localIndex),
    };
  };

  const select = (localIndex: number, seriesIndex: number | null): void => {
    if (onSelect) {
      onSelect(categorySelection(full.kind, full.categories, full.series, offset + localIndex));
      return;
    }
    if (!onPointClick || waterfall) return;
    const resolved = seriesIndex ?? (entries.length === 1 ? entries[0].index : null);
    if (resolved !== null) onPointClick(pointDetail(localIndex, resolved));
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const forwardKey = horizontal ? "ArrowDown" : "ArrowRight";
    const backKey = horizontal ? "ArrowUp" : "ArrowLeft";
    if (e.key === forwardKey || e.key === backKey) {
      e.preventDefault();
      const delta = e.key === forwardKey ? 1 : -1;
      setActiveIndex(active === null ? 0 : Math.max(0, Math.min(n - 1, active + delta)));
    } else if (isSelectKey(e.key)) {
      // WYBÓR Z KLAWIATURY - okno szczegółów nie może istnieć tylko dla myszy.
      if (active !== null && (onSelect || onPointClick)) {
        e.preventDefault();
        select(active, focused ?? entries[0]?.index ?? null);
      }
    } else if (e.key === "Escape" || e.key === "Tab") {
      clearActive();
    }
  };

  // ETYKIETY KOŃCÓW LINII z rozsuwaniem kolizji - zbieżne serie nie mogą
  // nakładać etykiet. Etykieta wartości (bez trybu nazw) idzie tą samą drogą.
  const endLabelY = new Map<number, number>();
  if (isLine && (endLabels || config.showValues)) {
    const raw = entries
      .map((e) => {
        const idx = lastNonNullIndex(e.s.values);
        return idx >= 0 ? { si: e.index, y: value(e.s.values[idx] as number) } : null;
      })
      .filter((x): x is { si: number; y: number } => x !== null)
      .sort((a, b) => a.y - b.y);
    const MIN_GAP = 14;
    for (let i = 1; i < raw.length; i++) {
      if (raw[i].y < raw[i - 1].y + MIN_GAP) raw[i] = { ...raw[i], y: raw[i - 1].y + MIN_GAP };
    }
    for (const item of raw) endLabelY.set(item.si, item.y);
  }

  // ---- TOOLTIP: wiersze serii (malejąco po wartości) i wiersze oceny.
  const primary: Entry | undefined =
    entries.find((e) => e.index === focused) ?? entries[0] ?? undefined;
  let tooltipRows: TooltipRow[] = [];
  let tooltipFacts: TooltipFact[] = [];
  if (active !== null) {
    if (waterfall) {
      const steps = waterfall.steps.filter((s) => s.index === active);
      tooltipRows = steps.map((s) => ({
        // TRZY KIERUNKI, NIE DWA - składnik o wkładzie zerowym jest osobną
        // informacją, a nie „wzrostem".
        name:
          s.kind === "start"
            ? t("waterfall.start")
            : s.kind === "end"
              ? t("waterfall.end")
              : s.direction === "down"
                ? t("waterfall.decrease")
                : s.direction === "flat"
                  ? t("waterfall.flat")
                  : t("waterfall.increase"),
        // BEZ PRÓBKI KOLORU: na mostku kolor koduje ZNAK, nie serię, więc
        // kwadracik obiecywałby klucz do legendy serii, której tu nie ma.
        colorSlot: null,
        value: formatChartValue(s.value, lang, config.unit),
      }));
      tooltipFacts = steps.flatMap((s) =>
        s.kind === "step"
          ? [
              { label: t("tip.change"), value: formatSignedValue(s.value, lang, config.unit) },
              { label: t("tip.level"), value: formatChartValue(s.to, lang, config.unit) },
            ]
          : [{ label: t("tip.level"), value: formatChartValue(s.value, lang, config.unit) }],
      );
    } else {
      tooltipRows = entries
        .map((e) => ({ e, raw: e.s.values[active] }))
        .filter((r) => r.raw !== null)
        // MALEJĄCO PO WARTOŚCI - kolejność w dymku odpowiada kolejności serii
        // w pionie na prowadnicy.
        .sort((a, b) => (b.raw as number) - (a.raw as number))
        .map((r) => ({
          name: r.e.s.name,
          colorSlot: r.e.s.colorSlot,
          color: r.e.paint.color,
          value: formatChartValue(r.raw as number, lang, config.unit),
          emphasised: entries.length > 1 && r.e.index === (focused ?? -1),
        }));
      if (primary) {
        tooltipFacts = valueFacts(t, lang, {
          value: primary.s.values[active] ?? null,
          previous: previousOf(primary.index, active),
          band: optimum,
          direction: config.direction,
          indicator,
          // Zmiana ma sens na osi UPORZĄDKOWANEJ (czas) albo dla wskaźnika
          // z kierunkiem; między dwoma krajami „zmiana" nie istnieje.
          showChange: isLine || config.direction !== null,
        });
      }
    }
  }

  // NAZWA RYSUNKU. `nazwaZadana` wygrywa w całości - osadzenie zna kontekst.
  const ariaLabel =
    nazwaZadana ??
    (config.title ? t("a11y.chart", { title: config.title }) : t("a11y.chartUntitled"));

  const zoneHatchId = `neh-zone-hatch-${uid}`;
  const barHatchId = `neh-bar-hatch-${uid}`;
  const hintId = `neh-hint-${uid}`;
  const hasHatch = !isLine && !waterfall && entries.some((e) => e.paint.hatched);

  // POLE POD LINIĄ: gradient od krycia szczytowego przy krawędziach rysunku
  // do ZERA DOKŁADNIE NA LINII BAZOWEJ - w `userSpaceOnUse`, bo baza bywa
  // u góry (seria ujemna) albo w środku (seria o zmiennym znaku), a gradient
  // przypięty do pudełka ścieżki odwracałby wtedy kodowanie.
  const areaOpacity = (e: Entry): number =>
    e.paint.primary ? 0.15 : config.kind === "area" ? 0.08 : 0;
  const areaEntries = isLine ? entries.filter((e) => areaOpacity(e) > 0) : [];
  const areaGradientId = (index: number): string => `neh-area-${uid}-${index}`;
  const areaBaseline = innerH > 0 ? Math.min(1, Math.max(0, (zeroPos - padTop) / innerH)) : 0;

  const unit = config.unit.trim();

  return (
    <div ref={revealRef} className={revealClassName(revealState)}>
      <div
        ref={widthRef}
        className="neh-canvas relative w-full select-none"
        style={{
          height,
          borderRadius: "var(--chart-radius)",
        }}
        tabIndex={0}
        role="img"
        aria-label={ariaLabel}
        // PODPOWIEDŹ KLAWIATURY jako opis, nie jako nazwa: nazwa mówi, CO to
        // jest, opis - jak tego użyć.
        aria-describedby={hintId}
        onKeyDown={onKeyDown}
        onBlur={clearActive}
      >
        <span id={hintId} className="sr-only">
          {t("a11y.keyboardHint")}
        </span>
        <svg width={width} height={height} className="block overflow-visible">
          {(areaEntries.length > 0 || hasHatch) && (
            <defs>
              {areaEntries.map((e) => {
                const peak = areaOpacity(e);
                const z = areaBaseline;
                return (
                  <linearGradient
                    key={e.index}
                    id={areaGradientId(e.index)}
                    gradientUnits="userSpaceOnUse"
                    x1={0}
                    y1={padTop}
                    x2={0}
                    y2={padTop + innerH}
                  >
                    {z > 0.001 && <stop offset={0} stopColor={e.paint.color} stopOpacity={peak} />}
                    <stop offset={z} stopColor={e.paint.color} stopOpacity={0} />
                    {z < 0.999 && <stop offset={1} stopColor={e.paint.color} stopOpacity={peak} />}
                  </linearGradient>
                );
              })}
              {hasHatch && (
                // KRESKOWANIE TRZECIEJ SERII: ukośne paski w kolorze płyty
                // na pełnym wypełnieniu - seria czytelna bez koloru, także
                // w druku czarno-białym.
                <pattern
                  id={barHatchId}
                  width="5"
                  height="5"
                  patternUnits="userSpaceOnUse"
                  patternTransform="rotate(45)"
                >
                  <line
                    x1="0"
                    y1="0"
                    x2="0"
                    y2="5"
                    style={{ stroke: "var(--card)", strokeOpacity: 0.75 }}
                    strokeWidth={1.6}
                  />
                </pattern>
              )}
            </defs>
          )}

          {/* STREFA PROGNOZY - na ekranie płaski tint, w druku kreskowanie
              (przełącza arkusz). Rysowana PRZED siatką. */}
          {forecastBoundary !== null && !horizontal && (
            <>
              <defs>
                <pattern
                  id={zoneHatchId}
                  width="6"
                  height="6"
                  patternUnits="userSpaceOnUse"
                  patternTransform="rotate(45)"
                >
                  <line
                    x1="0"
                    y1="0"
                    x2="0"
                    y2="6"
                    style={{ stroke: "var(--chart-zone)", strokeOpacity: 0.06 }}
                    strokeWidth={1}
                  />
                </pattern>
              </defs>
              <rect
                className="neh-zone-tint"
                x={forecastBoundary}
                y={padTop}
                width={Math.max(0, padLeft + innerW - forecastBoundary)}
                height={innerH}
                fill="var(--chart-zone)"
                style={{ fillOpacity: "var(--chart-zone-alpha)" }}
                rx={clampRadius(padLeft + innerW - forecastBoundary, innerH)}
                pointerEvents="none"
              />
              <rect
                className="neh-zone-hatch"
                x={forecastBoundary}
                y={padTop}
                width={Math.max(0, padLeft + innerW - forecastBoundary)}
                height={innerH}
                fill={`url(#${zoneHatchId})`}
                rx={clampRadius(padLeft + innerW - forecastBoundary, innerH)}
                pointerEvents="none"
              />
            </>
          )}

          {/* Siatka: poziome linie 1 px (pionowe przy słupkach poziomych),
              bez siatki prostopadłej do osi kategorii. */}
          {config.showGrid &&
            scaleInfo.ticks.map((tick) => {
              const p = value(tick);
              return horizontal ? (
                <line
                  key={tick}
                  x1={p}
                  x2={p}
                  y1={padTop}
                  y2={padTop + innerH}
                  stroke={ROLE.line}
                  strokeWidth={1}
                />
              ) : (
                <line
                  key={tick}
                  x1={padLeft}
                  x2={padLeft + innerW}
                  y1={p}
                  y2={p}
                  stroke={ROLE.line}
                  strokeWidth={1}
                />
              );
            })}

          {/* PASMO OPTIMUM - akcent 10%, etykieta w lewym górnym rogu pasa. */}
          {optimum !== null &&
            (() => {
              const a = value(optimum.min);
              const b = value(optimum.max);
              const label = optimum.demo ? t("band.labelDemo") : t("band.label");
              if (horizontal) {
                const x = Math.min(a, b);
                return (
                  <g className="neh-band" data-role="optimum-band">
                    <rect
                      x={x}
                      y={padTop}
                      width={Math.max(1, Math.abs(b - a))}
                      height={innerH}
                      fill={ROLE.acc}
                      style={{ fillOpacity: 0.1 }}
                    />
                    <text x={x + 6} y={padTop + 12} fontSize={FONT_VALUE} fill={ROLE.accText}>
                      {label}
                    </text>
                  </g>
                );
              }
              const top = Math.min(a, b);
              const h = Math.max(1, Math.abs(b - a));
              return (
                <g className="neh-band" data-role="optimum-band">
                  <rect
                    x={padLeft}
                    y={top}
                    width={innerW}
                    height={h}
                    fill={ROLE.acc}
                    style={{ fillOpacity: 0.1 }}
                  />
                  <text
                    x={padLeft + 6}
                    y={h >= 16 ? top + 12 : top - 4}
                    fontSize={FONT_VALUE}
                    fill={ROLE.accText}
                  >
                    {label}
                  </text>
                </g>
              );
            })()}

          {/* Etykiety osi wartości - tusz trzeci. */}
          {scaleInfo.ticks.map((tick, ti) => {
            const p = value(tick);
            return horizontal ? (
              <text
                key={tick}
                x={p}
                y={padTop + innerH + 16}
                textAnchor="middle"
                fontSize={fontAxis}
                fill={ROLE.ink3}
                className="tabular-nums"
              >
                {tickLabels[ti]}
              </text>
            ) : (
              <text
                key={tick}
                x={padLeft - 8}
                y={p + 3.5}
                textAnchor="end"
                fontSize={fontAxis}
                fill={ROLE.ink3}
                className="tabular-nums"
              >
                {tickLabels[ti]}
              </text>
            );
          })}

          {/* JEDNOSTKA JAKO NAZWA OSI nad osią wartości. */}
          {unit !== "" && (
            <text
              x={horizontal ? padLeft + innerW : PAD_LEFT_EDGE}
              y={padTop - 14}
              textAnchor={horizontal ? "end" : "start"}
              fontSize={fontAxis}
              fill={ROLE.ink3}
              data-role="axis-unit"
            >
              {unit}
            </text>
          )}

          {/* Linia osi kategorii (zero) - linia drugiego stopnia, bez znaczników. */}
          {horizontal ? (
            <line
              x1={zeroPos}
              x2={zeroPos}
              y1={padTop}
              y2={padTop + innerH}
              stroke={ROLE.line2}
              strokeWidth={1}
            />
          ) : (
            <line
              x1={padLeft}
              x2={padLeft + innerW}
              y1={zeroPos}
              y2={zeroPos}
              stroke={ROLE.line2}
              strokeWidth={1}
            />
          )}

          {/* Etykiety kategorii. Poziomo: ucięcie Z PEŁNĄ TREŚCIĄ w `<title>`
              (i w nagłówku tooltipa). Pionowo: plan z drabiny. */}
          {horizontal
            ? config.categories.map((cat, i) => {
                const c = catCenter(i);
                const maxChars = Math.max(
                  6,
                  Math.min(CATEGORY_LABEL_MAX_CHARS, Math.floor(labelColumn / (fontAxis * 0.62))),
                );
                const clipped = cat.length > maxChars;
                return (
                  <text
                    key={i}
                    x={padLeft - 8}
                    y={c + 3.5}
                    textAnchor="end"
                    fontSize={fontAxis}
                    fill={ROLE.ink3}
                  >
                    {clipped ? `${cat.slice(0, maxChars - 1)}…` : cat}
                    {clipped && <title>{cat}</title>}
                  </text>
                );
              })
            : (plan?.visible ?? []).map((i) => {
                const c = catCenter(i);
                const label = plan?.labels[i] ?? config.categories[i];
                const fullLabel = config.categories[i];
                const y = padTop + innerH + 16;
                const rotated = (plan?.rotation ?? 0) !== 0;
                const lines = plan?.mode === "wrapped" ? plan.lines?.[i] : undefined;
                return (
                  <text
                    key={i}
                    x={c}
                    y={y}
                    textAnchor={rotated ? "end" : "middle"}
                    fontSize={fontAxis}
                    fill={ROLE.ink3}
                    transform={rotated ? `rotate(${plan?.rotation} ${c} ${y})` : undefined}
                  >
                    {lines
                      ? lines.map((line, li) => (
                          <tspan key={li} x={c} dy={li === 0 ? 0 : `${WRAP_LINE_EM}em`}>
                            {line}
                          </tspan>
                        ))
                      : label}
                    {label !== fullLabel && <title>{fullLabel}</title>}
                  </text>
                );
              })}

          {/* TŁO KOLUMNY pod kursorem (słupki i mostek) - tusz trzeci 8%, POD
              znacznikami, więc nie dotyka ani jednego piksela danych. */}
          {active !== null && !isLine && (
            <rect
              x={horizontal ? padLeft : catCenter(active) - band / 2}
              y={horizontal ? catCenter(active) - band / 2 : padTop}
              width={horizontal ? innerW : band}
              height={horizontal ? band : innerH}
              fill={ROLE.ink3}
              fillOpacity={0.08}
              pointerEvents="none"
              data-role="column-highlight"
            />
          )}

          {/* ===== Znaczniki ===== */}
          {waterfall
            ? waterfall.steps.map((step, si) => {
                const a = value(step.from);
                const b = value(step.to);
                const center = catCenter(step.index);
                const fill = waterfallFill(step);
                const x = center - barW / 2;
                const y0 = Math.min(a, b);
                const h = Math.abs(b - a);
                const down = step.kind === "step" && step.direction === "down";
                return (
                  <g key={`w${step.index}`}>
                    <path
                      d={barPath(
                        x,
                        y0,
                        barW,
                        Math.max(h, 0.5),
                        BAR_RADIUS,
                        down ? "bottom" : "top",
                      )}
                      fill={fill}
                      style={{
                        ["--neh-i" as string]: si,
                        ["--neh-bar-fill" as string]: fill,
                        ["--neh-bar-token" as string]: fill,
                      }}
                      className={down ? "neh-bar neh-bar-negative" : "neh-bar"}
                      data-role="waterfall-step"
                    />
                    {/* Etykieta wartości na KAŻDYM słupku, zmiany ze znakiem „+". */}
                    <text
                      x={center}
                      y={y0 - 6}
                      textAnchor="middle"
                      fontSize={FONT_VALUE}
                      fill={ROLE.ink2}
                      className="neh-fade neh-value-label tabular-nums"
                    >
                      {step.kind === "step"
                        ? formatSignedValue(step.value, lang, config.unit)
                        : formatChartValue(step.value, lang, config.unit)}
                    </text>
                    {/* Łącznik - słupek wisi na poprzednim, a nie stoi na zerze. */}
                    {si > 0 && step.kind === "step" && (
                      <line
                        x1={catCenter(waterfall.steps[si - 1].index) + barW / 2}
                        x2={center - barW / 2}
                        y1={value(step.direction === "down" ? step.to : step.from)}
                        y2={value(step.direction === "down" ? step.to : step.from)}
                        className="neh-connector"
                      />
                    )}
                  </g>
                );
              })
            : isLine
              ? entries.map((e) => {
                  const s = e.s;
                  // Ciągi punktów rozdzielone lukami - luka MUSI przerwać linię.
                  const runs: LineRun[] = [];
                  let current: LineRun = { points: [], indices: [] };
                  s.values.forEach((v, i) => {
                    if (v === null) {
                      if (current.points.length) runs.push(current);
                      current = { points: [], indices: [] };
                      return;
                    }
                    current.points.push([catCenter(i), value(v)]);
                    current.indices.push(i);
                  });
                  if (current.points.length) runs.push(current);

                  // SAMOTNY POMIAR między lukami rysuje się zawsze - ścieżka
                  // z jednego punktu to dla SVG nic, a próg gęstości nie może
                  // zabrać jedynego nośnika wartości.
                  const samotne = new Set(
                    runs.filter((r) => r.points.length === 1).map((r) => r.indices[0]),
                  );

                  const d = runs
                    .map((run) => pathFromPoints(run.points, smoothing))
                    .filter(Boolean)
                    .join(" ");
                  const areaD =
                    areaOpacity(e) > 0
                      ? runs
                          .map((run) => {
                            const line = pathFromPoints(run.points, smoothing);
                            if (!line) return "";
                            const first = run.points[0];
                            const last = run.points[run.points.length - 1];
                            return `${line} L${last[0].toFixed(1)} ${zeroPos.toFixed(1)} L${first[0].toFixed(1)} ${zeroPos.toFixed(1)} Z`;
                          })
                          .filter(Boolean)
                          .join(" ")
                      : "";
                  // Pasmo niepewności prognozy - PER CIĄG, nie przez lukę.
                  const bandD =
                    forecastFrom !== null && bandPct > 0
                      ? runs
                          .map((run) =>
                            forecastBandPath(
                              run,
                              s.values,
                              forecastFrom,
                              bandPct,
                              catCenter,
                              value,
                              smoothing,
                            ),
                          )
                          .filter(Boolean)
                          .join(" ")
                      : "";
                  const lastIdx = lastNonNullIndex(s.values);
                  const lit = focused === e.index;
                  // PUNKTY: na stałe do 20 punktów, powyżej tylko na aktywnej
                  // kategorii; nigdy w prognozie (tam nie ma pomiarów).
                  const dotIndices = s.values
                    .map((v, i) => (v === null ? -1 : i))
                    .filter(
                      (i) =>
                        i >= 0 &&
                        !(forecastFrom !== null && i >= forecastFrom) &&
                        (showDots || samotne.has(i) || active === i),
                    );
                  return (
                    <g
                      key={`${e.index}-${s.name}`}
                      data-series-group={e.index}
                      data-dimmed={focused !== null && !lit ? "true" : undefined}
                    >
                      {areaD && (
                        <path
                          d={areaD}
                          fill={`url(#${areaGradientId(e.index)})`}
                          className="neh-area"
                          data-role="series-area"
                        />
                      )}
                      {/* Pasmo niepewności prognozy. Krycie z tokena slotu
                          (policzone pod kontrast 1,10-1,17:1 do płyty) w palecie
                          kategorialnej; w palecie ról jedna wartość 12%. */}
                      {bandD && (
                        <path
                          d={bandD}
                          fill={e.paint.color}
                          style={{
                            fillOpacity:
                              config.palette === "categorical"
                                ? `var(--chart-band-${s.colorSlot})`
                                : 0.12,
                          }}
                          className="neh-fade"
                          pointerEvents="none"
                          data-role="forecast-band"
                        />
                      )}
                      <path
                        d={d}
                        fill="none"
                        stroke={e.paint.color}
                        strokeWidth={2}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        // `pathLength` normalizuje długość pod animację
                        // rysowania (dasharray 1), ale SKALUJE TEŻ przerywanie:
                        // „6 4" przy długości 1 to kreska dłuższa od całej linii,
                        // czyli linia ciągła. Linia przerywana nie animuje się
                        // pociągnięciem, więc normalizacji nie dostaje.
                        pathLength={e.paint.dashed ? undefined : 1}
                        className={e.paint.dashed ? "neh-line neh-line-pattern" : "neh-line"}
                        data-role="series-line"
                        data-active={lit ? "true" : undefined}
                      />
                      {dotIndices.map((i) => {
                        const isActive = active === i;
                        return (
                          <path
                            key={i}
                            d={markerPath(
                              e.paint.marker,
                              catCenter(i),
                              value(s.values[i] as number),
                              isActive ? DOT_RADIUS + 1 : DOT_RADIUS,
                            )}
                            fill={e.paint.color}
                            data-active={isActive ? "true" : undefined}
                            data-marker={e.paint.marker}
                            className={isActive && !showDots ? "neh-marker" : "neh-marker neh-fade"}
                            data-role="series-point"
                          />
                        );
                      })}
                      {/* NAZWA SERII PRZY KOŃCU LINII (2-4 serie) albo sama
                          wartość, gdy nazwy niesie legenda. Wariant TEKSTOWY
                          koloru - próg tekstu to 4,5:1. */}
                      {lastIdx >= 0 && (endLabels || config.showValues) && (
                        <text
                          x={catCenter(lastIdx) + 8}
                          y={(endLabelY.get(e.index) ?? value(s.values[lastIdx] as number)) + 4}
                          fontSize={endLabels ? FONT_END_LABEL : FONT_VALUE}
                          fontWeight={endLabels ? 650 : undefined}
                          fill={e.paint.textColor}
                          className={
                            endLabels
                              ? "neh-fade neh-end-label"
                              : "neh-fade neh-value-label tabular-nums"
                          }
                          data-role={endLabels ? "end-label" : undefined}
                        >
                          {endLabels
                            ? endLabelText(e)
                            : formatChartValue(s.values[lastIdx] as number, lang, config.unit)}
                        </text>
                      )}
                    </g>
                  );
                })
              : /* Słupki / kolumny */
                entries.map((e, k) => {
                  const s = e.s;
                  return (
                    <g
                      key={`${e.index}-${s.name}`}
                      data-series-group={e.index}
                      data-dimmed={focused !== null && focused !== e.index ? "true" : undefined}
                    >
                      {s.values.map((v, i) => {
                        const cell = stacks ? stacks[k][i] : null;
                        const from = cell ? cell.from : 0;
                        const to = cell ? cell.to : (v ?? 0);
                        if (v === null || (v === 0 && stacked)) return null;
                        const a = value(from);
                        const b = value(to);
                        // Zaokrąglony koniec tylko dla segmentu domykającego
                        // pas danych o TYM znaku.
                        const isDataEnd =
                          !stacked || k === lastStackIndexFor(series, stacks, i, v >= 0);
                        const center = catCenter(i);
                        const offsetPx = stacked ? -barW / 2 : barOffset(k);
                        const negative = v < 0;
                        const dataEnd = dataEndOf(horizontal, negative);
                        const along = Math.max(0.5, Math.abs(b - a));
                        const shape = horizontal
                          ? barPath(
                              Math.min(a, b),
                              center + offsetPx,
                              along,
                              barW,
                              isDataEnd ? BAR_RADIUS : 0,
                              dataEnd,
                            )
                          : barPath(
                              center + offsetPx,
                              Math.min(a, b),
                              barW,
                              along,
                              isDataEnd ? BAR_RADIUS : 0,
                              dataEnd,
                            );
                        const cls = `${horizontal ? "neh-bar-h neh-bar" : "neh-bar"}${negative ? " neh-bar-negative" : ""}`;
                        // WARTOŚĆ UJEMNA POJEDYNCZEJ SERII w czerwieni - przy
                        // wielu seriach kolor niesie tożsamość serii i ujemność
                        // pokazuje wtedy kierunek słupka od zera.
                        const fill = negative && entries.length === 1 ? ROLE.neg : e.paint.color;
                        return (
                          <Fragment key={i}>
                            <path
                              d={shape}
                              data-role="bar"
                              fill={fill}
                              data-active={active === i ? "true" : undefined}
                              className={cls}
                              style={{
                                ["--neh-i" as string]: i,
                                ["--neh-bar-fill" as string]: fill,
                                ["--neh-bar-token" as string]: e.paint.color,
                                // Prześwit w kolorze płyty między segmentami stosu.
                                ...(stacked
                                  ? {
                                      ["--neh-bar-edge" as string]: "var(--card)",
                                      ["--neh-bar-edge-w" as string]: "1px",
                                    }
                                  : {}),
                              }}
                            />
                            {e.paint.hatched && (
                              <path
                                d={shape}
                                fill={`url(#${barHatchId})`}
                                className={cls}
                                pointerEvents="none"
                                data-role="bar-hatch"
                                style={{ ["--neh-i" as string]: i }}
                              />
                            )}
                          </Fragment>
                        );
                      })}
                      {/* Etykiety nad słupkami - tylko pojedyncza seria,
                          inaczej robi się ściana liczb. */}
                      {config.showValues &&
                        !stacked &&
                        entries.length === 1 &&
                        s.values.map((v, i) =>
                          v === null ? null : horizontal ? (
                            <text
                              key={`l${i}`}
                              x={value(v) + (v >= 0 ? 6 : -6)}
                              y={catCenter(i) + 3.5}
                              textAnchor={v >= 0 ? "start" : "end"}
                              fontSize={FONT_VALUE}
                              fill={ROLE.ink2}
                              className="neh-fade neh-value-label tabular-nums"
                            >
                              {formatChartValue(v, lang, config.unit)}
                            </text>
                          ) : (
                            <text
                              key={`l${i}`}
                              x={catCenter(i)}
                              y={value(v) + (v >= 0 ? -6 : 14)}
                              textAnchor="middle"
                              fontSize={FONT_VALUE}
                              fill={ROLE.ink2}
                              className="neh-fade neh-value-label tabular-nums"
                            >
                              {formatChartValue(v, lang, config.unit)}
                            </text>
                          ),
                        )}
                    </g>
                  );
                })}

          {/* LINIA CELU - przerywana 5 4, 1 px, tusz drugi, etykieta „cel X"
              przy prawym końcu. */}
          {target !== null &&
            (() => {
              const p = value(target.value);
              const label = t("target.label", {
                value: formatChartValue(target.value, lang, config.unit),
              });
              return horizontal ? (
                <g className="neh-target" data-role="target">
                  <line
                    x1={p}
                    x2={p}
                    y1={padTop}
                    y2={padTop + innerH}
                    className="neh-target-line"
                  />
                  <text
                    x={p - 4}
                    y={padTop - 4}
                    textAnchor="end"
                    fontSize={FONT_VALUE}
                    fill={ROLE.ink2}
                  >
                    {label}
                  </text>
                </g>
              ) : (
                <g className="neh-target" data-role="target">
                  <line
                    x1={padLeft}
                    x2={padLeft + innerW}
                    y1={p}
                    y2={p}
                    className="neh-target-line"
                  />
                  <text
                    x={padLeft + innerW}
                    y={p - 5}
                    textAnchor="end"
                    fontSize={FONT_VALUE}
                    fill={ROLE.ink2}
                  >
                    {label}
                  </text>
                </g>
              );
            })()}

          {/* Separator prognozy z etykietą słowną. */}
          {forecastBoundary !== null && !horizontal && (
            <g pointerEvents="none">
              <line
                x1={forecastBoundary}
                x2={forecastBoundary}
                y1={padTop}
                y2={padTop + innerH}
                className="neh-forecast-divider"
              />
              <text x={forecastBoundary + 6} y={padTop + 11} fontSize={fontAxis} fill={ROLE.ink3}>
                {t("forecast.label")}
              </text>
            </g>
          )}

          {/* PROWADNICA pod kursorem - tylko linie i pola. */}
          {active !== null && isLine && (
            <line
              className="neh-crosshair"
              x1={horizontal ? padLeft : catCenter(active)}
              x2={horizontal ? padLeft + innerW : catCenter(active)}
              y1={horizontal ? catCenter(active) : padTop}
              y2={horizontal ? catCenter(active) : padTop + innerH}
            />
          )}

          {/* WARSTWA TRAFIEŃ: cały obszar rysunku. Trafialna jest KATEGORIA,
              nie znacznik; seria rozstrzyga się z geometrii (`seriesAt`).
              DOTYK: stuknięcie pokazuje tooltip, a DRUGIE stuknięcie w tę
              samą kategorię otwiera okno punktu - pierwsze nie może od razu
              zasłonić wykresu oknem. */}
          <rect
            x={padLeft}
            y={padTop}
            width={innerW}
            height={innerH}
            fill="transparent"
            className="neh-hit"
            style={{ cursor: onSelect || onPointClick ? "pointer" : "default" }}
            onPointerDown={(e) => {
              lastPointer.current = e.pointerType;
              const hit = locate(e);
              const repeat = active === hit.index;
              setActiveIndex(hit.index);
              setActiveSeries(hit.seriesIndex);
              if (e.pointerType === "touch" && !repeat && !onSelect) return;
              select(hit.index, hit.seriesIndex);
            }}
            onPointerMove={(e) => {
              const hit = locate(e);
              setActiveIndex(hit.index);
              setActiveSeries(hit.seriesIndex);
            }}
            onPointerLeave={(e) => {
              if (e.pointerType !== "touch") clearActive();
            }}
          />
        </svg>

        <ChartTooltip
          visible={active !== null}
          x={anchor?.x ?? 0}
          y={anchor?.y ?? 0}
          containerWidth={width}
          title={active !== null ? config.categories[active] : ""}
          note={
            forecastFrom !== null && active !== null && active >= forecastFrom
              ? t("forecast.tableFlag")
              : undefined
          }
          rows={tooltipRows}
          facts={tooltipFacts}
          source={sourceLine(t, config)}
        />
      </div>
      {zoom !== null && (
        <div style={{ marginTop: SLIDER_GAP }}>
          <RangeSlider
            x={padLeft}
            width={innerW}
            containerWidth={width}
            total={zoom.total}
            range={zoom.range}
            onChange={zoom.onChange}
            overview={full.series[entries[0]?.index ?? 0]?.values ?? []}
            categories={full.categories}
            labels={{
              group: t("zoom.slider", {
                from: full.categories[zoom.range.start] ?? "",
                to: full.categories[zoom.range.end] ?? "",
              }),
              start: t("zoom.start"),
              end: t("zoom.end"),
              window: t("zoom.window"),
            }}
          />
        </div>
      )}
    </div>
  );
}

/** Kolor kroku mostka: wzrost, spadek, zero albo poziom (suma). */
function waterfallFill(step: { kind: string; direction?: string }): string {
  if (step.kind !== "step") return ROLE.sMain;
  if (step.direction === "down") return ROLE.neg;
  if (step.direction === "flat") return ROLE.sAlt;
  return ROLE.pos;
}

function longest(values: readonly string[]): string {
  let out = "";
  for (const value of values) if (value.length > out.length) out = value;
  return out;
}

function longestValueWidth(
  series: readonly ChartSeries[],
  config: ChartConfig,
  lang: ChartLang,
): number {
  let max = 0;
  for (const s of series) {
    for (const v of s.values) {
      if (v === null) continue;
      max = Math.max(max, estimateLabelWidth(formatChartValue(v, lang, config.unit), FONT_VALUE));
    }
  }
  return max;
}

function lastNonNullIndex(values: readonly (number | null)[]): number {
  for (let i = values.length - 1; i >= 0; i--) {
    if (values[i] !== null) return i;
  }
  return -1;
}

/**
 * Pasmo niepewności prognozy dla JEDNEGO ciągu punktów: obwiednia wartości
 * +/- procent, zamknięta w jedną ścieżkę - per ciąg, żeby nie zamykała luk.
 */
function forecastBandPath(
  run: LineRun,
  values: readonly (number | null)[],
  splitAt: number,
  pct: number,
  catCenter: (i: number) => number,
  value: (v: number) => number,
  smoothing: number,
): string {
  const upper: Point[] = [];
  const lower: Point[] = [];
  const factor = pct / 100;
  for (const i of run.indices) {
    if (i < splitAt - 1) continue;
    const v = values[i];
    if (v === null || v === undefined) continue;
    const x = catCenter(i);
    // Na granicy pasmo ma szerokość ZERO: ostatnia obserwacja jest pomiarem.
    const spread = i === splitAt - 1 ? 0 : Math.abs(v) * factor;
    upper.push([x, value(v + spread)]);
    lower.push([x, value(v - spread)]);
  }
  if (upper.length < 2) return "";
  const top = pathFromPoints(upper, smoothing);
  const bottom = pathFromPoints([...lower].reverse(), smoothing).replace(/^M/, "L");
  return `${top} ${bottom} Z`;
}

/**
 * Indeks serii domykającej pas stacka O DANYM ZNAKU w danej kategorii - pas
 * ujemny ma własny kursor i domyka go ostatnia seria ujemna.
 */
function lastStackIndexFor(
  series: readonly ChartSeries[],
  stacks: ReturnType<typeof stackSeries> | null,
  categoryIndex: number,
  positive: boolean,
): number {
  if (!stacks) return series.length - 1;
  let last = -1;
  for (let si = 0; si < series.length; si++) {
    const v = stacks[si][categoryIndex].value;
    if (v === null || v === 0) continue;
    if (positive ? v > 0 : v < 0) last = si;
  }
  return last;
}
