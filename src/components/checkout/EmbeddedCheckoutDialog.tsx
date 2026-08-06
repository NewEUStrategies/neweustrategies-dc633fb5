// Wspólny modal osadzonego checkoutu. Używany wszędzie tam, gdzie kupujemy bez
// opuszczania strony: paywall wpisu, bilety na wydarzenia, darowizny oraz test
// kasy w panelu admina. Dostajemy `clientSecret` z funkcji serwerowej i
// renderujemy formularz w miejscu, bez przekierowania na obcą domenę.
//
// PODZIAŁ KODU: ten plik jest LEKKI i wolno go importować statycznie. Całe SDK
// operatora płatności siedzi za `React.lazy` w `EmbeddedCheckoutFrame` - modal
// (ramka Radixa, nagłówek, baner trybu testowego) pojawia się natychmiast po
// kliknięciu, a formularz wskakuje w miejsce szkieletu. Powód i pomiar: patrz
// nagłówek `EmbeddedCheckoutFrame.tsx`.
//
// Język i motyw: ramka operatora nie dziedziczy naszych tokenów ani i18n -
//   * język ustawiamy przy TWORZENIU sesji (`locale`, patrz `checkoutLocale.ts`),
//   * schemat kolorów niesie `EmbeddedCheckoutFrame`.
import { useTranslation } from "react-i18next";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PaymentTestModeBanner } from "@/components/PaymentTestModeBanner";
import { EmbeddedCheckoutFrame } from "./EmbeddedCheckoutFrame";
import "@/lib/i18n-payments-banner";

export interface EmbeddedCheckoutDialogProps {
  /** `clientSecret` sesji kasy; `null` zamyka modal. */
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
        <div className="mt-3">
          <EmbeddedCheckoutFrame clientSecret={clientSecret} />
        </div>
      </DialogContent>
    </Dialog>
  );
}
