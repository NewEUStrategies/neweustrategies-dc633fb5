// /admin/community/events - PRZEKIEROWANIE na moduł wydarzeń.
//
// DLACZEGO TRASA ZOSTAJE, A EKRAN ZNIKA. Adres istnieje od miesięcy: siedzi
// w zakładkach redakcji, w zgłoszeniach do wsparcia i w linkach wklejanych
// między sobą. Usunięcie pliku dałoby 404 zamiast miejsca, do którego ta praca
// się przeniosła; przekierowanie kosztuje piętnaście linii i nie gubi nikogo.
//
// DLACZEGO EKRAN ZNIKA. Trzymał DRUGI formularz na te same kolumny `events`,
// widzący mniej pól niż studio wydarzenia (bez adresu strukturalnego, nagłówka
// wideo, języków treści, brandingu, stron i menu), a dochodziło się do niego
// przez wyszukanie wydarzenia po slugu - czyli przez wynik wyszukiwania, nie
// przez wydarzenie. Dwa formularze na jedną tabelę to dwa zbiory reguł
// walidacji, z których jeden zawsze jest starszy.
//
// CO SIĘ GDZIE PRZENIOSŁO, bo bez tego przekierowanie byłoby utratą funkcji:
//   * tworzenie i edycja wydarzenia  -> /admin/events/new i studio wydarzenia
//   * prelegenci wydarzenia          -> studio: Treść -> Prelegenci
//   * ręczne przypomnienia           -> lista modułu (akcja jest GLOBALNA:
//     `run_event_reminders()` przechodzi wszystkie wydarzenia, którym termin
//     właśnie minął, więc na ekranie jednego wydarzenia kłamałaby o zasięgu)
//
// Przekierowanie stoi w `beforeLoad`, a nie w komponencie: pusty ekran
// z migającą treścią jest gorszy niż brak ekranu.
import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/admin/community/events")({
  beforeLoad: () => {
    throw redirect({ to: "/admin/events/list" });
  },
});
