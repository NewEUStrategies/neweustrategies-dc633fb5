# Domknięcie audytu wydarzeń, 2026-09-29

Zmiany po PR #416 dotyczą pozostałych testów i spójności procesu publikacji oraz udziału. Ten dokument opisuje kod i weryfikację na środowisku testowym. Nie potwierdza zastosowania migracji ani wykonania transakcji na produkcji.

## Zakres napraw

- Atrapy zapisu formularza i stron używają `admin_event_general_save_v2`. Wspólny czytnik SQL dostarcza końcowe definicje do bramki RPC oraz testów map błędów. Migracje Drizzle 0105–0111 mają odpowiedniki w kanonicznej ścieżce Supabase.
- Karta prelegenta zachowuje zarówno oznaczenie roli, jak i ścieżki. Test osoby bez konta dopuszcza odczyt logotypów, nadal zabrania odczytu publicznego katalogu użytkowników i bezpośrednich tabel.
- Publikacja ma backendową listę blokerów: tytuły, harmonogram, prawidłowa strefa, adres wydarzenia stacjonarnego/hybrydowego, okładka i konflikty agendy. `admin_event_set_status` odmawia publikacji w tej samej transakcji. Zapisy agendy blokują wiersz rodzica, aby współbieżna edycja nie ominęła sprawdzenia.
- Panel gotowości rozróżnia ładowanie, błąd i wynik. Brak danych nie oznacza zera konfliktów. Obie ścieżki publikacji w pasku studia wymagają poprawnego odczytu bez blokerów; dostępne jest ponowienie.
- Zamknięcie pojedynczego gościa po wysyłce biletu zapisuje zawiadomienie w istniejącej kolejce. Zachowany hash kodu pozwala przypisać odmowę skanu do anulowanego zgłoszenia. Dostęp zależy od aktualnego statusu, nie samego kodu.
- Awans opłaconej osoby z kolejki odtwarza RSVP `going`, potrzebne starszej powierzchni dostępu online.
- Odrzucenie opłaconego zgłoszenia zapisuje zlecenie zwrotu razem z decyzją. Istniejący scheduler obsługuje zlecenia z dzierżawą, ponowieniami i stałym kluczem idempotencji zamówienia. Webhook potwierdza zwrot i zamknięcie udziału. Ponowne przyjęcie podczas rozpoczętego zwrotu jest blokowane.
- Wspólna płatność za grupę z nadal aktywnymi uczestnikami trafia do `needs_review`. Nie zwracamy całej płatności z powodu odrzucenia jednej osoby ani nie wyliczamy historycznej ceny miejsca z aktualnego cennika. Panel zgłoszeń pokazuje ostatnie 100 zleceń, ich stany i potrzebę interwencji; odczyt jest ograniczony do najemcy i wydarzenia.

## Kolejność wdrożenia

Najpierw zastosować migracje do `20260929113000` (lub odpowiedniki Drizzle do 0113), następnie kod aplikacji. Wybrać jedną ścieżkę wdrożenia migracji, zgodnie z istniejącym procesem środowiska. Obie ścieżki opisują tę samą zmianę.

Po wdrożeniu wykonać istniejące `check:db-contract` i `check:migration-ledger` z poświadczeniami właściwego środowiska. Zmiana kodu nie jest dowodem ich przejścia na produkcji. Błąd odczytu gotowości bez nowej migracji blokuje publikację i jest widoczny w panelu.

## Test płatności bez atrap

`bun run test:events:integration` uruchamia osobny Playwright z `playwright.integration.config.ts`. Zwykłe E2E z atrapami pozostają bez zmian. Nowy test odmawia uruchomienia bez jawnej konfiguracji; nie używa `skip` do udawania sukcesu.

Wymaga dedykowanego wdrożenia HTTPS, osobnego najemcy testowego i nowego wydarzenia o slugu `integration-*`. Wydarzenie powinno mieć jedną aktywną płatną wejściówkę z natychmiastową akceptacją, wolne miejsca, standardowy formularz PL oraz działającą odprawę. Konfiguracja płatności ma wskazywać sandbox, a webhook sandbox musi już docierać do aplikacji. Dane wystawcy faktur muszą być kompletne; automatyczne faktury operatora powinny być wyłączone, aby test mógł wystawić fakturę modułu bez podwójnego dokumentowania sprzedaży.

Zmienne środowiska:

- `EVENT_INTEGRATION_ACK=dedicated-sandbox`, `EVENT_INTEGRATION_BASE_URL`.
- `EVENT_INTEGRATION_SUPABASE_URL`, `EVENT_INTEGRATION_ANON_KEY`, `EVENT_INTEGRATION_SERVICE_ROLE_KEY`.
- `EVENT_INTEGRATION_TENANT_ID`, `EVENT_INTEGRATION_EVENT_SLUG`.
- `EVENT_INTEGRATION_USER_EMAIL`, `EVENT_INTEGRATION_USER_PASSWORD`: konto testowe bez wcześniejszego zgłoszenia na to wydarzenie.
- `EVENT_INTEGRATION_ADMIN_EMAIL`, `EVENT_INTEGRATION_ADMIN_PASSWORD`: administrator tego najemcy.
- `EVENT_INTEGRATION_SCANNER_TOKEN`, `EVENT_INTEGRATION_CHECKPOINT_ID`: aktywne urządzenie i punkt wejścia tego wydarzenia.
- `STRIPE_SANDBOX_API_KEY`, `LOVABLE_API_KEY`, `PAYMENTS_SANDBOX_WEBHOOK_SECRET`: konfiguracja istniejącej bramki konektorów, zgodna z wdrożeniem.

Test przechodzi przez formularz, prawdziwy Checkout z kartą testową, dwukrotnie ponawia rzeczywiste zdarzenie Stripe, sprawdza zgłoszenie i zamówienie, ponownie wydaje kod biletu, wystawia fakturę przez RPC administratora, zapisuje odprawę, zleca zwrot i sprawdza odmowę ponownego wejścia. Historia finansowa pozostaje do wglądu; kompensacja dotyczy wyłącznie płatności utworzonej w tym przebiegu. Zrzuty, filmy i trace są wyłączone, ponieważ przebieg dotyka tokenów i danych płatności.

W tym środowisku nie udostępniono powyższych poświadczeń. Test nie został wykonany przeciwko Stripe. Nie potwierdza też doręczenia wiadomości do skrzynki odbiorczej.

## Pomiary i granice weryfikacji

`scripts/events-harness/performance.sql` przygotowuje 50 000 syntetycznych zgłoszeń i mierzy rzeczywiste RPC pierwszej/ostatniej strony, wyszukiwania oraz paczki eksportu. Uruchamiać na jednorazowej bazie uprzęży, w tej samej sesji co jej funkcje pomocnicze. Dane są wycofywane. Czasy i plany zależą od sprzętu oraz danych, więc nie wprowadzono arbitralnego progu zaliczenia.

`bun run measure:events:scanner` mierzy 10 000 operacji kolejki skanów z kontrolą przepełnienia. To pomiar CPU logiki kolejki; nie obejmuje kamery, IndexedDB, sieci ani ergonomii telefonu.

Lokalny replay PostgreSQL/WASM przechodzi wszystkie pliki uprzęży, które nie wymagają `dblink`, w tym nowe testy publikacji i cyklu zwrotu. Pliki współbieżności `20_registration`, `66_seating_lock_order` oraz `75_paid_no_seat_waitlist` wymagają zwykłego PostgreSQL w CI. Pełny lokalny TypeScript przekracza dostępną stertę 6 GB; nie oznacza to przejścia bramki typów.

KSeF pozostaje rejestrem ręcznym. Automatyczna wysyłka, odbiór statusów i ponowienia to oddzielne rozszerzenie wymagające kontraktu integracji, poświadczeń oraz środowiska testowego. Ten zestaw zmian go nie uruchamia. Przegląd fizycznych urządzeń i pomiar pierwszego ładowania rzeczywistego wdrożenia również pozostają do wykonania na środowisku testowym.
