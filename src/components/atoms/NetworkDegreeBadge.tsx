// Atom: odznaka STOPNIA sieci kontaktów (1., 2., 3.+).
//
// Stopień był liczony w bazie od 20260717170000 (CTE `mutual` w
// connection_statuses i connection_suggestions), ale wychodził na zewnątrz
// wyłącznie jako `mutual_count`, więc interfejs pokazywał "3 wspólne kontakty"
// i ani słowa o tym, jak blisko jest ta osoba. Od 20260807143000 baza zwraca
// jawną kolumnę `degree`, a ten atom jest JEDYNYM miejscem, które zamienia ją
// w tekst - dzięki temu odznaka wygląda tak samo w katalogu, na karcie
// sugestii i w nagłówku profilu.
//
// Skala i kolor niosą znaczenie: 1. stopień to token brandu (relacja istnieje),
// 2. to neutralny akcent (jest przez kogo), 3.+ jest wyciszony (obcy).
// Normalizacja stopnia i klucze i18n mieszkają w `@/lib/network/degree` -
// komponent tylko renderuje.
import { cn } from "@/lib/utils";
import type { NetworkDegree } from "@/lib/network/degree";

interface NetworkDegreeBadgeProps {
  degree: NetworkDegree;
  /** Krótka etykieta odznaki, np. "2." (z i18n `network.degree.short.*`). */
  label: string;
  /** Pełny opis dla technologii asystujących, np. "Drugi stopień - macie wspólne kontakty". */
  ariaLabel: string;
  className?: string;
}

const TONE: Record<NetworkDegree, string> = {
  0: "border-border/60 bg-muted/30 text-muted-foreground/80",
  1: "border-[var(--brand)]/40 bg-[var(--brand)]/10 text-[var(--brand)]",
  2: "border-border bg-muted/60 text-foreground/80",
  3: "border-border/60 bg-muted/30 text-muted-foreground/80",
};

export function NetworkDegreeBadge({
  degree,
  label,
  ariaLabel,
  className,
}: NetworkDegreeBadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center rounded-[4px] border px-1 text-[10px] font-semibold leading-4 tabular-nums",
        TONE[degree],
        className,
      )}
      title={ariaLabel}
      aria-label={ariaLabel}
      data-degree={degree}
    >
      {label}
    </span>
  );
}
