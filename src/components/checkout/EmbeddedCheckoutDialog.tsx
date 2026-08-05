// Wspólny modal osadzonego checkoutu Stripe. Używany wszędzie tam, gdzie
// wcześniej otwierała się nakładka Paddle.js (paywall, bilety, test w panelu
// admina): dostajemy `clientSecret` z funkcji serwerowej i renderujemy formularz
// w miejscu, bez przekierowania na zewnętrzną domenę.
import { EmbeddedCheckoutProvider, EmbeddedCheckout } from "@stripe/react-stripe-js";
import { useTranslation } from "react-i18next";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PaymentTestModeBanner } from "@/components/PaymentTestModeBanner";
import { getStripe } from "@/lib/stripe";
import "@/lib/i18n-payments-banner";

export interface EmbeddedCheckoutDialogProps {
  /** `clientSecret` sesji Stripe; `null` zamyka modal. */
  clientSecret: string | null;
  onOpenChange: (open: boolean) => void;
  title?: string;
}

export function EmbeddedCheckoutDialog({
  clientSecret,
  onOpenChange,
  title,
}: EmbeddedCheckoutDialogProps) {
  const { t } = useTranslation();

  return (
    <Dialog open={clientSecret !== null} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl overflow-y-auto p-4 sm:p-6" style={{ maxHeight: "90vh" }}>
        <DialogHeader>
          <DialogTitle className="text-base">{title ?? t("paymentsBanner.checkout")}</DialogTitle>
        </DialogHeader>
        <PaymentTestModeBanner />
        {clientSecret && (
          <div className="mt-3">
            <EmbeddedCheckoutProvider stripe={getStripe()} options={{ clientSecret }}>
              <EmbeddedCheckout />
            </EmbeddedCheckoutProvider>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
