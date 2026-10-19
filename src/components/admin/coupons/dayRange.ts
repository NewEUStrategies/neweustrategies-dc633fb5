// Granice zakresu dat w zakładkach Realizacje i Analityka kuponów - LOKALNA
// doba operatora (AGENTS: zachowaj lokalne daty, bez przesunięć doby).
//
// DLACZEGO. Kalendarz (`DatePickerField`) oddaje datę jako LOKALNĄ północ
// wybranego dnia. Zapytanie wysyłało ją wprost (`to.toISOString()` przy
// `created_at <= to`), więc zakres „do 19 października" kończył się
// o 00:00 tego dnia - cała ostatnia doba wypadała z sum. Domyślny początek
// „30 dni temu" niósł z kolei bieżącą godzinę, przez co klucz zapytania
// i sumy zależały od chwili otwarcia karty. Tu oba końce dostają pełną dobę
// w strefie przeglądarki: początek = 00:00:00.000, koniec = 23:59:59.999.
// Brak daty = brak granicy (`null`), jak dotąd.

/** Początek lokalnej doby `day` jako ISO (UTC) albo `null` bez granicy. */
export function localDayStartIso(day: Date | undefined): string | null {
  if (!day || Number.isNaN(day.getTime())) return null;
  const start = new Date(day);
  start.setHours(0, 0, 0, 0);
  return start.toISOString();
}

/** Koniec lokalnej doby `day` (włącznie) jako ISO (UTC) albo `null` bez granicy. */
export function localDayEndIso(day: Date | undefined): string | null {
  if (!day || Number.isNaN(day.getTime())) return null;
  const end = new Date(day);
  end.setHours(23, 59, 59, 999);
  return end.toISOString();
}

/** Lokalna północ dnia `daysAgo` dni przed `now` - domyślny początek zakresu. */
export function localDaysAgo(daysAgo: number, now: Date = new Date()): Date {
  const day = new Date(now);
  day.setHours(0, 0, 0, 0);
  // Kalendarzowe odejmowanie dni (nie 24 h) - zmiana czasu w zakresie nie
  // przesuwa początku na 23:00 albo 01:00 dnia obok.
  day.setDate(day.getDate() - daysAgo);
  return day;
}
