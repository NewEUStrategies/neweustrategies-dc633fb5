// /admin/events/<id>/analytics - sekcja „Analytics" studia wydarzenia.
//
// SEKCJA BEZ WŁASNEJ POWIERZCHNI PER WYDARZENIE - dlaczego mimo to istnieje
// i dokąd prowadzi, tłumaczy nagłówek `EventStudioExternalSection`.
//
// TRASA NIE PYTA O WIERSZ WYDARZENIA: ekran jest drogowskazem, nie formularzem,
// więc zapytanie o dane, których nie renderuje, byłoby wyłącznie kosztem.
import { createFileRoute } from "@tanstack/react-router";

import { EventStudioExternalSection } from "@/components/admin/events/studio/EventStudioExternalSection";

export const Route = createFileRoute("/admin/events_/$eventId/analytics")({
  head: () => ({
    meta: [
      { title: "Analytics · Event · Admin" },
      { name: "robots", content: "noindex, nofollow" },
      {
        name: "description",
        content: "Where traffic and conversion data for this event is read today.",
      },
    ],
  }),
  component: EventStudioAnalyticsPage,
});

function EventStudioAnalyticsPage() {
  return <EventStudioExternalSection section="analytics" />;
}
