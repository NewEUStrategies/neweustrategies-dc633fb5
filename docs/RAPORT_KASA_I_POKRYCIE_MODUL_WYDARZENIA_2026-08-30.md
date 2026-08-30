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

Pomiar: pełny przejazd suity z instrumentacją pokrycia - **1 861 plików
testowych, 49 027 zielonych + 238 `expected fail`**, 29 minut.

Wartości mierzone jako instrukcje / gałęzie / funkcje / linie:

| katalog                          | 2026-08-29                | 2026-08-30                    | nowy próg                     |
| -------------------------------- | ------------------------- | ----------------------------- | ----------------------------- |
| `src/lib/events/**`              | 72,9 / 72,4 / 70,2 / 75,2 | **86,3 / 80,9 / 91,2 / 88,9** | 82 / 77 / 87 / 85             |
| `src/components/events/**`       | 67,8 / 59,1 / 66,6 / 68,3 | **86,3 / 79,5 / 82,9 / 87,0** | 82 / 75 / 79 / 83             |
| `.../events/packages/**`         | -                         | **98,8 / 94,8 / 100 / 100**   | 94 / 90 / 96 / 96 (bez zmian) |
| `src/components/admin/events/**` | 44,6 / 40,0 / 45,4 / 44,5 | **91,9 / 89,5 / 90,4 / 92,7** | 87 / 85 / 86 / 88             |
| `.../admin/events/molecules/**`  | 65,1 / 54,6 / 63,5 / 65,6 | **99,1 / 96,6 / 99,6 / 99,7** | 95 / 92 / 95 / 95             |
| `.../admin/events/organisms/**`  | 40,4 / 36,1 / 39,4 / 40,4 | **89,4 / 89,9 / 86,4 / 90,6** | 85 / 85 / 82 / 86             |

Reguła bez wyjątku: progi wolno **wyłącznie podnosić**, do wartości „zmierzone
minus ~4 pp" marginesu na dryf CI. Wzorzec `packages/**` jako jedyny zostaje bez
zmian - zmierzone minus 4 pp wypada dokładnie na obecnym progu.

Sposób liczenia sprawdzony w źródle vitesta, nie założony
(`node_modules/vitest/dist/chunks/coverage.DM_a_rWm.js:816`): każdy wzorzec jest
liczony po **wszystkich** pasujących plikach, bez odejmowania wzorców bardziej
szczegółowych. `src/components/events/**` obejmuje więc także `packages/**`.

**Co zostało nazwane w komentarzach, a nie uśrednione.** Poprzedni wpis
wskazywał z nazwiska `EventTrackWorkspace` (853 linie) jako plik bez testów -
dziś ma 92 przypadki i 100% w każdej metryce. W jego miejsce komentarz wymienia
sześć plików, które nadal ciągną średnią organizmów w dół: `EventPackagesPanel`
(59 linii), `EventRegistrationSettingsPanel` (47), `RegistrationFieldsPanel`
(33), `EventProgramPanel` (3) - wszystkie na zerze - oraz `EventPagesMenuPanel`
(71,3% linii) i `EventTypeDialog` (37,5%). Próg mierzy średnią katalogu, więc
te sześć plików jest w niej rozcieńczone; wpis mówi to wprost, zamiast pozwolić
liczbie 89,4% udawać, że powierzchnia jest przetestowana w całości.

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

**Dwa testy suity odpytują hostowaną bazę - i ich osłona nie odróżnia
zaślepki od braku poświadczeń.** Pełny przejazd kończy się dwoma czerwonymi
plikami i 49 czerwonymi przypadkami:
`src/__tests__/db-schema-invariant.test.ts` (44 z 45) i
`src/__tests__/lang-parity.test.ts` (5 z 5). Oba **celowo** wołają anon Data API
hostowanego projektu - piszą to wprost w nagłówku („Runs against the hosted
database with the anon key"). To one dają 56 wpisów
`getaddrinfo ENOTFOUND placeholder.supabase.co` w logu.

Defekt nie leży w samym zamyśle, tylko w osłonie:

```ts
const shouldRun = Boolean(SUPABASE_URL && SUPABASE_KEY);
const d = shouldRun ? describe : describe.skip;
```

`Boolean(url && key)` przechodzi dla **zaślepki**. Deweloper z `.env`
ustawionym na `placeholder.supabase.co` - czyli z konfiguracją, którą repozytorium
samo daje - nie dostaje „pominięto, brak poświadczeń", tylko **49 czerwonych
testów wyglądających na zepsute**. Osłona powinna odrzucać host zaślepkowy, a nie
sprawdzać samą obecność zmiennej.

Żadnego z tych plików nie ruszam: są sprzed tej gałęzi, w CI z prawdziwymi
poświadczeniami przechodzą, a zmiana warunku ich uruchamiania to decyzja o
zakresie bramki CI, nie o module Wydarzeń. Liczby pokrycia wydarzeń są tym
nietknięte - żaden z tych dwóch plików nie importuje niczego z modułu.

**Regresja progu poza modułem Wydarzeń, naprawiona przy okazji.**
`src/components/admin/billing/WebhookHealthPanel.tsx` wszedł na `main` **bez
testu** (25 linii, 0 z 4 funkcji) i sam jeden zbił próg
`src/components/admin/billing/**` poniżej ratchetu: linie 88,3% wobec progu 97%.
Pozostałe sześć plików tego katalogu stoi na 94-100%. Bramka `verify` była przez
to czerwona na **każdym** PR-ze wychodzącym z tego `main`, nie tylko na tym.

Obniżyć progu nie wolno, więc jedyną drogą do zieleni było pokrycie tego pliku.
Powstał `WebhookHealthPanel.test.tsx` (35 przypadków, zero zmian produkcyjnych),
po którym katalog stoi na 97,4 / 88,5 / 98,1 / 98,4 - wszystkie cztery progi
spełnione. Test nie jest wypełniaczem: sprawdza progi alarmu **na granicy**
(dokładnie 5% ma być jeszcze „obserwuj", nie „napraw teraz"), rozróżnienie
`avgDurationMs === null` („-") od zera („0 ms"), blokadę przycisku ponownej
wysyłki dla wartości niebędącej UUID-em wraz z obcięciem spacji, oraz to, że
pusta lista awarii **mówi**, że awarii nie ma.

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
