-- ============================================================================
-- KONTRAKT: funkcje wolajace pgcrypto MUSZA miec `extensions` na search_path.
--
-- Po co osobny plik. Na Supabase `pgcrypto` mieszka w schemacie `extensions`
-- (migracje instaluja je jawnie `WITH SCHEMA extensions`, 20260805090000
-- i 20260805114407). Funkcja SECURITY DEFINER z PRZYPIETYM `SET search_path
-- = public` nie widzi wiec `gen_random_bytes` - przypieta sciezka nadpisuje
-- sesyjna, wiec nie pomaga nawet poprawnie ustawiona sciezka wolajacego.
-- Wywolanie pada z 42883 "function gen_random_bytes(integer) does not exist".
--
-- Dlaczego to musi byc BRAMKA, a nie komentarz. Ta usterka byla juz raz
-- naprawiona: `20260808060751` dalo `club_anonymity_salt` sciezke
-- `public, extensions`. Trzy godziny pozniej `20260808110000` (a8_hardening)
-- przedeklarowalo te funkcje przez `CREATE OR REPLACE` z powrotem na
-- `search_path = public` - i naprawa zniknela bez sladu w diffie tamtej
-- migracji. Skutek: KAZDE utworzenie klubu konczylo sie bledem, bo sol
-- pseudonimow Chatham House sieje trigger AFTER INSERT ON clubs. Piec plikow
-- pgTAP modulu klubow bylo czerwonych, a `lives_ok` nie podaje tresci bledu,
-- wiec log pokazywal tylko "nie zyje".
--
-- Asercja strukturalna nizej wylapie kazde nastepne takie przedeklarowanie
-- w momencie, w ktorym powstanie - niezaleznie od tego, ktora funkcja i ktory
-- modul je wprowadzi.
-- ============================================================================
BEGIN;
SELECT plan(4);

-- ── 1. Kontrakt strukturalny ────────────────────────────────────────────────
-- Kazda funkcja w `public`, ktora wola funkcje pgcrypto BEZ kwalifikatora
-- schematu i ma przypieta sciezke, musi miec na niej `extensions`.
-- Wzorzec `[^.[:alnum:]_]` przed nazwa odsiewa wywolania kwalifikowane
-- (`extensions.gen_random_bytes`), ktore sa poprawne same z siebie.
SELECT is_empty($$
  SELECT p.oid::regprocedure::text AS zla_funkcja
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.prosrc ~ '(^|[^.[:alnum:]_])(gen_random_bytes|gen_salt|crypt|digest|hmac)[[:space:]]*\('
     -- tylko funkcje z PRZYPIETA sciezka: bez przypiecia dziedzicza sesyjna
     -- i o ich rozstrzyganiu decyduje wolajacy, nie definicja
     AND EXISTS (
       SELECT 1 FROM unnest(COALESCE(p.proconfig, '{}'::text[])) c
        WHERE c LIKE 'search_path=%'
     )
     AND NOT EXISTS (
       SELECT 1 FROM unnest(COALESCE(p.proconfig, '{}'::text[])) c
        WHERE c LIKE 'search_path=%' AND c LIKE '%extensions%'
     )
   ORDER BY 1
$$, 'zadna funkcja nie wola pgcrypto bez kwalifikatora przy search_path bez `extensions`');

-- ── 2. Trzy funkcje, ktore ten kontrakt zlamaly, maja go spelniac wprost ────
-- Asercja imienna obok generycznej: gdyby ktos zawezil wzorzec wyzej, te trzy
-- nazwy nadal beda pilnowane, bo one juz raz kosztowaly czerwona bramke.
SELECT bag_eq($$
  SELECT p.proname::text
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname IN ('club_anonymity_salt',
                       'admin_club_invite_link_create',
                       'newsletter_subscribers_ensure_unsub_token')
     AND EXISTS (
       SELECT 1 FROM unnest(COALESCE(p.proconfig, '{}'::text[])) c
        WHERE c LIKE 'search_path=%' AND c LIKE '%extensions%'
     )
$$, $$
  VALUES ('club_anonymity_salt'), ('admin_club_invite_link_create'),
         ('newsletter_subscribers_ensure_unsub_token')
$$, 'club_anonymity_salt, admin_club_invite_link_create i trigger tokenu newslettera widza `extensions`');

-- ── 3. Dowod ZACHOWANIA, nie tylko konfiguracji ─────────────────────────────
-- Kontrakt strukturalny moze byc spelniony, a rozszerzenie i tak nieobecne.
-- Ta asercja wola realna sciezke: leniwe zasianie soli anonimowosci.
INSERT INTO public.tenants (id, name, slug)
VALUES ('ee111111-1111-1111-1111-111111111111', 'Tenant search_path', 'tenant-searchpath-contract')
ON CONFLICT (id) DO NOTHING;

SELECT lives_ok(
  $$SELECT public.club_anonymity_salt('ee111111-1111-1111-1111-111111111111')$$,
  'club_anonymity_salt sieje sol bez 42883 (gen_random_bytes rozstrzyga sie)');

-- Sol to 32 bajty w hex, czyli 64 znaki - pusty ciag albo NULL oznaczalby, ze
-- wstawienie po cichu nic nie zrobilo (`ON CONFLICT DO NOTHING` po bledzie).
SELECT is(
  length(public.club_anonymity_salt('ee111111-1111-1111-1111-111111111111')),
  64,
  'sol ma 64 znaki hex, czyli pelne 32 bajty entropii');

SELECT * FROM finish();
ROLLBACK;
