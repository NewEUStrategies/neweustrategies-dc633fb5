// Akcja darowizny w widgecie CMS. Wpłaty obsługuje zewnętrzna zbiórka
// (zrzutka.pl) - serwis nie tworzy transakcji darowizn u operatora płatności
// (wymóg AUP Paddle: darowizny są poza wspieranymi kategoriami). Historyczne
// tryby konfiguracyjne widgetu degradują bezpiecznie:
//   * link         - nawigacja wewnętrzna (domyślnie /support),
//   * quick / form - bezpośredni link do zbiórki w nowej karcie.
import type { CSSProperties, ReactNode } from "react";
import { AppLink } from "@/components/atoms/AppLink";
import { ExternalLink } from "@/lib/lucide-shim";
import { EXTERNAL_DONATIONS_URL } from "@/lib/billing/donationsExternal";

export type DonationCtaMode = "link" | "quick" | "form";

export interface DonationCtaProps {
  href: string;
  label: string;
  className: string;
  style?: CSSProperties;
  icon?: ReactNode;
  /** Tryb działania - domyślnie link na /support. */
  mode?: DonationCtaMode;
  /** Zgodność wstecz: `quick` = dawny tryb szybkiej płatności. */
  quick?: boolean;
}

export function DonationCta({
  href,
  label,
  className,
  style,
  icon,
  mode,
  quick = false,
}: DonationCtaProps) {
  const resolvedMode: DonationCtaMode = mode ?? (quick ? "quick" : "link");

  if (resolvedMode === "link") {
    return (
      <AppLink href={href} className={className} style={style}>
        {icon}
        {label}
      </AppLink>
    );
  }

  return (
    <a
      href={EXTERNAL_DONATIONS_URL}
      target="_blank"
      rel="noopener noreferrer"
      className={className}
      style={style}
    >
      {icon}
      {label}
      <ExternalLink className="h-3.5 w-3.5 opacity-80" aria-hidden="true" />
    </a>
  );
}
