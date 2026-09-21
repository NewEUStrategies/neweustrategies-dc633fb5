// Karta licznika nad listą odcinków - WYCIĄG z `routes/admin.podcasts.tsx`.
//
// Trzy tonacje (neutralna, sukces, ostrzeżenie) to jedyna logika tego
// komponentu: kolor niesie znaczenie („szkice" na żółto), więc pomyłka
// w mapowaniu tonacji kłamie o stanie redakcji.
import type { LucideIcon } from "@/lib/lucide-shim";

export type PodcastStatTone = "default" | "success" | "warning";

export function PodcastStatCard({
  icon: Icon,
  label,
  value,
  tone,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  tone: PodcastStatTone;
}) {
  const toneCls =
    tone === "success"
      ? "bg-green-500/10 text-green-700 dark:text-green-400"
      : tone === "warning"
        ? "bg-amber-500/10 text-amber-700 dark:text-amber-400"
        : "bg-primary/10 text-primary";
  return (
    <div className="bg-card border border-border rounded-lg p-4 flex items-center gap-3">
      <div className={`w-10 h-10 rounded-md flex items-center justify-center ${toneCls}`}>
        <Icon className="w-5 h-5" />
      </div>
      <div className="min-w-0">
        <div className="text-xs text-muted-foreground uppercase tracking-wider font-semibold">
          {label}
        </div>
        <div className="font-display text-xl tabular-nums leading-tight">{value}</div>
      </div>
    </div>
  );
}
