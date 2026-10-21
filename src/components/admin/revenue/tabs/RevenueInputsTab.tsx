// Zakładka „Dane wejściowe" huba (S7, SPEC §2.2 `inputs` - podwidok
// Wskaźników) - siatka planu, kosztów i marż (`ManualInputsGrid`).
//
// Montuje ją leniwie `RevenueTabOutlet` (mapa `tab -> lazy`), więc kod
// zakładki trafia do własnego chunku dopiero po wejściu na
// `/admin/revenue/inputs`.
//
// TYLKO ADMINISTRATOR (D-06: plan i koszty to dane finansowe; SQL
// `has_role(…, 'admin')`). Redaktor, który wejdzie z adresu, dostaje
// `RoleGateNotice` - siatka nie jest montowana, więc RPC nie jest wołane.
// ROLE DOKŁADNE (`roles.includes("admin")`), nie `isAdmin` z `super_admin`.
// `useHydrated()` PRZED SESJĄ, jak układ huba.
import { useHydrated } from "@tanstack/react-router";

import { RevenueTabPending } from "@/components/admin/revenue/atoms/RevenueTabPending";
import { ManualInputsGrid } from "@/components/admin/revenue/inputs/ManualInputsGrid";
import { RoleGateNotice } from "@/components/admin/revenue/molecules/RoleGateNotice";
import { useHubWindow } from "@/components/admin/revenue/overview/hubWindow";
import { useAuth } from "@/hooks/useAuth";
import { ensureI18n } from "@/lib/i18n-admin-revenue-tabs";

export function RevenueInputsTab() {
  ensureI18n();
  const hydrated = useHydrated();
  return (
    <div data-testid="revenue-tab-inputs">
      {hydrated ? <InputsTabBody /> : <RevenueTabPending />}
    </div>
  );
}

function InputsTabBody() {
  const { roles, tenantId } = useAuth();
  const { segment } = useHubWindow("inputs");
  if (!roles.includes("admin")) return <RoleGateNotice requiredRole="admin" />;
  return <ManualInputsGrid tenantId={tenantId ?? null} roles={roles} segment={segment} />;
}
