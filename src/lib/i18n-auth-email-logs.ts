import i18n from "./i18n";

// Overlay dla panelu /admin/newsletter/auth-logs - diagnostyka webhooka
// maili autoryzacyjnych (język, typ, nadawca, subject, redirect_to).

const pl = {
  authEmailLogs: {
    title: "Logi maili autoryzacyjnych",
    subtitle:
      "Każde zdarzenie webhooka auth: rozpoznany język i jego źródło, typ maila, nadawca, temat oraz adres powrotny.",
    refresh: "Odśwież",
    range: { label: "Zakres", d1: "24 h", d7: "7 dni", d30: "30 dni" },
    filters: {
      type: "Typ maila",
      lang: "Język",
      status: "Status",
      all: "Wszystkie",
      fallbackOnly: "Tylko fallback języka",
      search: "Szukaj (odbiorca, temat, redirect, run id)",
    },
    kpi: {
      total: "Zdarzenia",
      enqueued: "W kolejce",
      failed: "Błędy",
      pl: "Po polsku",
      en: "Po angielsku",
      fallback: "Fallback języka",
    },
    sources: {
      title: "Źródło rozpoznania języka",
      param: "Parametr ?lang=",
      path: "Prefiks ścieżki /pl /en",
      metadata: "Metadane użytkownika",
      header: "Accept-Language",
      default: "Domyślny (PL)",
      unknown: "Nieznane",
    },
    table: {
      date: "Data",
      type: "Typ",
      lang: "Język",
      source: "Źródło",
      recipient: "Odbiorca",
      sender: "Nadawca",
      subject: "Temat",
      redirect: "Redirect",
      status: "Status",
      empty: "Brak zdarzeń w wybranym zakresie.",
      showing: "Pokazano {{shown}} z {{total}}",
      prev: "Poprzednia",
      next: "Następna",
    },
    status: {
      enqueued: "Zakolejkowany",
      rejected: "Odrzucony",
      failed: "Błąd",
    },
    notReady:
      "Diagnostyka nie zebrała jeszcze żadnych zdarzeń - pojawią się po pierwszej wysyłce maila autoryzacyjnego.",
    error: "Nie udało się wczytać logów webhooka.",
  },
};

const en = {
  authEmailLogs: {
    title: "Auth email logs",
    subtitle:
      "Every auth webhook event: resolved language and its source, email type, sender, subject and redirect target.",
    refresh: "Refresh",
    range: { label: "Range", d1: "24 h", d7: "7 days", d30: "30 days" },
    filters: {
      type: "Email type",
      lang: "Language",
      status: "Status",
      all: "All",
      fallbackOnly: "Language fallback only",
      search: "Search (recipient, subject, redirect, run id)",
    },
    kpi: {
      total: "Events",
      enqueued: "Queued",
      failed: "Errors",
      pl: "Polish",
      en: "English",
      fallback: "Language fallback",
    },
    sources: {
      title: "Language detection source",
      param: "?lang= parameter",
      path: "Path prefix /pl /en",
      metadata: "User metadata",
      header: "Accept-Language",
      default: "Default (PL)",
      unknown: "Unknown",
    },
    table: {
      date: "Date",
      type: "Type",
      lang: "Language",
      source: "Source",
      recipient: "Recipient",
      sender: "Sender",
      subject: "Subject",
      redirect: "Redirect",
      status: "Status",
      empty: "No events in the selected range.",
      showing: "Showing {{shown}} of {{total}}",
      prev: "Previous",
      next: "Next",
    },
    status: {
      enqueued: "Queued",
      rejected: "Rejected",
      failed: "Error",
    },
    notReady: "No diagnostics captured yet - events appear after the first auth email is sent.",
    error: "Could not load the webhook logs.",
  },
};

i18n.addResourceBundle("pl", "translation", pl, true, true);
i18n.addResourceBundle("en", "translation", en, true, true);

export {};
