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
      newAction: "Nowy prelegent",
      // Prelegent bez konta to NORMA, nie wyjątek: w danych referencyjnych
      // wzorca 21 z 21 osób w grupie „Speakers" nie ma konta na platformie.
      noAccount: "Bez konta",
      accountBadge: "Konto platformy",
      legacyBadge: "Stary rejestr",
      loadFailed: "Nie udało się wczytać listy prelegentów.",
      retry: "Spróbuj ponownie",
      // Trzeci, cichy warunek widoczności: get_public_speakers i
      // event_speakers_public filtrują po status = 'published'. Bez tego zdania
      // redaktor dodaje pięciu prelegentów i uznaje, że funkcja nie działa.
      draftNotice:
        "Wydarzenie jest szkicem, więc lista prelegentów nie jest widoczna publicznie. Pokaże się na stronie wydarzenia po publikacji.",
      pickerLabel: "Dodaj osobę, która MA konto na platformie",
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
        created: "Dodano prelegenta: {{name}}",
      },
      create: {
        title: "Nowy prelegent",
        subtitle:
          "Zakładamy wpis osoby, która NIE MA konta na platformie. Konta nie tworzymy, więc ta osoba nie dostanie żadnej wiadomości.",
        sectionPerson: "Osoba",
        sectionCard: "Karta na stronie wydarzenia",
        sectionContact: "Kontakt redakcyjny",
        requiredHint: "Gwiazdka oznacza pole wymagane.",
        group: "Grupa uczestników",
        groupPlaceholder: "Bez grupy",
        groupHint:
          "Opcjonalnie. Grupa niesie uprawnienia (kto widzi listę uczestników, kto może prosić o spotkanie), a nie samą rolę prelegenta.",
        groupLoading: "Wczytywanie grup…",
        email: "Adres poczty",
        emailPlaceholder: "imie.nazwisko@instytucja.pl",
        emailHint:
          "Klucz tożsamości w kartotece. Jeśli ta osoba już tam jest, wpis zostanie uzupełniony, a nie zdublowany.",
        firstName: "Imię",
        firstNamePlaceholder: "Wpisz imię",
        lastName: "Nazwisko",
        lastNamePlaceholder: "Wpisz nazwisko",
        jobTitle: "Stanowisko",
        jobTitlePlaceholder: "Wpisz stanowisko",
        company: "Instytucja",
        companyPlaceholder: "Wpisz nazwę instytucji",
        photoUrl: "Zdjęcie (adres)",
        photoUrlPlaceholder: "https://…",
        photoUrlHint: "Wymagany adres https, bo zdjęcie jedzie na stronę publiczną.",
        photoUpload: "Wgraj zdjęcie",
        photoUploading: "Wgrywanie…",
        photoRemove: "Usuń zdjęcie",
        photoFailed: "Nie udało się wgrać zdjęcia.",
        photoAlt: "Podgląd zdjęcia prelegenta",
        photoReplace: "Podmień zdjęcie",
        photoDropHint:
          "Przeciągnij i upuść plik na kafel albo wgraj z dysku - podgląd zobaczysz przed zapisem. Możesz też podać adres https.",


        headlinePl: "Rola sceniczna PL",
        headlineEn: "Rola sceniczna EN",
        headlineHint: "Druga linia karty prelegenta. Puste pole zostawia stanowisko.",
        bioPl: "Bio PL",
        bioEn: "Bio EN",
        topicsPl: "Tematy PL",
        topicsEn: "Tematy EN",
        topicsHint: "Po przecinku. Chipy na profilu prelegenta.",
        languages: "Języki",
        languagesPlaceholder: "pl, en",
        phone: "Telefon",
        phonePlaceholder: "+48 …",
        socialUrl: "Profil zawodowy (adres)",
        socialUrlPlaceholder: "https://www.linkedin.com/in/…",
        contactHint: "Telefon i adres poczty zostają w panelu. Nie ma ich na stronie publicznej.",
        isPublic: "Pokaż opis sceniczny na karcie",
        // Etykieta NIE brzmi „profil publiczny", bo `is_public` nie ukrywa
        // osoby: projekcja bierze nazwisko i zdjęcie bez tego warunku,
        // a wyłącza tylko rolę sceniczną, bio i tematy.
        isPublicHint:
          "Wyłączenie zostawia na karcie nazwisko, zdjęcie i stanowisko, a ukrywa rolę sceniczną oraz bio.",
        consentNote:
          "Wpis zakłada organizator: zapisujemy podstawę przetwarzania danych na potrzeby wystąpienia. Zgód marketingowych ten formularz NIE zbiera, bo organizator nie może ich udzielić za kogoś.",
        submit: "Utwórz prelegenta",
        submitting: "Zapisywanie…",
        failed: "Nie udało się utworzyć prelegenta",
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
      newAction: "New speaker",
      noAccount: "No account",
      accountBadge: "Platform account",
      legacyBadge: "Legacy registry",
      loadFailed: "Could not load the speaker list.",
      retry: "Try again",
      draftNotice:
        "This event is a draft, so the speaker list is not visible publicly. It appears on the event page once the event is published.",
      pickerLabel: "Add someone who HAS a platform account",
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
        created: "Speaker added: {{name}}",
      },
      create: {
        title: "New speaker",
        subtitle:
          "This creates a record for someone who does NOT have a platform account. No account is created, so this person receives no message.",
        sectionPerson: "Person",
        sectionCard: "Card on the event page",
        sectionContact: "Internal contact",
        requiredHint: "An asterisk marks a required field.",
        group: "Attendee group",
        groupPlaceholder: "No group",
        groupHint:
          "Optional. A group carries permissions (who sees the attendee list, who may request a meeting), not the speaker role itself.",
        groupLoading: "Loading groups…",
        email: "Email address",
        emailPlaceholder: "first.last@institution.com",
        emailHint:
          "The identity key in the people registry. If this person is already there, the record is completed rather than duplicated.",
        firstName: "First name",
        firstNamePlaceholder: "Add a first name",
        lastName: "Last name",
        lastNamePlaceholder: "Add a last name",
        jobTitle: "Job title",
        jobTitlePlaceholder: "Add a job title",
        company: "Organisation",
        companyPlaceholder: "Add an organisation",
        photoUrl: "Photo (URL)",
        photoUrlPlaceholder: "https://…",
        photoUrlHint: "https is required, because the photo goes to the public page.",
        photoUpload: "Upload photo",
        photoUploading: "Uploading…",
        photoRemove: "Remove photo",
        photoFailed: "The photo could not be uploaded.",
        photoAlt: "Speaker photo preview",

        headlinePl: "Stage headline PL",
        headlineEn: "Stage headline EN",
        headlineHint: "The second line of the speaker card. Left empty, the job title stays.",
        bioPl: "Bio PL",
        bioEn: "Bio EN",
        topicsPl: "Topics PL",
        topicsEn: "Topics EN",
        topicsHint: "Comma separated. Chips on the speaker profile.",
        languages: "Languages",
        languagesPlaceholder: "pl, en",
        phone: "Phone",
        phonePlaceholder: "+48 …",
        socialUrl: "Professional profile (URL)",
        socialUrlPlaceholder: "https://www.linkedin.com/in/…",
        contactHint: "Phone and email stay in the admin panel. They are not on the public page.",
        isPublic: "Show the stage description on the card",
        isPublicHint:
          "Turning this off keeps the name, photo and job title on the card, and hides the stage headline and bio.",
        consentNote:
          "The organiser creates this record: we store the lawful basis for processing the data for the purpose of this appearance. This form does NOT collect marketing consents, because an organiser cannot give them on someone else's behalf.",
        submit: "Create speaker",
        submitting: "Saving…",
        failed: "Could not create the speaker",
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
