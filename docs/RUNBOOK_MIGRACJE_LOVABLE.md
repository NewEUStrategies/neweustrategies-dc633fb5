# Runbook - migracje bazy przez Lovable (jedno źródło prawdy)

Stan: 2026-10-25, PR przełączający dostawę na generator lustra drizzle. Obowiązuje każdą zmianę
schematu, uprawnień (`GRANT`/`REVOKE`), funkcji, wyzwalaczy, polityk RLS i danych referencyjnych
bazy produkcyjnej (Lovable Cloud, wbudowany backend). Dla kogo: autor zmiany (Claude, programista),
właściciel wdrożenia (czat Lovable), recenzent PR, dyżur.

Powiązane:

- reguła migracji w `AGENTS.md` i wiedza projektu Lovable `docs/LOVABLE_WIEDZA_PROJEKTU.md` (§11);
- bramki CI: `check:migration-lanes` (pasy, pokrycie pasa supabase, aktualność lustra),
  `check:migration-immutability` (scalonych plików migracji się nie zmienia, §6.4), a po wdrożeniu
  job `post-deploy` z `check:db-contract` i `check:migration-ledger` (§4.8);
- pomocnik `migrations:deploy-sql`: SQL tylko do odczytu, który pokazuje, co wykona migrator i co
  zapisał (§4.5);
- naprawa `profiles.discoverable` po wpisie 0001: `docs/NAPRAWA_PROFILES_DISCOVERABLE_0001_2026-10-25.md`.

## 1. Model

| Element                                                                                                    | Rola                                                                                                                                        | Kto pisze                             |
| ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| `supabase/migrations/<YYYYMMDDHHMMSS>_<nazwa>.sql`                                                         | JEDYNE źródło prawdy: z niego CI stawia bazę pgTAP i harnessy i liczy bramki `check:sql-*`                                                  | autor, ręcznie                        |
| od wpisu 0399: `drizzle/migrations/NNNN_<nazwa>.sql`, wpis `meta/_journal.json`, `meta/NNNN_snapshot.json` | lustro: pierwsza linia `-- migrations-mirror: supabase/migrations/<plik>`, dalej plik źródłowy bajt w bajt; jedyny kanał SQL-a na produkcję | wyłącznie `bun run migrations:mirror` |
| `drizzle/migrations/NNNN_pr<NR_PR>_deployment_completion.sql`                                              | wyzwalacz wdrożenia: jedna instrukcja bez skutku, `COMMENT ON SCHEMA public IS 'standard public schema';`                                   | narzędzie migracji Lovable            |
| wpisy dziennika 0000-0398 (`JOURNAL_FREEZE_IDX` = 398) i rejestr `MIGRATION_LANES`                         | historia sprzed generatora: bliźniaki pisane ręcznie, kopie i wpisy bota; rejestr decyzji jest zamrożony                                    | nikt - historii się nie zmienia       |
| `drizzle.__drizzle_migrations` (produkcja)                                                                 | rejestr migratora: `hash` = sha256 pliku, `created_at` = `when` wpisu - DOWÓD wdrożenia                                                     | wyłącznie migrator                    |
| `supabase_migrations.schema_migrations` (produkcja)                                                        | drugi rejestr, historyczny; plików z lustrem `check:migration-ledger` w nim nie szuka                                                       | nikt (ręczne dopisywanie zakazane)    |
| `drizzle.config.ts`, `drizzle/schema.ts` (celowo pusty)                                                    | konfiguracja Lovable (`LOVABLE_DB_MIGRATION_URL`)                                                                                           | Lovable; nie ruszać                   |

Gdy właściciel zleca zmianę bazy wprost w czacie Lovable, agent postępuje jak autor (§3), a jego
wyzwalacz nazywa się `lovable_<YYYYMMDD>_deployment_completion`.

Trzy fakty, na których stoi model (dokumentacja Lovable, stan 2026-10-25):

1. Pliki przychodzące przez Git same się nie wykonują: „Lovable does not run migration files that
   you add through Git" (docs.lovable.dev/integrations/git-sync-overview). Scalenie PR-a do `main`
   NIE wdraża bazy.
2. Lovable zmienia schemat swoim narzędziem migracji, które zapisuje plik w `drizzle/migrations/`
   i stosuje go migratorem Drizzle: „Lovable uses Drizzle ... to create and apply these files",
   „Lovable maintains the drizzle folder, including drizzle/schema.ts, and the drizzle.config.ts
   file ... so leave them as they are" (docs.lovable.dev/features/database; changelog 2026-10-07
   „Cloud database changes are now recorded as Drizzle migrations"). Migrator stosuje przy tym
   WSZYSTKIE oczekujące wpisy dziennika - także nasze lustra. To jedyna droga, którą wdrażamy.
3. Wszystko, co trafia do bazy inną drogą (edytor SQL, `run_sql` agenta, ręczny wpis do rejestru),
   nie zostawia w repozytorium dowodu treści. Tak powstały znane rozjazdy (§10).

## 2. Mechanika migratora (drizzle-orm 0.45.2, `pg-core/dialect.js`, `migrate()`)

1. Zakłada (jeśli brak) schemat `drizzle` i tabelę
   `drizzle.__drizzle_migrations (id serial, hash text, created_at bigint)`.
2. Czyta JEDEN wiersz: `ORDER BY created_at DESC LIMIT 1`; jego `created_at` to `L`.
3. W JEDNEJ transakcji przechodzi `_journal.json` w kolejności wpisów i wykonuje każdy wpis
   o `when > L`; po każdym zapisuje `(sha256(treść pliku), when)`. Plik dzieli na instrukcje
   wyłącznie po znaczniku `--> statement-breakpoint`.
4. Błąd dowolnej instrukcji wycofuje całą partię: schemat i rejestr zostają jak przed
   uruchomieniem. Brak pliku wpisu wywraca migrator przed startem.

Wnioski:

- **`when` rośnie ściśle, a wpis poniżej progu przepada po cichu.** Wpis z `when <= L` nie wykona
  się nigdy i nikt tego nie zgłosi. Generator nadaje pierwszemu nowemu wpisowi `when` równe
  maksimum dziennika plus 60 s, a każdemu następnemu o 60 s więcej. Robi to deterministycznie, żeby
  `--check` w CI powtarzał dokładnie zapis, więc zna tylko dziennik `main`, nie rejestr produkcji. Gdy
  produkcja ma zapis późniejszy niż maksimum dziennika `main` (wpis bota, którego commit nie trafił
  na `main`; przywrócona kopia bazy, §7), nasze wpisy zostaną pominięte bez błędu. Dlatego przed
  KAŻDYM wdrożeniem `bun run migrations:deploy-sql -- --pending --from <OD>` jest obowiązkowy
  (§4.2 krok 2). Status `POMINIETY: when nie wiekszy od ostatniego zapisu` = stop i eskalacja do
  właściciela: narzędzia do przesunięcia `when` jeszcze nie ma (przyjdzie osobnym PR-em), a ręczna
  zmiana `when` jest zakazana (§4.7). `check:migration-lanes` czerwieni malejące `when`
  w dzienniku; historyczne miejsca z malejącym `when`: `0062`-`0064` i `0114`-`0115`
  (`KNOWN_NON_MONOTONIC_JOURNAL`).
- **`when` nie leży w przyszłości.** Narzędzie Lovable nadaje swojemu wpisowi `when` = chwilę
  wdrożenia. Gdyby wpis generatora wypadł później, następny wpis bota zostałby pominięty;
  generator odmawia wtedy zapisu (`when-w-przyszlosci`) i podaje, po ilu sekundach uruchomić go
  ponownie.
- **Partia = jedna transakcja.** Blokada ACCESS EXCLUSIVE z `ALTER TABLE` trwa do końca CAŁEJ
  partii. `SET` na najwyższym poziomie pliku (np. `SET lock_timeout = '5s'` w `20261025090020`)
  obowiązuje także w kolejnych plikach tej partii - generator zgłasza to ostrzeżeniem
  `ustawienie-sesji`, a autor potwierdza w PR, że to zamierzone. Nowej wartości z
  `ALTER TYPE ... ADD VALUE` nie użyje żaden wpis tej samej partii (`enum-nowa-wartosc`). Duża
  partia na gorących tabelach = okno nocne.
- **Hash = sha256 treści pliku.** Edycja pliku po wdrożeniu nie zmienia bazy, a `--verify` pokaże
  „inny hash". Lustra wpisu zapisanego w rejestrze produkcji nie zmienia się nigdy (jedyny wyjątek,
  dla wpisu niezapisanego: §6.3); pilnuje tego `check:migration-immutability` (§6.4).

## 3. Ścieżka autora (Claude, programista)

1. Napisz `supabase/migrations/<YYYYMMDDHHMMSS>_<nazwa>.sql` (UTC, wersja późniejsza niż każdy plik
   niesiony już przez dziennik - inaczej `wersja-wsteczna`). SQL bezpieczny do ponownego
   wykonania: `CREATE OR REPLACE`, `IF NOT EXISTS`, `DROP ... IF EXISTS` przed `CREATE`,
   `ADD CONSTRAINT` w bloku `DO ... EXCEPTION WHEN duplicate_object`, granty bez założeń o stanie -
   produkcja bywa w dryfie, a jeden błąd wycofuje całą partię. Literalne nazwy RPC/tabel
   i pasujące granty (`AGENTS.md`). Bez `COMMIT`, `CONCURRENTLY` i `VACUUM` (partia to jedna
   transakcja) i bez tekstu `--> statement-breakpoint`. Lustro (nagłówek + plik) mieści się
   w 46 080 B (45 KiB); większy plik tnie
   `bun run scripts/split-migration.ts supabase/migrations/<plik>.sql`.
2. `bun run migrations:mirror`: lustro, wpis dziennika i snapshot (§3.2). Wyniku nie poprawiasz
   ręcznie: zła treść = popraw plik supabase i uruchom generator ponownie.
3. `bun run generate:authz-snapshot` (snapshot liczy pliki migracji).
4. Lokalnie: `bun run check:migration-lanes` (pasy, pokrycie i aktualność lustra),
   `bun run check:migration-immutability`, `bun run typecheck`, testy pgTAP/harness modułu; plik
   wykonany dwa razy na lokalnej bazie nie zmienia stanu.
5. W opisie PR sekcja „Wdrożenie bazy" (§3.1) z linią wypisaną przez generator.
6. Po każdym `git merge origin/main`: `bun run migrations:mirror`, potem
   `bun run check:migration-lanes` (bot mógł dopisać wpis na `main`; konflikt: §3.3). Ostatni raz
   tuż przed scaleniem.

Nie wolno:

- tworzyć ani edytować plików w `drizzle/` (także `meta/`), zmieniać `idx` ani `when`;
- dzielić lustra: dla nowej migracji `scripts/split-migration.ts` tnie wyłącznie plik supabase,
  a lustra części generuje `migrations:mirror` (ścieżka `--drizzle <tag>` tego skryptu dotyczy
  tylko bliźniaków sprzed zamrożenia dziennika);
- dopisywać wpisów do `MIGRATION_LANES` (rejestr zamrożony na wpisie 398) ani nowych plików do
  `reconciled` w `supabase/migration-ledger.json`;
- zmieniać ani usuwać scalonych plików migracji w żadnym pasie (§6.4).

### 3.1 Szablon sekcji „Wdrożenie bazy" w opisie PR

Pierwszą linię kopiujesz z wyjścia `bun run migrations:mirror` (zapis albo `--dry-run`).

```markdown
## Wdrożenie bazy

- Wpisy dziennika do wdrożenia: idx <OD>-<DO> (<tag>, ...)
- Kolejność z frontem: migracja przed publikacją | publikacja przed migracją | dowolna - dlaczego: ...
- Okno: dowolne | nocne - gorące tabele: ...
- Zmiana danych użytkowników: brak | jaka i w którym pliku
- Zależność od danych produkcji: brak | zapytanie kontrolne (tylko odczyt): ...
- Zmiany niekompatybilne wstecz (DROP/RENAME tabeli lub kolumny, zmiana typu, NOT NULL bez DEFAULT): brak | lista
- Ostrzeżenia generatora (ustawienie-sesji, enum-nowa-wartosc): brak | lista i uzasadnienie
- Kontrole przed wyzwoleniem (tylko odczyt): bun run migrations:deploy-sql -- --pending --from <OD> | dodatkowe zapytania
- Polecenie dla Lovable: docs/RUNBOOK_MIGRACJE_LOVABLE.md §4.2, NR_PR=<NR>, OD=<OD>, DO=<DO>
```

### 3.2 Generator lustra: polecenie, kody wyjścia, komunikaty

`bun run migrations:mirror [--check | --dry-run] [--base <ref> | --no-base] [--rewrite <tag>]...`

- bez opcji (zapis): dopisuje lustra nowych plików supabase - dokładnie tych, które bramka pokrycia
  zgłasza jako `brak-kopii-drizzle`; pliku z wpisem w `SUPABASE_LANE_GAPS` (zestawienie albo
  `appliedOutOfBand`) nie wysyła nigdy. Przepisuje lustra lokalne gałęzi (spoza `origin/main`),
  usuwa osierocone pliki generatora i wypisuje linię do §3.1;
- `--dry-run`: plan bez zapisu; `--check`: kod 1, gdy zapis cokolwiek by zmienił (tak sprawdza CI
  w `check:migration-lanes`);
- `--base <ref>` / `--no-base`: dziennik bazy dla luster lokalnych (domyślnie `origin/main`, potem
  `main`; bez bazy generator tylko dopisuje);
- `--rewrite <tag>`: wyłącznie przypadek z §6.3.

Kody wyjścia: 0 - plan wykonany albo lustro aktualne; 1 - błędy planu albo (z `--check`) lustro
nieaktualne; 2 - złe argumenty albo nieczytelny `--base`.

Błędy - generator niczego nie zapisze, dopóki są:

| Komunikat                                                         | Przyczyna                                                                                                                                                            | Co robisz                                                                   |
| ----------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `poza-transakcja`                                                 | `BEGIN`/`COMMIT`, `CONCURRENTLY` (indeksy, `REINDEX`, `DETACH PARTITION`), `VACUUM`, `ALTER SYSTEM`, `CREATE`/`DROP DATABASE` albo `TABLESPACE`, `DISCARD ALL`       | zapisz zmianę bez tej instrukcji                                            |
| `znacznik-breakpoint`                                             | napis `--> statement-breakpoint` gdziekolwiek w pliku (migrator tnie tam zawsze, także w komentarzu i literale)                                                      | usuń napis                                                                  |
| `za-duzy`                                                         | lustro (nagłówek + plik) ponad 46 080 B                                                                                                                              | potnij plik: `bun run scripts/split-migration.ts <plik>`                    |
| `pusty-sql`, `sql-nieczytelny`, `nazwa-zrodla`                    | same komentarze; błąd leksera (np. polecenie psql); nazwa spoza `[A-Za-z0-9_.-]`                                                                                     | popraw plik albo nazwę (`git mv`)                                           |
| `wersja-wsteczna`                                                 | wersja nie późniejsza niż najnowszy plik niesiony przez dziennik (produkcja wykonałaby go po nim, pgTAP przed nim)                                                   | gotowe `git mv` z komunikatu                                                |
| `when-w-przyszlosci`                                              | `when` nowego wpisu wypada po chwili uruchomienia                                                                                                                    | uruchom ponownie po podanym czasie                                          |
| `zrodlo-rozjechane`                                               | zmieniony SQL wykonywalny źródła lustra, które jest już na `main`                                                                                                    | cofnij zmianę i dodaj NOWĄ migrację (wyjątek: §6.3)                         |
| `zrodlo-brak`, `brak-pliku-wpisu`                                 | usunięte źródło lustra albo plik wpisu dziennika (np. rewert bota)                                                                                                   | przywróć plik z historii gita; nigdy nie generuj go od nowa (druga dostawa) |
| `przepisanie-niedozwolone`                                        | `--rewrite` dla tagu spoza dziennika albo wpisu bez nagłówka generatora                                                                                              | wpis bota się adoptuje (§5)                                                 |
| `dziennik-ksztalt`, `wpis-bazy-zmieniony`, `lokalne-nie-na-koncu` | dziennik po złym rozwiązaniu konfliktu albo ręcznej przeróbce                                                                                                        | §3.3                                                                        |
| `snapshot-kolizja`, `snapshot-uszkodzony`                         | dwa snapshoty z tym samym `id`/`prevId` albo obcy plik w `meta/` - drizzle-kit `generate` (narzędzie Lovable) kończy się wtedy po cichu kodem 0 i niczego nie tworzy | §3.3                                                                        |

Ostrzeżenia (zapis przechodzi): `ustawienie-sesji` (§2), `enum-nowa-wartosc` (wdróż ten plik
osobnym uruchomieniem migratora, przed wpisami, które używają nowej wartości),
`przepisanie-zbedne` (`--rewrite` nie było potrzebne).

### 3.3 Konflikt dziennika po `git merge origin/main`

Gdy bot Lovable dopisał wpis na `main` (zwykle wyzwalacz wdrożenia), gałąź z własnymi lustrami
dostaje konflikt w `_journal.json` i `meta/NNNN_snapshot.json`. Naprawa (generator i bramka
wypisują ją same):

```bash
git checkout origin/main -- drizzle/migrations/meta && bun run migrations:mirror
git add drizzle && git commit
```

Generator usuwa osierocone lustra gałęzi i generuje je od nowa za wpisami `main` (kolejny `idx`
i `when`); linia „Wpisy dziennika do wdrożenia" w opisie PR dostaje wtedy nowy zakres. Nigdy
`merge=union` dla dziennika w `.gitattributes` (podwójne `idx` bez konfliktu) i nigdy ręczne
przenumerowanie. Jeśli `main` zyskał wpis po 0398, który nie jest kopią pliku supabase,
kanonicznym wyzwalaczem ani wpisem z samych `COMMENT ON`, `check:migration-lanes` zgłasza
`wpis-spoza-zrodla` - ten wpis adoptujesz w tym samym PR (§5), inaczej `main` będzie czerwony od
scalenia.

## 4. Wdrożenie po scaleniu (właściciel, czat Lovable)

### 4.1 Warunki wstępne

- PR scalony, `Required release checks` zielone na commicie scalenia.
- Migrator wykona WSZYSTKIE oczekujące wpisy `main`, nie tylko te z PR. Dwa scalone i niewdrożone
  PR-y wdrażasz jednym poleceniem: OD = najmniejszy, DO = największy idx, zasady z obu sekcji
  „Wdrożenie bazy". Brak oczekujących wpisów = nie wywołuj narzędzia (dodałoby tylko zbędny
  wyzwalacz).
- Okno z opisu PR. Gorące tabele, zmiana danych użytkowników albo pierwsze wdrożenie po
  przełączeniu (§9): najpierw eksport bazy (More → Database → Manage → Settings → Export data).
  Kopia dzienna cofa całą bazę o dobę (§7).
- Kontrole tylko do odczytu z sekcji „Wdrożenie bazy" wykonane, wynik zgodny z oczekiwanym.
- PR deklaruje zmianę niekompatybilną wstecz: na czas wdrożenia przestaw „Execute backward
  incompatible database migrations" z domyślnego „Never allow" na „Ask each time", zatwierdź
  wyłącznie SQL zgodny z lustrem z PR i wróć do „Never allow". Dokumentacja Lovable nie mówi, czy
  ta kontrola obejmuje oczekujące pliki dziennika - pierwszą linią są nasze bramki CI.

### 4.2 Polecenie do wklejenia w czacie Lovable

To polecenie zastępuje dawne czterolinijkowe pytanie „Czy Merge pull request ... został w pełni
zintegrowany" (§10). Podstaw `<NR_PR>`, `<OD>`, `<DO>` z sekcji „Wdrożenie bazy" opisu PR
i `<KOLEJNOŚĆ>` (np. „po migracji").

```text
Wdrożenie bazy po scaleniu PR #<NR_PR>: wpisy dziennika drizzle idx <OD>-<DO>.

Zasady tego zadania (bez wyjątków):
- Źródłem prawdy jest supabase/migrations. Wpisy drizzle/migrations <OD>-<DO> to wygenerowane lustra: nie edytuj ich, nie przepisuj, nie dziel, nie generuj na nowo i nie twórz nowych migracji z ich treścią.
- Migracje wykonuje wyłącznie migrator Drizzle uruchomiony Twoim narzędziem migracji bazy. Nie wykonuj DDL ani zapisów przez SQL/run_sql, nie uruchamiaj drizzle-kit (push, generate, migrate, drop).
- Nie zapisuj niczego do drizzle.__drizzle_migrations ani do supabase_migrations.schema_migrations.
- Nie zmieniaj i nie usuwaj plików w supabase/migrations, drizzle/ (poza wpisem, który utworzy narzędzie w kroku 3), src/lib/ci/ ani src/lib/migrations/.

Kroki:
1. Potwierdź, że merge PR #<NR_PR> i wszystkie jego commity są przodkami HEAD (gdy w piaskownicy brakuje zależności, najpierw bun install).
2. Uruchom `bun run migrations:deploy-sql -- --pending --from <OD>` i wykonaj wypisane zapytanie narzędziem tylko do odczytu. Wymagane: wpisy <OD>-<DO> mają status „zostanie wykonany", żaden inny wpis go nie ma, nie ma statusów „POMINIETY: when nie wiekszy od ostatniego zapisu" ani „INNY HASH W REJESTRZE". Inaczej przerwij i pokaż wynik.
3. Wywołaj narzędzie migracji bazy DOKŁADNIE RAZ: nazwa `pr<NR_PR>_deployment_completion`, treść (jedna linia, bez zmian):
COMMENT ON SCHEMA public IS 'standard public schema';
To wyzwalacz bez skutku: migrator Drizzle wykona przy nim oczekujące wpisy <OD>-<DO> w jednej transakcji. Nie dopisuj tego wpisu do MIGRATION_LANES.
4. Błąd migratora: przerwij, niczego nie poprawiaj, podaj SQLSTATE, komunikat i plik. Tylko przy 55P03, 40P01 albo 57014 wolno ponowić krok 3, najwyżej dwa razy.
5. Po sukcesie uruchom `bun run migrations:deploy-sql -- --verify --from <OD>` i wynik wykonaj tylko do odczytu - ma zwrócić 0 wierszy (wiersz „brak w rejestrze" albo „inny hash" = raport). Potem `bun run check:migration-lanes`, `bun run check:db-contract` i `bun run check:migration-ledger`; pokaż ostatnie linie każdego.
6. Sprawdź, że tabele, widoki i RPC z PR #<NR_PR> istnieją, a ich strony działają bez błędów JS. Opublikuj front <KOLEJNOŚĆ>.
7. Raport: zastosowane wpisy (idx, tag), wyniki kroków 2 i 5, commit z wyzwalaczem. Poza wpisami wykonanymi przez migrator nie zmieniaj danych w bazie.
```

### 4.3 Co bot zatwierdzi na `main`

Commit `gpt-engineer-app[bot]` (zwykle „Changes") z:

- `drizzle/migrations/NNNN_pr<NR>_deployment_completion.sql` (jedna linia), `meta/NNNN_snapshot.json`
  i wpisem w `_journal.json` (`when` = chwila wdrożenia). Bramka pasów rozpoznaje kanoniczny
  wyzwalacz bez wpisu w rejestrze; wpis `MIGRATION_LANES` dopisany przez bota daje tylko
  ostrzeżenie „zbędny wpis" - usuwa go następny PR;
- `src/integrations/supabase/types.ts` przegenerowanym z produkcji;
- zwykle `roadmap.md` (raport bota).

Nic poza tym. Każda inna zmiana w `supabase/migrations/`, `drizzle/`, `src/lib/ci/` albo
`src/lib/migrations/` to naruszenie procedury: `check:migration-lanes` albo
`check:migration-immutability` na `main` robi się czerwony, a następny PR zmianę adoptuje albo
cofa (§5).

### 4.4 Weryfikacja (każde wdrożenie)

| #   | Kto        | Co                                                                              | Oczekiwane                                                                       |
| --- | ---------- | ------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| 1   | Lovable    | `bun run migrations:deploy-sql -- --verify --from <OD>`, wynik tylko do odczytu | 0 wierszy                                                                        |
| 2   | Lovable    | `check:migration-lanes`, `check:db-contract`, `check:migration-ledger`          | zielone                                                                          |
| 3   | właściciel | edytor SQL (More → Database → Manage → SQL editor), zapytanie z §4.5            | górny wiersz = wyzwalacz tego wdrożenia                                          |
| 4   | właściciel | GitHub Actions → przebieg CI commita bota → job `post-deploy`                   | zielony; ostrzeżenie o braku `SUPABASE_URL` = brak zmiennych repozytorium (§4.8) |
| 5   | recenzent  | diff `src/integrations/supabase/types.ts` w commicie bota                       | tylko obiekty z PR; inne zmiany = dryf produkcji do wyjaśnienia                  |
| 6   | właściciel | funkcja z PR na produkcji po publikacji                                         | działa                                                                           |

Zielony PR potwierdza kod, nie stan bazy. Wdrożenie potwierdzają dopiero wiersze 1-4, a dowodem
jest wiersz 1: każdy wpis zakresu zapisany przez migrator z hashem pliku z repozytorium.
Automatyczny dowód z rejestru migratora w jobie `post-deploy` przyjdzie osobnym PR-em; do tego
czasu jest nim ręczne `--verify`.

### 4.5 Zapytania i statusy tylko do odczytu

`bun run migrations:deploy-sql -- (--pending|--verify) --from <idx> [--to <idx>]` wypisuje jedno
zapytanie `SELECT` (do edytora SQL albo narzędzia odczytu agenta) i nie łączy się z bazą. Kod 0 -
SQL wypisany; 1 - problem z dziennikiem albo zakresem (zakres spoza dziennika to błąd: uruchamiaj na
aktualnym `main`); 2 - złe argumenty. Jedno zapytanie mieści najwyżej 400 wpisów - podawaj zakres
wdrożenia, nie `--from 0`.

| Tryb        | Wynik                                              | Znaczenie                                                                              | Co robisz                                                         |
| ----------- | -------------------------------------------------- | -------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `--pending` | `juz zastosowany`                                  | wpis zapisany w rejestrze z hashem pliku z repozytorium                                | nic                                                               |
| `--pending` | `INNY HASH W REJESTRZE`                            | rejestr ma zapis o tym `when`, ale z innym hashem (plik zmieniony po wdrożeniu)        | stop, raport, stan produkcji (§5.2)                               |
| `--pending` | `zostanie wykonany`                                | migrator wykona wpis przy najbliższym wyzwalaczu                                       | dozwolone wyłącznie dla wpisów OD-DO                              |
| `--pending` | `POMINIETY: when nie wiekszy od ostatniego zapisu` | migrator pominie wpis po cichu (produkcja ma zapis późniejszy niż dziennik `main`, §2) | stop, eskalacja do właściciela; niczego nie wdrażasz              |
| `--verify`  | `brak w rejestrze`                                 | migrator nie zapisał wpisu                                                             | po wdrożeniu: raport; przed `--rewrite`: warunek konieczny (§6.3) |
| `--verify`  | `inny hash`                                        | jak `INNY HASH W REJESTRZE`                                                            | stop, raport                                                      |
| `--verify`  | 0 wierszy                                          | każdy wpis zakresu zapisany z hashem pliku z repozytorium                              | wdrożenie potwierdzone                                            |

```sql
-- Ostatnie zapisy migratora. Górny wiersz: wyzwalacz tego wdrożenia,
-- created_at = jego `when` z drizzle/migrations/meta/_journal.json.
SELECT id, created_at, to_timestamp(created_at / 1000.0) AT TIME ZONE 'UTC' AS utc, left(hash, 12) AS hash12
  FROM drizzle.__drizzle_migrations
 ORDER BY created_at DESC
 LIMIT 10;
```

```sql
-- Punkt odniesienia L przed wdrożeniem; pełne zapytanie wypisuje
-- `bun run migrations:deploy-sql -- --pending --from <OD>`.
SELECT COALESCE(max(created_at), 0) AS ostatni_zapis FROM drizzle.__drizzle_migrations;
```

```sql
-- Przykład kontroli uprawnień obiektu z PR (podstaw sygnaturę z PR).
SELECT has_function_privilege('anon', 'public.<funkcja>(<typy>)', 'EXECUTE') AS anon,
       has_function_privilege('authenticated', 'public.<funkcja>(<typy>)', 'EXECUTE') AS authenticated,
       has_function_privilege('service_role', 'public.<funkcja>(<typy>)', 'EXECUTE') AS service_role;
```

### 4.6 Gdy migrator zgłosi błąd

- Partia jest wycofana w całości. Potwierdź zapytaniem z §4.5: górny wiersz bez zmian.
- Lovable przerywa i podaje SQLSTATE, komunikat i plik. Nie poprawia plików i nie wykonuje SQL-a
  ręcznie (tak powstały rozjazdy 0311 i 0367, §10).
- Błąd przejściowy (`55P03` lock_timeout, `40P01` deadlock, `57014` statement_timeout): ponów
  polecenie z §4.2 później, w oknie nocnym, najwyżej dwa razy.
- Każdy inny błąd (`42703`, `42P07`, `42710`, `23505`, `23514`, `42883`, `2BP01` ...) to dryf
  produkcji albo błąd migracji. Poprawka idzie PR-em: stan produkcji ustalasz zapytaniami tylko do
  odczytu, poprawiasz NIEWDROŻONY plik supabase i jego lustro przez
  `bun run migrations:mirror --rewrite <tag>` (§6.3), CI, scalenie, ponowne §4.2. Nowa migracja
  tu nie pomoże: stanęłaby w dzienniku ZA wpisem, który pada.

### 4.7 Czego nie robi nikt

- `drizzle-kit push`, `generate`, `migrate`, `drop` uruchamiane ręcznie (`drizzle/schema.ts` jest
  pusty: porównanie z nim nie opisuje naszego schematu).
- DDL albo migracja wykonana poza migratorem: edytor SQL, `run_sql` agenta. Zapis danych tylko na
  wyraźne polecenie właściciela, z pokazanym zapytaniem.
- `INSERT`/`UPDATE`/`DELETE` w `drizzle.__drizzle_migrations`
  i `supabase_migrations.schema_migrations`, także jako „uzupełnienie rejestru".
- Edycja, usunięcie albo przenumerowanie pliku w `drizzle/` albo `supabase/migrations/`, wpisu
  `_journal.json` albo snapshotu; zmiana `when`. Jedyny wyjątek to §6.3, zawsze PR-em.
- Wpisy w `MIGRATION_LANES` (zamrożony) i w `MIGRATION_EDIT_ALLOWLIST` bez przeglądu PR.
- Przepisywanie migracji z `supabase/migrations` na nowe wpisy narzędziem migracji (dawna faza A:
  kopie, części, sklejki, zdjęte komentarze, podwójne wykonania).
- Cofnięcie wersji projektu w Lovable jako „cofnięcie migracji": „Reverting restores your
  project's code only ... does not restore or roll back your database data"
  (docs.lovable.dev/features/projects/history).

### 4.8 Dowód z CI: zmienne repozytorium, nie sekrety

Job `post-deploy` w `.github/workflows/ci.yml` (push na `main` albo `workflow_dispatch`, po
`Required release checks`) uruchamia `bun run check:db-contract` i `bun run check:migration-ledger`
kluczem publikowalnym. Adres czyta w kolejności `secrets.SUPABASE_URL`,
`secrets.VITE_SUPABASE_URL`, `vars.SUPABASE_URL`, `vars.VITE_SUPABASE_URL`, a klucz tak samo
(`SUPABASE_PUBLISHABLE_KEY`, potem `VITE_SUPABASE_PUBLISHABLE_KEY`). Bez nich kończy się
ostrzeżeniem i niczego nie sprawdza.

Ustaw ZMIENNE repozytorium (GitHub → Settings → Secrets and variables → Actions → zakładka
Variables): `SUPABASE_URL` i `SUPABASE_PUBLISHABLE_KEY` - adres projektu i klucz publikowalny, ten
sam, który i tak trafia do przeglądarki.

Nigdy nie twórz SEKRETÓW repozytorium o nazwach `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`,
`VITE_SUPABASE_URL` ani `VITE_SUPABASE_PUBLISHABLE_KEY`. Te kroki czytają wyłącznie sekrety
o tych nazwach, a gdy sekretu nie ma - zaślepkę `https://placeholder.supabase.co` /
`placeholder-anon-key`:

- `ci.yml`, job `build`: kroki „Build", „Build production artifact for a node server (smoke
  preset)" i „Boot test and first-load timing on the production artifact";
- `e2e.yml`, job `e2e`: krok „Run E2E (Playwright)";
- `lighthouse.yml`: kroki „Build production artifact for a node server (smoke preset)" i „Start
  the production artifact and warm it with a Chrome UA".

Sekret o tej nazwie przełączyłby je z zaślepki na produkcyjny backend: build wbudowałby adres
produkcji w artefakt CI, a testy e2e i pomiary chodziłyby po prawdziwej bazie, zależne od jej
danych i z ruchem na produkcji. Zmiennych (`vars.*`) te kroki nie czytają, więc zmienna nie zmienia
niczego poza `post-deploy`. Dopóki Lovable pushuje na `main` bezpośrednio, ani `post-deploy`, ani
`Required release checks` nie są wymaganymi statusami `main`.

## 5. Bot Lovable zmienił schemat sam - adopcja

### 5.1 Jak to wykryć

- Commit `gpt-engineer-app[bot]` dodaje do `drizzle/migrations/` plik inny niż kanoniczny
  wyzwalacz albo zmienia lub usuwa istniejący plik w `drizzle/` lub `supabase/migrations/`.
- `check:migration-lanes` na `main` czerwony: `wpis-spoza-zrodla` (wpis po 0398, który nie jest ani
  lustrem albo kopią pliku supabase, ani kanonicznym wyzwalaczem, ani wpisem z samych `COMMENT ON`)
  albo `rejestr-zamrozony` (bot dopisał do `MIGRATION_LANES` decyzję dla takiego wpisu). Wpis z samych
  `COMMENT ON` (jak 0398) przechodzi z ostrzeżeniem: komentarz na produkcji różni się wtedy od
  pasa supabase.
- `check:migration-immutability` na `main` czerwony: scalony plik migracji zniknął albo się
  zmienił, wpis dziennika zmieniono albo usunięto (§6.4).
- Raport bota w `roadmap.md` mówi o „naprawie dryfu", „dodaniu kolumny", „migracji".

### 5.2 Ustal stan produkcji (tylko odczyt)

`bun run migrations:deploy-sql -- --verify --from <idx> --to <idx>`: 0 wierszy = migrator zapisał
wpis z hashem pliku z repozytorium. Do tego katalog (`information_schema`, `pg_proc`,
`pg_indexes`, `has_*_privilege`) dla obiektów z wpisu. Sprawdź też, czy późniejsza migracja nie
nadpisała zmiany bota - adoptujesz STAN KOŃCOWY produkcji, nie historię.

### 5.3 Klasyfikacja

| Klasa                                        | Przykład                                                                                            | Decyzja                                                                                                                          |
| -------------------------------------------- | --------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| kanoniczny wyzwalacz                         | `COMMENT ON SCHEMA public IS 'standard public schema';`, tag `NNNN_pr<NR_PR>_deployment_completion` | nic - bramka rozpoznaje sama                                                                                                     |
| wyzwalacz z inną treścią (same `COMMENT ON`) | 0329, 0346, 0398 (komentarze tabel i funkcji)                                                       | przechodzi z ostrzeżeniem; ten sam komentarz w pasie supabase: adopcja wg §5.4 pkt 1                                             |
| zmiana schematu do zachowania                | 0148 (8 kolumn `admin_event_speakers_list`), 0392 (indeks `membership_grants_tenant_coupon_idx`)    | ADOPCJA (§5.4); te dwie: `20261025090000` i `20261025090010`                                                                     |
| zmiana szkodliwa                             | 0001 (`profiles.discoverable` DEFAULT true + hurtowy UPDATE)                                        | bez adopcji; naprawa nową migracją supabase (dla 0001: `20261025090020` i `20261025090030`, §9); decyzja `drizzleOnly` z powodem |
| kopia istniejącego pliku supabase            | faza A (np. 0071 = 20260926150000)                                                                  | rozpoznawana po treści; nic                                                                                                      |
| kopia jednego z 22 plików `appliedOutOfBand` | brak (dotąd)                                                                                        | eskalacja: produkcja wykonała stary plik drugi raz; tylko do odczytu sprawdź jego obiekty (ciała funkcji, granty) wobec pasa     |
| zapis do drugiego rejestru                   | 0023, 0149, 0307                                                                                    | zakazany; nie adoptuje się; decyzja `drizzleOnly` (§5.4 pkt 2)                                                                   |
| SQL nie przechodzi na bazie z pasa supabase  | 0393 (`42710`: ograniczenie jest od 20260725090300)                                                 | decyzja `drizzleOnly`, gdy pas supabase ma już ten stan; inaczej idempotentny odpowiednik (§5.4 pkt 2)                           |
| edycja albo usunięcie scalonego pliku        | 0367 i jego źródło (30ff38a1e)                                                                      | §6.4: przywrócenie albo świadomy wyjątek w rejestrze                                                                             |

### 5.4 Adopcja krok po kroku (PR Claude)

Adopcja jest ręczna; nie ma osobnego polecenia ani wpisu łączącego w rejestrze.

1. **Ten sam SQL (zwykły przypadek).** Nowy plik `supabase/migrations/<teraz, UTC>_adopt_<nazwa>.sql`
   z nagłówkiem
   `-- ADOPCJA: drizzle/migrations/NNNN_<nazwa>.sql (bot Lovable, <data>, commit <sha>); na produkcji wykonane przez migrator (created_at <when>).`
   i SQL-em wykonywalnym wpisu bota bez zmian (komentarze wolno dopisać - bramki porównują SQL
   wykonywalny). Wpis bota jest wtedy kopią tego pliku, czyli zapisem wdrożenia rozpoznanym po
   treści: `bun run migrations:mirror` nie generuje drugiego lustra i produkcja nie wykonuje SQL-a
   drugi raz. Sprawdź: `bun run migrations:mirror --dry-run` nie planuje wpisu dla pliku adopcji,
   a `bun run check:migration-lanes` pokazuje wpis bota jako zapis wdrożenia. Wersja pliku adopcji
   jest późniejsza niż ostatni plik niesiony przez dziennik, ale wcześniejsza niż nowe migracje tej
   samej gałęzi (inaczej generator zgłosi dla nich `wersja-wsteczna`).
2. **SQL bota nie przechodzi na bazie z pasa supabase albo stan końcowy wymaga innej treści.**
   Idempotentny odpowiednik o tym samym stanie końcowym w nowym pliku supabase. Generator
   wygeneruje dla niego lustro i produkcja wykona je przy najbliższym wdrożeniu - musi tam być
   no-op (dowód: stan z §5.2 i dwukrotne wykonanie lokalnie). Wpis bota nie jest wtedy kopią
   niczego, więc w tym samym, przeglądanym PR podnieś `JOURNAL_FREEZE_IDX`
   (`src/lib/ci/migrationLaneParity.ts`) do idx wpisu bota i dopisz do `MIGRATION_LANES` decyzję
   `drizzleOnly` z powodem wskazującym plik adopcji. Wpisy do nowej granicy bramka ocenia
   rejestrem, więc wyzwalacze i znaczniki z tego zakresu też dostają decyzję `drizzleOnly`; lustra
   i kopie przechodzą po treści. Test przypina wartość stałej, więc zmiana jest widoczna
   w przeglądzie. Tę samą drogę (bez pliku adopcji) ma wpis szkodliwy i zapis do drugiego rejestru.
3. Test pgTAP na stan końcowy (np. kolumny zwracane przez funkcję, indeks).
4. Plik migracji zmieniony albo usunięty przez bota: §6.4.

## 6. Zasady szczegółowe

### 6.1 Kolejność kod - migracja

Domyślnie migracja przed publikacją frontu. Każda migracja ma być zgodna z kodem sprzed i po zmianie
(rozszerz, przełącz kod, dopiero potem zawęź w osobnym PR). Wyjątki opisuje sekcja „Wdrożenie
bazy" w PR (np. „najpierw kod", gdy kod obsługuje oba kształty RPC).

### 6.2 Okna i blokady

Cała partia to jedna transakcja (§2). `SET lock_timeout = '5s'` w pliku chroni przed kolejką za
blokadą, ale nie skraca jej trzymania, i obowiązuje do końca partii. Partia z `ALTER` gorących
tabel (`subscriptions`, `payment_orders`, `profiles`, `crm_leads`, `email_send_log`,
`newsletter_subscribers` ...) idzie nocą.

### 6.3 Forward-only i jedyny wyjątek

Plik supabase, którego lustro produkcja zapisała w `drizzle.__drizzle_migrations`, jest
nietykalny: poprawka = nowa migracja. Jedyny wyjątek to wpis scalony do `main`, którego produkcja
NIE zapisała - dowodem jest `bun run migrations:deploy-sql -- --verify --from <idx> --to <idx>`
ze statusem „brak w rejestrze". Tylko taki wpis wolno poprawić w miejscu, nowym PR-em:

1. popraw plik supabase (źródło lustra);
2. `bun run migrations:mirror --rewrite <tag>` - lustro dostaje nową treść i hash, a `idx`, `when`
   i snapshot zostają; generator przypomina warunek z `--verify`;
3. dopisz do `MIGRATION_EDIT_ALLOWLIST` (`src/lib/ci/migrationImmutability.ts`) dwa wpisy rodzaju
   `rewrite-unapplied`: plik supabase i plik lustra, każdy z powodem (wynik `--verify` z datą)
   i SHA bloba po zmianie (`git hash-object <ścieżka>`; raport `bun run check:migration-immutability`
   drukuje gotowe wpisy);
4. tuż przed scaleniem ponów `--verify`: nadal „brak w rejestrze". Jeśli wdrożenie zdążyło, cofnij
   przepisanie i dodaj NOWĄ migrację.

To jedyna droga naprawy partii, która pada na dryfie produkcji (§4.6): nowa migracja stanęłaby
w dzienniku ZA wpisem, który pada. Lustra lokalnego gałęzi (spoza `main`) to nie dotyczy - generator
przepisuje je sam przy każdym przebiegu.

### 6.4 Niezmienność plików migracji (`check:migration-immutability`)

Bramka porównuje dwa drzewa: bazę i `HEAD` (liczą się commity, zmiany niezatwierdzone nie).
Plik `supabase/migrations/*.sql`, `drizzle/migrations/*.sql` albo
`drizzle/migrations/meta/*_snapshot.json`, który istnieje w bazie, nie może zniknąć ani zmienić
treści. `_journal.json` wolno wyłącznie dopisywać na końcu: nagłówek i każdy dawny wpis (`idx`,
`version`, `when`, `tag`, `breakpoints`) bez zmian i w dawnej kolejności (porównanie po
sparsowaniu, formatowanie się nie liczy). Nowe pliki przechodzą - pilnują ich bramka pasów
i generator.

- **Dlaczego.** Usunięcie pliku (rewert bota) nie cofa zmiany w bazie, a gubi jej jedyny zapis;
  edycja scalonego wpisu (0367, commit `30ff38a1e`) sprawia, że CI testuje SQL, którego produkcja
  nie wykonała; przestawienie dziennika zmienia to, co migrator uzna za oczekujące.
- **Baza porównania.** `MIGRATION_IMMUTABILITY_BASE` (w CI: SHA bazy PR albo `github.event.before`
  przy pushu na `main`), a bez niej `git merge-base HEAD origin/main`. Brak commitu bazy w klonie
  = ostrzeżenie i kod 0.
- **Push bota na `main`.** Czerwień jest alarmem jednego przebiegu: następny push porównuje się już
  z commitem bota. Naprawa idzie PR-em: usunięty plik wraca jako nowy plik (dodanie zawsze
  przechodzi), a przywrócony wpis dziennika przed jego końcem potrzebuje wyjątku z SHA dziennika.
- **Wyjątki.** Wpis `MIGRATION_EDIT_ALLOWLIST` w `src/lib/ci/migrationImmutability.ts`: ścieżka,
  rodzaj (`rewrite-unapplied` - §6.3; `bot-pending-fix` - poprawka bota we wpisie jeszcze
  niewdrożonym, potwierdzona `--verify`; `other` - pełne uzasadnienie), powód i SHA bloba po
  zmianie (`null` = zgoda na usunięcie). SHA wiąże wyjątek z jedną treścią: po scaleniu wpis
  niczego więcej nie otwiera i zostaje jako historia.
- **Kody wyjścia.** 0 - zielono albo baza niedostępna (ostrzeżenie); 1 - naruszenie albo błędny
  wpis rejestru; 2 - błąd gita.

## 7. Wycofanie

- **Błąd w trakcie** - nic do cofania: partia wycofana (§2). Naprawa wg §4.6.
- **Wdrożone, ale złe zachowanie** - naprawa w przód: nowa migracja supabase przywraca poprzednie
  ciało funkcji, granty i polityki (treść z poprzedniego pliku, który je definiował), lustro,
  wdrożenie z §4.2. Kod można cofnąć niezależnie (revert PR albo przywrócenie wersji w Lovable
  i publikacja), bo migracje są zgodne z kodem sprzed zmiany (§6.1).
- **Uszkodzone dane** - ostateczność: kopia dzienna (More → Database → Manage → Backups → Restore to
  this backup). Jedna kopia na dobę, ok. 14 dni wstecz, bez odtwarzania do chwili; przywraca schemat
  i dane i traci wszystko po kopii; baza kilka minut niedostępna
  (docs.lovable.dev/features/database-backups). Po przywróceniu `drizzle.__drizzle_migrations` też
  wraca do stanu kopii, więc wpisy nowsze od kopii znów są oczekujące i wykonają się przy następnym
  wyzwalaczu. Zanim wyślesz kolejne polecenie, przejrzyj `--pending` i zdecyduj, czy te zmiany mają
  wrócić.
- **Eksport** (More → Database → Manage → Settings → Export data) to archiwum `pg_restore` do
  analizy i ręcznej naprawy; Lovable nie przywraca go w projekcie. Jeden eksport na 24 h, do 15 GB
  bazy.
- Nigdy: usuwanie wpisów dziennika, wierszy rejestrów, plików migracji.

## 8. Czy usunąć `drizzle/`? Decyzja i warunki

**Decyzja właściciela (2026-10-25): `drizzle/` zostaje, dopóki baza jest na Lovable Cloud.** Pas
supabase jest źródłem prawdy, a `drizzle/` - generowanym lustrem dostawy.

- Lovable utrzymuje `drizzle/` i każe go nie ruszać; jego narzędzie migracji pisze tam swoje wpisy
  i stosuje dziennik migratorem z adresem `LOVABLE_DB_MIGRATION_URL`, który istnieje wyłącznie
  w środowisku Lovable.
- Usunięcie byłoby daremne i groźne: bot odtworzy katalog przy najbliższym wywołaniu narzędzia
  migracji (nowy dziennik od `0000` bez związku z historią, bo rejestru
  `drizzle.__drizzle_migrations` usunięcie katalogu nie kasuje), a scalone, jeszcze niewdrożone
  wpisy wypadłyby z dostawy.
- Lovable nie wykonuje migracji przychodzących przez Git. Bez lustra jedyną drogą przeglądniętego
  SQL-a na produkcję byłoby przepisywanie go przez agenta (faza A: ok. 80 wpisów jednego dnia,
  części, sklejki, zdjęte komentarze, podwójne wykonania, ręczne zapisy rejestru) albo edytor SQL
  (bez śladu).
- Bezpośredni dostęp do bazy Lovable Cloud to edytor SQL („For direct database access, open the SQL
  editor") oraz `query_database` w API/MCP Lovable (SQL „with your full database permissions"). Obie
  drogi omijają migrator i jego rejestr. Wdrożeniowiec CI przez `query_database` (emulacja
  migratora: pliki + wiersze rejestru w jednej transakcji) odrzucamy na dziś: wymaga klucza
  z pełnymi prawami do bazy w sekretach GitHub, dokumentacja nie gwarantuje transakcji wielu
  instrukcji ani limitu rozmiaru i może ścigać się z narzędziem migracji agenta. Do ponownej oceny,
  gdy Lovable udostępni uruchomienie migratora przez API.

**Warunki, przy których `drizzle/` można usunąć (wszystkie naraz):**

1. Backend przeniesiony do własnego projektu Supabase. Lovable robi to krokami, nie jednym
   przeniesieniem: eksport bazy (z kontami i skrótami haseł), pliki storage, edge functions,
   sekrety, dostawcy logowania, zmienne środowiska; „There is no automatic migration between the
   built-in backend and your own Supabase project, in either direction"
   (docs.lovable.dev/integrations/supabase). Powrót na Lovable Cloud nie jest obsługiwany - to
   drzwi jednokierunkowe.
2. Wdrożeniowiec w CI: GitHub Environment `production` z wymaganym zatwierdzeniem, sekrety
   `SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASSWORD`, `SUPABASE_PROJECT_REF`; na PR
   `supabase db push --dry-run` (lista do wykonania w podsumowaniu), na `main` po
   `Required release checks` `supabase db push`, potem `post-deploy`. Z własnym projektem Lovable
   sam zapisuje migracje w `supabase/migrations/` i wykonuje je po akceptacji w czacie - to samo
   źródło prawdy.
3. Rejestr `supabase_migrations.schema_migrations` na nowej bazie zawiera DOKŁADNIE wersje plików
   `supabase/migrations/`: ręcznie dopisane wiersze (`created_by = 'lovable'`, puste `statements`),
   25 uzgodnień `reconciled` i wersje sprzed `baseline` zweryfikowane odciskiem katalogu, a potem
   `supabase migration repair --status applied|reverted`, aż `supabase migration list` nie pokazuje
   różnic. Bez tego pierwszy `db push` wykona ponownie stare, nieidempotentne migracje albo odmówi
   przez wersje zdalne bez pliku.
4. Stan produkcji odtwarzalny z pasa supabase: wpisy `drizzleOnly` ze zmianą schematu adoptowane
   (§5), 22 pliki spoza dziennika uzgodnione (§9.3), odcisk katalogu świeżego odtworzenia równy
   produkcji.
5. Dopiero wtedy: archiwum `drizzle` (pg_dump schematu `drizzle`), usunięcie `drizzle/`,
   `drizzle.config.ts`, zależności `drizzle-kit`/`drizzle-orm` (w kodzie aplikacji nieużywane),
   bramek pasów i generatora lustra.

Ryzyka przeniesienia: okno zamrożenia zapisów na czas eksportu i odtworzenia; nowe klucze i sekret
JWT (wszystkie sesje do ponownego logowania, nowe `VITE_SUPABASE_URL` i klucz publikowalny wszędzie,
gdzie są wpięte); adresy webhooków płatności; sekrety w Vault zaszyfrowane kluczem starego projektu
(do ponownego wpisania); zadania `pg_cron`; pliki storage; konfiguracja poczty i dostawców
logowania; usługi Lovable związane z Cloud. Rekomendacja: zostać na Lovable Cloud z lustrem; wrócić
do tematu tylko z powodu biznesowego (własny dostęp do bazy, odtwarzanie do chwili, wymogi
rezydencji danych).

## 9. Pierwsze wdrożenie po przełączeniu (jednorazowe)

PR przełączający dostarcza generator, bramki (pasy z zamrożeniem na 398, niezmienność, wyłączenie
plików z lustrem z bramki drugiego rejestru), pomocnik `migrations:deploy-sql` i cztery nowe
migracje supabase, które generator zamienia w lustra (numery to linia z opisu PR; jeśli `main`
dostał wcześniej wpisy po 0398, przesuwają się):

| Wpis | Plik supabase                                               | Co robi na produkcji                                                                                                                                                      |
| ---- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0399 | `20261025090000_adopt_event_speaker_panel_bio.sql`          | adopcja 0148: warunkowy `DROP` się nie wykona, `CREATE OR REPLACE` podmienia identyczne ciało (OID i granty bez zmian)                                                    |
| 0400 | `20261025090010_adopt_membership_coupon_source_indexes.sql` | adopcja 0392: zakłada brakujący `idx_membership_grants_source_coupon`, przywraca polski komentarz kolumny; blokada SHARE na `membership_grants` do końca partii           |
| 0401 | `20261025090020_profiles_discoverable_decision_stamp.sql`   | kolumna `profiles.discoverable_decided_at` i wyzwalacz znacznika decyzji; ACCESS EXCLUSIVE na `profiles` do końca partii; `SET lock_timeout = '5s'` obowiązuje też w 0402 |
| 0402 | `20261025090030_profiles_discoverable_0001_correction.sql`  | ZMIANA DANYCH: cofa do `false` profile, o których baza dowodzi braku decyzji (kubły A i B), każdy zapisuje w `profiles_discoverable_corrections`; nigdy nie rzuca wyjątku |

Do tego wyzwalacz bota (§4.3). 22 pliki `appliedOutOfBand` z `SUPABASE_LANE_GAPS` NIE są
dostarczane (§9.3). Przed wyzwoleniem właściciel i inspektor ochrony danych czytają
`docs/NAPRAWA_PROFILES_DISCOVERABLE_0001_2026-10-25.md` (co zmienia 0402, jak czytać wynik, punkty
do oceny prawnej).

### 9.1 Kontrole przed wyzwoleniem (tylko odczyt; przed wdrożeniem, nie przed scaleniem)

1. `bun run migrations:deploy-sql -- --pending --from 399`: dokładnie 0399-0402 mają status
   „zostanie wykonany", nie ma statusu
   „POMINIETY: when nie wiekszy od ostatniego zapisu" ani „INNY HASH W REJESTRZE".
2. Zapytania z poniższego bloku, wynik zapisany w PR:

```sql
-- 0399: oczekiwany dokładnie tekst z warunku w 20261025090000 (29 kolumn, od
-- "TABLE(entry_id uuid, ..." do "..., reviews_count integer)"). Inny tekst = wykona
-- się DROP + CREATE (stan ten sam, nowy OID) - wtedy liczy się kolejne zapytanie.
SELECT pg_get_function_result('public.admin_event_speakers_list(uuid)'::regprocedure);
-- 0399: oczekiwane 0; obiekt zależny wywróciłby DROP (2BP01) i całą partię.
SELECT count(*) FROM pg_depend
 WHERE refobjid = 'public.admin_event_speakers_list(uuid)'::regprocedure;
-- 0400: oczekiwany jeden wiersz; brak kolumny = 42703 i wycofanie całej partii.
SELECT column_name FROM information_schema.columns
 WHERE table_schema = 'public' AND table_name = 'membership_grants'
   AND column_name = 'source_coupon_id';
-- 0400: membership_grants_tenant_coupon_idx jest, idx_membership_grants_source_coupon
-- zwykle nie ma (powstanie); klucz obcy i komentarz kolumny - dla porządku.
SELECT indexname, indexdef FROM pg_indexes
 WHERE schemaname = 'public' AND tablename = 'membership_grants' ORDER BY 1;
SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint
 WHERE conrelid = 'public.membership_grants'::regclass AND contype = 'f';
SELECT col_description('public.membership_grants'::regclass, attnum) FROM pg_attribute
 WHERE attrelid = 'public.membership_grants'::regclass AND attname = 'source_coupon_id';
-- Informacyjnie (poza tą partią): oczekiwane false; true = osobny dryf do zgłoszenia.
SELECT has_function_privilege('authenticated', 'public.is_platform_author(uuid)', 'EXECUTE');
```

3. Dla 0402: pomiar okna 0001 z `docs/NAPRAWA_PROFILES_DISCOVERABLE_0001_2026-10-25.md`, sekcja 4
   (tylko odczyt) - pokazuje, czy korekta znajdzie klaster i ilu profili dotknie.

### 9.2 Kolejność

1. Eksport bazy (§7).
2. Kontrole z §9.1.
3. Okno nocne (ACCESS EXCLUSIVE na `profiles` do końca partii), polecenie z §4.2: OD = 399, DO = 402.
4. Weryfikacja z §4.4, dodatkowo zapytania z sekcji 4 dokumentu naprawy `profiles.discoverable` i pełny
   kontrakt `check:db-contract`.
5. Wynik `bun run migrations:deploy-sql -- --verify --from 399` (0 wierszy) zapisany w PR - to
   warunek następnego kroku (§9.3).

### 9.3 Następny PR: uzgodnienie 22 plików spoza dziennika

22 pliki `appliedOutOfBand` w `SUPABASE_LANE_GAPS` trafiły na produkcję poza migratorem: ich
obiekty istnieją (`src/integrations/supabase/types.ts`), ale granty i ciała funkcji nie są
potwierdzone. Ten PR tylko to zapisuje i gwarantuje, że generator tych plików nigdy nie wyśle (stary
plik wykonany ponownie w partii mógłby ją wywrócić albo cofnąć późniejsze zmiany tych samych
obiektów). Stan domknie osobny PR z idempotentnymi migracjami uzgadniającymi (wersje późniejsze niż
ostatni plik niesiony przez dziennik; wpis luki dostaje wtedy `reconciledBy`).

Warunek scalenia tamtego PR, nie tylko jego wdrożenia: właściciel wykonuje na produkcji zapytanie
weryfikacyjne dostarczone z tym PR (`BEGIN READ ONLY ... ROLLBACK` w edytorze SQL) i zapisuje wynik.
Wiersze blokujące (funkcja brakująca dla samego `GRANT`/`REVOKE` - 42883, inna sygnatura - 42P13,
dane łamiące nowe `CHECK` - 23514, brak kolumny - 42703) wstrzymują scalenie, bo każde wywołanie
narzędzia migracji Lovable, także przy niezwiązanej zmianie bota, wykonuje wszystkie oczekujące
wpisy - scalone uzgodnienie z takim wierszem wycofałoby cudze zmiany. Po wdrożeniu to samo
zapytanie ma zwrócić 0 wierszy. Warunek wstępny: ten PR wdrożony, `--verify --from 399` = 0
wierszy.

## 10. Historia wdrożeń

- **Do 2026-09-11 (pas supabase).** Panel Lovable stosował pliki `supabase/migrations/` i zapisywał
  wersje w `schema_migrations`; migracje z PR bywały ponownie emitowane pod numerem panelu
  (`<wersja>_<uuid>.sql`) - stąd `reconciled` w `supabase/migration-ledger.json`.
- **2026-09-11 - start Drizzle.** Commit bota `95186c4a7` dodał `drizzle.config.ts`, pusty
  `drizzle/schema.ts`, `0000_search_people_super_admin_bypass` i zależności
  `drizzle-kit`/`drizzle-orm`. Publicznie: changelog Lovable 2026-10-07.
- **Faza A (do 2026-10-18): przepisywanie.** Właściciel prosił w czacie („Wgrać pozostałe 39 plików
  z PR #504 po kolei, jak dotąd", 2026-10-14), a agent przepisywał każdy plik supabase narzędziem
  `lov_database--migration` (`{name, query}`) na nowy wpis dziennika: ok. 80 wpisów bota
  2026-10-14, części do ok. 45 KiB, zdjęte komentarze, podwójne wpisy (0112 → 0114, 0113 → 0115).
- **Faza B (od 2026-10-19): bliźniaki z PR + wyzwalacz.** PR-y Claude niosły ręczne bliźniaki
  i wpisy dziennika. Właściciel wklejał stałe pytanie: „Czy Merge pull request #N from ... został
  w pełni zintegrowany i wdrożony prawidłowo (w tym jego wszystkie commit)? / Czy wszystkie tabele
  zostały wdrożone i utworzone? / Wdroż i wykonaj niezbędne akcje do pełnej implementacji /
  Zweryfikuj w Supabase, czy wszystkie tabele, widoki i RPC istnieją". Agent czytał rejestry
  (`supabase--read_query`), wołał `lov_database--migration` z komentarzem
  (`0329_pr520_deployment_completion`, `0346_pr527_...`, `0391_pr530_...`, `0398_pr533_...`), co
  uruchamiało migrator na wszystkich oczekujących wpisach, a potem `supabase--run_sql` dopisywał
  wersje do `supabase_migrations.schema_migrations` („drugi rejestr"), np. 2026-10-23:
  `statements = ARRAY['-- Applied byte-exact via Drizzle migration 0394; verified live catalog 2026-10-23.']`.
  Wcześniej (2026-10-16) jednym `run_sql` dopisano 124 wersje „obiekty już istnieją w bazie,
  brakowało tylko zapisów w rejestrze" - wiersz rejestru nie jest więc dowodem treści.
- **Odstępstwa, których ten runbook zakazuje:** 2026-10-18 `run_sql` wykonał DDL wpisu 0311
  i ręcznie wstawił jego `(hash, created_at)` do `drizzle.__drizzle_migrations`; 2026-10-22 po
  błędzie partii na `0367` (brak `notifications.meta` na produkcji) agent dopisał `ALTER TABLE` do
  scalonej pary `0367`/`20261020160900` (commit `30ff38a1e`) i ponowił; 2026-10-23 na prośbę
  „napraw" bot napisał własne `0392`/`0393` (bez źródła w supabase); 2026-09-11 `0001` przestawiło
  `profiles.discoverable`.
- **2026-10-25 - przełączenie.** Dziennik zamrożony na wpisie 0398, od 0399 lustra z
  `bun run migrations:mirror`; 0148 i 0392 adoptowane, skutki 0001 korygowane (§9); bramka
  niezmienności plików migracji; drugi rejestr bez ręcznych zapisów.

## 11. Wiedza projektu Lovable

- Agent Lovable zawsze czyta główny `AGENTS.md` i wiedzę projektu (Project settings → Knowledge, do
  10 000 znaków). Treść wiedzy to `docs/LOVABLE_WIEDZA_PROJEKTU.md`; test
  `src/lib/ci/__tests__/lovableDeployDocs.test.ts` pilnuje limitu i zgodności z narzędziami.
- Wiedzę wkleja właściciel: Lovable → Project settings → Knowledge, cała treść pliku. Claude nie
  zapisuje wiedzy projektu narzędziami Lovable. Po każdej zmianie pliku właściciel wkleja go
  ponownie.
- Polecenie wdrożenia to zawsze §4.2 z numerami z opisu PR, nie dawne pytanie z §10.

## 12. Ściąga

| Cel                                              | Polecenie                                                                   |
| ------------------------------------------------ | --------------------------------------------------------------------------- |
| lustro po zmianie w `supabase/migrations`        | `bun run migrations:mirror`                                                 |
| plan bez zapisu / kontrola jak w CI              | `bun run migrations:mirror --dry-run` / `bun run migrations:mirror --check` |
| poprawka wpisu niezapisanego na produkcji (§6.3) | `bun run migrations:mirror --rewrite <tag>`                                 |
| snapshot uprawnień po nowej migracji             | `bun run generate:authz-snapshot`                                           |
| bramka pasów (z aktualnością lustra)             | `bun run check:migration-lanes`                                             |
| bramka niezmienności plików migracji             | `bun run check:migration-immutability`                                      |
| co wykona migrator (SQL tylko do odczytu)        | `bun run migrations:deploy-sql -- --pending --from <idx>`                   |
| czy wpisy są w rejestrze (SQL tylko do odczytu)  | `bun run migrations:deploy-sql -- --verify --from <idx> [--to <idx>]`       |
| obiekty i kolumny produkcji                      | `bun run check:db-contract`                                                 |
| drugi rejestr dla plików bez lustra              | `bun run check:migration-ledger`                                            |
| za duża migracja                                 | `bun run scripts/split-migration.ts supabase/migrations/<plik>.sql`         |
