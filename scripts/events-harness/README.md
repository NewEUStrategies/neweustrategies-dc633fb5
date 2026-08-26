# events-harness — replay modułu Wydarzeń na czystej bazie

## Po co ten harness istnieje

Moduł Wydarzeń to dziesięć migracji (`20260823120000` … `20260823190000`), które
po replayu zostawiają **34 tabele `event_*`, 143 funkcje, 53 polityki RLS,
195 indeksów, 31 triggerów i 6 ograniczeń `EXCLUDE`**.

Do powstania tego harnessu **żadna bramka CI nie wykonywała ani jednej z nich**:

- `check:sql-migration-replay` jest bramką **statyczną** — czyta migracje jako
  tekst;
- `check:pg-harness` (moduł klubów) dobiera migracje po treści `public.club_`
  i `public.admin_club_`, a **żadna migracja Wydarzeń tego nie zawiera**.

Skutek: cały backend modułu mógł się nie wykonać na czystej bazie, a CI tego nie
zauważyłby. Bramki tekstowe z natury nie zobaczą błędu, który ujawnia się
dopiero przy **wykonaniu**: kolizji sygnatur między migracjami, funkcji
odwołującej się do kolumny, której nie ma, triggera, który nigdy nie odpala,
ograniczenia `EXCLUDE`, które nic nie wyklucza, ani polityki RLS przepuszczającej
obcego najemcę.

Harness jest **czwartym** równoległym harnessem w repozytorium i odwzorowuje ten
sam wzorzec:

| harness                      | moduł           | port     |
| ---------------------------- | --------------- | -------- |
| `scripts/pg-harness`         | Discussion Club | 5433     |
| `scripts/careers-harness`    | Rekrutacja      | 5434     |
| `scripts/programs-harness`   | Programy        | 5435     |
| **`scripts/events-harness`** | **Wydarzenia**  | **5436** |

## Co sprawdza

1. **Replay dziesięciu migracji modułu na pustej bazie** — w kolejności
   sortowania po nazwie pliku, czyli dokładnie tej, w której aplikuje je
   Supabase CLI. Każdy błąd wykonania czerwieni bramkę wraz z nazwą pliku
   i numerem linii.
2. **Asercje runtime** na żywym schemacie — pliki `runtime_test.d/NN_*.sql`.
   Obecnie jest tam wyłącznie zestaw dymny `00_smoke.sql`; pliki tematyczne
   dopisują kolejni autorzy (patrz „Jak dodać nowy plik asercji").

## Czego **nie** sprawdza

- **Nie sprawdza kodu frontu** (`src/`) ani wygenerowanych typów — to inne bramki.
- **Nie sprawdza wydajności ani planów zapytań** — baza jest pusta, więc każdy
  pomiar czasu byłby fikcją.
- **Nie odtwarza bazy produkcyjnej.** Cała powierzchnia **poza** modułem jest
  atrapą (`harness.sql`), więc zachowanie klubów, stron, reklam, CRM-u i warstw
  członkostwa **nie jest tu miarodajne**. Atrapy mają kształt, nie zachowanie.
- **Nie sprawdza migracji sprzed modułu** — `20260713093000_events_module.sql`
  i późniejszych łatek na `events`. Te są zastąpione atrapą o dokładnie tym
  kształcie, jakiego moduł potrzebuje.
- **Nie naprawia `scripts/pg-harness`.** Tamta bramka jest czerwona również na
  `origin/main` (migracja `20260822171037` robi `UPDATE public.events SET
min_tier_rank` na atrapie, która tej kolumny nie ma) i jest to osobna sprawa.

## Jak uruchomić lokalnie

```bash
bash scripts/events-harness/run.sh              # migracje + wszystkie asercje
bash scripts/events-harness/run.sh --keep       # zostaw bazę do oglądania
bash scripts/events-harness/run.sh --only 10_   # tylko pliki asercji 10_*
```

Wymaga PostgreSQL 16 (`/usr/lib/postgresql/16/bin`) oraz rozszerzeń `pgcrypto`
i `btree_gist` — te ostatnie są warunkiem założenia sześciu ograniczeń
`EXCLUDE` modułu.

### Równoległość: własny katalog, własny port

Kilku agentów i cztery harnessy mogą pracować jednocześnie, więc katalog
i port są nadpisywalne zmiennymi środowiska:

```bash
EVENTS_HARNESS_DIR=/tmp/moj-events EVENTS_HARNESS_PORT=5499 \
  bash scripts/events-harness/run.sh
```

Domyślnie: katalog `/tmp/nesevents`, port `5436`. Portów **5432, 5433, 5434
i 5435 nie wolno używać** — zajmuje je odpowiednio lokalny PostgreSQL
i trzy pozostałe harnessy.

## Kim jestem w teście (przestawianie aktora)

Funkcje-atrapy uprawnień w `harness.sql` czytają parametry sesji (GUC), żeby
jeden plik asercji mógł udawać po kolei administratora, redaktora, uczestnika
i anonima **bez stawiania bazy od nowa**:

| GUC                     | czyta go                                        | znaczenie                   |
| ----------------------- | ----------------------------------------------- | --------------------------- |
| `request.jwt.claim.sub` | `auth.uid()`                                    | kim jestem; puste = anonim  |
| `nes.tenant`            | `public._caller_tenant()`                       | z jakiej domeny wchodzę     |
| `nes.public_tenant`     | `public.public_tenant_id()`                     | najemca domyślny            |
| `nes.tier_rank`         | `public.has_tier_rank()`, `current_tier_rank()` | ranga warstwy               |
| `nes.tier_features`     | `public.has_tier_feature()`                     | cechy warstwy, po przecinku |

**Role nie są GUC-iem.** `admin`, `editor`, `super_admin` siedzą w prawdziwej
tabeli `public.user_roles`, bo tak działa produkcja — i dzięki temu
`public.has_role()` może być atrapą o zerowej logice własnej.

Zamiast pięciu `SET`-ów rozsypanych po plikach jest jedna funkcja
z `runtime_test.sql`:

```sql
-- administrator najemcy A, warstwa 30, cecha „recordings"
SELECT pg_temp.act_as('a0000000-…-0001',        -- auth.uid()
                      '11111111-…-1111',        -- najemca wołającego
                      30, 'recordings');

SELECT pg_temp.act_as(NULL, NULL);              -- anonim, bez domeny
```

### Dwie pułapki, o których trzeba pamiętać

1. **`act_as` ustawia tożsamość, nie rolę bazodanową.** RLS w PostgreSQL
   **nie obowiązuje superużytkownika**, a harness łączy się jako `postgres`.
   Asercja o politykach musi więc dodatkowo zrobić `SET ROLE authenticated`
   (albo `SET ROLE anon`) i wrócić przez `RESET ROLE`. Bez tego polityki nie
   zostaną nawet policzone, a asercja przejdzie **zawsze**.
2. **Rola nadana w `user_roles` musi mieć profil.** `assert_admin_tenant()`
   czyta najemcę domowego z `public.profiles`, więc aktor bez wiersza w profilach
   dostanie `FORBIDDEN: brak profilu najemcy` — i słusznie, bo tak samo zachowa
   się produkcja.

## Zasada asercji

**Asercja, która nie potrafi być czerwona, jest komentarzem.** Stąd trzy sloty
w `runtime_test.sql`:

| slot                                                 | do czego                                                                                                                                 |
| ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `pg_temp.assert(warunek, etykieta)`                  | zgoda. `NULL` **nie** jest prawdą — `SELECT … = 1` na braku wiersza daje `NULL`, a taka asercja przechodziłaby na pustej bazie           |
| `pg_temp.assert_raises(sql, etykieta)`               | **odmowa** — operacja musi zostać odrzucona                                                                                              |
| `pg_temp.assert_raises_like(sql, wzorzec, etykieta)` | odmowa **z konkretnego powodu**. `assert_raises` przechodzi też wtedy, gdy operacja padła z literówki w teście, a to jest fałszywa zgoda |

Testuj **odmowy tak samo jak zgody**: naruszenie `EXCLUDE`, przekroczenie puli
miejsc, zapis w trybie, który go zabrania, wiersz wskazujący wydarzenie obcego
najemcy.

**Izolacja najemców jest testem, nie obietnicą.** Zaseeduj dwóch najemców,
wykonaj to samo zapytanie jako każdy z nich i sprawdź, że żaden nie widzi ani
jednego wiersza drugiego — plus **kontrapunkt**, że każdy widzi swój własny
wiersz. Bez kontrapunktu test nie odróżnia izolacji od blokady: przy deny-all
obie połowy przechodzą na pustym wyniku. Wzór jest w `runtime_test.d/00_smoke.sql`,
sekcja 4.

## Jak dodać nowy plik asercji

1. Utwórz `runtime_test.d/NN_nazwa.sql` z numeracją:

   | prefiks | zakres                 |
   | ------- | ---------------------- |
   | `00_`   | dym (jest)             |
   | `10_`   | sesje                  |
   | `20_`   | zapisy                 |
   | `30_`   | sponsorzy              |
   | `40_`   | prelegenci (jest)      |
   | `50_`   | obsługa na miejscu     |
   | `60_`   | spotkania              |
   | `70_`   | wejściówki (jest)      |
   | `80_`   | tylko admin (jest)     |
   | `90_`   | strony modułowe (jest) |
   | `95_`   | front publiczny (jest) |

2. Zacznij plik komentarzem mówiącym **po co istnieje** i **czego nie sprawdza** —
   dokładnie jak ten README.
3. **Plik musi być niezależny.** Seeduje sam to, czego potrzebuje, i sam po sobie
   sprząta — najprościej całą treścią w `BEGIN; … ROLLBACK;`. Dzięki temu kilku
   autorów dopisuje pliki bez kolizji i bez zależności od kolejności.
4. **Nic nie trzeba rejestrować.** Listę plików generuje `run.sh` (`ls | sort`)
   do manifestu i podaje go `runtime_test.sql` w zmiennej `:manifest`. Gdyby
   lista siedziała w `runtime_test.sql`, każdy autor edytowałby ten sam wiersz.
5. Uruchom sam swój plik: `bash scripts/events-harness/run.sh --only 30_`.
6. **Sprawdź, że twoja asercja umie być czerwona.** Zepsuj ją celowo, zobacz
   niezerowy kod wyjścia, napraw. Asercja, której nigdy nie widziałeś na
   czerwono, nie jest testem.

## Dobór migracji — dlaczego po treści, a nie po nazwie

```bash
grep -lE 'public\.admin_event_|events_tenant_id_key' supabase/migrations/*.sql | sort -u
```

**10 trafień, dokładnie dziesięć migracji modułu, ani jednego pliku poza
modułem.**

Powód jest ten sam, co opisany w `scripts/pg-harness/run.sh`: **migracja nazwana
losowym UUID-em przez panel Lovable nie zostanie złapana globem** `*event_builder*`,
a może redefiniować funkcję modułu — i wtedy kolizja sygnatur wychodzi dopiero
na produkcji. W module klubów zdarzyło się to realnie (`20260807172345`
redefiniowała trzy funkcje klubowe poza zasięgiem globu).

Selektor jest **alternatywą dwóch wzorców**, bo żaden pojedynczy nie łapie
całego modułu:

- `public.admin_event_` — powierzchnia panelu; łapie 8 z 10 migracji, ale nie
  `20260823135000` (dokłada tylko ograniczenie unikalności na `events`)
  ani `20260823170000` (zaczep frontu, który zamiast RPC panelu wystawia widoki
  publiczne);
- `events_tenant_id_key` — nazwa ograniczenia `UNIQUE (tenant_id, id)`
  z `20260823135000`, na które powołują się złożone klucze obce
  `(tenant_id, event_id)` wszystkich tabel potomnych; to domyka te dwie.

Kolejność aplikowania: **sortowanie po nazwie pliku**, bo tylko ono odtwarza
kolejność Supabase CLI, a więc realny stan końcowy.

Gdy selektor nie wybierze **żadnej** migracji, `run.sh` kończy się błędem.
Zielona bramka na zerze zaaplikowanych migracji byłaby kłamstwem.

## Kod wyjścia musi przeżyć

To najważniejsza lekcja `scripts/pg-harness/run.sh` i tego harnessu nie wolno na
niej przyłapać. Konstrukcja

```bash
if psql … | grep …    # ŹLE
```

bierze kod wyjścia **`grep`-a**, nie `psql`-a — czyli niespełniona asercja tylko
**drukowała się na ekranie**, a bramka raportowała sukces dokładnie wtedy, gdy
powinna być czerwona.

Dlatego tutaj `psql` pisze do pliku, kod wyjścia jest łapany do `rc` przy
wyłączonym `set -e`, a filtrowanie wyjścia dzieje się **dopiero potem, na pliku**.
Sprawdzone eksperymentalnie: celowo niespełniona asercja w `runtime_test.d` daje
`rc=1`, a po jej usunięciu `rc=0`.

## Filozofia atrap (`harness.sql`)

Z atrapy wchodzi **tylko to, czego potrzebuje replay — i ani kolumny więcej**.
Każda nadmiarowa kolumna w atrapie to nieprawda, która kiedyś przejdzie za
prawdę: migracja odwołująca się do kolumny, której na produkcji nie ma,
przeszłaby tu na zielono. Kształty są przepisane z oryginałów wskazanych
w komentarzu przy każdej atrapie.

Dwie decyzje warte zapamiętania:

- **`ad_page_type` nie zawiera wariantu `'event'`.** Dodaje go dopiero
  `20260823170000` (`ALTER TYPE … ADD VALUE IF NOT EXISTS 'event'`, EB-937).
  Gdyby atrapa go zawierała, replay tamtej linijki nie sprawdzałby niczego.
- **Polityki `events` i `event_rsvps` są atrapami obowiązkowymi.** Żadna
  z dziesięciu migracji ich nie tworzy — siedzą w `20260713093000`. Kusi
  zostawić tabelę z włączonym RLS i bez polityk, i to jest pułapka: RLS bez
  polityki znaczy **odmowa wszystkiego**, a polityki tabel **potomnych** modułu
  sprawdzają wydarzenie podzapytaniem `EXISTS (SELECT 1 FROM public.events …)`,
  które biegnie z uprawnieniami wołającego. Deny-all na `events` unieważnia
  więc **każdą** politykę modułu i wszystkie asercje o izolacji przechodzą na
  pustym wyniku.

## Pliki

| plik                                              | rola                                                                                              |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `run.sh`                                          | klaster, atrapy, replay migracji, pętla asercji                                                   |
| `harness.sql`                                     | atrapy powierzchni platformy, której moduł wymaga, a nie tworzy                                   |
| `runtime_test.sql`                                | sloty asercji, przestawianie aktora, pętla po `runtime_test.d`                                    |
| `runtime_test.d/00_smoke.sql`                     | zestaw dymny: schemat, pętla, aktor, izolacja najemców                                            |
| `runtime_test.d/90_module_pages.sql`              | pięć zawsze obecnych stron: zasiew, `event_menu`, idempotencja, odmowa odpięcia, pułapka `STABLE` |
| `runtime_test.d/95_attendees_and_discussions.sql` | lista uczestników i dyskusje: zgoda, Chatham House, klub nieprzypięty                             |
| `README.md`                                       | ten plik                                                                                          |
