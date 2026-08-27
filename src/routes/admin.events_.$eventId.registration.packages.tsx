// /admin/events/<id>/registration/packages - podstrona „Pakiety grupowe" studia.
//
// TRASA JEST CIENKA - wiersz wydarzenia wczytuje rama studia (patrz trasa
// biletów); podstrona nie powtarza spinnera ani komunikatu o braku wydarzenia.
import { createFileRoute } from "@tanstack/react-router";

import { EventRegistrationPackagesSection } from "@/components/admin/events/studio/EventStudioModuleSections";
import { useAdminEventDetail } from "@/lib/events/useAdminEventDetail";

export const Route = createFileRoute("/admin/events_/$eventId/registration/packages")({
  head: () => ({
    meta: [
      { title: "Group packages · Event · Admin" },
      { name: "robots", content: "noindex, nofollow" },
      {
        name: "description",
        content: "Group packages of this event: bulk orders, seats and invitations.",
      },
    ],
  }),
  component: EventStudioRegistrationPackagesPage,
});

function EventStudioRegistrationPackagesPage() {
  const { eventId } = Route.useParams();
  const detailQ = useAdminEventDetail(eventId);
  const row = detailQ.data ?? null;
  if (row === null) return null;
  return <EventRegistrationPackagesSection row={row} />;
}
