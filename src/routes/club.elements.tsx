// /club/elements - trasa historyczna.
//
// Katalog elementów przeniósł się do panelu (/admin/community/clubs/elements),
// bo to materiał operacyjny: słowniki bazy, macierz uprawnień i kody odmów.
// Trasa zostaje wyłącznie jako przekierowanie - linki w dokumentacji, zakładki
// i stare wpisy w sidebarze mają dalej trafiać we właściwe miejsce, a nie w 404.
import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/club/elements")({
  beforeLoad: () => {
    throw redirect({ to: "/admin/community/clubs/elements", replace: true });
  },
});
