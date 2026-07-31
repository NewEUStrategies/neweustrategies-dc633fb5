// Atom: jedna liczba głębokości kolejki z etykietą.
//
// Rosnąca kolejka przy żywym ticku znaczy „dren nie nadąża", zero przy pustym
// logu znaczy „nikt nic nie nadał" - to dwa różne problemy i operator musi je
// rozróżnić jednym spojrzeniem, dlatego liczba jest tu pierwszorzędna, a nie
// schowana w zdaniu.
import { cn } from "@/lib/utils";

interface QueueDepthStatProps {
  label: string;
  value: number;
  /** Podświetlenie ostrzegawcze (zaległość / martwa lista). */
  tone?: "neutral" | "warn" | "danger";
  className?: string;
}

const TONE: Record<NonNullable<QueueDepthStatProps["tone"]>, string> = {
  neutral: "border-border bg-muted/40 text-foreground",
  warn: "border-amber-500/40 bg-amber-500/5 text-amber-700 dark:text-amber-400",
  danger: "border-destructive/40 bg-destructive/5 text-destructive",
};

export function QueueDepthStat({ label, value, tone = "neutral", className }: QueueDepthStatProps) {
  return (
    <div className={cn("min-w-0 rounded-lg border px-3 py-2", TONE[tone], className)}>
      <div className="text-[11px] uppercase tracking-wider opacity-70 truncate">{label}</div>
      <div className="font-display text-xl leading-tight tabular-nums">{value}</div>
    </div>
  );
}
