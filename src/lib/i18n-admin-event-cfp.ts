// Słownik panelu NABORU PRELEGENTÓW (Event Builder), PL/EN.
//
// DLACZEGO OSOBNY PLIK. Nakładki i18n są niepodzielne, a nabór to cztery ekrany
// studia (ustawienia, formularz, zgłoszenia, recenzenci) z oknami decyzji
// i przyjęcia. Trzymanie ich w `i18n-admin-events` wciągałoby cały słownik
// naboru na każdy ekran studia, także ten bez jednego zgłoszenia.
//
// ETYKIETY STANÓW ZGŁOSZENIA, RÓL I REKOMENDACJI NIE STOJĄ TUTAJ. Te same
// napisy czyta strona publiczna, panel prelegenta i panel recenzenta, więc
// mieszkają w `i18n-event-cfp` (gałąź `eventCfp.*`), a panel importuje tamtą
// nakładkę. Dwie kopie „Przyjęte" rozjechałyby się przy pierwszej poprawce.
//
// KOMUNIKAT BŁĘDU MÓWI, CO ZROBIĆ. `score_max_below_reviews` bez liczby z ogona
// zmuszałby do zgadywania, jak nisko wolno zejść ze skalą - stąd `{{count}}`.
import i18n from "@/lib/i18n";
import { ensureEventCfpI18n } from "@/lib/i18n-event-cfp";

export const adminEventCfpPl = {
  adminEventCfp: {
    common: {
      loading: "Wczytuję…",
      save: "Zapisz",
      saving: "Zapisuję…",
      discard: "Odrzuć zmiany",
      cancel: "Anuluj",
      delete: "Usuń",
      edit: "Edytuj",
      close: "Zamknij",
      none: "brak",
      yes: "Tak",
      no: "Nie",
    },

    list: {
      rowLegend: "Pozycja {{index}}",
      labelPl: "Etykieta (PL)",
      labelEn: "Etykieta (EN)",
      key: "Klucz",
      remove: "Usuń",
    },

    // Faza liczona przez bazę (`_event_cfp_phase`), nie przez przeglądarkę.
    phases: {
      none: "Nieuruchomiony",
      scheduled: "Zaplanowany",
      open: "Otwarty",
      closed: "Zamknięty",
    },

    settings: {
      statusTitle: "Stan naboru",
      statusDescription:
        "Nabór przyjmuje zgłoszenia tylko wtedy, gdy jest otwarty i trwa jego okno czasowe.",
      phaseNow: "Teraz: {{phase}}",
      eventNotPublished:
        "Wydarzenie nie jest opublikowane - strona naboru pokaże się dopiero po publikacji wydarzenia.",
      status: {
        draft: "Szkic",
        open: "Otwarty",
        closed: "Zamknięty",
        draftHint: "Nabór przygotowywany - strona naboru jest niewidoczna.",
        openHint: "Przyjmuje zgłoszenia w oknie czasowym poniżej.",
        closedHint: "Nie przyjmuje zgłoszeń; trwa ocena i decyzje.",
      },
      windowTitle: "Okno zgłoszeń",
      windowDescription:
        "Puste pola oznaczają brak ograniczenia z tej strony. Godziny w strefie czasowej wydarzenia.",
      opensAt: "Otwarcie",
      opensAtHint: "Przed tą chwilą strona naboru odlicza czas do otwarcia.",
      closesAt: "Termin zgłoszeń",
      closesAtHint: "Po tej chwili wysłanie zgłoszenia nie jest możliwe.",
      textsTitle: "Teksty strony naboru",
      textsDescription:
        "Wstęp i zasady widzą wszyscy odwiedzający stronę naboru. Obie wersje językowe - do 8000 znaków.",
      introPl: "Wstęp (PL)",
      introEn: "Wstęp (EN)",
      guidelinesPl: "Zasady i wskazówki (PL)",
      guidelinesEn: "Zasady i wskazówki (EN)",
      formatsTitle: "Formy wystąpień",
      formatsDescription:
        "Z tej listy prelegent wybiera formę (np. wykład 30 minut, panel 45 minut). Pusta lista = bez wyboru formy.",
      formatDuration: "Minuty",
      addFormat: "Dodaj formę",
      noFormats: "Brak form - zgłoszenie nie pyta o formę wystąpienia.",
      tracksTitle: "Ścieżki",
      tracksDescription:
        "Ścieżki programu, do których można zgłaszać wystąpienia. Bez zaznaczenia zgłoszenie nie pyta o ścieżkę.",
      noTracks: "Wydarzenie nie ma jeszcze ścieżek - dodasz je w agendzie.",
      trackInactive: "(nieaktywna)",
      rulesTitle: "Zasady zgłoszeń",
      rulesDescription: "Ile zgłoszeń może wysłać jedna osoba i czy zgłasza sama.",
      maxPerSubmitter: "Limit zgłoszeń na osobę",
      maxPerSubmitterHint: "Od 1 do 20. Wycofane zgłoszenia nie wliczają się do limitu.",
      allowCoSpeakers: "Współprelegenci",
      allowCoSpeakersHint:
        "Zgłaszający może dopisać do pięciu osób. Ich karty w CRM powstaną dopiero po przyjęciu.",
      reviewTitle: "Ocena zgłoszeń",
      reviewDescription: "Jak recenzenci oceniają zgłoszenia i ile ocen potrzeba do decyzji.",
      reviewBlind: "Ocena w ciemno",
      reviewBlindHint:
        "Recenzenci nie widzą danych prelegentów, chyba że mają to wprost włączone na liście recenzentów.",
      scoreMax: "Skala ocen (1 do…)",
      minReviews: "Minimum ocen",
      minReviewsHint: "Zgłoszenia z mniejszą liczbą ocen są oznaczone na liście. Od 0 do 20.",
      criterionWeight: "Waga",
      addCriterion: "Dodaj kryterium",
      noCriteria: "Brak kryteriów - recenzent wystawia tylko ocenę ogólną.",
      speakerTitle: "Przyjęty prelegent",
      speakerDescription:
        "Do jakiej grupy i z jakim biletem trafia prelegent, którego rejestrację tworzy przyjęcie zgłoszenia.",
      speakerGroup: "Grupa uczestników",
      speakerGroupHint: "Domyślnie grupa „Prelegenci”.",
      noGroup: "Bez grupy",
      speakerTicket: "Bilet",
      speakerTicketHint: "Opcjonalnie - rejestracja prelegenta jest zawsze bezpłatna.",
      noTicket: "Bez biletu",
      validation: {
        window: "Termin zgłoszeń musi przypadać po otwarciu naboru.",
        texts: "Każdy tekst może mieć do 8000 znaków.",
        formats:
          "Każda forma potrzebuje niepowtarzalnego klucza, obu etykiet (do 80 znaków) i czasu od 5 do 480 minut.",
        maxPerSubmitter: "Limit zgłoszeń na osobę to liczba od 1 do 20.",
        scoreMax: "Skala ocen kończy się na liczbie od 3 do 10.",
        minReviews: "Minimum ocen to liczba od 0 do 20.",
        criteria:
          "Każde kryterium potrzebuje niepowtarzalnego klucza, obu etykiet (do 80 znaków) i wagi od 1 do 10.",
      },
    },

    fieldTypes: {
      text: "Krótki tekst",
      textarea: "Dłuższy tekst",
      select: "Jedna z listy",
      multiselect: "Kilka z listy",
      checkbox: "Tak / nie",
      url: "Adres internetowy",
      number: "Liczba",
    },

    form: {
      lead:
        "Stała część zgłoszenia (dane prelegenta, tytuł, streszczenie, forma, ścieżka i współprelegenci) wynika z ustawień naboru. Tu dodajesz własne pytania.",
      add: "Dodaj pytanie",
      empty: "Formularz nie ma jeszcze własnych pytań.",
      columns: {
        question: "Pytanie",
        type: "Rodzaj",
        answers: "Odpowiedzi",
        actions: "Akcje",
      },
      required: "Wymagane",
      inactive: "Wyłączone",
      moveUp: "Przesuń wyżej",
      moveDown: "Przesuń niżej",
      deleteTitle: "Usunąć pytanie?",
      deleteDescription: "Pytanie zniknie z formularza zgłoszenia.",
      deleteWithAnswers_one:
        "Na to pytanie odpowiedziało {{count}} zgłoszenie. Odpowiedź zostanie w zgłoszeniu, ale nikt jej już nie zobaczy - rozważ wyłączenie pytania.",
      deleteWithAnswers_few:
        "Na to pytanie odpowiedziały {{count}} zgłoszenia. Odpowiedzi zostaną w zgłoszeniach, ale nikt ich już nie zobaczy - rozważ wyłączenie pytania.",
      deleteWithAnswers_many:
        "Na to pytanie odpowiedziało {{count}} zgłoszeń. Odpowiedzi zostaną w zgłoszeniach, ale nikt ich już nie zobaczy - rozważ wyłączenie pytania.",
      deleteWithAnswers_other:
        "Na to pytanie odpowiedziało {{count}} zgłoszenia. Odpowiedzi zostaną w zgłoszeniach, ale nikt ich już nie zobaczy - rozważ wyłączenie pytania.",
      dialog: {
        createTitle: "Nowe pytanie",
        editTitle: "Edycja pytania",
        description: "Pytanie pokaże się w formularzu zgłoszenia i w szczegółach zgłoszenia.",
        labelPl: "Pytanie (PL)",
        labelEn: "Pytanie (EN)",
        key: "Klucz techniczny",
        keyHint:
          "Małe litery, cyfry i podkreślnik. Po zapisie klucza nie da się zmienić - pod nim leżą odpowiedzi.",
        type: "Rodzaj odpowiedzi",
        helpPl: "Podpowiedź (PL)",
        helpEn: "Podpowiedź (EN)",
        required: "Wymagane",
        requiredHint: "Bez odpowiedzi nie da się wysłać zgłoszenia (szkic można zapisać).",
        active: "Widoczne w formularzu",
        activeHint: "Wyłączone pytanie znika z formularza, a zebrane odpowiedzi zostają.",
        options: "Opcje do wyboru",
        optionValue: "Wartość",
        optionPl: "Opcja (PL)",
        optionEn: "Opcja (EN)",
        addOption: "Dodaj opcję",
      },
      validation: {
        key: "Klucz: od 2 do 49 znaków, zaczyna się literą; małe litery, cyfry i podkreślnik.",
        labels: "Wpisz treść pytania w obu językach (do 200 znaków).",
        help: "Podpowiedź może mieć do 500 znaków.",
        options:
          "Pytanie wyboru potrzebuje od 1 do 50 opcji; każda z niepowtarzalną wartością i obiema etykietami.",
      },
    },

    submissions: {
      lead:
        "Zgłoszenia wysłane w naborze. Szkiców nie widać - zgłoszenie pojawia się tu po wysłaniu przez prelegenta.",
      tabs: {
        submissions: "Zgłoszenia",
        materials: "Materiały prelegentów",
      },
      counts: {
        label: "Zgłoszenia według stanu",
        total: "Wszystkie",
        needsReviews: "Poniżej minimum ocen ({{min}}): {{count}}",
      },
      filters: {
        status: "Stan",
        allStatuses: "Wszystkie stany",
        track: "Ścieżka",
        allTracks: "Wszystkie ścieżki",
        search: "Szukaj",
        searchPlaceholder: "Tytuł, prelegent albo e-mail",
        sort: "Kolejność",
      },
      sort: {
        recent: "Najnowsze",
        score: "Najwyżej ocenione",
        title: "Tytuł A-Z",
      },
      columns: {
        title: "Wystąpienie",
        speaker: "Prelegent",
        track: "Ścieżka i forma",
        status: "Stan",
        reviews: "Oceny",
        score: "Średnia",
        submitted: "Wysłane",
      },
      coSpeakers_one: "+{{count}} osoba",
      coSpeakers_few: "+{{count}} osoby",
      coSpeakers_many: "+{{count}} osób",
      coSpeakers_other: "+{{count}} osoby",
      reviewsOf: "{{count}} z {{min}}",
      belowMin: "Za mało ocen",
      noTrack: "Bez ścieżki",
      empty: "Nikt jeszcze nie wysłał zgłoszenia.",
      emptyFiltered: "Żadne zgłoszenie nie pasuje do filtrów.",
      open: "Szczegóły",
      pagination: {
        label: "Strony listy zgłoszeń",
        previous: "Poprzednia",
        next: "Następna",
        range: "{{from}}-{{to}} z {{total}}",
      },
    },

    detail: {
      title: "Zgłoszenie",
      description: "Szczegóły zgłoszenia, oceny recenzentów i decyzja.",
      submittedAt: "Wysłane {{date}}",
      decidedAt: "Ostatnia decyzja {{date}}",
      sections: {
        speakers: "Prelegenci",
        talk: "Wystąpienie",
        answers: "Odpowiedzi na pytania",
        reviews: "Oceny recenzentów",
        decision: "Decyzja",
        crm: "CRM",
        notify: "Mail do prelegenta",
        session: "Sesja w programie",
      },
      primary: "Zgłaszający",
      coSpeaker: "Współprelegent",
      pendingPerson: "Karta uczestnika i CRM powstaną po przyjęciu.",
      consentYes: "Zgoda marketingowa: tak",
      consentNo: "Zgoda marketingowa: nie",
      titlePl: "Tytuł (PL)",
      titleEn: "Tytuł (EN)",
      abstractPl: "Streszczenie (PL)",
      abstractEn: "Streszczenie (EN)",
      format: "Forma",
      duration: "{{count}} min",
      language: "Język wystąpienia",
      topics: "Tematy",
      track: "Ścieżka",
      noTrack: "Bez ścieżki",
      noFormat: "Bez formy",
      noAnswers: "Brak odpowiedzi na własne pytania.",
      answerYes: "Tak",
      answerNo: "Nie",
      answerEmpty: "Bez odpowiedzi",
      reviewsSummary: "Ocen: {{count}} (minimum {{min}})",
      overallAvg: "Średnia ogólna: {{value}}",
      weightedAvg: "Średnia ważona kryteriów: {{value}}",
      recommendationsSummary:
        "Za: {{accept}} · może: {{maybe}} · przeciw: {{reject}} · wstrzymane: {{abstain}}",
      belowMin: "Zgłoszenie ma mniej ocen niż wymagane minimum.",
      noReviews: "Nikt jeszcze nie ocenił tego zgłoszenia.",
      conflict: "Konflikt interesów - ocena nie wchodzi do średniej.",
      overall: "Ocena ogólna: {{value}}",
      noOverall: "Bez oceny ogólnej",
      recommendation: "Rekomendacja",
      commentPrivate: "Uwagi dla organizatora",
      commentToSpeaker: "Uwagi dla prelegenta",
      decisionStatus: "Nowy stan",
      decisionNote: "Notatka wewnętrzna",
      decisionNoteHint: "Widzą ją tylko organizatorzy. Przy odrzuceniu jest wymagana.",
      feedback: "Informacja zwrotna dla prelegenta",
      feedbackHint: "Prelegent zobaczy ją w swoim panelu i w mailu o decyzji.",
      applyDecision: "Zapisz decyzję",
      accept: "Przyjmij i zaplanuj",
      notDecidable: "W tym stanie zgłoszenie nie przyjmuje już decyzji organizatora.",
      noSession: "Przyjęcie nie utworzyło sesji - dodasz ją w agendzie.",
      openAgenda: "Otwórz agendę",
      validation: {
        noteRequired: "Przy odrzuceniu wpisz notatkę wewnętrzną (co najmniej 3 znaki).",
        tooLong: "Notatka może mieć do 2000 znaków, a informacja zwrotna do 4000.",
      },
    },

    crm: {
      status: {
        ok: "Zsynchronizowano z CRM",
        error: "Błąd synchronizacji z CRM",
        skipped: "Pominięto w CRM",
      },
      none: "Brak karty w CRM",
      retry: "Ponów synchronizację",
      syncedAt: "Ostatnia synchronizacja {{date}}",
    },

    notify: {
      send: "Wyślij mail o decyzji",
      sending: "Wysyłam…",
      sentAt: "Mail o stanie „{{status}}” wysłano {{date}}.",
      upToDate: "Prelegent dostał mail o aktualnej decyzji.",
      failed: "Ostatnia próba wysyłki nie powiodła się - spróbuj ponownie.",
      notApplicable: "Mail wychodzi po przyjęciu, odrzuceniu albo prośbie o zmiany.",
      pending: "Prelegent nie dostał jeszcze maila o tej decyzji.",
    },

    accept: {
      title: "Przyjęcie wystąpienia",
      description:
        "Przyjęcie dopisuje prelegentów do listy wydarzenia i zakłada ich karty w CRM. Możesz od razu utworzyć szkic sesji w programie i bezpłatną rejestrację.",
      register: "Zarejestruj prelegentów na wydarzenie",
      registerHint: "Zatwierdzona rejestracja bez opłaty - bilet z kodem QR wyjdzie automatycznie.",
      schedule: "Wstaw szkic sesji do programu",
      scheduleHint: "Sesja powstaje jako szkic z obsadą prelegentów; opublikujesz ją w agendzie.",
      startsAt: "Początek sesji",
      endsAt: "Koniec sesji",
      room: "Sala",
      noRoom: "Bez sali",
      track: "Ścieżka",
      noTrack: "Bez ścieżki",
      format: "Forma udziału",
      formats: {
        onsite: "Na miejscu",
        online: "Online",
        hybrid: "Hybrydowo",
      },
      confirm: "Przyjmij",
      validation: {
        schedule: "Podaj początek i koniec sesji - koniec po początku, najwyżej 48 godzin.",
      },
    },

    reviewers: {
      lead:
        "Recenzenci oceniają zgłoszenia w panelu recenzenta na stronie wydarzenia. Nikt nie ocenia własnego zgłoszenia, a przy ocenie w ciemno recenzent nie widzi danych prelegentów.",
      add: "Dodaj recenzenta",
      picker: {
        placeholder: "Wybierz konto",
        search: "Szukaj po nazwie",
        hint: "Wpisz co najmniej dwa znaki.",
        loading: "Szukam…",
        empty: "Brak pasujących kont.",
        clear: "Wyczyść wybór",
      },
      columns: {
        reviewer: "Recenzent",
        tracks: "Ścieżki do oceny",
        identity: "Widzi prelegentów",
        active: "Aktywny",
        reviews: "Ocen",
        actions: "Akcje",
      },
      allTracks: "Wszystkie ścieżki",
      identityHint: "Ma znaczenie tylko przy ocenie w ciemno.",
      identityLabel: "Widzi dane prelegentów: {{name}}",
      activeLabel: "Aktywny recenzent: {{name}}",
      scopeLabel: "Ścieżki recenzenta {{name}}",
      scopeHint: "Bez zaznaczenia recenzent ocenia zgłoszenia ze wszystkich ścieżek.",
      empty: "Nabór nie ma jeszcze recenzentów.",
      removeTitle: "Usunąć recenzenta?",
      removeDescription:
        "Recenzent bez ocen zniknie z listy. Recenzent z ocenami zostanie wyłączony, a jego oceny zostaną w zgłoszeniach.",
      unnamed: "Konto bez nazwy",
    },

    materials: {
      lead:
        "Materiały dodane przez prelegentów. Na stronie wydarzenia pojawiają się dopiero po publikacji; zmiana przez prelegenta wycofuje publikację.",
      empty: "Prelegenci nie dodali jeszcze materiałów.",
      columns: {
        title: "Materiał",
        speaker: "Prelegent",
        kind: "Rodzaj",
        visibility: "Dla kogo",
        status: "Publikacja",
        actions: "Akcje",
      },
      published: "Opublikowany",
      unpublished: "Nieopublikowany",
      publish: "Opublikuj",
      unpublish: "Wycofaj",
      open: "Otwórz",
    },

    toasts: {
      settingsSaved: "Zapisano ustawienia naboru.",
      fieldSaved: "Zapisano pytanie.",
      fieldDeleted: "Usunięto pytanie.",
      decisionSaved: "Zapisano decyzję.",
      accepted_one: "Przyjęto wystąpienie. Na liście prelegentów: {{count}} osoba.",
      accepted_few: "Przyjęto wystąpienie. Na liście prelegentów: {{count}} osoby.",
      accepted_many: "Przyjęto wystąpienie. Na liście prelegentów: {{count}} osób.",
      accepted_other: "Przyjęto wystąpienie. Na liście prelegentów: {{count}} osoby.",
      crmRetried: "Ponowiono synchronizację z CRM.",
      notified: "Wysłano mail do prelegenta.",
      notifySkipped: "Mail nie wyszedł - prelegent zna już tę decyzję albo zgłoszenie zmieniło stan.",
      reviewerAdded: "Dodano recenzenta.",
      reviewerSaved: "Zapisano recenzenta.",
      reviewerRemoved: "Usunięto recenzenta.",
      reviewerDeactivated: "Recenzent miał oceny - wyłączono go zamiast usuwać.",
      materialPublished: "Opublikowano materiał.",
      materialUnpublished: "Wycofano publikację materiału.",
    },

    errors: {
      forbidden: "Ta operacja jest dostępna dla administratora organizacji.",
      notFound: "Tego elementu nie ma w tej organizacji.",
      invalidPayload: "Dane żądania są nieprawidłowe. Odśwież stronę i spróbuj ponownie.",
      invalidStatus: "Ten stan nie jest tu dozwolony.",
      invalidWindow: "Termin zgłoszeń musi przypadać po otwarciu naboru.",
      invalidTexts: "Każdy tekst naboru może mieć do 8000 znaków.",
      invalidFormats:
        "Każda forma potrzebuje niepowtarzalnego klucza, obu etykiet i czasu od 5 do 480 minut (najwyżej 20 form).",
      invalidTracks: "Każda zaznaczona ścieżka musi należeć do tego wydarzenia.",
      invalidLimit: "Limit zgłoszeń na osobę to liczba od 1 do 20.",
      invalidScoreMax: "Skala ocen kończy się na liczbie od 3 do 10.",
      invalidMinReviews: "Minimum ocen to liczba od 0 do 20.",
      invalidCriteria:
        "Każde kryterium potrzebuje niepowtarzalnego klucza, obu etykiet i wagi od 1 do 10 (najwyżej 10 kryteriów).",
      invalidGroup: "Wybrana grupa nie należy do tego wydarzenia.",
      invalidTicket: "Wybrany bilet nie należy do tego wydarzenia.",
      scoreMaxBelowReviews:
        "Istniejące oceny sięgają {{count}} - skala nie może kończyć się niżej.",
      invalidKey: "Klucz: od 2 do 49 znaków, zaczyna się literą; małe litery, cyfry i podkreślnik.",
      keyTaken: "Inne pytanie tego naboru ma już ten klucz.",
      keyImmutable: "Klucza zapisanego pytania nie da się zmienić - pod nim leżą odpowiedzi.",
      invalidFieldType: "Nieznany rodzaj pytania.",
      invalidLabels: "Wpisz treść pytania w obu językach (do 200 znaków).",
      invalidHelp: "Podpowiedź może mieć do 500 znaków.",
      invalidOptions:
        "Pytanie wyboru potrzebuje od 1 do 50 opcji; każda z niepowtarzalną wartością i obiema etykietami.",
      invalidOrder: "Kolejność musi obejmować każde pytanie naboru dokładnie raz. Odśwież listę.",
      invalidTransition: "Zgłoszenie w obecnym stanie nie przyjmuje tej decyzji. Odśwież szczegóły.",
      noteRequired: "Przy odrzuceniu wpisz notatkę wewnętrzną (co najmniej 3 znaki).",
      invalidNote: "Notatka może mieć do 2000 znaków, a informacja zwrotna do 4000.",
      invalidSchedule: "Podaj początek i koniec sesji - koniec po początku, najwyżej 48 godzin.",
      invalidFormat: "Forma udziału to: na miejscu, online albo hybrydowo.",
      roomNotFound: "Wybrana sala nie należy do tego wydarzenia.",
      trackNotFound: "Wybrana ścieżka nie należy do tego wydarzenia.",
      roomConflict: "Sala jest już zajęta w tym czasie - wybierz inną godzinę albo salę.",
      sessionBeforeEvent: "Sesja zaczyna się przed początkiem wydarzenia.",
      sessionAfterEvent: "Sesja kończy się po zakończeniu wydarzenia.",
      speakerOverlap: "Prelegent ma już sesję w tym czasie.",
      reviewerNotFound: "To konto nie należy do tej organizacji.",
      invalidAuditAction: "Nie udało się zapisać wpisu w historii CRM.",
      unknown: "Operacja się nie powiodła. Spróbuj ponownie.",
    },
  },
};

export const adminEventCfpEn = {
  adminEventCfp: {
    common: {
      loading: "Loading…",
      save: "Save",
      saving: "Saving…",
      discard: "Discard changes",
      cancel: "Cancel",
      delete: "Delete",
      edit: "Edit",
      close: "Close",
      none: "none",
      yes: "Yes",
      no: "No",
    },

    list: {
      rowLegend: "Item {{index}}",
      labelPl: "Label (PL)",
      labelEn: "Label (EN)",
      key: "Key",
      remove: "Remove",
    },

    phases: {
      none: "Not started",
      scheduled: "Scheduled",
      open: "Open",
      closed: "Closed",
    },

    settings: {
      statusTitle: "Call status",
      statusDescription:
        "The call accepts submissions only while it is open and inside its time window.",
      phaseNow: "Now: {{phase}}",
      eventNotPublished:
        "The event is not published - the call page appears only once the event is published.",
      status: {
        draft: "Draft",
        open: "Open",
        closed: "Closed",
        draftHint: "The call is being prepared - its page is hidden.",
        openHint: "Accepts submissions within the time window below.",
        closedHint: "No new submissions; reviews and decisions continue.",
      },
      windowTitle: "Submission window",
      windowDescription:
        "Leave a field empty for no limit on that side. Times are in the event's time zone.",
      opensAt: "Opens",
      opensAtHint: "Before this moment the call page counts down to the opening.",
      closesAt: "Submission deadline",
      closesAtHint: "After this moment submissions can no longer be sent.",
      textsTitle: "Call page texts",
      textsDescription:
        "Everyone visiting the call page sees the introduction and guidelines. Both languages, up to 8000 characters.",
      introPl: "Introduction (PL)",
      introEn: "Introduction (EN)",
      guidelinesPl: "Guidelines (PL)",
      guidelinesEn: "Guidelines (EN)",
      formatsTitle: "Talk formats",
      formatsDescription:
        "Speakers pick a format from this list (e.g. 30-minute talk, 45-minute panel). An empty list means no format choice.",
      formatDuration: "Minutes",
      addFormat: "Add format",
      noFormats: "No formats - the submission does not ask for a talk format.",
      tracksTitle: "Tracks",
      tracksDescription:
        "Programme tracks open for submissions. With none selected the submission does not ask for a track.",
      noTracks: "The event has no tracks yet - add them in the agenda.",
      trackInactive: "(inactive)",
      rulesTitle: "Submission rules",
      rulesDescription: "How many submissions one person may send and whether they submit alone.",
      maxPerSubmitter: "Submissions per person",
      maxPerSubmitterHint: "From 1 to 20. Withdrawn submissions do not count towards the limit.",
      allowCoSpeakers: "Co-speakers",
      allowCoSpeakersHint:
        "The submitter may add up to five people. Their CRM records are created only on acceptance.",
      reviewTitle: "Review",
      reviewDescription: "How reviewers score submissions and how many reviews a decision needs.",
      reviewBlind: "Blind review",
      reviewBlindHint:
        "Reviewers do not see speaker details unless it is explicitly enabled on the reviewer list.",
      scoreMax: "Score scale (1 to…)",
      minReviews: "Minimum reviews",
      minReviewsHint: "Submissions with fewer reviews are flagged on the list. From 0 to 20.",
      criterionWeight: "Weight",
      addCriterion: "Add criterion",
      noCriteria: "No criteria - reviewers give an overall score only.",
      speakerTitle: "Accepted speaker",
      speakerDescription:
        "Which group and ticket an accepted speaker gets when acceptance creates their registration.",
      speakerGroup: "Attendee group",
      speakerGroupHint: "The “Speakers” group by default.",
      noGroup: "No group",
      speakerTicket: "Ticket",
      speakerTicketHint: "Optional - a speaker registration is always free of charge.",
      noTicket: "No ticket",
      validation: {
        window: "The submission deadline must come after the opening.",
        texts: "Each text may have up to 8000 characters.",
        formats:
          "Each format needs a unique key, both labels (up to 80 characters) and 5 to 480 minutes.",
        maxPerSubmitter: "Submissions per person must be a number from 1 to 20.",
        scoreMax: "The score scale must end at a number from 3 to 10.",
        minReviews: "Minimum reviews must be a number from 0 to 20.",
        criteria:
          "Each criterion needs a unique key, both labels (up to 80 characters) and a weight from 1 to 10.",
      },
    },

    fieldTypes: {
      text: "Short text",
      textarea: "Long text",
      select: "One from a list",
      multiselect: "Several from a list",
      checkbox: "Yes / no",
      url: "Web address",
      number: "Number",
    },

    form: {
      lead:
        "The fixed part of the submission (speaker details, title, abstract, format, track and co-speakers) follows the call settings. Here you add your own questions.",
      add: "Add question",
      empty: "The form has no custom questions yet.",
      columns: {
        question: "Question",
        type: "Type",
        answers: "Answers",
        actions: "Actions",
      },
      required: "Required",
      inactive: "Hidden",
      moveUp: "Move up",
      moveDown: "Move down",
      deleteTitle: "Delete the question?",
      deleteDescription: "The question disappears from the submission form.",
      deleteWithAnswers_one:
        "{{count}} submission answered this question. The answer stays in the submission but nobody will see it any more - consider hiding the question instead.",
      deleteWithAnswers_other:
        "{{count}} submissions answered this question. The answers stay in the submissions but nobody will see them any more - consider hiding the question instead.",
      dialog: {
        createTitle: "New question",
        editTitle: "Edit question",
        description: "The question appears in the submission form and in the submission details.",
        labelPl: "Question (PL)",
        labelEn: "Question (EN)",
        key: "Technical key",
        keyHint:
          "Lowercase letters, digits and underscores. The key cannot change once saved - answers are stored under it.",
        type: "Answer type",
        helpPl: "Hint (PL)",
        helpEn: "Hint (EN)",
        required: "Required",
        requiredHint: "A submission cannot be sent without an answer (a draft can still be saved).",
        active: "Shown in the form",
        activeHint: "A hidden question disappears from the form; collected answers are kept.",
        options: "Choice options",
        optionValue: "Value",
        optionPl: "Option (PL)",
        optionEn: "Option (EN)",
        addOption: "Add option",
      },
      validation: {
        key: "Key: 2 to 49 characters starting with a letter; lowercase letters, digits and underscores.",
        labels: "Enter the question in both languages (up to 200 characters).",
        help: "A hint may have up to 500 characters.",
        options:
          "A choice question needs 1 to 50 options, each with a unique value and both labels.",
      },
    },

    submissions: {
      lead:
        "Submissions sent to the call. Drafts are not shown - a submission appears here once the speaker sends it.",
      tabs: {
        submissions: "Submissions",
        materials: "Speaker materials",
      },
      counts: {
        label: "Submissions by status",
        total: "All",
        needsReviews: "Below the review minimum ({{min}}): {{count}}",
      },
      filters: {
        status: "Status",
        allStatuses: "All statuses",
        track: "Track",
        allTracks: "All tracks",
        search: "Search",
        searchPlaceholder: "Title, speaker or e-mail",
        sort: "Order",
      },
      sort: {
        recent: "Newest",
        score: "Highest rated",
        title: "Title A-Z",
      },
      columns: {
        title: "Talk",
        speaker: "Speaker",
        track: "Track and format",
        status: "Status",
        reviews: "Reviews",
        score: "Average",
        submitted: "Sent",
      },
      coSpeakers_one: "+{{count}} person",
      coSpeakers_other: "+{{count}} people",
      reviewsOf: "{{count}} of {{min}}",
      belowMin: "Too few reviews",
      noTrack: "No track",
      empty: "Nobody has sent a submission yet.",
      emptyFiltered: "No submission matches the filters.",
      open: "Details",
      pagination: {
        label: "Submission list pages",
        previous: "Previous",
        next: "Next",
        range: "{{from}}-{{to}} of {{total}}",
      },
    },

    detail: {
      title: "Submission",
      description: "Submission details, reviewer scores and the decision.",
      submittedAt: "Sent {{date}}",
      decidedAt: "Last decision {{date}}",
      sections: {
        speakers: "Speakers",
        talk: "Talk",
        answers: "Answers to questions",
        reviews: "Reviews",
        decision: "Decision",
        crm: "CRM",
        notify: "E-mail to the speaker",
        session: "Programme session",
      },
      primary: "Submitter",
      coSpeaker: "Co-speaker",
      pendingPerson: "The attendee and CRM records are created on acceptance.",
      consentYes: "Marketing consent: yes",
      consentNo: "Marketing consent: no",
      titlePl: "Title (PL)",
      titleEn: "Title (EN)",
      abstractPl: "Abstract (PL)",
      abstractEn: "Abstract (EN)",
      format: "Format",
      duration: "{{count}} min",
      language: "Talk language",
      topics: "Topics",
      track: "Track",
      noTrack: "No track",
      noFormat: "No format",
      noAnswers: "No answers to custom questions.",
      answerYes: "Yes",
      answerNo: "No",
      answerEmpty: "No answer",
      reviewsSummary: "Reviews: {{count}} (minimum {{min}})",
      overallAvg: "Overall average: {{value}}",
      weightedAvg: "Weighted criteria average: {{value}}",
      recommendationsSummary:
        "For: {{accept}} · maybe: {{maybe}} · against: {{reject}} · abstained: {{abstain}}",
      belowMin: "The submission has fewer reviews than the required minimum.",
      noReviews: "Nobody has reviewed this submission yet.",
      conflict: "Conflict of interest - the score is left out of the average.",
      overall: "Overall score: {{value}}",
      noOverall: "No overall score",
      recommendation: "Recommendation",
      commentPrivate: "Notes for the organisers",
      commentToSpeaker: "Notes for the speaker",
      decisionStatus: "New status",
      decisionNote: "Internal note",
      decisionNoteHint: "Only organisers see it. Required when rejecting.",
      feedback: "Feedback for the speaker",
      feedbackHint: "The speaker sees it in their panel and in the decision e-mail.",
      applyDecision: "Save decision",
      accept: "Accept and schedule",
      notDecidable: "In this status the submission no longer takes organiser decisions.",
      noSession: "Acceptance did not create a session - add one in the agenda.",
      openAgenda: "Open the agenda",
      validation: {
        noteRequired: "Enter an internal note when rejecting (at least 3 characters).",
        tooLong: "The note may have up to 2000 characters and the feedback up to 4000.",
      },
    },

    crm: {
      status: {
        ok: "Synced with CRM",
        error: "CRM sync failed",
        skipped: "Skipped in CRM",
      },
      none: "No CRM record",
      retry: "Retry sync",
      syncedAt: "Last synced {{date}}",
    },

    notify: {
      send: "Send decision e-mail",
      sending: "Sending…",
      sentAt: "The “{{status}}” e-mail was sent {{date}}.",
      upToDate: "The speaker has an e-mail about the current decision.",
      failed: "The last sending attempt failed - try again.",
      notApplicable: "An e-mail goes out after acceptance, rejection or a request for changes.",
      pending: "The speaker has not had an e-mail about this decision yet.",
    },

    accept: {
      title: "Accept the talk",
      description:
        "Acceptance adds the speakers to the event's speaker list and creates their CRM records. You can also create a draft programme session and a free registration right away.",
      register: "Register the speakers for the event",
      registerHint: "An approved free registration - the QR ticket goes out automatically.",
      schedule: "Add a draft session to the programme",
      scheduleHint: "The session is created as a draft with its speaker line-up; publish it in the agenda.",
      startsAt: "Session start",
      endsAt: "Session end",
      room: "Room",
      noRoom: "No room",
      track: "Track",
      noTrack: "No track",
      format: "Attendance format",
      formats: {
        onsite: "On site",
        online: "Online",
        hybrid: "Hybrid",
      },
      confirm: "Accept",
      validation: {
        schedule: "Enter the session start and end - the end after the start, at most 48 hours.",
      },
    },

    reviewers: {
      lead:
        "Reviewers score submissions in the reviewer panel on the event site. Nobody reviews their own submission, and in blind review reviewers do not see speaker details.",
      add: "Add reviewer",
      picker: {
        placeholder: "Choose an account",
        search: "Search by name",
        hint: "Type at least two characters.",
        loading: "Searching…",
        empty: "No matching accounts.",
        clear: "Clear selection",
      },
      columns: {
        reviewer: "Reviewer",
        tracks: "Tracks to review",
        identity: "Sees speakers",
        active: "Active",
        reviews: "Reviews",
        actions: "Actions",
      },
      allTracks: "All tracks",
      identityHint: "Matters only in blind review.",
      identityLabel: "Sees speaker details: {{name}}",
      activeLabel: "Active reviewer: {{name}}",
      scopeLabel: "Tracks of reviewer {{name}}",
      scopeHint: "With nothing selected the reviewer scores submissions from every track.",
      empty: "The call has no reviewers yet.",
      removeTitle: "Remove the reviewer?",
      removeDescription:
        "A reviewer without reviews disappears from the list. A reviewer with reviews is deactivated and their reviews stay on the submissions.",
      unnamed: "Unnamed account",
    },

    materials: {
      lead:
        "Materials added by speakers. They appear on the event site only once published; a change by the speaker withdraws the publication.",
      empty: "Speakers have not added any materials yet.",
      columns: {
        title: "Material",
        speaker: "Speaker",
        kind: "Kind",
        visibility: "Audience",
        status: "Publication",
        actions: "Actions",
      },
      published: "Published",
      unpublished: "Not published",
      publish: "Publish",
      unpublish: "Withdraw",
      open: "Open",
    },

    toasts: {
      settingsSaved: "Call settings saved.",
      fieldSaved: "Question saved.",
      fieldDeleted: "Question deleted.",
      decisionSaved: "Decision saved.",
      accepted_one: "Talk accepted. Speakers on the list: {{count}}.",
      accepted_other: "Talk accepted. Speakers on the list: {{count}}.",
      crmRetried: "CRM sync retried.",
      notified: "E-mail sent to the speaker.",
      notifySkipped:
        "No e-mail went out - the speaker already knows this decision or the submission changed status.",
      reviewerAdded: "Reviewer added.",
      reviewerSaved: "Reviewer saved.",
      reviewerRemoved: "Reviewer removed.",
      reviewerDeactivated: "The reviewer had reviews - deactivated instead of removed.",
      materialPublished: "Material published.",
      materialUnpublished: "Material publication withdrawn.",
    },

    errors: {
      forbidden: "This operation is available to the organisation's administrator.",
      notFound: "This item does not exist in this organisation.",
      invalidPayload: "The request data is invalid. Refresh the page and try again.",
      invalidStatus: "This status is not allowed here.",
      invalidWindow: "The submission deadline must come after the opening.",
      invalidTexts: "Each call text may have up to 8000 characters.",
      invalidFormats:
        "Each format needs a unique key, both labels and 5 to 480 minutes (at most 20 formats).",
      invalidTracks: "Every selected track must belong to this event.",
      invalidLimit: "Submissions per person must be a number from 1 to 20.",
      invalidScoreMax: "The score scale must end at a number from 3 to 10.",
      invalidMinReviews: "Minimum reviews must be a number from 0 to 20.",
      invalidCriteria:
        "Each criterion needs a unique key, both labels and a weight from 1 to 10 (at most 10 criteria).",
      invalidGroup: "The selected group does not belong to this event.",
      invalidTicket: "The selected ticket does not belong to this event.",
      scoreMaxBelowReviews: "Existing reviews go up to {{count}} - the scale cannot end lower.",
      invalidKey: "Key: 2 to 49 characters starting with a letter; lowercase letters, digits and underscores.",
      keyTaken: "Another question of this call already uses this key.",
      keyImmutable: "The key of a saved question cannot change - answers are stored under it.",
      invalidFieldType: "Unknown question type.",
      invalidLabels: "Enter the question in both languages (up to 200 characters).",
      invalidHelp: "A hint may have up to 500 characters.",
      invalidOptions:
        "A choice question needs 1 to 50 options, each with a unique value and both labels.",
      invalidOrder: "The order must list every question of the call exactly once. Refresh the list.",
      invalidTransition:
        "The submission's current status does not allow this decision. Refresh the details.",
      noteRequired: "Enter an internal note when rejecting (at least 3 characters).",
      invalidNote: "The note may have up to 2000 characters and the feedback up to 4000.",
      invalidSchedule: "Enter the session start and end - the end after the start, at most 48 hours.",
      invalidFormat: "The attendance format is on site, online or hybrid.",
      roomNotFound: "The selected room does not belong to this event.",
      trackNotFound: "The selected track does not belong to this event.",
      roomConflict: "The room is already taken at this time - pick another time or room.",
      sessionBeforeEvent: "The session starts before the event.",
      sessionAfterEvent: "The session ends after the event.",
      speakerOverlap: "The speaker already has a session at this time.",
      reviewerNotFound: "This account does not belong to this organisation.",
      invalidAuditAction: "The CRM history entry could not be saved.",
      unknown: "The operation failed. Try again.",
    },
  },
};

// Rejestracja przy imporcie (parytet i bramki czytają zasoby po imporcie
// modułu) oraz idempotentne `ensure…` dla modułów, które potrzebują słownika
// przed pierwszym renderem - ta sama umowa, co w `i18n-event-meetings`.
let registered = false;
export function ensureAdminEventCfpI18n(): void {
  ensureEventCfpI18n();
  if (registered) return;
  registered = true;
  i18n.addResourceBundle("pl", "translation", adminEventCfpPl, true, true);
  i18n.addResourceBundle("en", "translation", adminEventCfpEn, true, true);
}
ensureAdminEventCfpI18n();
