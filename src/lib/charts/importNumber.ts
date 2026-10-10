// Liczba z KOMÓRKI importu - pliku, schowka albo komórki siatki edytora.
//
// CZYSTY MODUŁ, BEZ ZALEŻNOŚCI. Czytają go `importTable.ts` (plik),
// `clipboardTable.ts` (rozstrzyga, czy surowa wartość ze schowka wygrywa z
// tekstem wyświetlanym) i `gridModel.ts` (komórka siatki) - jedna reguła dla
// wszystkich dróg, bez cyklu importów i bez ciągnięcia procesu arkuszy do
// modułu schowka. `importTable.ts` re-eksportuje wszystko, co tu publiczne,
// więc dotychczasowe importy działają bez zmian.

/** Konwencja zapisu liczb: „pl" - przecinek dziesiętny, „en" - kropka dziesiętna. */
export type NumberLocale = "pl" | "en";

/** Reguła rozdzielaczy; „legacy" to reguła sprzed wyboru konwencji. */
export type NumberRule = NumberLocale | "legacy";

/** Wynik odczytu komórki - wartość i powód, dla którego jej nie ma. */
export interface NumberReading {
  value: number | null;
  /**
   * `empty` - pusta komórka (świadoma luka), `missing` - jawny brak danych
   * („:" Eurostatu, „.." Banku Światowego), `invalid` - napis, który liczbą
   * nie jest (do zgłoszenia).
   */
  status: "number" | "empty" | "missing" | "invalid";
  /** Czy zdjęto flagę statystyczną („12,5 p" - wartość tymczasowa). */
  flagged: boolean;
}

const CURRENCY = "zł|pln|eur|€|\\$|usd|£|gbp|chf";
const CURRENCY_HEAD = new RegExp(`^([+-]?)(?:${CURRENCY})`, "i");
const CURRENCY_TAIL = new RegExp(`(?:${CURRENCY})$`, "i");
const CURRENCY_ONLY = new RegExp(`^(?:${CURRENCY})$`, "i");

/**
 * Flagi Eurostatu po spacji: b (przerwa w szeregu), c (poufne), d (inna
 * definicja), e (szacunek), f (prognoza), n (nieistotne), p (tymczasowe),
 * s (szacunek Eurostatu), u (niska wiarygodność), z (nie dotyczy) - pojedynczo
 * albo razem („bep"). Tylko małe litery: tak je pisze Eurostat, a wielka
 * litera po liczbie bywa jednostką.
 */
const FLAGS = /^(.*\S)\s+([bcdefnpsuz]{1,4})$/;

/** Jawne oznaczenia braku danych. */
const MISSING = new Set([":", ".."]);

/** Grupowanie tysięcy, które NAPRAWDĘ grupuje: pierwsza grupa bez zera wiodącego. */
const GROUPED_COMMA = /^[+-]?[1-9]\d{0,2}(?:,\d{3})+$/;
const GROUPED_DOT = /^[+-]?[1-9]\d{0,2}(?:\.\d{3})+$/;

/**
 * Zapis kropkowy bez grupowania. BEZ dwuznacznego „\d*\.?\d+": tamta postać
 * przy długim ciągu cyfr zakończonym literą próbowała każdego podziału cyfr
 * między dwa kwantyfikatory - 40 000 cyfr i „x" to 2,5 s na JEDNĄ komórkę.
 * Ten sam język, ale cyfry przed kropką należą do jednego kwantyfikatora.
 */
const NUMBER = /^[+-]?(?:\d+(?:\.\d+)?|\.\d+)(?:[eE][+-]?\d+)?$/;

/**
 * Napis dłuższy niż to nie jest liczbą, bez czytania go regułą. Najdłuższa
 * prawdziwa komórka liczbowa („-1 234 567 890 123,45 zł p", wykładnik
 * „1.7976931348623157E+308") ma kilkadziesiąt znaków; limit chroni wątek
 * strony przed komórką z setkami tysięcy znaków, którą schowek (do
 * `CLIPBOARD_MAX_CHARS`) i plik przepuszczają.
 */
const MAX_NUMBER_CHARS = 64;

interface Oczyszczona {
  s: string;
  status: "pending" | "empty" | "missing" | "invalid";
  /** Zdjęta flaga statystyczna („p", „bep") albo `null`. */
  flag: string | null;
}

/**
 * Wszystko, co nie zależy od konwencji: spacje, minus, waluta, flaga, braki.
 *
 * FLAGA SCHODZI PRZED USUNIĘCIEM ODSTĘPÓW. Flagę od liczby oddziela spacja
 * („1 234,5 p"); po zdjęciu wszystkich odstępów zostałoby „1234,5p", którego
 * nie da się już odróżnić od śmiecia - liczba z flagą przepadałaby jako
 * komórka nieliczbowa.
 */
function oczysc(raw: string): Oczyszczona {
  let s = raw.trim();
  if (s === "") return { s, status: "empty", flag: null };
  if (s.length > MAX_NUMBER_CHARS) return { s, status: "invalid", flag: null };
  let flag: string | null = null;
  const m = FLAGS.exec(s);
  if (m && !CURRENCY_ONLY.test(m[2])) {
    s = m[1];
    flag = m[2];
  }
  if (MISSING.has(s)) return { s, status: "missing", flag };
  s = s.replace(/[\s\u00a0\u202f\u2009]/g, "").replace(/[\u2212\u2013]/g, "-");
  // Zapis księgowy: (123) znaczy -123.
  const bracketed = /^\((.*)\)$/.exec(s);
  if (bracketed) s = `-${bracketed[1]}`;
  s = s.replace(/%$/, "").replace(CURRENCY_HEAD, "$1").replace(CURRENCY_TAIL, "");
  // Grupowanie apostrofem (Szwajcaria): 1'234.5.
  if (/^[+-]?\d{1,3}(?:['\u2019]\d{3})+(?:[.,]\d+)?$/.test(s)) s = s.replace(/['\u2019]/g, "");
  return { s, status: "pending", flag };
}

/** Rozdzielacze -> zapis kropkowy bez grupowania; `null`, gdy zapis jest sprzeczny. */
function rozdzielacze(s: string, rule: NumberRule): string | null {
  const lastComma = s.lastIndexOf(",");
  const lastDot = s.lastIndexOf(".");
  if (lastComma !== -1 && lastDot !== -1) {
    const decimal = lastComma > lastDot ? "," : ".";
    const thousands = decimal === "," ? "." : ",";
    const di = s.lastIndexOf(decimal);
    const grupy = odgrupuj(s.slice(0, di), thousands);
    return grupy === null ? null : `${grupy}.${s.slice(di + 1)}`;
  }
  if (lastComma !== -1) {
    if (rule === "en" && GROUPED_COMMA.test(s)) return s.replace(/,/g, "");
    if (rule === "legacy") return s.replace(",", ".");
    return s.indexOf(",") === lastComma ? s.replace(",", ".") : null;
  }
  if (lastDot !== -1 && rule === "pl" && GROUPED_DOT.test(s)) return s.replace(/\./g, "");
  return s;
}

/**
 * Liczba z KOMÓRKI PLIKU albo SCHOWKA, z powodem braku. Świadomie mądrzejsza
 * niż parser textarei, bo materiał jest inny: textareę pisze człowiek w jednej
 * konwencji, a plik przychodzi z Excela sformatowany pod lokalizację autora.
 *
 * Reguła rozdzielaczy, gdy w napisie są OBA znaki: ten, który stoi DALEJ,
 * jest dziesiętny, a drugi jest rozdzielaczem tysięcy. Dzięki temu
 * „1.234,56" (PL) i „1,234.56" (EN) dają tę samą liczbę, i żadna z nich nie
 * daje 1,23456.
 *
 * Gdy znak jest JEDEN, decyduje konwencja:
 *   - bez konwencji (reguła zastana): przecinek i kropka są dziesiętne - to
 *     zgodne z `parseNumber` w `csv.ts`, więc import i textarea nie
 *     rozjeżdżają się na tym samym napisie;
 *   - „pl": przecinek dziesiętny, kropki grupujące po trzy to tysiące
 *     („1.234" = 1234);
 *   - „en": kropka dziesiętna, przecinki grupujące po trzy to tysiące
 *     („1,234" = 1234).
 * Zapis, który grupowaniem być nie może („12,5", „3.5", „0,123"), jest
 * dziesiętny w każdej konwencji.
 *
 * Spacje (ze spacją nierozdzielającą i wąską włącznie) lecą w całości - Excel
 * wstawia je jako rozdzielacz tysięcy. Minus typograficzny (U+2212) i półpauza
 * jako minus są minusem. Waluta na początku albo na końcu (zł, PLN, EUR, €, $,
 * USD, £, GBP, CHF) jest zdejmowana - jednostka to osobne pole konfiguracji.
 *
 * ZNAK PROCENTU NIE DZIELI PRZEZ STO. Jednostka jest osobnym polem
 * konfiguracji, a ciche dzielenie zmieniałoby wartość, której redaktor nie
 * prosił o zmianę. Proces arkuszy w trybie importu wykresu stosuje tę samą
 * regułę do komórek procentowych z pliku (wartość · 100), a schowek do surowej
 * wartości komórki procentowej - więc „12,5%" daje 12,5 z pliku i ze schowka.
 */
export function readImportedNumber(raw: string, locale?: NumberLocale): NumberReading {
  const { status, value, flag } = odczyt(raw, locale);
  return { value, status, flagged: flag !== null };
}

/** Odczyt z flagą: flaga zostaje tylko przy liczbie i przy jawnym braku („: c"). */
function odczyt(
  raw: string,
  locale: NumberLocale | undefined,
): { status: NumberReading["status"]; value: number | null; flag: string | null } {
  const c = oczysc(raw);
  if (c.status === "empty") return { status: "empty", value: null, flag: null };
  if (c.status === "missing") return { status: "missing", value: null, flag: c.flag };
  if (c.status === "invalid") return { status: "invalid", value: null, flag: null };
  const s = rozdzielacze(c.s, locale ?? "legacy");
  const v = s !== null && NUMBER.test(s) ? Number(s) : Number.NaN;
  return Number.isFinite(v)
    ? { status: "number", value: v, flag: c.flag }
    : { status: "invalid", value: null, flag: null };
}

/** Komórka importu: liczba (albo `null`) i zdjęta z niej flaga statystyczna. */
export interface ImportedCell {
  value: number | null;
  /**
   * Flaga Eurostatu zdjęta z liczby („p" z „12,5 p", „bep" z „7 bep") albo
   * z jawnego braku („c" z „: c"); `null`, gdy flagi nie było albo gdy napis
   * liczbą nie jest.
   */
  flag: string | null;
}

/**
 * Komórka importu -> `{ value, flag }`. Ta sama reguła co `readImportedNumber`
 * (konwencja, waluta, procent bez dzielenia, braki danych), ale flaga
 * statystyczna wraca jako litery, a nie tylko jako „była": siatka edytora
 * może ją pokazać przy komórce, a nie wyłącznie policzyć w zgłoszeniu.
 */
export function parseImportedCell(raw: string, locale?: NumberLocale): ImportedCell {
  const { value, flag } = odczyt(raw, locale);
  return { value, flag };
}

/** Sama wartość z `parseImportedCell` - dla wołających, którym flaga nie jest potrzebna. */
export function parseImportedNumber(raw: string, locale?: NumberLocale): number | null {
  return parseImportedCell(raw, locale).value;
}

/**
 * Czy napis jest liczbą w KTÓREJKOLWIEK konwencji (pl albo en). Bramka dla
 * surowej wartości ze schowka: „1,234,567" z angielskiego Excela i „1 234,50 zł"
 * z polskiego są liczbami, choć każda tylko w jednej konwencji.
 */
export function isImportedNumber(raw: string): boolean {
  return parseImportedNumber(raw, "pl") !== null || parseImportedNumber(raw, "en") !== null;
}

/**
 * Zdejmuje rozdzielacz tysięcy, ale tylko z zapisu, który NAPRAWDĘ grupuje po
 * trzy. Bez tej kontroli „1.2.3,4" wychodziło jako 123,4 - czyli śmieć
 * zamieniony w wiarygodnie wyglądającą liczbę, a to jest gorsze niż odrzucenie:
 * liczba bez ostrzeżenia trafia na wykres i nikt jej nie kwestionuje.
 */
function odgrupuj(intPart: string, thousands: string): string | null {
  const parts = intPart.split(thousands);
  if (parts.length === 1) return parts[0];
  if (!/^[+-]?\d{1,3}$/.test(parts[0])) return null;
  for (let i = 1; i < parts.length; i += 1) {
    if (!/^\d{3}$/.test(parts[i])) return null;
  }
  return parts.join("");
}

/** Na którą konwencję wskazuje komórka. */
export type NumberStyle = NumberLocale | "ambiguous";

/**
 * Świadectwo konwencji w JEDNEJ komórce; `null`, gdy go nie ma (liczba bez
 * rozdzielacza albo napis, który liczbą nie jest). „ambiguous" to dokładnie
 * jeden rozdzielacz z trzema cyframi po nim („1,234", „12.345") - zapis, który
 * w jednej konwencji jest tysiącem, a w drugiej ułamkiem.
 */
export function numberStyle(raw: string): NumberStyle | null {
  const c = oczysc(raw);
  if (c.status !== "pending") return null;
  const s = c.s;
  const comma = s.indexOf(",");
  const dot = s.indexOf(".");
  let style: NumberStyle;
  if (comma !== -1 && dot !== -1) style = s.lastIndexOf(",") > s.lastIndexOf(".") ? "pl" : "en";
  else if (comma !== -1) {
    if (!GROUPED_COMMA.test(s)) style = "pl";
    else style = comma === s.lastIndexOf(",") ? "ambiguous" : "en";
  } else if (dot !== -1) {
    if (!GROUPED_DOT.test(s)) style = "en";
    else style = dot === s.lastIndexOf(".") ? "ambiguous" : "pl";
  } else return null;
  const parsed = rozdzielacze(s, style === "ambiguous" ? "pl" : style);
  return parsed !== null && NUMBER.test(parsed) ? style : null;
}
