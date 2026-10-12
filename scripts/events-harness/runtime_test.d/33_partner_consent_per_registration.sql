-- ============================================================================
-- 33 ZGODA PARTNERSKA PER ZGLOSZENIE (OPS-01) I EKSPORT LEADOW BEZ
--    TOZSAMOSCI OSOBY BEZ ZGODY (OPS-03)
--
-- PO CO TEN PLIK ISTNIEJE
-- Zgoda na przekazanie danych partnerom siedziala na osobie (jedna na
-- najemce), byla wiec globalna i lepka: zgoda przy A otwierala dane sponsorowi
-- B, a zapis na kolejne wydarzenie kasowal wycofanie. Migracje 20261012090000
-- (fundament), 20261012100000 (pisarze), 20261012100100 (czytelnicy),
-- 20261012100200 (lista zgloszen) i 20261012100300 (wycofanie) przenosza ja
-- na zgloszenie. Ten plik sprawdza:
--   * zgoda przy A i brak zgody przy B -> `_event_partner_consent_at` daje
--     stempel dla A i NULL dla B, a KAZDY czytelnik (eksport, lista panelu,
--     lista urzadzenia stoiskowego, link sponsora, podsumowanie, szereg,
--     historia firmy, statystyki na miejscu, lista zgloszen) widzi to samo;
--   * eksport leadow zeruje imie, nazwisko, firme, stanowisko, e-mail i telefon
--     wiersza bez zgody i zostawia je w wierszu ze zgoda; notatka sponsora
--     zostaje w obu (spojnie z linkiem i lista urzadzenia);
--   * wycofanie globalne i wycofanie w zgloszeniu -> zapis na C bez
--     zaznaczenia -> NULL dla A i C, a `consent_withdrawn_at` NIE jest
--     czyszczony; jawna ponowna zgoda przy C -> tylko C skuteczna, A zostaje
--     wycofana (wycofanie przeniesione na zgloszenie A);
--   * zgoda partnerska zaznaczona po wycofaniu, bez marketingu -> skuteczna dla
--     TEGO wydarzenia, wycofanie i stary stempel marketingu zostaja;
--   * samoobsluga po kluczu z maila i akcja organizatora (z wpisem audit_log)
--     wycofuja zgode, nie kasujac stempla nadania; bramki i granty;
--   * przyjecie zaproszenia z pakietu nie czysci wycofania.
--
-- CZAS. Plik biegnie w JEDNEJ transakcji, wiec `now()` stoi w miejscu.
-- `pg_temp.z33_age` przesuwa wszystkie stemple osoby o godzine wstecz - tak
-- kolejne kroki dzieja sie „pozniej" niz poprzednie, a najnowsze zgloszenie
-- (porzadek po `created_at`) jest jednoznaczne.
--
-- CZEGO NIE SPRAWDZA: odpowiedzi `event_lead_scan_record` (skan na stoisku) -
-- funkcje plaszczyzny skanera przepina osobny strumien i on dopisuje asercje
-- o niej. Leady sa tu wstawiane wprost, jak w 32_sponsor_report.
--
-- SPRZATANIE. Jedna transakcja zakonczona ROLLBACK-iem.
-- ============================================================================

\echo '== 33 zgoda partnerska per zgloszenie i eksport leadow =='

BEGIN;

-- ---------------------------------------------------------------------------
-- SEKCJA 1: SCENOGRAFIA
--
-- Najemca A = publiczny najemca harnessu (1111...), najemca B do izolacji.
-- a1 admin A, a2 konto uczestnika (bez roli), b1 admin B.
-- Wydarzenia A, B, C (zapisy bez biletow) i P (pakiet z zaproszeniem).
-- Jedna firma sponsoruje A i B - historia firmy musi rozdzielic zgody.
-- ---------------------------------------------------------------------------
INSERT INTO public.tenants (id, name, slug) VALUES
  ('33000000-0000-0000-0000-0000000000b0', 'Tenant B (zgoda 33)', 'tb-zgoda33');

INSERT INTO auth.users (id, email) VALUES
  ('33a00000-0000-0000-0000-0000000000a1', 'zgoda33.admin@example.org'),
  ('33a00000-0000-0000-0000-0000000000a2', 'zgoda33.konto@example.org'),
  ('33a00000-0000-0000-0000-0000000000b1', 'zgoda33.admin.b@example.org');

INSERT INTO public.user_roles (user_id, role) VALUES
  ('33a00000-0000-0000-0000-0000000000a1', 'admin');
INSERT INTO public.user_roles (user_id, role, tenant_id) VALUES
  ('33a00000-0000-0000-0000-0000000000b1', 'admin', '33000000-0000-0000-0000-0000000000b0');

INSERT INTO public.profiles (id, tenant_id) VALUES
  ('33a00000-0000-0000-0000-0000000000a1', '11111111-1111-1111-1111-111111111111'),
  ('33a00000-0000-0000-0000-0000000000a2', '11111111-1111-1111-1111-111111111111'),
  ('33a00000-0000-0000-0000-0000000000b1', '33000000-0000-0000-0000-0000000000b0')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.events
  (id, tenant_id, slug, title_pl, title_en, starts_at, timezone, status,
   registration_mode, registration_flow)
VALUES
  ('33e00000-0000-0000-0000-0000000000a1', '11111111-1111-1111-1111-111111111111',
   'zgoda33-a', 'Kongres A', 'Congress A', now() + interval '3 days', 'Europe/Warsaw',
   'published', 'rsvp', 'instant'),
  ('33e00000-0000-0000-0000-0000000000b1', '11111111-1111-1111-1111-111111111111',
   'zgoda33-b', 'Kongres B', 'Congress B', now() + interval '4 days', 'Europe/Warsaw',
   'published', 'rsvp', 'instant'),
  ('33e00000-0000-0000-0000-0000000000c1', '11111111-1111-1111-1111-111111111111',
   'zgoda33-c', 'Kongres C', 'Congress C', now() + interval '5 days', 'Europe/Warsaw',
   'published', 'rsvp', 'instant'),
  ('33e00000-0000-0000-0000-0000000000d1', '11111111-1111-1111-1111-111111111111',
   'zgoda33-p', 'Kongres P', 'Congress P', now() + interval '6 days', 'Europe/Warsaw',
   'published', 'form', 'instant');

INSERT INTO public.crm_companies (id, tenant_id, name) VALUES
  ('33c00000-0000-0000-0000-0000000000c1', '11111111-1111-1111-1111-111111111111', 'Sponsor 33')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.event_sponsors
  (id, tenant_id, event_id, company_id, role, is_published, snapshot_name)
VALUES
  ('33500000-0000-0000-0000-0000000000a1', '11111111-1111-1111-1111-111111111111',
   '33e00000-0000-0000-0000-0000000000a1', '33c00000-0000-0000-0000-0000000000c1',
   'partner', true, 'Sponsor przy A'),
  ('33500000-0000-0000-0000-0000000000b1', '11111111-1111-1111-1111-111111111111',
   '33e00000-0000-0000-0000-0000000000b1', '33c00000-0000-0000-0000-0000000000c1',
   'partner', true, 'Sponsor przy B');

-- Poswiadczenia stoiskowe (tylko odczyt listy leadow - leady wstawiamy wprost).
INSERT INTO public.event_scanner_devices
  (id, tenant_id, event_id, checkpoint_id, sponsor_id, label,
   token_hash, token_prefix, scopes, is_active, expires_at, revoked_at)
VALUES
  ('33d00000-0000-0000-0000-0000000000a1', '11111111-1111-1111-1111-111111111111',
   '33e00000-0000-0000-0000-0000000000a1', NULL, '33500000-0000-0000-0000-0000000000a1',
   'Stoisko A', encode(extensions.digest('tok-33-lead-a-0000001', 'sha256'), 'hex'),
   left('tok-33-lead-a-0000001', 8), ARRAY['lead']::text[], true, now() + interval '7 days', NULL),
  ('33d00000-0000-0000-0000-0000000000b1', '11111111-1111-1111-1111-111111111111',
   '33e00000-0000-0000-0000-0000000000b1', NULL, '33500000-0000-0000-0000-0000000000b1',
   'Stoisko B', encode(extensions.digest('tok-33-lead-b-0000001', 'sha256'), 'hex'),
   left('tok-33-lead-b-0000001', 8), ARRAY['lead']::text[], true, now() + interval '7 days', NULL);

CREATE TEMP TABLE z33_q (k text PRIMARY KEY, u uuid, t text) ON COMMIT DROP;

-- Zapis z formularza publicznego. Zgoda na przetwarzanie zawsze, partnerska
-- i marketingowa - tylko gdy jawnie zaznaczone.
CREATE FUNCTION pg_temp.z33_reg(_slug text, _email text, _first text,
                                _partner boolean, _marketing boolean)
RETURNS jsonb LANGUAGE sql AS $$
  SELECT public.event_register(jsonb_build_object(
    'event_slug', _slug, 'email', _email, 'first_name', _first, 'last_name', 'Zgodna',
    'phone', '+48 600 330 000', 'job_title', 'Analityk', 'company_text', 'Firma ' || _first,
    'consent_data_processing', true,
    'consent_partner_sharing', _partner,
    'consent_marketing', _marketing))
$$;

-- Uplyw czasu: wszystkie stemple osoby godzine wstecz.
CREATE FUNCTION pg_temp.z33_age(_person uuid) RETURNS void LANGUAGE sql AS $$
  UPDATE public.event_registrations
     SET created_at = created_at - interval '1 hour',
         consent_partner_sharing_at = consent_partner_sharing_at - interval '1 hour',
         consent_partner_withdrawn_at = consent_partner_withdrawn_at - interval '1 hour'
   WHERE tenant_id = '11111111-1111-1111-1111-111111111111' AND person_id = _person;
  UPDATE public.event_people
     SET consent_data_processing_at = consent_data_processing_at - interval '1 hour',
         consent_marketing_at = consent_marketing_at - interval '1 hour',
         consent_partner_sharing_at = consent_partner_sharing_at - interval '1 hour',
         consent_withdrawn_at = consent_withdrawn_at - interval '1 hour'
   WHERE tenant_id = '11111111-1111-1111-1111-111111111111' AND id = _person;
$$;

CREATE FUNCTION pg_temp.z33_consent(_event uuid, _person uuid) RETURNS timestamptz
LANGUAGE sql AS $$
  SELECT public._event_partner_consent_at('11111111-1111-1111-1111-111111111111', _event, _person)
$$;

CREATE FUNCTION pg_temp.z33(_k text) RETURNS uuid LANGUAGE sql AS $$
  SELECT u FROM z33_q WHERE k = _k
$$;

-- ---------------------------------------------------------------------------
-- SEKCJA 2: ZGODA PRZY A, BRAK ZGODY PRZY B
-- ---------------------------------------------------------------------------
SELECT pg_temp.act_as(NULL, NULL);
DO $do$
DECLARE
  v jsonb;
  v_person uuid;
BEGIN
  v := pg_temp.z33_reg('zgoda33-a', 'ola.33@example.org', 'Ola', true, false);
  v_person := (v->>'person_id')::uuid;
  INSERT INTO z33_q (k, u, t) VALUES
    ('ola', v_person, NULL),
    ('ola_a', (v->>'registration_id')::uuid, v->>'manage_token');
  PERFORM pg_temp.assert(
    (SELECT r.consent_partner_sharing_at = now() AND r.consent_partner_withdrawn_at IS NULL
       FROM public.event_registrations r WHERE r.id = pg_temp.z33('ola_a')),
    '33/zapis: jawnie zaznaczona zgoda partnerska trafia do ZGLOSZENIA (stempel now())');
  PERFORM pg_temp.z33_age(v_person);

  v := pg_temp.z33_reg('zgoda33-b', 'ola.33@example.org', 'Ola', false, false);
  INSERT INTO z33_q (k, u, t) VALUES ('ola_b', (v->>'registration_id')::uuid, v->>'manage_token');
  PERFORM pg_temp.assert((v->>'person_id')::uuid = v_person,
    '33/zapis: drugi zapis tym samym adresem trafia do TEJ SAMEJ osoby');
  PERFORM pg_temp.assert(
    (SELECT r.consent_partner_sharing_at IS NULL FROM public.event_registrations r
      WHERE r.id = pg_temp.z33('ola_b')),
    '33/zapis: bez zaznaczenia zgloszenie na B NIE ma zgody partnerskiej');
  PERFORM pg_temp.assert(
    pg_temp.z33_consent('33e00000-0000-0000-0000-0000000000a1', v_person) IS NOT NULL
    AND pg_temp.z33_consent('33e00000-0000-0000-0000-0000000000b1', v_person) IS NULL,
    '33/OPS-01: zgoda przy A -> stempel dla A, NULL dla B');
  -- Stempel osoby zostaje jako HISTORYCZNY dowod pierwszej zgody - i wlasnie
  -- dlatego nie wolno z niego rozstrzygac o B.
  PERFORM pg_temp.assert(
    (SELECT p.consent_partner_sharing_at IS NOT NULL FROM public.event_people p WHERE p.id = v_person),
    '33/zapis: historyczny stempel partnerski osoby zostaje (nie decyduje o niczym)');
END
$do$;

-- Leady: sponsor przy A i sponsor przy B zeskanowali Ole. Wstawione wprost
-- (patrz naglowek) - po jednym kontakcie z notatka obslugi stoiska.
INSERT INTO public.event_lead_scans
  (tenant_id, event_id, sponsor_id, person_id, registration_id, scanned_by_user_id,
   scan_count, interest_rating, note, consent_snapshot_at)
VALUES
  ('11111111-1111-1111-1111-111111111111', '33e00000-0000-0000-0000-0000000000a1',
   '33500000-0000-0000-0000-0000000000a1', pg_temp.z33('ola'), pg_temp.z33('ola_a'),
   '33a00000-0000-0000-0000-0000000000a1', 1, 4, 'Notatka stoiska A', now()),
  ('11111111-1111-1111-1111-111111111111', '33e00000-0000-0000-0000-0000000000b1',
   '33500000-0000-0000-0000-0000000000b1', pg_temp.z33('ola'), pg_temp.z33('ola_b'),
   '33a00000-0000-0000-0000-0000000000a1', 2, 5, 'Notatka stoiska B', NULL);

-- Panel organizatora: eksport, lista, raport, szereg, historia firmy, statystyki.
SELECT pg_temp.act_as('33a00000-0000-0000-0000-0000000000a1', '11111111-1111-1111-1111-111111111111');
DO $do$
DECLARE
  v_row record;
BEGIN
  -- OPS-03: wiersz bez zgody na TO wydarzenie nie niesie ZADNEJ danej osoby.
  SELECT * INTO v_row FROM public.admin_event_lead_scans_export('33e00000-0000-0000-0000-0000000000b1');
  PERFORM pg_temp.assert(
    NOT v_row.consent
    AND v_row.first_name IS NULL AND v_row.last_name IS NULL AND v_row.company IS NULL
    AND v_row.job_title IS NULL AND v_row.email IS NULL AND v_row.phone IS NULL,
    '33/OPS-03: eksport BEZ zgody - imie, nazwisko, firma, stanowisko, e-mail i telefon to NULL');
  PERFORM pg_temp.assert(
    v_row.sponsor_name = 'Sponsor przy B' AND v_row.note = 'Notatka stoiska B'
    AND v_row.interest_rating = 5 AND v_row.scan_count = 2 AND v_row.consent_snapshot_at IS NULL,
    '33/OPS-03: eksport bez zgody zostawia sponsora, ocene, notatke stoiska i liczniki');

  SELECT * INTO v_row FROM public.admin_event_lead_scans_export('33e00000-0000-0000-0000-0000000000a1');
  PERFORM pg_temp.assert(
    v_row.consent AND v_row.first_name = 'Ola' AND v_row.last_name = 'Zgodna'
    AND v_row.company = 'Firma Ola' AND v_row.job_title = 'Analityk'
    AND v_row.email = 'ola.33@example.org' AND v_row.phone = '+48 600 330 000',
    '33/OPS-03: eksport ZE zgoda na A oddaje komplet danych osoby');

  PERFORM pg_temp.assert(
    (SELECT NOT l.consent AND l.first_name = 'Ola'
       FROM public.admin_event_lead_scans_list('33e00000-0000-0000-0000-0000000000b1') l)
    AND (SELECT l.consent FROM public.admin_event_lead_scans_list('33e00000-0000-0000-0000-0000000000a1') l),
    '33/panel: lista leadow organizatora - flaga zgody per wydarzenie (dane osoby zostaja dla administratora)');

  PERFORM pg_temp.assert(
    (SELECT s.leads_total = 1 AND s.leads_consented = 0
       FROM public.admin_event_sponsor_report_summary('33e00000-0000-0000-0000-0000000000b1') s)
    AND (SELECT s.leads_total = 1 AND s.leads_consented = 1
       FROM public.admin_event_sponsor_report_summary('33e00000-0000-0000-0000-0000000000a1') s),
    '33/raport: podsumowanie liczy zgody per wydarzenie (B: 0 z 1, A: 1 z 1)');
  PERFORM pg_temp.assert(
    (SELECT sum(x.leads_new) = 1 AND sum(x.leads_new_consented) = 0
       FROM public.admin_event_sponsor_report_leads_series('33e00000-0000-0000-0000-0000000000b1') x)
    AND (SELECT sum(x.leads_new_consented) = 1
       FROM public.admin_event_sponsor_report_leads_series('33e00000-0000-0000-0000-0000000000a1') x),
    '33/raport: szereg kontaktow liczy zgody per wydarzenie');
  PERFORM pg_temp.assert(
    (SELECT h.leads_total = 1 AND h.leads_consented = 0
       FROM public.admin_event_company_sponsorships('33c00000-0000-0000-0000-0000000000c1') h
      WHERE h.event_id = '33e00000-0000-0000-0000-0000000000b1')
    AND (SELECT h.leads_consented = 1
       FROM public.admin_event_company_sponsorships('33c00000-0000-0000-0000-0000000000c1') h
      WHERE h.event_id = '33e00000-0000-0000-0000-0000000000a1'),
    '33/CRM: historia sponsoringu firmy rozdziela zgody A i B tej samej osoby');
  PERFORM pg_temp.assert(
    (public.admin_event_onsite_stats('33e00000-0000-0000-0000-0000000000b1')->>'lead_scans_with_consent')::int = 0
    AND (public.admin_event_onsite_stats('33e00000-0000-0000-0000-0000000000a1')->>'lead_scans_with_consent')::int = 1,
    '33/na miejscu: statystyki licza leady ze zgoda per wydarzenie');

  -- Lista zgloszen (i CSV uczestnikow) pokazuje zgode Z TEGO zgloszenia.
  PERFORM pg_temp.assert(
    (SELECT r.consent_partner_sharing_at IS NULL AND r.consent_partner_withdrawn_at IS NULL
       FROM public.admin_event_registrations_list('33e00000-0000-0000-0000-0000000000b1') r
      WHERE r.id = pg_temp.z33('ola_b'))
    AND (SELECT r.consent_partner_sharing_at IS NOT NULL AND r.consent_partner_withdrawn_at IS NULL
       FROM public.admin_event_registrations_list('33e00000-0000-0000-0000-0000000000a1') r
      WHERE r.id = pg_temp.z33('ola_a')),
    '33/panel: lista zgloszen oddaje zgode partnerska zgloszenia, nie osoby');

  INSERT INTO z33_q (k, u, t)
  SELECT 'link_' || x.k, (v->>'id')::uuid, v->>'token'
    FROM (VALUES ('a', '33500000-0000-0000-0000-0000000000a1'),
                 ('b', '33500000-0000-0000-0000-0000000000b1')) AS x(k, sponsor),
         LATERAL (SELECT public.admin_event_sponsor_report_link_issue(jsonb_build_object(
           'sponsor_id', x.sponsor, 'label', 'Raport 33 ' || x.k, 'include_leads', true)) AS v) l;
END
$do$;

-- Plaszczyzna urzadzenia stoiskowego i link sponsora (bez konta).
SELECT pg_temp.act_as(NULL, NULL);
DO $do$
DECLARE
  v jsonb;
  v_row jsonb;
BEGIN
  v := public.event_lead_scans_list(jsonb_build_object('device_token', 'tok-33-lead-b-0000001'));
  v_row := v->'rows'->0;
  PERFORM pg_temp.assert(
    (v->>'total_count')::int = 1 AND (v->>'with_consent_count')::int = 0
    AND NOT (v_row->>'consent')::boolean
    AND v_row->'first_name' = 'null'::jsonb AND v_row->'email' = 'null'::jsonb
    AND v_row->'company' = 'null'::jsonb AND v_row->'phone' = 'null'::jsonb
    AND v_row->>'note' = 'Notatka stoiska B',
    '33/stoisko B: lead osoby ze zgoda TYLKO przy A jest policzony, ale bez danych osoby');
  v := public.event_lead_scans_list(jsonb_build_object('device_token', 'tok-33-lead-a-0000001'));
  PERFORM pg_temp.assert(
    (v->>'with_consent_count')::int = 1 AND v->'rows'->0->>'email' = 'ola.33@example.org',
    '33/stoisko A: przy zgodzie na A sponsor A dostaje kontakt');

  v := public.event_sponsor_report_for_token('11111111-1111-1111-1111-111111111111',
                                             (SELECT t FROM z33_q WHERE k = 'link_b'));
  v_row := v->'leads'->0;
  PERFORM pg_temp.assert(
    (v->>'ok')::boolean
    AND (v#>>'{totals,leads_total}')::int = 1 AND (v#>>'{totals,leads_consented}')::int = 0
    AND NOT (v_row->>'consent')::boolean
    AND v_row->'first_name' = 'null'::jsonb AND v_row->'last_name' = 'null'::jsonb
    AND v_row->'email' = 'null'::jsonb AND v_row->'job_title' = 'null'::jsonb
    AND v_row->>'note' = 'Notatka stoiska B',
    '33/link B: licznik zgod 0 i wiersz bez danych osoby mimo zgody przy A');
  v := public.event_sponsor_report_for_token('11111111-1111-1111-1111-111111111111',
                                             (SELECT t FROM z33_q WHERE k = 'link_a'));
  PERFORM pg_temp.assert(
    (v#>>'{totals,leads_consented}')::int = 1 AND v->'leads'->0->>'email' = 'ola.33@example.org',
    '33/link A: zgoda na A oddaje kontakt sponsorowi A');

  PERFORM pg_temp.assert(
    (public.event_registration_manage_view(jsonb_build_object(
       'manage_token', (SELECT t FROM z33_q WHERE k = 'ola_a')))->>'partner_consent')::boolean
    AND NOT (public.event_registration_manage_view(jsonb_build_object(
       'manage_token', (SELECT t FROM z33_q WHERE k = 'ola_b')))->>'partner_consent')::boolean,
    '33/samoobsluga: strona zgloszenia zna stan zgody partnerskiej na SWOJE wydarzenie');
END
$do$;

-- ---------------------------------------------------------------------------
-- SEKCJA 3: WYCOFANIE GLOBALNE -> ZAPIS NA C BEZ ZAZNACZENIA -> PONOWNA ZGODA
-- ---------------------------------------------------------------------------
DO $do$
DECLARE
  v jsonb;
  v_person uuid := pg_temp.z33('ola');
  v_withdrawn timestamptz;
  v_marketing timestamptz;
BEGIN
  PERFORM pg_temp.z33_age(v_person);
  UPDATE public.event_people SET consent_withdrawn_at = now() WHERE id = v_person;
  PERFORM pg_temp.z33_age(v_person);
  SELECT p.consent_withdrawn_at INTO v_withdrawn FROM public.event_people p WHERE p.id = v_person;

  PERFORM pg_temp.assert(
    pg_temp.z33_consent('33e00000-0000-0000-0000-0000000000a1', v_person) IS NULL,
    '33/wycofanie: globalne wycofanie zgod gasi zgode przy A');
  PERFORM pg_temp.assert(
    (public.event_lead_scans_list(jsonb_build_object('device_token', 'tok-33-lead-a-0000001'))
       ->>'with_consent_count')::int = 0,
    '33/wycofanie: dziala WSTECZ na juz zebrany lead przy A');

  v := pg_temp.z33_reg('zgoda33-c', 'ola.33@example.org', 'Ola', false, false);
  INSERT INTO z33_q (k, u, t) VALUES ('ola_c', (v->>'registration_id')::uuid, v->>'manage_token');
  PERFORM pg_temp.assert(
    (SELECT p.consent_withdrawn_at = v_withdrawn AND p.consent_marketing_at IS NULL
       FROM public.event_people p WHERE p.id = v_person),
    '33/OPS-01: zapis na C BEZ zaznaczenia NIE czysci wycofania zgod (byl lepki reset)');
  PERFORM pg_temp.assert(
    pg_temp.z33_consent('33e00000-0000-0000-0000-0000000000a1', v_person) IS NULL
    AND pg_temp.z33_consent('33e00000-0000-0000-0000-0000000000c1', v_person) IS NULL,
    '33/OPS-01: wycofanie -> zapis na C -> brak zgody dla A i dla C');

  -- Jawna ponowna zgoda przy C: odwolanie udzialu, ponowny zapis z
  -- zaznaczonym marketingiem i zgoda partnerska.
  PERFORM pg_temp.z33_age(v_person);
  PERFORM public.event_registration_cancel(jsonb_build_object(
    'manage_token', (SELECT t FROM z33_q WHERE k = 'ola_c')));
  PERFORM pg_temp.z33_age(v_person);
  SELECT p.consent_withdrawn_at INTO v_withdrawn FROM public.event_people p WHERE p.id = v_person;

  v := pg_temp.z33_reg('zgoda33-c', 'ola.33@example.org', 'Ola', true, true);
  INSERT INTO z33_q (k, u, t) VALUES ('ola_c2', (v->>'registration_id')::uuid, v->>'manage_token');
  SELECT p.consent_marketing_at INTO v_marketing FROM public.event_people p WHERE p.id = v_person;
  PERFORM pg_temp.assert(
    (SELECT p.consent_withdrawn_at IS NULL FROM public.event_people p WHERE p.id = v_person)
    AND v_marketing = now(),
    '33/ponowna zgoda: zaznaczony marketing czysci wycofanie i daje SWIEZY stempel marketingu');
  PERFORM pg_temp.assert(
    (SELECT r.consent_partner_withdrawn_at = v_withdrawn
            AND r.consent_partner_sharing_at < r.consent_partner_withdrawn_at
       FROM public.event_registrations r WHERE r.id = pg_temp.z33('ola_a')),
    '33/ponowna zgoda: wycofanie osoby przeniesione na zgloszenie A przed wyczyszczeniem (nadanie zostaje)');
  PERFORM pg_temp.assert(
    pg_temp.z33_consent('33e00000-0000-0000-0000-0000000000c1', v_person) = now()
    AND pg_temp.z33_consent('33e00000-0000-0000-0000-0000000000a1', v_person) IS NULL
    AND pg_temp.z33_consent('33e00000-0000-0000-0000-0000000000b1', v_person) IS NULL,
    '33/ponowna zgoda: skuteczna TYLKO przy C; A zostaje wycofana, B bez zgody');

  PERFORM pg_temp.act_as('33a00000-0000-0000-0000-0000000000a1', '11111111-1111-1111-1111-111111111111');
  PERFORM pg_temp.assert(
    (SELECT NOT x.consent AND x.email IS NULL AND x.first_name IS NULL
       FROM public.admin_event_lead_scans_export('33e00000-0000-0000-0000-0000000000a1') x),
    '33/ponowna zgoda: eksport A nadal bez danych osoby (zgoda przy C nie otwiera A)');
  PERFORM pg_temp.assert(
    (SELECT r.consent_partner_withdrawn_at IS NOT NULL
       FROM public.admin_event_registrations_list('33e00000-0000-0000-0000-0000000000a1') r
      WHERE r.id = pg_temp.z33('ola_a')),
    '33/panel: lista zgloszen pokazuje wycofanie zgody partnerskiej zgloszenia A');
  PERFORM pg_temp.act_as(NULL, NULL);
END
$do$;

-- Zgoda partnerska zaznaczona PO wycofaniu, bez marketingu: skuteczna dla
-- TEGO wydarzenia, a wycofanie i stary stempel marketingu zostaja.
DO $do$
DECLARE
  v jsonb;
  v_person uuid;
  v_marketing timestamptz;
  v_withdrawn timestamptz;
BEGIN
  v := pg_temp.z33_reg('zgoda33-a', 'ewa.33@example.org', 'Ewa', true, true);
  v_person := (v->>'person_id')::uuid;
  INSERT INTO z33_q (k, u, t) VALUES ('ewa', v_person, NULL),
    ('ewa_a', (v->>'registration_id')::uuid, v->>'manage_token');
  PERFORM pg_temp.z33_age(v_person);
  UPDATE public.event_people SET consent_withdrawn_at = now() WHERE id = v_person;
  PERFORM pg_temp.z33_age(v_person);
  SELECT p.consent_marketing_at, p.consent_withdrawn_at INTO v_marketing, v_withdrawn
    FROM public.event_people p WHERE p.id = v_person;

  v := pg_temp.z33_reg('zgoda33-b', 'ewa.33@example.org', 'Ewa', true, false);
  INSERT INTO z33_q (k, u, t) VALUES ('ewa_b', (v->>'registration_id')::uuid, v->>'manage_token');
  PERFORM pg_temp.assert(
    pg_temp.z33_consent('33e00000-0000-0000-0000-0000000000b1', v_person) = now()
    AND pg_temp.z33_consent('33e00000-0000-0000-0000-0000000000a1', v_person) IS NULL,
    '33/zgoda po wycofaniu: jawna zgoda przy B skuteczna dla B, A zostaje wycofana');
  PERFORM pg_temp.assert(
    (SELECT p.consent_withdrawn_at = v_withdrawn AND p.consent_marketing_at = v_marketing
       FROM public.event_people p WHERE p.id = v_person),
    '33/zgoda po wycofaniu: bez marketingu wycofanie i stary stempel marketingu zostaja (CRM nie widzi zgody)');

  -- Przeniesienie wycofania wprost: dotyka tylko zgloszenia ze zgoda sprzed
  -- wycofania (A), zgoda pozniejsza (B) zostaje nietknieta.
  PERFORM pg_temp.z33_age(v_person);
  -- Wynik funkcji osobno: zmiany funkcji VOLATILE nie sa widoczne dla
  -- podzapytan TEGO SAMEGO wyrazenia (jedna migawka polecenia).
  v := to_jsonb(public._event_partner_consent_carry_withdrawal(
         '11111111-1111-1111-1111-111111111111', v_person));
  PERFORM pg_temp.assert(
    v = to_jsonb(1)
    AND (SELECT r.consent_partner_withdrawn_at IS NOT NULL FROM public.event_registrations r
          WHERE r.id = pg_temp.z33('ewa_a'))
    AND (SELECT r.consent_partner_withdrawn_at IS NULL FROM public.event_registrations r
          WHERE r.id = pg_temp.z33('ewa_b'))
    AND pg_temp.z33_consent('33e00000-0000-0000-0000-0000000000b1', v_person) IS NOT NULL,
    '33/przeniesienie: wycofanie trafia tylko na zgode sprzed niego (A), zgoda B zostaje');
  PERFORM pg_temp.assert(
    public._event_partner_consent_carry_withdrawal('11111111-1111-1111-1111-111111111111', v_person) = 0,
    '33/przeniesienie: powtorzenie nic nie zmienia');
END
$do$;

-- ---------------------------------------------------------------------------
-- SEKCJA 4: SAMOOBSLUGA - WYCOFANIE PO KLUCZU Z MAILA I Z KONTA
-- ---------------------------------------------------------------------------
DO $do$
DECLARE
  v jsonb;
  v_person uuid;
  v_token text;
  v_granted timestamptz;
BEGIN
  v := pg_temp.z33_reg('zgoda33-a', 'piotr.33@example.org', 'Piotr', true, false);
  v_person := (v->>'person_id')::uuid;
  v_token := v->>'manage_token';
  INSERT INTO z33_q (k, u, t) VALUES ('piotr', v_person, NULL),
    ('piotr_a', (v->>'registration_id')::uuid, v_token);
  PERFORM pg_temp.z33_age(v_person);
  SELECT r.consent_partner_sharing_at INTO v_granted
    FROM public.event_registrations r WHERE r.id = pg_temp.z33('piotr_a');

  v := public.event_registration_partner_consent_withdraw(jsonb_build_object('manage_token', v_token));
  PERFORM pg_temp.assert(
    (v->>'ok')::boolean AND (v->>'withdrawn')::boolean AND NOT (v->>'partner_consent')::boolean
    AND (v->>'registration_id')::uuid = pg_temp.z33('piotr_a'),
    '33/samoobsluga: klucz z maila wycofuje zgode partnerska jednym wywolaniem');
  PERFORM pg_temp.assert(
    (SELECT r.consent_partner_sharing_at = v_granted AND r.consent_partner_withdrawn_at = now()
       FROM public.event_registrations r WHERE r.id = pg_temp.z33('piotr_a')),
    '33/samoobsluga: wycofanie stempluje consent_partner_withdrawn_at, stempel nadania zostaje');
  PERFORM pg_temp.assert(
    pg_temp.z33_consent('33e00000-0000-0000-0000-0000000000a1', v_person) IS NULL
    AND NOT (public.event_registration_manage_view(jsonb_build_object('manage_token', v_token))
               ->>'partner_consent')::boolean,
    '33/samoobsluga: po wycofaniu brak zgody dla A, strona zgloszenia to widzi');
  v := public.event_registration_partner_consent_withdraw(jsonb_build_object('manage_token', v_token));
  PERFORM pg_temp.assert((v->>'ok')::boolean AND NOT (v->>'withdrawn')::boolean,
    '33/samoobsluga: powtorne wycofanie jest bezpieczne (withdrawn = false)');

  -- Wycofanie w zgloszeniu -> zapis na C bez zaznaczenia -> brak zgody dla A i C.
  PERFORM pg_temp.z33_age(v_person);
  v := pg_temp.z33_reg('zgoda33-c', 'piotr.33@example.org', 'Piotr', false, false);
  INSERT INTO z33_q (k, u, t) VALUES ('piotr_c', (v->>'registration_id')::uuid, v->>'manage_token');
  PERFORM pg_temp.assert(
    pg_temp.z33_consent('33e00000-0000-0000-0000-0000000000a1', v_person) IS NULL
    AND pg_temp.z33_consent('33e00000-0000-0000-0000-0000000000c1', v_person) IS NULL,
    '33/OPS-01: wycofanie w zgloszeniu A -> zapis na C -> brak zgody dla A i C');

  -- Jawna ponowna zgoda przy C: tylko C, wycofanie A zostaje.
  PERFORM pg_temp.z33_age(v_person);
  PERFORM public.event_registration_cancel(jsonb_build_object(
    'manage_token', (SELECT t FROM z33_q WHERE k = 'piotr_c')));
  PERFORM pg_temp.z33_age(v_person);
  v := pg_temp.z33_reg('zgoda33-c', 'piotr.33@example.org', 'Piotr', true, false);
  PERFORM pg_temp.assert(
    pg_temp.z33_consent('33e00000-0000-0000-0000-0000000000c1', v_person) = now()
    AND pg_temp.z33_consent('33e00000-0000-0000-0000-0000000000a1', v_person) IS NULL,
    '33/ponowna zgoda: po wycofaniu w zgloszeniu A tylko C jest skuteczna');
END
$do$;

SELECT pg_temp.assert_raises_like($q$
  SELECT public.event_registration_partner_consent_withdraw(
    jsonb_build_object('manage_token', 'ZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZ'))
$q$, 'not_found', '33/samoobsluga: nieznany klucz - not_found');
SELECT pg_temp.assert_raises_like($q$
  SELECT public.event_registration_partner_consent_withdraw('{}'::jsonb)
$q$, 'invalid_request', '33/samoobsluga: pusty ladunek odrzucony');
SELECT pg_temp.assert_raises_like(format($q$
  SELECT public.event_registration_partner_consent_withdraw(jsonb_build_object('registration_id', %L))
$q$, pg_temp.z33('ola_c2')), 'forbidden',
  '33/samoobsluga: sam identyfikator zgloszenia bez klucza i bez konta osoby - odmowa');

-- Zgloszenie z konta: wlasciciel wycofuje po identyfikatorze, inne konto nie.
SELECT pg_temp.act_as('33a00000-0000-0000-0000-0000000000a2', '11111111-1111-1111-1111-111111111111');
DO $do$
DECLARE
  v jsonb;
BEGIN
  v := pg_temp.z33_reg('zgoda33-b', 'kamil.33@example.org', 'Kamil', true, false);
  INSERT INTO z33_q (k, u, t) VALUES ('kamil_b', (v->>'registration_id')::uuid, NULL);
  PERFORM pg_temp.z33_age((v->>'person_id')::uuid);
  v := public.event_registration_partner_consent_withdraw(
    jsonb_build_object('registration_id', pg_temp.z33('kamil_b')));
  PERFORM pg_temp.assert((v->>'withdrawn')::boolean,
    '33/samoobsluga: wlasciciel konta wycofuje zgode po identyfikatorze zgloszenia');
END
$do$;
SELECT pg_temp.act_as('33a00000-0000-0000-0000-0000000000a1', '11111111-1111-1111-1111-111111111111');
SELECT pg_temp.assert_raises_like(format($q$
  SELECT public.event_registration_partner_consent_withdraw(jsonb_build_object('registration_id', %L))
$q$, pg_temp.z33('kamil_b')), 'forbidden',
  '33/samoobsluga: cudze konto (nawet administratora) nie wycofuje zgody po identyfikatorze');

-- ---------------------------------------------------------------------------
-- SEKCJA 5: WYCOFANIE Z PANELU ORGANIZATORA
-- ---------------------------------------------------------------------------
DO $do$
DECLARE
  v jsonb;
BEGIN
  v := public.admin_event_registration_partner_consent_withdraw(pg_temp.z33('ewa_b'));
  PERFORM pg_temp.assert(
    (v->>'withdrawn')::boolean AND NOT (v->>'partner_consent')::boolean
    AND pg_temp.z33_consent('33e00000-0000-0000-0000-0000000000b1', pg_temp.z33('ewa')) IS NULL,
    '33/panel: organizator wycofuje zgode partnerska uczestnika na jego prosbe');
  PERFORM pg_temp.assert(
    (SELECT count(*) FROM public.audit_log a
      WHERE a.entity_type = 'event_registration' AND a.entity_id = pg_temp.z33('ewa_b')
        AND a.action = 'event.registration.partner_consent_withdrawn'
        AND a.actor_id = '33a00000-0000-0000-0000-0000000000a1'
        AND a.metadata->>'by' = 'organizer') = 1,
    '33/panel: wycofanie w czyims imieniu zostawia wpis audit_log z aktorem');
  v := public.admin_event_registration_partner_consent_withdraw(pg_temp.z33('ewa_b'));
  PERFORM pg_temp.assert(
    NOT (v->>'withdrawn')::boolean
    AND (SELECT count(*) FROM public.audit_log a
          WHERE a.entity_id = pg_temp.z33('ewa_b')
            AND a.action = 'event.registration.partner_consent_withdrawn') = 1,
    '33/panel: powtorzenie nie zmienia stanu i nie dubluje wpisu');
END
$do$;

SELECT pg_temp.act_as('33a00000-0000-0000-0000-0000000000a2', '11111111-1111-1111-1111-111111111111');
SELECT pg_temp.assert_raises_like(format($q$
  SELECT public.admin_event_registration_partner_consent_withdraw(%L)
$q$, pg_temp.z33('ola_c2')), 'forbidden', '33/panel: konto bez roli nie wycofuje zgody z panelu');

SELECT pg_temp.act_as('33a00000-0000-0000-0000-0000000000b1', '33000000-0000-0000-0000-0000000000b0');
SELECT pg_temp.assert_raises_like(format($q$
  SELECT public.admin_event_registration_partner_consent_withdraw(%L)
$q$, pg_temp.z33('ola_c2')), 'not_found', '33/IZOLACJA: administrator innego najemcy nie widzi zgloszenia');
SELECT pg_temp.assert(
  pg_temp.z33_consent('33e00000-0000-0000-0000-0000000000c1', pg_temp.z33('ola')) IS NOT NULL,
  '33/IZOLACJA: odmowy nie zmienily zgody przy C');

-- ---------------------------------------------------------------------------
-- SEKCJA 6: PRZYJECIE ZAPROSZENIA Z PAKIETU NIE CZYSCI WYCOFANIA
-- ---------------------------------------------------------------------------
INSERT INTO public.event_ticket_types (id, tenant_id, event_id, key, name_pl, name_en)
VALUES ('33700000-0000-0000-0000-0000000000d1', '11111111-1111-1111-1111-111111111111',
        '33e00000-0000-0000-0000-0000000000d1', 'pakietowy', 'Pakietowy', 'Package');
INSERT INTO public.event_ticket_packages
  (id, tenant_id, event_id, ticket_type_id, key, name_pl, name_en, seats)
VALUES ('33900000-0000-0000-0000-0000000000d1', '11111111-1111-1111-1111-111111111111',
        '33e00000-0000-0000-0000-0000000000d1', '33700000-0000-0000-0000-0000000000d1',
        'firma', 'Pakiet firmowy', 'Company package', 2);
INSERT INTO public.event_package_orders
  (id, tenant_id, event_id, package_id, buyer_email, seats_total, status, paid_at)
VALUES ('33800000-0000-0000-0000-0000000000d1', '11111111-1111-1111-1111-111111111111',
        '33e00000-0000-0000-0000-0000000000d1', '33900000-0000-0000-0000-0000000000d1',
        'kupujacy.33@example.org', 2, 'paid', now());
INSERT INTO public.event_package_seats
  (id, tenant_id, event_id, package_order_id, invite_email, invite_token_hash)
VALUES ('33600000-0000-0000-0000-0000000000d1', '11111111-1111-1111-1111-111111111111',
        '33e00000-0000-0000-0000-0000000000d1', '33800000-0000-0000-0000-0000000000d1',
        'ewa.33@example.org',
        encode(extensions.digest('zaproszenie-33-ewa-000000001', 'sha256'), 'hex'));

SELECT pg_temp.act_as(NULL, NULL);

-- DEFEKTY ZASTANE (poza zakresem OPS-01): `event_package_invite_accept` od
-- 20260827221214 pada przy KAZDYM wywolaniu (23514), na dwoch ograniczeniach:
--   1. zapisuje `source = 'package_invitation'`, czego nie dopuszczaja
--      `event_registrations_source_values` ani `event_people_source_values`
--      (20260824085456);
--   2. zuzywajac zaproszenie zeruje `invite_token_hash`, a zostawia
--      `invite_email` - lamie `event_package_seats_invite_pair`.
-- Wpisy rejestru zapala sie na czerwono w dniu naprawy; do tego czasu zgody
-- sprawdzamy po zdjeciu obu ograniczen w tej (wycofywanej) transakcji.
CREATE FUNCTION pg_temp.z33_invite_error() RETURNS text LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    PERFORM public.event_package_invite_accept(jsonb_build_object(
      'token', 'zaproszenie-33-ewa-000000001', 'first_name', 'Ewa', 'last_name', 'Zgodna',
      'consent_data_processing', true));
  EXCEPTION WHEN check_violation THEN
    RETURN SQLERRM;
  END;
  RETURN NULL;
END
$$;
SELECT pg_temp.assert_known_defect(
  pg_temp.z33_invite_error() LIKE '%event_registrations_source_values%',
  '33/pakiet: event_package_invite_accept zapisuje source spoza event_registrations_source_values',
  'dopisac package_invitation do ograniczen zrodla zgloszenia i osoby albo zapisywac invitation');
ALTER TABLE public.event_registrations DROP CONSTRAINT event_registrations_source_values;
SELECT pg_temp.assert_known_defect(
  pg_temp.z33_invite_error() LIKE '%event_package_seats_invite_pair%',
  '33/pakiet: event_package_invite_accept zeruje invite_token_hash bez invite_email (event_package_seats_invite_pair)',
  'zuzycie zaproszenia ma zerowac obie kolumny pary albo ograniczenie ma dopuszczac zuzyte zaproszenie');
ALTER TABLE public.event_package_seats DROP CONSTRAINT event_package_seats_invite_pair;

DO $do$
DECLARE
  v jsonb;
  v_person uuid := pg_temp.z33('ewa');
  v_withdrawn timestamptz;
BEGIN
  SELECT p.consent_withdrawn_at INTO v_withdrawn FROM public.event_people p WHERE p.id = v_person;
  PERFORM pg_temp.assert(v_withdrawn IS NOT NULL,
    '33/pakiet: osoba z zaproszenia ma wycofanie zgod przed przyjeciem');
  v := public.event_package_invite_accept(jsonb_build_object(
    'token', 'zaproszenie-33-ewa-000000001', 'first_name', 'Ewa', 'last_name', 'Zgodna',
    'consent_data_processing', true));
  PERFORM pg_temp.assert(
    (SELECT p.consent_withdrawn_at = v_withdrawn FROM public.event_people p WHERE p.id = v_person),
    '33/pakiet: przyjecie zaproszenia NIE czysci wycofania zgod (byl lepki reset)');
  PERFORM pg_temp.assert(
    (SELECT r.consent_partner_sharing_at IS NULL FROM public.event_registrations r
      WHERE r.id = (v->>'registration_id')::uuid)
    AND pg_temp.z33_consent('33e00000-0000-0000-0000-0000000000d1', v_person) IS NULL,
    '33/pakiet: zgloszenie z zaproszenia nie ma zgody partnerskiej');
END
$do$;

-- ---------------------------------------------------------------------------
-- SEKCJA 7: GRANTY
-- ---------------------------------------------------------------------------
SELECT pg_temp.assert(
  NOT has_function_privilege('anon', 'public._event_partner_consent_carry_withdrawal(uuid, uuid)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public._event_partner_consent_carry_withdrawal(uuid, uuid)', 'EXECUTE')
  AND has_function_privilege('service_role', 'public._event_partner_consent_carry_withdrawal(uuid, uuid)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public._event_partner_consent_at(uuid, uuid, uuid)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public._event_partner_consent_at(uuid, uuid, uuid)', 'EXECUTE'),
  '33/granty: funkcje pomocnicze zgody wylacznie dla service_role');
SELECT pg_temp.assert(
  has_function_privilege('anon', 'public.event_registration_partner_consent_withdraw(jsonb)', 'EXECUTE')
  AND has_function_privilege('authenticated', 'public.event_registration_partner_consent_withdraw(jsonb)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.admin_event_registration_partner_consent_withdraw(uuid)', 'EXECUTE')
  AND has_function_privilege('authenticated', 'public.admin_event_registration_partner_consent_withdraw(uuid)', 'EXECUTE'),
  '33/granty: samoobsluga dla goscia (klucz z maila), akcja panelu tylko dla zalogowanych z bramka roli');
SELECT pg_temp.assert(
  NOT has_function_privilege('anon',
    'public.admin_event_registrations_list(uuid, text, uuid, uuid, text, timestamptz, timestamptz, integer, integer)', 'EXECUTE')
  AND has_function_privilege('authenticated',
    'public.admin_event_registrations_list(uuid, text, uuid, uuid, text, timestamptz, timestamptz, integer, integer)', 'EXECUTE')
  AND (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public' AND p.proname = 'admin_event_registrations_list') = 1,
  '33/granty: lista zgloszen po zmianie wyniku ma te same ACL i jedna sygnature');

SELECT pg_temp.act_as(NULL, NULL);

ROLLBACK;

\echo '== 33 zgoda partnerska: koniec =='
