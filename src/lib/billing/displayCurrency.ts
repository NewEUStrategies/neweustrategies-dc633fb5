// Konwersja waluty wyłącznie na potrzeby prezentacji + checkoutu w wersji EN.
// Reguła: dla języka angielskiego ceny w PLN wyświetlamy i rozliczamy w EUR,
// przyjmując parytet 1 EUR = 2 PLN (spójne z /support i cennikiem darowizn).
// Konwersja jest deterministyczna i tożsama na FE i BE, więc UI cennika,
// koszyk oraz panel admina pokazują tę samą kwotę.
import { formatMoney, formatMoneyWhole } from "@/lib/billing/types";

export type DisplayCurrency = "PLN" | "EUR";

export function displayCurrencyForLang(lang: string): DisplayCurrency {
  return lang.toLowerCase().startsWith("en") ? "EUR" : "PLN";
}

/** Zwraca kwotę + walutę do wyświetlenia/rozliczenia. */
export function convertToDisplayCurrency(
  cents: number,
  currency: string,
  target: DisplayCurrency,
): { cents: number; currency: DisplayCurrency } {
  const src = currency.toUpperCase();
  if (src === target) return { cents, currency: target };
  if (src === "PLN" && target === "EUR") {
    return { cents: Math.round(cents / 2), currency: "EUR" };
  }
  if (src === "EUR" && target === "PLN") {
    return { cents: Math.round(cents * 2), currency: "PLN" };
  }
  return { cents, currency: src as DisplayCurrency };
}

/** Skrót: konwersja + formatowanie w jednej wywołce. */
export function formatDisplayMoney(cents: number, currency: string, lang: string): string {
  const d = convertToDisplayCurrency(cents, currency, displayCurrencyForLang(lang));
  return formatMoney(d.cents, d.currency, lang);
}

/**
 * Przybliżona kwota miesięczna dla kotwicy planu rocznego: konwersja do waluty
 * prezentacji, zaokrąglenie W DÓŁ do pełnej jednostki (nigdy nie zawyża
 * równowartości) i format bez ułamka. Zaokrąglamy w walucie docelowej, żeby
 * wersja EUR też była czysta. Etykieta „≈" i dokładna cena roczna obok czynią
 * tę wartość jawnie orientacyjną.
 */
export function formatApproxDisplayMoney(cents: number, currency: string, lang: string): string {
  const d = convertToDisplayCurrency(cents, currency, displayCurrencyForLang(lang));
  const whole = Math.floor(d.cents / 100) * 100;
  return formatMoneyWhole(whole, d.currency, lang);
}
