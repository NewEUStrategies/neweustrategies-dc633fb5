// i18n edytora ścieżki (S8.3): gałąź `adminJourneys.editor` - sesja szkicu
// (stany, komunikaty `aria-live`), autozapis, dialog konfliktu i podgląd maila.
// Kolejne części edytora (pasek, trasa, okruszki) dopisują tu SWOJE poddrzewa
// `adminJourneys.editor.<część>` - jedna gałąź, jeden plik edytora.
//
// ZERO KOLIZJI. Słownik silnika (`i18n-admin-journeys.ts`) i słowniki S8
// (`-list`: `common`, `list`, `gallery`…; `-results`; `-publish`) nie mają
// gałęzi `editor`; wspólne etykiety (statusy, operacje menu, powody błędów
// zapisu) czytamy z `adminJourneys.common`, nie kopiujemy.
//
// LICZEBNIKI: PL `_one/_few/_many/_other`, EN `_one/_other`; `typeof pl`
// wymaga form polskich także w EN (angielski czyta tylko `_one`/`_other`).
//
// UWAGA NA ARKUSZ CSS. Pliki `src/lib/i18n-*.ts` skanuje generator arkusza
// PUBLICZNEGO - angielskie słowo równe klasie narzędziowej Tailwinda dokłada
// regułę do CSS każdej strony czytelnika (limit `publicCss` zamrożony).
// Napisy niżej omijają takie słowa (sprawdzone kompilacją kandydatów).
//
// IMPORT WYŁĄCZNIE Z KOMPONENTÓW I HOOKÓW (`ensureI18n()`), nie z pliku trasy.
import i18n from "@/lib/i18n";

const pl = {
  adminJourneys: {
    editor: {
      session: {
        notice: {
          needsTrigger:
            "Wybierz wyzwalacz, żeby zacząć budować ścieżkę. Szkic bez wyzwalacza nie zapisze się.",
          draftInvalid:
            "Zapisany szkic nie pasuje do obecnego schematu (pole: {{path}}). Napraw go - zachowamy kroki i ustawienia, które da się odczytać.",
          archived: "Ścieżka jest w archiwum - szkic można tylko oglądać.",
          version: "Oglądasz opublikowaną wersję - zmiany wprowadzisz w szkicu.",
          role: "Twoja rola pozwala tylko oglądać tę ścieżkę.",
          conflict:
            "Ścieżka zmieniła się w innej karcie. Autozapis czeka, aż wybierzesz, która wersja zostaje.",
        },
        announce: {
          undone: "Cofnięto: {{label}}",
          undoneGeneric: "Cofnięto ostatnią zmianę",
          redone: "Ponowiono: {{label}}",
          redoneGeneric: "Ponowiono zmianę",
          external: "Wczytano zmiany zapisane w innej karcie",
          discarded: "Odrzucono niezapisane zmiany",
          keptMine: "Zapisano Twoją wersję na wierzchu zmian z innej karty",
          tookServer: "Wczytano wersję z innej karty - Twoje zmiany odrzucone",
          triggerChosen: "Wybrano wyzwalacz - szkic zapisany",
          repaired: "Szkic naprawiony - zapisano części, które dało się odczytać",
        },
        startFailed:
          "Nie udało się zapisać szkicu z tym wyzwalaczem. Odśwież stronę i spróbuj ponownie.",
      },
      autosave: {
        conflict: "Nie zapisano - ścieżka zmieniła się w innej karcie.",
        mfa: "Nie zapisano - zapis wymaga logowania z drugim składnikiem (MFA).",
        failed: "Nie zapisano szkicu. Spróbujemy ponownie przy następnej zmianie.",
        invalid: {
          name: "Nie zapisano - nazwa musi mieć od 1 do {{max}} znaków.",
          description: "Nie zapisano - opis może mieć najwyżej {{max}} znaków.",
          legalBasis: "Nie zapisano - podstawa prawna może mieć najwyżej {{max}} znaków.",
          legalBasisRequired: "Nie zapisano - komunikacja usługowa wymaga podstawy prawnej.",
          draft: "Nie zapisano - szkic ma niepoprawny kształt (pole: {{path}}).",
        },
      },
      conflict: {
        title: "Ścieżka zmieniła się w innej karcie",
        description:
          "Twoje niezapisane zmiany różnią się od wersji zapisanej {{date}}. Wybierz, która zostaje.",
        loading: "Wczytuję wersję zapisaną w innej karcie…",
        noDifferences: "Treść obu wersji jest taka sama - różni je tylko chwila zapisu.",
        legendMine: "Tylko w Twojej wersji",
        legendServer: "Tylko w wersji z innej karty",
        legend: "Oznaczenia różnic",
        unchanged_one: "{{count}} wiersz bez zmian",
        unchanged_few: "{{count}} wiersze bez zmian",
        unchanged_many: "{{count}} wierszy bez zmian",
        unchanged_other: "{{count}} wiersza bez zmian",
        sections: {
          definition: "Nazwa, opis i kategoria",
          settings: "Wyzwalacz, cel, wyjścia i ponowne wejście",
          nodes: "Kroki",
          edges: "Połączenia między krokami",
        },
        keepMine: "Zachowaj moje",
        keepMineHint: "Zapiszemy Twoją wersję na wierzch zmian z innej karty.",
        takeServer: "Weź wersję z innej karty",
        takeServerHint: "Odrzucimy Twoje niezapisane zmiany i wczytamy zapisaną wersję.",
        saving: "Zapisuję Twoją wersję…",
        keepFailed:
          "Nie udało się zapisać Twojej wersji. Spróbuj ponownie albo weź wersję z innej karty.",
      },
      preview: {
        samples: "Podgląd na przykładowych danych ({{name}}) - bez danych prawdziwych kontaktów.",
        fallbackLocale: "Brak tematu po angielsku - kontakty anglojęzyczne dostaną wersję polską.",
        unknownVariables: "Nieznane zmienne zostaną w wysyłce puste: {{list}}.",
        urlVariables:
          "W adresach działają tylko zmienne adresów serwisu - {{list}} zostanie pusta w wysyłce.",
        error: {
          doc_invalid: "Dokument maila jest uszkodzony - wysyłka tego kroku zostanie wstrzymana.",
          subject_empty:
            "Temat jest pusty po podstawieniu zmiennych - wysyłka tego kroku zostanie wstrzymana.",
          doc_empty: "Mail nie ma treści w tym języku - wysyłka tego kroku zostanie wstrzymana.",
        },
      },
    },
  },
};

const en: typeof pl = {
  adminJourneys: {
    editor: {
      session: {
        notice: {
          needsTrigger:
            "Choose a trigger to start building the journey. A draft without a trigger cannot be saved.",
          draftInvalid:
            "The saved draft does not match the current schema (field: {{path}}). Repair it - we keep the steps and settings that can be read.",
          archived: "This journey is archived - the draft is read-only.",
          version: "You are viewing a published version - make changes in the draft.",
          role: "Your role lets you view this journey only.",
          conflict:
            "The journey changed in another tab. Autosave waits until you choose which version stays.",
        },
        announce: {
          undone: "Undone: {{label}}",
          undoneGeneric: "Undid the last change",
          redone: "Redone: {{label}}",
          redoneGeneric: "Redid the change",
          external: "Loaded changes saved in another tab",
          discarded: "Discarded unsaved changes",
          keptMine: "Saved your version over the changes from another tab",
          tookServer: "Loaded the version from another tab - your changes were discarded",
          triggerChosen: "Trigger chosen - draft saved",
          repaired: "Draft repaired - saved the parts that could be read",
        },
        startFailed: "Could not save the draft with this trigger. Reload the page and try again.",
      },
      autosave: {
        conflict: "Not saved - the journey changed in another tab.",
        mfa: "Not saved - saving requires a sign-in with a second factor (MFA).",
        failed: "The draft was not saved. We will try again on your next change.",
        invalid: {
          name: "Not saved - the name must have 1 to {{max}} characters.",
          description: "Not saved - the description may have at most {{max}} characters.",
          legalBasis: "Not saved - the legal basis may have at most {{max}} characters.",
          legalBasisRequired: "Not saved - service communication requires a legal basis.",
          draft: "Not saved - the draft has an invalid shape (field: {{path}}).",
        },
      },
      conflict: {
        title: "The journey changed in another tab",
        description:
          "Your unsaved changes differ from the version saved {{date}}. Choose which one stays.",
        loading: "Loading the version saved in another tab…",
        noDifferences: "Both versions have the same content - only the save time differs.",
        legendMine: "Only in your version",
        legendServer: "Only in the version from another tab",
        legend: "Difference markers",
        unchanged_one: "{{count}} unchanged row",
        unchanged_few: "{{count}} unchanged rows",
        unchanged_many: "{{count}} unchanged rows",
        unchanged_other: "{{count}} unchanged rows",
        sections: {
          definition: "Name, description and category",
          settings: "Trigger, goal, exits and re-entry",
          nodes: "Steps",
          edges: "Connections between steps",
        },
        keepMine: "Keep mine",
        keepMineHint: "We save your version over the changes from another tab.",
        takeServer: "Take the version from another tab",
        takeServerHint: "We discard your unsaved changes and load the saved version.",
        saving: "Saving your version…",
        keepFailed: "Could not save your version. Try again or take the version from another tab.",
      },
      preview: {
        samples: "Preview with sample data ({{name}}) - no real contact data.",
        fallbackLocale:
          "No English subject - English-speaking contacts receive the Polish version.",
        unknownVariables: "Unknown variables will be empty when sent: {{list}}.",
        urlVariables:
          "Only site address variables work in links - {{list}} will be empty when sent.",
        error: {
          doc_invalid: "The email document is damaged - sending this step will be held.",
          subject_empty:
            "The subject is empty after variables are filled - sending this step will be held.",
          doc_empty: "The email has no content in this language - sending this step will be held.",
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

/** Słowniki wprost - testy czytają je bez instancji i18next. */
export const journeysEditorDictionaries = { pl, en } as const;
