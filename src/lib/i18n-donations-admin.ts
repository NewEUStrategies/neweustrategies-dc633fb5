// i18n panelu darowizn (PL/EN) - WYŁĄCZNIE powierzchnia administracyjna.
//
// DLACZEGO OSOBNY PLIK, A NIE DOPISEK DO `i18n-donate.ts`. Tamten słownik
// obsługuje PUBLICZNY formularz `/donate`, więc jedzie do czytelnika. Panel ma
// ~45 własnych kluczy, których żaden gość nigdy nie zobaczy - dopisanie ich tam
// powiększyłoby słownik ładowany przy każdym wejściu na stronę zbiórki. To ten
// sam podział, który repo przeprowadziło już dla klubów
// (`i18n-club.ts` -> `i18n-clubs-admin.ts`, patrz bramka
// `adminClubsI18nLoading.gate.test.ts`).
//
// SKĄD TE NAPISY. Wszystkie pochodzą z `src/routes/admin.donations.tsx`, gdzie
// do 2026-08-22 leżały jako TWARDE POLSKIE LITERAŁY w JSX - mimo że trasa
// importowała `useTranslation` i wołała `ensureDonateI18n()`. Panel był więc
// przetłumaczony częściowo: etykiety pochodziły ze słownika, a cała treść
// formularza, nagłówki sekcji i tabela wpłat były po polsku bez względu na
// wybrany język. Wersja angielska wyglądała na zepsutą.
//
// Napisy PL są przeniesione ZNAK W ZNAK - to jest zmiana i18n, nie redakcyjna.
import i18n from "./i18n";

export const donationsAdminPl = {
  adminDonations: {
    title: "Darowizny",
    intro:
      "Własny checkout darowizn (jednorazowych i miesięcznych) obsługiwany przez naszego operatora płatności. Publiczny formularz:",
    stats: {
      total: "Suma wpłat",
      month: "W tym miesiącu",
      count: "Liczba wpłat",
    },
    engine: {
      title: "Silnik wpłat",
      enabledLabel: "Moduł aktywny",
      enabledHint: "Wyłączenie ukrywa formularz i CTA darowizn.",
      enabledCheckbox: "Zbieraj darowizny",
      modeLabel: "Tryb",
      modeHint: "Własny checkout albo przekierowanie do zewnętrznej zbiórki.",
      modeStripe: "Nasz checkout (karta, BLIK, Apple/Google Pay)",
      modeExternal: "Zewnętrzna zbiórka (link)",
      externalUrl: "Adres zbiórki",
      currency: "Waluta",
    },
    amounts: {
      title: "Kwoty",
      presets: "Kwoty sugerowane",
      presetsHint: "Lista kwot w walucie zbiórki, rozdzielona przecinkami (np. 25, 50, 100, 250).",
      min: "Kwota minimalna (grosze)",
      max: "Kwota maksymalna (grosze)",
      goal: "Cel zbiórki (grosze)",
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
      intro:
        "Uzgadnia rejestr wpłat ze Stripe (ostatnie 7 dni): domyka wpłaty oczekujące, importuje brakujące opłacone sesje i oznacza zwroty. Operacja jest idempotentna.",
      envSandbox: "Środowisko testowe",
      envLive: "Środowisko produkcyjne",
      run: "Synchronizuj ze Stripe",
      running: "Synchronizuję...",
      failed: "Synchronizacja nie powiodła się.",
      report:
        "Zaksięgowane: {{settled}} · zaimportowane: {{imported}} · zwroty: {{refunded}} · wygasłe: {{expired}} · przejrzane sesje: {{scanned}}",
      reportWarnings: " · ostrzeżenia: {{count}}",
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
  },
};

export const donationsAdminEn = {
  adminDonations: {
    title: "Donations",
    intro:
      "Our own donation checkout (one-off and monthly) handled by our payment provider. Public form:",
    stats: {
      total: "Total donated",
      month: "This month",
      count: "Number of donations",
    },
    engine: {
      title: "Donation engine",
      enabledLabel: "Module active",
      enabledHint: "Turning this off hides the donation form and CTA.",
      enabledCheckbox: "Collect donations",
      modeLabel: "Mode",
      modeHint: "Our own checkout or a redirect to an external fundraiser.",
      modeStripe: "Our checkout (card, BLIK, Apple/Google Pay)",
      modeExternal: "External fundraiser (link)",
      externalUrl: "Fundraiser URL",
      currency: "Currency",
    },
    amounts: {
      title: "Amounts",
      presets: "Suggested amounts",
      presetsHint:
        "A comma-separated list of amounts in the campaign currency (e.g. 25, 50, 100, 250).",
      min: "Minimum amount (minor units)",
      max: "Maximum amount (minor units)",
      goal: "Campaign goal (minor units)",
      goalHint: "0 disables the progress bar.",
    },
    form: {
      title: "Form",
      allowCustom: "Allow a custom amount",
      allowRecurring: "Allow monthly support",
      allowMessage: "Message field for the donor",
      showRecent: "Show recent donations",
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
      intro:
        "Reconciles the donation ledger with Stripe (last 7 days): settles pending donations, imports missing paid sessions and flags refunds. The operation is idempotent.",
      envSandbox: "Test environment",
      envLive: "Production environment",
      run: "Reconcile with Stripe",
      running: "Reconciling...",
      failed: "Reconciliation failed.",
      report:
        "Settled: {{settled}} · imported: {{imported}} · refunded: {{refunded}} · expired: {{expired}} · sessions scanned: {{scanned}}",
      reportWarnings: " · warnings: {{count}}",
    },
    records: {
      title: "Recent donations",
      empty: "No donations recorded yet.",
      date: "Date",
      amount: "Amount",
      status: "Status",
      type: "Type",
      donor: "Donor",
      recurring: "monthly",
      oneTime: "one-off",
    },
  },
};

i18n.addResourceBundle("pl", "translation", donationsAdminPl, true, true);
i18n.addResourceBundle("en", "translation", donationsAdminEn, true, true);

/**
 * No-op wołany w KOMPONENCIE trasy (nie side-effectowym importem w pliku
 * trasy): route splitter przenosi wtedy import razem z komponentem do jego
 * chunku, a rejestracja (`addResourceBundle` wyżej) uruchamia się przy
 * załadowaniu tego chunku - słownik nie wchodzi do chunku wejściowego KAŻDEJ
 * strony. Wzorzec: `i18n-donate.ts` / `i18n-clubs-admin.ts`.
 */
export function ensureDonationsAdminI18n(): void {}
