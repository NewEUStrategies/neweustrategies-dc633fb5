// /admin/events/<id>/features - sekcja „Funkcje dodatkowe" studia wydarzenia.
//
// TRASA JEST CIENKA, jak siostrzane ekrany ustawień: wiersz wydarzenia wczytuje
// RAMA studia i to ona pokazuje spinner oraz zdanie „nie znaleziono". Sekcja,
// która powtórzyłaby jedno i drugie, dawałaby dwa spinnery pod sobą i dwa
// komunikaty o tym samym braku.
//
// TA SEKCJA NIGDY NIE JEST UKRYTA. Przełączniki chowają pozycje innych sekcji;
// ekran, na którym się je odkręca, musi zostać dostępny zawsze - inaczej
// wyłączenie modułu byłoby nieodwracalne z panelu.
import { createFileRoute } from "@tanstack/react-router";

import { EventFeaturesPanel } from "@/components/admin/events/organisms/EventFeaturesPanel";
import { useAdminEventDetail } from "@/lib/events/useAdminEventDetail";

export const Route = createFileRoute("/admin/events_/$eventId/features")({
  head: () => ({
    meta: [
      { title: "Features · Event · Admin" },
      { name: "robots", content: "noindex, nofollow" },
      { name: "description", content: "Per-event module switches of the event studio." },
    ],
  }),
  component: EventStudioFeaturesPage,
});

function EventStudioFeaturesPage() {
  const { eventId } = Route.useParams();
  // Ten sam klucz cache, co w ramie - React Query oddaje wczytany wiersz,
  // a nie drugie zapytanie o to samo wydarzenie.
  const detailQ = useAdminEventDetail(eventId);
  const row = detailQ.data ?? null;
  if (row === null) return null;
  return <EventFeaturesPanel row={row} />;
}
