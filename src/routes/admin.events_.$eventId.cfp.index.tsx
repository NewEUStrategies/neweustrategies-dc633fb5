// `/admin/events/<id>/cfp` -> pierwsza podstrona grupy „Nabór prelegentów".
//
// SAMA NAZWA GRUPY NIE JEST EKRANEM. Grupa w sidebarze ma dzieci, a nie własny
// ekran - jej adres i tak powstaje sam: z zakładki, z linku wklejonego do
// zadania, z ucięcia ogona ścieżki.
//
// PROWADZI NA PIERWSZĄ POZYCJĘ GRUPY, czyli na `cfp/settings`. Ten adres musi
// zgadzać się z `defaultSection` grupy `cfp` (`lib/events/eventStudioNav.ts`),
// bo z niej bierze cel odnośnik w nagłówku grupy ORAZ podświetlenie pozycji na
// czas przekierowania.
//
// PRZEKIEROWANIE STOI W `beforeLoad`, nie w komponencie: pusty ekran z migającą
// przekierowującą treścią jest gorszy niż brak ekranu.
import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/admin/events_/$eventId/cfp/")({
  beforeLoad: ({ params }) => {
    throw redirect({
      to: "/admin/events/$eventId/cfp/settings",
      params: { eventId: params.eventId },
    });
  },
});
