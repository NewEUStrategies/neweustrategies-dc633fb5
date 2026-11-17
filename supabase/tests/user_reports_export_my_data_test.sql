-- pgTAP: eksport RODO - sekcja `user_reports_filed` przez
-- `public.user_reports_export_my_data` (20261116211500).
--
-- PO CO. Do 20261116211500 eksport czytal `public.user_reports` klientem
-- uzytkownika, a tabela jest RPC-only (REVOKE ALL ... FROM authenticated
-- w 20260717162432 i 20260717170000), wiec KAZDY eksport mial w tej sekcji
-- `permission denied for table user_reports`. Polityka RLS
-- `user_reports_self_read` byla martwa: bez grantu tabelarycznego nie ma kogo
-- wpuszczac. Ten plik dowodzi, ze nowa sciezka:
--   1. jest wykonywalna dla `authenticated`, a dla `anon` i PUBLIC - nie;
--      tabela dalej NIE ma grantu SELECT dla klientow (RPC-only zostaje);
--   2. oddaje wylacznie zgloszenia zlozone PRZEZ wolajacego (auth.uid()),
--      w jego najemcy - cudze zgloszenia i wiersz innego najemcy znikaja;
--   3. oddaje dokladnie siedem kolumn sekcji eksportu - bez notatki
--      rozstrzygniecia i tozsamosci rozstrzygajacego (dane staffu);
--   4. odmawia glosno bez sesji i bez profilu (eksport ma blad sekcji, a nie
--      pusta liste udajaca „nie zglaszalem").
--
-- Asercje wykonawcze biegna w roli `authenticated` (SET LOCAL ROLE), bo to
-- rola klienta eksportu - jako wlasciciel testy przeszlyby takze bez grantu.
--
-- Uruchamianie: patrz supabase/tests/README.md (`supabase test db`).

BEGIN;
SELECT plan(22);

ALTER TABLE auth.users DISABLE TRIGGER USER;

-- ── Seed ────────────────────────────────────────────────────────────────────
-- Najemca A (zglaszajacy, inny czlonek, cel, staff) i najemca B (osoba
-- z innego obszaru roboczego). Wiersz 'e1...05' to dryf danych: zgloszenie
-- osoby A zapisane pod najemca B - eksport ma go pominac tak samo jak martwa
-- polityka `user_reports_self_read` (tenant_id = current_tenant_id()).
INSERT INTO public.tenants (id, slug, name) VALUES
  ('e1a00000-0000-4000-8000-0000000000a1', 'ur-export-a', 'UR export A'),
  ('e1a00000-0000-4000-8000-0000000000b2', 'ur-export-b', 'UR export B');

INSERT INTO auth.users (id, email) VALUES
  ('e1000000-0000-4000-8000-0000000000a1', 'reporter@ur-export.test'),
  ('e1000000-0000-4000-8000-0000000000a2', 'other@ur-export.test'),
  ('e1000000-0000-4000-8000-0000000000a3', 'target@ur-export.test'),
  ('e1000000-0000-4000-8000-0000000000a4', 'staff@ur-export.test'),
  ('e1000000-0000-4000-8000-0000000000b1', 'tenant-b@ur-export.test'),
  ('e1000000-0000-4000-8000-0000000000b2', 'target-b@ur-export.test'),
  ('e1000000-0000-4000-8000-0000000000c1', 'no-profile@ur-export.test');

INSERT INTO public.profiles (id, tenant_id, display_name) VALUES
  ('e1000000-0000-4000-8000-0000000000a1', 'e1a00000-0000-4000-8000-0000000000a1', 'Zglaszajaca'),
  ('e1000000-0000-4000-8000-0000000000a2', 'e1a00000-0000-4000-8000-0000000000a1', 'Inny czlonek'),
  ('e1000000-0000-4000-8000-0000000000a3', 'e1a00000-0000-4000-8000-0000000000a1', 'Zgloszony'),
  ('e1000000-0000-4000-8000-0000000000a4', 'e1a00000-0000-4000-8000-0000000000a1', 'Staff'),
  ('e1000000-0000-4000-8000-0000000000b1', 'e1a00000-0000-4000-8000-0000000000b2', 'Osoba B'),
  ('e1000000-0000-4000-8000-0000000000b2', 'e1a00000-0000-4000-8000-0000000000b2', 'Zgloszony B');

INSERT INTO public.user_reports
  (id, tenant_id, reporter_id, reported_id, reason, details, status,
   resolved_by, resolved_at, resolution_note, created_at)
VALUES
  -- (01) moje, otwarte, najnowsze
  ('e1e00000-0000-4000-8000-000000000001', 'e1a00000-0000-4000-8000-0000000000a1',
   'e1000000-0000-4000-8000-0000000000a1', 'e1000000-0000-4000-8000-0000000000a3',
   'spam', 'Masowe zaproszenia', 'open', NULL, NULL, NULL, now() - interval '1 day'),
  -- (02) moje, rozstrzygniete przez staff - notatka staffu NIE moze wyjsc
  ('e1e00000-0000-4000-8000-000000000002', 'e1a00000-0000-4000-8000-0000000000a1',
   'e1000000-0000-4000-8000-0000000000a1', 'e1000000-0000-4000-8000-0000000000a2',
   'harassment', NULL, 'resolved', 'e1000000-0000-4000-8000-0000000000a4',
   now() - interval '2 days', 'NOTATKA-STAFFU', now() - interval '3 days'),
  -- (03) cudze: inny czlonek tego samego najemcy zglasza cel
  ('e1e00000-0000-4000-8000-000000000003', 'e1a00000-0000-4000-8000-0000000000a1',
   'e1000000-0000-4000-8000-0000000000a2', 'e1000000-0000-4000-8000-0000000000a3',
   'other', 'Cudze zgloszenie', 'open', NULL, NULL, NULL, now() - interval '4 days'),
  -- (04) cudze, inny najemca
  ('e1e00000-0000-4000-8000-000000000004', 'e1a00000-0000-4000-8000-0000000000b2',
   'e1000000-0000-4000-8000-0000000000b1', 'e1000000-0000-4000-8000-0000000000b2',
   'spam', 'Zgloszenie w B', 'open', NULL, NULL, NULL, now() - interval '5 days'),
  -- (05) dryf: moje zgloszenie zapisane pod najemca B
  ('e1e00000-0000-4000-8000-000000000005', 'e1a00000-0000-4000-8000-0000000000b2',
   'e1000000-0000-4000-8000-0000000000a1', 'e1000000-0000-4000-8000-0000000000b2',
   'impersonation', 'Wiersz innego najemcy', 'open', NULL, NULL, NULL, now() - interval '6 days');

-- ── (1-6) Uprawnienia i ksztalt funkcji (katalog) ──────────────────────────
SELECT ok(
  NOT has_function_privilege('anon', 'public.user_reports_export_my_data(integer)', 'EXECUTE'),
  'anon NIE ma EXECUTE na user_reports_export_my_data'
);
SELECT ok(
  has_function_privilege('authenticated', 'public.user_reports_export_my_data(integer)', 'EXECUTE'),
  'authenticated ma EXECUTE (rola klienta eksportu RODO)'
);
SELECT ok(
  has_function_privilege('service_role', 'public.user_reports_export_my_data(integer)', 'EXECUTE'),
  'service_role zachowuje EXECUTE'
);
-- PUBLIC sprawdzamy w ACL wprost (grantee 0): domyslny EXECUTE dla PUBLIC
-- przeszedlby przez kazda role, takze przyszla.
SELECT is(
  (SELECT count(*)::int
     FROM pg_proc p, LATERAL aclexplode(p.proacl) a
    WHERE p.oid = 'public.user_reports_export_my_data(integer)'::regprocedure
      AND a.grantee = 0),
  0,
  'PUBLIC nie ma EXECUTE (REVOKE ALL ... FROM PUBLIC)'
);
SELECT ok(
  (SELECT p.prosecdef
          AND p.proconfig @> ARRAY['search_path=public, pg_temp']
     FROM pg_proc p
    WHERE p.oid = 'public.user_reports_export_my_data(integer)'::regprocedure),
  'SECURITY DEFINER z przypietym search_path = public, pg_temp'
);
SELECT is(
  pg_get_function_result('public.user_reports_export_my_data(integer)'::regprocedure),
  'TABLE(id uuid, reported_id uuid, reason text, details text, status text, created_at timestamp with time zone, resolved_at timestamp with time zone)',
  'dokladnie siedem kolumn sekcji eksportu - bez resolution_note i resolved_by'
);

-- ── (7-8) Tabela pozostaje RPC-only ────────────────────────────────────────
SELECT ok(
  NOT has_table_privilege('authenticated', 'public.user_reports', 'SELECT'),
  'user_reports: authenticated dalej BEZ SELECT (naprawa nie otworzyla grantu)'
);
SELECT ok(
  NOT has_table_privilege('anon', 'public.user_reports', 'SELECT'),
  'user_reports: anon BEZ SELECT'
);

-- ── (9-15) Zglaszajaca w roli authenticated ─────────────────────────────────
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"e1000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);

SELECT throws_ok(
  $$SELECT id FROM public.user_reports$$,
  '42501', NULL,
  'kontrola: bezposredni odczyt tabeli w roli authenticated nadal daje 42501'
);
SELECT is(
  (SELECT array_agg(e.id::text ORDER BY e.id) FROM public.user_reports_export_my_data(2000) e),
  ARRAY['e1e00000-0000-4000-8000-000000000001', 'e1e00000-0000-4000-8000-000000000002'],
  'eksport oddaje wylacznie wlasne zgloszenia we wlasnym najemcy (01, 02)'
);
SELECT is(
  (SELECT count(*)::int FROM public.user_reports_export_my_data(2000) e
    WHERE e.id = 'e1e00000-0000-4000-8000-000000000003'),
  0,
  'cudze zgloszenie w tym samym najemcy jest niewidoczne'
);
SELECT is(
  (SELECT count(*)::int FROM public.user_reports_export_my_data(2000) e
    WHERE e.id IN ('e1e00000-0000-4000-8000-000000000004',
                   'e1e00000-0000-4000-8000-000000000005')),
  0,
  'wiersze innego najemcy (cudzy i wlasny zapisany pod B) sa niewidoczne'
);
SELECT is(
  (SELECT row(e.reported_id, e.reason, e.details, e.status)::text
     FROM public.user_reports_export_my_data(2000) e
    WHERE e.id = 'e1e00000-0000-4000-8000-000000000001'),
  row('e1000000-0000-4000-8000-0000000000a3'::uuid, 'spam'::text,
      'Masowe zaproszenia'::text, 'open'::text)::text,
  'wartosci kolumn sekcji przechodzi bez przerobek'
);
SELECT ok(
  (SELECT bool_and(strpos(row_to_json(e)::text, 'NOTATKA-STAFFU') = 0
                   AND strpos(row_to_json(e)::text, 'e1000000-0000-4000-8000-0000000000a4') = 0)
     FROM public.user_reports_export_my_data(2000) e),
  'notatka rozstrzygniecia i tozsamosc staffu nie wychodza w eksporcie'
);
SELECT is(
  (SELECT array_agg(e.id::text) FROM public.user_reports_export_my_data(1) e),
  ARRAY['e1e00000-0000-4000-8000-000000000001'],
  'p_limit przycina od najnowszego (created_at DESC)'
);

-- ── (16-17) Inne osoby widza wylacznie swoje ───────────────────────────────
SELECT set_config('request.jwt.claims',
  '{"sub":"e1000000-0000-4000-8000-0000000000a2","role":"authenticated"}', true);
SELECT is(
  (SELECT array_agg(e.id::text) FROM public.user_reports_export_my_data(2000) e),
  ARRAY['e1e00000-0000-4000-8000-000000000003'],
  'inny czlonek tego samego najemcy widzi wylacznie swoje zgloszenie'
);
SELECT set_config('request.jwt.claims',
  '{"sub":"e1000000-0000-4000-8000-0000000000b1","role":"authenticated"}', true);
SELECT is(
  (SELECT array_agg(e.id::text) FROM public.user_reports_export_my_data(2000) e),
  ARRAY['e1e00000-0000-4000-8000-000000000004'],
  'osoba najemcy B widzi wylacznie swoje (bez wiersza dryfu osoby A)'
);

-- ── (18-19) Odmowa glosna zamiast pustej listy ─────────────────────────────
SELECT set_config('request.jwt.claims',
  '{"sub":"e1000000-0000-4000-8000-0000000000c1","role":"authenticated"}', true);
SELECT throws_ok(
  $$SELECT * FROM public.user_reports_export_my_data(2000)$$,
  'P0001', 'not_found: profile does not exist',
  'konto bez profilu: blad sekcji, nie pusta lista'
);
SELECT set_config('request.jwt.claims', '', true);
SELECT throws_ok(
  $$SELECT * FROM public.user_reports_export_my_data(2000)$$,
  'P0001', 'auth_required: sign in to export your data',
  'brak sesji (auth.uid() IS NULL): odmowa'
);

-- ── (20-21) anon nie wola funkcji w ogole ──────────────────────────────────
RESET ROLE;
SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claims',
  '{"sub":"e1000000-0000-4000-8000-0000000000a1","role":"anon"}', true);
SELECT throws_ok(
  $$SELECT * FROM public.user_reports_export_my_data(2000)$$,
  '42501', NULL,
  'anon: permission denied for function (nawet z podrobionym sub)'
);
SELECT throws_ok(
  $$SELECT id FROM public.user_reports$$,
  '42501', NULL,
  'anon: tabela user_reports niedostepna'
);
RESET ROLE;

-- ── (22) Funkcja nie zmienia danych ────────────────────────────────────────
SELECT is(
  (SELECT count(*)::int FROM public.user_reports
    WHERE id::text LIKE 'e1e00000-%'),
  5,
  'odczyt eksportu nie dotyka tabeli (5 wierszy fikstury)'
);

SELECT * FROM finish();
ROLLBACK;
