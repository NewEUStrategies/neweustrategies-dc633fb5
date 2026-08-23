// /admin/events -> przekierowanie na pierwszy istniejący ekran modułu.
//
// Docelowo prowadzi na pulpit wydarzenia; dopóki go nie ma, prowadzi na katalog
// rodzajów, bo to jedyny ekran, który tu mieszka. Przekierowanie stoi
// w `beforeLoad`, a nie w komponencie: pusty ekran z migającą przekierowującą
// treścią jest gorszy niż brak ekranu.
import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/admin/events/")({
  beforeLoad: () => {
    throw redirect({ to: "/admin/events/types" });
  },
});
