-- ============================================================================
-- 61 PRZYPIECIE SPOTKANIA DO SPONSORA (OPS-10, poprawka F6)
--
-- Migracje `20261012120100_event_meeting_sponsor_binding` (helper i wolanie
-- w zaproszeniu) oraz `20261012160000_event_meeting_sponsor_verified_contact`
-- (F6: powiazanie tylko przez osobe kontaktowa wskazana przez organizatora
-- i POTWIERDZONE konto). Defekt pierwotny: `event_meeting_invite` zapisywal
-- `sponsor_id` wprost z ladunku, a raport sponsora liczy spotkania po tej
-- kolumnie. Defekt F6: helper uznawal za powiazanie firme osoby i most CRM -
-- oba pola uczestnik ustawia sam (`event_my_event_profile_set`). Plik
-- sprawdza:
--   * helper `_event_meeting_sponsor_allowed` (macierz: osoba kontaktowa po
--     potwierdzonym koncie po obu stronach; firma osoby - nawet wpisana przez
--     organizatora - NIE; konto niepotwierdzone, inny adres konta, osoba bez
--     konta z adresem kontaktu, most CRM wskazujacy kontakt - NIE; inny
--     sponsor, sponsor innego wydarzenia, obcy najemca - NIE);
--   * KRYTERIUM AUDYTU: zaproszenie z obcym sponsorem powstaje BEZ
--     przypiecia (NULL), a odpowiedz mowi to wprost (`sponsor_id: null`);
--   * F6 PRZEZ PRAWDZIWE RPC: uczestnik wpisuje sobie firme sponsora i adres
--     osoby kontaktowej sponsora (`event_my_event_profile_set`, most CRM
--     `_event_person_crm_sync`) - przypiecie i tak NIE powstaje; organizator
--     dopisuje osobe do kontaktow (`admin_event_sponsor_contacts_set`) -
--     przypiecie powstaje; uczestnik nie ma drogi zapisu do kontaktow;
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
-- Uczestnicy E1 (konta P1-P4 maja potwierdzone adresy - DEFAULT harnessu):
--   P1, P2 - bez powiazan;
--   P3 - firma C1 wpisana przez organizatora (`source = 'organizer'`), w CRM
--        organizatora jest kontakt L3 na jej adres, ale NIE na liscie S1;
--   P4 - osoba kontaktowa S1 (L4, rola onsite) na adres swojego konta;
--   P6 - osoba BEZ konta z adresem L6, ktory organizator przypial do S2.
-- L5 - osoba kontaktowa S1 bez konta i bez osoby wydarzenia (cel ataku
-- przez most CRM w sekcji 4).
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
   'Paula', 'Czwarta', 'msb.p4@example.org', 'organizer', '61a00000-0000-0000-0000-000000000004', NULL),
  ('61800000-0000-0000-0000-000000000006', '11111111-1111-1111-1111-111111111111',
   'Patryk', 'Szosty', 'msb.p6@example.org', 'organizer', NULL, NULL);

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
   '61e00000-0000-0000-0000-0000000000e1', '61800000-0000-0000-0000-000000000004', 'approved', 'rsvp'),
  ('61900000-0000-0000-0000-000000000006', '11111111-1111-1111-1111-111111111111',
   '61e00000-0000-0000-0000-0000000000e1', '61800000-0000-0000-0000-000000000006', 'approved', 'rsvp');

-- Kartoteka CRM organizatora: L3 (adres P3, NIE kontakt sponsora), L4 (adres
-- P4, kontakt S1 onsite), L5 (kontakt S1 bez konta), L6 (adres P6, kontakt S2).
INSERT INTO public.crm_leads (id, tenant_id, email, email_norm, source_type, tags) VALUES
  ('61100000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111',
   'msb.p3@example.org', 'msb.p3@example.org', 'manual', '{}'),
  ('61100000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111',
   'msb.p4@example.org', 'msb.p4@example.org', 'manual', '{}'),
  ('61100000-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111',
   'msb.kontakt@example.org', 'msb.kontakt@example.org', 'manual', '{}'),
  ('61100000-0000-0000-0000-000000000006', '11111111-1111-1111-1111-111111111111',
   'msb.p6@example.org', 'msb.p6@example.org', 'manual', '{}');
INSERT INTO public.event_sponsor_contacts (tenant_id, event_id, sponsor_id, lead_id, role) VALUES
  ('11111111-1111-1111-1111-111111111111', '61e00000-0000-0000-0000-0000000000e1',
   '61500000-0000-0000-0000-000000000001', '61100000-0000-0000-0000-000000000004', 'onsite'),
  ('11111111-1111-1111-1111-111111111111', '61e00000-0000-0000-0000-0000000000e1',
   '61500000-0000-0000-0000-000000000001', '61100000-0000-0000-0000-000000000005', 'primary'),
  ('11111111-1111-1111-1111-111111111111', '61e00000-0000-0000-0000-0000000000e1',
   '61500000-0000-0000-0000-000000000002', '61100000-0000-0000-0000-000000000006', 'onsite');
-- Most CRM P4 -> L4 i P6 -> L6 (jak po synchronizacji). Helper go NIE czyta -
-- sekcja 2 pokazuje, ze ani jego brak, ani jego obecnosc niczego nie zmienia.
INSERT INTO public.event_person_crm_links (tenant_id, person_id, crm_lead_id, sync_status) VALUES
  ('11111111-1111-1111-1111-111111111111', '61800000-0000-0000-0000-000000000004',
   '61100000-0000-0000-0000-000000000004', 'ok'),
  ('11111111-1111-1111-1111-111111111111', '61800000-0000-0000-0000-000000000006',
   '61100000-0000-0000-0000-000000000006', 'ok');

-- Okna dostepnosci 09:00-17:00 dla wszystkich zgloszen E1.
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

-- Edycja WLASNEGO profilu wydarzenia przez uczestnika - ta sama sciezka, co
-- formularz MyEventProfileForm (OrganizationPicker ustawia `company_id`).
CREATE FUNCTION pg_temp.msb_profile_set(_who integer, _patch jsonb)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  v_res jsonb;
BEGIN
  PERFORM pg_temp.act_as(('61a00000-0000-0000-0000-00000000000' || _who)::uuid,
                         '11111111-1111-1111-1111-111111111111');
  v_res := public.event_my_event_profile_set(jsonb_build_object('slug', 'msb-gielda') || _patch);
  PERFORM pg_temp.act_as();
  RETURN v_res;
END $$;

-- ---------------------------------------------------------------------------
-- SEKCJA 2: HELPER - KTO JEST POWIAZANY ZE SPONSOREM
-- ---------------------------------------------------------------------------
DO $do$
DECLARE
  t constant uuid := '11111111-1111-1111-1111-111111111111';
  e1 constant uuid := '61e00000-0000-0000-0000-0000000000e1';
  e2 constant uuid := '61e00000-0000-0000-0000-0000000000e2';
  s1 constant uuid := '61500000-0000-0000-0000-000000000001';
  s2 constant uuid := '61500000-0000-0000-0000-000000000002';
  sx constant uuid := '61500000-0000-0000-0000-0000000000e2';
  r1 constant uuid := '61900000-0000-0000-0000-000000000001';
  r2 constant uuid := '61900000-0000-0000-0000-000000000002';
  r3 constant uuid := '61900000-0000-0000-0000-000000000003';
  r4 constant uuid := '61900000-0000-0000-0000-000000000004';
  r6 constant uuid := '61900000-0000-0000-0000-000000000006';
  u4 constant uuid := '61a00000-0000-0000-0000-000000000004';
BEGIN
  PERFORM pg_temp.assert(
    NOT public._event_meeting_sponsor_allowed(t, e1, s1, r1, r2),
    '61/helper: dwoje uczestnikow bez powiazania - sponsora NIE wolno przypiac');
  PERFORM pg_temp.assert(
    public._event_meeting_sponsor_allowed(t, e1, s1, r2, r4)
    AND public._event_meeting_sponsor_allowed(t, e1, s1, r4, r2),
    '61/helper: wolno, gdy zaproszony ALBO zapraszajacy jest osoba kontaktowa sponsora '
    || '(lista organizatora, potwierdzone konto)');

  -- F6: firma osoby nie jest dowodem. P3 ma firme sponsora S1 wpisana NAWET
  -- przez organizatora - kolumna nie pamieta, kto ja ustawil, a uczestnik
  -- nadpisuje ja tym samym polem.
  PERFORM pg_temp.assert(
    (SELECT p.company_id FROM public.event_people p WHERE p.id = '61800000-0000-0000-0000-000000000003')
      = (SELECT s.company_id FROM public.event_sponsors s WHERE s.id = s1)
    AND NOT public._event_meeting_sponsor_allowed(t, e1, s1, r1, r3)
    AND NOT public._event_meeting_sponsor_allowed(t, e1, s1, r3, r1),
    '61/F6/helper: firma osoby rowna firmie sponsora NIE jest powiazaniem (po zadnej stronie)');

  PERFORM pg_temp.assert(
    NOT public._event_meeting_sponsor_allowed(t, e1, s2, r4, r1),
    '61/helper: osoba kontaktowa JEDNEGO sponsora nie przypnie INNEGO');
  PERFORM pg_temp.assert(
    NOT public._event_meeting_sponsor_allowed(t, e1, sx, r4, r1)
    AND NOT public._event_meeting_sponsor_allowed(t, e2, sx, r4, r1),
    '61/helper: sponsor innego wydarzenia (nawet ta sama firma) - nie wolno');
  PERFORM pg_temp.assert(
    NOT public._event_meeting_sponsor_allowed('61000000-0000-0000-0000-0000000000b0', e1, s1, r4, r1),
    '61/helper/izolacja: obcy najemca - nie wolno');
  PERFORM pg_temp.assert(
    NOT public._event_meeting_sponsor_allowed(t, e1, NULL, r4, r1),
    '61/helper: brak sponsora - nie ma czego przypinac');

  -- TOZSAMOSC = POTWIERDZONE KONTO. Niepotwierdzony adres nie jest dowodem.
  UPDATE auth.users u SET email_confirmed_at = NULL WHERE u.id = u4;
  PERFORM pg_temp.assert(
    NOT public._event_meeting_sponsor_allowed(t, e1, s1, r2, r4),
    '61/F6/helper: konto z NIEPOTWIERDZONYM adresem kontaktu - nie wolno');
  UPDATE auth.users u SET email_confirmed_at = now() WHERE u.id = u4;

  -- Konto na inny adres niz kontakt: osoba wydarzenia i most zostaja, konto nie pasuje.
  UPDATE auth.users u SET email = 'msb.p4.prywatny@example.org' WHERE u.id = u4;
  PERFORM pg_temp.assert(
    NOT public._event_meeting_sponsor_allowed(t, e1, s1, r2, r4),
    '61/F6/helper: adres konta inny niz adres osoby kontaktowej - nie wolno (event_people.email i most nie licza sie)');
  -- Normalizacja jak `crm_leads.email_norm`: wielkosc liter i biale znaki.
  UPDATE auth.users u SET email = '  MSB.P4@Example.ORG ' WHERE u.id = u4;
  PERFORM pg_temp.assert(
    public._event_meeting_sponsor_allowed(t, e1, s1, r2, r4),
    '61/helper: adres konta porownywany po normalizacji (lower + btrim)');
  UPDATE auth.users u SET email = 'msb.p4@example.org' WHERE u.id = u4;

  -- Osoba BEZ konta z adresem kontaktu S2 i mostem do niego: brak tozsamosci.
  PERFORM pg_temp.assert(
    (SELECT p.email FROM public.event_people p WHERE p.id = '61800000-0000-0000-0000-000000000006')
      = 'msb.p6@example.org'
    AND NOT public._event_meeting_sponsor_allowed(t, e1, s2, r1, r6)
    AND NOT public._event_meeting_sponsor_allowed(t, e1, s2, r6, r1),
    '61/F6/helper: osoba bez konta z adresem i mostem do kontaktu sponsora - nie wolno');

  -- Most CRM nie jest zrodlem prawdy w zadna strone.
  UPDATE public.event_person_crm_links l SET crm_lead_id = NULL
   WHERE l.person_id = '61800000-0000-0000-0000-000000000004';
  PERFORM pg_temp.assert(
    public._event_meeting_sponsor_allowed(t, e1, s1, r2, r4),
    '61/helper: osoba kontaktowa bez mostu CRM nadal powiazana (liczy sie konto)');
  UPDATE public.event_person_crm_links l SET crm_lead_id = '61100000-0000-0000-0000-000000000004'
   WHERE l.person_id = '61800000-0000-0000-0000-000000000004';
  INSERT INTO public.event_person_crm_links (tenant_id, person_id, crm_lead_id, sync_status)
  VALUES (t, '61800000-0000-0000-0000-000000000001', '61100000-0000-0000-0000-000000000005', 'ok');
  PERFORM pg_temp.assert(
    NOT public._event_meeting_sponsor_allowed(t, e1, s1, r1, r2),
    '61/F6/helper: most CRM wskazujacy kontakt sponsora nie czyni obcego konta osoba kontaktowa');
  DELETE FROM public.event_person_crm_links l
   WHERE l.person_id = '61800000-0000-0000-0000-000000000001';
END
$do$;

-- ---------------------------------------------------------------------------
-- SEKCJA 3: ZAPROSZENIE UCZESTNIKA (KRYTERIUM AUDYTU)
-- Kazde zaproszenie w osobnym slocie (0..6), zeby limity gieldy nie mieszaly
-- sie z regula przypiecia.
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

  -- P4 (kontakt S1) -> P1 z S2: powiazanie z S1 nie otwiera S2.
  v_res := pg_temp.msb_invite(4, 1, 1, s2);
  PERFORM pg_temp.assert(pg_temp.msb_sponsor_of(v_res) IS NULL,
    '61/AUDYT: osoba kontaktowa S1 nie przypnie spotkania do S2');

  -- Sponsor INNEGO wydarzenia: dawniej blad klucza obcego, teraz brak przypiecia.
  v_res := pg_temp.msb_invite(1, 3, 2, sx);
  PERFORM pg_temp.assert(pg_temp.msb_sponsor_of(v_res) IS NULL AND v_res->>'status' = 'invited',
    '61/AUDYT: sponsor innego wydarzenia nie jest przypinany, spotkanie i tak powstaje');

  -- F6: firma sponsora w profilu (tu wpisana przez organizatora) nie wystarcza.
  v_res := pg_temp.msb_invite(1, 3, 3, s1);
  PERFORM pg_temp.assert(
    pg_temp.msb_sponsor_of(v_res) IS NULL AND v_res->'sponsor_id' = 'null'::jsonb
    AND v_res->>'status' = 'invited',
    '61/F6: zaproszony z firma sponsora (bez wpisu na liscie kontaktow) - spotkanie bez przypiecia');
  v_res := pg_temp.msb_invite(3, 2, 4, s1);
  PERFORM pg_temp.assert(pg_temp.msb_sponsor_of(v_res) IS NULL,
    '61/F6: zapraszajacy z firma sponsora (bez wpisu na liscie kontaktow) - spotkanie bez przypiecia');

  -- Prawomocne przypiecia: osoba kontaktowa po ktorejkolwiek stronie.
  v_res := pg_temp.msb_invite(1, 4, 5, s1);
  PERFORM pg_temp.assert(pg_temp.msb_sponsor_of(v_res) = s1::uuid AND v_res->>'sponsor_id' = s1,
    '61/zaproszenie: zaproszony jest osoba kontaktowa sponsora - przypiecie zostaje');
  v_res := pg_temp.msb_invite(4, 2, 6, s1);
  PERFORM pg_temp.assert(pg_temp.msb_sponsor_of(v_res) = s1::uuid,
    '61/zaproszenie: zapraszajacy jest osoba kontaktowa sponsora - przypiecie zostaje');

  -- Bez sponsora w ladunku - bez zmian.
  v_res := pg_temp.msb_invite(2, 3, 7, NULL);
  PERFORM pg_temp.assert(v_res->'sponsor_id' = 'null'::jsonb AND pg_temp.msb_sponsor_of(v_res) IS NULL,
    '61/zaproszenie: zaproszenie bez sponsora dziala jak dotad');

  -- Licznik, z ktorego raport sponsora liczy spotkania.
  PERFORM pg_temp.assert(
    (SELECT count(*) FROM public.event_meetings m WHERE m.sponsor_id = s2::uuid) = 0
    AND (SELECT count(*) FROM public.event_meetings m WHERE m.sponsor_id = s1::uuid) = 2
    AND (SELECT count(*) FROM public.event_meetings m WHERE m.sponsor_id = sx::uuid) = 0,
    '61/AUDYT: raport S2 nie dostaje ani jednego podrobionego spotkania; S1 ma dwa prawomocne');
END
$do$;

SELECT pg_temp.act_as('61a00000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111');
SELECT pg_temp.assert_raises_like($q$SELECT public.event_meeting_invite(jsonb_build_object(
    'event_slug', 'msb-gielda',
    'counterpart_registration_id', '61900000-0000-0000-0000-000000000002',
    'starts_at', pg_temp.msb_slot(8),
    'sponsor_id', 'nie-uuid'))$q$,
  'invalid input syntax', '61/zaproszenie/ODMOWA: sponsor_id spoza ksztaltu uuid nadal odrzucany');
SELECT pg_temp.act_as();

-- ---------------------------------------------------------------------------
-- SEKCJA 4: F6 - SAMODZIELNIE WPISANE POWIAZANIE PRZEZ PRAWDZIWE RPC
-- Scenariusz przegladu: dwa zmowione konta (P1, P2) bez zwiazku ze sponsorem.
-- Sloty 8, 9 i 12 (10-11 zajmuje sekcja 5).
-- ---------------------------------------------------------------------------
DO $do$
DECLARE
  t constant uuid := '11111111-1111-1111-1111-111111111111';
  e1 constant uuid := '61e00000-0000-0000-0000-0000000000e1';
  s1 constant text := '61500000-0000-0000-0000-000000000001';
  s2 constant text := '61500000-0000-0000-0000-000000000002';
  c2 constant uuid := '61c00000-0000-0000-0000-0000000000c2';
  p1 constant uuid := '61800000-0000-0000-0000-000000000001';
  r1 constant uuid := '61900000-0000-0000-0000-000000000001';
  r2 constant uuid := '61900000-0000-0000-0000-000000000002';
  r3 constant uuid := '61900000-0000-0000-0000-000000000003';
  v_res jsonb;
  v_lead uuid;
BEGIN
  -- (a) P1 wpisuje sobie firme sponsora S2 formularzem profilu.
  v_res := pg_temp.msb_profile_set(1, jsonb_build_object('company_id', c2));
  PERFORM pg_temp.assert(
    (v_res->'profile'->>'company_id')::uuid = c2
    AND (SELECT p.company_id FROM public.event_people p WHERE p.id = p1) = c2,
    '61/F6/warunek: uczestnik SAM ustawia sobie firme sponsora (event_my_event_profile_set)');
  v_res := pg_temp.msb_invite(1, 2, 8, s2);
  PERFORM pg_temp.assert(
    v_res->>'status' = 'invited' AND v_res->'sponsor_id' = 'null'::jsonb
    AND pg_temp.msb_sponsor_of(v_res) IS NULL,
    '61/F6/AUDYT: firma sponsora wpisana sobie w profilu NIE przypina spotkania (sponsor_id: null)');

  -- (b) P1 wpisuje sobie adres osoby kontaktowej S1 (L5), a most CRM - wolany
  -- przez kazda akcje uczestnika (nabor, odprawa) - przepina go na L5.
  v_res := pg_temp.msb_profile_set(1, jsonb_build_object('email', 'msb.kontakt@example.org'));
  v_lead := public._event_person_crm_sync(t, p1, 'event', 'event:msb-gielda:checkin');
  PERFORM pg_temp.assert(
    v_lead = '61100000-0000-0000-0000-000000000005'
    AND (SELECT l.crm_lead_id FROM public.event_person_crm_links l
          WHERE l.tenant_id = t AND l.person_id = p1) = '61100000-0000-0000-0000-000000000005',
    '61/F6/warunek: most CRM przepial uczestnika na osobe kontaktowa S1 po samodzielnie wpisanym adresie');
  v_res := pg_temp.msb_invite(1, 2, 9, s1);
  PERFORM pg_temp.assert(
    v_res->'sponsor_id' = 'null'::jsonb AND pg_temp.msb_sponsor_of(v_res) IS NULL,
    '61/F6/AUDYT: adres kontaktu wpisany w profilu + most CRM NIE przypinaja spotkania do S1');

  -- (c) Uczestnik nie dopisze sie do listy kontaktow - ani RPC, ani tabela.
  PERFORM pg_temp.act_as('61a00000-0000-0000-0000-000000000001', t);
  PERFORM pg_temp.assert_raises_like(format(
    $q$SELECT public.admin_event_sponsor_contacts_set(jsonb_build_object(
         'sponsor_id', '%s', 'items', jsonb_build_array(
           jsonb_build_object('lead_id', '61100000-0000-0000-0000-000000000005'))))$q$, s1),
    'forbidden',
    '61/F6/ODMOWA: uczestnik nie zapisze listy osob kontaktowych sponsora (RPC organizatora)');
  PERFORM pg_temp.act_as();
  -- Kotwica zaufania to RLS bez polityki zapisu, nie sam grant: domyslne
  -- uprawnienia platformy (ALTER DEFAULT PRIVILEGES) moga nadac klientowi
  -- zapis na tabeli, ale RLS bez polityki INSERT/UPDATE/DELETE odmawia.
  PERFORM pg_temp.assert(
    (SELECT c.relrowsecurity FROM pg_class c
      WHERE c.oid = 'public.event_sponsor_contacts'::regclass)
    AND NOT EXISTS (
      SELECT 1 FROM pg_policies pol
       WHERE pol.schemaname = 'public' AND pol.tablename = 'event_sponsor_contacts'
         AND pol.cmd IN ('INSERT', 'UPDATE', 'DELETE', 'ALL')),
    '61/F6/RLS: lista osob kontaktowych sponsora - RLS wlaczone i zadnej polityki zapisu dla klienta');

  -- (d) Organizator dopisuje P3 (L3, rola onsite) do kontaktow S1 - teraz
  -- przypiecie powstaje. Lista jest podmieniana w calosci, wiec L4 i L5 zostaja.
  PERFORM pg_temp.assert(
    NOT public._event_meeting_sponsor_allowed(t, e1, s1::uuid, r3, r2),
    '61/F6/warunek: przed wpisem organizatora P3 nie jest powiazany z S1');
  PERFORM pg_temp.act_as('61a00000-0000-0000-0000-0000000000ad', t);
  PERFORM pg_temp.assert(
    public.admin_event_sponsor_contacts_set(jsonb_build_object(
      'sponsor_id', s1,
      'items', jsonb_build_array(
        jsonb_build_object('lead_id', '61100000-0000-0000-0000-000000000004', 'role', 'onsite'),
        jsonb_build_object('lead_id', '61100000-0000-0000-0000-000000000005', 'role', 'primary'),
        jsonb_build_object('lead_id', '61100000-0000-0000-0000-000000000003', 'role', 'onsite')))) = 3,
    '61/F6/organizator: dopisuje personel sponsora do listy osob kontaktowych');
  PERFORM pg_temp.act_as();
  v_res := pg_temp.msb_invite(3, 2, 12, s1);
  PERFORM pg_temp.assert(
    pg_temp.msb_sponsor_of(v_res) = s1::uuid AND v_res->>'sponsor_id' = s1,
    '61/F6/zaproszenie: osoba z listy organizatora (potwierdzone konto) przypina spotkanie do S1');
  PERFORM pg_temp.assert(
    NOT public._event_meeting_sponsor_allowed(t, e1, s1::uuid, r1, r2),
    '61/F6/helper: wpis organizatora dla P3 nie otwiera S1 dla P1 (adres L5 w profilu nadal bez znaczenia)');

  PERFORM pg_temp.assert(
    (SELECT count(*) FROM public.event_meetings m WHERE m.sponsor_id = s2::uuid) = 0
    AND (SELECT count(*) FROM public.event_meetings m WHERE m.sponsor_id = s1::uuid) = 3,
    '61/F6/AUDYT: raport S2 nadal bez podrobionych spotkan; S1 - dwa z sekcji 3 i jedno po wpisie organizatora');
END
$do$;

-- ---------------------------------------------------------------------------
-- SEKCJA 5: ORGANIZATOR ZAUFANY, PRZELOZENIE KOPIUJE JEGO PRZYPIECIE
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
-- SEKCJA 6: GRANTY
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
