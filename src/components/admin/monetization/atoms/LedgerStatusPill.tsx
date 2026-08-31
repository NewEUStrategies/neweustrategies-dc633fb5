// Atom: pigułka statusu wiersza rejestru (wpłata / przydział / link).
export type LedgerTone = "positive" | "warning" | "negative" | "neutral";

const TONE: Record<LedgerTone, string> = {
  positive: "bg-emerald-500/10 text-emerald-600 border-emerald-500/20",
  warning: "bg-amber-500/10 text-amber-600 border-amber-500/20",
  negative: "bg-destructive/10 text-destructive border-destructive/20",
  neutral: "bg-muted text-muted-foreground border-border",
};

export function LedgerStatusPill({ tone, label }: { tone: LedgerTone; label: string }) {
  return (
    <span
      data-testid="ledger-status"
      data-tone={tone}
      className={`inline-flex h-6 items-center rounded-[6px] border px-2 text-[11px] font-semibold uppercase tracking-wide ${TONE[tone]}`}
    >
      {label}
    </span>
  );
}
