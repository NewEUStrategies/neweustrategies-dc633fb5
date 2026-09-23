# Animowane kafelki prelegentów

## Zakres
- Zachować publiczną siatkę prelegentów w trzech kolumnach na szerokim ekranie oraz jej obecne warianty mobilne.
- Przebudować sam kafelek na bardziej wizualny układ z większym zdjęciem, czytelną rolą, organizacją i oznaczeniem eksperta.
- Po kliknięciu płynnie powiększać wybrany kafelek nad siatką, pokazując pełne dane profilu dostępne już w aplikacji.
- Dodać przyciemnione tło, przycisk zamknięcia, zamknięcie klawiszem Escape i kliknięciem poza kafelkiem oraz blokadę przewijania pod spodem.
- Zachować poprawną obsługę osób bez konta i kart bez dodatkowych danych, które nie powinny udawać interaktywnych.

## Animacja i dostępność
- Użyć współdzielonego przejścia geometrii kafelka, subtelnego zanikania treści oraz ustawień respektujących ograniczenie animacji systemowych.
- Zachować prawidłowy fokus klawiatury, opis przycisku zamknięcia i semantykę okna profilu.

## Weryfikacja
- Rozszerzyć testy siatki o trzy kolumny, otwieranie i zamykanie rozwiniętego kafelka oraz brak interakcji dla pustego profilu.
- Sprawdzić widok publiczny na komputerze i telefonie oraz uruchomić testy kierunkowe, typy i formatowanie.
