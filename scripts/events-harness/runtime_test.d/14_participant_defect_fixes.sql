-- ============================================================================
-- 14_participant_defect_fixes - NAPRAWY D0 (spec B.3.2)
--
-- PO CO TEN PLIK ISTNIEJE
-- `20260926100100_event_participant_defect_fixes.sql` redefiniuje trzy funkcje
-- i oznacza kazda zmiane `-- ZMIANA (PF-F): <slug>`. Kazdy slug ma tu
-- asercje z etykieta `PF-F ZMIANA <slug>` (sprawdza to `sql-cov.mjs`):
--   * `event_my_agenda` - sala z `event_rooms.name/floor`, odwolane sesje
--     oznaczone, szkice ukryte, bez `stream_url`, strefa wydarzenia;
--   * `payments_apply_event_ticket_outcome(..., 'refunded')` - czysci kod QR
--     i zwalnia zapisy, zakladki i starsza rezerwacje RSVP posiadacza;
--   * `_event_apply_outcome_to_group` - to samo dla gosci grupy.
--
-- CZEGO TEN PLIK NIE SPRAWDZA
--   * odmow macierzy zwrotow (tor B, pliki 25_/34_);
--   * bramki preferencji powiadomien (pgTAP).
--
-- SPRZATANIE: caly plik w BEGIN ... ROLLBACK.
-- ============================================================================

\echo '== 14 naprawy D0: agenda, zwrot czysci kod QR, kaskada grupy =='

BEGIN;

INSERT INTO public.tenants (id, name, slug) VALUES
  ('14141414-1414-1414-1414-141414141414', 'Tenant 14', 't14')
ON CONFLICT (id) DO NOTHING;

INSERT INTO auth.users (id, email) VALUES
  ('14000000-0000-0000-0000-000000000001', 'agenda.14@example.org'),
  ('14000000-0000-0000-0000-000000000002', 'other.14@example.org'),
  ('14000000-0000-0000-0000-000000000003', 'buyer.14@example.org'),
  ('14000000-0000-0000-0000-000000000004', 'waiter.14@example.org'),
  ('14000000-0000-0000-0000-000000000005', 'lead.14@example.org'),
  ('14000000-0000-0000-0000-000000000006', 'guest.14@example.org'),
  ('14000000-0000-0000-0000-000000000007', 'partial.14@example.org')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.events
  (id, tenant_id, slug, title_pl, title_en, starts_at, ends_at, timezone, status,
   registration_mode, registration_flow)
VALUES
  ('14100000-0000-0000-0000-000000000001', '14141414-1414-1414-1414-141414141414',
   'd0-agenda', 'Agenda D0', 'Agenda D0', '2030-07-01 08:00+00', '2030-07-01 20:00+00', 'Mars/Base',
   'published', 'form', 'instant'),
  ('14100000-0000-0000-0000-000000000002', '14141414-1414-1414-1414-141414141414',
   'd0-refund', 'Zwrot D0', 'Refund D0', '2030-07-02 08:00+00', '2030-07-02 20:00+00', 'Europe/Warsaw',
   'published', 'form', 'instant'),
  ('14100000-0000-0000-0000-000000000003', '14141414-1414-1414-1414-141414141414',
   'd0-ny', 'Nowy Jork D0', 'New York D0', '2030-07-03 08:00+00', '2030-07-03 20:00+00', 'America/New_York',
   'published', 'form', 'instant');

INSERT INTO public.event_rooms (id, tenant_id, event_id, name, floor) VALUES
  ('14600000-0000-0000-0000-000000000001', '14141414-1414-1414-1414-141414141414',
   '14100000-0000-0000-0000-000000000001', 'Sala Kopernika', '2');

INSERT INTO public.event_sessions
  (id, tenant_id, event_id, room_id, title_pl, title_en, starts_at, ends_at, status,
   requires_signup, capacity, is_private, stream_url, cancelled_at)
VALUES
  ('14200000-0000-0000-0000-000000000001', '14141414-1414-1414-1414-141414141414',
   '14100000-0000-0000-0000-000000000001', '14600000-0000-0000-0000-000000000001',
   'Otwarcie', 'Opening', '2030-07-01 09:00+00', '2030-07-01 10:00+00', 'published',
   true, NULL, false, 'https://stream.example.org/opening', NULL),
  ('14200000-0000-0000-0000-000000000002', '14141414-1414-1414-1414-141414141414',
   '14100000-0000-0000-0000-000000000001', NULL,
   'Odwolana', 'Cancelled one', '2030-07-01 11:00+00', '2030-07-01 12:00+00', 'cancelled',
   true, NULL, false, NULL, now()),
  ('14200000-0000-0000-0000-000000000003', '14141414-1414-1414-1414-141414141414',
   '14100000-0000-0000-0000-000000000001', NULL,
   'Szkic', 'Draft one', '2030-07-01 13:00+00', '2030-07-01 14:00+00', 'draft',
   true, NULL, false, NULL, NULL),
  ('14200000-0000-0000-0000-000000000004', '14141414-1414-1414-1414-141414141414',
   '14100000-0000-0000-0000-000000000001', NULL,
   'Prywatna', 'Private one', '2030-07-01 15:00+00', '2030-07-01 16:00+00', 'published',
   true, NULL, true, NULL, NULL),
  -- sesje wydarzenia ze zwrotem: jedno miejsce + kolejka
  ('14200000-0000-0000-0000-000000000005', '14141414-1414-1414-1414-141414141414',
   '14100000-0000-0000-0000-000000000002', NULL,
   'Warsztat', 'Workshop', '2030-07-02 09:00+00', '2030-07-02 10:00+00', 'published',
   true, 1, false, NULL, NULL),
  ('14200000-0000-0000-0000-000000000006', '14141414-1414-1414-1414-141414141414',
   '14100000-0000-0000-0000-000000000003', NULL,
   'Panel NY', 'NY panel', '2030-07-03 09:00+00', '2030-07-03 10:00+00', 'published',
   true, NULL, false, NULL, NULL);

INSERT INTO public.event_session_signups (tenant_id, event_id, session_id, user_id, status, registered_at) VALUES
  ('14141414-1414-1414-1414-141414141414', '14100000-0000-0000-0000-000000000001',
   '14200000-0000-0000-0000-000000000001', '14000000-0000-0000-0000-000000000001', 'registered', now()),
  ('14141414-1414-1414-1414-141414141414', '14100000-0000-0000-0000-000000000001',
   '14200000-0000-0000-0000-000000000002', '14000000-0000-0000-0000-000000000001', 'registered', now()),
  ('14141414-1414-1414-1414-141414141414', '14100000-0000-0000-0000-000000000001',
   '14200000-0000-0000-0000-000000000003', '14000000-0000-0000-0000-000000000001', 'registered', now()),
  ('14141414-1414-1414-1414-141414141414', '14100000-0000-0000-0000-000000000001',
   '14200000-0000-0000-0000-000000000004', '14000000-0000-0000-0000-000000000001', 'waitlist', now()),
  -- cudzy zapis: nie moze trafic do cudzej agendy
  ('14141414-1414-1414-1414-141414141414', '14100000-0000-0000-0000-000000000001',
   '14200000-0000-0000-0000-000000000001', '14000000-0000-0000-0000-000000000002', 'registered', now()),
  ('14141414-1414-1414-1414-141414141414', '14100000-0000-0000-0000-000000000003',
   '14200000-0000-0000-0000-000000000006', '14000000-0000-0000-0000-000000000001', 'registered', now());

-- ---------------------------------------------------------------------------
-- 1. event_my_agenda
-- ---------------------------------------------------------------------------
SELECT set_config('nes.public_tenant', '14141414-1414-1414-1414-141414141414', false);
SELECT pg_temp.act_as('14000000-0000-0000-0000-000000000001', '14141414-1414-1414-1414-141414141414');

DO $$
DECLARE
  v jsonb;
  s jsonb;
BEGIN
  v := public.event_my_agenda('{"slug":"d0-agenda"}'::jsonb)->'sessions';

  SELECT e INTO s FROM jsonb_array_elements(v) e
   WHERE e->>'session_id' = '14200000-0000-0000-0000-000000000001';
  PERFORM pg_temp.assert(
    s->>'room_name' = 'Sala Kopernika' AND s->>'room_floor' = '2'
    AND s->>'room_name_pl' = 'Sala Kopernika' AND s->>'room_name_en' = 'Sala Kopernika',
    '14/agenda: PF-F ZMIANA agenda-room-name - event_my_agenda zwraca event_rooms.name/floor (zgodnosc room_name_pl/en)');

  PERFORM pg_temp.assert(
    NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v) e WHERE e ? 'stream_url'),
    '14/agenda: PF-F ZMIANA agenda-no-stream-url - zaden wiersz nie ma klucza stream_url');

  SELECT e INTO s FROM jsonb_array_elements(v) e
   WHERE e->>'session_id' = '14200000-0000-0000-0000-000000000002';
  PERFORM pg_temp.assert(
    s->>'session_status' = 'cancelled' AND s->>'cancelled_at' IS NOT NULL
    AND (SELECT e->>'session_status' FROM jsonb_array_elements(v) e
          WHERE e->>'session_id' = '14200000-0000-0000-0000-000000000001') = 'published',
    '14/agenda: PF-F ZMIANA agenda-session-status - odwolana sesja oznaczona (session_status, cancelled_at), opublikowana published');

  PERFORM pg_temp.assert(
    jsonb_array_length(v) = 3
    AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v) e
                     WHERE e->>'session_id' = '14200000-0000-0000-0000-000000000003')
    AND EXISTS (SELECT 1 FROM jsonb_array_elements(v) e
                 WHERE e->>'session_id' = '14200000-0000-0000-0000-000000000004'
                   AND e->>'signup_status' = 'waitlist'),
    '14/agenda: PF-F ZMIANA agenda-visibility-filter - szkic ukryty, prywatna z zapisem widoczna, 3 wiersze');

  PERFORM pg_temp.assert(
    NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v) e WHERE e->>'timezone' IS DISTINCT FROM 'Europe/Warsaw')
    AND (SELECT e->>'timezone' FROM jsonb_array_elements(
           public.event_my_agenda('{"slug":"d0-ny"}'::jsonb)->'sessions') e) = 'America/New_York',
    '14/agenda: PF-F ZMIANA agenda-timezone - bledna strefa -> Europe/Warsaw, poprawna zachowana');

  PERFORM pg_temp.assert(
    public.event_my_agenda('{"slug":"nie-ma"}'::jsonb) = '{"sessions":[]}'::jsonb,
    '14/agenda: nieznany slug -> pusta lista');
END $$;

SELECT pg_temp.assert_raises_like($$SELECT public.event_my_agenda('{}'::jsonb)$$,
  'invalid_slug', '14/agenda: event_my_agenda bez slug -> invalid_slug');

-- inny uzytkownik widzi WYLACZNIE swoj zapis (kontrapunkt izolacji)
SELECT pg_temp.act_as('14000000-0000-0000-0000-000000000002', '14141414-1414-1414-1414-141414141414');
SELECT pg_temp.assert(
  jsonb_array_length(public.event_my_agenda('{"slug":"d0-agenda"}'::jsonb)->'sessions') = 1,
  '14/agenda: drugi uzytkownik widzi tylko swoja sesje');

SELECT pg_temp.act_as(NULL, NULL);
SELECT pg_temp.assert_raises_like($$SELECT public.event_my_agenda('{"slug":"d0-agenda"}'::jsonb)$$,
  'auth_required', '14/agenda: anonim -> auth_required');

-- Straznik `invalid_tenant`: w harnessie public_tenant_id() ma wartosc
-- domyslna, wiec na chwile (w punkcie zapisu) podstawiamy funkcje zwracajaca
-- NULL - dokladnie stan produkcji bez rozpoznanego hosta.
SAVEPOINT t14_no_tenant;
CREATE OR REPLACE FUNCTION public.public_tenant_id() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULL::uuid $$;
SELECT pg_temp.act_as('14000000-0000-0000-0000-000000000001', NULL);
SELECT pg_temp.assert_raises_like($$SELECT public.event_my_agenda('{"slug":"d0-agenda"}'::jsonb)$$,
  'invalid_tenant', '14/agenda: host bez najemcy -> invalid_tenant');
ROLLBACK TO SAVEPOINT t14_no_tenant;
SELECT pg_temp.act_as(NULL, NULL);

SELECT pg_temp.assert(
  obj_description('public.event_my_agenda(jsonb)'::regprocedure, 'pg_proc') LIKE '%D0-4%',
  '14/agenda: PF-F ZMIANA agenda-comment - komentarz funkcji opisuje D0-4');

-- ---------------------------------------------------------------------------
-- 2. payments_apply_event_ticket_outcome - pelny zwrot
-- ---------------------------------------------------------------------------
INSERT INTO public.event_ticket_types
  (id, tenant_id, event_id, key, name_pl, name_en, price_cents, currency, quota, is_active, sort_order)
VALUES
  ('14700000-0000-0000-0000-000000000001', '14141414-1414-1414-1414-141414141414',
   '14100000-0000-0000-0000-000000000002', 'std', 'Standard', 'Standard', 10000, 'PLN', NULL, true, 10);

INSERT INTO public.event_people (id, tenant_id, user_id, email, first_name, last_name) VALUES
  ('14300000-0000-0000-0000-000000000003', '14141414-1414-1414-1414-141414141414',
   '14000000-0000-0000-0000-000000000003', 'buyer.14@example.org', 'Bogna', 'Kupujaca'),
  ('14300000-0000-0000-0000-000000000005', '14141414-1414-1414-1414-141414141414',
   '14000000-0000-0000-0000-000000000005', 'lead.14@example.org', 'Lech', 'Prowadzacy'),
  ('14300000-0000-0000-0000-000000000006', '14141414-1414-1414-1414-141414141414',
   '14000000-0000-0000-0000-000000000006', 'guest.14@example.org', 'Gaba', 'Gosc'),
  ('14300000-0000-0000-0000-000000000008', '14141414-1414-1414-1414-141414141414',
   NULL, 'guest.noacc.14@example.org', 'Nina', 'Bezkonta'),
  ('14300000-0000-0000-0000-000000000007', '14141414-1414-1414-1414-141414141414',
   '14000000-0000-0000-0000-000000000007', 'partial.14@example.org', 'Pola', 'Czesciowa');

INSERT INTO public.payment_orders (id, tenant_id, user_id, status, amount_cents, currency, metadata) VALUES
  ('14400000-0000-0000-0000-000000000001', '14141414-1414-1414-1414-141414141414',
   '14000000-0000-0000-0000-000000000003', 'paid', 10000, 'PLN',
   '{"event_id":"14100000-0000-0000-0000-000000000002","ticket_type_id":"14700000-0000-0000-0000-000000000001","registration_id":"14500000-0000-0000-0000-000000000001"}'),
  ('14400000-0000-0000-0000-000000000002', '14141414-1414-1414-1414-141414141414',
   '14000000-0000-0000-0000-000000000005', 'paid', 30000, 'PLN',
   '{"event_id":"14100000-0000-0000-0000-000000000002","ticket_type_id":"14700000-0000-0000-0000-000000000001","registration_id":"14500000-0000-0000-0000-000000000005"}'),
  ('14400000-0000-0000-0000-000000000003', '14141414-1414-1414-1414-141414141414',
   '14000000-0000-0000-0000-000000000007', 'paid', 10000, 'PLN',
   '{"event_id":"14100000-0000-0000-0000-000000000002","ticket_type_id":"14700000-0000-0000-0000-000000000001","registration_id":"14500000-0000-0000-0000-000000000007"}');

INSERT INTO public.event_registrations
  (id, tenant_id, event_id, person_id, ticket_type_id, status, registration_mode, payment_status,
   payment_order_id, paid_at, qr_token_hash, qr_issued_at, decided_at, decision_source)
VALUES
  ('14500000-0000-0000-0000-000000000001', '14141414-1414-1414-1414-141414141414',
   '14100000-0000-0000-0000-000000000002', '14300000-0000-0000-0000-000000000003',
   '14700000-0000-0000-0000-000000000001', 'approved', 'form', 'paid',
   '14400000-0000-0000-0000-000000000001', now(), repeat('a', 64), now(), now(), 'system'),
  ('14500000-0000-0000-0000-000000000007', '14141414-1414-1414-1414-141414141414',
   '14100000-0000-0000-0000-000000000002', '14300000-0000-0000-0000-000000000007',
   '14700000-0000-0000-0000-000000000001', 'approved', 'form', 'paid',
   '14400000-0000-0000-0000-000000000003', now(), repeat('b', 64), now(), now(), 'system');

-- prowadzacy grupy (nieoplacony) i dwoch gosci: z kontem i bez
INSERT INTO public.event_registrations
  (id, tenant_id, event_id, person_id, ticket_type_id, status, registration_mode, payment_status)
VALUES
  ('14500000-0000-0000-0000-000000000005', '14141414-1414-1414-1414-141414141414',
   '14100000-0000-0000-0000-000000000002', '14300000-0000-0000-0000-000000000005',
   '14700000-0000-0000-0000-000000000001', 'pending', 'form', 'unpaid');
INSERT INTO public.event_registrations
  (id, tenant_id, event_id, person_id, ticket_type_id, status, registration_mode, payment_status,
   group_lead_registration_id)
VALUES
  ('14500000-0000-0000-0000-000000000006', '14141414-1414-1414-1414-141414141414',
   '14100000-0000-0000-0000-000000000002', '14300000-0000-0000-0000-000000000006',
   '14700000-0000-0000-0000-000000000001', 'pending', 'form', 'unpaid',
   '14500000-0000-0000-0000-000000000005'),
  ('14500000-0000-0000-0000-000000000008', '14141414-1414-1414-1414-141414141414',
   '14100000-0000-0000-0000-000000000002', '14300000-0000-0000-0000-000000000008',
   '14700000-0000-0000-0000-000000000001', 'pending', 'form', 'unpaid',
   '14500000-0000-0000-0000-000000000005');

-- stan osobisty do zwolnienia: kupujacy i gosc z kontem
INSERT INTO public.event_session_signups (tenant_id, event_id, session_id, user_id, status, registered_at) VALUES
  ('14141414-1414-1414-1414-141414141414', '14100000-0000-0000-0000-000000000002',
   '14200000-0000-0000-0000-000000000005', '14000000-0000-0000-0000-000000000003', 'registered', now() - interval '3 hours'),
  ('14141414-1414-1414-1414-141414141414', '14100000-0000-0000-0000-000000000002',
   '14200000-0000-0000-0000-000000000005', '14000000-0000-0000-0000-000000000004', 'waitlist', now() - interval '2 hours'),
  ('14141414-1414-1414-1414-141414141414', '14100000-0000-0000-0000-000000000002',
   '14200000-0000-0000-0000-000000000005', '14000000-0000-0000-0000-000000000006', 'waitlist', now() - interval '1 hour');
INSERT INTO public.event_session_saves (tenant_id, event_id, session_id, user_id) VALUES
  ('14141414-1414-1414-1414-141414141414', '14100000-0000-0000-0000-000000000002',
   '14200000-0000-0000-0000-000000000005', '14000000-0000-0000-0000-000000000003'),
  ('14141414-1414-1414-1414-141414141414', '14100000-0000-0000-0000-000000000002',
   '14200000-0000-0000-0000-000000000005', '14000000-0000-0000-0000-000000000006');
INSERT INTO public.event_rsvps (tenant_id, event_id, user_id, status) VALUES
  ('14141414-1414-1414-1414-141414141414', '14100000-0000-0000-0000-000000000002',
   '14000000-0000-0000-0000-000000000003', 'going'),
  ('14141414-1414-1414-1414-141414141414', '14100000-0000-0000-0000-000000000002',
   '14000000-0000-0000-0000-000000000006', 'going');

DO $$
DECLARE v jsonb;
BEGIN
  v := public.payments_apply_event_ticket_outcome('14400000-0000-0000-0000-000000000001', 'refunded', NULL);
  PERFORM pg_temp.assert((v->>'applied')::boolean AND v->>'outcome' = 'refunded',
    '14/zwrot: payments_apply_event_ticket_outcome(refunded) zaksiegowany');
END $$;

SELECT pg_temp.assert(
  (SELECT status = 'cancelled' AND payment_status = 'refunded'
          AND qr_token_hash IS NULL AND qr_issued_at IS NULL
     FROM public.event_registrations WHERE id = '14500000-0000-0000-0000-000000000001'),
  '14/zwrot: PF-F ZMIANA refund-clears-qr - pelny zwrot odwoluje zgloszenie i czysci qr_token_hash/qr_issued_at');

SELECT pg_temp.assert(
  (SELECT status FROM public.event_session_signups
    WHERE session_id = '14200000-0000-0000-0000-000000000005'
      AND user_id = '14000000-0000-0000-0000-000000000003') = 'cancelled'
  AND (SELECT status FROM public.event_session_signups
    WHERE session_id = '14200000-0000-0000-0000-000000000005'
      AND user_id = '14000000-0000-0000-0000-000000000004') = 'registered'
  AND NOT EXISTS (SELECT 1 FROM public.event_session_saves
    WHERE user_id = '14000000-0000-0000-0000-000000000003')
  AND (SELECT status FROM public.event_rsvps
    WHERE user_id = '14000000-0000-0000-0000-000000000003') = 'cancelled',
  '14/zwrot: PF-F ZMIANA refund-releases-participant - zapis odwolany, kolejka awansuje, zakladka i RSVP zwolnione');

-- kontrapunkt: zwrot CZESCIOWY zachowuje miejsce i kod wejscia
SELECT pg_temp.assert(
  (public.payments_apply_event_ticket_outcome('14400000-0000-0000-0000-000000000003', 'partial_refund', 2000)->>'outcome')
    = 'partial_refund',
  '14/zwrot: zwrot czesciowy zaksiegowany jako partial_refund');
SELECT pg_temp.assert(
  (SELECT status = 'approved' AND payment_status = 'partially_refunded' AND qr_token_hash = repeat('b', 64)
     FROM public.event_registrations WHERE id = '14500000-0000-0000-0000-000000000007'),
  '14/zwrot: zwrot czesciowy zachowuje status i kod QR (kontrapunkt)');

SELECT pg_temp.assert_raises_like(
  $$SELECT public.payments_apply_event_ticket_outcome('14400000-0000-0000-0000-000000000001', 'bogus', NULL)$$,
  'invalid_outcome', '14/zwrot: nieznany wynik -> invalid_outcome');

SELECT pg_temp.assert(
  (SELECT 'search_path=public, extensions, pg_temp' = ANY (p.proconfig)
     FROM pg_proc p WHERE p.oid = 'public.payments_apply_event_ticket_outcome(uuid,text,integer)'::regprocedure),
  '14/zwrot: PF-F ZMIANA payments-search-path - search_path z pg_temp');
SELECT pg_temp.assert(
  obj_description('public.payments_apply_event_ticket_outcome(uuid,text,integer)'::regprocedure, 'pg_proc') LIKE '%D0-2%'
  AND NOT has_function_privilege('authenticated', 'public.payments_apply_event_ticket_outcome(uuid,text,integer)', 'EXECUTE')
  AND has_function_privilege('service_role', 'public.payments_apply_event_ticket_outcome(uuid,text,integer)', 'EXECUTE'),
  '14/zwrot: PF-F ZMIANA payments-comment - komentarz D0-2; ACL bez zmian (service_role)');

-- ---------------------------------------------------------------------------
-- 3. Kaskada grupy: wplata, potem pelny zwrot prowadzacego
-- ---------------------------------------------------------------------------
DO $$
DECLARE v jsonb;
BEGIN
  v := public.payments_apply_event_ticket_outcome('14400000-0000-0000-0000-000000000002', 'paid', NULL);
  PERFORM pg_temp.assert((v->>'applied')::boolean
      AND (SELECT count(*) FROM public.event_registrations
            WHERE group_lead_registration_id = '14500000-0000-0000-0000-000000000005'
              AND status = 'approved' AND payment_status = 'paid' AND qr_token_hash IS NOT NULL) = 2,
    '14/grupa: _event_apply_outcome_to_group(paid) - goscie oplaceni z kodami QR');

  v := public.payments_apply_event_ticket_outcome('14400000-0000-0000-0000-000000000002', 'refunded', NULL);
  PERFORM pg_temp.assert((v->>'applied')::boolean, '14/grupa: zwrot prowadzacego zaksiegowany');
END $$;

SELECT pg_temp.assert(
  (SELECT count(*) FROM public.event_registrations
    WHERE group_lead_registration_id = '14500000-0000-0000-0000-000000000005'
      AND status = 'cancelled' AND payment_status = 'refunded'
      AND qr_token_hash IS NULL AND qr_issued_at IS NULL) = 2
  AND (SELECT qr_token_hash IS NULL FROM public.event_registrations
        WHERE id = '14500000-0000-0000-0000-000000000005'),
  '14/grupa: PF-F ZMIANA group-refund-clears-qr - zwrot czysci kody QR prowadzacego i obu gosci');

SELECT pg_temp.assert(
  (SELECT status FROM public.event_session_signups
    WHERE session_id = '14200000-0000-0000-0000-000000000005'
      AND user_id = '14000000-0000-0000-0000-000000000006') = 'cancelled'
  AND NOT EXISTS (SELECT 1 FROM public.event_session_saves
    WHERE user_id = '14000000-0000-0000-0000-000000000006')
  AND (SELECT status FROM public.event_rsvps
    WHERE user_id = '14000000-0000-0000-0000-000000000006') = 'cancelled'
  AND (SELECT status FROM public.event_session_signups
    WHERE session_id = '14200000-0000-0000-0000-000000000005'
      AND user_id = '14000000-0000-0000-0000-000000000004') = 'registered',
  '14/grupa: PF-F ZMIANA group-refund-releases-guests - gosc z kontem traci zapis, zakladke i RSVP; gosc bez konta bez bledu');

SELECT pg_temp.assert(
  has_function_privilege('service_role', 'public._event_apply_outcome_to_group(uuid,uuid,text)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public._event_apply_outcome_to_group(uuid,uuid,text)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public._event_apply_outcome_to_group(uuid,uuid,text)', 'EXECUTE'),
  '14/grupa: PF-F ZMIANA group-grant-service-role - jawny GRANT dla service_role, bez anon/authenticated');
SELECT pg_temp.assert(
  obj_description('public._event_apply_outcome_to_group(uuid,uuid,text)'::regprocedure, 'pg_proc') LIKE '%D0-2%',
  '14/grupa: PF-F ZMIANA group-comment - komentarz funkcji opisuje D0-2');

-- zwrot czesciowy i powrot do nieoplaconego dla grupy (galezie bez zmian).
-- Wywolanie i odczyt w OSOBNYCH instrukcjach: podzapytanie w tym samym
-- wyrazeniu widzi migawke sprzed wywolania funkcji.
DO $$
DECLARE n integer;
BEGIN
  n := public._event_apply_outcome_to_group('14500000-0000-0000-0000-000000000005',
    '14400000-0000-0000-0000-000000000002', 'partial_refund');
  PERFORM pg_temp.assert(n = 2
    AND (SELECT count(*) FROM public.event_registrations
          WHERE group_lead_registration_id = '14500000-0000-0000-0000-000000000005'
            AND payment_status = 'partially_refunded') = 2,
    '14/grupa: _event_apply_outcome_to_group(partial_refund) - goscie partially_refunded');
  n := public._event_apply_outcome_to_group('14500000-0000-0000-0000-000000000005',
    '14400000-0000-0000-0000-000000000002', 'unpaid');
  PERFORM pg_temp.assert(n = 2
    AND (SELECT count(*) FROM public.event_registrations
          WHERE group_lead_registration_id = '14500000-0000-0000-0000-000000000005'
            AND payment_status = 'unpaid') = 2,
    '14/grupa: _event_apply_outcome_to_group(unpaid) - goscie unpaid');
  n := public._event_apply_outcome_to_group('14500000-0000-0000-0000-000000000005',
    '14400000-0000-0000-0000-000000000002', 'paid');
  PERFORM pg_temp.assert(n = 0,
    '14/grupa: _event_apply_outcome_to_group(paid) pomija odwolanych gosci');
END $$;

SELECT set_config('nes.public_tenant', '', false);
ROLLBACK;
