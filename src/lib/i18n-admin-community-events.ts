// Słownik panelu wydarzeń społeczności (/admin/community/events), PL/EN.
//
// STAN ZASTANY. Trasa i panel prelegentów nie miały słownika w ogóle - sto
// napisów przechodziło przez ręczne `isPl ? "..." : "..."`, a `isPl` było
// przekazywane w dół jako props (trasa -> EventSpeakersManager ->
// SpeakerProfileAdminDialog). To nie jest i18n, tylko dwa równoległe zestawy
// literałów: bramka parytetu ich nie widzi, brakującego tłumaczenia nie da się
// wykryć testem, a trzeci język wymagałby przepisania każdego wyrażenia
// warunkowego. Audyt modułu wydarzeń nazwał to „i18n przez ręczne
// `isPl ? ... : ...` zamiast słownika (cały plik)".
//
// TERAZ. Jedno drzewo kluczy dla całej powierzchni - trasy i komponentu
// prelegentów - plus dwie mapy etykiet enumów (rodzaj i status wydarzenia)
// trzymane przy typach w `lib/admin/community.ts`. `isPl` znika z propsów:
// komponent bierze `t()` z `useTranslation()`, więc nie da się zapomnieć
// przekazać języka w nowym miejscu montowania.
//
// PRZY OKAZJI. Plakietki na liście pokazywały surowe wartości kolumn
// (`draft`, `in_person`) w obu językach - teraz idą przez te same klucze co
// filtr i selekt, więc jedna zmiana etykiety obsługuje wszystkie trzy miejsca.
import i18n from "@/lib/i18n";

export const adminCommunityEventsPl = {
  adminCommunityEvents: {
    title: "Wydarzenia",
    subtitle: "Zarządzaj webinarami, briefingami i innymi wydarzeniami.",
    searchPlaceholder: "Szukaj…",
    remindersAction: "Przypomnienia",
    newAction: "Nowe",
    loading: "Ładowanie…",
    empty: "Brak wydarzeń.",
    membersOnlyBadge: "członkowie",
    filterAll: "Wszystkie",

    status: {
      draft: "Robocze",
      published: "Opublikowane",
      cancelled: "Anulowane",
    },
    kinds: {
      webinar: "Webinar",
      briefing: "Briefing",
      roundtable: "Okrągły stół",
      ama: "Pytania i odpowiedzi",
      in_person: "Na miejscu",
      hybrid: "Hybrydowe",
    },
    visibility: {
      public: "Publiczne",
      members: "Tylko członkowie",
    },

    actions: {
      publish: "Opublikuj",
      cancelEvent: "Anuluj wydarzenie",
      deleteEvent: "Usuń wydarzenie",
    },

    fields: {
      titlePl: "Tytuł PL",
      titleEn: "Tytuł EN",
      descriptionPl: "Opis PL",
      descriptionEn: "Opis EN",
      startsAt: "Start",
      kind: "Rodzaj",
      visibility: "Widoczność",
      capacity: "Pojemność",
      rsvpOpensAt: "Otwarcie rejestracji",
      rsvpOpensAtHint: "Pusto = rejestracja od publikacji.",
      earlyRsvpRank: "Ranga wcześniejszego dostępu (np. 10 = członek)",
      earlyRsvpRankHint: "Warstwy o tej randze i wyższej rejestrują się przed otwarciem.",
      ticketPrice: "Cena biletu",
      ticketPriceHint: "Pusto lub 0 = wydarzenie bezpłatne (samo RSVP).",
      ticketCurrency: "Waluta biletu",
    },

    createTitle: "Nowe wydarzenie",
    createAction: "Utwórz",
    editTitle: "Edycja wydarzenia",
    deleteTitle: "Usunąć wydarzenie?",

    toasts: {
      updated: "Zaktualizowano",
      updateFailed: "Błąd zapisu",
      deleted: "Usunięto",
      failed: "Błąd",
      created: "Utworzono",
      saved: "Zapisano",
      // Liczba mnoga przez mechanizm i18next, nie jedna forma dla wszystkiego:
      // poprzednio komunikat brzmiał „Wysłano 1 przypomnień" dla każdej liczby.
      // Polski ma trzy formy istotne dla liczebników (1 / 2-4 / 5+), angielski
      // dwie - dlatego EN nie powtarza `_few`/`_many` (i18next ich nie użyje).
      remindersSent_one: "Wysłano {{count}} przypomnienie",
      remindersSent_few: "Wysłano {{count}} przypomnienia",
      remindersSent_many: "Wysłano {{count}} przypomnień",
      remindersSent_other: "Wysłano {{count}} przypomnień",
    },

    speakers: {
      label: "Prelegenci",
      empty: "Brak prelegentów. Dodani prelegenci pojawią się na stronie wydarzenia i w widgetach.",
      moveUp: "Wyżej",
      moveDown: "Niżej",
      openProfile: "Profil prelegenta",
      removeFromEvent: "Usuń z wydarzenia",
      picker: {
        placeholder: "Dodaj prelegenta…",
        search: "Szukaj po nazwie lub wklej UUID",
        hint: "Wpisz min. 2 znaki.",
        loading: "Szukanie…",
        empty: "Brak wyników.",
        clear: "Wyczyść",
      },
      toasts: {
        addFailed: "Nie udało się dodać prelegenta",
        removeFailed: "Błąd usuwania",
        reorderFailed: "Błąd zmiany kolejności",
      },
      profile: {
        title: "Profil prelegenta: {{name}}",
        loading: "Ładowanie…",
        headlinePl: "Rola sceniczna PL",
        headlineEn: "Rola sceniczna EN",
        bioPl: "Bio prelegenta PL",
        bioEn: "Bio prelegenta EN",
        topicsPl: "Tematy PL (po przecinku)",
        topicsEn: "Tematy EN (po przecinku)",
        languages: "Języki",
        talks: "Wystąpienia",
        rating: "Ocena (0-5)",
        reviews: "Opinie",
        isPublic: "Profil publiczny",
        syncCrm: "Synchronizuj z CRM (lead 'speaker')",
        crmLead: "Powiązany lead CRM:",
        deleteConfirm: "Usunąć profil prelegenta? Wpisy event_speakers i lead CRM pozostaną.",
        deleteAction: "Usuń profil",
        saveAction: "Zapisz profil",
        savedWithCrm: "Zapisano profil i zsynchronizowano z CRM",
        saved: "Zapisano profil prelegenta",
        deleted: "Usunięto profil prelegenta",
      },
    },

    common: {
      cancel: "Anuluj",
      delete: "Usuń",
      save: "Zapisz",
      close: "Zamknij",
    },
  },
};

// Bez `: typeof adminCommunityEventsPl` - rodzina liczby mnogiej ma w polskim
// więcej form niż w angielskim, więc struktury NIE są identyczne w typie.
// Parytet pilnuje test, który (jak bramka rdzenia locale) normalizuje sufiksy
// liczby mnogiej przed porównaniem zbiorów kluczy.
export const adminCommunityEventsEn = {
  adminCommunityEvents: {
    title: "Events",
    subtitle: "Manage webinars, briefings and other events.",
    searchPlaceholder: "Search…",
    remindersAction: "Reminders",
    newAction: "New",
    loading: "Loading…",
    empty: "No events.",
    membersOnlyBadge: "members",
    filterAll: "All",

    status: {
      draft: "Drafts",
      published: "Published",
      cancelled: "Cancelled",
    },
    kinds: {
      webinar: "Webinar",
      briefing: "Briefing",
      roundtable: "Roundtable",
      ama: "Ask me anything",
      in_person: "In person",
      hybrid: "Hybrid",
    },
    visibility: {
      public: "Public",
      members: "Members only",
    },

    actions: {
      publish: "Publish",
      cancelEvent: "Cancel event",
      deleteEvent: "Delete event",
    },

    fields: {
      titlePl: "Title PL",
      titleEn: "Title EN",
      descriptionPl: "Description PL",
      descriptionEn: "Description EN",
      startsAt: "Starts at",
      kind: "Kind",
      visibility: "Visibility",
      capacity: "Capacity",
      rsvpOpensAt: "Registration opens",
      rsvpOpensAtHint: "Empty = registration open from publish.",
      earlyRsvpRank: "Early-access tier rank (e.g. 10 = member)",
      earlyRsvpRankHint: "Tiers at this rank and above can register before opening.",
      ticketPrice: "Ticket price",
      ticketPriceHint: "Empty or 0 = free event (RSVP only).",
      ticketCurrency: "Ticket currency",
    },

    createTitle: "New event",
    createAction: "Create",
    editTitle: "Edit event",
    deleteTitle: "Delete event?",

    toasts: {
      updated: "Updated",
      updateFailed: "Update failed",
      deleted: "Deleted",
      failed: "Failed",
      created: "Created",
      saved: "Saved",
      remindersSent_one: "Sent {{count}} reminder",
      remindersSent_other: "Sent {{count}} reminders",
    },

    speakers: {
      label: "Speakers",
      empty: "No speakers yet. Added speakers appear on the event page and in widgets.",
      moveUp: "Move up",
      moveDown: "Move down",
      openProfile: "Speaker profile",
      removeFromEvent: "Remove from event",
      picker: {
        placeholder: "Add a speaker…",
        search: "Search by name or paste a UUID",
        hint: "Type at least 2 characters.",
        loading: "Searching…",
        empty: "No results.",
        clear: "Clear",
      },
      toasts: {
        addFailed: "Failed to add speaker",
        removeFailed: "Remove failed",
        reorderFailed: "Reorder failed",
      },
      profile: {
        title: "Speaker profile: {{name}}",
        loading: "Loading…",
        headlinePl: "Stage headline PL",
        headlineEn: "Stage headline EN",
        bioPl: "Speaker bio PL",
        bioEn: "Speaker bio EN",
        topicsPl: "Topics PL (comma separated)",
        topicsEn: "Topics EN (comma separated)",
        languages: "Languages",
        talks: "Talks",
        rating: "Rating (0-5)",
        reviews: "Reviews",
        isPublic: "Public profile",
        syncCrm: "Sync to CRM ('speaker' lead)",
        crmLead: "Linked CRM lead:",
        deleteConfirm: "Delete the speaker profile? event_speakers rows and the CRM lead remain.",
        deleteAction: "Delete profile",
        saveAction: "Save profile",
        savedWithCrm: "Profile saved and synced to CRM",
        saved: "Speaker profile saved",
        deleted: "Speaker profile deleted",
      },
    },

    common: {
      cancel: "Cancel",
      delete: "Delete",
      save: "Save",
      close: "Close",
    },
  },
};

i18n.addResourceBundle("pl", "translation", adminCommunityEventsPl, true, true);
i18n.addResourceBundle("en", "translation", adminCommunityEventsEn, true, true);

/**
 * No-op wołany w komponencie trasy zamiast side-effectowego importu modułu.
 * Nazwane wiązanie pozwala splitterowi TanStacka przenieść cały bundle
 * tłumaczeń do chunka trasy - side-effectowy import w pliku trasy lądował
 * w eager-owym grafie wejściowym każdej strony. Rejestracja dzieje się przy
 * ewaluacji modułu (przed renderem komponentu), dokładnie jak wcześniej.
 */
export function ensureI18n(): void {}
