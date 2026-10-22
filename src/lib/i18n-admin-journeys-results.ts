// i18n wyników ścieżki (S8-B): widok „Wyniki” edytora, zakładki „Wyniki”
// i „Kontakty” panelu kroku, nakładka statystyk na kanwie i karta „Ścieżki”
// kontaktu w CRM.
//
// ZERO KOLIZJI Z S5 I S8-A. Etykiety statusów zapisu, powodów wyjścia, wyników
// kroku, typów kroków i gałęzi czytamy ze słownika silnika
// (`i18n-admin-journeys.ts`: `enrollmentStatus`, `exitReason`, `stepOutcome`,
// `nodeType`, `branch`), a wspólne napisy panelu z `adminJourneys.common`
// (S8-A: „Spróbuj ponownie”, „Anuluj”, operacje „Zostaw wariant A/B”). Tu
// wyłącznie NOWE gałęzie: `results`, `nodeResults`, `enrollments`,
// `statsOverlay`, `lead`.
//
// BEZ LICZB BENCHMARKÓW. Pasma i oceny przychodzą z rejestru S6
// (`useBenchmark`), więc słownik nie niesie żadnej liczby z badań - tylko
// opisy, które mówią, z czym porównujemy (np. „benchmark kampanii”).
//
// LICZEBNIKI: PL `_one/_few/_many/_other`, EN `_one/_other`; `typeof pl`
// wymaga form polskich także w EN (angielski czyta tylko `_one`/`_other`).
//
// UWAGA NA ARKUSZ CSS (jak `i18n-admin-journeys-list.ts`): angielskie słowo
// równe klasie narzędziowej Tailwinda dokłada regułę do publicznego CSS -
// napisy niżej omijają takie słowa (sprawdzone kompilacją kandydatów).
//
// IMPORT WYŁĄCZNIE Z KOMPONENTÓW (`ensureI18n()`), nie z pliku trasy.
import i18n from "@/lib/i18n";

const pl = {
  adminJourneys: {
    results: {
      title: "Wyniki ścieżki",
      description:
        "Wejścia, cele, przejścia kroków, powody wyjścia, test A/B i maile w wybranym oknie. Zapisy testowe są wykluczone.",
      window: "Okno: {{since}} - {{until}}",
      versionAll: "wszystkie wersje",
      versionValue: "wersja {{version}}",
      loading: "Wczytywanie wyników…",
      loadError: "Nie udało się wczytać wyników ścieżki.",
      unavailableTitle: "Statystyki ścieżek nie są jeszcze wdrożone w tej bazie.",
      unavailableNext:
        "Następny krok: wdrożenie migracji silnika ścieżek - wyniki pojawią się tu bez zmian w panelu.",
      notFound: "Nie znaleziono tej ścieżki - mogła zostać usunięta albo należy do innego zespołu.",
      empty: "W wybranym oknie nikt nie wszedł na tę ścieżkę.",
      emptyNext:
        "Następny krok: opublikuj ścieżkę i włącz silnik w ustawieniach albo wybierz dłuższe okno statystyk.",
      stepLabel: "Krok {{number}}: {{type}}",
      stepOutside: "{{type}} (spoza bieżącej wersji)",
      kpi: {
        enrolled: "Wejścia",
        active: "W toku",
        activeHint: "w tym czeka: {{count}}",
        goalReached: "Cel osiągnięty",
        goalRate: "Konwersja do celu",
        exited: "Wyjścia",
        partial:
          "Z zestawienia dziennego - zapisy usunięte przez retencję przed jego wdrożeniem nie są liczone.",
        goalNote: "Cel przypisany ścieżce, nie dowód, że go spowodowała.",
      },
      rollup: {
        title: "Starsze okno - dane z zestawienia dziennego",
        body: "Okno sięga dni, których surowe zapisy usunęła retencja. Liczniki kroków i maili oraz podsumowanie zapisów (wejścia, cele, wyjścia) pochodzą z zestawienia dziennego; kontakty w toku i warianty A/B - z zachowanych zapisów.",
        since: "Pełne dane od {{date}}.",
        sinceUnknown:
          "Datę, od której dane są pełne, pokazuje administratorowi karta „Retencja danych”.",
      },
      trend: {
        title: "Wejścia, cele i wyjścia dziennie",
        subtitle: "Liczba zapisów w kolejnych dniach okna",
        enrolled: "Wejścia",
        goalReached: "Cel osiągnięty",
        exited: "Wyjścia",
        empty: "Brak wejść, celów i wyjść w dniach tego okna.",
        loadError: "Nie udało się wczytać serii dziennej.",
        gap: "Dni przed {{date}} nie mają danych dziennych (retencja) - na wykresie są przerwą, nie zerem.",
      },
      funnel: {
        title: "Przejścia kroków",
        description:
          "Ile zapisów weszło do każdego kroku, w kolejności numeracji. Udział liczymy względem kroku nadrzędnego.",
        list: "Kroki ścieżki z liczbą wejść",
        empty: "Żaden krok nie ma jeszcze wejść w tym oknie.",
        ofParent: "{{percent}} z kroku nadrzędnego",
        merge: "Łączy gałęzie - bez jednego mianownika.",
      },
      exits: {
        title: "Powody wyjścia",
        subtitle: "Zapisy zakończone przed końcem ścieżki, według powodu",
        series: "Wyjścia",
        empty: "W tym oknie nikt nie wyszedł ze ścieżki przed jej końcem.",
      },
      ab: {
        title: "Test A/B - krok {{number}}",
        titleOutside: "Test A/B - krok spoza bieżącej wersji",
        metricGoal: "Miara zwycięzcy: cel ścieżki",
        metricClick: "Miara zwycięzcy: kliknięcia w mailach",
        caption: "Wyniki wariantów testu A/B",
        columns: {
          variant: "Wariant",
          entered: "Wejścia",
          conversions: "Konwersje",
          rate: "Udział",
        },
        noData: "Brak danych wariantów w tym oknie.",
        insufficient: "Za mało danych (n < {{min}})",
        equal: "Brak różnicy między wariantami",
        better: "{{variant}} lepsze o {{pp}} pp ({{level}} %)",
        notSignificant: "{{variant}} lepsze o {{pp}} pp - różnica nieistotna statystycznie",
        hint: "Zwycięzcę oceniaj po kliknięciach albo celu, nie po otwarciach - Apple MPP zawyża otwarcia.",
        keepHint:
          "Wybór wariantu zapisuje nowy szkic z wagami 100/0 - nie publikuje. Gałęzie i statystyki obu wariantów zostają.",
        confirmTitle: "Zostawić wariant {{variant}}?",
        confirmBody:
          "Powstanie szkic, w którym wariant {{variant}} dostaje cały ruch podziału. Opublikowana wersja działa dalej, dopóki nie opublikujesz szkicu.",
        saved: "Zapisano szkic z wariantem {{variant}} - opublikuj go w edytorze.",
        conflict:
          "Szkic zmienił się w innej karcie - wczytaliśmy aktualny. Wybierz wariant jeszcze raz.",
        draftInvalid: "Szkic jest niekompletny - napraw go w edytorze, zanim zostawisz wariant.",
        nodeMissing: "Tego kroku nie ma już w szkicu.",
        opError: "Nie udało się zmienić wag w szkicu.",
        saveError: "Nie udało się zapisać szkicu.",
        readOnly: "Wybór wariantu zapisuje szkic - wymaga roli administratora albo redaktora.",
      },
      emails: {
        title: "Maile ścieżki",
        description:
          "Wysyłki kroków w oknie. Oceny pochodzą z rejestru benchmarków; otwarcia ludzkie i CTOR to górna granica.",
        caption: "Maile kroków ścieżki - liczby w oknie, bez zapisów testowych",
        scrollRegion: "Maile kroków (przewijane w poziomie)",
        columns: {
          step: "Krok",
          queued: "W kolejce",
          sent: "Wysłane",
          humanOpens: "Otwarcia ludzkie",
          clicks: "Kliknięcia",
          ctor: "CTOR",
          unsubscribed: "Wypisy",
          bounced: "Odbicia",
          complained: "Skargi",
          fallbackLocale: "PL zamiast EN",
        },
        empty: "Ta wersja ścieżki nie wysyła maili.",
        noSends: "Brak wysyłek w oknie",
        subjectMissing: "bez tematu",
        mppLabel: "Górna granica - Apple MPP",
        mppBody:
          "Apple Mail Privacy Protection otwiera maile automatycznie. Odsiewamy otwarcia szybsze niż próg z ustawień silnika, ale część automatycznych otwarć zostaje - otwarcia ludzkie i CTOR to górna granica.",
        campaignBench: "Benchmark kampanii newslettera - maile ścieżek zwykle wypadają wyżej.",
        fallbackHint: "Kontakty anglojęzyczne, które dostały wersję polską (brak tematu EN).",
      },
    },
    nodeResults: {
      title: "Wyniki kroku",
      description: "Liczby kroku w oknie statystyk; zapisy testowe są wykluczone.",
      entered: "Weszło",
      succeeded: "Wykonane",
      skipped: "Pominięte",
      failed: "Błędy (ponawiane)",
      dead: "Porzucone po próbach",
      waitingNow: "Czeka teraz",
      waitingRollup: "Czekających nie liczy zestawienie dzienne - wybierz krótsze okno.",
      counts: "Liczby kroku",
      outcomes: "Rozkład wyników wykonania",
      outcomesCaption: "Wyniki wykonania kroku i ich liczba",
      outcome: "Wynik",
      count: "Liczba",
      outcomesEmpty: "Krok nie zapisał jeszcze wyników.",
      outcomeOther: "Inny wynik: {{code}}",
      email: "Mail kroku",
      emailEmpty: "Ten mail nie miał wysyłek w oknie.",
      notInStats: "Ten krok nie miał wejść w wybranym oknie.",
    },
    enrollments: {
      title: "Kontakty na ścieżce",
      description:
        "Zapisy kontaktów na ścieżkę - aktualny krok, status i powód wyjścia. Adresy widzi tylko zespół CRM.",
      statusFilter: "Status zapisu",
      statusAll: "Wszystkie statusy",
      caption: "Zapisy kontaktów na ścieżkę",
      scrollRegion: "Zapisy kontaktów (przewijane w poziomie)",
      columns: {
        contact: "Kontakt",
        status: "Status",
        step: "Krok",
        entered: "Wejście",
        next: "Następny krok",
        reason: "Powód wyjścia",
        version: "Wersja",
        actions: "Akcje",
      },
      test: "Test",
      versionValue: "v{{version}}",
      total_one: "{{value}} zapis",
      total_few: "{{value}} zapisy",
      total_many: "{{value}} zapisów",
      total_other: "{{value}} zapisu",
      pagination: "Strony zapisów",
      pageOf: "Strona {{page}} z {{pages}}",
      prev: "Poprzednia strona",
      next: "Następna strona",
      loading: "Wczytywanie kontaktów…",
      loadError: "Nie udało się wczytać kontaktów ścieżki.",
      unavailable: "Lista kontaktów ścieżki nie jest jeszcze wdrożona w tej bazie.",
      empty: "Brak zapisów o tym statusie.",
      emptyNode: "Na tym kroku nie ma zapisów o tym statusie.",
      openLead: "Otwórz kartę kontaktu {{name}}",
      exit: "Wyjmij",
      exitFor: "Wyjmij kontakt {{name}} ze ścieżki",
      exitConfirmTitle: "Wyjąć kontakt ze ścieżki?",
      exitConfirmBody:
        "{{name}} kończy ścieżkę z powodem „{{reason}}”. Kolejne kroki tego zapisu się nie wykonają.",
      exitConfirm: "Wyjmij ze ścieżki",
      exitDone: "Kontakt wyjęty ze ścieżki.",
      exitError: "Nie udało się wyjąć kontaktu ze ścieżki.",
      skip: "Pomiń czekanie",
      skipFor: "Pomiń czekanie kontaktu {{name}}",
      skipAdminOnly: "Pominięcie czekania może wykonać tylko administrator.",
      skipConfirmTitle: "Pominąć czekanie?",
      skipConfirmBody:
        "Krok czekania kończy się od razu - {{name}} przejdzie dalej przy najbliższym przebiegu silnika.",
      skipConfirm: "Pomiń czekanie",
      skipDone: "Czekanie pominięte.",
      skipError: "Nie udało się pominąć czekania.",
    },
    statsOverlay: {
      legend:
        "Otwarcia ludzkie i CTOR na kanwie to górna granica (Apple MPP). Otwarcia i kliknięcia liczymy tylko u odbiorców ze zgodą na pomiar.",
      chip: {
        entered: "Wejścia: {{value}}",
        sent: "Wysłane: {{value}}",
        waiting: "Czeka teraz: {{value}}",
        opens:
          "Otwarcia ludzkie: {{value}} - górna granica (Apple MPP), tylko odbiorcy ze zgodą na pomiar",
        clicks: "Kliknięcia: {{value}} - tylko odbiorcy ze zgodą na pomiar",
        ctor: "CTOR: {{value}} - górna granica (Apple MPP), benchmark kampanii",
      },
      aria: {
        entered_one: "{{value}} wejście",
        entered_few: "{{value}} wejścia",
        entered_many: "{{value}} wejść",
        entered_other: "{{value}} wejścia",
        sent_one: "{{value}} wysłany",
        sent_few: "{{value}} wysłane",
        sent_many: "{{value}} wysłanych",
        sent_other: "{{value}} wysłanego",
        withWaiting: "{{base}}, czeka: {{waiting}}",
      },
    },
    lead: {
      title: "Ścieżki",
      description: "Ścieżki komunikacji, na których jest ten kontakt.",
      list: "Zapisy kontaktu na ścieżki",
      step: "Bieżący krok: {{node}}",
      entered: "Wejście: {{date}}",
      finished: "Koniec: {{date}}",
      reason: "Powód wyjścia: {{reason}}",
      version: "wersja {{version}}",
      test: "Test",
      open: "Pokaż w edytorze ścieżki „{{name}}”",
      loading: "Wczytywanie ścieżek kontaktu…",
      loadError: "Nie udało się wczytać ścieżek kontaktu.",
      unavailable: "Ścieżki komunikacji nie są jeszcze wdrożone w tej bazie.",
      empty: "Ten kontakt nie jest na żadnej ścieżce.",
      emptyNext:
        "Następny krok: zainstaluj ścieżkę z galerii szablonów - kontakty wejdą na nią po zdarzeniu wyzwalacza.",
      gallery: "Galeria szablonów ścieżek",
      exitFor: "Wyjmij kontakt ze ścieżki „{{name}}”",
      exitConfirmBody:
        "Kontakt kończy ścieżkę „{{name}}” z powodem „{{reason}}”. Kolejne kroki tego zapisu się nie wykonają.",
      skipFor: "Pomiń czekanie na ścieżce „{{name}}”",
      skipConfirmBody:
        "Krok czekania na ścieżce „{{name}}” kończy się od razu - kontakt przejdzie dalej przy najbliższym przebiegu silnika.",
    },
  },
};

const en: typeof pl = {
  adminJourneys: {
    results: {
      title: "Journey results",
      description:
        "Entries, goals, step transitions, exit reasons, the A/B test and emails in the chosen window. Test enrolments are excluded.",
      window: "Window: {{since}} - {{until}}",
      versionAll: "all versions",
      versionValue: "version {{version}}",
      loading: "Loading results…",
      loadError: "Could not load the journey results.",
      unavailableTitle: "Journey statistics are not deployed in this database yet.",
      unavailableNext:
        "Next step: deploy the journey engine migrations - results will appear here with no change to the panel.",
      notFound: "This journey was not found - it may have been deleted or belongs to another team.",
      empty: "Nobody entered this journey in the chosen window.",
      emptyNext:
        "Next step: publish the journey and switch the engine on in the settings, or choose a longer statistics window.",
      stepLabel: "Step {{number}}: {{type}}",
      stepOutside: "{{type}} (not in the current version)",
      kpi: {
        enrolled: "Entries",
        active: "In progress",
        activeHint: "of which waiting: {{count}}",
        goalReached: "Goal reached",
        goalRate: "Goal conversion",
        exited: "Exits",
        partial:
          "From the daily rollup - enrolments removed by retention before it was introduced are not counted.",
        goalNote: "A goal is attributed to the journey, not proof that the journey caused it.",
      },
      rollup: {
        title: "Older window - data from the daily rollup",
        body: "The window reaches days whose raw enrolments were removed by retention. Step and email counts and the enrolment summary (entries, goals, exits) come from the daily rollup; contacts in progress and A/B variants come from the enrolments that were kept.",
        since: "Complete data from {{date}}.",
        sinceUnknown:
          "The date from which data is complete is shown to administrators on the “Data retention” card.",
      },
      trend: {
        title: "Entries, goals and exits per day",
        subtitle: "Number of enrolments on each day of the window",
        enrolled: "Entries",
        goalReached: "Goal reached",
        exited: "Exits",
        empty: "No entries, goals or exits on the days of this window.",
        loadError: "Could not load the daily series.",
        gap: "Days before {{date}} have no daily data (retention) - the chart shows a gap there, not a zero.",
      },
      funnel: {
        title: "Step transitions",
        description:
          "How many enrolments entered each step, in step-number order. Each share is measured against the parent step.",
        list: "Journey steps with their entries",
        empty: "No step has any entries in this window yet.",
        ofParent: "{{percent}} of the parent step",
        merge: "Joins branches - no single denominator.",
      },
      exits: {
        title: "Exit reasons",
        subtitle: "Enrolments that ended before the end of the journey, by reason",
        series: "Exits",
        empty: "Nobody left the journey before its end in this window.",
      },
      ab: {
        title: "A/B test - step {{number}}",
        titleOutside: "A/B test - step not in the current version",
        metricGoal: "Winner measured by: journey goal",
        metricClick: "Winner measured by: email clicks",
        caption: "Results of the A/B test variants",
        columns: {
          variant: "Variant",
          entered: "Entries",
          conversions: "Conversions",
          rate: "Share",
        },
        noData: "No variant data in this window.",
        insufficient: "Not enough data (n < {{min}})",
        equal: "No difference between the variants",
        better: "{{variant}} better by {{pp}} pp ({{level}}%)",
        notSignificant: "{{variant}} better by {{pp}} pp - not statistically significant",
        hint: "Judge the winner by clicks or the goal, not by opens - Apple MPP inflates opens.",
        keepHint:
          "Keeping a variant saves a new draft with 100/0 weights - it does not publish. Both branches and their statistics stay.",
        confirmTitle: "Keep variant {{variant}}?",
        confirmBody:
          "A draft will be saved in which variant {{variant}} gets every contact of the split. The published version keeps running until you publish the draft.",
        saved: "Draft saved with variant {{variant}} - publish it in the editor.",
        conflict:
          "The draft changed in another tab - we loaded the current one. Choose the variant again.",
        draftInvalid: "The draft is incomplete - fix it in the editor before keeping a variant.",
        nodeMissing: "This step is no longer in the draft.",
        opError: "Could not change the weights in the draft.",
        saveError: "Could not save the draft.",
        readOnly:
          "Keeping a variant saves the draft - it requires the administrator or editor role.",
      },
      emails: {
        title: "Journey emails",
        description:
          "Step sends in the window. Ratings come from the benchmark registry; human opens and CTOR are an upper bound.",
        caption: "Journey step emails - counts in the window, test enrolments excluded",
        scrollRegion: "Step emails (scrolls sideways)",
        columns: {
          step: "Step",
          queued: "Queued",
          sent: "Sent",
          humanOpens: "Human opens",
          clicks: "Clicks",
          ctor: "CTOR",
          unsubscribed: "Unsubscribes",
          bounced: "Bounces",
          complained: "Complaints",
          fallbackLocale: "PL instead of EN",
        },
        empty: "This journey version sends no emails.",
        noSends: "No sends in the window",
        subjectMissing: "no subject",
        mppLabel: "Upper bound - Apple MPP",
        mppBody:
          "Apple Mail Privacy Protection opens emails automatically. We drop opens faster than the engine settings threshold, but some automatic opens remain - human opens and CTOR are an upper bound.",
        campaignBench: "Newsletter campaign benchmark - journey emails usually score higher.",
        fallbackHint: "English-speaking contacts who got the Polish version (no English subject).",
      },
    },
    nodeResults: {
      title: "Step results",
      description: "Step counts in the statistics window; test enrolments are excluded.",
      entered: "Entered",
      succeeded: "Done",
      skipped: "Skipped",
      failed: "Errors (retried)",
      dead: "Given up after retries",
      waitingNow: "Waiting now",
      waitingRollup: "The daily rollup does not count waiting contacts - choose a shorter window.",
      counts: "Step counts",
      outcomes: "Run outcome breakdown",
      outcomesCaption: "Step run outcomes and their count",
      outcome: "Outcome",
      count: "Count",
      outcomesEmpty: "The step has not recorded any outcomes yet.",
      outcomeOther: "Other outcome: {{code}}",
      email: "Step email",
      emailEmpty: "This email had no sends in the window.",
      notInStats: "This step had no entries in the chosen window.",
    },
    enrollments: {
      title: "Contacts on the journey",
      description:
        "Contact enrolments on the journey - current step, status and exit reason. Only the CRM team sees the addresses.",
      statusFilter: "Enrolment status",
      statusAll: "All statuses",
      caption: "Contact enrolments on the journey",
      scrollRegion: "Contact enrolments (scrolls sideways)",
      columns: {
        contact: "Contact",
        status: "Status",
        step: "Step",
        entered: "Entered",
        next: "Next step",
        reason: "Exit reason",
        version: "Version",
        actions: "Actions",
      },
      test: "Test",
      versionValue: "v{{version}}",
      total_one: "{{value}} enrolment",
      total_few: "{{value}} enrolments",
      total_many: "{{value}} enrolments",
      total_other: "{{value}} enrolments",
      pagination: "Enrolment pages",
      pageOf: "Page {{page}} of {{pages}}",
      prev: "Previous page",
      next: "Next page",
      loading: "Loading contacts…",
      loadError: "Could not load the journey contacts.",
      unavailable: "The journey contact list is not deployed in this database yet.",
      empty: "No enrolments with this status.",
      emptyNode: "No enrolments with this status on this step.",
      openLead: "Open the contact card of {{name}}",
      exit: "Remove",
      exitFor: "Remove contact {{name}} from the journey",
      exitConfirmTitle: "Remove the contact from the journey?",
      exitConfirmBody:
        "{{name}} ends the journey with the reason “{{reason}}”. The next steps of this enrolment will not run.",
      exitConfirm: "Remove from the journey",
      exitDone: "Contact removed from the journey.",
      exitError: "Could not remove the contact from the journey.",
      skip: "Skip the wait",
      skipFor: "Skip the wait of contact {{name}}",
      skipAdminOnly: "Only an administrator can skip a wait.",
      skipConfirmTitle: "Skip the wait?",
      skipConfirmBody: "The wait step ends right away - {{name}} moves on at the next engine run.",
      skipConfirm: "Skip the wait",
      skipDone: "Wait skipped.",
      skipError: "Could not skip the wait.",
    },
    statsOverlay: {
      legend:
        "Human opens and CTOR on the canvas are an upper bound (Apple MPP). Opens and clicks count only recipients with measurement consent.",
      chip: {
        entered: "Entries: {{value}}",
        sent: "Sent: {{value}}",
        waiting: "Waiting now: {{value}}",
        opens:
          "Human opens: {{value}} - upper bound (Apple MPP), only recipients with measurement consent",
        clicks: "Clicks: {{value}} - only recipients with measurement consent",
        ctor: "CTOR: {{value}} - upper bound (Apple MPP), campaign benchmark",
      },
      aria: {
        entered_one: "{{value}} entry",
        entered_few: "{{value}} entries",
        entered_many: "{{value}} entries",
        entered_other: "{{value}} entries",
        sent_one: "{{value}} sent",
        sent_few: "{{value}} sent",
        sent_many: "{{value}} sent",
        sent_other: "{{value}} sent",
        withWaiting: "{{base}}, waiting: {{waiting}}",
      },
    },
    lead: {
      title: "Journeys",
      description: "Communication journeys this contact is on.",
      list: "Journey enrolments of the contact",
      step: "Current step: {{node}}",
      entered: "Entered: {{date}}",
      finished: "Ended: {{date}}",
      reason: "Exit reason: {{reason}}",
      version: "version {{version}}",
      test: "Test",
      open: "Show in the editor of journey “{{name}}”",
      loading: "Loading the contact's journeys…",
      loadError: "Could not load the contact's journeys.",
      unavailable: "Communication journeys are not deployed in this database yet.",
      empty: "This contact is not on any journey.",
      emptyNext:
        "Next step: install a journey from the template gallery - contacts enter it after the trigger event.",
      gallery: "Journey template gallery",
      exitFor: "Remove the contact from journey “{{name}}”",
      exitConfirmBody:
        "The contact ends journey “{{name}}” with the reason “{{reason}}”. The next steps of this enrolment will not run.",
      skipFor: "Skip the wait on journey “{{name}}”",
      skipConfirmBody:
        "The wait step on journey “{{name}}” ends right away - the contact moves on at the next engine run.",
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
export const journeysResultsDictionaries = { pl, en } as const;
