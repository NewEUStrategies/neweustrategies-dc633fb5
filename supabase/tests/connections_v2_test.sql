-- pgTAP: sieć kontaktów v2 (20260717170000).
--
-- Weryfikowane wlasnosci:
--   1. allow_connections_from: 'nobody' odrzuca, 'mutual' wymaga wspolnego
--      kontaktu; odmowa jest nieodroznialna od niewidocznego profilu.
--   2. connection_statuses v2: wiersz takze dla 'none', mutual_count,
--      can_invite (polityka + tenant + blokady), prywatnosc cichej odmowy.
--   3. connection_suggestions v2: wspolne dossier (eu_policy_follows) i
--      wspolne wydarzenia (event_rsvps) w scoringu; wykluczenie 'nobody'.
--   4. policy_item_followers: tylko opublikowane dossier, bez self,
--      tylko discoverable.
--   5. create_event_group: host/staff, wylacznie opublikowane, idempotencja,
--      uczestnicy = host(owner) + RSVP 'going'.
--   6. user_reports: report_user (dedup, walidacje, rate limit 5/24h),
--      kolejka staffu (lista, rozstrzygniecie), licznik user_reports_open.
--   7. admin_network_stats: staff widzi metryki wlasnego tenanta,
--      nie-staff dostaje zera.
--
-- Uruchamianie: patrz supabase/tests/README.md (`supabase test db`).

BEGIN;
SELECT plan(39);

ALTER TABLE auth.users DISABLE TRIGGER USER;

INSERT INTO public.tenants (id, slug, name) VALUES
  ('cb111111-1111-1111-1111-111111111111', 'tenant-cb1', 'Tenant CB1'),
  ('cb222222-2222-2222-2222-222222222222', 'tenant-cb2', 'Tenant CB2');

INSERT INTO auth.users (id, email) VALUES
  ('cb000000-0000-0000-0000-0000000000aa', 'a@cb.test'),
  ('cb000000-0000-0000-0000-0000000000bb', 'b@cb.test'),
  ('cb000000-0000-0000-0000-0000000000cc', 'c@cb.test'),
  ('cb000000-0000-0000-0000-0000000000dd', 'd@cb.test'),
  ('cb000000-0000-0000-0000-0000000000ee', 'e@cb.test'),
  ('cb000000-0000-0000-0000-0000000000f0', 'staff@cb.test'),
  ('cb000000-0000-0000-0000-000000000090', 'host@cb.test'),
  ('cb000000-0000-0000-0000-0000000000e1', 'x@cb.test'),
  ('cb000000-0000-0000-0000-0000000000e2', 'y@cb.test'),
  ('cb000000-0000-0000-0000-000000000099', 'z@cb.test');

INSERT INTO public.profiles (id, email, display_name, tenant_id, discoverable) VALUES
  ('cb000000-0000-0000-0000-0000000000aa', 'a@cb.test', 'Ala CB',
   'cb111111-1111-1111-1111-111111111111', true),
  ('cb000000-0000-0000-0000-0000000000bb', 'b@cb.test', 'Bartek CB',
   'cb111111-1111-1111-1111-111111111111', true),
  ('cb000000-0000-0000-0000-0000000000cc', 'c@cb.test', 'Celina CB',
   'cb111111-1111-1111-1111-111111111111', true),
  ('cb000000-0000-0000-0000-0000000000dd', 'd@cb.test', 'Dorota CB',
   'cb111111-1111-1111-1111-111111111111', true),
  ('cb000000-0000-0000-0000-0000000000ee', 'e@cb.test', 'Ewa CB',
   'cb111111-1111-1111-1111-111111111111', true),
  ('cb000000-0000-0000-0000-0000000000f0', 'staff@cb.test', 'Staff CB',
   'cb111111-1111-1111-1111-111111111111', true),
  ('cb000000-0000-0000-0000-000000000090', 'host@cb.test', 'Host CB',
   'cb111111-1111-1111-1111-111111111111', true),
  ('cb000000-0000-0000-0000-0000000000e1', 'x@cb.test', 'Xawery CB',
   'cb111111-1111-1111-1111-111111111111', true),
  ('cb000000-0000-0000-0000-0000000000e2', 'y@cb.test', 'Yga CB',
   'cb111111-1111-1111-1111-111111111111', true),
  ('cb000000-0000-0000-0000-000000000099', 'z@cb.test', 'Zenon CB',
   'cb222222-2222-2222-2222-222222222222', true);

INSERT INTO public.user_roles (user_id, role, tenant_id) VALUES
  ('cb000000-0000-0000-0000-0000000000f0', 'admin',
   'cb111111-1111-1111-1111-111111111111');

-- Polityki przyjmowania zaproszen: C nikt, D tylko wspolny kontakt.
INSERT INTO public.notification_preferences (user_id, allow_connections_from) VALUES
  ('cb000000-0000-0000-0000-0000000000cc', 'nobody'),
  ('cb000000-0000-0000-0000-0000000000dd', 'mutual');

-- ---------------------------------------------------------------------------
-- 1-3. allow_connections_from
-- ---------------------------------------------------------------------------
SELECT set_config('request.jwt.claims',
  '{"sub":"cb000000-0000-0000-0000-0000000000aa","role":"authenticated"}', true);

SELECT throws_like(
  $$SELECT public.connection_request('cb000000-0000-0000-0000-0000000000cc')$$,
  '%peer not available%',
  'allow_connections_from=nobody odrzuca swieze zaproszenie'
);

SELECT throws_like(
  $$SELECT public.connection_request('cb000000-0000-0000-0000-0000000000dd')$$,
  '%peer not available%',
  'allow_connections_from=mutual bez wspolnego kontaktu odrzuca'
);

-- Wspolny kontakt E: A-E oraz D-E zaakceptowane.
INSERT INTO public.user_connections (tenant_id, requester_id, addressee_id) VALUES
  ('cb111111-1111-1111-1111-111111111111',
   'cb000000-0000-0000-0000-0000000000aa', 'cb000000-0000-0000-0000-0000000000ee'),
  ('cb111111-1111-1111-1111-111111111111',
   'cb000000-0000-0000-0000-0000000000dd', 'cb000000-0000-0000-0000-0000000000ee');
UPDATE public.user_connections SET status = 'accepted'
 WHERE addressee_id = 'cb000000-0000-0000-0000-0000000000ee';

SELECT ok(
  public.connection_request('cb000000-0000-0000-0000-0000000000dd') IS NOT NULL,
  'allow_connections_from=mutual przepuszcza przy wspolnym kontakcie'
);

-- ---------------------------------------------------------------------------
-- 4-11. connection_statuses v2 (wiersze none, mutual_count, can_invite)
-- ---------------------------------------------------------------------------
SELECT is(
  (SELECT cs.status FROM public.connection_statuses(
     ARRAY['cb000000-0000-0000-0000-0000000000bb'::uuid]) cs),
  'none',
  'statuses v2 zwraca wiersz none dla obcych'
);

SELECT ok(
  (SELECT cs.can_invite FROM public.connection_statuses(
     ARRAY['cb000000-0000-0000-0000-0000000000bb'::uuid]) cs),
  'can_invite=true dla widocznego profilu bez ograniczen'
);

SELECT ok(
  NOT (SELECT cs.can_invite FROM public.connection_statuses(
     ARRAY['cb000000-0000-0000-0000-0000000000cc'::uuid]) cs),
  'can_invite=false przy allow_connections_from=nobody'
);

SELECT ok(
  NOT (SELECT cs.can_invite FROM public.connection_statuses(
     ARRAY['cb000000-0000-0000-0000-000000000099'::uuid]) cs),
  'can_invite=false dla profilu z innego tenanta'
);

SELECT is(
  (SELECT cs.status FROM public.connection_statuses(
     ARRAY['cb000000-0000-0000-0000-0000000000dd'::uuid]) cs),
  'pending_out',
  'statuses v2: moje oczekujace zaproszenie'
);

SELECT is(
  (SELECT cs.mutual_count::int FROM public.connection_statuses(
     ARRAY['cb000000-0000-0000-0000-0000000000dd'::uuid]) cs),
  1,
  'mutual_count liczy wspolne kontakty (E)'
);

SELECT is(
  (SELECT cs.status FROM public.connection_statuses(
     ARRAY['cb000000-0000-0000-0000-0000000000ee'::uuid]) cs),
  'connected',
  'statuses v2: polaczeni'
);

SELECT ok(
  NOT (SELECT cs.can_invite FROM public.connection_statuses(
     ARRAY['cb000000-0000-0000-0000-0000000000ee'::uuid]) cs),
  'can_invite=false gdy relacja juz istnieje'
);

-- ---------------------------------------------------------------------------
-- 12-13. Cicha odmowa w statuses v2
-- ---------------------------------------------------------------------------
SELECT set_config('request.jwt.claims',
  '{"sub":"cb000000-0000-0000-0000-0000000000bb","role":"authenticated"}', true);
SELECT ok(
  public.connection_request('cb000000-0000-0000-0000-0000000000aa') IS NOT NULL,
  'B zaprasza A (setup cichej odmowy)'
);

SELECT set_config('request.jwt.claims',
  '{"sub":"cb000000-0000-0000-0000-0000000000aa","role":"authenticated"}', true);
SELECT public.connection_respond(
  (SELECT c.id FROM public.user_connections c
    WHERE c.requester_id = 'cb000000-0000-0000-0000-0000000000bb'
      AND c.addressee_id = 'cb000000-0000-0000-0000-0000000000aa'),
  false);

SELECT ok(
  (SELECT cs.status = 'none' AND cs.can_invite AND cs.connection_id IS NULL
     FROM public.connection_statuses(
       ARRAY['cb000000-0000-0000-0000-0000000000bb'::uuid]) cs),
  'odmawiajacy widzi none + can_invite (cicha odmowa niewidoczna nawet w id)'
);

SELECT set_config('request.jwt.claims',
  '{"sub":"cb000000-0000-0000-0000-0000000000bb","role":"authenticated"}', true);
SELECT is(
  (SELECT cs.status FROM public.connection_statuses(
     ARRAY['cb000000-0000-0000-0000-0000000000aa'::uuid]) cs),
  'pending_out',
  'zapraszajacy po odmowie dalej widzi pending_out'
);

-- ---------------------------------------------------------------------------
-- 14-16. connection_suggestions v2: wspolne dossier + wspolne wydarzenia
-- ---------------------------------------------------------------------------
INSERT INTO public.eu_policy_items (id, tenant_id, slug, title_pl, title_en, status) VALUES
  ('cb333333-3333-3333-3333-333333333331',
   'cb111111-1111-1111-1111-111111111111', 'dossier-cb1', 'Dossier CB1', 'Dossier CB1',
   'published'),
  ('cb333333-3333-3333-3333-333333333332',
   'cb111111-1111-1111-1111-111111111111', 'dossier-cb2', 'Dossier CB2', 'Dossier CB2',
   'draft');

INSERT INTO public.eu_policy_follows (item_id, user_id, tenant_id) VALUES
  ('cb333333-3333-3333-3333-333333333331', 'cb000000-0000-0000-0000-0000000000aa',
   'cb111111-1111-1111-1111-111111111111'),
  ('cb333333-3333-3333-3333-333333333331', 'cb000000-0000-0000-0000-0000000000e1',
   'cb111111-1111-1111-1111-111111111111'),
  ('cb333333-3333-3333-3333-333333333332', 'cb000000-0000-0000-0000-0000000000e1',
   'cb111111-1111-1111-1111-111111111111');

INSERT INTO public.events (id, tenant_id, slug, title_pl, title_en, status, host_user_id) VALUES
  ('cb444444-4444-4444-4444-444444444441',
   'cb111111-1111-1111-1111-111111111111', 'event-cb1', 'Briefing CB', 'Briefing CB',
   'published', 'cb000000-0000-0000-0000-000000000090'),
  ('cb444444-4444-4444-4444-444444444442',
   'cb111111-1111-1111-1111-111111111111', 'event-cb2', 'Szkic CB', 'Draft CB',
   'draft', 'cb000000-0000-0000-0000-000000000090');

INSERT INTO public.event_rsvps (tenant_id, event_id, user_id, status) VALUES
  ('cb111111-1111-1111-1111-111111111111', 'cb444444-4444-4444-4444-444444444441',
   'cb000000-0000-0000-0000-0000000000aa', 'going'),
  ('cb111111-1111-1111-1111-111111111111', 'cb444444-4444-4444-4444-444444444441',
   'cb000000-0000-0000-0000-0000000000e1', 'going');

SELECT set_config('request.jwt.claims',
  '{"sub":"cb000000-0000-0000-0000-0000000000aa","role":"authenticated"}', true);

SELECT is(
  (SELECT s.shared_follows::int FROM public.connection_suggestions(24) s
    WHERE s.user_id = 'cb000000-0000-0000-0000-0000000000e1'),
  1,
  'sugestie v2: wspolne opublikowane dossier podbija shared_follows'
);

SELECT is(
  (SELECT s.shared_events::int FROM public.connection_suggestions(24) s
    WHERE s.user_id = 'cb000000-0000-0000-0000-0000000000e1'),
  1,
  'sugestie v2: wspolne wydarzenie podbija shared_events'
);

SELECT is(
  (SELECT count(*)::int FROM public.connection_suggestions(24) s
    WHERE s.user_id = 'cb000000-0000-0000-0000-0000000000cc'),
  0,
  'sugestie v2 pomijaja osoby z allow_connections_from=nobody'
);

-- ---------------------------------------------------------------------------
-- 17-18. policy_item_followers
-- ---------------------------------------------------------------------------
SELECT is(
  (SELECT count(*)::int FROM public.policy_item_followers(
     'cb333333-3333-3333-3333-333333333331')),
  1,
  'policy_item_followers zwraca widocznych obserwujacych bez self (X)'
);

SELECT is(
  (SELECT count(*)::int FROM public.policy_item_followers(
     'cb333333-3333-3333-3333-333333333332')),
  0,
  'nieopublikowane dossier nie ujawnia obserwujacych'
);

-- ---------------------------------------------------------------------------
-- 19-24. create_event_group
-- ---------------------------------------------------------------------------
SELECT set_config('request.jwt.claims',
  '{"sub":"cb000000-0000-0000-0000-000000000090","role":"authenticated"}', true);

SELECT ok(
  public.create_event_group('cb444444-4444-4444-4444-444444444441') IS NOT NULL,
  'host tworzy grupe wydarzenia'
);

SELECT is(
  (SELECT count(*)::int FROM public.conversation_participants cp
    WHERE cp.conversation_id =
          (SELECT e.conversation_id FROM public.events e
            WHERE e.id = 'cb444444-4444-4444-4444-444444444441')),
  3,
  'grupa wydarzenia = host(owner) + uczestnicy going (A, X)'
);

SELECT is(
  public.create_event_group('cb444444-4444-4444-4444-444444444441'),
  (SELECT e.conversation_id FROM public.events e
    WHERE e.id = 'cb444444-4444-4444-4444-444444444441'),
  'create_event_group jest idempotentne'
);

SELECT throws_like(
  $$SELECT public.create_event_group('cb444444-4444-4444-4444-444444444442')$$,
  '%not published%',
  'szkic wydarzenia nie dostaje grupy'
);

SELECT set_config('request.jwt.claims',
  '{"sub":"cb000000-0000-0000-0000-0000000000bb","role":"authenticated"}', true);

SELECT throws_like(
  $$SELECT public.create_event_group('cb444444-4444-4444-4444-444444444441')$$,
  '%host or staff%',
  'nie-host bez roli staff nie tworzy grupy wydarzenia'
);

SELECT is(
  (SELECT count(*)::int FROM public.notifications n
    WHERE n.user_id = 'cb000000-0000-0000-0000-0000000000aa'
      AND n.kind = 'message'
      AND n.title_pl LIKE 'Dodano Cię do kręgu%'),
  1,
  'uczestnik dostal powiadomienie o dodaniu do grupy wydarzenia'
);

-- ---------------------------------------------------------------------------
-- 25-33. user_reports + kolejka staffu + licznik
-- ---------------------------------------------------------------------------
SELECT ok(
  public.report_user('cb000000-0000-0000-0000-0000000000aa', 'spam',
                     'Masowe zaproszenia') IS NOT NULL,
  'czlonek zglasza uzytkownika'
);

SELECT is(
  (SELECT c.value FROM public.tenant_pending_counters c
    WHERE c.tenant_id = 'cb111111-1111-1111-1111-111111111111'
      AND c.counter_key = 'user_reports_open'),
  1,
  'licznik user_reports_open = 1 po zgloszeniu'
);

SELECT is(
  public.report_user('cb000000-0000-0000-0000-0000000000aa', 'spam'),
  (SELECT r.id FROM public.user_reports r
    WHERE r.reporter_id = 'cb000000-0000-0000-0000-0000000000bb'
      AND r.reported_id = 'cb000000-0000-0000-0000-0000000000aa'
      AND r.status = 'open'),
  'duplikat otwartego zgloszenia tej samej pary zwraca istniejace id'
);

SELECT throws_like(
  $$SELECT public.report_user('cb000000-0000-0000-0000-0000000000aa', 'nonsense')$$,
  '%invalid reason%',
  'nieznany powod zgloszenia jest odrzucany'
);

SELECT throws_like(
  $$SELECT public.report_user('cb000000-0000-0000-0000-0000000000bb', 'spam')$$,
  '%invalid target%',
  'nie mozna zglosic samego siebie'
);

SELECT is(
  (SELECT count(*)::int FROM public.admin_list_user_reports('open')),
  0,
  'nie-staff nie widzi kolejki zgloszen'
);

SELECT throws_like(
  $$SELECT public.admin_resolve_user_report(
      (SELECT r.id FROM public.user_reports r LIMIT 1), 'resolved')$$,
  '%staff role required%',
  'nie-staff nie rozstrzyga zgloszen'
);

SELECT set_config('request.jwt.claims',
  '{"sub":"cb000000-0000-0000-0000-0000000000f0","role":"authenticated"}', true);

SELECT is(
  (SELECT l.reported_name FROM public.admin_list_user_reports('open') l),
  'Ala CB',
  'staff widzi zgloszenie z nazwiskami stron'
);

SELECT lives_ok(
  $$SELECT public.admin_resolve_user_report(
      (SELECT r.id FROM public.user_reports r WHERE r.status = 'open'),
      'resolved', 'Sprawdzone - fałszywy alarm')$$,
  'staff rozstrzyga zgloszenie'
);

SELECT is(
  (SELECT c.value FROM public.tenant_pending_counters c
    WHERE c.tenant_id = 'cb111111-1111-1111-1111-111111111111'
      AND c.counter_key = 'user_reports_open'),
  0,
  'licznik user_reports_open wraca do zera po rozstrzygnieciu'
);

-- ---------------------------------------------------------------------------
-- 34-35. admin_network_stats
-- ---------------------------------------------------------------------------
SELECT is(
  (SELECT s.connections_total::int FROM public.admin_network_stats() s),
  (SELECT count(*)::int FROM public.user_connections c
    WHERE c.tenant_id = 'cb111111-1111-1111-1111-111111111111'
      AND c.status = 'accepted'),
  'admin_network_stats liczy polaczenia wlasnego tenanta'
);

SELECT set_config('request.jwt.claims',
  '{"sub":"cb000000-0000-0000-0000-0000000000bb","role":"authenticated"}', true);

SELECT is(
  (SELECT s.connections_total::int FROM public.admin_network_stats() s),
  0,
  'nie-staff dostaje zera zamiast metryk'
);

-- ---------------------------------------------------------------------------
-- 36-37. Rate limit zgloszen (5/24h)
-- ---------------------------------------------------------------------------
SELECT set_config('request.jwt.claims',
  '{"sub":"cb000000-0000-0000-0000-0000000000ee","role":"authenticated"}', true);

SELECT ok(
  (SELECT count(*) FROM (
     SELECT public.report_user(u, 'spam') FROM unnest(ARRAY[
       'cb000000-0000-0000-0000-0000000000aa'::uuid,
       'cb000000-0000-0000-0000-0000000000bb'::uuid,
       'cb000000-0000-0000-0000-0000000000cc'::uuid,
       'cb000000-0000-0000-0000-0000000000dd'::uuid,
       'cb000000-0000-0000-0000-0000000000e1'::uuid
     ]) AS u
   ) reports) = 5,
  'piec zgloszen w limicie przechodzi'
);

SELECT throws_like(
  $$SELECT public.report_user('cb000000-0000-0000-0000-0000000000e2', 'spam')$$,
  '%rate limited%',
  'szoste zgloszenie w 24h jest odrzucane'
);

SELECT * FROM finish();
ROLLBACK;
