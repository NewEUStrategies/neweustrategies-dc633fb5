// SMALL MULTIPLES - SIATKA MAŁYCH PANELI, JEDNA WSPÓLNA OŚ WARTOŚCI.
//
// PYTANIE ANALITYCZNE. Tabela doboru formy z sekcji 1, wiersz "Wiele
// podmiotów na wielu wskaźnikach -> small multiples, tabela ze sparklines",
// a w kolumnie "Czego unikać" jedno słowo: RADAR. Ten sam rodzaj jest
// zamiennikiem wykresu, któremu wyszło więcej niż sześć serii (sekcja 2:
// "maksymalnie 5-6 kolorów kategorialnych, powyżej grupuj albo idź w small
// multiples"). Czytelnik porównuje tu POZYCJĘ NA WSPÓLNEJ SKALI - kanał
// najwyższy w hierarchii percepcyjnej - zamiast powierzchni radaru, która
// zależy od arbitralnej kolejności osi, albo zamiast ośmiu kolorów, z których
// dwa ostatnie i tak są nierozdzielne po symulacji daltonizmu.
//
// CZEMU TO NIE JEST WARIANT `CartesianChart`, i to jest jedyna decyzja
// architektoniczna tego pliku warta uzasadnienia.
//
// `CartesianChart` stoi na czterech założeniach naraz: JEDNO pole rysunku,
// JEDNA oś kategorii, JEDNA oś wartości, a serie odróżnia KOLOR. Small
// multiples odwracają każde z nich: pól rysunku jest n, oś wartości jest jedna
// i WSPÓLNA DLA WSZYSTKICH PÓL, tożsamość podmiotu niesie POZYCJA panelu wraz
// z jego podpisem, a kolor nie koduje niczego (dlatego wszystkie panele mają
// domyślnie jeden slot palety - patrz `paletteWrapOk` w modelu). Dołożenie
// tego jako wariantu znaczyłoby wstawienie SIATKI pól do komponentu, którego
// cały kontrakt brzmi "jedna para osi", i dołożenie do niego DRUGIEGO
// rozstrzygnięcia o skali - wspólna albo osobna per panel - którego żaden
// pozostały wariant nigdy nie użyje. Wariant, którego gałęzi nie wykonuje
// nikt poza jednym rodzajem, jest osobnym rodzajem napisanym w cudzym pliku.
//
// Z tej decyzji wynika reszta pliku:
//   * GEOMETRIA JEST ZAGNIEŻDŻONA: siatka -> panel -> punkt. Model podaje
//     komórki i punkty w jednostkach WZGLĘDNYCH (0..1), a render mnoży je
//     przez swoje piksele - dzięki temu ta sama siatka wychodzi w SSR i po
//     zmierzeniu kontenera, a dwa rendery tych samych danych nie mogą
//     policzyć dwóch różnych siatek;
//   * OŚ JEST PODPISANA RAZ, NA BRZEGU SIATKI. Podziałki wartości stoją przy
//     panelach z KOLUMNY ZEROWEJ, etykiety kategorii pod NAJNIŻSZYM panelem
//     każdej kolumny, a nazwy obu osi raz nad siatką. Podpis przy każdym
//     panelu zjadłby panele: przy progu 96 px szerokości sama kolumna liczb
//     zabiera jej trzecią część, a razy pięć kolumn - całe pole rysunku;
//   * KLAWIATURA CHODZI PO PANELACH, nie po punktach w panelu - uzasadnienie
//     stoi przy `onKeyDown`, bo tam jest decyzja;
//   * PANELE ZA MAŁE ZNACZĄ BRAK RYSUNKU. `smallMultiplesFit` orzeka, czy
//     komórka utrzymuje się nad progiem `SMALL_MULTIPLES_MIN_PANEL_W/H`;
//     poniżej progu render bierze najpierw liczbę kolumn, którą model
//     podpowiada (`suggestedColumns`), a gdy i ona nie wychodzi - rysunku NIE
//     MA. Panel 96 px na 56 px nie jest rysunkiem, tylko plamą z podpisem,
//     a plama z podpisem kłamie mocniej niż jej brak: wygląda na odczytaną.
//
// CZEGO TEN KOMPONENT NIE LICZY: niczego. Siatka, kolejność paneli, wspólna
// domena, pozycje punktów, spłaszczenie, indeks bazowy i wszystkie trzynaście
// sprawdzeń uczciwości pochodzą z `lib/charts/kinds/smallMultiples.ts`. Tu
// jest wyłącznie mnożenie ułamków przez piksele i rysowanie.
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
  formatPercentPoints,
  type ChartLang,
} from "@/lib/charts/format";
import { finite } from "@/lib/charts/num";
import {
  SMALL_MULTIPLES_MAX_COMFORT,
  SMALL_MULTIPLES_SUMMARY_COLUMNS,
  smallMultiplesFit,
  smallMultiplesFormAdvice,
  smallMultiplesModelFromConfig,
  type SmallMultiplesDomain,
  type SmallMultiplesFormAdvice,
  type SmallMultiplesMark,
  type SmallMultiplesMode,
  type SmallMultiplesModel,
  type SmallMultiplesOrder,
  type SmallMultiplesPanel,
  type SmallMultiplesPanelBy,
  type SmallMultiplesScaleMode,
  type SmallMultiplesSummaryColumn,
} from "@/lib/charts/kinds/smallMultiples";
import {
  BAR_GAP,
  BAR_MAX,
  FONT_AXIS,
  MIN_DOT_SPACING,
  MIN_INNER_H,
  MIN_INNER_W,
  PAD_BOTTOM,
  PAD_LEFT_MIN,
  PAD_SIDE,
  PAD_TOP_WITH_LABELS,
  cascadeStepMs,
  clampBarRadius,
  shouldShowDots,
  snapToGrid,
} from "@/lib/charts/geometry";
import { cellAddress, pointerToPlot } from "@/lib/charts/plot";
import { estimateLabelWidth, estimateMaxLabelWidth } from "@/lib/charts/measureText";
import { useContainerWidth } from "@/hooks/useContainerWidth";
import { useTapAwayDismiss } from "@/hooks/useTapAwayDismiss";
import { useRevealOnScroll, revealClassName } from "@/hooks/useRevealOnScroll";
import { ChartTooltip, type TooltipRow } from "./ChartTooltip";
import { ChartNotes, type ChartNote } from "./ChartFrame";
import "@/lib/i18n-charts";
import { isSelectKey, type ChartSelectHandler } from "@/lib/charts/selection";

/**
 * Wysokość wiersza podpisu panelu, w pikselach - ta sama liczba, z której
 * model wyprowadził próg `SMALL_MULTIPLES_MIN_PANEL_H` (40 px pola, 16 px
 * podpisu, 8 px odstępu, 8 px etykiet kategorii). Gdyby render brał tu inną
 * wysokość, orzeczenie `smallMultiplesFit` dotyczyłoby innego panelu niż ten
 * narysowany: model zaświadczałby "mieści się", a pole rysunku byłoby pod
 * podłogą.
 */
const PANEL_LABEL_H = 16;

/**
 * Prześwit między komórkami siatki (pierwszy szczebel skali odstępów).
 *
 * ODEJMOWANY OD KAŻDEJ KOMÓRKI, także od tych w ostatniej kolumnie i w
 * ostatnim rzędzie - i to nie jest marnowanie miejsca, tylko warunek
 * porównywalności. Panel rozciągnięty na wolny prześwit miałby inną proporcję
 * niż pozostałe, a proporcja pola decyduje o KĄCIE nachylenia linii: ten sam
 * wzrost pokazywałby się wtedy pod dwoma różnymi kątami.
 */
const PANEL_GAP = 8;

/** Odstęp podpisów od pola rysunku - ten sam co w kartezjańskim i w roju. */
const LABEL_GAP_PX = 8;

/** Powietrze między dwiema sąsiednimi etykietami kategorii. */
const CATEGORY_LABEL_GAP_PX = 4;

/** Zejście linii bazowej tekstu do środka wiersza podziałki. */
const TICK_NUDGE = 3.5;

/**
 * Promień kropki obserwacji jako atrybut AWARYJNY - właściwą wartość podaje
 * token `--chart-dot` przez klasę `.neh-dot`. Ta sama konwencja co w
 * kartezjańskim: atrybut działa, dopóki arkusz nie dojedzie.
 */
const DOT_R_PX = 2.8;

/** Grubość obwódki kropki - awaryjna, właściwa idzie z `--chart-dot-ring`. */
const DOT_RING_PX = 1.6;

/**
 * Klucze OBSERWACJI dla czytelnika, wypisane JAWNIE mapą, a nie sklejone
 * z wartości unii - bramka `chartDictionaryKeys` i kontrola parytetu PL/EN
 * widzą wyłącznie pełne ścieżki, więc klucz sklejony (`t(\`...${a}\`)`) jest
 * dla nich niewidoczny i literówka w nazwie porady wychodzi dopiero na
 * ekranie, jako surowa ścieżka słownika przy rysunku.
 *
 * Wszystkie osiem wartości `SmallMultiplesFormAdvice` ma tu treść, bo
 * wszystkie osiem mówią coś o TYM rysunku, a nie o wyborze autora. Zalecenie
 * ("weź tabelę ze sparklines", "posortuj kluczem z danych") mieszka
 * w nakładce edytora - patrz `src/lib/charts/formAdvice.ts` i bramka
 * `chartAdviceAudience.test.ts`.
 */
const READING_KEYS: Record<SmallMultiplesFormAdvice, string> = {
  singlePanel: "smallMultiples.reading.singlePanel",
  tooManyPanels: "smallMultiples.reading.tooManyPanels",
  indexBaseBetter: "smallMultiples.reading.indexBaseBetter",
  undeclaredFreeScale: "smallMultiples.reading.undeclaredFreeScale",
  mixedUnits: "smallMultiples.reading.mixedUnits",
  noSpread: "smallMultiples.reading.noSpread",
  sheetOrder: "smallMultiples.reading.sheetOrder",
  oneCategory: "smallMultiples.reading.oneCategory",
};

/**
 * Czym panele są uporządkowane - komplet sześciu wartości `SmallMultiplesOrder`.
 *
 * TO ZDANIE JEST WYPISYWANE ZAWSZE i jest to decyzja, nie przeoczenie.
 * Kolejność paneli jest w tej formie nośnikiem informacji dokładnie tak samo
 * jak w posortowanych słupkach poziomych: czytelnik czyta panele rzędami
 * i pierwsze wrażenie bierze z pierwszego rzędu. Czym ten rząd został wybrany,
 * NIE DA SIĘ odczytać z obrazka - a bez tej wiedzy pierwsze wrażenie jest
 * przypadkowe.
 */
const ORDER_KEYS: Record<SmallMultiplesOrder, string> = {
  mean: "smallMultiples.order.mean",
  max: "smallMultiples.order.max",
  span: "smallMultiples.order.span",
  last: "smallMultiples.order.last",
  label: "smallMultiples.order.label",
  input: "smallMultiples.order.input",
};

/**
 * Nazwy kolumn kompletu podsumowującego panel. Kolejność bierze się
 * z `SMALL_MULTIPLES_SUMMARY_COLUMNS`, żeby czytelnik ekranu i czytelnik
 * tabeli danych dostali liczby w tym samym porządku; mapa jest jawna z tego
 * samego powodu co `READING_KEYS`.
 */
const SUMMARY_KEYS: Record<SmallMultiplesSummaryColumn, string> = {
  panel: "smallMultiples.summary.panel",
  n: "smallMultiples.summary.n",
  min: "smallMultiples.summary.min",
  max: "smallMultiples.summary.max",
  mean: "smallMultiples.summary.mean",
  first: "smallMultiples.summary.first",
  last: "smallMultiples.summary.last",
  change: "smallMultiples.summary.change",
  changePct: "smallMultiples.summary.changePct",
  occupancy: "smallMultiples.summary.occupancy",
};

/** Znak braku - ta sama kreska, którą `format.ts` stawia za nieliczbę. */
const BRAK_WARTOSCI = "-";

/**
 * Opcje modelu, których `ChartConfig` NIE UMIE WYRAZIĆ, a które rozstrzygają
 * o tym, co rysunek twierdzi.
 *
 * PO CO SĄ PROPSEM, a nie stałą w tym pliku. Model paneli ma dziesięć decyzji
 * (wspólna czy osobna skala, opis osobnej skali, poziom czy indeks, baza
 * indeksu, klucz porządku, znacznik, domena z zewnątrz, sloty per panel,
 * żądanie usunięcia pustych paneli, liczba kolumn), a `ChartConfig` nie ma na
 * nie ANI JEDNEGO pola - przyjdą razem z nakładką edytora. Zapisane na sztywno
 * w renderze zostawiłyby MARTWĄ połowę sprawdzeń uczciwości: rysunek z osobnymi
 * skalami nie miałby jak powstać, więc komunikat o nich nie miałby jak zostać
 * sprawdzony, a treści w słowniku wyglądałyby na wdrożone.
 *
 * Wszystkie pola są PRYMITYWAMI (domena rozbita na dwie liczby, nie obiekt),
 * bo wchodzą do listy zależności `useMemo`: obiekt przekazany literałem miałby
 * przy każdym renderze rodzica nową tożsamość i przeliczałby całą geometrię.
 */
export interface SmallMultiplesRenderOptions {
  /** Który wymiar arkusza jest panelem - patrz `SmallMultiplesPanelBy`. */
  panelBy?: SmallMultiplesPanelBy;
  /** Wspólna czy osobna oś wartości. Domyślnie wspólna. */
  scaleMode?: SmallMultiplesScaleMode;
  /** Opis, dlaczego panele mają osobne skale. Bez niego osobna skala jest defektem. */
  freeScaleNote?: string;
  /** Poziom albo indeks bazowy (baza = 100). */
  mode?: SmallMultiplesMode;
  /** Kategoria bazowa indeksu - ta sama dla wszystkich paneli. */
  indexBaseAt?: number;
  /** Czym porządkujemy panele. */
  order?: SmallMultiplesOrder;
  /** Czym panel koduje wartość - decyduje o zerze w domenie. */
  mark?: SmallMultiplesMark;
  /** Wymuszona liczba kolumn; bez niej siatkę liczy model z proporcji pola. */
  columns?: number;
  /** Zachować sloty palety per panel (domyślnie wszystkie panele mają jeden). */
  keepPanelSlots?: boolean;
  /** Żądanie usunięcia pustych paneli. Model go NIE SPEŁNIA i zgłasza. */
  dropEmptyPanels?: boolean;
  /** Domena z zewnątrz - do porównywania kilku rysunków jedną skalą. */
  domainMin?: number;
  domainMax?: number;
}

interface SmallMultiplesChartProps {
  config: ChartConfig;
  lang: ChartLang;
  options?: SmallMultiplesRenderOptions;
  /**
   * Wskazanie oddane na zewnątrz - kliknięciem w panel albo Enterem.
   *
   * Panelem jest tu SERIA albo KATEGORIA, zależnie od `panelBy`, więc ładunek
   * niesie etykietę panelu, a nie indeks osi: to jedyna tożsamość, która
   * znaczy to samo w obu układach.
   */
  onSelect?: ChartSelectHandler;
}

/** Jeden panel gotowy do narysowania: pole w pikselach i ścieżki znacznika. */
interface PanelBox {
  panel: SmallMultiplesPanel;
  /** Pole rysunku panelu (bez wiersza podpisu i bez prześwitu). */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Łamana z PRZERWAMI na lukach - luka przerywa linię, nie schodzi do zera. */
  line: string;
  /** Pola pod łamaną, osobne dla każdego nieprzerwanego odcinka. */
  areas: string[];
  bars: Array<{ category: number; x: number; y: number; w: number; h: number; r: number }>;
  dots: Array<{ category: number; cx: number; cy: number }>;
  /**
   * OSTATNI POMIAR panelu razem z jego zapisem - do etykiety bezpośredniej.
   * `null`, gdy panel jest pusty albo gdy w trybie indeksu nie ma go na czym
   * policzyć.
   */
  last: { cx: number; cy: number; text: string } | null;
  /** Piksel zera, gdy zero leży WEWNĄTRZ domeny panelu; inaczej `null`. */
  zeroY: number | null;
}

/**
 * Ułamek 0..1 OD DOŁU dla wartości w domenie panelu - jedyna kopia tego wzoru
 * w renderze i ta sama arytmetyka, którą model stosuje do punktów (`pozycja`
 * w `kinds/smallMultiples.ts`), włącznie z rozstrzygnięciem o domenie BEZ
 * ROZPIĘTOŚCI.
 *
 * DOMENA O ZEROWEJ ROZPIĘTOŚCI NIE JEST PRZYPADKIEM TEORETYCZNYM: domena
 * podana z zewnątrz nie przechodzi przez `niceScale` (autor podał ją
 * dokładnie), więc `domainMin === domainMax` daje `span === 0`. Model stawia
 * wtedy KAŻDY punkt w połowie wysokości, bo dolna i górna krawędź panelu
 * znaczą to samo. Render miał tu własną kopię wzoru bez tej osłony i przy
 * domenie 5..5 wychodziło z niej dzielenie przez zero: `finite` sprowadzało
 * podziałkę „5" na DOLNĄ krawędź pola (y = 155,5 przy polu 40..152), a kropka
 * z wartością 5 stała w połowie (y = 96). Podpis osi leżał wtedy 56 px pod
 * wartością, którą opisywał - czyli czytelnik odmierzający kropkę podziałką
 * odczytywał liczbę, której w danych nie ma.
 */
function ulamekWDomenie(value: number, dom: SmallMultiplesDomain): number {
  if (!(dom.span > 0)) return 0.5;
  return (value - dom.min) / dom.span;
}

/** Ucięcie etykiety do dostępnej szerokości; pełną treść niesie `<title>`. */
function skrot(label: string, maxPx: number): string {
  const limit = Math.max(1, Math.floor(maxPx / (FONT_AXIS * 0.62)));
  return label.length > limit ? `${label.slice(0, Math.max(1, limit - 1))}…` : label;
}

export function SmallMultiplesChart({ config, lang, options, onSelect }: SmallMultiplesChartProps) {
  const { t: scoped } = useTranslation("translation", { keyPrefix: "charts" });
  const t = useCallback(
    (key: string, values?: Record<string, string | number>): string =>
      scoped(key, { lng: lang, ...values }),
    [scoped, lang],
  );
  const { ref: widthRef, width } = useContainerWidth<HTMLDivElement>();
  const { ref: revealRef, state: revealState } = useRevealOnScroll<HTMLDivElement>(config.animate);
  const [active, setActive] = useState<number | null>(null);
  const baseId = useId();
  const hintId = `${baseId}-hint`;
  const height = config.height;

  // `useTapAwayDismiss` MUSI stać przed jakimkolwiek wczesnym wyjściem - hooki
  // nie mogą się warunkowo pomijać, a wyjście "nie ma czego rysować" jest niżej.
  const clearActive = useCallback(() => setActive(null), []);
  useTapAwayDismiss(active !== null, widthRef, clearActive);

  // Opcje rozpakowane na prymitywy - patrz komentarz przy typie.
  const {
    panelBy,
    scaleMode: zadanaSkala,
    freeScaleNote,
    mode,
    indexBaseAt,
    order,
    mark,
    columns,
    keepPanelSlots,
    dropEmptyPanels,
    domainMin,
    domainMax,
  } = options ?? {};

  const geometry = useMemo(() => {
    const buduj = (extra: { areaAspect?: number; columns?: number }): SmallMultiplesModel =>
      smallMultiplesModelFromConfig(config, {
        panelBy,
        scaleMode: zadanaSkala,
        freeScaleNote,
        mode,
        indexBaseAt,
        order,
        mark,
        keepPanelSlots,
        dropEmptyPanels,
        domain:
          domainMin !== undefined && domainMax !== undefined
            ? { min: domainMin, max: domainMax }
            : null,
        columns: extra.columns ?? columns,
        areaAspect: extra.areaAspect,
        // FORMATOWANIE WSTRZYKNIĘTE, bo domyślne w modelu jest bez Intl
        // i bez locale (moduł jest czysty). Bez tego etykieta punktu i liczba
        // w tabeli danych zapisywałyby tę samą wartość dwiema konwencjami -
        // "13.5" na rysunku i "13,5" w tabeli tego samego wpisu.
        formatValue: (v) => formatChartValue(v, lang, config.unit),
      });

    // PRZEJŚCIE ZERO: model bez znajomości pikseli, wyłącznie po podziałki
    // wspólnej osi. Szerokość ich etykiet wyznacza lewy margines, a margines
    // wyznacza proporcję obszaru siatki - czyli liczbę kolumn. Odwrotna
    // kolejność (najpierw siatka) dawałaby liczby ucięte krawędzią płyty,
    // czyli wymaganie bezwzględne sekcji 1 złamane.
    const probe = buduj({});
    const tickW = Math.max(
      ...probe.scale.shared.ticks.map((tk) =>
        estimateLabelWidth(formatAxisTick(tk, lang), FONT_AXIS),
      ),
      0,
    );
    const padLeft = Math.max(PAD_LEFT_MIN, snapToGrid(tickW + PAD_SIDE));
    const gridW = Math.max(MIN_INNER_W, width - padLeft - PAD_SIDE);
    const gridH = Math.max(MIN_INNER_H, height - PAD_TOP_WITH_LABELS - PAD_BOTTOM);
    // Mianownik jest dodatni z definicji (`Math.max(MIN_INNER_H, ...)`), więc
    // osłony na zero tu nie ma - byłaby gałęzią, której nie wykonuje nikt,
    // a gałąź niewykonywana wygląda w przeglądzie jak sprawdzony przypadek.
    const areaAspect = gridW / gridH;

    // PRZEJŚCIE PIERWSZE: siatka policzona z PRAWDZIWEJ proporcji pola.
    let model = buduj({ areaAspect });
    let fit = smallMultiplesFit(model, { width: gridW, height: gridH });

    // PRZEJŚCIE DRUGIE: SIATKA Z LICZBY KOLUMN, KTÓRĄ PODAJE MODEL, i render
    // nie ma o niej własnego zdania - także co do KIERUNKU zmiany. Pierwotny
    // komentarz w tym miejscu obiecywał "mniej kolumn, siatka dłuższa w dół";
    // ZMIERZONE jest odwrotnie i musi być odwrotnie: przy sześciu panelach na
    // płycie 160 px komórka ma 56 px wysokości (próg to 72), a wysokość
    // odzyskuje się ZMNIEJSZENIEM LICZBY RZĘDÓW, czyli zwiększeniem liczby
    // kolumn - `suggestedColumns` daje tu 6 zamiast 3 i siatka staje się
    // jednym rzędem paneli 104 na 88 px. Render bierze tę liczbę bez oceny,
    // bo drugie zdanie o siatce po stronie renderu znaczyłoby dwie różne
    // siatki z tych samych danych. Wymuszenia autora nie nadpisujemy: kto
    // podał liczbę kolumn, ten dostaje swoją.
    if (!fit.ok && columns === undefined && fit.suggestedColumns !== null) {
      const przeliczony = buduj({ areaAspect, columns: fit.suggestedColumns });
      const fitPrzeliczony = smallMultiplesFit(przeliczony, { width: gridW, height: gridH });
      if (fitPrzeliczony.ok) {
        model = przeliczony;
        fit = fitPrzeliczony;
      }
    }

    const categoryCount = model.categories.length;
    const cellW = gridW * model.grid.cellWidth;
    const cellH = gridH * model.grid.cellHeight;
    const plotW = Math.max(1, cellW - PANEL_GAP);
    const plotH = Math.max(1, cellH - PANEL_LABEL_H - PANEL_GAP);
    // Kropki obserwacji: próg gęstości jak w kartezjańskim PLUS odstęp, przy
    // którym kropki się jeszcze nie zlewają. W panelu o szerokości 110 px
    // dwanaście pomiarów leży co 10 px, czyli kropka o promieniu 2,8 px ma
    // jeszcze prześwit; przy dwudziestu czterech nie ma go już wcale.
    const odstep = categoryCount > 1 ? plotW / (categoryCount - 1) : plotW;
    const pokazKropki = shouldShowDots(categoryCount, 0) && odstep >= MIN_DOT_SPACING;

    const boxes: PanelBox[] = model.panels.map((panel) => {
      const x = finite(padLeft + gridW * panel.x, padLeft);
      const yCell = finite(PAD_TOP_WITH_LABELS + gridH * panel.y, PAD_TOP_WITH_LABELS);
      const y = yCell + PANEL_LABEL_H;
      const dom = panel.domain;
      // Piksel wartości. `v` przychodzi z modelu jako 0..1 OD DOŁU, więc
      // odwrócenie osi jest tutaj - model nie zna układu współrzędnych SVG.
      const pixel = (v: number): number => finite(y + (1 - v) * plotH, y + plotH);
      // Zero rysujemy tylko wtedy, gdy leży WEWNĄTRZ domeny. Zero na krawędzi
      // pokrywałoby się z granicą pola, więc druga linia w tym samym miejscu
      // niosłaby wyłącznie ciemniejszy piksel.
      const zeroV = dom.span > 0 ? ulamekWDomenie(0, dom) : null;
      const zeroY = zeroV !== null && zeroV > 0 && zeroV < 1 ? pixel(zeroV) : null;
      const baseV = zeroV === null ? 0 : Math.max(0, Math.min(1, zeroV));
      const baseY = pixel(baseV);

      const odcinki: string[][] = [];
      let biezacy: string[] = [];
      const dots: PanelBox["dots"] = [];
      const bars: PanelBox["bars"] = [];
      let last: PanelBox["last"] = null;
      // SZEROKOŚĆ SŁUPKA I JEGO POŁOŻENIE. `t` jest pozycją PUNKTU (0 na lewej
      // krawędzi, 1 na prawej), więc słupek postawiony środkiem na `t`
      // wystawałby połową poza panel na obu krańcach. Wsuwamy go o własną
      // szerokość: `t` = 0 daje słupek przy lewej krawędzi, `t` = 1 przy
      // prawej, a odstępy między słupkami zostają równe.
      const barW = Math.max(1, Math.min(BAR_MAX, plotW / Math.max(1, categoryCount) - BAR_GAP));

      for (const [i, p] of panel.points.entries()) {
        if (p.v === null) {
          if (biezacy.length > 0) odcinki.push(biezacy);
          biezacy = [];
          continue;
        }
        const cx = finite(x + p.t * plotW, x);
        const cy = pixel(p.v);
        biezacy.push(`${cx.toFixed(2)} ${cy.toFixed(2)}`);
        // ETYKIETA BEZPOŚREDNIA MUSI ZGADZAĆ SIĘ Z POZYCJĄ, na której stoi.
        // Model daje w `text` ZAWSZE poziom (bo o "ile" pyta się w jednostkach
        // danych, a indeks stoi w osobnej kolumnie tabeli) - ale w trybie
        // indeksu linia leży na osi INDEKSU, więc poziom wypisany przy niej
        // opisywałby inną liczbę niż ta, którą czytelnik odmierzy podziałką.
        // Dlatego przy indeksie bierzemy `indexed`, a gdy go nie ma - nie
        // wypisujemy nic.
        //
        // Gałąź `p.indexed === null` jest w tym miejscu NIEOSIĄGALNA (pozycja
        // punktu w trybie indeksu powstaje z indeksu, więc punkt bez indeksu
        // nie ma `v` i nie dochodzi tutaj), ale zostaje jawna: gdyby model
        // kiedyś przestał tak liczyć, etykieta wypisałaby przy linii indeksu
        // POZIOM, czyli liczbę, której czytelnik nie odmierzy podziałką.
        const zapis =
          model.scale.mode === "index"
            ? p.indexed === null
              ? null
              : formatChartValue(p.indexed, lang, "")
            : p.text;
        last = zapis === null ? last : { cx, cy, text: zapis };
        // KROPKA PRZY PUNKCIE OSAMOTNIONYM jest obowiązkowa, a nie ozdobna:
        // odcinek z jednego pomiaru nie ma długości, więc bez kropki panel
        // z jedną wartością byłby PUSTY - a pusty panel znaczy w tej formie
        // "brak danych o tym podmiocie".
        const sam =
          (panel.points[i - 1]?.v ?? null) === null && (panel.points[i + 1]?.v ?? null) === null;
        if (model.mark !== "bar" && (pokazKropki || sam)) {
          dots.push({ category: p.category, cx, cy });
        }
        if (model.mark === "bar") {
          const bx = finite(x + p.t * (plotW - barW), x);
          const gora = Math.min(cy, baseY);
          const wysokosc = Math.max(0, Math.abs(baseY - cy));
          bars.push({
            category: p.category,
            x: bx,
            y: gora,
            w: barW,
            h: wysokosc,
            // Wariant SOLIDNY, więc podłoga promienia to połowa długości -
            // patrz `clampBarRadius`.
            r: clampBarRadius(barW, wysokosc, { inset: 0, bordered: false }),
          });
        }
      }
      if (biezacy.length > 0) odcinki.push(biezacy);

      const line = odcinki
        .filter((o) => o.length > 1)
        .map((o) => `M${o.join(" L")}`)
        .join(" ");
      const areas =
        model.mark === "area"
          ? odcinki
              .filter((o) => o.length > 1)
              .map((o) => {
                const pierwszy = o[0].split(" ")[0];
                const ostatni = o[o.length - 1].split(" ")[0];
                return `M${pierwszy} ${baseY.toFixed(2)} L${o.join(" L")} L${ostatni} ${baseY.toFixed(2)} Z`;
              })
          : [];

      return { panel, x, y, w: plotW, h: plotH, line, areas, bars, dots, last, zeroY };
    });

    return { model, fit, padLeft, gridW, gridH, boxes };
  }, [
    config,
    lang,
    width,
    height,
    panelBy,
    zadanaSkala,
    freeScaleNote,
    mode,
    indexBaseAt,
    order,
    mark,
    columns,
    keepPanelSlots,
    dropEmptyPanels,
    domainMin,
    domainMax,
  ]);

  const { model, fit, padLeft, gridW, gridH, boxes } = geometry;
  const wolna = model.scale.scaleMode === "free";
  /**
   * Opis autora, dlaczego panele mają osobne skale - raz przycięty, bo idzie
   * w TRZY miejsca (uwaga pod siatką, podpowiedź każdego panelu, sprawdzenie
   * długości) i trzy kopie `(freeScaleNote ?? "").trim()` rozjeżdżają się przy
   * pierwszej zmianie reguły pustego napisu.
   */
  const opisSkaliWolnej = (freeScaleNote ?? "").trim();
  const indeks = model.scale.mode === "index";
  // JEDNOSTKA NIE DOKLEJA SIĘ DO INDEKSU. Indeks jest ilorazem, więc "112 mld
  // EUR" byłoby zdaniem o jednostce, której ta liczba nie ma.
  const jednostkaOsi = indeks ? "" : config.unit;
  const categoryCount = model.categories.length;
  /**
   * Czy w danych jest CHOĆ JEDNA liczba. Od tego zależy, czy wolno postawić
   * podziałki: domena pustego zestawu wychodzi z modelu jako 0..1 (bo skala
   * musi mieć rozpiętość), więc podpisane podziałki pod pustymi panelami
   * niosłyby zakres, którego w danych nie ma - dokładnie ten defekt, którego
   * model odmawia w `domenaWlasna` dla panelu pustego.
   */
  const maDane = model.observations > 0;

  /**
   * Piksel wartości w polu panelu - podziałki i siatka liczą go TYM SAMYM
   * wzorem co punkty (`ulamekWDomenie`), bo podziałka policzona osobno
   * opisywałaby inne miejsce niż to, w którym leży kropka.
   */
  const pikselWartosci = (value: number, box: PanelBox): number =>
    finite(box.y + (1 - ulamekWDomenie(value, box.panel.domain)) * box.h, box.y + box.h);

  /** Zapis jednej kolumny kompletu - `null` modelu czyta się jako BRAK. */
  const zapisKolumny = (panel: SmallMultiplesPanel, col: SmallMultiplesSummaryColumn): string => {
    switch (col) {
      case "panel":
        return panel.label;
      // `n` jest LICZNIKIEM obserwacji, nie wartością - jednostka przy nim
      // ("12 mld EUR" zamiast "12 obserwacji") byłaby fałszem.
      case "n":
        return formatChartValue(panel.n, lang, "");
      case "min":
      case "max":
      case "mean":
      case "first":
      case "last":
      case "change": {
        const v = panel[col];
        return v === null ? BRAK_WARTOSCI : formatChartValue(v, lang, config.unit);
      }
      case "changePct":
        return panel.changePct === null
          ? BRAK_WARTOSCI
          : formatPercentPoints(panel.changePct, lang);
      case "occupancy":
        return panel.occupancy === null ? BRAK_WARTOSCI : formatPercent(panel.occupancy, lang);
    }
  };

  /**
   * Komplet liczb panelu dla czytelnika ekranu. Kolejność z
   * `SMALL_MULTIPLES_SUMMARY_COLUMNS`, czyli ta sama co w tabeli danych -
   * czytelnik ekranu i czytelnik tabeli uczą się jednego porządku.
   *
   * PANEL SPŁASZCZONY DOSTAJE ZDANIE O TYM, że jego liczb nie da się odczytać
   * z rysunku. To jedyny rodzaj w tym silniku, w którym część danych jest
   * nieczytelna Z ZAŁOŻENIA (wspólna oś spłaszcza panel o dwa rzędy wielkości
   * mniejszy od największego), a czytelnik widzący obrazek nie ma z czego
   * wywnioskować, że patrzy na kreskę, a nie na brak zmian.
   */
  const opisPanelu = (panel: SmallMultiplesPanel): string => {
    const liczby = SMALL_MULTIPLES_SUMMARY_COLUMNS.filter((c) => c !== "panel").map(
      (col) => `${t(SUMMARY_KEYS[col])} ${zapisKolumny(panel, col)}`,
    );
    // Jednostki NIE powtarzamy osobno - niesie ją każda liczba kompletu
    // (`formatChartValue` z `config.unit`), a wypisana drugi raz brzmiałaby
    // jak kolejna kolumna bez wartości.
    const uwagi = [
      panel.empty ? t("smallMultiples.note.empty") : "",
      panel.flattened ? t("smallMultiples.note.flattened") : "",
      indeks && !panel.empty && !panel.indexable ? t("smallMultiples.note.noIndexBase") : "",
    ].filter(Boolean);
    // KRAŃCE WŁASNEJ OSI PANELU TYLKO PRZY SKALACH OSOBNYCH, i to jest ta sama
    // informacja, którą widzący dostaje w `data-role="panel-axis"`. Przy
    // wspólnej osi zakres stoi raz, w zdaniu o osi na początku nazwy; przy
    // osobnych stoi przy KAŻDYM panelu, bo wtedy żadne dwa panele nie mierzą
    // tą samą miarą i jeden zakres na cały rysunek byłby zdaniem o osi,
    // której nie ma.
    const osWlasna =
      wolna && maDane
        ? `${t("smallMultiples.axis.value")}: ${formatChartValue(
            panel.domain.min,
            lang,
            jednostkaOsi,
          )} - ${formatChartValue(panel.domain.max, lang, jednostkaOsi)}`
        : "";
    return (
      [`${zapisKolumny(panel, "panel")}: ${liczby.join(", ")}`, osWlasna, ...uwagi]
        .filter(Boolean)
        .join(". ") + "."
    );
  };

  // NAZWA DOSTĘPNA JEST CAŁYM RYSUNKIEM DLA CZYTELNIKA EKRANU, więc niesie
  // komplet: zakres wspólnej osi, zakres osi kategorii, deklarację skali,
  // deklarację porządku i komplet liczb KAŻDEGO panelu. Zdania ze słownika
  // kończą się kropką same, dlatego łączymy spacją, a kropkę dokładamy tylko
  // do zdań składanych tutaj - inaczej w odczycie pojawia się podwójna kropka.
  const ariaLabel = [
    `${config.title ? t("a11y.chart", { title: config.title }) : t("a11y.chartUntitled")}.`,
    // ZAKRES WSPÓLNEJ OSI TYLKO WTEDY, GDY TA OŚ ISTNIEJE I MA Z CZEGO POWSTAĆ.
    // Dwa stany, w których wypisywany był wcześniej, są stanami BEZ tej osi,
    // i oba render odmawia narysować - a nazwa dostępna jest tym samym
    // rysunkiem, tylko czytanym:
    //   * BRAK JAKIEJKOLWIEK LICZBY. Domena pustego zestawu wychodzi z modelu
    //     jako 0..1 (skala musi mieć rozpiętość), więc zdanie „Wartość: 0 mld
    //     EUR - 1 mld EUR" podawało czytelnikowi ekranu zakres, którego
    //     w danych nie ma. Widzący nie dostaje w tym stanie ANI JEDNEJ
    //     podziałki, dokładnie z tego powodu;
    //   * SKALE OSOBNE. Wspólna domena jest wtedy policzona, ale nie opisuje
    //     żadnego panelu - i podziałek na brzegu siatki też z tego powodu nie
    //     ma. Zakres każdego panelu idzie w `opisPanelu`.
    maDane && !wolna
      ? `${
          indeks ? t("smallMultiples.axis.index") : t("smallMultiples.axis.value")
        }: ${formatChartValue(model.scale.shared.min, lang, jednostkaOsi)} - ${formatChartValue(
          model.scale.shared.max,
          lang,
          jednostkaOsi,
        )}.`
      : "",
    // OŚ KATEGORII JAKO ZAKRES TYLKO WTEDY, GDY MA DWA KRAŃCE. Przy jednej
    // kategorii „2020 - 2020" czyta się jak przedział, a jest punktem - to ten
    // sam gatunek zdania co „panele różnią się poziomem 1-krotnie".
    categoryCount > 1
      ? `${t("smallMultiples.axis.category")}: ${model.categories[0]} - ${
          model.categories[categoryCount - 1]
        }.`
      : categoryCount === 1
        ? `${t("smallMultiples.axis.category")}: ${model.categories[0]}.`
        : "",
    wolna ? t("smallMultiples.scale.free") : t("smallMultiples.scale.shared"),
    t(ORDER_KEYS[model.order]),
    ...model.panels.map(opisPanelu),
  ]
    .filter(Boolean)
    .join(" ");

  // ===== UWAGI POD RYSUNKIEM =====
  //
  // CZTERY REJESTRY, W STAŁEJ KOLEJNOŚCI, i kolejność jest treścią:
  //   1. DEKLARACJE (skala, porządek) - zdania o tym, co rysunek TWIERDZI.
  //      Wypisywane ZAWSZE, bo żadnego z nich nie da się odczytać z obrazka:
  //      panele ze wspólną i z osobną osią wyglądają identycznie, a pierwszy
  //      rząd siatki wygląda na najważniejszy bez względu na to, czym został
  //      wybrany. To jedyne dwie uwagi, które widać pod czystym arkuszem;
  //   2. OBSERWACJE o formie (`reading.*`) - zmieniają sposób czytania CAŁEGO
  //      rysunku, więc stoją przed uwagami o pojedynczych znacznikach;
  //   3. LEGENDA ZNACZNIKÓW (`note.*`) - co znaczy przerwa w linii, pusty
  //      panel, płaska kreska;
  //   4. DEFEKTY (`honesty.*`, czerwień tekstowa) - rysunek pokazuje mniej
  //      albo inaczej niż dane.
  //
  // REJESTR 2 I 4 CZĘŚCIOWO SIĘ POWTARZAJĄ, bo model liczy je oba z tego
  // samego warunku (`smallMultiplesFormAdvice` czyta `model.honesty`).
  // Render NIE wycisza żadnego: wyciszenie znaczyłoby rozstrzygnięcie za
  // czytelnika, które z dwóch zdań jest tym prawdziwym, a różnią się one
  // rejestrem - obserwacja mówi, JAK czytać, defekt mówi, CZEGO nie czytać.
  //
  // WSTAWKI PODAJEMY OSOBNO DLA KAŻDEGO KOMUNIKATU, nie jednym workiem na
  // wszystkie. Dwa różne zdania tego bloku używają `{{count}}` w dwóch różnych
  // znaczeniach (`honesty.sharedScaleReadableOk` - liczba paneli spłaszczonych,
  // `honesty.inGridOk` - liczba wartości poza siatką), więc wspólny worek
  // wypisałby jedną z tych liczb w zdaniu o czymś innym. To jest dokładnie ten
  // gatunek defektu, którego żadna bramka nie widzi.
  const notes: ChartNote[] = [];

  if (maDane) {
    notes.push(
      wolna
        ? {
            key: "scale.free",
            text: [
              t("smallMultiples.scale.free"),
              opisSkaliWolnej.length > 0
                ? t("smallMultiples.scale.freeScaleNote", { note: opisSkaliWolnej })
                : "",
            ]
              .filter(Boolean)
              .join(" "),
            defect: false,
          }
        : {
            key: "scale.shared",
            text: `${t("smallMultiples.scale.shared")} ${t("smallMultiples.scale.sharedDomain", {
              min: formatChartValue(model.scale.shared.min, lang, jednostkaOsi),
              max: formatChartValue(model.scale.shared.max, lang, jednostkaOsi),
            })}`,
            defect: false,
          },
    );
    notes.push({ key: "order", text: t(ORDER_KEYS[model.order]), defect: false });
  }

  for (const a of smallMultiplesFormAdvice(model)) {
    notes.push({
      key: `reading.${a}`,
      text: t(READING_KEYS[a], {
        count: model.panelCount,
        max: SMALL_MULTIPLES_MAX_COMFORT,
      }),
      defect: false,
    });
  }

  // Oś ucięta NIE JEST defektem przy linii (sekcja 8: "Dla liniowego zero nie
  // jest wymagane, ale ucięcie zaznacz"), ale jest faktem, który czytelnik ma
  // prawo znać - stąd rejestr obserwacji, nie defektów.
  if (model.axisTruncated && model.observations > 0) {
    notes.push({
      key: "axisTruncated",
      text: t("smallMultiples.axisTruncated"),
      defect: false,
    });
  }

  // LUKA MA SENS TYLKO PRZY LINII, KTÓRA GDZIEŚ JEST. Gdy w danych nie ma ani
  // jednej wartości, wszystkie panele są puste i o tym mówi `note.empty`;
  // zdanie "linia się w tym miejscu przerywa" opisywałoby wtedy linię, której
  // nie ma na żadnym panelu.
  if (model.gaps > 0 && maDane) {
    notes.push({ key: "note.gap", text: t("smallMultiples.note.gap"), defect: false });
  }
  if (model.emptyPanels > 0) {
    notes.push({ key: "note.empty", text: t("smallMultiples.note.empty"), defect: false });
  }
  if (model.flattenedPanels > 0) {
    notes.push({ key: "note.flattened", text: t("smallMultiples.note.flattened"), defect: false });
  }
  if (indeks && model.panels.some((p) => !p.empty && !p.indexable)) {
    notes.push({
      key: "note.noIndexBase",
      text: t("smallMultiples.note.noIndexBase"),
      defect: false,
    });
  }
  if (model.panels.some((p) => p.points.some((pt) => pt.clamped))) {
    notes.push({ key: "note.clamped", text: t("smallMultiples.note.clamped"), defect: false });
  }

  if (model.honesty.commonScaleOk === false) {
    notes.push({
      key: "honesty.commonScaleOk",
      text: t("smallMultiples.honesty.commonScaleOk", {
        min: formatChartValue(model.scale.shared.min, lang, jednostkaOsi),
        max: formatChartValue(model.scale.shared.max, lang, jednostkaOsi),
      }),
      defect: true,
    });
  }
  if (model.honesty.freeScaleDeclaredOk === false) {
    notes.push({
      key: "honesty.freeScaleDeclaredOk",
      text: t("smallMultiples.honesty.freeScaleDeclaredOk"),
      defect: true,
    });
  }
  if (model.honesty.sharedScaleReadableOk === false) {
    notes.push({
      key: "honesty.sharedScaleReadableOk",
      text: [
        t("smallMultiples.honesty.sharedScaleReadableOk", {
          count: model.flattenedPanels,
          // MIANOWNIK JEST POLICZONY TUTAJ, bo model go nie publikuje -
          // `sharedScaleReadableOk` orzeka o panelach mających PO DWIE
          // wartości (z jednego punktu spłaszczenia nie da się orzec), a tej
          // liczby nie ma w żadnym polu modelu. Podstawienie `panelCount`
          // dałoby zdanie "spłaszcza 9 z 12", w którym dwunastka nie jest tą
          // liczbą, z której wyszła dziewiątka.
          total: model.panels.filter((p) => p.n >= 2).length,
        }),
        // ILORAZ POZIOMÓW TYLKO WTEDY, GDY PO ZAOKRĄGLENIU MÓWI O RÓŻNICY.
        // Przy panelach o tym samym poziomie model zwraca 1, a zdanie "panele
        // różnią się poziomem 1-krotnie" znaczy "nie różnią się" - czyli
        // tłumaczyłoby spłaszczenie czymś, czego nie ma (spłaszcza je wtedy
        // rozsunięcie płaskiej serii przez `niceScale`, nie rozjazd poziomów).
        // Warunek stoi na liczbie, którą czytelnik WIDZI, tak samo jak
        // `formatPercentPoints` w sumie kontrolnej udziałów.
        model.scale.levelRatio !== null && Math.round(model.scale.levelRatio) > 1
          ? t("smallMultiples.scale.levelRatio", {
              ratio: formatChartValue(model.scale.levelRatio, lang, ""),
            })
          : "",
      ]
        .filter(Boolean)
        .join(" "),
      defect: true,
    });
  }
  if (model.honesty.sameUnitOk === false) {
    notes.push({
      key: "honesty.sameUnitOk",
      text: t("smallMultiples.honesty.sameUnitOk"),
      defect: true,
    });
  }
  if (model.honesty.emptyPanelsKeptOk === false) {
    notes.push({
      key: "honesty.emptyPanelsKeptOk",
      text: t("smallMultiples.honesty.emptyPanelsKeptOk"),
      defect: true,
    });
  }
  if (model.honesty.orderFromDataOk === false) {
    notes.push({
      key: "honesty.orderFromDataOk",
      text: t("smallMultiples.honesty.orderFromDataOk"),
      defect: true,
    });
  }
  if (model.honesty.inGridOk === false) {
    notes.push({
      key: "honesty.inGridOk",
      text: t("smallMultiples.honesty.inGridOk", { count: model.valuesOutsideGrid }),
      defect: true,
    });
  }
  if (model.honesty.inDomainOk === false) {
    notes.push({
      key: "honesty.inDomainOk",
      text: t("smallMultiples.honesty.inDomainOk"),
      defect: true,
    });
  }
  if (model.honesty.zeroBaselineOk === false) {
    notes.push({
      key: "honesty.zeroBaselineOk",
      text: t("smallMultiples.honesty.zeroBaselineOk"),
      defect: true,
    });
  }
  if (model.honesty.indexBaseOk === false) {
    notes.push({
      key: "honesty.indexBaseOk",
      text: t("smallMultiples.honesty.indexBaseOk", {
        labels: model.panels
          .filter((p) => !p.empty && !p.indexable)
          .map((p) => p.label)
          .join(", "),
      }),
      defect: true,
    });
  }
  if (model.honesty.spreadOk === false) {
    notes.push({
      key: "honesty.spreadOk",
      text: t("smallMultiples.honesty.spreadOk"),
      defect: true,
    });
  }
  if (model.honesty.declaredSampleOk === false) {
    notes.push({
      key: "honesty.declaredSampleOk",
      text: t("smallMultiples.honesty.declaredSampleOk", {
        // `declaredSampleOk` jest `null`, dopóki autor nie poda `sampleSize`
        // (model o niepodanej liczbie MILCZY), więc tu jest ona liczbą.
        // Podstawienie zera „na wszelki wypadek" wypisałoby w tym zdaniu
        // „n = 0" - liczbę, której nikt nie zadeklarował, a która wygląda
        // dokładnie tak wiarygodnie jak policzona.
        declared: config.sampleSize ?? BRAK_WARTOSCI,
        actual: model.observations,
      }),
      defect: true,
    });
  }
  if (model.honesty.paletteWrapOk === false) {
    notes.push({
      key: "honesty.paletteWrapOk",
      text: t("smallMultiples.honesty.paletteWrapOk"),
      defect: true,
    });
  }

  // PANELE PONIŻEJ PROGU NIE SĄ RYSOWANE. Orzeczenie jest modelu
  // (`smallMultiplesFit`), a render je USZANUJE: siatka, w której panel ma
  // 96 px na 56 px, nie pokazuje ani kształtu, ani podziałek, a wygląda na
  // rysunek. Uwagi zostają - razem z tabelą danych, którą rama wykresu
  // pokazuje przełącznikiem, są wtedy JEDYNĄ drogą do liczb.
  //
  // WCZESNE WYJŚCIE NIE GUBI UWAG (defekt, który histogram miał i ma
  // naprawiony): zwracamy je nawet wtedy, gdy nie ma czego rysować.
  const rysujemy = model.panelCount > 0 && fit.ok && gridW > 0 && gridH > 0;
  if (!rysujemy) {
    return notes.length === 0 ? null : (
      <div ref={revealRef} className={revealClassName(revealState)}>
        <ChartNotes notes={notes} />
      </div>
    );
  }

  // KLAWIATURA CHODZI PO PANELACH, NIE PO PUNKTACH W PANELU, i to jest
  // decyzja, nie uproszczenie.
  //
  // Trzy powody, każdy wystarczający osobno:
  //   * JEDNOSTKĄ PORÓWNANIA JEST PANEL. Pytanie tej formy brzmi "który
  //     podmiot jest gdzie na wspólnej osi", a nie "ile dokładnie miał
  //     w trzecim okresie" - na drugie odpowiada tabela danych, bo z panelu
  //     o wysokości 112 px nie odczyta się wartości dokładniej niż "wyżej niż
  //     tamta";
  //   * DŁUGOŚĆ ŚCIEŻKI. Przy dziewięciu panelach po dwanaście kategorii
  //     przejście strzałką do ostatniego podmiotu to sto siedem naciśnięć,
  //     z czego sto trzy przez punkty, o które nikt nie pytał;
  //   * PANEL SPŁASZCZONY. Jego punkty leżą na rysunku w grubości własnej
  //     linii, więc "następny punkt" nie zmieniałby dla czytelnika NICZEGO -
  //     nawigacja obiecywałaby ruch, którego nie ma.
  // Dlatego strzałki poziome chodzą po kolejności czytania (rzędami), a
  // pionowe po kolumnie siatki - tak jak wzrok. Liczby panelu czytelnik ekranu
  // dostaje kompletem w nazwie dostępnej, nie po jednej strzałką.
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    // WYBÓR Z KLAWIATURY stoi PRZED pozostałymi gałęziami i kończy obsługę.
    if (isSelectKey(e.key)) {
      if (active !== null && onSelect) {
        e.preventDefault();
        wskazPanel(active);
      }
      return;
    }
    if (e.key === "Escape") {
      setActive(null);
      return;
    }
    const kolumny = Math.max(1, model.grid.columns);
    const krok =
      e.key === "ArrowRight"
        ? 1
        : e.key === "ArrowLeft"
          ? -1
          : e.key === "ArrowDown"
            ? kolumny
            : e.key === "ArrowUp"
              ? -kolumny
              : 0;
    if (krok === 0) return;
    e.preventDefault();
    setActive((prev) => {
      if (prev === null) return krok > 0 ? 0 : model.panelCount - 1;
      const next = prev + krok;
      // Przycięcie, nie zawijanie: panel pierwszy i ostatni są w tej formie
      // KRAŃCAMI porządku (największy i najmniejszy średnią), więc przeskok
      // z jednego na drugi czytałby się jak zmiana danych.
      return Math.max(0, Math.min(model.panelCount - 1, next));
    });
  };

  /** Jeden nadawca wskazania - kliknięcie i klawisz składają TEN SAM ładunek. */
  const wskazPanel = (i: number): void => {
    if (!onSelect) return;
    const panel = model.panels[i];
    if (panel === undefined) return;
    onSelect({
      kind: config.kind,
      categoryIndex: null,
      category: panel.label,
      seriesIndex: panel.index,
      seriesName: panel.label,
      value: null,
    });
  };

  const panelFromPointer = (e: PointerEvent<SVGRectElement>): number | null => {
    const point = pointerToPlot(
      e.clientX,
      e.clientY,
      e.currentTarget.getBoundingClientRect(),
      gridW,
      gridH,
    );
    if (point === null) return null;
    const cell = cellAddress(point, gridW, gridH, model.grid.rows, model.grid.columns);
    if (cell === null) return null;
    const position = cell.row * model.grid.columns + cell.col;
    // Komórka wolna w ostatnim rzędzie NIE JEST panelem - dymek nad nią
    // twierdziłby, że jest tam podmiot.
    return position < model.panelCount ? position : null;
  };

  const czynny = active === null ? null : (boxes[active] ?? null);
  const tooltipRows: TooltipRow[] = czynny
    ? (["n", "mean", "last", "change", "occupancy"] as const).map((col) => ({
        name: t(SUMMARY_KEYS[col]),
        value: zapisKolumny(czynny.panel, col),
        colorSlot: col === "n" ? czynny.panel.colorSlot : null,
        emphasised: col === "n",
      }))
    : [];

  const cascade = cascadeStepMs(model.panelCount);
  // Etykiety kategorii: bierzemy co n-tą tak, żeby sąsiednie się nie stykały.
  // Pierwsza i ostatnia ZAWSZE, bo bez nich nie wiadomo, jaki zakres pokazuje
  // panel - ta sama reguła co przy krawędziach histogramu.
  const panelW = boxes[0].w;
  /**
   * Szerokość podpisu kategorii mierzona NA NAPISIE, KTÓRY NAPRAWDĘ STANIE
   * NA OSI, czyli po ucięciu do połowy szerokości panelu. Krok policzony
   * z pełnych nazw wyrzucał podpisy przy nazwach długich (49 znaków dawało
   * 334 px odstępu wymaganego, choć na osi stoi z nich 164 px) - czyli oś
   * czasu gubiła punkty odniesienia z powodu tekstu, którego nikt nie widzi.
   */
  const catLabelW = estimateMaxLabelWidth(
    model.categories.map((label) => skrot(label, panelW / 2)),
    FONT_AXIS,
  );
  const catOdstep = Math.max(1, categoryCount > 1 ? panelW / (categoryCount - 1) : panelW);
  /**
   * Krok podpisów osi kategorii. Wymagany prześwit to PÓŁTOREJ szerokości
   * napisu, a nie jedna, i ta półtora bierze się z KOTWIC: podpis pierwszy
   * jest kotwiczony początkiem, a ostatni końcem (żeby nie wystawały poza
   * panel), więc kładą się na oś CAŁĄ szerokością w jedną stronę, podczas gdy
   * podpisy środkowe kładą się połową w każdą. Para „skrajny + środkowy"
   * potrzebuje więc `w + w/2`.
   *
   * ZMIERZONE, ile kosztowało liczenie tego jedną szerokością: dwadzieścia
   * kategorii „Kwartał 1..20" w panelu 330 px dawało krok 5, a podpis
   * „Kwartał 1" (32..93 px, kotwica z lewej) wchodził w podpis „Kwartał 6"
   * (88..150 px, kotwica środkiem). Dwa napisy jeden na drugim nie są
   * etykietą, tylko plamą.
   */
  const catStep = Math.max(1, Math.ceil((catLabelW * 1.5 + CATEGORY_LABEL_GAP_PX) / catOdstep));
  /**
   * Które kategorie dostają podpis: co `catStep`, plus OSTATNIA zawsze - ale
   * podpis, który wypadłby bliżej niż `catStep` od ostatniego, ustępuje jemu.
   *
   * Bez tego ustąpienia sama reguła „co n-tą, a ostatnia zawsze" nadal kładzie
   * napisy na siebie: przy kroku 7 podpisy stoją na 0, 7 i 14, a ostatni na
   * 19 - czyli pięć odstępów od czternastego zamiast siedmiu. Ostatnia ma
   * pierwszeństwo, bo bez niej nie wiadomo, gdzie szereg się kończy.
   */
  const podpisKategorii = (c: number): boolean =>
    c === categoryCount - 1 || (c % catStep === 0 && categoryCount - 1 - c >= catStep);

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
          {/* NAZWY OBU OSI, RAZ NA CAŁĄ SIATKĘ. Oś wartości nad kolumną liczb
              (bo tam czytelnik jej szuka), oś kategorii przy prawym krańcu
              siatki (bo tam się kończy). Powtórzone przy każdym panelu
              zabrałyby panelom miejsce, którego przy progu 96 px nie ma. */}
          <text
            x={padLeft}
            y={PAD_TOP_WITH_LABELS - LABEL_GAP_PX}
            textAnchor="start"
            fontSize={FONT_AXIS}
            fill="var(--muted-foreground)"
            data-role="axis-value"
          >
            {indeks ? t("smallMultiples.axis.index") : t("smallMultiples.axis.value")}
          </text>
          <text
            x={padLeft + gridW}
            y={PAD_TOP_WITH_LABELS - LABEL_GAP_PX}
            textAnchor="end"
            fontSize={FONT_AXIS}
            fill="var(--muted-foreground)"
            data-role="axis-category"
          >
            {t("smallMultiples.axis.category")}
          </text>

          {boxes.map((box) => {
            const { panel } = box;
            const slot = panel.colorSlot;
            const ostatniWKolumnie = panel.position + model.grid.columns >= model.panelCount;
            const pierwszaKolumna = panel.column === 0;
            return (
              <g
                key={panel.index}
                data-role="panel"
                data-panel-label={panel.label}
                data-position={panel.position}
                data-empty={panel.empty ? "true" : undefined}
                data-flattened={panel.flattened ? "true" : undefined}
                data-active={active === panel.position ? "true" : undefined}
              >
                {/* Pełna treść podpisu i deklaracja osi - dla wskaźnika. Przy
                    osobnych skalach KAŻDY panel niesie zdanie o tym, że jego
                    oś jest własna: rysunek wygląda wtedy jak jeden wykres
                    pocięty na kawałki, więc deklaracja pod siatką to za mało. */}
                <title>
                  {[
                    `${panel.label}. ${t(SUMMARY_KEYS.n)} ${formatChartValue(panel.n, lang, "")}`,
                    wolna ? t("smallMultiples.scale.free") : "",
                    wolna && opisSkaliWolnej.length > 0
                      ? t("smallMultiples.scale.freeScaleNote", { note: opisSkaliWolnej })
                      : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                </title>

                {/* Podświetlenie panelu czynnego PŁYTĄ, nie zmianą geometrii:
                    wszystko, co niesie wartość, musi zostać nieruchome. */}
                {active === panel.position && (
                  <rect
                    data-role="panel-active"
                    x={box.x - PANEL_GAP / 2}
                    y={box.y - PANEL_LABEL_H}
                    width={box.w + PANEL_GAP}
                    height={box.h + PANEL_LABEL_H + PANEL_GAP / 2}
                    rx={4}
                    fill="var(--chart-surface-2)"
                  />
                )}

                {/* Pole rysunku panelu - uchwyt geometrii dla testów i podkład
                    pod znacznik. */}
                <rect
                  data-role="panel-field"
                  x={box.x}
                  y={box.y}
                  width={box.w}
                  height={box.h}
                  fill="transparent"
                />

                {/* Siatka wspólnych podziałek. Rusztowanie zostaje wyczuwalne,
                    nie widoczne (sekcja 3), a podziałek jest trzy, bo panel
                    jest niski - patrz `SMALL_MULTIPLES_TARGET_TICKS`. */}
                {config.showGrid &&
                  maDane &&
                  panel.domain.ticks.map((tick) =>
                    tick < panel.domain.min || tick > panel.domain.max ? null : (
                      <line
                        key={`g${tick}`}
                        x1={box.x}
                        x2={box.x + box.w}
                        y1={pikselWartosci(tick, box)}
                        y2={pikselWartosci(tick, box)}
                        stroke="var(--chart-grid)"
                        strokeWidth={1}
                      />
                    ),
                  )}

                {/* Dolna krawędź pola - panel czyta się jako własny rysunek,
                    a nie jako fragment jednego dużego. */}
                <line
                  x1={box.x}
                  x2={box.x + box.w}
                  y1={box.y + box.h}
                  y2={box.y + box.h}
                  stroke="var(--chart-grid)"
                  strokeWidth={1}
                />

                {/* ZERO, gdy leży wewnątrz domeny - mocniej niż siatka, bo to
                    granica znaku, a nie rusztowanie. */}
                {box.zeroY !== null && maDane && (
                  <line
                    data-role="panel-zero"
                    x1={box.x}
                    x2={box.x + box.w}
                    y1={box.zeroY}
                    y2={box.zeroY}
                    stroke="var(--chart-axis)"
                    strokeWidth={1}
                  />
                )}

                {box.areas.map((d, i) => (
                  <path
                    key={`a${i}`}
                    d={d}
                    fill={`var(--chart-${slot}-inner)`}
                    stroke="none"
                    className="neh-fade"
                    data-role="panel-area"
                  />
                ))}

                {box.bars.map((b) => (
                  <rect
                    key={`b${b.category}`}
                    x={b.x}
                    y={b.y}
                    width={b.w}
                    height={b.h}
                    rx={b.r}
                    // WARIANT SOLIDNY, wprost z sekcji 3: "Wariant solidny
                    // bierz tam, gdzie ani blade wnętrze, ani gradient nic nie
                    // wnoszą: słupki węższe niż 24 px, SMALL MULTIPLES, gęste
                    // panele". Blade wnętrze o kontraście 1,2:1 w słupku
                    // szerokości 8 px jest niewidoczne.
                    fill={`var(--chart-${slot})`}
                    className="neh-bar"
                    data-role="panel-bar"
                    data-category={b.category}
                    style={{ ["--neh-i" as string]: panel.position }}
                  />
                ))}

                {box.line !== "" && (
                  <path
                    d={box.line}
                    fill="none"
                    stroke={`var(--chart-${slot})`}
                    strokeWidth={2}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    pathLength={1}
                    className="neh-line"
                    data-role="panel-line"
                  />
                )}

                {box.dots.map((d) => (
                  <circle
                    key={`d${d.category}`}
                    cx={d.cx}
                    cy={d.cy}
                    r={DOT_R_PX}
                    // Kropka w kolorze PŁYTY z obwódką w kolorze panelu -
                    // wypełnienie płytą znika w tle karty, więc widać sam
                    // pierścień, a on czyta się jako "tu jest pomiar".
                    fill="var(--card)"
                    stroke={`var(--chart-${slot})`}
                    strokeWidth={DOT_RING_PX}
                    className="neh-dot neh-fade"
                    data-role="panel-point"
                    data-category={d.category}
                  />
                ))}

                {/* ETYKIETA BEZPOŚREDNIA - TYLKO PRZY OSTATNIM POMIARZE, i to
                    jest cała odpowiedź tego rodzaju na `showValues`. Liczba
                    przy każdym punkcie zasypałaby panel: przy dwunastu
                    okresach w polu 110 px etykiety zajmują więcej miejsca niż
                    linia, którą opisują. Ostatni pomiar jest tym jednym, po
                    który czytelnik sięga najczęściej ("ile jest teraz"),
                    a pozostałe stoją w tabeli danych. Wariant TEKSTOWY slotu,
                    nie kolor linii: próg kontrastu dla napisu to 4,5:1,
                    dla linii 3,0:1. */}
                {config.showValues && box.last !== null && maDane && (
                  <text
                    // ETYKIETA STOI NAD SWOIM POMIAREM, nie przy prawej
                    // krawędzi panelu. Wcześniej stała zawsze przy krawędzi,
                    // więc szereg urwany lukami (10, 12, brak, brak) pokazywał
                    // „12" nad OSTATNIĄ kategorią - czyli nad okresem, którego
                    // nie zmierzono. Pozycja etykiety bezpośredniej jest
                    // twierdzeniem o tym, KIEDY ta liczba obowiązuje, więc
                    // musi stać tam, gdzie leży punkt.
                    x={box.last.cx}
                    y={Math.max(box.y + FONT_AXIS, box.last.cy - LABEL_GAP_PX / 2)}
                    // Kotwica z lewej TYLKO wtedy, gdy napis kotwiczony
                    // z prawej wyszedłby poza pole panelu - a wyszedłby przy
                    // szeregu, którego jedyny pomiar leży w pierwszej
                    // kategorii, i wjechałby w kolumnę podziałek sąsiada.
                    textAnchor={
                      box.last.cx - estimateLabelWidth(box.last.text, FONT_AXIS) < box.x
                        ? "start"
                        : "end"
                    }
                    fontSize={FONT_AXIS}
                    fill={`var(--chart-${slot}t)`}
                    className="neh-fade neh-value-label tabular-nums"
                    data-role="panel-value"
                  >
                    {box.last.text}
                  </text>
                )}

                {/* PODPIS PANELU. Bez niego panel nie jest panelem podmiotu,
                    tylko kształtem - a tożsamość podmiotu niesie w tej formie
                    wyłącznie pozycja i ten napis (kolor nie koduje niczego). */}
                <text
                  x={box.x}
                  y={box.y - LABEL_GAP_PX / 2}
                  textAnchor="start"
                  fontSize={FONT_AXIS}
                  fill="var(--foreground)"
                  className="neh-value-label"
                  data-role="panel-label"
                >
                  {skrot(panel.label, box.w)}
                </text>

                {/* PUSTY PANEL ZOSTAJE W SIATCE, a jego pustka jest NAZWANA
                    kreską braku - tą samą, którą tabela danych stawia za lukę.
                    Usunięcie panelu przesunęłoby sąsiadów i czytelnik, który
                    zna zestaw podmiotów, straciłby jednego bez śladu. */}
                {panel.empty && (
                  <text
                    x={box.x + box.w / 2}
                    y={box.y + box.h / 2 + TICK_NUDGE}
                    textAnchor="middle"
                    fontSize={FONT_AXIS}
                    fill="var(--muted-foreground)"
                    data-role="panel-missing"
                  >
                    {BRAK_WARTOSCI}
                  </text>
                )}

                {/* PODZIAŁKI WSPÓLNEJ OSI - tylko przy kolumnie zerowej, czyli
                    na LEWYM BRZEGU SIATKI. Przy każdym panelu byłyby tą samą
                    liczbą powtórzoną tyle razy, ile jest kolumn, za cenę
                    trzeciej części szerokości każdego panelu. */}
                {!wolna &&
                  pierwszaKolumna &&
                  maDane &&
                  panel.domain.ticks.map((tick) =>
                    tick < panel.domain.min || tick > panel.domain.max ? null : (
                      <text
                        key={`t${tick}`}
                        x={box.x - LABEL_GAP_PX}
                        y={pikselWartosci(tick, box) + TICK_NUDGE}
                        textAnchor="end"
                        fontSize={FONT_AXIS}
                        fill="var(--muted-foreground)"
                        className="tabular-nums"
                        data-role="value-tick"
                      >
                        {formatAxisTick(tick, lang)}
                      </text>
                    ),
                  )}

                {/* OSOBNA SKALA JEST WIDOCZNA PRZY KAŻDYM PANELU. Gdy panele
                    nie dzielą osi, podziałki na brzegu siatki byłyby
                    kłamstwem: opisywałyby jeden panel, a wyglądałyby na opis
                    wszystkich. Każdy panel dostaje więc własne krańce osi
                    wpisane w pole rysunku - ciasno, i ta ciasnota jest
                    uczciwym kosztem osobnych skal. */}
                {wolna && maDane && (
                  <g data-role="panel-axis">
                    <text
                      x={box.x + 2}
                      y={box.y + FONT_AXIS}
                      textAnchor="start"
                      fontSize={FONT_AXIS}
                      fill="var(--muted-foreground)"
                      className="tabular-nums"
                    >
                      {formatAxisTick(panel.domain.max, lang)}
                    </text>
                    <text
                      x={box.x + 2}
                      y={box.y + box.h - 2}
                      textAnchor="start"
                      fontSize={FONT_AXIS}
                      fill="var(--muted-foreground)"
                      className="tabular-nums"
                    >
                      {formatAxisTick(panel.domain.min, lang)}
                    </text>
                  </g>
                )}

                {/* ETYKIETY KATEGORII - pod NAJNIŻSZYM panelem każdej kolumny,
                    czyli na dolnym brzegu siatki. Ostatni rząd bywa niepełny,
                    więc "ostatni rząd" nie wystarcza: kolumna, w której go nie
                    ma, zostałaby bez osi kategorii. */}
                {ostatniWKolumnie &&
                  model.categories.map((label, c) => {
                    if (!podpisKategorii(c)) return null;
                    const cx = finite(
                      box.x + (categoryCount > 1 ? (c / (categoryCount - 1)) * box.w : box.w / 2),
                      box.x,
                    );
                    return (
                      <text
                        key={`c${c}`}
                        x={cx}
                        y={box.y + box.h + PANEL_LABEL_H}
                        textAnchor={
                          c === 0 && categoryCount > 1
                            ? "start"
                            : c === categoryCount - 1 && categoryCount > 1
                              ? "end"
                              : "middle"
                        }
                        fontSize={FONT_AXIS}
                        fill="var(--muted-foreground)"
                        data-role="category-tick"
                      >
                        {skrot(label, box.w / 2)}
                        {/* Podpowiedź TYLKO przy etykiecie uciętej (sekcja 4
                            zabrania wielokropka bez podpowiedzi). Przy
                            etykiecie pełnej byłaby tym samym napisem
                            powtórzonym drugi raz. */}
                        {skrot(label, box.w / 2) === label ? null : <title>{label}</title>}
                      </text>
                    );
                  })}
              </g>
            );
          })}

          {/* Warstwa trafień na CAŁĄ siatkę - strefa trafienia nigdy nie jest
              kształtem elementu (sekcja 6), a linia grubości 2 px jest
              nietrafialna palcem. */}
          <rect
            className="neh-hit"
            x={padLeft}
            y={PAD_TOP_WITH_LABELS}
            width={gridW}
            height={gridH}
            fill="transparent"
            onPointerDown={(e) => {
              const i = panelFromPointer(e);
              setActive(i);
              if (i !== null) wskazPanel(i);
            }}
            onPointerMove={(e) => setActive(panelFromPointer(e))}
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
          visible={czynny !== null}
          x={czynny ? czynny.x + czynny.w / 2 : 0}
          y={czynny ? czynny.y : 0}
          containerWidth={width}
          title={czynny?.panel.label ?? ""}
          rows={tooltipRows}
        />
      </div>

      <ChartNotes notes={notes} />
    </div>
  );
}
