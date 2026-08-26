// /admin/events/<id>/overview - sekcja „Overview" studia wydarzenia.
//
// TRASA JEST CIENKA. Wiersz wydarzenia wczytuje RAMA studia i to ona pokazuje
// spinner oraz zdanie „nie znaleziono"; sekcja, która powtórzyłaby jedno i
// drugie, dawałaby dwa spinnery pod sobą i dwa komunikaty o tym samym braku.
// Dopóki wiersza nie ma, sekcja nie rysuje niczego.
//
// PULPIT JEST PIERWSZY W SIDEBARZE, ale NIE jest ekranem startowym studia:
// wejście bez sekcji prowadzi na „Informacje ogólne", bo przy nowym wydarzeniu
// pulpit ma jeszcze o czym mówić tylko tyle, że nic nie jest zrobione.
import { createFileRoute } from "@tanstack/react-router";

import { EventOverviewPanel } from "@/components/admin/events/organisms/EventOverviewPanel";
import { useAdminEventDetail } from "@/lib/events/useAdminEventDetail";

export const Route = createFileRoute("/admin/events_/$eventId/overview")({
  head: () => ({
    meta: [
      { title: "Overview · Event · Admin" },
      { name: "robots", content: "noindex, nofollow" },
      {
        name: "description",
        content: "Event dashboard: live counts, remaining steps and shortcuts into the studio.",
      },
    ],
  }),
  component: EventStudioOverviewPage,
});

function EventStudioOverviewPage() {
  const { eventId } = Route.useParams();
  // Ten sam klucz cache, co w ramie - React Query oddaje wczytany wiersz,
  // a nie drugie zapytanie o to samo wydarzenie.
  const detailQ = useAdminEventDetail(eventId);
  const row = detailQ.data ?? null;
  if (row === null) return null;
  return <EventOverviewPanel row={row} />;
}
