// /admin/events/<id>/registration/audiences - podstrona „Uprawnienia do stawek".
//
// TRASA JEST CIENKA - wiersz wydarzenia wczytuje rama studia; podstrona nie
// powtarza spinnera ani komunikatu o braku wydarzenia.
import { createFileRoute } from "@tanstack/react-router";

import { EventRegistrationAudiencesSection } from "@/components/admin/events/studio/EventStudioModuleSections";
import { useAdminEventDetail } from "@/lib/events/useAdminEventDetail";

export const Route = createFileRoute("/admin/events_/$eventId/registration/audiences")({
  head: () => ({
    meta: [
      { title: "Rate eligibility · Event · Admin" },
      { name: "robots", content: "noindex, nofollow" },
      {
        name: "description",
        content: "Academic, NGO and corporate rate eligibility granted for this event.",
      },
    ],
  }),
  component: EventStudioRegistrationAudiencesPage,
});

function EventStudioRegistrationAudiencesPage() {
  const { eventId } = Route.useParams();
  const detailQ = useAdminEventDetail(eventId);
  const row = detailQ.data ?? null;
  if (row === null) return null;
  return <EventRegistrationAudiencesSection row={row} />;
}
