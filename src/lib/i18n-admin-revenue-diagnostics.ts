// i18n huba „Przychód i lejek" - nakładka DIAGNOSTYKI (S7, SPEC §6.7).
//
// Gałęzie: `adminRevenue.checks.<obszar>.<reguła>.{title,description}`
// (każdy `RevenueCheckId`), `adminRevenue.evidence.*` (dowody z faktów,
// liczebniki PL `_one/_few/_many/_other`, EN `_one/_other`), `adminRevenue.fix.*`
// (szkielet `QuickFixDialog`, pola, wartości i każdy `RevenueFixDialogId`),
// `adminRevenue.snooze.*`, `adminRevenue.signal.*` (chip w modułach),
// `adminRevenue.diagnostics.*` (zakładka) i `adminRevenue.attention.*`
// (karta Kokpitu). NIE dublujemy `adminRevenue.area.*` ani
// `adminRevenue.severity.*` - mieszkają w powłoce S6 (`i18n-admin-revenue-shell`).
//
// Prefiks `adminRevenue` jest pod TWARDĄ bramką parytetu: brak klucza albo
// napis identyczny w PL i EN zapala CI. Kody unii (`RevenueCheckId`,
// `RevenueFixDialogId`) mają klucze PL i EN - test w
// `src/lib/revenue/diagnostics/__tests__/i18n.test.ts`.
//
// UWAGA NA ARKUSZ CSS. Pliki `src/lib/i18n-*.ts` skanuje generator arkusza
// PUBLICZNEGO - angielskie napisy omijają słowa będące nazwami klas
// narzędziowych (stąd np. „concealed", „shown", „resolved", „list" zamiast
// potocznych odpowiedników).
//
// IMPORT WYŁĄCZNIE Z KOMPONENTÓW (karta woła `ensureI18n()`).
import i18n from "@/lib/i18n";

const pl = {
  adminRevenue: {
    diagnostics: {
      title: "Diagnostyka przychodu",
      subtitle:
        "Reguły, które pilnują przepływu pieniędzy: od planu i paywalla, przez kasę i retencję, po CRM, ścieżki i jakość danych.",
      factsAt: "Stan na {{time}}",
      refresh: "Sprawdź ponownie",
      loading: "Sprawdzamy reguły…",
      error: "Nie udało się odczytać faktów diagnostyki. Spróbuj ponownie za chwilę.",
      forbidden: "Diagnostykę widzą administratorzy i redaktorzy.",
      unavailable: "Diagnostyka pojawi się po zakończeniu wdrożenia bazy.",
      noTenant: "Wybierz obszar roboczy, aby zobaczyć diagnozy.",
      filtersLabel: "Filtry diagnoz",
      areaFilter: "Obszar",
      allAreas: "Wszystkie obszary",
      severityFilter: "Waga",
      allSeverities: "Wszystkie wagi",
      stateFilter: "Stan",
      viewLabel: "Widok diagnostyki",
      view: {
        list: "Lista diagnoz",
        map: "Mapa systemu",
      },
      state: {
        open: "Otwarte",
        snoozed: "Wyciszone",
        ok: "W porządku",
        unknown: "Nie wiadomo",
        all: "Wszystkie",
      },
      stateBadge: {
        error: "Skutek trwa",
        warn: "Do poprawy",
        unknown: "Nie wiadomo",
        ok: "W porządku",
        snoozed: "Wyciszone",
      },
      summary_one: "{{count}} otwarta diagnoza",
      summary_few: "{{count}} otwarte diagnozy",
      summary_many: "{{count}} otwartych diagnoz",
      summary_other: "{{count}} otwartej diagnozy",
      summaryUnknown_one: "{{count}} reguły nie da się dziś ocenić",
      summaryUnknown_few: "{{count}} reguł nie da się dziś ocenić",
      summaryUnknown_many: "{{count}} reguł nie da się dziś ocenić",
      summaryUnknown_other: "{{count}} reguły nie da się dziś ocenić",
      empty: {
        open: "Nic nie wymaga uwagi. Wszystkie reguły, które da się ocenić, są w porządku.",
        filtered: "Żadna diagnoza nie pasuje do filtrów.",
        clear: "Wyczyść filtry",
      },
      groupHeading: "{{area}} - kondycja {{score}}",
      groupHeadingNoData: "{{area}} - brak danych",
      focusMissing: "Diagnozy z adresu nie ma na liście - mogła już zniknąć.",
      fixGone: "Ten problem już nie występuje - reguła jest dziś w porządku.",
      fixUnknown: "Tej reguły nie da się teraz ocenić, więc naprawa nie jest dostępna.",
      fixNoDialog: "Ta diagnoza nie ma szybkiej naprawy - użyj odnośnika do modułu.",
      card: {
        count: "Liczba: {{value}}",
        evidenceLabel: "Dowody",
        openModule: "Otwórz moduł",
        fix: "Napraw",
        openFix: "Przejdź do naprawy",
        report: "Zgłoś do zespołu",
        reported: "Opis diagnozy z dowodami skopiowany do schowka.",
        reportFailed: "Nie udało się skopiować opisu - zaznacz go ręcznie.",
        reportBody:
          "Diagnoza huba: {{title}} ({{id}}). Stan: {{state}}. Dowody: {{evidence}}. Stan na: {{at}}.",
        snooze: "Wycisz",
        unsnooze: "Przywróć",
        snoozedUntil: "Wyciszone do {{date}}",
        snoozedIntentional: "Wyciszone świadomie: {{reason}}",
        snoozeAdminOnly: "Wyciszać mogą tylko administratorzy.",
        notSnoozable: "Tej reguły nie można wyciszyć - przekłamuje każdą liczbę huba.",
        fixRoleAdmin: "Tę naprawę zapisuje administrator.",
        fixRoleEditor: "Tę naprawę zapisuje administrator albo redaktor.",
        impact: {
          high: "Wpływ: wysoki",
          medium: "Wpływ: średni",
          low: "Wpływ: niski",
        },
        unknownHint: "Brakuje faktów, żeby ocenić regułę - to nie znaczy, że jest w porządku.",
      },
      map: {
        title: "Mapa systemu",
        description:
          "Kto pisze każdy byt, jakie zdarzenia wysyła i które zakładki huba odświeża. Ta sama tabela zasila nagłówki źródeł w naprawach.",
        caption: "Byty huba: pisarze, zdarzenia i zakładki",
        entity: "Byt",
        writers: "Pisarze",
        events: "Zdarzenia",
        tabs: "Zakładki huba",
        owner: "Ekran właściciela",
        systemOnly: "Pisze wyłącznie system",
        none: "-",
        writerKind: {
          mutator: "mutator",
          server_fn: "funkcja serwera",
          webhook: "webhook operatora",
          rpc: "RPC",
          trigger: "wyzwalacz",
        },
        scrollRegion: "Mapa systemu - przewiń w poziomie",
      },
    },
    attention: {
      title: "Wymaga uwagi",
      description: "Najpoważniejsze otwarte diagnozy z Diagnostyki.",
      all: "Wszystkie diagnozy",
      empty: "Nic pilnego - otwarte diagnozy pojawią się tutaj.",
      unknown: "Nie da się teraz ocenić reguł - fakty diagnostyki są niedostępne.",
      loading: "Sprawdzamy reguły…",
    },
    signal: {
      label: "Diagnostyka huba",
      ok: "Diagnostyka: bez otwartych problemów",
      unknown: "Diagnostyka: brak danych",
      open_one: "{{count}} otwarta diagnoza",
      open_few: "{{count}} otwarte diagnozy",
      open_many: "{{count}} otwartych diagnoz",
      open_other: "{{count}} otwartej diagnozy",
      details: "Krytyczne: {{critical}}, ważne: {{warning}}, informacje: {{info}}",
      action: "Zobacz w Diagnostyce",
    },
    snooze: {
      title: "Wycisz diagnozę",
      description:
        "Wyciszona diagnoza nie liczy się do licznika ani kondycji obszaru. Wraca, gdy minie termin albo zmienią się fakty.",
      kind: {
        days: "Na określony czas",
        intentional: "Świadomie - tak ma być",
      },
      days_one: "{{count}} dzień",
      days_few: "{{count}} dni",
      days_many: "{{count}} dni",
      days_other: "{{count}} dnia",
      daysLabel: "Na ile",
      reason: "Powód",
      reasonHint: "Od {{min}} do {{max}} znaków. Zobaczą go inne osoby z zespołu.",
      reasonCount: "{{value}} / {{max}}",
      reasonTooLong: "Powód jest za długi - skróć go do {{max}} znaków.",
      reasonTooShort: "Powód musi mieć co najmniej {{min}} znaki.",
      intentionalHint:
        "Wyciszenie świadome obowiązuje, dopóki fakty się nie zmienią - nowy plan albo inna liczba przywróci diagnozę.",
      confirm: "Wycisz",
      cancel: "Anuluj",
      saved: "Diagnoza wyciszona.",
      removed: "Wyciszenie zdjęte - diagnoza wróciła na listę.",
      forbidden: "Wyciszać mogą tylko administratorzy.",
      unavailable: "Wyciszenia będą dostępne po zakończeniu wdrożenia bazy.",
      invalid: {
        check_id_invalid: "Nieznana reguła.",
        not_snoozable: "Tej reguły nie można wyciszyć.",
        scope_key_invalid: "Nieprawidłowy zakres wyciszenia.",
        kind_invalid: "Nieznany rodzaj wyciszenia.",
        reason_invalid: "Powód musi mieć od 3 do 500 znaków.",
        scope_hash_invalid: "Nieprawidłowy odcisk faktów.",
        until_invalid: "Termin wyciszenia musi być w przyszłości.",
        until_too_far: "Wyciszenie może trwać najwyżej 180 dni.",
        scope_hash_required: "Wyciszenie świadome wymaga odcisku faktów.",
        reason_required: "Wyciszenie świadome wymaga powodu.",
      },
    },
    fix: {
      dialogTitle: "Napraw: {{title}}",
      optionsLabel: "Rozwiązanie",
      previewTitle: "Podgląd zmiany",
      previewCaption: "Pola przed zmianą i po niej",
      field: {
        heading: "Pole",
        before: "Przed",
        after: "Po",
        tier_key: "Warstwa planu",
        active: "Plan aktywny",
        for_sale: "Plan w sprzedaży",
        pricing_visible: "Warstwa w cenniku",
        plan_ids: "Plany reguły dostępu",
        enabled: "Włączone",
        member_monthly_limit: "Darmowe artykuły dla zalogowanych",
        anon_monthly_limit: "Darmowe artykuły dla gości",
        abandon_after_minutes: "Porzucenie kasy po (minuty)",
        status: "Status kampanii",
        assignee_id: "Osoba przypisana do zadań",
        owner_id: "Opiekun leadów",
        double_opt_in: "Potwierdzenie zapisu (double opt-in)",
        sender_email: "Adres nadawcy",
      },
      value: {
        on: "tak",
        off: "nie",
        missing: "brak wiersza ustawień",
        rulePlans_one: "{{count}} reguła z obecnymi planami",
        rulePlans_few: "{{count}} reguły z obecnymi planami",
        rulePlans_many: "{{count}} reguł z obecnymi planami",
        rulePlans_other: "{{count}} reguły z obecnymi planami",
        rulePlansWithoutDead_one: "bez {{count}} wycofanego planu",
        rulePlansWithoutDead_few: "bez {{count}} wycofanych planów",
        rulePlansWithoutDead_many: "bez {{count}} wycofanych planów",
        rulePlansWithoutDead_other: "bez {{count}} wycofanego planu",
        rulePlansWithAssigned: "z wybranym planem w sprzedaży",
        campaign_sent: "wysłana",
        campaign_draft: "szkic",
        campaign_archived: "zarchiwizowana",
        tasksUnassigned_one: "{{count}} zadanie bez osoby",
        tasksUnassigned_few: "{{count}} zadania bez osoby",
        tasksUnassigned_many: "{{count}} zadań bez osoby",
        tasksUnassigned_other: "{{count}} zadania bez osoby",
        tasksToOwners: "właściciele leadów",
        tasksToOwnersAndPerson: "właściciele leadów, pozostałe wybrana osoba",
        noOwner: "bez opiekuna",
        ownerChosen_one: "wybrana osoba dla {{count}} leadu",
        ownerChosen_few: "wybrana osoba dla {{count}} leadów",
        ownerChosen_many: "wybrana osoba dla {{count}} leadów",
        ownerChosen_other: "wybrana osoba dla {{count}} leadu",
        platformSender: "nadawca platformy",
      },
      sourceNote: "Zapis idzie tym samym mutatorem co moduł - ta sama zmiana pojawi się w module.",
      apply: "Zastosuj",
      applying: "Zapisujemy…",
      checking: "Sprawdzamy regułę ponownie…",
      resolved: "✓ Problem zniknął.",
      stillOpen: "! Zapisano, ale problem nadal występuje: {{evidence}}",
      stillUnknown: "Zapisano. Reguły nie da się teraz ocenić - sprawdź ją za chwilę.",
      undo: "Cofnij ({{seconds}} s)",
      undone: "Zmiana cofnięta.",
      undoFailed: "Nie udało się cofnąć zmiany - wróć do modułu i popraw ręcznie.",
      conflictTitle: "Zmienione w innym miejscu",
      conflictBody:
        "Ktoś zapisał ten sam wiersz w innej karcie, zanim zdążyliśmy. Wczytaj aktualny stan i sprawdź podgląd jeszcze raz.",
      conflictReload: "Wczytaj aktualne",
      failed: "Nie udało się zapisać naprawy. Spróbuj ponownie albo popraw w module.",
      close: "Zamknij",
      cancel: "Anuluj",
      roleAdmin:
        "Tę zmianę zapisuje administrator - poproś administratora albo zrób to w module z jego kontem.",
      roleEditor: "Tę zmianę zapisuje administrator albo redaktor.",
      incomplete: "Uzupełnij wybór, żeby zastosować naprawę.",
      noOptions: "Na dziś nie ma czego naprawić - fakty się zmieniły.",
      body: {
        tier: "Warstwa",
        tierPlaceholder: "Wybierz warstwę",
        plan: "Plan w sprzedaży",
        planPlaceholder: "Wybierz plan",
        noPlans: "Brak planów w sprzedaży - najpierw włącz plan w paywallu.",
        staff: "Osoba z zespołu",
        staffPlaceholder: "Wybierz osobę",
        staffLoading: "Wczytujemy zespół…",
        staffEmpty: "Brak osób z rolą administratora albo redaktora.",
        senderEmail: "Adres nadawcy",
        senderEmailHint: "Adres w zweryfikowanej domenie wysyłkowej.",
        senderEmailInvalid: "Podaj poprawny adres - inny niż nadawca platformy.",
        senderName: "Nazwa nadawcy (opcjonalnie)",
        number: "Liczba",
        minutes: "Minuty",
        minutesHint: "Od {{min}} do {{max}} minut.",
        numberHint: "Od {{min}} do {{max}}.",
        numberInvalid: "Wartość spoza zakresu - popraw ją, nie przytniemy jej.",
        impactTitle: "Skutek domyślnego limitu w tym miesiącu",
        impactMembers:
          "Zalogowani: {{blocked}} zablokowanych, {{warning}} blisko limitu z {{total}}",
        impactAnon: "Goście: {{blocked}} zablokowanych z {{total}}",
        impactLoading: "Liczymy skutek…",
        impactUnavailable: "Podglądu skutku nie da się teraz policzyć.",
      },
      plan_tier: {
        title: "Przypnij plan do warstwy",
        description:
          "Plan bez warstwy sprzedaje dostęp do niczego. Wybierz warstwę, którą plan ma nadawać.",
        option: {
          assign_one: "Przypnij {{count}} plan do warstwy",
          assign_few: "Przypnij {{count}} plany do warstwy",
          assign_many: "Przypnij {{count}} planów do warstwy",
          assign_other: "Przypnij {{count}} planu do warstwy",
        },
      },
      plan_deactivate: {
        title: "Dezaktywuj plan bez pary w katalogu",
        description:
          "Kasa odmówi zakupu planu bez ceny w katalogu operatora. Dezaktywacja zdejmuje go z oferty do czasu dodania pary (zmiana w kodzie katalogu).",
        option: {
          deactivate_one: "Dezaktywuj {{count}} plan",
          deactivate_few: "Dezaktywuj {{count}} plany",
          deactivate_many: "Dezaktywuj {{count}} planów",
          deactivate_other: "Dezaktywuj {{count}} planu",
        },
      },
      plan_not_for_sale: {
        title: "Wycofaj plan na zapytanie ze sprzedaży",
        description:
          "Oferty wyceniane indywidualnie nie mogą mieć kasy. Plan zostaje, ale znika ze sprzedaży.",
        option: {
          withdraw_one: "Wycofaj {{count}} plan ze sprzedaży",
          withdraw_few: "Wycofaj {{count}} plany ze sprzedaży",
          withdraw_many: "Wycofaj {{count}} planów ze sprzedaży",
          withdraw_other: "Wycofaj {{count}} planu ze sprzedaży",
        },
      },
      tier_hide: {
        title: "Schowaj warstwę z cennika",
        description:
          "Warstwa bez planu w sprzedaży obiecuje coś, czego nie da się kupić. Schowanie nie zmienia dostępu obecnych członków.",
        option: {
          hide_one: "Schowaj {{count}} warstwę z cennika",
          hide_few: "Schowaj {{count}} warstwy z cennika",
          hide_many: "Schowaj {{count}} warstw z cennika",
          hide_other: "Schowaj {{count}} warstwy z cennika",
        },
      },
      access_rule_plan: {
        title: "Popraw plany reguł dostępu",
        description:
          "Treść płatna musi wskazywać plan, który da się dziś kupić - inaczej czytelnik trafia w ślepy zaułek.",
        option: {
          remove_dead_one: "Usuń wycofane plany z {{count}} reguły",
          remove_dead_few: "Usuń wycofane plany z {{count}} reguł",
          remove_dead_many: "Usuń wycofane plany z {{count}} reguł",
          remove_dead_other: "Usuń wycofane plany z {{count}} reguły",
          assign_one: "Przypisz plan w sprzedaży do {{count}} reguły",
          assign_few: "Przypisz plan w sprzedaży do {{count}} reguł",
          assign_many: "Przypisz plan w sprzedaży do {{count}} reguł",
          assign_other: "Przypisz plan w sprzedaży do {{count}} reguły",
        },
      },
      metering_defaults: {
        title: "Zapisz ustawienia licznika",
        description:
          "Bez wiersza ustawień serwer traktuje licznik jak wyłączony, choć formularz pokazuje wartości domyślne.",
        option: {
          defaults: "Zapisz wartości domyślne ({{members}} artykułów dla zalogowanych)",
        },
      },
      metering_anon_limit: {
        title: "Darmowe artykuły dla gości",
        description:
          "Licznik jest włączony, ale gość nie dostaje ani jednego artykułu. Ustal limit dla gości.",
        option: {
          same_as_members_one: "Tyle co zalogowani ({{count}} artykuł)",
          same_as_members_few: "Tyle co zalogowani ({{count}} artykuły)",
          same_as_members_many: "Tyle co zalogowani ({{count}} artykułów)",
          same_as_members_other: "Tyle co zalogowani ({{count}} artykułu)",
          custom: "Własna liczba",
        },
      },
      checkout_abandon_window: {
        title: "Okno porzucenia kasy",
        description:
          "Domyślnie sesja kasy jest porzucona po dobie - ścieżka porzuconej kasy rusza dopiero następnego dnia. Ustal krótsze okno.",
        option: {
          custom: "Ustaw okno porzucenia",
        },
      },
      campaign_status: {
        title: "Kampania wysłana bez kodów",
        description:
          "Odbiorcy dostali wiadomość bez kodu. Przywróć kampanię do szkicu, żeby wygenerować kody i wysłać ponownie, albo ją zarchiwizuj.",
        option: {
          draft_one: "Przywróć {{count}} kampanię do szkicu",
          draft_few: "Przywróć {{count}} kampanie do szkicu",
          draft_many: "Przywróć {{count}} kampanii do szkicu",
          draft_other: "Przywróć {{count}} kampanii do szkicu",
          archived_one: "Zarchiwizuj {{count}} kampanię",
          archived_few: "Zarchiwizuj {{count}} kampanie",
          archived_many: "Zarchiwizuj {{count}} kampanii",
          archived_other: "Zarchiwizuj {{count}} kampanii",
        },
      },
      retention_enable: {
        title: "Włącz kontrofertę przy anulowaniu",
        description: "Klient anulujący subskrypcję nie dostaje dziś żadnej oferty zatrzymania.",
        option: {
          enable: "Włącz kontrofertę z obecnymi ustawieniami",
          create: "Włącz kontrofertę: {{percent}}% rabatu przez {{periods}} okresy",
        },
      },
      crm_assign_tasks: {
        title: "Przypisz zadania z automatów",
        description: "Zadanie bez osoby nie wysyła przypomnienia - follow-up ginie.",
        option: {
          owners: "Przypisz właścicielom leadów",
          owners_and_fallback: "Przypisz właścicielom, a pozostałe wskazanej osobie",
        },
      },
      crm_assign_owner: {
        title: "Przypisz opiekuna leadom",
        description: "Lead kwalifikowany bez opiekuna nie ma kto prowadzić.",
        option: {
          owner_one: "Przypisz opiekuna {{count}} leadowi",
          owner_few: "Przypisz opiekuna {{count}} leadom",
          owner_many: "Przypisz opiekuna {{count}} leadom",
          owner_other: "Przypisz opiekuna {{count}} leadu",
        },
      },
      newsletter_doi: {
        title: "Włącz potwierdzenie zapisu",
        description:
          "Bez potwierdzenia na listę trafiają literówki i cudze adresy - rośnie ryzyko spamu.",
        option: {
          enable: "Włącz double opt-in dla nowych zapisów",
        },
      },
      newsletter_sender: {
        title: "Ustaw własnego nadawcę",
        description: "Wysyłki z nadawcy platformy lądują w spamie albo nie wychodzą.",
        option: {
          own: "Ustaw adres nadawcy",
        },
      },
      workflow_disable: {
        title: "Wyłącz przepis",
        description:
          "Przepis odpala się tam, gdzie nie powinien, albo dubluje ścieżkę komunikacji.",
        option: {
          disable_one: "Wyłącz {{count}} przepis",
          disable_few: "Wyłącz {{count}} przepisy",
          disable_many: "Wyłącz {{count}} przepisów",
          disable_other: "Wyłącz {{count}} przepisu",
        },
      },
    },
    evidence: {
      planWithoutTier_one: "{{count}} plan bez warstwy (w sprzedaży: {{selling}})",
      planWithoutTier_few: "{{count}} plany bez warstwy (w sprzedaży: {{selling}})",
      planWithoutTier_many: "{{count}} planów bez warstwy (w sprzedaży: {{selling}})",
      planWithoutTier_other: "{{count}} planu bez warstwy (w sprzedaży: {{selling}})",
      planWithoutCatalogPair_one:
        "{{count}} plan bez ceny w katalogu operatora (w sprzedaży: {{selling}})",
      planWithoutCatalogPair_few:
        "{{count}} plany bez ceny w katalogu operatora (w sprzedaży: {{selling}})",
      planWithoutCatalogPair_many:
        "{{count}} planów bez ceny w katalogu operatora (w sprzedaży: {{selling}})",
      planWithoutCatalogPair_other:
        "{{count}} planu bez ceny w katalogu operatora (w sprzedaży: {{selling}})",
      enquiryPlanBuyable_one: "{{count}} plan na zapytanie ma kasę (aktywne: {{active}})",
      enquiryPlanBuyable_few: "{{count}} plany na zapytanie mają kasę (aktywne: {{active}})",
      enquiryPlanBuyable_many: "{{count}} planów na zapytanie ma kasę (aktywne: {{active}})",
      enquiryPlanBuyable_other: "{{count}} planu na zapytanie ma kasę (aktywne: {{active}})",
      promiseBroken_one:
        "{{count}} obietnica w cenniku bez flagi na warstwie (w sprzedaży: {{selling}})",
      promiseBroken_few:
        "{{count}} obietnice w cenniku bez flagi na warstwie (w sprzedaży: {{selling}})",
      promiseBroken_many:
        "{{count}} obietnic w cenniku bez flagi na warstwie (w sprzedaży: {{selling}})",
      promiseBroken_other:
        "{{count}} obietnicy w cenniku bez flagi na warstwie (w sprzedaży: {{selling}})",
      promiseDecorative_one: "{{count}} obietnica bez bramki, która by jej pilnowała",
      promiseDecorative_few: "{{count}} obietnice bez bramki, która by ich pilnowała",
      promiseDecorative_many: "{{count}} obietnic bez bramki, która by ich pilnowała",
      promiseDecorative_other: "{{count}} obietnicy bez bramki, która by jej pilnowała",
      providerPriceDrift:
        "Subskrypcje z kwotą inną niż plan - plany w sprzedaży: {{forSale}}, plany wycofane: {{notForSale}}",
      annualAboveMonthly_one: "{{count}} plan roczny droższy niż 12 miesięcy",
      annualAboveMonthly_few: "{{count}} plany roczne droższe niż 12 miesięcy",
      annualAboveMonthly_many: "{{count}} planów rocznych droższych niż 12 miesięcy",
      annualAboveMonthly_other: "{{count}} planu rocznego droższego niż 12 miesięcy",
      annualBelowMonthly_one: "{{count}} plan roczny tańszy niż jeden miesiąc",
      annualBelowMonthly_few: "{{count}} plany roczne tańsze niż jeden miesiąc",
      annualBelowMonthly_many: "{{count}} planów rocznych tańszych niż jeden miesiąc",
      annualBelowMonthly_other: "{{count}} planu rocznego tańszego niż jeden miesiąc",
      annualNoDiscount_one: "{{count}} plan roczny bez żadnego rabatu",
      annualNoDiscount_few: "{{count}} plany roczne bez żadnego rabatu",
      annualNoDiscount_many: "{{count}} planów rocznych bez żadnego rabatu",
      annualNoDiscount_other: "{{count}} planu rocznego bez żadnego rabatu",
      unknownPrice_one: "{{count}} aktywna subskrypcja z ceną spoza katalogu",
      unknownPrice_few: "{{count}} aktywne subskrypcje z ceną spoza katalogu",
      unknownPrice_many: "{{count}} aktywnych subskrypcji z ceną spoza katalogu",
      unknownPrice_other: "{{count}} aktywnej subskrypcji z ceną spoza katalogu",
      missingAmount_one: "{{count}} subskrypcja bez kwoty od operatora",
      missingAmount_few: "{{count}} subskrypcje bez kwoty od operatora",
      missingAmount_many: "{{count}} subskrypcji bez kwoty od operatora",
      missingAmount_other: "{{count}} subskrypcji bez kwoty od operatora",
      tierBuyButtonWithoutPlan_one: "{{count}} warstwa z przyciskiem zakupu bez planu w sprzedaży",
      tierBuyButtonWithoutPlan_few: "{{count}} warstwy z przyciskiem zakupu bez planu w sprzedaży",
      tierBuyButtonWithoutPlan_many: "{{count}} warstw z przyciskiem zakupu bez planu w sprzedaży",
      tierBuyButtonWithoutPlan_other:
        "{{count}} warstwy z przyciskiem zakupu bez planu w sprzedaży",
      tierShownPlanWithdrawn_one: "{{count}} warstwa w cenniku z planem wycofanym ze sprzedaży",
      tierShownPlanWithdrawn_few: "{{count}} warstwy w cenniku z planem wycofanym ze sprzedaży",
      tierShownPlanWithdrawn_many: "{{count}} warstw w cenniku z planem wycofanym ze sprzedaży",
      tierShownPlanWithdrawn_other: "{{count}} warstwy w cenniku z planem wycofanym ze sprzedaży",
      priceNoticeFailed_one: "{{count}} zmiana ceny bez wysłanego zawiadomienia (błąd wysyłki)",
      priceNoticeFailed_few: "{{count}} zmiany ceny bez wysłanego zawiadomienia (błąd wysyłki)",
      priceNoticeFailed_many: "{{count}} zmian ceny bez wysłanego zawiadomienia (błąd wysyłki)",
      priceNoticeFailed_other: "{{count}} zmiany ceny bez wysłanego zawiadomienia (błąd wysyłki)",
      priceNoticePending_one: "{{count}} zawiadomienie o zmianie ceny czeka dłużej niż dobę",
      priceNoticePending_few: "{{count}} zawiadomienia o zmianie ceny czekają dłużej niż dobę",
      priceNoticePending_many: "{{count}} zawiadomień o zmianie ceny czeka dłużej niż dobę",
      priceNoticePending_other: "{{count}} zawiadomienia o zmianie ceny czeka dłużej niż dobę",
      teamSeatsOver_one: "{{count}} organizacja Zespół ma u operatora więcej niż {{max}} miejsc",
      teamSeatsOver_few: "{{count}} organizacje Zespół mają u operatora więcej niż {{max}} miejsc",
      teamSeatsOver_many: "{{count}} organizacji Zespół ma u operatora więcej niż {{max}} miejsc",
      teamSeatsOver_other: "{{count}} organizacji Zespół ma u operatora więcej niż {{max}} miejsc",
      teamSeatsAtCap_one: "{{count}} organizacja Zespół na limicie {{max}} miejsc",
      teamSeatsAtCap_few: "{{count}} organizacje Zespół na limicie {{max}} miejsc",
      teamSeatsAtCap_many: "{{count}} organizacji Zespół na limicie {{max}} miejsc",
      teamSeatsAtCap_other: "{{count}} organizacji Zespół na limicie {{max}} miejsc",
      paidWithoutOffer_one:
        "{{count}} treść płatna bez oferty do kupienia (z ruchem w 30 dni: {{withHits}})",
      paidWithoutOffer_few:
        "{{count}} treści płatne bez oferty do kupienia (z ruchem w 30 dni: {{withHits}})",
      paidWithoutOffer_many:
        "{{count}} treści płatnych bez oferty do kupienia (z ruchem w 30 dni: {{withHits}})",
      paidWithoutOffer_other:
        "{{count}} treści płatnej bez oferty do kupienia (z ruchem w 30 dni: {{withHits}})",
      ruleInactivePlan_one:
        "{{count}} reguła wskazuje plan wycofany (z ruchem w 30 dni: {{withHits}})",
      ruleInactivePlan_few:
        "{{count}} reguły wskazują plan wycofany (z ruchem w 30 dni: {{withHits}})",
      ruleInactivePlan_many:
        "{{count}} reguł wskazuje plan wycofany (z ruchem w 30 dni: {{withHits}})",
      ruleInactivePlan_other:
        "{{count}} reguły wskazuje plan wycofany (z ruchem w 30 dni: {{withHits}})",
      membersRankNoCta_one:
        "{{count}} treść z progiem warstwy, której nie da się kupić (z ruchem w 30 dni: {{withHits}})",
      membersRankNoCta_few:
        "{{count}} treści z progiem warstwy, której nie da się kupić (z ruchem w 30 dni: {{withHits}})",
      membersRankNoCta_many:
        "{{count}} treści z progiem warstwy, której nie da się kupić (z ruchem w 30 dni: {{withHits}})",
      membersRankNoCta_other:
        "{{count}} treści z progiem warstwy, której nie da się kupić (z ruchem w 30 dni: {{withHits}})",
      paywallNeverMeasured_one:
        "{{count}} reguła płatna od ponad {{days}} dni, a pomiar paywalla nic nie zapisał",
      paywallNeverMeasured_few:
        "{{count}} reguły płatne od ponad {{days}} dni, a pomiar paywalla nic nie zapisał",
      paywallNeverMeasured_many:
        "{{count}} reguł płatnych od ponad {{days}} dni, a pomiar paywalla nic nie zapisał",
      paywallNeverMeasured_other:
        "{{count}} reguły płatnej od ponad {{days}} dni, a pomiar paywalla nic nie zapisał",
      paywallSilent:
        "Ostatnie uderzenie w paywall ponad {{days}} dni temu, choć treści płatnych jest {{count}}",
      meteringRowMissing:
        "Brak wiersza ustawień licznika - serwer traktuje go jak wyłączony (treści objęte licznikiem: {{count}})",
      meteringNobodyFree:
        "Licznik włączony, ale ani gość, ani zalogowany nie dostaje darmowego artykułu",
      meteringAnonZero: "Gość nie dostaje darmowego artykułu (zalogowany: {{members}})",
      meteringRankBypass:
        "Funkcja licznika nie sprawdza rangi czytającego (treści z progiem objęte licznikiem: {{count}})",
      abandonDefault: "Domyślne okno porzucenia kasy: {{minutes}} minut",
      abandonDefaultWithJourney:
        "Domyślne okno porzucenia kasy ({{minutes}} minut) opóźnia ścieżkę porzuconej kasy o dobę",
      currencyMismatchNotice:
        "Cennik {{lang}} pokazuje {{display}}, a plany obciążają w {{charged}} (z dopiskiem pod ofertą)",
      currencyMismatchNoNotice:
        "Cennik {{lang}} pokazuje {{display}}, a plany obciążają w {{charged}} - bez żadnego dopisku",
      campaignSentWithoutCodes:
        "Kampanie wysłane bez kodów - ważne: {{active}}, wygasłe: {{expired}}",
      campaignExpiringUnused_one:
        "{{count}} kampania wygasa w {{days}} dni bez jednego użycia kodu",
      campaignExpiringUnused_few:
        "{{count}} kampanie wygasają w {{days}} dni bez jednego użycia kodu",
      campaignExpiringUnused_many:
        "{{count}} kampanii wygasa w {{days}} dni bez jednego użycia kodu",
      campaignExpiringUnused_other:
        "{{count}} kampanii wygasa w {{days}} dni bez jednego użycia kodu",
      couponsExpiringUnused_one: "{{count}} kod wygasa w {{days}} dni bez użycia",
      couponsExpiringUnused_few: "{{count}} kody wygasają w {{days}} dni bez użycia",
      couponsExpiringUnused_many: "{{count}} kodów wygasa w {{days}} dni bez użycia",
      couponsExpiringUnused_other: "{{count}} kodu wygasa w {{days}} dni bez użycia",
      grantTierColumnMissing:
        "Brak kolumny membership_grants.source_coupon_id - kupony nadające warstwę ({{count}}) jej nie nadadzą",
      retentionMissing: "Kontroferta nie jest skonfigurowana (anulowania w 30 dni: {{count}})",
      retentionDisabled: "Kontroferta jest wyłączona (anulowania w 30 dni: {{count}})",
      cancelWithoutFeedback_one: "{{count}} anulowanie w 30 dni bez żadnego wpisu przepływu",
      cancelWithoutFeedback_few: "{{count}} anulowania w 30 dni bez żadnego wpisu przepływu",
      cancelWithoutFeedback_many: "{{count}} anulowań w 30 dni bez żadnego wpisu przepływu",
      cancelWithoutFeedback_other: "{{count}} anulowania w 30 dni bez żadnego wpisu przepływu",
      cancelProviderOnly_one: "{{count}} anulowanie w portalu operatora z pominięciem przepływu",
      cancelProviderOnly_few: "{{count}} anulowania w portalu operatora z pominięciem przepływu",
      cancelProviderOnly_many: "{{count}} anulowań w portalu operatora z pominięciem przepływu",
      cancelProviderOnly_other: "{{count}} anulowania w portalu operatora z pominięciem przepływu",
      cancelFlowSteps: "Ścieżka anulowania ma {{steps}} kroki (najwyżej {{max}})",
      cancelFlowAbandoned:
        "Porzucone przepływy anulowania: {{abandoned}}, dokończone: {{finished}}",
      offerAcceptedNoDiscount_one: "{{count}} przyjęta oferta bez rabatu na subskrypcji",
      offerAcceptedNoDiscount_few: "{{count}} przyjęte oferty bez rabatu na subskrypcji",
      offerAcceptedNoDiscount_many: "{{count}} przyjętych ofert bez rabatu na subskrypcji",
      offerAcceptedNoDiscount_other: "{{count}} przyjętej oferty bez rabatu na subskrypcji",
      offerSinglePeriod: "Rabat kontroferty obejmuje tylko jeden okres rozliczeniowy",
      b2bPastDueNoTask:
        "Zaległe płatności instytucji: {{count}}, w tym bez zadania CRM: {{withoutTask}}",
      b2bPastDueNoJourney:
        "Zaległe płatności instytucji: {{count}} - z zadaniem, ale bez ścieżki windykacji",
      attributionDead_one: "{{count}} rejestracja w 30 dni - żadna ze źródłem",
      attributionDead_few: "{{count}} rejestracje w 30 dni - żadna ze źródłem",
      attributionDead_many: "{{count}} rejestracji w 30 dni - żadna ze źródłem",
      attributionDead_other: "{{count}} rejestracji w 30 dni - żadna ze źródłem",
      attributionMostlyUnknown: "Rejestracje bez źródła: {{unknown}} z {{total}} w 30 dni",
      popupForMembers:
        "Zapisy z popupu przez posiadaczy kont: {{count}} w 30 dni, w tym {{recent}} w 7 dni",
      autoTasksUnassigned: "Zadania z automatów bez osoby: {{count}}, po terminie: {{overdue}}",
      qualifiedWithoutOwner:
        "Leady kwalifikowane bez opiekuna: {{count}}, w tym szanse sprzedaży: {{opportunity}}",
      leadsWithoutAccount:
        "Leady bez powiązanego konta - zarejestrowani: {{registered}}, klienci: {{customer}}",
      doiOff: "Potwierdzenie zapisu (double opt-in) jest wyłączone",
      doiOffPopupOn: "Potwierdzenie zapisu jest wyłączone, a popup zbiera adresy",
      defaultSender: "Nadawca platformy zamiast własnego (wysyłki w 30 dni: {{count}})",
      newsletterConfirmedNoop:
        "Przebiegi „udane” bez kroków: {{count}} w 30 dni, w tym {{recent}} w 7 dni",
      cancelRecipeUnguarded: "Przepis anulowania odpala się także przy pauzie subskrypcji",
      cancelRecipeFiredOnPause_one: "{{count}} zadanie win-back utworzone przy pauzie i anulowane",
      cancelRecipeFiredOnPause_few: "{{count}} zadania win-back utworzone przy pauzie i anulowane",
      cancelRecipeFiredOnPause_many:
        "{{count}} zadań win-back utworzonych przy pauzie i anulowanych",
      cancelRecipeFiredOnPause_other:
        "{{count}} zadania win-back utworzonego przy pauzie i anulowanego",
      workflowReplacedByJourney_one:
        "{{count}} przepis zastąpiony przez aktywną ścieżkę nadal działa",
      workflowReplacedByJourney_few:
        "{{count}} przepisy zastąpione przez aktywne ścieżki nadal działają",
      workflowReplacedByJourney_many:
        "{{count}} przepisów zastąpionych przez aktywne ścieżki nadal działa",
      workflowReplacedByJourney_other:
        "{{count}} przepisu zastąpionego przez aktywną ścieżkę nadal działa",
      workflowSharesTrigger_one: "{{count}} para przepis-ścieżka na tym samym zdarzeniu",
      workflowSharesTrigger_few: "{{count}} pary przepis-ścieżka na tym samym zdarzeniu",
      workflowSharesTrigger_many: "{{count}} par przepis-ścieżka na tym samym zdarzeniu",
      workflowSharesTrigger_other: "{{count}} pary przepis-ścieżka na tym samym zdarzeniu",
      journeysCoreMissing_one: "Brakuje {{count}} ścieżki rdzenia (powitanie, porzucona kasa)",
      journeysCoreMissing_few: "Brakuje {{count}} ścieżek rdzenia (powitanie, porzucona kasa)",
      journeysCoreMissing_many: "Brakuje {{count}} ścieżek rdzenia (powitanie, porzucona kasa)",
      journeysCoreMissing_other: "Brakuje {{count}} ścieżki rdzenia (powitanie, porzucona kasa)",
      journeysExtendedMissing_one: "Brakuje {{count}} ścieżki rozszerzonego rdzenia",
      journeysExtendedMissing_few: "Brakuje {{count}} ścieżek rozszerzonego rdzenia",
      journeysExtendedMissing_many: "Brakuje {{count}} ścieżek rozszerzonego rdzenia",
      journeysExtendedMissing_other: "Brakuje {{count}} ścieżki rozszerzonego rdzenia",
      engineOffWithActive:
        "Silnik ścieżek wyłączony przy aktywnych ścieżkach: {{count}}, zdarzenia w kolejce: {{pending}}",
      stepFailures: "Nieudane kroki w 24 h: {{count}} z {{total}} ({{percent}}%)",
      inboxBacklog:
        "Zdarzenia czekające w skrzynce ścieżek: {{count}}, najstarsze od {{minutes}} min",
      deadSteps: "Kroki bez ani jednego przejścia: {{count}} w {{journeys}} ścieżkach",
      deadJourneys:
        "Ścieżki z zapisami bez żadnego wykonanego kroku: {{journeys}} (kroki: {{count}})",
      triggerCycleBounded_one: "{{count}} cykl wyzwalaczy (każdy kontakt przejdzie go raz)",
      triggerCycleBounded_few: "{{count}} cykle wyzwalaczy (każdy kontakt przejdzie je raz)",
      triggerCycleBounded_many: "{{count}} cykli wyzwalaczy (każdy kontakt przejdzie je raz)",
      triggerCycleBounded_other: "{{count}} cyklu wyzwalaczy (każdy kontakt przejdzie go raz)",
      triggerCycleUnbounded_one:
        "{{count}} cykl wyzwalaczy z ponownym wejściem - kontakt może krążyć",
      triggerCycleUnbounded_few:
        "{{count}} cykle wyzwalaczy z ponownym wejściem - kontakt może krążyć",
      triggerCycleUnbounded_many:
        "{{count}} cykli wyzwalaczy z ponownym wejściem - kontakt może krążyć",
      triggerCycleUnbounded_other:
        "{{count}} cyklu wyzwalaczy z ponownym wejściem - kontakt może krążyć",
      ticketClaimsUnused:
        "Bilety z planu odebrane i niewykorzystane: {{count}} z {{total}} (90 dni)",
      eventsWithoutNurture:
        "Nadchodzące wydarzenia bez ścieżki dla zapisanych: {{count}}, w tym w ciągu tygodnia: {{soon}}",
      clubRankImpossible_one:
        "{{count}} klub z progiem rangi, którego nie ma żadna aktywna warstwa",
      clubRankImpossible_few:
        "{{count}} kluby z progiem rangi, którego nie ma żadna aktywna warstwa",
      clubRankImpossible_many:
        "{{count}} klubów z progiem rangi, którego nie ma żadna aktywna warstwa",
      clubRankImpossible_other:
        "{{count}} klubu z progiem rangi, którego nie ma żadna aktywna warstwa",
      clubRankNotOfferable_one:
        "{{count}} klub z progiem rangi tylko w warstwach, których nie da się kupić",
      clubRankNotOfferable_few:
        "{{count}} kluby z progiem rangi tylko w warstwach, których nie da się kupić",
      clubRankNotOfferable_many:
        "{{count}} klubów z progiem rangi tylko w warstwach, których nie da się kupić",
      clubRankNotOfferable_other:
        "{{count}} klubu z progiem rangi tylko w warstwach, których nie da się kupić",
      clubApplicationsWaiting_one: "{{count}} wniosek do klubu czeka dłużej niż {{days}} dni",
      clubApplicationsWaiting_few: "{{count}} wnioski do klubów czekają dłużej niż {{days}} dni",
      clubApplicationsWaiting_many: "{{count}} wniosków do klubów czeka dłużej niż {{days}} dni",
      clubApplicationsWaiting_other: "{{count}} wniosku do klubu czeka dłużej niż {{days}} dni",
      clubApplicationsStale_one: "{{count}} wniosek do klubu bez decyzji od ponad {{days}} dni",
      clubApplicationsStale_few: "{{count}} wnioski do klubów bez decyzji od ponad {{days}} dni",
      clubApplicationsStale_many: "{{count}} wniosków do klubów bez decyzji od ponad {{days}} dni",
      clubApplicationsStale_other: "{{count}} wniosku do klubu bez decyzji od ponad {{days}} dni",
      emitterSilent:
        "Emitery zdarzeń, które ucichły na tydzień: {{count}}, w tym codzienne: {{daily}}",
      eventTypesUnknown_one: "{{count}} typ zdarzenia w bazie spoza katalogu szyny",
      eventTypesUnknown_few: "{{count}} typy zdarzeń w bazie spoza katalogu szyny",
      eventTypesUnknown_many: "{{count}} typów zdarzeń w bazie spoza katalogu szyny",
      eventTypesUnknown_other: "{{count}} typu zdarzeń w bazie spoza katalogu szyny",
      eventTypesDead_one: "{{count}} typ z katalogu bez zdarzenia w 90 dni",
      eventTypesDead_few: "{{count}} typy z katalogu bez zdarzenia w 90 dni",
      eventTypesDead_many: "{{count}} typów z katalogu bez zdarzenia w 90 dni",
      eventTypesDead_other: "{{count}} typu z katalogu bez zdarzenia w 90 dni",
      emitErrors24h_one: "{{count}} błąd emitera zdarzeń w ostatniej dobie",
      emitErrors24h_few: "{{count}} błędy emitera zdarzeń w ostatniej dobie",
      emitErrors24h_many: "{{count}} błędów emitera zdarzeń w ostatniej dobie",
      emitErrors24h_other: "{{count}} błędu emitera zdarzeń w ostatniej dobie",
      emitErrors7d_one: "{{count}} błąd emitera w 7 dni (żadnego w ostatniej dobie)",
      emitErrors7d_few: "{{count}} błędy emitera w 7 dni (żadnego w ostatniej dobie)",
      emitErrors7d_many: "{{count}} błędów emitera w 7 dni (żadnego w ostatniej dobie)",
      emitErrors7d_other: "{{count}} błędu emitera w 7 dni (żadnego w ostatniej dobie)",
      documentsEnvUnknown:
        "Dokumenty rozliczeniowe bez środowiska: {{count}}, w tym z 30 dni: {{recent}}",
      mrrCatalogBasis: "{{percent}}% MRR liczone z ceny katalogowej, nie z kwoty od operatora",
      ledgerDrift:
        "Migawka MRR różni się od księgi o {{percent}}% (tolerancja {{tolerance}}%) - waluty: {{currencies}}",
      benchmarkStale: "Źródła benchmarków starsze niż 18 miesięcy: {{count}} z {{total}}",
      sandboxOnly_one: "Tylko {{count}} subskrypcja z piaskownicy, zero produkcyjnych",
      sandboxOnly_few: "Tylko {{count}} subskrypcje z piaskownicy, zero produkcyjnych",
      sandboxOnly_many: "Tylko {{count}} subskrypcji z piaskownicy, zero produkcyjnych",
      sandboxOnly_other: "Tylko {{count}} subskrypcji z piaskownicy, zero produkcyjnych",
      sandboxActive_one:
        "{{count}} subskrypcja z piaskownicy w ostatnim tygodniu, zero produkcyjnych",
      sandboxActive_few:
        "{{count}} subskrypcje z piaskownicy w ostatnim tygodniu, zero produkcyjnych",
      sandboxActive_many:
        "{{count}} subskrypcji z piaskownicy w ostatnim tygodniu, zero produkcyjnych",
      sandboxActive_other:
        "{{count}} subskrypcji z piaskownicy w ostatnim tygodniu, zero produkcyjnych",
    },
    checks: {
      catalog: {
        plan_without_tier: {
          title: "Plan bez warstwy",
          description: "Plan nie jest przypięty do żadnej warstwy - zakup nie nadaje dostępu.",
        },
        plan_without_catalog_pair: {
          title: "Plan bez ceny w katalogu operatora",
          description: "Kasa odmówi zakupu planu, którego cyklu i warstwy nie ma w katalogu cen.",
        },
        enquiry_plan_buyable: {
          title: "Oferta na zapytanie do kupienia (regresja P05)",
          description:
            "Plan wyceniany indywidualnie (Decision Lab) jest w sprzedaży i da się go kupić z adresu.",
        },
        promise_without_gate: {
          title: "Obietnica w cenniku bez bramki (P20)",
          description:
            "Karta cennika obiecuje uprawnienie, którego warstwa nie ma albo którego nic nie egzekwuje.",
        },
        provider_price_drift: {
          title: "Cena u operatora inna niż w planie",
          description:
            "Subskrypcje płacą kwotę inną niż plan tej warstwy i cyklu w tej samej walucie.",
        },
        annual_discount_out_of_range: {
          title: "Cena roczna poza sensownym zakresem",
          description:
            "Plan roczny kosztuje tyle co 12 miesięcy albo więcej, albo mniej niż jeden miesiąc.",
        },
        subscription_unknown_price: {
          title: "Subskrypcja z nieznaną ceną",
          description:
            "Cena subskrypcji jest spoza katalogu albo operator nie podał kwoty - MRR nie ma podstawy.",
        },
        not_for_sale_still_visible: {
          title: "Warstwa w cenniku bez planu w sprzedaży",
          description: "Cennik pokazuje warstwę, której dziś nie da się kupić.",
        },
        price_change_without_notice: {
          title: "Zmiana ceny bez zawiadomienia (P07)",
          description:
            "Przeniesienie ceny weszło u operatora, a mail z zawiadomieniem nie wyszedł.",
        },
        team_seats_over_cap: {
          title: "Zespół ponad limit miejsc",
          description:
            "Subskrypcja organizacji Zespół ma u operatora więcej miejsc, niż pozwala warstwa.",
        },
      },
      paywall: {
        paid_without_buyable_plan: {
          title: "Treść płatna bez oferty do kupienia",
          description: "Czytelnik trafia na paywall, który nie proponuje niczego do kupienia.",
        },
        rule_inactive_plan: {
          title: "Reguła dostępu wskazuje plan wycofany",
          description: "Reguła treści odsyła do planu nieaktywnego albo spoza sprzedaży.",
        },
        members_rank_no_cta: {
          title: "Próg warstwy bez przycisku zakupu (regresja P14)",
          description:
            "Treść dla członków wymaga warstwy, której nie da się kupić - zalogowany nie ma wyjścia.",
        },
        measurement_silent: {
          title: "Pomiar paywalla milczy (P18)",
          description: "Są treści płatne, a pomiar uderzeń w paywall niczego nie zapisuje.",
        },
      },
      metering: {
        settings_row_missing: {
          title: "Brak ustawień licznika",
          description:
            "Bez wiersza ustawień serwer traktuje licznik darmowych artykułów jak wyłączony.",
        },
        anon_zero_limit: {
          title: "Goście bez darmowych artykułów",
          description: "Licznik jest włączony, ale gość nie dostaje ani jednego artykułu.",
        },
        rank_bypass: {
          title: "Licznik omija próg warstwy (regresja P19)",
          description: "Licznik wydaje treść z progiem rangi każdemu, kto ma wolny artykuł.",
        },
      },
      checkout: {
        abandon_window_default: {
          title: "Domyślne okno porzucenia kasy",
          description:
            "Porzucona kasa jest liczona po dobie - kontakt po porzuceniu przychodzi za późno.",
        },
        display_currency_mismatch: {
          title: "Waluta cennika inna niż waluta płatności (P09)",
          description: "Cennik pokazuje jedną walutę, a plan obciąża w innej.",
        },
      },
      coupons: {
        campaign_sent_without_codes: {
          title: "Kampania wysłana bez kodów",
          description: "Kampania jest oznaczona jako wysłana, a nie ma ani jednego kodu.",
        },
        expiring_unused: {
          title: "Kody wygasają bez użycia",
          description: "Kody kuponów wygasają w ciągu dwóch tygodni, a nikt ich nie użył.",
        },
        grant_tier_broken: {
          title: "Kupon nie nada warstwy (P03)",
          description: "Na bazie brakuje migracji, z której korzysta kupon nadający warstwę.",
        },
      },
      retention: {
        not_configured: {
          title: "Kontroferta wyłączona",
          description: "Klient anulujący subskrypcję nie dostaje oferty zatrzymania.",
        },
        provider_cancel_bypasses_flow: {
          title: "Anulowanie z pominięciem przepływu (regresja P01)",
          description: "Subskrypcje kończą się bez przepływu anulowania i bez powodu odejścia.",
        },
        cancel_flow_too_long: {
          title: "Za długa ścieżka anulowania",
          description:
            "Ścieżka anulowania ma więcej niż dwa kroki albo większość klientów ją porzuca.",
        },
        offer_once_discount: {
          title: "Rabat kontroferty bez skutku (regresja P02)",
          description:
            "Przyjęta oferta nie zostawiła rabatu na subskrypcji albo rabat obejmuje jeden okres.",
        },
      },
      dunning: {
        b2b_past_due_unhandled: {
          title: "Zaległa płatność instytucji bez obsługi",
          description: "Instytucja nie zapłaciła, a nikt w CRM nie ma zadania, by to wyjaśnić.",
        },
      },
      funnel: {
        signup_attribution_missing: {
          title: "Rejestracje bez źródła (regresja P16)",
          description:
            "Większość albo wszystkie nowe konta nie mają zapisanego źródła rejestracji.",
        },
        signup_popup_for_members: {
          title: "Popup rejestracji dla członków (regresja P17)",
          description: "Zaproszenie do założenia konta trafia do osób, które konto już mają.",
        },
      },
      crm: {
        auto_tasks_without_assignee: {
          title: "Zadania z automatów bez osoby (P24)",
          description:
            "Zadania z przepisów i ścieżek nie mają przypisanej osoby, więc nie przychodzą przypomnienia.",
        },
        qualified_without_owner: {
          title: "Lead kwalifikowany bez opiekuna",
          description: "Leady MQL, SQL i szanse sprzedaży nie mają opiekuna w zespole.",
        },
        leads_without_user_id: {
          title: "Lead bez powiązanego konta",
          description: "Lead w etapie konta albo klienta nie ma połączenia z kontem czytelnika.",
        },
      },
      newsletter: {
        doi_disabled: {
          title: "Bez potwierdzenia zapisu",
          description: "Zapis na newsletter nie wymaga potwierdzenia adresu (double opt-in).",
        },
        default_sender: {
          title: "Nadawca platformy w newsletterze",
          description: "Wysyłki idą z adresu platformy albo bez nadawcy - lądują w spamie.",
        },
      },
      workflows: {
        newsletter_confirmed_noop: {
          title: "Przepis bez skutku (regresja D1)",
          description:
            "Przepis po potwierdzeniu zapisu kończy się sukcesem, nie wykonując żadnego kroku.",
        },
        cancel_recipe_fires_on_pause: {
          title: "Przepis anulowania odpala się na pauzie",
          description:
            "Pauza subskrypcji wygląda jak anulowanie - handlowiec dostaje zadanie win-back bez powodu.",
        },
        overlaps_journey: {
          title: "Przepis dubluje ścieżkę",
          description: "Przepis i ścieżka komunikacji reagują na to samo zdarzenie.",
        },
      },
      journeys: {
        missing_core: {
          title: "Brak ścieżek rdzenia",
          description:
            "Nie działają podstawowe ścieżki: powitanie, porzucona kasa i rozszerzony rdzeń.",
        },
        engine_disabled_with_active: {
          title: "Silnik ścieżek wyłączony",
          description: "Są aktywne ścieżki, ale silnik ich nie wykonuje.",
        },
        step_error_rate: {
          title: "Nieudane kroki ścieżek",
          description: "Część kroków ścieżek kończy się błędem.",
        },
        inbox_backlog: {
          title: "Zaległości w skrzynce ścieżek",
          description: "Zdarzenia czekają w skrzynce ścieżek dłużej niż kilka cykli harmonogramu.",
        },
        dead_steps: {
          title: "Martwe kroki ścieżek",
          description: "Kroki opublikowanej ścieżki, do których od dwóch tygodni nikt nie doszedł.",
        },
        trigger_cycle: {
          title: "Cykl wyzwalaczy ścieżek",
          description: "Akcja jednej ścieżki uruchamia drugą, a ta - z powrotem pierwszą.",
        },
      },
      events: {
        ticket_benefit_unused: {
          title: "Bilety z planu niewykorzystane",
          description: "Członkowie odbierają bilety z planu i nie przychodzą na wydarzenia.",
        },
        upcoming_without_comms_journey: {
          title: "Wydarzenia bez ścieżki dla zapisanych",
          description: "Nadchodzące wydarzenia nie mają ścieżki przypomnień dla zapisanych.",
        },
      },
      clubs: {
        rank_without_tier: {
          title: "Próg klubu bez warstwy",
          description:
            "Klub wymaga rangi, której żadna warstwa nie daje albo której nie da się kupić.",
        },
        pending_applications_over_7d: {
          title: "Wnioski do klubów czekają",
          description: "Wnioski czekają na decyzję dłużej niż tydzień.",
        },
      },
      sync: {
        emitter_silent: {
          title: "Emiter zdarzeń ucichł",
          description: "Typ zdarzenia z regularnym rytmem nie pojawił się od tygodnia.",
        },
        dead_event_types: {
          title: "Dryf katalogu zdarzeń (D7)",
          description: "Typy zdarzeń w bazie rozjeżdżają się z katalogiem szyny.",
        },
        emit_errors: {
          title: "Błędy emitera zdarzeń",
          description:
            "Zmiany w modułach nie dotarły na szynę - inne karty i ścieżki o nich nie wiedzą.",
        },
      },
      data_quality: {
        documents_env_unknown: {
          title: "Dokumenty bez środowiska",
          description:
            "Dokumenty rozliczeniowe nie mają środowiska - piaskownica miesza się z produkcją.",
        },
        mrr_catalog_basis: {
          title: "MRR z ceny katalogowej",
          description: "Część MRR jest liczona z ceny katalogu, bo operator nie podał kwoty.",
        },
        ledger_drift: {
          title: "Rozjazd migawki MRR i księgi",
          description: "Migawka dzienna i księga ruchów MRR podają różne wartości.",
        },
        benchmark_stale: {
          title: "Przeterminowane źródła benchmarków",
          description: "Część źródeł benchmarków ma ponad 18 miesięcy.",
        },
        sandbox_only: {
          title: "Tylko dane z piaskownicy",
          description: "Hub widzi wyłącznie subskrypcje testowe - liczby produkcyjne są zerowe.",
        },
      },
    },
  },
};

const en: typeof pl = {
  adminRevenue: {
    diagnostics: {
      title: "Revenue diagnostics",
      subtitle:
        "Rules that guard the money flow: from plan and paywall, through checkout and retention, to CRM, journeys and data quality.",
      factsAt: "As of {{time}}",
      refresh: "Check again",
      loading: "Checking the rules…",
      error: "Could not read the diagnostic facts. Please try again in a moment.",
      forbidden: "Diagnostics are available to admins and editors.",
      unavailable: "Diagnostics will appear once the database rollout is complete.",
      noTenant: "Choose a workspace to see the findings.",
      filtersLabel: "Finding filters",
      areaFilter: "Area",
      allAreas: "All areas",
      severityFilter: "Severity",
      allSeverities: "All severities",
      stateFilter: "State",
      viewLabel: "Diagnostics view",
      view: {
        list: "Findings list",
        map: "System map",
      },
      state: {
        open: "Open",
        snoozed: "Snoozed",
        ok: "Healthy",
        unknown: "Unknown",
        all: "All",
      },
      stateBadge: {
        error: "Impact ongoing",
        warn: "Needs attention",
        unknown: "Unknown",
        ok: "Healthy",
        snoozed: "Snoozed",
      },
      summary_one: "{{count}} open finding",
      summary_few: "{{count}} open findings",
      summary_many: "{{count}} open findings",
      summary_other: "{{count}} open findings",
      summaryUnknown_one: "{{count}} rule cannot be assessed today",
      summaryUnknown_few: "{{count}} rules cannot be assessed today",
      summaryUnknown_many: "{{count}} rules cannot be assessed today",
      summaryUnknown_other: "{{count}} rules cannot be assessed today",
      empty: {
        open: "Nothing needs attention. Every rule that can be assessed is healthy.",
        filtered: "No finding matches the filters.",
        clear: "Clear filters",
      },
      groupHeading: "{{area}} - health {{score}}",
      groupHeadingNoData: "{{area}} - no data",
      focusMissing: "The finding from the link is not on the list - it may already be resolved.",
      fixGone: "This problem no longer occurs - the rule is healthy today.",
      fixUnknown: "This rule cannot be assessed right now, so the fix is unavailable.",
      fixNoDialog: "This finding has no quick fix - use the link to the module.",
      card: {
        count: "Count: {{value}}",
        evidenceLabel: "Evidence",
        openModule: "Open module",
        fix: "Fix",
        openFix: "Go to fix",
        report: "Report to the team",
        reported: "Finding description with evidence copied to the clipboard.",
        reportFailed: "Could not copy the description - please mark it by hand.",
        reportBody:
          "Hub finding: {{title}} ({{id}}). State: {{state}}. Evidence: {{evidence}}. As of: {{at}}.",
        snooze: "Snooze",
        unsnooze: "Restore",
        snoozedUntil: "Snoozed until {{date}}",
        snoozedIntentional: "Snoozed on purpose: {{reason}}",
        snoozeAdminOnly: "Only admins can snooze findings.",
        notSnoozable: "This rule cannot be snoozed - it distorts every hub number.",
        fixRoleAdmin: "This fix is saved by an admin.",
        fixRoleEditor: "This fix is saved by an admin or an editor.",
        impact: {
          high: "Impact: high",
          medium: "Impact: medium",
          low: "Impact: low",
        },
        unknownHint: "Facts are missing to assess this rule - that does not mean it is healthy.",
      },
      map: {
        title: "System map",
        description:
          "Who writes each entity, which events it sends and which hub tabs it refreshes. The same data feeds the source headers in fixes.",
        caption: "Hub entities: writers, events and tabs",
        entity: "Entity",
        writers: "Writers",
        events: "Events",
        tabs: "Hub tabs",
        owner: "Owner screen",
        systemOnly: "Written by the system only",
        none: "n/a",
        writerKind: {
          mutator: "mutator",
          server_fn: "server function",
          webhook: "provider webhook",
          rpc: "RPC call",
          trigger: "database trigger",
        },
        scrollRegion: "System map - scroll sideways",
      },
    },
    attention: {
      title: "Needs attention",
      description: "The most serious open findings from Diagnostics.",
      all: "All findings",
      empty: "Nothing urgent - open findings will show up here.",
      unknown: "The rules cannot be assessed right now - diagnostic facts are unavailable.",
      loading: "Checking the rules…",
    },
    signal: {
      label: "Hub diagnostics",
      ok: "Diagnostics: no open problems",
      unknown: "Diagnostics: no data",
      open_one: "{{count}} open finding",
      open_few: "{{count}} open findings",
      open_many: "{{count}} open findings",
      open_other: "{{count}} open findings",
      details: "Critical: {{critical}}, important: {{warning}}, info: {{info}}",
      action: "View in Diagnostics",
    },
    snooze: {
      title: "Snooze finding",
      description:
        "A snoozed finding does not count towards the badge or the area health. It returns when the term ends or the facts change.",
      kind: {
        days: "For a set time",
        intentional: "On purpose - this is intended",
      },
      days_one: "{{count}} day",
      days_few: "{{count}} days",
      days_many: "{{count}} days",
      days_other: "{{count}} days",
      daysLabel: "For how long",
      reason: "Reason",
      reasonHint: "From {{min}} to {{max}} characters. Others on the team will see it.",
      reasonCount: "{{value}} of {{max}}",
      reasonTooLong: "The reason is too long - shorten it to {{max}} characters.",
      reasonTooShort: "The reason needs at least {{min}} characters.",
      intentionalHint:
        "An intentional snooze holds only while the facts stay the same - a new plan or a different count brings the finding back.",
      confirm: "Snooze",
      cancel: "Cancel",
      saved: "Finding snoozed.",
      removed: "Snooze removed - the finding is back on the list.",
      forbidden: "Only admins can snooze findings.",
      unavailable: "Snoozing will be available once the database rollout is complete.",
      invalid: {
        check_id_invalid: "Unknown rule.",
        not_snoozable: "This rule cannot be snoozed.",
        scope_key_invalid: "Invalid snooze scope.",
        kind_invalid: "Unknown snooze kind.",
        reason_invalid: "The reason needs between 3 and 500 characters.",
        scope_hash_invalid: "Invalid fact fingerprint.",
        until_invalid: "The snooze term must be in the future.",
        until_too_far: "A snooze can last 180 days at most.",
        scope_hash_required: "An intentional snooze needs a fact fingerprint.",
        reason_required: "An intentional snooze needs a reason.",
      },
    },
    fix: {
      dialogTitle: "Fix: {{title}}",
      optionsLabel: "Solution",
      previewTitle: "Change preview",
      previewCaption: "Fields before and after the change",
      field: {
        heading: "Field",
        before: "Before",
        after: "After",
        tier_key: "Plan tier",
        active: "Plan active",
        for_sale: "Plan on sale",
        pricing_visible: "Tier on the pricing page",
        plan_ids: "Access rule plans",
        enabled: "Enabled",
        member_monthly_limit: "Free articles for signed-in readers",
        anon_monthly_limit: "Free articles for guests",
        abandon_after_minutes: "Checkout abandoned after (minutes)",
        status: "Campaign status",
        assignee_id: "Person assigned to tasks",
        owner_id: "Lead owner",
        double_opt_in: "Signup confirmation (double opt-in)",
        sender_email: "Sender address",
      },
      value: {
        on: "yes",
        off: "no",
        missing: "no settings row",
        rulePlans_one: "{{count}} rule with its current plans",
        rulePlans_few: "{{count}} rules with their current plans",
        rulePlans_many: "{{count}} rules with their current plans",
        rulePlans_other: "{{count}} rules with their current plans",
        rulePlansWithoutDead_one: "without {{count}} withdrawn plan",
        rulePlansWithoutDead_few: "without {{count}} withdrawn plans",
        rulePlansWithoutDead_many: "without {{count}} withdrawn plans",
        rulePlansWithoutDead_other: "without {{count}} withdrawn plans",
        rulePlansWithAssigned: "with the chosen plan on sale",
        campaign_sent: "sent",
        campaign_draft: "draft",
        campaign_archived: "archived",
        tasksUnassigned_one: "{{count}} task without a person",
        tasksUnassigned_few: "{{count}} tasks without a person",
        tasksUnassigned_many: "{{count}} tasks without a person",
        tasksUnassigned_other: "{{count}} tasks without a person",
        tasksToOwners: "lead owners",
        tasksToOwnersAndPerson: "lead owners, the rest to the chosen person",
        noOwner: "no owner",
        ownerChosen_one: "chosen person for {{count}} lead",
        ownerChosen_few: "chosen person for {{count}} leads",
        ownerChosen_many: "chosen person for {{count}} leads",
        ownerChosen_other: "chosen person for {{count}} leads",
        platformSender: "platform sender",
      },
      sourceNote: "The save uses the same mutator as the module - the same change appears there.",
      apply: "Apply",
      applying: "Saving…",
      checking: "Checking the rule again…",
      resolved: "✓ The problem is gone.",
      stillOpen: "! Saved, but the problem still occurs: {{evidence}}",
      stillUnknown: "Saved. The rule cannot be assessed right now - check it again shortly.",
      undo: "Undo ({{seconds}} s)",
      undone: "Change undone.",
      undoFailed: "Could not undo the change - open the module and correct it by hand.",
      conflictTitle: "Changed elsewhere",
      conflictBody:
        "Someone saved the same row in another tab before us. Load the current state and review the preview again.",
      conflictReload: "Load current",
      failed: "Could not save the fix. Try again or correct it in the module.",
      close: "Close",
      cancel: "Cancel",
      roleAdmin:
        "This change is saved by an admin - ask an admin or do it in the module with an admin account.",
      roleEditor: "This change is saved by an admin or an editor.",
      incomplete: "Complete the choice to apply the fix.",
      noOptions: "There is nothing to fix today - the facts have changed.",
      body: {
        tier: "Tier",
        tierPlaceholder: "Choose a tier",
        plan: "Plan on sale",
        planPlaceholder: "Choose a plan",
        noPlans: "No plans on sale - first enable a plan in the paywall.",
        staff: "Team member",
        staffPlaceholder: "Choose a person",
        staffLoading: "Loading the team…",
        staffEmpty: "Nobody has the admin or editor role.",
        senderEmail: "Sender address",
        senderEmailHint: "An address in a verified sending domain.",
        senderEmailInvalid: "Enter a valid address - different from the platform sender.",
        senderName: "Sender name (optional)",
        number: "Number",
        minutes: "Minutes",
        minutesHint: "From {{min}} to {{max}} minutes.",
        numberHint: "From {{min}} to {{max}}.",
        numberInvalid: "Value out of range - correct it, we will not trim it.",
        impactTitle: "Effect of the default limit this month",
        impactMembers:
          "Signed in: {{blocked}} blocked, {{warning}} near the limit out of {{total}}",
        impactAnon: "Guests: {{blocked}} blocked out of {{total}}",
        impactLoading: "Calculating the effect…",
        impactUnavailable: "The effect preview cannot be calculated right now.",
      },
      plan_tier: {
        title: "Attach the plan to a tier",
        description:
          "A plan without a tier sells access to nothing. Choose the tier the plan should grant.",
        option: {
          assign_one: "Attach {{count}} plan to a tier",
          assign_few: "Attach {{count}} plans to a tier",
          assign_many: "Attach {{count}} plans to a tier",
          assign_other: "Attach {{count}} plans to a tier",
        },
      },
      plan_deactivate: {
        title: "Deactivate the plan without a catalog price",
        description:
          "Checkout refuses a plan without a price in the provider catalog. Deactivation takes it off the offer until the price is added (a catalog code change).",
        option: {
          deactivate_one: "Deactivate {{count}} plan",
          deactivate_few: "Deactivate {{count}} plans",
          deactivate_many: "Deactivate {{count}} plans",
          deactivate_other: "Deactivate {{count}} plans",
        },
      },
      plan_not_for_sale: {
        title: "Withdraw the enquiry-only plan from sale",
        description:
          "Individually priced offers cannot have a checkout. The plan stays but leaves sale.",
        option: {
          withdraw_one: "Withdraw {{count}} plan from sale",
          withdraw_few: "Withdraw {{count}} plans from sale",
          withdraw_many: "Withdraw {{count}} plans from sale",
          withdraw_other: "Withdraw {{count}} plans from sale",
        },
      },
      tier_hide: {
        title: "Remove the tier from the pricing page",
        description:
          "A tier without a plan on sale promises something nobody can buy. Members keep their access.",
        option: {
          hide_one: "Remove {{count}} tier from the pricing page",
          hide_few: "Remove {{count}} tiers from the pricing page",
          hide_many: "Remove {{count}} tiers from the pricing page",
          hide_other: "Remove {{count}} tiers from the pricing page",
        },
      },
      access_rule_plan: {
        title: "Correct access rule plans",
        description:
          "Paid content must point to a plan that can be bought today - otherwise the reader hits a dead end.",
        option: {
          remove_dead_one: "Remove withdrawn plans from {{count}} rule",
          remove_dead_few: "Remove withdrawn plans from {{count}} rules",
          remove_dead_many: "Remove withdrawn plans from {{count}} rules",
          remove_dead_other: "Remove withdrawn plans from {{count}} rules",
          assign_one: "Assign a plan on sale to {{count}} rule",
          assign_few: "Assign a plan on sale to {{count}} rules",
          assign_many: "Assign a plan on sale to {{count}} rules",
          assign_other: "Assign a plan on sale to {{count}} rules",
        },
      },
      metering_defaults: {
        title: "Save the meter settings",
        description:
          "Without a settings row the server treats the meter as off, although the form shows default values.",
        option: {
          defaults: "Save the default values ({{members}} articles for signed-in readers)",
        },
      },
      metering_anon_limit: {
        title: "Free articles for guests",
        description:
          "The meter is on, but a guest gets not a single article. Set a limit for guests.",
        option: {
          same_as_members_one: "Same as signed-in readers ({{count}} article)",
          same_as_members_few: "Same as signed-in readers ({{count}} articles)",
          same_as_members_many: "Same as signed-in readers ({{count}} articles)",
          same_as_members_other: "Same as signed-in readers ({{count}} articles)",
          custom: "Custom number",
        },
      },
      checkout_abandon_window: {
        title: "Checkout abandonment window",
        description:
          "By default a checkout session counts as abandoned after a day - the abandoned-checkout journey starts only the next day. Set a shorter window.",
        option: {
          custom: "Set the abandonment window",
        },
      },
      campaign_status: {
        title: "Campaign sent without codes",
        description:
          "Recipients got a message without a code. Return the campaign to draft to generate codes and send again, or archive it.",
        option: {
          draft_one: "Return {{count}} campaign to draft",
          draft_few: "Return {{count}} campaigns to draft",
          draft_many: "Return {{count}} campaigns to draft",
          draft_other: "Return {{count}} campaigns to draft",
          archived_one: "Archive {{count}} campaign",
          archived_few: "Archive {{count}} campaigns",
          archived_many: "Archive {{count}} campaigns",
          archived_other: "Archive {{count}} campaigns",
        },
      },
      retention_enable: {
        title: "Enable the cancellation counter-offer",
        description: "A customer cancelling a subscription gets no retention offer today.",
        option: {
          enable: "Enable the counter-offer with the current settings",
          create: "Enable the counter-offer: {{percent}}% off for {{periods}} periods",
        },
      },
      crm_assign_tasks: {
        title: "Assign automation tasks",
        description: "A task without a person sends no reminder - the follow-up gets lost.",
        option: {
          owners: "Assign to lead owners",
          owners_and_fallback: "Assign to owners and the rest to a chosen person",
        },
      },
      crm_assign_owner: {
        title: "Assign an owner to leads",
        description: "A qualified lead without an owner has nobody to work it.",
        option: {
          owner_one: "Assign an owner to {{count}} lead",
          owner_few: "Assign an owner to {{count}} leads",
          owner_many: "Assign an owner to {{count}} leads",
          owner_other: "Assign an owner to {{count}} leads",
        },
      },
      newsletter_doi: {
        title: "Turn on signup confirmation",
        description:
          "Without confirmation the list collects typos and other people's addresses - spam risk grows.",
        option: {
          enable: "Turn on double opt-in for new signups",
        },
      },
      newsletter_sender: {
        title: "Set your own sender",
        description: "Sends from the platform sender land in spam or do not go out at all.",
        option: {
          own: "Set the sender address",
        },
      },
      workflow_disable: {
        title: "Turn off the automation",
        description:
          "The automation fires where it should not, or duplicates a communication journey.",
        option: {
          disable_one: "Turn off {{count}} automation",
          disable_few: "Turn off {{count}} automations",
          disable_many: "Turn off {{count}} automations",
          disable_other: "Turn off {{count}} automations",
        },
      },
    },
    evidence: {
      planWithoutTier_one: "{{count}} plan without a tier (on sale: {{selling}})",
      planWithoutTier_few: "{{count}} plans without a tier (on sale: {{selling}})",
      planWithoutTier_many: "{{count}} plans without a tier (on sale: {{selling}})",
      planWithoutTier_other: "{{count}} plans without a tier (on sale: {{selling}})",
      planWithoutCatalogPair_one:
        "{{count}} plan without a price in the provider catalog (on sale: {{selling}})",
      planWithoutCatalogPair_few:
        "{{count}} plans without a price in the provider catalog (on sale: {{selling}})",
      planWithoutCatalogPair_many:
        "{{count}} plans without a price in the provider catalog (on sale: {{selling}})",
      planWithoutCatalogPair_other:
        "{{count}} plans without a price in the provider catalog (on sale: {{selling}})",
      enquiryPlanBuyable_one: "{{count}} enquiry-only plan has a checkout (active: {{active}})",
      enquiryPlanBuyable_few: "{{count}} enquiry-only plans have a checkout (active: {{active}})",
      enquiryPlanBuyable_many: "{{count}} enquiry-only plans have a checkout (active: {{active}})",
      enquiryPlanBuyable_other: "{{count}} enquiry-only plans have a checkout (active: {{active}})",
      promiseBroken_one:
        "{{count}} pricing promise without the flag on its tier (on sale: {{selling}})",
      promiseBroken_few:
        "{{count}} pricing promises without the flag on their tier (on sale: {{selling}})",
      promiseBroken_many:
        "{{count}} pricing promises without the flag on their tier (on sale: {{selling}})",
      promiseBroken_other:
        "{{count}} pricing promises without the flag on their tier (on sale: {{selling}})",
      promiseDecorative_one: "{{count}} promise without a gate that would enforce it",
      promiseDecorative_few: "{{count}} promises without a gate that would enforce them",
      promiseDecorative_many: "{{count}} promises without a gate that would enforce them",
      promiseDecorative_other: "{{count}} promises without a gate that would enforce them",
      providerPriceDrift:
        "Subscriptions paying an amount other than the plan - plans on sale: {{forSale}}, withdrawn plans: {{notForSale}}",
      annualAboveMonthly_one: "{{count}} annual plan costs more than 12 months",
      annualAboveMonthly_few: "{{count}} annual plans cost more than 12 months",
      annualAboveMonthly_many: "{{count}} annual plans cost more than 12 months",
      annualAboveMonthly_other: "{{count}} annual plans cost more than 12 months",
      annualBelowMonthly_one: "{{count}} annual plan costs less than one month",
      annualBelowMonthly_few: "{{count}} annual plans cost less than one month",
      annualBelowMonthly_many: "{{count}} annual plans cost less than one month",
      annualBelowMonthly_other: "{{count}} annual plans cost less than one month",
      annualNoDiscount_one: "{{count}} annual plan without any discount",
      annualNoDiscount_few: "{{count}} annual plans without any discount",
      annualNoDiscount_many: "{{count}} annual plans without any discount",
      annualNoDiscount_other: "{{count}} annual plans without any discount",
      unknownPrice_one: "{{count}} active subscription with a price outside the catalog",
      unknownPrice_few: "{{count}} active subscriptions with a price outside the catalog",
      unknownPrice_many: "{{count}} active subscriptions with a price outside the catalog",
      unknownPrice_other: "{{count}} active subscriptions with a price outside the catalog",
      missingAmount_one: "{{count}} subscription without an amount from the provider",
      missingAmount_few: "{{count}} subscriptions without an amount from the provider",
      missingAmount_many: "{{count}} subscriptions without an amount from the provider",
      missingAmount_other: "{{count}} subscriptions without an amount from the provider",
      tierBuyButtonWithoutPlan_one: "{{count}} tier with a buy button but no plan on sale",
      tierBuyButtonWithoutPlan_few: "{{count}} tiers with a buy button but no plan on sale",
      tierBuyButtonWithoutPlan_many: "{{count}} tiers with a buy button but no plan on sale",
      tierBuyButtonWithoutPlan_other: "{{count}} tiers with a buy button but no plan on sale",
      tierShownPlanWithdrawn_one:
        "{{count}} tier on the pricing page with its plan withdrawn from sale",
      tierShownPlanWithdrawn_few:
        "{{count}} tiers on the pricing page with their plans withdrawn from sale",
      tierShownPlanWithdrawn_many:
        "{{count}} tiers on the pricing page with their plans withdrawn from sale",
      tierShownPlanWithdrawn_other:
        "{{count}} tiers on the pricing page with their plans withdrawn from sale",
      priceNoticeFailed_one: "{{count}} price change without a delivered notice (send error)",
      priceNoticeFailed_few: "{{count}} price changes without a delivered notice (send error)",
      priceNoticeFailed_many: "{{count}} price changes without a delivered notice (send error)",
      priceNoticeFailed_other: "{{count}} price changes without a delivered notice (send error)",
      priceNoticePending_one: "{{count}} price change notice has waited over a day",
      priceNoticePending_few: "{{count}} price change notices have waited over a day",
      priceNoticePending_many: "{{count}} price change notices have waited over a day",
      priceNoticePending_other: "{{count}} price change notices have waited over a day",
      teamSeatsOver_one: "{{count}} Team organisation has more than {{max}} seats at the provider",
      teamSeatsOver_few:
        "{{count}} Team organisations have more than {{max}} seats at the provider",
      teamSeatsOver_many:
        "{{count}} Team organisations have more than {{max}} seats at the provider",
      teamSeatsOver_other:
        "{{count}} Team organisations have more than {{max}} seats at the provider",
      teamSeatsAtCap_one: "{{count}} Team organisation at the {{max}}-seat limit",
      teamSeatsAtCap_few: "{{count}} Team organisations at the {{max}}-seat limit",
      teamSeatsAtCap_many: "{{count}} Team organisations at the {{max}}-seat limit",
      teamSeatsAtCap_other: "{{count}} Team organisations at the {{max}}-seat limit",
      paidWithoutOffer_one:
        "{{count}} paid item with nothing to buy (with traffic in 30 days: {{withHits}})",
      paidWithoutOffer_few:
        "{{count}} paid items with nothing to buy (with traffic in 30 days: {{withHits}})",
      paidWithoutOffer_many:
        "{{count}} paid items with nothing to buy (with traffic in 30 days: {{withHits}})",
      paidWithoutOffer_other:
        "{{count}} paid items with nothing to buy (with traffic in 30 days: {{withHits}})",
      ruleInactivePlan_one:
        "{{count}} rule points to a withdrawn plan (with traffic in 30 days: {{withHits}})",
      ruleInactivePlan_few:
        "{{count}} rules point to a withdrawn plan (with traffic in 30 days: {{withHits}})",
      ruleInactivePlan_many:
        "{{count}} rules point to a withdrawn plan (with traffic in 30 days: {{withHits}})",
      ruleInactivePlan_other:
        "{{count}} rules point to a withdrawn plan (with traffic in 30 days: {{withHits}})",
      membersRankNoCta_one:
        "{{count}} item gated by a tier nobody can buy (with traffic in 30 days: {{withHits}})",
      membersRankNoCta_few:
        "{{count}} items gated by a tier nobody can buy (with traffic in 30 days: {{withHits}})",
      membersRankNoCta_many:
        "{{count}} items gated by a tier nobody can buy (with traffic in 30 days: {{withHits}})",
      membersRankNoCta_other:
        "{{count}} items gated by a tier nobody can buy (with traffic in 30 days: {{withHits}})",
      paywallNeverMeasured_one:
        "{{count}} paid rule for over {{days}} days, and paywall measurement recorded nothing",
      paywallNeverMeasured_few:
        "{{count}} paid rules for over {{days}} days, and paywall measurement recorded nothing",
      paywallNeverMeasured_many:
        "{{count}} paid rules for over {{days}} days, and paywall measurement recorded nothing",
      paywallNeverMeasured_other:
        "{{count}} paid rules for over {{days}} days, and paywall measurement recorded nothing",
      paywallSilent:
        "Last paywall hit over {{days}} days ago, although there are {{count}} paid items",
      meteringRowMissing:
        "No meter settings row - the server treats the meter as off (items under the meter: {{count}})",
      meteringNobodyFree:
        "The meter is on, but neither guests nor signed-in readers get a free article",
      meteringAnonZero: "Guests get no free article (signed-in readers: {{members}})",
      meteringRankBypass:
        "The meter function does not check the reader's rank (tier-gated items under the meter: {{count}})",
      abandonDefault: "Default checkout abandonment window: {{minutes}} minutes",
      abandonDefaultWithJourney:
        "The default abandonment window ({{minutes}} minutes) delays the abandoned-checkout journey by a day",
      currencyMismatchNotice:
        "{{lang}} pricing shows {{display}} while plans charge in {{charged}} (with a note below the offer)",
      currencyMismatchNoNotice:
        "{{lang}} pricing shows {{display}} while plans charge in {{charged}} - without any note",
      campaignSentWithoutCodes:
        "Campaigns sent without codes - still valid: {{active}}, expired: {{expired}}",
      campaignExpiringUnused_one: "{{count}} campaign expires in {{days}} days with no code used",
      campaignExpiringUnused_few: "{{count}} campaigns expire in {{days}} days with no code used",
      campaignExpiringUnused_many: "{{count}} campaigns expire in {{days}} days with no code used",
      campaignExpiringUnused_other: "{{count}} campaigns expire in {{days}} days with no code used",
      couponsExpiringUnused_one: "{{count}} code expires in {{days}} days unused",
      couponsExpiringUnused_few: "{{count}} codes expire in {{days}} days unused",
      couponsExpiringUnused_many: "{{count}} codes expire in {{days}} days unused",
      couponsExpiringUnused_other: "{{count}} codes expire in {{days}} days unused",
      grantTierColumnMissing:
        "Column membership_grants.source_coupon_id is missing - tier-granting coupons ({{count}}) will not grant it",
      retentionMissing: "The counter-offer is not set up (cancellations in 30 days: {{count}})",
      retentionDisabled: "The counter-offer is off (cancellations in 30 days: {{count}})",
      cancelWithoutFeedback_one: "{{count}} cancellation in 30 days without any flow record",
      cancelWithoutFeedback_few: "{{count}} cancellations in 30 days without any flow record",
      cancelWithoutFeedback_many: "{{count}} cancellations in 30 days without any flow record",
      cancelWithoutFeedback_other: "{{count}} cancellations in 30 days without any flow record",
      cancelProviderOnly_one: "{{count}} cancellation in the provider portal, skipping the flow",
      cancelProviderOnly_few: "{{count}} cancellations in the provider portal, skipping the flow",
      cancelProviderOnly_many: "{{count}} cancellations in the provider portal, skipping the flow",
      cancelProviderOnly_other: "{{count}} cancellations in the provider portal, skipping the flow",
      cancelFlowSteps: "The cancellation path has {{steps}} steps (at most {{max}})",
      cancelFlowAbandoned: "Abandoned cancellation flows: {{abandoned}}, completed: {{finished}}",
      offerAcceptedNoDiscount_one:
        "{{count}} accepted offer without a discount on the subscription",
      offerAcceptedNoDiscount_few:
        "{{count}} accepted offers without a discount on the subscription",
      offerAcceptedNoDiscount_many:
        "{{count}} accepted offers without a discount on the subscription",
      offerAcceptedNoDiscount_other:
        "{{count}} accepted offers without a discount on the subscription",
      offerSinglePeriod: "The counter-offer discount covers a single billing period only",
      b2bPastDueNoTask:
        "Overdue institution payments: {{count}}, of which without a CRM task: {{withoutTask}}",
      b2bPastDueNoJourney:
        "Overdue institution payments: {{count}} - with a task, but without a dunning journey",
      attributionDead_one: "{{count}} signup in 30 days - none with a source",
      attributionDead_few: "{{count}} signups in 30 days - none with a source",
      attributionDead_many: "{{count}} signups in 30 days - none with a source",
      attributionDead_other: "{{count}} signups in 30 days - none with a source",
      attributionMostlyUnknown: "Signups without a source: {{unknown}} of {{total}} in 30 days",
      popupForMembers:
        "Popup signups by account holders: {{count}} in 30 days, {{recent}} of them in 7 days",
      autoTasksUnassigned: "Automation tasks without a person: {{count}}, overdue: {{overdue}}",
      qualifiedWithoutOwner:
        "Qualified leads without an owner: {{count}}, of which opportunities: {{opportunity}}",
      leadsWithoutAccount:
        "Leads without a linked account - registered: {{registered}}, customers: {{customer}}",
      doiOff: "Signup confirmation (double opt-in) is off",
      doiOffPopupOn: "Signup confirmation is off while the popup collects addresses",
      defaultSender: "Platform sender instead of your own (sends in 30 days: {{count}})",
      newsletterConfirmedNoop:
        "“Successful” runs without steps: {{count}} in 30 days, {{recent}} of them in 7 days",
      cancelRecipeUnguarded: "The cancellation automation also fires on a subscription pause",
      cancelRecipeFiredOnPause_one: "{{count}} win-back task created on a pause and then cancelled",
      cancelRecipeFiredOnPause_few:
        "{{count}} win-back tasks created on a pause and then cancelled",
      cancelRecipeFiredOnPause_many:
        "{{count}} win-back tasks created on a pause and then cancelled",
      cancelRecipeFiredOnPause_other:
        "{{count}} win-back tasks created on a pause and then cancelled",
      workflowReplacedByJourney_one:
        "{{count}} automation replaced by an active journey still runs",
      workflowReplacedByJourney_few: "{{count}} automations replaced by active journeys still run",
      workflowReplacedByJourney_many: "{{count}} automations replaced by active journeys still run",
      workflowReplacedByJourney_other:
        "{{count}} automations replaced by active journeys still run",
      workflowSharesTrigger_one: "{{count}} automation-journey pair on the same event",
      workflowSharesTrigger_few: "{{count}} automation-journey pairs on the same event",
      workflowSharesTrigger_many: "{{count}} automation-journey pairs on the same event",
      workflowSharesTrigger_other: "{{count}} automation-journey pairs on the same event",
      journeysCoreMissing_one: "{{count}} core journey is missing (welcome, abandoned checkout)",
      journeysCoreMissing_few: "{{count}} core journeys are missing (welcome, abandoned checkout)",
      journeysCoreMissing_many: "{{count}} core journeys are missing (welcome, abandoned checkout)",
      journeysCoreMissing_other:
        "{{count}} core journeys are missing (welcome, abandoned checkout)",
      journeysExtendedMissing_one: "{{count}} extended core journey is missing",
      journeysExtendedMissing_few: "{{count}} extended core journeys are missing",
      journeysExtendedMissing_many: "{{count}} extended core journeys are missing",
      journeysExtendedMissing_other: "{{count}} extended core journeys are missing",
      engineOffWithActive:
        "The journey engine is off with active journeys: {{count}}, queued events: {{pending}}",
      stepFailures: "Failed steps in 24 h: {{count}} of {{total}} ({{percent}}%)",
      inboxBacklog:
        "Events waiting in the journey inbox: {{count}}, the oldest for {{minutes}} min",
      deadSteps: "Steps nobody reached: {{count}} in {{journeys}} journeys",
      deadJourneys:
        "Journeys with enrollments but no executed step: {{journeys}} (steps: {{count}})",
      triggerCycleBounded_one: "{{count}} trigger loop (each contact passes it once)",
      triggerCycleBounded_few: "{{count}} trigger loops (each contact passes them once)",
      triggerCycleBounded_many: "{{count}} trigger loops (each contact passes them once)",
      triggerCycleBounded_other: "{{count}} trigger loops (each contact passes them once)",
      triggerCycleUnbounded_one: "{{count}} trigger loop with re-entry - a contact may circle",
      triggerCycleUnbounded_few: "{{count}} trigger loops with re-entry - a contact may circle",
      triggerCycleUnbounded_many: "{{count}} trigger loops with re-entry - a contact may circle",
      triggerCycleUnbounded_other: "{{count}} trigger loops with re-entry - a contact may circle",
      ticketClaimsUnused: "Plan tickets claimed and unused: {{count}} of {{total}} (90 days)",
      eventsWithoutNurture:
        "Upcoming events without a journey for registrants: {{count}}, of which within a week: {{soon}}",
      clubRankImpossible_one: "{{count}} club with a rank threshold no active tier reaches",
      clubRankImpossible_few: "{{count}} clubs with a rank threshold no active tier reaches",
      clubRankImpossible_many: "{{count}} clubs with a rank threshold no active tier reaches",
      clubRankImpossible_other: "{{count}} clubs with a rank threshold no active tier reaches",
      clubRankNotOfferable_one: "{{count}} club with a rank threshold only in tiers nobody can buy",
      clubRankNotOfferable_few:
        "{{count}} clubs with a rank threshold only in tiers nobody can buy",
      clubRankNotOfferable_many:
        "{{count}} clubs with a rank threshold only in tiers nobody can buy",
      clubRankNotOfferable_other:
        "{{count}} clubs with a rank threshold only in tiers nobody can buy",
      clubApplicationsWaiting_one: "{{count}} club application has waited over {{days}} days",
      clubApplicationsWaiting_few: "{{count}} club applications have waited over {{days}} days",
      clubApplicationsWaiting_many: "{{count}} club applications have waited over {{days}} days",
      clubApplicationsWaiting_other: "{{count}} club applications have waited over {{days}} days",
      clubApplicationsStale_one:
        "{{count}} club application without a decision for over {{days}} days",
      clubApplicationsStale_few:
        "{{count}} club applications without a decision for over {{days}} days",
      clubApplicationsStale_many:
        "{{count}} club applications without a decision for over {{days}} days",
      clubApplicationsStale_other:
        "{{count}} club applications without a decision for over {{days}} days",
      emitterSilent: "Event emitters silent for a week: {{count}}, of which daily ones: {{daily}}",
      eventTypesUnknown_one: "{{count}} event type in the database outside the bus catalog",
      eventTypesUnknown_few: "{{count}} event types in the database outside the bus catalog",
      eventTypesUnknown_many: "{{count}} event types in the database outside the bus catalog",
      eventTypesUnknown_other: "{{count}} event types in the database outside the bus catalog",
      eventTypesDead_one: "{{count}} catalog type without an event in 90 days",
      eventTypesDead_few: "{{count}} catalog types without an event in 90 days",
      eventTypesDead_many: "{{count}} catalog types without an event in 90 days",
      eventTypesDead_other: "{{count}} catalog types without an event in 90 days",
      emitErrors24h_one: "{{count}} event emitter error in the last day",
      emitErrors24h_few: "{{count}} event emitter errors in the last day",
      emitErrors24h_many: "{{count}} event emitter errors in the last day",
      emitErrors24h_other: "{{count}} event emitter errors in the last day",
      emitErrors7d_one: "{{count}} emitter error in 7 days (none in the last day)",
      emitErrors7d_few: "{{count}} emitter errors in 7 days (none in the last day)",
      emitErrors7d_many: "{{count}} emitter errors in 7 days (none in the last day)",
      emitErrors7d_other: "{{count}} emitter errors in 7 days (none in the last day)",
      documentsEnvUnknown:
        "Billing documents without an environment: {{count}}, of which from 30 days: {{recent}}",
      mrrCatalogBasis: "{{percent}}% of MRR comes from the catalog price, not the provider amount",
      ledgerDrift:
        "The MRR snapshot differs from the ledger by {{percent}}% (tolerance {{tolerance}}%) - currencies: {{currencies}}",
      benchmarkStale: "Benchmark sources older than 18 months: {{count}} of {{total}}",
      sandboxOnly_one: "Only {{count}} sandbox subscription, zero production ones",
      sandboxOnly_few: "Only {{count}} sandbox subscriptions, zero production ones",
      sandboxOnly_many: "Only {{count}} sandbox subscriptions, zero production ones",
      sandboxOnly_other: "Only {{count}} sandbox subscriptions, zero production ones",
      sandboxActive_one: "{{count}} sandbox subscription in the last week, zero production ones",
      sandboxActive_few: "{{count}} sandbox subscriptions in the last week, zero production ones",
      sandboxActive_many: "{{count}} sandbox subscriptions in the last week, zero production ones",
      sandboxActive_other: "{{count}} sandbox subscriptions in the last week, zero production ones",
    },
    checks: {
      catalog: {
        plan_without_tier: {
          title: "Plan without a tier",
          description: "The plan is not attached to any tier - a purchase grants no access.",
        },
        plan_without_catalog_pair: {
          title: "Plan without a provider catalog price",
          description:
            "Checkout refuses a plan whose cycle and tier are missing from the price catalog.",
        },
        enquiry_plan_buyable: {
          title: "Enquiry-only offer can be bought (P05 regression)",
          description:
            "An individually priced plan (Decision Lab) is on sale and can be bought from a link.",
        },
        promise_without_gate: {
          title: "Pricing promise without a gate (P20)",
          description: "A pricing card promises an entitlement its tier lacks or nothing enforces.",
        },
        provider_price_drift: {
          title: "Provider price differs from the plan",
          description:
            "Subscriptions pay an amount other than the plan of that tier and cycle in the same currency.",
        },
        annual_discount_out_of_range: {
          title: "Annual price outside a sensible range",
          description:
            "The annual plan costs as much as 12 months or more, or less than one month.",
        },
        subscription_unknown_price: {
          title: "Subscription with an unknown price",
          description:
            "The subscription price is outside the catalog or the provider sent no amount - MRR has no basis.",
        },
        not_for_sale_still_visible: {
          title: "Tier on the pricing page without a plan on sale",
          description: "The pricing page shows a tier that cannot be bought today.",
        },
        price_change_without_notice: {
          title: "Price change without notice (P07)",
          description:
            "The price move went through at the provider, and the notice email did not go out.",
        },
        team_seats_over_cap: {
          title: "Team above its seat limit",
          description:
            "A Team organisation subscription has more seats at the provider than the tier allows.",
        },
      },
      paywall: {
        paid_without_buyable_plan: {
          title: "Paid content with nothing to buy",
          description: "Readers reach a paywall that offers nothing to purchase.",
        },
        rule_inactive_plan: {
          title: "Access rule points to a withdrawn plan",
          description: "A content rule refers to an inactive plan or one that is off sale.",
        },
        members_rank_no_cta: {
          title: "Tier threshold without a buy button (P14 regression)",
          description:
            "Member content requires a tier nobody can buy - signed-in readers have no way forward.",
        },
        measurement_silent: {
          title: "Paywall measurement is silent (P18)",
          description: "There is paid content, yet paywall hit measurement records nothing.",
        },
      },
      metering: {
        settings_row_missing: {
          title: "Missing meter settings",
          description: "Without a settings row the server treats the free article meter as off.",
        },
        anon_zero_limit: {
          title: "Guests without free articles",
          description: "The meter is on, but a guest gets not a single article.",
        },
        rank_bypass: {
          title: "Meter bypasses the tier threshold (P19 regression)",
          description: "The meter releases tier-gated content to anyone with a free article left.",
        },
      },
      checkout: {
        abandon_window_default: {
          title: "Default checkout abandonment window",
          description:
            "Abandoned checkouts are counted after a day - the follow-up arrives too late.",
        },
        display_currency_mismatch: {
          title: "Pricing currency differs from the charge currency (P09)",
          description: "Pricing shows one currency while the plan charges in another.",
        },
      },
      coupons: {
        campaign_sent_without_codes: {
          title: "Campaign sent without codes",
          description: "The campaign is marked as sent, yet it has not a single code.",
        },
        expiring_unused: {
          title: "Codes expire unused",
          description: "Coupon codes expire within two weeks and nobody has used them.",
        },
        grant_tier_broken: {
          title: "Coupon will not grant a tier (P03)",
          description: "The database lacks the migration the tier-granting coupon depends on.",
        },
      },
      retention: {
        not_configured: {
          title: "Counter-offer is off",
          description: "A customer cancelling a subscription gets no retention offer.",
        },
        provider_cancel_bypasses_flow: {
          title: "Cancellation skipping the flow (P01 regression)",
          description:
            "Subscriptions end without the cancellation flow and without a reason for leaving.",
        },
        cancel_flow_too_long: {
          title: "Cancellation path too long",
          description:
            "The cancellation path has more than two steps or most customers abandon it.",
        },
        offer_once_discount: {
          title: "Counter-offer discount without effect (P02 regression)",
          description:
            "An accepted offer left no discount on the subscription, or the discount covers one period.",
        },
      },
      dunning: {
        b2b_past_due_unhandled: {
          title: "Institution past-due payment unhandled",
          description:
            "An institution has not paid, and nobody in the CRM has a task to sort it out.",
        },
      },
      funnel: {
        signup_attribution_missing: {
          title: "Signups without a source (P16 regression)",
          description: "Most or all new accounts have no recorded signup source.",
        },
        signup_popup_for_members: {
          title: "Signup popup for members (P17 regression)",
          description: "The invitation to create an account reaches people who already have one.",
        },
      },
      crm: {
        auto_tasks_without_assignee: {
          title: "Automation tasks without a person (P24)",
          description:
            "Tasks from automations and journeys have no assignee, so no reminders arrive.",
        },
        qualified_without_owner: {
          title: "Qualified lead without an owner",
          description: "MQL, SQL and opportunity leads have no owner on the team.",
        },
        leads_without_user_id: {
          title: "Lead without a linked account",
          description: "A lead at the account or customer stage is not linked to a reader account.",
        },
      },
      newsletter: {
        doi_disabled: {
          title: "No signup confirmation",
          description: "A newsletter signup does not require address confirmation (double opt-in).",
        },
        default_sender: {
          title: "Platform sender in the newsletter",
          description:
            "Sends go out from the platform address or without a sender - they land in spam.",
        },
      },
      workflows: {
        newsletter_confirmed_noop: {
          title: "Automation without effect (D1 regression)",
          description:
            "The automation after signup confirmation succeeds without executing any step.",
        },
        cancel_recipe_fires_on_pause: {
          title: "Cancellation automation fires on a pause",
          description:
            "A subscription pause looks like a cancellation - sales gets a pointless win-back task.",
        },
        overlaps_journey: {
          title: "Automation duplicates a journey",
          description: "An automation and a communication journey react to the same event.",
        },
      },
      journeys: {
        missing_core: {
          title: "Core journeys missing",
          description:
            "Basic journeys are not running: welcome, abandoned checkout and the extended core.",
        },
        engine_disabled_with_active: {
          title: "Journey engine is off",
          description: "There are active journeys, but the engine does not run them.",
        },
        step_error_rate: {
          title: "Failed journey steps",
          description: "Some journey steps end with an error.",
        },
        inbox_backlog: {
          title: "Journey inbox backlog",
          description: "Events wait in the journey inbox longer than a few scheduler cycles.",
        },
        dead_steps: {
          title: "Dead journey steps",
          description: "Steps of a published journey nobody has reached for two weeks.",
        },
        trigger_cycle: {
          title: "Journey trigger loop",
          description: "An action of one journey starts another, which starts the first one again.",
        },
      },
      events: {
        ticket_benefit_unused: {
          title: "Plan tickets unused",
          description: "Members claim plan tickets and do not come to the events.",
        },
        upcoming_without_comms_journey: {
          title: "Events without a registrant journey",
          description: "Upcoming events have no reminder journey for registrants.",
        },
      },
      clubs: {
        rank_without_tier: {
          title: "Club threshold without a tier",
          description: "A club requires a rank no tier grants or nobody can buy.",
        },
        pending_applications_over_7d: {
          title: "Club applications waiting",
          description: "Applications have waited for a decision longer than a week.",
        },
      },
      sync: {
        emitter_silent: {
          title: "Event emitter went silent",
          description: "An event type with a regular rhythm has not appeared for a week.",
        },
        dead_event_types: {
          title: "Event catalog drift (D7)",
          description: "Event types in the database drift away from the bus catalog.",
        },
        emit_errors: {
          title: "Event emitter errors",
          description:
            "Module changes did not reach the bus - other tabs and journeys do not know about them.",
        },
      },
      data_quality: {
        documents_env_unknown: {
          title: "Documents without an environment",
          description: "Billing documents have no environment - sandbox mixes with production.",
        },
        mrr_catalog_basis: {
          title: "MRR from catalog prices",
          description:
            "Part of MRR is calculated from the catalog price because the provider sent no amount.",
        },
        ledger_drift: {
          title: "MRR snapshot and ledger drift",
          description: "The daily snapshot and the MRR movement ledger report different values.",
        },
        benchmark_stale: {
          title: "Outdated benchmark sources",
          description: "Some benchmark sources are older than 18 months.",
        },
        sandbox_only: {
          title: "Sandbox data only",
          description: "The hub sees test subscriptions only - production numbers are zero.",
        },
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

/** Słowniki wprost - test kodów unii czyta je bez instancji i18next. */
export const revenueDiagnosticsDictionaries = { pl, en } as const;
