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

/** Etykiety akcji z fragmentów zdarzeń Google Ads (konto 251-385-9854). */
export const ADS_GOAL_LABELS = {
  contact_form: "p9kvCLTkwbwdEMD6kM5B",
  club_application: "7VqPCLfkwbwdEMD6kM5B",
  account_signup: "I7B9CLrkwbwdEMD6kM5B",
  newsletter: "YsEPCL3kwbwdEMD6kM5B",
  event_registration: "zi3kCMDkwbwdEMD6kM5B",
} as const;

export type AdsNativeGoal = keyof typeof ADS_GOAL_LABELS;

/** Zwraca `true`, gdy konwersja została przekazana do tagu. */
export function trackAdsGoal(goal: AdsNativeGoal): boolean {
  if (typeof window === "undefined") return false;
  if (!hasCategoryConsent("marketing")) return false;
  adsConversion(ADS_GOAL_LABELS[goal]);
  trackLinkedInGoal(goal);
  return true;
}
