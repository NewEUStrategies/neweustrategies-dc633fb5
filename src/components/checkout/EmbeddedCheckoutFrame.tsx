// Granica podziału kodu dla osadzonej kasy: LEKKI host + leniwa ramka SDK.
//
// PROBLEM, KTÓRY TO ROZWIĄZUJE (audyt r2, 2026-08-06)
// `routes/$.tsx` (trasa uniwersalna - każdy publiczny wpis i strona) importuje
// statycznie `Paywall`, ten importował statycznie modal kasy, a modal
// `@stripe/react-stripe-js` + `loadStripe`. W chunku wejściowym lądowały więc
// i nazwa `EmbeddedCheckout`, i adres `js.stripe.com`: SDK operatora płatności
// jechało do KAŻDEGO anonimowego czytelnika, który nigdy nie otworzy kasy.
//
// DLACZEGO HOST ZOSTAJE EAGER
// Nie da się po prostu owinąć całego modala w `lazy()`: kliknięcie „Kup" nie
// pokazałoby wtedy niczego, dopóki nie zjedzie chunk (na 3G to sekundy pustki
// po kliknięciu). Host jest więc darmowy - `Dialog` Radixa siedzi już w
// `vendor-radix`, a nagłówek i baner trybu testowego to kilkaset bajtów - i
// renderuje się NATYCHMIAST razem ze szkieletem w kształcie formularza kasy.
// Leniwy jest wyłącznie `StripeEmbeddedFrame`, czyli sam SDK.
//
// PŁYNNOŚĆ (bez spekulacyjnego pobierania)
// `prefetchEmbeddedCheckout()` z `./stripeFrameChunk` startuje pobieranie
// chunku RÓWNOLEGLE z żądaniem tworzącym sesję płatności - wywołujemy je na
// początku każdej procedury zakupu, zanim polecimy do serwera po
// `clientSecret`. Round-trip serwera (setki ms) pokrywa pobranie chunku, więc
// szkielet w praktyce nigdy nie mruga, a czytelnik, który tylko czyta, nie
// pobiera ani bajta SDK. Świadomie NIE prefetchujemy na hover: to znów
// obciążałoby ruch, który nie kończy się zakupem.
//
// i18n: host nie ma treści własnych poza etykietą stanu ładowania (PL/EN w
// `lib/i18n-payments-banner.ts`, nakładka doładowywana przez importerów).
import { Suspense, lazy } from "react";
import { useTranslation } from "react-i18next";
import { useTheme } from "@/components/ThemeProvider";
import type { StripeEmbeddedFrameProps } from "./StripeEmbeddedFrame";
import { loadStripeEmbeddedFrame } from "./stripeFrameChunk";
import "@/lib/i18n-payments-banner";

const StripeEmbeddedFrame = lazy(() =>
  loadStripeEmbeddedFrame().then((m) => ({ default: m.StripeEmbeddedFrame })),
);

/** Szkielet w kształcie formularza kasy - zero przeskoku układu po podmianie. */
function CheckoutFrameSkeleton({ label }: { label: string }) {
  return (
    <div role="status" aria-live="polite" aria-busy="true" className="space-y-3">
      <span className="sr-only">{label}</span>
      <div aria-hidden="true" className="space-y-3">
        <div className="skeleton-shimmer h-4 w-28 rounded" />
        <div className="skeleton-shimmer h-11 w-full rounded-[6px]" />
        <div className="grid grid-cols-2 gap-3">
          <div className="skeleton-shimmer h-11 w-full rounded-[6px]" />
          <div className="skeleton-shimmer h-11 w-full rounded-[6px]" />
        </div>
        <div className="skeleton-shimmer h-4 w-36 rounded" />
        <div className="skeleton-shimmer h-11 w-full rounded-[6px]" />
        <div className="skeleton-shimmer h-11 w-full rounded-[6px]" />
        <div className="skeleton-shimmer mt-2 h-12 w-full rounded-[6px]" />
      </div>
    </div>
  );
}

export interface EmbeddedCheckoutFrameProps {
  /** `clientSecret` sesji kasy; `null` nie renderuje (i nie pobiera) niczego. */
  clientSecret: string | null;
  /**
   * Wymuszony schemat kolorów ramki. Domyślnie bierzemy motyw aplikacji -
   * przekazuj tylko tam, gdzie ramka żyje na tle o innym schemacie.
   */
  colorScheme?: StripeEmbeddedFrameProps["colorScheme"];
}

/**
 * Osadzona kasa gotowa do wstawienia w dowolny layout (modal, kolumna
 * podsumowania zamówienia). Dopóki `clientSecret` jest `null`, leniwy chunk
 * nie jest nawet żądany.
 */
export function EmbeddedCheckoutFrame({ clientSecret, colorScheme }: EmbeddedCheckoutFrameProps) {
  const { t } = useTranslation();
  const { theme } = useTheme();
  if (!clientSecret) return null;
  return (
    <Suspense fallback={<CheckoutFrameSkeleton label={t("paymentsBanner.loadingCheckout")} />}>
      <StripeEmbeddedFrame clientSecret={clientSecret} colorScheme={colorScheme ?? theme} />
    </Suspense>
  );
}
