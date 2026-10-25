-- pgTAP: `missing_drizzle_migration_hashes(text[])` (20261025090040) - sonda
-- rejestru migratora Drizzle dla bramki po wdrożeniu `check:migration-ledger`.
--
-- PO CO TO STOI. Pliki `supabase/migrations` od wpisu dziennika 0399 trafiają
-- na produkcję wyłącznie migratorem Drizzle, który zapisuje je w
-- `drizzle.__drizzle_migrations` (created_at = `when` wpisu, hash = sha256
-- pliku wpisu). Bramka pyta o te pary (`<when>:<sha256>`) przez tę funkcję -
-- tak jak `migrations:deploy-sql -- --verify`; gdyby zwracała za mało,
-- niewdrożona migracja przeszłaby jako wdrożona (także ponowna dostawa tych
-- samych bajtów, której hash rejestr ma pod `when` wcześniejszego wpisu), a
-- gdyby zwracała cokolwiek spoza pytania - dało się nią enumerować historię
-- wdrożeń kluczem publikowalnym.
--
-- CO PRZYPINA
--   1-10.  kształt (argument, wynik, STABLE), SECURITY DEFINER z
--          `search_path = pg_catalog, pg_temp`, granty (PUBLIC bez EXECUTE;
--          anon, authenticated i service_role z EXECUTE), komentarz;
--   11-14. baza z pasa supabase (bez schematu `drizzle`): brakuje każdego
--          podanego wpisu - posortowane, bez powtórzeń; NULL i pusta tablica
--          dają pustą tablicę;
--   15-22. atrapa rejestru migratora (DDL jak w drizzle-orm 0.45.2) w tej
--          transakcji: wynik to wyłącznie brakujący podzbiór pytania,
--          posortowany i bez powtórzeń; pusta tablica niczego nie wylicza;
--          dopasowanie to PARA (created_at, hash): ten sam hash pod innym
--          `when` (ponowna dostawa 0308/0310) i inny hash pod tym samym `when`
--          to brak; anon (klucz publikowalny CI) czyta rejestr wyłącznie przez
--          funkcję;
--   23-30. wejście spoza kontraktu (tag, sam hash bez `when`, wielkie litery,
--          zero wiodące, `when` dłuższe niż 16 cyfr, NULL w tablicy, próba
--          wstrzyknięcia, ponad 1000 elementów) - 22023.
BEGIN;
SET LOCAL search_path = public, extensions;
SELECT plan(30);

-- Środowisko z istniejącym rejestrem (np. baza odtworzona z produkcji) chowa
-- go na czas testu; ROLLBACK na końcu przywraca stan.
DO $$
BEGIN
  IF to_regclass('drizzle.__drizzle_migrations') IS NOT NULL THEN
    ALTER TABLE drizzle.__drizzle_migrations RENAME TO __drizzle_migrations_pgtap_hidden;
  END IF;
END $$;

-- ── 1-10. Kształt, bezpieczeństwo, granty ──────────────────────────────────
SELECT has_function(
  'public', 'missing_drizzle_migration_hashes', ARRAY['text[]'],
  'missing_drizzle_migration_hashes(text[]) istnieje'
);
SELECT is(
  pg_get_function_arguments('public.missing_drizzle_migration_hashes(text[])'::regprocedure),
  '_entries text[]',
  'argument _entries text[] (PostgREST woła ją z parametrem _entries)'
);
SELECT is(
  pg_get_function_result('public.missing_drizzle_migration_hashes(text[])'::regprocedure),
  'text[]',
  'wynik: text[] - lista brakujących wpisów <when>:<sha256>'
);
SELECT is(
  (SELECT provolatile::text FROM pg_proc WHERE oid = 'public.missing_drizzle_migration_hashes(text[])'::regprocedure),
  's',
  'STABLE: tylko odczyt, PostgREST woła ją GET-em'
);
SELECT ok(
  (SELECT prosecdef FROM pg_proc WHERE oid = 'public.missing_drizzle_migration_hashes(text[])'::regprocedure),
  'SECURITY DEFINER: czyta rejestr migratora, do którego wołający nie ma grantu'
);
SELECT is(
  (SELECT proconfig FROM pg_proc WHERE oid = 'public.missing_drizzle_migration_hashes(text[])'::regprocedure),
  ARRAY['search_path=pg_catalog, pg_temp'],
  'search_path przypięty do pg_catalog, pg_temp (obiekty kwalifikowane schematem)'
);
SELECT ok(
  NOT EXISTS (
    SELECT 1 FROM pg_proc p, aclexplode(p.proacl) a
     WHERE p.oid = 'public.missing_drizzle_migration_hashes(text[])'::regprocedure AND a.grantee = 0
  ),
  'PUBLIC bez EXECUTE'
);
SELECT ok(
  has_function_privilege('anon', 'public.missing_drizzle_migration_hashes(text[])', 'EXECUTE'),
  'anon z EXECUTE: post-deploy woła sondę kluczem publikowalnym'
);
SELECT ok(
  has_function_privilege('authenticated', 'public.missing_drizzle_migration_hashes(text[])', 'EXECUTE')
    AND has_function_privilege('service_role', 'public.missing_drizzle_migration_hashes(text[])', 'EXECUTE'),
  'authenticated i service_role z EXECUTE (jak missing_migration_versions)'
);
SELECT ok(
  obj_description('public.missing_drizzle_migration_hashes(text[])'::regprocedure, 'pg_proc')
    LIKE 'CI post-deploy gate (check:migration-ledger):%',
  'komentarz funkcji wskazuje bramkę, która ją woła'
);

-- ── 11-14. Pas supabase: rejestru migratora nie ma ─────────────────────────
SELECT ok(
  to_regclass('drizzle.__drizzle_migrations') IS NULL,
  'w bazie z pasa supabase nie ma drizzle.__drizzle_migrations'
);
SELECT is(
  public.missing_drizzle_migration_hashes(ARRAY[
    '1792790006300:cf6dbe8079abe87f90c6131ecf051a937cca7b0c42ffae3c0f3e8b9c7ea59103',
    '1792789946300:4b92866fc3d1cf4669a1c5d0b85d753c5b1c04eb580585af017a86a50090b917',
    '1792790006300:cf6dbe8079abe87f90c6131ecf051a937cca7b0c42ffae3c0f3e8b9c7ea59103',
    '1792790066300:1317934e2ff996b917dbef723f12f846e6d1961320fb1ba9b0e5c8597398e300'
  ]),
  ARRAY[
    '1792789946300:4b92866fc3d1cf4669a1c5d0b85d753c5b1c04eb580585af017a86a50090b917',
    '1792790006300:cf6dbe8079abe87f90c6131ecf051a937cca7b0c42ffae3c0f3e8b9c7ea59103',
    '1792790066300:1317934e2ff996b917dbef723f12f846e6d1961320fb1ba9b0e5c8597398e300'
  ],
  'bez rejestru brakuje każdego podanego wpisu - posortowane, bez powtórzeń'
);
SELECT is(public.missing_drizzle_migration_hashes(NULL), ARRAY[]::text[], 'NULL = pusta tablica');
SELECT is(
  public.missing_drizzle_migration_hashes(ARRAY[]::text[]), ARRAY[]::text[],
  'pusta tablica = pusta tablica'
);

-- ── 15-22. Atrapa rejestru migratora (DDL jak w drizzle-orm 0.45.2) ─────────
CREATE SCHEMA IF NOT EXISTS drizzle;
CREATE TABLE drizzle.__drizzle_migrations (
  id SERIAL PRIMARY KEY,
  hash text NOT NULL,
  created_at bigint
);
-- Ostatni wiersz: 0308_release_coupon_order_lock. Jego bajty dziennik dostarczył
-- drugi raz jako 0310_release_coupon_order_lock_final (ten sam sha256, inny `when`).
INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES
  ('4b92866fc3d1cf4669a1c5d0b85d753c5b1c04eb580585af017a86a50090b917', 1792789946300),
  ('cf6dbe8079abe87f90c6131ecf051a937cca7b0c42ffae3c0f3e8b9c7ea59103', 1792790006300),
  ('1317934e2ff996b917dbef723f12f846e6d1961320fb1ba9b0e5c8597398e300', 1792790066300),
  ('57471e6cfdb9c7a60f5d0e1d9c5f74f0b7ae498eb47a3c8fcbe90b99d1565279', 1792349282358);

SELECT is(
  public.missing_drizzle_migration_hashes(ARRAY[
    '1792790126300:a39466b7fd56894cb1037c04fa1854669ea1b0a344781526e00e43b158d646c3',
    '1792789946300:4b92866fc3d1cf4669a1c5d0b85d753c5b1c04eb580585af017a86a50090b917',
    '1792790186300:37b5b26943ae4c070b93ab336e5a562974f77a3f207365d0eed372cf59d522ab',
    '1792790006300:cf6dbe8079abe87f90c6131ecf051a937cca7b0c42ffae3c0f3e8b9c7ea59103'
  ]),
  ARRAY[
    '1792790126300:a39466b7fd56894cb1037c04fa1854669ea1b0a344781526e00e43b158d646c3',
    '1792790186300:37b5b26943ae4c070b93ab336e5a562974f77a3f207365d0eed372cf59d522ab'
  ],
  'z rejestrem: wyłącznie brakujący podzbiór pytania, posortowany'
);
SELECT is(
  public.missing_drizzle_migration_hashes(ARRAY[
    '1792789946300:4b92866fc3d1cf4669a1c5d0b85d753c5b1c04eb580585af017a86a50090b917',
    '1792790006300:cf6dbe8079abe87f90c6131ecf051a937cca7b0c42ffae3c0f3e8b9c7ea59103'
  ]),
  ARRAY[]::text[],
  'każda pytana para w rejestrze = pusta tablica (wdrożenie potwierdzone)'
);
SELECT is(
  public.missing_drizzle_migration_hashes(ARRAY[
    '1792790186300:37b5b26943ae4c070b93ab336e5a562974f77a3f207365d0eed372cf59d522ab',
    '1792790186300:37b5b26943ae4c070b93ab336e5a562974f77a3f207365d0eed372cf59d522ab'
  ]),
  ARRAY['1792790186300:37b5b26943ae4c070b93ab336e5a562974f77a3f207365d0eed372cf59d522ab'],
  'powtórzony brakujący wpis wraca raz'
);
SELECT is(
  public.missing_drizzle_migration_hashes(ARRAY[]::text[]), ARRAY[]::text[],
  'pusta tablica przy niepustym rejestrze niczego nie wylicza'
);
SELECT is(
  public.missing_drizzle_migration_hashes(ARRAY[
    '1792349340560:57471e6cfdb9c7a60f5d0e1d9c5f74f0b7ae498eb47a3c8fcbe90b99d1565279',
    '1792349282358:57471e6cfdb9c7a60f5d0e1d9c5f74f0b7ae498eb47a3c8fcbe90b99d1565279'
  ]),
  ARRAY['1792349340560:57471e6cfdb9c7a60f5d0e1d9c5f74f0b7ae498eb47a3c8fcbe90b99d1565279'],
  'ponowna dostawa (0308/0310): ten sam hash pod `when` wcześniejszego wpisu nie potwierdza późniejszego'
);
SELECT is(
  public.missing_drizzle_migration_hashes(ARRAY[
    '1792789946300:cf6dbe8079abe87f90c6131ecf051a937cca7b0c42ffae3c0f3e8b9c7ea59103'
  ]),
  ARRAY['1792789946300:cf6dbe8079abe87f90c6131ecf051a937cca7b0c42ffae3c0f3e8b9c7ea59103'],
  'inny hash pod tym samym `when` (INNY HASH W REJESTRZE w --verify) to brak, nie potwierdzenie'
);
SELECT ok(
  NOT has_schema_privilege('anon', 'drizzle', 'USAGE'),
  'anon nie ma dostępu do schematu drizzle - czyta rejestr wyłącznie przez sondę'
);
SET LOCAL ROLE anon;
SELECT is(
  public.missing_drizzle_migration_hashes(ARRAY[
    '1792790066300:1317934e2ff996b917dbef723f12f846e6d1961320fb1ba9b0e5c8597398e300',
    '1792790186300:37b5b26943ae4c070b93ab336e5a562974f77a3f207365d0eed372cf59d522ab'
  ]),
  ARRAY['1792790186300:37b5b26943ae4c070b93ab336e5a562974f77a3f207365d0eed372cf59d522ab'],
  'anon (klucz publikowalny CI) dostaje brakujący podzbiór'
);
RESET ROLE;

-- ── 23-30. Wejście spoza kontraktu ─────────────────────────────────────────
SELECT throws_ok(
  $$SELECT public.missing_drizzle_migration_hashes(ARRAY['0399_adopt_event_speaker_panel_bio'])$$,
  '22023', 'drizzle registry probe: every entry must be <when>:<sha256> (when: decimal without leading zeros, at most 16 digits; sha256: 64 lowercase hex characters)',
  'tag zamiast wpisu odrzucony'
);
SELECT throws_ok(
  $$SELECT public.missing_drizzle_migration_hashes(ARRAY['4b92866fc3d1cf4669a1c5d0b85d753c5b1c04eb580585af017a86a50090b917'])$$,
  '22023', 'drizzle registry probe: every entry must be <when>:<sha256> (when: decimal without leading zeros, at most 16 digits; sha256: 64 lowercase hex characters)',
  'sam hash bez `when` (dawny kontrakt) odrzucony - rejestr dopasowuje parę'
);
SELECT throws_ok(
  $$SELECT public.missing_drizzle_migration_hashes(ARRAY['1792789946300:4B92866FC3D1CF4669A1C5D0B85D753C5B1C04EB580585AF017A86A50090B917'])$$,
  '22023', 'drizzle registry probe: every entry must be <when>:<sha256> (when: decimal without leading zeros, at most 16 digits; sha256: 64 lowercase hex characters)',
  'wielkie litery odrzucone (migrator zapisuje hex małymi literami)'
);
SELECT throws_ok(
  $$SELECT public.missing_drizzle_migration_hashes(ARRAY['01792789946300:4b92866fc3d1cf4669a1c5d0b85d753c5b1c04eb580585af017a86a50090b917'])$$,
  '22023', 'drizzle registry probe: every entry must be <when>:<sha256> (when: decimal without leading zeros, at most 16 digits; sha256: 64 lowercase hex characters)',
  'zero wiodące w `when` odrzucone (jedna postać klucza na wpis)'
);
SELECT throws_ok(
  $$SELECT public.missing_drizzle_migration_hashes(ARRAY['12345678901234567:4b92866fc3d1cf4669a1c5d0b85d753c5b1c04eb580585af017a86a50090b917'])$$,
  '22023', 'drizzle registry probe: every entry must be <when>:<sha256> (when: decimal without leading zeros, at most 16 digits; sha256: 64 lowercase hex characters)',
  '`when` dłuższe niż 16 cyfr odrzucone przed rzutowaniem na bigint'
);
SELECT throws_ok(
  $$SELECT public.missing_drizzle_migration_hashes(ARRAY[NULL::text])$$,
  '22023', 'drizzle registry probe: every entry must be <when>:<sha256> (when: decimal without leading zeros, at most 16 digits; sha256: 64 lowercase hex characters)',
  'NULL w tablicy odrzucony'
);
SELECT throws_ok(
  $$SELECT public.missing_drizzle_migration_hashes(ARRAY['1:x'' OR true) --'])$$,
  '22023', 'drizzle registry probe: every entry must be <when>:<sha256> (when: decimal without leading zeros, at most 16 digits; sha256: 64 lowercase hex characters)',
  'próba wstrzyknięcia odrzucona przed zapytaniem (a zapytanie i tak bierze tablicę parametrem)'
);
SELECT throws_ok(
  $$SELECT public.missing_drizzle_migration_hashes(
      ARRAY(SELECT g::text || ':' || encode(sha256(convert_to(g::text, 'UTF8')), 'hex')
              FROM generate_series(1, 1001) g))$$,
  '22023', 'drizzle registry probe: maximum 1000 entries per request',
  'ponad 1000 wpisów w jednym pytaniu odrzucone (klient pyta po 40)'
);

SELECT * FROM finish();
ROLLBACK;
