# Czytelniejsze wykresy aktywności i stron

## Zakres
- Przebudować kolory mapy „Aktywność dzienna” osobno dla jasnego i ciemnego motywu, aby puste dni, niski i wysoki poziom były jednoznaczne.
- Dodać widoczną skalę intensywności z czytelnymi wartościami zamiast ukrytej legendy.
- Dopasować tło, odstępy i etykiety kalendarza do motywu bez ciemnej plamy w jasnym trybie.
- Zmniejszyć obramowania i odstępy kafli na wykresie „Strony wg wyświetleń”.
- Dodać testy chroniące oba warianty kolorystyczne i cienkie obramowania.

## Szczegóły techniczne
- Zachować wspólny system tokenów wykresów i istniejącą obsługę PL/EN.
- Użyć sekwencyjnych, kontrastowych ramp kolorów dopasowanych do jasnego i ciemnego tła.
- Zweryfikować testami opcje ECharts dla mapy kalendarzowej i treemapy.
