/**
 * Web Vitals - interpretacja i rekomendacje.
 *
 * Bierze zagregowany raport `VitalsSummaryResult` i zamienia go na
 * priorytetyzowaną listę wniosków plus konkretne działania naprawcze
 * (co, dlaczego, jak). Nie robi zapytań - konsumuje dane, które i tak są
 * już pobrane przez dashboard, więc można ją zamontować obok wykresów bez
 * dodatkowych roundtripów.
 */
import { useMemo, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import "@/lib/i18n-admin-analytics";
import { AlertTriangle, CheckCircle2, Lightbulb, TriangleAlert } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { VitalsSummaryResult } from "@/lib/observability/vitals.functions";
import type { VitalMetricSummary, VitalPathRow } from "@/lib/observability/aggregate";
import {
  VITAL_THRESHOLDS,
  type VitalName,
  type VitalRating,
} from "@/lib/observability/vitalsThresholds";

type Severity = "poor" | "needs-improvement" | "good";

interface Finding {
  id: string;
  severity: Severity;
  scope: "global" | "path";
  metric: VitalName;
  title: string;
  detail: string;
  fixes: string[];
  path?: string;
}

function fmt(metric: VitalName, v: number): string {
  if (!Number.isFinite(v)) return "-";
  if (metric === "CLS") return v.toFixed(3);
  if (v >= 1000) return `${(v / 1000).toFixed(2)} s`;
  return `${Math.round(v)} ms`;
}

// Katalog interpretacji per metryka + rating. Tytuły i listy działań (`fixes`)
// są przechowywane jako klucze i18n (adminAnalytics.vitals.playbook.*), a
// `detail` budowane jest z wartości p75 przez t() w funkcjach poniżej.
const SEG: Record<Exclude<Severity, "good">, "ni" | "poor"> = {
  "needs-improvement": "ni",
  poor: "poor",
};

function playbookKey(
  metric: VitalName,
  sev: Exclude<Severity, "good">,
  leaf: "title" | "fixes",
): string {
  return `adminAnalytics.vitals.playbook.${metric}.${SEG[sev]}.${leaf}`;
}

function metricFinding(m: VitalMetricSummary, t: TFunction): Finding | null {
  if (m.rating === "good") return null;
  const fixes = t(playbookKey(m.metric, m.rating, "fixes"), { returnObjects: true }) as string[];
  if (!Array.isArray(fixes) || fixes.length === 0) return null;
  return {
    id: `global-${m.metric}`,
    severity: m.rating,
    scope: "global",
    metric: m.metric,
    title: t(playbookKey(m.metric, m.rating, "title")),
    detail: t("adminAnalytics.vitals.globalDetail", {
      p75: fmt(m.metric, m.p75),
      good: m.good,
      ni: m.needsImprovement,
      poor: m.poor,
      count: m.count,
    }),
    fixes,
  };
}

function pathFindings(paths: VitalPathRow[], t: TFunction): Finding[] {
  const out: Finding[] = [];
  for (const p of paths) {
    for (const pm of p.metrics) {
      if (pm.rating !== "poor") continue; // per-path tylko poor - inaczej byłby szum
      const fixes = t(playbookKey(pm.metric, "poor", "fixes"), { returnObjects: true }) as string[];
      if (!Array.isArray(fixes)) continue;
      out.push({
        id: `${p.path}-${pm.metric}`,
        severity: "poor",
        scope: "path",
        metric: pm.metric,
        path: p.path,
        title: t("adminAnalytics.vitals.pathTitle", {
          metric: pm.metric,
          path: p.path,
          value: fmt(pm.metric, pm.p75),
        }),
        detail: t("adminAnalytics.vitals.pathDetail", {
          total: p.total,
          threshold: fmt(pm.metric, VITAL_THRESHOLDS[pm.metric][1]),
        }),
        fixes: fixes.slice(0, 3),
      });
    }
  }
  return out;
}

const SEVERITY_ORDER: Record<Severity, number> = { poor: 0, "needs-improvement": 1, good: 2 };

const SEVERITY_STYLE: Record<
  Exclude<Severity, "good">,
  { badge: string; ring: string; icon: ReactNode }
> = {
  poor: {
    badge: "bg-red-500/15 text-red-600 dark:text-red-400 border-red-500/30",
    ring: "border-red-500/30",
    icon: <TriangleAlert className="w-4 h-4 text-red-500" />,
  },
  "needs-improvement": {
    badge: "bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30",
    ring: "border-amber-500/30",
    icon: <AlertTriangle className="w-4 h-4 text-amber-500" />,
  },
};

export function VitalsRecommendations({ report }: { report: VitalsSummaryResult }) {
  const { t } = useTranslation();
  const findings = useMemo<Finding[]>(() => {
    const globals = report.metrics
      .map((m) => metricFinding(m, t))
      .filter((f): f is Finding => f !== null);
    const perPath = pathFindings(report.paths ?? [], t);
    return [...globals, ...perPath].sort(
      (a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity],
    );
  }, [report, t]);

  if (findings.length === 0) {
    return (
      <Card className="p-4 border-emerald-500/30 bg-emerald-500/5">
        <div className="flex items-start gap-3">
          <CheckCircle2 className="w-5 h-5 text-emerald-500 shrink-0 mt-0.5" />
          <div>
            <div className="text-sm font-semibold">{t("adminAnalytics.vitals.allGood")}</div>
            <p className="text-xs text-muted-foreground mt-1">
              {t("adminAnalytics.vitals.allGoodDetail")}
            </p>
          </div>
        </div>
      </Card>
    );
  }

  const poor = findings.filter((f) => f.severity === "poor").length;
  const ni = findings.filter((f) => f.severity === "needs-improvement").length;

  return (
    <Card className="p-4 space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <Lightbulb className="w-4 h-4 text-primary" />
          <h3 className="text-sm font-semibold">
            {t("adminAnalytics.insightSection.defaultTitle")}
          </h3>
        </div>
        <div className="flex items-center gap-2">
          {poor > 0 ? (
            <Badge variant="outline" className={SEVERITY_STYLE.poor.badge}>
              {t("adminAnalytics.insightSection.badgeCritical", { count: poor })}
            </Badge>
          ) : null}
          {ni > 0 ? (
            <Badge variant="outline" className={SEVERITY_STYLE["needs-improvement"].badge}>
              {t("adminAnalytics.insightSection.badgeWarn", { count: ni })}
            </Badge>
          ) : null}
        </div>
      </div>

      <ul className="space-y-2.5">
        {findings.slice(0, 12).map((f) => {
          const style = SEVERITY_STYLE[f.severity as Exclude<Severity, "good">];
          return (
            <li key={f.id} className={`rounded-md border ${style.ring} bg-card p-3`}>
              <div className="flex items-start gap-2.5">
                <div className="mt-0.5">{style.icon}</div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-semibold">{f.title}</span>
                    <Badge variant="outline" className="text-[10px] uppercase tracking-wide">
                      {f.scope === "path"
                        ? t("adminAnalytics.vitals.scopePath")
                        : t("adminAnalytics.vitals.scopeGlobal")}
                    </Badge>
                    {f.path ? (
                      <span className="font-mono text-[11px] text-muted-foreground truncate">
                        {f.path}
                      </span>
                    ) : null}
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">{f.detail}</p>
                  <ul className="mt-2 space-y-1 text-xs">
                    {f.fixes.map((fix, i) => (
                      <li key={i} className="flex items-start gap-2">
                        <span className="text-primary mt-1">→</span>
                        <span>{fix}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </li>
          );
        })}
      </ul>

      {findings.length > 12 ? (
        <p className="text-[11px] text-muted-foreground">
          {t("adminAnalytics.vitals.moreFindings", { count: findings.length })}
        </p>
      ) : null}
    </Card>
  );
}
