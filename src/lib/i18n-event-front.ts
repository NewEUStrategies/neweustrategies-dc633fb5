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
      joinWaitlist: "Dopisz się na listę rezerwową",
      cancel: "Wycofaj zapis",
      signIn: "Zaloguj się, żeby się zapisać",
      seeMembership: "Poznaj członkostwo",
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
      joinWaitlist: "Join the waiting list",
      cancel: "Withdraw registration",
      signIn: "Sign in to register",
      seeMembership: "See membership",
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

    ads: {
      sectionLabel: "Advertisement",
    },

    errors: {
      notFound: "We could not find this event.",
      authRequired: "Sign in to perform this action.",
      invalidPayload: "The event is not identified.",
      invalidScope: "Unknown list range.",
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
