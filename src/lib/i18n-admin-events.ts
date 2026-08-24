// Słownik modułu Wydarzeń w panelu (/admin/events), PL/EN.
//
// DLACZEGO OSOBNY PLIK, A NIE ROZSZERZENIE `i18n-admin-community-events`.
// Tamten slownik opisuje ISTNIEJACY ekran listy wydarzen w sekcji spolecznosci
// (`/admin/community/events`) i jest z nim zwiazany trescia: mowi o kaflach,
// dialogu edycji i prelegentach tamtej trasy. Modul Wydarzen jest osobna sekcja
// panelu z wlasna podnawigacja i wlasnym cyklem zycia, wiec dostaje wlasna
// nakladke - inaczej pierwszy ekran, ktory chce ladowac tylko czesc slownika,
// nie ma jak tego zrobic (nakladki sa niepodzielne).
//
// KLUCZE ENUMOW SA WSPOLDZIELONE Z DOMENA. `adminEvents.formats.*`,
// `registrationModes.*`, `registrationFlows.*` i `guestModes.*` sa wskazywane
// przez mapy `Record<Enum, string>` z `lib/events/eventTypes.ts`. Typ wymusza
// pokrycie kazdego wariantu po stronie kodu, a test parytetu domyka kontrakt
// z drugiej strony - ze wskazany klucz naprawde istnieje w PL i EN.
//
// TEKST MOWI, CO SIE STANIE, A NIE CO KLIKNAC. "Przepnij wydarzenia na inny
// rodzaj" zamiast "Przepnij", "Usuniecie jest zablokowane, bo 12 wydarzen uzywa
// tego rodzaju" zamiast "Nie mozna usunac" - komunikat bez powodu zmusza
// redaktora do zgadywania, a zgadywanie konczy sie drugim rodzajem o tej samej
// nazwie.
import i18n from "@/lib/i18n";

export const adminEventsPl = {
  adminEvents: {
    nav: {
      sectionTitle: "Wydarzenia",
      sectionsNavLabel: "Sekcje modułu wydarzeń",
      overview: "Pulpit",
      list: "Lista",
      types: "Rodzaje",
      speakers: "Prelegenci",
    },

    formats: {
      onsite: "Na miejscu",
      // Zapożyczenie, którym zespół posługuje się tak samo po polsku - ten sam
      // zabieg co `admin.nav.cookieBanner` w obu słownikach. Raport parytetu
      // liczy je jako „nieprzetłumaczone" i to jest poprawny odczyt: napis JEST
      // identyczny, tylko celowo.
      online: "Online",
      hybrid: "Hybrydowe",
    },
    registrationModes: {
      rsvp: "Zapis jednym kliknięciem",
      form: "Formularz zgłoszenia",
      external: "Rejestracja zewnętrzna",
      none: "Bez zapisów",
    },
    registrationFlows: {
      instant: "Natychmiastowy",
      approval: "Wymaga akceptacji",
    },
    guestModes: {
      hidden: "Ukryte dla niezapisanych",
      teaser: "Opis i agenda",
      full: "Pełna treść bez kontaktów",
    },

    list: {
      title: "Wydarzenia",
      subtitle:
        "Wszystkie wydarzenia organizacji. Nowe wydarzenie startuje z ustawieniami swojego rodzaju.",
      createAction: "Nowe wydarzenie",
      searchPlaceholder: "Szukaj po tytule, adresie albo miejscu",
      loading: "Wczytywanie wydarzeń…",
      empty: "Nie ma jeszcze żadnego wydarzenia. Dodaj pierwsze, żeby zobaczyć je na liście.",
      emptyFiltered: "Żadne wydarzenie nie pasuje do tych filtrów.",
      adminOnly: "Lista wydarzeń jest dostępna dla administratora i redaktora organizacji.",
      clearFilters: "Wyczyść filtry",

      tabs: {
        all: "Wszystkie",
        draft: "Szkice",
        published: "Opublikowane",
        upcoming: "Nadchodzące",
        past: "Minione",
        cancelled: "Odwołane",
      },

      filters: {
        typeLabel: "Rodzaj",
        typeAll: "Wszystkie rodzaje",
        formatLabel: "Format",
        formatAll: "Wszystkie formaty",
      },

      range: "{{from}}-{{to}} z {{total}}",
      prevPage: "Poprzednia strona",
      nextPage: "Następna strona",

      row: {
        noType: "Bez rodzaju",
        going: "Zapisani: {{count}}",
        interested: "Zainteresowani: {{count}}",
        waitlist: "Lista rezerwowa: {{count}}",
        seatsLeft: "Wolne miejsca: {{count}}",
        noCapacity: "Bez limitu miejsc",
        speakers: "Prelegenci: {{count}}",
        stream: "Transmisja",
        recording: "Nagranie",
        chathamHouse: "Chatham House",
        membersOnly: "Tylko członkowie",
        editAction: "Edytuj wydarzenie {{title}}",
        openPublicAction: "Otwórz stronę wydarzenia {{title}}",
        noDate: "Bez terminu",
      },

      status: {
        draft: "Szkic",
        published: "Opublikowane",
        cancelled: "Odwołane",
      },

      create: {
        title: "Nowe wydarzenie",
        description:
          "Podaj tytuł, termin i rodzaj. Format, tryb rejestracji, limit miejsc i próg członkostwa przepisze rodzaj - zmienisz je później w ustawieniach wydarzenia.",
        typeLabel: "Rodzaj wydarzenia",
        typeHint: "Widoczne są tylko rodzaje aktywne w tej organizacji.",
        titlePlLabel: "Tytuł PL",
        titleEnLabel: "Tytuł EN",
        startsAtLabel: "Początek",
        startsAtHint: "Koniec wyliczy się z czasu trwania rodzaju, jeśli rodzaj go zna.",
        externalUrlLabel: "Adres zapisów w systemie zewnętrznym",
        externalUrlHint:
          "Ten rodzaj prowadzi zapisy poza serwisem, więc adres jest wymagany - uczestnik zostanie do niego przekierowany zamiast zapisywać się u nas.",
        submitAction: "Utwórz szkic",
        cancelAction: "Anuluj",
        errors: {
          titles: "Tytuł jest wymagany w obu językach.",
          startsAt: "Termin początku jest wymagany.",
          type: "Wybierz rodzaj wydarzenia.",
          typeInactive: "Ten rodzaj jest wyłączony w organizacji.",
          notFound: "Rodzaj nie istnieje w tej organizacji.",
          externalUrl: "Podaj adres zapisów - ten rodzaj prowadzi je w systemie zewnętrznym.",
          externalUrlInvalid: "Adres musi zaczynać się od https:// i nie może zawierać spacji.",
          noTypes:
            "Nie ma żadnego aktywnego rodzaju wydarzenia. Dodaj rodzaj w katalogu, zanim utworzysz wydarzenie.",
        },
      },

      toasts: {
        created: "Szkic wydarzenia utworzony",
      },
    },

    types: {
      title: "Rodzaje wydarzeń",
      subtitle:
        "Katalog wspólny dla całej organizacji. Rodzaj decyduje o tym, co widzi redaktor w kreatorze i jakie ustawienia dostaje nowe wydarzenie.",
      addAction: "Nowy rodzaj",
      summary: "Aktywne: {{active}} z {{total}}",
      loading: "Wczytywanie katalogu…",
      empty: "Nie ma jeszcze żadnego rodzaju. Dodaj pierwszy, żeby kreator miał z czego wybierać.",
      adminOnly:
        "Katalog rodzajów wydarzeń jest dostępny wyłącznie dla administratora organizacji.",
      systemBadge: "systemowy",
      disabledBadge: "wyłączony",
      usageNone: "Nieużywany",
      usageDraftsOnly: "{{total}} w szkicach",
      usageMixed: "{{total}} wydarzeń ({{published}} opublikowanych)",
      toggleLabel: "Włącz albo wyłącz rodzaj {{name}}",
      editLabel: "Edytuj rodzaj {{name}}",
      deleteLabel: "Usuń rodzaj {{name}}",
      reassignLabel: "Przepnij wydarzenia z rodzaju {{name}}",
      deleteBlockedSystem: "Rodzaju systemowego nie da się usunąć.",
      deleteBlockedInUse: "Najpierw przepnij {{total}} wydarzeń na inny rodzaj.",

      dialog: {
        createTitle: "Nowy rodzaj wydarzenia",
        editTitle: "Rodzaj wydarzenia",
        description:
          "Nazwa jest wymagana w obu językach. Ustawienia domyślne trafiają do nowego wydarzenia i redaktor może je tam zmienić.",
        sectionIdentity: "Nazwa i klucz",
        sectionDefaults: "Ustawienia domyślne nowego wydarzenia",
        sectionAccess: "Dostęp i widoczność",
        sectionCatalog: "Katalog",
        keyLabel: "Klucz techniczny (a-z, 0-9, _)",
        keyHint: "Klucz jest niezmienny po zapisie - używają go istniejące wydarzenia.",
        namePlLabel: "Nazwa PL",
        nameEnLabel: "Nazwa EN",
        descriptionPlLabel: "Opis PL",
        descriptionEnLabel: "Opis EN",
        descriptionHint: "Opis widzi redaktor w kreatorze, nie uczestnik.",
        iconLabel: "Ikona",
        accentColorLabel: "Kolor akcentu (#rrggbb)",
        accentColorHint: "Pusty = rodzaj dziedziczy kolor marki serwisu.",
        // Zapożyczenie jak `formats.online` wyżej - identyczne w obu językach.
        formatLabel: "Format",
        registrationModeLabel: "Tryb rejestracji",
        registrationFlowLabel: "Przepływ zgłoszenia",
        guestModeLabel: "Co widzi osoba niezapisana",
        capacityLabel: "Limit miejsc",
        capacityHint: "Pusty = bez limitu.",
        durationLabel: "Czas trwania (minuty)",
        durationHint: "Od 5 do 10080 minut. Pusty = bez sugestii.",
        minTierRankLabel: "Minimalna ranga członkostwa",
        chathamHouseLabel: "Zasada Chatham House",
        chathamHouseHint: "Wypowiedzi bez przypisania do osoby; wymaga uprawnienia w planie.",
        requiresTicketLabel: "Wymaga biletu",
        sortOrderLabel: "Kolejność",
        isActiveLabel: "Aktywny w tej organizacji",
        saveAction: "Zapisz rodzaj",
        cancelAction: "Anuluj",
      },

      deleteDialog: {
        title: "Usunąć rodzaj wydarzenia?",
        body: "Rodzaj {{name}} zniknie z kreatora. Operacja jest nieodwracalna.",
        confirmAction: "Usuń rodzaj",
        cancelAction: "Anuluj",
      },

      reassignDialog: {
        title: "Przepnij wydarzenia na inny rodzaj",
        body: "Wszystkie wydarzenia rodzaju {{name}} dostaną nowy rodzaj. Wydarzeń do przepięcia: {{total}}.",
        targetLabel: "Nowy rodzaj",
        confirmAction: "Przepnij {{total}} wydarzeń",
        cancelAction: "Anuluj",
      },

      errors: {
        names: "Nazwa jest wymagana w obu językach (min. 2 znaki).",
        namesTooLong: "Nazwa może mieć najwyżej 80 znaków.",
        descriptionTooLong: "Opis może mieć najwyżej 500 znaków.",
        key: "Klucz musi zaczynać się od litery i zawierać tylko a-z, 0-9 oraz _.",
        duplicate: "Rodzaj o tym kluczu już istnieje w tej organizacji.",
        capacity: "Limit miejsc musi być liczbą większą od zera.",
        duration: "Czas trwania musi być liczbą od 5 do 10080 minut.",
        tierRank: "Ranga członkostwa nie może być ujemna.",
        accentColor: "Kolor akcentu musi być zapisem #rrggbb.",
        inUse: "Rodzaj jest używany przez wydarzenia - najpierw je przepnij.",
        system: "Rodzaju systemowego nie da się usunąć.",
        sameTarget: "Rodzaj źródłowy i docelowy muszą być różne.",
        notFound: "Rodzaj nie istnieje w tej organizacji.",
      },

      toasts: {
        saved: "Rodzaj wydarzenia zapisany",
        deleted: "Rodzaj wydarzenia usunięty",
        toggled: "Dostępność rodzaju zmieniona",
        reassigned: "Przepięto {{count}} wydarzeń",
      },
    },
  },
};

export const adminEventsEn = {
  adminEvents: {
    nav: {
      sectionTitle: "Events",
      sectionsNavLabel: "Event module sections",
      overview: "Dashboard",
      list: "List",
      types: "Types",
      speakers: "Speakers",
    },

    formats: {
      onsite: "On site",
      online: "Online",
      hybrid: "Hybrid",
    },
    registrationModes: {
      rsvp: "One-click sign-up",
      form: "Application form",
      external: "External registration",
      none: "No sign-ups",
    },
    registrationFlows: {
      instant: "Instant",
      approval: "Needs approval",
    },
    guestModes: {
      hidden: "Hidden from non-attendees",
      teaser: "Description and agenda",
      full: "Full content without contacts",
    },

    list: {
      title: "Events",
      subtitle:
        "Every event in the organisation. A new event starts with the settings of its type.",
      createAction: "New event",
      searchPlaceholder: "Search by title, slug or location",
      loading: "Loading events…",
      empty: "No event yet. Add the first one to see it on the list.",
      emptyFiltered: "No event matches these filters.",
      adminOnly: "The event list is available to organisation administrators and editors.",
      clearFilters: "Clear filters",

      tabs: {
        all: "All",
        draft: "Drafts",
        published: "Published",
        upcoming: "Upcoming",
        past: "Past",
        cancelled: "Cancelled",
      },

      filters: {
        typeLabel: "Type",
        typeAll: "All types",
        formatLabel: "Format",
        formatAll: "All formats",
      },

      range: "{{from}}-{{to}} of {{total}}",
      prevPage: "Previous page",
      nextPage: "Next page",

      row: {
        noType: "No type",
        going: "Going: {{count}}",
        interested: "Interested: {{count}}",
        waitlist: "Waiting list: {{count}}",
        seatsLeft: "Seats left: {{count}}",
        noCapacity: "No seat limit",
        speakers: "Speakers: {{count}}",
        stream: "Stream",
        recording: "Recording",
        chathamHouse: "Chatham House",
        membersOnly: "Members only",
        editAction: "Edit the {{title}} event",
        openPublicAction: "Open the public page of {{title}}",
        noDate: "No date",
      },

      status: {
        draft: "Draft",
        published: "Published",
        cancelled: "Cancelled",
      },

      create: {
        title: "New event",
        description:
          "Give a title, a date and a type. Format, registration mode, seat limit and membership threshold come from the type - you can change them later in the event settings.",
        typeLabel: "Event type",
        typeHint: "Only types active in this organisation are listed.",
        titlePlLabel: "Title PL",
        titleEnLabel: "Title EN",
        startsAtLabel: "Starts",
        startsAtHint: "The end time is derived from the type duration when the type knows one.",
        externalUrlLabel: "External registration url",
        externalUrlHint:
          "This type registers people outside the site, so the address is required - attendees are sent there instead of signing up here.",
        submitAction: "Create draft",
        cancelAction: "Cancel",
        errors: {
          titles: "The title is required in both languages.",
          startsAt: "A start date is required.",
          type: "Choose an event type.",
          typeInactive: "That type is disabled in this organisation.",
          notFound: "The type does not exist in this organisation.",
          externalUrl: "Give the registration address - this type registers people externally.",
          externalUrlInvalid: "The address must start with https:// and must not contain spaces.",
          noTypes:
            "There is no active event type. Add one in the catalogue before creating an event.",
        },
      },

      toasts: {
        created: "Event draft created",
      },
    },

    types: {
      title: "Event types",
      subtitle:
        "A catalogue shared across the organisation. The type decides what an editor sees in the creator and which settings a new event starts with.",
      addAction: "New type",
      summary: "Active: {{active}} of {{total}}",
      loading: "Loading catalogue…",
      empty: "No type yet. Add the first one so the creator has something to offer.",
      adminOnly: "The event type catalogue is available to organisation administrators only.",
      systemBadge: "system",
      disabledBadge: "disabled",
      usageNone: "Unused",
      usageDraftsOnly: "{{total}} in drafts",
      usageMixed: "{{total}} events ({{published}} published)",
      toggleLabel: "Enable or disable the {{name}} type",
      editLabel: "Edit the {{name}} type",
      deleteLabel: "Delete the {{name}} type",
      reassignLabel: "Move events off the {{name}} type",
      deleteBlockedSystem: "System types cannot be deleted.",
      deleteBlockedInUse: "Move {{total}} events to another type first.",

      dialog: {
        createTitle: "New event type",
        editTitle: "Event type",
        description:
          "The name is required in both languages. Defaults are copied into a new event, where the editor can still change them.",
        sectionIdentity: "Name and key",
        sectionDefaults: "Defaults for a new event",
        sectionAccess: "Access and visibility",
        sectionCatalog: "Catalogue",
        keyLabel: "Technical key (a-z, 0-9, _)",
        keyHint: "The key is frozen after saving - existing events rely on it.",
        namePlLabel: "Name PL",
        nameEnLabel: "Name EN",
        descriptionPlLabel: "Description PL",
        descriptionEnLabel: "Description EN",
        descriptionHint: "The description is for editors in the creator, not for attendees.",
        iconLabel: "Icon",
        accentColorLabel: "Accent colour (#rrggbb)",
        accentColorHint: "Empty means the type inherits the site brand colour.",
        formatLabel: "Format",
        registrationModeLabel: "Registration mode",
        registrationFlowLabel: "Application flow",
        guestModeLabel: "What a non-attendee sees",
        capacityLabel: "Seat limit",
        capacityHint: "Empty means no limit.",
        durationLabel: "Duration (minutes)",
        durationHint: "Between 5 and 10080 minutes. Empty means no suggestion.",
        minTierRankLabel: "Minimum membership rank",
        chathamHouseLabel: "Chatham House rule",
        chathamHouseHint: "Non-attributed remarks; requires the plan capability.",
        requiresTicketLabel: "Requires a ticket",
        sortOrderLabel: "Order",
        isActiveLabel: "Active in this organisation",
        saveAction: "Save type",
        cancelAction: "Cancel",
      },

      deleteDialog: {
        title: "Delete this event type?",
        body: "The {{name}} type disappears from the creator. This cannot be undone.",
        confirmAction: "Delete type",
        cancelAction: "Cancel",
      },

      reassignDialog: {
        title: "Move events to another type",
        body: "Every event of type {{name}} gets a new type. Events to move: {{total}}.",
        targetLabel: "New type",
        confirmAction: "Move {{total}} events",
        cancelAction: "Cancel",
      },

      errors: {
        names: "The name is required in both languages (at least 2 characters).",
        namesTooLong: "The name can be at most 80 characters.",
        descriptionTooLong: "The description can be at most 500 characters.",
        key: "The key must start with a letter and contain only a-z, 0-9 and _.",
        duplicate: "A type with this key already exists in this organisation.",
        capacity: "The seat limit must be a number greater than zero.",
        duration: "The duration must be a number between 5 and 10080 minutes.",
        tierRank: "The membership rank cannot be negative.",
        accentColor: "The accent colour must be written as #rrggbb.",
        inUse: "The type is used by events - move them first.",
        system: "System types cannot be deleted.",
        sameTarget: "The source and target types must differ.",
        notFound: "The type does not exist in this organisation.",
      },

      toasts: {
        saved: "Event type saved",
        deleted: "Event type deleted",
        toggled: "Type availability changed",
        reassigned: "Moved {{count}} events",
      },
    },
  },
};

i18n.addResourceBundle("pl", "translation", adminEventsPl, true, true);
i18n.addResourceBundle("en", "translation", adminEventsEn, true, true);

/**
 * No-op wolany w komponencie trasy zamiast side-effectowego importu modulu.
 * Nazwane wiazanie pozwala splitterowi TanStacka przeniesc caly bundle
 * tlumaczen do chunka trasy - side-effectowy import w pliku trasy landowal
 * w eager-owym grafie wejsciowym kazdej strony. Rejestracja dzieje sie przy
 * ewaluacji modulu (przed renderem komponentu), dokladnie jak wczesniej.
 */
export function ensureI18n(): void {}
