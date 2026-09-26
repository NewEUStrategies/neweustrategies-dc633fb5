// /admin/events/<id>/registration/policies - „Zasady biletów" studia (F1-F5).
//
// TRASA JEST CIENKA - wzorzec `registration.settings.tsx`. Wiersz wydarzenia
// wczytuje RAMA studia i to ona pokazuje spinner oraz zdanie „nie znaleziono";
// dopóki wiersza nie ma, podstrona nie rysuje niczego. Ustawienia (przekazanie,
// zwrot, oferty z listy rezerwowej) pobiera sam panel - osobnym, tylko
// administracyjnym RPC `admin_event_participant_settings_get`.
//
// NAGŁÓWEK DOKUMENTU: sam tytuł i `robots` (R-ROUTE: trasy panelu nie niosą
// opisu).
import { createFileRoute } from "@tanstack/react-router";

import { EventRegistrationPoliciesPanel } from "@/components/admin/events/organisms/EventRegistrationPoliciesPanel";
import { useAdminEventDetail } from "@/lib/events/useAdminEventDetail";

export const Route = createFileRoute("/admin/events_/$eventId/registration/policies")({
  head: () => ({
    meta: [
      { title: "Ticket policies · Event · Admin" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: EventStudioRegistrationPoliciesPage,
});

function EventStudioRegistrationPoliciesPage() {
  const { eventId } = Route.useParams();
  // Ten sam klucz cache, co w ramie - React Query oddaje wczytany wiersz.
  const detailQ = useAdminEventDetail(eventId);
  const row = detailQ.data ?? null;
  if (row === null) return null;
  return <EventRegistrationPoliciesPanel row={row} />;
}
