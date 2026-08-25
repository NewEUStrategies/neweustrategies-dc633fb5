// Atom: wynik skanu wielkim napisem.
//
// OPERATOR PATRZY Z METRA, PRZEZ RAMIĘ, W SŁOŃCU. Dlatego wynik nie jest
// plakietką w rogu, tylko pasem na całą szerokość: zielony znaczy „wpuść",
// czerwony „nie wpuszczaj", bursztynowy „to nie jest odmowa, ale przeczytaj".
// Kolor NIE jest jedynym nośnikiem - obok stoi ikona i słowo, bo bramkę
// obsługują też osoby nierozróżniające barw.
import { AlertTriangle, CheckCircle2, RefreshCw, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";

export type ScanTone = "granted" | "denied" | "warning" | "neutral";

const TONE: Record<ScanTone, { box: string; icon: typeof CheckCircle2 }> = {
  granted: {
    box: "border-emerald-500/50 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
    icon: CheckCircle2,
  },
  denied: {
    box: "border-destructive/50 bg-destructive/10 text-destructive",
    icon: XCircle,
  },
  warning: {
    box: "border-amber-500/50 bg-amber-500/10 text-amber-700 dark:text-amber-300",
    icon: AlertTriangle,
  },
  neutral: {
    box: "border-border bg-muted/50 text-foreground",
    icon: RefreshCw,
  },
};

export function ScanOutcomeBanner({
  tone,
  title,
  hint,
}: {
  tone: ScanTone;
  title: string;
  hint?: string | null;
}) {
  const style = TONE[tone];
  const Icon = style.icon;
  return (
    <div
      role="status"
      aria-live="assertive"
      className={cn("rounded-[6px] border px-4 py-4 sm:px-5 sm:py-5", style.box)}
    >
      <p className="flex items-center gap-3 text-xl font-bold leading-tight sm:text-2xl">
        <Icon className="h-7 w-7 shrink-0 sm:h-8 sm:w-8" aria-hidden="true" />
        {title}
      </p>
      {hint !== null && hint !== undefined && hint !== "" && (
        <p className="mt-2 text-sm font-medium opacity-90">{hint}</p>
      )}
    </div>
  );
}
