// i18n huba „Przychód i lejek" - nakładka ZAKŁADEK S7 (SPEC §6.7): Kokpit,
// most MRR, Lejek, Dostęp, Oferta i Dane wejściowe, plus gałęzie
// ZAREZERWOWANE dla zakładek Przychód, Retencja, Wskaźniki i Społeczność
// (S7-C nie tworzy słownika - czyta klucze stąd, z S2/S4 i z powłoki S6).
//
// BEZ DUBLOWANIA. Etykiety pól lejka i dostępu są w `i18n-admin-revenue-funnel`
// (S3), finansów w `-finance` (S2), społeczności w `-community` (S4), obszary,
// wagi, pochodzenie danych i role w powłoce S6 (`-shell`). Ta nakładka dokłada
// WYŁĄCZNIE zdania zakładek: gałęzie `overview`, `funnelTab`, `accessTab`,
// `offer`, `inputs` i zarezerwowane `mrr`, `retention`, `metrics`,
// `communityTab`. Bramka `i18nOverlayIntegrity` pilnuje, że żaden klucz nie
// ma dwóch źródeł.
//
// Prefiks `adminRevenue` jest pod TWARDĄ bramką parytetu
// (`src/__tests__/i18nParity.gate.test.ts`): brak albo napis identyczny
// w PL i EN zapala CI - stąd np. „Z {{start}} do {{end}}" / „From … to …"
// zamiast samej strzałki. Liczebniki PL `_one/_few/_many/_other`, EN
// `_one/_other` (test parytetu zakładek w `overview/__tests__`).
//
// UWAGA NA ARKUSZ CSS. Pliki `src/lib/i18n-*.ts` skanuje generator arkusza
// PUBLICZNEGO - słowo będące nazwą klasy narzędziowej w angielskim napisie
// dokłada regułę do CSS każdej strony czytelnika. Napisy niżej omijają takie
// słowa (np. „matrix" zamiast nazwy elementu tabeli, „shown" zamiast
// przymiotnika widoczności, „narrow" zamiast nazwy filtra).
//
// IMPORT WYŁĄCZNIE Z KOMPONENTÓW (karta zakładki woła `ensureI18n()`).
import i18n from "@/lib/i18n";

const pl = {
  adminRevenue: {
    overview: {
      state: {
        error: "Nie udało się wczytać danych tej karty. Spróbuj ponownie za chwilę.",
        retry: "Spróbuj ponownie",
        noTenant: "Wybierz obszar roboczy, żeby zobaczyć dane huba.",
      },
      kpi: {
        title: "Najważniejsze wskaźniki",
        description:
          "Liczby z migawki okresu - te same, które pokazują pulpit i analityka BI. Każdy kafel prowadzi do szczegółów.",
        editorNote:
          "Jako redaktor widzisz wskaźniki lejka i społeczności. Kwoty i most MRR widzi administrator.",
        sourcesPending:
          "Część źródeł nie jest jeszcze podłączona - kafel bez liczby mówi „brak danych”, a nie zero.",
      },
      flow: {
        title: "Lejek i most MRR",
        description:
          "Skrót zakładek Lejek i Przychód: te same karty i te same dane, w wersji zwartej.",
      },
      system: {
        title: "Stan systemu",
        description:
          "Wynik 0-100 na obszar z reguł diagnostyki: krytyczna diagnoza odejmuje 20, ważna 7. Obszar bez faktów to brak danych, nie 100.",
        unknown: "Nie da się teraz ocenić obszarów - fakty diagnostyki nie dotarły.",
      },
      shortcuts: {
        title: "Ścieżki i społeczność",
      },
      journeys: {
        title: "Ścieżki komunikacji",
        active_one: "{{count}} aktywna ścieżka",
        active_few: "{{count}} aktywne ścieżki",
        active_many: "{{count}} aktywnych ścieżek",
        active_other: "{{count}} aktywnej ścieżki",
        none: "Żadna ścieżka nie jest aktywna - automatyczna komunikacja stoi.",
        enrolled_one: "{{count}} osoba weszła w ścieżki w ostatnich 30 dniach",
        enrolled_few: "{{count}} osoby weszły w ścieżki w ostatnich 30 dniach",
        enrolled_many: "{{count}} osób weszło w ścieżki w ostatnich 30 dniach",
        enrolled_other: "{{count}} osoby weszło w ścieżki w ostatnich 30 dniach",
        goals_one: "{{count}} osiągnięty cel",
        goals_few: "{{count}} osiągnięte cele",
        goals_many: "{{count}} osiągniętych celów",
        goals_other: "{{count}} osiągniętego celu",
        open: "Otwórz Ścieżki",
        forbidden: "Ścieżki widzą administratorzy i redaktorzy.",
        unavailable: "Ścieżki pojawią się po zakończeniu wdrożenia.",
      },
      community: {
        title: "Społeczność w okresie",
        events_one: "{{count}} wydarzenie",
        events_few: "{{count}} wydarzenia",
        events_many: "{{count}} wydarzeń",
        events_other: "{{count}} wydarzenia",
        attendance: "Frekwencja: {{value}}",
        attendanceNone: "Frekwencja: brak danych (nikt się nie zgłosił)",
        members_one: "{{count}} członek klubów",
        members_few: "{{count}} członków klubów",
        members_many: "{{count}} członków klubów",
        members_other: "{{count}} członka klubów",
        pending_one: "{{count}} zgłoszenie czeka na decyzję",
        pending_few: "{{count}} zgłoszenia czekają na decyzję",
        pending_many: "{{count}} zgłoszeń czeka na decyzję",
        pending_other: "{{count}} zgłoszenia czeka na decyzję",
        open: "Otwórz Społeczność",
      },
      gettingStarted: {
        title: "Zacznij tutaj",
        description:
          "Kilka ustawień decyduje o tym, czy hub ma co mierzyć. Każdy krok prowadzi do ekranu, który go ustawia.",
        progress: "Gotowe: {{done}} z {{total}}",
        status: {
          done: "Gotowe",
          todo: "Do zrobienia",
          unknown: "Nie wiadomo",
        },
        step: {
          plans: {
            title: "Plan w sprzedaży",
            hint: "Bez aktywnego planu w sprzedaży czytelnik nie ma czego kupić, a paywall prowadzi donikąd.",
            action: "Dodaj plan w Paywallu",
          },
          metering: {
            title: "Licznik darmowych artykułów",
            hint: "Bez zapisanych ustawień serwer nie liczy darmowych artykułów - ściana działa jak bez licznika.",
            action: "Ustaw licznik",
          },
          retention: {
            title: "Przepływ anulowania",
            hint: "Retencja wyłączona oznacza anulowanie bez propozycji zatrzymania i bez pytania o powód.",
            action: "Włącz retencję w Cenniku",
          },
          journeys: {
            title: "Silnik ścieżek",
            hint: "Wyłączony silnik nie wysyła żadnej ścieżki - nawet aktywnej.",
            action: "Otwórz Ścieżki",
          },
        },
      },
    },
    mrr: {
      kpiHeading: "Wskaźniki przychodu",
      seriesTitle: "MRR w czasie",
      movementsTitle: "Ruchy MRR",
      movementsCaption: "Ruchy MRR w okresie według rodzaju, powodu i waluty",
      reconciliationTitle: "Zgodność źródeł",
      reconciliationHint:
        "Dokumenty sprzedaży porównane z opłaconymi zamówieniami - różnica oznacza zamówienie bez dokumentu albo dokument bez zamówienia.",
      categoriesCaption: "Przychód zrealizowany według kategorii i waluty",
      // Dopisane przez S7-C (zakładka Przychód): sekcje, szereg, ruchy,
      // przychód zrealizowany i zgodność źródeł.
      kpiDescription:
        "Liczby z migawki okresu - te same, które pokazują Kokpit, pulpit i analityka BI.",
      ratioCurrency:
        "Wskaźniki ilorazowe (np. quick ratio, NRR, GRR) liczymy w walucie wiodącej {{currency}} - tej z największym MRR - bez przeliczania pozostałych walut.",
      allSegmentsNote:
        "Filtr segmentu zawęża wskaźniki i most MRR. Szereg MRR, powody odejść i przychód zrealizowany obejmują wszystkie segmenty.",
      ledgerTitle: "Księga MRR",
      ledgerDescription:
        "Stan MRR w czasie, most okresu i ruchy - z księgi ruchów, osobno dla każdej waluty.",
      realizedSection: "Przychód zrealizowany i zgodność źródeł",
      seriesSubtitle: "Punkty: {{grain}}, strefa {{zone}} - księga ruchów i migawka dzienna.",
      seriesGrain: {
        day: "dzienne",
        week: "tygodniowe",
        month: "miesięczne",
      },
      seriesChartTitle: "MRR w {{currency}}",
      seriesBucket: "Początek punktu",
      seriesEmpty:
        "Księga nie ma jeszcze punktów w tym okresie - szereg pojawi się z pierwszym ruchem MRR.",
      seriesDriftMax: "Największa różnica migawki i księgi: {{amount}} ({{date}}).",
      seriesDriftNone: "Migawka dzienna zgadza się z księgą w każdym punkcie, który ją ma.",
      seriesSnapshotMissing: "Część punktów nie ma migawki dziennej - tam rysujemy tylko księgę.",
      movementKindColumn: "Rodzaj ruchu",
      movementReasonColumn: "Powód",
      allReasons: "Wszystkie powody",
      movementsCount_one: "{{count}} ruch",
      movementsCount_few: "{{count}} ruchy",
      movementsCount_many: "{{count}} ruchów",
      movementsCount_other: "{{count}} ruchu",
      movementsEmpty: "W tym okresie nie było ruchów MRR.",
      reasonsUnavailable:
        "Rozbicia odejść na powody nie udało się teraz wczytać - rodzaje ruchów pochodzą z mostu MRR.",
      reasonsAllSegmentsOnly:
        "Powody odejść liczymy dla wszystkich segmentów - wybierz wszystkie segmenty, żeby je zobaczyć.",
      categoryColumn: "Kategoria",
      currencyColumn: "Waluta",
      totalRow: "Razem w {{currency}}",
      realizedEmpty: "W tym okresie nie opłacono żadnego dokumentu sprzedaży.",
      reconciliationCaption: "Dokumenty sprzedaży i opłacone zamówienia według waluty",
      reconciliationDocuments: "Dokumenty (netto)",
      reconciliationOrders: "Zamówienia (netto)",
      reconciliationDifference: "Różnica",
      reconciliationVerdict: "Werdykt",
      reconciliationEmpty: "W tym okresie nie ma ani dokumentów, ani zamówień do porównania.",
      reconciliationRenewals:
        "Zamówienia z kasy nie obejmują odnowień, więc zwykle są niższe niż dokumenty. Zamówienia wyższe niż dokumenty oznaczają brakujące dokumenty.",
      bridge: {
        chartTitle: "Most MRR · {{currency}}",
        csvStep: "Krok mostu",
        equation: "Początek {{start}} + ruchy {{movements}} = koniec {{end}}",
        startToEnd: "Z {{start}} do {{end}}",
        netNew: "Nowe MRR netto: {{amount}}",
        openFull: "Pełny most",
        noSubscriptions:
          "W tym okresie nie było aktywnych subskrypcji - mostu nie ma z czego zbudować.",
      },
    },
    retention: {
      kpiHeading: "Wskaźniki retencji",
      cancelFlowTitle: "Przepływ anulowania",
      cancelFlowSteps_one: "{{count}} krok do anulowania",
      cancelFlowSteps_few: "{{count}} kroki do anulowania",
      cancelFlowSteps_many: "{{count}} kroków do anulowania",
      cancelFlowSteps_other: "{{count}} kroku do anulowania",
      winbackTitle: "Powroty w ciągu 12 miesięcy",
      reasonsTitle: "Powody odejść",
      reasonsCaption: "Powody rezygnacji podane w przepływie anulowania",
      cohortsCaption: "Udział aktywnych klientów kohorty w kolejnych miesiącach",
      notGivenOutsideRanking:
        "Odpowiedzi bez podanego powodu są policzone osobno - poza rankingiem powodów.",
      stripePortalReason: "Portal Stripe: {{code}}",
      // Dopisane przez S7-C (zakładka Retencja): sekcje, trend odejść,
      // kohorty, przepływ anulowania i ranking powodów.
      kpiDescription:
        "Odejścia, retencja przychodu i zatrzymania z migawki okresu - te same liczby co w analityce BI.",
      allSegmentsNote:
        "Filtr segmentu zawęża tylko wskaźniki. Odejścia, kohorty, przepływ anulowania i windykacja obejmują wszystkie segmenty.",
      churnSection: "Odejścia i kohorty",
      saveSection: "Anulowanie, powody i windykacja",
      trendCaption: "Retencja przychodu według waluty - ten okres i poprzedni",
      previousValue: "poprzednio {{value}}",
      cohortsRange: "Kohorty od {{from}} do {{to}} - zakres kończy się na wybranym okresie.",
      cohortsEmpty:
        "Brak kohort w tym zakresie - kohorta powstaje z pierwszym nowym zakupem w miesiącu.",
      cohortsNotElapsed: "Puste pola to miesiące, które jeszcze nie minęły - to nie jest zero.",
      offersTitle: "Oferty zatrzymania i wyniki",
      flowOff:
        "Retencja jest wyłączona: anulowanie to jedno potwierdzenie, bez pytania o powód i bez oferty.",
      flowStepReason: "Powód (opcjonalny) i komentarz",
      flowStepOffer_one: "Oferta: {{pct}} % rabatu przez {{count}} okres rozliczeniowy",
      flowStepOffer_few: "Oferta: {{pct}} % rabatu przez {{count}} okresy rozliczeniowe",
      flowStepOffer_many: "Oferta: {{pct}} % rabatu przez {{count}} okresów rozliczeniowych",
      flowStepOffer_other: "Oferta: {{pct}} % rabatu przez {{count}} okresu rozliczeniowego",
      flowStepConfirm: "Potwierdzenie anulowania",
      flowOfferEligible: "Oferta pojawia się tylko klientom, którym przysługuje.",
      flowExitAlways:
        "„Anuluj mimo to” jest dostępne na każdym kroku - ankieta i oferta nie blokują wyjścia.",
      reasonRank: "Miejsce",
      reasonColumn: "Powód",
      responsesColumn: "Odpowiedzi",
      shareColumn: "Udział",
      reasonsEmpty: "W tym okresie nikt nie podał powodu rezygnacji.",
    },
    metrics: {
      title: "Słownik wskaźników",
      valuesNote:
        "Wartości z migawki wybranego okresu - ocena względem benchmarku z rejestru wskaźników.",
      missingReason: "Brak danych: {{reason}}",
      inputsLink: "Uzupełnij dane wejściowe",
      sheetTitle: "Wskaźnik: {{name}}",
      contextLabel: "Kontekst porównania",
    },
    communityTab: {
      sectionLabel: "Sekcja społeczności",
      journeysNote:
        "Przypomnienia przed wydarzeniem i odpowiedzi na zgłoszenia do klubów wysyłają ścieżki komunikacji.",
    },
    funnelTab: {
      trackLabel: "Tor lejka",
      map: {
        title: "Mapa lejka",
        description:
          "Od nowego konta przez paywall i kasę do płatności. Udział liczymy tylko w obrębie jednej populacji.",
        listLabel: "Kroki lejka samoobsługowego",
        empty: "W tym okresie lejek jest pusty - nie powstało konto ani zamówienie.",
        ofPrevious: "Udział w poprzednim kroku: {{percent}}",
        selfServeOff:
          "Tor samoobsługi jest wyłączony wyborem toru - wybierz „Samoobsługa” albo „Oba tory”.",
        openStage: "Szczegóły kroku: {{stage}}",
        openTab: "Pełny lejek",
      },
      stage: {
        activation: "Aktywacja",
        activationUndefined: "brak definicji",
        activationNote:
          "Aktywacja nie ma jeszcze uzgodnionej definicji (decyzja D-02), więc lejek jej nie liczy - zamiast zgadywać.",
      },
      sheet: {
        title: "Krok lejka: {{stage}}",
        value: "Liczba w okresie",
        rate: "Udział w poprzednim kroku",
        noRate:
          "Ten krok nie ma udziału w poprzednim - liczy inną jednostkę albo pochodzi z innej populacji.",
        stream: "Źródło danych",
        streamFirstParty: "Analityka pierwszej strony (tylko osoby ze zgodą)",
        streamLifecycle: "Księga zdarzeń konta i zamówień",
        open: "Otwórz moduł",
      },
      pair: {
        title: "Paywall: zasięg i konwersja razem",
        description:
          "Wysoki zasięg przy niskiej konwersji to ściana bez dobrej oferty; wysoka konwersja przy małym zasięgu - ściana, do której mało kto dociera.",
        hits: "{{hit}} z {{active}} aktywnych kont trafiło na paywall",
        converted: "{{converted}} z {{hit}} kont kupiło po paywallu",
        guests: "Goście zatrzymani przez paywall: {{count}}",
      },
      sources: {
        title: "Źródła rejestracji",
        caption: "Nowe konta w okresie według miejsca rejestracji",
        source: "Źródło",
        accounts: "Konta",
        share: "Udział",
        formsTitle: "Formularze i okienka zapisu",
        formsRate: "Konwersja formularzy: {{value}}",
        formsRateNone: "Konwersja formularzy: brak danych (nikt nie otworzył formularza)",
      },
      stageTime: {
        title: "Czas między krokami",
        noSource:
          "Brak danych: lejek nie zapisuje jeszcze chwili przejścia między krokami, więc czasu nie da się policzyć - to nie jest zero.",
      },
      sales: {
        listLabel: "Etapy toru sprzedaży",
        empty: "W tym okresie żaden lead nie wszedł w kolejny etap.",
        tasks: "Zadania zespołu",
        open: "Otwórz lejek CRM",
      },
    },
    accessTab: {
      policy: {
        title: "Polityka dostępu",
        rules_one: "{{count}} treść ma regułę dostępu",
        rules_few: "{{count}} treści mają regułę dostępu",
        rules_many: "{{count}} treści ma regułę dostępu",
        rules_other: "{{count}} treści ma regułę dostępu",
        modes:
          "(publiczne: {{public}}, dla zalogowanych: {{members}}, płatne: {{paid}}, na hasło: {{password}}).",
        rankGated_one: "{{count}} z nich wymaga konkretnej warstwy.",
        rankGated_few: "{{count}} z nich wymagają konkretnej warstwy.",
        rankGated_many: "{{count}} z nich wymaga konkretnej warstwy.",
        rankGated_other: "{{count}} z nich wymaga konkretnej warstwy.",
        noRules: "Żadna treść nie ma reguły dostępu - wszystko jest publiczne.",
        meteringUnknown: "Stanu licznika darmowych artykułów nie udało się odczytać.",
        meteringMissing:
          "Licznik darmowych artykułów nie ma zapisanych ustawień - serwer nie liczy żadnych odsłon.",
        meteringOff: "Licznik darmowych artykułów jest wyłączony.",
        meteringMembers_one: "Licznik daje zalogowanym {{count}} darmowy artykuł w miesiącu,",
        meteringMembers_few: "Licznik daje zalogowanym {{count}} darmowe artykuły w miesiącu,",
        meteringMembers_many: "Licznik daje zalogowanym {{count}} darmowych artykułów w miesiącu,",
        meteringMembers_other: "Licznik daje zalogowanym {{count}} darmowego artykułu w miesiącu,",
        meteringGuests_one: "a gościom {{count}}.",
        meteringGuests_few: "a gościom {{count}}.",
        meteringGuests_many: "a gościom {{count}}.",
        meteringGuests_other: "a gościom {{count}}.",
        meteringGuestsNone: "a goście nie dostają żadnego.",
        tiersNone: "Serwis nie ma żadnej warstwy członkostwa.",
        tiersOfferable: "Z {{total}} warstw da się dziś kupić {{count}}.",
        deadEnds_one: "{{count}} bramka nie prowadzi do żadnej oferty.",
        deadEnds_few: "{{count}} bramki nie prowadzą do żadnej oferty.",
        deadEnds_many: "{{count}} bramek nie prowadzi do żadnej oferty.",
        deadEnds_other: "{{count}} bramki nie prowadzi do żadnej oferty.",
        deadEndsNone: "Każda bramka prowadzi do oferty.",
      },
      checklist: {
        title: "Lista kontrolna paywalla",
        description:
          "Te same reguły co w Diagnostyce, zawężone do ściany, licznika i kasy. Pozycja „nie wiadomo” to brak faktu, nie sukces.",
        listLabel: "Pozycje listy kontrolnej",
        summary: "Gotowe: {{done}} z {{total}}",
        status: {
          done: "Gotowe",
          todo: "Do zrobienia",
          snoozed: "Wyciszone",
          unknown: "Nie wiadomo",
        },
        fix: "Napraw",
        unknownAll: "Listy nie da się teraz ocenić - fakty diagnostyki nie dotarły.",
      },
      preview: {
        title: "Symulator czytelnika",
        description:
          "Ta sama ściana co w artykule, oglądana oczami wybranego czytelnika - bez pomiaru, bez zakupu i bez zapisu.",
        scenario: "Rodzaj treści",
        scenarioOption: "{{mode}} · {{threshold}}",
        sampleRule: "Przykładowa treść płatna",
        personaLabel: "Czytelnik",
        persona: {
          guest: "Gość",
          signedIn: "Zalogowany bez planu",
          lowerRank: "Członek niższej warstwy",
          subscriber: "Subskrybent",
          orgMember: "Członek organizacji",
        },
        hasAccess: "Ten czytelnik widzi całą treść - ściana się nie pojawia.",
        noLowerTier: "Serwis nie ma warstwy niższej niż próg tej treści.",
        orgSample: "Instytut Przykładowy",
        sampleTeaser:
          "Zajawka przykładowej analizy - tak czytelnik widzi początek tekstu nad ścianą.",
        frameLabel: "Podgląd ściany dla czytelnika: {{persona}}",
      },
      inventory: {
        caption: "Reguły dostępu według rodzaju treści, trybu, progu warstwy i licznika",
        region: "Inwentarz dostępu - przewiń w poziomie na wąskim ekranie",
      },
      measurement: {
        title: "Pomiar paywalla",
        description:
          "Uderzenia w paywall z ostatnich 30 dni według powodu. Uderzenia zapisuje serwer - także bez zgody analitycznej.",
        caption: "Uderzenia w paywall w ostatnich 30 dniach według powodu",
        reason: "Powód",
        accounts: "Konta",
        visitors: "Goście",
        hits: "Uderzenia",
      },
    },
    offer: {
      salesTitle: "Rabaty i kasa",
      ladder: {
        title: "Drabina cen",
        description:
          "Plany osobno dla każdej waluty, od najniższej warstwy. Kwot w różnych walutach nie porównujemy ani nie sumujemy.",
        caption: "Plany w walucie {{currency}}",
        tier: "Warstwa",
        interval: "Okres",
        price: "Cena",
        sale: "Sprzedaż",
        issues: "Problemy",
        subscriptions: "Płacący",
        forSale: "W sprzedaży",
        notForSale: "Poza sprzedażą",
        inactive: "Wyłączony",
        noIssues: "Bez uwag",
        noTier: "bez warstwy",
        empty: "Serwis nie ma jeszcze żadnego planu.",
      },
      interval: {
        two_weeks: "co 2 tygodnie",
        month: "miesięcznie",
        quarter: "kwartalnie",
        year: "rocznie",
        one_time: "jednorazowo",
      },
      matrix: {
        title: "Plany × benefity",
        description:
          "Co karta cennika obiecuje, a co warstwa planu naprawdę włącza. Konflikt P20 to obietnica bez uprawnienia albo uprawnienie bez bramki w systemie.",
        caption: "Benefity obiecane w cenniku i uprawnienia warstwy dla każdego aktywnego planu",
        capability: "Uprawnienie",
        conflicts_one: "{{count}} konflikt obietnicy (P20)",
        conflicts_few: "{{count}} konflikty obietnic (P20)",
        conflicts_many: "{{count}} konfliktów obietnic (P20)",
        conflicts_other: "{{count}} konfliktu obietnic (P20)",
        noConflicts: "Każda obietnica karty cennika ma uprawnienie w warstwie.",
        cell: {
          ok: "Obiecane i działa",
          broken: "Obiecane, a warstwa tego nie włącza",
          decorative: "Obiecane bez bramki w systemie",
          silent: "Działa, ale karta tego nie obiecuje",
          none: "Nie dotyczy",
        },
        noTier: "Plan bez warstwy - nie sprzedaje żadnego uprawnienia.",
        plan: "{{tier}} · {{interval}}",
        edit: "Edytuj plan",
        editPlan: "Edytuj plan: {{plan}}",
        fixBenefits: "Popraw benefity w Cenniku",
        empty: "Brak aktywnych planów - macierz nie ma kolumn.",
      },
      discounts: {
        title: "Rabaty i kupony",
        description:
          "Kody, kampanie dla instytucji i skuteczność rabatów prowadzi moduł kuponów - hub tylko je pokazuje.",
        codes: "Kody i kupony",
        campaigns: "Kampanie dla instytucji",
        analytics: "Skuteczność kuponów",
      },
      checkout: {
        title: "Kasa w jednym zdaniu",
        currencies: "Kasa obciąża w walutach: {{currencies}}.",
        currenciesNone: "Kasa nie ma jeszcze żadnej waluty obciążenia.",
        abandon: "Porzucenie liczymy po {{duration}} bez płatności,",
        abandonDefault: "Porzucenie liczymy po domyślnej dobie bez płatności,",
        journeyOn: "a porzucony koszyk obsługuje aktywna ścieżka komunikacji.",
        journeyOff: "a porzuconego koszyka nie obsługuje żadna aktywna ścieżka.",
        unknown: "Ustawień kasy nie udało się teraz odczytać.",
        open: "Ustawienia kasy",
      },
    },
    inputs: {
      title: "Plan, koszty i marże",
      description:
        "Liczby, których system nie zna sam. Zapis dotyczy jednego miesiąca, segmentu i waluty; puste pole usuwa wartość.",
      month: "Miesiąc",
      currency: "Waluta danych",
      caption: "Dane wejściowe na {{month}} - segment: {{segment}}",
      kind: "Rodzaj danej",
      value: "Wartość",
      updated: "Ostatnia zmiana",
      action: "Zapis",
      never: "Brak wpisu",
      save: "Zapisz",
      saving: "Zapisywanie…",
      amountLabel: "Kwota w {{currency}}",
      ratioLabel: "Udział w procentach",
      countLabel: "Liczba klientów",
      noteLabel: "Notatka do: {{kind}}",
      noteCount: "{{count}} z {{max}} znaków",
      invalidAmount: "Wpisz kwotę nieujemną, np. 1250,50.",
      invalidCount: "Wpisz liczbę całkowitą klientów, np. 12.",
      invalidRatio: "Wpisz udział od -100 do 100.",
      noCurrency: "Najpierw dodaj plan z ceną - waluta danych wejściowych to waluta rynku planu.",
      ratioNoCurrency: "bez waluty",
      conflictYours: "Twoja wartość: {{value}}",
      conflictCurrent: "Aktualna wartość: {{value}}",
      emptyValue: "pusto",
    },
  },
};

const en: typeof pl = {
  adminRevenue: {
    overview: {
      state: {
        error: "This card's data could not be loaded. Try again in a moment.",
        retry: "Try again",
        noTenant: "Choose a workspace to see the hub data.",
      },
      kpi: {
        title: "Key indicators",
        description:
          "Figures from the period snapshot - the same ones the dashboard and BI analytics show. Each tile leads to the details.",
        editorNote:
          "As an editor you see funnel and community indicators. Amounts and the MRR bridge are for administrators.",
        sourcesPending:
          "Some sources are not connected yet - a tile without a figure says “no data”, not zero.",
      },
      flow: {
        title: "Funnel and MRR bridge",
        description:
          "A summary of the Funnel and Revenue tabs: the same cards and the same data, in a compact version.",
      },
      system: {
        title: "System health",
        description:
          "A 0-100 score per area from the diagnostic rules: a critical finding costs 20, a warning 7. An area without facts has no data, not 100.",
        unknown: "Areas cannot be assessed right now - the diagnostic facts did not arrive.",
      },
      shortcuts: {
        title: "Journeys and community",
      },
      journeys: {
        title: "Communication journeys",
        active_one: "{{count}} active journey",
        active_few: "{{count}} active journeys",
        active_many: "{{count}} active journeys",
        active_other: "{{count}} active journeys",
        none: "No journey is active - automated communication is stopped.",
        enrolled_one: "{{count}} person entered journeys in the last 30 days",
        enrolled_few: "{{count}} people entered journeys in the last 30 days",
        enrolled_many: "{{count}} people entered journeys in the last 30 days",
        enrolled_other: "{{count}} people entered journeys in the last 30 days",
        goals_one: "{{count}} goal reached",
        goals_few: "{{count}} goals reached",
        goals_many: "{{count}} goals reached",
        goals_other: "{{count}} goals reached",
        open: "Open Journeys",
        forbidden: "Journeys are available to administrators and editors.",
        unavailable: "Journeys will appear once the rollout is complete.",
      },
      community: {
        title: "Community in the period",
        events_one: "{{count}} event",
        events_few: "{{count}} events",
        events_many: "{{count}} events",
        events_other: "{{count}} events",
        attendance: "Attendance: {{value}}",
        attendanceNone: "Attendance: no data (nobody registered)",
        members_one: "{{count}} club member",
        members_few: "{{count}} club members",
        members_many: "{{count}} club members",
        members_other: "{{count}} club members",
        pending_one: "{{count}} application awaits a decision",
        pending_few: "{{count}} applications await a decision",
        pending_many: "{{count}} applications await a decision",
        pending_other: "{{count}} applications await a decision",
        open: "Open Community",
      },
      gettingStarted: {
        title: "Start here",
        description:
          "A few settings decide whether the hub has anything to measure. Each step leads to the screen that sets it.",
        progress: "Done: {{done}} of {{total}}",
        status: {
          done: "Done",
          todo: "To do",
          unknown: "Unknown",
        },
        step: {
          plans: {
            title: "A plan on sale",
            hint: "Without an active plan on sale readers have nothing to buy and the paywall leads nowhere.",
            action: "Add a plan in Paywall",
          },
          metering: {
            title: "Free article meter",
            hint: "Without saved settings the server counts no free articles - the paywall works as if there were no meter.",
            action: "Set up the meter",
          },
          retention: {
            title: "Cancellation flow",
            hint: "With retention off, cancelling offers nothing to stay and never asks why.",
            action: "Turn on retention in Pricing",
          },
          journeys: {
            title: "Journey engine",
            hint: "A stopped engine sends no journey at all - not even an active one.",
            action: "Open Journeys",
          },
        },
      },
    },
    mrr: {
      kpiHeading: "Revenue indicators",
      seriesTitle: "MRR over time",
      movementsTitle: "MRR movements",
      movementsCaption: "MRR movements in the period by kind, reason and currency",
      reconciliationTitle: "Source agreement",
      reconciliationHint:
        "Sales documents compared with paid orders - a difference means an order without a document or a document without an order.",
      categoriesCaption: "Realised revenue by category and currency",
      kpiDescription:
        "Figures from the period snapshot - the same ones shown by Overview, the dashboard and BI analytics.",
      ratioCurrency:
        "Ratio indicators (e.g. quick ratio, NRR, GRR) are computed in the leading currency {{currency}} - the one with the largest MRR - without converting other currencies.",
      allSegmentsNote:
        "The segment choice narrows the indicators and the MRR bridge. The MRR series, churn reasons and realised revenue cover all segments.",
      ledgerTitle: "MRR ledger",
      ledgerDescription:
        "MRR over time, the period bridge and movements - from the movement ledger, separately for each currency.",
      realizedSection: "Realised revenue and source agreement",
      seriesSubtitle: "Points: {{grain}}, time zone {{zone}} - movement ledger and daily snapshot.",
      seriesGrain: {
        day: "daily",
        week: "weekly",
        month: "monthly",
      },
      seriesChartTitle: "MRR in {{currency}}",
      seriesBucket: "Point start",
      seriesEmpty:
        "The ledger has no points in this period yet - the series appears with the first MRR movement.",
      seriesDriftMax: "Largest gap between the snapshot and the ledger: {{amount}} ({{date}}).",
      seriesDriftNone: "The daily snapshot matches the ledger at every point that has one.",
      seriesSnapshotMissing: "Some points have no daily snapshot - only the ledger is drawn there.",
      movementKindColumn: "Movement kind",
      movementReasonColumn: "Reason",
      allReasons: "All reasons",
      movementsCount_one: "{{count}} movement",
      movementsCount_few: "{{count}} movements",
      movementsCount_many: "{{count}} movements",
      movementsCount_other: "{{count}} movements",
      movementsEmpty: "There were no MRR movements in this period.",
      reasonsUnavailable:
        "The churn breakdown by reason could not be loaded right now - movement kinds come from the MRR bridge.",
      reasonsAllSegmentsOnly:
        "Churn reasons are counted across all segments - choose all segments to see them.",
      categoryColumn: "Category",
      currencyColumn: "Currency",
      totalRow: "Total in {{currency}}",
      realizedEmpty: "No sales document was paid in this period.",
      reconciliationCaption: "Sales documents and paid orders by currency",
      reconciliationDocuments: "Documents (net)",
      reconciliationOrders: "Orders (net)",
      reconciliationDifference: "Difference",
      reconciliationVerdict: "Verdict",
      reconciliationEmpty: "There are neither documents nor orders to compare in this period.",
      reconciliationRenewals:
        "Checkout orders exclude renewals, so they usually sit below the documents. Orders above the documents mean missing documents.",
      bridge: {
        chartTitle: "MRR bridge · {{currency}}",
        csvStep: "Bridge step",
        equation: "Opening {{start}} + movements {{movements}} = closing {{end}}",
        startToEnd: "From {{start}} to {{end}}",
        netNew: "Net new MRR: {{amount}}",
        openFull: "Full bridge",
        noSubscriptions:
          "There were no active subscriptions in this period - nothing to build the bridge from.",
      },
    },
    retention: {
      kpiHeading: "Retention indicators",
      cancelFlowTitle: "Cancellation flow",
      cancelFlowSteps_one: "{{count}} step to cancel",
      cancelFlowSteps_few: "{{count}} steps to cancel",
      cancelFlowSteps_many: "{{count}} steps to cancel",
      cancelFlowSteps_other: "{{count}} steps to cancel",
      winbackTitle: "Returns within 12 months",
      reasonsTitle: "Reasons for leaving",
      reasonsCaption: "Cancellation reasons given in the cancellation flow",
      cohortsCaption: "Share of a cohort's customers still active in the following months",
      notGivenOutsideRanking:
        "Answers without a reason are counted separately - outside the reason ranking.",
      stripePortalReason: "Stripe customer portal: {{code}}",
      kpiDescription:
        "Churn, revenue retention and saves from the period snapshot - the same figures as in BI analytics.",
      allSegmentsNote:
        "The segment choice narrows the indicators only. Churn, cohorts, the cancellation flow and dunning cover all segments.",
      churnSection: "Churn and cohorts",
      saveSection: "Cancellation, reasons and dunning",
      trendCaption: "Revenue retention by currency - this period and the previous one",
      previousValue: "previously {{value}}",
      cohortsRange: "Cohorts from {{from}} to {{to}} - the range ends with the selected period.",
      cohortsEmpty:
        "No cohorts in this range - a cohort starts with the first new purchase in a month.",
      cohortsNotElapsed: "Empty cells are months that have not passed yet - they are not zero.",
      offersTitle: "Retention offers and outcomes",
      flowOff:
        "Retention is switched off: cancelling is a single confirmation, with no reason question and no offer.",
      flowStepReason: "Reason (optional) and comment",
      flowStepOffer_one: "Offer: {{pct}}% off for {{count}} billing period",
      flowStepOffer_few: "Offer: {{pct}}% off for {{count}} billing periods",
      flowStepOffer_many: "Offer: {{pct}}% off for {{count}} billing periods",
      flowStepOffer_other: "Offer: {{pct}}% off for {{count}} billing periods",
      flowStepConfirm: "Cancellation confirmation",
      flowOfferEligible: "The offer only appears to customers who are eligible for it.",
      flowExitAlways:
        "“Cancel anyway” is available on every step - the survey and the offer never stand in the way out.",
      reasonRank: "Rank",
      reasonColumn: "Reason",
      responsesColumn: "Answers",
      shareColumn: "Share",
      reasonsEmpty: "Nobody gave a cancellation reason in this period.",
    },
    metrics: {
      title: "Indicator glossary",
      valuesNote:
        "Values from the selected period's snapshot - rated against the benchmark from the indicator registry.",
      missingReason: "No data: {{reason}}",
      inputsLink: "Complete the manual inputs",
      sheetTitle: "Indicator: {{name}}",
      contextLabel: "Comparison context",
    },
    communityTab: {
      sectionLabel: "Community section",
      journeysNote:
        "Reminders before events and replies to club applications are sent by communication journeys.",
    },
    funnelTab: {
      trackLabel: "Funnel track",
      map: {
        title: "Funnel map",
        description:
          "From a new account through the paywall and checkout to payment. Shares are computed within a single population only.",
        listLabel: "Self-service funnel steps",
        empty: "The funnel is empty in this period - no account or order was created.",
        ofPrevious: "Share of the previous step: {{percent}}",
        selfServeOff:
          "The self-service track is switched off by the track choice - pick “Self-service” or “Both tracks”.",
        openStage: "Step details: {{stage}}",
        openTab: "Full funnel",
      },
      stage: {
        activation: "Activation",
        activationUndefined: "no definition",
        activationNote:
          "Activation has no agreed definition yet (decision D-02), so the funnel does not count it - rather than guess.",
      },
      sheet: {
        title: "Funnel step: {{stage}}",
        value: "Count in the period",
        rate: "Share of the previous step",
        noRate:
          "This step has no share of the previous one - it counts a different unit or comes from a different population.",
        stream: "Data source",
        streamFirstParty: "First-party analytics (consenting people only)",
        streamLifecycle: "Account and order event ledger",
        open: "Open the module",
      },
      pair: {
        title: "Paywall: reach and conversion together",
        description:
          "High reach with low conversion is a wall without a good offer; high conversion with low reach is a wall few people get to.",
        hits: "{{hit}} of {{active}} active accounts reached the paywall",
        converted: "{{converted}} of {{hit}} accounts bought after the paywall",
        guests: "Guests stopped by the paywall: {{count}}",
      },
      sources: {
        title: "Sign-up sources",
        caption: "New accounts in the period by sign-up place",
        source: "Source",
        accounts: "Accounts",
        share: "Share",
        formsTitle: "Sign-up forms and pop-ups",
        formsRate: "Form conversion: {{value}}",
        formsRateNone: "Form conversion: no data (nobody opened a form)",
      },
      stageTime: {
        title: "Time between steps",
        noSource:
          "No data: the funnel does not record the moment of moving between steps yet, so the time cannot be computed - this is not zero.",
      },
      sales: {
        listLabel: "Sales track stages",
        empty: "No lead entered a further stage in this period.",
        tasks: "Team tasks",
        open: "Open the CRM funnel",
      },
    },
    accessTab: {
      policy: {
        title: "Access policy",
        rules_one: "{{count}} item has an access rule",
        rules_few: "{{count}} items have an access rule",
        rules_many: "{{count}} items have an access rule",
        rules_other: "{{count}} items have an access rule",
        modes:
          "(public: {{public}}, signed-in readers: {{members}}, paid: {{paid}}, password: {{password}}).",
        rankGated_one: "{{count}} of them requires a specific tier.",
        rankGated_few: "{{count}} of them require a specific tier.",
        rankGated_many: "{{count}} of them require a specific tier.",
        rankGated_other: "{{count}} of them require a specific tier.",
        noRules: "No item has an access rule - everything is public.",
        meteringUnknown: "The free article meter state could not be read.",
        meteringMissing:
          "The free article meter has no saved settings - the server counts no views at all.",
        meteringOff: "The free article meter is off.",
        meteringMembers_one: "The meter gives signed-in readers {{count}} free article a month,",
        meteringMembers_few: "The meter gives signed-in readers {{count}} free articles a month,",
        meteringMembers_many: "The meter gives signed-in readers {{count}} free articles a month,",
        meteringMembers_other: "The meter gives signed-in readers {{count}} free articles a month,",
        meteringGuests_one: "and guests {{count}}.",
        meteringGuests_few: "and guests {{count}}.",
        meteringGuests_many: "and guests {{count}}.",
        meteringGuests_other: "and guests {{count}}.",
        meteringGuestsNone: "and guests get none.",
        tiersNone: "The site has no membership tier.",
        tiersOfferable: "{{count}} of {{total}} tiers can be bought today.",
        deadEnds_one: "{{count}} gate leads to no offer.",
        deadEnds_few: "{{count}} gates lead to no offer.",
        deadEnds_many: "{{count}} gates lead to no offer.",
        deadEnds_other: "{{count}} gates lead to no offer.",
        deadEndsNone: "Every gate leads to an offer.",
      },
      checklist: {
        title: "Paywall checklist",
        description:
          "The same rules as in Diagnostics, narrowed to the wall, the meter and checkout. An “unknown” item is a missing fact, not a success.",
        listLabel: "Checklist items",
        summary: "Done: {{done}} of {{total}}",
        status: {
          done: "Done",
          todo: "To do",
          snoozed: "Snoozed",
          unknown: "Unknown",
        },
        fix: "Fix",
        unknownAll:
          "The checklist cannot be assessed right now - the diagnostic facts did not arrive.",
      },
      preview: {
        title: "Reader simulator",
        description:
          "The same wall as in an article, seen through the eyes of a chosen reader - with no measurement, no purchase and no saving.",
        scenario: "Kind of item",
        scenarioOption: "{{mode}} - {{threshold}}",
        sampleRule: "Sample paid item",
        personaLabel: "Reader",
        persona: {
          guest: "Guest",
          signedIn: "Signed in, no plan",
          lowerRank: "Lower-tier member",
          subscriber: "Subscriber",
          orgMember: "Organisation member",
        },
        hasAccess: "This reader sees the whole item - the wall does not appear.",
        noLowerTier: "The site has no tier below this item's threshold.",
        orgSample: "Sample Institute",
        sampleTeaser:
          "Teaser of a sample analysis - this is how a reader sees the text above the wall.",
        frameLabel: "Wall preview for the reader: {{persona}}",
      },
      inventory: {
        caption: "Access rules by kind of item, mode, tier threshold and meter",
        region: "Access inventory - scroll sideways on a narrow screen",
      },
      measurement: {
        title: "Paywall measurement",
        description:
          "Paywall hits in the last 30 days by reason. Hits are recorded by the server - also without analytics consent.",
        caption: "Paywall hits in the last 30 days by reason",
        reason: "Reason",
        accounts: "Accounts",
        visitors: "Guests",
        hits: "Hits",
      },
    },
    offer: {
      salesTitle: "Discounts and checkout",
      ladder: {
        title: "Price ladder",
        description:
          "Plans per currency, from the lowest tier up. Amounts in different currencies are neither compared nor added up.",
        caption: "Plans in {{currency}}",
        tier: "Tier",
        interval: "Period",
        price: "Price",
        sale: "On sale",
        issues: "Issues",
        subscriptions: "Paying",
        forSale: "On sale",
        notForSale: "Off sale",
        inactive: "Switched off",
        noIssues: "No remarks",
        noTier: "no tier",
        empty: "The site has no plan yet.",
      },
      interval: {
        two_weeks: "every 2 weeks",
        month: "monthly",
        quarter: "quarterly",
        year: "yearly",
        one_time: "one-off",
      },
      matrix: {
        title: "Plan × benefit",
        description:
          "What the pricing card promises versus what the plan's tier really enables. A P20 conflict is a promise without an entitlement, or an entitlement without a gate in the system.",
        caption: "Benefits promised on the pricing page and tier entitlements for each active plan",
        capability: "Entitlement",
        conflicts_one: "{{count}} promise conflict (P20)",
        conflicts_few: "{{count}} promise conflicts (P20)",
        conflicts_many: "{{count}} promise conflicts (P20)",
        conflicts_other: "{{count}} promise conflicts (P20)",
        noConflicts: "Every promise on the pricing card has an entitlement in its tier.",
        cell: {
          ok: "Promised and working",
          broken: "Promised, but the tier does not enable it",
          decorative: "Promised with no gate in the system",
          silent: "Working, but the card does not promise it",
          none: "Not applicable",
        },
        noTier: "Plan without a tier - it sells no entitlement.",
        plan: "{{tier}} - {{interval}}",
        edit: "Edit plan",
        editPlan: "Edit plan: {{plan}}",
        fixBenefits: "Fix benefits in Pricing",
        empty: "No active plans - the matrix has no columns.",
      },
      discounts: {
        title: "Discounts and coupons",
        description:
          "Codes, institutional campaigns and discount performance are run by the coupons module - the hub only shows them.",
        codes: "Codes and coupons",
        campaigns: "Institutional campaigns",
        analytics: "Coupon performance",
      },
      checkout: {
        title: "Checkout in one sentence",
        currencies: "Checkout charges in: {{currencies}}.",
        currenciesNone: "Checkout has no charge currency yet.",
        abandon: "An order counts as abandoned after {{duration}} without payment,",
        abandonDefault: "An order counts as abandoned after the default day without payment,",
        journeyOn: "and an active communication journey follows up abandoned carts.",
        journeyOff: "and no active journey follows up abandoned carts.",
        unknown: "Checkout settings could not be read right now.",
        open: "Checkout settings",
      },
    },
    inputs: {
      title: "Plan, costs and margins",
      description:
        "Figures the system cannot know by itself. A save covers one month, segment and currency; an empty field removes the value.",
      month: "Month",
      currency: "Data currency",
      caption: "Manual inputs for {{month}} - segment: {{segment}}",
      kind: "Kind of input",
      value: "Value",
      updated: "Last change",
      action: "Save",
      never: "No entry",
      save: "Save",
      saving: "Saving…",
      amountLabel: "Amount in {{currency}}",
      ratioLabel: "Share in percent",
      countLabel: "Number of customers",
      noteLabel: "Note for: {{kind}}",
      noteCount: "{{count}} of {{max}} characters",
      invalidAmount: "Enter a non-negative amount, e.g. 1250.50.",
      invalidCount: "Enter a whole number of customers, e.g. 12.",
      invalidRatio: "Enter a share from -100 to 100.",
      noCurrency:
        "Add a priced plan first - the input currency is the currency of the plan's market.",
      ratioNoCurrency: "no currency",
      conflictYours: "Your value: {{value}}",
      conflictCurrent: "Current value: {{value}}",
      emptyValue: "empty",
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

/** Słowniki wprost - test parytetu zakładek czyta je bez instancji i18next. */
export const revenueTabsDictionaries = { pl, en } as const;
