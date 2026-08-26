// /admin/events/<id>/content/speakers - prelegenci wydarzenia.
//
// TA TRASA ZAMYKA OSTATNI POWOD, ZEBY WCHODZIC W `/admin/community/events`.
// Katalog prelegentow byl tam jedyna funkcja bez odpowiednika w studiu, a
// dochodzilo sie do niego przez wyszukanie wydarzenia po slugu i otwarcie
// dialogu edycji - czyli przez wynik wyszukiwania, nie przez wydarzenie.
//
// TRASA JEST CIENKA - wiersz wydarzenia wczytuje rama studia i ona pokazuje
// spinner oraz zdanie „nie znaleziono".
import { createFileRoute } from "@tanstack/react-router";

import { EventContentSpeakersSection } from "@/components/admin/events/studio/EventStudioModuleSections";
import { useAdminEventDetail } from "@/lib/events/useAdminEventDetail";

export const Route = createFileRoute("/admin/events_/$eventId/content/speakers")({
  head: () => ({
    meta: [
      { title: "Speakers · Event · Admin" },
      { name: "robots", content: "noindex, nofollow" },
      { name: "description", content: "Speakers billed for this event and their profiles." },
    ],
  }),
  component: EventStudioContentSpeakersPage,
});

function EventStudioContentSpeakersPage() {
  const { eventId } = Route.useParams();
  const detailQ = useAdminEventDetail(eventId);
  const row = detailQ.data ?? null;
  if (row === null) return null;
  return <EventContentSpeakersSection row={row} />;
}
