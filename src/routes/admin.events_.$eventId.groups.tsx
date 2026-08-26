// /admin/events/<id>/groups - sekcja „Groups and permissions" studia wydarzenia.
//
// TRASA JEST CIENKA. Wiersz wydarzenia wczytuje RAMA studia i to ona pokazuje
// spinner oraz zdanie „nie znaleziono"; sekcja, która powtórzyłaby jedno i
// drugie, dawałaby dwa spinnery pod sobą i dwa komunikaty o tym samym braku.
// Dopóki wiersza nie ma, sekcja nie rysuje niczego.
import { createFileRoute } from "@tanstack/react-router";

import { EventGroupsPermissionsPanel } from "@/components/admin/events/organisms/EventGroupsPermissionsPanel";
import { useAdminEventDetail } from "@/lib/events/useAdminEventDetail";

export const Route = createFileRoute("/admin/events_/$eventId/groups")({
  head: () => ({
    meta: [
      { title: "Groups and permissions · Event · Admin" },
      { name: "robots", content: "noindex, nofollow" },
      {
        name: "description",
        content: "Participant groups of the event and what each group may see and do.",
      },
    ],
  }),
  component: EventStudioGroupsPage,
});

function EventStudioGroupsPage() {
  const { eventId } = Route.useParams();
  // Ten sam klucz cache, co w ramie - React Query oddaje wczytany wiersz,
  // a nie drugie zapytanie o to samo wydarzenie.
  const detailQ = useAdminEventDetail(eventId);
  const row = detailQ.data ?? null;
  if (row === null) return null;
  return <EventGroupsPermissionsPanel row={row} />;
}
