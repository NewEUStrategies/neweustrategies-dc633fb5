// `/admin/events/<id>/meetings` -> pierwsza podstrona grupy.
//
// SAMA NAZWA GRUPY NIE JEST EKRANEM. Grupa w sidebarze ma dzieci, a nie własny
// ekran - jej adres i tak powstaje sam: z zakładki, z linku wklejonego do
// zadania, z ucięcia ogona ścieżki. Prowadzimy go na pierwszą pozycję
// („Stoliki"), bo bez stolików nie da się ustawić ani jednego spotkania.
//
// PRZEKIEROWANIE STOI W `beforeLoad`, nie w komponencie: pusty ekran z migającą
// przekierowującą treścią jest gorszy niż brak ekranu.
import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/admin/events_/$eventId/meetings/")({
  beforeLoad: ({ params }) => {
    throw redirect({
      to: "/admin/events/$eventId/meetings/tables",
      params: { eventId: params.eventId },
    });
  },
});
