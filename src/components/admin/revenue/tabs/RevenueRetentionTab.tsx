// Zakładka „Retencja" huba (S7, SPEC §2.2 `retention`) - wiersz KPI
// z migawki, odejścia i retencja przychodu per waluta, kohorty (mapa
// ciepła), przepływ anulowania (≤ 2 kroki), oferty zatrzymania, powody
// odejść i windykacja (`RevenueRetentionView`).
//
// Montuje ją leniwie `RevenueTabOutlet` (mapa `tab -> lazy`), więc kod
// zakładki trafia do własnego chunku dopiero po wejściu na
// `/admin/revenue/retention`.
//
// TYLKO ADMINISTRATOR (SPEC §2.5: retencja przychodu to kwoty; SQL
// `has_role(…, 'admin')`). Redaktor z adresu dostaje `RoleGateNotice` bez
// jednego wywołania RPC finansowego. ROLE DOKŁADNE, nie `isAdmin`.
// `useHydrated()` PRZED SESJĄ (jak układ huba).
import { useHydrated } from "@tanstack/react-router";

import { RevenueTabPending } from "@/components/admin/revenue/atoms/RevenueTabPending";
import { RoleGateNotice } from "@/components/admin/revenue/molecules/RoleGateNotice";
import { useHubWindow } from "@/components/admin/revenue/overview/hubWindow";
import { RevenueRetentionView } from "@/components/admin/revenue/retention/RevenueRetentionView";
import { useAuth } from "@/hooks/useAuth";
import { ensureI18n } from "@/lib/i18n-admin-revenue-tabs";

export function RevenueRetentionTab() {
  ensureI18n();
  const hydrated = useHydrated();
  return (
    <div data-testid="revenue-tab-retention">
      {hydrated ? <RetentionTabBody /> : <RevenueTabPending />}
    </div>
  );
}

function RetentionTabBody() {
  const { roles, tenantId } = useAuth();
  const { range, currency, segment } = useHubWindow("retention");
  if (!roles.includes("admin")) return <RoleGateNotice requiredRole="admin" />;
  return (
    <RevenueRetentionView
      tenantId={tenantId ?? null}
      roles={roles}
      range={range}
      currency={currency}
      segment={segment}
    />
  );
}
