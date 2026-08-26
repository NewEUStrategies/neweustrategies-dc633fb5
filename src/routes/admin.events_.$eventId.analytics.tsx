// /admin/events/<id>/analytics - sekcja „Analityka" studia wydarzenia.
//
// TA SEKCJA MA WLASNA POWIERZCHNIE, bo ma z czego liczyc. Zapisy, program,
// gielda spotkan i odprawa licza swoje statystyki po stronie bazy od tygodni -
// ekran je SKLADA, a nie liczy po raz szosty. Drogowskaz do modulu globalnego
// zostaje na dole panelu: ruch na stronie (odslony, zrodla, konwersje) nie jest
// wielkoscia wydarzenia i nie ma sensu udawac, ze wydarzenie ma wlasny licznik.
//
// TRASA JEST CIENKA - wiersz wydarzenia wczytuje rama studia i ona pokazuje
// spinner oraz zdanie „nie znaleziono".
import { createFileRoute } from "@tanstack/react-router";

import { EventAnalyticsPanel } from "@/components/admin/events/organisms/EventAnalyticsPanel";
import { useAdminEventDetail } from "@/lib/events/useAdminEventDetail";

export const Route = createFileRoute("/admin/events_/$eventId/analytics")({
  head: () => ({
    meta: [
      { title: "Analytics · Event · Admin" },
      { name: "robots", content: "noindex, nofollow" },
      {
        name: "description",
        content: "Registrations, programme, meetings and check-in figures for this event.",
      },
    ],
  }),
  component: EventStudioAnalyticsPage,
});

function EventStudioAnalyticsPage() {
  const { eventId } = Route.useParams();
  const detailQ = useAdminEventDetail(eventId);
  const row = detailQ.data ?? null;
  if (row === null) return null;
  return <EventAnalyticsPanel row={row} />;
}
