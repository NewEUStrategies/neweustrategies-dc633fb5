// i18n formularza darowizn (PL/EN). Import side-effectowy tam, gdzie montuje
// się formularz albo panel administracyjny darowizn:
//   import "@/lib/i18n-donate";
import i18n from "./i18n";

export const donatePl = {
  donate: {
    admin: {
      title: "Darowizny",
      intro:
        "Własny checkout darowizn (jednorazowych i miesięcznych) obsługiwany przez naszego operatora płatności. Publiczny formularz:",
      summary: {
        total: "Suma wpłat",
        month: "W tym miesiącu",
        count: "Liczba wpłat",
      },
      engine: {
        title: "Silnik wpłat",
        enabledLabel: "Moduł aktywny",
        enabledHint: "Wyłączenie ukrywa formularz i CTA darowizn.",
        enabledToggle: "Zbieraj darowizny",
        providerLabel: "Tryb",
        providerHint: "Własny checkout albo przekierowanie do zewnętrznej zbiórki.",
        providerStripe: "Nasz checkout (karta, BLIK, Apple/Google Pay)",
        providerExternal: "Zewnętrzna zbiórka (link)",
        externalUrlLabel: "Adres zbiórki",
        currencyLabel: "Waluta",
      },
      amounts: {
        title: "Kwoty",
        presetsLabel: "Kwoty sugerowane",
        presetsHint:
          "Kwoty w walucie zbiórki. Rozdzielaj je spacją, średnikiem albo przecinkiem ze spacją (25, 50, 100, 250). Przecinek między cyframi bez spacji zapisuje grosze (12,50).",
        minLabel: "Kwota minimalna (grosze)",
        maxLabel: "Kwota maksymalna (grosze)",
        goalLabel: "Cel zbiórki (grosze)",
        goalHint: "0 wyłącza pasek postępu.",
      },
      form: {
        title: "Formularz",
        allowCustom: "Pozwól wpisać własną kwotę",
        allowRecurring: "Pozwól na wsparcie miesięczne",
        allowMessage: "Pole wiadomości od darczyńcy",
        showRecent: "Pokazuj ostatnie wpłaty",
      },
      content: {
        title: "Treści",
        headlinePl: "Nagłówek (PL)",
        headlineEn: "Nagłówek (EN)",
        descriptionPl: "Opis (PL)",
        descriptionEn: "Opis (EN)",
      },
      sync: {
        title: "Synchronizacja ze Stripe",
        description:
          "Uzgadnia rejestr wpłat ze Stripe (ostatnie 7 dni): domyka wpłaty oczekujące, importuje brakujące opłacone sesje i oznacza zwroty. Operacja jest idempotentna.",
        environmentLabel: "Środowisko synchronizacji",
        sandbox: "Środowisko testowe",
        live: "Środowisko produkcyjne",
        run: "Synchronizuj ze Stripe",
        running: "Synchronizuję...",
        failed: "Synchronizacja nie powiodła się.",
        report:
          "{{environment}} · Zaksięgowane: {{settled}} · zaimportowane: {{imported}} · zwroty: {{refunded}} · wygasłe: {{expired}} · przejrzane sesje: {{scanned}}",
        reportWarnings: " · ostrzeżenia: {{warnings}}",
      },
      records: {
        title: "Ostatnie wpłaty",
        empty: "Brak zarejestrowanych wpłat.",
        date: "Data",
        amount: "Kwota",
        status: "Status",
        type: "Typ",
        donor: "Darczyńca",
        recurring: "miesięczna",
        oneTime: "jednorazowa",
      },
      save: {
        invalid:
          "Nie zapisano - publiczna strona odrzuciłaby tę konfigurację i wróciłaby do ustawień domyślnych. Popraw: {{fields}}.",
      },
    },
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
    admin: {
      title: "Donations",
      intro:
        "Our own donation checkout (one-off and monthly) handled by our payment provider. Public form:",
      summary: {
        total: "Total raised",
        month: "This month",
        count: "Gift count",
      },
      engine: {
        title: "Donation engine",
        enabledLabel: "Module active",
        enabledHint: "Turning it off hides the donation form and its CTA.",
        enabledToggle: "Collect donations",
        providerLabel: "Mode",
        providerHint: "Our own checkout or a redirect to an external fundraiser.",
        providerStripe: "Our checkout (card, BLIK, Apple/Google Pay)",
        providerExternal: "External fundraiser (link)",
        externalUrlLabel: "Fundraiser address",
        currencyLabel: "Currency",
      },
      amounts: {
        title: "Amounts",
        presetsLabel: "Suggested amounts",
        presetsHint:
          "Amounts in the fundraiser currency. Separate them with a space, a semicolon or a comma followed by a space (25, 50, 100, 250). A comma between digits with no space writes the fraction (12,50).",
        minLabel: "Minimum amount (minor units)",
        maxLabel: "Maximum amount (minor units)",
        goalLabel: "Fundraising goal (minor units)",
        goalHint: "0 hides the progress bar.",
      },
      form: {
        title: "Form",
        allowCustom: "Allow a custom amount",
        allowRecurring: "Allow monthly support",
        allowMessage: "Message field for the donor",
        showRecent: "Show recent gifts",
      },
      content: {
        title: "Copy",
        headlinePl: "Headline (PL)",
        headlineEn: "Headline (EN)",
        descriptionPl: "Description (PL)",
        descriptionEn: "Description (EN)",
      },
      sync: {
        title: "Stripe reconciliation",
        description:
          "Reconciles the gift register with Stripe (last 7 days): settles pending gifts, imports missing paid sessions and marks refunds. The operation is idempotent.",
        environmentLabel: "Reconciliation environment",
        sandbox: "Sandbox environment",
        live: "Live environment",
        run: "Reconcile with Stripe",
        running: "Reconciling...",
        failed: "The reconciliation failed.",
        report:
          "{{environment}} · settled: {{settled}} · imported: {{imported}} · refunds: {{refunded}} · expired: {{expired}} · sessions scanned: {{scanned}}",
        reportWarnings: " · warnings: {{warnings}}",
      },
      records: {
        title: "Recent gifts",
        empty: "No gifts recorded yet.",
        date: "Date",
        amount: "Amount",
        status: "Status",
        type: "Type",
        donor: "Donor",
        recurring: "monthly",
        oneTime: "one-off",
      },
      save: {
        invalid:
          "Not saved - the public page would reject this configuration and fall back to the defaults. Fix: {{fields}}.",
      },
    },
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
