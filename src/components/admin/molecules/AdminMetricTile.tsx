// Molekuła: kafelek metryki panelu (ikona + etykieta + liczba + podpowiedź).
//
// Ten sam kształt co kafelki statystyk na /admin/community/notifications, więc
// kolejny panel nie wprowadza drugiego języka wizualnego. Ton 'warn'/'danger'
// jest DODATKIEM do treści, nie jej zamiennikiem: wartość i etykieta czytają
// się identycznie bez koloru.
//
// Do 08.2026 molekuła nazywała się `SchedulerMetricTile` i miała jednego
// konsumenta, choć nic w niej nie było „harmonogramowe". Nazwa zawężająca
// blokuje ponowne użycie skuteczniej niż brak komponentu - drugi panel woli
// napisać własny kafelek, niż zaimportować cudzy. Stąd nazwa domenowo pusta.
import type { ComponentType, SVGProps } from "react";
import { cn } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/card";

export type MetricTone = "neutral" | "ok" | "warn" | "danger";

const ICON_TONE: Record<MetricTone, string> = {
  neutral: "text-muted-foreground",
  ok: "text-emerald-600 dark:text-emerald-400",
  warn: "text-amber-600 dark:text-amber-400",
  danger: "text-destructive",
};

const VALUE_TONE: Record<MetricTone, string> = {
  neutral: "",
  ok: "",
  warn: "text-amber-600 dark:text-amber-400",
  danger: "text-destructive",
};

interface AdminMetricTileProps {
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  label: string;
  /** Sformatowana wartość; `null`/`undefined` renderuje "-" (brak danych). */
  value: string | number | null | undefined;
  hint?: string;
  tone?: MetricTone;
  className?: string;
}

export function AdminMetricTile({
  icon: Icon,
  label,
  value,
  hint,
  tone = "neutral",
  className,
}: AdminMetricTileProps) {
  return (
    <Card className={className}>
      <CardContent className="p-3 space-y-1">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Icon className={cn("w-3.5 h-3.5 shrink-0", ICON_TONE[tone])} aria-hidden="true" />
          <span className="truncate" title={hint ?? label}>
            {label}
          </span>
        </div>
        <div className={cn("text-2xl font-semibold tabular-nums", VALUE_TONE[tone])}>
          {value ?? "-"}
        </div>
        {hint ? <p className="m-0 text-[11px] leading-snug text-muted-foreground">{hint}</p> : null}
      </CardContent>
    </Card>
  );
}
