// Słownik agendy wydarzenia (sesje, ścieżki, sale, prelegenci, zapisy), PL/EN.
//
// DLACZEGO OSOBNY PLIK, A NIE ROZSZERZENIE `i18n-admin-events`. Tamta nakładka
// opisuje listę wydarzeń i katalog rodzajów - powierzchnię, którą redaktor
// otwiera raz na wydarzenie. Agenda jest ekranem, na którym siedzi się godzinami
// przy budowie kongresu, ma własną trasę i własny zestaw dialogów. Nakładki są
// niepodzielne, więc wspólny plik kazałby liście wydarzeń ładować cały słownik
// siatki agendy, kolizji i zapisów.
//
// DWA KORZENIE, BO DWIE PŁASZCZYZNY:
//   * `eventSessions` - to, co widzi UCZESTNIK na publicznej agendzie, plus
//     etykiety wartości słownikowych (format, status, rola, stan dostępu).
//     Te same etykiety czyta panel, więc nie ma dla nich drugiej kopii.
//   * `adminEventSessions` - to, co widzi REDAKTOR: siatka agendy, formularze,
//     obsada, zapisy, raport kolizji, komunikaty błędów.
//
// KAŻDA WARTOŚĆ SŁOWNIKOWA Z MIGRACJI 20260823140000_event_sessions.sql MA TU
// SWOJĄ ETYKIETĘ. Baza zna trzy formaty, trzy statusy sesji, cztery role
// sceniczne, trzy statusy zapisu, siedem stanów dostępu i cztery rodzaje
// kolizji - i tyle samo etykiet stoi poniżej. Każdy błąd, który potrafi wyrzucić
// RPC tego modułu, ma tu zdanie mówiące, CO SIĘ STAŁO i CO Z TYM ZROBIĆ:
// "Sala jest zajęta w tym czasie przez sesję {{title}}" zamiast "Konflikt",
// bo komunikat bez powodu zmusza redaktora do zgadywania, a zgadywanie kończy
// się drugą salą o tej samej nazwie.
import i18n from "@/lib/i18n";

export const adminEventSessionsPl = {
  eventSessions: {
    formats: {
      onsite: "Na miejscu",
      // Zapożyczenie, którym zespół posługuje się identycznie po polsku - ten
      // sam zabieg co `adminEvents.formats.online`. Raport parytetu policzy je
      // jako „nieprzetłumaczone” i to jest poprawny odczyt: napis JEST ten sam.
      online: "Online",
      hybrid: "Hybrydowa",
    },

    statuses: {
      draft: "Szkic",
      published: "Opublikowana",
      cancelled: "Odwołana",
    },

    speakerRoles: {
      speaker: "Prelegent",
      moderator: "Moderator",
      panelist: "Panelista",
      host: "Gospodarz",
    },

    signupStatuses: {
      registered: "Zapisany",
      waitlist: "Lista rezerwowa",
      cancelled: "Rezygnacja",
    },

    accessStates: {
      open: "Wejście wolne",
      signupRequired: "Wymagany zapis",
      signedUp: "Jesteś zapisany",
      waitlisted: "Jesteś na liście rezerwowej",
      full: "Brak wolnych miejsc",
      tierRequired: "Wymagana wyższa warstwa członkostwa",
      cancelled: "Sesja odwołana",
    },

    accessReasons: {
      granted: "Masz dostęp do transmisji tej sesji.",
      tierRequired: "Transmisja i nagranie są dostępne od wyższej warstwy członkostwa.",
      signupRequired: "Transmisja jest dostępna po zapisaniu się na sesję.",
      notFound: "Ta sesja nie jest dostępna.",
    },

    agenda: {
      title: "Agenda",
      subtitle: "Program wydarzenia w podziale na godziny, ścieżki i sale.",
      loading: "Wczytywanie agendy…",
      empty: "Agenda tego wydarzenia nie została jeszcze opublikowana.",
      emptyFiltered: "Żadna sesja nie pasuje do wybranych filtrów.",
      clearFilters: "Wyczyść filtry",
      allTracks: "Wszystkie ścieżki",
      allRooms: "Wszystkie sale",
      allDays: "Wszystkie dni",
      trackLabel: "Ścieżka",
      roomLabel: "Sala",
      floorLabel: "Piętro",
      timeLabel: "Godzina",
      timezoneNote: "Godziny w strefie czasowej wydarzenia ({{timezone}}).",
      durationMinutes: "{{count}} min",
      speakersLabel: "Prelegenci",
      noSpeakers: "Prelegenci zostaną ogłoszeni.",
      subsessionsLabel: "W ramach bloku",
      parentSessionLabel: "Część bloku: {{title}}",
      detailsAction: "Szczegóły sesji",
      seatsLeft: "Wolne miejsca: {{count}}",
      seatsUnlimited: "Bez limitu miejsc",
      registeredCount: "Zapisanych: {{count}}",
      waitlistNote: "Miejsca są zajęte - zapis trafi na listę rezerwową.",
      privateNote: "Sesja zamknięta - widoczna tylko dla zapisanych.",
      chathamHouse: "Zasada Chatham House",
      chathamHouseHint:
        "Wolno cytować treść rozmowy, nie wolno przypisywać jej uczestnikom ani ich organizacjom.",
      signUpAction: "Zapisz się na sesję",
      joinWaitlistAction: "Dopisz się do listy rezerwowej",
      cancelSignupAction: "Zrezygnuj z sesji",
      joinStreamAction: "Wejdź na transmisję",
      watchRecordingAction: "Zobacz nagranie",
      streamLocked: "Transmisja dostępna po zapisaniu się",
      recordingLocked: "Nagranie dostępne od wyższej warstwy członkostwa",
      cancelledNote: "Ta sesja została odwołana.",
      addToCalendarAction: "Dodaj do kalendarza",

      toasts: {
        signedUp: "Zapisaliśmy Cię na sesję",
        waitlisted: "Jesteś na liście rezerwowej",
        cancelled: "Zrezygnowałeś z sesji",
      },

      errors: {
        forbidden: "Zaloguj się, żeby zapisać się na sesję.",
        notFound: "Ta sesja nie przyjmuje już zapisów.",
        signupDisabled: "Na tę sesję nie trzeba się zapisywać - wejście jest wolne.",
        tierRequired: "Ta sesja jest dostępna od wyższej warstwy członkostwa.",
        overlapConflict: "Masz już zapis na sesję „{{title}}” w tym samym czasie.",
        invalidPayload: "Nie udało się rozpoznać sesji. Odśwież stronę i spróbuj ponownie.",
        invalidStatus: "Nieznana operacja zapisu.",
        unknown: "Nie udało się zapisać. Spróbuj ponownie.",
      },
    },
  },

  adminEventSessions: {
    nav: {
      agenda: "Agenda",
      sessions: "Sesje",
      tracks: "Ścieżki",
      rooms: "Sale",
      conflicts: "Kolizje",
    },

    list: {
      title: "Agenda wydarzenia",
      subtitle:
        "Sesje w kolejności godzinowej. Sala nie może mieć dwóch sesji naraz - baza tego nie przyjmie.",
      createAction: "Nowa sesja",
      searchPlaceholder: "Szukaj po tytule sesji albo nazwie sali",
      loading: "Wczytywanie agendy…",
      empty: "Nie ma jeszcze żadnej sesji. Dodaj pierwszą, żeby zbudować agendę.",
      emptyFiltered: "Żadna sesja nie pasuje do tych filtrów.",
      adminOnly: "Agenda jest dostępna dla administratora i redaktora organizacji.",
      clearFilters: "Wyczyść filtry",
      timezoneNote: "Wszystkie godziny są w strefie czasowej wydarzenia ({{timezone}}).",

      filters: {
        status: "Status",
        allStatuses: "Wszystkie statusy",
        track: "Ścieżka",
        allTracks: "Wszystkie ścieżki",
        room: "Sala",
        allRooms: "Wszystkie sale",
        noTrack: "Bez ścieżki",
        noRoom: "Bez sali",
      },

      columns: {
        time: "Godziny",
        title: "Sesja",
        duration: "Czas trwania",
        track: "Ścieżka",
        room: "Sala",
        format: "Format",
        speakers: "Prelegenci",
        signups: "Zapisy",
        seats: "Miejsca",
        status: "Status",
        actions: "Działania",
      },

      badges: {
        private: "Zamknięta",
        chathamHouse: "Chatham House",
        requiresSignup: "Zapis wymagany",
        tierGate: "Od warstwy {{rank}}",
        hasStream: "Transmisja",
        hasRecording: "Nagranie",
        allowOverlap: "Nakładanie dozwolone",
        subsessions: "Podsesje: {{count}}",
        partOfBlock: "Podsesja",
      },

      values: {
        noTrack: "Bez ścieżki",
        noRoom: "Bez sali",
        seatsLeft: "{{count}} wolnych",
        seatsUnlimited: "Bez limitu",
        signupsSummary: "{{registered}} zapisanych, {{waitlist}} na liście rezerwowej",
        speakersCount: "{{count}}",
        durationMinutes: "{{count}} min",
        publishedAt: "Opublikowano {{date}}",
        cancelledAt: "Odwołano {{date}}",
      },

      actions: {
        edit: "Edytuj sesję",
        speakers: "Prelegenci",
        signups: "Zapisy",
        publish: "Opublikuj",
        unpublish: "Wycofaj publikację",
        cancel: "Odwołaj sesję",
        delete: "Usuń sesję",
        moveUp: "Wyżej",
        moveDown: "Niżej",
        selectAll: "Zaznacz wszystkie",
        bulkPublish: "Opublikuj zaznaczone",
        bulkUnpublish: "Wycofaj zaznaczone",
        bulkCancel: "Odwołaj zaznaczone",
      },

      confirm: {
        cancelTitle: "Odwołać tę sesję?",
        cancelBody:
          "Sesja zostanie oznaczona jako odwołana i zniknie z planu sal, ale zapisy uczestników zostaną zachowane.",
        deleteTitle: "Usunąć tę sesję?",
        deleteBody:
          "Usunięcie zabiera razem z sesją jej podsesje i obsadę. Sesji z zapisami nie da się usunąć - odwołaj ją.",
        unpublishTitle: "Wycofać publikację sesji?",
        unpublishBody: "Sesja zniknie z publicznej agendy. Data pierwszej publikacji zostaje.",
        confirmAction: "Potwierdź",
        cancelAction: "Anuluj",
      },
    },

    form: {
      createTitle: "Nowa sesja",
      editTitle: "Edycja sesji",
      sectionBasics: "Podstawy",
      sectionTime: "Czas i miejsce",
      sectionAccess: "Dostęp i zapisy",
      sectionMedia: "Transmisja i nagranie",
      sectionStructure: "Struktura agendy",

      fields: {
        titlePl: "Tytuł (polski)",
        titleEn: "Tytuł (angielski)",
        descriptionPl: "Opis (polski)",
        descriptionEn: "Opis (angielski)",
        startsAt: "Początek",
        endsAt: "Koniec",
        format: "Format",
        room: "Sala",
        track: "Ścieżka",
        parentSession: "Blok nadrzędny",
        capacity: "Limit miejsc",
        requiresSignup: "Wymaga zapisu",
        minTierRank: "Próg warstwy członkowskiej",
        chathamHouse: "Zasada Chatham House",
        isPrivate: "Sesja zamknięta",
        allowOverlap: "Zezwól na nakładanie się zapisów",
        streamUrl: "Adres transmisji",
        recordingUrl: "Adres nagrania",
        sortOrder: "Kolejność",
        status: "Status",
      },

      hints: {
        titles: "Tytuł jest wymagany w obu językach - agenda ma dwie wersje.",
        time: "Sesja musi się zmieścić w oknie czasowym wydarzenia. Jeśli nie mieści się celowo, najpierw rozszerz okno wydarzenia.",
        room: "Do wyboru są tylko sale tego wydarzenia. Sala zajęta w tym czasie nie zostanie przyjęta.",
        track: "Ścieżka porządkuje agendę tematycznie i koloruje ją na froncie.",
        parentSession:
          "Blok nadrzędny łączy podsesje pod jedną godziną. Gniazdowanie jest jednopoziomowe - podsesja nie może być blokiem.",
        capacity:
          "Limit miejsc działa tylko przy włączonym zapisie i nie może przekroczyć pojemności sali.",
        requiresSignup:
          "Włącz, jeśli udział wymaga wcześniejszego zapisu. Bez tego limit miejsc nie ma czego pilnować.",
        minTierRank:
          "Zero oznacza brak progu. Wyższa liczba zawęża sesję do wyższych warstw członkostwa.",
        chathamHouse: "Front pokaże przy sesji notę o zasadzie cytowania bez przypisania.",
        isPrivate: "Sesja zamknięta jest widoczna wyłącznie dla osób, które mają na nią zapis.",
        allowOverlap:
          "Wyłączenie blokuje uczestnikowi zapis na dwie sesje o tej samej godzinie - blokada działa, gdy obie sesje ją mają wyłączoną.",
        streamUrl:
          "Adres musi zaczynać się od https. Uczestnik dostaje go po przejściu bramki dostępu, nigdy w agendzie.",
        recordingUrl: "Nagranie jest dostępne po randze warstwy, bez wymogu zapisu.",
        sortOrder: "Porządkuje sesje o tej samej godzinie. Niższa liczba jest wyżej.",
      },

      placeholders: {
        titlePl: "np. Panel otwierający: bezpieczeństwo energetyczne",
        titleEn: "e.g. Opening panel: energy security",
        description: "Kilka zdań o tym, czego dotyczy sesja.",
        streamUrl: "https://…",
        recordingUrl: "https://…",
        noRoom: "Bez sali",
        noTrack: "Bez ścieżki",
        noParent: "Sesja samodzielna",
      },

      saveAction: "Zapisz sesję",
      saveAndPublishAction: "Zapisz i opublikuj",
      cancelAction: "Anuluj",
      deleteAction: "Usuń sesję",
    },

    speakers: {
      title: "Prelegenci sesji",
      subtitle:
        "Obsada pochodzi z rejestru prelegentów organizacji - jedna osoba, jedna karta, jedna ocena.",
      addAction: "Dodaj prelegenta",
      removeAction: "Usuń z sesji",
      saveAction: "Zapisz obsadę",
      cancelAction: "Anuluj",
      searchPlaceholder: "Szukaj w rejestrze prelegentów",
      empty: "Ta sesja nie ma jeszcze obsady.",
      emptyRegistry:
        "Rejestr prelegentów organizacji jest pusty. Najpierw dodaj profil prelegenta.",
      loading: "Wczytywanie obsady…",
      roleLabel: "Rola w sesji",
      orderLabel: "Kolejność wystąpienia",
      allowOverlapLabel: "Dopuść równoległe wystąpienie",
      allowOverlapHint:
        "Zaznacz, jeśli ta osoba świadomie występuje w dwóch równoległych sesjach (zdalnie, z nagrania, jako gospodarz).",
      replaceNote: "Zapis zastępuje całą obsadę sesji - osoby zdjęte z listy zostaną usunięte.",
      profileHint: "Nazwisko, zdjęcie i nagłówek pochodzą z profilu prelegenta.",

      toasts: {
        saved: "Obsada sesji zapisana",
      },
    },

    signups: {
      title: "Zapisy na sesję",
      subtitle: "Kto ma miejsce, kto czeka w kolejce i kto zrezygnował.",
      empty: "Nikt nie zapisał się jeszcze na tę sesję.",
      loading: "Wczytywanie zapisów…",
      disabled: "Ta sesja nie przyjmuje zapisów - włącz wymóg zapisu w formularzu sesji.",
      searchPlaceholder: "Szukaj osoby w organizacji",

      actions: {
        add: "Zapisz uczestnika",
        promote: "Wpuść z listy rezerwowej",
        moveToWaitlist: "Przenieś na listę rezerwową",
        remove: "Wypisz z sesji",
        force: "Zapisz ponad limit",
      },

      columns: {
        person: "Osoba",
        status: "Status",
        registeredAt: "Data zapisu",
        waitlistPosition: "Miejsce w kolejce",
        addedBy: "Dodane przez",
      },

      values: {
        addedBySelf: "Zapis własny",
        addedByStaff: "Organizator",
        waitlistPosition: "{{position}} w kolejce",
        cancelledAt: "Rezygnacja {{date}}",
        unknownPerson: "Konto bez profilu",
      },

      summary: {
        registered: "Zapisanych: {{count}}",
        waitlist: "Lista rezerwowa: {{count}}",
        cancelled: "Rezygnacje: {{count}}",
        seatsLeft: "Wolne miejsca: {{count}}",
        seatsUnlimited: "Bez limitu miejsc",
        promotionNote:
          "Rezygnacja osoby z miejscem automatycznie awansuje pierwszą osobę z listy rezerwowej.",
        forceNote:
          "Zapis ponad limit jest możliwy świadomie - nadwyżka pojawi się w raporcie kolizji jako „zapisów więcej niż miejsc”.",
      },
    },

    tracks: {
      title: "Ścieżki tematyczne",
      subtitle:
        "Ścieżka należy do jednego wydarzenia. Jej klucz trafia do adresu filtra agendy, więc po zapisie jest niezmienny.",
      createAction: "Nowa ścieżka",
      editAction: "Edytuj ścieżkę",
      deleteAction: "Usuń ścieżkę",
      empty: "To wydarzenie nie ma jeszcze ścieżek. Agenda może obejść się bez nich.",
      loading: "Wczytywanie ścieżek…",

      fields: {
        key: "Klucz",
        namePl: "Nazwa (polska)",
        nameEn: "Nazwa (angielska)",
        accentColor: "Kolor akcentu",
        sortOrder: "Kolejność",
        isActive: "Dostępna w formularzu sesji",
      },

      hints: {
        key: "Małe litery, cyfry i podkreślenie. Klucz jest niezmienny po zapisie - trafia do adresu filtra agendy.",
        accentColor: "Kolor w formacie #rrggbb. Front koloruje nim sesje tej ścieżki.",
        isActive:
          "Wyłączona ścieżka znika z formularza sesji, ale zostaje na sesjach już do niej przypisanych.",
        sortOrder: "Kolejność kolumn w siatce agendy. Niższa liczba jest pierwsza.",
      },

      values: {
        sessionsCount: "Sesji: {{count}}",
        inactive: "Wyłączona",
      },

      confirm: {
        deleteTitle: "Usunąć tę ścieżkę?",
        deleteBody:
          "Ścieżki używanej przez sesje nie da się usunąć - najpierw odepnij ją od sesji.",
        confirmAction: "Usuń",
        cancelAction: "Anuluj",
      },

      toasts: {
        saved: "Ścieżka zapisana",
        deleted: "Ścieżka usunięta",
      },
    },

    rooms: {
      title: "Sale i przestrzenie",
      subtitle:
        "Sala należy do jednego wydarzenia. Dwie sesje w jednej sali o tej samej godzinie są niemożliwe - pilnuje tego baza.",
      createAction: "Nowa sala",
      editAction: "Edytuj salę",
      deleteAction: "Usuń salę",
      empty: "To wydarzenie nie ma jeszcze sal. Sesja bez sali też się zapisze.",
      loading: "Wczytywanie sal…",

      fields: {
        name: "Nazwa sali",
        capacity: "Pojemność",
        floor: "Piętro",
        locationNote: "Wskazówka dojścia",
        sortOrder: "Kolejność",
        isActive: "Dostępna w formularzu sesji",
      },

      hints: {
        name: "Nazwa własna miejsca, jedna dla obu wersji językowych - taka, jaka wisi na drzwiach.",
        capacity: "Liczba miejsc w pomieszczeniu. Limit miejsc sesji nie może jej przekroczyć.",
        floor: "Poziom budynku, np. „Parter” albo „Piętro 2”.",
        locationNote: "Krótka wskazówka, np. „wejście od strony parku”, „winda B”.",
        isActive:
          "Wyłączona sala znika z formularza sesji, ale zostaje na sesjach już przypisanych.",
        sortOrder: "Kolejność kolumn w siatce agendy. Niższa liczba jest pierwsza.",
      },

      values: {
        sessionsCount: "Sesji: {{count}}",
        bookedHours: "Zajęte: {{hours}} h",
        capacityPeople: "{{count}} miejsc",
        capacityUnknown: "Pojemność nieokreślona",
        inactive: "Wyłączona",
      },

      confirm: {
        deleteTitle: "Usunąć tę salę?",
        deleteBody: "Sali używanej przez sesje nie da się usunąć - najpierw odepnij ją od sesji.",
        confirmAction: "Usuń",
        cancelAction: "Anuluj",
      },

      toasts: {
        saved: "Sala zapisana",
        deleted: "Sala usunięta",
      },
    },

    conflicts: {
      title: "Kolizje agendy",
      subtitle:
        "Cztery rodzaje kolizji liczone z danych przy każdym otwarciu. Trzy z nich powstają po zapisie sesji - po przesunięciu godzin, zwężeniu okna wydarzenia albo obniżeniu pojemności.",
      empty: "Agenda jest spójna - żadnej kolizji.",
      loading: "Sprawdzanie kolizji…",
      countBadge: "Kolizje: {{count}}",

      kinds: {
        speakerOverlap: "Prelegent w dwóch sesjach naraz",
        outsideEventWindow: "Sesja poza oknem wydarzenia",
        capacityOverRoom: "Limit miejsc ponad pojemność sali",
        overbooked: "Zapisów więcej niż miejsc",
      },

      details: {
        speakerOverlap: "{{speaker}} występuje jednocześnie w „{{session}}” i „{{other}}”.",
        outsideEventWindow: "Sesja „{{session}}” wychodzi poza czas trwania wydarzenia.",
        capacityOverRoom:
          "Sesja „{{session}}” ma limit {{actual}} miejsc, a sala {{room}} pomieści {{expected}}.",
        overbooked:
          "Na sesję „{{session}}” zapisało się {{actual}} osób przy limicie {{expected}}.",
      },

      resolutions: {
        speakerOverlap:
          "Przesuń jedną z sesji, zdejmij osobę z jednej obsady albo dopuść nakładanie na wierszu obsady.",
        outsideEventWindow: "Rozszerz okno czasowe wydarzenia albo przesuń sesję do środka.",
        capacityOverRoom: "Obniż limit miejsc sesji albo przenieś ją do większej sali.",
        overbooked:
          "Podnieś limit miejsc albo przenieś nadwyżkę na listę rezerwową, kontaktując się z uczestnikami.",
      },

      goToSessionAction: "Otwórz sesję",
    },

    errors: {
      forbidden: "Ta operacja jest dostępna dla administratora i redaktora organizacji.",
      notFound: "Nie znaleziono tego elementu w Twojej organizacji.",
      invalidPayload: "Formularz przysłał dane w nieoczekiwanym kształcie. Odśwież stronę.",
      invalidEvent: "Brakuje wskazania wydarzenia.",
      eventImmutable:
        "Sesji nie można przenieść do innego wydarzenia - utwórz ją na nowo w docelowym wydarzeniu.",
      invalidTitles: "Tytuł jest wymagany w obu językach.",
      invalidNames: "Nazwa jest wymagana w obu językach (od 2 do 80 znaków).",
      invalidName: "Nazwa sali jest wymagana (do 120 znaków).",
      invalidKey: "Klucz musi zaczynać się od litery i zawierać tylko a-z, 0-9 oraz podkreślenie.",
      duplicateKey: "Ścieżka o tym kluczu już istnieje w tym wydarzeniu.",
      duplicateName: "Sala o tej nazwie już istnieje w tym wydarzeniu.",
      invalidTimes: "Koniec sesji musi być po jej początku.",
      durationTooLong: "Sesja nie może trwać dłużej niż 48 godzin - sprawdź datę.",
      invalidFormat: "Format sesji musi być jednym z: na miejscu, online, hybrydowa.",
      invalidStatus: "Status sesji musi być jednym z: szkic, opublikowana, odwołana.",
      invalidCapacity: "Limit miejsc nie może być liczbą ujemną.",
      invalidRoomCapacity: "Pojemność sali musi być liczbą większą od zera.",
      capacityRequiresSignup:
        "Limit miejsc wymaga włączonego zapisu - bez zapisów nie ma czego liczyć.",
      capacityOverRoom: "Limit {{capacity}} miejsc przekracza pojemność sali ({{roomCapacity}}).",
      capacityBelowSessions:
        "Nie można obniżyć pojemności: {{count}} sesji w tej sali ma wyższy limit miejsc.",
      invalidTierRank: "Próg warstwy członkowskiej nie może być liczbą ujemną.",
      invalidStreamUrl: "Adres transmisji musi zaczynać się od https://.",
      invalidRecordingUrl: "Adres nagrania musi zaczynać się od https://.",
      invalidAccentColor: "Kolor akcentu zapisz w formacie #rrggbb.",
      trackNotFound: "Wybrana ścieżka nie należy do tego wydarzenia.",
      roomNotFound: "Wybrana sala nie należy do tego wydarzenia.",
      parentNotFound: "Blok nadrzędny nie należy do tego wydarzenia.",
      parentSelf: "Sesja nie może być swoim własnym blokiem nadrzędnym.",
      parentDepth:
        "Podsesja nie może być blokiem nadrzędnym - agenda ma jeden poziom zagnieżdżenia.",
      roomConflict: "Sala jest w tym czasie zajęta przez sesję „{{title}}”.",
      sessionBeforeEvent: "Sesja zaczyna się przed początkiem wydarzenia ({{eventStart}}).",
      sessionAfterEvent: "Sesja kończy się po zakończeniu wydarzenia ({{eventEnd}}).",
      sessionHasSignups:
        "Tej sesji nie można usunąć - ma {{count}} aktywnych zapisów. Odwołaj ją, żeby zachować listę uczestników.",
      trackInUse: "Ścieżki nie można usunąć - używa jej {{count}} sesji.",
      roomInUse: "Sali nie można usunąć - używa jej {{count}} sesji.",
      invalidRole: "Rola w sesji musi być jedną z: prelegent, moderator, panelista, gospodarz.",
      speakerNotFound: "Ten profil prelegenta nie istnieje w Twojej organizacji.",
      speakerOverlap: "{{speaker}} występuje w tym czasie w sesji „{{title}}”.",
      personNotFound: "To konto nie ma profilu w Twojej organizacji.",
      sessionFull:
        "Miejsca są zajęte ({{registered}} z {{capacity}}). Użyj zapisu ponad limit, jeśli to świadoma decyzja.",
      signupDisabled: "Ta sesja nie przyjmuje zapisów - najpierw włącz wymóg zapisu.",
      unknown: "Nie udało się zapisać zmiany. Spróbuj ponownie.",
    },

    toasts: {
      sessionSaved: "Sesja zapisana",
      sessionDeleted: "Sesja usunięta",
      sessionsPublished: "Opublikowano {{count}} sesji",
      sessionsUnpublished: "Wycofano {{count}} sesji",
      sessionsCancelled: "Odwołano {{count}} sesji",
      sessionsReordered: "Zmieniono kolejność {{count}} sesji",
      nothingChanged: "Nic się nie zmieniło",
      signupSaved: "Zapis uczestnika zapisany",
      signupCancelled: "Uczestnik wypisany z sesji",
      signupPromoted: "Pierwsza osoba z listy rezerwowej dostała miejsce",
    },
  },
};

export const adminEventSessionsEn = {
  eventSessions: {
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

    speakerRoles: {
      speaker: "Speaker",
      moderator: "Moderator",
      panelist: "Panellist",
      host: "Host",
    },

    signupStatuses: {
      registered: "Registered",
      waitlist: "Waiting list",
      cancelled: "Withdrawn",
    },

    accessStates: {
      open: "Open entry",
      signupRequired: "Signup required",
      signedUp: "You are signed up",
      waitlisted: "You are on the waiting list",
      full: "No seats left",
      tierRequired: "A higher membership tier is required",
      cancelled: "Session cancelled",
    },

    accessReasons: {
      granted: "You have access to the stream of this session.",
      tierRequired: "The stream and the recording are available from a higher membership tier.",
      signupRequired: "The stream is available once you sign up for the session.",
      notFound: "This session is not available.",
    },

    agenda: {
      title: "Agenda",
      subtitle: "The event programme by time, track and room.",
      loading: "Loading the agenda…",
      empty: "The agenda for this event has not been published yet.",
      emptyFiltered: "No session matches the selected filters.",
      clearFilters: "Clear filters",
      allTracks: "All tracks",
      allRooms: "All rooms",
      allDays: "All days",
      trackLabel: "Track",
      roomLabel: "Room",
      floorLabel: "Floor",
      timeLabel: "Time",
      timezoneNote: "Times are in the event time zone ({{timezone}}).",
      durationMinutes: "{{count}} min",
      speakersLabel: "Speakers",
      noSpeakers: "Speakers will be announced.",
      subsessionsLabel: "Inside this block",
      parentSessionLabel: "Part of the block: {{title}}",
      detailsAction: "Session details",
      seatsLeft: "Seats left: {{count}}",
      seatsUnlimited: "No seat limit",
      registeredCount: "Registered: {{count}}",
      waitlistNote: "All seats are taken - a signup will go to the waiting list.",
      privateNote: "Closed session - visible only to people who signed up.",
      chathamHouse: "Chatham House Rule",
      chathamHouseHint:
        "The content may be quoted, but it may not be attributed to participants or their organisations.",
      signUpAction: "Sign up for this session",
      joinWaitlistAction: "Join the waiting list",
      cancelSignupAction: "Withdraw from this session",
      joinStreamAction: "Join the stream",
      watchRecordingAction: "Watch the recording",
      streamLocked: "The stream unlocks after you sign up",
      recordingLocked: "The recording is available from a higher membership tier",
      cancelledNote: "This session has been cancelled.",
      addToCalendarAction: "Add to calendar",

      toasts: {
        signedUp: "You are signed up for the session",
        waitlisted: "You are on the waiting list",
        cancelled: "You have withdrawn from the session",
      },

      errors: {
        forbidden: "Sign in to sign up for a session.",
        notFound: "This session no longer takes signups.",
        signupDisabled: "This session needs no signup - entry is open.",
        tierRequired: "This session is available from a higher membership tier.",
        overlapConflict: "You are already signed up for “{{title}}” at the same time.",
        invalidPayload: "We could not identify the session. Refresh the page and try again.",
        invalidStatus: "Unknown signup operation.",
        unknown: "The signup failed. Please try again.",
      },
    },
  },

  adminEventSessions: {
    nav: {
      agenda: "Agenda",
      sessions: "Sessions",
      tracks: "Tracks",
      rooms: "Rooms",
      conflicts: "Conflicts",
    },

    list: {
      title: "Event agenda",
      subtitle:
        "Sessions in time order. A room cannot hold two sessions at once - the database will not accept it.",
      createAction: "New session",
      searchPlaceholder: "Search by session title or room name",
      loading: "Loading the agenda…",
      empty: "There is no session yet. Add the first one to build the agenda.",
      emptyFiltered: "No session matches these filters.",
      adminOnly: "The agenda is available to the organisation administrator and editor.",
      clearFilters: "Clear filters",
      timezoneNote: "All times are in the event time zone ({{timezone}}).",

      filters: {
        status: "Status",
        allStatuses: "All statuses",
        track: "Track",
        allTracks: "All tracks",
        room: "Room",
        allRooms: "All rooms",
        noTrack: "No track",
        noRoom: "No room",
      },

      columns: {
        time: "Time",
        title: "Session",
        duration: "Duration",
        track: "Track",
        room: "Room",
        format: "Format",
        speakers: "Speakers",
        signups: "Signups",
        seats: "Seats",
        status: "Status",
        actions: "Actions",
      },

      badges: {
        private: "Closed",
        chathamHouse: "Chatham House",
        requiresSignup: "Signup required",
        tierGate: "From tier {{rank}}",
        hasStream: "Stream",
        hasRecording: "Recording",
        allowOverlap: "Overlap allowed",
        subsessions: "Sub-sessions: {{count}}",
        partOfBlock: "Sub-session",
      },

      values: {
        noTrack: "No track",
        noRoom: "No room",
        seatsLeft: "{{count}} left",
        seatsUnlimited: "No limit",
        signupsSummary: "{{registered}} registered, {{waitlist}} on the waiting list",
        speakersCount: "{{count}}",
        durationMinutes: "{{count}} min",
        publishedAt: "Published {{date}}",
        cancelledAt: "Cancelled {{date}}",
      },

      actions: {
        edit: "Edit session",
        speakers: "Speakers",
        signups: "Signups",
        publish: "Publish",
        unpublish: "Unpublish",
        cancel: "Cancel session",
        delete: "Delete session",
        moveUp: "Move up",
        moveDown: "Move down",
        selectAll: "Select all",
        bulkPublish: "Publish selected",
        bulkUnpublish: "Unpublish selected",
        bulkCancel: "Cancel selected",
      },

      confirm: {
        cancelTitle: "Cancel this session?",
        cancelBody:
          "The session will be marked as cancelled and will leave the room plan, but participant signups are kept.",
        deleteTitle: "Delete this session?",
        deleteBody:
          "Deleting takes the sub-sessions and the speaker line-up with it. A session with signups cannot be deleted - cancel it instead.",
        unpublishTitle: "Unpublish this session?",
        unpublishBody:
          "The session will leave the public agenda. The first publication date is kept.",
        confirmAction: "Confirm",
        cancelAction: "Cancel",
      },
    },

    form: {
      createTitle: "New session",
      editTitle: "Edit session",
      sectionBasics: "Basics",
      sectionTime: "Time and place",
      sectionAccess: "Access and signups",
      sectionMedia: "Stream and recording",
      sectionStructure: "Agenda structure",

      fields: {
        titlePl: "Title (Polish)",
        titleEn: "Title (English)",
        descriptionPl: "Description (Polish)",
        descriptionEn: "Description (English)",
        startsAt: "Start",
        endsAt: "End",
        format: "Format",
        room: "Room",
        track: "Track",
        parentSession: "Parent block",
        capacity: "Seat limit",
        requiresSignup: "Requires signup",
        minTierRank: "Membership tier threshold",
        chathamHouse: "Chatham House Rule",
        isPrivate: "Closed session",
        allowOverlap: "Allow overlapping signups",
        streamUrl: "Stream address",
        recordingUrl: "Recording address",
        sortOrder: "Order",
        status: "Status",
      },

      hints: {
        titles: "The title is required in both languages - the agenda has two versions.",
        time: "The session must fit inside the event time window. If it is meant to sit outside, widen the event window first.",
        room: "Only rooms of this event can be picked. A room already taken in this slot will not be accepted.",
        track: "The track groups the agenda by topic and colours it on the front end.",
        parentSession:
          "A parent block gathers sub-sessions under one time slot. Nesting is one level deep - a sub-session cannot be a block.",
        capacity:
          "The seat limit works only with signups enabled and cannot exceed the room capacity.",
        requiresSignup:
          "Enable it when attendance needs a prior signup. Without it a seat limit has nothing to guard.",
        minTierRank:
          "Zero means no threshold. A higher number narrows the session to higher membership tiers.",
        chathamHouse: "The front end shows a note about quoting without attribution.",
        isPrivate: "A closed session is visible only to people who have a signup for it.",
        allowOverlap:
          "Switching it off blocks a participant from signing up for two sessions at the same time - the block applies when both sessions have it off.",
        streamUrl:
          "The address must start with https. A participant receives it after the access gate, never in the agenda.",
        recordingUrl: "The recording is available by membership tier, with no signup required.",
        sortOrder: "Orders sessions that share a time slot. A lower number comes first.",
      },

      placeholders: {
        titlePl: "e.g. Opening panel: energy security (Polish)",
        titleEn: "e.g. Opening panel: energy security",
        description: "A few sentences about what the session covers.",
        streamUrl: "https://…",
        recordingUrl: "https://…",
        noRoom: "No room",
        noTrack: "No track",
        noParent: "Standalone session",
      },

      saveAction: "Save session",
      saveAndPublishAction: "Save and publish",
      cancelAction: "Cancel",
      deleteAction: "Delete session",
    },

    speakers: {
      title: "Session speakers",
      subtitle:
        "The line-up comes from the organisation speaker registry - one person, one card, one rating.",
      addAction: "Add speaker",
      removeAction: "Remove from session",
      saveAction: "Save line-up",
      cancelAction: "Cancel",
      searchPlaceholder: "Search the speaker registry",
      empty: "This session has no line-up yet.",
      emptyRegistry: "The organisation speaker registry is empty. Add a speaker profile first.",
      loading: "Loading the line-up…",
      roleLabel: "Role in the session",
      orderLabel: "Speaking order",
      allowOverlapLabel: "Allow a parallel appearance",
      allowOverlapHint:
        "Tick it when this person deliberately appears in two parallel sessions (remotely, from a recording, as the host).",
      replaceNote: "Saving replaces the whole line-up - people removed from the list are deleted.",
      profileHint: "The name, photo and headline come from the speaker profile.",

      toasts: {
        saved: "Session line-up saved",
      },
    },

    signups: {
      title: "Session signups",
      subtitle: "Who has a seat, who waits in the queue and who withdrew.",
      empty: "Nobody has signed up for this session yet.",
      loading: "Loading signups…",
      disabled:
        "This session takes no signups - enable the signup requirement in the session form.",
      searchPlaceholder: "Search for a person in the organisation",

      actions: {
        add: "Add participant",
        promote: "Admit from the waiting list",
        moveToWaitlist: "Move to the waiting list",
        remove: "Remove from session",
        force: "Add above the limit",
      },

      columns: {
        person: "Person",
        status: "Status",
        registeredAt: "Signup date",
        waitlistPosition: "Queue position",
        addedBy: "Added by",
      },

      values: {
        addedBySelf: "Self signup",
        addedByStaff: "Organiser",
        waitlistPosition: "{{position}} in the queue",
        cancelledAt: "Withdrew {{date}}",
        unknownPerson: "Account without a profile",
      },

      summary: {
        registered: "Registered: {{count}}",
        waitlist: "Waiting list: {{count}}",
        cancelled: "Withdrawals: {{count}}",
        seatsLeft: "Seats left: {{count}}",
        seatsUnlimited: "No seat limit",
        promotionNote:
          "When a person with a seat withdraws, the first person on the waiting list is promoted automatically.",
        forceNote:
          "Adding somebody above the limit is possible on purpose - the surplus shows up in the conflict report as “more signups than seats”.",
      },
    },

    tracks: {
      title: "Topic tracks",
      subtitle:
        "A track belongs to one event. Its key goes into the agenda filter address, so it cannot change after saving.",
      createAction: "New track",
      editAction: "Edit track",
      deleteAction: "Delete track",
      empty: "This event has no tracks yet. The agenda works without them too.",
      loading: "Loading tracks…",

      fields: {
        key: "Key",
        namePl: "Name (Polish)",
        nameEn: "Name (English)",
        accentColor: "Accent colour",
        sortOrder: "Order",
        isActive: "Available in the session form",
      },

      hints: {
        key: "Lower-case letters, digits and underscore. The key cannot change after saving - it goes into the agenda filter address.",
        accentColor:
          "A colour in #rrggbb format. The front end colours this track's sessions with it.",
        isActive:
          "A disabled track leaves the session form but stays on sessions already assigned to it.",
        sortOrder: "Column order in the agenda grid. A lower number comes first.",
      },

      values: {
        sessionsCount: "Sessions: {{count}}",
        inactive: "Disabled",
      },

      confirm: {
        deleteTitle: "Delete this track?",
        deleteBody:
          "A track used by sessions cannot be deleted - detach it from the sessions first.",
        confirmAction: "Delete",
        cancelAction: "Cancel",
      },

      toasts: {
        saved: "Track saved",
        deleted: "Track deleted",
      },
    },

    rooms: {
      title: "Rooms and spaces",
      subtitle:
        "A room belongs to one event. Two sessions in one room at the same time are impossible - the database guards it.",
      createAction: "New room",
      editAction: "Edit room",
      deleteAction: "Delete room",
      empty: "This event has no rooms yet. A session without a room saves fine too.",
      loading: "Loading rooms…",

      fields: {
        name: "Room name",
        capacity: "Capacity",
        floor: "Floor",
        locationNote: "Wayfinding note",
        sortOrder: "Order",
        isActive: "Available in the session form",
      },

      hints: {
        name: "The proper name of the space, one for both languages - the one written on the door.",
        capacity: "The number of seats in the room. A session seat limit cannot exceed it.",
        floor: "The building level, e.g. “Ground floor” or “Level 2”.",
        locationNote: "A short hint, e.g. “entrance from the park”, “lift B”.",
        isActive:
          "A disabled room leaves the session form but stays on sessions already assigned to it.",
        sortOrder: "Column order in the agenda grid. A lower number comes first.",
      },

      values: {
        sessionsCount: "Sessions: {{count}}",
        bookedHours: "Booked: {{hours}} h",
        capacityPeople: "{{count}} seats",
        capacityUnknown: "Capacity not set",
        inactive: "Disabled",
      },

      confirm: {
        deleteTitle: "Delete this room?",
        deleteBody:
          "A room used by sessions cannot be deleted - detach it from the sessions first.",
        confirmAction: "Delete",
        cancelAction: "Cancel",
      },

      toasts: {
        saved: "Room saved",
        deleted: "Room deleted",
      },
    },

    conflicts: {
      title: "Agenda conflicts",
      subtitle:
        "Four kinds of conflict, computed from the data every time you open this. Three of them appear after a session is saved - once times move, the event window narrows or a capacity drops.",
      empty: "The agenda is consistent - no conflicts.",
      loading: "Checking conflicts…",
      countBadge: "Conflicts: {{count}}",

      kinds: {
        speakerOverlap: "Speaker in two sessions at once",
        outsideEventWindow: "Session outside the event window",
        capacityOverRoom: "Seat limit above the room capacity",
        overbooked: "More signups than seats",
      },

      details: {
        speakerOverlap: "{{speaker}} appears at the same time in “{{session}}” and “{{other}}”.",
        outsideEventWindow: "The session “{{session}}” falls outside the event duration.",
        capacityOverRoom:
          "The session “{{session}}” has a limit of {{actual}} seats, while room {{room}} holds {{expected}}.",
        overbooked:
          "The session “{{session}}” has {{actual}} signups against a limit of {{expected}}.",
      },

      resolutions: {
        speakerOverlap:
          "Move one of the sessions, remove the person from one line-up, or allow the overlap on the line-up row.",
        outsideEventWindow: "Widen the event time window or move the session inside it.",
        capacityOverRoom: "Lower the session seat limit or move it to a bigger room.",
        overbooked:
          "Raise the seat limit or move the surplus to the waiting list after contacting the participants.",
      },

      goToSessionAction: "Open session",
    },

    errors: {
      forbidden: "This operation is available to the organisation administrator and editor.",
      notFound: "This item does not exist in your organisation.",
      invalidPayload: "The form sent data in an unexpected shape. Refresh the page.",
      invalidEvent: "The event is missing.",
      eventImmutable:
        "A session cannot be moved to another event - create it again in the target event.",
      invalidTitles: "The title is required in both languages.",
      invalidNames: "The name is required in both languages (2 to 80 characters).",
      invalidName: "The room name is required (up to 120 characters).",
      invalidKey: "The key must start with a letter and contain only a-z, 0-9 and underscore.",
      duplicateKey: "A track with this key already exists in this event.",
      duplicateName: "A room with this name already exists in this event.",
      invalidTimes: "The session must end after it starts.",
      durationTooLong: "A session cannot last longer than 48 hours - check the date.",
      invalidFormat: "The session format must be one of: on site, online, hybrid.",
      invalidStatus: "The session status must be one of: draft, published, cancelled.",
      invalidCapacity: "The seat limit cannot be negative.",
      invalidRoomCapacity: "The room capacity must be a number greater than zero.",
      capacityRequiresSignup:
        "A seat limit needs signups enabled - without signups there is nothing to count.",
      capacityOverRoom:
        "A limit of {{capacity}} seats exceeds the room capacity ({{roomCapacity}}).",
      capacityBelowSessions:
        "The capacity cannot be lowered: {{count}} session(s) in this room have a higher seat limit.",
      invalidTierRank: "The membership tier threshold cannot be negative.",
      invalidStreamUrl: "The stream address must start with https://.",
      invalidRecordingUrl: "The recording address must start with https://.",
      invalidAccentColor: "Write the accent colour as #rrggbb.",
      trackNotFound: "The selected track does not belong to this event.",
      roomNotFound: "The selected room does not belong to this event.",
      parentNotFound: "The parent block does not belong to this event.",
      parentSelf: "A session cannot be its own parent block.",
      parentDepth: "A sub-session cannot be a parent block - the agenda has one nesting level.",
      roomConflict: "The room is taken in this slot by the session “{{title}}”.",
      sessionBeforeEvent: "The session starts before the event begins ({{eventStart}}).",
      sessionAfterEvent: "The session ends after the event finishes ({{eventEnd}}).",
      sessionHasSignups:
        "This session cannot be deleted - it has {{count}} active signups. Cancel it to keep the participant list.",
      trackInUse: "The track cannot be deleted - {{count}} session(s) still use it.",
      roomInUse: "The room cannot be deleted - {{count}} session(s) still use it.",
      invalidRole: "The role must be one of: speaker, moderator, panellist, host.",
      speakerNotFound: "This speaker profile does not exist in your organisation.",
      speakerOverlap: "{{speaker}} appears in the session “{{title}}” at this time.",
      personNotFound: "This account has no profile in your organisation.",
      sessionFull:
        "All seats are taken ({{registered}} of {{capacity}}). Use the above-the-limit signup if that is deliberate.",
      signupDisabled: "This session takes no signups - enable the signup requirement first.",
      unknown: "The change could not be saved. Please try again.",
    },

    toasts: {
      sessionSaved: "Session saved",
      sessionDeleted: "Session deleted",
      sessionsPublished: "Published {{count}} session(s)",
      sessionsUnpublished: "Unpublished {{count}} session(s)",
      sessionsCancelled: "Cancelled {{count}} session(s)",
      sessionsReordered: "Reordered {{count}} session(s)",
      nothingChanged: "Nothing changed",
      signupSaved: "Participant signup saved",
      signupCancelled: "Participant removed from the session",
      signupPromoted: "The first person on the waiting list got a seat",
    },
  },
};

i18n.addResourceBundle("pl", "translation", adminEventSessionsPl, true, true);
i18n.addResourceBundle("en", "translation", adminEventSessionsEn, true, true);

/**
 * No-op wolany w komponencie trasy zamiast side-effectowego importu modulu.
 * Nazwane wiazanie pozwala splitterowi TanStacka przeniesc caly bundle
 * tlumaczen do chunka trasy - side-effectowy import w pliku trasy landowal
 * w eager-owym grafie wejsciowym kazdej strony. Rejestracja dzieje sie przy
 * ewaluacji modulu (przed renderem komponentu), dokladnie jak wczesniej.
 */
export function ensureI18n(): void {}
