// Kwota z groszy w walucie wiersza katalogu członków.
//
// KOD WALUTY PRZYCHODZI Z BAZY (`payment_orders.currency`) i bywa pusty -
// `?? "PLN"` po stronie serwera łapie `null`, ale nie pusty napis. A pusty
// albo nieznany kod `Intl.NumberFormat` odrzuca `RangeError`-em, który
// wywracał cały wiersz (lista) albo całe rozwinięcie (szczegóły) jednej
// osoby. Zamiast wyjątku pokazujemy kwotę z surowym kodem obok - operator
// widzi liczbę i widzi, że z walutą jest coś nie tak.
export function memberMoney(cents: number, currency: string, locale: string): string {
  const amount = cents / 100;
  try {
    return new Intl.NumberFormat(locale, { style: "currency", currency }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${currency}`.trim();
  }
}
