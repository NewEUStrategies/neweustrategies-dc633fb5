// /admin/events/<id>/features - sekcja „Features" studia wydarzenia.
//
// SEKCJA BEZ WŁASNEJ POWIERZCHNI PER WYDARZENIE - dlaczego mimo to istnieje
// i dokąd prowadzi, tłumaczy nagłówek `EventStudioExternalSection`.
//
// TRASA NIE PYTA O WIERSZ WYDARZENIA: ekran jest drogowskazem, nie formularzem,
// więc zapytanie o dane, których nie renderuje, byłoby wyłącznie kosztem.
import { createFileRoute } from "@tanstack/react-router";

import { EventStudioExternalSection } from "@/components/admin/events/studio/EventStudioExternalSection";

export const Route = createFileRoute("/admin/events_/$eventId/features")({
  head: () => ({
    meta: [
      { title: "Features · Event · Admin" },
      { name: "robots", content: "noindex, nofollow" },
      { name: "description", content: "State of the per-event module switches." },
    ],
  }),
  component: EventStudioFeaturesPage,
});

function EventStudioFeaturesPage() {
  return <EventStudioExternalSection section="features" />;
}
