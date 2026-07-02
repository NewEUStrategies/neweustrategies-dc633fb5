// Atom: pixel-width meter for SERP title/description fields. Communicates the
// Google truncation budget (not a character count) with Yoast-style grading.
import { useTranslation } from "react-i18next";
import type { SerpMetric } from "@/lib/seo/serp";

const GRADE_BAR: Record<SerpMetric["grade"], string> = {
  empty: "bg-muted-foreground/30",
  short: "bg-amber-500",
  good: "bg-emerald-500",
  long: "bg-destructive",
};

export function SerpMeter({ metric }: { metric: SerpMetric }) {
  const { t } = useTranslation();
  const pct = Math.min(100, Math.round(metric.ratio * 100));
  const label =
    metric.grade === "empty"
      ? t("admin.seo.meter.empty", { defaultValue: "Użyty zostanie tekst domyślny" })
      : metric.grade === "short"
        ? t("admin.seo.meter.short", { defaultValue: "Za krótki" })
        : metric.grade === "long"
          ? t("admin.seo.meter.long", { defaultValue: "Zostanie ucięty w Google" })
          : t("admin.seo.meter.good", { defaultValue: "Dobra długość" });
  return (
    <div className="mt-1.5 space-y-1">
      <div className="h-1 rounded-full bg-muted overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-300 ${GRADE_BAR[metric.grade]}`}
          style={{ width: `${metric.grade === "empty" ? 0 : Math.max(pct, 4)}%` }}
        />
      </div>
      <div className="flex justify-between text-[10px] text-muted-foreground">
        <span>{label}</span>
        <span>
          {metric.px}px / {metric.limitPx}px
        </span>
      </div>
    </div>
  );
}
