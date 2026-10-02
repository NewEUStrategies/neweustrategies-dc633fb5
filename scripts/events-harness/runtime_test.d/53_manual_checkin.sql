-- ============================================================================
-- 53 ODPRAWA RECZNA Z PANELU: KLUCZ IDEMPOTENCJI I BRAMKA NAJEMCY
--
-- PO CO TEN PLIK ISTNIEJE. `admin_event_checkin_manual` (stanowisko odprawy
-- w panelu, `OnsiteDeskPanel.tsx`) nie mial dotad ANI JEDNEJ asercji
-- zachowania. Dwie rzeczy, ktorych przeglad tekstu nie potwierdzi:
--   (1) KLUCZ IDEMPOTENCJI. Panel wysyla teraz `client_scan_uid` stabilny na
--       probe: ponowienie po zerwanej odpowiedzi MUSI oddac `replay` i ten sam
--       wiersz dziennika, a nie drugie wejscie tej samej osoby;
--   (2) BRAMKA NAJEMCY. Najemca pochodzi z `assert_editor_tenant()` (admin albo
--       super_admin najemcy wolajacego), a nie z ladunku. Administrator najemcy
--       B nie odprawi osoby najemcy A ani przez bramke najemcy A - i nie zostawi
--       w dzienniku A zadnego wiersza.
-- Do tego granice roli (redaktor, anonim) i zrodla (`qr_code` z panelu).
--
-- SPRZATANIE. Jedna transakcja zakonczona ROLLBACK-iem.
-- ============================================================================
\echo '== 53 odprawa reczna: idempotencja i najemca =='

BEGIN;

INSERT INTO public.tenants (id, name, slug) VALUES
  ('53b00000-0000-4000-8000-0000000000b1', 'Tenant odprawy B', 'manual-checkin-b')
ON CONFLICT (id) DO NOTHING;

INSERT INTO auth.users (id, email) VALUES
  ('53a00000-0000-4000-8000-000000000a01', 'desk.admin.a@example.org'),
  ('53a00000-0000-4000-8000-000000000b01', 'desk.admin.b@example.org'),
  ('53a00000-0000-4000-8000-000000000e01', 'desk.editor.a@example.org')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.profiles (id, tenant_id) VALUES
  ('53a00000-0000-4000-8000-000000000a01', '11111111-1111-1111-1111-111111111111'),
  ('53a00000-0000-4000-8000-000000000b01', '53b00000-0000-4000-8000-0000000000b1'),
  ('53a00000-0000-4000-8000-000000000e01', '11111111-1111-1111-1111-111111111111')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.user_roles (user_id, role) VALUES
  ('53a00000-0000-4000-8000-000000000a01', 'admin'),
  ('53a00000-0000-4000-8000-000000000b01', 'admin'),
  ('53a00000-0000-4000-8000-000000000e01', 'editor')
ON CONFLICT DO NOTHING;

INSERT INTO public.events (id, tenant_id, slug, title_pl, title_en, starts_at, status,
  registration_mode, registration_flow) VALUES
  ('53e00000-0000-4000-8000-0000000000a1', '11111111-1111-1111-1111-111111111111',
   'desk-a', 'Odprawa A', 'Desk A', now() + interval '1 day', 'published', 'form', 'instant'),
  ('53e00000-0000-4000-8000-0000000000b1', '53b00000-0000-4000-8000-0000000000b1',
   'desk-b', 'Odprawa B', 'Desk B', now() + interval '1 day', 'published', 'form', 'instant');

INSERT INTO public.event_checkpoints (id, tenant_id, event_id, name_pl, name_en, kind,
  direction_mode, access_mode, dedupe_window_seconds) VALUES
  ('53c00000-0000-4000-8000-0000000000a1', '11111111-1111-1111-1111-111111111111',
   '53e00000-0000-4000-8000-0000000000a1', 'Brama A', 'Gate A', 'event_entry', 'in_out', 'control', 60),
  ('53c00000-0000-4000-8000-0000000000b1', '53b00000-0000-4000-8000-0000000000b1',
   '53e00000-0000-4000-8000-0000000000b1', 'Brama B', 'Gate B', 'event_entry', 'in_out', 'control', 60);

INSERT INTO public.event_people (id, tenant_id, first_name, last_name, email, source) VALUES
  ('53700000-0000-4000-8000-0000000000a1', '11111111-1111-1111-1111-111111111111',
   'Alicja', 'Odprawiona', 'alicja.desk@example.org', 'organizer'),
  ('53700000-0000-4000-8000-0000000000b1', '53b00000-0000-4000-8000-0000000000b1',
   'Bogdan', 'Obcy', 'bogdan.desk@example.org', 'organizer');

INSERT INTO public.event_registrations (id, tenant_id, event_id, person_id, status,
  registration_mode, payment_status) VALUES
  ('53400000-0000-4000-8000-0000000000a1', '11111111-1111-1111-1111-111111111111',
   '53e00000-0000-4000-8000-0000000000a1', '53700000-0000-4000-8000-0000000000a1',
   'approved', 'form', 'not_required'),
  ('53400000-0000-4000-8000-0000000000b1', '53b00000-0000-4000-8000-0000000000b1',
   '53e00000-0000-4000-8000-0000000000b1', '53700000-0000-4000-8000-0000000000b1',
   'approved', 'form', 'not_required');

-- ── 1. Klucz idempotencji: ponowienie tej samej proby to `replay` ──────────
SELECT pg_temp.act_as('53a00000-0000-4000-8000-000000000a01', '11111111-1111-1111-1111-111111111111');

DO $$
DECLARE
  v_first jsonb;
  v_again jsonb;
  v_next jsonb;
BEGIN
  v_first := public.admin_event_checkin_manual(jsonb_build_object(
    'event_id', '53e00000-0000-4000-8000-0000000000a1',
    'checkpoint_id', '53c00000-0000-4000-8000-0000000000a1',
    'person_id', '53700000-0000-4000-8000-0000000000a1',
    'direction', 'in', 'source', 'name_search',
    'client_scan_uid', 'desk-proba-0001'));
  PERFORM pg_temp.assert((v_first->>'admit')::boolean IS TRUE,
    '53/idempotencja: pierwsza proba wpuszcza osobe z zapisem');

  -- Zerwana odpowiedz: panel ponawia TEN SAM klucz.
  v_again := public.admin_event_checkin_manual(jsonb_build_object(
    'event_id', '53e00000-0000-4000-8000-0000000000a1',
    'checkpoint_id', '53c00000-0000-4000-8000-0000000000a1',
    'person_id', '53700000-0000-4000-8000-0000000000a1',
    'direction', 'in', 'source', 'name_search',
    'client_scan_uid', 'desk-proba-0001'));
  PERFORM pg_temp.assert(v_again->>'outcome' = 'replay',
    '53/idempotencja: ten sam client_scan_uid z panelu daje replay');
  PERFORM pg_temp.assert(v_again->>'checkin_id' = v_first->>'checkin_id',
    '53/idempotencja: replay wskazuje TEN SAM wiersz dziennika');
  PERFORM pg_temp.assert(
    (SELECT count(*) FROM public.event_checkins
      WHERE event_id = '53e00000-0000-4000-8000-0000000000a1'
        AND client_scan_uid = 'desk-proba-0001') = 1,
    '53/idempotencja: ponowienie nie tworzy drugiego wiersza');
  PERFORM pg_temp.assert(
    (SELECT source FROM public.event_checkins
      WHERE client_scan_uid = 'desk-proba-0001') = 'name_search',
    '53/idempotencja: wiersz z panelu nie udaje skanu (source = name_search)');

  -- Nowa, swiadoma proba (inny klucz) to nowe zdarzenie, nie replay.
  v_next := public.admin_event_checkin_manual(jsonb_build_object(
    'event_id', '53e00000-0000-4000-8000-0000000000a1',
    'checkpoint_id', '53c00000-0000-4000-8000-0000000000a1',
    'person_id', '53700000-0000-4000-8000-0000000000a1',
    'direction', 'out', 'source', 'name_search',
    'client_scan_uid', 'desk-proba-0002'));
  PERFORM pg_temp.assert(v_next->>'outcome' <> 'replay',
    '53/idempotencja: nowy klucz to nowa decyzja, nie powtorka starej');
END $$;

SELECT pg_temp.assert_raises_like(
  $$SELECT public.admin_event_checkin_manual(jsonb_build_object(
    'event_id', '53e00000-0000-4000-8000-0000000000a1',
    'checkpoint_id', '53c00000-0000-4000-8000-0000000000a1',
    'person_id', '53700000-0000-4000-8000-0000000000a1',
    'source', 'qr_code'))$$,
  'invalid_source', '53/zrodlo: panel nie zapisze odprawy udajacej skan QR');

SELECT pg_temp.assert_raises_like(
  $$SELECT public.admin_event_checkin_manual(jsonb_build_object(
    'event_id', '53e00000-0000-4000-8000-0000000000a1',
    'checkpoint_id', '53c00000-0000-4000-8000-0000000000a1',
    'person_id', '53700000-0000-4000-8000-0000000000b1'))$$,
  'person_not_found', '53/najemca: administrator A nie odprawi osoby najemcy B');

-- ── 2. Bramka najemcy: administrator B wobec wydarzenia A ──────────────────
SELECT pg_temp.act_as('53a00000-0000-4000-8000-000000000b01', '53b00000-0000-4000-8000-0000000000b1');

SELECT pg_temp.assert_raises_like(
  $$SELECT public.admin_event_checkin_manual(jsonb_build_object(
    'event_id', '53e00000-0000-4000-8000-0000000000a1',
    'checkpoint_id', '53c00000-0000-4000-8000-0000000000a1',
    'person_id', '53700000-0000-4000-8000-0000000000a1',
    'client_scan_uid', 'desk-obcy-0001'))$$,
  'person_not_found', '53/najemca: administrator B nie odprawi osoby najemcy A');

SELECT pg_temp.assert_raises_like(
  $$SELECT public.admin_event_checkin_manual(jsonb_build_object(
    'event_id', '53e00000-0000-4000-8000-0000000000a1',
    'checkpoint_id', '53c00000-0000-4000-8000-0000000000a1',
    'person_id', '53700000-0000-4000-8000-0000000000b1',
    'client_scan_uid', 'desk-obcy-0002'))$$,
  'checkpoint_not_found', '53/najemca: wlasna osoba nie otwiera bramki najemcy A');

-- Replay po obcym kluczu tez nie przechodzi: klucz jest w zakresie najemcy.
SELECT pg_temp.assert_raises(
  $$SELECT public.admin_event_checkin_manual(jsonb_build_object(
    'event_id', '53e00000-0000-4000-8000-0000000000a1',
    'checkpoint_id', '53c00000-0000-4000-8000-0000000000a1',
    'person_id', '53700000-0000-4000-8000-0000000000a1',
    'client_scan_uid', 'desk-proba-0001'))$$,
  '53/najemca: cudzy klucz idempotencji nie oddaje cudzej decyzji');

SELECT pg_temp.assert(
  (SELECT count(*) FROM public.event_checkins
    WHERE event_id = '53e00000-0000-4000-8000-0000000000a1'
      AND client_scan_uid LIKE 'desk-obcy-%') = 0,
  '53/najemca: odmowy najemcy B nie zostawily wiersza w dzienniku A');

-- Ten sam administrator przechodzi u siebie - inaczej odmowy wyzej
-- dowodzilyby tylko tego, ze funkcja zawsze pada.
SELECT pg_temp.assert(
  (public.admin_event_checkin_manual(jsonb_build_object(
    'event_id', '53e00000-0000-4000-8000-0000000000b1',
    'checkpoint_id', '53c00000-0000-4000-8000-0000000000b1',
    'person_id', '53700000-0000-4000-8000-0000000000b1',
    'client_scan_uid', 'desk-wlasny-0001'))->>'admit')::boolean IS TRUE,
  '53/najemca: administrator B odprawia we wlasnym najemcy');

-- ── 3. Rola i anonim ───────────────────────────────────────────────────────
SELECT pg_temp.act_as('53a00000-0000-4000-8000-000000000e01', '11111111-1111-1111-1111-111111111111');
SELECT pg_temp.assert_raises_like(
  $$SELECT public.admin_event_checkin_manual(jsonb_build_object(
    'event_id', '53e00000-0000-4000-8000-0000000000a1',
    'checkpoint_id', '53c00000-0000-4000-8000-0000000000a1',
    'person_id', '53700000-0000-4000-8000-0000000000a1'))$$,
  'admin role required', '53/rola: redaktor nie odprawia z panelu');

SELECT pg_temp.act_as(NULL, NULL);
SELECT pg_temp.assert_raises_like(
  $$SELECT public.admin_event_checkin_manual(jsonb_build_object(
    'event_id', '53e00000-0000-4000-8000-0000000000a1',
    'checkpoint_id', '53c00000-0000-4000-8000-0000000000a1',
    'person_id', '53700000-0000-4000-8000-0000000000a1'))$$,
  'authentication required', '53/rola: anonim dostaje odmowe wyjatkiem');
SELECT pg_temp.assert(
  NOT has_function_privilege('anon', 'public.admin_event_checkin_manual(jsonb)', 'EXECUTE'),
  '53/rola: anon nie ma grantu na odprawe reczna');

ROLLBACK;
