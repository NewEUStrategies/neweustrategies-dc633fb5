-- pgTAP: poprawki zapisu na wydarzenie po przegladzie adwersarialnym R38
-- (migracje 20261012180000..180400).
--
-- KRYTERIA (kazde OBLEWA sie na cialach sprzed tych migracji - dowod mutacji
-- w raporcie jednostki FIX-R38):
--   1. ZNAKI STERUJACE (C0, DEL, C1) w imieniu, nazwisku, adresie, telefonie,
--      stanowisku, firmie i profilu: odmowa kodem POLA, zanim baza spojrzy na
--      adres. Znany i swiezy adres dostaja bajt w bajt ta sama odpowiedz.
--      Wczesniej znany adres (osoba w kartotece bez zapisu na wydarzenie)
--      pekal na CHECK `event_registrations_submitted_profile_shape` i dostawal
--      `unknown`, a swiezy - `check_email`: wyrocznia kartoteki najemcy.
--      Ladunek na samych sufitach (cudzyslowy i ukosniki - po dwa znaki
--      w tekscie jsonb) przechodzi dla obu adresow tak samo.
--   2. WYSCIG PIERWSZYCH ZAPISOW NOWEGO ADRESU. Wiersz osoby pojawia sie miedzy
--      odczytem a wstawieniem (symulacja deterministyczna wyzwalaczem - wyscig
--      dwoch sesji: harness 21_register_oracle_followups.sql). Zgloszenie
--      powstaje na istniejacej osobie z dostawa „utworzono"; wczesniej
--      znikalo jako `already_registered` bez zgloszenia i bez maila.
--      `already_registered` daje WYLACZNIE naruszenie unikalnosci zgloszenia
--      (`event_registrations_active_uniq`), kazde inne naruszenie to `unknown`.
--   3. OFERTA CENY PRZYPIETA DO BILETU: zmiana biletu kasuje oferte (bilet
--      za 50 zl przeniesiony na 900 zl nie kosztuje 50 zl).
--   4. JEZYK MAILA POTWIERDZENIA = jezyk zgloszenia (`_event_registration_lang`).
--   5. PRZYJECIE ZAPROSZENIA PAKIETOWEGO: te same znaki sterujace odrzucone,
--      zanim baza szuka tokenu.
BEGIN;
SELECT plan(29);

ALTER TABLE auth.users DISABLE TRIGGER USER;

INSERT INTO public.tenants (id, slug, name, domain) VALUES
  ('f38a0000-0000-0000-0000-0000000000aa', 'r38f-a', 'R38 poprawki A', 'r38f-a.example');

INSERT INTO auth.users (id, email, email_confirmed_at) VALUES
  ('f38a1000-0000-0000-0000-0000000000a1', 'r38f-owner@example.org', now());
INSERT INTO public.profiles (id, email, display_name, tenant_id) VALUES
  ('f38a1000-0000-0000-0000-0000000000a1', 'r38f-owner@example.org', 'R38 Owner',
   'f38a0000-0000-0000-0000-0000000000aa');

INSERT INTO public.events (id, tenant_id, slug, title_pl, title_en, starts_at, ends_at, status) VALUES
  ('f38a2000-0000-0000-0000-0000000000e1', 'f38a0000-0000-0000-0000-0000000000aa',
   'r38f-ev', 'R38 poprawki', 'R38 fixes', now() + interval '30 days', NULL, 'published'),
  ('f38a2000-0000-0000-0000-0000000000e2', 'f38a0000-0000-0000-0000-0000000000aa',
   'r38f-race', 'R38 wyscig', 'R38 race', now() + interval '30 days', NULL, 'published');

-- f1 bezplatny, f2 platny 50 zl, f3 VIP 900 zl (to samo wydarzenie); f4 bezplatny (wyscig).
INSERT INTO public.event_ticket_types (id, tenant_id, event_id, key, name_pl, name_en, price_cents, currency) VALUES
  ('f38a3000-0000-0000-0000-0000000000f1', 'f38a0000-0000-0000-0000-0000000000aa',
   'f38a2000-0000-0000-0000-0000000000e1', 'r38f_free', 'Wolny', 'Free', 0, 'PLN'),
  ('f38a3000-0000-0000-0000-0000000000f2', 'f38a0000-0000-0000-0000-0000000000aa',
   'f38a2000-0000-0000-0000-0000000000e1', 'r38f_cheap', 'Tani', 'Cheap', 5000, 'PLN'),
  ('f38a3000-0000-0000-0000-0000000000f3', 'f38a0000-0000-0000-0000-0000000000aa',
   'f38a2000-0000-0000-0000-0000000000e1', 'r38f_vip', 'VIP', 'VIP', 90000, 'PLN'),
  ('f38a3000-0000-0000-0000-0000000000f4', 'f38a0000-0000-0000-0000-0000000000aa',
   'f38a2000-0000-0000-0000-0000000000e2', 'r38f_race', 'Wyscig', 'Race', 0, 'PLN');

-- Osoba ZNANA kartotece najemcy (np. dawny prelegent), bez zapisu na r38f-ev.
INSERT INTO public.event_people (id, tenant_id, email, first_name, last_name) VALUES
  ('f38a4000-0000-0000-0000-0000000000b1', 'f38a0000-0000-0000-0000-0000000000aa',
   'r38f-known@example.org', 'Znana', 'Osoba');

-- Wywolanie serwera (jak eventRegistration.server.ts); kazde z wlasnym adresem
-- (kubelek goscia 12 / 10 min), ladunek formularza z biletem wydarzenia.
CREATE FUNCTION pg_temp.r8(p_uid uuid, p_ip_seed text, p_payload jsonb)
RETURNS jsonb LANGUAGE sql AS $$
  SELECT public.event_register_for_client(
    'f38a0000-0000-0000-0000-0000000000aa', p_uid, 'ip:' || md5(p_ip_seed), 'pgtap/1.0', p_payload)
$$;
CREATE FUNCTION pg_temp.r8p(p_slug text, p_email text, p_extra jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_build_object('event_slug', p_slug, 'first_name', 'Probe', 'last_name', 'Er',
           'email', p_email, 'consent_data_processing', true,
           'ticket_type_id', CASE p_slug
             WHEN 'r38f-ev' THEN 'f38a3000-0000-0000-0000-0000000000f1'
             WHEN 'r38f-race' THEN 'f38a3000-0000-0000-0000-0000000000f4' END) || p_extra
$$;
CREATE TEMP TABLE r8_out (k text PRIMARY KEY, v jsonb);
GRANT ALL ON r8_out TO service_role, authenticated, anon;

-- ── 1. Pomocnik znakow sterujacych - nie dla klientow ───────────────────────
SELECT ok(
  to_regprocedure('public._event_text_has_control(text)') IS NOT NULL
  AND NOT has_function_privilege('anon', 'public._event_text_has_control(text)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public._event_text_has_control(text)', 'EXECUTE'),
  '_event_text_has_control: jedna regula znakow sterujacych, bez grantu dla klientow');

SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);
SET LOCAL ROLE service_role;

-- ── 2-8. Znak sterujacy w kazdym polu - kod POLA ────────────────────────────
INSERT INTO r8_out VALUES
  ('c_first', pg_temp.r8(NULL, 'c_first', pg_temp.r8p('r38f-ev', 'r38f-c1@example.org',
     jsonb_build_object('first_name', 'Ja' || chr(1) || 'n')))->'client'),
  ('c_last', pg_temp.r8(NULL, 'c_last', pg_temp.r8p('r38f-ev', 'r38f-c2@example.org',
     jsonb_build_object('last_name', 'Kow' || chr(127) || 'alski')))->'client'),
  ('c_email', pg_temp.r8(NULL, 'c_email', pg_temp.r8p('r38f-ev', 'r38f-c3' || chr(1) || '@example.org'))->'client'),
  ('c_phone', pg_temp.r8(NULL, 'c_phone', pg_temp.r8p('r38f-ev', 'r38f-c4@example.org',
     jsonb_build_object('phone', '+48 600' || chr(10) || '100 200')))->'client'),
  ('c_job', pg_temp.r8(NULL, 'c_job', pg_temp.r8p('r38f-ev', 'r38f-c5@example.org',
     jsonb_build_object('job_title', 'Dyrektor' || chr(133))))->'client'),
  ('c_company', pg_temp.r8(NULL, 'c_company', pg_temp.r8p('r38f-ev', 'r38f-c6@example.org',
     jsonb_build_object('company_text', 'NES' || chr(1) || 'SA')))->'client'),
  ('c_social', pg_temp.r8(NULL, 'c_social', pg_temp.r8p('r38f-ev', 'r38f-c7@example.org',
     jsonb_build_object('social_profile_url', 'https://exa' || chr(9) || 'mple.org/in/x')))->'client');
RESET ROLE;

SELECT is((SELECT v FROM r8_out WHERE k = 'c_first'), '{"ok": false, "error": "invalid_name"}'::jsonb,
  'znak sterujacy (C0) w imieniu - invalid_name');
SELECT is((SELECT v FROM r8_out WHERE k = 'c_last'), '{"ok": false, "error": "invalid_name"}'::jsonb,
  'DEL w nazwisku - invalid_name');
SELECT is((SELECT v FROM r8_out WHERE k = 'c_email'), '{"ok": false, "error": "invalid_email"}'::jsonb,
  'znak sterujacy w adresie e-mail - invalid_email');
SELECT is((SELECT v FROM r8_out WHERE k = 'c_phone'), '{"ok": false, "error": "invalid_phone"}'::jsonb,
  'nowa linia w telefonie - invalid_phone');
SELECT is((SELECT v FROM r8_out WHERE k = 'c_job'), '{"ok": false, "error": "invalid_job_title"}'::jsonb,
  'znak sterujacy C1 (U+0085) w stanowisku - invalid_job_title');
SELECT is((SELECT v FROM r8_out WHERE k = 'c_company'), '{"ok": false, "error": "invalid_company"}'::jsonb,
  'znak sterujacy w firmie - invalid_company');
SELECT is((SELECT v FROM r8_out WHERE k = 'c_social'), '{"ok": false, "error": "invalid_social_url"}'::jsonb,
  'tabulator w adresie profilu - invalid_social_url');

-- ── 9-11. Ladunek z przegladu R38: znany i swiezy adres nierozroznialne ────
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);
SET LOCAL ROLE service_role;
INSERT INTO r8_out VALUES
  ('oracle_fresh', pg_temp.r8(NULL, 'oracle_fresh', pg_temp.r8p('r38f-ev', 'r38f-fresh@example.org',
     jsonb_build_object('company_text', repeat(chr(1), 200),
                        'social_profile_url', 'https://' || repeat(chr(1), 492))))->'client'),
  ('oracle_known', pg_temp.r8(NULL, 'oracle_known', pg_temp.r8p('r38f-ev', 'r38f-known@example.org',
     jsonb_build_object('company_text', repeat(chr(1), 200),
                        'social_profile_url', 'https://' || repeat(chr(1), 492))))->'client');
RESET ROLE;

SELECT is((SELECT v FROM r8_out WHERE k = 'oracle_known'), (SELECT v FROM r8_out WHERE k = 'oracle_fresh'),
  'REG-04 „odpowiedzi nierozroznialne": znany i swiezy adres - ta sama odpowiedz na znaki sterujace');
SELECT is((SELECT v FROM r8_out WHERE k = 'oracle_known'), '{"ok": false, "error": "invalid_company"}'::jsonb,
  'znaki sterujace - odmowa kodem pola (invalid_company), nie `unknown` z CHECK-u submitted_profile');
SELECT ok(
  NOT EXISTS (SELECT 1 FROM public.event_people p
               WHERE p.tenant_id = 'f38a0000-0000-0000-0000-0000000000aa'
                 AND p.email_norm = 'r38f-fresh@example.org')
  AND NOT EXISTS (SELECT 1 FROM public.event_registrations r
                   WHERE r.person_id = 'f38a4000-0000-0000-0000-0000000000b1'),
  'odmowa PRZED wyszukaniem osoby: swiezy adres nie trafia do kartoteki, znany nie dostaje zgloszenia');

-- ── 12-13. Ladunek na samych sufitach (znaki ucieczki jsonb) ────────────────
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);
SET LOCAL ROLE service_role;
INSERT INTO r8_out
SELECT x.k, pg_temp.r8(NULL, x.k, pg_temp.r8p('r38f-ev', x.email, jsonb_build_object(
         'first_name', repeat('"\', 40), 'last_name', repeat('\"', 40),
         'phone', repeat('"\', 20), 'job_title', repeat('"\', 80),
         'company_text', repeat('"\', 100), 'social_profile_url', 'https://' || repeat('"\', 246))))->'client'
  FROM (VALUES ('edge_fresh', 'r38f-edge@example.org'), ('edge_known', 'r38f-known@example.org')) AS x(k, email);
RESET ROLE;

SELECT ok(
  (SELECT v FROM r8_out WHERE k = 'edge_known') = (SELECT v FROM r8_out WHERE k = 'edge_fresh')
  AND (SELECT v FROM r8_out WHERE k = 'edge_known') = '{"ok": true, "outcome": "check_email"}'::jsonb,
  'sufity pol z cudzyslowami i ukosnikami: znany i swiezy adres - ta sama odpowiedz check_email');
SELECT ok(
  (SELECT r.submitted_profile->>'company_text' = repeat('"\', 100)
      AND r.submitted_profile->>'social_profile_url' = 'https://' || repeat('"\', 246)
      AND char_length(r.submitted_profile::text) <= 4000
     FROM public.event_registrations r
    WHERE r.person_id = 'f38a4000-0000-0000-0000-0000000000b1'),
  'najgorszy przypadek submitted_profile miesci sie w CHECK-u i jest zapisany bez przyciecia');

-- ── 14-15. Zaproszenie pakietowe: znaki sterujace przed tokenem ─────────────
SELECT set_config('request.headers', '{"x-tenant-host":"r38f-a.example"}', true);
SELECT set_config('request.jwt.claims', '{"role":"anon"}', true);
SET LOCAL ROLE anon;
SELECT throws_like(
  $$SELECT public.event_package_invite_accept(jsonb_build_object(
      'token', repeat('A', 32), 'first_name', 'Ja' || chr(1) || 'n', 'last_name', 'Kowalski',
      'consent_data_processing', true))$$,
  'invalid_name%',
  'zaproszenie: znak sterujacy w imieniu - invalid_name, zanim baza szuka tokenu');
SELECT throws_like(
  $$SELECT public.event_package_invite_accept(jsonb_build_object(
      'token', repeat('A', 32), 'first_name', 'Jan', 'last_name', 'Kowalski',
      'company_text', 'NES' || chr(31), 'consent_data_processing', true))$$,
  'invalid_company%',
  'zaproszenie: znak sterujacy w firmie - invalid_company');
RESET ROLE;
SELECT set_config('request.headers', '', true);

-- ── 16-18. Wyscig pierwszych zapisow nowego adresu (symulacja) ──────────────
-- Wyzwalacz udaje rownolegla sesje, ktora zatwierdzila osobe o tym samym
-- adresie miedzy odczytem a wstawieniem (BEFORE INSERT biegnie przed
-- sprawdzeniem indeksu unikalnego, takze przy ON CONFLICT).
CREATE FUNCTION public.r38f_tg_concurrent_person() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF pg_trigger_depth() = 1 AND lower(btrim(NEW.email)) = 'r38f-race@example.org' THEN
    INSERT INTO public.event_people (tenant_id, email, first_name, last_name, source)
    VALUES (NEW.tenant_id, lower(btrim(NEW.email)), 'Rownolegla', 'Osoba', 'self_registration');
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER r38f_concurrent_person BEFORE INSERT ON public.event_people
  FOR EACH ROW EXECUTE FUNCTION public.r38f_tg_concurrent_person();

SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);
SET LOCAL ROLE service_role;
INSERT INTO r8_out VALUES
  ('race', pg_temp.r8(NULL, 'race', pg_temp.r8p('r38f-race', 'r38f-race@example.org')));
RESET ROLE;
DROP TRIGGER r38f_concurrent_person ON public.event_people;

SELECT is((SELECT v->'client' FROM r8_out WHERE k = 'race'), '{"ok": true, "outcome": "check_email"}'::jsonb,
  'wyscig: odpowiedz neutralna jak zawsze');
SELECT ok(
  (SELECT v->'delivery'->>'kind' = 'created' AND v->'delivery'->>'registration_id' IS NOT NULL
     FROM r8_out WHERE k = 'race'),
  'wyscig: dostawa „utworzono" (potwierdzenie z linkiem trafi do skrzynki), a nie zgubiony zapis');
SELECT ok(
  (SELECT count(*) = 1 AND bool_and(p.first_name = 'Rownolegla' AND r.submitted_profile->>'first_name' = 'Probe')
     FROM public.event_registrations r
     JOIN public.event_people p ON p.id = r.person_id
    WHERE r.event_id = 'f38a2000-0000-0000-0000-0000000000e2'
      AND p.email_norm = 'r38f-race@example.org'
      AND r.status NOT IN ('cancelled', 'rejected')),
  'wyscig: jedno zgloszenie na osobie z rownoleglego zapisu; jej kartoteka nietknieta, dane formularza w submitted_profile');

-- ── 19-20. Tylko unikalnosc ZGLOSZENIA znaczy „juz zapisany" ────────────────
CREATE FUNCTION public.r38f_tg_raise_unique() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF COALESCE(current_setting('r38f.raise', true), '') <> '' THEN
    RAISE unique_violation USING MESSAGE = 'r38f: symulowane naruszenie unikalnosci',
      CONSTRAINT = current_setting('r38f.raise', true);
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER r38f_raise_unique BEFORE INSERT ON public.event_registrations
  FOR EACH ROW EXECUTE FUNCTION public.r38f_tg_raise_unique();

SELECT set_config('r38f.raise', 'event_people_tenant_user_uniq', true);
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);
SET LOCAL ROLE service_role;
INSERT INTO r8_out VALUES
  ('uniq_other', pg_temp.r8(NULL, 'uniq_other', pg_temp.r8p('r38f-ev', 'r38f-uniq1@example.org')));
RESET ROLE;
SELECT set_config('r38f.raise', 'event_registrations_active_uniq', true);
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);
SET LOCAL ROLE service_role;
INSERT INTO r8_out VALUES
  ('uniq_reg', pg_temp.r8(NULL, 'uniq_reg', pg_temp.r8p('r38f-ev', 'r38f-uniq2@example.org')));
RESET ROLE;
SELECT set_config('r38f.raise', '', true);
DROP TRIGGER r38f_raise_unique ON public.event_registrations;

SELECT is((SELECT v FROM r8_out WHERE k = 'uniq_other'),
  '{"client": {"ok": false, "error": "unknown"}, "delivery": null}'::jsonb,
  'naruszenie innej unikalnosci niz zgloszenia to awaria (unknown), nie „juz zapisany"');
SELECT is((SELECT v FROM r8_out WHERE k = 'uniq_reg'),
  '{"client": {"ok": true, "outcome": "check_email"}, "delivery": null}'::jsonb,
  'naruszenie event_registrations_active_uniq - „juz zapisany" (neutralnie, bez dostawy)');

-- ── 21-25. Oferta ceny przypieta do biletu ──────────────────────────────────
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);
SET LOCAL ROLE service_role;
INSERT INTO r8_out VALUES
  ('quote', pg_temp.r8('f38a1000-0000-0000-0000-0000000000a1', 'quote',
     pg_temp.r8p('r38f-ev', 'r38f-owner@example.org',
       jsonb_build_object('ticket_type_id', 'f38a3000-0000-0000-0000-0000000000f2')))->'client');
RESET ROLE;

SELECT ok(
  (SELECT r.quoted_price_cents = 5000 AND r.quoted_currency = 'PLN' AND r.quote_valid_until IS NOT NULL
     FROM public.event_registrations r WHERE r.id = (SELECT (v->>'registration_id')::uuid FROM r8_out WHERE k = 'quote')),
  'punkt wyjscia: zgloszenie na bilet 50 zl pamieta oferte 5000');

-- Organizator przenosi zgloszenie na VIP (ten sam zapis kolumny co admin_event_registration_upsert).
UPDATE public.event_registrations SET ticket_type_id = 'f38a3000-0000-0000-0000-0000000000f3'
 WHERE id = (SELECT (v->>'registration_id')::uuid FROM r8_out WHERE k = 'quote');

SELECT ok(
  (SELECT r.quoted_price_cents IS NULL AND r.quoted_currency IS NULL AND r.quote_valid_until IS NULL
     FROM public.event_registrations r WHERE r.id = (SELECT (v->>'registration_id')::uuid FROM r8_out WHERE k = 'quote')),
  'REG-16: zmiana biletu kasuje oferte ceny poprzedniego biletu');

-- `request.jwt.claim.sub` jawnie: wejscie zapisu odtwarza po sobie poprzednia
-- tozsamosc (pusty napis), a atrapa auth.uid() czyta najpierw ten klucz.
SELECT set_config('request.headers', '{"x-tenant-host":"r38f-a.example"}', true);
SELECT set_config('request.jwt.claim.sub', 'f38a1000-0000-0000-0000-0000000000a1', true);
SELECT set_config('request.jwt.claims',
  '{"sub":"f38a1000-0000-0000-0000-0000000000a1","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
INSERT INTO r8_out SELECT 'quote_ctx',
  public.event_registration_payment_context((SELECT (v->>'registration_id')::uuid FROM r8_out WHERE k = 'quote'));
RESET ROLE;
SELECT set_config('request.headers', '', true);
SELECT set_config('request.jwt.claim.sub', '', true);

SELECT ok(
  (SELECT (v->>'amount_cents')::int = 90000 AND v->>'price_source' = 'current' FROM r8_out WHERE k = 'quote_ctx'),
  'REG-16: kasa liczy VIP po jego cenie (90000, current), a nie po ofercie biletu za 50 zl');

UPDATE public.event_registrations
   SET ticket_type_id = 'f38a3000-0000-0000-0000-0000000000f2',
       quoted_price_cents = 4000, quoted_currency = 'PLN', quote_valid_until = now() + interval '1 hour'
 WHERE id = (SELECT (v->>'registration_id')::uuid FROM r8_out WHERE k = 'quote');
SELECT ok(
  (SELECT r.quoted_price_cents = 4000 FROM public.event_registrations r
    WHERE r.id = (SELECT (v->>'registration_id')::uuid FROM r8_out WHERE k = 'quote')),
  'zmiana biletu z JAWNA nowa oferta w tym samym zapisie - oferta zostaje (swiadoma wycena)');

UPDATE public.event_registrations SET answers = '{"r38f":"x"}'::jsonb
 WHERE id = (SELECT (v->>'registration_id')::uuid FROM r8_out WHERE k = 'quote');
SELECT ok(
  (SELECT r.quoted_price_cents = 4000 AND r.quote_valid_until IS NOT NULL FROM public.event_registrations r
    WHERE r.id = (SELECT (v->>'registration_id')::uuid FROM r8_out WHERE k = 'quote')),
  'zapis bez zmiany biletu nie dotyka oferty');

-- ── 26-28. Jezyk maila potwierdzenia ────────────────────────────────────────
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);
SET LOCAL ROLE service_role;
INSERT INTO r8_out VALUES
  ('lang_en', pg_temp.r8(NULL, 'lang_en', pg_temp.r8p('r38f-ev', 'r38f-en@example.org', '{"lang":"en"}'))),
  ('lang_pl', pg_temp.r8(NULL, 'lang_pl', pg_temp.r8p('r38f-ev', 'r38f-pl@example.org', '{"lang":"pl"}')));
INSERT INTO r8_out SELECT 'notify_en', public.event_registration_notify_payload_for_tenant(
  'f38a0000-0000-0000-0000-0000000000aa',
  jsonb_build_object('manage_token', (SELECT v->'delivery'->>'manage_token' FROM r8_out WHERE k = 'lang_en')));
INSERT INTO r8_out SELECT 'notify_pl', public.event_registration_notify_payload_for_tenant(
  'f38a0000-0000-0000-0000-0000000000aa',
  jsonb_build_object('manage_token', (SELECT v->'delivery'->>'manage_token' FROM r8_out WHERE k = 'lang_pl')));
RESET ROLE;

SELECT is((SELECT v->>'lang' FROM r8_out WHERE k = 'notify_en'), 'en',
  'formularz po angielsku - potwierdzenie z linkiem samoobslugi po angielsku');
SELECT is((SELECT v->>'lang' FROM r8_out WHERE k = 'notify_en'),
  (SELECT v->'delivery'->'recipient'->>'lang' FROM r8_out WHERE k = 'lang_en'),
  'jeden jezyk na jedno zgloszenie: potwierdzenie i dostawa (DOI, „juz zapisany") mowia tym samym');
SELECT is((SELECT v->>'lang' FROM r8_out WHERE k = 'notify_pl'), 'pl',
  'formularz po polsku - potwierdzenie po polsku');

-- ── 29. Sprzatanie wyzwalaczy symulacji ─────────────────────────────────────
DROP FUNCTION public.r38f_tg_concurrent_person();
DROP FUNCTION public.r38f_tg_raise_unique();
SELECT ok(
  to_regprocedure('public.r38f_tg_concurrent_person()') IS NULL
  AND to_regprocedure('public.r38f_tg_raise_unique()') IS NULL,
  'symulacja nie zostawia wyzwalaczy');

SELECT set_config('request.jwt.claims', '', true);
SELECT * FROM finish();
ROLLBACK;
