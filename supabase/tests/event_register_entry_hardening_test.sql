-- pgTAP: wejscie zapisu na wydarzenie (migracje 20261012140000..140200, B1a):
-- kubelek adresu i konta, odpowiedz bez wyroczni czlonkostwa, bilety ukryte
-- tylko z kodem, koniec wydarzenia i cena z chwili zapisu.
--
-- KRYTERIA AKCEPTACJI Z AUDYTU (nazwy asercji, doslownie):
--   REG-04 „13. proba z jednego IP odrzucona", „odpowiedzi nierozroznialne";
--   REG-05 „ukryty bilet bez kodu -> odmowa";
--   REG-13 „zapis po ends_at -> odmowa";
--   REG-16 „granica early birda".
--
-- SCIEZKA PRODUKCYJNA. Przegladarka nie wola juz zapisu - funkcja serwerowa
-- (`submitEventRegistration`) woluje `event_register_for_client` kluczem
-- serwisowym: najemca z hosta, konto z sesji, solony skrot adresu `ip:<32 hex>`.
-- Wszystkie wywolania zapisu ida tu jako service_role, dokladnie jak w TS.
-- Kazdy scenariusz ma WLASNY adres (kubelek 12 / 10 min na adres goscia).
--
-- now() jest staly w transakcji: granice oferty i konca wydarzenia sa dokladne,
-- a wszystkie proby siedza w jednym oknie kubelka.
BEGIN;
SELECT plan(70);

ALTER TABLE auth.users DISABLE TRIGGER USER;

INSERT INTO public.tenants (id, slug, name, domain) VALUES
  ('b1a0a000-0000-0000-0000-0000000000aa', 'erh-a', 'Entry Hardening A', 'erh-a.example'),
  ('b1a0b000-0000-0000-0000-0000000000bb', 'erh-b', 'Entry Hardening B', 'erh-b.example');

-- owner/other/bucket/hid/paid: potwierdzone; unconf: bez potwierdzenia.
INSERT INTO auth.users (id, email, email_confirmed_at) VALUES
  ('b1a00000-0000-0000-0000-0000000000a1', 'erh-owner@example.org', now()),
  ('b1a00000-0000-0000-0000-0000000000a2', 'erh-other@example.org', now()),
  ('b1a00000-0000-0000-0000-0000000000a3', 'erh-unconf@example.org', NULL),
  ('b1a00000-0000-0000-0000-0000000000a4', 'erh-bucket@example.org', now()),
  ('b1a00000-0000-0000-0000-0000000000a5', 'erh-hid@example.org', now()),
  ('b1a00000-0000-0000-0000-0000000000a6', 'erh-paid@example.org', now());
INSERT INTO public.profiles (id, email, display_name, tenant_id) VALUES
  ('b1a00000-0000-0000-0000-0000000000a1', 'erh-owner@example.org', 'ERH Owner', 'b1a0a000-0000-0000-0000-0000000000aa'),
  ('b1a00000-0000-0000-0000-0000000000a2', 'erh-other@example.org', 'ERH Other', 'b1a0a000-0000-0000-0000-0000000000aa'),
  ('b1a00000-0000-0000-0000-0000000000a3', 'erh-unconf@example.org', 'ERH Unconf', 'b1a0a000-0000-0000-0000-0000000000aa'),
  ('b1a00000-0000-0000-0000-0000000000a4', 'erh-bucket@example.org', 'ERH Bucket', 'b1a0a000-0000-0000-0000-0000000000aa'),
  ('b1a00000-0000-0000-0000-0000000000a5', 'erh-hid@example.org', 'ERH Hid', 'b1a0a000-0000-0000-0000-0000000000aa'),
  ('b1a00000-0000-0000-0000-0000000000a6', 'erh-paid@example.org', 'ERH Paid', 'b1a0a000-0000-0000-0000-0000000000aa');

INSERT INTO public.events (id, tenant_id, slug, title_pl, title_en, starts_at, ends_at, status) VALUES
  ('b1a10000-0000-0000-0000-0000000000e1', 'b1a0a000-0000-0000-0000-0000000000aa',
   'erh-event', 'ERH', 'ERH', now() + interval '30 days', NULL, 'published'),
  ('b1a10000-0000-0000-0000-0000000000e2', 'b1a0a000-0000-0000-0000-0000000000aa',
   'erh-ended', 'ERH koniec', 'ERH ended', now() - interval '2 days', now() - interval '1 hour', 'published'),
  ('b1a10000-0000-0000-0000-0000000000e3', 'b1a0a000-0000-0000-0000-0000000000aa',
   'erh-noend', 'ERH bez konca', 'ERH no end', now() - interval '1 hour', NULL, 'published'),
  ('b1a10000-0000-0000-0000-0000000000e4', 'b1a0a000-0000-0000-0000-0000000000aa',
   'erh-started', 'ERH trwa', 'ERH running', now() - interval '1 hour', now() + interval '1 day', 'published'),
  ('b1a10000-0000-0000-0000-0000000000e5', 'b1a0a000-0000-0000-0000-0000000000aa',
   'erh-bucket', 'ERH kubelek', 'ERH bucket', now() + interval '30 days', NULL, 'published'),
  ('b1a10000-0000-0000-0000-0000000000e6', 'b1a0a000-0000-0000-0000-0000000000aa',
   'erh-soon', 'ERH jutro', 'ERH tomorrow', now() + interval '1 day', NULL, 'published'),
  ('b1a10000-0000-0000-0000-0000000000e7', 'b1a0a000-0000-0000-0000-0000000000aa',
   'erh-terms', 'ERH regulamin', 'ERH terms', now() + interval '30 days', NULL, 'published'),
  ('b1a10000-0000-0000-0000-0000000000e8', 'b1a0a000-0000-0000-0000-0000000000aa',
   'erh-limits', 'ERH sufity', 'ERH limits', now() + interval '30 days', NULL, 'published');

-- f1 bezplatny, f2 wyprzedany (pula 1, bez rezerwy), f3 platny z early birdem
-- do now()+1h, f4 ukryty BEZ kodu dostepu, f5 ukryty Z kodem dostepu; f6/f7
-- platny i bezplatny na wydarzeniu w trakcie; f8 platny na wydarzeniu jutro.
INSERT INTO public.event_ticket_types
  (id, tenant_id, event_id, key, name_pl, name_en, price_cents, currency,
   early_bird_price_cents, early_bird_until, quota, waitlist_enabled, is_hidden, access_code_hash) VALUES
  ('b1a20000-0000-0000-0000-0000000000f1', 'b1a0a000-0000-0000-0000-0000000000aa',
   'b1a10000-0000-0000-0000-0000000000e1', 'erh_free', 'Wolny', 'Free', 0, 'PLN', NULL, NULL, NULL, true, false, NULL),
  ('b1a20000-0000-0000-0000-0000000000f2', 'b1a0a000-0000-0000-0000-0000000000aa',
   'b1a10000-0000-0000-0000-0000000000e1', 'erh_sold', 'Wyprzedany', 'Sold out', 0, 'PLN', NULL, NULL, 1, false, false, NULL),
  ('b1a20000-0000-0000-0000-0000000000f3', 'b1a0a000-0000-0000-0000-0000000000aa',
   'b1a10000-0000-0000-0000-0000000000e1', 'erh_paid', 'Platny', 'Paid', 10000, 'PLN', 5000, now() + interval '1 hour', NULL, true, false, NULL),
  ('b1a20000-0000-0000-0000-0000000000f4', 'b1a0a000-0000-0000-0000-0000000000aa',
   'b1a10000-0000-0000-0000-0000000000e1', 'erh_hid', 'Ukryty', 'Hidden', 0, 'PLN', NULL, NULL, NULL, true, true, NULL),
  ('b1a20000-0000-0000-0000-0000000000f5', 'b1a0a000-0000-0000-0000-0000000000aa',
   'b1a10000-0000-0000-0000-0000000000e1', 'erh_hid_ac', 'Prasa', 'Press', 0, 'PLN', NULL, NULL, NULL, true, true,
   encode(extensions.digest('PRESS', 'sha256'), 'hex')),
  ('b1a20000-0000-0000-0000-0000000000f6', 'b1a0a000-0000-0000-0000-0000000000aa',
   'b1a10000-0000-0000-0000-0000000000e4', 'erh_sp', 'Platny trwa', 'Paid running', 10000, 'PLN', NULL, NULL, NULL, true, false, NULL),
  ('b1a20000-0000-0000-0000-0000000000f7', 'b1a0a000-0000-0000-0000-0000000000aa',
   'b1a10000-0000-0000-0000-0000000000e4', 'erh_sf', 'Wolny trwa', 'Free running', 0, 'PLN', NULL, NULL, NULL, true, false, NULL),
  ('b1a20000-0000-0000-0000-0000000000f8', 'b1a0a000-0000-0000-0000-0000000000aa',
   'b1a10000-0000-0000-0000-0000000000e6', 'erh_soon', 'Jutro', 'Tomorrow', 3000, 'PLN', NULL, NULL, NULL, true, false, NULL);

INSERT INTO public.event_terms (id, tenant_id, event_id, key, label_pl, label_en, body_pl, is_required, display) VALUES
  ('b1a40000-0000-0000-0000-0000000000a1', 'b1a0a000-0000-0000-0000-0000000000aa',
   'b1a10000-0000-0000-0000-0000000000e7', 'erh_reg', 'Regulamin ERH', 'ERH terms', 'Tresc regulaminu ERH.',
   true, 'registration');

-- Zajete jedyne miejsce biletu f2 (adres zapisany przed testem).
INSERT INTO public.event_people (id, tenant_id, email, first_name, last_name) VALUES
  ('b1a50000-0000-0000-0000-0000000000b1', 'b1a0a000-0000-0000-0000-0000000000aa',
   'erh-taken@example.org', 'Zajety', 'Adres');
INSERT INTO public.event_registrations
  (tenant_id, event_id, person_id, ticket_type_id, status, registration_mode, source) VALUES
  ('b1a0a000-0000-0000-0000-0000000000aa', 'b1a10000-0000-0000-0000-0000000000e1',
   'b1a50000-0000-0000-0000-0000000000b1', 'b1a20000-0000-0000-0000-0000000000f2',
   'approved', 'rsvp', 'self_registration');

-- Kod odslaniajacy bilet f4 (bez rabatu).
INSERT INTO public.b2b_coupons
  (id, tenant_id, code, name, discount_kind, active, event_ids, ticket_type_ids, applies_discount, reveals_hidden) VALUES
  ('b1a30000-0000-0000-0000-0000000000c1', 'b1a0a000-0000-0000-0000-0000000000aa',
   'REVEAL', 'ERH reveal', 'percent', true,
   ARRAY['b1a10000-0000-0000-0000-0000000000e1']::uuid[],
   ARRAY['b1a20000-0000-0000-0000-0000000000f4']::uuid[], false, true);

-- Wywolanie serwera (jak eventRegistration.server.ts) i ladunek formularza.
CREATE FUNCTION pg_temp.erh(p_uid uuid, p_ip text, p_payload jsonb)
RETURNS jsonb LANGUAGE sql AS $$
  SELECT public.event_register_for_client(
    'b1a0a000-0000-0000-0000-0000000000aa', p_uid, p_ip, 'pgtap/1.0', p_payload)
$$;
CREATE FUNCTION pg_temp.erh_p(p_slug text, p_email text, p_extra jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_build_object('event_slug', p_slug, 'first_name', 'Erh', 'last_name', 'Test',
           'email', p_email, 'consent_data_processing', true) || p_extra
$$;
CREATE TEMP TABLE erh_r (k text PRIMARY KEY, v jsonb);
GRANT ALL ON erh_r TO service_role, authenticated;

-- ── 1-5. Uprawnienia ────────────────────────────────────────────────────────
SELECT ok(
  NOT has_function_privilege('anon', 'public.event_register(jsonb)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.event_register(jsonb)', 'EXECUTE')
  AND has_function_privilege('service_role', 'public.event_register(jsonb)', 'EXECUTE'),
  'event_register: wrapper zgodnosci tylko dla service_role (przegladarka nie zapisuje z pominieciem kubelka adresu)');
SELECT ok(
  NOT has_function_privilege('anon', 'public.event_register_for_client(uuid,uuid,text,text,jsonb)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.event_register_for_client(uuid,uuid,text,text,jsonb)', 'EXECUTE')
  AND has_function_privilege('service_role', 'public.event_register_for_client(uuid,uuid,text,text,jsonb)', 'EXECUTE'),
  'event_register_for_client: wylacznie service_role');
SELECT ok(
  NOT has_function_privilege('anon', 'public.event_registration_revealed_tickets(uuid,uuid,text,uuid,text)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.event_registration_revealed_tickets(uuid,uuid,text,uuid,text)', 'EXECUTE')
  AND has_function_privilege('service_role', 'public.event_registration_revealed_tickets(uuid,uuid,text,uuid,text)', 'EXECUTE'),
  'event_registration_revealed_tickets: wylacznie service_role');
SELECT ok(
  NOT has_function_privilege('anon', 'public._event_register(uuid,uuid,text,text,jsonb,boolean)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public._event_register(uuid,uuid,text,text,jsonb,boolean)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public._event_reveal_coupon_covers(uuid,uuid,uuid,text)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public._event_reveal_coupon_covers(uuid,uuid,uuid,text)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public._event_registration_ticket_json(public.event_ticket_types)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public._event_registration_ticket_json(public.event_ticket_types)', 'EXECUTE'),
  'rdzen zapisu i funkcje pomocnicze bez EXECUTE dla klienta');
SELECT ok(
  has_function_privilege('anon', 'public.event_registration_form(text,text)', 'EXECUTE')
  AND has_function_privilege('authenticated', 'public.event_registration_form(text,text)', 'EXECUTE')
  AND to_regprocedure('public.event_registration_form(text)') IS NULL,
  'formularz: (text, text DEFAULT NULL) dla anon i authenticated, stara sygnatura (text) nie istnieje');

-- ── 6-12. REG-04: kubelek adresu i konta ────────────────────────────────────
-- Dwanascie prob z adresu B1: szesc zapisow i szesc odmow rdzenia (zly
-- e-mail, brak zgody, nieistniejace wydarzenie). Odmowa wraca wartoscia, wiec
-- liczy sie w kubelku tak samo jak zapis.
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);
SET LOCAL ROLE service_role;
INSERT INTO erh_r (k, v)
SELECT 'b' || g, pg_temp.erh(NULL, 'ip:' || repeat('b1', 16), CASE
         WHEN g <= 6 THEN pg_temp.erh_p('erh-bucket', 'erh-b' || g || '@example.org')
         WHEN g <= 8 THEN pg_temp.erh_p('erh-bucket', 'not-an-email')
         WHEN g <= 10 THEN pg_temp.erh_p('erh-bucket', 'erh-b' || g || '@example.org',
                                         '{"consent_data_processing": false}'::jsonb)
         ELSE pg_temp.erh_p('erh-nope', 'erh-b' || g || '@example.org') END)
  FROM generate_series(1, 12) g;
SELECT ok(
  (SELECT count(*) FILTER (WHERE v->'client'->>'error' = 'rate_limited') = 0
      AND count(*) FILTER (WHERE (v->'client'->>'ok')::boolean IS FALSE) = 6
      AND count(*) FILTER (WHERE v->'client' = '{"ok": true, "outcome": "check_email"}'::jsonb) = 6
     FROM erh_r WHERE k ~ '^b[0-9]+$'),
  'pierwsze 12 prob z adresu (6 zapisow, 6 odmow rdzenia) przechodzi przez kubelek');
INSERT INTO erh_r (k, v) VALUES
  ('b13', pg_temp.erh(NULL, 'ip:' || repeat('b1', 16), pg_temp.erh_p('erh-bucket', 'erh-b13@example.org')));
RESET ROLE;
SELECT is(
  (SELECT count FROM public.rate_limits WHERE scope = 'event_register.ip'
     AND subject_id = 'ip:' || repeat('b1', 16)),
  13, 'odmowy rdzenia licza sie w kubelku adresu (wartosc, nie wyjatek, ktory cofal licznik)');
SELECT is((SELECT v->'client' FROM erh_r WHERE k = 'b13'),
  '{"ok": false, "error": "rate_limited"}'::jsonb,
  '13. proba z jednego IP odrzucona');
SELECT ok(
  (SELECT v->'delivery' = 'null'::jsonb FROM erh_r WHERE k = 'b13')
  AND NOT EXISTS (SELECT 1 FROM public.event_people
                   WHERE tenant_id = 'b1a0a000-0000-0000-0000-0000000000aa'
                     AND email_norm = 'erh-b13@example.org'),
  '13. proba z jednego IP: brak dostawy, osoby i zgloszenia');

SET LOCAL ROLE service_role;
INSERT INTO erh_r (k, v) VALUES
  ('b13other', pg_temp.erh(NULL, 'ip:' || repeat('b2', 16), pg_temp.erh_p('erh-bucket', 'erh-b13@example.org')));
-- Konto: 12 odmow (brak zgody) z adresu B3, potem poprawny zapis.
INSERT INTO erh_r (k, v)
SELECT 'u' || g, pg_temp.erh('b1a00000-0000-0000-0000-0000000000a4', 'ip:' || repeat('b3', 16),
         pg_temp.erh_p('erh-bucket', 'erh-bucket@example.org', '{"consent_data_processing": false}'::jsonb))
  FROM generate_series(1, 12) g;
INSERT INTO erh_r (k, v) VALUES
  ('u13', pg_temp.erh('b1a00000-0000-0000-0000-0000000000a4', 'ip:' || repeat('b3', 16),
            pg_temp.erh_p('erh-bucket', 'erh-bucket@example.org')));
RESET ROLE;
SELECT ok(
  (SELECT v->'client' = '{"ok": true, "outcome": "check_email"}'::jsonb FROM erh_r WHERE k = 'b13other')
  AND EXISTS (SELECT 1 FROM public.event_people
               WHERE tenant_id = 'b1a0a000-0000-0000-0000-0000000000aa'
                 AND email_norm = 'erh-b13@example.org'),
  'ten sam zapis z innego adresu przechodzi (kubelek jest per adres)');
SELECT is((SELECT v->'client' FROM erh_r WHERE k = 'u13'),
  '{"ok": false, "error": "rate_limited"}'::jsonb,
  'konto: 13. proba z jednego konta odrzucona');
SELECT ok(
  (SELECT count FROM public.rate_limits WHERE scope = 'event_register.ip'
     AND subject_id = 'ip:' || repeat('b3', 16)) = 13
  AND (SELECT count FROM public.rate_limits WHERE scope = 'event_register.user'
     AND subject_id = 'user:b1a00000-0000-0000-0000-0000000000a4') = 13,
  'zalogowany: adres ma prog 120 (13 prob nie wyczerpuje), konto - 12');

-- ── 13-15. Tozsamosc od serwera ─────────────────────────────────────────────
SET LOCAL ROLE service_role;
SELECT throws_like(
  $$SELECT pg_temp.erh(NULL, 'not-a-hash', pg_temp.erh_p('erh-bucket', 'erh-raw@example.org'))$$,
  'invalid_payload%',
  'adres musi byc solonym skrotem ip:<32 hex> (zly ksztalt: blad serwera, nie odpowiedz)');
SELECT throws_like(
  $$SELECT pg_temp.erh('b1a00000-0000-0000-0000-0000000000a2', '203.0.113.7',
      pg_temp.erh_p('erh-bucket', 'erh-raw@example.org'))$$,
  'invalid_payload%',
  'surowy adres IP z kontem: odmowa invalid_payload');
SELECT throws_like(
  $$SELECT public.event_register_for_client(NULL, NULL, 'ip:' || repeat('b4', 16), 'x',
      pg_temp.erh_p('erh-bucket', 'erh-raw@example.org'))$$,
  'invalid_payload%',
  'brak najemcy: odmowa invalid_payload');

-- ── 16-26. REG-04: odpowiedzi nierozroznialne ───────────────────────────────
INSERT INTO erh_r (k, v) VALUES
  ('x1', pg_temp.erh(NULL, 'ip:' || repeat('c1', 16), pg_temp.erh_p('erh-event', 'erh-x@example.org',
      '{"first_name": "Xavier", "ticket_type_id": "b1a20000-0000-0000-0000-0000000000f1"}'::jsonb))),
  ('x2', pg_temp.erh(NULL, 'ip:' || repeat('c1', 16), pg_temp.erh_p('erh-event', 'ERH-X@Example.org',
      '{"first_name": "Mallory", "last_name": "Other", "ticket_type_id": "b1a20000-0000-0000-0000-0000000000f1"}'::jsonb))),
  ('s1', pg_temp.erh(NULL, 'ip:' || repeat('c2', 16), pg_temp.erh_p('erh-event', 'erh-taken@example.org',
      '{"ticket_type_id": "b1a20000-0000-0000-0000-0000000000f2"}'::jsonb))),
  ('s2', pg_temp.erh(NULL, 'ip:' || repeat('c2', 16), pg_temp.erh_p('erh-event', 'erh-fresh@example.org',
      '{"ticket_type_id": "b1a20000-0000-0000-0000-0000000000f2"}'::jsonb)));
INSERT INTO erh_r (k, v) VALUES
  ('v1', pg_temp.erh('b1a00000-0000-0000-0000-0000000000a1', 'ip:' || repeat('c3', 16),
      pg_temp.erh_p('erh-event', 'erh-owner@example.org',
        '{"ticket_type_id": "b1a20000-0000-0000-0000-0000000000f1"}'::jsonb)));
INSERT INTO erh_r (k, v) VALUES
  ('v2', pg_temp.erh('b1a00000-0000-0000-0000-0000000000a1', 'ip:' || repeat('c3', 16),
      pg_temp.erh_p('erh-event', 'erh-owner@example.org',
        '{"ticket_type_id": "b1a20000-0000-0000-0000-0000000000f1"}'::jsonb)));
INSERT INTO erh_r (k, v) VALUES
  ('pu', pg_temp.erh('b1a00000-0000-0000-0000-0000000000a3', 'ip:' || repeat('c4', 16),
      pg_temp.erh_p('erh-event', 'erh-unconf@example.org',
        '{"ticket_type_id": "b1a20000-0000-0000-0000-0000000000f3"}'::jsonb))),
  ('po', pg_temp.erh('b1a00000-0000-0000-0000-0000000000a2', 'ip:' || repeat('c4', 16),
      pg_temp.erh_p('erh-event', 'erh-someone@example.org',
        '{"ticket_type_id": "b1a20000-0000-0000-0000-0000000000f3"}'::jsonb))),
  ('pa', pg_temp.erh(NULL, 'ip:' || repeat('c4', 16),
      pg_temp.erh_p('erh-event', 'erh-guest-paid@example.org',
        '{"ticket_type_id": "b1a20000-0000-0000-0000-0000000000f3"}'::jsonb)));
RESET ROLE;

SELECT is((SELECT v->'client' FROM erh_r WHERE k = 'x1'),
  '{"ok": true, "outcome": "check_email"}'::jsonb,
  'nowy adres bez weryfikacji: stala odpowiedz neutralna');
SELECT is((SELECT (v->'client')::text FROM erh_r WHERE k = 'x2'),
          (SELECT (v->'client')::text FROM erh_r WHERE k = 'x1'),
  'odpowiedzi nierozroznialne');
SELECT ok(
  NOT EXISTS (SELECT 1 FROM erh_r
               WHERE k IN ('x1', 'x2')
                 AND (v->'client' ? 'manage_token' OR v->'client' ? 'registration_id'
                      OR v->'client' ? 'qr_token' OR v->'client' ? 'status')),
  'odpowiedz neutralna nie niesie manage_token, registration_id, qr_token ani statusu');
SELECT is(
  ARRAY(SELECT v->'delivery'->>'kind' FROM erh_r WHERE k IN ('x1', 'x2') ORDER BY k),
  ARRAY['created', 'already_registered'],
  'wynik dostaje skrzynka: dostawa created / already_registered (wylacznie dla serwera)');
SELECT ok(
  (SELECT NOT (v->'delivery' ? 'manage_token')
          AND v->'delivery'->'recipient'->>'first_name' = 'Xavier'
          AND v->'delivery'->'recipient'->>'email' = 'erh-x@example.org'
     FROM erh_r WHERE k = 'x2'),
  'juz zapisany: wiadomosc do wlasciciela adresu (dane z kartoteki), bez klucza samoobslugi');
SELECT is(
  (SELECT first_name || ' ' || last_name FROM public.event_people
    WHERE tenant_id = 'b1a0a000-0000-0000-0000-0000000000aa' AND email_norm = 'erh-x@example.org'),
  'Xavier Test',
  'drugi zapis tego adresu nie nadpisuje kartoteki');
SELECT is((SELECT v->'client' FROM erh_r WHERE k = 's1'),
  '{"ok": false, "error": "sold_out"}'::jsonb,
  'brak miejsc dla adresu juz zapisanego: sold_out (dotad already_registered)');
SELECT is((SELECT (v->'client')::text FROM erh_r WHERE k = 's2'),
          (SELECT (v->'client')::text FROM erh_r WHERE k = 's1'),
  'sold_out identyczny dla adresu zapisanego i swiezego');
SELECT ok(
  (SELECT v->'client'->>'outcome' = 'registered'
          AND v->'client'->>'registration_id' IS NOT NULL
          AND v->'client'->>'manage_token' IS NOT NULL
          AND (v->'client'->>'account_linked')::boolean
     FROM erh_r WHERE k = 'v1'),
  'zweryfikowany wlasny adres: poswiadczenia w odpowiedzi i konto dowiazane');
SELECT is((SELECT v->'client' FROM erh_r WHERE k = 'v2'),
  '{"ok": false, "error": "already_registered"}'::jsonb,
  'zweryfikowany wlasny adres: powtorka -> already_registered wprost');
SELECT is(
  ARRAY(SELECT jsonb_object_keys(v->'client') FROM erh_r WHERE k = 'v1' ORDER BY 1),
  ARRAY['account_linked', 'amount_cents', 'consent_confirmation_required', 'currency',
        'decision_source', 'event_id', 'group_id', 'manage_token', 'ok', 'outcome',
        'payment_required', 'payment_status', 'person_id', 'qr_token', 'quote_valid_until',
        'registration_id', 'status', 'ticket_type_id', 'waitlist_position']::text[],
  'zweryfikowany: klucze odpowiedzi dokladnie wg kontraktu (B1b je parsuje)');

-- ── 27-29. Platna wejsciowka: konto z potwierdzonym adresem zgloszenia ──────
SELECT is(
  ARRAY(SELECT v->'client'->>'error' FROM erh_r WHERE k IN ('pa', 'po', 'pu') ORDER BY k),
  ARRAY['payment_account_required', 'account_email_required', 'account_email_required'],
  'platny bilet: gosc -> payment_account_required; konto z cudzym albo niepotwierdzonym adresem -> account_email_required');
SELECT ok(
  NOT EXISTS (SELECT 1 FROM public.event_registrations
               WHERE ticket_type_id = 'b1a20000-0000-0000-0000-0000000000f3'),
  'odmowy platnego biletu nie zostawiaja zgloszenia');
SELECT ok(
  (SELECT quoted_price_cents IS NULL AND quoted_currency IS NULL AND quote_valid_until IS NULL
     FROM public.event_registrations r
     JOIN public.event_people p ON p.id = r.person_id
    WHERE p.email_norm = 'erh-x@example.org' AND r.tenant_id = 'b1a0a000-0000-0000-0000-0000000000aa'),
  'bezplatne zgloszenie nie ma oferty cenowej');

-- ── 30-44. REG-05: bilety ukryte ────────────────────────────────────────────
SELECT set_config('request.headers', '{"x-tenant-host":"erh-a.example"}', true);
SELECT set_config('request.jwt.claims', '{"role":"anon"}', true);
SET LOCAL ROLE anon;
SELECT ok(
  NOT EXISTS (SELECT 1 FROM jsonb_array_elements(public.event_registration_form('erh-event')->'tickets') t
               WHERE t->>'key' IN ('erh_hid', 'erh_hid_ac'))
  AND EXISTS (SELECT 1 FROM jsonb_array_elements(public.event_registration_form('erh-event')->'tickets') t
               WHERE t->>'key' = 'erh_free'),
  'formularz publiczny nie oddaje biletow ukrytych');
SELECT ok(
  (public.event_registration_form('erh-event')->>'has_hidden_tickets')::boolean
  AND (public.event_registration_form('erh-event')->>'requires_ticket')::boolean,
  'formularz: has_hidden_tickets i requires_ticket (pole kodu odslaniajacego)');
SELECT ok(
  EXISTS (SELECT 1 FROM jsonb_array_elements(public.event_registration_form('erh-event', 'erh_hid_ac')->'tickets') t
           WHERE t->>'key' = 'erh_hid_ac' AND (t->>'requires_access_code')::boolean),
  'link ?ticket= oddaje bilet ukryty Z kodem dostepu (zapis i tak wymaga kodu)');
SELECT ok(
  NOT EXISTS (SELECT 1 FROM jsonb_array_elements(public.event_registration_form('erh-event', 'erh_hid')->'tickets') t
               WHERE t->>'key' = 'erh_hid'),
  'link ?ticket= NIE oddaje biletu ukrytego bez kodu dostepu (klucz da sie zgadnac)');
SELECT is(public.event_registration_form('erh-ended')->>'closed_reason', 'event_ended',
  'formularz po koncu wydarzenia: closed_reason event_ended');
RESET ROLE;

SELECT set_config('request.headers', '', true);
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);
SET LOCAL ROLE service_role;
INSERT INTO erh_r (k, v) VALUES
  ('h1', pg_temp.erh(NULL, 'ip:' || repeat('d1', 16), pg_temp.erh_p('erh-event', 'erh-h1@example.org',
      '{"ticket_type_id": "b1a20000-0000-0000-0000-0000000000f4"}'::jsonb))),
  ('h0', pg_temp.erh(NULL, 'ip:' || repeat('d1', 16), pg_temp.erh_p('erh-event', 'erh-h1@example.org',
      '{"ticket_type_id": "b1a20000-0000-0000-0000-0000000000ff"}'::jsonb))),
  ('h2', pg_temp.erh(NULL, 'ip:' || repeat('d2', 16), pg_temp.erh_p('erh-event', 'erh-h2@example.org',
      '{"ticket_type_id": "b1a20000-0000-0000-0000-0000000000f4", "reveal_code": "WRONG"}'::jsonb)));
RESET ROLE;
SELECT ok(
  (SELECT v->'client' = '{"ok": false, "error": "not_found"}'::jsonb AND v->'delivery' = 'null'::jsonb
     FROM erh_r WHERE k = 'h1')
  AND NOT EXISTS (SELECT 1 FROM public.event_people
                   WHERE tenant_id = 'b1a0a000-0000-0000-0000-0000000000aa'
                     AND email_norm = 'erh-h1@example.org'),
  'ukryty bilet bez kodu -> odmowa');
SELECT is((SELECT (v->'client')::text FROM erh_r WHERE k = 'h1'),
          (SELECT (v->'client')::text FROM erh_r WHERE k = 'h0'),
  'ukryty bilet bez kodu: ta sama odpowiedz co bilet, ktorego nie ma');
SELECT ok(
  (SELECT v->'client' = '{"ok": false, "error": "not_found"}'::jsonb FROM erh_r WHERE k = 'h2')
  AND NOT EXISTS (SELECT 1 FROM public.event_registrations
                   WHERE ticket_type_id = 'b1a20000-0000-0000-0000-0000000000f4'),
  'ukryty bilet ze zlym kodem odslaniajacym: odmowa i zero zgloszen');
SELECT ok(
  (SELECT count FROM public.rate_limits WHERE scope = 'access_code_miss.ticket'
     AND subject_id = 'ticket:b1a20000-0000-0000-0000-0000000000f4') = 1
  AND (SELECT count FROM public.rate_limits WHERE scope = 'coupon_probe_miss.ip'
     AND subject_id = 'ip:' || repeat('d2', 16)) = 1,
  'zly kod odslaniajacy liczony w kubelku biletu i adresu; brak kodu nie jest proba');

SET LOCAL ROLE service_role;
INSERT INTO erh_r (k, v) VALUES
  ('h3', pg_temp.erh(NULL, 'ip:' || repeat('d3', 16), pg_temp.erh_p('erh-event', 'erh-h3@example.org',
      '{"ticket_type_id": "b1a20000-0000-0000-0000-0000000000f4", "reveal_code": " reveal "}'::jsonb))),
  ('h4', pg_temp.erh(NULL, 'ip:' || repeat('d3', 16), pg_temp.erh_p('erh-event', 'erh-h4@example.org',
      '{"ticket_type_id": "b1a20000-0000-0000-0000-0000000000f5", "access_code": "press"}'::jsonb))),
  ('h5', pg_temp.erh(NULL, 'ip:' || repeat('d3', 16), pg_temp.erh_p('erh-event', 'erh-h5@example.org',
      '{"ticket_type_id": "b1a20000-0000-0000-0000-0000000000f5"}'::jsonb)));
INSERT INTO erh_r (k, v) VALUES
  ('hr', public.event_registration_revealed_tickets('b1a0a000-0000-0000-0000-0000000000aa', NULL,
      'ip:' || repeat('d4', 16), 'b1a10000-0000-0000-0000-0000000000e1', 'REVEAL')),
  ('hn', public.event_registration_revealed_tickets('b1a0a000-0000-0000-0000-0000000000aa', NULL,
      'ip:' || repeat('d4', 16), 'b1a10000-0000-0000-0000-0000000000e1', 'NOPE')),
  ('hb', public.event_registration_revealed_tickets('b1a0b000-0000-0000-0000-0000000000bb', NULL,
      'ip:' || repeat('d4', 16), 'b1a10000-0000-0000-0000-0000000000e1', 'REVEAL'));
INSERT INTO erh_r (k, v) VALUES
  ('h6', pg_temp.erh('b1a00000-0000-0000-0000-0000000000a5', 'ip:' || repeat('d5', 16),
      pg_temp.erh_p('erh-event', 'erh-hid@example.org',
        '{"ticket_type_id": "b1a20000-0000-0000-0000-0000000000f4", "reveal_code": "REVEAL"}'::jsonb)));
RESET ROLE;
SELECT ok(
  (SELECT v->'client' = '{"ok": true, "outcome": "check_email"}'::jsonb FROM erh_r WHERE k = 'h3')
  AND EXISTS (SELECT 1 FROM public.event_registrations r
                JOIN public.event_people p ON p.id = r.person_id
               WHERE r.ticket_type_id = 'b1a20000-0000-0000-0000-0000000000f4'
                 AND p.email_norm = 'erh-h3@example.org'),
  'dobry kod odslaniajacy (bez wielkosci liter i spacji) otwiera zapis na bilet ukryty');
SELECT is(
  ARRAY(SELECT COALESCE(v->'client'->>'error', v->'client'->>'outcome') FROM erh_r WHERE k IN ('h4', 'h5') ORDER BY k),
  ARRAY['check_email', 'invalid_access_code'],
  'bilet ukryty z kodem dostepu: z kodem zapis, bez kodu invalid_access_code');
SELECT ok(
  (SELECT jsonb_array_length(v) = 1
          AND v->0->>'key' = 'erh_hid'
          AND (v->0->>'is_hidden')::boolean
          AND v->0 ? 'effective_price_cents' AND v->0 ? 'availability' AND v->0 ? 'seats_left'
     FROM erh_r WHERE k = 'hr'),
  'odslanianie kodem: pelny obiekt biletu formularza');
SELECT ok(
  (SELECT v = '[]'::jsonb FROM erh_r WHERE k = 'hn') AND (SELECT v = '[]'::jsonb FROM erh_r WHERE k = 'hb'),
  'odslanianie: zly kod i kod z obcego najemcy daja pusta liste');
SET LOCAL ROLE service_role;
SELECT throws_ok(
  $$SELECT public.event_ticket_checkout_quote_for_user('b1a0a000-0000-0000-0000-0000000000aa',
      'b1a00000-0000-0000-0000-0000000000a2', 'ip:' || repeat('d6', 16),
      'b1a20000-0000-0000-0000-0000000000f4', NULL)$$,
  'P0001', 'ticket_not_available',
  'kasa: ukryty bilet bez kodu nie jest do kupienia bez zgloszenia na niego');
SELECT is(
  public.event_ticket_checkout_quote_for_user('b1a0a000-0000-0000-0000-0000000000aa',
    'b1a00000-0000-0000-0000-0000000000a5', 'ip:' || repeat('d6', 16),
    'b1a20000-0000-0000-0000-0000000000f4', NULL) ->> 'ticket_type_id',
  'b1a20000-0000-0000-0000-0000000000f4',
  'kasa: posiadacz zgloszenia na ukryty bilet wycenia go dalej');
RESET ROLE;

-- ── 45-49. REG-13: koniec wydarzenia ────────────────────────────────────────
SET LOCAL ROLE service_role;
INSERT INTO erh_r (k, v) VALUES
  ('e1', pg_temp.erh(NULL, 'ip:' || repeat('e1', 16), pg_temp.erh_p('erh-ended', 'erh-e1@example.org'))),
  ('e2', pg_temp.erh(NULL, 'ip:' || repeat('e1', 16), pg_temp.erh_p('erh-noend', 'erh-e2@example.org'))),
  ('e3', pg_temp.erh(NULL, 'ip:' || repeat('e1', 16), pg_temp.erh_p('erh-started', 'erh-e3@example.org',
      '{"ticket_type_id": "b1a20000-0000-0000-0000-0000000000f6"}'::jsonb))),
  ('e4', pg_temp.erh(NULL, 'ip:' || repeat('e1', 16), pg_temp.erh_p('erh-started', 'erh-e4@example.org',
      '{"ticket_type_id": "b1a20000-0000-0000-0000-0000000000f7"}'::jsonb)));
INSERT INTO erh_r (k, v) VALUES
  ('e5', pg_temp.erh('b1a00000-0000-0000-0000-0000000000a6', 'ip:' || repeat('e2', 16),
      pg_temp.erh_p('erh-started', 'erh-paid@example.org',
        '{"ticket_type_id": "b1a20000-0000-0000-0000-0000000000f6"}'::jsonb)));
RESET ROLE;
SELECT ok(
  (SELECT v->'client' = '{"ok": false, "error": "event_ended"}'::jsonb FROM erh_r WHERE k = 'e1')
  AND NOT EXISTS (SELECT 1 FROM public.event_registrations
                   WHERE event_id = 'b1a10000-0000-0000-0000-0000000000e2'),
  'zapis po ends_at -> odmowa');
SELECT is((SELECT v->'client' FROM erh_r WHERE k = 'e2'),
  '{"ok": false, "error": "event_ended"}'::jsonb,
  'wydarzenie bez ends_at po starcie: odmowa event_ended (ta sama regula co strona wydarzenia)');
SELECT is(
  ARRAY(SELECT v->'client'->>'error' FROM erh_r WHERE k IN ('e3', 'e5') ORDER BY k),
  ARRAY['ticket_sales_ended', 'ticket_sales_ended'],
  'platny bilet po starcie wydarzenia: ticket_sales_ended (gosc i zweryfikowane konto)');
SELECT is((SELECT v->'client' FROM erh_r WHERE k = 'e4'),
  '{"ok": true, "outcome": "check_email"}'::jsonb,
  'bezplatny bilet na trwajacym wydarzeniu nadal przyjmowany');
SELECT set_config('request.headers', '{"x-tenant-host":"erh-a.example"}', true);
SELECT throws_like(
  $$SELECT public.event_register(pg_temp.erh_p('erh-ended', 'erh-legacy@example.org'))$$,
  'event_ended%',
  'wrapper zgodnosci: zapis po koncu wydarzenia to wyjatek event_ended');
SELECT set_config('request.headers', '', true);

-- ── 50-56. REG-16: cena z chwili zapisu ─────────────────────────────────────
SET LOCAL ROLE service_role;
INSERT INTO erh_r (k, v) VALUES
  ('q1', pg_temp.erh('b1a00000-0000-0000-0000-0000000000a6', 'ip:' || repeat('f1', 16),
      pg_temp.erh_p('erh-event', 'erh-paid@example.org',
        '{"ticket_type_id": "b1a20000-0000-0000-0000-0000000000f3"}'::jsonb))),
  ('q2', pg_temp.erh('b1a00000-0000-0000-0000-0000000000a6', 'ip:' || repeat('f1', 16),
      pg_temp.erh_p('erh-soon', 'erh-paid@example.org',
        '{"ticket_type_id": "b1a20000-0000-0000-0000-0000000000f8"}'::jsonb)));
RESET ROLE;
SELECT ok(
  (SELECT (v->'client'->>'amount_cents')::int = 5000
          AND v->'client'->>'payment_status' = 'unpaid'
          AND (v->'client'->>'payment_required')::boolean
          AND (v->'client'->>'quote_valid_until')::timestamptz = now() + interval '72 hours'
     FROM erh_r WHERE k = 'q1'),
  'zapis w early birdzie: kwota 5000 i termin oferty w odpowiedzi');
SELECT is(
  (SELECT row(r.quoted_price_cents, r.quoted_currency, r.quote_valid_until)::text
     FROM public.event_registrations r
    WHERE r.id = (SELECT (v->'client'->>'registration_id')::uuid FROM erh_r WHERE k = 'q1')),
  row(5000, 'PLN', now() + interval '72 hours')::text,
  'zgloszenie pamieta oferte: cena, waluta i termin (72 h)');

UPDATE public.event_ticket_types SET early_bird_until = now() - interval '1 second'
 WHERE id = 'b1a20000-0000-0000-0000-0000000000f3';
SELECT set_config('request.headers', '{"x-tenant-host":"erh-a.example"}', true);
-- `request.jwt.claim.sub` tez: wejscie serwerowe odtwarza po sobie poprzednia
-- tozsamosc, a atrapa auth.uid() czyta najpierw te zmienna.
SELECT set_config('request.jwt.claim.sub', 'b1a00000-0000-0000-0000-0000000000a6', true);
SELECT set_config('request.jwt.claims',
  '{"sub":"b1a00000-0000-0000-0000-0000000000a6","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
SELECT is(
  (SELECT row(c->>'amount_cents', c->>'price_source')::text
     FROM (SELECT public.event_registration_payment_context(
             (SELECT (v->'client'->>'registration_id')::uuid FROM erh_r WHERE k = 'q1')) AS c) s),
  row('5000', 'quote')::text,
  'granica early birda');
RESET ROLE;
SELECT is(
  (public._event_invoice_registration_source('b1a0a000-0000-0000-0000-0000000000aa',
     (SELECT (v->'client'->>'registration_id')::uuid FROM erh_r WHERE k = 'q1'), '23')->>'gross')::int,
  5000,
  'granica early birda: proforma (zrodlo faktury) z ta sama kwota z chwili zapisu');

UPDATE public.event_registrations SET quote_valid_until = now() - interval '1 second'
 WHERE id = (SELECT (v->'client'->>'registration_id')::uuid FROM erh_r WHERE k = 'q1');
SET LOCAL ROLE authenticated;
SELECT is(
  (SELECT row(c->>'amount_cents', c->>'price_source')::text
     FROM (SELECT public.event_registration_payment_context(
             (SELECT (v->'client'->>'registration_id')::uuid FROM erh_r WHERE k = 'q1')) AS c) s),
  row('10000', 'current')::text,
  'po terminie oferty: cena biezaca (10000, current)');
RESET ROLE;

UPDATE public.event_registrations SET quote_valid_until = now() + interval '1 hour'
 WHERE id = (SELECT (v->'client'->>'registration_id')::uuid FROM erh_r WHERE k = 'q1');
UPDATE public.event_ticket_types
   SET price_cents = 4000, early_bird_price_cents = NULL, early_bird_until = NULL
 WHERE id = 'b1a20000-0000-0000-0000-0000000000f3';
SET LOCAL ROLE authenticated;
SELECT is(
  (public.event_registration_payment_context(
     (SELECT (v->'client'->>'registration_id')::uuid FROM erh_r WHERE k = 'q1'))->>'amount_cents')::int,
  4000,
  'LEAST: obnizka ceny po zapisie przechodzi na uczestnika (oferta 5000, cena 4000)');
RESET ROLE;
SELECT set_config('request.headers', '', true);
SELECT set_config('request.jwt.claim.sub', '', true);
SELECT is(
  (SELECT r.quote_valid_until FROM public.event_registrations r
    WHERE r.id = (SELECT (v->'client'->>'registration_id')::uuid FROM erh_r WHERE k = 'q2')),
  now() + interval '1 day',
  'oferta nie trwa dluzej niz do startu wydarzenia (LEAST z 72 h)');

-- ── 57. Ogon odmowy tylko dla list ───────────────────────────────────────────
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);
SET LOCAL ROLE service_role;
SELECT is(
  pg_temp.erh(NULL, 'ip:' || repeat('a8', 16), pg_temp.erh_p('erh-terms', 'erh-terms@example.org')) -> 'client',
  '{"ok": false, "error": "terms_required", "detail": "erh_reg"}'::jsonb,
  'odmowa z lista: kod i ogon (klucz brakujacego regulaminu)');

-- ── 58-70. Sufity pol: odmowa, nigdy przyciecie ─────────────────────────────
INSERT INTO erh_r (k, v) VALUES
  ('l1', pg_temp.erh(NULL, 'ip:' || repeat('a9', 16), pg_temp.erh_p('erh-limits', 'erh-l1@example.org',
      jsonb_build_object('first_name', repeat('A', 81))))),
  ('l2', pg_temp.erh(NULL, 'ip:' || repeat('a9', 16), pg_temp.erh_p('erh-limits',
      repeat('a', 309) || '@example.org'))),
  ('l3', pg_temp.erh(NULL, 'ip:' || repeat('a9', 16), pg_temp.erh_p('erh-limits', 'erh-l3@example.org',
      '{"phone": "123"}'::jsonb))),
  ('l4', pg_temp.erh(NULL, 'ip:' || repeat('a9', 16), pg_temp.erh_p('erh-limits', 'erh-l4@example.org',
      jsonb_build_object('phone', repeat('1', 41))))),
  ('l5', pg_temp.erh(NULL, 'ip:' || repeat('a9', 16), pg_temp.erh_p('erh-limits', 'erh-l5@example.org',
      jsonb_build_object('job_title', repeat('j', 161))))),
  ('l6', pg_temp.erh(NULL, 'ip:' || repeat('a9', 16), pg_temp.erh_p('erh-limits', 'erh-l6@example.org',
      jsonb_build_object('company_text', repeat('c', 201))))),
  ('l7', pg_temp.erh(NULL, 'ip:' || repeat('a9', 16), pg_temp.erh_p('erh-limits', 'erh-l7@example.org',
      jsonb_build_object('social_profile_url', 'https://' || repeat('s', 493))))),
  ('l8', pg_temp.erh(NULL, 'ip:' || repeat('a9', 16), pg_temp.erh_p('erh-limits', 'erh-l8@example.org',
      jsonb_build_object('reveal_code', repeat('R', 65))))),
  ('l9', pg_temp.erh(NULL, 'ip:' || repeat('a9', 16), pg_temp.erh_p('erh-limits', 'erh-l9@example.org',
      '{"lang": "de"}'::jsonb))),
  ('l10', pg_temp.erh(NULL, 'ip:' || repeat('a9', 16), pg_temp.erh_p('erh-limits', 'erh-l10@example.org',
      '{"consent_text_version": 999}'::jsonb))),
  ('l11', pg_temp.erh(NULL, 'ip:' || repeat('a9', 16), pg_temp.erh_p('erh-limits', 'erh-l11@example.org',
      jsonb_build_object('first_name', repeat('F', 80), 'last_name', repeat('L', 80),
        'phone', repeat('9', 40), 'job_title', repeat('j', 160), 'company_text', repeat('c', 200),
        'social_profile_url', 'https://' || repeat('s', 492), 'lang', 'en'))));
RESET ROLE;
SELECT is((SELECT v->'client'->>'error' FROM erh_r WHERE k = 'l1'), 'invalid_name',
  'imie 81 znakow: invalid_name (nie przyciete)');
SELECT is((SELECT v->'client'->>'error' FROM erh_r WHERE k = 'l2'), 'invalid_email',
  'adres 321 znakow: invalid_email');
SELECT is((SELECT v->'client'->>'error' FROM erh_r WHERE k = 'l3'), 'invalid_phone',
  'telefon 3 znaki: invalid_phone');
SELECT is((SELECT v->'client'->>'error' FROM erh_r WHERE k = 'l4'), 'invalid_phone',
  'telefon 41 znakow: invalid_phone');
SELECT is((SELECT v->'client'->>'error' FROM erh_r WHERE k = 'l5'), 'invalid_job_title',
  'stanowisko 161 znakow: invalid_job_title');
SELECT is((SELECT v->'client'->>'error' FROM erh_r WHERE k = 'l6'), 'invalid_company',
  'firma 201 znakow: invalid_company');
SELECT is((SELECT v->'client'->>'error' FROM erh_r WHERE k = 'l7'), 'invalid_social_url',
  'profil 501 znakow: invalid_social_url');
SELECT is((SELECT v->'client'->>'error' FROM erh_r WHERE k = 'l8'), 'invalid_payload',
  'kod odslaniajacy 65 znakow: invalid_payload');
SELECT is(
  ARRAY(SELECT v->'client'->>'error' FROM erh_r WHERE k IN ('l9', 'l10') ORDER BY k DESC),
  ARRAY['invalid_payload', 'invalid_payload'],
  'jezyk spoza pl/en i nieznana wersja tekstu zgod: invalid_payload');
SELECT ok(
  NOT EXISTS (SELECT 1 FROM public.event_people
               WHERE tenant_id = 'b1a0a000-0000-0000-0000-0000000000aa'
                 AND email_norm ~ '^erh-l([0-9]|10)@example\.org$'),
  'odmowy sufitow nie zostawiaja osoby');
SELECT is((SELECT v->'client' FROM erh_r WHERE k = 'l11'),
  '{"ok": true, "outcome": "check_email"}'::jsonb,
  'wartosci rowne sufitom przechodza');
SELECT is(
  (SELECT row(char_length(first_name), char_length(last_name), char_length(phone),
              char_length(job_title), char_length(company_text), char_length(social_profile_url))::text
     FROM public.event_people
    WHERE tenant_id = 'b1a0a000-0000-0000-0000-0000000000aa' AND email_norm = 'erh-l11@example.org'),
  row(80, 80, 40, 160, 200, 500)::text,
  'kartoteka trzyma wartosci w calosci (nic nie przyciete)');
SELECT is(
  (SELECT r.lang FROM public.event_registrations r
     JOIN public.event_people p ON p.id = r.person_id
    WHERE p.email_norm = 'erh-l11@example.org' AND r.tenant_id = 'b1a0a000-0000-0000-0000-0000000000aa'),
  'en',
  'nowa osoba: jezyk formularza zapisany w zgloszeniu');

SELECT set_config('request.headers', '', true);
SELECT set_config('request.jwt.claims', '', true);
SELECT set_config('request.jwt.claim.sub', '', true);
SELECT * FROM finish();
ROLLBACK;
