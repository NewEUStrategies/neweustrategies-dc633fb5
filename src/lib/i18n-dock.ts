// Tłumaczenia przestrzeni roboczej doku (PL/EN). Rejestrowane przy ewaluacji
// modułu, ładowane razem z panelami - gość nie pobiera tego bundla.
import i18n from "./i18n";

export const dockPl = {
  dock: {
    open: "Otwórz",
    close: "Zamknij",
    toolbar: "Pasek narzędzi",
    shortcuts: "Skróty nawigacyjne",
    workspace: "Przestrzeń robocza",
    guest: "Zaloguj się, żeby korzystać z tej przestrzeni.",
    error: "Nie udało się wczytać danych. Spróbuj ponownie.",
    loading: "Wczytywanie...",
    tools: {
      chat: "Czat",
      todos: "Zadania",
      notes: "Notatki",
      saved: "Zapisane",
      calendar: "Kalendarz",
      readLater: "Do przeczytania",
    },
    chat: {
      title: "Czat",
      searchPlaceholder: "Szukaj osób i rozmów...",
      sections: {
        online: "Online",
        direct: "Wiadomości prywatne",
        groups: "Kanały i grupy",
      },
      empty: "Brak rozmów. Wyszukaj osobę, żeby zacząć.",
      openAll: "Otwórz wiadomości",
      start: "Napisz",
      minimize: "Zminimalizuj rozmowę",
      closeConversation: "Zamknij rozmowę",
      // LICZBY MNOGIE, nie jedna forma. Klucz bez wariantów drukował „Jeszcze
      // 1 zminimalizowane rozmowy" - i to była wartość NAJCZĘSTSZA, bo limit
      // widocznych pigułek to 2, więc pierwsza ukryta rozmowa daje count=1.
      // Polski wymaga czterech form, angielski dwóch (parytet zwalnia z EN
      // tylko `_few` i `_many`; `_one` i `_other` muszą być po obu stronach).
      minimizedMore_one: "Jeszcze {{count}} zminimalizowana rozmowa",
      minimizedMore_few: "Jeszcze {{count}} zminimalizowane rozmowy",
      minimizedMore_many: "Jeszcze {{count}} zminimalizowanych rozmów",
      minimizedMore_other: "Jeszcze {{count}} zminimalizowanej rozmowy",
      restore: "Przywróć rozmowę: {{name}}",
    },
    todos: {
      title: "Zadania",
      placeholder: "Co masz do zrobienia?",
      add: "Dodaj",
      empty: "Brak zadań. Dodaj pierwsze powyżej.",
      openCount: "Otwarte: {{count}}",
      done: "Zrobione",
      remove: "Usuń zadanie",
      priority: {
        label: "Priorytet",
        urgent: "Pilne",
        high: "Wysoki",
        medium: "Średni",
        low: "Niski",
      },
      due: "Termin: {{date}}",
      tabs: { open: "Do zrobienia", done: "Zrobione" },
    },
    notes: {
      title: "Notatki",
      newTitle: "Tytuł notatki",
      newBody: "Treść notatki...",
      add: "Zapisz notatkę",
      empty: "Notatnik jest pusty.",
      edit: "Edytuj",
      save: "Zapisz",
      cancel: "Anuluj",
      remove: "Usuń notatkę",
      pin: "Przypnij",
      unpin: "Odepnij",
      color: "Kolor karteczki",
      attach: "Przypnij do tego materiału",
      linked: "Powiązany materiał",
      unlink: "Odłącz od materiału",
      scope: { all: "Wszystkie", material: "Ten materiał" },
    },
    saved: {
      title: "Zapisane elementy",
      empty: "Nic jeszcze nie zapisałeś.",
      searchPlaceholder: "Szukaj w zapisanych...",
      filters: {
        all: "Wszystko",
        post: "Artykuły",
        page: "Strony",
        event: "Wydarzenia",
        readLater: "Do przeczytania",
      },
      open: "Otwórz",
    },
    calendar: {
      title: "Kalendarz",
      prev: "Poprzedni miesiąc",
      next: "Następny miesiąc",
      today: "Dziś",
      dayEmpty: "Brak wydarzeń tego dnia.",
      full: "Pełny kalendarz",
      weekdays: ["Pn", "Wt", "Śr", "Cz", "Pt", "So", "Nd"],
    },
    // Kolejka czytania NIE MA już własnego panelu: `ReadLaterPanel` usunięty
    // (zero importerów), a jej elementy pokazuje panel zapisanych. Zostają
    // więc wyłącznie klucze AKCJI, których `SavedPanel` faktycznie woła -
    // tytuł, wyszukiwarka, filtry i pusty stan odeszły razem z panelem.
    readLater: {
      markRead: "Oznacz jako przeczytane",
      markUnread: "Oznacz jako nieprzeczytane",
      archive: "Przenieś do archiwum",
      remove: "Usuń z kolejki",
    },
  },
};

export const dockEn = {
  dock: {
    open: "Open",
    close: "Close",
    toolbar: "Tool bar",
    shortcuts: "Navigation shortcuts",
    workspace: "Workspace",
    guest: "Sign in to use this workspace.",
    error: "Could not load the data. Please try again.",
    loading: "Loading...",
    tools: {
      chat: "Chat",
      todos: "Tasks",
      notes: "Notes",
      saved: "Saved",
      calendar: "Calendar",
      readLater: "Read later",
    },
    chat: {
      title: "Chat",
      searchPlaceholder: "Search people and conversations...",
      sections: {
        online: "Online",
        direct: "Direct messages",
        groups: "Channels and groups",
      },
      empty: "No conversations yet. Search for someone to start.",
      openAll: "Open messages",
      start: "Message",
      minimize: "Minimize conversation",
      closeConversation: "Close conversation",
      minimizedMore_one: "{{count}} more minimized conversation",
      minimizedMore_other: "{{count}} more minimized conversations",
      restore: "Restore conversation: {{name}}",
    },
    todos: {
      title: "Tasks",
      placeholder: "What needs doing?",
      add: "Add",
      empty: "No tasks yet. Add the first one above.",
      openCount: "Open: {{count}}",
      done: "Done",
      remove: "Delete task",
      priority: {
        label: "Priority",
        urgent: "Urgent",
        high: "High",
        medium: "Medium",
        low: "Low",
      },
      due: "Due: {{date}}",
      tabs: { open: "To do", done: "Done" },
    },
    notes: {
      title: "Notes",
      newTitle: "Note title",
      newBody: "Note content...",
      add: "Save note",
      empty: "Your notebook is empty.",
      edit: "Edit",
      save: "Save",
      cancel: "Cancel",
      remove: "Delete note",
      pin: "Pin",
      unpin: "Unpin",
      color: "Note colour",
      attach: "Attach to this item",
      linked: "Linked item",
      unlink: "Detach from item",
      scope: { all: "All notes", material: "This item" },
    },
    saved: {
      title: "Saved items",
      empty: "You have not saved anything yet.",
      searchPlaceholder: "Search saved items...",
      filters: {
        all: "All",
        post: "Articles",
        page: "Pages",
        event: "Events",
        readLater: "Read later",
      },
      open: "Open",
    },
    calendar: {
      title: "Calendar",
      prev: "Previous month",
      next: "Next month",
      today: "Today",
      dayEmpty: "Nothing scheduled that day.",
      full: "Full calendar",
      weekdays: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
    },
    // Reading queue has NO panel of its own any more - `ReadLaterPanel` was
    // removed (zero importers) and the saved-items panel shows its entries.
    // Only the ACTION keys that `SavedPanel` actually calls remain.
    readLater: {
      markRead: "Mark as read",
      markUnread: "Mark as unread",
      archive: "Move to archive",
      remove: "Remove from queue",
    },
  },
};

i18n.addResourceBundle("pl", "translation", dockPl, true, true);
i18n.addResourceBundle("en", "translation", dockEn, true, true);

/** No-op dla tras: rejestracja dzieje się przy ewaluacji modułu. */
export function ensureI18n(): void {}
