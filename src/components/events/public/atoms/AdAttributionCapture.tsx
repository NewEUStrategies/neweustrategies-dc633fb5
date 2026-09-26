// Atom bez wygladu: przechwytuje atrybucje kampanii i (opcjonalnie) wysyla
// krok lejka "wizyta" dla wydarzenia.
//
// GDZIE MIESZKA. Wylacznie na publicznych powierzchniach wydarzenia: powloka
// `/events/$slug`, zapis `/events/$slug/register` i pakiety
// `/events/$slug/packages` - NIE w `__root`. Atrybucja sluzy lejkowi wydarzenia,
// a atom w korzeniu czytalby adres kazdej strony serwisu.
//
// SSR I HYDRATACJA. Renderuje `null` i CALA praca dzieje sie w efektach, po
// hydratacji. Dokument z `?gclid=...` i bez niego to te same bajty z cache
// brzegowego (parametry klikniec sa poza kluczem `documentCache.ts`), wiec
// nic, co zalezy od adresu, nie moze trafic do HTML-a.
//
// ZGODA BEZ `useConsent`. Kazda instancja tego hooka zaklada wlasny nasluch
// sesji Supabase i przy zalogowaniu czyta profil - atom dokladalby drugi odczyt
// profilu na kazda strone wydarzenia. Zamiast tego czytamy aktywna zgode
// (`hasCategoryConsent`: zapis, podglad i klamra GPC) i sluchamy jej zmian
// (`subscribeConsentChange`).
//
// KOLEJNOSC PRACY JEST CZESCIA KONTRAKTU:
//   1. przechwycenie adresu do PAMIECI (bez magazynu - zgody moze jeszcze nie
//      byc, baner pojawia sie pozniej);
//   2. zapis/skasowanie magazynu wedlug zgody - powtarzany przy kazdej zmianie
//      zgody (takze cofnieciu i sygnale GPC);
//   3. beacon "wizyta" - PO przechwyceniu, zeby niosl swiezo przechwycone
//      dotkniecie; ponawiany po zmianie zgody (zgoda analytics udzielona po
//      wejsciu), powtorke w sesji odrzuca sam beacon. Prerender spekulacyjny
//      nie strzela - ani wizyta, ani jej ponowienie - az do aktywacji strony.
// Adresu NIE zmieniamy - gtag.js czyta z niego `gclid`.
import { useEffect } from "react";

import { hasCategoryConsent, subscribeConsentChange } from "@/lib/ads/consent";
import { captureAdLanding, persistAdAttribution } from "@/lib/analytics/adAttributionStore";
import { sendEventFunnelStep } from "@/lib/events/eventFunnelBeacon";
import { afterPrerendering } from "@/lib/prerender";

export function AdAttributionCapture({ eventSlug }: { eventSlug?: string }): null {
  useEffect(() => {
    captureAdLanding({
      search: window.location.search,
      pathname: window.location.pathname,
      referrer: document.referrer,
      host: window.location.hostname,
      nowMs: Date.now(),
    });
    const persist = (): void =>
      persistAdAttribution(
        { analytics: hasCategoryConsent("analytics"), marketing: hasCategoryConsent("marketing") },
        Date.now(),
      );
    persist();
    return subscribeConsentChange(persist);
  }, []);

  useEffect(() => {
    if (eventSlug === undefined) return;
    const visit = (): void => {
      sendEventFunnelStep("visit", { slug: eventSlug });
    };
    let off = (): void => undefined;
    const cancelPrerender = afterPrerendering(() => {
      visit();
      off = subscribeConsentChange(visit);
    });
    return () => {
      cancelPrerender();
      off();
    };
  }, [eventSlug]);

  return null;
}
