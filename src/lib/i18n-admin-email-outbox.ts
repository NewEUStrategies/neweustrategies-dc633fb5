import i18n from "./i18n";

// Overlay dla skrzynki wysyłek (/admin/newsletter/outbox): filtry zakresu,
// typu i statusu wiadomości, kafle podsumowania i dziennik wysyłek.

const pl = {
  adminOutbox: {
    title: "Skrzynka wysyłek",
    subtitle:
      "Każda wiadomość wysłana przez platformę - status, odbiorca i powód niepowodzenia. Jedna wiadomość to jedna pozycja, niezależnie od liczby prób.",
    refresh: "Odśwież",
    range: {
      label: "Zakres",
      h24: "24 godziny",
      d7: "7 dni",
      d30: "30 dni",
      custom: "Własny zakres",
      from: "Od",
      to: "Do",
      clear: "Wróć do presetu",
    },
    filters: {
      template: "Typ wiadomości",
      allTemplates: "Wszystkie typy",
      status: "Status",
      allStatuses: "Wszystkie statusy",
      search: "Szukaj po adresie odbiorcy",
    },
    stats: {
      total: "Wiadomości",
      sent: "Wysłane",
      failed: "Nieudane",
      suppressed: "Zablokowane",
      pending: "W kolejce",
    },
    table: {
      template: "Typ",
      recipient: "Odbiorca",
      status: "Status",
      createdAt: "Data",
      error: "Powód",
      empty: "Brak wysyłek w wybranym zakresie.",
      loading: "Wczytywanie...",
      page: "Strona {{page}} z {{pages}}",
      prev: "Poprzednia",
      next: "Następna",
      count: "{{count}} wiadomości",
    },
    status: {
      sent: "Wysłana",
      pending: "W kolejce",
      failed: "Nieudana",
      dlq: "Porzucona",
      suppressed: "Zablokowana",
      bounced: "Odbita",
      complained: "Zgłoszona jako spam",
    },
    truncated: "Zakres zawiera więcej wysyłek niż mieści się w jednym odczycie - zawęź go.",
    error: "Nie udało się wczytać skrzynki wysyłek.",
  },
};

const en = {
  adminOutbox: {
    title: "Email outbox",
    subtitle:
      "Every message the platform sent - status, recipient and failure reason. One message is one entry, no matter how many attempts it took.",
    refresh: "Refresh",
    range: {
      label: "Range",
      h24: "24 hours",
      d7: "7 days",
      d30: "30 days",
      custom: "Custom range",
      from: "From",
      to: "To",
      clear: "Back to preset",
    },
    filters: {
      template: "Email type",
      allTemplates: "All types",
      status: "Status",
      allStatuses: "All statuses",
      search: "Search by recipient address",
    },
    stats: {
      total: "Messages",
      sent: "Sent",
      failed: "Failed",
      suppressed: "Suppressed",
      pending: "Queued",
    },
    table: {
      template: "Type",
      recipient: "Recipient",
      status: "Status",
      createdAt: "Date",
      error: "Reason",
      empty: "No messages in the selected range.",
      loading: "Loading...",
      page: "Page {{page}} of {{pages}}",
      prev: "Previous",
      next: "Next",
      count: "{{count}} messages",
    },
    status: {
      sent: "Sent",
      pending: "Queued",
      failed: "Failed",
      dlq: "Dropped",
      suppressed: "Suppressed",
      bounced: "Bounced",
      complained: "Marked as spam",
    },
    truncated: "This range holds more messages than one read can return - narrow it down.",
    error: "Could not load the email outbox.",
  },
};

i18n.addResourceBundle("pl", "translation", pl, true, true);
i18n.addResourceBundle("en", "translation", en, true, true);

export {};
