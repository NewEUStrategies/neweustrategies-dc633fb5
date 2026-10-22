// Zakładka „Lejek" huba (S7, SPEC §2.2 `funnel`) - tor `?track=`, segment
// `?seg=`, mapa lejka, para PHR/PSCR, źródła rejestracji, tor Sprzedaż
// i arkusz kroku `?stage=` (`RevenueFunnelView`).
//
// Montuje ją leniwie `RevenueTabOutlet` (mapa `tab -> lazy`), więc kod
// zakładki trafia do własnego chunku dopiero po wejściu na
// `/admin/revenue/funnel`.
//
// `useHydrated()` PRZED SESJĄ: serwer nie zna sesji tak jak klient, więc do
// hydratacji obie strony rysują ten sam stan „wczytywanie" (jak układ huba).
// ROLE DOKŁADNE (`roles.includes`), NIE `isAdmin` - sam `super_admin` bez
// wiersza `admin` dostałby od bazy odmowę, a pusty lejek wyglądałby jak brak
// czytelników. Bez najemcy karty nie wysyłają zapytań (stan „wybierz obszar
// roboczy").
import { useHydrated, useNavigate } from "@tanstack/react-router";

import { RevenueTabPending } from "@/components/admin/revenue/atoms/RevenueTabPending";
import { RevenueFunnelView } from "@/components/admin/revenue/funnel/RevenueFunnelView";
import { RoleGateNotice } from "@/components/admin/revenue/molecules/RoleGateNotice";
import { hubRoleOf, useHubWindow } from "@/components/admin/revenue/overview/hubWindow";
import { useAuth } from "@/hooks/useAuth";
import { ensureI18n } from "@/lib/i18n-admin-revenue-tabs";

export function RevenueFunnelTab() {
  ensureI18n();
  const hydrated = useHydrated();
  return (
    <div data-testid="revenue-tab-funnel">
      {hydrated ? <FunnelTabBody /> : <RevenueTabPending />}
    </div>
  );
}

function FunnelTabBody() {
  const { roles, tenantId } = useAuth();
  const navigate = useNavigate();
  const { search, range, segment } = useHubWindow("funnel");
  if (hubRoleOf(roles) === null) return <RoleGateNotice requiredRole="admin_or_editor" />;

  return (
    <RevenueFunnelView
      tenantId={tenantId ?? null}
      range={range}
      segment={segment}
      track={search.track ?? "all"}
      stage={search.stage}
      onSearchChange={(patch) => {
        // Tor i krok to NOWE wpisy historii: „Wstecz" zamyka arkusz kroku
        // i wraca do poprzedniego toru.
        void navigate({ to: ".", search: (prev) => ({ ...prev, ...patch }) });
      }}
    />
  );
}
