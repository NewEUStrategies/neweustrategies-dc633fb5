// WACHLARZ SCENARIUSZY - PROGNOZA, KTÓRA POKAZUJE KSZTAŁT WŁASNEJ NIEPEWNOŚCI.
//
// PYTANIE ANALITYCZNE. Tabela doboru formy (sekcja 1 specyfikacji), wiersz
// "Scenariusze w czasie -> wachlarz z pasmami niepewności", a w kolumnie
// "Czego unikać" jedna pozycja: "pojedyncza linia prognozy". Cała treść tego
// rodzaju mieści się w tej jednej pozycji. Prognoza narysowana linią mówi
// czytelnikowi, że autor ZNA przyszłą wartość; autor zna najwyżej rozkład,
// więc rysunek ma pokazać przedział, i to przedział ROZSZERZAJĄCY SIĘ w głąb
// horyzontu. Kształt jest tu treścią, nie ozdobą: wachlarz o stałej
// szerokości nie mówi nic o tym, jak daleko od ostatniego pomiaru leży dany
// krok, i model nazywa to wprost (`honesty.constantWidth`).
//
// CZEMU TO NIE JEST WARIANT `CartesianChart`, i to jest jedyna decyzja
// architektoniczna w tym pliku warta uzasadnienia.
//
// Kartezjański UMIE narysować pasmo prognozy - ale umie narysować DOKŁADNIE
// JEDNO i umie je tylko WYPROWADZIĆ: `forecastBandPct` to jedna liczba, z
// której obwiednia powstaje jako ±% wartości linii. Pasmo wyprowadzone z linii
// nie ma jak linii przeczyć. Wachlarz stoi na odwrotnym założeniu: krawędzie
// są OSOBNYMI DANYMI autora, jest ich wiele poziomów i mogą się z linią
// rozjechać - pasmo 95% węższe od 80%, pasmo mijające ścieżkę centralną, para
// krawędzi odwrócona. To są orzeczenia o danych, nie o pikselach, i dlatego
// liczy je model (`fanModelFromConfig`), a rysunek tylko je pokazuje.
//
// Co z tego wynika dla tego pliku:
//   * SERIE NIE SĄ SERIAMI. Dla kartezjańskiego siedem kolumn arkusza to
//     siedem serii: siedem kolorów, siedem pozycji legendy, siedem wierszy
//     w dymku. Tutaj te same siedem kolumn to JEDNA wielkość - ścieżka
//     centralna i sześć krawędzi trzech pasm. Cały wykres idzie więc jednym
//     slotem palety, legenda mówi o POZIOMACH PEWNOŚCI, a nie o kolumnach,
//     a dymek ma po jednym wierszu na poziom. Nauczenie tego pętli serii
//     w kartezjańskim znaczyłoby nauczenie jej, że "seria" bywa krawędzią
//     cudzej serii - czyli przepisanie legendy, dymka, przydziału slotów
//     i kolejności klawiatury;
//   * PASMA SĄ ZAGNIEŻDŻONE, więc nie wolno ich po prostu nałożyć. Paleta ma
//     JEDNĄ alfę pasma na slot (`--chart-band-N`), policzoną pod kontrast
//     1,10-1,17:1 do płyty. Trzy takie pasma jedno na drugim dają 0,271 zamiast
//     0,10 - najwęższy poziom wychodzi dwa i pół raza ciemniejszy od projektu.
//     Dlatego malujemy PIERŚCIENIE z modelu (`FanModel.rings`), które się nie
//     nakładają, a gdy model mówi, że pierścienie nie pokrywają wszystkich
//     kroków (`ringsComplete: false`), wracamy do pełnych pasm z alfą liczoną
//     RÓŻNICOWO - patrz `mnoznikWarstwy`;
//   * PASMO NIGDY NIE JEST GRADIENTEM (sekcja 3: gradient oznacza obszar
//     danych, płaskie wypełnienie oznacza niepewność). W tym pliku nie ma
//     ani jednego `linearGradient` i to jest wymaganie, nie przypadek.
//
// CZEGO TEN KOMPONENT NIE LICZY: niczego. Kroki, ścieżka centralna, poziomy,
// pierścienie, granica historia/prognoza i wszystkie orzeczenia uczciwości
// pochodzą z `lib/charts/kinds/fanChart.ts`. Tu jest wyłącznie skalowanie na
// piksele i rysowanie.
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
import { finite } from "@/lib/charts/num";
import { linearScale, niceScale } from "@/lib/charts/scale";
import {
  FAN_LEVELS_ADVICE_MAX,
  fanExtent,
  fanFormAdvice,
  fanModelFromConfig,
  type FanCarrier,
  type FanFormAdvice,
  type FanLevel,
  type FanModel,
} from "@/lib/charts/kinds/fanChart";
import {
  FONT_AXIS,
  MIN_INNER_H,
  MIN_INNER_W,
  PAD_BOTTOM,
  PAD_LEFT_MIN,
  PAD_SIDE,
  PAD_TOP,
  clampRadius,
  shouldShowDots,
  valueTickTarget,
} from "@/lib/charts/geometry";
import { BAND_CONTRAST_RANGE } from "@/lib/charts/palette";
import { bandIndex, pointerToPlot } from "@/lib/charts/plot";
import { estimateLabelWidth } from "@/lib/charts/measureText";
import { useContainerWidth } from "@/hooks/useContainerWidth";
import { useTapAwayDismiss } from "@/hooks/useTapAwayDismiss";
import { useRevealOnScroll, revealClassName } from "@/hooks/useRevealOnScroll";
import { ChartTooltip, type TooltipRow } from "./ChartTooltip";
import { ChartNotes, type ChartNote } from "./ChartFrame";
import "@/lib/i18n-charts";
import { categorySelection, isSelectKey, type ChartSelectHandler } from "@/lib/charts/selection";

/**
 * Znak braku wartości - ta sama kreska, którą `format.ts` stawia za nieliczbę,
 * a tabela danych za pole, którego model nie orzekł. Czytelnik dymka i
 * czytelnik tabeli muszą widzieć ten sam brak, bo inaczej "-" i puste miejsce
 * czytają się jako dwie różne rzeczy.
 */
const BRAK_WARTOSCI = "-";

/** Odstęp podpisu separatora od jego linii, w pikselach. */
const SEPARATOR_LABEL_GAP = 6;

/** Minimalne powietrze między dwiema etykietami kroku, w pikselach. */
const STEP_LABEL_GAP = 6;

/**
 * Klucze OBSERWACJI dla czytelnika, wypisane JAWNIE - `t(\`fan.reading.${a}\`)`
 * jest niewidoczne dla trzech bramek i18n naraz (rozjazd kod-słownik, parytet
 * PL/EN, podział porad po odbiorcy), więc literówka w nazwie porady
 * przechodziłaby wszystkie trzy i objawiała się surowym kluczem na stronie.
 *
 * Wszystkie siedem porad tego rodzaju MA tu wpis i żaden nie jest `null`, bo
 * każda z nich jest obserwacją o RYSUNKU ("prognoza narysowana jedną linią",
 * "pasmo ma w całej prognozie tę samą szerokość"), a nie zaleceniem dla
 * autora. Zalecenia mieszkają w nakładce edytora (`fan.advice.*`) i pod
 * opublikowanym wpisem nie mają czego robić - pilnuje tego
 * `chartAdviceAudience.test.ts`.
 */
const READING_KEYS: Record<FanFormAdvice, string> = {
  noForecast: "fan.reading.noForecast",
  noBand: "fan.reading.noBand",
  noCentral: "fan.reading.noCentral",
  singleForecastStep: "fan.reading.singleForecastStep",
  singleLevel: "fan.reading.singleLevel",
  tooManyLevels: "fan.reading.tooManyLevels",
  constantBand: "fan.reading.constantBand",
};

/**
 * NAZWY TRZECH NOŚNIKÓW ODRÓŻNIENIA PROGNOZY, też jawną mapą i z tego samego
 * powodu. `FanHonesty.carriers` trzyma nośniki OBECNE, więc zdanie o brakującym
 * odróżnieniu wymienia to, co na rysunku jest - inaczej czytelnik wie, że
 * czegoś brakuje, ale nie wie, czego na rysunku szukać.
 */
const CARRIER_KEYS: Record<FanCarrier, string> = {
  band: "fan.carrier.band",
  zone: "fan.carrier.zone",
  separator: "fan.carrier.separator",
};

/** ŹRÓDŁO PASM - każdy wybór na wykresie ma być nazwany. */
const BAND_SOURCE_KEYS: Record<FanModel["bandSource"], string> = {
  series: "fan.bandSource.series",
  levels: "fan.bandSource.levels",
  bandPct: "fan.bandSource.bandPct",
  none: "fan.bandSource.none",
};

/** ŹRÓDŁO ŚCIEŻKI CENTRALNEJ - wokół czego mierzone są pasma. */
const CENTRAL_SOURCE_KEYS: Record<FanModel["centralSource"], string> = {
  option: "fan.centralSource.option",
  name: "fan.centralSource.name",
  fallback: "fan.centralSource.fallback",
  none: "fan.centralSource.none",
};

/**
 * Środek korytarza kontrastu pasma. Token `--chart-band-N` jest policzony tak,
 * żeby POJEDYNCZE pasmo trafiło w korytarz 1,10-1,17:1 do płyty, ale JavaScript
 * nie ma prawa czytać tokena (patrz `DELICACY_TOKENS`: "Komponent ich NIE
 * czyta") - więc jedyne, co o nim wiadomo, to że leży w korytarzu. Bierzemy
 * środek korytarza jako jego położenie i z tego założenia wyprowadzamy
 * mnożniki; błąd tego założenia jest ograniczony szerokością korytarza, czyli
 * 0,07 kontrastu na całą skalę.
 */
const KORYTARZ_SRODEK = (BAND_CONTRAST_RANGE.min + BAND_CONTRAST_RANGE.max) / 2;

/**
 * Ile razy alfa warstwy jest mniejsza/większa od tokena, żeby poziomy ROZŁOŻYŁY
 * SIĘ NA KORYTARZU zamiast zlać w jedną powierzchnię.
 *
 * Kontrast powierzchni półprzezroczystej rośnie przy tych wartościach prawie
 * liniowo z alfą, więc stosunek kontrastów jest stosunkiem alf: pasmo
 * najszersze ma trafić w podłogę korytarza (1,10), najwęższe w sufit (1,17),
 * a token leży pośrodku. Stąd mnożniki 0,74 i 1,26 - liczone z palety, nie
 * z gustu.
 *
 * Bez tego rozłożenia wachlarz o trzech poziomach byłby jedną płaską plamą:
 * czytelnik widziałby zewnętrzną krawędź i NIC więcej, czyli dostałby jeden
 * przedział zamiast kształtu niepewności.
 */
const MNOZNIK_MIN = (BAND_CONTRAST_RANGE.min - 1) / (KORYTARZ_SRODEK - 1);
const MNOZNIK_MAX = (BAND_CONTRAST_RANGE.max - 1) / (KORYTARZ_SRODEK - 1);

/** Docelowe krycie warstwy `layer` (0 = najszersza) jako wielokrotność tokena. */
function docelowyMnoznik(layer: number, count: number): number {
  if (count <= 1) return 1;
  return MNOZNIK_MIN + ((MNOZNIK_MAX - MNOZNIK_MIN) * layer) / (count - 1);
}

/**
 * Mnożnik tokena dla jednej malowanej warstwy.
 *
 * DWIE DROGI, bo dwa różne sposoby malowania:
 *   * PIERŚCIENIE się nie nakładają, więc krycie pierścienia JEST kryciem
 *     wypadkowym i mnożnik jest wprost docelowy;
 *   * PEŁNE PASMA nakładają się, a krycie składa się jako `1-(1-a)(1-b)`.
 *     Żeby po nałożeniu wyjść na docelowe krycie warstwy, malujemy RÓŻNICĘ
 *     wobec warstwy poprzedniej. To jest przybliżenie liniowe: dokładna
 *     odwrotność ma w mianowniku `1 - krycie dotychczasowe`, a tej liczby nie
 *     da się policzyć bez odczytania tokena. Przy alfie rzędu 0,1 przybliżenie
 *     myli się o 7%, czyli o 0,003 kontrastu - mniej niż jeden stopień
 *     korytarza, więc czytelnik tej różnicy nie ma jak zobaczyć.
 */
function mnoznikWarstwy(layer: number, count: number, nakladajace: boolean): number {
  const cel = docelowyMnoznik(layer, count);
  if (!nakladajace) return cel;
  const poprzedni = layer === 0 ? 0 : docelowyMnoznik(layer - 1, count);
  return cel - poprzedni;
}

/** Jeden krok pasma sprowadzony do pary krawędzi - pierścień i pasmo równo. */
interface KrawedzieKroku {
  index: number;
  lower: number;
  upper: number;
}

/** Jedna malowana powierzchnia: warstwa plus jej ciągłe odcinki. */
interface PowierzchniaPasma {
  key: string;
  layer: number;
  segmenty: KrawedzieKroku[][];
}

/** Współrzędna do atrybutu ścieżki - zawsze skończona i zawsze tak samo zaokrąglona. */
function wsp(value: number): string {
  return finite(value).toFixed(2);
}

/**
 * Wielokąt jednego ciągłego odcinka pasma: górną krawędzią w prawo, dolną
 * z powrotem w lewo.
 *
 * Odcinki są osobne, bo wypełnienie przeciągnięte przez lukę w danych
 * twierdziłoby, że w kroku bez pomiaru niepewność jest znana. Model tnie je
 * za nas (`FanLevel.segments`, `FanRing.segments`) i tu nie ma czego sklejać.
 *
 * ODCINEK JEDNOKROKOWY DOSTAJE SZEROKOŚĆ WŁASNEJ KOLUMNY, i to jest naprawa
 * defektu, nie ozdoba. Wierzchołki wielokąta leżą w ŚRODKACH kroków, więc
 * odcinek o jednym kroku dawał ścieżkę `M x,góra L x,dół Z` - figurę o zerowym
 * polu, którą wypełnienie bez obwódki rysuje jako NIC. Skutki były dwa i oba
 * kłamały: pasmo podane wyłącznie w ostatnim kroku prognozy znikało, a pasmo
 * z luką w środku (krawędzie w krokach 5 i 7, brak w 6) rozpadało się na dwa
 * odcinki jednokrokowe i znikało CAŁE - czytelnik dostawał pojedynczą linię
 * prognozy, czyli dokładnie tę formę, przed którą ten rodzaj ma bronić, a model
 * orzekał przy tym `forecastDistinguished: true`, bo nośnik "pasmo" liczy się
 * z DANYCH, nie z pikseli.
 *
 * Dlaczego kolumna, a nie pionowa kreska z obwódką: obwódka wymagałaby
 * własnego krycia (linia 1 px przy alfie 0,10 jest niewidoczna), czyli
 * drugiego, niezależnego od palety pokrętła na tym samym rysunku. Kolumna
 * zostaje WYPEŁNIENIEM o kryciu z tokena, a jej szerokość niczego nie dokłada:
 * krok jest pasmem kategorii i już jest tak traktowany w strefie trafienia
 * (`bandIndex`) i przy etykiecie osi. Interpolacja między środkami kroków
 * zostaje dla odcinków o dwóch krokach i więcej - tam sąsiedni pomiar jest.
 */
function wielokat(
  segment: readonly KrawedzieKroku[],
  wzdluz: (u: number) => number,
  value: (v: number) => number,
  polKolumny: number,
): string {
  if (segment.length === 0) return "";
  if (segment.length === 1) {
    const s = segment[0];
    const x = wzdluz(s.index);
    const lewo = wsp(x - polKolumny);
    const prawo = wsp(x + polKolumny);
    const gora = wsp(value(s.upper));
    const dol = wsp(value(s.lower));
    return `M${lewo},${gora}L${prawo},${gora}L${prawo},${dol}L${lewo},${dol}Z`;
  }
  const gora = segment.map((s) => `${wsp(wzdluz(s.index))},${wsp(value(s.upper))}`);
  const dol = [...segment].reverse().map((s) => `${wsp(wzdluz(s.index))},${wsp(value(s.lower))}`);
  return `M${gora.join("L")}L${dol.join("L")}Z`;
}

interface FanChartProps {
  config: ChartConfig;
  lang: ChartLang;
  /**
   * Wskazanie oddane na zewnątrz - kliknięciem albo klawiszem Enter.
   *
   * Osobno od stanu wewnętrznego: wskazanie wskaźnikiem jest PODGLĄDEM i gaśnie
   * samo, a wybór jest DECYZJĄ czytelnika i ma prawo otworzyć okno szczegółów.
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

export function FanChart({ config, lang, onSelect, ariaLabel: nazwaZadana }: FanChartProps) {
  // Prefiks przez `keyPrefix` haka - tylko taki widzi bramka rozjazdu
  // kod-słownik; klucz sklejony template literalem wypada z kontroli parytetu.
  const { t: scoped } = useTranslation("translation", { keyPrefix: "charts" });
  const t = useCallback(
    (key: string, values?: Record<string, string | number>): string =>
      scoped(key, { lng: lang, ...values }),
    [scoped, lang],
  );
  const { ref: widthRef, width } = useContainerWidth<HTMLDivElement>();
  const { ref: revealRef, state: revealState } = useRevealOnScroll<HTMLDivElement>(config.animate);
  const [active, setActive] = useState<number | null>(null);
  // Identyfikatory bez dwukropków: `useId` daje je z dwukropkami, a taki
  // napis nie jest poprawnym selektorem ani poprawnym celem `url(#...)`.
  const uid = useId().replace(/:/g, "");
  const opisId = `neh-fan-opis-${uid}`;
  const zoneHatchId = `neh-fan-zone-${uid}`;
  const clipId = `neh-fan-clip-${uid}`;

  const model: FanModel = useMemo(() => fanModelFromConfig(config), [config]);
  const height = config.height;
  const kroki = model.steps;

  // `useTapAwayDismiss` MUSI stać przed jakimkolwiek wczesnym wyjściem - hooki
  // nie mogą się warunkowo pomijać, a wyjście "brak kroków" jest niżej.
  const clearActive = useCallback(() => setActive(null), []);
  useTapAwayDismiss(active !== null, widthRef, clearActive);

  const geometry = useMemo(() => {
    // SKALA Z `fanExtent`, czyli z KRAWĘDZI PASM, nie z samej linii. Domena
    // policzona z linii pozwala pasmu wyjść ponad najwyższą podziałkę
    // i zostać przyciętym krawędzią rysunku, a przycięte pasmo niepewności
    // jest gorsze od braku pasma: sugeruje, że niepewność KOŃCZY SIĘ tam,
    // gdzie kończy się obszar kreślenia.
    const extent = fanExtent(model);
    const scale = niceScale(extent.min, extent.max, valueTickTarget(height, false));
    const tickW = Math.max(
      ...scale.ticks.map((tk) => estimateLabelWidth(formatAxisTick(tk, lang), FONT_AXIS)),
      0,
    );
    const padLeft = Math.max(PAD_LEFT_MIN, Math.ceil(tickW) + PAD_SIDE);
    const innerW = Math.max(MIN_INNER_W, width - padLeft - PAD_SIDE);
    const innerH = Math.max(MIN_INNER_H, height - PAD_TOP - PAD_BOTTOM);
    const value = linearScale(scale.min, scale.max, PAD_TOP + innerH, PAD_TOP);
    const krok = kroki.length > 0 ? innerW / kroki.length : innerW;
    // JEDNA FUNKCJA NA OBIE RZECZY: środek kategorii i pozycję granicy. Model
    // podaje granicę w JEDNOSTKACH INDEKSU (4,5 znaczy "w połowie odstępu
    // między kategorią 4 a 5"), więc ta sama arytmetyka musi obsłużyć indeks
    // całkowity i połówkowy - dwie osobne funkcje rozjechałyby się o pół
    // kroku, a separator przesunięty o pół kroku stoi na cudzej kategorii.
    const wzdluz = (u: number): number => padLeft + (u + 0.5) * krok;
    return { scale, padLeft, innerW, innerH, value, krok, wzdluz };
  }, [model, height, width, lang, kroki.length]);

  const { scale, padLeft, innerW, innerH, value, krok, wzdluz } = geometry;

  /**
   * POWIERZCHNIE DO POMALOWANIA, od najszerszej do najwęższej.
   *
   * Kolejność jest wymaganiem, nie porządkiem alfabetycznym: pasmo węższe
   * pomalowane jako pierwsze znika pod szerszym i czytelnik traci poziom
   * o najwyższej wartości informacyjnej. Model oddaje obie listy już
   * uporządkowane po warstwie.
   */
  const nakladajace = !(model.ringsComplete && model.rings.length > 0);
  const powierzchnie: PowierzchniaPasma[] = useMemo(() => {
    if (model.levels.length === 0) return [];
    if (model.ringsComplete && model.rings.length > 0) {
      return model.rings.map((ring) => ({
        key: `pierscien-${ring.layer}-${ring.side}`,
        layer: ring.layer,
        segmenty: ring.segments.map((seg) =>
          seg.map((s) => ({ index: s.index, lower: s.from, upper: s.to })),
        ),
      }));
    }
    return model.levels.map((level) => ({
      key: `pasmo-${level.key}`,
      layer: level.layer,
      segmenty: level.segments.map((seg) =>
        seg.map((s) => ({ index: s.index, lower: s.lower, upper: s.upper })),
      ),
    }));
  }, [model]);

  /**
   * WYCINANKA SIATKI POD WACHLARZEM.
   *
   * Siatka ma kontrast do płyty około 1,18:1, a sąsiednie poziomy pasma dzieli
   * około 0,02 kontrastu - czyli linia siatki prześwitująca przez pasmo jest
   * WYRAŹNIEJSZA od granicy między poziomami i czyta się jako krawędź pasma.
   * Wachlarz z czterema poziomami dostawałby wtedy tyle fałszywych krawędzi,
   * ile ma podziałek.
   *
   * Wycinamy więc siatkę z obszaru najszerszego pasma: prostokąt pola rysunku
   * minus wielokąt pasma, regułą parzystości. To jest tańsze i pewniejsze niż
   * maska luminancji (ta wymagałaby bieli i czerni wpisanych wprost, czyli
   * literałów koloru) i nie rusza tintu strefy prognozy, który leży POD siatką
   * i ma prześwitywać.
   */
  const wycinankaSiatki: string | null = useMemo(() => {
    const najszersze = model.levels[0];
    if (!najszersze || najszersze.segments.length === 0) return null;
    const pole =
      `M${wsp(padLeft)},${wsp(PAD_TOP)}` +
      `L${wsp(padLeft + innerW)},${wsp(PAD_TOP)}` +
      `L${wsp(padLeft + innerW)},${wsp(PAD_TOP + innerH)}` +
      `L${wsp(padLeft)},${wsp(PAD_TOP + innerH)}Z`;
    const pasma = najszersze.segments
      .map((seg) => wielokat(seg, wzdluz, value, krok / 2))
      .filter(Boolean)
      .join("");
    return pasma ? pole + pasma : null;
  }, [model, padLeft, innerW, innerH, wzdluz, value, krok]);

  // Ile etykiet kroku zmieści się bez nachodzenia. Pierwsza i OSTATNIA są
  // podpisane zawsze: bez ostatniej nie wiadomo, dokąd sięga prognoza.
  const krokEtykiet = useMemo(() => {
    let najszersza = 1;
    for (const s of kroki) {
      const w = estimateLabelWidth(s.label, FONT_AXIS);
      if (w > najszersza) najszersza = w;
    }
    return Math.max(1, Math.ceil((najszersza + STEP_LABEL_GAP) / Math.max(krok, 1)));
  }, [kroki, krok]);

  /**
   * Czy krok `i` dostaje podpis.
   *
   * OSTATNI PODPIS WYPIERA SĄSIADA, i to jest naprawa defektu. Sam warunek
   * `i % krokEtykiet === 0 || i === ostatni` stawia dwa napisy obok siebie,
   * gdy ostatni krok nie wypada na siatce co `krokEtykiet`: przy dwudziestu
   * czterech krokach i etykietach szerokości 107 px podpisy wychodziły na
   * x = 609 i x = 694, czyli nachodziły na siebie o dwadzieścia pikseli
   * i zlewały się w jeden nieczytelny napis. Ostatni musi zostać (bez niego
   * nie wiadomo, dokąd sięga prognoza), więc odpada ten z siatki - odstęp
   * `krokEtykiet * krok` jest z definicji nie mniejszy od najszerszej etykiety
   * z prześwitem, więc po tym odjęciu żadna para nie może już nachodzić.
   */
  const ostatniKrok = kroki.length - 1;
  const pokazEtykiete = (i: number): boolean =>
    i === ostatniKrok || (i % krokEtykiet === 0 && ostatniKrok - i >= krokEtykiet);

  /**
   * SLOT KOLORU CAŁEGO WACHLARZA.
   *
   * Jeden na wszystko - ścieżkę, pasma i punkty obserwacji - bo cały rysunek
   * jest o JEDNEJ wielkości, a kolumny krawędzi nie są osobnymi seriami.
   *
   * Slot bierzemy ZE ŚCIEŻKI CENTRALNEJ (`model.centralIndex`), bo to ona jest
   * tą wielkością. Slot serii pierwszej malował wachlarz kolorem KRAWĘDZI
   * u każdego autora, który ustawił kolumny w kolejności „dolna, górna,
   * centralna" - a kolor jest w tym systemie przydziałem, nie ozdobą: ta sama
   * wielkość ma mieć ten sam kolor na wszystkich wykresach wpisu.
   *
   * Gdy ścieżki nie ma (`null`), zostaje slot pierwszej kolumny: wachlarz bez
   * centrum i tak nie ma czego pokazać, a rysunek musi się czymś narysować.
   */
  const colorSlot = config.series[model.centralIndex ?? 0]?.colorSlot ?? 1;
  const kolor = `var(--chart-${colorSlot})`;
  const krycie = (layer: number): string =>
    `calc(var(--chart-band-${colorSlot}) * ${mnoznikWarstwy(
      layer,
      model.levels.length,
      nakladajace,
    ).toFixed(3)})`;

  /** Etykieta poziomu pewności. Liczba idzie z DEKLARACJI autora, nie ze zmierzonej szerokości. */
  const etykietaPasma = (level: FanLevel): string =>
    level.confidence === null
      ? t("fan.band.unknown")
      : t("fan.band.label", { confidence: formatChartValue(level.confidence, lang, "") });

  /** Lista etykiet/nazw do wstawki - puste napisy wypadają, bo "Serie , podają" nie jest zdaniem. */
  const lista = (values: readonly string[]): string => {
    const czyste = values.map((v) => v.trim()).filter(Boolean);
    return czyste.length > 0 ? czyste.join(", ") : BRAK_WARTOSCI;
  };

  const honesty = model.honesty;

  // ===== UWAGI POD RYSUNKIEM =====
  // Najpierw OBSERWACJE o formie, potem DEFEKTY danych - ta sama kolejność co
  // w histogramie i z tego samego powodu: "prognoza jest narysowana jedną
  // linią" zmienia sposób czytania CAŁEGO rysunku, a "jedna liczba wypadła
  // poza zakres" dotyczy jednego wiersza.
  //
  // Liczby podajemy KOMPLETEM: treść pisze słownik, i18next zignoruje wstawki,
  // których dane zdanie nie używa, ale POMINIĘTEJ wstawki nie ignoruje -
  // zostawia w zdaniu surowe `{{max}}` na opublikowanej stronie.
  const notes: ChartNote[] = fanFormAdvice(model).map((a) => ({
    key: `reading.${a}`,
    text: t(READING_KEYS[a], { max: FAN_LEVELS_ADVICE_MAX }),
    defect: false,
  }));

  // DEFEKTY DANYCH. Konwencja modelu: `null` znaczy "nie ma czego sprawdzać"
  // (model MILCZY), `false` znaczy "wykryty defekt", `true` znaczy "sprawdzone
  // i w porządku". Dlatego warunkiem jest `=== false`, a nie `!`.
  if (honesty.bandsContainCentral === false) {
    notes.push({
      key: "honesty.bandsContainCentral",
      text: t("fan.honesty.bandsContainCentral", { labels: lista(honesty.centralOutsideLabels) }),
      defect: true,
    });
  }
  if (honesty.bandsNested === false) {
    notes.push({
      key: "honesty.bandsNested",
      text: t("fan.honesty.bandsNested", { labels: lista(honesty.crossingLabels) }),
      defect: true,
    });
  }
  if (honesty.confidenceMatchesWidth === false) {
    notes.push({
      key: "honesty.confidenceMatchesWidth",
      text: t("fan.honesty.confidenceMatchesWidth", {
        confidences: lista(
          honesty.misorderedConfidences.map((c) => `${formatChartValue(c, lang, "")}%`),
        ),
      }),
      defect: true,
    });
  }
  if (honesty.bandsHaveWidth === false) {
    notes.push({
      key: "honesty.bandsHaveWidth",
      text: t("fan.honesty.bandsHaveWidth", { labels: lista(honesty.zeroWidthLabels) }),
      defect: true,
    });
  }
  if (honesty.bandPairsOrdered === false) {
    notes.push({
      key: "honesty.bandPairsOrdered",
      text: t("fan.honesty.bandPairsOrdered", { labels: lista(honesty.invertedLabels) }),
      defect: true,
    });
  }
  if (honesty.forecastDistinguished === false) {
    notes.push({
      key: "honesty.forecastDistinguished",
      text: t("fan.honesty.forecastDistinguished", {
        carriers: lista(honesty.carriers.map((c) => t(CARRIER_KEYS[c]))),
      }),
      defect: true,
    });
  }
  if (honesty.bandsContinuous === false) {
    notes.push({
      key: "honesty.bandsContinuous",
      text: t("fan.honesty.bandsContinuous", { labels: lista(honesty.bandGapLabels) }),
      defect: true,
    });
  }
  if (honesty.centralContinuousInForecast === false) {
    notes.push({
      key: "honesty.centralContinuousInForecast",
      // ETYKIETY TEJ SAMEJ FAZY, co orzeczenie. Jedna wspólna lista luk
      // wypisywała pod zdaniem o prognozie także kroki historii - zdanie
      // zostawało prawdziwe, ale czytelnik nie miał jak odróżnić, który brak
      // je wywołał.
      text: t("fan.honesty.centralContinuousInForecast", {
        labels: lista(honesty.centralForecastGapLabels),
      }),
      defect: true,
    });
  }
  if (honesty.centralContinuousInHistory === false) {
    notes.push({
      key: "honesty.centralContinuousInHistory",
      text: t("fan.honesty.centralContinuousInHistory", {
        labels: lista(honesty.centralHistoryGapLabels),
      }),
      defect: true,
    });
  }
  if (honesty.boundaryDropped) {
    notes.push({
      key: "honesty.boundaryDropped",
      text: t("fan.honesty.boundaryDropped"),
      defect: true,
    });
  }
  if (honesty.unpairedEdgeNames.length > 0) {
    notes.push({
      key: "honesty.unpairedEdge",
      text: t("fan.honesty.unpairedEdge", { names: lista(honesty.unpairedEdgeNames) }),
      defect: true,
    });
  }
  if (honesty.duplicateEdgeNames.length > 0) {
    notes.push({
      key: "honesty.duplicateEdge",
      text: t("fan.honesty.duplicateEdge", { names: lista(honesty.duplicateEdgeNames) }),
      defect: true,
    });
  }
  if (honesty.outOfRangeConfidences.length > 0) {
    notes.push({
      key: "honesty.outOfRangeConfidence",
      text: t("fan.honesty.outOfRangeConfidence", {
        values: lista(honesty.outOfRangeConfidences.map((c) => formatChartValue(c, lang, ""))),
      }),
      defect: true,
    });
  }
  if (honesty.extraSeriesNames.length > 0) {
    notes.push({
      key: "honesty.extraSeries",
      text: t("fan.honesty.extraSeries", { names: lista(honesty.extraSeriesNames) }),
      defect: true,
    });
  }
  if (honesty.droppedValueCount > 0) {
    notes.push({
      key: "honesty.droppedValues",
      text: t("fan.honesty.droppedValues", { count: honesty.droppedValueCount }),
      defect: true,
    });
  }
  // UWAGA NA ODWRÓCONĄ BIEGUNOWOŚĆ. `wideAtStart` i `constantWidth` są jedynymi
  // polami `FanHonesty`, w których `true` znaczy "coś jest nie tak" - odwrotnie
  // niż wszystkie pozostałe orzeczenia, gdzie defektem jest `false`. Napisane
  // odruchowo `=== false` dałoby uwagę o szerokim starcie na KAŻDYM poprawnym
  // wachlarzu i milczenie na tym jednym, który wystartował szeroko.
  //
  // Oba pola są INFORMACJĄ, nie defektem (`defect: false`): żadna liczba nie
  // jest w nich fałszywa, rysunek mówi tylko o niepewności coś, czego dane nie
  // mówią. `firstStepWidthShare` może być `null` i wtedy MILCZYMY, zamiast
  // podstawiać zero - udział zerowy jest twierdzeniem, a nie brakiem.
  if (honesty.wideAtStart && honesty.firstStepWidthShare !== null) {
    notes.push({
      key: "honesty.wideAtStart",
      text: t("fan.honesty.wideAtStart", {
        share: formatPercent(honesty.firstStepWidthShare, lang),
      }),
      defect: false,
    });
  }
  // `honesty.constantWidth === true` NIE DOSTAJE tu osobnej uwagi, choć klucz
  // `fan.honesty.constantWidth` istnieje. To nie jest przeoczenie: model
  // wystawia z tego samego pola poradę formy `constantBand`, a oba zdania mówią
  // dokładnie to samo ("szerokość pasma jest w każdym kroku prognozy ta sama").
  // Wypisane razem stałyby obok siebie na jednej liście jako dwa zdania o tej
  // samej treści, a lista, na której zdania się powtarzają, uczy pomijania
  // całej listy. Rozjazd jest po stronie słownika i jest zgłoszony osobno.

  // BRAK KROKÓW NIE MOŻE ZNACZYĆ "PUSTE MIEJSCE". Nie ma czego narysować, ale
  // to nie jest powód do milczenia - czytelnik widzi wtedy kartę z tytułem nad
  // niczym i nie wie, czy patrzy na awarię, czy na dane, z których nie da się
  // zbudować prognozy. Zwracamy więc same uwagi; wyjście MUSI stać po
  // wszystkich hakach i przed rysowaniem.
  if (kroki.length === 0) {
    return notes.length === 0 ? null : (
      <div ref={revealRef} className={revealClassName(revealState)}>
        <ChartNotes notes={notes} />
      </div>
    );
  }

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    // WYBÓR Z KLAWIATURY stoi PRZED pozostałymi gałęziami i kończy obsługę:
    // Enter na wskazanym elemencie jest decyzją, a nie ruchem po osi.
    if (isSelectKey(e.key)) {
      if (active !== null && onSelect) {
        e.preventDefault();
        onSelect(categorySelection(config.kind, config.categories, config.series, active));
      }
      return;
    }
    if (e.key === "Escape") {
      setActive(null);
      return;
    }
    const delta = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    if (delta === 0) return;
    e.preventDefault();
    setActive((prev) => {
      const next = prev === null ? (delta > 0 ? 0 : kroki.length - 1) : prev + delta;
      return Math.max(0, Math.min(kroki.length - 1, next));
    });
  };

  const indexFromPointer = (e: PointerEvent<SVGRectElement>): number => {
    const point = pointerToPlot(
      e.clientX,
      e.clientY,
      e.currentTarget.getBoundingClientRect(),
      innerW,
      innerH,
    );
    if (point === null) return 0;
    // STREFA TRAFIENIA TO CAŁA KOLUMNA KROKU, nie kształt pasma (sekcja 6).
    // Kształt pasma jest w pierwszym kroku prognozy wysoki na kilka pikseli
    // i palcem nietrafialny, a pytanie, które zadaje się tu wskaźnikiem,
    // brzmi "co w tym kroku", nie "co w tym poziomie pewności".
    return bandIndex(point.x, krok, kroki.length);
  };

  const czynny = active === null ? null : (kroki[active] ?? null);
  const granica = model.boundary;
  const granicaX = granica === null ? null : wzdluz(granica.separatorAt);
  const strefaOd = granica === null ? null : wzdluz(granica.zoneFrom);
  const strefaSzer = strefaOd === null ? 0 : Math.max(0, padLeft + innerW - strefaOd);

  // PUNKTY OBSERWACJI TYLKO NA HISTORII - ich brak w prognozie sam mówi, że
  // tam nie ma pomiarów, i jest to nośnik mocniejszy od kreskowania, bo działa
  // w druku i w skali szarości. Model nie zostawia tu miejsca na pomyłkę:
  // `isObservation` jest `false` w całej prognozie bez wyjątku.
  const pokazPunkty = shouldShowDots(honesty.observationCount, 0);

  const tooltipRows: TooltipRow[] = czynny
    ? [
        {
          name: t("fan.table.central"),
          value:
            czynny.central === null
              ? BRAK_WARTOSCI
              : formatChartValue(czynny.central, lang, config.unit),
          colorSlot,
          emphasised: true,
        },
        // PO JEDNYM WIERSZU NA POZIOM PEWNOŚCI, w kolejności warstw - tej
        // samej, w której poziomy są narysowane. Krawędź pasma jest jedyną
        // liczbą tego wykresu, której z rysunku nie da się odczytać (10-11%
        // krycia, bez podziałki), więc dymek jest pierwszym miejscem, w którym
        // ona w ogóle pada.
        ...model.levels.map((level) => {
          const step = level.steps.find((s) => s.index === czynny.index);
          return {
            name: etykietaPasma(level),
            value: step
              ? `${formatChartValue(step.lower, lang, config.unit)} - ${formatChartValue(
                  step.upper,
                  lang,
                  config.unit,
                )}`
              : BRAK_WARTOSCI,
            colorSlot: null,
          };
        }),
      ]
    : [];

  // BEZ OSŁON NA INDEKSACH, i to jest świadome: wyjście "brak kroków" stoi
  // wyżej, więc `kroki[0]` i `kroki[kroki.length - 1]` tu ISTNIEJĄ, a
  // `granica.forecastFrom` model trzyma w zakresie 1..liczba-1 (inaczej nie
  // oddaje granicy wcale - patrz `honesty.boundaryDropped`). Dopisane `?? ""`
  // byłoby wątpliwością, którą ten kod rozstrzygnął czterdzieści linii wyżej,
  // i czytelnik szukałby wejścia, przy którym nazwa dostępna gubi zakres osi.
  const ariaLabel =
    nazwaZadana ??
    [
      config.title ? t("a11y.chart", { title: config.title }) : t("a11y.chartUntitled"),
      `${t("fan.axis.step")}: ${kroki[0].label} - ${kroki[kroki.length - 1].label}`,
      `${t("fan.axis.value")}: ${formatAxisTick(scale.min, lang)} - ${formatAxisTick(scale.max, lang)}`,
      granica === null
        ? ""
        : t("forecast.fromCategory", {
            category: kroki[granica.forecastFrom].label,
          }),
      model.levels.map((level) => etykietaPasma(level)).join(", "),
      `${t("fan.table.observations")}: ${formatChartValue(honesty.observationCount, lang, "")}`,
    ]
      .filter(Boolean)
      .join(". ");

  // OPIS DOSTĘPNY: wskazówka klawiatury ORAZ pochodzenie krawędzi i ścieżki.
  // Pochodzenie stoi tutaj, a nie na liście uwag, bo jest prawdziwe na KAŻDYM
  // wachlarzu - uwaga, którą widać zawsze, uczy ignorowania wszystkich uwag.
  // Czytelnik wzrokowy dostaje tę samą informację w tabeli danych
  // (`FanTable.bandSource`), a czytelnik ekranu nie ma jej skąd wziąć inaczej.
  const opis = [
    t("a11y.keyboardHint"),
    t(BAND_SOURCE_KEYS[model.bandSource]),
    t(CENTRAL_SOURCE_KEYS[model.centralSource]),
  ].join(" ");

  return (
    <div ref={revealRef} className={revealClassName(revealState)}>
      <div
        ref={widthRef}
        className="neh-canvas relative w-full select-none"
        style={{ height, borderRadius: "var(--chart-radius)" }}
        tabIndex={0}
        role="img"
        aria-label={ariaLabel}
        aria-describedby={opisId}
        onKeyDown={onKeyDown}
        onBlur={clearActive}
      >
        <span id={opisId} className="sr-only">
          {opis}
        </span>
        <svg width={width} height={height} className="block overflow-visible">
          <defs>
            {/* STREFA PROGNOZY - DWA WARIANTY TEJ SAMEJ POWIERZCHNI, ten sam
                mechanizm co w `CartesianChart`: na ekranie płaski tint przy
                kilku promilach krycia, w druku ukośne kreskowanie 45 stopni.
                Tint 2% szarości nie ma czym odbić się od bieli, więc na
                papierze prognoza traciłaby jeden z trzech nośników
                odróżnienia. Oba prostokąty są w drzewie zawsze, a przełącza je
                arkusz (`.neh-zone-tint` / `.neh-zone-hatch` w `@media print`) -
                inaczej się nie da, bo identyfikator wzoru jest unikalny per
                instancja i CSS nie umie go wskazać w `fill`. */}
            {granicaX !== null && (
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
                  // Kolor i krycie w `style`, nie w atrybutach prezentacyjnych:
                  // `var()` w atrybutach SVG nie jest wspierane wszędzie,
                  // a nierozwiązany `stroke` to czerń.
                  style={{ stroke: "var(--chart-zone)", strokeOpacity: 0.06 }}
                  strokeWidth={1}
                />
              </pattern>
            )}
            {wycinankaSiatki !== null && (
              <clipPath id={clipId}>
                {/* Reguła parzystości: pole rysunku MINUS wielokąt pasma. */}
                <path d={wycinankaSiatki} clipRule="evenodd" />
              </clipPath>
            )}
          </defs>

          {/* Strefa prognozy leży NAJNIŻEJ - pod siatką, żeby siatka poza
              wachlarzem pozostała czytelna, i pod pasmami, bo jest tłem. */}
          {granicaX !== null && strefaOd !== null && (
            <>
              <rect
                className="neh-zone-tint"
                data-role="forecast-zone"
                x={strefaOd}
                y={PAD_TOP}
                width={strefaSzer}
                height={innerH}
                fill="var(--chart-zone)"
                style={{ fillOpacity: "var(--chart-zone-alpha)" }}
                rx={clampRadius(strefaSzer, innerH)}
                pointerEvents="none"
              />
              <rect
                className="neh-zone-hatch"
                x={strefaOd}
                y={PAD_TOP}
                width={strefaSzer}
                height={innerH}
                fill={`url(#${zoneHatchId})`}
                rx={clampRadius(strefaSzer, innerH)}
                pointerEvents="none"
              />
            </>
          )}

          {/* Siatka - wycięta spod wachlarza, patrz `wycinankaSiatki`. */}
          {config.showGrid && (
            <g clipPath={wycinankaSiatki !== null ? `url(#${clipId})` : undefined}>
              {scale.ticks.map((tick) => (
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
            </g>
          )}

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

          {/* Oś kroków - linia pod polem rysunku. Oś WARTOŚCI nie musi zaczynać
              się od zera (sekcja 8 nie wymaga tego dla linii), więc linii
              bazowej w zerze tu nie ma; ucięcie nazywa podpis ramy. */}
          <line
            x1={padLeft}
            x2={padLeft + innerW}
            y1={PAD_TOP + innerH}
            y2={PAD_TOP + innerH}
            stroke="var(--chart-axis)"
            strokeWidth={1}
          />

          {/* ===== PASMA: OD NAJSZERSZEGO DO NAJWĘŻSZEGO =====
              Płaskie wypełnienie, nigdy gradient: gradient oznacza w tym
              silniku obszar danych, płaskie wypełnienie - niepewność. Gdyby
              oba były gradientowe, czytelnik nie odróżniłby wielkości od
              nieznanego. */}
          {powierzchnie.map((p) =>
            p.segmenty.map((seg, i) => {
              const d = wielokat(seg, wzdluz, value, krok / 2);
              if (!d) return null;
              return (
                <path
                  key={`${p.key}-${i}`}
                  d={d}
                  fill={kolor}
                  // Krycie w `style`, nie w atrybucie - `var()` w atrybucie
                  // prezentacyjnym SVG nie jest wspierany wszędzie,
                  // a nierozwiązane krycie to pełna nieprzezroczystość, czyli
                  // plama na całym polu rysunku.
                  style={{ fillOpacity: krycie(p.layer) }}
                  className="neh-fade"
                  data-role="band"
                  data-layer={p.layer}
                  pointerEvents="none"
                />
              );
            }),
          )}

          {/* ===== ŚCIEŻKA CENTRALNA =====
              Idzie WIERZCHEM pasm, bo jest jedyną linią, którą czytelnik
              odczytuje wartościami; schowana pod pasmem 50% traciłaby kontrast
              dokładnie tam, gdzie wachlarz jest najgęstszy.

              I JEST CIĄGŁA PRZEZ GRANICĘ PROGNOZY - bez kreskowania ogona.
              Prognoza jest już odróżniona trzema nośnikami (pasmo, tło strefy,
              separator z etykietą), a czwarty zaczyna wyglądać na artefakt
              renderu. Model orzeka o ciągłości osobno
              (`centralContinuousInForecast`): przerywa ją wyłącznie LUKA
              W DANYCH, i to jest zupełnie inna rzecz niż styl linii. */}
          {model.centralSegments.map((segment, i) => (
            <path
              key={`c${i}`}
              d={segment
                .map(
                  (p, j) => `${j === 0 ? "M" : "L"}${wsp(wzdluz(p.index))},${wsp(value(p.value))}`,
                )
                .join("")}
              fill="none"
              stroke={kolor}
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
              pathLength={1}
              className="neh-line"
              data-role="central-path"
            />
          ))}

          {pokazPunkty &&
            kroki.map((s) =>
              s.isObservation && s.central !== null ? (
                <circle
                  key={`o${s.index}`}
                  cx={wzdluz(s.index)}
                  cy={value(s.central)}
                  r={2.8}
                  // Kropka w kolorze PŁYTY z obwódką w kolorze serii, nie
                  // odwrotnie: wypełnienie płytą znika w tle karty, więc widać
                  // sam pierścień, a on czyta się jako "tu jest pomiar".
                  fill="var(--card)"
                  stroke={kolor}
                  strokeWidth={1.6}
                  data-active={active === s.index ? "true" : undefined}
                  className="neh-dot neh-fade"
                  data-role="observation"
                />
              ) : null,
            )}

          {/* GRANICA PROGNOZY: linia ciągła 1 px ORAZ etykieta słowna. Sama
              linia nie mówi "prognoza", a samo tło strefy ginie w skali
              szarości - dopiero trzy nośniki razem przeżywają druk. Rysowana
              PO pasmach i ścieżce, żeby nie chowała się pod wachlarzem. */}
          {granicaX !== null && (
            <g pointerEvents="none" data-role="forecast-boundary">
              <line
                x1={granicaX}
                x2={granicaX}
                y1={PAD_TOP}
                y2={PAD_TOP + innerH}
                className="neh-forecast-divider"
              />
              <text
                x={granicaX + SEPARATOR_LABEL_GAP}
                y={PAD_TOP + 11}
                fontSize={FONT_AXIS}
                fill="var(--muted-foreground)"
              >
                {t("forecast.label")}
              </text>
            </g>
          )}

          {/* Prowadnica pod wskazanym krokiem - linia ciągła 1 px w kolorze
              osi, rysowana PO znacznikach, bo schowana pod wachlarzem
              przestałaby wskazywać krok. */}
          {czynny !== null && (
            <line
              className="neh-crosshair"
              x1={wzdluz(czynny.index)}
              x2={wzdluz(czynny.index)}
              y1={PAD_TOP}
              y2={PAD_TOP + innerH}
            />
          )}

          {kroki.map((s, i) =>
            pokazEtykiete(i) ? (
              <text
                key={`e${s.index}`}
                x={wzdluz(s.index)}
                y={PAD_TOP + innerH + 16}
                textAnchor="middle"
                fontSize={FONT_AXIS}
                fill="var(--muted-foreground)"
              >
                {s.label}
              </text>
            ) : null,
          )}

          {/* Warstwa trafień na CAŁE pole rysunku (sekcja 6: strefa trafienia
              nigdy nie jest kształtem elementu). */}
          <rect
            className="neh-hit"
            x={padLeft}
            y={PAD_TOP}
            width={innerW}
            height={innerH}
            fill="transparent"
            onPointerDown={(e) => {
              const i = indexFromPointer(e);
              setActive(i);
              if (i !== null && onSelect) {
                onSelect(categorySelection(config.kind, config.categories, config.series, i));
              }
            }}
            onPointerMove={(e) => setActive(indexFromPointer(e))}
            onPointerLeave={(e) => {
              // Dotyk NIE gasi dymka przy opuszczeniu warstwy: palec schodzi
              // z ekranu po każdym stuknięciu, więc dymek zniknąłby zawsze
              // natychmiast po pokazaniu. Gasi go stuknięcie poza wykresem.
              if (e.pointerType !== "touch") setActive(null);
            }}
          />
        </svg>

        <ChartTooltip
          visible={czynny !== null}
          x={czynny ? wzdluz(czynny.index) : 0}
          y={czynny && czynny.central !== null ? value(czynny.central) : PAD_TOP + innerH / 2}
          containerWidth={width}
          title={czynny?.label ?? ""}
          note={
            czynny === null
              ? undefined
              : czynny.isForecast
                ? t("forecast.label")
                : t("forecast.historyLabel")
          }
          rows={tooltipRows}
        />
      </div>

      <ChartNotes notes={notes} />
    </div>
  );
}
