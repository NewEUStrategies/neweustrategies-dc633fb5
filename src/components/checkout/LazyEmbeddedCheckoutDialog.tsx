// Leniwa granica modala osadzonego checkoutu (korekta 1 z audytu 2026-08-06).
//
// `EmbeddedCheckoutDialog` ciągnie `@stripe/react-stripe-js`, a montowany jest
// w czterech miejscach, z których TRZY renderują się każdemu czytelnikowi
// (paywall wpisu, formularz darowizny, przycisk biletu). Statyczny import
// wsadzał SDK operatora do wspólnego chunku - płacił za to każdy, kto nigdy
// nie otworzy kasy.
//
// Kontrakt jest identyczny jak modala (drop-in), więc miejsca montowania
// zmieniają wyłącznie import:
//   * dopóki `clientSecret === null` i kasa nie była jeszcze otwarta,
//     komponent NIE renderuje nic i NIE pobiera chunku,
//   * po pierwszym otwarciu zostaje zamontowany, żeby Radix dograł animację
//     zamknięcia (powrót do `null` nie ucina modala w pół ruchu),
//   * `prefetchEmbeddedCheckoutDialog()` (z `checkoutDialogChunk`) pozwala
//     rozgrzać chunk równolegle z tworzeniem sesji.
import { Suspense, lazy, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Loader2 } from "lucide-react";
import {
  loadCheckoutDialog,
  type EmbeddedCheckoutDialogProps,
} from "@/components/checkout/checkoutDialogChunk";
import "@/lib/i18n-payments-banner";

const EmbeddedCheckoutDialogLazy = lazy(loadCheckoutDialog);

/** Zastępnik na czas dociągania chunku - widoczny tylko przy wolnym łączu. */
function CheckoutDialogFallback() {
  const { t } = useTranslation();
  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed inset-0 z-50 grid place-items-center bg-background/80 backdrop-blur-sm"
    >
      <span className="flex items-center gap-2 rounded-md border bg-card px-4 py-3 text-sm shadow-lg">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
        {t("paymentsBanner.loading")}
      </span>
    </div>
  );
}

export function LazyEmbeddedCheckoutDialog(props: EmbeddedCheckoutDialogProps) {
  const open = props.clientSecret !== null;
  const [everOpened, setEverOpened] = useState(open);

  useEffect(() => {
    if (open) setEverOpened(true);
  }, [open]);

  if (!everOpened) return null;

  return (
    <Suspense fallback={open ? <CheckoutDialogFallback /> : null}>
      <EmbeddedCheckoutDialogLazy {...props} />
    </Suspense>
  );
}
