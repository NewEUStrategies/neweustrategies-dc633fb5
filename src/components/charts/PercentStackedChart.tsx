// SŁUPEK SKUMULOWANY 100% - STRUKTURA CAŁOŚCI I JEJ ZMIANA MIĘDZY KATEGORIAMI.
//
// PYTANIE ANALITYCZNE. Wiersz tabeli doboru formy (sekcja 1): „Struktura
// całości -> słupek skumulowany 100%, treemap, pierścień do 5 kategorii",
// a w kolumnie „Czego unikać": „kołowy pełny, pierścień z >5 kategoriami".
// Ten rodzaj jest ZAMIENNIKIEM tarczy powyżej pięciu kategorii i odpowiada
// przy tym na pytanie, którego tarcza postawić nie umie: nie „jaka jest
// struktura", ale JAK SIĘ ZMIENIA między kategoriami. Dlatego słupków jest
// wiele, stoją obok siebie i mają jedną, wspólną kolejność segmentów.
//
// CZEMU TO NIE JEST WARIANT `CartesianChart`, i to jest tu jedyna decyzja
// architektoniczna warta uzasadnienia.
//
// Kartezjański UMIE stos - ma `config.stacked` i `stackSeries` z `../../lib/
// charts/scale`. Ale to jest stos BEZWZGLĘDNY: jego oś niesie jednostkę
// autora, zakres liczy `seriesExtent` z danych, a wysokość słupka koduje SUMĘ.
// Tutaj oś nie jest wyprowadzana z danych w ogóle - `percentStackedExtent()`
// zwraca 0..100 i nie ma ani jednego parametru, bo osią JEST całość, więc
// każdy słupek kończy się na tej samej wysokości. Gdyby to był przełącznik
// w kartezjańskim, w jednym komponencie siedziałyby DWA sprzeczne znaczenia
// tego samego wejścia:
//   * wartość ujemna jest w stosie bezwzględnym legalnym słupkiem pod zerem,
//     a tutaj ODRZUCA cały słupek, bo udział ujemny nie ma długości;
//   * „oś nie zaczyna się od zera" jest tam ostrzeżeniem o uciętej skali,
//     a tutaj nie ma o czym ostrzegać, bo skali nikt nie dobiera;
//   * suma kategorii jest tam WIDOCZNA jako wysokość słupka, a tutaj rysunek
//     ją WYRZUCA - i to jest cały koszt tej formy.
// Przełącznik znaczyłby, że każdą z tych trzech rzeczy da się odkliknąć jednym
// polem edytora i dostać rysunek, który wygląda poprawnie i kłamie.
//
// CO Z TEJ DECYZJI WYNIKA W TYM PLIKU:
//   * SUMA BEZWZGLĘDNA MUSI BYĆ GDZIEŚ INDZIEJ. Równa wysokość słupków ukrywa
//     różne wielkości całości: dwa słupki o identycznej strukturze mogą
//     różnić się rzędem wielkości i wyglądają wtedy tak samo. Dlatego suma
//     kategorii jedzie w dymku, w nazwie dostępnej i - przy włączonych
//     etykietach wartości - NAD słupkiem, gdzie w kartezjańskim stoi wartość:
//     nad stosem 100% jedyną liczbą wartą postawienia nie jest sto (to
//     tautologia), tylko mianownik;
//   * PRÓG ETYKIETY WEWNĄTRZ SEGMENTU LICZY RENDER, NIE MODEL. Model ma
//     domyślny `PERCENT_STACKED_LABEL_MIN_SHARE` (0,06) wyprowadzony dla
//     WYSOKOŚCI KARTY; render zna wysokość POLA RYSUNKU, która jest od niej
//     mniejsza o marginesy - patrz `LABEL_BOX_PX`;
//   * SŁUPEK JEST SZERSZY NIŻ `BAR_MAX` - patrz `BAR_W_PX`;
//   * KOLEJNOŚĆ JEST ARKUSZOWA. Ani kategorie, ani segmenty nie są tu
//     sortowane: pierwsza seria dostaje jako jedyna wspólną skalę (tylko ona
//     zaczyna się w zerze), więc jej wybór jest decyzją analityczną autora.
//     Model nie sortuje i render też nie - `bars` i `segments` idą na rysunek
//     w kolejności, w jakiej przyszły z arkusza.
//
// CZEGO TEN KOMPONENT NIE LICZY: niczego. Udziały, metoda największych reszt,
// odrzucenia słupków, brzeg serii i wszystkie sprawdzenia uczciwości pochodzą
// z `lib/charts/kinds/percentStacked.ts`. Tu jest wyłącznie skalowanie na
// piksele, dobór podziałki, rysowanie i tłumaczenie kluczy.
import {
  useCallback,
  useId,
  useMemo,
  useState,
  type KeyboardEvent,
  type PointerEvent,
} from "react";
import { useTranslation } from "react-i18next";
import { CATEGORICAL_SAFE_SERIES, type ChartConfig } from "@/lib/charts/types";
import {
  formatChartValue,
  formatPercent,
  formatPercentPoints,
  type ChartLang,
} from "@/lib/charts/format";
import { linearScale } from "@/lib/charts/scale";
import { finite } from "@/lib/charts/num";
import {
  PERCENT_STACKED_TOTAL_RATIO,
  PERCENT_STACKED_WHOLE_PP,
  percentStackedExtent,
  percentStackedFormAdvice,
  percentStackedModelFromConfig,
  percentStackedTable,
  type PercentStackedBar,
  type PercentStackedCellNote,
  type PercentStackedFormAdvice,
  type PercentStackedRowNote,
  type PercentStackedSeriesSummary,
} from "@/lib/charts/kinds/percentStacked";
import {
  BAR_EDGE_INSET,
  BAR_GAP,
  CHART_RADIUS,
  FONT_AXIS,
  MIN_INNER_H,
  MIN_INNER_W,
  PAD_BOTTOM,
  PAD_LEFT_MIN,
  PAD_SIDE,
  PAD_TOP,
  PAD_TOP_WITH_LABELS,
  cascadeStepMs,
  clampBarRadius,
  snapToGrid,
  valueTickTarget,
} from "@/lib/charts/geometry";
import { bandIndex, pointerToPlot } from "@/lib/charts/plot";
import {
  barStyleHasEdge,
  resolveBarStyle,
  slotsNeedingPattern,
  type BarStyle,
} from "@/lib/charts/palette";
import { estimateLabelWidth } from "@/lib/charts/measureText";
import { WRAP_LINE_EM, planCategoryLabels } from "@/lib/charts/labels";
import { useContainerWidth } from "@/hooks/useContainerWidth";
import { useTapAwayDismiss } from "@/hooks/useTapAwayDismiss";
import { useRevealOnScroll, revealClassName } from "@/hooks/useRevealOnScroll";
import { ChartTooltip, type TooltipRow } from "./ChartTooltip";
import { ChartNotes, type ChartNote } from "./ChartFrame";
import "@/lib/i18n-charts";
import { isSelectKey, type ChartSelectHandler } from "@/lib/charts/selection";

/**
 * Odstęp etykiety od krawędzi segmentu - pierwszy szczebel skali odstępów
 * (`SPACING` w `geometry.ts`). Ta sama liczba, z której model wyprowadził
 * swój domyślny próg, więc oba rachunki mówią o tym samym odstępie.
 */
const LABEL_INSET_PX = 4;

/**
 * Grubość segmentu, przy której liczba mieści się WEWNĄTRZ niego: pismo osi
 * (11 px, sekcja 4) plus odstęp z góry i z dołu. Dziewiętnaście pikseli - ten
 * sam licznik, którym model liczy `PERCENT_STACKED_LABEL_MIN_SHARE`.
 *
 * RÓŻNICA JEST W MIANOWNIKU I DLATEGO TEN PRÓG LICZY RENDER. Model dzieli
 * dziewiętnaście przez wysokość KARTY (domyślnie 320 px) i dostaje 0,059,
 * czyli 6% po zaokrągleniu w stronę bezpieczną - ale stos nie zajmuje całej
 * karty: nad polem rysunku leży `PAD_TOP`, pod nim margines na etykiety
 * kategorii. Przy domyślnej wysokości pole ma 284 px, więc prawdziwy próg to
 * 19/284 = 0,067, czyli o 12% OSTRZEJSZY niż domyślny - a przy bloku wysokim
 * 640 px pole ma 604 px i próg schodzi do 0,031, czyli DWUKROTNIE łagodniej.
 * Model nie ma prawa tego policzyć, bo nie zna ani marginesów, ani drabiny
 * etykiet; zna je tylko ten plik i dlatego podaje próg opcją `labelMinShare`.
 */
const LABEL_BOX_PX = FONT_AXIS + 2 * LABEL_INSET_PX;

/**
 * Szerokość słupka - i tak, jest większa niż `BAR_MAX` (24 px), co jest
 * świadomym odstąpieniem, a nie przeoczeniem.
 *
 * `BAR_MAX` jest wyprowadzone dla słupka, którego jedynym zadaniem jest
 * DŁUGOŚĆ: szerszy przestaje być słupkiem i staje się polem. Stos 100% ma
 * zadanie drugie, którego tamten nie ma - musi unieść liczbę WEWNĄTRZ
 * segmentu, bo blade wnętrze nie niesie tożsamości serii (sekcja 2), a próg
 * `PERCENT_STACKED_LABEL_MIN_SHARE` mierzy tylko grubość segmentu i milcząco
 * zakłada, że etykieta mieści się W POPRZEK. Napis „100%" ma przy pismie
 * 11 px około 28 px, więc w słupku szerokim 24 px nie mieści się w ogóle,
 * a „33%" zostawiałoby po 2 px odstępu - poniżej pierwszego szczebla skali.
 * Szerokość jest więc wyprowadzona z najdłuższej możliwej etykiety udziału
 * plus odstęp z obu stron; sufit i podłoga są jedną liczbą, bo węższy słupek
 * gubi etykiety, a szerszy niczego nie kupuje.
 */
const BAR_W_PX = Math.ceil(estimateLabelWidth("100%", FONT_AXIS)) + 2 * LABEL_INSET_PX;

/**
 * Poniżej tej grubości segment dostaje wypełnienie SOLIDNE bez obwódki
 * i bez prześwitu, niezależnie od wariantu wybranego dla całego wykresu.
 *
 * Cztery piksele, bo tyle zjadają nośniki granicy: obwódka wsuwa kształt
 * o `BAR_EDGE_INSET` z każdej strony (2 x 0,75 px), a prześwit stosu zabiera
 * jeszcze pół grubości linii z góry i z dołu. Segment cieńszy zostałby po
 * tych korektach kreską albo zniknąłby zupełnie, czyli udział 1% zostałby
 * pokazany jako udział zerowy. Rampa gradientu jest poniżej tej grubości
 * nieczytelna z tego samego powodu: trzy stopnie jasności rozłożone na trzech
 * pikselach nie są rampą, tylko szumem - dlatego specyfikacja każe tu solid.
 */
const NARROW_SEGMENT_PX = 4;

/** Prześwit w kolorze płyty między segmentami stosu - jak w kartezjańskim. */
const SEGMENT_GAP_PX = BAR_GAP / 2;

/**
 * Dopuszczalne podziałki osi całości, w punktach procentowych. Oś jest tu
 * stała (0..100), więc `niceScale` nie ma czego liczyć - wybór sprowadza się
 * do jednej z tych trzech gęstości. Kolejność jest kolejnością pierwszeństwa
 * przy remisie: od najgęstszej, bo gęstsza podziałka pozwala odczytać więcej
 * bez dymka.
 */
const TICK_STEPS_PP = [10, 25, 50] as const;

/**
 * Najmniejszy odstęp między podziałkami, przy którym etykiety jeszcze się nie
 * stykają: wysokość wiersza pisma osi (11 x 1,25 = 14 px) plus odstęp.
 */
const TICK_ROW_PX = Math.ceil(FONT_AXIS * 1.25) + LABEL_INSET_PX;

/** Odstęp etykiety sumy nad szczytem słupka - ten sam co w kartezjańskim. */
const TOTAL_LABEL_GAP_PX = 6;

/**
 * Znak braku wartości - ta sama kreska, którą `format.ts` stawia za nieliczbę,
 * a tabela danych za pole, którego model nie orzekł. Milczenie modelu nie ma
 * prawa dojechać do czytelnika jako liczba zastępcza.
 */
const BRAK_WARTOSCI = "-";

/**
 * OBSERWACJE DLA CZYTELNIKA, wypisane jawnie. Sklejenie
 * (`percentStacked.reading.${porada}`) jest niewidoczne dla trzech bramek
 * i18n, więc unia modelu mapuje się na klucze MAPĄ - ten sam wzorzec co
 * `TORNADO_NOTE_KEYS` w `Chart.tsx` i `READING_KEYS` w `HistogramChart.tsx`.
 *
 * Żadna z tych pięciu porad nie ma tu `null`, i to jest własność tego rodzaju,
 * nie szczęśliwy zbieg: każda mówi o tym, CO CZYTELNIK WIDZI na rysunku
 * (słupki bez segmentów, barwy nierozdzielne, słupek pełny w 100%, jeden
 * słupek, brak struktury), a nie o tym, co autor ma zrobić. Zalecenia
 * („weź pierścień", „zgrupuj ogon") niesie nakładka edytora przez
 * `percentStacked.advice.*`, których ten plik nie wolno mu wołać.
 */
const READING_KEYS: Record<PercentStackedFormAdvice, string> = {
  negativeValues: "percentStacked.reading.negativeValues",
  tooManySegments: "percentStacked.reading.tooManySegments",
  singleSegment: "percentStacked.reading.singleSegment",
  singleBar: "percentStacked.reading.singleBar",
  noStructure: "percentStacked.reading.noStructure",
};

/**
 * DLACZEGO SŁUPEK NIE MA STRUKTURY - sześć powodów, sześć różnych zdań. Mapa
 * jest wyczerpująca po `PercentStackedRowNote`, więc nowa wartość unii nie
 * skompiluje się bez klucza. Przypisy pochodzą z `percentStackedTable`, czyli
 * z tej samej funkcji, z której czyta je tabela danych - rysunek i tabela nie
 * mają jak powiedzieć o jednym słupku dwóch różnych rzeczy.
 */
const NOTE_KEYS: Record<PercentStackedRowNote, string> = {
  empty: "percentStacked.note.empty",
  zeroTotal: "percentStacked.note.zeroTotal",
  rejected: "percentStacked.note.rejected",
  incomplete: "percentStacked.note.incomplete",
  rescaled: "percentStacked.note.rescaled",
  duplicate: "percentStacked.note.duplicate",
};

/**
 * DLACZEGO SEGMENT NIE MA DŁUGOŚCI - pięć powodów, pięć zdań. Zero i brak są
 * tu OSOBNYMI stanami: zero jest pomiarem, brak nieuzupełnionym polem, a jedno
 * zdanie o „braku danych" zlepiłoby je w jedno.
 */
const CELL_NOTE_KEYS: Record<PercentStackedCellNote, string> = {
  zero: "percentStacked.cellNote.zero",
  missing: "percentStacked.cellNote.missing",
  negative: "percentStacked.cellNote.negative",
  tooLarge: "percentStacked.cellNote.tooLarge",
  noShare: "percentStacked.cellNote.noShare",
};

/**
 * Prostokąt segmentu z zaokrągloną WYŁĄCZNIE górną krawędzią.
 *
 * Kopia `barPath` z `CartesianChart` obcięta do jednego przypadku, i to nie
 * jest skrót: w stosie 100% końcem danych jest ZAWSZE góra, bo udziały są
 * nieujemne z definicji formy (słupek z wartością ujemną model odrzuca
 * w całości), a podstawa leży na krawędzi odniesienia i musi zostać
 * kwadratowa (sekcja 3). Pozostałe trzy gałęzie tamtej funkcji byłyby tu
 * kodem martwym, a martwy kierunek zaokrąglenia jest zaproszeniem do
 * narysowania kiedyś słupka rosnącego w dół od stu procent.
 */
function segmentPath(
  x: number,
  y: number,
  w: number,
  h: number,
  radius: number,
  bordered: boolean,
): string {
  const r = radius === 0 ? 0 : clampBarRadius(w, h, { bordered });
  if (r === 0) return `M${x} ${y}h${w}v${h}h${-w}Z`;
  return `M${x} ${y + h}v${-(h - r)}q0 ${-r} ${r} ${-r}h${w - 2 * r}q${r} 0 ${r} ${r}v${h - r}Z`;
}

/**
 * Krok podziałki osi całości. Oś jest stała, więc jedynym pytaniem jest
 * gęstość - a odpowiedź ma dwa warunki, w tej kolejności:
 *   1. etykiety NIE MOGĄ się stykać (twardy odrzut kandydata),
 *   2. z pozostałych bierzemy tę, której liczba podziałek jest najbliższa
 *      celowi silnika (`valueTickTarget`), żeby stos 100% nie miał innej
 *      gęstości rusztowania niż sąsiedni wykres na tej samej stronie.
 * Pięćdziesiątka jest wyjściem awaryjnym: przy polu rysunku na podłodze
 * (40 px) żadna gęstsza podziałka nie przechodzi warunku pierwszego, a oś bez
 * ani jednej liczby nie jest osią.
 */
function krokPodzialki(innerH: number, target: number): number {
  let wybrany = TICK_STEPS_PP[TICK_STEPS_PP.length - 1];
  let najlepszy = Number.POSITIVE_INFINITY;
  for (const krok of TICK_STEPS_PP) {
    if ((innerH * krok) / PERCENT_STACKED_WHOLE_PP < TICK_ROW_PX) continue;
    const odleglosc = Math.abs(PERCENT_STACKED_WHOLE_PP / krok + 1 - target);
    if (odleglosc < najlepszy) {
      najlepszy = odleglosc;
      wybrany = krok;
    }
  }
  return wybrany;
}

interface PercentStackedChartProps {
  config: ChartConfig;
  lang: ChartLang;
  /**
   * Wskazanie oddane na zewnątrz - kliknięciem albo klawiszem Enter.
   *
   * Ten rodzaj rozstrzyga JEDNO I DRUGIE: kolumna daje kategorię, a wysokość
   * w jej obrębie - segment, czyli serię. Dlatego ładunek niesie oba indeksy,
   * a nie sam słupek: „kliknąłem w Usługi w Polsce" jest inną informacją niż
   * „kliknąłem w słupek Polska".
   */
  onSelect?: ChartSelectHandler;
  /**
   * Nazwa dostępna rysunku PODANA Z ZEWNĄTRZ.
   *
   * Domyślnie buduje ją render z tytułu w konfiguracji. Osadzenie, które
   * rysuje własny nagłówek (karta panelu analitycznego), zostawia tytuł
   * w konfiguracji pusty - żeby nie było go dwa razy - i wtedy rysunek
   * nazywałby się „Wykres", czyli tak samo jak dziesięć sąsiadów na tym samym
   * pulpicie. Ta właściwość oddaje mu nazwę bez rysowania drugiego nagłówka.
   */
  ariaLabel?: string;
}

export function PercentStackedChart({
  config,
  lang,
  onSelect,
  ariaLabel: nazwaZadana,
}: PercentStackedChartProps) {
  // `keyPrefix` zamiast sklejania klucza w szablonie: bramka rozjazdu
  // kod<->słownik rozumie WYŁĄCZNIE prefiks podany hakowi, a klucz zlepiony
  // template literalem wypada z kontroli parytetu PL/EN.
  const { t: scoped } = useTranslation("translation", { keyPrefix: "charts" });
  const t = useCallback(
    (key: string, values?: Record<string, string | number>): string =>
      scoped(key, { lng: lang, ...values }),
    [scoped, lang],
  );
  const { ref: widthRef, width } = useContainerWidth<HTMLDivElement>();
  const { ref: revealRef, state: revealState } = useRevealOnScroll<HTMLDivElement>(config.animate);
  // W stanie siedzą WYŁĄCZNIE indeksy, nie gotowe piksele: geometria zmienia
  // się z każdą podmianą konfiguracji i z każdą zmianą szerokości kontenera.
  const [activeBar, setActiveBar] = useState<number | null>(null);
  const [activeSeg, setActiveSeg] = useState<number | null>(null);
  const baseId = useId();
  const hintId = `${baseId}-hint`;
  const summaryId = `${baseId}-sum`;
  const height = config.height;

  const clearActive = useCallback(() => {
    setActiveBar(null);
    setActiveSeg(null);
  }, []);
  // `useTapAwayDismiss` MUSI stać przed jakimkolwiek wczesnym wyjściem - hooki
  // nie mogą się warunkowo pomijać, a wyjście „brak kategorii" jest niżej.
  useTapAwayDismiss(activeBar !== null, widthRef, clearActive);

  const geometry = useMemo(() => {
    // ZAKRES Z MODELU I BEZ POPRAWEK: zawsze 0..100, bo osią jest całość.
    const zakres = percentStackedExtent();
    // Miejsce nad polem rysunku bierze się WYŁĄCZNIE z etykiet sumy: nad
    // szczytem stosu nie ma czego podpisywać, bo sto procent jest tautologią.
    const padTop = config.showValues ? PAD_TOP_WITH_LABELS : PAD_TOP;
    // Najszersza etykieta podziałki to ZAWSZE „100%", niezależnie od kroku -
    // więc margines lewy da się policzyć przed wyborem kroku i nie ma tu
    // pętli. Mierzymy, potem układamy (sekcja 4): margines wychodzi ze
    // szerokości napisu, nie odwrotnie, inaczej liczba wychodzi za płytę.
    const tickW = estimateLabelWidth(formatPercent(1, lang), FONT_AXIS);
    const padLeft = Math.max(PAD_LEFT_MIN, Math.ceil(tickW) + PAD_SIDE);
    const innerW = Math.max(MIN_INNER_W, width - padLeft - PAD_SIDE);
    const n = config.categories.length;
    const band = n > 0 ? innerW / n : innerW;
    // DRABINA ETYKIET KATEGORII - ta sama co w kartezjańskim, bo to ta sama
    // oś: kategorie w poziomie, jedna pod każdym słupkiem. Budżet na margines
    // dolny jest twardy, żeby obrócona etykieta nie zeszła z płótna na podpis
    // pod wykresem.
    const bottomBudget = Math.max(PAD_BOTTOM, height - padTop - MIN_INNER_H);
    const plan = planCategoryLabels(config.categories, {
      slotWidth: band,
      fontSize: FONT_AXIS,
      measure: (text: string) => estimateLabelWidth(text, FONT_AXIS),
      maxBottomSpace: bottomBudget,
    });
    const padBottom = Math.min(bottomBudget, Math.max(PAD_BOTTOM, snapToGrid(plan.bottomSpace)));
    const innerH = Math.max(MIN_INNER_H, height - padTop - padBottom);
    const value = linearScale(zakres.min, zakres.max, padTop + innerH, padTop);
    const catCenter = (i: number): number => padLeft + band * (i + 0.5);
    // Słupek nigdy nie wychodzi ze swojego pasma: przy wielu kategoriach
    // pasmo jest węższe niż etykieta udziału i wtedy to etykieta ustępuje,
    // a nie sąsiedni słupek.
    const barW = Math.max(2, Math.min(BAR_W_PX, band - BAR_GAP));
    const krok = krokPodzialki(innerH, valueTickTarget(innerH, false));
    const ticks: number[] = [];
    for (let pp = 0; pp <= PERCENT_STACKED_WHOLE_PP; pp += krok) ticks.push(pp);
    // Próg etykiety wewnątrz segmentu - patrz `LABEL_BOX_PX`.
    const labelMinShare = Math.min(1, LABEL_BOX_PX / Math.max(1, innerH));
    return {
      padTop,
      padLeft,
      innerW,
      innerH,
      value,
      band,
      catCenter,
      barW,
      ticks,
      plan,
      labelMinShare,
    };
  }, [config, height, width, lang]);

  const { padTop, padLeft, innerW, innerH, value, band, catCenter, barW, ticks, plan } = geometry;

  const model = useMemo(
    () => percentStackedModelFromConfig(config, { labelMinShare: geometry.labelMinShare }),
    [config, geometry.labelMinShare],
  );
  // TABELA WOŁANA DLA PRZYPISÓW, nie dla tabeli. Przypis wiersza („słupek
  // odrzucony", „brakuje składnika") liczy `percentStackedTable`, więc dymek
  // i tabela danych mówią o tym samym słupku to samo zdanie. Wyprowadzenie
  // przypisów po raz drugi z `bar.state` i list uczciwości byłoby sześcioma
  // linijkami, które mogą się z tamtymi rozjechać po cichu.
  const przypisy = useMemo(() => percentStackedTable(model), [model]);

  const bars = model.bars;
  const honesty = model.honesty;

  /* ---------------------------------------------------------------------- */
  /*  KLAWIATURA                                                             */
  /* ---------------------------------------------------------------------- */

  // POZIOM PO SŁUPKACH, PION PO SEGMENTACH - tak, jak biegnie rysunek.
  // Strzałka pozioma chodzi po WSZYSTKICH słupkach, także po odrzuconych:
  // pytanie „dlaczego tu nie ma słupka" jest jednym z pytań, na które ten
  // rodzaj musi odpowiedzieć, a słupek nieosiągalny klawiaturą nie ma jak
  // podać swojego powodu. Strzałka pionowa chodzi po wszystkich segmentach,
  // także po tych bez długości - z tego samego powodu: „składnika nie podano"
  // jest odpowiedzią, a segment o zerowej grubości nie jest trafialny.
  //
  // O PUSTY ARKUSZ TEN HAK NIE PYTA, i to nie jest przeoczenie: kontener
  // z `onKeyDown` powstaje dopiero PO wyjściu „brak słupków" niżej, więc
  // `bars.length === 0` nie ma tu jak być prawdą. Warunek stał tu wcześniej
  // i był gałęzią, której żaden test nie mógł zaczerwienić - a osłona, której
  // nie da się wywołać, uczy czytelnika, że pusty arkusz dochodzi aż tutaj.
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    // WYBÓR Z KLAWIATURY stoi PRZED pozostałymi gałęziami i kończy obsługę.
    if (isSelectKey(e.key)) {
      if (activeBar !== null && onSelect) {
        e.preventDefault();
        wskaz(activeBar, activeSeg);
      }
      return;
    }
    if (e.key === "Escape") {
      clearActive();
      return;
    }
    if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      e.preventDefault();
      const delta = e.key === "ArrowRight" ? 1 : -1;
      setActiveBar((prev) => {
        const next = prev === null ? (delta > 0 ? 0 : bars.length - 1) : prev + delta;
        return Math.max(0, Math.min(bars.length - 1, next));
      });
      // Zmiana słupka ZERUJE segment: ten sam numer serii w sąsiednim słupku
      // jest innym udziałem, a dymek, który został po poprzednim słupku,
      // pokazywałby liczbę nie z tego miejsca, na które patrzy czytelnik.
      setActiveSeg(null);
      return;
    }
    const wPionie = e.key === "ArrowUp" ? 1 : e.key === "ArrowDown" ? -1 : 0;
    if (wPionie === 0) return;
    e.preventDefault();
    // WSKAZANIE BYWA STARSZE NIŻ ARKUSZ, więc indeks idzie przez przycięcie,
    // a nie przez osłonę „gdy nie ma słupka, nie rób nic". Podgląd edytora
    // podmienia konfigurację pod tym samym komponentem, a stan trzyma numery:
    // po skróceniu arkusza z trzech kategorii do jednej `activeBar` wskazuje
    // słupek, którego już nie ma. Z osłoną strzałka pionowa milczała wtedy
    // w nieskończoność (segmentów pod tym numerem nie ma), czyli wskazanie
    // dawało się zdjąć wyłącznie Escapem albo strzałką poziomą. Przycięcie
    // LECZY stan: `setActiveBar(slupek)` niżej zapisuje numer istniejący.
    const slupek = Math.min(bars.length - 1, Math.max(0, activeBar ?? 0));
    const ile = bars[slupek].segments.length;
    // Arkusz z kategoriami i bez ani jednej serii ma słupki bez segmentów -
    // wtedy pion nie ma po czym chodzić i wskazanie zostaje tam, gdzie było.
    if (ile === 0) return;
    setActiveBar(slupek);
    setActiveSeg((prev) => {
      // Wejście od dołu wskazuje segment przy krawędzi odniesienia, wejście
      // od góry - szczyt stosu. Kierunek jest zgodny z rysunkiem, bo indeks
      // serii rośnie w stosie do góry.
      if (prev === null) return wPionie > 0 ? 0 : ile - 1;
      return Math.max(0, Math.min(ile - 1, prev + wPionie));
    });
  };

  /* ---------------------------------------------------------------------- */
  /*  PRZYPISY POD RYSUNKIEM                                                 */
  /* ---------------------------------------------------------------------- */

  // KOLEJNOŚĆ JEST TREŚCIĄ, nie kosmetyką - czytelnik czyta listę od góry
  // i pierwsze zdanie ustawia mu resztę:
  //   1. jak się czyta długość segmentu (bez tego środek stosu czyta się jak
  //      segment przy krawędzi odniesienia),
  //   2. obserwacje o formie (zmieniają sposób czytania CAŁEGO rysunku),
  //   3. defekty danych (dotyczą pojedynczych słupków i liczb),
  //   4. zaokrąglenie etykiety - pole informacyjne, na końcu.
  const notes: ChartNote[] = [];

  // ZDANIE O SKALI. Stoi tylko wtedy, gdy jest co czytać niepoprawnie:
  // segmentów środkowych nie ma ani przy jednej serii (jedyny segment zaczyna
  // się w zerze, więc nie ma skal przesuniętych), ani gdy nie narysowano
  // żadnego słupka. Zdanie widoczne zawsze uczy ignorowania wszystkich zdań.
  if (model.drawableBars > 0 && model.filledSeries > 1) {
    notes.push({ key: "scaleNote", text: t("percentStacked.scaleNote"), defect: false });
  }

  // RÓŻNICA SUM, powiedziana liczbą. Normalizacja do stu procent robi wszystkie
  // słupki równie długimi, więc struktura zbudowana z dziesięciu obserwacji
  // stoi obok struktury zbudowanej z dziesięciu tysięcy jako równa jej,
  // a rysunek nie daje powodu, żeby o to zapytać. Sumy są w tabeli, ale tabela
  // odpowiada dopiero na pytanie zadane.
  //
  // Próg jest rzędem wielkości, a nie zerem: zdanie przy KAŻDEJ różnicy sum
  // stałoby pod prawie każdym wykresem tego rodzaju.
  if (model.totalRatio !== null && model.totalRatio >= PERCENT_STACKED_TOTAL_RATIO) {
    notes.push({
      key: "totalRatioNote",
      text: t("percentStacked.totalRatioNote", {
        ratio: formatChartValue(model.totalRatio, lang, ""),
      }),
      defect: false,
    });
  }

  // Worek liczb podajemy KOMPLETEM dla wszystkich obserwacji: treść pisze
  // słownik, i18next zignoruje wstawki, których dane zdanie nie używa,
  // a POMINIĘTA wstawka nie jest ignorowana - zostaje w zdaniu jako surowe
  // `{{max}}` na opublikowanej stronie i żadna bramka tego nie widzi.
  for (const porada of percentStackedFormAdvice(model)) {
    notes.push({
      key: `reading.${porada}`,
      text: t(READING_KEYS[porada], { max: CATEGORICAL_SAFE_SERIES }),
      defect: false,
    });
  }

  // DEFEKTY DANYCH. Każdy ma w modelu osobną flagę i osobną listę etykiet, bo
  // podpis musi umieć powiedzieć, KTÓRA kategoria jest wadliwa, a nie tylko
  // że któraś jest. Wstawki podajemy PER KLUCZ, a nie jednym workiem: każde
  // z tych zdań mówi o INNEJ liście, a wspólny worek podstawiłby pierwszą
  // z nich do wszystkich.
  if (honesty.valuesNonNegativeOk === false) {
    notes.push({
      key: "honesty.valuesNonNegativeOk",
      text: t("percentStacked.honesty.valuesNonNegativeOk", {
        labels: honesty.negativeLabels.join(", "),
      }),
      defect: true,
    });
  }
  if (honesty.outOfRangeLabels.length > 0) {
    notes.push({
      key: "honesty.outOfRange",
      text: t("percentStacked.honesty.outOfRange", {
        labels: honesty.outOfRangeLabels.join(", "),
      }),
      defect: true,
    });
  }
  if (honesty.totalsPositiveOk === false) {
    notes.push({
      key: "honesty.totalsPositiveOk",
      text: t("percentStacked.honesty.totalsPositiveOk", {
        labels: honesty.zeroTotalLabels.join(", "),
      }),
      defect: true,
    });
  }
  if (honesty.emptyLabels.length > 0) {
    notes.push({
      key: "honesty.emptyCategories",
      text: t("percentStacked.honesty.emptyCategories", {
        labels: honesty.emptyLabels.join(", "),
      }),
      defect: true,
    });
  }
  if (honesty.structureComparableOk === false) {
    notes.push({
      key: "honesty.structureComparableOk",
      text: t("percentStacked.honesty.structureComparableOk", {
        labels: honesty.incompleteLabels.join(", "),
      }),
      defect: true,
    });
  }
  if (honesty.declaredTotalsOk === false) {
    notes.push({
      key: "honesty.declaredTotalsOk",
      text: t("percentStacked.honesty.declaredTotalsOk", {
        labels: honesty.rescaledLabels.join(", "),
      }),
      defect: true,
    });
  }
  if (honesty.duplicateLabels.length > 0) {
    notes.push({
      key: "honesty.duplicateCategories",
      text: t("percentStacked.honesty.duplicateCategories", {
        labels: honesty.duplicateLabels.join(", "),
      }),
      defect: true,
    });
  }
  if (honesty.duplicateSeriesNames.length > 0) {
    notes.push({
      key: "honesty.duplicateSeries",
      text: t("percentStacked.honesty.duplicateSeries", {
        names: honesty.duplicateSeriesNames.join(", "),
      }),
      defect: true,
    });
  }
  if (honesty.droppedValueCount > 0) {
    notes.push({
      key: "honesty.droppedValues",
      text: t("percentStacked.honesty.droppedValues", { count: honesty.droppedValueCount }),
      defect: true,
    });
  }
  // ZAOKRĄGLENIE ETYKIETY - POLE INFORMACYJNE, NIE DEFEKT, i próg jest tu
  // z geometrii, nie z ostrożności. Zaokrąglenie jest w tej formie konieczne
  // (etykiety w jednym słupku muszą sumować się do stu, bo czytelnik je
  // dodaje), a jego wielkość ograniczona jednostką wyświetlania - więc zdanie
  // ma sens tylko wtedy, gdy rozminięcie jest na TYM rysunku widoczne, czyli
  // przesuwa krawędź segmentu o co najmniej piksel. Sto punktów procentowych
  // leży na `innerH` pikselach, więc piksel to 100/innerH punktu.
  const rounding = honesty.maxRoundingShiftPp;
  if (rounding !== null && rounding >= PERCENT_STACKED_WHOLE_PP / Math.max(1, innerH)) {
    notes.push({
      key: "honesty.roundingShift",
      text: t("percentStacked.honesty.roundingShift", {
        pp: formatChartValue(finite(rounding), lang, ""),
      }),
      defect: false,
    });
  }

  // BRAK KATEGORII NIE MOŻE ZNACZYĆ „PUSTE MIEJSCE", ale nie może też znaczyć
  // „zgubione przypisy": liczby dopisane bez kategorii nie mają słupka, do
  // którego mogłyby wejść, i jedyne, co o nich mówi, to przypis
  // `honesty.droppedValues`. Wyjście MUSI stać po wszystkich hakach (patrz
  // `useTapAwayDismiss` wyżej).
  if (bars.length === 0) {
    return notes.length === 0 ? null : (
      <div ref={revealRef} className={revealClassName(revealState)}>
        <ChartNotes notes={notes} />
      </div>
    );
  }

  /* ---------------------------------------------------------------------- */
  /*  RYSUNEK                                                                */
  /* ---------------------------------------------------------------------- */

  /**
   * CZY JAKAKOLWIEK SERIA POTRZEBUJE KRESKOWANIA - drugiego nośnika różnicy
   * dla slotów poza zestawem rozdzielnym dla daltonizmu (7-8). W stosie
   * tożsamość segmentu niesie wyłącznie kolor i legenda, więc bez tego wzoru
   * legenda pokazywałaby podział, którego na rysunku nie ma.
   *
   * JEDNA LICZBA NA DWA PYTANIA, i to jest tu poprawka, nie skrót. Pytanie
   * „czy schodzić z wariantu bladego" i pytanie „czy definiować wzór" mają tę
   * samą odpowiedź, ale stały w dwóch miejscach: `patterned` liczyło się
   * w wywołaniu niżej, a `<pattern>` wypisywał się WYŁĄCZNIE przy
   * `barStyle === "solid"`. Autor, który wybrał wariant gradientowy i slot 7,
   * dostawał nakładkę z `fill="url(#...-hatch)"` bez wzoru pod tym adresem -
   * a nieistniejący serwer malowania nie jest błędem, tylko BRAKIEM
   * wypełnienia: drugi nośnik różnicy znikał po cichu dokładnie tam, gdzie
   * legenda go obiecuje.
   */
  const kreskowaneSloty = slotsNeedingPattern(model.series.map((s) => s.colorSlot));
  const potrzebujeKreskowania = kreskowaneSloty.size > 0;

  /**
   * WARIANT WYPEŁNIENIA, rozstrzygnięty RAZ dla całego wykresu. Dwa warianty
   * na jednym rysunku znaczyłyby, że wnętrze raz niesie kolor serii, a raz
   * nie - czyli czytelnik musiałby wiedzieć, którą regułą czytać który
   * segment.
   *
   * `stacked: true` jest tu podane na sztywno, bo normalizacja do całości JEST
   * stosem - i to jedno wystarcza, żeby `resolveBarStyle` zeszło z wariantu
   * bladego do solidnego: przy jasności 0,93 odległość CIELAB między bladymi
   * wypełnieniami spada praktycznie do zera po symulacji daltonizmu, a stos ma
   * z definicji więcej niż jeden segment i nie ma osi, do której można by
   * przypiąć każdy z nich osobno.
   */
  const barStyle: BarStyle = resolveBarStyle(config.barStyle, {
    seriesCount: model.series.length,
    stacked: true,
    patterned: potrzebujeKreskowania,
    slots: model.series.map((s) => s.colorSlot),
  });
  const hatchId = `${baseId.replace(/:/g, "")}-hatch`;
  const gradientId = (slot: number): string => `${baseId.replace(/:/g, "")}-g${slot}`;
  // SLOTY BEZ POWTÓRZEŃ: rampa jest definicją PER SLOT, a dwie serie wolno
  // autorowi posadzić na tym samym slocie (`parseChartSeries` przepuszcza
  // każdy numer od 1 do 8). Bez odsiania powtórzeń szły do `<defs>` dwa
  // elementy o jednym `id` - dokument z podwójnym identyfikatorem jest
  // niepoprawny, a React dostaje na dodatek dwa dzieci o tym samym kluczu.
  const gradientSlots =
    barStyle === "gradient" ? [...new Set(model.series.map((s) => s.colorSlot))] : [];
  const cascade = cascadeStepMs(bars.length);
  const yZera = finite(value(0), padTop + innerH);

  const czynnySlupek: PercentStackedBar | null =
    activeBar === null ? null : (bars[activeBar] ?? null);
  const czynnySegment =
    czynnySlupek === null || activeSeg === null ? null : (czynnySlupek.segments[activeSeg] ?? null);

  /** Udział albo KRESKA. `null` znaczy milczenie modelu, nigdy zero. */
  const udzial = (share: number | null): string =>
    share === null ? BRAK_WARTOSCI : formatPercent(finite(share), lang);
  /** Punkty procentowe albo KRESKA - rozpiętość i przesunięcie udziału. */
  const punkty = (pp: number | null): string =>
    pp === null ? BRAK_WARTOSCI : formatPercentPoints(finite(pp), lang);
  /**
   * Suma kategorii albo KRESKA. Słupek nierysowany ma w modelu `total: 0`, ale
   * to nie jest orzeczenie o danych - to wartość, którą model wpisuje tam,
   * gdzie mianownika NIE MA (suma zerowa, wartość ujemna, sam brak). Wypisanie
   * zera twierdziłoby, że zmierzono całość równą zeru.
   */
  const suma = (bar: PercentStackedBar): string =>
    bar.drawable ? formatChartValue(finite(bar.total), lang, config.unit) : BRAK_WARTOSCI;
  /** Etykieta udziału - liczba, którą czytelnik DODAJE do sąsiednich. */
  const napisUdzialu = (displayShare: number): string =>
    formatPercent(finite(displayShare) / PERCENT_STACKED_WHOLE_PP, lang);

  /**
   * CZY SUMY MIESZCZĄ SIĘ NAD SŁUPKAMI - pytanie zadane RAZ dla całego rzędu.
   *
   * Liczba nad stosem jest pisana tym samym pismem co etykieta udziału, ale
   * mierzy się ją w poprzek PASMA, nie słupka: pasmo zwęża się z liczbą
   * kategorii, a napis nie. Zmierzone przy domyślnej szerokości: przy
   * czternastu kategoriach pasmo ma 47,7 px i napis „100 000" ma 47,7 px,
   * czyli sąsiednie liczby już się stykają; przy dwudziestu pasmo ma 33 px
   * i wchodzą jedna w drugą o czternaście pikseli. Dwie liczby napisane jedna
   * na drugiej nie są liczbami - a etykieta wartości ma w tym silniku ustąpić
   * tak samo, jak ustępuje etykieta udziału, gdy nie mieści się w poprzek
   * segmentu.
   *
   * USTĘPUJĄ WSZYSTKIE ALBO ŻADNA, tą samą regułą, którą drabina etykiet
   * kategorii stosuje do zawinięcia: rząd, w którym część słupków ma sumę,
   * a część nie, czytałby się jako „tamtych nie zmierzono". Suma zostaje
   * wtedy w dymku, w nazwie dostępnej i w tabeli danych - czyli we wszystkich
   * trzech kanałach, którymi ta forma niesie wielkość całości.
   */
  const sumyMieszcza = bars.every(
    (bar) => !bar.drawable || estimateLabelWidth(suma(bar), FONT_AXIS) + LABEL_INSET_PX <= band,
  );

  /** Przypisy wiersza tego słupka, po jednym zdaniu na powód. */
  const powody = (index: number): string[] =>
    (przypisy.rows[index]?.notes ?? []).map((n) => t(NOTE_KEYS[n]));

  const wskaznik = (e: PointerEvent<SVGRectElement>): void => {
    const point = pointerToPlot(
      e.clientX,
      e.clientY,
      e.currentTarget.getBoundingClientRect(),
      innerW,
      innerH,
    );
    if (point === null) return;
    // STREFA TRAFIENIA TO CAŁA KOLUMNA KATEGORII, nie kształt segmentu
    // (sekcja 6): segment o udziale 1% ma przy domyślnej wysokości 3 px i jest
    // palcem nietrafialny. Kolumnę wybiera współrzędna pozioma, a segment
    // W JEJ OBRĘBIE - pionowa, przeliczona na punkty procentowe.
    const i = bandIndex(point.x, band, bars.length);
    setActiveBar(i);
    const pp = PERCENT_STACKED_WHOLE_PP * (1 - point.y / Math.max(1, innerH));
    const segmenty = bars[i]?.segments ?? [];
    const k = segmenty.findIndex((s) => s.visible && pp >= s.from && pp <= s.to);
    setActiveSeg(k >= 0 ? k : null);
    if (e.type === "pointerdown") wskaz(i, k >= 0 ? k : null);
  };

  /**
   * Jeden nadawca wskazania - kliknięcie i klawisz składają TEN SAM ładunek.
   *
   * Segment bywa `null`, bo wskaźnik trafia też w prześwit nad stosem; wtedy
   * czytelnik wskazał kategorię i tyle, a zmyślenie serii byłoby dopisaniem
   * informacji, której nie podał.
   */
  const wskaz = (bar: number, seg: number | null): void => {
    if (!onSelect) return;
    const slupek = bars[bar];
    if (slupek === undefined) return;
    const segment = seg === null ? null : (slupek.segments[seg] ?? null);
    onSelect({
      kind: config.kind,
      categoryIndex: bar,
      category: slupek.label,
      seriesIndex: seg,
      seriesName: segment === null ? null : segment.seriesName,
      value: segment === null ? null : segment.value,
    });
  };

  // DYMEK: nazwa serii, jej udział, jej WARTOŚĆ BEZWZGLĘDNA i suma kategorii.
  // Udział bez wartości bezwzględnej jest w tej formie informacją niepełną,
  // bo rysunek wyrzuca poziom - dwa słupki o identycznej strukturze mogą
  // różnić się rzędem wielkości.
  const tooltipRows: TooltipRow[] =
    czynnySlupek === null
      ? []
      : czynnySegment === null
        ? [
            {
              name: t("percentStacked.table.total"),
              value: suma(czynnySlupek),
              colorSlot: null,
              emphasised: true,
            },
          ]
        : [
            {
              // Nazwa serii bywa pusta (autor nie wpisał), a dymek bez nazwy
              // wiersza nie mówi, czego dotyczy liczba - wtedy nagłówek
              // kolumny tabeli danych jest jedyną uczciwą nazwą.
              name: czynnySegment.seriesName || t("percentStacked.table.series"),
              value: czynnySegment.visible
                ? napisUdzialu(czynnySegment.displayShare)
                : BRAK_WARTOSCI,
              colorSlot: czynnySegment.colorSlot,
              emphasised: true,
            },
            {
              name: t("percentStacked.table.value"),
              value:
                czynnySegment.value === null
                  ? BRAK_WARTOSCI
                  : formatChartValue(finite(czynnySegment.value), lang, config.unit),
              colorSlot: null,
            },
            {
              name: t("percentStacked.table.total"),
              value: suma(czynnySlupek),
              colorSlot: null,
            },
          ];

  // DOPISEK DYMKA MÓWI, CZEGO NIE MA I DLACZEGO. Słupek bez struktury i segment
  // bez długości wyglądają dokładnie tak samo jak miejsce, w którym nic nie
  // narysowano - więc powód jedzie w dymku, a nie tylko w tabeli. Zdania są
  // krótkie i stoją w slocie dopisku, bo to nie jest wartość: to flaga stanu.
  const tooltipNote =
    czynnySlupek === null
      ? undefined
      : czynnySegment !== null && czynnySegment.state !== "share"
        ? t(CELL_NOTE_KEYS[czynnySegment.state])
        : powody(czynnySlupek.index).join(" ") || undefined;

  const yDymka =
    czynnySegment !== null && czynnySegment.visible
      ? finite((value(czynnySegment.from) + value(czynnySegment.to)) / 2, padTop + innerH / 2)
      : czynnySlupek !== null && czynnySlupek.drawable
        ? finite(value(PERCENT_STACKED_WHOLE_PP), padTop)
        : yZera;

  /**
   * BRZEG SERII W OPISIE WYKRESU - ta część alternatywy tekstowej, która NIE
   * jest zapisem rysunku, tylko jego dopełnieniem tam, gdzie rysunek jest
   * najsłabszy. Segment środkowy leży na skali przesuniętej, więc pytanie
   * „czy udział tej serii rośnie" odczytuje się z wykresu przez porównanie
   * dwóch różnic - a tu jest podane liczbą. Kolejność pól jest stała, żeby
   * czytelnik ekranu uczył się jednego porządku.
   */
  const opisSerii = (s: PercentStackedSeriesSummary): string =>
    [
      `${t("percentStacked.summary.series")} ${s.name || String(s.seriesIndex + 1)}`,
      `${t("percentStacked.summary.bars")} ${formatChartValue(finite(s.bars), lang, "")}`,
      `${t("percentStacked.summary.total")} ${formatChartValue(finite(s.total), lang, config.unit)}`,
      `${t("percentStacked.summary.minShare")} ${udzial(s.minShare)}`,
      `${t("percentStacked.summary.maxShare")} ${udzial(s.maxShare)}`,
      `${t("percentStacked.summary.span")} ${punkty(s.spanPp)}`,
      `${t("percentStacked.summary.first")} ${udzial(s.firstShare)}`,
      `${t("percentStacked.summary.last")} ${udzial(s.lastShare)}`,
      `${t("percentStacked.summary.shift")} ${punkty(s.shiftPp)}`,
    ].join(", ");

  // NAZWA DOSTĘPNA NIESIE SUMY BEZWZGLĘDNE, i to jest najważniejsza linijka
  // dostępności tego rodzaju. Czytelnik ekranu nie widzi ani równej wysokości
  // słupków, ani tego, że jeden z nich jest całością sto razy mniejszą -
  // a dymek dla niego nie istnieje. Oś całości jest nazwana, bo procent na
  // rysunku nazywa ją wyłącznie wzrokowo.
  const ariaLabel =
    nazwaZadana ??
    [
      config.title ? t("a11y.chart", { title: config.title }) : t("a11y.chartUntitled"),
      `${t("percentStacked.axis.share")}: ${formatPercent(0, lang)} - ${formatPercent(1, lang)}`,
      `${t("percentStacked.axis.category")}: ${bars
        .map((b) => {
          const powod = powody(b.index);
          return `${b.label}: ${t("percentStacked.table.total")} ${suma(b)}${
            powod.length > 0 ? `. ${powod.join(" ")}` : ""
          }`;
        })
        .join("; ")}`,
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
        // PODPOWIEDŹ KLAWIATURY jako OPIS, nie nazwa: nazwa mówi, CO to jest,
        // opis - jak tego użyć. Drugi opis niesie brzeg serii, bo to liczby,
        // których na rysunku nie ma, a nie nazwa obiektu.
        aria-describedby={model.drawableBars > 0 ? `${hintId} ${summaryId}` : hintId}
        onKeyDown={onKeyDown}
        onBlur={clearActive}
      >
        <span id={hintId} className="sr-only">
          {t("a11y.keyboardHint")}
        </span>
        {model.drawableBars > 0 && (
          <span id={summaryId} className="sr-only">
            {model.series.map(opisSerii).join(". ")}
          </span>
        )}
        <svg width={width} height={height} className="block overflow-visible">
          {gradientSlots.length > 0 && (
            <defs>
              {gradientSlots.map((slot) => (
                // RAMPA JEST PER SEGMENT (`objectBoundingBox`), nie globalna:
                // gradient zakotwiczony na całym słupku sprawiłby, że kolor
                // segmentu zależy od jego POZYCJI w stosie, czyli przestaje
                // nieść tożsamość serii - a w stosie nie ma drugiego nośnika.
                // Stopień środkowy prostuje deformację interpolacji sRGB.
                <linearGradient key={slot} id={gradientId(slot)} x1={0} y1={1} x2={0} y2={0}>
                  <stop offset="0" stopColor={`var(--chart-${slot}-deep)`} />
                  <stop offset="0.5" stopColor={`var(--chart-${slot}-mid)`} />
                  <stop offset="1" stopColor={`var(--chart-${slot}-face)`} />
                </linearGradient>
              ))}
            </defs>
          )}
          {potrzebujeKreskowania && (
            <defs>
              {/* Paski w kolorze PŁYTY, nie serii, więc jedna definicja
                  obsługuje każdy slot. Rytm 5/3 px jest wzięty z próbki
                  legendy, żeby klucz i znacznik miały ten sam wzór.
                  Warunek pyta o SLOTY, nie o wariant wypełnienia - patrz
                  `potrzebujeKreskowania`. */}
              <pattern id={hatchId} width="8" height="8" patternUnits="userSpaceOnUse">
                <rect x="5" y="0" width="3" height="8" fill="var(--card)" />
              </pattern>
            </defs>
          )}

          {/* Siatka podziałki całości. Rusztowanie zostaje cienkie
              i recesywne (sekcja 3). */}
          {config.showGrid &&
            ticks.map((tick) => (
              <line
                key={tick}
                x1={padLeft}
                x2={padLeft + innerW}
                y1={finite(value(tick), padTop)}
                y2={finite(value(tick), padTop)}
                stroke="var(--chart-grid)"
                strokeWidth={1}
              />
            ))}

          {/* Podziałki osi całości. Znak procentu jest tu nazwą osi: liczby
              bez niego czytałyby się jako wartości, a nie jako udziały. */}
          {ticks.map((tick) => (
            <text
              key={tick}
              x={padLeft - 8}
              y={finite(value(tick), padTop) + 3.5}
              textAnchor="end"
              fontSize={FONT_AXIS}
              fill="var(--muted-foreground)"
              className="tabular-nums"
            >
              {formatPercent(tick / PERCENT_STACKED_WHOLE_PP, lang)}
            </text>
          ))}

          {/* Krawędź odniesienia. Zero jest tu bezwarunkowe i nie ma opcji:
              udział koduje DŁUGOŚĆ, więc ucięta oś zniekształcałaby proporcję
              wprost (sekcja 8), a górną granicą jest całość. */}
          <line
            x1={padLeft}
            x2={padLeft + innerW}
            y1={yZera}
            y2={yZera}
            stroke="var(--chart-axis)"
            strokeWidth={1}
          />

          {/* PODŚWIETLENIE KOLUMNY - POD segmentami, bo jest afordancją strefy
              trafienia („kursor jest w tej kategorii"), a nie podświetleniem
              danych. Położone NA wypełnieniu przyciemniałoby zakodowany
              udział, czyli wskazanie zmieniałoby kodowanie.

              WARUNKIEM JEST SŁUPEK, NIE NUMER W STANIE. Stan trzyma indeks,
              a arkusz pod komponentem się zmienia (podgląd edytora), więc
              numer bywa starszy niż dane. Przy `activeBar !== null` kolumna
              rysowała się wtedy pod `catCenter` poza polem: przy skróceniu
              arkusza z trzech kategorii do jednej wychodziło x = 1376 na
              płótnie szerokim 720 px, a `overflow-visible` wypuszcza taki
              prostokąt NA SĄSIEDNI BLOK strony - przy dymku, którego już nie
              ma, bo ten pyta o `czynnySlupek`. Jeden warunek na oba znaczniki
              i podświetlenie nie ma jak wskazać kategorii, której nie ma. */}
          {czynnySlupek !== null && (
            <rect
              x={catCenter(czynnySlupek.index) - band / 2}
              y={padTop}
              width={band}
              height={innerH}
              fill="var(--foreground)"
              fillOpacity={0.05}
              pointerEvents="none"
            />
          )}

          {/* ===== SEGMENTY STOSU =====
              Kolejność rysowania jest kolejnością arkuszową: pierwsza seria
              przy krawędzi odniesienia, ostatnia u szczytu. Model nie sortuje
              i render też nie - inaczej ta sama seria leżałaby w każdym słupku
              na innej wysokości i oko nie miałoby czego prowadzić wzdłuż
              rysunku. */}
          {bars.map((bar) => {
            const x0 = catCenter(bar.index) - barW / 2;
            if (!bar.drawable) {
              // SŁUPEK BEZ STRUKTURY ZOSTAJE KRESKĄ NA KRAWĘDZI ODNIESIENIA,
              // a nie pustym miejscem. Puste miejsce czyta się jako „tu nic
              // nie zmierzono", a to nie to samo co „zmierzono i nie da się
              // z tego zbudować struktury"; powód niesie dymek, nazwa dostępna
              // i przypis pod rysunkiem.
              return (
                <line
                  key={bar.index}
                  data-role="gap"
                  data-bar={bar.index}
                  x1={x0}
                  x2={x0 + barW}
                  y1={yZera}
                  y2={yZera}
                  stroke="var(--muted-foreground)"
                  strokeWidth={2}
                />
              );
            }
            return (
              <g key={bar.index}>
                {bar.segments.map((seg) => {
                  if (!seg.visible) return null;
                  const yGora = finite(value(seg.to), padTop);
                  const yDol = finite(value(seg.from), padTop + innerH);
                  const grubosc = Math.max(0, yDol - yGora);
                  // WĄSKI SEGMENT IDZIE SOLIDEM - patrz `NARROW_SEGMENT_PX`.
                  const waski = grubosc < NARROW_SEGMENT_PX;
                  const styl: BarStyle = waski ? "solid" : barStyle;
                  const obwodka = barStyleHasEdge(styl);
                  const inset = obwodka ? BAR_EDGE_INSET : 0;
                  const wPoprzek = Math.max(0, barW - 2 * inset);
                  // Podłoga pół piksela: segment o dodatnim udziale MUSI być
                  // widoczny, bo zniknięty czyta się jako udział zerowy.
                  const wzdluz = Math.max(0.5, grubosc - 2 * inset);
                  const kreskowany = kreskowaneSloty.has(seg.colorSlot) && !waski;
                  const shape = segmentPath(
                    x0 + inset,
                    yGora + inset,
                    wPoprzek,
                    wzdluz,
                    // ZAOKRĄGLA SIĘ WYŁĄCZNIE KONIEC DANYCH, czyli górna
                    // krawędź OSTATNIEGO widocznego segmentu. Model mówi
                    // wprost, który to jest (`isLastVisible`), więc render nie
                    // wyprowadza tego po raz drugi z wartości.
                    seg.isLastVisible ? CHART_RADIUS : 0,
                    obwodka,
                  );
                  const czynny = activeBar === bar.index && activeSeg === seg.seriesIndex;
                  return (
                    <g key={seg.seriesIndex}>
                      <path
                        d={shape}
                        data-role="segment"
                        data-bar={bar.index}
                        data-series={seg.seriesIndex}
                        data-active={czynny ? "true" : undefined}
                        data-edged={obwodka ? "true" : undefined}
                        data-style={styl}
                        className="neh-bar"
                        fill={
                          styl === "gradient"
                            ? `url(#${gradientId(seg.colorSlot)})`
                            : `var(--chart-${seg.colorSlot})`
                        }
                        // PRZEŚWIT STOSU W KOLORZE PŁYTY jest geometrią, nie
                        // dekoracją: bez niego dwa sąsiednie segmenty stykają
                        // się i na granicy powstaje fałszywy trzeci kolor.
                        // Segment wąski go nie dostaje, bo linia zjadłaby go
                        // w całości.
                        stroke={
                          styl === "gradient"
                            ? `var(--chart-${seg.colorSlot})`
                            : waski
                              ? undefined
                              : "var(--card)"
                        }
                        strokeWidth={obwodka ? undefined : waski ? 0 : SEGMENT_GAP_PX}
                        // Kaskada idzie PO SŁUPKACH, nie po segmentach:
                        // wchodzące kolumny czyta się jako rysunek, który się
                        // buduje, a wchodzące segmenty - jako rozsypany stos.
                        style={{ ["--neh-i" as string]: bar.index }}
                      />
                      {kreskowany && (
                        <path
                          d={shape}
                          fill={`url(#${hatchId})`}
                          className="neh-bar"
                          style={{ ["--neh-i" as string]: bar.index }}
                          pointerEvents="none"
                        />
                      )}
                    </g>
                  );
                })}

                {/* ETYKIETA UDZIAŁU WCHODZI DO SEGMENTU tylko wtedy, gdy ten
                    ma na nią grubość (`labelInside` z progu podanego modelowi)
                    ORAZ szerokość. Model liczy tylko grubość, bo w poprzek
                    mierzy słupek - a słupek zwęża się razem z pasmem, gdy
                    kategorii jest wiele. Liczba, która nie mieści się
                    wewnątrz, zostaje w dymku i w tabeli danych; wystawiona
                    obok segmentu wskazywałaby nie ten segment, co swój. */}
                {bar.segments.map((seg) => {
                  if (!seg.labelInside) return null;
                  const napis = napisUdzialu(seg.displayShare);
                  if (estimateLabelWidth(napis, FONT_AXIS) + 2 * LABEL_INSET_PX > barW) return null;
                  const ySrodek = finite(
                    (value(seg.from) + value(seg.to)) / 2,
                    padTop + innerH / 2,
                  );
                  return (
                    <text
                      key={`u${seg.seriesIndex}`}
                      data-role="segment-label"
                      x={catCenter(bar.index)}
                      y={ySrodek + 3.5}
                      textAnchor="middle"
                      fontSize={FONT_AXIS}
                      // TUSZ SLOTU, nie tusz semantyczny: wypełnienie segmentu
                      // jest tu NASYCONE (wariant blady schodzi do solidnego
                      // przez sam stos), a `--chart-ink-N` jest dobrany
                      // kontrastem właśnie do niego - na granacie wychodzi
                      // biały, na ochrze ciemny. Tusz semantyczny miałby na
                      // granacie 2,25:1.
                      fill={`var(--chart-ink-${seg.colorSlot})`}
                      className="neh-fade neh-value-label tabular-nums"
                      pointerEvents="none"
                    >
                      {napis}
                    </text>
                  );
                })}
              </g>
            );
          })}

          {/* SUMA KATEGORII NAD SŁUPKIEM - jedyna liczba warta postawienia nad
              stosem 100%. Sto procent jest tautologią, a suma jest tym, co ta
              forma wyrzuca: dwa słupki o identycznej strukturze mogą różnić
              się rzędem wielkości i wyglądają wtedy tak samo. Rząd ustępuje
              w całości, gdy liczby nie mieszczą się w pasmach - patrz
              `sumyMieszcza`. */}
          {config.showValues &&
            sumyMieszcza &&
            bars.map((bar) =>
              bar.drawable ? (
                <text
                  key={`s${bar.index}`}
                  data-role="bar-total"
                  data-bar={bar.index}
                  x={catCenter(bar.index)}
                  y={finite(value(PERCENT_STACKED_WHOLE_PP), padTop) - TOTAL_LABEL_GAP_PX}
                  textAnchor="middle"
                  fontSize={FONT_AXIS}
                  fill="var(--foreground)"
                  className="neh-fade neh-total-label tabular-nums"
                >
                  {suma(bar)}
                </text>
              ) : null,
            )}

          {/* ETYKIETY KATEGORII - drabina z `lib/charts/labels.ts`: najpierw
              wszystkie, potem zawinięcie, przerzedzenie, skrót i obrót. Nigdy
              wielokropek bez podpowiedzi - pełna treść jedzie w `<title>`. */}
          {plan.visible.map((i) => {
            const label = plan.labels[i] ?? config.categories[i] ?? "";
            const full = plan.full[i] ?? label;
            const y = padTop + innerH + 16;
            const obrocona = plan.rotation !== 0;
            const linie = plan.mode === "wrapped" ? plan.lines?.[i] : undefined;
            const c = catCenter(i);
            return (
              <text
                key={i}
                x={c}
                y={y}
                textAnchor={obrocona ? "end" : "middle"}
                fontSize={FONT_AXIS}
                fill="var(--muted-foreground)"
                transform={obrocona ? `rotate(${plan.rotation} ${c} ${y})` : undefined}
              >
                {linie
                  ? linie.map((linia, li) => (
                      <tspan key={li} x={c} dy={li === 0 ? 0 : `${WRAP_LINE_EM}em`}>
                        {linia}
                      </tspan>
                    ))
                  : label}
                {label !== full && <title>{full}</title>}
              </text>
            );
          })}

          {/* Warstwa trafień na CAŁE pole rysunku - strefa trafienia nigdy nie
              jest kształtem elementu (sekcja 6). */}
          <rect
            className="neh-hit"
            x={padLeft}
            y={padTop}
            width={innerW}
            height={innerH}
            fill="transparent"
            onPointerDown={wskaznik}
            onPointerMove={wskaznik}
            onPointerLeave={(e) => {
              // Dotyk NIE gasi dymka przy opuszczeniu warstwy: palec schodzi
              // z ekranu po każdym stuknięciu, więc dymek zniknąłby zawsze
              // natychmiast po pokazaniu. Gasi go stuknięcie poza wykresem
              // (`useTapAwayDismiss`).
              if (e.pointerType !== "touch") clearActive();
            }}
          />
        </svg>

        <ChartTooltip
          visible={czynnySlupek !== null}
          x={czynnySlupek === null ? 0 : catCenter(czynnySlupek.index)}
          y={yDymka}
          containerWidth={width}
          title={czynnySlupek?.label ?? ""}
          note={tooltipNote}
          rows={tooltipRows}
        />
      </div>

      <ChartNotes notes={notes} />
    </div>
  );
}
