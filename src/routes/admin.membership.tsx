// Trasa panelu warstw członkostwa - kontrakt adresu, nagłówek strony i kompozycja.
//
// Cała zawartość mieszka w `components/admin/membership/**` (atomy, molekuły,
// organizmy). Wcześniej ten plik miał 898 linii: katalog warstw, mapowanie
// planów, nadania i integrację z Confluence w jednym module, więc żadnego z
// tych obszarów nie dało się wyrenderować w teście osobno.
//
// ADRES = STAN (SPEC §2.6): `?tab=tiers|mapping|grants|orgs` wybiera zakładkę,
// `?tier=<key>` otwiera edytor warstwy - hub, Cennik i odświeżona strona lądują
// dokładnie tam, gdzie admin był. Walidator to liść bez importów
// (`pricingTabs.ts`), bo powłoka trasy jedzie w chunku wejściowym.
import { createFileRoute } from "@tanstack/react-router";

import { AdminMembershipWorkspace } from "@/components/admin/membership/organisms/AdminMembershipWorkspace";
import { adminPageHead } from "@/lib/adminPageHead";
import { parseMembershipSearch, type MembershipTabId } from "@/lib/admin/pricingTabs";
import { ensureI18n as ensureAdminMembershipI18n } from "@/lib/i18n-admin-membership";

export const Route = createFileRoute("/admin/membership")({
  validateSearch: parseMembershipSearch,
  head: () =>
    adminPageHead(
      "Warstwy członkostwa",
      "Rdzeń warstw członkostwa (ranga, status, bramki), mapowanie planów na warstwy, nadania poza planem i członkostwo organizacji.",
    ),
  component: AdminMembershipPage,
});

function AdminMembershipPage() {
  // Rejestracja słowników w chunku trasy (nie w entry) - patrz lib/i18n-*.
  ensureAdminMembershipI18n();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  return (
    <AdminMembershipWorkspace
      tab={search.tab ?? "tiers"}
      onTabChange={(tab: MembershipTabId) =>
        void navigate({ search: (s) => ({ ...s, tab }), replace: true })
      }
      tierKey={search.tier ?? null}
      onTierKeyChange={(tier) =>
        void navigate({ search: (s) => ({ ...s, tier: tier ?? undefined }), replace: true })
      }
    />
  );
}
