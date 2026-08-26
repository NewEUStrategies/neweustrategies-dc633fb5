// Układ /admin/events - przelotka do Outletu.
//
// DLACZEGO TU NIE MA JUŻ ANI PODNAWIGACJI, ANI `AdminShell`.
//
// Były tu oba i oba były błędem. `AdminShell` rysuje się już w `admin.tsx` dla
// całego `/admin`, więc drugi `AdminShell hideSidebar` tutaj oznaczał DWIE
// zagnieżdżone powłoki panelu na każdym ekranie modułu - wewnętrzna chowała
// swój sidebar, żeby ten konflikt nie był widoczny. To działało, ale kosztem
// tego, że kreator wydarzenia (`/admin/events/new`, dziecko tej trasy)
// dostawał tę ramę NIEZALEŻNIE od tego, co mówił predykat studia: poprawka
// w `admin.tsx` wycinała globalny sidebar, a rząd zakładek zostawał.
// Dlatego kreator jest teraz `admin.events_.new.tsx` - podkreślnik wypina go
// z tego layoutu - a ta trasa przestała być ramą i jest tylko zagnieżdżeniem.
//
// `EventsSubNav` (poziomy rząd ośmiu zakładek) usunięty w całości. Powtarzał
// te same osiem celów, które stały w globalnym sidebarze, i oba spisy już się
// rozjechały: sidebar startował od `/admin/events`, rząd zakładek od
// `/admin/events/list`; sidebar kończył kolejnością `…meetings, terms`, rząd
// zakładek `…terms, meetings`. Dwa źródła jednej nawigacji zawsze rozjadą się
// na tym, którego nikt akurat nie poprawia.
//
// Wzorzec (Swapcard Studio) nie ma poziomego rzędu zakładek na poziomie MODUŁU
// na żadnym z 41 zrzutów - jedyny taki rząd żyje WEWNĄTRZ szczegółu rekordu
// (zrzut 09: „Details | Format & video | Speakers (1) | …" przy otwartej sesji,
// gdy w sidebarze świeci nadal „Sessions"). Nawigacja po module należy do
// sidebara, drugi poziom - do rekordu.
import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/admin/events")({ component: EventsLayout });

function EventsLayout() {
  return <Outlet />;
}
