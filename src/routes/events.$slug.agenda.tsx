// Zakładka AGENDA wydarzenia: `/events/$slug/agenda`.
//
// PROGRAM RYSUJE `EventAgendaSection` - ten sam organizm, co sekcja „Program”
// na przeglądzie. Zapis na sesję, kolejka rezerwowa, filtry dni i ścieżek oraz
// „moja agenda” już w nim są i jadą przez `event_agenda` / `event_session_signup`.
// Drugi widok programu znaczyłby dwa miejsca, w których trzeba pamiętać
// o unieważnieniu cache po zapisie na sesję.
import { createFileRoute, useParams } from "@tanstack/react-router";

import { EventModulePage } from "@/components/events/public/molecules/EventModulePage";
import { EventAgendaSection } from "@/components/events/public/organisms/EventAgendaSection";
import { buildEventTabHead } from "@/lib/events/eventTabHead";
import { activeLang } from "@/lib/seo/head";
import { getRequestUrl } from "@/lib/seo/request";

export const Route = createFileRoute("/events/$slug/agenda")({
  // Nazwa wydarzenia do nagłówka przychodzi z loadera POWŁOKI - zero
  // round-tripów. `await parentMatchPromise`, bo loadery łańcucha startują
  // równolegle i bez oczekiwania dane rodzica nie istnieją (wzorzec
  // `clubHeadLoader`). Obietnica rodzica nie odrzuca.
  loader: async ({ parentMatchPromise }) => {
    const parent = await parentMatchPromise;
    return { headEvent: parent.loaderData?.headEvent ?? null };
  },
  head: ({ params, loaderData }) => {
    const url = getRequestUrl() || `/events/${params.slug}/agenda`;
    return buildEventTabHead({
      tab: "agenda",
      url,
      lang: activeLang(url),
      event: loaderData?.headEvent ?? null,
    });
  },
  component: EventAgendaTab,
});

function EventAgendaTab() {
  const { slug } = useParams({ from: "/events/$slug/agenda" });
  return (
    <EventModulePage slug={slug} module="agenda">
      <EventAgendaSection slug={slug} />
    </EventModulePage>
  );
}
