# Moduł Wydarzenia: audyt i naprawa 48 usterek

Stan odniesienia: `ec7afd4a69d76c8ddd004ced205dd695dd7d9c53` na `main`, 29 września 2026.
Gałąź napraw: `fix/events-known-defects-2026-09-29`.

**Ocena po opisanych poprawkach: 77%.** Moduł ma szeroki zakres funkcji i rozbudowany backend, lecz nie jest jeszcze w pełni spójny. Największym pozostałym problemem jest wiarygodność procesu wydania: czerwone CI, rozjazdy testów z kontraktami oraz różnica między deklarowaną gotowością do publikacji a rzeczywistą bramką zapisu.

Ocena dotyczy kodu i dostępnych dowodów testowych. Nie jest procentem pokrycia testami, certyfikatem bezpieczeństwa ani potwierdzeniem stanu produkcyjnej bazy. Nie wykonywano płatności, wysyłki wiadomości, migracji produkcyjnych ani ręcznej oceny wyglądu na urządzeniach.

| Obszar                           | Ocena | Waga | Uzasadnienie                                                                                                                 |
| -------------------------------- | ----: | ---: | ---------------------------------------------------------------------------------------------------------------------------- |
| Zakres funkcjonalny              |   90% |  20% | Duża część cyklu wydarzenia jest zaimplementowana, także CFP, spotkania, miejsca i obsługa na miejscu.                       |
| Frontend i zachowanie interfejsu |   80% |  25% | Poprawiono utratę szkiców, walidację, stany błędów i dostępność; pozostają porażki testów spójności powierzchni publicznych. |
| Backend i model danych           |   82% |  25% | Są ograniczenia SQL, autoryzacja tenantów, transakcje i testy bazy; kontrakty i ścieżki migracji wymagają uporządkowania.    |
| Spójność między warstwami        |   75% |  15% | Usunięto 48 zarejestrowanych rozbieżności, ale gotowość do publikacji i część kontraktów nadal nie są wspólne.               |
| Gotowość do wydania              |   50% |  15% | CI na bazowym commicie jest czerwone; brak potwierdzenia całego procesu na rzeczywistej konfiguracji produkcyjnej.           |

Średnia ważona: 77,25%, zaokrąglona do 77%.

## Co moduł już zawiera

Nawigacja studia definiuje **41 sekcji**. Liczba sekcji nie oznacza 41 niezależnych, w pełni zweryfikowanych produktów. Część ekranów agreguje inne moduły albo odsyła do wspólnej konfiguracji.

| Obszar              | Obecna implementacja                                                                                   | Ocena spójności i ograniczenia                                                                                                 |
| ------------------- | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| Studio organizatora | Informacje ogólne, statusy, konfiguracja stron, grupy, zgody, branding, funkcje dodatkowe.             | Wspólne komponenty i nawigacja ułatwiają utrzymanie. Bramka publikacji nie korzysta z pełnego raportu gotowości.               |
| Strona publiczna    | Wielojęzyczne treści, układ strony, sekcje, agenda, sponsorzy, prelegenci, SSR.                        | Nie zmierzono czasu ładowania na produkcji. Testy parytetu informacji o prelegentach nadal zgłaszają rozbieżności.             |
| Rejestracja         | Formularze, pola, grupy, zgody, ograniczenia dostępu, lista zgłoszeń, akceptacja i lista rezerwowa.    | Duży zakres, ale część testów ustawień nadal korzysta ze starego RPC zapisu.                                                   |
| Bilety i zamówienia | Typy biletów, pakiety, kody, grupy i goście, integracja płatności, benefity planów.                    | Istnieją testy logiki; sprawdzony scenariusz Playwright płatnej rejestracji używa atrap RPC i odpowiedzi kasy.                 |
| Faktury             | Wystawianie, dokumenty, korekty i obsługa stanu KSeF.                                                  | KSeF jest ręcznym rejestrem statusu i numeru. Interfejs wprost informuje, że wysyłka odbywa się poza systemem.                 |
| Program             | Sesje, ścieżki, sale, prelegenci i wykrywanie konfliktów.                                              | Poprawiono puste wiersze konfliktów i stan pustego wyszukiwania wystawców.                                                     |
| CFP                 | Konfiguracja naboru, formularz, zgłoszenia i recenzenci.                                               | Zaawansowana funkcja już obecna; nie należy wpisywać jej na listę braków.                                                      |
| Spotkania           | Giełda, dostępność uczestników, zaproszenia, stoliki, statusy i statystyki.                            | Poprawiono niepotrzebny odczyt dla niezapisanych, komunikaty walidacji, stan stolika, precyzję procentów i podwójne odwołanie. |
| Miejsca             | Plany sal i przypisywanie miejsc.                                                                      | Jest osobny model i obsługa rezerwacji. Weryfikacja dużego wydarzenia wymaga testu współbieżności na docelowej konfiguracji.   |
| Odprawa             | Stanowisko, dziennik, punkty kontrolne, kierunki wejścia/wyjścia, urządzenia, statystyki.              | Poprawiono bramki wyjściowe i błędne daty w statystykach.                                                                      |
| Skaner              | Parowanie urządzeń, uprawnienia, wygaśnięcie i odwołanie sesji, kolejka oraz opcjonalna lista offline. | Czasowa blokada zachowuje skan, lecz nie przyznaje lokalnie wejścia ani nie odblokowuje zimnego startu z pamięci.              |
| Identyfikatory      | Szablony, wydawanie partii i rejestr wydruków.                                                         | Poprawiono powody wydruku, liczbę kopii i ostrzeżenia o ponownym wydruku osób ukrytych przez wyszukiwanie.                     |
| Sponsorzy           | Poziomy, firmy z CRM, migawki danych, kontakty, materiały i publikacja.                                | Poprawiono limity, szkice, zakres odświeżania cache, zaznaczenie zbiorcze, paginację i etykiety przełączników.                 |
| Leady               | Zbieranie leadów i eksport danych kontaktowych.                                                        | Wynik eksportu nie trafia już do cache zapytań ani mutacji React Query.                                                        |
| Komunikacja         | Wiadomości związane z rejestracją i biletem, przypomnienia, follow-up, kalendarz i portfel.            | Niektóre sytuacje brzegowe są nadal wymienione jako otwarte w dokumentacji wdrożenia części 3. Wymagają osobnego domknięcia.   |
| Analityka           | Agregaty rejestracji, programu, spotkań i odprawy oraz osobne raporty sponsorów i kampanii.            | Pulpit rozróżnia błąd od odczytu, umożliwia ponowienie i nie odpytuje agregatu odprawy co 30 sekund.                           |
| Kolejne edycje      | Podgląd i klonowanie wydarzenia.                                                                       | Funkcja istnieje; nie jest brakującym elementem podstawowego zakresu.                                                          |

Źródła zakresu: [nawigacja studia](../src/lib/events/eventStudioNav.ts), [komponenty organizatora](../src/components/admin/events), [komponenty uczestnika](../src/components/events), [warstwa domenowa i API](../src/lib/events), [testy płatnej rejestracji](../e2e/event-paid-registration.spec.ts), [skaner E2E](../e2e/scanner.spec.ts).

## Co naprawiono

W 29 plikach było 48 przypadków oznaczonych `it.fails`. Taki test przechodzi, gdy oczekiwanie poprawnego zachowania się nie spełnia. Zatem zielony wynik nie potwierdzał usunięcia opisanej usterki.

Wszystkie 48 przypadków stało się zwykłymi testami regresyjnymi. Zmieniono kod wykonawczy oraz oczekiwania, które wcześniej utrwalały błędny kontrakt, np. globalny klucz cache szczegółów sponsora. Nie pomijano testów ani nie obniżano progów jakości.

- Rozdzielono limity nazw i opisów grup, poziomów oraz materiałów. Walidacja uwzględnia także dodatni limit firm, rangę, kraj, adres strony, treść zgody i minimalną podstawę ulgi.
- Wspólny hook inicjalizuje szkic przy otwarciu lub zmianie rekordu. Odświeżenie tego samego rekordu i podpowiadanej kolejności go nie nadpisuje.
- Cache sponsorów jest ograniczony do konkretnego wydarzenia. Eksport leadów przekazuje dane bez przechowywania wyniku w cache mutacji.
- Skan odrzucony czasową blokadą zostaje w kolejce. Jawna odmowa serwera nie uruchamia sesji z pamięci i nie staje się lokalną zgodą na wejście.
- Naprawiono kierunki bramek, komunikaty blokady, liczbę kopii, powody druku, ochronę podwójnego odwołania i ostrzeżenie obejmujące całą zaznaczoną partię.
- Analityka pokazuje awarie i ma ponowienie odczytu. Małe, dodatnie odsetki zachowują precyzję w modelu i są wyświetlane jako `<1%` zamiast `0%`.
- Uporządkowano puste stany, nieprawidłowy HTML, etykiety dostępności, reset brandingu, zaznaczenie sponsorów i powrót z pustej strony.

Nie zmieniono schematu bazy. Poprawki dostosowują klienta do istniejących ograniczeń i kontraktów.

## Pozostałe niespójności i braki

| Priorytet | Ustalenie                                                                                                                                                                                   | Zalecenie i kryterium zakończenia                                                                                                                                                                                        |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| P0        | Na bazowym commicie CI nie przechodzi. Porażki obejmują m.in. format, lint, kontrakt RPC, importy tłumaczeń, budżet bundla, testy i kontrolę wdrożenia.                                     | Przywrócić zielone wymagane bramki. Nie traktować przejścia pakietu tych 48 napraw jako potwierdzenia całego wydania.                                                                                                    |
| P1        | `admin_event_general_save_v2` jest używane przez klienta i istnieje w migracjach Drizzle 0110/0111, ale część testów i bramka kontraktu nie rozpoznają tego stanu.                          | Ujednolicić źródło kontraktów i uwzględnianie obu ścieżek migracji. Zaktualizować atrapy RPC; potwierdzić odtworzenie funkcji na czystej bazie. Nie oznacza to automatycznie braku funkcji na produkcji.                 |
| P1        | Raport gotowości określa jako blokery m.in. brak okładki, miejsca, strefy i konflikty. Przycisk i RPC publikacji nie egzekwują całego tego raportu.                                         | Ustalić wspólną politykę publikacji. Jeśli to rzeczywiste blokery, egzekwować je transakcyjnie w backendzie; jeśli zalecenia, tak je nazwać. Test: wskazany bloker uniemożliwia publikację także przez bezpośrednie RPC. |
| P1        | `EventReadinessPanel` zastępuje brak danych zerami, np. brak odpowiedzi o konfliktach liczy jak zero konfliktów.                                                                            | Dodać stany ładowania, błędu i ponowienia. Awaria odczytu nie może skutkować komunikatem „gotowe do publikacji”.                                                                                                         |
| P1        | Pięć testów dotyczących prelegentów nadal nie przechodzi: parytet faktów oraz dodatkowe odczyty w scenariuszach osoby bez konta.                                                            | Przejrzeć wspólną projekcję i komponenty. Rozdzielić zmianę zamierzonego kontraktu od rzeczywistej utraty informacji; nie usuwać asercji parytetu.                                                                       |
| P1        | Dokumentacja części 3 nadal wymienia brak zawiadomień przy zamknięciu pojedynczego gościa, ręczny zwrot po odrzuceniu opłaconego zgłoszenia i brak starego RSVP po awansie płatnej kolejki. | Zweryfikować te scenariusze na końcowym zestawie migracji, następnie domknąć stan udziału, bilet, płatność i wiadomość jako jeden proces. To lista pozostała w dokumentacji, a nie wynik operacji na produkcji.          |
| P1        | Sprawdzony test przeglądarkowy płatnej rejestracji używa atrap.                                                                                                                             | Uzupełnić test środowiska integracyjnego: rejestracja, płatność w trybie testowym, ponowiony webhook, bilet, faktura, odprawa, zwrot i unieważnienie biletu. Istniejące testy jednostkowe zachować.                      |
| P2        | KSeF jest ręcznym rejestrem, a część integracji korzysta z konfiguracji globalnej.                                                                                                          | Jeśli potrzebna jest automatyzacja, dodać adapter wysyłki, odbiór statusów, ponawianie i dziennik błędów. To rozszerzenie produktu, nie dowód braku fakturowania.                                                        |
| P2        | Audyt kodu nie potwierdza wydajności na dużej liście uczestników ani ergonomii rzeczywistych urządzeń.                                                                                      | Zmierzyć największe listy i raporty, kolejkę skanów oraz pierwsze ładowanie. Wykonać przegląd mobilny i klawiaturowy kluczowych procesów na środowisku testowym.                                                         |

Dowody:

- [CI bazowego commita](https://github.com/NewEUStrategies/neweustrategies-dc633fb5/actions/runs/36543947148). `events-harness` i pgTAP przeszły; cały CI pozostał czerwony. Nie sprawdzono przyczyny produkcyjnych kroków `Database contract` i `Migration ledger`, więc ich niepowodzenie nie jest tu interpretowane jako potwierdzony błąd schematu produkcyjnego.
- [Klient zapisu wydarzenia](../src/lib/events/eventDetailApi.ts), [Drizzle 0110](../drizzle/migrations/0110_event_identity_subtitles_and_type.sql), [Drizzle 0111](../drizzle/migrations/0111_event_general_type_without_legacy_kind_sync.sql).
- [Reguły gotowości](../src/lib/events/publishReadiness.ts), [panel gotowości](../src/components/admin/events/organisms/EventReadinessPanel.tsx), [akcja publikacji](../src/components/admin/events/studio/EventStudioShell.tsx), [przycisk publikacji](../src/components/admin/events/studio/EventStudioTopBar.tsx), [definicja RPC zmiany statusu](../supabase/migrations/20260826114319_e981f858-db1a-48e4-880b-5f8ceece179c.sql).
- [Lista pozostałych scenariuszy części 3, sekcja 5](./WDROZENIE_BRAKI_WYDARZEN_CZ3_2026-09-26.md), [komunikat o ręcznej obsłudze KSeF](../src/lib/i18n-admin-event-invoices.ts).

Przełączniki `features` celowo ukrywają sekcje panelu organizatora. Publiczną widocznością zarządza inna konfiguracja. [Kod opisuje tę decyzję](../src/lib/events/eventFeatures.ts); nie klasyfikuję jej jako pominiętej kontroli uprawnień. Warto utrzymać jasne nazwy obu ustawień.

## Weryfikacja

- **Końcowy pakiet: 1331/1331 testów w 34 plikach.** Obejmuje wszystkie 48 napraw, powiązane walidatory oraz rozszerzone testy skanera. Bez `it.fails`, pominięć i `todo` w tym przebiegu.
- **Typy:** kontrola wszystkich zmienionych plików TypeScript i ich rzeczywistych zależności, z konfiguracją projektu, zakończona bez błędów. Pełna lokalna kontrola całego repozytorium została przerwana z powodu presji pamięci; nie jest raportowana jako zaliczona. Pełny Typecheck bazowego commita przeszedł w GitHub Actions.
- **ESLint zmienionych plików:** 0 błędów; 2 istniejące ostrzeżenia o zależnościach `useMemo` w panelach sponsorów i wydruku partii.
- **Prettier i `git diff --check`:** kontrola zmienionych plików.
- **Szerszy przebieg modułu:** 11 353 testy w 523 plikach; 11 327 przeszło, 26 nie przeszło. Jedna porażka wskazała konieczność oddzielenia ponowienia skanu od uruchomienia zablokowanej sesji z pamięci. Została następnie naprawiona i potwierdzona w końcowym pakiecie 1331 testów. Pozostałych 25 porażek występowało już w bazowym commicie.
- **SQL:** przejście `events-harness` i pgTAP potwierdzono w CI dokładnie dla bazowego commita. Nie uruchamiano lokalnego PostgreSQL ani nie modyfikowano migracji.

Testy uruchamiano z `TZ=UTC`. Trzy początkowe porażki testów godzin znikały w UTC, zgodnie z założeniami tych testów. Docelowo ich fixture'y warto uniezależnić od strefy maszyny.

Pozostałe 25 porażek spoza tej naprawy:

| Plik                                       | Liczba | Charakter                                                                            |
| ------------------------------------------ | -----: | ------------------------------------------------------------------------------------ |
| `EventRegistrationSettingsPanel.test.tsx`  |     18 | Stare atrapy RPC zapisu względem klienta używającego `admin_event_general_save_v2`.  |
| `EventPagesMenuPanelBehaviour.test.tsx`    |      1 | Oczekiwany zapis nie jest obserwowany przez test.                                    |
| `eventErrorMapsI18n.gate.test.ts`          |      1 | Bramka nie znajduje definicji `admin_event_general_save_v2` w swoim źródle migracji. |
| `eventSpeakerFactParity.gate.test.tsx`     |      3 | Rozbieżności faktów i polityki wyświetlania ścieżek.                                 |
| `eventSpeakerWithoutAccount.gate.test.tsx` |      2 | Kontrakt liczby/rodzaju odczytów w powierzchniach prelegentów.                       |

Testy te pozostają aktywne. Nie maskowano ich przez `skip`, `fails` ani zmianę progów.

## Rejestr 48 napraw

Każdy wiersz odpowiada jednemu pierwotnemu `it.fails`. Nazwy opisują obecnie oczekiwane, poprawne zachowanie.

| Nr  | Zachowanie chronione testem                                           | Plik                                                                                                                |
| --- | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| 1   | zapis sponsora odświeża szczegóły tylko w jego wydarzeniu             | [useEventSponsors.test.ts](../src/lib/events/__tests__/useEventSponsors.test.ts)                                    |
| 2   | czasowa blokada urządzenia zachowuje skan w kolejce do ponowienia     | [useScanner.test.tsx](../src/lib/events/__tests__/useScanner.test.tsx)                                              |
| 3   | limit nazwy grupy jest zgodny z limitem bazy: 80 znaków               | [termsGroupsDbEnumParity.test.ts](../src/lib/events/__tests__/termsGroupsDbEnumParity.test.ts)                      |
| 4   | limit opisu grupy jest zgodny z limitem bazy: 500 znaków              | [termsGroupsDbEnumParity.test.ts](../src/lib/events/__tests__/termsGroupsDbEnumParity.test.ts)                      |
| 5   | limit nazwy poziomu jest zgodny z bazą: 80 znaków                     | [sponsorEnumParity.test.ts](../src/lib/events/__tests__/sponsorEnumParity.test.ts)                                  |
| 6   | limit tytułu materiału jest zgodny z bazą: 160 znaków                 | [sponsorEnumParity.test.ts](../src/lib/events/__tests__/sponsorEnumParity.test.ts)                                  |
| 7   | limit opisu poziomu jest zgodny z bazą: 1000 znaków                   | [sponsorEnumParity.test.ts](../src/lib/events/__tests__/sponsorEnumParity.test.ts)                                  |
| 8   | zerowy limit firm jest odrzucany przed zapisem                        | [sponsorEnumParity.test.ts](../src/lib/events/__tests__/sponsorEnumParity.test.ts)                                  |
| 9   | ranga poziomu większa od 1000 jest odrzucana przed zapisem            | [sponsorEnumParity.test.ts](../src/lib/events/__tests__/sponsorEnumParity.test.ts)                                  |
| 10  | jednoznakowa nazwa poziomu jest odrzucana przed zapisem               | [sponsorEnumParity.test.ts](../src/lib/events/__tests__/sponsorEnumParity.test.ts)                                  |
| 11  | jednoznakowy tytuł materiału jest odrzucany przed zapisem             | [sponsorEnumParity.test.ts](../src/lib/events/__tests__/sponsorEnumParity.test.ts)                                  |
| 12  | strona firmy wymaga pełnego adresu zamiast ścieżki względnej          | [sponsorEnumParity.test.ts](../src/lib/events/__tests__/sponsorEnumParity.test.ts)                                  |
| 13  | jednoznakowy kraj migawki jest odrzucany przed zapisem                | [sponsorEnumParity.test.ts](../src/lib/events/__tests__/sponsorEnumParity.test.ts)                                  |
| 14  | patron medialny może być opublikowany bez poziomu sponsorskiego       | [sponsorEnumParity.test.ts](../src/lib/events/__tests__/sponsorEnumParity.test.ts)                                  |
| 15  | komunikat odmowy wskazuje dostęp wyłącznie dla administracji          | [adminTermsErrors.test.ts](../src/lib/events/__tests__/adminTermsErrors.test.ts)                                    |
| 16  | eksport leadów nie pozostawia danych kontaktowych w cache mutacji     | [useEventOnsite.test.tsx](../src/lib/events/__tests__/useEventOnsite.test.tsx)                                      |
| 17  | osoba niezapisana nie uruchamia zapytania o listę spotkań             | [MeetingExchangeBoard.test.tsx](../src/components/events/meetings/__tests__/MeetingExchangeBoard.test.tsx)          |
| 18  | błąd kolejności godzin ma odrębny komunikat walidacji                 | [AvailabilityWindowDialog.test.tsx](../src/components/events/meetings/__tests__/AvailabilityWindowDialog.test.tsx)  |
| 19  | stopka skanera ma poprawne zagnieżdżenie HTML                         | [ScannerApp.test.tsx](../src/components/events/scanner/organisms/__tests__/ScannerApp.test.tsx)                     |
| 20  | czasowa blokada urządzenia jest widoczna dla operatora druku          | [ScannerBadgePanel.test.tsx](../src/components/events/scanner/organisms/__tests__/ScannerBadgePanel.test.tsx)       |
| 21  | potwierdzenie wydruku pokazuje liczbę sztuk zwróconą przez bazę       | [ScannerBadgePanel.test.tsx](../src/components/events/scanner/organisms/__tests__/ScannerBadgePanel.test.tsx)       |
| 22  | wyłączony stolik ma tekstowe oznaczenie stanu                         | [MeetingStatsPanel.test.tsx](../src/components/admin/events/__tests__/MeetingStatsPanel.test.tsx)                   |
| 23  | podwójne kliknięcie wysyła tylko jedno odwołanie spotkania            | [MeetingsListPanel.test.tsx](../src/components/admin/events/__tests__/MeetingsListPanel.test.tsx)                   |
| 24  | grupa domyślna nie udostępnia usuwania                                | [EventGroupsPanel.test.tsx](../src/components/admin/events/__tests__/EventGroupsPanel.test.tsx)                     |
| 25  | odświeżenie kolejności materiałów zachowuje otwarty szkic             | [SponsorMaterialDialog.test.tsx](../src/components/admin/events/__tests__/SponsorMaterialDialog.test.tsx)           |
| 26  | brak wyników wyszukiwania wystawców ma odrębny komunikat              | [EventTrackWorkspace.test.tsx](../src/components/admin/events/__tests__/EventTrackWorkspace.test.tsx)               |
| 27  | edycja istniejącego sponsora nie uruchamia wyszukiwarki CRM           | [EventSponsorDialog.test.tsx](../src/components/admin/events/__tests__/EventSponsorDialog.test.tsx)                 |
| 28  | odświeżenie kolejności sponsorów zachowuje wybraną firmę i migawkę    | [EventSponsorDialog.test.tsx](../src/components/admin/events/__tests__/EventSponsorDialog.test.tsx)                 |
| 29  | zgoda bez treści i bez odnośnika jest zatrzymywana przed zapisem      | [EventTermDialog.test.tsx](../src/components/admin/events/__tests__/EventTermDialog.test.tsx)                       |
| 30  | dwuznakowa podstawa ulgi jest zatrzymywana przed zapisem              | [EventAudienceGrantsPanel.test.tsx](../src/components/admin/events/__tests__/EventAudienceGrantsPanel.test.tsx)     |
| 31  | podstawa ulgi jest walidowana po przycięciu spacji                    | [EventAudienceGrantsPanel.test.tsx](../src/components/admin/events/__tests__/EventAudienceGrantsPanel.test.tsx)     |
| 32  | odświeżenie rangi poziomów zachowuje otwarty szkic                    | [EventSponsorTierDialog.test.tsx](../src/components/admin/events/__tests__/EventSponsorTierDialog.test.tsx)         |
| 33  | brak drugiej sesji nie tworzy pustego wiersza konfliktu               | [AgendaConflictsPanel.test.tsx](../src/components/admin/events/__tests__/AgendaConflictsPanel.test.tsx)             |
| 34  | brak podmiotu konfliktu nie tworzy pustego wiersza                    | [AgendaConflictsPanel.test.tsx](../src/components/admin/events/__tests__/AgendaConflictsPanel.test.tsx)             |
| 35  | odświeżenie tej samej pozycji menu zachowuje otwarty szkic            | [EventPageEntrySheet.test.tsx](../src/components/admin/events/molecules/__tests__/EventPageEntrySheet.test.tsx)     |
| 36  | bramka wyjściowa udostępnia wyjście zgodnie z kierunkiem punktu       | [OnsiteDeskPanel.test.tsx](../src/components/admin/events/organisms/__tests__/OnsiteDeskPanel.test.tsx)             |
| 37  | stanowisko odprawy wysyła powód wydruku ze słownika bazy              | [OnsiteDeskPanel.test.tsx](../src/components/admin/events/organisms/__tests__/OnsiteDeskPanel.test.tsx)             |
| 38  | nieprawidłowa godzina statystyk wyświetla myślnik                     | [OnsiteStatsPanel.test.tsx](../src/components/admin/events/organisms/__tests__/OnsiteStatsPanel.test.tsx)           |
| 39  | analityka nie odpytuje statystyk odprawy co 30 sekund                 | [EventAnalyticsPanel.test.tsx](../src/components/admin/events/organisms/__tests__/EventAnalyticsPanel.test.tsx)     |
| 40  | analityka odróżnia błąd od trwającego odczytu                         | [EventAnalyticsPanel.test.tsx](../src/components/admin/events/organisms/__tests__/EventAnalyticsPanel.test.tsx)     |
| 41  | niezerowy odsetek poniżej 0,5% nie jest wyświetlany jako zero         | [EventAnalyticsPanel.test.tsx](../src/components/admin/events/organisms/__tests__/EventAnalyticsPanel.test.tsx)     |
| 42  | materiał bez adresu nie tworzy pustego odnośnika                      | [SponsorMaterialsPanel.test.tsx](../src/components/admin/events/organisms/__tests__/SponsorMaterialsPanel.test.tsx) |
| 43  | przywrócenie brandingu społeczności jest dostępne przed edycją        | [EventBrandingPanel.test.tsx](../src/components/admin/events/organisms/__tests__/EventBrandingPanel.test.tsx)       |
| 44  | zmiana filtra sponsorów usuwa poprzednie zaznaczenie                  | [SponsorsListPanel.test.tsx](../src/components/admin/events/organisms/__tests__/SponsorsListPanel.test.tsx)         |
| 45  | pusta strona sponsorów automatycznie wraca na poprzednią stronę       | [SponsorsListPanel.test.tsx](../src/components/admin/events/organisms/__tests__/SponsorsListPanel.test.tsx)         |
| 46  | ostrzeżenie o ponownym wydruku obejmuje także ukryte zaznaczone osoby | [OnsiteBadgePrintPanel.test.tsx](../src/components/admin/events/organisms/__tests__/OnsiteBadgePrintPanel.test.tsx) |
| 47  | wydruk partii wysyła powód bulk_preprint                              | [OnsiteBadgePrintPanel.test.tsx](../src/components/admin/events/organisms/__tests__/OnsiteBadgePrintPanel.test.tsx) |
| 48  | etykieta przełącznika aktywności wskazuje konkretny poziom            | [SponsorTiersPanel.test.tsx](../src/components/admin/events/organisms/__tests__/SponsorTiersPanel.test.tsx)         |
