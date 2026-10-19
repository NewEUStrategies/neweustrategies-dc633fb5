// /admin/revenue - UKŁAD huba „Przychód i lejek" (cennik, paywall, lejek,
// retencja, społeczność, diagnostyka, ścieżki komunikacji).
//
// POWŁOKA JEST LEKKA, BO JEDZIE W CHUNKU WEJŚCIOWYM. Splitter TanStacka
// wynosi do osobnego chunku wyłącznie `component`; `validateSearch` i `head`
// zostają w drzewie tras, czyli w bootcie KAŻDEJ strony publicznej. Stąd
// walidator z liścia bez importów (`lib/revenue/search.ts`) zamiast zod
// i stąd brak słownika w tym pliku (słownik rejestruje `RevenueHubLayout`).
//
// `validateSearch` STOI WYŁĄCZNIE NA UKŁADZIE: okres, waluta, segment i filtry
// są wspólne dla wszystkich zakładek, a dzieci dziedziczą typ wyszukiwania.
// Przełączenie zakładki zachowuje więc wybrane okno.
//
// ROLA HUBA (admin, redaktor) NIE JEST SPRAWDZANA TUTAJ - patrz
// `RevenueHubLayout` i bramka `adminRouteAuthority.gate.test.ts`.
import { createFileRoute } from "@tanstack/react-router";

import { RevenueHubLayout } from "@/components/admin/revenue/organisms/RevenueHubLayout";
import { adminPageHead } from "@/lib/adminPageHead";
import { parseRevenueHubSearch } from "@/lib/revenue/search";

export const Route = createFileRoute("/admin/revenue")({
  validateSearch: parseRevenueHubSearch,
  head: () =>
    adminPageHead(
      "Przychód i lejek",
      "Cennik, paywall, lejek, retencja i ścieżki komunikacji w jednym miejscu.",
    ),
  component: RevenueHubLayout,
});
