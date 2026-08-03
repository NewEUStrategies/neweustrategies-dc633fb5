// Atom: kafel KPI nagłówka macierzy - ten sam kształt co kafle /admin/membership
// i /admin/paywall, żeby panel wyglądał jak jeden produkt, a nie zbiór stron.
import type { ComponentType } from "react";
import { cn } from "@/lib/utils";

export interface MatrixKpiTileProps {
  icon: ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
  label: string;
  value: string;
  /** Podświetlenie ostrzegawcze (np. bramki bez wiązania z tenantem). */
  tone?: "default" | "warning";
  title?: string;
}

export function MatrixKpiTile({
  icon: Icon,
  label,
  value,
  tone = "default",
  title,
}: MatrixKpiTileProps) {
  return (
    <div
      title={title}
      className={cn(
        "flex items-center gap-3 rounded-md border bg-card px-3 py-2.5",
        tone === "warning" ? "border-amber-300/70 dark:border-amber-900" : "border-border/60",
      )}
    >
      <div
        className={cn(
          "flex h-8 w-8 shrink-0 items-center justify-center rounded-[6px]",
          tone === "warning"
            ? "bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300"
            : "bg-muted/60 text-muted-foreground",
        )}
      >
        <Icon className="h-4 w-4" aria-hidden />
      </div>
      <div className="min-w-0">
        <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
        <div className="truncate text-sm font-semibold">{value}</div>
      </div>
    </div>
  );
}
