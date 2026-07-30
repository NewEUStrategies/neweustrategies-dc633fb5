-- pgTAP: zamknięcie publicznych INSERT-ów (migracje 20260730130000+140000).
--
-- Bramka anty-regresyjna dla 4 findings ze skanu anonimowych INSERT-ów
-- (2026-07-30): contact_messages (spam/phishing wprost do Contact Center),
-- crm_consent_log (fabrykowanie wpisów zgód RODO dla dowolnego e-maila),
-- related_post_clicks (zalewanie sfabrykowanymi klikami → skrzywiona
-- personalizacja/analityka) oraz builder_experiment_events (sfabrykowane
-- ekspozycje/konwersje → dowolne ustawianie "zwycięzcy" testu A/B; F4,
-- migracja 20260730140000). Zapisy przechodzą wyłącznie przez utwardzone
-- ścieżki serwerowe (submitContactMessage, /api/public/related-click,
-- /api/public/experiment-event, triggery SECURITY DEFINER) działające jako
-- service_role/owner.
--
--   1. Granty: anon i authenticated NIE mają INSERT do żadnej z 4 tabel;
--      anon stracił też martwy SELECT na crm_consent_log; staffowy SELECT
--      (authenticated) i pełnia uprawnień service_role zostają.
--   2. Polityki: żadna z 4 tabel nie ma już ŻADNEJ polityki INSERT.
--   3. Zachowanie: INSERT z sesji anon oraz authenticated kończy się 42501
--      na każdej z tabel (nawet z poprawnym tenant_id publicznego wpisu i
--      działającym eksperymentem `running`).
--   4. Ścieżka legalna żyje: INSERT jako service_role przechodzi, a trigger
--      contact_messages_to_lead nadal dopisuje wpis zgody do crm_consent_log
--      przy realnym zdarzeniu (audit trail RODO niezerwany).
--
-- Uruchamianie: patrz supabase/tests/README.md (`supabase test db`).

BEGIN;
SELECT plan(31);

ALTER TABLE auth.users DISABLE TRIGGER USER;

-- ── Seed (jako właściciel; RLS pomijane) ────────────────────────────────────
INSERT INTO public.tenants (id, slug, name) VALUES
  ('df111111-1111-1111-1111-111111111111', 'tenant-lockdown', 'Tenant Lockdown');

INSERT INTO auth.users (id, email) VALUES
  ('df000000-0000-0000-0000-0000000000aa', 'member@lock.test');

INSERT INTO public.profiles (id, email, display_name, tenant_id) VALUES
  ('df000000-0000-0000-0000-0000000000aa', 'member@lock.test', 'Member',
   'df111111-1111-1111-1111-111111111111');

-- posts.parent_page_id jest NOT NULL → strona-rodzic; 2 posty tego samego
-- tenanta spełniają (nieistniejący już) warunek starej polityki INSERT
-- related_post_clicks - test dowodzi, że nawet "poprawny" ładunek odpada.
INSERT INTO public.pages (id, tenant_id, slug) VALUES
  ('dfaaaaaa-0000-0000-0000-00000000000a', 'df111111-1111-1111-1111-111111111111', 'lock-home');

INSERT INTO public.posts (id, slug, author_id, status, tenant_id, parent_page_id, title_pl) VALUES
  ('df000000-0000-0000-0000-0000000000e1', 'lock-src', 'df000000-0000-0000-0000-0000000000aa',
   'published', 'df111111-1111-1111-1111-111111111111', 'dfaaaaaa-0000-0000-0000-00000000000a', 'Src'),
  ('df000000-0000-0000-0000-0000000000e2', 'lock-tgt', 'df000000-0000-0000-0000-0000000000aa',
   'published', 'df111111-1111-1111-1111-111111111111', 'dfaaaaaa-0000-0000-0000-00000000000a', 'Tgt');

-- Działający eksperyment A/B - nawet "poprawny" ładunek (running + zgodny
-- tenant) ma odpaść na braku grantu/polityki INSERT.
INSERT INTO public.builder_experiments (id, tenant_id, name, status) VALUES
  ('df000000-0000-0000-0000-0000000000f1', 'df111111-1111-1111-1111-111111111111',
   'Lock Experiment', 'running');

-- ── 1. Granty (bramka CI w stylu pii_column_grants_test) ────────────────────
SELECT ok(
  NOT has_table_privilege('anon', 'public.contact_messages', 'INSERT'),
  'anon NIE ma grantu INSERT do contact_messages'
);
SELECT ok(
  NOT has_table_privilege('authenticated', 'public.contact_messages', 'INSERT'),
  'authenticated NIE ma grantu INSERT do contact_messages'
);
SELECT ok(
  NOT has_table_privilege('anon', 'public.crm_consent_log', 'INSERT'),
  'anon NIE ma grantu INSERT do crm_consent_log'
);
SELECT ok(
  NOT has_table_privilege('authenticated', 'public.crm_consent_log', 'INSERT'),
  'authenticated NIE ma grantu INSERT do crm_consent_log'
);
SELECT ok(
  NOT has_table_privilege('anon', 'public.crm_consent_log', 'SELECT'),
  'anon NIE ma grantu SELECT do crm_consent_log (martwy grant zdjęty)'
);
SELECT ok(
  has_table_privilege('authenticated', 'public.crm_consent_log', 'SELECT'),
  'authenticated ZACHOWUJE grant SELECT do crm_consent_log (staffowy odczyt przez RLS)'
);
SELECT ok(
  NOT has_table_privilege('anon', 'public.related_post_clicks', 'INSERT'),
  'anon NIE ma grantu INSERT do related_post_clicks'
);
SELECT ok(
  NOT has_table_privilege('authenticated', 'public.related_post_clicks', 'INSERT'),
  'authenticated NIE ma grantu INSERT do related_post_clicks'
);
SELECT ok(
  NOT has_table_privilege('anon', 'public.builder_experiment_events', 'INSERT'),
  'anon NIE ma grantu INSERT do builder_experiment_events'
);
SELECT ok(
  NOT has_table_privilege('authenticated', 'public.builder_experiment_events', 'INSERT'),
  'authenticated NIE ma grantu INSERT do builder_experiment_events'
);

-- ── 2. Polityki INSERT usunięte ─────────────────────────────────────────────
SELECT is(
  (SELECT count(*)::int FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'contact_messages' AND cmd = 'INSERT'),
  0,
  'contact_messages: zero polityk INSERT (publiczna "Anyone can submit..." usunięta)'
);
SELECT is(
  (SELECT count(*)::int FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'crm_consent_log' AND cmd = 'INSERT'),
  0,
  'crm_consent_log: zero polityk INSERT ("Anyone can insert consent log" usunięta)'
);
SELECT is(
  (SELECT count(*)::int FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'related_post_clicks' AND cmd = 'INSERT'),
  0,
  'related_post_clicks: zero polityk INSERT ("related_post_clicks public insert" usunięta)'
);
SELECT is(
  (SELECT count(*)::int FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'builder_experiment_events' AND cmd = 'INSERT'),
  0,
  'builder_experiment_events: zero polityk INSERT ("experiment events public insert" usunięta)'
);

-- ── 3a. Zachowanie: sesja anon ──────────────────────────────────────────────
SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claims', '{"role":"anon"}', true);

SELECT throws_ok(
  $$INSERT INTO public.contact_messages (tenant_id, name, email, message)
    VALUES ('df111111-1111-1111-1111-111111111111', 'Spamer',
            'spam@evil.test', 'Kup teraz: http://evil.test')$$,
  '42501',
  NULL,
  'contact_messages: anon INSERT odrzucony (spam/phishing nie wejdzie do skrzynki admina)'
);

SELECT throws_ok(
  $$INSERT INTO public.crm_consent_log
      (tenant_id, email, source_type, consent_key, consent_text, given)
    VALUES ('df111111-1111-1111-1111-111111111111', 'victim@example.test',
            'contact_form', 'rodo', 'sfabrykowana zgoda', true)$$,
  '42501',
  NULL,
  'crm_consent_log: anon INSERT odrzucony (nie da się fabrykować zgód RODO)'
);

SELECT throws_ok(
  $$INSERT INTO public.related_post_clicks
      (tenant_id, source_post_id, target_post_id, viewer_hash)
    VALUES ('df111111-1111-1111-1111-111111111111',
            'df000000-0000-0000-0000-0000000000e1',
            'df000000-0000-0000-0000-0000000000e2', 'deadbeef')$$,
  '42501',
  NULL,
  'related_post_clicks: anon INSERT odrzucony nawet dla spójnego tenanta źródła i celu'
);

SELECT throws_ok(
  $$SELECT count(*) FROM public.crm_consent_log$$,
  '42501',
  NULL,
  'crm_consent_log: anon SELECT odrzucony (audit log zgód niewidoczny publicznie)'
);

SELECT throws_ok(
  $$INSERT INTO public.builder_experiment_events
      (experiment_id, variant, event, visitor_id, path)
    VALUES ('df000000-0000-0000-0000-0000000000f1', 'b', 'conversion',
            'fake-visitor-1', '/lock')$$,
  '42501',
  NULL,
  'builder_experiment_events: anon INSERT odrzucony (nie da się fabrykować wyników A/B)'
);

RESET ROLE;

-- ── 3b. Zachowanie: sesja authenticated (zwykły członek tenanta) ────────────
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"df000000-0000-0000-0000-0000000000aa","role":"authenticated"}', true);

SELECT throws_ok(
  $$INSERT INTO public.contact_messages (tenant_id, name, email, message)
    VALUES ('df111111-1111-1111-1111-111111111111', 'Member',
            'member@lock.test', 'obejście server fn')$$,
  '42501',
  NULL,
  'contact_messages: authenticated INSERT też odrzucony (jedyna droga to server fn)'
);

SELECT throws_ok(
  $$INSERT INTO public.crm_consent_log
      (tenant_id, email, source_type, consent_key, consent_text, given)
    VALUES ('df111111-1111-1111-1111-111111111111', 'member@lock.test',
            'contact_form', 'rodo', 'własnoręczna zgoda', true)$$,
  '42501',
  NULL,
  'crm_consent_log: authenticated INSERT odrzucony (wpisy tworzą tylko triggery/service_role)'
);

SELECT throws_ok(
  $$INSERT INTO public.related_post_clicks
      (tenant_id, source_post_id, target_post_id, user_id, viewer_hash)
    VALUES ('df111111-1111-1111-1111-111111111111',
            'df000000-0000-0000-0000-0000000000e1',
            'df000000-0000-0000-0000-0000000000e2',
            'df000000-0000-0000-0000-0000000000aa', 'deadbeef')$$,
  '42501',
  NULL,
  'related_post_clicks: authenticated INSERT odrzucony (klik liczy się tylko przez beacon)'
);

SELECT throws_ok(
  $$INSERT INTO public.builder_experiment_events
      (experiment_id, variant, event, visitor_id)
    VALUES ('df000000-0000-0000-0000-0000000000f1', 'b', 'exposure',
            'fake-visitor-2')$$,
  '42501',
  NULL,
  'builder_experiment_events: authenticated INSERT odrzucony (zdarzenie tylko przez beacon)'
);

RESET ROLE;

-- ── 4. Ścieżka legalna: service_role + trigger audit trailu ────────────────
SELECT ok(
  has_table_privilege('service_role', 'public.contact_messages', 'INSERT'),
  'service_role ZACHOWUJE INSERT do contact_messages (submitContactMessage działa)'
);
SELECT ok(
  has_table_privilege('service_role', 'public.crm_consent_log', 'INSERT'),
  'service_role ZACHOWUJE INSERT do crm_consent_log'
);
SELECT ok(
  has_table_privilege('service_role', 'public.related_post_clicks', 'INSERT'),
  'service_role ZACHOWUJE INSERT do related_post_clicks (beacon działa)'
);
SELECT ok(
  has_table_privilege('service_role', 'public.builder_experiment_events', 'INSERT'),
  'service_role ZACHOWUJE INSERT do builder_experiment_events (beacon działa)'
);

SET LOCAL ROLE service_role;

SELECT lives_ok(
  $$INSERT INTO public.contact_messages
      (tenant_id, name, email, message, form_type, consent, lang, consents)
    VALUES ('df111111-1111-1111-1111-111111111111', 'Realny Nadawca',
            'sender@lock.test', 'Wiadomość przez server fn', 'contact_form',
            true, 'pl',
            '[{"key":"rodo","text":"Zgoda RODO z formularza","given":true,"lang":"pl"}]'::jsonb)$$,
  'contact_messages: INSERT jako service_role przechodzi (ścieżka server fn nienaruszona)'
);

SELECT lives_ok(
  $$INSERT INTO public.related_post_clicks
      (tenant_id, source_post_id, target_post_id, viewer_hash)
    VALUES ('df111111-1111-1111-1111-111111111111',
            'df000000-0000-0000-0000-0000000000e1',
            'df000000-0000-0000-0000-0000000000e2', 'beacon-hash')$$,
  'related_post_clicks: INSERT jako service_role przechodzi (ścieżka beacona nienaruszona)'
);

SELECT lives_ok(
  $$INSERT INTO public.builder_experiment_events
      (experiment_id, variant, event, visitor_id, path)
    VALUES ('df000000-0000-0000-0000-0000000000f1', 'a', 'exposure',
            'real-visitor-1', '/lock')$$,
  'builder_experiment_events: INSERT jako service_role przechodzi (ścieżka beacona nienaruszona)'
);

RESET ROLE;

-- Trigger contact_messages_to_lead (SECURITY DEFINER) dopisał wpis zgody z
-- payloadu consents[] - audit trail RODO powstaje nadal, ale już wyłącznie
-- przy realnym zdarzeniu formularzowym.
SELECT is(
  (SELECT count(*)::int FROM public.crm_consent_log
    WHERE tenant_id = 'df111111-1111-1111-1111-111111111111'
      AND lower(email) = 'sender@lock.test'
      AND consent_key = 'rodo'),
  1,
  'crm_consent_log: trigger nadal loguje zgodę przy realnym zgłoszeniu (service_role)'
);

SELECT * FROM finish();
ROLLBACK;
