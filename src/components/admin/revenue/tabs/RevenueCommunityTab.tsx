// Zakładka „Społeczność" huba (S7, SPEC §2.2 `community`) - wiersz KPI,
// sekcje `?sec=events|clubs`, przychód z biletów per waluta, pula biletów
// z planu i lejek zgłoszeń do klubów (`RevenueCommunityView`).
//
// Montuje ją leniwie `RevenueTabOutlet` (mapa `tab -> lazy`), więc kod
// zakładki trafia do własnego chunku dopiero po wejściu na
// `/admin/revenue/community`.
//
// ADMINISTRATOR I REDAKTOR (SPEC §2.5): redaktor widzi liczby bez kwot (SQL
// oddaje `by_currency = null`, kafel przychodu to `LockedMetricTile`). Rola
// spoza huba - `RoleGateNotice` bez jednego żądania. ROLE DOKŁADNE
// (`hubRoleOf`), nie `isAdmin` z `super_admin`.
// `useHydrated()` PRZED SESJĄ: do hydratacji serwer i klient rysują ten sam
// stan „wczytywanie" - treść zależna od roli i od modułu klubów najemcy nie
// podmienia markupu gościa przed hydratacją.
import { useHydrated, useNavigate } from "@tanstack/react-router";

import { RevenueTabPending } from "@/components/admin/revenue/atoms/RevenueTabPending";
import { RevenueCommunityView } from "@/components/admin/revenue/community/RevenueCommunityView";
import { RoleGateNotice } from "@/components/admin/revenue/molecules/RoleGateNotice";
import { hubRoleOf, useHubWindow } from "@/components/admin/revenue/overview/hubWindow";
import { useAuth } from "@/hooks/useAuth";
import { ensureI18n } from "@/lib/i18n-admin-revenue-tabs";

export function RevenueCommunityTab() {
  ensureI18n();
  const hydrated = useHydrated();
  return (
    <div data-testid="revenue-tab-community">
      {hydrated ? <CommunityTabBody /> : <RevenueTabPending />}
    </div>
  );
}

function CommunityTabBody() {
  const { roles, tenantId } = useAuth();
  const navigate = useNavigate();
  const { search, range, currency, segment } = useHubWindow("community");
  if (hubRoleOf(roles) === null) return <RoleGateNotice requiredRole="admin_or_editor" />;
  return (
    <RevenueCommunityView
      tenantId={tenantId ?? null}
      roles={roles}
      range={range}
      currency={currency}
      segment={segment}
      section={search.sec}
      onSectionChange={(sec) => {
        // Sekcja to NOWY wpis historii: „Wstecz" wraca do poprzedniej sekcji.
        void navigate({ to: ".", search: (prev) => ({ ...prev, sec }) });
      }}
    />
  );
}
