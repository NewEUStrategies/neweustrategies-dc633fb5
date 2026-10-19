-- pgTAP: zgłoszenia do klubów na szynie + synchronizacja CRM bez obniżania
-- segmentu i bez zawyżania licznika (migracja 20261020130500, hub S4).
--
-- Sprawdza:
--   * `club_application.submitted.v1` przy zgłoszeniu (aktor = kandydat,
--     payload bez PII) i `club_application.decided.v1` przy przyjęciu /
--     odrzuceniu (status w payloadzie), brak zdarzenia przy zmianie innej
--     kolumny i przy przejściu do `review`;
--   * klub tajny: ani zgłoszenie, ani decyzja nie emitują;
--   * D3: `paid_subscriber` zostaje po synchronizacji zgłoszenia, lead
--     z niższym segmentem dostaje `club_application`;
--   * D4: ponowiona synchronizacja tego samego zgłoszenia nie podbija
--     `club_application_count`, nowe zgłoszenie - tak;
--   * lustro rangi w ciele funkcji = `_crm_source_type_rank` >= 70;
--   * ACL.
--
-- Uruchamianie: PGTAP_DIR=... PGTAP_PORT=... bash scripts/pgtap-local/run.sh test club_application_events
BEGIN;
SELECT plan(15);

ALTER TABLE auth.users DISABLE TRIGGER USER;

INSERT INTO public.tenants (id, slug, name) VALUES
  ('d4600000-0000-0000-0000-0000000000a0', 'hub-s4-club-a', 'Hub S4 kluby A');

INSERT INTO auth.users (id, email) VALUES
  ('d4600000-0000-0000-0000-00000000a001', 'admin-a@hub-s4-club.test'),
  ('d4600000-0000-0000-0000-00000000a011', 'kandydat1@hub-s4-club.test'),
  ('d4600000-0000-0000-0000-00000000a012', 'kandydat2@hub-s4-club.test'),
  ('d4600000-0000-0000-0000-00000000a013', 'kandydat3@hub-s4-club.test');

INSERT INTO public.profiles (id, email, display_name, tenant_id) VALUES
  ('d4600000-0000-0000-0000-00000000a001', 'admin-a@hub-s4-club.test', 'Admin A', 'd4600000-0000-0000-0000-0000000000a0'),
  ('d4600000-0000-0000-0000-00000000a011', 'kandydat1@hub-s4-club.test', 'Kandydat 1', 'd4600000-0000-0000-0000-0000000000a0'),
  ('d4600000-0000-0000-0000-00000000a012', 'kandydat2@hub-s4-club.test', 'Kandydat 2', 'd4600000-0000-0000-0000-0000000000a0'),
  ('d4600000-0000-0000-0000-00000000a013', 'kandydat3@hub-s4-club.test', 'Kandydat 3', 'd4600000-0000-0000-0000-0000000000a0');

INSERT INTO public.user_roles (user_id, role, tenant_id) VALUES
  ('d4600000-0000-0000-0000-00000000a001', 'admin', 'd4600000-0000-0000-0000-0000000000a0');

INSERT INTO public.clubs (id, tenant_id, slug, name_pl, name_en, visibility, status) VALUES
  ('d4600000-0000-0000-0000-0000000002a1', 'd4600000-0000-0000-0000-0000000000a0', 'energia', 'Energia', 'Energy', 'members', 'active'),
  ('d4600000-0000-0000-0000-0000000002a2', 'd4600000-0000-0000-0000-0000000000a0', 'tajny', 'Tajny', 'Secret', 'secret', 'active');

-- Klient płacący (ranga 90) i kontakt z formularza (ranga 20).
UPDATE public.crm_leads SET source_type = 'paid_subscriber'
 WHERE tenant_id = 'd4600000-0000-0000-0000-0000000000a0' AND email_norm = 'kandydat1@hub-s4-club.test';
UPDATE public.crm_leads SET source_type = 'contact_form'
 WHERE tenant_id = 'd4600000-0000-0000-0000-0000000000a0' AND email_norm = 'kandydat2@hub-s4-club.test';

INSERT INTO public.club_applications (id, tenant_id, user_id, specialization_slug, club_id, first_name, email) VALUES
  ('d4600000-0000-0000-0000-0000000003a1', 'd4600000-0000-0000-0000-0000000000a0', 'd4600000-0000-0000-0000-00000000a011',
   'energia', 'd4600000-0000-0000-0000-0000000002a1', 'Kandydat', 'kandydat1@hub-s4-club.test'),
  ('d4600000-0000-0000-0000-0000000003a2', 'd4600000-0000-0000-0000-0000000000a0', 'd4600000-0000-0000-0000-00000000a012',
   'energia', 'd4600000-0000-0000-0000-0000000002a1', 'Kandydatka', 'kandydat2@hub-s4-club.test'),
  ('d4600000-0000-0000-0000-0000000003a3', 'd4600000-0000-0000-0000-0000000000a0', 'd4600000-0000-0000-0000-00000000a013',
   'tajne', 'd4600000-0000-0000-0000-0000000002a2', 'Kandydat', 'kandydat3@hub-s4-club.test');

CREATE FUNCTION pg_temp.evs(p_app uuid) RETURNS text LANGUAGE sql AS $$
  SELECT COALESCE(string_agg(event_type, ',' ORDER BY event_type), '')
    FROM public.domain_events
   WHERE aggregate_type = 'club_application' AND aggregate_id = p_app::text
$$;

-- ── 1. ACL ───────────────────────────────────────────────────────────────────
SELECT ok(
  NOT has_function_privilege('authenticated', 'public.club_application_crm_sync(uuid)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.club_application_crm_sync(uuid)', 'EXECUTE')
  AND has_function_privilege('service_role', 'public.club_application_crm_sync(uuid)', 'EXECUTE'),
  'acl: club_application_crm_sync wyłącznie dla service_role');
SELECT ok(
  NOT has_function_privilege('authenticated', 'public.tg_club_applications_emit()', 'EXECUTE'),
  'acl: emiter zgłoszeń bez EXECUTE dla authenticated');

-- ── 2. Zdarzenia ─────────────────────────────────────────────────────────────
SELECT is(
  (SELECT actor_id::text || '|' || (payload ->> 'club_id') || '|' || (payload ->> 'specialization')
     FROM public.domain_events
    WHERE event_type = 'club_application.submitted.v1'
      AND aggregate_id = 'd4600000-0000-0000-0000-0000000003a1'),
  'd4600000-0000-0000-0000-00000000a011|d4600000-0000-0000-0000-0000000002a1|energia',
  'submitted.v1: aktor = kandydat, klub i specjalizacja w payloadzie');
SELECT ok(
  (SELECT NOT (payload ? 'email') AND NOT (payload ? 'first_name') AND NOT (payload ? 'motivation')
     FROM public.domain_events
    WHERE event_type = 'club_application.submitted.v1'
      AND aggregate_id = 'd4600000-0000-0000-0000-0000000003a1'),
  'submitted.v1: payload bez PII kandydata');

UPDATE public.club_applications SET admin_note = 'notatka', status = 'review'
 WHERE id = 'd4600000-0000-0000-0000-0000000003a1';
SELECT is(pg_temp.evs('d4600000-0000-0000-0000-0000000003a1'), 'club_application.submitted.v1',
  'przejście do review i notatka nie emitują decyzji');

SELECT set_config('request.jwt.claims',
  json_build_object('sub', 'd4600000-0000-0000-0000-00000000a001', 'role', 'authenticated')::text, true);
UPDATE public.club_applications SET status = 'accepted', reviewed_at = now()
 WHERE id = 'd4600000-0000-0000-0000-0000000003a1';
UPDATE public.club_applications SET status = 'rejected', reviewed_at = now()
 WHERE id = 'd4600000-0000-0000-0000-0000000003a2';
SELECT set_config('request.jwt.claims', '', true);
SELECT is(
  (SELECT string_agg((payload ->> 'status') || '/' || COALESCE(actor_id::text, '-'), ',' ORDER BY payload ->> 'status')
     FROM public.domain_events
    WHERE event_type = 'club_application.decided.v1'
      AND aggregate_id IN ('d4600000-0000-0000-0000-0000000003a1', 'd4600000-0000-0000-0000-0000000003a2')),
  'accepted/d4600000-0000-0000-0000-00000000a001,rejected/d4600000-0000-0000-0000-00000000a001',
  'decided.v1: przyjęcie i odrzucenie, aktor = osoba decydująca z sesji');
UPDATE public.club_applications SET admin_note = 'po decyzji'
 WHERE id = 'd4600000-0000-0000-0000-0000000003a1';
SELECT is(
  (SELECT count(*)::int FROM public.domain_events
    WHERE event_type = 'club_application.decided.v1'
      AND aggregate_id = 'd4600000-0000-0000-0000-0000000003a1'),
  1, 'decided.v1: edycja po decyzji nie emituje drugi raz');

UPDATE public.club_applications SET status = 'accepted'
 WHERE id = 'd4600000-0000-0000-0000-0000000003a3';
SELECT is(pg_temp.evs('d4600000-0000-0000-0000-0000000003a3'), '',
  'klub tajny: ani zgłoszenie, ani decyzja nie trafiają na szynę');

-- ── 3. CRM: segment w górę rangi (D3) i licznik (D4) ────────────────────────
SELECT public.club_application_crm_sync('d4600000-0000-0000-0000-0000000003a1');
SELECT is(
  (SELECT source_type || '|' || club_application_count FROM public.crm_leads
    WHERE tenant_id = 'd4600000-0000-0000-0000-0000000000a0' AND email_norm = 'kandydat1@hub-s4-club.test'),
  'paid_subscriber|1', 'D3: klient płacący zostaje paid_subscriber po zgłoszeniu do klubu');

SELECT public.club_application_crm_sync('d4600000-0000-0000-0000-0000000003a2');
SELECT is(
  (SELECT source_type FROM public.crm_leads
    WHERE tenant_id = 'd4600000-0000-0000-0000-0000000000a0' AND email_norm = 'kandydat2@hub-s4-club.test'),
  'club_application', 'D3: niższy segment (formularz) rośnie do club_application');

-- Ponowiona synchronizacja tego samego zgłoszenia („Synchronizuj ponownie").
SELECT public.club_application_crm_sync('d4600000-0000-0000-0000-0000000003a1');
SELECT is(
  (SELECT club_application_count FROM public.crm_leads
    WHERE tenant_id = 'd4600000-0000-0000-0000-0000000000a0' AND email_norm = 'kandydat1@hub-s4-club.test'),
  1, 'D4: ponowiona synchronizacja nie zawyża licznika zgłoszeń');

-- Nowe zgłoszenie tej samej osoby (inna specjalizacja) = nowe zgłoszenie.
INSERT INTO public.club_applications (id, tenant_id, user_id, specialization_slug, club_id, first_name, email) VALUES
  ('d4600000-0000-0000-0000-0000000003a4', 'd4600000-0000-0000-0000-0000000000a0', 'd4600000-0000-0000-0000-00000000a011',
   'geopolityka', 'd4600000-0000-0000-0000-0000000002a1', 'Kandydat', 'kandydat1@hub-s4-club.test');
SELECT public.club_application_crm_sync('d4600000-0000-0000-0000-0000000003a4');
SELECT is(
  (SELECT club_application_count || '|' || array_to_string(ARRAY(SELECT unnest(club_specializations) ORDER BY 1), ',')
     FROM public.crm_leads
    WHERE tenant_id = 'd4600000-0000-0000-0000-0000000000a0' AND email_norm = 'kandydat1@hub-s4-club.test'),
  '2|energia,geopolityka', 'D4: drugie zgłoszenie liczy się raz, specjalizacje bez duplikatów');
SELECT is(
  (SELECT crm_sync_status FROM public.club_applications WHERE id = 'd4600000-0000-0000-0000-0000000003a4'),
  'ok', 'synchronizacja: status zgłoszenia ok');

-- ── 4. Lustro rangi = _crm_source_type_rank ─────────────────────────────────
-- Ciało funkcji wpisuje segmenty o randze >= 70 jawnie (atrapa pg-harness nie
-- ma funkcji rangi); zmiana rang bez zmiany tej listy ma wywrócić test.
SELECT is(
  (SELECT array_agg(t ORDER BY t) FROM unnest(ARRAY[
     'manual', 'contact_form', 'newsletter', 'registered', 'event_participant', 'event_cfp',
     'speaker', 'club_application', 'careers', 'expert', 'paid_subscriber'
   ]) t WHERE public._crm_source_type_rank(t) >= public._crm_source_type_rank('club_application')),
  ARRAY['careers', 'club_application', 'expert', 'paid_subscriber'],
  'lustro: segmenty o randze >= club_application zgodne z _crm_source_type_rank');
SELECT ok(
  (SELECT prosrc LIKE '%l.source_type IN (''club_application'', ''careers'', ''expert'', ''paid_subscriber'')%'
     FROM pg_proc WHERE oid = 'public.club_application_crm_sync(uuid)'::regprocedure),
  'lustro: ciało club_application_crm_sync ma tę samą listę segmentów');

SELECT * FROM finish();
ROLLBACK;
