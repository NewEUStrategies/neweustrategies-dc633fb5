-- pgTAP: `builder_experiment_events.tenant_id` - izolacja najemcy w DANYCH,
-- nie tylko w polityce (migracja 20261019090000).
--
-- PO CO TEN PLIK. Do tej migracji zdarzenia testów A/B nie miały kolumny
-- najemcy: izolację trzymał wyłącznie EXISTS na eksperymencie w politykach
-- RLS, a rola serwisowa (beacon /api/public/experiment-event) RLS omija.
-- Plik dowodzi trzech rzeczy:
--   1. KOLUMNA jest twarda: NOT NULL, FK do `tenants`, RLS włączone.
--   2. NAJEMCA POCHODZI Z EKSPERYMENTU, nigdy z ładunku: INSERT z `tenant_id`
--      obcego najemcy, UPDATE samego `tenant_id` i INSERT bez `tenant_id`
--      kończą z najemcą eksperymentu; zmiana `experiment_id` przenosi
--      najemcę razem z eksperymentem, nieistniejący eksperyment to 23503,
--      a przeniesienie EKSPERYMENTU przepina jego zdarzenia.
--   3. IZOLACJA ODCZYTU I USUWANIA między najemcami. Każde „widzi zero" ma
--      parę „widzi swoje" po tej samej stronie - zielone zero na pustej
--      tabeli jest gorsze od czerwieni.
--
-- Uruchamianie: patrz supabase/tests/README.md (`supabase test db`).

BEGIN;
SELECT plan(21);

-- == (1) Struktura ===========================================================
SELECT has_column('public', 'builder_experiment_events', 'tenant_id',
  'builder_experiment_events ma kolumne tenant_id');

SELECT col_not_null('public', 'builder_experiment_events', 'tenant_id',
  'builder_experiment_events.tenant_id jest NOT NULL - wiersz bez najemcy nie powstanie');

SELECT fk_ok('public', 'builder_experiment_events', 'tenant_id', 'public', 'tenants', 'id',
  'builder_experiment_events.tenant_id ma FK do tenants(id)');

SELECT ok(
  (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.builder_experiment_events'::regclass),
  'RLS wlaczone na builder_experiment_events'
);

-- == Seed: dwaj najemcy, administrator po kazdej stronie =====================
ALTER TABLE auth.users DISABLE TRIGGER USER;

INSERT INTO public.tenants (id, slug, name, domain) VALUES
  ('e7a11111-1111-4111-8111-111111111111', 'ab-events-a', 'AB Events A', 'ab-events-a.example'),
  ('e7b22222-2222-4222-8222-222222222222', 'ab-events-b', 'AB Events B', 'ab-events-b.example');

INSERT INTO auth.users (id, email) VALUES
  ('e7a00000-0000-4000-8000-0000000000a1', 'admin@ab-events-a.example'),
  ('e7b00000-0000-4000-8000-0000000000b1', 'admin@ab-events-b.example');

INSERT INTO public.profiles (id, email, display_name, tenant_id) VALUES
  ('e7a00000-0000-4000-8000-0000000000a1', 'admin@ab-events-a.example', 'Admin A',
   'e7a11111-1111-4111-8111-111111111111'),
  ('e7b00000-0000-4000-8000-0000000000b1', 'admin@ab-events-b.example', 'Admin B',
   'e7b22222-2222-4222-8222-222222222222');

INSERT INTO public.user_roles (user_id, role, tenant_id) VALUES
  ('e7a00000-0000-4000-8000-0000000000a1', 'admin', 'e7a11111-1111-4111-8111-111111111111'),
  ('e7b00000-0000-4000-8000-0000000000b1', 'admin', 'e7b22222-2222-4222-8222-222222222222');

-- Eksperyment A, eksperyment B i eksperyment A „do przeniesienia" (M).
INSERT INTO public.builder_experiments (id, tenant_id, name, status) VALUES
  ('e7a0e000-0000-4000-8000-00000000e0a1', 'e7a11111-1111-4111-8111-111111111111',
   'Test A', 'running'),
  ('e7b0e000-0000-4000-8000-00000000e0b1', 'e7b22222-2222-4222-8222-222222222222',
   'Test B', 'running'),
  ('e7a0e000-0000-4000-8000-00000000e0a2', 'e7a11111-1111-4111-8111-111111111111',
   'Test A przenoszony', 'running');

-- == (2) Najemca z eksperymentu, nie z ladunku (sciezka beacona) =============
SET LOCAL ROLE service_role;

SELECT lives_ok(
  $$INSERT INTO public.builder_experiment_events
      (id, experiment_id, variant, event, visitor_id, path)
    VALUES
      ('e7e00000-0000-4000-8000-0000000000a1', 'e7a0e000-0000-4000-8000-00000000e0a1',
       'a', 'exposure', 'visitor-a-1', '/a'),
      ('e7e00000-0000-4000-8000-0000000000b1', 'e7b0e000-0000-4000-8000-00000000e0b1',
       'b', 'conversion', 'visitor-b-1', '/b'),
      ('e7e00000-0000-4000-8000-0000000000a3', 'e7a0e000-0000-4000-8000-00000000e0a2',
       'a', 'exposure', 'visitor-m-1', '/m')$$,
  'service_role: INSERT bez tenant_id przechodzi - najemce dopisuje trigger (stary kod beacona dziala)'
);

-- Ladunek wskazuje najemce B dla eksperymentu najemcy A.
SELECT lives_ok(
  $$INSERT INTO public.builder_experiment_events
      (id, experiment_id, tenant_id, variant, event, visitor_id)
    VALUES ('e7e00000-0000-4000-8000-0000000000a2', 'e7a0e000-0000-4000-8000-00000000e0a1',
            'e7b22222-2222-4222-8222-222222222222', 'b', 'conversion', 'visitor-a-2')$$,
  'service_role: INSERT z tenant_id obcego najemcy nie wywraca beacona'
);

RESET ROLE;

SELECT is(
  (SELECT tenant_id FROM public.builder_experiment_events
    WHERE id = 'e7e00000-0000-4000-8000-0000000000a2'),
  'e7a11111-1111-4111-8111-111111111111'::uuid,
  'tenant_id z ladunku (najemca B) NADPISANY najemca eksperymentu (A)'
);

SELECT is(
  (SELECT tenant_id FROM public.builder_experiment_events
    WHERE id = 'e7e00000-0000-4000-8000-0000000000a1'),
  'e7a11111-1111-4111-8111-111111111111'::uuid,
  'INSERT bez tenant_id dostaje najemce eksperymentu'
);

SET LOCAL ROLE service_role;
UPDATE public.builder_experiment_events
   SET tenant_id = 'e7b22222-2222-4222-8222-222222222222'
 WHERE id = 'e7e00000-0000-4000-8000-0000000000a1';
RESET ROLE;

SELECT is(
  (SELECT tenant_id FROM public.builder_experiment_events
    WHERE id = 'e7e00000-0000-4000-8000-0000000000a1'),
  'e7a11111-1111-4111-8111-111111111111'::uuid,
  'UPDATE samego tenant_id nie przenosi zdarzenia do obcego najemcy'
);

SELECT throws_ok(
  $$INSERT INTO public.builder_experiment_events
      (experiment_id, variant, event, visitor_id)
    VALUES ('e7f0e000-0000-4000-8000-00000000dead', 'a', 'exposure', 'visitor-x-1')$$,
  '23503',
  NULL,
  'zdarzenie nieistniejacego eksperymentu: 23503, a nie mylace naruszenie NOT NULL'
);

-- == (3) Przeniesienie eksperymentu przepina jego zdarzenia =================
SET LOCAL ROLE service_role;
UPDATE public.builder_experiments
   SET tenant_id = 'e7b22222-2222-4222-8222-222222222222'
 WHERE id = 'e7a0e000-0000-4000-8000-00000000e0a2';
RESET ROLE;

SELECT is(
  (SELECT tenant_id FROM public.builder_experiment_events
    WHERE id = 'e7e00000-0000-4000-8000-0000000000a3'),
  'e7b22222-2222-4222-8222-222222222222'::uuid,
  'zdarzenia przeniesionego eksperymentu ida za jego nowym najemca'
);

-- == (4) Administrator najemcy A =============================================
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"e7a00000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);

-- KOTWICA: rola spelniona w pelni, wiec kazde „widzi zero" nizej bierze sie
-- wylacznie z najemcy.
SELECT ok(public.is_staff(), 'admin A spelnia is_staff() - rola nie jest tu powodem odmowy');

SELECT is(
  (SELECT count(*)::int FROM public.builder_experiment_events
    WHERE experiment_id = 'e7a0e000-0000-4000-8000-00000000e0a1'),
  2,
  'admin A widzi WLASNE zdarzenia, takze to z podrobionym tenant_id (dowod niepustki)'
);

SELECT is(
  (SELECT count(*)::int FROM public.builder_experiment_events
    WHERE tenant_id = 'e7b22222-2222-4222-8222-222222222222'),
  0,
  'admin A NIE widzi zdarzen najemcy B'
);

SELECT is(
  (SELECT count(*)::int FROM public.builder_experiment_events
    WHERE experiment_id = 'e7a0e000-0000-4000-8000-00000000e0a2'),
  0,
  'admin A NIE widzi zdarzen eksperymentu przeniesionego do najemcy B'
);

SELECT results_eq(
  $$WITH d AS (
      DELETE FROM public.builder_experiment_events
       WHERE experiment_id = 'e7b0e000-0000-4000-8000-00000000e0b1'
      RETURNING 1)
    SELECT count(*)::int FROM d$$,
  $$VALUES (0)$$,
  'admin A NIE usuwa zdarzen najemcy B'
);

RESET ROLE;

-- == (5) Administrator najemcy B =============================================
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"e7b00000-0000-4000-8000-0000000000b1","role":"authenticated"}', true);

SELECT is(
  (SELECT count(*)::int FROM public.builder_experiment_events
    WHERE tenant_id = 'e7b22222-2222-4222-8222-222222222222'),
  2,
  'admin B widzi WLASNE zdarzenia i zdarzenia przeniesionego eksperymentu (dowod niepustki)'
);

SELECT is(
  (SELECT count(*)::int FROM public.builder_experiment_events
    WHERE experiment_id = 'e7a0e000-0000-4000-8000-00000000e0a1'),
  0,
  'admin B NIE widzi zdarzen eksperymentu A - takze tego, w ktorego ladunku podano najemce B'
);

SELECT results_eq(
  $$WITH d AS (
      DELETE FROM public.builder_experiment_events
       WHERE experiment_id = 'e7a0e000-0000-4000-8000-00000000e0a1'
      RETURNING 1)
    SELECT count(*)::int FROM d$$,
  $$VALUES (0)$$,
  'admin B NIE usuwa zdarzen najemcy A'
);

SELECT results_eq(
  $$WITH d AS (
      DELETE FROM public.builder_experiment_events
       WHERE experiment_id = 'e7b0e000-0000-4000-8000-00000000e0b1'
      RETURNING 1)
    SELECT count(*)::int FROM d$$,
  $$VALUES (1)$$,
  'admin B usuwa WLASNE zdarzenia (reset statystyk dziala)'
);

RESET ROLE;

-- Stan po obu probach usuniecia, liczony jako wlasciciel (bez RLS).
SELECT is(
  (SELECT count(*)::int FROM public.builder_experiment_events
    WHERE experiment_id = 'e7a0e000-0000-4000-8000-00000000e0a1'),
  2,
  'zdarzenia najemcy A przetrwaly probe usuniecia przez admina B'
);

SELECT * FROM finish();
ROLLBACK;
