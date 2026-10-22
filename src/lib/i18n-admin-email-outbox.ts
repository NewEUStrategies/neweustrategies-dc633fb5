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
    // Etykiety kodów z kolumny „Powód" (I9, Z-I9c-02) - mapę kod -> klucz
    // trzyma `src/lib/admin/emailOutboxReason.ts`; surowy kod zostaje
    // w podpowiedzi wiersza dla wsparcia.
    reason: {
      codeHint: "Kod: {{code}}",
      suppressed: {
        generic: "Zablokowana: adres na liście blokad",
        hard_bounce: "Zablokowana: trwałe odbicie (adres nie istnieje)",
        soft_bounce: "Zablokowana: powtarzające się odbicia tymczasowe",
        complaint: "Zablokowana: odbiorca zgłosił spam",
        manual: "Zablokowana ręcznie przez administratora",
        unsubscribe: "Zablokowana: odbiorca wypisał się",
        invalid: "Zablokowana: nieprawidłowy adres",
        blocked: "Zablokowana przez dostawcę poczty",
      },
      cancelledAccountDeleted: "Anulowana: konto odbiorcy usunięte",
      skipped: {
        enrollment_missing: "Pominięta: zapis na ścieżkę już nie istnieje",
        no_consent: "Pominięta: brak zgody marketingowej",
        unsubscribed: "Pominięta: odbiorca wypisał się z newslettera",
        account_deleted: "Pominięta: konto odbiorcy usunięte",
        digest_disabled: "Pominięta: odbiorca wyłączył podsumowanie",
      },
      exited: {
        unknown: "Pominięta: zapis wyszedł ze ścieżki",
        completed: "Pominięta: zapis ukończył ścieżkę",
        goal: "Pominięta: zapis osiągnął cel ścieżki",
        exit_event: "Pominięta: zapis wyszedł ze ścieżki po zdarzeniu wyjścia",
        consent: "Pominięta: zapis wyszedł ze ścieżki - brak zgody",
        unsubscribed: "Pominięta: zapis wyszedł ze ścieżki - wypis",
        suppressed: "Pominięta: zapis wyszedł ze ścieżki - adres zablokowany",
        manual: "Pominięta: zapis usunięty ze ścieżki ręcznie",
        journey_archived: "Pominięta: ścieżka zarchiwizowana",
        error: "Pominięta: zapis zatrzymany błędem ścieżki",
        entry_filter: "Pominięta: kontakt nie spełnia warunków wejścia",
        account_deleted: "Pominięta: zapis zakończony - konto usunięte",
      },
    },
    truncated: "Zakres zawiera więcej wysyłek niż mieści się w jednym odczycie - zawęź go.",
    error: "Nie udało się wczytać skrzynki wysyłek.",
  },
};

const en: typeof pl = {
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
    reason: {
      codeHint: "Code: {{code}}",
      suppressed: {
        generic: "Suppressed: the address is on the suppression list",
        hard_bounce: "Suppressed: hard bounce (the address does not exist)",
        soft_bounce: "Suppressed: repeated soft bounces",
        complaint: "Suppressed: the recipient reported spam",
        manual: "Suppressed manually by an administrator",
        unsubscribe: "Suppressed: the recipient unsubscribed",
        invalid: "Suppressed: invalid address",
        blocked: "Suppressed by the mail provider",
      },
      cancelledAccountDeleted: "Cancelled: the recipient's account was deleted",
      skipped: {
        enrollment_missing: "Skipped: the journey enrollment no longer exists",
        no_consent: "Skipped: no marketing consent",
        unsubscribed: "Skipped: the recipient unsubscribed from the newsletter",
        account_deleted: "Skipped: the recipient's account was deleted",
        digest_disabled: "Skipped: the recipient turned off the digest",
      },
      exited: {
        unknown: "Skipped: the enrollment left the journey",
        completed: "Skipped: the enrollment completed the journey",
        goal: "Skipped: the enrollment reached the journey goal",
        exit_event: "Skipped: the enrollment left on an exit event",
        consent: "Skipped: the enrollment left - no consent",
        unsubscribed: "Skipped: the enrollment left - unsubscribed",
        suppressed: "Skipped: the enrollment left - address suppressed",
        manual: "Skipped: the enrollment was removed manually",
        journey_archived: "Skipped: the journey was archived",
        error: "Skipped: the enrollment was stopped by a journey error",
        entry_filter: "Skipped: the contact does not meet the entry conditions",
        account_deleted: "Skipped: the enrollment ended - account deleted",
      },
    },
    truncated: "This range holds more messages than one read can return - narrow it down.",
    error: "Could not load the email outbox.",
  },
};

i18n.addResourceBundle("pl", "translation", pl, true, true);
i18n.addResourceBundle("en", "translation", en, true, true);

export {};
