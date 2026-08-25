// UKŁAD sekcji wydarzeń (`/events/*`) - wyłącznie `<Outlet />`.
//
// PO CO OSOBNY PLIK, SKORO NIC NIE RYSUJE. Bo w TanStack Router dziecko
// renderuje się TYLKO wtedy, gdy rodzic wywoła `<Outlet />` (`Match` renderuje
// `component` ALBO `Outlet`, nigdy oba). Dopóki lista wydarzeń siedziała
// bezpośrednio w `events.tsx`, każde wejście na `/events/<slug>` montowało
// listę i na tym kończyło - strona wydarzenia, formularz zapisu
// (`/events/<slug>/register`) i samoobsługa zgłoszenia (`/events/<slug>/manage`)
// były w drzewie tras, a mimo to nieosiągalne z przeglądarki.
//
// Lista przeniosła się do `events.index.tsx` (adres bez zmian), a ten plik
// trzyma miejsce dla dzieci. Dokładnie ten sam podział ma panel:
// `admin.events.tsx` (układ) + `admin.events.index.tsx` (treść).
//
// UKŁAD JEST CELOWO PUSTY. Bramka modułu, SEO listy i JSON-LD należą do
// KONKRETNYCH ekranów, nie do całej sekcji - strona wydarzenia ma własne
// metadane do udostępniania i własną bramkę, a zapis ma być `noindex`.
// Cokolwiek dopisanego tutaj pojawiłoby się nad każdym z nich.
import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/events")({ component: EventsLayout });

function EventsLayout() {
  return <Outlet />;
}
