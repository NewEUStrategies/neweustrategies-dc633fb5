import i18n from "./i18n";

// Overlay dla kafla automatu wysyłki (/admin/newsletter/campaigns): stan
// runnera zadań tła, telemetria ostatniego ticku i głębokość kolejek pocztowych.
// Ładowany lokalnie przez komponent kafla, tak jak i18n-newsletter-deliverability.

const pl = {
  adminRunner: {
    title: "Automat wysyłki",
    subtitle:
      "Baza (pg_cron + pg_net) puka co minutę do aplikacji: wysyła zaplanowane kampanie, drenuje kolejkę poczty transakcyjnej, rozsyła digesty i przypomnienia. Bez działającego automatu kolejka rośnie, a wiadomości przepadają po przekroczeniu czasu życia.",
    state: {
      running: "Działa",
      idle: "Włączony, brak ticku",
      misconfigured: "Brak adresu aplikacji",
      disabled: "Wyłączony",
      error: "Błąd ticku",
    },
    stateHint: {
      running: "Ostatni tick dotarł do aplikacji - poczta wychodzi automatycznie.",
      idle: "Automat jest włączony, ale nie zarejestrowano jeszcze ani jednego ticku. Sprawdź, czy w bazie jest rozszerzenie pg_cron i pg_net.",
      misconfigured:
        "Cron nie zna publicznego adresu aplikacji: ustaw domenę tenanta albo wpisz adres poniżej.",
      disabled:
        "Zaplanowane kampanie i kolejka poczty czekają na ręczne uruchomienie. Włącz automat, żeby wysyłka działała bez otwartego panelu.",
      error: "Ostatnia próba ticku zakończyła się błędem - szczegóły poniżej.",
    },
    fields: {
      urlLabel: "Publiczny adres aplikacji",
      urlHint: "Puste = adres wyliczony z domeny tenanta: {{url}}",
      urlHintMissing: "Puste i brak domeny tenanta - automat nie ma gdzie zapukać.",
      enabled: "Włączony",
      useCurrentDomain: "Użyj bieżącej domeny",
      save: "Zapisz",
      saved: "Zapisano ustawienia automatu",
    },
    tick: {
      lastAt: "Ostatni tick: {{when}}",
      never: "Nie zarejestrowano jeszcze żadnego ticku.",
      count: "Ticków łącznie: {{count}}",
      secret: "Sekret ticku (podgląd):",
      endpoint: "endpoint: POST /api/public/jobs-tick (nagłówek x-jobs-secret)",
    },
    queues: {
      title: "Kolejki poczty",
      auth: "Autoryzacyjne",
      transactional: "Transakcyjne",
      dlq: "Martwe listy",
      empty: "Kolejki puste",
      unavailable: "Głębokość kolejek niedostępna (brak rozszerzenia pgmq).",
      backlogWarning:
        "W kolejce czeka {{count}} wiadomości. Jeśli liczba nie spada, dren nie nadąża - sprawdź konfigurację dostawcy poczty.",
      dlqWarning:
        "{{count}} wiadomości trafiło do martwej listy (przekroczony czas życia albo wyczerpane ponowienia).",
    },
  },
};

const en = {
  adminRunner: {
    title: "Sending automation",
    subtitle:
      "The database (pg_cron + pg_net) pings the app every minute: it sends scheduled campaigns, drains the transactional mail queue and dispatches digests and reminders. Without a working runner the queue grows and messages expire unsent.",
    state: {
      running: "Running",
      idle: "Enabled, no tick yet",
      misconfigured: "No app URL",
      disabled: "Disabled",
      error: "Tick error",
    },
    stateHint: {
      running: "The last tick reached the app - mail goes out automatically.",
      idle: "The runner is enabled but no tick has been recorded yet. Check that pg_cron and pg_net are installed in the database.",
      misconfigured:
        "Cron does not know the public app URL: set the tenant domain or enter the URL below.",
      disabled:
        "Scheduled campaigns and the mail queue wait for a manual run. Enable the runner so sending works without an open admin tab.",
      error: "The last tick attempt failed - details below.",
    },
    fields: {
      urlLabel: "Public app URL",
      urlHint: "Empty = derived from the tenant domain: {{url}}",
      urlHintMissing: "Empty and no tenant domain - the runner has nowhere to ping.",
      enabled: "Enabled",
      useCurrentDomain: "Use current domain",
      save: "Save",
      saved: "Runner settings saved",
    },
    tick: {
      lastAt: "Last tick: {{when}}",
      never: "No tick recorded yet.",
      count: "Ticks total: {{count}}",
      secret: "Tick secret (preview):",
      endpoint: "endpoint: POST /api/public/jobs-tick (x-jobs-secret header)",
    },
    queues: {
      title: "Mail queues",
      auth: "Auth",
      transactional: "Transactional",
      dlq: "Dead letters",
      empty: "Queues empty",
      unavailable: "Queue depth unavailable (pgmq extension missing).",
      backlogWarning:
        "{{count}} messages are waiting in the queue. If the number does not drop, the drain cannot keep up - check the mail provider configuration.",
      dlqWarning:
        "{{count}} messages landed in the dead-letter queue (expired or retries exhausted).",
    },
  },
};

i18n.addResourceBundle("pl", "translation", pl, true, true);
i18n.addResourceBundle("en", "translation", en, true, true);

export {};
