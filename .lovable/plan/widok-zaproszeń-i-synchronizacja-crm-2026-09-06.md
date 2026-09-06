# Widok zaproszeń i synchronizacja CRM

## Cel
Rozbudować istniejącą stronę `Admin > Użytkownicy > Zaproszenia` do pełnego rejestru zaproszeń oraz domknąć automatyczny przepływ: utworzenie zaproszenia -> CRM -> e-mail aktywacyjny -> akceptacja -> aktualizacja konta i CRM.

## Zakres
1. **Pełny widok zaproszeń**
   - Dodać podsumowanie liczby wszystkich, oczekujących, błędnych i aktywowanych zaproszeń.
   - Pokazać status konta, datę utworzenia, ostatnią datę wysyłki, datę aktywacji i licznik prób `x / 5`.
   - Dodać filtrowanie po statusie, wyszukiwanie po imieniu/e-mailu oraz czytelne stany PL/EN.
   - Wyłączyć ponowną wysyłkę po aktywacji, wycofaniu lub osiągnięciu 5 prób; zachować możliwość przejścia do konta użytkownika.

2. **Automatyczna wysyłka i CRM**
   - Zapisywać lub aktualizować kontakt CRM tenantowo przy wysłaniu zaproszenia, wraz z imieniem, nazwiskiem, organizacją, stanowiskiem i źródłem zaproszenia.
   - Zachować obecny automatyczny e-mail domenowy z linkiem aktywacyjnym lub danymi tymczasowymi oraz atomowy limit 5 prób.
   - Po potwierdzeniu zaproszenia oznaczyć je jako aktywowane i zaktualizować kontakt CRM oraz czas ostatniej aktywności.
   - Zapewnić idempotencję, aby ponowne wysyłki nie tworzyły duplikatów w CRM ani nie wysyłały wielokrotnie tego samego maila.

3. **Backend i bezpieczeństwo**
   - Dodać migrację odpowiedzialną za tenantową synchronizację statusu akceptacji i CRM po potwierdzeniu konta.
   - Zachować RLS, istniejące role administratorów i brak dostępu między tenantami.
   - Rozszerzyć dane zwracane przez listę zaproszeń o bezpiecznie wyliczony status konta.

4. **Testy i weryfikacja**
   - Dodać testy listy, filtrów, statusów, limitu 5 prób, automatycznej wysyłki, synchronizacji CRM i akceptacji.
   - Uruchomić testy modułu, kontrolę typów oraz sprawdzić stronę w preview w PL i EN.

## Założenie
„Po akceptacji otrzymuje dane konta” oznacza, że wiadomość aktywacyjna zawiera dane dostępu i link, a po użyciu linku konto, zaproszenie i CRM są automatycznie oznaczane jako aktywowane - bez wysyłania hasła w kolejnej wiadomości.
