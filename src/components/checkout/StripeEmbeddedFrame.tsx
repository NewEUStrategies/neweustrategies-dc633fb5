// JEDYNY moduł aplikacji, który statycznie importuje `@stripe/react-stripe-js`.
//
// Dostają się tu wyłącznie przez `React.lazy` w `EmbeddedCheckoutFrame` - nigdy
// bezpośrednio. Dopisanie drugiego statycznego importera bindingów Stripe
// przywraca dokładnie tę regresję, przez którą loader operatora płatności
// wylądował w chunku ENTRY (anonimowy czytelnik artykułu pobierał SDK bramki
// płatniczej); pilnuje tego blokujący krok CI `scripts/check-entry-purity.ts`.
//
// Motyw: ramka Stripe nie dziedziczy naszych tokenów CSS. Schemat kolorów
// sygnalizujemy przez `color-scheme` na kontenerze i wymuszamy przemontowanie
// providera (klucz `clientSecret + colorScheme`), bo Stripe czyta schemat tylko
// przy inicjalizacji ramki - bez tego przełączenie na tryb ciemny zostawiało
// biały formularz na ciemnym tle.
//
// Język ustawiamy przy TWORZENIU sesji (`locale`, patrz `checkoutLocale.ts`),
// nie tutaj - ramka nie ma runtime'owego przełącznika języka.
import { EmbeddedCheckout, EmbeddedCheckoutProvider } from "@stripe/react-stripe-js";
import { getStripe } from "@/lib/stripe";

export interface StripeEmbeddedFrameProps {
  /** `clientSecret` sesji Stripe - zawsze niepusty (mount jest warunkowy). */
  clientSecret: string;
  /** Schemat kolorów przekazany ramce operatora. */
  colorScheme: "light" | "dark";
  className?: string;
}

export default function StripeEmbeddedFrame({
  clientSecret,
  colorScheme,
  className,
}: StripeEmbeddedFrameProps) {
  return (
    <div className={className} style={{ colorScheme }} data-testid="stripe-embedded-frame">
      <EmbeddedCheckoutProvider
        key={`${clientSecret}:${colorScheme}`}
        stripe={getStripe()}
        options={{ clientSecret }}
      >
        <EmbeddedCheckout />
      </EmbeddedCheckoutProvider>
    </div>
  );
}
