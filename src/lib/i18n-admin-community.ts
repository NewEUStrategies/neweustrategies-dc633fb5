// Słownik panelu społeczności (/admin/community/*), PL/EN.
//
// STAN ZASTANY. Cały moduł - osiem plików, ok. 250 napisów - trzymał tłumaczenia
// w ręcznych wyrażeniach `isPl ? "PL" : "EN"`. To nie jest i18n, tylko dwa
// równoległe zestawy literałów: bramka parytetu ich nie widzi, brakującego
// tłumaczenia nie da się wykryć testem, a trzeci język wymagałby przepisania
// każdego wyrażenia warunkowego. Audyt modułu społeczności nazwał to
// „i18n przez ręczne `isPl ? ... : ...` zamiast słownika".
//
// TEN PLIK ROŚNIE PO SEKCJI NA EKRAN. Namespace `adminCommunity.<ekran>`
// odwzorowuje trasy, więc konwersja idzie ekran po ekranie i każdy krok da się
// zrecenzować osobno - zamiast jednego commita na 250 podstawień.
//
// PRZY OKAZJI, w każdej konwertowanej sekcji:
//   * znaczniki BCP-47 do formatowania dat (`isPl ? "pl-PL" : "en-GB"`) idą
//     przez kanoniczny `lib/i18n/dateLocale`, nie przez kopię w komponencie -
//     to jedyne miejsce, gdzie język interfejsu zamienia się w region formatu;
//   * treść z bliźniaczych kolumn (`title_pl`/`title_en`) idzie przez
//     kanoniczny `pickLocalized`, więc puste tłumaczenie nie renderuje pustki;
//   * mapy etykiet enumów WSKAZUJĄ KLUCZE, nie napisy - `Record<Enum, string>`
//     wymusza kompletność wariantów, a test domyka drugą połowę kontraktu.
import i18n from "@/lib/i18n";

export const adminCommunityPl = {
  adminCommunity: {
    contributors: {
      saved: "Zapisano",
      failed: "Błąd",
      contributors: "Współtwórcy",
      allLanguages: "Wszystkie języki",
      all: "Wszystkie",
      loading: "Ładowanie...",
      noSubmissions: "Brak zgłoszeń",
      reviewed: "Zrecenzowano: ",
      editorNoteOptional: "Notatka redaktora (opcjonalnie)",
      approve: "Akceptuj",
      reject: "Odrzuć",
      note: "Notatka: ",
      statusPending: "Oczekujące",
      statusApproved: "Zaakceptowane",
      statusRejected: "Odrzucone",
    },

    badges: {
      granted: "Przyznano",
      failed: "Błąd",
      revoked: "Odebrano",
      badges: "Odznaki",
      grantBadge: "Przyznaj odznakę",
      manualAutomatic: "Ręcznie lub automatycznie",
      selectMember: "Wybierz członka…",
      searchByName: "Szukaj po nazwisku…",
      typeAtLeast2: "Wpisz min. 2 znaki",
      searching: "Szukam…",
      noResults: "Brak wyników",
      clearSelection: "Wyczyść wybór",
      noteOptional: "Notatka (opcjonalnie)",
      badgeNote: "Notatka do odznaki",
      selectedMemberAlreadyHas: "Wybrany użytkownik ma już tę odznakę.",
      grant: "Przyznaj",
      recentlyGranted: "Ostatnio przyznane",
      noBadges: "Brak odznak",
      revokeBadge: "Odbierz odznakę",
      revoke: "Odbierz",
      revokeConfirmTitle: "Odebrać odznakę?",
      revokeConfirmBody: "{{badge}} - tej operacji nie można cofnąć.",
      sourceManual: "Ręcznie",
      sourceReputation: "Reputacja",
      sourceContributorSubmission: "Przyjęty materiał",
      sourceSystem: "System",
    },

    engagement: {
      engagementConversion: "Zaangażowanie i konwersja",
      members: "Członkowie",
      total: "Wszyscy",
      new30d: "Nowi (30 dni)",
      active7d: "Aktywni (7 dni)",
      active30d: "Aktywni (30 dni)",
      subscriptionsTiers: "Subskrypcje i warstwy",
      activeSubscriptions: "Aktywne subskrypcje",
      noActivePaidSubscriptions: "Brak aktywnych subskrypcji płatnych.",
      reachChannelsOpt: "Kanały dotarcia (opt-in)",
      webPush: "Web push",
      emailDigest: "Digest e-mail",
      communityModulesPulse: "Puls modułów społeczności",
      upcomingEvents: "Nadch. wydarzenia",
      openQQuestions: "Otwarte pytania Q&A",
      pollVotes30d: "Głosy (30 dni)",
      pendingPitches: "Zgł. czekające",
      trackerFollows: "Obserwacje trackera",
      nextEvents: "Najbliższe wydarzenia",
      noPublishedUpcomingEvents: "Brak opublikowanych nadchodzących wydarzeń.",
      going: "będzie",
      info: "Informacje",
      dataFromGetEngagement:
        "Dane z get_engagement_overview(): jeden odczyt agreguje aktywność (wiadomości, komentarze, RSVP, głosy, Q&A, obserwacje), lejek subskrypcji i puls modułów. Dla pełnej analityki (kohorty, retencja, funnel) użyj paneli CRM i Analytics.",
      rsvpsGoing: "RSVP „będę”",
    },
  },
};

// Bez `: typeof adminCommunityPl`: sekcje z liczbą mnogą mają w polskim więcej
// form niż w angielskim, więc struktury nie są identyczne w typie. Parytet
// pilnuje test, który normalizuje sufiksy liczby mnogiej przed porównaniem.
export const adminCommunityEn = {
  adminCommunity: {
    contributors: {
      saved: "Saved",
      failed: "Failed",
      contributors: "Contributors",
      allLanguages: "All languages",
      all: "All",
      loading: "Loading...",
      noSubmissions: "No submissions",
      reviewed: "Reviewed: ",
      editorNoteOptional: "Editor note (optional)",
      approve: "Approve",
      reject: "Reject",
      note: "Note: ",
      statusPending: "Pending",
      statusApproved: "Approved",
      statusRejected: "Rejected",
    },

    badges: {
      granted: "Granted",
      failed: "Failed",
      revoked: "Revoked",
      badges: "Badges",
      grantBadge: "Grant badge",
      manualAutomatic: "Manual or automatic",
      selectMember: "Select a member…",
      searchByName: "Search by name…",
      typeAtLeast2: "Type at least 2 characters",
      searching: "Searching…",
      noResults: "No results",
      clearSelection: "Clear selection",
      noteOptional: "Note (optional)",
      badgeNote: "Badge note",
      selectedMemberAlreadyHas: "The selected member already has this badge.",
      grant: "Grant",
      recentlyGranted: "Recently granted",
      noBadges: "No badges",
      revokeBadge: "Revoke badge",
      revoke: "Revoke",
      revokeConfirmTitle: "Revoke badge?",
      revokeConfirmBody: "{{badge}} - this cannot be undone.",
      sourceManual: "Manual",
      sourceReputation: "Reputation",
      sourceContributorSubmission: "Accepted submission",
      sourceSystem: "System",
    },

    engagement: {
      engagementConversion: "Engagement and conversion",
      members: "Members",
      total: "Total",
      new30d: "New (30d)",
      active7d: "Active (7d)",
      active30d: "Active (30d)",
      subscriptionsTiers: "Subscriptions and tiers",
      activeSubscriptions: "Active subscriptions",
      noActivePaidSubscriptions: "No active paid subscriptions.",
      reachChannelsOpt: "Reach channels (opt-in)",
      webPush: "Web push",
      emailDigest: "Email digest",
      communityModulesPulse: "Community modules pulse",
      upcomingEvents: "Upcoming events",
      openQQuestions: "Open Q&A questions",
      pollVotes30d: "Poll votes (30d)",
      pendingPitches: "Pending pitches",
      trackerFollows: "Tracker follows",
      nextEvents: "Next events",
      noPublishedUpcomingEvents: "No published upcoming events.",
      going: "going",
      info: "Info",
      dataFromGetEngagement:
        "Data from get_engagement_overview(): a single read aggregates activity (messages, comments, RSVPs, votes, Q&A, follows), the subscription funnel and module pulse. For full analytics (cohorts, retention, funnel) use the CRM and Analytics panels.",
      rsvpsGoing: 'RSVPs "going"',
    },
  },
};

i18n.addResourceBundle("pl", "translation", adminCommunityPl, true, true);
i18n.addResourceBundle("en", "translation", adminCommunityEn, true, true);

/**
 * No-op wołany w komponencie trasy zamiast side-effectowego importu modułu.
 * Nazwane wiązanie pozwala splitterowi TanStacka przenieść cały bundle
 * tłumaczeń do chunka trasy - side-effectowy import w pliku trasy lądował
 * w eager-owym grafie wejściowym każdej strony. Rejestracja dzieje się przy
 * ewaluacji modułu (przed renderem komponentu), dokładnie jak wcześniej.
 */
export function ensureI18n(): void {}
