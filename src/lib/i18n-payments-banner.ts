// Chrome checkoutu Stripe (baner trybu testowego + stany leniwej ramki) -
// osobny mały bundle (jak inne i18n-*), żeby strony bez płatności nie ładowały
// tych kluczy.
import i18n from "./i18n";

const pl = {
  paymentsBanner: {
    checkout: "Płatność",
    loading: "Ładowanie płatności...",
    testMode: "Tryb testowy",
    testModeDesc:
      "To środowisko testowe Stripe. Użyj karty 4242 4242 4242 4242 - żadna prawdziwa płatność nie zostanie pobrana.",
  },
};

const en: typeof pl = {
  paymentsBanner: {
    checkout: "Checkout",
    loading: "Loading payment...",
    testMode: "Test mode",
    testModeDesc:
      "This is a Stripe test environment. Use card 4242 4242 4242 4242 - no real charge will be made.",
  },
};

i18n.addResourceBundle("pl", "translation", pl, true, true);
i18n.addResourceBundle("en", "translation", en, true, true);
