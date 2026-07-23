import { createFileRoute, Outlet, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { useAuth } from "@/hooks/useAuth";
import { AdminShell } from "@/components/admin/AdminShell";
import { ensureI18n as ensureAdminExtrasI18n } from "@/lib/i18n-admin-extras";

export const Route = createFileRoute("/admin")({
  // Auth stan jest w localStorage (Supabase), więc SSR-owy render szkicu
  // powoduje mismatch z klientem. Wyłączamy SSR dla całego /admin.
  ssr: false,
  head: () => ({
    meta: [{ name: "robots", content: "noindex, nofollow" }, { title: "Admin" }],
  }),
  component: AdminLayout,
});

function AdminLayout() {
  // Rejestruje słownik brakujących kluczy admina/CRM w chunku tras /admin
  // (patrz lib/i18n-admin-extras) - jeden punkt wejścia dla całego panelu.
  ensureAdminExtrasI18n();
  const { loading, session, isStaff } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!loading && (!session || !isStaff)) navigate({ to: "/login" });
  }, [loading, session, isStaff, navigate]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center text-sm text-muted-foreground">
        …
      </div>
    );
  }
  if (!session || !isStaff) return null;

  return (
    <AdminShell>
      <Outlet />
    </AdminShell>
  );
}
