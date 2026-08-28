# Edytowalny profil uczestnika i pełna wizualizacja

## Cel
Ujednolicić zakładkę „Mój profil” w podglądzie studia, prywatny panel uczestnika i publiczny katalog tak, aby korzystały z tych samych danych oraz komponentów. Użytkownik ma móc edytować i zapisać profil, a po zapisie od razu zobaczyć aktualną wizytówkę.

## Zakres wdrożenia

1. **Edycja i zapis w podglądzie wydarzenia**
   - Zastąpić statyczną listę pól w `PreviewMePanel` właściwym formularzem `MyEventProfileForm`.
   - Zachować przełącznik „Zobacz, jak widzą Cię inni”, ale wizytówkę renderować z aktualnego stanu zapisanego w backendzie.
   - Obsłużyć dwa przypadki: istniejąca kartoteka wydarzenia oraz zalogowany redaktor bez kartoteki wydarzenia. W drugim przypadku zapis będzie aktualizował wyłącznie jego globalny profil, bez tworzenia fikcyjnej rejestracji.
   - Po zapisie odświeżyć profil wydarzenia, globalny profil, wizytówkę, katalog uczestników i dane brandu firmy.

2. **Firma i logo z CRM**
   - Zachować wyszukiwarkę organizacji oraz popup dodawania organizacji w formularzu.
   - Powiązać wybór organizacji z jej identyfikatorem, zamiast opierać dopasowanie wyłącznie na nazwie, z kompatybilnym fallbackiem dla starszych rekordów.
   - Pokazać logo i klikalną stronę organizacji na wizytówce oraz w katalogu uczestników, bez ujawniania danych kontaktowych CRM.

3. **Pełna karta uczestnika w katalogu**
   - Rozszerzyć bezpieczną odpowiedź katalogu o: `user_id`, logo i stronę firmy, branżę, specjalizację, „czego szukam”, „co oferuję” oraz social media.
   - Nie dodawać prywatnego e-maila ani telefonu do katalogu bez istniejących zgód widoczności.
   - Użyć wspólnych komponentów `EventSocialLinks` i `EventPersonActions`, aby ikony social zachowywały się jak w nagłówku, a akcje „dodaj do kontaktów”, spotkanie 1:1 i czat miały te same reguły co reszta platformy.
   - Czat pozostanie dostępny wyłącznie po zaakceptowaniu kontaktu i dla zalogowanych użytkowników.

4. **Spójność wizualna i i18n**
   - Zachować rounding 6px, tokeny motywu oraz układ responsywny.
   - Uzupełnić teksty PL/EN dla trybu edycji, zapisu globalnego profilu i rozszerzonej karty katalogowej.
   - Usunąć mylący komunikat o zapisie z widoku, który wcześniej był tylko do odczytu.

5. **Testy i weryfikacja**
   - Dodać testy formularza w podglądzie: edycja, zapis, widoczność kontaktu, synchronizacja konta i przełączenie na wizytówkę.
   - Dodać testy parsera/RPC katalogu oraz renderowania logo CRM, social mediów, branży, specjalizacji, „szukam/oferuję” i akcji networkingowych.
   - Dodać testy backendu potwierdzające izolację tenanta, brak ekspozycji prywatnych danych i zapis wyłącznie własnego profilu.
   - Zweryfikować przepływ w działającym preview jako zalogowany użytkownik na desktopie i mobile.

## Szczegóły techniczne
- Aktualizacja istniejących RPC profilu i katalogu przez migrację, bez nowych publicznych tabel.
- Zapis nadal identyfikuje użytkownika przez sesję backendu, nigdy przez `user_id` przesłane z klienta.
- Dane kontaktowe firmy pozostają poza publicznym DTO; katalog otrzyma jedynie bezpieczne dane brandowe.
- Komponenty formularza i wizytówki będą współdzielone między studiem i stroną `/events/$slug/me`, aby kolejne zmiany nie rozjechały preview i publikacji.
