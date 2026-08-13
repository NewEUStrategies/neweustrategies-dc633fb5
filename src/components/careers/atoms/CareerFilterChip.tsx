// Atom: chip filtra działu na stronie kariery. Czysta prezentacja + rola
// przycisku w grupie `tablist`-podobnej (aria-pressed), bez własnego stanu.
import { cn } from "@/lib/utils";

export function CareerFilterChip({
  label,
  count,
  active,
  onClick,
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "group inline-flex shrink-0 items-center gap-2 rounded-[6px] border px-3 py-2",
        "text-sm font-medium transition-[color,background-color,border-color,transform] duration-200",
        active
          ? "border-primary/60 bg-primary/10 text-foreground"
          : "border-border/70 bg-card/60 text-muted-foreground hover:-translate-y-0.5 hover:border-primary/40 hover:text-foreground",
      )}
    >
      <span className="truncate">{label}</span>
      <span
        className={cn(
          "inline-flex min-w-[1.5rem] justify-center rounded-[6px] px-1.5 py-0.5 text-[11px] font-semibold tabular-nums",
          active ? "bg-primary/20 text-primary" : "bg-muted text-muted-foreground",
        )}
      >
        {count}
      </span>
    </button>
  );
}
