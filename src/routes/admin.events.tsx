// Układ /admin/events - podnawigacja modułu + Outlet.
//
// Podstrony (kolejne etapy dopisują tu linię):
//   /admin/events/types  - katalog rodzajów wydarzeń
//
// `hideSidebar` jak w /admin/newsletter: moduł z własnym paskiem sekcji nie
// potrzebuje jednocześnie sidebara panelu - dwa poziomy nawigacji na raz zabierają
// połowę szerokości ekranu formularzowi o osiemnastu polach.
import { createFileRoute, Outlet } from "@tanstack/react-router";
import { AdminShell } from "@/components/admin/AdminShell";
import { EventsSubNav } from "@/components/admin/events/EventsSubNav";

export const Route = createFileRoute("/admin/events")({ component: EventsLayout });

function EventsLayout() {
  return (
    <AdminShell hideSidebar>
      <div className="space-y-4">
        <EventsSubNav />
        <Outlet />
      </div>
    </AdminShell>
  );
}
