// HISTOGRAM - ROZKŁAD WARTOŚCI NA OSI CIĄGŁEJ.
//
// PYTANIE ANALITYCZNE. Wiersz z tabeli doboru formy sekcji 1: "Rozkład
// wartości -> histogram, boxplot, beeswarm", a w kolumnie "Czego unikać"
// stoi "średnia bez rozproszenia". Cała wartość tego rodzaju polega na tym,
// że pokazuje KSZTAŁT, którego średnia i odchylenie nie pokazują: dwa
// szczyty, ogon w jedną stronę, dziurę w środku.
//
// CZEMU TO NIE SĄ SŁUPKI Z `CartesianChart`, i to jest jedyna decyzja
// architektoniczna w tym pliku warta uzasadnienia.
//
// Wykres słupkowy stawia kategorie w PASMACH RÓWNEJ SZEROKOŚCI, bo kategoria
// nie ma szerokości - "Polska" nie jest szersza od "Litwy". Przedział
// histogramu MA szerokość i jest to szerokość MIERZONA W JEDNOSTKACH DANYCH.
// Narysowanie przedziałów 0-10 i 10-100 jako dwóch równych słupków twierdzi,
// że dotyczą one równych fragmentów zakresu, a nie dotyczą - i jest to
// dokładnie ten sam defekt, którym kłamie mapa ciepła o nierównej siatce.
// Dlatego oś pozioma jest tu CIĄGŁA: pozycja i szerokość słupka jedzie ze
// skali liniowej nałożonej na krawędzie, a nie z numeru pasma.
//
// Z tego wynika reszta:
//   * SŁUPKI SIĘ STYKAJĄ. Przerwa między słupkami histogramu twierdziłaby, że
//     między przedziałami jest zakres, w którym nie ma obserwacji - a nie ma
//     tam żadnego zakresu, bo prawa krawędź jednego przedziału JEST lewą
//     krawędzią następnego. To jedyny rodzaj w tym silniku, w którym
//     `BAR_GAP` jest wyłączony, i dlatego różnicę między sąsiadami niesie
//     obwódka w kolorze płyty, nie odstęp;
//   * WYSOKOŚĆ KODUJE GĘSTOŚĆ, GDY PRZEDZIAŁY SĄ NIERÓWNE. Model decyduje
//     o tym sam (`valueEncodes`) i wtedy pole słupka - nie jego wysokość -
//     równa się udziałowi obserwacji. Podpis osi zmienia się razem z tym,
//     bo czytelnik ma prawo wiedzieć, którą z dwóch różnych rzeczy widzi;
//   * OŚ WARTOŚCI ZAWSZE OD ZERA, bez opcji. Histogram koduje liczebność
//     długością słupka, więc ucięta oś zniekształca proporcję między
//     przedziałami wprost - sekcja 8. `histogramExtent` nie ma na to
//     parametru i to jest celowe.
//
// CZEGO TEN KOMPONENT NIE LICZY: niczego. Przedziały, reguła doboru krawędzi,
// gęstość, komplet pozycyjny i wszystkie sprawdzenia uczciwości pochodzą
// z `lib/charts/kinds/histogram.ts`. Tu jest wyłącznie skalowanie na piksele
// i rysowanie - dzięki temu ta sama arytmetyka obsługuje tabelę danych,
// której nikt nie renderuje przez SVG.
import {
  useCallback,
  useId,
  useMemo,
  useState,
  type KeyboardEvent,
  type PointerEvent,
} from "react";
import { useTranslation } from "react-i18next";
import type { ChartConfig } from "@/lib/charts/types";
import { formatAxisTick, formatChartValue, type ChartLang } from "@/lib/charts/format";
import { linearScale, niceScale } from "@/lib/charts/scale";
import {
  HISTOGRAM_MAX_BINS,
  HISTOGRAM_SHAPE_MIN_OBSERVATIONS,
  histogramExtent,
  histogramFormAdvice,
  histogramModelFromConfig,
  type HistogramBin,
  type HistogramFormAdvice,
  type HistogramModel,
} from "@/lib/charts/kinds/histogram";
import {
  FONT_AXIS,
  MIN_INNER_H,
  MIN_INNER_W,
  PAD_BOTTOM,
  PAD_LEFT_MIN,
  PAD_SIDE,
  PAD_TOP,
  cascadeStepMs,
  clampBarRadius,
  valueTickTarget,
} from "@/lib/charts/geometry";
import { bandIndex, pointerToPlot } from "@/lib/charts/plot";
import { resolveBarStyle, barStyleHasEdge } from "@/lib/charts/palette";
import { estimateLabelWidth } from "@/lib/charts/measureText";
import { useContainerWidth } from "@/hooks/useContainerWidth";
import { useTapAwayDismiss } from "@/hooks/useTapAwayDismiss";
import { useRevealOnScroll, revealClassName } from "@/hooks/useRevealOnScroll";
import { ChartTooltip, type TooltipRow } from "./ChartTooltip";
import { ChartNotes, type ChartNote } from "./ChartFrame";
import "@/lib/i18n-charts";

/**
 * Ile etykiet krawędzi zmieści się bez nachodzenia. Liczba wyprowadzona
 * z geometrii, nie z gustu: etykieta liczby przy `FONT_AXIS` ma około 34 px
 * (pięć znaków plus powietrze), a pole rysunku około 660 px - czyli
 * dziewiętnaście etykiet stykałoby się bokami. Bierzemy co n-tą tak, żeby
 * odstęp nie spadł pod tę szerokość; pierwsza i ostatnia krawędź są ZAWSZE
 * podpisane, bo bez nich nie wiadomo, jaki zakres pokazuje rysunek.
 */
const EDGE_LABEL_MIN_PX = 34;

/**
 * Klucze OBSERWACJI dla czytelnika, wypisane jawnie. Histogram nie ma tu
 * żadnego `null`: każda z czterech porad formy mówi coś, co czytelnik widzi na
 * rysunku (kształt zależny od krawędzi, jeden słupek, brak kształtu,
 * rozdzielczość przycięta sufitem), a ZALECENIE („weź beeswarma", „podaj
 * krawędzie") niesie osobna nakładka edytora - patrz
 * `src/lib/charts/formAdvice.ts`.
 *
 * DO TEGO PR-A HISTOGRAM NIE POKAZYWAŁ ANI JEDNEGO KOMUNIKATU, i to był
 * ubytek, nie decyzja: model liczy siedem flag uczciwości, słownik ma dla
 * nich treści w obu językach, a render nie wołał żadnej. Rysunek, na którym
 * suma liczebności nie zgadza się z liczbą obserwacji, milczał o tym równie
 * dobrze jak rysunek bez defektu.
 */
const READING_KEYS: Record<HistogramFormAdvice, string> = {
  tooFew: "histogram.reading.tooFew",
  noSpread: "histogram.reading.noSpread",
  tooCoarse: "histogram.reading.tooCoarse",
  clamped: "histogram.reading.clamped",
};

/** Ile pikseli obwódki dzieli stykające się słupki. Patrz nagłówek pliku. */
const TOUCHING_EDGE_PX = 1;

interface HistogramChartProps {
  config: ChartConfig;
  lang: ChartLang;
}

export function HistogramChart({ config, lang }: HistogramChartProps) {
  const { t: scoped } = useTranslation("translation", { keyPrefix: "charts" });
  const t = useCallback(
    (key: string, values?: Record<string, string | number>): string =>
      scoped(key, { lng: lang, ...values }),
    [scoped, lang],
  );
  const { ref: widthRef, width } = useContainerWidth<HTMLDivElement>();
  const { ref: revealRef, state: revealState } = useRevealOnScroll<HTMLDivElement>(config.animate);
  const [active, setActive] = useState<number | null>(null);
  const hintId = useId();

  const model: HistogramModel = useMemo(() => histogramModelFromConfig(config), [config]);
  const bins = model.bins;
  const height = config.height;

  // `useTapAwayDismiss` MUSI stać przed jakimkolwiek wczesnym wyjściem -
  // hooki nie mogą się warunkowo pomijać, a wyjście "brak przedziałów" jest
  // niżej.
  const clearActive = useCallback(() => setActive(null), []);
  useTapAwayDismiss(active !== null, widthRef, clearActive);

  const geometry = useMemo(() => {
    const extent = histogramExtent(model);
    const scale = niceScale(extent.min, extent.max, valueTickTarget(height, false));
    // Szerokość etykiety podziałki decyduje o lewym marginesie - inaczej
    // liczba wychodzi za płytę i zostaje ucięta (wymaganie bezwzględne
    // sekcji 1: nic nie jest ucięte).
    const tickW = Math.max(
      ...scale.ticks.map((tk) => estimateLabelWidth(formatAxisTick(tk, lang), FONT_AXIS)),
      0,
    );
    const padLeft = Math.max(PAD_LEFT_MIN, Math.ceil(tickW) + PAD_SIDE);
    const innerW = Math.max(MIN_INNER_W, width - padLeft - PAD_SIDE);
    const innerH = Math.max(MIN_INNER_H, height - PAD_TOP - PAD_BOTTOM);
    const value = linearScale(scale.min, scale.max, PAD_TOP + innerH, PAD_TOP);
    // OŚ POZIOMA CIĄGŁA. Domena to pierwsza i ostatnia krawędź, nie liczba
    // przedziałów - to jest ta jedna rzecz, która odróżnia histogram od
    // słupków, i dlatego dziedzina bierze się z `model.domain`.
    const dom = model.domain;
    const rozpietosc = dom.max - dom.min;
    const along = (v: number): number =>
      rozpietosc > 0 ? padLeft + ((v - dom.min) / rozpietosc) * innerW : padLeft + innerW / 2;
    return { scale, padLeft, innerW, innerH, value, along, dom, rozpietosc };
  }, [model, height, width, lang]);

  const { scale, padLeft, innerW, innerH, value, along, rozpietosc } = geometry;

  // JEDNA SERIA, BEZ STOSU, BEZ KRESKOWANIA - histogram czyta jedną serię,
  // więc blade wnętrze nie ma z czym się mylić i wariant autora zostaje taki,
  // jaki wybrał.
  const barStyle = resolveBarStyle(config.barStyle, {
    seriesCount: 1,
    stacked: false,
    patterned: false,
  });
  const edged = barStyleHasEdge(barStyle);
  const cascade = cascadeStepMs(bins.length);

  // Etykiety krawędzi: bierzemy co `krok`, ale pierwsza i ostatnia zawsze.
  const edgeStep = useMemo(() => {
    if (bins.length === 0 || rozpietosc <= 0) return 1;
    const pxPerBin = innerW / bins.length;
    return Math.max(1, Math.ceil(EDGE_LABEL_MIN_PX / Math.max(pxPerBin, 1)));
  }, [bins.length, innerW, rozpietosc]);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    if (bins.length === 0) return;
    if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      e.preventDefault();
      const delta = e.key === "ArrowRight" ? 1 : -1;
      setActive((prev) => {
        const next = prev === null ? (delta > 0 ? 0 : bins.length - 1) : prev + delta;
        return Math.max(0, Math.min(bins.length - 1, next));
      });
      return;
    }
    if (e.key === "Escape") setActive(null);
  };

  // UWAGI POD RYSUNKIEM: najpierw obserwacja o formie, potem defekty danych.
  // Kolejność jest treścią, nie kosmetyką - „kształt zależy od krawędzi"
  // zmienia sposób czytania CAŁEGO rysunku, a „w podpisie stoi inne n"
  // dotyczy jednej liczby w podpisie.
  //
  // Liczby podajemy KOMPLETEM dla wszystkich czterech obserwacji: treść pisze
  // słownik, i18next zignoruje te wstawki, których dane zdanie nie używa,
  // a POMINIĘTA wstawka nie jest ignorowana - zostaje w zdaniu jako surowe
  // `{{min}}` (tak zepsuł się `beeswarm.reading.truncated` w tej samej pracy).
  const notes: ChartNote[] = histogramFormAdvice(model).map((a) => ({
    key: `reading.${a}`,
    text: t(READING_KEYS[a], {
      min: HISTOGRAM_SHAPE_MIN_OBSERVATIONS,
      max: HISTOGRAM_MAX_BINS,
    }),
    defect: false,
  }));
  // DEFEKTY DANYCH. Każdy z nich znaczy, że rysunek pokazuje mniej albo inaczej
  // niż dane - i każdy ma w modelu osobną flagę, bo osobno się je naprawia.
  //
  // BRAK PRZEDZIAŁÓW IDZIE PIERWSZY, przed obserwacją o formie: `reading
  // .tooCoarse` mówi „cały zakres zmieścił się w jednym przedziale", czyli
  // opisuje JEDEN słupek, a tu nie ma żadnego. Kolejność jest treścią, bo
  // czytelnik czyta listę od góry i pierwsze zdanie ustawia mu resztę.
  if (model.binsBuiltOk === false) {
    notes.unshift({
      key: "honesty.binsBuiltFailed",
      text: t("histogram.honesty.binsBuiltFailed"),
      defect: true,
    });
  }
  if (model.inRangeOk === false) {
    notes.push({
      key: "honesty.outOfRange",
      text: t("histogram.honesty.outOfRange", { count: model.outOfRange }),
      defect: true,
    });
  }
  if (model.countChecksumOk === false) {
    notes.push({
      key: "honesty.checksumFailed",
      text: t("histogram.honesty.checksumFailed", {
        sum: bins.reduce((a, b) => a + b.count, 0),
        count: model.summary.n,
      }),
      defect: true,
    });
  }
  if (model.binWidthOk === false) {
    notes.push({
      key: "honesty.binWidthFailed",
      text: t("histogram.honesty.binWidthFailed"),
      defect: true,
    });
  }
  if (model.declaredSampleOk === false) {
    notes.push({
      key: "honesty.declaredSampleFailed",
      text: t("histogram.honesty.declaredSampleFailed", {
        declared: config.sampleSize ?? 0,
        actual: model.summary.n,
      }),
      defect: true,
    });
  }
  if (model.ignoredSeries > 0) {
    notes.push({
      key: "honesty.ignoredSeries",
      text: t("histogram.honesty.ignoredSeries", { count: model.ignoredSeries }),
      defect: true,
    });
  }

  // BRAK PRZEDZIAŁÓW NIE MOŻE ZNACZYĆ „PUSTE MIEJSCE". Rysunku nie ma czego
  // narysować, ale to NIE JEST powód do milczenia: czytelnik widzi wtedy
  // kartę z tytułem i podpisem nad niczym i nie wie, czy patrzy na awarię,
  // czy na dane, z których nie da się zbudować rozkładu. Zwracamy więc same
  // uwagi - w tym `honesty.binsBuiltFailed`, które nazywa przyczynę.
  //
  // Wyjście MUSI stać po wszystkich hakach (patrz `useTapAwayDismiss` wyżej)
  // i przed geometrią, bo ta liczy na niepustą listę przedziałów.
  if (bins.length === 0) {
    return notes.length === 0 ? null : (
      <div ref={revealRef} className={revealClassName(revealState)}>
        <ChartNotes notes={notes} />
      </div>
    );
  }

  const indexFromPointer = (e: PointerEvent<SVGRectElement>): number => {
    const point = pointerToPlot(
      e.clientX,
      e.clientY,
      e.currentTarget.getBoundingClientRect(),
      innerW,
      innerH,
    );
    if (point === null) return 0;
    // PASMA HISTOGRAMU NIE SĄ RÓWNE, więc `bandIndex` (który dzieli przez
    // stałą szerokość pasma) jest tu tylko awaryjną odpowiedzią dla
    // przedziałów równych. Właściwe przypisanie idzie po krawędziach:
    // szukamy przedziału, w którym leży współrzędna danych.
    const dataX = geometry.dom.min + (point.x / innerW) * rozpietosc;
    const trafiony = bins.findIndex((b, i) =>
      i === bins.length - 1 ? dataX >= b.from && dataX <= b.to : dataX >= b.from && dataX < b.to,
    );
    return trafiony >= 0 ? trafiony : bandIndex(point.x, innerW / bins.length, bins.length);
  };

  const czynne: HistogramBin | null = active === null ? null : (bins[active] ?? null);

  // Podpis osi wartości mówi, KTÓRĄ z dwóch różnych rzeczy niesie wysokość.
  const axisLabel =
    model.valueEncodes === "density" ? t("histogram.axis.density") : t("histogram.axis.count");

  const tooltipRows: TooltipRow[] = czynne
    ? [
        {
          name: axisLabel,
          value: formatChartValue(czynne.count, lang, ""),
          colorSlot: model.colorSlot,
          emphasised: true,
        },
        {
          name: t("frame.share"),
          value: `${(czynne.share * 100).toFixed(1)}%`,
          colorSlot: null,
        },
        // GĘSTOŚĆ W DYMKU TYLKO WTEDY, GDY TO ONA NIESIE WYSOKOŚĆ. Przy
        // przedziałach równych byłaby licznością przemnożoną przez stałą,
        // czyli wierszem bez informacji.
        ...(model.valueEncodes === "density"
          ? [
              {
                name: t("histogram.table.density"),
                value: formatChartValue(czynne.density, lang, ""),
                colorSlot: null,
              },
            ]
          : []),
        // "KTO TU JEST" - pytanie, którego histogram normalnie nie umie zadać.
        // Etykiety obserwacji przeżywają w modelu właśnie po to.
        ...(czynne.members.length > 0
          ? [
              {
                name: t("histogram.table.members"),
                value: czynne.members.join(", "),
                colorSlot: null,
              },
            ]
          : []),
      ]
    : [];

  const ariaLabel = [
    config.title,
    t("histogram.rule.label", {
      rule: t(`histogram.rule.${model.rule}`),
      count: model.binCount,
    }),
    t("histogram.summary.n"),
    String(model.summary.n),
  ]
    .filter(Boolean)
    .join(". ");

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
        aria-describedby={hintId}
        onKeyDown={onKeyDown}
        onBlur={clearActive}
      >
        <span id={hintId} className="sr-only">
          {t("a11y.keyboardHint")}
        </span>
        <svg width={width} height={height} className="block overflow-visible">
          {/* Siatka poziomej podziałki - jak w kartezjańskim, bo to ta sama oś. */}
          {config.showGrid &&
            scale.ticks.map((tick) => (
              <line
                key={tick}
                x1={padLeft}
                x2={padLeft + innerW}
                y1={value(tick)}
                y2={value(tick)}
                stroke="var(--chart-grid)"
                strokeWidth={1}
              />
            ))}

          {/* Etykiety osi wartości */}
          {scale.ticks.map((tick) => (
            <text
              key={tick}
              x={padLeft - 8}
              y={value(tick) + 3.5}
              textAnchor="end"
              fontSize={FONT_AXIS}
              fill="var(--muted-foreground)"
              className="tabular-nums"
            >
              {formatAxisTick(tick, lang)}
            </text>
          ))}

          {/* Oś bazowa - zero. Histogram zawsze je ma, bo zawsze od zera. */}
          <line
            x1={padLeft}
            x2={padLeft + innerW}
            y1={value(scale.min)}
            y2={value(scale.min)}
            stroke="var(--chart-axis)"
            strokeWidth={1}
          />

          {/* ===== Słupki: STYKAJĄCE SIĘ, o szerokości z jednostek danych ===== */}
          {bins.map((b, i) => {
            const x0 = along(b.from);
            const x1 = along(b.to);
            const szerokosc = Math.max(1, x1 - x0 - TOUCHING_EDGE_PX);
            const y = value(b.plotValue);
            const h = Math.max(0, value(scale.min) - y);
            const radius = clampBarRadius(szerokosc, h, { inset: 0, bordered: edged });
            return (
              <rect
                key={b.index}
                x={x0 + TOUCHING_EDGE_PX / 2}
                y={y}
                width={szerokosc}
                height={h}
                rx={radius}
                fill={
                  barStyle === "solid"
                    ? `var(--chart-${model.colorSlot})`
                    : `var(--chart-${model.colorSlot}-inner)`
                }
                stroke={edged ? `var(--chart-${model.colorSlot}-edge)` : undefined}
                className="neh-bar"
                // UCHWYT ZAPYTANIA rodzaju: słupek histogramu jest SŁUPKIEM
                // PRZEDZIAŁU, nie kategorii, i testy muszą umieć odróżnić go
                // od słupka kategorialnego bez oglądania klasy wyglądu.
                data-role="bin"
                data-active={active === i ? "true" : undefined}
                style={{ ["--neh-i" as string]: i }}
              />
            );
          })}

          {/* Etykiety KRAWĘDZI, nie środków pasm - bo oś jest ciągła i to
              krawędzie są liczbami, które czytelnik odczytuje. Pierwsza
              i ostatnia zawsze, żeby zakres rysunku był jawny. */}
          {bins.map((b, i) => {
            const pokaz = i % edgeStep === 0;
            if (!pokaz) return null;
            return (
              <text
                key={`e${b.index}`}
                x={along(b.from)}
                y={PAD_TOP + innerH + 16}
                textAnchor="middle"
                fontSize={FONT_AXIS}
                fill="var(--muted-foreground)"
                className="tabular-nums"
              >
                {formatAxisTick(b.from, lang)}
              </text>
            );
          })}
          <text
            x={along(geometry.dom.max)}
            y={PAD_TOP + innerH + 16}
            textAnchor="end"
            fontSize={FONT_AXIS}
            fill="var(--muted-foreground)"
            className="tabular-nums"
          >
            {formatAxisTick(geometry.dom.max, lang)}
          </text>

          {/* Warstwa trafień - jedna na całe pole, jak w kartezjańskim. */}
          <rect
            className="neh-hit"
            x={padLeft}
            y={PAD_TOP}
            width={innerW}
            height={innerH}
            fill="transparent"
            onPointerDown={(e) => setActive(indexFromPointer(e))}
            onPointerMove={(e) => setActive(indexFromPointer(e))}
            onPointerLeave={(e) => {
              // Dotyk NIE gasi dymka przy opuszczeniu warstwy: palec schodzi
              // z ekranu po każdym stuknięciu, więc dymek zniknąłby zawsze
              // natychmiast. Gasi go stuknięcie poza wykresem
              // (`useTapAwayDismiss`).
              if (e.pointerType !== "touch") setActive(null);
            }}
          />
        </svg>

        <ChartTooltip
          visible={czynne !== null}
          x={czynne ? (along(czynne.from) + along(czynne.to)) / 2 : 0}
          y={czynne ? value(czynne.plotValue) : 0}
          containerWidth={width}
          title={czynne?.label ?? ""}
          rows={tooltipRows}
        />
      </div>

      <ChartNotes notes={notes} />
    </div>
  );
}
