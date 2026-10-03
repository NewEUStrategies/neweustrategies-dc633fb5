/**
 * Czytnik totali raportu GA4 - moduł IZOMORFICZNY (bez ani jednego importu).
 *
 * PO CO OSOBNY PLIK. Jedyny czytnik, który odróżniał „Data API nie zwróciło
 * sumy" od „suma wynosi zero", mieszkał w `ga4.server.ts`, a ten plik importuje
 * `node:crypto` i wolno go ładować wyłącznie dynamicznie z wnętrza handlera
 * serwerowego. Panel GA4 (`Ga4BiDashboard`) nie mógł więc z niego skorzystać
 * i dorobił sobie własną kopię, która każdy brak sumy zamieniała na 0.
 * Zmierzone skutki tej kopii na prawdziwym panelu:
 *   - wiersze dobowe są, `totals: []` w obu oknach: kafelki „0 / 0 / 0 / 0.0%",
 *     plakietki „0%" i „0pp", ŻADNEGO komunikatu - obok niepustego wykresu trendu,
 *   - brak wierszy i `totals: []`: baner „Brak danych w oknie", a pod nim nadal
 *     siatka zer,
 *   - totale tylko w oknie poprzednim: kafelki „0" i czerwone „-100.0%",
 *   - totale tylko w oknie bieżącym: poprawne liczby, ale plakietki „+∞".
 * Jeden czytnik dla serwera i klienta zamyka tę rozbieżność u źródła.
 *
 * Parametr jest STRUKTURALNY (`Ga4TotalsSource`), a nie `Ga4Report`: moduł
 * nie importuje nawet typu z `ga4.server.ts`, więc nie powstaje żaden cykl,
 * także czysto typowy. `Ga4Report` jest do niego przypisywalny wprost.
 */

/** Minimum raportu GA4, którego potrzebuje czytnik totali. */
export interface Ga4TotalsSource {
  readonly metricHeaders: readonly string[];
  /**
   * Wartości w kolejności `metricHeaders`. PUSTA tablica znaczy, że Data API
   * sum nie zwróciło - to NIE jest „totale równe zero" (zmierzone zero
   * przychodzi jako `"0"`).
   */
  readonly totals: readonly string[];
  readonly error?: string;
}

/**
 * Totale GA4 jako mapa nazwa metryki -> liczba. Pusta mapa, gdy raport nie
 * dojechał: wywołujący ma wtedy odróżnić brak danych od zera, a nie podstawić 0.
 */
export function ga4TotalsMap(report: Ga4TotalsSource): Map<string, number> {
  const out = new Map<string, number>();
  if (report.error) return out;
  report.metricHeaders.forEach((name, i) => {
    const n = Number(report.totals[i]);
    if (Number.isFinite(n)) out.set(name, n);
  });
  return out;
}
