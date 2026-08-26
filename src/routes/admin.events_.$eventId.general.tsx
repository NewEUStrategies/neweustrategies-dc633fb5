// /admin/events/<id>/general - sekcja „General" studia wydarzenia.
//
// TRASA JEST CIENKA. Wiersz wydarzenia wczytuje RAMA studia i to ona pokazuje
// spinner oraz zdanie „nie znaleziono"; sekcja, która powtórzyłaby jedno i
// drugie, dawałaby dwa spinnery pod sobą i dwa komunikaty o tym samym braku.
// Dopóki wiersza nie ma, sekcja nie rysuje niczego.
//
// TO JEST EKRAN STARTOWY STUDIA (patrz przekierowanie w `admin.events_.$eventId.index.tsx`).
// Tytuł, termin i adres publiczny są warunkiem publikacji, więc nowe wydarzenie
// zaczyna się dokładnie tam, gdzie się je uzupełnia.
import { createFileRoute } from "@tanstack/react-router";

import { EventGeneralPanel } from "@/components/admin/events/organisms/EventGeneralPanel";
import { useAdminEventDetail } from "@/lib/events/useAdminEventDetail";

export const Route = createFileRoute("/admin/events_/$eventId/general")({
  head: () => ({
    meta: [
      { title: "General · Event · Admin" },
      { name: "robots", content: "noindex, nofollow" },
      {
        name: "description",
        content: "Core event details: titles, dates, timezone, venue, cover and public address.",
      },
    ],
  }),
  component: EventStudioGeneralPage,
});

function EventStudioGeneralPage() {
  const { eventId } = Route.useParams();
  // Ten sam klucz cache, co w ramie - React Query oddaje wczytany wiersz,
  // a nie drugie zapytanie o to samo wydarzenie.
  const detailQ = useAdminEventDetail(eventId);
  const row = detailQ.data ?? null;
  if (row === null) return null;
  return <EventGeneralPanel row={row} />;
}
