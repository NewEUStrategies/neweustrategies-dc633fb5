// Molekuła: kondycja obszarów 0-100 na Kokpicie (SPEC §2.2, §6.1).
//
// SKALA `brandAuditScore`. Wynik liczy producent faktów (S7) funkcją
// `areaHealthScore` z `hubTabs.ts`: krytyczna diagnoza −20, ważna −7. Ta sama
// skala co audyt marki, bo admin widzi oba wyniki w panelu - „72" ma znaczyć
// to samo w obu miejscach. Komponent tylko POKAZUJE wynik i liczby; nie
// przelicza ich, żeby dwie implementacje nie dały dwóch różnych ocen.
//
// `null` = BRAK DANYCH, nie 100. Obszar bez faktów (nowy najemca, reguła bez
// pola w `RevenueFacts`) nie jest „zdrowy" - jest nieznany. „100" przy braku
// danych to dokładnie ten fałszywy spokój, przed którym diagnostyka ma chronić.
//
// WAGI SŁOWEM I IKONĄ (`SeverityLabel`), nie kolorem paska - lista ma być
// czytelna także w skali szarości i dla czytnika ekranu.
import { useId } from "react";
import { useTranslation } from "react-i18next";

import { AreaChip } from "@/components/admin/revenue/atoms/AreaChip";
import { SeverityLabel } from "@/components/admin/revenue/atoms/SeverityLabel";
import type { RevenueArea } from "@/lib/admin/revenue/hubTabs";
import { ensureI18n } from "@/lib/i18n-admin-revenue-shell";
import { cn } from "@/lib/utils";

export interface AreaHealthCounts {
  critical: number;
  warning: number;
  info?: number;
}

export interface AreaHealthGroup {
  group: RevenueArea;
  /** Wynik 0-100 (`areaHealthScore`); `null` = brak faktów o obszarze. */
  score: number | null;
  counts: AreaHealthCounts;
}

export interface AreaHealthListProps {
  groups: readonly AreaHealthGroup[];
  className?: string;
}

export function AreaHealthList({ groups, className }: AreaHealthListProps) {
  ensureI18n();
  const { t } = useTranslation();
  const titleId = useId();

  return (
    <section aria-labelledby={titleId} className={cn("space-y-2", className)}>
      <h3 id={titleId} className="text-sm font-semibold">
        {t("adminRevenue.areaHealth.title")}
      </h3>
      <ul className="divide-y divide-border">
        {groups.map(({ group, score, counts }) => {
          const total = counts.critical + counts.warning + (counts.info ?? 0);
          return (
            <li
              key={group}
              data-area={group}
              className="flex flex-wrap items-center justify-between gap-2 py-2"
            >
              <AreaChip area={group} />
              <div className="flex flex-wrap items-center gap-3 text-xs">
                {score === null ? (
                  <span data-score="none" className="text-muted-foreground">
                    {t("adminRevenue.areaHealth.noData")}
                  </span>
                ) : (
                  <span data-score={score} className="font-semibold tabular-nums text-foreground">
                    {t("adminRevenue.areaHealth.score", { score })}
                  </span>
                )}
                {counts.critical > 0 ? (
                  <span className="inline-flex items-center gap-1">
                    <SeverityLabel severity="critical" />
                    <span className="tabular-nums">{counts.critical}</span>
                  </span>
                ) : null}
                {counts.warning > 0 ? (
                  <span className="inline-flex items-center gap-1">
                    <SeverityLabel severity="warning" />
                    <span className="tabular-nums">{counts.warning}</span>
                  </span>
                ) : null}
                {score !== null ? (
                  <span className="text-muted-foreground">
                    {t("adminRevenue.areaHealth.counts", { count: total })}
                  </span>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
