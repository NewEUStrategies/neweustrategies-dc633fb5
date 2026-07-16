/**
 * BI insight primitive.
 *
 * Renderuje sekcję "Interpretacja i rekomendacje" - lista wpisów, każdy
 * przypięty do konkretnego elementu dashboardu (KPI, wykres, tabela).
 * Wpisy zawierają:
 *   - severity (info / good / warn / critical) sterujące kolorem paska
 *   - element - do jakiego widgetu odnosi się wniosek
 *   - detail - co widzimy w danych (interpretacja)
 *   - fixes - konkretne działania (rekomendacja)
 *
 * Dashboardy (GSC / GA4 / Web Vitals / Przegląd) budują listę insightów
 * ze swoich danych i renderują pojedynczą `InsightSection` na dole, dzięki
 * czemu użytkownik dostaje wnioski dla KAŻDEGO elementu bez konieczności
 * ich rozbijania w layoutcie.
 */
import { type ReactNode } from "react";
import { AlertTriangle, CheckCircle2, Info, Lightbulb, TriangleAlert } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export type InsightSeverity = "good" | "info" | "warn" | "critical";

export interface Insight {
  id: string;
  element: string;
  severity: InsightSeverity;
  title: string;
  detail: string;
  fixes: string[];
}

const STYLE: Record<InsightSeverity, { ring: string; badge: string; icon: ReactNode }> = {
  good: {
    ring: "border-emerald-500/30",
    badge: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30",
    icon: <CheckCircle2 className="w-4 h-4 text-emerald-500" />,
  },
  info: {
    ring: "border-sky-500/30",
    badge: "bg-sky-500/15 text-sky-600 dark:text-sky-400 border-sky-500/30",
    icon: <Info className="w-4 h-4 text-sky-500" />,
  },
  warn: {
    ring: "border-amber-500/30",
    badge: "bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30",
    icon: <AlertTriangle className="w-4 h-4 text-amber-500" />,
  },
  critical: {
    ring: "border-red-500/30",
    badge: "bg-red-500/15 text-red-600 dark:text-red-400 border-red-500/30",
    icon: <TriangleAlert className="w-4 h-4 text-red-500" />,
  },
};

const ORDER: Record<InsightSeverity, number> = { critical: 0, warn: 1, info: 2, good: 3 };

export function InsightSection({
  title = "Interpretacja i rekomendacje",
  subtitle,
  insights,
  emptyLabel = "Nie znaleziono krytycznych zagadnień - utrzymaj obecną strategię.",
}: {
  title?: string;
  subtitle?: string;
  insights: Insight[];
  emptyLabel?: string;
}) {
  if (insights.length === 0) {
    return (
      <Card className="p-4 border-emerald-500/30 bg-emerald-500/5">
        <div className="flex items-start gap-3">
          <span className="flex items-center h-5 shrink-0">
            <CheckCircle2 className="w-5 h-5 text-emerald-500" />
          </span>
          <div>
            <div className="text-sm font-semibold leading-5">{title}</div>
            <p className="text-xs text-muted-foreground mt-1">{emptyLabel}</p>
          </div>
        </div>
      </Card>

    );
  }
  const sorted = [...insights].sort((a, b) => ORDER[a.severity] - ORDER[b.severity]);
  const counts = sorted.reduce<Record<InsightSeverity, number>>(
    (acc, i) => ({ ...acc, [i.severity]: acc[i.severity] + 1 }),
    { good: 0, info: 0, warn: 0, critical: 0 },
  );
  return (
    <Card className="p-4 space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <Lightbulb className="w-4 h-4 text-primary" />
          <div>
            <h3 className="text-sm font-semibold leading-none">{title}</h3>
            {subtitle ? (
              <p className="text-[11px] text-muted-foreground mt-1">{subtitle}</p>
            ) : null}
          </div>
        </div>
        <div className="flex items-center gap-1.5 flex-wrap">
          {counts.critical > 0 ? (
            <Badge variant="outline" className={STYLE.critical.badge}>
              {counts.critical} krytycznych
            </Badge>
          ) : null}
          {counts.warn > 0 ? (
            <Badge variant="outline" className={STYLE.warn.badge}>
              {counts.warn} do poprawy
            </Badge>
          ) : null}
          {counts.info > 0 ? (
            <Badge variant="outline" className={STYLE.info.badge}>
              {counts.info} obserwacji
            </Badge>
          ) : null}
          {counts.good > 0 ? (
            <Badge variant="outline" className={STYLE.good.badge}>
              {counts.good} OK
            </Badge>
          ) : null}
        </div>
      </div>

      <ul className="space-y-2.5">
        {sorted.map((i) => {
          const style = STYLE[i.severity];
          return (
            <li key={i.id} className={`rounded-md border ${style.ring} bg-card p-3`}>
              <div className="flex items-start gap-2.5">
                <span className="flex items-center h-5 shrink-0">{style.icon}</span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-semibold leading-5">{i.title}</span>
                    <Badge variant="outline" className="text-[10px] uppercase tracking-wide">
                      {i.element}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">{i.detail}</p>
                  {i.fixes.length > 0 ? (
                    <ul className="mt-2 space-y-1 text-xs">
                      {i.fixes.map((fix, idx) => (
                        <li key={idx} className="flex items-start gap-2">
                          <span className="flex items-center h-4 text-primary leading-none shrink-0">→</span>
                          <span className="leading-4">{fix}</span>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              </div>
            </li>

          );
        })}
      </ul>
    </Card>
  );
}

/** Helper - procent zmiany między dwoma wartościami (higherIsBetter). */
export function pctDelta(cur: number, prev: number): number | null {
  if (!Number.isFinite(cur) || !Number.isFinite(prev) || prev === 0) return null;
  return ((cur - prev) / prev) * 100;
}

/** Klasyfikuje deltę względem znaku i tego, czy większa wartość jest lepsza. */
export function classifyDelta(
  delta: number | null,
  higherIsBetter: boolean,
): InsightSeverity {
  if (delta === null) return "info";
  const good = higherIsBetter ? delta >= 5 : delta <= -5;
  const bad = higherIsBetter ? delta <= -15 : delta >= 15;
  if (bad) return "warn";
  if (good) return "good";
  return "info";
}
