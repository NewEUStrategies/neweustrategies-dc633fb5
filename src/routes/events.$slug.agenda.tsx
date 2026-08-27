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
