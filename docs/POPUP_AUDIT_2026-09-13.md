# Audyt popupu rejestracji - 13.09.2026

Właściciel: Fundacja New European Strategies.

## Wynik odbioru kodu i testów konta

Ta sekcja aktualizuje wcześniejsze, chronologiczne wyniki poniżej.

- Dla kodu `ebebecf` [E2E rejestracji](https://github.com/NewEUStrategies/neweustrategies-dc633fb5/actions/runs/34781697026) zakończyło się sukcesem: **2/2** przypadki. Formularz utworzył konta w lokalnym Auth, wiadomości dotarły do Mailpit, a użycie linków ustawiło potwierdzenie adresu w Auth. Zapis newslettera powstał tylko w wariancie z wybraną opcją. Pozostałe 12 scenariuszy seeded oraz ogólne E2E również przeszły.
- Oceniono [zrzuty mobilne z CI](https://github.com/NewEUStrategies/neweustrategies-dc633fb5/actions/runs/34781697026/artifacts/10325522946). Lokalnie sprawdzono także pełny formularz przy 320x568, 390x844, 390x420 i 768x600. Po poprawce całe pole mieści się w obszarze przewijania (także po zmianie wysokości), przycisk jest osiągalny, Escape działa, a `scrollY` dokumentu pozostaje równy 0. Nadal nie jest to odbiór klawiatury systemowej fizycznego telefonu.
- Pięć wskazanych wcześniej `it.fails` naprawiono i zamieniono na zwykłe testy. Pełna kontrola typów, lint i formatowanie przeszły. Końcowa seria dwóch zmienianych komponentów ma **117 poprawnych przypadków**, **100% linii, 100% funkcji, 99,68% instrukcji i 97,5% gałęzi**. Próg coverage popupów przechodzi lokalnie; nie obniżono żadnego progu.
- Wszystkie workflowy dla `ebebecf` zakończyły pracę. E2E, Lighthouse, First visit oraz CMS widget performance są zielone. [Główne CI](https://github.com/NewEUStrategies/neweustrategies-dc633fb5/actions/runs/34781697031) ma 70 652 poprawne przypadki, 415 oczekiwanych porażek w innych obszarach i 50 pominiętych, ale jest czerwone na coverage. Wykryty dodatkowo brak pokrycia obsługi fokusu popupu został uzupełniony końcowym testem; poza tym pozostają progi dla wykresów, zdarzeń eksperymentów, wykluczeń e-mail, newsletter-admin/status, TTS, impersonacji i branches platformy.
- Końcowa korekta zapisu zgód zachowuje dokładnie etykietę checkboxa z konfiguracji CMS i ten sam oczyszczony HTML, który jest widoczny przy zgodzie. Test porównuje payload zarówno newslettera, jak i konta z treścią interfejsu. Nowy przebieg CI tej wersji wymaga odrębnego odczytu; aktualny wynik jest publikowany w [opisie PR #358](https://github.com/NewEUStrategies/neweustrategies-dc633fb5/pull/358).

**Pozostały odbiór:** doręczenie do produkcyjnej skrzynki, ustawienia hosted Auth i telefon z klawiaturą systemową. PR nie został scalony ani wdrożony. Zaliczenie lokalnego maila nie jest potwierdzeniem doręczenia produkcyjnego.

## Kontynuacja - rejestracja konta i mail potwierdzający

Poniższy audyt początkowy opisuje stan przed kontynuacją. W tej iteracji naprawiono pięć opisanych dalej `it.fails` i zmieniono je w zwykłe testy regresji. Błędy logowania i rejestracji są tłumaczone, a LoginPopup odtwarza fokus elementu wywołującego.

- Zwykły popup `stacked` zawsze używa teraz rejestracji konta, tak jak `split` i `showcase`. Dokumenty newslettera w builderze zachowują własny typ formularza.
- Poprawny formularz wywołuje `supabase.auth.signUp` z hasłem i adresem powrotu. Newsletter pozostaje opcjonalny. Błąd newslettera po utworzeniu konta jest osobno komunikowany.
- Wysłanie przed upływem 1200 ms pokazuje możliwość ponowienia, zamiast udawać utworzenie konta. Ukryty honeypot nadal zatrzymuje spam bez rejestracji.
- Metadane konta `signup_consents` zachowują tekst, język, decyzję, wersję treści i deklarowany czas klienta także bez zapisu do newslettera. Wersja to 96-bitowy skrót treści (SHA-256), a nie dowód tożsamości.
- Serwer newslettera zapisuje dodatkowo własne `received_at` dla każdej zgody. Klient nie może podmienić tego znacznika. JSONB nie wymaga zmiany schematu. `auth.users.created_at` nadal stanowi czas utworzenia konta po stronie serwera; modyfikowalne user_metadata nie są niezmiennym rejestrem audytowym.
- Nowa specyfikacja `e2e/popup-registration.spec.ts` używa rzeczywistego lokalnego Auth, bazy i skrzynki Mailpit: nowe konto, mail z linkiem, potwierdzenie, opcjonalny rekord newslettera oraz widok 390 px i skrócona wysokość 420 px. Nie używa atrap rejestracji. Uruchamia się po pozostałych testach seeded, wyłącznie dla hostów localhost/127.0.0.1. Wynik wymaga oceny nowego przebiegu CI.
- Lokalny `supabase/config.toml` włącza potwierdzanie adresów. Nie zmienia ustawień hostowanego Auth. Produkcja wymaga włączonego potwierdzania e-mail, poprawnej konfiguracji wysyłki oraz dozwolonego adresu powrotu. Konfigurację i doręczenie produkcyjne trzeba odebrać oddzielnie.

Weryfikacja: pierwotne pięć testów przechodzi w serii 188 testów formularzy i newslettera. Rozszerzona walidacja i nowy CI są w toku. CI poprzedniego commitu `9b6d564` zakończyło się sukcesem dla E2E, Lighthouse, First visit i CMS widget performance; główne CI nie przeszło bramki gęstości asercji testu PopupHost oraz kilku progów coverage. Asercja cyklu życia została uzupełniona o stan slotu przed odmontowaniem. Progów coverage nie obniżono.

Dalsze wyniki dla `2559a8e`: pełny typecheck, lint i formatowanie przeszły. 301 lokalnych przypadków w 11 plikach przeszło. W CI wszystkie cztery części testów przeszły: 70 651 poprawnych przypadków, 415 oczekiwanych porażek w pozostałych obszarach oraz 50 pominiętych. Główna bramka nadal nie przeszła progów coverage: `charts/scale`, `experiment-event`, `email/suppression`, `newsletter-admin/status`, `post-tts`, `admin/impersonation` oraz zbiorczego progu branches platformy. Build, verify, pgTAP, pg-harness, Lighthouse, First visit i CMS widget performance zakończyły się sukcesem.

Pierwszy nowy test konta zatrzymał się przed wysłaniem: automatyczny wybór języka przekierował przeglądarkę na `/en`, podczas gdy test szukał polskiej etykiety CTA. Test ma teraz jawny język i obie etykiety konfiguracji, a przycisk identyfikuje przez funkcję formularza. Wymaga ponownej oceny CI - błąd testu nie dowodzi awarii rejestracji ani jej powodzenia.

Lokalny przegląd Chromium rzeczywistej aplikacji z testową konfiguracją popupu obejmuje 320x568, 390x844, 390x420 i 768x600. Przycisk wysłania jest osiągalny po przewinięciu; Escape zamyka okno; dokument nie przewija się poziomo. Stwierdzono przycinanie około 15 px aktywnego pola przez kontener po zmianie wysokości. Poprawka ponawia przewinięcie do aktywnego pola po focusin i zmianie rozmiaru okna/visualViewport, a pola mają własny margines przewijania. Pełny test z rzeczywistą bazą i skrzynką pozostaje osobnym dowodem.

Nie wykonano jeszcze odbioru na fizycznym telefonie z klawiaturą ekranową ani produkcyjnego testu utworzenia konta i doręczenia maila. Zmniejszony viewport nie zastępuje systemowej klawiatury.

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
