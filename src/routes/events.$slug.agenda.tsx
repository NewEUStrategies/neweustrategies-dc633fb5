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

export const Route = createFileRoute("/events/$slug/agenda")({
  head: () => ({
    meta: [
      { title: "Program wydarzenia - New European Strategies" },
      {
        name: "description",
        content: "Dni, ścieżki, debaty i sesje programu wydarzenia New European Strategies.",
      },
      { property: "og:title", content: "Program wydarzenia - New European Strategies" },
      {
        property: "og:description",
        content: "Dni, ścieżki, debaty i sesje programu wydarzenia New European Strategies.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
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
