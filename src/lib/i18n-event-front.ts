// Słownik PUBLICZNEJ strony wydarzenia (/events, /events/$slug), PL/EN.
//
// DLACZEGO OSOBNY PLIK, A NIE ROZSZERZENIE `i18n-admin-events`. Tamten słownik
// opisuje panel: kolumny listy redakcyjnej, dialog rodzaju, komunikaty walidacji
// formularza. Nakładki i18n są NIEPODZIELNE - trasa, która załaduje
// `i18n-admin-events`, wciąga do swojego chunka cały panel wydarzeń razem
// z etykietami, których uczestnik nigdy nie zobaczy. Front ma własną nakładkę,
// żeby bramka `check:i18n-overlay-imports` mogła wymagać jej importu dokładnie
// tam, gdzie jest używana, a splitter TanStacka nie mieszał dwóch powierzchni.
//
// KLUCZE ODPOWIADAJĄ WARTOŚCIOM Z BAZY, JEDEN DO JEDNEGO. Migracja
// `20260823170000_event_front_binding.sql` wprowadza pięć zamkniętych
// słowników i każdy z nich ma tutaj pełne pokrycie:
//   * osiem kluczy sekcji (`event_page_sections.section_key`)
//     -> `eventFront.sections.*`,
//   * cztery widoczności sekcji (`event_page_sections.visibility`)
//     -> `eventFront.sectionVisibility.*`,
//   * cztery powody zamknięcia (`event_sections().lock_reason`)
//     -> `eventFront.lockReasons.*` (etykieta) i `eventFront.locks.*` (karta),
//   * osiem stanów zapisów (`event_page_header().registration_state`)
//     -> `eventFront.registrationState.*`,
//   * trzy zakresy czasowe (`p_scope`) -> `eventFront.scope.*`.
// Do tego statusy z modułów sąsiednich, które front WYŚWIETLA, a nie wprowadza:
// osiem stanów zgłoszenia (`event_registrations.status`) i cztery legacy RSVP
// (`event_rsvps.status`). Front pokazuje jedno i drugie, bo obie ścieżki zapisu
// są dziś żywe - więc obie muszą mieć nazwę po polsku i po angielsku.
//
// TEKST MÓWI, CO ZROBIĆ, A NIE CO SIĘ NIE UDAŁO. „Zapisz się, żeby zobaczyć
// listę prelegentów" zamiast „Brak dostępu": komunikat bez wyjścia zamienia
// bramkę członkostwa w awarię strony, a uczestnik i tak nie dowie się, czego
// mu brakuje.
import i18n from "@/lib/i18n";

export const eventFrontPl = {
  eventFront: {
    // ---------------------------------------------------------------------
    // Sekcje strony wydarzenia. `heading` jest wartością DOMYŚLNĄ - redakcja
    // nadpisuje ją kolumnami `event_page_sections.heading_pl/heading_en`,
    // a RPC oddaje nadpisanie albo NULL, więc front sięga tutaj tylko wtedy,
    // gdy nikt nic nie nadpisał.
    // ---------------------------------------------------------------------
    sections: {
      description: {
        heading: "O wydarzeniu",
        empty: "Organizator nie dodał jeszcze opisu tego wydarzenia.",
      },
      registration: {
        heading: "Zapisy",
        empty: "To wydarzenie nie przyjmuje zapisów przez naszą stronę.",
      },
      agenda: {
        heading: "Program",
        empty: "Program jeszcze nie jest gotowy. Wróć tu za kilka dni.",
      },
      speakers: {
        heading: "Prelegenci",
        empty: "Lista prelegentów jeszcze się kompletuje.",
      },
      sponsors: {
        heading: "Partnerzy",
        empty: "To wydarzenie nie ma partnerów.",
      },
      materials: {
        heading: "Materiały",
        empty: "Materiały pojawią się tutaj po wydarzeniu.",
      },
      map: {
        heading: "Dojazd",
        empty: "Organizator nie podał jeszcze miejsca spotkania.",
      },
      contact: {
        heading: "Kontakt",
        empty: "Organizator nie udostępnił danych kontaktowych.",
      },
    },

    // Etykieta widoczności sekcji - używana w podpowiedzi „kto to zobaczy".
    sectionVisibility: {
      public: "Widoczne dla wszystkich",
      authenticated: "Widoczne po zalogowaniu",
      registered: "Widoczne dla zapisanych",
      tier: "Widoczne od wybranej warstwy członkostwa",
    },

    // Krótka etykieta powodu zamknięcia (plakietka na nagłówku sekcji).
    lockReasons: {
      none: "Otwarte",
      authRequired: "Wymaga zalogowania",
      registrationRequired: "Wymaga zapisu",
      tierRequired: "Wymaga członkostwa",
    },

    // Karta w miejscu zamkniętej sekcji: powód, wyjście i nazwa przycisku.
    locks: {
      authRequired: {
        title: "Ta część jest dla zalogowanych",
        body: "Zaloguj się na swoje konto, żeby zobaczyć tę sekcję strony wydarzenia.",
        action: "Zaloguj się",
      },
      registrationRequired: {
        title: "Ta część jest dla zapisanych",
        body: "Zapisz się na wydarzenie, żeby zobaczyć tę sekcję. Zapis możesz wycofać w każdej chwili.",
        action: "Zapisz się",
      },
      tierRequired: {
        title: "Ta część jest dla członków",
        body: "Sekcja jest dostępna od warstwy członkostwa wskazanej przez organizatora.",
        action: "Poznaj członkostwo",
      },
    },

    // ---------------------------------------------------------------------
    // Nagłówek wydarzenia
    // ---------------------------------------------------------------------
    header: {
      backToList: "Wszystkie wydarzenia",
      dateLabel: "Termin",
      timeZoneNote: "Godziny podane w strefie {{timezone}}",
      locationLabel: "Miejsce",
      onlineLocation: "Spotkanie online",
      typeLabel: "Rodzaj wydarzenia",
      noType: "Wydarzenie",
      hostLabel: "Prowadzi",
      chathamHouse: "Zasada Chatham House",
      chathamHouseNote:
        "Wolno cytować to, co powiedziano, ale nie wolno przypisywać wypowiedzi osobom ani organizacjom.",
      chathamHouseLocked:
        "Spotkania w regule Chatham House są dostępne od warstwy członkostwa z tym uprawnieniem.",
      membersOnly: "Tylko dla członków",
      tierLocked: "To wydarzenie jest dostępne od wybranej warstwy członkostwa.",
      cancelledBanner: "Wydarzenie zostało odwołane {{date}}.",
      endedBanner: "To wydarzenie już się odbyło.",
      streamAvailable: "Transmisja online",
      recordingAvailable: "Nagranie",
      streamForRegistered: "Link do transmisji zobaczysz po zapisie.",
      recordingForMembers: "Nagranie jest dostępne dla członków z uprawnieniem do nagrań.",
      priceFree: "Wstęp bezpłatny",
      priceLabel: "Bilet",
      tabs: {
        overview: "Wydarzenie",
        agenda: "Program",
        speakers: "Prelegenci",
        sponsors: "Partnerzy",
        materials: "Materiały",
      },
    },

    // ---------------------------------------------------------------------
    // Miejsca i stan zapisów
    // ---------------------------------------------------------------------
    seats: {
      left: "Wolne miejsca: {{count}}",
      lastOne: "Zostało ostatnie miejsce",
      soldOut: "Brak wolnych miejsc",
      unlimited: "Bez limitu miejsc",
      capacityLabel: "Limit miejsc: {{count}}",
    },

    registrationState: {
      open: "Zapisy otwarte",
      event_cancelled: "Wydarzenie odwołane",
      event_ended: "Wydarzenie się zakończyło",
      registration_disabled: "Bez zapisów",
      registration_external: "Rejestracja u organizatora",
      registration_not_open: "Zapisy jeszcze nie ruszyły",
      membership_required: "Wymaga członkostwa",
      sold_out: "Brak wolnych miejsc",
    },

    registrationStateHint: {
      open: "Zapisz się i zabierz swoje miejsce.",
      event_cancelled: "Organizator odwołał to wydarzenie. Zapisy są zamknięte.",
      event_ended: "Zapisy są zamknięte, bo wydarzenie już się odbyło.",
      registration_disabled: "To wydarzenie nie przyjmuje zapisów.",
      registration_external: "Zapis prowadzi organizator we własnym narzędziu.",
      registration_not_open: "Zapisy otwierają się {{date}}.",
      membership_required: "Zapis jest dostępny od wybranej warstwy członkostwa.",
      sold_out: "Wszystkie miejsca są zajęte. Możesz dopisać się na listę rezerwową.",
    },

    registrationAction: {
      register: "Zapisz się",
      registerExternal: "Przejdź do rejestracji",
      registerForm: "Wypełnij formularz zgłoszenia",
      joinWaitlist: "Dopisz się na listę rezerwową",
      cancel: "Wycofaj zapis",
      signIn: "Zaloguj się, żeby się zapisać",
      seeMembership: "Poznaj członkostwo",
    },

    // ---------------------------------------------------------------------
    // Powierzchnia zapisów: zdania, których słownik stanu z bazy NIE MA.
    //
    // `registration_state` z `event_page_header()` opisuje stan WYDARZENIA,
    // a te zdania opisują stan NASZEGO EKRANU: tryb zgłoszenia formularzem,
    // adres, którego organizator nie podał, oraz stan, którego ta wersja
    // klienta nie zna. Rozróżnienie jest celowe - zdanie „zapisy otwarte"
    // byłoby przy trybie `form` prawdziwe i całkowicie bezużyteczne.
    // Reguła: `lib/events/registrationSurface.ts`.
    // ---------------------------------------------------------------------
    registrationSurface: {
      signInHint: "Zaloguj się, żeby zapisać się na to wydarzenie.",
      formRequired:
        "Zapis na to wydarzenie prowadzi organizator przez formularz zgłoszenia - wypełnij go, żeby zająć miejsce.",
      approvalRequired:
        "Zapis na to wydarzenie wymaga akceptacji organizatora - wyślij zgłoszenie przez formularz.",
      externalUrlMissing:
        "Organizator wskazał rejestrację w zewnętrznym narzędziu, ale nie podał jej adresu. Zapis przez tę stronę nie zadziała - napisz do organizatora.",
      ticketRequired: "To wydarzenie wymaga opłaconej wejściówki.",
      closedUnknown: "Zapisy na to wydarzenie są w tej chwili zamknięte.",
    },

    // Stan WŁASNEGO zgłoszenia (event_registrations.status) - osiem wartości.
    myRegistration: {
      draft: "Zgłoszenie nieukończone",
      pending: "Zgłoszenie czeka na decyzję organizatora",
      approved: "Jesteś zapisany",
      rejected: "Zgłoszenie odrzucone",
      waitlist: "Jesteś na liście rezerwowej",
      cancelled: "Zapis wycofany",
      attended: "Uczestniczyłeś w tym wydarzeniu",
      no_show: "Nieobecność odnotowana",
    },

    // Legacy ścieżka zapisu (event_rsvps.status) - cztery wartości.
    myRsvp: {
      going: "Będziesz",
      interested: "Zainteresowany",
      waitlist: "Lista rezerwowa",
      cancelled: "Bez zapisu",
    },

    waitlistPosition: "Twoje miejsce w kolejce: {{position}}",

    // ---------------------------------------------------------------------
    // Słowniki wspólne z domeną wydarzenia
    // ---------------------------------------------------------------------
    formats: {
      onsite: "Na miejscu",
      // Zapożyczenie, którym zespół posługuje się tak samo po polsku - ten sam
      // zabieg co w `adminEvents.formats.online`. Raport parytetu liczy je jako
      // „nieprzetłumaczone" i to jest poprawny odczyt: napis JEST identyczny.
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
      instant: "Zapis natychmiastowy",
      approval: "Zapis po akceptacji organizatora",
    },
    guestModes: {
      hidden: "Treść tylko dla zapisanych",
      teaser: "Opis i program dla wszystkich",
      full: "Wszystko poza kontaktami",
    },

    // ---------------------------------------------------------------------
    // Lista wydarzeń
    // ---------------------------------------------------------------------
    list: {
      title: "Wydarzenia",
      subtitle:
        "Panele, briefingi, okrągłe stoły i spotkania online. Filtry działają po stronie serwera, więc licznik pod listą mówi prawdę o całości.",
      searchLabel: "Szukaj wydarzenia",
      searchPlaceholder: "Szukaj po tytule, opisie albo miejscu",
      typeLabel: "Rodzaj",
      typeAll: "Wszystkie rodzaje",
      // Zapożyczenie jak `formats.online` niżej - słowo identyczne w obu
      // językach, tak samo jak `adminEvents.types.dialog.formatLabel`.
      formatLabel: "Format",
      formatAll: "Wszystkie formaty",
      fromLabel: "Od dnia",
      toLabel: "Do dnia",
      clearFilters: "Wyczyść filtry",
      loading: "Wczytywanie wydarzeń…",
      empty: "Nie ma jeszcze żadnego wydarzenia.",
      emptyUpcoming: "Nie ma zaplanowanych wydarzeń. Zajrzyj do archiwum.",
      emptyPast: "Archiwum jest jeszcze puste.",
      emptyFiltered: "Żadne wydarzenie nie pasuje do tych filtrów.",
      range: "{{from}}-{{to}} z {{total}}",
      prevPage: "Poprzednia strona",
      nextPage: "Następna strona",
      openEvent: "Otwórz stronę wydarzenia {{title}}",
      degraded:
        "Lista wydarzeń nie dojechała w tej odsłonie. Odśwież stronę - dane są w bazie, to chwilowy problem połączenia.",
    },

    scope: {
      upcoming: "Nadchodzące",
      past: "Archiwum",
      all: "Wszystkie",
    },

    // ---------------------------------------------------------------------
    // Zapamiętane wydarzenia
    // ---------------------------------------------------------------------
    bookmarks: {
      add: "Zapamiętaj wydarzenie",
      remove: "Usuń z zapamiętanych",
      addedToast: "Wydarzenie zapamiętane",
      removedToast: "Wydarzenie usunięte z zapamiętanych",
      signInHint: "Zaloguj się, żeby zapamiętywać wydarzenia.",
      title: "Zapamiętane wydarzenia",
      subtitle: "Widzisz tu tylko swoje zapamiętania - nikt inny ich nie zobaczy.",
      empty: "Nie zapamiętałeś jeszcze żadnego wydarzenia.",
      emptyUpcoming: "Żadne z zapamiętanych wydarzeń jeszcze się nie odbyło.",
      emptyPast: "Żadne z zapamiętanych wydarzeń jeszcze się nie zakończyło.",
      savedAt: "Zapamiętane {{date}}",
      loading: "Wczytywanie zapamiętanych…",
    },

    // ---------------------------------------------------------------------
    // Program wydarzenia (RPC `event_agenda`). Sesja ma trzy niezależne osie:
    // CZAS (dzień, godzina, strefa), MIEJSCE (sala, piętro, nurt) i DOSTĘP
    // (zapis, rezerwa, warstwa). Każda z nich ma tu własne napisy, bo każda
    // znaczy dla uczestnika coś innego.
    // ---------------------------------------------------------------------
    agenda: {
      loading: "Wczytywanie programu…",
      empty: "Program jeszcze nie jest gotowy.",
      emptyFiltered: "Żadna sesja nie pasuje do wybranego filtra.",
      emptyMine: "Nie zapisałeś się jeszcze na żadną sesję.",
      emptyQuery: "Żadna sesja tego dnia nie pasuje do wpisanej frazy.",
      dayLabel: "Dzień {{index}}",
      // Kolumna obok programu: pole wyszukiwania, strefa czasowa i własny
      // harmonogram. Jedna etykieta służy za podpowiedź w polu i za nazwę
      // dla czytnika ekranu - dwa różne napisy na jedno pole kazałyby
      // zgadywać, które z nich opisuje to samo.
      sidebarLabel: "Filtry programu",
      search: "Wyszukiwanie",
      // Godziny w programie liczą się w strefie WYDARZENIA - podpis mówi
      // w jakiej, bo bez tego uczestnik przelicza je sam i myli się o godzinę.
      timezoneRow: "Strefa wydarzenia ({{zone}})",
      timezoneForeign: "Twoje urządzenie jest w innej strefie - godzin nie przeliczamy.",
      myScheduleTitle: "Twój harmonogram",
      myScheduleShowAll: "Zobacz wszystkie",
      // Przedział sesji w jednym napisie: przyimek między godzinami należy do
      // języka, a nie do JSX-a („10:00 do 11:45” / „10:00 to 11:45”).
      timeRange: "{{date}}, {{start}} do {{end}}",
      allTracks: "Wszystkie ścieżki",
      trackLabel: "Ścieżka",
      onlyMine: "Tylko moje sesje",
      roomLabel: "Sala",
      floorLabel: "Piętro",
      speakersLabel: "Prelegenci",
      seatsLeft_one: "Zostało {{count}} miejsce",
      seatsLeft_few: "Zostały {{count}} miejsca",
      seatsLeft_many: "Zostało {{count}} miejsc",
      seatsLeft_other: "Zostało {{count}} miejsc",
      seatsUnlimited: "Bez limitu miejsc",
      chathamHouse: "Reguła Chatham House",
      streamAvailable: "Transmisja online",
      recordingAvailable: "Nagranie po sesji",
      openDetails: "Pokaż szczegóły",
      closeDetails: "Ukryj szczegóły",
      states: {
        open: "Wstęp wolny",
        signupRequired: "Wymagany zapis",
        signedUp: "Jesteś zapisany",
        waitlisted: "Lista rezerwowa",
        full: "Komplet",
        tierRequired: "Dla członków",
        cancelled: "Sesja odwołana",
      },
      actions: {
        signup: "Zapisz się na sesję",
        joinWaitlist: "Dopisz do rezerwy",
        cancel: "Zrezygnuj z sesji",
        working: "Zapisujemy…",
        signIn: "Zaloguj się, żeby się zapisać",
      },
      toasts: {
        registered: "Zapisaliśmy Cię na sesję.",
        waitlist: "Komplet - jesteś na liście rezerwowej.",
        cancelled: "Zapis na sesję odwołany.",
        promoted: "Zwolnione miejsce trafiło do kolejnej osoby z rezerwy.",
      },
    },

    // ---------------------------------------------------------------------
    // Siatka prelegentów. Karta to zdjęcie, imię, rola i organizacja - same
    // dane z profilu, więc jedyny NAPIS, jaki siatka ma własny, dotyczy chwili
    // przed danymi. Pusta lista nie ma tu komunikatu: nagłówek sekcji rysuje
    // `EventPageSections` razem z `sections.speakers.empty`.
    // ---------------------------------------------------------------------
    speakers: {
      loading: "Wczytywanie prelegentów…",
    },

    // ---------------------------------------------------------------------
    // Partnerzy i sponsorzy. To MIGAWKA z chwili przypięcia, nie kartoteka -
    // dlatego nie ma tu żadnego napisu obiecującego aktualność danych firmy.
    // ---------------------------------------------------------------------
    sponsors: {
      loading: "Wczytywanie partnerów…",
      empty: "Lista partnerów jeszcze się kompletuje.",
      noTier: "Pozostali partnerzy",
      benefitsLabel: "W pakiecie",
      boothLabel: "Stoisko {{label}}",
      visitSite: "Strona partnera",
      roles: {
        sponsor: "Sponsor",
        partner: "Partner",
        mediaPartner: "Patronat medialny",
        exhibitor: "Wystawca",
      },
    },

    // Pas poziomów partnerów na stronie GŁÓWNEJ wydarzenia (rząd logotypów bez
    // nazw pod spodem) - nazwa odnośnika musi więc powiedzieć, czyja to strona.
    sponsorTiers: {
      partnerSite: "Strona partnera {{name}}",
    },

    // ---------------------------------------------------------------------
    // Materiały partnerów. Sekcja domyślnie stoi za zapisem (`registered`),
    // więc napisy mówią, co jest po drugiej stronie, a nie „brak dostępu".
    // ---------------------------------------------------------------------
    materials: {
      loading: "Wczytywanie materiałów…",
      empty: "Partnerzy nie udostępnili jeszcze materiałów.",
      open: "Otwórz",
      kinds: {
        document: "Dokument",
        presentation: "Prezentacja",
        video: "Wideo",
        link: "Odnośnik",
        logoPack: "Pakiet logotypów",
      },
    },

    // ---------------------------------------------------------------------
    // Samoobsługowa rezygnacja z zapisu kluczem `manage_token` - jedyna droga
    // dla gościa BEZ konta. Napisy mówią wprost, że operacji nie da się cofnąć.
    // ---------------------------------------------------------------------
    manage: {
      title: "Twoje zgłoszenie",
      subtitle: "Tu odwołasz udział w wydarzeniu bez zakładania konta.",
      tokenLabel: "Klucz zarządzania zgłoszeniem",
      tokenPlaceholder: "Wklej klucz z potwierdzenia zapisu",
      tokenHint:
        "Klucz dostałeś raz, w potwierdzeniu zapisu. Bez niego rezygnację przyjmie tylko organizator.",
      missingToken: "Otwórz odnośnik z potwierdzenia zapisu albo wklej klucz poniżej.",
      confirmTitle: "Odwołać udział?",
      confirmBody: "Zapis zniknie z listy uczestników, a Twoje miejsce trafi do kolejnej osoby.",
      confirm: "Odwołaj udział",
      confirming: "Odwołujemy…",
      keep: "Zostaw zapis",
      cancelled: "Udział odwołany. Dziękujemy za informację.",
      promoted_one: "Zwolnione miejsce trafiło do {{count}} osoby z listy rezerwowej.",
      promoted_few: "Zwolnione miejsca trafiły do {{count}} osób z listy rezerwowej.",
      promoted_many: "Zwolnione miejsca trafiły do {{count}} osób z listy rezerwowej.",
      promoted_other: "Zwolnione miejsca trafiły do {{count}} osób z listy rezerwowej.",
      backToEvent: "Wróć do wydarzenia",
      manageLink: "Odnośnik do zarządzania zgłoszeniem",
      manageLinkHint: "Zapisz go w zakładkach - otwiera tę stronę bez logowania.",
      copyLink: "Kopiuj odnośnik",
      copied: "Skopiowano",
    },

    // ---------------------------------------------------------------------
    // Nagłówek wideo, menu podstron i informacje praktyczne.
    //
    // TRZY POWIERZCHNIE, KTÓRE PANEL ZAPISYWAŁ, A UCZESTNIK ICH NIE WIDZIAŁ.
    // Kolumny (`video_header_*`, `street_address`…`country`, `languages`,
    // `social_hashtag`, `support_email`, `pages_display_mode`) czekały nie na
    // komponent, a na GRANT kolumnowy - patrz `lib/community/publicQueries.ts`.
    // ---------------------------------------------------------------------
    videoHeader: {
      frameTitle: "Wideo wydarzenia: {{title}}",
    },

    menu: {
      label: "Podstrony wydarzenia",
    },

    // Spis sekcji na stronie głównej wydarzenia. ETYKIETA JEST INNA NIŻ
    // W `menu`: oba spisy mogą stać na jednej stronie, a dwa punkty orientacyjne
    // o tej samej nazwie nie dają się rozróżnić w czytniku ekranu.
    homeSections: {
      label: "Sekcje wydarzenia",
    },

    practical: {
      addressLabel: "Adres",
      showOnMap: "Pokaż na mapie",
      languagesLabel: "Języki treści",
      hashtagLabel: "Hashtag",
      hashtagSearch: "Zobacz wpisy z {{hashtag}} w serwisie X",
      supportLabel: "Pomoc organizatora",
    },

    // ---------------------------------------------------------------------
    // UCZESTNICY (`event_attendees`).
    //
    // TA LISTA JEST DLA LUDZI Z SALI I TEKST MUSI TO MÓWIĆ WPROST. Trzy różne
    // „nie ma listy” mają trzy różne następne kroki, więc mają trzy różne
    // zdania: gość ma się zalogować, niezapisany ma się zapisać, a przy
    // regule Chatham House nazwisk NIE BĘDZIE i to jest odpowiedź ostateczna,
    // nie awaria.
    //
    // ZERO NOWYCH ZGÓD, WIĘC ZERO OBIETNIC W TEKŚCIE. Na liście stoją
    // wyłącznie osoby, które w profilu włączyły widoczność
    // (`profiles.discoverable`) i nie wypisały się z tego wydarzenia
    // (`event_registrations.directory_opt_out`) - dlatego „nikogo tu nie ma”
    // mówi o ZGODACH, a nie o pustej sali.
    // ---------------------------------------------------------------------
    attendees: {
      heading: "Uczestnicy",
      subtitle: "Osoby, które zgodziły się być widoczne dla pozostałych uczestników.",
      listLabel: "Lista uczestników",
      count_one: "{{count}} osoba na liście",
      count_few: "{{count}} osoby na liście",
      count_many: "{{count}} osób na liście",
      count_other: "{{count}} osób na liście",
      searchPlaceholder: "Szukaj po nazwisku albo firmie",
      searchLabel: "Szukaj uczestnika",
      allGroups: "Wszyscy",
      empty:
        "Nikt jeszcze nie włączył widoczności na tym wydarzeniu. Możesz być pierwszy - przełącznik jest wyżej.",
      emptyFiltered: "Nikt na liście nie odpowiada temu zapytaniu.",
      loading: "Odświeżamy listę…",
      prevPage: "Poprzednie",
      nextPage: "Następne",
      pageRange: "{{from}}-{{to}} z {{total}}",
      profileLink: "Zobacz profil: {{name}}",
      signInTitle: "Lista uczestników jest dla zapisanych",
      signInBody: "Zaloguj się na konto, z którego zapisałeś się na to wydarzenie.",
      notRegisteredTitle: "Zapisz się, żeby zobaczyć, kto będzie",
      notRegisteredBody: "Listę uczestników pokazujemy tylko osobom zapisanym na to wydarzenie.",
      chathamTitle: "To spotkanie działa w regule Chatham House",
      chathamBody:
        "Nazwisk nie pokazujemy - ani na tej stronie, ani nikomu innemu. Możemy powiedzieć, ilu was będzie i w jakich grupach.",
      groupsHeading: "Kto będzie na sali",
      groupCount_one: "{{count}} osoba",
      groupCount_few: "{{count}} osoby",
      groupCount_many: "{{count}} osób",
      groupCount_other: "{{count}} osób",
      visibilityHeading: "Moja widoczność",
      listedLabel: "Jesteś widoczny dla innych uczestników",
      listedHint:
        "Pokazujemy imię, nazwisko, stanowisko i firmę. Nigdy adresu poczty ani telefonu.",
      listedOn: "Widoczny",
      listedOff: "Ukryty",
      profileHiddenLabel: "Twój profil jest ukryty w całym serwisie",
      profileHiddenHint:
        "Dopóki w ustawieniach profilu masz wyłączoną widoczność, nie pokażemy Cię na żadnej liście uczestników - także po włączeniu przełącznika tutaj.",
    },

    // ---------------------------------------------------------------------
    // DYSKUSJE (`event_discussions`).
    //
    // WĄTKI SĄ Z KLUBU DYSKUSYJNEGO I TEKST NIE UDAJE, ŻE JEST INACZEJ:
    // odnośnik prowadzi do klubu, bo tam człowiek odpowiada, moderuje
    // i dostaje powiadomienia. Wydarzenie bez przypiętej grupy klubu dostaje
    // JEDNO ZDANIE zaproszenia - nie pustą ramkę i nie atrapę.
    //
    // NAZWY RODZAJÓW WĄTKÓW STOJĄ TU, A NIE W SŁOWNIKU KLUBÓW, mimo że to te
    // same sześć wartości. Nakładki i18n są NIEPODZIELNE: import słownika
    // klubów wciągnąłby do chunka strony wydarzenia całą powierzchnię klubową.
    // ---------------------------------------------------------------------
    discussions: {
      heading: "Dyskusje",
      subtitle: "Rozmowy uczestników w klubie dyskusyjnym tego wydarzenia.",
      listLabel: "Wątki dyskusji",
      invite: "Dyskusje otwieramy w dniu wydarzenia - zajrzyj tu wtedy jeszcze raz.",
      empty: "W tej grupie nie ma jeszcze ani jednego wątku. Pierwszy głos należy do Ciebie.",
      openInClub: "Otwórz w klubie: {{club}}",
      startThread: "Rozpocznij wątek w klubie",
      anonymousAuthor: "Uczestnik",
      chathamNote: "Ta grupa działa w regule Chatham House - wypowiedzi bez nazwisk.",
      replies_one: "{{count}} odpowiedź",
      replies_few: "{{count}} odpowiedzi",
      replies_many: "{{count}} odpowiedzi",
      replies_other: "{{count}} odpowiedzi",
      kind: {
        discussion: "Dyskusja",
        question: "Pytanie",
        position: "Stanowisko",
        resource: "Materiał",
        announcement: "Ogłoszenie",
        poll: "Ankieta",
      },
      // Stany z `club_capabilities.reason` - jedno źródło prawdy o dostępie
      // siedzi w bazie, a tutaj ma tylko nazwę po polsku.
      state: {
        notFound: "Nie znaleźliśmy tego wydarzenia.",
        authRequired: "Zaloguj się, żeby zobaczyć dyskusje tego wydarzenia.",
        notMember: "Dyskusje są dla członków klubu. Poproś organizatora o dostęp.",
        banned: "Nie masz dostępu do dyskusji w tym klubie.",
        notOpenYet: "Dyskusje jeszcze się nie otworzyły.",
        archived: "Dyskusje tego wydarzenia są już zamknięte i przeniesione do archiwum.",
        tierTooLow: "Dyskusje są dla członków o wyższej warstwie.",
        tierUnknown: "Nie umiemy sprawdzić Twojej warstwy członkostwa.",
        noAccess: "Nie masz dostępu do tych dyskusji.",
      },
    },

    // Baner reklamowy strony wydarzenia (page_type = 'event').
    ads: {
      sectionLabel: "Reklama",
    },

    // ---------------------------------------------------------------------
    // Komunikaty odmowy z RPC. Klucz odpowiada prefiksowi wyjątku, żeby
    // mapowanie błędu na tekst było jednym oglądem, a nie zgadywaniem.
    // ---------------------------------------------------------------------
    errors: {
      notFound: "Nie znaleźliśmy tego wydarzenia.",
      authRequired: "Zaloguj się, żeby wykonać tę operację.",
      invalidPayload: "Brakuje wskazania wydarzenia.",
      invalidScope: "Nieznany zakres listy.",
      invalidStatus: "Nieznany stan zapisu.",
      forbidden: "Zaloguj się, żeby zapisać się na sesję.",
      requesterNotParticipating: "Ta operacja jest dla osób zapisanych na to wydarzenie.",
      signupDisabled: "Ta sesja nie przyjmuje zapisów.",
      overlapConflict: "Masz już zapis na inną sesję w tych godzinach.",
      tierRequired: "Ta sesja jest dla członków o wyższej warstwie.",
      unknown: "Coś nie zadziałało. Spróbuj jeszcze raz.",
    },
  },
};

export const eventFrontEn = {
  eventFront: {
    sections: {
      description: {
        heading: "About the event",
        empty: "The organiser has not added a description yet.",
      },
      registration: {
        heading: "Registration",
        empty: "This event does not take registrations through our site.",
      },
      agenda: {
        heading: "Programme",
        empty: "The programme is not ready yet. Come back in a few days.",
      },
      speakers: {
        heading: "Speakers",
        empty: "The speaker list is still being completed.",
      },
      sponsors: {
        heading: "Partners",
        empty: "This event has no partners.",
      },
      materials: {
        heading: "Materials",
        empty: "Materials will appear here after the event.",
      },
      map: {
        heading: "Getting there",
        empty: "The organiser has not given the venue yet.",
      },
      contact: {
        heading: "Contact",
        empty: "The organiser has not shared contact details.",
      },
    },

    sectionVisibility: {
      public: "Visible to everyone",
      authenticated: "Visible once signed in",
      registered: "Visible to registered attendees",
      tier: "Visible from the selected membership tier",
    },

    lockReasons: {
      none: "Open",
      authRequired: "Sign-in required",
      registrationRequired: "Registration required",
      tierRequired: "Membership required",
    },

    locks: {
      authRequired: {
        title: "This part is for signed-in visitors",
        body: "Sign in to your account to see this section of the event page.",
        action: "Sign in",
      },
      registrationRequired: {
        title: "This part is for registered attendees",
        body: "Register for the event to see this section. You can withdraw at any time.",
        action: "Register",
      },
      tierRequired: {
        title: "This part is for members",
        body: "The section is available from the membership tier chosen by the organiser.",
        action: "See membership",
      },
    },

    header: {
      backToList: "All events",
      dateLabel: "Date",
      timeZoneNote: "Times shown in the {{timezone}} time zone",
      locationLabel: "Venue",
      onlineLocation: "Online meeting",
      typeLabel: "Event type",
      noType: "Event",
      hostLabel: "Hosted by",
      chathamHouse: "Chatham House Rule",
      chathamHouseNote:
        "You may quote what was said, but you may not attribute it to any person or organisation.",
      chathamHouseLocked:
        "Chatham House Rule meetings are available from the membership tier that carries this entitlement.",
      membersOnly: "Members only",
      tierLocked: "This event is available from the selected membership tier.",
      cancelledBanner: "The event was cancelled on {{date}}.",
      endedBanner: "This event has already taken place.",
      streamAvailable: "Live stream",
      recordingAvailable: "Recording",
      streamForRegistered: "You will see the stream link once you are registered.",
      recordingForMembers: "The recording is available to members entitled to recordings.",
      priceFree: "Free entry",
      priceLabel: "Ticket",
      tabs: {
        overview: "Event",
        agenda: "Programme",
        speakers: "Speakers",
        sponsors: "Partners",
        materials: "Materials",
      },
    },

    seats: {
      left: "Seats left: {{count}}",
      lastOne: "One seat left",
      soldOut: "No seats left",
      unlimited: "No seat limit",
      capacityLabel: "Seat limit: {{count}}",
    },

    registrationState: {
      open: "Registration open",
      event_cancelled: "Event cancelled",
      event_ended: "Event has ended",
      registration_disabled: "No registration",
      registration_external: "Registration with the organiser",
      registration_not_open: "Registration has not opened yet",
      membership_required: "Membership required",
      sold_out: "No seats left",
    },

    registrationStateHint: {
      open: "Register and take your seat.",
      event_cancelled: "The organiser cancelled this event. Registration is closed.",
      event_ended: "Registration is closed because the event has already taken place.",
      registration_disabled: "This event does not take registrations.",
      registration_external: "The organiser runs registration in their own tool.",
      registration_not_open: "Registration opens on {{date}}.",
      membership_required: "Registration is available from the selected membership tier.",
      sold_out: "All seats are taken. You can join the waiting list.",
    },

    registrationAction: {
      register: "Register",
      registerExternal: "Go to registration",
      registerForm: "Fill in the registration form",
      joinWaitlist: "Join the waiting list",
      cancel: "Withdraw registration",
      signIn: "Sign in to register",
      seeMembership: "See membership",
    },

    registrationSurface: {
      signInHint: "Sign in to register for this event.",
      formRequired:
        "The organiser takes registrations for this event through an application form - fill it in to book your seat.",
      approvalRequired:
        "Registration for this event needs the organiser's approval - send an application through the form.",
      externalUrlMissing:
        "The organiser set registration to an external tool but gave no address for it. Registration through this page will not work - contact the organiser.",
      ticketRequired: "This event requires a paid ticket.",
      closedUnknown: "Registration for this event is closed at the moment.",
    },

    myRegistration: {
      draft: "Registration not finished",
      pending: "Awaiting the organiser's decision",
      approved: "You are registered",
      rejected: "Registration declined",
      waitlist: "You are on the waiting list",
      cancelled: "Registration withdrawn",
      attended: "You attended this event",
      no_show: "Absence recorded",
    },

    myRsvp: {
      going: "Going",
      interested: "Interested",
      waitlist: "Waiting list",
      cancelled: "Not registered",
    },

    waitlistPosition: "Your place in the queue: {{position}}",

    formats: {
      onsite: "On site",
      online: "Online",
      hybrid: "Hybrid",
    },
    registrationModes: {
      rsvp: "One-click registration",
      form: "Application form",
      external: "External registration",
      none: "No registration",
    },
    registrationFlows: {
      instant: "Instant registration",
      approval: "Registration after approval",
    },
    guestModes: {
      hidden: "Content for registered attendees only",
      teaser: "Description and programme for everyone",
      full: "Everything except contact details",
    },

    list: {
      title: "Events",
      subtitle:
        "Panels, briefings, roundtables and online meetings. Filters run on the server, so the counter below the list tells the truth about the whole set.",
      searchLabel: "Search events",
      searchPlaceholder: "Search by title, description or venue",
      typeLabel: "Type",
      typeAll: "All types",
      formatLabel: "Format",
      formatAll: "All formats",
      fromLabel: "From",
      toLabel: "To",
      clearFilters: "Clear filters",
      loading: "Loading events…",
      empty: "There are no events yet.",
      emptyUpcoming: "No events are scheduled. Have a look at the archive.",
      emptyPast: "The archive is still empty.",
      emptyFiltered: "No event matches these filters.",
      range: "{{from}}-{{to}} of {{total}}",
      prevPage: "Previous page",
      nextPage: "Next page",
      openEvent: "Open the event page for {{title}}",
      degraded:
        "The event list did not arrive in this render. Refresh the page - the data is in the database, this is a temporary connection problem.",
    },

    scope: {
      upcoming: "Upcoming",
      past: "Archive",
      all: "All",
    },

    bookmarks: {
      add: "Save this event",
      remove: "Remove from saved",
      addedToast: "Event saved",
      removedToast: "Event removed from saved",
      signInHint: "Sign in to save events.",
      title: "Saved events",
      subtitle: "You only see your own saved events - nobody else can see them.",
      empty: "You have not saved any event yet.",
      emptyUpcoming: "None of your saved events is still ahead.",
      emptyPast: "None of your saved events has finished yet.",
      savedAt: "Saved {{date}}",
      loading: "Loading saved events…",
    },

    // Programme of the event (`event_agenda`).
    agenda: {
      loading: "Loading the programme…",
      empty: "The programme is not ready yet.",
      emptyFiltered: "No session matches the selected filter.",
      emptyMine: "You have not signed up for any session yet.",
      emptyQuery: "No session on this day matches your search.",
      dayLabel: "Day {{index}}",
      sidebarLabel: "Programme filters",
      search: "Search",
      timezoneRow: "Event time zone ({{zone}})",
      timezoneForeign: "Your device is in a different time zone - times are not converted.",
      myScheduleTitle: "Your schedule",
      myScheduleShowAll: "See all",
      timeRange: "{{date}}, {{start}} to {{end}}",
      allTracks: "All tracks",
      trackLabel: "Track",
      onlyMine: "My sessions only",
      roomLabel: "Room",
      floorLabel: "Floor",
      speakersLabel: "Speakers",
      seatsLeft_one: "{{count}} seat left",
      seatsLeft_other: "{{count}} seats left",
      seatsUnlimited: "No seat limit",
      chathamHouse: "Chatham House Rule",
      streamAvailable: "Live stream",
      recordingAvailable: "Recording afterwards",
      openDetails: "Show details",
      closeDetails: "Hide details",
      states: {
        open: "Open to all",
        signupRequired: "Sign-up required",
        signedUp: "You are signed up",
        waitlisted: "Waiting list",
        full: "Fully booked",
        tierRequired: "Members only",
        cancelled: "Session cancelled",
      },
      actions: {
        signup: "Sign up for this session",
        joinWaitlist: "Join the waiting list",
        cancel: "Cancel my seat",
        working: "Saving…",
        signIn: "Sign in to save a seat",
      },
      toasts: {
        registered: "Your seat in this session is saved.",
        waitlist: "Fully booked - you are on the waiting list.",
        cancelled: "Your seat in this session has been released.",
        promoted: "The released seat went to the next person on the waiting list.",
      },
    },

    // Speaker grid - the only string it owns is the loading label.
    speakers: {
      loading: "Loading speakers…",
    },

    // Partners and sponsors - a snapshot taken when the partner was pinned.
    sponsors: {
      loading: "Loading partners…",
      empty: "The partner list is still coming together.",
      noTier: "Other partners",
      benefitsLabel: "Included in the package",
      boothLabel: "Booth {{label}}",
      visitSite: "Partner website",
      roles: {
        sponsor: "Sponsor",
        partner: "Partner",
        mediaPartner: "Media partner",
        exhibitor: "Exhibitor",
      },
    },

    // Partner tiers strip on the event home page (a row of logos with no names).
    sponsorTiers: {
      partnerSite: "Partner website: {{name}}",
    },

    // Partner materials - the section sits behind registration by default.
    materials: {
      loading: "Loading materials…",
      empty: "Partners have not shared any materials yet.",
      open: "Open",
      kinds: {
        document: "Document",
        presentation: "Presentation",
        video: "Video",
        link: "Link",
        logoPack: "Logo pack",
      },
    },

    // Self-service cancellation with the `manage_token` - the only route for a
    // guest without an account.
    manage: {
      title: "Your registration",
      subtitle: "Cancel your attendance here, no account needed.",
      tokenLabel: "Registration management key",
      tokenPlaceholder: "Paste the key from your confirmation",
      tokenHint:
        "You received the key once, in your registration confirmation. Without it only the organiser can cancel for you.",
      missingToken: "Open the link from your confirmation or paste the key below.",
      confirmTitle: "Cancel your attendance?",
      confirmBody:
        "Your registration leaves the attendee list and your seat goes to the next person.",
      confirm: "Cancel attendance",
      confirming: "Cancelling…",
      keep: "Keep my registration",
      cancelled: "Your attendance is cancelled. Thank you for letting us know.",
      promoted_one: "The released seat went to {{count}} person from the waiting list.",
      promoted_other: "The released seats went to {{count}} people from the waiting list.",
      backToEvent: "Back to the event",
      manageLink: "Registration management link",
      manageLinkHint: "Bookmark it - it opens this page without signing in.",
      copyLink: "Copy link",
      copied: "Copied",
    },

    // The video header, the page menu and the practical facts - three
    // surfaces the studio already stored and the attendee could not see.
    videoHeader: {
      frameTitle: "Event video: {{title}}",
    },

    menu: {
      label: "Event pages",
    },

    // Section list on the event home page - a landmark name of its own.
    homeSections: {
      label: "Event sections",
    },

    practical: {
      addressLabel: "Address",
      showOnMap: "Show on map",
      languagesLabel: "Content languages",
      hashtagLabel: "Hashtag",
      hashtagSearch: "See posts tagged {{hashtag}} on X",
      supportLabel: "Organiser support",
    },

    // ---------------------------------------------------------------------
    // ATTENDEES (`event_attendees`). Three different „no list” cases, three
    // different next steps - see the Polish block for the reasoning.
    // ---------------------------------------------------------------------
    attendees: {
      heading: "Attendees",
      subtitle: "People who agreed to be visible to the other attendees.",
      listLabel: "Attendee list",
      count_one: "{{count}} person on the list",
      count_other: "{{count}} people on the list",
      searchPlaceholder: "Search by name or company",
      searchLabel: "Search attendees",
      allGroups: "Everyone",
      empty:
        "Nobody has turned visibility on for this event yet. You can be the first - the switch is above.",
      emptyFiltered: "Nobody on the list matches this search.",
      loading: "Refreshing the list…",
      prevPage: "Previous",
      nextPage: "Next",
      pageRange: "{{from}}-{{to}} of {{total}}",
      profileLink: "See profile: {{name}}",
      signInTitle: "The attendee list is for registered guests",
      signInBody: "Sign in with the account you used to register for this event.",
      notRegisteredTitle: "Register to see who is coming",
      notRegisteredBody: "We only show the attendee list to people registered for this event.",
      chathamTitle: "This meeting runs under the Chatham House Rule",
      chathamBody:
        "We do not show names - not here and not to anyone else. We can tell you how many of you there will be, and in which groups.",
      groupsHeading: "Who will be in the room",
      groupCount_one: "{{count}} person",
      groupCount_other: "{{count}} people",
      visibilityHeading: "My visibility",
      listedLabel: "You are visible to other attendees",
      listedHint: "We show your name, job title and company. Never your email or phone.",
      listedOn: "Visible",
      listedOff: "Hidden",
      profileHiddenLabel: "Your profile is hidden across the site",
      profileHiddenHint:
        "While visibility is off in your profile settings, we will not show you on any attendee list - even with the switch here turned on.",
    },

    // ---------------------------------------------------------------------
    // DISCUSSIONS (`event_discussions`). Threads come from the discussion
    // club and the copy says so - see the Polish block for the reasoning.
    // ---------------------------------------------------------------------
    discussions: {
      heading: "Discussions",
      subtitle: "Attendee conversations in this event's discussion club.",
      listLabel: "Discussion threads",
      invite: "Discussions open on the day of the event - come back here then.",
      empty: "This group has no threads yet. The first word is yours.",
      openInClub: "Open in club: {{club}}",
      startThread: "Start a thread in the club",
      anonymousAuthor: "Attendee",
      chathamNote: "This group runs under the Chatham House Rule - contributions carry no names.",
      replies_one: "{{count}} reply",
      replies_other: "{{count}} replies",
      kind: {
        discussion: "Discussion",
        question: "Question",
        position: "Position",
        resource: "Resource",
        announcement: "Announcement",
        poll: "Poll",
      },
      state: {
        notFound: "We could not find this event.",
        authRequired: "Sign in to see the discussions for this event.",
        notMember: "Discussions are for club members. Ask the organiser for access.",
        banned: "You do not have access to discussions in this club.",
        notOpenYet: "Discussions have not opened yet.",
        archived: "Discussions for this event are closed and archived.",
        tierTooLow: "Discussions are for members on a higher tier.",
        tierUnknown: "We cannot check your membership tier.",
        noAccess: "You do not have access to these discussions.",
      },
    },

    ads: {
      sectionLabel: "Advertisement",
    },

    errors: {
      notFound: "We could not find this event.",
      authRequired: "Sign in to perform this action.",
      invalidPayload: "The event is not identified.",
      invalidScope: "Unknown list range.",
      invalidStatus: "Unknown sign-up state.",
      forbidden: "Sign in to save a seat in this session.",
      requesterNotParticipating: "This action is for people registered for this event.",
      signupDisabled: "This session does not take sign-ups.",
      overlapConflict: "You already have a seat in another session at this time.",
      tierRequired: "This session is for members on a higher tier.",
      unknown: "Something went wrong. Please try again.",
    },
  },
};

i18n.addResourceBundle("pl", "translation", eventFrontPl, true, true);
i18n.addResourceBundle("en", "translation", eventFrontEn, true, true);

/**
 * No-op wołany w komponencie trasy zamiast side-effectowego importu modułu.
 * Nazwane wiązanie pozwala splitterowi TanStacka przenieść cały bundle
 * tłumaczeń do chunka trasy - side-effectowy import w pliku trasy landował
 * w eager-owym grafie wejściowym każdej strony. Rejestracja dzieje się przy
 * ewaluacji modułu (przed renderem komponentu), dokładnie jak wcześniej.
 */
export function ensureI18n(): void {}
