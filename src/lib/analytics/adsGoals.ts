// Cele konwersji Google Ads zdefiniowane jako zdarzenia tagu Google
// (panel Ads -> Cele -> "Konfiguracja za pomoca tagu Google").
//
// Ads generuje dla kazdego celu fragment `gtag('event', '<nazwa>', {})` bez
// `send_to` - takie zdarzenie trafia do WSZYSTKICH skonfigurowanych miejsc
// docelowych tagu (GA4 + Google Ads po zgodzie marketingowej, patrz
// `ga4ConfigureAds`), a Ads dopasowuje je po NAZWIE do celu. Nazwy pochodza
// 1:1 z fragmentow dostarczonych przez wlasciciela (2026-10-22) - zmiana
// litery odcina cel od pomiaru, wiec sa stale i objete testem.
//
// ZGODA. `ga4Event` wpada do `window.dataLayer`; bez zgody marketingowej
// Consent Mode trzyma `ad_storage: denied` i Ads nie zaliczy konwersji
// (zdarzenie liczy nadal GA4). To zamierzone - cel reklamowy nie moze
// obchodzic decyzji odwiedzajacego.
//
// MOMENT WYZWOLENIA. Konwersje formularza i rejestracji odpalamy WYLACZNIE
// po potwierdzeniu zapisu przez serwer, nigdy na klikniecie "wyslij" -
// inaczej Ads liczylby odrzucone proby. Cele odsłon ida z `ga4PageView`,
// czyli raz na faktycznie wyrenderowana strone SPA.

import { ga4Event } from "./ga4Client";

/** "Wyswietlenie strony" - cel 1 (fragment: ads_conversion_www). */
export const ADS_GOAL_PAGE_VIEW_WWW = "ads_conversion_www";
/** "Wyswietlenie strony" - cel 2 (fragment: ads_conversion_PAGE_VIEW_1). */
export const ADS_GOAL_PAGE_VIEW_1 = "ads_conversion_PAGE_VIEW_1";
/** "Rejestracja" konta (fragment: ads_conversion_Strona_rejestracji_1). */
export const ADS_GOAL_REGISTRATION = "ads_conversion_Strona_rejestracji_1";
/** "Przeslanie formularza kontaktowego" - wariant strony (fragment: ads_conversion_Formularz_1). */
export const ADS_GOAL_FORM_PAGE = "ads_conversion_Formularz_1";
/** "Przeslanie formularza kontaktowego" - wariant klikniecia (fragment: ads_submit_form). */
export const ADS_GOAL_FORM_SUBMIT = "ads_submit_form";

/**
 * Cele odsłon. Wołane z `ga4PageView`, wiec dokladnie raz na wyrenderowana
 * strone (pierwsza odsłona SSR + kazda nawigacja SPA) - zgodnie z zaleceniem
 * Ads "wklej na tych stronach, ktore chcesz objac pomiarem" (u nas: cala
 * witryna). Bez parametrow - fragmenty Ads ich nie niosa.
 */
export function trackAdsPageViewGoals(): void {
  ga4Event(ADS_GOAL_PAGE_VIEW_WWW);
  ga4Event(ADS_GOAL_PAGE_VIEW_1);
}

/**
 * Cel rejestracji konta. Wołac PO udanym `supabase.auth.signUp` (konto
 * utworzone), nigdy na wejscie w formularz ani na klikniecie "Zarejestruj".
 */
export function trackAdsRegistrationGoal(): void {
  ga4Event(ADS_GOAL_REGISTRATION);
}

/**
 * Cele formularza kontaktowego. Wołac PO potwierdzeniu zapisu przez serwer
 * (to samo miejsce co `trackFormConversion`): Ads skonfigurowal ten cel
 * dwoma wariantami - wczytania strony z formularzem i klikniecia - a oba
 * fragmenty maja sie zrealizowac przy faktycznym przeslaniu.
 */
export function trackAdsFormGoals(): void {
  ga4Event(ADS_GOAL_FORM_PAGE);
  ga4Event(ADS_GOAL_FORM_SUBMIT);
}
