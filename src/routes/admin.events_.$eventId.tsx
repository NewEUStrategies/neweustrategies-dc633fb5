// Układ STUDIA WYDARZENIA - `/admin/events/<id>/…`.
//
// PODKREŚLNIK W `events_` WYPINA STUDIO Z UKŁADU MODUŁU. `admin.events.tsx`
// dokłada pasek `EventsSubNav`, czyli nawigację PO MODULE, a studio ma własny
// lewy pas nawigacji PO JEDNYM WYDARZENIU. Dwa paski sekcji jeden nad drugim
// odpowiadałyby na dwa różne pytania „gdzie jestem" naraz i zabierały połowę
// szerokości ekranowi z osiemnastoma polami.
//
// UKŁAD, A NIE POWTÓRZONA RAMA W KAŻDEJ SEKCJI. Rama wczytuje wiersz wydarzenia
// raz i trzyma stan podglądu na żywo; gdyby montowała się od nowa przy każdym
// przejściu między sekcjami, dok podglądu zwijałby się przy każdym kliknięciu
// w sidebarze, a tytuł w pasku górnym migałby spinnerem.
//
// ŚCIEŻKĘ CZYTAMY Z ROUTERA, nie z `window.location`: podświetlenie aktywnej
// pozycji w sidebarze musi zmieniać się razem z nawigacją, a `window.location`
// nie jest stanem Reacta - sidebar zostawałby na poprzedniej sekcji.
import { createFileRoute, Outlet, useRouterState } from "@tanstack/react-router";

import { EventStudioShell } from "@/components/admin/events/studio/EventStudioShell";

export const Route = createFileRoute("/admin/events_/$eventId")({
  component: EventStudioLayout,
});

function EventStudioLayout() {
  const { eventId } = Route.useParams();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  return (
    <EventStudioShell eventId={eventId} pathname={pathname}>
      <Outlet />
    </EventStudioShell>
  );
}
