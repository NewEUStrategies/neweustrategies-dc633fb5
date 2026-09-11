// WYKRES PUNKTOWY (SCATTER) - ZALEŻNOŚĆ DWÓCH ZMIENNYCH.
//
// PYTANIE ANALITYCZNE. Wiersz z tabeli doboru formy sekcji 1: "Zależność
// dwóch zmiennych -> punktowy, opcjonalnie z linią trendu". W kolumnie "Czego
// unikać" stoi przy nim JEDNO hasło i jest ono bezwzględne: "linia łącząca
// punkty". Ten komponent nie rysuje ani jednej ścieżki przez obserwacje -
// żadnego `<path>`, żadnej `<polyline>`, żadnego `<line>` między dwiema
// kropkami. Linia między punktami twierdziłaby, że obserwacje mają kolejność
// i że między nimi istnieją wartości pośrednie; w chmurze punktów nie jest
// prawdą ani jedno, ani drugie.
//
// ZAKAZ MA ŚLAD W KODZIE, NIE TYLKO W TYM KOMENTARZU. Model zwraca
// `mayConnectPoints: false` jako POLE, więc render je ODCZYTUJE i wystawia na
// `<svg>` jako `data-connect-points`. Gdyby ktoś kiedyś zmienił model, ten
// atrybut zmieni się razem z nim i bramka w pliku testowym zapali się, zanim
// czytelnik zobaczy chmurę połączoną łamaną. Komentarza żadna bramka nie
// czyta; atrybut czyta.
//
// DECYZJA ARCHITEKTONICZNA 1: ODCINEK TRENDU RYSUJEMY WYŁĄCZNIE PRZY
// `trend.meaningful === true`.
//
// Model liczy regresję dla każdej chmury osobno i podaje `slope`, `r2` i `n`,
// a decyzję o rysowaniu zostawia renderowi - "mając w ręku liczbę, nie
// wrażenie". Odrzuciłem wariant "rysuj zawsze, gdy trend istnieje, i dopisz
// ostrzeżenie": prosta o R2 = 0,04 jest kreską o dowolnym nachyleniu (jedna
// dodana obserwacja potrafi je odwrócić), a linia na wykresie czyta się
// ZAWSZE jako wniosek, więc ostrzeżenie pod rysunkiem przegrywa z tym, co oko
// już przeczytało. Przy R2 pod progiem zostają same punkty plus zdanie
// z `advice.trendShowsNothing`, które mówi, czego tu nie widać. Przy R2
// nieokreślonym (zerowa wariancja `y`) model milczy i render milczy razem
// z nim - nachylenie bez miary dopasowania jest ozdobą.
//
// DECYZJA ARCHITEKTONICZNA 2: KOŃCE ODCINKA LICZY `scatterTrendAt`, A NIE
// WZÓR PROSTEJ.
//
// Wzór `intercept + slope * x` jest w zasięgu ręki i chętnie podaje wartość
// na krawędzi pola rysunku - i to jest dokładnie ta wygoda, z której powstaje
// ekstrapolacja. `scatterTrendAt` ODMAWIA (zwraca `null`) poza zakresem
// obserwacji, więc jedyna droga do współrzędnej trendu prowadzi przez odmowę.
// Gdy odmówi dla któregokolwiek końca, odcinka NIE MA - render nie podstawia
// wartości z wzoru i nie dociąga niczego do brzegu.
//
// DECYZJA ARCHITEKTONICZNA 3: ODCINEK TRENDU JEST LINIĄ PRZERYWANĄ, i to nie
// jest złamanie zakazu z sekcji 3.
//
// Sekcja 3 zabrania kreskowania RUSZTOWANIA: prowadnic pod kursorem,
// separatorów, łączników mostka, obramowania focusa - elementów, które nie są
// danymi i mają być recesywne. Odcinek trendu jest czymś odwrotnym: jest
// TWIERDZENIEM policzonym z danych, którego w danych nie ma ani jeden pomiar.
// Nieciągłość niesie tu tę jedną informację, której punkty nie niosą - "to
// jest linia wyliczona, nie zmierzona" - i jest drugim nośnikiem obok etykiety
// z R2 i n. Wzór kreskowania idzie z tokena `--chart-series-dash`, żeby wykres
// nie miał własnej wartości tam, gdzie silnik ma wspólną.
//
// DECYZJA ARCHITEKTONICZNA 4: PROMIEŃ MARKERA IDZIE ATRYBUTEM, WIĘC KROPKA
// NIE NOSI KLASY `.neh-dot`.
//
// Reguła `.neh-chart .neh-dot { r: var(--chart-dot) }` NADPISUJE atrybut `r`
// (CSS wygrywa z prezentacyjnym atrybutem SVG), a promień kropki obserwacji
// jest w tym rodzaju stałą modelu (`SCATTER_MARKER_R`, `SCATTER_MARKER_STROKE`
// - sekcja 3: 2,5-3 px w kolorze płyty z obwódką 1,6 px w kolorze serii).
// Klasa zabrałaby renderowi tę liczbę i zastąpiła ją tokenem linii, czyli
// jedyne dwie stałe delikatności, jakie ten rodzaj ma, przestałyby działać.
// Zamiast klasy jest atrybut plus `.neh-fade` na miękkie wejście - dozwolone
// powiększenie markera o piksel pod wskaźnikiem (sekcja 6: promień markera
// nie koduje wartości) robi więc render, a nie arkusz.
//
// STREFA TRAFIENIA: `nearestPointInCloud` Z PROGIEM `HIT_RADIUS_PX`. Punkty
// nie stoją w pasmach i nie mają równych odstępów, więc żadna pojedyncza
// współrzędna nie wskazuje obserwacji - najbliższy punkt zależy od obu naraz.
// Próg jest tu warunkiem uczciwości, nie optymalizacją: bez niego chmura
// z czterema obserwacjami pokazywałaby dymek w każdym miejscu płyty, czyli
// twierdziłaby, że wskaźnik stoi nad obserwacją, której tam nie ma. `null`
// znaczy "pod wskaźnikiem nic nie ma" i jest odpowiedzią, nie awarią.
//
// CO POKAZUJEMY Z RZECZY, KTÓRE MODEL WSKAZUJE OSOBNO. Punkt zdublowany
// (`overplotted`) dostaje wypełnienie w bladym odcieniu serii zamiast koloru
// płyty, dopisek w dymku i zdanie pod rysunkiem - czego NIE dostaje, to
// przesunięcia, bo obie jego współrzędne są danymi i drgnięcie o pół markera
// jest przesunięciem pomiaru. Punktów o dużej dźwigni model NIE wskazuje:
// `ScatterPoint` ma jedną flagę (`overplotted`), a dźwignia wymagałaby h_i
// i progu, czyli statystyki liczonej po raz drugi w komponencie. Render
// niczego takiego nie twierdzi - patrz raport z tego zadania.
//
// CZEGO TEN KOMPONENT NIE LICZY: niczego. Źródło osi X, pary odrzucone,
// regresja, R2, korelacja, zasłanianie, domena i wszystkie samosprawdzenia
// pochodzą z `lib/charts/kinds/scatter.ts`. Tu jest wyłącznie skalowanie na
// piksele - dzięki temu ta sama arytmetyka obsługuje alternatywę tekstową,
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
import {
  formatAxisTick,
  formatChartValue,
  formatPercent,
  type ChartLang,
} from "@/lib/charts/format";
import { linearScale, niceScale } from "@/lib/charts/scale";
import {
  SCATTER_MARKER_R,
  SCATTER_MARKER_STROKE,
  SCATTER_OVERPLOT_SHARE,
  SCATTER_R2_MEANINGLESS,
  SCATTER_TREND_MIN_N,
  scatterExtent,
  scatterFormAdvice,
  scatterModelFromConfig,
  scatterTrendAt,
  type ScatterFormAdvice,
  type ScatterModel,
  type ScatterPoint,
} from "@/lib/charts/kinds/scatter";
import {
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
import {
  HIT_RADIUS_PX,
  nearestPointInCloud,
  pointerToPlot,
  type PlotPoint,
} from "@/lib/charts/plot";
import { estimateLabelWidth } from "@/lib/charts/measureText";
import { useContainerWidth } from "@/hooks/useContainerWidth";
import { useRevealOnScroll, revealClassName } from "@/hooks/useRevealOnScroll";
import { useTapAwayDismiss } from "@/hooks/useTapAwayDismiss";
import { ChartTooltip, type TooltipRow } from "./ChartTooltip";
import "@/lib/i18n-charts";
import { isSelectKey, type ChartSelectHandler } from "@/lib/charts/selection";
import { ChartNotes, type ChartNote } from "./ChartFrame";

/**
 * Zapas na tytuł osi Y w marginesie lewym, w pikselach.
 *
 * Liczba wprost z sekcji 4 ("margines.lewy = szerokość_etykiety + 8 + 6 +
 * (tytuł_osi_Y ? 20 : 0)"). Tytuł osi jest tu obowiązkowy, a nie opcjonalny,
 * i to jest różnica wobec pozostałych rodzajów silnika: tam oś pionowa niesie
 * "wartość" wskazaną w podpisie karty, a tutaj OBIE osie są zmiennymi i bez
 * nazw rysunek nie mówi, czego dotyczy zależność.
 */
const AXIS_TITLE_PX = 20;

/**
 * Wysokość pasa pod polem rysunku: DWA wiersze, nie jeden. `PAD_BOTTOM`
 * starcza na podziałkę, a pod nią stoi jeszcze nazwa zmiennej X - bez tego
 * zapasu drugi wiersz wychodzi za płytę i zostaje ucięty, czego sekcja 1 nie
 * dopuszcza.
 */
const X_AXIS_H = PAD_BOTTOM + FONT_AXIS + 2;

/**
 * Wsunięcie skali punktów od krawędzi pola rysunku, w pikselach.
 *
 * Marker o promieniu `SCATTER_MARKER_R` ma zewnętrzną krawędź obwódki na
 * `R + STROKE/2`; bierzemy `R + STROKE`, czyli o pół grubości więcej, żeby
 * kropka obserwacji skrajnej nie kładła się na linii osi. Punkt na osi jest
 * gorszy niż wygląda: obwódka zlewa się wtedy z osią i czytelnik nie wie, czy
 * widzi obserwację, czy zgrubienie rusztowania. Bez wsunięcia dzieje się to
 * ZAWSZE, gdy `niceScale` trafi dokładnie w skrajną wartość danych.
 */
const MARKER_EDGE_PAD = SCATTER_MARKER_R + SCATTER_MARKER_STROKE;

/**
 * O ile rośnie marker pod wskaźnikiem. Jeden piksel, dokładnie tyle, ile
 * daje `.neh-dot[data-active]` w arkuszu - to jedyna dozwolona zmiana
 * geometrii na hover, bo promień markera nie koduje wartości; koduje ją
 * pozycja, a ta zostaje nieruchoma (sekcja 6).
 */
const MARKER_HOVER_GROWTH = 1;

/**
 * Minimalny odstęp między etykietami podziałki osi X, w pikselach.
 *
 * Ta sama liczba i to samo wyprowadzenie co w histogramie: etykieta liczby
 * przy `FONT_AXIS` zajmuje około 34 px (pięć znaków plus powietrze), więc
 * podziałki gęstsze niż to stykałyby się bokami. Przerzedzamy co n-tą,
 * zostawiając pierwszą i ostatnią - bez nich nie wiadomo, jaki zakres
 * pokazuje rysunek (sekcja 4, pierwszy szczebel drabiny kolizji).
 */
const TICK_LABEL_MIN_PX = 34;

/**
 * Powyżej tylu punktów etykiety bezpośrednie przestają być rysowane.
 *
 * DWANAŚCIE, i liczba jest z geometrii, nie z gustu. Etykieta zajmuje około
 * `TICK_LABEL_MIN_PX`, a pole rysunku około 660 px: przy dwunastu
 * obserwacjach średni odstęp to 55 px (etykiety mają zapas), przy dwudziestu
 * spada do 33 px i zaczynają na siebie wchodzić. Kluczowe jest to, że
 * etykiet NIE MOŻNA tu rozsuwać iteracyjnie tak, jak rozsuwa się je przy
 * końcach linii: przy linii sąsiedztwo jest jednowymiarowe, a w chmurze
 * etykieta odsunięta od swojego punktu przestaje wskazywać, do którego
 * z kilku pobliskich punktów należy. Pełny zbiór nazw niesie dymek i tabela.
 */
const DIRECT_LABEL_MAX_POINTS = 12;

/** Odsunięcie etykiety trendu od końca odcinka - ze skali odstępów sekcji 3. */
const TREND_LABEL_PAD = 8;

/** Rozdzielnik zakresu. Półpauza, nie myślnik: para liczb to zakres. */
const RANGE_SEP = "–";

/** Rozdzielnik pól w etykiecie trendu - R2 i n stoją zawsze razem. */
const TREND_SEP = " · ";

/**
 * R2 do wypisania: obcięte W DÓŁ na drugim miejscu, więc jedynka na ekranie
 * znaczy dokładnie jedynkę w liczbie.
 *
 * `formatChartValue` zaokrągla do dwóch miejsc, czyli dopasowanie 0,997
 * wypisuje jako "1" - a "R2 = 1" czyta się jako doskonałe wyjaśnienie
 * zmienności, którego dane nie dają. To jest ten sam defekt, dla którego suma
 * kontrolna udziałów tarczy dostała własne zaokrąglenie
 * (`formatPercentPoints`): przy komunikacie, którego cała treść jest
 * porównaniem z granicą, zaokrąglenie w stronę granicy zaciera to, co
 * komunikat miał pokazać. Obcinamy tylko poniżej jedynki - R2 równe 1 (dane
 * leżące dokładnie na prostej) zostaje jedynką, bo wtedy jest prawdą.
 */
function r2ToDisplay(r2: number): number {
  if (!Number.isFinite(r2)) return 0;
  return r2 >= 1 ? 1 : Math.floor(r2 * 100) / 100;
}

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
const READING_KEYS: Record<ScatterFormAdvice, string | null> = {
  tooFewPoints: "scatter.reading.tooFewPoints",
  noXVariance: "scatter.reading.noXVariance",
  syntheticX: "scatter.reading.syntheticX",
  trendShowsNothing: "scatter.reading.trendShowsNothing",
  overplotted: "scatter.reading.overplotted",
  // „Wykres liniowy pokaże przebieg" to zalecenie zmiany FORMY - czytelnik
  // opublikowanego wpisu nie ma jak go wykonać, a sama obserwacja („dane mają
  // porządek w czasie") nie mówi mu nic o tym, czego na rysunku nie widać.
  lineBetter: null,
};

/** Ostatnia zapora przed nie-liczbą w atrybucie SVG. */
function px(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

/** Jedna kropka na rysunku. Model podaje jednostki danych, tu są piksele. */
interface Marker {
  /** Indeks w `model.points` - ten sam adres, którym odpowiada warstwa trafień. */
  i: number;
  /** Pozycja chmury na liście `model.clouds` - nie `seriesIndex`, bo w trybie
   *  `series` pierwsza seria jest osią X i chmury nie tworzy. */
  cloud: number;
  point: ScatterPoint;
  cx: number;
  cy: number;
  /** Współrzędne w układzie POLA RYSUNKU - tego samego, który zwraca
   *  `pointerToPlot`, więc odległości liczą się w pikselach ekranu. */
  plot: PlotPoint;
}

/** Odcinek trendu jednej chmury - zawsze z dowodem (R2 i n) przy sobie. */
interface TrendSegment {
  cloud: number;
  name: string;
  colorSlot: number;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  r2: number;
  n: number;
}

interface ScatterChartProps {
  config: ChartConfig;
  lang: ChartLang;
  /**
   * Wskazanie oddane na zewnątrz - kliknięciem w punkt albo Enterem.
   *
   * Rozrzut NIE MA osi kategorii, więc `categoryIndex` jest tu `null`,
   * a `category` niesie etykietę wiersza danych - jedyną tożsamość, jaką
   * punkt ma poza swoimi współrzędnymi. `value` to `y`: to ta zmienna,
   * o którą pyta ten rodzaj („jak zmienia się y wraz z x").
   */
  onSelect?: ChartSelectHandler;
}

export function ScatterChart({ config, lang, onSelect }: ScatterChartProps) {
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

  const model: ScatterModel = useMemo(() => scatterModelFromConfig(config), [config]);
  const height = config.height;

  // `useTapAwayDismiss` MUSI stać przed jakimkolwiek wczesnym wyjściem - hooki
  // nie mogą się warunkowo pomijać, a wyjście "brak par" jest niżej.
  const clearActive = useCallback(() => setActive(null), []);
  useTapAwayDismiss(active !== null, widthRef, clearActive);

  const geometry = useMemo(() => {
    // DWIE OSIE, DWIE WŁASNE DOMENY. `scatterExtent` podaje zakresy obu
    // w jednostkach danych; żadna nie musi obejmować zera, bo punktowy koduje
    // POŁOŻENIEM, a nie długością (sekcja 8 wymaga wtedy nie zera, tylko
    // NAZWANIA ucięcia - robi to nota pod rysunkiem).
    const extent = scatterExtent(model);

    // ODCINKI TRENDU LICZONE PRZED SKALĄ, W JEDNOSTKACH DANYCH, bo SKALA MUSI
    // OBJĄĆ TO, CO RYSUJEMY. Wartość dopasowana na skrajnej obserwacji `x`
    // potrafi wypaść poza zakres obserwacji `y` (dane 2..12 z nachyleniem
    // 2,0 dają na pierwszym punkcie 1,87), a wtedy koniec odcinka schodzi pod
    // oś i wchodzi w pas podziałki. Przycięcie go do krawędzi byłoby gorsze
    // niż wyjście za nią: skrócony odcinek ma INNE nachylenie niż policzona
    // regresja, czyli rysunek pokazywałby prostą, której model nie zwrócił.
    // Dlatego rozszerzamy domenę osi wartości, a nie skracamy twierdzenie.
    const trendData = model.clouds.flatMap((cloud, ci) => {
      const trend = cloud.trend;
      if (trend === null || trend.r2 === null || trend.meaningful !== true) return [];
      // OBIE WSPÓŁRZĘDNE PRZEZ `scatterTrendAt`, także dla końców, które model
      // już policzył: to jedyna droga do wartości trendu, która ODMAWIA poza
      // zakresem obserwacji, więc render nie może ekstrapolować przez pomyłkę.
      const yFrom = scatterTrendAt(trend, trend.from.x);
      const yTo = scatterTrendAt(trend, trend.to.x);
      if (yFrom === null || yTo === null) return [];
      return [
        {
          cloud: ci,
          name: cloud.name,
          colorSlot: cloud.colorSlot,
          fromX: trend.from.x,
          fromY: yFrom,
          toX: trend.to.x,
          toY: yTo,
          r2: trend.r2,
          n: trend.n,
        },
      ];
    });

    let yMin = extent.y.min;
    let yMax = extent.y.max;
    for (const tr of trendData) {
      yMin = Math.min(yMin, tr.fromY, tr.toY);
      yMax = Math.max(yMax, tr.fromY, tr.toY);
    }
    const yScale = niceScale(yMin, yMax, valueTickTarget(height, false));
    // Podziałka osi X ma cel poziomy (`horizontal: true`) - ta sama formuła,
    // której silnik używa dla osi wartości słupków poziomych. Liczona
    // wspólnym `valueTickTarget`, a nie własnym wzorem, bo dwie kopie formuły
    // to dwie różne skale, z których jedna kiedyś zacznie mówić o innym
    // rysunku niż ten narysowany.
    const xScale = niceScale(extent.x.min, extent.x.max, valueTickTarget(height, true));

    // MIERZ, POTEM UKŁADAJ (sekcja 4): margines lewy wynika ze szerokości
    // najszerszej etykiety podziałki plus zapas na tytuł osi. Odwrotna
    // kolejność jest jedyną przyczyną uciętych etykiet.
    const tickW = Math.max(
      ...yScale.ticks.map((tk) => estimateLabelWidth(formatAxisTick(tk, lang), FONT_AXIS)),
      0,
    );
    const padLeft = Math.max(PAD_LEFT_MIN, Math.ceil(tickW) + PAD_SIDE + AXIS_TITLE_PX);
    const innerW = Math.max(MIN_INNER_W, width - padLeft - PAD_SIDE);
    const innerH = Math.max(MIN_INNER_H, height - PAD_TOP - X_AXIS_H);
    const left = padLeft;
    const right = padLeft + innerW;
    const top = PAD_TOP;
    const bottom = PAD_TOP + innerH;

    const toX = linearScale(
      xScale.min,
      xScale.max,
      left + MARKER_EDGE_PAD,
      right - MARKER_EDGE_PAD,
    );
    const toY = linearScale(
      yScale.min,
      yScale.max,
      bottom - MARKER_EDGE_PAD,
      top + MARKER_EDGE_PAD,
    );

    // Pozycja chmury na liście, po `seriesIndex`. Potrzebna, bo w trybie
    // `series` oś X jest pierwszą serią, więc `seriesIndex` chmury zaczyna się
    // od jedynki, a klawiatura chodzi między CHMURAMI, nie między kolumnami
    // arkusza.
    const cloudOf = new Map<number, number>();
    model.clouds.forEach((c, ci) => cloudOf.set(c.seriesIndex, ci));

    const markers: Marker[] = model.points.map((p, i) => {
      const cx = px(toX(p.x), left + innerW / 2);
      const cy = px(toY(p.y), top + innerH / 2);
      return {
        i,
        cloud: cloudOf.get(p.seriesIndex) ?? 0,
        point: p,
        cx,
        cy,
        plot: { x: cx - left, y: cy - top },
      };
    });

    // Te same odcinki co wyżej, tylko przeliczone na piksele - policzone raz
    // w jednostkach danych, więc skala i rysunek nie mogą się rozjechać.
    const trends: TrendSegment[] = trendData.map((tr) => ({
      cloud: tr.cloud,
      name: tr.name,
      colorSlot: tr.colorSlot,
      x1: px(toX(tr.fromX), left),
      y1: px(toY(tr.fromY), bottom),
      x2: px(toX(tr.toX), right),
      y2: px(toY(tr.toY), bottom),
      r2: tr.r2,
      n: tr.n,
    }));

    // KOLEJNOŚĆ DLA KLAWIATURY: rosnąco po `x` W OBRĘBIE CHMURY. Kolejność
    // wierszy arkusza nie jest tu żadnym porządkiem (punktowy istnieje właśnie
    // dlatego, że kolejność wiersza nie jest kolejnością zjawiska), więc
    // strzałka pozioma czyta zależność w tę stronę, w którą się ją opowiada.
    // Remis po `x` rozstrzyga `y`, a potem indeks - bez jawnej reguły dwie
    // obserwacje na jednej pionowej przeskakiwałyby zależnie od sortowania.
    const walk = markers
      .map((m) => m.i)
      .sort((a, b) => {
        const ma = markers[a];
        const mb = markers[b];
        if (ma.cloud !== mb.cloud) return ma.cloud - mb.cloud;
        if (ma.point.x !== mb.point.x) return ma.point.x - mb.point.x;
        if (ma.point.y !== mb.point.y) return ma.point.y - mb.point.y;
        return a - b;
      });
    const posInWalk = new Map<number, number>();
    walk.forEach((flat, pos) => posInWalk.set(flat, pos));

    // Przerzedzenie etykiet podziałki X: co n-tą, licząc n z rzeczywistej
    // szerokości najszerszej etykiety, a nie ze stałej liczby podziałek.
    const xTickW = Math.max(
      ...xScale.ticks.map((tk) => estimateLabelWidth(formatAxisTick(tk, lang), FONT_AXIS)),
      TICK_LABEL_MIN_PX,
    );
    const perTick = xScale.ticks.length > 1 ? innerW / (xScale.ticks.length - 1) : innerW;
    const xTickStep = Math.max(1, Math.ceil(xTickW / Math.max(perTick, 1)));

    return {
      xScale,
      yScale,
      innerW,
      innerH,
      left,
      right,
      top,
      bottom,
      toX,
      toY,
      markers,
      // Gotowa lista współrzędnych w układzie pola rysunku. Liczona RAZ, a nie
      // przy każdym `pointermove`: strefa trafienia przebiega całą chmurę, więc
      // budowanie tej tablicy na każdym ruchu wskaźnika byłoby alokacją na
      // każdą klatkę.
      plotPoints: markers.map((m) => m.plot),
      trends,
      walk,
      posInWalk,
      xTickStep,
    };
  }, [model, height, width, lang]);

  const {
    xScale,
    yScale,
    innerW,
    innerH,
    left,
    right,
    top,
    bottom,
    toX,
    toY,
    markers,
    plotPoints,
    trends,
    walk,
    posInWalk,
    xTickStep,
  } = geometry;

  /** Jeden nadawca wskazania - kliknięcie i klawisz składają TEN SAM ładunek. */
  const wskazPunkt = (i: number): void => {
    if (!onSelect) return;
    const marker = markers[i];
    if (marker === undefined) return;
    const chmura = model.clouds[marker.cloud] ?? null;
    onSelect({
      kind: config.kind,
      categoryIndex: null,
      category: marker.point.label === "" ? null : marker.point.label,
      seriesIndex: marker.point.seriesIndex,
      seriesName: chmura === null ? null : chmura.name,
      value: marker.point.y,
    });
  };

  const cascade = cascadeStepMs(markers.length);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    if (markers.length === 0) return;
    // WYBÓR Z KLAWIATURY stoi PRZED pozostałymi gałęziami i kończy obsługę.
    if (isSelectKey(e.key)) {
      if (active !== null && onSelect) {
        e.preventDefault();
        wskazPunkt(active);
      }
      return;
    }
    if (e.key === "Escape") {
      setActive(null);
      return;
    }
    // WZDŁUŻ OSI X, W OBRĘBIE SWOJEJ CHMURY. Przeskok na koniec chmury do
    // najmniejszego `x` chmury sąsiedniej byłby skokiem przez cały rysunek,
    // a czytelnik nawigujący klawiaturą nie ma czym zauważyć, że zmienił
    // serię - dlatego między chmurami chodzi się strzałkami pionowymi.
    const wzdluz = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    if (wzdluz !== 0) {
      e.preventDefault();
      setActive((prev) => {
        if (prev === null) return walk[wzdluz > 0 ? 0 : walk.length - 1] ?? null;
        const pos = posInWalk.get(prev);
        if (pos === undefined) return prev;
        const kandydat = walk[pos + wzdluz];
        if (kandydat === undefined) return prev;
        return markers[kandydat].cloud === markers[prev].cloud ? kandydat : prev;
      });
      return;
    }
    // MIĘDZY CHMURAMI, PRZY NAJBLIŻSZYM `x`. Nie "ta sama obserwacja po
    // numerze": numer wiersza w chmurze o innej liczności wskazuje inne
    // miejsce zależności, a pytanie zadawane pionem brzmi "co ma druga seria
    // przy tej samej wartości X".
    const wpoprzek = e.key === "ArrowDown" ? 1 : e.key === "ArrowUp" ? -1 : 0;
    if (wpoprzek === 0) return;
    e.preventDefault();
    setActive((prev) => {
      if (prev === null) return walk[0] ?? null;
      const teraz = markers[prev];
      const cel = teraz.cloud + wpoprzek;
      let best: number | null = null;
      let bestOdleglosc = Number.POSITIVE_INFINITY;
      for (const m of markers) {
        if (m.cloud !== cel) continue;
        const odleglosc = Math.abs(m.point.x - teraz.point.x);
        // Ostro mniejsze, więc przy remisie wygrywa niższy indeks - ta sama
        // reguła co w `nearestPointInCloud`, żeby klawiatura i wskaźnik nie
        // wskazywały różnych obserwacji w tym samym miejscu.
        if (odleglosc < bestOdleglosc) {
          bestOdleglosc = odleglosc;
          best = m.i;
        }
      }
      return best ?? prev;
    });
  };

  if (markers.length === 0) return null;

  const indexFromPointer = (e: PointerEvent<SVGRectElement>): number | null => {
    const point = pointerToPlot(
      e.clientX,
      e.clientY,
      e.currentTarget.getBoundingClientRect(),
      innerW,
      innerH,
    );
    if (point === null) return null;
    // PRÓG PODANY JAWNIE, choć jest wartością domyślną funkcji: to on
    // odpowiada za to, że dymek nie pojawia się nad pustym miejscem płyty,
    // więc ma być widoczny w miejscu, w którym się o niego decyduje.
    return nearestPointInCloud(point, plotPoints, HIT_RADIUS_PX);
  };

  const czynny: Marker | null = active === null ? null : (markers[active] ?? null);
  const czynnaChmura = czynny === null ? null : (model.clouds[czynny.cloud] ?? null);

  // NAZWY OBU ZMIENNYCH. `xName` model zna tylko wtedy, gdy oś X jest serią
  // albo gdy podał ją autor; inaczej zostaje neutralna nazwa ze słownika.
  // Oś Y bierze nazwę chmury, gdy jest jedna - wtedy jest to nazwa serii
  // z arkusza, czyli treść autora, a nie nasze streszczenie.
  const xLabel = model.xName === "" ? t("scatter.axis.x") : model.xName;
  const yLabel =
    model.clouds.length === 1 && model.clouds[0].name !== ""
      ? model.clouds[0].name
      : t("scatter.axis.y");

  const liczba = (v: number, unit: string): string => formatChartValue(v, lang, unit);

  // DYMEK JAKO PARA WSPÓŁRZĘDNYCH, w kolejności odczytu wykresu: najpierw Y
  // (o nią pyta czytelnik), potem X, potem tożsamość obserwacji i serii.
  // JEDNOSTKA IDZIE TYLKO DO Y: konfiguracja ma jedno pole `unit` i opisuje
  // nim wartości serii, a X pochodzi z etykiet albo z innej kolumny, więc
  // dokleiłaby się tam jednostka cudzej zmiennej. Zła jednostka jest gorsza
  // niż jej brak.
  const tooltipRows: TooltipRow[] = czynny
    ? [
        {
          name: yLabel,
          value: liczba(czynny.point.y, config.unit),
          colorSlot: czynny.point.colorSlot,
          emphasised: true,
        },
        {
          name: xLabel,
          value: liczba(czynny.point.x, ""),
          colorSlot: null,
        },
        ...(czynny.point.label === ""
          ? []
          : [
              {
                name: t("scatter.table.label"),
                value: czynny.point.label,
                colorSlot: null,
              },
            ]),
        ...(model.clouds.length > 1 && czynnaChmura !== null
          ? [
              {
                name: t("scatter.table.series"),
                value: czynnaChmura.name,
                colorSlot: null,
              },
            ]
          : []),
      ]
    : [];

  // NAZWA DOSTĘPNA NIESIE LICZBY, nie nazwę rodzaju: czytnik ekranu nie widzi
  // ani osi, ani podpisu, więc zakresy obu zmiennych, liczbę par i dowód
  // każdego trendu dostaje tutaj. Zdanie o współzmienności jedzie razem
  // z trendem, bo bez niego nachylenie czyta się jako przyczyna.
  const ariaLabel = [
    config.title,
    `${xLabel}: ${formatAxisTick(model.domain.x.min, lang)} ${RANGE_SEP} ${formatAxisTick(
      model.domain.x.max,
      lang,
    )}`,
    `${yLabel}: ${formatAxisTick(model.domain.y.min, lang)} ${RANGE_SEP} ${formatAxisTick(
      model.domain.y.max,
      lang,
    )}`,
    t("scatter.trend.n", { count: model.n }),
    ...trends.map(
      (tr) =>
        `${tr.name}: ${t("scatter.trend.label")}, ${t("scatter.trend.r2", {
          value: liczba(r2ToDisplay(tr.r2), ""),
        })}, ${t("scatter.trend.n", { count: tr.n })}`,
    ),
    ...(trends.length > 0 ? [t("scatter.trend.notCausal")] : []),
  ]
    .filter(Boolean)
    .join(". ");

  // NOTY POD RYSUNKIEM. Trzy gatunki, w tej kolejności: dowód rysowanego
  // trendu (współzmienność i metoda), porada formy z modelu i defekt danych.
  //
  // DE-DUPLIKACJA WOBEC PORAD, bo pięć pól `honesty` ma bliźniaka w
  // `scatterFormAdvice` i dwa zdania o tym samym pod jednym rysunkiem uczą
  // czytelnika przewijania not: `xVarianceOk`, `overplotOk`,
  // `trendMeaningfulOk` i `xIsSecondVariableOk` mówią to samo co
  // `noXVariance`, `overplotted`, `trendShowsNothing` i `syntheticX`, więc
  // zostają po stronie porad. Wypisujemy te, których porady nie powtarzają -
  // w tym `enoughForTrendOk`, bo porada `tooFewPoints` odpala tylko wtedy, gdy
  // KAŻDA chmura jest za mała, a to pole gdy CHOĆ JEDNA.
  const notes: ChartNote[] = [];
  if (trends.length > 0) {
    notes.push({ key: "trend.notCausal", text: t("scatter.trend.notCausal"), defect: false });
    notes.push({ key: "trend.method", text: t("scatter.trend.method"), defect: false });
  }
  const adviceValues: Record<ScatterFormAdvice, Record<string, string | number>> = {
    tooFewPoints: { min: SCATTER_TREND_MIN_N },
    noXVariance: {},
    syntheticX: {},
    trendShowsNothing: { min: liczba(SCATTER_R2_MEANINGLESS, "") },
    overplotted: { share: formatPercent(SCATTER_OVERPLOT_SHARE, lang) },
    lineBetter: {},
  };
  for (const a of scatterFormAdvice(model)) {
    const klucz = READING_KEYS[a];
    if (klucz === null) continue;
    notes.push({ key: `reading.${a}`, text: t(klucz, adviceValues[a]), defect: false });
  }
  if (model.honesty.pairsCompleteOk === false) {
    notes.push({
      key: "honesty.pairsCompleteOk",
      text: t("scatter.honesty.pairsCompleteOk", { count: model.honesty.droppedPairs }),
      defect: true,
    });
  }
  if (model.honesty.enoughForTrendOk === false) {
    // NIE DEFEKT, a wyjaśnienie braku: mówi, dlaczego na rysunku nie ma
    // odcinka, którego czytelnik mógłby szukać.
    notes.push({
      key: "honesty.enoughForTrendOk",
      text: t("scatter.honesty.enoughForTrendOk", { min: SCATTER_TREND_MIN_N }),
      defect: false,
    });
  }
  if (model.honesty.trendWithinDataOk === false) {
    notes.push({
      key: "honesty.trendWithinDataOk",
      text: t("scatter.honesty.trendWithinDataOk"),
      defect: true,
    });
  }
  if (model.honesty.pointsInDomainOk === false) {
    notes.push({
      key: "honesty.pointsInDomainOk",
      text: t("scatter.honesty.pointsInDomainOk"),
      defect: true,
    });
  }
  if (model.honesty.declaredSampleSizeOk === false) {
    notes.push({
      key: "honesty.declaredSampleSizeOk",
      text: t("scatter.honesty.declaredSampleSizeOk", {
        declared: config.sampleSize ?? 0,
        actual: model.clouds
          .filter((c) => c.n > 0)
          .map((c) => c.n)
          .join(", "),
      }),
      defect: true,
    });
  }
  // UCIĘCIE OSI NAZWANE, nie naprawione (sekcja 8): punktowy koduje
  // położeniem, więc zera nie wymaga - wymaga oznaczenia. JEDNA nota na obie
  // osie, nie dwie: ostrzeżenie widoczne w dwóch linijkach pod prawie każdą
  // chmurą uczy ignorowania wszystkich ostrzeżeń, a nazwy osi mieszczą się
  // w jednym zdaniu. `isZeroBaselineBroken` w ramie karty odpowiada tylko za
  // linię i pole, więc dla tego rodzaju nikt inny tego nie powie.
  //
  // WARUNEK JEST PODWÓJNY, I TO JEST ROZSTRZYGNIĘCIE, NIE OSTROŻNOŚĆ.
  // `honesty.zeroInDomain` mówi o zakresie OBSERWACJI, a czytelnik widzi
  // podziałkę dociągniętą przez `niceScale` do ładnych krawędzi - dane 2..24
  // dają oś od 0 do 25, czyli oś, która zero MA. Nota o uciętej osi pod
  // rysunkiem, na którym oś widocznie zaczyna się od zera, jest fałszywa i uczy
  // przewijania not. Dlatego liczymy ją TĄ SAMĄ SKALĄ, KTÓRĄ RYSUJEMY - dokładnie
  // tak, jak `isZeroBaselineBroken` w `honesty.ts` - a pole modelu zostaje
  // warunkiem koniecznym (skala nigdy nie jest węższa od danych, więc oba muszą
  // się zgodzić).
  const ucieteX = model.honesty.zeroInDomain.x === false && (xScale.min > 0 || xScale.max < 0);
  const ucieteY = model.honesty.zeroInDomain.y === false && (yScale.min > 0 || yScale.max < 0);
  const uciete = [...(ucieteX ? [xLabel] : []), ...(ucieteY ? [yLabel] : [])];
  if (uciete.length > 0) {
    notes.push({
      key: "axis.truncated",
      text: `${t("caption.zeroBaselineWarning")}: ${uciete.join(", ")}. ${t(
        "caption.zeroBaselineWarningHint",
      )}`,
      defect: false,
    });
  }

  // Kolejność rysowania: punkt czynny NA KOŃCU, czyli na wierzchu. Marker
  // powiększony o piksel inaczej chowałby się pod sąsiadem narysowanym
  // później, a wtedy podświetlenie wskazywałoby nie ten punkt, o którym mówi
  // dymek.
  const doRysunku =
    czynny === null ? markers : [...markers.filter((m) => m.i !== czynny.i), czynny];
  const etykietyBezposrednie = config.showValues && markers.length <= DIRECT_LABEL_MAX_POINTS;

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
            próg `HIT_RADIUS_PX` znaczy dokładnie to, co mówi jego nazwa - a na
            wykresie, którego strefa trafienia liczy odległość w DWÓCH osiach,
            różne współczynniki skalowania osi zmieniłyby "najbliższy punkt"
            w funkcję proporcji elementu, nie danych.
            `data-connect-points` publikuje oświadczenie modelu: patrz nagłówek. */}
        <svg
          width={width}
          height={height}
          className="block overflow-visible"
          data-connect-points={String(model.mayConnectPoints)}
        >
          {/* SIATKA NA OBU OSIACH, bo obie są ciągłe i z obu odczytuje się
              liczbę. Kontrast poniżej 1,3:1 do płyty niesie token, nie krycie -
              siatka ma być wyczuwalna, nie widoczna. */}
          {config.showGrid &&
            yScale.ticks.map((tick) => (
              <line
                key={`gy${tick}`}
                x1={left}
                x2={right}
                y1={px(toY(tick), bottom)}
                y2={px(toY(tick), bottom)}
                stroke="var(--chart-grid)"
                strokeWidth={1}
                data-role="grid-y"
              />
            ))}
          {config.showGrid &&
            xScale.ticks.map((tick) => (
              <line
                key={`gx${tick}`}
                x1={px(toX(tick), left)}
                x2={px(toX(tick), left)}
                y1={top}
                y2={bottom}
                stroke="var(--chart-grid)"
                strokeWidth={1}
                data-role="grid-x"
              />
            ))}

          {/* Podziałka osi Y - wszystkie etykiety, bo w pionie mają po
              `FONT_AXIS` wysokości i `niceScale` nie da ich więcej, niż się
              mieści. */}
          {yScale.ticks.map((tick) => (
            <text
              key={`ty${tick}`}
              x={left - 8}
              y={px(toY(tick), bottom) + 3.5}
              textAnchor="end"
              fontSize={FONT_AXIS}
              fill="var(--muted-foreground)"
              className="tabular-nums"
              data-role="tick-y"
            >
              {formatAxisTick(tick, lang)}
            </text>
          ))}

          {/* Podziałka osi X - przerzedzona, z ZAWSZE podpisaną pierwszą
              i ostatnią: bez skrajnych nie wiadomo, jaki zakres pokazuje
              rysunek. */}
          {xScale.ticks.map((tick, i) => {
            const skrajna = i === 0 || i === xScale.ticks.length - 1;
            if (!skrajna && i % xTickStep !== 0) return null;
            return (
              <text
                key={`tx${tick}`}
                x={px(toX(tick), left)}
                y={bottom + 16}
                textAnchor="middle"
                fontSize={FONT_AXIS}
                fill="var(--muted-foreground)"
                className="tabular-nums"
                data-role="tick-x"
              >
                {formatAxisTick(tick, lang)}
              </text>
            );
          })}

          {/* OBIE OSIE JAKO LINIE. Żadna nie jest linią zera: punktowy koduje
              położeniem, więc oś jest tu granicą pola odczytu, a nie krawędzią
              odniesienia dla długości. */}
          <line
            x1={left}
            x2={right}
            y1={bottom}
            y2={bottom}
            stroke="var(--chart-axis)"
            strokeWidth={1}
            data-role="axis-x"
          />
          <line
            x1={left}
            x2={left}
            y1={top}
            y2={bottom}
            stroke="var(--chart-axis)"
            strokeWidth={1}
            data-role="axis-y"
          />

          {/* NAZWY ZMIENNYCH PRZY OSIACH. Na tym rysunku obie osie są danymi,
              więc bez nazw czytelnik widzi kształt zależności, nie wiedząc,
              między czym a czym. Tytuł osi Y obrócony o 90 stopni w lewo -
              w marginesie, nigdy w obszarze kreślenia. */}
          <text
            x={left + innerW / 2}
            y={bottom + 16 + FONT_AXIS + 2}
            textAnchor="middle"
            fontSize={FONT_AXIS}
            fill="var(--muted-foreground)"
            data-role="axis-x-title"
          >
            {xLabel}
          </text>
          <text
            x={0}
            y={0}
            transform={`translate(${AXIS_TITLE_PX - 8}, ${top + innerH / 2}) rotate(-90)`}
            textAnchor="middle"
            fontSize={FONT_AXIS}
            fill="var(--muted-foreground)"
            data-role="axis-y-title"
          >
            {yLabel}
          </text>

          {/* ODCINEK TRENDU - POD punktami, bo obserwacje są danymi, a prosta
              jest o nich twierdzeniem; twierdzenie nie może zasłaniać dowodu.
              Końce leżą na najmniejszej i największej obserwacji `x` tej
              chmury, nigdy na krawędzi rysunku. */}
          {trends.map((tr) => (
            <line
              key={`tr${tr.cloud}`}
              x1={tr.x1}
              x2={tr.x2}
              y1={tr.y1}
              y2={tr.y2}
              stroke={`var(--chart-${tr.colorSlot}-edge)`}
              className="neh-fade"
              data-role="trend"
              data-cloud={tr.cloud}
              style={{
                strokeWidth: "var(--chart-stroke, 2px)",
                strokeDasharray: "var(--chart-series-dash, 7 4)",
                strokeLinecap: "round",
              }}
            />
          ))}

          {/* R2 I n PRZY ODCINKU, nie tylko w podpisie. Linia regresji jest
              TWIERDZENIEM, a twierdzenie bez dowodu jest ozdobą - dlatego oba
              pola stoją razem przy tym samym końcu odcinka i nie da się
              przeczytać nachylenia bez miary dopasowania. Etykieta ucieka na
              lewą stronę końca, gdy po prawej nie ma już pola rysunku (sekcja
              1: nic nie jest ucięte). */}
          {trends.map((tr) => {
            const tekst = `${t("scatter.trend.r2", { value: liczba(r2ToDisplay(tr.r2), "") })}${TREND_SEP}${t(
              "scatter.trend.n",
              { count: tr.n },
            )}`;
            const szerokosc = estimateLabelWidth(tekst, FONT_AXIS);
            const zaWaskie = tr.x2 + TREND_LABEL_PAD + szerokosc > right;
            return (
              <text
                key={`trl${tr.cloud}`}
                x={zaWaskie ? tr.x2 - TREND_LABEL_PAD : tr.x2 + TREND_LABEL_PAD}
                y={Math.min(bottom, Math.max(top + FONT_AXIS, tr.y2 - 4))}
                textAnchor={zaWaskie ? "end" : "start"}
                fontSize={FONT_AXIS}
                fill="var(--muted-foreground)"
                className="neh-fade tabular-nums"
                data-role="trend-label"
                data-cloud={tr.cloud}
              >
                {tekst}
              </text>
            );
          })}

          {/* KROPKI OBSERWACJI. Kolor płyty w środku, obwódka w kolorze serii -
              obwódka niesie tożsamość chmury, bo punkty nie mają osi, do której
              dałoby się je przypiąć etykietą.

              PUNKT ZDUBLOWANY DOSTAJE WYPEŁNIENIE, nie przesunięcie: obie jego
              współrzędne są danymi, więc drgnięcie o pół markera jest
              przesunięciem pomiaru (to jest różnica wobec roju, gdzie druga
              współrzędna jest dopełnieniem rysunku). Blade wnętrze czyta się
              jako plamka gęstsza od pustej, a `data-overplotted` niesie to
              samo dla testu i dla stylu, który kiedyś dołoży arkusz. */}
          {doRysunku.map((m) => {
            const czynnyTen = czynny !== null && czynny.i === m.i;
            return (
              <circle
                key={m.i}
                cx={m.cx}
                cy={m.cy}
                r={SCATTER_MARKER_R + (czynnyTen ? MARKER_HOVER_GROWTH : 0)}
                fill={
                  m.point.overplotted ? `var(--chart-${m.point.colorSlot}-inner)` : "var(--card)"
                }
                stroke={`var(--chart-${m.point.colorSlot})`}
                strokeWidth={SCATTER_MARKER_STROKE}
                className="neh-fade"
                data-role="cloud-point"
                data-cloud={m.cloud}
                data-overplotted={m.point.overplotted ? "true" : undefined}
                data-active={czynnyTen ? "true" : undefined}
              >
                {m.point.label !== "" && <title>{m.point.label}</title>}
              </circle>
            );
          })}

          {/* ETYKIETY BEZPOŚREDNIE nazw obserwacji, gdy autor włączył wartości
              i gdy jest ich na tyle mało, że się nie nakładają. Nazwa, a nie
              para liczb: liczby są w dymku i w tabeli, a na rysunku pozycja
              punktu JEST już parą liczb - powtórzenie jej tekstem zasłania
              chmurę, o której mówi. */}
          {etykietyBezposrednie &&
            markers.map((m) => {
              if (m.point.label === "") return null;
              // ETYKIETA UCIEKA NA LEWĄ STRONĘ KROPKI, gdy po prawej nie ma
              // już pola rysunku. Punkt skrajny prawy jest tu regułą, nie
              // wyjątkiem (najwyższe `x` zawsze leży u prawej krawędzi), więc
              // bez tej gałęzi nazwa najważniejszej obserwacji wychodziłaby za
              // płytę - a sekcja 1 nie dopuszcza treści uciętej.
              const odsuniecie = SCATTER_MARKER_R + 4;
              const szerokosc = estimateLabelWidth(m.point.label, FONT_AXIS);
              const zaWaskie = m.cx + odsuniecie + szerokosc > right;
              return (
                <text
                  key={`l${m.i}`}
                  x={zaWaskie ? m.cx - odsuniecie : m.cx + odsuniecie}
                  y={m.cy + 3.5}
                  textAnchor={zaWaskie ? "end" : "start"}
                  fontSize={FONT_AXIS}
                  fill="var(--foreground)"
                  className="neh-fade neh-value-label"
                  data-role="point-label"
                >
                  {m.point.label}
                </text>
              );
            })}

          {/* WARSTWA TRAFIEŃ - jedna na całe pole, NAD grafiką,
              `fill: transparent`. Adres liczy `nearestPointInCloud`, bo punkty
              nie stoją w pasmach: sama współrzędna pozioma nie wskazuje żadnej
              obserwacji. */}
          <rect
            className="neh-hit"
            data-role="hits"
            x={left}
            y={top}
            width={innerW}
            height={innerH}
            fill="transparent"
            onPointerDown={(e) => {
              const i = indexFromPointer(e);
              setActive(i);
              if (i !== null) wskazPunkt(i);
            }}
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
          visible={czynny !== null}
          x={czynny?.cx ?? 0}
          y={czynny?.cy ?? 0}
          containerWidth={width}
          title={czynny === null ? "" : czynny.point.label}
          // Dopisek pod tytułem, a nie wiersz z wartością: "plamka dzielona"
          // nie jest liczbą tej obserwacji, tylko ostrzeżeniem o tym, że pod
          // markerem jest ich więcej niż jedna.
          note={czynny !== null && czynny.point.overplotted ? t("scatter.table.overplotted") : ""}
          rows={tooltipRows}
        />
      </div>

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
