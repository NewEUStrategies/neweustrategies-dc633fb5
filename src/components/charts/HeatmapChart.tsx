// MAPA CIEPŁA (MACIERZ WRAŻLIWOŚCI) - DWA PARAMETRY NARAZ, KOLOR ZAMIAST TABELI.
//
// PYTANIE ANALITYCZNE. Wiersz z tabeli doboru formy (sekcja 1): "Wrażliwość na
// dwa parametry -> mapa ciepła / macierz", a w kolumnie "Czego unikać" stoi
// "tabela liczb". To jest cała racja bytu tego rysunku i jednocześnie jego
// jedyna słabość: tabela 8 na 9 liczb zawiera dokładnie tę samą informację
// i jest DOKŁADNIEJSZA, tylko że czytelnik nie zobaczy w niej tego, po co
// przyszedł - KIERUNKU, w którym wynik rośnie, i tego, KTÓRY z dwóch
// parametrów rusza nim mocniej. Siedemdziesiąt liczb czyta się po kolei,
// gradient widzi się od razu. Wymiana jest świadoma, więc dokładne liczby
// muszą zostać dostępne: w komórkach, gdy się mieszczą, a zawsze w tabeli pod
// rysunkiem (`heatmapTable`).
//
// CZEGO DLA TEGO RODZAJU NIE WOLNO - i co z tego wynika DLA PIKSELI, bo każdy
// zakaz z modelu (`lib/charts/kinds/heatmap.ts`) ma tu swoje odbicie:
//   * LUKA NIE JEST ZEREM. Komórka bez wartości i komórka o wartości zero to
//     dwa różne zdania ("nie policzono" i "policzono, wyszło zero"), więc
//     luka nie dostaje żadnego stopnia rampy, tylko TEKSTURĘ: najjaśniejszy
//     stopień jest już zajęty przez prawdziwą najmniejszą wartość, a w druku
//     w skali szarości blady stopień i puste pole zbiegają się do jednego -
//     kreskowanie zostaje, bo linia ma krawędź;
//   * O SKALI DECYDUJE MODEL, NIE RENDER. Pole `scale.type` jest gotowym
//     rozstrzygnięciem: render nie widzi rozkładu wartości, więc gdyby
//     wybierał sam, wybierałby za niego autor bloku - raz, przy wpisywaniu
//     danych, i już nigdy potem, choć dane się zmieniają;
//   * PRZY SKALI ROZBIEŻNEJ ZERO MUSI WYPAŚĆ W PUNKCIE NEUTRALNYM RAMPY.
//     Stąd PARZYSTA liczba kubełków po tej stronie (`DIVERGING_BUCKETS`):
//     punkt neutralny leży wtedy na GRANICY kubełków, a nie w środku
//     któregoś. Kubełek zawierający zero w środku miałby po obu stronach
//     wartości przeciwnego znaku pod jednym kolorem, czyli gubiłby znak -
//     dokładnie to, przed czym ostrzega `signEncodedOk`;
//   * POZA SIATKĄ NIE MA DYMKA. `cellAddress` zwraca przy wskaźniku poza
//     polem `null` i ten `null` jedzie do stanu bez żadnego dociskania do
//     skrajnej komórki. Docisk (tak działa `bandIndex` w skrzynce i w słupkach)
//     twierdziłby, że wskaźnik stoi nad wartością, której w tym miejscu nie
//     ma - a mapa ciepła jest jedynym rodzajem, w którym JEDNA współrzędna
//     wskazuje kolumnę, nie komórkę, więc dociskanie musiałoby zgadywać
//     drugą;
//   * LICZBA W KOMÓRCE TYLKO WTEDY, GDY SIĘ MIEŚCI. Decyduje pomiar
//     (`heatmapValueLabelFit` z realnymi pikselami komórki), nie chęć autora:
//     etykieta dotykająca krawędzi łamie pierwsze z czterech wymagań
//     bezwzględnych ("nic nie jest ucięte"), a etykieta ucięta kłamie o cyfrach.
//
// DECYZJA ARCHITEKTONICZNA: KUBEŁEK TO PARA (TOKEN ODCIENIA, KRYCIE), A NIE
// OSOBNY TOKEN NA STOPIEŃ.
//
// Model oddaje pozycję na rampie (`t` w 0..1, `signed` w -1..1); render zamienia
// ją na numer kubełka i maluje kubełek JEDNYM tokenem odcienia przy krycu
// policzonym z numeru. Odrzuciłem dwie alternatywy:
//
//   1. DRABINA TOKENÓW SLOTU (`-inner` -> token -> `-face` -> `-mid` -> `-edge`).
//      Wygląda na gotową pięciostopniową rampę i nią NIE JEST: te odcienie
//      powstały jako obwódka i wypełnienie JEDNEGO słupka, więc cztery
//      najmocniejsze leżą w odległości jednego kroku jasności od tokena
//      (arkusz wyprowadza je krokiem OKLCh przy zachowanej chromie), a blade
//      wnętrze siedzi tuż przy płycie (1,20-1,28:1). Rampa z takiej drabiny
//      daje jeden ogromny skok i trzy stopnie praktycznie nierozróżnialne,
//      czyli czytelnik nie odróżni kubełka trzeciego od czwartego - a to jest
//      cała treść mapy ciepła;
//   2. CIĄGŁE MIESZANIE `color-mix()` między dwoma tokenami, tak jak robi to
//      mapa-choropleta. Daje poprawną rampę, ale jest CIĄGŁA, a legenda ma
//      pokazać GRANICE, które zdecydowały o przydziale - przy rampie ciągłej
//      takich granic nie ma i legenda musiałaby je zmyślić. Do tego
//      `color-mix()` w atrybucie prezentacyjnym nie jest wspierane wszędzie,
//      a nierozwiązane wypełnienie to czerń na całej macierzy.
//
// DLACZEGO KRYCIE JEST TU DOPUSZCZALNE, choć arkusz zabrania go w słupkach
// ("Wnętrze `-inner` jest OSOBNYM odcieniem, nie tokenem pod alfą: alfa
// przepuszcza siatkę i strefę prognozy"). Zakaz ma warunek, a warunek tu nie
// zachodzi: POD KOMÓRKĄ NIE MA NICZEGO POZA PŁYTĄ. Macierz nie ma osi
// wartości, więc nie ma na czym zawiesić siatki (`config.showGrid` nie ma tu
// co narysować), i nie ma osi czasu, więc nie ma strefy prognozy. Krycie
// składa się wyłącznie z płytą, a płyta zmienia się razem z motywem - dzięki
// temu rampa ODCHODZI OD TŁA w obu motywach bez ani jednej gałęzi na motyw
// w JS: na jasnym tle token jest ciemny i rosnące krycie ciemnieje, na ciemnym
// token jest jasny i rosnące krycie rozjaśnia. Gałąź na motyw przestałaby
// działać w druku, czyli dokładnie tam, gdzie mapa ciepła jest najczęściej
// czytana.
//
// DRUGA DECYZJA: LICZBA W KOMÓRCE MA OTOK W KOLORZE PŁYTY, A NIE WŁASNY TUSZ
// NA STOPIEŃ. Rampa przechodzi przez półtony, w których ANI ciemny, ani jasny
// tusz nie sięga 4,5:1 - próg tekstowy wypada wtedy dokładnie tam, gdzie
// musiałby stać przełącznik tuszu. Otok 1,25 px w kolorze płyty (`paint-order`
// rysuje go POD literą) przenosi więc rachunek kontrastu z wypełnienia komórki
// na płytę, wobec której `--foreground` jest mierzony (18,2:1 na jasnym,
// 14,3:1 na ciemnym) - jeden tusz, jeden otok, zero progów.
//
// CZEGO TEN KOMPONENT NIE LICZY: niczego. Wybór skali, pozycja na rampie,
// symetria wokół punktu neutralnego, przycięcie do domeny, brzegi wierszy
// i kolumn, rozstrzygnięcie dominującego parametru i wszystkie sprawdzenia
// uczciwości są w modelu i mają własny plik testowy. Tutaj jest wyłącznie
// zamiana wielkości względnych na piksele i numeru kubełka na parę tokenów.
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
import {
  HEATMAP_MAX_CELLS,
  HEATMAP_MIN_COLUMNS,
  HEATMAP_MIN_ROWS,
  HEATMAP_SPARSE_SHARE,
  heatmapExtent,
  heatmapFormAdvice,
  heatmapModelFromConfig,
  heatmapTable,
  heatmapValueLabelFit,
  type HeatmapCell,
  type HeatmapFormAdvice,
  type HeatmapModel,
  type HeatmapScaleType,
} from "@/lib/charts/kinds/heatmap";
import {
  CATEGORY_LABEL_MAX_WIDTH,
  FONT_AXIS,
  MIN_INNER_H,
  MIN_INNER_W,
  PAD_BOTTOM,
  PAD_LEFT_CATEGORY_MIN,
  PAD_SIDE,
  PAD_TOP,
  cascadeStepMs,
} from "@/lib/charts/geometry";
import { cellAddress, pointerToPlot, type CellAddress } from "@/lib/charts/plot";
import { CHAR_WIDTH_RATIO, estimateMaxLabelWidth } from "@/lib/charts/measureText";
import { useContainerWidth } from "@/hooks/useContainerWidth";
import { useRevealOnScroll, revealClassName } from "@/hooks/useRevealOnScroll";
import { useTapAwayDismiss } from "@/hooks/useTapAwayDismiss";
import { ChartTooltip, type TooltipRow } from "./ChartTooltip";
import "@/lib/i18n-charts";
import { ChartNotes, type ChartNote } from "./ChartFrame";

/**
 * Liczba kubełków rampy SEKWENCYJNEJ.
 *
 * Pięć, bo tyle klas czytelnik jeszcze przypisze do próbki legendy z pamięci.
 * Przy naszej rampie sąsiednie kubełki różnią się kryciem o 0,21, czyli
 * o skok porównywalny z krokiem spokój/hover z sekcji 6 (1,16-1,21:1) - i to
 * jest podłoga rozróżnialności powierzchni. Osiem klas dałoby krok 0,12,
 * przy którym dwa sąsiednie kubełki zaczynają wyglądać identycznie, czyli
 * legenda obiecywałaby rozdzielczość, której rysunek nie ma. Poniżej pięciu
 * mapa przestaje pokazywać kierunek i zostaje z podziałem "mało - dużo".
 */
const SEQUENTIAL_BUCKETS = 5;

/**
 * Liczba kubełków rampy ROZBIEŻNEJ - PARZYSTA, i to jest cała jej treść.
 *
 * Sześć, czyli po trzy na stronę. Parzystość stawia punkt neutralny na
 * GRANICY między kubełkiem trzecim i czwartym, więc zero wypada dokładnie
 * w punkcie neutralnym rampy, a nie w środku kubełka, który obejmowałby
 * wartości obu znaków pod jedną barwą. Trzy stopnie na stronę, a nie pięć,
 * bo znak niesie już ODCIEŃ (para semantyczna ujemny/dodatni), więc krycie ma
 * do zakodowania samo natężenie odchylenia.
 */
const DIVERGING_BUCKETS = 6;

/**
 * Krycie najsłabszego i najmocniejszego kubełka.
 *
 * Podłoga 0,16 odtwarza kontrast bladego wypełnienia z arkusza (1,20-1,28:1
 * do płyty): niżej komórka przestaje się odcinać od płyty i czytelnik nie
 * odróżni jej od komórki niepoliczonej, czyli najniższy kubełek zamieniłby się
 * w lukę. Sufit 1 to czysty token, ten sam, który stoi w legendzie i w próbce
 * dymka - rampa dochodzi do niego, bo tu (odwrotnie niż w słupku) nie ma
 * obwódki w tokenie, od której wypełnienie musiałoby się odciąć.
 */
const ALPHA_MIN = 0.16;
const ALPHA_MAX = 1;

/**
 * Wysokość osi kolumn - jeden wiersz etykiet, więc dokładnie `PAD_BOTTOM`.
 * Osobna nazwa, bo pod spodem stoi jeszcze legenda i bez nazwy nie widać,
 * skąd się bierze suma marginesów.
 */
const COLUMN_AXIS_H = PAD_BOTTOM;

/**
 * Wysokość pasa legendy: wiersz nagłówka (11 px), 6 px powietrza, pasek
 * próbek (10 px), wiersz granic (11 px) i szczebel skali odstępów (4 px) na
 * spadek przecinka dziesiętnego - bez tego ogonek przecinka w "19,2" dotyka
 * dolnej krawędzi karty. Legenda jest tu OBOWIĄZKOWA, nie opcjonalna: kolor
 * bez legendy jest jedynym nośnikiem wartości, którego nie da się odczytać.
 */
const LEGEND_H = 44;
const LEGEND_BAND_H = 10;
const LEGEND_HEAD_GAP = 6;

/** Odstęp etykiety wiersza od lewej krawędzi pola rysunku. */
const ROW_LABEL_GAP = 8;

/** Odsunięcie wiersza etykiet kolumn od dolnej krawędzi pola rysunku. */
const LABEL_BASELINE = 16;

/**
 * Połowa wysokości linii pisma przy `FONT_AXIS` - przesunięcie linii bazowej
 * tekstu, żeby napis był wyśrodkowany W PIONIE względem punktu, a nie stał na
 * nim. Ta sama liczba co w skrzynce i histogramie.
 */
const TEXT_MIDDLE = 3.5;

/**
 * Powietrze między dwiema sąsiednimi etykietami, w pikselach - najniższy
 * szczebel skali odstępów. Wchodzi do progu przerzedzania: dwie etykiety
 * stykające się bokami są nieczytelne, choć formalnie nic nie zostało ucięte.
 */
const LABEL_AIR = 4;

/**
 * Grubość otoku liczby w komórce. 2,5 px obwódki daje 1,25 px płyty wokół
 * litery (obwódka leży NA ścieżce, więc widoczna jest jej połowa) - tyle
 * wystarczy, żeby cyfra 11 px odcięła się od każdego kubełka, i wciąż za mało,
 * żeby pogrubić kształt liter.
 */
const VALUE_HALO_PX = 2.5;

/** Rozmiar kafla kreskowania luki - ten sam rytm 6 px, co tekstura strefy prognozy. */
const GAP_HATCH_PX = 6;

/** Rozdzielnik adresu komórki: wiersz i kolumna, dwa parametry, nie zakres. */
const ADDRESS_SEP = " · ";

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
 * (`advice.*` w nakładce `i18n-charts-editor.ts`).
 */
const READING_KEYS: Record<HeatmapFormAdvice, string | null> = {
  notMatrix: "heatmap.reading.notMatrix",
  tooManyCells: "heatmap.reading.tooManyCells",
  sparse: "heatmap.reading.sparse",
  noSpread: "heatmap.reading.noSpread",
  divergingDowngraded: "heatmap.reading.divergingDowngraded",
  unorderedAxis: "heatmap.reading.unorderedAxis",
};

/** Jeden stopień rampy. Kubełek komórki i próbka legendy czytają TĘ SAMĄ tablicę. */
interface RampStep {
  /** Numer kubełka, wspólny adres komórki i próbki legendy. */
  index: number;
  /** Token odcienia: jeden na całą rampę sekwencyjną, para semantyczna przy rozbieżnej. */
  token: string;
  /** Krycie, czyli natężenie kubełka. */
  alpha: number;
}

/** Skończona liczba albo zero - ostatnia osłona przed NaN w atrybucie SVG. */
function finite(value: number | null): number {
  return value !== null && Number.isFinite(value) ? value : 0;
}

/**
 * Krycie kubełka o danym poziomie natężenia. Liniowo, bo rampa jest liniowa
 * w wartości: nieliniowy rozkład krycia dałby kubełkom równej szerokości
 * nierówne skoki koloru, czyli sugerowałby, że w środku zakresu dzieje się
 * mniej niż na krańcach.
 */
function alphaOf(level: number, levels: number): number {
  if (levels <= 1) return ALPHA_MAX;
  return ALPHA_MIN + (ALPHA_MAX - ALPHA_MIN) * (level / (levels - 1));
}

/**
 * Rampa od najsłabszego kubełka do najmocniejszego, w kolejności czytania
 * legendy od lewej do prawej. Przy skali rozbieżnej lewa połowa jedzie
 * tokenem wartości ujemnej, prawa dodatniej, a natężenie rośnie OD ŚRODKA
 * w obie strony - dlatego indeks 0 jest najmocniejszym ujemnym, a nie
 * najsłabszym.
 */
function buildRamp(type: HeatmapScaleType, slot: number): RampStep[] {
  if (type === "diverging") {
    const half = DIVERGING_BUCKETS / 2;
    return Array.from({ length: DIVERGING_BUCKETS }, (_, i) => {
      const negative = i < half;
      return {
        index: i,
        token: negative ? "var(--chart-negative)" : "var(--chart-positive)",
        alpha: alphaOf(negative ? half - 1 - i : i - half, half),
      };
    });
  }
  return Array.from({ length: SEQUENTIAL_BUCKETS }, (_, i) => ({
    index: i,
    token: `var(--chart-${slot})`,
    alpha: alphaOf(i, SEQUENTIAL_BUCKETS),
  }));
}

/**
 * Numer kubełka komórki. `null` przy luce, bo luka nie ma pozycji na rampie
 * i nie wolno jej żadnej przypisać.
 *
 * PRZY SKALI ROZBIEŻNEJ WARTOŚĆ RÓWNA PUNKTOWI NEUTRALNEMU IDZIE DO KUBEŁKA
 * PO STRONIE DODATNIEJ, czyli przedział jest domknięty od dołu tak samo jak
 * w `cellAddress` i w przedziałach histogramu. Jakąś stronę wybrać trzeba, bo
 * przy parzystej liczbie kubełków zero leży na granicy - i to jest właśnie
 * cel; wybór strony dotyczy pojedynczej wartości dokładnie neutralnej, która
 * dostaje najsłabsze krycie, czyli barwę najbliższą braku odchylenia.
 */
function bucketOf(cell: HeatmapCell, type: HeatmapScaleType): number | null {
  if (cell.state === "gap") return null;
  if (type === "diverging") {
    const half = DIVERGING_BUCKETS / 2;
    const signed = finite(cell.signed);
    const level = Math.min(half - 1, Math.max(0, Math.floor(Math.abs(signed) * half)));
    return signed < 0 ? half - 1 - level : half + level;
  }
  const t = finite(cell.t);
  return Math.min(SEQUENTIAL_BUCKETS - 1, Math.max(0, Math.floor(t * SEQUENTIAL_BUCKETS)));
}

/**
 * GRANICE KUBEŁKÓW W JEDNOSTKACH DANYCH, czyli te same liczby, które
 * zdecydowały o przydziale - dlatego liczone są z tych samych pól modelu, co
 * pozycja na rampie, a nie z ładnej podziałki.
 *
 * Przy skali rozbieżnej domeną jest przedział SYMETRYCZNY wokół punktu
 * neutralnego (`neutral ± spread`), a nie zakres danych, bo model normalizuje
 * symetrycznie: mianownikiem `signed` jest większe z dwóch odchyleń. Legenda
 * pokazująca zakres danych kłamałaby wtedy o przydziale - kolor komórki
 * odpowiada odchyleniu mierzonemu w tej symetrycznej skali.
 */
function boundariesOf(model: HeatmapModel): number[] {
  const scale = model.scale;
  if (scale.type === "diverging") {
    const half = DIVERGING_BUCKETS / 2;
    const neutral = finite(scale.neutral);
    return Array.from(
      { length: DIVERGING_BUCKETS + 1 },
      (_, i) => neutral + ((i - half) / half) * finite(scale.spread),
    );
  }
  const extent = heatmapExtent(model);
  return Array.from(
    { length: SEQUENTIAL_BUCKETS + 1 },
    (_, i) => extent.min + ((extent.max - extent.min) * i) / SEQUENTIAL_BUCKETS,
  );
}

/**
 * DRABINA PRZERZEDZANIA ETYKIET z sekcji 4: bierz co n-tą, pierwszą
 * i ostatnią zawsze. Pierwsza i ostatnia są nienaruszalne, bo bez nich nie
 * wiadomo, jaki zakres pokazuje rysunek; `mustKeep` dokłada pozycje, których
 * przerzedzić nie wolno z innego powodu (punkt neutralny rampy).
 *
 * Krok jest ograniczony do `count - 1`, żeby przy dwóch pozycjach i długich
 * etykietach nie wyszedł budżet znaków szerszy niż realny odstęp - inaczej
 * dwie wymuszone etykiety nachodziłyby na siebie mimo przerzedzania.
 */
function thinLabels(
  count: number,
  needPx: number,
  availPx: number,
  mustKeep: readonly number[] = [],
): { step: number; keep: Set<number> } {
  const keep = new Set<number>();
  if (count <= 0) return { step: 1, keep };
  const last = count - 1;
  const need = Number.isFinite(needPx) ? Math.max(0, needPx) : 0;
  const avail = Number.isFinite(availPx) && availPx > 0 ? availPx : 1;
  const step = Math.max(1, Math.min(Math.ceil(need / avail), Math.max(1, last)));
  keep.add(0);
  keep.add(last);
  for (const i of mustKeep) if (i >= 0 && i <= last) keep.add(i);
  for (let i = step; i < last; i += step) {
    // Nie doklejaj etykiety do ostatniej: ta jest wymuszona, więc odstęp
    // przed nią musi wystarczyć na jej szerokość.
    if (last - i >= step) keep.add(i);
  }
  return { step, keep };
}

/**
 * Przycięcie etykiety do budżetu znaków, z pełną treścią w `<title>`.
 * Wielokropek bez dostępu do pełnego napisu jest zakazany (sekcja 4), a przy
 * mapie ciepła etykieta osi jest WARTOŚCIĄ PARAMETRU - jej utrata znaczy, że
 * nie wiadomo, czego dotyczy cały wiersz albo cała kolumna.
 */
function clipLabel(label: string, budget: number): { text: string; full: string | null } {
  if (budget >= label.length) return { text: label, full: null };
  return { text: `${label.slice(0, Math.max(1, budget - 1))}…`, full: label };
}

interface HeatmapChartProps {
  config: ChartConfig;
  lang: ChartLang;
}

export function HeatmapChart({ config, lang }: HeatmapChartProps) {
  const { t: scoped } = useTranslation("translation", { keyPrefix: "charts" });
  const t = useCallback(
    (key: string, values?: Record<string, string | number>): string =>
      scoped(key, { lng: lang, ...values }),
    [scoped, lang],
  );
  const { ref: widthRef, width } = useContainerWidth<HTMLDivElement>();
  const { ref: revealRef, state: revealState } = useRevealOnScroll<HTMLDivElement>(config.animate);
  const [active, setActive] = useState<CellAddress | null>(null);
  const hintId = useId();
  // Identyfikator tekstury luki. `useId`, bo `url(#id)` wiąże się z PIERWSZYM
  // elementem o tym id w dokumencie - dwie mapy na jednej stronie dzieliłyby
  // jedną definicję, wziętą z tej pierwszej. Dwukropki lecą, bo fragmentu
  // `url(#a:b:c)` część przeglądarek nie przechodzi.
  const gapId = `${useId().replace(/:/g, "")}-gap`;

  // WARTOŚĆ W KOMÓRCE FORMATUJE JĘZYK I JEDNOSTKA, a formatowanie wstrzykuje
  // render, bo model nie zna ani locale, ani `config.unit`. Ten sam napis
  // jedzie potem do tabeli i do dymka, więc liczba w tabeli nie może różnić
  // się od liczby na rysunku niczym poza jednostką (patrz `valueInCell`).
  const model: HeatmapModel = useMemo(
    () =>
      heatmapModelFromConfig(config, {
        formatValue: (value: number) => formatChartValue(value, lang, config.unit),
      }),
    [config, lang],
  );
  const height = config.height;
  const rows = model.rows;
  const columns = model.columns;

  // `useTapAwayDismiss` MUSI stać przed jakimkolwiek wczesnym wyjściem - hooki
  // nie mogą się warunkowo pomijać, a wyjście "pusta macierz" jest niżej.
  const clearActive = useCallback(() => setActive(null), []);
  useTapAwayDismiss(active !== null, widthRef, clearActive);

  const geometry = useMemo(() => {
    // ETYKIETY WIERSZY WYZNACZAJĄ LEWY MARGINES (sekcja 4: mierz, potem
    // układaj), z sufitem `CATEGORY_LABEL_MAX_WIDTH` - inaczej jedna długa
    // nazwa scenariusza zjadłaby połowę pola rysunku, a macierz zwęziłaby się
    // do paska.
    const labelW = estimateMaxLabelWidth(model.rowAxis.labels, FONT_AXIS);
    const padLeft = Math.min(
      CATEGORY_LABEL_MAX_WIDTH,
      Math.max(PAD_LEFT_CATEGORY_MIN, Math.ceil(labelW) + PAD_SIDE),
    );
    const innerW = Math.max(MIN_INNER_W, width - padLeft - PAD_SIDE);
    const innerH = Math.max(MIN_INNER_H, height - PAD_TOP - COLUMN_AXIS_H - LEGEND_H);
    // Skalar komórki jest tą samą liczbą co `cell.w`/`cell.h` z modelu
    // (siatka mapy ciepła jest równomierna z definicji), ale progi pomiarowe
    // trzeba znać PRZED pętlą po komórkach.
    const cellW = columns > 0 ? innerW / columns : 0;
    const cellH = rows > 0 ? innerH / rows : 0;
    return { padLeft, innerW, innerH, cellW, cellH };
  }, [model.rowAxis.labels, columns, rows, width, height]);

  const { padLeft, innerW, innerH, cellW, cellH } = geometry;
  const plotBottom = PAD_TOP + innerH;

  // SLOT ODCIENIA jest ustawiany przez model wyłącznie dla rampy
  // sekwencyjnej, i tylko tam jest czytany; `?? 1` powtarza domyślny slot
  // modelu, więc gałąź awaryjna nie może przesunąć barwy na inną serię.
  const ramp = useMemo(
    () => buildRamp(model.scale.type, model.scale.slot ?? 1),
    [model.scale.type, model.scale.slot],
  );
  const boundaries = useMemo(() => boundariesOf(model), [model]);
  const cascade = cascadeStepMs(rows);

  // LICZBY W KOMÓRKACH: model liczy gęstość siatki, render zna piksele.
  // Gdy oba się rozejdą, obowiązuje POMIAR - i dlatego pomiar jedzie tu
  // z `cellW`/`cellH`, a nie z progu na liczbę komórek.
  const valueLabelsFit = heatmapValueLabelFit(model, { cellWidth: cellW, cellHeight: cellH });

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    if (rows === 0 || columns === 0) return;
    // DWA WYMIARY, WIĘC CZTERY STRZAŁKI. To jest jedyny rodzaj, w którym
    // strzałki poziome nie wystarczają: pozioma zmienia kolumnę, pionowa
    // wiersz, a jedna współrzędna nie wskazuje komórki.
    const move =
      e.key === "ArrowRight"
        ? { row: 0, col: 1 }
        : e.key === "ArrowLeft"
          ? { row: 0, col: -1 }
          : e.key === "ArrowDown"
            ? { row: 1, col: 0 }
            : e.key === "ArrowUp"
              ? { row: -1, col: 0 }
              : null;
    if (move !== null) {
      e.preventDefault();
      setActive((prev) => {
        if (prev === null) {
          // Wejście klawiaturą staje na komórce OD STRONY, z której czytelnik
          // przyszedł: strzałka w lewo wchodzi od prawej krawędzi, w górę od
          // dolnej. Wejście zawsze w narożnik zerowy gubiłoby kierunek ruchu.
          return {
            row: move.row < 0 ? rows - 1 : 0,
            col: move.col < 0 ? columns - 1 : 0,
          };
        }
        return {
          row: Math.max(0, Math.min(rows - 1, prev.row + move.row)),
          col: Math.max(0, Math.min(columns - 1, prev.col + move.col)),
        };
      });
      return;
    }
    if (e.key === "Escape") setActive(null);
  };

  if (model.cells.length === 0) return null;

  // STREFA TRAFIENIA: `cellAddress`, i `null` jedzie do stanu bez dociskania.
  // Patrz nagłówek pliku - docisk do skrajnej komórki twierdziłby, że
  // wskaźnik stoi nad wartością, której tam nie ma.
  const addressFromPointer = (e: PointerEvent<SVGRectElement>): CellAddress | null => {
    const point = pointerToPlot(
      e.clientX,
      e.clientY,
      e.currentTarget.getBoundingClientRect(),
      innerW,
      innerH,
    );
    if (point === null) return null;
    return cellAddress(point, innerW, innerH, rows, columns);
  };

  // Komórki idą wiersz po wierszu, więc adres liczy się bez szukania.
  const activeCell: HeatmapCell | null =
    active === null ? null : (model.cells[active.row * columns + active.col] ?? null);

  const num = (value: number | null): string =>
    value === null ? "-" : formatChartValue(value, lang, config.unit);

  /**
   * Liczba wpisywana W KOMÓRKĘ - bez jednostki, choć `cell.text` ją nosi.
   * Jednostka należy do SKALI, nie do każdej z siedemdziesięciu komórek:
   * powtórzona przy każdej liczbie jest szumem i jest dokładnie tym, przez co
   * liczba przestaje się mieścić. Stoi więc raz, w nagłówku legendy.
   */
  const valueInCell = (cell: HeatmapCell): string =>
    cell.value === null ? "-" : formatChartValue(cell.value, lang, "");

  const unit = config.unit.trim();
  const legendTitle = unit ? `${t("heatmap.legend.title")} (${unit})` : t("heatmap.legend.title");
  // `n` MAPY CIEPŁA TO LICZBA WYPEŁNIONYCH KOMÓREK, nie rozmiar siatki
  // (sekcja 8: podaj n). Siatka 8 na 9 z dwiema policzonymi parami wygląda
  // tak samo jak siatka wypełniona, a znaczy co innego, więc liczba stoi
  // w legendzie, a nie w dymku - dymka nie ma ani w druku, ani na zrzucie.
  const legendHead = `${legendTitle}${ADDRESS_SEP}${t("heatmap.table.count")} ${formatChartValue(
    model.filled,
    lang,
    "",
  )}`;

  // Pasek skali rysujemy tylko wtedy, gdy JEST co skalować. Przy macierzy
  // z samych luk próbki obiecywałyby klasy, których żadna komórka nie zajmuje.
  const showBand = model.filled > 0;
  // BRAK ROZPROSZENIA: wszystkie komórki dostają z modelu środek rampy, więc
  // legenda pokazuje JEDNĄ próbkę i JEDNĄ liczbę - pięć próbek sugerowałoby
  // porównanie, którego w danych nie ma (defekt nazywa `advice.noSpread`).
  const flatScale = !(boundaries[boundaries.length - 1] > boundaries[0]);
  const bandSteps = flatScale ? [ramp[Math.floor(ramp.length / 2)]] : ramp;
  const bandBounds = flatScale ? [boundaries[0]] : boundaries;
  const swatchW = ramp.length > 0 ? innerW / ramp.length : 0;
  const legendTop = plotBottom + COLUMN_AXIS_H;
  const legendHeadY = legendTop + FONT_AXIS;
  const bandY = legendHeadY + LEGEND_HEAD_GAP;
  const boundY = bandY + LEGEND_BAND_H + FONT_AXIS;

  // Przerzedzanie granic: punkt neutralny rampy rozbieżnej jest nienaruszalny,
  // bo to jedyna granica, która niesie ZNAK, a nie tylko wielkość.
  const boundThin = thinLabels(
    bandBounds.length,
    estimateMaxLabelWidth(
      bandBounds.map((b) => formatAxisTick(b, lang)),
      FONT_AXIS,
    ) + LABEL_AIR,
    swatchW,
    model.scale.type === "diverging" ? [DIVERGING_BUCKETS / 2] : [],
  );

  const columnThin = thinLabels(
    columns,
    estimateMaxLabelWidth(model.columnAxis.labels, FONT_AXIS) + LABEL_AIR,
    cellW,
  );
  const columnBudget = Math.max(
    1,
    Math.floor((columnThin.step * cellW - LABEL_AIR) / (FONT_AXIS * CHAR_WIDTH_RATIO)),
  );
  const rowThin = thinLabels(rows, FONT_AXIS + 2, cellH);
  const rowBudget = Math.max(
    1,
    Math.floor((padLeft - ROW_LABEL_GAP) / (FONT_AXIS * CHAR_WIDTH_RATIO)),
  );

  const table = heatmapTable(model);

  // DYMEK DAJE TO, CZEGO KOLOR DAĆ NIE MOŻE: dokładną liczbę i przedział
  // kubełka, w który wpadła. Brzegi i rozstrzygnięcie dominacji stoją POD
  // rysunkiem, nie tutaj - hover dodaje precyzję, nigdy treść (sekcja 6).
  const tooltipRows: TooltipRow[] = (() => {
    if (activeCell === null) return [];
    const bucket = bucketOf(activeCell, model.scale.type);
    const rowsOut: TooltipRow[] = [
      {
        name: t("heatmap.table.value"),
        // LUKA MÓWI, ŻE JEST LUKĄ. Pusty dymek nad komórką z teksturą
        // wyglądałby na zepsuty wykres, a nie na brak pomiaru.
        value: activeCell.state === "gap" ? t("heatmap.legend.empty") : activeCell.text,
        colorSlot: null,
        emphasised: true,
      },
    ];
    if (bucket !== null && !flatScale) {
      rowsOut.push({
        name: legendTitle,
        value: `${t("heatmap.legend.from", {
          value: formatAxisTick(boundaries[bucket], lang),
        })} ${t("heatmap.legend.to", { value: formatAxisTick(boundaries[bucket + 1], lang) })}`,
        colorSlot: null,
      });
    }
    return rowsOut;
  })();

  // KTÓRY PARAMETR RUSZA WYNIKIEM MOCNIEJ - to jest odpowiedź na pytanie
  // analityczne i dlatego jest zdaniem WIDOCZNYM, a nie wierszem dymka ani
  // treścią dla czytnika ekranu. Z gradientu tego wniosku nie da się odczytać
  // liczbą, a właśnie po niego czytelnik przychodzi do macierzy wrażliwości.
  const dominant =
    table.dominantAxis === "rows"
      ? t("heatmap.dominant.rows")
      : table.dominantAxis === "columns"
        ? t("heatmap.dominant.columns")
        : table.dominantAxis === "tie"
          ? t("heatmap.dominant.tie")
          : null;

  // NAZWA DOSTĘPNA NIESIE LICZBY, nie nazwę rodzaju. Czytnik ekranu nie widzi
  // ani rampy, ani etykiet osi, więc dostaje zakres skali, `n`, odpowiedź
  // o dominującym parametrze i brzeg każdego wiersza - czyli to samo, co
  // widzący czytelnik odczytuje z kierunku gradientu.
  const ariaLabel = [
    config.title,
    `${legendTitle}: ${t("heatmap.legend.from", {
      value: formatAxisTick(boundaries[0], lang),
    })} ${t("heatmap.legend.to", {
      value: formatAxisTick(boundaries[boundaries.length - 1], lang),
    })}`,
    `${t("heatmap.table.count")} ${formatChartValue(model.filled, lang, "")}`,
    dominant,
    ...model.rowMargins.map(
      (margin) =>
        `${margin.label}: ${t("heatmap.table.mean")} ${num(margin.mean)}, ${t(
          "heatmap.table.range",
        )} ${num(margin.range)}`,
    ),
  ]
    .filter((part): part is string => Boolean(part))
    // KROPKI STAWIA SPÓJKA, NIE TREŚĆ. Zdanie o dominującym parametrze
    // przyjeżdża ze słownika już z kropką, a dwie kropki obok siebie czytnik
    // ekranu czyta jako dłuższą pauzę w środku wyliczenia - czyli jako koniec
    // wypowiedzi tam, gdzie jej nie ma.
    .map((part) => part.replace(/\.\s*$/, ""))
    .join(". ");

  // PORADY FORMY I DEFEKTY DANYCH stoją pod rysunkiem, bo dotyczą tego, co
  // czytelnik właśnie widzi: "to nie jest macierz", "połowa pola to luki"
  // i "skala nie stawia punktu neutralnego na zerze" zmieniają sposób
  // czytania obrazka, a nie sam obrazek.
  const notes: ChartNote[] = heatmapFormAdvice(model).map((advice) => ({
    key: `reading.${advice}`,
    text: t(READING_KEYS[advice] ?? "", adviceValues(advice, lang)),
    defect: false,
  }));
  if (model.rowAxis.uniqueOk === false || model.columnAxis.uniqueOk === false) {
    notes.push({ key: "honesty.uniqueOk", text: t("heatmap.honesty.uniqueOk"), defect: true });
  }
  if (model.rowAxis.namedOk === false || model.columnAxis.namedOk === false) {
    notes.push({ key: "honesty.namedOk", text: t("heatmap.honesty.namedOk"), defect: true });
  }
  if (model.signEncodedOk === false) {
    notes.push({
      key: "honesty.signEncodedOk",
      text: t("heatmap.honesty.signEncodedOk"),
      defect: true,
    });
  }
  if (model.inDomainOk === false) {
    notes.push({ key: "honesty.inDomainOk", text: t("heatmap.honesty.inDomainOk"), defect: true });
  }
  if (model.inGridOk === false) {
    notes.push({ key: "honesty.inGridOk", text: t("heatmap.honesty.inGridOk"), defect: true });
  }
  if (model.declaredSampleOk === false) {
    notes.push({
      key: "honesty.declaredSampleOk",
      text: t("heatmap.honesty.declaredSampleOk", {
        declared: config.sampleSize ?? 0,
        actual: model.filled,
      }),
      defect: true,
    });
  }

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
          {/* TEKSTURA LUKI. Definicja powstaje TYLKO gdy jest luka do
              narysowania - `<defs>` bez odbiorcy jest czystym kosztem.
              Kreskowanie, nie blady stopień rampy: w druku w skali szarości
              blady stopień i puste pole zbiegają się do jednego, a kreska ma
              krawędź. Kolor w `style`, bo `var()` w atrybucie prezentacyjnym
              nie jest wspierane wszędzie, a nierozwiązany `stroke` to czerń. */}
          {model.gaps > 0 && (
            <defs>
              <pattern
                id={gapId}
                width={GAP_HATCH_PX}
                height={GAP_HATCH_PX}
                patternUnits="userSpaceOnUse"
                patternTransform="rotate(45)"
              >
                <rect
                  x={0}
                  y={0}
                  width={GAP_HATCH_PX}
                  height={GAP_HATCH_PX}
                  style={{ fill: "var(--card)" }}
                />
                <line
                  x1={0}
                  y1={0}
                  x2={0}
                  y2={GAP_HATCH_PX}
                  strokeWidth={1}
                  style={{ stroke: "var(--chart-axis)" }}
                />
              </pattern>
            </defs>
          )}

          {/* ===== KOMÓRKI. Jedno wejście na całą macierz (`neh-fade` na
              grupie), nie kaskada po komórce: przy stu komórkach kaskada jest
              migotaniem, nie ruchem, a `cascadeStepMs` i tak zwraca dla takiej
              liczby zero. ===== */}
          <g className="neh-fade" data-role="cells" data-scale={model.scale.type}>
            {model.cells.map((cell) => {
              const bucket = bucketOf(cell, model.scale.type);
              const step = bucket === null ? null : (ramp[bucket] ?? null);
              const x = padLeft + cell.x * innerW;
              const y = PAD_TOP + cell.y * innerH;
              const w = cell.w * innerW;
              const h = cell.h * innerH;
              return (
                <rect
                  key={`${cell.row}-${cell.column}`}
                  x={x}
                  y={y}
                  width={w}
                  height={h}
                  // LUKA BIERZE TEKSTURĘ, WARTOŚĆ BIERZE KUBEŁEK. Dwie
                  // gałęzie, nie jedna z kryciem zero: krycie zero dałoby
                  // luce kolor płyty, czyli to samo, co ma komórka o wartości
                  // równej dolnej granicy skali.
                  fill={step === null ? `url(#${gapId})` : step.token}
                  fillOpacity={step === null ? 1 : step.alpha}
                  // Szew w kolorze płyty, nie odstęp: prawa krawędź komórki
                  // JEST lewą krawędzią następnej, więc przerwa twierdziłaby,
                  // że między dwiema parami parametrów jest zakres, którego
                  // w siatce nie ma. Ten sam wybór, co w histogramie.
                  stroke="var(--card)"
                  strokeWidth={1}
                  data-role="cell"
                  data-state={cell.state}
                  data-bucket={bucket === null ? undefined : bucket}
                  data-row={cell.row}
                  data-column={cell.column}
                />
              );
            })}

            {/* LICZBY W KOMÓRKACH - tylko gdy pomiar mówi, że się mieszczą.
                Otok w kolorze płyty pod literą (patrz nagłówek pliku): dzięki
                niemu jeden tusz obsługuje całą rampę, także jej półtony, gdzie
                ani ciemny, ani jasny nie sięgnąłby progu tekstowego. */}
            {valueLabelsFit &&
              model.cells.map((cell) => (
                <text
                  key={`v${cell.row}-${cell.column}`}
                  x={padLeft + cell.x * innerW + (cell.w * innerW) / 2}
                  y={PAD_TOP + cell.y * innerH + (cell.h * innerH) / 2 + TEXT_MIDDLE}
                  textAnchor="middle"
                  fontSize={FONT_AXIS}
                  fill="var(--foreground)"
                  stroke="var(--card)"
                  strokeWidth={VALUE_HALO_PX}
                  paintOrder="stroke"
                  className="neh-value-label tabular-nums"
                  data-role="cell-value"
                  data-state={cell.state}
                >
                  {valueInCell(cell)}
                </text>
              ))}
          </g>

          {/* WSKAZANA KOMÓRKA: obwódka w tuszu, wsunięta o piksel do środka.
              Hover zmienia POWIERZCHNIĘ, nigdy kodowanie - komórka nie rusza
              się, nie rośnie i nie zmienia kubełka, dostaje tylko granicę,
              która mówi "tu stoisz". Bez klasy, bo arkusz nie ma takiej reguły,
              a klasa bez reguły jest martwa. */}
          {activeCell !== null && (
            <rect
              x={padLeft + activeCell.x * innerW + 1}
              y={PAD_TOP + activeCell.y * innerH + 1}
              width={Math.max(0, activeCell.w * innerW - 2)}
              height={Math.max(0, activeCell.h * innerH - 2)}
              fill="none"
              pointerEvents="none"
              data-role="cell-active"
              style={{ stroke: "var(--foreground)", strokeWidth: 2 }}
            />
          )}

          {/* OŚ WIERSZY. Etykieta jest WARTOŚCIĄ PARAMETRU, nie ozdobą, więc
              przy ciasnej siatce jest przerzedzana, a nie zmniejszana - font
              poniżej 11 px przestaje być czytelny, a przerzedzanie zostawia
              czytelne te, które zostały. */}
          {model.rowAxis.labels.map((label, r) => {
            if (!rowThin.keep.has(r)) return null;
            const clipped = clipLabel(label, rowBudget);
            return (
              <text
                key={`r${r}`}
                x={padLeft - ROW_LABEL_GAP}
                y={PAD_TOP + (r + 0.5) * cellH + TEXT_MIDDLE}
                textAnchor="end"
                fontSize={FONT_AXIS}
                fill="var(--muted-foreground)"
                data-role="row-label"
                data-row={r}
              >
                {clipped.text}
                {clipped.full !== null && <title>{clipped.full}</title>}
              </text>
            );
          })}

          {/* OŚ KOLUMN - ta sama drabina przerzedzania, tylko budżet znaków
              rośnie razem z krokiem: etykieta pokazana co trzecią kolumnę ma
              do dyspozycji trzy szerokości komórki. */}
          {model.columnAxis.labels.map((label, c) => {
            if (!columnThin.keep.has(c)) return null;
            const clipped = clipLabel(label, columnBudget);
            return (
              <text
                key={`c${c}`}
                x={padLeft + (c + 0.5) * cellW}
                y={plotBottom + LABEL_BASELINE}
                textAnchor="middle"
                fontSize={FONT_AXIS}
                fill="var(--muted-foreground)"
                data-role="column-label"
                data-column={c}
              >
                {clipped.text}
                {clipped.full !== null && <title>{clipped.full}</title>}
              </text>
            );
          })}

          {/* ===== LEGENDA. Próbki czytają TĘ SAMĄ tablicę rampy, co komórki,
              więc próbka kubełka nie może rozjechać się z kolorem komórki tego
              kubełka. Podpisy to GRANICE, czyli liczby, które zdecydowały
              o przydziale - legenda z ładną podziałką mówiłaby o innym
              przydziale niż ten narysowany. ===== */}
          <text
            x={padLeft}
            y={legendHeadY}
            textAnchor="start"
            fontSize={FONT_AXIS}
            fill="var(--muted-foreground)"
            className="tabular-nums"
            data-role="legend-head"
          >
            {legendHead}
          </text>

          {showBand &&
            bandSteps.map((step, i) => (
              <rect
                key={`s${step.index}`}
                x={padLeft + i * swatchW}
                y={bandY}
                width={Math.max(0, swatchW)}
                height={LEGEND_BAND_H}
                fill={step.token}
                fillOpacity={step.alpha}
                stroke="var(--card)"
                strokeWidth={1}
                data-role="legend-swatch"
                data-bucket={step.index}
              />
            ))}

          {showBand &&
            bandBounds.map((bound, i) => {
              if (!boundThin.keep.has(i)) return null;
              return (
                <text
                  key={`b${i}`}
                  x={padLeft + i * swatchW}
                  y={boundY}
                  // Pierwsza i ostatnia granica są kotwiczone do wnętrza pola:
                  // wyśrodkowana wystawałaby za płytę i zostałaby ucięta.
                  textAnchor={i === 0 ? "start" : i === bandBounds.length - 1 ? "end" : "middle"}
                  fontSize={FONT_AXIS}
                  fill="var(--muted-foreground)"
                  className="tabular-nums"
                  data-role="legend-bound"
                  data-bound={i}
                >
                  {formatAxisTick(bound, lang)}
                </text>
              );
            })}

          {/* PRÓBKA LUKI stoi w legendzie tylko wtedy, gdy w macierzy jest
              luka - i wtedy jest obowiązkowa, bo tekstura bez klucza jest
              wzorkiem, a nie informacją "nie policzono". Po prawej stronie
              pasa, żeby nie wchodziła w rampę i nie czytała się jako jej
              kolejny stopień. */}
          {model.gaps > 0 && (
            <g data-role="legend-gap">
              <rect
                x={padLeft + innerW - LEGEND_BAND_H}
                y={legendHeadY - LEGEND_BAND_H + 1}
                width={LEGEND_BAND_H}
                height={LEGEND_BAND_H}
                fill={`url(#${gapId})`}
                stroke="var(--chart-axis)"
                strokeWidth={1}
                data-role="legend-gap-swatch"
              />
              <text
                x={padLeft + innerW - LEGEND_BAND_H - LABEL_AIR}
                y={legendHeadY}
                textAnchor="end"
                fontSize={FONT_AXIS}
                fill="var(--muted-foreground)"
                data-role="legend-gap-label"
              >
                {t("heatmap.legend.empty")}
              </text>
            </g>
          )}

          {/* Warstwa trafień - JEDNA na całe pole, nad grafiką, `fill:
              transparent`. Adres liczy `cellAddress`, bo komórkę wskazują DWIE
              współrzędne naraz. */}
          <rect
            className="neh-hit"
            data-role="hits"
            x={padLeft}
            y={PAD_TOP}
            width={innerW}
            height={innerH}
            fill="transparent"
            onPointerDown={(e) => setActive(addressFromPointer(e))}
            onPointerMove={(e) => setActive(addressFromPointer(e))}
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
          visible={activeCell !== null}
          x={activeCell === null ? 0 : padLeft + (activeCell.x + activeCell.w / 2) * innerW}
          y={activeCell === null ? 0 : PAD_TOP + (activeCell.y + activeCell.h / 2) * innerH}
          containerWidth={width}
          title={
            activeCell === null
              ? ""
              : [activeCell.rowLabel, activeCell.columnLabel].filter(Boolean).join(ADDRESS_SEP)
          }
          rows={tooltipRows}
        />
      </div>

      {/* ODPOWIEDŹ NA PYTANIE ANALITYCZNE, zdaniem. Stoi pod rysunkiem, bo ani
          gradient, ani dymek jej nie unoszą: "wynik jest wrażliwszy na
          parametr z wierszy" jest różnicą rozstępów średnich brzegowych,
          czyli liczbą, a nie kształtem plamy. */}
      {dominant !== null && (
        <p
          className="mt-2 text-xs"
          style={{ color: "var(--muted-foreground)" }}
          data-role="dominant"
        >
          {dominant}
        </p>
      )}

      {/* ALTERNATYWA TEKSTOWA NIE STOI TUTAJ, i to jest rozstrzygnięcie, nie
          brak. Do podłączenia tego rodzaju render niósł WŁASNĄ kopię tabeli
          w `sr-only`, bo panel danych ramki (`ChartFrame`, przełącznik
          „Pokaż dane") jest domyślnie `hidden`, czyli poza drzewem
          dostępności. Kopia była wtedy jedyną drogą do liczby dla czytnika
          ekranu - ale po podłączeniu rodzaju do `TABLE_BY_KIND` ramka
          renderuje tę samą tabelę drugi raz, więc po otwarciu panelu czytnik
          dostawał WSZYSTKIE liczby dwa razy, bez żadnego sygnału, że to ta
          sama tabela. Dwie tabele bez różnicy są gorsze niż jedno naciśnięcie
          przycisku: przełącznik jest zwykłym `button` z `aria-expanded`
          i `aria-controls`, czyli wzorcem, który czytnik ekranu nazywa
          i którym steruje. Warunek powrotu kopii jest jeden: gdyby ramka
          przestała renderować tabelę tego rodzaju.

          Tabela mieszka w `Chart.tsx` (`TABLE_BY_KIND`) i liczy Z TEGO SAMEGO
          MODELU co rysunek - dwa liczenia to dwa źródła prawdy. */}

      <ChartNotes notes={notes} />
    </div>
  );
}

/**
 * Liczby wstawiane w treść porady formy. Osobno od tablicy kluczy, bo część
 * z nich to STAŁE MODELU (`HEATMAP_MIN_ROWS`, `HEATMAP_MAX_CELLS`,
 * `HEATMAP_SPARSE_SHARE`) i muszą przyjechać z modelu, a nie zostać wpisane
 * drugi raz w treść słownika - ostrzeżenie mówiące o innym progu niż ten,
 * który je zapalił, jest gorsze od jego braku.
 */
function adviceValues(advice: HeatmapFormAdvice, lang: ChartLang): Record<string, string | number> {
  switch (advice) {
    case "notMatrix":
      return { rows: HEATMAP_MIN_ROWS, columns: HEATMAP_MIN_COLUMNS };
    case "tooManyCells":
      return { max: HEATMAP_MAX_CELLS };
    case "sparse":
      // Próg jest udziałem WYPEŁNIONYCH, a treść mówi o PUSTYCH, więc do
      // słownika jedzie dopełnienie. Ta zamiana jest jednym odejmowaniem
      // i dlatego stoi tutaj, a nie w treści ostrzeżenia.
      return { share: formatPercent(1 - HEATMAP_SPARSE_SHARE, lang) };
    default:
      return {};
  }
}
