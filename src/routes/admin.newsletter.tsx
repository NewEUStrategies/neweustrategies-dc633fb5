// Layout /admin/newsletter — sub-nav + Outlet.
// Podstrony:
//   /admin/newsletter/overview      — KPI, logika, tryb, dual preview
//   /admin/newsletter/inline        — drag & drop builder inline
//   /admin/newsletter/popup         — drag & drop builder popup
//   /admin/newsletter/subscribers   — tabela subskrybentow
//   /admin/newsletter/deliverability— reputacja nadawcy + lista wykluczen
//
// SYGNAŁ HUBA (I9, SPEC §2.7): pasek Diagnostyki obszarów newslettera i lejka
// pod podnawigacją - na każdej podstronie, bo diagnozy (zapis, potwierdzenie,
// dostarczalność) dotyczą całego modułu. Lekkie opakowanie, treść w leniwym
// chunku i tylko dla roli huba.
import { createFileRoute, Outlet } from "@tanstack/react-router";
import { AdminShell } from "@/components/admin/AdminShell";
import { NewsletterSubNav } from "@/components/admin/newsletter/NewsletterSubNav";
import { RevenueSignalChip } from "@/components/admin/revenue/molecules/RevenueSignalChip";

export const Route = createFileRoute("/admin/newsletter")({ component: NewsletterLayout });

function NewsletterLayout() {
  return (
    <AdminShell hideSidebar>
      <div className="space-y-4">
        <NewsletterSubNav />
        <RevenueSignalChip surface="newsletter" variant="bar" />
        <Outlet />
      </div>
    </AdminShell>
  );
}
