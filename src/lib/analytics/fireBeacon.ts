// Granica błędu jednego beacona - JEDNA reguła dla całej warstwy telemetrii
// przeglądarkowej.
//
// PO CO OSOBNY MODUŁ. Ta funkcja stała skopiowana w dwóch modułach podwójnego
// beacona (`seo/googleSourceBadgeAnalytics.ts` i `analytics/footerTracking.ts`),
// a razem z nią - piętnaście linii uzasadnienia cytujących osiem konkretnych
// miejsc w repo. Duplikat czterolinijkowego `try` jest niegroźny; duplikat
// UZASADNIENIA nie jest. Wystarczy, że ktoś dołoży `console.warn` do jednej
// kopii „na czas debugowania”, i dwa moduły o tym samym zadaniu mają dwie różne
// polityki raportowania, przy czym żadna z nich nie kłamie w swoim komentarzu.
//
// CO TO ROBI. Jeden beacon = jedna granica błędu. Kanały podwójnego beacona
// mają WŁASNE, niezależne powody padnięcia:
//   * `track()` czyta `localStorage`/`sessionStorage` (tryb prywatny i polityka
//     firmowa rzucają przy samym odczycie),
//   * `track()` woła `flush()` we WŁASNYM wnętrzu, gdy bufor dobije
//     `MAX_BATCH`, więc transport `sendBeacon` rzucający po przekroczeniu
//     limitu ładunku pada WEWNĄTRZ pierwszego nadania, a nie po nim,
//   * `gtag` to CUDZY kod wstrzyknięty przez CMP i może rzucić w środku.
// Dlatego każde nadanie idzie w osobnym wywołaniu tej funkcji. WSPÓLNY `try`
// wokół obu nadań to ten sam defekt, który tu naprawiamy - awaria pierwszego
// kanału dalej zabierałaby drugi.
//
// CISZA W `catch` JEST KONWENCJĄ TEJ WARSTWY, nie przeoczeniem. Przeglądarkowe
// moduły telemetrii w tym repo połykają błąd bez śladu w konsoli, zostawiając
// wyłącznie komentarz w pustym `catch`: `analytics/track.ts` (`randomId`,
// `readSession`, `readAnonId`), `ads/consent.ts` („private mode”, „ignore”,
// „offline”) i `observability/report.ts` (`sendBeaconPayload` zwraca `false`).
// `console.warn` w `src/lib/analytics` stoi WYŁĄCZNIE w funkcjach serwerowych
// (`audience.functions.ts`, `semantic/snapshot.functions.ts`), gdzie trafia do
// logów workera, a nie do konsoli odwiedzającego; jedyny `console.debug`
// w całym `src/` (`webVitals.ts`) jest bramkowany `import.meta.env.DEV`
// i ZASTĘPUJE beacon w trybie developerskim, więc nie jest raportem połkniętego
// błędu. Dokładanie tu własnego logu oznaczałoby hałas w konsoli KAŻDEGO
// odwiedzającego z zablokowanym magazynem - i nową konwencję na jedno miejsce
// w repo.
//
// CZEGO TA FUNKCJA NIE ROBI - świadomie: nie ponawia nadania i nie kolejkuje
// go na później. Bufor w `track.ts` jest wycinany PRZED wysyłką, więc partia
// utracona przez rzucający transport jest utracona bezpowrotnie; to wybór
// zapisany w tamtym module, a nie coś, co granica błędu mogłaby tu odwrócić.

/**
 * Wykonuje jedno nadanie telemetryczne, połykając jego awarię.
 *
 * Wołaj OSOBNO dla każdego kanału - patrz uzasadnienie w nagłówku modułu.
 */
export function fireBeacon(send: () => void): void {
  try {
    send();
  } catch {
    // Fire-and-forget: analityka nie ma prawa wywrócić nawigacji ani zapisu
    // formularza. Pusto z rozmysłem - uzasadnienie ciszy w nagłówku modułu.
  }
}
