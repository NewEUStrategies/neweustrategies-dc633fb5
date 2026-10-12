-- ============================================================================
-- 61 PRZYPIECIE SPOTKANIA DO SPONSORA (OPS-10)
--
-- Migracja `20261012120100_event_meeting_sponsor_binding`. Defekt:
-- `event_meeting_invite` zapisywal `sponsor_id` wprost z ladunku, a raport
-- sponsora liczy spotkania po tej kolumnie - dwa konta uczestnikow
-- przypinaly spotkania dowolnemu sponsorowi. Plik sprawdza:
--   * helper `_event_meeting_sponsor_allowed` (macierz: firma sponsora po
--     stronie zapraszajacego / zaproszonego, osoba kontaktowa sponsora przez
--     most CRM, sponsor innego wydarzenia, obcy najemca);
--   * KRYTERIUM AUDYTU: zaproszenie z obcym sponsorem powstaje BEZ
--     przypiecia (NULL), a odpowiedz mowi to wprost (`sponsor_id: null`);
--   * prawomocne przypiecia przechodza;
--   * organizator (`admin_event_meeting_arrange`) zostaje zaufany, a
--     przelozenie (`event_meeting_reschedule`) kopiuje jego przypiecie;
--   * granty helpera.
--
-- CZEGO NIE SPRAWDZA: regul gieldy (widocznosc, limity) - 60_meetings i
-- testy RPC; liczb raportu sponsora (funkcje raportu ma inny strumien) -
-- licznik spotkan sponsora sprawdzamy wprost na `event_meetings`, z ktorej
-- raport go liczy.
--
-- SPRZATANIE: jedna transakcja zakonczona ROLLBACK-iem.
-- ============================================================================

\echo '== 61 przypiecie spotkania do sponsora =='

BEGIN;

-- ---------------------------------------------------------------------------
-- SEKCJA 1: SCENOGRAFIA
-- Najemca A = publiczny najemca harnessu. E1 (gielda wlaczona, UTC, sloty 30
-- min) i E2 (inne wydarzenie tego najemcy). Sponsorzy E1: S1 (firma C1),
-- S2 (firma C2); SX - sponsor E2 z TA SAMA firma C1.
-- Uczestnicy E1: P1, P2 (bez powiazan), P3 (pracuje w C1), P4 (osoba
-- kontaktowa S1 przez most CRM, bez firmy).
-- ---------------------------------------------------------------------------
INSERT INTO public.tenants (id, name, slug)
VALUES ('61000000-0000-0000-0000-0000000000b0', 'Tenant B (przypiecie spotkan)', 'tb-msb');

INSERT INTO auth.users (id, email) VALUES
  ('61a00000-0000-0000-0000-000000000001', 'msb.p1@example.org'),
  ('61a00000-0000-0000-0000-000000000002', 'msb.p2@example.org'),
  ('61a00000-0000-0000-0000-000000000003', 'msb.p3@example.org'),
  ('61a00000-0000-0000-0000-000000000004', 'msb.p4@example.org'),
  ('61a00000-0000-0000-0000-0000000000ad', 'msb.admin@example.org');

INSERT INTO public.user_roles (user_id, role) VALUES
  ('61a00000-0000-0000-0000-0000000000ad', 'admin');
INSERT INTO public.profiles (id, tenant_id) VALUES
  ('61a00000-0000-0000-0000-0000000000ad', '11111111-1111-1111-1111-111111111111');

INSERT INTO public.events
  (id, tenant_id, slug, title_pl, title_en, starts_at, status, registration_mode, registration_flow)
VALUES
  ('61e00000-0000-0000-0000-0000000000e1', '11111111-1111-1111-1111-111111111111',
   'msb-gielda', 'Gielda sponsorow', 'Sponsor exchange',
   now() + interval '3 days', 'published', 'rsvp', 'instant'),
  ('61e00000-0000-0000-0000-0000000000e2', '11111111-1111-1111-1111-111111111111',
   'msb-inne', 'Inne wydarzenie', 'Other event',
   now() + interval '9 days', 'published', 'rsvp', 'instant');

-- Grupe domyslna zaklada wyzwalacz wydarzenia; gielda wymaga, zeby mogla sie spotykac.
UPDATE public.event_groups g SET can_meet = true
 WHERE g.event_id = '61e00000-0000-0000-0000-0000000000e1' AND g.is_default;
SELECT pg_temp.assert(
  (SELECT count(*) FROM public.event_groups g
    WHERE g.event_id = '61e00000-0000-0000-0000-0000000000e1' AND g.is_default AND g.can_meet) = 1,
  '61/scenografia: grupa domyslna wydarzenia moze umawiac spotkania');

INSERT INTO public.event_meeting_settings
  (tenant_id, event_id, is_enabled, slot_minutes, break_minutes,
   day_start_time, day_end_time, meeting_days, timezone)
VALUES ('11111111-1111-1111-1111-111111111111', '61e00000-0000-0000-0000-0000000000e1',
        true, 30, 0, '09:00', '17:00', ARRAY[(current_date + 3)]::date[], 'UTC');

INSERT INTO public.crm_companies (id, tenant_id, name) VALUES
  ('61c00000-0000-0000-0000-0000000000c1', '11111111-1111-1111-1111-111111111111', 'Alfa 61'),
  ('61c00000-0000-0000-0000-0000000000c2', '11111111-1111-1111-1111-111111111111', 'Beta 61')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.event_sponsors
  (id, tenant_id, event_id, company_id, role, is_published, snapshot_name)
VALUES
  ('61500000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   '61e00000-0000-0000-0000-0000000000e1', '61c00000-0000-0000-0000-0000000000c1',
   'partner', true, 'Alfa'),
  ('61500000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111',
   '61e00000-0000-0000-0000-0000000000e1', '61c00000-0000-0000-0000-0000000000c2',
   'partner', true, 'Beta'),
  ('61500000-0000-0000-0000-0000000000e2', '11111111-1111-1111-1111-111111111111',
   '61e00000-0000-0000-0000-0000000000e2', '61c00000-0000-0000-0000-0000000000c1',
   'partner', true, 'Alfa (inne wydarzenie)');

INSERT INTO public.event_people
  (id, tenant_id, first_name, last_name, email, source, user_id, company_id)
VALUES
  ('61800000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   'Piotr', 'Pierwszy', 'msb.p1@example.org', 'organizer', '61a00000-0000-0000-0000-000000000001', NULL),
  ('61800000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111',
   'Pola', 'Druga', 'msb.p2@example.org', 'organizer', '61a00000-0000-0000-0000-000000000002', NULL),
  ('61800000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111',
   'Pawel', 'Trzeci', 'msb.p3@example.org', 'organizer', '61a00000-0000-0000-0000-000000000003',
   '61c00000-0000-0000-0000-0000000000c1'),
  ('61800000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111',
   'Paula', 'Czwarta', 'msb.p4@example.org', 'organizer', '61a00000-0000-0000-0000-000000000004', NULL);

INSERT INTO public.event_registrations
  (id, tenant_id, event_id, person_id, status, registration_mode)
VALUES
  ('61900000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   '61e00000-0000-0000-0000-0000000000e1', '61800000-0000-0000-0000-000000000001', 'approved', 'rsvp'),
  ('61900000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111',
   '61e00000-0000-0000-0000-0000000000e1', '61800000-0000-0000-0000-000000000002', 'approved', 'rsvp'),
  ('61900000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111',
   '61e00000-0000-0000-0000-0000000000e1', '61800000-0000-0000-0000-000000000003', 'approved', 'rsvp'),
  ('61900000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111',
   '61e00000-0000-0000-0000-0000000000e1', '61800000-0000-0000-0000-000000000004', 'approved', 'rsvp');

-- P4 jest osoba kontaktowa S1: kontakt CRM L4 przy przypieciu S1 i most osoba -> L4.
INSERT INTO public.crm_leads (id, tenant_id, email, email_norm, source_type, tags) VALUES
  ('61100000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111',
   'msb.p4@example.org', 'msb.p4@example.org', 'manual', '{}');
INSERT INTO public.event_sponsor_contacts (tenant_id, event_id, sponsor_id, lead_id, role) VALUES
  ('11111111-1111-1111-1111-111111111111', '61e00000-0000-0000-0000-0000000000e1',
   '61500000-0000-0000-0000-000000000001', '61100000-0000-0000-0000-000000000004', 'onsite');
INSERT INTO public.event_person_crm_links (tenant_id, person_id, crm_lead_id, sync_status) VALUES
  ('11111111-1111-1111-1111-111111111111', '61800000-0000-0000-0000-000000000004',
   '61100000-0000-0000-0000-000000000004', 'ok');

-- Okna dostepnosci 09:00-17:00 dla calej czworki.
INSERT INTO public.event_meeting_availability
  (tenant_id, event_id, registration_id, starts_at, ends_at, is_open)
SELECT '11111111-1111-1111-1111-111111111111', '61e00000-0000-0000-0000-0000000000e1', r.id,
       ((current_date + 3) + time '09:00') AT TIME ZONE 'UTC',
       ((current_date + 3) + time '17:00') AT TIME ZONE 'UTC', true
  FROM public.event_registrations r
 WHERE r.event_id = '61e00000-0000-0000-0000-0000000000e1';

-- Slot n (0..15) siatki: 09:00 + n * 30 min.
CREATE FUNCTION pg_temp.msb_slot(_n integer) RETURNS timestamptz LANGUAGE sql AS $$
  SELECT (((current_date + 3) + time '09:00') AT TIME ZONE 'UTC') + make_interval(mins => 30 * _n)
$$;

-- Zaproszenie jako uczestnik (`_who` = numer osoby 1..4) do osoby `_to`.
CREATE FUNCTION pg_temp.msb_invite(_who integer, _to integer, _slot integer, _sponsor text)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  v_res jsonb;
BEGIN
  PERFORM pg_temp.act_as(('61a00000-0000-0000-0000-00000000000' || _who)::uuid,
                         '11111111-1111-1111-1111-111111111111');
  v_res := public.event_meeting_invite(jsonb_strip_nulls(jsonb_build_object(
    'event_slug', 'msb-gielda',
    'counterpart_registration_id', '61900000-0000-0000-0000-00000000000' || _to,
    'starts_at', pg_temp.msb_slot(_slot),
    'sponsor_id', _sponsor)));
  PERFORM pg_temp.act_as();
  RETURN v_res;
END $$;

CREATE FUNCTION pg_temp.msb_sponsor_of(_meeting jsonb) RETURNS uuid LANGUAGE sql AS $$
  SELECT m.sponsor_id FROM public.event_meetings m WHERE m.id = (_meeting->>'meeting_id')::uuid
$$;

-- ---------------------------------------------------------------------------
-- SEKCJA 2: HELPER - KTO JEST POWIAZANY ZE SPONSOREM
-- ---------------------------------------------------------------------------
DO $do$
DECLARE
  t constant uuid := '11111111-1111-1111-1111-111111111111';
  e1 constant uuid := '61e00000-0000-0000-0000-0000000000e1';
  s1 constant uuid := '61500000-0000-0000-0000-000000000001';
  s2 constant uuid := '61500000-0000-0000-0000-000000000002';
  sx constant uuid := '61500000-0000-0000-0000-0000000000e2';
  r1 constant uuid := '61900000-0000-0000-0000-000000000001';
  r2 constant uuid := '61900000-0000-0000-0000-000000000002';
  r3 constant uuid := '61900000-0000-0000-0000-000000000003';
  r4 constant uuid := '61900000-0000-0000-0000-000000000004';
BEGIN
  PERFORM pg_temp.assert(
    NOT public._event_meeting_sponsor_allowed(t, e1, s1, r1, r2),
    '61/helper: dwoje uczestnikow bez powiazania - sponsora NIE wolno przypiac');
  PERFORM pg_temp.assert(
    public._event_meeting_sponsor_allowed(t, e1, s1, r1, r3)
    AND public._event_meeting_sponsor_allowed(t, e1, s1, r3, r1),
    '61/helper: wolno, gdy zaproszony ALBO zapraszajacy pracuje w firmie sponsora');
  PERFORM pg_temp.assert(
    public._event_meeting_sponsor_allowed(t, e1, s1, r2, r4),
    '61/helper: wolno, gdy strona jest osoba kontaktowa sponsora (most CRM)');
  PERFORM pg_temp.assert(
    NOT public._event_meeting_sponsor_allowed(t, e1, s2, r3, r4),
    '61/helper: powiazanie z JEDNYM sponsorem nie daje prawa przypiac INNEGO');
  PERFORM pg_temp.assert(
    NOT public._event_meeting_sponsor_allowed(t, e1, sx, r3, r1),
    '61/helper: sponsor innego wydarzenia (nawet ta sama firma) - nie wolno');
  PERFORM pg_temp.assert(
    NOT public._event_meeting_sponsor_allowed('61000000-0000-0000-0000-0000000000b0', e1, s1, r3, r1),
    '61/helper/izolacja: obcy najemca - nie wolno');
  PERFORM pg_temp.assert(
    NOT public._event_meeting_sponsor_allowed(t, e1, NULL, r3, r1),
    '61/helper: brak sponsora - nie ma czego przypinac');

  -- Kontrapunkt mostu: kontakt CRM bez osoby wydarzenia nie wystarcza.
  UPDATE public.event_person_crm_links l SET crm_lead_id = NULL
   WHERE l.person_id = '61800000-0000-0000-0000-000000000004';
  PERFORM pg_temp.assert(
    NOT public._event_meeting_sponsor_allowed(t, e1, s1, r2, r4),
    '61/helper: osoba bez powiazanego kontaktu CRM nie jest osoba kontaktowa sponsora');
  UPDATE public.event_person_crm_links l SET crm_lead_id = '61100000-0000-0000-0000-000000000004'
   WHERE l.person_id = '61800000-0000-0000-0000-000000000004';
END
$do$;

-- ---------------------------------------------------------------------------
-- SEKCJA 3: ZAPROSZENIE UCZESTNIKA (KRYTERIUM AUDYTU)
-- ---------------------------------------------------------------------------
DO $do$
DECLARE
  s1 constant text := '61500000-0000-0000-0000-000000000001';
  s2 constant text := '61500000-0000-0000-0000-000000000002';
  sx constant text := '61500000-0000-0000-0000-0000000000e2';
  v_res jsonb;
BEGIN
  -- P1 -> P2 z OBCYM sponsorem S2: spotkanie powstaje, przypiecie NIE.
  v_res := pg_temp.msb_invite(1, 2, 0, s2);
  PERFORM pg_temp.assert(
    v_res->>'status' = 'invited' AND v_res ? 'sponsor_id' AND v_res->'sponsor_id' = 'null'::jsonb
    AND pg_temp.msb_sponsor_of(v_res) IS NULL,
    '61/AUDYT: zaproszenie z obcym sponsor_id powstaje BEZ przypiecia, odpowiedz mowi sponsor_id: null');

  -- P3 (firma S1) -> P1 z S2: powiazanie z S1 nie otwiera S2.
  v_res := pg_temp.msb_invite(3, 1, 1, s2);
  PERFORM pg_temp.assert(pg_temp.msb_sponsor_of(v_res) IS NULL,
    '61/AUDYT: pracownik S1 nie przypnie spotkania do S2');

  -- Sponsor INNEGO wydarzenia: dawniej blad klucza obcego, teraz brak przypiecia.
  v_res := pg_temp.msb_invite(1, 3, 2, sx);
  PERFORM pg_temp.assert(pg_temp.msb_sponsor_of(v_res) IS NULL AND v_res->>'status' = 'invited',
    '61/AUDYT: sponsor innego wydarzenia nie jest przypinany, spotkanie i tak powstaje');

  -- Prawomocne przypiecia.
  v_res := pg_temp.msb_invite(1, 3, 3, s1);
  PERFORM pg_temp.assert(pg_temp.msb_sponsor_of(v_res) = s1::uuid AND v_res->>'sponsor_id' = s1,
    '61/zaproszenie: zaproszony pracuje u sponsora - przypiecie zostaje');
  v_res := pg_temp.msb_invite(3, 2, 4, s1);
  PERFORM pg_temp.assert(pg_temp.msb_sponsor_of(v_res) = s1::uuid,
    '61/zaproszenie: zapraszajacy pracuje u sponsora - przypiecie zostaje');
  v_res := pg_temp.msb_invite(1, 4, 5, s1);
  PERFORM pg_temp.assert(pg_temp.msb_sponsor_of(v_res) = s1::uuid,
    '61/zaproszenie: zaproszony jest osoba kontaktowa sponsora - przypiecie zostaje');

  -- Bez sponsora w ladunku - bez zmian.
  v_res := pg_temp.msb_invite(2, 4, 6, NULL);
  PERFORM pg_temp.assert(v_res->'sponsor_id' = 'null'::jsonb AND pg_temp.msb_sponsor_of(v_res) IS NULL,
    '61/zaproszenie: zaproszenie bez sponsora dziala jak dotad');

  -- Licznik, z ktorego raport sponsora liczy spotkania.
  PERFORM pg_temp.assert(
    (SELECT count(*) FROM public.event_meetings m WHERE m.sponsor_id = s2::uuid) = 0
    AND (SELECT count(*) FROM public.event_meetings m WHERE m.sponsor_id = s1::uuid) = 3
    AND (SELECT count(*) FROM public.event_meetings m WHERE m.sponsor_id = sx::uuid) = 0,
    '61/AUDYT: raport S2 nie dostaje ani jednego podrobionego spotkania; S1 ma trzy prawomocne');
END
$do$;

SELECT pg_temp.act_as('61a00000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111');
SELECT pg_temp.assert_raises_like($q$SELECT public.event_meeting_invite(jsonb_build_object(
    'event_slug', 'msb-gielda',
    'counterpart_registration_id', '61900000-0000-0000-0000-000000000002',
    'starts_at', pg_temp.msb_slot(7),
    'sponsor_id', 'nie-uuid'))$q$,
  'invalid input syntax', '61/zaproszenie/ODMOWA: sponsor_id spoza ksztaltu uuid nadal odrzucany');
SELECT pg_temp.act_as();

-- ---------------------------------------------------------------------------
-- SEKCJA 4: ORGANIZATOR ZAUFANY, PRZELOZENIE KOPIUJE JEGO PRZYPIECIE
-- ---------------------------------------------------------------------------
SELECT pg_temp.act_as('61a00000-0000-0000-0000-0000000000ad', '11111111-1111-1111-1111-111111111111');
CREATE TEMP TABLE msb_q (k text PRIMARY KEY, u uuid) ON COMMIT DROP;
INSERT INTO msb_q (k, u)
SELECT 'arranged', (public.admin_event_meeting_arrange(jsonb_build_object(
  'event_id', '61e00000-0000-0000-0000-0000000000e1',
  'requester_registration_id', '61900000-0000-0000-0000-000000000001',
  'invitee_registration_id', '61900000-0000-0000-0000-000000000002',
  'starts_at', pg_temp.msb_slot(10),
  'sponsor_id', '61500000-0000-0000-0000-000000000002'))->>'meeting_id')::uuid;
SELECT pg_temp.act_as();
SELECT pg_temp.assert(
  (SELECT m.sponsor_id FROM public.event_meetings m WHERE m.id = (SELECT u FROM msb_q WHERE k = 'arranged'))
    = '61500000-0000-0000-0000-000000000002',
  '61/organizator: spotkanie umowione przez organizatora zachowuje dowolnego sponsora wydarzenia');

SELECT pg_temp.act_as('61a00000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111');
INSERT INTO msb_q (k, u)
SELECT 'moved', (public.event_meeting_reschedule(jsonb_build_object(
  'meeting_id', (SELECT u FROM msb_q WHERE k = 'arranged'),
  'starts_at', pg_temp.msb_slot(11)))->>'meeting_id')::uuid;
SELECT pg_temp.act_as();
SELECT pg_temp.assert(
  (SELECT m.sponsor_id FROM public.event_meetings m WHERE m.id = (SELECT u FROM msb_q WHERE k = 'moved'))
    = '61500000-0000-0000-0000-000000000002'
  AND (SELECT m.status FROM public.event_meetings m WHERE m.id = (SELECT u FROM msb_q WHERE k = 'arranged'))
    = 'rescheduled',
  '61/przelozenie: nowe spotkanie kopiuje przypiecie organizatora (z wiersza, nie z ladunku)');

-- ---------------------------------------------------------------------------
-- SEKCJA 5: GRANTY
-- ---------------------------------------------------------------------------
SELECT pg_temp.assert(
  NOT has_function_privilege('anon', 'public._event_meeting_sponsor_allowed(uuid, uuid, uuid, uuid, uuid)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public._event_meeting_sponsor_allowed(uuid, uuid, uuid, uuid, uuid)', 'EXECUTE')
  AND has_function_privilege('service_role', 'public._event_meeting_sponsor_allowed(uuid, uuid, uuid, uuid, uuid)', 'EXECUTE'),
  '61/granty: helper przypiecia wylacznie dla service_role');
SELECT pg_temp.assert(
  NOT has_function_privilege('anon', 'public.event_meeting_invite(jsonb)', 'EXECUTE')
  AND has_function_privilege('authenticated', 'public.event_meeting_invite(jsonb)', 'EXECUTE'),
  '61/granty: zaproszenie bez zmian - zalogowany tak, anonim nie');

ROLLBACK;

\echo '== 61 przypiecie spotkania do sponsora: koniec =='
