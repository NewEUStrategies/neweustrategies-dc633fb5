import { useCallback, useState } from "react";
import { initializePaddle, getPaddlePriceId } from "@/lib/paddle";

interface CommonOptions {
  customerEmail?: string;
  successPath?: string;
  /** Identyfikator rabatu u dostawcy (kod promocyjny). */
  discountId?: string | null;
  /**
   * Identyfikator klienta u operatora (`ctm_...`) dla Paddle Retain.
   * Nie przekazuj tu e-maila ani naszego identyfikatora użytkownika.
   */
  retainCustomerId?: string | null;
}


export interface PriceCheckoutOptions extends CommonOptions {
  /** Czytelny identyfikator ceny z katalogu (np. `pro_monthly`). */
  priceId: string;
  quantity?: number;
  userId: string;
}

export interface TransactionCheckoutOptions extends CommonOptions {
  /**
   * Identyfikator transakcji utworzonej serwerowo (kwota ad-hoc: darowizna,
   * odblokowanie treści, bilet). Kwota i `custom_data` są już w transakcji,
   * więc klient nie przekazuje ich ponownie.
   */
  transactionId: string;
}

export type OpenCheckoutOptions = PriceCheckoutOptions | TransactionCheckoutOptions;

function isTransactionCheckout(o: OpenCheckoutOptions): o is TransactionCheckoutOptions {
  return "transactionId" in o;
}

/** Otwiera nakładkę płatności - katalogową ceną albo gotową transakcją. */
export function usePaddleCheckout() {
  const [loading, setLoading] = useState(false);

  const openCheckout = useCallback(async (options: OpenCheckoutOptions) => {
    setLoading(true);
    try {
      await initializePaddle({ retainCustomerId: options.retainCustomerId ?? null });
      const settings = {
        displayMode: "overlay",
        variant: "one-page",
        allowLogout: false,
        successUrl: `${window.location.origin}${options.successPath ?? "/checkout/success"}`,
      };
      const shared = {
        ...(options.customerEmail ? { customer: { email: options.customerEmail } } : {}),
        ...(options.discountId ? { discountId: options.discountId } : {}),
        settings,
      };

      if (isTransactionCheckout(options)) {
        window.Paddle?.Checkout.open({ transactionId: options.transactionId, ...shared });
        return;
      }

      const paddlePriceId = await getPaddlePriceId(options.priceId);
      window.Paddle?.Checkout.open({
        items: [{ priceId: paddlePriceId, quantity: options.quantity ?? 1 }],
        customData: { userId: options.userId },
        ...shared,
      });
    } finally {
      setLoading(false);
    }
  }, []);

  return { openCheckout, loading };
}
