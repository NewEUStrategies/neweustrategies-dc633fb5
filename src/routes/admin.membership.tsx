// Trasa panelu warstw członkostwa - wyłącznie rejestracja słowników i kompozycja.
//
// Cała zawartość mieszka w `components/admin/membership/**` (atomy, molekuły,
// organizmy). Wcześniej ten plik miał 898 linii: katalog warstw, mapowanie
// planów, nadania i integrację z Confluence w jednym module, więc żadnego z
// tych obszarów nie dało się wyrenderować w teście osobno.
import { createFileRoute } from "@tanstack/react-router";

import { AdminMembershipWorkspace } from "@/components/admin/membership/organisms/AdminMembershipWorkspace";
import { ensureI18n as ensureAdminMembershipI18n } from "@/lib/i18n-admin-membership";

export const Route = createFileRoute("/admin/membership")({
  component: AdminMembershipPage,
});

function AdminMembershipPage() {
  // Rejestracja słowników w chunku trasy (nie w entry) - patrz lib/i18n-*.
  ensureAdminMembershipI18n();
  return <AdminMembershipWorkspace />;
}
