// Atom: znacznik środowiska wiersza (produkcyjne / testowe / nieokreślone).
import type { MonetizationEnvironment } from "@/lib/admin/monetization/model";

const TONE: Record<MonetizationEnvironment, string> = {
  live: "bg-emerald-500/10 text-emerald-600 border-emerald-500/20",
  sandbox: "bg-amber-500/10 text-amber-600 border-amber-500/20",
  unknown: "bg-muted text-muted-foreground border-border",
};

export function EnvironmentBadge({
  environment,
  label,
}: {
  environment: MonetizationEnvironment;
  label: string;
}) {
  return (
    <span
      data-testid="environment-badge"
      data-environment={environment}
      className={`inline-flex h-6 items-center rounded-[6px] border px-2 text-[11px] font-semibold uppercase tracking-wide ${TONE[environment]}`}
    >
      {label}
    </span>
  );
}
