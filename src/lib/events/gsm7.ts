// SMS w alfabecie GSM-7: transliteracja, liczenie septetów, data liczbowa
// i składanie treści mieszczącej się w jednym segmencie (160 septetów).
//
// PO CO. Jeden znak spoza GSM-7 (np. „ś" w nazwie miesiąca albo „ł"
// w tytule wydarzenia) przełącza CAŁY SMS na UCS-2, a wtedy segment ma
// 70 znaków zamiast 160 - przypomnienie rozpada się na trzy płatne części
// albo zostaje ucięte u operatora. Dlatego:
//   * transliterujemy CAŁĄ treść (szablon i tytuł), nie tylko tytuł,
//   * datę piszemy liczbami (`DD.MM HH:mm`), bo polskie nazwy miesięcy
//     („październik", „wrzesień") zawierają znaki spoza alfabetu,
//   * budżet liczymy w SEPTETACH: znaki tabeli rozszerzeń (`€ [ ] { } \ ^ ~ |`)
//     kosztują dwa.
//
// MAPA JEST JAWNA. „ł" nie rozkłada się w Unicode na „l" + znak diakrytyczny,
// więc ogólne `normalize("NFD")` by go zgubiło - stąd tabela liter polskich,
// Latin-1 i najczęstszych z Latin Extended-A. Dopiero znak spoza tabeli
// próbuje rozkładu NFD, a jeśli i on nie da litery GSM-7, staje się `?`.

/** Alfabet podstawowy GSM 03.38 (jeden septet na znak). */
const GSM7_BASIC =
  "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?" +
  "¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà";

/** Tabela rozszerzeń (znak ucieczki + znak = dwa septety). */
const GSM7_EXTENSION = "€[]{}\\^~|";

const BASIC = new Set([...GSM7_BASIC]);
const EXTENSION = new Set([...GSM7_EXTENSION]);

/** Jawna transliteracja: litery polskie, Latin-1, Latin Extended-A, typografia. */
const TRANSLITERATION: Readonly<Record<string, string>> = {
  // Polskie (wszystkie osiemnaście, jawnie - „ł"/„Ł" nie mają rozkładu NFD).
  ą: "a",
  ć: "c",
  ę: "e",
  ł: "l",
  ń: "n",
  ó: "o",
  ś: "s",
  ź: "z",
  ż: "z",
  Ą: "A",
  Ć: "C",
  Ę: "E",
  Ł: "L",
  Ń: "N",
  Ó: "O",
  Ś: "S",
  Ź: "Z",
  Ż: "Z",
  // Latin-1 spoza alfabetu GSM-7.
  á: "a",
  â: "a",
  ã: "a",
  À: "A",
  Á: "A",
  Â: "A",
  Ã: "A",
  ç: "c",
  ê: "e",
  ë: "e",
  È: "E",
  Ê: "E",
  Ë: "E",
  í: "i",
  î: "i",
  ï: "i",
  Ì: "I",
  Í: "I",
  Î: "I",
  Ï: "I",
  ð: "d",
  Ð: "D",
  ô: "o",
  õ: "o",
  Ò: "O",
  Ô: "O",
  Õ: "O",
  ú: "u",
  û: "u",
  Ù: "U",
  Ú: "U",
  Û: "U",
  ý: "y",
  ÿ: "y",
  Ý: "Y",
  þ: "th",
  Þ: "Th",
  // Latin Extended-A - najczęstsze w nazwiskach i nazwach w regionie.
  č: "c",
  Č: "C",
  ď: "d",
  Ď: "D",
  đ: "d",
  Đ: "D",
  ě: "e",
  Ě: "E",
  ė: "e",
  Ė: "E",
  ğ: "g",
  Ğ: "G",
  ı: "i",
  İ: "I",
  ľ: "l",
  Ľ: "L",
  ĺ: "l",
  Ĺ: "L",
  ň: "n",
  Ň: "N",
  ő: "o",
  Ő: "O",
  œ: "oe",
  Œ: "OE",
  ř: "r",
  Ř: "R",
  ŕ: "r",
  Ŕ: "R",
  š: "s",
  Š: "S",
  ş: "s",
  Ş: "S",
  ť: "t",
  Ť: "T",
  ţ: "t",
  Ţ: "T",
  ů: "u",
  Ů: "U",
  ű: "u",
  Ű: "U",
  ž: "z",
  Ž: "Z",
  // Typografia: cudzysłowy, myślniki, wielokropek, spacje niełamiące.
  "‘": "'",
  "’": "'",
  "‚": "'",
  "‛": "'",
  "′": "'",
  "‹": "'",
  "›": "'",
  "“": '"',
  "”": '"',
  "„": '"',
  "‟": '"',
  "″": '"',
  "«": '"',
  "»": '"',
  "‐": "-",
  "‑": "-",
  "‒": "-",
  "–": "-",
  "—": "-",
  "―": "-",
  "−": "-",
  "…": "...",
  "•": "-",
  " ": " ",
  " ": " ",
  " ": " ",
  " ": " ",
  " ": " ",
  "\t": " ",
};

const COMBINING_MARKS = /[̀-ͯ]/g;

function isGsm7Char(ch: string): boolean {
  return BASIC.has(ch) || EXTENSION.has(ch);
}

function transliterateChar(ch: string): string {
  if (isGsm7Char(ch)) return ch;
  const mapped = TRANSLITERATION[ch];
  if (mapped !== undefined) return mapped;
  // Litera z diakrytykiem spoza tabeli (np. „ǎ"): rozkład NFD i zdjęcie znaków
  // łączących. Wynik przyjmujemy tylko wtedy, gdy JEST w alfabecie.
  const stripped = ch.normalize("NFD").replace(COMBINING_MARKS, "");
  return stripped !== "" && [...stripped].every(isGsm7Char) ? stripped : "?";
}

/** Tekst -> GSM-7 (każdy znak spoza alfabetu i tabeli rozszerzeń zamieniony albo `?`). */
export function transliterateToGsm7(text: string): string {
  let out = "";
  for (const ch of text.normalize("NFC")) out += transliterateChar(ch);
  return out;
}

/** Czy tekst mieści się w GSM-7 (alfabet podstawowy + tabela rozszerzeń). */
export function isGsm7(text: string): boolean {
  return [...text].every(isGsm7Char);
}

/** Długość w septetach: znak tabeli rozszerzeń liczy się podwójnie. */
export function gsm7Septets(text: string): number {
  let total = 0;
  for (const ch of text) total += EXTENSION.has(ch) ? 2 : 1;
  return total;
}

const SMS_FALLBACK_ZONE = "Europe/Warsaw";

function momentParts(date: Date, timeZone: string): Record<string, string> {
  const parts = new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone,
  }).formatToParts(date);
  const out: Record<string, string> = {};
  for (const part of parts) out[part.type] = part.value;
  return out;
}

/**
 * Moment wydarzenia do SMS-a: `DD.MM HH:mm` w strefie wydarzenia, same cyfry
 * (bez nazw miesięcy). Zła strefa -> `Europe/Warsaw`; nieczytelna data -> `""`.
 */
export function formatSmsMoment(startsAt: string, timeZone: string): string {
  const date = new Date(startsAt);
  if (Number.isNaN(date.getTime())) return "";
  let parts: Record<string, string>;
  try {
    parts = momentParts(date, timeZone);
  } catch {
    parts = momentParts(date, SMS_FALLBACK_ZONE);
  }
  return `${parts.day}.${parts.month} ${parts.hour}:${parts.minute}`;
}

const ELLIPSIS = "...";

/** Tytuł (już w GSM-7) przycięty do budżetu septetów, z `...` na końcu. */
function fitTitle(title: string, budget: number): string {
  if (gsm7Septets(title) <= budget) return title;
  const room = budget - ELLIPSIS.length;
  if (room <= 0) return "";
  let out = "";
  let used = 0;
  for (const ch of title) {
    const cost = gsm7Septets(ch);
    if (used + cost > room) break;
    out += ch;
    used += cost;
  }
  return `${out.trimEnd()}${ELLIPSIS}`;
}

function assertSmsFits(body: string, maxSeptets: number): void {
  if (!isGsm7(body) || gsm7Septets(body) > maxSeptets) {
    throw new Error("sms_template_too_long");
  }
}

/**
 * Treść SMS-a z szablonu i tytułu. Szablon renderujemy najpierw z PUSTYM
 * tytułem i transliterujemy całość - to, co zostaje z budżetu, dostaje tytuł
 * (też transliterowany, w razie potrzeby przycięty z `...`). Szablonu nie
 * przycinamy nigdy: gdy sam przekracza budżet, rzucamy `sms_template_too_long`
 * (błąd programisty, nie danych).
 */
export function composeSmsBody(
  template: (title: string) => string,
  title: string,
  maxSeptets = 160,
): string {
  const skeleton = transliterateToGsm7(template(""));
  assertSmsFits(skeleton, maxSeptets);
  const budget = maxSeptets - gsm7Septets(skeleton);
  const body = transliterateToGsm7(template(fitTitle(transliterateToGsm7(title.trim()), budget)));
  assertSmsFits(body, maxSeptets);
  return body;
}
