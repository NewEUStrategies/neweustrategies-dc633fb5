// /admin/events/onsite - WYCOFANE, przekierowanie na liste wydarzen.
//
// Ten ekran zaczynal sie od droplisty „wybierz wydarzenie" i dopiero pod nia
// montowal panele. Studio wie, o ktore wydarzenie chodzi, Z ADRESU - te same
// panele stoja tam bez pytania o to samo drugi raz.
//
// GDZIE TO JEST TERAZ: studio wydarzenia, grupa „Na miejscu",
// sekcje onsite/desk, onsite/log, onsite/stats, onsite/checkpoints, onsite/devices, onsite/badges, onsite/leads.
// Droga: /admin/events/list -> wybierz wydarzenie -> sekcja w sidebarze studia.
//
// PRZEKIEROWANIE, A NIE USUNIECIE PLIKU: adres mogl trafic do zakladek
// przegladarki albo do zgloszenia do wsparcia. Martwy link nie mowi, gdzie
// szukac; przekierowanie na liste stawia redaktora dokladnie tam, gdzie
// zaczyna sie nowa droga do tej samej funkcji.
//
// PRZEKIEROWANIE STOI W `beforeLoad`, nie w komponencie - inaczej mignelby
// pusty ekran z powloka panelu, zanim trasa zdazylaby sie zmienic.
import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/admin/events/onsite")({
  beforeLoad: () => {
    throw redirect({ to: "/admin/events/list" });
  },
});
