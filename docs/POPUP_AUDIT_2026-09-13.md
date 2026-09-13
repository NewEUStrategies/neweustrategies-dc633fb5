# Audyt popupu rejestracji - 13.09.2026

Właściciel: Fundacja New European Strategies.

## Zakres i wynik

Audyt kodu wykonano na `main` w wersji `39543746dd5232a0a17ad6addbee14696242f03f`. PR #352 z optymalizacjami CMS jest już scalony. Publiczna aplikacja przekierowała z `https://neweustrategies.lovable.app` do `https://neweuropeanstrategies.com/`. Nie ustalono identyfikatora kompilacji wdrożonej na tej domenie; obserwacje przeglądarkowe i analiza tego commitu są odrębnymi źródłami dowodów.

Aktywny popup to rejestracja „Załóż konto”, wariant showcase: galeria po lewej, formularz po prawej. Wygląd komputerowy jest zasadniczo poprawny, ale zachowanie nie było w pełni poprawne. Poprawki w tej gałęzi usuwają potwierdzone problemy kolejności zgód, przewijania tła i cyklu życia modalnych okien NewsletterPopup oraz PopupHost.

## Sprawdzenie publicznej strony

Pomiar obejmował niezalogowanego odwiedzającego, język polski i okno przeglądarki o wymiarach 1363 x 936 pikseli CSS. Test nie rejestrował konta, nie wysyłał newslettera i nie wprowadzał danych uwierzytelniających.

| Zachowanie                   | Obserwacja                                                                              | Ocena                                      |
| ---------------------------- | --------------------------------------------------------------------------------------- | ------------------------------------------ |
| Wygląd showcase              | Galeria, pola, przycisk wysłania i zamknięcie mieszczą się w oknie                      | Poprawne dla sprawdzonego rozmiaru         |
| Wybór kadru                  | Kliknięcie „Slajd 2” zmienia podpis na „Spotkania eksperckie”                           | Poprawne                                   |
| Walidacja pustego formularza | Pojawia się komunikat „Niepoprawny adres e-mail.” z rolą alert; konto nie jest tworzone | Podstawowa walidacja działa                |
| Klawiatura                   | Shift+Tab z zamknięcia przechodzi na link logowania; Tab wraca na zamknięcie            | Pętla fokusu działa                        |
| Escape                       | Zamyka popup                                                                            | Poprawne                                   |
| Odświeżenie po zamknięciu    | Popup nie wraca w tej samej wizycie po przeładowaniu strony                             | Poprawne                                   |
| Odmowa marketingu            | Po „Tylko niezbędne” pojawia się popup rejestracji                                      | Błąd względem kontraktu overlayCoordinator |
| Przewijanie poza panelem     | Gest nad tłem zmienia window.scrollY z 0 na 520 px przy nadal otwartym popupie          | Błąd                                       |

Konsola w tej próbie zawierała błędy rozszerzenia przeglądarki. Nie przypisano ich aplikacji.

## Potwierdzone przyczyny i poprawki

### 1. Kolejka popupów wyprzedzała zapis decyzji o zgodach

ConsentBanner miał dwa efekty. Sprzątanie efektu widoczności wywoływało `setConsentOverlayVisible(false)`, co od razu uruchamiało kolejkę. Dopiero kolejny efekt przekazywał `setMarketingConsent(false)`. Oczekujący popup dostawał więc slot, kiedy decyzja marketingowa była jeszcze nieaktualna. Późniejsza odmowa nie cofała już przyznanego slotu.

Poprawka synchronizuje te operacje w jednym efekcie: zamyka bramkę, jeśli baner jest widoczny, aktualizuje efektywną decyzję, a dopiero potem otwiera bramkę. Sprzątanie widoczności następuje przy odmontowaniu komponentu. Do blokady wlicza się także 300 ms animacji wyjścia banera. Test integracyjny korzysta z rzeczywistego koordynatora, sprawdza odmowę i akceptację oraz koniec animacji. Nie jest to ocena prawna; poprawka realizuje istniejącą politykę produktu.

### 2. Modalne popupy nie blokowały dokumentu

NewsletterPopup i PopupHost miały pułapkę fokusu i przewijane panele, ale nie blokowały przewijania strony. `overscroll-contain` na kolumnie formularza nie przechwytuje gestu wykonanego poza nią.

Wspólny `useBodyScrollLock` blokuje przewijanie body i głównego elementu dokumentu przez czas otwarcia. Zachowuje miejsce na pasek przewijania i odtwarza poprzednie style przy zamknięciu. Licznik blokad zapobiega odblokowaniu strony, kiedy drugi popup nadal trzyma blokadę. Osobne testy obejmują współistnienie blokad, StrictMode i odtworzenie wcześniejszych stylów.

### 3. Przyznany slot pozostawał zajęty po usunięciu popupu

Sprzątanie wyzwalacza usuwało oczekujące żądanie, ale nie zwalniało już przyznanego slotu. Usunięty komponent mógł blokować kolejkę. Otwarte okno mogło też pozostać nad inną stroną po nawigacji. Wyłączenie popupu rejestracji w ustawieniach usuwało jego wygląd bez zwolnienia slotu.

Oba hosty zwalniają przyznany slot przy odmontowaniu i zamykają popup po zmianie ścieżki. NewsletterPopup robi to również przy zmianie przełącznika włączenia. Testy sprawdzają brak dialogu oraz dokładnie jedno zwolnienie slotu.

## Walidacja zmian

Przed poprawkami nowa seria zawierała 8 błędnych i 92 poprawne przypadki. Po poprawkach te same 100 przypadków przeszło. Rozszerzona suita popupów, formularzy, banera i zarządzania fokusem: **274 poprawne przypadki oraz 5 istniejących przypadków oczekiwanej porażki**, 10 plików testowych, razem 279 przypadków. Przypadków oczekiwanej porażki nie należy przedstawiać jako potwierdzenia poprawności.

Dodatkowo zaliczono 78 testów integracji banera, powłoki aplikacji i importów tłumaczeń. Razem daje to **352 poprawne przypadki i 5 oczekiwanych porażek**. ESLint, formatowanie zmienionego kodu i `git diff --check` zakończyły się poprawnie. Wynik pełnej kontroli typów zostanie zapisany w opisie PR.

## Pozostałe ograniczenia i dalsze decyzje

- Pięć istniejących `it.fails` opisuje: brak wersji i czasu w klienckim payloadzie zgody, surowy komunikat błędu dostawcy w formularzu rejestracji, dwa warianty nieprzetłumaczonych błędów LoginPopup oraz brak przywrócenia fokusu po zamknięciu LoginPopup. Nie zostały naprawione w tym zakresie. Sam brak czasu w payloadzie klienta nie dowodzi braku znacznika po stronie serwera; wymaga to sprawdzenia całego zapisu i potwierdzenia subskrypcji.
- Na publicznej stronie opcjonalny newsletter był domyślnie zaznaczony. Jest to obserwacja konfiguracji; decyzja o zmianie domyślnego wyboru powinna być osobna.
- Publicznej rejestracji, potwierdzenia wiadomości e-mail, MFA i rzeczywistego zapisu newslettera nie przeprowadzono. Testy formularza stosują atrapy usług. Powodzenie walidacji interfejsu nie dowodzi powodzenia tych operacji.
- Nie wykonano pomiaru wizualnego na telefonie ani testu klawiatury ekranowej. Testy komponentów i analiza klas responsywnych nie zastępują renderowania mobilnego. Dalszy odbiór powinien obejmować szerokości 320, 390 i 768 px, krótkie okno poziome, fokus pola z otwartą klawiaturą oraz dostępność X i przycisku wysłania po przewinięciu.
- Galeria nie ma kontroli pauzy automatycznej rotacji ani obsługi prefers-reduced-motion w swoim efekcie czasowym. Warto uwzględnić to w kolejnym odbiorze dostępności.
- Rozszerzenie audytu o powyższe przypadki powinno mieć osobne kryteria: brak surowych błędów dostawcy w UI, odtworzony fokus wywołującego, 0 px przewijania tła, brak nakładania banera i popupu oraz osiągalność wszystkich pól na telefonie.

Zmiany są przygotowane do przeglądu kodu. Audyt nie obejmuje scalenia ani wdrożenia produkcyjnego.
