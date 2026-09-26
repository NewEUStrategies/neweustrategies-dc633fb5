// Przypiecie atrybucji kampanii do WLASNEGO zgloszenia - zaraz po sukcesie
// `event_register`, kluczem `manage_token`, ktory baza zwraca raz.
//
// DLACZEGO OSOBNE RPC, A NIE POLE W `event_register`. Zapis na wydarzenie ma
// 450 linii redefiniowanych piec razy; atrybucja jest dodatkiem, ktorego
// awaria nie moze uniewaznic zapisu. Tu wolamy `event_registration_attribution_
// attach` po fakcie, bez czekania i bez komunikatu - brak przypiecia znaczy
// tylko tyle, ze zgloszenie trafi w raporcie do "bez atrybucji".
//
// ZGODA. Bez zgody analytics ani marketing nic nie wychodzi (zgloszenie zostaje
// bez atrybucji). Identyfikator klikniecia jedzie tylko przy zgodzie
// marketingowej - reszte (kanal, UTM) pokrywa zgoda analityczna. Baza tnie to
// samo po swojej stronie (`_event_ads_touch`), wiec klient nie jest jedyna
// zapora.
//
// Klucz samoobslugi nie trafia ani do cache zapytan, ani do magazynu - zyje
// w argumencie tego wywolania.
import { supabase } from "@/integrations/supabase/client";
import { hasCategoryConsent } from "@/lib/ads/consent";
import { touchWire } from "@/lib/analytics/adAttribution";
import { readAdAttribution } from "@/lib/analytics/adAttributionStore";

/**
 * Wysyla atrybucje zgloszenia. `true` = baza przyjela wywolanie (takze
 * "juz przypiete"); `false` = brak zgody albo blad. Nigdy nie rzuca.
 */
export async function attachRegistrationAttribution(manageToken: string): Promise<boolean> {
  const analytics = hasCategoryConsent("analytics");
  const marketing = hasCategoryConsent("marketing");
  if (!analytics && !marketing) return false;
  const attribution = readAdAttribution({ analytics, marketing }, Date.now());
  try {
    const { error } = await supabase.rpc("event_registration_attribution_attach", {
      p_payload: {
        manage_token: manageToken,
        first: attribution === null ? null : touchWire(attribution.first),
        last: attribution === null ? null : touchWire(attribution.last),
        ad_consent: marketing,
      },
    });
    return error === null;
  } catch {
    return false;
  }
}
