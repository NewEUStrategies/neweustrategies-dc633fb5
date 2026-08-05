// i18n dla administracyjnego podsumowania zgód (audyt RODO).
import i18n from "@/lib/i18n";

const pl = {
  adminConsentAudit: {
    title: "Rejestr zgód",
    hint: "Kto, kiedy i na jakich kategoriach wyraził lub cofnął zgodę - wraz z wersją banera i źródłem decyzji.",
    stats: {
      title: "Podsumowanie",
      window: "Okno czasu",
      days7: "7 dni",
      days30: "30 dni",
      days90: "90 dni",
      key: "Zgoda",
      granted: "Udzielone",
      denied: "Cofnięte",
      gpc: "Sygnał GPC",
      lastEvent: "Ostatnie zdarzenie",
      bannerVersions: "Wersje banera",
    },
    decisions: {
      title: "Ostatnie decyzje",
      user: "Użytkownik",
      when: "Kiedy",
      categories: "Kategorie",
      granted: "Zgoda",
      denied: "Brak zgody",
      bannerVersion: "Wersja banera",
      source: "Źródło",
      page: "Strona",
      gpcActive: "GPC",
      more: "Pokaż więcej",
      empty: "Brak zapisanych decyzji w rejestrze.",
      loading: "Wczytywanie rejestru…",
      error: "Nie udało się wczytać rejestru zgód.",
    },
    sources: {
      cmp_banner: "Baner cookie",
      profile_privacy: "Centrum prywatności",
      notifications_center: "Centrum powiadomień",
      login_sync: "Synchronizacja przy logowaniu",
      gpc_signal: "Sygnał GPC",
      account: "Konto",
    },
  },
};

const en: typeof pl = {
  adminConsentAudit: {
    title: "Consent register",
    hint: "Who consented or withdrew, when, for which categories - together with the banner version and the decision source.",
    stats: {
      title: "Summary",
      window: "Time window",
      days7: "7 days",
      days30: "30 days",
      days90: "90 days",
      key: "Consent",
      granted: "Granted",
      denied: "Withdrawn",
      gpc: "GPC signal",
      lastEvent: "Last event",
      bannerVersions: "Banner versions",
    },
    decisions: {
      title: "Latest decisions",
      user: "User",
      when: "When",
      categories: "Categories",
      granted: "Granted",
      denied: "Denied",
      bannerVersion: "Banner version",
      source: "Source",
      page: "Page",
      gpcActive: "GPC",
      more: "Show more",
      empty: "No decisions recorded yet.",
      loading: "Loading register…",
      error: "Could not load the consent register.",
    },
    sources: {
      cmp_banner: "Cookie banner",
      profile_privacy: "Privacy centre",
      notifications_center: "Notification centre",
      login_sync: "Sign-in sync",
      gpc_signal: "GPC signal",
      account: "Account",
    },
  },
};

i18n.addResourceBundle("pl", "translation", pl, true, true);
i18n.addResourceBundle("en", "translation", en, true, true);

/** No-op wołany w komponencie zamiast side-effectowego importu modułu. */
export function ensureI18n(): void {}
