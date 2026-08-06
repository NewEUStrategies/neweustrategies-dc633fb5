// Chrome checkoutu Stripe (baner trybu testowego + stany leniwej ramki) -
// osobny mały bundle (jak inne i18n-*), żeby strony bez płatności nie ładowały
// tych kluczy.
import i18n from "./i18n";

const pl = {
  paymentsBanner: {
    checkout: "Płatność",
    testMode: "Tryb testowy",
    testModeDesc:
      "To środowisko testowe Stripe. Użyj karty 4242 4242 4242 4242 - żadna prawdziwa płatność nie zostanie pobrana.",
    // Stany ramki ładowanej leniwie (EmbeddedCheckoutFrame).
    frameLoading: "Wczytujemy bezpieczny formularz płatności",
    frameFailed:
      "Nie udało się wczytać formularza płatności. Sprawdź połączenie z internetem - blokada skryptów zewnętrznych też może to powodować.",
    frameRetry: "Odśwież stronę",
  },
};

const en: typeof pl = {
  paymentsBanner: {
    checkout: "Checkout",
    testMode: "Test mode",
    testModeDesc:
      "This is a Stripe test environment. Use card 4242 4242 4242 4242 - no real charge will be made.",
    frameLoading: "Loading the secure payment form",
    frameFailed:
      "The payment form could not be loaded. Check your internet connection - a script blocker can cause this too.",
    frameRetry: "Reload the page",
  },
};

i18n.addResourceBundle("pl", "translation", pl, true, true);
i18n.addResourceBundle("en", "translation", en, true, true);
