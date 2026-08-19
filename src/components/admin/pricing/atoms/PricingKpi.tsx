// Atom: kafel licznikowy nad zakładką warstw (ile segmentów, ile warstw...).
//
// Kontrakt dostępności: ikona jest dekoracją (`aria-hidden`), więc liczba musi
// dać się odczytać z SAMEJ pary etykieta-wartość. Dlatego kafel to `<dl>` -
// czytnik ogłasza „Segmenty: 4", a nie dwie luźne liczby obok siebie.
import type { LucideIcon } from "lucide-react";

export type KpiTone = "primary" | "sky" | "amber" | "emerald";

const KPI_TONES: Record<KpiTone, { icon: string; ring: string }> = {
  primary: { icon: "bg-primary/10 text-primary", ring: "ring-primary/20" },
  sky: { icon: "bg-sky-500/10 text-sky-600 dark:text-sky-400", ring: "ring-sky-500/20" },
  amber: { icon: "bg-amber-500/10 text-amber-600 dark:text-amber-400", ring: "ring-amber-500/20" },
  emerald: {
    icon: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
    ring: "ring-emerald-500/20",
  },
};

export function PricingKpi({
  icon: Icon,
  label,
  value,
  tone,
}: {
  icon: LucideIcon;
  label: string;
  value: number | string;
  tone: KpiTone;
}) {
  const t = KPI_TONES[tone];
  return (
    <dl
      className={`flex items-center gap-3 rounded-md border border-border/60 bg-card px-3 py-2.5 ring-1 ${t.ring}`}
    >
      <span
        className={`flex h-9 w-9 items-center justify-center rounded-md ${t.icon}`}
        aria-hidden="true"
      >
        <Icon className="h-[18px] w-[18px]" />
      </span>
      <div className="min-w-0">
        <dt className="truncate text-[11px] uppercase tracking-wide text-muted-foreground">
          {label}
        </dt>
        <dd className="text-lg font-semibold leading-tight text-foreground">{value}</dd>
      </div>
    </dl>
  );
}
