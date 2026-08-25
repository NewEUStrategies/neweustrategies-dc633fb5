// Prywatna lista zapamiętanych wydarzeń: `/events/saved`.
//
// ADRES DZIECKA POD `/events`, ale bez `$slug` - plik nazywa się `events.saved`,
// więc trafia jako dziecko trasy listy, a nie jako wydarzenie o slugu „saved".
//
// `ssr: false`: `event_bookmarks_mine` czyta wiersze po `auth.uid()`, a sesja
// Supabase siedzi w `localStorage`, którego serwer nie widzi - renderowanie
// serwerowe dawałoby zawsze pustą listę i podmieniało ją po hydracji.
//
// `noindex`: prywatna lista jednego czytelnika nie ma czego robić w wyszukiwarce.
import { createFileRoute } from "@tanstack/react-router";

import { AuthGate } from "@/components/profile/AuthGate";
import { FriendlyErrorPage } from "@/components/error/FriendlyErrorPage";
import { SavedEventsList } from "@/components/events/public/organisms/SavedEventsList";
import { ensureI18n as ensureEventFrontI18n } from "@/lib/i18n-event-front";

export const Route = createFileRoute("/events/saved")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Zapamiętane wydarzenia - New European Strategies" },
      {
        name: "description",
        content: "Twoja prywatna lista zapamiętanych wydarzeń.",
      },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  errorComponent: SavedRouteError,
  notFoundComponent: SavedRouteError,
  component: SavedRoute,
});

function SavedRoute() {
  ensureEventFrontI18n();
  return (
    <main className="mx-auto w-full max-w-4xl px-4 py-8 sm:px-6">
      <AuthGate>
        <SavedEventsList />
      </AuthGate>
    </main>
  );
}

function SavedRouteError() {
  return <FriendlyErrorPage variant="compact" />;
}
