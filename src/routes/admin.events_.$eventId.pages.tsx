// /admin/events/<id>/pages - sekcja „Pages and menu" studia wydarzenia.
//
// TRASA JEST CIENKA. Wiersz wydarzenia wczytuje RAMA studia i to ona pokazuje
// spinner oraz zdanie „nie znaleziono"; sekcja, która powtórzyłaby jedno i
// drugie, dawałaby dwa spinnery pod sobą i dwa komunikaty o tym samym braku.
// Dopóki wiersza nie ma, sekcja nie rysuje niczego.
import { createFileRoute } from "@tanstack/react-router";

import { EventPagesMenuPanel } from "@/components/admin/events/organisms/EventPagesMenuPanel";
import { useAdminEventDetail } from "@/lib/events/useAdminEventDetail";

export const Route = createFileRoute("/admin/events_/$eventId/pages")({
  head: () => ({
    meta: [
      { title: "Pages and menu · Event · Admin" },
      { name: "robots", content: "noindex, nofollow" },
      {
        name: "description",
        content: "Event home layout, subpage presentation mode and the event menu.",
      },
    ],
  }),
  component: EventStudioPagesPage,
});

function EventStudioPagesPage() {
  const { eventId } = Route.useParams();
  // Ten sam klucz cache, co w ramie - React Query oddaje wczytany wiersz,
  // a nie drugie zapytanie o to samo wydarzenie.
  const detailQ = useAdminEventDetail(eventId);
  const row = detailQ.data ?? null;
  if (row === null) return null;
  return <EventPagesMenuPanel row={row} />;
}
