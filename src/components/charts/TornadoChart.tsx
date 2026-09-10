// TORNADO - WRAŻLIWOŚĆ WYNIKU NA WIELE PARAMETRÓW JEDNOCZEŚNIE.
//
// PYTANIE ANALITYCZNE. Wiersz z tabeli doboru formy (sekcja 1 specyfikacji):
// "Wrażliwość na wiele parametrów -> tornado", a w kolumnie "Czego unikać"
// stoi jedna pozycja: "seria osobnych wykresów". To jest cała racja bytu tego
// rodzaju. Dziesięć paneli, po jednym na parametr, nie odpowiada na pytanie,
// które autor faktycznie zadaje - KTÓRY parametr rusza wynikiem najmocniej.
// Odpowiedź jest PORÓWNANIEM DŁUGOŚCI, a długości leżące na dziesięciu
// osiach porównuje się w głowie i z błędem. Tornado kładzie wszystkie
// rozpiętości na JEDNEJ osi i porządkuje je malejąco, więc ranking czyta się
// z sylwetki rysunku.
//
// CZEGO DLA TEGO RODZAJU NIE WOLNO - i co z tego wynika DLA PIKSELI, bo każdy
// zakaz modelu (`lib/charts/kinds/tornado.ts`) ma tu swoje odbicie:
//   * NIE WOLNO ZMIENIAĆ KOLEJNOŚCI WIERSZY. Kolejność malejąca po
//     rozpiętości JEST treścią tej formy: czytelnik odczytuje hierarchię
//     wrażliwości z góry na dół. Dlatego render nigdy nie indeksuje wierszy
//     numerem kategorii - iteruje po `model.rows`, które są już posortowane,
//     a numer arkuszowy jedzie obok jako `data-index` wyłącznie do diagnozy;
//   * NIE WOLNO RYSOWAĆ SŁUPKÓW BEZ PRZYPADKU BAZOWEGO. Słupek wychodzi
//     Z LINII BAZOWEJ i jego długość koduje odchylenie od niej. Model przy
//     braku bazy nie oddaje ani jednej nogi, więc rysunek zostaje bez
//     słupków, a liczby idą do tabeli i do porady formy. To nie jest awaria
//     renderu, tylko jego jedyna uczciwa odpowiedź;
//   * NIE WOLNO SYMETRYZOWAĆ ROZPIĘTOŚCI WOKÓŁ BAZY. Parametr, który w górę
//     daje +2, a w dół -8, musi tak wyglądać: obie nogi są mierzone od bazy
//     osobno, żadna nie jest wyprowadzana z drugiej, a linia bazowa NIE stoi
//     w środku wiersza. Wyśrodkowanie byłoby błędem tej samej klasy co
//     ucięta oś, bo asymetria jest tu informacją, nie usterką;
//   * ZNAK KODUJEMY POZYCJĄ I KOLOREM JEDNOCZEŚNIE (sekcja 2). Noga nad bazą
//     leży PO PRAWEJ i nosi token dodatni, noga pod bazą PO LEWEJ i token
//     ujemny. Kolor jest tu drugim nośnikiem, nie pierwszym - około 8%
//     mężczyzn nie odróżnia czerwieni od zieleni i dla nich wykres kodowany
//     samym kolorem jest pusty;
//   * PARAMETR ODWROTNY MUSI BYĆ NAZWANY. Para, w której wartość dolna daje
//     wynik WYŻSZY od górnej, jest defektem danych i zarazem najciekawszą
//     informacją w całej analizie ("wynik rośnie, gdy parametr maleje").
//     Ciche posortowanie pary zabrałoby czytelnikowi jedno i drugie, więc
//     wiersz dostaje znacznik przy etykiecie (z `tornado.note.inverted`
//     w tytule) i przypis pod rysunkiem z nazwą parametru.
//
// DECYZJA ARCHITEKTONICZNA: JEDEN WIERSZ TO DWA OSOBNE SŁUPKI ROZCHODZĄCE SIĘ
// Z LINII BAZOWEJ, A NIE JEDEN PASEK OD "NISKIEJ" DO "WYSOKIEJ".
//
// Alternatywa, którą odrzuciłem, to pojedynczy prostokąt od `low` do `high`
// pokolorowany po kawałkach. Jest gorsza z trzech powodów:
//   1. jeden prostokąt ma JEDNĄ krawędź odniesienia, a tornado ma ją
//      w środku. Kwadratowa podstawa i najgłębszy stopień wypełnienia siedzą
//      przy linii bazowej (sekcja 3), a zaokrąglony koniec danych na
//      zewnątrz - w jednym prostokącie oba końce byłyby końcami danych i albo
//      podstawa dostałaby promień (czyli masa odjechałaby od bazy, dokładnie
//      jak przy przesuniętej osi), albo zaokrąglenia nie byłoby wcale;
//   2. animacja wejścia rośnie od krawędzi odniesienia (`.neh-bar-h` skaluje
//      od lewej, `.neh-bar-h.neh-bar-negative` od prawej). Jeden prostokąt
//      wjeżdżałby od swojej lewej krawędzi, czyli od wartości, a nie od bazy,
//      i przez pół sekundy pokazywałby odchylenie, którego nie ma;
//   3. przy parze JEDNOSTRONNEJ (oba końce parametru po tej samej stronie
//      bazy, co przy niemonotonicznej odpowiedzi wyniku jest prawdą, a nie
//      pomyłką) prostokąt od `low` do `high` NIE dotykałby bazy, więc jego
//      długość przestałaby być odchyleniem, a wykres pokazywałby ranking
//      inny niż ten, po którym sam posortował wiersze (model sortuje po
//      ROZPIĘTOŚCI WIDOCZNEJ, czyli z bazą włączoną).
//
// Cena tej decyzji jest jedna i trzeba ją było zapłacić jawnie: przy parze
// jednostronnej dwie nogi z tej samej strony NAKŁADAŁYBY się na siebie, więc
// krótsza z nich nie jest tu słupkiem, a KRESKĄ w poprzek dłuższego
// (`data-role="near-end"`). Dwa nachodzące wypełnienia tego samego odcienia
// dawałyby na styku fałszywą trzecią krawędź, a wymaganie sekcji 1 mówi
// wprost: nic się nie nakłada.
//
// STREFA TRAFIENIA IDZIE PO OSI PIONOWEJ (`bandIndex` na `point.y`), bo
// parametry siedzą w pasmach, a wykres jest poziomy. Kształt słupka strefą
// trafienia być nie może: noga o odchyleniu bliskim zeru ma szerokość
// obwódki, a cały wiersz musi być trafialny zawsze (sekcja 6).
//
// CZEGO TEN KOMPONENT NIE LICZY: niczego. Kolejność wierszy, rozpiętości,
// udziały, asymetria, wykrycie odwróconej pary, rozstrzygnięcie bazy
// i wszystkie samosprawdzenia są w modelu i mają własny plik testowy. Tu jest
// wyłącznie skalowanie na piksele - dzięki temu ta sama arytmetyka obsługuje
// alternatywę tekstową, której nikt nie renderuje przez SVG.
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
import {
  formatAxisTick,
  formatChartValue,
  formatPercent,
  type ChartLang,
} from "@/lib/charts/format";
import { linearScale, niceScale } from "@/lib/charts/scale";
import {
  TORNADO_COLUMNS,
  TORNADO_ROWS_ADVICE_MAX,
  tornadoExtent,
  tornadoFormAdvice,
  tornadoModelFromConfig,
  tornadoTable,
  type TornadoColumnKey,
  type TornadoFormAdvice,
  type TornadoLeg,
  type TornadoModel,
  type TornadoRow,
  type TornadoSide,
  type TornadoTableRow,
} from "@/lib/charts/kinds/tornado";
import {
  BAR_EDGE_INSET,
  BAR_MAX,
  CATEGORY_LABEL_MAX_CHARS,
  CATEGORY_LABEL_MAX_WIDTH,
  FONT_AXIS,
  MIN_INNER_H,
  MIN_INNER_W,
  PAD_BOTTOM,
  PAD_LEFT_CATEGORY_MIN,
  PAD_SIDE,
  PAD_TOP_WITH_LABELS,
  cascadeStepMs,
  clampBarRadius,
  valueTickTarget,
} from "@/lib/charts/geometry";
import { bandIndex, pointerToPlot } from "@/lib/charts/plot";
import { barStyleHasEdge, resolveBarStyle } from "@/lib/charts/palette";
import {
  CHAR_WIDTH_RATIO,
  estimateLabelWidth,
  estimateMaxLabelWidth,
} from "@/lib/charts/measureText";
import { useContainerWidth } from "@/hooks/useContainerWidth";
import { useRevealOnScroll, revealClassName } from "@/hooks/useRevealOnScroll";
import { useTapAwayDismiss } from "@/hooks/useTapAwayDismiss";
import { ChartTooltip, type TooltipRow } from "./ChartTooltip";
import "@/lib/i18n-charts";

/**
 * Rozdzielnik zakresu. Półpauza, nie myślnik: para liczb to zakres, a nie
 * zdanie wtrącone.
 */
const RANGE_SEP = "–";

/** Rozdzielnik "nazwa parametru - treść przypisu" w przypisach pod rysunkiem. */
const NOTE_SEP = " - ";

/**
 * Znacznik parametru odwrotnego. Sam glif niczego nie tłumaczy i nie ma
 * tłumaczyć - jest zaczepem dla `<title>`, w którym siedzi zdanie ze słownika
 * (`tornado.note.inverted`), oraz drugim, wizualnym nośnikiem tej samej
 * informacji co przypis pod rysunkiem. Dwie strzałki w przeciwnych
 * kierunkach, bo defekt polega właśnie na odwróceniu kierunku wpływu.
 */
const INVERTED_MARK = "⇅";

/**
 * Miejsce zarezerwowane w lewym marginesie na znacznik parametru odwrotnego,
 * w pikselach.
 *
 * Rezerwa jest STAŁA I WSPÓLNA dla wszystkich wierszy, także tych bez
 * znacznika, i to jest jej cały sens: gdyby zależała od tego, czy wiersz jest
 * odwrócony, etykiety parametrów przestałyby być wyrównane do jednej
 * krawędzi, a nierówny prawy brzeg kolumny etykiet czyta się jako
 * przypadkowość rysunku. Szerokość równa stopniowi pisma osi, bo glif
 * znacznika jest jednym znakiem tego pisma.
 */
const MARK_RESERVE_PX = FONT_AXIS;

/** Odstęp etykiety od krawędzi, do której jest przypięta. */
const LABEL_GAP_PX = 6;

/** Odsunięcie wiersza etykiet podziałki od dolnej krawędzi pola rysunku. */
const AXIS_BASELINE_PX = 16;

/**
 * Korekta pionowa środka wiersza tekstu wobec linii bazowej pisma. Połowa
 * wysokości cyfry przy `FONT_AXIS`, więc etykieta stoi w osi tego, co
 * opisuje, a nie pół znaku nad nim.
 */
const TEXT_MIDDLE_PX = 3.5;

/**
 * Klucze porad formy WYPISANE JAWNIE, a nie sklejone z wartości modelu.
 * Bramka rozjazdu kod<->słownik i kontrola parytetu PL/EN widzą wyłącznie
 * pełne ścieżki, więc `t(\`tornado.advice.${a}\`)` byłby dla nich niewidoczny.
 */
const ADVICE_KEYS: Record<TornadoFormAdvice, string> = {
  noBase: "tornado.advice.noBase",
  singleParameter: "tornado.advice.singleParameter",
  flatRanking: "tornado.advice.flatRanking",
  tooManyRows: "tornado.advice.tooManyRows",
};

/** Nagłówki kolumn alternatywy tekstowej - też jawnie, z tego samego powodu. */
const COLUMN_KEYS: Record<TornadoColumnKey, string> = {
  parameter: "tornado.table.parameter",
  low: "tornado.table.low",
  high: "tornado.table.high",
  lowDelta: "tornado.table.lowDelta",
  highDelta: "tornado.table.highDelta",
  swing: "tornado.table.swing",
  span: "tornado.table.span",
  spanShare: "tornado.table.spanShare",
};

/** Nazwy nóg ze słownika - w dymku i w tytułach kresek końca bliskiego. */
const SIDE_KEYS: Record<TornadoSide, string> = {
  low: "tornado.legend.low",
  high: "tornado.legend.high",
};

/** Koniec DANYCH słupka poziomego - ten, który wolno zaokrąglić. */
type DataEnd = "left" | "right";

/**
 * Prostokąt zaokrąglony WYŁĄCZNIE na końcu danych.
 *
 * Kopia arytmetyki, a nie import: odpowiednik w `CartesianChart` jest tam
 * domknięciem prywatnym, a tego pliku nie wolno mi ruszać. Wersja tutaj jest
 * węższa i to jest zaleta - tornado jest zawsze poziome, więc ma dwa
 * przypadki zamiast pięciu i nie potrzebuje gałęzi "brak zaokrąglenia".
 *
 * `rx` na `<rect>` zaokrągla WSZYSTKIE cztery narożniki, więc kształt musi
 * być ścieżką: zaokrąglona podstawa odsuwałaby masę słupka od linii bazowej
 * i sugerowała, że odchylenie zaczyna się dalej, niż zaczyna (sekcja 3).
 */
function barPath(
  x: number,
  y: number,
  w: number,
  h: number,
  end: DataEnd,
  bordered: boolean,
): string {
  // Wzdłuż osi wartości mieści się JEDEN promień, bo słupek jest zaokrąglony
  // z jednej strony - dlatego `clampBarRadius`, a nie ogranicznik dla
  // prostokąta czterostronnego.
  const r = clampBarRadius(h, w, { bordered });
  if (r <= 0) return `M${x} ${y}h${w}v${h}h${-w}Z`;
  return end === "right"
    ? `M${x} ${y}h${w - r}q${r} 0 ${r} ${r}v${h - 2 * r}q0 ${r} ${-r} ${r}h${-(w - r)}Z`
    : `M${x + w} ${y}v${h}h${-(w - r)}q${-r} 0 ${-r} ${-r}v${-(h - 2 * r)}q0 ${-r} ${r} ${-r}Z`;
}

/** Jedna noga w pikselach: słupek od linii bazowej do wyniku. */
interface LegBox {
  leg: TornadoLeg;
  /** Lewa krawędź kształtu. */
  x: number;
  /** Długość wzdłuż osi wartości. */
  w: number;
  /** Noga pod bazą: koniec danych po lewej, token ujemny. */
  negative: boolean;
  /** Współrzędna końca DANYCH - kotwica etykiety bezpośredniej i dymka. */
  endX: number;
}

/** Koniec bliższy bazy przy parze jednostronnej - kreska, nie słupek. */
interface NearEnd {
  side: TornadoSide;
  value: number;
  x: number;
}

/** Geometria jednego wiersza rankingu. Model podaje udziały, tu są piksele. */
interface Lane {
  row: TornadoRow;
  /** Całe pasmo wiersza - do podświetlenia strefy trafienia. */
  bandY: number;
  bandH: number;
  /** Słupek: grubość z modelu, przycięta sufitem `BAR_MAX`. */
  barY: number;
  barH: number;
  centerY: number;
  legs: LegBox[];
  near: NearEnd | null;
  /** Najdalszy od bazy koniec danych wiersza - kotwica dymka. */
  farX: number;
}

interface TornadoChartProps {
  config: ChartConfig;
  lang: ChartLang;
}

export function TornadoChart({ config, lang }: TornadoChartProps) {
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

  const model: TornadoModel = useMemo(() => tornadoModelFromConfig(config), [config]);
  const rows = model.rows;
  const height = config.height;

  // `useTapAwayDismiss` MUSI stać przed jakimkolwiek wczesnym wyjściem - hooki
  // nie mogą się warunkowo pomijać, a wyjście "brak parametrów" jest niżej.
  const clearActive = useCallback(() => setActive(null), []);
  useTapAwayDismiss(active !== null, widthRef, clearActive);

  const num = useCallback(
    (v: number | null): string => (v === null ? "-" : formatChartValue(v, lang, config.unit)),
    [lang, config.unit],
  );

  const geometry = useMemo(() => {
    // DOMENA ZAWSZE OBEJMUJE LINIĘ BAZOWĄ (`tornadoExtent`), bo od niej
    // rozchodzą się słupki: oś, która bazy nie zawiera, pokazywałaby długości
    // bez punktu, od którego są liczone.
    const extent = tornadoExtent(model);
    const scale = niceScale(extent.min, extent.max, valueTickTarget(height, true));

    // MIERZ, POTEM UKŁADAJ (sekcja 4). Do lewego marginesu wchodzą trzy
    // rzeczy: najdłuższa etykieta parametru, nazwy obu osi (stoją w tej samej
    // kolumnie) i rezerwa na znacznik parametru odwrotnego. Sufit
    // `CATEGORY_LABEL_MAX_WIDTH` broni pola rysunku przed etykietą, która
    // zabrałaby mu połowę szerokości - nadmiar obcina wtedy budżet znaków,
    // a pełna treść zostaje w `<title>` i w tabeli.
    const labelW = Math.max(
      estimateMaxLabelWidth(
        rows.map((r) => r.label),
        FONT_AXIS,
      ),
      estimateLabelWidth(t("tornado.axis.parameter"), FONT_AXIS),
      estimateLabelWidth(t("tornado.axis.value"), FONT_AXIS),
    );
    const labelBlock = Math.min(
      CATEGORY_LABEL_MAX_WIDTH,
      Math.max(PAD_LEFT_CATEGORY_MIN, labelW + LABEL_GAP_PX + MARK_RESERVE_PX),
    );

    // ETYKIETY BEZPOŚREDNIE STOJĄ NA KOŃCACH DANYCH, więc potrzebują miejsca
    // po OBU stronach pola rysunku - noga ujemna kończy się po lewej. Bez
    // rezerwy z lewej strony taka etykieta wchodziłaby w kolumnę nazw
    // parametrów, a wymaganie sekcji 1 mówi: nic się nie nakłada.
    const valueLabelW = config.showValues
      ? rows.reduce((acc, r) => {
          const candidates = [r.low, r.high]
            .filter((v): v is number => v !== null)
            .map((v) => estimateLabelWidth(formatChartValue(v, lang, config.unit), FONT_AXIS));
          return Math.max(acc, ...candidates, 0);
        }, 0) + LABEL_GAP_PX
      : 0;
    const padLeft = labelBlock + valueLabelW;
    const padRight = Math.max(PAD_SIDE, valueLabelW);

    // Górny margines jest ZAWSZE na etykiety: w tym pasku stoi nazwa osi
    // parametrów (w marginesie) i wartość wyniku bazowego (nad linią bazową).
    const padTop = PAD_TOP_WITH_LABELS;
    const innerW = Math.max(MIN_INNER_W, width - padLeft - padRight);
    const innerH = Math.max(MIN_INNER_H, height - padTop - PAD_BOTTOM);
    const value = linearScale(scale.min, scale.max, padLeft, padLeft + innerW);
    const baseX = model.base === null ? null : value(model.base);

    const lanes: Lane[] = rows.map((row) => {
      const centerY = padTop + row.bandCenter * innerH;
      const bandH = row.bandThickness * innerH;
      const barH = Math.min(row.barThickness * innerH, BAR_MAX);

      // NOGI O ODCHYLENIU DOKŁADNIE ZEROWYM NIE DOSTAJĄ KSZTAŁTU. Leżą na
      // linii bazowej, która jest już narysowana na całej wysokości pola,
      // więc półpikselowy kikut w tym samym miejscu byłby drugim, grubszym
      // znakiem bez długości - a czytelnik odczytałby z niego odchylenie,
      // którego nie ma. Sam fakt zerowej rozpiętości nazywa przypis
      // (`honesty.zeroSpanLabels`), a liczby są w dymku i w tabeli.
      const drawn = row.legs.filter((leg) => leg.direction !== "flat");

      // PARA JEDNOSTRONNA: krótsza noga zamienia się w kreskę, patrz nagłówek
      // pliku. Kolejność rozstrzyga MODUŁ odchylenia, nie kolejność serii -
      // słupkiem musi zostać ta noga, która wyznacza rozpiętość widoczną,
      // bo po niej model posortował cały ranking.
      let bars = drawn;
      let near: NearEnd | null = null;
      if (drawn.length === 2 && !row.straddlesBase) {
        const [first, second] = drawn;
        const outer = Math.abs(first.delta) >= Math.abs(second.delta) ? first : second;
        const inner = outer === first ? second : first;
        bars = [outer];
        near = { side: inner.side, value: inner.value, x: value(inner.value) };
      }

      const legs: LegBox[] = bars.map((leg) => {
        const from = value(leg.from);
        const to = value(leg.to);
        const negative = leg.direction === "below";
        return {
          leg,
          x: Math.min(from, to),
          w: Math.abs(to - from),
          negative,
          // Koniec danych wynika ze ZNAKU, nie z pionu ani z kolejności
          // krawędzi: dla nogi pod bazą jest po lewej, dla nogi nad bazą po
          // prawej.
          endX: negative ? Math.min(from, to) : Math.max(from, to),
        };
      });

      const anchor = baseX ?? padLeft + innerW / 2;
      const farX = legs.reduce(
        (acc, box) => (Math.abs(box.endX - anchor) > Math.abs(acc - anchor) ? box.endX : acc),
        anchor,
      );

      return {
        row,
        bandY: centerY - bandH / 2,
        bandH,
        barY: centerY - barH / 2,
        barH,
        centerY,
        legs,
        near,
        farX,
      };
    });

    return { scale, labelBlock, padLeft, padRight, padTop, innerW, innerH, value, baseX, lanes };
  }, [model, rows, height, width, lang, config.showValues, config.unit, t]);

  const { scale, labelBlock, padLeft, padTop, innerW, innerH, value, baseX, lanes } = geometry;

  // WARIANT WYPEŁNIENIA. `seriesCount: 1`, bo dwa kolory tego wykresu to nie
  // dwie serie, tylko dwa ZNAKI odchylenia - blade wnętrze nie musi więc
  // nieść tożsamości serii (to jest warunek, przy którym `resolveBarStyle`
  // schodzi do solidnego). Rozróżnienie znaku niesie POZYCJA względem linii
  // bazowej, a wspiera je obwódka: token krawędzi dodatniej i ujemnej są od
  // siebie odległe także po symulacji daltonizmu, inaczej niż blade wnętrza.
  const barStyle = resolveBarStyle(config.barStyle, {
    seriesCount: 1,
    stacked: false,
    patterned: false,
  });
  const edged = barStyleHasEdge(barStyle);
  const cascade = cascadeStepMs(rows.length);

  // STRZAŁKI PIONOWE, bo pasma są pionowe. Poziome przesuwałyby zaznaczenie
  // wzdłuż osi WARTOŚCI, na której nie ma czego wybierać - ta sama zasada, po
  // której słupki poziome w `CartesianChart` nawigują góra-dół.
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    if (rows.length === 0) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const delta = e.key === "ArrowDown" ? 1 : -1;
      setActive((prev) => {
        const next = prev === null ? (delta > 0 ? 0 : rows.length - 1) : prev + delta;
        return Math.max(0, Math.min(rows.length - 1, next));
      });
      return;
    }
    if (e.key === "Escape") setActive(null);
  };

  if (rows.length === 0) return null;

  // ADRES WIERSZA IDZIE Z PASMA PO OSI PIONOWEJ. Kształt słupka strefą
  // trafienia być nie może: noga o odchyleniu bliskim zeru ma szerokość
  // obwódki, a wiersz o rozpiętości zerowej nie ma kształtu w ogóle - oba
  // muszą pozostać trafialne, bo oba mają liczby do pokazania.
  const indexFromPointer = (e: PointerEvent<SVGRectElement>): number => {
    const point = pointerToPlot(
      e.clientX,
      e.clientY,
      e.currentTarget.getBoundingClientRect(),
      innerW,
      innerH,
    );
    if (point === null) return 0;
    return bandIndex(point.y, innerH / rows.length, rows.length);
  };

  const activeLane: Lane | null = active === null ? null : (lanes[active] ?? null);
  const plotBottom = padTop + innerH;
  const table = tornadoTable(model);

  // DYMEK PODAJE OBA KOŃCE, OBA ODCHYLENIA I ROZPIĘTOŚĆ. Rozpiętość jest
  // wyróżniona wagą pisma, bo to ONA ustawia wiersz w rankingu - czyli jest
  // tą liczbą, którą czytelnik właśnie odczytał z pozycji wiersza.
  const tooltipRows: TooltipRow[] = (() => {
    if (activeLane === null) return [];
    const r = activeLane.row;
    const list: TooltipRow[] = [];
    if (r.low !== null) {
      list.push({ name: t(SIDE_KEYS.low), value: num(r.low), colorSlot: null });
    }
    if (r.high !== null) {
      list.push({ name: t(SIDE_KEYS.high), value: num(r.high), colorSlot: null });
    }
    // Odchylenia TYLKO wtedy, gdy jest od czego je liczyć. Bez bazy byłyby
    // parą kresek, czyli dwoma wierszami bez informacji.
    if (r.lowDelta !== null) {
      list.push({ name: t("tornado.table.lowDelta"), value: num(r.lowDelta), colorSlot: null });
    }
    if (r.highDelta !== null) {
      list.push({ name: t("tornado.table.highDelta"), value: num(r.highDelta), colorSlot: null });
    }
    list.push({
      name: t("tornado.table.span"),
      value: formatChartValue(r.span, lang, config.unit),
      colorSlot: null,
      emphasised: true,
    });
    return list;
  })();

  // Dopisek dymka niesie DEFEKT albo BRAK TREŚCI tego konkretnego wiersza -
  // parametr odwrotny i rozpiętość zerowa zmieniają sposób czytania liczb,
  // które są w dymku obok.
  const tooltipNote =
    activeLane === null
      ? undefined
      : activeLane.row.inverted
        ? t("tornado.note.inverted")
        : activeLane.row.zeroSpan
          ? t("tornado.note.zeroSpan")
          : undefined;

  // NAZWA DOSTĘPNA NIESIE LICZBY I KOLEJNOŚĆ, nie nazwę rodzaju. Czytnik
  // ekranu nie widzi ani sylwetki tornada, ani linii bazowej, więc hierarchię
  // wrażliwości dostaje jako listę w tej samej kolejności, w której są
  // narysowane wiersze - to jest treść tej formy, a nie jej ozdoba.
  const ariaLabel = [
    config.title,
    `${t("tornado.axis.value")}: ${formatAxisTick(scale.min, lang)} ${RANGE_SEP} ${formatAxisTick(
      scale.max,
      lang,
    )}`,
    model.base === null ? "" : t("tornado.base.label", { value: num(model.base) }),
    ...rows.map(
      (r) =>
        `${r.label}: ${num(r.low)} ${RANGE_SEP} ${num(r.high)}, ${t(
          "tornado.table.span",
        )} ${formatChartValue(r.span, lang, config.unit)}`,
    ),
  ]
    .filter(Boolean)
    .join(". ");

  // PRZYPISY POD RYSUNKIEM. Porady formy mówią autorowi, że pytanie lepiej
  // postawić inaczej; przypisy uczciwości mówią czytelnikowi, czego nie widzi
  // na rysunku. Parametr odwrotny jest DEFEKTEM danych (kolor tekstu
  // ujemnego), rozpiętość zerowa i para jednostronna są INFORMACJĄ - obie
  // bywają prawdą o wrażliwości, więc kolor ostrzeżenia byłby o nich
  // nieprawdą.
  const honesty = model.honesty;
  const notes: { key: string; text: string; defect: boolean }[] = [
    ...tornadoFormAdvice(model).map((a) => ({
      key: `advice.${a}`,
      text: t(ADVICE_KEYS[a], { max: TORNADO_ROWS_ADVICE_MAX }),
      defect: false,
    })),
  ];
  if (honesty.invertedLabels.length > 0) {
    notes.push({
      key: "honesty.pairsOrdered",
      text: `${honesty.invertedLabels.join(", ")}${NOTE_SEP}${t("tornado.note.inverted")}`,
      defect: true,
    });
  }
  if (honesty.zeroSpanLabels.length > 0) {
    notes.push({
      key: "honesty.allSpansContribute",
      text: `${honesty.zeroSpanLabels.join(", ")}${NOTE_SEP}${t("tornado.note.zeroSpan")}`,
      defect: false,
    });
  }
  if (honesty.oneSidedLabels.length > 0) {
    notes.push({
      key: "honesty.oneSided",
      text: `${honesty.oneSidedLabels.join(", ")}${NOTE_SEP}${t("tornado.note.baseOutside")}`,
      defect: false,
    });
  }

  const cell = (row: TornadoTableRow, col: TornadoColumnKey): string => {
    switch (col) {
      case "parameter":
        return row.label;
      // POZIOMY WYNIKU MILCZĄ W TRYBIE ODCHYLEŃ BEZ PODANEJ BAZY: powtarzałyby
      // wtedy odchylenia, czyli pokazywałyby liczbę, która wygląda na poziom,
      // a jest odchyleniem.
      case "low":
        return table.hasAbsoluteLevels ? num(row.low) : "-";
      case "high":
        return table.hasAbsoluteLevels ? num(row.high) : "-";
      case "lowDelta":
        return num(row.lowDelta);
      case "highDelta":
        return num(row.highDelta);
      case "swing":
        return num(row.swing);
      case "span":
        return formatChartValue(row.span, lang, config.unit);
      case "spanShare":
        return formatPercent(row.spanShare, lang);
    }
  };

  // Budżet znaków etykiety z SZEROKOŚCI KOLUMNY, nie ze stałej: kolumna
  // zależy od pomiaru, więc stała liczba znaków albo ucinałaby etykiety,
  // które się mieszczą, albo przepuszczała nachodzenie na pole rysunku.
  const labelX = labelBlock - LABEL_GAP_PX - MARK_RESERVE_PX;
  const labelBudget = Math.max(
    3,
    Math.min(CATEGORY_LABEL_MAX_CHARS, Math.floor(labelX / (FONT_AXIS * CHAR_WIDTH_RATIO))),
  );

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
          {/* Siatka osi WARTOŚCI jest pionowa, bo wykres jest poziomy - linie
              biegną tam, gdzie czytelnik odczytuje liczbę końca słupka. */}
          {config.showGrid &&
            scale.ticks.map((tick) => (
              <line
                key={tick}
                x1={value(tick)}
                x2={value(tick)}
                y1={padTop}
                y2={plotBottom}
                stroke="var(--chart-grid)"
                strokeWidth={1}
              />
            ))}

          {scale.ticks.map((tick) => (
            <text
              key={tick}
              x={value(tick)}
              y={plotBottom + AXIS_BASELINE_PX}
              textAnchor="middle"
              fontSize={FONT_AXIS}
              fill="var(--muted-foreground)"
              className="tabular-nums"
              data-role="value-tick"
            >
              {formatAxisTick(tick, lang)}
            </text>
          ))}

          {/* Oś wartości. NIE jest linią zera i nie ma nią być: tornado mierzy
              odchylenia od PRZYPADKU BAZOWEGO, więc krawędzią odniesienia jest
              linia bazowa w środku rysunku, a nie zero na brzegu. */}
          <line
            x1={padLeft}
            x2={padLeft + innerW}
            y1={plotBottom}
            y2={plotBottom}
            stroke="var(--chart-axis)"
            strokeWidth={1}
          />

          {/* Nazwy obu osi stoją w jednej kolumnie, w lewym marginesie: nazwa
              parametrów nad etykietami wierszy, nazwa wyniku w wierszu
              podziałki. Bez nich rysunek nie mówi, co jest mierzone. */}
          <text
            x={labelBlock - LABEL_GAP_PX}
            y={padTop - LABEL_GAP_PX}
            textAnchor="end"
            fontSize={FONT_AXIS}
            fill="var(--muted-foreground)"
            data-role="parameter-axis"
          >
            {t("tornado.axis.parameter")}
          </text>
          <text
            x={labelBlock - LABEL_GAP_PX}
            y={plotBottom + AXIS_BASELINE_PX}
            textAnchor="end"
            fontSize={FONT_AXIS}
            fill="var(--muted-foreground)"
            data-role="value-axis"
          >
            {t("tornado.axis.value")}
          </text>

          {/* PODŚWIETLENIE PASMA jest wizualnym śladem strefy trafienia, nie
              podświetleniem danych - dlatego bierze kolor z reguły `.neh-hit`
              w arkuszu (dodatek krycia, nigdy przygaszenie sąsiadów) i nie
              łapie wskaźnika, żeby nie odbierać zdarzeń warstwie trafień. */}
          {activeLane !== null && (
            <rect
              className="neh-hit"
              data-role="band"
              data-active="true"
              x={padLeft}
              y={activeLane.bandY}
              width={innerW}
              height={activeLane.bandH}
              pointerEvents="none"
            />
          )}

          {/* ===== LINIA BAZOWA - krawędź odniesienia całego rysunku ===== */}
          {baseX !== null && (
            <>
              <line
                x1={baseX}
                x2={baseX}
                y1={padTop}
                y2={plotBottom}
                stroke="var(--chart-axis)"
                strokeWidth={1}
                className="neh-fade"
                data-role="base-line"
              />
              {/* WARTOŚĆ BAZY JEST WYPISANA, nie tylko narysowana: bez liczby
                  linia mówi tylko "tu jest baza", a czytelnik potrzebuje
                  wiedzieć, od jakiego wyniku liczą się wszystkie odchylenia.
                  Zakotwiczenie napisu przełącza się przy krawędziach pola,
                  żeby nie został ucięty (sekcja 4). */}
              <text
                x={baseX}
                y={padTop - LABEL_GAP_PX}
                textAnchor={
                  baseX < padLeft + innerW * 0.15
                    ? "start"
                    : baseX > padLeft + innerW * 0.85
                      ? "end"
                      : "middle"
                }
                fontSize={FONT_AXIS}
                fill="var(--foreground)"
                className="neh-fade neh-value-label tabular-nums"
                data-role="base-label"
              >
                {t("tornado.base.label", { value: num(model.base) })}
              </text>
            </>
          )}

          {/* ===== WIERSZE W KOLEJNOŚCI RANKINGU, z góry na dół ===== */}
          {lanes.map((lane, rank) => {
            const r = lane.row;
            return (
              <g
                key={`${r.index}-${r.label}`}
                data-role="row"
                data-rank={r.rank}
                data-index={r.index}
                data-inverted={r.inverted ? "true" : undefined}
                data-zero-span={r.zeroSpan ? "true" : undefined}
              >
                {lane.legs.map((box) => {
                  // Wsunięcie kształtu o połowę grubości obwódki: `stroke`
                  // leży NA ścieżce, więc bez korekty obwódka zjadałaby
                  // długość, czyli zmniejszała odchylenie.
                  const inset = edged ? BAR_EDGE_INSET : 0;
                  const along = Math.max(edged ? 0 : 0.5, box.w - 2 * inset);
                  const across = Math.max(0, lane.barH - 2 * inset);
                  const sign = box.negative ? "negative" : "positive";
                  // Klasy WYPISANE W PEŁNI, a nie sklejone z fragmentów:
                  // bramka `chartClasses` czyta nazwy klas z literałów
                  // źródła i nazwa zlepiona interpolacją jest dla niej
                  // klasą bez reguły w arkuszu. `neh-bar-negative` odwraca
                  // punkt zaczepienia animacji, więc noga pod bazą rośnie od
                  // linii bazowej, a nie od swojego dalszego końca.
                  const cls = box.negative
                    ? "neh-bar-h neh-bar neh-bar-negative"
                    : "neh-bar-h neh-bar";
                  return (
                    <path
                      key={box.leg.side}
                      d={barPath(
                        box.x + inset,
                        lane.barY + inset,
                        along,
                        across,
                        box.negative ? "left" : "right",
                        edged,
                      )}
                      // Wypełnienie i obwódka WYŁĄCZNIE tokenami - w kodzie
                      // rysującym nie ma ani jednego hexa, więc tryb ciemny
                      // i druk dostają swoje wartości bez gałęzi w JS. Wariant
                      // gradientowy dzieli wypełnienie z bladym: rampa niesie
                      // tożsamość serii, a tutaj kolor niesie ZNAK, którego
                      // pozycja względem bazy koduje już drugi raz.
                      fill={
                        barStyle === "solid" ? `var(--chart-${sign})` : `var(--chart-${sign}-inner)`
                      }
                      stroke={edged ? `var(--chart-${sign}-edge)` : "var(--card)"}
                      className={cls}
                      data-role="leg"
                      data-side={box.leg.side}
                      data-direction={box.leg.direction}
                      data-active={active === rank ? "true" : undefined}
                      data-edged={edged ? "true" : undefined}
                      data-style={barStyle}
                      style={{
                        ["--neh-i" as string]: rank,
                        ["--neh-bar-hover" as string]: `var(--chart-${sign}-hover)`,
                        ["--neh-bar-token" as string]: `var(--chart-${sign})`,
                      }}
                    />
                  );
                })}

                {/* KONIEC BLIŻSZY BAZY przy parze jednostronnej. Kreska
                    w poprzek słupka, nie drugi słupek - patrz nagłówek pliku.
                    Grubość jak obwódka, bo to jest granica odczytu, a nie
                    powierzchnia. */}
                {lane.near !== null && (
                  <line
                    x1={lane.near.x}
                    x2={lane.near.x}
                    y1={lane.barY}
                    y2={lane.barY + lane.barH}
                    // Tusz kreski zależy od wariantu wypełnienia, tak samo
                    // jak mediana w skrzynce: na wnętrzu bladym najmocniejszym
                    // dostępnym znakiem jest tusz strony, a na wypełnieniu
                    // solidnym ciemna kreska na nasyconym odcieniu spada pod
                    // próg linii (3,0:1) i granica odczytu stawałaby się
                    // domysłem - tam kreskę niesie kolor płyty.
                    stroke={barStyle === "solid" ? "var(--card)" : "var(--foreground)"}
                    className="neh-fade"
                    data-role="near-end"
                    data-side={lane.near.side}
                    style={{ strokeWidth: "var(--chart-bar-edge, 1.5px)" }}
                  >
                    <title>{`${t(SIDE_KEYS[lane.near.side])}: ${num(lane.near.value)}`}</title>
                  </line>
                )}

                {/* ETYKIETY BEZPOŚREDNIE STOJĄ NA KOŃCACH DANYCH i podają
                    POZIOM wyniku, nie odchylenie: koniec słupka leży dokładnie
                    tam, gdzie oś pokazuje ten poziom, więc liczba obok niego
                    jest odczytem tej samej pozycji. Odchylenia są w dymku
                    i w tabeli, gdzie mają własne kolumny. */}
                {config.showValues &&
                  lane.legs.map((box) => (
                    <text
                      key={`v${box.leg.side}`}
                      x={box.endX + (box.negative ? -LABEL_GAP_PX : LABEL_GAP_PX)}
                      y={lane.centerY + TEXT_MIDDLE_PX}
                      textAnchor={box.negative ? "end" : "start"}
                      fontSize={FONT_AXIS}
                      fill="var(--foreground)"
                      className="neh-fade neh-value-label tabular-nums"
                      data-role="leg-label"
                      data-side={box.leg.side}
                    >
                      {formatChartValue(box.leg.value, lang, config.unit)}
                    </text>
                  ))}
              </g>
            );
          })}

          {/* ===== KOLUMNA NAZW PARAMETRÓW ===== */}
          {lanes.map((lane) => {
            const r = lane.row;
            const clipped = r.label.length > labelBudget;
            return (
              <g key={`l${r.index}-${r.label}`}>
                <text
                  x={labelX}
                  y={lane.centerY + TEXT_MIDDLE_PX}
                  textAnchor="end"
                  fontSize={FONT_AXIS}
                  fill="var(--muted-foreground)"
                  data-role="param-label"
                >
                  {clipped ? `${r.label.slice(0, Math.max(1, labelBudget - 1))}…` : r.label}
                  {/* Wielokropek bez dostępu do pełnej treści jest zakazany
                      (sekcja 4), więc obcięta etykieta ma pełną nazwę
                      w `<title>`; tabela danych ma ją zawsze. */}
                  {clipped && <title>{r.label}</title>}
                </text>
                {/* ZNACZNIK PARAMETRU ODWROTNEGO. Osobny element, a nie
                    przyrostek etykiety: przyrostek wchodziłby do budżetu
                    znaków i przy dłuższej nazwie zostałby obcięty razem z nią,
                    czyli defekt danych ginąłby dokładnie tam, gdzie brakuje
                    miejsca. Kolor w wariancie TEKSTOWYM tokena ujemnego, bo
                    próg kontrastu dla napisu to 4,5:1, a nie 3,0:1. */}
                {r.inverted && (
                  <text
                    x={labelBlock - LABEL_GAP_PX}
                    y={lane.centerY + TEXT_MIDDLE_PX}
                    textAnchor="end"
                    fontSize={FONT_AXIS}
                    fill="var(--chart-negative-text)"
                    data-role="inverted-mark"
                  >
                    {INVERTED_MARK}
                    <title>{t("tornado.note.inverted")}</title>
                  </text>
                )}
              </g>
            );
          })}

          {/* Warstwa trafień - JEDNA na całe pole, nad grafiką, `fill:
              transparent`. Adres liczy `bandIndex` po współrzędnej PIONOWEJ,
              bo parametry siedzą w pasmach równej wysokości. */}
          <rect
            className="neh-hit"
            data-role="hits"
            x={padLeft}
            y={padTop}
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
          visible={activeLane !== null}
          x={activeLane?.farX ?? 0}
          y={activeLane?.centerY ?? 0}
          containerWidth={width}
          title={activeLane?.row.label ?? ""}
          note={tooltipNote}
          rows={tooltipRows}
        />
      </div>

      {/* ALTERNATYWA TEKSTOWA. Grafika nigdy nie jest jedyną drogą do liczby
          (sekcja 8), a przy braku przypadku bazowego jest tu JEDYNĄ drogą, bo
          rysunek nie ma wtedy ani jednego słupka. Tabela liczy Z TEGO SAMEGO
          modelu co rysunek (`tornadoTable`) i w tej samej kolejności, więc
          wiersz tabeli da się przełożyć na wiersz rysunku bez szukania nazwy.
          `sr-only`, nie widoczna: widoczny panel danych należy do ramki karty
          (`ChartFrame`, przełącznik "Pokaż dane") i gdy podłączenie rodzaju
          doda tam tabelę tornada, ta kopia ma zniknąć - inaczej czytnik ekranu
          dostanie te same liczby dwa razy. */}
      <table className="sr-only">
        <thead>
          <tr>
            {TORNADO_COLUMNS.map((colKey) => (
              <th key={colKey} scope="col">
                {t(COLUMN_KEYS[colKey])}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {table.rows.map((row, i) => (
            /* Przypisy wiersza jadą ATRYBUTEM, a nie kolumną tekstu: słownik
               ma dziś zdania dla parametru odwrotnego, rozpiętości zerowej
               i bazy poza przedziałem, ale nie dla pary niekompletnej, remisu
               rozpiętości ani powtórzonej etykiety. Wpisanie tam najbliższego
               istniejącego zdania byłoby podpisaniem wiersza cudzą treścią,
               czyli kłamstwem - a atrybut zachowuje fakt do czasu, gdy klucze
               dojadą. */
            <tr key={i} data-notes={row.notes.join(" ") || undefined}>
              {TORNADO_COLUMNS.map((colKey) => (
                <td key={colKey}>{cell(row, colKey)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>

      {notes.length > 0 && (
        <ul className="mt-2 space-y-1 text-xs">
          {notes.map((note) => (
            <li
              key={note.key}
              data-note={note.key}
              style={{
                color: note.defect ? "var(--chart-negative-text)" : "var(--muted-foreground)",
              }}
            >
              {note.text}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
