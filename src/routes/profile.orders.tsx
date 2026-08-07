// Konsolidacja IA finansów (§11): zamówienia i historia płatności były dwiema
// listami tych samych transakcji, obie z wyszukiwarką faktur. Trasa zostaje
// jako przekierowanie, żeby stare linki, zakładki, wyniki wyszukiwarki
// wewnętrznej i pozycje menu konta nie umarły - dokładnie jak /profile/account
// po konsolidacji edycji tożsamości.
import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/profile/orders")({
  beforeLoad: () => {
    throw redirect({ to: "/profile/payments", replace: true });
  },
});
