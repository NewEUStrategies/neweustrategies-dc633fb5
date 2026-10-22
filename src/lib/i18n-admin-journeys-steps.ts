// i18n paneli bocznych edytora ścieżki (S8.3c): panel kroku (`stepSheet`)
// z formularzami 14 typów węzłów, edytor treści maila (`emailStep`), wiersz
// warunku (`predicateRow`), wspólne pola arkuszy (`sheetField`: błędy pól,
// pola i wartości warunku zdarzenia), arkusz wyzwalacza (`triggerSheet`)
// i arkusz ustawień ścieżki (`settingsSheet`).
//
// ZERO KOLIZJI. Słownik silnika (`i18n-admin-journeys.ts`) ma `nodeType`,
// `predicate`, `trigger`, `triggerGroup`, `settings`, `variable`… - tu
// wyłącznie NOWE gałęzie. Etykiety wspólne czytamy z ich właścicieli, nie
// kopiujemy: `adminJourneys.common` (licznik, paleta, skutki kroków, problemy),
// `adminJourneys.create` (nazwa, kategoria, wyzwalacz), `adminJourneys.publishDialog`
// (szacunek wejść, polityka wysyłki, nadawca), `adminJourneys.editor` (podgląd
// maila, autozapis), `adminCrm.lifecycle` (etapy CRM i cyklu życia),
// `adminNewsletter.blocks` (bloki maila).
//
// LICZEBNIKI: PL `_one/_few/_many/_other`, EN `_one/_other`; `typeof pl`
// wymaga form polskich także w EN (angielski czyta tylko `_one`/`_other`).
//
// UWAGA NA ARKUSZ CSS. Pliki `src/lib/i18n-*.ts` skanuje generator arkusza
// PUBLICZNEGO - angielskie słowo równe klasie narzędziowej Tailwinda dokłada
// regułę do CSS każdej strony czytelnika (limit `publicCss` zamrożony).
// Dlatego np. „filter” to po angielsku „entry rules”, a nie „entry filter”
// (sprawdzone skanerem kandydatów Tailwinda na tym pliku).
//
// ZMIENNE MAILA. Nawiasy klamrowe zmiennych (`{{first_name}}`) są składnią
// interpolacji i18next - zdania o zmiennych ich NIE zawierają, a sam znacznik
// składa komponent.
//
// IMPORT WYŁĄCZNIE Z KOMPONENTÓW (`ensureI18n()`), nie z pliku trasy.
import i18n from "@/lib/i18n";

const pl = {
  adminJourneys: {
    stepSheet: {
      title: "Krok {{number}}: {{type}}",
      missingTitle: "Krok nie istnieje",
      missing: "Tego kroku nie ma już w szkicu - mógł zostać usunięty albo cofnięty.",
      tabs: {
        label: "Sekcje panelu kroku",
        settings: "Ustawienia",
        results: "Wyniki",
        contacts: "Kontakty",
      },
      history: "Zmiana ustawień kroku {{number}}",
      readOnly:
        "Tylko do odczytu - szkic jest zablokowany (konflikt z inną kartą, podgląd wersji albo archiwum).",
      roleReadOnly: "Twoja rola pozwala tylko oglądać ustawienia.",
      triggerEffect: "Kontakt wchodzi na ścieżkę, gdy w serwisie wydarzy się wybrane zdarzenie.",
      issues: "Problemy tego kroku",
      paramsInvalid:
        "Zapisane ustawienia tego kroku nie pasują do obecnego schematu, więc formularz ich nie pokazuje. Przywróć ustawienia domyślne i ustaw krok od nowa.",
      repair: "Przywróć ustawienia domyślne",
      openTrigger: "Zmień wyzwalacz i filtr wejścia",
      wait: {
        mode: "Rodzaj czekania",
        modeHint:
          "Czekanie na zdarzenie ma dwie gałęzie - zamienisz je na inny rodzaj tylko przez usunięcie kroku i wstawienie nowego.",
        duration: "Czas czekania",
        time: "Godzina",
        timeZone: "Strefa czasowa z ustawień silnika: {{timezone}}.",
        timeZoneUnknown: "Strefa czasowa z ustawień silnika.",
        weekdays: "Dni tygodnia",
        event: "Zdarzenie",
        eventHint: "Gdy nastąpi, kontakt idzie gałęzią „Zdarzenie”.",
        timeout: "Najdłużej czekaj",
        timeoutHint: "Po tym czasie kontakt idzie gałęzią „Minął termin” (najwyżej 30 dni).",
        unit: "Jednostka - {{field}}",
      },
      weekday: {
        1: "Poniedziałek",
        2: "Wtorek",
        3: "Środa",
        4: "Czwartek",
        5: "Piątek",
        6: "Sobota",
        7: "Niedziela",
      },
      unit: {
        minutes: "minuty",
        hours: "godziny",
        days: "dni",
      },
      ab: {
        weightsHint:
          "Udział kontaktów w wariantach - razem zawsze 100 %, więc zmiana jednego wariantu ustawia drugi.",
        weightA: "Wariant A (%)",
        weightB: "Wariant B (%)",
        metric: "Zwycięzca według",
        metricHint:
          "Kliknięcia są pewniejsze niż otwarcia (Apple MPP zawyża otwarcia); cel wymaga celu ścieżki.",
        metricClick: "Kliknięć",
        metricGoal: "Osiągniętego celu",
        goalMissing:
          "Ścieżka nie ma celu - ustaw go w ustawieniach ścieżki albo oceniaj po kliknięciach.",
      },
      ifElse: {
        match: "Spełnione mają być",
        all: "Wszystkie warunki",
        any: "Dowolny warunek",
        predicates: "Warunki",
        predicatesHint:
          "Kontakt idzie gałęzią „Tak”, gdy warunki są spełnione, inaczej gałęzią „Nie”.",
      },
      lifecycle: {
        stage: "Etap cyklu życia",
      },
      crmStage: {
        stage: "Etap sprzedaży",
        onlyForward: "Tylko do przodu",
        onlyForwardHint: "Kontakt na dalszym etapie zostaje tam, gdzie jest.",
      },
      staff: {
        loading: "Wczytuję zespół…",
        error: "Nie udało się wczytać zespołu - spróbuj ponownie za chwilę.",
        pick: "Wybierz osobę…",
        outside: "Osoba spoza obecnego zespołu",
      },
      task: {
        title: "Tytuł zadania",
        description: "Opis zadania (opcjonalnie)",
        dueInDays: "Termin (dni od wejścia na krok)",
        dueInDaysHint: "0 = na dziś, najwyżej 60 dni.",
        assignee: "Komu przypisać",
        assigneeOwner: "Opiekunowi kontaktu (albo domyślnej osobie z ustawień)",
        assigneeUser: "Wybranej osobie z zespołu",
        user: "Osoba",
      },
      tag: {
        label: "Tag",
        hint: "Ten sam tag co w karcie kontaktu w CRM.",
      },
      newsletter: {
        op: "Działanie",
        add: "Dodaj do listy",
        remove: "Usuń z listy",
        listKey: "Klucz listy",
        listKeyHint:
          "Dodanie nie tworzy subskrypcji bez zgody - dotyczy tylko istniejących subskrybentów.",
      },
      notify: {
        recipients: "Kogo powiadomić",
        owner: "Opiekuna kontaktu",
        admins: "Administratorów",
        users: "Wybrane osoby z zespołu",
        people: "Osoby",
        message: "Treść powiadomienia",
      },
      goal: {
        label: "Nazwa celu (opcjonalnie)",
        hint: "Widoczna w wynikach i na kanwie, np. „Zakup planu”.",
      },
    },
    emailStep: {
      title: "Treść maila",
      variants: "Warianty treści",
      variantsHint:
        "Ramię B testu A/B wysyła wariant B; dopóki wariant B nie ma zapisanej treści, wysyłka bierze wariant A.",
      variantUnused:
        "Ten krok nie stoi już za testem A/B - wariant B zostaje zapisany, ale nikt go nie dostanie.",
      variantFallback:
        "Wariant B nie ma jeszcze treści - zaczynasz od kopii wariantu A. Do pierwszego zapisu ramię B dostaje wariant A.",
      docInvalid:
        "Zapisany dokument maila jest uszkodzony - edytor zaczyna od pustej treści, a zapis nadpisze uszkodzony dokument.",
      subjectPl: "Temat (polski)",
      subjectEn: "Temat (angielski)",
      subjectEnHint: "Bez tematu po angielsku kontakty anglojęzyczne dostaną wersję polską.",
      preheaderPl: "Preheader (polski)",
      preheaderEn: "Preheader (angielski)",
      preheaderHint: "Krótki tekst, który skrzynka pokazuje obok tematu.",
      content: "Treść",
      addBlock: "Dodaj blok",
      addBlockType: "+ {{type}}",
      blocks: "Bloki treści",
      blockItem: "{{position}}. {{label}}",
      moveUp: "Wyżej",
      moveDown: "Niżej",
      variablesTitle: "Zmienne w treści",
      variablesHint:
        "Wpisz zmienną w podwójnych nawiasach klamrowych, jak w liście niżej. Zmienne adresów działają w linkach przycisków i obrazów, dane kontaktu - w tekście.",
      previewLang: "Język odbiorcy w podglądzie",
      lang: {
        pl: "Polski",
        en: "Angielski",
      },
      previewSubject: "Temat:",
      previewPreheader: "Preheader:",
      saving: "Zapisuję treść…",
      saved: "Treść zapisana",
      dirty: "Niezapisane zmiany - zapis za chwilę",
      failed: "Nie zapisano treści maila.",
      invalid: "Nie zapisano - popraw pola oznaczone błędem.",
      nodeNotSaved:
        "Nie zapisano treści - najpierw musi zapisać się szkic z tym krokiem (sprawdź komunikat autozapisu nad kanwą).",
      saveNow: "Zapisz teraz",
    },
    predicateRow: {
      legend: "Warunek {{number}}",
      kind: "Rodzaj warunku",
      remove: "Usuń warunek {{number}}",
      noEmails: "Warunki otwarcia i kliknięcia wymagają maila wysłanego wcześniej na tej drodze.",
      incomplete: "Uzupełnij warunek.",
      empty: "Brak warunków.",
      pending: "Niekompletne warunki nie trafią do szkicu, dopóki ich nie uzupełnisz.",
      add: "Dodaj warunek",
      max: "Limit: {{max}} warunków",
      emailOption: "Krok {{number}}: „{{subject}}”",
      emailOptionNoSubject: "Krok {{number}}: e-mail bez tematu",
      email: "E-mail",
      emailPick: "Wybierz e-mail…",
      emailUnknown: "Krok spoza tej drogi ({{id}})",
      withinHours: "W ciągu (godziny, opcjonalnie)",
      withinHoursHint: "Puste = kiedykolwiek od wysłania; najwyżej rok (8760 godzin).",
      excludeMachine: "Pomiń otwarcia maszynowe",
      excludeMachineHint:
        "Odrzuca otwarcia szybsze niż próg z ustawień silnika (np. Apple MPP) - wynik to nadal górna granica otwarć ludzkich.",
      urlContains: "Adres linku zawiera (opcjonalnie)",
      urlContainsHint: "Puste = kliknięcie dowolnego linku.",
      planOp: "Plan kontaktu",
      plan: {
        has_paid: "Ma płatny plan",
        none: "Nie ma planu",
        tier_at_least: "Ma co najmniej jedną z warstw",
        tier_in: "Ma jedną z warstw",
      },
      tierKeys: "Klucze warstw",
      tierKeysHint: "Rozdziel przecinkami, np. pro, team (do 20).",
      subscriptionStatuses: "Status subskrypcji",
      crmStages: "Etap sprzedaży",
      lifecycleStages: "Etap cyklu życia",
      scoreBands: "Pasmo oceny leada",
      scoreBand: {
        hot: "Gorący",
        warm: "Ciepły",
        cool: "Chłodny",
        cold: "Zimny",
      },
      consentHint:
        "Kontakt ma zgodę marketingową (w CRM albo przez potwierdzoną subskrypcję newslettera).",
      newsletterStatuses: "Statusy subskrypcji newslettera",
      newsletterStatusesHint: "Rozdziel przecinkami, np. confirmed, subscribed (do 10).",
      tag: "Tag",
      eventType: "Zdarzenie",
      eventSinceHint: "Czy kontakt wykonał to zdarzenie od wejścia na ścieżkę.",
      clubId: "Klub - identyfikator (opcjonalnie)",
      clubIdHint: "Puste = członek dowolnego klubu.",
      eventId: "Wydarzenie - identyfikator (opcjonalnie)",
      eventIdHint: "Puste = zapis na dowolne wydarzenie.",
      field: "Pole zdarzenia wejścia",
      fieldHint: "Klucz z ładunku zdarzenia, które zapisało kontakt na ścieżkę.",
      fieldOutside:
        "Tego pola nie ma w zdarzeniu obecnego wyzwalacza - warunek nigdy nie będzie spełniony.",
      fieldPick: "Wybierz pole…",
      fieldOp: "Porównanie",
      opIn: "jest jedną z wartości",
      opNotIn: "nie jest żadną z wartości",
      fieldValues: "Wartości",
      fieldValuesHint: "Rozdziel przecinkami (do 20).",
    },
    sheetField: {
      any: "Dowolna wartość",
      yes: "Tak",
      no: "Nie",
      conditionNone: "To zdarzenie nie ma pól warunku - liczy się każde zdarzenie tego typu.",
      error: {
        required: "Pole wymagane.",
        tooLong: "Najwyżej {{max}} znaków - skróć tekst (niczego nie ucinamy za Ciebie).",
        pattern: "Niedozwolony format.",
        range: "Wpisz liczbę całkowitą od {{min}} do {{max}}.",
        listCount: "Podaj od {{min}} do {{max}} pozycji.",
        listItem: "Każda pozycja może mieć najwyżej {{max}} znaków.",
        pickOne: "Wybierz co najmniej jedną pozycję.",
        condition: "Wartości pola „{{field}}” nie ma w katalogu tego zdarzenia.",
        time: "Podaj godzinę w formacie GG:MM.",
        durationRange: "Czas musi mieścić się między {{min}} a {{max}}.",
        uuid: "Wklej identyfikator w formacie UUID.",
        listKey: "Klucz listy: 1-64 znaki - litery, cyfry, „_” i „-”.",
      },
      condition: {
        signup_source: "Źródło rejestracji",
        marketing_opt_in: "Zgoda marketingowa przy rejestracji",
        language: "Język",
        source: "Źródło",
        reason: "Powód",
        entity_type: "Rodzaj treści",
        required_tier_key: "Wymagana warstwa (klucz)",
        kind: "Rodzaj zamówienia",
        tier_key: "Warstwa (klucz)",
        has_coupon: "Z kodem rabatowym",
        new_status: "Nowy status subskrypcji",
        old_status: "Poprzedni status subskrypcji",
        paused: "Wstrzymana",
        cancel_at_period_end: "Anulowana na koniec okresu",
        outcome: "Wynik",
        reason_key: "Powód rezygnacji (klucz)",
        offer_accepted: "Oferta przyjęta",
        status: "Status",
        event_id: "Wydarzenie (identyfikator)",
        by: "Kto anulował",
        club_id: "Klub (identyfikator)",
        specialization: "Specjalizacja",
        stage: "Etap sprzedaży",
        new_stage: "Nowy etap sprzedaży",
        old_stage: "Poprzedni etap sprzedaży",
        to: "Nowy etap cyklu życia",
        from: "Poprzedni etap cyklu życia",
        form_kind: "Rodzaj formularza",
        form_id: "Formularz (identyfikator)",
      },
      value: {
        subscription: {
          trialing: "Okres próbny",
          active: "Aktywna",
          past_due: "Zaległa płatność",
          canceled: "Anulowana",
          unpaid: "Nieopłacona",
          incomplete: "Niedokończona",
        },
        signupSource: {
          auth_page: "Strona logowania",
          login_popup: "Okienko logowania",
          popup: "Okienko zapisu",
          club_gate: "Bramka klubu",
          register_widget: "Formularz w treści",
          paywall: "Paywall",
          pricing: "Cennik",
          checkout: "Kasa",
          club_apply: "Zgłoszenie do klubu",
          join_us_form: "Formularz „Dołącz”",
          unknown: "Nieznane źródło",
        },
        paywallReason: {
          members: "Tylko dla zalogowanych",
          paid: "Treść płatna",
          tier_rank: "Wymaga wyższej warstwy",
          password: "Chronione hasłem",
          quota: "Wyczerpany limit darmowych artykułów",
          registration: "Ściana rejestracji",
        },
        language: {
          pl: "Polski",
          en: "Angielski",
        },
        checkoutKind: {
          subscription: "Subskrypcja",
          one_time: "Zakup jednorazowy",
        },
        formKind: {
          pricing: "Zapytanie z cennika",
          newsletter: "Zapis na newsletter",
          join_us: "Formularz „Dołącz”",
          contact: "Formularz kontaktowy",
        },
        entityType: {
          post: "Artykuł",
          page: "Strona",
          media: "Plik multimedialny",
          club: "Klub",
          event: "Wydarzenie",
        },
        retentionOutcome: {
          started: "Rozpoczęta",
          saved: "Zatrzymana",
          canceled: "Anulowana",
          abandoned: "Przerwana",
        },
        cancelledBy: {
          participant: "Uczestnik",
          event_cancelled: "Odwołanie wydarzenia",
        },
        expiredReason: {
          canceled: "Anulowanie",
          unpaid: "Brak płatności",
          ended: "Koniec okresu",
          paused: "Wstrzymanie",
        },
        applicationStatus: {
          accepted: "Przyjęte",
          rejected: "Odrzucone",
        },
        registrationStatus: {
          pending: "Oczekuje na akceptację",
          approved: "Zaakceptowana",
        },
      },
    },
    triggerSheet: {
      title: "Wyzwalacz i filtr wejścia",
      description: "Kto i kiedy wchodzi na ścieżkę.",
      chooseIntro:
        "Szkic nie ma jeszcze wyzwalacza - wybierz zdarzenie, które zapisze kontakt na ścieżkę. Wybór od razu zapisze szkic.",
      choose: "Wybierz wyzwalacz",
      choosing: "Zapisuję…",
      emailBlockedHint:
        "Ścieżka ma krok maila, więc zdarzenie windykacji jest niedostępne - przypomnienia o płatności wysyła moduł windykacji.",
      condition: "Warunek zdarzenia",
      conditionHint: "Puste pola = każde zdarzenie tego typu.",
      entryFilter: "Filtr wejścia",
      entryFilterHint:
        "Kontakt wejdzie tylko wtedy, gdy w chwili zdarzenia spełnia wszystkie warunki.",
      staleFields_one:
        "{{count}} warunek pola zdarzenia wskazuje pole, którego nie ma w nowym wyzwalaczu - popraw go albo usuń.",
      staleFields_few:
        "{{count}} warunki pola zdarzenia wskazują pola, których nie ma w nowym wyzwalaczu - popraw je albo usuń.",
      staleFields_many:
        "{{count}} warunków pola zdarzenia wskazuje pola, których nie ma w nowym wyzwalaczu - popraw je albo usuń.",
      staleFields_other:
        "{{count}} warunku pola zdarzenia wskazuje pola, których nie ma w nowym wyzwalaczu - popraw je albo usuń.",
      history: {
        trigger: "Zmiana wyzwalacza",
        condition: "Zmiana warunku wyzwalacza",
        entryFilter: "Zmiana filtra wejścia",
      },
    },
    settingsSheet: {
      title: "Ustawienia ścieżki",
      description:
        "Nazwa, kategoria, ponowne wejście, cel i wyjścia. Zmiany zapisuje autozapis razem ze szkicem.",
      general: "Ogólne",
      consent: "Kategoria i podstawa prawna",
      legalBasisOptional: "Opcjonalnie przy marketingu, wymagana przy komunikacji usługowej.",
      reentry: "Ponowne wejście",
      reentryHint: "Co się dzieje, gdy ten sam kontakt znów wywoła wyzwalacz.",
      reentryPolicy: "Zasada wejścia",
      cooldownDays: "Karencja (dni)",
      cooldownHint: "Od 1 do 730 dni od poprzedniego wejścia.",
      goal: "Cel",
      goalHint: "Zdarzenie, które kończy ścieżkę z osiągniętym celem - liczy się do wyników.",
      goalEvent: "Zdarzenie celu",
      goalNone: "Bez celu",
      exits: "Zdarzenia wyjścia",
      exitsHint: "Każde zdarzenie z tej listy kończy ścieżkę kontaktu bez celu.",
      exitEvent: "Wyjście {{number}}",
      exitRemove: "Usuń wyjście {{number}}",
      exitAdd: "Dodaj wyjście",
      exitsMax: "Limit: {{max}} wyjść",
      policy: "Okno wysyłki i nadawca",
      policyHint:
        "Limit maili, ciszę nocną, strefę i nazwę nadawcy zmienia administrator w „Ustawieniach ścieżek” nad listą ścieżek.",
      policyLoading: "Wczytuję ustawienia silnika…",
      history: {
        name: "Zmiana nazwy ścieżki",
        description: "Zmiana opisu ścieżki",
        category: "Zmiana kategorii",
        legalBasis: "Zmiana podstawy prawnej",
        reentry: "Zmiana ponownego wejścia",
        goal: "Zmiana celu",
        exits: "Zmiana zdarzeń wyjścia",
      },
    },
  },
};

const en: typeof pl = {
  adminJourneys: {
    stepSheet: {
      title: "Step {{number}}: {{type}}",
      missingTitle: "Step not found",
      missing: "This step is no longer in the draft - it may have been removed or undone.",
      tabs: {
        label: "Step panel sections",
        settings: "Settings",
        results: "Results",
        contacts: "Contacts",
      },
      history: "Step {{number}} settings changed",
      readOnly:
        "Read-only - the draft is locked (conflict with another tab, version preview or archive).",
      roleReadOnly: "Your role lets you view the settings only.",
      triggerEffect: "A contact enters the journey when the chosen event happens on the site.",
      issues: "Problems with this step",
      paramsInvalid:
        "The saved settings of this step do not match the current schema, so the form does not show them. Restore the default settings and set up the step again.",
      repair: "Restore default settings",
      openTrigger: "Change the trigger and entry rules",
      wait: {
        mode: "Kind of wait",
        modeHint:
          "Waiting for an event has two branches - you can switch it to another kind only by removing the step and inserting a new one.",
        duration: "Wait time",
        time: "Time of day",
        timeZone: "Time zone from the engine settings: {{timezone}}.",
        timeZoneUnknown: "Time zone from the engine settings.",
        weekdays: "Days of the week",
        event: "Event",
        eventHint: "When it happens, the contact takes the “Event” branch.",
        timeout: "Wait at most",
        timeoutHint: "After this time the contact takes the “Timed out” branch (at most 30 days).",
        unit: "Unit - {{field}}",
      },
      weekday: {
        1: "Monday",
        2: "Tuesday",
        3: "Wednesday",
        4: "Thursday",
        5: "Friday",
        6: "Saturday",
        7: "Sunday",
      },
      unit: {
        minutes: "minutes",
        hours: "hours",
        days: "days",
      },
      ab: {
        weightsHint:
          "Share of contacts per variant - always 100 % together, so changing one variant sets the other.",
        weightA: "Variant A (%)",
        weightB: "Variant B (%)",
        metric: "Winner by",
        metricHint:
          "Clicks are more reliable than opens (Apple MPP inflates opens); the goal option needs a journey goal.",
        metricClick: "Clicks",
        metricGoal: "Goal reached",
        goalMissing: "The journey has no goal - set it in the journey settings or judge by clicks.",
      },
      ifElse: {
        match: "Must be met",
        all: "All conditions",
        any: "Any condition",
        predicates: "Conditions",
        predicatesHint:
          "The contact takes the “Yes” branch when the conditions are met, otherwise the “No” branch.",
      },
      lifecycle: {
        stage: "Lifecycle stage",
      },
      crmStage: {
        stage: "Sales stage",
        onlyForward: "Forward only",
        onlyForwardHint: "A contact at a later stage stays where it is.",
      },
      staff: {
        loading: "Loading the team…",
        error: "Could not load the team - try again in a moment.",
        pick: "Choose a person…",
        outside: "Person outside the current team",
      },
      task: {
        title: "Task title",
        description: "Task description (optional)",
        dueInDays: "Due (days after reaching the step)",
        dueInDaysHint: "0 = today, at most 60 days.",
        assignee: "Assign to",
        assigneeOwner: "Contact owner (or the default person from settings)",
        assigneeUser: "A chosen team member",
        user: "Person",
      },
      tag: {
        label: "Tag",
        hint: "The same tag as on the contact card in the CRM.",
      },
      newsletter: {
        op: "Action",
        add: "Add to the list",
        remove: "Remove from the list",
        listKey: "List key",
        listKeyHint:
          "Adding never creates a subscription without consent - it applies to existing subscribers only.",
      },
      notify: {
        recipients: "Who to notify",
        owner: "Contact owner",
        admins: "Administrators",
        users: "Chosen team members",
        people: "People",
        message: "Notification text",
      },
      goal: {
        label: "Goal name (optional)",
        hint: "Shown in results and on the canvas, e.g. “Plan purchase”.",
      },
    },
    emailStep: {
      title: "Email content",
      variants: "Content variants",
      variantsHint:
        "Arm B of the A/B test sends variant B; until variant B has saved content, sending uses variant A.",
      variantUnused:
        "This step no longer follows an A/B test - variant B stays saved, but nobody receives it.",
      variantFallback:
        "Variant B has no content yet - you start from a copy of variant A. Until the first save, arm B receives variant A.",
      docInvalid:
        "The saved email document is damaged - the editor starts with empty content and saving replaces the damaged document.",
      subjectPl: "Subject (Polish)",
      subjectEn: "Subject (English)",
      subjectEnHint:
        "Without an English subject, English-speaking contacts receive the Polish version.",
      preheaderPl: "Preheader (Polish)",
      preheaderEn: "Preheader (English)",
      preheaderHint: "Short text the inbox shows next to the subject.",
      content: "Content",
      addBlock: "Add a section",
      addBlockType: "+ {{type}}",
      blocks: "Content sections",
      blockItem: "{{position}}. {{label}}",
      moveUp: "Up",
      moveDown: "Down",
      variablesTitle: "Variables in the content",
      variablesHint:
        "Type a variable in double curly braces, as in the list below. Address variables work in button and image links, contact data in the text.",
      previewLang: "Recipient language in the preview",
      lang: {
        pl: "Polish",
        en: "English",
      },
      previewSubject: "Subject:",
      previewPreheader: "Preheader text:",
      saving: "Saving content…",
      saved: "Content saved",
      dirty: "Unsaved changes - saving in a moment",
      failed: "The email content was not saved.",
      invalid: "Not saved - correct the fields marked with an error.",
      nodeNotSaved:
        "Content not saved - the draft with this step must be saved first (check the autosave message above the canvas).",
      saveNow: "Save now",
    },
    predicateRow: {
      legend: "Condition {{number}}",
      kind: "Kind of condition",
      remove: "Remove condition {{number}}",
      noEmails: "Open and click conditions need an email sent earlier on this path.",
      incomplete: "Complete the condition.",
      empty: "No conditions.",
      pending: "Incomplete conditions are not added to the draft until you complete them.",
      add: "Add a condition",
      max: "Limit: {{max}} conditions",
      emailOption: "Step {{number}}: “{{subject}}”",
      emailOptionNoSubject: "Step {{number}}: email without a subject",
      email: "Email",
      emailPick: "Choose an email…",
      emailUnknown: "Step outside this path ({{id}})",
      withinHours: "Within (hours, optional)",
      withinHoursHint: "Empty = any time after sending; at most a year (8760 hours).",
      excludeMachine: "Skip machine opens",
      excludeMachineHint:
        "Drops opens faster than the threshold from the engine settings (e.g. Apple MPP) - the result is still an upper bound of human opens.",
      urlContains: "Link address contains (optional)",
      urlContainsHint: "Empty = a click on any link.",
      planOp: "Contact plan",
      plan: {
        has_paid: "Has a paid plan",
        none: "Has no plan",
        tier_at_least: "Has at least one of the tiers",
        tier_in: "Has one of the tiers",
      },
      tierKeys: "Tier keys",
      tierKeysHint: "Separate with commas, e.g. pro, team (up to 20).",
      subscriptionStatuses: "Subscription status",
      crmStages: "Sales stage",
      lifecycleStages: "Lifecycle stage",
      scoreBands: "Lead score band",
      scoreBand: {
        hot: "Hot",
        warm: "Warm",
        cool: "Cool",
        cold: "Cold",
      },
      consentHint:
        "The contact has marketing consent (in the CRM or through a confirmed newsletter subscription).",
      newsletterStatuses: "Newsletter subscription statuses",
      newsletterStatusesHint: "Separate with commas, e.g. confirmed, subscribed (up to 10).",
      tag: "Tag",
      eventType: "Event",
      eventSinceHint: "Whether the contact performed this event since entering the journey.",
      clubId: "Club - identifier (optional)",
      clubIdHint: "Empty = a member of any club.",
      eventId: "Event - identifier (optional)",
      eventIdHint: "Empty = registered for any event.",
      field: "Entry event field",
      fieldHint: "A key from the payload of the event that enrolled the contact.",
      fieldOutside:
        "The current trigger event has no such field - the condition will never be met.",
      fieldPick: "Choose a field…",
      fieldOp: "Comparison",
      opIn: "is one of the values",
      opNotIn: "is none of the values",
      fieldValues: "Values",
      fieldValuesHint: "Separate with commas (up to 20).",
    },
    sheetField: {
      any: "Any value",
      yes: "Yes",
      no: "No",
      conditionNone: "This event has no condition fields - every event of this type counts.",
      error: {
        required: "This field is required.",
        tooLong: "At most {{max}} characters - shorten the text (we never cut it for you).",
        pattern: "Format not allowed.",
        range: "Enter a whole number from {{min}} to {{max}}.",
        listCount: "Give from {{min}} to {{max}} items.",
        listItem: "Each item may have at most {{max}} characters.",
        pickOne: "Choose at least one item.",
        condition: "The value of “{{field}}” is not in the catalogue of this event.",
        time: "Enter a time as HH:MM.",
        durationRange: "The time must be between {{min}} and {{max}}.",
        uuid: "Paste an identifier in the UUID format.",
        listKey: "List key: 1-64 characters - letters, digits, “_” and “-”.",
      },
      condition: {
        signup_source: "Signup source",
        marketing_opt_in: "Marketing consent at signup",
        language: "Language",
        source: "Source",
        reason: "Reason",
        entity_type: "Kind of content",
        required_tier_key: "Required tier (key)",
        kind: "Kind of order",
        tier_key: "Tier (key)",
        has_coupon: "With a discount code",
        new_status: "New subscription status",
        old_status: "Previous subscription status",
        paused: "Paused",
        cancel_at_period_end: "Cancelled at period end",
        outcome: "Outcome",
        reason_key: "Cancellation reason (key)",
        offer_accepted: "Offer accepted",
        status: "Status",
        event_id: "Event (identifier)",
        by: "Cancelled by",
        club_id: "Club (identifier)",
        specialization: "Specialisation",
        stage: "Sales stage",
        new_stage: "New sales stage",
        old_stage: "Previous sales stage",
        to: "New lifecycle stage",
        from: "Previous lifecycle stage",
        form_kind: "Form type",
        form_id: "Form (identifier)",
      },
      value: {
        subscription: {
          trialing: "Trial",
          active: "Active",
          past_due: "Payment overdue",
          canceled: "Cancelled",
          unpaid: "Unpaid",
          incomplete: "Incomplete",
        },
        signupSource: {
          auth_page: "Sign-in page",
          login_popup: "Sign-in popup",
          popup: "Signup popup",
          club_gate: "Club gate",
          register_widget: "In-content form",
          paywall: "Paywall page",
          pricing: "Pricing page",
          checkout: "Checkout page",
          club_apply: "Club application",
          join_us_form: "“Join us” form",
          unknown: "Unknown source",
        },
        paywallReason: {
          members: "Members only",
          paid: "Paid content",
          tier_rank: "Requires a higher tier",
          password: "Password protected",
          quota: "Free article limit used up",
          registration: "Registration wall",
        },
        language: {
          pl: "Polish",
          en: "English",
        },
        checkoutKind: {
          subscription: "Subscription",
          one_time: "One-off purchase",
        },
        formKind: {
          pricing: "Pricing enquiry",
          newsletter: "Newsletter sign-up",
          join_us: "“Join us” form",
          contact: "Contact form",
        },
        entityType: {
          post: "Article",
          page: "Page",
          media: "Media file",
          club: "Club",
          event: "Event",
        },
        retentionOutcome: {
          started: "Started",
          saved: "Kept",
          canceled: "Cancelled",
          abandoned: "Abandoned",
        },
        cancelledBy: {
          participant: "Participant",
          event_cancelled: "Event called off",
        },
        expiredReason: {
          canceled: "Cancellation",
          unpaid: "No payment",
          ended: "End of period",
          paused: "Pause",
        },
        applicationStatus: {
          accepted: "Accepted",
          rejected: "Rejected",
        },
        registrationStatus: {
          pending: "Awaiting approval",
          approved: "Approved",
        },
      },
    },
    triggerSheet: {
      title: "Trigger and entry rules",
      description: "Who enters the journey and when.",
      chooseIntro:
        "The draft has no trigger yet - choose the event that enrols a contact. Choosing saves the draft right away.",
      choose: "Choose trigger",
      choosing: "Saving…",
      emailBlockedHint:
        "The journey has an email step, so the dunning event is unavailable - payment reminders are sent by the dunning module.",
      condition: "Event condition",
      conditionHint: "Empty fields = every event of this type.",
      entryFilter: "Entry rules",
      entryFilterHint:
        "A contact enters only when it meets all conditions at the time of the event.",
      staleFields_one:
        "{{count}} event field condition points to a field the new trigger does not have - correct it or remove it.",
      staleFields_few:
        "{{count}} event field conditions point to fields the new trigger does not have - correct or remove them.",
      staleFields_many:
        "{{count}} event field conditions point to fields the new trigger does not have - correct or remove them.",
      staleFields_other:
        "{{count}} event field conditions point to fields the new trigger does not have - correct or remove them.",
      history: {
        trigger: "Trigger changed",
        condition: "Trigger condition changed",
        entryFilter: "Entry rules changed",
      },
    },
    settingsSheet: {
      title: "Journey settings",
      description:
        "Name, category, re-entry, goal and exits. Autosave stores the changes together with the draft.",
      general: "General",
      consent: "Category and legal basis",
      legalBasisOptional: "Optional for marketing, required for service communication.",
      reentry: "Re-entry",
      reentryHint: "What happens when the same contact fires the trigger again.",
      reentryPolicy: "Entry rule",
      cooldownDays: "Cooldown (days)",
      cooldownHint: "From 1 to 730 days after the previous entry.",
      goal: "Goal",
      goalHint: "The event that ends the journey with the goal reached - it counts in the results.",
      goalEvent: "Goal event",
      goalNone: "No goal",
      exits: "Exit events",
      exitsHint: "Each event on this list ends the contact's journey without the goal.",
      exitEvent: "Exit {{number}}",
      exitRemove: "Remove exit {{number}}",
      exitAdd: "Add an exit",
      exitsMax: "Limit: {{max}} exits",
      policy: "Sending window and sender",
      policyHint:
        "An administrator changes the email limit, quiet hours, time zone and sender name in “Journey settings” above the journey list.",
      policyLoading: "Loading the engine settings…",
      history: {
        name: "Journey name changed",
        description: "Journey description changed",
        category: "Category changed",
        legalBasis: "Legal basis changed",
        reentry: "Re-entry changed",
        goal: "Goal changed",
        exits: "Exit events changed",
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
export const journeysStepsDictionaries = { pl, en } as const;
