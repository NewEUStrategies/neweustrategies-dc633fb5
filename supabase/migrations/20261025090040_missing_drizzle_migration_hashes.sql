-- ============================================================================
-- SONDA REJESTRU MIGRATORA DRIZZLE DLA BRAMKI `check:migration-ledger`:
-- `public.missing_drizzle_migration_hashes(text[])`.
--
-- DEFEKT
--   Od wpisu dziennika 0399 (MIRROR_LANE_START_IDX) pliki `supabase/migrations`
--   trafiają na produkcję wyłącznie wpisami dziennika drizzle: lustrem z
--   `bun run migrations:mirror` albo adoptowanym wpisem bota Lovable (runbook
--   §5.4 pkt 1). Migrator Drizzle zapisuje je w `drizzle.__drizzle_migrations`
--   (hash = sha256 pliku wpisu, created_at = `when`), a nie w
--   `supabase_migrations.schema_migrations`. Bramka po wdrożeniu
--   `check:migration-ledger` wyjmowała więc te pliki z kontroli rejestru,
--   a dowód brała z samego dziennika w repozytorium - nic w jobie
--   `post-deploy` nie pytało rejestru migratora
--   (`migrations:deploy-sql -- --verify` tylko wypisuje SQL do ręcznego
--   wykonania). Gdy wdrożenie Lovable się nie odbyło, padło albo poszło inną
--   drogą, bramka świeciła na zielono,
--   choć migracji z lustrem - także korekty `profiles.discoverable`
--   (20261025090030) - na produkcji nie było (uwaga przeglądu Codex, P1,
--   `scripts/check-migration-ledger.ts`).
--
-- ZMIANA
--   Funkcja dostaje listę wpisów znanych CI - `<when>:<sha256>`: `when` wpisu
--   dziennika, który niesie plik supabase od 0399, i sha256 pliku tego wpisu -
--   i zwraca posortowany PODZBIÓR bez powtórzeń: te, dla których w
--   `drizzle.__drizzle_migrations` nie ma wiersza z `created_at` = `when`
--   I `hash` = sha256. To samo dopasowanie co `migrations:deploy-sql -- --verify`
--   (src/lib/ci/migrationDeploySql.ts). Sam hash nie wystarcza: ponowna
--   dostawa tych samych bajtów (w dzienniku 15 razy, np. 0308/0310) zostawia
--   hash w rejestrze pod `when` WCZEŚNIEJSZEGO wpisu, więc pominięty
--   późniejszy wpis wyglądałby na wdrożony. Ten sam wzorzec co
--   `missing_migration_versions` (20260825230232): funkcja nie wylicza
--   rejestru, odpowiada wyłącznie o pary podane przez wołającego (`when`
--   i sha256 plików z publicznego repozytorium), więc nie da się nią
--   enumerować historii wdrożeń.
--   * Schematu `drizzle` nie ma w pasie supabase (pgTAP, harnessy,
--     `db reset`, baza lokalna) - zakłada go migrator przy pierwszym
--     uruchomieniu. CREATE przechodzi bez tabeli, bo ciało czyta ją
--     dynamicznie (EXECUTE) i tylko wtedy, gdy
--     `to_regclass('drizzle.__drizzle_migrations')` ją widzi. Bez tabeli
--     brakuje każdego podanego wpisu (nic nie jest dowiedzione). Nazwę
--     relacji do zapytania wstawia `format('%s', regclass)` - tekst nadany
--     przez PostgreSQL (kwalifikowany i cytowany), nie przez wołającego;
--     dzięki temu bramka `plpgsql_check` (plpgsql_check_gate_test.sql) nie
--     analizuje statycznie zapytania o tabelę, której w pasie supabase nie
--     ma (42P01 w stałym napisie EXECUTE).
--   * Wejście: NULL = pusta tablica; najwyżej 1000 elementów (klient pyta
--     partiami po 40); każdy element to `<when>:<sha256>` - `when` dziesiętnie
--     bez zera wiodącego, najwyżej 16 cyfr (mieści się w bigint), dwukropek
--     i dokładnie 64 małe znaki szesnastkowe - inaczej 22023. Tablica idzie do
--     zapytania parametrem (EXECUTE ... USING), nie tekstem; `when` i hash
--     wyjmuje z elementu `split_part` dopiero po walidacji.
--   * STABLE (PostgREST woła ją GET-em), SECURITY DEFINER z
--     `search_path = pg_catalog, pg_temp`; funkcje i tabele kwalifikowane
--     schematem.
--   * `NOTIFY pgrst, 'reload schema'`: PostgREST widzi funkcję zaraz po
--     zatwierdzeniu wsadu migratora (`post-deploy` woła ją po wdrożeniu).
--   Brak samej funkcji na bazie (PostgREST 404 / PGRST202) bramka traktuje
--   jak niewdrożoną partię z tym plikiem - czerwień, nie zielone przejście.
--
-- UPRAWNIENIA
--   REVOKE ALL FROM PUBLIC; EXECUTE dla anon, authenticated i service_role -
--   jak `missing_migration_versions`. Jedyny wołający to job `post-deploy`
--   (`scripts/check-migration-ledger.ts` przez `src/lib/ci/deploymentProbe.ts`)
--   z kluczem PUBLIKOWALNYM ze zmiennych repozytorium (runbook §4.8): bez
--   anon sonda nie działa, a `service_role` to wariant z kluczem serwisowym.
--   Funkcja niczego nie zapisuje, nie czyta danych aplikacji ani najemców
--   i zdradza wyłącznie to, czy wpis o `when` i hashu znanych wołającemu
--   został wdrożony; authenticated nie dostaje przez nią nic ponad anon.
--
-- IDEMPOTENTNE: CREATE OR REPLACE, bezstanowe REVOKE/GRANT i COMMENT; drugi
-- przebieg nie zmienia stanu. Nie dotyka żadnej tabeli aplikacji (żadnych
-- blokad poza katalogiem funkcji).
-- Nośnik w dzienniku drizzle generuje `bun run migrations:mirror`; nikt nie
-- pisze go ręcznie.
-- Test: supabase/tests/missing_drizzle_migration_hashes_test.sql.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.missing_drizzle_migration_hashes(_entries text[])
RETURNS text[]
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_registry regclass;
  v_requested text[];
  v_missing text[];
BEGIN
  IF _entries IS NULL THEN
    RETURN ARRAY[]::text[];
  END IF;
  IF pg_catalog.cardinality(_entries) > 1000 THEN
    RAISE EXCEPTION 'drizzle registry probe: maximum 1000 entries per request'
      USING ERRCODE = '22023';
  END IF;
  IF EXISTS (
    SELECT 1
      FROM pg_catalog.unnest(_entries) AS u(e)
     WHERE u.e IS NULL OR u.e !~ '^(0|[1-9][0-9]{0,15}):[0-9a-f]{64}$'
  ) THEN
    RAISE EXCEPTION 'drizzle registry probe: every entry must be <when>:<sha256> (when: decimal without leading zeros, at most 16 digits; sha256: 64 lowercase hex characters)'
      USING ERRCODE = '22023';
  END IF;

  v_requested := ARRAY(
    SELECT DISTINCT u.e COLLATE pg_catalog."C"
      FROM pg_catalog.unnest(_entries) AS u(e)
     ORDER BY 1
  );

  v_registry := pg_catalog.to_regclass('drizzle.__drizzle_migrations');
  IF v_registry IS NULL THEN
    RETURN v_requested;
  END IF;

  EXECUTE pg_catalog.format(
    'SELECT COALESCE(pg_catalog.array_agg(r.e ORDER BY r.ord), ARRAY[]::text[])
       FROM pg_catalog.unnest($1) WITH ORDINALITY AS r(e, ord)
      WHERE NOT EXISTS (
        SELECT 1 FROM %s m
         WHERE m.created_at = pg_catalog.split_part(r.e, '':'', 1)::bigint
           AND m.hash = pg_catalog.split_part(r.e, '':'', 2)
      )',
    v_registry
  )
    INTO v_missing
    USING v_requested;
  RETURN v_missing;
END;
$fn$;

REVOKE ALL ON FUNCTION public.missing_drizzle_migration_hashes(text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.missing_drizzle_migration_hashes(text[]) TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.missing_drizzle_migration_hashes(text[]) IS
  'CI post-deploy gate (check:migration-ledger): zwraca posortowany podzbiór podanych wpisów <when>:<sha256> dziennika drizzle, których pary (created_at, hash) nie ma w drizzle.__drizzle_migrations (jak migrations:deploy-sql --verify; bez tej tabeli - wszystkie podane). Nie wylicza rejestru.';

NOTIFY pgrst, 'reload schema';
