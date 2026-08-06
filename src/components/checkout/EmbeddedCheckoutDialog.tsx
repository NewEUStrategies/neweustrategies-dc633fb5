// Wspólny modal osadzonego checkoutu Stripe. Używany wszędzie tam, gdzie
// wcześniej otwierała się nakładka Paddle.js (paywall, bilety, darowizny, test
// w panelu admina): dostajemy `clientSecret` z funkcji serwerowej i renderujemy
// formularz w miejscu, bez przekierowania na zewnętrzną domenę.
//
// Sam modal jest LEKKI z założenia: ramka operatora (i całe `@stripe/*`)
// siedzi za `EmbeddedCheckoutFrame`, czyli za granicą `React.lazy`. Dzięki temu
// `Paywall` (statycznie importowany przez publiczny resolver `routes/$.tsx`)
// nie wciąga SDK płatności do chunku entry - patrz nagłówek
// `EmbeddedCheckoutFrame` i bramka `scripts/check-entry-purity.ts`.
//
// Język ramki ustawiamy przy TWORZENIU sesji (`locale`, patrz
// `checkoutLocale.ts`); motyw obsługuje ramka (`colorScheme`).
import { useTranslation } from "react-i18next";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PaymentTestModeBanner } from "@/components/PaymentTestModeBanner";
import { EmbeddedCheckoutFrame } from "@/components/checkout/EmbeddedCheckoutFrame";
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
        {clientSecret && <EmbeddedCheckoutFrame clientSecret={clientSecret} className="mt-3" />}
      </DialogContent>
    </Dialog>
  );
}
