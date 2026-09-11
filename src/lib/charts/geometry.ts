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
  return Math.max(0, Math.min(CHART_RADIUS, across / 2, alongLimit));
}
/** Rozmiar etykiet osi. Na nim stoi heurystyka szerokości i marginesy SSR. */
export const FONT_AXIS = 11;

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
export const BAR_MAX = 24;

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

/** Stały margines nad obszarem kreślenia; 24 gdy trzeba miejsca na etykiety. */
export const PAD_TOP = 12;
export const PAD_TOP_WITH_LABELS = 24;

/** Stały margines boczny; lewy rośnie z etykietami osi. */
export const PAD_SIDE = 12;

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

/** Po tylu znakach etykieta kategorii słupka poziomego jest ucinana - Z TOOLTIPEM. */
export const CATEGORY_LABEL_MAX_CHARS = 24;

/**
 * Powyżej tylu punktów kropki obserwacji przestają być rysowane dla samej
 * wygody czytania: przy łamanej wierzchołki i tak SĄ danymi (widać je jako
 * zmiany kierunku), więc kropka jest tam ozdobą, a gęsty szereg zlewa się
 * w pasek. Ten próg NIE dotyczy linii wygładzonej - tam kropki są warunkiem
 * uczciwości i decyduje `shouldShowDots`.
 */
export const DOTS_MAX_POINTS = 24;

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
 * Czy pokazać punkty obserwacji. Wygładzenie je WYMUSZA (warunek uczciwości);
 * przy łamanej pokazujemy je do progu gęstości.
 */
export function shouldShowDots(pointCount: number, smoothing: number): boolean {
  return smoothing > 0 || pointCount <= DOTS_MAX_POINTS;
}

/**
 * Budżet kaskady animacji: łącznie nie więcej niż tyle, choćby słupków było
 * czterdzieści. Przy czterdziestu słupkach 40 ms na element dałoby 1,6 s -
 * czytelnik czekałby na wykres dłużej niż na stronę.
 */
export const CASCADE_TOTAL_MAX_MS = 500;
export const CASCADE_STEP_DEFAULT_MS = 40;
export const CASCADE_STEP_MIN_MS = 8;

/**
 * Krok kaskady dla tej liczby znaczników, w milisekundach.
 *
 * DWA WARUNKI, KTÓRE POWYŻEJ ~63 ZNACZNIKÓW SIĘ WYKLUCZAJĄ: krok nie może
 * zejść poniżej podłogi (poniżej 8 ms kaskady nie widać, więc opóźnienie jest
 * tylko opóźnieniem), a całość nie może przekroczyć budżetu. Wygrywa BUDŻET:
 * przy takiej liczbie znaczników kaskada zostaje WYŁĄCZONA (krok 0, wszystko
 * wchodzi razem), bo kaskada, której nie da się zobaczyć, jest samym
 * czekaniem. Zwracamy 0, a nie podłogę, bo 0 jest jedyną odpowiedzią, która
 * nie kłamie o tym, co użytkownik zobaczy.
 */
export function cascadeStepMs(count: number): number {
  if (count <= 1) return CASCADE_STEP_DEFAULT_MS;
  const fair = Math.floor(CASCADE_TOTAL_MAX_MS / (count - 1));
  if (fair < CASCADE_STEP_MIN_MS) return 0;
  return Math.min(CASCADE_STEP_DEFAULT_MS, fair);
}

/**
 * Wartości tokenów delikatności, per motyw - KOPIA arkusza, trzymana wyłącznie
 * dla bramki zgodności. Komponent ich NIE czyta: podaje `var(--chart-*)`
 * i pozwala kaskadzie wybrać motyw. Gdyby czytał, korekta irradiacji
 * wymagałaby gałęzi w JS i przestałaby działać w druku.
 */
export const DELICACY_TOKENS = {
  light: {
    stroke: "2px",
    dot: "2.8px",
    dotRing: "1.6px",
    labelWeight: "500",
    labelWeightStrong: "600",
    labelWeightTotal: "700",
  },
  dark: {
    stroke: "1.75px",
    dot: "2.6px",
    dotRing: "1.4px",
    labelWeight: "450",
    labelWeightStrong: "550",
    labelWeightTotal: "650",
  },
} as const;

/** Płyty, wobec których geometria i paleta są mierzone - reeksport dla bramki. */
export { CHART_PLATE };
