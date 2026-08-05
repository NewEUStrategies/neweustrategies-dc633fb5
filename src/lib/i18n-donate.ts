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
    amount: "Kwota wsparcia",
    customAmount: "Inna kwota",
    email: "Adres e-mail (na potwierdzenie)",
    message: "Wiadomość dla redakcji (opcjonalnie)",
    submit: "Przejdź do płatności",
    submitting: "Otwieranie płatności...",
    checkoutTitle: "Darowizna",
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
    amount: "Gift amount",
    customAmount: "Other amount",
    email: "Email address (for the receipt)",
    message: "Message to the newsroom (optional)",
    submit: "Continue to payment",
    submitting: "Opening payment...",
    checkoutTitle: "Donation",
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
