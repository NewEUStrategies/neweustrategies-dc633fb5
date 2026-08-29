// Słownik podmodułu UCZESTNICY I ZAPISY (Event Builder), PL/EN.
//
// DLACZEGO OSOBNY PLIK, A NIE ROZSZERZENIE `i18n-admin-events`. Nakładki i18n są
// NIEPODZIELNE: ekran, który chce załadować tylko część słownika, nie ma jak tego
// zrobić. `i18n-admin-events` obsługuje listę wydarzeń i katalog rodzajów -
// dwa ekrany, kilkadziesiąt kluczy. Zapisy to pięć ekranów panelu (zgłoszenia,
// formularz, bilety, grupy, zgody) plus formularz publiczny na froncie
// wydarzenia, i to jest osobny chunk trasy.
//
// KLUCZE STANÓW SĄ WSPÓLNE Z BAZĄ. Każda wartość każdego CHECK-a z migracji
// `20260823150000_event_people_registration.sql` ma tu dokładnie jedną etykietę:
// osiem statusów zapisu, cztery podstawy decyzji, siedem źródeł pozyskania,
// dziesięć typów pola, dziesięć operatorów reguły, trzy skutki reguły, cztery
// zasięgi widoczności grupy, trzy miejsca wyświetlania zgody, dwie waluty, pięć
// stanów sprzedaży biletu i sześć powodów zamknięcia zapisów. Jeśli baza zna
// sześć wartości, słownik zna sześć etykiet - inaczej interfejs pokazuje surowy
// klucz z SQL-a i użytkownik czyta `no_show`.
//
// KOMUNIKAT BŁĘDU MÓWI, CO ZROBIĆ. RPC podnoszą wyjątki z kluczem maszynowym
// (`no_seats_left`, `terms_required`, `quota_below_sold`); tutaj każdy z nich
// dostaje zdanie, które mówi organizatorowi albo uczestnikowi, jaka jest
// następna czynność. "Brak wolnych miejsc" bez zdania o liście rezerwowej
// zmusza do zgadywania, a zgadywanie kończy się drugim wydarzeniem o tej samej
// nazwie.
import i18n from "@/lib/i18n";

export const adminEventRegistrationPl = {
  adminEventRegistration: {
    nav: {
      sectionTitle: "Zapisy",
      sectionsNavLabel: "Sekcje zapisów wydarzenia",
      registrations: "Zgłoszenia",
      form: "Formularz",
      tickets: "Bilety",
      groups: "Grupy",
      terms: "Zgody",
      waitlist: "Lista rezerwowa",
    },

    // Osiem stanów cyklu życia zapisu (event_registrations.status).
    statuses: {
      draft: "Szkic",
      pending: "Oczekuje na decyzję",
      approved: "Zatwierdzony",
      rejected: "Odrzucony",
      waitlist: "Lista rezerwowa",
      cancelled: "Anulowany",
      attended: "Obecny",
      no_show: "Nieobecny",
    },
    statusHints: {
      draft: "Formularz rozpoczęty i niewysłany. Miejsca nie zajmuje.",
      pending: "Zgłoszenie czeka na decyzję organizatora. Miejsca nie zajmuje.",
      approved: "Miejsce zajęte, kod wejściowy wydany.",
      rejected: "Zgłoszenie odrzucone. Osoba może złożyć nowe.",
      waitlist: "W kolejce na zwolnione miejsce, z pozycją w kolejce.",
      cancelled: "Wycofane przez uczestnika albo organizatora. Miejsce wróciło do puli.",
      attended: "Obecność potwierdzona na miejscu.",
      no_show: "Zapisał się i nie przyszedł. Miejsce pozostaje policzone jako zajęte.",
    },

    // event_registrations.registration_mode - tryb utrwalony w chwili zapisu.
    registrationModes: {
      rsvp: "Zapis jednym kliknięciem",
      form: "Formularz zgłoszenia",
    },

    // event_registrations.decision_source - na jakiej podstawie zapadła decyzja.
    decisionSources: {
      organizer: "Decyzja organizatora",
      automatic_rule: "Reguła kwalifikująca",
      capacity: "Brak wolnych miejsc",
      system: "Automat systemu",
    },

    // event_people.source oraz event_registrations.source.
    sources: {
      self_registration: "Zapis własny",
      invitation: "Zaproszenie",
      organizer: "Wpis organizatora",
      import: "Import pliku",
      crm: "Baza CRM",
      partner: "Partner",
      scan: "Skan na miejscu",
    },

    // event_registration_fields.field_type.
    fieldTypes: {
      text: "Tekst krótki",
      textarea: "Tekst długi",
      select: "Lista jednokrotna",
      multiselect: "Lista wielokrotna",
      checkbox: "Pole wyboru",
      switch: "Przełącznik",
      number: "Liczba",
      date: "Data",
      file: "Plik",
      consent: "Zgoda",
    },
    fieldTypeHints: {
      text: "Jedna linia. Imię, stanowisko, numer.",
      textarea: "Kilka linii. Motywacja, pytanie do prelegenta.",
      select: "Jedna odpowiedź z listy opcji.",
      multiselect: "Wiele odpowiedzi z listy opcji.",
      checkbox: "Zaznaczone albo nie. Bez wartości dowodowej.",
      switch: "Tak albo nie, w jednym kliknięciu.",
      number: "Wartość liczbowa. Działają operatory reguł „nie mniej niż” i „nie więcej niż”.",
      date: "Data w kalendarzu.",
      file: "Załącznik uczestnika.",
      consent:
        "Zgoda z wersją i dowodem. Zapisuje się w rejestrze akceptacji, nie w odpowiedziach.",
    },

    // event_registration_fields.qualify_operator.
    qualifyOperators: {
      none: "Bez reguły",
      equals: "Jest równe",
      not_equals: "Jest różne od",
      in: "Jest jedną z wartości",
      not_in: "Nie jest żadną z wartości",
      gte: "Nie mniej niż",
      lte: "Nie więcej niż",
      is_true: "Zaznaczone",
      is_false: "Niezaznaczone",
      not_empty: "Wypełnione",
    },

    // event_registration_fields.qualify_outcome.
    qualifyOutcomes: {
      auto_approve: "Zatwierdź natychmiast",
      approval: "Skieruj do akceptacji",
      reject: "Odrzuć automatycznie",
    },
    qualifyOutcomeHints: {
      auto_approve: "Warunek spełniony - zgłoszenie wchodzi bez decyzji organizatora.",
      approval: "Warunek spełniony - zgłoszenie czeka na decyzję organizatora.",
      reject: "Warunek spełniony - zgłoszenie zostaje odrzucone bez udziału człowieka.",
    },

    // event_groups.attendee_visibility.
    attendeeVisibility: {
      none: "Nie widzi nikogo",
      own_group: "Widzi własną grupę",
      registered: "Widzi wszystkich zapisanych",
      everyone: "Widoczna także dla gości",
    },

    // event_terms.display.
    termDisplay: {
      registration: "Przy zapisie",
      access: "Przy wejściu na treść",
      registration_and_access: "Przy zapisie i przy wejściu",
    },

    currencies: {
      PLN: "złoty",
      EUR: "euro",
    },

    // Stan sprzedaży biletu - wyliczany z okna, puli i aktywności, nie kolumna.
    ticketAvailability: {
      on_sale: "W sprzedaży",
      scheduled: "Sprzedaż zaplanowana",
      ended: "Sprzedaż zakończona",
      sold_out: "Wyprzedany",
      inactive: "Wyłączony",
    },

    // Powód, dla którego zapisy są zamknięte (event_registration_form).
    closedReasons: {
      event_cancelled: "Wydarzenie zostało odwołane.",
      registration_disabled: "To wydarzenie nie przyjmuje zapisów.",
      registration_external: "Zapisy prowadzi narzędzie zewnętrzne.",
      registration_not_open: "Zapisy jeszcze się nie otworzyły.",
      membership_required: "Wydarzenie jest dostępne dla członków.",
      sold_out: "Wszystkie miejsca są zajęte.",
    },

    // Czynności organizatora (admin_event_registration_decide).
    actions: {
      approve: "Zatwierdź",
      reject: "Odrzuć",
      waitlist: "Przenieś na listę rezerwową",
      attended: "Oznacz obecność",
      no_show: "Oznacz nieobecność",
      cancel: "Anuluj zapis",
      promote: "Awansuj z rezerwy",
      markNotified: "Oznacz jako powiadomionych",
      exportCsv: "Eksport CSV",
    },

    registrations: {
      title: "Zgłoszenia",
      subtitle: "Wszystkie zapisy na to wydarzenie. Uczestnik nie musi mieć konta w systemie.",
      prevPage: "Poprzednia strona",
      nextPage: "Następna strona",
      searchPlaceholder: "Szukaj po nazwisku, adresie poczty, firmie albo stanowisku",
      loading: "Wczytywanie zgłoszeń…",
      empty: "Nie ma jeszcze żadnego zgłoszenia. Otwórz zapisy albo dopisz uczestnika ręcznie.",
      emptyFiltered: "Żadne zgłoszenie nie pasuje do tych filtrów.",
      staffOnly: "Lista zgłoszeń jest dostępna dla administratora i redaktora organizacji.",
      clearFilters: "Wyczyść filtry",
      addAction: "Dopisz uczestnika",
      exportAction: "Pobierz listę",

      tabs: {
        all: "Wszystkie",
        pending: "Oczekujące",
        approved: "Zatwierdzone",
        waitlist: "Rezerwowa",
        rejected: "Odrzucone",
        cancelled: "Anulowane",
        attended: "Obecni",
        no_show: "Nieobecni",
        draft: "Szkice",
      },

      filters: {
        status: "Status",
        ticket: "Bilet",
        group: "Grupa",
        dateFrom: "Zgłoszone od",
        dateTo: "Zgłoszone do",
        allTickets: "Wszystkie bilety",
        allGroups: "Wszystkie grupy",
        noTicket: "Bez biletu",
      },

      columns: {
        person: "Uczestnik",
        email: "Adres poczty",
        phone: "Telefon",
        jobTitle: "Stanowisko",
        company: "Firma",
        status: "Status",
        ticket: "Bilet",
        group: "Grupa",
        answers: "Odpowiedzi",
        consents: "Zgody",
        decision: "Decyzja",
        waitlistPosition: "Pozycja w kolejce",
        submittedAt: "Zgłoszono",
        source: "Źródło",
        entryCode: "Kod wejściowy",
      },

      capacity: {
        label: "Wolne miejsca",
        eventLimitHint:
          "Liczba wolnych miejsc w limicie WYDARZENIA. Pula każdego biletu ma własny licznik na zakładce Bilety.",
        unlimited: "Bez limitu",
        soldOut: "Brak wolnych miejsc",
        ofCapacity: "{{left}} z {{capacity}}",
      },

      entryCode: {
        issued: "Wydany",
        notIssued: "Niewydany",
        hint: "W bazie leży wyłącznie skrót kodu. Wartość jawna pokazuje się raz, w chwili zatwierdzenia zapisu.",
        copy: "Skopiuj kod wejściowy",
        copied: "Kod wejściowy skopiowany",
      },

      consents: {
        dataProcessing: "Przetwarzanie danych",
        marketing: "Komunikacja marketingowa",
        partnerSharing: "Przekazanie danych partnerowi",
        withdrawn: "Zgody wycofane",
        given: "Udzielona {{date}}",
        missing: "Brak",
        requiredMissing: "Brakuje {{count}} zgód wymaganych",
        requiredComplete: "Wszystkie zgody wymagane udzielone",
      },

      decision: {
        by: "Zdecydował",
        at: "Kiedy",
        source: "Podstawa",
        note: "Powód",
        automatic: "Bez udziału człowieka",
        none: "Bez decyzji",
      },

      decideDialog: {
        approveTitle: "Zatwierdzić to zgłoszenie?",
        approveBody:
          "Zgłoszenie zajmie miejsce w puli i otrzyma kod wejściowy. Kod przekaż uczestnikowi wiadomością.",
        rejectTitle: "Odrzucić to zgłoszenie?",
        rejectBody:
          "Powód jest wymagany i zostaje w historii zgłoszenia. Osoba może złożyć nowe zgłoszenie.",
        waitlistTitle: "Przenieść na listę rezerwową?",
        waitlistBody:
          "Zgłoszenie trafi na koniec kolejki i zwolni zajmowane miejsce, jeśli je zajmowało.",
        cancelTitle: "Anulować ten zapis?",
        cancelBody: "Miejsce wróci do puli, a pierwsza osoba z kolejki rezerwowej awansuje.",
        attendedTitle: "Oznaczyć obecność?",
        attendedBody: "Obecność jest faktem osobnym od zapisu i zasila raport frekwencji.",
        noShowTitle: "Oznaczyć nieobecność?",
        noShowBody:
          "Miejsce pozostaje policzone jako zajęte - uczestnik je zablokował, więc nie wraca do puli.",
        reasonLabel: "Powód decyzji",
        reasonPlaceholder: "Napisz, dlaczego - to zdanie zobaczy organizator przy sporze",
        noteLabel: "Notatka wewnętrzna",
        confirmAction: "Potwierdź",
        cancelAction: "Anuluj",
      },

      addDialog: {
        title: "Dopisz uczestnika",
        subtitle:
          "Wpis organizatora nie przechodzi formularza. Sprawdzamy tylko pulę miejsc - miejsce jest fizyczne niezależnie od tego, kto je przydzielił.",
        firstName: "Imię",
        lastName: "Nazwisko",
        email: "Adres poczty elektronicznej",
        emailHint: "Bez adresu osoba nie da się dopasować przy kolejnym wydarzeniu.",
        phone: "Telefon",
        jobTitle: "Stanowisko",
        companyText: "Nazwa firmy",
        companyId: "Firma w CRM",
        companyIdHint:
          "Wskazanie firmy z rejestru CRM. Wpisana nazwa zostaje jako to, co podał uczestnik.",
        socialProfileUrl: "Profil zawodowy",
        socialProfileUrlHint: "Pełny adres z https://",
        notes: "Notatka",
        ticket: "Bilet",
        group: "Grupa",
        status: "Status startowy",
        saveAction: "Dopisz",
        cancelAction: "Anuluj",
      },

      answersDialog: {
        title: "Odpowiedzi na formularz",
        empty: "To zgłoszenie nie ma odpowiedzi - wydarzenie przyjmuje zapisy jednym kliknięciem.",
        deletedField: "Pole usunięte z formularza",
        deletedFieldHint:
          "Definicja pytania została usunięta, odpowiedź zostaje. Skasowanie odpowiedzi razem z pytaniem byłoby utratą danych zgłoszenia.",
      },

      toasts: {
        approved: "Zgłoszenie zatwierdzone",
        rejected: "Zgłoszenie odrzucone",
        waitlisted: "Przeniesione na listę rezerwową",
        cancelled: "Zapis anulowany",
        attended: "Obecność zapisana",
        noShow: "Nieobecność zapisana",
        saved: "Uczestnik dopisany",
        promoted: "Awansowano {{count}} osób z kolejki",
        notified: "Oznaczono {{count}} zgłoszeń jako powiadomione",
        notifyFailed: "Decyzja zapisana, ale nie udało się wysłać wiadomości.",
        // BEZ SUFIKSÓW LICZBY MNOGIEJ. Ten słownik ma własną bramkę
        // (`src/lib/__tests__/i18nEventRegistrations.test.ts`), która wymaga
        // DOKŁADNIE tych samych kluczy po obu stronach - a polskie `_few`
        // i `_many` nie mają odpowiednika w angielskim. Sąsiednie komunikaty
        // („Awansowano {{count}} osób z kolejki") rozwiązują to tak samo:
        // konstrukcją, która działa dla każdej liczby.
        notifyFailedCount: "Nie udało się wysłać wiadomości: {{count}}",
        exported: "Wyeksportowano zgłoszenia: {{count}}",
        exportTruncated:
          "Plik nie zawiera wszystkich zgłoszeń - zawęź filtr i wyeksportuj resztę osobno.",
      },
    },

    form: {
      title: "Formularz zapisu",
      subtitle:
        "Pola, o które pytamy przy zapisie na to wydarzenie. Pytanie kwalifikujące decyduje o odrzuceniu albo skierowaniu do akceptacji.",
      loading: "Wczytywanie pól…",
      empty: "Formularz nie ma jeszcze żadnego pola. Wydarzenie przyjmie zapis jednym kliknięciem.",
      addAction: "Dodaj pole",
      modeHint:
        "Pola obowiązkowe są sprawdzane tylko w trybie formularza. W trybie zapisu jednym kliknięciem formularz nie jest pokazywany.",

      columns: {
        label: "Etykieta",
        key: "Klucz",
        type: "Typ pola",
        required: "Wymagane",
        qualifying: "Kwalifikujące",
        answers: "Odpowiedzi",
        order: "Kolejność",
        active: "Aktywne",
      },

      editor: {
        createTitle: "Nowe pole formularza",
        editTitle: "Edycja pola formularza",
        key: "Klucz pola",
        keyHint:
          "Niezmienny po zapisie: odpowiedzi złożonych zgłoszeń leżą pod tym kluczem. Litery a-z, cyfry i znak podkreślenia.",
        type: "Typ pola",
        labelPl: "Etykieta (polski)",
        labelEn: "Etykieta (angielski)",
        helpPl: "Podpowiedź (polski)",
        helpEn: "Podpowiedź (angielski)",
        helpHint: "Zdanie pod polem. Mówi, czego oczekujemy, a nie powtarza etykiety.",
        consentUrlPl: "Dokument zgody (polski)",
        consentUrlEn: "Dokument zgody (angielski)",
        consentUrlHint:
          "Adres https:// do treści zgody. Pokazujemy go przy polu zgody, żeby uczestnik wiedział, na co się godzi.",
        required: "Pole wymagane",
        options: "Opcje listy",
        optionsHint:
          "Kolejność opcji jest treścią redakcyjną - lista pokazuje je w tej kolejności.",
        optionValue: "Wartość",
        optionLabelPl: "Etykieta (polski)",
        optionLabelEn: "Etykieta (angielski)",
        addOption: "Dodaj opcję",
        removeOption: "Usuń opcję",
        sortOrder: "Kolejność",
        active: "Pole aktywne",
        qualifying: "Pytanie kwalifikujące",
        qualifyingHint:
          "Reguła nie wychodzi na front. Uczestnik, który zna regułę, odpowiada pod nią - a wtedy kwalifikacja mierzy znajomość reguły, nie to, co miała mierzyć.",
        operator: "Warunek",
        value: "Wartość warunku",
        valueHint: "Jedna wartość dla „jest równe”, lista dla „jest jedną z wartości”.",
        outcome: "Skutek spełnienia warunku",
        outcomePrecedence:
          "Pierwszeństwo: odrzucenie wygrywa z akceptacją, akceptacja z natychmiastowym zatwierdzeniem.",
        saveAction: "Zapisz pole",
        cancelAction: "Anuluj",
        deleteAction: "Usuń pole",
        deleteConfirm:
          "Usunąć definicję pola? Złożone odpowiedzi zostaną w zgłoszeniach jako pole usunięte.",
      },

      toasts: {
        saved: "Pole formularza zapisane",
        deleted: "Pole formularza usunięte",
      },
    },

    // UPRAWNIENIA DO STAWEK. Nadanie to decyzja organizatora z podstawa, a nie
    // deklaracja kupujacego - stad „podstawa nadania" jako pole obowiazkowe.
    audienceGrants: {
      title: "Uprawnienia do stawek",
      subtitle:
        "Stawka akademicka, pozarządowa lub firmowa wymaga potwierdzenia. Zapisz, komu ją nadajesz i na jakiej podstawie.",
      addAction: "Nadaj uprawnienie",
      empty: "Nie nadano jeszcze żadnych uprawnień.",
      loading: "Wczytywanie uprawnień…",
      searchLabel: "Szukaj osoby, firmy lub podstawy",
      searchPlaceholder: "Nazwisko, firma, numer legitymacji…",
      scopeAll: "Wszystkie wydarzenia",
      scopeThis: "To wydarzenie",
      includeRevoked: "Pokaż wycofane",
      audienceLabel: "Grupa odbiorców",
      audienceAll: "Wszystkie grupy",
      audiences: {
        academic: "Akademicka",
        ngo: "Pozarządowa",
        company: "Firmowa",
      },
      states: {
        active: "Aktywne",
        scheduled: "Zaplanowane",
        expired: "Wygasłe",
        revoked: "Wycofane",
      },
      columns: {
        holder: "Kto",
        audience: "Grupa",
        scope: "Zakres",
        evidence: "Podstawa",
        validity: "Ważność",
        state: "Stan",
        actions: "Działania",
      },
      subjectUser: "Konto użytkownika",
      subjectPerson: "Osoba w kartotece",
      subjectCompany: "Organizacja",
      subjectHint: "Wskaż dokładnie jedno: konto, osobę albo organizację.",
      evidenceLabel: "Podstawa nadania",
      evidencePlaceholder: "np. legitymacja UW nr 123456, KRS 0000123456",
      evidenceHint: "Podstawa zostaje w rejestrze - to ona tłumaczy niższą cenę przy rozliczeniu.",
      validUntilLabel: "Ważne do",
      validUntilHint: "Puste = bezterminowo.",
      scopeLabel: "Zakres",
      scopeHint: "Puste = uprawnienie działa we wszystkich wydarzeniach organizacji.",
      saveAction: "Zapisz nadanie",
      cancelAction: "Anuluj",
      revokeAction: "Wycofaj",
      revokeConfirm:
        "Wycofać uprawnienie? Wiersz zostaje w rejestrze ze stemplem wycofania - to ślad audytowy.",
      neverExpires: "Bezterminowo",
      revokedAt: "Wycofane {{date}}",
      toasts: {
        saved: "Uprawnienie zapisane",
        revoked: "Uprawnienie wycofane",
      },
      errors: {
        subjectRequired: "Wskaż konto, osobę albo organizację.",
        subjectExclusive: "Wskaż dokładnie jeden podmiot.",
        evidenceRequired: "Podaj podstawę nadania.",
        forbidden: "Nie masz uprawnień do zarządzania stawkami tego wydarzenia.",
        unknown: "Operacja się nie udała. Odśwież ekran i spróbuj ponownie.",
      },
    },
    audienceGrantHistory: {
      title: "Historia zmian uprawnień",
      subtitle:
        "Kto, kiedy i co zmienił przy stawkach ulgowych. Dziennik jest tylko do odczytu - wpis, który da się poprawić, nie jest śladem audytowym.",
      openAction: "Historia",
      dialogTitle: "Historia tego uprawnienia",
      loading: "Wczytywanie historii…",
      empty: "Brak zapisanych zmian w tym zakresie.",
      searchLabel: "Szukaj osoby, firmy lub podstawy",
      searchPlaceholder: "Nazwisko, firma, e-mail…",
      limitLabel: "Liczba wpisów",
      actorUnknown: "Zmiana systemowa",
      subjectUnknown: "Podmiot bez nazwy",
      emptyValue: "puste",
      summary: "{{subject}} · {{audience}} · {{scope}}",
      footnote:
        "Wpisy pochodzą ze wspólnego dziennika audytu - stawia je baza przy każdym zapisie, niezależnie od tego, którym ekranem zmiana weszła.",
      actions: {
        granted: "Nadano",
        updated: "Zmieniono",
        revoked: "Wycofano",
        restored: "Przywrócono",
      },
      fields: {
        audience: "Grupa odbiorców",
        evidence: "Podstawa",
        valid_from: "Ważne od",
        valid_until: "Ważne do",
        revoked_at: "Wycofanie",
        company_id: "Organizacja",
        event_id: "Zakres",
        user_id: "Konto",
        person_id: "Osoba",
      },
    },
    // PAKIETY GRUPOWE. Jeden platnik, wiele imiennych miejsc - slownictwo
    // celowo mowi „miejsce", a nie „bilet": bilet kupuje sie dla siebie.
    packages: {
      title: "Pakiety grupowe",
      subtitle:
        "Pakiet kupuje jeden płatnik (firma, uczelnia, delegacja), a miejsca rozdaje imiennie później. Każde miejsce zamienia się w zwykłe zgłoszenie.",
      loading: "Wczytywanie pakietów…",
      empty: "To wydarzenie nie ma pakietów grupowych. Uczestnicy zapisują się pojedynczo.",
      addAction: "Dodaj pakiet",
      audienceLabel: "Odbiorca",
      audiences: {
        public: "Otwarty",
        member: "Dla członków",
        academic: "Akademicki",
        ngo: "Organizacja pozarządowa",
        company: "Firma",
      },
      seatsLabel: "Miejsca w pakiecie",
      soldLabel: "Sprzedane pakiety",
      assignedLabel: "Miejsca przypisane",
      unlimitedQuota: "Bez limitu",
      verificationBadge: "Wymaga weryfikacji",
      inactiveBadge: "Nieaktywny",
      ticketLabel: "Bilet nadawany miejscu",
      editAction: "Edytuj pakiet",
      deleteAction: "Usuń pakiet",
      deleteTitle: "Usunąć pakiet?",
      deleteDescription:
        "Usunięcie działa tylko dla pakietu bez zamówień. Pakiet ze sprzedażą wyłącz przełącznikiem.",
      deleteConfirm: "Usuń",
      cancel: "Anuluj",

      editor: {
        createTitle: "Nowy pakiet grupowy",
        editTitle: "Edycja pakietu",
        identitySection: "Nazwa i klucz",
        offerSection: "Oferta i cena",
        rulesSection: "Zasady sprzedaży",
        key: "Klucz",
        keyHint: "Małe litery, cyfry i podkreślenia. Po zapisie nie da się go zmienić.",
        ticketTypeId: "Bilet nadawany miejscu",
        ticketHint: "Każde miejsce z pakietu dostaje ten bilet po przyjęciu zaproszenia.",
        namePl: "Nazwa (polski)",
        nameEn: "Nazwa (angielski)",
        descriptionPl: "Opis (polski)",
        descriptionEn: "Opis (angielski)",
        audience: "Odbiorca pakietu",
        seats: "Liczba miejsc",
        seatsHint: "Ile osób obejmuje jeden zakup pakietu.",
        priceCents: "Cena pakietu (w groszach)",
        currency: "Waluta",
        quota: "Limit sprzedanych pakietów",
        quotaHint: "Puste pole = bez limitu.",
        salesFrom: "Sprzedaż od",
        salesTo: "Sprzedaż do",
        minTierRank: "Próg członkostwa",
        requiresVerification: "Wymaga weryfikacji organizatora",
        active: "Aktywny",
        sortOrder: "Kolejność",
        save: "Zapisz pakiet",
        cancel: "Anuluj",
      },

      orders: {
        title: "Zamówienia pakietów",
        subtitle: "Płatnik, pula miejsc i stan płatności.",
        loading: "Wczytywanie zamówień…",
        empty: "Brak zamówień dla wybranego pakietu.",
        addAction: "Dodaj zamówienie",
        allPackages: "Wszystkie pakiety",
        filterLabel: "Pakiet",
        buyer: "Płatnik",
        seats: "Miejsca",
        seatsSummary: "{{assigned}} z {{total}} przypisanych, {{invited}} zaproszonych",
        amount: "Kwota",
        status: "Stan",
        statuses: {
          pending: "Oczekuje na płatność",
          paid: "Opłacone",
          cancelled: "Anulowane",
          refunded: "Zwrócone",
        },
        manageSeats: "Zarządzaj miejscami",
        createTitle: "Nowe zamówienie pakietu",
        buyerEmail: "Adres poczty płatnika",
        buyerName: "Nazwa płatnika",
        seatsTotal: "Liczba miejsc",
        seatsTotalHint: "Puste pole = tyle miejsc, ile daje pakiet.",
        amountCents: "Kwota (w groszach)",
        amountHint: "Puste pole = cena pakietu bez zmian.",
        invoiceNote: "Notatka do faktury",
        save: "Utwórz zamówienie",
        cancel: "Anuluj",
        toasts: {
          created: "Zamówienie utworzone",
          statusChanged: "Stan zamówienia zmieniony",
        },
      },

      seats: {
        title: "Miejsca w zamówieniu",
        subtitle:
          "Zaproszenie generuje jednorazowy odnośnik. Kod pokazujemy raz - w bazie zostaje wyłącznie jego skrót.",
        loading: "Wczytywanie miejsc…",
        empty: "To zamówienie nie ma jeszcze miejsc.",
        states: {
          free: "Wolne",
          invited: "Zaproszone",
          assigned: "Przypisane",
          revoked: "Cofnięte",
        },
        inviteAction: "Zaproś",
        revokeAction: "Cofnij",
        inviteTitle: "Zaproszenie na miejsce",
        inviteEmail: "Adres poczty zapraszanego",
        inviteName: "Imię i nazwisko",
        validDays: "Ważność (dni)",
        send: "Wystaw zaproszenie",
        cancel: "Zamknij",
        tokenTitle: "Odnośnik zaproszenia",
        tokenHint: "Skopiuj teraz - ten odnośnik nie pojawi się drugi raz.",
        copyAction: "Kopiuj odnośnik",
        expiresAt: "Ważne do {{date}}",
        toasts: {
          invited: "Zaproszenie wystawione",
          revoked: "Miejsce cofnięte",
          copied: "Odnośnik skopiowany",
        },
      },

      toasts: {
        saved: "Pakiet zapisany",
        deleted: "Pakiet usunięty",
      },
    },

    tickets: {
      title: "Bilety",
      subtitle:
        "Bilety ustawia się każdemu wydarzeniu indywidualnie - nie ma globalnego cennika. Bilet nadaje grupę uczestnika.",
      loading: "Wczytywanie biletów…",
      empty:
        "To wydarzenie nie ma biletów. Zapis obowiązuje bez wyboru biletu, w limicie miejsc wydarzenia.",
      addAction: "Dodaj bilet",

      columns: {
        name: "Nazwa",
        key: "Klucz",
        price: "Cena",
        quota: "Pula",
        sold: "Zajęte",
        seatsLeft: "Wolne",
        window: "Okno sprzedaży",
        tier: "Próg członkostwa",
        group: "Nadawana grupa",
        approval: "Wymaga akceptacji",
        availability: "Stan sprzedaży",
        order: "Kolejność",
        pending: "Oczekujące",
        waitlist: "Rezerwowa",
      },

      free: "Bezpłatny",
      unlimitedQuota: "Bez limitu",
      noWindow: "Bez ograniczenia czasu",
      windowFrom: "od {{date}}",
      windowTo: "do {{date}}",
      noGroup: "Bez nadania grupy",
      anyTier: "Bez progu",
      earlyBirdBadge: "Promocja do {{date}}",
      accessCodeBadge: "Kod dostępu",
      noWaitlistBadge: "Bez kolejki",
      effectivePrice: "Cena dzisiaj: {{price}}",

      editor: {
        createTitle: "Nowy bilet",
        editTitle: "Edycja biletu",
        key: "Klucz biletu",
        keyHint: "Niezmienny po zapisie. Litery a-z, cyfry i znak podkreślenia.",
        namePl: "Nazwa (polski)",
        nameEn: "Nazwa (angielski)",
        descriptionPl: "Opis (polski)",
        descriptionEn: "Opis (angielski)",
        priceCents: "Cena",
        priceHint:
          "Cena w najmniejszej jednostce waluty - 15000 to 150,00. Zero znaczy wejściówkę bezpłatną, która nadal ma pulę i okno sprzedaży.",
        currency: "Waluta",
        quota: "Pula miejsc",
        quotaHint:
          "Puste znaczy bez limitu. Limit wydarzenia i pula biletu obowiązują jednocześnie - wiążący jest mniejszy z nich.",
        salesFrom: "Sprzedaż od",
        salesTo: "Sprzedaż do",
        minTierRank: "Próg warstwy członkostwa",
        requiresApproval: "Wymaga akceptacji organizatora",
        requiresApprovalHint:
          "Podnosi wymóg akceptacji nawet na wydarzeniu z zapisem natychmiastowym. Nie może go obniżyć.",
        group: "Grupa nadawana przy zapisie",
        groupHint: "Bez tego administrator przypisuje grupę ręcznie przy każdym uczestniku.",
        active: "Bilet aktywny",
        sortOrder: "Kolejność",
        saveAction: "Zapisz bilet",
        cancelAction: "Anuluj",
        deleteAction: "Usuń bilet",
        deleteConfirm:
          "Usunąć bilet? Operacja jest możliwa tylko wtedy, gdy żaden zapis go nie używa.",
        advancedSection: "Cena promocyjna, kod dostępu i kolejka",
        benefitsSection: "Co zawiera bilet",
        benefitsPl: "Korzyści (PL) - jedna w linii",
        benefitsEn: "Korzyści (EN) - jedna w linii",
        benefitsHint:
          "Każda linia to jeden punkt na karcie biletu. Maksymalnie {{max}} pozycji, do 200 znaków każda.",
        phasesSection: "Cennik w czasie (early bird, cena regularna, last minute)",
        phasesHint:
          'Obowiązuje PIERWSZY próg, którego okno obejmuje bieżącą chwilę. Próg wygrywa z ceną podstawową i ceną promocyjną, a puste daty znaczą „od zawsze" i „bezterminowo".',
        phasesEmpty: "Brak progów - obowiązuje cena podstawowa (albo cena promocyjna).",
        phaseNumber: "Próg {{index}}",
        phaseLabelPl: "Nazwa progu (PL)",
        phaseLabelEn: "Nazwa progu (EN)",
        phaseFrom: "Obowiązuje od",
        phaseTo: "Obowiązuje do",
        phasePrice: "Cena w groszach",
        phaseAdd: "Dodaj próg cenowy",
        phaseRemove: "Usuń próg",
        phaseMoveUp: "Przenieś próg wyżej",
        phaseMoveDown: "Przenieś próg niżej",
        earlyBirdPriceCents: "Cena promocyjna (early bird)",
        earlyBirdUntil: "Cena promocyjna obowiązuje do",
        earlyBirdHint:
          "Cena i termin działają w parze. Po tym terminie obowiązuje cena podstawowa - bez ręcznej zmiany biletu.",
        accessCode: "Nowy kod dostępu",
        accessCodeHelp:
          "Kod nie wraca z serwera - w bazie leży wyłącznie jego skrót. Puste pole zostawia obecny kod bez zmian.",
        accessCodeSet: "Bilet ma ustawiony kod dostępu",
        accessCodeNone: "Bilet jest dostępny bez kodu",
        removeAccessCode: "Zdejmij kod dostępu przy zapisie",
        accessCodeHintLabel: "Podpowiedź przy polu kodu",
        accessCodeHintHelp: "Zdanie dla uczestnika, np. „kod z zaproszenia partnera”.",
        waitlistEnabled: "Lista rezerwowa po wyczerpaniu puli",
        waitlistHint:
          "Wyłączona oznacza komunikat o wyprzedaniu zamiast kolejki - nikt nie czeka na miejsce, które nie wróci.",
      },

      toasts: {
        saved: "Bilet zapisany",
        deleted: "Bilet usunięty",
      },
    },

    groups: {
      title: "Grupy uczestników",
      subtitle:
        "Grupa rozdaje uprawnienia w obrębie wydarzenia: kto kogo widzi, kto prosi o spotkanie, kto rozmawia, kto skanuje leady.",
      loading: "Wczytywanie grup…",
      empty: "To wydarzenie nie ma jeszcze grup.",
      addAction: "Dodaj grupę",
      systemBadge: "Grupa systemowa",
      defaultBadge: "Grupa domyślna",

      columns: {
        name: "Nazwa",
        key: "Klucz",
        members: "Członkowie",
        primaryMembers: "Z zapisu",
        extraMembers: "Dopisani",
        tickets: "Bilety",
        visibility: "Widoczność uczestników",
        permissions: "Uprawnienia",
        tier: "Próg członkostwa",
        order: "Kolejność",
      },

      permissions: {
        canSeeAttendees: "Widzi listę uczestników",
        canMeet: "Może prosić o spotkanie",
        canChat: "Może rozmawiać na czacie",
        canLeadRetrieval: "Może skanować leady",
        canSeeRecording: "Widzi nagranie",
        sumHint:
          "Uprawnienie wypadkowe z wielu grup to suma zdolności - najbardziej pozwalająca wygrywa.",
      },

      editor: {
        createTitle: "Nowa grupa uczestników",
        editTitle: "Edycja grupy uczestników",
        key: "Klucz grupy",
        keyHint: "Niezmienny po zapisie. Litery a-z, cyfry i znak podkreślenia.",
        namePl: "Nazwa (polski)",
        nameEn: "Nazwa (angielski)",
        descriptionPl: "Opis (polski)",
        descriptionEn: "Opis (angielski)",
        color: "Kolor",
        colorHint: "Zapis heksadecymalny, na przykład #2563eb.",
        visibility: "Zasięg widoczności uczestników",
        visibilityHint:
          "Zasięg działa tylko wtedy, gdy grupa widzi listę uczestników. Bez tego wyboru wpis byłby sprzeczny.",
        minTierRank: "Próg warstwy członkostwa",
        isDefault: "Grupa domyślna wydarzenia",
        isDefaultHint:
          "Grupa przypisywana zapisowi bez biletu. Dokładnie jedna na wydarzenie - ustawienie tutaj odbiera flagę poprzedniej.",
        sortOrder: "Kolejność",
        saveAction: "Zapisz grupę",
        cancelAction: "Anuluj",
        deleteAction: "Usuń grupę",
        deleteConfirm:
          "Usunąć grupę? Operacja jest możliwa tylko wtedy, gdy żaden zapis, bilet ani członkostwo jej nie używa.",
      },

      members: {
        title: "Członkostwo dodatkowe",
        subtitle:
          "Grupa podstawowa jedzie na zapisie i nadaje ją bilet. Tu dopisujemy grupy dodatkowe - prelegenta, który jest też uczestnikiem.",
        addAction: "Dopisz do grupy",
        removeAction: "Wypisz z grupy",
        empty: "Nikt nie jest dopisany do tej grupy poza osobami z zapisu.",
        searchPlaceholder: "Szukaj osoby w kartotece",
      },

      toasts: {
        saved: "Grupa zapisana",
        deleted: "Grupa usunięta",
        memberAdded: "Osoba dopisana do grupy",
        memberRemoved: "Osoba wypisana z grupy",
      },
    },

    terms: {
      title: "Zgody i regulaminy",
      subtitle:
        "Zgody tego wydarzenia z wersją. Zgoda na wersję pierwszą nie jest zgodą na drugą - podniesienie wersji prosi uczestników ponownie.",
      loading: "Wczytywanie zgód…",
      empty: "To wydarzenie nie ma jeszcze żadnej zgody ani regulaminu.",
      addAction: "Dodaj zgodę",

      columns: {
        label: "Etykieta",
        key: "Klucz",
        display: "Gdzie pokazujemy",
        required: "Wymagana",
        version: "Wersja",
        acceptancesCurrent: "Akceptacje wersji aktualnej",
        acceptancesTotal: "Akceptacje razem",
        withdrawn: "Wycofane",
        order: "Kolejność",
        active: "Aktywna",
      },

      versionGapHint:
        "Różnica między akceptacjami wersji aktualnej i wszystkimi mierzy skutek podniesienia wersji - tyle osób trzeba poprosić ponownie.",
      optionalHint:
        "Zgoda niewymagana nie blokuje zatwierdzenia zapisu. Gdyby blokowała, byłaby zgodą pozorną.",

      editor: {
        createTitle: "Nowa zgoda wydarzenia",
        editTitle: "Edycja zgody wydarzenia",
        key: "Klucz zgody",
        keyHint: "Niezmienny po zapisie. Litery a-z, cyfry i znak podkreślenia.",
        labelPl: "Etykieta przy polu wyboru (polski)",
        labelEn: "Etykieta przy polu wyboru (angielski)",
        bodyPl: "Treść (polski)",
        bodyEn: "Treść (angielski)",
        externalUrl: "Odnośnik do dokumentu",
        externalUrlHint:
          "Pełny adres z https://. Wystarczy zamiast treści, jeśli dokument żyje osobno.",
        display: "Gdzie pokazujemy",
        required: "Zgoda wymagana",
        version: "Wersja",
        bumpVersion: "Podnieś wersję",
        bumpVersionHint:
          "Podniesienie unieważnia dotychczasowe akceptacje jako aktualne. Literówki poprawiaj bez podnoszenia wersji.",
        sortOrder: "Kolejność",
        active: "Zgoda aktywna",
        saveAction: "Zapisz zgodę",
        cancelAction: "Anuluj",
        deleteAction: "Usuń zgodę",
        deleteConfirm:
          "Usunąć zgodę? Operacja jest możliwa tylko wtedy, gdy nikt jej nie zaakceptował - akceptacja jest dowodem.",
      },

      toasts: {
        saved: "Zgoda zapisana",
        deleted: "Zgoda usunięta",
      },
    },

    waitlist: {
      title: "Lista rezerwowa",
      subtitle:
        "Kolejka na zwolnione miejsca. Anulowanie zapisu awansuje pierwszą osobę w tej samej sekundzie.",
      empty: "Kolejka rezerwowa jest pusta.",
      position: "Pozycja {{position}}",
      promoteAction: "Awansuj",
      promoteCountLabel: "Ile osób awansować",
      promoteOutOfOrder: "Awansuj poza kolejnością",
      promoteOutOfOrderHint:
        "Wyprzedzenie kolejki zapisuje się jako decyzja organizatora - ktoś kiedyś o nią zapyta.",
      notifiedAt: "Powiadomiono",
      awaitingNotice: "Awansowani, jeszcze niepowiadomieni",
      awaitingNoticeHint:
        "Osoba bez konta nie dostaje powiadomienia w aplikacji. Po wysłaniu wiadomości oznacz zgłoszenie jako powiadomione.",
      notNotified: "Bez powiadomienia",
    },

    publicForm: {
      title: "Zapis na wydarzenie",
      submitAction: "Zapisz mnie",
      submitting: "Zapisujemy…",
      firstName: "Imię",
      lastName: "Nazwisko",
      email: "Adres poczty elektronicznej",
      phone: "Telefon",
      jobTitle: "Stanowisko",
      companyText: "Firma",
      socialProfileUrl: "Profil zawodowy",
      ticketLabel: "Wybierz bilet",
      requiredMark: "Pole wymagane",
      optionalMark: "Pole nieobowiązkowe",
      consentDataProcessing: "Zgadzam się na przetwarzanie moich danych w celu obsługi zapisu",
      consentDataProcessingHint: "Bez tej zgody nie da się obsłużyć zapisu.",
      consentMarketing: "Chcę dostawać informacje o kolejnych wydarzeniach",
      consentPartnerSharing: "Zgadzam się na przekazanie moich danych partnerom wydarzenia",
      consentPartnerSharingHint:
        "Zgoda nieobowiązkowa. Jej brak nie wpływa na przyjęcie zgłoszenia.",
      seatsLeft: "Wolne miejsca: {{count}}",
      seatsUnlimited: "Bez limitu miejsc",

      resultApproved: {
        title: "Jesteś zapisany",
        body: "Kod wejściowy przyszedł na podany adres poczty. Pokaż go przy wejściu.",
      },
      resultPending: {
        title: "Zgłoszenie przyjęte",
        body: "Organizator podejmie decyzję i odezwie się na podany adres poczty.",
      },
      resultWaitlist: {
        title: "Jesteś na liście rezerwowej",
        body: "Twoja pozycja w kolejce: {{position}}. Damy znać, gdy zwolni się miejsce.",
      },
      resultRejected: {
        title: "Zgłoszenie nie zostało przyjęte",
        body: "To wydarzenie ma warunki uczestnictwa, których zgłoszenie nie spełnia.",
      },

      manage: {
        title: "Twój zapis",
        cancelAction: "Wycofaj zapis",
        cancelConfirm: "Wycofać zapis? Miejsce wróci do puli i trafi do pierwszej osoby z kolejki.",
        cancelled: "Zapis wycofany",
        promotedSomeone: "Zwolnione miejsce trafiło do kolejki rezerwowej.",
      },
    },

    errors: {
      // Plaszczyzna tresci - zapis publiczny.
      rateLimited: "Za dużo prób zapisu z tego miejsca. Spróbuj ponownie za kilka minut.",
      packageKeyPattern: "Klucz musi pasować do wzoru ^[a-z][a-z0-9_]{1,48}$",
      packageTicketRequired: "Wskaż bilet nadawany miejscu w pakiecie.",
      packageNameRequired: "Nazwa pakietu jest wymagana w obu językach.",
      packageDescriptionTooLong: "Opis pakietu jest za długi.",
      packageSeatsRange: "Liczba miejsc musi mieścić się w zakresie 1-1000.",
      packagePriceRange: "Cena pakietu jest poza dopuszczalnym zakresem.",
      packageQuotaRange: "Limit sprzedanych pakietów jest poza zakresem.",
      packageTierRange: "Próg członkostwa musi mieścić się w zakresie 0-100.",
      packageSalesWindow: "Koniec sprzedaży musi być późniejszy niż początek.",
      packageSortRange: "Kolejność musi mieścić się w zakresie 0-10000.",
      packageOrderBuyerEmail: "Podaj prawidłowy adres poczty płatnika.",
      packageOrderSeats: "Liczba miejsc w zamówieniu jest poza zakresem.",
      packageOrderAmount: "Kwota zamówienia jest poza zakresem.",
      packageSeatEmail: "Podaj prawidłowy adres poczty zapraszanego.",
      packageSeatValidDays: "Ważność zaproszenia musi mieścić się w zakresie 1-90 dni.",

      payloadTooLarge: "Zgłoszenie jest za duże. Skróć odpowiedzi opisowe.",
      invalidAnswers: "Odpowiedzi mają nieprawidłowy format.",
      invalidName: "Imię i nazwisko są wymagane.",
      invalidEmail: "Podaj prawidłowy adres poczty elektronicznej.",
      invalidSocialUrl: "Adres profilu musi zaczynać się od https://",
      consentRequired: "Zgoda na przetwarzanie danych jest warunkiem obsługi zapisu.",
      missingRequiredFields: "Uzupełnij pola wymagane: {{fields}}",
      termsRequired: "Zaakceptuj zgody wymagane: {{terms}}",
      alreadyRegistered: "Ta osoba ma już aktywny zapis na to wydarzenie.",
      alreadyClosed: "Ten zapis jest już zamknięty.",
      eventFinished: "Obecność jest już zapisana - zapisu nie da się wycofać.",
      eventCancelled: "Wydarzenie zostało odwołane.",
      registrationDisabled: "To wydarzenie nie przyjmuje zapisów.",
      registrationExternal: "Zapisy prowadzi narzędzie zewnętrzne.",
      registrationNotOpen: "Zapisy jeszcze się nie otworzyły.",
      membershipRequired: "Wydarzenie jest dostępne dla członków.",
      ticketRequired: "To wydarzenie sprzedaje bilety - wybierz jeden.",
      ticketNotOnSale: "Sprzedaż tego biletu jeszcze się nie rozpoczęła.",
      ticketSalesEnded: "Sprzedaż tego biletu jest zamknięta.",
      ticketTierRequired: "Ten bilet wymaga wyższej warstwy członkostwa.",

      // Plaszczyzna administracyjna.
      forbidden: "Ta operacja jest dostępna dla administratora i redaktora organizacji.",
      notFoundEvent: "Wydarzenie nie istnieje w tej organizacji.",
      notFoundRegistration: "Zgłoszenie nie istnieje w tej organizacji.",
      notFoundPerson: "Osoba nie istnieje w kartotece tej organizacji.",
      notFoundTicket: "Bilet nie istnieje w tym wydarzeniu.",
      notFoundGroup: "Grupa nie istnieje w tym wydarzeniu.",
      notFoundField: "Pole formularza nie istnieje w tej organizacji.",
      notFoundTerm: "Zgoda nie istnieje w tej organizacji.",
      invalidRequest: "Brakuje danych wymaganych do wykonania operacji.",
      invalidAction: "Nieznana czynność.",
      invalidTransition: "Zgłoszenie w stanie „{{from}}” nie może przejść tej operacji.",
      invalidStatus:
        "Wpis organizatora może startować jako szkic, oczekujący, zatwierdzony albo rezerwowy.",
      reasonRequired: "Powód odrzucenia jest wymagany.",
      noSeatsLeft: "Brak wolnych miejsc dla tego biletu. Użyj listy rezerwowej.",
      quotaBelowSold: "Pula nie może być mniejsza od liczby zajętych miejsc ({{count}}).",
      ticketInUse: "Bilet jest używany przez {{count}} zapisów - wyłącz go zamiast usuwać.",
      groupSystem: "Grup systemowych nie da się usunąć.",
      groupInUse: "Grupa jest używana w {{count}} miejscach - najpierw je przepnij.",
      termInUse: "Zgoda ma {{count}} akceptacji - wyłącz ją zamiast usuwać.",
      invalidKey:
        "Klucz musi zaczynać się od litery i zawierać wyłącznie a-z, 0-9 i znak podkreślenia.",
      invalidNames: "Nazwa jest wymagana w obu językach.",
      invalidLabels: "Etykieta jest wymagana w obu językach.",
      invalidOptions: "Opcje listy muszą być tablicą.",
      duplicateKey: "Wpis o tym kluczu już istnieje w tym wydarzeniu.",
      invalidEarlyBird: "Cena promocyjna wymaga terminu i nie może przekraczać ceny podstawowej.",
      invalidAccessCode: "Kod dostępu musi mieć od 4 do 64 znaków.",
      invalidBenefits: "Najwyżej 20 korzyści, każda do 200 znaków.",
      invalidPriceSchedule:
        "Każdy próg cennika potrzebuje ceny i okna, które kończy się po tym, jak się zaczyna.",
      invalidConsentUrl: "Adres dokumentu zgody musi zaczynać się od https:// (do 500 znaków).",
      notFound: "Rekord nie istnieje w tej organizacji.",
      packageSoldOut: "Pula pakietów tego rodzaju została wyczerpana.",
      packageInUse: "Pakiet ma {{count}} zamówień - wyłącz go zamiast usuwać.",
      seatTaken: "To miejsce jest już zajęte przez uczestnika.",
      seatRevoked: "To miejsce zostało wycofane.",
      orderCancelled: "Zamówienie stojące za tym miejscem jest anulowane.",
      invitationExpired: "Zaproszenie wygasło - wyślij je ponownie.",
      invalidToken: "Odnośnik zaproszenia jest nieprawidłowy.",
      // ODMOWY EKRANU „STAWKI I UPRAWNIENIA" (`admin_event_audience_grant_save`).
      // Ekran ma własne reguły w `adminEventRegistration.audienceGrants.errors`,
      // ale mapper odmów bazy czyta TEN namespace - bez tych trzech kluczy baza
      // ostrzejsza od formularza (zapis z innej karty, import) degradowała się
      // do `unknown` i powód nadania znikał.
      invalidAudience: "Grupa odbiorców to uczelnia, organizacja pozarządowa albo firma.",
      invalidSubject: "Wskaż dokładnie jeden podmiot: konto albo osobę.",
      invalidEvidence: "Podaj podstawę nadania stawki (co najmniej 3 znaki).",
      unknown: "Operacja się nie udała. Odśwież ekran i spróbuj ponownie.",
    },
  },
};

export const adminEventRegistrationEn = {
  adminEventRegistration: {
    nav: {
      sectionTitle: "Registrations",
      sectionsNavLabel: "Event registration sections",
      registrations: "Applications",
      form: "Form",
      tickets: "Tickets",
      groups: "Groups",
      terms: "Consents",
      waitlist: "Waiting list",
    },

    statuses: {
      draft: "Draft",
      pending: "Awaiting decision",
      approved: "Approved",
      rejected: "Rejected",
      waitlist: "Waiting list",
      cancelled: "Cancelled",
      attended: "Attended",
      no_show: "No show",
    },
    statusHints: {
      draft: "Form started and not submitted. Takes no seat.",
      pending: "The application waits for the organiser's decision. Takes no seat.",
      approved: "Seat taken, entry code issued.",
      rejected: "Application rejected. The person may submit a new one.",
      waitlist: "Queued for a freed seat, with a position in the queue.",
      cancelled: "Withdrawn by the participant or the organiser. The seat went back to the pool.",
      attended: "Attendance confirmed on site.",
      no_show: "Registered and did not come. The seat still counts as taken.",
    },

    registrationModes: {
      rsvp: "One-click registration",
      form: "Application form",
    },

    decisionSources: {
      organizer: "Organiser's decision",
      automatic_rule: "Qualifying rule",
      capacity: "No free seat",
      system: "System automation",
    },

    sources: {
      self_registration: "Self registration",
      invitation: "Invitation",
      organizer: "Organiser entry",
      import: "File import",
      crm: "CRM database",
      partner: "Partner",
      scan: "On-site scan",
    },

    fieldTypes: {
      text: "Short text",
      textarea: "Long text",
      select: "Single choice",
      multiselect: "Multiple choice",
      checkbox: "Checkbox",
      switch: "Toggle",
      number: "Number",
      date: "Date",
      file: "File",
      consent: "Consent",
    },
    fieldTypeHints: {
      text: "One line. A name, a job title, a number.",
      textarea: "A few lines. Motivation, a question for the speaker.",
      select: "One answer from a list of options.",
      multiselect: "Several answers from a list of options.",
      checkbox: "Ticked or not. No evidentiary value.",
      switch: "Yes or no, in one click.",
      number: "A numeric value. The rule operators “at least” and “at most” work on it.",
      date: "A calendar date.",
      file: "An attachment from the participant.",
      consent:
        "A versioned consent with proof. Stored in the acceptance register, not in the answers.",
    },

    qualifyOperators: {
      none: "No rule",
      equals: "Equals",
      not_equals: "Does not equal",
      in: "Is one of",
      not_in: "Is none of",
      gte: "At least",
      lte: "At most",
      is_true: "Ticked",
      is_false: "Not ticked",
      not_empty: "Filled in",
    },

    qualifyOutcomes: {
      auto_approve: "Approve immediately",
      approval: "Send for approval",
      reject: "Reject automatically",
    },
    qualifyOutcomeHints: {
      auto_approve: "Condition met - the application goes through without an organiser's decision.",
      approval: "Condition met - the application waits for the organiser's decision.",
      reject: "Condition met - the application is rejected without a human involved.",
    },

    attendeeVisibility: {
      none: "Sees nobody",
      own_group: "Sees its own group",
      registered: "Sees everyone registered",
      everyone: "Visible to guests as well",
    },

    termDisplay: {
      registration: "At registration",
      access: "When entering the content",
      registration_and_access: "At registration and on entry",
    },

    currencies: {
      PLN: "zloty",
      EUR: "euro",
    },

    ticketAvailability: {
      on_sale: "On sale",
      scheduled: "Sales scheduled",
      ended: "Sales ended",
      sold_out: "Sold out",
      inactive: "Disabled",
    },

    closedReasons: {
      event_cancelled: "The event has been cancelled.",
      registration_disabled: "This event does not take registrations.",
      registration_external: "Registration runs in an external tool.",
      registration_not_open: "Registration has not opened yet.",
      membership_required: "The event is open to members.",
      sold_out: "All seats are taken.",
    },

    actions: {
      approve: "Approve",
      reject: "Reject",
      waitlist: "Move to the waiting list",
      attended: "Mark attendance",
      no_show: "Mark as no show",
      cancel: "Cancel registration",
      promote: "Promote from the waiting list",
      markNotified: "Mark as notified",
      exportCsv: "Export CSV",
    },

    registrations: {
      title: "Applications",
      subtitle: "All registrations for this event. A participant does not need an account.",
      prevPage: "Previous page",
      nextPage: "Next page",
      searchPlaceholder: "Search by name, e-mail, company or job title",
      loading: "Loading applications…",
      empty: "No application yet. Open registration or add a participant by hand.",
      emptyFiltered: "No application matches these filters.",
      staffOnly:
        "The application list is available to the organisation's administrator and editor.",
      clearFilters: "Clear filters",
      addAction: "Add participant",
      exportAction: "Download the list",

      tabs: {
        all: "All",
        pending: "Awaiting",
        approved: "Approved",
        waitlist: "Waiting list",
        rejected: "Rejected",
        cancelled: "Cancelled",
        attended: "Attended",
        no_show: "No shows",
        draft: "Drafts",
      },

      filters: {
        status: "Status",
        ticket: "Ticket",
        group: "Group",
        dateFrom: "Submitted from",
        dateTo: "Submitted until",
        allTickets: "All tickets",
        allGroups: "All groups",
        noTicket: "Without a ticket",
      },

      columns: {
        person: "Participant",
        email: "E-mail",
        phone: "Phone",
        jobTitle: "Job title",
        company: "Company",
        status: "Status",
        ticket: "Ticket",
        group: "Group",
        answers: "Answers",
        consents: "Consents",
        decision: "Decision",
        waitlistPosition: "Queue position",
        submittedAt: "Submitted",
        source: "Source",
        entryCode: "Entry code",
      },

      capacity: {
        label: "Free seats",
        eventLimitHint:
          "Free seats within the EVENT limit. Every ticket pool has its own counter on the Tickets tab.",
        unlimited: "No limit",
        soldOut: "No free seats",
        ofCapacity: "{{left}} of {{capacity}}",
      },

      entryCode: {
        issued: "Issued",
        notIssued: "Not issued",
        hint: "Only a digest of the code is stored. The plain value appears once, when the registration is approved.",
        copy: "Copy the entry code",
        copied: "Entry code copied",
      },

      consents: {
        dataProcessing: "Data processing",
        marketing: "Marketing communication",
        partnerSharing: "Sharing data with partners",
        withdrawn: "Consents withdrawn",
        given: "Given on {{date}}",
        missing: "None",
        requiredMissing: "{{count}} required consents missing",
        requiredComplete: "All required consents given",
      },

      decision: {
        by: "Decided by",
        at: "When",
        source: "Basis",
        note: "Reason",
        automatic: "No human involved",
        none: "No decision",
      },

      decideDialog: {
        approveTitle: "Approve this application?",
        approveBody:
          "The application will take a seat from the pool and receive an entry code. Pass the code to the participant in a message.",
        rejectTitle: "Reject this application?",
        rejectBody:
          "A reason is required and stays in the application history. The person may submit a new application.",
        waitlistTitle: "Move to the waiting list?",
        waitlistBody:
          "The application goes to the end of the queue and frees the seat it held, if it held one.",
        cancelTitle: "Cancel this registration?",
        cancelBody: "The seat returns to the pool and the first person in the queue is promoted.",
        attendedTitle: "Mark attendance?",
        attendedBody:
          "Attendance is a separate fact from registration and feeds the turnout report.",
        noShowTitle: "Mark as no show?",
        noShowBody:
          "The seat still counts as taken - the participant blocked it, so it does not return to the pool.",
        reasonLabel: "Reason for the decision",
        reasonPlaceholder: "Write down why - the organiser will read this sentence in a dispute",
        noteLabel: "Internal note",
        confirmAction: "Confirm",
        cancelAction: "Cancel",
      },

      addDialog: {
        title: "Add participant",
        subtitle:
          "An organiser entry does not go through the form. Only the seat pool is checked - a seat is physical no matter who assigned it.",
        firstName: "First name",
        lastName: "Last name",
        email: "E-mail address",
        emailHint: "Without an address the person cannot be matched at the next event.",
        phone: "Phone",
        jobTitle: "Job title",
        companyText: "Company name",
        companyId: "Company in the CRM",
        companyIdHint:
          "A company from the CRM register. The typed name stays as what the participant wrote.",
        socialProfileUrl: "Professional profile",
        socialProfileUrlHint: "Full address starting with https://",
        notes: "Note",
        ticket: "Ticket",
        group: "Group",
        status: "Starting status",
        saveAction: "Add",
        cancelAction: "Cancel",
      },

      answersDialog: {
        title: "Form answers",
        empty: "This application has no answers - the event takes one-click registrations.",
        deletedField: "Field removed from the form",
        deletedFieldHint:
          "The question definition was deleted, the answer stays. Deleting the answer together with the question would lose application data.",
      },

      toasts: {
        approved: "Application approved",
        rejected: "Application rejected",
        waitlisted: "Moved to the waiting list",
        cancelled: "Registration cancelled",
        attended: "Attendance recorded",
        noShow: "No show recorded",
        saved: "Participant added",
        promoted: "Promoted {{count}} people from the queue",
        notified: "Marked {{count}} applications as notified",
        notifyFailed: "Decision saved, but the message could not be sent.",
        notifyFailedCount: "Messages that could not be sent: {{count}}",
        exported: "Exported registrations: {{count}}",
        exportTruncated:
          "The file does not contain every registration - narrow the filter and export the rest separately.",
      },
    },

    form: {
      title: "Registration form",
      subtitle:
        "The fields we ask about when someone registers for this event. A qualifying question decides on rejection or approval.",
      loading: "Loading fields…",
      empty: "The form has no field yet. The event will take a one-click registration.",
      addAction: "Add field",
      modeHint:
        "Required fields are checked in form mode only. One-click registration does not show the form.",

      columns: {
        label: "Label",
        key: "Key",
        type: "Field type",
        required: "Required",
        qualifying: "Qualifying",
        answers: "Answers",
        order: "Order",
        active: "Active",
      },

      editor: {
        createTitle: "New form field",
        editTitle: "Edit form field",
        key: "Field key",
        keyHint:
          "Immutable once saved: the answers of submitted applications live under this key. Letters a-z, digits and the underscore.",
        type: "Field type",
        labelPl: "Label (Polish)",
        labelEn: "Label (English)",
        helpPl: "Hint (Polish)",
        helpEn: "Hint (English)",
        helpHint:
          "A sentence under the field. It says what we expect instead of repeating the label.",
        consentUrlPl: "Consent document (Polish)",
        consentUrlEn: "Consent document (English)",
        consentUrlHint:
          "An https:// address with the consent wording. We show it next to the consent field so the participant knows what they agree to.",
        required: "Required field",
        options: "List options",
        optionsHint:
          "The order of options is editorial content - the list shows them in this order.",
        optionValue: "Value",
        optionLabelPl: "Label (Polish)",
        optionLabelEn: "Label (English)",
        addOption: "Add option",
        removeOption: "Remove option",
        sortOrder: "Order",
        active: "Field active",
        qualifying: "Qualifying question",
        qualifyingHint:
          "The rule never reaches the front end. A participant who knows the rule answers to fit it - and then qualification measures knowledge of the rule, not what it was meant to measure.",
        operator: "Condition",
        value: "Condition value",
        valueHint: "One value for “equals”, a list for “is one of”.",
        outcome: "What happens when the condition is met",
        outcomePrecedence:
          "Precedence: rejection beats approval, approval beats immediate approval.",
        saveAction: "Save field",
        cancelAction: "Cancel",
        deleteAction: "Delete field",
        deleteConfirm:
          "Delete the field definition? Submitted answers stay in the applications as a removed field.",
      },

      toasts: {
        saved: "Form field saved",
        deleted: "Form field deleted",
      },
    },

    audienceGrants: {
      title: "Rate eligibility",
      subtitle:
        "Academic, NGO and corporate rates need approval. Record who receives one and on what grounds.",
      addAction: "Grant eligibility",
      empty: "No eligibility has been granted yet.",
      loading: "Loading eligibility…",
      searchLabel: "Search person, company or evidence",
      searchPlaceholder: "Surname, company, student card number…",
      scopeAll: "All events",
      scopeThis: "This event",
      includeRevoked: "Show revoked",
      audienceLabel: "Audience",
      audienceAll: "All audiences",
      audiences: {
        academic: "Academic",
        ngo: "Non-governmental",
        company: "Corporate",
      },
      states: {
        active: "Active",
        scheduled: "Scheduled",
        expired: "Expired",
        revoked: "Revoked",
      },
      columns: {
        holder: "Who",
        audience: "Audience",
        scope: "Scope",
        evidence: "Evidence",
        validity: "Validity",
        state: "State",
        actions: "Actions",
      },
      subjectUser: "User account",
      subjectPerson: "Person in the CRM",
      subjectCompany: "Organisation",
      subjectHint: "Point at exactly one: an account, a person or an organisation.",
      evidenceLabel: "Evidence",
      evidencePlaceholder: "e.g. student card UW no. 123456, company register 0000123456",
      evidenceHint:
        "The evidence stays on the record - it is what explains the lower price at settlement.",
      validUntilLabel: "Valid until",
      validUntilHint: "Empty = no end date.",
      scopeLabel: "Scope",
      scopeHint: "Empty = the grant applies across all events of the organisation.",
      saveAction: "Save grant",
      cancelAction: "Cancel",
      revokeAction: "Revoke",
      revokeConfirm:
        "Revoke the grant? The row stays on the record with a revocation stamp - it is an audit trail.",
      neverExpires: "No end date",
      revokedAt: "Revoked {{date}}",
      toasts: {
        saved: "Eligibility saved",
        revoked: "Eligibility revoked",
      },
      errors: {
        subjectRequired: "Point at an account, a person or an organisation.",
        subjectExclusive: "Point at exactly one subject.",
        evidenceRequired: "Provide the evidence for this grant.",
        forbidden: "You are not allowed to manage rates for this event.",
        unknown: "The operation failed. Refresh the screen and try again.",
      },
    },
    audienceGrantHistory: {
      title: "Eligibility change history",
      subtitle:
        "Who changed what, and when, on reduced rates. The log is read-only - a record you can edit is not an audit trail.",
      openAction: "History",
      dialogTitle: "History of this grant",
      loading: "Loading history…",
      empty: "No recorded changes in this scope.",
      searchLabel: "Search person, company or evidence",
      searchPlaceholder: "Surname, company, e-mail…",
      limitLabel: "Entries",
      actorUnknown: "System change",
      subjectUnknown: "Unnamed subject",
      emptyValue: "empty",
      summary: "{{subject}} · {{audience}} · {{scope}}",
      footnote:
        "Entries come from the shared audit log written by the database on every save, whichever screen the change came through.",
      actions: {
        granted: "Granted",
        updated: "Updated",
        revoked: "Revoked",
        restored: "Restored",
      },
      fields: {
        audience: "Audience",
        evidence: "Evidence",
        valid_from: "Valid from",
        valid_until: "Valid until",
        revoked_at: "Revocation",
        company_id: "Organisation",
        event_id: "Scope",
        user_id: "Account",
        person_id: "Person",
      },
    },
    packages: {
      title: "Group packages",
      subtitle:
        "A package is bought by a single payer (company, university, delegation) and the seats are named later. Every seat turns into a normal registration.",
      loading: "Loading packages…",
      empty: "This event has no group packages. Attendees register one by one.",
      addAction: "Add package",
      audienceLabel: "Audience",
      audiences: {
        public: "Open",
        member: "Members",
        academic: "Academic",
        ngo: "NGO",
        company: "Company",
      },
      seatsLabel: "Seats per package",
      soldLabel: "Packages sold",
      assignedLabel: "Seats assigned",
      unlimitedQuota: "No limit",
      verificationBadge: "Verification required",
      inactiveBadge: "Inactive",
      ticketLabel: "Ticket granted to a seat",
      editAction: "Edit package",
      deleteAction: "Delete package",
      deleteTitle: "Delete the package?",
      deleteDescription:
        "Deletion works only for a package without orders. Deactivate a selling package with the switch instead.",
      deleteConfirm: "Delete",
      cancel: "Cancel",

      editor: {
        createTitle: "New group package",
        editTitle: "Edit package",
        identitySection: "Name and key",
        offerSection: "Offer and price",
        rulesSection: "Sales rules",
        key: "Key",
        keyHint: "Lowercase letters, digits and underscores. Frozen after saving.",
        ticketTypeId: "Ticket granted to a seat",
        ticketHint: "Every package seat receives this ticket once the invitation is accepted.",
        namePl: "Name (Polish)",
        nameEn: "Name (English)",
        descriptionPl: "Description (Polish)",
        descriptionEn: "Description (English)",
        audience: "Package audience",
        seats: "Number of seats",
        seatsHint: "How many people one package purchase covers.",
        priceCents: "Package price (in minor units)",
        currency: "Currency",
        quota: "Limit of packages sold",
        quotaHint: "Empty = no limit.",
        salesFrom: "Sales from",
        salesTo: "Sales to",
        minTierRank: "Membership threshold",
        requiresVerification: "Requires organiser verification",
        active: "Active",
        sortOrder: "Order",
        save: "Save package",
        cancel: "Cancel",
      },

      orders: {
        title: "Package orders",
        subtitle: "Payer, seat pool and payment state.",
        loading: "Loading orders…",
        empty: "No orders for the selected package.",
        addAction: "Add order",
        allPackages: "All packages",
        filterLabel: "Package",
        buyer: "Payer",
        seats: "Seats",
        seatsSummary: "{{assigned}} of {{total}} assigned, {{invited}} invited",
        amount: "Amount",
        status: "State",
        statuses: {
          pending: "Awaiting payment",
          paid: "Paid",
          cancelled: "Cancelled",
          refunded: "Refunded",
        },
        manageSeats: "Manage seats",
        createTitle: "New package order",
        buyerEmail: "Payer e-mail",
        buyerName: "Payer name",
        seatsTotal: "Number of seats",
        seatsTotalHint: "Empty = as many seats as the package gives.",
        amountCents: "Amount (in minor units)",
        amountHint: "Empty = package price unchanged.",
        invoiceNote: "Invoice note",
        save: "Create order",
        cancel: "Cancel",
        toasts: {
          created: "Order created",
          statusChanged: "Order state changed",
        },
      },

      seats: {
        title: "Seats in the order",
        subtitle:
          "An invitation generates a one-time link. The code is shown once - only its hash is stored.",
        loading: "Loading seats…",
        empty: "This order has no seats yet.",
        states: {
          free: "Free",
          invited: "Invited",
          assigned: "Assigned",
          revoked: "Revoked",
        },
        inviteAction: "Invite",
        revokeAction: "Revoke",
        inviteTitle: "Seat invitation",
        inviteEmail: "Invitee e-mail",
        inviteName: "Full name",
        validDays: "Validity (days)",
        send: "Issue invitation",
        cancel: "Close",
        tokenTitle: "Invitation link",
        tokenHint: "Copy it now - this link will not appear again.",
        copyAction: "Copy link",
        expiresAt: "Valid until {{date}}",
        toasts: {
          invited: "Invitation issued",
          revoked: "Seat revoked",
          copied: "Link copied",
        },
      },

      toasts: {
        saved: "Package saved",
        deleted: "Package deleted",
      },
    },

    tickets: {
      title: "Tickets",
      subtitle:
        "Tickets are set per event - there is no global price list. A ticket grants the participant's group.",
      loading: "Loading tickets…",
      empty:
        "This event has no tickets. Registration works without picking one, within the event seat limit.",
      addAction: "Add ticket",

      columns: {
        name: "Name",
        key: "Key",
        price: "Price",
        quota: "Pool",
        sold: "Taken",
        seatsLeft: "Free",
        window: "Sales window",
        tier: "Membership threshold",
        group: "Granted group",
        approval: "Requires approval",
        availability: "Sales state",
        order: "Order",
        pending: "Awaiting",
        waitlist: "Waiting list",
      },

      free: "Free",
      unlimitedQuota: "No limit",
      noWindow: "No time limit",
      windowFrom: "from {{date}}",
      windowTo: "until {{date}}",
      noGroup: "No group granted",
      anyTier: "No threshold",
      earlyBirdBadge: "Early bird until {{date}}",
      accessCodeBadge: "Access code",
      noWaitlistBadge: "No queue",
      effectivePrice: "Price today: {{price}}",

      editor: {
        createTitle: "New ticket",
        editTitle: "Edit ticket",
        key: "Ticket key",
        keyHint: "Immutable once saved. Letters a-z, digits and the underscore.",
        namePl: "Name (Polish)",
        nameEn: "Name (English)",
        descriptionPl: "Description (Polish)",
        descriptionEn: "Description (English)",
        priceCents: "Price",
        priceHint:
          "Price in the smallest currency unit - 15000 means 150.00. Zero means a free pass that still has a pool and a sales window.",
        currency: "Currency",
        quota: "Seat pool",
        quotaHint:
          "Empty means no limit. The event limit and the ticket pool apply at the same time - the smaller one binds.",
        salesFrom: "Sales from",
        salesTo: "Sales until",
        minTierRank: "Membership tier threshold",
        requiresApproval: "Requires the organiser's approval",
        requiresApprovalHint:
          "Raises the approval requirement even on an event with instant registration. It cannot lower it.",
        group: "Group granted on registration",
        groupHint: "Without it the administrator assigns a group by hand for every participant.",
        active: "Ticket active",
        sortOrder: "Order",
        saveAction: "Save ticket",
        cancelAction: "Cancel",
        deleteAction: "Delete ticket",
        deleteConfirm: "Delete the ticket? Only possible while no registration uses it.",
        advancedSection: "Early bird, access code and queue",
        benefitsSection: "What the ticket includes",
        benefitsPl: "Benefits (PL) - one per line",
        benefitsEn: "Benefits (EN) - one per line",
        benefitsHint:
          "Each line is one bullet on the ticket card. Up to {{max}} entries, 200 characters each.",
        phasesSection: "Pricing over time (early bird, regular, last minute)",
        phasesHint:
          'The FIRST phase whose window covers the current moment wins. A phase overrides both the base price and the early bird price; empty dates mean "always" and "open-ended".',
        phasesEmpty: "No phases - the base price (or early bird price) applies.",
        phaseNumber: "Phase {{index}}",
        phaseLabelPl: "Phase name (PL)",
        phaseLabelEn: "Phase name (EN)",
        phaseFrom: "Valid from",
        phaseTo: "Valid until",
        phasePrice: "Price in cents",
        phaseAdd: "Add pricing phase",
        phaseRemove: "Remove phase",
        phaseMoveUp: "Move phase up",
        phaseMoveDown: "Move phase down",
        earlyBirdPriceCents: "Early bird price",
        earlyBirdUntil: "Early bird price valid until",
        earlyBirdHint:
          "Price and date work as a pair. After that date the base price applies - with no manual edit.",
        accessCode: "New access code",
        accessCodeHelp:
          "The code never comes back from the server - only its hash is stored. An empty field keeps the current code.",
        accessCodeSet: "This ticket has an access code",
        accessCodeNone: "This ticket is available without a code",
        removeAccessCode: "Remove the access code on save",
        accessCodeHintLabel: "Hint next to the code field",
        accessCodeHintHelp: "A sentence for the participant, e.g. “the code from the invitation”.",
        waitlistEnabled: "Waiting list once the pool runs out",
        waitlistHint:
          "Turned off means a sold-out message instead of a queue - nobody waits for a seat that will not return.",
      },

      toasts: {
        saved: "Ticket saved",
        deleted: "Ticket deleted",
      },
    },

    groups: {
      title: "Participant groups",
      subtitle:
        "A group hands out permissions within the event: who sees whom, who may ask for a meeting, who chats, who scans leads.",
      loading: "Loading groups…",
      empty: "This event has no groups yet.",
      addAction: "Add group",
      systemBadge: "System group",
      defaultBadge: "Default group",

      columns: {
        name: "Name",
        key: "Key",
        members: "Members",
        primaryMembers: "From registration",
        extraMembers: "Added",
        tickets: "Tickets",
        visibility: "Attendee visibility",
        permissions: "Permissions",
        tier: "Membership threshold",
        order: "Order",
      },

      permissions: {
        canSeeAttendees: "Sees the attendee list",
        canMeet: "May ask for a meeting",
        canChat: "May use the chat",
        canLeadRetrieval: "May scan leads",
        canSeeRecording: "Sees the recording",
        sumHint:
          "A permission across several groups is the sum of abilities - the most permissive wins.",
      },

      editor: {
        createTitle: "New participant group",
        editTitle: "Edit participant group",
        key: "Group key",
        keyHint: "Immutable once saved. Letters a-z, digits and the underscore.",
        namePl: "Name (Polish)",
        nameEn: "Name (English)",
        descriptionPl: "Description (Polish)",
        descriptionEn: "Description (English)",
        color: "Colour",
        colorHint: "Hexadecimal notation, for example #2563eb.",
        visibility: "Attendee visibility scope",
        visibilityHint:
          "The scope only applies while the group sees the attendee list. Without that choice the entry would contradict itself.",
        minTierRank: "Membership tier threshold",
        isDefault: "Default group of the event",
        isDefaultHint:
          "The group assigned to a registration without a ticket. Exactly one per event - setting it here clears the flag on the previous one.",
        sortOrder: "Order",
        saveAction: "Save group",
        cancelAction: "Cancel",
        deleteAction: "Delete group",
        deleteConfirm:
          "Delete the group? Only possible while no registration, ticket or membership uses it.",
      },

      members: {
        title: "Additional membership",
        subtitle:
          "The primary group travels on the registration and the ticket grants it. Here we add extra groups - a speaker who is also an attendee.",
        addAction: "Add to the group",
        removeAction: "Remove from the group",
        empty: "Nobody is added to this group beyond the people from registrations.",
        searchPlaceholder: "Search a person in the directory",
      },

      toasts: {
        saved: "Group saved",
        deleted: "Group deleted",
        memberAdded: "Person added to the group",
        memberRemoved: "Person removed from the group",
      },
    },

    terms: {
      title: "Consents and terms",
      subtitle:
        "This event's consents, with a version. Consent to version one is not consent to version two - raising the version asks participants again.",
      loading: "Loading consents…",
      empty: "This event has no consent or terms document yet.",
      addAction: "Add consent",

      columns: {
        label: "Label",
        key: "Key",
        display: "Where we show it",
        required: "Required",
        version: "Version",
        acceptancesCurrent: "Acceptances of the current version",
        acceptancesTotal: "Acceptances in total",
        withdrawn: "Withdrawn",
        order: "Order",
        active: "Active",
      },

      versionGapHint:
        "The gap between acceptances of the current version and all of them measures the effect of raising the version - that many people must be asked again.",
      optionalHint:
        "An optional consent does not block approval of a registration. If it did, it would be a sham consent.",

      editor: {
        createTitle: "New event consent",
        editTitle: "Edit event consent",
        key: "Consent key",
        keyHint: "Immutable once saved. Letters a-z, digits and the underscore.",
        labelPl: "Label next to the checkbox (Polish)",
        labelEn: "Label next to the checkbox (English)",
        bodyPl: "Body (Polish)",
        bodyEn: "Body (English)",
        externalUrl: "Link to the document",
        externalUrlHint:
          "Full address starting with https://. Enough instead of a body when the document lives elsewhere.",
        display: "Where we show it",
        required: "Consent required",
        version: "Version",
        bumpVersion: "Raise the version",
        bumpVersionHint:
          "Raising it invalidates existing acceptances as current. Fix typos without raising the version.",
        sortOrder: "Order",
        active: "Consent active",
        saveAction: "Save consent",
        cancelAction: "Cancel",
        deleteAction: "Delete consent",
        deleteConfirm:
          "Delete the consent? Only possible while nobody accepted it - an acceptance is evidence.",
      },

      toasts: {
        saved: "Consent saved",
        deleted: "Consent deleted",
      },
    },

    waitlist: {
      title: "Waiting list",
      subtitle:
        "The queue for freed seats. Cancelling a registration promotes the first person in the same second.",
      empty: "The waiting list is empty.",
      position: "Position {{position}}",
      promoteAction: "Promote",
      promoteCountLabel: "How many people to promote",
      promoteOutOfOrder: "Promote out of order",
      promoteOutOfOrderHint:
        "Jumping the queue is recorded as an organiser's decision - somebody will ask about it one day.",
      notifiedAt: "Notified",
      awaitingNotice: "Promoted, not notified yet",
      awaitingNoticeHint:
        "A person without an account gets no in-app notification. After sending the message, mark the application as notified.",
      notNotified: "Not notified",
    },

    publicForm: {
      title: "Register for the event",
      submitAction: "Register me",
      submitting: "Registering…",
      firstName: "First name",
      lastName: "Last name",
      email: "E-mail address",
      phone: "Phone",
      jobTitle: "Job title",
      companyText: "Company",
      socialProfileUrl: "Professional profile",
      ticketLabel: "Pick a ticket",
      requiredMark: "Required field",
      optionalMark: "Optional field",
      consentDataProcessing: "I agree to my data being processed to handle this registration",
      consentDataProcessingHint: "Without this consent the registration cannot be handled.",
      consentMarketing: "I want to hear about upcoming events",
      consentPartnerSharing: "I agree to share my data with the event partners",
      consentPartnerSharingHint:
        "An optional consent. Withholding it does not affect the application.",
      seatsLeft: "Free seats: {{count}}",
      seatsUnlimited: "No seat limit",

      resultApproved: {
        title: "You are registered",
        body: "The entry code went to the address you gave. Show it at the door.",
      },
      resultPending: {
        title: "Application received",
        body: "The organiser will decide and get back to you at the address you gave.",
      },
      resultWaitlist: {
        title: "You are on the waiting list",
        body: "Your position in the queue: {{position}}. We will let you know when a seat frees up.",
      },
      resultRejected: {
        title: "The application was not accepted",
        body: "This event has participation conditions that the application does not meet.",
      },

      manage: {
        title: "Your registration",
        cancelAction: "Withdraw the registration",
        cancelConfirm:
          "Withdraw the registration? The seat returns to the pool and goes to the first person in the queue.",
        cancelled: "Registration withdrawn",
        promotedSomeone: "The freed seat went to the waiting list.",
      },
    },

    errors: {
      rateLimited: "Too many registration attempts from here. Try again in a few minutes.",
      packageKeyPattern: "The key must match ^[a-z][a-z0-9_]{1,48}$",
      packageTicketRequired: "Choose the ticket granted to a package seat.",
      packageNameRequired: "The package name is required in both languages.",
      packageDescriptionTooLong: "The package description is too long.",
      packageSeatsRange: "The number of seats must be between 1 and 1000.",
      packagePriceRange: "The package price is out of range.",
      packageQuotaRange: "The limit of packages sold is out of range.",
      packageTierRange: "The membership threshold must be between 0 and 100.",
      packageSalesWindow: "Sales must end after they start.",
      packageSortRange: "The order must be between 0 and 10000.",
      packageOrderBuyerEmail: "Give a valid payer e-mail address.",
      packageOrderSeats: "The number of seats in the order is out of range.",
      packageOrderAmount: "The order amount is out of range.",
      packageSeatEmail: "Give a valid invitee e-mail address.",
      packageSeatValidDays: "Invitation validity must be between 1 and 90 days.",

      payloadTooLarge: "The application is too large. Shorten the descriptive answers.",
      invalidAnswers: "The answers have an invalid format.",
      invalidName: "First name and last name are required.",
      invalidEmail: "Give a valid e-mail address.",
      invalidSocialUrl: "The profile address must start with https://",
      consentRequired: "Consent to data processing is a condition of handling the registration.",
      missingRequiredFields: "Fill in the required fields: {{fields}}",
      termsRequired: "Accept the required consents: {{terms}}",
      alreadyRegistered: "This person already has an active registration for this event.",
      alreadyClosed: "This registration is already closed.",
      eventFinished: "Attendance is already recorded - the registration cannot be withdrawn.",
      eventCancelled: "The event has been cancelled.",
      registrationDisabled: "This event does not take registrations.",
      registrationExternal: "Registration runs in an external tool.",
      registrationNotOpen: "Registration has not opened yet.",
      membershipRequired: "The event is open to members.",
      ticketRequired: "This event sells tickets - pick one.",
      ticketNotOnSale: "Sales for this ticket have not started.",
      ticketSalesEnded: "Sales for this ticket are closed.",
      ticketTierRequired: "This ticket requires a higher membership tier.",

      forbidden: "This operation is available to the organisation's administrator and editor.",
      notFoundEvent: "The event does not exist in this organisation.",
      notFoundRegistration: "The application does not exist in this organisation.",
      notFoundPerson: "The person does not exist in this organisation's directory.",
      notFoundTicket: "The ticket does not exist for this event.",
      notFoundGroup: "The group does not exist for this event.",
      notFoundField: "The form field does not exist in this organisation.",
      notFoundTerm: "The consent does not exist in this organisation.",
      invalidRequest: "Data required to run this operation is missing.",
      invalidAction: "Unknown action.",
      invalidTransition: "An application in state “{{from}}” cannot go through this operation.",
      invalidStatus: "An organiser entry may start as draft, awaiting, approved or waiting list.",
      reasonRequired: "A rejection reason is required.",
      noSeatsLeft: "No free seat for this ticket. Use the waiting list.",
      quotaBelowSold: "The pool cannot be smaller than the number of taken seats ({{count}}).",
      ticketInUse:
        "The ticket is used by {{count}} registrations - disable it instead of deleting.",
      groupSystem: "System groups cannot be deleted.",
      groupInUse: "The group is used in {{count}} places - move them first.",
      termInUse: "The consent has {{count}} acceptances - disable it instead of deleting.",
      invalidKey: "The key must start with a letter and contain only a-z, 0-9 and the underscore.",
      invalidNames: "The name is required in both languages.",
      invalidLabels: "The label is required in both languages.",
      invalidOptions: "List options must be an array.",
      duplicateKey: "An entry with this key already exists for this event.",
      invalidEarlyBird: "The early bird price needs a date and cannot exceed the base price.",
      invalidAccessCode: "The access code must have 4 to 64 characters.",
      invalidBenefits: "At most 20 benefits, each up to 200 characters.",
      invalidPriceSchedule:
        "Every pricing phase needs a price and a window that ends after it starts.",
      invalidConsentUrl:
        "The consent document address must start with https:// (up to 500 characters).",
      notFound: "The record does not exist in this organisation.",
      packageSoldOut: "The pool of packages of this kind is exhausted.",
      packageInUse: "The package has {{count}} orders - disable it instead of deleting.",
      seatTaken: "This seat is already taken by a participant.",
      seatRevoked: "This seat has been withdrawn.",
      orderCancelled: "The order behind this seat is cancelled.",
      invitationExpired: "The invitation has expired - send it again.",
      invalidToken: "The invitation link is invalid.",
      invalidAudience: "The audience is academic, NGO or company.",
      invalidSubject: "Point at exactly one subject: an account or a person.",
      invalidEvidence: "Provide the evidence for the rate (at least 3 characters).",
      unknown: "The operation failed. Refresh the screen and try again.",
    },
  },
};

i18n.addResourceBundle("pl", "translation", adminEventRegistrationPl, true, true);
i18n.addResourceBundle("en", "translation", adminEventRegistrationEn, true, true);

/**
 * No-op wołany w komponencie trasy zamiast side-effectowego importu modułu.
 * Nazwane wiązanie pozwala splitterowi TanStacka przenieść cały bundle tłumaczeń
 * do chunka trasy - side-effectowy import w pliku trasy landował w eager-owym
 * grafie wejściowym każdej strony. Rejestracja dzieje się przy ewaluacji modułu
 * (przed renderem komponentu), dokładnie jak wcześniej.
 */
export function ensureI18n(): void {}
