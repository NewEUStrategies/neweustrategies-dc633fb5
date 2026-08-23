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
