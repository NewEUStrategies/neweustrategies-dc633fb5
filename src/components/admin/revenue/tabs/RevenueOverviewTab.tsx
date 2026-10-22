// Zakładka „Kokpit" huba (S7, SPEC §2.2 `overview`) - „Zacznij tutaj",
// „Wymaga uwagi", kafle KPI, mini lejek i mini most MRR, kondycja obszarów
// i karty skrótu (`RevenueOverview`).
//
// Montuje ją trasa indeksu `/admin/revenue/` (`admin.revenue.index.tsx`) -
// splitter tras wynosi ją do własnego chunku.
//
// `useHydrated()` PRZED SESJĄ: do hydratacji serwer i klient rysują ten sam
// stan „wczytywanie" (jak układ huba), rola i najemca są czytane dopiero
// potem. ROLE DOKŁADNE (`roles.includes`), NIE `isAdmin`: zestaw kafli
// i most MRR zależą od wiersza `admin`, a sam `super_admin` dostałby od bazy
// odmowę zamiast liczb. Bez najemcy karty nie wysyłają zapytań.
import { useHydrated } from "@tanstack/react-router";

import { RevenueTabPending } from "@/components/admin/revenue/atoms/RevenueTabPending";
import { RoleGateNotice } from "@/components/admin/revenue/molecules/RoleGateNotice";
import { RevenueOverview } from "@/components/admin/revenue/overview/RevenueOverview";
import { hubRoleOf, useHubWindow } from "@/components/admin/revenue/overview/hubWindow";
import { useAuth } from "@/hooks/useAuth";
import { ensureI18n } from "@/lib/i18n-admin-revenue-tabs";

export function RevenueOverviewTab() {
  ensureI18n();
  const hydrated = useHydrated();
  return (
    <div data-testid="revenue-tab-overview">
      {hydrated ? <OverviewTabBody /> : <RevenueTabPending />}
    </div>
  );
}

function OverviewTabBody() {
  const { roles, tenantId } = useAuth();
  const { range, currency, segment } = useHubWindow("overview");
  if (hubRoleOf(roles) === null) return <RoleGateNotice requiredRole="admin_or_editor" />;
  return (
    <RevenueOverview
      tenantId={tenantId ?? null}
      roles={roles}
      range={range}
      currency={currency}
      segment={segment}
    />
  );
}
