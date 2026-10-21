// Zakładka „Oferta" huba (S7, SPEC §2.2 `offer`) - drabina cen, macierz
// plan × benefit z konfliktami P20, rabaty i kupony, kasa w jednym zdaniu
// (`RevenueOfferView`).
//
// Montuje ją leniwie `RevenueTabOutlet` (mapa `tab -> lazy`), więc kod
// zakładki trafia do własnego chunku dopiero po wejściu na
// `/admin/revenue/offer`.
//
// `useHydrated()` PRZED SESJĄ (jak układ huba). ROLE DOKŁADNE: administrator
// edytuje, redaktor ogląda w trybie podglądu (przyciski `disabled` +
// `Tooltip`), sam `super_admin` bez wiersza roli dostaje `RoleGateNotice`.
import { useHydrated } from "@tanstack/react-router";

import { RevenueTabPending } from "@/components/admin/revenue/atoms/RevenueTabPending";
import { RoleGateNotice } from "@/components/admin/revenue/molecules/RoleGateNotice";
import { RevenueOfferView } from "@/components/admin/revenue/offer/RevenueOfferView";
import { hubRoleOf, useHubWindow } from "@/components/admin/revenue/overview/hubWindow";
import { useAuth } from "@/hooks/useAuth";
import { ensureI18n } from "@/lib/i18n-admin-revenue-tabs";

export function RevenueOfferTab() {
  ensureI18n();
  const hydrated = useHydrated();
  return (
    <div data-testid="revenue-tab-offer">{hydrated ? <OfferTabBody /> : <RevenueTabPending />}</div>
  );
}

function OfferTabBody() {
  const { roles, tenantId } = useAuth();
  const { search } = useHubWindow("offer");
  if (hubRoleOf(roles) === null) return <RoleGateNotice requiredRole="admin_or_editor" />;
  return <RevenueOfferView tenantId={tenantId ?? null} roles={roles} section={search.sec} />;
}
