-- ============================================================================
-- 21_register_entry_hardening - WEJSCIE ZAPISU NA WYDARZENIE (B1a,
-- 20261012140000..140200)
--
-- PO CO TEN PLIK ISTNIEJE
-- Zapis przeszedl z przegladarki (`event_register`, anon) do funkcji
-- serwerowej (`event_register_for_client`, service_role) nad jednym rdzeniem
-- `_event_register`. pgTAP (event_register_entry_hardening_test.sql,
-- event_registration_identity_integrity_test.sql) przypina to na pelnym
-- schemacie; ten plik sprawdza te same tezy na REPLAYU modulu - na cialach,
-- ktore dostaja wszystkie pozostale pliki harnessu (20_registration,
-- 24-29, 42, 73 woluja wrapper zgodnosci nad tym samym rdzeniem).
--
-- CO SPRAWDZA
--   1. REG-04: kubelek adresu (12 / 10 min dla goscia) liczy KAZDA probe -
--      takze odrzucona przez rdzen - a 13. proba z adresu jest odrzucona bez
--      zapisu; inny adres przechodzi.
--   2. REG-04: odpowiedz dla niezweryfikowanego jest STALA (utworzono = juz
--      zapisany), `sold_out` nie zalezy od adresu; zweryfikowany wlasciciel
--      adresu dostaje poswiadczenia i `already_registered` wprost.
--   3. REG-05: formularz bez biletow ukrytych; bilet ukryty bez kodu ->
--      `not_found`; zly kod odslaniajacy zliczony; dobry kod otwiera zapis.
--   4. REG-13: `event_ended` w zapisie i w formularzu.
--   5. REG-16: oferta z chwili zapisu przezywa koniec early birda (kontekst
--      platnosci), wygasla oferta -> cena biezaca.
--   6. REG-01 / REG-02: konto X z cudzym adresem nie wiaze osoby; anonim nie
--      zmienia istniejacej kartoteki (dane w `submitted_profile`, zgody
--      marketingu tylko `pending`), dowod adresu z serwera.
--
-- SPRZATANIE: caly plik w BEGIN ... ROLLBACK.
-- ============================================================================
\echo '== 21 wejscie zapisu: kubelek, odpowiedz neutralna, bilety ukryte, koniec, oferta =='

BEGIN;

INSERT INTO public.tenants (id, name, slug) VALUES
  ('c1a1c1a1-c1a1-c1a1-c1a1-c1a1c1a1c1a1', 'Tenant C1A (wejscie zapisu)', 'tc1a-erh');

-- 01 potwierdzone (wlasciciel), 02 potwierdzone (cudze adresy), 03 NIEpotwierdzone.
INSERT INTO auth.users (id, email) VALUES
  ('c1a00000-0000-0000-0000-000000000001', 'wlasciciel.erh@example.org'),
  ('c1a00000-0000-0000-0000-000000000002', 'iks.erh@example.org');
INSERT INTO auth.users (id, email, email_confirmed_at) VALUES
  ('c1a00000-0000-0000-0000-000000000003', 'niepotw.erh@example.org', NULL);

INSERT INTO public.events (id, tenant_id, slug, title_pl, title_en, starts_at, ends_at, status,
  registration_mode, registration_flow) VALUES
  ('c1a10000-0000-0000-0000-000000000001', 'c1a1c1a1-c1a1-c1a1-c1a1-c1a1c1a1c1a1', 'erh-glowne',
   'Glowne', 'Main', now() + interval '30 days', NULL, 'published', 'rsvp', 'instant'),
  ('c1a10000-0000-0000-0000-000000000002', 'c1a1c1a1-c1a1-c1a1-c1a1-c1a1c1a1c1a1', 'erh-po',
   'Po', 'Ended', now() - interval '2 days', now() - interval '1 hour', 'published', 'rsvp', 'instant'),
  ('c1a10000-0000-0000-0000-000000000003', 'c1a1c1a1-c1a1-c1a1-c1a1-c1a1c1a1c1a1', 'erh-kubelek',
   'Kubelek', 'Bucket', now() + interval '30 days', NULL, 'published', 'rsvp', 'instant'),
  ('c1a10000-0000-0000-0000-000000000004', 'c1a1c1a1-c1a1-c1a1-c1a1-c1a1c1a1c1a1', 'erh-kartoteka',
   'Kartoteka', 'Records', now() + interval '30 days', NULL, 'published', 'rsvp', 'instant');

-- 01 bezplatny, 02 wyprzedany (pula 1, bez rezerwy), 03 platny z early birdem,
-- 04 ukryty bez kodu dostepu, 05 bezplatny na wydarzeniu `erh-kartoteka`.
INSERT INTO public.event_ticket_types (id, tenant_id, event_id, key, name_pl, name_en, price_cents, currency,
  early_bird_price_cents, early_bird_until, quota, waitlist_enabled, is_hidden, min_tier_rank,
  requires_approval, is_active, sort_order) VALUES
  ('c1a20000-0000-0000-0000-000000000001', 'c1a1c1a1-c1a1-c1a1-c1a1-c1a1c1a1c1a1',
   'c1a10000-0000-0000-0000-000000000001', 'erh_wolny', 'Wolny', 'Free', 0, 'PLN', NULL, NULL,
   NULL, true, false, 0, false, true, 10),
  ('c1a20000-0000-0000-0000-000000000002', 'c1a1c1a1-c1a1-c1a1-c1a1-c1a1c1a1c1a1',
   'c1a10000-0000-0000-0000-000000000001', 'erh_pelny', 'Pelny', 'Full', 0, 'PLN', NULL, NULL,
   1, false, false, 0, false, true, 20),
  ('c1a20000-0000-0000-0000-000000000003', 'c1a1c1a1-c1a1-c1a1-c1a1-c1a1c1a1c1a1',
   'c1a10000-0000-0000-0000-000000000001', 'erh_platny', 'Platny', 'Paid', 10000, 'PLN',
   5000, now() + interval '1 hour', NULL, true, false, 0, false, true, 30),
  ('c1a20000-0000-0000-0000-000000000004', 'c1a1c1a1-c1a1-c1a1-c1a1-c1a1c1a1c1a1',
   'c1a10000-0000-0000-0000-000000000001', 'erh_ukryty', 'Ukryty', 'Hidden', 0, 'PLN', NULL, NULL,
   NULL, true, true, 0, false, true, 40);

INSERT INTO public.b2b_coupons (id, tenant_id, code, name, discount_kind, active, event_ids,
  ticket_type_ids, applies_discount, reveals_hidden) VALUES
  ('c1a30000-0000-0000-0000-000000000001', 'c1a1c1a1-c1a1-c1a1-c1a1-c1a1c1a1c1a1', 'ODSLON', 'Odslona',
   'percent', true, ARRAY['c1a10000-0000-0000-0000-000000000001']::uuid[],
   ARRAY['c1a20000-0000-0000-0000-000000000004']::uuid[], false, true);

-- Zajete jedyne miejsce biletu 02. Osoba „ofiara" z wycofanymi zgodami.
INSERT INTO public.event_people (id, tenant_id, email, first_name, last_name, phone,
  consent_data_processing_at, consent_withdrawn_at) VALUES
  ('c1a50000-0000-0000-0000-000000000001', 'c1a1c1a1-c1a1-c1a1-c1a1-c1a1c1a1c1a1',
   'zajety.erh@example.org', 'Zajety', 'Adres', NULL, now() - interval '30 days', NULL),
  ('c1a50000-0000-0000-0000-000000000002', 'c1a1c1a1-c1a1-c1a1-c1a1-c1a1c1a1c1a1',
   'ofiara.erh@example.org', 'Anna', 'Nowak', '+48 600 000 001', now() - interval '30 days',
   now() - interval '10 days'),
  ('c1a50000-0000-0000-0000-000000000003', 'c1a1c1a1-c1a1-c1a1-c1a1-c1a1c1a1c1a1',
   'igrek.erh@example.org', 'Igrek', 'Gosc', NULL, now() - interval '30 days', NULL);
INSERT INTO public.event_registrations (tenant_id, event_id, person_id, ticket_type_id, status,
  registration_mode, source) VALUES
  ('c1a1c1a1-c1a1-c1a1-c1a1-c1a1c1a1c1a1', 'c1a10000-0000-0000-0000-000000000001',
   'c1a50000-0000-0000-0000-000000000001', 'c1a20000-0000-0000-0000-000000000002',
   'approved', 'rsvp', 'self_registration');

CREATE TEMP TABLE erh21 (k text PRIMARY KEY, v jsonb) ON COMMIT DROP;
CREATE TEMP TABLE erh21_victim ON COMMIT DROP AS
  SELECT to_jsonb(p) AS row FROM public.event_people p
   WHERE p.id = 'c1a50000-0000-0000-0000-000000000002';

-- Wywolanie jak eventRegistration.server.ts: najemca z hosta, konto z sesji,
-- solony skrot adresu i przegladarka - argumentami.
CREATE FUNCTION pg_temp.erh21(p_uid uuid, p_ip text, p_payload jsonb)
RETURNS jsonb LANGUAGE sql AS $$
  SELECT public.event_register_for_client(
    'c1a1c1a1-c1a1-c1a1-c1a1-c1a1c1a1c1a1', p_uid, p_ip, 'harness/21', p_payload)
$$;
CREATE FUNCTION pg_temp.erh21_p(p_slug text, p_email text, p_extra jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_build_object('event_slug', p_slug, 'first_name', 'Erh', 'last_name', 'Harness',
           'email', p_email, 'consent_data_processing', true) || p_extra
$$;

SELECT pg_temp.act_as(NULL, NULL);
SELECT set_config('nes.public_tenant', 'c1a1c1a1-c1a1-c1a1-c1a1-c1a1c1a1c1a1', false);

-- 1) KUBELEK ADRESU ------------------------------------------------------------
INSERT INTO erh21 (k, v)
SELECT 'b' || g, pg_temp.erh21(NULL, 'ip:' || repeat('c1', 16), CASE
         WHEN g <= 8 THEN pg_temp.erh21_p('erh-kubelek', 'kubelek' || g || '.erh@example.org')
         ELSE pg_temp.erh21_p('erh-kubelek', 'zly-adres') END)
  FROM generate_series(1, 12) g;
INSERT INTO erh21 (k, v) VALUES
  ('b13', pg_temp.erh21(NULL, 'ip:' || repeat('c1', 16), pg_temp.erh21_p('erh-kubelek', 'kubelek13.erh@example.org'))),
  ('b13inny', pg_temp.erh21(NULL, 'ip:' || repeat('c2', 16), pg_temp.erh21_p('erh-kubelek', 'kubelek14.erh@example.org')));

SELECT pg_temp.assert(
  (SELECT count(*) FILTER (WHERE v->'client'->>'error' = 'invalid_email') = 4
      AND count(*) FILTER (WHERE v->'client' = '{"ok": true, "outcome": "check_email"}'::jsonb) = 8
     FROM erh21 WHERE k ~ '^b[0-9]+$' AND k <> 'b13'),
  '21/kubelek: 12 prob z adresu (8 zapisow, 4 odmowy rdzenia wartoscia) przechodzi');
SELECT pg_temp.assert(
  (SELECT count FROM public.rate_limits WHERE scope = 'event_register.ip'
     AND subject_id = 'ip:' || repeat('c1', 16)) = 13,
  '21/kubelek: odmowy rdzenia licza sie w kubelku adresu (licznik nie jest cofany)');
SELECT pg_temp.assert(
  (SELECT v->'client' = '{"ok": false, "error": "rate_limited"}'::jsonb AND v->'delivery' = 'null'::jsonb
     FROM erh21 WHERE k = 'b13')
  AND NOT EXISTS (SELECT 1 FROM public.event_people
                   WHERE tenant_id = 'c1a1c1a1-c1a1-c1a1-c1a1-c1a1c1a1c1a1'
                     AND email_norm = 'kubelek13.erh@example.org'),
  '21/kubelek: 13. proba z jednego IP odrzucona (bez osoby i zgloszenia)');
SELECT pg_temp.assert(
  (SELECT v->'client' = '{"ok": true, "outcome": "check_email"}'::jsonb FROM erh21 WHERE k = 'b13inny'),
  '21/kubelek: inny adres przechodzi (kubelek jest per adres)');
SELECT pg_temp.assert_raises_like($q$
  SELECT public.event_register_for_client('c1a1c1a1-c1a1-c1a1-c1a1-c1a1c1a1c1a1', NULL,
    '198.51.100.7', 'x', jsonb_build_object('event_slug', 'erh-kubelek'))
$q$, 'invalid_payload',
  '21/kubelek: surowy adres IP zamiast solonego skrotu to blad serwera');

-- 2) ODPOWIEDZ NEUTRALNA -------------------------------------------------------
INSERT INTO erh21 (k, v) VALUES
  ('n1', pg_temp.erh21(NULL, 'ip:' || repeat('c3', 16), pg_temp.erh21_p('erh-glowne', 'nowy.erh@example.org',
     '{"ticket_type_id": "c1a20000-0000-0000-0000-000000000001", "first_name": "Nowy"}'::jsonb))),
  ('n2', pg_temp.erh21(NULL, 'ip:' || repeat('c3', 16), pg_temp.erh21_p('erh-glowne', 'NOWY.erh@example.org',
     '{"ticket_type_id": "c1a20000-0000-0000-0000-000000000001", "first_name": "Ktos"}'::jsonb))),
  ('s1', pg_temp.erh21(NULL, 'ip:' || repeat('c3', 16), pg_temp.erh21_p('erh-glowne', 'zajety.erh@example.org',
     '{"ticket_type_id": "c1a20000-0000-0000-0000-000000000002"}'::jsonb))),
  ('s2', pg_temp.erh21(NULL, 'ip:' || repeat('c3', 16), pg_temp.erh21_p('erh-glowne', 'swiezy.erh@example.org',
     '{"ticket_type_id": "c1a20000-0000-0000-0000-000000000002"}'::jsonb)));
INSERT INTO erh21 (k, v) VALUES
  ('w1', pg_temp.erh21('c1a00000-0000-0000-0000-000000000001', 'ip:' || repeat('c4', 16),
     pg_temp.erh21_p('erh-glowne', 'wlasciciel.erh@example.org',
       '{"ticket_type_id": "c1a20000-0000-0000-0000-000000000001"}'::jsonb)));
INSERT INTO erh21 (k, v) VALUES
  ('w2', pg_temp.erh21('c1a00000-0000-0000-0000-000000000001', 'ip:' || repeat('c4', 16),
     pg_temp.erh21_p('erh-glowne', 'wlasciciel.erh@example.org',
       '{"ticket_type_id": "c1a20000-0000-0000-0000-000000000001"}'::jsonb)));

SELECT pg_temp.assert(
  (SELECT (v->'client')::text FROM erh21 WHERE k = 'n1') = '{"ok": true, "outcome": "check_email"}'
  AND (SELECT (v->'client')::text FROM erh21 WHERE k = 'n2') = (SELECT (v->'client')::text FROM erh21 WHERE k = 'n1'),
  '21/neutralna: odpowiedzi nierozroznialne (utworzono = juz zapisany, bajt w bajt)');
SELECT pg_temp.assert(
  (SELECT array_agg(v->'delivery'->>'kind' ORDER BY k) FROM erh21 WHERE k IN ('n1', 'n2'))
    = ARRAY['created', 'already_registered']
  AND (SELECT first_name FROM public.event_people
        WHERE tenant_id = 'c1a1c1a1-c1a1-c1a1-c1a1-c1a1c1a1c1a1' AND email_norm = 'nowy.erh@example.org') = 'Nowy',
  '21/neutralna: roznica tylko w dostawie dla serwera; drugi zapis nie nadpisuje kartoteki');
SELECT pg_temp.assert(
  (SELECT v->'client' FROM erh21 WHERE k = 's1') = '{"ok": false, "error": "sold_out"}'::jsonb
  AND (SELECT v->'client' FROM erh21 WHERE k = 's2') = (SELECT v->'client' FROM erh21 WHERE k = 's1'),
  '21/neutralna: sold_out identyczny dla adresu zapisanego i swiezego');
SELECT pg_temp.assert(
  (SELECT v->'client'->>'outcome' = 'registered' AND v->'client'->>'manage_token' IS NOT NULL
          AND (v->'client'->>'account_linked')::boolean
     FROM erh21 WHERE k = 'w1')
  AND (SELECT v->'client' FROM erh21 WHERE k = 'w2') = '{"ok": false, "error": "already_registered"}'::jsonb,
  '21/neutralna: zweryfikowany wlasny adres - poswiadczenia, a powtorka -> already_registered wprost');

-- 3) BILETY UKRYTE -------------------------------------------------------------
SELECT pg_temp.assert(
  NOT EXISTS (SELECT 1 FROM jsonb_array_elements(public.event_registration_form('erh-glowne')->'tickets') t
               WHERE t->>'key' = 'erh_ukryty')
  AND (public.event_registration_form('erh-glowne')->>'has_hidden_tickets')::boolean,
  '21/ukryte: formularz nie oddaje biletu ukrytego, ale mowi, ze takie sa');
INSERT INTO erh21 (k, v) VALUES
  ('h1', pg_temp.erh21(NULL, 'ip:' || repeat('c5', 16), pg_temp.erh21_p('erh-glowne', 'ukryty1.erh@example.org',
     '{"ticket_type_id": "c1a20000-0000-0000-0000-000000000004"}'::jsonb))),
  ('h2', pg_temp.erh21(NULL, 'ip:' || repeat('c5', 16), pg_temp.erh21_p('erh-glowne', 'ukryty2.erh@example.org',
     '{"ticket_type_id": "c1a20000-0000-0000-0000-000000000004", "reveal_code": "ZLY"}'::jsonb))),
  ('h3', pg_temp.erh21(NULL, 'ip:' || repeat('c5', 16), pg_temp.erh21_p('erh-glowne', 'ukryty3.erh@example.org',
     '{"ticket_type_id": "c1a20000-0000-0000-0000-000000000004", "reveal_code": "odslon"}'::jsonb)));
SELECT pg_temp.assert(
  (SELECT v->'client' FROM erh21 WHERE k = 'h1') = '{"ok": false, "error": "not_found"}'::jsonb
  AND (SELECT v->'client' FROM erh21 WHERE k = 'h2') = '{"ok": false, "error": "not_found"}'::jsonb,
  '21/ukryte: ukryty bilet bez kodu -> odmowa (not_found, jak bilet, ktorego nie ma)');
SELECT pg_temp.assert(
  (SELECT count FROM public.rate_limits WHERE scope = 'access_code_miss.ticket'
     AND subject_id = 'ticket:c1a20000-0000-0000-0000-000000000004') = 1,
  '21/ukryte: zly kod odslaniajacy zliczony w kubelku biletu; brak kodu nie jest proba');
SELECT pg_temp.assert(
  (SELECT v->'client' FROM erh21 WHERE k = 'h3') = '{"ok": true, "outcome": "check_email"}'::jsonb
  AND (SELECT count(*) FROM public.event_registrations
        WHERE ticket_type_id = 'c1a20000-0000-0000-0000-000000000004') = 1,
  '21/ukryte: dobry kod odslaniajacy otwiera zapis (i tylko on)');

-- 4) KONIEC WYDARZENIA ---------------------------------------------------------
INSERT INTO erh21 (k, v) VALUES
  ('e1', pg_temp.erh21(NULL, 'ip:' || repeat('c6', 16), pg_temp.erh21_p('erh-po', 'po.erh@example.org')));
SELECT pg_temp.assert(
  (SELECT v->'client' FROM erh21 WHERE k = 'e1') = '{"ok": false, "error": "event_ended"}'::jsonb
  AND NOT EXISTS (SELECT 1 FROM public.event_registrations WHERE event_id = 'c1a10000-0000-0000-0000-000000000002')
  AND public.event_registration_form('erh-po')->>'closed_reason' = 'event_ended',
  '21/koniec: zapis po ends_at -> odmowa (i formularz zamkniety: event_ended)');

-- 5) OFERTA Z CHWILI ZAPISU -----------------------------------------------------
-- Platny bilet wymaga konta z POTWIERDZONYM adresem zgloszenia (inaczej
-- `account_email_required`); wlasciciel ma juz zapis na to wydarzenie, wiec
-- oferte sprawdzamy na swiezym, potwierdzonym koncie.
INSERT INTO auth.users (id, email) VALUES
  ('c1a00000-0000-0000-0000-000000000004', 'platnik.erh@example.org');
INSERT INTO erh21 (k, v) VALUES
  ('q2', pg_temp.erh21('c1a00000-0000-0000-0000-000000000004', 'ip:' || repeat('c7', 16),
     pg_temp.erh21_p('erh-glowne', 'platnik.erh@example.org',
       '{"ticket_type_id": "c1a20000-0000-0000-0000-000000000003"}'::jsonb)));
SELECT pg_temp.assert(
  (SELECT (v->'client'->>'amount_cents')::int = 5000 AND v->'client'->>'payment_status' = 'unpaid'
     FROM erh21 WHERE k = 'q2')
  AND (SELECT quoted_price_cents = 5000 AND quoted_currency = 'PLN'
              AND quote_valid_until = now() + interval '72 hours'
         FROM public.event_registrations
        WHERE id = (SELECT (v->'client'->>'registration_id')::uuid FROM erh21 WHERE k = 'q2')),
  '21/oferta: zapis w early birdzie pamieta cene, walute i termin (72 h)');
UPDATE public.event_ticket_types SET early_bird_until = now() - interval '1 second'
 WHERE id = 'c1a20000-0000-0000-0000-000000000003';
SELECT pg_temp.act_as('c1a00000-0000-0000-0000-000000000004', NULL);
SELECT pg_temp.assert(
  (SELECT c->>'amount_cents' = '5000' AND c->>'price_source' = 'quote'
     FROM (SELECT public.event_registration_payment_context(
             (SELECT (v->'client'->>'registration_id')::uuid FROM erh21 WHERE k = 'q2')) AS c) s),
  '21/oferta: granica early birda - kontekst platnosci trzyma cene z chwili zapisu');
UPDATE public.event_registrations SET quote_valid_until = now() - interval '1 second'
 WHERE id = (SELECT (v->'client'->>'registration_id')::uuid FROM erh21 WHERE k = 'q2');
SELECT pg_temp.assert(
  (SELECT c->>'amount_cents' = '10000' AND c->>'price_source' = 'current'
     FROM (SELECT public.event_registration_payment_context(
             (SELECT (v->'client'->>'registration_id')::uuid FROM erh21 WHERE k = 'q2')) AS c) s),
  '21/oferta: po terminie oferty cena biezaca');
SELECT pg_temp.act_as(NULL, NULL);

-- 6) KARTOTEKA: KONTO Z CUDZYM ADRESEM, ANONIM NA ISTNIEJACY ADRES ---------------
INSERT INTO erh21 (k, v) VALUES
  ('xy', pg_temp.erh21('c1a00000-0000-0000-0000-000000000002', 'ip:' || repeat('c8', 16),
     pg_temp.erh21_p('erh-kartoteka', 'igrek.erh@example.org', '{"first_name": "Mallory"}'::jsonb))),
  ('un', pg_temp.erh21('c1a00000-0000-0000-0000-000000000003', 'ip:' || repeat('c8', 16),
     pg_temp.erh21_p('erh-kartoteka', 'niepotw.erh@example.org'))),
  ('an', pg_temp.erh21(NULL, 'ip:' || repeat('c9', 16),
     pg_temp.erh21_p('erh-kartoteka', 'Ofiara.ERH@example.org',
       '{"first_name": "Mallory", "last_name": "Attacker", "phone": "+48 999 999 999",
         "consent_marketing": true, "consent_partner_sharing": true,
         "ip_hash": "deadbeefdeadbeef", "user_agent": "forged"}'::jsonb)));
SELECT pg_temp.assert(
  (SELECT user_id IS NULL AND first_name = 'Igrek' FROM public.event_people
    WHERE id = 'c1a50000-0000-0000-0000-000000000003')
  AND (SELECT user_id IS NULL FROM public.event_people
        WHERE tenant_id = 'c1a1c1a1-c1a1-c1a1-c1a1-c1a1c1a1c1a1' AND email_norm = 'niepotw.erh@example.org'),
  '21/kartoteka: konto X zapisuje adres Y -> user_id osoby Y zostaje NULL (niepotwierdzone konto tez nie wiaze)');
SELECT pg_temp.assert(
  (SELECT to_jsonb(p) FROM public.event_people p WHERE p.id = 'c1a50000-0000-0000-0000-000000000002')
    = (SELECT row FROM erh21_victim),
  '21/kartoteka: anonimowy zapis istniejacego adresu nie zmienia consent_* ani nazwiska');
SELECT pg_temp.assert(
  (SELECT r.submitted_profile->>'last_name' = 'Attacker'
     FROM public.event_registrations r
    WHERE r.id = (SELECT (v->'delivery'->>'registration_id')::uuid FROM erh21 WHERE k = 'an'))
  AND NOT EXISTS (SELECT 1 FROM public.event_consent_records c
                   WHERE c.person_id = 'c1a50000-0000-0000-0000-000000000002'
                     AND c.purpose <> 'data_processing' AND c.status <> 'pending')
  AND (SELECT count(*) FROM public.event_consent_records c
        WHERE c.person_id = 'c1a50000-0000-0000-0000-000000000002' AND c.status = 'pending') = 2
  AND NOT EXISTS (SELECT 1 FROM public.event_consent_records c
                   WHERE c.person_id = 'c1a50000-0000-0000-0000-000000000002'
                     AND (c.ip_subject IS DISTINCT FROM 'ip:' || repeat('c9', 16)
                          OR c.user_agent IS DISTINCT FROM 'harness/21')),
  '21/kartoteka: dane anonima w submitted_profile, zgody tylko pending, dowod adresu z serwera (ladunek ignorowany)');
SELECT pg_temp.assert(
  (SELECT v->'delivery'->'recipient'->>'first_name' = 'Anna'
          AND v->'delivery'->'consent_confirmation'->>'token' ~ '^[A-Za-z0-9_-]{32}$'
          AND v->'client' = '{"ok": true, "outcome": "check_email"}'::jsonb
     FROM erh21 WHERE k = 'an'),
  '21/kartoteka: wiadomosc i link zgody do wlasciciela adresu (z kartoteki), przegladarka - stala');

ROLLBACK;
SELECT set_config('nes.public_tenant', '', false);
SELECT pg_temp.act_as(NULL, NULL);
