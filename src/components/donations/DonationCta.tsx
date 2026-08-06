// Akcja darowizny w widgecie CMS (atom).
//
// Dokąd prowadzi przycisk, decyduje WYŁĄCZNIE konfiguracja modułu
// (`site_settings.donations` -> `resolveDonationTarget`), nie prop widgetu:
// dopóki adres zbiórki był wpisany w kodzie, przełączenie serwisu na własną
// kasę zostawiało w treściach przyciski wyprowadzające darczyńcę na zewnątrz.
//
// Tryby (nazwy historyczne, zachowane dla zapisanych stron):
//   * `link`        - nawigacja wewnętrzna pod `href` (domyślnie /support),
//   * `quick`/`form`- bezpośrednio do wpłaty: nasz `/donate` albo zbiórka
//                     zewnętrzna w nowej karcie, zależnie od konfiguracji.
// Gdy moduł jest wyłączony, tryb wpłaty degraduje się do nawigacji pod `href` -
// przycisk nigdy nie prowadzi w martwy punkt.
import type { CSSProperties, ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { ExternalLink } from "lucide-react";
import { AppLink } from "@/components/atoms/AppLink";
import { useDonationTarget } from "@/lib/billing/donationsConfigQuery";
import "@/lib/i18n-donate";

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
  const { t } = useTranslation();
  const target = useDonationTarget();
  const resolvedMode: DonationCtaMode = mode ?? (quick ? "quick" : "link");
  const wantsDirectGift = resolvedMode !== "link";

  if (wantsDirectGift && target.kind === "external") {
    return (
      <a
        href={target.href}
        target="_blank"
        rel="noopener noreferrer"
        className={className}
        style={style}
      >
        {icon}
        {label}
        <ExternalLink className="h-3.5 w-3.5 opacity-80" aria-hidden="true" />
        <span className="sr-only"> ({t("donate.newTab")})</span>
      </a>
    );
  }

  const internalHref = wantsDirectGift && target.kind === "internal" ? target.href : href;
  return (
    <AppLink href={internalHref} className={className} style={style}>
      {icon}
      {label}
    </AppLink>
  );
}
