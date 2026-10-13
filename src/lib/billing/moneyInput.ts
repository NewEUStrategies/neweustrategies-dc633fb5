// Kwota w polu formularza panelu: ZŁOTE (jednostka główna) <-> GROSZE (baza).
//
// PO CO (TIX-14a). Ceny biletów i pakietów wpisywało się w groszach: pole
// pokazywało „89900" dla 899 zł, więc redaktor, który wpisał „899", myśląc
// o złotych, wystawiał bilet za 8,99 zł. Pole mówi teraz w złotych („899,00"),
// a grosze liczy ta jedna para funkcji - bez arytmetyki zmiennoprzecinkowej
// (`0.29 * 100` to 28.999999999999996).
//
// ZAPIS JEDNOZNACZNY ALBO ODMOWA. Przyjmujemy cyfry z jednym separatorem
// dziesiętnym (przecinek albo kropka) i najwyżej dwoma miejscami po nim; spacje
// (także twarde) grupują tysiące. Grupowanie kropką lub przecinkiem przechodzi
// tylko razem z DRUGIM separatorem w roli dziesiętnej („1.299,00",
// „1,299.00"). Samo „1.299" albo „1,299" mogłoby znaczyć tysiąc dwieście
// dziewięćdziesiąt dziewięć złotych albo złotówkę z groszami w trzech
// cyfrach - takiej kwoty nie zgadujemy, tylko jej odmawiamy (`null`).
// Podgląd pod polem i tak pokazuje kwotę tak, jak zobaczy ją kupujący.

/** Separator dziesiętny pola kwoty - polski przecinek albo angielska kropka. */
export type MoneyDecimalSeparator = "," | ".";

/** Separator pola kwoty dla języka panelu: angielski - kropka, każdy inny - przecinek. */
export function moneyDecimalSeparator(language: string): MoneyDecimalSeparator {
  return language.startsWith("en") ? "." : ",";
}

/** Spacje grupujące tysiące: zwykła, twarda (U+00A0) i wąska twarda (U+202F). */
const GROUPING_SPACES = /[\s\u00a0\u202f]/g;

/**
 * Wartość pola w złotych -> grosze. `null` = pole puste albo zapis
 * niejednoznaczny lub błędny (litery, minus, trzy miejsca po przecinku).
 */
export function parseMoneyInput(value: string): number | null {
  let text = value.replace(GROUPING_SPACES, "");
  if (text === "") return null;
  if (/^\d{1,3}(\.\d{3})+,\d{1,2}$/.test(text)) text = text.replace(/\./g, "");
  else if (/^\d{1,3}(,\d{3})+\.\d{1,2}$/.test(text)) text = text.replace(/,/g, "");
  const match = /^(\d+)(?:[.,](\d{1,2}))?$/.exec(text);
  if (match === null) return null;
  const whole = Number(match[1]);
  const fraction = Number((match[2] ?? "").padEnd(2, "0"));
  const cents = whole * 100 + fraction;
  return Number.isSafeInteger(cents) ? cents : null;
}

/**
 * Grosze z bazy -> wartość pola w złotych, zawsze z dwoma miejscami po
 * separatorze („89900" -> „899,00"). Brak kwoty -> puste pole.
 */
export function centsToMoneyInput(
  cents: number | null | undefined,
  decimalSeparator: MoneyDecimalSeparator = ",",
): string {
  if (cents === null || cents === undefined || !Number.isFinite(cents)) return "";
  const whole = Math.trunc(Math.abs(cents) / 100);
  const fraction = String(Math.abs(Math.round(cents)) % 100).padStart(2, "0");
  return `${cents < 0 ? "-" : ""}${whole}${decimalSeparator}${fraction}`;
}
