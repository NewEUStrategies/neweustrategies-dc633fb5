// Kwota do zapłaty za wejściówkę - JEDNO miejsce, w którym grosze stają się
// napisem.
//
// PO CO OSOBNY MODUŁ. Tę samą kwotę pokazują TRZY powierzchnie: ekran
// potwierdzenia zapisu, panel „Moje zgłoszenia" i strona samoobsługi
// zgłoszenia. Każda miała własne `new Intl.NumberFormat` - czyli trzy okazje
// do rozjazdu o grosz albo o walutę na powierzchni, która mówi o pieniądzach.
//
// `null` NIE JEST OZDOBĄ. Odpowiedzi bazy składa też kod wywołujący (i testy),
// a `undefined` przechodziłby przez porównanie z `null` prosto do
// `Intl.NumberFormat({ currency: undefined })`, które RZUCA - i tak wywracało
// się całe potwierdzenie zapisu zamiast pominąć kwotę.
import { formatMoney } from "@/lib/billing/types";

/**
 * Kwota w walucie odpowiedzi albo `null`, gdy nie ma czego pokazać.
 *
 * Samo formatowanie oddaje `formatMoney` z modułu rozliczeń - ta sama funkcja,
 * z której czyta kasa, paywall i karta planu.
 */
export function formatAmountDue(
  amountCents: number | null | undefined,
  currency: string | null | undefined,
  locale: string,
): string | null {
  const cents = amountCents ?? null;
  const code = (currency ?? "").trim();
  if (cents === null || code === "") return null;
  return formatMoney(cents, code.toUpperCase(), locale);
}
