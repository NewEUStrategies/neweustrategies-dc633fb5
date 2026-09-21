// Formatowanie liczb wykresów - Intl per język (pl-PL / en-GB), spójne z
// konwencją domu (wersja EN po europejsku). Czyste funkcje, testowalne
// jednostkowo.

export type ChartLang = "pl" | "en";

/**
 * Język wykresu z kodu języka i18next.
 *
 * Jedno miejsce, bo warunek `startsWith("en")` stał już w trzech plikach
 * i przy czwartej kopii ktoś napisałby `=== "en"` - a i18next podaje tam
 * także "en-GB" i "en-US", więc wykres w brytyjskim angielskim wracałby po
 * cichu do polskiego formatowania liczb.
 */
export function chartLangFrom(language: string | undefined | null): ChartLang {
  return (language ?? "pl").startsWith("en") ? "en" : "pl";
}

function localeOf(lang: ChartLang): string {
  return lang === "en" ? "en-GB" : "pl-PL";
}

/**
 * Napis dla wartości, która NIE JEST LICZBĄ. Nie jest to ozdoba ani
 * nadmierna ostrożność - to osłona przed konkretnym, sprawdzonym zachowaniem
 * platformy: `Intl.NumberFormat` na `NaN` zwraca literalny napis "NaN",
 * a na nieskończoności "∞". Oba wyciekają do treści strony przez tooltip,
 * tabelę danych i etykiety bezpośrednie.
 *
 * BRAMKA, KTÓRA TO ŁAPIE, JUŻ ISTNIEJE:
 * `src/components/blocks/__tests__/blockMatrix.test.tsx` renderuje każdy typ
 * bloku w czterech stanach danych i sprawdza `textContent` na obecność
 * napisów "undefined", "NaN", "[object Object]" i "Invalid Date". Dopóki
 * wykres liczył wyłącznie sumy i różnice, `NaN` nie miał skąd się wziąć.
 * Rodzaje statystyczne to zmieniają: indeks przy wartości bazowej zero,
 * współczynnik determinacji przy zerowej wariancji, gęstość przy przedziale
 * zerowej szerokości - każde z nich jest dzieleniem, a każde dzielenie ma
 * mianownik, który w danych z arkusza autora może być zerem.
 *
 * Modele mają osłaniać mianowniki u siebie i zwracać `null` (konwencja repo:
 * "nie ma czego pokazać"), ale formatowanie jest OSTATNIĄ linią i musi
 * wytrzymać wartość, która przeszła wszystkie wcześniejsze. Kreska pauza jest
 * tym samym znakiem, którym tabela danych oznacza brak wartości, więc
 * czytelnik widzi spójny brak, a nie techniczny bełkot.
 */
const NIE_LICZBA = "-";

/** Czy wartość da się sformatować bez wyciekania "NaN" albo "∞" do treści. */
function skonczona(value: number): boolean {
  return typeof value === "number" && Number.isFinite(value);
}

/** Pełny format wartości (tooltip, tabela, etykiety bezpośrednie). */
export function formatChartValue(value: number, lang: ChartLang, unit = ""): string {
  // Brak jednostki przy wartości, której nie ma: "- mld EUR" sugerowałoby, że
  // wiemy, w czym mierzymy coś, czego nie znamy.
  if (!skonczona(value)) return NIE_LICZBA;
  const formatted = value.toLocaleString(localeOf(lang), {
    maximumFractionDigits: Math.abs(value) < 10 ? 2 : 1,
  });
  // SEPARATOR JEST CZĘŚCIĄ JEDNOSTKI i to jest kontrakt tej funkcji, nie
  // przeoczenie. Procent PRZYKLEJA się do liczby („60%"), a jednostka mianowana
  // wymaga spacji („1500 mld EUR") - więc o odstępie rozstrzyga WYWOŁUJĄCY,
  // podając jednostkę z wiodącą spacją albo bez niej. Żadna normalizacja tutaj
  // nie byłaby poprawna: doklejanie spacji zawsze zrobiłoby z „60%" napis
  // „60 %", a jej usuwanie z „1500 mld EUR" napis „1500mld EUR".
  //
  // Stał tu wcześniej `unit.startsWith(" ") ? unit : `${unit}`` - obie gałęzie
  // dawały ten sam napis, więc warunek był martwy, a przy tym SUGEROWAŁ
  // normalizację, której nie ma i mieć nie może. Wywołujący, który przyciął
  // jednostkę (`config.unit.trim()`), dostaje liczbę sklejoną z jednostką
  // i musi o tym wiedzieć z tego komentarza, a nie domyślać się z warunku.
  return unit ? `${formatted}${unit}` : formatted;
}

/** Zwięzły format osi (12 345 678 -> "12,3 mln" / "12.3M"). */
export function formatAxisTick(value: number, lang: ChartLang): string {
  if (!skonczona(value)) return NIE_LICZBA;
  const abs = Math.abs(value);
  if (abs >= 10_000) {
    const compact = value.toLocaleString(localeOf(lang), {
      notation: "compact",
      maximumFractionDigits: 1,
    });
    // en-GB kompaktuje miliony/miliardy małą literą ("12.5m") - na osiach
    // wykresów obowiązuje konwencja K/M/B/T, więc normalizujemy sufiks.
    return lang === "en" ? compact.replace(/([kmbt])$/, (s) => s.toUpperCase()) : compact;
  }
  return value.toLocaleString(localeOf(lang), { maximumFractionDigits: 2 });
}

/** Udział procentowy (wykres kołowy). */
export function formatPercent(share: number, lang: ChartLang): string {
  if (!skonczona(share)) return NIE_LICZBA;
  return share.toLocaleString(localeOf(lang), {
    style: "percent",
    maximumFractionDigits: share < 0.1 ? 1 : 0,
  });
}

/**
 * Punkty procentowe z JEDNYM miejscem po przecinku - dla SUMY KONTROLNEJ
 * udziałów.
 *
 * Osobna funkcja od `formatPercent`, bo ta zaokrągla udziały bliskie stu
 * procentom do liczby całkowitej: suma 99,9% wychodziła z niej jako "100%",
 * czyli komunikat "udziały sumują się do 100%, a nie do 100%". Suma kontrolna
 * pokazuje dokładnie tę rozbieżność, którą wykryła, więc musi mieć własne
 * zaokrąglenie - i to takie samo (jedno miejsce), na jakim liczy ją model.
 */
export function formatPercentPoints(points: number, lang: ChartLang): string {
  if (!skonczona(points)) return NIE_LICZBA;
  return `${points.toLocaleString(localeOf(lang), {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  })}%`;
}
