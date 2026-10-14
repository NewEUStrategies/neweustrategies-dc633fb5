// Atrybucja kampanii do WLASNEGO zgloszenia i do zamowienia pakietu.
//
// ZGLOSZENIE: LADUNEK Z PRZEGLADARKI, PRZYPIECIE Z SERWERA (REG-04). Do tej
// zmiany przegladarka wolala `event_registration_attribution_attach` sama,
// kluczem `manage_token` z odpowiedzi zapisu. Od zapisu przez serwer
// (`eventRegistration.functions.ts`) przegladarka niezweryfikowanego wolajacego
// klucza samoobslugi juz nie dostaje - dostaje go skrzynka. Dlatego tutaj
// zostaje WYLACZNIE skladanie ladunku (`attributionPayload`), ktory jedzie
// razem z formularzem, a przypina go serwer po zapisie - bez czekania i bez
// komunikatu: brak przypiecia znaczy tylko tyle, ze zgloszenie trafi
// w raporcie do "bez atrybucji".
//
// ZGODA. Bez zgody analytics ani marketing nic nie wychodzi (zgloszenie zostaje
// bez atrybucji). Identyfikator klikniecia jedzie tylko przy zgodzie
// marketingowej - reszte (kanal, UTM) pokrywa zgoda analityczna. Baza tnie to
// samo po swojej stronie (`_event_ads_touch`), wiec klient nie jest jedyna
// zapora. Zgode zna tylko przegladarka (magazyn zgod), wiec ta bramka stoi
// tutaj, a nie na serwerze.
//
// ZAKUP PAKIETU GRUPOWEGO to tez konwersja kampanii (firma kupuje piec miejsc
// po kliknieciu reklamy), ale nie ma zgloszenia ani `manage_token` -
// `attachPackageOrderAttribution` przypina ten sam ladunek do zamowienia
// pakietu, kluczem jest zalogowany kupujacy (`buyer_user_id = auth.uid()`).
import { supabase } from "@/integrations/supabase/client";
import { hasCategoryConsent } from "@/lib/ads/consent";
import { touchWire } from "@/lib/analytics/adAttribution";
import { readAdAttribution } from "@/lib/analytics/adAttributionStore";
import type { RegistrationAttribution } from "@/lib/events/registrationPayload";

/**
 * Atrybucja zamowienia pakietu grupowego (po sukcesie `event_package_purchase`).
 * Te same zasady co przy zgloszeniu: bez zgody nic nie wychodzi, identyfikator
 * klikniecia tylko przy zgodzie marketingowej, nigdy nie rzuca.
 */
export async function attachPackageOrderAttribution(orderId: string): Promise<boolean> {
  const payload = attributionPayload();
  if (payload === null) return false;
  try {
    const { error } = await supabase.rpc("event_package_order_attribution_attach", {
      p_payload: { order_id: orderId, ...payload },
    });
    return error === null;
  } catch {
    return false;
  }
}

/**
 * Dotkniecia do wyslania albo `null` bez zgody na pomiar. Formularz zapisu
 * dokleja wynik do wejscia funkcji serwerowej (`attribution`); `null` znaczy
 * „nic nie wysylaj", a nie „wejscie bezposrednie" (to sa `first`/`last` rowne
 * `null` przy udzielonej zgodzie).
 */
export function attributionPayload(): RegistrationAttribution | null {
  const analytics = hasCategoryConsent("analytics");
  const marketing = hasCategoryConsent("marketing");
  if (!analytics && !marketing) return null;
  const attribution = readAdAttribution({ analytics, marketing }, Date.now());
  return {
    first: attribution === null ? null : touchWire(attribution.first),
    last: attribution === null ? null : touchWire(attribution.last),
    ad_consent: marketing,
  };
}
