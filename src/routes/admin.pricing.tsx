// Trasa panelu Cennika 2.0 - wyłącznie rejestracja słowników i kompozycja.
//
// Cała zawartość mieszka w `components/admin/pricing/**` (atomy, molekuły,
// organizmy). Wcześniej ten plik miał 1821 linii i cztery zakładki w jednym
// module, więc żadnej z nich nie dało się wyrenderować w teście osobno -
// panel, w którym redakcja definiuje, co widzi i co kupuje klient, był
// jednocześnie najmniej sprawdzalnym plikiem w module monetyzacji.
import { createFileRoute } from "@tanstack/react-router";

import { AdminPricingWorkspace } from "@/components/admin/pricing/organisms/AdminPricingWorkspace";
import { ensureI18n as ensureAdminPricingI18n } from "@/lib/i18n-admin-pricing";

export const Route = createFileRoute("/admin/pricing")({
  component: AdminPricingPage,
});

function AdminPricingPage() {
  // Rejestracja słowników w chunku trasy (nie w entry) - patrz lib/i18n-*.
  ensureAdminPricingI18n();
  return <AdminPricingWorkspace />;
}
