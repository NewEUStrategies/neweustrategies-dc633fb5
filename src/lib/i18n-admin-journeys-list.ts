// i18n zakładki „Ścieżki” (S8-A): lista ścieżek, galeria szablonów, tworzenie,
// ustawienia i pasek zdrowia silnika oraz WSPÓLNE etykiety edytora i wyników
// (`adminJourneys.common`: statusy ścieżki, kategorie, ponowne wejście, opisy
// kroków, paleta, operacje menu, problemy publikacji, powody błędów zapisu).
//
// ZERO KOLIZJI Z S5. Słownik silnika (`i18n-admin-journeys.ts`) ma już
// `adminJourneys.{nodeType, branch, trigger, triggerGroup, settings, health,
// templates, mutationError…}` - tu wyłącznie NOWE gałęzie (`list`, `gallery`,
// `create`, `engineSettings`, `engineStrip`, `common`), a etykiety pól silnika,
// nazw wyzwalaczy i szablonów czytamy z S5. Dwa różne napisy pod jednym
// kluczem zaczerwieniłyby bramkę `i18nOverlayIntegrity`.
//
// LICZEBNIKI: PL `_one/_few/_many/_other`, EN `_one/_other`; `typeof pl`
// wymaga form polskich także w EN (angielski czyta tylko `_one`/`_other`).
//
// UWAGA NA ARKUSZ CSS. Pliki `src/lib/i18n-*.ts` skanuje generator arkusza
// PUBLICZNEGO - angielskie słowo równe klasie narzędziowej Tailwinda dokłada
// regułę do CSS każdej strony czytelnika (limit `publicCss` zamrożony).
// Napisy niżej omijają takie słowa (sprawdzone kompilacją kandydatów).
//
// IMPORT WYŁĄCZNIE Z KOMPONENTÓW (`ensureI18n()`), nie z pliku trasy.
import i18n from "@/lib/i18n";

const pl = {
  adminJourneys: {
    common: {
      loading: "Wczytywanie…",
      retry: "Spróbuj ponownie",
      close: "Zamknij",
      cancel: "Anuluj",
      counter: "{{count}}/{{max}}",
      outsideFlow: "Poza przepływem",
      status: {
        draft: "Szkic",
        active: "Aktywna",
        paused: "Wstrzymana",
        archived: "Zarchiwizowana",
      },
      category: {
        marketing: "Marketing",
        service: "Usługa",
      },
      categoryHint: {
        marketing:
          "Wysyłka wyłącznie do kontaktów ze zgodą marketingową, z limitem maili na 7 dni i ciszą nocną.",
        service:
          "Komunikacja związana z usługą (np. koniec okresu próbnego). Wymaga podstawy prawnej, bez treści promocyjnych.",
      },
      reentry: {
        never: "Raz na kontakt",
        after_exit: "Ponownie po zakończeniu poprzedniego przejścia",
        cooldown: "Ponownie po okresie karencji",
      },
      summary: {
        trigger: "Start ścieżki",
        triggerSentence: "Start: {{event}}",
        triggerSentenceCondition_one: "Start: {{event}} (warunek: {{conditions}})",
        triggerSentenceCondition_few: "Start: {{event}} ({{count}} warunki: {{conditions}})",
        triggerSentenceCondition_many: "Start: {{event}} ({{count}} warunków: {{conditions}})",
        triggerSentenceCondition_other: "Start: {{event}} ({{count}} warunku: {{conditions}})",
        waitMinutes_one: "Czeka {{count}} minutę",
        waitMinutes_few: "Czeka {{count}} minuty",
        waitMinutes_many: "Czeka {{count}} minut",
        waitMinutes_other: "Czeka {{count}} minuty",
        waitHours_one: "Czeka {{count}} godzinę",
        waitHours_few: "Czeka {{count}} godziny",
        waitHours_many: "Czeka {{count}} godzin",
        waitHours_other: "Czeka {{count}} godziny",
        waitDays_one: "Czeka {{count}} dzień",
        waitDays_few: "Czeka {{count}} dni",
        waitDays_many: "Czeka {{count}} dni",
        waitDays_other: "Czeka {{count}} dnia",
        waitUntilTimeDaily: "Czeka do najbliższej {{time}}",
        waitUntilTimeWeekdays: "Czeka do {{time}} w najbliższy dzień roboczy",
        waitUntilTimeDays_one: "Czeka do {{time}} w wybrany dzień tygodnia",
        waitUntilTimeDays_few: "Czeka do {{time}} w jeden z {{count}} wybranych dni",
        waitUntilTimeDays_many: "Czeka do {{time}} w jeden z {{count}} wybranych dni",
        waitUntilTimeDays_other: "Czeka do {{time}} w jeden z {{count}} wybranych dni",
        waitUntilEvent: "Czeka na: {{event}} (najdłużej: {{limit}})",
        sendEmail: "Wyślij e-mail „{{subject}}”",
        sendEmailNoSubject: "Wyślij e-mail (treść do uzupełnienia)",
        abSplit: "Test A/B: {{a}} % / {{b}} %",
        ifElseAll_one: "Warunek: {{count}} kryterium",
        ifElseAll_few: "Warunek: wszystkie z {{count}} kryteriów",
        ifElseAll_many: "Warunek: wszystkie z {{count}} kryteriów",
        ifElseAll_other: "Warunek: wszystkie z {{count}} kryteriów",
        ifElseAny_one: "Warunek: {{count}} kryterium",
        ifElseAny_few: "Warunek: dowolne z {{count}} kryteriów",
        ifElseAny_many: "Warunek: dowolne z {{count}} kryteriów",
        ifElseAny_other: "Warunek: dowolne z {{count}} kryteriów",
        setLifecycle: "Ustaw etap cyklu życia: {{stage}}",
        setCrmStage: "Ustaw etap sprzedaży: {{stage}}",
        setCrmStageForward: "Ustaw etap sprzedaży: {{stage}} (tylko do przodu)",
        createTask_one: "Zadanie CRM „{{title}}”, termin za {{count}} dzień",
        createTask_few: "Zadanie CRM „{{title}}”, termin za {{count}} dni",
        createTask_many: "Zadanie CRM „{{title}}”, termin za {{count}} dni",
        createTask_other: "Zadanie CRM „{{title}}”, termin za {{count}} dnia",
        createTaskToday: "Zadanie CRM „{{title}}” na dziś",
        addTag: "Dodaj tag „{{tag}}”",
        removeTag: "Usuń tag „{{tag}}”",
        newsletterAdd: "Dodaj do listy newslettera „{{list}}”",
        newsletterRemove: "Usuń z listy newslettera „{{list}}”",
        notifyOwner: "Powiadom opiekuna kontaktu",
        notifyAdmins: "Powiadom administratorów",
        notifyUsers_one: "Powiadom {{count}} osobę z zespołu",
        notifyUsers_few: "Powiadom {{count}} osoby z zespołu",
        notifyUsers_many: "Powiadom {{count}} osób z zespołu",
        notifyUsers_other: "Powiadom {{count}} osoby z zespołu",
        goal: "Cel: {{label}}",
        goalNoLabel: "Cel osiągnięty",
        exit: "Koniec ścieżki",
        invalid: "Parametry kroku do poprawy",
      },
      palette: {
        time: "Czas",
        communication: "Komunikacja",
        logic: "Logika",
        crm: "CRM",
        newsletter: "Newsletter",
        end: "Zakończenie",
        waitDuration: "Czekaj określony czas",
        waitUntilTime: "Czekaj do godziny",
        waitUntilEvent: "Czekaj na zdarzenie",
        emailForbidden:
          "Przy tym wyzwalaczu ścieżka nie wysyła maili - przypomnienia o płatności wysyła moduł windykacji.",
      },
      effect: {
        wait_duration: "Kontakt zatrzymuje się na wskazany czas, potem idzie dalej.",
        wait_until_time:
          "Kontakt czeka do wybranej godziny w wybrane dni tygodnia (strefa z ustawień silnika).",
        wait_until_event:
          "Kontakt czeka na zdarzenie; gdy nie nastąpi w terminie, idzie gałęzią „Minął termin”.",
        send_email:
          "Wysyła mail, jeśli kontakt może go dostać (zgoda, limit, cisza nocna). Treść ustawiasz w panelu kroku.",
        if_else: "Dzieli kontakty na gałęzie „Tak” i „Nie” według kryteriów.",
        ab_split: "Losowo dzieli kontakty na warianty A i B w podanych proporcjach.",
        set_lifecycle_stage:
          "Ustawia etap cyklu życia w CRM (etapy klienta nadaje wyłącznie płatność).",
        set_crm_stage: "Ustawia etap sprzedaży kontaktu w CRM.",
        create_crm_task: "Tworzy zadanie CRM dla opiekuna kontaktu albo wskazanej osoby.",
        add_tag: "Dodaje tag do kontaktu w CRM.",
        remove_tag: "Usuwa tag z kontaktu w CRM.",
        notify_staff: "Wysyła powiadomienie w panelu do opiekuna, administratorów albo wybranych osób.",
        newsletter_list:
          "Dodaje albo usuwa subskrybenta z listy newslettera - nigdy nie tworzy subskrypcji bez zgody.",
        goal: "Kończy ścieżkę z osiągniętym celem (liczy się do wyników).",
        exit: "Kończy ścieżkę bez celu.",
      },
      ops: {
        insert: "Dodaj krok poniżej",
        insertBranch: "Dodaj krok w gałęzi „{{branch}}”",
        moveUp: "Przesuń wyżej",
        moveDown: "Przesuń niżej",
        duplicate: "Duplikuj krok",
        duplicateTo: "Duplikuj z dalszymi krokami…",
        mergeInto: "Połącz z krokiem…",
        replaceWithGoal: "Zamień na cel",
        replaceWithExit: "Zamień na zwykły koniec",
        keepA: "Zostaw wariant A",
        keepB: "Zostaw wariant B",
        remove: "Usuń krok",
        removeKeepFirst: "Usuń krok, zostaw pierwszą gałąź",
        removeSubtree: "Usuń krok z dalszymi krokami",
      },
      issue: {
        draft_invalid:
          "Szkic ścieżki jest niekompletny albo uszkodzony - wybierz wyzwalacz i zapisz szkic ponownie.",
        content_missing: "Brak treści maila (wariant A).",
        subject_empty: "Temat maila jest pusty.",
        unknown_variables: "Nieznane zmienne w treści (wariant {{variant}}): {{variables}}.",
        english_missing: "Brak wersji angielskiej - kontakty anglojęzyczne dostaną wersję polską.",
        content_from_template:
          "Treść maila jest identyczna z szablonem - przeczytaj ją i dostosuj przed publikacją.",
        sender_default:
          "Maile marketingowe wymagają nazwy nadawcy - ustaw ją w ustawieniach silnika.",
        legal_basis_missing: "Ścieżka usługowa wymaga podstawy prawnej.",
        engine_disabled:
          "Silnik ścieżek jest wyłączony - po publikacji nikt nie wejdzie na ścieżkę, dopóki go nie włączysz.",
        kill_switch:
          "Awaryjny wyłącznik środowiska jest aktywny - silnik stoi dla wszystkich ścieżek.",
        workflow_replace:
          "Ta ścieżka zastępuje przepis automatyzacji „{{name}}” - wyłącz go przy publikacji, żeby zadania się nie dublowały.",
      },
      reason: {
        key_taken: "Ten klucz jest już zajęty.",
        draft_invalid: "Szkic nie przeszedł walidacji.",
        journey_archived: "Ścieżka jest zarchiwizowana.",
        not_published: "Najpierw opublikuj ścieżkę.",
        graph_invalid: "Graf ścieżki zawiera błędy.",
        content_missing: "Brakuje treści co najmniej jednego maila.",
        trigger_invalid: "Wyzwalacz jest niepoprawny.",
        goal_invalid: "Cel ścieżki jest niepoprawny.",
        exit_invalid: "Zdarzenie wyjścia jest niepoprawne.",
        node_not_email: "Najpierw zapisz krok maila w szkicu.",
        doc_invalid: "Treść maila jest niepoprawna.",
        doc_too_large: "Treść maila jest za duża.",
        own_lead_missing:
          "Nie masz kontaktu w CRM powiązanego z Twoim kontem - test na sobie go wymaga.",
        not_waiting: "Kontakt już nie czeka na tym kroku.",
        timezone_invalid: "Nieznana strefa czasowa.",
        assignee_not_staff: "Wybrana osoba nie należy do zespołu.",
      },
    },
    list: {
      title: "Ścieżki komunikacji",
      description:
        "Automatyczne sekwencje maili i działań w CRM uruchamiane zdarzeniami w serwisie - od powitania nowego konta po odzyskiwanie odchodzących klientów.",
      newJourney: "Nowa ścieżka",
      engineSettings: "Ustawienia silnika",
      searchPlaceholder: "Szukaj po nazwie, kluczu albo wyzwalaczu…",
      statusFilter: "Status ścieżki",
      statusAll: "Wszystkie statusy",
      caption: "Ścieżki komunikacji najemcy",
      scrollRegion: "Lista ścieżek (przewijana w poziomie)",
      columns: {
        name: "Ścieżka",
        status: "Status",
        trigger: "Wyzwalacz",
        active: "W toku",
        enrolled30d: "Wejścia (30 dni)",
        goal30d: "Cel (30 dni)",
        version: "Wersja",
        actions: "Akcje",
      },
      noTrigger: "Brak wyzwalacza",
      versionNone: "Nieopublikowana",
      versionValue: "v{{version}}",
      fromTemplate: "Z szablonu",
      goalRate: "{{rate}} wejść",
      open: "Otwórz ścieżkę „{{name}}”",
      emptyFiltered: "Żadna ścieżka nie pasuje do filtra.",
      empty: "Nie masz jeszcze żadnej ścieżki - wybierz szablon albo zacznij od pustej ścieżki.",
      loading: "Wczytywanie ścieżek…",
      loadError: "Nie udało się wczytać ścieżek.",
      actions: {
        pause: "Wstrzymaj",
        resume: "Wznów",
        archive: "Archiwizuj",
        pauseFor: "Wstrzymaj ścieżkę „{{name}}”",
        resumeFor: "Wznów ścieżkę „{{name}}”",
        archiveFor: "Archiwizuj ścieżkę „{{name}}”",
      },
      confirm: {
        pauseTitle: "Wstrzymać ścieżkę „{{name}}”?",
        pauseBody:
          "Nowe kontakty przestaną wchodzić, a kontakty w toku zatrzymają się na bieżącym kroku do wznowienia.",
        resumeTitle: "Wznowić ścieżkę „{{name}}”?",
        resumeBody: "Kontakty w toku ruszą od kroku, na którym stały, a nowe zdarzenia znowu zapiszą kontakty.",
        archiveTitle: "Zarchiwizować ścieżkę „{{name}}”?",
        archiveBody:
          "Kontakty w toku wyjdą ze ścieżki, a nowe nie wejdą. Wyniki zostają do wglądu; tej operacji nie da się cofnąć z listy.",
      },
      statusError: "Nie udało się zmienić statusu ścieżki.",
      done: {
        paused: "Ścieżka wstrzymana.",
        active: "Ścieżka wznowiona.",
        archived: "Ścieżka zarchiwizowana.",
      },
      unavailableTitle: "Funkcje silnika ścieżek nie są jeszcze wdrożone",
      unavailableBody:
        "Baza tej instancji nie ma jeszcze funkcji ścieżek komunikacji (migracje silnika S5).",
      unavailableNext:
        "Następny krok: wdróż migracje silnika ścieżek - zakładka zadziała bez przeładowania panelu.",
      count_one: "{{count}} ścieżka",
      count_few: "{{count}} ścieżki",
      count_many: "{{count}} ścieżek",
      count_other: "{{count}} ścieżki",
    },
    gallery: {
      title: "Nowa ścieżka - wybierz szablon",
      description:
        "Szablon to gotowy szkic: wyzwalacz, kroki i treść maili do przeczytania i dostosowania. Nic nie zostanie wysłane przed publikacją.",
      close: "Zamknij galerię",
      list: "Szablony ścieżek",
      blankTitle: "Pusta ścieżka",
      blankDescription: "Zacznij od wyzwalacza i dodawaj kroki samodzielnie na kanwie.",
      blankAction: "Utwórz pustą ścieżkę",
      use: "Użyj szablonu",
      useFor: "Użyj szablonu „{{name}}”",
      installed: "Zainstalowany",
      unavailable: "Niedostępny",
      unavailableReason:
        "Czeka na zdarzenie „{{event}}”, którego serwis jeszcze nie wysyła - instalacja odblokuje się po jego dodaniu.",
      facts: "Fakty szablonu",
      trigger: "Start",
      goal: "Cel",
      noGoal: "Bez celu - ścieżka kończy się po ostatnim kroku",
      emails: "Maile",
      steps: "Kroki",
      reentry: "Ponowne wejście",
      cooldown_one: "po {{count}} dniu karencji",
      cooldown_few: "po {{count}} dniach karencji",
      cooldown_many: "po {{count}} dniach karencji",
      cooldown_other: "po {{count}} dnia karencji",
      emailCount_one: "{{count}} mail",
      emailCount_few: "{{count}} maile",
      emailCount_many: "{{count}} maili",
      emailCount_other: "{{count}} maila",
      stepCount_one: "{{count}} krok",
      stepCount_few: "{{count}} kroki",
      stepCount_many: "{{count}} kroków",
      stepCount_other: "{{count}} kroku",
      subjects: "Tematy maili",
      requirementsTitle: "Wymagania",
      doesNotSendTitle: "Czego NIE wysyła",
      tipTitle: "Wskazówka Insidera",
      replaces:
        "Zastępuje przepis automatyzacji „{{name}}” - przy publikacji zaproponujemy jego wyłączenie.",
      loading: "Wczytywanie szablonów…",
      loadError: "Nie udało się wczytać szablonów.",
      requirement: {
        marketingConsent: "Zgoda marketingowa kontaktu (bez niej mail nie wyjdzie)",
        senderName: "Nazwa nadawcy w ustawieniach silnika",
        legalBasis: "Podstawa prawna komunikacji usługowej",
        busEvent: "Zdarzenie, którego serwis jeszcze nie wysyła",
      },
      doesNotSend: {
        noEmails: "Żadnych maili do kontaktu - tylko zadania i powiadomienia w CRM",
        withoutConsent: "Maili do osób bez zgody marketingowej",
        promotions: "Treści promocyjnych - tylko informację o usłudze",
        dunning: "Przypomnień o płatności - wysyła je moduł windykacji",
        afterPurchase: "Zachęt do zakupu po płatności - zakup kończy ścieżkę",
        toPayingMembers: "Oferty członkostwa osobom, które już mają plan",
        tickets: "Przypomnień o biletach - wydarzenia mają własną pocztę",
        cancelObstacles: "Niczego, co utrudnia anulowanie",
        paused: "Maili do osób, które tylko wstrzymały subskrypcję",
        eventReminders: "Przypomnień o terminie wydarzenia - wysyła je poczta wydarzeń",
        secretClubs: "Maili w sprawie klubów tajnych",
        afterDecision: "Maila, gdy decyzja zapadła w terminie",
        beforeConfirmation: "Maili przed potwierdzeniem zapisu na newsletter",
        machineOpens: "Decyzji na podstawie otwarć automatycznych (np. Apple MPP)",
        offerFirst: "Oferty w pierwszym mailu - najpierw wartość",
      },
      tip: {
        welcome_onboarding:
          "Cel ścieżki to kamień milowy aktywacji; w każdym mailu proś o jeden konkretny krok.",
        newsletter_welcome:
          "Przypomnij wartość newslettera w pierwszych wysyłkach i pokaż centrum preferencji zamiast samego wypisu.",
        paywall_nurture:
          "Najpierw wartość, potem oferta: zimny odbiorca dostaje materiał, a nie ofertę z końca lejka; jedno wezwanie do działania.",
        quota_exhausted_upgrade:
          "Pisz w chwili wyczerpania limitu, gdy motywacja jest najwyższa, i pokaż, co czytelnik traci bez planu.",
        abandoned_checkout:
          "Pierwsza wiadomość w ciągu kilku godzin od porzucenia; to marketing, więc wymaga zgody.",
        trial_ending:
          "Komunikat transakcyjny: koniec dostępu i warunki dalszej subskrypcji, bez promocji.",
        payment_failed_crm:
          "Maile windykacji zostają w module płatności; ścieżka daje opiekunowi zadanie i kontekst.",
        cancel_scheduled_save:
          "Zapytaj o powód rezygnacji i nie utrudniaj anulowania - analiza powodów jest cenniejsza niż jedna zatrzymana osoba.",
        winback_30d:
          "Pokaż, co zmieniło się od odejścia; analizuj kohorty odejść, zanim zmienisz ofertę.",
        event_registration_nurture:
          "Przypomnienia terminu wysyła poczta wydarzeń; tu dawaj materiały i kontekst, nagranie zapowiadaj tylko uczestnikom.",
        event_attended_upsell:
          "Pisz zaraz po wydarzeniu, póki wrażenia są świeże; materiały jako podziękowanie, potem prośba o opinię.",
        club_application_received:
          "Natychmiastowe potwierdzenie z terminem decyzji buduje zaufanie do klubu.",
        club_application_followup:
          "Spójne z regułą diagnostyki zgłoszeń czekających ponad tydzień - zespół dostaje zadanie, zgłaszający informację.",
        pricing_enquiry_b2b:
          "Pierwsza próba kontaktu w ciągu godziny: powiadomienie zespołu działa od razu, zadanie liczy terminy w dniach.",
      },
    },
    create: {
      templateTitle: "Instalacja szablonu „{{name}}”",
      templateDescription:
        "Powstanie szkic z grafem i treścią maili szablonu. Przeczytaj i dostosuj treść przed publikacją.",
      blankTitle: "Nowa pusta ścieżka",
      blankDescription:
        "Wybierz wyzwalacz - resztę kroków dodasz na kanwie. Szkic niczego nie wysyła.",
      key: "Klucz techniczny",
      keyHint: "3-64 znaki: małe litery, cyfry, „_” i „-”. Nie zmienia się po utworzeniu.",
      keyInvalid: "Klucz musi mieć 3-64 znaki: małe litery, cyfry, „_” albo „-”.",
      keyTaken: "Ten klucz jest już zajęty - wybierz inny.",
      name: "Nazwa",
      nameInvalid: "Nazwa musi mieć od 1 do 160 znaków.",
      description: "Opis (opcjonalnie)",
      descriptionTooLong: "Opis może mieć najwyżej 2000 znaków.",
      language: "Język podstawy prawnej",
      languageHint: "Szablon usługowy niesie gotową podstawę prawną w dwóch językach.",
      languagePl: "Polski",
      languageEn: "Angielski",
      category: "Kategoria",
      legalBasis: "Podstawa prawna",
      legalBasisHint: "Np. „wykonanie umowy - informacja o warunkach subskrypcji”.",
      legalBasisRequired: "Ścieżka usługowa wymaga podstawy prawnej (1-500 znaków).",
      trigger: "Wyzwalacz",
      triggerPlaceholder: "Wybierz zdarzenie startowe…",
      triggerHint: "Zdarzenie w serwisie, które zapisuje kontakt na ścieżkę.",
      triggerRequired: "Wybierz wyzwalacz.",
      triggerEmailForbidden:
        "Przy tym wyzwalaczu ścieżka nie wysyła maili - przypomnienia o płatności wysyła moduł windykacji.",
      submitTemplate: "Zainstaluj i otwórz edytor",
      submitBlank: "Utwórz i otwórz edytor",
      submitting: "Tworzenie…",
      installed: "Szablon zainstalowany jako szkic.",
      created: "Ścieżka utworzona.",
      draftNotSaved:
        "Ścieżka utworzona, ale wyzwalacza nie udało się zapisać - ustaw go w edytorze.",
      templateUnavailable:
        "Ten szablon czeka na zdarzenie, którego serwis jeszcze nie wysyła - nie da się go zainstalować.",
      error: "Nie udało się utworzyć ścieżki.",
    },
    engineSettings: {
      title: "Ustawienia silnika ścieżek",
      description:
        "Wspólne dla wszystkich ścieżek najemcy: włączenie, limit maili marketingowych, cisza nocna, nadawca i pomiar otwarć.",
      readOnly: "Podgląd - ustawienia silnika zmienia wyłącznie administrator.",
      notStored:
        "Ustawienia nie były jeszcze zapisywane - widzisz wartości domyślne. Silnik pozostaje wyłączony do pierwszego zapisu.",
      loading: "Wczytywanie ustawień…",
      loadError: "Nie udało się wczytać ustawień silnika.",
      sectionEngine: "Silnik",
      sectionLimits: "Limity i pora wysyłki",
      sectionSender: "Nadawca",
      sectionTracking: "Pomiar",
      marketingCapUnit_one: "{{count}} mail",
      marketingCapUnit_few: "{{count}} maile",
      marketingCapUnit_many: "{{count}} maili",
      marketingCapUnit_other: "{{count}} maila",
      quietInvalid: "Podaj godzinę w formacie GG:MM.",
      assigneeNone: "Opiekun kontaktu (bez domyślnej osoby)",
      assigneeUnknown: "Osoba spoza listy zespołu",
      machineOpenHint:
        "Otwarcie szybsze niż próg od wysyłki uznajemy za automatyczne (np. Apple MPP) i pomijamy w otwarciach ludzkich.",
      machineOpenInvalid: "Podaj liczbę sekund od 0 do 30.",
      senderNamePlaceholder: "Np. Anna Kowalska z New European Strategies",
      senderNameInvalid: "Nazwa nadawcy: 1-120 znaków, bez znaków < > \" i nowych linii.",
      senderNameMissing:
        "Bez nazwy nadawcy maile wychodzą z nazwą serwisu, a ścieżki marketingowe nie zostaną opublikowane.",
      replyToHint: "Odpowiedzi kontaktów trafią na ten adres zamiast do skrzynki bez obsługi.",
      replyToInvalid: "Podaj poprawny adres e-mail (najwyżej 254 znaki).",
      openTracking: "Pomiar otwarć (piksel)",
      openTrackingHint:
        "Wyłączony: nowe maile wychodzą bez piksela i otwarcia nie są zapisywane; kliknięcia mierzymy dalej. To samo ustawienie jest w karcie „Retencja danych”.",
      save: "Zapisz ustawienia",
      saving: "Zapisywanie…",
      noChanges: "Brak zmian do zapisania.",
      saved: "Ustawienia silnika zapisane.",
      conflict:
        "Ktoś zmienił ustawienia w międzyczasie - wczytaliśmy aktualne wartości. Wprowadź zmiany ponownie.",
      error: "Nie udało się zapisać ustawień.",
      confirmEnableTitle: "Włączyć silnik ścieżek?",
      confirmEnableBody:
        "Aktywne ścieżki zaczną zapisywać kontakty i wysyłać maile. Limit: {{cap}} na 7 dni; cisza nocna {{start}}-{{end}} ({{zone}}); nadawca: {{sender}}.",
      confirmEnable: "Włącz silnik",
      senderFallback: "nazwa serwisu",
    },
    engineStrip: {
      enabled: "Włączony",
      disabled: "Wyłączony",
      killSwitch: "Wyłącznik awaryjny",
      never: "jeszcze nie było",
      settings: "Ustawienia silnika",
      preview: "Podgląd ustawień",
      loading: "Wczytywanie stanu silnika…",
      loadError: "Nie udało się wczytać stanu silnika.",
      unavailable: "Silnik ścieżek nie jest jeszcze wdrożony w tej bazie.",
      notice: {
        kill_switch:
          "Awaryjny wyłącznik środowiska zatrzymał silnik dla wszystkich najemców - żadna ścieżka nie wykonuje kroków.",
        disabled:
          "Silnik jest wyłączony: żaden kontakt nie wejdzie na ścieżkę ani nie dostanie maila. Włącz go w ustawieniach silnika.",
        scheduler_pending:
          "Kontakty czekają na wykonanie, ale żaden krok jeszcze się nie wykonał - kroki ruszą po podpięciu harmonogramu (I9).",
        stalled:
          "Kontakty czekają, a ostatni krok wykonał się ponad kwadrans temu - harmonogram silnika mógł stanąć.",
        errors: "W ostatniej dobie wystąpiły błędy wykonania - sprawdź ostatnie błędy poniżej.",
      },
    },
  },
};

const en: typeof pl = {
  adminJourneys: {
    common: {
      loading: "Loading…",
      retry: "Try again",
      close: "Close",
      cancel: "Cancel",
      counter: "{{count}}/{{max}}",
      outsideFlow: "Outside the flow",
      status: {
        draft: "Draft",
        active: "Active",
        paused: "Paused",
        archived: "Archived",
      },
      category: {
        marketing: "Marketing",
        service: "Service",
      },
      categoryHint: {
        marketing:
          "Sent only to contacts with marketing consent, within the 7-day email cap and outside quiet hours.",
        service:
          "Service communication (for example the end of a trial). Requires a legal basis, no promotional content.",
      },
      reentry: {
        never: "Once per contact",
        after_exit: "Again once the previous run has ended",
        cooldown: "Again after a cooling-off period",
      },
      summary: {
        trigger: "Journey start",
        triggerSentence: "Start: {{event}}",
        triggerSentenceCondition_one: "Start: {{event}} (condition: {{conditions}})",
        triggerSentenceCondition_few: "Start: {{event}} ({{count}} conditions: {{conditions}})",
        triggerSentenceCondition_many: "Start: {{event}} ({{count}} conditions: {{conditions}})",
        triggerSentenceCondition_other: "Start: {{event}} ({{count}} conditions: {{conditions}})",
        waitMinutes_one: "Waits {{count}} minute",
        waitMinutes_few: "Waits {{count}} minutes",
        waitMinutes_many: "Waits {{count}} minutes",
        waitMinutes_other: "Waits {{count}} minutes",
        waitHours_one: "Waits {{count}} hour",
        waitHours_few: "Waits {{count}} hours",
        waitHours_many: "Waits {{count}} hours",
        waitHours_other: "Waits {{count}} hours",
        waitDays_one: "Waits {{count}} day",
        waitDays_few: "Waits {{count}} days",
        waitDays_many: "Waits {{count}} days",
        waitDays_other: "Waits {{count}} days",
        waitUntilTimeDaily: "Waits until the next {{time}}",
        waitUntilTimeWeekdays: "Waits until {{time}} on the next working day",
        waitUntilTimeDays_one: "Waits until {{time}} on the selected weekday",
        waitUntilTimeDays_few: "Waits until {{time}} on one of {{count}} selected days",
        waitUntilTimeDays_many: "Waits until {{time}} on one of {{count}} selected days",
        waitUntilTimeDays_other: "Waits until {{time}} on one of {{count}} selected days",
        waitUntilEvent: "Waits for: {{event}} (at most: {{limit}})",
        sendEmail: "Send email “{{subject}}”",
        sendEmailNoSubject: "Send email (content to be written)",
        abSplit: "A/B test: {{a}}% / {{b}}%",
        ifElseAll_one: "Condition: {{count}} criterion",
        ifElseAll_few: "Condition: all of {{count}} criteria",
        ifElseAll_many: "Condition: all of {{count}} criteria",
        ifElseAll_other: "Condition: all of {{count}} criteria",
        ifElseAny_one: "Condition: {{count}} criterion",
        ifElseAny_few: "Condition: any of {{count}} criteria",
        ifElseAny_many: "Condition: any of {{count}} criteria",
        ifElseAny_other: "Condition: any of {{count}} criteria",
        setLifecycle: "Set lifecycle stage: {{stage}}",
        setCrmStage: "Set sales stage: {{stage}}",
        setCrmStageForward: "Set sales stage: {{stage}} (forward only)",
        createTask_one: "CRM task “{{title}}”, due in {{count}} day",
        createTask_few: "CRM task “{{title}}”, due in {{count}} days",
        createTask_many: "CRM task “{{title}}”, due in {{count}} days",
        createTask_other: "CRM task “{{title}}”, due in {{count}} days",
        createTaskToday: "CRM task “{{title}}” due today",
        addTag: "Add tag “{{tag}}”",
        removeTag: "Remove tag “{{tag}}”",
        newsletterAdd: "Add to newsletter list “{{list}}”",
        newsletterRemove: "Remove from newsletter list “{{list}}”",
        notifyOwner: "Notify the contact owner",
        notifyAdmins: "Notify administrators",
        notifyUsers_one: "Notify {{count}} team member",
        notifyUsers_few: "Notify {{count}} team members",
        notifyUsers_many: "Notify {{count}} team members",
        notifyUsers_other: "Notify {{count}} team members",
        goal: "Goal: {{label}}",
        goalNoLabel: "Goal reached",
        exit: "End of journey",
        invalid: "Step settings need fixing",
      },
      palette: {
        time: "Timing",
        communication: "Communication",
        logic: "Logic",
        crm: "CRM",
        newsletter: "Newsletter",
        end: "Ending",
        waitDuration: "Wait for a set time",
        waitUntilTime: "Wait until a time of day",
        waitUntilEvent: "Wait for an event",
        emailForbidden:
          "With this trigger the journey sends no emails - payment reminders come from the dunning module.",
      },
      effect: {
        wait_duration: "The contact pauses for the given time, then moves on.",
        wait_until_time:
          "The contact waits until the chosen time on the chosen weekdays (zone from the engine settings).",
        wait_until_event:
          "The contact waits for an event; if it does not happen in time, it follows the “Timed out” branch.",
        send_email:
          "Sends an email if the contact may receive it (consent, cap, quiet hours). You write the content in the step panel.",
        if_else: "Splits contacts into “Yes” and “No” branches by criteria.",
        ab_split: "Randomly splits contacts into variants A and B in the given proportions.",
        set_lifecycle_stage:
          "Sets the lifecycle stage in the CRM (customer stages are set by payments only).",
        set_crm_stage: "Sets the contact’s sales stage in the CRM.",
        create_crm_task: "Creates a CRM task for the contact owner or a chosen person.",
        add_tag: "Adds a tag to the contact in the CRM.",
        remove_tag: "Removes a tag from the contact in the CRM.",
        notify_staff: "Sends a panel notification to the owner, administrators or chosen people.",
        newsletter_list:
          "Adds or removes a subscriber from a newsletter list - never creates a subscription without consent.",
        goal: "Ends the journey with the goal reached (counts towards results).",
        exit: "Ends the journey without a goal.",
      },
      ops: {
        insert: "Add a step below",
        insertBranch: "Add a step in the “{{branch}}” branch",
        moveUp: "Move up",
        moveDown: "Move down",
        duplicate: "Duplicate step",
        duplicateTo: "Duplicate with the following steps…",
        mergeInto: "Connect to step…",
        replaceWithGoal: "Turn into a goal",
        replaceWithExit: "Turn into a plain ending",
        keepA: "Keep variant A",
        keepB: "Keep variant B",
        remove: "Delete step",
        removeKeepFirst: "Delete step, keep the first branch",
        removeSubtree: "Delete step with the following steps",
      },
      issue: {
        draft_invalid:
          "The journey draft is incomplete or damaged - choose a trigger and save the draft again.",
        content_missing: "Email content is missing (variant A).",
        subject_empty: "The email subject is empty.",
        unknown_variables: "Unknown variables in the content (variant {{variant}}): {{variables}}.",
        english_missing: "No English version - English-speaking contacts will get the Polish one.",
        content_from_template:
          "The email content is identical to the template - read it and adapt it before publishing.",
        sender_default:
          "Marketing emails need a sender name - set it in the engine settings.",
        legal_basis_missing: "A service journey needs a legal basis.",
        engine_disabled:
          "The journey engine is switched off - after publishing nobody enters the journey until you switch it on.",
        kill_switch:
          "The environment emergency switch is on - the engine is stopped for every journey.",
        workflow_replace:
          "This journey replaces the automation recipe “{{name}}” - switch it off when publishing so tasks are not duplicated.",
      },
      reason: {
        key_taken: "This key is already taken.",
        draft_invalid: "The draft did not pass validation.",
        journey_archived: "The journey is archived.",
        not_published: "Publish the journey first.",
        graph_invalid: "The journey graph has errors.",
        content_missing: "At least one email has no content.",
        trigger_invalid: "The trigger is not valid.",
        goal_invalid: "The journey goal is not valid.",
        exit_invalid: "The exit event is not valid.",
        node_not_email: "Save the email step in the draft first.",
        doc_invalid: "The email content is not valid.",
        doc_too_large: "The email content is too large.",
        own_lead_missing:
          "There is no CRM contact linked to your account - the self-test needs one.",
        not_waiting: "The contact is no longer waiting at this step.",
        timezone_invalid: "Unknown time zone.",
        assignee_not_staff: "The chosen person is not a team member.",
      },
    },
    list: {
      title: "Communication journeys",
      description:
        "Automated sequences of emails and CRM actions started by events on the site - from welcoming a new account to winning back leaving customers.",
      newJourney: "New journey",
      engineSettings: "Engine settings",
      searchPlaceholder: "Search by name, key or trigger…",
      statusFilter: "Journey status",
      statusAll: "All statuses",
      caption: "Communication journeys of this workspace",
      scrollRegion: "Journeys list (scrolls sideways)",
      columns: {
        name: "Journey",
        status: "Status",
        trigger: "Trigger",
        active: "In progress",
        enrolled30d: "Entries (30 days)",
        goal30d: "Goal (30 days)",
        version: "Version",
        actions: "Actions",
      },
      noTrigger: "No trigger",
      versionNone: "Not published",
      versionValue: "v{{version}}",
      fromTemplate: "From a template",
      goalRate: "{{rate}} of entries",
      open: "Open journey “{{name}}”",
      emptyFiltered: "No journey matches the search or status.",
      empty: "You have no journeys yet - pick a template or start from an empty journey.",
      loading: "Loading journeys…",
      loadError: "Could not load journeys.",
      actions: {
        pause: "Pause",
        resume: "Resume",
        archive: "Archive",
        pauseFor: "Pause journey “{{name}}”",
        resumeFor: "Resume journey “{{name}}”",
        archiveFor: "Archive journey “{{name}}”",
      },
      confirm: {
        pauseTitle: "Pause journey “{{name}}”?",
        pauseBody:
          "New contacts stop entering, and contacts in progress stay at their current step until you resume.",
        resumeTitle: "Resume journey “{{name}}”?",
        resumeBody:
          "Contacts in progress continue from the step where they stopped, and new events enrol contacts again.",
        archiveTitle: "Archive journey “{{name}}”?",
        archiveBody:
          "Contacts in progress leave the journey and no new ones enter. Results stay available; this cannot be undone from the list.",
      },
      statusError: "Could not change the journey status.",
      done: {
        paused: "Journey paused.",
        active: "Journey resumed.",
        archived: "Journey archived.",
      },
      unavailableTitle: "Journey engine features are not deployed yet",
      unavailableBody:
        "The database of this instance does not have the communication journey functions yet (S5 engine migrations).",
      unavailableNext:
        "Next step: deploy the journey engine migrations - this tab will work without reloading the panel.",
      count_one: "{{count}} journey",
      count_few: "{{count}} journeys",
      count_many: "{{count}} journeys",
      count_other: "{{count}} journeys",
    },
    gallery: {
      title: "New journey - choose a template",
      description:
        "A template is a ready draft: trigger, steps and email content to read and adapt. Nothing is sent before publishing.",
      close: "Close the gallery",
      list: "Journey templates",
      blankTitle: "Empty journey",
      blankDescription: "Start with a trigger and add the steps yourself on the canvas.",
      blankAction: "Create an empty journey",
      use: "Use template",
      useFor: "Use template “{{name}}”",
      installed: "Installed",
      unavailable: "Unavailable",
      unavailableReason:
        "Waits for the event “{{event}}”, which the site does not emit yet - installation unlocks once it exists.",
      facts: "Template facts",
      trigger: "Start",
      goal: "Goal",
      noGoal: "No goal - the journey ends after the last step",
      emails: "Emails",
      steps: "Steps",
      reentry: "Re-entry",
      cooldown_one: "after {{count}} cooling-off day",
      cooldown_few: "after {{count}} cooling-off days",
      cooldown_many: "after {{count}} cooling-off days",
      cooldown_other: "after {{count}} cooling-off days",
      emailCount_one: "{{count}} email",
      emailCount_few: "{{count}} emails",
      emailCount_many: "{{count}} emails",
      emailCount_other: "{{count}} emails",
      stepCount_one: "{{count}} step",
      stepCount_few: "{{count}} steps",
      stepCount_many: "{{count}} steps",
      stepCount_other: "{{count}} steps",
      subjects: "Email subjects",
      requirementsTitle: "Requirements",
      doesNotSendTitle: "What it does NOT send",
      tipTitle: "Insider tip",
      replaces:
        "Replaces the automation recipe “{{name}}” - when publishing we will offer to switch it off.",
      loading: "Loading templates…",
      loadError: "Could not load templates.",
      requirement: {
        marketingConsent: "Marketing consent of the contact (no email goes out without it)",
        senderName: "A sender name in the engine settings",
        legalBasis: "A legal basis for service communication",
        busEvent: "An event the site does not emit yet",
      },
      doesNotSend: {
        noEmails: "No emails to the contact - only CRM tasks and notifications",
        withoutConsent: "Emails to people without marketing consent",
        promotions: "Promotional content - only service information",
        dunning: "Payment reminders - the dunning module sends them",
        afterPurchase: "Purchase nudges after payment - buying ends the journey",
        toPayingMembers: "Membership offers to people who already have a plan",
        tickets: "Ticket reminders - events have their own email",
        cancelObstacles: "Anything that makes cancelling harder",
        paused: "Emails to people who only paused their subscription",
        eventReminders: "Event date reminders - event email sends them",
        secretClubs: "Emails about secret clubs",
        afterDecision: "An email when the decision was made on time",
        beforeConfirmation: "Emails before the newsletter sign-up is confirmed",
        machineOpens: "Decisions based on automated opens (such as Apple MPP)",
        offerFirst: "An offer in the first email - value comes first",
      },
      tip: {
        welcome_onboarding:
          "The journey goal is an activation milestone; ask for one concrete step in every email.",
        newsletter_welcome:
          "Remind readers what the newsletter is worth in the first sends and offer a preference centre rather than only an unsubscribe link.",
        paywall_nurture:
          "Value first, offer second: a cold reader gets material, not an offer from the end of the funnel; one call to action.",
        quota_exhausted_upgrade:
          "Write at the moment the quota runs out, when motivation peaks, and show what the reader loses without a plan.",
        abandoned_checkout:
          "Send the first message within a few hours of abandonment; this is marketing, so consent is required.",
        trial_ending:
          "A transactional notice: end of access and the terms of the continuing subscription, no promotion.",
        payment_failed_crm:
          "Dunning emails stay in the payments module; the journey gives the account owner a task and context.",
        cancel_scheduled_save:
          "Ask for the reason and never make cancelling harder - understanding reasons is worth more than one retained person.",
        winback_30d:
          "Show what has changed since they left; study churn cohorts before changing the offer.",
        event_registration_nurture:
          "Event email sends the date reminders; here give materials and context, and announce the recording to attendees only.",
        event_attended_upsell:
          "Write right after the event while impressions are fresh; materials as a thank-you, then ask for feedback.",
        club_application_received:
          "An instant confirmation with the decision date builds trust in the club.",
        club_application_followup:
          "Consistent with the diagnostics rule for applications waiting over a week - the team gets a task, the applicant an update.",
        pricing_enquiry_b2b:
          "First contact attempt within an hour: the team notification works at once, the task counts due dates in days.",
      },
    },
    create: {
      templateTitle: "Install template “{{name}}”",
      templateDescription:
        "A draft with the template graph and email content will be created. Read and adapt the content before publishing.",
      blankTitle: "New empty journey",
      blankDescription:
        "Choose a trigger - you will add the remaining steps on the canvas. A draft sends nothing.",
      key: "Technical key",
      keyHint: "3-64 characters: lower-case letters, digits, “_” and “-”. It cannot be changed later.",
      keyInvalid: "The key needs 3-64 characters: lower-case letters, digits, “_” or “-”.",
      keyTaken: "This key is already taken - choose another one.",
      name: "Name",
      nameInvalid: "The name needs between 1 and 160 characters.",
      description: "Description (optional)",
      descriptionTooLong: "The description can have at most 2000 characters.",
      language: "Language of the legal basis",
      languageHint: "A service template carries a ready legal basis in two languages.",
      languagePl: "Polish",
      languageEn: "English",
      category: "Category",
      legalBasis: "Legal basis",
      legalBasisHint: "For example “performance of a contract - subscription terms notice”.",
      legalBasisRequired: "A service journey needs a legal basis (1-500 characters).",
      trigger: "Trigger",
      triggerPlaceholder: "Choose the starting event…",
      triggerHint: "The site event that enrols a contact in the journey.",
      triggerRequired: "Choose a trigger.",
      triggerEmailForbidden:
        "With this trigger the journey sends no emails - payment reminders come from the dunning module.",
      submitTemplate: "Install and open the editor",
      submitBlank: "Create and open the editor",
      submitting: "Creating…",
      installed: "Template installed as a draft.",
      created: "Journey created.",
      draftNotSaved: "The journey was created, but the trigger could not be saved - set it in the editor.",
      templateUnavailable:
        "This template waits for an event the site does not emit yet - it cannot be installed.",
      error: "Could not create the journey.",
    },
    engineSettings: {
      title: "Journey engine settings",
      description:
        "Shared by every journey of this workspace: on/off, marketing email cap, quiet hours, sender and open tracking.",
      readOnly: "Preview - only an administrator changes the engine settings.",
      notStored:
        "The settings have never been saved - you see the defaults. The engine stays off until the first save.",
      loading: "Loading settings…",
      loadError: "Could not load the engine settings.",
      sectionEngine: "Engine",
      sectionLimits: "Caps and send times",
      sectionSender: "Sender",
      sectionTracking: "Tracking",
      marketingCapUnit_one: "{{count}} email",
      marketingCapUnit_few: "{{count}} emails",
      marketingCapUnit_many: "{{count}} emails",
      marketingCapUnit_other: "{{count}} emails",
      quietInvalid: "Enter a time in the HH:MM format.",
      assigneeNone: "Contact owner (no default person)",
      assigneeUnknown: "Person outside the team list",
      machineOpenHint:
        "An open faster than the threshold after sending counts as automated (such as Apple MPP) and is left out of human opens.",
      machineOpenInvalid: "Enter a number of seconds from 0 to 30.",
      senderNamePlaceholder: "For example Anna Kowalska from New European Strategies",
      senderNameInvalid: "Sender name: 1-120 characters, without < > \" or line breaks.",
      senderNameMissing:
        "Without a sender name emails go out with the site name, and marketing journeys cannot be published.",
      replyToHint: "Contact replies reach this address instead of an unattended mailbox.",
      replyToInvalid: "Enter a valid email address (at most 254 characters).",
      openTracking: "Open tracking (pixel)",
      openTrackingHint:
        "Off: new emails go out without the pixel and opens are not recorded; clicks are still measured. The same setting appears on the “Data retention” card.",
      save: "Save settings",
      saving: "Saving…",
      noChanges: "Nothing to save.",
      saved: "Engine settings saved.",
      conflict:
        "Someone changed the settings in the meantime - we loaded the current values. Please make your changes again.",
      error: "Could not save the settings.",
      confirmEnableTitle: "Switch on the journey engine?",
      confirmEnableBody:
        "Active journeys will start enrolling contacts and sending emails. Cap: {{cap}} per 7 days; quiet hours {{start}}-{{end}} ({{zone}}); sender: {{sender}}.",
      confirmEnable: "Switch on the engine",
      senderFallback: "site name",
    },
    engineStrip: {
      enabled: "On",
      disabled: "Off",
      killSwitch: "Emergency switch",
      never: "not yet",
      settings: "Engine settings",
      preview: "Settings preview",
      loading: "Loading the engine status…",
      loadError: "Could not load the engine status.",
      unavailable: "The journey engine is not deployed in this database yet.",
      notice: {
        kill_switch:
          "The environment emergency switch stopped the engine for every workspace - no journey runs any steps.",
        disabled:
          "The engine is off: no contact enters a journey or receives an email. Switch it on in the engine settings.",
        scheduler_pending:
          "Contacts are due, but no step has run yet - steps will start once the scheduler is connected (I9).",
        stalled:
          "Contacts are due and the last step ran more than a quarter of an hour ago - the engine scheduler may have stopped.",
        errors: "Run errors happened in the last day - check the latest errors below.",
      },
    },
  },
};

// Rejestracja jawna (komponent woła `ensureI18n()`) ORAZ przy imporcie:
// bramki parytetu i dryfu kluczy ładują nakładki globem i liczą na efekt
// importu, a flaga chroni przed powtórnym głębokim scalaniem przy renderze.
let registered = false;
export function ensureI18n(): void {
  if (registered) return;
  registered = true;
  i18n.addResourceBundle("pl", "translation", pl, true, true);
  i18n.addResourceBundle("en", "translation", en, true, true);
}
ensureI18n();

/** Słowniki wprost - testy czytają je bez instancji i18next. */
export const journeysListDictionaries = { pl, en } as const;
