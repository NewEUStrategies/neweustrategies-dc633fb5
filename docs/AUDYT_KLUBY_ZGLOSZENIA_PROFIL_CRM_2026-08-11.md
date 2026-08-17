# Audyt: zgłoszenia do klubów dyskusyjnych, synchronizacja z profilem i CRM

Data: 2026-08-11 · Punkt odniesienia: `cc5d959` („Dodano zgłoszenia klubów PRO+")
Zakres: ścieżka `/club/apply` → `club_apply_submit` → skrzynka admina → CRM → profil

---

## 0. Metoda i czego ten audyt NIE sprawdził

Zbadano ścieżkę zgłoszenia od formularza do skutków w bazie: trasę `/club/apply`
(550 linii), walidację (`applyValidation.ts`), dostęp RPC (`applyApi.ts`),
migrację `20260811111733_14e9070e…sql` (291 linii, 4 nowe RPC + tabela
`club_applications` + 3 kolumny w `crm_leads`), skrzynkę admina
(`ClubApplicationsInbox.tsx`), oraz ich styk z trzema istniejącymi warstwami:
progami planu (`membership_tiers`, `current_membership_tier`), kanoniczną
ścieżką CRM (`crm_upsert_from_form`) i kanonicznym back-fillem profilu
(`join_us_link_and_backfill`).

**Weryfikacja empiryczna.** Znaleziska 1.1 i 4.1 nie są odczytem kodu - zostały
odtworzone na realnym PostgreSQL 16 przez wykonanie dokładnie tych instrukcji,
które wykonuje `club_apply_submit`, na schemacie odtworzonym z migracji. Wyjścia
`psql` są wklejone niżej. Uruchomiono też bramkę `scripts/pg-harness/run.sh`
(rozdział 8.1).

**Granica tej metody - i moja pomyłka.** Odtworzony `crm_leads` miał kolumny
i ograniczenia, ale **nie triggery**. Dla 1.1 to bez znaczenia (naruszenie CHECK
jest niezależne od triggerów), ale w 4.1 puste pola w wyniku wziąłem za brak
i dwa z sześciu pierwotnych zarzutów były błędne - `phone_norm` i scoring są
obsługiwane przez triggery tabeli. Rozdział 4.1 jest poprawiony, a wnioski
o brakach opierają się teraz na przeglądzie wszystkich siedmiu triggerów
`crm_leads`, nie na pustych polach. Poprawki wskazała recenzja PR #217.

**Czego nie uruchomiono:** zestawu `vitest` i bramek `check:*`. `bun install`
nie przechodzi w tym środowisku - lockfile przypina tarbally do prywatnego
mirrora `europe-west4-npm.pkg.dev`, który polityka sieciowa sandboxa odrzuca
(403 na CONNECT). Wnioski o testach w rozdziale 8 wynikają z czytania plików
testowych, nie z ich wykonania.

**Stan wyjściowy.** Migracja jest napisana zgodnie z dyscypliną modułu:
`SECURITY DEFINER` + `SET search_path`, `REVOKE ALL … FROM public` przy każdej
funkcji, RLS włączony, tenant w każdym predykacie admina przez
`assert_admin_tenant()`, klient nie pisze do tabeli bezpośrednio. Wszystkie
funkcje pomocnicze, na które migracja się powołuje (`_tg_touch_updated_at`,
`assert_admin_tenant`, `current_membership_tier`, `public_tenant_id`,
`has_role`), istnieją i mają zgodne sygnatury. Problemy nie leżą w higienie
SQL - leżą w tym, że **nowa ścieżka została napisana obok trzech ścieżek, które
już w tym repozytorium istnieją i robią dokładnie to samo**, oraz w jednej
literówce wartości, która wywraca całość.

---

## 1. Znalezisko krytyczne

### 1.1 Każde zgłoszenie kończy się błędem - `source_type` łamie CHECK (KRYTYCZNE)

`club_apply_submit` po zapisaniu zgłoszenia dopisuje ślad w CRM
(`20260811111733…sql:158-192`) z wartością:

```sql
    'club_application',   -- linia 169, kolumna source_type
```

Kolumna `crm_leads.source_type` ma od migracji `20260722094744…sql:11-16`
ograniczenie, które nigdy nie zostało rozszerzone (sprawdzone: żadna z 741
migracji nie robi `DROP CONSTRAINT crm_leads_source_type_check`):

```sql
CHECK (source_type IN (
  'registered','paid_subscriber','event_participant',
  'speaker','expert','contact_form','newsletter','manual'
))
```

`'club_application'` nie należy do tego zbioru. Odtworzenie na PostgreSQL 16:

```
=== CASE 1: brand-new applicant (email absent from crm_leads) ===
ERROR:  new row for relation "crm_leads" violates check constraint
        "crm_leads_source_type_check"
=== CASE 2: returning applicant (lead row already exists) ===
ERROR:  new row for relation "crm_leads" violates check constraint
        "crm_leads_source_type_check"
```

**Zawodzą OBA przypadki, nie tylko nowy lead.** To jest nieintuicyjna część:
`ON CONFLICT DO UPDATE` nie ratuje sytuacji, bo PostgreSQL waliduje CHECK na
wierszu _proponowanym do wstawienia_, ZANIM dojdzie do arbitrażu konfliktu.
Klauzula `DO UPDATE` nie ustawia `source_type` i wygląda bezpiecznie - ale
nigdy nie zostaje osiągnięta.

**Skutek.** `INSERT INTO club_applications` i `INSERT INTO crm_leads` są w jednej
transakcji jednej funkcji. Wyjątek z drugiego zapisu wycofuje pierwszy. Czyli:

- żadne zgłoszenie nie zapisuje się nigdy - ani do CRM, ani do `club_applications`;
- skrzynka `/admin/community/clubs/applications` pozostaje trwale pusta;
- kandydat dostaje `club.spec.apply.submitErrors.unknown`, czyli **„Nie udało
  się wysłać zgłoszenia. Spróbuj ponownie."** - zaproszenie do ponawiania
  czynności, która jest deterministycznie niewykonalna. `clubApplyErrorCode()`
  (`applyApi.ts:63-73`) dopasowuje sześć znanych kodów po `message.includes`;
  komunikat o naruszeniu CHECK nie pasuje do żadnego, więc spada na `unknown`.

Funkcja jest w produkcji od tego commita i **cała funkcjonalność zgłoszeń PRO+
jest niedziałająca w 100% przypadków**. Nie ma tu przypadku brzegowego.

**Poprawka.** Dwie drogi, obie jednolinijkowe:

1. rozszerzyć ograniczenie o `'club_application'` (nowa migracja z `DROP
CONSTRAINT` + `ADD CONSTRAINT`, bo `ADD COLUMN IF NOT EXISTS` z 20260722 już
   nie zadziała) - właściwe, jeśli klubowy lead ma być osobnym segmentem CRM;
2. użyć wartości z dozwolonego zbioru - jeśli segmentacja ma iść po
   `club_applied_at IS NOT NULL` (kolumna już istnieje i indeks też),
   `source_type` nie musi nieść tej informacji.

Rekomendacja: **droga 1**. Kolumna `source_type` ma indeks
`crm_leads_tenant_source_type_idx` i jest naturalnym wymiarem raportu
„skąd przyszedł lead"; `club_applied_at` odpowiada na inne pytanie („kiedy").
Wybierając drogę 1 trzeba pamiętać o rozdziale 4.2 - na istniejącym leadzie
`source_type` i tak nie zostanie zmieniony.

---

## 2. Ścieżka „zaakceptowano" nie ma żadnych skutków

### 2.1 Akceptacja zgłoszenia nie tworzy członkostwa ani nie zawiadamia kandydata (WYSOKIE)

`admin_club_application_set_status` (`…:262-290`) robi dokładnie jedno: zmienia
`status`, dopisuje `admin_note`, stempluje `reviewed_by`/`reviewed_at`. Nic
więcej. Weryfikacja negatywna: `club_applications` nie występuje w ŻADNEJ innej
migracji poza własną, a w kodzie aplikacji tylko w `applyApi.ts` i w typach
generowanych. Nie ma triggera, nie ma drugiego RPC, nie ma szwu.

Wobec tego status `accepted` to **etykieta bez konsekwencji**:

| Co powinno się stać                                                     | Stan                     |
| ----------------------------------------------------------------------- | ------------------------ |
| wiersz w `club_members` (kandydat wchodzi do klubu)                     | nie powstaje             |
| zaproszenie zamiast członkostwa (`club_invite`, `club_invite_by_email`) | nie jest wysyłane        |
| powiadomienie kandydata (`club_notify`, kanał `club` istnieje)          | nie powstaje             |
| e-mail z decyzją                                                        | nie istnieje             |
| uzupełnienie profilu danymi ze zgłoszenia                               | nie następuje (rozdz. 3) |

Moduł ma wszystkie potrzebne klocki - `club_invite`, `club_invite_by_email`,
`club_notify`, `club_members` z `invite_source` - i żaden nie jest podłączony.
Redakcja klika „zaakceptowano", licznik w skrzynce się przesuwa i **nikt poza
redakcją nie dowiaduje się o niczym**. Kandydat, który zapłacił za PRO
i wypełnił 20 pól, nie zobaczy żadnej zmiany.

### 2.2 Kandydat nie ma wglądu we własne zgłoszenie (ŚREDNIE)

Migracja nadaje `GRANT SELECT … TO authenticated` i politykę
`club_applications_select_own`, a komentarz w `applyApi.ts:5-6` uzasadnia to
wprost: _„RLS daje mu wyłącznie odczyt własnych zgłoszeń, żeby formularz mógł
pokazać historię"_.

Nic tej historii nie czyta. W `src/lib/clubs/` nie ma funkcji czytającej
`club_applications` (są `fetchMyClubMemberships`, `fetchMyClubInvitations`,
`fetchMyClubExpertise` - własnych zgłoszeń nie ma). Uprawnienie jest nadane pod
konsumenta, którego nie napisano - ta sama klasa defektu, którą audyt
z 2026-08-08 nazwał „rozjazdem między tym, co kod deklaruje, a tym, co robi".

Po naprawie 1.1 skutek staje się dotykalny: kandydat wyśle zgłoszenie, dostanie
toast i **nigdy więcej go nie zobaczy**. Przy braku powiadomienia z 2.1 jedyną
racjonalną reakcją po tygodniu ciszy jest wysłanie zgłoszenia drugi raz - co
przy braku deduplikacji (rozdz. 8.2) po prostu się udaje.

---

## 3. Synchronizacja z profilem - brak w obu kierunkach

Pytanie „czy zgłoszenie synchronizuje się z profilem, jeśli spełnia wymogi" ma
odpowiedź: **nie, w żadnym kierunku, niezależnie od spełnienia wymogów**. Wymogi
(konto + ranga ≥ 20) są sprawdzane poprawnie; synchronizacji nie ma żadnej.

W repozytorium istnieje kanoniczny wzorzec obu kierunków -
`src/lib/joinUsSync.functions.ts` + RPC `join_us_link_and_backfill`
(`20260716231319…sql:15-53`). Formularz zgłoszeniowy nie używa ani jednej jego
połowy, mimo że **7 z 8 pól tożsamościowych to te same pola**.

### 3.1 Brak prefillu: profil → formularz (WYSOKIE, UX)

Formularz startuje z `EMPTY_CLUB_APPLY` (`club.apply.tsx:102-105`) i nie czyta
profilu ani `user.email`. Kandydat jest zalogowany, ma opłacone PRO i mimo to
przepisuje ręcznie dane, które platforma już o nim ma:

| Pole formularza | Kolumna w `profiles`      | Prefill |
| --------------- | ------------------------- | ------- |
| `firstName`     | `first_name`              | nie     |
| `lastName`      | `last_name`               | nie     |
| `email`         | `email` / `contact_email` | nie     |
| `phone`         | `phone`                   | nie     |
| `company`       | `current_company`         | nie     |
| `jobPosition`   | `job_title`               | nie     |
| `country`       | `location`                | nie     |
| `linkedinUrl`   | `linkedin_url`            | nie     |

Osiem z czternastu pól obowiązkowych. Droga odczytu jest gotowa: RPC
`get_own_profile()` (SECURITY DEFINER, zakres `auth.uid()`, nadany dla
`authenticated`) - dokładnie tak, jak robi to `getJoinUsPrefill`. Powód, dla
którego trzeba iść przez RPC, jest udokumentowany w `joinUsSync.functions.ts:37-38`:
`location` i `phone` to PII bez grantu kolumnowego dla roli `authenticated`.

**Uwaga o precedensie, bo nie jest jednoznaczny.** `JoinUsForm.tsx:286-291`
świadomie rezygnuje z prefillu (`void fetchPrefill;`) - argument brzmi:
widget newslettera ma pokazywać placeholdery i18n, a nie zmuszać do czyszczenia
autouzupełnionych pól. Ten argument nie przenosi się tutaj: tam mowa
o publicznym widgecie marketingowym z 3-8 polami, tu o formularzu za dwiema
bramkami, z czternastoma polami obowiązkowymi, którego wypełnienie zajmuje
kilkanaście minut. **Decyzja jest jednak produktowa, nie techniczna** - jeśli
komisja ma świadomie widzieć dane wpisane „na świeżo", a nie skopiowane
z profilu, brak prefillu jest uzasadniony i wtedy do naprawy zostaje tylko 3.2.
Skutkiem ubocznym obecnego stanu jest to, że `getJoinUsPrefill` to martwy kod -
jedyne jego użycie to `void`.

### 3.2 Brak back-fillu: formularz → profil (WYSOKIE)

Kierunek odwrotny nie ma żadnego uzasadnienia w kodzie ani komentarzu - po
prostu go nie ma. Zgłoszenie zbiera najlepiej zweryfikowany zestaw danych
zawodowych w całym produkcie (kandydat wie, że czyta to komisja) i zostawia go
wyłącznie w `club_applications`. Profil pozostaje pusty.

`join_us_link_and_backfill` pokazuje gotową, bezpieczną semantykę - uzupełnia
**tylko puste** pola i nigdy nie nadpisuje:

```sql
first_name = COALESCE(NULLIF(first_name, ''), NULLIF(_first_name, '')),
…
job_title  = COALESCE(NULLIF(job_title, ''),  NULLIF(_position, '')),
```

Ta sama semantyka zastosowana w `club_apply_submit` (albo w momencie akceptacji -
patrz niżej) domyka lukę siedmioma linijkami. Do rozstrzygnięcia jest **moment**
zapisu, i to jest decyzja produktowa:

- **przy wysłaniu zgłoszenia** - profil rośnie od razu, ale dane niezweryfikowane
  przez komisję trafiają do profilu widocznego w sieci kontaktów;
- **przy akceptacji** (rozdz. 2.1) - do profilu wchodzi tylko to, co komisja
  zaakceptowała; wymaga wykonania back-fillu w `admin_club_application_set_status`
  z `p_status = 'accepted'`.

Rekomendacja: **przy akceptacji**, razem z tworzeniem członkostwa z 2.1 - jedno
przejście „accepted" domyka wtedy trzy rzeczy naraz (członkostwo, profil,
powiadomienie) i pozostaje spójne z tym, że to komisja jest bramką jakości
danych.

### 3.3 Zgoda marketingowa nie dociera do rejestru zgód (ŚREDNIE, RODO)

Formularz zbiera `marketingConsent`. Trafia on do `club_applications` i (próbuje
trafić) do `crm_leads.marketing_consent`. Nie trafia do `user_consents` -
rejestru, który `JoinUsForm` opisuje jako _„jedno źródło prawdy widoczne
w profilu użytkownika"_ i zasila przez `setMyConsent`. Użytkownik, który wyraził
zgodę w zgłoszeniu klubowym, nie zobaczy jej w profilu i nie ma jej gdzie
odwołać. Patrz też 4.2 - na istniejącym leadzie ta zgoda nie zapisuje się nawet
w CRM.

---

## 4. CRM - zapis obok kanonicznej ścieżki

### 4.1 Ominięcie `crm_upsert_from_form` gubi cztery rzeczy (WYSOKIE)

> **Korekta po recenzji (2026-08-11).** Pierwsza wersja tego rozdziału wymieniała
> sześć braków. Dwa z nich - `phone_norm` i przeliczanie scoringu - były
> **błędne** i zostały usunięte; szczegóły i przyczyna pomyłki w ramce
> „Ograniczenie odtworzenia" niżej. Zmieniła się też rekomendacja poprawki:
> samo przejście na `crm_upsert_from_form` **nie** domyka 4.2.

Repozytorium ma kanoniczną funkcję wejścia leada z formularza:
`crm_upsert_from_form` (ostatnia definicja:
`20260706215313…sql:34-99`; `20260708120000_platform_bugfixes_rls.sql` zmienia
już tylko GRANT-y). `club_apply_submit` jej nie woła - pisze surowy
`INSERT … ON CONFLICT` na `crm_leads`. Po naprawie 1.1 zapis zacznie działać, ale
będzie leadem uboższym niż lead z formularza kontaktowego.

Odtworzenie na PostgreSQL 16 (ograniczenie tymczasowo rozszerzone, żeby
instrukcja w ogóle doszła do arbitrażu; lead istniał wcześniej ze źródła
`newsletter`, zgłoszenie z `marketing_consent = true`):

```
 email_norm   | source_type | club_application_count | club_specializations | marketing_consent | source_count | country | linkedin_url
--------------+-------------+------------------------+----------------------+-------------------+--------------+---------+-------------
 x@example.eu | newsletter  |                      1 | {energy,defence}     | f                 |            1 |         |
```

Co działa poprawnie: `club_application_count` inkrementuje się, tablica
`club_specializations` scala się bez duplikatów (sprawdzone trzema kolejnymi
zgłoszeniami tej samej specjalizacji - zostaje jeden wpis), a odwołanie
`public.crm_leads.<kolumna>` w `DO UPDATE` rozwiązuje się prawidłowo.

> **Ograniczenie odtworzenia - warte zapamiętania przy następnym audycie.**
> Powyższa tabela pochodzi z ręcznie odtworzonego `crm_leads`, w którym
> odtworzyłem kolumny i ograniczenie `source_type`, ale **nie triggery**.
> Dlatego puste pole w tym wyniku NIE jest dowodem braku - i na dwóch pozycjach
> wprowadziło mnie w błąd. Realny `crm_leads` ma siedem triggerów, z których dwa
> uzupełniają dane niezależnie od tego, co poda wołający:
> `crm_leads_normalize_trg` (`crm_normalize_lead()`, BEFORE INSERT OR UPDATE, bez
> zawężenia kolumnowego) oraz `crm_leads_sync_phone_norm_trg` (BEFORE INSERT OR
> UPDATE OF phone). Oba wyliczają `phone_norm` z `NEW.phone`. Wnioski o brakach
> poniżej opierają się już na przeglądzie wszystkich triggerów tabeli, nie na
> pustych polach w odtworzeniu.

Czego brakuje w porównaniu z kanoniczną ścieżką:

1. **`country` i `linkedin_url` nie są zapisywane** - formularz je zbiera,
   `crm_leads` ma te kolumny, kanoniczna funkcja je wypełnia, żaden trigger ich
   nie wyprowadza. Dane giną w `club_applications`.
2. **`company_id` nie jest linkowany.** Kanoniczna ścieżka robi upsert
   `crm_companies` i wiąże leada z firmą. Pracodawca kandydata nie pojawia się
   w widoku firm CRM.
3. **`source_count` nie inkrementuje** (widać wyżej: zostaje 1; żaden trigger go
   nie podbija - `trg_crm_leads_counters` rusza wyłącznie licznik tenanta po
   `stage`). Raport „ile punktów styku" zaniża klubowych kandydatów - a to
   najbardziej zaangażowany segment, jaki ten produkt ma.
4. **`aliases` nie jest dopisywany.** Kanoniczna ścieżka gromadzi historię
   (`emails`, `phones`, `companies`, `positions`, `linkedins`, `countries`,
   `sources`). Zmiana pracodawcy między zgłoszeniami przepada.

Nie ma też wpisu w `crm_lead_notes` ani żadnego śladu w timeline - motywacja
i opis ekspertyzy, czyli materiał, po który handlowiec sięgnąłby najpierw,
istnieją wyłącznie w skrzynce klubowej.

**Czego NIE brakuje** (sprawdzone, wbrew pierwszej wersji tego audytu):

- `phone_norm` **jest** wyliczany - dwa triggery wyżej. Klubowy lead jest
  widoczny dla dopasowania po telefonie.
- **Scoring JEST przeliczany.** `trg_score_on_lead_change` (ostatnia definicja
  `20260719083815…sql:655-660`) odpala `compute_crm_lead_score(NEW.id)` po
  `INSERT` oraz po `UPDATE OF email, email_norm, phone, company, position,
linkedin_url, marketing_consent`. Klubowy `DO UPDATE` rusza `phone`, `company`
  i `position`, więc trafia w listę; ścieżka `INSERT` odpala się bezwarunkowo.
  Jawne wołanie `recompute_crm_lead_score` jest zbędne.

**Poprawka - i uwaga, sama podmiana funkcji nie wystarczy.** Kanoniczna
`crm_upsert_from_form` też nie rusza zgody ani źródła: jej lista `SET` obejmuje
`first_name`, `last_name`, `phone`, `phone_norm`, `company`, `position`,
`linkedin_url`, `country`, `company_id`, `aliases`, `source_count` - bez
`marketing_consent` i bez `source_type` - a na ścieżce `INSERT` wpisuje
`marketing_consent` **na stałe `false`** i pomija `source_type`, więc nowy lead
dostaje wartość domyślną kolumny, czyli `'manual'`.

Przejście na nią bez dopełnienia byłoby więc regresem względem intencji z 1.1:
nowy klubowy lead wylądowałby jako `'manual'`, a zgoda przepadałaby na obu
ścieżkach, nie tylko na istniejącym leadzie. Poprawka musi mieć dwa kroki:

1. wołać `crm_upsert_from_form(…)` z `_source = 'club_application'` - po
   deduplikację (także po imieniu i nazwisku), `company_id`, `country`,
   `linkedin_url`, `aliases` i `source_count`;
2. na zwróconym `lead_id` wykonać jawny `UPDATE`, który ustawia trzy kolumny
   klubowe (`club_applied_at`, `club_application_count`,
   `club_specializations`), wpisuje `source_type = 'club_application'` oraz
   **podnosi** `marketing_consent` (`marketing_consent OR _consent` - nigdy
   w drugą stronę, żeby nie zdejmować wycofanej zgody).

Dopiero krok 2 domyka 4.2; krok 1 sam jej nie rusza.

### 4.2 Zgoda i źródło nie aktualizują się na istniejącym leadzie (ŚREDNIE)

`DO UPDATE SET` nie zawiera `marketing_consent` ani `source_type`. Dla kogoś, kto
był już w CRM (a to większość kandydatów - PRO+ znaczy, że wcześniej kupił
subskrypcję), oznacza to:

- **zaznaczona zgoda marketingowa przepada bez śladu** (`marketing_consent = f`
  w wyjściu wyżej, mimo `true` w zgłoszeniu). Nienadpisywanie zgody „w dół" jest
  słuszne; nieodnotowanie zgody udzielonej „w górę" to utrata zgody, którą
  użytkownik świadomie wyraził;
- `source_type` zostaje `newsletter`. Segment „klubowi" po `source_type` będzie
  więc zawierał wyłącznie leady zupełnie nowe - czyli mniejszość. Filtrem
  wiarygodnym pozostaje `club_applied_at IS NOT NULL`, i to jego należy używać
  w raportach (patrz rekomendacja z 1.1).

---

## 5. Progi planu

### 5.1 Bramka zgłoszenia ignoruje własny próg klubu (ŚREDNIE)

`club_capabilities` jest w tym module opisane jako **jedyne** źródło prawdy
o dostępie: _„Każdy RPC modułu woła tę funkcję - żadnej bramki nie pisze się
inline"_ (`…a1_structure.sql:601`). `club_apply_submit` pisze bramkę inline
(`…:96`) i porównuje wyłącznie z globalnym literałem `20`, nie zaglądając
w `clubs.min_tier_rank` wybranego klubu.

Sam próg globalny („zgłoszenia od PRO w górę") jest regułą produktową i może być
świadomy. Problemem jest to, co się dzieje na skrajach:

- klub z `min_tier_rank = 25` (VIP): użytkownik PRO **przechodzi bramkę
  zgłoszenia i może zostać zaakceptowany do klubu, do którego nigdy nie
  wejdzie** - `club_capabilities` odrzuci go z `tier_too_low`. Lista klubów
  w formularzu (`club.apply.tsx:140-149`) nie filtruje po progu, choć
  `club_list_by_specialization` zwraca `min_tier_rank` w każdym wierszu -
  dane na filtr są na miejscu, nikt ich nie używa;
- klub z `min_tier_rank = 10` („Plus"): użytkownik Plus **nie może się zgłosić**
  do klubu, którego próg spełnia. Może natomiast wejść tam wprost przez
  `club_join`. Dwie ścieżki wejścia dają sprzeczne odpowiedzi.

Minimum: odfiltrować z listy kluby o progu wyższym niż ranga użytkownika
(zmiana po stronie klienta, dane już są). Docelowo: `IF v_caps.reason =
'tier_too_low'` z `club_capabilities`, gdy `club_id` jest podany.

Dla porządku - **źródło rangi jest poprawne**. `current_membership_tier()`
w ostatniej redefinicji (`20260729210625…sql`) sumuje trzy źródła uprawnień
(`user_subscriptions`, `membership_grants`, `organization_seats`), więc PRO
z grantu ręcznego albo z seata organizacji przechodzi bramkę na równi z PRO
kupionym. Tu nie ma luki.

### 5.2 Próg `20` żyje w trzech kopiach bez bramki (ŚREDNIE)

Ta sama reguła jest zapisana niezależnie w:

- `…20260811111733:96` - literał `20` w SQL;
- `club.apply.tsx:42` - `const PRO_MIN_RANK = 20`;
- `planTiers.ts:11-14` - `CLUB_PLAN_TIER_RANK.pro = 20`.

Żaden test ani bramka `check:*` nie wiąże tych trzech miejsc. Ranga `pro` jest
dziś w katalogu cenowym rzeczywiście równa 20 (`20260722230000…sql:95`), więc
kopie są zgodne - ale rozjazd po zmianie katalogu będzie cichy: UI wpuści do
formularza, a RPC odrzuci z `pro_required` (albo odwrotnie).

### 5.3 Słownik planów gubi rangi powyżej 25 (NISKIE)

`CLUB_PLAN_TIERS` zna cztery progi: 0 / 10 / 20 / 25. Katalog ma ich więcej -
`supporter` 5, `corporate` 30, `partner` 40, `partner_general` 50,
`presidents_circle` 60. `planTierFromRank()` degraduje w dół i jest to
udokumentowane jako świadome (żeby droplista nie pokazywała pustego pola).

Pułapka jest w zapisie zwrotnym: w `ClubAccessTab.tsx:112-116` `value` idzie
przez `planTierFromRank`, a `onChange` przez `rankFromPlanTier`. Klub z progiem
30 (Enterprise) wyświetla się jako „VIP"; **wybranie w droplistie tej samej
wartości, która już się wyświetla, obniża próg z 30 na 25** i wpuszcza VIP-ów do
klubu zastrzeżonego dla Enterprise. Wymaga dotknięcia listy, więc nie dzieje się
samo - ale wygląda jak brak zmiany. Minimum: nie emitować `onChange`, gdy
wybrany próg równa się wyświetlanemu, albo dopełnić słownik do pełnego katalogu.

---

## 6. RODO

### 6.1 `club_applications` poza eksportem danych (ŚREDNIE)

`club_export_my_data` (`…a23_gdpr_export.sql`) eksportuje siedem zbiorów:
`club_memberships`, `club_threads_authored`, `club_replies_authored`,
`club_stances`, `club_reactions`, `club_thread_subscriptions`,
`club_invitations_received`. `club_applications` nie ma na tej liście - a jest to
**najbogatszy zbiór danych osobowych w całym module**: imię, nazwisko, e-mail,
telefon, pracodawca, stanowisko, seniority, branża, kraj, miasto, LinkedIn, lata
doświadczenia, opis ekspertyzy, motywacja, cele, dostępność, źródło polecenia.
Wniosek o dostęp do danych zwróci komplet aktywności klubowej i pominie
formularz, w którym użytkownik opisał sam siebie.

### 6.2 Brak ścieżki usunięcia/anonimizacji (ŚREDNIE)

W repozytorium są trzy funkcje anonimizujące (`anonymize_payment_orders_for_user`,
`anonymize_user_purchases_for_user`, `anonymize_accounting_evidence_for_user`) -
wszystkie płatnicze. Nie ma funkcji obejmującej `club_applications`. Kolumna
`user_id` nie ma FK do `auth.users` (zgodnie z konwencją repo dla schematu
zarządzanego), więc nie ma też kaskady. Po usunięciu konta wiersz zostaje
w całości, z nazwiskiem, telefonem i pracodawcą, przypisany do nieistniejącego
`user_id`.

---

## 7. i18n i SEO

### 7.1 Skrzynka admina pokazuje wyłącznie polskie nazwy klubów (NISKIE)

`admin_club_applications_list` zwraca `c.name_pl AS club_name` (`…:217`) - jedna
kolumna, bez `name_en`. Reszta modułu konsekwentnie podaje obie i wybiera
w widoku (`row.name_en || row.name_pl`). Admin w EN zobaczy polskie nazwy. Tabela
`club_applications` przechowuje `lang` zgłoszenia, więc język jest w danych -
tylko nie w tym RPC.

### 7.2 Meta na `/club/apply` zapisane na stałe po polsku (NISKIE)

`head()` (`club.apply.tsx:47-63`) zwraca zahardkodowany polski `title`
i `description`, bez wariantu EN i bez `canonical`/`og:locale`. Strony
specjalizacji mają na to warstwę (`specializationHead.ts`,
`specializationSeoCopy`) objętą testem na duplikaty tytułów. Strona
zgłoszeniowa - do której te strony prowadzą - z niej nie korzysta.

---

## 8. Higiena, bramki i pozostałe

### 8.1 Bramka `pg-harness` jest czerwona, nie widzi nowej migracji i nie jest w CI (WYSOKIE, proces)

Uruchomiono `bash scripts/pg-harness/run.sh`. Wynik: **kod wyjścia 1, 59 migracji
OK, 18 FAIL**. Nowa migracja zgłoszeń przewraca się na pierwszej instrukcji:

```
FAIL 20260811111733_14e9070e-d719-450a-a6d3-9768194aa825.sql
     ERROR:  relation "public.crm_leads" does not exist
```

Przyczyna: `harness.sql` nie stubuje `crm_leads` (ani `polls`,
`club_thread_polls`, `site_settings`, schematu `storage`, funkcji
`_caller_tenant`). Harness dobiera migracje po treści (`public.club_`), więc
migrację **widzi** - ale nie ma schematu, na którym mogłaby się wykonać.

To zamyka wyjaśnienie znaleziska 1.1: `runtime_test.sql` (2039 linii asercji)
nie zawiera ani jednej asercji dla `club_apply_submit`, a nawet gdyby zawierał,
nie miałby gdzie jej wykonać. Testy jednostkowe pokrywają wyłącznie czystą
walidację i kopię SEO (`clubApplyAndSpecSeo.test.ts`) - ani jednej linii ścieżki
serwerowej. Bramka `check:db-contract` sprawdza _istnienie_ obiektów, nie
zgodność wartości z ograniczeniami, więc `source_type` był poza jej zasięgiem.

**I tu jest głębsza część problemu: `pg-harness` nie jest w ogóle wpięty w CI.**
`check:pg-harness` nie występuje w ŻADNYM z workflowów w `.github/workflows/`
(sprawdzone: zero trafień). Uruchamia go wyłącznie człowiek, ręcznie, jeśli
pamięta. W CI z bramek bazodanowych stoją `check:sql-migration-replay`
(odtworzenie schematu, bez wykonywania funkcji) i job `pgtap` na `supabase
start` - żadna z nich nie woła `club_apply_submit`.

Poprawka ma więc trzy elementy, nie jeden, i pominięcie któregokolwiek zostawia
lukę otwartą:

1. stub `crm_leads` w `harness.sql` **wraz z ograniczeniem
   `crm_leads_source_type_check`** - bez samego ograniczenia asercja przeszłaby
   na fikcji, czego README harnessu wprost zakazuje
   (_„inaczej test przechodziłby na fikcji"_);
2. asercja w `runtime_test.sql` wołająca `club_apply_submit` na komplecie
   danych i sprawdzająca, że wiersz faktycznie powstał w obu tabelach;
3. **wpięcie `check:pg-harness` do `ci.yml`** - inaczej 1 i 2 istnieją, ale nic
   ich nie wykonuje przed scaleniem.

Pozostałe 17 FAIL to w większości ta sama klasa: zbiór stubów nie dogonił
rosnącej powierzchni zależności modułu. Dwa warto obejrzeć osobno, bo mogą nie
być artefaktem zakresu - `column t.poll_id does not exist` (2×) oraz
`clubs: brak funkcji public.club_thread_view`, gdzie migracja sama zgłasza
brak zależności.

### 8.2 Brak deduplikacji i throttlingu zgłoszeń (ŚREDNIE)

`club_applications` nie ma unikalności na `(user_id, specialization_slug)` ani
warunkowego indeksu na otwarte statusy, a `club_apply_submit` nie sprawdza, czy
zgłoszenie już istnieje, i nie ma żadnego ograniczenia częstości. Ten sam
użytkownik może wysłać dowolną liczbę identycznych zgłoszeń; każde utworzy nowy
wiersz w skrzynce i podbije `club_application_count` w CRM (sprawdzone: trzy
kolejne zgłoszenia → licznik 4). Przy braku widoczności statusu (2.2) i braku
powiadomień (2.1) ponowne wysłanie jest zachowaniem oczekiwanym, nie
nadużyciem - więc skrzynka będzie się zapełniać duplikatami od pierwszego dnia
po naprawie 1.1.

### 8.3 Niezmapowany błąd rzutowania `years_experience` (NISKIE)

`NULLIF(btrim(…'years_experience'), '')::integer` (`…20260811111733:143`) rzutuje bez
zabezpieczenia. Walidacja klienta pilnuje liczby całkowitej 0-70, ale RPC jest
granicą bezpieczeństwa i wołający z Postmana dostanie `invalid input syntax for
type integer`, który wpadnie w `unknown`. Reszta pól jest w tej funkcji
konsekwentnie broniona przez `left(btrim(COALESCE(…)))` - to jedyny wyjątek.

### 8.4 Trasa admina bronna tylko po stronie klienta (informacyjnie, bez wady)

`admin.community.clubs.applications.tsx` sprawdza `isAdmin` w komponencie.
Odczyt danych idzie jednak wyłącznie przez RPC z `assert_admin_tenant()`, więc
warstwa serwerowa trzyma. Zgodne z wzorcem pozostałych tras admina - odnotowane,
by nie wracać do tego przy przeglądzie.

---

## 9. Priorytety

| #   | Znalezisko                                                                               | Waga          | Koszt                        |
| --- | ---------------------------------------------------------------------------------------- | ------------- | ---------------------------- |
| 1.1 | `source_type` łamie CHECK - zgłoszenia nie działają wcale                                | **krytyczne** | 1 migracja                   |
| 8.1 | Harness czerwony, bez stubu `crm_leads`, bez asercji dla nowego RPC i **niewpięty w CI** | wysokie       | stub + asercja + job         |
| 2.1 | „Zaakceptowano" bez członkostwa i bez powiadomienia                                      | wysokie       | RPC + szew                   |
| 3.2 | Brak back-fillu profilu (wzorzec gotowy)                                                 | wysokie       | ~7 linii SQL                 |
| 4.1 | Ominięcie `crm_upsert_from_form` - 4 utracone efekty                                     | wysokie       | przepisanie zapisu (2 kroki) |
| 3.1 | Brak prefillu z profilu (8 z 14 pól) - **decyzja produktowa**                            | wysokie (UX)  | server-fn + `useQuery`       |
| 8.2 | Brak deduplikacji zgłoszeń                                                               | średnie       | indeks + `IF EXISTS`         |
| 5.1 | Bramka ignoruje `min_tier_rank` klubu                                                    | średnie       | filtr + `club_capabilities`  |
| 4.2 | Zgoda i `source_type` nie aktualizują się                                                | średnie       | krok 2 poprawki z 4.1        |
| 6.1 | `club_applications` poza eksportem RODO                                                  | średnie       | 1 zbiór w RPC                |
| 6.2 | Brak anonimizacji przy usunięciu konta                                                   | średnie       | funkcja                      |
| 3.3 | Zgoda marketingowa poza `user_consents`                                                  | średnie       | szew do rejestru             |
| 2.2 | Kandydat nie widzi własnego zgłoszenia                                                   | średnie       | `fetchMy…` + sekcja          |
| 5.2 | Próg `20` w trzech kopiach bez bramki                                                    | średnie       | test parytetu                |
| 5.3 | `planTierFromRank` obniża progi ≥ 30 przy zapisie                                        | niskie        | warunek w `onChange`         |
| 7.1 | Skrzynka admina bez `name_en`                                                            | niskie        | 1 kolumna w RPC              |
| 7.2 | Meta `/club/apply` tylko po polsku                                                       | niskie        | `head()` z i18n              |
| 8.3 | Niezmapowany błąd rzutowania `years_experience`                                          | niskie        | walidacja w RPC              |

Kolejność wykonania: **1.1 przed wszystkim** (bez tego reszta ścieżki nie ma
jak zadziałać), potem 8.1 (żeby 1.1 nie mogło się powtórzyć), potem blok
2.1 + 3.2 jako jedna zmiana w przejściu „accepted", potem 4.1 - pamiętając, że
4.2 domyka dopiero jego DRUGI krok, a nie sama podmiana funkcji. Punkty 3.1 i 3.3
wymagają rozstrzygnięcia produktowego, nie technicznego.
