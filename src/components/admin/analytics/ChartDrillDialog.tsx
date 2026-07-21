/**
 * Drill-down dialog for BI charts.
 *
 * Every chart in the BI dashboards may accept an `onDataClick` handler that
 * translates an ECharts click event into a `ChartDrillDetail` payload. The
 * `ChartCard` shell owns the dialog state and renders the details here.
 *
 * The payload is intentionally UI-shaped (not domain-shaped) so a single
 * component can render clicks from a treemap, a bar, a pie or a line without
 * knowing about paths, queries, metrics etc. Every field is optional except
 * the title so partial payloads still render sensibly.
 */
import { useTranslation } from "react-i18next";
import "@/lib/i18n-admin-analytics";
import { ExternalLink, Calendar, Info } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

export type ChartDrillTone = "good" | "warn" | "bad" | "neutral";

export interface ChartDrillMetric {
  label: string;
  value: string;
  hint?: string;
  tone?: ChartDrillTone;
}

export interface ChartDrillLink {
  href: string;
  label: string;
  /** External => opens in new tab with rel=noopener. Defaults to true for absolute URLs. */
  external?: boolean;
}

export interface ChartDrillDetail {
  title: string;
  subtitle?: string;
  /** ISO date or human-readable label. Renders inside a subtle chip. */
  date?: string;
  /** Primary URL/path represented by the clicked element. Shown as monospace + link. */
  url?: string;
  urlLabel?: string;
  description?: string;
  metrics?: ChartDrillMetric[];
  links?: ChartDrillLink[];
}

/**
 * Minimal shape of the params ECharts passes to a `click` handler. Kept
 * intentionally loose so charts can safely narrow only what they need.
 */
export interface ChartClickParams {
  componentType?: string;
  seriesType?: string;
  seriesIndex?: number;
  seriesName?: string;
  name?: string;
  dataIndex?: number;
  data?: unknown;
  value?: unknown;
  dataType?: string;
}

const TONE_CLS: Record<ChartDrillTone, string> = {
  good: "text-emerald-600 dark:text-emerald-400",
  warn: "text-amber-600 dark:text-amber-400",
  bad: "text-rose-600 dark:text-rose-400",
  neutral: "text-foreground",
};

function isExternal(href: string, explicit?: boolean): boolean {
  if (typeof explicit === "boolean") return explicit;
  return /^https?:\/\//i.test(href);
}

export interface ChartDrillDialogProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  detail: ChartDrillDetail | null;
}

export function ChartDrillDialog({ open, onOpenChange, detail }: ChartDrillDialogProps) {
  const { t } = useTranslation();
  if (!detail) return null;

  const external = detail.url ? isExternal(detail.url, true) : false;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg rounded-[6px]">
        <DialogHeader>
          <DialogTitle className="font-display text-base leading-tight">
            {detail.title}
          </DialogTitle>
          {detail.subtitle ? (
            <DialogDescription className="text-xs">{detail.subtitle}</DialogDescription>
          ) : null}
        </DialogHeader>

        {(detail.date || detail.url) && (
          <div className="flex flex-wrap items-center gap-2 -mt-1">
            {detail.date ? (
              <span className="inline-flex items-center gap-1 rounded-[6px] bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                <Calendar className="h-3 w-3" aria-hidden />
                {detail.date}
              </span>
            ) : null}
            {detail.url ? (
              <a
                href={detail.url}
                target={external ? "_blank" : undefined}
                rel={external ? "noopener noreferrer" : undefined}
                className="inline-flex max-w-full items-center gap-1 truncate rounded-[6px] border border-input bg-background px-2 py-0.5 font-mono text-xs text-foreground transition-colors hover:border-brand hover:text-brand"
                title={detail.url}
              >
                <span className="truncate">{detail.urlLabel ?? detail.url}</span>
                {external ? <ExternalLink className="h-3 w-3 shrink-0" aria-hidden /> : null}
              </a>
            ) : null}
          </div>
        )}

        {detail.description ? (
          <p className="rounded-[6px] border border-border/60 bg-muted/40 p-2.5 text-xs text-muted-foreground">
            <Info className="mr-1 inline h-3 w-3 -translate-y-0.5" aria-hidden />
            {detail.description}
          </p>
        ) : null}

        {detail.metrics && detail.metrics.length > 0 ? (
          <div>
            <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              {t("adminAnalytics.drillDialog.metrics")}
            </div>
            <div className="grid grid-cols-2 gap-2">
              {detail.metrics.map((m) => (
                <div
                  key={m.label}
                  className="rounded-[6px] border border-border/60 bg-card px-2.5 py-2"
                >
                  <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                    {m.label}
                  </div>
                  <div
                    className={cn(
                      "font-display text-sm font-semibold tabular-nums",
                      TONE_CLS[m.tone ?? "neutral"],
                    )}
                  >
                    {m.value}
                  </div>
                  {m.hint ? (
                    <div className="mt-0.5 text-[10px] text-muted-foreground">{m.hint}</div>
                  ) : null}
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {detail.links && detail.links.length > 0 ? (
          <div>
            <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              {t("adminAnalytics.drillDialog.links")}
            </div>
            <ul className="space-y-1">
              {detail.links.map((l) => {
                const ext = isExternal(l.href, l.external);
                return (
                  <li key={`${l.href}-${l.label}`}>
                    <a
                      href={l.href}
                      target={ext ? "_blank" : undefined}
                      rel={ext ? "noopener noreferrer" : undefined}
                      className="inline-flex items-center gap-1 text-xs text-brand transition-colors hover:underline"
                    >
                      {l.label}
                      {ext ? <ExternalLink className="h-3 w-3" aria-hidden /> : null}
                    </a>
                  </li>
                );
              })}
            </ul>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
