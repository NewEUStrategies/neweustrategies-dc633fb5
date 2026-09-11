// BOXPLOT - PIĘĆ LICZB NA GRUPĘ ZAMIAST JEDNEJ ŚREDNIEJ.
//
// PYTANIE ANALITYCZNE. Wiersz z tabeli doboru formy (sekcja 1): "Rozkład
// wartości -> histogram, boxplot, beeswarm", a w kolumnie "Czego unikać" stoi
// "średnia bez rozproszenia". To jest cała racja bytu tego rodzaju. Jedna
// liczba na kategorię ("mediana marży", "przeciętny czas procedury") wygląda
// na fakt, a jest streszczeniem, które gubi to, o co zwykle pytamy: czy
// rozkład jest wąski czy szeroki, czy jest skośny i czy ma ogon. Skrzynka
// pokazuje pięć liczb naraz, a odstające obserwacje osobno.
//
// CZEGO DLA TEGO RODZAJU NIE WOLNO - i co z tego wynika DLA PIKSELI, bo każdy
// zakaz z modelu (`lib/charts/kinds/boxplot.ts`) ma tu swoje odbicie:
//   * nie wolno ciągnąć wąsa do OGRODZENIA (q1 - 1,5*IQR). Ogrodzenie jest
//     progiem obliczonym, a nie zmierzoną wartością. Model kończy wąs na
//     obserwacji i render nie ma prawa niczego dociągnąć - dlatego poprzeczka
//     stoi na `whiskerHigh`, a nie na `fenceHigh` (oba pola są w modelu,
//     rysowane jest jedno), a kropka odstająca NIGDY nie jest połączona
//     z wąsem;
//   * nie wolno pokazywać skrzynek bez `n`. Skrzynka z próby pięciu i z próby
//     pięciuset wygląda IDENTYCZNIE, a znaczy co innego (sekcja 8: "Podaj n"),
//     więc `n` stoi na osi kategorii pod etykietą grupy, a nie tylko w dymku -
//     dymek nie istnieje ani w druku, ani na zrzucie ekranu;
//   * nie wolno milcząco odrzucać obserwacji odstających. Każda jest osobną
//     kropką; "odstająca" znaczy "leży dalej niż 1,5 IQR od skrzynki", a nie
//     "błąd pomiaru".
//
// DECYZJA ARCHITEKTONICZNA: MEDIANA JEST OSOBNYM ELEMENTEM `<line>`, A NIE
// KRAWĘDZIĄ PUDŁA ANI SZWEM MIĘDZY DWOMA WYPEŁNIENIAMI.
//
// Alternatywa, którą odrzuciłem, to pudło złożone z DWÓCH prostokątów
// (q1..mediana i mediana..q3), gdzie medianę niesie granica między nimi. Jest
// gorsza z trzech powodów, z których pierwszy jest defektem, nie gustem:
//   1. przy IQR = 0 oba prostokąty mają wysokość zero, a `<rect>` o zerowym
//      wymiarze W OGÓLE NIE JEST RYSOWANY (nie rysuje nawet obwódki), więc
//      grupa o rozkładzie zdegenerowanym - co jest WŁAŚCIWOŚCIĄ DANYCH, a nie
//      błędem - zniknęłaby z rysunku bez śladu. `<line>` rysuje się zawsze
//      i to ona utrzymuje taką grupę na wykresie;
//   2. szew między dwoma wypełnieniami tego samego odcienia jest trzecią
//      granicą poziomą w kolumnie, obok górnej i dolnej krawędzi pudła,
//      a czytelnik musi ODCZYTAĆ medianę, nie ją zgadnąć. Osobna kreska
//      o półtora raza większej grubości jest w kolumnie jednoznacznie
//      najmocniejszym znakiem poziomym;
//   3. dwa prostokąty to dwa elementy animacji i dwie powierzchnie stanu na
//      jeden kształt, czyli dwa razy więcej miejsc, w których hover mógłby
//      ruszyć coś, co niesie wartość (sekcja 6).
//
// DRUGA DECYZJA: PASMA RÓWNEJ SZEROKOŚCI, NIE OŚ CIĄGŁA - i to jest dokładna
// odwrotność histogramu. Przedział histogramu MA szerokość mierzoną
// w jednostkach danych (patrz nagłówek `HistogramChart.tsx`); grupa skrzynki
// jest KATEGORIĄ i szerokości nie ma, bo "Polska" nie jest szersza od "Litwy".
// Dlatego strefa trafienia idzie przez `bandIndex`, a nie przez arytmetykę na
// krawędziach, a proporcja pudła w paśmie pochodzi z modelu
// (`BOX_WIDTH_RATIO`, `WHISKER_CAP_RATIO`). Własną decyzją renderu jest tylko
// SUFIT szerokości w pikselach, bo model nie zna rozmiaru rysunku.
//
// CZEGO TEN KOMPONENT NIE LICZY: niczego. Kwartyle, ogrodzenia, końce wąsów,
// podział na obserwacje odstające, rozsunięcie remisów i wszystkie
// samosprawdzenia są w modelu i mają własny plik testowy. Tu jest wyłącznie
// skalowanie na piksele - dzięki temu ta sama arytmetyka obsługuje alternatywę
// tekstową, której nikt nie renderuje przez SVG.
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
  boxplotExtent,
  boxplotFormAdvice,
  boxplotModelFromConfig,
  type BoxplotBox,
  type BoxplotFormAdvice,
  type BoxplotModel,
} from "@/lib/charts/kinds/boxplot";
import {
  BAR_MAX,
  FONT_AXIS,
  MIN_INNER_H,
  MIN_INNER_W,
  PAD_BOTTOM,
  PAD_LEFT_MIN,
  PAD_SIDE,
  PAD_TOP,
  cascadeStepMs,
  valueTickTarget,
} from "@/lib/charts/geometry";
import { bandIndex, pointerToPlot } from "@/lib/charts/plot";
import { CHAR_WIDTH_RATIO, estimateLabelWidth } from "@/lib/charts/measureText";
import { barStyleHasEdge, resolveBarStyle } from "@/lib/charts/palette";
import { useContainerWidth } from "@/hooks/useContainerWidth";
import { useRevealOnScroll, revealClassName } from "@/hooks/useRevealOnScroll";
import { useTapAwayDismiss } from "@/hooks/useTapAwayDismiss";
import { ChartTooltip, type TooltipRow } from "./ChartTooltip";
import "@/lib/i18n-charts";
import { ChartNotes, type ChartNote } from "./ChartFrame";

/**
 * SUFIT SZEROKOŚCI PUDŁA w pikselach - jedyna proporcja, o której decyduje
 * render, bo model nie zna rozmiaru rysunku.
 *
 * Bez sufitu jedna grupa dostaje pudło szerokie na 62% pola rysunku (przy
 * 720 px to ponad 400 px), czyli prostokąt szerszy niż wysoki - a wtedy oko
 * zaczyna czytać wymiar poziomy tak, jakby coś niósł, podczas gdy nie niesie
 * NICZEGO (pozycja pozioma w paśmie jest tylko miejscem). Sufit jest
 * czterokrotnością `BAR_MAX`, a nie jego równością, bo słupek czyta się na
 * JEDNEJ krawędzi danych, a pudło na TRZECH znakach poziomych (q1, mediana,
 * q3) plus dwie poprzeczki wąsów - przy 24 px poprzeczka miałaby 12 px i te
 * znaki zlałyby się w jeden. Od pięciu grup w górę sufit przestaje działać
 * i proporcją rządzi model, czyli przypadek typowy zostaje przy `BOX_WIDTH_RATIO`.
 */
const BOX_MAX_PX = 4 * BAR_MAX;

/**
 * Wysokość osi kategorii. `PAD_BOTTOM` starcza na JEDEN wiersz etykiet,
 * a tutaj wierszy są DWA (nazwa grupy i jej `n`), bo `n` jest obowiązkowe.
 * Bez tego zapasu druga linia wychodzi za płytę i zostaje ucięta, a sekcja 1
 * nie dopuszcza uciętej treści.
 */
const CATEGORY_AXIS_H = PAD_BOTTOM + FONT_AXIS + 2;

/** Promień kropki obserwacji jako WARTOŚĆ AWARYJNA - właściwą niesie `--chart-dot`. */
const DOT_R = 2.8;

/** Odsunięcie pierwszego wiersza etykiety od dolnej krawędzi pola rysunku. */
const LABEL_BASELINE = 16;

/**
 * Rozdzielnik zakresu w dymku. Półpauza, nie myślnik i nie pauza: para liczb
 * to zakres, a nie zdanie wtrącone.
 */
const RANGE_SEP = "–";

/**
 * Klucze NOT DLA CZYTELNIKA, wypisane jawnie, a nie sklejone z wartości
 * modelu: bramka rozjazdu kod-słownik i kontrola parytetu PL/EN widzą
 * wyłącznie pełne ścieżki.
 *
 * `null` ZNACZY „ten komunikat nie ma nic dla czytelnika". Porada formy
 * rozpada się na dwie części: OBSERWACJĘ o tym rysunku, którą czytelnik może
 * z niego odczytać, i ZALECENIE zmiany formy albo danych, którego czytelnik
 * opublikowanego wpisu nie ma jak wykonać. Pod rysunkiem stoi wyłącznie
 * obserwacja (`reading.*`); zalecenie widzi autor w edytorze bloku
 * (`advice.*` w nakładce `i18n-charts-editor.ts`). Klucz z `null` nie ma
 * połowy obserwacyjnej wcale i dlatego na stronie publicznej milczy.
 */
const READING_KEYS: Record<BoxplotFormAdvice, string | null> = {
  dotsBetter: "boxplot.reading.dotsBetter",
  tiesDominant: "boxplot.reading.tiesDominant",
  singleGroup: "boxplot.reading.singleGroup",
};

/** Geometria jednej kolumny w pikselach. Model podaje udziały, tu są piksele. */
interface Column {
  box: BoxplotBox;
  /** Środek pasma grupy. */
  cx: number;
  /** Szerokość pudła PO przycięciu sufitem. */
  boxW: number;
  /** Szerokość poprzeczki wąsa, przycięta tym samym współczynnikiem co pudło. */
  capW: number;
  /** Całe pasmo - do podświetlenia strefy trafienia. */
  bandX: number;
  bandW: number;
}

interface BoxplotChartProps {
  config: ChartConfig;
  lang: ChartLang;
}

export function BoxplotChart({ config, lang }: BoxplotChartProps) {
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

  const model: BoxplotModel = useMemo(() => boxplotModelFromConfig(config), [config]);
  const boxes = model.boxes;
  const height = config.height;

  // `useTapAwayDismiss` MUSI stać przed jakimkolwiek wczesnym wyjściem - hooki
  // nie mogą się warunkowo pomijać, a wyjście "brak grup" jest niżej.
  const clearActive = useCallback(() => setActive(null), []);
  useTapAwayDismiss(active !== null, widthRef, clearActive);

  const geometry = useMemo(() => {
    // ZAKRES BIERZE POD UWAGĘ OBSERWACJE ODSTAJĄCE (`boxplotExtent`), bo skala
    // policzona z samych wąsów zostawiłaby je za krawędzią pola rysunku -
    // a przycięty punkt odstający jest gorszy od jego braku: rysunek pokazuje
    // wtedy rozkład bez ogona i wygląda na kompletny.
    const extent = boxplotExtent(model);
    const scale = niceScale(extent.min, extent.max, valueTickTarget(height, false));
    // Szerokość etykiety podziałki wyznacza lewy margines - inaczej liczba
    // wychodzi za płytę i zostaje ucięta (sekcja 4: mierz, potem układaj).
    const tickW = Math.max(
      ...scale.ticks.map((tk) => estimateLabelWidth(formatAxisTick(tk, lang), FONT_AXIS)),
      0,
    );
    const padLeft = Math.max(PAD_LEFT_MIN, Math.ceil(tickW) + PAD_SIDE);
    const innerW = Math.max(MIN_INNER_W, width - padLeft - PAD_SIDE);
    const innerH = Math.max(MIN_INNER_H, height - PAD_TOP - CATEGORY_AXIS_H);
    const value = linearScale(scale.min, scale.max, PAD_TOP + innerH, PAD_TOP);
    const columns: Column[] = model.boxes.map((box) => {
      const raw = box.width * innerW;
      const boxW = Math.min(raw, BOX_MAX_PX);
      // PRZYCIĘCIE MUSI OBJĄĆ POPRZECZKĘ TYM SAMYM WSPÓŁCZYNNIKIEM. Gdyby
      // sufit dotyczył tylko pudła, poprzeczka (połowa szerokości pudła
      // NIEPRZYCIĘTEGO) wyszłaby szersza od pudła i czytałaby się jako druga,
      // szersza granica odczytu - czyli jako informacja, której nie ma.
      const clampFactor = raw > 0 ? boxW / raw : 0;
      return {
        box,
        cx: padLeft + box.center * innerW,
        boxW,
        capW: box.capWidth * innerW * clampFactor,
        bandX: padLeft + box.band.start * innerW,
        bandW: Math.max(0, (box.band.end - box.band.start) * innerW),
      };
    });
    return { scale, padLeft, innerW, innerH, value, columns };
  }, [model, height, width, lang]);

  const { scale, padLeft, innerW, innerH, value, columns } = geometry;

  // WARIANT WYPEŁNIENIA schodzi do solidnego, gdy grup jest więcej niż jedna,
  // i tak ma być: blade wnętrze nie niesie tożsamości serii (odległość CIELAB
  // między bladymi wypełnieniami spada do ~1,1), a tu kolor jest jedynym
  // nośnikiem tożsamości grupy - patrz `resolveBarStyle`.
  const barStyle = resolveBarStyle(config.barStyle, {
    seriesCount: boxes.length,
    stacked: false,
    patterned: false,
  });
  const edged = barStyleHasEdge(barStyle);
  const cascade = cascadeStepMs(boxes.length);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    if (boxes.length === 0) return;
    if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      e.preventDefault();
      const delta = e.key === "ArrowRight" ? 1 : -1;
      setActive((prev) => {
        const next = prev === null ? (delta > 0 ? 0 : boxes.length - 1) : prev + delta;
        return Math.max(0, Math.min(boxes.length - 1, next));
      });
      return;
    }
    if (e.key === "Escape") setActive(null);
  };

  if (boxes.length === 0) return null;

  // STREFA TRAFIENIA IDZIE PRZEZ `bandIndex`, nie przez kształt elementu:
  // skrzynka o zerowym IQR ma wysokość obwódki i byłaby nietrafialna, a pasmo
  // grupy jest trafialne zawsze (sekcja 6).
  const indexFromPointer = (e: PointerEvent<SVGRectElement>): number => {
    const point = pointerToPlot(
      e.clientX,
      e.clientY,
      e.currentTarget.getBoundingClientRect(),
      innerW,
      innerH,
    );
    if (point === null) return 0;
    return bandIndex(point.x, innerW / boxes.length, boxes.length);
  };

  const activeColumn: Column | null = active === null ? null : (columns[active] ?? null);

  const num = (v: number | null): string =>
    v === null ? "-" : formatChartValue(v, lang, config.unit);

  // DYMEK PODAJE PIĘĆ LICZB, NIE JEDNĄ. Kolejność jest kolejnością odczytu
  // skrzynki od środka na zewnątrz: mediana (mocna, bo to ona jest poziomem),
  // pudło, wąsy, ogon, próba. Przy próbie poniżej progu kwartyli wiersze
  // kwartyli MILCZĄ, a nie pokazują zer - zostają min, max i `n`, bo skrajne
  // obserwacje są uczciwe przy każdej liczności.
  const tooltipRows: TooltipRow[] = (() => {
    if (activeColumn === null) return [];
    const b = activeColumn.box;
    const rows: TooltipRow[] = [];
    if (b.hasQuartiles) {
      rows.push({
        name: t("boxplot.tooltip.median"),
        value: num(b.median),
        colorSlot: b.colorSlot,
        emphasised: true,
      });
      rows.push({
        name: t("boxplot.tooltip.quartiles"),
        value: `${num(b.q1)} ${RANGE_SEP} ${num(b.q3)}`,
        colorSlot: null,
      });
      rows.push({
        name: t("boxplot.tooltip.whiskers"),
        value: `${num(b.whiskerLow)} ${RANGE_SEP} ${num(b.whiskerHigh)}`,
        colorSlot: null,
      });
      // Wiersz ogona TYLKO wtedy, gdy ogon istnieje: "0 obserwacji
      // odstających" jest wierszem bez informacji, który rozsadza dymek.
      if (b.outliers.length > 0) {
        rows.push({
          name: t("boxplot.tooltip.outliers"),
          value: formatChartValue(b.outliers.length, lang, ""),
          colorSlot: null,
        });
      }
    } else if (b.n > 0) {
      rows.push({ name: t("boxplot.table.min"), value: num(b.min), colorSlot: null });
      rows.push({ name: t("boxplot.table.max"), value: num(b.max), colorSlot: null });
    }
    // `n` JEST ZAWSZE, także dla grupy pustej - wtedy jest jedyną treścią
    // dymka i mówi czytelnikowi, że kolumna jest pusta, a nie że rysunek się
    // zepsuł.
    rows.push({
      name: t("boxplot.tooltip.n"),
      value: formatChartValue(b.n, lang, ""),
      colorSlot: null,
    });
    return rows;
  })();

  // NAZWA DOSTĘPNA NIESIE LICZBY, nie nazwę rodzaju. Czytnik ekranu nie widzi
  // ani osi, ani podpisu pod rysunkiem, więc medianę i `n` każdej grupy dostaje
  // tutaj - to jest ta sama treść, którą widzący czytelnik odczytuje z pozycji
  // kreski i z etykiety pod kolumną.
  const ariaLabel = [
    config.title,
    `${t("boxplot.axis.value")}: ${formatAxisTick(scale.min, lang)} ${RANGE_SEP} ${formatAxisTick(
      scale.max,
      lang,
    )}`,
    ...boxes.map(
      (b) =>
        `${b.label}: ${t("boxplot.table.median")} ${num(b.median)}, ${t("boxplot.table.n")} ${formatChartValue(
          b.n,
          lang,
          "",
        )}`,
    ),
  ]
    .filter(Boolean)
    .join(". ");

  // PORADY FORMY I DEFEKTY DANYCH stoją pod rysunkiem, bo dotyczą tego, co
  // czytelnik właśnie widzi: "jedna grupa" i "jedna wartość zajmuje połowę
  // próby" zmieniają sposób czytania obrazka, a niezgodność zadeklarowanego
  // `n` z arkuszem znaczy, że podpis i wykres mówią o dwóch różnych badaniach.
  const notes: ChartNote[] = [
    ...boxplotFormAdvice(model)
      .map((a) => ({ a, klucz: READING_KEYS[a] }))
      .filter((x): x is { a: BoxplotFormAdvice; klucz: string } => x.klucz !== null)
      .map(({ a, klucz }) => ({ key: `reading.${a}`, text: t(klucz), defect: false })),
  ];
  if (model.honesty.outlierPartitionOk === false) {
    notes.push({
      key: "honesty.outlierPartitionOk",
      text: t("boxplot.honesty.outlierPartitionOk"),
      defect: true,
    });
  }
  if (model.honesty.declaredSampleSizeOk === false) {
    notes.push({
      key: "honesty.declaredSampleSizeOk",
      text: t("boxplot.honesty.declaredSampleSizeOk", {
        declared: config.sampleSize ?? 0,
        actual: boxes
          .filter((b) => b.n > 0)
          .map((b) => b.n)
          .join(", "),
      }),
      defect: true,
    });
  }

  const plotBottom = PAD_TOP + innerH;

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
        {/* BEZ `viewBox`: jedna jednostka użytkownika to jeden piksel CSS, więc
            próg `HIT_RADIUS_PX` w `plot.ts` znaczy to, co mówi jego nazwa. */}
        <svg width={width} height={height} className="block overflow-visible">
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

          {/* Oś kategorii. NIE jest linią zera: skrzynka koduje POŁOŻENIE na
              wspólnej skali, a nie długość od zera, więc oś wartości nie jest
              tu dociągana do zera (ucięcie nazywa podpis, sekcja 8). */}
          <line
            x1={padLeft}
            x2={padLeft + innerW}
            y1={plotBottom}
            y2={plotBottom}
            stroke="var(--chart-axis)"
            strokeWidth={1}
          />

          {/* PODŚWIETLENIE PASMA jest wizualnym śladem strefy trafienia, nie
              podświetleniem danych - dlatego bierze kolor z reguły `.neh-hit`
              w arkuszu (dodatek krycia, nigdy przygaszenie sąsiadów) i nie
              łapie wskaźnika, żeby nie odbierać zdarzeń warstwie trafień. */}
          {activeColumn !== null && (
            <rect
              className="neh-hit"
              data-role="band"
              data-active="true"
              x={activeColumn.bandX}
              y={PAD_TOP}
              width={activeColumn.bandW}
              height={innerH}
              pointerEvents="none"
            />
          )}

          {columns.map((col, i) => {
            const b = col.box;
            const slot = b.colorSlot;
            const left = col.cx - col.boxW / 2;
            const capLeft = col.cx - col.capW / 2;
            const q1 = b.q1;
            const q3 = b.q3;
            const median = b.median;
            const wLow = b.whiskerLow;
            const wHigh = b.whiskerHigh;
            const edgeInk = `var(--chart-${slot}-edge)`;
            // MEDIANA NA WYPEŁNIENIU SOLIDNYM IDZIE W KOLORZE PŁYTY, bo ciemna
            // kreska na nasyconym wypełnieniu tego samego odcienia ma kontrast
            // poniżej progu linii (3,0:1) i mediana - najważniejsza liczba na
            // rysunku - stawałaby się domysłem. Na wnętrzu bladym odwrotnie:
            // najmocniejszym dostępnym tuszem jest token krawędzi.
            const medianInk = barStyle === "solid" ? "var(--card)" : edgeInk;
            return (
              <g key={b.index}>
                {/* WĄS: jedna pionowa kreska od dolnej do górnej obserwacji
                    w zasięgu ogrodzenia. Rysowana POD pudłem, żeby jej odcinek
                    wewnątrz pudła nie konkurował z medianą. */}
                {wLow !== null && wHigh !== null && (
                  <line
                    x1={col.cx}
                    x2={col.cx}
                    y1={value(wLow)}
                    y2={value(wHigh)}
                    stroke={edgeInk}
                    className="neh-fade"
                    data-role="whisker"
                    style={{ strokeWidth: "var(--chart-bar-edge, 1.5px)" }}
                  />
                )}
                {/* POPRZECZKI na końcach wąsów - stoją na OBSERWACJACH, nie na
                    ogrodzeniach, i mają połowę szerokości pudła
                    (`WHISKER_CAP_RATIO`), żeby nie konkurowały z krawędzią
                    pudła o rolę granicy odczytu. */}
                {wHigh !== null && (
                  <line
                    x1={capLeft}
                    x2={capLeft + col.capW}
                    y1={value(wHigh)}
                    y2={value(wHigh)}
                    stroke={edgeInk}
                    className="neh-fade"
                    data-role="cap"
                    data-end="high"
                    style={{ strokeWidth: "var(--chart-bar-edge, 1.5px)" }}
                  />
                )}
                {wLow !== null && (
                  <line
                    x1={capLeft}
                    x2={capLeft + col.capW}
                    y1={value(wLow)}
                    y2={value(wLow)}
                    stroke={edgeInk}
                    className="neh-fade"
                    data-role="cap"
                    data-end="low"
                    style={{ strokeWidth: "var(--chart-bar-edge, 1.5px)" }}
                  />
                )}
                {/* PUDŁO od q1 do q3. BEZ ZAOKRĄGLENIA NAROŻNIKÓW, i to jest
                    wyjątek od promienia domu: słupek ma podstawę kwadratową
                    i jeden koniec danych, a pudło jest odczytywane na OBU
                    krawędziach poziomych - zaokrąglenie cofa masę krawędzi do
                    środka dokładnie tam, gdzie czytelnik bierze liczbę
                    kwartyla. Przy małym IQR promień zamieniłby pudło
                    w pigułkę. */}
                {q1 !== null && q3 !== null && (
                  <rect
                    x={left}
                    y={value(q3)}
                    width={col.boxW}
                    height={Math.max(0, value(q1) - value(q3))}
                    fill={
                      barStyle === "solid" ? `var(--chart-${slot})` : `var(--chart-${slot}-inner)`
                    }
                    stroke={edged ? edgeInk : undefined}
                    className="neh-bar"
                    data-role="box"
                    data-active={active === i ? "true" : undefined}
                    data-edged={edged ? "true" : undefined}
                    data-style={barStyle}
                    style={{
                      ["--neh-i" as string]: i,
                      ["--neh-bar-hover" as string]: `var(--chart-${slot}-hover)`,
                      ["--neh-bar-token" as string]: `var(--chart-${slot})`,
                    }}
                  />
                )}
                {/* MEDIANA - osobny element, półtora raza grubszy od krawędzi
                    pudła, spinający całą jego szerokość. Patrz nagłówek pliku:
                    to ona utrzymuje na rysunku grupę o IQR = 0, której pudło
                    ma wysokość zero i w ogóle nie jest rysowane. */}
                {median !== null && (
                  <line
                    x1={left}
                    x2={left + col.boxW}
                    y1={value(median)}
                    y2={value(median)}
                    stroke={medianInk}
                    className="neh-fade"
                    data-role="median"
                    style={{ strokeWidth: "calc(var(--chart-stroke, 2px) * 1.5)" }}
                  />
                )}
                {/* OBSERWACJE ODSTAJĄCE - każda jako pojedyncza kropka, nigdy
                    jako przedłużenie wąsa. Rozsunięcie remisów jest
                    DETERMINISTYCZNE i pochodzi z modelu (`offset`), bo losowy
                    jitter zmieniałby obrazek przy każdym renderze i przy dwóch
                    punktach sugerowałby różnicę, której nie ma. Wypełnienie
                    odróżnia stopień: pusta kropka to "poza 1,5 IQR", pełna to
                    "poza 3 IQR" - a to jest realna różnica w ogonie, nie
                    ozdoba. */}
                {b.outliers.map((p, k) => (
                  <circle
                    key={`o${k}`}
                    cx={col.cx + p.offset * col.boxW}
                    cy={value(p.value)}
                    r={DOT_R}
                    fill={p.severity === "far" ? `var(--chart-${slot})` : "var(--card)"}
                    stroke={p.severity === "far" ? "var(--card)" : `var(--chart-${slot})`}
                    strokeWidth={1.6}
                    className="neh-dot neh-fade"
                    data-role="outlier"
                    data-severity={p.severity}
                  />
                ))}
                {/* PRÓBA PONIŻEJ PROGU KWARTYLI: model milczy o kwartylach
                    i oddaje surowe obserwacje, więc kolumna jest kolumną
                    kropek. Skrzynka z czterech liczb udawałaby statystykę
                    rzędu, której nie ma. */}
                {b.points.map((p, k) => (
                  <circle
                    key={`p${k}`}
                    cx={col.cx + p.offset * col.boxW}
                    cy={value(p.value)}
                    r={DOT_R}
                    fill={`var(--chart-${slot}-inner)`}
                    stroke={edgeInk}
                    strokeWidth={1.6}
                    className="neh-dot neh-fade"
                    data-role="point"
                    data-severity={p.severity}
                  />
                ))}
                {/* ETYKIETA BEZPOŚREDNIA MEDIANY, gdy autor włączył wartości.
                    Tylko mediana: pięć liczb wypisanych przy kolumnie zasłania
                    rysunek, a mediana jest tą, o którą czytelnik pyta
                    najpierw. Pozostałe cztery są w dymku i w tabeli. */}
                {config.showValues && median !== null && (
                  <text
                    x={left + col.boxW + 6}
                    y={value(median) + 3.5}
                    textAnchor="start"
                    fontSize={FONT_AXIS}
                    fill="var(--foreground)"
                    className="neh-fade neh-value-label tabular-nums"
                    data-role="median-label"
                  >
                    {num(median)}
                  </text>
                )}
              </g>
            );
          })}

          {/* OŚ KATEGORII: dwa wiersze na grupę. Drugi wiersz to `n` i jest
              obowiązkowy - bez niego dwie kolumny o identycznym kształcie mówią
              to samo o próbie pięciu i o próbie pięciuset. */}
          {columns.map((col) => {
            const b = col.box;
            // Budżet znaków z SZEROKOŚCI PASMA, nie ze stałej: pasmo zależy od
            // liczby grup, więc stała liczba znaków albo ucinałaby etykiety
            // mieszczące się w szerokim paśmie, albo przepuszczała nachodzenie
            // w wąskim. Pełna treść zostaje w `<title>` i w tabeli - wielokropek
            // bez dostępu do pełnego napisu jest zakazany (sekcja 4).
            const budget = Math.max(3, Math.floor(col.bandW / (FONT_AXIS * CHAR_WIDTH_RATIO)));
            const clipped = b.label.length > budget;
            return (
              <g key={`l${b.index}`}>
                <text
                  x={col.cx}
                  y={plotBottom + LABEL_BASELINE}
                  textAnchor="middle"
                  fontSize={FONT_AXIS}
                  fill="var(--muted-foreground)"
                  data-role="group-label"
                >
                  {clipped ? `${b.label.slice(0, Math.max(1, budget - 1))}…` : b.label}
                  {clipped && <title>{b.label}</title>}
                </text>
                <text
                  x={col.cx}
                  y={plotBottom + LABEL_BASELINE + FONT_AXIS + 1}
                  textAnchor="middle"
                  fontSize={FONT_AXIS}
                  fill="var(--muted-foreground)"
                  className="tabular-nums"
                  data-role="group-n"
                >
                  {`${t("boxplot.table.n")} ${formatChartValue(b.n, lang, "")}`}
                </text>
              </g>
            );
          })}

          {/* Warstwa trafień - JEDNA na całe pole, nad grafiką, `fill:
              transparent`. Adres liczy `bandIndex`, bo grupy siedzą w pasmach
              równej szerokości. */}
          <rect
            className="neh-hit"
            data-role="hits"
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
          visible={activeColumn !== null}
          x={activeColumn?.cx ?? 0}
          y={
            activeColumn === null
              ? 0
              : // Kotwica na MEDIANIE, gdy jest - dymek wychodzi wtedy z liczby,
                // o którą czytelnik pyta. Bez kwartyli kotwicą jest środek pasma
                // w pionie, bo nie ma pozycji, która niosłaby poziom.
                value(activeColumn.box.median ?? activeColumn.box.max ?? scale.min)
          }
          containerWidth={width}
          title={activeColumn?.box.label ?? ""}
          rows={tooltipRows}
        />
      </div>

      {/* ALTERNATYWA TEKSTOWA NIE STOI TUTAJ, i to jest rozstrzygnięcie, nie
          brak. Do podłączenia tego rodzaju render niósł WŁASNĄ kopię tabeli
          w `sr-only`, bo panel danych ramki (`ChartFrame`, przełącznik
          „Pokaż dane”) jest domyślnie `hidden`, czyli poza drzewem
          dostępności - kopia była wtedy jedyną drogą do liczby dla czytnika
          ekranu. Po podłączeniu rodzaju do `TABLE_BY_KIND` ramka renderuje tę
          samą tabelę drugi raz, więc po otwarciu panelu czytnik dostawał
          WSZYSTKIE liczby dwa razy, bez sygnału, że to ta sama tabela. Dwie
          nierozróżnialne tabele są gorsze niż jedno naciśnięcie przycisku:
          przełącznik jest zwykłym `button` z `aria-expanded` i `aria-controls`,
          czyli wzorcem, który czytnik ekranu nazywa i którym steruje. Warunek
          powrotu kopii jest jeden: gdyby ramka przestała renderować tabelę
          tego rodzaju. Tabela mieszka w `Chart.tsx` (`TABLE_BY_KIND`) i liczy
          Z TEGO SAMEGO MODELU co rysunek - dwa liczenia to dwa źródła
          prawdy. */}

      <ChartNotes notes={notes} />
    </div>
  );
}
