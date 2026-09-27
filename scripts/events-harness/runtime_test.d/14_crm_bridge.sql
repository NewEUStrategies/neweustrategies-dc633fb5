-- ============================================================================
-- 14_crm_bridge - FUNDAMENT FUNKCJI ORGANIZATORA: MOST CRM I PRZELACZNIKI
--
-- PO CO TEN PLIK ISTNIEJE
-- Migracje 20260926085900 i 20260926090000 stawiaja JEDYNE wejscie modulu
-- Wydarzen do kartoteki CRM (`_event_person_crm_sync`) - z niego skorzysta
-- siedem funkcji organizatora (nabor prelegentow, faktury, lejek reklam,
-- plan sali, klon edycji, raport sponsora, skaner/portfel). Bramki tekstowe
-- widza tylko KSZTALT tej funkcji; to, czy most naprawde nie wytwarza zgody,
-- nie zaklada kontaktu wbrew `p_create`, nie obniza segmentu i nie wywraca
-- transakcji wolajacego, widac dopiero przy WYKONANIU - wiec kazda z tych
-- obietnic ma tu dowod z oboma bokami (co wolno i czego nie wolno).
--
-- CZEGO TU DOWODZIMY
--   (a) nowy kontakt: dane z osoby wydarzenia, `newsletter_status` NULL,
--       segment, tagi, zrodlo, pola niestandardowe, zgoda Z DOWODU + wiersz
--       rejestru zgod, wpis osi czasu z kontraktem metadanych, stan mostu `ok`;
--   (b) istniejacy kontakt: puste pola uzupelnione, niepuste NIENADPISANE,
--       newsletter nietkniety, brak scalania po nazwisku i zakladania firm
--       z wolnego tekstu;
--   (c) segment tylko W GORE (ranga), nigdy w dol, nieznany nie wygrywa;
--   (d) tagi: bez powtorzen, kolejnosc istniejacych zachowana, limit 60/60;
--   (e) zgoda marketingowa wylacznie z dowodu - wycofana i nieobecna nic nie
--       daja, a ponowny dowod nie dubluje wiersza rejestru;
--   (f) `p_create => false` nigdy nie zaklada; brak e-maila = `skipped`;
--   (g) awaria CRM (wymuszona) = NULL + `error`, transakcja wolajacego zyje;
--       zajety telefon cudzego kontaktu jest pomijany, nie wywraca mostu;
--       nawet uszkodzona tabela stanu nie wyrzuca wyjatku do wolajacego;
--   (h) izolacja najemcow, granty (anon/authenticated nie wykonaja mostu),
--       RLS stanu mostu (admin tak, redaktor/obcy/anon nie);
--   (i) ponowienie z zapisana intencja + odmowy;
--   (j) przelaczniki `cfp`/`seating` w `admin_event_features_save`;
--   (k) CHECK segmentu zna `event_cfp`, a KAZDA jego wartosc ma range > 0;
--   (l) nowy kontakt: `crm_lead.created.v1` niesie imie i nazwisko (HubSpot
--       czyta je wylacznie z tego ladunku), istniejacy nie dostaje drugiego;
--   (m) adres zalozony ROWNOLEGLE po odczycie mostu (ON CONFLICT DO NOTHING):
--       wiersz rywala = kontakt istniejacy - newsletter_status i zgoda
--       nietkniete (zgoda tylko w gore z dowodu), imiona tylko uzupelniane;
--       rywal znikniety zaraz po konflikcie = `error` / `lead_conflict_lost`
--       do ponowienia, nie kontakt bez imion.
--
-- CZEGO NIE SPRAWDZA: samej dostawy do partnerskiego CRM/HubSpot (to kod TS,
-- `src/lib/integrations`). Triggerow zdarzen `crm_leads` harness nie stawia
-- (blok f0 w harness.sql) - sekcja (l) zaklada je tylko na czas transakcji.
--
-- SPRZATANIE. Caly plik pracuje w transakcji zakonczonej ROLLBACK-iem.
-- ============================================================================

\echo '== 14 most osoba wydarzenia -> kontakt CRM, przelaczniki organizatora =='

BEGIN;

-- ---------------------------------------------------------------------------
-- SCENOGRAFIA: dwoch najemcow; w A administrator, redaktor, zwykly uzytkownik;
-- w B administrator. Osoby wydarzenia w roznych stanach - kazda regula mostu
-- ma wlasna osobe, zeby asercje nie zalezaly od kolejnosci wywolan.
-- ---------------------------------------------------------------------------
INSERT INTO public.tenants (id, name, slug) VALUES
  ('14000000-0000-0000-0000-0000000000b0', 'Tenant 14 B', 't14b')
ON CONFLICT (id) DO NOTHING;

INSERT INTO auth.users (id, email) VALUES
  ('14a00000-0000-0000-0000-0000000000a1', 'most.admin@example.org'),
  ('14a00000-0000-0000-0000-0000000000a2', 'most.redaktor@example.org'),
  ('14a00000-0000-0000-0000-0000000000a3', 'most.uzytkownik@example.org'),
  ('14a00000-0000-0000-0000-0000000000b1', 'most.admin.b@example.org')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.user_roles (user_id, role, tenant_id) VALUES
  ('14a00000-0000-0000-0000-0000000000a1', 'admin', '11111111-1111-1111-1111-111111111111'),
  ('14a00000-0000-0000-0000-0000000000a2', 'editor', '11111111-1111-1111-1111-111111111111'),
  ('14a00000-0000-0000-0000-0000000000b1', 'admin', '14000000-0000-0000-0000-0000000000b0')
ON CONFLICT DO NOTHING;

INSERT INTO public.profiles (id, tenant_id, display_name, slug) VALUES
  ('14a00000-0000-0000-0000-0000000000a1', '11111111-1111-1111-1111-111111111111', 'Admin 14', 'most-admin'),
  ('14a00000-0000-0000-0000-0000000000a2', '11111111-1111-1111-1111-111111111111', 'Redaktor 14', 'most-redaktor'),
  ('14a00000-0000-0000-0000-0000000000a3', '11111111-1111-1111-1111-111111111111', 'Uzytkownik 14', 'most-uzytkownik'),
  ('14a00000-0000-0000-0000-0000000000b1', '14000000-0000-0000-0000-0000000000b0', 'Admin 14 B', 'most-admin-b')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.events (id, tenant_id, slug, title_pl, title_en, starts_at, status) VALUES
  ('14e00000-0000-0000-0000-0000000000e1', '11111111-1111-1111-1111-111111111111',
   'most-14', 'Kongres 14', 'Congress 14', now() + interval '30 days', 'published')
ON CONFLICT (id) DO NOTHING;

-- Firma z kartoteki (kuratorowana) - osoba wydarzenia moze na nia wskazywac.
INSERT INTO public.crm_companies (id, tenant_id, name) VALUES
  ('14c00000-0000-0000-0000-0000000000c1', '11111111-1111-1111-1111-111111111111', 'Orlen 14')
ON CONFLICT (id) DO NOTHING;

-- Istniejace kontakty CRM najemcy A (i jeden najemcy B o TYM SAMYM adresie).
INSERT INTO public.crm_leads
  (id, tenant_id, email, first_name, last_name, phone, source_type, newsletter_status,
   marketing_consent, tags)
VALUES
  -- Osoba z newslettera: imie jest, nazwiska brak, telefon jest.
  ('14d00000-0000-0000-0000-0000000000d1', '11111111-1111-1111-1111-111111111111',
   'Stala@Example.org', 'Istniejaca', '', '+48 600 000 001', 'newsletter', 'subscribed',
   false, ARRAY['lista:energia', 'event:most-14']),
  -- Klient platny: najwyzszy segment, ktorego wydarzenie nie moze obnizyc.
  ('14d00000-0000-0000-0000-0000000000d2', '11111111-1111-1111-1111-111111111111',
   'klient@example.org', 'Klient', 'Platny', NULL, 'paid_subscriber', NULL, true, '{}'),
  -- Wlasciciel telefonu, ktory osoba wydarzenia tez podala (centrala firmy).
  ('14d00000-0000-0000-0000-0000000000d3', '11111111-1111-1111-1111-111111111111',
   'centrala@example.org', 'Centrala', 'Firmy', '+48 22 555 00 00', 'manual', NULL, false, '{}'),
  -- Imiennik osoby "Nowa Osoba" z INNYM adresem - pulapka scalania po nazwisku.
  ('14d00000-0000-0000-0000-0000000000d4', '11111111-1111-1111-1111-111111111111',
   'imiennik@example.org', 'Nowa', 'Osoba', NULL, 'manual', NULL, false, '{}'),
  -- Kontakt z 59 tagami - limit 60 musi przepuscic jeszcze dokladnie jeden.
  ('14d00000-0000-0000-0000-0000000000d5', '11111111-1111-1111-1111-111111111111',
   'tagi@example.org', 'Tagi', 'Pelne', NULL, 'manual', NULL, false,
   ARRAY(SELECT 'stary:' || g FROM generate_series(1, 59) AS g)),
  -- Ten sam adres co d1, ale w najemcy B.
  ('14d00000-0000-0000-0000-0000000000b1', '14000000-0000-0000-0000-0000000000b0',
   'stala@example.org', 'Obca', 'Kartoteka', NULL, 'manual', NULL, false, ARRAY['b:tag'])
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.event_people
  (id, tenant_id, email, first_name, last_name, phone, job_title, company_text, company_id,
   social_profile_url, consent_data_processing_at, consent_marketing_at, consent_withdrawn_at,
   source)
VALUES
  -- p1: nowa osoba z dowodem zgody marketingowej, telefonem i LinkedIn-em.
  ('14f00000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   'Nowa.Osoba@Example.org', 'Nowa', 'Osoba', '+48 500 100 200', 'Analityczka',
   'Wolny Tekst Sp. z o.o.', NULL, 'https://www.linkedin.com/in/nowa-osoba',
   now(), '2026-09-01 10:00:00+00', NULL, 'self_registration'),
  -- p2: ten sam adres co istniejacy kontakt d1 (inna wielkosc liter), bez zgody,
  --     z firma z kartoteki i z telefonem, ktorego NIE wolno nadpisac.
  ('14f00000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111',
   'stala@example.org', 'Nadpisane', 'Uzupelnione', '+48 600 999 999', NULL, NULL,
   '14c00000-0000-0000-0000-0000000000c1', NULL, now(), NULL, NULL, 'self_registration'),
  -- p3: zgoda dana, ale WYCOFANA.
  ('14f00000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111',
   'wycofana@example.org', 'Wycofana', 'Zgoda', NULL, NULL, NULL, NULL, NULL,
   now(), now() - interval '2 days', now() - interval '1 day', 'self_registration'),
  -- p4: bez adresu e-mail.
  ('14f00000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111',
   NULL, 'Bez', 'Adresu', NULL, NULL, NULL, NULL, NULL, now(), now(), NULL, 'organizer'),
  -- p5: podaje telefon centrali, ktory w CRM nalezy do kontaktu d3.
  ('14f00000-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111',
   'pracownik@example.org', 'Pracownik', 'Centrali', '+48 22 555 00 00', NULL, NULL, NULL,
   NULL, now(), NULL, NULL, 'self_registration'),
  -- p6: osoba bez kontaktu w CRM - do trybu "tylko wzbogac" (p_create = false).
  ('14f00000-0000-0000-0000-000000000006', '11111111-1111-1111-1111-111111111111',
   'bez.kontaktu@example.org', 'Bez', 'Kontaktu', NULL, NULL, NULL, NULL, NULL,
   now(), now(), NULL, 'self_registration'),
  -- p7: osoba, dla ktorej CRM zostanie wymuszony w awarie.
  ('14f00000-0000-0000-0000-000000000007', '11111111-1111-1111-1111-111111111111',
   'boom@example.org', 'Awaria', 'Kartoteki', NULL, NULL, NULL, NULL, NULL,
   now(), now(), NULL, 'self_registration'),
  -- p8: klient platny (d2) zglasza wystapienie.
  ('14f00000-0000-0000-0000-000000000008', '11111111-1111-1111-1111-111111111111',
   'klient@example.org', 'Klient', 'Platny', NULL, NULL, NULL, NULL, NULL,
   now(), NULL, NULL, 'self_registration'),
  -- p9: kontakt z 59 tagami.
  ('14f00000-0000-0000-0000-000000000009', '11111111-1111-1111-1111-111111111111',
   'tagi@example.org', 'Tagi', 'Pelne', NULL, NULL, NULL, NULL, NULL,
   now(), NULL, NULL, 'self_registration'),
  -- pB: osoba najemcy B z tym samym adresem co d1 najemcy A.
  ('14f00000-0000-0000-0000-0000000000b1', '14000000-0000-0000-0000-0000000000b0',
   'stala@example.org', 'Osoba', 'Najemcy B', NULL, NULL, NULL, NULL, NULL,
   now(), now(), NULL, 'self_registration')
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- (k) KONTRAKT LIST: segment `event_cfp`, zrodlo zgody `event`, rangi
-- ---------------------------------------------------------------------------
SELECT pg_temp.assert(
  (SELECT pg_get_constraintdef(c.oid) FROM pg_constraint c
    WHERE c.conrelid = 'public.crm_leads'::regclass
      AND c.conname = 'crm_leads_source_type_check') LIKE '%''event_cfp''%',
  '14/kontrakt: CHECK segmentu kontaktu zna event_cfp');

SELECT pg_temp.assert(
  'event' = ANY (enum_range(NULL::public.crm_source_type)::text[]),
  '14/kontrakt: rejestr zgod zna zrodlo event (migracja 20260926085900)');

-- Kazda wartosc CHECK-a ma range > 0: inaczej most nigdy nie ustawilby
-- segmentu, ktory CHECK dopuszcza, a nowy segment dopisany bez rangi bylby
-- martwy. Wartosci czytane z definicji ograniczenia, nie przepisane.
SELECT pg_temp.assert(
  (SELECT bool_and(public._crm_source_type_rank(m[1]) > 0) AND count(*) = 11
     FROM regexp_matches(
       (SELECT pg_get_constraintdef(c.oid) FROM pg_constraint c
         WHERE c.conrelid = 'public.crm_leads'::regclass
           AND c.conname = 'crm_leads_source_type_check'),
       '''([a-z_]+)''', 'g') AS m),
  '14/ranga: kazda z 11 wartosci CHECK-a segmentu ma range > 0');

SELECT pg_temp.assert(
  public._crm_source_type_rank('manual') < public._crm_source_type_rank('newsletter')
  AND public._crm_source_type_rank('newsletter') = public._crm_source_type_rank('contact_form')
  AND public._crm_source_type_rank('contact_form') < public._crm_source_type_rank('registered')
  AND public._crm_source_type_rank('registered') < public._crm_source_type_rank('event_participant')
  AND public._crm_source_type_rank('event_participant') < public._crm_source_type_rank('event_cfp')
  AND public._crm_source_type_rank('event_cfp') < public._crm_source_type_rank('speaker')
  AND public._crm_source_type_rank('speaker') < public._crm_source_type_rank('careers')
  AND public._crm_source_type_rank('careers') = public._crm_source_type_rank('club_application')
  AND public._crm_source_type_rank('club_application') = public._crm_source_type_rank('expert')
  AND public._crm_source_type_rank('expert') < public._crm_source_type_rank('paid_subscriber'),
  '14/ranga: kolejnosc segmentow zgodna z udokumentowana');

SELECT pg_temp.assert(
  public._crm_source_type_rank('bogus') = 0 AND public._crm_source_type_rank(NULL) = 0,
  '14/ranga: nieznany i NULL = 0 (nigdy nie wygrywa)');

-- ---------------------------------------------------------------------------
-- (a) NOWY KONTAKT
-- ---------------------------------------------------------------------------
DO $do$
DECLARE
  v_admin  constant uuid := '14a00000-0000-0000-0000-0000000000a1';
  v_tenant constant uuid := '11111111-1111-1111-1111-111111111111';
  v_p1     constant uuid := '14f00000-0000-0000-0000-000000000001';
  v_companies integer := (SELECT count(*) FROM public.crm_companies);
  v_lead uuid;
  v_l record;
  v_c record;
  v_a record;
  v_k record;
BEGIN
  PERFORM pg_temp.act_as(v_admin, v_tenant);

  v_lead := public._event_person_crm_sync(
    v_tenant, v_p1, 'event_cfp', 'event:most-14:cfp',
    ARRAY['event:most-14', 'cfp:submitted'],
    jsonb_build_object('utm_source', 'google', 'utm_campaign', 'cfp-2026'),
    true, 'event.cfp.submitted',
    jsonb_build_object(
      'event_id', '14e00000-0000-0000-0000-0000000000e1', 'event_slug', 'most-14',
      'event_title_pl', 'Kongres 14', 'event_title_en', 'Congress 14',
      'summary_pl', 'Zgloszenie wystapienia', 'summary_en', 'Talk submitted',
      'submission_id', '14500000-0000-0000-0000-000000000001'));

  PERFORM pg_temp.assert(v_lead IS NOT NULL, '14/nowy: most zwraca id kontaktu');
  SELECT * INTO v_l FROM public.crm_leads WHERE id = v_lead;
  PERFORM pg_temp.assert(v_l.tenant_id = v_tenant AND v_l.email_norm = 'nowa.osoba@example.org',
    '14/nowy: kontakt w najemcy osoby, dopasowany po znormalizowanym e-mailu');
  PERFORM pg_temp.assert(v_l.id <> '14d00000-0000-0000-0000-0000000000d4',
    '14/nowy: imiennik z innym adresem NIE zostal scalony (brak dopasowania po nazwisku)');
  PERFORM pg_temp.assert(
    (SELECT first_name FROM public.crm_leads WHERE id = '14d00000-0000-0000-0000-0000000000d4') = 'Nowa'
    AND (SELECT aliases FROM public.crm_leads WHERE id = '14d00000-0000-0000-0000-0000000000d4') = '{}'::jsonb,
    '14/nowy: kontakt imiennika nietkniety');
  PERFORM pg_temp.assert(v_l.first_name = 'Nowa' AND v_l.last_name = 'Osoba',
    '14/nowy: imie i nazwisko z osoby wydarzenia');
  PERFORM pg_temp.assert(v_l.newsletter_status IS NULL,
    '14/nowy: newsletter_status NULL - nowy kontakt nie udaje subskrybenta');
  PERFORM pg_temp.assert(v_l.stage = 'new', '14/nowy: etap new');
  PERFORM pg_temp.assert(v_l.source_type = 'event_cfp', '14/nowy: segment event_cfp');
  PERFORM pg_temp.assert(v_l.tags = ARRAY['event:most-14', 'cfp:submitted'],
    '14/nowy: tagi w kolejnosci zadania');
  PERFORM pg_temp.assert(v_l.aliases->'sources' = '["event:most-14:cfp"]'::jsonb,
    '14/nowy: etykieta zrodla w aliases.sources');
  PERFORM pg_temp.assert(v_l.aliases#>>'{custom,utm_source,0}' = 'google'
    AND v_l.aliases#>>'{custom,utm_campaign,0}' = 'cfp-2026',
    '14/nowy: pola niestandardowe w aliases.custom');
  PERFORM pg_temp.assert(v_l.phone = '+48 500 100 200' AND v_l.phone_norm = '+48500100200',
    '14/nowy: wolny telefon przepisany');
  PERFORM pg_temp.assert(v_l.position = 'Analityczka'
    AND v_l.linkedin_url = 'https://www.linkedin.com/in/nowa-osoba',
    '14/nowy: stanowisko i LinkedIn przepisane');
  PERFORM pg_temp.assert(v_l.company = 'Wolny Tekst Sp. z o.o.' AND v_l.company_id IS NULL,
    '14/nowy: firma z wolnego tekstu tylko jako napis, bez wskazania kartoteki');
  PERFORM pg_temp.assert((SELECT count(*) FROM public.crm_companies) = v_companies,
    '14/nowy: most NIE zaklada firmy w kartotece z wolnego tekstu');
  PERFORM pg_temp.assert(v_l.marketing_consent,
    '14/nowy: zgoda marketingowa z DOWODU (consent_marketing_at bez wycofania)');

  SELECT * INTO v_c FROM public.crm_consent_log
   WHERE tenant_id = v_tenant AND lower(email) = 'nowa.osoba@example.org';
  PERFORM pg_temp.assert(v_c.source_type = 'event' AND v_c.consent_key = 'marketing'
    AND v_c.given AND v_c.form_id = 'event:most-14:cfp' AND v_c.source_id = v_p1
    AND v_c.ip IS NULL,
    '14/nowy: wiersz rejestru zgod (zrodlo event, klucz marketing, bez IP)');
  PERFORM pg_temp.assert(v_c.consent_text LIKE '%event_people.consent_marketing_at = 2026-09-01T10:00:00Z%'
    AND v_c.consent_text LIKE '%event:most-14:cfp%',
    '14/nowy: tekst dowodu wskazuje stempel zgody i etykiete zrodla');

  SELECT * INTO v_a FROM public.audit_log
   WHERE tenant_id = v_tenant AND entity_type = 'crm_lead' AND entity_id = v_lead;
  PERFORM pg_temp.assert(v_a.action = 'event.cfp.submitted' AND v_a.actor_id = v_admin,
    '14/nowy: wpis osi czasu z akcja event.* i aktorem');
  PERFORM pg_temp.assert(v_a.metadata->>'event_id' = '14e00000-0000-0000-0000-0000000000e1'
    AND v_a.metadata->>'summary_pl' = 'Zgloszenie wystapienia'
    AND v_a.metadata->>'summary_en' = 'Talk submitted'
    AND v_a.metadata->>'submission_id' = '14500000-0000-0000-0000-000000000001'
    AND v_a.metadata->>'source_label' = 'event:most-14:cfp'
    AND v_a.metadata->>'person_id' = v_p1::text,
    '14/nowy: metadane = kontrakt wolajacego + source_label + person_id');

  SELECT * INTO v_k FROM public.event_person_crm_links
   WHERE tenant_id = v_tenant AND person_id = v_p1;
  PERFORM pg_temp.assert(v_k.sync_status = 'ok' AND v_k.crm_lead_id = v_lead
    AND v_k.synced_at IS NOT NULL AND v_k.last_error IS NULL
    AND v_k.last_source_type = 'event_cfp' AND v_k.last_source_label = 'event:most-14:cfp'
    AND v_k.last_tags = ARRAY['event:most-14', 'cfp:submitted'] AND v_k.last_create,
    '14/nowy: stan mostu ok z intencja wywolania');

  -- IDEMPOTENCJA: drugie wywolanie z ta sama intencja nie dubluje niczego,
  -- a zapis bez akcji osi czasu nie dopisuje wpisu.
  PERFORM pg_temp.assert(
    public._event_person_crm_sync(v_tenant, v_p1, 'event_cfp', 'event:most-14:cfp',
      ARRAY['cfp:submitted', 'event:most-14']) = v_lead,
    '14/ponownie: to samo wywolanie trafia w ten sam kontakt');
  SELECT * INTO v_l FROM public.crm_leads WHERE id = v_lead;
  PERFORM pg_temp.assert(v_l.tags = ARRAY['event:most-14', 'cfp:submitted']
    AND v_l.aliases->'sources' = '["event:most-14:cfp"]'::jsonb,
    '14/ponownie: tagi i zrodla bez powtorzen');
  PERFORM pg_temp.assert(
    (SELECT count(*) FROM public.crm_consent_log
      WHERE tenant_id = v_tenant AND lower(email) = 'nowa.osoba@example.org') = 1,
    '14/ponownie: zgoda juz udzielona - DRUGIEGO wiersza rejestru nie ma');
  PERFORM pg_temp.assert(
    (SELECT count(*) FROM public.audit_log WHERE entity_id = v_lead) = 1,
    '14/ponownie: bez p_audit_action nie ma nowego wpisu osi czasu');
END
$do$;

-- ---------------------------------------------------------------------------
-- (b) ISTNIEJACY KONTAKT, (c) SEGMENT TYLKO W GORE, (e) ZGODA BEZ DOWODU
-- ---------------------------------------------------------------------------
DO $do$
DECLARE
  v_tenant constant uuid := '11111111-1111-1111-1111-111111111111';
  v_d1     constant uuid := '14d00000-0000-0000-0000-0000000000d1';
  v_p2     constant uuid := '14f00000-0000-0000-0000-000000000002';
  v_l record;
BEGIN
  PERFORM pg_temp.act_as('14a00000-0000-0000-0000-0000000000a1', v_tenant);

  PERFORM pg_temp.assert(
    public._event_person_crm_sync(v_tenant, v_p2, 'event_participant', 'event:most-14:registration',
      ARRAY['event:most-14', 'registration:approved']) = v_d1,
    '14/istniejacy: dopasowanie po e-mailu bez wzgledu na wielkosc liter');
  SELECT * INTO v_l FROM public.crm_leads WHERE id = v_d1;
  PERFORM pg_temp.assert(v_l.first_name = 'Istniejaca',
    '14/istniejacy: niepuste imie NIE nadpisane');
  PERFORM pg_temp.assert(v_l.last_name = 'Uzupelnione',
    '14/istniejacy: puste nazwisko uzupelnione z osoby wydarzenia');
  PERFORM pg_temp.assert(v_l.phone = '+48 600 000 001',
    '14/istniejacy: istniejacy telefon NIE nadpisany');
  PERFORM pg_temp.assert(v_l.newsletter_status = 'subscribed',
    '14/istniejacy: newsletter_status istniejacego kontaktu nietkniety');
  PERFORM pg_temp.assert(v_l.company_id = '14c00000-0000-0000-0000-0000000000c1'
    AND v_l.company = 'Orlen 14',
    '14/istniejacy: pusta firma dostaje wskazanie kartoteki z osoby wydarzenia');
  PERFORM pg_temp.assert(v_l.tags = ARRAY['lista:energia', 'event:most-14', 'registration:approved'],
    '14/tagi: istniejace zostaja na poczatku, powtorzony tag nie wraca, nowy na koncu');
  PERFORM pg_temp.assert(v_l.source_type = 'event_participant',
    '14/segment: newsletter -> event_participant (wyzsza ranga)');
  PERFORM pg_temp.assert(NOT v_l.marketing_consent,
    '14/zgoda: bez stempla zgody osoby kontakt NIE dostaje zgody marketingowej');
  PERFORM pg_temp.assert(v_l.source_count = 2,
    '14/istniejacy: licznik interakcji podbity przez crm_upsert_from_form');

  PERFORM public._event_person_crm_sync(v_tenant, v_p2, 'event_cfp', 'event:most-14:cfp');
  PERFORM pg_temp.assert(
    (SELECT source_type FROM public.crm_leads WHERE id = v_d1) = 'event_cfp',
    '14/segment: event_participant -> event_cfp');

  PERFORM public._event_person_crm_sync(v_tenant, v_p2, 'event_participant', 'event:most-14:registration');
  PERFORM pg_temp.assert(
    (SELECT source_type FROM public.crm_leads WHERE id = v_d1) = 'event_cfp',
    '14/segment: event_cfp NIE spada do event_participant');

  PERFORM public._event_person_crm_sync(v_tenant, v_p2, 'bogus', 'event:most-14:x');
  PERFORM pg_temp.assert(
    (SELECT source_type FROM public.crm_leads WHERE id = v_d1) = 'event_cfp',
    '14/segment: nieznany segment nie wygrywa (i nie lamie CHECK-a)');

  -- Klient platny zglasza wystapienie: segment zostaje paid_subscriber.
  PERFORM public._event_person_crm_sync(v_tenant, '14f00000-0000-0000-0000-000000000008',
    'speaker', 'event:most-14:speaker');
  PERFORM pg_temp.assert(
    (SELECT source_type FROM public.crm_leads WHERE id = '14d00000-0000-0000-0000-0000000000d2')
      = 'paid_subscriber',
    '14/segment: speaker NIE obniza paid_subscriber');
  PERFORM pg_temp.assert(
    (SELECT marketing_consent FROM public.crm_leads WHERE id = '14d00000-0000-0000-0000-0000000000d2'),
    '14/zgoda: istniejaca zgoda kontaktu zostaje (scalanie monotoniczne)');
  PERFORM pg_temp.assert(
    (SELECT count(*) FROM public.crm_consent_log WHERE lower(email) = 'klient@example.org') = 0,
    '14/zgoda: bez zmiany false -> true nie ma wiersza rejestru');

  -- Zgoda WYCOFANA nie jest dowodem.
  PERFORM public._event_person_crm_sync(v_tenant, '14f00000-0000-0000-0000-000000000003',
    'event_participant', 'event:most-14:registration');
  PERFORM pg_temp.assert(
    NOT (SELECT marketing_consent FROM public.crm_leads WHERE email_norm = 'wycofana@example.org'),
    '14/zgoda: wycofana zgoda NIE daje zgody marketingowej');
  PERFORM pg_temp.assert(
    (SELECT count(*) FROM public.crm_consent_log WHERE lower(email) = 'wycofana@example.org') = 0,
    '14/zgoda: wycofana zgoda nie zostawia wiersza rejestru');
END
$do$;

-- ---------------------------------------------------------------------------
-- (d) LIMIT TAGOW
-- ---------------------------------------------------------------------------
DO $do$
DECLARE
  v_tenant constant uuid := '11111111-1111-1111-1111-111111111111';
  v_tags text[];
BEGIN
  PERFORM public._event_person_crm_sync(v_tenant, '14f00000-0000-0000-0000-000000000009',
    'event_participant', 'event:most-14:registration',
    ARRAY['  ', '', 'stary:1', repeat('x', 70), 'nowy:2', 'nowy:3']);
  SELECT tags INTO v_tags FROM public.crm_leads WHERE id = '14d00000-0000-0000-0000-0000000000d5';
  PERFORM pg_temp.assert(cardinality(v_tags) = 60,
    '14/tagi: lacznie maksymalnie 60 tagow');
  PERFORM pg_temp.assert(v_tags[1] = 'stary:1' AND v_tags[59] = 'stary:59',
    '14/tagi: wszystkie istniejace tagi zachowane w kolejnosci');
  PERFORM pg_temp.assert(v_tags[60] = repeat('x', 60),
    '14/tagi: pierwszy NOWY tag przyciety do 60 znakow, puste pominiete');
  PERFORM pg_temp.assert(NOT ('nowy:2' = ANY (v_tags)),
    '14/tagi: nadwyzka ponad limit odrzucona, a nie doklejona');
END
$do$;

-- ---------------------------------------------------------------------------
-- (f) p_create = false, BRAK E-MAILA; (g) TELEFON CUDZEGO KONTAKTU
-- ---------------------------------------------------------------------------
DO $do$
DECLARE
  v_tenant constant uuid := '11111111-1111-1111-1111-111111111111';
  v_leads integer := (SELECT count(*) FROM public.crm_leads);
  v_k record;
  v_lead uuid;
BEGIN
  PERFORM pg_temp.assert(
    public._event_person_crm_sync(v_tenant, '14f00000-0000-0000-0000-000000000006',
      'event_participant', 'event:most-14:invoice', ARRAY['event:most-14'], '{}', false) IS NULL,
    '14/p_create=false: brak kontaktu -> NULL');
  PERFORM pg_temp.assert((SELECT count(*) FROM public.crm_leads) = v_leads
    AND NOT EXISTS (SELECT 1 FROM public.crm_leads WHERE email_norm = 'bez.kontaktu@example.org'),
    '14/p_create=false: kontakt NIE zostal zalozony');
  SELECT * INTO v_k FROM public.event_person_crm_links
   WHERE tenant_id = v_tenant AND person_id = '14f00000-0000-0000-0000-000000000006';
  PERFORM pg_temp.assert(v_k.sync_status = 'skipped' AND v_k.last_error = 'lead_not_found'
    AND v_k.crm_lead_id IS NULL AND v_k.synced_at IS NULL AND NOT v_k.last_create,
    '14/p_create=false: stan skipped z przyczyna lead_not_found');

  -- Ten sam tryb przy ISTNIEJACYM kontakcie wzbogaca go (nie jest "nic nie rob").
  PERFORM pg_temp.assert(
    public._event_person_crm_sync(v_tenant, '14f00000-0000-0000-0000-000000000002',
      'event_participant', 'event:most-14:invoice', ARRAY['invoice:issued'], '{}', false)
      = '14d00000-0000-0000-0000-0000000000d1',
    '14/p_create=false: istniejacy kontakt zostaje wzbogacony');
  PERFORM pg_temp.assert(
    (SELECT 'invoice:issued' = ANY (tags) FROM public.crm_leads WHERE id = '14d00000-0000-0000-0000-0000000000d1'),
    '14/p_create=false: tag doklejony do istniejacego kontaktu');

  PERFORM pg_temp.assert(
    public._event_person_crm_sync(v_tenant, '14f00000-0000-0000-0000-000000000004',
      'event_participant', 'event:most-14:registration') IS NULL,
    '14/bez e-maila: most zwraca NULL');
  SELECT * INTO v_k FROM public.event_person_crm_links
   WHERE tenant_id = v_tenant AND person_id = '14f00000-0000-0000-0000-000000000004';
  PERFORM pg_temp.assert(v_k.sync_status = 'skipped' AND v_k.last_error = 'email_missing',
    '14/bez e-maila: stan skipped z przyczyna email_missing');
  PERFORM pg_temp.assert((SELECT count(*) FROM public.crm_leads) = v_leads,
    '14/bez e-maila: zaden kontakt nie powstal');

  -- Telefon centrali nalezy do kontaktu d3: most synchronizuje osobe BEZ niego.
  v_lead := public._event_person_crm_sync(v_tenant, '14f00000-0000-0000-0000-000000000005',
    'event_participant', 'event:most-14:registration');
  PERFORM pg_temp.assert(v_lead IS NOT NULL
    AND (SELECT phone FROM public.crm_leads WHERE id = v_lead) IS NULL,
    '14/telefon: zajety numer pominiety, kontakt zalozony bez niego');
  PERFORM pg_temp.assert(
    (SELECT sync_status FROM public.event_person_crm_links
      WHERE tenant_id = v_tenant AND person_id = '14f00000-0000-0000-0000-000000000005') = 'ok',
    '14/telefon: kolizja numeru nie jest bledem synchronizacji');
  PERFORM pg_temp.assert(
    (SELECT phone FROM public.crm_leads WHERE id = '14d00000-0000-0000-0000-0000000000d3')
      = '+48 22 555 00 00',
    '14/telefon: wlasciciel numeru nietkniety');
END
$do$;

-- ---------------------------------------------------------------------------
-- (g) AWARIA CRM: NULL + error, transakcja wolajacego zyje
--
-- Awaria jest wymuszona triggerem na `crm_leads` (w tej wycofywanej
-- transakcji). Wolajacy robi WLASNY zapis przed mostem - ten zapis musi
-- przetrwac, a zapisy CRM mostu musza zniknac.
-- ---------------------------------------------------------------------------
CREATE FUNCTION public._test14_crm_boom() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.email_norm LIKE 'boom@%' THEN
    RAISE EXCEPTION 'test14 boom: kartoteka niedostepna';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER test14_crm_boom BEFORE INSERT OR UPDATE ON public.crm_leads
  FOR EACH ROW EXECUTE FUNCTION public._test14_crm_boom();

DO $do$
DECLARE
  v_tenant constant uuid := '11111111-1111-1111-1111-111111111111';
  v_p7     constant uuid := '14f00000-0000-0000-0000-000000000007';
  v_k record;
BEGIN
  UPDATE public.event_people SET notes = 'zapis wolajacego' WHERE id = v_p7;
  PERFORM pg_temp.assert(
    public._event_person_crm_sync(v_tenant, v_p7, 'event_cfp', 'event:most-14:cfp',
      ARRAY['event:most-14'], '{}', true, 'event.cfp.submitted', '{}') IS NULL,
    '14/awaria: most zwraca NULL zamiast rzucac');
  PERFORM pg_temp.assert(
    (SELECT notes FROM public.event_people WHERE id = v_p7) = 'zapis wolajacego',
    '14/awaria: zapis wolajacego PRZETRWAL awarie CRM');
  PERFORM pg_temp.assert(
    NOT EXISTS (SELECT 1 FROM public.crm_leads WHERE email_norm = 'boom@example.org')
    AND NOT EXISTS (SELECT 1 FROM public.crm_consent_log WHERE lower(email) = 'boom@example.org')
    AND NOT EXISTS (SELECT 1 FROM public.audit_log WHERE metadata->>'person_id' = v_p7::text),
    '14/awaria: zapisy CRM tego wywolania wycofane (kontakt, zgoda, os czasu)');
  SELECT * INTO v_k FROM public.event_person_crm_links
   WHERE tenant_id = v_tenant AND person_id = v_p7;
  PERFORM pg_temp.assert(v_k.sync_status = 'error' AND v_k.last_error LIKE '%test14 boom%'
    AND v_k.crm_lead_id IS NULL AND v_k.last_source_type = 'event_cfp'
    AND v_k.last_source_label = 'event:most-14:cfp' AND v_k.last_tags = ARRAY['event:most-14'],
    '14/awaria: stan error z komunikatem i intencja do ponowienia');
END
$do$;

-- Ponowienie: po usunieciu przyczyny awarii intencja jest powtorzona.
SELECT pg_temp.act_as('14a00000-0000-0000-0000-0000000000a2', '11111111-1111-1111-1111-111111111111');
SELECT pg_temp.assert_raises_like(
  $q$SELECT public.admin_event_person_crm_retry('14f00000-0000-0000-0000-000000000007')$q$,
  'forbidden: admin role required',
  '14/ponowienie: redaktor odrzucony');
SELECT pg_temp.act_as('14a00000-0000-0000-0000-0000000000a3', '11111111-1111-1111-1111-111111111111');
SELECT pg_temp.assert_raises_like(
  $q$SELECT public.admin_event_person_crm_retry('14f00000-0000-0000-0000-000000000007')$q$,
  'forbidden: admin role required',
  '14/ponowienie: zwykly uzytkownik odrzucony');
SELECT pg_temp.act_as(NULL, NULL);
SELECT pg_temp.assert_raises_like(
  $q$SELECT public.admin_event_person_crm_retry('14f00000-0000-0000-0000-000000000007')$q$,
  'forbidden: authentication required',
  '14/ponowienie: anonim odrzucony');
SELECT pg_temp.act_as('14a00000-0000-0000-0000-0000000000b1', '14000000-0000-0000-0000-0000000000b0');
SELECT pg_temp.assert_raises_like(
  $q$SELECT public.admin_event_person_crm_retry('14f00000-0000-0000-0000-000000000007')$q$,
  'not_found',
  '14/ponowienie: admin obcego najemcy nie widzi stanu osoby najemcy A');
SELECT pg_temp.act_as('14a00000-0000-0000-0000-0000000000a1', '11111111-1111-1111-1111-111111111111');
SELECT pg_temp.assert_raises_like(
  $q$SELECT public.admin_event_person_crm_retry('14f00000-0000-0000-0000-0000000000ff')$q$,
  'not_found',
  '14/ponowienie: osoba bez zapisanego stanu -> not_found');
SELECT pg_temp.assert(
  public.admin_event_person_crm_retry('14f00000-0000-0000-0000-000000000007') IS NULL,
  '14/ponowienie: przy trwajacej awarii nadal NULL (bez wyjatku do panelu)');

DROP TRIGGER test14_crm_boom ON public.crm_leads;

DO $do$
DECLARE
  v_tenant constant uuid := '11111111-1111-1111-1111-111111111111';
  v_p7     constant uuid := '14f00000-0000-0000-0000-000000000007';
  v_lead uuid;
  v_k record;
BEGIN
  v_lead := public.admin_event_person_crm_retry(v_p7);
  PERFORM pg_temp.assert(v_lead IS NOT NULL
    AND (SELECT email_norm FROM public.crm_leads WHERE id = v_lead) = 'boom@example.org',
    '14/ponowienie: po usunieciu awarii kontakt powstaje');
  SELECT * INTO v_k FROM public.event_person_crm_links
   WHERE tenant_id = v_tenant AND person_id = v_p7;
  PERFORM pg_temp.assert(v_k.sync_status = 'ok' AND v_k.last_error IS NULL
    AND v_k.crm_lead_id = v_lead,
    '14/ponowienie: stan ok, blad wyczyszczony');
  PERFORM pg_temp.assert(
    (SELECT source_type FROM public.crm_leads WHERE id = v_lead) = 'event_cfp'
    AND (SELECT tags FROM public.crm_leads WHERE id = v_lead) = ARRAY['event:most-14'],
    '14/ponowienie: zapisana intencja (segment, tagi) powtorzona');
  -- Od 20260927001400 ponowienie powtarza wpis osi czasu nieudanej intencji
  -- (dotad zdarzenie, ktorego zapis sie nie udal, nie mialo wpisu wcale);
  -- duplikatow pilnuje most (ta sama akcja i odnosnik).
  PERFORM pg_temp.assert(
    (SELECT count(*) FROM public.audit_log
      WHERE entity_id = v_lead AND action = 'event.cfp.submitted') = 1
    AND (SELECT count(*) FROM public.audit_log WHERE entity_id = v_lead) = 1
    AND v_k.pending_errors = '{}'::jsonb,
    '14/ponowienie: wpis osi czasu nieudanej intencji powtorzony raz, nic nie czeka');
END
$do$;

-- Nieprawidlowa akcja osi czasu: blad wolajacego wykryty ZANIM cokolwiek
-- trafi do CRM.
DO $do$
DECLARE
  v_tenant constant uuid := '11111111-1111-1111-1111-111111111111';
  v_tags text[] := (SELECT tags FROM public.crm_leads WHERE id = '14d00000-0000-0000-0000-0000000000d3');
BEGIN
  PERFORM pg_temp.assert(
    public._event_person_crm_sync(v_tenant, '14f00000-0000-0000-0000-000000000005',
      'speaker', 'event:most-14:speaker', ARRAY['speaker:x'], '{}', true, 'crm.lead.hacked') IS NULL,
    '14/os czasu: akcja spoza event.* -> NULL');
  PERFORM pg_temp.assert(
    (SELECT last_error FROM public.event_person_crm_links
      WHERE tenant_id = v_tenant AND person_id = '14f00000-0000-0000-0000-000000000005')
      LIKE 'invalid_audit_action:%',
    '14/os czasu: stan error z kodem invalid_audit_action');
  PERFORM pg_temp.assert(
    NOT EXISTS (SELECT 1 FROM public.crm_leads WHERE 'speaker:x' = ANY (tags))
    AND NOT EXISTS (SELECT 1 FROM public.audit_log WHERE action = 'crm.lead.hacked'),
    '14/os czasu: nic nie trafilo do CRM ani do dziennika');
  PERFORM pg_temp.assert(
    (SELECT tags FROM public.crm_leads WHERE id = '14d00000-0000-0000-0000-0000000000d3') = v_tags,
    '14/os czasu: kontakty obok nietkniete');
END
$do$;

-- NIGDY NIE RZUCA - nawet gdy nie da sie zapisac stanu mostu.
CREATE FUNCTION public._test14_links_boom() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'test14 links boom';
END $$;
CREATE TRIGGER test14_links_boom BEFORE INSERT OR UPDATE ON public.event_person_crm_links
  FOR EACH ROW EXECUTE FUNCTION public._test14_links_boom();
SELECT pg_temp.assert(
  public._event_person_crm_sync('11111111-1111-1111-1111-111111111111',
    '14f00000-0000-0000-0000-000000000003', 'event_participant', 'event:most-14:x') IS NULL,
  '14/awaria stanu: uszkodzona tabela stanu -> NULL, bez wyjatku do wolajacego');
DROP TRIGGER test14_links_boom ON public.event_person_crm_links;

-- ---------------------------------------------------------------------------
-- (h) IZOLACJA NAJEMCOW
-- ---------------------------------------------------------------------------
DO $do$
DECLARE
  v_a  constant uuid := '11111111-1111-1111-1111-111111111111';
  v_b  constant uuid := '14000000-0000-0000-0000-0000000000b0';
  v_pb constant uuid := '14f00000-0000-0000-0000-0000000000b1';
  v_a_tags text[] := (SELECT tags FROM public.crm_leads WHERE id = '14d00000-0000-0000-0000-0000000000d1');
  v_a_type text := (SELECT source_type FROM public.crm_leads WHERE id = '14d00000-0000-0000-0000-0000000000d1');
  v_lead uuid;
BEGIN
  -- Osoba najemcy B podana z najemca A: most jej nie widzi i niczego nie pisze.
  PERFORM pg_temp.assert(
    public._event_person_crm_sync(v_a, v_pb, 'event_cfp', 'event:obce:cfp', ARRAY['obce:tag']) IS NULL,
    '14/izolacja: osoba najemcy B z najemca A -> NULL');
  PERFORM pg_temp.assert(
    NOT EXISTS (SELECT 1 FROM public.event_person_crm_links WHERE person_id = v_pb)
    AND NOT EXISTS (SELECT 1 FROM public.crm_leads WHERE 'obce:tag' = ANY (tags)),
    '14/izolacja: ani stanu mostu, ani zapisu w zadnej kartotece');

  -- Osoba najemcy B we wlasnym najemcy: trafia w kontakt B, a kontakt A
  -- o TYM SAMYM adresie zostaje nietkniety.
  v_lead := public._event_person_crm_sync(v_b, v_pb, 'event_cfp', 'event:b:cfp', ARRAY['b:cfp']);
  PERFORM pg_temp.assert(v_lead = '14d00000-0000-0000-0000-0000000000b1',
    '14/izolacja: osoba B trafia w kontakt najemcy B');
  PERFORM pg_temp.assert(
    (SELECT tags FROM public.crm_leads WHERE id = '14d00000-0000-0000-0000-0000000000d1') = v_a_tags
    AND (SELECT source_type FROM public.crm_leads WHERE id = '14d00000-0000-0000-0000-0000000000d1') = v_a_type,
    '14/izolacja: kontakt najemcy A o tym samym adresie nietkniety');
  PERFORM pg_temp.assert(
    (SELECT count(*) FROM public.crm_consent_log WHERE tenant_id = v_b) = 1
    AND (SELECT count(*) FROM public.crm_consent_log
          WHERE tenant_id = v_a AND lower(email) = 'stala@example.org') = 0,
    '14/izolacja: wiersz rejestru zgod w najemcy B, nie w A');
END
$do$;

-- ---------------------------------------------------------------------------
-- (h) GRANTY I RLS
-- ---------------------------------------------------------------------------
SELECT pg_temp.assert(
  NOT has_function_privilege('anon',
    'public._event_person_crm_sync(uuid, uuid, text, text, text[], jsonb, boolean, text, jsonb)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated',
    'public._event_person_crm_sync(uuid, uuid, text, text, text[], jsonb, boolean, text, jsonb)', 'EXECUTE')
  AND has_function_privilege('service_role',
    'public._event_person_crm_sync(uuid, uuid, text, text, text[], jsonb, boolean, text, jsonb)', 'EXECUTE'),
  '14/granty: most wykonuje WYLACZNIE service_role (i funkcje SECURITY DEFINER)');
SELECT pg_temp.assert(
  NOT has_function_privilege('anon', 'public._crm_source_type_rank(text)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public._crm_source_type_rank(text)', 'EXECUTE'),
  '14/granty: ranga segmentu niedostepna dla klienta');
SELECT pg_temp.assert(
  NOT has_function_privilege('anon', 'public.admin_event_person_crm_retry(uuid)', 'EXECUTE')
  AND has_function_privilege('authenticated', 'public.admin_event_person_crm_retry(uuid)', 'EXECUTE'),
  '14/granty: ponowienie dla zalogowanego (bramka w ciele), nie dla anonima');
SELECT pg_temp.assert(
  NOT has_table_privilege('authenticated', 'public.event_person_crm_links', 'INSERT')
  AND NOT has_table_privilege('authenticated', 'public.event_person_crm_links', 'UPDATE')
  AND NOT has_table_privilege('anon', 'public.event_person_crm_links', 'SELECT'),
  '14/granty: klient nie pisze stanu mostu, anonim go nie czyta');

SELECT pg_temp.act_as('14a00000-0000-0000-0000-0000000000a1', '11111111-1111-1111-1111-111111111111');
SET ROLE authenticated;
SELECT pg_temp.assert_raises_like(
  $q$SELECT public._event_person_crm_sync('11111111-1111-1111-1111-111111111111',
       '14f00000-0000-0000-0000-000000000001', 'speaker', 'x')$q$,
  'permission denied',
  '14/granty: zalogowany (nawet admin) nie wywola mostu z klienta');
SELECT pg_temp.assert(
  (SELECT count(*) FROM public.event_person_crm_links
    WHERE tenant_id = '11111111-1111-1111-1111-111111111111') >= 7
  AND (SELECT count(*) FROM public.event_person_crm_links
        WHERE tenant_id <> '11111111-1111-1111-1111-111111111111') = 0,
  '14/RLS: admin A czyta stan mostu wlasnego najemcy i tylko jego');
RESET ROLE;

SELECT pg_temp.act_as('14a00000-0000-0000-0000-0000000000a2', '11111111-1111-1111-1111-111111111111');
SET ROLE authenticated;
SELECT pg_temp.assert(
  (SELECT count(*) FROM public.event_person_crm_links) = 0,
  '14/RLS: redaktor NIE czyta stanu mostu (modul Wydarzen jest tylko dla admina)');
RESET ROLE;

SELECT pg_temp.act_as('14a00000-0000-0000-0000-0000000000a3', '11111111-1111-1111-1111-111111111111');
SET ROLE authenticated;
SELECT pg_temp.assert(
  (SELECT count(*) FROM public.event_person_crm_links) = 0,
  '14/RLS: zwykly uzytkownik NIE czyta stanu mostu');
RESET ROLE;

SELECT pg_temp.act_as('14a00000-0000-0000-0000-0000000000b1', '14000000-0000-0000-0000-0000000000b0');
SET ROLE authenticated;
SELECT pg_temp.assert(
  (SELECT count(*) FROM public.event_person_crm_links) = 1
  AND (SELECT count(*) FROM public.event_person_crm_links
        WHERE tenant_id = '11111111-1111-1111-1111-111111111111') = 0,
  '14/RLS: admin B czyta wylacznie stan swojego najemcy');
RESET ROLE;

SELECT pg_temp.act_as(NULL, NULL);
SET ROLE anon;
SELECT pg_temp.assert_raises_like(
  $q$SELECT count(*) FROM public.event_person_crm_links$q$,
  'permission denied',
  '14/RLS: anonim nie ma nawet grantu do stanu mostu');
RESET ROLE;

-- ---------------------------------------------------------------------------
-- KLUCZE OBCE: usuniecie kontaktu zeruje wskazanie, usuniecie osoby - stan
-- ---------------------------------------------------------------------------
DO $do$
DECLARE
  v_tenant constant uuid := '11111111-1111-1111-1111-111111111111';
  v_p1     constant uuid := '14f00000-0000-0000-0000-000000000001';
  v_lead uuid := (SELECT crm_lead_id FROM public.event_person_crm_links
                   WHERE tenant_id = '11111111-1111-1111-1111-111111111111'
                     AND person_id = '14f00000-0000-0000-0000-000000000001');
BEGIN
  DELETE FROM public.audit_log WHERE entity_id = v_lead;
  DELETE FROM public.crm_leads WHERE id = v_lead;
  PERFORM pg_temp.assert(
    (SELECT crm_lead_id IS NULL AND tenant_id = v_tenant FROM public.event_person_crm_links
      WHERE person_id = v_p1),
    '14/FK: usuniecie kontaktu zeruje WYLACZNIE crm_lead_id (tenant_id zostaje)');
  DELETE FROM public.event_people WHERE id = v_p1;
  PERFORM pg_temp.assert(
    NOT EXISTS (SELECT 1 FROM public.event_person_crm_links WHERE person_id = v_p1),
    '14/FK: usuniecie osoby wydarzenia zabiera stan mostu (kaskada)');
END
$do$;

-- ---------------------------------------------------------------------------
-- (j) PRZELACZNIKI MODULOW: cfp i seating
-- ---------------------------------------------------------------------------
SELECT pg_temp.act_as('14a00000-0000-0000-0000-0000000000a1', '11111111-1111-1111-1111-111111111111');
SELECT pg_temp.assert(
  public.admin_event_features_save('14e00000-0000-0000-0000-0000000000e1',
    '{"cfp": false, "seating": false, "pages": true}'::jsonb)
    = '{"cfp": false, "seating": false}'::jsonb,
  '14/przelaczniki: cfp i seating zapisane jako wylaczenia (true nie jest zapisywane)');
SELECT pg_temp.assert(
  public.admin_event_features_save('14e00000-0000-0000-0000-0000000000e1',
    '{"sponsors": false}'::jsonb)
    = '{"cfp": false, "seating": false, "sponsors": false}'::jsonb,
  '14/przelaczniki: klucze pominiete zachowuja stan');
SELECT pg_temp.assert(
  public.admin_event_features_save('14e00000-0000-0000-0000-0000000000e1',
    '{"cfp": true, "seating": true, "sponsors": true, "wystawcy": false}'::jsonb)
    = '{}'::jsonb,
  '14/przelaczniki: ponowne wlaczenie dziala, klucz spoza listy ignorowany');
-- Osobna instrukcja: podzapytanie w TEJ SAMEJ instrukcji co wywolanie widzi
-- migawke sprzed zapisu funkcji.
SELECT pg_temp.assert(
  (SELECT features FROM public.events WHERE id = '14e00000-0000-0000-0000-0000000000e1') = '{}'::jsonb,
  '14/przelaczniki: kolumna po ponownym wlaczeniu jest pusta');
SELECT pg_temp.assert_raises_like(
  $q$SELECT public.admin_event_features_save('14e00000-0000-0000-0000-0000000000e1', '{"seating": "false"}'::jsonb)$q$,
  'invalid_feature: seating',
  '14/przelaczniki: nie-boolean odrzucony z nazwa klucza');
SELECT pg_temp.act_as('14a00000-0000-0000-0000-0000000000b1', '14000000-0000-0000-0000-0000000000b0');
SELECT pg_temp.assert_raises_like(
  $q$SELECT public.admin_event_features_save('14e00000-0000-0000-0000-0000000000e1', '{"cfp": false}'::jsonb)$q$,
  'not_found',
  '14/przelaczniki: admin obcego najemcy nie przelaczy cudzego wydarzenia');
SELECT pg_temp.act_as('14a00000-0000-0000-0000-0000000000a2', '11111111-1111-1111-1111-111111111111');
SELECT pg_temp.assert_raises_like(
  $q$SELECT public.admin_event_features_save('14e00000-0000-0000-0000-0000000000e1', '{"cfp": false}'::jsonb)$q$,
  'forbidden',
  '14/przelaczniki: redaktor odrzucony');
SELECT pg_temp.act_as(NULL, NULL);

-- ---------------------------------------------------------------------------
-- (l) PRZEKAZANIE DO HUBSPOT: `crm_lead.created.v1` NIESIE IMIE I NAZWISKO
--
-- `hubspotContactBody` (src/lib/integrations/formats.ts) czyta imiona
-- WYLACZNIE z ladunku zdarzenia, a `crm_lead.updated.v1` niesie sam e-mail
-- i etap - jedyna szansa, zeby kontakt w HubSpot mial nazwisko, to migawka
-- `crm_lead.created.v1` z WSTAWIANEGO wiersza. Most zakladajacy kontakt przez
-- `crm_upsert_from_form` z NULL-owymi imionami wysylal wiec do HubSpot kontakt
-- bez nazwiska (zgloszenie z przegladu PR #404). Harness nie stawia triggerow
-- zdarzen `crm_leads` (blok f0 w harness.sql), wiec ta sekcja zaklada je NA
-- CZAS TRANSAKCJI - funkcja przepisana ZNAK W ZNAK z 20260711220607 (ostatnia
-- definicja `tg_crm_leads_emit_events`), ROLLBACK na koncu pliku ja zabiera.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.tg_crm_leads_emit_events()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM public.emit_domain_event(
      NEW.tenant_id, 'crm_lead', NEW.id::text, 'crm_lead.created.v1',
      jsonb_build_object(
        'email', NEW.email, 'stage', NEW.stage::text,
        'first_name', NEW.first_name, 'last_name', NEW.last_name,
        'owner_id', NEW.owner_id
      )
    );
  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.stage IS DISTINCT FROM OLD.stage THEN
      PERFORM public.emit_domain_event(
        NEW.tenant_id, 'crm_lead', NEW.id::text, 'crm_lead.stage_changed.v1',
        jsonb_build_object(
          'email', NEW.email, 'old_stage', OLD.stage::text,
          'new_stage', NEW.stage::text, 'owner_id', NEW.owner_id
        )
      );
    ELSE
      PERFORM public.emit_domain_event(
        NEW.tenant_id, 'crm_lead', NEW.id::text, 'crm_lead.updated.v1',
        jsonb_build_object('email', NEW.email, 'stage', NEW.stage::text)
      );
    END IF;
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_crm_leads_emit_events ON public.crm_leads;
CREATE TRIGGER trg_crm_leads_emit_events
  AFTER INSERT OR UPDATE ON public.crm_leads
  FOR EACH ROW EXECUTE FUNCTION public.tg_crm_leads_emit_events();

-- p10: osoba spoza kartoteki - most zaklada dla niej NOWY kontakt.
INSERT INTO public.event_people
  (id, tenant_id, email, first_name, last_name, phone, job_title, company_text, company_id,
   social_profile_url, consent_data_processing_at, consent_marketing_at, consent_withdrawn_at,
   source)
VALUES
  ('14f00000-0000-0000-0000-000000000010', '11111111-1111-1111-1111-111111111111',
   'Hanna.Hubspot@Example.org', ' Hanna ', 'Hubspot', '+48 511 222 333', 'Dyrektorka',
   NULL, NULL, 'https://www.linkedin.com/in/hanna-hubspot', now(), NULL, NULL,
   'self_registration')
ON CONFLICT (id) DO NOTHING;

DO $do$
DECLARE
  v_tenant constant uuid := '11111111-1111-1111-1111-111111111111';
  v_p10    constant uuid := '14f00000-0000-0000-0000-000000000010';
  v_p2     constant uuid := '14f00000-0000-0000-0000-000000000002';
  v_d1     constant uuid := '14d00000-0000-0000-0000-0000000000d1';
  v_lead uuid;
  v_payload jsonb;
  v_l record;
BEGIN
  PERFORM pg_temp.act_as('14a00000-0000-0000-0000-0000000000a1', v_tenant);

  v_lead := public._event_person_crm_sync(
    v_tenant, v_p10, 'event_participant', 'event:most-14:registration',
    ARRAY['event:most-14']);
  PERFORM pg_temp.assert(v_lead IS NOT NULL
    AND (SELECT email_norm FROM public.crm_leads WHERE id = v_lead) = 'hanna.hubspot@example.org',
    '14/hubspot: nowy kontakt zalozony po e-mailu osoby');

  PERFORM pg_temp.assert(
    (SELECT count(*) FROM public.domain_events
      WHERE tenant_id = v_tenant AND aggregate_type = 'crm_lead'
        AND aggregate_id = v_lead::text AND event_type = 'crm_lead.created.v1') = 1,
    '14/hubspot: nowy kontakt = DOKLADNIE jedno crm_lead.created.v1');
  SELECT d.payload INTO v_payload
    FROM public.domain_events d
   WHERE d.tenant_id = v_tenant AND d.aggregate_type = 'crm_lead'
     AND d.aggregate_id = v_lead::text AND d.event_type = 'crm_lead.created.v1';
  PERFORM pg_temp.assert(
    v_payload->>'first_name' = 'Hanna' AND v_payload->>'last_name' = 'Hubspot'
    AND lower(v_payload->>'email') = 'hanna.hubspot@example.org',
    '14/hubspot: crm_lead.created.v1 niesie imie i nazwisko (przyciete) oraz e-mail');

  -- Stan koncowy jak przy zalozeniu przez `crm_upsert_from_form`: jedno
  -- zrodlo, bez aliasow telefonu/stanowiska/LinkedIn, pola przepisane.
  SELECT * INTO v_l FROM public.crm_leads WHERE id = v_lead;
  PERFORM pg_temp.assert(v_l.source_count = 1
    AND v_l.aliases = jsonb_build_object('sources', jsonb_build_array('event:most-14:registration')),
    '14/hubspot: licznik zrodel 1, aliasy tylko ze zrodlem (bez phones/positions/linkedins)');
  PERFORM pg_temp.assert(v_l.first_name = 'Hanna' AND v_l.last_name = 'Hubspot'
    AND v_l.phone = '+48 511 222 333' AND v_l.phone_norm = '+48511222333'
    AND v_l.position = 'Dyrektorka'
    AND v_l.linkedin_url = 'https://www.linkedin.com/in/hanna-hubspot'
    AND v_l.newsletter_status IS NULL AND v_l.stage = 'new'
    AND v_l.source_type = 'event_participant' AND v_l.tags = ARRAY['event:most-14']
    AND NOT v_l.marketing_consent,
    '14/hubspot: dane osoby, etap, segment i tagi jak dotad; zgoda bez dowodu nie powstaje');

  -- KONTRAPUNKT: istniejacy kontakt (d1, dopasowany po e-mailu w sekcji b)
  -- nie dostaje DRUGIEGO zdarzenia zalozenia - tylko aktualizacje, ktore
  -- trigger emituje (to dowod, ze trigger zyje i ze cisza nie jest przypadkiem).
  PERFORM public._event_person_crm_sync(
    v_tenant, v_p2, 'event_participant', 'event:most-14:registration',
    ARRAY['event:most-14']);
  PERFORM pg_temp.assert(
    NOT EXISTS (SELECT 1 FROM public.domain_events
                 WHERE aggregate_type = 'crm_lead' AND aggregate_id = v_d1::text
                   AND event_type = 'crm_lead.created.v1')
    AND EXISTS (SELECT 1 FROM public.domain_events
                 WHERE aggregate_type = 'crm_lead' AND aggregate_id = v_d1::text
                   AND event_type = 'crm_lead.updated.v1'),
    '14/hubspot: istniejacy kontakt - bez crm_lead.created.v1, same aktualizacje');
END
$do$;

-- ---------------------------------------------------------------------------
-- (m) ADRES ZALOZONY ROWNOLEGLE: WIERSZ RYWALA TO KONTAKT ISTNIEJACY
--
-- Most czyta kontakt po e-mailu, a gdy go nie ma - wstawia wlasny wiersz
-- z ON CONFLICT (tenant_id, email_norm) DO NOTHING. Jesli miedzy odczytem
-- a wstawieniem inna transakcja zalozy ten sam adres (np. potwierdzenie
-- newslettera przez `newsletter_to_lead`), wstawienie nic nie robi, a wiersz
-- nalezy do rywala. Pierwsza wersja migracji 20260927000900 decydowala wtedy
-- po nieaktualnym `v_existing IS NULL` i ustawiala rywalowi
-- `newsletter_status = NULL` (przeglad PR #410, Codex).
--
-- JAK TO SYMULUJEMY. Dwoch transakcji w jednej sesji psql nie da sie
-- przeplesc, wiec "wiersz pojawil sie po odczycie" robi trigger BEFORE INSERT
-- na `crm_leads`: gdy most (poziom 1, `source_count = 0`) wstawia adres
-- z tabeli `_test14_race`, trigger NAJPIERW zaklada ten sam adres jako
-- kontakt newslettera. Unikalny indeks widzi wiersz rywala, wiec wstawienie
-- mostu konczy sie DO NOTHING - dokladnie ta sama sciezka, co po zatwierdzeniu
-- rownoleglej transakcji w READ COMMITTED. Wariant "rywal zniknal" doklada
-- trigger AFTER INSERT FOR EACH STATEMENT (odpala sie tez po DO NOTHING),
-- ktory usuwa wiersz rywala, zanim most zdazy go ponownie przeczytac.
-- ---------------------------------------------------------------------------
CREATE TABLE public._test14_race (
  email_norm        text PRIMARY KEY,
  newsletter_status text,
  marketing_consent boolean NOT NULL,
  vanish            boolean NOT NULL DEFAULT false,
  rival             uuid,
  fired             integer NOT NULL DEFAULT 0
);

CREATE FUNCTION public._test14_race_rival() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_r public._test14_race%ROWTYPE;
  v_rival uuid;
BEGIN
  -- Tylko wlasne wstawienie mostu (`source_count = 0`), nie zagniezdzone
  -- wstawienie rywala i nie sciezka `crm_upsert_from_form` (`source_count 1`).
  IF pg_trigger_depth() > 1 OR NEW.source_count <> 0 THEN
    RETURN NEW;
  END IF;
  SELECT * INTO v_r FROM public._test14_race r
   WHERE r.email_norm = NEW.email_norm AND r.fired = 0;
  IF NOT FOUND THEN
    RETURN NEW;
  END IF;
  INSERT INTO public.crm_leads
    (tenant_id, email, first_name, last_name, source_type, newsletter_status,
     marketing_consent, tags)
  VALUES
    (NEW.tenant_id, NEW.email, 'Rywal', '', 'newsletter', v_r.newsletter_status,
     v_r.marketing_consent, ARRAY['newsletter:doi'])
  RETURNING id INTO v_rival;
  UPDATE public._test14_race SET fired = fired + 1, rival = v_rival
   WHERE email_norm = v_r.email_norm;
  RETURN NEW;
END $$;
CREATE TRIGGER test14_race_rival BEFORE INSERT ON public.crm_leads
  FOR EACH ROW EXECUTE FUNCTION public._test14_race_rival();

INSERT INTO public._test14_race (email_norm, newsletter_status, marketing_consent, vanish) VALUES
  -- m1: rywal = potwierdzony subskrybent ze zgoda; osoba BEZ dowodu zgody.
  ('wyscig.newsletter@example.org', 'confirmed', true, false),
  -- m2: rywal = subskrypcja w toku, bez zgody; osoba Z dowodem zgody.
  ('wyscig.zgoda@example.org', 'pending', false, false),
  -- m3: rywal znika zaraz po konflikcie.
  ('wyscig.znika@example.org', 'confirmed', true, true);

INSERT INTO public.event_people
  (id, tenant_id, email, first_name, last_name, phone, job_title, company_text, company_id,
   social_profile_url, consent_data_processing_at, consent_marketing_at, consent_withdrawn_at,
   source)
VALUES
  ('14f00000-0000-0000-0000-000000000011', '11111111-1111-1111-1111-111111111111',
   'Wyscig.Newsletter@Example.org', 'Wiktor', 'Wyscigowy', NULL, 'Ekspertka', NULL, NULL,
   NULL, now(), NULL, NULL, 'self_registration'),
  ('14f00000-0000-0000-0000-000000000012', '11111111-1111-1111-1111-111111111111',
   'wyscig.zgoda@example.org', 'Zofia', 'Zgodna', NULL, NULL, NULL, NULL,
   NULL, now(), '2026-09-02 08:00:00+00', NULL, 'self_registration'),
  ('14f00000-0000-0000-0000-000000000013', '11111111-1111-1111-1111-111111111111',
   'wyscig.znika@example.org', 'Zenon', 'Znikniety', NULL, NULL, NULL, NULL,
   NULL, now(), NULL, NULL, 'self_registration')
ON CONFLICT (id) DO NOTHING;

-- m1 + m2: rywal zostaje - most go dopasowuje i traktuje jak istniejacy kontakt.
DO $do$
DECLARE
  v_tenant constant uuid := '11111111-1111-1111-1111-111111111111';
  v_p11    constant uuid := '14f00000-0000-0000-0000-000000000011';
  v_p12    constant uuid := '14f00000-0000-0000-0000-000000000012';
  v_lead uuid;
  v_race record;
  v_l record;
  v_k record;
BEGIN
  PERFORM pg_temp.act_as('14a00000-0000-0000-0000-0000000000a1', v_tenant);
  PERFORM pg_temp.assert(
    NOT EXISTS (SELECT 1 FROM public.crm_leads
                 WHERE tenant_id = v_tenant AND email_norm LIKE 'wyscig.%'),
    '14/wyscig: przed wywolaniem adresow nie ma w kartotece (most je wstawia)');

  v_lead := public._event_person_crm_sync(
    v_tenant, v_p11, 'event_participant', 'event:most-14:registration',
    ARRAY['event:most-14'], '{}', true, 'event.registration.approved',
    jsonb_build_object('event_id', '14e00000-0000-0000-0000-0000000000e1'));

  SELECT * INTO v_race FROM public._test14_race WHERE email_norm = 'wyscig.newsletter@example.org';
  PERFORM pg_temp.assert(v_race.fired = 1 AND v_race.rival IS NOT NULL,
    '14/wyscig: rywal zalozyl adres PO odczycie mostu (symulacja zadzialala)');
  PERFORM pg_temp.assert(v_lead = v_race.rival,
    '14/wyscig: most zwraca wiersz rywala (dopasowanie po e-mailu)');
  PERFORM pg_temp.assert(
    (SELECT count(*) FROM public.crm_leads
      WHERE tenant_id = v_tenant AND email_norm = 'wyscig.newsletter@example.org') = 1,
    '14/wyscig: jeden kontakt na adres - bez duplikatu');

  SELECT * INTO v_l FROM public.crm_leads WHERE id = v_lead;
  PERFORM pg_temp.assert(v_l.newsletter_status = 'confirmed',
    '14/wyscig: newsletter_status rywala ZACHOWANY (nie NULL)');
  PERFORM pg_temp.assert(v_l.marketing_consent,
    '14/wyscig: zgoda rywala zachowana mimo braku dowodu u osoby');
  PERFORM pg_temp.assert(
    NOT EXISTS (SELECT 1 FROM public.crm_consent_log
                 WHERE tenant_id = v_tenant AND lower(email) = 'wyscig.newsletter@example.org'),
    '14/wyscig: bez dowodu most nie pisze rejestru zgod');
  PERFORM pg_temp.assert(v_l.first_name = 'Rywal' AND v_l.last_name = 'Wyscigowy',
    '14/wyscig: niepuste imie rywala nienadpisane, puste nazwisko uzupelnione');
  PERFORM pg_temp.assert(v_l.source_type = 'event_participant'
    AND v_l.tags = ARRAY['newsletter:doi', 'event:most-14'],
    '14/wyscig: segment w gore (newsletter -> event_participant), tagi doklejone');
  PERFORM pg_temp.assert(v_l.source_count = 2
    AND v_l.aliases->'sources' = '["event:most-14:registration"]'::jsonb,
    '14/wyscig: zrodlo dopisane jak do istniejacego kontaktu (licznik 1 -> 2)');
  PERFORM pg_temp.assert(
    (SELECT count(*) FROM public.domain_events
      WHERE aggregate_type = 'crm_lead' AND aggregate_id = v_lead::text
        AND event_type = 'crm_lead.created.v1') = 1,
    '14/wyscig: jedno crm_lead.created.v1 (rywala) - most nie zalozyl drugiego kontaktu');
  PERFORM pg_temp.assert(
    EXISTS (SELECT 1 FROM public.audit_log
             WHERE tenant_id = v_tenant AND entity_type = 'crm_lead' AND entity_id = v_lead
               AND action = 'event.registration.approved'),
    '14/wyscig: wpis osi czasu przypiety do kontaktu rywala');
  SELECT * INTO v_k FROM public.event_person_crm_links
   WHERE tenant_id = v_tenant AND person_id = v_p11;
  PERFORM pg_temp.assert(v_k.sync_status = 'ok' AND v_k.crm_lead_id = v_lead
    AND v_k.last_error IS NULL,
    '14/wyscig: stan mostu ok ze wskazaniem kontaktu rywala');

  -- m2: dowod zgody u osoby PODNOSI zgode rywala, subskrypcja w toku zostaje.
  v_lead := public._event_person_crm_sync(
    v_tenant, v_p12, 'event_cfp', 'event:most-14:cfp', ARRAY['cfp:submitted']);
  SELECT * INTO v_race FROM public._test14_race WHERE email_norm = 'wyscig.zgoda@example.org';
  PERFORM pg_temp.assert(v_race.fired = 1 AND v_lead = v_race.rival,
    '14/wyscig+zgoda: most dopasowal wiersz rywala zalozony po odczycie');
  SELECT * INTO v_l FROM public.crm_leads WHERE id = v_lead;
  PERFORM pg_temp.assert(v_l.newsletter_status = 'pending',
    '14/wyscig+zgoda: subskrypcja w toku rywala zachowana (nie NULL)');
  PERFORM pg_temp.assert(v_l.marketing_consent AND v_l.source_type = 'event_cfp',
    '14/wyscig+zgoda: zgoda false -> true Z DOWODU osoby, segment w gore');
  PERFORM pg_temp.assert(
    (SELECT count(*) FROM public.crm_consent_log
      WHERE tenant_id = v_tenant AND lower(email) = 'wyscig.zgoda@example.org'
        AND source_type = 'event' AND consent_key = 'marketing' AND given
        AND source_id = v_p12) = 1,
    '14/wyscig+zgoda: dokladnie jeden wiersz rejestru zgod ze zrodlem event');
END
$do$;

-- m3: rywal znika zaraz po konflikcie - most nie zaklada kontaktu bez imion
-- przez `crm_upsert_from_form`, tylko zostawia stan `error` z kodem
-- `lead_conflict_lost` do ponowienia (bez wyjatku).
CREATE FUNCTION public._test14_race_vanish() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF pg_trigger_depth() = 1 THEN
    DELETE FROM public.crm_leads l
     USING public._test14_race r
     WHERE r.vanish AND r.fired = 1 AND l.id = r.rival;
  END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER test14_race_vanish AFTER INSERT ON public.crm_leads
  FOR EACH STATEMENT EXECUTE FUNCTION public._test14_race_vanish();

DO $do$
DECLARE
  v_tenant constant uuid := '11111111-1111-1111-1111-111111111111';
  v_p13    constant uuid := '14f00000-0000-0000-0000-000000000013';
  v_k record;
BEGIN
  PERFORM pg_temp.act_as('14a00000-0000-0000-0000-0000000000a1', v_tenant);
  UPDATE public.event_people SET notes = 'zapis wolajacego m3' WHERE id = v_p13;
  PERFORM pg_temp.assert(
    public._event_person_crm_sync(
      v_tenant, v_p13, 'event_participant', 'event:most-14:registration',
      ARRAY['event:most-14'], '{}', true, 'event.registration.approved', '{}') IS NULL,
    '14/wyscig+znika: most zwraca NULL zamiast rzucac');
  PERFORM pg_temp.assert(
    (SELECT notes FROM public.event_people WHERE id = v_p13) = 'zapis wolajacego m3',
    '14/wyscig+znika: zapis wolajacego przetrwal');
  PERFORM pg_temp.assert(
    (SELECT fired = 1 AND rival IS NOT NULL FROM public._test14_race
      WHERE email_norm = 'wyscig.znika@example.org'),
    '14/wyscig+znika: rywal zalozyl adres po odczycie mostu i zniknal (symulacja zadzialala)');
  SELECT * INTO v_k FROM public.event_person_crm_links
   WHERE tenant_id = v_tenant AND person_id = v_p13;
  PERFORM pg_temp.assert(v_k.sync_status = 'error'
    AND v_k.last_error = 'lead_conflict_lost' AND v_k.crm_lead_id IS NULL
    AND v_k.synced_at IS NULL AND v_k.last_create,
    '14/wyscig+znika: stan error z kodem lead_conflict_lost i intencja do ponowienia');
  PERFORM pg_temp.assert(
    NOT EXISTS (SELECT 1 FROM public.crm_leads
                 WHERE tenant_id = v_tenant AND email_norm = 'wyscig.znika@example.org')
    AND NOT EXISTS (SELECT 1 FROM public.audit_log WHERE metadata->>'person_id' = v_p13::text),
    '14/wyscig+znika: brak kontaktu bez imion i brak wpisu osi czasu');
END
$do$;

DROP TRIGGER test14_race_vanish ON public.crm_leads;
DROP TRIGGER test14_race_rival ON public.crm_leads;

-- Ponowienie po ustaniu wyscigu zaklada kontakt z imionami i bez newslettera.
DO $do$
DECLARE
  v_tenant constant uuid := '11111111-1111-1111-1111-111111111111';
  v_p13    constant uuid := '14f00000-0000-0000-0000-000000000013';
  v_lead uuid;
  v_l record;
BEGIN
  PERFORM pg_temp.act_as('14a00000-0000-0000-0000-0000000000a1', v_tenant);
  v_lead := public.admin_event_person_crm_retry(v_p13);
  SELECT * INTO v_l FROM public.crm_leads WHERE id = v_lead;
  PERFORM pg_temp.assert(v_l.email_norm = 'wyscig.znika@example.org'
    AND v_l.first_name = 'Zenon' AND v_l.last_name = 'Znikniety'
    AND v_l.newsletter_status IS NULL AND v_l.source_count = 1,
    '14/wyscig+znika: ponowienie zaklada kontakt z imionami, newsletter NULL');
  PERFORM pg_temp.assert(
    (SELECT sync_status FROM public.event_person_crm_links
      WHERE tenant_id = v_tenant AND person_id = v_p13) = 'ok',
    '14/wyscig+znika: po ponowieniu stan ok');
END
$do$;

ROLLBACK;
