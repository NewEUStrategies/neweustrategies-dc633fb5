// Ramka osadzonej kasy operatora płatności - ZAWARTOŚĆ LENIWEGO CHUNKU.
//
// To jedyny komponent aplikacji, który importuje `@stripe/react-stripe-js`
// i loader SDK (`@/lib/stripe/sdk`). Nikt nie importuje go statycznie: wchodzi
// wyłącznie przez `React.lazy` z `EmbeddedCheckoutFrame.tsx`, więc kod ramki
// i adres `js.stripe.com` schodzą dopiero do czytelnika, który REALNIE otwiera
// kasę. Inwariant pilnuje `src/lib/ci/paymentSdkGraph.ts`.
//
// Motyw: ramka jest cudzym <iframe> i nie dziedziczy naszych tokenów. Schemat
// kolorów sygnalizujemy przez `color-scheme` na kontenerze i wymuszamy
// przemontowanie providera kluczem `clientSecret + colorScheme`, bo operator
// czyta schemat tylko przy inicjalizacji ramki. Bez tego przełączenie na tryb
// ciemny zostawiało biały formularz na ciemnym tle.
//
// i18n: zero treści własnych - język ramki ustawiamy przy TWORZENIU sesji
// (`locale`, patrz `lib/billing/checkoutLocale.ts`).
import { EmbeddedCheckoutProvider, EmbeddedCheckout } from "@stripe/react-stripe-js";
import { getStripe } from "@/lib/stripe/sdk";

export interface StripeEmbeddedFrameProps {
  /** `clientSecret` sesji kasy - zawsze niepusty (host montuje warunkowo). */
  clientSecret: string;
  colorScheme: "light" | "dark";
}

export function StripeEmbeddedFrame({ clientSecret, colorScheme }: StripeEmbeddedFrameProps) {
  return (
    <div style={{ colorScheme }}>
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

export default StripeEmbeddedFrame;
