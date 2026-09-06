import { createFileRoute, Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import { useEffect } from "react";
import { useAuth } from "@/hooks/useAuth";
import { AdminShell } from "@/components/admin/AdminShell";
import { isEventStudioPath } from "@/lib/events/eventStudioNav";
import { ensureI18n as ensureAdminExtrasI18n } from "@/lib/i18n-admin-extras";
import adminCss from "@/admin-styles.css?url";

export const Route = createFileRoute("/admin")({
  // Auth stan jest w localStorage (Supabase), więc SSR-owy render szkicu
  // powoduje mismatch z klientem. Wyłączamy SSR dla całego /admin.
  ssr: false,
  head: () => ({
    meta: [{ name: "robots", content: "noindex, nofollow" }, { title: "Admin" }],
    links: [{ rel: "stylesheet", href: adminCss }],
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
  // (dwupoziomowa nawigacja: pulpit, kreator wydarzenia, rejestracja, tresc,
  // spotkania, na miejscu... - blisko trzydziestu podstron), a nie do panelu.
  // Dwa sidebary obok siebie zabralyby polowe szerokosci formularzowi
  // o osiemnastu polach i nie odpowiadaly by na pytanie „ktore wydarzenie mam
  // w reku".
  //
  // TA JEDNA LINIA DECYDUJE O DWOCH SIDEBARACH. `isEventStudioPath` musi
  // rozpoznawac WSZYSTKIE adresy studia: jednosegmentowe, dwusegmentowe
  // (`.../registration/tickets`), adresy grup (`.../onsite`, przekierowywane na
  // pierwsze dziecko), goly identyfikator ORAZ KREATOR (`/admin/events/new`).
  // Adres studia, ktorego ta funkcja nie zna, dostaje powloke panelu Z JEJ
  // WLASNYM sidebarem obok sidebara wydarzenia - i dokladnie to dzialo sie
  // z kreatorem, dopoki pytalismy tu o SEKCJE zamiast o przynaleznosc do studia.
  //
  // Bramka logowania i roli ZOSTAJE tutaj - dlatego studio jest nadal dzieckiem
  // `/admin`, a nie osobnym drzewem tras. Wymieniamy tylko powloke wizualna.
  const isEventStudio = isEventStudioPath(path);

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
