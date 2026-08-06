// Właściciel chunku osadzonej kasy - JEDNO miejsce, które zna ścieżkę importu.
//
// Rozdzielone od komponentu granicy (`LazyEmbeddedCheckoutDialog`), bo plik
// komponentu ma eksportować wyłącznie komponenty (fast refresh), a prefetch
// jest wołany z miejsc, które granicy jeszcze nie renderują.
import type { EmbeddedCheckoutDialogProps } from "@/components/checkout/EmbeddedCheckoutDialog";

export type { EmbeddedCheckoutDialogProps };

/** Import chunku kasy w formacie oczekiwanym przez `React.lazy`. */
export const loadCheckoutDialog = () =>
  import("@/components/checkout/EmbeddedCheckoutDialog").then((m) => ({
    default: m.EmbeddedCheckoutDialog,
  }));

/**
 * Rozgrzewa chunk kasy. Wywołuj w momencie, w którym użytkownik zadeklarował
 * zamiar zapłaty (klik/hover „zapłać"), zanim jeszcze wróci `clientSecret` -
 * pobranie kodu idzie wtedy równolegle z tworzeniem sesji u operatora, a nie
 * po niej. Idempotentne: moduł jest cache'owany przez bundler.
 */
export function prefetchEmbeddedCheckoutDialog(): void {
  void loadCheckoutDialog().catch(() => {
    /* brak sieci - Suspense ponowi import przy realnym otwarciu kasy */
  });
}
