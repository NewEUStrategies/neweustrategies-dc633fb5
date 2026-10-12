// i18n panelu faktur (PL/EN). Rejestracja przez `ensureI18n()` wołane w
// komponencie trasy - słownik jedzie w chunku strony, nie w wejściowym.
import i18n from "./i18n";

export const invoicesPl = {
  invoices: {
    pageTitle: "Faktury i rozliczenia",
    pageHint:
      "Każda opłata za plan i zakup ma tu swój dokument. Pobierz PDF albo otwórz oryginał wystawiony przez operatora płatności.",
    ledger: {
      title: "Dokumenty",
      hint: "Historia rozliczeń Twojego konta - od najnowszego dokumentu.",
      empty: "Nie masz jeszcze żadnych dokumentów rozliczeniowych.",
      colDate: "Data",
      colNumber: "Numer",
      colAmount: "Kwota",
      colStatus: "Status",
      download: "Pobierz PDF",
      original: "Oryginał operatora",
      generating: "Przygotowuję PDF...",
      error: "Nie udało się przygotować pliku PDF. Spróbuj ponownie.",
      ready: "Faktura pobrana.",
    },
    crm: {
      title: "Dane nabywcy i CRM",
      hint: "Dane na fakturze pochodzą z Twojego profilu rozliczeniowego. Możesz pobrać je z kartoteki firmy w CRM albo uzupełnić w niej brakujące dane. Dane, które kartoteka już ma, zmienia zespół.",
      companyLabel: "Firma w CRM",
      taxIdLabel: "NIP / VAT ID",
      addressLabel: "Adres",
      pull: "Pobierz dane z CRM",
      push: "Uzupełnij dane w CRM",
      pulled: "Dane nabywcy uzupełnione z CRM.",
      pushed: "Uzupełniliśmy brakujące dane w kartotece firmy w CRM.",
      editHint: "Dane do faktury edytujesz w zakładce „Dane do faktury”.",
      errors: {
        no_tenant: "Twoje konto nie jest przypisane do organizacji.",
        no_company:
          "Nie znaleźliśmy kartoteki Twojej firmy w CRM. Wybierz firmę w profilu albo podaj jej NIP w danych do faktury.",
        no_billing_data: "Uzupełnij najpierw dane do faktury (nazwa firmy jest wymagana).",
        tax_id_conflict:
          "W CRM jest już firma o tej nazwie z innym NIP-em - nie zmieniliśmy jej. Sprawdź NIP w danych do faktury albo skontaktuj się z zespołem.",
        generic: "Operacja się nie powiodła. Spróbuj ponownie.",
      },
    },
  },
};

export const invoicesEn: typeof invoicesPl = {
  invoices: {
    pageTitle: "Invoices and billing",
    pageHint:
      "Every plan fee and purchase has its document here. Download a PDF or open the original issued by the payment provider.",
    ledger: {
      title: "Documents",
      hint: "Billing history of your account - newest document first.",
      empty: "You do not have any billing documents yet.",
      colDate: "Date",
      colNumber: "Number",
      colAmount: "Amount",
      colStatus: "Status",
      download: "Download PDF",
      original: "Provider original",
      generating: "Preparing the PDF...",
      error: "We could not prepare the PDF file. Please try again.",
      ready: "Invoice downloaded.",
    },
    crm: {
      title: "Buyer details and CRM",
      hint: "Invoice details come from your billing profile. You can pull them from the company record in the CRM or fill in what the record is missing. Details the record already has are changed by the team.",
      companyLabel: "Company in the CRM",
      taxIdLabel: "Tax ID / VAT ID",
      addressLabel: "Address",
      pull: "Pull details from the CRM",
      push: "Complete details in the CRM",
      pulled: "Buyer details filled in from the CRM.",
      pushed: "We filled in the missing details in the company record in the CRM.",
      editHint: "You can edit invoice details in the “Billing details” tab.",
      errors: {
        no_tenant: "Your account is not assigned to an organisation.",
        no_company:
          "We could not find your company record in the CRM. Choose your company in your profile or enter its tax ID in your billing details.",
        no_billing_data: "Fill in your billing details first (the company name is required).",
        tax_id_conflict:
          "The CRM already has a company with this name and a different tax ID - we left it unchanged. Check the tax ID in your billing details or contact the team.",
        generic: "The operation failed. Please try again.",
      },
    },
  },
};

/** No-op wołany w komponencie trasy - patrz nota w i18n-donate.ts. */
// Explicit registration must survive both Vite and Nitro tree shaking.
// Keep the legacy side-effect import contract, and avoid repeated deep merges.
let registered = false;
export function ensureI18n(): void {
  if (registered) return;
  registered = true;
  i18n.addResourceBundle("pl", "translation", invoicesPl, true, true);
  i18n.addResourceBundle("en", "translation", invoicesEn, true, true);
}
ensureI18n();
