// /admin/events/<id>/registration/invoices - ekran „Faktury" studia wydarzenia.
//
// Faktury na firmę za bilety i pakiety (także zbiorcze), proformy, korekty,
// stan KSeF i ustawienia wystawcy - organizm `EventInvoicesPanel`. Tytuł to
// TEN SAM klucz co etykieta w sidebarze (`adminEvents.studio.sections.registrationInvoices`).
//
// TRASA JEST CIENKA. Wiersz wydarzenia wczytuje RAMA studia i to ona pokazuje
// spinner oraz zdanie „nie znaleziono"; ekran, który powtórzyłby jedno i
// drugie, dawałby dwa spinnery pod sobą. Dopóki wiersza nie ma, ekran nie
// rysuje niczego.
import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";

import { EventInvoicesPanel } from "@/components/admin/events/organisms/EventInvoicesPanel";
import { EventStudioPage } from "@/components/admin/events/studio/EventStudioSection";
import { useAdminEventDetail } from "@/lib/events/useAdminEventDetail";
import { ensureI18n } from "@/lib/i18n-admin-events";

export const Route = createFileRoute("/admin/events_/$eventId/registration/invoices")({
  head: () => ({
    meta: [
      { title: "Invoices · Event · Admin" },
      { name: "robots", content: "noindex, nofollow" },
      {
        name: "description",
        content: "Company and collective invoices for tickets of this event.",
      },
    ],
  }),
  component: EventStudioRegistrationInvoicesPage,
});

function EventStudioRegistrationInvoicesPage() {
  ensureI18n();
  const { t } = useTranslation();
  const { eventId } = Route.useParams();
  // Ten sam klucz cache, co w ramie - React Query oddaje wczytany wiersz,
  // a nie drugie zapytanie o to samo wydarzenie.
  const detailQ = useAdminEventDetail(eventId);
  const row = detailQ.data ?? null;
  if (row === null) return null;
  return (
    <EventStudioPage title={t("adminEvents.studio.sections.registrationInvoices")}>
      <EventInvoicesPanel key={row.id} eventId={row.id} />
    </EventStudioPage>
  );
}
