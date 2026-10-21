// Zakładka „Przychód" huba (S7, SPEC §2.2 `mrr`) - wiersz KPI z migawki,
// MRR w czasie, most, ruchy, przychód zrealizowany per kategoria i waluta
// oraz zgodność źródeł (`RevenueMrrView`).
//
// Montuje ją leniwie `RevenueTabOutlet` (mapa `tab -> lazy`), więc kod
// zakładki trafia do własnego chunku dopiero po wejściu na
// `/admin/revenue/mrr`.
//
// TYLKO ADMINISTRATOR (SPEC §2.5: Przychód to kwoty; SQL `has_role(…,
// 'admin')`). Redaktor, który wejdzie z adresu, dostaje `RoleGateNotice` -
// karty nie są montowane, więc żadne RPC finansowe nie jest wołane. ROLE
// DOKŁADNE (`roles.includes("admin")`), nie `isAdmin` z `super_admin`.
// `useHydrated()` PRZED SESJĄ: do hydratacji serwer i klient rysują ten sam
// stan „wczytywanie" (jak układ huba).
import { useHydrated } from "@tanstack/react-router";

import { RevenueTabPending } from "@/components/admin/revenue/atoms/RevenueTabPending";
import { RoleGateNotice } from "@/components/admin/revenue/molecules/RoleGateNotice";
import { RevenueMrrView } from "@/components/admin/revenue/mrr/RevenueMrrView";
import { useHubWindow } from "@/components/admin/revenue/overview/hubWindow";
import { useAuth } from "@/hooks/useAuth";
import { ensureI18n } from "@/lib/i18n-admin-revenue-tabs";

export function RevenueMrrTab() {
  ensureI18n();
  const hydrated = useHydrated();
  return (
    <div data-testid="revenue-tab-mrr">{hydrated ? <MrrTabBody /> : <RevenueTabPending />}</div>
  );
}

function MrrTabBody() {
  const { roles, tenantId } = useAuth();
  const { range, currency, segment } = useHubWindow("mrr");
  if (!roles.includes("admin")) return <RoleGateNotice requiredRole="admin" />;
  return (
    <RevenueMrrView
      tenantId={tenantId ?? null}
      roles={roles}
      range={range}
      currency={currency}
      segment={segment}
    />
  );
}
