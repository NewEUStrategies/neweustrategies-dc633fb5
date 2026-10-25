# Migracje bazy - stałe zasady projektu New European Strategies

Pełny opis: docs/RUNBOOK_MIGRACJE_LOVABLE.md (czytaj przed każdą pracą z bazą). Te zasady mają pierwszeństwo przed domyślnym sposobem pracy z bazą.

## Model

- Jedynym źródłem prawdy o schemacie jest katalog supabase/migrations. Z niego CI stawia bazę testową (pgTAP) i liczy bramki bezpieczeństwa.
- Katalog drizzle/ to lustro generowane poleceniem `bun run migrations:mirror` z supabase/migrations; od wpisu 0399 każdy plik lustra zaczyna się linią `-- migrations-mirror: supabase/migrations/<plik>`. Służy wyłącznie do dostarczenia SQL-a na produkcję migratorem Drizzle. Plików i wpisów dziennika drizzle nie piszesz ani nie edytujesz ręcznie. Jedyny wyjątek: wpis-wyzwalacz, który Twoje narzędzie migracji tworzy przy wdrożeniu.
- Wpisy dziennika 0000-0398 to zamknięta historia, a rejestr MIGRATION_LANES jest zamrożony.
- Pliki przychodzące z GitHuba nie wykonują się same. Wdrożenie = jedno wywołanie Twojego narzędzia migracji bazy; uruchamia ono migrator Drizzle, który wykonuje wszystkie oczekujące wpisy dziennika w jednej transakcji. Błąd jednego wpisu wycofuje całą partię.
- Dowodem wdrożenia jest wiersz w drizzle.__drizzle_migrations (hash = sha256 pliku, created_at = `when` wpisu). Rejestr supabase_migrations.schema_migrations nie jest dowodem i nie uzupełniasz go.
- Katalog drizzle/, drizzle.config.ts i drizzle/schema.ts zostają, dopóki baza jest na Lovable Cloud (decyzja właściciela). Nie usuwasz ich i nie proponujesz usunięcia. Zmienić to może wyłącznie przeniesienie bazy do własnego projektu Supabase z wdrożeniowcem w CI i uzgodnionym rejestrem migracji, na decyzję właściciela (runbook §8).

## Wdrożenie po scaleniu PR

Dotyczy też pytania właściciela „czy PR został w pełni zintegrowany i wdrożony". Numery wpisów (OD-DO) są w sekcji „Wdrożenie bazy" opisu PR albo w poleceniu właściciela (runbook §4.2).

1. Potwierdź, że merge PR i wszystkie jego commity są przodkami HEAD.
2. Uruchom `bun run migrations:deploy-sql -- --pending --from <OD>` i wykonaj wypisane zapytanie wyłącznie narzędziem tylko do odczytu. Status „zostanie wykonany" mogą mieć wyłącznie wpisy OD-DO; wcześniejsze mają „juz zastosowany". „POMINIETY: when nie wiekszy od ostatniego zapisu" albo „INNY HASH W REJESTRZE" = stop i raport. Brak oczekujących wpisów = nie uruchamiaj narzędzia migracji.
3. Wywołaj narzędzie migracji bazy dokładnie raz: nazwa `pr<NR_PR>_deployment_completion`, treść dokładnie `COMMENT ON SCHEMA public IS 'standard public schema';`. Nic więcej w tym wywołaniu. Nie dopisuj tego wpisu do MIGRATION_LANES.
4. Błąd migratora: stop. Nie poprawiaj plików, nie wykonuj SQL-a ręcznie. Podaj SQLSTATE, komunikat i plik. Ponowienie kroku 3 tylko przy 55P03, 40P01 albo 57014, najwyżej dwa razy. Naprawa idzie PR-em (runbook §4.6 i §6.3).
5. Weryfikacja: `bun run migrations:deploy-sql -- --verify --from <OD>` (wynik tylko do odczytu, ma dać 0 wierszy; wiersz „brak w rejestrze" albo „inny hash" = raport), potem `bun run check:migration-lanes`, `bun run check:db-contract`, `bun run check:migration-ledger`.
6. Publikacja frontu w kolejności z opisu PR (domyślnie po migracji).
7. Raport: wpisy (idx, tag) zastosowane w tym wdrożeniu, wyniki kroków 2 i 5, commit. Bez dowodu z kroku 5 piszesz „niepotwierdzone", nie „wdrożone".

## Gdy właściciel prosi Cię o zmianę bazy

1. Zapisz SQL w nowym pliku supabase/migrations/<YYYYMMDDHHMMSS w UTC>_<nazwa>.sql, z wersją późniejszą niż ostatni plik. SQL bezpieczny do ponownego wykonania (CREATE OR REPLACE, IF NOT EXISTS, DROP ... IF EXISTS przed CREATE), literalne nazwy tabel i RPC, jawne REVOKE/GRANT. Funkcje tylko serwerowe: EXECUTE wyłącznie dla service_role. tenant_id, firma i użytkownik z sesji, nigdy z ładunku.
2. Uruchom `bun run migrations:mirror` i `bun run generate:authz-snapshot`, potem `bun run check:migration-lanes`. Plik supabase, drizzle/ i snapshot zatwierdź w jednym commicie.
3. Wdróż jak wyżej (kroki 2-5), z nazwą wyzwalacza `lovable_<YYYYMMDD>_deployment_completion`.
4. Nigdy nie przekazuj prawdziwego SQL-a zmiany bezpośrednio do narzędzia migracji: zmiana bez pliku w supabase/migrations jest niewidoczna dla testów i bramek bezpieczeństwa, a check:migration-lanes zgłosi ją jako wpis-spoza-zrodla.

## Stan szczególny

- profiles.discoverable: wpis dziennika 0001 (DEFAULT true i hurtowy UPDATE z 2026-09-11) nigdy nie jest kopiowany ani powtarzany. Jego skutki korygują migracje 20261025090020 (znacznik decyzji właściciela profilu) i 20261025090030 (powrót do false profili bez decyzji, z rejestrem profiles_discoverable_corrections), czyli wpisy dziennika 0401-0402, wykonywane wyłącznie migratorem. Nie zmieniasz discoverable ręcznie i nie wywołujesz `_profiles_discoverable_0001_correction(true)`; wynik sprawdzasz tylko do odczytu (docs/NAPRAWA_PROFILES_DISCOVERABLE_0001_2026-10-25.md, sekcja 4).
- 22 pliki supabase z wpisem appliedOutOfBand w SUPABASE_LANE_GAPS trafiły na produkcję poza migratorem. Nie przepisujesz ich na wpisy dziennika i nie wykonujesz ich SQL-a. Uzgodni je osobny PR, scalany dopiero po zapytaniu weryfikacyjnym tylko do odczytu na produkcji, które uruchamia właściciel (runbook §9.3).
- Job post-deploy w GitHub Actions czyta ZMIENNE repozytorium SUPABASE_URL i SUPABASE_PUBLISHABLE_KEY. Nie proponuj sekretów repozytorium o tych nazwach ani VITE_SUPABASE_URL i VITE_SUPABASE_PUBLISHABLE_KEY: przełączyłyby build i testy e2e z zaślepki na produkcyjną bazę (runbook §4.8).

## Nigdy

- Nie edytuj, nie usuwaj i nie przenumerowuj plików w drizzle/ (także meta/ i _journal.json) ani w supabase/migrations, które są już na main: bramka check:migration-immutability czerwieni wtedy CI, a wyjątek to wyłącznie wpis MIGRATION_EDIT_ALLOWLIST w przeglądanym PR (runbook §6.4). Nie zmieniaj drizzle.config.ts ani drizzle/schema.ts.
- Nie przepisuj migracji z supabase/migrations na nowe wpisy narzędzia migracji (kopie, części, sklejki).
- Nie wykonuj DDL ani migracji przez SQL/run_sql/edytor SQL. Zapis danych tylko na wyraźne polecenie właściciela, z pokazanym zapytaniem.
- Nie zapisuj niczego do drizzle.__drizzle_migrations ani do supabase_migrations.schema_migrations, także jako „uzupełnienie rejestru".
- Nie uruchamiaj drizzle-kit push, generate, migrate ani drop.
- Nie zmieniaj bramek ani rejestrów w src/lib/ci/ i src/lib/migrations/ (MIGRATION_LANES, SUPABASE_LANE_GAPS, MIGRATION_EDIT_ALLOWLIST, JOURNAL_FREEZE_IDX), żeby zazielenić CI. Czerwona bramka = raport dla właściciela.
- Nie przywracaj kopii bazy i nie cofaj wersji projektu jako „cofnięcia migracji" bez decyzji właściciela (cofnięcie wersji cofa tylko kod, nie bazę).
