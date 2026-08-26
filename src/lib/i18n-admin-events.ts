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

    // ------------------------------------------------------------- STUDIO
    // OSOBNA POWIERZCHNIA, NIE KOLEJNY EKRAN LISTY. Gałąź `studio` opisuje pracę
    // nad JEDNYM wydarzeniem: własny sidebar wydarzenia, własny górny pasek ze
    // statusem i dok podglądu na żywo. Gałęzie `list` i `types` mówią o katalogu
    // wydarzeń i celowo nie są tu ponownie użyte - ten sam wyraz znaczy w obu
    // miejscach co innego („Grupy" w studiu to grupy uczestników jednego
    // wydarzenia, a nie grupowanie rodzajów w katalogu), więc wspólny klucz
    // dałby napis poprawny na jednym ekranie i mylący na drugim.
    studio: {
      sections: {
        overview: "Pulpit",
        general: "Informacje ogólne",
        pages: "Strony i menu",
        groups: "Grupy i uprawnienia",
        branding: "Branding",
        sponsors: "Sponsorzy i reklama",
        terms: "Regulaminy",
        registration: "Rejestracja w aplikacji",
        content: "Treść",
        meetings: "Spotkania",
        communications: "Komunikacja",
        onsite: "Na miejscu",
        integrations: "Integracje",
        analytics: "Analityka",
        features: "Funkcje dodatkowe",
      },

      groups: {
        builder: "Kreator wydarzenia",
      },

      // SŁOWA, KTÓRYCH REDAKTOR SZUKA, A NIE ETYKIETY, KTÓRE JUŻ WIDZI.
      // Wyszukiwarka studia porównuje zapytanie z etykietą ORAZ z tym napisem,
      // więc „bilety" prowadzą do rejestracji, a „QR" do odprawy na miejscu.
      // Bez nich wyszukiwarka odpowiada wyłącznie na dosłowną nazwę sekcji,
      // czyli na to, co redaktor ma już przed oczami.
      keywords: {
        general: "nazwa, adres, termin, strefa czasowa, okładka, hashtag, języki, wideo",
        pages: "menu, podstrony, układ strony głównej, builder, nawigacja",
        groups: "uprawnienia, widoczność, goście, uczestnicy",
        branding: "kolory, motyw, tło, wygląd, marka",
        sponsors: "partnerzy, wystawcy, pakiety, stoiska, reklama, banery",
        terms: "regulamin, zgody, RODO, polityka prywatności, oświadczenia",
        registration: "bilety, wejściówki, zapisy, formularz zgłoszenia, lista oczekujących",
        content: "agenda, sesje, program, prelegenci, ścieżki, sale",
        meetings: "networking, matchmaking, stoliki, rozmowy 1:1, kalendarz",
        communications: "e-maile, powiadomienia, przypomnienia, wysyłki, newsletter",
        onsite: "QR, skaner, check-in, badge, identyfikator, odprawa",
        integrations: "API, webhooki, CRM, eksport, synchronizacja",
        analytics: "statystyki, raporty, frekwencja, wykresy, dane",
        features: "moduły, rozszerzenia, opcje, ustawienia dodatkowe",
      },

      nav: {
        label: "Sekcje wydarzenia",
        openEvent: "Otwórz wydarzenie",
        openEventDraft:
          "Strona wydarzenia powstanie po publikacji - szkic nie ma jeszcze adresu publicznego.",
        searchPlaceholder: "Szukaj w wydarzeniu…",
        searchEmpty: "Żadna sekcja nie pasuje do tego zapytania.",
      },

      topBar: {
        studio: "Studio wydarzenia",
        preview: "Podgląd wydarzenia",
        publish: "Opublikuj wydarzenie",
      },

      actions: {
        save: "Zapisz zmiany",
        discard: "Odrzuć zmiany",
        saving: "Zapisywanie…",
      },

      toasts: {
        generalSaved: "Informacje ogólne zapisane",
        pagesSaved: "Strony i menu zapisane",
        brandingSaved: "Branding wydarzenia zapisany",
        visibilitySaved: "Widoczność wydarzenia zapisana",
        status: {
          draft: "Wydarzenie wróciło do szkiców",
          published: "Wydarzenie opublikowane",
          cancelled: "Wydarzenie odwołane",
        },
      },

      // ODMOWY BAZY, JEDNA DO JEDNEJ Z GŁOWĄ KOMUNIKATU plpgsql.
      // `adminEventStudioErrorKey` zamienia `slug_taken` na `slugTaken` i pyta
      // `i18n.exists` - klucz nieobecny degraduje do `unknown`, więc brak wpisu
      // NIE wywala ekranu, tylko po cichu gubi powód. Stąd komplet: każdy
      // `RAISE EXCEPTION` z migracji studia ma tu swoje zdanie, a zdanie mówi,
      // co zrobić, żeby zapis przeszedł.
      errors: {
        notFound:
          "Tego wydarzenia nie ma w tej organizacji. Wróć na listę i otwórz je jeszcze raz.",
        invalidEvent: "Brakuje identyfikatora wydarzenia. Otwórz wydarzenie z listy jeszcze raz.",
        invalidTitles: "Tytuł jest wymagany w obu językach. Uzupełnij PL i EN, zanim zapiszesz.",
        invalidSlug: "Adres może mieć od 3 do 120 znaków: małe litery, cyfry i myślniki.",
        slugTaken: "Inne wydarzenie ma już ten adres. Zmień końcówkę adresu i zapisz ponownie.",
        invalidStartsAt: "Podaj datę początku - bez niej wydarzenia nie da się zapisać.",
        invalidEndsAt: "Koniec musi wypadać po początku. Popraw jedną z dat i zapisz ponownie.",
        invalidFormat: "Format może być tylko stacjonarny, online albo hybrydowy.",
        invalidVideoPlatform:
          "Nagłówek wideo obsługuje YouTube i Vimeo. Wybierz jedną z tych platform.",
        coverRequired:
          "Nagłówek wideo nie zastępuje okładki - miniatura w katalogu, karcie społecznościowej i e-mailu bierze się z obrazu. Dodaj okładkę.",
        invalidSupportEmail:
          "Adres kontaktowy nie wygląda na poprawny e-mail. Popraw go albo zostaw pole puste.",
        invalidHashtag:
          "Hashtag może zawierać wyłącznie litery, cyfry i podkreślenia - bez spacji i bez znaku #.",
        invalidLanguages: "Wskaż przynajmniej jeden język treści wydarzenia.",
        invalidGuestMode:
          "Wybierz, co widzi osoba niezapisana: nic, opis i agendę albo pełną treść bez kontaktów.",
        invalidStatus: "Status wydarzenia to szkic, opublikowane albo odwołane.",
        invalidAppearance: "Motyw wydarzenia może być jasny albo ciemny.",
        invalidColor:
          "Kolor zapisuje się jako #RRGGBB. Popraw wartość albo wyczyść pole, żeby dziedziczyć kolor z motywu serwisu.",
        invalidImage:
          "Obraz tła musi być pełnym adresem https. Wklej cały adres albo wyczyść pole.",
        forbidden:
          "Twoje konto nie ma uprawnień redaktora w tej organizacji. Poproś administratora o dostęp.",
        unknown:
          "Baza odrzuciła zapis i nie podała powodu, który umiemy nazwać. Odśwież ekran i spróbuj jeszcze raz.",
      },

      // ETYKIETY PÓL ekranu „Informacje ogólne". Powody odrzucenia i ostrzeżenia
      // tego samego ekranu stoją w `adminEvents.general` - tamte klucze wskazuje
      // czysty moduł reguł (`eventGeneralDraft.ts`), który nie zna tej gałęzi.
      general: {
        basics: "Podstawy",
        basicsDescription:
          "Nazwa, adres publiczny i termin. To te dane trafiają do katalogu, do wyszukiwarek i do każdego e-maila o wydarzeniu.",
        nameLabel: "Nazwa wydarzenia",
        urlLabel: "Adres publiczny",
        urlHint:
          "Zmiana adresu opublikowanego wydarzenia psuje linki w wysłanych już e-mailach i postach - stare adresy przestają prowadzić do strony.",
        editUrl: "Odblokuj edycję adresu",
        beginsLabel: "Początek",
        endsLabel: "Koniec",
        timeZoneLabel: "Strefa czasowa",
        contentLanguage: "Przełącz język edytowanej treści",
        cover: "Okładka i nagłówek",
        coverDescription:
          "Okładka jest miniaturą w katalogu, w karcie społecznościowej i w e-mailu. Nagłówek wideo dokłada film na stronie, ale okładki nie zastępuje.",
        coverLabel: "Obraz okładki",
        videoPlatformLabel: "Platforma wideo",
        videoIdLabel: "Identyfikator materiału",
        videoIdPlaceholder: "aBc123XyZ_0 albo cały adres",
        videoIdHint:
          "Możesz wkleić cały adres z paska przeglądarki - identyfikator wyciągniemy z niego sami.",
        format: "Format",
        formatDescription:
          "Format decyduje, czego strona wydarzenia oczekuje od uczestnika: dojazdu, linku albo obu naraz.",
        location: "Miejsce",
        locationDescription:
          "Adres pokazuje się na stronie wydarzenia, w mapie dojazdu i w danych strukturalnych, które czytają wyszukiwarki.",
        venueLabel: "Nazwa miejsca",
        streetLabel: "Ulica i numer",
        cityLabel: "Miasto",
        regionLabel: "Region",
        postalLabel: "Kod pocztowy",
        countryLabel: "Kraj",
        resetLocation: "Wyczyść adres",
        information: "Opis wydarzenia",
        informationDescription:
          "Kilka zdań, które uczestnik czyta jako pierwsze - w katalogu, w podglądzie linku i na górze strony wydarzenia.",
        informationLabel: "Streszczenie",
        informationHint:
          "To jest krótkie streszczenie tekstowe. Bogata treść - sekcje, obrazy, prelegenci - powstaje na stronie wydarzenia w builderze.",
        hashtag: "Hashtag",
        hashtagDescription:
          "Wspólna etykieta wydarzenia w mediach społecznościowych. Dokleja ją stopka e-maila i karta wydarzenia.",
        hashtagLabel: "Hashtag wydarzenia",
        hashtagPlaceholder: "KongresCEE2026",
        languages: "Języki treści",
        languagesDescription:
          "Informacja dla uczestnika, w jakich językach prowadzone są sesje i materiały.",
        languagesHint:
          "To nie jest przełącznik języka panelu ani serwisu - te zostają polskie i angielskie. Zaznaczenie arabskiego obiecuje sesje po arabsku, a nie arabski interfejs.",
        support: "Kontakt do organizatora",
        supportDescription:
          "Adres, pod który uczestnik napisze z pytaniem. Trafia na stronę wydarzenia i w stopkę e-maili.",
        supportLabel: "E-mail wsparcia",
        eventId: "Identyfikator wydarzenia",
        eventIdDescription:
          "Podaj go w zgłoszeniu do wsparcia albo w konfiguracji integracji - jednoznacznie wskazuje to wydarzenie.",
        copyId: "Skopiuj identyfikator",
        copyFailed:
          "Przeglądarka nie pozwoliła skopiować identyfikatora. Zaznacz go i skopiuj ręcznie.",
      },

      pages: {
        homeDesign: "Układ strony głównej",
        homeDesignDescription:
          "Decyduje, ile swobody ma strona główna wydarzenia: gotowy zestaw sekcji albo pełna kompozycja w builderze.",
        advanced: "Zaawansowany",
        advancedDescription:
          "Strona główna otwiera się w builderze do pełnej kompozycji - własne sekcje, własna kolejność, własne bloki.",
        standard: "Standard",
        standardDescription:
          "Zamknięty preset startowy z gotowym układem sekcji. Nie wyłącza buildera - przełączenie na zaawansowany otwiera tę samą stronę do edycji.",
        customize: "Dostosuj w builderze",
        noRootPage: "Wydarzenie nie ma jeszcze strony głównej.",
        noRootPageLong:
          "Wydarzenie nie ma jeszcze żadnej strony. Utwórz pierwszą, żeby menu miało co pokazywać.",
        displayMode: "Prezentacja podstron",
        displayModeDescription: "Sposób, w jaki uczestnik widzi listę podstron wydarzenia.",
        grid: "Kafle",
        list: "Lista",
        pages: "Strony wydarzenia",
        pagesDescription: "Podstrony wydarzenia i to, które z nich siedzą w menu.",
        createPage: "Nowa strona",
        menuPages: "W menu",
        otherPages: "Pozostałe",
        menuEmpty: "Żadna strona nie jest jeszcze przypięta do menu.",
        otherEmpty: "Wszystkie strony wydarzenia są w menu.",
        menuMapping:
          "Podział na strony w menu i pozostałe liczy się dziś z kolejności menu (menu_order) - to mapowanie tymczasowe. Docelowo zdecyduje o nim osobne przypięcie strony do wydarzenia.",
      },

      groupsPage: {
        groups: "Grupy uczestników",
        groupsDescription:
          "Grupy decydują, kto widzi które treści i kto z kim może umówić spotkanie.",
        publicVisibility: "Widoczność publiczna",
        publicVisibilityDescription:
          "Co widzi ktoś, kto trafił na stronę wydarzenia bez zapisu i bez konta.",
        guestMode: "Pokaż wydarzenie osobom niezapisanym",
        guestModeDescription:
          "Wyłączone - strona wydarzenia istnieje wyłącznie dla zapisanych, a dla reszty zwraca stronę nieznalezioną.",
        guestsVisibility: "Co widzi osoba niezapisana",
        guestsVisibilityDescription:
          "Zakres treści dostępny bez zapisu. Dane kontaktowe uczestników nie wychodzą poza zapisanych w żadnym z wariantów.",
        guestModeHints: {
          teaser: "Opis wydarzenia i agenda - bez kontaktów do uczestników i bez materiałów.",
          full: "Pełna treść wydarzenia razem z materiałami, ale bez danych kontaktowych uczestników.",
        },
        chathamWarning:
          "Zasada Chatham House jest włączona: publiczna lista uczestników i nagranie w trybie gościa są wykluczone - wypowiedzi nie mogą dać się przypisać do osób.",
      },

      overview: {
        summary: "Wydarzenie w liczbach",
        summaryDescription:
          "Dane na żywo z rejestracji, agendy, grup i sponsorów. Kreska znaczy, że dane jeszcze się wczytują albo nie ma czego liczyć.",
        registrations: "Zapisani",
        seatsLeft: "Wolne miejsca",
        sessions: "Sesje",
        groups: "Grupy",
        sponsors: "Sponsorzy",
        startsAt: "Początek",
        nextSteps: "Następne kroki",
        nextStepsDescription:
          "Lista liczy się ze stanu wydarzenia - krok znika, gdy dana jest na miejscu, a nie po odhaczeniu.",
        steps: {
          cover: "Dodaj okładkę wydarzenia",
          description: "Napisz opis wydarzenia",
          location: "Uzupełnij adres miejsca",
          sessions: "Zbuduj agendę z sesji",
          groups: "Utwórz grupy uczestników",
          publish: "Opublikuj wydarzenie",
        },
      },

      preview: {
        title: "Podgląd na żywo",
        draftNotice: "Tak wydarzenie wygląda po publikacji",
        desktop: "Widok na komputerze",
        mobile: "Widok na telefonie",
        expand: "Powiększ podgląd",
        collapse: "Zmniejsz podgląd",
        close: "Zamknij podgląd",
        openPublic: "Otwórz stronę wydarzenia w nowej karcie",
        register: "Zarejestruj się",
        about: "O wydarzeniu",
        languages: "Języki",
        support: "Kontakt",
        untitled: "Wydarzenie bez nazwy",
        noDate: "Termin do ustalenia",
      },

      // SEKCJE, KTÓRYCH PRACA DZIEJE SIĘ DZIŚ W MODULE GLOBALNYM PANELU.
      // Opis mówi, GDZIE ta praca jest teraz i co przyjdzie per wydarzenie -
      // pusty ekran z napisem „wkrótce" nie mówi ani jednego, ani drugiego,
      // więc redaktor szuka wysyłki po całym panelu.
      external: {
        communicationsTitle: "Komunikacja",
        communicationsDescription:
          "Wysyłki do uczestników prowadzi dziś moduł komunikacji całego panelu - tam stoją szablony, listy odbiorców i historia wysyłek. Per wydarzenie przyjdą tu sekwencje przypomnień i podsumowanie wysyłek tego wydarzenia.",
        integrationsTitle: "Integracje",
        integrationsDescription:
          "Klucze API, webhooki i połączenia z systemami zewnętrznymi ustawia się dziś raz dla całej organizacji. Per wydarzenie przyjdą tu mapowania pól i wybór, które integracje obsługują to wydarzenie.",
        analyticsTitle: "Analityka",
        analyticsDescription:
          "Ruch, źródła wejść i konwersje zbiera moduł analityki panelu. Per wydarzenie przyjdą tu lejek rejestracji, frekwencja na sesjach i raport po wydarzeniu.",
        featuresTitle: "Funkcje dodatkowe",
        featuresDescription:
          "Włączanie modułów i rozszerzeń należy dziś do ustawień organizacji i planu. Per wydarzenie przyjdzie tu wybór, które funkcje są aktywne na tym wydarzeniu.",
        openModule: "Otwórz moduł",
      },
    },

    // WALIDACJA I OSTRZEŻENIA EKRANU „INFORMACJE OGÓLNE".
    // Gałąź stoi OBOK `studio.general`, a nie w środku, bo wskazuje ją czysty
    // moduł reguł `lib/events/eventGeneralDraft.ts` - liść bez Reacta i bez
    // i18next, który zna wyłącznie napisy kluczy. Sklejanie ich z prefiksu
    // `adminEvents.general.errors.` w jednym miejscu trzyma reguły i teksty
    // w tej samej odległości od siebie co reguły w bazie i ich komunikaty.
    //
    // OSTRZEŻENIE TO NIE BŁĄD. Blokada zapisu przy braku adresu zmuszałaby do
    // wpisania adresu, zanim organizator zna miejsce - dlatego te trzy zdania
    // opisują SKUTEK, a nie zakaz.
    general: {
      errors: {
        titleRequired: "Tytuł jest wymagany w obu językach.",
        slugInvalid: "Adres może mieć od 3 do 120 znaków: małe litery, cyfry i myślniki.",
        startsAtRequired: "Podaj datę początku wydarzenia.",
        endsBeforeStart: "Koniec musi wypadać po początku.",
        timezoneRequired:
          "Wybierz strefę czasową - od niej zależą godziny na stronie i w przypomnieniach.",
        coverRequiredForVideo:
          "Nagłówek wideo nadal wymaga okładki: miniatura w katalogu, w karcie społecznościowej i w e-mailu bierze się z obrazu.",
        hashtagInvalid:
          "Hashtag może zawierać tylko litery, cyfry i podkreślenia - bez spacji i bez znaku #.",
        supportEmailInvalid: "To nie wygląda na poprawny adres e-mail.",
        languagesRequired: "Wskaż przynajmniej jeden język treści wydarzenia.",
      },

      warnings: {
        addressMissing:
          "Wydarzenie odbywa się na miejscu, a nie ma adresu - uczestnik nie zobaczy, dokąd ma dojechać.",
        coverMissing:
          "Bez okładki katalog, karta społecznościowa i e-mail pokażą samą nazwę na pustym tle.",
        veryLong:
          "Wydarzenie trwa dłużej niż 30 dni. Sprawdź rok w dacie końca - literówka kosztuje przypomnienia wysłane do wszystkich zapisanych.",
      },

      // Nazwy własne platform - identyczne w obu językach, jak `formats.online`.
      videoPlatforms: {
        youtube: "YouTube",
        vimeo: "Vimeo",
      },
    },

    // BRANDING JEDNEGO WYDARZENIA.
    // PUSTY SLOT = DZIEDZICZENIE Z MOTYWU SERWISU, a nie biel - i tak to trzeba
    // nazwać na ekranie, bo inaczej redaktor wpisuje dzisiejsze kolory ręcznie
    // i wydarzenie przestaje nadążać za zmianą marki. Z tego samego powodu
    // „Przywróć branding społeczności" CZYŚCI wartości, zamiast wpisywać kopię
    // dzisiejszego motywu.
    branding: {
      appearance: "Motyw",
      appearanceDescription:
        "Jasny albo ciemny wariant strony wydarzenia. Kolory poniżej kładą się na wybrany wariant.",
      light: "Jasny",
      dark: "Ciemny",
      colors: "Kolory",
      colorsDescription:
        "Pusty slot znaczy dziedziczenie z motywu serwisu, a nie biel - dzięki temu wydarzenie nadąża za zmianą marki.",
      background: "Tło strony",
      backgroundDescription:
        "Obraz pod całą stroną wydarzenia. Zostawiony pusty - strona bierze tło z motywu.",
      backgroundImageLabel: "Adres obrazu tła",
      backgroundImageHint: "Pełny adres https do pliku graficznego. Puste pole = bez własnego tła.",
      inheritedPlaceholder: "dziedziczony",
      resetToCommunity: "Przywróć branding społeczności",

      slots: {
        navigation: "Nawigacja",
        mainAction: "Główna akcja",
        text: "Tekst",
        blocksBackground: "Tło bloków",
        pageBackground: "Tło strony",
      },

      hints: {
        navigation: "Pasek menu na górze strony wydarzenia.",
        mainAction: "Główne przyciski, w tym zapis na wydarzenie.",
        text: "Cała treść pisana na stronie wydarzenia.",
        blocksBackground: "Tło kart i bloków treści.",
        pageBackground: "Tło całej strony pod blokami.",
      },

      errors: {
        colorInvalid:
          "Kolor zapisuje się jako #RRGGBB. Wyczyść pole, żeby dziedziczyć kolor z motywu serwisu.",
        imageInvalid: "Obraz tła musi być pełnym adresem https.",
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

    studio: {
      sections: {
        overview: "Dashboard",
        general: "General information",
        pages: "Pages and menu",
        groups: "Groups and permissions",
        branding: "Branding",
        sponsors: "Sponsors and advertising",
        terms: "Terms",
        registration: "In-app registration",
        content: "Content",
        meetings: "Meetings",
        communications: "Communications",
        onsite: "On site",
        integrations: "Integrations",
        analytics: "Analytics",
        features: "Extra features",
      },

      groups: {
        builder: "Event builder",
      },

      keywords: {
        general: "name, address, dates, time zone, cover, hashtag, languages, video",
        pages: "menu, subpages, home layout, builder, navigation",
        groups: "permissions, visibility, guests, attendees",
        branding: "colours, theme, background, appearance, brand",
        sponsors: "partners, exhibitors, packages, booths, advertising, banners",
        terms: "terms, consents, GDPR, privacy policy, declarations",
        registration: "tickets, passes, sign-ups, application form, waiting list",
        content: "agenda, sessions, programme, speakers, tracks, rooms",
        meetings: "networking, matchmaking, tables, one-to-one, calendar",
        communications: "e-mails, notifications, reminders, campaigns, newsletter",
        onsite: "QR, scanner, check-in, badge, front desk, door",
        integrations: "API, webhooks, CRM, export, sync",
        analytics: "statistics, reports, attendance, charts, data",
        features: "modules, extensions, options, extra settings",
      },

      nav: {
        label: "Event sections",
        openEvent: "Open the event",
        openEventDraft:
          "The public page appears once the event is published - a draft has no public address yet.",
        searchPlaceholder: "Search in this event…",
        searchEmpty: "No section matches this query.",
      },

      topBar: {
        studio: "Event studio",
        preview: "Preview event",
        publish: "Publish event",
      },

      actions: {
        save: "Save changes",
        discard: "Discard changes",
        saving: "Saving…",
      },

      toasts: {
        generalSaved: "General information saved",
        pagesSaved: "Pages and menu saved",
        brandingSaved: "Event branding saved",
        visibilitySaved: "Event visibility saved",
        status: {
          draft: "The event is back in drafts",
          published: "Event published",
          cancelled: "Event cancelled",
        },
      },

      errors: {
        notFound:
          "This event does not exist in this organisation. Go back to the list and open it again.",
        invalidEvent: "The event id is missing. Open the event from the list again.",
        invalidTitles: "The title is required in both languages. Fill in PL and EN before saving.",
        invalidSlug: "The address takes 3 to 120 characters: lowercase letters, digits and dashes.",
        slugTaken: "Another event already uses this address. Change the ending and save again.",
        invalidStartsAt: "Give a start date - the event cannot be saved without one.",
        invalidEndsAt: "The end must fall after the start. Fix one of the dates and save again.",
        invalidFormat: "The format can only be on site, online or hybrid.",
        invalidVideoPlatform: "The video header supports YouTube and Vimeo. Pick one of them.",
        coverRequired:
          "A video header does not replace the cover - the thumbnail in the catalogue, in the social card and in the e-mail comes from the image. Add a cover.",
        invalidSupportEmail:
          "The contact address is not a valid e-mail. Fix it or leave the field empty.",
        invalidHashtag:
          "A hashtag may contain letters, digits and underscores only - no spaces and no # sign.",
        invalidLanguages: "Pick at least one content language for the event.",
        invalidGuestMode:
          "Choose what a non-attendee sees: nothing, the description and agenda, or the full content without contacts.",
        invalidStatus: "The event status is draft, published or cancelled.",
        invalidAppearance: "The event appearance can be light or dark.",
        invalidColor:
          "A colour is written as #RRGGBB. Fix the value, or clear the field to inherit the colour from the site theme.",
        invalidImage:
          "The background image must be a full https address. Paste the whole address or clear the field.",
        forbidden:
          "Your account is not an editor in this organisation. Ask an administrator for access.",
        unknown:
          "The database refused the save and gave no reason we can name. Refresh the screen and try again.",
      },

      general: {
        basics: "Basics",
        basicsDescription:
          "Name, public address and dates. This is what goes to the catalogue, to search engines and to every e-mail about the event.",
        nameLabel: "Event name",
        urlLabel: "Public address",
        urlHint:
          "Changing the address of a published event breaks the links already sent in e-mails and posts - the old addresses stop leading to the page.",
        editUrl: "Unlock the address for editing",
        beginsLabel: "Starts",
        endsLabel: "Ends",
        timeZoneLabel: "Time zone",
        contentLanguage: "Switch the language of the content being edited",
        cover: "Cover and header",
        coverDescription:
          "The cover is the thumbnail in the catalogue, in the social card and in the e-mail. A video header adds a film on the page but does not replace the cover.",
        coverLabel: "Cover image",
        videoPlatformLabel: "Video platform",
        videoIdLabel: "Video id",
        videoIdPlaceholder: "aBc123XyZ_0 or the whole address",
        videoIdHint:
          "You can paste the whole address from the browser bar - we pull the id out of it.",
        format: "Format",
        formatDescription:
          "The format decides what the event page expects from an attendee: travel, a link, or both at once.",
        location: "Location",
        locationDescription:
          "The address shows on the event page, on the map and in the structured data that search engines read.",
        venueLabel: "Venue name",
        streetLabel: "Street and number",
        cityLabel: "City",
        regionLabel: "Region",
        postalLabel: "Postal code",
        countryLabel: "Country",
        resetLocation: "Clear the address",
        information: "Event description",
        informationDescription:
          "The few sentences an attendee reads first - in the catalogue, in the link preview and at the top of the event page.",
        informationLabel: "Summary",
        informationHint:
          "This is a short plain-text summary. Rich content - sections, images, speakers - is composed on the event page in the builder.",
        hashtag: "Hashtag",
        hashtagDescription:
          "The shared social-media label of the event. The e-mail footer and the event card append it.",
        hashtagLabel: "Event hashtag",
        hashtagPlaceholder: "CEECongress2026",
        languages: "Content languages",
        languagesDescription:
          "Tells attendees which languages the sessions and materials are run in.",
        languagesHint:
          "This is not a language switch for the panel or the site - those stay Polish and English. Ticking Arabic promises sessions in Arabic, not an Arabic interface.",
        support: "Organiser contact",
        supportDescription:
          "The address an attendee writes to with a question. It goes on the event page and into the e-mail footer.",
        supportLabel: "Support e-mail",
        eventId: "Event id",
        eventIdDescription:
          "Quote it in a support request or in an integration setup - it points at this event unambiguously.",
        copyId: "Copy the id",
        copyFailed: "The browser refused to copy the id. Select it and copy it by hand.",
      },

      pages: {
        homeDesign: "Home page layout",
        homeDesignDescription:
          "Decides how much freedom the event home page has: a ready set of sections, or full composition in the builder.",
        advanced: "Advanced",
        advancedDescription:
          "The home page opens in the builder for full composition - your own sections, your own order, your own blocks.",
        standard: "Standard",
        standardDescription:
          "A closed starter preset with a ready section layout. It does not switch the builder off - moving to advanced opens the same page for editing.",
        customize: "Customise in the builder",
        noRootPage: "This event has no home page yet.",
        noRootPageLong:
          "This event has no page at all yet. Create the first one so the menu has something to show.",
        displayMode: "Subpage presentation",
        displayModeDescription: "How an attendee sees the list of event subpages.",
        grid: "Grid",
        list: "List",
        pages: "Event pages",
        pagesDescription: "The event subpages and which of them sit in the menu.",
        createPage: "New page",
        menuPages: "In the menu",
        otherPages: "Other",
        menuEmpty: "No page is pinned to the menu yet.",
        otherEmpty: "Every event page is in the menu.",
        menuMapping:
          "The split between menu pages and the rest is derived today from the menu order (menu_order) - a temporary mapping. In the end a separate pinning of a page to the event will decide it.",
      },

      groupsPage: {
        groups: "Attendee groups",
        groupsDescription:
          "Groups decide who sees which content and who can arrange a meeting with whom.",
        publicVisibility: "Public visibility",
        publicVisibilityDescription:
          "What someone who lands on the event page without signing up and without an account sees.",
        guestMode: "Show the event to people who have not signed up",
        guestModeDescription:
          "When off, the event page exists only for people who signed up; everyone else gets a not-found page.",
        guestsVisibility: "What a non-attendee sees",
        guestsVisibilityDescription:
          "How much content is available without signing up. Attendee contact details stay inside the signed-up group in either option.",
        guestModeHints: {
          teaser: "The event description and the agenda - no attendee contacts and no materials.",
          full: "The full event content with materials, but without attendee contact details.",
        },
        chathamWarning:
          "The Chatham House rule is on: a public attendee list and a recording in guest mode are ruled out - remarks must not be attributable to people.",
      },

      overview: {
        summary: "The event in numbers",
        summaryDescription:
          "Live data from registrations, the agenda, groups and sponsors. A dash means the data is still loading or there is nothing to count.",
        registrations: "Registered",
        seatsLeft: "Seats left",
        sessions: "Sessions",
        groups: "Groups",
        sponsors: "Sponsors",
        startsAt: "Starts",
        nextSteps: "Next steps",
        nextStepsDescription:
          "The list is derived from the state of the event - a step disappears when the data is in place, not when it is ticked off.",
        steps: {
          cover: "Add the event cover",
          description: "Write the event description",
          location: "Fill in the venue address",
          sessions: "Build the agenda out of sessions",
          groups: "Create attendee groups",
          publish: "Publish the event",
        },
      },

      preview: {
        title: "Live preview",
        draftNotice: "This is how the event looks once published",
        desktop: "Desktop view",
        mobile: "Mobile view",
        expand: "Expand the preview",
        collapse: "Shrink the preview",
        close: "Close the preview",
        openPublic: "Open the event page in a new tab",
        register: "Register",
        about: "About the event",
        languages: "Languages",
        support: "Contact",
        untitled: "Untitled event",
        noDate: "Date to be confirmed",
      },

      external: {
        communicationsTitle: "Communications",
        communicationsDescription:
          "Mailings to attendees run today in the panel-wide communications module - templates, recipient lists and the send history all live there. Per event, this screen will gain reminder sequences and the send summary of this event.",
        integrationsTitle: "Integrations",
        integrationsDescription:
          "API keys, webhooks and connections to outside systems are set today once for the whole organisation. Per event, this screen will gain field mappings and the choice of which integrations serve this event.",
        analyticsTitle: "Analytics",
        analyticsDescription:
          "Traffic, entry sources and conversions are collected by the panel analytics module. Per event, this screen will gain the registration funnel, session attendance and the post-event report.",
        featuresTitle: "Extra features",
        featuresDescription:
          "Turning modules and extensions on belongs today to the organisation and plan settings. Per event, this screen will gain the choice of which features are active on this event.",
        openModule: "Open the module",
      },
    },

    general: {
      errors: {
        titleRequired: "The title is required in both languages.",
        slugInvalid: "The address takes 3 to 120 characters: lowercase letters, digits and dashes.",
        startsAtRequired: "Give the event start date.",
        endsBeforeStart: "The end must fall after the start.",
        timezoneRequired:
          "Pick a time zone - the hours on the page and in the reminders follow it.",
        coverRequiredForVideo:
          "A video header still needs a cover: the thumbnail in the catalogue, in the social card and in the e-mail comes from the image.",
        hashtagInvalid:
          "A hashtag may contain letters, digits and underscores only - no spaces and no # sign.",
        supportEmailInvalid: "That does not look like a valid e-mail address.",
        languagesRequired: "Pick at least one content language for the event.",
      },

      warnings: {
        addressMissing:
          "The event takes place on site but has no address - attendees will not see where to travel.",
        coverMissing:
          "Without a cover the catalogue, the social card and the e-mail show only the name on an empty background.",
        veryLong:
          "The event runs longer than 30 days. Check the year in the end date - a typo costs reminders sent to everyone who signed up.",
      },

      videoPlatforms: {
        youtube: "YouTube",
        vimeo: "Vimeo",
      },
    },

    branding: {
      appearance: "Appearance",
      appearanceDescription:
        "The light or dark variant of the event page. The colours below sit on top of the variant you pick.",
      light: "Light",
      dark: "Dark",
      colors: "Colours",
      colorsDescription:
        "An empty slot means inheriting from the site theme, not white - that way the event keeps up when the brand changes.",
      background: "Page background",
      backgroundDescription:
        "An image behind the whole event page. Left empty, the page takes its background from the theme.",
      backgroundImageLabel: "Background image address",
      backgroundImageHint:
        "A full https address of an image file. An empty field means no background of its own.",
      inheritedPlaceholder: "inherited",
      resetToCommunity: "Restore the community branding",

      slots: {
        navigation: "Navigation",
        mainAction: "Main action",
        text: "Text",
        blocksBackground: "Blocks background",
        pageBackground: "Page background",
      },

      hints: {
        navigation: "The menu bar at the top of the event page.",
        mainAction: "The main buttons, the sign-up button included.",
        text: "All written content on the event page.",
        blocksBackground: "The background of cards and content blocks.",
        pageBackground: "The background of the whole page beneath the blocks.",
      },

      errors: {
        colorInvalid:
          "A colour is written as #RRGGBB. Clear the field to inherit the colour from the site theme.",
        imageInvalid: "The background image must be a full https address.",
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
