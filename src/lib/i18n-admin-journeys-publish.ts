// i18n edytora ścieżek (S8.3c2): lista problemów, publikacja, symulacja
// i test na sobie (`adminJourneys.{issuesList, publishDialog, simulateDialog,
// testPanel}`).
//
// ZERO KOLIZJI. Słownik silnika (`i18n-admin-journeys.ts`, S5) ma etykiety
// kodów (typy kroków, werdykty bramki maila, adnotacje symulacji, kody błędów
// grafu i zapisu), a słownik listy (`i18n-admin-journeys-list.ts`, S8.1) -
// wspólne `adminJourneys.common` (statusy, kategorie, ponowne wejście, opisy
// kroków, zdania problemów i powody błędów RPC) oraz komunikaty zdrowia
// silnika. Tu wyłącznie NOWE gałęzie o nazwach, których nie używa żaden inny
// słownik - dwa różne napisy pod jednym kluczem zaczerwieniłyby bramkę
// `i18nOverlayIntegrity`.
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
    issuesList: {
      title: "Problemy ścieżki",
      loading: "Sprawdzam ścieżkę - lista może się jeszcze wydłużyć…",
      empty: "Brak problemów - ścieżkę można opublikować.",
      countBlocker: "Blokady: {{value}}",
      countWarning: "Ostrzeżenia: {{value}}",
      countInfo: "Informacje: {{value}}",
      severity: {
        blocker: "Blokuje publikację",
        warning: "Ostrzeżenie",
        info: "Informacja",
      },
      wholeJourney: "Cała ścieżka",
      step: "Krok {{number}}",
      stepDetached: "Krok poza przepływem",
      concerns: "Dotyczy: {{name}}",
      goToStep: "Przejdź do kroku {{number}}",
      goToDetached: "Przejdź do kroku poza przepływem",
    },
    publishDialog: {
      title: "Opublikuj ścieżkę",
      description:
        "Sprawdź, co ścieżka zrobi po publikacji. Publikacja tworzy nową, niezmienną wersję - szkic możesz edytować dalej.",
      loading: "Wczytuję ustawienia silnika, przepisy automatyzacji i listę ścieżek…",
      loadError:
        "Nie udało się wczytać ustawień silnika albo listy ścieżek - bez nich nie sprawdzimy blokad publikacji.",
      summaryTitle: "Co zrobi ścieżka",
      trigger: "Wyzwalacz",
      triggerMissing: "Brak wyzwalacza",
      estimate: "Szacunek wejść",
      estimateValue_one: "{{count}} kontakt w ostatnich {{days}} dniach (zdarzenia: {{events}})",
      estimateValue_few: "{{count}} kontakty w ostatnich {{days}} dniach (zdarzenia: {{events}})",
      estimateValue_many: "{{count}} kontaktów w ostatnich {{days}} dniach (zdarzenia: {{events}})",
      estimateValue_other: "{{count}} kontaktu w ostatnich {{days}} dniach (zdarzenia: {{events}})",
      estimateHint:
        "Liczone ze zdarzeń wyzwalacza - pokazuje skalę, nie obiecuje wejść: filtr, zgoda i ponowne wejście odsieją część kontaktów.",
      estimateLoading: "Liczę szacunek…",
      estimateUnavailable: "Szacunek niedostępny.",
      entryFilter: "Filtr wejścia",
      entryFilterNone: "Brak - wchodzi każdy kontakt z wyzwalacza.",
      entryFilterValue_one: "{{count}} warunek: {{list}}",
      entryFilterValue_few: "{{count}} warunki: {{list}}",
      entryFilterValue_many: "{{count}} warunków: {{list}}",
      entryFilterValue_other: "{{count}} warunku: {{list}}",
      category: "Kategoria",
      legalBasis: "Podstawa prawna: {{text}}",
      emails: "Maile",
      emailsValue_one: "{{count}} mail w ścieżce",
      emailsValue_few: "{{count}} maile w ścieżce",
      emailsValue_many: "{{count}} maili w ścieżce",
      emailsValue_other: "{{count}} maila w ścieżce",
      emailsNone: "Ścieżka nie wysyła maili.",
      policyMarketing:
        "Wysyłka tylko do kontaktów ze zgodą marketingową; wypisani i zablokowani są pomijani. Limit {{cap}} maili marketingowych na 7 dni (razem z newsletterem), cisza nocna {{start}}-{{end}} ({{timezone}}).",
      policyService:
        "Komunikat usługowy: bez wymogu zgody marketingowej, zablokowane adresy są pomijane. Limit i cisza nocna dotyczą tylko maili marketingowych.",
      policyUnknown: "Ustawienia silnika są niedostępne - polityka wysyłki nieznana.",
      sender: "Nadawca: {{name}}",
      senderDefault: "Nadawca: nazwa serwisu (nazwa nadawcy nie jest ustawiona).",
      goal: "Cel",
      goalNone: "Bez celu - wyniki pokażą tylko ukończenia.",
      exits: "Wyjścia",
      exitsNone: "Brak dodatkowych zdarzeń wyjścia.",
      exitUnsubscribe: "Wypis z newslettera zawsze kończy ścieżkę marketingową.",
      reentry: "Ponowne wejście",
      reentryCooldown_one: "{{label}} (karencja: {{count}} dzień)",
      reentryCooldown_few: "{{label}} (karencja: {{count}} dni)",
      reentryCooldown_many: "{{label}} (karencja: {{count}} dni)",
      reentryCooldown_other: "{{label}} (karencja: {{count}} dnia)",
      engine: "Silnik",
      engineOk: "Silnik działa.",
      engineErrors:
        "W ostatniej dobie silnik zgłosił błędy wykonania - szczegóły w pasku stanu silnika nad listą ścieżek.",
      engineUnknown: "Stan silnika nieznany.",
      workflows: "Przepisy automatyzacji",
      workflowsHint:
        "Te włączone przepisy robią to samo co ścieżka. Zaznaczone wyłączymy zaraz po publikacji, żeby kontakt nie dostał podwójnego zadania.",
      workflowsFailed:
        "Nie udało się wczytać przepisów automatyzacji - sprawdź w Automatyzacjach, czy żaden nie dubluje ścieżki.",
      workflowDisable: "Wyłącz „{{name}}” po publikacji",
      workflowReason: {
        replace: "Ścieżka z szablonu zastępuje ten przepis.",
        overlap: "Ten sam wyzwalacz i zadanie CRM - powstałyby dwa zadania.",
      },
      workflowDisableFailed:
        "Ścieżka opublikowana, ale przepisu „{{name}}” nie udało się wyłączyć - zrób to w Automatyzacjach.",
      running: "Kontakty w toku",
      continuing_one: "{{count}} kontakt kontynuuje wersję {{version}}",
      continuing_few: "{{count}} kontakty kontynuują wersję {{version}}",
      continuing_many: "{{count}} kontaktów kontynuuje wersję {{version}}",
      continuing_other: "{{count}} kontaktu kontynuuje wersję {{version}}",
      firstVersion: "Pierwsza publikacja - nikt jeszcze nie jest na tej ścieżce.",
      modeDrain: "Dokończą starą wersję (zalecane)",
      modeDrainHint:
        "Kontakty w toku przejdą do końca wersji {{version}}; nowe wejścia dostaną wersję {{next}}.",
      modeExitAll: "Zakończ ich przejścia od razu",
      modeExitAllHint: "Kontakty w toku wyjdą ze ścieżki bez dalszych kroków wersji {{version}}.",
      ack: "Rozumiem: ścieżka obejmie zdarzenia od chwili publikacji - wcześniejszych nie nadrabia.",
      ackRequired: "Zaznacz potwierdzenie, żeby opublikować.",
      blocked_one: "{{count}} problem blokuje publikację.",
      blocked_few: "{{count}} problemy blokują publikację.",
      blocked_many: "{{count}} problemów blokuje publikację.",
      blocked_other: "{{count}} problemu blokuje publikację.",
      archived: "Ścieżka jest zarchiwizowana - nie można jej opublikować.",
      submit: "Opublikuj",
      submitting: "Publikuję…",
      published: "Opublikowano wersję {{version}}.",
      conflict:
        "Ktoś zmienił ścieżkę w międzyczasie - odśwież szkic i sprawdź zmiany przed publikacją.",
      serverTitle: "Serwer odrzucił publikację",
      saveFailed: "Nie udało się zapisać szkicu przed publikacją - publikacja wstrzymana.",
      error: "Nie udało się opublikować ścieżki. Spróbuj ponownie.",
    },
    simulateDialog: {
      title: "Symulacja ścieżki",
      description: "Sprawdź, którędy przez bieżący szkic przeszedłby wybrany kontakt.",
      nothingSaved: "Symulacja nic nie zapisuje i nic nie wysyła.",
      rules:
        "Czekanie jest pomijane (czekanie na zdarzenie idzie gałęzią „Minął termin”), test A/B losuje wariant jak silnik, a warunki historii (otwarcia, kliknięcia) liczą się jako niespełnione.",
      search: "Szukaj kontaktu",
      searchHint: "E-mail, imię lub nazwisko - puste pole pokaże ostatnio aktywne kontakty.",
      searchSubmit: "Szukaj",
      contactLegend: "Kontakt",
      leadsLoading: "Wczytuję kontakty…",
      leadsEmpty: "Brak kontaktów pasujących do wyszukiwania.",
      leadsError: "Nie udało się wczytać kontaktów.",
      leadsMore: "Pokazano {{shown}} z {{total}} - zawęź wyszukiwanie.",
      draftInvalid: "Szkic nie przechodzi walidacji - popraw go, zanim uruchomisz symulację.",
      pickLead: "Wybierz kontakt, żeby zobaczyć jego przejście.",
      running: "Symuluję przejście…",
      error: "Nie udało się uruchomić symulacji.",
      rejected: "Silnik odrzucił szkic - symulacja nie ruszyła.",
      resultTitle: "Przejście kontaktu",
      emailsSummary: "Maile, które zostałyby wysłane: {{sent}} z {{total}}.",
      ended: "Koniec przejścia: {{step}}.",
      highlightHint: "Przejście jest podświetlone na kanwie i liście kroków.",
      branch: "Dalej: {{branch}}",
      verdict: "Bramka maila: {{verdict}}",
      matchAll: "Kryteria warunku (wszystkie muszą być spełnione):",
      matchAny: "Kryteria warunku (wystarczy jedno):",
      predicateHistory: "warunek historii, w symulacji niespełniony",
    },
    testPanel: {
      title: "Test na sobie",
      description:
        "Zapisuje na ścieżkę wyłącznie Twój kontakt z CRM (powiązany z Twoim kontem) - nikt inny nie dostanie maila.",
      version: "Test działa na opublikowanej wersji {{version}}, nie na szkicu.",
      notPublished: "Najpierw opublikuj ścieżkę - test działa na opublikowanej wersji.",
      prefix: "Maile testowe mają w temacie prefiks „[TEST] ” i trafiają tylko na Twój adres.",
      scheduler:
        "Kroki testu wykonuje harmonogram silnika co minutę. Dopóki nie jest podpięty (wdrożenie I9), zapis testowy powstanie, ale kroki nie ruszą.",
      runnerIdle:
        "Silnik nie wykonał jeszcze żadnego kroku - kroki testu ruszą po podpięciu harmonogramu (I9).",
      start: "Zapisz mnie na test",
      restart: "Zacznij test od nowa",
      restartHint: "Nowy test kończy poprzedni test tej ścieżki.",
      started: "Zapisano Twój kontakt na test.",
      duplicate:
        "Jesteś już na tej ścieżce jako zwykły kontakt - test ruszy po zakończeniu tego przejścia.",
      progress: "Postęp testu",
      progressLoading: "Wczytuję postęp testu…",
      notInList:
        "Zapis testowy powstał, ale nie ma go jeszcze na liście kontaktów ścieżki - zajrzyj za chwilę.",
      status: "Stan",
      currentStep: "Bieżący krok",
      stepValue: "Krok {{number}}: {{description}}",
      enteredAt: "Start testu",
      nextRunAt: "Następny krok",
      exitReason: "Powód zakończenia",
      none: "brak",
      skip: "Pomiń oczekiwanie",
      skipAdminOnly: "Pominięcie czekania jest zarezerwowane dla administratora.",
      skipNotWaiting: "Pominąć można tylko krok, na którym kontakt czeka.",
      skipped: "Czekanie pominięte - kontakt pójdzie dalej przy najbliższym przebiegu silnika.",
      exit: "Zakończ test",
      exited: "Test zakończony.",
      error: "Nie udało się wykonać operacji testu. Spróbuj ponownie.",
    },
  },
};

const en: typeof pl = {
  adminJourneys: {
    issuesList: {
      title: "Journey issues",
      loading: "Checking the journey - more issues may still appear…",
      empty: "No issues - the journey can be published.",
      countBlocker: "Blockers: {{value}}",
      countWarning: "Warnings: {{value}}",
      countInfo: "Notes: {{value}}",
      severity: {
        blocker: "Blocks publishing",
        warning: "Warning",
        info: "Note",
      },
      wholeJourney: "Whole journey",
      step: "Step {{number}}",
      stepDetached: "Step outside the path",
      concerns: "Concerns: {{name}}",
      goToStep: "Go to step {{number}}",
      goToDetached: "Go to the step outside the path",
    },
    publishDialog: {
      title: "Publish the journey",
      description:
        "Check what the journey will do once published. Publishing creates a new, immutable version - you can keep editing the draft.",
      loading: "Loading engine settings, automation rules and the journey list…",
      loadError:
        "Could not load the engine settings or the journey list - without them the publishing blockers cannot be checked.",
      summaryTitle: "What the journey will do",
      trigger: "Trigger",
      triggerMissing: "No trigger",
      estimate: "Expected entries",
      estimateValue_one: "{{count}} contact in the last {{days}} days (events: {{events}})",
      estimateValue_few: "{{count}} contacts in the last {{days}} days (events: {{events}})",
      estimateValue_many: "{{count}} contacts in the last {{days}} days (events: {{events}})",
      estimateValue_other: "{{count}} contacts in the last {{days}} days (events: {{events}})",
      estimateHint:
        "Counted from trigger events - it shows the scale, not a promise: the entry rules, consent and re-entry will drop some contacts.",
      estimateLoading: "Counting…",
      estimateUnavailable: "Estimate not available.",
      entryFilter: "Entry rules",
      entryFilterNone: "None - every contact from the trigger enters.",
      entryFilterValue_one: "{{count}} condition: {{list}}",
      entryFilterValue_few: "{{count}} conditions: {{list}}",
      entryFilterValue_many: "{{count}} conditions: {{list}}",
      entryFilterValue_other: "{{count}} conditions: {{list}}",
      category: "Category",
      legalBasis: "Legal basis: {{text}}",
      emails: "Emails",
      emailsValue_one: "{{count}} email in the journey",
      emailsValue_few: "{{count}} emails in the journey",
      emailsValue_many: "{{count}} emails in the journey",
      emailsValue_other: "{{count}} emails in the journey",
      emailsNone: "The journey sends no emails.",
      policyMarketing:
        "Sent only to contacts with marketing consent; unsubscribed and suppressed addresses are skipped. Limit of {{cap}} marketing emails per 7 days (together with the newsletter), quiet hours {{start}}-{{end}} ({{timezone}}).",
      policyService:
        "Service message: no marketing consent required, suppressed addresses are skipped. The limit and quiet hours apply only to marketing emails.",
      policyUnknown: "Engine settings are not available - the sending policy is unknown.",
      sender: "Sender: {{name}}",
      senderDefault: "Sender: the site name (no sender name is set).",
      goal: "Goal",
      goalNone: "No goal - the results will show completions only.",
      exits: "Exits",
      exitsNone: "No extra exit events.",
      exitUnsubscribe: "Unsubscribing from the newsletter always ends a marketing journey.",
      reentry: "Re-entry",
      reentryCooldown_one: "{{label}} (cooldown: {{count}} day)",
      reentryCooldown_few: "{{label}} (cooldown: {{count}} days)",
      reentryCooldown_many: "{{label}} (cooldown: {{count}} days)",
      reentryCooldown_other: "{{label}} (cooldown: {{count}} days)",
      engine: "Engine",
      engineOk: "The engine is running.",
      engineErrors:
        "The engine reported run errors in the last day - see the engine status above the journey list.",
      engineUnknown: "Engine status unknown.",
      workflows: "Automation rules",
      workflowsHint:
        "These active rules do the same as the journey. The selected ones will be switched off right after publishing, so no contact gets a duplicate task.",
      workflowsFailed:
        "Could not load the automation rules - check in Automations that none of them duplicates the journey.",
      workflowDisable: "Switch off “{{name}}” after publishing",
      workflowReason: {
        replace: "The template journey replaces this rule.",
        overlap: "Same trigger and a CRM task - two tasks would be created.",
      },
      workflowDisableFailed:
        "The journey is published, but the rule “{{name}}” could not be switched off - do it in Automations.",
      running: "Contacts in progress",
      continuing_one: "{{count}} contact continues version {{version}}",
      continuing_few: "{{count}} contacts continue version {{version}}",
      continuing_many: "{{count}} contacts continue version {{version}}",
      continuing_other: "{{count}} contacts continue version {{version}}",
      firstVersion: "First publication - nobody is on this journey yet.",
      modeDrain: "Let them finish the old version (recommended)",
      modeDrainHint:
        "Contacts in progress go through to the end of version {{version}}; new entries get version {{next}}.",
      modeExitAll: "End their runs now",
      modeExitAllHint:
        "Contacts in progress leave the journey without the remaining steps of version {{version}}.",
      ack: "I understand: the journey covers events from the moment of publishing - earlier ones are not caught up.",
      ackRequired: "Tick the confirmation to publish.",
      blocked_one: "{{count}} issue prevents publishing.",
      blocked_few: "{{count}} issues prevent publishing.",
      blocked_many: "{{count}} issues prevent publishing.",
      blocked_other: "{{count}} issues prevent publishing.",
      archived: "The journey is archived - it cannot be published.",
      submit: "Publish",
      submitting: "Publishing…",
      published: "Version {{version}} published.",
      conflict:
        "Someone changed the journey in the meantime - refresh the draft and review the changes before publishing.",
      serverTitle: "The server rejected publishing",
      saveFailed: "Could not save the draft before publishing - publishing stopped.",
      error: "Could not publish the journey. Try again.",
    },
    simulateDialog: {
      title: "Journey simulation",
      description: "See which way a chosen contact would go through the current draft.",
      nothingSaved: "The simulation saves nothing and sends nothing.",
      rules:
        "Waits are skipped (a wait for an event takes the “Time ran out” branch), the A/B test draws a variant like the engine does, and history conditions (opens, clicks) count as not met.",
      search: "Find a contact",
      searchHint: "Email, first or last name - an empty field lists recently active contacts.",
      searchSubmit: "Search",
      contactLegend: "Contact",
      leadsLoading: "Loading contacts…",
      leadsEmpty: "No contacts match the search.",
      leadsError: "Could not load contacts.",
      leadsMore: "Showing {{shown}} of {{total}} - narrow the search.",
      draftInvalid:
        "The draft does not pass validation - correct it before running the simulation.",
      pickLead: "Choose a contact to see their route.",
      running: "Simulating the route…",
      error: "Could not run the simulation.",
      rejected: "The engine rejected the draft - the simulation did not start.",
      resultTitle: "Contact route",
      emailsSummary: "Emails that would be sent: {{sent}} of {{total}}.",
      ended: "Route ends at: {{step}}.",
      highlightHint: "The route is highlighted on the canvas and in the step list.",
      branch: "Next: {{branch}}",
      verdict: "Email gate: {{verdict}}",
      matchAll: "Condition criteria (all must be met):",
      matchAny: "Condition criteria (one is enough):",
      predicateHistory: "history condition, not met in the simulation",
    },
    testPanel: {
      title: "Test on yourself",
      description:
        "Enrols only your own CRM contact (linked to your account) - nobody else gets an email.",
      version: "The test runs on published version {{version}}, not on the draft.",
      notPublished: "Publish the journey first - the test runs on the published version.",
      prefix: "Test emails carry the “[TEST] ” prefix in the subject and go only to your address.",
      scheduler:
        "Test steps are run by the engine scheduler every minute. Until it is connected (I9 rollout), the test enrolment is created, but no steps run.",
      runnerIdle:
        "The engine has not run any step yet - test steps will start once the scheduler is connected (I9).",
      start: "Enrol me in a test",
      restart: "Start the test again",
      restartHint: "A new test ends the previous test of this journey.",
      started: "Your contact is enrolled in the test.",
      duplicate:
        "You are already on this journey as a regular contact - the test can start once that run ends.",
      progress: "Test progress",
      progressLoading: "Loading test progress…",
      notInList:
        "The test enrolment was created but is not on the journey contact list yet - check again shortly.",
      status: "Status",
      currentStep: "Current step",
      stepValue: "Step {{number}}: {{description}}",
      enteredAt: "Test started",
      nextRunAt: "Next step",
      exitReason: "Reason for ending",
      none: "none",
      skip: "Skip the wait",
      skipAdminOnly: "Skipping a wait is reserved for administrators.",
      skipNotWaiting: "Only a step the contact is waiting on can be skipped.",
      skipped: "Wait skipped - the contact moves on at the next engine run.",
      exit: "End the test",
      exited: "Test ended.",
      error: "Could not complete the test action. Try again.",
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
export const journeysPublishDictionaries = { pl, en } as const;
