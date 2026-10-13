# Naprawy ustaleń audytu operacyjnego Wydarzeń (OPS-01..OPS-15), 2026-10-12

Dokument opisuje zmiany kodu i migracji na gałęzi `claude/events-ops-audit-fixes`
oraz ich weryfikację na jednorazowej bazie uprzęży. Nie potwierdza zastosowania
migracji na produkcji ani działania usług zewnętrznych (Google Wallet, Apple,
Cloudflare).

## Zakres napraw

- **OPS-01 (zgoda partnerska per zgłoszenie).** Zgoda na przekazanie danych
  partnerom jest stemplem ZGŁOSZENIA (`event_registrations.consent_partner_sharing_at`
  i `consent_partner_withdrawn_at`), a jedynym źródłem prawdy jest
  `_event_partner_consent_at(tenant, event, person)`: najnowsze zgłoszenie osoby
  na to wydarzenie, zgoda późniejsza niż każde wycofanie (w zgłoszeniu i globalne).
  `event_register` stempluje zgodę tylko przy jawnym zaznaczeniu i nie kasuje
  wycofania, chyba że w tym samym zapisie zaznaczono zgodę marketingową (wtedy
  świeży stempel marketingowy, a wcześniejsze zgody partnerskie zostają wycofane
  na poziomie zgłoszeń). Wszystkie czytniki (skan leadu, lista na stoisku, link
  sponsora, eksport, raporty, lista zgłoszeń) przepięte na funkcję. Backfill jest
  domknięty na błąd: zgoda zostaje tylko tam, gdzie da się ją udowodnić. Wycofanie
  jest tak samo proste jak udzielenie: przycisk w samoobsłudze zgłoszenia
  (`event_registration_partner_consent_withdraw`) i w panelu organizatora (z wpisem
  do `audit_log`).
- **OPS-03 (eksport leadów).** Bez zgody eksport i `leadExportCells` zerują imię,
  nazwisko, firmę, stanowisko, e-mail i telefon. Notatka stoiska zostaje we
  wszystkich kanałach (to tekst sponsora z jego urządzenia), z wyjątkiem listy
  odrzuconych w skanerze (patrz OPS-06).
- **OPS-04 (druk identyfikatora).** Identyfikator ma własne poświadczenie
  (`badge_token_hash`); druk nie rusza kodu biletu z maila i portfeli. Każdy
  zastąpiony skrót trafia do `event_superseded_codes` (wyzwalacz), a skan zwraca
  rozpoznawalny wynik `code_superseded`, liczony poza blokadą urządzenia.
  Unieważnienie zgubionego kodu to jawna akcja `admin_event_registration_code_invalidate`.
  Panel ostrzega przed ponownym drukiem. Anulowanie zgłoszenia unieważnia też
  identyfikator. Wyjątek „kod ważny w chwili skanu” dla kolejki offline wymaga
  potwierdzonego czasu (ważny znacznik kolejki tego urządzenia i dolne granice).
- **OPS-05 (kolejka offline).** Awarie przejściowe nie zużywają prób (wycofanie
  z rozrzutem, sufit 60 s, bez limitu); start, `online` i powrót karty wznawiają
  wysyłkę; panel ma „Ponów” i „Ponów wszystkie”, usunięcie wymaga potwierdzenia.
  Skan na żywo z blokadą urządzenia dostaje decyzję z listy offline.
- **OPS-06 (dane w przeglądarce).** Kolejka trzyma kod, notatkę i znacznik
  kolejki wyłącznie w bloku AES-GCM (klucz HKDF z tokenu urządzenia). Lista
  odrzuconych i eksport niosą skrót i prefiks, bez kodu i bez notatki. Lista osób
  wygasa z poświadczeniem. Odłączenie pyta o potwierdzenie i czyści wszystko;
  spóźnione odpowiedzi po odłączeniu niczego już nie zapisują (pokolenie parowania).
- **OPS-07 (token w adresie).** Parowanie przez `/scanner#t=…`; trasa nie
  przyjmuje `?t=`, a stary link nie paruje.
- **OPS-08 (ponowne wejście).** Punkt ma `reentry_policy` (`allow`/`deny`). Przy
  `deny` drugie wejście bez wyjścia daje `denied_already_inside`; stan „w środku”
  jest per punkt, zeruje go wyjście w tym punkcie i północ w strefie wydarzenia;
  ręczna odprawa w panelu jest audytowanym obejściem. Decyzja nie zależy od
  kolejności synchronizacji (czas ostatniego wchłoniętego powtórzenia). Klon
  wydarzenia kopiuje politykę. Skaner pokazuje osobny ton „ponowne wejście”.
- **OPS-09 (ekspozycja sponsora).** Sesja wydawana przez serwer (HMAC), limit
  w bazie po skrócie IP i wydarzeniu, najwyżej 50 unikalnych sesji na źródło
  i dzień; nadmiar i sesje niepodpisane trafiają do koszyka IP-dzień i do tabeli
  anomalii, którą panel raportu pokazuje jako ostrzeżenie.
- **OPS-10 (spotkania a sponsor).** `sponsor_id` z ładunku uczestnika jest
  przyjmowany tylko, gdy wołający albo zaproszony jest kontaktem sponsora
  wskazanym przez organizatora i zweryfikowanym przez potwierdzony e-mail konta.
  Pole firmy edytowane przez uczestnika nie jest dowodem powiązania.
- **OPS-11 (klucze obce).** Złożone klucze `ON DELETE SET NULL` mają listę kolumn;
  usunięcie sponsora najpierw unieważnia urządzenia i zdejmuje zakres leadów.
  Ta sama klasa naprawiona dla aktorów odpraw/druków/skanów przy usuwaniu konta
  oraz dla `events.discussion_club_id`.
- **OPS-12 (okno 72 h).** Po terminie poświadczenia kolejka jest przyjmowana tylko
  ze znacznikiem kolejki podpisanym przez serwer (HMAC per urządzenie, horyzont
  24 h, tolerancja 15 min). Urządzenia, które nigdy nie zgłosiły
  `client_caps: ["queue_marker"]`, zachowują regułę przejściową do aktualizacji PWA.
  Nieznane kody z kolejki mają własny limit (100/60 min) i osobną blokadę, która
  nie zatrzymuje skanowania na żywo. `expires_at` ≤ koniec wydarzenia + 7 dni.
- **OPS-13 (osobny origin).** Opcjonalne `VITE_SCANNER_ORIGIN`, przeniesienie
  urządzenia i sprzątanie tokenu z originu portalu domknięte na błąd. Kroki
  infrastruktury: `docs/OPS_SKANER_OSOBNY_ORIGIN_2026-10-12.md`.
- **OPS-14 (portfele).** Kontrola zgodności klucza z certyfikatem Pass Type ID
  i terminów (ostrzeżenie 30 dni wcześniej), pamięć klucza i klasy, pominięcie
  zbędnych zapisów obiektu. Obiekty Google przechodzą w INACTIVE przy anulowaniu,
  odrzuceniu, zwrocie, zmianie kodu, odwołaniu wydarzenia i usunięciu (kolejka
  z nagrobkami), przez zadanie harmonogramu z ograniczonymi ponowieniami; awaria
  tokenu nie zużywa prób. Apple bez usługi sieciowej przepustek nie pozwala
  wycofać przepustki z telefonu - bramka odrzuca ją po skrócie.
- **OPS-15 (strefa czasowa).** Okna dostępności spotkań, ustawienia spotkań,
  bilety, sesje, kody, ważność poświadczeń skanera i formularz tworzenia
  wydarzenia czytają czas w strefie wydarzenia (`timezone.ts`, `eventLocalInput.ts`);
  atom `DateInput` traktuje wartość jako napis zegara ściennego. Domknięcie X6:
  „Informacje ogólne", ustawienia zapisów, okno naboru, przyjęcie zgłoszenia
  z planem sesji, klon edycji i harmonogram reklam strony głównej też edytują
  zegar strefy wydarzenia (wspólna molekuła `AdminFormDateTimeRow` na `DateInput`,
  podpowiedź strefy pod polem, nietknięty zapis oddaje chwilę z bazy). Zmiana
  strefy na „Informacjach ogólnych" zostawia chwile i przelicza godziny w polach
  (baza nie przesuwa sesji, biletów ani okien przy zmianie strefy); w klonie -
  zostawia godzinę, bo klon przesuwa cały program o różnicę zegarów lokalnych.

## Kolejność wdrożenia

1. Migracje `20261013110000` … `20261013112700` (28 plików, każdy < 45 KiB),
   w kolejności nazw. Potem kod aplikacji. Kod portfeli działa także przed
   migracjami `2026101213*`/`2026101217*` (tryb zgodności), ale kolejka
   dezaktywacji rusza dopiero po nich.
2. Po wdrożeniu: `check:db-contract` i `check:migration-ledger` z poświadczeniami
   środowiska.
3. `VITE_SCANNER_ORIGIN` ustawić na końcu, po krokach DNS i ograniczeniu hosta.
4. Organizator powinien unieważnić poświadczenia skanerów rozesłane kiedyś linkiem
   `?t=` (token przeszedł przez logi).
5. Po awarii poświadczeń Google: `SELECT public._event_wallet_pass_revocations_requeue();`
   przywraca porzucone dezaktywacje.

## Weryfikacja

- `bash scripts/events-harness/run.sh`: 209 migracji, 4390 asercji, wszystkie
  zielone (stan wyjściowy: 181 migracji, 3889 asercji). Nowe pliki asercji:
  33, 34, 54, 55 (dwa), 56, 57, 61, 78.
- `tsgo --noEmit`, bramki `check:sql-*`, `check:ts-sql-contract`,
  `check:types-freshness` i pozostałe statyczne: zielone. `check:rpc-contract`
  odrzuca wyłącznie `event_speaker_detail` - tak samo na `main` przed zmianą.
- Pełny `vitest run` w czterech częściach (stan przed domknięciem X6): 139
  niezaliczonych testów, każdy obecny co do nazwy na `main` przed zmianą (tam 140;
  test okna kodu w `EventCodesPanel` przechodzi po naprawie OPS-15). Po X6 testy
  obszaru Wydarzeń, atomów UI i molekuł admina: 12 603 zaliczone, 6 niezaliczonych -
  wszystkie z listy bazowej `main`. Żaden nowy test nie zawodzi.
- Przegląd adwersaryjny w dwóch rundach (S1+S2, potem całość) z niezależną
  weryfikacją każdego zarzutu; potwierdzone usterki naprawiono z testem, który
  bez poprawki zawodzi.
- Nie uruchomiono: Playwright (brak przeglądarek w środowisku), bramek wymagających
  buildu (`check:entry-purity`, `check:bundle`), testów przeciw Google/Apple.

## Ryzyka rezydualne i dalsze kroki

- Reguła przejściowa OPS-12 dla urządzeń ze starą PWA zachowuje dotychczasowe
  ryzyko do czasu aktualizacji; panel urządzeń pokazuje, które telefony jej
  jeszcze nie zgłosiły.
- Backfill zgody jest domknięty na błąd: sponsorzy zobaczą mniej leadów ze zgodą
  dla zgłoszeń sprzed zmiany.
- Zmiana strefy istniejącego wydarzenia nie przesuwa jego programu: sesje, bilety,
  kody i okna zostają w swoich chwilach (panel to mówi pod droplistą strefy).
  Wydarzenie założone w złej strefie trzeba przestawić ręcznie; przesunięcie
  całej osi czasu po stronie bazy wymagałoby osobnej migracji.
- `DateTimePicker` (strefa przeglądarki) został wyłącznie w globalnych miejscach
  reklamowych (`PlacementsPanel`), które nie należą do wydarzenia.
- `event_register` wiąże konto z osobą po wpisanym e-mailu bez wymogu
  potwierdzonego adresu (stan sprzed zmiany); zaproszenia z pakietu wymagają już
  potwierdzonego e-maila.
- Rejestr `docs/audyt-ed13/rejestr-defektow.json` (R319, dezaktywacja obiektów
  Google) jest generowany narzędziem audytu i nie był edytowany ręcznie; część
  kaskadowa jest zamknięta, ścieżka art. 17/15 RODO wobec Google pozostaje otwarta.
