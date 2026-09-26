// /admin/events/<id>/communications - sekcja „Komunikacja" studia wydarzenia.
//
// OD F1-F5 TO PRAWDZIWY EKRAN, NIE DROGOWSKAZ. Przypomnienia przed wydarzeniem
// i sesjami, eksport do kalendarza i dziennik doręczeń tego wydarzenia są
// ustawieniami PER WYDARZENIE (`event_participant_settings`), więc mieszkają
// tu. Kampanie i newsletter zostają w module globalnym - panel ma do nich
// wiersz-drogowskaz.
//
// TRASA JEST CIENKA - wzorzec `registration.settings.tsx`: wiersz wydarzenia
// wczytuje rama studia (spinner, „nie znaleziono"), a dopóki go nie ma,
// sekcja nie rysuje niczego. Nagłówek dokumentu: sam tytuł i `robots`
// (R-ROUTE).
import { createFileRoute } from "@tanstack/react-router";

import { EventCommunicationsPanel } from "@/components/admin/events/organisms/EventCommunicationsPanel";
import { useAdminEventDetail } from "@/lib/events/useAdminEventDetail";

export const Route = createFileRoute("/admin/events_/$eventId/communications")({
  head: () => ({
    meta: [
      { title: "Communications · Event · Admin" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: EventStudioCommunicationsPage,
});

function EventStudioCommunicationsPage() {
  const { eventId } = Route.useParams();
  const detailQ = useAdminEventDetail(eventId);
  const row = detailQ.data ?? null;
  if (row === null) return null;
  return <EventCommunicationsPanel row={row} />;
}
