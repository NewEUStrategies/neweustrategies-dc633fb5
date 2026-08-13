// Chrome checkoutu Stripe (baner trybu testowego + stany leniwej ramki) -
// osobny mały bundle (jak inne i18n-*), żeby strony bez płatności nie ładowały
// tych kluczy.
import i18n from "./i18n";

const pl = {
  paymentsBanner: {
    checkout: "Płatność",
    // Stany leniwej ramki Stripe. Osobne od `loading`: tamten opisuje całą
    // płatność, te trzy - wyłącznie pobranie chunku SDK i jego nieudanie się.
    frameFailed: "Nie udało się wczytać formularza płatności. Odśwież stronę i spróbuj ponownie.",
    frameLoading: "Ładowanie formularza płatności...",
    frameRetry: "Odśwież stronę",
    loading: "Ładowanie płatności...",
    testMode: "Tryb testowy",
    testModeDesc:
      "To środowisko testowe Stripe. Użyj karty 4242 4242 4242 4242 - żadna prawdziwa płatność nie zostanie pobrana.",
  },
};

const en: typeof pl = {
  paymentsBanner: {
    checkout: "Checkout",
    frameFailed: "The payment form could not be loaded. Please refresh the page and try again.",
    frameLoading: "Loading the payment form...",
    frameRetry: "Refresh the page",
    loading: "Loading payment...",
    testMode: "Test mode",
    testModeDesc:
      "This is a Stripe test environment. Use card 4242 4242 4242 4242 - no real charge will be made.",
  },
};

i18n.addResourceBundle("pl", "translation", pl, true, true);
i18n.addResourceBundle("en", "translation", en, true, true);
