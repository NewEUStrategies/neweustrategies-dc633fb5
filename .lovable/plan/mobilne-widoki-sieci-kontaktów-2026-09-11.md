# Mobilne widoki sieci kontaktów

## Zakres
- Przebudować układ stron „Osoby” i „Moja sieć” dla telefonów, bez zmian w logice danych.
- Usunąć przycinanie tekstu, filtrów, zakładek i kart osób przy szerokości 393 px.
- Zmniejszyć i uporządkować przyciski oraz zachować wygodne pola dotykowe.
- Zachować obecny wygląd na tabletach i komputerach oraz wersje PL/EN.

## Implementacja
- Nagłówki i akcje: mobilny układ kolumnowy lub siatka z `min-width: 0`.
- Filtry i przełączniki: pełna szerokość na telefonie, dwie kolumny tam, gdzie treść się mieści.
- Zakładki sieci: równy, czytelny układ mobilny bez ukrywania ostatniej zakładki.
- Karty osób: stabilna siatka awatar - dane - akcje, z bezpiecznym zawijaniem i mniejszymi ikonami.
- Pola wyszukiwania: brak automatycznego powiększania i podpowiedzi danych wrażliwych.

## Weryfikacja
- Testy istniejących widoków kontaktów i kontrola typów.
- Sprawdzenie obu stron w podglądzie telefonu 393 px, w tym braku poziomego przewijania.
