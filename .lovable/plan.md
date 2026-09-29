# Rozdzielenie nazwy, podtytułu i rodzaju wydarzenia

## Cel
Wydarzenie ma przechowywać i prezentować trzy osobne elementy:

- **Rodzaj wydarzenia:** Konferencja
- **Nazwa wydarzenia:** Geopolityczna Gra Mocarstw
- **Podtytuł:** Wyzwania dla nowego światowego ładu gospodarczego

Nagłówek będzie wycentrowany i identyczny na stronie publicznej oraz w podglądzie panelu.

## Zakres wdrożenia

1. **Baza danych**
   - Dodać dwujęzyczne pola `subtitle_pl` i `subtitle_en` do wydarzeń.
   - Wykorzystać istniejące powiązanie z katalogiem rodzajów wydarzeń zamiast zapisywać rodzaj jako dowolny tekst.
   - Rozszerzyć bezpieczne odczyty publiczne i funkcje panelu o nowe pola, zachowując izolację tenantów i obecne uprawnienia.
   - Uzupełnić GGM 2021: nazwa bez rodzaju i podtytułu, osobny podtytuł oraz rodzaj „Konferencja”.

2. **Panel wydarzenia**
   - W sekcji informacji ogólnych dodać wybór rodzaju wydarzenia oraz pola podtytułu PL/EN.
   - Zachować przełącznik języka, walidację, zapis szkicu i podgląd zmian na żywo.
   - Nie zmieniać istniejącego opisu wydarzenia - podtytuł będzie osobnym, krótszym polem.

3. **Prezentacja publiczna i preview**
   - Dodać wspólny, wycentrowany układ: rodzaj nad nazwą, nazwa jako główny tytuł, podtytuł poniżej.
   - Użyć tego samego komponentu na stronie głównej wydarzenia oraz w podglądzie panelu.
   - W nagłówkach zakładek zachować obecny układ, ale pigułkę wydarzenia oprzeć na czytelnej nazwie, nie dawnym połączonym tytule.
   - Zachować poprawne zachowanie dla starszych wydarzeń bez podtytułu lub przypisanego rodzaju.

4. **SEO i pozostałe użycia**
   - Budować pełną nazwę dokumentu i metadane z rodzaju, nazwy oraz podtytułu bez duplikowania tekstu.
   - Zachować zgodność list wydarzeń, kalendarzy, wiadomości i biletów przez kontrolowany fallback do dotychczasowego tytułu.

5. **Weryfikacja**
   - Dodać testy logiki formularza, zapisu, publicznego nagłówka i zgodności preview ze stroną.
   - Uruchomić testy oraz kontrolę typów.
   - Otworzyć najnowszy podgląd GGM 2021 na desktopie i mobile oraz sprawdzić wycentrowanie i brak ucinania tekstu.

## Szczegóły techniczne
- Zmiana schematu będzie addytywna, bez usuwania istniejących kolumn.
- `event_type_id` pozostanie źródłem rodzaju wydarzenia, a etykieta będzie pobierana z `event_types` w języku interfejsu.
- Nowe pola będą nullable, aby nie blokować istniejących wydarzeń.
- Migracja rozszerzy również kontrakty RPC używane przez panel i publiczny nagłówek.
