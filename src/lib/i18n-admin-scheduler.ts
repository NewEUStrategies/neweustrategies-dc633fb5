/**
 * Zasoby i18n panelu zdrowia harmonogramu doręczeń (`adminScheduler.*`).
 *
 * Osobny bundel (nie sekcja w i18n-admin-extras) z tych samych powodów co
 * i18n-admin-semantic: ciągi stoją przy swoim kodzie, a chunk ładuje się
 * wyłącznie na /admin/community/notifications - żadna inna powierzchnia nie
 * potrzebuje słownika crona.
 *
 * Nazwy źródeł i progów świeżości pochodzą z kontraktu w
 * src/lib/jobs/scheduler.ts, więc klucze są składane DYNAMICZNIE
 * (`adminScheduler.sources.<źródło>`, `adminScheduler.freshness.<stan>`).
 * Kompletność pokrycia w obu językach pilnuje
 * src/lib/__tests__/i18nAdminScheduler.test.ts.
 */
import i18n from "@/lib/i18n";

export const adminSchedulerPl = {
  adminScheduler: {
    title: "Harmonogram doręczeń",
    subtitle:
      "Kto i kiedy drenuje kolejkę push, digesty e-mail oraz przypomnienia. Bez działającego harmonogramu powiadomienia zostają w bazie.",
    freshness: {
      fresh: "Działa",
      lagging: "Opóźnienie",
      stale: "Zastój",
      never: "Nieuruchomiony",
    },
    headline: {
      fresh: "Dyspozytor odpowiada. Ostatni udany przebieg: {{ago}}.",
      lagging:
        "Cron minutowy milczy, siatka 5-minutowa jeszcze łapie. Ostatni udany przebieg: {{ago}}.",
      stale: "Nikt nie drenuje kolejek - push i digesty stoją. Ostatni udany przebieg: {{ago}}.",
      never: "Żaden przebieg nigdy nie dotarł do bazy. Harmonogram jest nieuzbrojony.",
    },
    sources: {
      pg_cron: "pg_cron (baza: tick co minutę, siatka co 5 min)",
      github_actions: "GitHub Actions (repo, co 5 min)",
      admin: "Panel admina (ręcznie)",
      external: "Scheduler zewnętrzny",
      dev: "Środowisko lokalne",
    },
    runner: {
      title: "Runner bazy (ścieżka podstawowa)",
      enabled: "Włączony",
      disabled: "Wyłączony",
      baseUrl: "Adres aplikacji",
      baseUrlEmpty: "nie ustawiony",
      secretSet: "Sekret ustawiony",
      secretMissing: "Brak sekretu ticku",
      autoArmed: "Uzbrojony automatycznie {{ago}}",
      notArmed:
        "Runner nie jest uzbrojony: pg_cron tyka, ale nie wysyła żądań. Uruchom tick ręcznie albo ustaw adres aplikacji w panelu newslettera.",
      lastInvoke: "Ostatnie puknięcie crona: {{ago}} ({{count}} od wdrożenia)",
      lastInvokeNever: "Cron nigdy nie puknął do aplikacji",
      failureStreak: "Kolejne nieudane przebiegi: {{count}}",
      lastError: "Ostatni błąd: {{message}}",
      tickStatus: {
        dispatched: "Cron wysłał żądanie do aplikacji.",
        skipped: "Cron pominął puknięcie: {{reason}}",
        error: "Cron nie zdołał puknąć: {{reason}}",
      },
      communityTick: {
        never: "Siatka społeczności (community-cron) jeszcze nie puknęła.",
        dispatched: "Siatka społeczności: puknięcie {{ago}} ({{count}} od wdrożenia).",
        skipped: "Siatka społeczności pominęła puknięcie: {{reason}}",
        error: "Siatka społeczności nie zdołała puknąć: {{reason}}",
      },
      tickReason: {
        disabled: "runner jest wyłączony",
        no_secret: "brak sekretu ticku",
        no_base_url: "brak adresu aplikacji (ustaw base_url albo domenę tenanta)",
        pg_net_unavailable: "rozszerzenie pg_net niedostępne w projekcie",
      },
    },
    capabilities: {
      title: "Rozszerzenia bazy",
      pgCronOn: "pg_cron aktywny",
      pgCronOff: "pg_cron niedostępny",
      pgNetOn: "pg_net aktywny",
      pgNetOff: "pg_net niedostępny",
      offHint:
        "Bez pg_cron lub pg_net ścieżka podstawowa nie działa - doręczenia jadą wyłącznie ze schedulera w repo.",
    },
    env: {
      title: "Środowisko aplikacji",
      vapidOk: "Klucze VAPID ustawione",
      vapidMissing: "Brak kluczy VAPID - push nie wyjdzie",
      emailOk: "Gateway e-mail ustawiony",
      emailMissing: "Brak klucza gatewaya e-mail - digesty nie wyjdą",
      cronSecretOk: "Sekret schedulera repo ustawiony",
      cronSecretMissing: "Brak COMMUNITY_CRON_SECRET (repo używa sekretu runnera)",
    },
    metrics: {
      pushPending: "Push w kolejce",
      pushDueNow: "Gotowe do wysłania",
      pushSent24h: "Wysłane / 24 h",
      pushDead: "Porzucone",
      oldestPending: "Najstarsze w kolejce",
      subscriptions: "Aktywne urządzenia",
      digestDaily: "Digest dzienny na wejściu",
      digestWeekly: "Digest tygodniowy na wejściu",
      oldestPendingHint: "Wiek najstarszego zadania czekającego w kolejce push.",
      pendingHint: "Zadania czekające na dyspozytora w tym tenancie.",
    },
    alerts: {
      appUnreachable:
        "Cron puka, ale aplikacja nie raportuje przebiegów. Sprawdź adres aplikacji, sekret ticku i stan wdrożenia.",
      stale: "Kolejka nie jest drenowana. Uruchom tick teraz i sprawdź konfigurację poniżej.",
      backlog: "W kolejce czeka {{count}} zadań push, najstarsze od {{ago}}.",
      dead: "{{count}} zadań push porzuconych po wyczerpaniu prób - sprawdź subskrypcje urządzeń.",
    },
    cron: {
      title: "Zadania w bazie",
      empty: "Brak zarejestrowanych zadań pg_cron.",
      name: "Nazwa",
      schedule: "Harmonogram",
      state: "Stan",
      active: "aktywne",
      inactive: "wyłączone",
    },
    runs: {
      title: "Ostatnie przebiegi",
      empty: "Brak zapisanych przebiegów - dyspozytor jeszcze nie odpowiedział.",
      source: "Źródło",
      job: "Zakres",
      when: "Kiedy",
      duration: "Czas",
      outcome: "Wynik",
      ok: "OK",
      failed: "Błąd",
    },
    actions: {
      runNow: "Uruchom tick teraz",
      running: "Tick w toku...",
      refresh: "Odśwież",
      ranOk: "Tick wykonany - kolejki zdrenowane.",
      ranFailed: "Tick zakończony błędem: {{message}}",
      loadFailed: "Nie udało się odczytać stanu harmonogramu.",
    },
    loading: "Wczytywanie stanu harmonogramu...",
  },
};

export const adminSchedulerEn = {
  adminScheduler: {
    title: "Delivery scheduler",
    subtitle:
      "Who drains the push queue, e-mail digests and reminders, and when. Without a live scheduler notifications simply sit in the database.",
    freshness: {
      fresh: "Healthy",
      lagging: "Lagging",
      stale: "Stalled",
      never: "Never ran",
    },
    headline: {
      fresh: "The dispatcher is responding. Last successful run: {{ago}}.",
      lagging:
        "The per-minute cron is silent, the 5-minute safety net still catches up. Last successful run: {{ago}}.",
      stale:
        "Nobody is draining the queues - push and digests are stuck. Last successful run: {{ago}}.",
      never: "No run has ever reached the database. The scheduler is not armed.",
    },
    sources: {
      pg_cron: "pg_cron (database: tick every minute, safety net every 5 min)",
      github_actions: "GitHub Actions (repo, every 5 min)",
      admin: "Admin panel (manual)",
      external: "External scheduler",
      dev: "Local environment",
    },
    runner: {
      title: "Database runner (primary path)",
      enabled: "Enabled",
      disabled: "Disabled",
      baseUrl: "App URL",
      baseUrlEmpty: "not set",
      secretSet: "Secret set",
      secretMissing: "Tick secret missing",
      autoArmed: "Armed automatically {{ago}}",
      notArmed:
        "The runner is not armed: pg_cron ticks but sends no requests. Run a tick manually or set the app URL in the newsletter panel.",
      lastInvoke: "Last cron ping: {{ago}} ({{count}} since deploy)",
      lastInvokeNever: "The cron has never pinged the app",
      failureStreak: "Consecutive failed runs: {{count}}",
      lastError: "Last error: {{message}}",
      tickStatus: {
        dispatched: "The cron sent a request to the app.",
        skipped: "The cron skipped the ping: {{reason}}",
        error: "The cron could not ping: {{reason}}",
      },
      communityTick: {
        never: "The community safety net (community-cron) has not pinged yet.",
        dispatched: "Community safety net: pinged {{ago}} ({{count}} since deploy).",
        skipped: "The community safety net skipped the ping: {{reason}}",
        error: "The community safety net could not ping: {{reason}}",
      },
      tickReason: {
        disabled: "the runner is disabled",
        no_secret: "the tick secret is missing",
        no_base_url: "no app URL (set base_url or the tenant domain)",
        pg_net_unavailable: "the pg_net extension is unavailable in this project",
      },
    },
    capabilities: {
      title: "Database extensions",
      pgCronOn: "pg_cron active",
      pgCronOff: "pg_cron unavailable",
      pgNetOn: "pg_net active",
      pgNetOff: "pg_net unavailable",
      offHint:
        "Without pg_cron or pg_net the primary path is dead - deliveries run from the repo scheduler only.",
    },
    env: {
      title: "App environment",
      vapidOk: "VAPID keys set",
      vapidMissing: "VAPID keys missing - push cannot be sent",
      emailOk: "E-mail gateway set",
      emailMissing: "E-mail gateway key missing - digests cannot be sent",
      cronSecretOk: "Repo scheduler secret set",
      cronSecretMissing: "COMMUNITY_CRON_SECRET missing (repo falls back to the runner secret)",
    },
    metrics: {
      pushPending: "Push queued",
      pushDueNow: "Ready to send",
      pushSent24h: "Sent / 24 h",
      pushDead: "Dropped",
      oldestPending: "Oldest queued",
      subscriptions: "Active devices",
      digestDaily: "Daily digests due",
      digestWeekly: "Weekly digests due",
      oldestPendingHint: "Age of the oldest job waiting in the push queue.",
      pendingHint: "Jobs waiting for the dispatcher in this tenant.",
    },
    alerts: {
      appUnreachable:
        "The cron pings but the app reports no runs. Check the app URL, the tick secret and the deployment.",
      stale: "The queue is not being drained. Run a tick now and review the configuration below.",
      backlog: "{{count}} push jobs are waiting, the oldest for {{ago}}.",
      dead: "{{count}} push jobs were dropped after exhausting retries - review device subscriptions.",
    },
    cron: {
      title: "Database jobs",
      empty: "No pg_cron jobs registered.",
      name: "Name",
      schedule: "Schedule",
      state: "State",
      active: "active",
      inactive: "disabled",
    },
    runs: {
      title: "Recent runs",
      empty: "No runs recorded - the dispatcher has not answered yet.",
      source: "Source",
      job: "Scope",
      when: "When",
      duration: "Duration",
      outcome: "Outcome",
      ok: "OK",
      failed: "Failed",
    },
    actions: {
      runNow: "Run tick now",
      running: "Tick running...",
      refresh: "Refresh",
      ranOk: "Tick completed - queues drained.",
      ranFailed: "Tick failed: {{message}}",
      loadFailed: "Could not read the scheduler state.",
    },
    loading: "Loading scheduler state...",
  },
};

i18n.addResourceBundle("pl", "translation", adminSchedulerPl, true, true);
i18n.addResourceBundle("en", "translation", adminSchedulerEn, true, true);

/**
 * No-op wołany w komponencie zamiast side-effectowego importu modułu - nazwane
 * wiązanie pozwala splitterowi przenieść bundel do chunku panelu (ta sama
 * konwencja co ensureI18n w i18n-community).
 */
export function ensureI18n(): void {}
