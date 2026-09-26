// /admin/events/<id>/ads-funnel - ekran „Lejek Google Ads” studia wydarzenia.
//
// TRASA JEST CIENKA. Wiersz wydarzenia wczytuje RAMA studia i to ona pokazuje
// spinner oraz zdanie „nie znaleziono”; ekran, który powtórzyłby jedno i
// drugie, dawałby dwa spinnery pod sobą. Dopóki wiersza nie ma, ekran nie
// rysuje niczego. Całą treść (okres, lejek, kampanie, koszty, eksporty) składa
// organizm `EventAdsFunnelPanel`; tytuł to TEN SAM klucz co etykieta pozycji
// w sidebarze (`adminEvents.studio.sections.adsFunnel`).
//
// Dane panelu są wyłącznie po stronie klienta (React Query) - `/admin` renderuje
// na serwerze tylko szkielet, więc nic tu nie zależy od SSR.
import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";

import { EventAdsFunnelPanel } from "@/components/admin/events/organisms/EventAdsFunnelPanel";
import { EventStudioPage } from "@/components/admin/events/studio/EventStudioSection";
import { useAdminEventDetail } from "@/lib/events/useAdminEventDetail";
import { ensureI18n } from "@/lib/i18n-admin-events";
import { ensureAdsFunnelI18n } from "@/lib/i18n-admin-event-ads-funnel";

export const Route = createFileRoute("/admin/events_/$eventId/ads-funnel")({
  head: () => ({
    meta: [
      { title: "Google Ads funnel · Event · Admin" },
      { name: "robots", content: "noindex, nofollow" },
      {
        name: "description",
        content: "Sales funnel of this event tied to Google Ads campaigns.",
      },
    ],
  }),
  component: EventStudioAdsFunnelPage,
});

function EventStudioAdsFunnelPage() {
  ensureI18n();
  ensureAdsFunnelI18n();
  const { t } = useTranslation();
  const { eventId } = Route.useParams();
  // Ten sam klucz cache, co w ramie - React Query oddaje wczytany wiersz,
  // a nie drugie zapytanie o to samo wydarzenie.
  const detailQ = useAdminEventDetail(eventId);
  const row = detailQ.data ?? null;
  if (row === null) return null;
  return (
    <EventStudioPage
      title={t("adminEvents.studio.sections.adsFunnel")}
      description={t("adminEventAdsFunnel.description")}
    >
      <EventAdsFunnelPanel key={row.id} row={row} />
    </EventStudioPage>
  );
}
