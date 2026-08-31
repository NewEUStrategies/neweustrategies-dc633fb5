# Monetyzacja: domknięcie modułów 14 i 13 - raport końcowy

Data: 2026-08-31. Gałąź: `claude/monetyzacja-modules-14-13-difk0l`. PR #311.
Punkt wyjścia: `docs/AUDYT_POKRYCIA_TESTAMI_MODULY_FUNKCJE_2026-08-18.md` (wydanie 7).

---

## 1. Pomiar przed i po

Oba pomiary wykonane pełną suitą na tym samym zbiorze plików, z `all: true`,
bez wykluczeń.

### Całe `src/`

|            |  przed |     po |
| ---------- | -----: | -----: |
| instrukcje | 76,55% | 78,97% |
| gałęzie    | 71,64% | 74,14% |
| funkcje    | 75,05% | 76,92% |
| linie      | 77,68% | 80,12% |

### Per obszar (linie / gałęzie / funkcje)

| obszar                                 | przed                 | po                        | plików na 0% |
| -------------------------------------- | --------------------- | ------------------------- | -----------: |
| M14 `lib/ads`                          | 42,09 / 35,23 / 51,50 | **85,52 / 84,09 / 77,82** |    1 → **0** |
| M14 `components/ads`                   | 33,56 / 26,32 / 37,74 | **94,77 / 84,62 / 85,84** |    1 → **0** |
| M14 `lib/gifting`                      | 45,73 / 37,78 / 36,41 | **99,39 / 100 / 95,85**   |    1 → **0** |
| M14 `components/gifting`               | 82,35 / 73,68 / 87,39 | **100 / 94,74 / 94,12**   |        0 → 0 |
| M14 `components/donations` (publiczne) | 85,71 / 71,43 / 72,02 | 85,71 / 71,43 / 72,02     |        0 → 0 |
| M14 panele admina (27 plików)          | 43,48 / 42,86 / 50,00 | **95,38 / 91,67 / 90,45** |        0 → 0 |
| M14 trasy panelu (8 plików)            | 0 / 0 / 0             | **100 / 100 / 100**       |    8 → **0** |
| M14 `api/public/ad-event.ts`           | 0 / 0 / 0             | **100 / 100 / 96,43**     |    1 → **0** |
| M14 `useValidateCoupon`                | 0 / 0 / 0             | **100 / 100 / 90**        |    1 → **0** |
| M13 `lib/billing` (89 plików)          | 57,86 / 70,43 / 52,50 | **97,40 / 99,13 / 92,51** |   24 → **0** |
| M13 endpointy publiczne                | 0 / 0 / 0             | **97,62 / 100 / 100**     |    2 → **0** |
| M13 trasy                              | 0 / 0 / 0             | **100 / 100 / 96,56**     |    5 → **0** |

**Zero plików na zerowym pokryciu w obu modułach** (przed: 45).

### Czego NIE osiągnięto

`src/components/donations/**` (publiczne komponenty darowizn, nie panel) stoi
na 71,43% funkcji przy celu 80%. Ten obszar **nie był w zakresie żadnego
zlecenia cząstkowego** - zlecenie wskazywało panel administratora
(`components/admin/donations`), który wyszedł na 100%. Publiczne komponenty
zostały nietknięte i mają dokładnie to samo pokrycie co przed pracą.
To jedyny cel liczbowy, który nie został spełniony.

---

## 2. Ekstrakcja (część A1)

Pięć monolitycznych tras rozłożonych na `atoms / molecules / organisms`,
osobnymi commitami, bez zmiany zachowania. Ciała funkcji wycięte znak w znak;
zmieniają się wyłącznie deklaracje eksportu i bloki importów.

| trasa                         | linii przed | po ekstrakcji  | plików |
| ----------------------------- | ----------: | -------------- | -----: |
| `admin.ads.tsx`               |         807 | cienki wrapper |      8 |
| `admin.gifting.tsx`           |         755 | cienki wrapper |     10 |
| `admin.coupons.index.tsx`     |         579 | cienki wrapper |      4 |
| `admin.coupons.campaigns.tsx` |         551 | cienki wrapper |      2 |
| `admin.donations.tsx`         |         314 | cienki wrapper |      3 |

**Duplikat był potrójny, nie podwójny.** Zlecenie wskazywało dwie kopie
komponentu `Stat` (`redemptions`, `analytics`). Trzecia stała w
`admin.coupons.index.tsx` pod nazwą `StatCard` - identyczna znak w znak.
Wyszedł jeden atom używany we wszystkich trzech panelach.

**`admin.donations.tsx` był jedynym szwem, który trzeba było zaprojektować.**
Oba wyniesione panele są PREZENTACYJNE, a wszystkie zapytania i mutacja
synchronizacji zostają w organizmie strony - bo `sync.onSuccess` woła
`refetch()` na KONKRETNYCH instancjach zapytań. Własne `useQuery` w każdym
panelu wymusiłoby przepisanie tego na inwalidację po kluczu cache, czyli inne
zachowanie.

---

## 3. Defekty

**80 zarejestrowanych jako `it.fails`, 78 naprawionych, 2 zostawione.**
Moduł 14 miał przed tą pracą **zero** takich wpisów przy 1 043 niepokrytych
liniach.

Każdy wpis był najpierw uruchomiony jako zwykły `it` i potwierdzony jako
padający na asercji DOCELOWEJ, a nie po drodze na błędzie konfiguracji.

### Bezpieczeństwo

**Open redirect na powierzchni płatności** (`returnUrl.server.ts`, 3 warianty).
Adres, pod który operator odsyła klienta po transakcji, sklejał się z SUROWEGO
nagłówka żądania. Ścieżka była sanityzowana wzorowo, origin - wcale.
Trzeci wariant był groźniejszy od dwóch pierwszych: host o złym kształcie
wywracał `new URL` wyjątkiem, który gasił `createStripePortalSession` - czyli
jednym nagłówkiem blokowało się anulowanie subskrypcji, zmianę karty i faktury.
Naprawa: lista dozwolonych hostów z podmianą na kanoniczny (nie odrzuceniem -
odrzucenie byłoby tą samą odmową usługi). Świadomie NIE użyto istniejącego
`isPreviewHost`, bo dopuszcza `*.pages.dev` i `*.workers.dev`, czyli hosty
możliwe do zarejestrowania przez atakującego.

**Izolacja najemcy** - `audit.server.ts` czytał zamówienia WSZYSTKICH najemców
(jedynym zakresem było środowisko); `customerSync.server.ts` zapisywał profil
przez wszystkie tenanty użytkownika; import darowizn wciągał sesje bez dowodu
przynależności.

**Izolacja środowiska** - `revokeOrder` nie filtrował po środowisku, choć
`revokeSubscription` tuż obok filtrował: zdarzenie z piaskownicy mogło oznaczyć
realne zamówienie jako zwrócone. `loadPaymentOrders` był jedyną funkcją
rozliczeń bez pola `environment`, a `limit` działał PRZED filtrem.

**Idempotencja zwrotów** - `stripe.refunds.create` bez klucza idempotencji;
podwójny zwrot niewykrywalny (`update().neq()` bez `.select("id")`).

### Poprawność danych

**Wzorzec numeru transakcji odrzucał każdy prawdziwy `cs_...`.** Prefiks `cs_`
był we wzorcu wymieniony, ale nieosiągalny (identyfikatory mają postać
`cs_test_`/`cs_live_`, z podkreślnikiem), a `invoice.server.ts` miał dla niego
MARTWĄ gałąź. Klient wklejający numer z potwierdzenia dostawał „nieprawidłowy
numer transakcji" przy numerze poprawnym.

**Przecinek dziesiętny w kwotach darowizn nie działał.** Pole rozbija wejście
po przecinku, a `part.replace(",", ".")` wykonywany PO rozbiciu jest kodem
martwym: `12,50` dawało DWIE kwoty - 12 zł i 50 zł. Podpowiedź pod polem sama
pokazuje przecinek jako separator listy.

**`type in EVENT_PILL_CLS`** - operator `in` przeszukuje łańcuch prototypów,
więc typ zdarzenia `constructor` albo `toString` przechodził strażnik znanego
typu, a FUNKCJA lądowała w atrybucie `class`. Zamienione na `Object.hasOwn`.

**Panel darowizn zapisywał konfigurację, którą publiczna strona odrzuca.**
Wyczyszczenie „kwoty minimalnej" zapisywało `0` przy wymaganym `>= 500`, a
`parseDonationsConfig` przy nieudanej walidacji zwraca CAŁE `DONATIONS_DEFAULTS`

- więc jedno puste pole cofało do domyślnych także tryb, walutę, cel i nagłówki.

### Raportowanie kłamiące

Klasa „awaria wygląda jak pusty wynik": `admin.coupons.redemptions` i
`analytics` nie miały gałęzi `isError`, więc odmowa RLS dawała ten sam ekran co
poprawny pusty zakres - fałszywy fakt księgowy, który eksport CSV utrwalał w
arkuszu. Naprawione wspólnym komunikatem `role="alert"`, kreskami zamiast zer
w kaflach i **zablokowaniem eksportu w stanie błędu**.

Dalej: przebieg przypomnień raportował maile jako wysłane przy padniętej
poczcie; błąd odczytu profilu był nieodróżnialny od braku konta; `CampaignsPage`
dawał cichy sukces zapisu wysyłki, więc kolejne wejście pozwalało wysłać maila
DRUGI RAZ do tych samych odbiorców; kafle sumowały różne waluty w jedną liczbę
(80 PLN + 40 EUR = „120.00") i żadnej nie podawały.

### Zostawione świadomie (2)

1. **Zerowy UUID w `validate_b2b_coupon`.** Zlecenie prosiło o test utrwalający,
   że „RPC traktuje zerowy UUID jak NULL". RPC tego NIE robi: bramkuje plan
   warunkiem `_plan_id IS NOT NULL AND NOT (_plan_id = ANY(plan_ids))`, a zerowy
   UUID jest wartością nie-NULL i nigdy nie należy do `plan_ids` - więc kupon
   ograniczony do planów dostaje `plan_not_eligible` DOKŁADNIE w sytuacji, dla
   której obejście powstało. Naprawa wymaga migracji (`NULLIF`), której zakres
   pracy nie obejmował. Test czyta prawdziwą definicję z migracji, więc zapali
   się sam po poprawce.
2. **`<dl>` bez `<dt>`/`<dd>` w `membership-join`.** Naprawa leży w
   `JoinStat.tsx` i `JoinHero.tsx`, poza zakresem plików tego zlecenia.

### Zgłoszone, nienaprawione (brak rejestracji testem)

- `PlacementsPanel.save()` ma ten sam defekt ładunku co naprawiony `SlotsPanel`
- `aria-label="kampania"` - polski literał poza opisem defektu
- `fields.tsx` - etykiety bez `htmlFor`; źródło wspólne dla WSZYSTKICH paneli
  ustawień w aplikacji

### Niedokończone, zapisane w kodzie

`revokeDonation` nadal nie filtruje środowiska. Migracja `20260831140000`
dokłada kolumnę, ale wygenerowany `types.ts` powstaje z WDROŻONEJ bazy, więc do
czasu wdrożenia filtr się nie skompiluje, a rzutowania w tym repozytorium nie
ma - kompilator ma rację, bo kolumny naprawdę jeszcze nie ma w bazie. Kolejność
zapisana w komentarzu: wdrożyć → przegenerować typy → dopisać filtr.

---

## 4. Izolacja najemcy (część C)

Przegląd polityk RLS wszystkich tabel obu modułów. **Wzorzec z migracji
`20260829091010` miał w repozytorium jeszcze 35 wystąpień - liczba potwierdzona
co do sztuki.** Naprawionych 6 leżących w modułach 13/14 (35 → 29):

| tabela               | polityka                          |
| -------------------- | --------------------------------- |
| `subscriptions`      | `Users can view own subscription` |
| `membership_grants`  | `grants own read`                 |
| `organization_seats` | `seats own read`                  |
| `user_purchases`     | `purchases owner read`            |
| `user_subscriptions` | `subs owner read`                 |
| `post_gift_links`    | `gift links owner read`           |

Wszystkie na kolumnie SELECT, więc przeciekał ODCZYT: po przepięciu profilu do
innego obszaru roboczego właściciel widział swoją historię zakupów, subskrypcji,
przydziałów członkostwa, miejsc w organizacji i linków prezentowych założonych
w obszarze, którego już nie dotyczy.

**Dlaczego bramki tego nie łapały.** `check:sql-owner-tenant-scope` jest
SAMOKALIBRUJĄCA: zapala się, gdy na tej samej tabeli jedna klauzula
właścicielska wiąże tenanta, a inna go gubi. Każda z tych sześciu tabel ma
DOKŁADNIE JEDNĄ politykę właścicielską, a tenanta pilnuje polityka
ADMINISTRACYJNA - nie ma więc rodzeństwa deklarującego intencję. Ta klasa luki
jest poza zasięgiem tamtej bramki z konstrukcji, nie przez przeoczenie.
`post_gift_links` dokładało drugi powód: właścicielem jest tam `created_by`,
nie `user_id`.

**Dowód jest wykonawczy, nie statyczny.** Uprząż `tenant-isolation-harness`
dostała ścięte definicje tych sześciu tabel, polityki w stanie SPRZED naprawy
i 25 nowych asercji runtime. Sprawdzone w obie strony: z migracją 45 asercji
zielonych, bez niej uprząż pada na pierwszej asercji odczytu subskrypcji.

**`payment_webhook_events` - rozstrzygnięte.** Kolumna `tenant_id` JEST i jest
NOT NULL od migracji `20260824080046` (default + trigger wiążący najemcę
z profilu płatnika), czyli teza „brak tenant_id w definicji tabeli" jest
nieaktualna. Komentarz z migracji `20260730085737` twierdzący inaczej
wprowadzał w błąd każdy kolejny przegląd - zastąpiony `COMMENT ON COLUMN`
podającym stan faktyczny i uzasadniającym, dlaczego polityka odczytu celowo NIE
zawęża po najemcy (jedyny podmiot czytający to super admin, rola platformowa,
diagnozująca także zdarzenia sprzed powiązania płatnika).

### Pozostałe 29 wystąpień - przejrzane, nienaprawione

Leżą poza modułami 13 i 14 (komentarze, zgłoszenia, spotkania, historia
czytania, rejestr zgód, profile). Dwa wystąpienia w `profiles` są udokumentowane
w bramce jako POZORNE (tautologia). Reszta to osobna praca dla właścicieli tych
modułów - lista w treści migracji.

---

## 5. Progi per-ścieżka

Moduł 14 miał **zero** progów. Dołożonych **13** (357 → 370 w pliku), każdy
według reguły „zmierzone minus ~4 pp", każdy z komentarzem podającym pomiar,
datę i RYZYKO, którego pilnuje.

Wszystkie **udowodnione przebiegiem**: pełna suita z progami przechodzi bez
ani jednego `ERROR: Coverage ... does not meet ... threshold`.

Trzy powierzchnie dostały progi WYŻSZE niż katalogowe, bo osunięcie się na nich
ma zapalić światło natychmiast, a nie rozpłynąć się w średniej:
`api/public/ad-event.ts`, `lib/billing/refunds.server.ts`,
`lib/billing/returnUrl.server.ts`.

### Znalezisko przy ustawianiu progów

Pierwszy pomiar `returnUrl.server.ts` po naprawie open redirectu pokazał
**75,92%** instrukcji. Naprawa bezpieczeństwa dołożyła TRZYNAŚCIE niepokrytych
instrukcji do pliku, który JEST bramką bezpieczeństwa - dokładnie wzorzec
z rozdz. 8.4 audytu. Domknięte 24 przypadkami (98,14% instrukcji / 97,43%
gałęzi), z których każdy dopuszczający ma KONTRPRZYKŁAD: `localhost` przechodzi,
`localhost.evil.example.org` nie; wariant `www` dozwolonej domeny przechodzi,
`evil-najemca.example.org` nie. Próg podniesiony z 71 na 94.

---

## 6. Bramki `check:*`

**31 zielonych.** Siedem czerwonych, wszystkie wyjaśnione:

| bramka                             | powód                                                                                   |
| ---------------------------------- | --------------------------------------------------------------------------------------- |
| `bundle`, `chunks`, `entry-purity` | wymagają `bun run build` - analizują zbudowany bundel                                   |
| `db-contract`, `migration-ledger`  | wymagają poświadczeń Supabase; bramki po-wdrożeniowe                                    |
| `types-freshness`                  | zgłasza `donations.environment` z migracji `20260831140000` - poprawnie, patrz sekcja 3 |
| `legacy-payment-refs`              | **była realna, naprawiona** - fixture niósł żywą referencję do poprzedniego operatora   |

`check:i18n-parity`, `check:i18n-hardcoded`, `check:i18n-overlay-imports`,
`check:i18n-default-value`, `check:tenant-isolation`, wszystkie `check:sql-*`,
`check:authz-snapshot` - zielone.

### Regresja własna, znaleziona i naprawiona

`check:i18n-overlay-imports` była ZIELONA na mainie i CZERWONA na tej gałęzi,
na 12 plikach - wszystkich utworzonych ekstrakcją. Nakładka słownika rejestruje
klucze EFEKTEM UBOCZNYM importu; przed ekstrakcją robił to plik trasy przez
`ensureI18n()`. Po wyniesieniu paneli żaden ich nie wciągał, więc klucze
działały wyłącznie dopóki wciągnął nakładkę przypadkiem inny moduł w tym samym
chunku. **Żadna inna bramka tego nie widzi**: typy zielone (klucz istnieje),
parytet zielony (klucz w obu językach), ratchet zielony (napis idzie przez
`t()`). Naprawione 12 importami.

---

## 6b. Kod wyjścia pełnej suity - stan zastany

Przebieg końcowy z progami: **1949 plików zielonych, 51 613 testów, 240 wpisów
`it.fails`, ZERO błędów progów**. Kod wyjścia to jednak `1`, i to wymaga
wyjaśnienia, żeby nikt nie uznał tego za regresję.

Powodem są dwa nieobsłużone błędy `connect ECONNREFUSED 127.0.0.1:3000`,
pochodzące z modułu buildera (`settingsFidelity.gate.test.tsx`,
`sampleDataLeak.gate.test.tsx`, `allWidgets.smoke.test.tsx`). Liczba jest
IDENTYCZNA w pomiarze bazowym sprzed tej pracy i w przebiegu końcowym
(`Errors  2 errors` w obu), więc to stan zastany na `main`, nie skutek tej
gałęzi.

Sprawdzone wprost: cztery pliki testowe tej pracy, które w logu sąsiadowały
z tymi błędami (`-fx-rate`, `-ad-event`, `consentGate`, `ads/consent`),
uruchomione osobno dają **exit 0, 129 testów zielonych, zero błędów** -
sąsiedztwo w logu wynikało z przeplotu stderr równoległych workerów, nie
z przyczynowości. Żaden test tej pracy nie wychodzi do sieci.

---

## 7. Czego świadomie nie zrobiłem

1. **Nie naprawiłem defektu zerowego UUID w RPC kuponu** - wymaga migracji SQL,
   a zakres zabraniał pisania migracji przy okazji naprawy w kodzie.
2. **Nie domknąłem `revokeDonation`** - blokuje to generowany `types.ts`, patrz
   sekcja 3. Migracja jest na gałęzi, kolejność zapisana w kodzie.
3. **Nie ruszałem `components/donations/**` (publicznych)** - poza zakresem
   zleceń cząstkowych; to jedyny niespełniony cel liczbowy.
4. **Nie naprawiłem `fields.tsx`** (etykiety bez `htmlFor`) - źródło wspólne dla
   wszystkich paneli ustawień w aplikacji, naprawa dotknęłaby powierzchni
   znacznie szerszej niż oba moduły.
5. **Nie uruchomiłem `bun run build`** przed pierwszym raportem - trzy bramki
   bundla pozostały niesprawdzone w tej sesji.
6. **Nie tknąłem 29 pozostałych wystąpień wzorca RLS** poza modułami 13 i 14 -
   przejrzane i wypisane, ale to praca dla właścicieli tamtych modułów.
7. **Nie regenerowałem snapshotu autoryzacji, żeby zgasić czerwień** - obie
   regeneracje były klasy PROVENANCE (sam licznik migracji, zero zmian w liczbie
   funkcji i polityk), co bramka sama tak klasyfikuje i co jest zapisane
   w komunikatach commitów.

---

## 8. Uwaga metodologiczna

Zarzut audytu z rozdz. 8.4 brzmiał: 68 z 82 nowych plików testowych atrapowało
własną warstwę danych (`vi.mock` na `@/lib`, `@/components`, `@/hooks`), więc
panel zdawał egzamin wobec atrapy tego, co sam woła.

W tej pracy atrapowane są WYŁĄCZNIE granice: klient Supabase, Stripe, dostawca
poczty, i18n, toast, `IntersectionObserver`, kontekst żądania frameworka.
Żaden moduł `@/lib/billing/*` ani sąsiad testowanego komponentu nie jest
atrapowany. Tam, gdzie agent musiał odstąpić od tej reguły, jest to opisane
w nagłówku pliku testowego wraz z powodem.
