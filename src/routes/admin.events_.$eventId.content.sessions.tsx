// /admin/events/<id>/content/sessions - ADRES ZACHOWANY, EKRANU JUZ NIE MA.
//
// Sesja nie jest osobnym modulem studia, tylko wpisem w pasmie: planuje sie ja w
// zakladce „Sesje" na stronie sciezki. Trasa zostaje wylacznie dla starych
// linkow (zakladki, zadania, notatki) i prowadzi na sciezki - kasowanie adresu
// dawaloby 404 tam, gdzie redaktor wczoraj mial ekran.
import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/admin/events_/$eventId/content/sessions")({
  beforeLoad: ({ params }) => {
    throw redirect({
      to: "/admin/events/$eventId/content/tracks",
      params: { eventId: params.eventId },
    });
  },
});
