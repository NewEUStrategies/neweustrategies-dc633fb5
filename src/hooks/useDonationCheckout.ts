// Jedno wejście klienta do darowizny: KAŻDY przycisk i formularz (strona
// /support, CTA widgetu, formularz kwot) uruchamia checkout tą drogą, więc
// kwota, waluta i tenant zawsze przechodzą przez serwerową walidację
// `createDonationCheckout`, a klient dostaje wyłącznie identyfikator
// transakcji do nakładki operatora.
import { useCallback, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { createDonationCheckout } from "@/lib/billing/donations.functions";
import { usePaddleCheckout } from "@/hooks/usePaddleCheckout";
import { getPaddleEnvironment } from "@/lib/paddle";
import {
  DONATION_MAX_CENTS,
  DONATION_MIN_CENTS,
  type DonationCurrency,
} from "@/lib/billing/donations.schema";

export interface StartDonationArgs {
  amountCents: number;
  currency: DonationCurrency;
  message?: string;
  lang: "pl" | "en";
  successPath?: string;
}

const COPY = {
  pl: {
    amount: "Podaj kwotę w dozwolonym zakresie.",
    rate: "Zbyt wiele prób - spróbuj za chwilę.",
    fail: "Nie udało się rozpocząć płatności.",
  },
  en: {
    amount: "Enter an amount within the allowed range.",
    rate: "Too many attempts - try again shortly.",
    fail: "Checkout failed.",
  },
} as const;

export function useDonationCheckout() {
  const donate = useServerFn(createDonationCheckout);
  const { openCheckout } = usePaddleCheckout();
  const [pending, setPending] = useState(false);

  const start = useCallback(
    async ({ amountCents, currency, message, lang, successPath }: StartDonationArgs) => {
      const c = COPY[lang];
      if (
        !Number.isFinite(amountCents) ||
        amountCents < DONATION_MIN_CENTS ||
        amountCents > DONATION_MAX_CENTS
      ) {
        toast.error(c.amount);
        return false;
      }
      setPending(true);
      try {
        const result = await donate({
          data: {
            amount_cents: amountCents,
            currency,
            message: message?.trim() || undefined,
            lang,
            environment: getPaddleEnvironment(),
          },
        });
        if (!result.ok) {
          toast.error(c.fail);
          return false;
        }
        if (result.mode === "paddle") {
          await openCheckout({
            transactionId: result.transactionId,
            successPath: successPath ?? "/support?status=success",
          });
          return true;
        }
        window.location.assign(result.url);
        return true;
      } catch (err) {
        const msg = err instanceof Error ? err.message : "";
        toast.error(msg.includes("rate_limited") ? c.rate : c.fail);
        return false;
      } finally {
        setPending(false);
      }
    },
    [donate, openCheckout],
  );

  return { start, pending };
}
