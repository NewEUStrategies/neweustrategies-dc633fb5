// i18n kanwy i listy kroków edytora ścieżki (S8.3b): nazwy kroków dla
// czytnika, przyciski „+” i „⋯”, paleta kroków, wybór kroku do scalenia
// i miejsca kopii, potwierdzenie usunięcia, komunikaty `aria-live`,
// powiększenie oraz instrukcje klawiatury kanwy (`adminJourneys.canvas`)
// i listy (`adminJourneys.outline`).
//
// ZERO KOLIZJI. Wyłącznie dwie NOWE gałęzie. Etykiety menu operacji, grup
// palety i opisy skutków są we wspólnym `adminJourneys.common` (S8.1,
// `i18n-admin-journeys-list.ts`), nazwy typów kroków, gałęzi i błędów grafu
// w słowniku silnika (`i18n-admin-journeys.ts`), a liczby kroku
// (`adminJourneys.statsOverlay.aria`) w słowniku wyników (S8.2) - tu ich nie
// dublujemy, bo dwa napisy pod jednym kluczem czerwienią `i18nOverlayIntegrity`.
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
    canvas: {
      label: "Kanwa ścieżki",
      steps: "Kroki ścieżki",
      instructions:
        "Strzałki w górę i w dół: kolejny krok przepływu, w lewo i w prawo: sąsiednia gałąź. Home i End: pierwszy i ostatni krok. Enter otwiera panel kroku albo przechodzi do kroku wskazanego przez „dalej jak w kroku”. Insert lub plus: paleta kroków. Delete: usunięcie kroku. Shift+F10: menu kroku. Ctrl (na Macu Cmd)+Z cofa, Ctrl+Shift+Z ponawia, Ctrl+plus, Ctrl+minus i Ctrl+0 zmieniają powiększenie. Esc zamyka panel kroku.",
      instructionsReadOnly:
        "Podgląd tylko do odczytu. Strzałki, Home i End przechodzą po krokach, Enter otwiera panel kroku albo przechodzi do kroku wskazanego przez „dalej jak w kroku”, Ctrl+plus, Ctrl+minus i Ctrl+0 zmieniają powiększenie.",
      empty: "Szkic nie ma jeszcze kroków - zacznij od wyboru wyzwalacza.",
      zoom: {
        toolbar: "Powiększenie kanwy",
        out: "Pomniejsz",
        in: "Powiększ",
        fit: "Dopasuj do okna",
        reset: "Powiększenie {{value}} - przywróć 100 %",
        value: "{{value}} %",
      },
      step: {
        label: "Krok {{number}} z {{total}}: {{summary}}",
        labelBranch: "Krok {{number}} z {{total}}, gałąź „{{branch}}”: {{summary}}",
        labelDetached: "Krok poza przepływem: {{summary}}",
        labelStats: "{{label}}, {{stats}}",
        labelOpenNext: "{{label}}. Brak dalszego kroku",
        labelOpenBranches_one: "{{label}}. Pusta gałąź: {{branches}}",
        labelOpenBranches_few: "{{label}}. Puste gałęzie: {{branches}}",
        labelOpenBranches_many: "{{label}}. Puste gałęzie: {{branches}}",
        labelOpenBranches_other: "{{label}}. Puste gałęzie: {{branches}}",
        ref: "kroku {{number}}",
        refDetached: "kroku poza przepływem",
        detached: "Poza przepływem",
        menu: "Działania {{step}}",
      },
      merge: {
        chip: "dalej jak w kroku {{number}}",
        chipDetached: "dalej jak w kroku poza przepływem",
        label: "Dalej jak w kroku {{number}}: {{summary}}",
        labelDetached: "Dalej jak w kroku poza przepływem: {{summary}}",
      },
      insert: {
        next: "Dodaj krok po {{step}}",
        branch: "Dodaj krok w gałęzi „{{branch}}” {{step}}",
      },
      palette: {
        search: "Szukaj kroku",
        searchPlaceholder: "np. e-mail, czekaj, tag",
        empty: "Brak kroków pasujących do „{{query}}”.",
        back: "← Wróć",
        mergeHint:
          "Koniec tej gałęzi poprowadzi do istniejącego kroku - kontakt pójdzie dalej tak jak w nim.",
        mergeEmpty: "Nie ma kroku, z którym można połączyć tę gałąź.",
        mergeTarget: "Krok {{number}}: {{summary}}",
      },
      slots: {
        title: "Gdzie wstawić kopię?",
        empty: "Brak pustego końca gałęzi na kopię.",
        after: "Po {{step}}",
        branch: "Gałąź „{{branch}}” {{step}}",
      },
      menu: {
        empty: "Brak działań dla tego kroku.",
      },
      request: {
        insert: "Dodaj krok: {{name}}",
        merge: "Połącz z krokiem {{number}}",
      },
      defaults: {
        taskTitle: "Kontakt w ścieżce - zadanie",
        staffMessage: "Kontakt dotarł do tego kroku ścieżki.",
        tag: "sciezka",
      },
      confirm: {
        title: "Usunąć krok {{number}} z dalszymi krokami?",
        titleDetached: "Usunąć krok poza przepływem z dalszymi krokami?",
        description_one: "Zniknie też {{count}} dalszy krok. Operację cofniesz skrótem Ctrl+Z.",
        description_few: "Znikną też {{count}} dalsze kroki. Operację cofniesz skrótem Ctrl+Z.",
        description_many:
          "Zniknie też {{count}} dalszych kroków. Operację cofniesz skrótem Ctrl+Z.",
        description_other:
          "Zniknie też {{count}} dalszego kroku. Operację cofniesz skrótem Ctrl+Z.",
      },
      live: {
        applied: "Wykonano: {{label}}.",
        refused: "Nie wykonano „{{label}}”: {{reason}}",
        zoom: "Powiększenie {{value}} %",
        jump: "Przejście do {{step}}",
        readOnly: "Podgląd tylko do odczytu - edycja jest wyłączona.",
        noInsert: "Po {{step}} nie można dodać kroku.",
        noDelete: "Nie można usunąć {{step}}.",
      },
      opError: {
        node_missing: "Tego kroku już nie ma w szkicu.",
        trigger_protected:
          "Wyzwalacza nie można usunąć ani powielić - zmienisz go w ustawieniach wyzwalacza.",
        terminal_protected: "Krok końcowy można tylko zamienić albo połączyć z innym krokiem.",
        limit_nodes: "Ścieżka ma już najwięcej kroków, ile może mieć ({{max}}).",
        branch_invalid: "Ten krok nie ma takiej gałęzi.",
        slot_occupied: "Krok końcowy można postawić tylko na pustym końcu gałęzi.",
        not_movable: "Tego kroku nie da się tu przesunąć.",
        target_invalid: "Wybrany krok nie może być celem tej operacji.",
        not_split: "To nie jest test A/B.",
        not_terminal: "To nie jest krok końcowy.",
        would_break: "Operacja zepsułaby ścieżkę.",
        wouldBreakIssues: "Operacja zepsułaby ścieżkę: {{issues}}",
      },
    },
    outline: {
      label: "Lista kroków ścieżki",
      instructions:
        "Strzałki w górę i w dół: poprzedni i następny element listy, w prawo: dalszy krok, w lewo: krok wyżej. Home i End: pierwszy i ostatni element. Enter otwiera panel kroku albo przechodzi do kroku wskazanego przez „dalej jak w kroku”. Insert lub plus: paleta kroków. Delete: usunięcie kroku. Shift+F10: menu kroku. Ctrl (na Macu Cmd)+Z cofa, Ctrl+Shift+Z ponawia. Esc zamyka panel kroku.",
      instructionsReadOnly:
        "Podgląd tylko do odczytu. Strzałki, Home i End przechodzą po krokach, Enter otwiera panel kroku albo przechodzi do kroku wskazanego przez „dalej jak w kroku”.",
      branch: "Gałąź „{{branch}}”",
      openBranch: "Gałąź „{{branch}}”: brak kroku",
    },
  },
};

const en: typeof pl = {
  adminJourneys: {
    canvas: {
      label: "Journey canvas",
      steps: "Journey steps",
      instructions:
        "Up and down arrows: next step of the flow, left and right: the neighbouring branch. Home and End: first and last step. Enter opens the step panel or goes to the step named by “continues as step”. Insert or plus: step palette. Delete: remove the step. Shift+F10: step menu. Ctrl (Cmd on a Mac)+Z undoes, Ctrl+Shift+Z redoes, Ctrl+plus, Ctrl+minus and Ctrl+0 change the zoom. Esc closes the step panel.",
      instructionsReadOnly:
        "Read-only preview. Arrows, Home and End move between steps, Enter opens the step panel or goes to the step named by “continues as step”, Ctrl+plus, Ctrl+minus and Ctrl+0 change the zoom.",
      empty: "The draft has no steps yet - start by choosing a trigger.",
      zoom: {
        toolbar: "Canvas zoom",
        out: "Zoom out",
        in: "Zoom in",
        fit: "Fit to window",
        reset: "Zoom {{value}} - back to 100 %",
        value: "{{value}} %",
      },
      step: {
        label: "Step {{number}} of {{total}}: {{summary}}",
        labelBranch: "Step {{number}} of {{total}}, branch “{{branch}}”: {{summary}}",
        labelDetached: "Step outside the flow: {{summary}}",
        labelStats: "{{label}}, {{stats}}",
        labelOpenNext: "{{label}}. No next step",
        labelOpenBranches_one: "{{label}}. Empty branch: {{branches}}",
        labelOpenBranches_few: "{{label}}. Empty branches: {{branches}}",
        labelOpenBranches_many: "{{label}}. Empty branches: {{branches}}",
        labelOpenBranches_other: "{{label}}. Empty branches: {{branches}}",
        ref: "step {{number}}",
        refDetached: "a step outside the flow",
        detached: "Outside the flow",
        menu: "Actions for {{step}}",
      },
      merge: {
        chip: "continues as step {{number}}",
        chipDetached: "continues as a step outside the flow",
        label: "Continues as step {{number}}: {{summary}}",
        labelDetached: "Continues as a step outside the flow: {{summary}}",
      },
      insert: {
        next: "Add a step after {{step}}",
        branch: "Add a step in branch “{{branch}}” of {{step}}",
      },
      palette: {
        search: "Find a step",
        searchPlaceholder: "e.g. email, wait, tag",
        empty: "No steps match “{{query}}”.",
        back: "← Back",
        mergeHint:
          "This branch end will lead to an existing step - the contact carries on from there.",
        mergeEmpty: "There is no step this branch can connect to.",
        mergeTarget: "Step {{number}}: {{summary}}",
      },
      slots: {
        title: "Where should the copy go?",
        empty: "No empty branch end for the copy.",
        after: "After {{step}}",
        branch: "Branch “{{branch}}” of {{step}}",
      },
      menu: {
        empty: "No actions for this step.",
      },
      request: {
        insert: "Add step: {{name}}",
        merge: "Connect to step {{number}}",
      },
      defaults: {
        taskTitle: "Journey contact - task",
        staffMessage: "A contact reached this journey step.",
        tag: "journey",
      },
      confirm: {
        title: "Remove step {{number}} with the steps after it?",
        titleDetached: "Remove the step outside the flow with the steps after it?",
        description_one: "{{count}} later step goes too. Ctrl+Z undoes it.",
        description_few: "{{count}} later steps go too. Ctrl+Z undoes it.",
        description_many: "{{count}} later steps go too. Ctrl+Z undoes it.",
        description_other: "{{count}} later steps go too. Ctrl+Z undoes it.",
      },
      live: {
        applied: "Done: {{label}}.",
        refused: "Not done “{{label}}”: {{reason}}",
        zoom: "Zoom {{value}} %",
        jump: "Moved to {{step}}",
        readOnly: "Read-only preview - editing is off.",
        noInsert: "No step can be added after {{step}}.",
        noDelete: "Cannot remove {{step}}.",
      },
      opError: {
        node_missing: "This step is no longer in the draft.",
        trigger_protected:
          "The trigger cannot be removed or copied - change it in the trigger settings.",
        terminal_protected: "An end step can only be replaced or connected to another step.",
        limit_nodes: "The journey already has the maximum number of steps ({{max}}).",
        branch_invalid: "This step has no such branch.",
        slot_occupied: "An end step fits only at an empty branch end.",
        not_movable: "This step cannot move here.",
        target_invalid: "The chosen step cannot be used for this change.",
        not_split: "This is not an A/B test.",
        not_terminal: "This is not an end step.",
        would_break: "The change would break the journey.",
        wouldBreakIssues: "The change would break the journey: {{issues}}",
      },
    },
    outline: {
      label: "Journey steps as a list",
      instructions:
        "Up and down arrows: previous and next item, right: the following step, left: the step above. Home and End: first and last item. Enter opens the step panel or goes to the step named by “continues as step”. Insert or plus: step palette. Delete: remove the step. Shift+F10: step menu. Ctrl (Cmd on a Mac)+Z undoes, Ctrl+Shift+Z redoes. Esc closes the step panel.",
      instructionsReadOnly:
        "Read-only preview. Arrows, Home and End move between steps, Enter opens the step panel or goes to the step named by “continues as step”.",
      branch: "Branch “{{branch}}”",
      openBranch: "Branch “{{branch}}”: no step yet",
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
export const journeysCanvasDictionaries = { pl, en } as const;
