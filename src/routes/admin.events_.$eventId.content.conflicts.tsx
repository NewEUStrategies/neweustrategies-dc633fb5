// /admin/events/<id>/content/conflicts - podstrona „Agenda conflicts" studia wydarzenia.
//
// TRASA JEST CIENKA. Wiersz wydarzenia wczytuje RAMA studia i to ona pokazuje
// spinner oraz zdanie „nie znaleziono"; podstrona, która powtórzyłaby jedno i
// drugie, dawałaby dwa spinnery pod sobą i dwa komunikaty o tym samym braku.
// Dopóki wiersza nie ma, podstrona nie rysuje niczego.
import { createFileRoute } from "@tanstack/react-router";

import { EventContentConflictsSection } from "@/components/admin/events/studio/EventStudioModuleSections";
import { useAdminEventDetail } from "@/lib/events/useAdminEventDetail";

export const Route = createFileRoute("/admin/events_/$eventId/content/conflicts")({
  head: () => ({
    meta: [
      { title: "Agenda conflicts · Event · Admin" },
      { name: "robots", content: "noindex, nofollow" },
      {
        name: "description",
        content: "Overlapping sessions of this event: same room, same speaker, same slot.",
      },
    ],
  }),
  component: EventStudioContentConflictsPage,
});

function EventStudioContentConflictsPage() {
  const { eventId } = Route.useParams();
  // Ten sam klucz cache, co w ramie - React Query oddaje wczytany wiersz,
  // a nie drugie zapytanie o to samo wydarzenie.
  const detailQ = useAdminEventDetail(eventId);
  const row = detailQ.data ?? null;
  if (row === null) return null;
  return <EventContentConflictsSection row={row} />;
}
