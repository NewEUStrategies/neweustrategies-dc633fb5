// Granica leniwego ładowania ramki Stripe Embedded Checkout.
//
// PO CO (regresja 2026-08-06, bramka `check:bundle` czerwona na mainie):
// `routes/$.tsx` -> `Paywall` -> `EmbeddedCheckoutDialog` -> `@stripe/react-stripe-js`
// był łańcuchem STATYCZNYM, a `@/lib/stripe` (`loadStripe`) miał 17 statycznych
// importerów rozsianych po całej aplikacji. Rollup hoistuje moduł współdzielony
// przez wiele chunków tras do ich wspólnego przodka - czyli do ENTRY. Efekt:
// każdy anonimowy czytelnik dowolnego artykułu pobierał i parsował SDK operatora
// płatności (marker `js.stripe.com` w chunku entry), zanim jeszcze zobaczył
// paywall - a zdecydowana większość czytelników nigdy nie wchodzi w checkout.
//
// Ten moduł jest jedyną drogą do `StripeEmbeddedFrame` (i tym samym do
// `@stripe/react-stripe-js`), i prowadzi przez `React.lazy`, więc SDK schodzi z
// sieci dopiero przy realnej intencji zakupu. Ten sam wzorzec, co `EChart` ->
// `EChartClient`. Inwariant pilnuje blokujący krok CI `check:entry-purity`.
//
// NIE importuj `./StripeEmbeddedFrame` statycznie z żadnego innego miejsca -
// to natychmiast przywraca krawędź, dla której ta pośredniość istnieje.
import { Suspense, lazy, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangle, RotateCcw } from "@/lib/lucide-shim";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { Button } from "@/components/ui/button";
import { CheckoutFrameSkeleton } from "@/components/checkout/atoms/CheckoutFrameSkeleton";
import { useTheme } from "@/components/ThemeProvider";
import { loadStripeFrame } from "@/components/checkout/checkoutIntent";
import "@/lib/i18n-payments-banner";

const LazyStripeFrame = lazy(loadStripeFrame);

export interface EmbeddedCheckoutFrameProps {
  /** `clientSecret` sesji Stripe - zawsze pochodzi z wywołania po stronie klienta. */
  clientSecret: string;
  className?: string;
}

function FrameFallback({ message, retryLabel }: { message: string; retryLabel: string }) {
  return (
    <div
      role="alert"
      className="flex flex-col items-start gap-3 rounded-[6px] border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive"
      data-testid="checkout-frame-error"
    >
      <div className="flex items-start gap-2.5">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
        <p>{message}</p>
      </div>
      {/* Świadomie przeładowanie, nie ponowny `import()`: przeglądarka trzyma
          nieudany moduł w module map jako błąd, więc powtórny import tego samego
          URL-a odrzuca się natychmiast, bez sięgnięcia do sieci. */}
      <Button
        type="button"
        size="sm"
        variant="outline"
        onClick={() => window.location.reload()}
        className="border-destructive/40"
      >
        <RotateCcw className="mr-2 h-3.5 w-3.5" aria-hidden="true" />
        {retryLabel}
      </Button>
    </div>
  );
}

export function EmbeddedCheckoutFrame({ clientSecret, className }: EmbeddedCheckoutFrameProps) {
  const { t } = useTranslation();
  const { theme } = useTheme();
  // Ramka jest wyłącznie kliencka (`clientSecret` powstaje w przeglądarce), ale
  // strażnik montowania trzyma `React.lazy` poza renderem SSR bezwarunkowo -
  // ten sam kontrakt, co w `EChart`.
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);

  const skeleton = <CheckoutFrameSkeleton className={className} />;
  if (!mounted) return skeleton;

  return (
    <ErrorBoundary
      name="checkout_embedded_frame"
      fallback={() => (
        <FrameFallback
          message={t("paymentsBanner.frameFailed")}
          retryLabel={t("paymentsBanner.frameRetry")}
        />
      )}
    >
      <Suspense fallback={skeleton}>
        <LazyStripeFrame clientSecret={clientSecret} colorScheme={theme} className={className} />
      </Suspense>
    </ErrorBoundary>
  );
}
