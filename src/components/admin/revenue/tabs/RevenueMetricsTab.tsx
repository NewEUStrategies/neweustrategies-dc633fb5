// Zakładka „Wskaźniki" huba (S7, SPEC §2.2 `metrics`, §6.5) - słownik
// wskaźników S6 z wartościami okna i oceną benchmarku, „brak danych"
// z powodem i odnośnikiem do Danych wejściowych oraz arkusz wskaźnika
// z adresu `?metric=&ctx=` (`MetricDictionaryView`).
//
// Montuje ją leniwie `RevenueTabOutlet` (mapa `tab -> lazy`), więc kod
// zakładki trafia do własnego chunku dopiero po wejściu na
// `/admin/revenue/metrics`; sam słownik S6 to kolejny leniwy chunk (ten sam,
// który ładuje sekcja BI).
//
// ADMINISTRATOR I REDAKTOR (SPEC §2.5): redaktor dostaje definicje, oceny
// wskaźników niefinansowych i powód „kwoty widzi administrator" - bez
// odczytu ekonomiki (RPC finansowe). ROLE DOKŁADNE (`hubRoleOf`).
// `useHydrated()` PRZED SESJĄ: do hydratacji serwer i klient rysują ten sam
// stan „wczytywanie".
import { useHydrated, useNavigate } from "@tanstack/react-router";

import { RevenueTabPending } from "@/components/admin/revenue/atoms/RevenueTabPending";
import { MetricDictionaryView } from "@/components/admin/revenue/metrics/MetricDictionaryView";
import { RoleGateNotice } from "@/components/admin/revenue/molecules/RoleGateNotice";
import { hubRoleOf, useHubWindow } from "@/components/admin/revenue/overview/hubWindow";
import { useAuth } from "@/hooks/useAuth";
import { ensureI18n } from "@/lib/i18n-admin-revenue-tabs";

export function RevenueMetricsTab() {
  ensureI18n();
  const hydrated = useHydrated();
  return (
    <div data-testid="revenue-tab-metrics">
      {hydrated ? <MetricsTabBody /> : <RevenueTabPending />}
    </div>
  );
}

function MetricsTabBody() {
  const { roles, tenantId } = useAuth();
  const navigate = useNavigate();
  const { search, range, currency, segment } = useHubWindow("metrics");
  if (hubRoleOf(roles) === null) return <RoleGateNotice requiredRole="admin_or_editor" />;
  return (
    <MetricDictionaryView
      tenantId={tenantId ?? null}
      roles={roles}
      range={range}
      currency={currency}
      segment={segment}
      metric={search.metric}
      ctx={search.ctx}
      onSearchChange={(patch, opts) => {
        // Otwarcie i zamknięcie arkusza to NOWE wpisy historii („Wstecz"
        // zamyka arkusz); zmiana kontekstu w otwartym arkuszu - podmiana.
        void navigate({ to: ".", search: (prev) => ({ ...prev, ...patch }), replace: opts?.replace });
      }}
    />
  );
}
