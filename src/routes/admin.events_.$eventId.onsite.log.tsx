// /admin/events/<id>/onsite/log - podstrona „Check-in log" studia wydarzenia.
//
// TRASA JEST CIENKA. Wiersz wydarzenia wczytuje RAMA studia i to ona pokazuje
// spinner oraz zdanie „nie znaleziono"; podstrona, która powtórzyłaby jedno i
// drugie, dawałaby dwa spinnery pod sobą i dwa komunikaty o tym samym braku.
// Dopóki wiersza nie ma, podstrona nie rysuje niczego.
import { createFileRoute } from "@tanstack/react-router";

import { EventOnsiteLogSection } from "@/components/admin/events/studio/EventStudioModuleSections";
import { useAdminEventDetail } from "@/lib/events/useAdminEventDetail";

export const Route = createFileRoute("/admin/events_/$eventId/onsite/log")({
  head: () => ({
    meta: [
      { title: "Check-in log · Event · Admin" },
      { name: "robots", content: "noindex, nofollow" },
      {
        name: "description",
        content: "History of check-in events recorded at this event.",
      },
    ],
  }),
  component: EventStudioOnsiteLogPage,
});

function EventStudioOnsiteLogPage() {
  const { eventId } = Route.useParams();
  // Ten sam klucz cache, co w ramie - React Query oddaje wczytany wiersz,
  // a nie drugie zapytanie o to samo wydarzenie.
  const detailQ = useAdminEventDetail(eventId);
  const row = detailQ.data ?? null;
  if (row === null) return null;
  return <EventOnsiteLogSection row={row} />;
}
