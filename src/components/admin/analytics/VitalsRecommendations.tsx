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
import { AlertTriangle, CheckCircle2, Lightbulb, TriangleAlert } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { VitalsSummaryResult } from "@/lib/observability/vitals.functions";
import type { VitalMetricSummary, VitalPathRow } from "@/lib/observability/aggregate";
import { VITAL_THRESHOLDS, type VitalName, type VitalRating } from "@/lib/observability/vitalsThresholds";

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

// Katalog interpretacji per metryka + rating. `detail` jest tłumaczeniem
// wartości p75 na prosty język, `fixes` to konkretna lista działań.
const PLAYBOOK: Record<VitalName, Record<Exclude<Severity, "good">, { title: string; fixes: string[] }>> = {
  LCP: {
    "needs-improvement": {
      title: "LCP w strefie ostrzegawczej",
      fixes: [
        "Preload obrazu bohatera (LCP) w head route'a: rel=\"preload\" as=\"image\" fetchpriority=\"high\".",
        "Konwertuj obraz LCP do AVIF/WebP (vite-imagetools) i podawaj srcset dla 1x/2x.",
        "Dodaj width/height + loading=\"eager\" dla LCP; loading=\"lazy\" reszcie.",
        "Skróć krytyczną ścieżkę CSS: załaduj fonty jako preload woff2 + font-display: swap.",
      ],
    },
    poor: {
      title: "LCP powyżej progu - widoczny lag ładowania",
      fixes: [
        "Sprawdź czy LCP to obraz - jeśli tak, wymuś fetchpriority=\"high\" i preload w head().",
        "Odłóż niekrytyczne skrypty innych firm (analytics, chat) - defer/async lub po requestIdleCallback.",
        "Zmniejsz payload SSR: przenieś ciężkie widgety do React.lazy + Suspense.",
        "Włącz cache CDN na obrazy i statyki (Cache-Control: public, max-age=31536000, immutable).",
      ],
    },
  },
  INP: {
    "needs-improvement": {
      title: "INP w strefie ostrzegawczej",
      fixes: [
        "Rozbij długie zadania JS (>50 ms) na chunki: scheduler.yield() lub setTimeout(0).",
        "Zredukuj rerendery: React.memo, useMemo, useCallback dla ciężkich list.",
        "Debounce inputów w formularzach i wyszukiwarce (150-250 ms).",
      ],
    },
    poor: {
      title: "INP wysokie - interakcje są odczuwalnie ślamazarne",
      fixes: [
        "Profiluj Long Tasks w Performance panelu - namierz handler powyżej 200 ms.",
        "Przenieś ciężką kalkulację do useDeferredValue lub web workera.",
        "Usuń synchroniczne setState w onClick - zamień na startTransition.",
      ],
    },
  },
  CLS: {
    "needs-improvement": {
      title: "CLS w strefie ostrzegawczej - jest przeskakiwanie",
      fixes: [
        "Podaj width/height na każdym <img>, <video>, <iframe> aby zarezerwować miejsce.",
        "Dla dynamicznych banerów/reklam ustaw min-height kontenera zanim ad się załaduje.",
        "Wczytuj fonty przez preload woff2 + font-display: swap zamiast optional/block.",
      ],
    },
    poor: {
      title: "CLS wysokie - layout skacze przy renderze",
      fixes: [
        "Znajdź źródło shiftu: DevTools > Performance > Experience > Layout Shifts (zaznacz node).",
        "Przypnij wysokość skeletonów do finalnej wysokości kontentu.",
        "Nie wstrzykuj bannerów/notyfikacji nad treścią - używaj bottom sheet / toast overlay.",
      ],
    },
  },
  FCP: {
    "needs-improvement": {
      title: "FCP wolniejszy niż zalecane 1.8 s",
      fixes: [
        "Skróć TTFB (patrz sekcja TTFB) - FCP idzie za nim.",
        "Preload krytycznego CSS (styles.css) i głównego fontu - już masz Red Hat Display, upewnij się że preload trafia.",
        "Zmniejsz blokujący JS w head - przenieś skrypty do defer.",
      ],
    },
    poor: {
      title: "FCP powyżej 3 s - pusty ekran zbyt długo",
      fixes: [
        "Włącz SSR streaming - fragmenty HTML lecą do klienta zanim skończy się loader.",
        "Wyeliminuj render-blocking third-party (fonty Google, tag manager przed critical CSS).",
        "Sprawdź czy CDN cache trafia (Cache-Status: HIT) - miss oznacza cold path do origin.",
      ],
    },
  },
  TTFB: {
    "needs-improvement": {
      title: "TTFB powyżej 800 ms",
      fixes: [
        "Włącz cache SSR dla stron kategorii/wpisów (stale-while-revalidate).",
        "Skróć zapytania w loaderze - użyj context.queryClient.ensureQueryData zamiast wielu sekwencyjnych fetchy.",
        "Sprawdź czas RLS: przenieś ciężkie polityki do funkcji SECURITY DEFINER.",
      ],
    },
    poor: {
      title: "TTFB powyżej 1.8 s - serwer zbyt wolno odpowiada",
      fixes: [
        "Zprofiluj server functions: dodaj console.time w handler(), wyszukaj zapytania > 500 ms.",
        "Sprawdź slow_queries w Lovable Cloud - dodaj indeksy na kolumnach z WHERE / ORDER BY.",
        "Rozważ edge caching (Cache-Control: s-maxage=60, stale-while-revalidate=600) dla list publicznych.",
      ],
    },
  },
  FID: {
    "needs-improvement": { title: "FID - legacy metric", fixes: [] },
    poor: { title: "FID - legacy metric", fixes: [] },
  },
};

function metricFinding(m: VitalMetricSummary): Finding | null {
  if (m.rating === "good") return null;
  const play = PLAYBOOK[m.metric]?.[m.rating];
  if (!play || play.fixes.length === 0) return null;
  return {
    id: `global-${m.metric}`,
    severity: m.rating,
    scope: "global",
    metric: m.metric,
    title: play.title,
    detail: `p75 = ${fmt(m.metric, m.p75)}. W oknie: ${m.good} Good · ${m.needsImprovement} Needs · ${m.poor} Poor (razem ${m.count} próbek).`,
    fixes: play.fixes,
  };
}

function pathFindings(paths: VitalPathRow[]): Finding[] {
  const out: Finding[] = [];
  for (const p of paths) {
    for (const pm of p.metrics) {
      if (pm.rating !== "poor") continue; // per-path tylko poor - inaczej byłby szum
      const play = PLAYBOOK[pm.metric]?.poor;
      if (!play) continue;
      out.push({
        id: `${p.path}-${pm.metric}`,
        severity: "poor",
        scope: "path",
        metric: pm.metric,
        path: p.path,
        title: `${pm.metric} na ${p.path} = ${fmt(pm.metric, pm.p75)}`,
        detail: `Próbek dla ścieżki: ${p.total}. Próg Poor: ${fmt(pm.metric, VITAL_THRESHOLDS[pm.metric][1])}.`,
        fixes: play.fixes.slice(0, 3),
      });
    }
  }
  return out;
}

const SEVERITY_ORDER: Record<Severity, number> = { poor: 0, "needs-improvement": 1, good: 2 };

const SEVERITY_STYLE: Record<Exclude<Severity, "good">, { badge: string; ring: string; icon: JSX.Element }> = {
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
  const findings = useMemo<Finding[]>(() => {
    const globals = report.metrics.map(metricFinding).filter((f): f is Finding => f !== null);
    const perPath = pathFindings(report.paths ?? []);
    return [...globals, ...perPath].sort(
      (a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity],
    );
  }, [report]);

  if (findings.length === 0) {
    return (
      <Card className="p-4 border-emerald-500/30 bg-emerald-500/5">
        <div className="flex items-start gap-3">
          <CheckCircle2 className="w-5 h-5 text-emerald-500 shrink-0 mt-0.5" />
          <div>
            <div className="text-sm font-semibold">Wszystkie metryki w normie</div>
            <p className="text-xs text-muted-foreground mt-1">
              Web Vitals w wybranym oknie są w strefie Good. Utrzymaj obecną budżetyzację obrazów,
              lazy-loading widgetów i cache CDN.
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
          <h3 className="text-sm font-semibold">Interpretacja i rekomendacje</h3>
        </div>
        <div className="flex items-center gap-2">
          {poor > 0 ? (
            <Badge variant="outline" className={SEVERITY_STYLE.poor.badge}>
              {poor} krytycznych
            </Badge>
          ) : null}
          {ni > 0 ? (
            <Badge variant="outline" className={SEVERITY_STYLE["needs-improvement"].badge}>
              {ni} do poprawy
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
                      {f.scope === "path" ? "ścieżka" : "globalne"}
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
          Pokazano 12 z {findings.length} znalezisk. Napraw najpierw krytyczne - reszta zwykle
          idzie za nimi.
        </p>
      ) : null}
    </Card>
  );
}
