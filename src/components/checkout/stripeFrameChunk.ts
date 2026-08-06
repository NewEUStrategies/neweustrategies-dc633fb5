// Uchwyt do leniwego chunku ramki kasy - JEDYNE miejsce w aplikacji, w którym
// żyje `import("./StripeEmbeddedFrame")`.
//
// Osobny moduł, a nie funkcja w komponencie, z dwóch powodów:
//   * `lazy()` i rozgrzewka MUSZĄ wskazywać ten sam specyfikator, inaczej
//     bundler wyprodukuje dwa chunki i prefetch grzałby nie ten plik;
//   * pliki komponentów zostają czystymi eksportami komponentów (React Fast
//     Refresh gubi się przy mieszaniu komponentów z funkcjami pomocniczymi).
//
// i18n: brak treści dla użytkownika.
export const loadStripeEmbeddedFrame = () => import("./StripeEmbeddedFrame");

/**
 * Rozgrzewa chunk ramki kasy. Wywołuj na POCZĄTKU procedury zakupu (przed
 * `await` na funkcję serwerową tworzącą sesję) - pobranie chunku nakłada się
 * wtedy na round-trip do serwera i szkielet nie zdąży się pokazać.
 * Idempotentne: kolejne wywołania trafiają w cache modułów przeglądarki.
 * Błąd sieci celowo połykamy - to tylko rozgrzewka, `Suspense` spróbuje
 * ponownie przy realnym montowaniu.
 */
export function prefetchEmbeddedCheckout(): void {
  void loadStripeEmbeddedFrame().catch(() => undefined);
}
