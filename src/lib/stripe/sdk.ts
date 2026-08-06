// Loader przeglądarkowego SDK operatora płatności - JEDYNY moduł aplikacji,
// któremu wolno importować `@stripe/stripe-js`.
//
// Dlaczego osobny plik, a nie funkcja w `@/lib/stripe`: import jest krawędzią
// grafu, nie wywołaniem. Statyczny `import { loadStripe }` wykonuje się przy
// inicjalizacji modułu, więc trafia do tego samego chunku, co KAŻDY importer
// modułu nadrzędnego - a o środowisko płatności pyta m.in. `Paywall` na trasie
// uniwersalnej. Trzymanie loadera tutaj sprawia, że SDK schodzi wyłącznie z
// leniwym chunkiem ramki kasy (patrz `components/checkout/StripeEmbeddedFrame`).
//
// Promise jest memoizowany na poziomie modułu: `loadStripe` wstrzykuje
// <script src="js.stripe.com"> raz, a każde kolejne montowanie ramki (ponowne
// otwarcie modala, zmiana motywu, zmiana `clientSecret`) współdzieli ten sam
// egzemplarz zamiast dokładać kolejny tag skryptu.
import { loadStripe, type Stripe } from "@stripe/stripe-js";
import { paymentsClientToken } from "@/lib/stripe";

let stripePromise: Promise<Stripe | null> | null = null;

export function getStripe(): Promise<Stripe | null> {
  if (!stripePromise) {
    stripePromise = loadStripe(paymentsClientToken());
  }
  return stripePromise;
}
