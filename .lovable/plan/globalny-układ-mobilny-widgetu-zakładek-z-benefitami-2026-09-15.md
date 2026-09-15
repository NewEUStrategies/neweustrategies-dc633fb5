# Globalny układ mobilny widgetu zakładek z benefitami

## Zakres
- Ujednolicić wspólny renderer widgetu zakładek, aby poprawka działała automatycznie na każdej stronie i w każdym miejscu jego użycia.
- Na telefonach wyświetlać zakładki w stabilnej siatce dwóch równych kolumn, bez poziomego przewijania i przycinania.
- Wycentrować ikonę oraz etykietę względem pełnej szerokości zakładki.
- Zapewnić zawijanie długich etykiet i całej treści aktywnego panelu bez wychodzenia poza ekran.
- Zachować obecny układ na tabletach i komputerach, w tym wariant poziomy, pionowy oraz ustawienia wyrównania.

## Weryfikacja
- Rozszerzyć testy wspólnego widgetu o oba warianty i długie treści.
- Sprawdzić widok na szerokości telefonu oraz brak poziomego przepełnienia.
- Uruchomić testy zakresowe i kontrolę typów.

## Szczegóły techniczne
- Zmiana zostanie wykonana w jednym współdzielonym komponencie `TabsBlock`, przez który przechodzą wszystkie instancje widgetu w publicznym rendererze.
- Mobilny układ będzie oparty o grid z `min-width: 0`, pełną szerokość etykiety i bezpieczne łamanie tekstu; breakpointy desktopowe zachowają dotychczasowe zachowanie.
