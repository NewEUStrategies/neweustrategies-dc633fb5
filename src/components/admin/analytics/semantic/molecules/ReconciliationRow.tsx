/**
 * Molekuła: jedna metryka kanoniczna w panelu uzgodnienia.
 *
 * Układ celowo hierarchiczny: NAJPIERW jedna liczba do raportu (duża, z chipem
 * strumienia autorytatywnego), potem werdykt, a dopiero na końcu obserwacje
 * potwierdzające z odchyleniem. Odwrotna kolejność (dwie równorzędne liczby obok
 * siebie) była właśnie tym, co produkowało rozbieżne raporty - czytelnik wybierał
 * liczbę, która lepiej pasowała do narracji.
 *
 * Responsywność: na wąskim ekranie kolumny składają się w pionie, wartość
 * pozostaje pierwsza w kolejności czytania.
 */
import { useTranslation } from "react-i18next";
import "@/lib/i18n-admin-semantic";
import { Badge } from "@/components/ui/badge";
import { type ReconciliationEntry, metricById, needsAttention } from "@/lib/analytics/semantic";
import {
  chartLangOf,
  formatDeltaPct,
  formatMetricValue,
  formatSignedPct,
  formatSpread,
} from "@/lib/analytics/semantic/format";
import { StreamChip } from "../atoms/StreamChip";
import { VerdictBadge } from "../atoms/VerdictBadge";
import { MetricDefinitionPopover } from "./MetricDefinitionPopover";

export interface ReconciliationRowProps {
  entry: ReconciliationEntry;
  /** Zmiana wobec okna poprzedniego, w punktach procentowych. */
  deltaPct?: number | null;
}

export function ReconciliationRow({ entry, deltaPct }: ReconciliationRowProps) {
  const { t, i18n } = useTranslation();
  const lang = chartLangOf(i18n.language);
  const isEn = i18n.language?.toLowerCase().startsWith("en");
  const metric = metricById(entry.metricId);
  const attention = needsAttention(entry);

  const corroborating = entry.observations.filter(
    (o) => o.role === "corroborating" && o.value !== null,
  );

  return (
    <li
      className={
        "rounded-md border bg-card p-3 " + (attention ? "border-amber-500/40" : "border-border")
      }
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        {/* Wartość kanoniczna - jedyna liczba do zacytowania. */}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="text-[11px] uppercase tracking-wide text-muted-foreground truncate">
              {isEn ? metric.labelEn : metric.labelPl}
            </span>
            <MetricDefinitionPopover metricId={entry.metricId} />
          </div>
          <div className="mt-1 flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <span className="text-xl font-semibold tabular-nums leading-tight">
              {formatMetricValue(
                entry.canonicalValue,
                metric.unit,
                lang,
                t("adminAnalytics.semantic.noValue"),
              )}
            </span>
            {typeof deltaPct === "number" ? (
              <span
                className={
                  "text-[11px] font-medium tabular-nums " +
                  (deltaPct > 0
                    ? "text-emerald-600 dark:text-emerald-400"
                    : deltaPct < 0
                      ? "text-destructive"
                      : "text-muted-foreground")
                }
                title={t("adminAnalytics.semantic.deltaVsPrevious")}
              >
                {formatDeltaPct(deltaPct, lang)}
              </span>
            ) : null}
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-1">
            <StreamChip streamId={entry.authoritativeStream} role="authoritative" />
          </div>
        </div>

        {/* Werdykt + obserwacje potwierdzające. */}
        <div className="flex shrink-0 flex-col items-start gap-1.5 sm:items-end">
          <div className="flex flex-wrap items-center gap-1.5">
            <VerdictBadge verdict={entry.verdict} />
            {entry.spread !== null ? (
              <span className="text-[10px] text-muted-foreground tabular-nums">
                {t("adminAnalytics.semantic.spreadLabel")}: {formatSpread(entry.spread, lang)}
              </span>
            ) : null}
          </div>
          {corroborating.length > 0 ? (
            <ul className="flex flex-col items-start gap-1 sm:items-end">
              {corroborating.map((o) => (
                <li
                  key={`${entry.metricId}-${o.streamId}`}
                  className="flex flex-wrap items-center gap-1.5 text-[11px]"
                >
                  <StreamChip streamId={o.streamId} role="corroborating" />
                  <span className="tabular-nums text-muted-foreground">
                    {formatMetricValue(o.value, metric.unit, lang)}
                  </span>
                  {o.counted && o.deviation !== null ? (
                    <Badge variant="outline" className="text-[10px] tabular-nums">
                      {formatSignedPct(o.deviation, lang)}
                    </Badge>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      </div>

      {entry.reasons.length > 0 ? (
        <ul className="mt-2 space-y-1 border-t border-border/60 pt-2">
          {entry.reasons.map((reason) => (
            <li key={reason} className="flex gap-1.5 text-[11px] text-muted-foreground">
              <span aria-hidden className="leading-4 text-primary">
                →
              </span>
              <span className="leading-4">{t(`adminAnalytics.semantic.reason.${reason}`)}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </li>
  );
}
