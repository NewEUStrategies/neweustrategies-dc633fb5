// Zakres dat filtra realizacji kuponów - dwa ogniwa zapytania jako czysta reguła.
//
// PO CO OSOBNO. W ciele trasy (`admin.coupons.redemptions.tsx`, dawne 66-67) to
// były dwa `if`-y wplecione między budowanie zapytania a `await`. Reguła jest
// jednak niezależna od PostgREST-a i ma dwie decyzje warte dowodu: brak daty
// oznacza BRAK OGNIWA (nie „od epoki"), a granica jest brana z daty DOKŁADNIE
// tak, jak przyszła z kalendarza.
//
// PRZENIESIONE ZNAK W ZNAK, RAZEM Z WADĄ. Kalendarz bez trybu godziny oddaje
// LOKALNĄ PÓŁNOC wybranego dnia (`DatePickerField`, `handleDateSelect`), więc
// `lte` wycina cały wybrany dzień: operator wybiera „do: 22 sierpnia" i nie
// widzi ani jednej realizacji z 22 sierpnia. Domknięcia końca dnia tu NIE MA
// i celowo nie dopisujemy go w kroku ekstrakcji - defekt jest zgłoszony przez
// `it.fails` w `src/lib/billing/__tests__/couponRedemptionsRange.test.ts`.

/** Granice filtra `created_at` w postaci, w jakiej idą do PostgREST-a. */
export interface RedemptionsRange {
  /** Wartość ogniwa `gte("created_at", ...)`; brak = ogniwa nie ma. */
  readonly gte?: string;
  /** Wartość ogniwa `lte("created_at", ...)`; brak = ogniwa nie ma. */
  readonly lte?: string;
}

export function redemptionsRange(from: Date | undefined, to: Date | undefined): RedemptionsRange {
  const range: { gte?: string; lte?: string } = {};
  if (from) range.gte = from.toISOString();
  if (to) range.lte = to.toISOString();
  return range;
}
