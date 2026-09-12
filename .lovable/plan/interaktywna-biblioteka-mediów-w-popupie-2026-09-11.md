# Interaktywna biblioteka mediów w popupie

## Zakres
- Rozszerzyć obecne okno wyboru mediów bez zmiany osobnego panelu biblioteki.
- Zachować wybór pojedynczego pliku do wstawienia, a działania administracyjne oddzielić od zatwierdzenia wyboru.

## Interakcje
- Zwykłe kliknięcie zaznacza jeden plik i pokazuje jego edycję.
- Ctrl/Cmd + kliknięcie przełącza element w zaznaczeniu, a Shift + kliknięcie zaznacza zakres.
- Ctrl/Cmd + A zaznacza wszystkie widoczne pliki; Escape czyści zaznaczenie lub zamyka aktywny element.
- Delete/Backspace otwiera potwierdzenie zbiorczego usunięcia.
- F2 uruchamia edycję nazwy przy pojedynczym zaznaczeniu.
- Dwuklik nadal szybko wstawia pojedynczy plik.

## Foldery i przeciąganie
- Dodać przycisk utworzenia folderu oraz modal z nazwą folderu.
- Lista folderów w dropdownie stanie się celem przeciągania z czytelnym stanem aktywnym.
- Przeciągnięcie jednego zaznaczonego pliku przenosi jego, a przeciągnięcie elementu z wielokrotnego zaznaczenia przenosi cały zestaw.
- Upuszczenie plików z komputera nadal je wgrywa; upuszczenie na folder zapisuje je bezpośrednio w tym folderze.

## Działania zbiorcze i dostępność
- Pasek zaznaczenia pokaże liczbę plików, usuwanie i wyczyszczenie wyboru.
- Wszystkie działania otrzymają etykiety PL/EN, nazwy dostępności i widoczny fokus klawiatury.
- Operacje pozostaną ograniczone do bieżącego użytkownika i organizacji przez istniejące bezpieczne funkcje serwera.

## Technicznie
- Wykorzystać istniejące mechanizmy `useMediaSelection`, `bulkMoveMedia`, `bulkDeleteMedia` i `createMediaFolder`, zamiast powielać logikę.
- Dodać testy dla wielokrotnego wyboru, skrótów, tworzenia folderu, przeciągania oraz operacji zbiorczych.
- Sprawdzić typy i pełny zestaw testów okna mediów.
