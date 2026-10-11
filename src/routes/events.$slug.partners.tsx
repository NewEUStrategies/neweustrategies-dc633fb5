// Zakładka PARTNERZY wydarzenia: `/events/$slug/partners`.
//
// WZORZEC: docs/zrzuty/swapcard-2026-08-23/40-preview-partners-list.png - jedna
// biała karta z wierszami: logotyp, nazwa, zakładka po prawej. Wiersze rozdziela
// sam odstęp (sprawdzone na pikselach: między nimi jest czysta biel).
//
// RYSUJE TO `EventSponsorsSection` z `placement="partners_tab"`, a ten oddaje
// zakładkę `EventPartnersTab`: ścianę logotypów poziomami. Sekcja „Partnerzy"
// na przeglądzie zostaje przy dawnym rysunku (`EventSponsorsSectionView`) -
// zakładka i przegląd czytają tę samą migawkę, więc poziom partnerstwa nadal
// rządzi kolejnością i rozmiarem logotypu na obu powierzchniach.
//
// KAFEL OTWIERA OKNO INSTYTUCJI, NIE STRONĘ FIRMY. Okno (`directory/`) pokazuje
// opis, kraj, stoisko, osoby z tej instytucji na wydarzeniu i wspierane sesje;
// odnośnik na zewnątrz stoi w oknie i prowadzi tam, dokąd organizator ustawił
// logotyp (`PublicSponsor.href` wg `link_mode`) - partner z celem „brak" nie
// dostaje odnośnika także w oknie.
//
// RAPORT SPONSORA ODRÓŻNIA TĘ ZAKŁADKĘ OD SEKCJI NA PRZEGLĄDZIE: wyświetlenia
// kafli i klik w stronę partnera w oknie liczą się tu pod miejscem
// `partners_tab`, a nie `partners_section`.
import { createFileRoute, useParams } from "@tanstack/react-router";

import { EventModulePage } from "@/components/events/public/molecules/EventModulePage";
import { EventSponsorsSection } from "@/components/events/public/organisms/EventSponsorsSection";

import { buildEventTabHead } from "@/lib/events/eventTabHead";
import { activeLang } from "@/lib/seo/head";
import { getRequestUrl } from "@/lib/seo/request";

export const Route = createFileRoute("/events/$slug/partners")({
  loader: async ({ parentMatchPromise }) => {
    const parent = await parentMatchPromise;
    return { headEvent: parent.loaderData?.headEvent ?? null };
  },
  head: ({ params, loaderData }) => {
    const url = getRequestUrl() || `/events/${params.slug}/partners`;
    return buildEventTabHead({
      tab: "partners",
      url,
      lang: activeLang(url),
      event: loaderData?.headEvent ?? null,
    });
  },
  component: EventPartnersTab,
});

function EventPartnersTab() {
  const { slug } = useParams({ from: "/events/$slug/partners" });
  return (
    <EventModulePage slug={slug} module="partners">
      <EventSponsorsSection slug={slug} placement="partners_tab" />
    </EventModulePage>
  );
}
