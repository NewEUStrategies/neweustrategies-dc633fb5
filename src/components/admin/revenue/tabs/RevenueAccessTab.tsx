// Zakładka „Dostęp" huba (S7, SPEC §2.2 `access`) - polityka w jednym
// zdaniu, lista kontrolna paywalla, pomiar, symulator czytelnika (5 person,
// ten sam `Paywall` co artykuł), licznik darmowych artykułów (karta S1)
// i inwentarz reguł (`RevenueAccessView`).
//
// Montuje ją leniwie `RevenueTabOutlet` (mapa `tab -> lazy`), więc kod
// zakładki trafia do własnego chunku dopiero po wejściu na
// `/admin/revenue/access`.
//
// `useHydrated()` PRZED SESJĄ (jak układ huba); ROLE DOKŁADNE: redaktor widzi
// zakładkę, ale kartę licznika w trybie `readOnly`, a sam `super_admin` bez
// wiersza `admin`/`editor` dostaje `RoleGateNotice` zamiast pustych kart.
import { useHydrated } from "@tanstack/react-router";

import { RevenueAccessView } from "@/components/admin/revenue/access/RevenueAccessView";
import { RevenueTabPending } from "@/components/admin/revenue/atoms/RevenueTabPending";
import { RoleGateNotice } from "@/components/admin/revenue/molecules/RoleGateNotice";
import { hubRoleOf, useHubWindow } from "@/components/admin/revenue/overview/hubWindow";
import { useAuth } from "@/hooks/useAuth";
import { ensureI18n } from "@/lib/i18n-admin-revenue-tabs";

export function RevenueAccessTab() {
  ensureI18n();
  const hydrated = useHydrated();
  return (
    <div data-testid="revenue-tab-access">
      {hydrated ? <AccessTabBody /> : <RevenueTabPending />}
    </div>
  );
}

function AccessTabBody() {
  const { roles, tenantId } = useAuth();
  const { range, segment } = useHubWindow("access");
  if (hubRoleOf(roles) === null) return <RoleGateNotice requiredRole="admin_or_editor" />;
  return (
    <RevenueAccessView tenantId={tenantId ?? null} roles={roles} range={range} segment={segment} />
  );
}
