// Organizm: kondycja obszarów 0-100 na Kokpicie (SPEC §2.2 `overview`) -
// `AreaHealthList` S6 zasilany diagnozami S7-A.
//
// TE SAME DIAGNOZY CO „WYMAGA UWAGI" I DIAGNOSTYKA: fakty i wyciszenia
// z fabryk S7-A (`revenueFactsQueryOptions`, `revenueSnoozesQueryOptions`),
// ocena `evaluateFindings`, wynik `areaHealthScore` z `hubTabs.ts`
// (krytyczna −20, ważna −7). Liczone są wyłącznie diagnozy OTWARTE -
// wyciszona sprawa nie obniża wyniku, bo admin świadomie ją odłożył.
//
// OBSZAR BEZ FAKTÓW = `null` (brak danych), nie 100: obszar, o którym nic nie
// wiadomo, nie jest zdrowy, jest nieznany.
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";

import { MfaRequiredNotice } from "@/components/admin/revenue/molecules/MfaRequiredNotice";
import { AreaHealthList } from "@/components/admin/revenue/molecules/AreaHealthList";
import { RevenueSection } from "@/components/admin/revenue/molecules/RevenueSection";
import { ensureI18n as ensureRevenueI18n } from "@/lib/i18n-admin-revenue";
import { ensureI18n } from "@/lib/i18n-admin-revenue-tabs";
import {
  evaluateFindings,
  revenueFactsQueryOptions,
  revenueSnoozesQueryOptions,
} from "@/lib/revenue/diagnostics/queries";
import { areaHealthGroups } from "./areaHealth";

export interface SystemHealthCardProps {
  tenantId: string | null;
  roles: readonly string[];
}

export function SystemHealthCard({ tenantId, roles }: SystemHealthCardProps) {
  ensureRevenueI18n();
  ensureI18n();
  const { t } = useTranslation();
  const roleOk = roles.includes("admin") || roles.includes("editor");
  const facts = useQuery(revenueFactsQueryOptions(tenantId, { roleOk }));
  const snoozes = useQuery(revenueSnoozesQueryOptions(tenantId, { roleOk }));
  const groups = useMemo(() => {
    if (facts.data?.state !== "ready") return null;
    const active = snoozes.data?.state === "ready" ? snoozes.data.snoozes : [];
    return areaHealthGroups(facts.data.facts, evaluateFindings(facts.data.facts, active));
  }, [facts.data, snoozes.data]);

  let body;
  if (groups !== null) body = <AreaHealthList groups={groups} />;
  else if (facts.data?.state === "mfa_required") body = <MfaRequiredNotice />;
  else if (tenantId && roleOk && facts.isPending && !facts.isError) {
    body = (
      <p role="status" className="m-0 text-sm text-muted-foreground">
        {t("adminRevenue.common.loading")}
      </p>
    );
  } else {
    body = (
      <p role="status" className="m-0 text-sm text-muted-foreground" data-testid="health-unknown">
        {t("adminRevenue.overview.system.unknown")}
      </p>
    );
  }

  return (
    <div data-testid="overview-system">
      <RevenueSection
        titleKey="adminRevenue.overview.system.title"
        descriptionKey="adminRevenue.overview.system.description"
      >
        {body}
      </RevenueSection>
    </div>
  );
}
