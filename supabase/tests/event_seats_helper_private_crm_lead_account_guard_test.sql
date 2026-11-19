-- pgTAP: licznik miejsc tylko przez funkcje z prawami wlasciciela i straz
-- powiazania leada CRM z kontem (migracja
-- 20261119190000_event_seats_helper_private_crm_lead_account_guard,
-- blizniak drizzle 0416).
--
-- DEFEKTY ZE SKANU (2026-11-19):
--   1. `_event_page_seats_left(uuid, uuid)` byl SECURITY DEFINER z EXECUTE
--      dla anon/authenticated - dowolny `_tenant`/`_event_id` oddawal liczbe
--      wolnych miejsc szkicu albo wydarzenia obcego najemcy.
--   2. Karty leada (metering, czlonkostwo, profil/CV) wiaza konto przez
--      `crm_leads.user_id` (09d7f4d6) - kolumny nie wolno ustawic ani zmienic
--      z roli sesji.
--
-- CO PRZYPINA:
--    1-4.  ACL pomocnika: anon/authenticated bez EXECUTE, service_role z EXECUTE;
--          KAZDA funkcja `public` wolajaca pomocnika jest SECURITY DEFINER
--          (wolajacy z prawami sesji padlby po odebraniu grantu na 42501),
--          w tym piec wolajacych wymienionych w migracji;
--    5-9.  pomocnik wprost z roli sesji = 42501, a wolajacy z prawami
--          wlasciciela licza dalej: `event_seat_state` i `event_page_header`
--          (anon na hoscie najemcy) oraz `event_seat_state` (authenticated);
--   10-15. ksztalt strazy: BEFORE INSERT OR UPDATE OF user_id FOR EACH ROW,
--          wlaczona; funkcja SECURITY INVOKER z przypietym search_path
--          (SECURITY DEFINER zmienilby `current_user` na wlasciciela i straz
--          nie zadzialalaby nigdy), bez EXECUTE dla nikogo (jak inne `tg_*`);
--   16-19. redaktor przez PostgREST (`authenticated` + claims): INSERT z kontem,
--          podpiecie i odpiecie konta = 42501 `crm_lead_user_id_managed`
--          (straz odpala PRZED `trg_crm_leads_00_hub_guard`); flaga
--          `app.crm_trusted_writer` w sesji klienta - ktorej ufa starsza straz
--          Z-06 - NIE otwiera kolumny (ta asercja pada bez tej migracji);
--   20-23. zwykla praca panelu bez zmian: INSERT leada bez konta, edycja tagow
--          leada z kontem, odeslanie NIEZMIENIONEGO `user_id`; powiazania po
--          probach nietkniete;
--   24-30. zaufani pisarze przechodza: wlasciciel (migracja, backfill),
--          service_role (INSERT i UPDATE), a edycja wlasnego profilu przez
--          czlonka (`authenticated`) podpina jego lead lancuchem SECURITY
--          DEFINER (`_trg_profile_to_crm` -> `crm_upsert_lead_from_profile`).
--          Ten lancuch polyka wyjatek do `domain_event_emit_errors`, wiec
--          regresja bylaby CICHA - stad powiazanie i brak sladu bledu.
--
-- Uruchamianie: PGTAP_DIR=... PGTAP_PORT=... bash scripts/pgtap-local/run.sh test event_seats_helper_private_crm_lead_account_guard
BEGIN;
SELECT plan(30);

-- -- Fixture -----------------------------------------------------------------
ALTER TABLE auth.users DISABLE TRIGGER USER;

INSERT INTO public.tenants (id, slug, name, domain) VALUES
  ('e1190000-0000-4000-8000-0000000000a0', 'sgl-guard-a', 'Seats/lead guard A', 'sgl-guard-a.example');

INSERT INTO auth.users (id, email) VALUES
  ('e1190000-0000-4000-8000-00000000a001', 'editor-a@sgl-guard.test'),
  ('e1190000-0000-4000-8000-00000000a002', 'member-a@sgl-guard.test'),
  ('e1190000-0000-4000-8000-00000000a003', 'linked-a@sgl-guard.test'),
  ('e1190000-0000-4000-8000-00000000a004', 'svc-upd-a@sgl-guard.test'),
  ('e1190000-0000-4000-8000-00000000a005', 'svc-ins-a@sgl-guard.test'),
  ('e1190000-0000-4000-8000-00000000a006', 'owner-a@sgl-guard.test');

-- Redaktor najemcy A (wzor crm_lifecycle_history_test.sql). Jego profil sam
-- rodzi wlasny lead z kontem - bez znaczenia dla asercji.
INSERT INTO public.profiles (id, email, display_name, tenant_id) VALUES
  ('e1190000-0000-4000-8000-00000000a001', 'editor-a@sgl-guard.test', 'Editor A', 'e1190000-0000-4000-8000-0000000000a0');
INSERT INTO public.user_roles (user_id, role, tenant_id) VALUES
  ('e1190000-0000-4000-8000-00000000a001', 'editor', 'e1190000-0000-4000-8000-0000000000a0');

-- Czlonek z leadem NIEPOWIAZANYM (stan sprzed backfillu - wzor
-- crm_user_id_backfill_test.sql): profil wstawiony bez wyzwalacza CRM.
ALTER TABLE public.profiles DISABLE TRIGGER profile_sync_crm_lead;
INSERT INTO public.profiles (id, email, display_name, tenant_id) VALUES
  ('e1190000-0000-4000-8000-00000000a002', 'member-a@sgl-guard.test', 'Member A', 'e1190000-0000-4000-8000-0000000000a0');
ALTER TABLE public.profiles ENABLE TRIGGER profile_sync_crm_lead;

-- l1: bez konta (cel podpiecia z panelu), l3: lead czlonka (ten sam adres),
-- l4: podpina service_role, l5: podpina wlasciciel.
INSERT INTO public.crm_leads (id, tenant_id, email, email_norm) VALUES
  ('e1190000-0000-4000-8000-0000000001a1', 'e1190000-0000-4000-8000-0000000000a0', 'l1@sgl-guard.test', 'l1@sgl-guard.test'),
  ('e1190000-0000-4000-8000-0000000001a3', 'e1190000-0000-4000-8000-0000000000a0', 'member-a@sgl-guard.test', 'member-a@sgl-guard.test'),
  ('e1190000-0000-4000-8000-0000000001a4', 'e1190000-0000-4000-8000-0000000000a0', 'l4@sgl-guard.test', 'l4@sgl-guard.test'),
  ('e1190000-0000-4000-8000-0000000001a5', 'e1190000-0000-4000-8000-0000000000a0', 'l5@sgl-guard.test', 'l5@sgl-guard.test');
-- l2: lead JUZ powiazany przez baze (wlasciciel, bez roli sesji).
INSERT INTO public.crm_leads (id, tenant_id, email, email_norm, user_id) VALUES
  ('e1190000-0000-4000-8000-0000000001a2', 'e1190000-0000-4000-8000-0000000000a0', 'linked-a@sgl-guard.test', 'linked-a@sgl-guard.test',
   'e1190000-0000-4000-8000-00000000a003');

-- Sala na 3 miejsca bez zgloszen: kazda sciezka liczenia daje 3.
INSERT INTO public.events (id, tenant_id, slug, title_pl, title_en, starts_at, status, capacity) VALUES
  ('e1190000-0000-4000-8000-0000000000e1', 'e1190000-0000-4000-8000-0000000000a0',
   'sgl-guard-event', 'SGL', 'SGL', '2030-06-10 08:00+00', 'published', 3);

CREATE FUNCTION pg_temp.as_user(p_user uuid) RETURNS text LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims',
    json_build_object('sub', p_user, 'role', 'authenticated')::text, true)
$$;

-- -- 1-4. ACL pomocnika i jego wolajacy ------------------------------------
SELECT ok(
  NOT has_function_privilege('anon', 'public._event_page_seats_left(uuid,uuid)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public._event_page_seats_left(uuid,uuid)', 'EXECUTE'),
  '_event_page_seats_left(uuid,uuid): bez EXECUTE dla anon i authenticated (takze przez PUBLIC)');
SELECT ok(
  has_function_privilege('service_role', 'public._event_page_seats_left(uuid,uuid)', 'EXECUTE'),
  '_event_page_seats_left(uuid,uuid): service_role zachowuje EXECUTE');
SELECT is(
  (SELECT string_agg(p.oid::regprocedure::text, ', ' ORDER BY p.oid::regprocedure::text)
     FROM pg_proc p
     JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname <> '_event_page_seats_left'
      AND strpos(p.prosrc, '_event_page_seats_left(') > 0
      AND NOT p.prosecdef),
  NULL::text,
  'kazda funkcja public wolajaca _event_page_seats_left jest SECURITY DEFINER (lista = wolajacy z prawami sesji)');
SELECT ok(
  ARRAY['event_page_header', 'event_seat_state', 'events_public_list',
        'event_bookmarks_mine', '_event_rsvp_claim_paid_seat']::name[]
  <@ (SELECT array_agg(p.proname)
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public'
         AND p.prosecdef
         AND strpos(p.prosrc, '_event_page_seats_left(') > 0),
  'piec wolajacych z migracji wola pomocnika z prawami wlasciciela');

-- -- 5-9. Rola sesji: pomocnik wprost = 42501, wolajacy licza dalej ---------
SELECT set_config('request.headers', '{"x-tenant-host":"sgl-guard-a.example"}', true);
SELECT set_config('request.jwt.claims', '{"role":"anon"}', true);
SET LOCAL ROLE anon;
SELECT throws_ok(
  $$ SELECT public._event_page_seats_left('e1190000-0000-4000-8000-0000000000a0',
                                          'e1190000-0000-4000-8000-0000000000e1') $$,
  '42501', NULL,
  'anon: pomocnik wprost = permission denied');
SELECT is(
  (SELECT s.seats_left FROM public.event_seat_state('e1190000-0000-4000-8000-0000000000e1') s),
  3, 'anon: event_seat_state (SECURITY DEFINER) liczy miejsca pomocnikiem');
SELECT is(
  (SELECT h.seats_left FROM public.event_page_header('sgl-guard-event') h),
  3, 'anon: event_page_header (SECURITY DEFINER) liczy miejsca pomocnikiem');
RESET ROLE;

SELECT pg_temp.as_user('e1190000-0000-4000-8000-00000000a001');
SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $$ SELECT public._event_page_seats_left('e1190000-0000-4000-8000-0000000000a0',
                                          'e1190000-0000-4000-8000-0000000000e1') $$,
  '42501', NULL,
  'authenticated: pomocnik wprost = permission denied');
SELECT is(
  (SELECT s.seats_left FROM public.event_seat_state('e1190000-0000-4000-8000-0000000000e1') s),
  3, 'authenticated: event_seat_state liczy miejsca pomocnikiem');
RESET ROLE;
SELECT set_config('request.headers', '', true);

-- -- 10-15. Ksztalt strazy crm_leads.user_id ------------------------------
SELECT has_trigger('public', 'crm_leads', 'trg_crm_leads_000_user_id_guard',
  'crm_leads ma straz trg_crm_leads_000_user_id_guard');
SELECT trigger_is('public', 'crm_leads', 'trg_crm_leads_000_user_id_guard',
  'public', 'tg_crm_leads_user_id_guard',
  'straz wola public.tg_crm_leads_user_id_guard()');
-- tgtype: 1 = ROW, 2 = BEFORE, 4 = INSERT, 16 = UPDATE => 23; 'O' = wlaczona.
SELECT is(
  (SELECT tgtype::int || '|' || tgenabled::text FROM pg_trigger
    WHERE tgrelid = 'public.crm_leads'::regclass
      AND tgname = 'trg_crm_leads_000_user_id_guard'),
  '23|O',
  'straz: BEFORE INSERT OR UPDATE FOR EACH ROW, wlaczona');
SELECT is(
  (SELECT array_agg(a.attname::text ORDER BY a.attnum)
     FROM pg_trigger t
     JOIN pg_attribute a ON a.attrelid = t.tgrelid AND a.attnum = ANY (t.tgattr::int2[])
    WHERE t.tgrelid = 'public.crm_leads'::regclass
      AND t.tgname = 'trg_crm_leads_000_user_id_guard'),
  ARRAY['user_id'],
  'straz UPDATE odpala na liscie SET z user_id (UPDATE OF user_id)');
SELECT ok(
  (SELECT NOT p.prosecdef AND 'search_path=public, pg_temp' = ANY (p.proconfig)
     FROM pg_proc p WHERE p.oid = 'public.tg_crm_leads_user_id_guard()'::regprocedure),
  'funkcja strazy: SECURITY INVOKER (current_user = rola sesji) z przypietym search_path');
SELECT ok(
  NOT has_function_privilege('anon', 'public.tg_crm_leads_user_id_guard()', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.tg_crm_leads_user_id_guard()', 'EXECUTE')
  AND NOT has_function_privilege('service_role', 'public.tg_crm_leads_user_id_guard()', 'EXECUTE'),
  'funkcja strazy bez EXECUTE dla anon, authenticated i service_role (jak inne tg_*)');

-- -- 16-19. Panel (PostgREST): user_id zamkniety ---------------------------
SELECT pg_temp.as_user('e1190000-0000-4000-8000-00000000a001');
SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $$ INSERT INTO public.crm_leads (tenant_id, email, email_norm, user_id)
     VALUES ('e1190000-0000-4000-8000-0000000000a0', 'l6@sgl-guard.test', 'l6@sgl-guard.test',
             'e1190000-0000-4000-8000-00000000a002') $$,
  '42501', 'crm_lead_user_id_managed',
  'redaktor nie wstawi leada z kontem czlonka (user_id)');
SELECT throws_ok(
  $$ UPDATE public.crm_leads SET user_id = 'e1190000-0000-4000-8000-00000000a002'
      WHERE id = 'e1190000-0000-4000-8000-0000000001a1' $$,
  '42501', 'crm_lead_user_id_managed',
  'redaktor nie podepnie konta czlonka pod lead (straz odpala przed trg_crm_leads_00_hub_guard)');
SELECT throws_ok(
  $$ UPDATE public.crm_leads SET user_id = NULL
      WHERE id = 'e1190000-0000-4000-8000-0000000001a2' $$,
  '42501', 'crm_lead_user_id_managed',
  'redaktor nie odepnie konta od leada');
RESET ROLE;

-- Starsza straz Z-06 ufa fladze transakcyjnej; nowa patrzy na current_user.
SELECT set_config('app.crm_trusted_writer', 'on', true);
SELECT pg_temp.as_user('e1190000-0000-4000-8000-00000000a001');
SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $$ UPDATE public.crm_leads SET user_id = 'e1190000-0000-4000-8000-00000000a002'
      WHERE id = 'e1190000-0000-4000-8000-0000000001a1' $$,
  '42501', 'crm_lead_user_id_managed',
  'flaga app.crm_trusted_writer w sesji klienta nie otwiera user_id');
RESET ROLE;
SELECT set_config('app.crm_trusted_writer', '', true);

-- -- 20-23. Zwykla praca panelu bez zmian ----------------------------------
SELECT pg_temp.as_user('e1190000-0000-4000-8000-00000000a001');
SET LOCAL ROLE authenticated;
SELECT lives_ok(
  $$ INSERT INTO public.crm_leads (tenant_id, email, email_norm)
     VALUES ('e1190000-0000-4000-8000-0000000000a0', 'l7@sgl-guard.test', 'l7@sgl-guard.test') $$,
  'redaktor wstawia lead bez konta (wartosci domyslne)');
SELECT lives_ok(
  $$ UPDATE public.crm_leads SET tags = ARRAY['vip']
      WHERE id = 'e1190000-0000-4000-8000-0000000001a2' $$,
  'redaktor edytuje inne kolumny leada z kontem (tagi)');
SELECT lives_ok(
  $$ UPDATE public.crm_leads
        SET user_id = 'e1190000-0000-4000-8000-00000000a003', tags = ARRAY['vip', 'b2b']
      WHERE id = 'e1190000-0000-4000-8000-0000000001a2' $$,
  'formularz odsylajacy NIEZMIENIONY user_id przechodzi (IS DISTINCT FROM)');
RESET ROLE;
SELECT set_config('request.jwt.claims', '', true);
SELECT ok(
  (SELECT user_id IS NULL FROM public.crm_leads WHERE id = 'e1190000-0000-4000-8000-0000000001a1')
  AND (SELECT user_id = 'e1190000-0000-4000-8000-00000000a003' AND 'b2b' = ANY (tags)
         FROM public.crm_leads WHERE id = 'e1190000-0000-4000-8000-0000000001a2'),
  'po probach panelu: l1 bez konta, l2 z tym samym kontem i z edycja tagow (RLS przepuscil zapis)');

-- -- 24-30. Zaufani pisarze ------------------------------------------------
SELECT lives_ok(
  $$ UPDATE public.crm_leads SET user_id = 'e1190000-0000-4000-8000-00000000a006'
      WHERE id = 'e1190000-0000-4000-8000-0000000001a5' $$,
  'wlasciciel bez roli sesji (migracja, backfill) podpina konto');

SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);
SELECT lives_ok(
  $$ INSERT INTO public.crm_leads (tenant_id, email, email_norm, user_id)
     VALUES ('e1190000-0000-4000-8000-0000000000a0', 'l8@sgl-guard.test', 'l8@sgl-guard.test',
             'e1190000-0000-4000-8000-00000000a005') $$,
  'service_role wstawia lead z kontem');
SELECT lives_ok(
  $$ UPDATE public.crm_leads SET user_id = 'e1190000-0000-4000-8000-00000000a004'
      WHERE id = 'e1190000-0000-4000-8000-0000000001a4' $$,
  'service_role podpina konto pod istniejacy lead');
RESET ROLE;
SELECT set_config('request.jwt.claims', '', true);
SELECT is(
  (SELECT string_agg(email_norm || '=' || COALESCE(user_id::text, '-'), ',' ORDER BY email_norm)
     FROM public.crm_leads
    WHERE tenant_id = 'e1190000-0000-4000-8000-0000000000a0'
      AND email_norm IN ('l4@sgl-guard.test', 'l5@sgl-guard.test', 'l8@sgl-guard.test')),
  'l4@sgl-guard.test=e1190000-0000-4000-8000-00000000a004,l5@sgl-guard.test=e1190000-0000-4000-8000-00000000a006,l8@sgl-guard.test=e1190000-0000-4000-8000-00000000a005',
  'zapisy wlasciciela i service_role trwale');

SELECT pg_temp.as_user('e1190000-0000-4000-8000-00000000a002');
SET LOCAL ROLE authenticated;
SELECT lives_ok(
  $$ UPDATE public.profiles SET job_title = 'Analityk'
      WHERE id = 'e1190000-0000-4000-8000-00000000a002' $$,
  'czlonek edytuje wlasny profil (authenticated)');
RESET ROLE;
SELECT set_config('request.jwt.claims', '', true);
SELECT is(
  (SELECT user_id FROM public.crm_leads WHERE id = 'e1190000-0000-4000-8000-0000000001a3'),
  'e1190000-0000-4000-8000-00000000a002'::uuid,
  'lancuch SECURITY DEFINER z sesji authenticated podpina lead czlonka (current_user = wlasciciel)');
SELECT ok(
  NOT EXISTS (SELECT 1 FROM public.domain_event_emit_errors e
               WHERE e.tenant_id = 'e1190000-0000-4000-8000-0000000000a0'
                 AND e.source = 'crm_upsert_lead_from_profile'),
  'lancuch profilu bez sladu bledu w domain_event_emit_errors');

SELECT * FROM finish();
ROLLBACK;