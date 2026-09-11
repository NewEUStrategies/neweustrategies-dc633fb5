// Paleta wykresów jako LICZBY, nie jako gust: kontrast WCAG, symulacja
// daltonizmu i odległość CIELAB policzone tu, w czystych funkcjach, żeby
// bramka `__tests__/palette.test.ts` mogła je sprawdzić na każdym commicie.
//
// DLACZEGO TEN PLIK ISTNIEJE. Paleta żyje w `src/styles.css` jako tokeny CSS
// i silnik rysujący czyta WYŁĄCZNIE tokeny (żadnego hexa w kodzie rysującym).
// Ale token to napis: nic w CSS nie powie, że para odcieni zbiega się do
// jednego koloru u osoby nierozróżniającej czerwieni i zieleni. Kontrast i
// odległość barw nie są widoczne w DOM, więc test renderujący ich nigdy nie
// zobaczy - jedyną drogą jest policzenie ich z wartości tokenów. Ten moduł
// trzyma te wartości OBOK metody, którą je policzono, więc podmiana odcienia
// bez przeliczenia całej palety oblewa bramkę, a nie przechodzi po cichu.
//
// METODA (ta sama dla każdej liczby w tym pliku i w komentarzach styles.css):
//   * kontrast - wzór WCAG 2.x na luminancji relatywnej sRGB,
//   * daltonizm - macierze Machado, Oliveira i Fernandes (2009) przy PEŁNYM
//     nasileniu (severity 1.0),
//   * odległość barw - CIE76 (euklides w CIELAB, biały punkt D65).
// Metoda odtwarza liczby ze specyfikacji palety z dokładnością do drugiego
// miejsca (paleta jasna: 19,89 / 23,12 / 16,99 wobec deklarowanych 19,9 / 23,1
// / 17,0; paleta ciemna: 24,60 / 26,19 / 24,44 wobec 24,6 / 26,2 / 24,4),
// więc porównania wewnątrz repo są spójne z tamtymi.

/** Powierzchnia, na której paleta jest mierzona: token `--card` obu motywów. */
export const CHART_PLATE = { light: "#ffffff", dark: "#0f0f0f" } as const;

export type ChartThemeName = keyof typeof CHART_PLATE;

/** Rodzaje widzenia barw, w których paleta musi się rozdzielać. */
export const CVD_KINDS = ["deutan", "protan", "tritan"] as const;
export type CvdKind = (typeof CVD_KINDS)[number];

/**
 * Ile PIERWSZYCH POZYCJI SEKWENCJI (patrz SLOT_SEQUENCE) wolno użyć jako
 * kategorii, żeby zestaw pozostał rozdzielny dla każdego rodzaju widzenia barw.
 *
 * Sześć - i to nadal nie jest liczba z zaokrąglenia, tylko wynik dokładnego
 * przeszukania: z dwudziestu siedmiu slotów palety największy podzbiór, który
 * JEDNOCZEŚNIE trzyma CVD_FLOOR.safe w obu motywach i ma co najmniej 3:1 na
 * własnej płycie w obu motywach, liczy dokładnie sześć elementów. Bez warunku
 * widoczności dałoby się zejść po osiem, ale w tym ósemkowym zestawie siedzą
 * #FFDAB3 (1,32:1 na białej płycie) i #FF788D (2,52:1), więc byłyby to kolory
 * rozdzielne dla daltonisty i niewidoczne dla wszystkich.
 *
 * Pozycje 7 i 8 sekwencji mają WŁASNĄ, niższą podłogę, a od dziewiątej w górę
 * nie ma żadnej - patrz CVD_FLOOR.
 */
export const CATEGORICAL_SAFE_MAX = 6;

/**
 * Ile pierwszych pozycji sekwencji trzyma jeszcze podłogę ROZSZERZONĄ. Powyżej
 * tej liczby kolor przestaje nieść kategorię i wykres musi ją nieść czymś
 * innym: kreskowaniem, etykietą bezpośrednią albo panelami.
 */
export const CATEGORICAL_EXTENDED_MAX = 8;

/**
 * Pierwszy slot PALETY BAZOWEJ. Sloty poniżej to rodziny odcienia silnika,
 * od tego numeru w górę - kolory marki zadane z zewnątrz.
 *
 * Granica jest tu po to, żeby dwie rzeczy dało się rozróżnić w kodzie:
 * rodziny silnika mają pełny komplet wariantów wypełnienia (blady, gradient),
 * paleta bazowa rysuje się WYŁĄCZNIE solidnie. To nie jest oszczędność na
 * arkuszu, tylko wniosek z pomiaru: blade wnętrze stoi na jasności 0,93,
 * a #ffdab3 ma 0,91 - "blady" wariant tego koloru jest nieodróżnialny od
 * samego tokena, więc byłby wariantem wyłącznie z nazwy. Przy #f7dd14
 * (1,37:1 do płyty) jest tak samo.
 */
export const BASE_PALETTE_FROM = 11;

/**
 * Progi WCAG. Nie zmieniają się między motywami - zmienia się kierunek
 * wyprowadzania wariantu tekstowego (w jasnym przyciemniamy odcień serii,
 * w ciemnym rozjaśniamy).
 */
export const CONTRAST_MIN = {
  /** Linia, wypełnienie, marker - WCAG 1.4.11 (elementy nietekstowe). */
  graphic: 3,
  /** Tekst poniżej 18,66 px bold / 24 px - WCAG 1.4.3 poziom AA. */
  text: 4.5,
} as const;

/**
 * Podłoga odległości barw po symulacji. Dwa progi i JEDEN JAWNY BRAK progu, bo
 * to trzy różne zestawy:
 *
 *   * `safe` - pierwsze CATEGORICAL_SAFE_MAX pozycji SLOT_SEQUENCE, czyli
 *     paleta właściwa;
 *   * `extended` - pierwsze CATEGORICAL_EXTENDED_MAX pozycji; rozszerzenie
 *     poza dyscyplinę sześciu kolorów i tego nie ukrywamy;
 *   * reszta palety - BEZ PODŁOGI, świadomie. Sloty 11-27 to kolory zadane
 *     z zewnątrz jako kolory marki, a nie dobrane pod rozdzielność: są wśród
 *     nich pary odległe po symulacji o 0,94 (#FF9A9A wobec #FF9D9D). Podłoga
 *     wpisana dla tego zestawu byłaby fikcją, więc jej nie ma, a bramka pilnuje
 *     czegoś, co jest prawdą: że silnik NIGDY nie sięga po te sloty sam.
 */
export const CVD_FLOOR = {
  safe: { deutan: 19.5, protan: 22.5, tritan: 16.5 },
  extended: { deutan: 10, protan: 12, tritan: 12 },
} as const;

/**
 * Docelowy korytarz kontrastu pasma prognozy do płyty. Poniżej dolnej granicy
 * pasmo jest niewidoczne, powyżej górnej konkuruje z linią serii. Krycie
 * liczymy PER SERIA (patrz `PaletteSlot.bandLight/bandDark`), bo różnica
 * jasności odcienia wobec płyty jest bardzo nierówna i stała alfa daje pasma
 * raz niewidoczne, raz krzyczące.
 */
export const BAND_CONTRAST_RANGE = { min: 1.1, max: 1.17 } as const;

/** Siatka ma być wyczuwalna, nie widoczna. */
export const GRID_CONTRAST_MAX = 1.3;

export interface PaletteSlot {
  /** Numer slotu 1..10 - ta liczba jest ZAPISANA w konfiguracjach wykresów. */
  slot: number;
  /** Nazwa odcienia (do komentarzy i paneli edytora). */
  key: string;
  /** Wypełnienie i linia serii. */
  light: string;
  dark: string;
  /** Wariant tekstowy: etykieta bezpośrednia, podpis, link (próg 4,5:1). */
  textLight: string;
  textDark: string;
  /** Kolor etykiety WEWNĄTRZ wypełnienia slotu (próg 4,5:1 wobec wypełnienia). */
  inkLight: string;
  inkDark: string;
  /** Krycie pasma prognozy - policzone pod BAND_CONTRAST_RANGE. */
  bandLight: number;
  bandDark: number;
  /**
   * Czy slot należy do zestawu rozdzielnego dla daltonizmu. Sloty poza
   * zestawem dostają w silniku DODATKOWY nośnik różnicy (kreskowanie linii),
   * bo sam odcień ich nie odróżnia.
   */
  cvdSafe: boolean;
}

/**
 * Sloty w KOLEJNOŚCI NUMERÓW, nie w kolejności przypisania. Te dwie rzeczy były
 * kiedyś jednym i to działało, dopóki kolory dobierało się pod rozdzielność.
 * Odkąd numery slotów niosą KOLORY MARKI zadane z zewnątrz, muszą się rozejść:
 * numer slotu jest zapisany w treści (bloki CMS, CSV widgetów) i ma wskazywać
 * ten kolor, który wskazywał, a o tym, które kolory dostaną dwie pierwsze serie
 * wykresu, decyduje pomiar - patrz SLOT_SEQUENCE.
 *
 * Ile to naprawdę kosztuje, widać na jednej liczbie: gdyby serie dalej brały
 * sloty po kolei 1, 2, 3..., druga i trzecia (#FA9346 i #58a537) miałyby po
 * symulacji protanopii odległość 5,57 przy podłodze 22,5 - czyli dla protanopa
 * byłyby jednym kolorem.
 */
export const CHART_SLOTS: readonly PaletteSlot[] = [
  {
    slot: 1,
    key: "granat",
    light: "#03346e",
    dark: "#2196f3",
    textLight: "#03346e",
    textDark: "#2196f3",
    inkLight: "#ffffff",
    inkDark: "#12161c",
    bandLight: 0.07,
    bandDark: 0.11,
    cvdSafe: false,
  },
  {
    // ZADANY KOLOR MARKI, i on NIE PRZECHODZI progu grafiki na białej płycie:
    // 2,25:1 wobec wymaganych 3,0:1. Token zostaje dokładnie taki, jak zadano,
    // bo to jest kolor marki, a kształt niesie obwódka `--chart-2-edge`
    // (3,15:1) - ten sam mechanizm, którym wariant blady niesie tożsamość.
    // Dlatego slot 2 NIE jest w sekwencji przypisania jako jeden z pierwszych
    // i nie wolno go użyć jako samej linii bez obwódki.
    slot: 2,
    key: "ochra",
    light: "#fa9346",
    dark: "#fdb078",
    textLight: "#b95e00",
    textDark: "#fdb078",
    inkLight: "#12161c",
    inkDark: "#12161c",
    bandLight: 0.16,
    bandDark: 0.08,
    cvdSafe: false,
  },
  {
    // Jasnego partnera nie było w zadanej liście - jest WYPROWADZONY z ciemnego
    // tą samą regułą, co wariant tekstowy: ten sam odcień i nasycenie, krok
    // jasności do progu grafiki. Stąd #58a537, a nie dawna szałwia.
    slot: 3,
    key: "szalwia",
    light: "#58a537",
    dark: "#76c457",
    textLight: "#3a870e",
    textDark: "#76c457",
    inkLight: "#12161c",
    inkDark: "#12161c",
    bandLight: 0.13,
    bandDark: 0.09,
    cvdSafe: true,
  },
  {
    slot: 4,
    key: "sliwka",
    light: "#8c56d4",
    dark: "#e7bcde",
    textLight: "#8c56d4",
    textDark: "#e7bcde",
    inkLight: "#ffffff",
    inkDark: "#12161c",
    bandLight: 0.1,
    bandDark: 0.07,
    cvdSafe: true,
  },
  {
    // To samo co przy slocie 2: 2,28:1 na płycie jasnej, obwódka 3,19:1.
    slot: 5,
    key: "lazur",
    light: "#2bbbd7",
    dark: "#92eeff",
    textLight: "#008297",
    textDark: "#92eeff",
    inkLight: "#12161c",
    inkDark: "#12161c",
    bandLight: 0.15,
    bandDark: 0.07,
    cvdSafe: false,
  },
  {
    slot: 6,
    key: "terakota",
    light: "#bb8760",
    dark: "#ca7842",
    textLight: "#9d6b45",
    textDark: "#ca7842",
    inkLight: "#12161c",
    inkDark: "#12161c",
    bandLight: 0.13,
    bandDark: 0.11,
    cvdSafe: false,
  },
  {
    slot: 7,
    key: "indygo",
    light: "#5f6c98",
    dark: "#92a1ca",
    textLight: "#5f6c98",
    textDark: "#92a1ca",
    inkLight: "#ffffff",
    inkDark: "#12161c",
    bandLight: 0.1,
    bandDark: 0.09,
    cvdSafe: false,
  },
  {
    slot: 8,
    key: "oliwka",
    light: "#607456",
    dark: "#8b9a6e",
    textLight: "#607456",
    textDark: "#8b9a6e",
    inkLight: "#ffffff",
    inkDark: "#12161c",
    bandLight: 0.1,
    bandDark: 0.1,
    cvdSafe: true,
  },
  {
    slot: 9,
    key: "roza",
    light: "#7b2525",
    dark: "#ba6a4c",
    textLight: "#7b2525",
    textDark: "#ba6a4c",
    inkLight: "#ffffff",
    inkDark: "#12161c",
    bandLight: 0.07,
    bandDark: 0.13,
    cvdSafe: false,
  },
  {
    slot: 10,
    key: "morski",
    light: "#4b9391",
    dark: "#8fd3d0",
    textLight: "#398180",
    textDark: "#8fd3d0",
    inkLight: "#12161c",
    inkDark: "#12161c",
    bandLight: 0.12,
    bandDark: 0.07,
    cvdSafe: false,
  },
  {
    // ---- Sloty 11-27: PALETA BAZOWA. ----
    // Siedemnaście par odcieni zadanych wprost. To NIE jest ciąg dalszy palety
    // serii i nie wolno go tak czytać: wśród tych kolorów są pary, których
    // odległość po symulacji daltonizmu wynosi 0,94 (#FF9A9A wobec #FF9D9D),
    // czyli dla części odbiorców są tym samym kolorem. Dlatego zestaw NIE MA
    // podłogi rozdzielności - patrz CVD_FLOOR - a silnik nigdy nie przypisuje
    // z niego koloru sam z siebie. Wchodzą do wykresu tylko wtedy, gdy autor
    // wybierze numer slotu wprost, i wtedy odpowiada za różnicę tak samo, jak
    // odpowiada za kolejność kategorii.
    // Sześć z nich trafiło do sekwencji przypisania (11, 12, 14, 20, 21 i 15),
    // bo pomiar pokazał, że są rozdzielniejsze od części slotów serii.
    slot: 11,
    key: "grafit",
    light: "#232c31",
    dark: "#586268",
    textLight: "#232c31",
    textDark: "#727d83",
    inkLight: "#ffffff",
    inkDark: "#ffffff",
    bandLight: 0.07,
    bandDark: 0.17,
    cvdSafe: false,
  },
  {
    slot: 12,
    key: "czerwien",
    light: "#cd393b",
    dark: "#ff9a9a",
    textLight: "#cd393b",
    textDark: "#ff9a9a",
    inkLight: "#ffffff",
    inkDark: "#12161c",
    bandLight: 0.09,
    bandDark: 0.08,
    cvdSafe: false,
  },
  {
    slot: 13,
    key: "atrament",
    light: "#15334d",
    dark: "#446380",
    textLight: "#15334d",
    textDark: "#5e7e9c",
    inkLight: "#ffffff",
    inkDark: "#ffffff",
    bandLight: 0.07,
    bandDark: 0.17,
    cvdSafe: false,
  },
  {
    slot: 14,
    key: "ametyst",
    light: "#6929c4",
    dark: "#b281f7",
    textLight: "#6929c4",
    textDark: "#b281f7",
    inkLight: "#ffffff",
    inkDark: "#12161c",
    bandLight: 0.08,
    bandDark: 0.1,
    cvdSafe: true,
  },
  {
    slot: 15,
    key: "cytryna",
    light: "#f7dd14",
    dark: "#fff07d",
    textLight: "#867700",
    textDark: "#fff07d",
    inkLight: "#12161c",
    inkDark: "#12161c",
    bandLight: 0.36,
    bandDark: 0.06,
    cvdSafe: false,
  },
  {
    slot: 16,
    key: "bordo",
    light: "#7f2020",
    dark: "#ff9d9d",
    textLight: "#7f2020",
    textDark: "#ff9d9d",
    inkLight: "#ffffff",
    inkDark: "#12161c",
    bandLight: 0.07,
    bandDark: 0.08,
    cvdSafe: false,
  },
  {
    slot: 17,
    key: "mech",
    light: "#6d9e51",
    dark: "#b5e18b",
    textLight: "#538236",
    textDark: "#b5e18b",
    inkLight: "#12161c",
    inkDark: "#12161c",
    bandLight: 0.13,
    bandDark: 0.07,
    cvdSafe: false,
  },
  {
    slot: 18,
    key: "morela",
    light: "#ed985f",
    dark: "#f7b980",
    textLight: "#b16125",
    textDark: "#f7b980",
    inkLight: "#12161c",
    inkDark: "#12161c",
    bandLight: 0.16,
    bandDark: 0.08,
    cvdSafe: false,
  },
  {
    slot: 19,
    key: "lodowy",
    light: "#9cc6db",
    dark: "#9cc6db",
    textLight: "#547c8f",
    textDark: "#9cc6db",
    inkLight: "#12161c",
    inkDark: "#12161c",
    bandLight: 0.22,
    bandDark: 0.08,
    cvdSafe: false,
  },
  {
    slot: 20,
    key: "fuksja",
    light: "#c95792",
    dark: "#c95792",
    textLight: "#bf4e89",
    textDark: "#c95792",
    inkLight: "#12161c",
    inkDark: "#12161c",
    bandLight: 0.11,
    bandDark: 0.13,
    cvdSafe: true,
  },
  {
    slot: 21,
    key: "malina",
    light: "#e50046",
    dark: "#e50046",
    textLight: "#e50046",
    textDark: "#ef1b4d",
    inkLight: "#ffffff",
    inkDark: "#ffffff",
    bandLight: 0.07,
    bandDark: 0.2,
    cvdSafe: true,
  },
  {
    slot: 22,
    key: "brzoskwinia",
    light: "#ffdab3",
    dark: "#ffdab3",
    textLight: "#91704c",
    textDark: "#ffdab3",
    inkLight: "#12161c",
    inkDark: "#12161c",
    bandLight: 0.47,
    bandDark: 0.07,
    cvdSafe: false,
  },
  {
    slot: 23,
    key: "piaskowy",
    light: "#d4bdac",
    dark: "#d4bdac",
    textLight: "#877363",
    textDark: "#d4bdac",
    inkLight: "#12161c",
    inkDark: "#12161c",
    bandLight: 0.23,
    bandDark: 0.08,
    cvdSafe: false,
  },
  {
    slot: 24,
    key: "karmel",
    light: "#dca47c",
    dark: "#ffd3b6",
    textLight: "#9f6b44",
    textDark: "#ffd3b6",
    inkLight: "#12161c",
    inkDark: "#12161c",
    bandLight: 0.18,
    bandDark: 0.07,
    cvdSafe: false,
  },
  {
    slot: 25,
    key: "rubin",
    light: "#b80000",
    dark: "#b80000",
    textLight: "#b80000",
    textDark: "#e13e30",
    inkLight: "#ffffff",
    inkDark: "#ffffff",
    bandLight: 0.07,
    bandDark: 0.26,
    cvdSafe: false,
  },
  {
    slot: 26,
    key: "koral",
    light: "#ff788d",
    dark: "#ff788d",
    textLight: "#cb4961",
    textDark: "#ff788d",
    inkLight: "#12161c",
    inkDark: "#12161c",
    bandLight: 0.14,
    bandDark: 0.1,
    cvdSafe: false,
  },
  {
    slot: 27,
    key: "miod",
    light: "#b88950",
    dark: "#e1b076",
    textLight: "#9b6d34",
    textDark: "#e1b076",
    inkLight: "#12161c",
    inkDark: "#12161c",
    bandLight: 0.13,
    bandDark: 0.08,
    cvdSafe: false,
  },
];

/**
 * KOLEJNOŚĆ PRZYPISANIA slotów do serii, policzona z pomiaru.
 *
 * Serie bez zapisanego slotu biorą kolory w TEJ kolejności, a nie 1, 2, 3.
 * Pierwsze `CATEGORICAL_SAFE_MAX` pozycji trzyma pełną podłogę CVD_FLOOR.safe
 * w OBU motywach (zmierzone: 21,21 / 25,08 / 16,77 na jasnym i 23,86 / 30,39 /
 * 20,85 na ciemnym), pierwsze osiem trzyma CVD_FLOOR.extended (12,94 / 16,49 /
 * 16,77 oraz 12,91 / 17,61 / 20,80). Dalsze pozycje są ułożone zachłannie po
 * malejącej odległości od już wziętych i nie mają żadnej gwarancji.
 *
 * KAŻDA pozycja sekwencji ma ponadto co najmniej 3:1 na własnej płycie
 * w obu motywach - rozdzielność bez widoczności nie jest rozdzielnością.
 * Z dwudziestu siedmiu slotów warunek "rozdzielny ORAZ widoczny" spełnia
 * dokładnie sześć naraz i to jest powód, dla którego CATEGORICAL_SAFE_MAX
 * został sześcioma, a nie urósł razem z paletą.
 *
 * Zmiana tej tablicy zmienia kolory serii, które slotu NIE mają zapisanego -
 * czyli nowych wykresów i pulpitów BI. Wykresy z zapisanym `colorSlot` są na
 * nią odporne i to jest cel rozdzielenia.
 */
export const SLOT_SEQUENCE: readonly number[] = [
  3, 4, 8, 14, 20, 21, 11, 12, 15,
  18, 5, 6, 26, 22, 25, 13, 9, 23,
  17, 24, 1, 2, 7, 19, 27, 10, 16,
];

/**
 * Semantyka znaku. ODDZIELNA od palety kategorialnej, bo koduje ZNACZENIE
 * (zysk / strata), a nie kategorię - i dlatego nie wolno jej brać ze slotu.
 *
 * Dodatni jest niebieskim tealem, nie zielenią, i to jedyna decyzja, którą
 * wymusiła czerwień: para #ef5454 / #2d7a6a (klasyczny teal zielony) daje przy
 * protanopii odległość 8,5, czyli dla protanopa zysk i strata są tym samym
 * kolorem - dokładnie awaria czerwono-zielona, przed którą cały ten zestaw
 * ucieka. Przesunięcie dodatniego w stronę niebieskiego podnosi tę odległość
 * czterokrotnie (33,9).
 *
 * Czerwień jako GRAFIKA ma na białej płycie 3,46:1 (próg 3,0 przechodzi),
 * jako TEKST nie (próg 4,5), więc liczby ujemne i podpisy biorą wariant
 * `negativeTextLight`. W motywie ciemnym czerwień ma 5,54:1 i wariantu nie
 * potrzebuje.
 */
export const CHART_SEMANTIC = {
  positiveLight: "#1b6f8c",
  positiveDark: "#6fb3c9",
  positiveTextLight: "#1b6f8c",
  positiveTextDark: "#6fb3c9",
  negativeLight: "#ef5454",
  negativeDark: "#ef5454",
  negativeTextLight: "#ae413f",
  negativeTextDark: "#ef5454",
  /** Tusz etykiety wewnątrz wypełnienia semantycznego. */
  positiveInkLight: "#ffffff",
  positiveInkDark: "#12161c",
  negativeInkLight: "#12161c",
  negativeInkDark: "#12161c",
  bandPositiveLight: 0.09,
  bandPositiveDark: 0.09,
  bandNegativeLight: 0.11,
  bandNegativeDark: 0.13,
} as const;

/**
 * POWIERZCHNIE, wobec których mierzy się kontrast - wszystkie trzy, nie tylko
 * płyta.
 *
 * Płyta wykresu jest zawsze biała (jasny) albo `#0f0f0f` (ciemny) i to na niej
 * liczy się progi serii. Ale wykres stoi w SEKCJI, a sekcja ma własne tło -
 * i to tło bywa drugie, ciemniejsze. Trzymamy je tutaj, bo z tych liczb
 * wynika reguła, której nie da się zapisać w samym tokenie: patrz
 * `SLOTS_UNSAFE_ON_SURFACE_2`.
 *
 * W TRYBIE CIEMNYM DRUGIEGO TŁA NIE MA. Ciemne tło strony jest już samym
 * `#141313`, a wprowadzanie pod nie jeszcze ciemniejszego stopnia zjadałoby
 * różnicę wobec płyty (`#0f0f0f`) - dlatego `secondDark` jest po prostu tłem
 * strony, a nie osobnym odcieniem. To nie brak, to rozstrzygnięcie.
 */
export const CHART_SURFACES = {
  plateLight: CHART_PLATE.light,
  plateDark: CHART_PLATE.dark,
  pageLight: "#f8f6f4",
  pageDark: "#141313",
  secondLight: "#e4e8ee",
  secondDark: "#141313",
} as const;

/**
 * Sloty, które NIE MOGĄ leżeć bezpośrednio na drugim tle sekcyjnym.
 *
 * Drugie tło jest ciemniejsze od domyślnego o 1,14:1, i to wystarcza, żeby
 * trzy odcienie serii spadły pod próg grafiki 3,0:1: ochra do 2,48:1, szałwia
 * do 2,76:1, lazur do 2,97:1. Razem z nimi spada czerwień ujemna (2,81:1)
 * i akcent marki (1,83:1, ale ten nie przechodzi progu nawet na bieli).
 *
 * PRAKTYCZNA KONSEKWENCJA JEST JEDNA: płyta wykresu zostaje BIAŁA także wtedy,
 * gdy sekcja wokół niej jest w drugim tle. Nie chodzi o zakaz używania
 * drugiego tła - chodzi o to, że wykres nie kładzie na nim serii.
 *
 * Ta stała jest FAKTEM PALETY dla bramki, tak samo jak
 * `SLOTS_CLASHING_WITH_ACCENT`: silnik nie daje autorowi drogi do zmiany płyty
 * wykresu, więc nie ma tu czego ostrzegać w edytorze. Gdyby kiedyś dał,
 * warunek jest już policzony.
 */
export const SLOTS_UNSAFE_ON_SURFACE_2: readonly number[] = [
  2, 3, 5, 6, 10, 15, 17, 18, 19, 22, 23, 24, 26, 27,
];

/**
 * RAMP SEKWENCYJNY mapy-choroplety - para kotwic na motyw.
 *
 * PO CO TO JEST W MODULE PALETY, A NIE W KOMPONENCIE MAPY. Mapa koduje wartość
 * przez `color-mix()` na tokenach `--chart-seq-min` / `--chart-seq-max`, więc
 * na normalnej przeglądarce żaden hex nie jest jej potrzebny. Ale
 * `color-mix()` nie ma w starszych silnikach, a wtedy w atrybucie `fill`
 * ląduje kolor interpolowany w JS - i te dwa hexy MUSZĄ być tą samą parą, co
 * w arkuszu. Trzymane w komponencie żyły własnym życiem: arkusz miał
 * `#e0eaf2` / `#00375f`, a fallback `#cde2fb` / `#0d366b`, czyli ramp awaryjny
 * szedł w tę samą stronę, ale INNYMI kotwicami - i nikt tego nie widział, bo
 * nowa przeglądarka nigdy tej gałęzi nie wykonuje.
 *
 * Tu stoi jedno źródło prawdy, a bramka `__tests__/palette.test.ts` porównuje
 * je z arkuszem tak samo, jak porównuje wszystkie pozostałe kolory. Reguła
 * "żadnych hexów w kodzie rysującym" nie jest o estetyce - jest o tym, że
 * dwie kopie tej samej liczby rozjeżdżają się bez ostrzeżenia.
 *
 * PARA NA MOTYW, nie jedna. W trybie ciemnym ramp jest ODWRÓCONY kotwicą:
 * jedna para (jasna) dawałaby na ciemnej karcie najniższą wartość świecącą
 * (~11:1), a najwyższą gasnącą poniżej progu 3:1 dla obiektu graficznego.
 */
export const SEQ_RAMP = {
  light: { min: "#e0eaf2", max: "#00375f" },
  dark: { min: "#1e2935", max: "#8fbef0" },
} as const;

/**
 * Warianty AUDYTOWE akcentu - dwa, bo próg zależy od tego, czym akcent ma być.
 *
 * Akcent marki nie przechodzi na jasnym tle ŻADNEGO progu WCAG (`#fa9346` ma
 * 2,25:1 na płycie, `#ed751a` 2,93:1), więc nie może być jedynym nośnikiem
 * informacji. Gdy audyt dostępności wymaga, żeby ten sam odcień zadziałał jako
 * czytelny tekst na jasnym tle BEZ podkładu, trzeba go przyciemnić - i mamy
 * dwie różne odpowiedzi na dwa różne progi:
 *
 *   * `graphic` - 3,56:1 na płycie i 3,30:1 na tle strony, czyli próg grafiki
 *     (WCAG 1.4.11) i tekstu dużego;
 *   * `text` - 5,19:1 na płycie i 4,82:1 na tle strony, czyli próg tekstu
 *     normalnego (WCAG 1.4.3).
 *
 * OBA ZAWODZĄ NA DRUGIM TLE SEKCYJNYM (2,89:1 i 4,22:1), i to jest ta sama
 * reguła co przy seriach: to nie jest powierzchnia, na której cokolwiek
 * z rodziny akcentu jest jedynym nośnikiem.
 *
 * Furtka na wypadek audytu, NIE podmiana tokena: `--chart-accent` zostaje tym,
 * czym jest, bo jest kolorem marki i jego zadaniem jest wyróżniać, a nie
 * przechodzić progi w roli, której nie pełni.
 */
export const ACCENT_AUDIT = {
  graphic: "#cb7032",
  text: "#ab5517",
} as const;

/**
 * Sloty, które NIE MOGĄ wystąpić jako kategoria na wykresie kodującym znak
 * czerwienią - a wykres, na którym "strata" i "kategoria szósta" wyglądają
 * podobnie, nie da się odczytać.
 *
 * Trzy z nich są poniżej nawet progu rozszerzonego, czyli nieodróżnialne dla
 * części odbiorców wprost: terakota (5,45 w najgorszym rodzaju widzenia),
 * oliwka (5,45) i mech. Pozostałe siedzą między progiem rozszerzonym
 * a bezpiecznym. Lista jest LICZONA przez bramkę z palety, nie przepisana:
 * po podmianie kolorów urosła z jednego slotu do dziewięciu i to jest cena
 * palety, w której czerwienie i pomarańcze zajmują dużą część koła.
 */
/**
 * Sloty, których WYPEŁNIENIE samo nie przechodzi progu grafiki na własnej
 * płycie, więc kształt musi z nich nieść obwódka `--chart-N-edge`.
 *
 * To nie jest defekt palety, tylko konsekwencja tego, czym te kolory są: to
 * kolory marki i pastele zadane wprost, a nie odcienie dobrane pod próg 3:1.
 * Token zostaje dokładnie taki, jak zadano - bo po to jest - a `barFillOf`
 * dociąga obwódkę do progu niezależnie od tego, ile kroków jasności to wymaga
 * (dla #FFDAB3 jest to 0,24 wobec bazowych 0,09). Dlatego reguła brzmi: seria
 * w tym slocie NIGDY nie jest samą linią ani samym markerem bez obwódki.
 */
/**
 * Sloty, których RAMPA GRADIENTU jest ściśnięta przez gamut, więc krok
 * token/lico nie mieści się w EDGE_FACE_RANGE.
 *
 * Wszystkie cztery to tokeny ciemnego motywu o jasności powyżej 0,89 (#92eeff,
 * #fff07d, #ffdab3, #ffd3b6): rampa ma iść OD tła, czyli w górę jasności,
 * a tam już nic nie ma. Rampa zostaje monotoniczna - tyle, ile zostało
 * miejsca - a korytarz kroku przestaje obowiązywać. Lista stoi tutaj, żeby
 * bramka dalej pilnowała korytarza dla pozostałych pięćdziesięciu wyprowadzeń,
 * zamiast zostać rozluźniona dla wszystkich.
 */
export const SLOTS_WITH_COMPRESSED_RAMP = {
  light: [] as readonly number[],
  dark: [5, 15, 22, 24] as readonly number[],
} as const;

export const SLOTS_NEEDING_EDGE_FOR_SHAPE = {
  light: [2, 5, 15, 18, 19, 22, 23, 24, 26] as readonly number[],
  dark: [25] as readonly number[],
} as const;

/**
 * Sloty, w których odcień serii przesuwa się między motywami MOCNIEJ niż
 * o dopuszczalne 10 stopni w CIELAB, wraz ze zmierzoną wartością.
 *
 * Wszystkie cztery są wyborem autorskim: obie wartości pary zostały zadane
 * wprost, a przesunięcie jest ich własnością, nie błędem wyprowadzenia.
 * Lista stoi tutaj, żeby bramka dalej pilnowała reguły dla pozostałych
 * dwudziestu trzech slotów, zamiast zostać wyłączona dla wszystkich.
 */
export const HUE_PARITY_EXCEPTIONS: Readonly<Record<number, number>> = {
  1: 12.6,
  4: 22.0,
  8: 11.7,
  9: 17.0,
};

export const SLOTS_CLASHING_WITH_SIGN: readonly number[] = [3, 6, 8, 10, 12, 17, 24, 26, 27];

/**
 * Sloty, które nie mogą wystąpić, gdy w użyciu jest pomarańczowy akcent marki.
 * Slot 2 jest tu z powodu, który widać gołym okiem: `--chart-2` to teraz
 * #FA9346, a akcent to #ed751a - dwa pomarańcze o tej samej rodzinie odcienia.
 * Ta lista jest liczona z palety, nie pamiętana, więc przesuwa się razem z nią.
 *
 * Ta stała jest FAKTEM PALETY dla bramki, nie regułą dla edytora. Silnik nie
 * daje autorowi żadnej drogi wprowadzenia akcentu do wykresu jako koloru
 * danych (`--chart-accent` służy wyłącznie obwódce fokusu), więc ostrzeżenie
 * w edytorze odpalałoby się przy każdym użyciu slotu z listy. Gdyby akcent
 * kiedykolwiek stał się kolorem danych, ostrzeżenie wraca i bierze warunek
 * z tego, co go włącza.
 */
export const SLOTS_CLASHING_WITH_ACCENT: readonly number[] = [2, 3, 12];

// ---------------------------------------------------------------------------
// Kolorymetria. Czyste funkcje, bez DOM - działają w SSR i w teście.
// ---------------------------------------------------------------------------

/** #rgb / #rrggbb -> [0..255, 0..255, 0..255]. Rzuca na niepoprawnym zapisie. */
export function parseHex(hex: string): [number, number, number] {
  const raw = hex.trim().replace(/^#/, "");
  const full =
    raw.length === 3
      ? raw
          .split("")
          .map((c) => c + c)
          .join("")
      : raw;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) throw new Error(`nie jest kolorem hex: ${hex}`);
  return [
    Number.parseInt(full.slice(0, 2), 16),
    Number.parseInt(full.slice(2, 4), 16),
    Number.parseInt(full.slice(4, 6), 16),
  ];
}

function toChannel(value: number): string {
  return Math.max(0, Math.min(255, Math.round(value)))
    .toString(16)
    .padStart(2, "0");
}

export function formatHex(rgb: readonly [number, number, number]): string {
  return `#${rgb.map(toChannel).join("")}`;
}

/** Kanał sRGB -> liniowy (gamma WCAG 2.x). */
function linearize(channel: number): number {
  const s = channel / 255;
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

export function relativeLuminance(hex: string): number {
  const [r, g, b] = parseHex(hex).map(linearize);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Kontrast WCAG 2.x. Symetryczny, zawsze >= 1. */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/**
 * Kolor złożony na tle przy danym kryciu (alfa). Potrzebne, żeby policzyć
 * kontrast pasma prognozy - pasmo to seria przy kilku procentach krycia, a nie
 * osobny odcień.
 */
export function compositeOver(foreground: string, background: string, alpha: number): string {
  const fg = parseHex(foreground);
  const bg = parseHex(background);
  return formatHex([
    fg[0] * alpha + bg[0] * (1 - alpha),
    fg[1] * alpha + bg[1] * (1 - alpha),
    fg[2] * alpha + bg[2] * (1 - alpha),
  ]);
}

/**
 * Macierze Machado, Oliveira i Fernandes (2009) przy pełnym nasileniu.
 * Model fizjologiczny (przesunięcie czułości czopków), nie "usuń kanał
 * czerwony" - dlatego symulacja nie robi z czerwieni czerni, tylko odcień
 * bliski ochrze, co jest tym, co osoba z protanopią naprawdę widzi.
 */
const CVD_MATRIX: Record<CvdKind, readonly [number[], number[], number[]]> = {
  protan: [
    [0.152286, 1.052583, -0.204868],
    [0.114503, 0.786281, 0.099216],
    [-0.003882, -0.048116, 1.051998],
  ],
  deutan: [
    [0.367322, 0.860646, -0.227968],
    [0.280085, 0.672501, 0.047413],
    [-0.01182, 0.04294, 0.968881],
  ],
  tritan: [
    [1.255528, -0.076749, -0.178779],
    [-0.078411, 0.930809, 0.147602],
    [0.004733, 0.691367, 0.3039],
  ],
};

/** Jak dany odcień widzi osoba z tym rodzajem daltonizmu. */
export function simulateCvd(hex: string, kind: CvdKind): string {
  const m = CVD_MATRIX[kind];
  const [r, g, b] = parseHex(hex);
  return formatHex([
    m[0][0] * r + m[0][1] * g + m[0][2] * b,
    m[1][0] * r + m[1][1] * g + m[1][2] * b,
    m[2][0] * r + m[2][1] * g + m[2][2] * b,
  ]);
}

/** sRGB -> CIELAB (D65). */
export function labOf(hex: string): [number, number, number] {
  const [r, g, b] = parseHex(hex).map(linearize);
  const x = (0.4124564 * r + 0.3575761 * g + 0.1804375 * b) / 0.95047;
  const y = 0.2126729 * r + 0.7151522 * g + 0.072175 * b;
  const z = (0.0193339 * r + 0.119192 * g + 0.9503041 * b) / 1.08883;
  const f = (t: number): number => (t > 216 / 24389 ? Math.cbrt(t) : (841 / 108) * t + 4 / 29);
  const [fx, fy, fz] = [f(x), f(y), f(z)];
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

/** Odległość CIE76 w CIELAB. */
export function deltaE76(a: string, b: string): number {
  const la = labOf(a);
  const lb = labOf(b);
  return Math.hypot(la[0] - lb[0], la[1] - lb[1], la[2] - lb[2]);
}

/** Odległość dwóch odcieni WIDZIANA przez osobę z danym daltonizmem. */
export function cvdDistance(a: string, b: string, kind: CvdKind): number {
  return deltaE76(simulateCvd(a, kind), simulateCvd(b, kind));
}

export interface ClosestPair {
  distance: number;
  pair: [string, string];
}

/**
 * Najbliższa para w zestawie po symulacji - to ona decyduje o czytelności
 * całości, bo wykres jest tak czytelny, jak jego najgorsza para.
 */
export function minPairwiseCvdDistance(
  hexes: readonly string[],
  kind: CvdKind,
): ClosestPair | null {
  let closest: ClosestPair | null = null;
  for (let i = 0; i < hexes.length; i++) {
    for (let j = i + 1; j < hexes.length; j++) {
      const distance = cvdDistance(hexes[i], hexes[j], kind);
      if (!closest || distance < closest.distance) {
        closest = { distance, pair: [hexes[i], hexes[j]] };
      }
    }
  }
  return closest;
}

/** Wypełnienia serii dla motywu - w kolejności slotów. */
export function seriesColors(theme: ChartThemeName, count = SLOT_SEQUENCE.length): string[] {
  return SLOT_SEQUENCE.slice(0, count).map((slot) =>
    theme === "dark" ? slotAt(slot).dark : slotAt(slot).light,
  );
}

/** Warianty tekstowe serii dla motywu - w KOLEJNOŚCI PRZYPISANIA, nie numerów. */
export function seriesTextColors(theme: ChartThemeName, count = SLOT_SEQUENCE.length): string[] {
  return SLOT_SEQUENCE.slice(0, count).map((slot) =>
    theme === "dark" ? slotAt(slot).textDark : slotAt(slot).textLight,
  );
}

/** Slot po numerze; poza zakresem zawija się na paletę. */
export function slotAt(slot: number): PaletteSlot {
  const index =
    (((Math.round(slot) - 1) % CHART_SLOTS.length) + CHART_SLOTS.length) % CHART_SLOTS.length;
  return CHART_SLOTS[index];
}

/**
 * Numer slotu dla serii o danej POZYCJI na liście, gdy autor slotu nie zapisał.
 *
 * Idzie po SLOT_SEQUENCE, nie po numerach: pierwsza seria dostaje najlepiej
 * rozdzielny kolor palety, a nie ten, który przypadkiem ma numer 1. Pozycja
 * poza długością sekwencji zawija - tak samo, jak zawijał dawny `(i % 8) + 1`.
 */
export function slotForSeries(position: number): number {
  const i = Math.max(0, Math.round(position));
  return SLOT_SEQUENCE[i % SLOT_SEQUENCE.length];
}

/**
 * Czy slot leży poza zestawem BEZPIECZNYM palety. Odpowiada na pytanie o slot,
 * nie o wykres - do rozstrzygnięcia, czy KONKRETNY rysunek potrzebuje drugiego
 * nośnika różnicy, służy `slotsNeedingPattern`.
 */
export function needsPatternDifferentiator(slot: number): boolean {
  return !slotAt(slot).cvdSafe;
}

/**
 * Które sloty UŻYTE NA TYM WYKRESIE potrzebują kreskowania.
 *
 * Pytanie "czy slot jest bezpieczny" było dobrym przybliżeniem, dopóki serie
 * brały sloty po kolei: zestaw użyty na wykresie był wtedy zawsze prefiksem
 * palety. Odkąd autor wybiera numery ręcznie z dwudziestu siedmiu, przybliżenie
 * zaczyna kłamać w obie strony - wykres na slotach 1 i 2 dostałby kreskowanie,
 * choć granat i pomarańcz różnią się o kilkadziesiąt jednostek, a wykres na
 * dwóch slotach bezpiecznych z różnych par mógłby go nie dostać wcale.
 *
 * Dlatego liczymy to, o co naprawdę chodzi: PARY faktycznie użyte. Slot trafia
 * na listę, gdy stoi w parze, która w którymkolwiek motywie i którymkolwiek
 * rodzaju widzenia barw schodzi pod CVD_FLOOR.extended - czyli gdy sam odcień
 * przestaje tę parę rozdzielać.
 */
export function slotsNeedingPattern(slots: readonly number[]): ReadonlySet<number> {
  const uzyte = [...new Set(slots.map((s) => slotAt(s).slot))];
  const wymaga = new Set<number>();
  // Kreskowanie dostaje PÓŹNIEJSZY slot kolidującej pary, nie oba: żeby
  // rozdzielić dwa kształty, wystarczy, że jeden z nich ma drugi nośnik
  // różnicy. Kreskowanie obu byłoby dwoma wzorami tam, gdzie wystarczy jeden,
  // i odbierałoby wykresowi spokój bez zysku dla czytelności.
  for (let i = 1; i < uzyte.length; i += 1) {
    const b = slotAt(uzyte[i]);
    for (let j = 0; j < i; j += 1) {
      const a = slotAt(uzyte[j]);
      const ponizej = CVD_KINDS.some(
        (kind) =>
          cvdDistance(a.light, b.light, kind) < CVD_FLOOR.extended[kind] ||
          cvdDistance(a.dark, b.dark, kind) < CVD_FLOOR.extended[kind],
      );
      if (ponizej) {
        wymaga.add(b.slot);
        break;
      }
    }
  }
  return wymaga;
}

// ---------------------------------------------------------------------------
// OKLCh i WYPEŁNIENIA SŁUPKÓW
//
// PO CO OSOBNA PRZESTRZEŃ BARW, GDY WYŻEJ JEST JUŻ CIELAB. CIELAB służy tu do
// MIERZENIA odległości (czy dwa odcienie są rozdzielne po symulacji
// daltonizmu). OKLCh służy do WYPROWADZANIA odcieni pochodnych: krok jasności
// przy zachowanej chromie i odcieniu. To dwie różne role i żadna z tych
// przestrzeni nie robi dobrze obu - CIE76 w Lab jest przyzwoitą miarą
// różnicy, ale krok jasności w Lab przesuwa też postrzegany odcień.
//
// DLACZEGO NIE MIESZANIE Z TUSZEM, którego ten silnik używał wcześniej.
// Mieszanie z neutralną prawie czernią obniża nie tylko jasność, ale i chromę,
// do 0,56-0,65x chromy tokena. Wynik nie jest głębszą wersją koloru, tylko
// ZABRUDZONĄ - a zabrudzony ciemny czyta się cięższy niż nasycony ciemny
// o tej samej luminancji. Gorzej: mieszanie procentowe bije najmocniej
// w odcienie o najniższym kontraście (ochra schodziła do 2,15x własnego
// kontrastu, granat tylko do 1,47x), czyli najjaśniejsze odcienie palety
// ciemniały najbardziej - odwrotnie, niż powinno. Krok w OKLCh przy stałej
// chromie daje jednolite 1,40-1,48x w motywie jasnym i 1,35-1,43x w ciemnym.
// ---------------------------------------------------------------------------

/** Macierze OKLab (Björn Ottosson). Liniowy sRGB -> LMS -> Lab. */
const LIN_TO_LMS = [
  [0.4122214708, 0.5363325363, 0.0514459929],
  [0.2119034982, 0.6806995451, 0.1073969566],
  [0.0883024619, 0.2817188376, 0.6299787005],
] as const;
const LMS_TO_LAB = [
  [0.2104542553, 0.793617785, -0.0040720468],
  [1.9779984951, -2.428592205, 0.4505937099],
  [0.0259040371, 0.7827717662, -0.808675766],
] as const;
const LAB_TO_LMS = [
  [1, 0.3963377774, 0.2158037573],
  [1, -0.1055613458, -0.0638541728],
  [1, -0.0894841775, -1.291485548],
] as const;
const LMS_TO_LIN = [
  [4.0767416621, -3.3077115913, 0.2309699292],
  [-1.2684380046, 2.6097574011, -0.3413193965],
  [-0.0041960863, -0.7034186147, 1.707614701],
] as const;

function srgbToLinear(channel: number): number {
  const c = channel / 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function linearToSrgb(value: number): number {
  const c = Math.max(0, Math.min(1, value));
  return (c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055) * 255;
}

/** Współrzędne OKLCh: jasność 0..1, chroma bezwzględna, kąt odcienia w stopniach. */
export interface Oklch {
  l: number;
  c: number;
  h: number;
}

export function oklchOf(hex: string): Oklch {
  const [r, g, b] = parseHex(hex).map(srgbToLinear) as [number, number, number];
  const lms = LIN_TO_LMS.map((row) => row[0] * r + row[1] * g + row[2] * b);
  const cbrt = lms.map((v) => Math.cbrt(v));
  const lab = LMS_TO_LAB.map((row) => row[0] * cbrt[0] + row[1] * cbrt[1] + row[2] * cbrt[2]);
  const [l, a, bb] = lab as [number, number, number];
  return { l, c: Math.hypot(a, bb), h: ((Math.atan2(bb, a) * 180) / Math.PI + 360) % 360 };
}

function linearFromOklch(l: number, c: number, h: number): [number, number, number] {
  const rad = (h * Math.PI) / 180;
  const a = c * Math.cos(rad);
  const b = c * Math.sin(rad);
  const lms = LAB_TO_LMS.map((row) => row[0] * l + row[1] * a + row[2] * b).map((v) => v ** 3);
  return LMS_TO_LIN.map((row) => row[0] * lms[0] + row[1] * lms[1] + row[2] * lms[2]) as [
    number,
    number,
    number,
  ];
}

/**
 * OKLCh -> hex, z MAPOWANIEM DO GAMUTU przez obniżanie chromy.
 *
 * Tak samo, jak robi to składnia CSS `oklch(from ... )`: gdy chroma tokena nie
 * mieści się w sRGB po zmianie jasności, obniżamy NASYCENIE, a trzymamy jasność
 * i odcień. Odwrotna kolejność (przycięcie kanałów) zmienia odcień, czyli
 * seria po zmianie jasności przestawałaby być tą samą serią - a reguła trybów
 * mówi, że ten sam szereg zachowuje ten sam odcień.
 */
export function fromOklch(l: number, c: number, h: number): string {
  const inside = (chroma: number): boolean =>
    linearFromOklch(l, chroma, h).every((v) => v >= -1e-4 && v <= 1 + 1e-4);
  let chroma = c;
  if (!inside(chroma)) {
    let lo = 0;
    let hi = c;
    for (let i = 0; i < 60; i++) {
      const mid = (lo + hi) / 2;
      if (inside(mid)) lo = mid;
      else hi = mid;
    }
    chroma = lo;
  }
  const rgb = linearFromOklch(l, chroma, h).map(linearToSrgb) as [number, number, number];
  return formatHex(rgb);
}

/**
 * Warianty wypełnienia słupka. Domyślny jest BLADY, i to nie jest kwestia
 * gustu: obwódka niesie całą granicę kształtu (a więc odczyt wartości),
 * a blade wnętrze zostawia miejsce na liczbę WEWNĄTRZ słupka.
 */
export const BAR_STYLES = ["pale", "gradient", "solid"] as const;
export type BarStyle = (typeof BAR_STYLES)[number];

/**
 * Stałe wyprowadzenia, per motyw.
 *
 * JASNY IDZIE WPROST ZE SPECYFIKACJI. CIEMNY JEST PRZELICZONY, i to jest
 * jedyne odstępstwo w całym module - specyfikacja liczy motyw ciemny wobec
 * płyty `#1C1B1B`, a płyta tego repozytorium to `#0f0f0f` (token `--card`).
 * Przepisanie jej liczb wprost dałoby blade wnętrza o kontraście 1,34-1,43:1
 * zamiast docelowych 1,20-1,28:1 - czyli wnętrze zaczęłoby czytać się jako
 * ELEMENT, a nie jako powierzchnia, tracąc dokładnie tę własność, którą
 * specyfikacja mu wyznacza. Jasność wnętrza i hoveru jest więc rozwiązana dla
 * prawdziwej płyty; kroki jasności obwódki i rampy zostają bez zmian, bo one
 * są liczone wobec TOKENA, nie wobec płyty, i płyta ich nie dotyczy.
 */
export const BAR_FILL_PARAMS = {
  light: {
    /** Krok jasności obwódki wariantu bladego - ODCHODZI od tła. */
    dlEdge: -0.09,
    /** Jasność i mnożnik chromy bladego wnętrza. */
    lInner: 0.93,
    cInner: 0.5,
    /** To samo dla stanu pod kursorem: jeden stopień w stronę nasycenia. */
    lHover: 0.88,
    cHover: 0.66,
    /** Trzy stopnie rampy wariantu gradientowego. */
    dlDeep: -0.09,
    dlMid: -0.06,
    dlFace: -0.034,
    /** Grubość obwódki. Jasna linia na ciemnym tle optycznie grubieje. */
    edgeWidth: 1.5,
  },
  dark: {
    dlEdge: 0.09,
    lInner: 0.264,
    cInner: 0.55,
    lHover: 0.32,
    cHover: 0.64,
    dlDeep: 0.09,
    dlMid: 0.06,
    dlFace: 0.034,
    edgeWidth: 1.25,
  },
} as const;

/** Sześć odcieni pochodnych jednego tokena serii. */
export interface BarFill {
  /** Obwódka wariantu bladego: krok jasności odchodzący od tła. */
  edge: string;
  /** Blade wnętrze: OSOBNY odcień, nie token pod alfą. */
  inner: string;
  /** Wnętrze pod kursorem: jeden stopień w stronę nasycenia. */
  hover: string;
  /** Rampa wariantu gradientowego, od krawędzi odniesienia do końca danych. */
  deep: string;
  mid: string;
  face: string;
}

/**
 * Wyprowadzenie wszystkich sześciu odcieni pochodnych z jednego tokena.
 *
 * BLADE WNĘTRZE JEST OSOBNYM ODCIENIEM, NIE TOKENEM POD ALFĄ, i ta różnica
 * jest praktyczna, nie doktrynalna: token pod alfą przepuszcza to, co leży pod
 * słupkiem - siatkę, strefę prognozy, drugi słupek w grupie - i wnętrze
 * przestaje być jednolite. Osobny odcień jest kryjący.
 *
 * KROKI SĄ ADAPTACYJNE, i to jest cała różnica wobec pierwszej wersji.
 * Stały krok jasności działa tylko wtedy, gdy wszystkie tokeny leżą w wąskim
 * pasie jasności - przy palecie, w której obok siebie stoi #232C31 (L 0,29)
 * i #f7dd14 (L 0,89), ten sam krok daje raz korytarz, raz wartość poza nim,
 * bo kontrast nie jest liniowy w jasności. Dlatego krok bazowy z
 * `BAR_FILL_PARAMS` jest tu krokiem DOMYŚLNYM: jeśli trafia w korytarz,
 * zostaje dokładnie taki (dla dziesięciu slotów serii i dla semantyki jest
 * tożsamością), a jeśli nie trafia, rośnie albo maleje do najbliższego, który
 * trafia. Obwódka ma warunek własny i mocniejszy: ma przechodzić próg grafiki
 * ZAWSZE, bo to z niej odczytuje się kształt, gdy wypełnienie jest blade albo
 * gdy token marki nie dociąga do 3:1 samodzielnie.
 */
export function barFillOf(base: string, theme: ChartThemeName): BarFill {
  const p = BAR_FILL_PARAMS[theme];
  const { l, c, h } = oklchOf(base);
  const plate = CHART_PLATE[theme];
  /** Kierunek "od tła": na jasnej płycie w dół, na ciemnej w górę. */
  const zwrot = theme === "light" ? -1 : 1;
  const oKrok = (krok: number) => fromOklch(l + zwrot * krok, c, h);

  // LICO: krok, przy którym kontrast token/lico wpada w korytarz widoczności
  // krawędzi na końcu danych. Rampa deep/mid trzyma stałe proporcje wobec lica.
  const wKorytarzuLica = (krok: number) => {
    const r = contrastRatio(base, oKrok(krok));
    return r >= EDGE_FACE_RANGE.min && r <= EDGE_FACE_RANGE.max;
  };
  const krokBazowyLica = Math.abs(p.dlFace);
  let krokLica = krokBazowyLica;
  if (!wKorytarzuLica(krokLica)) {
    let najblizszy = krokLica;
    let najmniejszaOdleglosc = Infinity;
    for (let k = 0.01; k <= 0.3; k += 0.001) {
      if (!wKorytarzuLica(k)) continue;
      const odleglosc = Math.abs(k - krokBazowyLica);
      if (odleglosc < najmniejszaOdleglosc) {
        najmniejszaOdleglosc = odleglosc;
        najblizszy = k;
      }
    }
    krokLica = najblizszy;
  }
  const proporcjaDeep = Math.abs(p.dlDeep / p.dlFace);
  const proporcjaMid = Math.abs(p.dlMid / p.dlFace);
  // SUFIT RAMPY. Token tak jasny jak #fff07d (L 0,944) nie ma na ciemnej
  // płycie dokąd się rozjaśniać: pełna rampa wyszłaby poza gamut i trzy jej
  // stopnie skleiłyby się w biel, czyli gradient przestałby być gradientem.
  // Wtedy rampa jest ŚCIŚNIĘTA do tego, co zostało - monotoniczność zostaje,
  // korytarz kroku token/lico nie, i to drugie jest wypisane w bramce jako
  // lista slotów, a nie schowane pod rozluźnionym progiem.
  const zapasJasnosci = theme === "light" ? l - 0.015 : 0.985 - l;
  krokLica = Math.min(krokLica, Math.max(0.004, zapasJasnosci / proporcjaDeep));

  // OBWÓDKA: co najmniej krok bazowy, a gdy przy nim nie ma progu grafiki -
  // tyle, ile go daje. Nigdy słabsza niż krok bazowy, bo to by odwracało sens.
  let krokObwodki = Math.abs(p.dlEdge);
  for (let k = Math.abs(p.dlEdge); k <= 0.6; k += 0.005) {
    krokObwodki = k;
    if (contrastRatio(oKrok(k), plate) >= CONTRAST_MIN.graphic + 0.02) break;
  }

  // WNĘTRZE i HOVER stoją na STAŁEJ jasności - regulowana jest chroma, bo to
  // ona decyduje, gdzie w korytarzu wyląduje kontrast do płyty.
  let mnoznikWnetrza = p.cInner;
  for (let i = 0; i < 60; i += 1) {
    const r = contrastRatio(fromOklch(p.lInner, c * mnoznikWnetrza, h), plate);
    if (r >= INNER_CONTRAST_RANGE.min && r <= INNER_CONTRAST_RANGE.max) break;
    mnoznikWnetrza *= r > INNER_CONTRAST_RANGE.max ? 0.94 : 1.06;
  }
  const inner = fromOklch(p.lInner, c * mnoznikWnetrza, h);
  // HOVER ma dwa warunki naraz (kontrast do płyty i skok wobec spokoju), więc
  // sama chroma czasem nie wystarcza - przy zieleni #58a537 jasność 0,88 daje
  // 1,34:1 niezależnie od nasycenia. Regulujemy więc obie wielkości: najpierw
  // chromę, a gdy to nie domyka, jasność w stronę płyty.
  let mnoznikHover = p.cHover;
  let jasnoscHover = p.lHover;
  const ocenHover = () => {
    const kandydat = fromOklch(jasnoscHover, c * mnoznikHover, h);
    const doPlyty = contrastRatio(kandydat, plate);
    const skok = contrastRatio(kandydat, inner);
    return {
      zaMocno: doPlyty > HOVER_CONTRAST_RANGE.max || skok > HOVER_STEP_RANGE.max,
      zaSlabo: doPlyty < HOVER_CONTRAST_RANGE.min || skok < HOVER_STEP_RANGE.min,
    };
  };
  for (let i = 0; i < 60; i += 1) {
    const { zaMocno, zaSlabo } = ocenHover();
    if (!zaMocno && !zaSlabo) break;
    mnoznikHover *= zaMocno ? 0.94 : 1.06;
  }
  for (let i = 0; i < 120; i += 1) {
    const { zaMocno, zaSlabo } = ocenHover();
    if (!zaMocno && !zaSlabo) break;
    const krok = theme === "light" ? 0.004 : -0.004;
    jasnoscHover += zaSlabo ? -krok : krok;
    if (jasnoscHover <= 0.05 || jasnoscHover >= 0.99) break;
  }

  return {
    edge: oKrok(krokObwodki),
    inner,
    hover: fromOklch(jasnoscHover, c * mnoznikHover, h),
    deep: oKrok(krokLica * proporcjaDeep),
    mid: oKrok(krokLica * proporcjaMid),
    face: oKrok(krokLica),
  };
}

/**
 * Korytarze, w których muszą wylądować odcienie pochodne. Bramka palety
 * sprawdza je wobec PRAWDZIWEJ płyty każdego motywu, więc zmiana `--card`
 * zapala test, zamiast po cichu przesunąć wszystkie wypełnienia.
 */
export const INNER_CONTRAST_RANGE = { min: 1.2, max: 1.28 } as const;
export const HOVER_CONTRAST_RANGE = { min: 1.4, max: 1.55 } as const;
/** Skok spokój -> hover: wyczuwalny, ale nie zmieniający wagi wykresu. */
export const HOVER_STEP_RANGE = { min: 1.15, max: 1.22 } as const;
/**
 * Krok token/lico w wariancie gradientowym - widoczność krawędzi
 * w najtrudniejszym miejscu, czyli na końcu danych.
 */
export const EDGE_FACE_RANGE = { min: 1.12, max: 1.16 } as const;

/**
 * Rozstrzygnięcie wariantu wypełnienia dla CAŁEGO wykresu.
 *
 * Wariant blady jest domyślny, ale ma warunek, bez którego staje się defektem:
 * BLADE WNĘTRZE NIE NIESIE TOŻSAMOŚCI SERII. Przy jasności 0,93 odległość
 * CIELAB między bladymi wypełnieniami spada do 1,1 przy widzeniu normalnym
 * i praktycznie do zera po symulacji daltonizmu, podczas gdy podłoga palety
 * serii to 24. Przy jednej serii to nie szkodzi, bo tożsamość niesie obwódka,
 * a wnętrze tylko wypełnia kształt. Przy kilku seriach obok siebie albo
 * w stosie czytelnik dostałby kilka kształtów o tym samym wnętrzu.
 *
 * Dlatego reguła schodzi do SOLIDNEGO, a nie ostrzega i rysuje dalej:
 *
 *  - kilka serii albo stos - wnętrze musi kryć kolorem, bo nie ma osi, do
 *    której można by przypiąć każdy segment osobno;
 *  - slot poza zestawem bezpiecznym dla daltonizmu (7-8) - jego drugim
 *    nośnikiem różnicy jest kreskowanie w kolorze PŁYTY, a paski w kolorze
 *    płyty nad wnętrzem o kontraście 1,2:1 są niewidoczne; kreskowanie czyta
 *    się tylko na nasyconym wypełnieniu.
 *
 * Wariant gradientowy przechodzi przez oba te warunki, bo jego wnętrze JEST
 * nasycone - dlatego obniżamy do solidnego tylko wtedy, gdy żądano bladego.
 */
export function resolveBarStyle(
  requested: BarStyle,
  ctx: { seriesCount: number; stacked: boolean; patterned: boolean; slots?: readonly number[] },
): BarStyle {
  // PALETA BAZOWA RYSUJE SIĘ SOLIDNIE, i to dotyczy OBU wariantów wnętrza,
  // nie tylko bladego. Powód stoi przy `BASE_PALETTE_FROM`: dla tokenów o
  // jasności bliskiej wnętrzu wariant blady jest wariantem z nazwy, a rampa
  // gradientu przy ściśniętym kroku (patrz SLOTS_WITH_COMPRESSED_RAMP) daje
  // trzy stopnie, których czytelnik nie odróżni. Solidne wypełnienie pokazuje
  // dokładnie ten kolor, który autor wybrał - a po to go wybierał.
  if (ctx.slots?.some((slot) => slotAt(slot).slot >= BASE_PALETTE_FROM)) return "solid";
  if (requested !== "pale") return requested;
  if (ctx.stacked || ctx.seriesCount > 1 || ctx.patterned) return "solid";
  return "pale";
}

/** Czy wariant rysuje obwódkę - od tego zależy wsunięcie kształtu i podłoga promienia. */
export function barStyleHasEdge(style: BarStyle): boolean {
  return style !== "solid";
}
