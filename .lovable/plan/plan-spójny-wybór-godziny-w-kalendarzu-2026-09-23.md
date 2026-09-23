# Plan: spójny wybór godziny w kalendarzu

## Zakres
- Zastąpić natywne pole czasu własnym selektorem godzin i minut, zgodnym z wyglądem panelu.
- Zachować ręczny wybór czasu, akcje „Teraz” i „Wyczyść” oraz obsługę PL/EN.
- Dopasować szerokość i układ popupu, aby lista czasu nie wychodziła poza kalendarz.
- Dodać testy zmiany godziny i minut oraz sprawdzić formularz początku i końca wydarzenia.

## Szczegóły techniczne
- Użyć istniejących kontrolek projektu zamiast systemowego `input type="time"`.
- Godziny: 00-23; minuty: kroki co 5 minut, z zachowaniem bieżącej wartości także poza krokiem.
- Bez zmian danych wydarzenia i sposobu zapisu czasu.
