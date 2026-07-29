// Akcja darowizny w widgecie CMS. Trzy tryby konfigurowane w panelu edycji:
//   * link  - przejście na /support (klasyczne CTA),
//   * quick - jedna kwota, od razu w nakładce operatora,
//   * form  - warianty kwot + (opcjonalnie) własna kwota i wiadomość.
// Każdy z nich kończy się wywołaniem `createDonationCheckout` (tryb `link`
// pośrednio - formularz /support korzysta z tej samej funkcji serwerowej),
// więc kwota, waluta i tenant są zawsze walidowane po stronie serwera.
import type { CSSProperties, ReactNode } from "react";
import { AppLink } from "@/components/atoms/AppLink";
import { DonationAmountForm } from "./DonationAmountForm";
import { useDonationCheckout } from "@/hooks/useDonationCheckout";
import { defaultDonationPresets } from "@/lib/billing/donationPresets";
import {
  DONATION_MAX_CENTS,
  DONATION_MIN_CENTS,
  type DonationCurrency,
} from "@/lib/billing/donations.schema";

export type DonationCtaMode = "link" | "quick" | "form";

export interface DonationCtaProps {
  href: string;
  label: string;
  className: string;
  style?: CSSProperties;
  icon?: ReactNode;
  /** Tryb działania - domyślnie link na /support. */
  mode?: DonationCtaMode;
  /** Zgodność wstecz: `quick` = tryb szybkiej płatności jedną kwotą. */
  quick?: boolean;
  quickAmountCents?: number;
  /** Warianty kwot dla trybu `form` (grosze). */
  presetsCents?: number[];
  showCustomAmount?: boolean;
  showMessage?: boolean;
  accent?: string;
  currency?: string;
  lang: "pl" | "en";
}

export function normalizeDonationCurrency(
  raw: string | undefined,
  lang: "pl" | "en",
): DonationCurrency {
  const v = (raw || "").toUpperCase();
  if (v === "EUR") return "EUR";
  if (v === "PLN") return "PLN";
  return lang === "en" ? "EUR" : "PLN";
}

export function DonationCta({
  href,
  label,
  className,
  style,
  icon,
  mode,
  quick = false,
  quickAmountCents,
  presetsCents,
  showCustomAmount = true,
  showMessage = false,
  accent,
  currency,
  lang,
}: DonationCtaProps) {
  const resolvedMode: DonationCtaMode = mode ?? (quick ? "quick" : "link");
  const donationCurrency = normalizeDonationCurrency(currency, lang);
  const { start, pending } = useDonationCheckout();

  if (resolvedMode === "form") {
    return (
      <DonationAmountForm
        presetsCents={
          presetsCents && presetsCents.length > 0
            ? presetsCents
            : defaultDonationPresets(donationCurrency)
        }
        currency={donationCurrency}
        lang={lang}
        submitLabel={label}
        showCustomAmount={showCustomAmount}
        showMessage={showMessage}
        accent={accent}
      />
    );
  }

  if (resolvedMode === "link") {
    return (
      <AppLink href={href} className={className} style={style}>
        {icon}
        {label}
      </AppLink>
    );
  }

  const cents = Math.min(
    DONATION_MAX_CENTS,
    Math.max(DONATION_MIN_CENTS, Math.round(Number(quickAmountCents ?? 0) || 5000)),
  );

  return (
    <button
      type="button"
      onClick={() => void start({ amountCents: cents, currency: donationCurrency, lang })}
      disabled={pending}
      className={`${className} disabled:opacity-60`}
      style={style}
    >
      {icon}
      {label}
    </button>
  );
}
