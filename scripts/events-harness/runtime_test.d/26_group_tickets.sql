-- ============================================================================
-- 26_group_tickets - REJESTRACJA GRUPOWA: LIMIT, PODATEK I BILET DLA KAZDEGO
--
-- PO CO TEN PLIK ISTNIEJE
-- Zapis grupowy (20260922230000) i domkniecie go biletami z kodem QR
-- (20260923000200) przechodza przez trzy funkcje bazy i jeden trigger:
-- `event_register_group_guests` dopisuje gosci, `payments_apply_event_ticket_
-- outcome` + `_tg_event_group_follow_lead` przenosza wplate prowadzacego na
-- cala grupe, a `_event_issue_ticket_codes` wydaje kazdemu wlasny kod. Jawny
-- kod istnieje TYLKO w odpowiedzi tej ostatniej - baza trzyma skrot - wiec
-- blad w dopasowaniu wiersza to gosc bez biletu przy bramce.
--
-- CO SPRAWDZA
--   1. `event_registration_form` oddaje limit grupy i tryb podatku biletu.
--   2. Zapis bezplatny: goscie dopisani, limit grupy egzekwowany, kazda osoba
--      dostaje WLASNY kod (skrot w bazie = sha256 kodu z odpowiedzi), gosc
--      dostaje wlasny klucz samoobslugi, prowadzacy zachowuje swoj.
--   3. Wydanie ZAJMUJE zgloszenie, a wysylke odnotowuje dopiero potwierdzenie:
--      nieudana wysylka zwalnia zgloszenie i ponowienie wydaje nowy kod,
--      udana - zamyka je, wiec powtorzony webhook niczego nie rotuje.
--   4. Zapis platny: przed wplata nic nie wychodzi, po wplacie prowadzacego
--      bilety dostaje cala grupa.
--   4b. Cron widzi zgloszenie przyjete DOWOLNA droga (tu: decyzja
--      organizatora), a nie widzi oczekujacych ani zakonczonych wydarzen.
--   5. Funkcje wydania i potwierdzenia sa wylacznie dla service_role.
--
-- SPRZATANIE: caly plik siedzi w BEGIN ... ROLLBACK.
-- ============================================================================

\echo '== 26 zapis grupowy: limit, podatek, bilet dla kazdego =='

BEGIN;

CREATE TEMP TABLE grp_q (k text PRIMARY KEY, j jsonb);

INSERT INTO public.tenants (id, name, slug) VALUES
  ('c6c6c6c6-c6c6-c6c6-c6c6-c6c6c6c6c6c6', 'Tenant C6 (grupy)', 'tc6-grp')
ON CONFLICT (id) DO NOTHING;

INSERT INTO auth.users (id, email) VALUES
  ('c6000000-0000-0000-0000-000000000001', 'lead.free@example.org'),
  ('c6000000-0000-0000-0000-000000000002', 'lead.paid@example.org')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.profiles (id, tenant_id) VALUES
  ('c6000000-0000-0000-0000-000000000001', 'c6c6c6c6-c6c6-c6c6-c6c6-c6c6c6c6c6c6'),
  ('c6000000-0000-0000-0000-000000000002', 'c6c6c6c6-c6c6-c6c6-c6c6-c6c6c6c6c6c6')
ON CONFLICT (id) DO NOTHING;

-- Gosc bez konta ma jezyk z zapisu na newsletter - tak wybiera go funkcja.
INSERT INTO public.newsletter_subscribers (tenant_id, email, language) VALUES
  ('c6c6c6c6-c6c6-c6c6-c6c6-c6c6c6c6c6c6', 'guest.one@example.org', 'en');

INSERT INTO public.events
  (id, tenant_id, slug, title_pl, title_en, starts_at, status,
   registration_mode, registration_flow, capacity)
VALUES
  ('c6100000-0000-0000-0000-000000000001', 'c6c6c6c6-c6c6-c6c6-c6c6-c6c6c6c6c6c6',
   'grp-tickets', 'Kongres grupowy', 'Group congress', now() + interval '30 days',
   'published', 'form', 'instant', NULL);

INSERT INTO public.event_ticket_types
  (id, tenant_id, event_id, key, name_pl, name_en, price_cents, currency,
   quota, min_tier_rank, requires_approval, is_active, sort_order,
   group_registration_enabled, group_max_size, tax_mode)
VALUES
  ('c6200000-0000-0000-0000-000000000001', 'c6c6c6c6-c6c6-c6c6-c6c6-c6c6c6c6c6c6',
   'c6100000-0000-0000-0000-000000000001', 'free', 'Bezplatny', 'Free', 0, 'PLN',
   NULL, 0, false, true, 10, true, 3, 'inclusive'),
  ('c6200000-0000-0000-0000-000000000002', 'c6c6c6c6-c6c6-c6c6-c6c6-c6c6c6c6c6c6',
   'c6100000-0000-0000-0000-000000000001', 'paid', 'Platny', 'Paid', 10000, 'PLN',
   NULL, 0, false, true, 20, true, 25, 'exclusive');

INSERT INTO public.event_people (id, tenant_id, user_id, email, first_name, last_name) VALUES
  ('c6300000-0000-0000-0000-000000000001', 'c6c6c6c6-c6c6-c6c6-c6c6-c6c6c6c6c6c6',
   'c6000000-0000-0000-0000-000000000001', 'lead.free@example.org', 'Lidia', 'Prowadzaca'),
  ('c6300000-0000-0000-0000-000000000002', 'c6c6c6c6-c6c6-c6c6-c6c6-c6c6c6c6c6c6',
   'c6000000-0000-0000-0000-000000000002', 'lead.paid@example.org', 'Piotr', 'Placacy');

-- L1: bezplatny, zatwierdzony od reki, z kluczem samoobslugi z `event_register`.
-- L2: platny, czeka na wplate.
INSERT INTO public.event_registrations
  (id, tenant_id, event_id, person_id, ticket_type_id, status, registration_mode,
   payment_status, decided_at, decision_source, manage_token_hash, created_by)
VALUES
  ('c6400000-0000-0000-0000-000000000001', 'c6c6c6c6-c6c6-c6c6-c6c6-c6c6c6c6c6c6',
   'c6100000-0000-0000-0000-000000000001', 'c6300000-0000-0000-0000-000000000001',
   'c6200000-0000-0000-0000-000000000001', 'approved', 'form', 'not_required',
   now(), 'system', encode(sha256(convert_to('LeadFreeManageToken_0123456789ab', 'UTF8')), 'hex'),
   'c6000000-0000-0000-0000-000000000001'),
  ('c6400000-0000-0000-0000-000000000002', 'c6c6c6c6-c6c6-c6c6-c6c6-c6c6c6c6c6c6',
   'c6100000-0000-0000-0000-000000000001', 'c6300000-0000-0000-0000-000000000002',
   'c6200000-0000-0000-0000-000000000002', 'pending', 'form', 'unpaid',
   NULL, NULL, NULL, 'c6000000-0000-0000-0000-000000000002');

-- ---------------------------------------------------------------------------
-- 1) FORMULARZ ODDAJE LIMIT GRUPY I TRYB PODATKU
-- ---------------------------------------------------------------------------
SELECT set_config('nes.public_tenant', 'c6c6c6c6-c6c6-c6c6-c6c6-c6c6c6c6c6c6', false);
SELECT pg_temp.act_as(NULL, 'c6c6c6c6-c6c6-c6c6-c6c6-c6c6c6c6c6c6');

DO $$
DECLARE v jsonb; t jsonb;
BEGIN
  v := public.event_registration_form('grp-tickets');
  SELECT e INTO t FROM jsonb_array_elements(v->'tickets') e
  WHERE e->>'id' = 'c6200000-0000-0000-0000-000000000002';
  PERFORM pg_temp.assert((t->>'group_max_size')::integer = 25,
    '26/formularz: bilet oddaje limit grupy (25, nie sztywne 10)');
  PERFORM pg_temp.assert(t->>'tax_mode' = 'exclusive',
    '26/formularz: bilet oddaje tryb podatku (doliczany)');
  SELECT e INTO t FROM jsonb_array_elements(v->'tickets') e
  WHERE e->>'id' = 'c6200000-0000-0000-0000-000000000001';
  PERFORM pg_temp.assert(t->>'tax_mode' = 'inclusive' AND (t->>'group_max_size')::integer = 3,
    '26/formularz: drugi bilet ma wlasne ustawienia (wliczony, 3 osoby)');
END $$;

-- ---------------------------------------------------------------------------
-- 2) ZAPIS BEZPLATNY: GOSCIE I LIMIT GRUPY
-- ---------------------------------------------------------------------------
SELECT pg_temp.act_as('c6000000-0000-0000-0000-000000000001', 'c6c6c6c6-c6c6-c6c6-c6c6-c6c6c6c6c6c6');

DO $$
DECLARE v jsonb;
BEGIN
  v := public.event_register_group_guests('c6400000-0000-0000-0000-000000000001',
    '[{"first_name":"Gosc","last_name":"Jeden","email":"guest.one@example.org"},
      {"first_name":"Gosc","last_name":"Dwa","email":"GUEST.TWO@example.org"}]'::jsonb);
  PERFORM pg_temp.assert((v->>'added')::integer = 2, '26/grupa: dopisano dwoch gosci');
  PERFORM pg_temp.assert(
    (SELECT count(*) FROM public.event_registrations r
      WHERE r.group_lead_registration_id = 'c6400000-0000-0000-0000-000000000001'
        AND r.status = 'approved' AND r.payment_status = 'not_required') = 2,
    '26/grupa: goscie bezplatnego zapisu sa od razu potwierdzeni');
END $$;

SELECT pg_temp.assert_raises_like(
  $sql$SELECT public.event_register_group_guests('c6400000-0000-0000-0000-000000000001',
    '[{"first_name":"Gosc","last_name":"Trzy","email":"guest.extra@example.org"}]'::jsonb)$sql$,
  'group_too_large',
  '26/grupa: czwarta osoba przy limicie 3 jest odrzucona');

-- ---------------------------------------------------------------------------
-- 3) BILET DLA KAZDEGO - ZAJECIE, WYSYLKA, POTWIERDZENIE
-- ---------------------------------------------------------------------------
SELECT pg_temp.act_as();

DO $$
DECLARE
  v jsonb;
  r jsonb;
  v_lead_manage text;
BEGIN
  SELECT manage_token_hash INTO v_lead_manage FROM public.event_registrations
  WHERE id = 'c6400000-0000-0000-0000-000000000001';

  v := public._event_issue_ticket_codes('c6400000-0000-0000-0000-000000000001');
  INSERT INTO grp_q VALUES ('free', v);

  PERFORM pg_temp.assert(jsonb_array_length(v) = 3,
    '26/bilety: prowadzacy i dwoch gosci dostaja po bilecie');
  PERFORM pg_temp.assert(
    v->0->>'registration_id' = 'c6400000-0000-0000-0000-000000000001'
      AND (v->0->>'is_guest')::boolean = false,
    '26/bilety: pierwszy wiersz to prowadzacy');
  PERFORM pg_temp.assert(v->0->'manage_token' = 'null'::jsonb,
    '26/bilety: prowadzacy NIE dostaje nowego klucza samoobslugi');
  PERFORM pg_temp.assert(
    (SELECT manage_token_hash FROM public.event_registrations
      WHERE id = 'c6400000-0000-0000-0000-000000000001') = v_lead_manage,
    '26/bilety: klucz prowadzacego z potwierdzenia zapisu nadal dziala');

  FOR r IN SELECT * FROM jsonb_array_elements(v) LOOP
    PERFORM pg_temp.assert(r->>'qr_token' ~ '^[A-Za-z0-9_-]{32}$',
      format('26/bilety: kod %s ma ksztalt tokenu', r->>'email'));
    PERFORM pg_temp.assert(
      (SELECT qr_token_hash FROM public.event_registrations
        WHERE id = (r->>'registration_id')::uuid)
        = encode(sha256(convert_to(r->>'qr_token', 'UTF8')), 'hex'),
      format('26/bilety: skrot w bazie to sha256 kodu z odpowiedzi (%s)', r->>'email'));
    PERFORM pg_temp.assert(
      (SELECT ticket_code_sent_at IS NULL AND ticket_code_claimed_at = (r->>'claimed_at')::timestamptz
         FROM public.event_registrations WHERE id = (r->>'registration_id')::uuid),
      format('26/bilety: wydanie ZAJMUJE zgloszenie, ale wysylki jeszcze nie odnotowuje (%s)', r->>'email'));
    IF (r->>'is_guest')::boolean THEN
      PERFORM pg_temp.assert(
        (SELECT manage_token_hash FROM public.event_registrations
          WHERE id = (r->>'registration_id')::uuid)
          = encode(sha256(convert_to(r->>'manage_token', 'UTF8')), 'hex'),
        format('26/bilety: gosc %s dostaje wlasny klucz samoobslugi', r->>'email'));
      PERFORM pg_temp.assert(r->>'lead_first_name' = 'Lidia' AND r->>'lead_last_name' = 'Prowadzaca',
        format('26/bilety: gosc %s wie, kto go zapisal', r->>'email'));
    END IF;
  END LOOP;

  PERFORM pg_temp.assert(
    (SELECT count(DISTINCT e->>'qr_token') FROM jsonb_array_elements(v) e) = 3,
    '26/bilety: kazda osoba ma INNY kod');
  PERFORM pg_temp.assert(
    (SELECT e->>'lang' FROM jsonb_array_elements(v) e WHERE e->>'email' = 'guest.one@example.org') = 'en'
    AND (SELECT e->>'lang' FROM jsonb_array_elements(v) e WHERE e->>'email' = 'guest.two@example.org') = 'pl',
    '26/bilety: jezyk maila z newslettera, domyslnie polski');
END $$;

DO $$
DECLARE v jsonb; e jsonb;
BEGIN
  v := public._event_issue_ticket_codes('c6400000-0000-0000-0000-000000000001');
  PERFORM pg_temp.assert(jsonb_array_length(v) = 0,
    '26/bilety: rownolegle wolanie w czasie dzierzawy niczego nie rotuje');

  -- Serwer potwierdza wysylke dwoch osob, trzecia (gosc drugi) sie nie udala.
  FOR e IN SELECT * FROM jsonb_array_elements((SELECT j FROM grp_q WHERE k = 'free')) LOOP
    PERFORM pg_temp.assert(public._event_ticket_code_confirm(
      (e->>'registration_id')::uuid, (e->>'claimed_at')::timestamptz,
      e->>'email' <> 'guest.two@example.org'),
      format('26/potwierdzenie: wynik wysylki przyjety (%s)', e->>'email'));
  END LOOP;

  PERFORM pg_temp.assert(
    (SELECT count(*) FROM public.event_registrations r
      WHERE r.id IN (SELECT (x->>'registration_id')::uuid
                     FROM jsonb_array_elements((SELECT j FROM grp_q WHERE k = 'free')) x)
        AND r.ticket_code_sent_at IS NOT NULL) = 2,
    '26/potwierdzenie: wyslane bilety sa odnotowane');
  PERFORM pg_temp.assert(
    (SELECT ticket_code_sent_at IS NULL AND ticket_code_claimed_at IS NULL
       FROM public.event_registrations r
       JOIN public.event_people p ON p.id = r.person_id
      WHERE p.email_norm = 'guest.two@example.org'),
    '26/potwierdzenie: nieudana wysylka ZWALNIA zgloszenie od razu');
  PERFORM pg_temp.assert(
    NOT public._event_ticket_code_confirm(
      (SELECT r.id FROM public.event_registrations r JOIN public.event_people p ON p.id = r.person_id
        WHERE p.email_norm = 'guest.two@example.org'),
      now() - interval '1 hour', true),
    '26/potwierdzenie: potwierdzenie cudzego (starego) zajecia niczego nie odnotowuje');

  -- Ponowienie (cron) wydaje TYLKO zwolnionemu gosciowi NOWY kod i NOWY klucz,
  -- a dane prowadzacego bierze z jego zgloszenia, nie z goscia.
  v := public._event_issue_ticket_codes('c6400000-0000-0000-0000-000000000001');
  PERFORM pg_temp.assert(jsonb_array_length(v) = 1 AND v->0->>'email' = 'guest.two@example.org',
    '26/ponowienie: nowy kod dostaje tylko osoba, ktorej wysylka sie nie udala');
  PERFORM pg_temp.assert(
    v->0->>'qr_token' <> (SELECT e2->>'qr_token'
      FROM jsonb_array_elements((SELECT j FROM grp_q WHERE k = 'free')) e2
      WHERE e2->>'email' = 'guest.two@example.org')
    AND (SELECT manage_token_hash FROM public.event_registrations
          WHERE id = (v->0->>'registration_id')::uuid)
        = encode(sha256(convert_to(v->0->>'manage_token', 'UTF8')), 'hex'),
    '26/ponowienie: kod i klucz z nieudanej wysylki zastapione nowymi');
  PERFORM public._event_ticket_code_confirm(
    (v->0->>'registration_id')::uuid, (v->0->>'claimed_at')::timestamptz, false);
  v := public._event_issue_ticket_codes((v->0->>'registration_id')::uuid);
  PERFORM pg_temp.assert(v->0->>'lead_first_name' = 'Lidia',
    '26/ponowienie: gosc wydawany osobno nadal wie, kto go zapisal');
  PERFORM public._event_ticket_code_confirm(
    (v->0->>'registration_id')::uuid, (v->0->>'claimed_at')::timestamptz, true);

  PERFORM pg_temp.assert(
    jsonb_array_length(public._event_issue_ticket_codes('c6400000-0000-0000-0000-000000000001')) = 0,
    '26/bilety: po wysylce nic juz nie rotuje kodow grupy (powtorzony webhook)');
END $$;

-- ---------------------------------------------------------------------------
-- 4) ZAPIS PLATNY: BILETY DOPIERO PO WPLACIE PROWADZACEGO
-- ---------------------------------------------------------------------------
SELECT pg_temp.act_as('c6000000-0000-0000-0000-000000000002', 'c6c6c6c6-c6c6-c6c6-c6c6-c6c6c6c6c6c6');

SELECT public.event_register_group_guests('c6400000-0000-0000-0000-000000000002',
  '[{"first_name":"Gosc","last_name":"Cztery","email":"guest.four@example.org"},
    {"first_name":"Gosc","last_name":"Piec","email":"guest.five@example.org"}]'::jsonb);

SELECT pg_temp.act_as();

SELECT pg_temp.assert(
  jsonb_array_length(public._event_issue_ticket_codes('c6400000-0000-0000-0000-000000000002')) = 0,
  '26/platny: przed wplata nikt z grupy nie dostaje biletu');

INSERT INTO public.payment_orders (id, tenant_id, user_id, status, amount_cents, currency, metadata)
VALUES
  ('c6600000-0000-0000-0000-000000000001', 'c6c6c6c6-c6c6-c6c6-c6c6-c6c6c6c6c6c6',
   'c6000000-0000-0000-0000-000000000002', 'paid', 30000, 'PLN',
   jsonb_build_object('event_id', 'c6100000-0000-0000-0000-000000000001',
                      'ticket_type_id', 'c6200000-0000-0000-0000-000000000002',
                      'registration_id', 'c6400000-0000-0000-0000-000000000002'));

DO $$
DECLARE v jsonb;
BEGIN
  v := public.payments_apply_event_ticket_outcome('c6600000-0000-0000-0000-000000000001', 'paid');
  PERFORM pg_temp.assert((v->>'applied')::boolean = true
      AND v->>'registration_id' = 'c6400000-0000-0000-0000-000000000002',
    '26/platny: wplata zaksiegowana na prowadzacego');
  PERFORM pg_temp.assert(
    (SELECT count(*) FROM public.event_registrations r
      WHERE r.group_lead_registration_id = 'c6400000-0000-0000-0000-000000000002'
        AND r.payment_status = 'paid' AND r.status = 'approved') = 2,
    '26/platny: wplata prowadzacego oplaca i potwierdza cala grupe');

  v := public._event_issue_ticket_codes('c6400000-0000-0000-0000-000000000002');
  PERFORM pg_temp.assert(jsonb_array_length(v) = 3,
    '26/platny: po wplacie bilet dostaje prowadzacy i kazdy gosc');
  PERFORM pg_temp.assert(
    (SELECT count(*) FROM jsonb_array_elements(v) e
      WHERE (e->>'is_guest')::boolean AND e->>'manage_token' ~ '^[A-Za-z0-9_-]{32}$') = 2,
    '26/platny: kazdy gosc dostaje wlasny klucz samoobslugi');
  PERFORM public._event_ticket_code_confirm(
    (e->>'registration_id')::uuid, (e->>'claimed_at')::timestamptz, true)
  FROM jsonb_array_elements(v) e;
END $$;

-- ---------------------------------------------------------------------------
-- 4b) KAZDA DROGA PRZYJECIA TRAFIA DO CRONA
-- ---------------------------------------------------------------------------
DO $$
DECLARE v uuid[];
BEGIN
  -- Zgloszenie czekajace na decyzje - jeszcze nie ma czego wydawac.
  INSERT INTO public.event_people (id, tenant_id, email, first_name, last_name) VALUES
    ('c6300000-0000-0000-0000-000000000009', 'c6c6c6c6-c6c6-c6c6-c6c6-c6c6c6c6c6c6',
     'approved.later@example.org', 'Ala', 'Pozniej');
  INSERT INTO public.event_registrations
    (id, tenant_id, event_id, person_id, ticket_type_id, status, registration_mode, payment_status)
  VALUES
    ('c6400000-0000-0000-0000-000000000009', 'c6c6c6c6-c6c6-c6c6-c6c6-c6c6c6c6c6c6',
     'c6100000-0000-0000-0000-000000000001', 'c6300000-0000-0000-0000-000000000009',
     'c6200000-0000-0000-0000-000000000001', 'pending', 'form', 'not_required');
  v := public._event_ticket_codes_pending(500);
  PERFORM pg_temp.assert(NOT ('c6400000-0000-0000-0000-000000000009'::uuid = ANY(v)),
    '26/cron: zgloszenie oczekujace na decyzje NIE dostaje biletu');
  PERFORM pg_temp.assert(NOT ('c6400000-0000-0000-0000-000000000001'::uuid = ANY(v)),
    '26/cron: wyslany bilet nie wraca do kolejki');

  -- Organizator przyjmuje zgloszenie (dowolna droga konczy sie tym stanem).
  UPDATE public.event_registrations SET status = 'approved', decided_at = now(),
    decision_source = 'organizer'
  WHERE id = 'c6400000-0000-0000-0000-000000000009';
  v := public._event_ticket_codes_pending(500);
  PERFORM pg_temp.assert('c6400000-0000-0000-0000-000000000009'::uuid = ANY(v),
    '26/cron: zgloszenie przyjete przez organizatora czeka na bilet');

  -- Wydarzenie, ktore juz sie skonczylo, nie dostaje biletow wstecz.
  UPDATE public.events SET starts_at = now() - interval '3 days', ends_at = now() - interval '2 days'
  WHERE id = 'c6100000-0000-0000-0000-000000000001';
  v := public._event_ticket_codes_pending(500);
  PERFORM pg_temp.assert(NOT ('c6400000-0000-0000-0000-000000000009'::uuid = ANY(v)),
    '26/cron: zakonczone wydarzenie nie dostaje biletow');
END $$;

-- ---------------------------------------------------------------------------
-- 5) UPRAWNIENIA: JAWNE KODY TYLKO DLA SERWERA
-- ---------------------------------------------------------------------------
SELECT pg_temp.assert(
  NOT has_function_privilege('authenticated', 'public._event_issue_ticket_codes(uuid)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public._event_issue_ticket_codes(uuid)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated',
    'public._event_ticket_code_confirm(uuid, timestamptz, boolean)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public._event_ticket_codes_pending(integer)', 'EXECUTE'),
  '26/uprawnienia: anon i authenticated NIE wydaja ani nie potwierdzaja kodow');
SELECT pg_temp.assert(
  has_function_privilege('service_role', 'public._event_issue_ticket_codes(uuid)', 'EXECUTE'),
  '26/uprawnienia: service_role wydaje kody (webhook i funkcja serwerowa)');

ROLLBACK;

SELECT set_config('nes.public_tenant', '', false);
SELECT pg_temp.act_as();
