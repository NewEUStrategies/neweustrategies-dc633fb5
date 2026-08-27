// Zakładka PARTNERZY wydarzenia: `/events/$slug/partners`.
//
// WZORZEC: docs/zrzuty/swapcard-2026-08-23/40-preview-partners-list.png - jedna
// biała karta z wierszami: logotyp, nazwa, zakładka po prawej. Wiersze rozdziela
// sam odstęp (sprawdzone na pikselach: między nimi jest czysta biel).
//
// RYSUJE TO `EventSponsorsSection`, TEN SAM, KTÓRY STOI W SEKCJI „PARTNERZY”
// NA PRZEGLĄDZIE. To jest świadome: poziom partnerstwa rządzi rozmiarem
// logotypu i kolejnością na KAŻDEJ powierzchni, na której partner się pojawia,
// bo to treść umowy, a nie ozdoba. Drugi widok listy partnerów rozjechałby się
// z pierwszym przy pierwszej zmianie poziomów.
//
// PROFIL POJEDYNCZEGO WYSTAWCY (zrzut 41) TO DRUGA FALA i tej trasy jeszcze nie
// ma. Dlatego wiersz partnera NIE UDAJE, że gdzieś prowadzi: klikalny jest
// wyłącznie ten, który ma własny adres strony w migawce (`website_url`),
// i wychodzi wtedy na zewnątrz. Reszta jest zwykłym tekstem - kursor łapki nad
// elementem, który nic nie robi, jest gorszy od braku odnośnika.
import { createFileRoute, useParams } from "@tanstack/react-router";

import { EventModulePage } from "@/components/events/public/molecules/EventModulePage";
import { EventSponsorsSection } from "@/components/events/public/organisms/EventSponsorsSection";

export const Route = createFileRoute("/events/$slug/partners")({
  component: EventPartnersTab,
});

function EventPartnersTab() {
  const { slug } = useParams({ from: "/events/$slug/partners" });
  return (
    <EventModulePage slug={slug} module="partners">
      <EventSponsorsSection slug={slug} />
    </EventModulePage>
  );
}
