-- pgTAP: korekta skutków hurtowego UPDATE z wpisu dziennika 0001 cofa do false
-- WYŁĄCZNIE profile, których baza dowodzi braku decyzji - i nic więcej.
--
-- Weryfikuje migrację 20261025090030_profiles_discoverable_0001_correction.sql
-- (oraz jej współpracę ze znacznikiem decyzji z 20261025090020).
--
-- PO CO TO STOI. `drizzle/migrations/0001_profiles_discoverable_default_true.sql`
-- przestawiło każdy profil z false na true. Korekta mierzy ślad 0001 na bazie,
-- w której działa (klaster identycznych `updated_at` w oknie when(0001) ± 1 h),
-- więc fikstura odtwarza tę historię jawnymi znacznikami czasu: T0001 =
-- 2026-09-11 18:12:10.523+00, a wyzwalacz `profiles_set_updated` jest wyłączony
-- tylko na moment przesunięć `updated_at` (konwencja suity, np.
-- newsletter_settings_patch_test). Baza z pasa supabase nie ma tego śladu,
-- więc migracja była na niej no-opem - asercje 8-9 to przypinają.
--
-- CO PRZYPINA
--   1-7.   rejestr korekty (RLS bez polityk, klient bez grantów, service_role:
--          SELECT, INSERT, UPDATE tylko `notified_at`) i funkcja (SECURITY
--          INVOKER, search_path i lock_timeout przypięte, EXECUTE tylko
--          service_role, klient dostaje 42501);
--   8-9.   baza z tego pasa: rejestr pusty, wynik `no_cluster`;
--   10-13. bezpieczniki bez zmian: klaster za mały, dwa podobne klastry,
--          podpis niezgodny (false w klastrze), brak T_RESTORE pomija kubeł B;
--   14.    podgląd: T0001, T_RESTORE i liczebności kubłów;
--   15-18. błędy w trakcie korekty: przejściowy (55P03, 40P01) wychodzi
--          z funkcji, więc wsad migratora wycofa się i da ponowić; trwały
--          (P0001) to wiersz `error` bez wyjątku; błąd przycięcia embeddingów
--          (55P03) NIE unieważnia korekty (przebieg próbny w wycofanej
--          podtransakcji);
--   19-25. potem korekta jako service_role: kubeł A (przestawieni
--          i niezmieniani), kubeł B (rejestracja z okna DEFAULT true,
--          niezmieniana), T_RESTORE przycięte do when(0013) + 1 h; opt-in
--          sprzed 0001, późniejszy przełącznik, edycja i anomalia za sufitem
--          NIETKNIĘTE; rejestr przed przestawieniem, bez stempla decyzji,
--          embedding usunięty;
--   26-28. drugi przebieg: `already_applied`, zero zmian; potwierdzenie
--          właściciela zdejmuje go z kubła C.
--
-- Awarię w trakcie przestawiania symuluje wyzwalacz testu na `profiles`
-- (SQLSTATE z ustawienia `korekta_test.sqlstate`), a awarię przycięcia -
-- podmieniona `prune_profile_embeddings()`; oba znikają przed korektą 19-25.
-- WYZWALACZE UŻYTKOWNIKA NA auth.users WYŁĄCZONE - konwencja suity.
BEGIN;
SELECT plan(28);

ALTER TABLE auth.users DISABLE TRIGGER USER;

-- ── 1-7. Rejestr i funkcja: kształt i granty ────────────────────────────────
SELECT ok(
  (SELECT c.relrowsecurity FROM pg_class c
    WHERE c.oid = 'public.profiles_discoverable_corrections'::regclass)
  AND NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public' AND tablename = 'profiles_discoverable_corrections'
  ),
  'profiles_discoverable_corrections: RLS włączone, zero polityk'
);

SELECT ok(
  NOT has_table_privilege('anon', 'public.profiles_discoverable_corrections', 'SELECT, INSERT, UPDATE, DELETE')
  AND NOT has_table_privilege('authenticated', 'public.profiles_discoverable_corrections', 'SELECT, INSERT, UPDATE, DELETE')
  AND NOT EXISTS (
    SELECT 1 FROM pg_class c, aclexplode(c.relacl) a
     WHERE c.oid = 'public.profiles_discoverable_corrections'::regclass AND a.grantee = 0
  ),
  'rejestr korekty: PUBLIC, anon i authenticated bez żadnego uprawnienia'
);

SELECT ok(
  has_table_privilege('service_role', 'public.profiles_discoverable_corrections', 'SELECT')
  AND has_table_privilege('service_role', 'public.profiles_discoverable_corrections', 'INSERT')
  AND has_column_privilege('service_role', 'public.profiles_discoverable_corrections', 'notified_at', 'UPDATE')
  AND NOT has_column_privilege('service_role', 'public.profiles_discoverable_corrections', 'bucket', 'UPDATE')
  AND NOT has_column_privilege('service_role', 'public.profiles_discoverable_corrections', 'corrected_at', 'UPDATE')
  AND NOT has_table_privilege('service_role', 'public.profiles_discoverable_corrections', 'DELETE'),
  'rejestr korekty: service_role czyta i dopisuje, zmienia wyłącznie notified_at, nie kasuje (wiersz jest dowodem)'
);

SELECT ok(
  NOT (SELECT p.prosecdef FROM pg_proc p
        WHERE p.oid = 'public._profiles_discoverable_0001_correction(boolean)'::regprocedure),
  '_profiles_discoverable_0001_correction jest SECURITY INVOKER'
);

SELECT is(
  (SELECT p.proconfig FROM pg_proc p
    WHERE p.oid = 'public._profiles_discoverable_0001_correction(boolean)'::regprocedure),
  ARRAY['search_path=public, pg_temp', 'lock_timeout=5s'],
  'funkcja korekty: przypięty search_path i lock_timeout 5 s (tylko na czas wywołania)'
);

SELECT ok(
  NOT has_function_privilege('anon', 'public._profiles_discoverable_0001_correction(boolean)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public._profiles_discoverable_0001_correction(boolean)', 'EXECUTE')
  AND has_function_privilege('service_role', 'public._profiles_discoverable_0001_correction(boolean)', 'EXECUTE')
  AND NOT EXISTS (
    SELECT 1 FROM pg_proc p, aclexplode(p.proacl) a
     WHERE p.oid = 'public._profiles_discoverable_0001_correction(boolean)'::regprocedure AND a.grantee = 0
  ),
  'funkcja korekty: EXECUTE wyłącznie service_role'
);

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"e8c00000-0000-4000-8000-000000000001","role":"authenticated"}', true);
SELECT throws_ok(
  $$ SELECT * FROM public._profiles_discoverable_0001_correction(false) $$,
  '42501', NULL,
  'zalogowany klient nie wywoła korekty (42501)'
);
RESET ROLE;

-- ── 8-9. Baza z tego pasa: brak śladu 0001, migracja była no-opem ───────────
SELECT is(
  (SELECT count(*)::integer FROM public.profiles_discoverable_corrections),
  0,
  'baza z pasa supabase: migracja niczego nie zapisała w rejestrze'
);

SELECT is(
  (SELECT status FROM public._profiles_discoverable_0001_correction(false)),
  'no_cluster',
  'baza z pasa supabase: brak klastra w oknie 0001 -> no_cluster'
);

-- ── Fikstura: historia 0001 (T0001 = 2026-09-11 18:12:10.523+00) ────────────
INSERT INTO public.tenants (id, slug, name) VALUES
  ('e8c00000-0000-4000-8000-000000000000', 'korekta-0001', 'Korekta 0001');

INSERT INTO auth.users (id, email)
SELECT ('e8c00000-0000-4000-8000-0000000000' || lpad(n::text, 2, '0'))::uuid,
       'k' || n || '@korekta.test'
  FROM generate_series(1, 30) n;

INSERT INTO public.profiles (id, tenant_id, email, display_name, discoverable, created_at, updated_at)
SELECT ('e8c00000-0000-4000-8000-0000000000' || lpad(v.n::text, 2, '0'))::uuid,
       'e8c00000-0000-4000-8000-000000000000', 'k' || v.n || '@korekta.test', 'K' || v.n,
       v.d, v.c::timestamptz, v.u::timestamptz
  FROM (VALUES
    -- 01-09: przestawieni przez 0001 i niezmieniani (klaster T0001; 10-12 dojdą niżej)
    (1, true, '2026-08-01 08:00+00', '2026-09-11 18:12:10.523+00'),
    (2, true, '2026-08-02 08:00+00', '2026-09-11 18:12:10.523+00'),
    (3, true, '2026-08-03 08:00+00', '2026-09-11 18:12:10.523+00'),
    (4, true, '2026-08-04 08:00+00', '2026-09-11 18:12:10.523+00'),
    (5, true, '2026-08-05 08:00+00', '2026-09-11 18:12:10.523+00'),
    (6, true, '2026-08-06 08:00+00', '2026-09-11 18:12:10.523+00'),
    (7, true, '2026-08-07 08:00+00', '2026-09-11 18:12:10.523+00'),
    (8, true, '2026-08-08 08:00+00', '2026-09-11 18:12:10.523+00'),
    (9, true, '2026-08-09 08:00+00', '2026-09-11 18:12:10.523+00'),
    -- 15: opt-in sprzed 0001 (0001 go nie dotknęło)
    (15, true, '2026-07-03 08:00+00', '2026-08-15 08:00+00'),
    -- 17: przestawiony, potem sam się wypisał; 18: przestawiony, potem sam włączył
    (17, false, '2026-08-17 08:00+00', '2026-09-20 08:00+00'),
    (18, true, '2026-08-18 08:00+00', '2026-09-21 08:00+00'),
    -- 20-21: przestawieni, potem wsadowa akcja administratora w oknie 0001 (szum)
    (20, true, '2026-08-20 08:00+00', '2026-09-11 18:40:00+00'),
    (21, true, '2026-08-21 08:00+00', '2026-09-11 18:40:00+00'),
    -- 22: rejestracja w oknie DEFAULT true, niezmieniana; 24: ta sama, edytowana
    (22, true, '2026-09-12 09:00+00', '2026-09-12 09:00+00'),
    (24, true, '2026-09-12 10:00+00', '2026-09-12 10:05+00'),
    -- 27: rejestracja po oknie z własnym opt-inem
    (27, true, '2026-09-15 08:00+00', '2026-09-16 08:00+00'),
    -- 28: anomalia - true wstawione wprost po powrocie DEFAULT-u (20:40), za
    -- sufitem when(0013) + 1 h, a przed pierwszym kontem z false (21:00)
    (28, true, '2026-09-13 20:40+00', '2026-09-13 20:40+00')
  ) AS v(n, d, c, u);

-- Pozostałe profile bazy (seed): niezmieniane konta z false założone po T0001
-- wyznaczałyby T_RESTORE - tu mają go nie wyznaczać (asercja 13).
ALTER TABLE public.profiles DISABLE TRIGGER profiles_set_updated;
UPDATE public.profiles SET updated_at = created_at + interval '1 minute'
 WHERE tenant_id <> 'e8c00000-0000-4000-8000-000000000000'
   AND created_at > '2026-09-11 18:12:10.523+00'
   AND updated_at = created_at
   AND NOT discoverable;
ALTER TABLE public.profiles ENABLE TRIGGER profiles_set_updated;

INSERT INTO public.profile_embeddings (profile_id, tenant_id, content_hash, embedding)
VALUES ('e8c00000-0000-4000-8000-000000000001', 'e8c00000-0000-4000-8000-000000000000',
        'hash-k1', array_fill(0.1::double precision, ARRAY[768])::extensions.vector);

-- ── 10-13. Bezpieczniki: wynik diagnostyczny, ZERO zmian ────────────────────
SELECT is(
  (SELECT status || '|' || cluster_rows FROM public._profiles_discoverable_0001_correction(true)),
  'cluster_too_small|9',
  'klaster 9 wierszy (< 10) -> cluster_too_small, korekta nie rusza niczego'
);

INSERT INTO public.profiles (id, tenant_id, email, display_name, discoverable, created_at, updated_at)
SELECT ('e8c00000-0000-4000-8000-0000000000' || lpad(v.n::text, 2, '0'))::uuid,
       'e8c00000-0000-4000-8000-000000000000', 'k' || v.n || '@korekta.test', 'K' || v.n,
       v.d, v.c::timestamptz, v.u::timestamptz
  FROM (VALUES
    -- 10-12: dopełnienie klastra T0001 do 12
    (10, true, '2026-08-10 08:00+00', '2026-09-11 18:12:10.523+00'),
    (11, true, '2026-08-11 08:00+00', '2026-09-11 18:12:10.523+00'),
    (12, true, '2026-08-12 08:00+00', '2026-09-11 18:12:10.523+00'),
    -- 29-30 + 17: drugi, podobny klaster w oknie (18:50)
    (29, false, '2026-08-29 08:00+00', '2026-09-11 18:50:00+00'),
    (30, false, '2026-08-30 08:00+00', '2026-09-11 18:50:00+00')
  ) AS v(n, d, c, u);

ALTER TABLE public.profiles DISABLE TRIGGER profiles_set_updated;
UPDATE public.profiles SET updated_at = '2026-09-11 18:50:00+00'
 WHERE id = 'e8c00000-0000-4000-8000-000000000017';
ALTER TABLE public.profiles ENABLE TRIGGER profiles_set_updated;

SELECT is(
  (SELECT status || '|' || cluster_rows || '|' || next_cluster_rows
     FROM public._profiles_discoverable_0001_correction(true)),
  'cluster_not_dominant|12|3',
  'dwa podobne klastry (12 i 3: zapas < 5x) -> cluster_not_dominant, bez zmian'
);

-- Drugi klaster wraca poza okno; do klastra T0001 trafia wiersz z false.
ALTER TABLE public.profiles DISABLE TRIGGER profiles_set_updated;
UPDATE public.profiles SET updated_at = '2026-09-20 08:00+00'
 WHERE id IN ('e8c00000-0000-4000-8000-000000000017',
              'e8c00000-0000-4000-8000-000000000029',
              'e8c00000-0000-4000-8000-000000000030');
UPDATE public.profiles SET updated_at = '2026-09-11 18:12:10.523+00'
 WHERE id = 'e8c00000-0000-4000-8000-000000000029';
ALTER TABLE public.profiles ENABLE TRIGGER profiles_set_updated;

SELECT is(
  (SELECT status FROM public._profiles_discoverable_0001_correction(true)),
  'cluster_signature_mismatch',
  'wiersz z false w klastrze T0001 (to nie jest podpis SET discoverable = true) -> bez zmian'
);

ALTER TABLE public.profiles DISABLE TRIGGER profiles_set_updated;
UPDATE public.profiles SET updated_at = '2026-09-20 08:00+00'
 WHERE id = 'e8c00000-0000-4000-8000-000000000029';
ALTER TABLE public.profiles ENABLE TRIGGER profiles_set_updated;

SELECT results_eq(
  $$ SELECT status, measured_t_restore, bucket_a_rows, bucket_b_rows
       FROM public._profiles_discoverable_0001_correction(false) $$,
  $$ VALUES ('dry_run'::text, NULL::timestamptz, 12, 0) $$,
  'bez niezmienianego konta z false po T0001: T_RESTORE nieustalone, kubeł B pominięty'
);

-- 26: pierwsza niezmieniana rejestracja z false po T0001 (DEFAULT false wrócił).
INSERT INTO public.profiles (id, tenant_id, email, display_name, discoverable, created_at, updated_at) VALUES
  ('e8c00000-0000-4000-8000-000000000026', 'e8c00000-0000-4000-8000-000000000000',
   'k26@korekta.test', 'K26', false, '2026-09-13 21:00+00', '2026-09-13 21:00+00');

-- ── 14. Podgląd ─────────────────────────────────────────────────────────────
SELECT results_eq(
  $$ SELECT status, measured_t0001, measured_t_restore, cluster_rows, next_cluster_rows,
            bucket_a_rows, bucket_b_rows, bucket_c_rows
       FROM public._profiles_discoverable_0001_correction(false) $$,
  $$ VALUES ('dry_run'::text, '2026-09-11 18:12:10.523+00'::timestamptz,
             '2026-09-13 20:12:36.549+00'::timestamptz, 12, 2, 12, 1, 4) $$,
  'podgląd: T0001 z klastra, T_RESTORE (21:00) przycięte do when(0013) + 1 h, A 12, B 1, C 4'
);

-- ── 15-18. Błędy w trakcie korekty ──────────────────────────────────────────
CREATE FUNCTION public.korekta_test_awaria() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
  RAISE EXCEPTION 'symulowana awaria przestawienia'
    USING ERRCODE = current_setting('korekta_test.sqlstate');
END;
$fn$;
CREATE TRIGGER korekta_test_awaria_trg
  BEFORE UPDATE OF discoverable ON public.profiles
  FOR EACH ROW WHEN (NOT NEW.discoverable)
  EXECUTE FUNCTION public.korekta_test_awaria();

SELECT set_config('korekta_test.sqlstate', '55P03', true);
SELECT throws_ok(
  $$ SELECT * FROM public._profiles_discoverable_0001_correction(true) $$,
  '55P03', NULL,
  'blokada ponad lock_timeout (55P03) wychodzi z funkcji: wsad migratora wycofa się i da ponowić'
);

SELECT set_config('korekta_test.sqlstate', '40P01', true);
SELECT throws_ok(
  $$ SELECT * FROM public._profiles_discoverable_0001_correction(true) $$,
  '40P01', NULL,
  'zakleszczenie (40P01) wychodzi z funkcji: wsad migratora wycofa się i da ponowić'
);

SELECT set_config('korekta_test.sqlstate', 'P0001', true);
SELECT results_eq(
  $$ SELECT status, left(detail, 6), bucket_a_rows, bucket_b_rows, bucket_c_rows IS NULL
       FROM public._profiles_discoverable_0001_correction(true) $$,
  $$ VALUES ('error'::text, 'P0001:'::text, 0, 0, true) $$,
  'trwały błąd (P0001) to wiersz error bez wyjątku - rejestr i przestawienia wycofane razem'
);

DROP TRIGGER korekta_test_awaria_trg ON public.profiles;
DROP FUNCTION public.korekta_test_awaria();

-- Przebieg próbny w podtransakcji wycofanej na końcu: wynik zostaje w zmiennych.
CREATE TEMP TABLE korekta_bez_przyciecia (status text, a integer, b integer, pruned integer, rejestr integer)
  ON COMMIT DROP;
DO $probe$
DECLARE
  r record;
  n integer;
BEGIN
  BEGIN
    CREATE OR REPLACE FUNCTION public.prune_profile_embeddings() RETURNS integer
    LANGUAGE plpgsql AS $fn$
    BEGIN
      RAISE EXCEPTION 'wiersz embeddingu zablokowany' USING ERRCODE = 'lock_not_available';
    END;
    $fn$;
    SELECT * INTO r FROM public._profiles_discoverable_0001_correction(true);
    SELECT count(*)::integer INTO n FROM public.profiles_discoverable_corrections;
    RAISE EXCEPTION 'przebieg próbny wycofany' USING ERRCODE = 'XT001';
  EXCEPTION WHEN SQLSTATE 'XT001' THEN
    NULL;
  END;
  INSERT INTO korekta_bez_przyciecia
  VALUES (r.status, r.bucket_a_rows, r.bucket_b_rows, r.embeddings_pruned, n);
END
$probe$;

SELECT results_eq(
  $$ SELECT status, a, b, pruned IS NULL, rejestr FROM korekta_bez_przyciecia $$,
  $$ VALUES ('applied'::text, 12, 1, true, 13) $$,
  'błąd przycięcia embeddingów (55P03) nie unieważnia korekty: applied, A 12, B 1, rejestr 13, embeddings_pruned NULL'
);

-- ── 19-25. Korekta jako service_role ────────────────────────────────────────
SELECT ok(
  (SELECT count(*) FROM public.profiles_discoverable_corrections) = 0
  AND (SELECT count(*) FROM public.profiles
        WHERE tenant_id = 'e8c00000-0000-4000-8000-000000000000' AND discoverable) = 20
  AND to_regprocedure('public.korekta_test_awaria()') IS NULL
  AND (SELECT p.prosecdef FROM pg_proc p
        WHERE p.oid = 'public.prune_profile_embeddings()'::regprocedure),
  'podgląd, bezpieczniki, błędy i przebieg próbny niczego nie zapisały ani nie przestawiły; prune_profile_embeddings z migracji'
);

SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);
CREATE TEMP TABLE korekta_wynik ON COMMIT DROP AS
SELECT * FROM public._profiles_discoverable_0001_correction(true);
RESET ROLE;

SELECT results_eq(
  $$ SELECT status, bucket_a_rows, bucket_b_rows, bucket_c_rows, embeddings_pruned >= 1
       FROM korekta_wynik $$,
  $$ VALUES ('applied'::text, 12, 1, 4, true) $$,
  'korekta jako service_role: applied, A 12, B 1, C 4, embeddingi przycięte'
);

SELECT results_eq(
  $$ SELECT right(profile_id::text, 2), bucket
       FROM public.profiles_discoverable_corrections
      ORDER BY profile_id $$,
  $$ VALUES ('01', 'flipped_by_0001_untouched'), ('02', 'flipped_by_0001_untouched'),
            ('03', 'flipped_by_0001_untouched'), ('04', 'flipped_by_0001_untouched'),
            ('05', 'flipped_by_0001_untouched'), ('06', 'flipped_by_0001_untouched'),
            ('07', 'flipped_by_0001_untouched'), ('08', 'flipped_by_0001_untouched'),
            ('09', 'flipped_by_0001_untouched'), ('10', 'flipped_by_0001_untouched'),
            ('11', 'flipped_by_0001_untouched'), ('12', 'flipped_by_0001_untouched'),
            ('22', 'default_true_window_signup') $$,
  'rejestr: kubeł A = 01-12, kubeł B = 22 (rejestracja z okna DEFAULT true, niezmieniana)'
);

SELECT ok(
  NOT EXISTS (
    SELECT 1 FROM public.profiles_discoverable_corrections r
      JOIN public.profiles p ON p.id = r.profile_id
     WHERE p.discoverable
        OR p.discoverable_decided_at IS NOT NULL
        OR r.t0001 <> '2026-09-11 18:12:10.523+00'
        OR r.t_restore <> '2026-09-13 20:12:36.549+00'
        OR r.corrected_at <> now()
        OR r.notified_at IS NOT NULL
  ),
  'każdy zapisany ma false, bez stempla decyzji; rejestr niesie zmierzone T0001/T_RESTORE'
);

SELECT results_eq(
  $$ SELECT right(id::text, 2) FROM public.profiles
      WHERE tenant_id = 'e8c00000-0000-4000-8000-000000000000' AND discoverable
      ORDER BY id $$,
  $$ VALUES ('15'), ('18'), ('20'), ('21'), ('24'), ('27'), ('28') $$,
  'nietknięci: opt-in sprzed 0001 (15), późniejszy przełącznik (18), szum (20, 21), edycja (24), po oknie (27), anomalia za sufitem (28)'
);

SELECT ok(
  (SELECT NOT discoverable FROM public.profiles WHERE id = 'e8c00000-0000-4000-8000-000000000017')
  AND (SELECT NOT discoverable FROM public.profiles WHERE id = 'e8c00000-0000-4000-8000-000000000026')
  AND NOT EXISTS (
    SELECT 1 FROM public.profiles_discoverable_corrections
     WHERE profile_id IN ('e8c00000-0000-4000-8000-000000000017',
                          'e8c00000-0000-4000-8000-000000000026')
  ),
  'false z decyzji (17) i z DEFAULT-u (26) zostaje i nie trafia do rejestru'
);

SELECT is(
  (SELECT count(*)::integer FROM public.profile_embeddings
    WHERE profile_id = 'e8c00000-0000-4000-8000-000000000001'),
  0,
  'embedding profilu z kubła A usunięty (prune_profile_embeddings)'
);

-- ── 26-28. Drugi przebieg i potwierdzenie właściciela ──────────────────────
SELECT results_eq(
  $$ SELECT status, measured_t0001, measured_t_restore, cluster_rows,
            bucket_a_rows, bucket_b_rows, bucket_c_rows
       FROM public._profiles_discoverable_0001_correction(true) $$,
  $$ VALUES ('already_applied'::text, '2026-09-11 18:12:10.523+00'::timestamptz,
             '2026-09-13 20:12:36.549+00'::timestamptz, NULL::integer, 12, 1, 4) $$,
  'drugi przebieg: already_applied z wartościami z rejestru'
);

SELECT ok(
  (SELECT count(*) FROM public.profiles_discoverable_corrections) = 13
  AND (SELECT count(*) FROM public.profiles
        WHERE tenant_id = 'e8c00000-0000-4000-8000-000000000000' AND discoverable) = 7,
  'drugi przebieg niczego nie zmienił (rejestr 13, true 7)'
);

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"e8c00000-0000-4000-8000-000000000018","role":"authenticated"}', true);
UPDATE public.profiles SET discoverable = true
 WHERE id = 'e8c00000-0000-4000-8000-000000000018';
RESET ROLE;

SELECT is(
  (SELECT bucket_c_rows FROM public._profiles_discoverable_0001_correction(false)),
  3,
  'potwierdzenie właściciela (18) stempluje decyzję i zdejmuje go z kubła C (4 -> 3)'
);

SELECT * FROM finish();
ROLLBACK;
