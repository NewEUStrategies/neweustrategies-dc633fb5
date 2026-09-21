# Edycja i usuwanie mediów

## Zakres
- Rozszerzyć panel wybranego pliku w bibliotece mediów o edycję nazwy i tekstu alternatywnego.
- Dodać usuwanie wybranego pliku z jednoznacznym potwierdzeniem i stanem przetwarzania.
- Po zapisie lub usunięciu natychmiast odświeżyć listę; po usunięciu wyczyścić zaznaczenie.
- Zachować wybór pliku do wstawienia oraz obsługę PL i EN.

## Szczegóły techniczne
- Wykorzystać istniejące, chronione operacje `updateMediaMeta` i `bulkDeleteMedia`; bez zmian schematu bazy.
- Normalizować zwracane adresy mediów do domeny `neweuropeanstrategies.com`.
- Uzupełnić testy edycji, usuwania, błędów i stanu wyboru.
