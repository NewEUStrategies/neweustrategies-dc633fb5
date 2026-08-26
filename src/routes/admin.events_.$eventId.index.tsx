// `/admin/events/<id>` -> pierwsza sekcja studia.
//
// SAM IDENTYFIKATOR NIE JEST EKRANEM. Adres bez sekcji powstaje sam: z zakładki,
// z linku wklejonego do zadania, z ucięcia ogona ścieżki. Prowadzimy go na
// „Informacje ogólne", bo to jedyna sekcja, której nie da się pominąć przy
// nowym wydarzeniu - tytuł, termin i adres publiczny są warunkiem publikacji.
//
// PRZEKIEROWANIE STOI W `beforeLoad`, nie w komponencie: pusty ekran z migającą
// przekierowującą treścią jest gorszy niż brak ekranu.
import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/admin/events_/$eventId/")({
  beforeLoad: ({ params }) => {
    throw redirect({
      to: "/admin/events/$eventId/general",
      params: { eventId: params.eventId },
    });
  },
});
