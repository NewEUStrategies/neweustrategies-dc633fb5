// Atom: placeholder ramki Stripe Embedded Checkout na czas pobierania chunku
// SDK (patrz `EmbeddedCheckoutFrame`).
//
// Kształt odwzorowuje realny formularz operatora (e-mail, dane karty w siatce
// 2 kolumn, przycisk płatności), więc podmiana na prawdziwą ramkę nie przesuwa
// layoutu - to jedyny moment, w którym modal płatności mógłby "skoczyć".
// Wysokość jest celowo stała i taka sama na mobile i desktopie: siatka pól
// zwija się do jednej kolumny dopiero od `sm`, dokładnie jak w ramce Stripe.
import { useTranslation } from "react-i18next";
import "@/lib/i18n-payments-banner";

export interface CheckoutFrameSkeletonProps {
  className?: string;
}

export function CheckoutFrameSkeleton({ className }: CheckoutFrameSkeletonProps) {
  const { t } = useTranslation();

  return (
    <div
      role="status"
      aria-live="polite"
      className={`w-full space-y-4 ${className ?? ""}`.trim()}
      data-testid="checkout-frame-skeleton"
    >
      <span className="sr-only">{t("paymentsBanner.frameLoading")}</span>
      <div aria-hidden="true" className="space-y-4">
        <div className="space-y-2">
          <div className="skeleton-shimmer h-3 w-24 rounded" />
          <div className="skeleton-shimmer h-10 w-full rounded-[6px]" />
        </div>
        <div className="space-y-2">
          <div className="skeleton-shimmer h-3 w-32 rounded" />
          <div className="skeleton-shimmer h-10 w-full rounded-[6px]" />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="skeleton-shimmer h-10 w-full rounded-[6px]" />
          <div className="skeleton-shimmer h-10 w-full rounded-[6px]" />
        </div>
        <div className="skeleton-shimmer h-11 w-full rounded-[6px]" />
        <div className="skeleton-shimmer mx-auto h-3 w-40 rounded" />
      </div>
    </div>
  );
}
