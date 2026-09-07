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
      hint: "Dane na fakturze pochodzą z Twojego profilu rozliczeniowego. Możesz pobrać je z kartoteki firmy w CRM albo zapisać w niej swoje zmiany.",
      companyLabel: "Firma w CRM",
      taxIdLabel: "NIP / VAT ID",
      addressLabel: "Adres",
      pull: "Pobierz dane z CRM",
      push: "Zapisz dane w CRM",
      pulled: "Dane nabywcy uzupełnione z CRM.",
      pushed: "Kartoteka firmy w CRM zaktualizowana.",
      editHint: "Dane do faktury edytujesz w zakładce „Dane do faktury”.",
      errors: {
        no_tenant: "Twoje konto nie jest przypisane do organizacji.",
        no_company: "Nie znaleźliśmy kartoteki Twojej firmy w CRM.",
        no_billing_data: "Uzupełnij najpierw dane do faktury (nazwa firmy jest wymagana).",
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
      hint: "Invoice details come from your billing profile. You can pull them from the company record in the CRM or save your changes there.",
      companyLabel: "Company in the CRM",
      taxIdLabel: "Tax ID / VAT ID",
      addressLabel: "Address",
      pull: "Pull details from the CRM",
      push: "Save details to the CRM",
      pulled: "Buyer details filled in from the CRM.",
      pushed: "Company record in the CRM updated.",
      editHint: "You can edit invoice details in the “Billing details” tab.",
      errors: {
        no_tenant: "Your account is not assigned to an organisation.",
        no_company: "We could not find your company record in the CRM.",
        no_billing_data: "Fill in your billing details first (the company name is required).",
        generic: "The operation failed. Please try again.",
      },
    },
  },
};

i18n.addResourceBundle("pl", "translation", invoicesPl, true, true);
i18n.addResourceBundle("en", "translation", invoicesEn, true, true);

/** No-op wołany w komponencie trasy - patrz nota w i18n-donate.ts. */
export function ensureI18n(): void {}
