-- ============================================================================
-- 15_crm_bridge_intents - MOST CRM: STAN PER INTENCJA I OS CZASU BEZ
-- DUPLIKATOW (migracja 20260927001400)
--
-- PO CO TEN PLIK ISTNIEJE
-- `_event_person_crm_sync` wolaja rozne intencje (nabor, przyjecie
-- prelegenta, odprawa, faktury, stoisko), a stan mostu to jeden wiersz na
-- osobe. Do 20260927001400 kazde wywolanie nadpisywalo go na slepo: blad
-- przyjecia prelegenta znikal pod pominieta odprawa, ponowienie powtarzalo
-- odprawe i kontakt prelegenta nie powstawal nigdy. Os czasu CRM dostawala
-- przy tym duplikaty (stoisko, odprawa, stoisko; odprawa, cofniecie
-- obecnosci, odprawa). 14_crm_bridge.sql testuje pojedyncze wywolania - ten
-- plik testuje ich SEKWENCJE.
--
-- CZEGO TU DOWODZIMY
--   (a) blad intencji A, potem udana albo pominieta intencja B: stan zostaje
--       `error` z etykieta, bledem i intencja A;
--   (b) ponowienie powtarza A (a nie B): kontakt powstaje z segmentem
--       speaker i tagami speaker, cfp:accepted, wpis osi czasu A raz,
--       `pending_errors` puste; drugie ponowienie niczego nie dubluje;
--   (c) dwie nieudane intencje, jedna naprawiona: stan nadal `error`
--       z druga;
--   (d) przeniesienie ze stoiska przy czekajacym bledzie innej intencji:
--       `skipped_no_consent`, a nie `failed` (blad stoiska - `failed`);
--   (e) stoisko, odprawa, stoisko - jeden wpis; odprawa, cofniecie, odprawa -
--       jeden wpis; dwa zgloszenia - dwa wpisy; wpis zapisany przed ta
--       migracja nie jest dublowany;
--   (f) migracja: wiersz `error` sprzed niej dostaje wpis w `pending_errors`
--       (ponowne zastosowanie pliku jest idempotentne), a ponowienie bez
--       czekajacych intencji powtarza ostatnie wywolanie jak dotad.
--
-- AWARIA CRM jest wymuszona wyzwalaczem na `crm_leads` (w wycofywanej
-- transakcji) - rzuca, gdy tagi kontaktu trafiaja w tabele `_test15_boom`,
-- wiec kazda intencja ma wlasny wylacznik.
--
-- SPRZATANIE. Caly plik pracuje w transakcji zakonczonej ROLLBACK-iem.
-- ============================================================================

\echo '== 15 most CRM: stan per intencja, os czasu bez duplikatow =='

BEGIN;

-- ---------------------------------------------------------------------------
-- SCENOGRAFIA
-- ---------------------------------------------------------------------------
INSERT INTO auth.users (id, email) VALUES
  ('15a00000-0000-0000-0000-0000000000a1', 'most15.admin@example.org'),
  ('15a00000-0000-0000-0000-0000000000a2', 'most15.skaner@example.org')
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.user_roles (user_id, role, tenant_id) VALUES
  ('15a00000-0000-0000-0000-0000000000a1', 'admin', '11111111-1111-1111-1111-111111111111')
ON CONFLICT DO NOTHING;
INSERT INTO public.profiles (id, tenant_id, display_name, slug) VALUES
  ('15a00000-0000-0000-0000-0000000000a1', '11111111-1111-1111-1111-111111111111', 'Admin 15', 'most15-admin'),
  ('15a00000-0000-0000-0000-0000000000a2', '11111111-1111-1111-1111-111111111111', 'Skaner 15', 'most15-skaner')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.events (id, tenant_id, slug, title_pl, title_en, starts_at, status) VALUES
  ('15e00000-0000-0000-0000-0000000000e1', '11111111-1111-1111-1111-111111111111',
   'most-15', 'Kongres 15', 'Congress 15', now() + interval '30 days', 'published'),
  ('15e00000-0000-0000-0000-0000000000e2', '11111111-1111-1111-1111-111111111111',
   'most-15-b', 'Forum 15', 'Forum 15', now() + interval '60 days', 'published');

INSERT INTO public.crm_companies (id, tenant_id, name) VALUES
  ('15c00000-0000-0000-0000-0000000000c1', '11111111-1111-1111-1111-111111111111', 'Stoisko Jeden 15'),
  ('15c00000-0000-0000-0000-0000000000c2', '11111111-1111-1111-1111-111111111111', 'Stoisko Dwa 15');
INSERT INTO public.event_sponsors (id, tenant_id, event_id, company_id, role, is_published, snapshot_name) VALUES
  ('15500000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   '15e00000-0000-0000-0000-0000000000e1', '15c00000-0000-0000-0000-0000000000c1', 'sponsor', false, 'Jeden 15'),
  ('15500000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111',
   '15e00000-0000-0000-0000-0000000000e1', '15c00000-0000-0000-0000-0000000000c2', 'sponsor', false, 'Dwa 15');

-- Istniejace kontakty: osoba ze stoiska (p5) i osoba z wpisem osi czasu
-- zapisanym przed migracja (p6).
INSERT INTO public.crm_leads (id, tenant_id, email, email_norm, first_name, last_name, source_type, tags) VALUES
  ('15d00000-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111',
   'stoisko15@example.org', 'stoisko15@example.org', 'Stefan', 'Stoisko', 'manual', '{}'),
  ('15d00000-0000-0000-0000-000000000006', '11111111-1111-1111-1111-111111111111',
   'dawny15@example.org', 'dawny15@example.org', 'Dawid', 'Dawny', 'manual', '{}');

INSERT INTO public.event_people
  (id, tenant_id, email, first_name, last_name, consent_data_processing_at, consent_marketing_at, source)
VALUES
  -- p1: prelegentka bez kontaktu (przyjecie konczy sie bledem, potem odprawa).
  ('15f00000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   'prelegentka15@example.org', 'Paula', 'Prelegentka', now(), NULL, 'organizer'),
  -- p2: dwie nieudane intencje.
  ('15f00000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111',
   'dwa15@example.org', 'Dorota', 'Dwie', now(), NULL, 'organizer'),
  -- p3: bez zgody i bez kontaktu, zeskanowana na stoisku, czeka blad naboru.
  ('15f00000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111',
   'bezzgody15@example.org', 'Beata', 'Bezzgody', now(), NULL, 'self_registration'),
  -- p4: ze zgoda, bez kontaktu, zeskanowana na stoisku (blad stoiska).
  ('15f00000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111',
   'zgoda15@example.org', 'Zofia', 'Zgoda', now(), now() - interval '1 day', 'self_registration'),
  -- p5: istniejacy kontakt, stoisko i dwa zgloszenia (dwa wydarzenia).
  ('15f00000-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111',
   'stoisko15@example.org', 'Stefan', 'Stoisko', now(), NULL, 'self_registration'),
  -- p6: istniejacy kontakt z wpisem odprawy zapisanym przed migracja.
  ('15f00000-0000-0000-0000-000000000006', '11111111-1111-1111-1111-111111111111',
   'dawny15@example.org', 'Dawid', 'Dawny', now(), NULL, 'self_registration'),
  -- p7: stan `error` sprzed migracji (bez pending_errors).
  ('15f00000-0000-0000-0000-000000000007', '11111111-1111-1111-1111-111111111111',
   'stary15@example.org', 'Stanislaw', 'Stary', now(), NULL, 'organizer'),
  -- p8: pominieta odprawa, kontakt powstaje pozniej (ponowienie bez czekajacych bledow).
  ('15f00000-0000-0000-0000-000000000008', '11111111-1111-1111-1111-111111111111',
   'pozniej15@example.org', 'Piotr', 'Pozniej', now(), NULL, 'self_registration');

INSERT INTO public.event_registrations (id, tenant_id, event_id, person_id, status, registration_mode) VALUES
  ('15300000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   '15e00000-0000-0000-0000-0000000000e1', '15f00000-0000-0000-0000-000000000001', 'approved', 'form'),
  ('15300000-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111',
   '15e00000-0000-0000-0000-0000000000e1', '15f00000-0000-0000-0000-000000000005', 'approved', 'form'),
  ('15300000-0000-0000-0000-00000000005b', '11111111-1111-1111-1111-111111111111',
   '15e00000-0000-0000-0000-0000000000e2', '15f00000-0000-0000-0000-000000000005', 'approved', 'form'),
  ('15300000-0000-0000-0000-000000000006', '11111111-1111-1111-1111-111111111111',
   '15e00000-0000-0000-0000-0000000000e1', '15f00000-0000-0000-0000-000000000006', 'approved', 'form');

INSERT INTO public.event_lead_scans (tenant_id, event_id, sponsor_id, person_id, scanned_by_user_id) VALUES
  ('11111111-1111-1111-1111-111111111111', '15e00000-0000-0000-0000-0000000000e1',
   '15500000-0000-0000-0000-000000000001', '15f00000-0000-0000-0000-000000000003',
   '15a00000-0000-0000-0000-0000000000a2'),
  ('11111111-1111-1111-1111-111111111111', '15e00000-0000-0000-0000-0000000000e1',
   '15500000-0000-0000-0000-000000000001', '15f00000-0000-0000-0000-000000000004',
   '15a00000-0000-0000-0000-0000000000a2'),
  ('11111111-1111-1111-1111-111111111111', '15e00000-0000-0000-0000-0000000000e1',
   '15500000-0000-0000-0000-000000000002', '15f00000-0000-0000-0000-000000000005',
   '15a00000-0000-0000-0000-0000000000a2');

-- Wylacznik awarii per intencja: kontakt, ktorego tagi trafiaja w tabele, rzuca.
CREATE TABLE public._test15_boom (tag text PRIMARY KEY);
CREATE FUNCTION public._test15_crm_boom() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.tags && ARRAY(SELECT b.tag FROM public._test15_boom b) THEN
    RAISE EXCEPTION 'test15 boom: %', array_to_string(NEW.tags, ',');
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER test15_crm_boom BEFORE INSERT OR UPDATE ON public.crm_leads
  FOR EACH ROW EXECUTE FUNCTION public._test15_crm_boom();

-- Wywolanie mostu jak przy przyjeciu prelegenta (20260927000103).
CREATE OR REPLACE FUNCTION pg_temp.speaker15(_person uuid, _submission uuid) RETURNS uuid
LANGUAGE sql AS $$
  SELECT public._event_person_crm_sync(
    '11111111-1111-1111-1111-111111111111', _person, 'speaker', 'event:most-15:speaker',
    ARRAY['event:most-15', 'speaker', 'cfp:accepted'], '{}'::jsonb, true, 'event.cfp.accepted',
    jsonb_build_object('event_id', '15e00000-0000-0000-0000-0000000000e1', 'event_slug', 'most-15',
                       'submission_id', _submission, 'summary_pl', 'Przyjete', 'summary_en', 'Accepted'));
$$;

CREATE OR REPLACE FUNCTION pg_temp.link15(_person uuid) RETURNS public.event_person_crm_links
LANGUAGE sql STABLE AS $$
  SELECT k.* FROM public.event_person_crm_links k
   WHERE k.tenant_id = '11111111-1111-1111-1111-111111111111' AND k.person_id = _person;
$$;

CREATE OR REPLACE FUNCTION pg_temp.audits15(_lead uuid, _action text) RETURNS bigint
LANGUAGE sql STABLE AS $$
  SELECT count(*) FROM public.audit_log a
   WHERE a.tenant_id = '11111111-1111-1111-1111-111111111111' AND a.entity_type = 'crm_lead'
     AND a.entity_id = _lead AND a.action = _action;
$$;

SELECT pg_temp.act_as('15a00000-0000-0000-0000-0000000000a1', '11111111-1111-1111-1111-111111111111');

-- ---------------------------------------------------------------------------
-- (a) BLAD PRZYJECIA, POTEM POMINIETA ODPRAWA: BLAD ZOSTAJE
-- ---------------------------------------------------------------------------
INSERT INTO public._test15_boom VALUES ('cfp:accepted');

SELECT pg_temp.assert(
  pg_temp.speaker15('15f00000-0000-0000-0000-000000000001', '15600000-0000-0000-0000-000000000001') IS NULL,
  '15/(a): przyjecie prelegenta przy awarii CRM -> NULL');
-- Odprawa przez prawdziwy wyzwalacz: kontaktu nie ma, p_create => false.
UPDATE public.event_registrations SET attended_at = now() WHERE id = '15300000-0000-0000-0000-000000000001';

SELECT pg_temp.assert(
  (SELECT k.sync_status = 'error' AND k.last_source_label = 'event:most-15:speaker'
      AND k.last_source_type = 'speaker' AND k.last_error LIKE 'test15 boom%'
      AND k.last_tags = ARRAY['event:most-15', 'speaker', 'cfp:accepted'] AND k.last_create
      AND k.crm_lead_id IS NULL
     FROM pg_temp.link15('15f00000-0000-0000-0000-000000000001') k),
  '15/(a): pominieta odprawa nie zmazuje bledu przyjecia (stan, etykieta, intencja A)');
SELECT pg_temp.assert(
  (SELECT array_agg(x ORDER BY x) = ARRAY['event:most-15:speaker']
     FROM pg_temp.link15('15f00000-0000-0000-0000-000000000001') k, jsonb_object_keys(k.pending_errors) x)
  AND (SELECT k.pending_errors->'event:most-15:speaker'->>'audit_action' = 'event.cfp.accepted'
          AND k.pending_errors->'event:most-15:speaker'->'audit_meta'->>'submission_id'
              = '15600000-0000-0000-0000-000000000001'
          AND (k.pending_errors->'event:most-15:speaker'->>'create')::boolean
          AND k.pending_errors->'event:most-15:speaker'->'tags' = '["event:most-15", "speaker", "cfp:accepted"]'::jsonb
         FROM pg_temp.link15('15f00000-0000-0000-0000-000000000001') k),
  '15/(a): czeka wylacznie intencja przyjecia, z akcja osi czasu, metadanymi, tagami i p_create');

-- ---------------------------------------------------------------------------
-- (b) PONOWIENIE POWTARZA INTENCJE A
-- ---------------------------------------------------------------------------
DELETE FROM public._test15_boom;

DO $do$
DECLARE
  v_lead uuid;
  v_l public.crm_leads%ROWTYPE;
  v_k public.event_person_crm_links%ROWTYPE;
BEGIN
  v_lead := public.admin_event_person_crm_retry('15f00000-0000-0000-0000-000000000001');
  SELECT * INTO v_l FROM public.crm_leads WHERE id = v_lead;
  PERFORM pg_temp.assert(v_l.email_norm = 'prelegentka15@example.org' AND v_l.source_type = 'speaker'
    AND v_l.tags @> ARRAY['speaker', 'cfp:accepted'] AND NOT ('attended:most-15' = ANY (v_l.tags)),
    '15/(b): ponowienie zaklada kontakt prelegenta (segment speaker, tagi speaker i cfp:accepted), nie powtarza odprawy');
  v_k := pg_temp.link15('15f00000-0000-0000-0000-000000000001');
  PERFORM pg_temp.assert(v_k.sync_status = 'ok' AND v_k.pending_errors = '{}'::jsonb
    AND v_k.last_error IS NULL AND v_k.crm_lead_id = v_lead
    AND v_k.last_source_label = 'event:most-15:speaker',
    '15/(b): stan ok, pending_errors puste, kontakt przypiety');
  PERFORM pg_temp.assert(pg_temp.audits15(v_lead, 'event.cfp.accepted') = 1
    AND (SELECT a.metadata->>'submission_id' FROM public.audit_log a
          WHERE a.entity_id = v_lead AND a.action = 'event.cfp.accepted')
        = '15600000-0000-0000-0000-000000000001',
    '15/(b): wpis osi czasu przyjecia powtorzony raz, z metadanymi intencji');

  -- Drugie ponowienie (nic nie czeka) i drugie przyjecie tego samego zgloszenia.
  PERFORM public.admin_event_person_crm_retry('15f00000-0000-0000-0000-000000000001');
  PERFORM pg_temp.speaker15('15f00000-0000-0000-0000-000000000001', '15600000-0000-0000-0000-000000000001');
  PERFORM pg_temp.assert(pg_temp.audits15(v_lead, 'event.cfp.accepted') = 1,
    '15/(b): kolejne ponowienie i ponowne przyjecie nie dubluja wpisu osi czasu');
END
$do$;

-- ---------------------------------------------------------------------------
-- (c) DWIE NIEUDANE INTENCJE, JEDNA NAPRAWIONA
-- ---------------------------------------------------------------------------
INSERT INTO public._test15_boom VALUES ('cfp:accepted'), ('invoice:15');

DO $do$
DECLARE
  v_p2 constant uuid := '15f00000-0000-0000-0000-000000000002';
  v_k public.event_person_crm_links%ROWTYPE;
  v_tags text[];
BEGIN
  PERFORM pg_temp.speaker15(v_p2, '15600000-0000-0000-0000-000000000002');
  PERFORM public._event_person_crm_sync(
    '11111111-1111-1111-1111-111111111111', v_p2, 'event_participant', 'event:most-15:invoice',
    ARRAY['event:most-15', 'invoice:15'], '{}'::jsonb, true, 'event.invoice.issued',
    jsonb_build_object('event_id', '15e00000-0000-0000-0000-0000000000e1',
                       'invoice_id', '15700000-0000-0000-0000-000000000002'));
  v_k := pg_temp.link15(v_p2);
  PERFORM pg_temp.assert(v_k.sync_status = 'error'
    AND v_k.pending_errors ? 'event:most-15:speaker' AND v_k.pending_errors ? 'event:most-15:invoice'
    AND v_k.last_source_label = 'event:most-15:invoice',
    '15/(c): dwie nieudane intencje czekaja obie, last_* = najnowsza');

  DELETE FROM public._test15_boom WHERE tag = 'invoice:15';
  PERFORM public.admin_event_person_crm_retry(v_p2);
  v_k := pg_temp.link15(v_p2);
  SELECT l.tags INTO v_tags FROM public.crm_leads l WHERE l.id = v_k.crm_lead_id;
  PERFORM pg_temp.assert(v_k.sync_status = 'error'
    AND v_k.last_source_label = 'event:most-15:speaker' AND v_k.last_source_type = 'speaker'
    AND v_k.last_error LIKE 'test15 boom%'
    AND v_k.last_tags = ARRAY['event:most-15', 'speaker', 'cfp:accepted']
    AND (SELECT array_agg(x) FROM jsonb_object_keys(v_k.pending_errors) x) = ARRAY['event:most-15:speaker'],
    '15/(c): naprawiona faktura zdjela WYLACZNIE swoj blad - stan nadal error z przyjeciem');
  PERFORM pg_temp.assert(v_k.crm_lead_id IS NOT NULL AND v_k.synced_at IS NOT NULL
    AND 'invoice:15' = ANY (v_tags) AND NOT ('cfp:accepted' = ANY (v_tags))
    AND pg_temp.audits15(v_k.crm_lead_id, 'event.invoice.issued') = 1
    AND pg_temp.audits15(v_k.crm_lead_id, 'event.cfp.accepted') = 0,
    '15/(c): kontakt z faktury powstal (tag i wpis faktury), przyjecia jeszcze nie ma');

  DELETE FROM public._test15_boom;
  PERFORM public.admin_event_person_crm_retry(v_p2);
  v_k := pg_temp.link15(v_p2);
  PERFORM pg_temp.assert(v_k.sync_status = 'ok' AND v_k.pending_errors = '{}'::jsonb
    AND pg_temp.audits15(v_k.crm_lead_id, 'event.cfp.accepted') = 1
    AND pg_temp.audits15(v_k.crm_lead_id, 'event.invoice.issued') = 1,
    '15/(c): po naprawie drugiej intencji stan ok, po jednym wpisie kazdej intencji');
END
$do$;

-- ---------------------------------------------------------------------------
-- (d) PRZENIESIENIE ZE STOISKA PRZY CZEKAJACYM BLEDZIE INNEJ INTENCJI
-- ---------------------------------------------------------------------------
INSERT INTO public._test15_boom VALUES ('cfp:accepted'), ('sponsor_lead:15c00000-0000-0000-0000-0000000000c1');

DO $do$
DECLARE
  v_res jsonb;
BEGIN
  PERFORM pg_temp.speaker15('15f00000-0000-0000-0000-000000000003', '15600000-0000-0000-0000-000000000003');
  v_res := public.admin_event_lead_scans_push_to_crm(jsonb_build_object(
    'event_id', '15e00000-0000-0000-0000-0000000000e1',
    'sponsor_id', '15500000-0000-0000-0000-000000000001'));
  PERFORM pg_temp.assert(
    v_res = jsonb_build_object('persons', 2, 'created', 0, 'updated', 0, 'skipped_no_email', 0,
                               'skipped_no_consent', 1, 'failed', 1, 'has_more', false, 'next_after', NULL),
    format('15/(d): bez zgody = skipped_no_consent mimo bledu naboru, blad stoiska = failed; jest %s', v_res));
  PERFORM pg_temp.assert(
    (SELECT k.sync_status = 'error' AND k.last_source_label = 'event:most-15:speaker'
        AND k.pending_errors ? 'event:most-15:speaker' AND NOT k.pending_errors ? 'event:most-15:sponsor_lead'
       FROM pg_temp.link15('15f00000-0000-0000-0000-000000000003') k),
    '15/(d): pominiete przeniesienie nie zmazuje czekajacego bledu przyjecia');
  PERFORM pg_temp.assert(
    (SELECT k.sync_status = 'error' AND k.pending_errors ? 'event:most-15:sponsor_lead'
       FROM pg_temp.link15('15f00000-0000-0000-0000-000000000004') k),
    '15/(d): nieudane przeniesienie czeka pod etykieta stoiska');
END
$do$;

DELETE FROM public._test15_boom;

-- ---------------------------------------------------------------------------
-- (e) OS CZASU BEZ DUPLIKATOW
-- ---------------------------------------------------------------------------
DO $do$
DECLARE
  v_l5 constant uuid := '15d00000-0000-0000-0000-000000000005';
  v_res jsonb;
BEGIN
  -- Stoisko, odprawa, stoisko.
  v_res := public.admin_event_lead_scans_push_to_crm(jsonb_build_object(
    'event_id', '15e00000-0000-0000-0000-0000000000e1',
    'sponsor_id', '15500000-0000-0000-0000-000000000002'));
  PERFORM pg_temp.assert((v_res->>'updated')::int = 1 AND pg_temp.audits15(v_l5, 'event.sponsor_lead.pushed') = 1,
    '15/(e): pierwsze przeniesienie - jeden wpis');
  UPDATE public.event_registrations SET attended_at = now() WHERE id = '15300000-0000-0000-0000-000000000005';
  PERFORM pg_temp.assert(pg_temp.audits15(v_l5, 'event.checkin.attended') = 1
    AND (SELECT k.last_source_label = 'event:most-15:checkin'
           FROM pg_temp.link15('15f00000-0000-0000-0000-000000000005') k),
    '15/(e): odprawa miedzy przeniesieniami (ostatnia intencja = odprawa)');
  v_res := public.admin_event_lead_scans_push_to_crm(jsonb_build_object(
    'event_id', '15e00000-0000-0000-0000-0000000000e1',
    'sponsor_id', '15500000-0000-0000-0000-000000000002'));
  PERFORM pg_temp.assert((v_res->>'updated')::int = 1 AND pg_temp.audits15(v_l5, 'event.sponsor_lead.pushed') = 1,
    '15/(e): stoisko, odprawa, stoisko - nadal jeden wpis przeniesienia');

  -- Odprawa, cofniecie obecnosci, odprawa.
  UPDATE public.event_registrations SET attended_at = NULL WHERE id = '15300000-0000-0000-0000-000000000005';
  UPDATE public.event_registrations SET attended_at = now() WHERE id = '15300000-0000-0000-0000-000000000005';
  PERFORM pg_temp.assert(pg_temp.audits15(v_l5, 'event.checkin.attended') = 1,
    '15/(e): odprawa, cofniecie, odprawa - jeden wpis odprawy');

  -- Drugie zgloszenie tej samej osoby (inne wydarzenie) to inne zdarzenie.
  UPDATE public.event_registrations SET attended_at = now() WHERE id = '15300000-0000-0000-0000-00000000005b';
  PERFORM pg_temp.assert(pg_temp.audits15(v_l5, 'event.checkin.attended') = 2
    AND (SELECT count(DISTINCT a.metadata->>'registration_id') FROM public.audit_log a
          WHERE a.entity_id = v_l5 AND a.action = 'event.checkin.attended') = 2,
    '15/(e): dwa zgloszenia - dwa wpisy odprawy');
END
$do$;

-- Wpis zapisany przed migracja (ten sam ksztalt metadanych, inny czas).
INSERT INTO public.audit_log (tenant_id, actor_id, action, entity_type, entity_id, metadata, created_at) VALUES
  ('11111111-1111-1111-1111-111111111111', NULL, 'event.checkin.attended', 'crm_lead',
   '15d00000-0000-0000-0000-000000000006',
   jsonb_build_object('event_id', '15e00000-0000-0000-0000-0000000000e1', 'event_slug', 'most-15',
                      'registration_id', '15300000-0000-0000-0000-000000000006',
                      'source_label', 'event:most-15:checkin',
                      'person_id', '15f00000-0000-0000-0000-000000000006'),
   now() - interval '1 day');
UPDATE public.event_registrations SET attended_at = now() WHERE id = '15300000-0000-0000-0000-000000000006';
SELECT pg_temp.assert(
  pg_temp.audits15('15d00000-0000-0000-0000-000000000006', 'event.checkin.attended') = 1
  AND (SELECT 'attended:most-15' = ANY (l.tags) FROM public.crm_leads l
        WHERE l.id = '15d00000-0000-0000-0000-000000000006'),
  '15/(e): wpis sprzed migracji nie jest dublowany, a kontakt i tak dostaje tag obecnosci');

-- ---------------------------------------------------------------------------
-- (f) MIGRACJA: STAN error SPRZED NIEJ I PONOWIENIE BEZ CZEKAJACYCH BLEDOW
-- ---------------------------------------------------------------------------
INSERT INTO public.event_person_crm_links (
  tenant_id, person_id, sync_status, last_error, last_source_type, last_source_label,
  last_tags, last_create, last_attempt_at
) VALUES (
  '11111111-1111-1111-1111-111111111111', '15f00000-0000-0000-0000-000000000007', 'error',
  'stary blad 15', 'event_cfp', 'event:most-15:cfp', ARRAY['event:most-15', 'cfp:submitted'], true,
  now() - interval '1 hour'
);

-- Ponowne zastosowanie migracji: idempotentne, a backfill obejmuje wiersz wyzej.
\ir ../../../supabase/migrations/20260927001400_event_person_crm_intents.sql

SELECT pg_temp.assert(
  (SELECT k.pending_errors = jsonb_build_object('event:most-15:cfp', jsonb_build_object(
            'error', 'stary blad 15', 'source_type', 'event_cfp',
            'tags', '["event:most-15", "cfp:submitted"]'::jsonb, 'create', true,
            'attempt_at', k.last_attempt_at, 'audit_action', NULL, 'audit_meta', '{}'::jsonb))
     FROM pg_temp.link15('15f00000-0000-0000-0000-000000000007') k),
  '15/(f): stan error sprzed migracji dostaje wpis w pending_errors z last_*');
SELECT pg_temp.assert(
  (SELECT k.pending_errors = '{}'::jsonb FROM pg_temp.link15('15f00000-0000-0000-0000-000000000005') k)
  AND (SELECT k.pending_errors ? 'event:most-15:speaker'
         FROM pg_temp.link15('15f00000-0000-0000-0000-000000000003') k)
  AND (SELECT count(*) FROM jsonb_object_keys(
         (SELECT k.pending_errors FROM pg_temp.link15('15f00000-0000-0000-0000-000000000003') k))) = 1,
  '15/(f): ponowne zastosowanie nie rusza wierszy ok ani juz wypelnionych wpisow');

DO $do$
DECLARE
  v_lead uuid;
  v_k public.event_person_crm_links%ROWTYPE;
BEGIN
  v_lead := public.admin_event_person_crm_retry('15f00000-0000-0000-0000-000000000007');
  v_k := pg_temp.link15('15f00000-0000-0000-0000-000000000007');
  PERFORM pg_temp.assert(v_lead IS NOT NULL AND v_k.sync_status = 'ok' AND v_k.pending_errors = '{}'::jsonb
    AND (SELECT l.source_type = 'event_cfp' AND l.tags = ARRAY['event:most-15', 'cfp:submitted']
           FROM public.crm_leads l WHERE l.id = v_lead)
    AND NOT EXISTS (SELECT 1 FROM public.audit_log a WHERE a.entity_id = v_lead),
    '15/(f): ponowienie wpisu z backfillu zaklada kontakt (bez akcji osi czasu, ktorej nie zapisano)');

  -- Pominieta odprawa, kontakt powstaje pozniej: nic nie czeka, ponowienie
  -- powtarza ostatnie wywolanie (p_create => false) jak dotad.
  PERFORM public._event_person_crm_sync(
    '11111111-1111-1111-1111-111111111111', '15f00000-0000-0000-0000-000000000008', 'event_participant',
    'event:most-15:checkin', ARRAY['event:most-15', 'attended:most-15'], '{}'::jsonb, false);
  PERFORM pg_temp.assert(
    (SELECT k.sync_status = 'skipped' AND k.last_error = 'lead_not_found' AND k.pending_errors = '{}'::jsonb
       FROM pg_temp.link15('15f00000-0000-0000-0000-000000000008') k),
    '15/(f): pominiecie nie jest czekajacym bledem');
  INSERT INTO public.crm_leads (id, tenant_id, email, email_norm, source_type, tags) VALUES
    ('15d00000-0000-0000-0000-000000000008', '11111111-1111-1111-1111-111111111111',
     'pozniej15@example.org', 'pozniej15@example.org', 'manual', '{}');
  v_lead := public.admin_event_person_crm_retry('15f00000-0000-0000-0000-000000000008');
  PERFORM pg_temp.assert(v_lead = '15d00000-0000-0000-0000-000000000008'
    AND (SELECT 'attended:most-15' = ANY (l.tags) FROM public.crm_leads l WHERE l.id = v_lead)
    AND (SELECT k.sync_status = 'ok' FROM pg_temp.link15('15f00000-0000-0000-0000-000000000008') k),
    '15/(f): ponowienie bez czekajacych bledow powtarza ostatnie wywolanie i zwraca kontakt');
END
$do$;

\echo '== 15 most CRM: koniec =='
ROLLBACK;
