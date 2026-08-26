// `/admin/events/<id>/registration` -> pierwsza podstrona grupy.
//
// SAMA NAZWA GRUPY NIE JEST EKRANEM. Grupa w sidebarze ma dzieci, a nie własny
// ekran - jej adres i tak powstaje sam: z zakładki, z linku wklejonego do
// zadania, z ucięcia ogona ścieżki.
//
// PROWADZI NA PIERWSZĄ POZYCJĘ GRUPY, czyli na `registration/settings`. Ten
// adres musi zgadzać się z `defaultSection` grupy `registration`
// (`lib/events/eventStudioNav.ts`), bo z niej bierze cel odnośnik w nagłówku
// grupy ORAZ podświetlenie pozycji na czas przekierowania. Dwie różne odpowiedzi
// na pytanie „co jest pierwszym ekranem tej grupy" znaczą, że klik w sidebarze
// i wklejony link prowadzą gdzie indziej.
//
// PRZEKIEROWANIE STOI W `beforeLoad`, nie w komponencie: pusty ekran z migającą
// przekierowującą treścią jest gorszy niż brak ekranu.
import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/admin/events_/$eventId/registration/")({
  beforeLoad: ({ params }) => {
    throw redirect({
      to: "/admin/events/$eventId/registration/settings",
      params: { eventId: params.eventId },
    });
  },
});
