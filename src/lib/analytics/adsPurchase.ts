// Konwersja zakupu Google Ads zgłaszana bezpośrednio tagiem strony.
//
// DLACZEGO NIE IMPORT Z GA4. Zakup z webhooka idzie do GA4 przez Measurement
// Protocol z zastępczym `client_id`, więc nie łączy się z kliknięciem reklamy,
// a przeglądarka nie wysyłała `purchase` wcale. Akcja "NES - Zakup (tag
// strony)" (typ WEBPAGE, główna w kategorii PURCHASE; import GA4 jest
// dodatkowy) dostaje zakup z tej samej karty co kliknięcie reklamy.
//
// KIEDY. Wyłącznie po potwierdzonej płatności - w tych samych miejscach co
// Purchase/Subscribe/Donate piksela Meta (zużyty znacznik kasy na stronie
// powrotu albo zamówienie biletu odczytane z bazy jako `paid`). Próbny okres
// bez opłaty nie jest zakupem. Ads deduplikuje po `transaction_id`.
//
// ZGODA. Tylko po zgodzie marketingowej; bez niej nic nie wychodzi.
import { hasCategoryConsent } from "@/lib/ads/consent";
import { adsConversion } from "./conversions";
import { trackLinkedInGoal } from "./linkedinInsightEvents";
import { recordAdPixelConversion } from "./adPixelTelemetry";
import { DEFAULT_GOOGLE_ADS_LABELS, googleAdsLabel } from "./googleAdsGoals";

/** Wbudowana etykieta akcji "NES - Zakup (tag strony)"; bieżącą zwraca `googleAdsLabel`. */
export const ADS_PURCHASE_LABEL = DEFAULT_GOOGLE_ADS_LABELS.purchase;

const CURRENCY_RE = /^[A-Z]{3}$/;

export interface AdsPurchaseInput {
  /** Trwały identyfikator płatności (zamówienie / identyfikator zdarzenia kasy). */
  transactionId: string;
  /** Kwota w jednostkach waluty (np. 49.00). */
  value: number;
  currency: string;
}

/** Zwraca `true`, gdy konwersja została przekazana do tagu. */
export function trackAdsPurchase(input: AdsPurchaseInput): boolean {
  if (typeof window === "undefined") return false;
  if (!hasCategoryConsent("marketing")) return false;
  const transactionId = input.transactionId.trim().slice(0, 64);
  const currency = input.currency.trim().toUpperCase();
  if (!transactionId || !CURRENCY_RE.test(currency)) return false;
  if (!Number.isFinite(input.value) || input.value <= 0) return false;
  adsConversion(googleAdsLabel("purchase"), {
    value: Math.round(input.value * 100) / 100,
    currency,
    transaction_id: transactionId,
  });
  // LinkedIn Ads: ta sama potwierdzona płatność, `event_id` = transakcja.
  trackLinkedInGoal("purchase", { eventId: transactionId });
  recordAdPixelConversion("purchase");
  return true;
}
