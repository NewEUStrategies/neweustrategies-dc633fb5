// CTA darowizny: albo klasyczny link na /support, albo szybka płatność
// otwierana od razu w nakładce operatora (Paddle) przez `createDonationCheckout`.
// Ta sama ścieżka serwerowa co strona /support - kwota, waluta i tenant są
// walidowane po stronie serwera, klient dostaje wyłącznie transactionId.
import { useState, type CSSProperties, type ReactNode } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { AppLink } from "@/components/atoms/AppLink";
import { createDonationCheckout } from "@/lib/billing/donations.functions";
import { usePaddleCheckout } from "@/hooks/usePaddleCheckout";
import { getPaddleEnvironment } from "@/lib/paddle";
import {
  DONATION_MAX_CENTS,
  DONATION_MIN_CENTS,
  type DonationCurrency,
} from "@/lib/billing/donations.schema";

export interface DonationCtaProps {
  href: string;
  label: string;
  className: string;
  style?: CSSProperties;
  icon?: ReactNode;
  /** Szybka płatność w nakładce zamiast przejścia na /support. */
  quick?: boolean;
  quickAmountCents?: number;
  currency?: string;
  lang: "pl" | "en";
}

function normalizeCurrency(raw: string | undefined, lang: "pl" | "en"): DonationCurrency {
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
  quick = false,
  quickAmountCents,
  currency,
  lang,
}: DonationCtaProps) {
  const donate = useServerFn(createDonationCheckout);
  const { openCheckout } = usePaddleCheckout();
  const [pending, setPending] = useState(false);

  if (!quick) {
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

  const run = async () => {
    setPending(true);
    try {
      const result = await donate({
        data: {
          amount_cents: cents,
          currency: normalizeCurrency(currency, lang),
          lang,
          environment: getPaddleEnvironment(),
        },
      });
      if (!result.ok) {
        toast.error(lang === "pl" ? "Nie udało się rozpocząć płatności." : "Checkout failed.");
        return;
      }
      if (result.mode === "paddle") {
        await openCheckout({
          transactionId: result.transactionId,
          successPath: "/support?status=success",
        });
        return;
      }
      window.location.assign(result.url);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "";
      toast.error(
        msg.includes("rate_limited")
          ? lang === "pl"
            ? "Zbyt wiele prób - spróbuj za chwilę."
            : "Too many attempts - try again shortly."
          : lang === "pl"
            ? "Nie udało się rozpocząć płatności."
            : "Checkout failed.",
      );
    } finally {
      setPending(false);
    }
  };

  return (
    <button
      type="button"
      onClick={() => void run()}
      disabled={pending}
      className={`${className} disabled:opacity-60`}
      style={style}
    >
      {icon}
      {label}
    </button>
  );
}
