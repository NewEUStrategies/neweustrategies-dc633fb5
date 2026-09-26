-- pgTAP: FUNDAMENT FUNKCJI UCZESTNIKA F1-F5 NA PELNYM LANCUCHU MIGRACJI
-- (spec B.5; migracje 20260926100000 / 100100 / 100200).
--
-- Po co osobny plik obok harnessu Wydarzen. Harness stawia powierzchnie
-- platformy jako ATRAPY (skrzynka powiadomien, bramka preferencji, licznik
-- limitow, RSVP), wiec zachowanie PRAWDZIWYCH obiektow platformy mozna
-- udowodnic wylacznie tutaj - po odtworzeniu calej historii migracji.
--
-- Etykiety asercji (kolejnosc wykonania):
--   1-3.   RLS ustawien: administrator najemcy widzi wiersz, redaktor i obcy
--          administrator nie widza nic, anonim nie ma nawet prawa SELECT.
--   4.     Zadna polityka trzech nowych tabel nie wymienia roli editor.
--   5.     RLS wlaczony na trzech nowych tabelach.
--   6-7.   RLS dziennika doreczen: administrator widzi, redaktor nie.
--   8-9.   RLS zakladek planu: wlasciciel widzi swoje, inny uzytkownik nie.
--   10-11. Publiczne event_participant_options: grant dla anon i odpowiedz dla
--          anonima w najemcy hosta.
--   12-13. PF-F ZMIANA kind-event-branch: prawdziwy enqueue_notification(event)
--          wstawia, a enabled_event=false tlumi.
--   14-15. PF-F ZMIANA kind-always-on / kind-catalog: billing przy WSZYSTKICH
--          flagach wylaczonych wstawia i przechodzi CHECK katalogu.
--   16.    PF-F ZMIANA kind-event-column: enabled_event NOT NULL DEFAULT true.
--   17-18. D0-1: UPDATE event_rsvps SET status='canceled' lamie CHECK (23514),
--          'cancelled' przechodzi.
--   19-21. PF-F ZMIANA rate-limit-acl: rate_limit_hit bez anon/authenticated,
--          z service_role.
--   22-24. PF-F ZMIANA enqueue-acl / enqueue-search-path / enqueue-comment.
--   25-26. Pomocnicy serwisowi niewykonywalni przez authenticated; RPC panelu
--          niewykonywalne przez anon.
--
-- Uruchamianie: `bun run test:pgtap-local all event_participant_foundation`
-- (patrz scripts/pgtap-local/README.md) albo `supabase test db` w CI.

BEGIN;
SELECT plan(26);

ALTER TABLE auth.users DISABLE TRIGGER USER;

INSERT INTO public.tenants (id, slug, name, domain) VALUES
  ('f5a00000-0000-0000-0000-0000000000aa', 'pf-foundation-a', 'PF Foundation A', 'pf-foundation-a.example'),
  ('f5b00000-0000-0000-0000-0000000000bb', 'pf-foundation-b', 'PF Foundation B', 'pf-foundation-b.example');

INSERT INTO auth.users (id, email) VALUES
  ('f5000000-0000-0000-0000-0000000000a1', 'pf-admin-a@example.org'),
  ('f5000000-0000-0000-0000-0000000000e1', 'pf-editor-a@example.org'),
  ('f5000000-0000-0000-0000-0000000000b1', 'pf-admin-b@example.org'),
  ('f5000000-0000-0000-0000-000000000001', 'pf-user-1@example.org'),
  ('f5000000-0000-0000-0000-000000000002', 'pf-user-2@example.org');

INSERT INTO public.profiles (id, email, display_name, tenant_id) VALUES
  ('f5000000-0000-0000-0000-0000000000a1', 'pf-admin-a@example.org', 'PF Admin A', 'f5a00000-0000-0000-0000-0000000000aa'),
  ('f5000000-0000-0000-0000-0000000000e1', 'pf-editor-a@example.org', 'PF Editor A', 'f5a00000-0000-0000-0000-0000000000aa'),
  ('f5000000-0000-0000-0000-0000000000b1', 'pf-admin-b@example.org', 'PF Admin B', 'f5b00000-0000-0000-0000-0000000000bb'),
  ('f5000000-0000-0000-0000-000000000001', 'pf-user-1@example.org', 'PF User 1', 'f5a00000-0000-0000-0000-0000000000aa'),
  ('f5000000-0000-0000-0000-000000000002', 'pf-user-2@example.org', 'PF User 2', 'f5a00000-0000-0000-0000-0000000000aa');

INSERT INTO public.user_roles (user_id, role, tenant_id) VALUES
  ('f5000000-0000-0000-0000-0000000000a1', 'admin', 'f5a00000-0000-0000-0000-0000000000aa'),
  ('f5000000-0000-0000-0000-0000000000e1', 'editor', 'f5a00000-0000-0000-0000-0000000000aa'),
  ('f5000000-0000-0000-0000-0000000000b1', 'admin', 'f5b00000-0000-0000-0000-0000000000bb');

INSERT INTO public.notification_preferences (user_id, tenant_id) VALUES
  ('f5000000-0000-0000-0000-000000000001', 'f5a00000-0000-0000-0000-0000000000aa');

INSERT INTO public.events (id, tenant_id, slug, title_pl, title_en, starts_at, status) VALUES
  ('f5100000-0000-0000-0000-000000000001', 'f5a00000-0000-0000-0000-0000000000aa',
   'pf-foundation-event', 'Fundament', 'Foundation', '2030-06-10 08:00+00', 'published'),
  ('f5100000-0000-0000-0000-00000000000b', 'f5b00000-0000-0000-0000-0000000000bb',
   'pf-foundation-event-b', 'Fundament B', 'Foundation B', '2030-06-10 08:00+00', 'published');

INSERT INTO public.event_sessions (id, tenant_id, event_id, title_pl, title_en, starts_at, ends_at, status) VALUES
  ('f5200000-0000-0000-0000-000000000001', 'f5a00000-0000-0000-0000-0000000000aa',
   'f5100000-0000-0000-0000-000000000001', 'Sesja PF', 'PF session',
   '2030-06-10 09:00+00', '2030-06-10 10:00+00', 'published');

INSERT INTO public.event_participant_settings (tenant_id, event_id, refund_mode) VALUES
  ('f5a00000-0000-0000-0000-0000000000aa', 'f5100000-0000-0000-0000-000000000001', 'none');

INSERT INTO public.event_session_saves (tenant_id, event_id, session_id, user_id) VALUES
  ('f5a00000-0000-0000-0000-0000000000aa', 'f5100000-0000-0000-0000-000000000001',
   'f5200000-0000-0000-0000-000000000001', 'f5000000-0000-0000-0000-000000000001');

SELECT public._event_delivery_claim(jsonb_build_object(
  'tenant_id', 'f5a00000-0000-0000-0000-0000000000aa',
  'event_id', 'f5100000-0000-0000-0000-000000000001',
  'kind', 'event_reminder', 'channel', 'email', 'dedupe_key', 'er:pgtap:foundation:1'));

INSERT INTO public.event_rsvps (tenant_id, event_id, user_id, status) VALUES
  ('f5a00000-0000-0000-0000-0000000000aa', 'f5100000-0000-0000-0000-000000000001',
   'f5000000-0000-0000-0000-000000000001', 'going');

-- ── 1-3. RLS ustawien ────────────────────────────────────────────────────────
SELECT set_config('request.jwt.claims',
  '{"sub":"f5000000-0000-0000-0000-0000000000a1","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
SELECT is(
  (SELECT count(*)::int FROM public.event_participant_settings
    WHERE event_id = 'f5100000-0000-0000-0000-000000000001'),
  1, 'ustawienia: administrator najemcy A widzi wiersz swojego wydarzenia');
RESET ROLE;

SELECT set_config('request.jwt.claims',
  '{"sub":"f5000000-0000-0000-0000-0000000000e1","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
SELECT is(
  (SELECT count(*)::int FROM public.event_participant_settings)
  + (SELECT count(*)::int FROM public.event_participant_settings
      WHERE tenant_id = 'f5a00000-0000-0000-0000-0000000000aa'),
  0, 'ustawienia: redaktor najemcy A nie widzi niczego (tylko admin/super admin, nigdy editor)');
RESET ROLE;

SELECT set_config('request.jwt.claims', '', true);
SET LOCAL ROLE anon;
SELECT throws_ok(
  $$SELECT count(*) FROM public.event_participant_settings$$,
  '42501', NULL,
  'ustawienia: anonim nie ma prawa SELECT na event_participant_settings');
RESET ROLE;

-- ── 4-5. Katalog polityk i RLS na nowych tabelach ───────────────────────────
SELECT is_empty($$
  SELECT p.tablename || '.' || p.policyname
    FROM pg_policies p
   WHERE p.schemaname = 'public'
     AND p.tablename IN ('event_participant_settings', 'event_message_deliveries', 'event_session_saves')
     AND (COALESCE(p.qual, '') || ' ' || COALESCE(p.with_check, '')) ~ '''editor'''
$$, 'zadna polityka trzech nowych tabel nie wymienia roli editor');

SELECT is(
  (SELECT count(*)::int FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname IN ('event_participant_settings', 'event_message_deliveries', 'event_session_saves')
      AND c.relrowsecurity),
  3, 'RLS wlaczony na event_participant_settings, event_message_deliveries i event_session_saves');

-- ── 6-7. RLS dziennika doreczen ─────────────────────────────────────────────
SELECT set_config('request.jwt.claims',
  '{"sub":"f5000000-0000-0000-0000-0000000000a1","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
SELECT is(
  (SELECT count(*)::int FROM public.event_message_deliveries
    WHERE event_id = 'f5100000-0000-0000-0000-000000000001'),
  1, 'dziennik doreczen: administrator najemcy A widzi wiersz swojego wydarzenia');
RESET ROLE;

SELECT set_config('request.jwt.claims',
  '{"sub":"f5000000-0000-0000-0000-0000000000b1","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
SELECT is(
  (SELECT count(*)::int FROM public.event_message_deliveries
    WHERE tenant_id = 'f5a00000-0000-0000-0000-0000000000aa')
  + (SELECT count(*)::int FROM public.event_participant_settings
      WHERE tenant_id = 'f5a00000-0000-0000-0000-0000000000aa'),
  0, 'dziennik doreczen i ustawienia: administrator najemcy B nie widzi wierszy najemcy A');
RESET ROLE;

-- ── 8-9. RLS zakladek planu ─────────────────────────────────────────────────
SELECT set_config('request.headers', '{"x-tenant-host":"pf-foundation-a.example"}', true);
SELECT set_config('request.jwt.claims',
  '{"sub":"f5000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
SELECT is(
  (SELECT count(*)::int FROM public.event_session_saves),
  1, 'zakladki: wlasciciel widzi swoja zakladke w najemcy hosta');
RESET ROLE;

SELECT set_config('request.jwt.claims',
  '{"sub":"f5000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
SELECT is(
  (SELECT count(*)::int FROM public.event_session_saves),
  0, 'zakladki: inny uzytkownik tego samego najemcy nie widzi cudzej zakladki');
RESET ROLE;

-- ── 10-11. Publiczne opcje uczestnika ───────────────────────────────────────
SELECT ok(
  has_function_privilege('anon', 'public.event_participant_options(text)', 'EXECUTE'),
  'event_participant_options: anon ma EXECUTE');

SELECT set_config('request.jwt.claims', '', true);
SET LOCAL ROLE anon;
SELECT is(
  (SELECT public.event_participant_options('pf-foundation-event')->>'refund_mode'),
  'none', 'event_participant_options: anonim w najemcy hosta dostaje flagi wydarzenia');
RESET ROLE;
SELECT set_config('request.headers', '', true);

-- ── 12-13. Prawdziwy producent: rodzaj event ────────────────────────────────
SELECT isnt(
  public.enqueue_notification('f5000000-0000-0000-0000-000000000001', 'event',
    'Przypomnienie', 'Reminder', NULL, NULL, '/events/pf-foundation-event', 'calendar-clock'),
  NULL, 'PF-F ZMIANA kind-event-branch: enqueue_notification(event) wstawia przy enabled_event=true');

UPDATE public.notification_preferences SET enabled_event = false
 WHERE user_id = 'f5000000-0000-0000-0000-000000000001';
SELECT is(
  public.enqueue_notification('f5000000-0000-0000-0000-000000000001', 'event',
    'Przypomnienie', 'Reminder', NULL, NULL, '/events/pf-foundation-event/2', 'calendar-clock'),
  NULL, 'PF-F ZMIANA kind-event-branch: enabled_event=false tlumi rodzaj event');

-- ── 14-15. billing: zawsze doreczany, w katalogu ─────────────────────────────
DO $$
DECLARE c text;
BEGIN
  FOR c IN
    SELECT column_name FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'notification_preferences'
       AND column_name LIKE 'enabled\_%' AND data_type = 'boolean'
  LOOP
    EXECUTE format('UPDATE public.notification_preferences SET %I = false WHERE user_id = %L',
                   c, 'f5000000-0000-0000-0000-000000000001');
  END LOOP;
END $$;
SELECT set_config('tests.billing_note',
  COALESCE(public.enqueue_notification('f5000000-0000-0000-0000-000000000001', 'billing',
    'Zwrot', 'Refund', NULL, NULL, '/profile/tickets', 'credit-card')::text, ''), true);
SELECT isnt(
  NULLIF(current_setting('tests.billing_note'), ''),
  NULL, 'PF-F ZMIANA kind-always-on: billing dociera przy WSZYSTKICH przelacznikach wylaczonych');
SELECT is(
  (SELECT kind FROM public.notifications WHERE id = NULLIF(current_setting('tests.billing_note'), '')::uuid),
  'billing', 'PF-F ZMIANA kind-catalog: wiersz billing przechodzi notifications_kind_check');

-- ── 16. Kolumna przelacznika ────────────────────────────────────────────────
SELECT ok(
  EXISTS (SELECT 1 FROM information_schema.columns
           WHERE table_schema = 'public' AND table_name = 'notification_preferences'
             AND column_name = 'enabled_event' AND data_type = 'boolean'
             AND is_nullable = 'NO' AND column_default = 'true'),
  'PF-F ZMIANA kind-event-column: notification_preferences.enabled_event boolean NOT NULL DEFAULT true');

-- ── 17-18. D0-1: literowka 'canceled' nie przechodzi ────────────────────────
SELECT throws_ok(
  $$UPDATE public.event_rsvps SET status = 'canceled'
     WHERE user_id = 'f5000000-0000-0000-0000-000000000001'
       AND event_id = 'f5100000-0000-0000-0000-000000000001'$$,
  '23514', NULL,
  'D0-1: event_rsvps.status = canceled lamie CHECK (check_violation)');
SELECT lives_ok(
  $$UPDATE public.event_rsvps SET status = 'cancelled'
     WHERE user_id = 'f5000000-0000-0000-0000-000000000001'
       AND event_id = 'f5100000-0000-0000-0000-000000000001'$$,
  'D0-1: event_rsvps.status = cancelled przechodzi');

-- ── 19-21. rate_limit_hit wylacznie serwerowy ───────────────────────────────
SELECT ok(
  NOT has_function_privilege('anon', 'public.rate_limit_hit(text,text,integer,integer)', 'EXECUTE'),
  'PF-F ZMIANA rate-limit-acl: anon NIE MOZE wolac rate_limit_hit');
SELECT ok(
  NOT has_function_privilege('authenticated', 'public.rate_limit_hit(text,text,integer,integer)', 'EXECUTE'),
  'PF-F ZMIANA rate-limit-acl: authenticated NIE MOZE wolac rate_limit_hit');
SELECT ok(
  has_function_privilege('service_role', 'public.rate_limit_hit(text,text,integer,integer)', 'EXECUTE'),
  'PF-F ZMIANA rate-limit-acl: service_role zachowuje EXECUTE');

-- ── 22-24. Producent: ACL, search_path, komentarz ───────────────────────────
SELECT ok(
  NOT has_function_privilege('anon', 'public.enqueue_notification(uuid,text,text,text,text,text,text,text)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.enqueue_notification(uuid,text,text,text,text,text,text,text)', 'EXECUTE')
  AND has_function_privilege('service_role', 'public.enqueue_notification(uuid,text,text,text,text,text,text,text)', 'EXECUTE'),
  'PF-F ZMIANA enqueue-acl: enqueue_notification tylko dla service_role');
SELECT ok(
  (SELECT 'search_path=public, pg_temp' = ANY (p.proconfig) FROM pg_proc p
    WHERE p.oid = 'public.enqueue_notification(uuid,text,text,text,text,text,text,text)'::regprocedure),
  'PF-F ZMIANA enqueue-search-path: search_path producenta z pg_temp');
SELECT ok(
  obj_description('public.enqueue_notification(uuid,text,text,text,text,text,text,text)'::regprocedure, 'pg_proc')
    LIKE '%security i billing%',
  'PF-F ZMIANA enqueue-comment: komentarz producenta opisuje always-on security i billing');

-- ── 25-26. Pomocnicy serwisowi i RPC panelu ─────────────────────────────────
SELECT is(
  ARRAY(SELECT f FROM unnest(ARRAY[
      'public._event_delivery_claim(jsonb)',
      'public._event_delivery_confirm(uuid,text,text)',
      'public._event_registration_actor(uuid,uuid,uuid,text)',
      'public._event_registration_lang(uuid,uuid)',
      'public._event_participant_settings_effective(uuid,uuid)',
      'public._event_legacy_rsvp_release(uuid,uuid,uuid)',
      'public._event_participant_release(uuid,uuid,uuid,text)',
      'public._event_local_quiet(text,timestamp with time zone)',
      'public._event_apply_outcome_to_group(uuid,uuid,text)',
      'public.payments_apply_event_ticket_outcome(uuid,text,integer)']) AS f
    WHERE has_function_privilege('authenticated', f, 'EXECUTE')
       OR has_function_privilege('anon', f, 'EXECUTE')
       OR NOT has_function_privilege('service_role', f, 'EXECUTE')),
  ARRAY[]::text[],
  'pomocnicy serwisowi: tylko service_role (zadnego EXECUTE dla authenticated/anon)');
SELECT is(
  ARRAY(SELECT f FROM unnest(ARRAY[
      'public.admin_event_participant_settings_get(uuid)',
      'public.admin_event_participant_settings_save(jsonb)',
      'public.admin_event_message_delivery_stats(uuid)']) AS f
    WHERE has_function_privilege('anon', f, 'EXECUTE')
       OR NOT has_function_privilege('authenticated', f, 'EXECUTE')),
  ARRAY[]::text[],
  'RPC panelu: authenticated tak (bramka w ciele), anon nie');

SELECT * FROM finish();
ROLLBACK;
