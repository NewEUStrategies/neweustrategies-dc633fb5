// Layout /admin/newsletter — sub-nav + Outlet.
// Podstrony:
//   /admin/newsletter/overview      — KPI, logika, tryb, dual preview
//   /admin/newsletter/inline        — drag & drop builder inline
//   /admin/newsletter/popup         — drag & drop builder popup
//   /admin/newsletter/subscribers   — tabela subskrybentow
import { createFileRoute, Outlet } from "@tanstack/react-router";
import { AdminShell } from "@/components/admin/AdminShell";
import { NewsletterSubNav } from "@/components/admin/newsletter/NewsletterSubNav";

export const Route = createFileRoute("/admin/newsletter")({ component: NewsletterLayout });

function NewsletterLayout() {
  return (
    <AdminShell hideSidebar>
      <div className="space-y-4">
        <NewsletterSubNav />
        <Outlet />
      </div>
    </AdminShell>
  );
}
