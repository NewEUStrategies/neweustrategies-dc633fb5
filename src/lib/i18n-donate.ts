// i18n formularza darowizn (PL/EN). Import side-effectowy tam, gdzie montuje
// się formularz albo panel administracyjny darowizn:
//   import "@/lib/i18n-donate";
import i18n from "./i18n";

export const donatePl = {
  donate: {
    title: "Wesprzyj niezależną analizę",
    subtitle: "Mecenat obywatelski finansuje tracker legislacyjny UE, raporty i debaty.",
    once: "Jednorazowo",
    monthly: "Co miesiąc",
    frequency: "Częstotliwość wsparcia",
    recurringNote:
      "Wsparcie miesięczne pobieramy co miesiąc do momentu rezygnacji. Możesz je odwołać w dowolnej chwili - wystarczy wiadomość do redakcji.",
    amount: "Kwota wsparcia",
    customAmount: "Inna kwota",
    range: "Kwota od {{min}} do {{max}}.",
    email: "Adres e-mail (na potwierdzenie)",
    message: "Wiadomość dla redakcji (opcjonalnie)",
    submit: "Przejdź do płatności",
    submitting: "Otwieranie płatności...",
    checkoutTitle: "Darowizna",
    checkoutTitleMonthly: "Darowizna miesięczna",
    newTab: "otwiera się w nowej karcie",
    thanksTitle: "Dziękujemy za wsparcie",
    thanksBody: "Potwierdzenie wpłaty wysłaliśmy na podany adres e-mail.",
    backHome: "Wróć na stronę główną",
    disabled: "Zbiórka jest chwilowo wyłączona.",
    external: "Przejdź do zbiórki",
    goal: "Cel zbiórki",
    raised: "Zebrano",
    secure: "Płatność obsługuje operator kartowy - nie przechowujemy danych karty.",
    errors: {
      amount_out_of_range: "Kwota jest poza dozwolonym zakresem.",
      donations_disabled: "Zbiórka jest chwilowo wyłączona.",
      recurring_disabled: "Wsparcie cykliczne jest wyłączone.",
      rate_limited: "Zbyt wiele prób. Spróbuj ponownie za kilka minut.",
      generic: "Nie udało się otworzyć płatności. Spróbuj ponownie.",
    },
  },
};

export const donateEn = {
  donate: {
    title: "Support independent analysis",
    subtitle: "Citizen patronage funds our EU legislative tracker, reports and debates.",
    once: "One-off",
    monthly: "Monthly",
    frequency: "Giving frequency",
    recurringNote:
      "Monthly support is charged every month until you cancel. You can stop it at any time - just message the newsroom.",
    amount: "Gift amount",
    customAmount: "Other amount",
    range: "Amount between {{min}} and {{max}}.",
    email: "Email address (for the receipt)",
    message: "Message to the newsroom (optional)",
    submit: "Continue to payment",
    submitting: "Opening payment...",
    checkoutTitle: "Donation",
    checkoutTitleMonthly: "Monthly donation",
    newTab: "opens in a new tab",
    thanksTitle: "Thank you for your support",
    thanksBody: "We have sent the confirmation to the email address you provided.",
    backHome: "Back to homepage",
    disabled: "Donations are temporarily closed.",
    external: "Go to the fundraiser",
    goal: "Fundraising goal",
    raised: "Raised",
    secure: "Payments are processed by our card provider - we never store card data.",
    errors: {
      amount_out_of_range: "That amount is outside the allowed range.",
      donations_disabled: "Donations are temporarily closed.",
      recurring_disabled: "Recurring giving is disabled.",
      rate_limited: "Too many attempts. Please try again in a few minutes.",
      generic: "We could not open the payment. Please try again.",
    },
  },
};

i18n.addResourceBundle("pl", "translation", donatePl, true, true);
i18n.addResourceBundle("en", "translation", donateEn, true, true);

/**
 * No-op wołany w KOMPONENCIE trasy (nie side-effectowym importem w pliku
 * trasy): route splitter przenosi wtedy import razem z komponentem do jego
 * chunku, a rejestracja (addResourceBundle wyżej) uruchamia się przy
 * załadowaniu tego chunku - słownik nie wchodzi do chunku wejściowego
 * KAŻDEJ strony. Wzorzec: i18n-club.ts / i18n-network.ts.
 */
export function ensureI18n(): void {}
