// Wykres kartezjański (line / area / bar / bar-horizontal / waterfall, plus
// stacked).
//
// DELIKATNOŚĆ - osiem parametrów, każdy z tokena, żaden wymyślony tutaj:
//  - JEDEN promień 6 px (`CHART_RADIUS`) przycięty do połowy krótszego boku,
//    bo bez przycięcia niski słupek zamienia się w owal i zaokrąglenie
//    zaczyna zniekształcać dane; zaokrąglony jest TYLKO koniec z danymi,
//  - grubość linii i rozmiar kropki przez `--chart-stroke` / `--chart-dot`,
//    więc korekta irradiacji w trybie ciemnym dzieje się w CSS,
//  - wygładzanie MONOTONICZNYM Hermite'em (Fritsch-Carlson) o sile 0,55, nie
//    Catmull-Romem, który przestrzeliwuje i rysuje maksima, których nie było,
//  - kropka obserwacji w kolorze PŁYTY z obwódką w kolorze serii - warunek
//    uczciwości wygładzenia; gdy kropki się nie zmieszczą, silnik wyłącza
//    wygładzanie, a nie kropki,
//  - siatka i oś w tokenach o policzonym kontraście (siatka < 1,3:1),
//  - prowadnica, separator i łączniki mostka LINIĄ CIĄGŁĄ 1 px - kreska
//    czyta się jako zaznaczenie, aliasuje na niecałkowitej współrzędnej
//    i konkuruje rytmem z danymi,
//  - odstępy wyłącznie ze skali 4 px,
//  - kaskada animacji z budżetem 500 ms na całość.
//
// MARGINESY LICZONE Z POMIARU, NIE ZGADYWANE. Ucięte etykiety mają jedną
// przyczynę: marginesy ustalono, zanim wiedziano, jak szerokie są etykiety.
// Pomiar `canvas.measureText` wchodzi jednak PO zamontowaniu (patrz
// `useLabelMetrics`), bo w pierwszym przejściu nie ma kanwy ani na serwerze,
// ani w happy-dom - a marginesy policzone różnie po obu stronach rozjechałyby
// hydratację. Render pierwszego przejścia używa więc tej samej heurystyki co
// zawsze i dokładnie tej samej szerokości kontenera (720), czyli geometria
// SSR jest w pełni deterministyczna; drugie malowanie dostaje piksele.
//
// KOLIZJE ETYKIET OSI - drabina z `lib/charts/labels.ts`, nie wielokropek:
// przerzedź (zostawiając PIERWSZĄ I OSTATNIĄ) -> skróć semantycznie -> obróć
// o -45 stopni. Ucięcie z wielokropkiem zostaje wyłącznie przy słupkach
// poziomych, gdzie etykieta ma własny `<title>` z pełną treścią.
//
// Interakcja: crosshair przyciąga do najbliższej kategorii, jeden tooltip
// z wartościami WSZYSTKICH serii; słupki mają hit-target = cała kolumna
// kategorii. Klawiatura: strzałki przesuwają aktywną kategorię, Escape czyści.
// SSR: pełny, statyczny SVG w HTML (interakcja dogrywa się po hydracji).
import {
  Fragment,
  useCallback,
  useId,
  useMemo,
  useState,
  type KeyboardEvent,
  type PointerEvent,
} from "react";
import { useTranslation } from "react-i18next";
import type { ChartConfig, ChartSeries } from "@/lib/charts/types";
import { CATEGORICAL_SAFE_SERIES } from "@/lib/charts/types";
import { barStyleHasEdge, resolveBarStyle, type BarStyle } from "@/lib/charts/palette";
import {
  forecastBandExtent,
  linearScale,
  niceScale,
  seriesExtent,
  stackSeries,
} from "@/lib/charts/scale";
import { formatAxisTick, formatChartValue, type ChartLang } from "@/lib/charts/format";
import {
  BAR_EDGE_INSET,
  BAR_GAP,
  BAR_MAX,
  CATEGORY_LABEL_MAX_CHARS,
  CATEGORY_LABEL_MAX_WIDTH,
  CHART_RADIUS,
  FONT_AXIS,
  MIN_INNER_H,
  MIN_INNER_W,
  PAD_BOTTOM,
  PAD_LEFT_CATEGORY_MIN,
  PAD_LEFT_MIN,
  PAD_SIDE,
  PAD_TOP,
  PAD_TOP_WITH_LABELS,
  cascadeStepMs,
  clampBarRadius,
  clampRadius,
  effectiveSmoothing,
  shouldShowDots,
  snapToGrid,
  valueTickTarget,
} from "@/lib/charts/geometry";
import { bandIndex, nearestPointIndex, pointerToPlot } from "@/lib/charts/plot";
import { SMOOTHING_MIN_POINTS, pathFromPoints, type Point } from "@/lib/charts/smooth";
import { estimateLabelWidth, useLabelMetrics } from "@/lib/charts/measureText";
import { WRAP_LINE_EM, planCategoryLabels, type CategoryLabelPlan } from "@/lib/charts/labels";
import { waterfallExtent, waterfallModel } from "@/lib/charts/waterfall";
import { useContainerWidth } from "@/hooks/useContainerWidth";
import { useTapAwayDismiss } from "@/hooks/useTapAwayDismiss";
import { useRevealOnScroll, revealClassName } from "@/hooks/useRevealOnScroll";
import { ChartTooltip, type TooltipRow } from "./ChartTooltip";
import "@/lib/i18n-charts";

interface CartesianChartProps {
  config: ChartConfig;
  lang: ChartLang;
}

/** Pozycja kotwicy tooltipa w px kontenera - liczona z indeksu przy renderze. */
interface Anchor {
  x: number;
  y: number;
}

/**
 * Ciąg punktów linii bez luk, RAZEM z indeksami kategorii, z których powstał.
 *
 * Indeksy jadą obok pikseli, bo inaczej nie da się powiedzieć, które punkty
 * ciągu są prognozą. Odtwarzanie indeksu z pozycji w ciągu (numer punktu w
 * liście wszystkich niepustych wartości serii) myli się o tyle pozycji, ile
 * luk wystąpiło wcześniej - i przy serii z jedną dziurą prognoza obejmowała
 * nie te kategorie, a przy dziurze przed granicą znikała w całości, chociaż
 * separator "Prognoza" nadal był rysowany.
 */
interface LineRun {
  points: Point[];
  indices: number[];
}

function seriesColor(s: ChartSeries): string {
  return `var(--chart-${s.colorSlot})`;
}

/**
 * Wariant TEKSTOWY slotu. Etykieta bezpośrednia identyfikuje serię, więc musi
 * być w jej kolorze - ale kolorem LINII nie wolno pisać, bo próg kontrastu dla
 * tekstu to 4,5:1, a dla linii 3,0:1. Ochra jako linia jest w porządku, jako
 * napis nie.
 */
function seriesTextColor(s: ChartSeries): string {
  return `var(--chart-${s.colorSlot}t)`;
}

/**
 * Czy seria potrzebuje kreskowania jako DRUGIEGO nośnika różnicy. Sloty poza
 * zestawem bezpiecznym dla daltonizmu (7-8) są od slotów 1-2 oddalone o ~10-12
 * jednostek CIELAB po symulacji - za mało, żeby sam odcień je odróżnił.
 */
function needsPattern(s: ChartSeries): boolean {
  return s.colorSlot > CATEGORICAL_SAFE_SERIES;
}

/** Prostokąt z zaokrąglonym wyłącznie końcem danych. */
/** Koniec DANYCH słupka - ten, który wolno zaokrąglić. */
type DataEnd = "top" | "bottom" | "left" | "right" | "none";

/**
 * Koniec danych wynika ze ZNAKU WARTOŚCI, nie z pionu.
 *
 * Kwadratowa podstawa i najgłębszy stopień wypełnienia siedzą przy krawędzi
 * odniesienia, zaokrąglony koniec i najjaśniejszy stopień na końcu danych. Dla
 * słupka ujemnego końcem danych jest dół (albo lewa strona przy słupkach
 * poziomych), więc odwraca się i wypełnienie, i zaokrąglenie. Kierunek
 * biegnący wbrew znakowi wartości jest błędem tej samej klasy co ucięta oś,
 * dlatego oba wynikają tu z JEDNEJ wartości, a nie z dwóch niezależnych
 * gałęzi, które mogą się rozjechać.
 */
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
  bordered = true,
): string {
  // Wzdłuż osi wartości mieści się JEDEN promień (słupek jest zaokrąglony
  // z jednej strony), więc przycięcie idzie przez `clampBarRadius`, a nie
  // przez `clampRadius` dla kształtów czterostronnych. `bordered` rozstrzyga,
  // czy granicę niesie obwódka (wtedy wystarcza granica wykonalności) czy
  // sama masa wypełnienia (wtedy wraca podłoga połowy długości).
  const alongValue = roundedEnd === "left" || roundedEnd === "right";
  const r = radius === 0 ? 0 : clampBarRadius(alongValue ? h : w, alongValue ? w : h, { bordered });
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

export function CartesianChart({ config, lang }: CartesianChartProps) {
  // `keyPrefix` zamiast sklejania klucza w szablonie, i to nie jest kosmetyka:
  // bramka rozjazdu kod<->słownik (`src/lib/ci/i18nKeyUsage.ts`) rozumie
  // WYŁĄCZNIE prefiks podany hakowi. Klucz zlepiony template literalem jest
  // dla niej napisem `waterfall.start`, którego w słowniku nie ma - więc
  // wszystkie klucze tego pliku wypadałyby z kontroli parytetu PL/EN.
  const { t: scoped } = useTranslation("translation", { keyPrefix: "charts" });
  const t = (key: string, values?: Record<string, string | number>): string =>
    scoped(key, { lng: lang, ...values });
  const { ref: widthRef, width } = useContainerWidth<HTMLDivElement>(720);
  const { ref: revealRef, state: revealState } = useRevealOnScroll<HTMLDivElement>(config.animate);
  // W stanie siedzi WYŁĄCZNIE indeks kategorii, a nie gotowa kotwica: piksele
  // zależą od geometrii, a ta zmienia się z każdą podmianą configu.
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  // Stabilna referencja - hak zdejmujący stan tapnięciem trzyma ją jako
  // zależność efektu, a nowa funkcja przy każdym renderze przepisywałaby
  // nasłuch na dokumencie przy każdym ruchu wskaźnika.
  const clearActive = useCallback(() => setActiveIndex(null), []);
  // Tapnięcie poza wykresem zdejmuje wskazanie. Nasłuch tylko przy ustawionym
  // stanie, więc na wykresie bez interakcji nie ma go wcale. Stoi tu, PRZED
  // wyjściem na pustym zestawie: hak wywołany po `return null` łamałby
  // kolejność haków między renderami.
  useTapAwayDismiss(activeIndex !== null, widthRef, clearActive);
  // Identyfikator definicji SVG tego wykresu (wzór kreskowania, gradienty).
  // `useId` zamiast stałego napisu,
  // bo na jednej stronie stoi wiele wykresów, a `url(#id)` w SVG wiąże się
  // z PIERWSZYM elementem o tym id w dokumencie - dwa wykresy na jednej
  // stronie dzieliłyby wtedy jedną definicję, wziętą z tego pierwszego.
  // Dwukropki lecą, bo React wstawia je w id, a fragmentu `url(#a:b:c)`
  // część przeglądarek nie przechodzi.
  //
  // Hak stoi TUTAJ, a nie przy budowie masek, bo poniżej jest wczesny `return`
  // dla wykresu bez danych - hak wywołany po nim łamałby regułę stałej
  // kolejności haków między renderami.
  const uid = useId().replace(/:/g, "");

  const horizontal = config.kind === "bar-horizontal";
  const isLine = config.kind === "line" || config.kind === "area";
  const isWaterfall = config.kind === "waterfall";
  const n = config.categories.length;
  // useMemo: stała tożsamość tablicy - bez niej geometry przeliczałoby się
  // przy KAŻDYM renderze (a pointermove renderuje przy każdym ruchu myszy).
  const series = useMemo(
    () => config.series.filter((s) => s.values.some((v) => v !== null)),
    [config.series],
  );
  const stacked = config.stacked && !isLine && !isWaterfall && series.length > 1;
  const height = config.height;

  // Mostek czyta WYŁĄCZNIE pierwszą serię: nie da się dodać dwóch dekompozycji
  // tej samej różnicy, więc druga seria na wodospadzie jest zawsze pomyłką.
  const waterfall = useMemo(
    () => (isWaterfall ? waterfallModel(config.categories, config.series[0]?.values ?? []) : null),
    [isWaterfall, config.categories, config.series],
  );

  // ---- Granica prognozy. Stoi PONAD skalą, bo pasmo niepewności wchodzi
  // do domeny osi: indeks 0 nie ma sensu (cała seria byłaby prognozą, czyli
  // podział nic nie dzieli), indeks >= n też nie (nie ma czego oznaczyć).
  const forecastFrom =
    config.forecastFrom !== null && config.forecastFrom > 0 && config.forecastFrom < n
      ? config.forecastFrom
      : null;
  // Szerokość pasma ma znaczenie TYLKO przy istniejącej granicy i tylko na
  // linii - kolumny nie mają czego obwijać obwiednią.
  const bandPct = forecastFrom !== null && isLine ? config.forecastBandPct : 0;

  // ---- Skala wartości. Zależy WYŁĄCZNIE od danych i wysokości, nie od
  // marginesów - dzięki temu etykiety podziałek są znane przed pomiarem
  // tekstu i nie ma tu zależności cyklicznej.
  const scaleInfo = useMemo(() => {
    const extent = waterfall
      ? waterfallExtent(waterfall)
      : seriesExtent(series, n, { stacked, includeZero: !isLine });
    // Pasmo prognozy WCHODZI DO DOMENY. Bez tego obwiednia +/- procent
    // wychodziła ponad najwyższą podziałkę i była przycinana krawędzią
    // rysunku, czyli wykres pokazywał niepewność jako kończącą się tam,
    // gdzie kończy się obszar kreślenia.
    const band = forecastBandExtent(series, forecastFrom, bandPct);
    const min = band ? Math.min(extent.min, band.min) : extent.min;
    const max = band ? Math.max(extent.max, band.max) : extent.max;
    return niceScale(min, max, valueTickTarget(height, horizontal));
  }, [waterfall, series, n, stacked, isLine, horizontal, height, forecastFrom, bandPct]);

  const tickLabels = useMemo(
    () => scaleInfo.ticks.map((tick) => formatAxisTick(tick, lang)),
    [scaleInfo, lang],
  );

  // Pomiar POST-MOUNT. `null` w pierwszym przejściu (serwer, pierwszy render
  // klienta, happy-dom) - wtedy marginesy liczy heurystyka.
  const metrics = useLabelMetrics(tickLabels, config.categories, FONT_AXIS);

  const geometry = useMemo(() => {
    // Szerokość etykiety: zmierzona, gdy pomiar wyszedł; heurystyka, gdy nie.
    // `Math.max` z heurystyką NIE jest tu potrzebny - pomiar jest dokładniejszy
    // w obie strony i sztuczna podłoga zostawiałaby puste marginesy.
    const tickWidth = metrics.value ?? estimateLabelWidth(longest(tickLabels), FONT_AXIS);
    const catWidth = metrics.category ?? estimateLabelWidth(longest(config.categories), FONT_AXIS);

    // Etykiety bezpośrednie nie mogą wypadać poza rysunek: koniec linii
    // i szczyt poziomego słupka dostają dodatkowy prawy margines, kolumny -
    // górny (zamiast przycinania, którego spec zakazuje).
    const valueLabelW = config.showValues ? longestValueWidth(series, config, lang) + 10 : 0;

    const padTop = !isLine && !horizontal && config.showValues ? PAD_TOP_WITH_LABELS : PAD_TOP;
    const padRight =
      config.showValues && (isLine || horizontal) ? Math.max(PAD_SIDE, valueLabelW) : PAD_SIDE;
    const padLeft = horizontal
      ? Math.min(CATEGORY_LABEL_MAX_WIDTH, Math.max(PAD_LEFT_CATEGORY_MIN, catWidth + PAD_SIDE))
      : Math.max(PAD_LEFT_MIN, tickWidth + PAD_SIDE);

    // Drabina etykiet osi kategorii. Potrzebuje szerokości pasma, a pasmo
    // zależy TYLKO od marginesów bocznych, więc jedno przejście wystarcza -
    // margines dolny nie wchodzi do tego rachunku.
    const measureLabel = (text: string): number =>
      metrics.category !== null && text === longest(config.categories)
        ? metrics.category
        : estimateLabelWidth(text, FONT_AXIS);

    // BUDŻET NA MARGINES DOLNY. Obrócone etykiety potrafią zażądać więcej,
    // niż wykres ma wysokości; wcześniej ta nadwyżka po prostu przepadała
    // (obszar kreślenia siadał na swojej podłodze, a `padBottom` wracał
    // z memo niewykorzystany), więc napisy schodziły z płótna na podpis pod
    // wykresem. Teraz limit idzie DO DRABINY: nie mieści się obrót - drabina
    // wybiera szczebel, który się mieści, i nikt nie rysuje poza kartą.
    const bottomBudget = Math.max(PAD_BOTTOM, height - padTop - MIN_INNER_H);

    const planFor = (): { plan: CategoryLabelPlan; padBottom: number } => {
      const innerWidth = Math.max(MIN_INNER_W, width - padLeft - padRight);
      const slot = n > 0 ? innerWidth / (isLine && n > 1 ? Math.max(1, n - 1) : n) : innerWidth;
      const plan = planCategoryLabels(config.categories, {
        slotWidth: slot,
        fontSize: FONT_AXIS,
        measure: measureLabel,
        maxBottomSpace: bottomBudget,
      });
      return { plan, padBottom: Math.max(PAD_BOTTOM, snapToGrid(plan.bottomSpace)) };
    };

    // Słupki poziome mają etykiety kategorii po lewej, więc drabina ich nie
    // dotyczy - tam kolizji w poziomie nie ma z definicji.
    const ladder = horizontal ? null : planFor();
    // Zaokrąglenie do siatki 4 px mogło jeszcze przekroczyć budżet o kilka
    // pikseli, więc domykamy go tutaj: po tej klamrze różnica
    // `height - padTop - padBottom` NIGDY nie schodzi pod podłogę, czyli
    // `Math.max` poniżej nie ma już czego ratować - i nie ma jak zjeść
    // zarezerwowanego miejsca.
    const padBottom = horizontal
      ? PAD_BOTTOM
      : Math.min(bottomBudget, ladder?.padBottom ?? PAD_BOTTOM);

    const innerW = Math.max(MIN_INNER_W, width - padLeft - padRight);
    const innerH = Math.max(MIN_INNER_H, height - padTop - padBottom);

    // Skala wartości: pion (bar/line/waterfall) lub poziom (bar-horizontal).
    const value = horizontal
      ? linearScale(scaleInfo.min, scaleInfo.max, padLeft, padLeft + innerW)
      : linearScale(scaleInfo.min, scaleInfo.max, padTop + innerH, padTop);

    // Skala kategorii: band (bary) / punkty (linie).
    const catSpan = horizontal ? innerH : innerW;
    const catStart = horizontal ? padTop : padLeft;
    const band = n > 0 ? catSpan / n : catSpan;
    const catCenter = (i: number): number =>
      isLine && n > 1 ? catStart + (catSpan * i) / (n - 1) : catStart + band * (i + 0.5);

    // Odstęp między punktami decyduje, czy kropki obserwacji się zmieszczą,
    // a od tego zależy, czy WOLNO wygładzać.
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
      plan: ladder?.plan ?? null,
    };
  }, [
    metrics,
    tickLabels,
    series,
    n,
    stacked,
    isLine,
    horizontal,
    height,
    width,
    lang,
    scaleInfo,
    config,
  ]);

  if (n === 0 || (series.length === 0 && !waterfall)) return null;

  const { padTop, padLeft, innerW, innerH, value, band, catCenter, stacks, smoothing, plan } =
    geometry;
  const zeroPos = value(Math.max(scaleInfo.min, Math.min(0, scaleInfo.max)));
  const showDots = shouldShowDots(n, smoothing);

  // ---- Prognoza: granica w pikselach, strefa i separator. ----
  // Granica biegnie POŚRODKU między ostatnią obserwacją i pierwszą prognozą,
  // a nie na pierwszej prognozie: pomiar z tamtej kategorii jest nadal
  // pomiarem, więc separator nie może przez niego przechodzić.
  const forecastBoundary =
    forecastFrom === null
      ? null
      : isLine
        ? (catCenter(forecastFrom - 1) + catCenter(forecastFrom)) / 2
        : catCenter(forecastFrom) - band / 2;

  // ---- Interakcja: wspólny "najbliższy indeks kategorii". ----
  //
  // ARYTMETYKA STOI W `lib/charts/plot.ts`, nie tutaj. Była domknięciem w tym
  // pliku i umiała dokładnie jedno: czytać JEDNĄ współrzędną i zwracać JEDEN
  // indeks kategorii. To wystarcza linii, słupkom i mostkowi, ale nie mapie
  // ciepła (adres to para wiersz-kolumna), nie punktowemu (najbliższy punkt
  // zależy od obu współrzędnych) i nie beeswarmowi (na jednej pozycji osi
  // leży wiele punktów). Wyprowadzenie daje jedną implementację dla
  // wszystkich rodzajów i - co ważniejsze - pozwala sprawdzić przypadki
  // graniczne bez renderowania wykresu.
  //
  // `null` z `pointerToPlot` znaczy "element niezmierzony" i wraca tu jako
  // pierwsza kategoria, bo w tym wykresie każde pasmo należy do jakiegoś
  // słupka; mapa ciepła zrobi z tym `null` co innego (nie pokaże komórki).
  const indexFromPointer = (e: PointerEvent<SVGRectElement>): number => {
    const point = pointerToPlot(
      e.clientX,
      e.clientY,
      e.currentTarget.getBoundingClientRect(),
      innerW,
      innerH,
    );
    if (point === null) return 0;
    const alongAxis = horizontal ? point.y : point.x;
    return isLine && n > 1
      ? nearestPointIndex(alongAxis, horizontal ? innerH : innerW, n)
      : bandIndex(alongAxis, band, n);
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

  // Klamra na indeksie: aktywna kategoria przeżywa podmianę configu (to ten
  // sam, żywy komponent), a nowy zestaw bywa KRÓTSZY. Bez klamry indeks
  // wskazywałby poza tablicę, a tooltip czytałby wartość z niczego.
  const active = activeIndex === null ? null : Math.max(0, Math.min(n - 1, activeIndex));
  const anchor = active === null ? null : anchorFor(active);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const forwardKey = horizontal ? "ArrowDown" : "ArrowRight";
    const backKey = horizontal ? "ArrowUp" : "ArrowLeft";
    if (e.key === forwardKey || e.key === backKey) {
      e.preventDefault();
      const delta = e.key === forwardKey ? 1 : -1;
      const next = active === null ? 0 : Math.max(0, Math.min(n - 1, active + delta));
      setActiveIndex(next);
    } else if (e.key === "Escape" || e.key === "Tab") {
      setActiveIndex(null);
    }
  };

  // Etykiety końców linii z prostym rozsuwaniem kolizji: zbieżne serie nie
  // mogą nakładać etykiet (spec: nigdy nie przycinaj, nie nakładaj).
  const endLabelYBySeries = new Map<number, number>();
  if (isLine && config.showValues) {
    const raw = series
      .map((s, si) => {
        const idx = lastNonNullIndex(s.values);
        return idx >= 0 ? { si, y: value(s.values[idx] as number) } : null;
      })
      .filter((x): x is { si: number; y: number } => x !== null)
      .sort((a, b) => a.y - b.y);
    const MIN_GAP = 13;
    for (let i = 0; i < raw.length; i++) {
      if (i > 0 && raw[i].y < raw[i - 1].y + MIN_GAP)
        raw[i] = { ...raw[i], y: raw[i - 1].y + MIN_GAP };
    }
    for (const item of raw) endLabelYBySeries.set(item.si, item.y);
  }

  const tooltipRows: TooltipRow[] =
    active === null
      ? []
      : waterfall
        ? waterfall.steps
            .filter((s) => s.index === active)
            .map((s) => ({
              // TRZY KIERUNKI, NIE DWA. Model zwraca `flat` dla wkładu
              // dokładnie zerowego, a ta gałąź sprawdzała wyłącznie `down`,
              // więc składnik, który nic nie zmienił, dostawał w dymku
              // podpis "Wzrost". To nie jest nieporadność nazewnicza, to
              // nieprawda o danych: w mostku dekompozycji pozycja, która się
              // nie ruszyła, jest osobną informacją.
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
              colorSlot: null,
              value: formatChartValue(s.value, lang, config.unit),
            }))
        : series
            .map((s) => ({
              name: s.name,
              colorSlot: s.colorSlot as number | null,
              raw: s.values[active],
            }))
            .filter((r) => r.raw !== null)
            // SORTOWANIE MALEJĄCO PO WARTOŚCI, nie w kolejności definicji.
            // Czytelnik porównuje wtedy dokładnie to, co widzi na prowadnicy:
            // kolejność wiersza w dymku odpowiada kolejności serii w pionie.
            // Kolejność definicji jest wobec danych przypadkowa i zmusza do
            // wodzenia wzrokiem tam i z powrotem między dymkiem i wykresem.
            .sort((a, b) => (b.raw as number) - (a.raw as number))
            .map((r, index) => ({
              name: r.name,
              colorSlot: r.colorSlot,
              value: formatChartValue(r.raw as number, lang, config.unit),
              // Najwyższa wartość na tej prowadnicy jest tą, na której oko
              // stoi - i tylko ona dostaje mocniejszą wagę pisma. Wyróżnianie
              // tłem wiersza wprowadziłoby do dymka drugą powierzchnię
              // konkurującą z próbką koloru.
              emphasised: index === 0 && series.length > 1,
            }));

  const barRadius = CHART_RADIUS;
  const groupCount = stacked || waterfall ? 1 : series.length;
  const slotW = Math.max(2, (band * 0.72) / groupCount);
  const barW = Math.min(BAR_MAX, slotW - (groupCount > 1 ? BAR_GAP : 0));
  const cascade = cascadeStepMs(waterfall ? waterfall.steps.length : n);

  const ariaLabel = config.title
    ? t("a11y.chart", { title: config.title })
    : t("a11y.chartUntitled");

  const hatchId = `neh-hatch-${uid}`;
  const zoneHatchId = `neh-zone-hatch-${uid}`;
  const hintId = `neh-hint-${uid}`;
  /**
   * WARIANT WYPEŁNIENIA, rozstrzygnięty RAZ dla całego wykresu.
   *
   * Nie per słupek, i to jest istotne: dwa warianty na jednym wykresie
   * znaczyłyby, że wnętrze raz niesie kolor serii, a raz nie - czyli
   * czytelnik musiałby wiedzieć, którą regułą czytać który słupek.
   * `resolveBarStyle` schodzi do solidnego wszędzie, gdzie blade wnętrze
   * przestaje wystarczać (kilka serii, stos, slot poza zestawem bezpiecznym).
   */
  const barStyle: BarStyle = resolveBarStyle(config.barStyle, {
    seriesCount: series.length,
    stacked,
    patterned: series.some(needsPattern),
  });
  const edged = barStyleHasEdge(barStyle);
  /**
   * Gradient jest PER SŁUPEK (`objectBoundingBox`), nie globalny. Zakotwiczenie
   * globalne sprawiłoby, że niski słupek kończy się w połowie rampy i kolor
   * zaczyna redundantnie kodować wysokość - a tego dane nie mówią. Definicja
   * jest za to jedna na (slot, kierunek): kierunek rampy idzie za ZNAKIEM
   * wartości, więc słupek ujemny potrzebuje odwróconego wektora.
   */
  const gradientId = (slot: number, end: DataEnd): string => `neh-g-${uid}-${slot}-${end}`;
  const gradientVector = (end: DataEnd): { x1: number; y1: number; x2: number; y2: number } => {
    switch (end) {
      case "top":
        return { x1: 0, y1: 1, x2: 0, y2: 0 };
      case "bottom":
        return { x1: 0, y1: 0, x2: 0, y2: 1 };
      case "right":
        return { x1: 0, y1: 0, x2: 1, y2: 0 };
      default:
        return { x1: 1, y1: 0, x2: 0, y2: 0 };
    }
  };
  // Definicje potrzebne tylko wtedy, gdy wariant naprawdę ich używa - jeden
  // `<defs>` na wykres bez gradientu byłby czystym kosztem.
  const gradientDefs =
    barStyle === "gradient"
      ? series.flatMap((s) =>
          (horizontal ? (["right", "left"] as const) : (["top", "bottom"] as const)).map((end) => ({
            slot: s.colorSlot,
            end: end as DataEnd,
          })),
        )
      : [];
  // Czy KTÓRAKOLWIEK seria słupkowa potrzebuje kreskowania. Legenda znaczy
  // sloty poza zestawem bezpiecznym dla daltonizmu (7-8) próbką w paski, bo ich
  // odcień jest od slotów 1-2 oddalony o ~10-12 jednostek CIELAB po symulacji -
  // za mało, żeby sam kolor je odróżnił. Linia dostaje na to `neh-line-pattern`
  // z arkusza, ale słupka nie da się zakreskować `stroke-dasharray`: różnicę
  // niesie jego WYPEŁNIENIE. Bez tego wzoru legenda pokazywała podział, którego
  // w rysunku nie ma - a klucz obiecujący różnicę nieobecną w danych jest
  // gorszy od klucza bez niej.
  const barsNeedHatch = !isLine && !waterfall && series.some(needsPattern);

  return (
    <div ref={revealRef} className={revealClassName(revealState)}>
      <div
        ref={widthRef}
        className="neh-canvas relative w-full select-none"
        style={{
          height,
          borderRadius: "var(--chart-radius)",
          ["--neh-step" as string]: `${cascade}ms`,
        }}
        tabIndex={0}
        role="img"
        aria-label={ariaLabel}
        // PODPOWIEDŹ KLAWIATURY jako opis, nie jako nazwa. Nawigacja
        // strzałkami po kategoriach jest jedynym sposobem odczytania wartości
        // bez wskaźnika, a nic o niej nie mówiło - klucz słownika istniał
        // i nie był używany, czyli funkcja była dostępna wyłącznie dla kogoś,
        // kto się jej domyślił. `aria-describedby`, bo to instrukcja, a nie
        // nazwa obiektu: nazwa mówi, CO to jest, opis - jak tego użyć.
        aria-describedby={hintId}
        onKeyDown={onKeyDown}
        onBlur={() => setActiveIndex(null)}
      >
        <span id={hintId} className="sr-only">
          {t("a11y.keyboardHint")}
        </span>
        <svg width={width} height={height} className="block overflow-visible">
          {/* Wzór kreskowania słupków. Paski w kolorze PŁYTY, nie serii, więc
              jedna definicja obsługuje każdy slot: nakładka odsłania płytę
              w przerwach, dając ten sam efekt, co próbka legendy
              (`repeating-linear-gradient`). Rytm 5/3 px jest wzięty z tej
              próbki, żeby klucz i znacznik miały ten sam wzór. */}
          {gradientDefs.length > 0 && (
            <defs>
              {gradientDefs.map(({ slot, end }) => {
                const v = gradientVector(end);
                return (
                  <linearGradient
                    key={`${slot}-${end}`}
                    id={gradientId(slot, end)}
                    x1={v.x1}
                    y1={v.y1}
                    x2={v.x2}
                    y2={v.y2}
                  >
                    {/* Stopień ŚRODKOWY nie jest ozdobą: SVG interpoluje
                        gradient w sRGB, więc dwustopniowa rampa między
                        stopniami policzonymi w OKLCh nie idzie ścieżką OKLCh
                        i w połowie robi się przygaszona. Ten stop prostuje
                        większość tej deformacji i to on odpowiada za to, że
                        wnętrze czyta się jako gradient, a nie jako dwa kolory
                        z rozmyciem. */}
                    <stop offset="0" stopColor={`var(--chart-${slot}-deep)`} />
                    <stop offset="0.5" stopColor={`var(--chart-${slot}-mid)`} />
                    <stop offset="1" stopColor={`var(--chart-${slot}-face)`} />
                  </linearGradient>
                );
              })}
            </defs>
          )}

          {barsNeedHatch && (
            <defs>
              <pattern id={hatchId} width="8" height="8" patternUnits="userSpaceOnUse">
                <rect x="5" y="0" width="3" height="8" fill="var(--card)" />
              </pattern>
            </defs>
          )}

          {/* STREFA PROGNOZY - DWA WARIANTY TEJ SAMEJ POWIERZCHNI.
          
              Na ekranie: prostokąt w kolorze tuszu przy kilku promilach krycia
              (1,7-2,2%, kontrast do płyty ~1,04:1). Recesywny dokładnie tak,
              jak ma być - strefa mówi "tu jest prognoza", a nie "patrz tutaj".
              
              W DRUKU: ukośne kreskowanie 45 stopni. Płaski tint tej gęstości
              znika w skali szarości i na papierze - 2% szarości nie ma czym
              się odbić od bieli - a wtedy prognoza traci JEDEN Z TRZECH
              nośników odróżnienia od historii i zostaje z pasmem oraz
              separatorem. Kreskowanie zostaje, bo linia ma krawędź. To jedyne
              miejsce w całym silniku, gdzie tekstura jest uzasadniona, i
              jedyna dozwolona nieciągłość: kreskowanie jest tu WYPEŁNIENIEM
              OBSZARU, nie linią rusztowania.
              
              Oba prostokąty są w drzewie zawsze, a przełącza je arkusz
              (`.neh-zone-tint` / `.neh-zone-hatch` w `@media print`). Nie da
              się tego zrobić inaczej: identyfikator wzoru jest unikalny per
              instancja wykresu, więc CSS nie umie go wskazać w `fill`.
              
              Rysowane PRZED siatką, żeby siatka pozostała czytelna w strefie. */}
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
                    // Kolor i krycie w `style`, nie w atrybutach: `var()`
                    // w atrybutach prezentacyjnych SVG nie jest wspierane
                    // wszędzie, a nierozwiązany `stroke` to czerń.
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
                // Krycie w `style`, NIE w atrybucie prezentacyjnym: `var()`
                // w atrybutach SVG nie jest wspierane wszędzie, a nierozwiązane
                // krycie to pełna nieprzezroczystość, czyli plama na całej
                // strefie prognozy. To ten sam powód, dla którego
                // mapa-choropleta podaje `fill` w `style`.
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

          {/* Siatka + podziałki osi wartości */}
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
                  stroke="var(--chart-grid)"
                  strokeWidth={1}
                />
              ) : (
                <line
                  key={tick}
                  x1={padLeft}
                  x2={padLeft + innerW}
                  y1={p}
                  y2={p}
                  stroke="var(--chart-grid)"
                  strokeWidth={1}
                />
              );
            })}

          {/* Etykiety osi wartości */}
          {scaleInfo.ticks.map((tick, ti) => {
            const p = value(tick);
            return horizontal ? (
              <text
                key={tick}
                x={p}
                y={padTop + innerH + 16}
                textAnchor="middle"
                fontSize={FONT_AXIS}
                fill="var(--muted-foreground)"
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
                fontSize={FONT_AXIS}
                fill="var(--muted-foreground)"
                className="tabular-nums"
              >
                {tickLabels[ti]}
              </text>
            );
          })}

          {/* Oś bazowa (zero) */}
          {horizontal ? (
            <line
              x1={zeroPos}
              x2={zeroPos}
              y1={padTop}
              y2={padTop + innerH}
              stroke="var(--chart-axis)"
              strokeWidth={1}
            />
          ) : (
            <line
              x1={padLeft}
              x2={padLeft + innerW}
              y1={zeroPos}
              y2={zeroPos}
              stroke="var(--chart-axis)"
              strokeWidth={1}
            />
          )}

          {/* Etykiety kategorii. Poziomo: ucięcie po 24 znakach, ale z pełną
              treścią w `<title>` - wielokropek bez tooltipa jest zakazany.
              Pionowo: plan z drabiny (przerzedzenie, skrót, obrót). */}
          {horizontal
            ? config.categories.map((cat, i) => {
                const c = catCenter(i);
                const clipped = cat.length > CATEGORY_LABEL_MAX_CHARS;
                return (
                  <text
                    key={i}
                    x={padLeft - 8}
                    y={c + 3.5}
                    textAnchor="end"
                    fontSize={FONT_AXIS}
                    fill="var(--muted-foreground)"
                  >
                    {clipped ? `${cat.slice(0, CATEGORY_LABEL_MAX_CHARS - 1)}…` : cat}
                    {clipped && <title>{cat}</title>}
                  </text>
                );
              })
            : (plan?.visible ?? []).map((i) => {
                const c = catCenter(i);
                const label = plan?.labels[i] ?? config.categories[i];
                const full = config.categories[i];
                const y = padTop + innerH + 16;
                const rotated = (plan?.rotation ?? 0) !== 0;
                // SZCZEBEL ZAWINIĘCIA. Linie idą `<tspan>`ami z odstępem
                // 1,2 em - pierwszy bez `dy`, kolejne z odstępem, więc blok
                // rośnie w dół od tej samej linii bazowej, na której stoją
                // etykiety niezawinięte. Wysokość, jaką ten blok zajmuje,
                // policzyła już drabina (`bottomSpace`), więc margines pod
                // osią jest na niego przygotowany.
                const lines = plan?.mode === "wrapped" ? plan.lines?.[i] : undefined;
                return (
                  <text
                    key={i}
                    x={c}
                    y={y}
                    textAnchor={rotated ? "end" : "middle"}
                    fontSize={FONT_AXIS}
                    fill="var(--muted-foreground)"
                    transform={rotated ? `rotate(${plan?.rotation} ${c} ${y})` : undefined}
                  >
                    {lines
                      ? lines.map((line, li) => (
                          <tspan key={li} x={c} dy={li === 0 ? 0 : `${WRAP_LINE_EM}em`}>
                            {line}
                          </tspan>
                        ))
                      : label}
                    {label !== full && <title>{full}</title>}
                  </text>
                );
              })}

          {/* PODŚWIETLENIE PASA KATEGORII - POD ZNACZNIKAMI, i to jest
              poprawka, nie kolejność przypadkowa.
              
              Pas jest AFORDANCJĄ STREFY TRAFIENIA ("kursor jest w tej
              kategorii"), a nie podświetleniem danych. Rysowany PO słupkach
              kładł 5% tuszu WPROST NA WYPEŁNIENIU: blade wnętrze siedzi na
              1,20-1,28:1 do płyty, więc pięcioprocentowa zasłona realnie je
              przyciemniała - czyli wskazanie zmieniało wygląd zakodowanej
              wartości, dokładnie to, czego zabrania zasada "hover zmienia stan
              powierzchni, nigdy kodowanie". Pod znacznikami ten sam pas jest
              tłem pasa i nie dotyka ani jednego piksela danych.
              
              Tylko dla słupków i mostka: przy linii tę samą rolę pełni
              prowadnica, a pas plus prowadnica to dwa nośniki jednej
              informacji. */}
          {active !== null && !isLine && (
            <rect
              x={horizontal ? padLeft : catCenter(active) - band / 2}
              y={horizontal ? catCenter(active) - band / 2 : padTop}
              width={horizontal ? innerW : band}
              height={horizontal ? band : innerH}
              fill="var(--foreground)"
              fillOpacity={0.05}
              pointerEvents="none"
            />
          )}

          {/* ===== Znaczniki ===== */}
          {waterfall
            ? /* Mostek: filary na zerze, składniki wiszące, znak kodowany
                 KOLOREM I KIERUNKIEM jednocześnie. */
              waterfall.steps.map((step, si) => {
                const a = value(step.from);
                const b = value(step.to);
                const center = catCenter(step.index);
                // WKŁAD ZEROWY NIE MA ZNAKU, więc nie może dostać koloru
                // znaku. Wcześniej wpadał do gałęzi "nie down", czyli malował
                // się kolorem dodatnim - a wykres, który koduje znak kolorem,
                // twierdził wtedy o wzroście, którego nie było. Trzeci tusz
                // (`--muted-foreground`, 5,11:1 w najgorszym przypadku) czyta
                // się jako kreska odniesienia, a nie jako wartość, i mimo to
                // przechodzi próg obiektu graficznego 3,0:1 - czego nie
                // przechodzi token osi (1,40:1), przez co znacznik zerowego
                // wkładu byłby na płycie praktycznie niewidoczny.
                const fill =
                  step.kind === "step"
                    ? step.direction === "down"
                      ? "var(--chart-negative)"
                      : step.direction === "flat"
                        ? "var(--muted-foreground)"
                        : "var(--chart-positive)"
                    : "var(--chart-1)";
                const x = center - barW / 2;
                const y0 = Math.min(a, b);
                const h = Math.abs(b - a);
                return (
                  <g key={`w${step.index}`}>
                    <path
                      d={barPath(
                        x,
                        y0,
                        barW,
                        Math.max(h, 0.5),
                        barRadius,
                        step.kind === "step" && step.direction === "down" ? "bottom" : "top",
                      )}
                      fill={fill}
                      className={step.direction === "down" ? "neh-bar neh-bar-negative" : "neh-bar"}
                      data-role="waterfall-step"
                      style={{ ["--neh-i" as string]: si }}
                    />
                    {/* Etykieta wartości na KAŻDYM słupku - mostek bez liczb
                        zmusza do odczytu długości, a po to jest mostek, żeby
                        nie trzeba było dodawać w głowie. */}
                    <text
                      x={center}
                      y={y0 - 6}
                      textAnchor="middle"
                      fontSize={FONT_AXIS}
                      fill="var(--foreground)"
                      className="neh-fade neh-value-label tabular-nums"
                    >
                      {formatChartValue(step.value, lang, config.unit)}
                    </text>
                    {/* Prowadnica łącząca kolejne składniki - pokazuje, że
                        słupek wisi na poprzednim, a nie stoi na zerze. */}
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
              ? series.map((s, si) => {
                  // Ciągi punktów rozdzielone lukami - luka MUSI przerwać
                  // linię, inaczej wykres zamalowuje dziurę interpolacją.
                  // Indeks kategorii jedzie RAZEM z pikselem (patrz `LineRun`).
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

                  // JEDNA ścieżka na serię, ciągła na całej długości. Podział
                  // historia/prognoza niosą pasmo, strefa i separator - nie
                  // kreskowanie linii; patrz komentarz przy rysowaniu.
                  const d = runs
                    .map((run) => pathFromPoints(run.points, smoothing))
                    .filter(Boolean)
                    .join(" ");
                  const areaD =
                    config.kind === "area"
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
                  // Pasmo liczone PER CIĄG, nie przez całą serię: obwiednia
                  // wyliczona z jednej listy przeskakiwała luki i zamykała
                  // dziurę w danych kolorem, czyli pokazywała niepewność tam,
                  // gdzie nie było żadnego pomiaru.
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
                  const dashed = needsPattern(s);
                  return (
                    <g key={s.colorSlot + s.name}>
                      {areaD && (
                        <path
                          d={areaD}
                          fill={seriesColor(s)}
                          // Krycie w `style`, nie w atrybucie - patrz komentarz
                          // przy strefie prognozy.
                          style={{ fillOpacity: `var(--chart-band-${s.colorSlot})` }}
                          className="neh-fade"
                        />
                      )}
                      {/* Pasmo niepewności prognozy. Krycie z tokena per slot,
                          policzone pod kontrast 1,10-1,17:1 do płyty - stała
                          alfa dawała pasma raz niewidoczne, raz krzyczące. */}
                      {bandD && (
                        <path
                          d={bandD}
                          fill={seriesColor(s)}
                          style={{ fillOpacity: `var(--chart-band-${s.colorSlot})` }}
                          className="neh-fade"
                          pointerEvents="none"
                        />
                      )}
                      {/* LINIA SERII ZOSTAJE CIĄGŁA NA CAŁEJ DŁUGOŚCI, także
                          w prognozie - i to jest zmiana wobec wcześniejszej
                          wersji tego silnika, która kreskowała prognozę przez
                          maski.

                          Prognoza jest już odróżniona TRZEMA nośnikami
                          jednocześnie: pasmem niepewności, tłem strefy
                          i pionowym separatorem z etykietą "Prognoza". Trzy
                          wystarczają, a kreskowana linia dodaje czwarty
                          i zaczyna wyglądać na artefakt renderu - zwłaszcza że
                          kreska 1-2 px na współrzędnej niecałkowitej aliasuje
                          przy innym DPR. Czwarty nośnik nie dodaje więc
                          informacji, tylko szum.

                          Znikają razem z nią dwie maski `clipPath`: były
                          potrzebne wyłącznie po to, żeby kreskowany ogon nie
                          leżał na ciągłym podkładzie. Bez kreskowania nie ma
                          czego przycinać, a jedna ścieżka na serię jest
                          i tańsza, i pozbawiona całej klasy defektów, które
                          tamten podział wnosił. */}
                      <path
                        d={d}
                        fill="none"
                        stroke={seriesColor(s)}
                        strokeWidth={2}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        pathLength={1}
                        className={dashed ? "neh-line neh-line-pattern" : "neh-line"}
                        data-role="series-line"
                      />
                      {/* PUNKTY OBSERWACJI TYLKO NA HISTORII. Ich brak
                          w prognozie sam mówi, że tam nie ma pomiarów - i jest
                          to nośnik mocniejszy od kreskowania, bo działa
                          w druku, w skali szarości i na zrzucie ekranu.
                          Rysowanie kropki nad wartością prognozowaną podawało
                          interpolację za pomiar. */}
                      {showDots &&
                        s.values.map((v, i) =>
                          v === null || (forecastFrom !== null && i >= forecastFrom) ? null : (
                            <circle
                              key={i}
                              cx={catCenter(i)}
                              cy={value(v)}
                              r={2.8}
                              // Kropka w kolorze PŁYTY z obwódką w kolorze
                              // serii, nie odwrotnie: wypełnienie płytą znika
                              // w tle karty, więc widać sam pierścień, a on
                              // czyta się jako "tu jest pomiar", nie jako
                              // kolejny znacznik danych.
                              fill="var(--card)"
                              stroke={seriesColor(s)}
                              strokeWidth={1.6}
                              data-active={active === i ? "true" : undefined}
                              className="neh-dot neh-fade"
                              data-role="series-point"
                            />
                          ),
                        )}
                      {/* Etykieta bezpośrednia w WARIANCIE TEKSTOWYM slotu -
                          identyfikuje serię, więc niesie jej kolor, ale nie
                          kolor linii (próg tekstu to 4,5:1, linii 3,0:1). */}
                      {config.showValues && lastIdx >= 0 && (
                        <text
                          x={catCenter(lastIdx) + 8}
                          y={
                            (endLabelYBySeries.get(si) ?? value(s.values[lastIdx] as number)) + 3.5
                          }
                          fontSize={FONT_AXIS}
                          fill={seriesTextColor(s)}
                          className="neh-fade neh-value-label tabular-nums"
                        >
                          {formatChartValue(s.values[lastIdx] as number, lang, config.unit)}
                        </text>
                      )}
                    </g>
                  );
                })
              : /* Słupki / kolumny */
                series.map((s, si) => (
                  <g key={s.colorSlot + s.name}>
                    {s.values.map((v, i) => {
                      const cell = stacks ? stacks[si][i] : null;
                      const from = cell ? cell.from : 0;
                      const to = cell ? cell.to : (v ?? 0);
                      if (v === null || (v === 0 && stacked)) return null;
                      const a = value(from);
                      const b = value(to);
                      // Zaokrąglony koniec tylko dla segmentu domykajacego pas
                      // danych (ostatnia seria stacka lub słupek pojedynczy).
                      // Pas dodatni i ujemny rosną z tej samej bazy w PRZECIWNE
                      // strony, więc każdy z nich domyka INNA seria - pytamy
                      // o znak tego konkretnego segmentu.
                      const isDataEnd =
                        !stacked || si === lastStackIndexFor(series, stacks, i, v >= 0);
                      const center = catCenter(i);
                      const offset = stacked
                        ? -barW / 2
                        : -((series.length * slotW) / 2) + si * slotW + (slotW - barW) / 2;
                      const negative = v < 0;
                      const hatched = needsPattern(s);
                      const barCls = (base: string): string =>
                        `${base}${negative ? " neh-bar-negative" : ""}`;
                      // Kierunek zaokrąglenia I kierunek rampy z JEDNEJ
                      // wartości - patrz `dataEndOf`.
                      const dataEnd = dataEndOf(horizontal, negative);
                      // Wsunięcie kształtu o połowę grubości obwódki: `stroke`
                      // leży NA ścieżce, więc bez korekty obwódka zjadałaby
                      // wysokość, czyli zmniejszała wartość. Skutek uboczny
                      // jest pożyteczny: słupek o wartości zero zostaje
                      // widoczną kreską obwódki zamiast zniknąć - i to jest
                      // uczciwsze niż podłoga pół piksela udająca dane.
                      const inset = edged ? BAR_EDGE_INSET : 0;
                      const across = Math.max(0, barW - 2 * inset);
                      const along = Math.max(edged ? 0 : 0.5, Math.abs(b - a) - 2 * inset);
                      const shape = horizontal
                        ? barPath(
                            Math.min(a, b) + inset,
                            center + offset + inset,
                            along,
                            across,
                            isDataEnd ? barRadius : 0,
                            dataEnd,
                            edged,
                          )
                        : barPath(
                            center + offset + inset,
                            Math.min(a, b) + inset,
                            across,
                            along,
                            isDataEnd ? barRadius : 0,
                            dataEnd,
                            edged,
                          );
                      const cls = barCls(horizontal ? "neh-bar-h neh-bar" : "neh-bar");
                      const slot = s.colorSlot;
                      const bar = (
                        <path
                          d={shape}
                          data-role="bar"
                          // Wypełnienie zależy od wariantu, ale ZAWSZE idzie
                          // przez token - w kodzie rysującym nie ma ani jednego
                          // hexa, dzięki czemu tryb ciemny i druk dostają swoje
                          // wartości bez gałęzi w JS.
                          fill={
                            barStyle === "pale"
                              ? `var(--chart-${slot}-inner)`
                              : barStyle === "gradient"
                                ? `url(#${gradientId(slot, dataEnd)})`
                                : seriesColor(s)
                          }
                          // Obwódka NIE JEST DEKORACJĄ, tylko funkcją:
                          // wypełnienie o niskim kontraście albo rozmyte
                          // gradientem nie daje ostrej pozycji końca słupka,
                          // a solidna krawędź ją przywraca. To z niej odczytuje
                          // się wartość. W wariancie bladym niesie krok
                          // jasności odchodzący od tła, w gradientowym czysty
                          // token - ten sam, który stoi w legendzie.
                          stroke={
                            barStyle === "pale"
                              ? `var(--chart-${slot}-edge)`
                              : barStyle === "gradient"
                                ? seriesColor(s)
                                : "var(--card)"
                          }
                          // Grubość obwódki NIE jako atrybut prezentacyjny:
                          // `var()` w atrybutach SVG nie jest wspierane
                          // wszędzie, a nierozwiązana grubość to obwódka
                          // domyślna, czyli 1 px bez korekty irradiacji.
                          // W wariancie z obwódką niesie ją arkusz
                          // (`.neh-bar[data-edged]`), w solidnym zostaje
                          // prześwit stosu, który jest czystą geometrią.
                          strokeWidth={edged ? undefined : stacked ? BAR_GAP / 2 : 0}
                          data-active={active === i ? "true" : undefined}
                          data-edged={edged ? "true" : undefined}
                          data-style={barStyle}
                          className={cls}
                          style={{
                            ["--neh-i" as string]: i,
                            // Odcienie stanu podane JAKO WŁASNOŚCI elementu,
                            // żeby arkusz miał jedną regułę hoveru na wszystkie
                            // sloty zamiast dziesięciu prawie identycznych.
                            ["--neh-bar-hover" as string]: `var(--chart-${slot}-hover)`,
                            ["--neh-bar-token" as string]: `var(--chart-${slot})`,
                          }}
                        />
                      );
                      if (!hatched) return <Fragment key={i}>{bar}</Fragment>;
                      // Nakładka wzoru na TYM SAMYM kształcie i z tą samą klasą
                      // animacji: gdyby klasy nie miała, paski stałyby w miejscu,
                      // podczas gdy słupek rośnie od linii bazowej, i wzór
                      // odklejałby się od znacznika przez pół sekundy wejścia.
                      return (
                        <Fragment key={i}>
                          {bar}
                          <path
                            d={shape}
                            fill={`url(#${hatchId})`}
                            className={cls}
                            style={{ ["--neh-i" as string]: i }}
                            pointerEvents="none"
                          />
                        </Fragment>
                      );
                    })}
                    {/* Etykiety na szczycie kolumn - tylko pojedyncza seria,
                        inaczej robi się ściana liczb (dataviz: selektywnie). */}
                    {config.showValues &&
                      !stacked &&
                      series.length === 1 &&
                      s.values.map((v, i) =>
                        v === null ? null : horizontal ? (
                          <text
                            key={`l${i}`}
                            x={value(v) + (v >= 0 ? 6 : -6)}
                            y={catCenter(i) + 3.5}
                            textAnchor={v >= 0 ? "start" : "end"}
                            fontSize={FONT_AXIS}
                            fill="var(--foreground)"
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
                            fontSize={FONT_AXIS}
                            fill="var(--foreground)"
                            className="neh-fade neh-value-label tabular-nums"
                          >
                            {formatChartValue(v, lang, config.unit)}
                          </text>
                        ),
                      )}
                  </g>
                ))}

          {/* Separator prognozy z etykietą. Rysowany PO znacznikach, żeby
              linia serii nie przechodziła nad granicą, i z etykietą słowną,
              bo kreskowanie samo nie mówi "prognoza". */}
          {forecastBoundary !== null && !horizontal && (
            <g pointerEvents="none">
              <line
                x1={forecastBoundary}
                x2={forecastBoundary}
                y1={padTop}
                y2={padTop + innerH}
                className="neh-forecast-divider"
              />
              <text
                x={forecastBoundary + 6}
                y={padTop + 11}
                fontSize={FONT_AXIS}
                fill="var(--muted-foreground)"
              >
                {t("forecast.label")}
              </text>
            </g>
          )}

          {/* PROWADNICA pod kursorem - tylko dla linii i pól. Rysowana PO
              znacznikach, bo jest linią ciągłą 1 px w kolorze osi (1,40:1 do
              płyty): schowana pod łamaną przestałaby wskazywać kategorię,
              a przechodząc nad nią niczego nie zasłania. Podświetlenie pasa
              kategorii jest osobną sprawą i leży POD znacznikami - patrz
              komentarz przy nim. */}
          {active !== null && isLine && (
            <line
              className="neh-crosshair"
              x1={horizontal ? padLeft : catCenter(active)}
              x2={horizontal ? padLeft + innerW : catCenter(active)}
              y1={horizontal ? catCenter(active) : padTop}
              y2={horizontal ? catCenter(active) : padTop + innerH}
            />
          )}

          {/* WARSTWA TRAFIEŃ: cały obszar rysunku, przyciąga do najbliższej
              kategorii. Strefa trafienia NIGDY nie jest kształtem elementu -
              słupek o wartości 2 ma trzy piksele wysokości i jest
              nietrafialny, a punkt linii o promieniu 2,8 px wymagałby
              celowania. Nakładka na całą powierzchnię plus wyznaczenie
              kategorii ze współrzędnej daje strefę wysoką na cały obszar
              kreślenia, więc trafialna jest KATEGORIA, nie znacznik.
              
              `fill` jako ATRYBUT, nie tylko w CSS - rect nie może stać się
              czarny, gdy arkusz jeszcze nie dotarł. I `transparent`, nigdy
              `opacity: 0` na samym elemencie: zerowe krycie wyłącza też
              zdarzenia w części silników.
              
              DOTYK: `pointerdown` USTAWIA stan (na dotyku nie ma hovera, więc
              bez tego wykres jest na telefonie martwy), a `pointerleave`
              zdejmuje go wszędzie POZA dotykiem - tam przychodzi natychmiast
              po podniesieniu palca i gasił tooltip w tej samej chwili, w której
              się pojawił. Tapnięcie poza wykresem zdejmuje stan przez
              `useTapAwayDismiss`.
              
              Warunek na DOTYKU, nie na myszy: wyjątkiem jest dotyk, więc jego
              trzeba nazwać. Rysik ma hover jak mysz, a środowisko, które nie
              podaje rodzaju wskaźnika, dostaje zachowanie mysie - czyli to
              samo, co miało przed tą zmianą. */}
          <rect
            x={padLeft}
            y={padTop}
            width={innerW}
            height={innerH}
            fill="transparent"
            className="neh-hit"
            onPointerDown={(e) => setActiveIndex(indexFromPointer(e))}
            onPointerMove={(e) => setActiveIndex(indexFromPointer(e))}
            onPointerLeave={(e) => {
              if (e.pointerType !== "touch") setActiveIndex(null);
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
        />
      </div>
    </div>
  );
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
      max = Math.max(max, estimateLabelWidth(formatChartValue(v, lang, config.unit), FONT_AXIS));
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
 * +/- procent, zamknięta w jedną ścieżkę. Sama linia prognozy sugeruje
 * pewność, której nie ma - dlatego pasmo jest rysowane zawsze, gdy autor
 * podał jego szerokość.
 *
 * PER CIĄG, a nie per seria, i to jest cały sens tego podpisu: obwiednia
 * policzona z jednej listy wszystkich niepustych wartości zamykała się przez
 * lukę, czyli malowała niepewność nad kategorią, w której nie było żadnego
 * pomiaru. Ciąg z definicji nie ma dziur, więc jego obwiednia też nie ma.
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
    // Na granicy pasmo ma szerokość ZERO: ostatnia obserwacja jest pomiarem,
    // więc nie ma wokół niej niepewności prognozy. Bez tego pasmo startowało
    // od pełnej szerokości nad zmierzoną wartością.
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
 * Indeks serii domykającej pas stacka O DANYM ZNAKU w danej kategorii.
 *
 * Szukanie po znaku, a nie "ostatnia seria z wartością dodatnią", bo pas
 * ujemny ma własny kursor (`stackSeries`) i domyka go ostatnia seria ujemna.
 * Fallback `series.length - 1` zostaje wyłącznie dla wykresu bez stacka -
 * w stacku wskazywałby serię, która w tej kategorii może nic nie rysować
 * (luka), i zaokrąglenie przepadałoby na całym pasie.
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
