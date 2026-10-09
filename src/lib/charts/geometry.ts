// Geometria silnika wykresów: JEDNO miejsce na każdą liczbę pikselową.
//
// DLACZEGO TE LICZBY SĄ TUTAJ, A NIE W KOMPONENCIE. Kanciastość nie jest
// cnotą analityczną, jest efektem ubocznym rysowania domyślnymi prymitywami -
// a rozjazd promieni i grubości między słupkiem, kartą i tooltipem jest
// efektem ubocznym trzymania tych liczb tam, gdzie się ich używa. Tu stoją
// raz; komponent ich nie wymyśla.
//
// DLACZEGO NIE WSZYSTKO IDZIE PRZEZ CSS. Grubość kreski, promień kropki
// i waga fontu SĄ tokenami (`--chart-stroke`, `--chart-dot`, `--chart-dot-ring`,
// `--chart-label-weight`) i komponent podaje je jako `var()`, bo to
// właściwości prezentacyjne - dzięki temu korekta irradiacji w trybie ciemnym
// (jasny obiekt na ciemnym tle wydaje się grubszy) dzieje się bez jednej
// gałęzi w JS. Ale PROMIEŃ ZAOKRĄGLENIA SŁUPKA wchodzi do atrybutu `d`, czyli
// do ciągu ścieżki, którego CSS nie dotknie; ta jedna liczba musi być w JS.
// Zgodność obu zapisów pilnuje bramka `__tests__/geometry.test.ts`, tak samo
// jak bramka palety pilnuje kolorów.
import { CHART_PLATE } from "./palette";

/**
 * JEDEN promień na wszystkim: karty, panele, tooltipy, słupki, prostokąt
 * strefy prognozy. 6 px to punkt, w którym kształt przestaje być twardy,
 * a jeszcze nie mięknie w pigułkę; przy 10-12 px słupki finansowe wyglądają
 * infografikowo i tracą precyzję odczytu długości.
 */
export const CHART_RADIUS = 6;

/**
 * Przycięcie promienia do połowy krótszego boku - dla kształtu zaokrąglonego
 * z CZTERECH stron (karta, panel, prostokąt strefy prognozy). Wtedy wzdłuż
 * każdej osi muszą się zmieścić DWA promienie, więc dzielimy na dwa.
 */
export function clampRadius(width: number, height: number, radius = CHART_RADIUS): number {
  return Math.max(0, Math.min(radius, width / 2, height / 2));
}

/**
 * Wsunięcie kształtu słupka o połowę grubości obwódki.
 *
 * Domyślnie `stroke` leży NA ścieżce, więc obwódka 1,5 px zjada 0,75 px
 * wysokości po każdej stronie - a wysokość słupka koduje wartość, czyli
 * nieskorygowana obwódka po prostu zmniejsza liczbę. Wsuwamy więc kształt
 * o połowę grubości.
 *
 * JEDNA LICZBA W JS, NIE DWIE. Grubość obwódki jest różna w obu motywach
 * (1,5 px na jasnym, 1,25 px na ciemnym - jasna linia na ciemnym tle optycznie
 * grubieje) i mieszka w tokenie `--chart-bar-edge`, bo jest wartością
 * prezentacyjną. Wsunięcie jest natomiast GEOMETRIĄ: wchodzi do atrybutu `d`,
 * którego kaskada nie dotknie. Bierzemy połowę grubości JAŚNIEJSZEGO motywu,
 * czyli wariant zachowawczy: w ciemnym kształt jest wsunięty o 0,125 px więcej,
 * niż trzeba, i to jest nierozróżnialne, a gałąź motywu w JS przestałaby
 * działać w druku - dokładnie ten problem, dla którego reszta tych liczb
 * siedzi w tokenach.
 */
export const BAR_EDGE_INSET = 0.75;

/**
 * Przycięcie promienia dla SŁUPKA, czyli kształtu zaokrąglonego z JEDNEJ
 * strony - i dlatego to osobna funkcja, a nie nowy parametr w `clampRadius`.
 *
 * Słupek ma kwadratową podstawę (krawędź odniesienia: linia zera albo poziom
 * skumulowany w mostku) i zaokrąglony wyłącznie koniec danych. Zaokrąglona
 * podstawa odsuwałaby masę słupka od zera i sugerowała, że wartość zaczyna się
 * gdzieś wyżej - to ten sam błąd co ucięta oś, tylko wygląda nieszkodliwie.
 *
 * DWIE PODŁOGI, BO OBWÓDKA ZMIENIA TO, CO CZYTA OKO. Specyfikacja podaje
 * `min(6, szer/2, dług - 2*inset)` i to jest granica WYKONALNOŚCI: wzdłuż osi
 * wartości mieści się jeden promień (nie dwa, jak w prostokącie zaokrąglonym
 * z czterech stron), pomniejszony o to, co zjada obwódka. Ale sama
 * wykonalność nie broni CZYTELNOŚCI: przy długości 8 px ta formuła przepuszcza
 * promień 6, po którym z odcinka prostego zostaje pół piksela.
 *
 * Rozstrzyga to, czy kształt ma obwódkę. W wariancie z obwódką (blady,
 * gradientowy) całą granicę niesie linia, a najwyższy punkt obrysu leży na tej
 * samej wysokości bez względu na promień - odczyt wartości się nie zmienia,
 * więc granica wykonalności wystarcza. W wariancie SOLIDNYM obrysu nie ma
 * i oko czyta masę wypełnienia; tam wracamy do połowy długości, bo bez tego
 * niski słupek zamienia się w kopułkę i jego wysokość przestaje być czytelna,
 * czyli zaokrąglenie zaczyna zniekształcać dane, a nie tylko wygląd.
 */
export function clampBarRadius(
  across: number,
  along: number,
  opts: { inset?: number; bordered?: boolean } = {},
): number {
  const inset = opts.inset ?? BAR_EDGE_INSET;
  const alongLimit = opts.bordered === false ? along / 2 : along - 2 * inset;
  return Math.max(0, Math.min(BAR_RADIUS, across / 2, alongLimit));
}

/**
 * Promień zaokrąglenia KOŃCA DANYCH słupka - 4 px, mniej niż karta (6 px).
 * Słupek ma maksymalnie 22 px szerokości; przy promieniu karty jego szczyt
 * byłby w połowie łukiem i koniec wartości przestawałby być ostry.
 */
export const BAR_RADIUS = 4;

/**
 * Szerokość kontenera, poniżej której wykres przechodzi w układ zwarty:
 * mniejsze fonty, legenda zamiast etykiet na końcu linii, węższa kolumna
 * etykiet w słupkach poziomych, mniejszy prawy margines.
 */
export const COMPACT_WIDTH = 600;

export function isCompact(width: number): boolean {
  return width < COMPACT_WIDTH;
}

/** Rozmiar etykiet osi: 11,5 px, w układzie zwartym 10,5 px. */
export const FONT_AXIS = 11.5;
export const FONT_AXIS_COMPACT = 10.5;

export function axisFontSize(width: number): number {
  return isCompact(width) ? FONT_AXIS_COMPACT : FONT_AXIS;
}

/** Tekst wykresu (etykiety pasma, celu, prognozy): 12 px, zwarty 11 px. */
export const FONT_CHART = 12;
export const FONT_CHART_COMPACT = 11;

export function chartFontSize(width: number): number {
  return isCompact(width) ? FONT_CHART_COMPACT : FONT_CHART;
}

/** Etykiety wartości nad słupkiem i etykieta pasma: 11 px. */
export const FONT_VALUE = 11;

/** Nazwa serii przy końcu linii: 11,5 px, pogrubiona. */
export const FONT_END_LABEL = 11.5;

/**
 * Docelowa liczba podziałek osi wartości.
 *
 * Stoi tutaj, a nie w komponencie, bo pytają o nią DWA miejsca: silnik
 * (żeby narysować podziałki) i sprawdzenie uczciwości osi (żeby wiedzieć, czy
 * domena obejmuje zero). Gdyby ta formuła istniała w dwóch kopiach, jedna
 * z nich zaczęłaby kiedyś mówić o innej skali niż ta narysowana - i podpis
 * "oś nie zaczyna się od zera" pojawiałby się pod wykresem, na którym zaczyna,
 * albo odwrotnie.
 */
export function valueTickTarget(height: number, horizontal: boolean): number {
  return horizontal ? 5 : Math.max(3, Math.round(height / 70));
}

/** Maksymalna szerokość słupka - szerszy przestaje być słupkiem, staje się polem. */
export const BAR_MAX = 22;

/** Maksymalna szerokość słupka SKUMULOWANEGO - stos niesie kilka wartości. */
export const BAR_MAX_STACKED = 34;

/** Część pasma kategorii zajęta przez grupę słupków (odstęp kategorii 20%). */
export const BAR_GROUP_FILL = 0.8;

/** Odstęp między słupkami serii w grupie - jako ułamek szerokości słupka. */
export const BAR_SERIES_GAP = 0.25;

/**
 * Szerokość słupka i odstęp między słupkami grupy dla pasma kategorii.
 * `count` to liczba słupków obok siebie (1 przy stosie i mostku).
 */
export function barLayout(
  band: number,
  count: number,
  stacked: boolean,
): { width: number; gap: number } {
  const k = Math.max(1, count);
  const group = band * BAR_GROUP_FILL;
  const fit = group / (k + (k - 1) * BAR_SERIES_GAP);
  const width = Math.max(1, Math.min(stacked ? BAR_MAX_STACKED : BAR_MAX, fit));
  return { width, gap: k > 1 ? width * BAR_SERIES_GAP : 0 };
}

/** Prześwit w kolorze powierzchni między stykającymi się znacznikami. */
export const BAR_GAP = 2;

/**
 * Przerwa między łukami tarczy, w PIKSELACH liczonych na osi pierścienia.
 *
 * Nie stały kąt i nie obrys w kolorze płyty. Obrys w kolorze płyty zajmuje
 * miejsce, które należy się obwódce serii - a bez żadnej przerwy obwódki dwóch
 * sąsiednich łuków stykają się i dają na granicy fałszywy trzeci kolor.
 * Przerwa niesie granicę także w skali szarości i w druku jednobarwnym, gdzie
 * same odcienie wypełnienia nie wystarczają.
 *
 * PIKSELE, NIE STOPNIE, bo ten sam kąt daje różną przerwę w różnej geometrii:
 * przy pierścieniu o promieniu 40 px szczelina byłaby niewidoczna, a przy
 * 160 px rozjeżdżałaby się w klin. Komponent przelicza tę wartość na kąt
 * promieniem ŚRODKOWYM pierścienia - `(ARC_GAP_PX / 2) / r_środkowy` radianów
 * odjęte z każdej strony - więc przerwa jest optycznie ta sama niezależnie od
 * średnicy i grubości.
 */
export const ARC_GAP_PX = 2.5;

/**
 * Powietrze wokół liczby wpisanej W ŁUK - po 4 px z każdej strony.
 *
 * Liczba w łuku jest na tarczy podstawowym nośnikiem wartości, bo osi tu nie
 * ma i nie do czego przypiąć etykiety. Ale napis wpisany w łuk, w którym mieści
 * się dokładnie co do piksela, dotyka obu granic i czyta się jako część
 * sąsiada. Dlatego próg "czy się mieści" to szerokość napisu PLUS ten zapas;
 * gdy go zabraknie, wartość zostaje w tabeli klucza obok pierścienia, a nie
 * wchodzi w łuk przycięta.
 */
export const ARC_LABEL_PAD = 8;

/**
 * Skala odstępów. WYŁĄCZNIE te wartości - to jedna zmiana najbardziej
 * podnosząca wrażenie precyzji, bo oko wyłapuje 13 px obok 12 px szybciej niż
 * jakąkolwiek różnicę koloru.
 */
export const SPACING = [4, 8, 12, 16, 24, 32, 48, 64] as const;

/** Najbliższa wartość ze skali odstępów, w górę. */
export function snapSpacing(value: number): number {
  for (const step of SPACING) if (value <= step) return step;
  return SPACING[SPACING.length - 1];
}

/**
 * Zaokrąglenie w górę do wielokrotności 4 px. Dla marginesów WIĘKSZYCH niż
 * ostatni szczebel skali (obrócone etykiety kategorii potrafią potrzebować
 * ponad 64 px), gdzie `snapSpacing` przestaje mieć co zwrócić. Skala odstępów
 * dotyczy odstępów LAYOUTU; margines wyznaczony pomiarem tekstu musi być
 * dokładnie taki, jakiego tekst potrzebuje, więc snapujemy go tylko do siatki
 * 4 px, a nie do listy szczebli.
 */
export function snapToGrid(value: number): number {
  return Math.ceil(Math.max(0, value) / 4) * 4;
}

/** Stały margines pod obszarem kreślenia na poziome etykiety kategorii. */
export const PAD_BOTTOM = 24;

/**
 * Margines nad obszarem kreślenia: 30 px. Mieści nazwę osi (jednostkę) nad
 * osią wartości oraz etykiety wartości nad najwyższym słupkiem.
 */
export const PAD_TOP = 30;
export const PAD_TOP_WITH_LABELS = 30;

/** Margines boczny między etykietami a obszarem kreślenia. */
export const PAD_SIDE = 12;

/** Lewy margines od krawędzi karty do etykiet osi wartości. */
export const PAD_LEFT_EDGE = 6;

/** Prawy margines obszaru kreślenia: 24 px, w układzie zwartym 14 px. */
export const PAD_RIGHT = 24;
export const PAD_RIGHT_COMPACT = 14;

export function padRightFor(width: number): number {
  return isCompact(width) ? PAD_RIGHT_COMPACT : PAD_RIGHT;
}

/**
 * Zapas nad najwyższym punktem, pasmem albo celem - 4% rozpiętości, zanim
 * maksimum osi zostanie zaokrąglone do „ładnej" wartości. Bez zapasu punkt
 * na maksimum dotyka krawędzi rysunku i jego obwódka jest przycinana.
 */
export const VALUE_HEADROOM = 0.04;

/** Powyżej tylu punktów na osi wykres dostaje przewijanie, przybliżanie i suwak. */
export const ZOOM_MIN_POINTS = 30;

/** Wysokość suwaka zakresu i odstęp od obszaru kreślenia. */
export const SLIDER_HEIGHT = 18;
export const SLIDER_GAP = 10;

/**
 * Podłogi obszaru kreślenia. Poniżej nich rysunek przestaje być rysunkiem,
 * więc marginesy MUSZĄ ustąpić - i dlatego są tu stałą, a nie liczbą wpisaną
 * w `Math.max` w komponencie. Margines dolny wyznaczony pomiarem obróconych
 * etykiet potrafi przekroczyć to, na co wykres o wysokości 160 px może sobie
 * pozwolić; wtedy to drabina etykiet schodzi o szczebel, a nie obszar
 * kreślenia zapada się pod podłogę.
 */
export const MIN_INNER_H = 40;
export const MIN_INNER_W = 40;

/** Podłoga marginesu lewego przy osi wartości - ze skali odstępów. */
export const PAD_LEFT_MIN = 32;

/** Podłoga marginesu lewego przy etykietach kategorii (słupki poziome). */
export const PAD_LEFT_CATEGORY_MIN = 48;

/** Górna granica marginesu na etykiety kategorii przy słupkach poziomych. */
export const CATEGORY_LABEL_MAX_WIDTH = 180;

/** Ta sama granica w układzie zwartym - kolumna etykiet nie zjada wykresu. */
export const CATEGORY_LABEL_MAX_WIDTH_COMPACT = 112;

/** Po tylu znakach etykieta kategorii słupka poziomego jest ucinana - Z TOOLTIPEM. */
export const CATEGORY_LABEL_MAX_CHARS = 24;

/**
 * Powyżej tylu punktów punkty obserwacji są CHOWANE i pojawiają się tylko pod
 * kursorem (na aktywnej kategorii). Gęsty szereg z punktem na każdym pomiarze
 * zlewa się w koralik, a kształt linii przestaje być czytelny.
 */
export const DOTS_MAX_POINTS = 20;

/**
 * Minimalny odstęp między punktami, przy którym kropki jeszcze się nie
 * zlewają. Poniżej tego wygładzanie jest WYŁĄCZANE, a nie rysowane bez
 * kropek: skoro nie da się pokazać, gdzie zmierzono, nie wolno rysować
 * krzywej między pomiarami.
 */
export const MIN_DOT_SPACING = 6;

/**
 * Siła wygładzenia po zastosowaniu warunków uczciwości.
 *
 * Wygładzona linia BEZ punktów nie mówi czytelnikowi, gdzie kończą się dane,
 * a gdzie zaczyna interpolacja - odczyta wartość z miejsca, w którym jej nie
 * zmierzono. Zamiast więc "wygładzać i mieć nadzieję", silnik pyta, czy
 * kropki się ZMIESZCZĄ, i jeśli nie, rysuje łamaną, na której każdy
 * wierzchołek jest pomiarem.
 */
export function effectiveSmoothing(
  pointCount: number,
  requested: number,
  spacingPx: number,
  minPoints: number,
): number {
  if (!(requested > 0)) return 0;
  if (pointCount < minPoints) return 0;
  if (spacingPx < MIN_DOT_SPACING) return 0;
  return Math.min(1, requested);
}

/**
 * Czy pokazać punkty obserwacji na stałe. Powyżej progu pokazuje je wyłącznie
 * wskazanie kursorem - samotny pomiar między lukami rysuje się zawsze, bo
 * jest jedynym nośnikiem swojej wartości (patrz `CartesianChart`).
 */
export function shouldShowDots(pointCount: number): boolean {
  return pointCount <= DOTS_MAX_POINTS;
}

/**
 * Animacja wejścia: 400 ms z krzywą cubicOut, aktualizacja danych 300 ms.
 * Kopia arkusza (`charts.css`) dla bramki - komponent podaje zmienne CSS.
 */
export const ENTRY_MS = 400;
export const UPDATE_MS = 300;
export const ENTRY_EASE = "cubic-bezier(0.33, 1, 0.68, 1)";

/**
 * Krok kaskady wejścia - ZAWSZE zero. Specyfikacja zakazuje efektów wejścia
 * elementów jeden po drugim: wykres wchodzi jako całość, bo kaskada każe
 * czytelnikowi czekać na ostatni słupek, zanim porówna pierwszy z nim.
 * Funkcja zostaje, żeby rendery nie musiały znać tej reguły.
 */
export function cascadeStepMs(count: number): number {
  void count;
  return 0;
}

/**
 * Wartości tokenów delikatności, per motyw - KOPIA arkusza, trzymana wyłącznie
 * dla bramki zgodności. Komponent ich NIE czyta: podaje `var(--chart-*)`
 * i pozwala kaskadzie wybrać wartość.
 */
export const DELICACY_TOKENS = {
  light: {
    stroke: "2px",
    dot: "3.5px",
    dotRing: "1.5px",
    labelWeight: "500",
    labelWeightStrong: "600",
    labelWeightTotal: "700",
  },
  // TE SAME WARTOŚCI: geometria i typografia wykresu nie zależą od motywu.
  // Arkusz ciemny ich nie redefiniuje, więc dziedziczą z jasnego.
  dark: {
    stroke: "2px",
    dot: "3.5px",
    dotRing: "1.5px",
    labelWeight: "500",
    labelWeightStrong: "600",
    labelWeightTotal: "700",
  },
} as const;

/** Promień punktu obserwacji w px (średnica 7 px) i grubość jego obwódki. */
export const DOT_RADIUS = 3.5;
export const DOT_RING = 1.5;

/** Płyty, wobec których geometria i paleta są mierzone - reeksport dla bramki. */
export { CHART_PLATE };
