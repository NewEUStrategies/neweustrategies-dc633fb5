// Słownik giełdy spotkań biznesowych 1-1 wydarzenia (stoliki, dostępność,
// zaproszenia, potwierdzenia), PL/EN.
//
// DLACZEGO OSOBNY PLIK, A NIE ROZSZERZENIE `i18n-admin-events`. Nakładki i18n są
// niepodzielne: ekran, który chce załadować tylko część słownika, nie ma jak
// tego zrobić. Lista wydarzeń i katalog rodzajów to powierzchnia otwierana raz
// na wydarzenie; giełda spotkań to osobna trasa panelu PLUS osobna powierzchnia
// uczestnika na froncie wydarzenia, z własnym zestawem dialogów, filtrów
// i - przede wszystkim - z pięćdziesięcioma komunikatami błędu, których lista
// wydarzeń nigdy nie zobaczy. Wspólny plik kazałby liście wydarzeń wozić je
// wszystkie.
//
// DWA KORZENIE, BO DWIE PŁASZCZYZNY:
//   * `eventMeetings` - to, co widzi UCZESTNIK: własna dostępność, wolne
//     terminy, zaproszenia, własne spotkania. Tu też mieszkają etykiety wartości
//     słownikowych (stan spotkania, reguła widoczności, strona odwołania), bo
//     czyta je również panel i druga kopia rozjechałaby się przy pierwszej
//     zmianie nazwy stanu.
//   * `adminEventMeetings` - to, co widzi ORGANIZATOR: stoliki, siatka slotów,
//     limity, reguła giełdy, lista spotkań, statystyki, frekwencja.
//
// KAŻDA WARTOŚĆ SŁOWNIKOWA Z MIGRACJI 20260823190000_event_meetings.sql MA TU
// SWOJĄ ETYKIETĘ. Baza zna siedem stanów spotkania (plus dwa stany LICZONE:
// „wygasłe" i „oczekujące"), cztery reguły widoczności giełdy, dwie strony
// zaproszenia, trzy strony odwołania - i tyle samo etykiet stoi poniżej.
//
// KAŻDY BŁĄD, KTÓRY POTRAFI WYRZUCIĆ RPC TEGO MODUŁU, MA TU ZDANIE. To nie jest
// nadmiar: giełda spotkań odmawia z pięćdziesięciu różnych powodów, a różnica
// między „stolik jest zajęty w tym czasie" i „masz już spotkanie w tym czasie"
// decyduje o tym, czy uczestnik spróbuje innej godziny, czy innego stolika.
// Komunikat „Konflikt" zmusiłby go do zgadywania - a zgadywanie kończy się
// pytaniem do organizatora.
//
// TEKST MÓWI, CO SIĘ STANIE, A NIE CO KLIKNĄĆ. „Zaproponuj inny termin" zamiast
// „Przełóż", „Zostały Ci 2 zaproszenia z 5" zamiast „Limit", „Nikt nie
// zadeklarował dostępności - giełda nie zaproponuje żadnego terminu" zamiast
// „Brak danych".
import i18n from "@/lib/i18n";

export const adminEventMeetingsPl = {
  eventMeetings: {
    // ---- wartości słownikowe bazy -------------------------------------------
    statuses: {
      invited: "Zaproszenie wysłane",
      accepted: "Potwierdzone",
      declined: "Odrzucone",
      cancelled: "Odwołane",
      rescheduled: "Przełożone",
      held: "Odbyło się",
      no_show: "Nieobecność",
      // Dwa stany LICZONE z danych, nie zapisane w kolumnie: zaproszenie po
      // terminie ważności i zaproszenie jeszcze w terminie. Baza ich nie
      // przechowuje, bo nie ma procesu, który by je stemplował.
      expired: "Wygasłe",
      pending: "Oczekuje na odpowiedź",
    },
    statusHints: {
      invited: "Druga strona jeszcze nie odpowiedziała.",
      accepted: "Spotkanie potwierdzone przez obie strony.",
      declined: "Druga strona odrzuciła zaproszenie i podała powód.",
      cancelled: "Spotkanie odwołane. Miejsce przy stoliku jest znów wolne.",
      rescheduled: "Ten termin został zamknięty, a na jego miejsce powstało nowe zaproszenie.",
      held: "Spotkanie się odbyło - potwierdzone przez organizatora.",
      no_show: "Jedna ze stron nie przyszła - odnotowane przez organizatora.",
      expired: "Zaproszenie straciło ważność bez odpowiedzi.",
      pending: "Zaproszenie czeka na odpowiedź do wskazanego terminu.",
    },

    visibility: {
      everyone: "Wszyscy do wszystkich",
      groups: "Tylko wybrane grupy",
      sponsors_to_attendees: "Tylko partnerzy do uczestników",
      disabled: "Giełda zamknięta",
    },
    visibilityHints: {
      everyone:
        "Każdy uczestnik, którego grupa pozwala na spotkania, może zaprosić każdego innego.",
      groups:
        "Zaprasza wyłącznie osoba z grupy wskazanej jako zapraszająca, i wyłącznie osobę z grupy wskazanej jako zaproszona.",
      sponsors_to_attendees:
        "Zaprasza wyłącznie przedstawiciel firmy partnerskiej - czyli osoba z grupy, która ma uprawnienie do zbierania kontaktów na stoisku.",
      disabled:
        "Konfiguracja zostaje, ale nikt nie może wysłać zaproszenia. Do zamknięcia giełdy na czas trwania wydarzenia.",
    },

    sides: {
      requester: "Zapraszający",
      invitee: "Zaproszony",
    },
    cancelledBy: {
      requester: "Odwołane przez zapraszającego",
      invitee: "Odwołane przez zaproszonego",
      organiser: "Odwołane przez organizatora",
    },

    // ---- powierzchnia uczestnika --------------------------------------------
    exchange: {
      title: "Spotkania 1-1",
      subtitle: "Umów rozmowę z innym uczestnikiem wydarzenia.",
      notConfigured: "Organizator nie uruchomił jeszcze giełdy spotkań na tym wydarzeniu.",
      disabled: "Giełda spotkań jest na tym wydarzeniu wyłączona.",
      closedByRule: "Organizator zamknął giełdę spotkań.",
      notOpenYet: "Giełda spotkań otwiera się {{opensAt}}.",
      closed: "Giełda spotkań została zamknięta {{closesAt}}.",
      notRegistered: "Giełda spotkań jest dostępna dla osób zapisanych na to wydarzenie.",
      groupCannotMeet: "Twoja grupa uczestników nie bierze udziału w giełdzie spotkań.",
      openNow: "Giełda spotkań jest otwarta",
      slotLength: "Długość spotkania: {{minutes}} min",
      breakLength: "Przerwa między spotkaniami: {{minutes}} min",
      hours: "Godziny giełdy: {{from}} - {{to}}",
      days: "Dni giełdy",
      timezone: "Strefa czasowa: {{timezone}}",
      invitesLeft: "Zostały Ci {{count}} zaproszenia z {{max}}",
      invitesUnlimited: "Liczba zaproszeń nie jest ograniczona",
      dailyLimit: "Najwyżej {{count}} spotkań dziennie",
      dailyUnlimited: "Liczba spotkań dziennie nie jest ograniczona",
      expiryRule: "Zaproszenie traci ważność po {{hours}} godz.",
      incomingPending: "Zaproszenia do Ciebie",
      outgoingPending: "Twoje zaproszenia",
      acceptedCount: "Potwierdzone spotkania",
      heldCount: "Spotkania, które się odbyły",
      loading: "Wczytywanie giełdy spotkań…",
    },

    availability: {
      title: "Twoja dostępność",
      subtitle:
        "Zaproszenie może trafić tylko w okno, które sam zadeklarujesz. Bez ani jednego okna nikt nie zaproponuje Ci terminu.",
      empty: "Nie zadeklarowałeś jeszcze żadnego okna dostępności.",
      addAction: "Dodaj okno dostępności",
      editAction: "Zmień okno",
      deleteAction: "Usuń okno",
      startLabel: "Od",
      endLabel: "Do",
      noteLabel: "Notatka",
      notePlaceholder: "np. jestem przy stoisku firmy",
      openLabel: "Przyjmuję zaproszenia w tym czasie",
      openHint:
        "Okno zamknięte mówi, że jesteś na miejscu, ale w tym czasie nie chcesz dostawać zaproszeń.",
      openBadge: "Otwarte na zaproszenia",
      closedBadge: "Zamknięte na zaproszenia",
      saveAction: "Zapisz okno",
      cancelAction: "Anuluj",
      deleteConfirmTitle: "Usunąć to okno dostępności?",
      deleteConfirmBody:
        "Terminy z tego okna przestaną być proponowane. Spotkań już umówionych to nie odwołuje.",
    },

    slots: {
      title: "Wolne terminy",
      subtitle: "Terminy, w których jesteście dostępni oboje i jest wolne miejsce przy stoliku.",
      empty: "Nie ma ani jednego wspólnego terminu.",
      emptyReasonAvailability:
        "Sprawdź swoją dostępność - być może druga strona ma otwarte inne godziny.",
      emptyReasonTables: "Wszystkie stoliki są zajęte w godzinach, w których jesteście dostępni.",
      emptyReasonDailyLimit: "Osiągnąłeś dzienny limit spotkań w tych dniach.",
      loading: "Szukanie wolnych terminów…",
      tableColumn: "Stolik",
      tableNone: "Bez stolika (spotkanie online)",
      seatLabel: "miejsce {{seat}}",
      pickAction: "Wybierz ten termin",
      hint: "Stolik jest podpowiedzią - przydzielimy go dopiero przy potwierdzeniu.",
    },

    invite: {
      title: "Zaproś na spotkanie",
      subtitleWithName: "Zaproszenie dla {{name}}",
      slotLabel: "Termin",
      topicLabel: "Temat spotkania",
      topicPlaceholder: "np. współpraca przy projekcie infrastrukturalnym",
      sponsorLabel: "Dotyczy oferty partnera",
      sponsorNone: "Nie dotyczy żadnego partnera",
      messageLabel: "Wiadomość",
      messagePlaceholder: "Napisz, po co chcesz się spotkać. Dwa zdania wystarczą.",
      sendAction: "Wyślij zaproszenie",
      cancelAction: "Anuluj",
      expiryNotice: "Zaproszenie straci ważność {{expiresAt}}, jeśli nikt nie odpowie.",
    },

    respond: {
      incomingTitle: "Zaproszenie na spotkanie",
      fromLabel: "Od",
      acceptAction: "Przyjmij",
      declineAction: "Odrzuć",
      declineReasonLabel: "Powód odmowy",
      declineReasonPlaceholder: "np. mam w tym czasie panel dyskusyjny",
      declineReasonHint:
        "Powód widzi wyłącznie osoba, która Cię zaprosiła. Bez niego nie wie, czy spróbować innej godziny.",
      declineConfirmAction: "Odrzuć zaproszenie",
      expiresIn: "Traci ważność {{expiresAt}}",
      expiredNotice: "To zaproszenie straciło ważność.",
      tablePreference: "Stolik",
      tableAuto: "Pierwszy wolny",
      acceptedNotice: "Spotkanie potwierdzone. Stolik {{table}}, miejsce {{seat}}.",
      acceptedNoticeNoTable: "Spotkanie potwierdzone.",
    },

    mine: {
      title: "Moje spotkania",
      empty: "Nie masz jeszcze żadnego spotkania.",
      emptyFiltered: "Żadne spotkanie nie pasuje do tego filtra.",
      loading: "Wczytywanie spotkań…",
      tabs: {
        all: "Wszystkie",
        pending: "Oczekujące",
        accepted: "Potwierdzone",
        held: "Odbyte",
        declined: "Odrzucone",
        cancelled: "Odwołane",
        expired: "Wygasłe",
      },
      counterpartColumn: "Z kim",
      whenColumn: "Kiedy",
      whereColumn: "Gdzie",
      statusColumn: "Stan",
      topicColumn: "Temat",
      cancelAction: "Odwołaj spotkanie",
      rescheduleAction: "Zaproponuj inny termin",
      cancelReasonLabel: "Powód odwołania",
      cancelReasonPlaceholder: "Napisz krótko, dlaczego odwołujesz. Druga strona to zobaczy.",
      cancelConfirmTitle: "Odwołać to spotkanie?",
      cancelConfirmBody: "Druga strona dostanie powiadomienie. Miejsce przy stoliku się zwolni.",
      rescheduleTitle: "Zaproponuj inny termin",
      rescheduleBody:
        "Obecny termin zostanie zamknięty, a druga strona dostanie nowe zaproszenie do przyjęcia.",
      rescheduleAcknowledge: "Rozumiem, że druga strona musi potwierdzić nowy termin",
      declineReasonShown: "Powód odmowy: {{reason}}",
      cancelReasonShown: "Powód odwołania: {{reason}}",
      rescheduledFrom: "Przełożone z terminu {{previous}}",
    },

    toasts: {
      availabilitySaved: "Okno dostępności zapisane",
      availabilityDeleted: "Okno dostępności usunięte",
      invitationSent: "Zaproszenie wysłane",
      invitationAccepted: "Spotkanie potwierdzone",
      invitationDeclined: "Zaproszenie odrzucone",
      meetingCancelled: "Spotkanie odwołane",
      meetingRescheduled: "Nowy termin zaproponowany",
    },

    errors: {
      // Tożsamość i uprawnienie
      forbidden: "Ta operacja wymaga zalogowania.",
      notFound: "Nie znaleziono tego wydarzenia.",
      notRegistered: "Giełda spotkań jest dostępna dla osób zapisanych na to wydarzenie.",
      notAParty: "To nie jest Twoje spotkanie.",
      notInvitee: "Na zaproszenie odpowiada osoba zaproszona, nie zapraszająca.",
      selfInvite: "Nie da się zaprosić samego siebie.",

      // Stan giełdy
      meetingsDisabled: "Giełda spotkań nie jest uruchomiona na tym wydarzeniu.",
      exchangeRuleClosed: "Organizator zamknął giełdę spotkań.",
      exchangeClosed: "Giełda spotkań jest w tej chwili zamknięta na nowe zaproszenia.",

      // Reguła widoczności
      requesterNotParticipating: "Twoje zgłoszenie nie jest jeszcze zatwierdzone.",
      inviteeNotParticipating: "Ta osoba nie jest zatwierdzonym uczestnikiem tego wydarzenia.",
      requesterGroupCannotMeet: "Twoja grupa uczestników nie bierze udziału w giełdzie spotkań.",
      inviteeGroupCannotMeet: "Grupa tej osoby nie bierze udziału w giełdzie spotkań.",
      requesterGroupNotAllowed: "Twoja grupa nie może wysyłać zaproszeń na tym wydarzeniu.",
      inviteeGroupNotAllowed: "Do tej grupy nie można wysyłać zaproszeń na tym wydarzeniu.",
      requesterNotSponsor:
        "Na tym wydarzeniu zaproszenia wysyłają wyłącznie przedstawiciele firm partnerskich.",

      // Termin
      slotNotInGrid: "Ten termin nie należy do siatki spotkań wydarzenia. Wybierz z listy.",
      requesterUnavailable: "Nie masz otwartego okna dostępności w tym czasie.",
      inviteeUnavailable: "Druga strona nie ma otwartego okna dostępności w tym czasie.",
      sameSlot: "To ten sam termin, który już macie.",
      invalidWindow: "Okno dostępności musi trwać od 15 minut do 16 godzin.",
      availabilityOverlap: "To okno nachodzi na inne okno, które już zadeklarowałeś.",
      availabilityHasMeetings:
        "W tym oknie są już spotkania ({{count}}). Najpierw je odwołaj albo zamknij okno na zaproszenia.",

      // Zasób
      noFreeTable: "W tym terminie nie ma wolnego stolika. Wybierz inną godzinę.",
      tableBusy: "Ten stolik został właśnie zajęty. Wybierz inną godzinę.",
      participantBusy: "Jedno z Was ma już spotkanie w tym czasie.",

      // Limity
      inviteLimitReached:
        "Osiągnąłeś limit aktywnych zaproszeń. Poczekaj na odpowiedź albo odwołaj któreś.",
      dailyLimitReached: "Jedno z Was ma już maksymalną liczbę spotkań tego dnia.",
      rateLimited: "Za dużo zaproszeń w krótkim czasie. Spróbuj ponownie za kilka minut.",

      // Cykl życia
      duplicateInvitation: "Macie już aktywne zaproszenie na ten termin.",
      duplicateMeeting: "Ta para ma już spotkanie w tym terminie.",
      invitationNotOpen: "Na to zaproszenie już odpowiedziano.",
      invitationExpired: "To zaproszenie straciło ważność.",
      meetingNotActive: "To spotkanie nie jest już aktywne.",
      declineReasonRequired: "Napisz krótko, dlaczego odrzucasz - co najmniej trzy znaki.",
      invalidDecision: "Można przyjąć albo odrzucić zaproszenie.",
      invalidPayload: "Brakuje wymaganych danych.",
      unknown: "Nie udało się wykonać tej operacji. Spróbuj ponownie.",
    },
  },

  adminEventMeetings: {
    nav: {
      section: "Spotkania 1-1",
      tables: "Stoliki",
      settings: "Siatka i reguły",
      meetings: "Spotkania",
      stats: "Statystyki",
    },

    // ---- stoliki ------------------------------------------------------------
    tables: {
      title: "Stoliki i miejsca spotkań",
      subtitle:
        "Miejsca, przy których odbywają się spotkania. Pojemność mówi, ile spotkań idzie przy tym miejscu równolegle.",
      empty:
        "Nie ma ani jednego stolika. Bez stolika giełda działa tylko dla spotkań online - dla wydarzenia na miejscu dodaj przynajmniej jeden.",
      loading: "Wczytywanie stolików…",
      addAction: "Dodaj stolik",
      editAction: "Edytuj stolik",
      deleteAction: "Usuń stolik",

      labelColumn: "Etykieta",
      zoneColumn: "Strefa",
      capacityColumn: "Pojemność",
      roomColumn: "Sala agendy",
      activeColumn: "Aktywny",
      orderColumn: "Kolejność",
      loadColumn: "Obciążenie",
      nextColumn: "Najbliższe spotkanie",

      labelLabel: "Etykieta",
      labelPlaceholder: "np. Stolik 12",
      labelHint: "Nazwa własna miejsca - taka, jaką uczestnik znajdzie na sali.",
      zoneLabel: "Strefa lub lokalizacja",
      zonePlaceholder: "np. Hala 2, poziom 3",
      capacityLabel: "Spotkań równolegle",
      capacityHint:
        "Stolik dwuosobowy ma pojemność 1. Przestrzeń z szescioma stanowiskami ma pojemność 6.",
      roomLabel: "Sala agendy",
      roomNone: "Bez powiązania z salą",
      roomHint: "Powiąż stolik z salą, gdy giełda dzieje się w tej samej sali co sesje.",
      noteLabel: "Notatka dla obsługi",
      notePlaceholder: "np. wejście od strony parku",
      activeLabel: "Aktywny",
      activeHint:
        "Wyłączony stolik znika z przydziału nowych spotkań, ale nie zabiera stolika spotkaniom już potwierdzonym.",
      orderLabel: "Kolejność",
      orderHint: "Stoliki są przydzielane w tej kolejności - najniższa liczba jako pierwsza.",

      saveAction: "Zapisz stolik",
      cancelAction: "Anuluj",
      deleteConfirmTitle: "Usunąć ten stolik?",
      deleteConfirmBody:
        "Stolik używany przez jakiekolwiek spotkanie - także odwołane albo odbyte - nie da się usunąć. Wtedy właściwą drogą jest wyłączenie go.",
      loadValue: "{{count}} spotkań, {{minutes}} min",
      seatsSummary: "{{tables}} stolików, {{seats}} miejsc równolegle",
    },

    // ---- siatka i reguły ----------------------------------------------------
    settings: {
      title: "Siatka slotów i reguły giełdy",
      subtitle:
        "Siatka decyduje, jakie terminy giełda w ogóle zaproponuje. Reguła decyduje, kto może zaprosić kogo.",
      loading: "Wczytywanie konfiguracji…",
      notConfigured: "Giełda spotkań nie jest jeszcze skonfigurowana na tym wydarzeniu.",

      enabledLabel: "Giełda spotkań włączona",
      enabledHint:
        "Wyłączona giełda nie przyjmuje zaproszeń i nie pokazuje się uczestnikom. Wymaga co najmniej jednego dnia.",

      gridSection: "Siatka slotów",
      slotMinutesLabel: "Długość spotkania (min)",
      slotMinutesHint: "To liczba, którą uczestnik widzi na karcie terminu.",
      breakMinutesLabel: "Przerwa między spotkaniami (min)",
      breakMinutesHint:
        "Osobno od długości spotkania. Krok siatki to suma obu, ale uczestnik widzi tylko długość.",
      dayStartLabel: "Giełda od godziny",
      dayEndLabel: "Giełda do godziny",
      dayHint: "Ostatni slot musi zmieścić się cały przed godziną zamknięcia.",
      daysLabel: "Dni giełdy",
      daysHint:
        "Konkretne dni, nie zakres - kongres trzydniowy z jednym dniem bez giełdy jest normalny.",
      daysEmpty: "Nie wybrano ani jednego dnia.",
      timezoneLabel: "Strefa czasowa giełdy",
      timezoneHint:
        "Godziny giełdy liczą się w tej strefie. Domyślnie taka sama jak strefa wydarzenia.",
      gridPreview: "Siatka daje {{slots}} slotów ({{perDay}} na dzień).",

      windowSection: "Okno przyjmowania zaproszeń",
      opensAtLabel: "Zaproszenia od",
      opensAtHint: "Puste znaczy: od razu.",
      closesAtLabel: "Zaproszenia do",
      closesAtHint: "Puste znaczy: do końca wydarzenia.",

      limitsSection: "Limity",
      maxInvitesLabel: "Aktywnych zaproszeń na osobę",
      maxInvitesHint:
        "Liczy zaproszenia wysłane i jeszcze nierozstrzygnięte plus przyjęte. Puste znaczy bez limitu.",
      maxDailyLabel: "Spotkań na osobę dziennie",
      maxDailyHint:
        "Chroni uczestnika przed dniem bez przerwy, który kończy się serią nieobecności. Puste znaczy bez limitu.",
      expiryHoursLabel: "Zaproszenie traci ważność po (godz.)",
      expiryHoursHint:
        "Wartość jest kopiowana do wysłanego zaproszenia. Zmiana tutaj nie unieważnia zaproszeń już wysłanych.",
      unlimited: "Bez limitu",

      ruleSection: "Kto może zaprosić kogo",
      visibilityLabel: "Reguła giełdy",
      requesterGroupsLabel: "Grupy, które mogą zapraszać",
      inviteeGroupsLabel: "Grupy, które można zaprosić",
      groupsHint: "Ta sama grupa może być po obu stronach - partnerzy zapraszający partnerów.",
      groupCanMeetBadge: "może się umawiać",
      groupCannotMeetBadge: "wyłączona z giełdy",
      groupLeadRetrievalBadge: "strona partnerska",
      groupCannotMeetWarning:
        "Ta grupa ma wyłączone spotkania w ustawieniach grup, więc reguła jej nie obejmie.",

      introSection: "Tekst dla uczestników",
      introPlLabel: "Wprowadzenie (polski)",
      introEnLabel: "Wprowadzenie (angielski)",
      introHint: "Widoczne na ekranie giełdy, nad listą uczestników.",

      readinessSection: "Gotowość giełdy",
      readinessTables: "{{count}} aktywnych stolików",
      readinessSeats: "{{count}} miejsc równolegle",
      readinessParticipants: "{{count}} zatwierdzonych uczestników",
      readinessAvailability: "{{count}} zadeklarowało dostępność",
      readinessNoAvailability:
        "Nikt nie zadeklarował dostępności - giełda nie zaproponuje żadnego terminu.",
      readinessNoTables:
        "Nie ma ani jednego stolika - terminy będą proponowane bez miejsca spotkania.",

      saveAction: "Zapisz konfigurację",
      cancelAction: "Anuluj",
    },

    // ---- lista spotkań ------------------------------------------------------
    list: {
      title: "Spotkania",
      subtitle: "Wszystkie zaproszenia i potwierdzone spotkania tego wydarzenia.",
      loading: "Wczytywanie spotkań…",
      empty: "Na tym wydarzeniu nie ma jeszcze ani jednego spotkania.",
      emptyFiltered: "Żadne spotkanie nie pasuje do tych filtrów.",
      clearFilters: "Wyczyść filtry",
      searchPlaceholder: "Szukaj po nazwisku, firmie albo temacie",
      dayFilter: "Dzień giełdy",
      dayFilterAll: "Wszystkie dni",
      tableFilter: "Stolik",
      tableFilterAll: "Wszystkie stoliki",
      groupFilter: "Grupa uczestników",
      groupFilterAll: "Wszystkie grupy",
      sponsorFilter: "Partner",
      sponsorFilterAll: "Wszyscy partnerzy",

      tabs: {
        all: "Wszystkie",
        pending: "Oczekujące",
        accepted: "Potwierdzone",
        held: "Odbyte",
        no_show: "Nieobecności",
        declined: "Odrzucone",
        cancelled: "Odwołane",
        expired: "Wygasłe",
      },

      requesterColumn: "Zapraszający",
      inviteeColumn: "Zaproszony",
      whenColumn: "Kiedy",
      tableColumn: "Stolik",
      statusColumn: "Stan",
      topicColumn: "Temat",
      sponsorColumn: "Partner",
      decisionColumn: "Decyzja",
      showingRange: "{{from}}-{{to}} z {{total}}",

      arrangeAction: "Umów spotkanie",
      markHeldAction: "Odbyło się",
      markNoShowAction: "Nieobecność",
      cancelAction: "Odwołaj",
      cancelReasonLabel: "Powód odwołania",
      cancelReasonPlaceholder: "Obie strony zobaczą ten powód.",
      cancelConfirmTitle: "Odwołać to spotkanie?",
      cancelConfirmBody: "Obie strony dostaną powiadomienie, a miejsce przy stoliku się zwolni.",
      noTable: "Bez stolika",
      seatLabel: "miejsce {{seat}}",
    },

    // ---- spotkanie umówione przez organizatora ------------------------------
    // Etykiety listy wolnych terminow w dialogu umawiania. Siostrzana sekcja
    // `eventMeetings.slots` obsluguje powierzchnie UCZESTNIKA i ma wlasne
    // napisy - te dwa ekrany celowo nie dziela slownika.
    slots: {
      loading: "Szukanie wolnych terminów…",
      tableNone: "Bez stolika",
    },
    arrange: {
      title: "Umów spotkanie",
      subtitle:
        "Spotkanie powstanie od razu potwierdzone, ze stolikiem. Do zobowiązań z pakietów partnerskich.",
      firstPersonLabel: "Pierwsza osoba",
      secondPersonLabel: "Druga osoba",
      personPlaceholder: "Szukaj po nazwisku albo firmie",
      // Komunikaty WYSZUKIWARKI OSOB. Wczesniej stal tu klucz od szukania
      // terminow, wiec przy wpisywaniu nazwiska panel pisal "Szukanie wolnych
      // terminow…" - napis z zupelnie innego kroku dialogu.
      personsLoading: "Szukanie osób…",
      personsEmpty: "Nikogo takiego nie znaleźliśmy.",
      slotLabel: "Termin",
      slotPlaceholder: "Wybierz z wolnych terminów",
      findSlotsAction: "Pokaż wolne terminy",
      noSlots: "Te dwie osoby nie mają ani jednego wspólnego wolnego terminu.",
      tableLabel: "Stolik",
      tableAuto: "Pierwszy wolny",
      topicLabel: "Temat spotkania",
      messageLabel: "Notatka dla obu stron",
      submitAction: "Umów spotkanie",
      cancelAction: "Anuluj",
      rulesNotice:
        "Reguła widoczności i limit zaproszeń Cię nie ograniczają. Siatka, okna dostępności, kolizje i limit dzienny - tak.",
      availabilityMissing:
        "Ta osoba nie zadeklarowała dostępności. Wpisz jej okno w karcie uczestnika.",
    },

    // ---- dostępność wpisywana przez organizatora ----------------------------
    availability: {
      title: "Dostępność uczestnika",
      subtitle:
        "Dla osób bez konta - one nie mają jak zadeklarować dostępności same, a bez deklaracji nie da się ich umówić.",
      addAction: "Dodaj okno dostępności",
      empty: "Ten uczestnik nie ma zadeklarowanego żadnego okna.",
      participantLabel: "Uczestnik",
      startLabel: "Od",
      endLabel: "Do",
      openLabel: "Przyjmuje zaproszenia",
      noteLabel: "Notatka",
      saveAction: "Zapisz okno",
      deleteAction: "Usuń okno",
      deleteConfirmTitle: "Usunąć to okno dostępności?",
      deleteConfirmBody: "Okno ze spotkaniem w środku nie da się usunąć.",
    },

    // ---- statystyki ---------------------------------------------------------
    stats: {
      title: "Statystyki giełdy",
      subtitle: "Wszystko liczone z danych - każda liczba ma za sobą proces, który ją zapisuje.",
      loading: "Liczenie statystyk…",

      total: "Zaproszeń razem",
      invited: "Oczekuje na odpowiedź",
      expired: "Wygasło bez odpowiedzi",
      accepted: "Potwierdzonych",
      declined: "Odrzuconych",
      cancelled: "Odwołanych",
      rescheduled: "Przełożonych",
      held: "Odbyło się",
      noShow: "Nieobecności",
      confirmed: "Zajętych terminów",
      acceptanceRate: "Wskaźnik akceptacji",
      acceptanceRateHint:
        "Liczony z rozstrzygniętych zaproszeń, nie z wysłanych - zaproszenia jeszcze wiszące nie są ani przyjęte, ani odrzucone.",
      attendanceRate: "Frekwencja",
      attendanceRateHint: "Odbyte kontra odbyte plus nieobecności - z odznaczeń organizatora.",

      gridSlots: "Slotów w siatce",
      seatsCount: "Miejsc przy stolikach",
      participantsCount: "Zatwierdzonych uczestników",
      withAvailabilityCount: "Zadeklarowało dostępność",
      withoutAvailabilityCount: "Bez dostępności",
      withMeetingCount: "Ma co najmniej jedno spotkanie",
      withoutMeetingCount: "Bez ani jednego spotkania",

      tablesSection: "Obciążenie stolików",
      tableUtilisation: "{{taken}} z {{capacity}} slotów",
      tableUtilisationUnknown: "Brak siatki - nie ma czego dzielić",
      byDaySection: "Rozkład po dniach",
      byDayConfirmed: "potwierdzonych",
      byDayInvited: "oczekujących",

      lonelySection: "Uczestnicy bez ani jednego spotkania",
      lonelyHint:
        "To nie jest metryka, to lista osób, do których warto napisać. Pokazujemy do pięćdziesięciu.",
      lonelyEmpty: "Każdy zatwierdzony uczestnik ma co najmniej jedno spotkanie.",
      lonelyHasAvailability: "Zadeklarował dostępność",
      lonelyNoAvailability: "Bez dostępności",
      exportAction: "Eksportuj listę",
    },

    toasts: {
      tableSaved: "Stolik zapisany",
      tableDeleted: "Stolik usunięty",
      settingsSaved: "Konfiguracja giełdy zapisana",
      meetingArranged: "Spotkanie umówione",
      meetingCancelled: "Spotkanie odwołane",
      attendanceHeld: "Odnotowano, że spotkanie się odbyło",
      attendanceNoShow: "Odnotowano nieobecność",
      availabilitySaved: "Okno dostępności zapisane",
      availabilityDeleted: "Okno dostępności usunięte",
    },

    errors: {
      forbidden: "Ten ekran jest dostępny dla administratora i redaktora organizacji.",
      notFound: "Nie znaleziono tego wpisu w Twojej organizacji.",
      invalidPayload: "Brakuje wymaganych danych.",

      invalidLabel: "Etykieta stolika jest wymagana.",
      invalidCapacity: "Pojemność musi być liczbą od 1 do 50.",
      tableLabelTaken: "Stolik o tej etykiecie już istnieje na tym wydarzeniu.",
      tableCapacityInUse:
        "Miejsce {{seat}} jest zajęte - pojemności nie da się obniżyć poniżej tej liczby.",
      tableInUse:
        "Stolik jest używany przez {{count}} spotkań. Zamiast usuwać, wyłącz go - zniknie z przydziału, a historia zostanie.",
      tableNotFound: "Ten stolik nie należy do tego wydarzenia.",
      tableInactive: "Ten stolik jest wyłączony z przydziału nowych spotkań.",
      tableSeatOutOfRange: "Numer miejsca {{seat}} przekracza pojemność stolika ({{capacity}}).",

      invalidTimezone: "Nieznana strefa czasowa: {{timezone}}.",
      invalidVisibility: "Nieznana reguła widoczności giełdy.",
      invalidMeetingDays: "Dni giełdy muszą być listą dat.",
      ruleGroupsRequired:
        "Reguła „tylko wybrane grupy” wymaga co najmniej jednej grupy z każdej strony - z pustymi listami blokuje wszystkich.",
      groupNotFound: "Wskazana grupa nie należy do tego wydarzenia.",
      enabledNeedsDays: "Włączona giełda wymaga co najmniej jednego dnia.",
      dayFitsSlot: "Godziny giełdy muszą zmieścić co najmniej jeden cały slot.",
      dayOrder: "Godzina zamknięcia musi być późniejsza niż godzina otwarcia.",
      slotRange: "Długość spotkania musi być liczbą od 5 do 240 minut.",
      breakRange: "Przerwa musi być liczbą od 0 do 120 minut.",
      daysBounded: "Można wybrać najwyżej 30 dni giełdy.",
      invitesWindow: "Koniec okna zaproszeń musi być późniejszy niż jego początek.",
      expiryRange: "Ważność zaproszenia musi być liczbą od 1 do 720 godzin.",

      meetingsDisabled: "Giełda spotkań nie jest włączona na tym wydarzeniu.",
      requesterNotParticipating: "Pierwsza osoba nie jest zatwierdzonym uczestnikiem.",
      inviteeNotParticipating: "Druga osoba nie jest zatwierdzonym uczestnikiem.",
      selfInvite: "Nie da się umówić spotkania osoby z samą sobą.",
      slotNotInGrid: "Ten termin nie należy do siatki slotów wydarzenia.",
      requesterUnavailable: "Pierwsza osoba nie ma otwartego okna dostępności w tym czasie.",
      inviteeUnavailable: "Druga osoba nie ma otwartego okna dostępności w tym czasie.",
      noFreeTable: "W tym terminie nie ma wolnego miejsca przy żadnym aktywnym stoliku.",
      tableBusy: "Miejsce przy tym stoliku jest już zajęte w tym terminie.",
      participantBusy: "Jedna ze stron ma już spotkanie w tym terminie.",
      duplicateMeeting: "Ta para ma już aktywne spotkanie w tym terminie.",
      dailyLimitReached:
        "Jedna ze stron ma już {{count}} spotkań tego dnia. Podnieś limit dzienny albo wybierz inny dzień.",
      attendanceNeedsAccepted:
        "Frekwencję można odnotować wyłącznie na spotkaniu potwierdzonym przez obie strony.",
      meetingNotActive: "Odwołać można tylko otwarte zaproszenie albo potwierdzone spotkanie.",
      invalidStatus: "Organizator może odnotować: odbyło się, nieobecność albo odwołanie.",
      meetingIdentityImmutable: "Wydarzenia i stron spotkania nie da się zmienić.",
      availabilityHasMeetings:
        "W tym oknie jest {{count}} spotkań. Najpierw je odwołaj albo zamknij okno na zaproszenia.",
      availabilityOverlap: "To okno nachodzi na inne okno tej osoby.",
      invalidWindow: "Okno dostępności musi trwać od 15 minut do 16 godzin.",
      unknown: "Nie udało się wykonać tej operacji. Spróbuj ponownie.",
    },
  },
};

export const adminEventMeetingsEn = {
  eventMeetings: {
    statuses: {
      invited: "Invitation sent",
      accepted: "Confirmed",
      declined: "Declined",
      cancelled: "Cancelled",
      rescheduled: "Rescheduled",
      held: "Took place",
      no_show: "No show",
      expired: "Expired",
      pending: "Awaiting an answer",
    },
    statusHints: {
      invited: "The other side has not answered yet.",
      accepted: "The meeting is confirmed by both sides.",
      declined: "The other side declined and gave a reason.",
      cancelled: "The meeting is cancelled. The seat at the table is free again.",
      rescheduled: "This slot was closed and a new invitation took its place.",
      held: "The meeting took place - confirmed by the organiser.",
      no_show: "One side did not turn up - recorded by the organiser.",
      expired: "The invitation ran out of time without an answer.",
      pending: "The invitation is waiting for an answer until the deadline shown.",
    },

    visibility: {
      everyone: "Everyone to everyone",
      groups: "Selected groups only",
      sponsors_to_attendees: "Partners to attendees only",
      disabled: "Exchange closed",
    },
    visibilityHints: {
      everyone: "Any attendee whose group allows meetings may invite any other such attendee.",
      groups:
        "Only a person from a group marked as requesting may invite, and only a person from a group marked as invitable.",
      sponsors_to_attendees:
        "Only a representative of a partner company may invite - that is, a person in a group allowed to collect leads at the booth.",
      disabled:
        "The configuration stays, but nobody may send an invitation. For closing the exchange during the event.",
    },

    sides: {
      requester: "Requester",
      invitee: "Invitee",
    },
    cancelledBy: {
      requester: "Cancelled by the requester",
      invitee: "Cancelled by the invitee",
      organiser: "Cancelled by the organiser",
    },

    exchange: {
      title: "One-to-one meetings",
      subtitle: "Arrange a conversation with another attendee of this event.",
      notConfigured: "The organiser has not opened the meeting exchange for this event yet.",
      disabled: "The meeting exchange is switched off for this event.",
      closedByRule: "The organiser closed the meeting exchange.",
      notOpenYet: "The meeting exchange opens {{opensAt}}.",
      closed: "The meeting exchange closed {{closesAt}}.",
      notRegistered: "The meeting exchange is open to people registered for this event.",
      groupCannotMeet: "Your attendee group does not take part in the meeting exchange.",
      openNow: "The meeting exchange is open",
      slotLength: "Meeting length: {{minutes}} min",
      breakLength: "Break between meetings: {{minutes}} min",
      hours: "Exchange hours: {{from}} - {{to}}",
      days: "Exchange days",
      timezone: "Time zone: {{timezone}}",
      invitesLeft: "You have {{count}} invitation(s) left out of {{max}}",
      invitesUnlimited: "The number of invitations is not limited",
      dailyLimit: "At most {{count}} meeting(s) per day",
      dailyUnlimited: "The number of meetings per day is not limited",
      expiryRule: "An invitation expires after {{hours}} h.",
      incomingPending: "Invitations to you",
      outgoingPending: "Your invitations",
      acceptedCount: "Confirmed meetings",
      heldCount: "Meetings that took place",
      loading: "Loading the meeting exchange…",
    },

    availability: {
      title: "Your availability",
      subtitle:
        "An invitation can only land in a window you declare yourself. With no window at all nobody can offer you a slot.",
      empty: "You have not declared any availability window yet.",
      addAction: "Add an availability window",
      editAction: "Change the window",
      deleteAction: "Delete the window",
      startLabel: "From",
      endLabel: "To",
      noteLabel: "Note",
      notePlaceholder: "e.g. at the company booth",
      openLabel: "I accept invitations during this time",
      openHint:
        "A closed window says that you are on site but do not want invitations during that time.",
      openBadge: "Open to invitations",
      closedBadge: "Closed to invitations",
      saveAction: "Save the window",
      cancelAction: "Cancel",
      deleteConfirmTitle: "Delete this availability window?",
      deleteConfirmBody:
        "Slots inside it will stop being offered. Meetings already arranged are not cancelled.",
    },

    slots: {
      title: "Free slots",
      subtitle: "Slots where both of you are available and a seat at a table is free.",
      empty: "There is no shared slot at all.",
      emptyReasonAvailability:
        "Check your availability - the other side may have different hours open.",
      emptyReasonTables: "Every table is taken during the hours you are both available.",
      emptyReasonDailyLimit: "You have reached your daily meeting limit on those days.",
      loading: "Looking for free slots…",
      tableColumn: "Table",
      tableNone: "No table (online meeting)",
      seatLabel: "seat {{seat}}",
      pickAction: "Pick this slot",
      hint: "The table is a suggestion - it is assigned only when the meeting is confirmed.",
    },

    invite: {
      title: "Invite to a meeting",
      subtitleWithName: "Invitation for {{name}}",
      slotLabel: "Slot",
      topicLabel: "Meeting topic",
      topicPlaceholder: "e.g. cooperation on an infrastructure project",
      sponsorLabel: "About a partner offer",
      sponsorNone: "Not about any partner",
      messageLabel: "Message",
      messagePlaceholder: "Write why you want to meet. Two sentences are enough.",
      sendAction: "Send the invitation",
      cancelAction: "Cancel",
      expiryNotice: "The invitation expires {{expiresAt}} if nobody answers.",
    },

    respond: {
      incomingTitle: "Meeting invitation",
      fromLabel: "From",
      acceptAction: "Accept",
      declineAction: "Decline",
      declineReasonLabel: "Reason for declining",
      declineReasonPlaceholder: "e.g. I have a panel discussion at that time",
      declineReasonHint:
        "Only the person who invited you sees the reason. Without it they cannot tell whether to try another hour.",
      declineConfirmAction: "Decline the invitation",
      expiresIn: "Expires {{expiresAt}}",
      expiredNotice: "This invitation has expired.",
      tablePreference: "Table",
      tableAuto: "First free one",
      acceptedNotice: "Meeting confirmed. Table {{table}}, seat {{seat}}.",
      acceptedNoticeNoTable: "Meeting confirmed.",
    },

    mine: {
      title: "My meetings",
      empty: "You have no meetings yet.",
      emptyFiltered: "No meeting matches this filter.",
      loading: "Loading meetings…",
      tabs: {
        all: "All",
        pending: "Pending",
        accepted: "Confirmed",
        held: "Took place",
        declined: "Declined",
        cancelled: "Cancelled",
        expired: "Expired",
      },
      counterpartColumn: "With whom",
      whenColumn: "When",
      whereColumn: "Where",
      statusColumn: "Status",
      topicColumn: "Topic",
      cancelAction: "Cancel the meeting",
      rescheduleAction: "Propose another slot",
      cancelReasonLabel: "Reason for cancelling",
      cancelReasonPlaceholder: "Write briefly why you are cancelling. The other side will see it.",
      cancelConfirmTitle: "Cancel this meeting?",
      cancelConfirmBody: "The other side gets a notification. The seat at the table becomes free.",
      rescheduleTitle: "Propose another slot",
      rescheduleBody:
        "The current slot will be closed and the other side will get a new invitation to accept.",
      rescheduleAcknowledge: "I understand the other side has to confirm the new slot",
      declineReasonShown: "Reason for declining: {{reason}}",
      cancelReasonShown: "Reason for cancelling: {{reason}}",
      rescheduledFrom: "Rescheduled from {{previous}}",
    },

    toasts: {
      availabilitySaved: "Availability window saved",
      availabilityDeleted: "Availability window deleted",
      invitationSent: "Invitation sent",
      invitationAccepted: "Meeting confirmed",
      invitationDeclined: "Invitation declined",
      meetingCancelled: "Meeting cancelled",
      meetingRescheduled: "New slot proposed",
    },

    errors: {
      forbidden: "This action requires signing in.",
      notFound: "This event could not be found.",
      notRegistered: "The meeting exchange is open to people registered for this event.",
      notAParty: "This is not your meeting.",
      notInvitee: "An invitation is answered by the invited person, not by the one inviting.",
      selfInvite: "You cannot invite yourself.",

      meetingsDisabled: "The meeting exchange is not running for this event.",
      exchangeRuleClosed: "The organiser closed the meeting exchange.",
      exchangeClosed: "The meeting exchange is closed to new invitations right now.",

      requesterNotParticipating: "Your registration has not been approved yet.",
      inviteeNotParticipating: "This person is not an approved attendee of this event.",
      requesterGroupCannotMeet: "Your attendee group does not take part in the meeting exchange.",
      inviteeGroupCannotMeet: "This person's group does not take part in the meeting exchange.",
      requesterGroupNotAllowed: "Your group may not send invitations at this event.",
      inviteeGroupNotAllowed: "Invitations cannot be sent to this group at this event.",
      requesterNotSponsor:
        "At this event only representatives of partner companies may send invitations.",

      slotNotInGrid: "This slot is not part of the event meeting grid. Pick one from the list.",
      requesterUnavailable: "You have no open availability window at that time.",
      inviteeUnavailable: "The other side has no open availability window at that time.",
      sameSlot: "This is the same slot you already have.",
      invalidWindow: "An availability window must last between 15 minutes and 16 hours.",
      availabilityOverlap: "This window overlaps another window you already declared.",
      availabilityHasMeetings:
        "There are already {{count}} meeting(s) inside this window. Cancel them first, or close the window to invitations.",

      noFreeTable: "No table is free in this slot. Pick another hour.",
      tableBusy: "This table was taken a moment ago. Pick another hour.",
      participantBusy: "One of you already has a meeting at that time.",

      inviteLimitReached:
        "You have reached your limit of active invitations. Wait for an answer or cancel one.",
      dailyLimitReached: "One of you already has the maximum number of meetings that day.",
      rateLimited: "Too many invitations in a short time. Try again in a few minutes.",

      duplicateInvitation: "You already have an active invitation with this person in this slot.",
      duplicateMeeting: "This pair already has a meeting in this slot.",
      invitationNotOpen: "This invitation has already been answered.",
      invitationExpired: "This invitation has expired.",
      meetingNotActive: "This meeting is no longer active.",
      declineReasonRequired: "Write briefly why you are declining - at least three characters.",
      invalidDecision: "An invitation can be accepted or declined.",
      invalidPayload: "Required data is missing.",
      unknown: "This action could not be completed. Try again.",
    },
  },

  adminEventMeetings: {
    nav: {
      section: "One-to-one meetings",
      tables: "Tables",
      settings: "Grid and rules",
      meetings: "Meetings",
      stats: "Statistics",
    },

    tables: {
      title: "Tables and meeting places",
      subtitle:
        "Places where meetings happen. Capacity says how many meetings run at this place in parallel.",
      empty:
        "There is no table at all. Without a table the exchange only works for online meetings - add at least one for an on-site event.",
      loading: "Loading tables…",
      addAction: "Add a table",
      editAction: "Edit the table",
      deleteAction: "Delete the table",

      labelColumn: "Label",
      zoneColumn: "Zone",
      capacityColumn: "Capacity",
      roomColumn: "Agenda room",
      activeColumn: "Active",
      orderColumn: "Order",
      loadColumn: "Load",
      nextColumn: "Next meeting",

      labelLabel: "Label",
      labelPlaceholder: "e.g. Table 12",
      labelHint: "The name of the place itself - the one an attendee will find in the hall.",
      zoneLabel: "Zone or location",
      zonePlaceholder: "e.g. Hall 2, level 3",
      capacityLabel: "Meetings in parallel",
      capacityHint: "A two-seat table has capacity 1. A space with six stations has capacity 6.",
      roomLabel: "Agenda room",
      roomNone: "Not linked to a room",
      roomHint: "Link the table to a room when the exchange happens in the same room as sessions.",
      noteLabel: "Note for the crew",
      notePlaceholder: "e.g. entrance from the park side",
      activeLabel: "Active",
      activeHint:
        "A switched-off table disappears from new assignments but does not take the table away from meetings already confirmed.",
      orderLabel: "Order",
      orderHint: "Tables are assigned in this order - the lowest number first.",

      saveAction: "Save the table",
      cancelAction: "Cancel",
      deleteConfirmTitle: "Delete this table?",
      deleteConfirmBody:
        "A table used by any meeting - including cancelled and past ones - cannot be deleted. Switching it off is the right move then.",
      loadValue: "{{count}} meeting(s), {{minutes}} min",
      seatsSummary: "{{tables}} table(s), {{seats}} parallel seat(s)",
    },

    settings: {
      title: "Slot grid and exchange rules",
      subtitle:
        "The grid decides which slots the exchange offers at all. The rule decides who may invite whom.",
      loading: "Loading the configuration…",
      notConfigured: "The meeting exchange is not configured for this event yet.",

      enabledLabel: "Meeting exchange enabled",
      enabledHint:
        "A disabled exchange takes no invitations and is not shown to attendees. It needs at least one day.",

      gridSection: "Slot grid",
      slotMinutesLabel: "Meeting length (min)",
      slotMinutesHint: "This is the number an attendee sees on the slot card.",
      breakMinutesLabel: "Break between meetings (min)",
      breakMinutesHint:
        "Separate from the meeting length. The grid step is the sum of both, but the attendee only sees the length.",
      dayStartLabel: "Exchange from",
      dayEndLabel: "Exchange until",
      dayHint: "The last slot must fit entirely before the closing time.",
      daysLabel: "Exchange days",
      daysHint:
        "Specific days, not a range - a three-day congress with one day without the exchange is normal.",
      daysEmpty: "No day selected.",
      timezoneLabel: "Exchange time zone",
      timezoneHint:
        "Exchange hours are counted in this zone. By default the same as the event time zone.",
      gridPreview: "The grid gives {{slots}} slot(s) ({{perDay}} per day).",

      windowSection: "Invitation window",
      opensAtLabel: "Invitations from",
      opensAtHint: "Empty means: right away.",
      closesAtLabel: "Invitations until",
      closesAtHint: "Empty means: until the end of the event.",

      limitsSection: "Limits",
      maxInvitesLabel: "Active invitations per person",
      maxInvitesHint:
        "Counts invitations sent and still open plus accepted ones. Empty means no limit.",
      maxDailyLabel: "Meetings per person per day",
      maxDailyHint:
        "Protects an attendee from a day without a break that ends in a run of no-shows. Empty means no limit.",
      expiryHoursLabel: "An invitation expires after (h)",
      expiryHoursHint:
        "The value is copied into the invitation when it is sent. Changing it here does not invalidate invitations already sent.",
      unlimited: "No limit",

      ruleSection: "Who may invite whom",
      visibilityLabel: "Exchange rule",
      requesterGroupsLabel: "Groups that may invite",
      inviteeGroupsLabel: "Groups that may be invited",
      groupsHint: "The same group may sit on both sides - partners inviting partners.",
      groupCanMeetBadge: "may arrange meetings",
      groupCannotMeetBadge: "excluded from the exchange",
      groupLeadRetrievalBadge: "partner side",
      groupCannotMeetWarning:
        "This group has meetings switched off in the group settings, so the rule will not cover it.",

      introSection: "Text for attendees",
      introPlLabel: "Introduction (Polish)",
      introEnLabel: "Introduction (English)",
      introHint: "Shown on the exchange screen, above the attendee list.",

      readinessSection: "Exchange readiness",
      readinessTables: "{{count}} active table(s)",
      readinessSeats: "{{count}} parallel seat(s)",
      readinessParticipants: "{{count}} approved attendee(s)",
      readinessAvailability: "{{count}} declared availability",
      readinessNoAvailability: "Nobody declared availability - the exchange will offer no slot.",
      readinessNoTables:
        "There is no table at all - slots will be offered without a meeting place.",

      saveAction: "Save the configuration",
      cancelAction: "Cancel",
    },

    list: {
      title: "Meetings",
      subtitle: "Every invitation and confirmed meeting of this event.",
      loading: "Loading meetings…",
      empty: "This event has no meetings yet.",
      emptyFiltered: "No meeting matches these filters.",
      clearFilters: "Clear filters",
      searchPlaceholder: "Search by name, company or topic",
      dayFilter: "Exchange day",
      dayFilterAll: "All days",
      tableFilter: "Table",
      tableFilterAll: "All tables",
      groupFilter: "Attendee group",
      groupFilterAll: "All groups",
      sponsorFilter: "Partner",
      sponsorFilterAll: "All partners",

      tabs: {
        all: "All",
        pending: "Pending",
        accepted: "Confirmed",
        held: "Took place",
        no_show: "No shows",
        declined: "Declined",
        cancelled: "Cancelled",
        expired: "Expired",
      },

      requesterColumn: "Requester",
      inviteeColumn: "Invitee",
      whenColumn: "When",
      tableColumn: "Table",
      statusColumn: "Status",
      topicColumn: "Topic",
      sponsorColumn: "Partner",
      decisionColumn: "Decision",
      showingRange: "{{from}}-{{to}} of {{total}}",

      arrangeAction: "Arrange a meeting",
      markHeldAction: "Took place",
      markNoShowAction: "No show",
      cancelAction: "Cancel",
      cancelReasonLabel: "Reason for cancelling",
      cancelReasonPlaceholder: "Both sides will see this reason.",
      cancelConfirmTitle: "Cancel this meeting?",
      cancelConfirmBody: "Both sides get a notification and the seat at the table becomes free.",
      noTable: "No table",
      seatLabel: "seat {{seat}}",
    },

    slots: {
      loading: "Looking for free slots…",
      tableNone: "No table",
    },
    arrange: {
      title: "Arrange a meeting",
      subtitle:
        "The meeting is created already confirmed, with a table. For commitments from partner packages.",
      firstPersonLabel: "First person",
      secondPersonLabel: "Second person",
      personPlaceholder: "Search by name or company",
      personsLoading: "Searching for people…",
      personsEmpty: "We found nobody like that.",
      slotLabel: "Slot",
      slotPlaceholder: "Pick from the free slots",
      findSlotsAction: "Show free slots",
      noSlots: "These two people have no shared free slot at all.",
      tableLabel: "Table",
      tableAuto: "First free one",
      topicLabel: "Meeting topic",
      messageLabel: "Note for both sides",
      submitAction: "Arrange the meeting",
      cancelAction: "Cancel",
      rulesNotice:
        "The visibility rule and the invitation limit do not restrict you. The grid, availability windows, clashes and the daily limit do.",
      availabilityMissing:
        "This person declared no availability. Enter their window on the attendee card.",
    },

    availability: {
      title: "Attendee availability",
      subtitle:
        "For people without an account - they cannot declare availability themselves, and without a declaration they cannot be scheduled.",
      addAction: "Add an availability window",
      empty: "This attendee has no window declared.",
      participantLabel: "Attendee",
      startLabel: "From",
      endLabel: "To",
      openLabel: "Accepts invitations",
      noteLabel: "Note",
      saveAction: "Save the window",
      deleteAction: "Delete the window",
      deleteConfirmTitle: "Delete this availability window?",
      deleteConfirmBody: "A window with a meeting inside it cannot be deleted.",
    },

    stats: {
      title: "Exchange statistics",
      subtitle:
        "Everything counted from data - every number has a process behind it that writes it.",
      loading: "Counting statistics…",

      total: "Invitations in total",
      invited: "Awaiting an answer",
      expired: "Expired without an answer",
      accepted: "Confirmed",
      declined: "Declined",
      cancelled: "Cancelled",
      rescheduled: "Rescheduled",
      held: "Took place",
      noShow: "No shows",
      confirmed: "Booked slots",
      acceptanceRate: "Acceptance rate",
      acceptanceRateHint:
        "Counted from answered invitations, not from sent ones - invitations still open are neither accepted nor declined.",
      attendanceRate: "Attendance rate",
      attendanceRateHint: "Held against held plus no-shows - from the organiser's marks.",

      gridSlots: "Slots in the grid",
      seatsCount: "Seats at tables",
      participantsCount: "Approved attendees",
      withAvailabilityCount: "Declared availability",
      withoutAvailabilityCount: "Without availability",
      withMeetingCount: "Has at least one meeting",
      withoutMeetingCount: "Without a single meeting",

      tablesSection: "Table load",
      tableUtilisation: "{{taken}} of {{capacity}} slots",
      tableUtilisationUnknown: "No grid - nothing to divide by",
      byDaySection: "Distribution by day",
      byDayConfirmed: "confirmed",
      byDayInvited: "pending",

      lonelySection: "Attendees without a single meeting",
      lonelyHint:
        "This is not a metric, it is a list of people worth writing to. We show up to fifty.",
      lonelyEmpty: "Every approved attendee has at least one meeting.",
      lonelyHasAvailability: "Declared availability",
      lonelyNoAvailability: "Without availability",
      exportAction: "Export the list",
    },

    toasts: {
      tableSaved: "Table saved",
      tableDeleted: "Table deleted",
      settingsSaved: "Exchange configuration saved",
      meetingArranged: "Meeting arranged",
      meetingCancelled: "Meeting cancelled",
      attendanceHeld: "Recorded that the meeting took place",
      attendanceNoShow: "Recorded a no show",
      availabilitySaved: "Availability window saved",
      availabilityDeleted: "Availability window deleted",
    },

    errors: {
      forbidden: "This screen is available to the organisation's administrator and editor.",
      notFound: "This entry could not be found in your organisation.",
      invalidPayload: "Required data is missing.",

      invalidLabel: "The table label is required.",
      invalidCapacity: "Capacity must be a number between 1 and 50.",
      tableLabelTaken: "A table with this label already exists in this event.",
      tableCapacityInUse: "Seat {{seat}} is taken - capacity cannot drop below that number.",
      tableInUse:
        "The table is used by {{count}} meeting(s). Switch it off instead of deleting - it leaves the assignment pool and the history stays.",
      tableNotFound: "This table does not belong to this event.",
      tableInactive: "This table is switched off for new meetings.",
      tableSeatOutOfRange: "Seat number {{seat}} exceeds the table capacity ({{capacity}}).",

      invalidTimezone: "Unknown time zone: {{timezone}}.",
      invalidVisibility: "Unknown exchange visibility rule.",
      invalidMeetingDays: "Exchange days must be a list of dates.",
      ruleGroupsRequired:
        "The rule “selected groups only” needs at least one group on each side - with empty lists it blocks everyone.",
      groupNotFound: "The group given does not belong to this event.",
      enabledNeedsDays: "An enabled exchange needs at least one day.",
      dayFitsSlot: "The exchange hours must fit at least one whole slot.",
      dayOrder: "The closing time must be later than the opening time.",
      slotRange: "The meeting length must be a number between 5 and 240 minutes.",
      breakRange: "The break must be a number between 0 and 120 minutes.",
      daysBounded: "At most 30 exchange days can be selected.",
      invitesWindow: "The end of the invitation window must be later than its start.",
      expiryRange: "Invitation validity must be a number between 1 and 720 hours.",

      meetingsDisabled: "The meeting exchange is not enabled for this event.",
      requesterNotParticipating: "The first person is not an approved attendee.",
      inviteeNotParticipating: "The second person is not an approved attendee.",
      selfInvite: "A person cannot be scheduled to meet themselves.",
      slotNotInGrid: "This slot is not part of the event slot grid.",
      requesterUnavailable: "The first person has no open availability window at that time.",
      inviteeUnavailable: "The second person has no open availability window at that time.",
      noFreeTable: "No seat at any active table is free in this slot.",
      tableBusy: "The seat at this table is already taken in this slot.",
      participantBusy: "One of the parties already has a meeting in this slot.",
      duplicateMeeting: "This pair already has an active meeting in this slot.",
      dailyLimitReached:
        "One of the parties already has {{count}} meeting(s) that day. Raise the daily limit or pick another day.",
      attendanceNeedsAccepted:
        "Attendance can only be recorded on a meeting confirmed by both sides.",
      meetingNotActive: "Only an open invitation or a confirmed meeting can be cancelled.",
      invalidStatus: "The organiser may record: took place, no show or cancellation.",
      meetingIdentityImmutable: "The event and both parties of a meeting cannot be changed.",
      availabilityHasMeetings:
        "There are {{count}} meeting(s) inside this window. Cancel them first, or close the window to invitations.",
      availabilityOverlap: "This window overlaps another window of the same person.",
      invalidWindow: "An availability window must last between 15 minutes and 16 hours.",
      unknown: "This action could not be completed. Try again.",
    },
  },
};

i18n.addResourceBundle("pl", "translation", adminEventMeetingsPl, true, true);
i18n.addResourceBundle("en", "translation", adminEventMeetingsEn, true, true);

/**
 * No-op wolany w komponencie trasy zamiast side-effectowego importu modulu.
 * Nazwane wiazanie pozwala splitterowi TanStacka przeniesc caly bundle
 * tlumaczen do chunka trasy - side-effectowy import w pliku trasy landowal
 * w eager-owym grafie wejsciowym kazdej strony. Rejestracja dzieje sie przy
 * ewaluacji modulu (przed renderem komponentu), dokladnie jak wczesniej.
 */
export function ensureI18n(): void {}
