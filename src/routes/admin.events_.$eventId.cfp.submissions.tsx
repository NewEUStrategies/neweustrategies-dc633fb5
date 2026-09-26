// /admin/events/<id>/cfp/submissions - ekran „Zgłoszenia" studia wydarzenia.
//
// CIAŁO EKRANU TO ORGANIZM `CfpSubmissionsPanel` (agent f1, nabór prelegentów). Trasa,
// pozycja w sidebarze (`EVENT_STUDIO_NAV`), klucz sekcji (`cfpSubmissions`) i tytuł
// (`adminEvents.studio.sections.cfpSubmissions`) pochodzą z fundamentu i się nie zmieniają.
//
// TRASA JEST CIENKA. Wiersz wydarzenia wczytuje RAMA studia i to ona pokazuje
// spinner oraz zdanie „nie znaleziono"; ekran, który powtórzyłby jedno i
// drugie, dawałby dwa spinnery pod sobą. Dopóki wiersza nie ma, ekran nie
// rysuje niczego.
import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";

import { EventStudioPage } from "@/components/admin/events/studio/EventStudioSection";
import { CfpSubmissionsPanel } from "@/components/admin/events/organisms/CfpSubmissionsPanel";
import { useAdminEventDetail } from "@/lib/events/useAdminEventDetail";
import { ensureI18n } from "@/lib/i18n-admin-events";

export const Route = createFileRoute("/admin/events_/$eventId/cfp/submissions")({
  head: () => ({
    meta: [
      { title: "Call for speakers · Submissions · Event · Admin" },
      { name: "robots", content: "noindex, nofollow" },
      {
        name: "description",
        content: "Talk submissions of this event with reviews and decisions.",
      },
    ],
  }),
  component: EventStudioCfpSubmissionsPage,
});

function EventStudioCfpSubmissionsPage() {
  ensureI18n();
  const { t } = useTranslation();
  const { eventId } = Route.useParams();
  // Ten sam klucz cache, co w ramie - React Query oddaje wczytany wiersz,
  // a nie drugie zapytanie o to samo wydarzenie.
  const detailQ = useAdminEventDetail(eventId);
  const row = detailQ.data ?? null;
  if (row === null) return null;
  return (
    <EventStudioPage title={t("adminEvents.studio.sections.cfpSubmissions")}>
      <CfpSubmissionsPanel eventId={eventId} />
    </EventStudioPage>
  );
}
