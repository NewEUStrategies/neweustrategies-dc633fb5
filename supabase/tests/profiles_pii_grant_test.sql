-- pgTAP: profiles PII exposure fixes (migracje 20260708170000 -> 20260803095618).
--
-- Guards two regressions:
--   1. authenticated must NOT be able to read profiles.email / profiles.prefs
--      (a table-level GRANT SELECT had re-exposed every column to all staff),
--      while the public-safe columns stay readable so bylines and own-profile
--      editing keep working.
--   2. anon must have NO access to the profiles BASE TABLE at all. Publiczne
--      dane autorow wychodza wylacznie widokami (`profiles_public`,
--      `author_profiles_public`).
--
-- AKTUALIZACJA 2026-08-03: sekcja (2) sprawdzala wczesniej WIDOCZNOSC WIERSZY
-- dla anona w `public.profiles` ("anon nie widzi zwyklego czytelnika, widzi
-- autora"), zakladajac grant SELECT dla anona + filtrowanie przez RLS. Migracja
-- 20260803095618 swiadomie zlikwidowala te sciezke:
--
--     -- 1. Remove anon row-level read on profiles base table (full-row PII exposure).
--     DROP POLICY IF EXISTS "Profiles anon public authors" ON public.profiles;
--     REVOKE ALL ON public.profiles FROM anon;
--
-- Test asertowal wiec dostep, ktory jest teraz NIEPOZADANY, i padal na
-- "permission denied for table profiles" (Bad plan: planned 10 but ran 8).
-- Awaria byla niewidoczna, dopoki `supabase db start` nie umial odtworzyc bazy -
-- pgTAP nie startowal wcale (patrz WDROZENIE_CONSENT_GPC_2026-08-03.md).
--
-- Sekcja (2) pilnuje teraz STANU KONCOWEGO, i to mocniej niz wczesniej: brak
-- grantu tabelarycznego, brak grantu KOLUMNOWEGO (to ta pulapka, przed ktora
-- ostrzega 20260801120000: "REVOKE tabelaryczny zeruje takze ACL kolumnowe"),
-- brak polityki anona - ORAZ dowod, ze sankcjonowana sciezka publiczna nadal
-- dziala, bo utwardzenie bez dzialajacego widoku zabiloby publiczne profile
-- autorow. Asercje sa czysto katalogowe/ACL-owe, wiec plik nie potrzebuje juz
-- fixture'ow ani `ALTER TABLE auth.users DISABLE TRIGGER USER`.
--
-- Running: see supabase/tests/README.md (`supabase test db`).

BEGIN;
SELECT plan(14);

-- ── (1) Column-level privileges of the authenticated role ───────────────────
-- These read the live ACL, so they assert the exact outcome of the REVOKE.
SELECT ok(
  NOT has_column_privilege('authenticated', 'public.profiles', 'email', 'SELECT'),
  'authenticated CANNOT SELECT profiles.email (account e-mail stays private)'
);
SELECT ok(
  NOT has_column_privilege('authenticated', 'public.profiles', 'prefs', 'SELECT'),
  'authenticated CANNOT SELECT profiles.prefs (private preferences/consent stay private)'
);
SELECT ok(
  has_column_privilege('authenticated', 'public.profiles', 'display_name', 'SELECT'),
  'authenticated CAN still SELECT profiles.display_name (author bylines keep working)'
);
SELECT ok(
  has_column_privilege('authenticated', 'public.profiles', 'first_name', 'SELECT'),
  'authenticated CAN still SELECT profiles.first_name (bylines keep working)'
);
-- Personal PII: NOT readable role-wide (20260720120000). A staff `author` must
-- not be able to enumerate every tenant member''s contact/phone/gender/location.
-- Own row stays readable via public.get_own_profile(); admins via admin_get_user().
SELECT ok(
  NOT has_column_privilege('authenticated', 'public.profiles', 'contact_email', 'SELECT'),
  'authenticated CANNOT SELECT profiles.contact_email role-wide (own row via get_own_profile)'
);
SELECT ok(
  NOT has_column_privilege('authenticated', 'public.profiles', 'phone', 'SELECT'),
  'authenticated CANNOT SELECT profiles.phone role-wide'
);
SELECT ok(
  NOT has_column_privilege('authenticated', 'public.profiles', 'gender', 'SELECT'),
  'authenticated CANNOT SELECT profiles.gender role-wide'
);
SELECT ok(
  NOT has_column_privilege('authenticated', 'public.profiles', 'location', 'SELECT'),
  'authenticated CANNOT SELECT profiles.location role-wide'
);

-- ── (2) anon: ZERO dostepu do tabeli bazowej profiles ───────────────────────
-- Kontrakt z 20260803095618. Sprawdzany na trzech poziomach, bo kazdy osobno
-- wystarcza do wycieku, gdyby wrocil.
SELECT ok(
  NOT has_table_privilege('anon', 'public.profiles', 'SELECT'),
  'anon has NO table-level SELECT on profiles (20260803095618 revoked it)'
);
-- Kolumnowe ACL tez musi byc puste. `REVOKE ALL ON <table>` zeruje je razem
-- z grantem tabelarycznym (patrz nota w 20260801120000) - i tak ma zostac.
SELECT ok(
  NOT has_column_privilege('anon', 'public.profiles', 'display_name', 'SELECT'),
  'anon has NO column-level SELECT on profiles.display_name either'
);
-- Polityka anona zdjeta razem z grantem: nawet gdyby grant wrocil, zaden
-- wiersz nie przeszedlby przez RLS.
SELECT is(
  (SELECT count(*)::int FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'profiles'
      AND policyname = 'Profiles anon public authors'),
  0,
  'policy "Profiles anon public authors" is gone (dropped in 20260803095618)'
);

-- ── (3) sankcjonowana sciezka publiczna nadal dziala ───────────────────────
-- Utwardzenie bez dzialajacych widokow zabiloby publiczne profile autorow -
-- ta sekcja pilnuje, ze zamknieto furtke, a nie funkcje.
--
-- Asercje sa KATALOGOWE, nie wykonawcze, i to jest swiadomy wybor: zeby zrobic
-- realny `SELECT` jako anon, trzeba by wolac funkcje pgTAP z rola anon, a te
-- zyja w schemacie `extensions`, do ktorego anon nie musi miec USAGE. Test
-- padalby wtedy z powodu wlasnej mechaniki, nie z powodu regresji. Grant + tryb
-- widoku odpowiadaja dokladnie na pytanie "czy anon to przeczyta".
SELECT ok(
  has_table_privilege('anon', 'public.profiles_public', 'SELECT'),
  'anon CAN read public.profiles_public (sanctioned public projection of profiles)'
);
SELECT ok(
  has_table_privilege('anon', 'public.author_profiles_public', 'SELECT'),
  'anon CAN read public.author_profiles_public (sanctioned public author profile)'
);
-- Oba widoki musza zostac definer-style. Z `security_invoker = on` anon
-- czytalby je PRAWAMI WLASNYMI, wiec sekcja (2) (zero grantow na tabeli
-- bazowej) zamienilaby publiczne profile autorow w 42501 - grant na widoku
-- bylby wtedy pozorny.
SELECT is(
  (SELECT count(*)::int
     FROM pg_class c
     JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname IN ('profiles_public', 'author_profiles_public')
      AND 'security_invoker=on' = ANY(coalesce(c.reloptions, '{}'))),
  0,
  'both public profile views stay definer-style (no security_invoker=on)'
);

SELECT * FROM finish();
ROLLBACK;
