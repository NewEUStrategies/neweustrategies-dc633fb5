// Auto-extracted i18next resources. Edit translations here; i18n.ts composes
// these into the resource bundle. Split per-language so PL and EN edits don't
// collide in one giant file.
export const pl = {
  common: {
    homeEmptyNotice: "Nie ma tu jeszcze treści - zajrzyj wkrótce.",
    retry: "Spróbuj ponownie",
    loading: "Ładowanie…",
    noPosts: "Brak wpisów do wyświetlenia.",
    loadMore: "Załaduj więcej",
    add: "Dodaj",
    remove: "Usuń",
    delete: "Usuń",
    saving: "Zapisuję…",
    working: "Pracuję…",
    yes: "Tak",
    no: "Nie",
    preview: {
      lightMode: "Tryb jasny",
      darkMode: "Tryb ciemny",
    },
    // Language names stay endonyms in both bundles - a PL|EN switcher is read
    // by speakers of the language it points at, not of the current UI language.
    lang: {
      pl: "Polski",
      en: "English",
    },
    cancel: "Anuluj",
    confirm: "Potwierdź",
    save: "Zapisz",
    close: "Zamknij",
    back: "Wróć",
    // Etykieta menu „trzy kropki" (overflow) - do 08.2026 żyła wyłącznie jako
    // `defaultValue` w AuthorMoreMenu, więc EN dostawał polski tekst.
    more: "Więcej",
    menu: "Menu",
    search: "Szukaj",
    openMenu: "Otwórz menu",
    closeMenu: "Zamknij menu",
    openSearch: "Otwórz wyszukiwarkę",
    toggleTheme: "Przełącz motyw",
    alertBar: "Pasek alertu",
    dismissAlertBar: "Zamknij pasek alertu",
    and: "oraz",
    required: "Wymagane",
    name: "Nazwa",
    party: "Podmiot",
    purpose: "Cel",
    expires: "Wygasa",
    dataProcessingTerms: "Zasady przetwarzania danych",
    lightMode: "Tryb jasny",
    darkMode: "Tryb ciemny",
  },
  nav: {
    // `nav.account` i `builder.sectionLoading` czytają komponenty PUBLICZNE
    // (`AccountMenuWidget`, `sectionStreaming`) bez własnej nakładki - stąd
    // rdzeń, a nie słownik buildera/panelu, których czytelnik nie pobiera.
    account: "Menu konta",
    newsletter: "Newsletter",
    skipToContent: "Przejdź do treści",
  },
  builder: {
    sectionLoading: "Wczytywanie sekcji…",
  },
  quiz: {
    share: {
      title: "Udostępnij quiz",
      copy: "Kopiuj link",
      copied: "Skopiowano!",
      copiedToast: "Link skopiowany do schowka",
      expand: "Rozwiń panel udostępniania",
      collapse: "Zwiń panel udostępniania",
      linkedin: "LinkedIn",
      facebook: "Facebook",
      messenger: "Messenger",
      whatsapp: "WhatsApp",
      email: "E-mail",
    },
  },
  hero: {
    by: "Autor",
  },
  blog: {
    empty: "Brak opublikowanych wpisów.",
  },
  footer: {
    back_to_top: "Wróć na górę",
    legal_nav: "Informacje prawne",
  },
  archive: {
    empty: "Brak opublikowanych wpisów.",
    next: "Następna strona",
    prev: "Poprzednia strona",
    pageLabel: "Strona",
  },
  consent: {
    preview: {
      title: "Podgląd zgody",
      active: "AKTYWNY",
      inactive: "REALNE",
      hint: "Testuj skrypty bez czyszczenia cookies - override tylko dla tej sesji.",
      acceptAll: "Wszystko",
      rejectAll: "Nic",
      reset: "Wróć do rzeczywistej zgody",
    },
  },
  // Karuzela wpisów: wyłącznie etykiety dostępności (aria), nie tekst widoczny.
  postCarousel: {
    roleDescription: "karuzela",
    label: "Karuzela wpisów",
    controls: "Sterowanie karuzelą",
    prev: "Poprzedni wpis",
    next: "Następny wpis",
    pause: "Zatrzymaj automatyczne przewijanie",
    play: "Wznów automatyczne przewijanie",
  },
  // Karta promocyjna: podpowiedź widoczna WYŁĄCZNIE w kanwie buildera, gdy
  // redakcja wstawi widget i nie wypełni go jeszcze treścią. Napis idzie
  // słownikiem, a nie warunkiem po języku, bo warunek omija bramkę parytetu
  // PL/EN i zamyka drogę do trzeciego języka.
  promoCard: {
    builderEmpty: "Dodaj okładkę i tytuł karty (lub wybierz wydarzenie) w panelu widgetu.",
  },
  trendingTicker: {
    badge: "Warte przeczytania",
  },
  newsletter: {
    title: "STRATEGICZNE MYŚLENIE, NOWE PERSPEKTYWY",
    sub: "Śledź globalną i europejską grę mocarstw z pierwszego rzędu",
    subscribe: "Zapisz się",
    confirmPage: {
      loading: "Potwierdzanie subskrypcji…",
      okTitle: "Subskrypcja potwierdzona",
      okBody: "Dziękujemy - od teraz będziesz otrzymywać nasz newsletter.",
      alreadyTitle: "Już potwierdzono",
      alreadyBody: "Ten adres jest już zapisany do newslettera.",
      expiredTitle: "Link wygasł",
      expiredBody: "Zapisz się ponownie, aby otrzymać świeży link.",
      errorTitle: "Nie udało się potwierdzić",
      errorBody: "Spróbuj ponownie lub skontaktuj się z redakcją.",
      backHome: "← Wróć na stronę główną",
    },
    unsubscribePage: {
      loading: "Sprawdzanie linku…",
      title: "Wypisz się z newslettera",
      body: "Kliknij poniżej, aby potwierdzić wypisanie się z listy.",
      bodyWithEmail: "Kliknij poniżej, aby wypisać {{email}} z listy.",
      confirmBtn: "Potwierdź wypisanie",
      working: "Wypisywanie…",
      okTitle: "Wypisano z newslettera",
      okBody:
        "Nie będziesz już otrzymywać naszych wiadomości. Możesz zapisać się ponownie w każdej chwili.",
      alreadyTitle: "Już wypisane",
      alreadyBody: "Ten adres jest już wypisany z newslettera.",
      invalidTitle: "Nieprawidłowy link",
      invalidBody: "Ten link jest nieprawidłowy lub został już wykorzystany.",
      errorTitle: "Coś poszło nie tak",
      errorBody: "Spróbuj ponownie za chwilę.",
    },
  },
  auth: {
    signin: "Zaloguj się",
    signup: "Zarejestruj się",
    signinOk: "Zalogowano",
    signupOk: "Konto utworzone",
    invalidInput: "Nieprawidłowe dane - sprawdź adres e-mail i spróbuj ponownie.",
    rateLimited: "Zbyt wiele prób - spróbuj ponownie za kilka minut.",
  },
  post: {
    takeaways: {
      title: "Z tego materiału dowiesz się, że ...",
      adminTitle: "Z tego materiału dowiesz się, że ... (max 6 punktów)",
      placeholder: "Punkt {{n}}",
      add: "Dodaj punkt",
      remove: "Usuń",
      hint: "Krótkie, konkretne bullet pointy - max 6. Wyświetlane nad treścią wpisu w wybranym języku.",
      empty: "Brak punktów dla tego języka.",
    },
    readMinutes_one: "{{count}} min czytania",
    readMinutes_few: "{{count}} min czytania",
    readMinutes_many: "{{count}} min czytania",
    readMinutes_other: "{{count}} min czytania",
    updated: "Aktualizacja",
  },
  ads: {
    label: "Reklama",
    consentBlocked: "Treść reklamowa zablokowana - wymaga zgody marketingowej.",
    zones: {
      headerBanner: "pasek nagłówka",
      topOfPost: "nad artykułem",
      midPost: "w treści artykułu",
      bottomOfPost: "pod artykułem",
      sidebar: "kolumna boczna",
      inFeed: "w liście wpisów",
      footerSlideup: "pasek dolny",
    },
    dismiss: "Zamknij reklamę",
  },
  // PANEL (`admin.*`) I EDYTOR BLOKÓW (`blocks.*`) NIE MIESZKAJĄ W RDZENIU.
  // Rdzeń to chunk, na który KAŻDY czytelnik czeka przed hydratacją
  // (top-level await w `lib/i18n.ts`), a te dwa poddrzewa były ~60% jego
  // bajtów - napisy, których anonimowy czytelnik nigdy nie wyrenderuje.
  // `admin.*` rejestruje `lib/i18n-admin-core.ts` (kotwica w `AdminSession`,
  // routes/admin.tsx), `blocks.*` - `lib/i18n-admin-blocks.ts` (importuje go
  // każdy plik edytora bloków, który czyta te klucze). W rdzeniu zostają
  // WYŁĄCZNIE cztery klucze `UnsavedChangesGuardDialog`, bo ten dialog
  // montuje się także poza panelem. Nowy klucz `admin.*`/`blocks.*` dopisuj
  // do nakładki, nie tutaj.
  admin: {
    unsavedChangesTitle: "Niezapisane zmiany",
    unsavedChanges: "Masz niezapisane zmiany - czy na pewno chcesz opuścić edytor?",
    stay: "Zostań",
    leave: "Opuść bez zapisania",
  },
  notifications: {
    title: "Powiadomienia",
    empty: "Brak powiadomień",
    markAllRead: "Oznacz wszystkie",
    markRead: "Oznacz jako przeczytane",
    openInbox: "Otwórz skrzynkę",
    unread_one: "{{count}} nieprzeczytane",
    unread_few: "{{count}} nieprzeczytane",
    unread_many: "{{count}} nieprzeczytanych",
    unread_other: "{{count}} nieprzeczytanych",
    inboxSubtitle: "Twoja prywatna skrzynka - widzisz tylko własne powiadomienia.",
    filters: {
      all: "Wszystkie",
      unread: "Nieprzeczytane",
      settings: "Ustawienia",
      allKinds: "Wszystkie typy",
    },
    searchPlaceholder: "Szukaj po treści, nadawcy...",
    noMatches: "Brak wyników dla zadanych filtrów",
    markUnread: "Oznacz jako nieprzeczytane",
    markGroupRead: "Oznacz całą rozmowę jako przeczytaną",
    markGroupUnread: "Oznacz całą rozmowę jako nieprzeczytaną",
    deleteGroup: "Usuń całą rozmowę",
    loadMore: "Załaduj więcej",
    grouped: {
      messagesFrom: "Wiadomości od {{name}}",
      moreMessages_one: "+{{count}} kolejna wiadomość",
      moreMessages_few: "+{{count}} kolejne wiadomości",
      moreMessages_many: "+{{count}} kolejnych wiadomości",
      moreMessages_other: "+{{count}} kolejnych wiadomości",
    },
    settings: {
      title: "Ustawienia powiadomień",
      subtitle: "Wybierz, jakie alerty trafiają do skrzynki i jak się zachowują.",
      kindsHeader: "Typy powiadomień",
      behaviourHeader: "Zachowanie domyślne",
      autoMarkOnOpen: "Automatycznie oznaczaj wiadomości jako przeczytane po otwarciu czatu",
      autoMarkOnOpenHint:
        "Wyłącz, żeby powiadomienia o wiadomościach zostawały do ręcznego zamknięcia.",
      groupByConversation: "Grupuj powiadomienia o wiadomościach wg rozmowy",
      groupByConversationHint: "Zwiń wiele wiadomości z tego samego czatu w jeden wpis.",
      kindGroups: {
        conversations: "Rozmowy",
        conversationsHint:
          "Bezpośredni kontakt: czat, formalne zapytania do ekspertów i dyskusje w klubach.",
        network: "Sieć i profil",
        networkHint:
          "Sygnały o tym, kto Cię szuka, poleca i chce poznać. Odmowa wprowadzenia oraz odrzucenie rekomendacji pozostają ciche.",
        content: "Treści i alerty",
        contentHint: "Strumień redakcyjny, dyskusja pod materiałami i Twoje zapisane kryteria.",
        workspace: "Praca i konto",
        workspaceHint: "Follow-upy CRM, subskrypcja i ogłoszenia systemowe.",
        events: "Wydarzenia",
        eventsHint:
          "Przypomnienia o wydarzeniach i sesjach, oferty miejsc z listy rezerwowej, przekazanie biletu, ankieta i certyfikat.",
      },
      kinds: {
        message: "Wiadomości na czacie",
        expert_request: "Zapytania do ekspertów",
        club: "Kluby dyskusyjne",
        comment: "Komentarze",
        follow: "Nowi obserwujący",
        subscription: "Aktualizacje subskrypcji",
        content: "Nowe treści",
        saved_search: "Alerty zapisanych wyszukiwań",
        crm_task: "Przypomnienia o follow-upach CRM",
        tracker: "Aktualizacje trackera legislacyjnego",
        connection: "Zaproszenia do sieci kontaktów",
        introduction: "Prośby o wprowadzenie",
        recommendation: "Rekomendacje profilowe",
        endorsement: "Poparcia umiejętności",
        profile_view: "Wyświetlenia Twojego profilu",
        meeting_booking: "Rezerwacje spotkań 1-1",
        system: "Ogłoszenia systemowe",
        security: "Alerty bezpieczeństwa (zawsze włączone)",
        event: "Wydarzenia i przypomnienia",
        billing: "Płatności",
      },
      channelsHeader: "Kanały doręczeń",
      channelsSubtitle: "Powiadomienia poza aplikacją: push w przeglądarce i zbiorczy e-mail.",
      chatBell: "Dzwonek czatu w pasku górnym",
      chatBellHint:
        "Wyłącz, żeby ukryć skrót do czatu w pasku górnym. Rozmowy nadal działają w /messages i doku.",
      push: "Powiadomienia push w tej przeglądarce",
      pushHint: "Alert pojawi się nawet przy zamkniętej karcie. Każde urządzenie włączasz osobno.",
      pushDenied: "Przeglądarka odmówiła zgody na powiadomienia.",
      pushError: "Nie udało się włączyć powiadomień push.",
      pushUnsupported: "Ta przeglądarka lub instalacja nie wspiera powiadomień push.",
      digest: "Digest e-mail z nieprzeczytanych powiadomień",
      digestHint: "Jedno zbiorcze podsumowanie zamiast pojedynczych e-maili.",
      digestOff: "Wyłączony",
      digestDaily: "Codziennie",
      digestWeekly: "Co tydzień",
      saved: "Zapisano preferencje",
      saveError: "Nie udało się zapisać preferencji",
    },
    consents: {
      tab: "Zgody",
      title: "Zgody i prywatność",
      subtitle:
        "Zdecyduj o plikach cookie i o tym, jakie wiadomości mogą do Ciebie trafiać. Każdą zmianę zapisujemy w niezmiennym rejestrze RODO (data, wersja, źródło, adres IP, przeglądarka).",
      version: "Wersja {{version}}",
      versionOutdated: "Nowa wersja tej zgody - potwierdź ponownie",
      requiredBadge: "Wymagana",
      given: "Udzielono {{date}}",
      withdrawn: "Wycofano {{date}}",
      notDecided: "Nie podjęto decyzji",
      saved: "Zapisano zgodę",
      saveError: "Nie udało się zapisać zgody",
      history: "Historia zmian",
      historyEmpty: "Brak zapisanych zmian.",
      historyItem: "{{date}} - {{state}} (wersja {{version}})",
      stateGiven: "udzielono",
      stateWithdrawn: "wycofano",
      categories: {
        legal: "Podstawa prawna",
        communications: "Komunikacja marketingowa",
        product: "Produkt i personalizacja",
        analytics: "Analityka",
        cookies: "Pliki cookie i śledzenie",
      },
      items: {
        cookies_functional: {
          title: "Cookies funkcjonalne",
          description:
            "Preferencje interfejsu: motyw, układ list, tryb czytania. Ta sama zgoda, którą ustawiasz w banerze cookie - zmiana tutaj działa natychmiast.",
        },
        cookies_analytics: {
          title: "Cookies analityczne",
          description:
            "Pomiar ruchu i wydajności strony (statystyki first-party, web vitals). Spięte z kategorią analityczną banera cookie.",
        },
        cookies_marketing: {
          title: "Cookies marketingowe",
          description:
            "Pomiar skuteczności newslettera i reklam własnych. Spięte z kategorią marketingową banera cookie.",
        },
        transactional: {
          title: "Wiadomości transakcyjne i serwisowe",
          description:
            "Powiadomienia niezbędne do korzystania z konta: potwierdzenia, bezpieczeństwo, ważne zmiany usługi. Wymagane - nie można wyłączyć.",
        },
        marketing_email: {
          title: "E-maile marketingowe",
          description:
            "Promocje, oferty i informacje handlowe wysyłane e-mailem. Możesz wycofać zgodę w każdej chwili.",
        },
        newsletter_digest: {
          title: "Newsletter i podsumowania",
          description:
            "Cotygodniowy przegląd nowych treści, wydarzeń i analiz przygotowany przez redakcję.",
        },
        push_marketing: {
          title: "Powiadomienia push o promocjach",
          description:
            "Krótkie alerty w przeglądarce o nowościach i limitowanych akcjach. Wymaga włączonych powiadomień push urządzenia.",
        },
        product_updates: {
          title: "Nowości i aktualizacje produktu",
          description:
            "Informacje o nowych funkcjach, ulepszeniach oraz zmianach istotnych dla użytkowników platformy.",
        },
        personalization: {
          title: "Personalizacja treści",
          description:
            "Dostosowywanie rekomendacji i kolejności treści na podstawie Twojej aktywności w serwisie.",
        },
        analytics: {
          title: "Statystyki i analiza użycia",
          description:
            "Anonimowe dane o korzystaniu z platformy pomagają nam poprawiać stabilność i wygodę użytkowania.",
        },
      },
    },
  },
  composer: {
    status: {
      tooLong: "Treść przekracza limit {{count}} znaków.",
      tooShort: "Wpisz co najmniej {{count}} znaków.",
    },
  },
  comments: {
    title_zero: "Komentarze",
    title_one: "Komentarze ({{count}})",
    title_few: "Komentarze ({{count}})",
    title_many: "Komentarze ({{count}})",
    title_other: "Komentarze ({{count}})",
    empty: "Bądź pierwszą osobą, która skomentuje ten wpis.",
    loading: "Ładowanie komentarzy…",
    placeholder: "Napisz komentarz…",
    submit: "Opublikuj",
    submitted: "Komentarz dodany - czeka na moderację.",
    reply: "Odpowiedz",
    delete: "Usuń",
    deleteConfirmTitle: "Usunąć komentarz?",
    deleteConfirmBody: "Tej operacji nie można cofnąć.",
    deleted: "Komentarz usunięty",
    deletedPlaceholder: "[komentarz usunięty]",
    pendingBadge: "Oczekuje",
    anonymous: "Użytkownik",
    signInPrompt: "Chcesz dołączyć do dyskusji?",
    signInLink: "Zaloguj się",
    closed: "Komentarze pod tym wpisem są zamknięte.",
    edit: "Edytuj",
    edited: "edytowano",
    editSaved: "Komentarz zaktualizowany",
    saveEdit: "Zapisz zmiany",
    guestBadge: "gość",
    guestName: "Twoje imię lub pseudonim",
    loadMore: "Załaduj więcej komentarzy",
    // Przełącznik zwiniętej gałęzi odpowiedzi. Liczba mówi, ILE treści chowa.
    showReplies_one: "Pokaż {{count}} odpowiedź",
    showReplies_few: "Pokaż {{count}} odpowiedzi",
    showReplies_many: "Pokaż {{count}} odpowiedzi",
    showReplies_other: "Pokaż {{count}} odpowiedzi",
    hideReplies_one: "Ukryj {{count}} odpowiedź",
    hideReplies_few: "Ukryj {{count}} odpowiedzi",
    hideReplies_many: "Ukryj {{count}} odpowiedzi",
    hideReplies_other: "Ukryj {{count}} odpowiedzi",
    toolbar: {
      bold: "Pogrubienie",
      italic: "Kursywa",
      bulletList: "Lista punktowana",
      numberedList: "Lista numerowana",
      quote: "Cytat",
      code: "Kod",
      link: "Link",
      clear: "Wyczyść treść",
    },
    submittedPending: "Dziękujemy - komentarz pojawi się po zatwierdzeniu przez moderację.",
    errors: {
      authRequired: "Zaloguj się, aby komentować.",
      disabled: "Komentarze są wyłączone.",
      generic: "Nie udało się wysłać komentarza.",
      editExpired: "Komentarz można edytować tylko przez 15 minut od dodania.",
      rateLimited: "Zwolnij - za dużo komentarzy na raz.",
    },
  },
  adminComments: {
    title: "Komentarze",
    subtitle: "Moderuj komentarze użytkowników.",
    searchPlaceholder: "Szukaj w treści…",
    loading: "Ładowanie…",
    empty: "Brak komentarzy.",
    saved: "Zapisano",
    error: "Nie udało się zapisać",
    status: {
      all: "Wszystkie",
      pending: "Oczekujące",
      approved: "Zatwierdzone",
      spam: "Spam",
      deleted: "Usunięte",
    },
    actions: {
      approve: "Zatwierdź",
      spam: "Spam",
      delete: "Usuń",
    },
    kinds: {
      all: "Wszystkie typy",
      system: "System",
      follow: "Obserwujący",
      content: "Nowe treści",
      tracker: "Tracker legislacyjny",
      connection: "Sieć kontaktów",
      subscription: "Subskrypcja",
    },
  },
};
