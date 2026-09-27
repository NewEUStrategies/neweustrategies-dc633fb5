-- ============================================================================
-- 32 RAPORT DLA SPONSOROW - pomiar, raport w studiu, link dla sponsora, CRM
--
-- Migracja `20260927000500_event_sponsor_report` (funkcja f6). Plik sprawdza:
--   * NAPRAWE reklam strony glownej na PRODUKCYJNEJ definicji
--     `current_tenant_id()` (profil zalogowanego - NULL dla goscia): atrapa
--     harnessu robi `COALESCE(_caller_tenant(), public_tenant_id())`, wiec
--     stare ciala przechodzily tu na zielono, a na produkcji gosc nie widzial
--     ani jednej reklamy. Sekcja 2 podmienia atrape na czas asercji;
--   * `event_sponsors_public` oddaje ustawienie linku logotypu;
--   * zapis reklamy ze sponsorem i liczniki panelu z obu tabel;
--   * zapis ekspozycji (`event_sponsor_exposure_ingest`): weryfikacja kazdej
--     pozycji wzgledem TEGO wydarzenia, deduplikacja per sesja x dzien,
--     limit trafien, odmowy bez bledu, granty i brak dostepu klienckiego;
--   * raport w studiu (podsumowanie, szeregi) z filtrami i bramkami rol;
--   * linki dla sponsora: wydanie, skrot i prefiks, walidacja, limit,
--     odczyt po tokenie (licznik otwarc, kontakty tylko z ZYWA zgoda),
--     wpisy osi czasu CRM firmy, zdarzenia domenowe, odwolanie, wygasniecie;
--   * CRM: historia sponsoringu firmy i przeniesienie kontaktow przez most
--     (nowy kontakt tylko ze zgoda marketingowa organizatora);
--   * retencje i kaskady.
--
-- CZEGO NIE SPRAWDZA: endpointu HTTP (limit IP, filtr botow) i bramki zgody
-- po stronie przegladarki - to testy vitest (`-sponsor-event.test.ts`,
-- `sponsorTracking.test.ts`).
--
-- SPRZATANIE. Jedna transakcja zakonczona ROLLBACK-iem (takze podmiana
-- atrapy `current_tenant_id()` w sekcji 2 - DDL w PostgreSQL jest
-- transakcyjny).
-- ============================================================================

\echo '== 32 raport dla sponsorow =='

BEGIN;

-- ---------------------------------------------------------------------------
-- SEKCJA 1: SCENOGRAFIA
--
-- Najemca A = publiczny najemca harnessu (1111...), najemca B nowy.
-- a1 admin A, a2 redaktor A, a3 uczestnik A bez roli, b1 admin B.
-- Wydarzenia: E1 opublikowane (A), E2 szkic (A), EB opublikowane (B).
-- Sponsorzy E1: S1 (sponsor z poziomem, opublikowany), S2 (partner,
-- opublikowany), S3 (partner, NIEopublikowany); S4 na szkicu E2; SB na EB.
-- Osoby: P1 (obie zgody), P2 (bez zgod), P3 (zgody WYCOFANE, istniejacy
-- kontakt CRM), P4 (bez e-maila, zgoda na przekazanie partnerowi).
-- ---------------------------------------------------------------------------
INSERT INTO public.tenants (id, name, slug) VALUES
  ('32000000-0000-0000-0000-0000000000b0', 'Tenant B (raport sponsora)', 'tb-spr');

INSERT INTO auth.users (id, email) VALUES
  ('32a00000-0000-0000-0000-0000000000a1', 'spr.admin.a@example.org'),
  ('32a00000-0000-0000-0000-0000000000a2', 'spr.editor.a@example.org'),
  ('32a00000-0000-0000-0000-0000000000a3', 'spr.member.a@example.org'),
  ('32a00000-0000-0000-0000-0000000000b1', 'spr.admin.b@example.org');

INSERT INTO public.user_roles (user_id, role) VALUES
  ('32a00000-0000-0000-0000-0000000000a1', 'admin'),
  ('32a00000-0000-0000-0000-0000000000a2', 'editor');
INSERT INTO public.user_roles (user_id, role, tenant_id) VALUES
  ('32a00000-0000-0000-0000-0000000000b1', 'admin', '32000000-0000-0000-0000-0000000000b0');

INSERT INTO public.profiles (id, tenant_id) VALUES
  ('32a00000-0000-0000-0000-0000000000a1', '11111111-1111-1111-1111-111111111111'),
  ('32a00000-0000-0000-0000-0000000000a2', '11111111-1111-1111-1111-111111111111'),
  ('32a00000-0000-0000-0000-0000000000a3', '11111111-1111-1111-1111-111111111111'),
  ('32a00000-0000-0000-0000-0000000000b1', '32000000-0000-0000-0000-0000000000b0');

INSERT INTO public.events
  (id, tenant_id, slug, title_pl, title_en, starts_at, ends_at, timezone, status,
   registration_mode, registration_flow)
VALUES
  ('32e00000-0000-0000-0000-0000000000e1', '11111111-1111-1111-1111-111111111111',
   'spr-forum', 'Forum Sponsorow', 'Sponsor Forum',
   now() - interval '1 day', now() + interval '1 day', 'Europe/Warsaw', 'published', 'rsvp', 'instant'),
  ('32e00000-0000-0000-0000-0000000000e2', '11111111-1111-1111-1111-111111111111',
   'spr-szkic', 'Szkic sponsorow', 'Sponsor draft',
   now() + interval '30 days', NULL, 'Europe/Warsaw', 'draft', 'rsvp', 'instant'),
  ('32e00000-0000-0000-0000-0000000000eb', '32000000-0000-0000-0000-0000000000b0',
   'spr-forum-b', 'Forum B', 'Forum B',
   now() - interval '1 day', NULL, 'Europe/Warsaw', 'published', 'rsvp', 'instant');

INSERT INTO public.crm_companies (id, tenant_id, name) VALUES
  ('32c00000-0000-0000-0000-0000000000c1', '11111111-1111-1111-1111-111111111111', 'Orlen 32'),
  ('32c00000-0000-0000-0000-0000000000c2', '11111111-1111-1111-1111-111111111111', 'Beta 32'),
  ('32c00000-0000-0000-0000-0000000000c3', '11111111-1111-1111-1111-111111111111', 'Ukryta 32'),
  ('32c00000-0000-0000-0000-0000000000cb', '32000000-0000-0000-0000-0000000000b0', 'Obca 32')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.event_sponsor_tiers (id, tenant_id, event_id, key, name_pl, name_en, rank) VALUES
  ('32f00000-0000-0000-0000-0000000000f1', '11111111-1111-1111-1111-111111111111',
   '32e00000-0000-0000-0000-0000000000e1', 'zloty', 'Zloty', 'Gold', 30);

INSERT INTO public.event_sponsors
  (id, tenant_id, event_id, company_id, tier_id, role, is_published, snapshot_name, snapshot_website)
VALUES
  ('32500000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   '32e00000-0000-0000-0000-0000000000e1', '32c00000-0000-0000-0000-0000000000c1',
   '32f00000-0000-0000-0000-0000000000f1', 'sponsor', true, 'Orlen', 'https://orlen.example.org'),
  ('32500000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111',
   '32e00000-0000-0000-0000-0000000000e1', '32c00000-0000-0000-0000-0000000000c2',
   NULL, 'partner', true, 'Beta', 'https://beta.example.org'),
  ('32500000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111',
   '32e00000-0000-0000-0000-0000000000e1', '32c00000-0000-0000-0000-0000000000c3',
   NULL, 'partner', false, 'Ukryta', NULL),
  ('32500000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111',
   '32e00000-0000-0000-0000-0000000000e2', '32c00000-0000-0000-0000-0000000000c1',
   NULL, 'partner', true, 'Orlen (szkic)', NULL),
  ('32500000-0000-0000-0000-00000000000b', '32000000-0000-0000-0000-0000000000b0',
   '32e00000-0000-0000-0000-0000000000eb', '32c00000-0000-0000-0000-0000000000cb',
   NULL, 'partner', true, 'Obca', NULL);

INSERT INTO public.event_sponsor_materials
  (id, tenant_id, event_id, sponsor_id, title_pl, title_en, kind, url, is_published)
VALUES
  ('32d00000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   '32e00000-0000-0000-0000-0000000000e1', '32500000-0000-0000-0000-000000000001',
   'Oferta', 'Offer', 'document', 'https://orlen.example.org/oferta.pdf', true),
  ('32d00000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111',
   '32e00000-0000-0000-0000-0000000000e1', '32500000-0000-0000-0000-000000000001',
   'Szkic oferty', 'Offer draft', 'document', 'https://orlen.example.org/szkic.pdf', false),
  ('32d00000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111',
   '32e00000-0000-0000-0000-0000000000e1', '32500000-0000-0000-0000-000000000002',
   'Katalog', 'Catalogue', 'document', 'https://beta.example.org/katalog.pdf', true);

-- Sciezka programu ze sponsorem S1 (placement `agenda_track`). Sesji ze
-- sponsorem S2 celowo NIE ma - `agenda_session` S2 ma byc odrzucone.
INSERT INTO public.event_tracks (id, tenant_id, event_id, key, name_pl, name_en, sponsor_id) VALUES
  ('32f10000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   '32e00000-0000-0000-0000-0000000000e1', 'energia', 'Energia', 'Energy',
   '32500000-0000-0000-0000-000000000001');

INSERT INTO public.event_people
  (id, tenant_id, first_name, last_name, email, phone, job_title, company_text, source,
   consent_marketing_at, consent_partner_sharing_at, consent_withdrawn_at)
VALUES
  ('32b00000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   'Pola', 'Pierwsza', 'p1.spr@example.org', '+48 600 000 001', 'CTO', 'Firma P1', 'organizer',
   now() - interval '2 days', now() - interval '2 days', NULL),
  ('32b00000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111',
   'Piotr', 'Drugi', 'p2.spr@example.org', '+48 600 000 002', 'CFO', 'Firma P2', 'organizer',
   NULL, NULL, NULL),
  ('32b00000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111',
   'Paula', 'Trzecia', 'p3.spr@example.org', NULL, NULL, NULL, 'organizer',
   now() - interval '3 days', now() - interval '3 days', now() - interval '1 day'),
  ('32b00000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111',
   'Pawel', 'Czwarty', NULL, NULL, NULL, NULL, 'organizer',
   NULL, now() - interval '2 days', NULL);

-- Istniejacy kontakt CRM osoby P3 (most moze go WZBOGACIC bez zgody).
INSERT INTO public.crm_leads (id, tenant_id, email, email_norm, source_type, tags) VALUES
  ('32100000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111',
   'p3.spr@example.org', 'p3.spr@example.org', 'manual', '{}');

CREATE TEMP TABLE spr_q (k text PRIMARY KEY, u uuid, t text) ON COMMIT DROP;

-- Wygodnik: jedno wywolanie zapisu ekspozycji (harness laczy sie jako
-- superuzytkownik, wiec gra role `service_role` z endpointu).
CREATE FUNCTION pg_temp.spr_ingest(
  _session text,
  _items jsonb,
  _slug text DEFAULT 'spr-forum',
  _tenant uuid DEFAULT '11111111-1111-1111-1111-111111111111'
) RETURNS integer LANGUAGE sql AS $$
  SELECT public.event_sponsor_exposure_ingest(
    _tenant, jsonb_build_object('event_slug', _slug, 'session', _session, 'items', _items))
$$;

CREATE FUNCTION pg_temp.spr_item(_sponsor text, _placement text, _kind text,
  _material text DEFAULT NULL, _ad text DEFAULT NULL) RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_strip_nulls(jsonb_build_object('sponsor_id', _sponsor, 'placement', _placement,
    'kind', _kind, 'material_id', _material, 'home_ad_id', _ad))
$$;

-- ---------------------------------------------------------------------------
-- SEKCJA 2: NAPRAWY (reklamy dla goscia, link logotypu, reklama ze sponsorem)
-- ---------------------------------------------------------------------------
SELECT pg_temp.act_as('32a00000-0000-0000-0000-0000000000a1', '11111111-1111-1111-1111-111111111111');

DO $do$
DECLARE
  v_ad uuid;
BEGIN
  v_ad := public.admin_event_home_ad_save(jsonb_build_object(
    'event_id', '32e00000-0000-0000-0000-0000000000e1',
    'image_url', 'https://cdn.example.org/spr-1.png',
    'link_url', 'https://orlen.example.org/kampania',
    'sponsor_id', '32500000-0000-0000-0000-000000000001'));
  INSERT INTO spr_q (k, u) VALUES ('ad1', v_ad);
  PERFORM pg_temp.assert(
    (SELECT a.sponsor_id FROM public.event_home_ads a WHERE a.id = v_ad) = '32500000-0000-0000-0000-000000000001',
    '32/reklama: zapis przypina reklame do sponsora TEGO wydarzenia');

  v_ad := public.admin_event_home_ad_save(jsonb_build_object(
    'event_id', '32e00000-0000-0000-0000-0000000000e1',
    'image_url', 'https://cdn.example.org/spr-0.png'));
  INSERT INTO spr_q (k, u) VALUES ('ad0', v_ad);
  PERFORM pg_temp.assert(
    (SELECT a.sponsor_id IS NULL FROM public.event_home_ads a WHERE a.id = v_ad),
    '32/reklama: reklama bez sponsora zostaje bez sponsora');

  INSERT INTO spr_q (k, u) VALUES ('adoff', public.admin_event_home_ad_save(jsonb_build_object(
    'event_id', '32e00000-0000-0000-0000-0000000000e1',
    'image_url', 'https://cdn.example.org/spr-off.png',
    'is_active', false)));

  -- Klucz pominiety = bez zmian; jawny null = odepnij.
  PERFORM public.admin_event_home_ad_save(jsonb_build_object(
    'id', (SELECT u FROM spr_q WHERE k = 'ad1'),
    'image_url', 'https://cdn.example.org/spr-1b.png'));
  PERFORM pg_temp.assert(
    (SELECT a.sponsor_id FROM public.event_home_ads a WHERE a.id = (SELECT u FROM spr_q WHERE k = 'ad1'))
      = '32500000-0000-0000-0000-000000000001',
    '32/reklama: zmiana bez klucza sponsor_id NIE odpina sponsora');
  PERFORM public.admin_event_home_ad_save(jsonb_build_object(
    'id', (SELECT u FROM spr_q WHERE k = 'ad1'),
    'image_url', 'https://cdn.example.org/spr-1b.png',
    'sponsor_id', NULL));
  PERFORM pg_temp.assert(
    (SELECT a.sponsor_id IS NULL FROM public.event_home_ads a WHERE a.id = (SELECT u FROM spr_q WHERE k = 'ad1')),
    '32/reklama: jawny null odpina sponsora');
  PERFORM public.admin_event_home_ad_save(jsonb_build_object(
    'id', (SELECT u FROM spr_q WHERE k = 'ad1'),
    'image_url', 'https://cdn.example.org/spr-1b.png',
    'sponsor_id', '32500000-0000-0000-0000-000000000001'));

  PERFORM pg_temp.assert(
    (SELECT l.sponsor_name FROM public.admin_event_home_ads_list('32e00000-0000-0000-0000-0000000000e1') l
      WHERE l.id = (SELECT u FROM spr_q WHERE k = 'ad1')) = 'Orlen',
    '32/reklama: lista panelu oddaje sponsora reklamy');

  -- Przekierowanie logotypu: S1 na zewnatrz, S2 bez linku.
  PERFORM public.admin_event_sponsor_set_link('32500000-0000-0000-0000-000000000001', 'external',
    'https://orlen.example.org/kongres');
  PERFORM public.admin_event_sponsor_set_link('32500000-0000-0000-0000-000000000002', 'none', NULL);
END
$do$;

SELECT pg_temp.assert_raises_like(
  format($q$SELECT public.admin_event_home_ad_save(jsonb_build_object(
    'id', %L, 'image_url', 'https://cdn.example.org/spr-0.png',
    'sponsor_id', '32500000-0000-0000-0000-000000000004'))$q$, (SELECT u FROM spr_q WHERE k = 'ad0')),
  'sponsor_not_in_event',
  '32/reklama: sponsor INNEGO wydarzenia tego najemcy odrzucony');
SELECT pg_temp.assert_raises_like(
  format($q$SELECT public.admin_event_home_ad_save(jsonb_build_object(
    'id', %L, 'image_url', 'https://cdn.example.org/spr-0.png',
    'sponsor_id', '32500000-0000-0000-0000-00000000000b'))$q$, (SELECT u FROM spr_q WHERE k = 'ad0')),
  'sponsor_not_in_event',
  '32/reklama: sponsor INNEGO najemcy odrzucony');

-- PRODUKCYJNA definicja `current_tenant_id()`: profil zalogowanego, czyli
-- NULL dla goscia. Na starym ciele (`ev.tenant_id = current_tenant_id()`)
-- ponizsze asercje sa CZERWONE - i o to chodzi.
CREATE OR REPLACE FUNCTION public.current_tenant_id() RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT p.tenant_id FROM public.profiles p WHERE p.id = auth.uid()
$$;

SELECT pg_temp.act_as(NULL, NULL);
SELECT pg_temp.assert(
  public.current_tenant_id() IS NULL,
  '32/naprawa: produkcyjna definicja current_tenant_id() daje NULL dla goscia (warunek wstepny)');
SELECT pg_temp.assert(
  (SELECT count(*) FROM public.event_home_ads_for_viewer('spr-forum')) = 2
  AND EXISTS (SELECT 1 FROM public.event_home_ads_for_viewer('spr-forum') v
               WHERE v.id = (SELECT u FROM spr_q WHERE k = 'ad1')
                 AND v.sponsor_id = '32500000-0000-0000-0000-000000000001'),
  '32/naprawa: GOSC widzi aktywne reklamy (z id sponsora) przy produkcyjnym current_tenant_id()');
SELECT pg_temp.assert(
  public.event_home_ad_track((SELECT u FROM spr_q WHERE k = 'ad1'), 'view', 'sesja-prod-0001'),
  '32/naprawa: licznik reklamy dziala dla goscia przy produkcyjnym current_tenant_id()');

SELECT set_config('nes.public_tenant', '32000000-0000-0000-0000-0000000000b0', false);
SELECT pg_temp.assert(
  (SELECT count(*) FROM public.event_home_ads_for_viewer('spr-forum')) = 0
  AND NOT public.event_home_ad_track((SELECT u FROM spr_q WHERE k = 'ad1'), 'view', 'sesja-prod-0002'),
  '32/naprawa/izolacja: na hoscie najemcy B reklamy A nie istnieja i nie licza sie');
SELECT set_config('nes.public_tenant', '', false);

-- Link logotypu na stronie publicznej (plaszczyzna tresci, gosc).
SELECT pg_temp.assert(
  EXISTS (SELECT 1 FROM public.event_sponsors_public('spr-forum') t,
                 jsonb_array_elements(t.sponsors) s
           WHERE s->>'id' = '32500000-0000-0000-0000-000000000001'
             AND s->>'link_mode' = 'external'
             AND s->>'link_url' = 'https://orlen.example.org/kongres'
             AND s->>'url' = 'https://orlen.example.org'),
  '32/link: publiczna lista oddaje tryb external i adres przekierowania obok strony z migawki');
SELECT pg_temp.assert(
  EXISTS (SELECT 1 FROM public.event_sponsors_public('spr-forum') t,
                 jsonb_array_elements(t.sponsors) s
           WHERE s->>'id' = '32500000-0000-0000-0000-000000000002'
             AND s->>'link_mode' = 'none'
             AND jsonb_typeof(s->'link_url') = 'null'),
  '32/link: tryb none jedzie na strone publiczna (logo bez odnosnika)');

-- Atrapa wraca do postaci harnessu (reszta pliku i kolejne pliki).
CREATE OR REPLACE FUNCTION public.current_tenant_id() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT COALESCE(public._caller_tenant(), public.public_tenant_id())
$$;

-- ---------------------------------------------------------------------------
-- SEKCJA 3: ZAPIS EKSPOZYCJI
-- ---------------------------------------------------------------------------
DO $do$
DECLARE
  s1 constant text := '32500000-0000-0000-0000-000000000001';
  s2 constant text := '32500000-0000-0000-0000-000000000002';
  s3 constant text := '32500000-0000-0000-0000-000000000003';
  sb constant text := '32500000-0000-0000-0000-00000000000b';
  m1 constant text := '32d00000-0000-0000-0000-000000000001';
  m2 constant text := '32d00000-0000-0000-0000-000000000002';
  m3 constant text := '32d00000-0000-0000-0000-000000000003';
  ad1 text := (SELECT u::text FROM spr_q WHERE k = 'ad1');
  ad0 text := (SELECT u::text FROM spr_q WHERE k = 'ad0');
  adoff text := (SELECT u::text FROM spr_q WHERE k = 'adoff');
  v_n integer;
  v_items jsonb;
BEGIN
  v_n := pg_temp.spr_ingest('sesja-spr-00000001', jsonb_build_array(
    pg_temp.spr_item(s1, 'home_strip', 'view'),
    pg_temp.spr_item(s1, 'home_strip', 'view'),
    pg_temp.spr_item(s1, 'home_strip', 'click'),
    pg_temp.spr_item(s1, 'partners_section', 'view'),
    pg_temp.spr_item(s1, 'partners_tab', 'click'),
    pg_temp.spr_item(s1, 'agenda_track', 'view'),
    pg_temp.spr_item(s2, 'agenda_session', 'view'),
    pg_temp.spr_item(s1, 'agenda_track', 'click'),
    pg_temp.spr_item(s1, 'materials', 'view'),
    pg_temp.spr_item(s1, 'materials', 'material_open', m1),
    pg_temp.spr_item(s1, 'materials', 'material_open', m2),
    pg_temp.spr_item(s1, 'materials', 'material_open', m3),
    pg_temp.spr_item(s1, 'materials', 'click'),
    pg_temp.spr_item(s3, 'home_strip', 'view'),
    pg_temp.spr_item(sb, 'home_strip', 'view'),
    pg_temp.spr_item(s2, 'home_ad', 'view', NULL, ad1),
    pg_temp.spr_item(NULL, 'home_ad', 'view', NULL, ad0),
    pg_temp.spr_item(s1, 'home_ad', 'view', NULL, adoff),
    pg_temp.spr_item(s1, 'banner', 'view'),
    pg_temp.spr_item(s1, 'home_strip', 'hover'),
    pg_temp.spr_item('not-a-uuid', 'home_strip', 'view'),
    pg_temp.spr_item(s1, 'home_strip', 'view', NULL, ad1),
    '"nie-obiekt"'::jsonb
  ));
  PERFORM pg_temp.assert(v_n = 9,
    format('32/ingest: z 23 pozycji zapisane sa DOKLADNIE poprawne (9 wierszy), jest %s', v_n));
  PERFORM pg_temp.assert(
    (SELECT x.hits FROM public.event_sponsor_exposures x
      WHERE x.sponsor_id = s1::uuid AND x.placement = 'home_strip' AND x.kind = 'view') = 2,
    '32/ingest: powtorzenie w jednej paczce podbija hits zamiast dublowac wiersz');
  PERFORM pg_temp.assert(
    (SELECT x.sponsor_id FROM public.event_sponsor_exposures x
      WHERE x.placement = 'home_ad' AND x.home_ad_id = ad1::uuid) = s1::uuid,
    '32/ingest: sponsor reklamy pochodzi z WIERSZA REKLAMY, nie od klienta (klient podal S2)');
  PERFORM pg_temp.assert(
    (SELECT x.sponsor_id IS NULL FROM public.event_sponsor_exposures x
      WHERE x.placement = 'home_ad' AND x.home_ad_id = ad0::uuid),
    '32/ingest: reklama bez sponsora liczy sie bez przypisania');
  PERFORM pg_temp.assert(
    NOT EXISTS (SELECT 1 FROM public.event_sponsor_exposures x
                 WHERE x.sponsor_id IN (s2::uuid, s3::uuid, sb::uuid)
                    OR x.material_id IN (m2::uuid, m3::uuid)
                    OR x.home_ad_id = adoff::uuid
                    OR (x.placement = 'agenda_track' AND x.kind = 'click')
                    OR (x.placement = 'materials' AND x.kind = 'click')),
    '32/ingest: odrzucone: sesja bez sponsora, klik w agendzie, material cudzy i nieopublikowany, sponsor nieopublikowany i obcy, reklama wylaczona');
  PERFORM pg_temp.assert(
    (SELECT bool_and(x.day = (now() AT TIME ZONE 'Europe/Warsaw')::date
                     AND x.session_hash ~ '^[0-9a-f]{64}$'
                     AND position('sesja-spr' IN x.session_hash) = 0)
       FROM public.event_sponsor_exposures x
      WHERE x.event_id = '32e00000-0000-0000-0000-0000000000e1'),
    '32/ingest: dzien w strefie wydarzenia, sesja zapisana wylacznie jako sha256');

  -- Ta sama sesja, ten sam dzien: bez nowego wiersza.
  v_n := pg_temp.spr_ingest('sesja-spr-00000001', jsonb_build_array(pg_temp.spr_item(s1, 'home_strip', 'view')));
  PERFORM pg_temp.assert(v_n = 1
    AND (SELECT count(*) FROM public.event_sponsor_exposures x
          WHERE x.sponsor_id = s1::uuid AND x.placement = 'home_strip' AND x.kind = 'view') = 1
    AND (SELECT x.hits FROM public.event_sponsor_exposures x
          WHERE x.sponsor_id = s1::uuid AND x.placement = 'home_strip' AND x.kind = 'view') = 3,
    '32/ingest: ponowne wyswietlenie w tej samej sesji i dniu podbija hits (unikalne bez zmian)');

  -- Druga sesja: nowe wiersze unikalne.
  v_n := pg_temp.spr_ingest('sesja-spr-00000002', jsonb_build_array(
    pg_temp.spr_item(s1, 'home_strip', 'view'), pg_temp.spr_item(s1, 'home_strip', 'click')));
  PERFORM pg_temp.assert(v_n = 2
    AND (SELECT count(*) FROM public.event_sponsor_exposures x
          WHERE x.sponsor_id = s1::uuid AND x.placement = 'home_strip' AND x.kind = 'view') = 2,
    '32/ingest: inna sesja daje nowy wiersz unikalny');

  -- Limit trafien 500 na wiersz.
  UPDATE public.event_sponsor_exposures x SET hits = 499
   WHERE x.sponsor_id = s1::uuid AND x.placement = 'home_strip' AND x.kind = 'view'
     AND x.hits = 3;
  PERFORM pg_temp.spr_ingest('sesja-spr-00000001', jsonb_build_array(
    pg_temp.spr_item(s1, 'home_strip', 'view'), pg_temp.spr_item(s1, 'home_strip', 'view'),
    pg_temp.spr_item(s1, 'home_strip', 'view')));
  PERFORM pg_temp.assert(
    (SELECT max(x.hits) FROM public.event_sponsor_exposures x
      WHERE x.sponsor_id = s1::uuid AND x.placement = 'home_strip' AND x.kind = 'view') = 500,
    '32/ingest: hits zatrzymuje sie na 500');

  -- Maks. 40 pozycji: 41. (unikalna) jest pomijana.
  SELECT jsonb_agg(pg_temp.spr_item(s1, 'partners_section', 'view')) INTO v_items FROM generate_series(1, 40);
  v_items := v_items || jsonb_build_array(pg_temp.spr_item(s2, 'partners_section', 'view'));
  PERFORM pg_temp.spr_ingest('sesja-spr-00000003', v_items);
  PERFORM pg_temp.assert(
    EXISTS (SELECT 1 FROM public.event_sponsor_exposures x
             WHERE x.sponsor_id = s1::uuid AND x.placement = 'partners_section' AND x.hits = 40)
    AND NOT EXISTS (SELECT 1 FROM public.event_sponsor_exposures x
                     WHERE x.sponsor_id = s2::uuid AND x.placement = 'partners_section'),
    '32/ingest: paczka jest przycinana do 40 pozycji');

  -- Odmowy BEZ bledu (endpoint i tak odpowiada 204).
  PERFORM pg_temp.assert(
    pg_temp.spr_ingest('sesja-spr-00000009', jsonb_build_array(pg_temp.spr_item(s1, 'home_strip', 'view')),
      'spr-forum', '32000000-0000-0000-0000-0000000000b0') = 0,
    '32/ingest/izolacja: slug wydarzenia A w najemcy B nie zapisuje niczego');
  PERFORM pg_temp.assert(
    pg_temp.spr_ingest('sesja-spr-00000009', jsonb_build_array(pg_temp.spr_item(
      '32500000-0000-0000-0000-000000000004', 'home_strip', 'view')), 'spr-szkic') = 0,
    '32/ingest: szkic wydarzenia nie zbiera ekspozycji');
  PERFORM pg_temp.assert(
    pg_temp.spr_ingest('krotka', jsonb_build_array(pg_temp.spr_item(s1, 'home_strip', 'view'))) = 0
    AND pg_temp.spr_ingest('sesja z$paciami!!', jsonb_build_array(pg_temp.spr_item(s1, 'home_strip', 'view'))) = 0,
    '32/ingest: identyfikator sesji spoza ksztaltu odrzucony');
  PERFORM pg_temp.assert(
    public.event_sponsor_exposure_ingest('11111111-1111-1111-1111-111111111111',
      jsonb_build_object('event_slug', 'spr-forum', 'session', 'sesja-spr-00000009', 'items', '{}'::jsonb)) = 0
    AND public.event_sponsor_exposure_ingest(NULL,
      jsonb_build_object('event_slug', 'spr-forum', 'session', 'sesja-spr-00000009',
        'items', jsonb_build_array(pg_temp.spr_item(s1, 'home_strip', 'view')))) = 0
    AND public.event_sponsor_exposure_ingest('11111111-1111-1111-1111-111111111111', '[]'::jsonb) = 0,
    '32/ingest: pozycje nie-tablica, brak najemcy i ladunek nie-obiekt nie zapisuja niczego');
END
$do$;

SELECT pg_temp.assert(
  NOT has_function_privilege('anon', 'public.event_sponsor_exposure_ingest(uuid, jsonb)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.event_sponsor_exposure_ingest(uuid, jsonb)', 'EXECUTE')
  AND has_function_privilege('service_role', 'public.event_sponsor_exposure_ingest(uuid, jsonb)', 'EXECUTE'),
  '32/granty: zapis ekspozycji wylacznie dla service_role');
SELECT pg_temp.assert(
  NOT has_function_privilege('anon', 'public.event_sponsor_exposures_prune(integer)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.event_sponsor_exposures_prune(integer)', 'EXECUTE'),
  '32/granty: retencja wylacznie dla service_role');

SET ROLE authenticated;
SELECT pg_temp.assert_raises_like('SELECT count(*) FROM public.event_sponsor_exposures',
  'permission denied', '32/RLS: zalogowany nie czyta ekspozycji wprost');
SELECT pg_temp.assert_raises_like($q$INSERT INTO public.event_sponsor_exposures
    (tenant_id, event_id, sponsor_id, placement, kind, day, session_hash)
  VALUES ('11111111-1111-1111-1111-111111111111', '32e00000-0000-0000-0000-0000000000e1',
    '32500000-0000-0000-0000-000000000001', 'home_strip', 'view', current_date, repeat('a', 64))$q$,
  'permission denied', '32/RLS: zalogowany nie zapisuje ekspozycji wprost');
RESET ROLE;
SET ROLE anon;
SELECT pg_temp.assert_raises_like('SELECT count(*) FROM public.event_sponsor_exposures',
  'permission denied', '32/RLS: anonim nie czyta ekspozycji wprost');
RESET ROLE;

SELECT pg_temp.act_as('32a00000-0000-0000-0000-0000000000a1', '11111111-1111-1111-1111-111111111111');
SELECT pg_temp.assert(
  (SELECT l.views FROM public.admin_event_home_ads_list('32e00000-0000-0000-0000-0000000000e1') l
    WHERE l.id = (SELECT u FROM spr_q WHERE k = 'ad1')) = 2
  AND (SELECT l.views FROM public.admin_event_home_ads_list('32e00000-0000-0000-0000-0000000000e1') l
    WHERE l.id = (SELECT u FROM spr_q WHERE k = 'ad0')) = 1,
  '32/reklama: panel liczy wyswietlenia z OBU tabel (stary licznik + ekspozycje)');

-- ---------------------------------------------------------------------------
-- SEKCJA 4: RAPORT W STUDIU
-- ---------------------------------------------------------------------------
INSERT INTO public.event_lead_scans
  (tenant_id, event_id, sponsor_id, person_id, scanned_by_user_id, scan_count, interest_rating, note,
   consent_snapshot_at)
VALUES
  ('11111111-1111-1111-1111-111111111111', '32e00000-0000-0000-0000-0000000000e1',
   '32500000-0000-0000-0000-000000000001', '32b00000-0000-0000-0000-000000000001',
   '32a00000-0000-0000-0000-0000000000a1', 2, 5, 'Pilny kontakt P1', now()),
  ('11111111-1111-1111-1111-111111111111', '32e00000-0000-0000-0000-0000000000e1',
   '32500000-0000-0000-0000-000000000001', '32b00000-0000-0000-0000-000000000002',
   '32a00000-0000-0000-0000-0000000000a1', 1, 3, 'Notatka P2', NULL),
  ('11111111-1111-1111-1111-111111111111', '32e00000-0000-0000-0000-0000000000e1',
   '32500000-0000-0000-0000-000000000001', '32b00000-0000-0000-0000-000000000003',
   '32a00000-0000-0000-0000-0000000000a1', 1, NULL, NULL, NULL),
  ('11111111-1111-1111-1111-111111111111', '32e00000-0000-0000-0000-0000000000e1',
   '32500000-0000-0000-0000-000000000001', '32b00000-0000-0000-0000-000000000004',
   '32a00000-0000-0000-0000-0000000000a1', 1, NULL, NULL, now()),
  ('11111111-1111-1111-1111-111111111111', '32e00000-0000-0000-0000-0000000000e1',
   '32500000-0000-0000-0000-000000000002', '32b00000-0000-0000-0000-000000000001',
   '32a00000-0000-0000-0000-0000000000a1', 1, NULL, NULL, now());

-- Spotkania ze sponsorem S1. Regula gieldy (okna dostepnosci, stoliki) jest
-- przedmiotem 60_meetings.sql - tutaj liczymy tylko agregat raportu, wiec
-- trigger walidacji jest na chwile wylaczony (w obrebie tej transakcji).
INSERT INTO public.event_registrations (id, tenant_id, event_id, person_id, status, registration_mode) VALUES
  ('32900000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   '32e00000-0000-0000-0000-0000000000e1', '32b00000-0000-0000-0000-000000000001', 'approved', 'rsvp'),
  ('32900000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111',
   '32e00000-0000-0000-0000-0000000000e1', '32b00000-0000-0000-0000-000000000002', 'approved', 'rsvp');
ALTER TABLE public.event_meetings DISABLE TRIGGER USER;
INSERT INTO public.event_meetings
  (tenant_id, event_id, requester_registration_id, invitee_registration_id, starts_at, ends_at,
   status, expires_at, responded_at, attendance_marked_at, sponsor_id)
SELECT '11111111-1111-1111-1111-111111111111', '32e00000-0000-0000-0000-0000000000e1',
       '32900000-0000-0000-0000-000000000001', '32900000-0000-0000-0000-000000000002',
       m.starts_at, m.starts_at + interval '30 minutes', m.status, m.starts_at,
       CASE WHEN m.status IN ('accepted', 'held') THEN m.starts_at - interval '1 hour' END,
       CASE WHEN m.status = 'held' THEN m.starts_at + interval '30 minutes' END,
       '32500000-0000-0000-0000-000000000001'
  FROM (VALUES
    ('held', (((now() AT TIME ZONE 'Europe/Warsaw')::date + time '10:00') AT TIME ZONE 'Europe/Warsaw')),
    ('accepted', (((now() AT TIME ZONE 'Europe/Warsaw')::date + time '11:00') AT TIME ZONE 'Europe/Warsaw')),
    ('invited', (((now() AT TIME ZONE 'Europe/Warsaw')::date + time '12:00') AT TIME ZONE 'Europe/Warsaw'))
  ) AS m(status, starts_at);
ALTER TABLE public.event_meetings ENABLE TRIGGER USER;

DO $do$
DECLARE
  v_row record;
BEGIN
  SELECT * INTO v_row
    FROM public.admin_event_sponsor_report_summary('32e00000-0000-0000-0000-0000000000e1') r
   WHERE r.sponsor_id = '32500000-0000-0000-0000-000000000001';
  PERFORM pg_temp.assert(
    v_row.views_unique = 7 AND v_row.clicks_unique = 3 AND v_row.material_opens = 1
    AND v_row.views_total = (SELECT sum(x.hits) FROM public.event_sponsor_exposures x
                              WHERE x.sponsor_id = '32500000-0000-0000-0000-000000000001' AND x.kind = 'view')
    AND v_row.views_total > v_row.views_unique,
    format('32/raport: wyswietlenia unikalne 7 (lacznie = suma trafien), klikniecia 3, materialy 1; jest %s/%s/%s',
      v_row.views_unique, v_row.clicks_unique, v_row.material_opens));
  PERFORM pg_temp.assert(
    v_row.leads_total = 4 AND v_row.leads_consented = 2 AND v_row.lead_scans_total = 5
    AND v_row.leads_avg_rating = 4.00,
    '32/raport: kontakty 4, z zywa zgoda 2 (wycofana zgoda NIE liczy sie), skany 5, srednia ocena 4');
  PERFORM pg_temp.assert(
    v_row.meetings_total = 3 AND v_row.meetings_accepted = 2 AND v_row.meetings_held = 1,
    '32/raport: spotkania 3, przyjete 2, odbyte 1');
  PERFORM pg_temp.assert(
    v_row.tier_name_pl = 'Zloty' AND v_row.company_id = '32c00000-0000-0000-0000-0000000000c1'
    AND v_row.is_published AND v_row.active_links = 0,
    '32/raport: poziom, firma CRM, publikacja i brak aktywnych linkow');
  PERFORM pg_temp.assert(
    EXISTS (SELECT 1 FROM public.admin_event_sponsor_report_summary('32e00000-0000-0000-0000-0000000000e1') r
             WHERE r.sponsor_id = '32500000-0000-0000-0000-000000000003'
               AND NOT r.is_published AND r.views_unique = 0 AND r.leads_total = 0
               AND r.leads_avg_rating IS NULL)
    AND (SELECT count(*) FROM public.admin_event_sponsor_report_summary('32e00000-0000-0000-0000-0000000000e1')) = 3,
    '32/raport: kazde przypiecie wydarzenia ma wiersz (takze nieopublikowane, z zerami)');

  SELECT * INTO v_row
    FROM public.admin_event_sponsor_report_summary('32e00000-0000-0000-0000-0000000000e1', NULL, NULL, 'home_strip') r
   WHERE r.sponsor_id = '32500000-0000-0000-0000-000000000001';
  PERFORM pg_temp.assert(
    v_row.views_unique = 2 AND v_row.clicks_unique = 2 AND v_row.material_opens = 0 AND v_row.leads_total = 4,
    '32/raport: filtr miejsca zaweza ekspozycje, ale nie kontakty');

  SELECT * INTO v_row
    FROM public.admin_event_sponsor_report_summary('32e00000-0000-0000-0000-0000000000e1',
      ((now() AT TIME ZONE 'Europe/Warsaw')::date + 1), NULL) r
   WHERE r.sponsor_id = '32500000-0000-0000-0000-000000000001';
  PERFORM pg_temp.assert(
    v_row.views_unique = 0 AND v_row.leads_total = 0 AND v_row.meetings_total = 0,
    '32/raport: zakres od jutra nie widzi dzisiejszych ekspozycji, kontaktow ani spotkan');

  PERFORM pg_temp.assert(
    (SELECT sum(r.views_unique) FROM public.admin_event_sponsor_report_series(
       '32e00000-0000-0000-0000-0000000000e1', NULL, NULL, '32500000-0000-0000-0000-000000000001') r) = 7
    AND (SELECT r.views_unique FROM public.admin_event_sponsor_report_series(
       '32e00000-0000-0000-0000-0000000000e1', NULL, NULL, '32500000-0000-0000-0000-000000000001', 'home_strip') r
       WHERE r.day = (now() AT TIME ZONE 'Europe/Warsaw')::date) = 2
    AND NOT EXISTS (SELECT 1 FROM public.admin_event_sponsor_report_series(
       '32e00000-0000-0000-0000-0000000000e1', NULL, NULL, '32500000-0000-0000-0000-000000000002') r),
    '32/szereg: suma dzienna zgadza sie z podsumowaniem; filtr sponsora i miejsca');
  PERFORM pg_temp.assert(
    (SELECT r.leads_new = 4 AND r.leads_new_consented = 2
       FROM public.admin_event_sponsor_report_leads_series(
         '32e00000-0000-0000-0000-0000000000e1', NULL, NULL, '32500000-0000-0000-0000-000000000001') r
      WHERE r.day = (now() AT TIME ZONE 'Europe/Warsaw')::date),
    '32/szereg kontaktow: dzisiaj 4 nowe, 2 z zywa zgoda');
END
$do$;

SELECT pg_temp.assert_raises_like(
  $q$SELECT * FROM public.admin_event_sponsor_report_summary('32e00000-0000-0000-0000-0000000000e1',
    current_date, current_date - 1)$q$,
  'invalid_range', '32/raport: odwrocony zakres dni odrzucony');
SELECT pg_temp.assert_raises_like(
  $q$SELECT * FROM public.admin_event_sponsor_report_series('32e00000-0000-0000-0000-0000000000e1',
    NULL, NULL, NULL, 'banner')$q$,
  'invalid_placement', '32/szereg: nieznane miejsce odrzucone');
SELECT pg_temp.assert_raises_like(
  $q$SELECT * FROM public.admin_event_sponsor_report_leads_series('32e00000-0000-0000-0000-0000000000e1',
    current_date, current_date - 1)$q$,
  'invalid_range', '32/szereg kontaktow: odwrocony zakres odrzucony');

SELECT pg_temp.act_as('32a00000-0000-0000-0000-0000000000b1', '32000000-0000-0000-0000-0000000000b0');
SELECT pg_temp.assert_raises_like(
  $q$SELECT * FROM public.admin_event_sponsor_report_summary('32e00000-0000-0000-0000-0000000000e1')$q$,
  'not_found', '32/izolacja: admin B nie czyta raportu wydarzenia A');
SELECT pg_temp.assert_raises_like(
  $q$SELECT * FROM public.admin_event_sponsor_report_series('32e00000-0000-0000-0000-0000000000e1')$q$,
  'not_found', '32/izolacja: admin B nie czyta szeregu wydarzenia A');
SELECT pg_temp.assert_raises_like(
  $q$SELECT * FROM public.admin_event_sponsor_report_leads_series('32e00000-0000-0000-0000-0000000000e1')$q$,
  'not_found', '32/izolacja: admin B nie czyta szeregu kontaktow wydarzenia A');

SELECT pg_temp.act_as('32a00000-0000-0000-0000-0000000000a2', '11111111-1111-1111-1111-111111111111');
SELECT pg_temp.assert_raises_like(
  $q$SELECT * FROM public.admin_event_sponsor_report_summary('32e00000-0000-0000-0000-0000000000e1')$q$,
  'forbidden', '32/bramka: redaktor nie czyta raportu sponsorow');
SELECT pg_temp.act_as('32a00000-0000-0000-0000-0000000000a3', '11111111-1111-1111-1111-111111111111');
SELECT pg_temp.assert_raises_like(
  $q$SELECT * FROM public.admin_event_sponsor_report_series('32e00000-0000-0000-0000-0000000000e1')$q$,
  'forbidden', '32/bramka: uczestnik bez roli nie czyta szeregu');
SELECT pg_temp.act_as(NULL, NULL);
SELECT pg_temp.assert_raises_like(
  $q$SELECT * FROM public.admin_event_sponsor_report_leads_series('32e00000-0000-0000-0000-0000000000e1')$q$,
  'forbidden', '32/bramka: anonim nie czyta szeregu kontaktow');
SELECT pg_temp.assert(
  NOT has_function_privilege('anon', 'public.admin_event_sponsor_report_summary(uuid, date, date, text)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.admin_event_sponsor_report_series(uuid, date, date, uuid, text)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.admin_event_sponsor_report_leads_series(uuid, date, date, uuid)', 'EXECUTE')
  AND has_function_privilege('authenticated', 'public.admin_event_sponsor_report_summary(uuid, date, date, text)', 'EXECUTE'),
  '32/granty: funkcje raportu dla zalogowanych (bramka w ciele), nigdy dla anonima');

-- ---------------------------------------------------------------------------
-- SEKCJA 5: LINK DLA SPONSORA - WYDANIE I ODCZYT PO TOKENIE
-- ---------------------------------------------------------------------------
SELECT pg_temp.act_as('32a00000-0000-0000-0000-0000000000a1', '11111111-1111-1111-1111-111111111111');

DO $do$
DECLARE
  v_res jsonb;
  v_token text;
  v_link public.event_sponsor_report_links%ROWTYPE;
  i integer;
BEGIN
  v_res := public.admin_event_sponsor_report_link_issue(jsonb_build_object(
    'sponsor_id', '32500000-0000-0000-0000-000000000001', 'label', 'Raport Orlen'));
  v_token := v_res->>'token';
  INSERT INTO spr_q (k, u, t) VALUES ('link1', (v_res->>'id')::uuid, v_token);
  SELECT k.* INTO v_link FROM public.event_sponsor_report_links k WHERE k.id = (v_res->>'id')::uuid;
  PERFORM pg_temp.assert(
    v_token ~ '^[A-Za-z0-9_-]{32}$'
    AND v_link.token_hash = encode(public.digest(v_token, 'sha256'), 'hex')
    AND v_link.token_prefix = left(v_token, 8)
    AND v_res->>'token_prefix' = left(v_token, 8)
    AND position(v_token IN v_link.token_hash) = 0,
    '32/link: token 32 znakow wraca raz; w bazie tylko sha256 i prefiks');
  PERFORM pg_temp.assert(
    NOT v_link.include_leads AND v_link.expires_at > now()
    AND v_link.expires_at <= now() + interval '180 days'
    AND v_link.created_by = '32a00000-0000-0000-0000-0000000000a1'
    AND v_link.event_id = '32e00000-0000-0000-0000-0000000000e1',
    '32/link: kontakty domyslnie WYLACZONE, waznosc domyslna w granicy 180 dni, autor i wydarzenie');
  PERFORM pg_temp.assert(
    EXISTS (SELECT 1 FROM public.audit_log a
             WHERE a.tenant_id = '11111111-1111-1111-1111-111111111111'
               AND a.action = 'event.sponsor_report.link_issued'
               AND a.entity_type = 'crm_company'
               AND a.entity_id = '32c00000-0000-0000-0000-0000000000c1'
               AND a.actor_id = '32a00000-0000-0000-0000-0000000000a1'
               AND a.metadata->>'event_id' = '32e00000-0000-0000-0000-0000000000e1'
               AND a.metadata->>'event_slug' = 'spr-forum'
               AND a.metadata->>'link_id' = v_res->>'id'
               AND a.metadata->>'summary_pl' LIKE U&'Udost\0119pniono raport sponsora%'
               AND a.metadata->>'summary_en' LIKE 'Sponsor report shared%'
               AND a.metadata->>'event_title_en' = 'Sponsor Forum'),
    '32/link/CRM: wydanie linku zostawia wpis osi czasu na FIRMIE sponsora (kontrakt metadanych)');
  PERFORM pg_temp.assert(
    EXISTS (SELECT 1 FROM public.domain_events d
             WHERE d.event_type = 'event_sponsor_report_link.issued.v1'
               AND d.aggregate_type = 'event_sponsor_report_link'
               AND d.aggregate_id = v_res->>'id'
               AND d.payload->>'event_id' = '32e00000-0000-0000-0000-0000000000e1'
               AND d.actor_id = '32a00000-0000-0000-0000-0000000000a1'),
    '32/link: zdarzenie domenowe issued.v1 z identyfikatorami');

  v_res := public.admin_event_sponsor_report_link_issue(jsonb_build_object(
    'sponsor_id', '32500000-0000-0000-0000-000000000001', 'label', 'Raport z kontaktami',
    'include_leads', true, 'expires_at', (now() + interval '10 days')::text));
  INSERT INTO spr_q (k, u, t) VALUES ('link2', (v_res->>'id')::uuid, v_res->>'token');

  -- Limit 10 aktywnych linkow na sponsora (S2).
  FOR i IN 1..10 LOOP
    PERFORM public.admin_event_sponsor_report_link_issue(jsonb_build_object(
      'sponsor_id', '32500000-0000-0000-0000-000000000002', 'label', format('Link %s', i)));
  END LOOP;
END
$do$;

SELECT pg_temp.assert_raises_like(
  $q$SELECT public.admin_event_sponsor_report_link_issue(jsonb_build_object(
    'sponsor_id', '32500000-0000-0000-0000-000000000002', 'label', 'Jedenasty'))$q$,
  'too_many_links', '32/link: jedenasty aktywny link sponsora odrzucony');
SELECT pg_temp.assert_raises_like(
  $q$SELECT public.admin_event_sponsor_report_link_issue(jsonb_build_object(
    'sponsor_id', '32500000-0000-0000-0000-000000000001', 'label', 'x'))$q$,
  'invalid_label', '32/link: etykieta krotsza niz 2 znaki odrzucona');
SELECT pg_temp.assert_raises_like(
  $q$SELECT public.admin_event_sponsor_report_link_issue(jsonb_build_object(
    'sponsor_id', '32500000-0000-0000-0000-000000000001', 'label', 'Przeszlosc',
    'expires_at', (now() - interval '1 hour')::text))$q$,
  'invalid_expiry', '32/link: waznosc w przeszlosci odrzucona');
SELECT pg_temp.assert_raises_like(
  $q$SELECT public.admin_event_sponsor_report_link_issue(jsonb_build_object(
    'sponsor_id', '32500000-0000-0000-0000-000000000001', 'label', 'Za dlugo',
    'expires_at', (now() + interval '181 days')::text))$q$,
  'invalid_expiry', '32/link: waznosc powyzej 180 dni odrzucona');
SELECT pg_temp.assert_raises_like(
  $q$SELECT public.admin_event_sponsor_report_link_issue(jsonb_build_object(
    'sponsor_id', '32500000-0000-0000-0000-00000000000b', 'label', 'Obcy'))$q$,
  'sponsor_not_found', '32/link/izolacja: sponsor innego najemcy odrzucony');
SELECT pg_temp.assert_raises_like(
  $q$SELECT public.admin_event_sponsor_report_link_issue('{}'::jsonb)$q$,
  'invalid_payload', '32/link: brak sponsora odrzucony');

SELECT pg_temp.assert(
  (SELECT count(*) FROM public.admin_event_sponsor_report_links_list(
     '32e00000-0000-0000-0000-0000000000e1', '32500000-0000-0000-0000-000000000001') l WHERE l.is_active) = 2
  AND (SELECT count(*) FROM public.admin_event_sponsor_report_links_list('32e00000-0000-0000-0000-0000000000e1')) = 12
  AND (SELECT r.active_links FROM public.admin_event_sponsor_report_summary('32e00000-0000-0000-0000-0000000000e1') r
        WHERE r.sponsor_id = '32500000-0000-0000-0000-000000000001') = 2,
  '32/link: lista panelu i licznik aktywnych linkow w raporcie');

SELECT pg_temp.act_as('32a00000-0000-0000-0000-0000000000b1', '32000000-0000-0000-0000-0000000000b0');
SELECT pg_temp.assert(
  (SELECT count(*) FROM public.admin_event_sponsor_report_links_list('32e00000-0000-0000-0000-0000000000e1')) = 0,
  '32/link/izolacja: admin B nie widzi linkow wydarzenia A');
SELECT pg_temp.assert_raises_like(
  $q$SELECT public.admin_event_sponsor_report_link_issue(jsonb_build_object(
    'sponsor_id', '32500000-0000-0000-0000-000000000001', 'label', 'Przejecie'))$q$,
  'sponsor_not_found', '32/link/izolacja: admin B nie wyda linku dla sponsora A');

SELECT pg_temp.act_as('32a00000-0000-0000-0000-0000000000a2', '11111111-1111-1111-1111-111111111111');
SELECT pg_temp.assert_raises_like(
  $q$SELECT public.admin_event_sponsor_report_link_issue(jsonb_build_object(
    'sponsor_id', '32500000-0000-0000-0000-000000000001', 'label', 'Redaktor'))$q$,
  'forbidden', '32/bramka: redaktor nie wydaje linkow');
SELECT pg_temp.assert_raises_like(
  $q$SELECT * FROM public.admin_event_sponsor_report_links_list('32e00000-0000-0000-0000-0000000000e1')$q$,
  'forbidden', '32/bramka: redaktor nie widzi listy linkow');

-- Odczyt po tokenie (rola service_role - harness jest superuzytkownikiem).
SELECT pg_temp.act_as(NULL, NULL);
DO $do$
DECLARE
  v_res jsonb;
  v_t1 text := (SELECT t FROM spr_q WHERE k = 'link1');
  v_t2 text := (SELECT t FROM spr_q WHERE k = 'link2');
  v_p1 jsonb;
  v_p2 jsonb;
BEGIN
  v_res := public.event_sponsor_report_for_token('11111111-1111-1111-1111-111111111111', v_t1);
  PERFORM pg_temp.assert(
    (v_res->>'ok')::boolean
    AND v_res#>>'{event,slug}' = 'spr-forum'
    AND v_res#>>'{sponsor,name}' = 'Orlen'
    AND v_res#>>'{sponsor,tier_name_pl}' = 'Zloty'
    AND (v_res#>>'{totals,views_unique}')::int = 7
    AND (v_res#>>'{totals,clicks_unique}')::int = 3
    AND (v_res#>>'{totals,leads_total}')::int = 4
    AND (v_res#>>'{totals,leads_consented}')::int = 2
    AND (v_res#>>'{totals,meetings_held}')::int = 1
    AND jsonb_typeof(v_res->'leads') = 'null'
    AND jsonb_array_length(v_res->'placements') >= 4
    AND jsonb_array_length(v_res->'series') >= 1,
    '32/token: raport sponsora bez kontaktow (include_leads=false) z totalami i szeregiem');
  PERFORM pg_temp.assert(
    (SELECT k.view_count = 1 AND k.last_seen_at IS NOT NULL FROM public.event_sponsor_report_links k
      WHERE k.id = (SELECT u FROM spr_q WHERE k = 'link1')),
    '32/token: otwarcie podbija licznik i stempel ostatniego odczytu');
  PERFORM public.event_sponsor_report_for_token('11111111-1111-1111-1111-111111111111', v_t1);
  PERFORM pg_temp.assert(
    (SELECT k.view_count FROM public.event_sponsor_report_links k WHERE k.id = (SELECT u FROM spr_q WHERE k = 'link1')) = 2,
    '32/token: drugie otwarcie = 2');

  v_res := public.event_sponsor_report_for_token('11111111-1111-1111-1111-111111111111', v_t2);
  SELECT e INTO v_p1 FROM jsonb_array_elements(v_res->'leads') e WHERE e->>'email' = 'p1.spr@example.org';
  SELECT e INTO v_p2 FROM jsonb_array_elements(v_res->'leads') e WHERE e->>'note' = 'Notatka P2';
  PERFORM pg_temp.assert(
    jsonb_array_length(v_res->'leads') = 4
    AND (v_p1->>'consent')::boolean AND v_p1->>'first_name' = 'Pola' AND v_p1->>'company' = 'Firma P1'
    AND v_p1->>'phone' = '+48 600 000 001',
    '32/token: kontakt ze ZYWA zgoda oddaje e-mail, telefon i dane osoby');
  PERFORM pg_temp.assert(
    NOT (v_p2->>'consent')::boolean
    AND jsonb_typeof(v_p2->'email') = 'null' AND jsonb_typeof(v_p2->'phone') = 'null'
    AND jsonb_typeof(v_p2->'first_name') = 'null' AND jsonb_typeof(v_p2->'last_name') = 'null'
    AND jsonb_typeof(v_p2->'company') = 'null' AND jsonb_typeof(v_p2->'job_title') = 'null'
    AND (v_p2->>'interest_rating')::int = 3,
    '32/token: wiersz BEZ zgody nie niesie zadnych danych osobowych (zostaje notatka i ocena sponsora)');
  PERFORM pg_temp.assert(
    NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_res->'leads') e
                 WHERE e->>'email' = 'p3.spr@example.org' OR e->>'first_name' = 'Paula'),
    '32/token: zgoda WYCOFANA traktowana jak brak zgody');

  PERFORM pg_temp.assert(
    public.event_sponsor_report_for_token('32000000-0000-0000-0000-0000000000b0', v_t1)->>'reason' = 'not_found'
    AND public.event_sponsor_report_for_token('11111111-1111-1111-1111-111111111111', 'krotki')->>'reason' = 'not_found'
    AND public.event_sponsor_report_for_token('11111111-1111-1111-1111-111111111111', repeat('A', 32))->>'reason' = 'not_found'
    AND public.event_sponsor_report_for_token(NULL, v_t1)->>'reason' = 'not_found',
    '32/token/izolacja: token w innym najemcy, zly ksztalt i nieznany token daja not_found');
END
$do$;

SELECT pg_temp.assert(
  NOT has_function_privilege('anon', 'public.event_sponsor_report_for_token(uuid, text)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.event_sponsor_report_for_token(uuid, text)', 'EXECUTE')
  AND has_function_privilege('service_role', 'public.event_sponsor_report_for_token(uuid, text)', 'EXECUTE'),
  '32/granty: odczyt po tokenie wylacznie dla service_role');
SELECT pg_temp.assert(
  NOT has_function_privilege('anon', 'public.admin_event_sponsor_report_link_issue(jsonb)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.admin_event_sponsor_report_link_revoke(uuid)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.admin_event_sponsor_report_links_list(uuid, uuid)', 'EXECUTE'),
  '32/granty: funkcje linkow panelu nie sa dla anonima');

SET ROLE authenticated;
SELECT pg_temp.assert_raises_like('SELECT count(*) FROM public.event_sponsor_report_links',
  'permission denied', '32/RLS: zalogowany nie czyta tabeli linkow (skroty poswiadczen)');
RESET ROLE;

-- ---------------------------------------------------------------------------
-- SEKCJA 6: CRM - HISTORIA SPONSORINGU I PRZENIESIENIE KONTAKTOW
-- ---------------------------------------------------------------------------
SELECT pg_temp.act_as('32a00000-0000-0000-0000-0000000000a1', '11111111-1111-1111-1111-111111111111');

SELECT pg_temp.assert(
  (SELECT count(*) FROM public.admin_event_company_sponsorships('32c00000-0000-0000-0000-0000000000c1')) = 2
  AND (SELECT r.views_unique = 7 AND r.leads_total = 4 AND r.leads_consented = 2 AND r.meetings_held = 1
              AND r.active_links = 2 AND r.tier_name_pl = 'Zloty' AND r.event_slug = 'spr-forum'
              AND r.event_timezone IS NOT DISTINCT FROM (SELECT e.timezone FROM public.events e
                                                         WHERE e.id = r.event_id)
         FROM public.admin_event_company_sponsorships('32c00000-0000-0000-0000-0000000000c1') r
        WHERE r.event_id = '32e00000-0000-0000-0000-0000000000e1'),
  '32/CRM: historia sponsoringu firmy (dwa wydarzenia) z metrykami raportu');

DO $do$
DECLARE
  v_res jsonb;
  v_lead public.crm_leads%ROWTYPE;
BEGIN
  v_res := public.admin_event_lead_scans_push_to_crm(jsonb_build_object(
    'event_id', '32e00000-0000-0000-0000-0000000000e1'));
  PERFORM pg_temp.assert(
    v_res = jsonb_build_object('persons', 4, 'created', 1, 'updated', 1, 'skipped_no_email', 1,
                               'skipped_no_consent', 1, 'failed', 0),
    format('32/CRM: przeniesienie: 1 nowy (zgoda), 1 wzbogacony, bez e-maila 1, bez zgody 1; jest %s', v_res));

  SELECT l.* INTO v_lead FROM public.crm_leads l
   WHERE l.tenant_id = '11111111-1111-1111-1111-111111111111' AND l.email_norm = 'p1.spr@example.org';
  PERFORM pg_temp.assert(
    v_lead.source_type = 'event_participant' AND v_lead.marketing_consent
    AND v_lead.tags @> ARRAY['event:spr-forum',
                             'sponsor_lead:32c00000-0000-0000-0000-0000000000c1',
                             'sponsor_lead:32c00000-0000-0000-0000-0000000000c2']
    AND v_lead.newsletter_status IS NULL,
    '32/CRM: nowy kontakt: segment uczestnika, zgoda z dowodu, tagi wydarzenia i obu sponsorow, bez newslettera');
  PERFORM pg_temp.assert(
    (SELECT count(*) FROM public.audit_log a
      WHERE a.entity_type = 'crm_lead' AND a.entity_id = v_lead.id
        AND a.action = 'event.sponsor_lead.pushed'
        AND a.metadata->>'summary_pl' LIKE 'Kontakt zebrany na stoisku%'
        AND jsonb_array_length(a.metadata->'sponsor_ids') = 2) = 1,
    '32/CRM: wpis osi czasu kontaktu wg kontraktu');

  SELECT l.* INTO v_lead FROM public.crm_leads l WHERE l.id = '32100000-0000-0000-0000-000000000003';
  PERFORM pg_temp.assert(
    NOT v_lead.marketing_consent AND v_lead.tags @> ARRAY['sponsor_lead:32c00000-0000-0000-0000-0000000000c1']
    AND v_lead.source_type = 'event_participant',
    '32/CRM: istniejacy kontakt wzbogacony tagiem, zgoda WYCOFANA nie wytwarza zgody marketingowej');
  PERFORM pg_temp.assert(
    NOT EXISTS (SELECT 1 FROM public.crm_leads l
                 WHERE l.tenant_id = '11111111-1111-1111-1111-111111111111'
                   AND l.email_norm = 'p2.spr@example.org'),
    '32/CRM: osoba bez zgody marketingowej i bez kontaktu NIE jest zakladana w CRM');
  PERFORM pg_temp.assert(
    NOT EXISTS (SELECT 1 FROM public.crm_leads l
                 WHERE l.tenant_id = '11111111-1111-1111-1111-111111111111'
                   AND (l.aliases::text LIKE '%Pilny kontakt%' OR l.aliases::text LIKE '%Notatka P2%'
                        OR COALESCE(l.company, '') LIKE '%Pilny%')),
    '32/CRM: notatki i oceny sponsora nie trafiaja do CRM organizatora');

  -- Ponowienie: bez drugiego wpisu osi czasu dla tej samej osoby.
  v_res := public.admin_event_lead_scans_push_to_crm(jsonb_build_object(
    'event_id', '32e00000-0000-0000-0000-0000000000e1'));
  PERFORM pg_temp.assert(
    (v_res->>'created')::int = 0 AND (v_res->>'updated')::int = 2
    AND (SELECT count(*) FROM public.audit_log a
          JOIN public.crm_leads l ON l.id = a.entity_id
         WHERE l.email_norm = 'p1.spr@example.org' AND a.action = 'event.sponsor_lead.pushed') = 1,
    '32/CRM: ponowne przeniesienie aktualizuje, ale nie dubluje wpisu osi czasu');

  v_res := public.admin_event_lead_scans_push_to_crm(jsonb_build_object(
    'event_id', '32e00000-0000-0000-0000-0000000000e1', 'sponsor_id', '32500000-0000-0000-0000-000000000002'));
  PERFORM pg_temp.assert((v_res->>'persons')::int = 1,
    '32/CRM: filtr sponsora zaweza przeniesienie do jego kontaktow');
END
$do$;

SELECT pg_temp.assert_raises_like(
  $q$SELECT public.admin_event_lead_scans_push_to_crm('{}'::jsonb)$q$,
  'invalid_payload', '32/CRM: brak wydarzenia odrzucony');
SELECT pg_temp.assert_raises_like(
  $q$SELECT public.admin_event_lead_scans_push_to_crm(jsonb_build_object(
    'event_id', '32e00000-0000-0000-0000-0000000000eb'))$q$,
  'not_found', '32/CRM/izolacja: wydarzenie innego najemcy odrzucone');
SELECT pg_temp.assert_raises_like(
  $q$SELECT public.admin_event_lead_scans_push_to_crm(jsonb_build_object(
    'event_id', '32e00000-0000-0000-0000-0000000000e1', 'sponsor_id', '32500000-0000-0000-0000-000000000004'))$q$,
  'sponsor_not_found', '32/CRM: sponsor innego wydarzenia odrzucony');

SELECT pg_temp.act_as('32a00000-0000-0000-0000-0000000000b1', '32000000-0000-0000-0000-0000000000b0');
SELECT pg_temp.assert(
  (SELECT count(*) FROM public.admin_event_company_sponsorships('32c00000-0000-0000-0000-0000000000c1')) = 0,
  '32/CRM/izolacja: admin B nie widzi sponsoringu firmy A');

SELECT pg_temp.act_as('32a00000-0000-0000-0000-0000000000a2', '11111111-1111-1111-1111-111111111111');
SELECT pg_temp.assert_raises_like(
  $q$SELECT * FROM public.admin_event_company_sponsorships('32c00000-0000-0000-0000-0000000000c1')$q$,
  'forbidden', '32/bramka: redaktor CRM dostaje forbidden (karta firmy chowa sekcje)');
SELECT pg_temp.assert_raises_like(
  $q$SELECT public.admin_event_lead_scans_push_to_crm(jsonb_build_object(
    'event_id', '32e00000-0000-0000-0000-0000000000e1'))$q$,
  'forbidden', '32/bramka: redaktor nie przenosi kontaktow do CRM');
SELECT pg_temp.act_as(NULL, NULL);
SELECT pg_temp.assert(
  NOT has_function_privilege('anon', 'public.admin_event_lead_scans_push_to_crm(jsonb)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.admin_event_company_sponsorships(uuid)', 'EXECUTE'),
  '32/granty: CRM-owe funkcje raportu nie sa dla anonima');

-- ---------------------------------------------------------------------------
-- SEKCJA 7: ODWOLANIE I WYGASNIECIE LINKU
-- ---------------------------------------------------------------------------
SELECT pg_temp.act_as('32a00000-0000-0000-0000-0000000000b1', '32000000-0000-0000-0000-0000000000b0');
SELECT pg_temp.assert_raises_like(
  format($q$SELECT public.admin_event_sponsor_report_link_revoke(%L)$q$, (SELECT u FROM spr_q WHERE k = 'link1')),
  'not_found', '32/odwolanie/izolacja: admin B nie odwola linku A');

SELECT pg_temp.act_as('32a00000-0000-0000-0000-0000000000a1', '11111111-1111-1111-1111-111111111111');
SELECT pg_temp.assert(
  public.admin_event_sponsor_report_link_revoke((SELECT u FROM spr_q WHERE k = 'link1'))
  AND NOT public.admin_event_sponsor_report_link_revoke((SELECT u FROM spr_q WHERE k = 'link1')),
  '32/odwolanie: pierwsze odwolanie true, drugie false (idempotentne)');
SELECT pg_temp.assert(
  (SELECT count(*) FROM public.audit_log a
    WHERE a.action = 'event.sponsor_report.link_revoked' AND a.entity_type = 'crm_company'
      AND a.entity_id = '32c00000-0000-0000-0000-0000000000c1'
      AND a.metadata->>'link_id' = (SELECT u::text FROM spr_q WHERE k = 'link1')
      AND a.metadata->>'summary_pl' LIKE U&'Odwo\0142ano link%') = 1
  AND EXISTS (SELECT 1 FROM public.domain_events d
               WHERE d.event_type = 'event_sponsor_report_link.revoked.v1'
                 AND d.aggregate_id = (SELECT u::text FROM spr_q WHERE k = 'link1')),
  '32/odwolanie: jeden wpis osi czasu firmy i zdarzenie revoked.v1');
SELECT pg_temp.assert_raises_like(
  $q$SELECT public.admin_event_sponsor_report_link_revoke('32000000-0000-0000-0000-00000000dead')$q$,
  'not_found', '32/odwolanie: nieznany link odrzucony');

SELECT pg_temp.act_as(NULL, NULL);
UPDATE public.event_sponsor_report_links k
   SET created_at = now() - interval '2 days', expires_at = now() - interval '1 day'
 WHERE k.id = (SELECT u FROM spr_q WHERE k = 'link2');
SELECT pg_temp.assert(
  public.event_sponsor_report_for_token('11111111-1111-1111-1111-111111111111',
    (SELECT t FROM spr_q WHERE k = 'link1'))->>'reason' = 'expired'
  AND public.event_sponsor_report_for_token('11111111-1111-1111-1111-111111111111',
    (SELECT t FROM spr_q WHERE k = 'link2'))->>'reason' = 'expired'
  AND (SELECT k.view_count FROM public.event_sponsor_report_links k WHERE k.id = (SELECT u FROM spr_q WHERE k = 'link1')) = 2,
  '32/token: odwolany i przeterminowany link daja expired, bez podbicia licznika');

-- ---------------------------------------------------------------------------
-- SEKCJA 8: RETENCJA I KASKADY
-- ---------------------------------------------------------------------------
INSERT INTO public.event_sponsor_exposures
  (tenant_id, event_id, sponsor_id, placement, kind, day, session_hash, first_at, last_at)
VALUES ('11111111-1111-1111-1111-111111111111', '32e00000-0000-0000-0000-0000000000e1',
        '32500000-0000-0000-0000-000000000001', 'home_strip', 'view', current_date - 500, repeat('b', 64),
        now() - interval '500 days', now() - interval '500 days');
DO $do$
DECLARE
  v_before integer := (SELECT count(*) FROM public.event_sponsor_exposures x WHERE x.day >= current_date - 30);
  v_pruned integer;
BEGIN
  -- Osobne instrukcje: podzapytanie w TEJ SAMEJ instrukcji co DELETE widzi
  -- migawke sprzed usuniecia.
  v_pruned := public.event_sponsor_exposures_prune();
  PERFORM pg_temp.assert(v_pruned >= 1
    AND NOT EXISTS (SELECT 1 FROM public.event_sponsor_exposures x WHERE x.session_hash = repeat('b', 64)),
    '32/retencja: dni starsze niz 400 usuwane');
  PERFORM public.event_sponsor_exposures_prune(1);
  PERFORM pg_temp.assert(
    (SELECT count(*) FROM public.event_sponsor_exposures x WHERE x.day >= current_date - 30) = v_before,
    '32/retencja: horyzont ponizej 30 dni jest podnoszony do 30 (swieze dane zostaja)');
END
$do$;

SELECT pg_temp.act_as('32a00000-0000-0000-0000-0000000000a1', '11111111-1111-1111-1111-111111111111');
SELECT public.admin_event_home_ad_save(jsonb_build_object(
  'id', (SELECT u FROM spr_q WHERE k = 'ad0'), 'image_url', 'https://cdn.example.org/spr-0.png',
  'sponsor_id', '32500000-0000-0000-0000-000000000002'));
DELETE FROM public.event_sponsors s WHERE s.id = '32500000-0000-0000-0000-000000000002';
SELECT pg_temp.assert(
  NOT EXISTS (SELECT 1 FROM public.event_sponsor_report_links k WHERE k.sponsor_id = '32500000-0000-0000-0000-000000000002')
  AND NOT EXISTS (SELECT 1 FROM public.event_sponsor_exposures x WHERE x.sponsor_id = '32500000-0000-0000-0000-000000000002')
  AND (SELECT a.sponsor_id IS NULL AND a.tenant_id = '11111111-1111-1111-1111-111111111111'
         FROM public.event_home_ads a WHERE a.id = (SELECT u FROM spr_q WHERE k = 'ad0'))
  AND EXISTS (SELECT 1 FROM public.event_sponsor_exposures x WHERE x.home_ad_id = (SELECT u FROM spr_q WHERE k = 'ad0')),
  '32/kaskada: odpiecie sponsora zabiera jego linki i ekspozycje, reklama zostaje (sponsor_id NULL, najemca nietkniety)');

ROLLBACK;

\echo '== 32 raport dla sponsorow: koniec =='
