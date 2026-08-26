import { createFileRoute, Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import { useEffect } from "react";
import { useAuth } from "@/hooks/useAuth";
import { AdminShell } from "@/components/admin/AdminShell";
import { eventStudioSectionFromPath } from "@/lib/events/eventStudioNav";
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
  const path = useRouterState({ select: (state) => state.location.pathname });

  // STUDIO WYDARZENIA WYMIENIA CALA RAME PANELU, nie tylko tresc.
  //
  // Na czas pracy nad jednym wydarzeniem lewy pas nalezy do TEGO wydarzenia
  // (pietnascie sekcji: informacje ogolne, strony i menu, grupy, branding,
  // zapisy, tresc, spotkania, odprawa...), a nie do panelu. Dwa sidebary obok
  // siebie zabralyby polowe szerokosci formularzowi o osiemnastu polach i nie
  // odpowiadaly by na pytanie „ktore wydarzenie mam w reku".
  //
  // Bramka logowania i roli ZOSTAJE tutaj - dlatego studio jest nadal dzieckiem
  // `/admin`, a nie osobnym drzewem tras. Wymieniamy tylko powloke wizualna.
  const isEventStudio = eventStudioSectionFromPath(path) !== null;

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

  if (isEventStudio) return <Outlet />;

  return (
    <AdminShell>
      <Outlet />
    </AdminShell>
  );
}
