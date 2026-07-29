import { useCallback, useState } from "react";
import { initializePaddle, getPaddlePriceId } from "@/lib/paddle";

export interface OpenCheckoutOptions {
  /** Czytelny identyfikator ceny z katalogu (np. `pro_monthly`). */
  priceId: string;
  quantity?: number;
  customerEmail?: string;
  userId: string;
  successPath?: string;
}

/** Otwiera nakładkę płatności i wiąże zakup z zalogowanym użytkownikiem. */
export function usePaddleCheckout() {
  const [loading, setLoading] = useState(false);

  const openCheckout = useCallback(async (options: OpenCheckoutOptions) => {
    setLoading(true);
    try {
      await initializePaddle();
      const paddlePriceId = await getPaddlePriceId(options.priceId);
      window.Paddle?.Checkout.open({
        items: [{ priceId: paddlePriceId, quantity: options.quantity ?? 1 }],
        ...(options.customerEmail ? { customer: { email: options.customerEmail } } : {}),
        customData: { userId: options.userId },
        settings: {
          displayMode: "overlay",
          variant: "one-page",
          allowLogout: false,
          successUrl: `${window.location.origin}${options.successPath ?? "/checkout/success"}`,
        },
      });
    } finally {
      setLoading(false);
    }
  }, []);

  return { openCheckout, loading };
}
