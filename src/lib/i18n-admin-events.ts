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

      // PASEK NARZĘDZI MA JEDEN RZĄD, a prawa trójka stałą kolejność: ustawienia
      // rzeczy, eksport, akcja główna. Etykieta ustawień nazywa RZECZ, którą się
      // ustawia, a nie ekran, na który prowadzi - redaktor szuka „rodzajów
      // wydarzeń”, nie „katalogu”. Oba gniazda są niezależnie opcjonalne, więc
      // ekran bez katalogu rodzajów nie potrzebuje żadnego z tych napisów.
      toolbar: {
        eventTypes: "Rodzaje wydarzeń",
        export: "Eksport",
      },

      // KRÓTKI PLACEHOLDER OBOK DŁUGIEGO, a nie zamiast niego. Pole szukania
      // w jednorzędowym pasku narzędzi jest węższe niż dawne pole nad tabelą,
      // więc pełne zdanie o tytule, adresie i miejscu ucinało się w połowie.
      // Długi wariant zostaje dla ekranów, które mają na niego miejsce.
      searchPlaceholderShort: "Szukaj wydarzeń",

      // NAGŁÓWKI KOLUMN TABELI. Osobne od `filters.*` i od `row.*`, bo napis
      // w nagłówku jest rzeczownikiem kolumny, a te dwa gniazda odmieniają go
      // pod swój kontekst („Wszystkie rodzaje”, „Zapisani: 12”).
      columns: {
        title: "Tytuł",
        date: "Termin",
        type: "Rodzaj",
        format: "Format",
        location: "Miejsce",
        status: "Status",
        registrations: "Zapisani",
        speakers: "Prelegenci",
      },

      // TE NAPISY CZYTA CZYTNIK EKRANU. Kolumna zaznaczania to same pola wyboru
      // bez widocznej etykiety, więc bez tych kluczy czytnik ogłasza „pole
      // wyboru” tyle razy, ile jest wierszy, i nie da się rozpoznać którego.
      select: {
        all: "Zaznacz wszystkie wydarzenia",
        row: "Zaznacz wydarzenie {{title}}",
        clear: "Odznacz wszystkie",
        // Liczba mnoga przez mechanizm i18next, nie jedna forma dla wszystkiego -
        // ten sam zabieg co `adminCommunityEvents.toasts.remindersSent`. Polski
        // ma trzy formy istotne dla liczebników (1 / 2-4 / 5+), angielski dwie,
        // dlatego EN nie powtarza `_few` i `_many` (i18next ich nie użyje).
        count_one: "Zaznaczono {{count}} wydarzenie",
        count_few: "Zaznaczono {{count}} wydarzenia",
        count_many: "Zaznaczono {{count}} wydarzeń",
        count_other: "Zaznaczono {{count}} wydarzeń",
      },

      // KIERUNEK SORTOWANIA JAKO OSOBNE SŁOWO, nie sklejony z nazwą kolumny.
      // Podwójna strzałka w nagłówku nie mówi czytnikowi niczego o kierunku,
      // a to on decyduje, czy redaktor patrzy na najbliższe czy najstarsze
      // wydarzenia.
      sort: {
        by: "Sortuj według {{column}}",
        asc: "Rosnąco",
        desc: "Malejąco",
      },

      range: "{{from}} - {{to}} z {{total}}",
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
        typePlaceholder: "Wybierz rodzaj",
        typeHint: "Widoczne są tylko rodzaje aktywne w tej organizacji.",
        titlePlLabel: "Tytuł PL",
        titleEnLabel: "Tytuł EN",
        startsAtLabel: "Początek",
        startsAtHint: "Koniec wyliczy się z czasu trwania rodzaju, jeśli rodzaj go zna.",
        endsAtLabel: "Koniec",
        timeZoneLabel: "Strefa czasowa",
        timeZoneHint: "W tej strefie uczestnik zobaczy godziny wydarzenia i sesji.",
        formatLabel: "Format",
        formatHint: "Format podpowiada rodzaj - możesz go zmienić dla tego wydarzenia.",
        cityLabel: "Miasto",
        countryLabel: "Kraj",
        placeHint: "Miejsce zapisujemy tylko dla wydarzeń stacjonarnych i hybrydowych.",
        onlineNoPlace: "Wydarzenie online nie ma adresu - miasto i kraj zostaną puste.",
        groups: {
          basics: "Podstawy",
          schedule: "Termin",
          place: "Format i miejsce",
          registration: "Rejestracja",
          inherited: "Przepisane z rodzaju",
        },
        externalUrlLabel: "Adres zapisów w systemie zewnętrznym",
        externalUrlHint:
          "Ten rodzaj prowadzi zapisy poza serwisem, więc adres jest wymagany - uczestnik zostanie do niego przekierowany zamiast zapisywać się u nas.",
        submitAction: "Utwórz szkic",
        cancelAction: "Anuluj",
        errors: {
          titles: "Tytuł jest wymagany w obu językach.",
          startsAt: "Termin początku jest wymagany.",
          endsAt: "Koniec musi być późniejszy niż początek.",
          timezone: "Wybierz strefę czasową wydarzenia.",
          format: "Format musi być stacjonarny, online albo hybrydowy.",
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
        // WYJATEK W TEJ GALEZI: pozostale PODPOZYCJE grup biora etykiety ze
        // slownikow swoich modulow, bo byly wczesniej zakladkami i te napisy juz
        // istnialy. „Ustawienia rejestracji" sa ekranem NOWYM - nie ma napisu,
        // z ktorym moglyby sie rozjechac, wiec stoja tam, gdzie etykiety
        // pozostalych ekranow studia.
        registrationSettings: "Ustawienia rejestracji",
        communications: "Komunikacja",
        integrations: "Integracje",
        analytics: "Analityka",
        features: "Funkcje dodatkowe",
      },

      // NAZWY GRUP SIDEBARA - nie ekranów. Grupa nie ma własnego ekranu:
      // klik prowadzi na jej pierwsze dziecko. Cztery z nich stały do tej zmiany
      // w `sections`, bo były wtedy POZYCJAMI z zakładkami w środku; po podziale
      // na podstrony ten sam napis jest nagłówkiem grupy, a nie tytułem ekranu -
      // trzymanie go w obu gałęziach dałoby dwa klucze na jeden napis.
      groups: {
        builder: "Kreator wydarzenia",
        registration: "Rejestracja w aplikacji",
        content: "Treść",
        meetings: "Spotkania",
        onsite: "Na miejscu",
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

        // Słowa PODPOZYCJI. Klucze wyżej opisują całe grupy („networking"
        // znajduje grupę „Spotkania"), te niżej trafiają w jeden ekran
        // („obłożenie" prowadzi wprost do statystyk spotkań).
        registrationSettings:
          "tryb zapisów, RSVP, widoczność, limit miejsc, pojemność, próg warstwy, cena wejściówki, waluta, transmisja, link do spotkania, nagranie, Chatham House",
        registrationList: "zgłoszenia, uczestnicy, lista zapisów, eksport, statusy",
        registrationTickets: "bilety, wejściówki, pule, cennik, limity miejsc",
        registrationPackages: "pakiety, grupy, delegacje, zamówienia zbiorowe, miejsca",
        registrationForm: "formularz, pola zgłoszenia, pytania, zgody w zapisie",
        contentSessions: "sesje, agenda, program, prelegenci, harmonogram",
        contentTracks: "ścieżki, bloki tematyczne, tory programu",
        contentRooms: "sale, miejsca sesji, audytoria, pokoje",
        contentConflicts: "kolizje, nakładające się sesje, ta sama sala, ten sam prelegent",
        meetingsTables: "stoliki, miejsca spotkań, strefa networkingu",
        meetingsSettings: "siatka, reguły, dostępność, długość spotkania, matchmaking",
        meetingsList: "spotkania 1:1, rozmowy, kalendarz spotkań, wnioski",
        meetingsStats: "statystyki spotkań, wykorzystanie stolików, obłożenie",
        onsiteDesk: "odprawa, check-in, skaner, QR, kod uczestnika",
        onsiteLog: "dziennik, historia wejść, zdarzenia odprawy, audyt",
        onsiteStats: "statystyki odprawy, frekwencja, obecność",
        onsiteCheckpoints: "punkty kontrolne, bramki, wejścia, kontrola dostępu",
        onsiteDevices: "urządzenia, terminale, skanery, tokeny dostępu",
        onsiteBadges: "identyfikatory, plakietki, druk, szablony badge",
        onsiteLeads: "leady, wizytówki sponsorów, kontakty ze stoiska",
      },

      nav: {
        label: "Sekcje wydarzenia",
        openEvent: "Otwórz wydarzenie",
        openEventDraft:
          "Strona wydarzenia powstanie po publikacji - szkic nie ma jeszcze adresu publicznego.",
        searchPlaceholder: "Szukaj w wydarzeniu…",
        searchEmpty: "Żadna sekcja nie pasuje do tego zapytania.",
        // DWA RÓŻNE WYJŚCIA, nie jedno: `backToList` wychodzi o poziom wyżej
        // (katalog wydarzeń w panelu), `openEvent` - do widoku publicznego.
        backToList: "Powrót do listy wydarzeń",
        expandGroup: "Rozwiń grupę",
        collapseGroup: "Zwiń grupę",
      },

      topBar: {
        studio: "Studio wydarzenia",
        preview: "Podgląd wydarzenia",
        // ETYKIETA PODGLĄDU JEST KONTEKSTOWA, a nie jedna dla całego studia. Na
        // ekranie kreatora formularza przycisk otwiera sam formularz zgłoszenia,
        // więc „Podgląd wydarzenia” obiecywałby stronę, której redaktor tam
        // nie zobaczy - i wróciłby sprawdzić, czy formularz w ogóle się zapisał.
        previewForm: "Podgląd formularza",
        publish: "Opublikuj wydarzenie",
      },

      // PIGUŁKA POMOCY WISI NA KOŃCU AKAPITU OPISU EKRANU, nie w pasku narzędzi,
      // dlatego jeden klucz obsługuje wszystkie ekrany studia: adres docelowy
      // wybiera komponent nagłówka, a napis jest wszędzie ten sam.
      help: {
        learnHow: "Dowiedz się jak",
      },

      actions: {
        save: "Zapisz zmiany",
        discard: "Odrzuć zmiany",
        saving: "Zapisywanie…",
      },

      toasts: {
        generalSaved: "Informacje ogólne zapisane",
        pagesSaved: "Strony i menu zapisane",
        pageCreated: "Podstrona utworzona",
        pageEntrySaved: "Pozycja menu zapisana",
        // POTWIERDZENIE MOWI, CZEGO NIE ZROBILISMY. Odpięcie wygląda jak
        // usunięcie, a strona zostaje - bez tego dopisku redaktor sprawdza to
        // dopiero w koszu stron.
        pageDetached: "Strona odpięta od wydarzenia - treść została",
        pageOrderSaved: "Kolejność menu zapisana",
        brandingSaved: "Branding wydarzenia zapisany",
        featuresSaved: "Funkcje dodatkowe zapisane",
        registrationSettingsSaved: "Ustawienia rejestracji zapisane",
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
        // ODMOWY EKRANU „USTAWIENIA REJESTRACJI". Każda z nich ma odpowiednik
        // w regułach czystych (`lib/events/registrationSettingsDraft.ts`), więc
        // redaktor normalnie ich nie zobaczy - te zdania są dla przypadku, w
        // którym baza jest OSTRZEJSZA od ekranu (zapis z innego klienta, stara
        // karta w przeglądarce, import). Bez nich mapper degraduje do `unknown`
        // i powód znika.
        invalidRegistrationMode:
          "Tryb zapisów to jedno z czterech: zapis jednym kliknięciem, formularz zgłoszenia, rejestracja zewnętrzna albo bez zapisów.",
        invalidRegistrationFlow:
          "Przebieg zapisu jest natychmiastowy albo wymaga akceptacji organizatora.",
        externalUrlRequired:
          "Rejestracja zewnętrzna zapisuje ludzi w innym serwisie, więc bez adresu nie ma gdzie ich odesłać. Podaj adres albo zmień tryb zapisów.",
        externalUrlInvalid:
          "Adres rejestracji zewnętrznej musi zaczynać się od https:// i mieć najwyżej 2048 znaków.",
        invalidVisibility: "Widoczność wydarzenia to publiczna albo tylko dla członków.",
        invalidCapacity:
          "Limit miejsc musi być liczbą większą od zera. Puste pole znaczy „bez limitu”.",
        invalidTierRank: "Ranga warstwy nie może być ujemna. Zero znaczy „bez progu”.",
        invalidPrice:
          "Cena nie może być ujemna, a najniższa kwota do zapłaty to 1,00. Puste pole znaczy „wydarzenie bezpłatne”.",
        invalidCurrency: "Waluta zapisuje się trzyliterowym kodem - dopuszczone są PLN i EUR.",
        invalidJoinUrl:
          "Adres transmisji musi zaczynać się od https://. Adres http to mieszana treść i ostrzeżenie przeglądarki dokładnie w chwili, w której uczestnik wchodzi na transmisję.",
        invalidRecordingUrl:
          "Adres nagrania musi zaczynać się od https://. Wyczyść pole, jeśli nagrania jeszcze nie ma.",
        invalidStatus: "Status wydarzenia to szkic, opublikowane albo odwołane.",
        invalidAppearance: "Motyw wydarzenia może być jasny albo ciemny.",
        invalidColor:
          "Kolor zapisuje się jako #RRGGBB. Popraw wartość albo wyczyść pole, żeby dziedziczyć kolor z motywu serwisu.",
        invalidImage:
          "Obraz tła musi być pełnym adresem https. Wklej cały adres albo wyczyść pole.",
        // ODMOWY Z `event_pages`. Wszystkie trzy są cichymi awariami, gdyby
        // przeszły: zła nazwa ikony daje znak zapytania w menu, brak wskazania
        // strony daje pozycję prowadzącą w nikąd, a grupa z obcego wydarzenia
        // znaczy „nikt" - i widać to dopiero, gdy uczestnik nie widzi strony.
        invalidIcon:
          "Nazwa ikony może zawierać wyłącznie małe litery, cyfry i myślniki - najwyżej 48 znaków. Katalog nazw jest w panelu pod adresem /admin/icons.",
        invalidPage:
          "Brakuje wskazania strony albo wydarzenia. Odśwież listę podstron i spróbuj jeszcze raz.",
        invalidGroup:
          "Jedna z zaznaczonych grup nie należy do tego wydarzenia. Odśwież ekran i zaznacz grupy jeszcze raz.",
        invalidFeature:
          "Moduł może być tylko włączony albo wyłączony. Odśwież ekran i przełącz go jeszcze raz.",
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

      // EKRAN „USTAWIENIA REJESTRACJI" - pierwsza podpozycja grupy „Rejestracja
      // w aplikacji". Te dziesięć pól dawało się do tej zmiany ustawić WYŁĄCZNIE
      // w starym dialogu `/admin/community/events`, więc studio pytało o tytuł
      // i termin, a o to, czy w ogóle da się zapisać - inny formularz w innej
      // sekcji panelu.
      //
      // POWODY ODRZUCENIA I OSTRZEŻENIA SĄ W TEJ SAMEJ GAŁĘZI, co etykiety, a nie
      // obok niej jak w `adminEvents.general`. Ten ekran ma jedno źródło reguł
      // (`lib/events/registrationSettingsDraft.ts`) i jedno źródło napisów -
      // rozdzielenie ich miało sens, gdy `studio.general` opisywało pola, a
      // `general.errors` reguły wspólne ze starym dialogiem; tutaj wspólnego
      // formularza nie ma.
      registrationSettings: {
        mode: "Tryb zapisów",
        modeDescription:
          "Decyduje, co się stanie, gdy uczestnik kliknie „Zapisz się” na stronie wydarzenia. To jedno ustawienie ustawia sens trzech pozostałych ekranów tej grupy.",
        modeHints: {
          rsvp: "Jedno kliknięcie i uczestnik jest na liście. Bez pytań i bez formularza - do webinarów, briefingów i spotkań otwartych.",
          form: "Uczestnik wypełnia formularz zgłoszenia, którego pola układasz w „Formularzu zapisu”.",
          external:
            "Zapisy prowadzi inny serwis. Przycisk na stronie odsyła pod podany adres, a lista zgłoszeń w panelu zostaje pusta.",
          none: "Wydarzenie informacyjne: strona jest, przycisku zapisu nie ma.",
        },
        externalUrlLabel: "Adres rejestracji zewnętrznej",
        externalUrlHint:
          "Pełny adres https, najwyżej 2048 znaków. Pole widać tylko przy tym trybie, ale adres zostaje zapisany także po zmianie trybu - nie musisz go wpisywać drugi raz, gdy wrócisz.",

        flow: "Przebieg zapisu",
        flowDescription: "Czy zgłoszenie wchodzi na listę od razu, czy czeka na Twoją decyzję.",
        flowHints: {
          instant:
            "Zgłoszenie jest potwierdzone natychmiast: uczestnik dostaje wejściówkę i wpis do kalendarza.",
          approval:
            "Zgłoszenie czeka na akceptację w „Zgłoszeniach”, a uczestnik widzi status „w rozpatrzeniu”.",
        },

        access: "Dostęp",
        accessDescription: "Kto widzi wydarzenie i kto może się na nie zapisać.",
        accessHint:
          "Próg warstwy i pierwszeństwo liczy baza przy każdym wejściu na stronę. To nie jest ukrycie sekcji w panelu, tylko realna reguła dostępu.",
        visibilities: {
          public: "Publiczne",
          members: "Tylko dla członków",
        },
        visibilityHints: {
          public:
            "Stronę wydarzenia widzi każdy, także osoba niezalogowana, i trafia ona do wyszukiwarek.",
          members:
            "Wydarzenie widzą wyłącznie zalogowani członkowie - poza logowaniem nie ma go ani w katalogu, ani w wyszukiwarkach.",
        },
        minTierLabel: "Próg warstwy członkostwa",
        minTierHint: "Najniższa ranga warstwy, która może się zapisać. Zero znaczy „bez progu”.",
        earlyRankLabel: "Pierwszeństwo od rangi",
        earlyRankHint:
          "Warstwy o tej randze i wyższej zapisują się PRZED otwarciem zapisów. Puste pole znaczy „bez pierwszeństwa”.",
        rsvpOpensLabel: "Otwarcie zapisów",
        rsvpOpensHint: "Puste pole znaczy „zapisy otwarte od publikacji wydarzenia”.",
        chathamHouseLabel: "Zasada Chatham House",
        chathamHouseHint:
          "Wypowiedzi wolno cytować bez przypisania do osoby. Uczestnik widzi tę informację przy zapisie i w materiałach po spotkaniu.",

        seats: "Miejsca i cena",
        seatsDescription: "Limit zapisów i kwota, którą uczestnik płaci za wejściówkę.",
        capacityLabel: "Limit miejsc",
        capacityHint:
          "Puste pole znaczy „bez limitu”. Po wyczerpaniu miejsc kolejne zgłoszenia trafiają na listę oczekujących.",
        priceLabel: "Cena wejściówki",
        priceHint:
          "Kwota w jednostkach głównych, na przykład 250,00 - nie w groszach. Puste pole znaczy „wydarzenie bezpłatne”; najniższa kwota do zapłaty to 1,00.",
        currencyLabel: "Waluta",

        stream: "Transmisja i nagranie",
        streamDescription:
          "Dwa adresy, które dostaje wyłącznie uczestnik z dostępem. Nie ma ich w publicznym HTML-u strony wydarzenia.",
        joinUrlLabel: "Adres transmisji",
        joinUrlHint:
          "Pełny adres https. Serwer oddaje go dopiero po sprawdzeniu dostępu (get_event_access), więc w źródle strony osoby niezapisanej go nie ma. Adres http to mieszana treść i ostrzeżenie przeglądarki dokładnie w chwili wejścia na transmisję.",
        recordingUrlLabel: "Adres nagrania",
        recordingUrlHint:
          "Pełny adres https, udostępniany po wydarzeniu tą samą bramką dostępu co transmisja. Puste pole znaczy „nagrania nie ma”.",

        errors: {
          externalUrlRequired:
            "Ten tryb zapisuje ludzi w innym serwisie - podaj adres, pod który mamy ich odesłać.",
          externalUrlInvalid: "Adres musi zaczynać się od https:// i nie zawierać spacji.",
          externalUrlTooLong: "Adres może mieć najwyżej 2048 znaków.",
          tierRankInvalid: "Ranga warstwy to liczba całkowita nie mniejsza od zera.",
          capacityInvalid:
            "Limit miejsc to liczba całkowita większa od zera. Zostaw pole puste, żeby nie ustawiać limitu.",
          priceInvalid:
            "Kwotę zapisz cyframi, z najwyżej dwiema cyframi po przecinku - na przykład 250,00.",
          priceTooLow:
            "Najniższa kwota do zapłaty to 1,00. Zostaw pole puste, jeśli wydarzenie ma być bezpłatne.",
          joinUrlInvalid: "Adres transmisji musi być pełnym adresem https, najwyżej 2048 znaków.",
          recordingUrlInvalid:
            "Adres nagrania musi być pełnym adresem https, najwyżej 2048 znaków.",
        },

        // OSTRZEŻENIE TO NIE BŁĄD: każde z tych czterech zdań opisuje SKUTEK
        // ustawienia, które da się zapisać, ale nie robi tego, czego się po nim
        // oczekuje. Blokada zapisu zmuszałaby do wpisania adresu transmisji,
        // zanim jest znany link ze Zooma.
        warnings: {
          onlineWithoutJoinUrl:
            "Wydarzenie jest online i przyjmuje zapisy, ale nie ma adresu transmisji - uczestnik dostanie potwierdzenie i nie będzie miał gdzie wejść.",
          earlyRankWithoutOpening:
            "Pierwszeństwo warstwy nic nie robi, dopóki zapisy nie mają daty otwarcia - nie ma przed czym być pierwszym.",
          pricedWithoutRegistration:
            "Cena jest ustawiona, a tryb zapisów to „bez zapisów” - nie ma jak jej zapłacić, bo nie ma zapisu.",
          chathamHouseOnPublicPage:
            "Zasada Chatham House przy publicznej stronie jest obietnicą, której strona nie dowozi: treść czyta każdy, także ten, kto zasady nie przyjął.",
        },
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

        // TRZY STANY PUSTEJ LISTY, TRZY ZDANIA. „Jeszcze nie wiem”,
        // „nie udało się” i „nic tu nie ma” to trzy różne informacje, a jeden
        // napis na wszystkie trzy każe redaktorowi zgadywać, czy ma czekać,
        // odświeżyć, czy działać.
        //
        // Napis „utwórz pierwszą stronę” zniknął razem z kluczem
        // `noRootPageLong`: od migracji 20260826181500 pięć stron zakłada się
        // samo przy wejściu na ten ekran, więc rada „utwórz pierwszą” była
        // instrukcją do czynności, której nikt już nie musi wykonywać.
        noPagesYet:
          "Nie widzimy tu żadnej strony, a pięć stron wydarzenia zakłada się samo przy wejściu na ten ekran. Odśwież ekran; jeśli lista nadal jest pusta, wydarzenie mogło zostać usunięte w innej karcie.",
        loadFailed:
          "Nie udało się wczytać podstron wydarzenia. Odśwież ekran - to nie znaczy, że wydarzenie nie ma stron.",
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
        loading: "Wczytywanie podstron…",

        // DWA STANY POZA MENU, DWIE NAZWY. Strona przypięta poza menu należy do
        // wydarzenia i ma już ikonę oraz widoczność; nieprzypięta leży pod stroną
        // główną, ale wydarzenie o niej nie wie. Jedna wspólna nazwa kazałaby
        // redaktorowi zgadywać, dlaczego jedna ma przycisk odpięcia, a druga nie.
        states: {
          attachedOutOfMenu: "poza menu",
          unattached: "nieprzypięta",

          // TRZECI STAN, KTÓREGO NIE DA SIĘ WYWNIOSKOWAĆ Z WIERSZA. Pozycja
          // modułowa wygląda jak każda inna, a ma o jeden przycisk mniej -
          // bez nazwy tego stanu brak odpięcia wygląda na awarię panelu.
          module: "stała pozycja",
        },

        rowActions: {
          moveUp: "Przesuń „{{label}}” wyżej w menu",
          moveDown: "Przesuń „{{label}}” niżej w menu",
          edit: "Edytuj pozycję menu „{{label}}”",
          editContent: "Edytuj treść strony",
          preview: "Pokaż zawartość „{{label}}” w podglądzie",
          detach: "Odepnij „{{label}}” od wydarzenia",
          addToMenu: "Dodaj do menu",
          keepOutOfMenu: "Trzymaj poza menu",

          // Wyjaśnienie przy znaczniku stałej pozycji - to samo, co RPC mówi
          // wyjątkiem `module_page`, tylko po polsku i zanim ktoś kliknie.
          moduleLocked:
            "„{{label}}” to jedna z pięciu stałych pozycji wydarzenia. Można ją ukryć przełącznikiem „Pokaż w menu wydarzenia”, ale nie można jej odpiąć - wróci przy następnym wejściu na ten ekran.",
        },

        entry: {
          title: "Pozycja menu",
          subtitle:
            "Etykieta, ikona, kolor i widoczność jednej pozycji menu. Tytuł, treść i adres strony zmienia się w edytorze stron.",
          labelSection: "Etykieta w menu",
          labelHint:
            "Puste pole znaczy „użyj tytułu strony”. Własna etykieta przydaje się, gdy tytuł jest zdaniem, a w menu mieszczą się dwa słowa.",
          menuLabelPl: "Etykieta PL",
          menuLabelEn: "Etykieta EN",
          appearanceSection: "Wygląd",
          icon: "Ikona",
          iconHint:
            "Nazwa pisana małymi literami z myślnikami, na przykład calendar-days. Pełny katalog nazw jest w panelu pod adresem /admin/icons. Puste pole daje ikonę domyślną.",
          iconInvalid:
            "Nazwa ikony może zawierać wyłącznie małe litery, cyfry i myślniki - najwyżej 48 znaków.",
          color: "Kolor",
          colorHint:
            "Kolor kafla i ikony w menu. Puste pole znaczy „weź kolor z brandingu wydarzenia”.",
          colorInvalid: "Kolor zapisuje się jako #RRGGBB - sześć znaków szesnastkowych.",
          colorPlaceholder: "z brandingu",
          colorPicker: "Wybierz kolor pozycji menu",
          visibilitySection: "Widoczność",
          inMenu: "Pokaż w menu wydarzenia",
          inMenuHint:
            "Wyłączone: strona zostaje przypięta do wydarzenia i działa pod swoim adresem, ale nie pojawia się ani w menu, ani w kaflach na stronie głównej.",
          visibilityHint:
            "Zaznacz grupy, które mają widzieć tę pozycję. Nic niezaznaczone znaczy „widoczna dla wszystkich” - także dla gości, którzy nie są zapisani.",
          visibilityNoGroups:
            "To wydarzenie nie ma jeszcze grup uczestników, więc pozycja jest widoczna dla wszystkich.",
          save: "Zapisz pozycję",
          cancel: "Anuluj",
        },

        create: {
          title: "Nowa podstrona wydarzenia",
          subtitle:
            "Strona powstanie pod stroną główną wydarzenia i od razu trafi do menu. Adres publiczny wyliczy się z tytułu.",
          titlePl: "Tytuł PL",
          titleEn: "Tytuł EN",
          icon: "Ikona (opcjonalnie)",
          iconHint:
            "Nazwa z katalogu ikon, na przykład calendar-days. Możesz ją dodać później w edytorze pozycji.",
          template: "Szablon strony",
          templateHint:
            "Szablon wstawia gotowe sekcje razem z blokami - zostaje podmiana treści. Układ zmienisz później w builderze.",
          draftHint:
            "Strona powstaje jako szkic - uczestnik zobaczy ją dopiero po opublikowaniu w edytorze stron.",
          submit: "Utwórz stronę",
          cancel: "Anuluj",
        },
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

      analytics: {
        registrations: "Zgłoszenia",
        registrationsDescription:
          "Liczby z modułu zapisów - te same, które widzisz na liście zgłoszeń. Kreska znaczy „jeszcze nie wiadomo”, a nie zero.",
        registrationsTotal: "Wszystkie zgłoszenia",
        approved: "Zatwierdzone",
        pending: "Oczekujące",
        waitlist: "Lista rezerwowa",
        seatsLeft: "Wolne miejsca",
        noCapacity: "Wydarzenie bez limitu miejsc",
        programme: "Program i spotkania",
        programmeDescription:
          "Sesje w programie oraz spotkania 1-1: ile się odbyło i jaki odsetek zaproszeń został przyjęty.",
        sessions: "Sesje w programie",
        meetingsHeld: "Spotkania odbyte",
        meetingsAcceptance: "Przyjęte zaproszenia",
        onsite: "Na miejscu",
        onsiteDescription:
          "Odprawa w dniu wydarzenia: kto przyszedł, kto się nie zjawił, ile identyfikatorów wydrukowano i ile leadów zebrali partnerzy.",
        arrived: "Odprawionych",
        noShow: "Nieobecnych",
        attendanceRate: "Frekwencja",
        walkIn: "Bez zapisu",
        badgesPrinted: "Wydrukowane identyfikatory",
        leadScans: "Zebrane leady",
        leadScansConsent: "Z aktywną zgodą: {{count}}",
        siteTraffic: "Ruch na stronie",
        siteTrafficDescription:
          "Odsłony, źródła wejść i konwersje liczy moduł analityki serwisu - wydarzenie nie ma osobnego licznika ruchu.",
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

      readiness: {
        title: "Gotowość do publikacji",
        description:
          "Warunki liczą się ze stanu wydarzenia. Blokada wstrzymuje publikację, ostrzeżenie tylko mówi, że strona będzie niepełna.",
        readyToPublish: "Wszystkie warunki blokujące spełnione - można publikować.",
        publishedOk: "Wydarzenie jest opublikowane i nie ma braków blokujących.",
        blocked_one: "{{count}} brak blokuje publikację.",
        blocked_few: "{{count}} braki blokują publikację.",
        blocked_many: "{{count}} braków blokuje publikację.",
        blocked_other: "{{count}} braków blokuje publikację.",
        progress: "{{passed}} z {{total}}",
        allDone: "Nic do uzupełnienia - wszystkie pozycje spełnione.",
        severity: {
          blocker: "Blokuje publikację",
          warning: "Zalecane przed publikacją",
        },
        checks: {
          title: "Uzupełnij tytuł po polsku i po angielsku",
          schedule: "Ustaw poprawny początek i koniec wydarzenia",
          timezone: "Wybierz strefę czasową wydarzenia",
          venue: "Uzupełnij miasto i adres miejsca",
          onlineUrl: "Dodaj link do transmisji online",
          cover: "Wgraj okładkę wydarzenia",
          description: "Napisz opis po polsku i po angielsku",
          sessions: "Dodaj przynajmniej jedną sesję do agendy",
          sessionDrafts_one: "{{count}} sesja czeka na publikację",
          sessionDrafts_few: "{{count}} sesje czekają na publikację",
          sessionDrafts_many: "{{count}} sesji czeka na publikację",
          sessionDrafts_other: "{{count}} sesji czeka na publikację",
          sessionSpeakers_one: "{{count}} sesja bez prelegenta",
          sessionSpeakers_few: "{{count}} sesje bez prelegenta",
          sessionSpeakers_many: "{{count}} sesji bez prelegenta",
          sessionSpeakers_other: "{{count}} sesji bez prelegenta",
          sessionRooms_one: "{{count}} sesja stacjonarna bez sali",
          sessionRooms_few: "{{count}} sesje stacjonarne bez sali",
          sessionRooms_many: "{{count}} sesji stacjonarnych bez sali",
          sessionRooms_other: "{{count}} sesji stacjonarnych bez sali",
          conflicts_one: "{{count}} kolizja w agendzie do rozwiązania",
          conflicts_few: "{{count}} kolizje w agendzie do rozwiązania",
          conflicts_many: "{{count}} kolizji w agendzie do rozwiązania",
          conflicts_other: "{{count}} kolizji w agendzie do rozwiązania",
          rooms: "Dodaj sale wydarzenia stacjonarnego",
          tickets: "Dodaj typ biletu dla płatnej rejestracji",
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
        pageEmpty: "Ta podstrona nie ma jeszcze żadnych bloków - dodaj je w edytorze stron.",
        noDate: "Termin do ustalenia",
        // Karta „Kiedy, gdzie" w podglądzie mówi TO SAMO, co formularz
        // „Informacje ogólne" - inaczej redaktor wpisuje pola, których nigdzie
        // nie widzi przed publikacją.
        endsLabel: "Koniec",
        formatLabel: "Format",
        // Podstrony modulowe czytaja PRAWDZIWE dane wydarzenia przez RPC panelu
        // - pustka znaczy tu "nic nie wpisano", a nie "podglad nie umie".
        moduleEmptyAgenda: "Program jest jeszcze pusty - dodaj sesje w zakładce Ścieżki.",
        moduleEmptySpeakers: "Nie ma jeszcze prelegentów - dodaj ich w Treści wydarzenia.",
        moduleEmptyAttendees: "Brak potwierdzonych zgłoszeń - lista wypełni się po rejestracjach.",
      },

      // EKRAN „FUNKCJE DODATKOWE" - siedem przełączników modułów wydarzenia.
      // OPIS MUSI POWIEDZIEĆ, CZEGO PRZEŁĄCZNIK NIE ROBI: „wyłącz" czyta się jak
      // „usuń dane" albo jak „ukryj przed uczestnikiem", a nie robi ani jednego,
      // ani drugiego - chowa POZYCJĘ W TYM PANELU. Dwa zdania w opisie sekcji są
      // więc częścią kontrolki, a nie ozdobą.
      features: {
        modulesLabel: "Moduły tego wydarzenia",
        modulesDescription:
          "Wyłączenie CHOWA sekcję w tym panelu i nie usuwa żadnych danych - zgłoszenia, sesje, stoliki i dziennik odprawy zostają na miejscu i wracają razem z pozycją po ponownym włączeniu.",
        notPublicVisibility:
          "To NIE jest widoczność publiczna. Tym, co widzi uczestnik, rządzą strony i sekcje wydarzenia - dwa przełączniki na tę samą rzecz znaczyłyby dwa miejsca, w których można ją wyłączyć, i jedno, które ktoś pamięta.",
        routesStayAlive:
          "Adres wyłączonej sekcji nadal działa: link zapisany w zakładkach albo wysłany współpracownikowi pokaże zdanie o wyłączonym module, a nie pusty ekran.",

        labels: {
          pages: "Strony i menu",
          registration: "Rejestracja w aplikacji",
          tickets: "Bilety i wejściówki",
          sessions: "Agenda i sesje",
          meetings: "Spotkania 1:1",
          onsite: "Odprawa na miejscu",
          sponsors: "Sponsorzy i reklama",
        },

        // ZDANIE MOWI, CO ZNIKNIE PO WYŁĄCZENIU. Sama etykieta „Spotkania" nie
        // różni stolików od wniosków o rozmowę, a to jest dokładnie ta różnica,
        // której redaktor szuka przed kliknięciem.
        hints: {
          pages:
            "Znika builder podstron i menu wydarzenia. Strona główna wydarzenia zostaje - wydarzenie na jednej stronie.",
          registration:
            "Znikają zgłoszenia, formularz zapisu i wejściówki. Dla wydarzeń, które prowadzą zapisy poza tą aplikacją albo nie prowadzą ich wcale.",
          tickets:
            "Znika ekran wejściówek, a zapisy zostają - wydarzenie z wolnym wstępem, bez pul i bez cennika.",
          sessions:
            "Znikają sesje, ścieżki, sale i kolizje - wydarzenie jednoblokowe, bez agendy do ułożenia.",
          meetings:
            "Znikają stoliki, siatka dostępności i wnioski o rozmowę 1:1 - wydarzenie bez giełdy spotkań.",
          onsite:
            "Znikają odprawa, skanery, punkty kontrolne, urządzenia i identyfikatory - webinar nie ma wejścia na miejscu.",
          sponsors:
            "Znika lista sponsorów i pakietów wraz z materiałami reklamowymi tego wydarzenia.",
        },

        // EKRAN SEKCJI, KTÓREJ MODUŁ JEST WYŁĄCZONY. Adres działa dalej, więc
        // zdanie musi powiedzieć dwie rzeczy: dlaczego pozycji nie ma w pasie
        // i że dane są na miejscu. Nazwa modułu wchodzi interpolacją - „ten
        // moduł" kazałoby zgadywać, który z siedmiu przełączników odkręcić.
        disabled: {
          title: "Moduł wyłączony dla tego wydarzenia",
          description:
            "Moduł „{{module}}” jest w tym wydarzeniu wyłączony, więc jego pozycja nie stoi w nawigacji - dane zostały na miejscu i wrócą razem z nią.",
          action: "Otwórz Funkcje dodatkowe",
        },
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

      toolbar: {
        eventTypes: "Event types",
        export: "Export",
      },

      searchPlaceholderShort: "Search events",

      columns: {
        title: "Title",
        date: "Date",
        type: "Type",
        format: "Format",
        location: "Location",
        status: "Status",
        registrations: "Registrations",
        speakers: "Speakers",
      },

      select: {
        all: "Select all events",
        row: "Select the {{title}} event",
        clear: "Clear selection",
        count_one: "{{count}} event selected",
        count_other: "{{count}} events selected",
      },

      sort: {
        by: "Sort by {{column}}",
        asc: "Ascending",
        desc: "Descending",
      },

      range: "{{from}} - {{to}} of {{total}}",
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
        typePlaceholder: "Choose a type",
        typeHint: "Only types active in this organisation are listed.",
        titlePlLabel: "Title PL",
        titleEnLabel: "Title EN",
        startsAtLabel: "Starts",
        startsAtHint: "The end time is derived from the type duration when the type knows one.",
        endsAtLabel: "Ends",
        timeZoneLabel: "Time zone",
        timeZoneHint: "Attendees see event and session hours in this zone.",
        formatLabel: "Format",
        formatHint: "The type suggests a format - you can change it for this event.",
        cityLabel: "City",
        countryLabel: "Country",
        placeHint: "The venue is stored for onsite and hybrid events only.",
        onlineNoPlace: "An online event has no venue - city and country stay empty.",
        groups: {
          basics: "Basics",
          schedule: "Schedule",
          place: "Format and venue",
          registration: "Registration",
          inherited: "Inherited from the type",
        },
        externalUrlLabel: "External registration url",
        externalUrlHint:
          "This type registers people outside the site, so the address is required - attendees are sent there instead of signing up here.",
        submitAction: "Create draft",
        cancelAction: "Cancel",
        errors: {
          titles: "The title is required in both languages.",
          startsAt: "A start date is required.",
          endsAt: "The end must be later than the start.",
          timezone: "Choose the event time zone.",
          format: "The format must be onsite, online or hybrid.",
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
        registrationSettings: "Registration settings",
        communications: "Communications",
        integrations: "Integrations",
        analytics: "Analytics",
        features: "Extra features",
      },

      groups: {
        builder: "Event builder",
        registration: "In-app registration",
        content: "Content",
        meetings: "Meetings",
        onsite: "On site",
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

        registrationSettings:
          "registration mode, RSVP, visibility, seat limit, capacity, tier threshold, ticket price, currency, stream, join link, recording, Chatham House",
        registrationList: "applications, attendees, sign-up list, export, statuses",
        registrationTickets: "tickets, passes, pools, pricing, seat limits",
        registrationPackages: "packages, groups, delegations, bulk orders, seats",
        registrationForm: "form, application fields, questions, sign-up consents",
        contentSessions: "sessions, agenda, programme, speakers, schedule",
        contentTracks: "tracks, thematic blocks, programme streams",
        contentRooms: "rooms, session venues, auditoriums",
        contentConflicts: "conflicts, overlapping sessions, same room, same speaker",
        meetingsTables: "tables, meeting places, networking area",
        meetingsSettings: "grid, rules, availability, meeting length, matchmaking",
        meetingsList: "one-to-one meetings, calls, meeting calendar, requests",
        meetingsStats: "meeting statistics, table usage, occupancy",
        onsiteDesk: "check-in, front desk, scanner, QR, attendee code",
        onsiteLog: "log, entry history, check-in events, audit",
        onsiteStats: "check-in statistics, attendance, turnout",
        onsiteCheckpoints: "checkpoints, gates, entrances, access control",
        onsiteDevices: "devices, terminals, scanners, access tokens",
        onsiteBadges: "badges, name tags, printing, badge templates",
        onsiteLeads: "leads, sponsor business cards, booth contacts",
      },

      nav: {
        label: "Event sections",
        openEvent: "Open the event",
        openEventDraft:
          "The public page appears once the event is published - a draft has no public address yet.",
        searchPlaceholder: "Search in this event…",
        searchEmpty: "No section matches this query.",
        backToList: "Back to the event list",
        expandGroup: "Expand group",
        collapseGroup: "Collapse group",
      },

      topBar: {
        studio: "Event studio",
        preview: "Preview event",
        previewForm: "Preview form",
        publish: "Publish event",
      },

      help: {
        learnHow: "Learn how",
      },

      actions: {
        save: "Save changes",
        discard: "Discard changes",
        saving: "Saving…",
      },

      toasts: {
        generalSaved: "General information saved",
        pagesSaved: "Pages and menu saved",
        pageCreated: "Subpage created",
        pageEntrySaved: "Menu entry saved",
        pageDetached: "The page is unpinned from the event - the content stayed",
        pageOrderSaved: "Menu order saved",
        brandingSaved: "Event branding saved",
        registrationSettingsSaved: "Registration settings saved",
        featuresSaved: "Extra features saved",
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
        invalidRegistrationMode:
          "The registration mode is one of four: one-click sign-up, application form, external registration or no sign-ups.",
        invalidRegistrationFlow:
          "The sign-up flow is either instant or waiting for the organiser to approve it.",
        externalUrlRequired:
          "External registration signs people up somewhere else, so without an address there is nowhere to send them. Give the address or change the registration mode.",
        externalUrlInvalid:
          "The external registration address must start with https:// and stay under 2048 characters.",
        invalidVisibility: "Event visibility is either public or members only.",
        invalidCapacity:
          "The seat limit must be a number greater than zero. An empty field means no limit.",
        invalidTierRank: "A tier rank cannot be negative. Zero means no threshold.",
        invalidPrice:
          "The price cannot be negative and the lowest payable amount is 1.00. An empty field means the event is free.",
        invalidCurrency: "The currency takes a three-letter code - PLN and EUR are allowed.",
        invalidJoinUrl:
          "The stream address must start with https://. An http address is mixed content and a browser warning at the exact moment an attendee joins the stream.",
        invalidRecordingUrl:
          "The recording address must start with https://. Clear the field if there is no recording yet.",
        invalidStatus: "The event status is draft, published or cancelled.",
        invalidAppearance: "The event appearance can be light or dark.",
        invalidColor:
          "A colour is written as #RRGGBB. Fix the value, or clear the field to inherit the colour from the site theme.",
        invalidImage:
          "The background image must be a full https address. Paste the whole address or clear the field.",
        invalidIcon:
          "An icon name may contain only lower-case letters, digits and hyphens - 48 characters at most. The catalogue of names is in the panel at /admin/icons.",
        invalidPage:
          "The page or the event is missing from the request. Refresh the subpage list and try again.",
        invalidGroup:
          "One of the ticked groups does not belong to this event. Refresh the screen and tick the groups again.",
        invalidFeature: "A module can only be on or off. Refresh the screen and switch it again.",
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

      registrationSettings: {
        mode: "Registration mode",
        modeDescription:
          "It decides what happens when an attendee clicks Sign up on the event page. This single setting gives meaning to the other three screens in this group.",
        modeHints: {
          rsvp: "One click and the attendee is on the list. No questions, no form - for webinars, briefings and open meetings.",
          form: "The attendee fills in an application form whose fields you arrange in Sign-up form.",
          external:
            "Another service runs the sign-ups. The button on the page sends people to the address you give, and the application list in the panel stays empty.",
          none: "An informational event: the page exists, the sign-up button does not.",
        },
        externalUrlLabel: "External registration address",
        externalUrlHint:
          "A full https address, at most 2048 characters. The field only shows for this mode, but the address is kept after you switch modes - you do not have to type it again when you come back.",

        flow: "Sign-up flow",
        flowDescription:
          "Whether an application joins the list right away or waits for your decision.",
        flowHints: {
          instant:
            "The application is confirmed immediately: the attendee gets a pass and a calendar entry.",
          approval:
            "The application waits for approval in Applications, and the attendee sees the status under review.",
        },

        access: "Access",
        accessDescription: "Who sees the event and who can sign up for it.",
        accessHint:
          "The tier threshold and the early access are computed by the database on every visit. This is not hiding a section in the panel - it is a real access rule.",
        visibilities: {
          public: "Public",
          members: "Members only",
        },
        visibilityHints: {
          public: "Anyone sees the event page, signed in or not, and search engines index it.",
          members:
            "Only signed-in members see the event - outside the login it appears neither in the catalogue nor in search engines.",
        },
        minTierLabel: "Membership tier threshold",
        minTierHint: "The lowest tier rank allowed to sign up. Zero means no threshold.",
        earlyRankLabel: "Early access from rank",
        earlyRankHint:
          "Tiers at this rank and above sign up BEFORE the sign-ups open. An empty field means no early access.",
        rsvpOpensLabel: "Sign-ups open",
        rsvpOpensHint: "An empty field means sign-ups are open from the moment of publication.",
        chathamHouseLabel: "Chatham House rule",
        chathamHouseHint:
          "Remarks may be quoted without attribution. The attendee sees this at sign-up and in the post-meeting materials.",

        seats: "Seats and price",
        seatsDescription: "The sign-up limit and the amount an attendee pays for a pass.",
        capacityLabel: "Seat limit",
        capacityHint:
          "An empty field means no limit. Once the seats run out, further applications go to the waiting list.",
        priceLabel: "Pass price",
        priceHint:
          "The amount in major units, for example 250.00 - not in cents. An empty field means the event is free; the lowest payable amount is 1.00.",
        currencyLabel: "Currency",

        stream: "Stream and recording",
        streamDescription:
          "Two addresses that only an attendee with access receives. They are not in the public HTML of the event page.",
        joinUrlLabel: "Stream address",
        joinUrlHint:
          "A full https address. The server hands it over only after the access check (get_event_access), so it is absent from the page source for anyone not signed up. An http address is mixed content and a browser warning at the exact moment of joining the stream.",
        recordingUrlLabel: "Recording address",
        recordingUrlHint:
          "A full https address, shared after the event through the same access gate as the stream. An empty field means there is no recording.",

        errors: {
          externalUrlRequired:
            "This mode signs people up in another service - give the address we should send them to.",
          externalUrlInvalid: "The address must start with https:// and contain no spaces.",
          externalUrlTooLong: "The address may be at most 2048 characters long.",
          tierRankInvalid: "A tier rank is a whole number no smaller than zero.",
          capacityInvalid:
            "The seat limit is a whole number greater than zero. Leave the field empty to set no limit.",
          priceInvalid:
            "Write the amount in digits, with at most two decimal places - for example 250.00.",
          priceTooLow:
            "The lowest payable amount is 1.00. Leave the field empty if the event is to be free.",
          joinUrlInvalid:
            "The stream address must be a full https address, at most 2048 characters.",
          recordingUrlInvalid:
            "The recording address must be a full https address, at most 2048 characters.",
        },

        warnings: {
          onlineWithoutJoinUrl:
            "The event is online and accepts sign-ups but has no stream address - the attendee gets a confirmation and nowhere to join.",
          earlyRankWithoutOpening:
            "Early access does nothing while the sign-ups have no opening date - there is nothing to be early for.",
          pricedWithoutRegistration:
            "A price is set while the registration mode is no sign-ups - there is no way to pay it, because there is no sign-up.",
          chathamHouseOnPublicPage:
            "The Chatham House rule on a public page is a promise the page does not keep: anyone reads the content, including someone who never accepted the rule.",
        },
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
        noPagesYet:
          "We see no page here, and the five event pages create themselves when this screen opens. Refresh the screen; if the list is still empty, the event may have been deleted in another tab.",
        loadFailed:
          "The event subpages could not be loaded. Refresh the screen - this does not mean the event has no pages.",
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
        loading: "Loading subpages…",

        states: {
          attachedOutOfMenu: "out of the menu",
          unattached: "not pinned",
          module: "always-on entry",
        },

        rowActions: {
          moveUp: "Move “{{label}}” up in the menu",
          moveDown: "Move “{{label}}” down in the menu",
          edit: "Edit the menu entry “{{label}}”",
          editContent: "Edit the page content",
          preview: "Show the content of “{{label}}” in the preview",
          detach: "Unpin “{{label}}” from the event",
          addToMenu: "Add to the menu",
          keepOutOfMenu: "Keep out of the menu",
          moduleLocked:
            "“{{label}}” is one of the five always-on event entries. You can hide it with the “Show in the event menu” switch, but you cannot unpin it - it comes back the next time this screen opens.",
        },

        entry: {
          title: "Menu entry",
          subtitle:
            "The label, icon, colour and visibility of one menu entry. The page title, content and address are changed in the page editor.",
          labelSection: "Menu label",
          labelHint:
            "An empty field means “use the page title”. A label of its own helps when the title is a sentence and the menu has room for two words.",
          menuLabelPl: "Label PL",
          menuLabelEn: "Label EN",
          appearanceSection: "Appearance",
          icon: "Icon",
          iconHint:
            "A lower-case name with hyphens, for example calendar-days. The full catalogue of names is in the panel at /admin/icons. An empty field uses the default icon.",
          iconInvalid:
            "An icon name may contain only lower-case letters, digits and hyphens - 48 characters at most.",
          color: "Colour",
          colorHint:
            "The colour of the tile and the icon in the menu. An empty field means “take the colour from the event branding”.",
          colorInvalid: "A colour is written as #RRGGBB - six hexadecimal characters.",
          colorPlaceholder: "from branding",
          colorPicker: "Pick the menu entry colour",
          visibilitySection: "Visibility",
          inMenu: "Show in the event menu",
          inMenuHint:
            "Off: the page stays pinned to the event and works at its own address, but appears neither in the menu nor in the tiles on the home page.",
          visibilityHint:
            "Tick the groups that should see this entry. Nothing ticked means “visible to everyone” - including guests who are not registered.",
          visibilityNoGroups:
            "This event has no attendee groups yet, so the entry is visible to everyone.",
          save: "Save the entry",
          cancel: "Cancel",
        },

        create: {
          title: "New event subpage",
          subtitle:
            "The page will be created under the event home page and pinned to the menu straight away. The public address is derived from the title.",
          titlePl: "Title PL",
          titleEn: "Title EN",
          icon: "Icon (optional)",
          iconHint:
            "A name from the icon catalogue, for example calendar-days. You can add it later in the entry editor.",
          template: "Page template",
          templateHint:
            "A template inserts ready-made sections together with their blocks - only the copy is left to replace. You can change the layout later in the builder.",
          draftHint:
            "The page is created as a draft - an attendee sees it only once you publish it in the page editor.",
          submit: "Create the page",
          cancel: "Cancel",
        },
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

      analytics: {
        registrations: "Registrations",
        registrationsDescription:
          "Numbers from the registrations module - the same ones the registrations list shows. A dash means “not known yet”, not zero.",
        registrationsTotal: "All registrations",
        approved: "Approved",
        pending: "Pending",
        waitlist: "Waiting list",
        seatsLeft: "Seats left",
        noCapacity: "This event has no seat limit",
        programme: "Programme and meetings",
        programmeDescription:
          "Sessions in the programme and 1-1 meetings: how many took place and what share of invitations was accepted.",
        sessions: "Sessions in the programme",
        meetingsHeld: "Meetings held",
        meetingsAcceptance: "Invitations accepted",
        onsite: "Onsite",
        onsiteDescription:
          "Check-in on the day: who arrived, who did not show up, how many badges were printed and how many leads partners collected.",
        arrived: "Checked in",
        noShow: "No-shows",
        attendanceRate: "Attendance",
        walkIn: "Walk-ins",
        badgesPrinted: "Badges printed",
        leadScans: "Leads collected",
        leadScansConsent: "With active consent: {{count}}",
        siteTraffic: "Site traffic",
        siteTrafficDescription:
          "Page views, traffic sources and conversions are counted by the site analytics module - an event has no separate traffic counter.",
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

      readiness: {
        title: "Publication readiness",
        description:
          "The conditions are derived from the state of the event. A blocker holds the publication back, a warning only says the page will be incomplete.",
        readyToPublish: "Every blocking condition is met - you can publish.",
        publishedOk: "The event is published and has no blocking gaps.",
        blocked_one: "{{count}} gap blocks publication.",
        blocked_other: "{{count}} gaps block publication.",
        progress: "{{passed}} of {{total}}",
        allDone: "Nothing left to fill in - every item is met.",
        severity: {
          blocker: "Blocks publication",
          warning: "Recommended before publishing",
        },
        checks: {
          title: "Fill in the Polish and English title",
          schedule: "Set a valid start and end of the event",
          timezone: "Choose the event time zone",
          venue: "Fill in the city and venue address",
          onlineUrl: "Add the online stream link",
          cover: "Upload the event cover",
          description: "Write the Polish and English description",
          sessions: "Add at least one session to the agenda",
          sessionDrafts_one: "{{count}} session waiting to be published",
          sessionDrafts_other: "{{count}} sessions waiting to be published",
          sessionSpeakers_one: "{{count}} session without a speaker",
          sessionSpeakers_other: "{{count}} sessions without a speaker",
          sessionRooms_one: "{{count}} on-site session without a room",
          sessionRooms_other: "{{count}} on-site sessions without a room",
          conflicts_one: "{{count}} agenda conflict to resolve",
          conflicts_other: "{{count}} agenda conflicts to resolve",
          rooms: "Add rooms for the on-site event",
          tickets: "Add a ticket type for paid registration",
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
        pageEmpty: "This subpage has no blocks yet - add them in the page editor.",
        noDate: "Date to be confirmed",
        endsLabel: "Ends",
        formatLabel: "Format",
        moduleEmptyAgenda: "The programme is still empty - add sessions in the Tracks tab.",
        moduleEmptySpeakers: "No speakers yet - add them in the event content screen.",
        moduleEmptyAttendees: "No confirmed registrations yet - the list fills up as people register.",
      },

      features: {
        modulesLabel: "Modules of this event",
        modulesDescription:
          "Switching a module off HIDES its section in this panel and deletes nothing - applications, sessions, tables and the check-in log stay where they are and come back together with the entry once the module is on again.",
        notPublicVisibility:
          "This is NOT public visibility. What an attendee sees is ruled by the event pages and sections - two switches for the same thing would mean two places to turn it off and only one that anybody remembers.",
        routesStayAlive:
          "The address of a hidden section keeps working: a link kept in bookmarks or sent to a colleague shows a sentence about the disabled module, not an empty screen.",

        labels: {
          pages: "Pages and menu",
          registration: "In-app registration",
          tickets: "Tickets and passes",
          sessions: "Agenda and sessions",
          meetings: "One-to-one meetings",
          onsite: "On-site check-in",
          sponsors: "Sponsors and advertising",
        },

        hints: {
          pages:
            "The subpage builder and the event menu go away. The event home page stays - a one-page event.",
          registration:
            "Applications, the sign-up form and the passes go away. For events that register people outside this application, or do not register them at all.",
          tickets:
            "The passes screen goes away and sign-ups stay - an event with free entry, no pools and no pricing.",
          sessions:
            "Sessions, tracks, rooms and conflicts go away - a single-block event with no agenda to lay out.",
          meetings:
            "Tables, the availability grid and one-to-one requests go away - an event without a meeting exchange.",
          onsite:
            "Check-in, scanners, checkpoints, devices and badges go away - a webinar has no door to walk through.",
          sponsors:
            "The list of sponsors and packages goes away together with the advertising materials of this event.",
        },

        disabled: {
          title: "This module is off for this event",
          description:
            "The “{{module}}” module is switched off for this event, so its entry is not in the navigation - the data stayed where it was and comes back together with it.",
          action: "Open Extra features",
        },
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
