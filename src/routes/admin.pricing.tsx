// Trasa panelu Cennika 2.0 - kontrakt adresu, nagłówek strony i kompozycja.
//
// Cała zawartość mieszka w `components/admin/pricing/**` (atomy, molekuły,
// organizmy). Wcześniej ten plik miał 1821 linii i cztery zakładki w jednym
// module, więc żadnej z nich nie dało się wyrenderować w teście osobno -
// panel, w którym redakcja definiuje, co widzi i co kupuje klient, był
// jednocześnie najmniej sprawdzalnym plikiem w module monetyzacji.
//
// ADRES = STAN (SPEC §2.6): `?tab=audiences|tiers|faq|retention` - hub linkuje
// prosto do zakładki, a odświeżenie strony zostaje na niej. Walidator to liść
// bez importów (`pricingTabs.ts`), bo powłoka trasy jedzie w chunku wejściowym.
import { createFileRoute } from "@tanstack/react-router";

import { AdminPricingWorkspace } from "@/components/admin/pricing/organisms/AdminPricingWorkspace";
import { adminPageHead } from "@/lib/adminPageHead";
import { parsePricingSearch, type PricingTabId } from "@/lib/admin/pricingTabs";
import { ensureI18n as ensureAdminPricingI18n } from "@/lib/i18n-admin-pricing";

export const Route = createFileRoute("/admin/pricing")({
  validateSearch: parsePricingSearch,
  head: () =>
    adminPageHead(
      "Cennik i segmenty",
      "Prezentacja oferty na stronie cennika: segmenty odbiorców, marketing i benefity warstw, FAQ oraz kontroferta dla odchodzących.",
    ),
  component: AdminPricingPage,
});

function AdminPricingPage() {
  // Rejestracja słowników w chunku trasy (nie w entry) - patrz lib/i18n-*.
  ensureAdminPricingI18n();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  return (
    <AdminPricingWorkspace
      tab={search.tab ?? "audiences"}
      onTabChange={(tab: PricingTabId) =>
        void navigate({ search: (s) => ({ ...s, tab }), replace: true })
      }
    />
  );
}
