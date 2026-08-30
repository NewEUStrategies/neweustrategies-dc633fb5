# Moduł 22 (Wydarzenia): kasa etapu 4 i pokrycie testami - raport końcowy

**Gałąź:** `claude/event-ticket-payment-integration-yp47rg`
**Pull request:** #307
**Punkt odniesienia:** `145a1ff` (baza scalenia z `main`)
**Data:** 2026-08-30

---

## CZĘŚĆ A - kasa na ścieżce zapisu etapu 4

### A0. Stan zastany sprawdzony, nie przyjęty na słowo

Bramka z migracji `20260828206000` - płatna wejściówka dostaje
`payment_status = 'unpaid'`, nie dostaje kodu QR i zostaje w statusie
`pending` - **nie została poluzowana**. Wszystkie zmiany tej gałęzi idą w
drugą stronę: dokładają warunki, nie zdejmują.

### A1. `registration_id` przez kasę, dowiązanie wyłącznie po nim

**Defekt (P1).** `payments_apply_event_ticket_outcome` szukało zgłoszenia
alternatywą `payment_order_id = order.id OR person_id = <osoba>` z
`ORDER BY created_at DESC LIMIT 1`. Pierwszy człon ustawia dopiero ta sama
funkcja, więc przy **pierwszym** księgowaniu działał wyłącznie drugi:
uczestnik z dwoma zgłoszeniami na to samo wydarzenie dostawał opłacony bilet
przypięty do najnowszego wiersza - niekoniecznie tego, za który zapłacił.

**Naprawa.** Kasa niesie `registration_id` w metadanych zamówienia, walidowany
serwerowo przez nowe `event_registration_payment_context` (własność wołającego
i zgodność wydarzenia). Funkcja księgująca dopasowuje **wyłącznie** po nim.
Niezgodność najemcy albo wydarzenia to jawna odmowa
`{applied: false, reason: 'registration_mismatch'}`, a nie ciche zejście do
zgadywania po osobie. Dopasowanie po osobie zostaje **tylko** dla zamówień bez
tego klucza - kasa społeczności i zamówienia sprzed migracji.

Migracja `20260830090000_event_registration_checkout_binding.sql` niesie
znacznik `-- events-harness: include`, więc treściowy selektor uprzęży
(`scripts/events-harness/run.sh`) ją widzi.

### A2. Ekran potwierdzenia prowadzi do kasy

Przycisk na `RegistrationConfirmation.tsx`. Skopiowany został **przepływ**, nie
komponent - `EventTicketPurchase.tsx` służy za wzór, nie za import. Ładunek
niesie `event_id`, `ticket_type_id` i `registration_id`. Zdanie „nie masz
jeszcze wejściówki" zostaje na miejscu.

Odmowy `ticket_not_available`, `ticket_included_in_plan`, `sold_out`,
`sales_closed` idą przez **istniejący** `admissionQuoteMessageKey` -
drugiego słownika nie ma. Mapper został poszerzony o powody właściwe dla kasy
(`account_required`, `registration_not_payable`, `payments_unavailable`,
`event_finished`, `access_code_invalid`), a nie zdublowany.

Wyodrębnienie zgodne z atomic design:
`atoms/RegistrationAmountDue.tsx`, `molecules/RegistrationPayAction.tsx`,
`molecules/PaidTicketAccountNotice.tsx`. Kwota liczona w jednym miejscu
(`lib/events/amountDue.ts`) dla trzech powierzchni.

### A3. Gość bez konta - rozstrzygnięcie z prawdziwym powodem

`event_register` dopuszczał zapis anonimowy także na wejściówkę **płatną**, a
`createCheckoutOrder` stoi za `requireSupabaseAuth` i księgowanie wymaga
`payment_orders.user_id`. Powstawało zgłoszenie, którego **nikt nie mógł
opłacić**, i żadne późniejsze logowanie tego nie odkręcało.

Płatna wejściówka wymaga teraz konta **przed** powstaniem wiersza (odmowa
`payment_account_required`), a formularz uprzedza o tym już przy wyborze
biletu - prawdziwym powodem, nie ogólnikowym „zaloguj się": do wejściówki
należy paragon i możliwość zwrotu, więc musi mieć właściciela. Zapis anonimowy
na wejściówkę **bezpłatną** zostaje bez żadnej zmiany.

Gość nie zostaje z martwym przyciskiem: dostaje zdanie, dlaczego konto jest
potrzebne, i drogę do jego założenia.

### A4. Droga powrotna do niezapłaconego zgłoszenia

Trzy wejścia zamiast jednego:

1. ekran potwierdzenia,
2. `/events/<slug>/manage` - nowe `event_registration_manage_view` pod
   kluczem `manage_token`,
3. panel „Moje zgłoszenia" - `event_my_registrations` oddaje teraz `event_id`
   i `ticket_type_id`.

Bez tego jedyną drogą był zapis drugi raz, czyli produkowanie dokładnie tych
duplikatów, o które rozbijało się dopasowanie z A1.

### A5. Nadsprzedaż - zarejestrowana, nie naprawiona

Pełne rozstrzygnięcie w osobnym dokumencie:
[`DECYZJA_NADSPRZEDAZ_PULI_WEJSCIOWEK_2026-08-30.md`](./DECYZJA_NADSPRZEDAZ_PULI_WEJSCIOWEK_2026-08-30.md).

W skrócie: pula **typu wejściówki** i pojemność **całego wydarzenia** to dwa
różne limity, a `refundIfOversold` pilnuje tylko drugiego. Przy wyczerpanej
puli i wolnym wydarzeniu pieniądze zostają pobrane, zgłoszenie zostaje
`pending/unpaid` bez kodu QR, zwrotu nie ma i powiadomienia nie ma - bo
`applyTicketOutcome` połyka wyjątek z bazy.

Zarejestrowane dwiema asercjami `pg_temp.assert_known_defect` w
`scripts/events-harness/runtime_test.d/25_payment_binding.sql`. Ten pomocnik
**rzuca, gdy defekt zniknie** (`DEFEKT NAPRAWIONY, USUN WPIS`), więc rejestr
nie zostanie sierotą po naprawie.

Test pgTAP/uprzęży powstał **przed** weryfikacją, zgodnie ze zleceniem, i to on
sprostował wstępną hipotezę: nadsprzedaż **nie** następuje - ostatnia linia
obrony (`event_ticket_types_sold_within_quota`) trzyma. Defektem jest to, co
dzieje się **zamiast** niej.

### Naprawy znalezione pomiarem, nie czytaniem

**1. Naruszenie `event_registrations_cancelled_dated`.** Gałąź `paid`
czyściła `cancelled_at` bezwarunkowo, a status flipuje się tylko z
`draft/pending/waitlist`. Wpłata księgowana na zgłoszeniu odwołanym zostawiała
wiersz `status = 'cancelled'` z pustym `cancelled_at` - czyli wyjątek w całej
funkcji. Wykryte przez uruchomienie uprzęży, nie przez lekturę.

**2. Kod QR na zgłoszeniu odwołanym wpuszczał przy bramce (P1).** Gałąź `paid`
flipowała status wyłącznie z `draft/pending/waitlist`, ale kod QR wydawała
**bezwarunkowo**. To nie była sprzeczność kosmetyczna:
`event_checkin_record` odszukuje zgłoszenie **wyłącznie** po `qr_token_hash`
i **nie sprawdza statusu ani razu**. Uczestnik, który otworzył kasę, odwołał
zapis i dokończył płatność w żywej jeszcze sesji operatora, dostawał wiersz
`cancelled` z **działającym kodem wejścia**. Kod powstaje teraz tylko dla
wiersza, który naprawdę będzie wpuszczany; wpłata jest księgowana jak dotąd,
żeby organizator ją widział i mógł zwrócić.

**3. Dwa zamówienia na jedno zgłoszenie (P1).** Zgłoszenie wiąże się z
zamówieniem dopiero przy księgowaniu, więc kupujący mógł opłacić dwa
zamówienia na ten sam wiersz (dwie zakładki, powrót po zamknięciu nakładki).
Każde `paid` było przyjmowane i nadpisywało `payment_order_id`, a późniejszy
zwrot **dowolnego** z nich odwoływał zapis - mimo że druga wpłata była ważna.
Teraz: `already_settled_by_another_order` i `refund_for_other_order`. Ponowne
doręczenie **tego samego** zamówienia przechodzi, więc idempotencja webhooka
zostaje nietknięta.

### Testy części A

96 przypadków vitest (ekran potwierdzenia, panel uczestnika, strona
samoobsługi, formularz zapisu, wiązanie w kasie, mapper odmów), 40 asercji
runtime w pliku wiązania wpłat uprzęży (1039 w całym module, zielono) i
4 przypadki Playwright. Żaden nie wychodzi do sieci - Stripe jest zaślepiony,
a sesja podstawiana przez przechwycenie **odczytu** `Storage.prototype.getItem`
dla każdego klucza kształtu `sb-<ref>-auth-token`, więc test przechodzi
niezależnie od projektu (sprawdzone na konfiguracji CI).

---

## CZĘŚĆ B - pokrycie

Reguła zlecenia trzymana bez wyjątku: **żaden plik produkcyjny nie został
zmieniony dla testu**. Cały diff produkcyjny gałęzi to część A.

### Portfele pokryte, po kolei

#### Analityka, komunikacja, integracje

Jedyna funkcjonalność modułu z zerem na **całej** powierzchni: cztery pliki,
33 linie, 0 z 9 funkcji. Po zmianie 9 z 9, 100% linii i gałęzi.

Trasy `communications` i `integrations` są **zaślepkami** i tak zostały
opisane: obie renderują wspólny `EventStudioExternalSection`. Rozróżnienie
„pusto" od „nie udało się" stoi tu na trzech asercjach naraz - ekran **mówi**,
ekran **nie pyta bazy o nic** (lista wywołań RPC jest pusta, więc pustka nie
może być skutkiem odmowy odczytu) i ekran **prowadzi gdzie trzeba**.

#### Odprawa na miejscu

Największe pojedyncze zero modułu i jedyna powierzchnia pracująca w dniu
wydarzenia, przy bramce, bez drugiej szansy: `useScanner.ts`,
`useBarcodeScanner.ts`, osiem paneli `Onsite*`, aplikacja skanera i jej trasa -
wszystko z zera. Pokryte jawnie: kod nieważny, kod cudzego wydarzenia, kod już
użyty, utrata połączenia w trakcie odprawy z kolejką offline, oraz **regresja
na bramkę płatności** - zgłoszenie `unpaid` nie ma prawa mieć kodu QR.

#### Regulaminy, grupy i uprawnienia

To jest autoryzacja - kto co widzi i kto może wejść - więc każdy test
uprawnień jest **parą**: rola, która może, i rola, która nie może. Sam happy
path nie jest tu testem autoryzacji. Doszło rozróżnienie odmowy **roli** od
odmowy **danych** (`not_found`): te dwie nie mogą zlać się w jeden klucz.

#### Rama studia

Rama bramkuje role i moduły dla **wszystkich 38 tras studia**, więc jej ciche
przepuszczenie otwiera całą resztę. Każdy test bramki jako para: rola/moduł,
który może, i ten, który nie może.

#### Sponsorzy i partnerzy

`useEventSponsors.ts` z 0% na 100% linii, gałęzi i funkcji. Tabela
**wszystkich 12 mutacji** w czterech wymiarach naraz: ładunek do warstwy sieci,
stan „zapis w toku" na sterowanej obietnicy, odmowa bazy i **dokładne** klucze
unieważnianego cache.

#### Giełda spotkań 1-1

Cztery pliki z 0% na 100%, `useMeetings.ts` z 76,9% na 88,5% gałęzi. Pokryte
wszystkie sześć kolizji, kodami odmów przepisanymi dosłownie z
`60_meetings.sql` - nie zmyślonymi.

#### Branding, strony i menu

`eventPagesApi.ts` z 64,1% na 100% linii, `useAdminEventPages.ts` z 30% na
100%, trzy pliki zerowe na 100% linii.

#### Agenda

`EventTrackWorkspace.tsx` (853 linie, wcześniej zero testów) na 100/100/100,
trzy panele agendy z zera, `useEventSessions.ts` z 26,9% na 100%. Pięć klas
kolizji z kodami wziętymi z `10_sessions.sql` i migracji.

#### Powierzchnia uczestnika

Jedenaście plików z zera na **100 / 100 / 100**, w tym pięć tras. Sprawdzone
przy okazji: trasy niosące poświadczenie w adresie (`manage?token=`,
`invite/$token`) mają `noindex, nofollow` **oraz** `referrer: no-referrer`,
a ekran awarii nie odbija tokenu w treści.

### Progi w `vitest.config.ts`

Zbiorczy pomiar po katalogach i podniesienie progów wchodzą **osobnym
commitem**, razem z liczbami wpisanymi w komentarz nad każdym wpisem. Powód
rozdzielenia jest praktyczny: pomiar to pełny przejazd suity z instrumentacją
(1861 plików testowych), a ten raport powstał wcześniej, żeby nie czekał na
niego opis znalezisk.

Reguła bez zmian i bez wyjątku: progi wolno **wyłącznie podnosić**, do
wartości „zmierzone minus ~4 pp" marginesu na dryf CI.

### Dwie bramki parytetu, które nigdy nie działały

Wzorzec `src/lib/events/__tests__/dbEnumParity.test.ts` dopasowuje
`CHECK (kol IN (...))` i **nie widzi** kolumn nullowalnych zapisanych jako
`CHECK (kol IS NULL OR ...)`. Trafiło to dwa razy, niezależnie:

- `event_pages.module` - `CHECK (module IS NULL OR module IN (...))`,
- `event_groups.color` - `CHECK (color IS NULL OR color ~ '^#[0-9a-fA-F]{6}$')`.

Obie stałe klienckie **nigdy nie były sprawdzone**, mimo że bramka parytetu w
repozytorium istnieje od dawna. Powstały dwa pliki z własnym czytnikiem
`CHECK`, a w drugim dodatkowo asercja, że **stary czytnik oddaje `null`** na
takim ograniczeniu - żeby luka była udokumentowana, a nie tylko obejściona.
Rozjazdów w samych wartościach nie ma.

---

## Rejestr defektów

Wszystkie znalezione defekty zostały **zarejestrowane, nie naprawione** -
zgodnie ze zleceniem, którego jedynym wyjątkiem była część A. Każdy wpis
`it.fails` był najpierw uruchomiony jako zwykły `it`, żeby padał na **asercji
docelowej**, a nie po drodze.

Stan na koniec gałęzi: **35 plików** z wpisami `it.fails` plus dwie asercje
`assert_known_defect` w uprzęży SQL.

Wybrane, najcięższe:

| gdzie                             | co                                                                                                                                                                                            |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| księgowanie wpłat                 | wyczerpana pula wejściówki: pieniądze pobrane, zgłoszenia nie ma, zwrotu nie ma, powiadomienia nie ma                                                                                         |
| `adminTermsErrors`                | komunikat odmowy obiecuje redaktorowi dostęp, a moduł jest admin-only od `20260824090000`                                                                                                     |
| `scanner.tsx`                     | `validateSearch` nie chroni komponentu - router **scala** parametry z wynikiem walidatora zamiast go zastępować; wolontariusz z uciętym linkiem ląduje na odmowie zamiast na wznowionej sesji |
| `RegistrationManagePanel` (trasa) | ta sama klasa: surowe `token=` z adresu dojeżdża do panelu i **zużywa próbę limitu**                                                                                                          |
| `ScannerBadgePanel`               | gubi `device_locked` - ekran odprawy pokazuje błąd, stanowisko druku mówi „Wydruk zapisany"                                                                                                   |
| `useEventSponsors`                | zapis w **jednym** wydarzeniu wietrzy szczegóły przypięć **innego** - klucz szczegółu nie niesie identyfikatora wydarzenia                                                                    |
| `agendaKeys.trackSpeakers`        | klucz nie pasuje do żadnego wzorca `useInvalidateEvent`, więc obsada pasma nie jest **nigdy** unieważniana                                                                                    |
| `EventPageEntrySheet`             | odświeżenie listy w tle **kasuje wpisany szkic** - zależnością efektu jest obiekt `entry`, a powinno być `entry.id`                                                                           |
| `EventBrandingPanel`              | „Przywróć branding społeczności" stoi w pasku zapisu, a pasek renderuje się tylko przy `dirty \|\| saving` - akcja jest niedostępna dokładnie wtedy, gdy jest potrzebna                       |
| `EventMePanel`                    | odmowa `event_my_agenda` daje zdanie o **pustej** agendzie - panel nie ma ani jednej gałęzi `isError`                                                                                         |
| `AgendaConflictsPanel`            | dwa puste wiersze raportu: panel odcina brakujące kolumny przez `row.x === ""`, a baza oddaje `null`                                                                                          |
| `AvailabilityWindowDialog`        | cztery różne powody odrzucenia okna dostają ten sam komunikat o **długości**; odwrócona kolejność godzin czyta się jako problem z długością                                                   |

### Dwa znaleziska, które defektem produkcji **nie** były

1. **Puste przyciski w asercji dostępności `SponsorsListPanel`.** Naruszenie
   `button-name` pochodziło z **atrapy** `AdminPagination` zdefiniowanej w
   samym pliku testowym; prawdziwa molekuła nadaje strzałkom `aria-label`.
   Naprawiona atrapa, **nie** wyłączona reguła axe - nie było czego
   rejestrować.

2. **Odmowa o roli redakcyjnej w podmodule regulaminów.** Asercja twierdziła,
   że napis nie występuje w żadnej z trzech osłon. Okazała się **za szeroka**:
   napis nie zniknął przy migracji `20260824090000`, tylko przeniósł się do
   osłony `staff`. Zawężona do prawdy, z parą dowodzącą, że nie jest pusta.

### Jeden wpis rejestru, który nie dowodził tego, co obiecywał

Wpis `it.fails` o pustej stronie nr 2 przechodził komunikatem
„Expect test to fail": ciało próbowało przeładować listę `fireEvent.change` z
**tą samą** wartością, więc stan się nie zmieniał. Scenariusz przepisany na
faktyczny i zweryfikowany - pada na właściwej asercji. Rejestr defektów, który
sam jest zepsuty, jest gorszy niż jego brak.

---

## Higiena

- **RODO w fixture'ach:** zero adresów e-mail spoza `example.com` /
  `example.org` w plikach tej gałęzi (sprawdzone grepem, nie założone).
- **`any` / `as any` / `unknown`:** bramka ratchetowa `check:unknown-casts`
  stoi na **niezmienionym** baseline (193 rzutowania w 125 plikach). Trzy błędy
  typów w plikach testowych zostały naprawione **przyczynowo** (dopisany
  parametr krotki, otypowana atrapa, `as const` na wartości unii literałów),
  a nie zaślepione rzutowaniem. Czwarty - unia trzech `UseQueryResult<T>` w
  pomocniku - naprawiony **generykiem**.
- **Znak `-` zamiast `—`** w całym nowym tekście.
- **i18n:** każdy nowy napis ma klucz w PL i EN; `check:i18n-parity` zielona
  (44 pliki, 724 przypadki).
- **Migracje jednokierunkowe:** poprawki do już wypchniętych migracji poszły
  **nowymi** plikami, nie edycją starych.

---

## Czego świadomie nie zrobiłem

**Nie naprawiłem żadnego zarejestrowanego defektu.** To była reguła zlecenia i
jest przestrzegana. Każdy wpis niesie opis i przyczynę.

**Nie regenerowałem snapshotu autoryzacji, żeby zgasić czerwień** - z jednym
wyjątkiem, który opisuję wprost, bo różnica jest istotna. Po scaleniu bramka
zgłosiła rozjazd sklasyfikowany jako **PROVENANCE**. Nie przyjąłem tego na
słowo: zregenerowałem do kopii i porównałem. Cały diff to **jedna linia** -
licznik skanu `923 -> 927` migracji. Zero zmian w 43 bramkach rolowych,
23 bramkach flag warstw i 607 politykach. Treść autoryzacyjna jest bajt w bajt
ta sama.

**Nie wykluczyłem żadnego pliku z pomiaru.** W `vitest.config.ts` nie doszedł
ani jeden `exclude`, `all: true` stoi nietknięte.

**Nie ruszałem `package.json` ani `package-lock.json`.** Zero nowych
zależności.

**Nie tknąłem funkcjonalności oznaczonej jako „zostaw w spokoju".**

### Znaleziska poza zakresem, zgłoszone bez naprawy

**Pełny przejazd suity wykonuje prawdziwe żądania sieciowe.** W logu pomiaru
jest 56 wpisów `getaddrinfo ENOTFOUND placeholder.supabase.co`. Sprawdzone,
czyje: **nie plików tej gałęzi** - uruchomione osobno nie emitują ani jednego,
a w pełnym przejeździe pojawiają się **przed** pierwszym wynikiem pliku, więc
nie da się ich przypisać do konkretnego testu. Źródło jest w
`src/integrations/supabase/client.ts`: klient powstaje z `persistSession: true`
i **`autoRefreshToken: true`**, więc gdy którykolwiek test zostawi sesję w
`localStorage` (współdzielonym w obrębie workera happy-dom), klient rusza w tle
po odświeżenie tokenu.

`vitest.setup.ts` neutralizuje z dokładnie tego powodu `navigator.sendBeacon`
(jest tam wprost napisane, dlaczego), ale `fetch` już nie.

Dziś jest to hałas bez skutku, bo host jest zaślepką. U kogoś z prawdziwymi
poświadczeniami w `.env` pełny przejazd suity uderzyłby w **prawdziwy projekt
Supabase**. Nie łatam tego samowolnie: to wspólna infrastruktura testowa całego
repozytorium, poza zakresem modułu Wydarzeń, a globalna zaślepka `fetch`
mogłaby wywrócić testy, które celowo ją podmieniają.

**Duplikat migracji `search_path`.** Gałąź zdalna dołożyła
`20260830102000_event_registration_set_channels_search_path.sql`, robiącą to
samo co wcześniejsza `20260830100000_event_set_channels_extensions_path.sql` z
tej gałęzi. Stan końcowy jest poprawny - późniejsza jest idempotentnym
`ALTER FUNCTION` i biegnie po wcześniejszej. Nie usuwam wypchniętej migracji,
bo migracje są jednokierunkowe; zostaje jako fakt historyczny.

### Uwaga o atrybucji commitów

Praca szła równolegle kilkoma agentami na jednym drzewie roboczym. Commity
zbierane były zamiatająco, więc pliki jednego portfela trafiały czasem do
commitu opisanego nazwą innego. **Treść jest kompletna i nienaruszona**, ale
podział na commity nie odwzorowuje wiernie podziału pracy. Wiarygodnym
podziałem jest ten raport, nie historia gita.
