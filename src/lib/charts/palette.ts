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
 * Ile slotów wolno użyć jako KATEGORII, żeby zestaw pozostał rozdzielny dla
 * każdego rodzaju widzenia barw. Sześć, i to nie jest liczba z zaokrąglenia:
 * przeszukanie całej przestrzeni sRGB pokazało, że dla palety ciemnej NIE
 * ISTNIEJE siódmy odcień, który utrzymałby podłogę 24,4 przy kontraście >=3:1
 * na płycie (zero kandydatów), a dla jasnej utrzymują ją wyłącznie brązy i
 * ciemne czerwienie, czyli odcienie zajęte przez semantykę znaku.
 * Sloty 7 i 8 istnieją dla zgodności z zapisanymi konfiguracjami (patrz
 * MAX_SERIES) i mają WŁASNĄ, niższą podłogę - patrz CVD_FLOOR.
 */
export const CATEGORICAL_SAFE_MAX = 6;

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
 * Podłoga odległości barw po symulacji. Dwa różne progi, bo to dwa różne
 * zestawy: `safe` to sloty 1..CATEGORICAL_SAFE_MAX (paleta właściwa),
 * `extended` to wszystkie osiem razem (sloty 7-8 są rozszerzeniem poza
 * dyscyplinę sześciu kolorów i tego nie ukrywamy).
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
  /** Numer slotu 1..8 - ta liczba jest ZAPISANA w konfiguracjach wykresów. */
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
 * Sloty w KOLEJNOŚCI PRZYPISANIA. Kolejność jest mechanizmem bezpieczeństwa,
 * nie estetyką: serie biorą sloty sekwencyjnie 1, 2, 3..., więc dwa pierwsze
 * odcienie to najczęstsza para na świecie i muszą być najdalej od siebie.
 * Granat i ochra rozchodzą się jednocześnie w jasności i w odcieniu, czyli
 * różnią się nawet w skali szarości.
 */
export const CHART_SLOTS: readonly PaletteSlot[] = [
  {
    slot: 1,
    key: "granat",
    light: "#00528f",
    dark: "#287fd2",
    textLight: "#00528f",
    textDark: "#649be7",
    // Wypełnienie granatu jest za ciemne dla ciemnego tuszu (2,25:1), więc
    // etykieta w środku wycinka idzie bielą.
    inkLight: "#ffffff",
    // W motywie ciemnym granat rozjaśnia się do #287fd2 i wtedy ŻADEN z tuszów
    // roboczych nie przechodzi progu 4,5:1 (#12161c daje 4,37:1, biel 4,15:1).
    // Czerń pełna daje 5,06:1 - to jedyny slot w całej palecie, który jej
    // wymaga, i dlatego stoi tu wprost, a nie przez token tuszu.
    inkDark: "#000000",
    bandLight: 0.08,
    bandDark: 0.14,
    cvdSafe: true,
  },
  {
    slot: 2,
    key: "ochra",
    light: "#c6871f",
    dark: "#eda946",
    // Ochra jako linia ma 3,05:1 i jest w porządku; jako TEKST nie przechodzi
    // 4,5:1, więc podpisy biorą wariant przyciemniony. To najczęstszy błąd
    // w wykresach: etykieta pisana kolorem linii wygląda spójnie i nie
    // przechodzi audytu dostępności.
    textLight: "#a26900",
    textDark: "#eda946",
    inkLight: "#12161c",
    inkDark: "#12161c",
    bandLight: 0.13,
    bandDark: 0.09,
    cvdSafe: true,
  },
  {
    slot: 3,
    key: "szalwia",
    light: "#679675",
    dark: "#94b99e",
    textLight: "#507f5f",
    textDark: "#94b99e",
    inkLight: "#12161c",
    inkDark: "#12161c",
    bandLight: 0.13,
    bandDark: 0.09,
    cvdSafe: true,
  },
  {
    slot: 4,
    key: "sliwka",
    light: "#815579",
    dark: "#ad74a2",
    textLight: "#815579",
    textDark: "#b78dae",
    inkLight: "#ffffff",
    inkDark: "#12161c",
    bandLight: 0.09,
    bandDark: 0.12,
    cvdSafe: true,
  },
  {
    slot: 5,
    key: "lazur",
    light: "#0e90be",
    dark: "#4ac1f7",
    textLight: "#007daa",
    textDark: "#4ac1f7",
    inkLight: "#12161c",
    inkDark: "#12161c",
    bandLight: 0.11,
    bandDark: 0.09,
    cvdSafe: true,
  },
  {
    slot: 6,
    key: "terakota",
    light: "#b05125",
    dark: "#c96536",
    textLight: "#b05125",
    textDark: "#dd8156",
    inkLight: "#ffffff",
    inkDark: "#12161c",
    bandLight: 0.1,
    bandDark: 0.13,
    cvdSafe: true,
  },
  {
    // ---- Sloty 7 i 8: ROZSZERZENIE, nie paleta. ----
    // Osiem odcieni rozdzielnych dla wszystkich trzech rodzajów daltonizmu
    // w tej rodzinie NIE ISTNIEJE (przeszukanie sRGB: dla motywu ciemnego zero
    // kandydatów utrzymujących podłogę 24,4). Te dwa sloty zostają, bo numer
    // slotu jest ZAPISANY w treści (bloki CMS, CSV widgetów) i cztery miejsca
    // w kodzie liczą `(i % 8) + 1`; brak tokenu daje tam czarne wypełnienie
    // albo niewidoczną kreskę, czyli awarię gorszą niż niska odległość barw.
    // Podłoga całego zestawu ośmiu spada do ~10 (jasny) i ~15,5 (ciemny) -
    // pilnuje jej OSOBNY, niższy próg CVD_FLOOR.extended, a silnik dokłada
    // tym seriom kreskowanie jako drugi nośnik różnicy.
    slot: 7,
    key: "indygo",
    light: "#4b57b7",
    dark: "#7384c5",
    textLight: "#4b57b7",
    textDark: "#7384c5",
    inkLight: "#ffffff",
    inkDark: "#12161c",
    bandLight: 0.09,
    bandDark: 0.12,
    cvdSafe: false,
  },
  {
    slot: 8,
    key: "oliwka",
    light: "#455d00",
    dark: "#caca88",
    textLight: "#455d00",
    textDark: "#caca88",
    inkLight: "#ffffff",
    inkDark: "#12161c",
    bandLight: 0.09,
    bandDark: 0.08,
    cvdSafe: false,
  },
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
 * Sloty, które NIE MOGĄ wystąpić jako kategoria na wykresie kodującym znak
 * czerwienią. Terakota wobec czerwieni daje 15,9 / 22,1 / 16,7, czyli poniżej
 * podłogi palety - a wykres, na którym "strata" i "kategoria szósta" wyglądają
 * podobnie, nie da się odczytać.
 */
export const SLOTS_CLASHING_WITH_SIGN: readonly number[] = [6];

/**
 * Sloty, które nie mogą wystąpić, gdy w użyciu jest pomarańczowy akcent marki.
 * `#ed751a` wobec ochry `#c6871f` daje przy deuteranopii 1,6 - praktycznie ten
 * sam kolor.
 *
 * Ta stała jest FAKTEM PALETY dla bramki, nie regułą dla edytora. Silnik nie
 * daje autorowi żadnej drogi wprowadzenia akcentu do wykresu jako koloru
 * danych (`--chart-accent` służy wyłącznie obwódce fokusu), więc ostrzeżenie
 * w edytorze odpalałoby się przy każdym użyciu slotu 2 - a slot 2 jest
 * domyślnym kolorem drugiej serii. Gdyby akcent kiedykolwiek stał się kolorem
 * danych, ostrzeżenie wraca i bierze warunek z tego, co go włącza.
 */
export const SLOTS_CLASHING_WITH_ACCENT: readonly number[] = [2];

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
export function seriesColors(theme: ChartThemeName, count = CHART_SLOTS.length): string[] {
  return CHART_SLOTS.slice(0, count).map((s) => (theme === "dark" ? s.dark : s.light));
}

/** Warianty tekstowe serii dla motywu - w kolejności slotów. */
export function seriesTextColors(theme: ChartThemeName, count = CHART_SLOTS.length): string[] {
  return CHART_SLOTS.slice(0, count).map((s) => (theme === "dark" ? s.textDark : s.textLight));
}

/** Slot po numerze; poza zakresem zawija się na paletę (jak `(i % 8) + 1`). */
export function slotAt(slot: number): PaletteSlot {
  const index =
    (((Math.round(slot) - 1) % CHART_SLOTS.length) + CHART_SLOTS.length) % CHART_SLOTS.length;
  return CHART_SLOTS[index];
}

/** Czy seria w tym slocie potrzebuje drugiego nośnika różnicy (kreskowania). */
export function needsPatternDifferentiator(slot: number): boolean {
  return !slotAt(slot).cvdSafe;
}
