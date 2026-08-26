// /admin/events/<id>/registration/settings - „Ustawienia rejestracji" studia.
//
// TRASA JEST CIENKA. Wiersz wydarzenia wczytuje RAMA studia i to ona pokazuje
// spinner oraz zdanie „nie znaleziono"; podstrona, która powtórzyłaby jedno i
// drugie, dawałaby dwa spinnery pod sobą i dwa komunikaty o tym samym braku.
// Dopóki wiersza nie ma, podstrona nie rysuje niczego.
//
// TO JEST PIERWSZA PODSTRONA GRUPY „Rejestracja w aplikacji" i cel
// przekierowania z `.../registration`. Odpowiada na pytanie wcześniejsze niż
// zgłoszenia, wejściówki i formularz: dopóki tryb zapisów jest „bez zapisów",
// żadnego z tych trzech ekranów nie ma czym wypełnić.
import { createFileRoute } from "@tanstack/react-router";

import { EventRegistrationSettingsPanel } from "@/components/admin/events/organisms/EventRegistrationSettingsPanel";
import { useAdminEventDetail } from "@/lib/events/useAdminEventDetail";

export const Route = createFileRoute("/admin/events_/$eventId/registration/settings")({
  head: () => ({
    meta: [
      { title: "Registration settings · Event · Admin" },
      { name: "robots", content: "noindex, nofollow" },
      {
        name: "description",
        content:
          "Registration settings of this event: mode, flow, visibility, seats, price, stream and recording.",
      },
    ],
  }),
  component: EventStudioRegistrationSettingsPage,
});

function EventStudioRegistrationSettingsPage() {
  const { eventId } = Route.useParams();
  // Ten sam klucz cache, co w ramie - React Query oddaje wczytany wiersz,
  // a nie drugie zapytanie o to samo wydarzenie.
  const detailQ = useAdminEventDetail(eventId);
  const row = detailQ.data ?? null;
  if (row === null) return null;
  return <EventRegistrationSettingsPanel row={row} />;
}
