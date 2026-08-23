# Korekty audytu katalogu członkostw v6.1: sześć bramek, dwie dziury i jedna funkcja od zera (2026-08-22)

Zlecenie: **wdrożyć rekomendacje audytu katalogu v6.1 wraz z powiązaniami, w tym po
stronie Stripe.** Audyt (21.08, HEAD `6426bd0`) sprawdził 35 punktów egzekwowania
przywołanych w katalogu i wykazał **pięć błędów merytorycznych, jeden arytmetyczny
i cztery luki produktowe**, korygując bilans statusów na 36 / 6 / 21 / 5.

Jedna uwaga do samego punktu wyjścia. Audyt liczył korektę od bilansu, który v6.1
**deklarował** — 38 / 7 / 21 / 3 — a tabele tego dokumentu zawierały o jedno `[B]`
mniej, niż deklarowała jego własna nagłówkowa nota: 37 / 7 / 21 / 3, razem 68 pozycji,
nie 69. Kierunek korekty audytu jest niezależny od tej pomyłki (jedno `[B]` na `[B?]`,
dwa `[B?]` na `[N]`), więc po nałożeniu jej na liczbę rzeczywistą wychodzi
36 / 6 / 21 / 5 — i ta liczba domyka się z wynikiem wdrożenia co do jednego wiersza:
36 + 6 dopisanych bramek + 2 zbudowane funkcje + 3 nowe pozycje = 47.

**Wynik: wszystkie korekty wdrożone, wszystkie sześć bramek `[B?]` z bilansu po
audycie dopisanych, obie pozycje przeklasyfikowane na `[N]` zbudowane, dwie dziury
odsłonięte przy okazji — zamknięte.** Bilans po wdrożeniu: **47 / 0 / 21 / 3**.
Do zbudowania zostaje jedna funkcja — warstwa odpowiedzi na archiwum — i zostaje
świadomie: to jedyna pozycja katalogu wymagająca istotnej pracy inżynierskiej i jedyna
poza zakresem tego zlecenia.

| Pozycja audytu                 | Status v6.1 | Po audycie | Po wdrożeniu           | Gdzie                                     |
| ------------------------------ | ----------- | ---------- | ---------------------- | ----------------------------------------- |
| 2.2 Mikroserwis klubowy        | `[B]`       | `[B?]`     | **`[B]`**              | `clubs/minisiteAccess.ts`                 |
| 2.3 Bilet wliczony — Członek   | `[B?]`      | `[N]`      | **`[B]`**              | `20260822091000`                          |
| 2.3 Bilet wliczony — Zespół    | `[B?]`      | `[N]`      | **`[B]`**              | `20260822091000`                          |
| 2.4 Ekspozycja biletowa        | —           | korekta    | **wdrożona**           | `20260822091000`, `…095000`               |
| 2.5 Cena Decision Labu         | `[B?]`      | błąd       | **`[B]`**              | `20260822094000`, `catalog.ts`            |
| 3 Ranga 28 osierocona          | —           | korekta    | **wdrożona**           | `20260822090000`                          |
| 3 Ranga Zespołu                | otwarte     | otwarte    | **zamknięte**          | katalog + `…095000`                       |
| 4 Reguła Chatham House         | brak        | luka       | **`[B]`**              | `20260822092000`                          |
| 4 Limit miejsc                 | brak        | luka       | **`[B]`**              | katalog (mechanizm działał)               |
| 4 Darowizny bez wejścia        | —           | luka       | **wdrożona**           | `SupporterStrip.tsx`                      |
| 4 Weryfikacja domenowa         | ręczna      | luka       | **`[B]`**              | `20260822094000`                          |
| 2.1 Licznik treści             | „ZMIANA"    | fałszywe   | **korekta w katalogu** | brak zmiany w bazie — patrz §2            |
| Klub obserwatora rangi 10      | `[B?]`      | `[B?]`     | **`[B]`**              | `clubs/hubAccess.ts`                      |
| Wczesny dostęp 72 h            | `[B?]`      | `[B?]`     | **`[B]`**              | `20260822093000`                          |
| Decision Lab na `club_events`  | `[B?]`      | `[B?]`     | **`[B]`**              | `20260822096000`                          |
| Próg wolumenowy Zespołu        | `[B?]`      | `[B?]`     | **`[B]`**              | `20260822094000`, `catalogSync.server.ts` |
| Warstwa odpowiedzi (3 wiersze) | `[N]`       | `[N]`      | `[N]`                  | **poza zakresem, świadomie**              |

---

## 1. Dwie dziury, których audyt nie szukał

Obie wyszły przy pisaniu bramki biletowej i obie były w tej samej funkcji.

### 1.1 `rsvp_event` w ogóle nie pytało o bilet

Funkcja bramkowała **wyłącznie** rangę / flagę `pro_briefings` i limit miejsc, po czym
zapisywała `going`. Kolumny `events.ticket_price_cents` nie czytała ani ona, ani
`get_event_access`. RPC jest nadane roli `authenticated`, więc:

```
supabase.rpc('rsvp_event', { p_event_id: <płatne wydarzenie>, p_status: 'going' })
```

dawało darmowe wejście każdemu, kto spełniał próg rangi. Jedyną przeszkodą był przycisk
w interfejsie — `events.$slug.tsx` renderował `EventTicketPurchase` zamiast `RsvpControls`.

To nie jest uboczna obserwacja: **dopóki ta dziura jest otwarta, „bilet wliczony w plan"
nie ma czego sprzedawać**, bo wszyscy mają wszystkie bilety. Bramka biletowa
(`20260822091000`) zamyka ją przy okazji budowy puli.

### 1.2 Ta sama funkcja zgubiła okno rejestracji

Kontrola `rsvp_opens_at` / `early_rsvp_rank` istniała w `20260714130000` i zniknęła przy
przepisaniu ciała na kolejkę rezerwową (`20260721072715`) — nie decyzją, tylko przy
przenoszeniu. Od tamtej pory okno rejestracji było blokadą **wyłącznie kliencką**,
a komentarz w `events.$slug.tsx` zapewniał, że „twardo egzekwuje to `rsvp_event`".
Przywrócone w `20260822092000` (skoro i tak przenosimy całe ciało, przenosimy je komplet).

---

## 2. Licznik treści: korekta bez zmiany w bazie

Audyt (2.1) nazwał to najpoważniejszym błędem łańcucha dokumentów i miał rację co do
faktów. Stan odczytany z migracji:

| Pole                   | Wartość | Skąd                                     |
| ---------------------- | ------- | ---------------------------------------- |
| `enabled`              | `true`  | `20260722231619` (`SET DEFAULT true`)    |
| `member_monthly_limit` | `5`     | `20260722231619` (`SET DEFAULT 5`)       |
| `anon_monthly_limit`   | `0`     | `20260721063638` (default założycielski) |

`consume_metered_view` i `metering_state` liczą `requires_registration` jako
`anon_monthly_limit <= 0`, więc **twarda bramka rejestracyjna działała od pierwszego
artykułu już w chwili pisania v6.1**. Oznaczenie „ZMIANA" opisywało stan istniejący jako
nowość, a proponowana „1 analiza bez konta" była w istocie **poluzowaniem** bramki.

**Nie zmieniono niczego w bazie.** Wdrożenie to korekta katalogu: wiersz opisuje stan
faktyczny (`0 / 5`), a propozycja jednej darmowej analizy przeniesiona do rozstrzygnięć
otwartych jako kompromis SEO wobec odsetka zatrzymanych czytelników. Zmiana jest
odwracalna jednym zapytaniem, więc nie ma powodu robić jej w ciemno.

---

## 3. Bilet wliczony w plan: nowa funkcja, nie brakująca reguła

Katalog odsyłał do tabeli `event_tickets` przy statusie `[B?]`. **Tabela nie istnieje.**
Warstwa biletowa jest zbudowana inaczej: cena w `events.ticket_price_cents`, zakup przez
`adhocCheckout.server.ts` z celem `event_ticket`, miejsca i kod wejściówki w
`events/ticket.server.ts`. Wyszukanie `free_ticket`, `included_ticket`,
`ticket_allowance`, `ticket_credit`, `comp_ticket` w całym repozytorium: zero trafień.

### 3.1 Model

Trzy klucze liczbowe w `membership_tiers.features` (konwencja `expert_request_quota`):

| Klucz                        | Znaczenie                        | Wartości                                                                                            |
| ---------------------------- | -------------------------------- | --------------------------------------------------------------------------------------------------- |
| `included_event_tickets`     | bilety **na członka** na rok     | 1 dla `member`, `pro`, `vip`, `ngo`, `corporate`, `partner`, `partner_general`, `presidents_circle` |
| `included_event_tickets_org` | bilety **na organizację** na rok | 3 dla `team`                                                                                        |
| `event_ticket_discount_pct`  | zniżka zamiast biletu            | 50 dla `student`, `educator`                                                                        |

Pula liczy **maksimum** z warstw, nie sumę — dlatego Pro dziedziczy bilet po Członku
i nie dostaje drugiego, dokładnie jak zapisuje katalog. Rozdzielenie puli osobowej
i organizacyjnej jest wymuszone korektą 2.4 audytu (rachunek niżej).

### 3.2 Rok członkowski, nie kalendarzowy

`membership_year_window(p_user)` liczy okno **rocznicowe** od początku najwcześniejszego
czynnego uprawnienia (subskrypcja albo nadanie ręczne; data założenia konta wyłącznie
jako zapas). Rok kalendarzowy wymuszałby albo proporcjonalność (pół roku = pół biletu,
czyli zero), albo prezent (pełny bilet za dwa miesiące składki). Okno rocznicowe nie
wymaga arytmetyki w komunikacji z członkiem: kto dołączy 15 listopada, ma bilet do
14 listopada roku następnego i kolejny od 15 listopada.

### 3.3 Ekspozycja: rachunek, który wymusił korektę

v6.1 dawała progowi Zespół jeden bilet rocznie na **każde miejsce**:

| Miejsc | Przychód roczny (89 zł/mies.) | Bilety | Przy 300 zł | Udział | Przy 500 zł | Udział |
| -----: | ----------------------------: | -----: | ----------: | -----: | ----------: | -----: |
|     20 |                     21 360 zł |     20 |    6 000 zł |    28% |   10 000 zł |    47% |

Stawka studencka: 190 zł rocznie wobec biletu o cenie katalogowej 300 zł — **sprzedaż
poniżej kosztu krańcowego uczestnictwa**, przy czym student jest jednocześnie grupą,
która skorzysta z niego najchętniej.

Stąd: Zespół dostaje pulę organizacyjną (3 bilety niezależnie od wielkości), stawki
ulgowe — zniżkę 50% zamiast biletu.

### 3.4 Warstwy

| Warstwa       | Plik                                          | Rola                                                       |
| ------------- | --------------------------------------------- | ---------------------------------------------------------- |
| Baza          | `20260822091000_plan_ticket_allowance.sql`    | `plan_ticket_claims`, cztery RPC, bramka w `rsvp_event`    |
| Reguły czyste | `src/lib/events/ticketAllowance.ts`           | `ticketOffer`, `ticketAmountCents`, `parseTicketAllowance` |
| Serwer        | `src/lib/events/ticketAllowance.server.ts`    | jedno wejście do RPC dla wszystkich ścieżek serwerowych    |
| Kasa          | `checkout.functions.ts`, `adhocCheckoutOrder` | kwota po benefitach, odmowa `ticket_included_in_plan`      |
| Interfejs     | `EventTicketPurchase.tsx`                     | trzy ścieżki: wliczony / zniżkowy / pełnopłatny            |

Reguła kolejności jest jedna i testowana: **bilet bije zniżkę**. Gdyby ktoś miał oba
(członek, który dokupił stawkę akademicką), naliczenie zniżki od zera dawałoby zero, ale
spalałoby bilet — a bilet jest wart więcej. Zaokrąglenie zniżki w dół, na korzyść
kupującego.

Rezygnacja z udziału zwalnia bilet (`released_at`); wiersz zostaje jako ślad audytowy.
Trafienie na listę rezerwową też zwalnia — miejsce nie zostało przyznane, więc benefit
nie może zostać spalony.

---

## 4. Stripe: zmiana w źródle prawdy, nie w panelu operatora

Architektura repozytorium jest jednoznaczna: **`access_plans` jest źródłem prawdy
o kwotach**, a `catalogSync.server.ts` odtwarza z niego katalog u operatora
idempotentnie, po czytelnych identyfikatorach (`lookup_key` ceny,
`metadata.lovable_external_id` produktu). Wewnętrzne `price_…` / `prod_…` nie są nigdzie
zapisywane. Zmiana zrobiona w migracji **jest** zmianą w Stripe — po najbliższej
synchronizacji, którą automat uruchamia sam po zmianie odcisku cennika.

Synchronizacja miała dwa milczące założenia i oba trzeba było znieść:

**„Każda cena jest cykliczna."** `billingCycle()` nie znało interwału `one_time` i wpadało
w `default`, czyli miesiąc. Miejsce w Decision Labie za 16 000 zł zostałoby założone jako
**subskrypcja miesięczna**. Teraz `one_time` daje cenę bez `recurring`.

**„Każda cena jest płaska."** Rabat wolumenowy Zespołu wymaga ceny schodkowej
(`billing_scheme: tiered`, `tiers_mode: volume` — po osiągnięciu progu **wszystkie**
miejsca liczą się niżej, nie tylko nadwyżka). Progi biorą się z nowych kolumn
`access_plans.volume_threshold_seats` / `volume_price_cents`; odczyt ceny rozwija
`data.tiers`, bez czego cena schodkowa wyglądałaby jak cena bez progów i sync
odtwarzałby ją w kółko.

Obie kolumny weszły też do **odcisku cennika** (`catalogFingerprintSource`). Bez tego
podniesienie rabatu w bazie nie zmieniłoby odcisku, więc automat nigdy by go nie
zsynchronizował: w cenniku 79 zł, u operatora 89.

| Pozycja katalogu operatora | `lookup_key`        | Kształt                      | Kwota      |
| -------------------------- | ------------------- | ---------------------------- | ---------- |
| Zespół — za miejsce        | `team_monthly_seat` | schodkowa, `volume`, 2 progi | 89 / 79 zł |
| Decision Lab — miejsce     | `decision_lab_seat` | jednorazowa, bez `recurring` | 16 000 zł  |

`tier_key = 'decision_lab'` świadomie **nie ma** odpowiednika w `membership_tiers`: zakup
miejsca w cyklu nie nadaje żadnej rangi w drabince i nie może jej nadawać — to produkt,
nie członkostwo.

Zniżka 50% dla stawek ulgowych **nie jest** kuponem u operatora. Bilet i tak przechodzi
ścieżką `price_data` (kwota wyliczana serwerowo z wiersza wydarzenia), więc zniżka jest
regułą aplikacji i widać ją w tej samej kwocie w kasie, na karcie i w zamówieniu.

---

## 5. Cena Decision Labu: korekta arytmetyczna

v6.1: „12 000 zł to trzy czwarte odpowiednika ECRI (5 000 euro)".

| Wielkość                    | Wartość     |
| --------------------------- | ----------- |
| Kurs NBP 162/A z 21.08.2026 | 4,3122 zł/€ |
| 5 000 € (stawka ECRI)       | 21 561 zł   |
| 12 000 zł jako udział       | **55,7%**   |
| 16 000 zł jako udział       | **74,2%**   |

Decyzja właściciela: **utrzymać relację trzech czwartych, cena idzie do 16 000 zł.**

---

## 6. Ranga 28 i ranga Zespołu

`TIER_RANKS.business = 28` została w kodzie po wycofaniu progu Partner Biznesowy z v6,
a droplista `CLUB_PLAN_TIERS` w ogóle jej nie zna i degraduje do „VIP" (25) przy
wyświetlaniu. Administrator widział więc w panelu próg **niższy** niż egzekwowany.

Decyzja właściciela: **przemapowanie na 30 (Enterprise)** — najostrożniejsza z trzech
opcji, bo zachowuje faktyczny stan dostępu co do osoby (klub z progiem 28 wpuszczał
rangi ≥ 28, czyli realnie ≥ 30; po zmianie wpuszcza ≥ 30 — ten sam zbiór ludzi).
Przemapowane w `clubs`, `events`, `content_access`, `member_resources`.

Sam próg `business` w `membership_tiers` / `access_plans` **zostaje nietknięty**: ma trzy
aktywne cykle w katalogu operatora i mógł zostać sprzedany. Wycofanie go z drabinki jest
decyzją handlową, nie porządkową.

Ranga Zespołu zostaje **25**, ale przestaje być niezapisaną konsekwencją seedu — katalog
mówi wprost: zakres Pro **plus** wejścia rangi 25. Zejście do 20 zgadzałoby się z hasłem,
ale zabrałoby miejscom zespołowym kluby i treści bramkowane rangą 25.

---

## 7. Chatham House: bramka, nie etykieta

`events.chatham_house boolean NOT NULL DEFAULT false` istnieje od modułu wydarzeń
(`20260713093000`) i **nie czytała jej żadna bramka**. Katalog nie odwoływał się do niej
ani razu, mimo że reguła Chatham House jest głównym argumentem za wartością klubów
i Decision Labów.

Uzasadnienie bramki nie jest handlowe: uczestnik może cytować treść, ale nie autora, i to
zobowiązanie ma sens **wyłącznie w kręgu, który zna swój skład**. Wpuszczanie tam
każdego, kto spełnia próg rangi wydarzenia otwartego, było sprzeczne z samą regułą, nie
tylko z cennikiem. Flaga `chatham_house_events` od progu Pro; ta sama bramka w zapisie
(`rsvp_event`) i w odczycie (`get_event_access`), żeby wydarzenie nie oddawało `join_url`
komuś, komu zapis by odmówił.

**Limit miejsc świadomie nie dostał osobnej bramki.** Mechanizm ekskluzywności już działa:
`rsvp_event` przenosi na listę rezerwową po wyczerpaniu limitu, `assertSeatAvailable`
blokuje sprzedaż biletu ponad stan, a `refundIfOversold` zwraca pieniądze, gdy ostatnie
miejsce zajmie ktoś inny między nakładką płatności a webhookiem. Luka jest wyłącznie
sprzedażowa — katalog nie używał limitu jako argumentu. To korekta w katalogu, nie
w kodzie; dokładanie drugiego mechanizmu do działającego byłoby regresją.

---

## 8. Wczesny dostęp: `publish_at`, nie `published_at`

Rozróżnienie z `20260702090100` jest istotne i katalog trafnie je wskazał:

- `publish_at` — **harmonogram**: moment, w którym `publish_due_posts()` przestawi wpis ze
  `scheduled` na `published`,
- `published_at` — **fakt** publikacji (backdatowany do planowanego momentu).

Wczesny dostęp to z definicji okno **przed** tym momentem, więc jedynym poprawnym punktem
zaczepienia jest `publish_at`. Bramką jest **druga polityka odczytu** na `posts`, a nie
warunek w `has_content_access`: ta ostatnia rozstrzyga, czy oddać treść wiersza, który
czytelnik już widzi — a tu problem jest o poziom niżej, bo RLS wiersza nie przepuszcza.

Flaga `early_access` przeniesiona z progu Członek (seed v3) na Pro i wyżej. Dopóki była
dekoracyjna, rozjazd nic nie kosztował; od chwili, gdy **otwiera treść**, wdrożenie bez
przeniesienia rozdałoby benefit Pro wszystkim członkom za 39 zł.

---

## 9. Weryfikacja domenowa i darowizny

**Weryfikacja.** Platforma ma weryfikację domenową od `20260806094104`
(`verification_domains`, `verification_domain_badges`, `sync_org_verification`,
`grants_tier_key`) i stosuje ją do odznak profilu. Brakowało jednego: oznaczenia, **które**
domeny są akademickie. Kolumna `academic` + RPC `my_academic_domain_verification` (mówi
`automatic` i **powód**, żeby formularz umiał powiedzieć, czego brakuje, zamiast
bezwarunkowo prosić o skan legitymacji) + przełącznik w panelu.

Rozszerzenie `admin_upsert_verification_domain` o siódmy parametr wymagało `DROP` przed
`CREATE`: zmiana listy parametrów zakłada u Postgresa **nową funkcję obok starej**, a
wołanie parametrami nazwanymi trafiłoby wtedy na `42725 function is not unique`.

**Darowizny.** Audyt napisał, że moduł „nie ma wejścia w interfejsie". Ściślej: wejście
było, ale **uwarunkowane istnieniem wycofanego progu** — `SupporterStrip` renderował się
tylko wtedy, gdy w `membership_tiers` istniał wiersz `supporter`. Wycofanie progu
zabrałoby ostatnie stałe wejście do ośmiu zbudowanych modułów obsługi wpłat. Pasek jest
teraz bezwarunkowy, czyta cel z konfiguracji darowizn (`resolveDonationTarget`), znika
tylko przy wyłączonym module i mówi wprost, że wpłata **nie jest progiem członkostwa
i nie daje pakietu benefitów**.

---

## 10. Czego NIE dowieziono

**Warstwa odpowiedzi na archiwum** — trzy wiersze katalogu (`[N]`), jedna funkcja, zero
linii kodu. To jedyna pozycja katalogu wymagająca istotnej pracy inżynierskiej i jedyna
adresująca trend, który zagraża całemu modelowi (wg Digital News Report 2026 tylko 4%
użytkowników chatbotów przechodzi do źródła, wobec 19% przy wyszukiwarce). Zostaje poza
zakresem świadomie: to osobny projekt, nie korekta audytu.

**Ceny progów indywidualnych** nie były ruszane. Seed `pricing_catalog_v3_rows()` niesie
ceny v3 (Plus 59/590, Pro 129/1290, Zespół 99), katalog v6.1 mówi 39/390, 119/1190, 89.
Rozjazd jest realny, ale `seed_pricing_plans_v3` wstawia wyłącznie brakujące wiersze
(`WHERE NOT EXISTS`), więc produkcyjne kwoty mogły zostać ustawione w panelu i seed ich
nie widzi. **Zmiana cen żywych subskrypcji to decyzja handlowa z konsekwencjami dla
istniejących płatników — nie audytowa** i audyt jej nie zlecał. Do rozstrzygnięcia osobno.

**Próg `business`** nie został wycofany z platformy — patrz §6.

---

## 11. Weryfikacja

| Bramka                               | Wynik                                                     |
| ------------------------------------ | --------------------------------------------------------- |
| `check:sql-migration-replay`         | ✅ (0 nowych bliźniaków treści)                           |
| `check:sql-tenant-scope`             | ✅ 847 funkcji, 4 uzasadnione ścieżki publiczne           |
| `check:sql-app-role`                 | ✅ 975 literałów `has_role`                               |
| `check:sql-anon-insert`              | ✅ 557 polityk                                            |
| `check:sql-owner-tenant-scope`       | ✅                                                        |
| `check:sql-policy-tenant-regression` | ✅                                                        |
| `check:sql-emit-actor`               | ✅                                                        |
| `check:rpc-contract`                 | ✅                                                        |
| `check:types-freshness`              | ✅ baseline bez zmian (26 pozycji)                        |
| `check:authz-snapshot`               | ✅ po regeneracji (20 bramek flag dla 16 flag)            |
| `check:gate-coverage`                | ✅                                                        |
| `check:db-row-casts`                 | ✅                                                        |
| `check:stale-never-casts`            | ✅                                                        |
| `check:unknown-casts`                | ✅                                                        |
| `check:content-layering`             | ✅                                                        |
| `check:legacy-payment-refs`          | ✅                                                        |
| `check:i18n-hardcoded`               | ✅                                                        |
| `check:i18n-default-value`           | ✅                                                        |
| `check:i18n-overlay-imports`         | ✅                                                        |
| `check-pgtap-plan`                   | ✅ 98 plików, `plan(N)` = liczba asercji                  |
| `typecheck`                          | ✅ `tsc --noEmit` na całym projekcie                      |
| `check:db-contract`                  | ⛔ wymaga `SUPABASE_URL` / klucza — brak w tym środowisku |

Pakiet testowy Vitest: **38 402 testy przechodzą, zero nieudanych** (1 480 plików).

Nowe testy jednostkowe:

- `src/lib/events/__tests__/ticketAllowance.test.ts` — 21 przypadków: kolejność benefitów
  (bilet bije zniżkę), kierunek degradacji przy awarii RPC, zaokrąglenie na korzyść
  kupującego, kształty nietypowe odpowiedzi.
- `src/lib/billing/__tests__/catalogSync.server.test.ts` — 7 nowych: cena jednorazowa bez
  `recurring` (także po korekcie kwoty), cena schodkowa w trybie `volume`, wykrycie dryfu
  progów i przejścia płaska ↔ schodkowa, brak zmiany przy progach zgodnych.
- `src/lib/billing/__tests__/catalogAutoSync.test.ts` — próg wolumenowy w odcisku cennika.
- `src/lib/clubs/__tests__/minisiteAccess.test.ts` — **zapadka**: obniżenie
  `CLUB_MINISITE_TIER_RANK` z powrotem do Pro oblewa CI.
- `supabase/tests/plan_ticket_allowance_test.sql` — **28 asercji pgTAP** na warstwie danych:
  kształt rejestru puli, pula osobowa i organizacyjna, stan miejsca, bramka biletowa,
  zwrot do puli, lista rezerwowa, okno roku członkowskiego i reguła Chatham House w obu
  kierunkach.

### 11.1 Odtworzenie bazy z migracji wykryło dwa defekty, których nie widać w kodzie

Testy jednostkowe nie dotykają Postgresa, a `check:sql-*` czyta SQL jako tekst. Żadne
z nich nie odpowiada na pytanie „czy ta migracja się wykona i czy funkcja robi to, co
mówi". Odpowiedź wymagała postawienia Postgresa 16 i nałożenia **wszystkich 795 migracji**.

Pierwsze podejście szło przez bootstrap napisany na miejscu i kończyło się wynikiem
740 / 795 (55 plików padało na brakach środowiska). Repozytorium ma jednak własny runner
(`scripts/pgtap-local/run.sh`, `bun run test:pgtap-local`), który odtwarza powierzchnię
Supabase kompletnie — z nim, po doinstalowaniu `postgresql-16-pgtap`
i `postgresql-16-pgvector`, przechodzi **795 z 795 migracji, zero błędów**, wraz
z `supabase/seed.sql`. Wszystkie liczby poniżej pochodzą z tego przebiegu.

Dwa defekty wyszły dopiero tam:

**1. `unknown_tier_key: decision_lab`.** `access_plans.tier_key` nie ma klucza obcego, więc
z lektury schematu wyglądał na wolne pole tekstowe. Ma jednak **trigger walidujący**
(`tg_access_plans_validate_tier_key`, 20260723120000), który odrzuca klucz bez
odpowiednika w `membership_tiers` błędem `23503`. Migracja z produktem Decision Lab
wywracała się na wdrożeniu. Naprawa: techniczny wiersz warstwy `decision_lab`
(`rank = 0`, `features = {}`, `active = false`) zakładany PRZED planem — mostek dla
triggera, nigdy próg drabinki.

**2. Zawieszone miejsce w organizacji czerpało z puli biletów.** `my_ticket_allowance`
sprawdzało status ORGANIZACJI, ale nie status MIEJSCA. Odebranie komuś miejsca zostawiało
mu prawo do biletu z puli firmy. Naprawa: ten sam predykat, co w `current_membership_tier`
(20260729210625) — `active` albo `grace` w oknie karencji, plus `mt.active` na warstwie.

Przy okazji, z przeglądu własnego kodu przed testem: konsumpcja puli brała blokadę na
wierszu WYDARZENIA (przez `rsvp_event`), a pula jest wspólna dla RÓŻNYCH wydarzeń — trzech
członków zespołu zapisujących się równolegle na trzy konferencje mogło wyjąć czwarty
bilet. Blokada idzie teraz na WŁAŚCICIELA PULI (`pg_advisory_xact_lock`), a `claim_included_event_ticket`
straciło grant dla roli `authenticated`: konsumpcja puli jest skutkiem zapisu na
wydarzenie, nie czynnością samą w sobie.

### 11.2 Przegląd na żądanie: trzy dalsze usterki

Po dostarczeniu całości przyszło polecenie „sprawdź poprawność i czy nie ma drobnych
błędów". Przegląd znalazł trzy rzeczy — dwie z nich to defekty bezpieczeństwa przychodu
tej samej klasy, co dziura, którą ta zmiana zamykała.

**1. Lista rezerwowa oddawała bilet, a awans go nie żądał z powrotem.** Zwrot biletu do
puli patrzył na status PO ewentualnym przeniesieniu na listę rezerwową
(`v_result_status`), a nie na to, o co poprosił uczestnik (`p_status`). Członek z pulą,
który trafiał na komplet, dostawał bilet z powrotem — a `promote_event_waitlist` awansuje
z `waitlist` na `going` **bez bramki biletowej**, bo bramka stoi w `rsvp_event`. Efekt:
darmowe wejście na płatne wydarzenie z nietkniętą pulą, wyzwalane przez cudzą rezygnację.
Naprawa: bilet zwalnia wyłącznie świadome `cancelled` albo `interested`; miejsce w kolejce
jest rezerwacją opłaconą biletem. Dwie asercje pgTAP (7a) przybijają obie strony.

**2. Wiersz sprzed rocznicy był darmowym wejściem.** `claim_included_event_ticket` na
ponowny zapis po rezygnacji zdejmowało `released_at` i kończyło na `true` — bez patrzenia
na okno. `my_ticket_allowance` liczy wykorzystanie wyłącznie po wierszach, których okno
obejmuje dziś, więc wiersz z poprzedniego roku członkowskiego był dla licznika
niewidzialny: kto zapisał się i zrezygnował rok wcześniej, wchodził w tym roku na koszt
domu, a pula dalej pokazywała komplet. Naprawa: skrót obowiązuje tylko dla wiersza
czynnego w BIEŻĄCYM oknie, każdy inny przechodzi normalne sprawdzenie puli, a
`ON CONFLICT` przestemplowuje go bieżącym oknem zamiast milczeć (`DO NOTHING`). Asercje
pgTAP 7b.

**3. `admin_upsert_verification_domain` istniało w bazie w dwóch wariantach.** Migracja
20260809102603 dołożyła szósty parametr samym `CREATE OR REPLACE`, więc pięcioargumentowa
wersja z 20260806094104 została jako przeciążenie — widać ją w wygenerowanych typach jako
drugi wariant `Args`. Ta zmiana i tak DROP-owała sześcioargumentową (siódmy parametr
`p_academic`), więc porządkuje nazwę do końca: zostaje jedna funkcja. Żaden kod nie wołał
starej, ale każde wywołanie bez `p_academic` i `p_grants_tier_key` pasowałoby do obu naraz
— dokładnie ten `42725`, przed którym broni się DROP.

Przy okazji poprawiony **bilans w nagłówku katalogu**: v6.1 deklarował 38 `[B]`, a jego
tabele zawierały 37 (68 pozycji, nie 69). Korekta audytu nałożona na liczbę rzeczywistą
daje 36 / 6 / 21 / 5, a nie 37 / 6 / 21 / 5 — i dopiero ta liczba domyka się z wynikiem
wdrożenia co do jednego wiersza (36 + 6 + 2 + 3 = 47). Usunięto też nieużywaną zmienną
`v_org_tier` z `my_ticket_allowance`.

### 11.3 Pełny `typecheck`: cztery błędy typów z tej właśnie zmiany

Poprzednia rura weryfikacyjna zapisała `typecheck` jako „✅ dla zmienionych plików",
bo pełne `tsc --noEmit` przewracało się w tym środowisku na braku
`@lovable.dev/vite-tanstack-config`. Po doinstalowaniu brakujących pakietów publicznych
pełny przebieg dał się wykonać — i pokazał **cztery błędy pochodzące wprost z tej
zmiany**. Testy jednostkowe ich nie widziały, bo Vitest nie sprawdza typów.

1. **`admin_list_verification_domains` nie zwracało `academic` w typach.** Funkcja jest
   `RETURNS SETOF public.verification_domains` z `SELECT *`, więc w bazie kolumnę oddaje
   od razu po jej dodaniu — ale wygenerowany `Returns` w `types.ts` jej nie miał, a
   `VerificationDomainRow` już tak. Panel weryfikacji nie kompilował się. Uzupełnione.
2. **`Stripe.PriceCreateParams` jako typ samego kształtu kwoty.** Pełny typ parametrów
   wymaga `currency`, a `shape` niesie tylko kwotę i jest rozwijany PO `currency` — stąd
   i brak wymaganego pola, i `TS2783` (nadpisanie waluty). Wprowadzony węższy
   `StripePriceShape`.
3. **`CatalogPriceStatus.interval` przepisywało listę cykli z ręki.** Dołożenie
   `one_time` do `PlanBillingInterval` rozjechało diagnostykę płatności. Pole bierze
   teraz typ wprost z katalogu, więc następny cykl dojedzie tam sam.
4. **Fikstury `ClubEventRow` bez `min_tier_rank`.** Kolumna doszła do wyniku
   `club_events_list`, dwie fikstury testowe jej nie miały.

Po poprawkach `tsc --noEmit` przechodzi **na całym projekcie**, nie tylko na zmienionych
plikach — ograniczenie opisane niżej już nie obowiązuje.

Weryfikacja po tych poprawkach: pełny pakiet pgTAP przez runner repozytorium —
**93 pliki OK, 5 z błędem**, i wszystkie pięć to klasy udokumentowane
w `scripts/pgtap-local/README.md` jako artefakty środowiska (brak `pg_net`, atrapa
`storage.objects`, locale `C` w `initdb`), żadna nie dotyka tej zmiany.

### Ograniczenie środowiska

Prywatny rejestr `europe-west*-npm.pkg.dev` odpowiada `403` przez politykę sieciową,
więc `bun install` kończy się niepełny. Brakujące pakiety publiczne
(`@tanstack/react-start`, `@testing-library/dom`, `jsdom` i pochodne) doinstalowano
z rejestru publicznego **bez dotykania `package.json` ani `bun.lock`**. Po tym zarówno
pakiet testowy, jak i pełne `tsc --noEmit` wykonują się w całości — wcześniejsze
zastrzeżenie, że `typecheck` da się sprawdzić tylko na zmienionych plikach, już nie
obowiązuje (i właśnie ono ukryło cztery błędy typów opisane w 11.3). `supabase test db` nie był uruchamiany (brak Dockera), ale nie było to potrzebne:
repozytorium ma runner `bun run test:pgtap-local`, który stawia własny klaster
i odtwarza pełny schemat bez Dockera. Po `apt install postgresql-16-pgtap
postgresql-16-pgvector` cały pakiet pgTAP wykonuje się na prawdziwym pgTAP —
`plan_ticket_allowance_test.sql` 28/28.
