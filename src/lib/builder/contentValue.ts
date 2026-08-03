// Kanoniczna koercja wartości `WidgetNode.content` (warstwa atomów danych).
//
// PROBLEM, KTÓRY TEN MODUŁ LIKWIDUJE
// Treść widgetu to swobodny JSON zapisywany przez trzy niezależne źródła:
//   1. `registry.tsx`  - defaulty palety (często natywne `boolean` / `number`),
//   2. `SchemaFieldControl` - kontrolki panelu (historycznie `select` -> "0"/"1"),
//   3. starsze rewizje dokumentów i szablony startowe (mieszanka obu).
// Renderery czytały te wartości ad hoc (`v !== false`, `typeof v === "number"`),
// przez co ustawienie zapisane jako string `"0"` bywało prawdziwe (`"0" !== false`),
// a liczba zapisana jako `"3"` cicho degradowała do wartości domyślnej.
//
// Każdy odczyt treści widgetu MUSI przechodzić przez ten moduł. Dzięki temu
// kontrakt "co znaczy wartość" żyje w jednym miejscu i jest testowalny bez
// Reacta, Supabase i DOM-u.
//
// Moduł jest czysty (bez importów runtime) - świadomie, żeby mógł być używany
// zarówno przez SSR, kanwę buildera, jak i skrypty CI.

/** Język treści. Para `${key}_pl` / `${key}_en` to konwencja całego buildera. */
export type ContentLang = "pl" | "en";

/** Dowolny worek treści widgetu (content, config wariantu, wiersz listy). */
export type ContentBag = Readonly<Record<string, unknown>>;

const TRUTHY_TOKENS: ReadonlySet<string> = new Set(["1", "true", "yes", "on", "tak"]);
const FALSY_TOKENS: ReadonlySet<string> = new Set(["0", "false", "no", "off", "nie", ""]);

/**
 * Koercja do `boolean` tolerancyjna na wszystkie historyczne zapisy.
 *
 * Akceptuje: `true|false`, `"1"|"0"`, `"true"|"false"`, `"yes"|"no"`,
 * `"on"|"off"`, `"tak"|"nie"` (case-insensitive, trymowane) oraz `1|0`.
 * Wartość nierozpoznana (np. `null`, `undefined`, obiekt) zwraca `fallback` -
 * nigdy nie zgaduje, bo cicha zgadywanka to dokładnie ta klasa błędu, którą
 * ten moduł usuwa.
 */
export function asBool(value: unknown, fallback: boolean): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (value === 1) return true;
    if (value === 0) return false;
    return fallback;
  }
  if (typeof value === "string") {
    const token = value.trim().toLowerCase();
    if (TRUTHY_TOKENS.has(token)) return true;
    if (FALSY_TOKENS.has(token)) return false;
  }
  return fallback;
}

/**
 * Koercja do skończonej liczby. W przeciwieństwie do `typeof v === "number"`
 * akceptuje też liczbę zapisaną jako string - kontrolki `select` panelu
 * commitują stringi, więc `columns: "4"` musi znaczyć `4`, a nie "brak wartości".
 */
export function asNum(value: unknown, fallback: number): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : fallback;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed === "") return fallback;
    const parsed = Number(trimmed);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

/** Jak `asNum`, ale dodatkowo domyka wynik do przedziału [min, max]. */
export function asNumInRange(value: unknown, fallback: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, asNum(value, fallback)));
}

/** Koercja do stringa. Nie-stringi (w tym `null`) dają "". */
export function asStr(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/**
 * Czy redakcja W OGÓLE ustawiła to pole.
 *
 * `undefined` / `null` / `""` to "brak wartości", więc dziedziczy się wartość
 * domyślna (globalna albo wyliczona z klucza historycznego). Bez tego
 * rozróżnienia "wyłączone" (`false`, `0`) zlewa się z "nie ustawiono" i
 * świadome wyłączenie ustawienia cicho wraca do domyślnego włączenia.
 */
export function isContentValueSet(value: unknown): boolean {
  return value !== undefined && value !== null && value !== "";
}

/** Tablica stringów z odfiltrowaniem elementów innego typu. */
export function asStrArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

/**
 * Odczyt pola i18n z pełnym łańcuchem fallbacków: żądany język -> PL -> EN.
 *
 * Ostatnie ogniwo (EN) ma znaczenie dla treści tworzonej wyłącznie po
 * angielsku: bez niego podgląd PL renderował pustkę mimo wypełnionego EN.
 * Kolejność PL-przed-EN zachowuje dotychczasowe zachowanie produkcyjne
 * (PL to język źródłowy redakcji).
 */
export function pickI18n(bag: ContentBag, baseKey: string, lang: ContentLang): string {
  const requested = asStr(bag[`${baseKey}_${lang}`]);
  if (requested) return requested;
  const polish = asStr(bag[`${baseKey}_pl`]);
  if (polish) return polish;
  return asStr(bag[`${baseKey}_en`]);
}

/**
 * Odczyt listy i18n (`${base}_pl` / `${base}_en`) z fallbackiem na starszy,
 * bezjęzykowy klucz `${base}`. Ten ostatni jest wymagany dla treści zapisanej
 * zanim dane pole stało się dwujęzyczne - inaczej migracja gubiłaby dane.
 */
export function pickI18nArray(bag: ContentBag, baseKey: string, lang: ContentLang): string[] {
  const requested = asStrArray(bag[`${baseKey}_${lang}`]);
  if (requested.length) return requested;
  const polish = asStrArray(bag[`${baseKey}_pl`]);
  if (polish.length) return polish;
  const english = asStrArray(bag[`${baseKey}_en`]);
  if (english.length) return english;
  return asStrArray(bag[baseKey]);
}

/**
 * Zawęża swobodny string do zamkniętego zbioru wariantów. Zwraca `fallback`
 * dla wartości spoza listy, więc renderer nigdy nie dostaje wariantu, którego
 * nie umie narysować (typowa przyczyna "wybrałem wariant, nic się nie zmieniło").
 */
export function asOneOf<T extends string>(
  value: unknown,
  allowed: ReadonlyArray<T>,
  fallback: T,
): T {
  const candidate = asStr(value).trim();
  return (allowed as ReadonlyArray<string>).includes(candidate) ? (candidate as T) : fallback;
}
