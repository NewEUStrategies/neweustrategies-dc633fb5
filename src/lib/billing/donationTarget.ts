// Jedno źródło prawdy o tym, DOKĄD prowadzi przycisk darowizny.
//
// Przed tą warstwą każda powierzchnia decydowała sama: `/donate` otwierało
// własną kasę, a `/support`, CTA widgetu CMS i pozycja nawigacji szły na sztywno
// na zewnętrzną zbiórkę - relikt trybu awaryjnego. Po przełączeniu modułu na
// własny checkout serwis wysyłał więc darczyńcę raz tu, raz tam, zależnie od
// tego, który przycisk kliknął.
//
// Cel wyznacza wyłącznie konfiguracja (`site_settings.donations`), a wszystkie
// powierzchnie czytają tę samą funkcję. Moduł jest CZYSTY i client-safe -
// bez zapytań i bez importów serwerowych, więc nadaje się i do SSR, i do testu
// jednostkowego.
import { EXTERNAL_DONATIONS_URL } from "@/lib/billing/donationsExternal";
import type { DonationsConfig } from "@/lib/billing/donationsConfig";

/** Ścieżka publicznego formularza własnej kasy. */
export const INTERNAL_DONATION_PATH = "/donate";

export type DonationTarget =
  /** Nasza kasa - nawigacja wewnętrzna, bez opuszczania serwisu. */
  | { kind: "internal"; href: typeof INTERNAL_DONATION_PATH; external: false }
  /** Zbiórka zewnętrzna - nowa karta z twardymi atrybutami bezpieczeństwa. */
  | { kind: "external"; href: string; external: true }
  /** Moduł wyłączony - powierzchnia nie może zapraszać do wpłaty. */
  | { kind: "disabled"; href: null; external: false };

/**
 * Cel wpłaty dla bieżącej konfiguracji.
 *
 * Reguły (dokładnie te same, co w `DonationForm`, żeby przycisk i formularz
 * nigdy nie mówiły dwóch różnych rzeczy):
 *   1. moduł wyłączony -> brak celu,
 *   2. `provider: "stripe"` -> nasz formularz `/donate`,
 *   3. `provider: "external"` -> adres zbiórki z ustawień; pusty adres spada
 *      na stałą awaryjną, bo CTA bez `href` jest gorsze niż CTA na zbiórkę.
 */
export function resolveDonationTarget(config: DonationsConfig): DonationTarget {
  if (!config.enabled) return { kind: "disabled", href: null, external: false };
  if (config.provider === "external") {
    const href = config.externalUrl.trim() || EXTERNAL_DONATIONS_URL;
    return { kind: "external", href, external: true };
  }
  return { kind: "internal", href: INTERNAL_DONATION_PATH, external: false };
}
