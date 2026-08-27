// `/admin/events/<id>/content` -> pierwsza podstrona grupy.
//
// SAMA NAZWA GRUPY NIE JEST EKRANEM. Grupa w sidebarze ma dzieci, a nie własny
// ekran - jej adres i tak powstaje sam: z zakładki, z linku wklejonego do
// zadania, z ucięcia ogona ścieżki. Prowadzimy go na pierwszą pozycję
// („Ścieżki"), bo program buduje się pasmami, a sesje planuje się w zakładce ścieżki.
//
// PRZEKIEROWANIE STOI W `beforeLoad`, nie w komponencie: pusty ekran z migającą
// przekierowującą treścią jest gorszy niż brak ekranu.
import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/admin/events_/$eventId/content/")({
  beforeLoad: ({ params }) => {
    throw redirect({
      to: "/admin/events/$eventId/content/tracks",
      params: { eventId: params.eventId },
    });
  },
});
