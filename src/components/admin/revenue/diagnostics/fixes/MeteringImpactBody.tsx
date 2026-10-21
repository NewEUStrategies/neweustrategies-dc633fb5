// Treść naprawy `metering_defaults`: podgląd skutku domyślnego limitu
// członków w bieżącym miesiącu - ten sam RPC i klucz co karta licznika
// w paywallu (`meteringImpactPreviewQueryOptions`), więc admin widzi tę samą
// liczbę „zablokowanych" przed zapisem tutaj i w module.
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

import { METERING_DEFAULTS } from "@/lib/access/meteringDefaults";
import { meteringImpactPreviewQueryOptions } from "@/lib/access/meteringQueries";
import type { EmptyPayload, QuickFixBodyProps } from "@/lib/admin/revenue/quickFixes";
import { ensureI18n } from "@/lib/i18n-admin-revenue-diagnostics";

export default function MeteringImpactBody(_props: QuickFixBodyProps<EmptyPayload>) {
  ensureI18n();
  const { t } = useTranslation();
  const impact = useQuery(meteringImpactPreviewQueryOptions(METERING_DEFAULTS.member_monthly_limit, true));

  return (
    <section className="space-y-1 rounded-[6px] border border-border bg-muted/30 p-3 text-sm">
      <h4 className="m-0 text-sm font-medium">{t("adminRevenue.fix.body.impactTitle")}</h4>
      {impact.isPending ? (
        <p className="m-0 text-muted-foreground">{t("adminRevenue.fix.body.impactLoading")}</p>
      ) : !impact.data ? (
        <p className="m-0 text-muted-foreground">{t("adminRevenue.fix.body.impactUnavailable")}</p>
      ) : (
        <ul className="m-0 list-none space-y-0.5 p-0">
          <li>
            {t("adminRevenue.fix.body.impactMembers", {
              blocked: impact.data.members_blocked,
              warning: impact.data.members_warning,
              total: impact.data.total_members,
            })}
          </li>
          <li>
            {t("adminRevenue.fix.body.impactAnon", {
              blocked: impact.data.anon_blocked,
              total: impact.data.total_anon,
            })}
          </li>
        </ul>
      )}
    </section>
  );
}
