// Konwersje Google Ads zgłaszane bezpośrednio tagiem strony (akcje WEBPAGE).
//
// DLACZEGO NIE TYLKO IMPORT Z GA4. Import z GA4 przychodzi z opóźnieniem,
// zależy od połączenia kont i liczy "każdą" konwersję po kliknięciu (typ
// liczenia importu jest niezmienny). Akcje WEBPAGE liczą raz na kliknięcie
// (Ad Grants: jedna konwersja na zapis) i są GŁÓWNE; importy GA4 tych samych
// zdarzeń są dodatkowe, więc nic nie liczy się podwójnie.
//
// KIEDY. Wyłącznie po potwierdzeniu przez serwer (w tych samych miejscach co
// zdarzenia wyniku piksela Meta). ZGODA: tylko po zgodzie marketingowej.
// Ten sam wynik idzie też jako konwersja LinkedIn Ads (`trackLinkedInGoal`),
// więc każdy kanał reklamowy liczy go w jednym, wspólnym miejscu.
import { hasCategoryConsent } from "@/lib/ads/consent";
import { adsConversion } from "./conversions";
import { trackLinkedInGoal } from "./linkedinInsightEvents";
import { recordAdPixelConversion } from "./adPixelTelemetry";
import { DEFAULT_GOOGLE_ADS_LABELS, googleAdsLabel, type GoogleAdsGoal } from "./googleAdsGoals";

export type AdsNativeGoal = Exclude<GoogleAdsGoal, "purchase">;

/**
 * Etykiety wbudowane (konto 251-385-9854). Bieżące wartości z panelu
 * (Pixels -> Google Ads) zwraca `googleAdsLabel`.
 */
export const ADS_GOAL_LABELS: Readonly<Record<AdsNativeGoal, string>> = {
  contact_form: DEFAULT_GOOGLE_ADS_LABELS.contact_form,
  club_application: DEFAULT_GOOGLE_ADS_LABELS.club_application,
  account_signup: DEFAULT_GOOGLE_ADS_LABELS.account_signup,
  newsletter: DEFAULT_GOOGLE_ADS_LABELS.newsletter,
  event_registration: DEFAULT_GOOGLE_ADS_LABELS.event_registration,
};

/**
 * Rodzaj konwersji w lustrze panelu "Piksele Ads". Formularz i rejestracja
 * zachowują dotychczasowe nazwy, więc historia wykresów się nie rozjeżdża.
 */
export const AD_PIXEL_KIND_BY_GOAL: Readonly<Record<AdsNativeGoal, string>> = {
  contact_form: "form_submit",
  club_application: "club_application",
  account_signup: "registration",
  newsletter: "newsletter",
  event_registration: "event_registration",
};

/** Zwraca `true`, gdy konwersja została przekazana do tagu. */
export function trackAdsGoal(goal: AdsNativeGoal): boolean {
  if (typeof window === "undefined") return false;
  if (!hasCategoryConsent("marketing")) return false;
  adsConversion(googleAdsLabel(goal));
  trackLinkedInGoal(goal);
  recordAdPixelConversion(AD_PIXEL_KIND_BY_GOAL[goal]);
  return true;
}
