// /admin/events/<id>/communications - sekcja „Communications" studia wydarzenia.
//
// SEKCJA BEZ WŁASNEJ POWIERZCHNI PER WYDARZENIE - dlaczego mimo to istnieje
// i dokąd prowadzi, tłumaczy nagłówek `EventStudioExternalSection`.
//
// TRASA NIE PYTA O WIERSZ WYDARZENIA: ekran jest drogowskazem, nie formularzem,
// więc zapytanie o dane, których nie renderuje, byłoby wyłącznie kosztem.
import { createFileRoute } from "@tanstack/react-router";

import { EventStudioExternalSection } from "@/components/admin/events/studio/EventStudioExternalSection";

export const Route = createFileRoute("/admin/events_/$eventId/communications")({
  head: () => ({
    meta: [
      { title: "Communications · Event · Admin" },
      { name: "robots", content: "noindex, nofollow" },
      { name: "description", content: "Where campaigns announcing this event are prepared today." },
    ],
  }),
  component: EventStudioCommunicationsPage,
});

function EventStudioCommunicationsPage() {
  return <EventStudioExternalSection section="communications" />;
}
