// Molekuła: skuteczność kontroferty w trzech kafelkach.
//
// Liczby liczy reguła (`retentionStats` z 90-dniowym oknem i mianownikiem
// „pokazane oferty"); tutaj zostaje tylko sposób ich pokazania. Kluczowy
// szczegół prezentacji: przy `acceptRate === null` NIE pokazujemy „0%", bo brak
// pokazanych ofert to brak próby, nie porażka rabatu.
//
// „Bez podanego powodu" stoi POD rankingiem, nie w nim (I9, Z-S7-08), a
// etykiety powodów idą przez wspólny `RetentionReasonText` (`stripe:<kod>`).
import { useTranslation } from "react-i18next";

import { RetentionReasonText } from "@/components/admin/pricing/atoms/RetentionReasonText";
import { Card, CardContent } from "@/components/ui/card";
import type { RetentionStats } from "@/lib/admin/retentionStats";

export function RetentionStatsCards({ stats }: { stats: RetentionStats }) {
  const { t } = useTranslation();
  const ta = (k: string, opts?: Record<string, unknown>) => t(`adminPricing.${k}`, opts);
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
      <Card>
        <CardContent className="pb-4 pt-5">
          <div className="text-xs text-muted-foreground">{ta("retention.stats.total")}</div>
          <div className="text-2xl font-bold">{stats.total}</div>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="pb-4 pt-5">
          <div className="text-xs text-muted-foreground">{ta("retention.stats.accepted")}</div>
          <div className="text-2xl font-bold">
            {stats.accepted}
            {stats.acceptRate !== null && (
              <span className="ml-2 text-sm font-medium text-muted-foreground">
                ({stats.acceptRate}%)
              </span>
            )}
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="pb-4 pt-5">
          <div className="text-xs text-muted-foreground">{ta("retention.stats.topReasons")}</div>
          {stats.topReasons.length === 0 ? (
            <div className="text-sm text-muted-foreground">-</div>
          ) : (
            <ul className="mt-1 space-y-0.5 text-sm">
              {stats.topReasons.map(([label, count]) => (
                <li key={label} className="flex items-center justify-between gap-2">
                  <span className="truncate">
                    <RetentionReasonText label={label} />
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground">{count}</span>
                </li>
              ))}
            </ul>
          )}
          {stats.notGiven > 0 ? (
            <div className="mt-1 text-xs text-muted-foreground">
              {ta("retention.stats.notGiven", { count: stats.notGiven })}
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
