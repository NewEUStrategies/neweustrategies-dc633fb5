// Słownik podmodułu AGENDA (Event Builder), PL/EN.
//
// DLACZEGO OSOBNY PLIK. Nakładki i18n są niepodzielne, a agenda to cztery ekrany
// panelu (sesje, ścieżki, sale, kolizje) plus obsada prelegentów i zapisy na
// sesje. Trzymanie ich razem ze zgłoszeniami wciągałoby cały słownik zapisów na
// trasę, która nie pokazuje ani jednego zgłoszenia.
//
// KLUCZE STANÓW SĄ WSPÓLNE Z BAZĄ: trzy formaty, trzy stany sesji, cztery role
// prelegenta, trzy stany zapisu na sesję i cztery rodzaje kolizji z migracji
// `20260823140000_event_sessions.sql`. Jeśli baza zna cztery wartości, słownik
// zna cztery etykiety - inaczej organizator czyta `outside_event_window`.
//
// KOMUNIKAT BŁĘDU MÓWI, CO ZROBIĆ. `capacity_requires_signup` bez zdania o
// przełączniku zapisów zmusza do zgadywania, dlaczego limit miejsc nie chce się
// zapisać.
import i18n from "@/lib/i18n";

export const adminEventAgendaPl = {
  adminEventAgenda: {
    nav: {
      sectionTitle: "Agenda",
      sectionsNavLabel: "Sekcje agendy wydarzenia",
      sessions: "Sesje",
      tracks: "Ścieżki",
      rooms: "Sale",
      conflicts: "Kolizje",
    },

    formats: {
      onsite: "Na miejscu",
      online: "Online",
      hybrid: "Hybrydowo",
    },

    statuses: {
      draft: "Szkic",
      published: "Opublikowana",
      cancelled: "Odwołana",
    },

    roles: {
      speaker: "Prelegent",
      moderator: "Moderator",
      panelist: "Panelista",
      host: "Prowadzący",
    },

    signupStatuses: {
      registered: "Zapisany",
      waitlist: "Rezerwowa",
      cancelled: "Wycofany",
    },

    conflictKinds: {
      speaker_overlap: "Prelegent w dwóch sesjach o tej samej godzinie",
      outside_event_window: "Sesja poza oknem wydarzenia",
      capacity_over_room: "Limit miejsc ponad pojemność sali",
      overbooked: "Zapisy ponad limit miejsc",
    },

    sessions: {
      title: "Sesje",
      subtitle:
        "Program wydarzenia. Sesja opublikowana jest widoczna publicznie; szkic widzi tylko organizacja.",
      loading: "Wczytywanie sesji…",
      empty: "Program jest pusty. Dodaj pierwszą sesję.",
      emptyFiltered: "Żadna sesja nie pasuje do tych filtrów.",
      addAction: "Dodaj sesję",
      searchPlaceholder: "Szukaj po tytule sesji",
      allTracks: "Wszystkie ścieżki",
      allRooms: "Wszystkie sale",
      allStatuses: "Wszystkie stany",
      noTrack: "Bez ścieżki",
      noRoom: "Bez sali",
      seats: "{{left}} z {{capacity}} miejsc",
      seatsUnlimited: "Bez limitu miejsc",
      signupsOff: "Bez zapisów",
      speakersCount: "Prelegenci: {{count}}",
      childrenCount: "Podsesje: {{count}}",
      chathamHouse: "Reguła Chatham House",
      isPrivate: "Niepubliczna",
      publishAction: "Opublikuj",
      unpublishAction: "Wróć do szkicu",
      cancelAction: "Odwołaj sesję",
      deleteConfirm:
        "Usunąć sesję? Sesja z aktywnymi zapisami nie zostanie usunięta - odwołaj ją zamiast usuwać.",
      toasts: {
        saved: "Sesja zapisana",
        deleted: "Sesja usunięta",
        statusChanged: "Zmieniono stan {{count}} sesji",
        reordered: "Kolejność zapisana",
        speakersSaved: "Obsada zapisana",
      },
    },

    sessionDialog: {
      createTitle: "Nowa sesja",
      editTitle: "Edycja sesji",
      titlePl: "Tytuł (PL)",
      titleEn: "Tytuł (EN)",
      descriptionPl: "Opis (PL)",
      descriptionEn: "Opis (EN)",
      startsAt: "Początek",
      endsAt: "Koniec",
      timeZoneHint: "Godziny podajesz w strefie wydarzenia: {{zone}}",
      format: "Forma udziału",
      status: "Stan",
      track: "Ścieżka",
      room: "Sala",
      parentSession: "Sesja nadrzędna",
      parentSessionHint: "Podsesja należy do jednej sesji - drzewo ma tylko dwa poziomy.",
      requiresSignup: "Zapisy na sesję",
      capacity: "Limit miejsc",
      capacityHint: "Puste pole znaczy brak limitu. Limit wymaga włączonych zapisów.",
      minTierRank: "Minimalna warstwa członkostwa",
      chathamHouse: "Reguła Chatham House",
      chathamHouseHint: "Treść bez przypisania do osoby - nagranie i cytowanie są zablokowane.",
      isPrivate: "Sesja niepubliczna",
      allowOverlap: "Pozwól na udział w nachodzących sesjach",
      streamUrl: "Adres transmisji",
      recordingUrl: "Adres nagrania",
      urlHint: "Pełny adres z https://",
      saveAction: "Zapisz",
      cancelAction: "Anuluj",
      validation: {
        titleRequired: "Oba tytuły są wymagane.",
        timesRequired: "Podaj początek i koniec sesji.",
        endBeforeStart: "Koniec musi być po początku.",
        capacityNeedsSignup: "Limit miejsc wymaga włączonych zapisów.",
        capacityNegative: "Limit miejsc nie może być ujemny.",
        urlNotHttps: "Adres musi zaczynać się od https://",
      },
    },

    tracks: {
      title: "Ścieżki",
      subtitle: "Równoległe pasma programu. Kolor ścieżki wraca na publicznej agendzie.",
      loading: "Wczytywanie ścieżek…",
      empty: "Wydarzenie nie ma ścieżek - program jest jednym pasmem.",
      addAction: "Dodaj ścieżkę",
      sessionsCount: "Sesje: {{count}}",
      deleteConfirm: "Usunąć ścieżkę? Operacja zadziała tylko wtedy, gdy żadna sesja jej nie używa.",
      dialog: {
        createTitle: "Nowa ścieżka",
        editTitle: "Edycja ścieżki",
        key: "Klucz",
        keyHint: "Małe litery, cyfry i podkreślenia. Po zapisaniu klucz jest niezmienny.",
        namePl: "Nazwa (PL)",
        nameEn: "Nazwa (EN)",
        accentColor: "Kolor",
        sortOrder: "Kolejność",
        isActive: "Aktywna",
        saveAction: "Zapisz",
        cancelAction: "Anuluj",
        validation: {
          keyRequired: "Klucz musi pasować do wzoru ^[a-z][a-z0-9_]{1,48}$.",
          namesRequired: "Obie nazwy są wymagane.",
        },
      },
      toasts: {
        saved: "Ścieżka zapisana",
        deleted: "Ścieżka usunięta",
      },
    },

    rooms: {
      title: "Sale",
      subtitle:
        "Miejsca, w których odbywają się sesje. Dwie sesje nie zajmą jednej sali w tym samym czasie.",
      loading: "Wczytywanie sal…",
      empty: "Wydarzenie nie ma sal. Dodaj pierwszą salę.",
      addAction: "Dodaj salę",
      capacity: "Pojemność: {{count}}",
      capacityUnknown: "Pojemność nieokreślona",
      bookedMinutes: "Zajęte: {{count}} min",
      sessionsCount: "Sesje: {{count}}",
      deleteConfirm: "Usunąć salę? Operacja zadziała tylko wtedy, gdy żadna sesja jej nie używa.",
      dialog: {
        createTitle: "Nowa sala",
        editTitle: "Edycja sali",
        name: "Nazwa",
        capacity: "Pojemność",
        capacityHint: "Puste pole znaczy brak deklarowanej pojemności.",
        floor: "Piętro",
        locationNote: "Wskazówka dojścia",
        sortOrder: "Kolejność",
        isActive: "Aktywna",
        saveAction: "Zapisz",
        cancelAction: "Anuluj",
        validation: {
          nameRequired: "Nazwa sali jest wymagana.",
          capacityPositive: "Pojemność musi być większa od zera.",
        },
      },
      toasts: {
        saved: "Sala zapisana",
        deleted: "Sala usunięta",
      },
    },

    speakers: {
      title: "Obsada sesji",
      subtitle: "Kolejność na liście jest kolejnością na publicznej agendzie.",
      empty: "Sesja nie ma jeszcze obsady.",
      addAction: "Dodaj prelegenta",
      searchPlaceholder: "Szukaj prelegenta",
      role: "Rola",
      allowOverlap: "Zgoda na nachodzące sesje",
      allowOverlapHint:
        "Bez tej zgody baza odmówi wpisania prelegenta w dwóch sesjach o tej samej godzinie.",
      removeAction: "Usuń z obsady",
      saveAction: "Zapisz obsadę",
    },

    signups: {
      title: "Zapisy na sesję",
      subtitle: "Lista osób z kontem. Rezerwowa awansuje sama, gdy zwolni się miejsce.",
      loading: "Wczytywanie zapisów…",
      empty: "Nikt nie zapisał się na tę sesję.",
      addedByStaff: "Dopisany przez organizatora",
      waitlistPosition: "Pozycja {{position}}",
      registeredAt: "Zapisano",
      forceLabel: "Ponad limit miejsc",
      forceHint: "Wejście ponad limit jest świadomą decyzją organizatora i zostaje w historii.",
      setAction: "Zmień stan",
      toasts: {
        saved: "Zapis zmieniony",
      },
    },

    conflicts: {
      title: "Kolizje agendy",
      subtitle:
        "Raport liczony z danych na żywo. Kolizja sali tu nie występuje - baza jej nie dopuszcza.",
      loading: "Sprawdzanie agendy…",
      empty: "Agenda nie ma kolizji.",
      expected: "Dopuszczalne: {{value}}",
      actual: "Jest: {{value}}",
      otherSession: "Druga sesja",
      subject: "Dotyczy",
      openAction: "Otwórz sesję",
    },

    errors: {
      forbidden: "Ta operacja jest dostępna dla administratora i redaktora organizacji.",
      notFound: "Element nie istnieje w tej organizacji.",
      invalidEvent: "Wskaż wydarzenie.",
      invalidPayload: "Dane żądania są nieprawidłowe.",
      invalidKey: "Klucz musi pasować do wzoru ^[a-z][a-z0-9_]{1,48}$.",
      invalidNames: "Obie nazwy są wymagane.",
      invalidName: "Nazwa jest wymagana.",
      invalidTitles: "Oba tytuły są wymagane.",
      invalidTimes: "Koniec sesji musi być po jej początku.",
      invalidFormat: "Forma udziału może być: na miejscu, online albo hybrydowo.",
      invalidStatus: "Stan może być: szkic, opublikowana albo odwołana.",
      invalidCapacity: "Limit miejsc nie może być ujemny.",
      invalidTierRank: "Warstwa członkostwa nie może być ujemna.",
      invalidRole: "Rola może być: prelegent, moderator, panelista albo prowadzący.",
      invalidStreamUrl: "Adres transmisji musi zaczynać się od https://",
      invalidRecordingUrl: "Adres nagrania musi zaczynać się od https://",
      eventImmutable: "Sesji nie da się przenieść do innego wydarzenia.",
      sessionBeforeEvent: "Sesja zaczyna się przed wydarzeniem.",
      sessionAfterEvent: "Sesja kończy się po wydarzeniu.",
      capacityOverRoom: "Limit {{count}} miejsc przekracza pojemność sali ({{total}}).",
      capacityRequiresSignup: "Limit miejsc wymaga włączonych zapisów na sesję.",
      capacityBelowSessions: "{{count}} sesji ma wyższy limit miejsc niż nowa pojemność sali.",
      trackNotFound: "Ścieżka nie należy do tego wydarzenia.",
      roomNotFound: "Sala nie należy do tego wydarzenia.",
      trackInUse: "Ścieżki używa jeszcze {{count}} sesji.",
      roomInUse: "Sali używa jeszcze {{count}} sesji.",
      roomConflict: "Sala jest już zajęta w tym przedziale godzin.",
      parentSelf: "Sesja nie może być swoją własną sesją nadrzędną.",
      parentNotFound: "Sesja nadrzędna nie należy do tego wydarzenia.",
      parentDepth: "Podsesja nie może mieć własnych podsesji.",
      sessionHasSignups: "Sesja ma {{count}} aktywnych zapisów - odwołaj ją zamiast usuwać.",
      speakerNotFound: "Profil prelegenta nie istnieje w tej organizacji.",
      speakerOverlap: "Prelegent ma już sesję w tym przedziale godzin.",
      signupDisabled: "Ta sesja nie przyjmuje zapisów.",
      sessionFull: "Zajęte {{count}} z {{total}} miejsc - potwierdź wejście ponad limit.",
      tierRequired: "Ta osoba nie ma wymaganej warstwy członkostwa.",
      overlapConflict: "Ta osoba ma już zapis na sesję w tym przedziale godzin.",
      personNotFound: "To konto nie ma profilu w tej organizacji.",
      unknown: "Operacja się nie udała. Spróbuj ponownie.",
    },
  },
};

export const adminEventAgendaEn = {
  adminEventAgenda: {
    nav: {
      sectionTitle: "Agenda",
      sectionsNavLabel: "Event agenda sections",
      sessions: "Sessions",
      tracks: "Tracks",
      rooms: "Rooms",
      conflicts: "Conflicts",
    },

    formats: {
      onsite: "On site",
      online: "Online",
      hybrid: "Hybrid",
    },

    statuses: {
      draft: "Draft",
      published: "Published",
      cancelled: "Cancelled",
    },

    roles: {
      speaker: "Speaker",
      moderator: "Moderator",
      panelist: "Panellist",
      host: "Host",
    },

    signupStatuses: {
      registered: "Signed up",
      waitlist: "Waiting list",
      cancelled: "Withdrawn",
    },

    conflictKinds: {
      speaker_overlap: "A speaker in two sessions at the same time",
      outside_event_window: "Session outside the event window",
      capacity_over_room: "Seat limit above the room capacity",
      overbooked: "Signups above the seat limit",
    },

    sessions: {
      title: "Sessions",
      subtitle:
        "The event programme. A published session is publicly visible; a draft is seen by the organisation only.",
      loading: "Loading sessions…",
      empty: "The programme is empty. Add the first session.",
      emptyFiltered: "No session matches these filters.",
      addAction: "Add a session",
      searchPlaceholder: "Search by session title",
      allTracks: "All tracks",
      allRooms: "All rooms",
      allStatuses: "All states",
      noTrack: "No track",
      noRoom: "No room",
      seats: "{{left}} of {{capacity}} seats",
      seatsUnlimited: "No seat limit",
      signupsOff: "No signups",
      speakersCount: "Speakers: {{count}}",
      childrenCount: "Sub-sessions: {{count}}",
      chathamHouse: "Chatham House Rule",
      isPrivate: "Not public",
      publishAction: "Publish",
      unpublishAction: "Back to draft",
      cancelAction: "Cancel the session",
      deleteConfirm:
        "Delete the session? A session with active signups will not be deleted - cancel it instead.",
      toasts: {
        saved: "Session saved",
        deleted: "Session deleted",
        statusChanged: "Changed the state of {{count}} sessions",
        reordered: "Order saved",
        speakersSaved: "Line-up saved",
      },
    },

    sessionDialog: {
      createTitle: "New session",
      editTitle: "Edit the session",
      titlePl: "Title (PL)",
      titleEn: "Title (EN)",
      descriptionPl: "Description (PL)",
      descriptionEn: "Description (EN)",
      startsAt: "Start",
      endsAt: "End",
      timeZoneHint: "Times are given in the event time zone: {{zone}}",
      format: "Form of participation",
      status: "State",
      track: "Track",
      room: "Room",
      parentSession: "Parent session",
      parentSessionHint: "A sub-session belongs to one session - the tree has two levels only.",
      requiresSignup: "Session signups",
      capacity: "Seat limit",
      capacityHint: "An empty field means no limit. A limit requires signups to be enabled.",
      minTierRank: "Minimum membership tier",
      chathamHouse: "Chatham House Rule",
      chathamHouseHint: "Content without attribution - recording and quoting are blocked.",
      isPrivate: "Session is not public",
      allowOverlap: "Allow taking part in overlapping sessions",
      streamUrl: "Stream address",
      recordingUrl: "Recording address",
      urlHint: "A full address starting with https://",
      saveAction: "Save",
      cancelAction: "Cancel",
      validation: {
        titleRequired: "Both titles are required.",
        timesRequired: "Give the start and the end of the session.",
        endBeforeStart: "The end must be after the start.",
        capacityNeedsSignup: "A seat limit requires signups to be enabled.",
        capacityNegative: "The seat limit cannot be negative.",
        urlNotHttps: "The address must start with https://",
      },
    },

    tracks: {
      title: "Tracks",
      subtitle: "Parallel strands of the programme. The track colour returns on the public agenda.",
      loading: "Loading tracks…",
      empty: "The event has no tracks - the programme is a single strand.",
      addAction: "Add a track",
      sessionsCount: "Sessions: {{count}}",
      deleteConfirm: "Delete the track? This only works while no session uses it.",
      dialog: {
        createTitle: "New track",
        editTitle: "Edit the track",
        key: "Key",
        keyHint: "Lower-case letters, digits and underscores. The key is immutable once saved.",
        namePl: "Name (PL)",
        nameEn: "Name (EN)",
        accentColor: "Colour",
        sortOrder: "Order",
        isActive: "Active",
        saveAction: "Save",
        cancelAction: "Cancel",
        validation: {
          keyRequired: "The key must match ^[a-z][a-z0-9_]{1,48}$.",
          namesRequired: "Both names are required.",
        },
      },
      toasts: {
        saved: "Track saved",
        deleted: "Track deleted",
      },
    },

    rooms: {
      title: "Rooms",
      subtitle:
        "The places where sessions happen. Two sessions will not occupy one room at the same time.",
      loading: "Loading rooms…",
      empty: "The event has no rooms. Add the first room.",
      addAction: "Add a room",
      capacity: "Capacity: {{count}}",
      capacityUnknown: "Capacity not stated",
      bookedMinutes: "Booked: {{count}} min",
      sessionsCount: "Sessions: {{count}}",
      deleteConfirm: "Delete the room? This only works while no session uses it.",
      dialog: {
        createTitle: "New room",
        editTitle: "Edit the room",
        name: "Name",
        capacity: "Capacity",
        capacityHint: "An empty field means no stated capacity.",
        floor: "Floor",
        locationNote: "How to get there",
        sortOrder: "Order",
        isActive: "Active",
        saveAction: "Save",
        cancelAction: "Cancel",
        validation: {
          nameRequired: "The room name is required.",
          capacityPositive: "The capacity must be greater than zero.",
        },
      },
      toasts: {
        saved: "Room saved",
        deleted: "Room deleted",
      },
    },

    speakers: {
      title: "Session line-up",
      subtitle: "The order on this list is the order on the public agenda.",
      empty: "The session has no line-up yet.",
      addAction: "Add a speaker",
      searchPlaceholder: "Search for a speaker",
      role: "Role",
      allowOverlap: "Consent to overlapping sessions",
      allowOverlapHint:
        "Without this consent the database refuses to put a speaker in two sessions at the same time.",
      removeAction: "Remove from the line-up",
      saveAction: "Save the line-up",
    },

    signups: {
      title: "Session signups",
      subtitle: "The list of people with an account. The waiting list promotes itself when a seat frees up.",
      loading: "Loading signups…",
      empty: "Nobody has signed up for this session.",
      addedByStaff: "Added by the organiser",
      waitlistPosition: "Position {{position}}",
      registeredAt: "Signed up",
      forceLabel: "Above the seat limit",
      forceHint:
        "Going above the limit is a deliberate decision of the organiser and stays in the history.",
      setAction: "Change the state",
      toasts: {
        saved: "Signup changed",
      },
    },

    conflicts: {
      title: "Agenda conflicts",
      subtitle:
        "A report computed from live data. A room clash does not appear here - the database does not allow it.",
      loading: "Checking the agenda…",
      empty: "The agenda has no conflicts.",
      expected: "Allowed: {{value}}",
      actual: "Actual: {{value}}",
      otherSession: "The other session",
      subject: "Concerns",
      openAction: "Open the session",
    },

    errors: {
      forbidden: "This operation is available to the organisation's administrator and editor.",
      notFound: "The item does not exist in this organisation.",
      invalidEvent: "Choose an event.",
      invalidPayload: "The request data is invalid.",
      invalidKey: "The key must match ^[a-z][a-z0-9_]{1,48}$.",
      invalidNames: "Both names are required.",
      invalidName: "The name is required.",
      invalidTitles: "Both titles are required.",
      invalidTimes: "The end of the session must be after its start.",
      invalidFormat: "The form of participation can be on site, online or hybrid.",
      invalidStatus: "The state can be draft, published or cancelled.",
      invalidCapacity: "The seat limit cannot be negative.",
      invalidTierRank: "The membership tier cannot be negative.",
      invalidRole: "The role can be speaker, moderator, panellist or host.",
      invalidStreamUrl: "The stream address must start with https://",
      invalidRecordingUrl: "The recording address must start with https://",
      eventImmutable: "A session cannot be moved to another event.",
      sessionBeforeEvent: "The session starts before the event.",
      sessionAfterEvent: "The session ends after the event.",
      capacityOverRoom: "A limit of {{count}} seats exceeds the room capacity ({{total}}).",
      capacityRequiresSignup: "A seat limit requires session signups to be enabled.",
      capacityBelowSessions: "{{count}} session(s) have a higher seat limit than the new capacity.",
      trackNotFound: "The track does not belong to this event.",
      roomNotFound: "The room does not belong to this event.",
      trackInUse: "{{count}} session(s) still use this track.",
      roomInUse: "{{count}} session(s) still use this room.",
      roomConflict: "The room is already taken in this time slot.",
      parentSelf: "A session cannot be its own parent session.",
      parentNotFound: "The parent session does not belong to this event.",
      parentDepth: "A sub-session cannot have sub-sessions of its own.",
      sessionHasSignups: "The session has {{count}} active signups - cancel it instead of deleting.",
      speakerNotFound: "The speaker profile does not exist in this organisation.",
      speakerOverlap: "The speaker already has a session in this time slot.",
      signupDisabled: "This session does not take signups.",
      sessionFull: "{{count}} of {{total}} seats taken - confirm going above the limit.",
      tierRequired: "This person does not hold the required membership tier.",
      overlapConflict: "This person already has a signup for a session in this time slot.",
      personNotFound: "This account has no profile in this organisation.",
      unknown: "The operation failed. Try again.",
    },
  },
};

i18n.addResourceBundle("pl", "translation", adminEventAgendaPl, true, true);
i18n.addResourceBundle("en", "translation", adminEventAgendaEn, true, true);

/**
 * Wywolanie z modulu, ktory potrzebuje slownika przed pierwszym renderem
 * (mapper bledow czyta `i18n.exists`, wiec import samego pliku musi wystarczyc).
 */
export function ensureAgendaI18n(): void {}
