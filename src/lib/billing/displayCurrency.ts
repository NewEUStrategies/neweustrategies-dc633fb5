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

/**
 * Przelicza kwoty audytu kuponu (oryginał + kwota finalna) do waluty
 * prezentacji z parytetem 1 EUR = 2 PLN. RABAT wyprowadzamy z RÓŻNICY
 * przeliczonych kwot, więc niezmiennik `original = final + discount` trzyma się
 * DOKŁADNIE w walucie docelowej (bez dryfu zaokrągleń między osobno
 * konwertowanymi wartościami). Wszystkie zwrócone kwoty są w `currency`, więc
 * zapis redemption i metadane zamówienia są spójne walutowo.
 */
export function couponAuditInDisplayCurrency(
  originalCents: number,
  finalCents: number,
  fromCurrency: string,
  target: DisplayCurrency,
): { originalCents: number; finalCents: number; discountCents: number; currency: DisplayCurrency } {
  const o = convertToDisplayCurrency(originalCents, fromCurrency, target);
  const f = convertToDisplayCurrency(finalCents, fromCurrency, target);
  return {
    originalCents: o.cents,
    finalCents: f.cents,
    discountCents: Math.max(0, o.cents - f.cents),
    currency: f.currency,
  };
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
