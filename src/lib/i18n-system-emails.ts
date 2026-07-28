import i18n from "./i18n";

// Overlay dla panelu /admin/newsletter/system-emails - logi i raport
// dostarczalności maili systemowych (autoryzacja + transakcyjne).

const pl = {
  systemEmails: {
    title: "Maile systemowe",
    subtitle:
      "Log wysyłek i statusy maili autoryzacyjnych oraz transakcyjnych. Każdy e-mail liczony jest raz - po ostatnim znanym statusie.",
    refresh: "Odśwież",
    range: { label: "Zakres", d1: "24 h", d7: "7 dni", d30: "30 dni" },
    filters: {
      template: "Rodzaj",
      status: "Status",
      all: "Wszystkie",
      search: "E-mail odbiorcy",
    },
    kpi: {
      total: "Wysyłki",
      sent: "Dostarczone do dostawcy",
      failed: "Błędy",
      suppressed: "Wykluczone",
      pending: "W kolejce",
      rate: "Skuteczność",
    },
    chart: {
      title: "Wysyłki dziennie",
      sent: "Wysłane",
      failed: "Błędy",
      suppressed: "Wykluczone",
    },
    table: {
      template: "Rodzaj",
      recipient: "Odbiorca",
      status: "Status",
      date: "Data",
      error: "Błąd",
      attempts: "Próby",
      empty: "Brak wysyłek w wybranym zakresie.",
      showing: "Pokazano {{shown}} z {{total}}",
      prev: "Poprzednia",
      next: "Następna",
    },
    status: {
      sent: "Dostarczony",
      pending: "W kolejce",
      dlq: "Nieudany",
      failed: "Błąd",
      suppressed: "Wykluczony",
      bounced: "Odbity",
      complained: "Skarga",
    },
    suppressed: "Adresy na liście wykluczeń: {{count}}",
    notReady:
      "Infrastruktura wysyłkowa nie jest jeszcze aktywna - logi pojawią się po weryfikacji domeny nadawczej.",
    error: "Nie udało się pobrać logu wysyłek.",
  },
};

const en = {
  systemEmails: {
    title: "System emails",
    subtitle:
      "Send log and statuses for authentication and app emails. Each email is counted once, by its latest known status.",
    refresh: "Refresh",
    range: { label: "Range", d1: "24 h", d7: "7 days", d30: "30 days" },
    filters: {
      template: "Type",
      status: "Status",
      all: "All",
      search: "Recipient email",
    },
    kpi: {
      total: "Sends",
      sent: "Accepted by provider",
      failed: "Failures",
      suppressed: "Suppressed",
      pending: "Queued",
      rate: "Success rate",
    },
    chart: {
      title: "Sends per day",
      sent: "Sent",
      failed: "Failures",
      suppressed: "Suppressed",
    },
    table: {
      template: "Type",
      recipient: "Recipient",
      status: "Status",
      date: "Date",
      error: "Error",
      attempts: "Attempts",
      empty: "No sends in the selected range.",
      showing: "Showing {{shown}} of {{total}}",
      prev: "Previous",
      next: "Next",
    },
    status: {
      sent: "Delivered",
      pending: "Queued",
      dlq: "Failed",
      failed: "Error",
      suppressed: "Suppressed",
      bounced: "Bounced",
      complained: "Complaint",
    },
    suppressed: "Addresses on the suppression list: {{count}}",
    notReady:
      "Sending infrastructure is not active yet - logs appear once the sender domain is verified.",
    error: "Could not load the send log.",
  },
};

if (!i18n.hasResourceBundle("pl", "translation")) {
  i18n.addResourceBundle("pl", "translation", pl, true, true);
} else {
  i18n.addResourceBundle("pl", "translation", pl, true, true);
}
i18n.addResourceBundle("en", "translation", en, true, true);

export {};
