// ATOM: odznaka stopnia oddalenia („1°" / „2°" / „3°").
//
// Czysta prezentacja - żadnego RPC, żadnego react-query: stopień przychodzi
// z warstwy danych (connection_statuses / connection_suggestions), więc atom
// montuje się tak samo w karcie katalogu osób, w sugestii i na profilu.
//
// Dostępność: cyfra ze stopniem jest skrótem WIZUALNYM (aria-hidden), a obok
// jedzie pełne zdanie dla czytnika ekranu („Kontakt 2. stopnia - macie wspólny
// kontakt"). `title` daje ten sam opis myszy, bez tooltipa i bez JS.
import { cn } from "@/lib/utils";
import { DEGREE_I18N_SUFFIX, isDegreeVisible, type ConnectionDegree } from "@/lib/network/degree";
import { useNetworkDegreeLabels } from "../useDegreeLabels";

export interface DegreeBadgeProps {
  degree: ConnectionDegree;
  /** `xs` na gęste karty list, `sm` na paski akcji profilu. */
  size?: "xs" | "sm";
  className?: string;
}

const SIZES: Record<NonNullable<DegreeBadgeProps["size"]>, string> = {
  xs: "h-4 min-w-4 px-1 text-[10px]",
  sm: "h-5 min-w-5 px-1.5 text-[11px]",
};

// 1° = własna sieć (brand), 2° = zasięg przez most (miękki brand),
// 3° = obrzeże sieci (neutralny kontur). Gradacja nasycenia niesie tę samą
// informację co cyfra, więc karta czyta się jednym spojrzeniem.
const TONES: Record<1 | 2 | 3, string> = {
  1: "border-transparent bg-[var(--brand)] text-[var(--brand-foreground,white)]",
  2: "border-[var(--brand)]/30 bg-[var(--brand)]/10 text-[var(--brand)]",
  3: "border-border bg-muted/60 text-muted-foreground",
};

export function DegreeBadge({ degree, size = "xs", className }: DegreeBadgeProps) {
  const labels = useNetworkDegreeLabels();
  if (!isDegreeVisible(degree)) return null;
  const suffix = DEGREE_I18N_SUFFIX[degree];
  return (
    <span
      data-degree={degree}
      title={labels.description(suffix)}
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-[4px] border font-semibold leading-none tabular-nums",
        SIZES[size],
        TONES[degree],
        className,
      )}
    >
      <span aria-hidden="true">{labels.short(suffix)}</span>
      <span className="sr-only">{labels.description(suffix)}</span>
    </span>
  );
}
